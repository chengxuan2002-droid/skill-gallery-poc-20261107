const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const checker = path.join(root, 'scripts/check-project.js');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-gallery-check-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of [
    'package.json',
    'package-lock.json',
    '.gitignore',
    '.gitleaks.toml',
    '.prettierrc.json',
    '.prettierignore',
    'eslint.config.mjs',
    'config/security-tools.json',
    'config/semgrep.yml',
  ]) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.copyFileSync(path.join(root, name), path.join(dir, name));
  }
  for (const name of ['node_modules', '.tools'])
    fs.symlinkSync(
      path.join(root, name),
      path.join(dir, name),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  for (const name of ['assets', 'scripts', 'tests/unit', 'tests/integration'])
    fs.mkdirSync(path.join(dir, name), { recursive: true });
  const git = spawnSync('git', ['init', '--quiet'], { cwd: dir });
  assert.equal(git.status, 0);
  return dir;
}

function scan(dir, kind, env = process.env) {
  const result = spawnSync(process.execPath, [checker, kind], {
    cwd: dir,
    env,
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.stderr, '');
  return { code: result.status, report: JSON.parse(result.stdout), output: result.stdout };
}

test('real lint and formatting gates reject invalid owned code without checking collected data', (t) => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'assets/app.js'), 'unknownGlobal = 1;\n');
  const lint = spawnSync(
    process.execPath,
    [path.join(root, 'node_modules/eslint/bin/eslint.js'), 'assets/app.js'],
    { cwd: dir },
  );
  assert.equal(lint.status, 1);
  fs.writeFileSync(path.join(dir, 'assets/app.js'), 'const  value={x:1};console.log(value)');
  const format = spawnSync(
    process.execPath,
    [path.join(root, 'node_modules/prettier/bin/prettier.cjs'), '--check', 'assets/app.js'],
    { cwd: dir },
  );
  assert.equal(format.status, 1);
  const skill = path.join(dir, 'skills/untrusted/broken.js');
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, 'unparseable {{{ data');
  const ignored = spawnSync(
    process.execPath,
    [path.join(root, 'node_modules/eslint/bin/eslint.js'), 'skills/untrusted/broken.js'],
    { cwd: dir },
  );
  assert.equal(ignored.status, 0);
  assert.equal(fs.readFileSync(skill, 'utf8'), 'unparseable {{{ data');
});

test('npm test runs only trusted unit and integration tests, leaving the Skill sentinel untouched', (t) => {
  const dir = fixture(t);
  const body = (marker) =>
    `require('node:test')('marker', () => require('node:fs').writeFileSync('${marker}', 'ran'));\n`;
  fs.writeFileSync(path.join(dir, 'tests/unit/one.test.js'), body('unit-ran'));
  fs.writeFileSync(path.join(dir, 'tests/integration/one.test.js'), body('integration-ran'));
  fs.mkdirSync(path.join(dir, 'skills/untrusted'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'skills/untrusted/never.test.js'), body('SKILL_EXECUTED'));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['test'], {
    cwd: dir,
    env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  assert.equal(result.status, 0);
  assert.equal(fs.existsSync(path.join(dir, 'unit-ran')), true, result.stdout + result.stderr);
  assert.equal(fs.existsSync(path.join(dir, 'integration-ran')), true);
  assert.equal(fs.existsSync(path.join(dir, 'SKILL_EXECUTED')), false);
});

test('Gitleaks scans new owned and tracked original files, redacts findings and excludes unmanaged Skills', (t) => {
  const dir = fixture(t);
  // Clearly synthetic token for offline scanner verification; never authenticate with it.
  // Gitleaks deliberately ignores the literal alphabet sequence as an example stopword.
  const fake = 'ghp_' + 'FAKEonlyNotARealCredential0123456789';
  const clean = 'const value = "YOUR_API_KEY_HERE";\n';
  fs.writeFileSync(path.join(dir, 'assets/app.js'), clean);
  fs.mkdirSync(path.join(dir, 'skills/office2md'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'skills/office2md/untouched.md'), fake);
  const cleanScan = scan(dir, 'secrets');
  assert.equal(cleanScan.code, 0, JSON.stringify(cleanScan.report));
  fs.writeFileSync(path.join(dir, 'assets/app.js'), `const fake = "${fake}";\n`);
  const owned = scan(dir, 'secrets');
  assert.equal(owned.code, 1);
  assert.equal(
    owned.report.findings.some((f) => f.path === 'assets/app.js'),
    true,
  );
  assert.equal(owned.output.includes(fake), false);
  fs.writeFileSync(path.join(dir, 'assets/app.js'), clean);
  fs.writeFileSync(path.join(dir, 'skills/public.md'), fake);
  assert.equal(spawnSync('git', ['add', 'skills/public.md'], { cwd: dir }).status, 0);
  const original = scan(dir, 'secrets');
  assert.equal(original.code, 1);
  assert.equal(
    original.report.findings.some((f) => f.path === 'skills/public.md'),
    true,
  );
  assert.equal(fs.readFileSync(path.join(dir, 'skills/public.md'), 'utf8'), fake);
  assert.equal(fs.readFileSync(path.join(dir, 'skills/office2md/untouched.md'), 'utf8'), fake);
});

test('Semgrep blocks dangerous owned code and invalid rules instead of silently succeeding', (t) => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'assets/app.js'), 'console.log("safe");\n');
  assert.equal(scan(dir, 'code').code, 0);
  fs.writeFileSync(path.join(dir, 'assets/app.js'), 'eval("1 + 1");\n');
  const bad = scan(dir, 'code');
  assert.equal(bad.code, 1);
  assert.equal(
    bad.report.findings.some((f) => f.rule.endsWith('skill-gallery-no-eval')),
    true,
  );
  fs.writeFileSync(path.join(dir, 'config/semgrep.yml'), 'rules: not-valid\n');
  assert.equal(scan(dir, 'code').code, 2);
});

test('audit registry failures remain failures and raw subprocess diagnostics stay private', (t) => {
  const dir = fixture(t);
  fs.mkdirSync(path.join(dir, 'bin'));
  const shim = path.join(dir, 'bin/npm');
  const argsFile = path.join(dir, 'npm-args.json');
  fs.writeFileSync(
    shim,
    [
      '#!/usr/bin/env node',
      `require('node:fs').writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));`,
      'console.log(JSON.stringify({error: {code: "EAI_AGAIN", summary: "YOUR_API_KEY_HERE"}}));',
      'console.error("private registry context");',
      'process.exit(1);',
    ].join('\n'),
    { mode: 0o700 },
  );
  if (process.platform === 'win32') {
    fs.writeFileSync(`${shim}.cmd`, `@echo off\r\n"${process.execPath}" "%~dp0npm" %*\r\n`);
  }
  const result = scan(dir, 'deps', {
    ...process.env,
    PATH: path.join(dir, 'bin') + path.delimiter + process.env.PATH,
  });
  assert.equal(result.code, 2);
  assert.equal(result.report.status, 'error');
  assert.equal(result.report.code, 'AUDIT_UNAVAILABLE');
  assert.equal(result.output.includes('YOUR_API_KEY_HERE'), false);
  assert.equal(result.output.includes('private registry context'), false);
  const args = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
  assert.equal(args.includes('--registry'), true);
  assert.equal(args.includes('https://registry.npmjs.org/'), true);
});
