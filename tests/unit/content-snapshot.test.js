const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const sanitizeHtml = require('sanitize-html');

const { computeDigest, snapshotSkill } = require('../../scripts/lib/content-store');
const { readFrontmatter } = require('../../scripts/lib/validate');
const { makeDirectoryProject, makeSingleFileProject } = require('../support/validation-project');

const main = '---\nname: 样例\ndescription: 用于快照\n---\n\n# 正文\n';

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);

test('digest covers paths, bytes, executable bits and empty directories deterministically', () => {
  const base = computeDigest({
    files: [{ path: 'a.md', sha256: hashA, executable: false }],
    directories: [],
  });
  const reordered = computeDigest({
    files: [
      { path: 'b.md', sha256: hashB, executable: true },
      { path: 'a.md', sha256: hashA, executable: false },
    ],
    directories: ['z', 'a'],
  });
  const sorted = computeDigest({
    files: [
      { path: 'a.md', sha256: hashA, executable: false },
      { path: 'b.md', sha256: hashB, executable: true },
    ],
    directories: ['a', 'z'],
  });
  assert.equal(reordered, sorted);
  assert.notEqual(
    base,
    computeDigest({ files: [{ path: 'b.md', sha256: hashA, executable: false }], directories: [] }),
  );
  assert.notEqual(
    base,
    computeDigest({ files: [{ path: 'a.md', sha256: hashB, executable: false }], directories: [] }),
  );
  assert.notEqual(
    base,
    computeDigest({ files: [{ path: 'a.md', sha256: hashA, executable: true }], directories: [] }),
  );
  assert.notEqual(
    base,
    computeDigest({
      files: [{ path: 'a.md', sha256: hashA, executable: false }],
      directories: ['empty'],
    }),
  );
});

test('single-file snapshots do not own adjacent files', () => {
  const project = makeSingleFileProject(main);
  try {
    fs.writeFileSync(path.join(project.project.skillsDir, 'neighbor.md'), '# neighbor\n');
    const result = snapshotSkill({
      projectRoot: project.project.root,
      record: project.record,
    });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.equal(result.snapshot.kind, 'single');
    assert.deepEqual(
      result.snapshot.files.map((file) => file.path),
      ['sample-skill.md'],
    );
    assert.equal(result.snapshot.files[0].bytes.toString('utf8'), main);
    assert.equal(result.snapshot.directories.length, 0);
  } finally {
    project.project.cleanup();
  }
});

test('attachment and empty-directory changes alter the digest', () => {
  const project = makeDirectoryProject(main, { 'references/a.md': '# a\n' });
  try {
    const first = snapshotSkill({ projectRoot: project.project.root, record: project.record });
    const firstDigest = first.snapshot.digest;

    fs.writeFileSync(path.join(project.skillRoot, 'references', 'b.md'), '# b\n');
    const added = snapshotSkill({ projectRoot: project.project.root, record: project.record });
    assert.notEqual(added.snapshot.digest, firstDigest);

    fs.rmSync(path.join(project.skillRoot, 'references', 'b.md'));
    const removed = snapshotSkill({ projectRoot: project.project.root, record: project.record });
    assert.equal(removed.snapshot.digest, firstDigest);

    fs.mkdirSync(path.join(project.skillRoot, 'empty-dir'));
    const empty = snapshotSkill({ projectRoot: project.project.root, record: project.record });
    assert.notEqual(empty.snapshot.digest, firstDigest);
    assert.deepEqual(empty.snapshot.directories, ['empty-dir']);
  } finally {
    project.project.cleanup();
  }
});

test('mtime and current date do not alter content identity', () => {
  const project = makeSingleFileProject(main);
  try {
    const first = snapshotSkill({ projectRoot: project.project.root, record: project.record });
    const filePath = path.join(project.project.skillsDir, 'sample-skill.md');
    const oldDate = new Date('2001-01-01T00:00:00Z');
    fs.utimesSync(filePath, oldDate, oldDate);
    const second = snapshotSkill({ projectRoot: project.project.root, record: project.record });
    assert.equal(second.snapshot.digest, first.snapshot.digest);
    assert.equal(second.snapshot.recordDigest, first.snapshot.recordDigest);
  } finally {
    project.project.cleanup();
  }
});

test('input changes between read phases fail with E_SOURCE_CHANGED', () => {
  const project = makeSingleFileProject(main);
  try {
    const result = snapshotSkill({
      projectRoot: project.project.root,
      record: project.record,
      onBeforeRead() {
        fs.writeFileSync(
          path.join(project.project.skillsDir, 'sample-skill.md'),
          `${main}\nchanged`,
        );
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((item) => item.code === 'E_SOURCE_CHANGED'));

    const recordChange = snapshotSkill({
      projectRoot: project.project.root,
      record: project.record,
      onBeforeRead() {
        project.record.description = 'changed record';
      },
    });
    assert.equal(recordChange.ok, false);
    assert.ok(recordChange.diagnostics.some((item) => item.code === 'E_SOURCE_CHANGED'));
  } finally {
    project.project.cleanup();
  }
});

test('reading buffers for parsing does not mutate the snapshot bytes', () => {
  const project = makeSingleFileProject(main);
  try {
    const result = snapshotSkill({ projectRoot: project.project.root, record: project.record });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const original = Buffer.from(result.snapshot.files[0].bytes);
    const frontmatter = readFrontmatter(result.snapshot.files[0].bytes);
    sanitizeHtml(`<p>${frontmatter.body}</p>`, { allowedTags: ['p'] });
    assert.equal(result.snapshot.files[0].bytes.equals(original), true);
    assert.equal(result.snapshot.files[0].bytes.toString('utf8'), main);
  } finally {
    project.project.cleanup();
  }
});
