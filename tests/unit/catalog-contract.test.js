const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveCatalogRecord, validateCatalogRecord } = require('../../scripts/lib/validate');

const base = {
  schemaVersion: 1,
  slug: 'sample-skill',
  display_name: '示例技能',
  description: '用于契约验证的样例',
  content_path: 'skills/sample-skill.md',
};

function record(overrides = {}) {
  return { ...base, ...overrides };
}

function frontmatter(meta) {
  return { ok: true, meta, body: '', diagnostics: [] };
}

function codes(result) {
  return result.diagnostics.map((item) => item.code);
}

test('accepts required fields and defaults collection arrays', () => {
  const result = validateCatalogRecord(record());
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.record.tags, []);
  assert.deepEqual(result.record.platforms, []);
  assert.deepEqual(result.record.allowed_dot_paths, []);

  for (const [field, value] of [
    ['schemaVersion', 2],
    ['schemaVersion', '1'],
    ['schemaVersion', 1.5],
    ['slug', 'Upper-Skill'],
    ['slug', '-leading'],
    ['slug', 'double--hyphen'],
    ['slug', 'a'.repeat(65)],
    ['display_name', ''],
    ['description', ''],
    ['content_path', 'skills/other-skill.md'],
  ]) {
    const invalid = validateCatalogRecord(record({ [field]: value }));
    assert.equal(invalid.ok, false, `${field}=${String(value)}`);
    assert.ok(codes(invalid).includes('E_SCHEMA'), `${field}=${String(value)}`);
  }
});

test('accepts nullable optional fields and rejects unknown or wrongly typed keys', () => {
  const valid = validateCatalogRecord(
    record({
      author: null,
      homepage_url: null,
      repository_url: 'https://github.com/owner/repository',
      declared_version: null,
      source_type: null,
      usage: null,
      notes: '站内备注',
      license: null,
      created_at: null,
      updated_at: '2026-11-03',
      source_tracking: null,
    }),
  );
  assert.equal(valid.ok, true, JSON.stringify(valid.diagnostics));

  for (const field of ['author', 'declared_version', 'usage', 'notes', 'license', 'source_type']) {
    const invalid = validateCatalogRecord(record({ [field]: 42 }));
    assert.equal(invalid.ok, false, field);
    assert.ok(codes(invalid).includes('E_SCHEMA'), field);
  }

  const unknown = validateCatalogRecord(record({ unexpected_top_level: true }));
  assert.equal(unknown.ok, false);
  assert.ok(codes(unknown).includes('E_SCHEMA'));
});

test('validates real calendar dates and URL boundaries', () => {
  for (const value of ['2024-02-29', '2026-11-03', null]) {
    const valid = validateCatalogRecord(record({ created_at: value }));
    assert.equal(valid.ok, true, String(value));
  }
  for (const value of ['2025-02-29', '2026-13-01', '2026-1-1', '2026-00-10', '']) {
    const invalid = validateCatalogRecord(record({ created_at: value }));
    assert.equal(invalid.ok, false, value);
    assert.ok(codes(invalid).includes('E_SCHEMA'), value);
  }

  for (const value of ['https://example.com/skill', 'http://example.com/skill', null]) {
    const valid = validateCatalogRecord(record({ homepage_url: value }));
    assert.equal(valid.ok, true, String(value));
  }
  for (const value of [
    '',
    'example.com/skill',
    'javascript:alert(1)',
    'ftp://example.com/skill',
    'https://user:pass@example.com/skill',
  ]) {
    const invalid = validateCatalogRecord(record({ repository_url: value }));
    assert.equal(invalid.ok, false, value);
    assert.ok(codes(invalid).includes('E_SCHEMA'), value);
  }
});

test('validates the source tracking shape without performing a request', () => {
  const validTracking = {
    provider: 'github',
    repository: 'owner/repository',
    path: 'skills/example',
    ref_policy: 'branch',
    ref: 'main',
    enabled: false,
    last_synced_revision: null,
    last_synced_digest: null,
    synced_at: null,
  };
  const valid = validateCatalogRecord(record({ source_tracking: validTracking }));
  assert.equal(valid.ok, true, JSON.stringify(valid.diagnostics));

  for (const override of [
    { provider: 'gitlab' },
    { repository: '' },
    { ref_policy: 'tag' },
    { ref: '' },
    { enabled: 'false' },
    { last_synced_digest: 'not-a-digest' },
  ]) {
    const invalid = validateCatalogRecord(
      record({ source_tracking: { ...validTracking, ...override } }),
    );
    assert.equal(invalid.ok, false, JSON.stringify(override));
    assert.ok(codes(invalid).includes('E_SCHEMA'), JSON.stringify(override));
  }
});

