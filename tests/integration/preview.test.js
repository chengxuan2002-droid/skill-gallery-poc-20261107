const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');

const { makeTempProject } = require('../support/fixtures');

function createPreviewServer(options) {
  const { createPreviewServer: create } = require('../../scripts/preview');
  return create(options);
}

function makeDist() {
  const project = makeTempProject();
  const dist = path.join(project.root, 'dist');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(dist, 'details'), { recursive: true });
  fs.mkdirSync(path.join(dist, 'skills/alpha'), { recursive: true });
  fs.writeFileSync(
    path.join(dist, 'index.html'),
    '<!doctype html><title>Skill Gallery</title><main id="app"></main>',
  );
  fs.writeFileSync(path.join(dist, 'assets/app.js'), 'globalThis.APP_LOADED = true;');
  fs.writeFileSync(path.join(dist, 'assets/style.css'), 'body { color: inherit; }');
  fs.writeFileSync(path.join(dist, 'assets/search-index.json'), '{"schemaVersion":1}');
  fs.writeFileSync(path.join(dist, 'details/alpha.json'), '{"slug":"alpha"}');
  fs.writeFileSync(path.join(dist, 'skills/alpha/abc.bin'), Buffer.from([0, 1, 2, 255, 10]));
  fs.writeFileSync(
    path.join(dist, 'skills/alpha/evil.bin'),
    '<script>globalThis.PREVIEW_EXECUTED = true;</script>',
  );
  const outside = path.join(project.root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside secret');
  fs.symlinkSync(
    outside,
    path.join(dist, 'link'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  fs.writeFileSync(path.join(project.root, 'package.json'), '{"private":true}');
  return { project, dist };
}

async function startServer(t, dist) {
  const server = createPreviewServer({ root: dist, basePath: '/skill-gallery/' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

test('serves only the /skill-gallery/ prefix with explicit MIME types', async (t) => {
  const { project, dist } = makeDist();
  t.after(() => project.cleanup());
  const base = await startServer(t, dist);

  const index = await fetch(`${base}/skill-gallery/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type') || '', /text\/html/);
  assert.match(await index.text(), /Skill Gallery/);

  const script = await fetch(`${base}/skill-gallery/assets/app.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type') || '', /javascript/);

  const style = await fetch(`${base}/skill-gallery/assets/style.css`);
  assert.equal(style.status, 200);
  assert.match(style.headers.get('content-type') || '', /text\/css/);

  const json = await fetch(`${base}/skill-gallery/assets/search-index.json`);
  assert.equal(json.status, 200);
  assert.match(json.headers.get('content-type') || '', /application\/json/);

  const binary = await fetch(`${base}/skill-gallery/skills/alpha/abc.bin`);
  assert.equal(binary.status, 200);
  assert.match(binary.headers.get('content-type') || '', /application\/octet-stream/);
  assert.deepEqual(Buffer.from(await binary.arrayBuffer()), Buffer.from([0, 1, 2, 255, 10]));

  assert.equal((await fetch(`${base}/skill-gallery/missing`)).status, 404);
  assert.equal((await fetch(`${base}/index.html`)).status, 404);
});

test('does not list directories, follow links or sniff HTML for .bin files', async (t) => {
  const { project, dist } = makeDist();
  t.after(() => project.cleanup());
  const base = await startServer(t, dist);

  const listing = await fetch(`${base}/skill-gallery/details/`);
  assert.ok([403, 404].includes(listing.status), String(listing.status));
  assert.doesNotMatch(await listing.text(), /alpha\.json/);

  const linked = await fetch(`${base}/skill-gallery/link/secret.txt`);
  assert.ok([403, 404].includes(linked.status), String(linked.status));
  assert.doesNotMatch(await linked.text(), /outside secret/);

  const evil = await fetch(`${base}/skill-gallery/skills/alpha/evil.bin`);
  assert.equal(evil.status, 200);
  assert.match(evil.headers.get('content-type') || '', /application\/octet-stream/);
  assert.doesNotMatch(evil.headers.get('content-type') || '', /text\/html/);
  assert.match(await evil.text(), /PREVIEW_EXECUTED/);
});

test('rejects encoded traversal without reading outside dist', async (t) => {
  const { project, dist } = makeDist();
  t.after(() => project.cleanup());
  const base = await startServer(t, dist);

  for (const attempt of [
    '/skill-gallery/%2e%2e/package.json',
    '/skill-gallery/%2e%2e%2fpackage.json',
    '/skill-gallery/..%2fpackage.json',
    '/skill-gallery/%252e%252e%252fpackage.json',
  ]) {
    const response = await fetch(`${base}${attempt}`);
    assert.ok([400, 403, 404].includes(response.status), `${attempt}: ${response.status}`);
    assert.doesNotMatch(await response.text(), /private/);
  }
});
