const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  collectSkillFiles,
  findPathCollisions,
  validateSkillInput,
} = require('../../scripts/lib/validate');
const {
  makeDirectoryProject,
  makeSingleFileProject,
  recordFor,
} = require('../support/validation-project');

const main = '---\nname: 样例\ndescription: 用于校验\n---\n\n# 正文\n';

test('accepts an owned single-file skill and an owned directory skill', () => {
  const single = makeSingleFileProject(main);
  try {
    const result = validateSkillInput({ projectRoot: single.project.root, record: single.record });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].path, 'sample-skill.md');
  } finally {
    single.project.cleanup();
  }

  const directory = makeDirectoryProject(main, {
    'references/guide.md': '# 指南\n',
    'assets/data.bin': Buffer.from([0, 1, 255]),
  });
  fs.mkdirSync(path.join(directory.skillRoot, 'empty-dir'), { recursive: true });
  try {
    const result = validateSkillInput({
      projectRoot: directory.project.root,
      record: directory.record,
    });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.files.map((file) => file.path).sort(), [
      'SKILL.md',
      'assets/data.bin',
      'references/guide.md',
    ]);
    assert.deepEqual(result.directories, ['empty-dir']);
  } finally {
    directory.project.cleanup();
  }
});

test('rejects missing main documents and non-owned content paths', () => {
  const project = makeSingleFileProject(main);
  try {
    const missing = validateSkillInput({
      projectRoot: project.project.root,
      record: recordFor('missing-skill'),
    });
    assert.equal(missing.ok, false);
    assert.ok(missing.diagnostics.some((item) => item.code === 'E_MAIN_MISSING'));

    for (const contentPath of [
      'skills/other.md',
      'catalog/sample-skill.json',
      'skills/sample-skill/SKILL.md',
    ]) {
      const result = validateSkillInput({
        projectRoot: project.project.root,
        record: recordFor('sample-skill', { content_path: contentPath }),
      });
      assert.equal(result.ok, false, contentPath);
      assert.ok(
        result.diagnostics.some((item) =>
          ['E_PATH', 'E_SCHEMA', 'E_MAIN_MISSING'].includes(item.code),
        ),
        contentPath,
      );
    }
  } finally {
    project.project.cleanup();
  }
});

