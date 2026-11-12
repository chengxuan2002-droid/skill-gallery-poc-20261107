'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validateCatalogRecord } = require('./catalog-schema');
const { computeDigest, snapshotSkill } = require('./content-store');
const { createGhReader, fetchSource, findLicense } = require('./github-source');
const { createReport } = require('./source-sync-report');
const { buildCandidate } = require('./skill-cli/candidate');
const {
  commitBatch,
  createBaseline,
  pushBaseline,
  removeSkill,
  writeFiles,
} = require('./skill-cli/workspace');

const LIMITS = Object.freeze({ maxFiles: 500, maxTotalBytes: 20 * 1024 * 1024 });

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

function writeSource(root, files) {
  for (const [relativePath, bytes] of files) {
    const target = path.join(root, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
}

function prepareCandidate({ record, fetched }) {
  const directory = fetched.files.size > 1 || fetched.files.has('SKILL.md');
  const targetRecord = {
    ...record,
    content_path: directory ? `skills/${record.slug}/SKILL.md` : `skills/${record.slug}.md`,
  };
  const single = !directory;
  if (single && fetched.files.size !== 1) {
    return { ok: false, diagnostics: [failure('E_PATH', '单文件来源必须只包含一个文件')] };
  }
  if (!single && !fetched.files.has('SKILL.md')) {
    return { ok: false, diagnostics: [failure('E_MAIN_MISSING', '目录来源缺少 SKILL.md')] };
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'source-sync-candidate-'));
  try {
    const inputPath = single
      ? path.join(temp, [...fetched.files.keys()][0])
      : path.join(temp, 'input');
    if (single) {
      fs.writeFileSync(inputPath, fetched.files.get([...fetched.files.keys()][0]));
    } else {
      writeSource(inputPath, fetched.files);
    }
    const built = buildCandidate({ inputPath, record: targetRecord });
    if (!built.ok) return built;

    const prefix = single ? `skills/${record.slug}.md` : `skills/${record.slug}/`;
    const files = built.candidate.files.map((file) => {
      const relativePath = single ? `${record.slug}.md` : file.path.slice(prefix.length);
      const mode = fetched.modes.get(relativePath) ?? '100644';
      return { ...file, executable: mode === '100755', mode };
    });
    const digest = computeDigest({
      files: files.map((file) => ({
        path: single ? `${record.slug}.md` : file.path.slice(prefix.length),
        sha256: file.sha256,
        executable: file.executable,
      })),
      directories: [],
    });
    return {
      ok: true,
      candidate: { ...built.candidate, files, digest, license: fetched.license },
    };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
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
    currentLicense &&
    (currentLicense.path !== candidateLicense.path ||
      currentLicense.sha256 !== candidateLicense.sha256)
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

function applyCandidates({ projectRoot, candidates, push, now, message }) {
  let baseline;
  try {
    baseline = createBaseline(projectRoot);
  } catch {
    return {
      ok: false,
      code: 'E_CONFLICT',
      diagnostics: [failure('E_CONFLICT', '无法建立干净基线')],
    };
  }
  const applied = [];
  const files = [];
  const records = [];
  try {
    for (const item of candidates) {
      const existing = snapshotSkill({ projectRoot: baseline.root, record: item.record });
      if (!existing.ok || existing.snapshot.digest !== item.currentDigest) {
        item.result = {
          ...item.result,
          status: 'conflict',
          error_code: 'E_CONFLICT_BASELINE',
        };
        continue;
      }
      const tracking = item.record.source_tracking;
      const record = {
        ...item.record,
        content_path: item.candidate.record.content_path,
        source_tracking: {
          ...tracking,
          last_synced_revision: item.result.resolved_revision,
          last_synced_digest: item.candidate.digest,
          synced_at: now,
        },
      };
      if (!item.baselineOnly) {
        removeSkill(baseline.root, record.slug);
        files.push(...item.candidate.files);
      }
      writeFiles(baseline.root, item.baselineOnly ? [] : item.candidate.files, record);
      records.push(record);
      item.result = {
        ...item.result,
        status: 'updated',
        resolved_revision: item.result.resolved_revision,
        content_digest: item.candidate.digest,
      };
      applied.push(item);
    }
    if (applied.length === 0) {
      return { ok: true, changed: false, commitSha: null, results: applied };
    }
    const commitSha = commitBatch({
      root: baseline.root,
      files,
      records,
      replace: true,
      message: message || `sync: update ${records.map((record) => record.slug).join(', ')}`,
    });
    if (push) {
      try {
        pushBaseline(baseline.root, baseline.branch, { expectedHead: baseline.head });
      } catch {
        return {
          ok: false,
          code: 'E_CONFLICT',
          changed: true,
          commitSha,
          results: applied,
          diagnostics: [failure('E_CONFLICT', '远端基线已变化或推送被拒绝')],
        };
      }
    }
    return { ok: true, changed: true, commitSha, results: applied };
  } finally {
    baseline.cleanup();
  }
}

function runSync({
  projectRoot,
  slug = null,
  apply = false,
  push = false,
  reader = createGhReader(),
  now = new Date().toISOString(),
  runId = 'local',
  trigger = 'manual',
}) {
  const checked = checkSources({ projectRoot, slug, reader, now });
  if (!checked.ok) {
    return {
      ok: false,
      exitCode: 2,
      report: createReport({
        runId,
        trigger,
        startedAt: now,
        finishedAt: new Date().toISOString(),
        sources: [],
        errors: checked.diagnostics,
        commitStatus: 'failed',
        contentStatus: 'failed',
      }),
      diagnostics: checked.diagnostics,
    };
  }

  if (!apply || checked.candidates.length === 0) {
    return {
      ok: true,
      exitCode: 0,
      report: createReport({
        runId,
        trigger,
        startedAt: now,
        finishedAt: new Date().toISOString(),
        sources: checked.results,
      }),
      diagnostics: [],
    };
  }

  const applied = applyCandidates({
    projectRoot,
    candidates: checked.candidates,
    push,
    now,
  });
  const results = checked.results.map((result) => {
    const item = applied.results?.find((entry) => entry.result.slug === result.slug);
    return item ? item.result : result;
  });
  const report = createReport({
    runId,
    trigger,
    startedAt: now,
    finishedAt: new Date().toISOString(),
    changed: applied.changed,
    commitSha: applied.commitSha,
    commitStatus: applied.changed ? 'committed' : 'not_applicable',
    contentStatus: applied.changed ? 'pending' : 'noop',
    sources: results,
    errors: applied.diagnostics ?? [],
  });
  return {
    ok: applied.ok,
    exitCode: applied.ok ? 0 : 4,
    report,
    diagnostics: applied.diagnostics ?? [],
  };
}

module.exports = {
  LIMITS,
  applyCandidates,
  checkRecord,
  checkSources,
  loadRecords,
  runSync,
  selectTargets,
};
