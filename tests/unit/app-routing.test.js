'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const searchSource = fs.readFileSync(path.join(root, 'assets/app-search.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'assets/app.js'), 'utf8');

const SKILLS = [
  { slug: 'alpha', display_name: 'Alpha', digest: 'a'.repeat(64) },
  { slug: 'beta', display_name: 'Beta', digest: 'b'.repeat(64) },
];

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function createAppContext() {
  const sessionStorage = createStorage();
  const detailCalls = [];
  const focusCalls = [];
  const appElement = { replaceChildren() {}, append() {} };
  const skillCount = { textContent: '' };
  const themeToggle = {
    textContent: '',
    title: '',
    addEventListener() {},
    setAttribute() {},
  };
  const views = {
    loadingView() {},
    errorView() {},
    notFound() {},
    renderList() {
      return {
        update() {},
        focusHeading() {
          focusCalls.push('list');
        },
      };
    },
  };
  const detailView = {
    renderDetail(app, detail, actions) {
      detailCalls.push({ app, detail, actions });
      return {
        focusTitle() {
          focusCalls.push('detail');
        },
      };
    },
  };
  const actions = {
    loadRaw() {},
    copyText() {},
    shareLink() {},
    downloadPrimary() {},
    downloadFile() {},
  };
  const document = {
    getElementById(id) {
      if (id === 'app') return appElement;
      if (id === 'skill-count') return skillCount;
      if (id === 'theme-toggle') return themeToggle;
      return null;
    },
    documentElement: { dataset: {} },
  };
  const window = {
    location: { hash: '' },
    history: { replaceState() {} },
    addEventListener() {},
    sessionStorage,
    SkillGalleryViews: views,
    SkillGalleryDetail: detailView,
    SkillGalleryActions: actions,
  };
  const context = {
    console,
    URL,
    URLSearchParams,
    encodeURIComponent,
    decodeURIComponent,
    document,
    window,
    sessionStorage,
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    navigator: {},
    fetch: () => new Promise(() => {}),
  };
  context.globalThis = context;
  vm.runInNewContext(searchSource, context, { filename: 'assets/app-search.js' });
  window.SkillGallerySearch = context.SkillGallerySearch;
  vm.runInNewContext(`${appSource}\nglobalThis.__app = { route, listHandlers, state };`, context, {
    filename: 'assets/app.js',
  });
  return { app: context.__app, context, detailCalls, focusCalls, sessionStorage, window };
}

function installFetch(context) {
  context.fetch = async (url) => {
    const match = /^details\/(.+)\.json$/.exec(url);
    if (!match) return { ok: false, json: async () => ({}) };
    const item = SKILLS.find((skill) => skill.slug === match[1]);
    if (!item) return { ok: false, json: async () => ({}) };
    return {
      ok: true,
      json: async () => ({
        schemaVersion: 1,
        contentRevision: 'rev-1',
        slug: item.slug,
        digest: item.digest,
        display_name: item.display_name,
      }),
    };
  };
}

function loadState(app) {
  const { state } = app;
  state.skills = SKILLS;
  state.revision = 'rev-1';
  state.query = 'debug';
  state.mode = 'exact';
  state.tags = ['workflow'];
  state.platforms = [];
  state.sourceTypes = [];
  state.authors = [];
  state.sort = 'name';
  return state;
}

test('keeps list return state only for card entries', async () => {
  const { app, context, detailCalls, sessionStorage, window } = createAppContext();
  installFetch(context);
  const state = loadState(app);

  window.location.hash = '#/';
  app.listHandlers().onOpenDetail('alpha');
  assert.equal(state.pendingDetailSlug, 'alpha');
  assert.equal(
    sessionStorage.getItem('skill-gallery-list-hash'),
    '#/?q=debug&mode=exact&tag=workflow&sort=name',
  );

  await app.route();
  assert.equal(detailCalls.at(-1).detail.slug, 'alpha');
  assert.equal(state.pendingDetailSlug, null);
  assert.equal(
    sessionStorage.getItem('skill-gallery-list-hash'),
    '#/?q=debug&mode=exact&tag=workflow&sort=name',
  );
});

test('clears stale list return state for direct or refreshed details', async () => {
  const { app, context, sessionStorage, window } = createAppContext();
  installFetch(context);
  const state = loadState(app);

  for (const slug of ['beta', 'alpha']) {
    sessionStorage.setItem('skill-gallery-list-hash', '#/?q=stale');
    state.pendingDetailSlug = null;
    window.location.hash = `#/skill/${slug}`;
    await app.route();
    assert.equal(sessionStorage.getItem('skill-gallery-list-hash'), null, slug);
    assert.equal(state.pendingDetailSlug, null, slug);
  }
});

test('moves focus to the list heading and detail title after routes', async () => {
  const { app, context, focusCalls, window } = createAppContext();
  installFetch(context);
  loadState(app);

  window.location.hash = '#/';
  await app.route();
  assert.ok(focusCalls.includes('list'));

  window.location.hash = '#/skill/alpha';
  app.state.pendingDetailSlug = null;
  await app.route();
  assert.ok(focusCalls.includes('detail'));
});
