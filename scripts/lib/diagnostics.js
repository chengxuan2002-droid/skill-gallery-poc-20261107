const POLICY_VERSION = 1;

function createDiagnostic(code, detail = {}) {
  const diagnostic = {
    code,
    slug: detail.slug ?? null,
    path: detail.path ?? null,
    message: detail.message ?? code,
    severity: 'error',
  };
  if (Number.isInteger(detail.line)) diagnostic.line = detail.line;
  if (Number.isInteger(detail.column)) diagnostic.column = detail.column;
  return diagnostic;
}

module.exports = { POLICY_VERSION, createDiagnostic };
