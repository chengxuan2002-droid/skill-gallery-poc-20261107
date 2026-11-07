const { createDiagnostic } = require('./diagnostics');
const { validateContentPath } = require('./paths');

function scopesOverlap(left, right) {
  if (left.path === right.path) return true;
  if (left.kind === 'directory' && right.path.startsWith(`${left.root}/`)) return true;
  if (right.kind === 'directory' && left.path.startsWith(`${right.root}/`)) return true;
  return false;
}

function validateRecordOwnership(records) {
  if (!Array.isArray(records)) {
    return {
      ok: false,
      diagnostics: [createDiagnostic('E_SCHEMA', { message: 'records 必须是数组' })],
    };
  }

  const diagnostics = [];
  const owners = new Map();
  const scopes = [];

  for (const record of records) {
    const slug = typeof record?.slug === 'string' ? record.slug : null;
    const contentPath = typeof record?.content_path === 'string' ? record.content_path : null;
    const content = validateContentPath(slug, contentPath);
    if (!content.ok) {
      diagnostics.push(
        createDiagnostic(content.code, {
          slug,
          path: contentPath,
          message: content.message,
        }),
      );
      continue;
    }

    if (owners.has(slug)) {
      diagnostics.push(
        createDiagnostic('E_DUPLICATE', {
          slug,
          path: content.path,
          message: `slug 重复：${owners.get(slug)}`,
        }),
      );
      continue;
    }
    owners.set(slug, content.path);

    const overlap = scopes.find((scope) => scopesOverlap(content, scope));
    if (overlap) {
      diagnostics.push(
        createDiagnostic('E_DUPLICATE', {
          slug,
          path: content.path,
          message: `内容路径与 ${overlap.slug} 重叠`,
        }),
      );
      continue;
    }
    scopes.push({ slug, kind: content.kind, path: content.path, root: content.root });
  }

  return { ok: diagnostics.length === 0, diagnostics };
}

module.exports = { validateRecordOwnership };
