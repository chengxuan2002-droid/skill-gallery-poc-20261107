#!/usr/bin/env node
const path = require('node:path');

const { buildSite } = require('./lib/build-site');

function output(value) {
  console.log(JSON.stringify(value));
}

async function main() {
  if (process.argv.length > 2) {
    output({
      status: 'failed',
      code: 'E_SCHEMA',
      message: '构建入口不接受参数',
    });
    process.exitCode = 1;
    return;
  }
  const result = await buildSite({
    projectRoot: path.resolve(__dirname, '..'),
    outputName: 'dist',
  });
  if (!result.ok) {
    output({
      status: 'failed',
      cleanup_status: result.cleanupStatus ?? null,
      diagnostics: result.diagnostics ?? [],
    });
    process.exitCode = 1;
    return;
  }
  output({
    status: 'built',
    cleanup_status: result.cleanupStatus,
    content_revision: result.contentRevision,
    output: 'dist',
  });
}

main().catch(() => {
  output({ status: 'failed', code: 'E_BUILD' });
  process.exitCode = 1;
});
