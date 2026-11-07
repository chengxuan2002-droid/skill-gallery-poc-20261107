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

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function steps(job) {
  return job && Array.isArray(job.steps) ? job.steps : [];
}

test('deploy job checks freshness before deploying and preserves the previous site', () => {
  const workflow = readWorkflow();
  const deploy = workflow.jobs.deploy;
  assert.ok(deploy, 'deploy job is missing');
  assert.ok(asArray(deploy.needs).includes('build'));
  assert.equal(deploy.environment.name || deploy.environment, 'github-pages');
  assert.equal(deploy.concurrency.group, 'pages');
  assert.notEqual(deploy['continue-on-error'], true);

  const deploySteps = steps(deploy);
  for (const step of deploySteps) {
    assert.notEqual(step['continue-on-error'], true, step.name || step.uses);
  }

  const freshnessIndex = deploySteps.findIndex((step) =>
    /publish-check\.js\s+target/.test(String(step.run || '')),
  );
  const deployIndex = deploySteps.findIndex((step) =>
    String(step.uses || '').startsWith('actions/deploy-pages@'),
  );
  assert.ok(freshnessIndex >= 0, 'deploy job is missing the target freshness check');
  assert.ok(deployIndex > freshnessIndex, 'target check must run before deploy-pages');
  assert.match(
    String(deploySteps[deployIndex].if || ''),
    /steps\.freshness\.outputs\.decision\s*==\s*'current'/,
  );

  const commands = deploySteps.map((step) => String(step.run || '')).join('\n');
  assert.doesNotMatch(commands, /\brm\s+-rf\b|\bgit\s+push\b|\bgit\s+reset\b|\bgit\s+clean\b/i);
  assert.doesNotMatch(commands, /\b(?:delete|rollback)\b/i);

  const actionUses = deploySteps.map((step) => String(step.uses || '')).filter(Boolean);
  assert.equal(
    actionUses.some((value) => /delete|rollback/i.test(value)),
    false,
  );
});
