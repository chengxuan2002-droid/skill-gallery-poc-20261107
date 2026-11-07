(function () {
  const FIELD_WEIGHTS = {
    display_name: 4,
    description: 2,
    tags: 2,
    usage: 2,
    platforms: 1,
    author: 1,
    source_type: 1,
    notes: 1,
    content_text: 1,
  };
  const SEARCH_FIELDS = Object.keys(FIELD_WEIGHTS);
  const FILTER_FIELDS = [
    ['tags', 'tags'],
    ['platforms', 'platforms'],
    ['sourceTypes', 'source_type'],
    ['authors', 'author'],
  ];
  const CONDITION_GROUPS = [
    ['标签', 'tags'],
    ['平台', 'platforms'],
    ['来源', 'sourceTypes'],
    ['作者', 'authors'],
  ];

  function normalizeText(value) {
    return String(value ?? '')
      .normalize('NFC')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function exactPhrase(value) {
    const text = String(value ?? '').trim();
    if (text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"') {
      return normalizeText(text.slice(1, -1));
    }
    return normalizeText(text);
  }

  function uniqueValues(values) {
    return [...new Set((values ?? []).filter((value) => typeof value === 'string' && value))];
  }

  function fieldText(skill, field) {
    const value = skill[field];
    if (Array.isArray(value)) return value.join(' ');
    return value === null || value === undefined ? '' : String(value);
  }

  function exactScore(skill, phrase) {
    if (!phrase) return 0;
    let score = 0;
    for (const field of SEARCH_FIELDS) {
      if (normalizeText(fieldText(skill, field)).includes(phrase)) {
        score += FIELD_WEIGHTS[field];
      }
    }
    return score;
  }

  function createSearchEngine(skills, MiniSearchCtor) {
    if (typeof MiniSearchCtor !== 'function') return null;
    const mini = new MiniSearchCtor({
      fields: SEARCH_FIELDS,
      idField: 'slug',
      storeFields: ['slug'],
    });
    mini.addAll(skills);
    return mini;
  }

  function fuzzyScores(engine, query) {
    if (!engine || !query) return new Map();
    const results = engine.search(query, {
      prefix: true,
      fuzzy: 0.2,
      boost: FIELD_WEIGHTS,
      combineWith: 'OR',
    });
    return new Map(results.map((result) => [result.id, result.score]));
  }

  function matchesFilters(skill, filters) {
    for (const [key, field] of FILTER_FIELDS) {
      const selected = uniqueValues(filters[key]);
      if (selected.length === 0) continue;
      const value = skill[field];
      if (value === null || value === undefined) return false;
      if (Array.isArray(value)) {
        if (!value.some((item) => selected.includes(item))) return false;
      } else if (!selected.includes(value)) {
        return false;
      }
    }
    return true;
  }

  function filterOptions(skills) {
    const maps = {
      tags: new Map(),
      platforms: new Map(),
      sourceTypes: new Map(),
      authors: new Map(),
    };
    for (const skill of skills) {
      for (const [key, field] of FILTER_FIELDS) {
        const value = skill[field];
        const values = Array.isArray(value)
          ? value
          : value === null || value === undefined
            ? []
            : [value];
        const seen = new Set();
        for (const item of values) {
          if (typeof item !== 'string' || !item || seen.has(item)) continue;
          seen.add(item);
          maps[key].set(item, (maps[key].get(item) ?? 0) + 1);
        }
      }
    }
    const result = {};
    for (const [key, map] of Object.entries(maps)) {
      result[key] = [...map.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((left, right) => left.value.localeCompare(right.value, 'zh-CN'));
    }
    return result;
  }

  function compareUpdated(left, right) {
    const leftDate = typeof left.updated_at === 'string' ? left.updated_at : '';
    const rightDate = typeof right.updated_at === 'string' ? right.updated_at : '';
    if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
    return left.slug.localeCompare(right.slug);
  }

  function compareName(left, right) {
    const leftName = String(left.display_name || left.slug);
    const rightName = String(right.display_name || right.slug);
    const compared = leftName.localeCompare(rightName, 'zh-CN');
    return compared !== 0 ? compared : left.slug.localeCompare(right.slug);
  }

  function compareRelevance(left, right) {
    if (left.score !== right.score) return right.score - left.score;
    return left.skill.slug.localeCompare(right.skill.slug);
  }

  function searchSkills({
    skills = [],
    engine = null,
    query = '',
    mode = 'fuzzy',
    sort = 'auto',
    tags = [],
    platforms = [],
    sourceTypes = [],
    authors = [],
  } = {}) {
    const normalizedQuery = normalizeText(query);
    const exact = mode === 'exact';
    const phrase = exactPhrase(query);
    const fuzzy = exact || !normalizedQuery ? new Map() : fuzzyScores(engine, query);
    const filters = { tags, platforms, sourceTypes, authors };
    const results = [];

    for (const skill of skills) {
      if (!matchesFilters(skill, filters)) continue;
      let score = 0;
      if (normalizedQuery) {
        if (exact) {
          score = exactScore(skill, phrase);
          if (score === 0) continue;
        } else {
          score = (fuzzy.get(skill.slug) ?? 0) + exactScore(skill, normalizedQuery);
          if (score === 0) continue;
        }
      }
      results.push({ skill, score });
    }

    const effectiveSort =
      sort === 'name' || sort === 'updated' ? sort : normalizedQuery ? 'relevance' : 'updated';
    results.sort(
      effectiveSort === 'name'
        ? (left, right) => compareName(left.skill, right.skill)
        : effectiveSort === 'updated'
          ? (left, right) => compareUpdated(left.skill, right.skill)
          : compareRelevance,
    );
    return results;
  }

  function parseListHash(hash) {
    const text = typeof hash === 'string' ? hash : '';
    const queryIndex = text.indexOf('?');
    const params = new URLSearchParams(queryIndex === -1 ? '' : text.slice(queryIndex + 1));
    const mode = params.get('mode') === 'exact' ? 'exact' : 'fuzzy';
    const sort = ['name', 'updated'].includes(params.get('sort')) ? params.get('sort') : 'auto';
    return {
      query: params.get('q') ?? '',
      mode,
      tags: uniqueValues(params.getAll('tag')),
      platforms: uniqueValues(params.getAll('platform')),
      sourceTypes: uniqueValues(params.getAll('source')),
      authors: uniqueValues(params.getAll('author')),
      sort,
    };
  }

  function describeListConditions(state = {}) {
    const conditions = [];
    const query = typeof state.query === 'string' ? state.query.trim() : '';
    if (query) {
      conditions.push({ kind: 'query', label: `查询：${query}`, key: 'query', value: '' });
    }
    if (state.mode === 'exact') {
      conditions.push({ kind: 'mode', label: '精准模式', key: 'mode', value: 'fuzzy' });
    }
    for (const [title, key] of CONDITION_GROUPS) {
      for (const value of uniqueValues(state[key])) {
        conditions.push({ kind: 'filter', label: `${title}：${value}`, key, value });
      }
    }
    if (state.sort === 'name' || state.sort === 'updated') {
      conditions.push({
        kind: 'sort',
        label: `排序：${state.sort === 'name' ? '名称' : '更新时间'}`,
        key: 'sort',
        value: 'auto',
      });
    }
    return conditions;
  }

  function buildListHash(state = {}) {
    const params = new URLSearchParams();
    const query = typeof state.query === 'string' ? state.query.trim() : '';
    if (query) params.set('q', query);
    if (state.mode === 'exact') params.set('mode', 'exact');
    for (const value of uniqueValues(state.tags)) params.append('tag', value);
    for (const value of uniqueValues(state.platforms)) params.append('platform', value);
    for (const value of uniqueValues(state.sourceTypes)) params.append('source', value);
    for (const value of uniqueValues(state.authors)) params.append('author', value);
    if (state.sort === 'name' || state.sort === 'updated') params.set('sort', state.sort);
    const queryString = params.toString();
    return queryString ? `#/?${queryString}` : '#/';
  }

  function siteBase(baseUrl) {
    try {
      return new URL('.', baseUrl).href;
    } catch {
      const text = String(baseUrl ?? '');
      return text.endsWith('/') ? text : `${text}/`;
    }
  }

  function buildDetailShareUrl(baseUrl, slug) {
    return `${siteBase(baseUrl)}#/skill/${encodeURIComponent(slug)}`;
  }

  function buildListShareUrl(baseUrl, state) {
    return `${siteBase(baseUrl)}${buildListHash(state)}`;
  }

  function contentIdentity(detail) {
    const digest = detail && typeof detail.digest === 'string' ? detail.digest : '';
    return digest ? digest.slice(0, 12) : null;
  }

  globalThis.SkillGallerySearch = {
    buildDetailShareUrl,
    buildFilterOptions: filterOptions,
    buildListHash,
    buildListShareUrl,
    contentIdentity,
    createSearchEngine,
    describeListConditions,
    normalizeText,
    parseListHash,
    searchSkills,
  };
})();
