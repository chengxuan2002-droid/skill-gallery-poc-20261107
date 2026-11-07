(function () {
  const search = window.SkillGallerySearch;
  const { clear, element, safeText } = window.SkillGalleryDom;
  const { createFilters } = window.SkillGalleryFilters;

  function loadingView(app) {
    clear(app);
    const node = element('div', 'loading', '加载中...');
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    app.append(node);
  }

  function errorView(app, message, retry, state = 'load_failed') {
    clear(app);
    const box = element('div', 'empty-state');
    box.dataset.state = state;
    const heading = element('h3', null, message);
    heading.tabIndex = -1;
    box.append(heading);
    if (retry) {
      const button = element('button', null, '重试');
      button.type = 'button';
      button.addEventListener('click', retry);
      box.append(button);
    }
    app.append(box);
    heading.focus();
  }

  function notFound(app) {
    errorView(
      app,
      '未找到该 Skill',
      () => {
        window.location.hash = '';
      },
      'not_found',
    );
  }

  function cardFor(skill, onOpenDetail) {
    const card = element('a', 'skill-card');
    card.href = `#/skill/${encodeURIComponent(skill.slug)}`;
    card.addEventListener('click', (event) => {
      event.preventDefault();
      onOpenDetail(skill.slug);
    });
    card.append(element('h3', 'skill-card-title', safeText(skill.display_name, skill.slug)));
    card.append(element('p', 'skill-card-desc', safeText(skill.description)));
    const meta = element('div', 'skill-card-meta');
    for (const platform of skill.platforms || []) {
      meta.append(element('span', 'badge badge-platform', platform));
    }
    for (const tag of skill.tags || []) meta.append(element('span', 'badge', `#${tag}`));
    card.append(meta);
    const footer = element('div', 'skill-card-footer');
    footer.append(element('span', null, safeText(skill.declared_version, '未声明版本')));
    footer.append(element('span', null, safeText(skill.updated_at, '未提供')));
    card.append(footer);
    return card;
  }

  function renderList(app, { state, results, filterOptions }, handlers) {
    clear(app);
    let currentState = state;

    const layout = element('div', 'list-layout');
    const filters = createFilters({
      state,
      filterOptions,
      onChange: handlers.onChange,
    });
    layout.append(filters.node);

    const content = element('div', 'list-content');
    const listTitle = element('h2', 'list-title', 'Skill 列表');
    listTitle.tabIndex = -1;
    const bar = element('div', 'sort-bar');
    const count = element('span', 'result-count');
    count.setAttribute('aria-live', 'polite');
    const conditions = element('div', 'active-conditions');
    const copyButton = element('button', 'btn btn-small', '复制列表链接');
    copyButton.type = 'button';
    bar.append(count, conditions, copyButton);
    content.append(listTitle, bar);

    const status = element('p', 'list-status');
    status.hidden = true;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    content.append(status);

    const manualPanel = element('div', 'manual-panel');
    manualPanel.hidden = true;
    const manualLabel = element('label', null, '复制失败，请手动复制：');
    manualLabel.htmlFor = 'list-manual-copy';
    const manualInput = element('input', 'manual-input');
    manualInput.id = 'list-manual-copy';
    manualInput.type = 'text';
    manualInput.readOnly = true;
    manualPanel.append(manualLabel, manualInput);
    content.append(manualPanel);

    const grid = element('div', 'skill-grid');
    content.append(grid);
    layout.append(content);
    app.append(layout);

    function setStatus(message, stateName) {
      status.hidden = message === '';
      status.dataset.state = stateName;
      status.textContent = message;
    }

    function conditionsFor(nextState) {
      const chips = [];
      for (const condition of search.describeListConditions(nextState)) {
        const chip = element('span', 'condition-chip');
        chip.append(element('span', null, condition.label));
        const remove = element('button', 'chip-remove', '×');
        remove.type = 'button';
        remove.setAttribute('aria-label', `移除条件 ${condition.label}`);
        remove.addEventListener('click', () => {
          if (condition.kind === 'filter') {
            handlers.onChange({
              [condition.key]: (currentState[condition.key] || []).filter(
                (value) => value !== condition.value,
              ),
            });
          } else {
            handlers.onChange({ [condition.key]: condition.value });
          }
          filters.focusConditionTarget(condition);
        });
        chip.append(remove);
        chips.push(chip);
      }
      return chips;
    }

    function renderResults(nextState, nextResults) {
      count.textContent = `${nextResults.length} 个结果`;
      clear(conditions);
      for (const chip of conditionsFor(nextState)) conditions.append(chip);
      const hasConditions =
        nextState.query ||
        nextState.mode !== 'fuzzy' ||
        nextState.sort !== 'auto' ||
        nextState.tags.length ||
        nextState.platforms.length ||
        nextState.sourceTypes.length ||
        nextState.authors.length;
      if (hasConditions) {
        const clearAll = element('button', 'btn btn-small', '清除全部');
        clearAll.type = 'button';
        clearAll.addEventListener('click', () => {
          handlers.onChange({
            query: '',
            mode: 'fuzzy',
            tags: [],
            platforms: [],
            sourceTypes: [],
            authors: [],
            sort: 'auto',
          });
        });
        conditions.append(clearAll);
      }
      clear(grid);
      if (nextState.skills.length === 0) {
        const empty = element('div', 'empty-state');
        empty.dataset.state = 'empty_library';
        empty.append(element('h3', null, '图库为空'));
        const retry = element('button', null, '重试');
        retry.type = 'button';
        retry.addEventListener('click', () => window.location.reload());
        empty.append(retry);
        grid.append(empty);
        return;
      }
      if (nextResults.length === 0) {
        const empty = element('div', 'empty-state');
        empty.dataset.state = 'empty_results';
        empty.append(element('h3', null, '没有匹配的 Skill'));
        const clearAll = element('button', null, '清除全部条件');
        clearAll.type = 'button';
        clearAll.addEventListener('click', () => {
          handlers.onChange({
            query: '',
            mode: 'fuzzy',
            tags: [],
            platforms: [],
            sourceTypes: [],
            authors: [],
            sort: 'auto',
          });
        });
        empty.append(clearAll);
        grid.append(empty);
        return;
      }
      for (const result of nextResults) grid.append(cardFor(result.skill, handlers.onOpenDetail));
    }

    function update(nextState, nextResults) {
      currentState = nextState;
      filters.update(nextState);
      manualPanel.hidden = true;
      renderResults(nextState, nextResults);
    }

    copyButton.addEventListener('click', async () => {
      copyButton.disabled = true;
      setStatus('正在复制列表链接...', 'loading');
      try {
        await handlers.copyListLink();
        manualPanel.hidden = true;
        setStatus('列表链接已复制', 'ready');
      } catch {
        manualInput.value =
          typeof handlers.listShareUrl === 'function'
            ? handlers.listShareUrl()
            : window.location.href;
        manualPanel.hidden = false;
        manualInput.focus();
        manualInput.select();
        setStatus('复制失败，请手动复制下方链接', 'copy_failed');
      } finally {
        copyButton.disabled = false;
      }
    });

    update(state, results);

    return {
      update,
      focusHeading() {
        listTitle.focus();
      },
    };
  }

  window.SkillGalleryViews = {
    errorView,
    loadingView,
    notFound,
    renderList,
  };
})();