test('catalog values win, explicit null is preserved and frontmatter is only a fallback', () => {
  const catalog = record({
    display_name: '站内显示名',
    description: '站内简介',
    tags: ['站内标签'],
    author: null,
    homepage_url: 'https://example.com/site',
    license: 'MIT',
    declared_version: null,
  });
  const input = frontmatter({
    name: '原始中文名',
    description: '原件简介',
    author: '原作者',
    homepage: 'https://example.com/upstream',
    repository: 'https://github.com/owner/repository',
    version: '1.2.3',
    license: 'Apache-2.0',
    metadata: { version: '9.9.9', nested: { unknown: true } },
  });

  const result = resolveCatalogRecord({ record: catalog, frontmatter: input });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.record.display_name, '站内显示名');
  assert.equal(result.record.description, '站内简介');
  assert.deepEqual(result.record.tags, ['站内标签']);
  assert.equal(result.record.author, null);
  assert.equal(result.record.homepage_url, 'https://example.com/site');
  assert.equal(result.record.repository_url, 'https://github.com/owner/repository');
  assert.equal(result.record.license, 'MIT');
  assert.equal(result.record.declared_version, null);
  assert.equal(result.record.skill_name, '原始中文名');
  assert.equal(result.record.field_sources.author, 'catalog');
  assert.equal(result.record.field_sources.homepage_url, 'catalog');
  assert.equal(result.record.field_sources.repository_url, 'frontmatter');
  assert.equal(result.record.field_sources.license, 'catalog');
  assert.equal(result.record.field_sources.declared_version, 'catalog');
  assert.equal(result.record.field_sources.skill_name, 'frontmatter');
  assert.equal(input.meta.metadata.nested.unknown, true);
});

test('falls back to frontmatter aliases and resolves the declared version chain', () => {
  const fromAliases = resolveCatalogRecord({
    record: record(),
    frontmatter: frontmatter({
      author: '原作者',
      homepage: 'https://example.com/home',
      repository: 'https://github.com/owner/repository',
      version: '1.0.0',
      metadata: { version: '2.0.0' },
    }),
  });
  assert.equal(fromAliases.ok, true, JSON.stringify(fromAliases.diagnostics));
  assert.equal(fromAliases.record.author, '原作者');
  assert.equal(fromAliases.record.homepage_url, 'https://example.com/home');
  assert.equal(fromAliases.record.repository_url, 'https://github.com/owner/repository');
  assert.equal(fromAliases.record.declared_version, '1.0.0');
  assert.equal(fromAliases.record.field_sources.author, 'frontmatter');
  assert.equal(fromAliases.record.field_sources.declared_version, 'frontmatter');

  const fromMetadata = resolveCatalogRecord({
    record: record(),
    frontmatter: frontmatter({ metadata: { version: '2.0.0' } }),
  });
  assert.equal(fromMetadata.ok, true, JSON.stringify(fromMetadata.diagnostics));
  assert.equal(fromMetadata.record.declared_version, '2.0.0');
  assert.equal(fromMetadata.record.field_sources.declared_version, 'frontmatter.metadata');

  const missing = resolveCatalogRecord({ record: record(), frontmatter: frontmatter({}) });
  assert.equal(missing.ok, true, JSON.stringify(missing.diagnostics));
  assert.equal(missing.record.declared_version, null);
  assert.equal(missing.record.field_sources.declared_version, 'missing');
});

test('known frontmatter type errors cannot be hidden by catalog values', () => {
  const catalog = record({
    author: '目录作者',
    declared_version: '9.9.9',
    description: '目录简介',
  });
  for (const meta of [
    { author: 123 },
    { version: 1 },
    { metadata: { version: 2 } },
    { description: ['错误类型'] },
    { name: 42 },
    { homepage: '' },
    { created_at: '2026-02-30' },
  ]) {
    const result = resolveCatalogRecord({ record: catalog, frontmatter: frontmatter(meta) });
    assert.equal(result.ok, false, JSON.stringify(meta));
    assert.ok(codes(result).includes('E_SCHEMA'), JSON.stringify(meta));
  }
});

test('a standard name and description skill can use an independent catalog record', () => {
  const result = resolveCatalogRecord({
    record: record({
      display_name: '标准单文件样例',
      description: '站内补充简介',
      tags: ['sample'],
      platforms: ['generic'],
    }),
    frontmatter: frontmatter({
      name: '标准单文件样例',
      description: '仅含标准名称和简介',
      metadata: { nested: { unknown: true } },
    }),
  });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.record.display_name, '标准单文件样例');
  assert.equal(result.record.skill_name, '标准单文件样例');
  assert.deepEqual(result.record.tags, ['sample']);
  assert.deepEqual(result.record.platforms, ['generic']);
  assert.equal(result.record.field_sources.author, 'missing');
});

test('missing metadata is reported as missing without inventing author, version or dates', () => {
  const today = new Date().toISOString().slice(0, 10);
  const result = resolveCatalogRecord({ record: record(), frontmatter: frontmatter({}) });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  for (const field of [
    'author',
    'declared_version',
    'homepage_url',
    'repository_url',
    'license',
    'created_at',
    'updated_at',
  ]) {
    assert.equal(result.record[field], null, field);
    assert.equal(result.record.field_sources[field], 'missing', field);
  }
  assert.notEqual(result.record.created_at, today);
  assert.notEqual(result.record.updated_at, today);
});

test('dot path admission cannot bypass hard-forbidden credential paths', () => {
  const valid = validateCatalogRecord(record({ allowed_dot_paths: ['.well-known/security.txt'] }));
  assert.equal(valid.ok, true, JSON.stringify(valid.diagnostics));

  const forbidden = validateCatalogRecord(record({ allowed_dot_paths: ['.env'] }));
  assert.equal(forbidden.ok, false);
  assert.ok(
    codes(forbidden).some((code) => ['E_DOT_PATH_REVIEW', 'E_PATH'].includes(code)),
    JSON.stringify(forbidden.diagnostics),
  );
});
