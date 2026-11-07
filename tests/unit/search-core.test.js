const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const MiniSearch = require('minisearch');

const root = path.resolve(__dirname, '../..');
const searchSource = fs.readFileSync(path.join(root, 'assets/app-search.js'), 'utf8');
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, 'tests/fixtures/search/fixed-skills.json'), 'utf8'),
);

function loadSearch() {
  const context = { URL, URLSearchParams, MiniSearch };
  context.globalThis = context;
  vm.runInNewContext(searchSource, context, { filename: 'assets/app-search.js' });
  assert.equal(typeof context.SkillGallerySearch, 'object');
  return context.SkillGallerySearch;
}

function slugs(results) {
  return Array.from(results, (result) => result.skill.slug);
}

function plainState(state) {
  return {
    query: state.query,
    mode: state.mode,
    tags: Array.from(state.tags),
    platforms: Array.from(state.platforms),
    sourceTypes: Array.from(state.sourceTypes),
    authors: Array.from(state.authors),
    sort: state.sort,
  };
}

function search(api, query, mode, options = {}) {
  const engine = api.createSearchEngine(fixture.skills, MiniSearch);
  return api.searchSkills({
    skills: fixture.skills,
    engine,
    query,
    mode,
    ...options,
  });
}

test('normalizes text with NFC, lower case and collapsed whitespace', () => {
  const api = loadSearch();
  assert.equal(api.normalizeText('  Debugging\n\tWorkflow  '), 'debugging workflow');
  assert.equal(api.normalizeText('e\u0301'), 'é');
});

test('exact mode matches normalized substrings, quoted phrases and does not correct typos', () => {
  const api = loadSearch();
  assert.deepEqual(slugs(search(api, 'debug', 'exact')), ['systematic-debugging']);
  assert.deepEqual(slugs(search(api, '"文档转换"', 'exact')), ['document-converter']);
  assert.deepEqual(slugs(search(api, 'debuging', 'exact')), []);
});

test('fuzzy mode tolerates English typos and Chinese substrings', () => {
  const api = loadSearch();
  assert.ok(slugs(search(api, 'debuging', 'fuzzy')).includes('systematic-debugging'));
  assert.deepEqual(slugs(search(api, '文档转换', 'fuzzy')), ['document-converter']);
});

test('filters use OR inside a dimension and AND across dimensions', () => {
  const api = loadSearch();
  assert.deepEqual(slugs(search(api, '', 'fuzzy', { tags: ['debugging', 'handoff'] })), [
    'handoff-codex',
    'systematic-debugging',
  ]);
  assert.deepEqual(
    slugs(search(api, '', 'fuzzy', { platforms: ['codex'], authors: ['Example Author'] })),
    ['handoff-codex', 'systematic-debugging'],
  );
  assert.deepEqual(slugs(search(api, '', 'fuzzy', { sourceTypes: ['github'] })), [
    'document-converter',
  ]);
  assert.deepEqual(
    slugs(search(api, '', 'fuzzy', { authors: ['Example Author'], sourceTypes: ['github'] })),
    [],
  );
});

test('sorts by relevance, updated time and stable slug tie-break', () => {
  const api = loadSearch();
  assert.deepEqual(slugs(search(api, '', 'fuzzy', { sort: 'updated' })), [
    'long-code-sample',
    'document-converter',
    'handoff-codex',
    'systematic-debugging',
    'code-review-assistant',
    'tie-alpha',
    'tie-beta',
    'missing-metadata',
  ]);
  assert.deepEqual(slugs(search(api, 'same score sample', 'exact')), ['tie-alpha', 'tie-beta']);
});

test('builds filter options from actual values only', () => {
  const api = loadSearch();
  const options = api.buildFilterOptions(fixture.skills);
  assert.deepEqual(
    Array.from(options.sourceTypes, (item) => item.value),
    ['github', 'self-built'],
  );
  assert.equal(options.authors.find((item) => item.value === 'Example Author').count, 3);
  assert.equal(
    options.tags.some((item) => item.value === 'debugging'),
    true,
  );
});

