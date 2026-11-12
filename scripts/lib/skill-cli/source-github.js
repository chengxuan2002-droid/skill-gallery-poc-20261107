'use strict';

const shared = require('../github-source');

function normalize(source) {
  if (!source || typeof source !== 'object') return source;
  return {
    provider: 'github',
    repository: source.repository,
    path: source.path,
    ref_policy: source.ref_policy ?? source.refPolicy ?? 'branch',
    ref: source.ref,
    enabled: source.enabled ?? true,
  };
}

function adapt(result) {
  if (result.ok) return result;
  return {
    ...result,
    diagnostics: (result.diagnostics ?? []).map((item) => {
      if (item.code === 'E_SCHEMA' || item.code === 'E_MAIN_MISSING' || item.code === 'E_SOURCE') {
        return item;
      }
      return { ...item, code: 'E_SOURCE' };
    }),
  };
}

function fetchSource({ source, reader } = {}) {
  return adapt(shared.fetchSource({ source: normalize(source), reader }));
}

function validateSource(source) {
  return shared.validateSource(normalize(source));
}

module.exports = {
  createGhReader: shared.createGhReader,
  fetchSource,
  validateSource,
};
