const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const searchSource = fs.readFileSync(path.join(root, 'assets/app-search.js'), 'utf8');

function loadSearch() {
  const context = { URL, URLSearchParams };
  context.globalThis = context;
  vm.runInNewContext(searchSource, context, { filename: 'assets/app-search.js' });
  return context.SkillGallerySearch;
}

test('builds canonical detail share URLs under the project prefix', () => {
  const api = loadSearch();
  assert.equal(
    api.buildDetailShareUrl('http://127.0.0.1:8000/skill-gallery/index.html', 'handoff-codex'),
    'http://127.0.0.1:8000/skill-gallery/#/skill/handoff-codex',
  );
});

test('builds list share URLs with query, mode, filters and sort but no credentials', () => {
  const api = loadSearch();
  const url = api.buildListShareUrl('http://127.0.0.1:8000/skill-gallery/', {
    query: '文档转换',
    mode: 'exact',
    tags: ['文档工具'],
    platforms: ['codex'],
    sourceTypes: ['github'],
    authors: ['文档小组'],
    sort: 'name',
  });
  assert.equal(
    url,
    'http://127.0.0.1:8000/skill-gallery/#/?q=%E6%96%87%E6%A1%A3%E8%BD%AC%E6%8D%A2&mode=exact&tag=%E6%96%87%E6%A1%A3%E5%B7%A5%E5%85%B7&platform=codex&source=github&author=%E6%96%87%E6%A1%A3%E5%B0%8F%E7%BB%84&sort=name',
  );
  assert.equal(/token|password|secret/i.test(url), false);
});

test('returns the short digest as content identity and does not use declared version', () => {
  const api = loadSearch();
  assert.equal(api.contentIdentity({ digest: 'abcdef1234567890' }), 'abcdef123456');
  assert.equal(api.contentIdentity({ digest: 'short' }), 'short');
  assert.equal(api.contentIdentity({ digest: null, declared_version: '1.2.3' }), null);
  assert.equal(api.contentIdentity({ digest: '' }), null);
});
