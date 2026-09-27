import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TableRowColControls } from '../../../../src/tools/table/table-row-col-controls';

const ROW_ATTR = 'data-blok-table-row';
const CELL_ATTR = 'data-blok-table-cell';
const GRIP_COL_ATTR = 'data-blok-table-grip-col';
const GRIP_ROW_ATTR = 'data-blok-table-grip-row';
const GRIP_VISIBLE_ATTR = 'data-blok-table-grip-visible';

const mockI18n = {
  t: vi.fn((key: string) => key),
  has: vi.fn(() => false),
  getEnglishTranslation: vi.fn((key: string) => key),
  getLocale: vi.fn(() => 'en'),
};

/**
 * tbody > tr > td table. Rows are `rowHeight` tall, cells 100px wide.
 */
const buildTable = (rows: number, cols: number, rowHeight: number): HTMLTableElement => {
  const table = document.createElement('table');
  const colgroup = document.createElement('colgroup');

  Array.from({ length: cols }).forEach(() => {
    const col = document.createElement('col');

    Object.defineProperty(col, 'offsetWidth', { value: 100, configurable: true });
    colgroup.appendChild(col);
  });
  table.appendChild(colgroup);

  const tbody = document.createElement('tbody');

  Array.from({ length: rows }).forEach((_, r) => {
    const tr = document.createElement('tr');

    tr.setAttribute(ROW_ATTR, '');
    Object.defineProperty(tr, 'offsetTop', { value: r * rowHeight, configurable: true });
    Object.defineProperty(tr, 'offsetHeight', { value: rowHeight, configurable: true });
    tr.getBoundingClientRect = (): DOMRect => new DOMRect(0, r * rowHeight, cols * 100, rowHeight);

    Array.from({ length: cols }).forEach((__, c) => {
      const td = document.createElement('td');

      td.setAttribute(CELL_ATTR, '');
      td.setAttribute('data-blok-table-cell-row', String(r));
      td.setAttribute('data-blok-table-cell-col', String(c));
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  return table;
};

const cellAt = (table: HTMLTableElement, r: number, c: number): HTMLElement => {
  const cell = table.querySelector<HTMLElement>(
    `:scope > tbody > tr > [data-blok-table-cell-row="${r}"][data-blok-table-cell-col="${c}"]`
  );

  if (cell === null) {
    throw new Error(`missing cell ${r},${c}`);
  }

  return cell;
};

/**
 * Outer 3x2 table (rows 100px) with an inner 3x2 table (rows 30px) in the
 * outer cell at `host`.
 */
const buildNested = (host: [number, number]): { outer: HTMLTableElement; inner: HTMLTableElement } => {
  const outer = buildTable(3, 2, 100);
  const inner = buildTable(3, 2, 30);
  const blocksContainer = document.createElement('div');

  blocksContainer.appendChild(inner);
  cellAt(outer, host[0], host[1]).appendChild(blocksContainer);
  outer.getBoundingClientRect = (): DOMRect => new DOMRect(0, 0, 200, 300);
  document.body.appendChild(outer);

  return { outer, inner };
};

const mount = (grid: HTMLElement): TableRowColControls => new TableRowColControls({
  grid,
  getColumnCount: () => 2,
  getRowCount: () => 3,
  isHeadingRow: () => false,
  isHeadingColumn: () => false,
  onAction: vi.fn(),
  onClearContents: vi.fn(),
  onColorChange: vi.fn(),
  i18n: mockI18n,
});

const visible = (grid: HTMLElement, attr: string): string[] =>
  Array.from(grid.querySelectorAll<HTMLElement>(`[${attr}][${GRIP_VISIBLE_ATTR}]`))
    .map(g => g.getAttribute(attr) ?? '');

describe('TableRowColControls with a nested table inside an outer cell', () => {
  let outer: HTMLTableElement | null = null;
  let controls: TableRowColControls | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    outer = null;
    controls = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    controls?.destroy();
    outer?.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('centres each outer row grip on its own outer row', () => {
    ({ outer } = buildNested([0, 0]));
    controls = mount(outer);

    const tops = Array.from(outer.querySelectorAll<HTMLElement>(`[${GRIP_ROW_ATTR}]`)).map(g => g.style.top);

    expect(tops).toEqual(['50px', '150px', '250px']);
  });

  it('watches only outer rows for height changes', () => {
    const observed: Element[] = [];

    class FakeResizeObserver {
      public observe = (target: Element): void => {
        observed.push(target);
      };
      public unobserve = (): void => undefined;
      public disconnect = (): void => undefined;
    }

    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    ({ outer } = buildNested([0, 0]));
    controls = mount(outer);

    expect(observed).toEqual(Array.from(outer.querySelectorAll(':scope > tbody > tr')));
  });

  it('picks the outer row under the pointer inside an outer rowspan', () => {
    ({ outer } = buildNested([0, 1]));

    const origin = cellAt(outer, 1, 0);

    if (!(origin instanceof HTMLTableCellElement)) {
      throw new Error('origin is not a td');
    }

    origin.rowSpan = 2;
    cellAt(outer, 2, 0).remove();
    controls = mount(outer);

    origin.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 50, clientY: 150 }));

    expect(visible(outer, GRIP_ROW_ATTR)).toEqual(['1']);
  });

  it('shows the grips of the outer cell that holds the hovered inner cell', () => {
    let inner: HTMLTableElement;

    ({ outer, inner } = buildNested([1, 0]));
    controls = mount(outer);

    cellAt(inner, 2, 1).dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 50, clientY: 150 }));

    expect(visible(outer, GRIP_ROW_ATTR)).toEqual(['1']);
    expect(visible(outer, GRIP_COL_ATTR)).toEqual(['0']);
  });

  it('shows the outer cell grips when a locked grip is released over an inner cell', () => {
    let inner: HTMLTableElement;

    ({ outer, inner } = buildNested([1, 0]));
    controls = mount(outer);
    controls.setActiveGrip('row', 2);

    cellAt(inner, 2, 1).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 150 }));

    expect(visible(outer, GRIP_ROW_ATTR)).toEqual(['1']);
    expect(visible(outer, GRIP_COL_ATTR)).toEqual(['0']);
  });
});
