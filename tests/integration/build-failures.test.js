const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { makeTempProject, sha256 } = require('../support/fixtures');
const {
  buildSite,
  validMarkdown,
  writeAssets,
  writeRecord,
} = require('../support/invalid-batch-project');

function makeDirectoryProject(t) {
  const project = makeTempProject();
  t.after(() => project.cleanup());
  writeAssets(project);
  const root = path.join(project.skillsDir, 'sample');
  fs.mkdirSync(path.join(root, 'references'), { recursive: true });
  fs.writeFileSync(path.join(root, 'SKILL.md'), validMarkdown);
  fs.writeFileSync(path.join(root, 'references/guide.md'), '# guide\n');
  writeRecord(project, 'sample', 'sample', {
    display_name: '目录样例',
    description: '目录样例',
    content_path: 'skills/sample/SKILL.md',
  });
  return { project, root };
}

async function makeBuiltProject(t) {
  const base = makeDirectoryProject(t);
  const built = await buildSite({ projectRoot: base.project.root, outputName: 'dist' });
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics));
  const dist = path.join(base.project.root, 'dist');
  fs.writeFileSync(path.join(dist, 'old-sentinel.txt'), 'old snapshot\n');
  return {
    ...base,
    dist,
    manifestHash: sha256(fs.readFileSync(path.join(dist, 'manifest.json'))),
    sentinelHash: sha256(fs.readFileSync(path.join(dist, 'old-sentinel.txt'))),
  };
}

function assertOldDistUnchanged(base) {
  assert.equal(sha256(fs.readFileSync(path.join(base.dist, 'manifest.json'))), base.manifestHash);
  assert.equal(
    sha256(fs.readFileSync(path.join(base.dist, 'old-sentinel.txt'))),
    base.sentinelHash,
  );
}

test('ZIP writer and artifact verification failures leave the old dist intact', async (t) => {
  const base = await makeBuiltProject(t);
  const zipFailure = await buildSite({
    projectRoot: base.project.root,
    outputName: 'dist',
    hooks: {
      zipWriter: async () => {
        throw new Error('zip stream failed');
      },
    },
  });
  assert.equal(zipFailure.ok, false);
  assert.ok(zipFailure.diagnostics.some((item) => item.code === 'E_BUILD'));
  assertOldDistUnchanged(base);

  const verifyFailure = await buildSite({
    projectRoot: base.project.root,
    outputName: 'dist',
    hooks: {
      afterPrepareOutputs: ({ stage }) => {
        fs.writeFileSync(path.join(stage, 'assets/search-index.json'), '{}');
      },
    },
  });
  assert.equal(verifyFailure.ok, false);
  assert.ok(verifyFailure.diagnostics.some((item) => item.code === 'E_BUILD'));
  assertOldDistUnchanged(base);
});

