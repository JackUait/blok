import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { parseUntrustedDocument, parseUntrustedHtml } from '../../../../src/components/utils/inert-html';

describe('parseUntrustedHtml', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses into a document with no browsing context', () => {
    const wrapper = parseUntrustedHtml('<p>hi</p>');

    // No browsing context is what stops resource loads: an <img src=x onerror>
    // parsed into the LIVE document fires its handler before any sanitizer runs.
    expect(wrapper.ownerDocument).not.toBe(document);
    expect(wrapper.ownerDocument.defaultView).toBeNull();
  });

  it('keeps the parsed markup readable through the element API', () => {
    const wrapper = parseUntrustedHtml('<p>one</p><ul><li>two</li></ul>');

    expect(wrapper.querySelectorAll('p')).toHaveLength(1);
    expect(wrapper.querySelector('li')?.textContent).toBe('two');
    expect(wrapper.children).toHaveLength(2);
    expect(wrapper.innerHTML).toBe('<p>one</p><ul><li>two</li></ul>');
  });

  it('preserves an img handler as inert markup rather than dropping it', () => {
    const wrapper = parseUntrustedHtml('<img src="x" onerror="window.__x=1">');

    // Preprocessing must not silently change the payload; the sanitizer, which
    // runs later, is what removes the handler.
    expect(wrapper.querySelector('img')?.getAttribute('onerror')).toBe('window.__x=1');
  });

  it('adopts nodes created against the live document', () => {
    const wrapper = parseUntrustedHtml('<p>one</p>');
    const strong = document.createElement('strong');

    wrapper.appendChild(strong);

    expect(wrapper.innerHTML).toBe('<p>one</p><strong></strong>');
  });
});

describe('parseUntrustedDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses into a document with no browsing context', () => {
    const doc = parseUntrustedDocument('<p>hi</p>');

    expect(doc).not.toBe(document);
    expect(doc.defaultView).toBeNull();
  });

  it('keeps <head> styles and <body> attributes that a fragment parse drops', () => {
    const doc = parseUntrustedDocument('<html><head><style>.a{color:red}</style></head><body dir="rtl"><p>x</p></body></html>');

    expect(doc.head.querySelector('style')?.textContent).toBe('.a{color:red}');
    expect(doc.body.getAttribute('dir')).toBe('rtl');
  });

  it('parses Office markup with no doctype in quirks mode, like a browser does', () => {
    // Quirks mode changes the tree: a <table> inside a <p> stays nested.
    expect(parseUntrustedDocument('<p>a<table><tr><td>b</td></tr></table></p>').compatMode).toBe('BackCompat');
  });
});
