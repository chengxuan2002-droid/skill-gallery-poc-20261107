const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');

const { createPreviewServer } = require('../../scripts/preview');
const { makeTempProject, sha256 } = require('../support/fixtures');
const { buildSite, writeAssets, writeRecord } = require('../support/invalid-batch-project');

const fixtureRoot = path.join(__dirname, '..', 'fixtures', 'untrusted');
const sentinel = path.join(process.cwd(), 'UNTRUSTED_SENTINEL');

function makeUntrustedProject(t) {
  const project = makeTempProject();
  t.after(() => project.cleanup());
  writeAssets(project);
  fs.cpSync(fixtureRoot, path.join(project.skillsDir, 'untrusted'), { recursive: true });
  fs.writeFileSync(
    path.join(project.skillsDir, 'untrusted/assets/fake.png'),
    '<script>globalThis.UNTRUSTED_FAKE_EXECUTED = true;</script>',
  );
  fs.writeFileSync(
    path.join(project.skillsDir, 'untrusted/assets/real.png'),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 255]),
  );
  writeRecord(project, 'untrusted', 'untrusted', {
    display_name: '不可信内容样例',
    description: '恶意展示与附件样例',
    content_path: 'skills/untrusted/SKILL.md',
  });
  return project;
}

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, ...relativePath.split('/')), 'utf8'));
}

test('sanitizes active content while keeping untrusted files as inert data', async (t) => {
  const project = makeUntrustedProject(t);
  fs.rmSync(sentinel, { force: true });
  const built = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
  assert.equal(fs.existsSync(sentinel), false);

  const dist = path.join(project.root, 'dist');
  const detail = readJson(dist, 'details/untrusted.json');
  const body = detail.body_html;
  assert.doesNotMatch(
    body,
    /<script|<iframe|<object|<form|onerror=|style=|javascript:|data:|file:/i,
  );
  assert.doesNotMatch(body, /id="forged"|name="bad"/);
  assert.match(body, /id="skill-heading-1"/);
  assert.match(body, /href="https:\/\/example\.com\/path"/);
  assert.doesNotMatch(body, /UNTRUSTED_SCRIPT_EXECUTED/);

  const byPath = new Map(detail.files.map((file) => [file.path, file]));
  for (const relative of [
    'scripts/should-not-run.js',
    'tests/self-test.js',
    'agents/openai.yaml',
    'assets/evil.svg',
    'assets/fake.png',
    'assets/real.png',
    'LICENSE',
  ]) {
    const file = byPath.get(relative);
    assert.ok(file, relative);
    const source = fs.readFileSync(
      path.join(project.skillsDir, 'untrusted', ...relative.split('/')),
    );
    assert.equal(file.sha256, sha256(source), relative);
    assert.equal(fs.existsSync(path.join(dist, ...file.url.split('/'))), true, relative);
  }
  assert.equal(byPath.get('assets/real.png').media_url.startsWith('media/untrusted/'), true);
  assert.equal(byPath.get('assets/fake.png').media_url, undefined);
  assert.equal(byPath.get('assets/evil.svg').media_url, undefined);
  assert.equal(fs.existsSync(sentinel), false);
});

test('untrusted source paths are not published and the ZIP retains them as files only', async (t) => {
  const project = makeUntrustedProject(t);
  const built = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
  const dist = path.join(project.root, 'dist');
  for (const forbidden of ['catalog', 'docs', 'handoff', 'package.json', 'scripts', 'tests']) {
    assert.equal(fs.existsSync(path.join(dist, forbidden)), false, forbidden);
  }
  assert.equal(fs.existsSync(path.join(dist, 'downloads/untrusted.zip')), true);
});

test('preview serves active files as octet-stream and never as executable HTML', async (t) => {
  const project = makeUntrustedProject(t);
  const built = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
  const detail = readJson(path.join(project.root, 'dist'), 'details/untrusted.json');
  const evil = detail.files.find((file) => file.path === 'assets/evil.svg');
  const server = createPreviewServer({
    root: path.join(project.root, 'dist'),
    basePath: '/skill-gallery/',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}/skill-gallery/`;
  const response = await fetch(`${base}${evil.url}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /application\/octet-stream/);
  assert.doesNotMatch(response.headers.get('content-type') || '', /text\/html/);
  assert.deepEqual(
    Buffer.from(await response.arrayBuffer()),
    fs.readFileSync(path.join(project.skillsDir, 'untrusted/assets/evil.svg')),
  );
});

test('secret fixtures fail the batch and diagnostics never echo the value', async (t) => {
  const project = makeUntrustedProject(t);
  const built = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
  const dist = path.join(project.root, 'dist');
  const oldManifest = sha256(fs.readFileSync(path.join(dist, 'manifest.json')));

  const value = 'real-secret-value';
  fs.writeFileSync(path.join(project.skillsDir, 'untrusted/secret.txt'), `password=${value}\n`);
  const failed = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(failed.ok, false);
  assert.ok(failed.diagnostics.some((item) => item.code === 'E_SECRET'));
  assert.equal(JSON.stringify(failed.diagnostics).includes(value), false);
  assert.equal(sha256(fs.readFileSync(path.join(dist, 'manifest.json'))), oldManifest);
});

test('catalog metadata secrets are rejected without echoing the value', async (t) => {
  const project = makeUntrustedProject(t);
  const catalogPath = path.join(project.root, 'catalog/untrusted.json');
  const record = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const value = 'catalog-secret-value';
  record.notes = `password=${value}`;
  fs.writeFileSync(catalogPath, JSON.stringify(record));
  const failed = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(failed.ok, false);
  assert.ok(failed.diagnostics.some((item) => item.code === 'E_SECRET'));
  assert.equal(JSON.stringify(failed.diagnostics).includes(value), false);
});

test('documented placeholders remain allowed', async (t) => {
  const project = makeUntrustedProject(t);
  fs.writeFileSync(
    path.join(project.skillsDir, 'untrusted/placeholder.txt'),
    'password=YOUR_PASSWORD_HERE\n',
  );
  const built = await buildSite({ projectRoot: project.root, outputName: 'dist' });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
});
