const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');

test('unknown commands fail closed with a safe JSON diagnostic', () => {
  const result = spawnSync(process.execPath, ['scripts/check-project.js', 'unknown'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.deepEqual(JSON.parse(result.stdout), {
    check: 'unknown',
    status: 'error',
    code: 'INVALID_CHECK',
  });
  assert.equal(result.stderr, '');
});

test('scanner findings expose positions and rules without source or credential fields', () => {
  const { summarize } = require('../../scripts/check-project');
  const report = {
    results: [
      {
        path: 'assets/app.js',
        start: { line: 3 },
        check_id: 'no-eval',
        extra: { severity: 'ERROR', lines: 'YOUR_API_KEY_HERE', message: 'private context' },
      },
    ],
    errors: [],
    paths: { scanned: ['assets/app.js'] },
  };
  const summary = summarize('code', report, 1, ['assets/app.js'], '/snapshot');
  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.findings, [
    { path: 'assets/app.js', line: 3, rule: 'no-eval', severity: 'error' },
  ]);
  assert.equal(JSON.stringify(summary).includes('YOUR_API_KEY_HERE'), false);
  assert.equal(JSON.stringify(summary).includes('private context'), false);
});

test('malformed reports, skipped targets and scanner errors cannot become clean scans', () => {
  const { summarize } = require('../../scripts/check-project');
  for (const report of [
    null,
    {},
    {
      results: [],
      errors: [{ message: 'private context' }],
      paths: { scanned: ['assets/app.js'] },
    },
    { results: [], errors: [], paths: { scanned: [] } },
  ]) {
    assert.throws(() => summarize('code', report, 0, ['assets/app.js'], '/snapshot'));
  }
  assert.throws(() => summarize('secrets', [], 1, ['assets/app.js'], '/snapshot'));
});

test('report paths cannot expose files outside the enumerated scan targets', () => {
  const { summarize } = require('../../scripts/check-project');
  assert.throws(() =>
    summarize(
      'secrets',
      [{ File: '../../private', StartLine: 1, RuleID: 'generic-api-key' }],
      1,
      ['assets/app.js'],
      '/snapshot',
    ),
  );
});

test('tampered scanner archives are rejected before installation', () => {
  const { verifyArchive } = require('../../scripts/setup-security-tools');
  assert.throws(
    () => verifyArchive(Buffer.from('tampered'), '0'.repeat(64)),
    /ARCHIVE_HASH_MISMATCH/,
  );
});

test('malformed finding fields cannot smuggle raw nested data into diagnostics', () => {
  const { summarize } = require('../../scripts/check-project');
  assert.throws(() =>
    summarize(
      'secrets',
      [
        {
          File: 'assets/app.js',
          StartLine: { source: 'YOUR_API_KEY_HERE' },
          RuleID: 'generic-api-key',
        },
      ],
      1,
      ['assets/app.js'],
      '/snapshot',
    ),
  );
});
