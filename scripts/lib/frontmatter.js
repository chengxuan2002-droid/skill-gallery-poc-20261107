const { isMap, isScalar, isSeq, parseDocument } = require('yaml');

const { createDiagnostic } = require('./diagnostics');

const OPTIONS = { schema: 'core', strict: true, uniqueKeys: true, maxAliasCount: 100 };

function contextFor(context) {
  return { slug: context.slug ?? null, path: context.path ?? null };
}

function failure(code, context, message) {
  return {
    ok: false,
    hasFrontmatter: true,
    meta: Object.create(null),
    body: '',
    text: '',
    diagnostics: [createDiagnostic(code, { ...contextFor(context), message })],
  };
}

function hasNonStringKeys(node) {
  if (isMap(node)) {
    for (const item of node.items) {
      if (!isScalar(item.key) || typeof item.key.value !== 'string') return true;
      if (hasNonStringKeys(item.value)) return true;
    }
  } else if (isSeq(node)) {
    for (const item of node.items) {
      if (hasNonStringKeys(item)) return true;
    }
  }
  return false;
}

function readFrontmatter(buffer, context = {}) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return failure('E_UTF8', context, '主文档不是合法 UTF-8');
  }

  const source = text.replace(/^\uFEFF/, '');
  const lines = source.split(/\r?\n/);
  if (lines[0] !== '---') {
    return {
      ok: true,
      hasFrontmatter: false,
      meta: Object.create(null),
      body: source,
      text: source,
      diagnostics: [],
    };
  }

  const end = lines.findIndex((line, index) => index > 0 && line === '---');
  if (end === -1) return failure('E_YAML', context, 'frontmatter 未闭合');
  const metaText = lines.slice(1, end).join('\n');
  const body = lines.slice(end + 1).join('\n');
  if (!metaText.trim()) {
    return {
      ok: true,
      hasFrontmatter: true,
      meta: Object.create(null),
      body,
      text: source,
      diagnostics: [],
    };
  }

  const document = parseDocument(metaText, OPTIONS);
  if (document.errors.length || document.warnings.length) {
    return failure('E_YAML', context, 'frontmatter 无法严格解析');
  }
  if (hasNonStringKeys(document.contents)) {
    return failure('E_YAML', context, 'frontmatter 根键必须是字符串');
  }

  let data;
  try {
    data = document.toJS({ mapAsMap: false });
  } catch {
    return failure('E_YAML', context, 'frontmatter 别名或结构超出限制');
  }
  if (data !== null && typeof data !== 'object') {
    return failure('E_YAML', context, 'frontmatter 根必须是映射');
  }

  const meta = Object.create(null);
  for (const [key, value] of Object.entries(data || {})) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    meta[key] = value;
  }
  return { ok: true, hasFrontmatter: true, meta, body, text: source, diagnostics: [] };
}

module.exports = { readFrontmatter };
