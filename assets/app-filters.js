(function () {
  const { element } = window.SkillGalleryDom;

  function filterGroup(title, key, options, getSelected, onChange) {
    if (!options.length) return null;
    const group = element('fieldset', 'filter-group');
    group.append(element('legend', 'field-label', title));
    for (const option of options) {
      const label = element('label', 'filter-option');
      const checkbox = element('input');
      checkbox.type = 'checkbox';
      checkbox.value = option.value;
      checkbox.checked = getSelected().includes(option.value);
      checkbox.addEventListener('change', () => {
        const selected = getSelected();
        const next = checkbox.checked
          ? [...selected, option.value]
          : selected.filter((value) => value !== option.value);
        onChange({ [key]: [...new Set(next)] });
      });
      label.append(checkbox, element('span', null, `${option.value} (${option.count})`));
      group.append(label);
    }
    return group;
  }

  function createFilters({ state, filterOptions, onChange }) {
    let currentState = state;
    const root = element('aside', 'filters');

    const searchLabel = element('label', 'field-label', '搜索 Skill');
    searchLabel.htmlFor = 'skill-search';
    const searchBar = element('div', 'search-bar');
    const input = element('input', 'search-input');
    input.type = 'search';
    input.id = 'skill-search';
    input.placeholder = '搜索名称、简介、标签或正文';
    input.value = state.query;
    input.addEventListener('input', () => onChange({ query: input.value }));
    searchBar.append(input);
    root.append(searchLabel, searchBar);

    const filterToggle = element('button', 'filter-toggle', '筛选');
    filterToggle.type = 'button';
    filterToggle.setAttribute('aria-expanded', 'false');
    filterToggle.setAttribute('aria-controls', 'filter-panel');
    filterToggle.addEventListener('click', () => {
      const open = root.classList.toggle('is-open');
      filterToggle.setAttribute('aria-expanded', String(open));
      filterToggle.textContent = open ? '收起筛选' : '筛选';
    });
    root.append(filterToggle);

    const filterPanel = element('div', 'filter-panel');
    filterPanel.id = 'filter-panel';

    const modeLabel = element('div', 'field-label', '搜索模式');
    const modeGroup = element('div', 'mode-toggle');
    modeGroup.setAttribute('role', 'group');
    modeGroup.setAttribute('aria-label', '搜索模式');
    const fuzzyButton = element('button', 'mode-button', '模糊');
    const exactButton = element('button', 'mode-button', '精准');
    fuzzyButton.type = 'button';
    exactButton.type = 'button';
    fuzzyButton.addEventListener('click', () => onChange({ mode: 'fuzzy' }));
    exactButton.addEventListener('click', () => onChange({ mode: 'exact' }));
    modeGroup.append(fuzzyButton, exactButton);
    filterPanel.append(modeLabel, modeGroup);

    const groups = [
      ['标签', 'tags', filterOptions.tags, 'tags'],
      ['平台', 'platforms', filterOptions.platforms, 'platforms'],
      ['来源', 'sourceTypes', filterOptions.sourceTypes, 'sourceTypes'],
      ['作者', 'authors', filterOptions.authors, 'authors'],
    ];
    const checkboxes = new Map();
    for (const [title, key, options, stateKey] of groups) {
      const group = filterGroup(title, key, options, () => currentState[stateKey], onChange);
      if (group) {
        for (const checkbox of group.querySelectorAll('input')) {
          checkboxes.set(`${key}:${checkbox.value}`, checkbox);
        }
        filterPanel.append(group);
      }
    }

    const sortLabel = element('label', 'field-label', '排序');
    sortLabel.htmlFor = 'skill-sort';
    const sortSelect = element('select', 'sort-select');
    sortSelect.id = 'skill-sort';
    for (const [value, text] of [
      ['auto', '自动'],
      ['name', '名称'],
      ['updated', '更新时间'],
    ]) {
      const option = element('option', null, text);
      option.value = value;
      sortSelect.append(option);
    }
    sortSelect.value = state.sort;
    sortSelect.addEventListener('change', () => onChange({ sort: sortSelect.value }));
    filterPanel.append(sortLabel, sortSelect);
    root.append(filterPanel);

    function focusConditionTarget(condition) {
      if (condition.kind === 'query') {
        input.focus();
        return;
      }
      if (condition.kind === 'mode') {
        (condition.value === 'fuzzy' ? fuzzyButton : exactButton).focus();
        return;
      }
      if (condition.kind === 'sort') {
        sortSelect.focus();
        return;
      }
      const checkbox = checkboxes.get(`${condition.key}:${condition.value}`);
      if (checkbox && checkbox.offsetParent !== null) checkbox.focus();
      else input.focus();
    }

    function update(nextState) {
      currentState = nextState;
      if (input.value !== nextState.query) input.value = nextState.query;
      fuzzyButton.setAttribute('aria-pressed', String(nextState.mode === 'fuzzy'));
      exactButton.setAttribute('aria-pressed', String(nextState.mode === 'exact'));
      fuzzyButton.classList.toggle('is-active', nextState.mode === 'fuzzy');
      exactButton.classList.toggle('is-active', nextState.mode === 'exact');
      sortSelect.value = nextState.sort;
      for (const [key, checkbox] of checkboxes) {
        const selected = nextState[key.split(':')[0]];
        checkbox.checked = selected.includes(checkbox.value);
      }
    }

    return { node: root, focusConditionTarget, update };
  }

  window.SkillGalleryFilters = { createFilters };
})();
