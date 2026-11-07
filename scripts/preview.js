#!/usr/bin/env node
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.bin', 'application/octet-stream'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function respond(res, status, type, body) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body ?? '', 'utf8');
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': bytes.length,
  });
  res.end(bytes);
}

function safeFile(root, relativePath) {
  const segments = relativePath.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.includes('\\'))) {
    return null;
  }
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stats;
    try {
      stats = fs.lstatSync(current);
    } catch {
      return null;
    }
    if (stats.isSymbolicLink()) return null;
    if (segment !== segments[segments.length - 1] && !stats.isDirectory()) return null;
  }
  try {
    const stats = fs.lstatSync(current);
    return stats.isFile() ? current : null;
  } catch {
    return null;
  }
}

function createPreviewServer({ root, basePath = '/skill-gallery/' }) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new Error('root must be an absolute path');
  }
  if (!basePath.startsWith('/') || !basePath.endsWith('/')) {
    throw new Error('basePath must start and end with /');
  }
  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      respond(res, 405, 'text/plain; charset=utf-8', 'method not allowed');
      return;
    }
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      respond(res, 400, 'text/plain; charset=utf-8', 'bad request');
      return;
    }
    if (!pathname.startsWith(basePath)) {
      respond(res, 404, 'text/plain; charset=utf-8', 'not found');
      return;
    }
    let relative;
    try {
      relative = decodeURIComponent(pathname.slice(basePath.length));
    } catch {
      respond(res, 400, 'text/plain; charset=utf-8', 'bad request');
      return;
    }
    if (relative === '' || relative.endsWith('/')) relative += 'index.html';
    const target = safeFile(root, relative);
    if (!target) {
      respond(res, 404, 'text/plain; charset=utf-8', 'not found');
      return;
    }
    let bytes;
    try {
      bytes = fs.readFileSync(target);
    } catch {
      respond(res, 404, 'text/plain; charset=utf-8', 'not found');
      return;
    }
    const type = MIME.get(path.extname(target).toLowerCase()) ?? 'application/octet-stream';
    const body = req.method === 'HEAD' ? Buffer.alloc(0) : bytes;
    respond(res, 200, type, body);
  });
}

function main() {
  const root = path.resolve(__dirname, '..', 'dist');
  if (!fs.existsSync(root) || !fs.lstatSync(root).isDirectory()) {
    console.log(JSON.stringify({ status: 'failed', code: 'E_PREVIEW_DIST_MISSING' }));
    process.exitCode = 1;
    return;
  }
  const server = createPreviewServer({ root });
  server.on('error', () => {
    console.log(JSON.stringify({ status: 'failed', code: 'E_PREVIEW_LISTEN' }));
    process.exitCode = 1;
  });
  server.listen(8000, '127.0.0.1', () => {
    console.log(
      JSON.stringify({
        status: 'listening',
        url: 'http://127.0.0.1:8000/skill-gallery/',
      }),
    );
  });
}

if (require.main === module) main();

module.exports = { createPreviewServer };
