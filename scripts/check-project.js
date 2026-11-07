const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const AUDIT_REGISTRY = 'https://registry.npmjs.org/';

function command(binary, args, cwd, extra = {}) {
  const result = spawnSync(binary, args, {
    cwd,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, SEMGREP_SEND_METRICS: 'off', SEMGREP_ENABLE_VERSION_CHECK: '0' },
    ...extra,
  });
  if (result.error || result.signal) throw new Error('TOOL_UNAVAILABLE');
  return result;
}

function npmCommand(args, cwd) {
  if (process.platform === 'win32') return command('npm.cmd', args, cwd, { shell: true });
  return command('npm', args, cwd);
}

function scannerBinary(root, name) {
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  return path.join(root, '.tools/bin', executable);
}

function listFiles(root) {
  const tracked = command('git', ['ls-files', '-z', '--cached'], root);
  const candidates = command(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    root,
  );
  if (tracked.status !== 0 || candidates.status !== 0) throw new Error('SCOPE_UNAVAILABLE');
  const known = new Set(tracked.stdout.split('\0'));
  return [...new Set(candidates.stdout.split('\0').filter(Boolean))]
    .filter((name) => !name.startsWith('skills/') || known.has(name))
    .filter((name) => !/^(node_modules|\.tools|dist|vendor)(\/|$)/.test(name))
    .filter((name) => name !== 'assets/search-index.json')
    .sort();
}

function reportPath(value, files, snapshot) {
  if (typeof value !== 'string') throw new Error('REPORT_INVALID');
  const relative = (path.isAbsolute(value) ? path.relative(snapshot, value) : value)
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  if (!files.includes(relative)) throw new Error('REPORT_SCOPE_INVALID');
  return relative;
}

function summarize(check, report, exit, files, snapshot) {
  let findings;
  if (check === 'secrets') {
    if (report === null && exit === 0) report = [];
    if (!Array.isArray(report) || ![0, 1].includes(exit)) throw new Error('REPORT_INVALID');
    findings = report.map((f) => ({
      path: reportPath(f.File, files, snapshot),
      line: f.StartLine,
      rule: f.RuleID,
      severity: 'error',
    }));
    if (exit !== 0 && !findings.length) throw new Error('SCANNER_FAILED');
  } else if (check === 'code') {
    if (
      !Array.isArray(report?.results) ||
      !Array.isArray(report.errors) ||
      !Array.isArray(report.paths?.scanned)
    )
      throw new Error('REPORT_INVALID');
    if (report.errors.length || ![0, 1].includes(exit)) throw new Error('SCANNER_FAILED');
    const scanned = report.paths.scanned.map((p) => reportPath(p, files, snapshot));
    if (files.some((f) => !scanned.includes(f))) throw new Error('SCAN_INCOMPLETE');
    findings = report.results.map((f) => ({
      path: reportPath(f.path, files, snapshot),
      line: f.start.line,
      rule: f.check_id,
      severity: String(f.extra.severity).toLowerCase(),
    }));
    if (exit !== 0 && !findings.length) throw new Error('SCANNER_FAILED');
  } else {
    if (report?.error) throw new Error('AUDIT_UNAVAILABLE');
    if (report?.auditReportVersion !== 2 || !report.vulnerabilities || !report.metadata)
      throw new Error('REPORT_INVALID');
    findings = Object.entries(report.vulnerabilities).map(([name, item]) => ({
      path: 'package-lock.json',
      rule: name,
      severity: item.severity,
    }));
    const blocking = findings.some((f) => ['high', 'critical'].includes(f.severity));
    if (exit !== 0 && !blocking) throw new Error('AUDIT_UNAVAILABLE');
  }
  for (const finding of findings) {
    if (
      typeof finding.rule !== 'string' ||
      !/^[a-zA-Z0-9@/._-]{1,200}$/.test(finding.rule) ||
      !['info', 'warning', 'error', 'low', 'moderate', 'high', 'critical'].includes(
        finding.severity,
      )
    )
      throw new Error('REPORT_INVALID');
    if (check !== 'deps' && (!Number.isSafeInteger(finding.line) || finding.line < 1))
      throw new Error('REPORT_INVALID');
  }
  const failed =
    check === 'deps'
      ? findings.some((f) => ['high', 'critical'].includes(f.severity))
      : findings.length > 0;
  return { check, status: failed ? 'failed' : 'passed', files: files.length, findings };
}

