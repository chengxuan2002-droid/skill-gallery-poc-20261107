const fs = require('node:fs');

const { createRunStatus, renderSummary } = require('./publish');

const REQUIRED_ENV = ['PUBLISH_RUN_ID', 'PUBLISH_TRIGGER', 'PUBLISH_TARGET_SHA'];

function value(env, name) {
  const result = env[name];
  return typeof result === 'string' && result.length > 0 ? result : null;
}

function contentStatus(env) {
  const explicit = value(env, 'PUBLISH_CONTENT_STATUS');
  if (explicit) return explicit;
  return value(env, 'PUBLISH_JOB_STATUS') === 'success' ? 'built' : 'failed';
}

function deployStatus(env) {
  if (value(env, 'PUBLISH_PHASE') === 'build') return 'pending';
  if (value(env, 'PUBLISH_DEPLOY_DECISION') === 'superseded') return 'superseded';
  const outcome = value(env, 'PUBLISH_DEPLOY_OUTCOME');
  if (outcome === 'success') return 'published';
  if (outcome === 'failure' || outcome === 'cancelled') return 'failed';
  return value(env, 'PUBLISH_JOB_STATUS') === 'failure' ? 'failed' : 'pending';
}

function reason(content, deploy, env) {
  if (content === 'failed') return 'E_BUILD_FAILED';
  if (deploy === 'superseded') return 'E_SUPERSEDED';
  if (deploy === 'failed') return 'E_DEPLOY_FAILED';
  if (value(env, 'PUBLISH_JOB_STATUS') !== 'success') return 'E_PUBLISH_FAILED';
  return null;
}

function createSummaryStatus(env = process.env) {
  const content = contentStatus(env);
  const deploy = deployStatus(env);
  return createRunStatus({
    runId: value(env, 'PUBLISH_RUN_ID') || '',
    trigger: value(env, 'PUBLISH_TRIGGER') || '',
    targetSha: value(env, 'PUBLISH_TARGET_SHA') || '',
    commitStatus: value(env, 'PUBLISH_COMMIT_STATUS') || 'not_applicable',
    contentRevision: value(env, 'PUBLISH_CONTENT_REVISION'),
    contentStatus: content,
    deployStatus: deploy,
    reason: reason(content, deploy, env),
    startedAt: null,
    finishedAt: null,
    runUrl: value(env, 'PUBLISH_RUN_URL'),
  });
}

function safePageUrl(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function renderSummaryFromEnv(env = process.env) {
  const missing = REQUIRED_ENV.filter((name) => !value(env, name));
  if (missing.length > 0) {
    const error = new Error('publish summary environment is incomplete');
    error.code = 'E_SUMMARY_ENV';
    throw error;
  }
  const result = createSummaryStatus(env);
  if (!result.ok) {
    const error = new Error('publish summary status is invalid');
    error.code = result.diagnostics[0]?.code || 'E_STATUS_INPUT';
    throw error;
  }
  return renderSummary(result.status);
}

function writeSummary(env = process.env) {
  const summary = renderSummaryFromEnv(env);
  const pageUrl = safePageUrl(value(env, 'PUBLISH_PAGE_URL'));
  const markdown = pageUrl ? `${summary}- Page: ${pageUrl}\n` : summary;
  const target = value(env, 'GITHUB_STEP_SUMMARY');
  if (target) {
    fs.appendFileSync(target, `${markdown}\n`);
  } else {
    process.stdout.write(markdown);
  }
  return markdown;
}

module.exports = { createSummaryStatus, renderSummaryFromEnv, writeSummary };
