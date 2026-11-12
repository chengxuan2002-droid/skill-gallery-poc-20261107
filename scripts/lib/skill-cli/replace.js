'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { validateCatalogRecord } = require('../catalog-schema');
const { buildCandidate, readMetaRecord, snapshotFromRoot } = require('./candidate');
const {
  commitFiles,
  createBaseline,
  pushBaseline,
  removeSkill,
  writeFiles,
} = require('./workspace');

function failure(code, message, target = null, extra = {}) {
  return { ok: false, diagnostics: [{ code, path: target, message, ...extra }] };
}

function readExistingRecord(root, slug) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'catalog', `${slug}.json`), 'utf8'));
    const validated = validateCatalogRecord(raw);
    return validated.ok ? validated.record : null;
  } catch {
    return null;
  }
}

function noopOutcome(candidate) {
  return {
    status: 'noop',
    slug: candidate.slug,
    content_revision: candidate.digest,
    content_status: 'noop',
    deploy_status: 'pending',
    commit_sha: null,
    run_url: null,
    public_url: null,
  };
}

function replaceCandidate({ projectRoot, slug, inputPath, metaPath, expectedRevision }) {
  const baseline = createBaseline(projectRoot);
  try {
    if (baseline.head !== expectedRevision) {
      return failure('E_CONFLICT', '期望基线不匹配', `catalog/${slug}.json`, {
        expected: expectedRevision,
        actual: baseline.head,
      });
    }
    const existingRecord = readExistingRecord(baseline.root, slug);
    if (!existingRecord || existingRecord.slug !== slug) {
      return failure('E_CONFLICT', 'slug 不存在或记录无效', `catalog/${slug}.json`);
    }

    let record = existingRecord;
    if (metaPath) {
      const meta = readMetaRecord(metaPath);
      if (!meta.ok) return meta;
      if (meta.record.slug !== slug) {
        return failure('E_SCHEMA', '--meta 的 slug 与 replace 参数不一致', metaPath);
      }
      record = meta.record;
    }

    const built = buildCandidate({ inputPath, record });
    if (!built.ok) return built;
    const candidate = built.candidate;
    const existing = snapshotFromRoot(baseline.root, existingRecord);
    if (
      existing &&
      existing.digest === candidate.digest &&
      existing.recordDigest === candidate.recordDigest
    ) {
      return { ok: true, outcome: noopOutcome(candidate) };
    }

    removeSkill(baseline.root, slug);
    writeFiles(baseline.root, candidate.files, record);
    const commitSha = commitFiles({
      root: baseline.root,
      files: candidate.files,
      record,
      replace: true,
    });
    try {
      pushBaseline(baseline.root, baseline.branch);
    } catch {
      return failure('E_CONFLICT', '远端基线已变化或推送被拒绝');
    }
    return {
      ok: true,
      outcome: {
        status: 'submitted',
        slug: candidate.slug,
        content_revision: null,
        content_status: 'pending',
        deploy_status: 'pending',
        commit_sha: commitSha,
        run_url: null,
        public_url: null,
      },
    };
  } finally {
    baseline.cleanup();
  }
}

module.exports = { replaceCandidate };
