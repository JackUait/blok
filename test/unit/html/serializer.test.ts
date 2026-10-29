import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, parseFragment, serialize as parse5Serialize } from 'parse5';
import type { Attribute } from '../../../src/html/token';
import { NS } from '../../../src/html/tags';
import {
  appendChild,
  createCommentNode,
  createDocumentFragment,
  createElement,
  createTextNode,
  setTemplateContent,
  type ChildNode,
  type DocumentFragment,
  type DocumentType,
  type ParentNode,
} from '../../../src/html/tree';
import { serialize, serializeOuter } from '../../../src/html/serializer';

/** parse5's default tree is our tree plus source locations; its enums are just nominally different. */
const asOurs = (node: unknown): ParentNode => node as ParentNode;
const asOursChild = (node: unknown): ChildNode => node as ChildNode;
/** Our hand-built trees are valid parse5 default-adapter trees, so parse5 can be the oracle for them. */
const viaParse5 = (node: ParentNode): string => parse5Serialize(node);

interface SerializationCase {
  name: string;
  options?: { scriptingEnabled?: boolean };
  input: string;
  expected: string;
}

const CASES: SerializationCase[] = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'fixtures', 'html5lib', 'serialization.json'), 'utf8')
);

const element = (tagName: string, children: ChildNode[] = [], attrs: Attribute[] = [], namespaceURI = NS.HTML): ChildNode => {
  const node = createElement(tagName, namespaceURI, attrs);

  children.forEach((child) => appendChild(node, child));

  return node;
};

const fragmentOf = (...children: ChildNode[]): DocumentFragment => {
  const fragment = createDocumentFragment();

  children.forEach((child) => appendChild(fragment, child));

  return fragment;
};

