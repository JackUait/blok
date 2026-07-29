import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

/**
 * Notion's corner drag appends ordinary columns: a table dragged wider keeps the
 * column width it was created with. Blok's insert-column paths deliberately use
 * `initialColWidth / 2` (see types.ts), which made a corner drag lay down two
 * half columns for every column's worth of travel.
 *
 * Documented behaviour: "To add just columns, drag outward to the right"
 * — notion.com/help/columns-headings-and-dividers
 */

const createMockAPI = (): API => {
  return {
    styles: { block: 'blok-block' },
    i18n: { t: (key: string) => key },
    blocks: {
      delete: () => {},
      insert: () => {
        const holder = document.createElement('div');

        holder.setAttribute('data-blok-id', `mock-${Math.random().toString(36).slice(2, 8)}`);

        return { id: `mock-${Math.random().toString(36).slice(2, 8)}`, holder };
      },
      getById: () => null,
      getChildren: () => [],
      getCurrentBlockIndex: () => 0,
      getBlocksCount: () => 0,
      getBlockIndex: () => undefined,
      setBlockParent: vi.fn(),
      beginTransaction: vi.fn(),
      endTransaction: vi.fn(),
    },
    events: { on: vi.fn(),
      off: vi.fn() },
  } as unknown as API;
};

const createOptions = (data: Partial<TableData>): BlockToolConstructorOptions<TableData, TableConfig> => ({
  data: { withHeadings: false,
    withHeadingColumn: false,
    content: [],
    ...data },
  config: {},
  api: createMockAPI(),
  readOnly: false,
  block: { id: 'table-block',
    stretched: false,
    dispatchChange: vi.fn() } as never,
});

/**
 * jsdom computes no layout, so the drag is fed a fixed non-zero box. The grid
 * never appears to widen, which stops the walk after exactly one column.
 */
const stubLayout = (): void => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 240,
    height: 60,
    right: 240,
    bottom: 60,
    toJSON: () => ({}),
  });
};

describe('corner drag column width', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('appends a column at the table\'s own width, not half of it', () => {
    const table = new Table(createOptions({
      content: [['A', 'B'], ['C', 'D']],
      colWidths: [120, 120],
      initialColWidth: 120,
    }));
    const element = table.render();

    document.body.appendChild(element);
    table.rendered();

    stubLayout();

    const hitZone = element.querySelector('[data-blok-table-corner-drag]');

    if (!(hitZone instanceof HTMLElement)) {
      throw new Error('corner drag hit zone not rendered');
    }

    hitZone.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100,
      clientY: 100,
      pointerId: 1,
      bubbles: true }));
    hitZone.dispatchEvent(new PointerEvent('pointermove', { clientX: 260,
      clientY: 100,
      pointerId: 1,
      bubbles: true }));
    hitZone.dispatchEvent(new PointerEvent('pointerup', { clientX: 260,
      clientY: 100,
      pointerId: 1,
      bubbles: true }));

    const saved = table.save(element);

    expect(saved.colWidths).toEqual([120, 120, 120]);

    document.body.removeChild(element);
  });
});
