const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { scanSecrets } = require('./secrets');

const ALLOWED_EXACT = new Set(['index.html', '.nojekyll']);
const ALLOWED_PREFIXES = ['assets/', 'details/', 'downloads/', 'skills/', 'media/'];
const TEXT_EXTENSIONS = new Set([
  '.html',
  '.js',
  '.css',
  '.json',
  '.md',
  '.txt',
  '.yml',
  '.yaml',
  '.xml',
  '.svg',
]);
const CREDENTIAL_NAMES = new Set([
  '.env',
  '.npmrc',
  '.netrc',
  '.git-credentials',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
]);
const CREDENTIAL_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx']);
const TRIGGERS = new Set(['push', 'workflow_dispatch', 'schedule']);
const COMMIT_STATUSES = new Set(['not_applicable', 'committed', 'failed']);
const CONTENT_STATUSES = new Set(['pending', 'built', 'noop', 'failed']);
const DEPLOY_STATUSES = new Set(['pending', 'deploying', 'published', 'failed', 'superseded']);
const STATUS_INPUT_KEYS = new Set([
  'runId',
  'trigger',
  'targetSha',
  'commitStatus',
  'contentRevision',
  'contentStatus',
  'deployStatus',
  'reason',
  'startedAt',
  'finishedAt',
  'runUrl',
]);

function diagnostic(code, relativePath, message) {
  return { code, path: relativePath === undefined ? null : relativePath, message };
}

function fail(code, relativePath, message) {
  return {
    ok: false,
    status: 'failed',
    content_revision: null,
    files: 0,
    diagnostics: [diagnostic(code, relativePath, message)],
  };
}

function isSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

function isSafePath(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.includes('\\')) return false;
  if (Array.from(value).some((character) => character.charCodeAt(0) < 32)) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function isAllowedPath(value) {
  if (value === 'manifest.json') return true;
  if (ALLOWED_EXACT.has(value)) return true;
  return ALLOWED_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function isCredentialPath(value) {
  return value.split('/').some((segment) => {
    const lower = segment.toLowerCase();
    return (
      CREDENTIAL_NAMES.has(lower) ||
      lower.startsWith('.env.') ||
      CREDENTIAL_EXTENSIONS.has(path.extname(lower))
    );
  });
}

function isHiddenPath(value) {
  if (value === '.nojekyll') return false;
  return value.split('/').some((segment) => segment.startsWith('.'));
}

function isTextPath(value) {
  return TEXT_EXTENSIONS.has(path.extname(value).toLowerCase());
}

function readJson(absolutePath) {
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch {
    return null;
  }
}

function validateArtifactPath(relativePath) {
  if (!isSafePath(relativePath)) {
    return fail('E_ARTIFACT_PATH', relativePath, '产物路径不在允许范围内');
  }
  if (isCredentialPath(relativePath)) {
    return fail('E_ARTIFACT_CREDENTIAL_PATH', relativePath, '产物包含凭证类文件路径');
  }
  if (isHiddenPath(relativePath)) {
    return fail('E_ARTIFACT_HIDDEN', relativePath, '产物包含未允许的隐藏文件');
  }
  if (!isAllowedPath(relativePath)) {
    return fail('E_ARTIFACT_PATH', relativePath, '产物路径不在允许范围内');
  }
  return null;
}

function walkFiles(root, relative = '') {
  const files = [];
  for (const entry of fs.readdirSync(path.join(root, ...relative.split('/').filter(Boolean)), {
    withFileTypes: true,
  })) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    const absolute = path.join(root, ...child.split('/'));
    const stats = fs.lstatSync(absolute);
    if (stats.isSymbolicLink()) {
      return { error: fail('E_ARTIFACT_SYMLINK', child, '产物包含符号链接') };
    }
    if (stats.isDirectory()) {
      const nested = walkFiles(root, child);
      if (nested.error) return nested;
      files.push(...nested.files);
    } else if (stats.isFile()) {
      files.push(child);
    } else {
      return { error: fail('E_ARTIFACT_TYPE', child, '产物包含非普通文件') };
    }
  }
  return { files };
}

