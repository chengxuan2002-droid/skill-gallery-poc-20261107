'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const searchSource = fs.readFileSync(path.join(root, 'assets/app-search.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'assets/app.js'), 'utf8');

function createToggle() {
  const listeners = new Map();
  return {
    textContent: '',
    title: '',
    attributes: {},
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    click() {
      listeners.get('click')();
    },
  };
}

function createThemeContext({ saved = null, prefersDark = false } = {}) {
  let stored = saved;
  const toggle = createToggle();
  const mediaListeners = [];
  const media = {
    matches: prefersDark,
    addEventListener(type, listener) {
      if (type === 'change') mediaListeners.push(listener);
    },
  };
  const appElement = { replaceChildren() {}, append() {} };
  const views = {
    loadingView() {},
    errorView() {},
    notFound() {},
    renderList() {
      return { update() {}, focusHeading() {} };
    },
  };
  const detailView = {
    renderDetail() {
      return { focusTitle() {} };
    },
  };
  const document = {
    getElementById(id) {
      if (id === 'app') return appElement;
      if (id === 'skill-count') return { textContent: '' };
      if (id === 'theme-toggle') return toggle;
      return null;
    },
    documentElement: { dataset: {} },
  };
  const window = {
    location: { hash: '' },
    history: { replaceState() {} },
    addEventListener() {},
    sessionStorage: {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {},
    },
    matchMedia() {
      return media;
    },
    SkillGalleryViews: views,
    SkillGalleryDetail: detailView,
    SkillGalleryActions: {
      loadRaw() {},
      copyText() {},
      shareLink() {},
      downloadPrimary() {},
      downloadFile() {},
    },
  };
  const localStorage = {
    getItem(key) {
      return key === 'skill-gallery-theme' ? stored : null;
    },
    setItem(key, value) {
      if (key === 'skill-gallery-theme') stored = String(value);
    },
  };
  const context = {
    console,
    URL,
    URLSearchParams,
    document,
    window,
    localStorage,
    navigator: {},
    fetch: () => new Promise(() => {}),
  };
  context.globalThis = context;
  vm.runInNewContext(searchSource, context, { filename: 'assets/app-search.js' });
  window.SkillGallerySearch = context.SkillGallerySearch;
  vm.runInNewContext(`${appSource}\nglobalThis.__app = { setupTheme, state };`, context, {
    filename: 'assets/app.js',
  });
  return { context, document, mediaListeners, stored: () => stored, toggle };
}

test('uses the saved theme before the system preference', () => {
  const dark = createThemeContext({ saved: 'dark', prefersDark: false });
  assert.equal(dark.document.documentElement.dataset.theme, 'dark');
  assert.equal(dark.toggle.attributes['aria-label'], '切换到浅色主题');

  const light = createThemeContext({ saved: 'light', prefersDark: true });
  assert.equal(light.document.documentElement.dataset.theme, 'light');
  assert.equal(light.toggle.attributes['aria-label'], '切换到深色主题');
});

test('falls back to prefers-color-scheme when no theme is saved', () => {
  const dark = createThemeContext({ prefersDark: true });
  assert.equal(dark.document.documentElement.dataset.theme, 'dark');

  const light = createThemeContext({ prefersDark: false });
  assert.equal(light.document.documentElement.dataset.theme, 'light');
});

test('persists a manual theme and does not follow later system changes', () => {
  const context = createThemeContext({ prefersDark: false });
  context.toggle.click();
  assert.equal(context.document.documentElement.dataset.theme, 'dark');
  assert.equal(context.stored(), 'dark');

  context.mediaListeners[0]({ matches: false });
  assert.equal(context.document.documentElement.dataset.theme, 'dark');
});

test('follows system changes while no theme is saved', () => {
  const context = createThemeContext({ prefersDark: false });
  assert.equal(context.document.documentElement.dataset.theme, 'light');

  context.mediaListeners[0]({ matches: true });
  assert.equal(context.document.documentElement.dataset.theme, 'dark');
  context.mediaListeners[0]({ matches: false });
  assert.equal(context.document.documentElement.dataset.theme, 'light');
});
