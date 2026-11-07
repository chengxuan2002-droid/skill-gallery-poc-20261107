'use strict';

function matches(node, selector) {
  if (selector.startsWith('.')) {
    return String(node.className || '')
      .split(/\s+/)
      .filter(Boolean)
      .includes(selector.slice(1));
  }
  if (selector.startsWith('#')) return node.id === selector.slice(1);
  return node.tagName === selector.toUpperCase();
}

function descendants(node, selector, found = []) {
  for (const child of node.children) {
    if (matches(child, selector)) found.push(child);
    descendants(child, selector, found);
  }
  return found;
}

function createNode(tagName) {
  const node = {
    tagName: String(tagName).toUpperCase(),
    className: '',
    id: '',
    type: '',
    value: '',
    checked: false,
    disabled: false,
    hidden: false,
    placeholder: '',
    htmlFor: '',
    children: [],
    parentNode: null,
    dataset: {},
    attributes: {},
    _text: '',
    _listeners: new Map(),
    get textContent() {
      return this._text + this.children.map((child) => child.textContent).join('');
    },
    set textContent(value) {
      this._text = String(value ?? '');
      this.children.length = 0;
    },
    get childNodes() {
      return this.children;
    },
    append(...nodes) {
      for (const child of nodes) {
        child.parentNode = this;
        this.children.push(child);
      }
    },
    appendChild(child) {
      this.append(child);
      return child;
    },
    replaceChildren(...nodes) {
      this.children.length = 0;
      this._text = '';
      this.append(...nodes);
    },
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
      this.parentNode = null;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'id') this.id = String(value);
      if (name === 'type') this.type = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
        ? this.attributes[name]
        : null;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    addEventListener(type, listener) {
      const listeners = this._listeners.get(type) || [];
      listeners.push(listener);
      this._listeners.set(type, listeners);
    },
    dispatch(type) {
      const event = { target: this, preventDefault() {}, closest: () => null };
      const listeners = this._listeners.get(type) || [];
      return Promise.all(listeners.map((listener) => listener(event)));
    },
    querySelectorAll(selector) {
      return descendants(this, selector);
    },
    querySelector(selector) {
      return descendants(this, selector)[0] || null;
    },
    focus() {},
    select() {},
    classList: null,
  };
  const classes = () =>
    String(node.className || '')
      .split(/\s+/)
      .filter(Boolean);
  node.classList = {
    add(name) {
      if (!classes().includes(name)) node.className = [...classes(), name].join(' ');
    },
    remove(name) {
      node.className = classes()
        .filter((item) => item !== name)
        .join(' ');
    },
    toggle(name, force) {
      const active = classes().includes(name);
      const next = force === undefined ? !active : Boolean(force);
      if (next && !active) node.className = [...classes(), name].join(' ');
      if (!next && active) {
        node.className = classes()
          .filter((item) => item !== name)
          .join(' ');
      }
      return next;
    },
  };
  return node;
}

function createDocument() {
  return {
    createElement(tagName) {
      return createNode(tagName);
    },
    getElementById() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

module.exports = { createDocument, createNode, descendants };
