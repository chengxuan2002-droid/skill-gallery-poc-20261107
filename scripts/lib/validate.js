const { LIMITS } = require('./admission-policy');
const { resolveCatalogRecord } = require('./catalog-merge');
const { validateCatalogRecord } = require('./catalog-schema');
const { createDiagnostic, POLICY_VERSION } = require('./diagnostics');
const { collectSkillFiles } = require('./file-admission');
const { readFrontmatter } = require('./frontmatter');
const { validateRecordOwnership } = require('./ownership');
const { findPathCollisions } = require('./paths');
const { scanSecrets } = require('./secrets');

function validateSkillInput({ projectRoot, record }) {
  const collection = collectSkillFiles({ projectRoot, record });
  const diagnostics = [...collection.diagnostics];
  let frontmatter = null;
  const mainRelative = record?.content_path?.endsWith('/SKILL.md') ? 'SKILL.md' : null;
  const mainFile = mainRelative
    ? collection.files.find((file) => file.path === mainRelative)
    : collection.files[0];
  if (mainFile) {
    frontmatter = readFrontmatter(mainFile.bytes, {
      slug: record?.slug,
      path: mainFile.path,
    });
    diagnostics.push(...frontmatter.diagnostics);
  }
  for (const file of collection.files) {
    diagnostics.push(...scanSecrets(file.bytes, { slug: record?.slug, path: file.path }));
  }
  return {
    ok: diagnostics.length === 0,
    record,
    files: collection.files,
    directories: collection.directories,
    excluded: collection.excluded,
    frontmatter,
    diagnostics,
  };
}

module.exports = {
  createDiagnostic,
  collectSkillFiles,
  findPathCollisions,
  LIMITS,
  POLICY_VERSION,
  readFrontmatter,
  resolveCatalogRecord,
  scanSecrets,
  validateCatalogRecord,
  validateRecordOwnership,
  validateSkillInput,
};
