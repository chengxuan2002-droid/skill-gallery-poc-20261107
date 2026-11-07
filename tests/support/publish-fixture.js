const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { listTree, sha256 } = require('./fixtures');
const { createDetailFixtureProject } = require('./search-fixture');

function sha40(seed = 'baseline') {
  return crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 40);
}

function resolveInside(root, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error('relative path is required');
  }
  if (path.isAbsolute(relativePath) || relativePath.split('/').includes('..')) {
    throw new Error(`path escapes the fixture: ${relativePath}`);
  }
  const target = path.resolve(root, ...relativePath.split('/'));
  const prefix = `${path.resolve(root)}${path.sep}`;
  if (!target.startsWith(prefix)) throw new Error(`path escapes the fixture: ${relativePath}`);
  return target;
}

function createPublishFixtureProject(options = {}) {
  const project = createDetailFixtureProject(options);
  let distDir = null;

  function requireDist(explicit) {
    const target = explicit || distDir;
    if (!target) throw new Error('build the fixture before tampering with dist');
    return target;
  }

  async function buildDist() {
    const result = await project.buildPreview();
    distDir = result.distDir;
    return result;
  }

  function writeUnderDist(relativePath, bytes, explicitDist) {
    const target = resolveInside(requireDist(explicitDist), relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    return target;
  }

  function injectExtraFile(relativePath = 'docs/plan.md', content = 'extra file\n', explicitDist) {
    return writeUnderDist(relativePath, content, explicitDist);
  }

  function tamperFile(relativePath = 'index.html', suffix = 'tampered', explicitDist) {
    const target = resolveInside(requireDist(explicitDist), relativePath);
    fs.appendFileSync(target, suffix);
    return target;
  }

  function writeCredentialFile(relativePath = '.env', content = 'YOUR_API_KEY_HERE', explicitDist) {
    return writeUnderDist(relativePath, content, explicitDist);
  }

  function snapshotDist(explicitDist) {
    const root = requireDist(explicitDist);
    const { files } = listTree(root);
    return new Map(
      files.map((relativePath) => {
        const bytes = fs.readFileSync(resolveInside(root, relativePath));
        return [relativePath, { size: bytes.length, sha256: sha256(bytes) }];
      }),
    );
  }

  function readManifest(explicitDist) {
    const target = path.join(requireDist(explicitDist), 'manifest.json');
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  }

  return {
    ...project,
    buildDist,
    injectExtraFile,
    readManifest,
    sha40,
    snapshotDist,
    tamperFile,
    writeCredentialFile,
  };
}

module.exports = { createPublishFixtureProject, sha40 };
