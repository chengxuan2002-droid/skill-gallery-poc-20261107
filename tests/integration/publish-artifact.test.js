'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createPublishFixtureProject } = require('../support/publish-fixture');
const { verifyArtifact } = require('../../scripts/lib/publish');

function assertUnchanged(before, after) {
  assert.deepEqual([...after.entries()], [...before.entries()]);
}

test('valid built artifact has one revision and passes verification', async (t) => {
  const project = createPublishFixtureProject();
  t.after(() => project.cleanup());
  const built = await project.buildDist();
  assert.equal(built.ok, true, JSON.stringify(built.diagnostics));

  const result = verifyArtifact(built.distDir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.status, 'verified');
  assert.equal(result.content_revision, project.readManifest().contentRevision);

  const manifest = project.readManifest();
  const index = JSON.parse(
    fs.readFileSync(path.join(built.distDir, 'assets/search-index.json'), 'utf8'),
  );
  assert.equal(index.contentRevision, manifest.contentRevision);
  for (const item of index.skills) {
    const detail = JSON.parse(
      fs.readFileSync(path.join(built.distDir, 'details', `${item.slug}.json`), 'utf8'),
    );
    assert.equal(detail.contentRevision, manifest.contentRevision);
    assert.equal(detail.slug, item.slug);
    assert.equal(detail.digest, item.digest);
  }
});

test('extra files, tampering, credentials and stale revisions fail closed without changing dist', async () => {
  const cases = [
    {
      name: 'extra file',
      mutate(project, built) {
        project.injectExtraFile('assets/extra.js', 'extra\n', built.distDir);
      },
      code: 'E_ARTIFACT_EXTRA_FILE',
    },
    {
      name: 'tampered bytes',
      mutate(project, built) {
        project.tamperFile('index.html', 'tampered', built.distDir);
      },
      code: 'E_ARTIFACT_HASH',
    },
    {
      name: 'credential path',
      mutate(project, built) {
        project.writeCredentialFile('.env', 'YOUR_API_KEY_HERE', built.distDir);
      },
      code: 'E_ARTIFACT_CREDENTIAL_PATH',
    },
    {
      name: 'stale revision',
      mutate(project, built) {
        const detailPath = path.join(built.distDir, 'details/complete-detail.json');
        const detail = JSON.parse(fs.readFileSync(detailPath, 'utf8'));
        detail.contentRevision = 'stale-revision';
        const bytes = Buffer.from(`${JSON.stringify(detail, null, 2)}\n`, 'utf8');
        fs.writeFileSync(detailPath, bytes);
        const manifestPath = path.join(built.distDir, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const artifact = manifest.artifacts.find(
          (item) => item.path === 'details/complete-detail.json',
        );
        artifact.size = bytes.length;
        artifact.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
        fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      },
      code: 'E_ARTIFACT_SNAPSHOT',
    },
  ];

  for (const item of cases) {
    const project = createPublishFixtureProject();
    try {
      const built = await project.buildDist();
      assert.equal(built.ok, true, item.name);
      item.mutate(project, built);
      const before = project.snapshotDist(built.distDir);
      const result = verifyArtifact(built.distDir);
      assert.equal(result.ok, false, item.name);
      assert.equal(result.status, 'failed', item.name);
      assert.equal(result.diagnostics[0].code, item.code, item.name);
      assertUnchanged(before, project.snapshotDist(built.distDir));
    } finally {
      project.cleanup();
    }
  }
});

test('unchanged rebuild keeps the revision and artifact set stable', async (t) => {
  const project = createPublishFixtureProject();
  t.after(() => project.cleanup());
  const first = await project.buildDist();
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  const firstRevision = project.readManifest().contentRevision;
  const firstSnapshot = project.snapshotDist(first.distDir);

  const second = await project.buildDist();
  assert.equal(second.ok, true, JSON.stringify(second.diagnostics));
  assert.equal(project.readManifest().contentRevision, firstRevision);
  assertUnchanged(firstSnapshot, project.snapshotDist(second.distDir));

  const result = verifyArtifact(second.distDir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
});

test('a missing attachment fails the rebuild and preserves the previous dist', async (t) => {
  const project = createPublishFixtureProject();
  t.after(() => project.cleanup());
  const first = await project.buildDist();
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  const before = project.snapshotDist(first.distDir);

  fs.rmSync(path.join(project.root, 'skills/complete-detail/references/guide.md'));
  const second = await project.buildDist();
  assert.equal(second.ok, false);
  assertUnchanged(before, project.snapshotDist(first.distDir));
});

test('an invalid catalog entry fails the rebuild and preserves the previous dist', async (t) => {
  const project = createPublishFixtureProject();
  t.after(() => project.cleanup());
  const first = await project.buildDist();
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  const before = project.snapshotDist(first.distDir);

  fs.writeFileSync(path.join(project.root, 'catalog/complete-detail.json'), '{invalid');
  const second = await project.buildDist();
  assert.equal(second.ok, false);
  assertUnchanged(before, project.snapshotDist(first.distDir));
});
