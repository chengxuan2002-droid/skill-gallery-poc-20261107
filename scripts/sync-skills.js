#!/usr/bin/env node
'use strict';

const { runSync } = require('./lib/source-sync');
const { renderSummary, writeReport, writeSummary } = require('./lib/source-sync-report');

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const USAGE = `Usage: node scripts/sync-skills.js [options]

  --slug <slug>       Check or apply only one catalog slug
  --apply             Write validated candidates and create one batch commit
  --push              Push the batch commit (requires --apply)
  --json              Print one machine-readable JSON report to stdout
  --report <path>     Write the JSON report to a file
  --summary <path>    Append a sanitized Markdown summary to a file
  --help              Show this help
`;

function usageError(message) {
  return { ok: false, code: 'E_USAGE', message };
}

function value(args, index) {
  const item = args[index];
  return item === undefined || item.startsWith('--') ? null : item;
}

function parseArgs(argv) {
  const options = {
    slug: null,
    apply: false,
    push: false,
    json: false,
    report: null,
    summary: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') options.help = true;
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--push') options.push = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--slug') {
      const item = value(argv, ++index);
      if (!item) return usageError('--slug 需要值');
      if (!SLUG_PATTERN.test(item)) return usageError('--slug 不合规');
      options.slug = item;
    } else if (arg === '--report' || arg === '--summary') {
      const item = value(argv, ++index);
      if (!item) return usageError(`${arg} 需要路径`);
      options[arg.slice(2)] = item;
    } else {
      return usageError(`未知选项 ${arg}`);
    }
  }
  if (options.push && !options.apply) return usageError('--push 仅与 --apply 同用');
  return { ok: true, options };
}

function emit(report, options) {
  if (options.json) process.stdout.write(`${JSON.stringify(report)}\n`);
  else process.stdout.write(renderSummary(report));
  if (report.errors.length > 0) {
    process.stderr.write(`${report.errors.map((item) => item.code).join(',')}\n`);
  }
}

function main(argv) {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    process.stderr.write('E_USAGE\n');
    process.exitCode = 2;
    return;
  }
  if (parsed.options.help) {
    process.stdout.write(USAGE);
    return;
  }
  const result = runSync({
    projectRoot: process.cwd(),
    slug: parsed.options.slug,
    apply: parsed.options.apply,
    push: parsed.options.push,
    runId: process.env.GITHUB_RUN_ID || 'local',
    trigger: process.env.GITHUB_EVENT_NAME || 'manual',
  });
  try {
    writeReport(parsed.options.report, result.report);
    writeSummary(parsed.options.summary, result.report);
  } catch {
    process.stderr.write('E_REPORT\n');
    process.exitCode = 6;
    return;
  }
  emit(result.report, parsed.options);
  process.exitCode = result.exitCode;
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { main, parseArgs };
