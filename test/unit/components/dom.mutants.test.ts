import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Dom, calculateBaseline } from '../../../src/components/dom';

/**
 * Tags Dom.isSingleTag must recognise. Losing one makes getDeepestNode walk into
 * a void element instead of stepping over it, so the caret lands nowhere.
 */
const SINGLE_TAGS = [
  'AREA',
  'BASE',
  'BR',
  'COL',
  'COMMAND',
  'EMBED',
  'HR',
  'IMG',
  'INPUT',
  'KEYGEN',
  'LINK',
  'META',
  'PARAM',
  'SOURCE',
  'TRACK',
  'WBR',
];

/**
 * Input types Dom.allInputsSelector must reach. A missing one hides that input
 * from every caret and focus lookup.
 */
const EDITABLE_INPUT_TYPES = ['text', 'password', 'email', 'number', 'search', 'tel', 'url'];

/**
 * Input types that cannot hold a caret.
 */
const CARET_BLOCKING_TYPES = [
  'file',
  'checkbox',
  'radio',
  'hidden',
  'submit',
  'button',
  'image',
  'reset',
];

/**
 * Every name in Dom.blockElements. A missing one makes containsOnlyInlineElements
 * call a block tree inline, and findAllInputs then returns the wrapper instead of
 * the real inputs inside it.
 */
const BLOCK_ELEMENTS = [
  'address',
  'article',
  'aside',
  'blockquote',
  'canvas',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'hr',
  'li',
  'main',
  'nav',
  'noscript',
  'ol',
  'output',
  'p',
  'pre',
  'ruby',
  'section',
  'table',
  'tbody',
  'thead',
  'tr',
  'tfoot',
  'ul',
  'video',
];

const NBSP = '\u00A0';
const TAB = '\t';

