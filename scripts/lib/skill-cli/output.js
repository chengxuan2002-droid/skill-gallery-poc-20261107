'use strict';

const EXIT_CODES = {
  OK: 0,
  USAGE: 2,
  UNAUTHORIZED: 3,
  CONFLICT: 4,
  SOURCE: 5,
  BUILD: 6,
  DEPLOY: 7,
  TIMEOUT: 8,
};

const ERROR_EXIT_CODES = {
  E_USAGE: EXIT_CODES.USAGE,
  E_INPUT: EXIT_CODES.USAGE,
  E_SCHEMA: EXIT_CODES.USAGE,
  E_PATH: EXIT_CODES.USAGE,
  E_SECRET: EXIT_CODES.USAGE,
  E_LIMIT: EXIT_CODES.USAGE,
  E_LINK_FILE: EXIT_CODES.USAGE,
  E_MAIN_MISSING: EXIT_CODES.USAGE,
  E_DOT_PATH_REVIEW: EXIT_CODES.USAGE,
  E_SOURCE_CHANGED: EXIT_CODES.USAGE,
  E_REFERENCE_MISSING: EXIT_CODES.USAGE,
  E_UNAUTHORIZED: EXIT_CODES.UNAUTHORIZED,
  E_CONFLICT: EXIT_CODES.CONFLICT,
  E_SUPERSEDED: EXIT_CODES.CONFLICT,
  E_SOURCE: EXIT_CODES.SOURCE,
  E_BUILD: EXIT_CODES.BUILD,
  E_DEPLOY: EXIT_CODES.DEPLOY,
  E_TIMEOUT: EXIT_CODES.TIMEOUT,
};

const SUCCESS_STATUSES = new Set(['ok', 'previewed', 'noop', 'submitted', 'published', 'pending']);
const OUTPUT_KEYS = [
  'status',
  'slug',
  'content_revision',
  'content_status',
  'deploy_status',
  'commit_sha',
  'run_url',
  'public_url',
  'errors',
];
const ERROR_KEYS = ['code', 'path', 'message', 'expected', 'actual'];

function exitCodeFor(result = {}) {
  const code = result.errors?.[0]?.code;
  if (code && ERROR_EXIT_CODES[code] !== undefined) return ERROR_EXIT_CODES[code];
  if (SUCCESS_STATUSES.has(result.status)) return EXIT_CODES.OK;
  return EXIT_CODES.USAGE;
}

function sanitizeErrors(errors) {
  if (!Array.isArray(errors)) return [];
  return errors.map((error) => {
    const clean = {};
    for (const key of ERROR_KEYS) {
      if (error && error[key] !== undefined) clean[key] = error[key];
    }
    if (typeof clean.code !== 'string') clean.code = 'E_INPUT';
    if (typeof clean.message !== 'string') clean.message = '命令失败';
    if (!('path' in clean)) clean.path = null;
    return clean;
  });
}

function serializeResult(result = {}) {
  const output = {};
  for (const key of OUTPUT_KEYS) {
    if (key === 'errors') continue;
    output[key] = result[key] === undefined ? null : result[key];
  }
  output.status = result.status === undefined ? 'failed' : result.status;
  output.errors = sanitizeErrors(result.errors);
  return JSON.stringify(output);
}

module.exports = { EXIT_CODES, exitCodeFor, sanitizeErrors, serializeResult };
