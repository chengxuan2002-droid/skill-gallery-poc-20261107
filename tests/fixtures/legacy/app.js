// Skill Gallery - main app
const state = {
  skills: [],
  filtered: [],
  currentView: 'list',
  currentSlug: null,
  searchQuery: '',
  activeTags: new Set(),
  activePlatforms: new Set(),
  sortBy: 'updated_at',
};

const app = document.getElementById('app');

// ---------- Search Index ----------
let miniSearch = null;

function buildSearchIndex() {
  if (!window.MiniSearch) {
    console.warn('MiniSearch not available, falling back to substring search');
    return;
  }

  miniSearch = new window.MiniSearch({
    fields: ['name', 'description', 'tags', 'content'],
    storeFields: ['name', 'description', 'slug'],
    searchOptions: {
      boost: { name: 3, description: 2, tags: 2 },
      fuzzy: 0.2,
      prefix: true,
    },
  });

  state.skills.forEach((skill, i) => {
    miniSearch.add({
      id: i,
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      tags: skill.tags.join(' '),
      content: skill.content,
    });
  });
}

// ---------- Data Loading ----------
async function loadSkills() {
  try {
    const res = await fetch('assets/search-index.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.skills = await res.json();
    state.filtered = [...state.skills];
    buildSearchIndex();
    updateSkillCount();
    initTheme();
    handleRoute();
    render();
  } catch (err) {
    app.innerHTML = `<div class="loading">Error loading skills: ${err.message}</div>`;
  }
}

function updateSkillCount() {
  const el = document.getElementById('skill-count');
  if (el) el.textContent = `${state.skills.length} skills`;
}

// ---------- Theme ----------
function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  updateThemeToggle();
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeToggle();
}

function updateThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  btn.textContent = isDark ? '☀️' : '🌙';
  btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
}

// ---------- Filter Logic ----------
function getAllTags() {
  const tags = new Set();
  state.skills.forEach((s) => s.tags.forEach((t) => tags.add(t)));
  return Array.from(tags).sort();
}

function getAllPlatforms() {
  const plats = new Set();
  state.skills.forEach((s) => s.platforms.forEach((p) => plats.add(p)));
  return Array.from(plats).sort();
}

function applyFilters() {
  const q = state.searchQuery.toLowerCase().trim();

  state.filtered = state.skills.filter((skill) => {
    // Tag filter (AND)
    if (state.activeTags.size > 0) {
      for (const tag of state.activeTags) {
        if (!skill.tags.includes(tag)) return false;
      }
    }
    // Platform filter (AND)
    if (state.activePlatforms.size > 0) {
      for (const plat of state.activePlatforms) {
        if (!skill.platforms.includes(plat)) return false;
      }
    }
    // Text search — use minisearch if available
    if (q) {
      if (miniSearch) {
        const results = miniSearch.search(q);
        const resultSlugs = new Set(results.map((r) => state.skills[r.id].slug));
        if (!resultSlugs.has(skill.slug)) return false;
      } else {
        // Fallback: substring search
        const haystack = (
          skill.name +
          ' ' +
          skill.description +
          ' ' +
          skill.tags.join(' ') +
          ' ' +
          skill.content
        ).toLowerCase();
        if (!haystack.includes(q)) return false;
      }
    }
    return true;
  });

  // Sort
  if (state.sortBy === 'name') {
    state.filtered.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    state.filtered.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }

  // When searching with minisearch, sort by relevance
  if (q && miniSearch) {
    const results = miniSearch.search(q);
    const scoreMap = new Map();
    results.forEach((r) => {
      scoreMap.set(state.skills[r.id].slug, r.score);
    });
    state.filtered.sort((a, b) => (scoreMap.get(b.slug) || 0) - (scoreMap.get(a.slug) || 0));
  }
}

// ---------- Rendering ----------
function render() {
  applyFilters();

  if (state.currentView === 'detail') {
    renderDetail();
  } else {
    renderList();
  }
}

