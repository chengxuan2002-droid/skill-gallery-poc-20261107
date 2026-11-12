'use strict';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const COMMANDS = new Set(['preview', 'add', 'import', 'replace', 'status']);
const REF_POLICIES = new Set(['branch', 'release', 'pinned']);

function failure(code, message) {
  return { ok: false, diagnostics: [{ code, path: null, message }] };
}

function readValue(args, index) {
  const value = args[index];
  if (value === undefined || value.startsWith('--')) return null;
  return value;
}

function defaults() {
  return {
    input: null,
    metaPath: null,
    slug: null,
    expectedRevision: null,
    runId: null,
    source: null,
    publish: false,
    wait: false,
    json: true,
  };
}

function parseOptions(args) {
  const options = defaults();
  const positional = [];
  const source = { repository: null, path: null, ref: null, refPolicy: 'branch' };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--publish') {
      options.publish = true;
    } else if (arg === '--wait') {
      options.wait = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--meta') {
      const value = readValue(args, ++index);
      if (value === null) return failure('E_USAGE', '--meta 需要值');
      options.metaPath = value;
    } else if (arg === '--expected-revision') {
      const value = readValue(args, ++index);
      if (value === null) return failure('E_USAGE', '--expected-revision 需要值');
      options.expectedRevision = value;
    } else if (arg === '--run') {
      const value = readValue(args, ++index);
      if (value === null) return failure('E_USAGE', '--run 需要值');
      options.runId = value;
    } else if (arg === '--repo') {
      const value = readValue(args, ++index);
      if (value === null) return failure('E_USAGE', '--repo 需要值');
      source.repository = value;
    } else if (arg === '--path') {
      const value = readValue(args, ++index);
      if (value === null) return failure('E_USAGE', '--path 需要值');
      source.path = value;
    } else if (arg === '--ref') {
      const value = readValue(args, ++index);
      if (value === null) return failure('E_USAGE', '--ref 需要值');
      source.ref = value;
    } else if (arg === '--ref-policy') {
      const value = readValue(args, ++index);
      if (value === null) return failure('E_USAGE', '--ref-policy 需要值');
      if (!REF_POLICIES.has(value)) return failure('E_SCHEMA', '--ref-policy 不合法');
      source.refPolicy = value;
    } else if (arg.startsWith('--')) {
      return failure('E_USAGE', `未知选项 ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  options.source = source;
  return { ok: true, options, positional };
}

function validateSlug(slug) {
  return typeof slug === 'string' && slug.length <= 64 && SLUG_PATTERN.test(slug);
}

function validateSource(source) {
  if (!source.repository || !source.path || !source.ref) {
    return failure('E_USAGE', 'import 需要 --repo、--path 与 --ref');
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(source.repository)) {
    return failure('E_SCHEMA', '--repo 必须是 owner/repository');
  }
  return null;
}

function validateCommand(command, options, positional) {
  if (command === 'preview' || command === 'add') {
    if (positional.length !== 1) return failure('E_USAGE', `${command} 需要一个内容路径`);
    options.input = positional[0];
    if (!options.metaPath) return failure('E_USAGE', `${command} 需要 --meta`);
    if (!options.publish && options.wait) return failure('E_USAGE', '--wait 只能与 --publish 使用');
  } else if (command === 'import') {
    if (positional.length !== 0) return failure('E_USAGE', 'import 不接受位置参数');
    const sourceFailure = validateSource(options.source);
    if (sourceFailure) return sourceFailure;
    if (!options.metaPath) return failure('E_USAGE', 'import 需要 --meta');
    if (!options.publish && options.wait) return failure('E_USAGE', '--wait 只能与 --publish 使用');
  } else if (command === 'replace') {
    if (positional.length !== 2) return failure('E_USAGE', 'replace 需要 slug 与内容路径');
    options.slug = positional[0];
    options.input = positional[1];
    if (!validateSlug(options.slug)) return failure('E_SCHEMA', 'slug 不合法');
    if (!options.expectedRevision) return failure('E_USAGE', 'replace 需要 --expected-revision');
    if (!SHA_PATTERN.test(options.expectedRevision)) {
      return failure('E_SCHEMA', '--expected-revision 必须是 40 位小写十六进制');
    }
    if (!options.publish && options.wait) return failure('E_USAGE', '--wait 只能与 --publish 使用');
  } else if (command === 'status') {
    if (positional.length !== 0) return failure('E_USAGE', 'status 不接受位置参数');
    if (!options.runId) return failure('E_USAGE', 'status 需要 --run');
    if (options.publish || options.wait || options.metaPath || options.input) {
      return failure('E_USAGE', 'status 不支持发布或内容参数');
    }
  }

  if (command === 'preview' && options.publish)
    return failure('E_USAGE', 'preview 不允许 --publish');
  if (command === 'add' && options.source.repository) {
    return failure('E_USAGE', 'add 不接受来源参数');
  }
  if (command === 'import' && options.input) return failure('E_USAGE', 'import 不接受本地路径');

  return null;
}

function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.length === 0) return failure('E_USAGE', '缺少命令');
  const [command, ...rest] = argv;
  if (!COMMANDS.has(command)) return failure('E_USAGE', '未知命令');

  const parsed = parseOptions(rest);
  if (!parsed.ok) return parsed;
  const { options, positional } = parsed;
  const invalid = validateCommand(command, options, positional);
  if (invalid) return invalid;

  return { ok: true, command, ...options };
}

module.exports = { parseArgs };