function verifySnapshot(distDir, manifest, expected) {
  const indexPath = 'assets/search-index.json';
  if (!expected.has(indexPath)) {
    return fail('E_ARTIFACT_SNAPSHOT', indexPath, '产物缺少搜索索引');
  }
  const index = readJson(path.join(distDir, ...indexPath.split('/')));
  if (
    !index ||
    index.schemaVersion !== 1 ||
    index.contentRevision !== manifest.contentRevision ||
    !Array.isArray(index.skills)
  ) {
    return fail('E_ARTIFACT_SNAPSHOT', indexPath, '搜索索引与 manifest 快照不一致');
  }
  for (const skill of index.skills) {
    if (!skill || typeof skill.slug !== 'string' || typeof skill.digest !== 'string') {
      return fail('E_ARTIFACT_SNAPSHOT', indexPath, '搜索结果条目形状非法');
    }
    const detailPath = `details/${skill.slug}.json`;
    if (!expected.has(detailPath)) {
      return fail('E_ARTIFACT_SNAPSHOT', detailPath, '详情文件缺失');
    }
    const detail = readJson(path.join(distDir, ...detailPath.split('/')));
    if (
      !detail ||
      detail.contentRevision !== manifest.contentRevision ||
      detail.slug !== skill.slug ||
      detail.digest !== skill.digest
    ) {
      return fail('E_ARTIFACT_SNAPSHOT', detailPath, '详情与索引快照不一致');
    }
  }
  return null;
}

function verifyArtifact(distDir) {
  if (
    typeof distDir !== 'string' ||
    !fs.existsSync(distDir) ||
    !fs.lstatSync(distDir).isDirectory()
  ) {
    return fail('E_ARTIFACT_DIR', null, '产物目录不存在');
  }
  const manifestPath = path.join(distDir, 'manifest.json');
  const manifest = readJson(manifestPath);
  if (
    !manifest ||
    manifest.schemaVersion !== 1 ||
    typeof manifest.contentRevision !== 'string' ||
    manifest.contentRevision.length === 0 ||
    !Array.isArray(manifest.artifacts)
  ) {
    return fail('E_ARTIFACT_MANIFEST', 'manifest.json', 'manifest 形状非法');
  }

  const expected = new Map();
  for (const artifact of manifest.artifacts) {
    if (!artifact || typeof artifact.path !== 'string') {
      return fail('E_ARTIFACT_MANIFEST', 'manifest.json', 'manifest artifact 形状非法');
    }
    const pathFailure = validateArtifactPath(artifact.path);
    if (pathFailure) return pathFailure;
    if (artifact.path === 'manifest.json') {
      return fail('E_ARTIFACT_PATH', artifact.path, 'manifest 不能包含自身');
    }
    if (expected.has(artifact.path)) {
      return fail('E_ARTIFACT_DUPLICATE', artifact.path, 'manifest 包含重复路径');
    }
    if (
      typeof artifact.size !== 'number' ||
      !Number.isInteger(artifact.size) ||
      artifact.size < 0 ||
      typeof artifact.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(artifact.sha256)
    ) {
      return fail('E_ARTIFACT_MANIFEST', artifact.path, 'manifest artifact 摘要形状非法');
    }
    expected.set(artifact.path, artifact);
  }

  const walked = walkFiles(distDir);
  if (walked.error) return walked.error;
  const actual = new Set();
  for (const relativePath of walked.files) {
    if (relativePath === 'manifest.json') {
      actual.add(relativePath);
      continue;
    }
    const pathFailure = validateArtifactPath(relativePath);
    if (pathFailure) return pathFailure;
    actual.add(relativePath);
  }
  if (!actual.has('manifest.json')) {
    return fail('E_ARTIFACT_MANIFEST', 'manifest.json', '产物缺少 manifest');
  }

  for (const relativePath of actual) {
    if (relativePath !== 'manifest.json' && !expected.has(relativePath)) {
      return fail('E_ARTIFACT_EXTRA_FILE', relativePath, '产物包含未允许文件');
    }
  }
  for (const relativePath of expected.keys()) {
    if (!actual.has(relativePath)) {
      return fail('E_ARTIFACT_MISSING', relativePath, 'manifest 文件缺失');
    }
  }

  for (const [relativePath, artifact] of expected) {
    const bytes = fs.readFileSync(path.join(distDir, ...relativePath.split('/')));
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== artifact.size || sha256 !== artifact.sha256) {
      return fail('E_ARTIFACT_HASH', relativePath, '产物大小或摘要不一致');
    }
  }

  const snapshotFailure = verifySnapshot(distDir, manifest, expected);
  if (snapshotFailure) return snapshotFailure;

  for (const relativePath of expected.keys()) {
    if (!isTextPath(relativePath)) continue;
    const bytes = fs.readFileSync(path.join(distDir, ...relativePath.split('/')));
    const findings = scanSecrets(bytes, { path: relativePath });
    if (findings.length > 0) {
      return fail('E_SECRET', relativePath, findings[0].message || '产物包含凭证');
    }
  }

  return {
    ok: true,
    status: 'verified',
    content_revision: manifest.contentRevision,
    files: actual.size,
    diagnostics: [],
  };
}