test('source changes before commit fail with E_SOURCE_CHANGED and keep the old dist', async (t) => {
  const base = await makeBuiltProject(t);
  const result = await buildSite({
    projectRoot: base.project.root,
    outputName: 'dist',
    hooks: {
      beforeCommit: () => {
        fs.appendFileSync(path.join(base.root, 'SKILL.md'), '\nchanged before commit\n');
      },
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((item) => item.code === 'E_SOURCE_CHANGED'));
  assertOldDistUnchanged(base);
});

test('transaction state write failures abort without replacing the old dist', async (t) => {
  const base = await makeBuiltProject(t);
  const result = await buildSite({
    projectRoot: base.project.root,
    outputName: 'dist',
    hooks: {
      writeTransaction: ({ phase }) => {
        if (phase === 'promoting') throw new Error('state write failed');
      },
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((item) => item.code === 'E_BUILD'));
  assertOldDistUnchanged(base);
  assert.equal(fs.existsSync(path.join(base.project.root, '.dist.transaction.json')), false);
  assert.equal(fs.existsSync(path.join(base.project.root, '.dist.lock')), false);
});

test('a second rename failure restores the previous dist', async (t) => {
  const base = await makeBuiltProject(t);
  let calls = 0;
  const result = await buildSite({
    projectRoot: base.project.root,
    outputName: 'dist',
    rename: (from, to) => {
      calls += 1;
      if (calls === 2) throw new Error('promotion failed');
      return fs.renameSync(from, to);
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((item) => item.code === 'E_BUILD'));
  assertOldDistUnchanged(base);
});

test('a failed compensation returns E_RECOVERY_REQUIRED and keeps the only backup', async (t) => {
  const base = await makeBuiltProject(t);
  let calls = 0;
  const result = await buildSite({
    projectRoot: base.project.root,
    outputName: 'dist',
    rename: (from, to) => {
      calls += 1;
      if (calls === 2 || calls === 3) throw new Error('rename failed');
      return fs.renameSync(from, to);
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((item) => item.code === 'E_RECOVERY_REQUIRED'));
  const backups = fs
    .readdirSync(base.project.root)
    .filter((name) => name.startsWith('.dist.backup-'));
  assert.equal(backups.length, 1);
  assert.equal(
    fs.readFileSync(path.join(base.project.root, backups[0], 'old-sentinel.txt'), 'utf8'),
    'old snapshot\n',
  );
});

test('an existing build lock returns E_BUSY without touching the old dist', async (t) => {
  const base = await makeBuiltProject(t);
  const lock = path.join(base.project.root, '.dist.lock');
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'owner.json'), '{}');
  try {
    const result = await buildSite({ projectRoot: base.project.root, outputName: 'dist' });
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((item) => item.code === 'E_BUSY'));
    assertOldDistUnchanged(base);
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
});

test('cleanup failure after promotion reports built/pending and keeps a valid new dist', async (t) => {
  const base = await makeBuiltProject(t);
  const result = await buildSite({
    projectRoot: base.project.root,
    outputName: 'dist',
    hooks: {
      remove: (target, options) => {
        if (String(target).includes('.dist.backup-')) throw new Error('cleanup failed');
        return fs.rmSync(target, options);
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'built');
  assert.equal(result.cleanupStatus, 'pending');
  const manifest = JSON.parse(fs.readFileSync(path.join(base.dist, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(fs.existsSync(path.join(base.project.root, '.dist.transaction.json')), true);
  assert.ok(fs.readdirSync(base.project.root).some((name) => name.startsWith('.dist.backup-')));
});

function writeTransaction(projectRoot, value) {
  fs.writeFileSync(path.join(projectRoot, '.dist.transaction.json'), JSON.stringify(value));
}

test('recovers a prepared transaction with the old dist intact and then builds', async (t) => {
  const base = await makeBuiltProject(t);
  const runId = 'a'.repeat(32);
  const stage = path.join(base.project.root, `.dist.stage-${runId}`);
  fs.cpSync(base.dist, stage, { recursive: true });
  fs.rmSync(path.join(stage, 'old-sentinel.txt'));
  writeTransaction(base.project.root, {
    schemaVersion: 1,
    run_id: runId,
    output_name: 'dist',
    phase: 'prepared',
    had_previous: true,
    previous_manifest_sha256: base.manifestHash,
    candidate_manifest_sha256: base.manifestHash,
  });
  const result = await buildSite({ projectRoot: base.project.root, outputName: 'dist' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(fs.existsSync(stage), false);
  assert.equal(fs.existsSync(path.join(base.project.root, '.dist.transaction.json')), false);
});

test('recovers a promoted transaction by keeping the candidate and removing the backup', async (t) => {
  const base = await makeBuiltProject(t);
  const runId = 'b'.repeat(32);
  const backup = path.join(base.project.root, `.dist.backup-${runId}`);
  fs.cpSync(base.dist, backup, { recursive: true });
  fs.rmSync(path.join(backup, 'old-sentinel.txt'));
  fs.appendFileSync(path.join(base.root, 'SKILL.md'), '\nsecond version\n');
  const rebuilt = await buildSite({ projectRoot: base.project.root, outputName: 'dist' });
  assert.equal(rebuilt.ok, true, JSON.stringify(rebuilt.diagnostics));
  const candidateHash = sha256(fs.readFileSync(path.join(base.dist, 'manifest.json')));
  writeTransaction(base.project.root, {
    schemaVersion: 1,
    run_id: runId,
    output_name: 'dist',
    phase: 'promoted',
    had_previous: true,
    previous_manifest_sha256: base.manifestHash,
    candidate_manifest_sha256: candidateHash,
  });
  const result = await buildSite({ projectRoot: base.project.root, outputName: 'dist' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(fs.existsSync(backup), false);
  assert.equal(fs.existsSync(path.join(base.project.root, '.dist.transaction.json')), false);
});

test('a promoted transaction with dist missing restores backup and reports recovery required', async (t) => {
  const base = await makeBuiltProject(t);
  const runId = 'c'.repeat(32);
  const backup = path.join(base.project.root, `.dist.backup-${runId}`);
  fs.cpSync(base.dist, backup, { recursive: true });
  fs.rmSync(path.join(backup, 'old-sentinel.txt'));
  fs.rmSync(base.dist, { recursive: true, force: true });
  writeTransaction(base.project.root, {
    schemaVersion: 1,
    run_id: runId,
    output_name: 'dist',
    phase: 'promoted',
    had_previous: true,
    previous_manifest_sha256: base.manifestHash,
    candidate_manifest_sha256: base.manifestHash,
  });
  const result = await buildSite({ projectRoot: base.project.root, outputName: 'dist' });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((item) => item.code === 'E_RECOVERY_REQUIRED'));
  assert.equal(sha256(fs.readFileSync(path.join(base.dist, 'manifest.json'))), base.manifestHash);
  assert.equal(fs.existsSync(path.join(base.project.root, '.dist.transaction.json')), true);
});

test('a damaged transaction fails closed without guessing or deleting the old dist', async (t) => {
  const base = await makeBuiltProject(t);
  fs.writeFileSync(path.join(base.project.root, '.dist.transaction.json'), '{broken');
  const result = await buildSite({ projectRoot: base.project.root, outputName: 'dist' });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((item) => item.code === 'E_RECOVERY_REQUIRED'));
  assertOldDistUnchanged(base);
  assert.equal(fs.existsSync(path.join(base.project.root, '.dist.transaction.json')), true);
});

test('unknown temporary paths are not removed by a successful build', async (t) => {
  const base = await makeBuiltProject(t);
  const unknownStage = path.join(base.project.root, '.dist.stage-unknown');
  const unknownBackup = path.join(base.project.root, '.dist.backup-unknown');
  fs.mkdirSync(unknownStage);
  fs.mkdirSync(unknownBackup);
  const result = await buildSite({ projectRoot: base.project.root, outputName: 'dist' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(fs.existsSync(unknownStage), true);
  assert.equal(fs.existsSync(unknownBackup), true);
});
