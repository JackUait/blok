import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';
import { PopoverHeader } from '../../../../../src/components/utils/popover/components/popover-header/popover-header';
import { css } from '../../../../../src/components/utils/popover/components/popover-header/popover-header.const';

/**
 * Mutation coverage for PopoverHeader.
 *
 * Every marker the header writes is an EMPTY-STRING attribute value or a
 * class list, so the two observables that discriminate are:
 *
 * 1. `getAttribute(name)` — never `hasAttribute`. A mutant that swaps `''`
 *    for a sentinel still sets the attribute, so `hasAttribute` stays true
 *    for both the original and the mutant.
 * 2. `classList` membership per class token — `Dom.make` splits the class
 *    string on spaces, so an emptied array leaves `className === ''`.
 *
 * No `innerText` assertions: jsdom has no `innerText` on `HTMLElement`, so
 * the constructor's write lands on an expando and `textContent` stays empty.
 *
 * All six recorded mutants are killable; no equivalent mutants in this file.
 */
describe('PopoverHeader mutants', () => {
  const createHeader = (text = 'Section title'): PopoverHeader => new PopoverHeader({
    text,
    onBackButtonClick: vi.fn(),
  });

  const rootOf = (header: PopoverHeader): HTMLElement => {
    const root = header.getElement();

    if (root === null) {
      throw new Error('PopoverHeader produced no root element');
    }

    return root;
  };

  const childOf = (header: PopoverHeader, testid: string): HTMLElement => {
    const child = rootOf(header).querySelector<HTMLElement>(`[data-blok-testid="${testid}"]`);

    if (child === null) {
      throw new Error(`PopoverHeader produced no ${testid} element`);
    }

    return child;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('prefixes the generated title id so it reads as a popover header title', () => {
    const header = createHeader();

    expect(header.getTitleId()).toMatch(/^blok-popover-header-title-.+/);
  });

  it('keeps the title id stable and mirrored onto the text element', () => {
    const header = createHeader();

    expect(childOf(header, 'popover-header-text').id).toBe(header.getTitleId());
  });

  it('puts every root class token on the root element', () => {
    const root = rootOf(createHeader());
    const tokens = css.root.split(' ');

    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.filter((token) => root.classList.contains(token))).toEqual(tokens);
  });

  it('puts every text class token on the text element', () => {
    const text = childOf(createHeader(), 'popover-header-text');
    const tokens = css.text.split(' ');

    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.filter((token) => text.classList.contains(token))).toEqual(tokens);
  });

  it('marks the root with a valueless popover-header attribute', () => {
    const root = rootOf(createHeader());

    expect(root.getAttribute(DATA_ATTR.popoverHeader)).toBe('');
  });

  it('marks the back button with a valueless attribute', () => {
    const backButton = childOf(createHeader(), 'popover-header-back-button');

    expect(backButton.getAttribute(DATA_ATTR.popoverHeaderBackButton)).toBe('');
  });

  it('marks the text element with a valueless attribute', () => {
    const text = childOf(createHeader(), 'popover-header-text');

    expect(text.getAttribute(DATA_ATTR.popoverHeaderText)).toBe('');
  });
});
