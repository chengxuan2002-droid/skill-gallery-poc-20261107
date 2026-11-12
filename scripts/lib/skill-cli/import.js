'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildCandidate, readMetaRecord } = require('./candidate');
const { publishCandidate } = require('./publish');
const { fetchSource } = require('./source-github');

function failure(code, message, target = null) {
  return { ok: false, diagnostics: [{ code, path: target, message }] };
}

function previewOutcome(candidate) {
  return {
    status: 'previewed',
    slug: candidate.slug,
    content_revision: candidate.digest,
    content_status: 'previewed',
    deploy_status: 'pending',
    commit_sha: null,
    run_url: null,
    public_url: null,
  };
}

function prepareInput(root, record, files) {
  const single = record.content_path === `skills/${record.slug}.md`;
  if (single) {
    if (files.size !== 1) {
      return failure('E_PATH', '单文件记录要求来源只包含一个文件', record.content_path);
    }
    const [name, bytes] = [...files.entries()][0];
    const inputPath = path.join(root, name);
    fs.writeFileSync(inputPath, bytes);
    return { ok: true, inputPath };
  }
  if (!files.has('SKILL.md')) {
    return failure('E_MAIN_MISSING', '目录型来源缺少 SKILL.md', record.content_path);
  }
  const inputPath = path.join(root, 'input');
  for (const [relativePath, bytes] of files) {
    const target = path.join(inputPath, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  return { ok: true, inputPath };
}

function importCandidate({ projectRoot, source, metaPath, publish = false, reader }) {
  const loaded = readMetaRecord(metaPath);
  if (!loaded.ok) return loaded;
  const fetched = fetchSource({ source, reader });
  if (!fetched.ok) return fetched;

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-cli-import-'));
  try {
    const prepared = prepareInput(temp, loaded.record, fetched.files);
    if (!prepared.ok) return prepared;
    const built = buildCandidate({ inputPath: prepared.inputPath, record: loaded.record });
    if (!built.ok) return built;
    if (publish) {
      return publishCandidate({ projectRoot, candidate: built.candidate });
    }
    return { ok: true, outcome: previewOutcome(built.candidate) };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

module.exports = { importCandidate };
