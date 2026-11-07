const fs = require('node:fs');

const { createDiagnostic } = require('./diagnostics');
const { normalizeRelativePath } = require('./paths');

const LIMITS = Object.freeze({
  maxFiles: 500,
  maxTotalBytes: 20 * 1024 * 1024,
  maxMainBytes: 1024 * 1024,
});

function isBlankBuffer(bytes) {
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    start = 3;
  }
  for (let index = start; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x20) return false;
  }
  return true;
}

function diagnose(code, context, message) {
  return createDiagnostic(code, { ...context, message });
}

function statOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

function allowedDotPaths(record, diagnostics) {
  const value = record?.allowed_dot_paths ?? [];
  if (!Array.isArray(value)) {
    diagnostics.push(diagnose('E_SCHEMA', { slug: record?.slug }, 'allowed_dot_paths 必须是数组'));
    return new Set();
  }
  const allowed = new Set();
  for (const item of value) {
    const normalized = normalizeRelativePath(item);
    if (!normalized.ok) {
      diagnostics.push(
        diagnose('E_DOT_PATH_REVIEW', { slug: record?.slug, path: String(item) }, '点路径准入无效'),
      );
      continue;
    }
    allowed.add(normalized.path);
  }
  return allowed;
}

function emptyResult(diagnostics, excluded = []) {
  return { ok: false, files: [], directories: [], excluded, diagnostics };
}

module.exports = {
  allowedDotPaths,
  diagnose,
  emptyResult,
  isBlankBuffer,
  LIMITS,
  statOrNull,
};
