import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { buildColumnMenuItems, buildRowMenuItems } from '../../../../src/tools/table/table-row-col-popover';
import type { PopoverMenuOptions } from '../../../../src/tools/table/table-row-col-popover';
import type { RowColAction } from '../../../../src/tools/table/table-row-col-controls';
import { PopoverItemType } from '../../../../src/components/utils/popover';
import type { PopoverItemParams } from '../../../../types/utils/popover/popover-item';
import type { I18n } from '../../../../types/api';

/**
 * The grip menu is Blok's row/column menu. Notion's baseline for it is:
 *
 *   Color · Insert above/below (left/right) · Duplicate · Clear contents · Delete
 *
 * Blok shipped only the two inserts + Delete: Duplicate did not exist anywhere
 * in the table tool, Clear contents was reachable only from the drag-selection
 * pill, and Color was reachable from the grip ONLY through a pill popover that
 * tore the grip popover (and the selection) down as it opened.
 */

const i18nStub: I18n = { t: (key: string) => key, has: () => false } as unknown as I18n;

const createOptions = (overrides: Partial<PopoverMenuOptions> = {}): PopoverMenuOptions => ({
  getColumnCount: () => 3,
  getRowCount: () => 3,
  isHeadingRow: () => false,
  isHeadingColumn: () => false,
  onAction: vi.fn(),
  onClearContents: vi.fn(),
  onColorChange: vi.fn(),
  i18n: i18nStub,
  ...overrides,
});

/** Titles of the actionable (non-separator, non-html) items, in menu order. */
const titles = (items: PopoverItemParams[]): string[] =>
  items
    .filter((item): item is PopoverItemParams & { title: string } => 'title' in item && typeof item.title === 'string')
    .map(item => item.title);

const findByTitle = (items: PopoverItemParams[], title: string): PopoverItemParams | undefined =>
  items.find(item => 'title' in item && item.title === title);

/** The color submenu's Html element (the shared cell color picker). */
const colorPickerElement = (items: PopoverItemParams[]): HTMLElement => {
  const color = findByTitle(items, 'tools.table.cellColor');

  if (color === undefined || !('children' in color)) {
    throw new Error('Color item must expose a nested submenu');
  }

  const child = (color.children?.items ?? [])[0];

  if (child === undefined || child.type !== PopoverItemType.Html) {
    throw new Error('Color submenu must hold an Html item');
  }

  return child.element;
};

/** Activate an actionable item, failing loudly when it has no handler. */
const activate = (items: PopoverItemParams[], title: string): void => {
  const item = findByTitle(items, title);

  if (item === undefined || !('onActivate' in item) || item.onActivate === undefined) {
    throw new Error(`"${title}" must be an activatable item`);
  }

  item.onActivate(item, new PointerEvent('click'));
};

