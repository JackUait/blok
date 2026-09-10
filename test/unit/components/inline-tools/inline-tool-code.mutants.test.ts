import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { CodeInlineTool } from '../../../../src/components/inline-tools/inline-tool-code';
import type { PopoverItemDefaultBaseParams } from '../../../../types/utils/popover';

const ZERO_WIDTH = '​';

interface Fixture {
  host: HTMLElement;
  activate: () => void;
  isActive: () => boolean;
}

const mount = (html: string): Fixture => {
  const tool = new CodeInlineTool();
  const config = tool.render() as PopoverItemDefaultBaseParams;
  const host = document.createElement('div');

  host.contentEditable = 'true';
  host.innerHTML = html;
  document.body.appendChild(host);

  const { onActivate, isActive } = config;

  if (typeof onActivate !== 'function' || typeof isActive !== 'function') {
    throw new Error('the code tool did not expose its callbacks');
  }

  return {
    host,
    activate: () => onActivate(config),
    isActive: () => isActive(),
  };
};

/** The text node holding `text`, wherever it sits under `root`. */
const textNodeOf = (root: Node, text: string): Text => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.textContent === text) {
      return node as Text;
    }
  }

  throw new Error(`no text node holding ${JSON.stringify(text)}`);
};

const select = (node: Node, start: number, end: number): void => {
  const range = document.createRange();

  range.setStart(node, start);
  range.setEnd(node, end);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);
};

/** Host whose content is built node by node — innerHTML drops empty text nodes. */
const mountBuilt = (build: (host: HTMLElement) => void): { host: HTMLElement; activate: () => void } => {
  const tool = new CodeInlineTool();
  const config = tool.render() as PopoverItemDefaultBaseParams;
  const host = document.createElement('div');

  document.body.appendChild(host);
  build(host);

  const { onActivate } = config;

  if (typeof onActivate !== 'function') {
    throw new Error('the code tool did not expose its activate callback');
  }

  return { host, activate: () => onActivate(config) };
};

/** Makes every `window.getSelection()` after the first one return null. */
const hideSelectionAfterFirstCall = (): void => {
  const live = window.getSelection.bind(window);
  let calls = 0;

  vi.spyOn(window, 'getSelection').mockImplementation(() => {
    calls += 1;

    return calls === 1 ? live() : null;
  });
};

const putCaret = (node: Node, offset: number): void => select(node, offset, offset);

