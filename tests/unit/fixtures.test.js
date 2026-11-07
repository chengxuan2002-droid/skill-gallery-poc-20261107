const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  commonFixtures,
  copyCommonFixtures,
  digestTree,
  listTree,
  makeTempProject,
} = require('../support/fixtures');

test('common fixtures copy as inert data without creating catalog entries', () => {
  const project = makeTempProject();
  const before = digestTree(commonFixtures);
  try {
    const result = copyCommonFixtures(project.root);
    const after = digestTree(commonFixtures);

    assert.deepEqual(after, before);
    assert.equal(fs.existsSync(path.join(project.root, 'catalog')), false);
    assert.deepEqual(listTree(result.skillsDir).files, [
      'sample-directory/LICENSE',
      'sample-directory/SKILL.md',
      'sample-directory/assets/logo.png',
      'sample-directory/docs/中文 空格.md',
      'sample-directory/empty.txt',
      'sample-directory/references/guide.md',
      'sample-directory/scripts/run.sh',
      'standard-single.md',
    ]);
    assert.deepEqual(listTree(result.skillsDir).directories, [
      'sample-directory',
      'sample-directory/assets',
      'sample-directory/docs',
      'sample-directory/empty-dir',
      'sample-directory/references',
      'sample-directory/scripts',
    ]);
  } finally {
    project.cleanup();
  }
});

test('fixtures retain folded metadata, code blocks, tables and binary bytes', () => {
  const project = makeTempProject();
  try {
    const result = copyCommonFixtures(project.root);
    const single = fs
      .readFileSync(path.join(result.skillsDir, 'standard-single.md'), 'utf8')
      .replace(/\r\n/g, '\n');
    assert.match(single, /^description: >-/m);
    assert.match(single, /仅含标准名称和简介的合法样例/);
    assert.match(single, /```js\nconst message = '你好，世界';/);
    assert.match(single, /\| 语言 \| 中文 \|/);

    const logo = fs.readFileSync(
      path.join(result.skillsDir, 'sample-directory', 'assets', 'logo.png'),
    );
    assert.deepEqual([...logo.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(fs.statSync(path.join(result.skillsDir, 'sample-directory', 'empty.txt')).size, 0);
  } finally {
    project.cleanup();
  }
});

test('fixture cleanup removes the whole temporary project', () => {
  const project = makeTempProject();
  copyCommonFixtures(project.root);
  project.cleanup();
  assert.equal(fs.existsSync(project.root), false);
});
