const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { renderMarkdown } = require('../../scripts/lib/build-render');
const { findPathCollisions, validateSkillInput } = require('../../scripts/lib/validate');
const {
  makeDirectoryProject,
  makeSingleFileProject,
  recordFor,
} = require('../support/validation-project');

const linkFixture = fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'path-attacks', 'links.md'),
  'utf8',
);

function markdownOptions() {
  return {
    baseDir: 'references',
    fileSet: new Set(['other.md', 'references/guide.md']),
    fileUrls: new Map([
      ['other.md', 'skills/sample/other.bin'],
      ['references/guide.md', 'skills/sample/guide.bin'],
    ]),
    mediaUrls: new Map(),
    imageRequests: [],
    relativePath: 'references/links.md',
  };
}

function codes(result) {
  return result.errors.map((item) => item.code);
}

function assertNoUnsafeHref(body, value) {
  assert.doesNotMatch(body, new RegExp(`href="${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
}

test('allows parent links inside the skill but rejects traversal, encoded separators and absolute paths', async () => {
  const result = await renderMarkdown(linkFixture, markdownOptions());
  const body = result.body;
  const found = codes(result);

  assert.match(body, /href="skills\/sample\/other\.bin"/);
  assert.match(body, /href="https:\/\/example\.com\/path"/);
  assert.ok(found.includes('E_PATH'), JSON.stringify(found));
  assert.ok(found.includes('E_REFERENCE_MISSING'), JSON.stringify(found));
  for (const unsafe of ['outside.md', '/etc/passwd', 'C:/Windows/win.ini', 'evil.example']) {
    assertNoUnsafeHref(body, unsafe);
  }
  assert.doesNotMatch(body, /href="(?:javascript|data|file|mailto):/i);
  assert.match(body, /未知锚点（未找到本文锚点）/);
});

test('absolute, drive, backslash, NUL and protocol-relative references are path errors', async () => {
  const cases = [
    ['[绝对](/etc/passwd)', 'E_PATH'],
    ['[盘符](C:/Windows/win.ini)', 'E_PATH'],
    ['[反斜杠](..%5Coutside.md)', 'E_PATH'],
    ['[NUL](bad%00.md)', 'E_PATH'],
    ['[协议相对](//evil.example/path)', 'E_PATH'],
    ['[编码分隔](%2f..%2foutside.md)', 'E_PATH'],
  ];
  for (const [markdown, expected] of cases) {
    const result = await renderMarkdown(markdown, markdownOptions());
    assert.ok(codes(result).includes(expected), `${markdown}: ${JSON.stringify(result.errors)}`);
    assert.doesNotMatch(result.body, /href=/);
  }
});

test('double encoding is decoded once and cannot reach outside files', async () => {
  const result = await renderMarkdown('[二次](%252e%252e%252foutside.md)', markdownOptions());
  assert.ok(codes(result).includes('E_REFERENCE_MISSING'), JSON.stringify(result.errors));
  assert.doesNotMatch(result.body, /href=/);
});

test('dot paths require exact files, templates only allow the documented exception and credentials stay forbidden', () => {
  const directory = makeDirectoryProject('# 正文\n', {
    'assets/.hidden': 'safe dot resource\n',
    '.env': 'TOKEN=real-secret\n',
  });
  try {
    const broad = validateSkillInput({
      projectRoot: directory.project.root,
      record: { ...directory.record, allowed_dot_paths: ['assets'] },
    });
    assert.equal(broad.ok, false);
    assert.ok(broad.diagnostics.some((item) => item.code === 'E_DOT_PATH_REVIEW'));

    const exact = validateSkillInput({
      projectRoot: directory.project.root,
      record: { ...directory.record, allowed_dot_paths: ['assets/.hidden'] },
    });
    assert.equal(exact.ok, false, JSON.stringify(exact.diagnostics));

    const forbidden = validateSkillInput({
      projectRoot: directory.project.root,
      record: { ...directory.record, allowed_dot_paths: ['assets/.hidden', '.env'] },
    });
    assert.equal(forbidden.ok, false);
    assert.ok(forbidden.diagnostics.some((item) => item.code === 'E_PATH'));

    const missing = validateSkillInput({
      projectRoot: directory.project.root,
      record: { ...directory.record, allowed_dot_paths: ['assets/.missing'] },
    });
    assert.equal(missing.ok, false);
    assert.ok(missing.diagnostics.some((item) => item.code === 'E_DOT_PATH_REVIEW'));
  } finally {
    directory.project.cleanup();
  }

  const template = makeDirectoryProject('# 正文\n', {
    'assets/.hidden': 'safe dot resource\n',
    '.env.template': 'TOKEN=YOUR_TOKEN_HERE\n',
  });
  try {
    const exact = validateSkillInput({
      projectRoot: template.project.root,
      record: {
        ...template.record,
        allowed_dot_paths: ['assets/.hidden', '.env.template'],
      },
    });
    assert.equal(exact.ok, true, JSON.stringify(exact.diagnostics));
  } finally {
    template.project.cleanup();
  }
});

test('content_path cannot be smuggled through encoded separators or drive paths', () => {
  const project = makeSingleFileProject('# 正文\n');
  const outside = path.join(project.project.root, 'outside.md');
  fs.writeFileSync(outside, '# outside\n');
  try {
    for (const contentPath of [
      '../outside.md',
      '%2e%2e%2foutside.md',
      'C:/Windows/win.ini',
      'skills\\sample-skill.md',
      'skills/sample-skill.md%00',
    ]) {
      const result = validateSkillInput({
        projectRoot: project.project.root,
        record: recordFor('sample-skill', { content_path: contentPath }),
      });
      assert.equal(result.ok, false, contentPath);
      assert.ok(
        result.diagnostics.some((item) => ['E_PATH', 'E_SCHEMA'].includes(item.code)),
        contentPath,
      );
      assert.equal(
        result.files.some((file) => file.path.includes('outside')),
        false,
        contentPath,
      );
    }
  } finally {
    project.project.cleanup();
  }
});

test('hardlinks and symlinks are rejected without reading their targets', (t) => {
  const directory = makeDirectoryProject('# 正文\n', { 'references/real.md': '# real\n' });
  try {
    fs.linkSync(
      path.join(directory.skillRoot, 'references', 'real.md'),
      path.join(directory.skillRoot, 'references', 'hard.md'),
    );
    const hard = validateSkillInput({
      projectRoot: directory.project.root,
      record: directory.record,
    });
    assert.equal(hard.ok, false);
    assert.ok(hard.diagnostics.some((item) => item.code === 'E_LINK_FILE'));

    try {
      fs.symlinkSync(
        path.join(directory.skillRoot, 'references', 'real.md'),
        path.join(directory.skillRoot, 'references', 'link.md'),
      );
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        t.diagnostic('symlink creation is unavailable in this environment');
        return;
      }
      throw error;
    }
    const linked = validateSkillInput({
      projectRoot: directory.project.root,
      record: directory.record,
    });
    assert.equal(linked.ok, false);
    assert.ok(linked.diagnostics.some((item) => item.code === 'E_LINK_FILE'));
  } finally {
    directory.project.cleanup();
  }
});

test('case and NFC collisions are detected before path lookup', () => {
  assert.deepEqual(findPathCollisions(['A.md', 'a.md']), [
    { path: 'a.md', collisionWith: 'A.md', kind: 'case' },
  ]);
  assert.deepEqual(findPathCollisions(['café.md', 'cafe\u0301.md']), [
    { path: 'cafe\u0301.md', collisionWith: 'café.md', kind: 'nfc' },
  ]);
});
