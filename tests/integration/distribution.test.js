const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yauzl = require('yauzl');

const { makeTempProject, sha256 } = require('../support/fixtures');

const singleMarkdown = [
  '---',
  'name: 单文件样例',
  'description: 完整取用',
  'version: "1.2.3"',
  'metadata:',
  '  owner:',
  '    unknown: 保留',
  '---',
  '',
  '# 单文件',
  '',
  '中文与 `code`。',
  '',
  '```js',
  "const value = '保留';",
  '```',
  '',
  '| 列 | 值 |',
  '| --- | --- |',
  '| 一 | 二 |',
  '',
].join('\n');

const packMarkdown = [
  '---',
  'name: 目录样例',
  'description: 目录完整取用',
  'version: "2.0.0"',
  '---',
  '',
  '# 目录',
  '',
  '![图](assets/logo.png)',
  '',
  '阅读 [指南](references/guide.md)。',
  '',
].join('\n');

function buildSite(options) {
  const { buildSite: build } = require('../../scripts/lib/build-site');
  return build(options);
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

function makeProject() {
  const project = makeTempProject();
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

  fs.writeFileSync(path.join(project.skillsDir, 'single.md'), singleMarkdown);

  const pack = path.join(project.skillsDir, 'pack');
  fs.mkdirSync(path.join(pack, 'references'), { recursive: true });
  fs.mkdirSync(path.join(pack, 'assets/empty'), { recursive: true });
  fs.mkdirSync(path.join(pack, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(pack, 'SKILL.md'), packMarkdown);
  fs.writeFileSync(path.join(pack, 'references/guide.md'), '# 指南\n');
  fs.writeFileSync(
    path.join(pack, 'assets/logo.png'),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 255]),
  );
  fs.writeFileSync(path.join(pack, 'scripts/run.sh'), '#!/bin/sh\nexit 0\n');
  if (process.platform !== 'win32') fs.chmodSync(path.join(pack, 'scripts/run.sh'), 0o755);
  fs.writeFileSync(path.join(pack, 'LICENSE'), 'sample license\n');

  writeRecord(project, 'single', 'single', {
    display_name: '单文件样例',
    description: '完整取用',
    content_path: 'skills/single.md',
  });
  writeRecord(project, 'pack', 'pack', {
    display_name: '目录样例',
    description: '目录完整取用',
    content_path: 'skills/pack/SKILL.md',
  });
  return project;
}

function readJson(dist, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(dist, ...relativePath.split('/')), 'utf8'));
}

function readZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zipFile) => {
      if (error) return reject(error);
      const entries = [];
      zipFile.on('error', reject);
      zipFile.on('entry', (entry) => {
        const mode = (entry.externalFileAttributes >>> 16) & 0o777;
        if (entry.fileName.endsWith('/')) {
          entries.push({ path: entry.fileName, mode, directory: true });
          zipFile.readEntry();
          return;
        }
        zipFile.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(streamError);
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => {
            entries.push({
              path: entry.fileName,
              mode,
              directory: false,
              bytes: Buffer.concat(chunks),
            });
            zipFile.readEntry();
          });
          stream.on('error', reject);
        });
      });
      zipFile.on('end', () => resolve(entries));
      zipFile.readEntry();
    });
  });
}

test('single-file detail keeps the original name, bytes and verified raw URL', async (t) => {
  const project = makeProject();
  t.after(() => project.cleanup());
  const result = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));

  const dist = path.join(project.root, 'dist');
  const index = readJson(dist, 'assets/search-index.json');
  const summary = index.skills.find((item) => item.slug === 'single');
  const detail = readJson(dist, 'details/single.json');
  const source = fs.readFileSync(path.join(project.skillsDir, 'single.md'));
  const main = detail.files.find((file) => file.url === detail.raw_url);

  assert.equal(detail.schemaVersion, 1);
  assert.equal(main.path, 'single.md');
  assert.equal(main.download_name, 'single.md');
  assert.equal(main.size, source.length);
  assert.equal(main.sha256, sha256(source));
  assert.equal(detail.download_name, 'single.md');
  assert.equal(detail.download_size, source.length);
  assert.equal(detail.download_sha256, sha256(source));
  assert.deepEqual(fs.readFileSync(path.join(dist, ...detail.raw_url.split('/'))), source);
  assert.match(detail.body_html, /<pre><code/);
  assert.doesNotMatch(summary.content_text, /version: "1\.2\.3"/);
  assert.notEqual(summary.content_text, source.toString('utf8'));
});

