const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const healthy = {
  '/skill-gallery/': ['text/html', '<title>Skill Gallery</title><main id="app"></main>'],
  '/skill-gallery/assets/app.js': ['application/javascript', 'globalThis.MONITOR_EXECUTED = true;'],
  '/skill-gallery/assets/style.css': ['text/css', 'body { color: inherit; }'],
  '/skill-gallery/assets/search-index.json': [
    'application/json',
    JSON.stringify([{ slug: 'fixture', name: 'Example', content: 'data only' }]),
  ],
};

async function server(t, override = () => false) {
  const requests = [];
  const instance = http.createServer((req, res) => {
    requests.push(req.url);
    if (override(req, res, requests)) return;
    const resource = healthy[req.url];
    res.writeHead(resource ? 200 : 404, { 'Content-Type': resource?.[0] || 'text/plain' });
    res.end(resource?.[1] || 'missing');
  });
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        instance.closeAllConnections();
        instance.close(resolve);
      }),
  );
  return { base: `http://127.0.0.1:${instance.address().port}/skill-gallery/`, requests };
}

function probe(base, options = {}) {
  const { checkSite } = require('../../scripts/check-site');
  return checkSite(base, { retryDelayMs: 0, ...options });
}

test('monitor CLI rejects URL arguments instead of probing an arbitrary destination', () => {
  const result = spawnSync(
    process.execPath,
    [path.resolve(__dirname, '../../scripts/check-site.js'), 'https://example.invalid/'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 2);
  assert.deepEqual(JSON.parse(result.stdout), {
    check: 'site',
    status: 'error',
    code: 'INVALID_ARGUMENT',
  });
  assert.equal(result.stderr, '');
});

test('healthy resources pass under the project prefix without executing downloaded JavaScript', async (t) => {
  const site = await server(t);
  const report = await probe(site.base);
  assert.equal(report.status, 'passed');
  assert.equal(report.resources.length, 4);
  assert.equal(
    report.resources.every((r) => r.httpStatus === 200 && r.attempts === 1),
    true,
  );
  assert.deepEqual(site.requests, Object.keys(healthy));
  assert.equal(globalThis.MONITOR_EXECUTED, undefined);
});

test('a 200 error page fails the homepage identity check without exposing its body', async (t) => {
  const site = await server(t, (req, res) => {
    if (req.url !== '/skill-gallery/') return false;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<title>Error</title>YOUR_API_KEY_HERE private response');
    return true;
  });
  const report = await probe(site.base);
  assert.equal(report.status, 'failed');
  assert.equal(report.resources[0].code, 'CONTENT_INVALID');
  assert.equal(report.resources[0].attempts, 2);
  assert.equal(JSON.stringify(report).includes('YOUR_API_KEY_HERE'), false);
  assert.equal(JSON.stringify(report).includes('private response'), false);
  assert.equal(
    report.resources.slice(1).every((r) => r.status === 'passed'),
    true,
  );
});

test('HTML served as a JavaScript asset fails MIME validation', async (t) => {
  const site = await server(t, (req, res) => {
    if (!req.url.endsWith('app.js')) return false;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<title>Not Found</title>');
    return true;
  });
  const report = await probe(site.base);
  assert.equal(report.status, 'failed');
  assert.equal(report.resources[1].code, 'CONTENT_TYPE');
});

for (const [label, body] of [
  ['invalid JSON', 'not json'],
  ['empty index', '[]'],
  ['wrong shape', '{}'],
  ['invalid entries', '[{"slug":3,"name":"x","content":"x"}]'],
]) {
  test(`${label} cannot pass as an available search index`, async (t) => {
    const site = await server(t, (req, res) => {
      if (!req.url.endsWith('.json')) return false;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return true;
    });
    const report = await probe(site.base);
    assert.equal(report.status, 'failed');
    assert.equal(report.resources[3].code, 'CONTENT_INVALID');
  });
}

test('empty static resources fail instead of returning a healthy status', async (t) => {
  const site = await server(t, (req, res) => {
    if (!req.url.endsWith('.css')) return false;
    res.writeHead(200, { 'Content-Type': 'text/css' });
    res.end('   ');
    return true;
  });
  assert.equal((await probe(site.base)).resources[2].code, 'BODY_EMPTY');
});

test('a transient HTTP failure gets exactly one retry and can recover', async (t) => {
  const site = await server(t, (req, res, requests) => {
    if (!req.url.endsWith('app.js') || requests.filter((p) => p.endsWith('app.js')).length > 1)
      return false;
    res.writeHead(503);
    res.end('unavailable');
    return true;
  });
  const report = await probe(site.base);
  assert.equal(report.status, 'passed');
  assert.equal(report.resources[1].attempts, 2);
  assert.equal(site.requests.length, 5);
});

test('redirects are rejected without following the new destination', async (t) => {
  const site = await server(t, (req, res) => {
    if (!req.url.endsWith('app.js')) return false;
    res.writeHead(302, { Location: '/unexpected-destination' });
    res.end();
    return true;
  });
  const report = await probe(site.base);
  assert.equal(report.status, 'failed');
  assert.equal(report.resources[1].httpStatus, 302);
  assert.equal(report.resources[1].code, 'HTTP_STATUS');
  assert.equal(site.requests.includes('/unexpected-destination'), false);
});

test('disconnected sockets are reported as failed requests', async (t) => {
  const site = await server(t, (req) => {
    if (!req.url.endsWith('app.js')) return false;
    req.socket.destroy();
    return true;
  });
  const report = await probe(site.base);
  assert.equal(report.status, 'failed');
  assert.equal(report.resources[1].code, 'UNREACHABLE');
  assert.equal(report.resources[1].attempts, 2);
});

test('timeouts cover stalled response bodies and stop after two attempts', async (t) => {
  const site = await server(t, (req, res) => {
    if (!req.url.endsWith('app.js')) return false;
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.flushHeaders();
    return true;
  });
  const report = await probe(site.base, { timeoutMs: 40 });
  assert.equal(report.status, 'failed');
  assert.equal(report.resources[1].code, 'TIMEOUT');
  assert.equal(report.resources[1].attempts, 2);
});
