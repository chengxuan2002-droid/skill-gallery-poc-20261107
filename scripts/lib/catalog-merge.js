const { validateCatalogRecord } = require('./catalog-schema');
const {
  hasOwn,
  isCalendarDate,
  isHttpUrl,
  isNonEmptyString,
  isPlainObject,
} = require('./catalog-values');
const { createDiagnostic } = require('./diagnostics');

function diagnose(diagnostics, context, message) {
  diagnostics.push(createDiagnostic('E_SCHEMA', { ...context, message }));
}

function checkStringField(meta, field, slug, diagnostics) {
  if (!hasOwn(meta, field)) return;
  const value = meta[field];
  if (value === null) return;
  if (typeof value !== 'string') {
    diagnose(diagnostics, { slug }, `frontmatter.${field} 必须是字符串或 null`);
  }
}

function checkUrlField(meta, field, slug, diagnostics) {
  if (!hasOwn(meta, field)) return;
  const value = meta[field];
  if (value === null) return;
  if (typeof value !== 'string' || !isHttpUrl(value)) {
    diagnose(diagnostics, { slug }, `frontmatter.${field} 必须是无凭证的 http/https 地址`);
  }
}

function checkDateField(meta, field, slug, diagnostics) {
  if (!hasOwn(meta, field)) return;
  const value = meta[field];
  if (value === null) return;
  if (!isCalendarDate(value)) {
    diagnose(diagnostics, { slug }, `frontmatter.${field} 必须是合法 YYYY-MM-DD 日期`);
  }
}

function validateFrontmatter(frontmatter, slug, diagnostics) {
  if (frontmatter === undefined || frontmatter === null) return { meta: {} };
  if (frontmatter.ok === false) {
    if (Array.isArray(frontmatter.diagnostics)) diagnostics.push(...frontmatter.diagnostics);
    else diagnose(diagnostics, { slug }, 'frontmatter 读取失败');
    return { meta: {} };
  }
  if (!isPlainObject(frontmatter.meta)) {
    diagnose(diagnostics, { slug }, 'frontmatter.meta 必须是对象');
    return { meta: {} };
  }
  const meta = frontmatter.meta;
  if (hasOwn(meta, 'name') && !isNonEmptyString(meta.name)) {
    diagnose(diagnostics, { slug }, 'frontmatter.name 必须是非空字符串');
  }
  if (hasOwn(meta, 'description') && !isNonEmptyString(meta.description)) {
    diagnose(diagnostics, { slug }, 'frontmatter.description 必须是非空字符串');
  }
  if (hasOwn(meta, 'version') && !isNonEmptyString(meta.version)) {
    diagnose(diagnostics, { slug }, 'frontmatter.version 必须是非空字符串');
  }
  if (hasOwn(meta, 'metadata')) {
    if (!isPlainObject(meta.metadata)) {
      diagnose(diagnostics, { slug }, 'frontmatter.metadata 必须是对象');
    } else if (hasOwn(meta.metadata, 'version') && !isNonEmptyString(meta.metadata.version)) {
      diagnose(diagnostics, { slug }, 'frontmatter.metadata.version 必须是非空字符串');
    }
  }
  for (const field of ['author', 'license']) {
    checkStringField(meta, field, slug, diagnostics);
  }
  for (const field of ['homepage', 'homepage_url', 'repository', 'repository_url']) {
    checkUrlField(meta, field, slug, diagnostics);
  }
  for (const field of ['created_at', 'updated_at']) {
    checkDateField(meta, field, slug, diagnostics);
  }
  return { meta };
}

function resolveCatalogRecord({ record, frontmatter } = {}) {
  const schema = validateCatalogRecord(record);
  const diagnostics = [...schema.diagnostics];
  const slug = record?.slug ?? null;
  const { meta } = validateFrontmatter(frontmatter, slug, diagnostics);
  if (diagnostics.length > 0) return { ok: false, record: null, diagnostics };

  const resolved = { ...schema.record };
  const fieldSources = {};

  function assign(field, fallbackKeys = [field]) {
    if (hasOwn(record, field)) {
      resolved[field] = record[field];
      fieldSources[field] = 'catalog';
      return;
    }
    for (const key of fallbackKeys) {
      if (hasOwn(meta, key)) {
        resolved[field] = meta[key];
        fieldSources[field] = 'frontmatter';
        return;
      }
    }
    resolved[field] = null;
    fieldSources[field] = 'missing';
  }

  assign('author');
  assign('homepage_url', ['homepage_url', 'homepage']);
  assign('repository_url', ['repository_url', 'repository']);
  assign('license');
  assign('created_at');
  assign('updated_at');

  if (hasOwn(record, 'declared_version')) {
    resolved.declared_version = record.declared_version;
    fieldSources.declared_version = 'catalog';
  } else if (hasOwn(meta, 'version')) {
    resolved.declared_version = meta.version;
    fieldSources.declared_version = 'frontmatter';
  } else if (isPlainObject(meta.metadata) && hasOwn(meta.metadata, 'version')) {
    resolved.declared_version = meta.metadata.version;
    fieldSources.declared_version = 'frontmatter.metadata';
  } else {
    resolved.declared_version = null;
    fieldSources.declared_version = 'missing';
  }

  if (hasOwn(meta, 'name')) {
    resolved.skill_name = meta.name;
    fieldSources.skill_name = 'frontmatter';
  } else {
    resolved.skill_name = null;
    fieldSources.skill_name = 'missing';
  }

  resolved.field_sources = fieldSources;
  return { ok: true, record: resolved, diagnostics: [] };
}

module.exports = { resolveCatalogRecord };