test('directory ZIP preserves the root, references, license, binary, empty directory and modes', async (t) => {
  const project = makeProject();
  t.after(() => project.cleanup());
  const result = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));

  const dist = path.join(project.root, 'dist');
  const detail = readJson(dist, 'details/pack.json');
  const zipBytes = fs.readFileSync(path.join(dist, 'downloads/pack.zip'));
  const entries = await readZip(path.join(dist, 'downloads/pack.zip'));
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));

  assert.equal(detail.download_name, 'pack.zip');
  assert.equal(detail.download_size, zipBytes.length);
  assert.equal(detail.download_sha256, sha256(zipBytes));
  assert.ok(detail.directories.includes('assets/empty'));

  for (const relative of [
    'SKILL.md',
    'references/guide.md',
    'assets/logo.png',
    'scripts/run.sh',
    'LICENSE',
  ]) {
    const sourcePath = path.join(project.skillsDir, 'pack', ...relative.split('/'));
    const entry = byPath.get(`pack/${relative}`);
    assert.ok(entry, relative);
    assert.deepEqual(entry.bytes, fs.readFileSync(sourcePath), relative);
    const file = detail.files.find((item) => item.path === relative);
    assert.ok(file, relative);
    assert.equal(file.sha256, sha256(fs.readFileSync(sourcePath)), relative);
    assert.equal(file.size, fs.readFileSync(sourcePath).length, relative);
  }
  assert.equal(byPath.get('pack/assets/empty/').directory, true);
  const scriptMode = fs.statSync(path.join(project.skillsDir, 'pack/scripts/run.sh')).mode;
  const expectedScriptMode = (scriptMode & 0o111) === 0 ? 0o644 : 0o755;
  assert.equal(byPath.get('pack/scripts/run.sh').mode & 0o777, expectedScriptMode);
  assert.equal(byPath.get('pack/SKILL.md').mode & 0o777, 0o644);
  assert.equal(byPath.has('single.md'), false);
  assert.equal(byPath.has('pack/../single.md'), false);
});

test('public file URLs stay inside the skill and resolve to their declared bytes', async (t) => {
  const project = makeProject();
  t.after(() => project.cleanup());
  const result = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));

  const dist = path.join(project.root, 'dist');
  const manifest = readJson(dist, 'manifest.json');
  const detail = readJson(dist, 'details/pack.json');
  const paths = new Set(manifest.artifacts.map((artifact) => artifact.path));

  for (const file of detail.files) {
    assert.equal(file.url.startsWith('skills/pack/'), true, file.path);
    assert.equal(paths.has(file.url), true, file.url);
    const bytes = fs.readFileSync(path.join(dist, ...file.url.split('/')));
    assert.equal(sha256(bytes), file.sha256, file.path);
  }
  assert.equal(
    detail.files.some((file) => file.path.includes('single')),
    false,
  );
  assert.equal(
    paths.has(
      'skills/single/' +
        sha256(fs.readFileSync(path.join(project.skillsDir, 'single.md'))) +
        '.bin',
    ),
    true,
  );
  assert.equal(paths.has('downloads/pack.zip'), true);
});

test('content revision covers the browser action modules', async (t) => {
  const project = makeProject();
  t.after(() => project.cleanup());
  const first = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  const firstRevision = readJson(
    path.join(project.root, 'dist'),
    'assets/search-index.json',
  ).contentRevision;

  fs.appendFileSync(path.join(project.root, 'assets/app-detail.js'), '\n');
  const second = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(second.ok, true, JSON.stringify(second.diagnostics));
  const secondRevision = readJson(
    path.join(project.root, 'dist'),
    'assets/search-index.json',
  ).contentRevision;

  assert.notEqual(firstRevision, secondRevision);
});
