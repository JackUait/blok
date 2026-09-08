import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { SelectionNavigation } from '../../../../src/components/selection/navigation';

interface Bounds {
  anchorNode: Node | null;
  focusNode: Node | null;
}

/** The DOM cannot produce a half-set selection; the guard exists for one. */
const selecting = (bounds: Bounds | null): void => {
  vi.spyOn(window, 'getSelection').mockReturnValue(bounds as Selection | null);
};

const tree = (html: string): HTMLElement => {
  const host = document.createElement('div');

  host.innerHTML = html;
  document.body.appendChild(host);

  return host;
};

const required = (host: HTMLElement, selector: string): HTMLElement => {
  const found = host.querySelector<HTMLElement>(selector);

  if (found === null) {
    throw new Error(`no ${selector} in the fixture`);
  }

  return found;
};

/**
 * One survivor is equivalent: the node-type half of the "is this node itself
 * the match" test. Only an Element carries a tagName at all, so the tag
 * comparison beside it is already false for every node the type test would
 * have rejected.
 */
describe('selection navigation mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('answers nothing when there is no selection to walk from', () => {
    selecting(null);

    expect(SelectionNavigation.findParentTag('B')).toBeNull();
  });

  it('answers nothing when either end of the selection is missing', () => {
    const host = tree('<b class="x">text</b>');
    const bold = required(host, 'b');

    selecting({ anchorNode: null, focusNode: bold });

    expect(SelectionNavigation.findParentTag('B', 'x')).toBeNull();

    selecting({ anchorNode: bold, focusNode: null });

    expect(SelectionNavigation.findParentTag('B', 'x')).toBeNull();
  });

  it('matches the selected node itself, class and all', () => {
    const host = tree('<div><b class="x">text</b></div>');
    const bold = required(host, 'b');

    selecting({ anchorNode: bold, focusNode: bold });

    expect(SelectionNavigation.findParentTag('B', 'x')).toBe(bold);
  });

  it('matches an ancestor of the selected node, class and all', () => {
    const host = tree('<div><b class="x">text</b></div>');
    const bold = required(host, 'b');
    const text = bold.firstChild;

    selecting({ anchorNode: text, focusNode: text });

    expect(SelectionNavigation.findParentTag('B', 'x')).toBe(bold);
  });

  // At the last step of the walk the parent test is the only one left: one more
  // level of recursion would run out of depth before it could look again.
  it('matches the last ancestor the search depth allows', () => {
    const host = tree('<div><b class="x">text</b></div>');
    const bold = required(host, 'b');
    const text = bold.firstChild;

    selecting({ anchorNode: text, focusNode: text });

    expect(SelectionNavigation.findParentTag('B', 'x', 1)).toBe(bold);
  });

  it('refuses a tag whose class does not match', () => {
    const host = tree('<div><b class="y">text</b></div>');
    const text = required(host, 'b').firstChild;

    selecting({ anchorNode: text, focusNode: text });

    expect(SelectionNavigation.findParentTag('B', 'x')).toBeNull();
  });
});
