const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { prepareOutputs } = require('./build-outputs');
const { contentRevision, loadCatalog, prepareSkills } = require('./build-inputs');
const { recoverBuildTransaction } = require('./build-recovery');
const { rasterType, renderMarkdown } = require('./build-render');
const { abortBuild, acquireBuildLock, commitBuild } = require('./build-transaction');
const { createDiagnostic } = require('./diagnostics');

function diagnostic(code, context, message) {
  return createDiagnostic(code, { ...context, message });
}

function fail(diagnostics) {
  return { ok: false, status: 'failed', diagnostics };
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function recheckInputs({ projectRoot, records, revision }) {
  const current = loadCatalog(projectRoot);
  if (!current.ok) return false;
  if (JSON.stringify(current.records) !== JSON.stringify(records)) return false;
  const prepared = prepareSkills(projectRoot, current.records);
  if (!prepared.ok) return false;
  return contentRevision(projectRoot, prepared.skills) === revision;
}

async function renderSkills(skills) {
  for (const skill of skills) {
    const rendered = new Map();
    const media = [];
    const mediaUrls = new Map();
    for (const file of skill.snapshot.files.filter((item) => item.path.endsWith('.md'))) {
      let text;
      if (file.path === skill.mainPath) {
        text = skill.body;
      } else {
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes);
        } catch {
          return fail([
            diagnostic(
              'E_UTF8',
              { slug: skill.record.slug, path: file.path },
              'Markdown 不是合法 UTF-8',
            ),
          ]);
        }
      }
      const imageRequests = [];
      let result = await renderMarkdown(text, {
        baseDir: path.posix.dirname(file.path),
        fileSet: skill.fileSet,
        fileUrls: skill.fileUrls,
        mediaUrls: new Map(),
        imageRequests,
        relativePath: file.path,
      });
      if (result.errors.length > 0) {
        return fail(result.errors.map((item) => ({ ...item, slug: skill.record.slug })));
      }
      if (file.path === skill.mainPath) {
        for (const relative of new Set(imageRequests)) {
          const source = skill.snapshot.files.find((item) => item.path === relative);
          const type = source ? rasterType(source.bytes) : null;
          if (!type) continue;
          const url = `media/${skill.record.slug}/${source.sha256}.${type.ext}`;
          mediaUrls.set(relative, url);
          media.push({ path: url, sourcePath: relative, bytes: source.bytes });
        }
        if (mediaUrls.size > 0) {
          result = await renderMarkdown(text, {
            baseDir: path.posix.dirname(file.path),
            fileSet: skill.fileSet,
            fileUrls: skill.fileUrls,
            mediaUrls,
            imageRequests: [],
            relativePath: file.path,
          });
          if (result.errors.length > 0) {
            return fail(result.errors.map((item) => ({ ...item, slug: skill.record.slug })));
          }
        }
      }
      rendered.set(file.path, result);
    }
    const main = rendered.get(skill.mainPath);
    if (!main) {
      return fail([diagnostic('E_MAIN_MISSING', { slug: skill.record.slug }, '主文档无法渲染')]);
    }
    skill.media = media;
    skill.bodyHtml = main.body;
    skill.contentText = main.contentText;
  }
  return { ok: true };
}

function verifyStage(stage, revision, manifest) {
  const index = JSON.parse(
    fs.readFileSync(path.join(stage, 'assets', 'search-index.json'), 'utf8'),
  );
  if (index.contentRevision !== revision || index.schemaVersion !== 1) {
    return fail([diagnostic('E_BUILD', {}, '索引快照标识不一致')]);
  }
  for (const item of index.skills) {
    const detail = JSON.parse(
      fs.readFileSync(path.join(stage, 'details', `${item.slug}.json`), 'utf8'),
    );
    if (
      detail.contentRevision !== revision ||
      detail.slug !== item.slug ||
      detail.digest !== item.digest
    ) {
      return fail([diagnostic('E_BUILD', { slug: item.slug }, '详情与索引快照不一致')]);
    }
  }
  if (manifest.contentRevision !== revision) {
    return fail([diagnostic('E_BUILD', {}, 'manifest 快照标识不一致')]);
  }
  for (const artifact of manifest.artifacts) {
    if (artifact.path === 'manifest.json') {
      return fail([diagnostic('E_BUILD', {}, 'manifest 不能包含自身')]);
    }
    const target = path.join(stage, ...artifact.path.split('/'));
    if (!fs.existsSync(target) || !fs.lstatSync(target).isFile()) {
      return fail([diagnostic('E_BUILD', { path: artifact.path }, 'manifest 产物缺失')]);
    }
    const bytes = fs.readFileSync(target);
    if (bytes.length !== artifact.size || sha256(bytes) !== artifact.sha256) {
      return fail([diagnostic('E_BUILD', { path: artifact.path }, 'manifest 产物摘要不一致')]);
    }
  }
  return { ok: true };
}

