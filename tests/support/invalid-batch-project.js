const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { digestTree, makeTempProject, sha256 } = require('./fixtures');

const validMarkdown = [
  '---',
  'name: 合法样例',
  'description: 合法输入',
  'version: "1.0.0"',
  '---',
  '',
  '# 合法样例',
  '',
  '正文。',
  '',
].join('\n');

function buildSite(options) {
  const { buildSite: build } = require('../../scripts/lib/build-site');
  return build(options);
}

function writeAssets(project) {
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
}

function writeRecord(project, fileName, slug, overrides = {}) {
  const record = {
    schemaVersion: 1,
    slug,
    display_name: slug,
    description: '样例',
    tags: [],
    platforms: [],
    source_tracking: null,
    ...overrides,
  };
  fs.writeFileSync(
    path.join(project.root, 'catalog', `${fileName}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
  );
}

async function makeValidProject(t) {
  const project = makeTempProject();
  t.after(() => project.cleanup());
  writeAssets(project);
  fs.writeFileSync(path.join(project.skillsDir, 'sample.md'), validMarkdown);
  writeRecord(project, 'sample', 'sample', {
    display_name: '合法样例',
    description: '合法输入',
    content_path: 'skills/sample.md',
  });
  const built = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
  const dist = path.join(project.root, 'dist');
  fs.writeFileSync(path.join(dist, 'old-sentinel.txt'), 'old snapshot\n');
  return {
    project,
    dist,
    manifestHash: sha256(fs.readFileSync(path.join(dist, 'manifest.json'))),
    sentinelHash: sha256(fs.readFileSync(path.join(dist, 'old-sentinel.txt'))),
  };
}

function snapshotInputs(project) {
  return {
    skills: digestTree(project.skillsDir),
    catalog: digestTree(path.join(project.root, 'catalog')),
  };
}

async function expectFailure(t, prepare, expectedCodes) {
  const base = await makeValidProject(t);
  prepare(base);
  const before = snapshotInputs(base.project);
  const result = await buildSite({ projectRoot: base.project.root, outputName: 'dist' });
  assert.equal(result.ok, false);
  for (const code of expectedCodes) {
    assert.ok(
      result.diagnostics.some((item) => item.code === code),
      `${code}: ${JSON.stringify(result.diagnostics)}`,
    );
  }
  assert.deepEqual(snapshotInputs(base.project), before);
  assert.equal(sha256(fs.readFileSync(path.join(base.dist, 'manifest.json'))), base.manifestHash);
  assert.equal(
    sha256(fs.readFileSync(path.join(base.dist, 'old-sentinel.txt'))),
    base.sentinelHash,
  );
}

module.exports = {
  buildSite,
  expectFailure,
  makeValidProject,
  snapshotInputs,
  validMarkdown,
  writeAssets,
  writeRecord,
};
