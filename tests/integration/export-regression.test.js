const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const vm = require('node:vm');

const { makeTempProject } = require('../support/fixtures');

const root = path.resolve(__dirname, '../..');
const legacyFixture = path.join(root, 'tests', 'fixtures', 'legacy', 'legacy-skill.md');

function prepareLegacyProject() {
  const project = makeTempProject();
  fs.copyFileSync(legacyFixture, path.join(project.skillsDir, 'legacy-skill.md'));
  fs.mkdirSync(path.join(project.root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(project.root, 'assets'), { recursive: true });
  fs.copyFileSync(
    path.join(root, 'tests', 'fixtures', 'legacy', 'build-index.js'),
    path.join(project.root, 'scripts', 'build-index.js'),
  );
  fs.copyFileSync(
    path.join(root, 'tests', 'fixtures', 'legacy', 'app.js'),
    path.join(project.root, 'assets', 'app.js'),
  );
  return project;
}

function runLegacyBuild(project) {
  const result = spawnSync(process.execPath, ['scripts/build-index.js'], {
    cwd: project.root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(
    fs.readFileSync(path.join(project.root, 'assets', 'search-index.json'), 'utf8'),
  );
}

function loadLegacyExporter(project) {
  const source = fs.readFileSync(path.join(project.root, 'assets', 'app.js'), 'utf8');
  const element = {
    innerHTML: '',
    textContent: '',
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    appendChild() {},
    removeChild() {},
    querySelectorAll() {
      return [];
    },
  };
  const context = {
    console,
    window: {
      addEventListener() {},
      location: { hash: '' },
    },
    document: {
      getElementById: () => element,
      querySelectorAll: () => [],
      createElement: () => element,
      addEventListener() {},
      body: { appendChild() {}, removeChild() {} },
    },
    navigator: {},
    fetch: async () => ({ ok: false, status: 404 }),
    setTimeout,
    clearTimeout,
    URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL() {} },
    Blob: class {},
  };
  vm.runInNewContext(`${source}\nglobalThis.__buildFullMarkdown = buildFullMarkdown;`, context, {
    filename: 'app.js',
  });
  return context.__buildFullMarkdown;
}

test('legacy build and export drop code fences, tables and the declared version', () => {
  const project = prepareLegacyProject();
  try {
    const index = runLegacyBuild(project);
    assert.equal(index.length, 1);
    const skill = index[0];
    assert.equal(skill.version, '9.9.9');
    assert.equal(skill.content.includes('const preserved'), false);
    assert.equal(skill.content.includes('```'), false);
    assert.equal(skill.content.includes('| 中文 | 保留 |'), true);

    const exported = loadLegacyExporter(project)(skill);
    assert.match(exported, /^name: 旧实现基线样例$/m);
    assert.equal(exported.includes('version: 9.9.9'), false);
    assert.equal(exported.includes('const preserved'), false);
    assert.equal(exported.includes('```js'), false);
  } finally {
    project.cleanup();
  }
});

test('legacy export preserves the complete original document', (t) => {
  if (!process.env.LEGACY_FIDELITY_EXPECTED) {
    t.skip('baseline red check; set LEGACY_FIDELITY_EXPECTED=1 to reproduce the loss');
    return;
  }
  const project = prepareLegacyProject();
  try {
    const skill = runLegacyBuild(project)[0];
    const exported = loadLegacyExporter(project)(skill);
    assert.match(exported, /^version: 9\.9\.9$/m);
    assert.match(exported, /```js\nconst preserved = 'code fence';\n```/);
    assert.match(exported, /^metadata:$/m);
  } finally {
    project.cleanup();
  }
});
