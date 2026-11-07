#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const { isHttpUrl } = require('./lib/catalog-values');
const { createDiagnostic } = require('./lib/diagnostics');
const {
  resolveCatalogRecord,
  validateCatalogRecord,
  validateSkillInput,
} = require('./lib/validate');

const TARGETS = [
  {
    slug: 'superpower-systematic-debugging',
    content_path: 'skills/superpower-systematic-debugging.md',
  },
  { slug: 'code-review-assistant', content_path: 'skills/code-review-assistant.md' },
  { slug: 'refactoring-workflow', content_path: 'skills/refactoring-workflow.md' },
  { slug: 'handoff-codex', content_path: 'skills/handoff-codex/SKILL.md' },
];

function diagnostic(code, context, message) {
  return createDiagnostic(code, { ...context, message });
}

function deriveCandidate(projectRoot, target) {
  const validation = validateSkillInput({
    projectRoot,
    record: { slug: target.slug, content_path: target.content_path },
  });
  if (!validation.ok) return { ok: false, diagnostics: validation.diagnostics };

  const meta = validation.frontmatter?.meta ?? {};
  const sourceUrl =
    typeof meta.source_url === 'string' && isHttpUrl(meta.source_url) ? meta.source_url : null;
  const isGithub =
    meta.source === 'github' ||
    (sourceUrl !== null && /^https?:\/\/github\.com\//i.test(sourceUrl));
  const usageValue = meta.usage_notes ?? meta.usage ?? null;
  const usage = typeof usageValue === 'string' ? usageValue.replace(/\s+$/u, '') : usageValue;

  const draft = {
    schemaVersion: 1,
    slug: target.slug,
    display_name: meta.name,
    description: meta.description,
    tags: meta.tags === undefined ? [] : meta.tags,
    platforms: meta.platforms === undefined ? [] : meta.platforms,
    allowed_dot_paths: [],
    source_type: meta.source === undefined ? null : meta.source,
    usage,
    notes: null,
    content_path: target.content_path,
    source_tracking: null,
  };
  if (sourceUrl && isGithub) draft.repository_url = sourceUrl;
  if (sourceUrl && !isGithub) draft.homepage_url = sourceUrl;

  const resolved = resolveCatalogRecord({ record: draft, frontmatter: validation.frontmatter });
  if (!resolved.ok) return { ok: false, diagnostics: resolved.diagnostics };

  const catalog = { ...resolved.record };
  delete catalog.field_sources;
  delete catalog.skill_name;
  const validated = validateCatalogRecord(catalog);
  if (!validated.ok) return { ok: false, diagnostics: validated.diagnostics };
  return { ok: true, record: validated.record };
}

function inspectCatalogDirectory(projectRoot) {
  const catalog = path.join(projectRoot, 'catalog');
  let stats;
  try {
    stats = fs.lstatSync(catalog);
  } catch (error) {
    if (error.code === 'ENOENT') return { ok: true, path: catalog, exists: false };
    return {
      ok: false,
      diagnostics: [diagnostic('E_PATH', {}, 'catalog 目录无法检查')],
    };
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    return {
      ok: false,
      diagnostics: [diagnostic('E_PATH', { path: 'catalog' }, 'catalog 必须是普通目录')],
    };
  }
  return { ok: true, path: catalog, exists: true };
}

function inspectTarget(catalog, record) {
  const target = path.join(catalog, `${record.slug}.json`);
  let stats;
  try {
    stats = fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return { kind: 'missing', target };
    return {
      kind: 'conflict',
      target,
      diagnostics: [diagnostic('E_PATH', { slug: record.slug }, '目标记录无法检查')],
    };
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    return {
      kind: 'conflict',
      target,
      diagnostics: [diagnostic('E_PATH', { slug: record.slug }, '目标记录不是普通文件')],
    };
  }
  let existing;
  try {
    existing = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return {
      kind: 'conflict',
      target,
      diagnostics: [diagnostic('E_SCHEMA', { slug: record.slug }, '已有记录不是合法 JSON')],
    };
  }
  const validated = validateCatalogRecord(existing);
  if (!validated.ok) {
    return { kind: 'conflict', target, diagnostics: validated.diagnostics };
  }
  if (isDeepStrictEqual(validated.record, record)) return { kind: 'same', target };
  return {
    kind: 'conflict',
    target,
    diagnostics: [diagnostic('E_DUPLICATE', { slug: record.slug }, '已有记录与迁移候选不同')],
  };
}

function writeRecords(catalog, records) {
  const created = [];
  try {
    for (const record of records) {
      const target = path.join(catalog, `${record.slug}.json`);
      fs.writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
      created.push(target);
    }
    for (const record of records) {
      const target = path.join(catalog, `${record.slug}.json`);
      const verified = validateCatalogRecord(JSON.parse(fs.readFileSync(target, 'utf8')));
      if (!verified.ok || !isDeepStrictEqual(verified.record, record)) {
        throw new Error('VERIFY_FAILED');
      }
    }
    return { ok: true };
  } catch {
    let cleaned = true;
    for (const target of created) {
      try {
        fs.rmSync(target, { force: true });
      } catch {
        cleaned = false;
      }
    }
    return { ok: false, cleaned };
  }
}

function migrateCatalog({ projectRoot, write }) {
  const records = [];
  const diagnostics = [];

  for (const target of TARGETS) {
    const candidate = deriveCandidate(projectRoot, target);
    if (!candidate.ok) {
      diagnostics.push(...candidate.diagnostics);
      continue;
    }
    records.push(candidate.record);
  }
  if (diagnostics.length > 0) return { status: 'failed', state: 'failed', diagnostics };

  const catalog = inspectCatalogDirectory(projectRoot);
  if (!catalog.ok) return { status: 'failed', state: 'failed', diagnostics: catalog.diagnostics };

  const inspections = records.map((record) => inspectTarget(catalog.path, record));
  const conflicts = inspections.flatMap((item) => item.diagnostics ?? []);
  if (conflicts.length > 0) return { status: 'failed', state: 'failed', diagnostics: conflicts };

  const paths = records.map((record) => `catalog/${record.slug}.json`);
  if (!write) {
    return {
      status: 'dry_run',
      state: 'records_prepared',
      count: records.length,
      records: paths,
      diagnostics: [],
    };
  }

  const missing = records.filter((_, index) => inspections[index].kind === 'missing');
  if (missing.length === 0) {
    return {
      status: 'noop',
      state: 'verified',
      count: records.length,
      records: paths,
      diagnostics: [],
    };
  }

  fs.mkdirSync(catalog.path, { recursive: true });
  const written = writeRecords(catalog.path, missing);
  if (!written.ok) {
    return {
      status: 'failed',
      state: 'failed',
      diagnostics: [diagnostic('E_PATH', {}, '迁移写入失败，已回收本次新记录')],
    };
  }
  return {
    status: 'written',
    state: 'verified',
    count: records.length,
    records: paths,
    diagnostics: [],
  };
}

function main(argv) {
  const args = argv.slice(2);
  const unknown = args.filter((arg) => !['--dry-run', '--write'].includes(arg));
  if (unknown.length > 0) {
    console.log(
      JSON.stringify({
        status: 'failed',
        state: 'failed',
        diagnostics: [diagnostic('E_SCHEMA', {}, '只接受 --dry-run 或 --write')],
      }),
    );
    process.exitCode = 1;
    return;
  }
  const write = args.includes('--write');
  if (write && args.includes('--dry-run')) {
    console.log(
      JSON.stringify({
        status: 'failed',
        state: 'failed',
        diagnostics: [diagnostic('E_SCHEMA', {}, '--dry-run 与 --write 不能同时使用')],
      }),
    );
    process.exitCode = 1;
    return;
  }
  const result = migrateCatalog({ projectRoot: path.resolve(__dirname, '..'), write });
  console.log(JSON.stringify(result));
  if (result.status === 'failed') process.exitCode = 1;
}

if (require.main === module) main(process.argv);

module.exports = { deriveCandidate, migrateCatalog, TARGETS };