describe('html serializer', () => {
  describe('parse5 serialization fixtures', () => {
    // Blok's serializer has no options: scripting is always on, so the one scripting-off case does not apply.
    const applicable = CASES.filter((test) => test.options?.scriptingEnabled !== false);

    it('runs every case but the scripting-off one', () => {
      expect(CASES.length - applicable.length).toBe(1);
    });

    it.each(applicable.map((test, index): [string, SerializationCase] => [`${index}. ${test.name}`, test]))('%s', (_, test) => {
      expect(serialize(asOurs(parse(test.input)))).toBe(test.expected);
    });
  });

  describe('parse5 regressions', () => {
    it('serializes an element with its own tag (serializeOuter)', () => {
      const div = parseFragment('<div><button>Hello</button></div>').childNodes[0];

      expect(serializeOuter(asOursChild(div))).toBe('<div><button>Hello</button></div>');
    });

    it('serializes the content of a <template>, not its child nodes', () => {
      const template = parseFragment('<template><button>Hello</button></template>').childNodes[0];

      expect(serialize(asOurs(template))).toBe('<button>Hello</button>');
    });

    it('skips the children of an HTML void element', () => {
      const br = element('br', [element('div')]);

      expect(serialize(asOurs(br))).toBe('');
      expect(serializeOuter(br)).toBe('<br>');
    });

    it('keeps the children of a void-named element outside HTML', () => {
      const svgBr = element('br', [element('div')], [], NS.SVG);

      expect(serialize(asOurs(svgBr))).toBe('<div></div>');
      expect(serializeOuter(svgBr)).toBe('<br><div></div></br>');
    });

    it('escapes text inside template content, whose parent is a fragment', () => {
      const document = parse('<template>a<b>&amp;</b>&lt;</template>');

      expect(serialize(asOurs(document))).toBe('<html><head><template>a<b>&amp;</b>&lt;</template></head><body></body></html>');
    });

    // parse5's "unknown node" and custom tree adapter tests have no counterpart: Blok has one tree shape.
  });

  describe('hand-built trees', () => {
    it('escapes &, <, > and NBSP in text, and nothing else', () => {
      const tree = fragmentOf(createTextNode('a & b < c > d   "e" \'f\' = `g`'));

      expect(serialize(tree)).toBe('a &amp; b &lt; c &gt; d &nbsp; "e" \'f\' = `g`');
      expect(serialize(tree)).toBe(viaParse5(tree));
    });

    it('escapes ", & and NBSP in attribute values, and leaves < > \' alone', () => {
      const tree = fragmentOf(element('a', [], [{ name: 'title', value: '"x" & <y> \'z\'  ' }]));

      expect(serialize(tree)).toBe('<a title="&quot;x&quot; &amp; <y> \'z\' &nbsp;"></a>');
      expect(serialize(tree)).toBe(viaParse5(tree));
    });

    it('writes raw text inside HTML raw-text elements only', () => {
      const raw = ['style', 'script', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext', 'noscript'];
      const tree = fragmentOf(
        ...raw.map((tag) => element(tag, [createTextNode('<&> ')])),
        element('style', [createTextNode('<&>')], [], NS.SVG),
        element('textarea', [createTextNode('<&>')]),
        element('title', [createTextNode('<&>')])
      );
      const expected = [
        ...raw.map((tag) => `<${tag}><&> </${tag}>`),
        '<style>&lt;&amp;&gt;</style>',
        '<textarea>&lt;&amp;&gt;</textarea>',
        '<title>&lt;&amp;&gt;</title>',
      ].join('');

      expect(serialize(tree)).toBe(expected);
      expect(serialize(tree)).toBe(viaParse5(tree));
    });

    it('decides raw text by the text node\'s own parent', () => {
      const text = createTextNode('<x>');

      appendChild(createElement('script', NS.HTML, []), text);

      expect(serializeOuter(text)).toBe('<x>');
      expect(serializeOuter(createTextNode('<x>'))).toBe('&lt;x&gt;');
    });

    it('prefixes namespaced attribute names the way parse5 does', () => {
      const attrs: Attribute[] = [
        { name: 'href', namespace: NS.XLINK, prefix: 'xlink', value: '#a' },
        { name: 'lang', namespace: NS.XML, prefix: 'xml', value: 'en' },
        { name: 'xmlns', namespace: NS.XMLNS, value: NS.SVG },
        { name: 'xlink', namespace: NS.XMLNS, prefix: 'xmlns', value: NS.XLINK },
        { name: 'thing', namespace: 'urn:x', prefix: 'p', value: '1' },
        { name: 'bare', namespace: 'urn:x', value: '2' },
        { name: 'plain', namespace: '', prefix: 'ignored', value: '3' },
      ];
      const tree = fragmentOf(element('svg', [], attrs, NS.SVG));

      expect(serialize(tree)).toBe(
        `<svg xlink:href="#a" xml:lang="en" xmlns="${NS.SVG}" xmlns:xlink="${NS.XLINK}" p:thing="1" undefined:bare="2" plain="3"></svg>`
      );
      expect(serialize(tree)).toBe(viaParse5(tree));
    });

    it('writes comments and doctypes as they are', () => {
      const doctype: DocumentType = { nodeName: '#documentType', name: '', publicId: 'p', systemId: 's', parentNode: null };
      const tree = fragmentOf(doctype, createCommentNode('a --> <b> &amp;'), element('p'));

      expect(serialize(tree)).toBe('<!DOCTYPE ><!--a --> <b> &amp;--><p></p>');
      expect(serialize(tree)).toBe(viaParse5(tree));
    });

    it('uses template content only for an HTML template', () => {
      const html = createElement('template', NS.HTML, []);
      const svg = createElement('template', NS.SVG, []);

      setTemplateContent(html, fragmentOf(createTextNode('in content')));
      setTemplateContent(svg, fragmentOf(createTextNode('in content')));
      appendChild(svg, createTextNode('child'));

      expect(serializeOuter(html)).toBe('<template>in content</template>');
      expect(serializeOuter(svg)).toBe('<template>child</template>');
    });

    it('keeps an attribute named like an Object.prototype member', () => {
      const tree = fragmentOf(element('p', [], [{ name: '__proto__', value: 'x' }, { name: 'constructor', value: 'y' }]));

      expect(serialize(tree)).toBe('<p __proto__="x" constructor="y"></p>');
    });

    it('serializes the same twice in a row', () => {
      const tree = fragmentOf(createTextNode('a&b'), element('i', [], [{ name: 'x', value: '&"' }]));

      expect(serialize(tree)).toBe(serialize(tree));
    });
  });
});
