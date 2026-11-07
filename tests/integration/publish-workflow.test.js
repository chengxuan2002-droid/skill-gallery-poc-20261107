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

function uses(stepsList) {
  return stepsList.map((step) => step.uses).filter(Boolean);
}

test('maintain workflow has the required triggers, permissions, concurrency and pinned actions', () => {
  const text = fs.readFileSync(workflowPath, 'utf8');
  const workflow = readWorkflow();

  assert.deepEqual(Object.keys(workflow.on).sort(), ['push', 'workflow_dispatch']);
  assert.deepEqual(asArray(workflow.on.push.branches), ['main']);
  assert.equal(workflow.on.workflow_dispatch !== undefined, true);
  assert.equal(workflow.on.pull_request, undefined);
  assert.equal(workflow.on.pull_request_target, undefined);
  assert.equal(workflow.on.workflow_run, undefined);

  assert.equal(workflow.permissions.contents, 'read');
  assert.equal(workflow.concurrency.group, 'maintain-${{ github.ref }}');
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.equal(text.includes('pull_request_target'), false);
  assert.equal(/secrets\./.test(text), false);

  const build = workflow.jobs.build;
  const deploy = workflow.jobs.deploy;
  assert.ok(build);
  assert.ok(deploy);
  assert.equal(build['timeout-minutes'], 30);
  assert.equal(deploy['timeout-minutes'], 10);

  const buildSteps = steps(build);
  const checkout = buildSteps.find((step) =>
    String(step.uses || '').startsWith('actions/checkout@'),
  );
  assert.ok(checkout);
  assert.equal(checkout.with['persist-credentials'], false);

  const commands = buildSteps.map((step) => String(step.run || '')).join('\n');
  assert.match(commands, /npm run check/);
  assert.match(commands, /npm run security/);
  assert.match(commands, /npm run build/);
  assert.match(commands, /publish-check\.js artifact --dist dist/);

  const upload = buildSteps.find((step) =>
    String(step.uses || '').startsWith('actions/upload-pages-artifact@'),
  );
  assert.ok(upload);
  assert.equal(upload.with.path, 'dist');

  assert.deepEqual(asArray(deploy.needs), ['build']);
  assert.equal(deploy.environment.name || deploy.environment, 'github-pages');
  assert.equal(deploy.permissions.pages, 'write');
  assert.equal(deploy.permissions['id-token'], 'write');
  assert.equal(deploy.concurrency.group, 'pages');
  assert.equal(deploy.concurrency['cancel-in-progress'], false);
  assert.ok(
    steps(deploy).some((step) => String(step.uses || '').startsWith('actions/deploy-pages@')),
  );

  const allUses = [...uses(buildSteps), ...uses(steps(deploy))];
  assert.ok(allUses.length > 0);
  for (const value of allUses) {
    assert.match(value, /^[^@]+@[0-9a-f]{40}$/, value);
  }
});
