const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const sanitizeHtml = require('sanitize-html');
const yauzl = require('yauzl');
const yazl = require('yazl');

const { makeTempProject } = require('../support/fixtures');

const allowedTags = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'br',
  'hr',
  'ul',
  'ol',
  'li',
  'blockquote',
  'strong',
  'em',
  'del',
  'pre',
  'code',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'a',
  'img',
];

function aliasFor(text) {
  return (
    text
      .normalize('NFC')
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}_-]/gu, '') || 'section'
  );
}

function uniqueAliases(texts) {
  const used = new Set();
  return texts.map((text) => {
    const base = aliasFor(text);
    let alias = base;
    let suffix = 0;
    while (used.has(alias)) {
      suffix += 1;
      alias = `${base}-${suffix}`;
    }
    used.add(alias);
    return alias;
  });
}

async function render(markdown) {
  const { marked } = await import('marked');
  return marked.parse(markdown, { gfm: true });
}

function clean(html) {
  let heading = 0;
  const headingTags = {};
  for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    headingTags[tag] = (tagName) => {
      heading += 1;
      return { tagName, attribs: { id: `skill-heading-${heading}` } };
    };
  }
  return sanitizeHtml(html, {
    allowedTags,
    allowedAttributes: {
      a: ['href', 'rel', 'target'],
      img: ['src', 'alt', 'title'],
      code: ['class'],
      h1: ['id'],
      h2: ['id'],
      h3: ['id'],
      h4: ['id'],
      h5: ['id'],
      h6: ['id'],
    },
    allowedSchemes: ['http', 'https'],
    transformTags: headingTags,
  });
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

function writeZip(zipPath) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from('中文正文\n'), 'skill/说明.md', {
      mode: 0o644,
      mtime: new Date('1980-01-01T00:00:00Z'),
    });
    zip.addBuffer(Buffer.from([0, 1, 2, 3, 255]), 'skill/assets/data.bin', {
      mode: 0o644,
      mtime: new Date('1980-01-01T00:00:00Z'),
    });
    zip.addBuffer(Buffer.from('#!/bin/sh\nexit 0\n'), 'skill/scripts/run.sh', {
      mode: 0o755,
      mtime: new Date('1980-01-01T00:00:00Z'),
    });
    zip.addEmptyDirectory('skill/empty-dir/', {
      mode: 0o755,
      mtime: new Date('1980-01-01T00:00:00Z'),
    });
    const output = fs.createWriteStream(zipPath);
    output.on('close', resolve);
    output.on('error', reject);
    zip.outputStream.on('error', reject);
    zip.outputStream.pipe(output);
    zip.end();
  });
}

test('renders code, tables and Chinese while removing active content', async () => {
  const html = await render(
    [
      '# 标题',
      '',
      '<script>alert(1)</script>',
      '<iframe src="https://example.com/frame"></iframe>',
      '<form action="https://example.com"><input name="q"></form>',
      '<img src="x" onerror="alert(2)">',
      '<a href="javascript:alert(3)" onclick="alert(4)">坏链接</a>',
      '',
      '| 列 | 值 |',
      '| --- | --- |',
      '| 中文 | 保留 |',
      '',
      '```js',
      "const message = '你好';",
      '```',
    ].join('\n'),
  );
  const cleaned = clean(html);
  assert.match(cleaned, /<h1 id="skill-heading-1">标题<\/h1>/);
  assert.match(cleaned, /<table>/);
  assert.match(cleaned, /中文/);
  assert.match(cleaned, /const message = &#39;你好&#39;|const message = '你好'/);
  assert.equal(cleaned.includes('<script'), false);
  assert.equal(cleaned.includes('<iframe'), false);
  assert.equal(cleaned.includes('<form'), false);
  assert.equal(cleaned.includes('onerror'), false);
  assert.equal(cleaned.includes('onclick'), false);
  assert.equal(cleaned.includes('javascript:'), false);
});

test('distinguishes real links from code and removes forged heading ids', async () => {
  const cleaned = clean(
    await render(
      [
        '<h2 id="skill-heading-9" name="forged">快速开始</h2>',
        '',
        '[真实链接](https://example.com/ok)',
        '',
        '`[伪链接](https://evil.example/inline)`',
        '',
        '```',
        '[代码内链接](https://evil.example/code)',
        '```',
      ].join('\n'),
    ),
  );
  assert.match(cleaned, /href="https:\/\/example\.com\/ok"/);
  assert.equal(cleaned.includes('href="https://evil.example'), false);
  assert.match(cleaned, /evil\.example\/inline/);
  assert.match(cleaned, /evil\.example\/code/);
  assert.match(cleaned, /<h2 id="skill-heading-1">快速开始<\/h2>/);
  assert.equal(cleaned.includes('skill-heading-9'), false);
  assert.equal(cleaned.includes('forged'), false);
});

test('builds unique heading ids and aliases for Chinese, duplicate and empty headings', async () => {
  const cleaned = clean(
    await render(
      ['## 快速开始', '', '## 快速开始', '', '## API Token', '', '## ！？', ''].join('\n'),
    ),
  );
  const aliases = uniqueAliases(['快速开始', '快速开始', 'API Token', '！？']);
  assert.deepEqual(aliases, ['快速开始', '快速开始-1', 'api-token', 'section']);
  assert.match(cleaned, /id="skill-heading-1"/);
  assert.match(cleaned, /id="skill-heading-2"/);
  assert.match(cleaned, /id="skill-heading-3"/);
  assert.match(cleaned, /id="skill-heading-4"/);

  const secondPass = sanitizeHtml(cleaned, {
    allowedTags,
    allowedAttributes: { h1: ['id'], h2: ['id'], h3: ['id'], h4: ['id'] },
  });
  assert.match(secondPass, /id="skill-heading-1"/);
  assert.match(secondPass, /id="skill-heading-4"/);
});

test('writes and unpacks binary, text, empty directory and executable mode', async () => {
  const project = makeTempProject();
  const zipPath = path.join(project.root, 'skill.zip');
  try {
    await writeZip(zipPath);
    assert.ok(fs.statSync(zipPath).size > 0);
    const entries = await readZip(zipPath);
    const byPath = new Map(entries.map((entry) => [entry.path, entry]));

    assert.deepEqual([...byPath.get('skill/assets/data.bin').bytes], [0, 1, 2, 3, 255]);
    assert.equal(byPath.get('skill/说明.md').bytes.toString('utf8'), '中文正文\n');
    assert.equal(byPath.get('skill/scripts/run.sh').mode, 0o755);
    assert.equal(byPath.get('skill/说明.md').mode, 0o644);
    assert.equal(byPath.get('skill/empty-dir/').directory, true);
    assert.equal(
      entries.some((entry) => entry.path.includes('..')),
      false,
    );
  } finally {
    project.cleanup();
  }
});
