'use strict';

const fs = require('node:fs');

const STATUSES = new Set([
  'unchanged',
  'candidate',
  'updated',
  'failed',
  'conflict',
  'policy_blocked',
  'unsupported',
]);
const COMMIT_STATUSES = new Set(['not_applicable', 'committed', 'failed']);
const CONTENT_STATUSES = new Set(['pending', 'built', 'noop', 'failed']);
const DEPLOY_STATUSES = new Set(['pending', 'deploying', 'published', 'failed', 'superseded']);
const LICENSE_STATUSES = new Set(['present', 'missing', 'changed', 'not_applicable']);

function timestamp(value) {
  if (typeof value !== 'string') return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function short(value, length = 12) {
  if (typeof value !== 'string') return '';
  return value.length > length ? value.slice(0, length) : value;
}

function closedSource(item = {}) {
  const source = item.source ?? {};
  return {
    slug: item.slug ?? null,
    source: {
      provider: source.provider ?? null,
      repository: source.repository ?? null,
      path: source.path ?? null,
      ref_policy: source.ref_policy ?? null,
      ref: source.ref ?? null,
      enabled: Boolean(source.enabled),
    },
    status: STATUSES.has(item.status) ? item.status : 'failed',
    resolved_revision: item.resolved_revision ?? null,
    content_digest: item.content_digest ?? null,
    previous_digest: item.previous_digest ?? null,
    license_status: LICENSE_STATUSES.has(item.license_status)
      ? item.license_status
      : 'not_applicable',
    error_code: typeof item.error_code === 'string' ? item.error_code : null,
    checked_at: timestamp(item.checked_at),
  };
}

function closedError(item = {}) {
  return {
    code: typeof item.code === 'string' ? item.code : 'E_SYNC',
    path: typeof item.path === 'string' ? item.path : null,
  };
}

function createReport({
  runId,
  trigger = 'manual',
  startedAt = null,
  finishedAt = null,
  changed = false,
  commitSha = null,
  commitStatus = 'not_applicable',
  contentStatus = 'noop',
  deployStatus = 'pending',
  sources = [],
  errors = [],
} = {}) {
  return {
    run_id: typeof runId === 'string' && runId.length > 0 ? runId : 'local',
    trigger: ['push', 'schedule', 'workflow_dispatch', 'manual'].includes(trigger)
      ? trigger
      : 'manual',
    started_at: timestamp(startedAt),
    finished_at: timestamp(finishedAt),
    changed: Boolean(changed),
    commit_sha:
      typeof commitSha === 'string' && /^[0-9a-f]{40}$/.test(commitSha) ? commitSha : null,
    commit_status: COMMIT_STATUSES.has(commitStatus) ? commitStatus : 'failed',
    content_status: CONTENT_STATUSES.has(contentStatus) ? contentStatus : 'failed',
    deploy_status: DEPLOY_STATUSES.has(deployStatus) ? deployStatus : 'pending',
    sources: Array.isArray(sources) ? sources.map(closedSource) : [],
    errors: Array.isArray(errors) ? errors.map(closedError) : [],
  };
}

function renderSummary(report) {
  const lines = [
    '### Source sync',
    '',
    `- Run: ${report.run_id}`,
    `- Trigger: ${report.trigger}`,
    `- Changed: ${report.changed ? 'yes' : 'no'}`,
    `- Commit: ${report.commit_status}${report.commit_sha ? ` ${short(report.commit_sha)}` : ''}`,
    `- Content: ${report.content_status}`,
    `- Deploy: ${report.deploy_status}`,
  ];
  if (report.sources.length > 0) {
    lines.push(
      '',
      '| Slug | Status | Revision | Digest | License | Error |',
      '| --- | --- | --- | --- | --- | --- |',
    );
    for (const item of report.sources) {
      lines.push(
        `| ${item.slug ?? ''} | ${item.status} | ${short(item.resolved_revision)} | ` +
          `${short(item.content_digest)} | ${item.license_status} | ${item.error_code ?? ''} |`,
      );
    }
  }
  if (report.errors.length > 0) {
    lines.push('', `Errors: ${report.errors.map((item) => item.code).join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}

function writeReport(target, report) {
  if (!target) return;
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
}

function writeSummary(target, report) {
  if (!target) return;
  fs.appendFileSync(target, `${renderSummary(report)}\n`);
}

module.exports = {
  createReport,
  renderSummary,
  writeReport,
  writeSummary,
};
