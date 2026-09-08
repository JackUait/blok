import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { SelectionCursor } from '../../../../src/components/selection/cursor';

/**
 * Mutant notes for src/components/selection/cursor.ts
 *
 * PROVEN EQUIVALENT — CallExpression removal of `range.setEnd(element, offset)`
 * on line 37.
 * `document.createRange()` returns a range whose start AND end are (document, 0).
 * The `range.setStart(element, offset)` on the line above therefore always moves
 * the end too: per the DOM spec, setStart sets the end to the new start whenever
 * the new start is after the current end or their roots differ, and (document, 0)
 * precedes every boundary point inside the document. Verified in this jsdom for
 * an attached element, a detached text node and document.body: the range reads
 * `collapsed === true` with `endContainer` already equal to the new start before
 * setEnd runs. So setEnd can only rewrite the end to the value it already has.
 */

const flush = (): void => {
  document.body.innerHTML = '';
};

describe('SelectionCursor.setCursor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flush();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    flush();
  });

  it('focuses a native input and places its caret at the offset', () => {
    const textarea = document.createElement('textarea');

    textarea.value = 'hello';
    document.body.appendChild(textarea);

    expect(textarea).not.toHaveFocus();

    SelectionCursor.setCursor(textarea, 2);

    expect(textarea).toHaveFocus();
    expect(textarea.selectionStart).toBe(2);
    expect(textarea.selectionEnd).toBe(2);
  });

  it('moves DOM focus to the contenteditable ancestor of a non-editable element', () => {
    const host = document.createElement('div');

    host.setAttribute('contenteditable', 'true');
    host.innerHTML = '<b>hello</b>';
    document.body.appendChild(host);

    const inline = host.querySelector('b');

    if (!(inline instanceof HTMLElement)) {
      throw new Error('fixture did not render the inline element');
    }

    SelectionCursor.setCursor(inline, 0);

    expect(host).toHaveFocus();
  });

  it('leaves a collapsed selection at the requested boundary', () => {
    const host = document.createElement('div');

    host.setAttribute('contenteditable', 'true');
    host.innerHTML = '<b>a</b><i>b</i>';
    document.body.appendChild(host);

    SelectionCursor.setCursor(host, 1);

    const selection = window.getSelection();

    if (selection === null) {
      throw new Error('jsdom returned no selection');
    }

    expect(selection.rangeCount).toBe(1);

    const range = selection.getRangeAt(0);

    expect(range.collapsed).toBe(true);
    expect(range.startContainer).toBe(host);
    expect(range.startOffset).toBe(1);
    expect(range.endContainer).toBe(host);
    expect(range.endOffset).toBe(1);
  });
});
