const { createDiagnostic } = require('./diagnostics');

const PRIVATE_KEY_TAGS = [
  'PRIVATE KEY',
  'RSA PRIVATE KEY',
  'EC PRIVATE KEY',
  'DSA PRIVATE KEY',
  'OPENSSH PRIVATE KEY',
  'ENCRYPTED PRIVATE KEY',
];

const TOKEN_PREFIXES = ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_', 'sk-'];
const SECRET_KEYS = new Set([
  'password',
  'passwd',
  'pwd',
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'apikey',
  'client_secret',
  'private_key',
  'secret',
  'authorization',
  'cookie',
]);
const SECRET_KEY_SUFFIX = /(_password|_token|_api_key|_client_secret|_private_key|_secret)$/;

function isPlaceholder(value, { stripQuotes = true } = {}) {
  let text = String(value).trim();
  if (stripQuotes) {
    const quoted = text.match(/^(['"])([\s\S]*)\1$/);
    if (quoted) text = quoted[2].trim();
  }
  if (!text) return true;
  if (text.toLowerCase() === 'null') return true;
  if (/^YOUR_[A-Z0-9_]+_HERE$/.test(text)) return true;
  if (text === '<REDACTED>' || text === '***') return true;
  if (/^\$\{?[A-Z_][A-Z0-9_]*\}?$/.test(text)) return true;
  return false;
}

function lineAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

function scanPrivateKeys(raw, context) {
  const diagnostics = [];
  const pattern = new RegExp(`-----BEGIN (${PRIVATE_KEY_TAGS.join('|')})-----`, 'g');
  let match;
  while ((match = pattern.exec(raw))) {
    const rest = raw.slice(pattern.lastIndex);
    const endMarker = `-----END ${match[1]}-----`;
    const end = rest.indexOf(endMarker);
    if (end === -1) {
      diagnostics.push(
        createDiagnostic('E_SECRET', {
          ...context,
          line: lineAt(raw, match.index),
          message: 'SECRET-01 私钥块缺少结束边界',
        }),
      );
      continue;
    }
    const body = rest.slice(0, end);
    if (!isPlaceholder(body, { stripQuotes: false })) {
      diagnostics.push(
        createDiagnostic('E_SECRET', {
          ...context,
          line: lineAt(raw, match.index),
          message: 'SECRET-01 检测到私钥材料',
        }),
      );
    }
  }
  return diagnostics;
}

function scanTokenPrefixes(raw, context) {
  const diagnostics = [];
  const pattern = new RegExp(`(?:${TOKEN_PREFIXES.join('|')})[A-Za-z0-9_-]{20,}`, 'g');
  let match;
  while ((match = pattern.exec(raw))) {
    diagnostics.push(
      createDiagnostic('E_SECRET', {
        ...context,
        line: lineAt(raw, match.index),
        message: 'SECRET-02 检测到疑似访问令牌',
      }),
    );
  }
  return diagnostics;
}

function isSecretKey(key) {
  const normalized = key.toLowerCase().replace(/-/g, '_');
  return SECRET_KEYS.has(normalized) || SECRET_KEY_SUFFIX.test(normalized);
}

function parseAssignedValue(rest, key) {
  const text = rest.trim();
  if (!text) return null;
  const quoted = text.match(/^(['"])([\s\S]*?)\1/);
  if (quoted) {
    const remainder = text.slice(quoted[0].length).trim();
    if (!/^([#,\]};]|$)/.test(remainder)) return null;
    return quoted[2];
  }
  if (key === 'authorization') {
    const auth = text.match(/^(?:Bearer|Basic)\s+([A-Za-z0-9_-]+)/i);
    if (auth) {
      const remainder = text.slice(auth[0].length).trim();
      if (!/^([#,\]};]|$)/.test(remainder)) return null;
      return auth[1];
    }
  }
  const env = text.match(/^\$\{?[A-Z_][A-Z0-9_]*\}?/);
  if (env) {
    const remainder = text.slice(env[0].length).trim();
    if (!/^([#,\]};]|$)/.test(remainder)) return null;
    return env[0];
  }
  const placeholders = text.match(/^(<REDACTED>|\*{3})/);
  if (placeholders) {
    const remainder = text.slice(placeholders[0].length).trim();
    if (!/^([#,\]};]|$)/.test(remainder)) return null;
    return placeholders[0];
  }
  const bare = text.match(/^[A-Za-z0-9_-]+/);
  if (!bare) return null;
  const remainder = text.slice(bare[0].length).trim();
  if (!/^([#,\]};]|$)/.test(remainder)) return null;
  return bare[0];
}

function scanAssignments(text, context) {
  const diagnostics = [];
  const assignment = /(?:^|[\s{,])["']?([A-Za-z0-9_-]+)["']?\s*[:=]\s*(.*)$/;
  text.split('\n').forEach((line, index) => {
    const match = line.match(assignment);
    if (!match) return;
    const key = match[1].toLowerCase().replace(/-/g, '_');
    if (!isSecretKey(key)) return;
    const value = parseAssignedValue(match[2], key);
    if (value === null || isPlaceholder(value)) return;
    diagnostics.push(
      createDiagnostic('E_SECRET', {
        ...context,
        line: index + 1,
        message: 'SECRET-03 检测到疑似凭证赋值',
      }),
    );
  });
  return diagnostics;
}

function scanUrls(text, context) {
  const diagnostics = [];
  const pattern = /https?:\/\/[^\s"'<>]+/gi;
  let match;
  while ((match = pattern.exec(text))) {
    const candidate = match[0].replace(/[.,;)\]}>]+$/, '');
    let url;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    const userinfo = url.password || url.username;
    if (userinfo && !isPlaceholder(userinfo)) {
      diagnostics.push(
        createDiagnostic('E_SECRET', {
          ...context,
          line: lineAt(text, match.index),
          message: 'SECRET-04 检测到 URL 中的凭证',
        }),
      );
    }
  }
  return diagnostics;
}

function scanSecrets(input, context = {}) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  const raw = bytes.toString('latin1');
  const text = bytes.toString('utf8');
  return [
    ...scanPrivateKeys(raw, context),
    ...scanTokenPrefixes(raw, context),
    ...scanAssignments(text, context),
    ...scanUrls(text, context),
  ];
}

module.exports = { isPlaceholder, scanSecrets };
