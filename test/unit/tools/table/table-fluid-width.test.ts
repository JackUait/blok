import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import { MIN_COL_WIDTH } from '../../../../src/tools/table/table-core';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

/**
 * Percent-mode ("fluid") tables use `table-layout: fixed` + `width: 100%` +
 * equal percent <col>s. Without a floor, a 20-column table renders 20 columns
 * at 5% each — unreadable — and, because the scroll container's overflow was
 * gated on colWidths, it could not even scroll. Every pasted wide table lands
 * in this regime (onPaste clears colWidths).
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
    },
    events: { on: vi.fn(),
      off: vi.fn() },
  } as unknown as API;
};

const createOptions = (
  data: Partial<TableData>,
  readOnly = false
): BlockToolConstructorOptions<TableData, TableConfig> => ({
  data: { withHeadings: false,
    withHeadingColumn: false,
    content: [],
    ...data } as TableData,
  config: {},
  api: createMockAPI(),
  readOnly,
  block: { id: 'table-block',
    stretched: false,
    dispatchChange: vi.fn() } as never,
});

const wideContent = (cols: number): string[][] => [
  Array.from({ length: cols }, (_, i) => `H${i}`),
  Array.from({ length: cols }, (_, i) => `C${i}`),
];

describe('Table fluid (percent) width mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('gives a 20-column percent table a per-column minimum width', () => {
    const tool = new Table(createOptions({ content: wideContent(20) }));
    const element = tool.render();

    document.body.appendChild(element);
    tool.rendered();

    const grid = element.querySelector('table') as HTMLTableElement;

    expect(grid.style.minWidth).toBe(`${20 * MIN_COL_WIDTH}px`);
  });

  it('gives a wide percent table a horizontal scroll container', () => {
    const tool = new Table(createOptions({ content: wideContent(20) }));
    const element = tool.render();

    document.body.appendChild(element);
    tool.rendered();

    const scroll = element.querySelector('[data-blok-table-scroll]');

    expect(scroll).not.toBeNull();
    expect(scroll?.classList.contains('overflow-x-auto')).toBe(true);
  });

  it('gives a read-only percent table a scroll container too', () => {
    const tool = new Table(createOptions({ content: wideContent(20) }, true));
    const element = tool.render();

    document.body.appendChild(element);
    tool.rendered();

    const scroll = element.querySelector('[data-blok-table-scroll]');

    expect(scroll).not.toBeNull();
    expect(scroll?.classList.contains('overflow-x-auto')).toBe(true);

    const grid = element.querySelector('table') as HTMLTableElement;

    expect(grid.style.minWidth).toBe(`${20 * MIN_COL_WIDTH}px`);
  });

  it('drops the min-width when the table switches to pixel widths', () => {
    const tool = new Table(createOptions({ content: wideContent(3),
      colWidths: [200, 200, 200] }));
    const element = tool.render();

    document.body.appendChild(element);
    tool.rendered();

    const grid = element.querySelector('table') as HTMLTableElement;

    expect(grid.style.minWidth).toBe('');
    expect(grid.style.width).toBe('601px');
  });
});
