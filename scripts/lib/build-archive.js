const fs = require('node:fs');
const path = require('node:path');
const yazl = require('yazl');

const FIXED_MTIME = new Date('1980-01-01T00:00:00Z');

function writeZip(zipPath, rootName, files, directories) {
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
      zip.addBuffer(file.bytes, `${rootName}/${file.path}`, {
        mode: file.executable ? 0o755 : 0o644,
        mtime: FIXED_MTIME,
      });
    }
    for (const directory of [...directories].sort()) {
      zip.addEmptyDirectory(`${rootName}/${directory}/`, {
        mode: 0o755,
        mtime: FIXED_MTIME,
      });
    }
    const output = fs.createWriteStream(zipPath);
    output.on('close', resolve);
    output.on('error', reject);
    zip.outputStream.on('error', reject);
    zip.outputStream.pipe(output);
    zip.end();
  });
}

module.exports = { FIXED_MTIME, writeZip };
