#!/usr/bin/env node
const { evaluateDeployTarget, verifyArtifact } = require('./lib/publish');

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function usage(message) {
  writeJson({ status: 'failed', code: 'E_USAGE', message });
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}

function artifactOutput(result) {
  return {
    status: result.status,
    content_revision: result.content_revision,
    files: result.files,
    diagnostics: result.diagnostics,
  };
}

function parseOptions(args, names) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!names.includes(name) || value === undefined || value.startsWith('--')) {
      return null;
    }
    values[name] = value;
  }
  return values;
}

function runArtifact(args) {
  const options = parseOptions(args, ['--dist']);
  if (!options || !options['--dist']) {
    usage('用法：publish-check.js artifact --dist <dir>');
    return;
  }
  const result = verifyArtifact(options['--dist']);
  writeJson(artifactOutput(result));
  if (!result.ok) {
    process.stderr.write(`${result.diagnostics.map((item) => item.code).join(',')}\n`);
    process.exitCode = 6;
    return;
  }
  process.exitCode = 0;
}

function runTarget(args) {
  const options = parseOptions(args, ['--target', '--remote']);
  if (!options || !options['--target'] || !options['--remote']) {
    usage('用法：publish-check.js target --target <sha> --remote <sha>');
    return;
  }
  const result = evaluateDeployTarget({
    targetSha: options['--target'],
    remoteHead: options['--remote'],
  });
  writeJson({
    decision: result.decision,
    target_sha: result.target_sha,
    remote_head: result.remote_head,
    diagnostics: result.diagnostics,
  });
  if (result.diagnostics.length > 0) {
    process.stderr.write(`${result.diagnostics.map((item) => item.code).join(',')}\n`);
    process.exitCode = 2;
    return;
  }
  if (result.decision === 'superseded') {
    process.exitCode = 4;
    return;
  }
  process.exitCode = 0;
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === 'artifact') {
    runArtifact(args);
    return;
  }
  if (command === 'target') {
    runTarget(args);
    return;
  }
  usage('用法：publish-check.js artifact|target ...');
}

try {
  main(process.argv.slice(2));
} catch {
  writeJson({ status: 'failed', code: 'E_CLI', message: '发布检查失败' });
  process.exitCode = 2;
}
