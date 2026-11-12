'use strict';

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const { createDiagnostic } = require('./diagnostics');
const { normalizeRelativePath } = require('./paths');

const REF_POLICIES = new Set(['branch', 'release', 'pinned']);
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const LICENSE_PATTERN = /^(LICEN[CS]E|COPYING|NOTICE)(\..*)?$/i;
const LIMITS = Object.freeze({
  maxFiles: 500,
  maxTotalBytes: 20 * 1024 * 1024,
  maxMainBytes: 1024 * 1024,
});
const RETRYABLE = new Set(['E_SOURCE_TIMEOUT', 'E_SOURCE_TRANSIENT']);

function diagnostic(code, message, path = null) {
  return createDiagnostic(code, { path, message });
}

function sourceError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isSafePath(value) {
  return normalizeRelativePath(value).ok;
}

function validateSource(source) {
  if (!source || typeof source !== 'object') {
    return diagnostic('E_SCHEMA', '来源配置必须是对象');
  }
  if (source.provider !== 'github') {
    return diagnostic('E_SCHEMA', '只支持 github 来源');
  }
  if (typeof source.repository !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(source.repository)) {
    return diagnostic('E_SCHEMA', 'repository 必须是 owner/repository', source.repository ?? null);
  }
  if (!isSafePath(source.path)) {
    return diagnostic('E_SCHEMA', 'path 必须是安全的 POSIX 相对路径', source.path ?? null);
  }
  const policy = source.ref_policy ?? 'branch';
  if (!REF_POLICIES.has(policy)) {
    return diagnostic('E_SCHEMA', 'ref_policy 不合法', String(policy));
  }
  if (typeof source.ref !== 'string' || source.ref.length === 0) {
    return diagnostic('E_SCHEMA', 'ref 不能为空', source.ref ?? null);
  }
  if (policy === 'pinned' && !SHA_PATTERN.test(source.ref)) {
    return diagnostic('E_SCHEMA', 'pinned ref 必须是 40 位提交', source.ref);
  }
  return null;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function normalizeFiles(rawFiles, { mainRelative = null } = {}) {
  const entries =
    rawFiles instanceof Map ? [...rawFiles.entries()] : Object.entries(rawFiles ?? {});
  const files = new Map();
  const modes = new Map();
  let total = 0;
  for (const [relativePath, value] of entries) {
    if (!isSafePath(relativePath)) {
      return { ok: false, diagnostics: [diagnostic('E_PATH', '来源文件路径越界', relativePath)] };
    }
    let bytes = value;
    let mode = '100644';
    if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
      mode = String(value.mode ?? '100644');
      bytes = value.bytes;
    }
    if (!['100644', '100755'].includes(mode)) {
      return {
        ok: false,
        diagnostics: [diagnostic('E_SOURCE_LINK', '来源包含链接或子模块', relativePath)],
      };
    }
    if (!Buffer.isBuffer(bytes) && typeof bytes !== 'string') {
      return { ok: false, diagnostics: [diagnostic('E_SOURCE', '来源文件无法读取', relativePath)] };
    }
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8');
    total += buffer.length;
    if (total > LIMITS.maxTotalBytes) {
      return { ok: false, diagnostics: [diagnostic('E_LIMIT', '来源内容超过大小限制')] };
    }
    files.set(relativePath, buffer);
    modes.set(relativePath, mode);
  }
  if (files.size === 0) {
    return { ok: false, diagnostics: [diagnostic('E_SOURCE', '来源没有可用文件')] };
  }
  if (files.size > LIMITS.maxFiles) {
    return { ok: false, diagnostics: [diagnostic('E_LIMIT', '来源文件数量超过限制')] };
  }
  if (
    mainRelative &&
    files.has(mainRelative) &&
    files.get(mainRelative).length > LIMITS.maxMainBytes
  ) {
    return { ok: false, diagnostics: [diagnostic('E_LIMIT', '主文档超过大小限制', mainRelative)] };
  }
  return { ok: true, files, modes, diagnostics: [] };
}

