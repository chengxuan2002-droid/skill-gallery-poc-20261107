const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HEX64 = /^[0-9a-f]{64}$/;
const RUN_ID = /^[0-9a-f]{32}$/;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function failure(message) {
  return { ok: false, code: 'E_RECOVERY_REQUIRED', message };
}

function success(recovered = true) {
  return { ok: true, recovered };
}

function isDirectory(target) {
  try {
    const stats = fs.lstatSync(target);
    return stats.isDirectory() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

function manifestHash(directory) {
  const target = path.join(directory, 'manifest.json');
  try {
    const stats = fs.lstatSync(target);
    if (!stats.isFile() || stats.isSymbolicLink()) return null;
    return sha256(fs.readFileSync(target));
  } catch {
    return null;
  }
}

function directoryMatchesManifest(directory) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  } catch {
    return false;
  }
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.artifacts)) return false;
  for (const artifact of manifest.artifacts) {
    if (!artifact || typeof artifact.path !== 'string' || artifact.path.length === 0) return false;
    if (artifact.path.includes('\\')) return false;
    const segments = artifact.path.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      return false;
    }
    const target = path.join(directory, ...segments);
    let stats;
    try {
      stats = fs.lstatSync(target);
    } catch {
      return false;
    }
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size !== artifact.size) return false;
    if (sha256(fs.readFileSync(target)) !== artifact.sha256) return false;
  }
  return true;
}