function renderList() {
  const allTags = getAllTags();
  const allPlatforms = getAllPlatforms();

  app.innerHTML = `
    <div class="list-layout">
      <aside class="filters">
        <div class="search-bar">
          <input type="text" class="search-input" id="search-input"
                 placeholder="Search skills..." value="${escapeHtml(state.searchQuery)}">
        </div>

        <div class="filter-section">
          <h3>Platforms</h3>
          <div class="filter-tags" id="platform-filters">
            ${allPlatforms
              .map(
                (p) => `
              <span class="filter-tag${state.activePlatforms.has(p) ? ' active' : ''}"
                    data-platform="${escapeHtml(p)}">${escapeHtml(p)}</span>
            `,
              )
              .join('')}
          </div>
        </div>

        <div class="filter-section">
          <h3>Tags</h3>
          <div class="filter-tags" id="tag-filters">
            ${allTags
              .map(
                (tag) => `
              <span class="filter-tag${state.activeTags.has(tag) ? ' active' : ''}"
                    data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</span>
            `,
              )
              .join('')}
          </div>
        </div>
      </aside>

      <div class="list-content">
        <div class="sort-bar">
          <span class="result-count">${state.filtered.length} result${state.filtered.length === 1 ? '' : 's'}</span>
          <select class="sort-select" id="sort-select">
            <option value="updated_at"${state.sortBy === 'updated_at' ? ' selected' : ''}>Recently updated</option>
            <option value="name"${state.sortBy === 'name' ? ' selected' : ''}>Name (A-Z)</option>
          </select>
        </div>

        ${
          state.filtered.length === 0
            ? `
          <div class="empty-state">
            <h3>No skills found</h3>
            <p>Try clearing filters or searching for something else.</p>
            <button id="clear-filters-btn">Clear all filters</button>
          </div>
        `
            : `
          <div class="skill-grid">
            ${state.filtered.map(renderCard).join('')}
          </div>
        `
        }
      </div>
    </div>
  `;

  attachListHandlers();
}

function renderCard(skill) {
  const sourceClass = `badge-source-${skill.source}`;
  const dirBadge = skill.is_dir
    ? '<span class="badge badge-dir" title="Directory skill with attached files">📁</span>'
    : '';
  return `
    <div class="skill-card" data-slug="${skill.slug}">
      <h3 class="skill-card-title">${escapeHtml(skill.name)} ${dirBadge}</h3>
      <p class="skill-card-desc">${escapeHtml(skill.description)}</p>
      <div class="skill-card-meta">
        ${skill.platforms
          .slice(0, 3)
          .map(
            (p) => `
          <span class="badge badge-platform">${escapeHtml(p)}</span>
        `,
          )
          .join('')}
        <span class="badge ${sourceClass}">${escapeHtml(skill.source)}</span>
      </div>
      <div class="skill-card-footer">
        <span>${skill.tags
          .slice(0, 2)
          .map((t) => '#' + escapeHtml(t))
          .join(' ')}</span>
        <span>${formatDate(skill.updated_at)}</span>
      </div>
    </div>
  `;
}

// ---------- Event Handlers ----------
function attachListHandlers() {
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.focus();
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        state.searchQuery = e.target.value;
        render();
        // Restore focus and cursor position
        const input = document.getElementById('search-input');
        if (input) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      }, 200);
    });
  }

  document.querySelectorAll('.filter-tag[data-tag]').forEach((el) => {
    el.addEventListener('click', () => {
      const tag = el.dataset.tag;
      if (state.activeTags.has(tag)) state.activeTags.delete(tag);
      else state.activeTags.add(tag);
      render();
    });
  });

  document.querySelectorAll('.filter-tag[data-platform]').forEach((el) => {
    el.addEventListener('click', () => {
      const p = el.dataset.platform;
      if (state.activePlatforms.has(p)) state.activePlatforms.delete(p);
      else state.activePlatforms.add(p);
      render();
    });
  });

  const sortSelect = document.getElementById('sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      render();
    });
  }

  const clearBtn = document.getElementById('clear-filters-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      state.searchQuery = '';
      state.activeTags.clear();
      state.activePlatforms.clear();
      render();
    });
  }

  document.querySelectorAll('.skill-card').forEach((card) => {
    card.addEventListener('click', () => {
      const slug = card.dataset.slug;
      navigateToDetail(slug);
    });
  });
}