function findLicense(files) {
  const paths = [...files.keys()].sort();
  for (const relativePath of paths) {
    const name = relativePath.split('/').pop();
    if (LICENSE_PATTERN.test(name)) {
      return { path: relativePath, sha256: sha256(files.get(relativePath)) };
    }
  }
  return null;
}

function classifyGhError(error) {
  const stderr = String(error?.stderr ?? '');
  if (/HTTP 404/i.test(stderr)) return 'E_SOURCE_NOT_FOUND';
  if (/HTTP 403/i.test(stderr) && /rate limit/i.test(stderr)) return 'E_SOURCE_RATE_LIMIT';
  if (/HTTP 403/i.test(stderr)) return 'E_SOURCE_FORBIDDEN';
  if (/HTTP 429/i.test(stderr) || /rate limit/i.test(stderr)) return 'E_SOURCE_RATE_LIMIT';
  if (/HTTP 5\d\d/i.test(stderr) || /ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(stderr)) {
    return 'E_SOURCE_TRANSIENT';
  }
  if (/timed out|timeout|SIGTERM/i.test(stderr)) return 'E_SOURCE_TIMEOUT';
  return error?.code === 'ETIMEDOUT' ? 'E_SOURCE_TIMEOUT' : 'E_SOURCE';
}

function defaultExec(requestPath, { timeoutMs }) {
  try {
    return execFileSync('gh', ['api', requestPath], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw sourceError(classifyGhError(error));
  }
}

function createGhReader({ execute = defaultExec, timeoutMs = 30_000, retries = 3 } = {}) {
  function ghApi(requestPath) {
    let last;
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        const raw = execute(requestPath, { timeoutMs });
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (error) {
        last = error.code ? error : sourceError(classifyGhError(error));
        if (!RETRYABLE.has(last.code) || attempt === retries - 1) throw last;
      }
    }
    throw last;
  }

  function resolveRevision(source) {
    if (source.ref_policy === 'pinned') return source.ref;
    if (source.ref_policy === 'branch') {
      const ref = ghApi(`repos/${source.repository}/git/ref/heads/${source.ref}`);
      return ref.object.sha;
    }
    let release;
    try {
      release = ghApi(`repos/${source.repository}/releases/latest`);
    } catch (error) {
      if (error.code === 'E_SOURCE_NOT_FOUND') throw sourceError('E_SOURCE_UNAVAILABLE');
      throw error;
    }
    if (!release || release.draft || release.prerelease) throw sourceError('E_SOURCE_UNAVAILABLE');
    const tag = ghApi(`repos/${source.repository}/git/ref/tags/${release.tag_name}`);
    if (tag.object.type !== 'tag') return tag.object.sha;
    const annotated = ghApi(`repos/${source.repository}/git/tags/${tag.object.sha}`);
    return annotated.object.sha;
  }

  function selectEntries(tree, sourcePath) {
    const prefix = sourcePath.replace(/\/+$/, '');
    const exact = tree.find((entry) => entry.path === prefix);
    if (exact && exact.type === 'blob') {
      return [{ path: prefix.split('/').pop(), entry: exact }];
    }
    return tree
      .filter((entry) => entry.path.startsWith(`${prefix}/`) && entry.type === 'blob')
      .map((entry) => ({ path: entry.path.slice(prefix.length + 1), entry }));
  }

  function resolve(source) {
    const revision = resolveRevision(source);
    if (!SHA_PATTERN.test(revision)) throw sourceError('E_SOURCE');
    const tree = ghApi(`repos/${source.repository}/git/trees/${revision}?recursive=1`);
    if (tree.truncated) throw sourceError('E_SOURCE_TRUNCATED');
    const entries = selectEntries(tree.tree ?? [], source.path);
    if (entries.length === 0) throw sourceError('E_SOURCE_NOT_FOUND');
    const files = new Map();
    const modes = new Map();
    for (const item of entries) {
      if (item.entry.mode === '120000' || item.entry.mode === '160000') {
        throw sourceError('E_SOURCE_LINK');
      }
      const blob = ghApi(`repos/${source.repository}/git/blobs/${item.entry.sha}`);
      const bytes = Buffer.from(blob.content, blob.encoding === 'base64' ? 'base64' : 'utf8');
      files.set(item.path, bytes);
      modes.set(item.path, item.entry.mode ?? '100644');
    }
    const licenseFiles = new Map();
    const licenseModes = new Map();
    if (entries.length === 1 && entries[0].path === source.path.split('/').pop()) {
      const parent = source.path.includes('/')
        ? source.path.slice(0, source.path.lastIndexOf('/'))
        : '';
      for (const entry of tree.tree ?? []) {
        if (entry.type !== 'blob' || entry.mode === '120000' || entry.mode === '160000') continue;
        const name = entry.path.split('/').pop();
        if (!LICENSE_PATTERN.test(name)) continue;
        if (parent && entry.path !== 'LICENSE' && !entry.path.startsWith(`${parent}/`)) continue;
        const blob = ghApi(`repos/${source.repository}/git/blobs/${entry.sha}`);
        licenseFiles.set(
          entry.path,
          Buffer.from(blob.content, blob.encoding === 'base64' ? 'base64' : 'utf8'),
        );
        licenseModes.set(entry.path, entry.mode ?? '100644');
      }
    }
    return { ok: true, revision, files, modes, licenseFiles, licenseModes };
  }

  return { ghApi, resolve, resolveRevision };
}

