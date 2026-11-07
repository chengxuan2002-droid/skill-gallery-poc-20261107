const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { snapshotSkill } = require('./content-store');
const { createDiagnostic } = require('./diagnostics');
const { readFrontmatter } = require('./frontmatter');
const {
  resolveCatalogRecord,
  scanSecrets,
  validateCatalogRecord,
  validateRecordOwnership,
} = require('./validate');

const POLICY_VERSION = 'build-policy-v2';

function diagnostic(code, context, message) {
  return createDiagnostic(code, { ...context, message });
}

function fail(diagnostics) {
  return { ok: false, status: 'failed', diagnostics };
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function collectStrings(value, output = []) {
  if (typeof value === 'string') {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, output);
  }
  return output;
}

function recordSecretDiagnostics(record, context) {
  return collectStrings(record).flatMap((value) => scanSecrets(value, context));
}

function loadCatalog(projectRoot) {
  const catalog = path.join(projectRoot, 'catalog');
  let stats;
  try {
    stats = fs.lstatSync(catalog);
  } catch {
    return fail([diagnostic('E_MAIN_MISSING', {}, 'catalog 目录不存在')]);
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    return fail([diagnostic('E_PATH', { path: 'catalog' }, 'catalog 必须是普通目录')]);
  }
  const names = fs
    .readdirSync(catalog)
    .filter((name) => name.endsWith('.json'))
    .sort();
  if (names.length === 0) return fail([diagnostic('E_MAIN_MISSING', {}, 'catalog 没有记录')]);
  const records = [];
  for (const name of names) {
    const target = path.join(catalog, name);
    const entry = fs.lstatSync(target);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      return fail([
        diagnostic('E_PATH', { path: `catalog/${name}` }, 'catalog 记录必须是普通文件'),
      ]);
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch {
      return fail([
        diagnostic('E_SCHEMA', { path: `catalog/${name}` }, 'catalog 记录不是合法 JSON'),
      ]);
    }
    const validated = validateCatalogRecord(parsed);
    if (!validated.ok) return fail(validated.diagnostics);
    const recordSecrets = recordSecretDiagnostics(validated.record, {
      slug: validated.record.slug,
      path: `catalog/${name}`,
    });
    if (recordSecrets.length > 0) return fail(recordSecrets);
    records.push(validated.record);
  }
  const ownership = validateRecordOwnership(records);
  if (!ownership.ok) return fail(ownership.diagnostics);
  return { ok: true, records };
}

function prepareSkills(projectRoot, records) {
  const skills = [];
  for (const record of records) {
    const snapshot = snapshotSkill({ projectRoot, record });
    if (!snapshot.ok) return fail(snapshot.diagnostics);
    const secrets = snapshot.snapshot.files.flatMap((file) =>
      scanSecrets(file.bytes, { slug: record.slug, path: file.path }),
    );
    if (secrets.length > 0) return fail(secrets);
    const mainPath = record.content_path.endsWith('/SKILL.md')
      ? 'SKILL.md'
      : path.posix.basename(record.content_path);
    const main = snapshot.snapshot.files.find((file) => file.path === mainPath);
    if (!main) {
      return fail([diagnostic('E_MAIN_MISSING', { slug: record.slug }, '主文档不存在')]);
    }
    const frontmatter = readFrontmatter(main.bytes, { slug: record.slug, path: mainPath });
    if (!frontmatter.ok) return fail(frontmatter.diagnostics);
    const resolved = resolveCatalogRecord({ record, frontmatter });
    if (!resolved.ok) return fail(resolved.diagnostics);
    const fileSet = new Set(snapshot.snapshot.files.map((file) => file.path));
    const fileUrls = new Map(
      snapshot.snapshot.files.map((file) => [
        file.path,
        `skills/${record.slug}/${file.sha256}.bin`,
      ]),
    );
    skills.push({
      record: resolved.record,
      snapshot: snapshot.snapshot,
      mainPath,
      mainUrl: fileUrls.get(mainPath),
      fileSet,
      fileUrls,
      body: frontmatter.body,
    });
  }
  return { ok: true, skills };
}

function contentRevision(projectRoot, skills) {
  const parts = [POLICY_VERSION, process.versions.node];
  for (const skill of [...skills].sort((left, right) =>
    left.record.slug.localeCompare(right.record.slug),
  )) {
    parts.push({
      slug: skill.record.slug,
      digest: skill.snapshot.digest,
      record: skill.record,
    });
  }
  for (const asset of [
    'index.html',
    'assets/app.js',
    'assets/app-dom.js',
    'assets/app-search.js',
    'assets/app-filters.js',
    'assets/app-views.js',
    'assets/app-detail.js',
    'assets/app-actions.js',
    'assets/style.css',
  ]) {
    const target = path.join(projectRoot, ...asset.split('/'));
    parts.push({
      asset,
      sha256:
        fs.existsSync(target) && fs.lstatSync(target).isFile()
          ? sha256(fs.readFileSync(target))
          : null,
    });
  }
  const lock = path.join(projectRoot, 'package-lock.json');
  if (fs.existsSync(lock) && fs.lstatSync(lock).isFile()) {
    parts.push({ lock: sha256(fs.readFileSync(lock)) });
  }
  return sha256(Buffer.from(JSON.stringify(parts), 'utf8'));
}

module.exports = { contentRevision, loadCatalog, prepareSkills };