test('parses and builds list hashes with defaults, arrays and safe fallbacks', () => {
  const api = loadSearch();
  assert.deepEqual(plainState(api.parseListHash('')), {
    query: '',
    mode: 'fuzzy',
    tags: [],
    platforms: [],
    sourceTypes: [],
    authors: [],
    sort: 'auto',
  });
  assert.deepEqual(plainState(api.parseListHash('#/')), plainState(api.parseListHash('')));
  const parsed = api.parseListHash(
    '#/?q=debug&mode=exact&tag=debugging&tag=workflow&platform=codex&source=self-built&author=Example+Author&sort=name',
  );
  assert.equal(parsed.query, 'debug');
  assert.equal(parsed.mode, 'exact');
  assert.deepEqual(Array.from(parsed.tags), ['debugging', 'workflow']);
  assert.deepEqual(Array.from(parsed.platforms), ['codex']);
  assert.deepEqual(Array.from(parsed.sourceTypes), ['self-built']);
  assert.deepEqual(Array.from(parsed.authors), ['Example Author']);
  assert.equal(parsed.sort, 'name');
  assert.equal(api.parseListHash('#/?mode=unknown&sort=unknown').mode, 'fuzzy');
  assert.equal(api.parseListHash('#/?mode=unknown&sort=unknown').sort, 'auto');
  assert.equal(api.buildListHash(api.parseListHash('#/')), '#/');
  assert.equal(
    api.buildListHash({
      query: '文档转换',
      mode: 'fuzzy',
      tags: ['文档工具'],
      platforms: [],
      sourceTypes: [],
      authors: [],
      sort: 'auto',
    }),
    '#/?q=%E6%96%87%E6%A1%A3%E8%BD%AC%E6%8D%A2&tag=%E6%96%87%E6%A1%A3%E5%B7%A5%E5%85%B7',
  );
});

test('builds canonical detail and list share URLs under the site prefix', () => {
  const api = loadSearch();
  assert.equal(
    api.buildDetailShareUrl('http://127.0.0.1:8000/skill-gallery/index.html', 'handoff-codex'),
    'http://127.0.0.1:8000/skill-gallery/#/skill/handoff-codex',
  );
  assert.equal(
    api.buildListShareUrl('http://127.0.0.1:8000/skill-gallery/', {
      query: 'debug',
      mode: 'exact',
      tags: ['debugging'],
      platforms: [],
      sourceTypes: [],
      authors: [],
      sort: 'name',
    }),
    'http://127.0.0.1:8000/skill-gallery/#/?q=debug&mode=exact&tag=debugging&sort=name',
  );
});

const REQUIRED_QUERY_IDS = [
  'exact-debug',
  'exact-chinese-phrase',
  'exact-multiword',
  'fuzzy-typo',
  'fuzzy-chinese-substring',
  'tag-or',
  'platform-or',
  'platform-and-author',
  'tag-and-author',
  'source-filter',
  'author-only',
  'updated-sort',
  'name-sort',
  'stable-tie',
  'empty-result',
  'missing-value-does-not-match',
  'unclosed-quote',
];

test('fixed query set covers US002-SC-01 and matches expected slugs', () => {
  assert.ok(
    fixture.queries.length >= 20,
    `expected at least 20 fixed queries, got ${fixture.queries.length}`,
  );
  const api = loadSearch();
  const engine = api.createSearchEngine(fixture.skills, MiniSearch);
  const ids = new Set(fixture.queries.map((query) => query.id));
  for (const id of REQUIRED_QUERY_IDS) assert.ok(ids.has(id), `missing required query: ${id}`);
  for (const query of fixture.queries) {
    assert.ok(['exact', 'fuzzy'].includes(query.mode), query.id);
    assert.ok(Array.isArray(query.expected), query.id);
    assert.equal(new Set(query.expected).size, query.expected.length, query.id);
    const results = api.searchSkills({
      skills: fixture.skills,
      engine,
      query: query.query,
      mode: query.mode,
      tags: query.tags,
      platforms: query.platforms,
      sourceTypes: query.sourceTypes,
      authors: query.authors,
      sort: query.sort,
    });
    assert.deepEqual(slugs(results), query.expected, query.id);
  }
});

test('describes active list conditions with single-clear targets', () => {
  const api = loadSearch();
  assert.deepEqual(Array.from(api.describeListConditions({})), []);
  assert.deepEqual(
    Array.from(
      api.describeListConditions({
        query: ' debug ',
        mode: 'exact',
        tags: ['workflow', 'debugging', 'workflow'],
        platforms: ['codex'],
        sourceTypes: ['github'],
        authors: ['Example Author'],
        sort: 'name',
      }),
      (condition) => ({ ...condition }),
    ),
    [
      { kind: 'query', label: '查询：debug', key: 'query', value: '' },
      { kind: 'mode', label: '精准模式', key: 'mode', value: 'fuzzy' },
      { kind: 'filter', label: '标签：workflow', key: 'tags', value: 'workflow' },
      { kind: 'filter', label: '标签：debugging', key: 'tags', value: 'debugging' },
      { kind: 'filter', label: '平台：codex', key: 'platforms', value: 'codex' },
      { kind: 'filter', label: '来源：github', key: 'sourceTypes', value: 'github' },
      { kind: 'filter', label: '作者：Example Author', key: 'authors', value: 'Example Author' },
      { kind: 'sort', label: '排序：名称', key: 'sort', value: 'auto' },
    ],
  );
  assert.deepEqual(
    Array.from(api.describeListConditions({ sort: 'updated' }), (condition) => ({ ...condition })),
    [{ kind: 'sort', label: '排序：更新时间', key: 'sort', value: 'auto' }],
  );
});
