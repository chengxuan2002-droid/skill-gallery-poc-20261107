const fs = require('node:fs');
const path = require('node:path');

const { makeTempProject } = require('./fixtures');

function recordFor(slug, overrides = {}) {
  return {
    slug,
    content_path: `skills/${slug}.md`,
    display_name: '样例技能',
    description: '用于校验边界的样例',
    ...overrides,
  };
}

function writeFiles(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = path.join(root, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
}

function makeSingleFileProject(content, { slug = 'sample-skill', record = {} } = {}) {
  const project = makeTempProject();
  fs.writeFileSync(path.join(project.skillsDir, `${slug}.md`), content);
  return { project, record: recordFor(slug, record) };
}

function makeDirectoryProject(
  mainContent,
  files = {},
  { slug = 'sample-skill', record = {} } = {},
) {
  const project = makeTempProject();
  const skillRoot = path.join(project.skillsDir, slug);
  fs.mkdirSync(skillRoot, { recursive: true });
  fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), mainContent);
  writeFiles(skillRoot, files);
  return {
    project,
    skillRoot,
    record: recordFor(slug, { content_path: `skills/${slug}/SKILL.md`, ...record }),
  };
}

function secretToken(prefix = 'ghp_', length = 20) {
  return `${prefix}${'A'.repeat(length)}`;
}

function privateKeyBlock(body) {
  return ['-----BEGIN RSA PRIVATE KEY-----', body, '-----END RSA PRIVATE KEY-----'].join('\n');
}

module.exports = {
  makeDirectoryProject,
  makeSingleFileProject,
  privateKeyBlock,
  recordFor,
  secretToken,
  writeFiles,
};
