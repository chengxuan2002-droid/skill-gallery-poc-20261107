const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { createDiagnostic } = require('./diagnostics');

function diagnostic(code, message) {
  return createDiagnostic(code, { message });
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function acquireBuildLock({ parent, runId }) {
  const lockDir = path.join(parent, '.dist.lock');
  try {
    fs.mkdirSync(lockDir);
  } catch (error) {
    if (error.code === 'EEXIST') {
      return { ok: false, diagnostics: [diagnostic('E_BUSY', '已有构建在运行')] };
    }
    return { ok: false, diagnostics: [diagnostic('E_BUILD', '无法取得构建锁')] };
  }
  try {
    fs.writeFileSync(
      path.join(lockDir, 'owner.json'),
      JSON.stringify({ schemaVersion: 1, run_id: runId, pid: process.pid }),
    );
    return { ok: true, lockDir };
  } catch {
    fs.rmSync(lockDir, { recursive: true, force: true });
    return {
      ok: false,
      diagnostics: [diagnostic('E_BUILD', '构建锁写入失败')],
    };
  }
}

function abortBuild({ lockDir, stage }) {
  if (stage) fs.rmSync(stage, { recursive: true, force: true });
  if (lockDir) fs.rmSync(lockDir, { recursive: true, force: true });
}

async function commitBuild({
  parent,
  outputName,
  stage,
  manifestBytes,
  previousManifestSha256,
  hadPrevious,
  runId,
  rename,
  writeTransaction: writeTransactionHook,
  remove = fs.rmSync,
}) {
  const outputDir = path.join(parent, outputName);
  const backupDir = path.join(parent, `.dist.backup-${runId}`);
  const transactionPath = path.join(parent, '.dist.transaction.json');
  const transaction = (phase) => ({
    schemaVersion: 1,
    run_id: runId,
    output_name: outputName,
    phase,
    had_previous: hadPrevious,
    previous_manifest_sha256: previousManifestSha256,
    candidate_manifest_sha256: sha256(manifestBytes),
  });
  const writeTransaction = (phase) => {
    const value = transaction(phase);
    if (writeTransactionHook) {
      writeTransactionHook({ phase, path: transactionPath, transaction: value });
      return;
    }
    fs.writeFileSync(transactionPath, JSON.stringify(value));
  };

  let movedOld = false;
  let movedNew = false;
  try {
    writeTransaction('prepared');
    writeTransaction('promoting');
    if (hadPrevious) {
      await rename(outputDir, backupDir);
      movedOld = true;
    }
    await rename(stage, outputDir);
    movedNew = true;
    writeTransaction('promoted');
  } catch {
    try {
      if (movedNew && fs.existsSync(outputDir)) {
        await rename(outputDir, stage);
        movedNew = false;
      }
      if (movedOld && fs.existsSync(backupDir)) await rename(backupDir, outputDir);
      abortBuild({ lockDir: path.join(parent, '.dist.lock'), stage });
      fs.rmSync(transactionPath, { force: true });
    } catch {
      return {
        ok: false,
        cleanupStatus: 'recovery_required',
        diagnostics: [diagnostic('E_RECOVERY_REQUIRED', '构建回滚失败，保留可恢复副本')],
      };
    }
    return { ok: false, diagnostics: [diagnostic('E_BUILD', '构建提交失败，已恢复旧输出')] };
  }

  try {
    if (movedOld) remove(backupDir, { recursive: true, force: true });
    remove(transactionPath, { force: true });
    remove(path.join(parent, '.dist.lock'), { recursive: true, force: true });
    return { ok: true, cleanupStatus: 'complete' };
  } catch {
    return { ok: true, cleanupStatus: 'pending' };
  }
}

module.exports = { abortBuild, acquireBuildLock, commitBuild };
