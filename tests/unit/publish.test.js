'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  evaluateDeployTarget,
  createRunStatus,
  renderSummary,
  verifyArtifact,
} = require('../../scripts/lib/publish');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function writeArtifact(root, relativePath, bytes = 'x') {
  const target = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8');
  return { path: relativePath, size: buffer.length, sha256: sha256(buffer) };
}

function writeManifest(root, manifest) {
  fs.writeFileSync(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function createDist({ revision = 'rev-1' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-unit-'));
  const digest = 'a'.repeat(64);
  const artifacts = [
    writeArtifact(root, 'index.html', '<html></html>'),
    writeArtifact(root, '.nojekyll', ''),
    writeArtifact(
      root,
      'assets/search-index.json',
      `${JSON.stringify({
        schemaVersion: 1,
        contentRevision: revision,
        skills: [{ slug: 'alpha', digest }],
      })}\n`,
    ),
    writeArtifact(
      root,
      'details/alpha.json',
      `${JSON.stringify({ schemaVersion: 1, contentRevision: revision, slug: 'alpha', digest })}\n`,
    ),
  ];
  const manifest = { schemaVersion: 1, contentRevision: revision, skills: [], artifacts };
  writeManifest(root, manifest);
  return { root, manifest };
}

function addArtifact(root, manifest, relativePath, bytes) {
  const item = writeArtifact(root, relativePath, bytes);
  manifest.artifacts.push(item);
  manifest.artifacts.sort((left, right) => left.path.localeCompare(right.path));
  writeManifest(root, manifest);
  return item;
}

function rewriteManifest(root, manifest) {
  manifest.artifacts.sort((left, right) => left.path.localeCompare(right.path));
  writeManifest(root, manifest);
}

test('verifyArtifact accepts a complete same-revision artifact', (t) => {
  const dist = createDist();
  t.after(() => fs.rmSync(dist.root, { recursive: true, force: true }));

  const result = verifyArtifact(dist.root);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.status, 'verified');
  assert.equal(result.content_revision, 'rev-1');
  assert.ok(result.files >= 5);
  assert.deepEqual(result.diagnostics, []);
});

test('verifyArtifact rejects extra files, tampering, hidden files and forbidden paths', () => {
  const cases = [
    {
      name: 'extra allowed file',
      mutate(dist) {
        writeArtifact(dist.root, 'assets/extra.js', 'x');
      },
      code: 'E_ARTIFACT_EXTRA_FILE',
    },
    {
      name: 'tampered bytes',
      mutate(dist) {
        fs.appendFileSync(path.join(dist.root, 'index.html'), 'tampered');
      },
      code: 'E_ARTIFACT_HASH',
    },
    {
      name: 'hidden file',
      mutate(dist) {
        writeArtifact(dist.root, 'assets/.hidden', 'x');
      },
      code: 'E_ARTIFACT_HIDDEN',
    },
    {
      name: 'forbidden path',
      mutate(dist) {
        const item = writeArtifact(dist.root, 'docs/plan.md', 'x');
        dist.manifest.artifacts.push(item);
        rewriteManifest(dist.root, dist.manifest);
      },
      code: 'E_ARTIFACT_PATH',
    },
    {
      name: 'path traversal',
      mutate(dist) {
        dist.manifest.artifacts.push({
          path: '../escape',
          size: 1,
          sha256: sha256(Buffer.from('x')),
        });
        rewriteManifest(dist.root, dist.manifest);
      },
      code: 'E_ARTIFACT_PATH',
    },
    {
      name: 'duplicate path',
      mutate(dist) {
        dist.manifest.artifacts.push({ ...dist.manifest.artifacts[0] });
        rewriteManifest(dist.root, dist.manifest);
      },
      code: 'E_ARTIFACT_DUPLICATE',
    },
    {
      name: 'content revision mismatch',
      mutate(dist) {
        const detail = path.join(dist.root, 'details/alpha.json');
        fs.writeFileSync(
          detail,
          `${JSON.stringify({ schemaVersion: 1, contentRevision: 'rev-2', slug: 'alpha', digest: 'a'.repeat(64) })}\n`,
        );
        const artifact = dist.manifest.artifacts.find((item) => item.path === 'details/alpha.json');
        const bytes = fs.readFileSync(detail);
        artifact.size = bytes.length;
        artifact.sha256 = sha256(bytes);
        rewriteManifest(dist.root, dist.manifest);
      },
      code: 'E_ARTIFACT_SNAPSHOT',
    },
  ];

  for (const item of cases) {
    const dist = createDist();
    try {
      item.mutate(dist);
      const result = verifyArtifact(dist.root);
      assert.equal(result.ok, false, item.name);
      assert.equal(result.status, 'failed', item.name);
      assert.equal(result.diagnostics[0].code, item.code, item.name);
    } finally {
      fs.rmSync(dist.root, { recursive: true, force: true });
    }
  }
});

test('verifyArtifact rejects symlinks when the platform permits creating them', (t) => {
  const dist = createDist();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-unit-outside-'));
  t.after(() => {
    fs.rmSync(dist.root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  try {
    fs.symlinkSync(path.join(outside, 'target'), path.join(dist.root, 'assets/link.js'));
  } catch {
    t.skip('symlink creation is unavailable in this environment');
    return;
  }
  const result = verifyArtifact(dist.root);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'E_ARTIFACT_SYMLINK');
});

test('verifyArtifact rejects credential-like paths and secret content without echoing values', (t) => {
  const dist = createDist();
  t.after(() => fs.rmSync(dist.root, { recursive: true, force: true }));

  addArtifact(dist.root, dist.manifest, '.env', 'YOUR_API_KEY_HERE');
  const result = verifyArtifact(dist.root);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'E_ARTIFACT_CREDENTIAL_PATH');

  const second = createDist();
  t.after(() => fs.rmSync(second.root, { recursive: true, force: true }));
  const privateKey = [
    ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' '),
    'not-a-real-key-material',
    ['-----END', 'RSA PRIVATE KEY-----'].join(' '),
  ].join('\n');
  addArtifact(second.root, second.manifest, 'assets/private.txt', privateKey);
  const secret = verifyArtifact(second.root);
  assert.equal(secret.ok, false);
  assert.equal(secret.diagnostics[0].code, 'E_SECRET');
  assert.doesNotMatch(JSON.stringify(secret), /not-a-real-key-material/);
});

test('evaluateDeployTarget returns current, superseded and invalid input states', () => {
  const sha = 'a'.repeat(40);
  const other = 'b'.repeat(40);

  const current = evaluateDeployTarget({ targetSha: sha, remoteHead: sha });
  assert.equal(current.ok, true);
  assert.equal(current.decision, 'current');

  const superseded = evaluateDeployTarget({ targetSha: sha, remoteHead: other });
  assert.equal(superseded.ok, false);
  assert.equal(superseded.decision, 'superseded');

  const invalid = evaluateDeployTarget({ targetSha: 'not-a-sha', remoteHead: other });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.diagnostics[0].code, 'E_TARGET_SHA');
});

test('createRunStatus keeps a closed schema, validates enums and times', () => {
  const status = createRunStatus({
    runId: 'run-1',
    trigger: 'push',
    targetSha: 'a'.repeat(40),
    commitStatus: 'committed',
    contentRevision: 'rev-1',
    contentStatus: 'built',
    deployStatus: 'published',
    reason: null,
    startedAt: '2026-11-07T00:00:00Z',
    finishedAt: '2026-11-07T00:01:00Z',
    runUrl: 'https://github.com/example/skill-gallery/actions/runs/1',
  });
  assert.equal(status.ok, true, JSON.stringify(status.diagnostics));
  assert.equal(status.status.commit_status, 'committed');
  assert.equal(status.status.content_status, 'built');
  assert.equal(status.status.deploy_status, 'published');
  assert.equal(status.status.started_at, '2026-11-07T00:00:00Z');

  const unknownKey = createRunStatus({ runId: 'run-1', unexpected: true });
  assert.equal(unknownKey.ok, false);

  const invalidEnum = createRunStatus({
    runId: 'run-1',
    trigger: 'push',
    targetSha: 'a'.repeat(40),
    commitStatus: 'unknown',
    contentRevision: null,
    contentStatus: 'pending',
    deployStatus: 'pending',
    reason: null,
    startedAt: null,
    finishedAt: null,
    runUrl: null,
  });
  assert.equal(invalidEnum.ok, false);

  const invalidTime = createRunStatus({
    runId: 'run-1',
    trigger: 'push',
    targetSha: 'a'.repeat(40),
    commitStatus: 'not_applicable',
    contentRevision: null,
    contentStatus: 'pending',
    deployStatus: 'pending',
    reason: null,
    startedAt: 'yesterday',
    finishedAt: null,
    runUrl: null,
  });
  assert.equal(invalidTime.ok, false);
});

test('renderSummary shows separated statuses without leaking untrusted reason values', () => {
  const status = {
    run_id: 'run-1',
    trigger: 'push',
    target_sha: 'a'.repeat(40),
    commit_status: 'committed',
    content_revision: 'rev-1',
    content_status: 'built',
    deploy_status: 'failed',
    reason: 'token=ghp_RUNTIME_ONLY_VALUE',
    started_at: '2026-11-07T00:00:00Z',
    finished_at: '2026-11-07T00:01:00Z',
    run_url: 'https://github.com/example/skill-gallery/actions/runs/1',
  };
  const summary = renderSummary(status, {});
  assert.match(summary, /committed/);
  assert.match(summary, /built/);
  assert.match(summary, /failed/);
  assert.match(summary, /actions\/runs\/1/);
  assert.doesNotMatch(summary, /ghp_RUNTIME_ONLY_VALUE/);
});
