'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const MiniSearch = require('minisearch');

const { createDocument } = require('../support/fake-dom');

const root = path.resolve(__dirname, '../..');
const domSource = fs.readFileSync(path.join(root, 'assets/app-dom.js'), 'utf8');
const searchSource = fs.readFileSync(path.join(root, 'assets/app-search.js'), 'utf8');
const filtersSource = fs.readFileSync(path.join(root, 'assets/app-filters.js'), 'utf8');
const viewsSource = fs.readFileSync(path.join(root, 'assets/app-views.js'), 'utf8');
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, 'tests/fixtures/search/fixed-skills.json'), 'utf8'),
);

const SHARE_URL = 'http://127.0.0.1:8000/skill-gallery/#/?q=debug';

function loadViews() {
  const document = createDocument();
  const context = {
    document,
    window: {
      location: { href: SHARE_URL, reload() {} },
      SkillGallerySearch: null,
    },
    MiniSearch,
    URL,
    URLSearchParams,
  };
  context.globalThis = context;
  vm.runInNewContext(domSource, context, { filename: 'assets/app-dom.js' });
  vm.runInNewContext(searchSource, context, { filename: 'assets/app-search.js' });
  context.window.SkillGallerySearch = context.SkillGallerySearch;
  vm.runInNewContext(filtersSource, context, { filename: 'assets/app-filters.js' });
  vm.runInNewContext(viewsSource, context, { filename: 'assets/app-views.js' });
  return { document, search: context.SkillGallerySearch, views: context.window.SkillGalleryViews };
}

function baseState(overrides = {}) {
  return {
    query: '',
    mode: 'fuzzy',
    tags: [],
    platforms: [],
    sourceTypes: [],
    authors: [],
    sort: 'auto',
    skills: fixture.skills,
    ...overrides,
  };
}

function findCopyButton(app) {
  return app.querySelectorAll('button').find((node) => node.textContent.includes('复制列表链接'));
}

function render(app, views, search, state, handlers) {
  const results = fixture.skills.map((skill) => ({ skill, score: 1 }));
  views.renderList(
    app,
    {
      state,
      results,
      filterOptions: search.buildFilterOptions(state.skills),
    },
    handlers,
  );
}

test('list copy failure exposes a manual copy value and success hides it', async () => {
  const { document, search, views } = loadViews();
  const state = baseState({ query: 'debug', mode: 'exact', tags: ['workflow'], sort: 'name' });
  const changes = [];
  const rejected = {
    onChange(patch) {
      changes.push(JSON.parse(JSON.stringify(patch)));
    },
    onOpenDetail() {},
    copyListLink() {
      return Promise.reject(new Error('denied'));
    },
    listShareUrl() {
      return SHARE_URL;
    },
  };

  const app = document.createElement('div');
  render(app, views, search, state, rejected);
  const copyButton = findCopyButton(app);
  assert.ok(copyButton);
  await copyButton.dispatch('click');

  const status = app.querySelector('.list-status');
  assert.equal(status.dataset.state, 'copy_failed');
  assert.match(status.textContent, /复制失败/);
  assert.doesNotMatch(status.textContent, /已复制/);
  const manual = app.querySelector('#list-manual-copy');
  assert.ok(manual);
  assert.equal(manual.parentNode.hidden, false);
  assert.equal(manual.value, SHARE_URL);

  const accepted = {
    ...rejected,
    copyListLink() {
      return Promise.resolve();
    },
  };
  const successApp = document.createElement('div');
  render(successApp, views, search, state, accepted);
  const successButton = findCopyButton(successApp);
  await successButton.dispatch('click');
  const successStatus = successApp.querySelector('.list-status');
  assert.equal(successStatus.dataset.state, 'ready');
  assert.equal(successStatus.textContent, '列表链接已复制');
  assert.equal(successApp.querySelector('#list-manual-copy').parentNode.hidden, true);
  assert.deepEqual(changes, []);
});

test('renders active conditions and clears each one with a single action', async () => {
  const { document, search, views } = loadViews();
  const state = baseState({
    query: 'debug',
    mode: 'exact',
    tags: ['workflow'],
    sort: 'name',
  });
  const changes = [];
  const handlers = {
    onChange(patch) {
      changes.push(JSON.parse(JSON.stringify(patch)));
    },
    onOpenDetail() {},
    copyListLink() {
      return Promise.resolve();
    },
    listShareUrl() {
      return SHARE_URL;
    },
  };
  const app = document.createElement('div');
  render(app, views, search, state, handlers);

  const labels = app.querySelectorAll('.condition-chip').map((chip) => chip.textContent);
  for (const label of ['查询：debug', '精准模式', '标签：workflow', '排序：名称']) {
    assert.ok(
      labels.some((text) => text.includes(label)),
      `${label} not found in ${labels.join(', ')}`,
    );
  }

  async function remove(label) {
    const chip = app
      .querySelectorAll('.condition-chip')
      .find((node) => node.textContent.includes(label));
    assert.ok(chip, label);
    const button = chip.querySelector('.chip-remove');
    assert.ok(button, label);
    await button.dispatch('click');
  }

  await remove('查询：debug');
  await remove('精准模式');
  await remove('标签：workflow');
  await remove('排序：名称');

  assert.deepEqual(changes, [{ query: '' }, { mode: 'fuzzy' }, { tags: [] }, { sort: 'auto' }]);
});

test('toggles the mobile filter panel with aria state', async () => {
  const { document, search, views } = loadViews();
  const state = baseState();
  const handlers = {
    onChange() {},
    onOpenDetail() {},
    copyListLink() {
      return Promise.resolve();
    },
    listShareUrl() {
      return SHARE_URL;
    },
  };
  const app = document.createElement('div');
  const controller = views.renderList(
    app,
    {
      state,
      results: fixture.skills.map((skill) => ({ skill, score: 1 })),
      filterOptions: search.buildFilterOptions(state.skills),
    },
    handlers,
  );

  const toggle = app.querySelector('.filter-toggle');
  const filters = app.querySelector('.filters');
  const panel = app.querySelector('#filter-panel');
  assert.ok(toggle && filters && panel);
  assert.equal(toggle.getAttribute('aria-controls'), 'filter-panel');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(panel.id, 'filter-panel');

  await toggle.dispatch('click');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(toggle.textContent, '收起筛选');
  assert.equal(filters.className.includes('is-open'), true);

  await toggle.dispatch('click');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.textContent, '筛选');
  assert.equal(filters.className.includes('is-open'), false);
  assert.equal(typeof controller.focusHeading, 'function');
});
