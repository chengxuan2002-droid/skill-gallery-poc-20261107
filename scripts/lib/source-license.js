'use strict';

const crypto = require('node:crypto');

const LICENSE_PATTERN = /^(LICEN[CS]E|COPYING|NOTICE)(\..*)?$/i;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function findLicense(files) {
  const paths = [...files.keys()].sort();
  for (const relativePath of paths) {
    const name = relativePath.split('/').pop();
    if (LICENSE_PATTERN.test(name)) {
      return { path: relativePath, sha256: sha256(files.get(relativePath)) };
    }
  }
  return null;
}

module.exports = { LICENSE_PATTERN, findLicense, sha256 };
