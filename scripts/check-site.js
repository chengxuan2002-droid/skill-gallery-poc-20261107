const { setTimeout: delay } = require('node:timers/promises');

const SITE_URL = 'https://chengxuan2002-droid.github.io/skill-gallery/';
const resources = [
  { path: '', types: ['text/html'], kind: 'home' },
  { path: 'assets/app.js', types: ['application/javascript', 'text/javascript'], kind: 'asset' },
  { path: 'assets/style.css', types: ['text/css'], kind: 'asset' },
  { path: 'assets/search-index.json', types: ['application/json'], kind: 'index' },
];

function expectedContent(text, kind) {
  if (kind === 'home') {
    return /<title>\s*Skill Gallery\s*<\/title>/i.test(text) && /\bid=["']app["']/i.test(text);
  }
  if (kind === 'index') {
    try {
      const entries = JSON.parse(text);
      return (
        Array.isArray(entries) &&
        entries.length > 0 &&
        entries.every(
          (entry) =>
            entry &&
            typeof entry.slug === 'string' &&
            entry.slug.trim() &&
            typeof entry.name === 'string' &&
            entry.name.trim() &&
            typeof entry.content === 'string',
        )
      );
    } catch {
      return false;
    }
  }
  return true;
}

async function requestResource(baseUrl, resource, timeoutMs) {
  const signal = AbortSignal.timeout(timeoutMs);
  let response;
  try {
    response = await fetch(new URL(resource.path, baseUrl), { signal, redirect: 'manual' });
    if (response.status !== 200) {
      await response.body?.cancel();
      return { status: 'failed', code: 'HTTP_STATUS', httpStatus: response.status };
    }
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!resource.types.includes(type)) {
      await response.body?.cancel();
      return { status: 'failed', code: 'CONTENT_TYPE', httpStatus: response.status };
    }
    const text = await response.text();
    if (!text.trim()) return { status: 'failed', code: 'BODY_EMPTY', httpStatus: response.status };
    if (!expectedContent(text, resource.kind))
      return { status: 'failed', code: 'CONTENT_INVALID', httpStatus: response.status };
    return { status: 'passed', httpStatus: response.status };
  } catch {
    return {
      status: 'failed',
      code: signal.aborted ? 'TIMEOUT' : 'UNREACHABLE',
      httpStatus: response?.status ?? null,
    };
  }
}

async function checkSite(baseUrl = SITE_URL, { timeoutMs = 8000, retryDelayMs = 1000 } = {}) {
  const results = [];
  for (const resource of resources) {
    let result;
    for (let attempt = 1; attempt <= 2; attempt++) {
      result = {
        path: resource.path || '/',
        ...(await requestResource(baseUrl, resource, timeoutMs)),
        attempts: attempt,
      };
      if (result.status === 'passed') break;
      if (attempt === 1 && retryDelayMs > 0) await delay(retryDelayMs);
    }
    results.push(result);
  }
  return {
    check: 'site',
    site: baseUrl,
    status: results.every((r) => r.status === 'passed') ? 'passed' : 'failed',
    resources: results,
  };
}

if (require.main === module) {
  if (process.argv.length !== 2) {
    console.log(JSON.stringify({ check: 'site', status: 'error', code: 'INVALID_ARGUMENT' }));
    process.exitCode = 2;
  } else {
    checkSite().then(
      (report) => {
        console.log(JSON.stringify(report));
        process.exitCode = report.status === 'passed' ? 0 : 1;
      },
      () => {
        console.log(JSON.stringify({ check: 'site', status: 'error', code: 'CHECK_FAILED' }));
        process.exitCode = 2;
      },
    );
  }
}

module.exports = { checkSite };
