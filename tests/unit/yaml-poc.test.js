const assert = require('node:assert/strict');
const test = require('node:test');
const { isMap, isScalar, parseDocument } = require('yaml');

const options = { schema: 'core', strict: true, uniqueKeys: true, maxAliasCount: 100 };

function splitFrontmatter(text) {
  const source = text.replace(/^\uFEFF/, '');
  const lines = source.split(/\r?\n/);
  if (lines[0] !== '---') return { found: false, closed: false, metaText: '', body: source };
  const end = lines.findIndex((line, index) => index > 0 && line === '---');
  if (end === -1) {
    return { found: true, closed: false, metaText: lines.slice(1).join('\n'), body: '' };
  }
  return {
    found: true,
    closed: true,
    metaText: lines.slice(1, end).join('\n'),
    body: lines.slice(end + 1).join('\n'),
  };
}

function readMetadata(text) {
  const parts = splitFrontmatter(text);
  if (!parts.found) return { found: false, parts };
  if (!parts.closed) return { found: true, closed: false, parts };
  const document = parseDocument(parts.metaText, options);
  return { found: true, closed: true, parts, document };
}

function nonStringKeys(document) {
  const keys = [];
  if (!isMap(document.contents)) return keys;
  for (const item of document.contents.items) {
    if (!isScalar(item.key) || typeof item.key.value !== 'string') {
      keys.push(item.key && item.key.value);
    }
  }
  return keys;
}

test('reads standard, folded, nested and unknown fields without stringifying the source', () => {
  const source = [
    '---',
    'name: 标准样例',
    'description: >-',
    '  第一行',
    '  第二行',
    'metadata:',
    '  nested:',
    '    unknown: true',
    '---',
    '# 正文',
  ].join('\n');
  const { document, parts } = readMetadata(source);
  assert.equal(document.errors.length, 0);
  assert.equal(document.get('name'), '标准样例');
  assert.equal(document.get('description'), '第一行 第二行');
  assert.equal(document.getIn(['metadata', 'nested', 'unknown']), true);
  assert.equal(parts.body, '# 正文');
  assert.equal(source.includes('description: >-'), true);
});

test('accepts BOM and CRLF while keeping the body readable', () => {
  const source = '\uFEFF---\r\nname: 样例\r\ntags:\r\n  - 中文\r\n---\r\n正文\r\n';
  const { document, parts } = readMetadata(source);
  assert.equal(document.errors.length, 0);
  assert.equal(document.get('name'), '样例');
  assert.deepEqual(document.toJS().tags, ['中文']);
  assert.equal(parts.body, '正文\n');
});

test('only the first closing delimiter ends the frontmatter', () => {
  const source = ['---', 'name: 样例', '---', '正文', '---', '更多正文'].join('\n');
  const { parts } = readMetadata(source);
  assert.equal(parts.closed, true);
  assert.equal(parts.body, '正文\n---\n更多正文');
});

test('duplicate and non-string mapping keys are rejected by the fixed options', () => {
  const duplicate = readMetadata('---\nname: a\nname: b\n---\n');
  assert.ok(duplicate.document.errors.length > 0);

  const numeric = readMetadata('---\n1: value\nname: 样例\n---\n');
  assert.deepEqual(nonStringKeys(numeric.document), [1]);
});

test('invalid YAML and unclosed frontmatter fail closed', () => {
  const invalid = readMetadata('---\ndescription: [unclosed\n---\n');
  assert.ok(invalid.document.errors.length > 0);

  const unclosed = readMetadata('---\nname: 样例\n正文没有闭合');
  assert.equal(unclosed.closed, false);
});

test('custom tags are not silently accepted', () => {
  const { document } = readMetadata('---\nvalue: !custom foo\n---\n');
  assert.ok(document.errors.length + document.warnings.length > 0);
});

test('alias expansion is capped at one hundred', () => {
  const small = readMetadata(`---\nbase: &base value\nlist:\n${'  - *base\n'.repeat(10)}---\n`);
  assert.equal(small.document.errors.length, 0);
  assert.doesNotThrow(() => small.document.toJS());

  const over = readMetadata(`---\nbase: &base value\nlist:\n${'  - *base\n'.repeat(101)}---\n`);
  assert.equal(over.document.errors.length, 0);
  assert.throws(() => over.document.toJS(), /alias/i);
});

test('a document without frontmatter is reported without parsing the body', () => {
  const result = readMetadata('# 只有正文\n\n---\n');
  assert.equal(result.found, false);
  assert.equal(result.parts.body, '# 只有正文\n\n---\n');
});
