'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const script = path.join(root, 'scripts/publish-check.js');
const currentSha = 'a'.repeat(40);
const otherSha = 'b'.repeat(40);

function runTarget(args) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-target-'));
  try {
    const result = spawnSync(process.execPath, [script, 'target', ...args], {
      cwd,
      encoding: 'utf8',
    });
    assert.deepEqual(fs.readdirSync(cwd), [], 'target check must not write files');
    return result;
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

function readSingleJson(stdout) {
  const lines = stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, 'stdout must be one machine-readable line');
  return JSON.parse(lines[0]);
}

test('current target returns 0 without writing or deploying', () => {
  const result = runTarget(['--target', currentSha, '--remote', currentSha]);
  const output = readSingleJson(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(output.decision, 'current');
  assert.equal(output.target_sha, currentSha);
  assert.equal(output.remote_head, currentSha);
  assert.deepEqual(output.diagnostics, []);
  assert.equal(result.stderr, '');
});

test('stale target returns 4 and reports superseded without publishing', () => {
  const result = runTarget(['--target', currentSha, '--remote', otherSha]);
  const output = readSingleJson(result.stdout);

  assert.equal(result.status, 4, result.stderr);
  assert.equal(output.decision, 'superseded');
  assert.equal(output.target_sha, currentSha);
  assert.equal(output.remote_head, otherSha);
  assert.deepEqual(output.diagnostics, []);
  assert.equal(result.stderr, '');
});

test('invalid SHA returns 2 with a stable diagnostic', () => {
  const result = runTarget(['--target', 'not-a-sha', '--remote', currentSha]);
  const output = readSingleJson(result.stdout);

  assert.equal(result.status, 2, result.stderr);
  assert.equal(output.decision, null);
  assert.equal(output.diagnostics[0].code, 'E_TARGET_SHA');
  assert.match(result.stderr, /E_TARGET_SHA/);
});

test('target check has no deployment, network or repository write path', () => {
  const cli = fs.readFileSync(script, 'utf8');
  const library = fs.readFileSync(path.join(root, 'scripts/lib/publish.js'), 'utf8');
  const source = `${cli}\n${library}`;

  assert.doesNotMatch(source, /deploy-pages|upload-pages|ls-remote|git\s+push|git\s+reset/i);
  assert.doesNotMatch(
    source,
    /child_process|node:(?:http|https)|require\(['"](?:http|https)['"]\)/,
  );
});