function navigateToDetail(slug) {
  window.location.hash = `#/skill/${slug}`;
}

// ---------- Detail View ----------
function renderDetail() {
  const skill = state.skills.find((s) => s.slug === state.currentSlug);
  if (!skill) {
    app.innerHTML = `
      <div class="detail-view">
        <button class="detail-back" id="detail-back">← Back to list</button>
        <div class="empty-state">
          <h3>Skill not found</h3>
          <p>The skill "${escapeHtml(state.currentSlug)}" doesn't exist.</p>
        </div>
      </div>
    `;
    const backBtn = document.getElementById('detail-back');
    if (backBtn)
      backBtn.addEventListener('click', () => {
        window.location.hash = '';
      });
    return;
  }

  const sourceClass = `badge-source-${skill.source}`;
  const marked = window.marked;

  app.innerHTML = `
    <div class="detail-view">
      <button class="detail-back" id="detail-back">← Back to list</button>

      <div class="detail-header">
        <h1 class="detail-title">${escapeHtml(skill.name)}</h1>
        <p class="detail-desc">${escapeHtml(skill.description)}</p>
        <div class="detail-meta-row">
          ${skill.platforms
            .map(
              (p) => `
            <span class="badge badge-platform">${escapeHtml(p)}</span>
          `,
            )
            .join('')}
          <span class="badge ${sourceClass}">${escapeHtml(skill.source)}</span>
        </div>
        <div class="detail-meta-row">
          ${skill.tags
            .map(
              (t) => `
            <span class="badge">#${escapeHtml(t)}</span>
          `,
            )
            .join('')}
        </div>
      </div>

      <div class="detail-toolbar">
        <div class="export-menu">
          <button class="btn btn-primary" id="export-btn">Export ↓</button>
          <div class="export-dropdown" id="export-dropdown">
            <button class="export-item" data-export="codex">Codex SKILL.md</button>
            <button class="export-item" data-export="claude">Claude Code format</button>
            <button class="export-item" data-export="raw">Raw markdown</button>
            <button class="export-item" data-export="link">Copy link</button>
          </div>
        </div>
      </div>

      <div class="compat-notice">
        <strong>Compatibility:</strong> This skill works best on
        ${skill.platforms.map((p) => `<code>${escapeHtml(p)}</code>`).join(', ')}.
        Other platforms may require format adjustments.
      </div>

      <div class="markdown-body" id="markdown-content">
        ${marked ? marked.parse(skill.content) : '<p>Loading...</p>'}
      </div>

      ${
        skill.is_dir && skill.files && skill.files.length > 0
          ? `
        <div class="detail-files">
          <h4>Attached Files (${skill.files.length})</h4>
          <ul class="file-list">
            ${skill.files
              .map(
                (f) => `
              <li>
                <a href="skills/${encodeURIComponent(skill.slug)}/${f.split('/').map(encodeURIComponent).join('/')}" target="_blank" rel="noopener">
                  <span class="file-icon">📄</span>
                  <span class="file-name">${escapeHtml(f)}</span>
                </a>
              </li>
            `,
              )
              .join('')}
          </ul>
        </div>
      `
          : ''
      }

      ${
        skill.usage_notes
          ? `
        <div class="usage-notes">
          <h4>Personal Notes</h4>
          <p>${escapeHtml(skill.usage_notes).replace(/\n/g, '<br>')}</p>
        </div>
      `
          : ''
      }

      <div class="detail-footer-info">
        ${skill.author ? `<p><strong>Author:</strong> ${escapeHtml(skill.author)}</p>` : ''}
        ${skill.version ? `<p><strong>Version:</strong> v${escapeHtml(skill.version)}</p>` : ''}
        ${skill.source_url ? `<p><strong>Source:</strong> <a href="${escapeHtml(skill.source_url)}" target="_blank" rel="noopener">${escapeHtml(skill.source_url)}</a></p>` : ''}
        <p><strong>Added:</strong> ${formatDate(skill.created_at)} · <strong>Updated:</strong> ${formatDate(skill.updated_at)}</p>
      </div>
    </div>

    <div class="toast" id="toast"></div>
  `;

  attachDetailHandlers();
}

