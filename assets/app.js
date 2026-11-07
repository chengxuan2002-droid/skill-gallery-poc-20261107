const app = document.getElementById('app');
const skillCount = document.getElementById('skill-count');
const views = window.SkillGalleryViews;
const detailView = window.SkillGalleryDetail;
const actions = window.SkillGalleryActions;
const search = window.SkillGallerySearch;
const state = {
  skills: [],
  query: '',
  mode: 'fuzzy',
  tags: [],
  platforms: [],
  sourceTypes: [],
  authors: [],
  sort: 'auto',
  engine: null,
  revision: null,
  routeToken: 0,
  listView: null,
  pendingDetailSlug: null,
};

function currentResults() {
  return search.searchSkills({
    skills: state.skills,
    engine: state.engine,
    query: state.query,
    mode: state.mode,
    sort: state.sort,
    tags: state.tags,
    platforms: state.platforms,
    sourceTypes: state.sourceTypes,
    authors: state.authors,
  });
}

function listHandlers() {
  return {
    onChange(patch) {
      Object.assign(state, patch);
      window.history.replaceState(null, '', search.buildListHash(state));
      state.listView.update(state, currentResults());
    },
    onOpenDetail(slug) {
      state.pendingDetailSlug = slug;
      window.sessionStorage.setItem('skill-gallery-list-hash', search.buildListHash(state));
      window.location.hash = `#/skill/${encodeURIComponent(slug)}`;
    },
    listShareUrl() {
      return actions.shareListLink(state);
    },
    copyListLink() {
      return actions.copyText(actions.shareListLink(state));
    },
  };
}

function createDetailActions(detail, token) {
  const isCurrent = () => token === state.routeToken;
  return {
    loadRaw: () => actions.loadRaw(detail, isCurrent),
    copyText: (text) => actions.copyText(text),
    shareLink: () => actions.shareLink(detail.slug),
    downloadPrimary: () => actions.downloadPrimary(detail, isCurrent),
    downloadFile: (file) => actions.downloadFile(file, isCurrent),
  };
}

async function loadDetail(item, token) {
  views.loadingView(app);
  try {
    const response = await fetch(`details/${encodeURIComponent(item.slug)}.json`, {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('detail');
    const detail = await response.json();
    if (token !== state.routeToken) return;
    if (
      !detail ||
      detail.schemaVersion !== 1 ||
      detail.contentRevision !== state.revision ||
      detail.slug !== item.slug ||
      detail.digest !== item.digest
    ) {
      views.errorView(
        app,
        '内容快照已更新，请刷新页面',
        () => window.location.reload(),
        'snapshot_mismatch',
      );
      return;
    }
    const detailHandle = detailView.renderDetail(app, detail, createDetailActions(detail, token));
    if (detailHandle && typeof detailHandle.focusTitle === 'function') {
      detailHandle.focusTitle();
    }
  } catch {
    if (token === state.routeToken) {
      views.errorView(app, '无法加载该 Skill，请重试', () => route(), 'load_failed');
    }
  }
}

function renderListRoute() {
  const parsed = search.parseListHash(window.location.hash);
  Object.assign(state, parsed);
  const results = currentResults();
  const filterOptions = search.buildFilterOptions(state.skills);
  state.listView = views.renderList(app, { state, results, filterOptions }, listHandlers());
  if (state.listView && typeof state.listView.focusHeading === 'function') {
    state.listView.focusHeading();
  }
}

async function route() {
  const token = ++state.routeToken;
  const pendingSlug = state.pendingDetailSlug;
  state.pendingDetailSlug = null;
  const match = window.location.hash.match(/^#\/skill\/(.+)$/);
  if (!match) {
    document.title = 'Skill Gallery';
    renderListRoute();
    return;
  }
  let slug;
  try {
    slug = decodeURIComponent(match[1]);
  } catch {
    views.notFound(app);
    return;
  }
  if (pendingSlug !== slug) {
    window.sessionStorage.removeItem('skill-gallery-list-hash');
  }
  const item = state.skills.find((skill) => skill.slug === slug);
  if (!item) {
    views.notFound(app);
    return;
  }
  await loadDetail(item, token);
}

async function loadIndex() {
  views.loadingView(app);
  try {
    const response = await fetch('assets/search-index.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('index');
    const index = await response.json();
    if (!index || index.schemaVersion !== 1 || !Array.isArray(index.skills)) {
      throw new Error('schema');
    }
    state.skills = index.skills;
    state.revision = index.contentRevision;
    state.engine = search.createSearchEngine(index.skills, window.MiniSearch);
    skillCount.textContent = `${index.skills.length} 个 Skill`;
    route();
  } catch {
    views.errorView(app, '无法加载图库，请重试', loadIndex);
  }
}

const THEME_KEY = 'skill-gallery-theme';

function applyTheme(theme, toggle) {
  document.documentElement.dataset.theme = theme;
  if (!toggle) return;
  toggle.textContent = theme === 'dark' ? '☀️' : '🌙';
  toggle.setAttribute('aria-label', theme === 'dark' ? '切换到浅色主题' : '切换到深色主题');
  toggle.title = theme === 'dark' ? '切换到浅色主题' : '切换到深色主题';
}

function setupTheme() {
  const toggle = document.getElementById('theme-toggle');
  const saved = localStorage.getItem(THEME_KEY);
  let manualTheme = saved === 'dark' || saved === 'light';
  const media =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
  const initial = manualTheme ? saved : media?.matches ? 'dark' : 'light';
  applyTheme(initial, toggle);
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    manualTheme = true;
    applyTheme(next, toggle);
    localStorage.setItem(THEME_KEY, next);
  });
  if (media && typeof media.addEventListener === 'function') {
    media.addEventListener('change', (event) => {
      if (manualTheme) return;
      applyTheme(event.matches ? 'dark' : 'light', toggle);
    });
  }
}

setupTheme();
window.addEventListener('hashchange', route);
loadIndex();
