const {
  hasOwn,
  isCalendarDate,
  isDigest,
  isHttpUrl,
  isIsoTimestamp,
  isNonEmptyString,
  isPlainObject,
} = require('./catalog-values');
const { createDiagnostic } = require('./diagnostics');
const { isForbiddenPath, normalizeRelativePath, validateContentPath } = require('./paths');

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'slug',
  'display_name',
  'description',
  'content_path',
  'tags',
  'platforms',
  'allowed_dot_paths',
  'author',
  'homepage_url',
  'repository_url',
  'declared_version',
  'source_type',
  'usage',
  'notes',
  'license',
  'created_at',
  'updated_at',
  'source_tracking',
]);
const OPTIONAL_STRING_FIELDS = [
  'author',
  'homepage_url',
  'repository_url',
  'declared_version',
  'source_type',
  'usage',
  'notes',
  'license',
];
const URL_FIELDS = new Set(['homepage_url', 'repository_url']);
const DATE_FIELDS = new Set(['created_at', 'updated_at']);
const SOURCE_TRACKING_KEYS = new Set([
  'provider',
  'repository',
  'path',
  'ref_policy',
  'ref',
  'enabled',
  'last_synced_revision',
  'last_synced_digest',
  'last_synced_license',
  'synced_at',
]);
const LICENSE_TRACKING_KEYS = new Set(['path', 'sha256']);

function diagnose(diagnostics, code, context, message) {
  diagnostics.push(createDiagnostic(code, { ...context, message }));
}

function stringArray(value, slug, field, diagnostics) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    diagnose(diagnostics, 'E_SCHEMA', { slug }, `${field} 必须是字符串数组`);
    return [];
  }
  const result = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      diagnose(diagnostics, 'E_SCHEMA', { slug }, `${field} 必须是字符串数组`);
      continue;
    }
    result.push(item);
  }
  return result;
}

function dotPaths(value, slug, diagnostics) {
  const accepted = [];
  for (const item of stringArray(value, slug, 'allowed_dot_paths', diagnostics)) {
    const normalized = normalizeRelativePath(item);
    if (!normalized.ok) {
      diagnose(diagnostics, 'E_DOT_PATH_REVIEW', { slug, path: item }, '点路径准入无效');
      continue;
    }
    if (isForbiddenPath(normalized.path)) {
      diagnose(
        diagnostics,
        'E_DOT_PATH_REVIEW',
        { slug, path: normalized.path },
        '点路径不能放行凭证或系统项',
      );
      continue;
    }
    accepted.push(normalized.path);
  }
  return accepted;
}

function sourceTracking(value, slug, diagnostics) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) {
    diagnose(diagnostics, 'E_SCHEMA', { slug }, 'source_tracking 必须是对象或 null');
    return null;
  }
  for (const key of Object.keys(value)) {
    if (!SOURCE_TRACKING_KEYS.has(key)) {
      diagnose(diagnostics, 'E_SCHEMA', { slug }, 'source_tracking 含未知字段');
    }
  }
  if (value.provider !== 'github') {
    diagnose(diagnostics, 'E_SCHEMA', { slug }, 'source_tracking.provider 必须是 github');
  }
  for (const field of ['repository', 'path', 'ref']) {
    if (!isNonEmptyString(value[field])) {
      diagnose(diagnostics, 'E_SCHEMA', { slug }, `source_tracking.${field} 必须是非空字符串`);
    }
  }
  if (
    isNonEmptyString(value.repository) &&
    (!/^[^/\s]+\/[^/\s]+$/.test(value.repository) ||
      /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value.repository))
  ) {
    diagnose(
      diagnostics,
      'E_SCHEMA',
      { slug },
      'source_tracking.repository 必须是 owner/repository',
    );
  }
  if (isNonEmptyString(value.path)) {
    const normalized = normalizeRelativePath(value.path);
    if (!normalized.ok) {
      diagnose(
        diagnostics,
        'E_SCHEMA',
        { slug, path: value.path },
        'source_tracking.path 必须是安全相对路径',
      );
    }
  }
  if (!['branch', 'release', 'pinned'].includes(value.ref_policy)) {
    diagnose(diagnostics, 'E_SCHEMA', { slug }, 'source_tracking.ref_policy 不合法');
  }
  if (value.ref_policy === 'pinned' && !SHA_PATTERN.test(value.ref)) {
    diagnose(diagnostics, 'E_SCHEMA', { slug }, 'source_tracking.ref 必须是 40 位提交');
  }
  if (
    isNonEmptyString(value.last_synced_revision) &&
    !SHA_PATTERN.test(value.last_synced_revision)
  ) {
    diagnose(diagnostics, 'E_SCHEMA', { slug }, 'source_tracking.last_synced_revision 不合法');
  }
  if (typeof value.enabled !== 'boolean') {
    diagnose(diagnostics, 'E_SCHEMA', { slug }, 'source_tracking.enabled 必须是布尔值');
  }
  const digest = value.last_synced_digest ?? null;
  if (digest !== null && !isDigest(digest)) {
    diagnose(diagnostics, 'E_SCHEMA', { slug }, 'source_tracking.last_synced_digest 不合法');
  }
  const license = value.last_synced_license ?? null;
  if (license !== null) {
    if (!isPlainObject(license)) {
      diagnose(
        diagnostics,
        'E_SCHEMA',
        { slug },
        'source_tracking.last_synced_license 必须是对象或 null',
      );
    } else {
      for (const key of Object.keys(license)) {
        if (!LICENSE_TRACKING_KEYS.has(key)) {
          diagnose(
            diagnostics,
            'E_SCHEMA',
            { slug },
            'source_tracking.last_synced_license 含未知字段',
          );
        }
      }
      if (!isNonEmptyString(license.path)) {
        diagnose(
          diagnostics,
          'E_SCHEMA',
          { slug },
          'source_tracking.last_synced_license.path 必须是非空字符串',
        );
      } else if (!normalizeRelativePath(license.path).ok) {
        diagnose(
          diagnostics,
          'E_SCHEMA',
          { slug, path: license.path },
          'source_tracking.last_synced_license.path 必须是安全相对路径',
        );
      }
      if (!isDigest(license.sha256)) {
        diagnose(
          diagnostics,
          'E_SCHEMA',
          { slug },
          'source_tracking.last_synced_license.sha256 不合法',
        );
      }
    }
  }
  const syncedAt = value.synced_at ?? null;
  if (syncedAt !== null && !isIsoTimestamp(syncedAt)) {
    diagnose(diagnostics, 'E_SCHEMA', { slug }, 'source_tracking.synced_at 不合法');
  }
  const normalizedLicense =
    isPlainObject(license) &&
    isNonEmptyString(license.path) &&
    normalizeRelativePath(license.path).ok &&
    isDigest(license.sha256)
      ? { path: license.path, sha256: license.sha256 }
      : null;
  return {
    ...value,
    last_synced_revision: value.last_synced_revision ?? null,
    last_synced_digest: digest,
    last_synced_license: normalizedLicense,
    synced_at: syncedAt,
  };
}

