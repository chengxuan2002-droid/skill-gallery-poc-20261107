#!/usr/bin/env node
const { writeSummary } = require('./lib/publish-summary');

try {
  writeSummary();
} catch (error) {
  process.stderr.write(`${error.code || 'E_SUMMARY'}\n`);
  process.exitCode = 2;
}
