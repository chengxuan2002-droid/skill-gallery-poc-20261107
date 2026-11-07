(function () {
  function error(code, message) {
    const value = new Error(message);
    value.code = code;
    return value;
  }

  function isCurrentResult(isCurrent) {
    return typeof isCurrent !== 'function' || isCurrent();
  }

  async function sha256Hex(bytes) {
    if (!globalThis.crypto || !globalThis.crypto.subtle) {
      throw error('digest_unavailable', '浏览器不支持内容摘要校验');
    }
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  async function fetchVerified(url, expectedSize, expectedSha, isCurrent) {
    if (typeof url !== 'string' || url.length === 0) {
      throw error('unavailable', '资源地址缺失');
    }
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw error('http', '资源不可用');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (Number.isInteger(expectedSize) && bytes.length !== expectedSize) {
      throw error('size_mismatch', '资源大小不一致');
    }
    const digest = await sha256Hex(bytes);
    if (expectedSha && digest !== expectedSha) {
      throw error('digest_mismatch', '资源摘要不一致');
    }
    if (!isCurrentResult(isCurrent)) return { stale: true };
    return { bytes, digest };
  }

  function mainFile(detail) {
    return (detail.files || []).find((file) => file.url === detail.raw_url) || null;
  }

  async function loadRaw(detail, isCurrent) {
    const file = mainFile(detail);
    if (!file) throw error('raw_unavailable', '原文文件缺失');
    const result = await fetchVerified(file.url, file.size, file.sha256, isCurrent);
    if (result.stale) return result;
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(result.bytes);
    } catch {
      throw error('raw_unavailable', '原文不是合法 UTF-8');
    }
    return { text, bytes: result.bytes };
  }

  async function copyText(text) {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      throw error('copy_failed', '浏览器不支持剪贴板写入');
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      throw error('copy_failed', '剪贴板写入被拒绝');
    }
  }

  function shareLink(slug) {
    const search = window.SkillGallerySearch;
    if (search) return search.buildDetailShareUrl(window.location.href, slug);
    const base = new URL('.', window.location.href).href;
    return `${base}#/skill/${encodeURIComponent(slug)}`;
  }

  function shareListLink(state) {
    const search = window.SkillGallerySearch;
    if (search) return search.buildListShareUrl(window.location.href, state);
    return window.location.href;
  }

  async function downloadBytes(bytes, name, isCurrent) {
    if (!isCurrentResult(isCurrent)) return { stale: true };
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = name || 'skill';
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    return { name: anchor.download };
  }

  async function downloadFile(file, isCurrent) {
    if (!file || !file.url || !file.download_name) {
      throw error('download_failed', '下载文件信息缺失');
    }
    const result = await fetchVerified(file.url, file.size, file.sha256, isCurrent);
    if (result.stale) return result;
    return downloadBytes(result.bytes, file.download_name, isCurrent);
  }

  async function downloadPrimary(detail, isCurrent) {
    if (!detail.download_url || !detail.download_name) {
      throw error('download_failed', '下载信息缺失');
    }
    const result = await fetchVerified(
      detail.download_url,
      detail.download_size,
      detail.download_sha256,
      isCurrent,
    );
    if (result.stale) return result;
    return downloadBytes(result.bytes, detail.download_name, isCurrent);
  }

  window.SkillGalleryActions = {
    copyText,
    downloadFile,
    downloadPrimary,
    loadRaw,
    mainFile,
    shareLink,
    shareListLink,
  };
})();
