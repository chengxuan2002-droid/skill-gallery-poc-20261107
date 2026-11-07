'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createSummaryStatus,
  renderSummaryFromEnv,
  writeSummary,
} = require('../../scripts/lib/publish-summary');

const SHA = 'a'.repeat(40);
const RUN_URL = 'https://github.com/example/skill-gallery/actions/runs/1';

function env(overrides = {}) {
  return {
    PUBLISH_RUN_ID: 'run-1',
    PUBLISH_TRIGGER: 'push',
    PUBLISH_TARGET_SHA: SHA,
    PUBLISH_COMMIT_STATUS: 'not_applicable',
    PUBLISH_CONTENT_REVISION: 'rev-1',
    PUBLISH_JOB_STATUS: 'success',
    PUBLISH_RUN_URL: RUN_URL,
    ...overrides,
  };
}

function statusOf(envValue) {
  const result = createSummaryStatus(envValue);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result.status;
}

test('build success records built content with deployment pending', () => {
  const status = statusOf(env({ PUBLISH_PHASE: 'build' }));
  const summary = renderSummaryFromEnv(env({ PUBLISH_PHASE: 'build' }));

  assert.equal(status.content_status, 'built');
  assert.equal(status.deploy_status, 'pending');
  assert.equal(status.reason, null);
  assert.match(summary, /Content status: built/);
  assert.match(summary, /Deploy status: pending/);
  assert.match(summary, /Run: https:\/\/github\.com\/example\/skill-gallery\/actions\/runs\/1/);
});

test('build failure records failed content without fabricating a deployment', () => {
  const envValue = env({
    PUBLISH_PHASE: 'build',
    PUBLISH_JOB_STATUS: 'failure',
    PUBLISH_CONTENT_REVISION: null,
  });
  const status = statusOf(envValue);
  const summary = renderSummaryFromEnv(envValue);

  assert.equal(status.content_status, 'failed');
  assert.equal(status.deploy_status, 'pending');
  assert.equal(status.reason, 'E_BUILD_FAILED');
  assert.match(summary, /Content status: failed/);
  assert.match(summary, /Reason: E_BUILD_FAILED/);
});

test('build success with a later publish failure keeps content built', () => {
  const envValue = env({
    PUBLISH_PHASE: 'build',
    PUBLISH_CONTENT_STATUS: 'built',
    PUBLISH_JOB_STATUS: 'failure',
  });
  const status = statusOf(envValue);

  assert.equal(status.content_status, 'built');
  assert.equal(status.deploy_status, 'pending');
  assert.equal(status.reason, 'E_PUBLISH_FAILED');
});

test('deploy success and failure use distinct deployment states', () => {
  const published = statusOf(
    env({
      PUBLISH_PHASE: 'deploy',
      PUBLISH_CONTENT_STATUS: 'built',
      PUBLISH_DEPLOY_DECISION: 'current',
      PUBLISH_DEPLOY_OUTCOME: 'success',
    }),
  );
  assert.equal(published.content_status, 'built');
  assert.equal(published.deploy_status, 'published');
  assert.equal(published.reason, null);

  const failedEnv = env({
    PUBLISH_PHASE: 'deploy',
    PUBLISH_CONTENT_STATUS: 'built',
    PUBLISH_DEPLOY_DECISION: 'current',
    PUBLISH_DEPLOY_OUTCOME: 'failure',
    PUBLISH_JOB_STATUS: 'failure',
  });
  const failed = statusOf(failedEnv);
  assert.equal(failed.deploy_status, 'failed');
  assert.equal(failed.reason, 'E_DEPLOY_FAILED');
  assert.match(renderSummaryFromEnv(failedEnv), /Deploy status: failed/);
});

test('superseded is rendered as a non-published state', () => {
  const envValue = env({
    PUBLISH_PHASE: 'deploy',
    PUBLISH_CONTENT_STATUS: 'built',
    PUBLISH_DEPLOY_DECISION: 'superseded',
    PUBLISH_DEPLOY_OUTCOME: 'skipped',
  });
  const status = statusOf(envValue);
  const summary = renderSummaryFromEnv(envValue);

  assert.equal(status.deploy_status, 'superseded');
  assert.equal(status.reason, 'E_SUPERSEDED');
  assert.match(summary, /Deploy status: superseded/);
  assert.doesNotMatch(summary, /Deploy status: published/);
});

test('writes the summary and an optional safe page URL without extra secrets', (t) => {
  const target = path.join(os.tmpdir(), `publish-summary-${process.pid}.md`);
  fs.rmSync(target, { force: true });
  t.after(() => fs.rmSync(target, { force: true }));

  const envValue = env({
    PUBLISH_PHASE: 'deploy',
    PUBLISH_CONTENT_STATUS: 'built',
    PUBLISH_DEPLOY_DECISION: 'current',
    PUBLISH_DEPLOY_OUTCOME: 'success',
    PUBLISH_PAGE_URL: 'https://chengxuan2002-droid.github.io/skill-gallery/',
    PUBLISH_TOKEN: 'YOUR_API_KEY_HERE',
    GITHUB_STEP_SUMMARY: target,
  });
  const summary = writeSummary(envValue);
  const written = fs.readFileSync(target, 'utf8');

  assert.match(summary, /Page: https:\/\/chengxuan2002-droid\.github\.io\/skill-gallery\//);
  assert.match(written, /Deploy status: published/);
  assert.doesNotMatch(written, /YOUR_API_KEY_HERE/);
});

test('rejects incomplete environment and unsafe page URLs', (t) => {
  assert.throws(
    () => renderSummaryFromEnv(env({ PUBLISH_TARGET_SHA: '', PUBLISH_PHASE: 'build' })),
    (error) => error.code === 'E_SUMMARY_ENV',
  );

  const target = path.join(os.tmpdir(), `publish-summary-unsafe-${process.pid}.md`);
  fs.rmSync(target, { force: true });
  t.after(() => fs.rmSync(target, { force: true }));
  const summary = writeSummary(
    env({
      PUBLISH_PHASE: 'deploy',
      PUBLISH_CONTENT_STATUS: 'built',
      PUBLISH_DEPLOY_DECISION: 'current',
      PUBLISH_DEPLOY_OUTCOME: 'success',
      PUBLISH_PAGE_URL: 'https://user:YOUR_API_KEY_HERE@example.com/',
      GITHUB_STEP_SUMMARY: target,
    }),
  );
  assert.doesNotMatch(summary, /YOUR_API_KEY_HERE/);
  assert.doesNotMatch(fs.readFileSync(target, 'utf8'), /YOUR_API_KEY_HERE/);
});
