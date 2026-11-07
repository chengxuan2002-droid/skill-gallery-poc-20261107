const fs = require('node:fs');
const path = require('node:path');

const { makeTempProject } = require('./fixtures');

const WORKSPACE = path.resolve(__dirname, '../..');
const SITE_FILES = [
  'index.html',
  'assets/app.js',
  'assets/app-dom.js',
  'assets/app-search.js',
  'assets/app-filters.js',
  'assets/app-views.js',
  'assets/app-actions.js',
  'assets/app-detail.js',
  'assets/style.css',
];

const FIXED_QUERIES = [
  'debug',
  'debugging',
  'review',
  'code review',
  'handoff',
  'workflow',
  'markdown',
  'document conversion',
  'security',
  'tests',
  'maintainability',
  'pull request',
  'bug',
  'reproduce',
  'problem solving',
  'code quality',
  'sample',
  'long code',
  'table',
  'chinese path',
  'alpha',
  'beta',
  'productivity',
  'format',
  'verify',
  '调试',
  '文档',
  '转换',
  '交接',
  '进度',
  '代码',
  '审查',
  '安全',
  '测试',
  '维护',
  '表格',
  '代码块',
  '中文路径',
  '样例',
  '快速开始',
  '复现',
  '定位',
  '修复',
  '验证',
  '办公文档',
  '批量处理',
  '结构化',
  '备份',
  '备注',
  '最小标准',
];

