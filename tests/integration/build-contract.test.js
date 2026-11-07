const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yauzl = require('yauzl');

const { makeTempProject, sha256 } = require('../support/fixtures');

const alphaMarkdown = [
  '---',
  'name: 甲技能',
  'description: 单文件样例',
  'version: "1.2.3"',
  'metadata:',
  '  nested:',
  '    unknown: true',
  '---',
  '',
  '# 甲技能',
  '',
  '| 字段 | 值 |',
  '| --- | --- |',
  '| 中文 | 保留 |',
  '',
  '```js',
  "const message = '你好';",
  '```',
  '',
].join('\n');

const betaMarkdown = [
  '---',
  'name: 乙技能',
  'description: 目录样例',
  '---',
  '',
  '# 乙技能',
  '',
  '阅读 [指南](references/guide.md)。',
  '',
].join('\n');

function buildSite(options) {
  const { buildSite: build } = require('../../scripts/lib/build-site');
  return build(options);
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
  fs.writeFileSync(path.join(project.skillsDir, 'alpha.md'), alphaMarkdown);
  fs.mkdirSync(path.join(project.skillsDir, 'beta/references'), { recursive: true });
  fs.writeFileSync(path.join(project.skillsDir, 'beta/SKILL.md'), betaMarkdown);
  fs.writeFileSync(path.join(project.skillsDir, 'beta/references/guide.md'), '# 指南\n');
  writeRecord(project, 'alpha', 'alpha', {
    display_name: '甲技能',
    description: '单文件样例',
    content_path: 'skills/alpha.md',
  });
  writeRecord(project, 'beta', 'beta', {
    display_name: '乙技能',
    description: '目录样例',
    content_path: 'skills/beta/SKILL.md',
  });
  return project;
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
        if (entry.fileName.endsWith('/')) {
          entries.push({ path: entry.fileName, directory: true });
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

function writeOldDist(project) {
  const dist = path.join(project.root, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const sentinel = path.join(dist, 'old.txt');
  fs.writeFileSync(sentinel, 'old snapshot\n');
  return { dist, sentinel, before: fs.readFileSync(sentinel) };
}

test('builds index, details, raw files, ZIP and manifest from one snapshot', async (t) => {
  const project = makeProject();
  t.after(() => project.cleanup());
  const result = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));

  const dist = path.join(project.root, 'dist');
  const index = readJson(dist, 'assets/search-index.json');
  assert.equal(index.schemaVersion, 1);
  assert.equal(typeof index.contentRevision, 'string');
  assert.equal(index.skills.length, 2);

  const alpha = index.skills.find((item) => item.slug === 'alpha');
  const beta = index.skills.find((item) => item.slug === 'beta');
  assert.ok(alpha);
  assert.ok(beta);
  const alphaDetail = readJson(dist, 'details/alpha.json');
  const betaDetail = readJson(dist, 'details/beta.json');
  assert.equal(alphaDetail.contentRevision, index.contentRevision);
  assert.equal(betaDetail.contentRevision, index.contentRevision);
  assert.equal(alphaDetail.digest, alpha.digest);
  assert.equal(betaDetail.digest, beta.digest);

  const alphaBytes = fs.readFileSync(path.join(project.skillsDir, 'alpha.md'));
  const alphaRaw = path.join(dist, ...alphaDetail.raw_url.split('/'));
  assert.deepEqual(fs.readFileSync(alphaRaw), alphaBytes);
  assert.equal(alphaDetail.files[0].path, 'alpha.md');
  assert.equal(alphaDetail.files[0].sha256, sha256(alphaBytes));

  const zipBytes = fs.readFileSync(path.join(dist, 'downloads/beta.zip'));
  assert.equal(betaDetail.download_url, 'downloads/beta.zip');
  assert.equal(betaDetail.download_sha256, sha256(zipBytes));
  const entries = await readZip(path.join(dist, 'downloads/beta.zip'));
  const unpacked = new Map(
    entries.filter((entry) => !entry.directory).map((entry) => [entry.path, entry.bytes]),
  );
  assert.deepEqual(
    unpacked.get('beta/SKILL.md'),
    fs.readFileSync(path.join(project.skillsDir, 'beta/SKILL.md')),
  );
  assert.deepEqual(
    unpacked.get('beta/references/guide.md'),
    fs.readFileSync(path.join(project.skillsDir, 'beta/references/guide.md')),
  );

  const manifest = readJson(dist, 'manifest.json');
  assert.equal(manifest.contentRevision, index.contentRevision);
  assert.equal(manifest.skills.find((item) => item.slug === 'alpha').digest, alpha.digest);
  assert.equal(manifest.skills.find((item) => item.slug === 'beta').digest, beta.digest);
  const artifactPaths = manifest.artifacts.map((item) => item.path);
  assert.equal(artifactPaths.includes('manifest.json'), false);
  for (const artifact of manifest.artifacts) {
    const artifactPath = path.join(dist, ...artifact.path.split('/'));
    assert.equal(fs.existsSync(artifactPath), true, artifact.path);
    assert.equal(fs.statSync(artifactPath).size, artifact.size);
    assert.equal(sha256(fs.readFileSync(artifactPath)), artifact.sha256);
  }
});

test('successful build replaces the previous output and publishes only whitelisted files', async (t) => {
  const project = makeProject();
  t.after(() => project.cleanup());
  const old = writeOldDist(project);
  fs.mkdirSync(path.join(old.dist, 'stale'), { recursive: true });
  fs.writeFileSync(path.join(old.dist, 'stale/old.bin'), 'stale');

  const result = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(fs.existsSync(old.sentinel), false);
  assert.equal(fs.existsSync(path.join(old.dist, 'stale/old.bin')), false);

  const allowed = new Set([
    '.nojekyll',
    'assets',
    'details',
    'downloads',
    'index.html',
    'manifest.json',
    'media',
    'skills',
  ]);
  for (const name of fs.readdirSync(old.dist)) assert.ok(allowed.has(name), name);
  for (const forbidden of ['catalog', 'docs', 'handoff', 'package.json', 'scripts', 'tests']) {
    assert.equal(fs.existsSync(path.join(old.dist, forbidden)), false, forbidden);
  }
  assert.equal(fs.existsSync(path.join(old.dist, 'skills/alpha.md')), false);
});

test('missing main, duplicate slug and missing attachment fail the whole batch', async (t) => {
  const cases = [
    {
      name: 'missing main',
      prepare(project) {
        writeRecord(project, 'gamma', 'gamma', {
          display_name: '缺主文档',
          description: '样例',
          content_path: 'skills/gamma.md',
        });
      },
    },
    {
      name: 'duplicate slug',
      prepare(project) {
        writeRecord(project, 'alpha-dup', 'alpha', {
          display_name: '重复',
          description: '样例',
          content_path: 'skills/alpha.md',
        });
      },
    },
    {
      name: 'missing attachment',
      prepare(project) {
        fs.writeFileSync(
          path.join(project.skillsDir, 'alpha.md'),
          alphaMarkdown.replace('# 甲技能', '# 甲技能\n\n[缺失](missing.md)'),
        );
      },
    },
  ];

  for (const item of cases) {
    const project = makeProject();
    t.after(() => project.cleanup());
    item.prepare(project);
    const old = writeOldDist(project);
    const result = await buildSite({ projectRoot: project.root, outputName: 'dist' });
    assert.equal(result.ok, false, item.name);
    assert.deepEqual(fs.readFileSync(old.sentinel), old.before, item.name);
    assert.equal(fs.existsSync(path.join(old.dist, 'assets/search-index.json')), false, item.name);
    assert.deepEqual(fs.readdirSync(old.dist), ['old.txt'], item.name);
  }
});

test('a first failure leaves no partial dist', async (t) => {
  const project = makeProject();
  t.after(() => project.cleanup());
  writeRecord(project, 'gamma', 'gamma', {
    display_name: '缺主文档',
    description: '样例',
    content_path: 'skills/gamma.md',
  });
  const result = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(path.join(project.root, 'dist')), false);
});

test('a second rename failure restores the previous output', async (t) => {
  const project = makeProject();
  t.after(() => project.cleanup());
  const old = writeOldDist(project);
  let calls = 0;
  const rename = (from, to) => {
    calls += 1;
    if (calls === 2) throw new Error('injected rename failure');
    return fs.renameSync(from, to);
  };
  const result = await buildSite({ projectRoot: project.root, outputName: 'dist', rename });
  assert.equal(result.ok, false);
  assert.deepEqual(fs.readFileSync(old.sentinel), old.before);
  assert.equal(fs.existsSync(path.join(old.dist, 'assets/search-index.json')), false);
  assert.deepEqual(fs.readdirSync(old.dist), ['old.txt']);
});
