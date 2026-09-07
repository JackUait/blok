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
});
