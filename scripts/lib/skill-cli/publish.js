'use strict';

const { snapshotFromRoot } = require('./candidate');
const { commitFiles, createBaseline, pushBaseline, writeFiles } = require('./workspace');

function success(outcome) {
  return { ok: true, outcome };
}

function failure(code, message, target = null) {
  return { ok: false, diagnostics: [{ code, path: target, message }] };
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

function publishCandidate({ projectRoot, candidate }) {
  const baseline = createBaseline(projectRoot);
  try {
    const existing = snapshotFromRoot(baseline.root, candidate.record);
    if (existing) {
      if (existing.digest === candidate.digest) return success(noopOutcome(candidate));
      return failure(
        'E_CONFLICT',
        '已存在同 slug 的不同内容，请使用 replace',
        `catalog/${candidate.slug}.json`,
      );
    }

    writeFiles(baseline.root, candidate.files, candidate.record);
    const commitSha = commitFiles({
      root: baseline.root,
      files: candidate.files,
      record: candidate.record,
    });
    try {
      pushBaseline(baseline.root, baseline.branch);
    } catch {
      return failure('E_CONFLICT', '远端基线已变化或推送被拒绝');
    }
    return success({
      status: 'submitted',
      slug: candidate.slug,
      content_revision: null,
      content_status: 'pending',
      deploy_status: 'pending',
      commit_sha: commitSha,
      run_url: null,
      public_url: null,
    });
  } finally {
    baseline.cleanup();
  }
}

module.exports = { publishCandidate };
