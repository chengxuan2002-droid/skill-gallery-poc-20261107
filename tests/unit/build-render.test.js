const assert = require('node:assert/strict');
const test = require('node:test');

const { rasterType, renderMarkdown } = require('../../scripts/lib/build-render');

const fileSet = new Set(['alpha.md', 'references/guide.md', 'assets/logo.png']);
const fileUrls = new Map([
  ['alpha.md', 'skills/alpha/a.bin'],
  ['references/guide.md', 'skills/alpha/b.bin'],
  ['assets/logo.png', 'skills/alpha/c.bin'],
]);

function options(overrides = {}) {
  return {
    baseDir: '.',
    fileSet,
    fileUrls,
    mediaUrls: new Map(),
    relativePath: 'alpha.md',
    ...overrides,
  };
}

test('renders safe markdown and removes active content', async () => {
  const result = await renderMarkdown(
    [
      '# 标题',
      '',
      '<script>alert(1)</script>',
      '<iframe src="https://example.com/frame"></iframe>',
      '<h2 id="forged" name="bad">外部标题</h2>',
      '',
      '| 列 | 值 |',
      '| --- | --- |',
      '| 中文 | 保留 |',
      '',
      '```js',
      "const message = '你好';",
      '```',
    ].join('\n'),
    options(),
  );
  assert.deepEqual(result.errors, []);
  assert.doesNotMatch(result.body, /<script|<iframe|onerror|javascript:/i);
  assert.match(result.body, /<table>/);
  assert.match(result.body, /const message/);
  assert.match(result.body, /id="skill-heading-1"/);
  assert.doesNotMatch(result.body, /id="forged"|name="bad"/);
  assert.doesNotMatch(result.contentText, /</);
});

test('maps headings, aliases, local links and external links', async () => {
  const result = await renderMarkdown(
    [
      '## 快速开始',
      '',
      '## 快速开始',
      '',
      '[锚点](#快速开始)',
      '[重复](#快速开始-1)',
      '[未知](#不存在)',
      '[外链](https://example.com)',
      '[指南](references/guide.md)',
      '`[伪链接](missing.md)`',
    ].join('\n'),
    options(),
  );
  assert.deepEqual(result.errors, []);
  assert.match(result.body, /id="skill-heading-1"/);
  assert.match(result.body, /id="skill-heading-2"/);
  assert.match(result.body, /href="#skill-heading-1"/);
  assert.match(result.body, /href="#skill-heading-2"/);
  assert.doesNotMatch(result.body, /href="[^"]*不存在/);
  assert.match(result.body, /未知（未找到本文锚点）/);
  assert.match(result.body, /href="https:\/\/example.com"[^>]*rel="noopener noreferrer"/);
  assert.match(result.body, /href="skills\/alpha\/b.bin"/);
  assert.doesNotMatch(result.body, /href="missing\.md"/);
});

test('fails on missing local references but not on code pseudo-links', async () => {
  const missing = await renderMarkdown('[缺失](missing.md)', options());
  assert.ok(missing.errors.some((item) => item.code === 'E_REFERENCE_MISSING'));
  assert.doesNotMatch(missing.body, /href="missing\.md"/);

  const escape = await renderMarkdown('[越界](../outside.md)', options());
  assert.ok(escape.errors.some((item) => item.code === 'E_PATH'));

  const code = await renderMarkdown('`[伪链接](missing.md)`', options());
  assert.deepEqual(code.errors, []);
  assert.doesNotMatch(code.body, /href=/);
});

test('maps raster images to media URLs and leaves unsupported images without src', async () => {
  const png = await renderMarkdown(
    '![图](assets/logo.png)',
    options({ mediaUrls: new Map([['assets/logo.png', 'media/alpha/c.png']]) }),
  );
  assert.deepEqual(png.errors, []);
  assert.match(png.body, /src="media\/alpha\/c.png"/);

  const unsupported = await renderMarkdown('![图](assets/logo.png)', options());
  assert.deepEqual(unsupported.errors, []);
  assert.doesNotMatch(unsupported.body, /src=/);
  assert.match(unsupported.body, /alt="图"/);
});

test('recognizes only supported raster signatures', () => {
  assert.equal(rasterType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])).ext, 'png');
  assert.equal(rasterType(Buffer.from([0xff, 0xd8, 0xff, 0x00])).ext, 'jpg');
  assert.equal(rasterType(Buffer.from('GIF89a', 'latin1')).ext, 'gif');
  assert.equal(
    rasterType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])).ext,
    'webp',
  );
  assert.equal(rasterType(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypavif')])).ext, 'avif');
  assert.equal(rasterType(Buffer.from('<svg></svg>')), null);
});
