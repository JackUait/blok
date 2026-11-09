import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MutationHandler } from '../../../../src/components/block/mutation-handler';
import { foldTitleRow, planTitleRowFold } from '../../../../src/tools/database/database-view-bar-fold';

/**
 * One view: the toolbar shares the title row. With the side peek open Notion's
 * row (374–732) keeps only Settings and New beside "New database" (peek-top.png).
 * Blok folds when the toolbar would run over the title; Notion's exact switch
 * points for this row are not measured.
 */
describe('planTitleRowFold', () => {
  const parts = (width: number): Parameters<typeof planTitleRowFold>[0] => ({ width, lead: 204, toolbar: { full: 243, noIcons: 103 } });

  it('keeps every icon while the whole toolbar fits beside the title', () => {
    expect(planTitleRowFold(parts(447))).toStrictEqual({ icons: true, newButton: true });
  });

  it('drops the icon group, keeping Settings and New, once it would run over the title', () => {
    expect(planTitleRowFold(parts(446))).toStrictEqual({ icons: false, newButton: true });
    expect(planTitleRowFold(parts(307))).toStrictEqual({ icons: false, newButton: true });
  });

  it('drops New last', () => {
    expect(planTitleRowFold(parts(306))).toStrictEqual({ icons: false, newButton: false });
  });
});

describe('foldTitleRow', () => {
  let row: HTMLElement;
  let wrapper: HTMLElement;

  const sized = <T extends HTMLElement>(el: T, width: () => number, prop: 'offsetWidth' | 'scrollWidth' = 'offsetWidth'): T => {
    Object.defineProperty(el, prop, { configurable: true, get: width });

    return el;
  };

  const mount = (rowWidth: number): void => {
    row = document.createElement('div');
    row.setAttribute('data-blok-database-title-row', '');
    row.setAttribute('data-single-view', '');
    Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => rowWidth });
    // The title is squeezed to 80 in the row; its text needs 156.
    const title = sized(sized(document.createElement('div'), () => 80), () => 156, 'scrollWidth');
    const add = sized(document.createElement('button'), () => 24);
    // The icon group hides under the row's mark, unless a probe says otherwise.
    const toolbar: HTMLElement = document.createElement('div');

    sized(toolbar, () => {
      const probe = toolbar.getAttribute('data-blok-database-fold-probe');
      const folded = probe === null ? row.hasAttribute('data-blok-database-fold-icons') : probe === 'no-icons';

      return folded ? 103 : 243;
    });

    title.setAttribute('data-blok-database-title', '');
    add.setAttribute('data-blok-database-add-view', '');
    toolbar.setAttribute('data-blok-database-view-toolbar', '');
    // As DatabaseViewControls draws it.
    toolbar.setAttribute('data-blok-mutation-free', 'true');
    row.append(title, add, toolbar);
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

  it('marks the row when the toolbar would cover the title, measuring the title at its full text width', () => {
    mount(358);
    foldTitleRow(row);

    expect(row.hasAttribute('data-blok-database-fold-icons')).toBe(true);
    expect(row.hasAttribute('data-blok-database-fold-new')).toBe(false);
  });

  // The selection bar lies over the row (position absolute) while rows are picked; it takes no room.
  it('leaves out children taken out of the row, such as the selection bar', () => {
    mount(474);
    const bar = sized(document.createElement('div'), () => 500);

    bar.style.position = 'absolute';
    row.insertBefore(bar, row.lastElementChild);
    foldTitleRow(row);

    expect(row.hasAttribute('data-blok-database-fold-icons')).toBe(false);
  });

  it('clears the marks once the row is wide again', () => {
    mount(358);
    foldTitleRow(row);
    Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => 474 });
    foldTitleRow(row);

    expect(row.hasAttribute('data-blok-database-fold-icons')).toBe(false);
    expect(row.hasAttribute('data-blok-database-fold-new')).toBe(false);
  });

  // A resize that keeps the fold (the side peek sliding) must save nothing.
  it.each([
    ['folded', 358],
    ['unfolded', 474],
  ])('refolding a %s row to the same marks is not a block change', (_state, width) => {
    mount(width);
    foldTitleRow(row);
    const observer = new MutationObserver(() => undefined);

    observer.observe(wrapper, { subtree: true, attributes: true, childList: true, characterData: true });
    foldTitleRow(row);
    const records = observer.takeRecords();

    observer.disconnect();

    expect(new MutationHandler(() => wrapper, null, () => undefined).handleMutation(records).shouldFireUpdate).toBe(false);
  });
});