function removePath(remove, target) {
  try {
    remove(target, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function renamePath(rename, from, to) {
  try {
    rename(from, to);
    return true;
  } catch {
    return false;
  }
}

function deleteTransaction(remove, transactionPath) {
  return removePath(remove, transactionPath);
}

function validTransaction(record, outputName) {
  if (!record || typeof record !== 'object') return false;
  if (record.schemaVersion !== 1 || record.output_name !== outputName) return false;
  if (typeof record.run_id !== 'string' || !RUN_ID.test(record.run_id)) return false;
  if (!['prepared', 'promoting', 'promoted'].includes(record.phase)) return false;
  if (typeof record.had_previous !== 'boolean') return false;
  if (!HEX64.test(record.candidate_manifest_sha256)) return false;
  if (record.had_previous) {
    if (!HEX64.test(record.previous_manifest_sha256)) return false;
  } else if (record.previous_manifest_sha256 !== null) {
    return false;
  }
  return true;
}

function recoverPrepared(state) {
  const {
    hadPrevious,
    distExists,
    distIsCandidate,
    distIsPrevious,
    stageExists,
    stageIsCandidate,
    backupExists,
    backupIsPrevious,
    rename,
    remove,
    stage,
    backup,
    outputDir,
  } = state;

  if (hadPrevious) {
    if (distIsPrevious && !backupExists && !stageExists) return success();
    if (distIsPrevious && !backupExists && stageIsCandidate) {
      return removePath(remove, stage) ? success() : failure('候选清理失败');
    }
    if (!distExists && !stageExists && backupIsPrevious) {
      return renamePath(rename, backup, outputDir) ? success() : failure('旧快照恢复失败');
    }
    if (!distExists && stageIsCandidate && backupIsPrevious) {
      if (!renamePath(rename, backup, outputDir)) return failure('旧快照恢复失败');
      return removePath(remove, stage) ? success() : failure('候选清理失败');
    }
    if (distIsCandidate && !stageExists && backupIsPrevious) {
      if (!renamePath(rename, outputDir, stage)) return failure('候选回退失败');
      if (!renamePath(rename, backup, outputDir)) return failure('旧快照恢复失败');
      return removePath(remove, stage) ? success() : failure('候选清理失败');
    }
    return failure('事务状态与旧输出不匹配');
  }

  if (backupExists) return failure('无旧输出的事务出现 backup');
  if (!distExists && !stageExists) return success();
  if (!distExists && stageIsCandidate) {
    return removePath(remove, stage) ? success() : failure('候选清理失败');
  }
  if (distIsCandidate && !stageExists) {
    return removePath(remove, outputDir) ? success() : failure('候选清理失败');
  }
  return failure('事务状态与候选不匹配');
}

function recoverPromoted(state) {
  const {
    backupExists,
    backupIsPrevious,
    distExists,
    distIsCandidate,
    stageExists,
    rename,
    remove,
    backup,
    outputDir,
  } = state;

  if (distIsCandidate && !stageExists) {
    if (backupExists && !backupIsPrevious) return failure('backup 与旧快照不匹配');
    if (backupExists && !removePath(remove, backup)) return failure('backup 清理失败');
    return success();
  }
  if (!distExists && backupIsPrevious) {
    renamePath(rename, backup, outputDir);
    return failure('已恢复旧快照，仍需人工核对事务记录');
  }
  return failure('已提交事务的输出不可验证');
}

function recoverBuildTransaction({
  parent,
  outputName,
  rename = fs.renameSync,
  remove = fs.rmSync,
}) {
  const transactionPath = path.join(parent, '.dist.transaction.json');
  if (!fs.existsSync(transactionPath)) return success(false);
  let record;
  try {
    const stats = fs.lstatSync(transactionPath);
    if (!stats.isFile() || stats.isSymbolicLink()) return failure('事务记录不是普通文件');
    record = JSON.parse(fs.readFileSync(transactionPath, 'utf8'));
  } catch {
    return failure('事务记录不可读或不是合法 JSON');
  }
  if (!validTransaction(record, outputName)) return failure('事务记录字段或路径归属不合法');

  const runId = record.run_id;
  const stage = path.join(parent, `.dist.stage-${runId}`);
  const backup = path.join(parent, `.dist.backup-${runId}`);
  const outputDir = path.join(parent, outputName);
  if (!isDirectory(outputDir) && fs.existsSync(outputDir)) return failure('输出路径不是普通目录');
  if (!isDirectory(stage) && fs.existsSync(stage)) return failure('stage 路径不是普通目录');
  if (!isDirectory(backup) && fs.existsSync(backup)) return failure('backup 路径不是普通目录');

  const candidate = record.candidate_manifest_sha256;
  const previous = record.previous_manifest_sha256;
  const distHash = isDirectory(outputDir) ? manifestHash(outputDir) : null;
  const stageHash = isDirectory(stage) ? manifestHash(stage) : null;
  const backupHash = isDirectory(backup) ? manifestHash(backup) : null;
  const distMatches = isDirectory(outputDir) && directoryMatchesManifest(outputDir);
  const stageMatches = isDirectory(stage) && directoryMatchesManifest(stage);
  const backupMatches = isDirectory(backup) && directoryMatchesManifest(backup);
  if (stageHash !== null && (stageHash !== candidate || !stageMatches)) {
    return failure('stage 摘要或产物不匹配');
  }
  if (backupHash !== null && (backupHash !== previous || !backupMatches)) {
    return failure('backup 摘要或产物不匹配');
  }
  if (distHash !== null && (!distMatches || (distHash !== candidate && distHash !== previous))) {
    return failure('dist 摘要或产物不属于本事务');
  }
  if (record.had_previous && backupHash === null && distHash !== previous) {
    return failure('旧快照缺失且 backup 不可验证');
  }

  const state = {
    hadPrevious: record.had_previous,
    distExists: isDirectory(outputDir),
    distIsCandidate: distHash === candidate && distMatches,
    distIsPrevious: previous !== null && distHash === previous && distMatches,
    stageExists: isDirectory(stage),
    stageIsCandidate: stageHash === candidate && stageMatches,
    backupExists: isDirectory(backup),
    backupIsPrevious: previous !== null && backupHash === previous && backupMatches,
    rename,
    remove,
    stage,
    backup,
    outputDir,
  };

  const result = record.phase === 'promoted' ? recoverPromoted(state) : recoverPrepared(state);
  if (!result.ok) return result;
  if (!deleteTransaction(remove, transactionPath)) return failure('事务记录清理失败');
  return result;
}

module.exports = { recoverBuildTransaction };
