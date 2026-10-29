/**
 * Regression tests ported from parse5's parser tests (lib/parser/index.test.ts).
 * Not ported: the htmlparser2 adapter doctype test and the onItemPush/onItemPop
 * test (one tree shape, no adapter hooks), and location tests (no locations).
 * The GH-710 test checked that no parse error fires; we have no error
 * reporting, so it checks the tree instead.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isElementNode, isTextNode, parse, parseFragment, type ChildNode, type Element } from '../../../src/html';

const asElement = (node: ChildNode | undefined): Element => {
  if (node === undefined || !isElementNode(node)) {
    throw new Error('expected an element');
  }

  return node;
};

const textOf = (node: ChildNode | undefined): string => {
  if (node === undefined || !isTextNode(node)) {
    throw new Error('expected a text node');
  }

  return node.value;
};

describe('parser regressions', () => {
  describe('rawtext ends at its end tag, even inside what looks like an attribute', () => {
    it.each(['iframe', 'noembed', 'noframes', 'noscript', 'script', 'style', 'textarea', 'title', 'xmp'])('<%s>', (tagName) => {
      const fragment = parseFragment(`<r><${tagName}><math id="</${tagName}><b>should be outside</b>">`);

      expect(fragment.childNodes).toHaveLength(1);
      const r = asElement(fragment.childNodes[0]);

      expect(r.nodeName).toBe('r');
      expect(r.childNodes.map((node) => node.nodeName)).toEqual([tagName, 'b', '#text']);

      const target = asElement(r.childNodes[0]);

      expect(target.childNodes).toHaveLength(1);
      expect(textOf(target.childNodes[0])).toBe('<math id="');

      const b = asElement(r.childNodes[1]);

      expect(b.childNodes).toHaveLength(1);
      expect(textOf(b.childNodes[0])).toBe('should be outside');
    });
  });

  it('gives a DOCTYPE without fields empty strings, not null (GH-236)', () => {
    const doctype = parse('<!DOCTYPE>').childNodes[0];

    expect(doctype).toHaveProperty('name', '');
    expect(doctype).toHaveProperty('publicId', '');
    expect(doctype).toHaveProperty('systemId', '');
  });

  describe('Object.prototype pollution does not reach parsed attributes (GH-119)', () => {
    beforeEach(() => {
      Object.defineProperty(Object.prototype, 'heyyo', { value: 123, configurable: true, writable: true, enumerable: true });
    });

    afterEach(() => {
      Reflect.deleteProperty(Object.prototype, 'heyyo');
    });

    it('keeps only the written attribute', () => {
      const div = asElement(parseFragment('<div id="123">').childNodes[0]);

      expect(div.attrs).toEqual([{ name: 'id', value: '123' }]);
    });

    it('does not add a polluted name when merging <html> and <body> attributes', () => {
      const html = asElement(parse('<html a="1"><body b="2"><html c="3"><body heyyo="4">').childNodes[0]);
      const body = asElement(html.childNodes[1]);

      expect(html.attrs.map((attr) => attr.name)).toEqual(['a', 'c']);
      expect(body.attrs.map((attr) => attr.name)).toEqual(['b', 'heyyo']);
    });
  });

  it('closes <noscript> on an end tag with CRLF before ">" (GH-710)', () => {
    const html = asElement(parse('<!doctype html><noscript>foo</noscript\r\n>').childNodes[1]);
    const head = asElement(html.childNodes[0]);
    const noscript = asElement(head.childNodes[0]);

    expect(noscript.nodeName).toBe('noscript');
    expect(noscript.childNodes).toHaveLength(1);
    expect(textOf(noscript.childNodes[0])).toBe('foo');
    expect(asElement(html.childNodes[1]).childNodes).toHaveLength(0);
  });
});

describe('elements made again for one token', () => {
  const elementsOf = (root: { childNodes: ChildNode[] }): Element[] =>
    root.childNodes.filter(isElementNode).flatMap((element) => [ element, ...elementsOf(element), ...('content' in element ? elementsOf(element.content as Element) : []) ]);

  // Sanitizers edit attrs in place; a shared list or attribute edits both copies.
  it.each([
    [ 'reopened across paragraphs', '<p><a href="x">l<p>m</a>', 2 ],
    [ 'split by a block (adoption agency)', '<a href="x"><div>y</a>', 2 ],
    [ 'recreated between formatting element and block', '<a href="1"><b class="2"><div>x</a>y', 4 ],
  ])('get their own attributes when %s', (_, html, copies) => {
    const elements = elementsOf(parseFragment(html)).filter((element) => element.attrs.length > 0);
    const attributes = elements.flatMap((element) => element.attrs);

    expect(elements).toHaveLength(copies);
    expect(new Set(elements.map((element) => element.attrs)).size).toBe(elements.length);
    expect(new Set(attributes).size).toBe(attributes.length);
  });

  it('keeps the original when the reopened copy is edited', () => {
    const [ first, second ] = parseFragment('<p><a href="x">l<p>m</a>').childNodes.map((p) => asElement(asElement(p).childNodes[0]));

    second.attrs[0].value = 'y';
    second.attrs.push({ name: 'title', value: 't' });

    expect(first.attrs).toEqual([{ name: 'href', value: 'x' }]);
  });
});
