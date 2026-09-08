import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { handleCodeKeydown } from '../../../../src/tools/code/code-keyboard';

const makeCode = (text: string, caret?: number): HTMLElement => {
  const el = document.createElement('code');

  el.contentEditable = 'true';
  el.textContent = text;
  document.body.appendChild(el);

  if (caret !== undefined) {
    const node = el.firstChild;
    const range = document.createRange();

    if (node !== null) {
      range.setStart(node, caret);
    } else {
      range.setStart(el, 0);
    }
    range.collapse(true);

    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  return el;
};

const selectIn = (el: HTMLElement, start: number, end: number): void => {
  const node = el.firstChild;

  if (node === null) {
    throw new Error('nothing to select');
  }

  const range = document.createRange();

  range.setStart(node, start);
  range.setEnd(node, end);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);
};

const caretIn = (el: HTMLElement): number => {
  const selection = window.getSelection();

  if (selection === null || selection.rangeCount === 0) {
    return -1;
  }

  const range = selection.getRangeAt(0);
  const pre = range.cloneRange();

  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);

  return pre.toString().length;
};

const key = (name: string, shiftKey = false): KeyboardEvent =>
  new KeyboardEvent('keydown', { key: name, shiftKey });

const press = (el: HTMLElement, name: string, shiftKey = false, onExit = vi.fn()): boolean =>
  handleCodeKeydown(key(name, shiftKey), el, onExit);

/**
 * Eighteen mutants in this file survive, and the sweep confirmed every one:
 *
 * - `?? ''` on `textContent` (three of them): an element's textContent and a
 *   text node's textContent are always strings, never null.
 * - dropping the start anchor from the two leading-whitespace patterns: a
 *   zero-or-more pattern already matches at position 0, so the unanchored form
 *   finds the same match.
 * - `indentMatch ? … : ''`: that match can never be null, for the same reason.
 * - the three mutants on `before.length > 0 ? before.charAt(before.length - 1)
 *   : ''`: `charAt(-1)` is `''`, which is what the false arm returns, and the
 *   replacement string is not a key of BRACKET_PAIRS either way.
 * - `if (!selection) return` in restoreCaretOffset: `window.getSelection()` is
 *   never null in a document that has a defaultView.
 * - every remaining mutant in restoreCaretOffset (`!current`, the
 *   accumulate-and-recurse arithmetic, `collapse(false)`, and the
 *   `accumulated + nodeLength >= offset` widening): both writers rebuild the
 *   element into exactly ONE text node before calling it, and both pass an
 *   offset inside that node — so the walk always succeeds on its first step and
 *   the recursion is dead.
 * - forcing `expectedCloser !== undefined` true in the betweenMatchedPair test:
 *   the other operand still compares the following character against
 *   `undefined`, which no character equals.
 * - `collapse(true)` in insertTab: `setStartAfter` has already pushed the start
 *   past the end, and the DOM collapses the end onto it, so both directions
 *   collapse to the same point.
 *
 * One is not equivalent, only unkillable HERE: dropping
 * `selection.removeAllRanges()` in insertTab. The spec says `addRange` is a
 * no-op while a range exists, which would strand the caret; jsdom replaces the
 * range instead, so the removal has no observable effect in this environment.
 */