test('rejects absolute, traversal, backslash, control and ambiguous paths without reading outside', () => {
  const project = makeSingleFileProject(main);
  const sentinel = path.join(project.project.root, 'outside.txt');
  fs.writeFileSync(sentinel, 'outside must not be read');
  try {
    for (const contentPath of [
      path.join(project.project.root, 'skills', 'sample-skill.md'),
      '../outside.txt',
      'skills\\sample-skill.md',
      'skills/sample-skill\u0000.md',
      'skills//sample-skill.md',
      'skills/../skills/sample-skill.md',
    ]) {
      const result = validateSkillInput({
        projectRoot: project.project.root,
        record: recordFor('sample-skill', { content_path: contentPath }),
      });
      assert.equal(result.ok, false, contentPath);
      assert.ok(
        result.diagnostics.some((item) => item.code === 'E_PATH'),
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

test('excludes system noise and requires exact dot-path admission', () => {
  const directory = makeDirectoryProject(main, {
    '.DS_Store': 'noise',
    '._resource': 'noise',
    'Thumbs.db': 'noise',
    'desktop.ini': 'noise',
    '__MACOSX/evil.md': 'noise',
    'assets/.hidden': '合法点资源',
    '.env.example': 'TOKEN=YOUR_TOKEN_HERE\n',
  });
  try {
    const rejected = validateSkillInput({
      projectRoot: directory.project.root,
      record: directory.record,
    });
    assert.equal(rejected.ok, false);
    assert.ok(rejected.diagnostics.some((item) => item.code === 'E_DOT_PATH_REVIEW'));
    assert.ok(rejected.excluded.some((item) => item === '.DS_Store'));
    assert.ok(rejected.excluded.some((item) => item === '__MACOSX'));

    const allowed = validateSkillInput({
      projectRoot: directory.project.root,
      record: { ...directory.record, allowed_dot_paths: ['assets/.hidden', '.env.example'] },
    });
    assert.equal(allowed.ok, true, JSON.stringify(allowed.diagnostics));
    assert.ok(allowed.files.some((file) => file.path === 'assets/.hidden'));
    assert.ok(allowed.files.some((file) => file.path === '.env.example'));
  } finally {
    directory.project.cleanup();
  }
});

test('never admits hard-forbidden credential paths even when explicitly listed', () => {
  const directory = makeDirectoryProject(main, {
    '.env': 'TOKEN=YOUR_TOKEN_HERE\n',
    id_rsa: 'placeholder',
  });
  try {
    const result = validateSkillInput({
      projectRoot: directory.project.root,
      record: { ...directory.record, allowed_dot_paths: ['.env', 'id_rsa'] },
    });
    assert.equal(result.ok, false);
    assert.ok(
      result.diagnostics.some((item) => item.code === 'E_PATH' || item.code === 'E_SECRET'),
    );
    assert.equal(
      result.files.some((file) => file.path === '.env'),
      false,
    );
  } finally {
    directory.project.cleanup();
  }
});

test('rejects hardlinks and symlinks without following them', (t) => {
  const directory = makeDirectoryProject(main, { 'references/real.md': '# real\n' });
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

test('detects case and NFC path collisions before reading files', () => {
  assert.deepEqual(findPathCollisions(['A.md', 'a.md']), [
    { path: 'a.md', collisionWith: 'A.md', kind: 'case' },
  ]);
  assert.deepEqual(findPathCollisions(['café.md', 'cafe\u0301.md']), [
    { path: 'cafe\u0301.md', collisionWith: 'café.md', kind: 'nfc' },
  ]);
  assert.deepEqual(findPathCollisions(['one.md', 'two.md']), []);
});

test('enforces file count, total byte and main document limits at the boundary', () => {
  const fileCount = makeDirectoryProject(main, {});
  try {
    const skillRoot = fileCount.skillRoot;
    for (let index = 0; index < 499; index += 1) {
      fs.writeFileSync(path.join(skillRoot, `file-${index}.txt`), '');
    }
    const exact = collectSkillFiles({
      projectRoot: fileCount.project.root,
      record: fileCount.record,
    });
    assert.equal(exact.ok, true, JSON.stringify(exact.diagnostics));
    assert.equal(exact.files.length, 500);

    fs.writeFileSync(path.join(skillRoot, 'file-499.txt'), '');
    const over = collectSkillFiles({
      projectRoot: fileCount.project.root,
      record: fileCount.record,
    });
    assert.equal(over.ok, false);
    assert.ok(over.diagnostics.some((item) => item.code === 'E_LIMIT'));
  } finally {
    fileCount.project.cleanup();
  }

  const mainSize = makeSingleFileProject(main);
  try {
    const exactBytes = Buffer.alloc(1024 * 1024, 0x61);
    fs.writeFileSync(path.join(mainSize.project.skillsDir, 'sample-skill.md'), exactBytes);
    const exact = collectSkillFiles({
      projectRoot: mainSize.project.root,
      record: mainSize.record,
    });
    assert.equal(exact.ok, true, JSON.stringify(exact.diagnostics));

    fs.writeFileSync(
      path.join(mainSize.project.skillsDir, 'sample-skill.md'),
      Buffer.alloc(1024 * 1024 + 1, 0x61),
    );
    const over = collectSkillFiles({
      projectRoot: mainSize.project.root,
      record: mainSize.record,
    });
    assert.equal(over.ok, false);
    assert.ok(over.diagnostics.some((item) => item.code === 'E_LIMIT'));
  } finally {
    mainSize.project.cleanup();
  }

  const total = makeDirectoryProject(main, {});
  try {
    const remaining = 20 * 1024 * 1024 - Buffer.byteLength(main);
    fs.writeFileSync(path.join(total.skillRoot, 'bulk.bin'), Buffer.alloc(remaining, 0x61));
    const exact = collectSkillFiles({ projectRoot: total.project.root, record: total.record });
    assert.equal(exact.ok, true, JSON.stringify(exact.diagnostics));

    fs.appendFileSync(path.join(total.skillRoot, 'bulk.bin'), Buffer.from([0x61]));
    const over = collectSkillFiles({ projectRoot: total.project.root, record: total.record });
    assert.equal(over.ok, false);
    assert.ok(over.diagnostics.some((item) => item.code === 'E_LIMIT'));
  } finally {
    total.project.cleanup();
  }
});

test('any invalid item makes the whole validation fail instead of being skipped', () => {
  const directory = makeDirectoryProject(main, {
    'references/good.md': '# good\n',
    '.hidden': 'needs review',
  });
  try {
    const result = validateSkillInput({
      projectRoot: directory.project.root,
      record: directory.record,
    });
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.length > 0);
    assert.equal(result.diagnostics[0].severity, 'error');
  } finally {
    directory.project.cleanup();
  }
});
