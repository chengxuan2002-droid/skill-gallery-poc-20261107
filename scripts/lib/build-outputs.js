const fs = require('node:fs');
const path = require('node:path');

const { writeZip } = require('./build-archive');
const { createDiagnostic } = require('./diagnostics');

function diagnostic(code, context, message) {
  return createDiagnostic(code, { ...context, message });
}

function sha256(bytes) {
  return require('node:crypto').createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeFile(stage, relativePath, bytes) {
  const target = path.join(stage, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}

function publicFields(record) {
  return {
    slug: record.slug,
    display_name: record.display_name,
    description: record.description,
    tags: record.tags,
    platforms: record.platforms,
    author: record.author,
    declared_version: record.declared_version,
    homepage_url: record.homepage_url,
    repository_url: record.repository_url,
    source_type: record.source_type,
    usage: record.usage,
    notes: record.notes,
    license: record.license,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function copyWebAssets(projectRoot, stage, artifacts) {
  for (const relativePath of ['index.html', 'assets/app.js', 'assets/style.css']) {
    const source = path.join(projectRoot, ...relativePath.split('/'));
    if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) {
      return {
        ok: false,
        diagnostics: [diagnostic('E_BUILD', { path: relativePath }, '缺少站点源文件')],
      };
    }
    const bytes = fs.readFileSync(source);
    writeFile(stage, relativePath, bytes);
    artifacts.set(relativePath, bytes);
  }
  for (const relativePath of [
    'assets/app-dom.js',
    'assets/app-search.js',
    'assets/app-filters.js',
    'assets/app-views.js',
    'assets/app-actions.js',
    'assets/app-detail.js',
  ]) {
    const source = path.join(projectRoot, ...relativePath.split('/'));
    if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) {
      return {
        ok: false,
        diagnostics: [diagnostic('E_BUILD', { path: relativePath }, '缺少站点前端模块')],
      };
    }
    const bytes = fs.readFileSync(source);
    writeFile(stage, relativePath, bytes);
    artifacts.set(relativePath, bytes);
  }
  const nojekyll = path.join(projectRoot, '.nojekyll');
  if (fs.existsSync(nojekyll) && fs.lstatSync(nojekyll).isFile()) {
    const bytes = fs.readFileSync(nojekyll);
    writeFile(stage, '.nojekyll', bytes);
    artifacts.set('.nojekyll', bytes);
  }
  const vendorRoot = path.resolve(__dirname, '../../node_modules/minisearch');
  for (const [sourcePath, targetPath] of [
    ['dist/umd/index.js', 'assets/vendor/minisearch-6.3.0.min.js'],
    ['LICENSE.txt', 'assets/vendor/LICENSE.minisearch'],
  ]) {
    const source = path.join(vendorRoot, ...sourcePath.split('/'));
    if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) {
      return {
        ok: false,
        diagnostics: [diagnostic('E_BUILD', { path: targetPath }, '缺少固定 MiniSearch 或许可')],
      };
    }
    const bytes = fs.readFileSync(source);
    writeFile(stage, targetPath, bytes);
    artifacts.set(targetPath, bytes);
  }
  return { ok: true };
}

async function buildSkill(skill, stage, artifacts, contentRevision, zipWriter) {
  const mediaByPath = new Map((skill.media ?? []).map((item) => [item.sourcePath, item.path]));
  for (const item of skill.media ?? []) {
    if (!artifacts.has(item.path)) {
      writeFile(stage, item.path, item.bytes);
      artifacts.set(item.path, item.bytes);
    }
  }
  const files = skill.snapshot.files.map((file) => ({
    path: file.path,
    size: file.size,
    sha256: file.sha256,
    executable: file.executable,
    download_name: path.posix.basename(file.path),
    url: `skills/${skill.record.slug}/${file.sha256}.bin`,
    media_url: mediaByPath.get(file.path),
  }));
  for (const file of skill.snapshot.files) {
    const relativePath = `skills/${skill.record.slug}/${file.sha256}.bin`;
    if (!artifacts.has(relativePath)) {
      writeFile(stage, relativePath, file.bytes);
      artifacts.set(relativePath, file.bytes);
    }
  }
  const mainFile = files.find((file) => file.path === skill.mainPath);
  if (!mainFile) {
    return {
      ok: false,
      diagnostics: [diagnostic('E_MAIN_MISSING', { slug: skill.record.slug }, '主文档缺失')],
    };
  }

  let downloadUrl;
  let downloadName;
  let downloadSha256;
  let downloadSize;
  if (skill.snapshot.kind === 'directory') {
    const zipPath = `downloads/${skill.record.slug}.zip`;
    const absolute = path.join(stage, ...zipPath.split('/'));
    await zipWriter(
      absolute,
      skill.snapshot.rootName,
      skill.snapshot.files,
      skill.snapshot.directories,
    );
    const bytes = fs.readFileSync(absolute);
    artifacts.set(zipPath, bytes);
    downloadUrl = zipPath;
    downloadName = `${skill.record.slug}.zip`;
    downloadSha256 = sha256(bytes);
    downloadSize = bytes.length;
  } else {
    downloadUrl = mainFile.url;
    downloadName = mainFile.download_name;
    downloadSha256 = mainFile.sha256;
    downloadSize = mainFile.size;
  }

  const detail = {
    schemaVersion: 1,
    contentRevision,
    digest: skill.snapshot.digest,
    ...publicFields(skill.record),
    field_sources: skill.record.field_sources,
    skill_name: skill.record.skill_name,
    body_html: skill.bodyHtml,
    raw_url: skill.mainUrl,
    files,
    directories: skill.snapshot.directories,
    download_url: downloadUrl,
    download_name: downloadName,
    download_sha256: downloadSha256,
    download_size: downloadSize,
  };
  const detailPath = `details/${skill.record.slug}.json`;
  const detailBytes = jsonBytes(detail);
  writeFile(stage, detailPath, detailBytes);
  artifacts.set(detailPath, detailBytes);

  return {
    ok: true,
    index: {
      ...publicFields(skill.record),
      digest: skill.snapshot.digest,
      content_text: skill.contentText,
      detail_url: detailPath,
      raw_url: skill.mainUrl,
      download_url: downloadUrl,
    },
    manifest: {
      slug: skill.record.slug,
      digest: skill.snapshot.digest,
      files: skill.snapshot.files.map((file) => ({
        path: file.path,
        size: file.size,
        sha256: file.sha256,
        executable: file.executable,
      })),
      directories: skill.snapshot.directories,
    },
  };
}

async function prepareOutputs({
  projectRoot,
  skills,
  contentRevision,
  stage,
  zipWriter = writeZip,
}) {
  fs.mkdirSync(stage, { recursive: true });
  const artifacts = new Map();
  const copied = copyWebAssets(projectRoot, stage, artifacts);
  if (!copied.ok) return copied;

  const indexSkills = [];
  const manifestSkills = [];
  for (const skill of skills) {
    const built = await buildSkill(skill, stage, artifacts, contentRevision, zipWriter);
    if (!built.ok) return built;
    indexSkills.push(built.index);
    manifestSkills.push(built.manifest);
  }

  const index = { schemaVersion: 1, contentRevision, skills: indexSkills };
  const indexBytes = jsonBytes(index);
  writeFile(stage, 'assets/search-index.json', indexBytes);
  artifacts.set('assets/search-index.json', indexBytes);

  const manifest = {
    schemaVersion: 1,
    contentRevision,
    skills: manifestSkills,
    artifacts: [...artifacts.entries()]
      .map(([relativePath, bytes]) => ({
        path: relativePath,
        size: bytes.length,
        sha256: sha256(bytes),
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
  writeFile(stage, 'manifest.json', jsonBytes(manifest));
  return { ok: true, manifest, artifacts };
}

module.exports = { prepareOutputs, publicFields };
