'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createRunStatus, renderSummary } = require('../../scripts/lib/publish');

const SHA = 'a'.repeat(40);

function statusInput(overrides = {}) {
  return {
    runId: 'run-1',
    trigger: 'push',
    targetSha: SHA,
    commitStatus: 'not_applicable',
    contentRevision: 'rev-1',
    contentStatus: 'built',
    deployStatus: 'pending',
    reason: null,
    startedAt: null,
    finishedAt: null,
    runUrl: null,
    ...overrides,
  };
}

function createStatus(overrides = {}) {
  const result = createRunStatus(statusInput(overrides));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result.status;
}

test('keeps successful content and failed deployment as separate statuses', () => {
  const status = createStatus({
    commitStatus: 'committed',
    deployStatus: 'failed',
    reason: 'E_DEPLOY_FAILED',
  });

  assert.equal(status.commit_status, 'committed');
  assert.equal(status.content_status, 'built');
  assert.equal(status.deploy_status, 'failed');
  assert.equal(status.reason, 'E_DEPLOY_FAILED');
});

test('keeps superseded as a distinct non-published deployment state', () => {
  const status = createStatus({ deployStatus: 'superseded' });
  const summary = renderSummary(status);

  assert.equal(status.deploy_status, 'superseded');
  assert.notEqual(status.deploy_status, 'published');
  assert.equal(Object.hasOwn(status, 'success'), false);
  assert.match(summary, /Deploy status: superseded/);
  assert.doesNotMatch(summary, /Deploy status: published/);
});

test('accepts only the documented commit statuses', () => {
  for (const value of ['not_applicable', 'committed', 'failed']) {
    const result = createRunStatus(statusInput({ commitStatus: value }));
    assert.equal(result.ok, true, value);
    assert.equal(result.status.commit_status, value);
  }

  for (const value of ['pending', 'success', 'published', 'unknown', null]) {
    const result = createRunStatus(statusInput({ commitStatus: value }));
    assert.equal(result.ok, false, String(value));
    assert.equal(result.diagnostics[0].code, 'E_STATUS_INPUT');
  }
});

test('allows null times but rejects values that are not ISO 8601', () => {
  const nullTimes = createRunStatus(statusInput());
  assert.equal(nullTimes.ok, true, JSON.stringify(nullTimes.diagnostics));
  assert.equal(nullTimes.status.started_at, null);
  assert.equal(nullTimes.status.finished_at, null);

  const validTimes = createRunStatus(
    statusInput({
      startedAt: '2026-11-07T00:00:00Z',
      finishedAt: '2026-11-07T00:01:00+08:00',
    }),
  );
  assert.equal(validTimes.ok, true, JSON.stringify(validTimes.diagnostics));

  for (const value of ['yesterday', '2026-11-07', '', 'not-a-date']) {
    const result = createRunStatus(statusInput({ startedAt: value }));
    assert.equal(result.ok, false, value);
    assert.equal(result.diagnostics[0].code, 'E_STATUS_INPUT');
  }
});

test('rejects unknown fields, unknown enums and free-form failure reasons', () => {
  const unknownKey = createRunStatus({ ...statusInput(), secret: 'YOUR_API_KEY_HERE' });
  assert.equal(unknownKey.ok, false);
  assert.equal(unknownKey.diagnostics[0].code, 'E_STATUS_INPUT');

  const invalidValues = [
    { trigger: 'manual' },
    { contentStatus: 'ready' },
    { deployStatus: 'success' },
    { reason: 'deployment failed' },
  ];
  for (const overrides of invalidValues) {
    const result = createRunStatus(statusInput(overrides));
    assert.equal(result.ok, false, JSON.stringify(overrides));
    assert.equal(result.diagnostics[0].code, 'E_STATUS_INPUT');
  }
});

test('renders separated statuses without echoing credentials or response bodies', () => {
  const status = createStatus({
    commitStatus: 'committed',
    deployStatus: 'failed',
    reason: 'E_DEPLOY_FAILED',
  });
  const summary = renderSummary({
    ...status,
    token: 'YOUR_API_KEY_HERE',
    response_body: 'raw upstream response',
    run_url: 'https://user:YOUR_API_KEY_HERE@example.com/actions/runs/1',
  });

  assert.match(summary, /Commit status: committed/);
  assert.match(summary, /Content status: built/);
  assert.match(summary, /Deploy status: failed/);
  assert.match(summary, /Reason: E_DEPLOY_FAILED/);
  assert.match(summary, /Run: run-1/);
  assert.doesNotMatch(summary, /YOUR_API_KEY_HERE/);
  assert.doesNotMatch(summary, /raw upstream response/);
});