describe('code keyboard mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  describe('key routing', () => {
    it('leaves an ordinary key alone', () => {
      const el = makeCode('hello', 5);

      expect(press(el, 'a')).toBe(false);
      expect(el.textContent).toBe('hello');
    });

    it('leaves a shifted ordinary key alone', () => {
      const el = makeCode('hello', 5);

      expect(press(el, 'a', true)).toBe(false);
      expect(el.textContent).toBe('hello');
    });

    it('exits on Shift+Enter without touching the text', () => {
      const el = makeCode('hello', 5);
      const onExit = vi.fn();

      expect(press(el, 'Enter', true, onExit)).toBe(true);
      expect(onExit).toHaveBeenCalledTimes(1);
      expect(el.textContent).toBe('hello');
    });
  });

  describe('bracket expansion', () => {
    it.each([
      ['{', '}'],
      ['(', ')'],
      ['[', ']'],
    ])('opens %s onto three lines when its closer follows the caret', (opener, closer) => {
      const el = makeCode(`${opener}${closer}`, 1);

      press(el, 'Enter');

      expect(el.textContent).toBe(`${opener}\n  \n${closer}`);
      expect(caretIn(el)).toBe(4);
    });

    // The closer only has to be the next CHARACTER, not the rest of the text.
    it('expands even when more text follows the closer', () => {
      const el = makeCode('{}x', 1);

      press(el, 'Enter');

      expect(el.textContent).toBe('{\n  \n}x');
    });

    it('indents once after an opener with no closer ahead', () => {
      const el = makeCode('{x', 1);

      press(el, 'Enter');

      expect(el.textContent).toBe('{\n  x');
    });

    it('adds no indent at all when no bracket precedes the caret', () => {
      const el = makeCode('ab', 1);

      press(el, 'Enter');

      expect(el.textContent).toBe('a\nb');
    });
  });

  describe('caret offsets are measured from the code element', () => {
    it('ignores text that precedes the element in the document', () => {
      const lead = document.createElement('p');

      lead.textContent = 'ABC';
      document.body.appendChild(lead);

      const el = makeCode('hello', 2);

      press(el, 'Enter');

      expect(el.textContent).toBe('he\nllo');
    });
  });

  describe('Tab', () => {
    it('replaces the selected text', () => {
      const el = makeCode('hello');

      selectIn(el, 1, 4);
      press(el, 'Tab');

      expect(el.textContent).toBe('h  o');
    });

    it('leaves the caret after the inserted spaces', () => {
      const el = makeCode('hello', 2);

      press(el, 'Tab');

      expect(el.textContent).toBe('he  llo');
      expect(caretIn(el)).toBe(4);
    });
  });

  describe('Shift+Tab', () => {
    it('removes at most one indent unit, never the whole run', () => {
      const el = makeCode('    abc', 7);

      press(el, 'Tab', true);

      expect(el.textContent).toBe('  abc');
    });

    it('works on the line the caret is on, not on the whole text', () => {
      const el = makeCode('a\n  b', 5);

      press(el, 'Tab', true);

      expect(el.textContent).toBe('a\nb');
    });

    it('reads the line from the caret, not from the end of the text', () => {
      const el = makeCode('  a\n  b', 2);

      press(el, 'Tab', true);

      expect(el.textContent).toBe('a\n  b');
    });

    it('treats a caret sitting just before a newline as being on the earlier line', () => {
      const el = makeCode('  a\n  b', 3);

      press(el, 'Tab', true);

      expect(el.textContent).toBe('a\n  b');
    });

    it('pulls the caret back by exactly what it removed', () => {
      const el = makeCode('  abcdef', 8);

      press(el, 'Tab', true);

      expect(el.textContent).toBe('abcdef');
      expect(caretIn(el)).toBe(6);
    });

    it('never pulls the caret before the start of its line', () => {
      const el = makeCode('    abc', 1);

      press(el, 'Tab', true);

      expect(caretIn(el)).toBe(0);
    });

    it('leaves the element untouched when the line has no indent', () => {
      const el = document.createElement('code');

      el.appendChild(document.createTextNode('abc'));
      el.appendChild(document.createTextNode('def'));
      document.body.appendChild(el);

      const range = document.createRange();

      range.setStart(el.childNodes[1], 1);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      press(el, 'Tab', true);

      expect(el.childNodes).toHaveLength(2);
      expect(el.textContent).toBe('abcdef');
    });
  });

  describe('with no selection at all', () => {
    it.each(['Enter', 'Tab'])('%s leaves the text alone', (name) => {
      const el = makeCode('  hello');

      window.getSelection()?.removeAllRanges();

      expect(press(el, name)).toBe(true);
      expect(el.textContent).toBe('  hello');
    });

    it('Shift+Tab leaves the text alone', () => {
      const el = makeCode('  hello');

      window.getSelection()?.removeAllRanges();

      expect(press(el, 'Tab', true)).toBe(true);
      expect(el.textContent).toBe('  hello');
    });
  });
});
