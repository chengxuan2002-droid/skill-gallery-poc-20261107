(function () {
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function clear(node) {
    node.replaceChildren();
  }

  function safeText(value, fallback = '未提供') {
    return value === null || value === undefined || value === '' ? fallback : String(value);
  }

  function safeHref(value) {
    if (typeof value !== 'string' || value.length === 0) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return /^https?:/i.test(value) ? value : null;
    if (value.startsWith('/') || value.split('/').includes('..')) return null;
    return value;
  }

  window.SkillGalleryDom = { clear, element, safeHref, safeText };
})();
