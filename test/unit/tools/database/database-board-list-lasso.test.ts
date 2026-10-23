import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DatabaseBoardView } from '../../../../src/tools/database/database-board-view';
import { DatabaseListView } from '../../../../src/tools/database/database-list-view';
import type { DatabaseRow, PropertyDefinition, SelectOption } from '../../../../src/tools/database/types';
import type { I18n } from '../../../../types';

/** research/35:237-238: a drag box picks board cards and list rows, not the database block. */

type Band = { left: number; top: number; right: number; bottom: number };

const i18n: I18n = {
  t: (key: string) => key,
  has: () => true,
  getEnglishTranslation: () => '',
  getLocale: () => 'en',
};

const schema: PropertyDefinition[] = [
  { id: 'title', name: 'Title', type: 'title', position: 'a0' },
  { id: 's', name: 'Status', type: 'select', position: 'a1' },
];
const row = (id: string): DatabaseRow => ({ id, position: id, properties: { title: id } });
const options: SelectOption[] = [{ id: 'o1', label: 'One', position: 'a0' }, { id: 'o2', label: 'Two', position: 'a1' }];

const rect = (el: Element, left: number, top: number, width: number, height: number): void => {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
  });
};

const lasso = (owner: Element | null, band: Band | null): CustomEvent => {
  const event = new CustomEvent('blok-lasso', { cancelable: true, detail: { rect: band } });

  owner?.dispatchEvent(event);

  return event;
};

const pointer = (type: string, target: EventTarget, x: number, y: number): void => {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1 }));
};

const item = (root: HTMLElement, rowId: string): HTMLElement => {
  const el = root.querySelector<HTMLElement>(`[data-row-id="${rowId}"]:is([data-blok-database-card], [data-blok-database-list-row])`);

  if (el === null) throw new Error(`no item ${rowId}`);

  return el;
};

describe('board and list take a lasso', () => {
  let root: HTMLElement | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    root?.remove();
    root = null;
    vi.restoreAllMocks();
  });

  describe('list', () => {
    const mount = (lassoRows?: (ids: string[]) => void, grouped = false): HTMLElement => {
      const view = new DatabaseListView({
        readOnly: lassoRows === undefined, i18n, rows: [row('r1'), row('r2'), row('r3')], titlePropertyId: 'title', schema, visiblePropertyIds: [],
        ...(grouped ? { options, getRows: (id: string) => (id === 'o1' ? [row('r1'), row('r2')] : [row('r3')]), collapsedGroupIds: new Set(['o2']) } : {}),
        ...(lassoRows !== undefined ? { lassoRows } : {}),
      });

      root = view.createView();
      document.body.appendChild(root);

      return root;
    };

    it('a margin lasso picks every row it touches and keeps the database block unselected', () => {
      const lassoRows = vi.fn();
      const list = mount(lassoRows);

      ['r1', 'r2', 'r3'].forEach((id, i) => rect(item(list, id), 0, i * 30, 700, 26));
      const event = lasso(list, { left: 600, top: 10, right: 760, bottom: 40 });

      expect(lassoRows).toHaveBeenLastCalledWith(['r1', 'r2']);
      expect(event.defaultPrevented).toBe(true);
    });

    it('skips rows of a collapsed group', () => {
      const lassoRows = vi.fn();
      const list = mount(lassoRows, true);

      ['r1', 'r2', 'r3'].forEach((id, i) => rect(item(list, id), 0, i * 30, 700, 26));
      lasso(list, { left: 0, top: 0, right: 760, bottom: 200 });

      expect(lassoRows).toHaveBeenLastCalledWith(['r1', 'r2']);
    });

    it('drops its picks when the band leaves for other blocks', () => {
      const lassoRows = vi.fn();

      lasso(mount(lassoRows), null);

      expect(lassoRows).toHaveBeenLastCalledWith([]);
    });

    it('leaves the band to core when read-only', () => {
      const list = mount();

      expect(list.hasAttribute('data-blok-selection-owner')).toBe(false);
      expect(lasso(list, { left: 0, top: 0, right: 500, bottom: 500 }).defaultPrevented).toBe(false);
    });
  });

  describe('board', () => {
    const mount = (lassoRows?: (ids: string[]) => void): HTMLElement => {
      const view = new DatabaseBoardView({
        readOnly: lassoRows === undefined, i18n, options, titlePropertyId: 'title', schema,
        getRows: (id) => (id === 'o1' ? [row('r1'), row('r2')] : [row('r3')]),
        ...(lassoRows !== undefined ? { lassoRows } : {}),
      });

      root = view.createView();
      document.body.appendChild(root);
      // r1 above r2 in the first column, r3 in the second.
      rect(item(root, 'r1'), 0, 40, 260, 90);
      rect(item(root, 'r2'), 0, 140, 260, 90);
      rect(item(root, 'r3'), 280, 40, 260, 90);

      return root;
    };
    const area = (board: HTMLElement): HTMLElement => {
      const el = board.querySelector<HTMLElement>('[data-blok-database-board]');

      if (el === null) throw new Error('no board area');

      return el;
    };
    const column = (board: HTMLElement): HTMLElement => {
      const el = board.querySelector<HTMLElement>('[data-blok-database-column]');

      if (el === null) throw new Error('no column');

      return el;
    };
    const box = (board: HTMLElement): HTMLElement | null => board.querySelector('[data-blok-database-board-lasso]');

    it('a margin lasso picks every card it touches and keeps the database block unselected', () => {
      const lassoRows = vi.fn();
      const board = mount(lassoRows);
      const event = lasso(area(board), { left: -40, top: 100, right: 300, bottom: 160 });

      expect(lassoRows).toHaveBeenLastCalledWith(['r1', 'r2', 'r3']);
      expect(event.defaultPrevented).toBe(true);
    });

    it('a drag box from empty board space picks every card it touches, then goes away', () => {
      const lassoRows = vi.fn();
      const board = mount(lassoRows);

      pointer('pointerdown', column(board), 270, 300);
      pointer('pointermove', document, 250, 200);
      expect(box(board)).not.toBeNull();
      pointer('pointermove', document, 200, 180);
      pointer('pointerup', document, 200, 180);

      expect(lassoRows).toHaveBeenLastCalledWith(['r2']);
      expect(box(board)).toBeNull();
    });

    it('a drag box stops the text selection the drag would start', () => {
      const board = mount(vi.fn());

      pointer('pointerdown', column(board), 270, 300);
      const selectStart = new Event('selectstart', { bubbles: true, cancelable: true });

      column(board).dispatchEvent(selectStart);
      pointer('pointerup', document, 270, 300);

      expect(selectStart.defaultPrevented).toBe(true);
    });

    it('a press on a card or a press without a drag picks nothing', () => {
      const lassoRows = vi.fn();
      const board = mount(lassoRows);

      pointer('pointerdown', item(board, 'r1'), 10, 50);
      pointer('pointermove', document, 300, 300);
      pointer('pointerup', document, 300, 300);
      pointer('pointerdown', column(board), 270, 300);
      pointer('pointerup', document, 271, 300);

      expect(lassoRows).not.toHaveBeenCalled();
      expect(box(board)).toBeNull();
    });

    it('leaves the band to core when read-only', () => {
      const board = mount();

      expect(board.querySelector('[data-blok-selection-owner]')).toBeNull();
      expect(lasso(area(board), { left: 0, top: 0, right: 500, bottom: 500 }).defaultPrevented).toBe(false);
    });
  });
});