describe('Dom — behaviours that no other test pins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('tag classification', () => {
    it.each(SINGLE_TAGS)('reports <%s> as a void element', (tag) => {
      expect(Dom.isSingleTag(document.createElement(tag))).toBe(true);
    });

    it('reports a paired tag as not void', () => {
      expect(Dom.isSingleTag(document.createElement('div'))).toBe(false);
    });

    it('reports both BR and WBR as line breaks', () => {
      expect(Dom.isLineBreakTag(document.createElement('br'))).toBe(true);
      expect(Dom.isLineBreakTag(document.createElement('wbr'))).toBe(true);
      expect(Dom.isLineBreakTag(document.createElement('span'))).toBe(false);
    });
  });

  describe('make() — class names', () => {
    it('adds a plain class with nothing appended to it', () => {
      expect(Dom.make('div', ['btn']).className).toBe('btn');
    });

    it('appends an ASCII-whitespace class after the ones classList accepted', () => {
      /**
       * classList.add throws on ASCII whitespace, so this class can only reach the
       * element through setAttribute — which runs after classList and therefore
       * flips the two names round.
       */
      expect(Dom.make('div', [`a${TAB}b`, 'btn']).className).toBe(`btn a${TAB}b`);
    });

    it('appends a non-breaking-space class after the ones classList accepted', () => {
      /**
       * classList.add accepts U+00A0 — only the /\s/ guard rejects it. Without that
       * guard both names go in through classList and keep their input order.
       */
      expect(Dom.make('div', [`a${NBSP}b`, 'btn']).className).toBe(`btn a${NBSP}b`);
    });

    it('joins several rejected class names with one space', () => {
      expect(Dom.make('div', [`a${TAB}b`, `c${TAB}d`]).className).toBe(`a${TAB}b c${TAB}d`);
    });

    it('joins several rejected class names with one space behind an accepted one', () => {
      /**
       * Separate from the case above: the two branches of the class attribute
       * build the joined string twice, once with an existing class in front.
       */
      expect(Dom.make('div', ['btn', `a${TAB}b`, `c${TAB}d`]).className).toBe(`btn a${TAB}b c${TAB}d`);
    });

    it('drops the empty segments a double space produces', () => {
      expect(Dom.make('div', ['btn  primary']).className).toBe('btn primary');
      expect(Dom.make('div', 'btn  primary').className).toBe('btn primary');
    });
  });

  describe('make() — attributes', () => {
    it('writes own attributes and ignores inherited ones', () => {
      const proto: Record<string, string> = { 'data-blok-inherited': 'from-proto' };
      const attributes = Object.create(proto) as Record<string, string>;

      attributes['data-blok-own'] = 'own';

      const el = Dom.make('div', null, attributes);

      expect(el.getAttribute('data-blok-own')).toBe('own');
      expect(el.hasAttribute('data-blok-inherited')).toBe(false);
    });

    it('skips null and undefined values instead of stringifying them', () => {
      const el = Dom.make('div', null, {
        'data-blok-nullish': null,
        'data-blok-void': undefined,
        'data-blok-kept': 'yes',
      });

      expect(el.hasAttribute('data-blok-nullish')).toBe(false);
      expect(el.hasAttribute('data-blok-void')).toBe(false);
      expect(el.getAttribute('data-blok-kept')).toBe('yes');
    });

    it('assigns a known property rather than setting an attribute', () => {
      const el = Dom.make('div', null, { textContent: 'inline copy' });

      expect(el.textContent).toBe('inline copy');
      expect(el.attributes).toHaveLength(0);
    });
  });

  describe('append() and prepend()', () => {
    it('appends a single node', () => {
      const parent = document.createElement('div');
      const child = document.createElement('span');

      Dom.append(parent, child);

      expect(parent.childNodes).toHaveLength(1);
      expect(parent.firstChild).toBe(child);
    });

    it('prepends a single node ahead of what is already there', () => {
      const parent = document.createElement('div');
      const existing = document.createElement('b');
      const child = document.createElement('span');

      parent.appendChild(existing);
      Dom.prepend(parent, child);

      expect(parent.childNodes).toHaveLength(2);
      expect(parent.firstChild).toBe(child);
    });

    it('prepends an array so its first item ends up first', () => {
      const parent = document.createElement('div');
      const initial = document.createElement('span');
      const first = document.createElement('span');
      const second = document.createElement('span');

      parent.appendChild(initial);
      Dom.prepend(parent, [first, second]);

      /**
       * Identity, never structure: three empty spans are structurally equal, so a
       * shuffled order passes any toEqual on the list.
       */
      expect(parent.childNodes[0]).toBe(first);
      expect(parent.childNodes[1]).toBe(second);
      expect(parent.childNodes[2]).toBe(initial);
    });
  });

  describe('findAllInputs()', () => {
    it.each(EDITABLE_INPUT_TYPES)('finds an <input type="%s">', (type) => {
      const holder = document.createElement('div');
      const input = document.createElement('input');

      input.setAttribute('type', type);
      holder.appendChild(input);

      const found = Dom.findAllInputs(holder);

      expect(found).toHaveLength(1);
      expect(found[0]).toBe(input);
    });

    it('ignores a non-HTML element that matches the input selector', () => {
      const holder = document.createElement('div');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      svg.setAttribute('contenteditable', 'true');
      holder.appendChild(svg);

      expect(Dom.findAllInputs(holder)).toHaveLength(0);
    });

    it('returns a native input whole even when it holds a block child', () => {
      const holder = document.createElement('div');
      const textarea = document.createElement('textarea');
      const blockChild = document.createElement('div');

      blockChild.textContent = 'block child';
      textarea.appendChild(blockChild);
      holder.appendChild(textarea);

      const found = Dom.findAllInputs(holder);

      expect(found).toHaveLength(1);
      expect(found[0]).toBe(textarea);
    });
  });

  describe('getDeepestNode()', () => {
    it('steps over a void child into its next sibling', () => {
      const root = document.createElement('div');
      const span = document.createElement('span');
      const text = document.createTextNode('tail');

      span.appendChild(text);
      root.append(document.createElement('img'), span);

      expect(Dom.getDeepestNode(root)).toBe(text);
    });

    it('steps over a void child into its previous sibling when searching from the end', () => {
      const root = document.createElement('div');
      const span = document.createElement('span');
      const text = document.createTextNode('head');

      span.appendChild(text);
      root.append(span, document.createElement('img'));

      expect(Dom.getDeepestNode(root, true)).toBe(text);
    });

    it('stops on a native input instead of stepping over it', () => {
      const root = document.createElement('div');
      const input = document.createElement('input');
      const span = document.createElement('span');

      span.appendChild(document.createTextNode('after'));
      root.append(input, span);

      expect(Dom.getDeepestNode(root)).toBe(input);
    });

    it('stops on a line break instead of stepping over it', () => {
      const root = document.createElement('div');
      const lineBreak = document.createElement('br');
      const span = document.createElement('span');

      span.appendChild(document.createTextNode('after'));
      root.append(lineBreak, span);

      expect(Dom.getDeepestNode(root)).toBe(lineBreak);
    });

    it('returns an element that has no children at all', () => {
      const empty = document.createElement('div');

      expect(Dom.getDeepestNode(empty)).toBe(empty);
    });

    it('returns the parent when a void child has no sibling to move to', () => {
      const root = document.createElement('div');

      root.appendChild(document.createElement('img'));

      expect(Dom.getDeepestNode(root)).toBe(root);
    });

    it('leaves the parent when a void child is last and the parent has a sibling', () => {
      const section = document.createElement('section');
      const holder = document.createElement('div');
      const after = document.createElement('p');
      const text = document.createTextNode('after');

      holder.appendChild(document.createElement('img'));
      after.appendChild(text);
      section.append(holder, after);

      expect(Dom.getDeepestNode(holder)).toBe(text);
    });

    it('returns a populated fragment untouched', () => {
      const fragment = document.createDocumentFragment();
      const paragraph = document.createElement('p');

      paragraph.appendChild(document.createTextNode('inside'));
      fragment.appendChild(paragraph);

      expect(Dom.getDeepestNode(fragment)).toBe(fragment);
    });
  });

  describe('node type guards', () => {
    it('answers isElement for non-nodes without throwing', () => {
      expect(Dom.isElement(null)).toBe(false);
      expect(Dom.isElement(undefined)).toBe(false);
      expect(Dom.isElement('abc')).toBe(false);
      expect(Dom.isElement(42)).toBe(false);
      expect(Dom.isElement(document.createTextNode('t'))).toBe(false);
      expect(Dom.isElement(document.createElement('div'))).toBe(true);
    });

    it('answers isFragment only for a document fragment', () => {
      expect(Dom.isFragment(document.createDocumentFragment())).toBe(true);
      expect(Dom.isFragment(document.createElement('div'))).toBe(false);
      expect(Dom.isFragment(null)).toBe(false);
      expect(Dom.isFragment('abc')).toBe(false);
      expect(Dom.isFragment(42)).toBe(false);
    });

    it('answers isNativeInput for non-elements without throwing', () => {
      expect(Dom.isNativeInput(null)).toBe(false);
      expect(Dom.isNativeInput('INPUT')).toBe(false);
      expect(Dom.isNativeInput(document.createElement('div'))).toBe(false);
      expect(Dom.isNativeInput(document.createElement('input'))).toBe(true);
      expect(Dom.isNativeInput(document.createElement('textarea'))).toBe(true);
    });

    it('reads contentEditable from the property, not only the attribute', () => {
      const el = document.createElement('div');

      /**
       * jsdom does not reflect this property back to the attribute, so the
       * attribute clause cannot cover for the property clause here.
       */
      el.contentEditable = 'plaintext-only';

      expect(Dom.isContentEditable(el)).toBe(true);
    });
  });

  describe('canSetCaret()', () => {
    it.each(CARET_BLOCKING_TYPES)('refuses a caret inside <input type="%s">', (type) => {
      const input = document.createElement('input');

      input.setAttribute('type', type);

      expect(Dom.canSetCaret(input)).toBe(false);
    });

    it('allows a caret inside a text input', () => {
      const input = document.createElement('input');

      input.setAttribute('type', 'text');

      expect(Dom.canSetCaret(input)).toBe(true);
    });

    it('refuses a caret on an element that is not editable', () => {
      expect(Dom.canSetCaret(document.createElement('div'))).toBe(false);
    });
  });

  describe('emptiness', () => {
    it('never calls a void element empty, but does call a line break empty', () => {
      expect(Dom.isNodeEmpty(document.createElement('img'))).toBe(false);
      expect(Dom.isNodeEmpty(document.createElement('br'))).toBe(true);
    });

    it('reads the value of a native input rather than its text', () => {
      /**
       * A textarea, not an input: INPUT is a void tag, so isNodeEmpty answers
       * from the void-tag guard and never reaches the value lookup.
       */
      const textarea = document.createElement('textarea');

      textarea.value = 'typed';

      expect(textarea.textContent).toBe('');
      expect(Dom.isNodeEmpty(textarea)).toBe(false);
    });

    it('reads the text of an element that is not a native input', () => {
      const el = document.createElement('div');

      el.textContent = 'written';

      expect(Dom.isNodeEmpty(el)).toBe(false);
    });

    it('treats a node whose textContent is null as empty', () => {
      /**
       * document.textContent is null — the optional chains have to survive it,
       * with and without ignoreChars.
       */
      expect(Dom.isNodeEmpty(document)).toBe(true);
      expect(Dom.isNodeEmpty(document, 'x')).toBe(true);
    });

    it('reports zero length for a node whose textContent is null', () => {
      expect(Dom.getContentLength(document)).toBe(0);
    });
  });

  describe('containsOnlyInlineElements()', () => {
    it.each(BLOCK_ELEMENTS)('counts <%s> as a block element', (tag) => {
      const wrapper = document.createElement('div');

      /**
       * Built through createElement, not markup: the parser drops a bare <tr> or
       * <li> from an innerHTML string and the case would silently pass.
       */
      wrapper.appendChild(document.createElement(tag));

      expect(Dom.containsOnlyInlineElements(wrapper)).toBe(false);
    });

    it('counts a nested inline tree as inline only', () => {
      const wrapper = document.createElement('div');
      const bold = document.createElement('b');

      bold.appendChild(document.createElement('i'));
      wrapper.appendChild(bold);

      expect(Dom.containsOnlyInlineElements(wrapper)).toBe(true);
    });
  });

  describe('getNodeByOffset()', () => {
    const buildRoot = (): { root: HTMLElement; first: Text; second: Text } => {
      const root = document.createElement('div');
      /**
       * Two text nodes with different content: identical ones cannot tell a
       * walk that stopped early from one that ran to the end.
       */
      const first = document.createTextNode('ab');
      const second = document.createTextNode('cd');

      root.append(first, second);

      return {
        root,
        first,
        second,
      };
    };

    it('lands inside the first text node for an offset within it', () => {
      const { root, first } = buildRoot();
      const result = Dom.getNodeByOffset(root, 1);

      expect(result.node).toBe(first);
      expect(result.offset).toBe(1);
    });

    it('gives a boundary offset to the node that ends there', () => {
      const { root, first } = buildRoot();
      const result = Dom.getNodeByOffset(root, 2);

      expect(result.node).toBe(first);
      expect(result.offset).toBe(2);
    });

    it('clamps an offset past the end onto the end of the last text node', () => {
      const { root, second } = buildRoot();
      const result = Dom.getNodeByOffset(root, 5);

      expect(result.node).toBe(second);
      expect(result.offset).toBe(2);
    });

    it('returns nothing when the only text node is empty', () => {
      const root = document.createElement('div');

      root.appendChild(document.createTextNode(''));

      const result = Dom.getNodeByOffset(root, 0);

      expect(result.node).toBeNull();
      expect(result.offset).toBe(0);
    });

    it('returns nothing when there is no text at all', () => {
      const result = Dom.getNodeByOffset(document.createElement('div'), 0);

      expect(result.node).toBeNull();
      expect(result.offset).toBe(0);
    });
  });

  describe('calculateBaseline()', () => {
    it('falls back to 1.2x the font size when line-height is not a length', () => {
      const element = document.createElement('div');
      const style = {
        fontSize: '20px',
        lineHeight: 'normal',
        paddingTop: '0px',
        borderTopWidth: '0px',
        marginTop: '0px',
      } as CSSStyleDeclaration;

      vi.spyOn(window, 'getComputedStyle').mockReturnValue(style);

      // (20 * 1.2 - 20) / 2 + 20 * 0.8
      expect(calculateBaseline(element)).toBeCloseTo(18);
    });
  });
});
