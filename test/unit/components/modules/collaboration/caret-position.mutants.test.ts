/**
 * Caret-position mutants the existing suite did not notice.
 *
 * Most of them are provably equivalent, and they cluster on two facts.
 *
 * `Node.contains(null)` is false - the IDL argument is nullable and the spec
 * answers "not an inclusive descendant". That makes every null guard in
 * `readCaretPosition` redundant with a check further down:
 *
 * - line 74, all five mutants (the whole condition, either half, the operator,
 *   and the empty block). Dropping the early return lets a null focus node fall
 *   through to `inputs.findIndex(... input.contains(focusNode))`, which answers
 *   -1 for every input, so `inputs[-1]` is undefined and line 82 returns null
 *   anyway. The operator swap is narrower still: `focusNode` is
 *   `selection?.focusNode ?? null`, so `selection === null` already implies
 *   `focusNode === null` and the two disjuncts can never disagree in the
 *   direction that matters.
 * - line 92, `anchorNode !== null` replaced by `true`. The remaining conjunct
 *   `input.contains(anchorNode)` is false for a null anchor, so the ternary
 *   still collapses the anchor onto the head. A hand-built Selection stand-in
 *   with a null anchor beside a non-null focus would tell the two apart, but no
 *   real Selection is ever in that state - it holds either no range, and both
 *   are null, or a range, and neither is - and the only caller
 *   (src/components/modules/collaboration/index.ts) passes
 *   `window.getSelection()`.
 *
 * The other three:
 *
 * - line 106, `typeof value === 'number'` replaced by `true`. `Number.isInteger`
 *   answers false for every non-number, so the dropped conjunct was implied by
 *   the one after it.
 * - line 162, `range.collapse(true)` flipped to `false`. A fresh
 *   `document.createRange()` starts at (document, 0), and `setStart` on any node
 *   in the document - or in a detached tree, where the roots differ - moves the
 *   end to the new start. The range is already collapsed, so which end it
 *   collapses onto is not a choice.
 * - line 187, both mutants of `if (range === null)` in `measureLine`.
 *   `resolveCaretRange` returns its range on both of its paths and never null,
 *   so the guard is unreachable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  measureLine,
  readCaret,
  readCaretPosition,
  resolveCaretRange,
} from '../../../../../src/components/modules/collaboration/caret-position';

const mounted: HTMLElement[] = [];

/**
 * A contenteditable input holding `html`, mounted so a live Selection can
 * address it.
 * @param html - the input markup
 */
const makeInput = (html: string): HTMLElement => {
  const input = document.createElement('div');

  input.contentEditable = 'true';
  input.innerHTML = html;
  document.body.appendChild(input);
  mounted.push(input);

  return input;
};

/** The live selection, with every range cleared, so its focus node is null. */
const emptySelection = (): Selection => {
  const selection = window.getSelection();

  if (selection === null) {
    throw new Error('jsdom provided no Selection');
  }

  selection.removeAllRanges();

  return selection;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
  mounted.forEach((element) => element.remove());
  mounted.length = 0;
});

describe('readCaret rejects what it cannot destructure', () => {
  it('rejects undefined without throwing', () => {
    // The wire field is absent far more often than it is malformed, and
    // destructuring undefined is a TypeError, not a rejected caret.
    expect(readCaret(undefined)).toBeNull();
  });

  it('rejects a bare string', () => {
    expect(readCaret('block-1')).toBeNull();
  });

  it('rejects a bare number', () => {
    expect(readCaret(7)).toBeNull();
  });
});

describe('resolveCaretRange in an input with no text', () => {
  it('sits at the start of an input whose only child is a line break', () => {
    const input = makeInput('<br>');
    const range = resolveCaretRange(input, 0);

    // An empty paragraph still holds a `br`, so the input has a child and the
    // two ends of its contents are no longer the same position: the caret
    // belongs before the break, not after it.
    expect(range?.startContainer).toBe(input);
    expect(range?.startOffset).toBe(0);
    expect(range?.collapsed).toBe(true);
  });
});

describe('readCaretPosition with nothing to name', () => {
  it('publishes nothing for a selection that holds no range', () => {
    const input = makeInput('hello');

    expect(readCaretPosition('block-1', [input], emptySelection())).toBeNull();
  });

  it('publishes nothing when the block has no inputs at all', () => {
    expect(readCaretPosition('block-1', [], emptySelection())).toBeNull();
  });
});

describe('measureLine', () => {
  it('measures an offset inside a mounted input', () => {
    const input = makeInput('hello');

    // jsdom has no layout, so every rect is zero - what this pins is that the
    // offset resolves to something measurable at all.
    expect(measureLine(input, 2)).toEqual({
      left: 0,
      top: 0,
      height: 0,
    });
  });
});
