const crypto = require('node:crypto');

const { createDiagnostic } = require('./diagnostics');
const { collectSkillFiles } = require('./validate');

const DIGEST_VERSION = 'skill-content-v1';

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function computeDigest({ files, directories = [] }) {
  const fileItems = files
    .map((file) => [file.path, file.sha256, Boolean(file.executable)])
    .sort((left, right) => compareUtf8(left[0], right[0]));
  const emptyDirectories = [...directories].sort(compareUtf8);
  const payload = [DIGEST_VERSION, fileItems, emptyDirectories];
  return crypto
    .createHash('sha256')
    .update(Buffer.from(JSON.stringify(payload), 'utf8'))
    .digest('hex');
}

function recordDigest(record) {
  const value = typeof record === 'string' ? record : JSON.stringify(record);
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function failure(diagnostics) {
  return { ok: false, snapshot: null, diagnostics };
}

function snapshotSkill({ projectRoot, record, onBeforeRead }) {
  const recordBefore = JSON.stringify(record);
  const first = collectSkillFiles({ projectRoot, record });
  if (!first.ok) return failure(first.diagnostics);

  if (onBeforeRead) onBeforeRead();

  const second = collectSkillFiles({ projectRoot, record });
  if (!second.ok) return failure(second.diagnostics);

  const firstDigest = computeDigest({
    files: first.files,
    directories: first.directories,
  });
  const secondDigest = computeDigest({
    files: second.files,
    directories: second.directories,
  });
  const recordAfter = JSON.stringify(record);
  if (firstDigest !== secondDigest || recordBefore !== recordAfter) {
    return failure([
      createDiagnostic('E_SOURCE_CHANGED', {
        slug: record?.slug,
        message: '快照读取前后输入发生变化',
      }),
    ]);
  }

  return {
    ok: true,
    snapshot: {
      slug: record.slug,
      kind: record.content_path === `skills/${record.slug}/SKILL.md` ? 'directory' : 'single',
      rootName:
        record.content_path === `skills/${record.slug}/SKILL.md`
          ? record.slug
          : `${record.slug}.md`,
      contentPath: record.content_path,
      files: second.files,
      directories: second.directories,
      digest: secondDigest,
      recordDigest: recordDigest(recordBefore),
    },
    diagnostics: [],
  };
}

module.exports = {
  computeDigest,
  DIGEST_VERSION,
  recordDigest,
  snapshotSkill,
};
