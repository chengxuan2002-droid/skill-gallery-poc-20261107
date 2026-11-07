const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yauzl = require('yauzl');

const { makeTempProject } = require('../support/fixtures');
const { buildSite, writeAssets, writeRecord } = require('../support/invalid-batch-project');

const main = [
  '---',
  'name: 复现样例',
  'description: 可重复构建',
  'version: "1.0.0"',
  '---',
  '',
  '# 复现样例',
  '',
  '中文正文。',
  '',
  '```js',
  "const stable = 'same';",
  '```',
  '',
].join('\n');

function makeProject(t) {
  const project = makeTempProject();
  t.after(() => project.cleanup());
  writeAssets(project);
  const root = path.join(project.skillsDir, 'sample');
  fs.mkdirSync(path.join(root, 'references'), { recursive: true });
  fs.mkdirSync(path.join(root, 'empty'), { recursive: true });
  fs.writeFileSync(path.join(root, 'SKILL.md'), main);
  fs.writeFileSync(path.join(root, 'references/guide.md'), '# 指南\n\n稳定内容。\n');
  fs.writeFileSync(path.join(root, 'assets.bin'), Buffer.from([0, 1, 2, 255, 10]));
  fs.writeFileSync(path.join(root, 'LICENSE'), 'sample license\n');
  writeRecord(project, 'sample', 'sample', {
    display_name: '复现样例',
    description: '可重复构建',
    content_path: 'skills/sample/SKILL.md',
  });
  return project;
}

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, ...relativePath.split('/')), 'utf8'));
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

async function snapshot(projectRoot) {
  const dist = path.join(projectRoot, 'dist');
  const index = readJson(dist, 'assets/search-index.json');
  const detail = readJson(dist, 'details/sample.json');
  const raw = fs.readFileSync(path.join(dist, ...detail.raw_url.split('/')));
  const zip = await readZip(path.join(dist, 'downloads/sample.zip'));
  const manifest = readJson(dist, 'manifest.json');
  return {
    revision: index.contentRevision,
    index: index.skills[0],
    detail,
    raw,
    zip: zip.map((entry) => ({
      path: entry.path,
      directory: entry.directory,
      bytes: entry.directory ? null : entry.bytes,
    })),
    manifest,
  };
}

test('two clean copies produce the same identity, raw files and unpacked ZIP', async (t) => {
  const firstProject = makeProject(t);
  const secondProject = makeProject(t);
  const first = await buildSite({ projectRoot: firstProject.root, outputName: 'dist' });
  const second = await buildSite({ projectRoot: secondProject.root, outputName: 'dist' });
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  assert.equal(second.ok, true, JSON.stringify(second.diagnostics));

  const left = await snapshot(firstProject.root);
  const right = await snapshot(secondProject.root);
  assert.equal(left.revision, right.revision);
  assert.equal(left.index.slug, right.index.slug);
  assert.equal(left.index.digest, right.index.digest);
  assert.equal(left.detail.digest, right.detail.digest);
  assert.deepEqual(left.detail.files, right.detail.files);
  assert.deepEqual(left.raw, right.raw);
  assert.deepEqual(left.zip, right.zip);
  assert.equal(JSON.stringify(left.manifest).includes(firstProject.root), false);
  assert.equal(JSON.stringify(left.detail).includes(firstProject.root), false);
});

test('repeated builds do not invent versions, dates or residual transaction paths', async (t) => {
  const project = makeProject(t);
  const first = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  const before = await snapshot(project.root);
  const second = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(second.ok, true, JSON.stringify(second.diagnostics));
  const after = await snapshot(project.root);

  assert.equal(after.revision, before.revision);
  assert.equal(after.detail.updated_at, before.detail.updated_at);
  assert.equal(after.detail.created_at, before.detail.created_at);
  assert.equal(after.index.declared_version, before.index.declared_version);
  assert.deepEqual(after.detail.files, before.detail.files);
  assert.deepEqual(
    fs.readdirSync(project.root).filter((name) => name.startsWith('.dist.')),
    [],
  );
});

test('a second snapshot that removes an attachment leaves no stale file or ZIP entry', async (t) => {
  const project = makeProject(t);
  const first = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  const before = await snapshot(project.root);
  const guide = before.detail.files.find((file) => file.path === 'references/guide.md');
  assert.ok(guide);
  const oldPath = path.join(project.root, 'dist', ...guide.url.split('/'));
  assert.equal(fs.existsSync(oldPath), true);

  fs.rmSync(path.join(project.skillsDir, 'sample/references/guide.md'));
  const second = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(second.ok, true, JSON.stringify(second.diagnostics));
  const after = await snapshot(project.root);

  assert.equal(
    after.detail.files.some((file) => file.path === 'references/guide.md'),
    false,
  );
  assert.equal(fs.existsSync(oldPath), false);
  assert.equal(
    after.zip.some((entry) => entry.path === 'sample/references/guide.md'),
    false,
  );
});
