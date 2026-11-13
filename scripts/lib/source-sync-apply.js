'use strict';

const { snapshotSkill } = require('./content-store');
const {
  commitBatch,
  createBaseline,
  pushBaseline,
  removeSkill,
  writeFiles,
} = require('./skill-cli/workspace');

function failure(code, message, target = null) {
  return { code, path: target, message };
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
  const outcomes = [];
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
        outcomes.push(item);
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
          last_synced_license: item.candidate.license ?? null,
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
        content_digest: item.candidate.digest,
      };
      applied.push(item);
      outcomes.push(item);
    }
    if (applied.length === 0) {
      return { ok: true, changed: false, commitSha: null, results: outcomes };
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
          results: outcomes,
          diagnostics: [failure('E_CONFLICT', '远端基线已变化或推送被拒绝')],
        };
      }
    }
    return { ok: true, changed: true, commitSha, results: outcomes };
  } finally {
    baseline.cleanup();
  }
}

module.exports = { applyCandidates };