function writeSiteAssets(root) {
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  for (const relative of SITE_FILES) {
    const source = path.join(WORKSPACE, relative);
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  const searchModule = path.join(root, 'assets/app-search.js');
  if (!fs.existsSync(searchModule)) {
    fs.writeFileSync(
      searchModule,
      'globalThis.SkillGallerySearch = globalThis.SkillGallerySearch || {};\n',
    );
  }
  fs.writeFileSync(path.join(root, '.nojekyll'), '');
}

function writeCatalog(root, record) {
  fs.mkdirSync(path.join(root, 'catalog'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'catalog', `${record.slug}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
  );
}

function writeSingleSkill(root, { slug, displayName, description, body, version }) {
  const lines = [
    '---',
    `name: ${displayName}`,
    `description: ${description}`,
    ...(version ? [`version: "${version}"`] : []),
    '---',
    '',
    body,
    '',
  ];
  fs.writeFileSync(path.join(root, 'skills', `${slug}.md`), lines.join('\n'));
}

function writeDirectorySkill(root, { slug, displayName, description, body, version }) {
  const skillRoot = path.join(root, 'skills', slug);
  fs.mkdirSync(path.join(skillRoot, 'references'), { recursive: true });
  const lines = [
    '---',
    `name: ${displayName}`,
    `description: ${description}`,
    ...(version ? [`version: "${version}"`] : []),
    '---',
    '',
    body,
    '',
  ];
  fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), lines.join('\n'));
  fs.writeFileSync(path.join(skillRoot, 'references/guide.md'), '# 指南\n\n保留中文路径。\n');
}

function performanceBody(index, totalBytes, count) {
  const size = Math.max(1, Math.ceil(totalBytes / count));
  const unit = `Performance fixture body ${String(index).padStart(4, '0')}. `;
  return unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
}

function performanceRecord(index, totalBytes, count) {
  const slug = `perf-${String(index + 1).padStart(4, '0')}`;
  const displayName = `Performance Sample ${String(index + 1).padStart(4, '0')}`;
  const description = `Deterministic search fixture ${index + 1}`;
  const version = '1.0.0';
  const updated = `2026-02-${String((index % 28) + 1).padStart(2, '0')}`;
  return {
    slug,
    displayName,
    description,
    version,
    body: performanceBody(index + 1, totalBytes, count),
    record: {
      schemaVersion: 1,
      slug,
      display_name: displayName,
      description,
      tags: ['perf', `group-${index % 10}`],
      platforms: ['generic'],
      allowed_dot_paths: [],
      source_type: 'github',
      usage: `Performance fixture usage ${index + 1}`,
      notes: null,
      content_path: `skills/${slug}.md`,
      source_tracking: null,
      author: `Author ${index % 10}`,
      homepage_url: null,
      repository_url: null,
      license: null,
      created_at: '2026-01-01',
      updated_at: updated,
      declared_version: version,
    },
  };
}

function createSearchFixtureProject({ count = 1000, totalBytes = 10 * 1024 * 1024, root } = {}) {
  const project = root ? { root, cleanup() {} } : makeTempProject();
  if (!path.isAbsolute(project.root)) throw new Error('fixture root must be absolute');
  fs.mkdirSync(path.join(project.root, 'skills'), { recursive: true });
  writeSiteAssets(project.root);
  const records = [];
  for (let index = 0; index < count; index++) {
    const item = performanceRecord(index, totalBytes, count);
    writeSingleSkill(project.root, item);
    writeCatalog(project.root, item.record);
    records.push(item.record);
  }
  return {
    ...project,
    records,
    queries: FIXED_QUERIES,
    buildPreview: () => buildFixturePreview(project),
  };
}

function createDetailFixtureProject({ root } = {}) {
  const project = root ? { root, cleanup() {} } : makeTempProject();
  if (!path.isAbsolute(project.root)) throw new Error('fixture root must be absolute');
  fs.mkdirSync(path.join(project.root, 'skills'), { recursive: true });
  writeSiteAssets(project.root);

  const completeBody = [
    '# 完整详情',
    '',
    '## 快速开始',
    '',
    '```js',
    "const value = '保留代码';",
    '```',
    '',
    '| 字段 | 值 |',
    '| --- | --- |',
    '| 中文 | 保留 |',
    '',
    '阅读 [指南](references/guide.md)。',
  ].join('\n');
  writeDirectorySkill(project.root, {
    slug: 'complete-detail',
    displayName: '完整详情样例',
    description: '包含代码、表格、中文路径和完整元数据',
    version: '1.2.3',
    body: completeBody,
  });
  writeCatalog(project.root, {
    schemaVersion: 1,
    slug: 'complete-detail',
    display_name: '完整详情样例',
    description: '包含代码、表格、中文路径和完整元数据',
    tags: ['sample', 'detail'],
    platforms: ['generic', 'codex'],
    allowed_dot_paths: [],
    source_type: 'self-built',
    usage: '适用场景：检查完整详情。\n使用方法：打开详情并阅读代码、表格和附件。',
    notes: '站内备注不进入原件。',
    content_path: 'skills/complete-detail/SKILL.md',
    source_tracking: null,
    author: '示例作者',
    homepage_url: 'https://example.com/home',
    repository_url: 'https://github.com/example/skill',
    license: 'MIT',
    created_at: '2026-01-01',
    updated_at: '2026-09-01',
    declared_version: '1.2.3',
  });

  const missingBody = '# 缺失详情\n\n只有名称和简介的合法样例。';
  writeSingleSkill(project.root, {
    slug: 'missing-detail',
    displayName: '缺失详情样例',
    description: '作者、版本、地址和日期缺失',
    body: missingBody,
  });
  writeCatalog(project.root, {
    schemaVersion: 1,
    slug: 'missing-detail',
    display_name: '缺失详情样例',
    description: '作者、版本、地址和日期缺失',
    tags: [],
    platforms: [],
    allowed_dot_paths: [],
    source_type: null,
    usage: null,
    notes: null,
    content_path: 'skills/missing-detail.md',
    source_tracking: null,
    author: null,
    homepage_url: null,
    repository_url: null,
    license: null,
    created_at: null,
    updated_at: null,
    declared_version: null,
  });

  return {
    ...project,
    queries: FIXED_QUERIES,
    buildPreview: () => buildFixturePreview(project),
  };
}

async function buildFixturePreview(project) {
  const { buildSite } = require('../../scripts/lib/build-site');
  const result = await buildSite({
    projectRoot: project.root,
    outputName: 'dist',
  });
  return {
    ...result,
    distDir: path.join(project.root, 'dist'),
  };
}

module.exports = {
  FIXED_QUERIES,
  buildFixturePreview,
  createDetailFixtureProject,
  createSearchFixtureProject,
};
