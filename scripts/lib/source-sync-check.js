'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { validateCatalogRecord } = require('./catalog-schema');
const { snapshotSkill } = require('./content-store');
const { createGhReader, fetchSource, findLicense } = require('./github-source');
const { prepareCandidate } = require('./source-sync-candidate');

function failure(code, message, target = null) {
  return { code, path: target, message };
}

function sourceOf(tracking) {
  if (!tracking) return null;
  return {
    provider: tracking.provider,
    repository: tracking.repository,
    path: tracking.path,
    ref_policy: tracking.ref_policy,
    ref: tracking.ref,
    enabled: tracking.enabled,
  };
}

function resultFor(
  record,
  status,
  {
    code = null,
    now,
    license = 'not_applicable',
    revision = null,
    digest = null,
    previous = null,
  } = {},
) {
  return {
    slug: record?.slug ?? null,
    source: sourceOf(record?.source_tracking),
    status,
    resolved_revision: revision,
    content_digest: digest,
    previous_digest: previous,
    license_status: license,
    error_code: code,
    checked_at: now,
  };
}

function loadRecords(projectRoot) {
  const directory = path.join(projectRoot, 'catalog');
  let names;
  try {
    names = fs
      .readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    return { ok: false, records: [], diagnostics: [failure('E_CATALOG', 'catalog 目录无法读取')] };
  }
  const records = [];
  const diagnostics = [];
  for (const name of names) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
    } catch {
      diagnostics.push(failure('E_SCHEMA', 'catalog 记录无法解析', name));
      continue;
    }
    const validated = validateCatalogRecord(parsed);
    if (!validated.ok) {
      for (const item of validated.diagnostics) diagnostics.push(item);
      continue;
    }
    records.push(validated.record);
  }
  return { ok: diagnostics.length === 0, records, diagnostics };
}

function selectTargets(records, slug, now) {
  if (slug) {
    const record = records.find((item) => item.slug === slug);
    if (!record) {
      return {
        targets: [],
        result: {
          slug,
          source: null,
          status: 'unsupported',
          resolved_revision: null,
          content_digest: null,
          previous_digest: null,
          license_status: 'not_applicable',
          error_code: 'E_SOURCE_NOT_FOUND',
          checked_at: now,
        },
      };
    }
    return { targets: [record], result: null };
  }
  return {
    targets: records.filter((item) => item.source_tracking?.enabled === true),
    result: null,
  };
}

function checkRecord({ projectRoot, record, reader, now }) {
  const tracking = record.source_tracking;
  if (!tracking) {
    return { result: resultFor(record, 'unsupported', { code: 'E_SOURCE_UNCONFIGURED', now }) };
  }
  if (tracking.enabled !== true) {
    return { result: resultFor(record, 'unsupported', { code: 'E_SOURCE_DISABLED', now }) };
  }
  if (tracking.provider !== 'github') {
    return { result: resultFor(record, 'unsupported', { code: 'E_SOURCE_UNSUPPORTED', now }) };
  }

  const fetched = fetchSource({
    source: tracking,
    reader,
    mainRelative: record.content_path.endsWith('/SKILL.md') ? 'SKILL.md' : null,
  });
  if (!fetched.ok) {
    return {
      result: resultFor(record, 'failed', {
        code: fetched.diagnostics[0]?.code ?? 'E_SOURCE',
        now,
      }),
    };
  }

  const prepared = prepareCandidate({ record, fetched });
  if (!prepared.ok) {
    return {
      result: resultFor(record, 'failed', {
        code: prepared.diagnostics[0]?.code ?? 'E_CANDIDATE',
        now,
        revision: fetched.revision,
      }),
    };
  }

  const current = snapshotSkill({ projectRoot, record });
  if (!current.ok) {
    return {
      result: resultFor(record, 'failed', {
        code: current.diagnostics[0]?.code ?? 'E_SOURCE',
        now,
        revision: fetched.revision,
      }),
    };
  }

  const currentLicense = findLicense(
    new Map(current.snapshot.files.map((file) => [file.path, file.bytes])),
  );
  const persistedLicense = tracking.last_synced_license ?? null;
  const baselineLicense = persistedLicense ?? currentLicense;
  const candidateLicense = prepared.candidate.license;
  if (!candidateLicense) {
    return {
      result: resultFor(record, 'policy_blocked', {
        code: 'E_LICENSE_MISSING',
        now,
        license: 'missing',
        revision: fetched.revision,
        digest: prepared.candidate.digest,
        previous: tracking.last_synced_digest,
      }),
    };
  }
  if (
    baselineLicense &&
    (baselineLicense.path !== candidateLicense.path ||
      baselineLicense.sha256 !== candidateLicense.sha256)
  ) {
    return {
      result: resultFor(record, 'policy_blocked', {
        code: 'E_LICENSE_CHANGED',
        now,
        license: 'changed',
        revision: fetched.revision,
        digest: prepared.candidate.digest,
        previous: tracking.last_synced_digest,
      }),
    };
  }

  const previous = tracking.last_synced_digest ?? null;
  const currentDigest = current.snapshot.digest;
  const base = {
    now,
    revision: fetched.revision,
    digest: prepared.candidate.digest,
    previous,
    license: 'present',
  };
  if (previous && currentDigest !== previous) {
    return { result: resultFor(record, 'conflict', { ...base, code: 'E_CONFLICT_LOCAL' }) };
  }
  if (prepared.candidate.digest === currentDigest) {
    const result = resultFor(record, 'unchanged', base);
    return {
      result,
      candidate: previous
        ? null
        : { record, candidate: prepared.candidate, baselineOnly: true, currentDigest, result },
    };
  }
  if (!previous) {
    return { result: resultFor(record, 'conflict', { ...base, code: 'E_CONFLICT_BASELINE' }) };
  }
  const result = resultFor(record, 'candidate', base);
  return {
    result,
    candidate: {
      record,
      candidate: prepared.candidate,
      baselineOnly: false,
      currentDigest,
      result,
    },
  };
}

function checkSources({
  projectRoot,
  slug = null,
  reader = createGhReader(),
  now = new Date().toISOString(),
}) {
  const loaded = loadRecords(projectRoot);
  if (!loaded.ok)
    return { ok: false, diagnostics: loaded.diagnostics, results: [], candidates: [] };
  const selected = selectTargets(loaded.records, slug, now);
  const results = selected.result ? [selected.result] : [];
  const candidates = [];
  for (const record of selected.targets) {
    const checked = checkRecord({ projectRoot, record, reader, now });
    results.push(checked.result);
    if (checked.candidate) candidates.push(checked.candidate);
  }
  return { ok: true, diagnostics: [], results, candidates };
}

module.exports = {
  checkRecord,
  checkSources,
  loadRecords,
  prepareCandidate,
  selectTargets,
};
