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
 * Thirteen mutants in this file survive, every one of them measured against a
 * differential harness (the original module and each mutated copy run over the
 * same ~4000 inputs — every caret position, non-collapsed selections, selection
 * outside the element, multi-text-node and empty elements — with zero
 * differences in return value, text, caret or DOM shape):
 *
 * - `?? ''` on `textContent` in removeTab: an element's textContent is never
 *   null; and that writer uses the text only to count leading spaces, which is
 *   zero for `''` and for any placeholder that does not begin with a space.
 * - dropping the start anchor from the two leading-whitespace patterns: a
 *   zero-or-more pattern already matches at position 0, so the unanchored form
 *   finds the same match.
 * - `indentMatch ? … : ''`: that match can never be null, for the same reason.
 * - the three mutants on `before.length > 0 ? before.charAt(before.length - 1)
 *   : ''`: `charAt(-1)` is `''`, which is what the false arm returns, and the
 *   replacement string is not a key of BRACKET_PAIRS either way.
 * - `if (!selection) return` in restoreCaretOffset: both callers read the same
 *   global and return before calling it, and `window.getSelection()` is never
 *   null in a document that has a defaultView.
 * - the accumulate-and-recurse arithmetic and `offset - accumulated` in
 *   restoreCaretOffset: both writers rebuild the element into exactly ONE text
 *   node before calling it and pass an offset inside that node (the caller adds
 *   at most what it just inserted and at least what it just removed), so the
 *   walk succeeds on its first step — `accumulated` is 0 wherever
 *   `offset - accumulated` runs, and the recursion is entered only once the
 *   walker is exhausted, where `findNode` returns before it reads its argument.
 * - forcing `expectedCloser !== undefined` true in the betweenMatchedPair test:
 *   the other operand still compares the following character against
 *   `undefined`, which no character equals.
 * - `collapse(false)` at either call site: `setStart`/`setStartAfter` put the
 *   new start after the range's end, which the DOM resolves by moving the end
 *   onto it, so the range is already collapsed and both directions are the
 *   same operation (measured on jsdom).
 *
 * `selection.removeAllRanges()` in insertTab is not equivalent but has no
 * behavioral consequence in jsdom: the selection holds this very Range object,
 * so mutating it already moved the caret (measured — the second `addRange` is
 * ignored, not applied, and the caret lands either way). Its test therefore
 * pins the call itself, which the spec requires before `addRange`.
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

  describe('a null text read', () => {
    /**
     * No live element returns null from `textContent`, so stubbing the getter is
     * the only way to reach the `?? ''` arms. What the arms must do is treat the
     * read as EMPTY — a placeholder fallback is written straight into the block,
     * and the length it reports decides whether the caret walk lands.
     */
    it('inserts a newline over a null read as nothing, not as a placeholder', () => {
      const el = makeCode('ab', 1);

      vi.spyOn(Node.prototype, 'textContent', 'get').mockReturnValue(null);

      press(el, 'Enter');

      expect(el.firstChild?.nodeValue).toBe('\n');
    });

    it('gives up on the caret walk when a null read measures zero, without throwing', () => {
      const el = makeCode('ab', 1);

      vi.spyOn(Node.prototype, 'textContent', 'get').mockReturnValue(null);

      expect(press(el, 'Enter')).toBe(true);
    });
  });

  describe('the selection the tab is inserted into', () => {
    it('clears the range the selection already holds before adding the new one', () => {
      const el = makeCode('hello', 2);
      const selection = window.getSelection();

      if (selection === null) {
        throw new Error('the document has no selection to spy on');
      }

      const removeAllRanges = vi.spyOn(selection, 'removeAllRanges');

      press(el, 'Tab');

      /**
       * `addRange` is specified as a no-op while the selection already holds a
       * range, so the old one is dropped first. jsdom keeps this Range object
       * live, which is why the caret lands either way here and only the call
       * itself is observable.
       */
      expect(removeAllRanges).toHaveBeenCalledTimes(1);
    });
  });
});
