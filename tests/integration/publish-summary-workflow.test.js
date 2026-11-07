'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const YAML = require('yaml');

const root = path.resolve(__dirname, '../..');
const workflowPath = path.join(root, '.github/workflows/maintain.yml');

function readWorkflow() {
  return YAML.parse(fs.readFileSync(workflowPath, 'utf8'));
}

function steps(job) {
  return job && Array.isArray(job.steps) ? job.steps : [];
}

function stepIndex(stepsList, name) {
  return stepsList.findIndex((step) => step.name === name);
}

function assertEnv(step, keys) {
  for (const key of keys) {
    assert.equal(typeof step.env?.[key], 'string', `${step.name} is missing ${key}`);
  }
}

test('build and deploy steps write complete RunStatus summaries', () => {
  const workflow = readWorkflow();
  const build = workflow.jobs.build;
  const deploy = workflow.jobs.deploy;
  assert.ok(build);
  assert.ok(deploy);
  assert.equal(build.outputs.content_revision, '${{ steps.content.outputs.revision }}');

  const buildSteps = steps(build);
  const buildSummaryIndex = stepIndex(buildSteps, 'Write build summary');
  const uploadIndex = buildSteps.findIndex((step) =>
    String(step.uses || '').startsWith('actions/upload-pages-artifact@'),
  );
  assert.ok(buildSummaryIndex > uploadIndex, 'build summary must run after artifact upload');

  const buildSummary = buildSteps[buildSummaryIndex];
  assert.equal(buildSummary.if, 'always()');
  assert.equal(buildSummary.run, 'node scripts/publish-summary.js');
  assert.equal(buildSummary.env.PUBLISH_PHASE, 'build');
  assertEnv(buildSummary, [
    'PUBLISH_RUN_ID',
    'PUBLISH_TRIGGER',
    'PUBLISH_TARGET_SHA',
    'PUBLISH_COMMIT_STATUS',
    'PUBLISH_CONTENT_REVISION',
    'PUBLISH_CONTENT_STATUS',
    'PUBLISH_JOB_STATUS',
    'PUBLISH_RUN_URL',
  ]);
  assert.match(buildSummary.env.PUBLISH_CONTENT_REVISION, /steps\.content\.outputs\.revision/);
  assert.match(buildSummary.env.PUBLISH_CONTENT_STATUS, /steps\.build\.outcome/);

  const deploySteps = steps(deploy);
  const deploySummaryIndex = stepIndex(deploySteps, 'Write publish summary');
  const deployIndex = deploySteps.findIndex((step) =>
    String(step.uses || '').startsWith('actions/deploy-pages@'),
  );
  assert.ok(deploySummaryIndex > deployIndex, 'deploy summary must run after the deploy step');

  const deploySummary = deploySteps[deploySummaryIndex];
  assert.equal(deploySummary.if, 'always()');
  assert.equal(deploySummary.run, 'node scripts/publish-summary.js');
  assert.equal(deploySummary.env.PUBLISH_PHASE, 'deploy');
  assert.equal(deploySummary.env.PUBLISH_CONTENT_STATUS, 'built');
  assertEnv(deploySummary, [
    'PUBLISH_RUN_ID',
    'PUBLISH_TRIGGER',
    'PUBLISH_TARGET_SHA',
    'PUBLISH_COMMIT_STATUS',
    'PUBLISH_CONTENT_REVISION',
    'PUBLISH_DEPLOY_DECISION',
    'PUBLISH_DEPLOY_OUTCOME',
    'PUBLISH_JOB_STATUS',
    'PUBLISH_RUN_URL',
    'PUBLISH_PAGE_URL',
  ]);
  assert.match(
    deploySummary.env.PUBLISH_CONTENT_REVISION,
    /needs\.build\.outputs\.content_revision/,
  );
  assert.match(deploySummary.env.PUBLISH_DEPLOY_DECISION, /steps\.freshness\.outputs\.decision/);
  assert.match(deploySummary.env.PUBLISH_DEPLOY_OUTCOME, /steps\.deployment\.outcome/);
  assert.match(deploySummary.env.PUBLISH_PAGE_URL, /steps\.deployment\.outputs\.page_url/);

  const inlineSummarySteps = [...buildSteps, ...deploySteps].filter((step) =>
    String(step.run || '').includes('GITHUB_STEP_SUMMARY'),
  );
  assert.deepEqual(inlineSummarySteps, []);
});
