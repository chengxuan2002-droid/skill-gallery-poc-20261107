const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { validateRecordOwnership, validateSkillInput } = require('../../scripts/lib/validate');
const {
  makeDirectoryProject,
  makeSingleFileProject,
  recordFor,
} = require('../support/validation-project');

const main = '---\nname: 样例\ndescription: 用于校验\n---\n\n# 正文\n';

test('rejects empty, whitespace-only and directory skills without a main document', () => {
  for (const content of ['', ' \n\t\r\n']) {
    const project = makeSingleFileProject(content);
    try {
      const result = validateSkillInput({
        projectRoot: project.project.root,
        record: project.record,
      });
      assert.equal(result.ok, false, JSON.stringify(content));
      assert.ok(
        result.diagnostics.some((item) => item.code === 'E_MAIN_MISSING'),
        JSON.stringify(content),
      );
    } finally {
      project.project.cleanup();
    }
  }

  const directory = makeDirectoryProject(main);
  fs.rmSync(path.join(directory.skillRoot, 'SKILL.md'));
  try {
    const result = validateSkillInput({
      projectRoot: directory.project.root,
      record: directory.record,
    });
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((item) => item.code === 'E_MAIN_MISSING'));
  } finally {
    directory.project.cleanup();
  }
});

test('rejects duplicate slugs and shared content ownership across records', () => {
  const valid = validateRecordOwnership([
    recordFor('alpha'),
    recordFor('beta', { content_path: 'skills/beta/SKILL.md' }),
  ]);
  assert.equal(valid.ok, true, JSON.stringify(valid.diagnostics));

  const duplicate = validateRecordOwnership([recordFor('alpha'), recordFor('alpha')]);
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.diagnostics.some((item) => item.code === 'E_DUPLICATE'));

  const shared = validateRecordOwnership([
    recordFor('alpha'),
    recordFor('beta', { content_path: 'skills/alpha.md' }),
  ]);
  assert.equal(shared.ok, false);
  assert.ok(shared.diagnostics.some((item) => item.code === 'E_SCHEMA'));
});