async function buildSite({
  projectRoot,
  outputName = 'dist',
  rename = fs.renameSync,
  hooks = {},
} = {}) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) {
    return fail([diagnostic('E_PATH', {}, '项目根必须是绝对路径')]);
  }
  if (
    typeof outputName !== 'string' ||
    !/^[A-Za-z0-9._-]+$/.test(outputName) ||
    outputName === '.' ||
    outputName === '..'
  ) {
    return fail([diagnostic('E_PATH', {}, '输出目录名不合法')]);
  }
  const catalog = loadCatalog(projectRoot);
  if (!catalog.ok) return catalog;
  const records = catalog.records;
  const prepared = prepareSkills(projectRoot, records);
  if (!prepared.ok) return prepared;
  const rendered = await renderSkills(prepared.skills);
  if (!rendered.ok) return rendered;

  const revision = contentRevision(projectRoot, prepared.skills);
  const parent = path.dirname(path.join(projectRoot, outputName));
  const runId = crypto.randomBytes(16).toString('hex');
  const lock = acquireBuildLock({ parent, runId });
  if (!lock.ok) return fail(lock.diagnostics);
  const recovered = recoverBuildTransaction({
    parent,
    outputName,
    rename,
    remove: hooks.remove,
  });
  if (!recovered.ok) {
    abortBuild({ lockDir: lock.lockDir });
    return fail([diagnostic('E_RECOVERY_REQUIRED', {}, recovered.message)]);
  }
  const stage = path.join(parent, `.dist.stage-${runId}`);

  try {
    const outputs = await prepareOutputs({
      projectRoot,
      skills: prepared.skills,
      contentRevision: revision,
      stage,
      zipWriter: hooks.zipWriter,
    });
    if (!outputs.ok) {
      abortBuild({ lockDir: lock.lockDir, stage });
      return fail(outputs.diagnostics);
    }
    if (hooks.afterPrepareOutputs) await hooks.afterPrepareOutputs({ stage, outputs });
    const verified = verifyStage(stage, revision, outputs.manifest);
    if (!verified.ok) {
      abortBuild({ lockDir: lock.lockDir, stage });
      return verified;
    }
    if (hooks.beforeCommit) {
      await hooks.beforeCommit({ stage, outputDir: path.join(parent, outputName) });
    }
    if (!recheckInputs({ projectRoot, records, revision })) {
      abortBuild({ lockDir: lock.lockDir, stage });
      return fail([diagnostic('E_SOURCE_CHANGED', {}, '提交前输入发生变化')]);
    }
    const outputDir = path.join(parent, outputName);
    const hadPrevious = fs.existsSync(outputDir);
    const previousManifest = hadPrevious && fs.existsSync(path.join(outputDir, 'manifest.json'));
    const committed = await commitBuild({
      parent,
      outputName,
      stage,
      manifestBytes: fs.readFileSync(path.join(stage, 'manifest.json')),
      previousManifestSha256: previousManifest
        ? sha256(fs.readFileSync(path.join(outputDir, 'manifest.json')))
        : null,
      hadPrevious,
      runId,
      rename,
      writeTransaction: hooks.writeTransaction,
      remove: hooks.remove,
    });
    if (!committed.ok) {
      return {
        ok: false,
        status: 'failed',
        cleanupStatus: committed.cleanupStatus,
        diagnostics: committed.diagnostics,
      };
    }
    return {
      ok: true,
      status: 'built',
      cleanupStatus: committed.cleanupStatus,
      contentRevision: revision,
      outputDir,
      diagnostics: [],
    };
  } catch {
    abortBuild({ lockDir: lock.lockDir, stage });
    return fail([diagnostic('E_BUILD', {}, '构建失败，旧输出保持不变')]);
  }
}

module.exports = { buildSite, contentRevision, loadCatalog, prepareSkills };
