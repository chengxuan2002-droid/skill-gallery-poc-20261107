'use strict';

const { execFileSync } = require('node:child_process');

const TERMINAL = new Set(['published', 'failed', 'superseded']);

function deriveRunStatus(run = {}) {
  const jobs = Array.isArray(run.jobs) ? run.jobs : [];
  const build = jobs.find((job) => job.name === 'build');
  const deploy = jobs.find((job) => job.name === 'deploy');
  const deployStep = deploy?.steps?.find((step) => step.name === 'Deploy to GitHub Pages');

  let contentStatus = 'pending';
  if (build?.conclusion === 'success') contentStatus = 'built';
  else if (['failure', 'cancelled', 'timed_out'].includes(build?.conclusion))
    contentStatus = 'failed';

  let deployStatus = 'pending';
  if (build?.conclusion === 'failure' || build?.conclusion === 'cancelled') {
    deployStatus = 'pending';
  } else if (!deploy) {
    deployStatus = 'pending';
  } else if (deploy.conclusion === 'success') {
    deployStatus = deployStep?.conclusion === 'skipped' ? 'superseded' : 'published';
  } else if (['failure', 'cancelled', 'timed_out'].includes(deploy.conclusion)) {
    deployStatus = 'failed';
  } else if (deploy.conclusion === 'skipped') {
    deployStatus = build?.conclusion === 'success' ? 'superseded' : 'pending';
  } else if (deploy.conclusion === null || deploy.conclusion === undefined) {
    deployStatus =
      run.status === 'in_progress' && build?.conclusion === 'success' ? 'deploying' : 'pending';
  }

  return {
    content_status: contentStatus,
    deploy_status: deployStatus,
    conclusion: run.conclusion ?? null,
    run_url: run.url ?? run.html_url ?? null,
    head_sha: run.headSha ?? run.head_sha ?? null,
  };
}

function statusOutcome(runId, run) {
  const derived = deriveRunStatus(run);
  const base = {
    slug: null,
    content_revision: null,
    content_status: derived.content_status,
    deploy_status: derived.deploy_status,
    commit_sha: derived.head_sha,
    run_url: derived.run_url,
    public_url: null,
    errors: [],
  };

  if (derived.deploy_status === 'published') {
    return { ...base, status: 'published' };
  }
  if (derived.deploy_status === 'superseded') {
    return {
      ...base,
      status: 'superseded',
      errors: [{ code: 'E_SUPERSEDED', path: null, message: `运行 ${runId} 的部署已过期` }],
    };
  }
  if (derived.content_status === 'failed') {
    return {
      ...base,
      status: 'failed',
      errors: [{ code: 'E_BUILD', path: null, message: `运行 ${runId} 构建失败` }],
    };
  }
  if (derived.deploy_status === 'failed') {
    return {
      ...base,
      status: 'failed',
      errors: [{ code: 'E_DEPLOY', path: null, message: `运行 ${runId} 部署失败` }],
    };
  }
  return { ...base, status: 'pending' };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRun({
  runId,
  reader,
  timeoutMs = 900000,
  intervalMs = 10000,
  now = () => Date.now(),
  sleep = defaultSleep,
}) {
  const deadline = now() + timeoutMs;
  for (;;) {
    const outcome = statusOutcome(runId, reader.get(runId));
    if (TERMINAL.has(outcome.status)) return { timeout: false, outcome };
    if (now() >= deadline) {
      return {
        timeout: true,
        outcome: {
          ...outcome,
          status: 'pending',
          errors: [{ code: 'E_TIMEOUT', path: null, message: '等待部署超时' }],
        },
      };
    }
    await sleep(intervalMs);
  }
}

function createGhRunReader() {
  function runView(runId) {
    const raw = execFileSync(
      'gh',
      ['run', 'view', String(runId), '--json', 'status,conclusion,jobs,headSha,url'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const parsed = JSON.parse(raw);
    return {
      status: parsed.status,
      conclusion: parsed.conclusion,
      headSha: parsed.headSha,
      url: parsed.url,
      jobs: (parsed.jobs || []).map((job) => ({
        name: job.name,
        conclusion: job.conclusion,
        steps: (job.steps || []).map((step) => ({
          name: step.name,
          conclusion: step.conclusion,
        })),
      })),
    };
  }

  return {
    get: runView,
    findByCommit(sha) {
      const raw = execFileSync(
        'gh',
        [
          'run',
          'list',
          '--commit',
          sha,
          '--workflow',
          'maintain.yml',
          '--limit',
          '1',
          '--json',
          'databaseId',
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const runs = JSON.parse(raw);
      return runs.length > 0 ? String(runs[0].databaseId) : null;
    },
  };
}

module.exports = { createGhRunReader, deriveRunStatus, statusOutcome, waitForRun };
