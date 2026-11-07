const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  allowedDotPaths,
  diagnose,
  emptyResult,
  isBlankBuffer,
  LIMITS,
  statOrNull,
} = require('./admission-policy');
const {
  findPathCollisions,
  isDotPath,
  isForbiddenPath,
  isSystemNoise,
  validateContentPath,
} = require('./paths');

function collectSkillFiles({ projectRoot, record }) {
  const diagnostics = [];
  const excluded = [];
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) {
    return emptyResult([diagnose('E_PATH', {}, '项目根必须是绝对路径')], excluded);
  }
  const content = validateContentPath(record?.slug, record?.content_path);
  if (!content.ok) {
    return emptyResult(
      [diagnose(content.code, { slug: record?.slug, path: record?.content_path }, content.message)],
      excluded,
    );
  }

  const skillsRoot = path.join(projectRoot, 'skills');
  const skillsStats = statOrNull(skillsRoot);
  if (!skillsStats) {
    return emptyResult(
      [diagnose('E_MAIN_MISSING', { slug: record.slug }, 'skills 目录不存在')],
      excluded,
    );
  }
  if (skillsStats.isSymbolicLink()) {
    return emptyResult(
      [diagnose('E_LINK_FILE', { slug: record.slug, path: 'skills' }, 'skills 不能是链接')],
      excluded,
    );
  }
  if (!skillsStats.isDirectory()) {
    return emptyResult(
      [diagnose('E_PATH', { slug: record.slug, path: 'skills' }, 'skills 必须是目录')],
      excluded,
    );
  }

  const allowed = allowedDotPaths(record, diagnostics);
  const seenDotPaths = new Set();
  const records = [];
  const directories = [];
  const mainRelative = content.kind === 'single' ? content.rootName : 'SKILL.md';
  const target = path.join(projectRoot, ...content.path.split('/'));

  function addFile(relativePath, stats, absolute) {
    if (isSystemNoise(path.basename(relativePath))) {
      excluded.push(relativePath);
      return;
    }
    if (isForbiddenPath(relativePath)) {
      diagnostics.push(
        diagnose(
          'E_PATH',
          { slug: record.slug, path: relativePath },
          '路径属于硬性凭证或系统禁止项',
        ),
      );
      return;
    }
    if (isDotPath(relativePath)) {
      if (!allowed.has(relativePath)) {
        diagnostics.push(
          diagnose(
            'E_DOT_PATH_REVIEW',
            { slug: record.slug, path: relativePath },
            '点资源需要逐文件准入',
          ),
        );
        return;
      }
      seenDotPaths.add(relativePath);
    }
    if (stats.isSymbolicLink()) {
      diagnostics.push(
        diagnose('E_LINK_FILE', { slug: record.slug, path: relativePath }, '链接文件不可用'),
      );
      return;
    }
    if (!stats.isFile()) {
      diagnostics.push(
        diagnose('E_LINK_FILE', { slug: record.slug, path: relativePath }, '只允许普通文件'),
      );
      return;
    }
    if (stats.nlink > 1) {
      diagnostics.push(
        diagnose('E_LINK_FILE', { slug: record.slug, path: relativePath }, '硬链接不可用'),
      );
      return;
    }
    records.push({ relativePath, stats, absolute });
  }

  function walk(directory, relative) {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      diagnostics.push(diagnose('E_PATH', { slug: record.slug, path: relative }, '目录无法读取'));
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      const stats = statOrNull(absolute);
      if (!stats) {
        diagnostics.push(
          diagnose('E_PATH', { slug: record.slug, path: childRelative }, '目录项消失'),
        );
        continue;
      }
      if (isSystemNoise(entry.name)) {
        excluded.push(childRelative);
        continue;
      }
      if (stats.isSymbolicLink()) {
        diagnostics.push(
          diagnose('E_LINK_FILE', { slug: record.slug, path: childRelative }, '链接文件不可用'),
        );
        continue;
      }
      if (isForbiddenPath(childRelative)) {
        diagnostics.push(
          diagnose(
            'E_PATH',
            { slug: record.slug, path: childRelative },
            '路径属于硬性凭证或系统禁止项',
          ),
        );
        continue;
      }
      if (stats.isDirectory()) {
        if (fs.readdirSync(absolute).length === 0) directories.push(childRelative);
        walk(absolute, childRelative);
      } else {
        addFile(childRelative, stats, absolute);
      }
    }
  }

  if (content.kind === 'single') {
    const stats = statOrNull(target);
    if (!stats) {
      diagnostics.push(
        diagnose('E_MAIN_MISSING', { slug: record.slug, path: content.path }, '主文档不存在'),
      );
    } else {
      addFile(content.rootName, stats, target);
    }
  } else {
    const root = path.join(projectRoot, ...content.root.split('/'));
    const rootStats = statOrNull(root);
    if (!rootStats) {
      diagnostics.push(
        diagnose('E_MAIN_MISSING', { slug: record.slug, path: content.path }, '主文档不存在'),
      );
    } else if (rootStats.isSymbolicLink()) {
      diagnostics.push(
        diagnose('E_LINK_FILE', { slug: record.slug, path: content.root }, 'Skill 目录不能是链接'),
      );
    } else if (!rootStats.isDirectory()) {
      diagnostics.push(
        diagnose('E_PATH', { slug: record.slug, path: content.root }, 'Skill 根必须是目录'),
      );
    } else {
      walk(root, '');
    }
  }

  if (
    content.kind === 'directory' &&
    !records.some((item) => item.relativePath === mainRelative) &&
    !diagnostics.some((item) => item.path === content.path)
  ) {
    diagnostics.push(
      diagnose('E_MAIN_MISSING', { slug: record.slug, path: content.path }, '主文档不存在'),
    );
  }

  for (const allowedPath of allowed) {
    if (!seenDotPaths.has(allowedPath)) {
      diagnostics.push(
        diagnose(
          'E_DOT_PATH_REVIEW',
          { slug: record.slug, path: allowedPath },
          '点路径准入项不存在',
        ),
      );
    }
  }

  const collisions = findPathCollisions([
    ...records.map((item) => item.relativePath),
    ...directories,
  ]);
  for (const collision of collisions) {
    diagnostics.push(
      diagnose(
        'E_PATH',
        { slug: record.slug, path: collision.path },
        `路径与 ${collision.collisionWith} 发生 ${collision.kind} 冲突`,
      ),
    );
  }

  let totalBytes = 0;
  let mainBytes = null;
  for (const item of records) {
    totalBytes += item.stats.size;
    if (item.relativePath === mainRelative) mainBytes = item.stats.size;
  }
  if (records.length > LIMITS.maxFiles) {
    diagnostics.push(diagnose('E_LIMIT', { slug: record.slug }, '文件数量超过限制'));
  }
  if (totalBytes > LIMITS.maxTotalBytes) {
    diagnostics.push(diagnose('E_LIMIT', { slug: record.slug }, '原始总字节超过限制'));
  }
  if (mainBytes !== null && mainBytes > LIMITS.maxMainBytes) {
    diagnostics.push(
      diagnose('E_LIMIT', { slug: record.slug, path: mainRelative }, '主文档超过大小限制'),
    );
  }

  const files = [];
  if (diagnostics.length === 0) {
    for (const item of records) {
      let bytes;
      try {
        bytes = fs.readFileSync(item.absolute);
      } catch {
        diagnostics.push(
          diagnose('E_PATH', { slug: record.slug, path: item.relativePath }, '文件无法读取'),
        );
        continue;
      }
      if (bytes.length !== item.stats.size) {
        diagnostics.push(
          diagnose(
            'E_SOURCE_CHANGED',
            { slug: record.slug, path: item.relativePath },
            '文件在读取期间发生变化',
          ),
        );
        continue;
      }
      if (item.relativePath === mainRelative && isBlankBuffer(bytes)) {
        diagnostics.push(
          diagnose('E_MAIN_MISSING', { slug: record.slug, path: mainRelative }, '主文档不能为空'),
        );
        continue;
      }
      files.push({
        path: item.relativePath,
        bytes,
        size: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        executable: (item.stats.mode & 0o111) !== 0,
      });
    }
  }

  return { ok: diagnostics.length === 0, files, directories, excluded, diagnostics };
}

module.exports = { collectSkillFiles };
