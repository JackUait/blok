import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sanitizeBlockHtml } from '../../../src/markdown/sanitize-html';

/**
 * Firefox and WebKit let `<img name="body">` (or `createNodeIterator`,
 * `createTextNode`) shadow that member of the parsed document. jsdom does not,
 * so these tests shadow it the same way: an own property on the document.
 * @param name - document member to shadow
 */
const shadowParsedDocument = (name: string): void => {
  const parse = DOMParser.prototype.parseFromString;

  vi.spyOn(DOMParser.prototype, 'parseFromString').mockImplementation(function (this: DOMParser, html, type) {
    const doc = parse.call(this, html, type);

    Object.defineProperty(doc, name, { value: doc.querySelector(`[name="${name}"]`) });

    return doc;
  });
};

describe('sanitizeBlockHtml when the parsed document is clobbered', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([ 'body', 'createNodeIterator', 'createTextNode' ])('cleans the whole input when %s is shadowed', (name) => {
    shadowParsedDocument(name);

    const output = sanitizeBlockHtml(` <div><img name="${name}"><p>kept</p><img src="x" onerror="alert(1)"></div>`);

    expect(output).toBe(' <div><img><p>kept</p><img src="x"></div>');
  });
});