function fetchSource({ source, reader, mainRelative = null } = {}) {
  const invalid = validateSource(source);
  if (invalid) return { ok: false, diagnostics: [invalid] };

  let resolved;
  try {
    resolved = reader.resolve(source);
  } catch (error) {
    const code = error.code && error.code.startsWith('E_') ? error.code : 'E_SOURCE';
    return { ok: false, diagnostics: [diagnostic(code, '来源读取失败')] };
  }
  if (!resolved || resolved.ok === false) {
    const code =
      typeof resolved?.code === 'string' && resolved.code.startsWith('E_')
        ? resolved.code
        : 'E_SOURCE';
    return { ok: false, diagnostics: [diagnostic(code, '来源读取失败')] };
  }
  if (resolved.truncated) {
    return { ok: false, diagnostics: [diagnostic('E_SOURCE_TRUNCATED', '来源文件树被截断')] };
  }
  if (typeof resolved.revision !== 'string' || !SHA_PATTERN.test(resolved.revision)) {
    return { ok: false, diagnostics: [diagnostic('E_SOURCE', '来源修订不是不可变提交')] };
  }
  const raw = new Map();
  const entries =
    resolved.files instanceof Map ? resolved.files.entries() : Object.entries(resolved.files ?? {});
  const modes =
    resolved.modes instanceof Map ? resolved.modes : new Map(Object.entries(resolved.modes ?? {}));
  for (const [relativePath, bytes] of entries) {
    raw.set(relativePath, { bytes, mode: modes.get(relativePath) ?? '100644' });
  }
  const normalized = normalizeFiles(raw, { mainRelative });
  if (!normalized.ok) return normalized;
  const licenseRaw = new Map();
  const licenseModes =
    resolved.licenseModes instanceof Map
      ? resolved.licenseModes
      : new Map(Object.entries(resolved.licenseModes ?? {}));
  const licenseEntries =
    resolved.licenseFiles instanceof Map
      ? resolved.licenseFiles.entries()
      : Object.entries(resolved.licenseFiles ?? {});
  for (const [relativePath, bytes] of licenseEntries) {
    licenseRaw.set(relativePath, { bytes, mode: licenseModes.get(relativePath) ?? '100644' });
  }
  const normalizedLicense =
    licenseRaw.size > 0 ? normalizeFiles(licenseRaw) : { ok: true, files: new Map() };
  const license = findLicense(normalizedLicense.ok ? normalizedLicense.files : normalized.files);
  return {
    ok: true,
    revision: resolved.revision,
    files: normalized.files,
    modes: normalized.modes,
    license: license ?? findLicense(normalized.files),
    diagnostics: [],
  };
}

module.exports = {
  LIMITS,
  createGhReader,
  fetchSource,
  findLicense,
  normalizeFiles,
  sha256,
  validateSource,
};
