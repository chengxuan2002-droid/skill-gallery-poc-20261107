'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { computeDigest } = require('./content-store');
const { buildCandidate } = require('./skill-cli/candidate');

function failure(code, message, target = null) {
  return { code, path: target, message };
}

function writeSource(root, files) {
  for (const [relativePath, bytes] of files) {
    const target = path.join(root, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
}

function prepareCandidate({ record, fetched }) {
  const directory = fetched.files.size > 1 || fetched.files.has('SKILL.md');
  const targetRecord = {
    ...record,
    content_path: directory ? `skills/${record.slug}/SKILL.md` : `skills/${record.slug}.md`,
  };
  const single = !directory;
  if (single && fetched.files.size !== 1) {
    return { ok: false, diagnostics: [failure('E_PATH', '单文件来源必须只包含一个文件')] };
  }
  if (!single && !fetched.files.has('SKILL.md')) {
    return { ok: false, diagnostics: [failure('E_MAIN_MISSING', '目录来源缺少 SKILL.md')] };
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'source-sync-candidate-'));
  try {
    const inputPath = single
      ? path.join(temp, [...fetched.files.keys()][0])
      : path.join(temp, 'input');
    if (single) {
      fs.writeFileSync(inputPath, fetched.files.get([...fetched.files.keys()][0]));
    } else {
      writeSource(inputPath, fetched.files);
    }
    const built = buildCandidate({ inputPath, record: targetRecord });
    if (!built.ok) return built;

    const prefix = single ? `skills/${record.slug}.md` : `skills/${record.slug}/`;
    const files = built.candidate.files.map((file) => {
      const relativePath = single ? `${record.slug}.md` : file.path.slice(prefix.length);
      const mode = fetched.modes.get(relativePath) ?? '100644';
      return { ...file, executable: mode === '100755', mode };
    });
    const digest = computeDigest({
      files: files.map((file) => ({
        path: single ? `${record.slug}.md` : file.path.slice(prefix.length),
        sha256: file.sha256,
        executable: file.executable,
      })),
      directories: [],
    });
    return {
      ok: true,
      candidate: { ...built.candidate, files, digest, license: fetched.license },
    };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

module.exports = { prepareCandidate };
