'use strict';

const { createGhReader } = require('./github-source');
const { createReport } = require('./source-sync-report');
const { applyCandidates } = require('./source-sync-apply');
const { checkRecord, checkSources, loadRecords, selectTargets } = require('./source-sync-check');

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
  applyCandidates,
  checkRecord,
  checkSources,
  loadRecords,
  runSync,
  selectTargets,
};