function attachDetailHandlers() {
  const backBtn = document.getElementById('detail-back');
  if (backBtn)
    backBtn.addEventListener('click', () => {
      window.location.hash = '';
    });

  const exportBtn = document.getElementById('export-btn');
  const exportDropdown = document.getElementById('export-dropdown');
  if (exportBtn && exportDropdown) {
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportDropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => {
      exportDropdown.classList.remove('open');
    });
  }

  document.querySelectorAll('.export-item').forEach((item) => {
    item.addEventListener('click', () => {
      const format = item.dataset.export;
      handleExport(format);
      const dd = document.getElementById('export-dropdown');
      if (dd) dd.classList.remove('open');
    });
  });
}

function handleExport(format) {
  const skill = state.skills.find((s) => s.slug === state.currentSlug);
  if (!skill) return;

  const rawMd = buildFullMarkdown(skill);

  if (format === 'codex') {
    downloadFile(`${skill.slug}.md`, rawMd);
    showToast('Downloaded: Codex SKILL.md');
  } else if (format === 'claude') {
    const claude = buildClaudeFormat(skill);
    downloadFile(`${skill.slug}.md`, claude);
    showToast('Downloaded: Claude Code format');
  } else if (format === 'raw') {
    copyToClipboard(rawMd);
    showToast('Copied markdown to clipboard');
  } else if (format === 'link') {
    copyToClipboard(window.location.href);
    showToast('Link copied to clipboard');
  }
}

function buildFullMarkdown(skill) {
  const lines = ['---'];
  lines.push(`name: ${skill.name}`);
  lines.push(`description: ${skill.description}`);
  lines.push(`tags: [${skill.tags.join(', ')}]`);
  lines.push(`platforms: [${skill.platforms.join(', ')}]`);
  lines.push(`source: ${skill.source}`);
  if (skill.source_url) lines.push(`source_url: ${skill.source_url}`);
  if (skill.author) lines.push(`author: ${skill.author}`);
  lines.push(`created_at: ${skill.created_at}`);
  lines.push(`updated_at: ${skill.updated_at}`);
  if (skill.usage_notes) {
    lines.push('usage_notes: |');
    skill.usage_notes.split('\n').forEach((l) => lines.push(`  ${l}`));
  }
  lines.push('---');
  lines.push('');
  lines.push(skill.content);
  return lines.join('\n');
}

function buildClaudeFormat(skill) {
  const lines = [];
  lines.push(`# ${skill.name}`);
  lines.push('');
  lines.push(`> ${skill.description}`);
  lines.push('');
  lines.push(`**Platforms:** ${skill.platforms.join(', ')}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(skill.content);
  return lines.join('\n');
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } catch {
    /* Clipboard fallback remains best effort. */
  }
  document.body.removeChild(ta);
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

// ---------- Utilities ----------
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ---------- Routing ----------
function handleRoute() {
  const hash = window.location.hash;
  const match = hash.match(/^#\/skill\/([^/]+)/);
  if (match) {
    state.currentView = 'detail';
    state.currentSlug = match[1];
  } else {
    state.currentView = 'list';
    state.currentSlug = null;
  }
}

window.addEventListener('hashchange', () => {
  handleRoute();
  if (state.skills.length > 0) render();
});

// ---------- Theme toggle ----------
document.addEventListener('click', (e) => {
  if (e.target.id === 'theme-toggle') toggleTheme();
});

// ---------- Init ----------
loadSkills();