describe('CodeInlineTool mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  describe('a collapsed caret', () => {
    it('opens an empty code span at the caret', () => {
      const { host, activate } = mount('plain text');

      putCaret(textNodeOf(host, 'plain text'), 5);
      activate();

      const code = host.querySelector('code');

      expect(code).not.toBeNull();
      expect(code?.textContent).toBe(ZERO_WIDTH);
      expect(host.textContent).toBe(`plain${ZERO_WIDTH} text`);
    });

    it('leaves the caret inside the new code span', () => {
      const { host, activate } = mount('plain text');

      putCaret(textNodeOf(host, 'plain text'), 5);
      activate();

      const selection = window.getSelection();
      const code = host.querySelector('code');

      expect(selection?.rangeCount).toBe(1);
      expect(code?.contains(selection?.getRangeAt(0).startContainer ?? null)).toBe(true);
      expect(selection?.getRangeAt(0).collapsed).toBe(true);
    });

    it('steps out of a code span it is already inside', () => {
      const { host, activate } = mount('a<code>bcd</code>e');

      putCaret(textNodeOf(host, 'bcd'), 2);
      activate();

      const selection = window.getSelection();
      const caretNode = selection?.getRangeAt(0).startContainer ?? null;

      expect(host.querySelector('code')?.contains(caretNode)).toBe(false);
      expect(host.textContent).toBe(`abc${ZERO_WIDTH}de`);
    });

    it('does nothing without a selection', () => {
      const { host, activate } = mount('plain text');

      window.getSelection()?.removeAllRanges();
      activate();

      expect(host.innerHTML).toBe('plain text');
    });
  });

  describe('a ranged selection', () => {
    it('wraps the selected text in a code span', () => {
      const { host, activate } = mount('alpha beta');

      select(textNodeOf(host, 'alpha beta'), 0, 5);
      activate();

      expect(host.querySelector('code')?.textContent).toBe('alpha');
      expect(host.textContent).toBe('alpha beta');
    });

    it('unwraps a fully selected code span', () => {
      const { host, activate } = mount('a<code>bcd</code>e');

      select(textNodeOf(host, 'bcd'), 0, 3);
      activate();

      expect(host.querySelector('code')).toBeNull();
      expect(host.textContent).toBe('abcde');
    });

    it('flattens a code span nested inside the selection', () => {
      const { host, activate } = mount('<code>one<code>two</code>three</code>');

      select(host, 0, host.childNodes.length);
      activate();

      expect(host.querySelectorAll('code')).toHaveLength(0);
      expect(host.textContent).toBe('onetwothree');
    });
  });

  describe('splitting a code span around the unwrapped part', () => {
    it('drops the span when its whole content is unwrapped', () => {
      const { host, activate } = mount('a<code>bcd</code>e');

      select(textNodeOf(host, 'bcd'), 0, 3);
      activate();

      expect(host.innerHTML).not.toContain('<code>');
      expect(host.textContent).toBe('abcde');
    });

    it('lifts the leading part out in front of the span', () => {
      const { host, activate } = mount('a<code>bcd</code>e');

      select(textNodeOf(host, 'bcd'), 0, 1);
      activate();

      const code = host.querySelector('code');

      expect(code?.textContent).toBe('cd');
      expect(host.textContent).toBe('abcde');
      expect(code?.previousSibling?.textContent).toBe('b');
    });

    it('lifts the trailing part out behind the span', () => {
      const { host, activate } = mount('a<code>bcd</code>e');

      select(textNodeOf(host, 'bcd'), 2, 3);
      activate();

      const code = host.querySelector('code');

      expect(code?.textContent).toBe('bc');
      expect(host.textContent).toBe('abcde');
      expect(code?.nextSibling?.textContent).toBe('d');
    });

    it('splits the span in two around a middle part', () => {
      const { host, activate } = mount('a<code>bcd</code>e');

      select(textNodeOf(host, 'bcd'), 1, 2);
      activate();

      const codes = host.querySelectorAll('code');

      expect(codes).toHaveLength(2);
      expect(codes[0].textContent).toBe('b');
      expect(codes[1].textContent).toBe('d');
      expect(host.textContent).toBe('abcde');
    });
  });

  describe('isActive', () => {
    it('is true for a caret inside a code span', () => {
      const { host, isActive } = mount('a<code>bcd</code>e');

      putCaret(textNodeOf(host, 'bcd'), 2);

      expect(isActive()).toBe(true);
    });

    it('is false for a caret in plain text', () => {
      const { host, isActive } = mount('a<code>bcd</code>e');

      putCaret(textNodeOf(host, 'e'), 0);

      expect(isActive()).toBe(false);
    });

    it('is false with no selection at all', () => {
      const { isActive } = mount('a<code>bcd</code>e');

      window.getSelection()?.removeAllRanges();

      expect(isActive()).toBe(false);
    });
  });

  describe('a whitespace-only gap between two code spans', () => {
    it('unwraps both spans instead of wrapping the gap', () => {
      const { host, activate } = mount('<code>a</code> <code>b</code>');

      select(host, 0, host.childNodes.length);
      activate();

      expect(host.querySelectorAll('code')).toHaveLength(0);
      expect(host.innerHTML).toBe('a b');
    });

    it('counts as active', () => {
      const { host, isActive } = mount('<code>a</code> <code>b</code>');

      select(host, 0, host.childNodes.length);

      expect(isActive()).toBe(true);
    });
  });

  describe('the selection left behind', () => {
    it('sits after the zero-width space when stepping out of a code span', () => {
      const { host, activate } = mount('a<code>bcd</code>e');

      putCaret(textNodeOf(host, 'bcd'), 2);
      activate();

      const selection = window.getSelection();
      const range = selection?.getRangeAt(0);
      const zeroWidth = textNodeOf(host, ZERO_WIDTH);

      expect(selection?.rangeCount).toBe(1);
      expect(range?.startContainer).toBe(zeroWidth);
      expect(range?.startOffset).toBe(1);
      expect(range?.endContainer).toBe(zeroWidth);
      expect(range?.endOffset).toBe(1);
    });

    it('spans the text it unwrapped', () => {
      const { host, activate } = mount('a<code>bcd</code>e');

      select(textNodeOf(host, 'bcd'), 1, 3);
      activate();

      const selection = window.getSelection();
      const range = selection?.getRangeAt(0);

      expect(host.innerHTML).toBe('a<code>b</code>cde');
      expect(selection?.rangeCount).toBe(1);
      expect(range?.startContainer).toBe(host);
      expect(range?.startOffset).toBe(2);
      expect(range?.endContainer).toBe(host);
      expect(range?.endOffset).toBe(3);
      expect(range?.toString()).toBe('cd');
    });

    it('covers the contents of the code span it created', () => {
      const { host, activate } = mount('a&nbsp;bc');

      select(textNodeOf(host, 'a\u00A0bc'), 0, 4);
      activate();

      const selection = window.getSelection();
      const range = selection?.getRangeAt(0);
      const code = host.querySelector('code');

      expect(host.innerHTML).toBe('<code>a bc</code>');
      expect(selection?.rangeCount).toBe(1);
      expect(range?.startContainer).toBe(code);
      expect(range?.startOffset).toBe(0);
      expect(range?.endOffset).toBe(code?.childNodes.length ?? -1);
    });
  });

  describe('wrapping a selection that holds a code span', () => {
    it('flattens the inner span instead of nesting code in code', () => {
      const { host, activate } = mount('a<code>b</code>c');

      select(host, 0, host.childNodes.length);
      activate();

      expect(host.innerHTML).toBe('<code>abc</code>');
      expect(host.querySelectorAll('code')).toHaveLength(1);
    });
  });

  describe('unwrapping a code span whose only child is another element', () => {
    it('drops the emptied span and keeps the wrapper it split off', () => {
      const { host, activate } = mount('<code><span>a</span></code>');

      select(textNodeOf(host, 'a'), 0, 1);
      activate();

      expect(host.innerHTML).toBe('a<code></code>');
    });
  });

  describe('a code span holding an empty text node', () => {
    it('drops the empty node before deciding where the marker sits', () => {
      const { host, activate } = mountBuilt((root) => {
        const outer = document.createElement('code');
        const inner = document.createElement('code');

        inner.append(document.createTextNode(''), document.createTextNode('x'));
        outer.appendChild(inner);
        root.appendChild(outer);
      });

      select(textNodeOf(host, 'x'), 0, 1);
      activate();

      expect(host.innerHTML).toBe('x');
    });
  });

  describe('unwrapping inside a code span that wraps another one', () => {
    it('moves the content out of the inner span', () => {
      const { host, activate } = mount('<code>a<code>b</code></code>');

      select(textNodeOf(host, 'b'), 0, 1);
      activate();

      expect(host.innerHTML).toBe('<code>a</code>b');
    });

    it('moves the content out through both spans', () => {
      const { host, activate } = mount('<code><code>x</code></code>');

      select(textNodeOf(host, 'x'), 0, 1);
      activate();

      expect(host.innerHTML).toBe('x');
    });

    it('lifts both spans out while keeping the text that followed them', () => {
      const { host, activate } = mount('<code><code>x</code></code>y');

      select(textNodeOf(host, 'x'), 0, 1);
      activate();

      expect(host.innerHTML).toBe('xy');
    });

    it('splits the inner span without leaving a stray span behind', () => {
      const { host, activate } = mount('<code>a<code>bcd</code></code>');

      select(textNodeOf(host, 'bcd'), 0, 2);
      activate();

      expect(host.innerHTML).toBe('<code>a</code>bc<code><code>d</code></code>');
    });

    it('moves a selection that runs past the inner span out of the outer one', () => {
      const { host, activate } = mount('<code>ab<code>cd</code>ef</code>');
      const range = document.createRange();

      range.setStart(textNodeOf(host, 'cd'), 0);
      range.setEnd(host, host.childNodes.length);

      const selection = window.getSelection();

      selection?.removeAllRanges();
      selection?.addRange(range);
      activate();

      expect(host.innerHTML).toBe('<code>ab</code>cdef');
    });
  });

  describe('a code span holding an empty element', () => {
    it('keeps the empty element while moving the marker out', () => {
      const { host, activate } = mountBuilt((root) => {
        const code = document.createElement('code');

        code.append(document.createTextNode('b'), document.createElement('span'), document.createTextNode('cd'));
        root.appendChild(code);
      });

      select(textNodeOf(host, 'cd'), 0, 2);
      activate();

      expect(host.innerHTML).toBe('<code>b<span></span></code>cd');
    });
  });

  describe('a selection that disappears while the tool runs', () => {
    it('wraps without touching a selection that has gone', () => {
      const { host, activate } = mount('alpha, beta');

      select(textNodeOf(host, 'alpha, beta'), 0, 5);

      hideSelectionAfterFirstCall();

      expect(() => {
        activate();
      }).not.toThrow();
      expect(host.innerHTML).toBe('<code>alpha</code>, beta');
    });

    it('unwraps without touching a selection that has gone', () => {
      const { host, activate } = mount('a<code>bcd</code>e');

      select(textNodeOf(host, 'bcd'), 0, 3);

      hideSelectionAfterFirstCall();

      expect(() => {
        activate();
      }).not.toThrow();
      expect(host.innerHTML).toBe('a<code>bcd</code>e');
    });
  });
});
