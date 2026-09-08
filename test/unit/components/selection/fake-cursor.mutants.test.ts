import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DATA_ATTR, createSelector } from '../../../../src/components/constants';
import { SelectionFakeCursor } from '../../../../src/components/selection/fake-cursor';

/**
 * Mutant notes for src/components/selection/fake-cursor.ts
 *
 * Every recorded mutant is killed; no equivalence claims.
 */

const selectRange = (node: Node, start: number, end: number): void => {
  const range = document.createRange();

  range.setStart(node, start);
  range.setEnd(node, end);

  const selection = window.getSelection();

  if (selection === null) {
    throw new Error('jsdom returned no selection');
  }

  selection.removeAllRanges();
  selection.addRange(range);
};

const firstTextNode = (host: HTMLElement): Text => {
  const node = host.firstChild;

  if (!(node instanceof Text)) {
    throw new Error('fixture did not render a text node');
  }

  return node;
};

describe('SelectionFakeCursor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('drops the marker at the end of a non-collapsed selection', () => {
    const host = document.createElement('div');

    host.textContent = 'hello';
    document.body.appendChild(host);

    selectRange(firstTextNode(host), 1, 4);

    SelectionFakeCursor.addFakeCursor();

    const marker = host.querySelector(createSelector(DATA_ATTR.fakeCursor));

    if (marker === null) {
      throw new Error('no fake cursor was inserted');
    }

    expect(marker.previousSibling?.textContent).toBe('hell');
    expect(marker.nextSibling?.textContent).toBe('o');
    expect(marker.getAttribute('data-blok-mutation-free')).toBe('true');
  });

  it('finds and removes the marker it inserted', () => {
    const host = document.createElement('div');

    host.textContent = 'abc';
    document.body.appendChild(host);

    selectRange(firstTextNode(host), 3, 3);

    SelectionFakeCursor.addFakeCursor();

    expect(SelectionFakeCursor.isFakeCursorInsideContainer(host)).toBe(true);

    SelectionFakeCursor.removeFakeCursor(host);

    expect(SelectionFakeCursor.isFakeCursorInsideContainer(host)).toBe(false);
  });
});
