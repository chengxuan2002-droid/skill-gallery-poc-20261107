const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { digestTree, makeTempProject, sha256 } = require('../support/fixtures');

const repoRoot = path.resolve(__dirname, '../..');
const migrateSource = path.join(repoRoot, 'scripts/migrate-catalog.js');
const slugs = [
  'superpower-systematic-debugging',
  'code-review-assistant',
  'refactoring-workflow',
  'handoff-codex',
];
const originalFiles = [
  'skills/superpower-systematic-debugging.md',
  'skills/code-review-assistant.md',
  'skills/refactoring-workflow.md',
  'skills/handoff-codex/SKILL.md',
  'skills/handoff-codex/agents/openai.yaml',
  'skills/handoff-codex/scripts/create_handoff.sh',
];

function makeProject() {
  const project = makeTempProject();
  fs.mkdirSync(path.join(project.root, 'scripts'), { recursive: true });
  fs.cpSync(path.join(repoRoot, 'scripts/lib'), path.join(project.root, 'scripts/lib'), {
    recursive: true,
  });
  if (fs.existsSync(migrateSource)) {
    fs.copyFileSync(migrateSource, path.join(project.root, 'scripts/migrate-catalog.js'));
  }
  const nodeModules = path.join(project.root, 'node_modules');
  fs.symlinkSync(
    path.join(repoRoot, 'node_modules'),
    nodeModules,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  for (const relativePath of originalFiles) {
    const destination = path.join(project.root, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, relativePath), destination);
  }
  fs.copyFileSync(
    path.join(repoRoot, 'tests/fixtures/common/standard-single.md'),
    path.join(project.skillsDir, 'standard-sample.md'),
  );
  fs.mkdirSync(path.join(project.skillsDir, 'office2md'), { recursive: true });
  fs.writeFileSync(path.join(project.skillsDir, 'office2md/README.md'), 'office2md sentinel\n');
  return project;
}

function runMigration(project, args = []) {
  const script = path.join(project.root, 'scripts/migrate-catalog.js');
  assert.equal(fs.existsSync(script), true, 'scripts/migrate-catalog.js 尚未实现');
  return spawnSync(process.execPath, [script, ...args], {
    cwd: project.root,
    encoding: 'utf8',
    timeout: 120000,
  });
}

function catalogFiles(project) {
  const catalog = path.join(project.root, 'catalog');
  if (!fs.existsSync(catalog)) return [];
  return fs
    .readdirSync(catalog)
    .filter((name) => name.endsWith('.json') && fs.statSync(path.join(catalog, name)).isFile())
    .sort();
}

function digestOriginals(project) {
  const result = {};
  for (const relativePath of originalFiles) {
    const bytes = fs.readFileSync(path.join(project.root, ...relativePath.split('/')));
    result[relativePath] = sha256(bytes);
  }
  return result;
}

function writeCatalogRecord(project, slug, overrides = {}) {
  const catalog = path.join(project.root, 'catalog');
  fs.mkdirSync(catalog, { recursive: true });
  const record = {
    schemaVersion: 1,
    slug,
    display_name: '冲突名称',
    description: '已存在的站内记录',
    tags: [],
    platforms: [],
    content_path: `skills/${slug}.md`,
    source_tracking: null,
    ...overrides,
  };
  const target = path.join(catalog, `${slug}.json`);
  fs.writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`);
  return target;
}

test('dry run writes nothing and leaves every original untouched', (t) => {
  const project = makeProject();
  t.after(() => project.cleanup());
  const before = digestOriginals(project);
  for (const args of [[], ['--dry-run']]) {
    const result = runMigration(project, args);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(catalogFiles(project), []);
  }
  assert.deepEqual(digestOriginals(project), before);
});

test('write creates exactly four records and does not import unmanaged samples', (t) => {
  const project = makeProject();
  t.after(() => project.cleanup());
  const before = digestOriginals(project);
  const officeBefore = fs.readFileSync(path.join(project.skillsDir, 'office2md/README.md'));

  const result = runMigration(project, ['--write']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(catalogFiles(project), slugs.map((slug) => `${slug}.json`).sort());
  for (const slug of slugs) {
    const record = JSON.parse(
      fs.readFileSync(path.join(project.root, 'catalog', `${slug}.json`), 'utf8'),
    );
    assert.equal(record.schemaVersion, 1);
    assert.equal(record.slug, slug);
    assert.equal(record.source_tracking, null);
    assert.equal(
      record.content_path,
      slug === 'handoff-codex' ? 'skills/handoff-codex/SKILL.md' : `skills/${slug}.md`,
    );
    assert.equal(record.usage, record.usage.trimEnd(), `${slug} usage`);
  }
  assert.equal(catalogFiles(project).includes('standard-sample.json'), false);
  assert.equal(catalogFiles(project).includes('office2md.json'), false);
  assert.deepEqual(
    fs.readFileSync(path.join(project.skillsDir, 'office2md/README.md')),
    officeBefore,
  );
  assert.deepEqual(digestOriginals(project), before);
});

test('a second identical write is a no-op', (t) => {
  const project = makeProject();
  t.after(() => project.cleanup());
  assert.equal(runMigration(project, ['--write']).status, 0);
  const first = digestTree(path.join(project.root, 'catalog'));
  const second = runMigration(project, ['--write']);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.deepEqual(digestTree(path.join(project.root, 'catalog')), first);
});

test('a differing existing record is a conflict and blocks the whole batch', (t) => {
  const project = makeProject();
  t.after(() => project.cleanup());
  const target = writeCatalogRecord(project, 'code-review-assistant');
  const before = fs.readFileSync(target);
  const result = runMigration(project, ['--write']);
  assert.equal(result.status, 1);
  assert.deepEqual(catalogFiles(project), ['code-review-assistant.json']);
  assert.deepEqual(fs.readFileSync(target), before);
});

test('one invalid or missing original prevents all writes', (t) => {
  const invalid = makeProject();
  t.after(() => invalid.cleanup());
  fs.writeFileSync(path.join(invalid.root, 'skills/refactoring-workflow.md'), '');
  const invalidResult = runMigration(invalid, ['--write']);
  assert.equal(invalidResult.status, 1);
  assert.deepEqual(catalogFiles(invalid), []);

  const missing = makeProject();
  t.after(() => missing.cleanup());
  fs.rmSync(path.join(missing.root, 'skills/code-review-assistant.md'));
  const missingResult = runMigration(missing, ['--write']);
  assert.equal(missingResult.status, 1);
  assert.deepEqual(catalogFiles(missing), []);
});

test('a blocked target leaves no partial new records', (t) => {
  const project = makeProject();
  t.after(() => project.cleanup());
  const catalog = path.join(project.root, 'catalog');
  fs.mkdirSync(path.join(catalog, 'refactoring-workflow.json'), { recursive: true });
  const result = runMigration(project, ['--write']);
  assert.equal(result.status, 1);
  assert.deepEqual(catalogFiles(project), []);
  assert.equal(fs.statSync(path.join(catalog, 'refactoring-workflow.json')).isDirectory(), true);
});

test('dry-run and write are mutually exclusive and write nothing', (t) => {
  const project = makeProject();
  t.after(() => project.cleanup());
  const result = runMigration(project, ['--dry-run', '--write']);
  assert.equal(result.status, 1);
  assert.deepEqual(catalogFiles(project), []);
});
