const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildSite,
  expectFailure,
  makeValidProject,
  validMarkdown,
  writeRecord,
} = require('../support/invalid-batch-project');

const fixtures = path.join(__dirname, '..', 'fixtures', 'invalid-batch');

test('missing and empty main documents fail the whole batch without replacing old dist', async (t) => {
  await expectFailure(
    t,
    (base) => {
      fs.rmSync(path.join(base.project.skillsDir, 'sample.md'));
    },
    ['E_MAIN_MISSING'],
  );

  await expectFailure(
    t,
    (base) => {
      fs.copyFileSync(
        path.join(fixtures, 'empty.md'),
        path.join(base.project.skillsDir, 'sample.md'),
      );
    },
    ['E_MAIN_MISSING'],
  );
});

test('broken metadata, wrong types, unknown fields and invalid versions fail closed', async (t) => {
  await expectFailure(
    t,
    (base) => {
      fs.copyFileSync(
        path.join(fixtures, 'bad-yaml.md'),
        path.join(base.project.skillsDir, 'sample.md'),
      );
    },
    ['E_YAML'],
  );

  await expectFailure(
    t,
    (base) => {
      writeRecord(base.project, 'sample', 'sample', {
        description: '合法输入',
        content_path: 'skills/sample.md',
        tags: 'not-an-array',
      });
    },
    ['E_SCHEMA'],
  );

  await expectFailure(
    t,
    (base) => {
      writeRecord(base.project, 'sample', 'sample', {
        description: '合法输入',
        content_path: 'skills/sample.md',
        unknown_field: true,
      });
    },
    ['E_SCHEMA'],
  );

  await expectFailure(
    t,
    (base) => {
      writeRecord(base.project, 'sample', 'sample', {
        description: '合法输入',
        content_path: 'skills/sample.md',
        declared_version: 1,
      });
    },
    ['E_SCHEMA'],
  );

  await expectFailure(
    t,
    (base) => {
      fs.writeFileSync(
        path.join(base.project.skillsDir, 'sample.md'),
        validMarkdown.replace('version: "1.0.0"', 'version: 1'),
      );
    },
    ['E_SCHEMA'],
  );
});

test('duplicate slugs and shared content ownership fail before any output replacement', async (t) => {
  await expectFailure(
    t,
    (base) => {
      writeRecord(base.project, 'sample-dup', 'sample', {
        display_name: '重复',
        description: '重复 slug',
        content_path: 'skills/sample.md',
      });
    },
    ['E_DUPLICATE'],
  );

  await expectFailure(
    t,
    (base) => {
      writeRecord(base.project, 'beta', 'beta', {
        display_name: '共享内容',
        description: '共享同一路径',
        content_path: 'skills/sample.md',
      });
    },
    ['E_SCHEMA'],
  );

  await expectFailure(
    t,
    (base) => {
      writeRecord(base.project, 'sample', 'sample', {
        display_name: '越界路径',
        description: '越界',
        content_path: '../outside.md',
      });
    },
    ['E_PATH'],
  );
});

test('missing local attachments, attachment references and excluded resources fail', async (t) => {
  await expectFailure(
    t,
    (base) => {
      fs.copyFileSync(
        path.join(fixtures, 'missing-reference.md'),
        path.join(base.project.skillsDir, 'sample.md'),
      );
    },
    ['E_REFERENCE_MISSING'],
  );

  await expectFailure(
    t,
    (base) => {
      const root = path.join(base.project.skillsDir, 'sample');
      fs.mkdirSync(path.join(root, 'references'), { recursive: true });
      fs.copyFileSync(
        path.join(fixtures, 'missing-in-attachment', 'SKILL.md'),
        path.join(root, 'SKILL.md'),
      );
      fs.copyFileSync(
        path.join(fixtures, 'missing-in-attachment', 'references', 'guide.md'),
        path.join(root, 'references', 'guide.md'),
      );
      fs.rmSync(path.join(base.project.skillsDir, 'sample.md'));
      writeRecord(base.project, 'sample', 'sample', {
        description: '目录样例',
        content_path: 'skills/sample/SKILL.md',
      });
    },
    ['E_REFERENCE_MISSING'],
  );

  await expectFailure(
    t,
    (base) => {
      const root = path.join(base.project.skillsDir, 'sample');
      fs.mkdirSync(root, { recursive: true });
      fs.copyFileSync(path.join(fixtures, 'excluded-reference.md'), path.join(root, 'SKILL.md'));
      fs.writeFileSync(path.join(root, '.DS_Store'), 'noise');
      fs.rmSync(path.join(base.project.skillsDir, 'sample.md'));
      writeRecord(base.project, 'sample', 'sample', {
        description: '目录样例',
        content_path: 'skills/sample/SKILL.md',
      });
    },
    ['E_REFERENCE_MISSING'],
  );
});

test('file count, main size and total byte limits fail the whole batch', async (t) => {
  await expectFailure(
    t,
    (base) => {
      fs.writeFileSync(
        path.join(base.project.skillsDir, 'sample.md'),
        Buffer.alloc(1024 * 1024 + 1, 0x61),
      );
    },
    ['E_LIMIT'],
  );

  await expectFailure(
    t,
    (base) => {
      const root = path.join(base.project.skillsDir, 'sample');
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, 'SKILL.md'), validMarkdown);
      fs.rmSync(path.join(base.project.skillsDir, 'sample.md'));
      writeRecord(base.project, 'sample', 'sample', {
        description: '目录样例',
        content_path: 'skills/sample/SKILL.md',
      });
      for (let index = 0; index < 500; index += 1) {
        fs.writeFileSync(path.join(root, `extra-${index}.txt`), '');
      }
    },
    ['E_LIMIT'],
  );

  await expectFailure(
    t,
    (base) => {
      const root = path.join(base.project.skillsDir, 'sample');
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, 'SKILL.md'), validMarkdown);
      fs.rmSync(path.join(base.project.skillsDir, 'sample.md'));
      writeRecord(base.project, 'sample', 'sample', {
        description: '目录样例',
        content_path: 'skills/sample/SKILL.md',
      });
      fs.writeFileSync(path.join(root, 'bulk.bin'), Buffer.alloc(20 * 1024 * 1024 + 1, 0x61));
    },
    ['E_LIMIT'],
  );
});

test('safe external links, fragments and code pseudo-links do not fail the batch', async (t) => {
  const base = await makeValidProject(t);
  fs.writeFileSync(
    path.join(base.project.skillsDir, 'sample.md'),
    [
      '---',
      'name: 合法样例',
      'description: 合法输入',
      '---',
      '',
      '# 快速开始',
      '',
      '[外链](https://example.com/path)',
      '[本文](#快速开始)',
      '`[伪链接](missing.md)`',
      '',
    ].join('\n'),
  );
  const result = await buildSite({ projectRoot: base.project.root, outputName: 'dist' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const detail = JSON.parse(fs.readFileSync(path.join(base.dist, 'details/sample.json'), 'utf8'));
  assert.match(detail.body_html, /href="https:\/\/example.com\/path"/);
  assert.match(detail.body_html, /href="#skill-heading-1"/);
  assert.doesNotMatch(detail.body_html, /href="missing\.md"/);
  assert.match(detail.body_html, /<code>\[伪链接\]\(missing\.md\)<\/code>/);
});
