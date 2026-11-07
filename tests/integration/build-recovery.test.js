const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { makeTempProject, sha256 } = require('../support/fixtures');
const { buildSite } = require('../support/invalid-batch-project');

function writeTransaction(projectRoot, value) {
  fs.writeFileSync(path.join(projectRoot, '.dist.transaction.json'), JSON.stringify(value));
}

async function makeProject(t) {
  const project = makeTempProject();
  t.after(() => project.cleanup());
  fs.mkdirSync(path.join(project.root, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(project.root, 'catalog'), { recursive: true });
  fs.writeFileSync(
    path.join(project.root, 'index.html'),
    '<!doctype html><title>Skill Gallery</title><script src="assets/app-search.js"></script><script src="assets/app.js"></script><main id="app"></main>',
  );
  fs.writeFileSync(path.join(project.root, 'assets/app.js'), 'globalThis.APP_LOADED = true;');
  fs.writeFileSync(
    path.join(project.root, 'assets/app-search.js'),
    'globalThis.SEARCH_LOADED = true;',
  );
  fs.writeFileSync(path.join(project.root, 'assets/app-dom.js'), 'globalThis.DOM_LOADED = true;');
  fs.writeFileSync(
    path.join(project.root, 'assets/app-filters.js'),
    'globalThis.FILTERS_LOADED = true;',
  );
  fs.writeFileSync(
    path.join(project.root, 'assets/app-views.js'),
    'globalThis.VIEWS_LOADED = true;',
  );
  fs.writeFileSync(
    path.join(project.root, 'assets/app-actions.js'),
    'globalThis.ACTIONS_LOADED = true;',
  );
  fs.writeFileSync(
    path.join(project.root, 'assets/app-detail.js'),
    'globalThis.DETAIL_LOADED = true;',
  );
  fs.writeFileSync(path.join(project.root, 'assets/style.css'), 'body { color: inherit; }');
  fs.writeFileSync(path.join(project.root, '.nojekyll'), '');
  fs.writeFileSync(path.join(project.skillsDir, 'sample.md'), '# sample\n');
  fs.writeFileSync(
    path.join(project.root, 'catalog/sample.json'),
    JSON.stringify({
      schemaVersion: 1,
      slug: 'sample',
      display_name: 'sample',
      description: 'sample',
      tags: [],
      platforms: [],
      source_tracking: null,
      content_path: 'skills/sample.md',
    }),
  );
  const built = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
  return { project, dist: path.join(project.root, 'dist') };
}

function transaction(runId, phase, previous, candidate) {
  return {
    schemaVersion: 1,
    run_id: runId,
    output_name: 'dist',
    phase,
    had_previous: previous !== null,
    previous_manifest_sha256: previous,
    candidate_manifest_sha256: candidate,
  };
}

test('prepared transaction with dist missing restores backup before continuing', async (t) => {
  const { project, dist } = await makeProject(t);
  const runId = 'd'.repeat(32);
  const backup = path.join(project.root, `.dist.backup-${runId}`);
  fs.cpSync(dist, backup, { recursive: true });
  const previous = sha256(fs.readFileSync(path.join(dist, 'manifest.json')));
  fs.rmSync(dist, { recursive: true, force: true });
  writeTransaction(project.root, transaction(runId, 'prepared', previous, previous));
  const result = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(fs.existsSync(dist), true);
  assert.equal(fs.existsSync(backup), false);
  assert.equal(fs.existsSync(path.join(project.root, '.dist.transaction.json')), false);
});

test('prepared transaction with candidate dist and old backup rolls back before continuing', async (t) => {
  const { project, dist } = await makeProject(t);
  const runId = 'e'.repeat(32);
  const backup = path.join(project.root, `.dist.backup-${runId}`);
  fs.cpSync(dist, backup, { recursive: true });
  const previous = sha256(fs.readFileSync(path.join(dist, 'manifest.json')));
  fs.appendFileSync(path.join(project.skillsDir, 'sample.md'), '\nsecond\n');
  const rebuilt = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(rebuilt.ok, true, JSON.stringify(rebuilt.diagnostics));
  const candidate = sha256(fs.readFileSync(path.join(dist, 'manifest.json')));
  writeTransaction(project.root, transaction(runId, 'promoting', previous, candidate));
  const result = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(fs.existsSync(backup), false);
  assert.equal(fs.existsSync(path.join(project.root, `.dist.stage-${runId}`)), false);
  assert.equal(fs.existsSync(path.join(project.root, '.dist.transaction.json')), false);
});

test('a candidate with a corrupt artifact is not recovered or deleted', async (t) => {
  const { project, dist } = await makeProject(t);
  const runId = '1'.repeat(32);
  const stage = path.join(project.root, `.dist.stage-${runId}`);
  fs.cpSync(dist, stage, { recursive: true });
  const previous = sha256(fs.readFileSync(path.join(dist, 'manifest.json')));
  fs.writeFileSync(path.join(stage, 'assets/app.js'), 'corrupt candidate');
  writeTransaction(project.root, transaction(runId, 'prepared', previous, previous));
  const result = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((item) => item.code === 'E_RECOVERY_REQUIRED'));
  assert.equal(fs.existsSync(stage), true);
  assert.equal(fs.existsSync(path.join(project.root, '.dist.transaction.json')), true);
});

test('prepared first-build transaction without previous output cleans its candidate', async (t) => {
  const { project, dist } = await makeProject(t);
  const runId = 'f'.repeat(32);
  const stage = path.join(project.root, `.dist.stage-${runId}`);
  fs.cpSync(dist, stage, { recursive: true });
  const candidate = sha256(fs.readFileSync(path.join(dist, 'manifest.json')));
  fs.rmSync(dist, { recursive: true, force: true });
  writeTransaction(project.root, transaction(runId, 'prepared', null, candidate));
  const result = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(fs.existsSync(stage), false);
  assert.equal(fs.existsSync(path.join(project.root, '.dist.transaction.json')), false);
});