function optionalFields(record, slug, diagnostics) {
  for (const field of OPTIONAL_STRING_FIELDS) {
    if (!hasOwn(record, field)) continue;
    const value = record[field];
    if (value === null) continue;
    if (typeof value !== 'string') {
      diagnose(diagnostics, 'E_SCHEMA', { slug }, `${field} 必须是字符串或 null`);
      continue;
    }
    if (URL_FIELDS.has(field) && !isHttpUrl(value)) {
      diagnose(diagnostics, 'E_SCHEMA', { slug }, `${field} 必须是无凭证的 http/https 地址`);
    }
    if (field === 'declared_version' && !isNonEmptyString(value)) {
      diagnose(diagnostics, 'E_SCHEMA', { slug }, 'declared_version 不能为空字符串');
    }
  }
  for (const field of DATE_FIELDS) {
    if (!hasOwn(record, field)) continue;
    const value = record[field];
    if (value === null) continue;
    if (!isCalendarDate(value)) {
      diagnose(diagnostics, 'E_SCHEMA', { slug }, `${field} 必须是合法 YYYY-MM-DD 日期`);
    }
  }
}

function validateCatalogRecord(record) {
  const diagnostics = [];
  if (!isPlainObject(record)) {
    diagnose(diagnostics, 'E_SCHEMA', {}, 'catalog 记录必须是对象');
    return { ok: false, record: null, diagnostics };
  }
  const slug = typeof record.slug === 'string' ? record.slug : null;
  for (const key of Object.keys(record)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      diagnose(diagnostics, 'E_SCHEMA', { slug }, '未知 catalog 顶层字段');
    }
  }
  if (record.schemaVersion !== 1) {
    diagnose(diagnostics, 'E_SCHEMA', { slug }, 'schemaVersion 必须固定为 1');
  }
  const slugValid =
    isNonEmptyString(record.slug) && record.slug.length <= 64 && SLUG_PATTERN.test(record.slug);
  if (!slugValid) {
    diagnose(diagnostics, 'E_SCHEMA', { slug }, 'slug 不合法');
  }
  if (!isNonEmptyString(record.display_name)) {
    diagnose(diagnostics, 'E_SCHEMA', { slug }, 'display_name 必须是非空字符串');
  }
  if (!isNonEmptyString(record.description)) {
    diagnose(diagnostics, 'E_SCHEMA', { slug }, 'description 必须是非空字符串');
  }
  if (!isNonEmptyString(record.content_path)) {
    diagnose(diagnostics, 'E_SCHEMA', { slug }, 'content_path 必须是非空字符串');
  } else if (slugValid) {
    const content = validateContentPath(record.slug, record.content_path);
    if (!content.ok) {
      diagnose(diagnostics, content.code, { slug, path: record.content_path }, content.message);
    }
  }

  const tags = stringArray(record.tags, slug, 'tags', diagnostics);
  const platforms = stringArray(record.platforms, slug, 'platforms', diagnostics);
  const allowedDotPaths = dotPaths(record.allowed_dot_paths, slug, diagnostics);
  optionalFields(record, slug, diagnostics);
  const tracking = sourceTracking(record.source_tracking, slug, diagnostics);

  return {
    ok: diagnostics.length === 0,
    record: {
      ...record,
      tags,
      platforms,
      allowed_dot_paths: allowedDotPaths,
      source_tracking: tracking,
    },
    diagnostics,
  };
}

module.exports = { validateCatalogRecord };
