const SYSTEM_NOISE = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
const FORBIDDEN_SEGMENTS = new Set([
  '.git',
  '.svn',
  '.hg',
  '.ssh',
  '.aws',
  '.gnupg',
  '.azure',
  '.kube',
]);
const FORBIDDEN_FILES = new Set([
  '.env',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.git-credentials',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
]);
const ENV_TEMPLATES = new Set(['.env.example', '.env.sample', '.env.template']);

function isControlOrAmbiguous(value) {
  if (value.includes('\0')) return true;
  for (const character of value) {
    if (character.codePointAt(0) < 0x20) return true;
  }
  return false;
}

function normalizeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, code: 'E_SCHEMA', message: '路径必须是非空字符串' };
  }
  if (isControlOrAmbiguous(value)) {
    return { ok: false, code: 'E_PATH', message: '路径包含控制字符' };
  }
  if (value.includes('\\')) {
    return { ok: false, code: 'E_PATH', message: '路径必须使用 POSIX 分隔符' };
  }
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    return { ok: false, code: 'E_PATH', message: '路径不能是绝对路径' };
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return { ok: false, code: 'E_PATH', message: '路径包含空段、. 或 ..' };
  }
  return { ok: true, path: segments.join('/'), segments };
}

function validateContentPath(slug, contentPath) {
  if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 64) {
    return { ok: false, code: 'E_SCHEMA', message: 'slug 不合法' };
  }
  const normalized = normalizeRelativePath(contentPath);
  if (!normalized.ok) return normalized;

  const single = `skills/${slug}.md`;
  const directory = `skills/${slug}/SKILL.md`;
  if (normalized.path === single) {
    return {
      ok: true,
      kind: 'single',
      path: normalized.path,
      root: `skills/${slug}`,
      rootName: `${slug}.md`,
    };
  }
  if (normalized.path === directory) {
    return {
      ok: true,
      kind: 'directory',
      path: normalized.path,
      root: `skills/${slug}`,
      rootName: slug,
    };
  }
  return {
    ok: false,
    code: 'E_SCHEMA',
    message: 'content_path 必须属于该 slug 的受控路径',
  };
}

function isSystemNoise(name) {
  return SYSTEM_NOISE.has(name.toLowerCase()) || name.startsWith('._') || name === '__MACOSX';
}

function isForbiddenPath(relativePath) {
  const segments = relativePath.split('/');
  if (segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) return true;
  if (
    segments.some((segment, index) => segment === '.config' && segments[index + 1] === 'gcloud')
  ) {
    return true;
  }
  const base = segments[segments.length - 1];
  if (FORBIDDEN_FILES.has(base)) return true;
  if (base.startsWith('.env.') && !ENV_TEMPLATES.has(base)) return true;
  if (base.endsWith('.pem')) return true;
  return false;
}

function isDotPath(relativePath) {
  return relativePath.split('/').some((segment) => segment.startsWith('.'));
}

function isEnvTemplate(relativePath) {
  const base = relativePath.split('/').pop();
  return ENV_TEMPLATES.has(base);
}

function findPathCollisions(paths) {
  const caseMap = new Map();
  const nfcMap = new Map();
  const collisions = [];

  for (const current of paths) {
    const lower = current.toLowerCase();
    const nfc = lower.normalize('NFC');
    let collision = null;
    if (caseMap.has(lower) && caseMap.get(lower) !== current) {
      collision = { path: current, collisionWith: caseMap.get(lower), kind: 'case' };
    } else if (nfcMap.has(nfc) && nfcMap.get(nfc) !== current) {
      collision = { path: current, collisionWith: nfcMap.get(nfc), kind: 'nfc' };
    }
    if (collision) collisions.push(collision);
    if (!caseMap.has(lower)) caseMap.set(lower, current);
    if (!nfcMap.has(nfc)) nfcMap.set(nfc, current);
  }
  return collisions;
}

module.exports = {
  findPathCollisions,
  isDotPath,
  isEnvTemplate,
  isForbiddenPath,
  isSystemNoise,
  normalizeRelativePath,
  validateContentPath,
};
