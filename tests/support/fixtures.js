const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const commonFixtures = path.join(__dirname, '..', 'fixtures', 'common');
const emptyDirectoryPath = 'sample-directory/empty-dir';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function listTree(root) {
  const entries = [];
  const directories = [];

  function walk(current, relative) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
      const stats = fs.lstatSync(absolute);
      if (stats.isSymbolicLink())
        throw new Error(`fixture symlink is not allowed: ${relativePath}`);
      if (stats.isDirectory()) {
        directories.push(relativePath);
        walk(absolute, relativePath);
      } else if (stats.isFile()) {
        entries.push(relativePath);
      }
    }
  }

  walk(root, '');
  entries.sort();
  directories.sort();
  return { files: entries, directories };
}

function digestTree(root) {
  const { files, directories } = listTree(root);
  return {
    files: files.map((relativePath) => {
      const bytes = fs.readFileSync(path.join(root, relativePath));
      return { path: relativePath, size: bytes.length, sha256: sha256(bytes) };
    }),
    directories,
  };
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    const stats = fs.lstatSync(from);
    if (stats.isSymbolicLink()) throw new Error(`fixture symlink is not allowed: ${entry.name}`);
    if (stats.isDirectory()) {
      copyDirectory(from, to);
    } else if (stats.isFile()) {
      fs.copyFileSync(from, to);
      fs.chmodSync(to, stats.mode);
    }
  }
}

function makeTempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-gallery-fixture-'));
  fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
  return {
    root,
    skillsDir: path.join(root, 'skills'),
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function copyCommonFixtures(projectRoot) {
  const skillsDir = path.join(projectRoot, 'skills');
  copyDirectory(commonFixtures, skillsDir);
  const emptyDirectory = path.join(skillsDir, ...emptyDirectoryPath.split('/'));
  fs.mkdirSync(emptyDirectory, { recursive: true });
  return { skillsDir, emptyDirectory: toPosix(path.relative(projectRoot, emptyDirectory)) };
}

module.exports = {
  commonFixtures,
  copyCommonFixtures,
  digestTree,
  listTree,
  makeTempProject,
  sha256,
  toPosix,
};
