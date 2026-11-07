const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createDiagnostic,
  POLICY_VERSION,
  readFrontmatter,
  scanSecrets,
} = require('../../scripts/lib/validate');
const { privateKeyBlock, secretToken } = require('../support/validation-project');

function codes(text) {
  return scanSecrets(text, { slug: 'sample-skill', path: 'skills/sample-skill.md' }).map(
    (item) => item.code,
  );
}

function secretDiagnostics(text) {
  return scanSecrets(text, { slug: 'sample-skill', path: 'skills/sample-skill.md' });
}

test('secret policy is versioned and fixed at policyVersion 1', () => {
  assert.equal(POLICY_VERSION, 1);
});

test('SECRET-01 rejects private key bodies but allows an explicit placeholder', () => {
  assert.deepEqual(codes(privateKeyBlock('bXlzZWNyZXQ=')), ['E_SECRET']);
  assert.deepEqual(codes(privateKeyBlock('YOUR_PRIVATE_KEY_HERE')), []);
  assert.deepEqual(codes(privateKeyBlock('<REDACTED>')), []);
  assert.deepEqual(codes(['-----BEGIN RSA PRIVATE KEY-----', 'bXlzZWNyZXQ='].join('\n')), [
    'E_SECRET',
  ]);
});

test('SECRET-02 boundary is twenty characters and has no placeholder exception', () => {
  assert.deepEqual(codes(secretToken('ghp_', 19)), []);
  assert.deepEqual(codes(secretToken('ghp_', 20)), ['E_SECRET']);
  assert.deepEqual(codes(secretToken('sk-', 20)), ['E_SECRET']);
  assert.deepEqual(codes(secretToken('ghp_', 20).replace('A', 'YOUR_')), ['E_SECRET']);
});

test('SECRET-03 checks literal assignments, placeholders and does not evaluate expressions', () => {
  assert.deepEqual(codes('password=YOUR_PASSWORD_HERE\n'), []);
  assert.deepEqual(codes('password: "***"\n'), []);
  assert.deepEqual(codes('api_key=${MY_API_KEY}\n'), []);
  assert.deepEqual(codes('password=hunter2\n'), ['E_SECRET']);
  assert.deepEqual(codes('{"access_token":"real-token"}\n'), ['E_SECRET']);
  assert.deepEqual(codes('password=getSecret()\n'), []);
  assert.deepEqual(codes('authorization: Bearer real-token\n'), ['E_SECRET']);
  assert.deepEqual(codes('authorization: Bearer YOUR_TOKEN_HERE\n'), []);
});

test('SECRET-04 inspects URL userinfo locally and allows only placeholders', () => {
  assert.deepEqual(codes('https://user:realpass@example.com/path\n'), ['E_SECRET']);
  assert.deepEqual(codes('https://user:YOUR_PASSWORD_HERE@example.com/path\n'), []);
  assert.deepEqual(codes('https://user@example.com/path\n'), ['E_SECRET']);
  assert.deepEqual(codes('https://example.com/path\n'), []);
});

test('secret diagnostics redact the value and only expose safe positions', () => {
  const value = 'hunter2-private-value';
  const diagnostics = secretDiagnostics(`password=${value}\n`);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'E_SECRET');
  assert.equal(JSON.stringify(diagnostics).includes(value), false);
  assert.equal(diagnostics[0].path, 'skills/sample-skill.md');
  assert.equal(diagnostics[0].slug, 'sample-skill');
  assert.equal(diagnostics[0].severity, 'error');
});

test('frontmatter rejects invalid UTF-8, unclosed input, duplicate keys and custom tags', () => {
  const invalid = readFrontmatter(Buffer.from([0xff, 0xfe, 0xfd]));
  assert.equal(invalid.ok, false);
  assert.ok(invalid.diagnostics.some((item) => item.code === 'E_UTF8'));

  const unclosed = readFrontmatter(Buffer.from('---\nname: 样例\n正文\n'));
  assert.equal(unclosed.ok, false);
  assert.ok(unclosed.diagnostics.some((item) => item.code === 'E_YAML'));

  const duplicate = readFrontmatter(Buffer.from('---\nname: a\nname: b\n---\n'));
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.diagnostics.some((item) => item.code === 'E_YAML'));

  const custom = readFrontmatter(Buffer.from('---\nvalue: !custom foo\n---\n'));
  assert.equal(custom.ok, false);
  assert.ok(custom.diagnostics.some((item) => item.code === 'E_YAML'));
});

test('diagnostics use a closed field set and never echo unknown data', () => {
  const diagnostic = createDiagnostic('E_SECRET', {
    slug: 'sample-skill',
    path: 'skills/sample-skill.md',
    line: 4,
    message: '检测到疑似凭证',
    value: 'must not leak',
    raw: { secret: 'must not leak' },
  });
  assert.deepEqual(diagnostic, {
    code: 'E_SECRET',
    slug: 'sample-skill',
    path: 'skills/sample-skill.md',
    line: 4,
    message: '检测到疑似凭证',
    severity: 'error',
  });
  assert.equal(JSON.stringify(diagnostic).includes('must not leak'), false);
});
