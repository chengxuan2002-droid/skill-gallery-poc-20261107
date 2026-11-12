'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validateCatalogRecord } = require('../catalog-schema');
const { snapshotSkill } = require('../content-store');
const { scanSecrets } = require('../secrets');

function failure(code, message, target = null) {
  return { ok: false, diagnostics: [{ code, path: target, message }] };
}

function copyTree(source, target) {
  const stats = fs.lstatSync(source);
  if (stats.isSymbolicLink()) {
    const error = new Error('symbolic link is not allowed');
    error.code = 'E_LINK_FILE';
    throw error;
  }
  if (stats.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyTree(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  if (!stats.isFile()) {
    const error = new Error('only regular files are allowed');
    error.code = 'E_LINK_FILE';
    throw error;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function readMetaRecord(metaPath) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return failure('E_SCHEMA', '元数据文件无法读取或不是合法 JSON', metaPath);
  }
  const validated = validateCatalogRecord(raw);
  if (!validated.ok) return { ok: false, diagnostics: validated.diagnostics };
  return { ok: true, record: validated.record };
}

function buildCandidate({ inputPath, record }) {
  const slug = record.slug;
  const single = record.content_path === `skills/${slug}.md`;
  const directory = record.content_path === `skills/${slug}/SKILL.md`;
  if (!single && !directory) {
    return failure(
      'E_PATH',
      'content_path 必须指向 skills/<slug>.md 或 skills/<slug>/SKILL.md',
      record.content_path,
    );
  }

  let stats;
  try {
    stats = fs.lstatSync(inputPath);
  } catch {
    return failure('E_PATH', '候选路径不存在', inputPath);
  }
  if (single && !stats.isFile()) return failure('E_PATH', '单文件候选必须是普通文件', inputPath);
  if (directory && !stats.isDirectory()) return failure('E_PATH', '目录候选必须是目录', inputPath);

  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-cli-candidate-'));
  try {
    if (single) {
      fs.mkdirSync(path.join(stage, 'skills'), { recursive: true });
      fs.copyFileSync(inputPath, path.join(stage, 'skills', `${slug}.md`));
    } else {
      copyTree(inputPath, path.join(stage, 'skills', slug));
    }

    const snapshot = snapshotSkill({ projectRoot: stage, record });
    if (!snapshot.ok) return { ok: false, diagnostics: snapshot.diagnostics };
    const findings = snapshot.snapshot.files.flatMap((file) =>
      scanSecrets(file.bytes, { slug, path: file.path }),
    );
    if (findings.length > 0) return { ok: false, diagnostics: findings };

    const files = snapshot.snapshot.files.map((file) => ({
      path: single ? `skills/${slug}.md` : `skills/${slug}/${file.path}`,
      bytes: file.bytes,
      sha256: file.sha256,
      executable: file.executable,
    }));
    return {
      ok: true,
      candidate: {
        slug,
        kind: single ? 'single' : 'directory',
        record,
        files,
        digest: snapshot.snapshot.digest,
        recordDigest: snapshot.snapshot.recordDigest,
        mainPath: record.content_path,
      },
    };
  } catch (error) {
    return failure(error.code || 'E_PATH', '候选内容无法读取', inputPath);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

function loadCandidate({ inputPath, metaPath }) {
  const loaded = readMetaRecord(metaPath);
  if (!loaded.ok) return loaded;
  return buildCandidate({ inputPath, record: loaded.record });
}

function snapshotFromRoot(root, record) {
  const result = snapshotSkill({ projectRoot: root, record });
  return result.ok ? result.snapshot : null;
}

module.exports = { buildCandidate, loadCandidate, readMetaRecord, snapshotFromRoot };
