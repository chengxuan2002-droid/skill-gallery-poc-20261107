const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createSearchFixtureProject } = require('../support/search-fixture');

test('build copies app-search.js and includes it in contentRevision', async (t) => {
  const project = createSearchFixtureProject({ count: 2, totalBytes: 2000 });
  t.after(() => project.cleanup());
  const asset = path.join(project.root, 'assets/app-search.js');
  const firstContent = 'globalThis.SkillGallerySearch = { version: 1 };\n';
  fs.writeFileSync(asset, firstContent);

  const first = await project.buildPreview();
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  const builtAsset = path.join(first.distDir, 'assets/app-search.js');
  assert.equal(fs.readFileSync(builtAsset, 'utf8'), firstContent);

  const index = JSON.parse(
    fs.readFileSync(path.join(first.distDir, 'assets/search-index.json'), 'utf8'),
  );
  assert.equal(index.schemaVersion, 1);
  const detail = JSON.parse(
    fs.readFileSync(path.join(first.distDir, 'details/perf-0001.json'), 'utf8'),
  );
  assert.equal(detail.schemaVersion, 1);

  fs.writeFileSync(asset, 'globalThis.SkillGallerySearch = { version: 2 };\n');
  const second = await project.buildPreview();
  assert.equal(second.ok, true, JSON.stringify(second.diagnostics));
  assert.notEqual(second.contentRevision, first.contentRevision);
});

test('missing app-search.js fails the whole build', async (t) => {
  const project = createSearchFixtureProject({ count: 2, totalBytes: 2000 });
  t.after(() => project.cleanup());
  fs.rmSync(path.join(project.root, 'assets/app-search.js'));

  const result = await project.buildPreview();
  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  assert.equal(
    result.diagnostics.some((item) => item.path === 'assets/app-search.js'),
    true,
  );
});

test('build copies the DOM and filter modules and includes them in contentRevision', async (t) => {
  const project = createSearchFixtureProject({ count: 2, totalBytes: 2000 });
  t.after(() => project.cleanup());
  const assets = ['assets/app-dom.js', 'assets/app-filters.js'];
  const content = (version) => `globalThis.SKILL_GALLERY_MODULE = ${version};\n`;
  for (const relative of assets) fs.writeFileSync(path.join(project.root, relative), content(1));

  const first = await project.buildPreview();
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  for (const relative of assets) {
    assert.equal(fs.readFileSync(path.join(first.distDir, relative), 'utf8'), content(1));
  }

  fs.writeFileSync(path.join(project.root, 'assets/app-filters.js'), content(2));
  const second = await project.buildPreview();
  assert.equal(second.ok, true, JSON.stringify(second.diagnostics));
  assert.notEqual(second.contentRevision, first.contentRevision);
});