describe('table grip menu (row/column popover items)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('row menu', () => {
    it('offers Color, Insert above/below, Duplicate, Clear contents and Delete', () => {
      const items = buildRowMenuItems(1, createOptions());

      expect(titles(items)).toEqual([
        'tools.table.cellColor',
        'tools.table.insertRowAbove',
        'tools.table.insertRowBelow',
        'tools.table.duplicateRow',
        'tools.table.clearSelection',
        'tools.table.deleteRow',
      ]);
    });

    it('renders Color as a nested submenu carrying the shared cell color picker', () => {
      const picker = colorPickerElement(buildRowMenuItems(1, createOptions()));

      expect(picker.getAttribute('data-blok-testid')).toBe('cell-color-picker');
    });

    it('dispatches duplicate-row with the grip index', () => {
      const onAction = vi.fn<(action: RowColAction) => void>();

      activate(buildRowMenuItems(2, createOptions({ onAction })), 'tools.table.duplicateRow');

      expect(onAction).toHaveBeenCalledWith({ type: 'duplicate-row', index: 2 });
    });

    it.each([
      ['row', buildRowMenuItems],
      ['column', buildColumnMenuItems],
    ])('marks Clear contents in the %s menu as destructive, like the selection menu', (_type, build) => {
      const clear = findByTitle(build(0, createOptions()), 'tools.table.clearSelection');

      expect(clear !== undefined && 'isDestructive' in clear && clear.isDestructive).toBe(true);
    });

    it('dispatches clear-contents over the whole row', () => {
      const onClearContents = vi.fn();

      activate(buildRowMenuItems(2, createOptions({ onClearContents })), 'tools.table.clearSelection');

      expect(onClearContents).toHaveBeenCalledWith('row', 2, 1);
    });

    it('routes the color picker selection to the whole row', () => {
      const onColorChange = vi.fn();
      const picker = colorPickerElement(buildRowMenuItems(1, createOptions({ onColorChange })));

      document.body.appendChild(picker);

      const swatches: HTMLElement[] = Array.from(
        picker.querySelectorAll<HTMLElement>('[data-blok-testid^="cell-color-swatch-backgroundColor-"]')
      );
      const preset = swatches.find(el => !(el.getAttribute('data-blok-testid') ?? '').endsWith('-default'));

      expect(preset).not.toBeUndefined();
      preset?.click();

      expect(onColorChange).toHaveBeenCalledWith('row', 1, expect.any(String), 'backgroundColor', 1);
    });
  });

  describe('grip of a merged cell acts on the whole span', () => {
    it('deletes every merged row, not just the first', () => {
      const onAction = vi.fn<(action: RowColAction) => void>();

      activate(buildRowMenuItems(1, createOptions({ onAction, getRowCount: () => 5 }), 3), 'tools.table.deleteRow');

      expect(onAction).toHaveBeenCalledWith({ type: 'delete-row', index: 1, count: 3 });
    });

    it('inserts above the first merged row and below the last', () => {
      const onAction = vi.fn<(action: RowColAction) => void>();
      const items = buildRowMenuItems(1, createOptions({ onAction }), 3);

      activate(items, 'tools.table.insertRowAbove');
      activate(items, 'tools.table.insertRowBelow');

      expect(onAction).toHaveBeenNthCalledWith(1, { type: 'insert-row-above', index: 1 });
      expect(onAction).toHaveBeenNthCalledWith(2, { type: 'insert-row-below', index: 3 });
    });

    it('inserts left of the first merged column and right of the last', () => {
      const onAction = vi.fn<(action: RowColAction) => void>();
      const items = buildColumnMenuItems(0, createOptions({ onAction }), 2);

      activate(items, 'tools.table.insertColumnLeft');
      activate(items, 'tools.table.insertColumnRight');

      expect(onAction).toHaveBeenNthCalledWith(1, { type: 'insert-col-left', index: 0 });
      expect(onAction).toHaveBeenNthCalledWith(2, { type: 'insert-col-right', index: 1 });
    });

    it('duplicates and deletes every merged column', () => {
      const onAction = vi.fn<(action: RowColAction) => void>();
      const items = buildColumnMenuItems(0, createOptions({ onAction, getColumnCount: () => 4 }), 2);

      activate(items, 'tools.table.duplicateColumn');
      activate(items, 'tools.table.deleteColumn');

      expect(onAction).toHaveBeenNthCalledWith(1, { type: 'duplicate-col', index: 0, count: 2 });
      expect(onAction).toHaveBeenNthCalledWith(2, { type: 'delete-col', index: 0, count: 2 });
    });

    it('disables Delete when the span covers every row', () => {
      const del = findByTitle(buildRowMenuItems(0, createOptions({ getRowCount: () => 3 }), 3), 'tools.table.deleteRow');

      expect(del !== undefined && 'isDisabled' in del && del.isDisabled).toBe(true);
    });

    it('clears and colors every merged row', () => {
      const onClearContents = vi.fn();
      const onColorChange = vi.fn();
      const items = buildRowMenuItems(1, createOptions({ onClearContents, onColorChange }), 3);

      activate(items, 'tools.table.clearSelection');
      expect(onClearContents).toHaveBeenCalledWith('row', 1, 3);

      const picker = colorPickerElement(items);

      document.body.appendChild(picker);
      picker.querySelector<HTMLElement>('[data-blok-testid^="cell-color-swatch-backgroundColor-"]:not([data-blok-testid$="-default"])')?.click();
      picker.remove();

      expect(onColorChange).toHaveBeenCalledWith('row', 1, expect.any(String), 'backgroundColor', 3);
    });
  });

  describe('column menu', () => {
    it('offers Color, Insert left/right, Duplicate, Clear contents and Delete', () => {
      const items = buildColumnMenuItems(1, createOptions());

      expect(titles(items)).toEqual([
        'tools.table.cellColor',
        'tools.table.insertColumnLeft',
        'tools.table.insertColumnRight',
        'tools.table.duplicateColumn',
        'tools.table.clearSelection',
        'tools.table.deleteColumn',
      ]);
    });

    it('dispatches duplicate-col with the grip index', () => {
      const onAction = vi.fn<(action: RowColAction) => void>();

      activate(buildColumnMenuItems(0, createOptions({ onAction })), 'tools.table.duplicateColumn');

      expect(onAction).toHaveBeenCalledWith({ type: 'duplicate-col', index: 0 });
    });

    it('dispatches clear-contents over the whole column', () => {
      const onClearContents = vi.fn();

      activate(buildColumnMenuItems(0, createOptions({ onClearContents })), 'tools.table.clearSelection');

      expect(onClearContents).toHaveBeenCalledWith('col', 0, 1);
    });

    it('keeps the header-column toggle on the first column only', () => {
      const first = buildColumnMenuItems(0, createOptions());
      const second = buildColumnMenuItems(1, createOptions());

      expect(first.some(item => item.type === PopoverItemType.Html)).toBe(true);
      expect(titles(second)).not.toContain('tools.table.headerColumn');
    });
  });
});
