import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MutationHandler } from '../../../../src/components/block/mutation-handler';
import { foldTitleRow, planTitleRowFold } from '../../../../src/tools/database/database-view-bar-fold';

/**
 * One view: the toolbar shares the title row. Notion folds it at fixed widths of
 * the database block (notion-motion.md, Round 6 "Toolbar fold points"): the icon
 * group goes below 480, New below 320, and the title truncates instead.
 */
describe('planTitleRowFold', () => {
  it('keeps every icon from 480 up', () => {
    expect(planTitleRowFold(480)).toStrictEqual({ icons: true, newButton: true });
  });

  it('drops the whole icon group at 479, keeping Settings and New, with room to spare', () => {
    expect(planTitleRowFold(479)).toStrictEqual({ icons: false, newButton: true });
    expect(planTitleRowFold(320)).toStrictEqual({ icons: false, newButton: true });
  });

  it('drops New below 320', () => {
    expect(planTitleRowFold(319)).toStrictEqual({ icons: false, newButton: false });
  });
});

describe('foldTitleRow', () => {
  let row: HTMLElement;
  let wrapper: HTMLElement;
  let toolbar: HTMLElement;

  const mount = (rowWidth: number): void => {
    row = document.createElement('div');
    row.setAttribute('data-blok-database-title-row', '');
    row.setAttribute('data-single-view', '');
    Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => rowWidth });
    const title = document.createElement('div');
    // A title far wider than the row: it truncates, it does not fold the toolbar.
    Object.defineProperty(title, 'scrollWidth', { configurable: true, get: () => 900 });
    toolbar = document.createElement('div');
    title.setAttribute('data-blok-database-title', '');
    toolbar.setAttribute('data-blok-database-view-toolbar', '');
    // As DatabaseViewControls draws it.
    toolbar.setAttribute('data-blok-mutation-free', 'true');
    row.append(title, toolbar);
    wrapper = document.createElement('div');
    wrapper.appendChild(row);
    document.body.appendChild(wrapper);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    wrapper.remove();
    vi.restoreAllMocks();
  });

  it('folds by the row width, not by the title', () => {
    mount(480);
    foldTitleRow(row);

    expect(toolbar.hasAttribute('data-blok-database-fold-icons')).toBe(false);
    expect(toolbar.hasAttribute('data-blok-database-fold-new')).toBe(false);
  });

  it('marks the toolbar below the switch points', () => {
    mount(358);
    foldTitleRow(row);

    expect(toolbar.hasAttribute('data-blok-database-fold-icons')).toBe(true);
    expect(toolbar.hasAttribute('data-blok-database-fold-new')).toBe(false);
  });

  it('clears the marks once the row is wide again', () => {
    mount(358);
    foldTitleRow(row);
    Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => 500 });
    foldTitleRow(row);

    expect(toolbar.hasAttribute('data-blok-database-fold-icons')).toBe(false);
    expect(toolbar.hasAttribute('data-blok-database-fold-new')).toBe(false);
  });

  // A resize that keeps the fold (the side peek sliding) must save nothing.
  it.each([
    ['folded', 358],
    ['unfolded', 500],
  ])('refolding a %s row to the same marks is not a block change', (_state, width) => {
    mount(width);
    foldTitleRow(row);
    const observer = new MutationObserver(() => undefined);

    observer.observe(wrapper, { subtree: true, attributes: true, childList: true, characterData: true });
    foldTitleRow(row);
    const records = observer.takeRecords();

    observer.disconnect();

    // No record at all: the block's observer is never woken.
    expect(records).toStrictEqual([]);
  });

  // Crossing the switch point folds the toolbar for real; that is chrome too.
  it.each([
    ['folds', 500, 358],
    ['unfolds', 358, 500],
  ])('a row that %s on a resize is not a block change', (_change, from, to) => {
    mount(from);
    foldTitleRow(row);
    const before = toolbar.hasAttribute('data-blok-database-fold-icons');

    Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => to });
    const observer = new MutationObserver(() => undefined);

    observer.observe(wrapper, { subtree: true, attributes: true, childList: true, characterData: true });
    foldTitleRow(row);
    const records = observer.takeRecords();

    observer.disconnect();

    expect(new MutationHandler(() => wrapper, null, () => undefined).handleMutation(records).shouldFireUpdate).toBe(false);
    expect(toolbar.hasAttribute('data-blok-database-fold-icons')).toBe(!before);
  });
});