function scan(check, root) {
  if (check === 'deps') {
    if (!fs.existsSync(path.join(root, 'package-lock.json'))) throw new Error('LOCK_MISSING');
    const result = npmCommand(
      ['audit', '--registry', AUDIT_REGISTRY, '--json', '--audit-level=high'],
      root,
    );
    return summarize(check, JSON.parse(result.stdout), result.status, ['package-lock.json'], root);
  }
  const tools = JSON.parse(fs.readFileSync(path.join(root, 'config/security-tools.json'), 'utf8'));
  const binary = scannerBinary(root, check === 'secrets' ? 'gitleaks' : 'semgrep');
  const version = command(binary, [check === 'secrets' ? 'version' : '--version'], root);
  const expected = check === 'secrets' ? tools.gitleaks.version : tools.semgrep.version;
  if (version.status !== 0 || version.stdout.trim().replace(/^v/, '') !== expected)
    throw new Error('SCANNER_VERSION_MISMATCH');
  let files = listFiles(root);
  if (check === 'code')
    files = files.filter(
      (f) => /^(assets|scripts)\/.*\.(js|mjs|cjs)$/.test(f) || f === 'eslint.config.mjs',
    );
  if (!files.length) throw new Error('SCAN_EMPTY');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-gallery-scan-'));
  const snapshot = path.join(temp, 'input');
  fs.mkdirSync(snapshot, { mode: 0o700 });
  try {
    for (const file of files) {
      const source = path.join(root, file);
      const components = file.split('/');
      for (let i = 1; i <= components.length; i++) {
        if (fs.lstatSync(path.join(root, ...components.slice(0, i))).isSymbolicLink())
          throw new Error('SCAN_LINK_REJECTED');
      }
      if (!fs.lstatSync(source).isFile()) throw new Error('SCAN_FILE_INVALID');
      fs.mkdirSync(path.dirname(path.join(snapshot, file)), { recursive: true });
      fs.copyFileSync(source, path.join(snapshot, file));
    }
    let result;
    let report;
    if (check === 'secrets') {
      const output = path.join(temp, 'report.json');
      result = command(
        binary,
        [
          'dir',
          '.',
          '--config',
          path.join(root, '.gitleaks.toml'),
          '--redact=100',
          '--ignore-gitleaks-allow',
          '--no-banner',
          '--report-format=json',
          '--report-path',
          output,
        ],
        snapshot,
      );
      report = JSON.parse(fs.readFileSync(output, 'utf8'));
    } else {
      result = command(
        binary,
        [
          'scan',
          '--config',
          path.join(root, 'config/semgrep.yml'),
          '--json',
          '--error',
          '--strict',
          '--metrics=off',
          '--disable-version-check',
          '--no-git-ignore',
          ...files,
        ],
        snapshot,
      );
      report = JSON.parse(result.stdout);
    }
    return summarize(check, report, result.status, files, snapshot);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const check = process.argv[2];
  try {
    if (!['secrets', 'code', 'deps'].includes(check)) throw new Error('INVALID_CHECK');
    const report = scan(check, process.cwd());
    console.log(JSON.stringify(report));
    process.exitCode = report.status === 'passed' ? 0 : 1;
  } catch (error) {
    const code = /^[A-Z_]+$/.test(error.message) ? error.message : 'CHECK_FAILED';
    console.log(
      JSON.stringify({
        check: ['secrets', 'code', 'deps'].includes(check) ? check : 'unknown',
        status: 'error',
        code,
      }),
    );
    process.exitCode = 2;
  }
}

module.exports = { summarize };