function evaluateDeployTarget({ targetSha, remoteHead } = {}) {
  if (!isSha(targetSha) || !isSha(remoteHead)) {
    return {
      ok: false,
      decision: null,
      target_sha: null,
      remote_head: null,
      diagnostics: [diagnostic('E_TARGET_SHA', null, '目标或远端 HEAD 不是 40 位 SHA')],
    };
  }
  const current = targetSha === remoteHead;
  return {
    ok: current,
    decision: current ? 'current' : 'superseded',
    target_sha: targetSha,
    remote_head: remoteHead,
    diagnostics: [],
  };
}

function isIsoTime(value) {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

function isSafeHttpUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function createRunStatus(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, diagnostics: [diagnostic('E_STATUS_INPUT', null, '状态输入非法')] };
  }
  for (const key of Object.keys(input)) {
    if (!STATUS_INPUT_KEYS.has(key)) {
      return { ok: false, diagnostics: [diagnostic('E_STATUS_INPUT', null, '状态包含未知字段')] };
    }
  }
  for (const key of STATUS_INPUT_KEYS) {
    if (!(key in input)) {
      return { ok: false, diagnostics: [diagnostic('E_STATUS_INPUT', null, '状态缺少字段')] };
    }
  }
  if (typeof input.runId !== 'string' || input.runId.length === 0) {
    return { ok: false, diagnostics: [diagnostic('E_STATUS_INPUT', null, 'runId 非法')] };
  }
  if (!TRIGGERS.has(input.trigger) || !COMMIT_STATUSES.has(input.commitStatus)) {
    return { ok: false, diagnostics: [diagnostic('E_STATUS_INPUT', null, '状态枚举非法')] };
  }
  if (!CONTENT_STATUSES.has(input.contentStatus) || !DEPLOY_STATUSES.has(input.deployStatus)) {
    return { ok: false, diagnostics: [diagnostic('E_STATUS_INPUT', null, '状态枚举非法')] };
  }
  if (!isSha(input.targetSha)) {
    return { ok: false, diagnostics: [diagnostic('E_TARGET_SHA', null, '目标 SHA 非法')] };
  }
  if (input.contentRevision !== null && typeof input.contentRevision !== 'string') {
    return { ok: false, diagnostics: [diagnostic('E_STATUS_INPUT', null, 'contentRevision 非法')] };
  }
  if (
    input.reason !== null &&
    (typeof input.reason !== 'string' || !/^E_[A-Z0-9_]+$/.test(input.reason))
  ) {
    return {
      ok: false,
      diagnostics: [diagnostic('E_STATUS_INPUT', null, 'reason 必须是稳定错误码')],
    };
  }
  if (!isIsoTime(input.startedAt) || !isIsoTime(input.finishedAt)) {
    return { ok: false, diagnostics: [diagnostic('E_STATUS_INPUT', null, '时间字段非法')] };
  }
  if (input.runUrl !== null && !isSafeHttpUrl(input.runUrl)) {
    return { ok: false, diagnostics: [diagnostic('E_STATUS_INPUT', null, 'runUrl 非法')] };
  }

  return {
    ok: true,
    status: {
      run_id: input.runId,
      trigger: input.trigger,
      target_sha: input.targetSha,
      commit_status: input.commitStatus,
      content_revision: input.contentRevision,
      content_status: input.contentStatus,
      deploy_status: input.deployStatus,
      reason: input.reason,
      started_at: input.startedAt,
      finished_at: input.finishedAt,
      run_url: input.runUrl,
    },
  };
}

function summaryRunUrl(value) {
  if (!isSafeHttpUrl(value)) return null;
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

function renderSummary(status) {
  if (!status || typeof status !== 'object') return '## Publish run\n\n- Status: unknown\n';
  const reason =
    typeof status.reason === 'string' && /^E_[A-Z0-9_]+$/.test(status.reason)
      ? status.reason
      : null;
  const runUrl = summaryRunUrl(status.run_url);
  const lines = [
    '## Publish run',
    '',
    `- Run: ${runUrl || status.run_id || 'unknown'}`,
    `- Trigger: ${status.trigger || 'unknown'}`,
    `- Target commit: ${status.target_sha || 'unknown'}`,
    `- Commit status: ${status.commit_status || 'unknown'}`,
    `- Content revision: ${status.content_revision || 'unknown'}`,
    `- Content status: ${status.content_status || 'unknown'}`,
    `- Deploy status: ${status.deploy_status || 'unknown'}`,
    `- Started: ${status.started_at || 'unknown'}`,
    `- Finished: ${status.finished_at || 'unknown'}`,
    `- Reason: ${reason || 'none'}`,
  ];
  return `${lines.join('\n')}\n`;
}

module.exports = {
  createRunStatus,
  evaluateDeployTarget,
  renderSummary,
  verifyArtifact,
};
