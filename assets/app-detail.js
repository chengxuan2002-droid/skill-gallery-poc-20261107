(function () {
  const { element, clear, safeText, safeHref } = window.SkillGalleryDom;
  const search = window.SkillGallerySearch;

  function bindBodyAnchors(root, files, onFileLink) {
    root.addEventListener('click', (event) => {
      const anchor = event.target.closest('a');
      if (!anchor || !root.contains(anchor)) return;
      const href = anchor.getAttribute('href') || '';
      if (href.startsWith('#')) {
        event.preventDefault();
        let id;
        try {
          id = decodeURIComponent(href.slice(1));
        } catch {
          return;
        }
        const target = Array.from(root.querySelectorAll('[id]')).find((node) => node.id === id);
        if (target) {
          const reduceMotion =
            window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          target.scrollIntoView({
            behavior: reduceMotion ? 'auto' : 'smooth',
            block: 'start',
          });
        }
        return;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/')) return;
      const file = (files || []).find((item) => item.url === href);
      if (!file) return;
      event.preventDefault();
      onFileLink(anchor, file);
    });
  }

  function metaRow(label, value) {
    const row = element('div', 'detail-meta-row');
    row.append(element('span', 'badge', `${label}：${safeText(value)}`));
    return row;
  }

  function linkRow(label, value) {
    const row = element('div', 'detail-meta-row');
    const href = safeHref(value);
    if (!href) {
      row.append(element('span', 'badge', `${label}：未提供`));
      return row;
    }
    row.append(element('span', 'badge', `${label}：`));
    const link = element('a', null, href);
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    row.append(link);
    return row;
  }

  function textSection(title, value) {
    const section = element('section', 'detail-section');
    section.append(element('h4', null, title));
    section.append(element('p', 'detail-text', safeText(value)));
    return section;
  }

  function errorMessage(error, fallback) {
    return error && error.code && typeof error.message === 'string' && error.message
      ? error.message
      : fallback;
  }

  function renderDetail(app, detail, actions) {
    clear(app);
    const view = element('div', 'detail-view');
    const back = element('button', 'detail-back', '← 返回列表');
    back.type = 'button';
    back.addEventListener('click', () => {
      const listHash = window.sessionStorage.getItem('skill-gallery-list-hash');
      window.location.hash = listHash && listHash.startsWith('#/') ? listHash : '';
    });
    view.append(back);

    const header = element('div', 'detail-header');
    const title = element('h1', 'detail-title', safeText(detail.display_name, detail.slug));
    title.tabIndex = -1;
    header.append(title);
    header.append(element('p', 'detail-desc', safeText(detail.description)));
    const badges = element('div', 'detail-meta-row');
    for (const platform of detail.platforms || []) {
      badges.append(element('span', 'badge badge-platform', platform));
    }
    for (const tag of detail.tags || []) badges.append(element('span', 'badge', `#${tag}`));
    if (badges.childNodes.length > 0) header.append(badges);

    if (detail.declared_version) {
      header.append(metaRow('声明版本', detail.declared_version));
    } else {
      const identity = search ? search.contentIdentity(detail) : null;
      header.append(metaRow('内容标识', identity || '未提供'));
    }
    header.append(metaRow('作者', detail.author));
    header.append(metaRow('来源', detail.source_type));
    header.append(metaRow('更新时间', detail.updated_at));
    view.append(header);

    const toolbar = element('div', 'detail-toolbar');
    const status = element('p', 'detail-status');
    status.hidden = true;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    const rawPanel = element('div', 'raw-panel');
    rawPanel.hidden = true;
    const rawText = element('textarea', 'raw-text');
    rawText.readOnly = true;
    rawText.spellcheck = false;
    rawText.setAttribute('aria-label', '完整原文');
    rawPanel.append(rawText);

    const manualPanel = element('div', 'manual-panel');
    manualPanel.hidden = true;
    const manualLabel = element('label', null, '复制失败，请手动选择：');
    manualLabel.htmlFor = 'manual-copy';
    const manualInput = element('input', 'manual-input');
    manualInput.id = 'manual-copy';
    manualInput.type = 'text';
    manualInput.readOnly = true;
    manualPanel.append(manualLabel, manualInput);

    let rawContent = null;
    function setStatus(message, state) {
      status.hidden = message === '';
      status.dataset.state = state;
      status.textContent = message;
    }
    function setBusy(button, busy) {
      button.disabled = busy;
      button.setAttribute('aria-busy', String(busy));
    }
    async function showRaw() {
      const result = await actions.loadRaw();
      if (!result || result.stale) return false;
      rawContent = result.text;
      rawText.value = result.text;
      rawPanel.hidden = false;
      return true;
    }
    async function downloadAttachment(link, file) {
      link.setAttribute('aria-busy', 'true');
      setStatus(`正在校验 ${file.path}…`, 'loading');
      try {
        const result = await actions.downloadFile(file);
        if (!result || result.stale) return;
        setStatus('资源已校验，下载已发起', 'ready');
      } catch (error) {
        setStatus(errorMessage(error, '下载失败，资源不可用'), 'download_failed');
      } finally {
        link.removeAttribute('aria-busy');
      }
    }

    const rawButton = element('button', 'btn', '查看原文');
    rawButton.type = 'button';
    rawButton.addEventListener('click', async () => {
      setBusy(rawButton, true);
      setStatus('正在校验原文…', 'loading');
      try {
        if (await showRaw()) setStatus('原文已校验；可从文本区选取完整内容', 'ready');
      } catch (error) {
        setStatus(errorMessage(error, '原文不可用'), 'raw_unavailable');
      } finally {
        setBusy(rawButton, false);
      }
    });

    const copyButton = element('button', 'btn', '复制原文');
    copyButton.type = 'button';
    copyButton.addEventListener('click', async () => {
      setBusy(copyButton, true);
      setStatus('正在校验并复制原文…', 'loading');
      try {
        if (rawContent === null && !(await showRaw())) return;
        await actions.copyText(rawContent);
        setStatus('原文已复制', 'ready');
      } catch (error) {
        if (error && error.code === 'copy_failed') {
          rawPanel.hidden = false;
          setStatus('复制失败，请手动选择下方原文', 'copy_failed');
          if (rawContent !== null) rawText.value = rawContent;
        } else {
          setStatus(errorMessage(error, '原文不可用'), 'raw_unavailable');
        }
      } finally {
        setBusy(copyButton, false);
      }
    });

    const shareButton = element('button', 'btn', '复制分享链接');
    shareButton.type = 'button';
    const shareLink = actions.shareLink();
    shareButton.addEventListener('click', async () => {
      setBusy(shareButton, true);
      setStatus('正在复制分享链接…', 'loading');
      try {
        await actions.copyText(shareLink);
        setStatus('分享链接已复制', 'ready');
        manualPanel.hidden = true;
      } catch {
        manualInput.value = shareLink;
        manualPanel.hidden = false;
        manualInput.focus();
        manualInput.select();
        setStatus('复制失败，请手动复制下方链接', 'copy_failed');
      } finally {
        setBusy(shareButton, false);
      }
    });

    toolbar.append(rawButton, copyButton);
    if (detail.download_url && detail.download_name) {
      const downloadButton = element('button', 'btn btn-primary', detail.download_name);
      downloadButton.type = 'button';
      downloadButton.addEventListener('click', async () => {
        setBusy(downloadButton, true);
        setStatus('正在校验下载资源…', 'loading');
        try {
          const result = await actions.downloadPrimary();
          if (!result || result.stale) return;
          setStatus('资源已校验，下载已发起', 'ready');
        } catch (error) {
          setStatus(errorMessage(error, '下载失败，资源不可用'), 'download_failed');
        } finally {
          setBusy(downloadButton, false);
        }
      });
      toolbar.append(downloadButton);
    }
    toolbar.append(shareButton);
    view.append(toolbar, status, manualPanel, rawPanel);

    const siteInfo = element('section', 'detail-section');
    siteInfo.append(element('h4', null, '站点说明'));
    siteInfo.append(textSection('功能简介', detail.description));
    siteInfo.append(textSection('适用场景与使用方法', detail.usage));
    siteInfo.append(textSection('备注', detail.notes));
    view.append(siteInfo);

    const bodySection = element('section', 'detail-section');
    bodySection.append(element('h4', null, '原文'));
    const body = element('div', 'markdown-body');
    body.innerHTML = typeof detail.body_html === 'string' ? detail.body_html : '';
    bindBodyAnchors(body, detail.files || [], downloadAttachment);
    bodySection.append(body);
    view.append(bodySection);

    if (Array.isArray(detail.files) && detail.files.length > 0) {
      const section = element('section', 'detail-section');
      section.append(element('h4', null, '附件'));
      const list = element('ul', 'file-list');
      for (const file of detail.files) {
        const href = safeHref(file.url);
        if (!href) continue;
        const itemNode = element('li');
        const link = element('a', null, `${file.path}（${file.size} 字节）`);
        link.href = href;
        link.download = file.download_name || '';
        link.addEventListener('click', (event) => {
          event.preventDefault();
          downloadAttachment(link, file);
        });
        itemNode.append(link);
        list.append(itemNode);
      }
      section.append(list);
      view.append(section);
    }

    const source = element('section', 'detail-section');
    source.append(element('h4', null, '来源与许可'));
    source.append(linkRow('官方主页', detail.homepage_url));
    source.append(linkRow('开源地址', detail.repository_url));
    source.append(metaRow('许可', detail.license));
    source.append(metaRow('创建时间', detail.created_at));
    view.append(source);

    app.append(view);
    document.title = `${safeText(detail.display_name, detail.slug)} · Skill Gallery`;
    return {
      focusTitle() {
        title.focus();
      },
    };
  }

  window.SkillGalleryDetail = { renderDetail };
})();
