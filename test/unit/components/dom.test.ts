import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Dom, isCollapsedWhitespaces, calculateBaseline, toggleEmptyMark } from '../../../src/components/dom';

describe('Dom helper utilities', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('element creation helpers', () => {
    it('creates elements with classes and attributes via make()', () => {
      const button = Dom.make('button', ['btn', undefined, 'primary'], {
        type: 'button',
        title: 'Action',
        disabled: true,
        'data-blok-testid': 'make-button',
        'data-blok-classes': 'btn primary',
      });

      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveAttribute('data-blok-classes', 'btn primary');
      expect(button).toHaveAttribute('data-blok-testid', 'make-button');
      expect((button as HTMLButtonElement).disabled).toBe(true);

      const input = Dom.make('input', 'field', {
        value: 'Hello',
      });

      expect((input as HTMLInputElement).value).toBe('Hello');
    });

    it('handles Tailwind arbitrary value class names without throwing', () => {
      /**
       * Tailwind CSS arbitrary values like py-[theme(spacing.2)] contain parentheses
       * which are invalid for classList.add(). The Dom.make() should handle these gracefully.
       */
      const tailwindClasses = [
        'py-[theme(spacing.2)]',
        'w-[calc(100%-2rem)]',
        'bg-[#1da1f2]',
        'text-[length:var(--font-size)]',
        'valid-class',
        'another-valid',
      ];

      expect(() => {
        Dom.make('div', tailwindClasses);
      }).not.toThrow();

      const element = Dom.make('div', tailwindClasses);

      /**
       * Verify that all class names are present in the element's class attribute
       */
      tailwindClasses.forEach((className) => {
        expect(element.className.includes(className)).toBe(true);
      });
    });

    it('handles class names with spaces in array items', () => {
      const element = Dom.make('div', ['class1 class2', 'class3']);

      expect(element.classList.contains('class1')).toBe(true);
      expect(element.classList.contains('class2')).toBe(true);
      expect(element.classList.contains('class3')).toBe(true);
    });

    it('handles class names with spaces in string', () => {
      const element = Dom.make('div', 'class1 class2 class3');

      expect(element.classList.contains('class1')).toBe(true);
      expect(element.classList.contains('class2')).toBe(true);
      expect(element.classList.contains('class3')).toBe(true);
    });

    it('handles mixed valid and invalid class names', () => {
      const element = Dom.make('div', ['valid-class', 'py-[theme(spacing.2)]', 'another-valid', 'w-[calc(100%)]']);

      expect(element.classList.contains('valid-class')).toBe(true);
      expect(element.classList.contains('another-valid')).toBe(true);
      expect(element.className.includes('py-[theme(spacing.2)]')).toBe(true);
      expect(element.className.includes('w-[calc(100%)]')).toBe(true);
    });

    it('creates text nodes via text()', () => {
      const node = Dom.text('Blok');

      expect(node.nodeType).toBe(Node.TEXT_NODE);
      expect(node).toHaveTextContent('Blok');
    });
  });

  describe('dom mutations', () => {
    it('appends arrays and fragments via append()', () => {
      const parent = document.createElement('div');
      const first = document.createElement('span');
      const second = document.createElement('span');

      Dom.append(parent, [first, second]);

      expect(parent.children[0]).toBe(first);
      expect(parent.children[1]).toBe(second);
    });

    it('prepends arrays with preserved order via prepend()', () => {
      const parent = document.createElement('div');
      const initial = document.createElement('span');
      const first = document.createElement('span');
      const second = document.createElement('span');

      parent.appendChild(initial);
      Dom.prepend(parent, [first, second]);

      expect(Array.from(parent.children)).toEqual([second, first, initial]);
    });
  });

  describe('selectors', () => {
    it('finds nodes via find, findAll, and get', () => {
      const holder = document.createElement('div');

      holder.id = 'holder';
      holder.innerHTML = '<span data-blok-testid="item">one</span><span data-blok-testid="item">two</span>';
      document.body.appendChild(holder);

      const first = Dom.find(holder, '[data-blok-testid="item"]');

      expect(first?.textContent).toBe('one');
      expect(Dom.findAll(holder, '[data-blok-testid="item"]')).toHaveLength(2);
      expect(Dom.get('holder')).toBe(holder);
    });
  });

  describe('tag helpers', () => {
    it('checks for single or line break tags', () => {
      const br = document.createElement('br');
      const div = document.createElement('div');

      expect(Dom.isSingleTag(br)).toBe(true);
      expect(Dom.isSingleTag(div)).toBe(false);
      expect(Dom.isLineBreakTag(br)).toBe(true);
    });

    it('detects native inputs and contenteditable elements', () => {
      const input = document.createElement('input');
      const textarea = document.createElement('textarea');
      const editable = document.createElement('div');

      editable.contentEditable = 'true';
      input.type = 'text';

      expect(Dom.isNativeInput(input)).toBe(true);
      expect(Dom.isNativeInput(textarea)).toBe(true);
      expect(Dom.isContentEditable(editable)).toBe(true);
      expect(Dom.isContentEditable(document.createElement('div'))).toBe(false);
    });

    it('determines when caret can be placed', () => {
      const textInput = document.createElement('input');
      const fileInput = document.createElement('input');
      const editable = document.createElement('div');

      textInput.type = 'text';
      fileInput.type = 'file';
      editable.contentEditable = 'true';

      expect(Dom.canSetCaret(textInput)).toBe(true);
      expect(Dom.canSetCaret(fileInput)).toBe(false);
      expect(Dom.canSetCaret(editable)).toBe(true);
    });
  });

  describe('inputs discovery', () => {
    it('finds contenteditable descendants and native inputs', () => {
      const holder = document.createElement('div');
      const editableWithBlock = document.createElement('div');
      const editableInlineOnly = document.createElement('div');
      const textarea = document.createElement('textarea');
      const input = document.createElement('input');
      const paragraph = document.createElement('p');
      const inlineSpan = document.createElement('span');

      editableWithBlock.setAttribute('contenteditable', 'true');
      editableInlineOnly.setAttribute('contenteditable', 'true');

      paragraph.textContent = 'Block content';
      inlineSpan.textContent = 'Inline content';

      editableWithBlock.appendChild(paragraph);
      editableInlineOnly.appendChild(inlineSpan);

      input.type = 'text';

      holder.append(editableWithBlock, editableInlineOnly, textarea, input);

      const inputs = Dom.findAllInputs(holder);

      expect(inputs).toContain(textarea);
      expect(inputs).toContain(input);
      expect(inputs).toContain(paragraph);
      expect(inputs).toContain(editableInlineOnly);
    });
  });

  describe('deepest node helpers', () => {
    it('finds deepest nodes from start or end', () => {
      const root = document.createElement('div');
      const wrapper = document.createElement('div');
      const span = document.createElement('span');
      const text = document.createTextNode('Hello');
      const altText = document.createTextNode('World');

      span.appendChild(text);
      wrapper.append(span);
      wrapper.append(altText);
      root.appendChild(wrapper);

      expect(Dom.getDeepestNode(root)).toBe(text);
      expect(Dom.getDeepestNode(root, true)).toBe(altText);
    });

    it('returns the same node for non-element containers', () => {
      const fragment = document.createDocumentFragment();

      expect(Dom.getDeepestNode(fragment)).toBe(fragment);
      expect(Dom.getDeepestNode(null)).toBeNull();
    });
  });

  describe('emptiness checks', () => {
    it('checks individual nodes via isNodeEmpty()', () => {
      const zeroWidthText = document.createTextNode('\u200B');
      const text = document.createTextNode('text');
      const input = document.createElement('input');
      const ignoreText = document.createTextNode('customcustom');

      input.value = 'filled';

      expect(Dom.isNodeEmpty(zeroWidthText)).toBe(true);
      expect(Dom.isNodeEmpty(text)).toBe(false);
      expect(Dom.isNodeEmpty(input)).toBe(false);
      expect(Dom.isNodeEmpty(ignoreText, 'custom')).toBe(true);
    });

    it('checks trees via isEmpty()', () => {
      const wrapper = document.createElement('div');

      wrapper.appendChild(document.createTextNode(' '));
      expect(Dom.isEmpty(wrapper)).toBe(false);
      expect(Dom.isEmpty(wrapper, ' ')).toBe(true);

      wrapper.appendChild(document.createTextNode('filled'));
      expect(Dom.isEmpty(wrapper)).toBe(false);
    });

    it('checks leaf nodes', () => {
      const leaf = document.createElement('span');
      const parent = document.createElement('div');

      parent.appendChild(leaf);

      expect(Dom.isLeaf(leaf)).toBe(true);
      leaf.appendChild(document.createElement('b'));
      expect(Dom.isLeaf(leaf)).toBe(false);
    });
  });

  describe('string and content helpers', () => {
    it('detects HTML strings', () => {
      expect(Dom.isHTMLString('<div></div>')).toBe(true);
      expect(Dom.isHTMLString('plain text')).toBe(false);
    });

    it('returns content lengths', () => {
      const input = document.createElement('input');
      const text = document.createTextNode('abc');
      const span = document.createElement('span');

      input.value = 'value';
      span.textContent = 'longer';

      expect(Dom.getContentLength(input)).toBe(5);
      expect(Dom.getContentLength(text)).toBe(3);
      expect(Dom.getContentLength(span)).toBe(6);
    });
  });

  describe('block helpers', () => {
    it('detects inline-only trees', () => {
      const inline = document.createElement('div');
      const block = document.createElement('div');

      inline.innerHTML = '<span>text</span><b>bold</b>';
      block.innerHTML = '<p>paragraph</p>';

      expect(Dom.containsOnlyInlineElements(inline)).toBe(true);
      expect(Dom.containsOnlyInlineElements(block)).toBe(false);
    });

    it('collects deepest block elements', () => {
      const parent = document.createElement('div');
      const section = document.createElement('section');
      const article = document.createElement('article');
      const span = document.createElement('span');

      span.textContent = 'inline';
      article.appendChild(span);
      section.appendChild(article);
      parent.appendChild(section);

      const blocks = Dom.getDeepestBlockElements(parent);

      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toBe(article);
    });
  });

  describe('holder and anchor helpers', () => {
    it('resolves holders by id or element', () => {
      const el = document.createElement('div');

      el.id = 'holder-element';
      document.body.appendChild(el);

      expect(Dom.getHolder(el)).toBe(el);
      expect(Dom.getHolder('holder-element')).toBe(el);
      expect(() => Dom.getHolder('missing')).toThrow('Element with id "missing" not found');
    });

    it('detects anchors', () => {
      const link = document.createElement('a');
      const div = document.createElement('div');

      expect(Dom.isAnchor(link)).toBe(true);
      expect(Dom.isAnchor(div)).toBe(false);
    });
  });

  describe('geometry helpers', () => {
    it('calculates offsets relative to document', () => {
      const element = document.createElement('div');

      document.body.appendChild(element);
      document.documentElement.scrollLeft = 35;
      document.documentElement.scrollTop = 15;

      const rect: DOMRect = {
        x: 20,
        y: 10,
        width: 100,
        height: 40,
        top: 10,
        left: 20,
        right: 120,
        bottom: 50,
        toJSON() {
          return {};
        },
      };

      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect);

      const offset = Dom.offset(element);

      expect(offset).toEqual({
        top: 25,
        left: 55,
        bottom: 65,
        right: 155,
      });
    });
  });

  describe('text traversal helper', () => {
    it('returns node and offset for given total offset', () => {
      const root = document.createElement('div');
      const text1 = document.createTextNode('Hello ');
      const span = document.createElement('span');
      const text2 = document.createTextNode('world');

      span.appendChild(text2);
      root.append(text1, span);

      const exact = Dom.getNodeByOffset(root, 8);
      const beyond = Dom.getNodeByOffset(root, 999);

      expect(exact.node).toBe(text2);
      expect(exact.offset).toBe(2);
      expect(beyond.node).toBe(text2);
      expect(beyond.offset).toBe(text2.textContent?.length ?? 0);
    });
  });

  describe('standalone helpers', () => {
    it('detects collapsed whitespaces', () => {
      expect(isCollapsedWhitespaces('   ')).toBe(true);
      expect(isCollapsedWhitespaces(' text ')).toBe(false);
    });

    it('calculates baselines using computed styles', () => {
      const element = document.createElement('div');
      const style = {
        fontSize: '20px',
        lineHeight: '30px',
        paddingTop: '4px',
        borderTopWidth: '1px',
        marginTop: '2px',
      } as CSSStyleDeclaration;

      vi.spyOn(window, 'getComputedStyle').mockReturnValue(style);

      const baseline = calculateBaseline(element);

      // marginTop + borderTopWidth + paddingTop + (lineHeight - fontSize)/2 + fontSize * 0.8
      expect(baseline).toBeCloseTo(28);
    });

    it('toggles empty marks based on element content', () => {
      const element = document.createElement('div');

      element.textContent = '';
      toggleEmptyMark(element);
      expect(element).toHaveAttribute('data-blok-empty', 'true');

      element.textContent = 'filled';
      toggleEmptyMark(element);
      expect(element).toHaveAttribute('data-blok-empty', 'false');
    });
  });
});

