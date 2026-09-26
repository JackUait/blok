import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import { CELL_ATTR, CELL_COL_ATTR, CELL_ROW_ATTR } from '../../../../src/tools/table/table-core';
import type { TableModel } from '../../../../src/tools/table/table-model';
import type { TableData, TableConfig } from '../../../../src/tools/table/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

const createMockAPI = (): API => ({
  styles: {
    block: 'blok-block',
    inlineToolbar: 'blok-inline-toolbar',
    inlineToolButton: 'blok-inline-tool-button',
    inlineToolButtonActive: 'blok-inline-tool-button--active',
    input: 'blok-input',
    loader: 'blok-loader',
    button: 'blok-button',
    settingsButton: 'blok-settings-button',
    settingsButtonActive: 'blok-settings-button--active',
  },
  i18n: { t: (key: string) => key },
  blocks: {
    insert: vi.fn().mockImplementation(() => {
      const holder = document.createElement('div');
      const id = `mock-${Math.random().toString(36).slice(2, 8)}`;

      holder.setAttribute('data-blok-id', id);

      return { id, holder };
    }),
    delete: vi.fn(),
    getById: vi.fn().mockReturnValue(null),
    getChildren: vi.fn().mockReturnValue([]),
    getCurrentBlockIndex: vi.fn().mockReturnValue(0),
    getBlockIndex: vi.fn().mockReturnValue(undefined),
    getBlocksCount: vi.fn().mockReturnValue(0),
    setBlockParent: vi.fn(),
  },
  events: { on: vi.fn(), off: vi.fn() },
  toolbar: { close: vi.fn() },
} as unknown as API);

const createTable = (data: TableData): { table: Table; gridEl: HTMLElement } => {
  const options: BlockToolConstructorOptions<TableData, TableConfig> = {
    data,
    config: {},
    api: createMockAPI(),
    readOnly: false,
    block: { id: 'merge-audit-structure' } as never,
  };

  const table = new Table(options);
  const element = table.render();

  document.body.appendChild(element);
  table.rendered();

  const scrollContainer = element.firstElementChild as HTMLElement;
  const gridEl = scrollContainer.firstElementChild as HTMLElement;

  return { table, gridEl };
};

const getModel = (table: Table): TableModel =>
  (table as unknown as { model: TableModel }).model;

interface CornerDragHooks {
  onAddRow: () => void;
  onAddColumn: () => void;
  onRemoveLastRow: () => void;
  onRemoveLastColumn: () => void;
  canRemoveLastRow: () => boolean;
  canRemoveLastColumn: () => boolean;
}

interface AddControlsHooks {
  onDragAddRow: () => boolean;
  onDragRemoveRow: () => boolean;
  onDragAddCol: () => boolean;
  onDragRemoveCol: () => boolean;
}

const cornerDragOf = (table: Table): CornerDragHooks => {
  const subsystems = (table as unknown as { subsystems: { cornerDrag: CornerDragHooks | null } }).subsystems;

  if (subsystems.cornerDrag === null) {
    throw new Error('corner drag not initialised');
  }

  return subsystems.cornerDrag;
};

const addControlsOf = (table: Table): AddControlsHooks => {
  const subsystems = (table as unknown as { subsystems: { addControls: AddControlsHooks | null } }).subsystems;

  if (subsystems.addControls === null) {
    throw new Error('add controls not initialised');
  }

  return subsystems.addControls;
};

const cellsOf = (gridEl: HTMLElement): HTMLTableCellElement[] =>
  Array.from(gridEl.querySelectorAll<HTMLTableCellElement>(`[${CELL_ATTR}]`));

interface RenderedCell { row: number; col: number; colSpan: number; rowSpan: number }

const renderedCells = (gridEl: HTMLElement): RenderedCell[] => cellsOf(gridEl).map(cell => ({
  row: Number(cell.getAttribute(CELL_ROW_ATTR)),
  col: Number(cell.getAttribute(CELL_COL_ATTR)),
  colSpan: cell.colSpan || 1,
  rowSpan: cell.rowSpan || 1,
}));

const expectedCells = (model: TableModel): RenderedCell[] => {
  const expected: RenderedCell[] = [];

  Array.from({ length: model.rows }).forEach((_, r) => {
    Array.from({ length: model.cols }).forEach((__, c) => {
      if (model.isSpannedCell(r, c)) {
        return;
      }

      const span = model.getCellSpan(r, c);

      expected.push({ row: r, col: c, colSpan: span.colspan, rowSpan: span.rowspan });
    });
  });

  return expected;
};

const expectDomMatchesModel = (gridEl: HTMLElement, model: TableModel): void => {
  expect(renderedCells(gridEl)).toEqual(expectedCells(model));
};

/**
 * 3x3, column 0 merges rows 0-1 (origin [0,0], rowspan 2). Last column empty.
 */
const rowspanInFirstColumn = (): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  content: [
    [{ blocks: [], rowspan: 2 }, { blocks: [] }, { blocks: [] }],
    [{ blocks: [], mergedInto: [0, 0] }, { blocks: [] }, { blocks: [] }],
    [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
  ],
});

/**
 * 3x3, column 1 merges rows 1-2 (origin [1,1], rowspan 2) — the merge reaches the LAST row.
 */
const rowspanReachingLastRow = (): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  content: [
    [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
    [{ blocks: [] }, { blocks: [], rowspan: 2 }, { blocks: [] }],
    [{ blocks: [] }, { blocks: [], mergedInto: [1, 1] }, { blocks: [] }],
  ],
});

/**
 * 3x3, row 1 merges columns 1-2 (origin [1,1], colspan 2) — the merge reaches the LAST column.
 */
const colspanReachingLastColumn = (): TableData => ({
  withHeadings: false,
  withHeadingColumn: false,
  content: [
    [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
    [{ blocks: [] }, { blocks: [], colspan: 2 }, { blocks: [], mergedInto: [1, 1] }],
    [{ blocks: [] }, { blocks: [] }, { blocks: [] }],
  ],
});

describe('merge audit: edge add/remove gestures on a merged grid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('corner-drag removing the last column leaves no stray cell in a row shortened by a rowspan', () => {
    const { table, gridEl } = createTable(rowspanInFirstColumn());
    const model = getModel(table);
    const corner = cornerDragOf(table);

    expect(corner.canRemoveLastColumn()).toBe(true);
    corner.onRemoveLastColumn();

    expect(model.cols).toBe(2);
    // No <td> may still claim logical column 2.
    expect(gridEl.querySelectorAll(`[${CELL_COL_ATTR}="2"]`)).toHaveLength(0);
    expectDomMatchesModel(gridEl, model);
  });

  it('add-controls drag removing the last column leaves no stray cell in a row shortened by a rowspan', () => {
    const { table, gridEl } = createTable(rowspanInFirstColumn());
    const model = getModel(table);

    expect(addControlsOf(table).onDragRemoveCol()).toBe(true);

    expect(model.cols).toBe(2);
    expect(gridEl.querySelectorAll(`[${CELL_COL_ATTR}="2"]`)).toHaveLength(0);
    expectDomMatchesModel(gridEl, model);
  });

  it('corner-drag removing the last row shrinks the rowspan of a merge that reached it', () => {
    const { table, gridEl } = createTable(rowspanReachingLastRow());
    const model = getModel(table);
    const corner = cornerDragOf(table);

    expect(corner.canRemoveLastRow()).toBe(true);
    corner.onRemoveLastRow();

    expect(model.rows).toBe(2);
    expectDomMatchesModel(gridEl, model);
  });

  it('corner-drag remove-then-add row (overshoot and return) keeps the new row fully addressable', () => {
    const { table, gridEl } = createTable(rowspanReachingLastRow());
    const model = getModel(table);
    const corner = cornerDragOf(table);

    corner.onRemoveLastRow();
    corner.onAddRow();

    expect(model.rows).toBe(3);
    // The re-added row is a plain row in the model: its column 1 must have a <td>.
    expect(gridEl.querySelector(`[${CELL_ROW_ATTR}="2"][${CELL_COL_ATTR}="1"]`)).not.toBeNull();
    expectDomMatchesModel(gridEl, model);
  });

  it('corner-drag removing the last column shrinks the colspan of a merge that reached it', () => {
    const { table, gridEl } = createTable(colspanReachingLastColumn());
    const model = getModel(table);
    const corner = cornerDragOf(table);

    expect(corner.canRemoveLastColumn()).toBe(true);
    corner.onRemoveLastColumn();

    expect(model.cols).toBe(2);
    expectDomMatchesModel(gridEl, model);
  });

  it('corner-drag remove-then-add column keeps the new column fully addressable', () => {
    const { table, gridEl } = createTable(colspanReachingLastColumn());
    const model = getModel(table);
    const corner = cornerDragOf(table);

    corner.onRemoveLastColumn();
    corner.onAddColumn();

    expect(model.cols).toBe(3);
    expect(gridEl.querySelector(`[${CELL_ROW_ATTR}="1"][${CELL_COL_ATTR}="2"]`)).not.toBeNull();
    expectDomMatchesModel(gridEl, model);
  });

  it('add-controls drag removing the last row shrinks the rowspan of a merge that reached it', () => {
    const { table, gridEl } = createTable(rowspanReachingLastRow());
    const model = getModel(table);

    expect(addControlsOf(table).onDragRemoveRow()).toBe(true);

    expect(model.rows).toBe(2);
    expectDomMatchesModel(gridEl, model);
  });

  it('corner-drag adding a row and a column on a merged grid keeps DOM and model in sync (control)', () => {
    const { table, gridEl } = createTable(rowspanInFirstColumn());
    const model = getModel(table);
    const corner = cornerDragOf(table);

    corner.onAddRow();
    corner.onAddColumn();

    expect(model.rows).toBe(4);
    expect(model.cols).toBe(4);
    expectDomMatchesModel(gridEl, model);
  });
});

// ─── Fill handle across a merge ─────────────────────────────────────────────

interface RegistryBlock {
  id: string;
  name: string;
  holder: HTMLElement;
  preservedData: { text: string };
  preservedTunes: Record<string, never>;
  parentId: string | null;
}

/**
 * Mock API backed by a real ordered block registry, so deleting a block really
 * removes its holder (like the editor does) and a filled cell really gets the
 * source's text.
 */
const createRegistryAPI = (seed: Array<{ id: string; text: string }>): { api: API; registry: RegistryBlock[]; deleted: string[] } => {
  const registry: RegistryBlock[] = [];
  const deleted: string[] = [];
  const make = (id: string, text: string): RegistryBlock => {
    const holder = document.createElement('div');

    holder.setAttribute('data-blok-id', id);
    holder.textContent = text;

    return { id, name: 'paragraph', holder, preservedData: { text }, preservedTunes: {}, parentId: null };
  };

  seed.forEach(({ id, text }) => registry.push(make(id, text)));

  const counter = { next: 0 };

  const api = {
    styles: {
      block: 'blok-block',
      inlineToolbar: 'blok-inline-toolbar',
      inlineToolButton: 'blok-inline-tool-button',
      inlineToolButtonActive: 'blok-inline-tool-button--active',
      input: 'blok-input',
      loader: 'blok-loader',
      button: 'blok-button',
      settingsButton: 'blok-settings-button',
      settingsButtonActive: 'blok-settings-button--active',
    },
    i18n: { t: (key: string) => key },
    blocks: {
      insert: vi.fn().mockImplementation((_tool: string, data?: { text?: string }) => {
        counter.next += 1;
        const block = make(`new-${counter.next}`, data?.text ?? '');

        registry.push(block);

        return block;
      }),
      delete: vi.fn().mockImplementation((index: number) => {
        const [removed] = registry.splice(index, 1);

        if (removed) {
          deleted.push(removed.id);
          removed.holder.remove();
        }

        return Promise.resolve();
      }),
      getById: vi.fn().mockImplementation((id: string) => registry.find(b => b.id === id) ?? null),
      getChildren: vi.fn().mockReturnValue([]),
      getCurrentBlockIndex: vi.fn().mockReturnValue(0),
      getBlockIndex: vi.fn().mockImplementation((id: string) => {
        const index = registry.findIndex(b => b.id === id);

        return index === -1 ? undefined : index;
      }),
      getBlockByIndex: vi.fn().mockImplementation((index: number) => registry[index]),
      getBlocksCount: vi.fn().mockImplementation(() => registry.length),
      setBlockParent: vi.fn(),
    },
    events: { on: vi.fn(), off: vi.fn() },
    toolbar: { close: vi.fn() },
  } as unknown as API;

  return { api, registry, deleted };
};

const cellText = (gridEl: HTMLElement, row: number, col: number): string | null =>
  gridEl.querySelector(`[${CELL_ROW_ATTR}="${row}"][${CELL_COL_ATTR}="${col}"]`)?.textContent ?? null;

describe('merge audit: fill handle over a merged range', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  /**
   * 3x3. Row 1 merges A2:B2 (origin [1,0], colspan 2). C2 holds "keep-me".
   * The user selects A1:B2 (the selection expands to the merge) and fills down.
   */
  const setup = (): { table: Table; gridEl: HTMLElement; deleted: string[] } => {
    const { api, deleted } = createRegistryAPI([
      { id: 'a0', text: 'A1' }, { id: 'a1', text: 'B1' }, { id: 'a2', text: 'C1' },
      { id: 'b0', text: 'merged' }, { id: 'b2', text: 'keep-me' },
      { id: 'c0', text: 'A3' }, { id: 'c1', text: 'B3' }, { id: 'c2', text: 'C3' },
    ]);
    const data: TableData = {
      withHeadings: false,
      withHeadingColumn: false,
      content: [
        [{ blocks: ['a0'] }, { blocks: ['a1'] }, { blocks: ['a2'] }],
        [{ blocks: ['b0'], colspan: 2 }, { blocks: [], mergedInto: [1, 0] }, { blocks: ['b2'] }],
        [{ blocks: ['c0'] }, { blocks: ['c1'] }, { blocks: ['c2'] }],
      ],
    };
    const table = new Table({
      data,
      config: {},
      api,
      readOnly: false,
      block: { id: 'merge-audit-fill' } as never,
    });
    const element = table.render();

    document.body.appendChild(element);
    table.rendered();

    const gridEl = (element.firstElementChild as HTMLElement).firstElementChild as HTMLElement;

    return { table, gridEl, deleted };
  };

  const fill = (table: Table, range: { minRow: number; maxRow: number; minCol: number; maxCol: number }, direction: 'right' | 'down'): void => {
    const subsystems = (table as unknown as {
      subsystems: { handleCellFill: (r: typeof range, d: 'right' | 'down') => void };
    }).subsystems;

    subsystems.handleCellFill(range, direction);
  };

  it('seeds the fixture as expected (control)', () => {
    const { gridEl } = setup();

    expect(cellText(gridEl, 1, 0)).toBe('merged');
    expect(cellText(gridEl, 1, 2)).toBe('keep-me');
  });

  it('fill down over A1:B2 never touches C2, which is outside the range', () => {
    const { table, gridEl, deleted } = setup();

    fill(table, { minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 }, 'down');

    expect(deleted).not.toContain('b2');
    expect(cellText(gridEl, 1, 2)).toBe('keep-me');
    // The model must still name the block the DOM shows in C2.
    expect(getModel(table).getCellBlocks(1, 2)).toEqual(['b2']);
  });

  it('fill right over a rowspan never touches the cell after the merge in the covered row', () => {
    const { api, deleted } = createRegistryAPI([
      { id: 'a0', text: 'A1' }, { id: 'a1', text: 'B1' }, { id: 'a2', text: 'C1' },
      { id: 'b0', text: 'A2' }, { id: 'b1', text: 'merged' }, { id: 'b2', text: 'C2' },
      { id: 'c0', text: 'A3' }, { id: 'c2', text: 'keep-me' },
    ]);
    const table = new Table({
      data: {
        withHeadings: false,
        withHeadingColumn: false,
        content: [
          [{ blocks: ['a0'] }, { blocks: ['a1'] }, { blocks: ['a2'] }],
          [{ blocks: ['b0'] }, { blocks: ['b1'], rowspan: 2 }, { blocks: ['b2'] }],
          [{ blocks: ['c0'] }, { blocks: [], mergedInto: [1, 1] }, { blocks: ['c2'] }],
        ],
      },
      config: {},
      api,
      readOnly: false,
      block: { id: 'merge-audit-fill-right' } as never,
    });
    const element = table.render();

    document.body.appendChild(element);
    table.rendered();

    const gridEl = (element.firstElementChild as HTMLElement).firstElementChild as HTMLElement;

    expect(cellText(gridEl, 2, 2)).toBe('keep-me');

    // A2:B3 — the selection a user gets by selecting A2:B2 (expanded over the rowspan).
    fill(table, { minRow: 1, maxRow: 2, minCol: 0, maxCol: 1 }, 'right');

    expect(deleted).not.toContain('c2');
    expect(cellText(gridEl, 2, 2)).toBe('keep-me');
  });

  it('fill right whose source coordinate is covered by a rowspan copies the merged cell the user sees there', () => {
    const { api } = createRegistryAPI([
      { id: 'a0', text: 'merged' }, { id: 'a1', text: 'B1' }, { id: 'a2', text: 'C1' },
      { id: 'b1', text: 'B2' }, { id: 'b2', text: 'C2' },
      { id: 'c0', text: 'A3' }, { id: 'c1', text: 'B3' }, { id: 'c2', text: 'C3' },
    ]);
    const table = new Table({
      data: {
        withHeadings: false,
        withHeadingColumn: false,
        content: [
          [{ blocks: ['a0'], rowspan: 2 }, { blocks: ['a1'] }, { blocks: ['a2'] }],
          [{ blocks: [], mergedInto: [0, 0] }, { blocks: ['b1'] }, { blocks: ['b2'] }],
          [{ blocks: ['c0'] }, { blocks: ['c1'] }, { blocks: ['c2'] }],
        ],
      },
      config: {},
      api,
      readOnly: false,
      block: { id: 'merge-audit-fill-covered-source' } as never,
    });
    const element = table.render();

    document.body.appendChild(element);
    table.rendered();

    const gridEl = (element.firstElementChild as HTMLElement).firstElementChild as HTMLElement;

    // Row 2's source A2 is covered: its visible content is the merged A1:A2.
    fill(table, { minRow: 0, maxRow: 1, minCol: 0, maxCol: 2 }, 'right');

    expect(cellText(gridEl, 1, 2)).toBe('merged');
    expect(cellText(gridEl, 1, 1)).toBe('merged');
    expect(cellText(gridEl, 0, 2)).toBe('merged');
    expect(cellText(gridEl, 2, 2)).toBe('C3');
  });
});

// ─── Headings × merges ──────────────────────────────────────────────────────

const HEADING_ROW = 'data-blok-table-heading';
const HEADING_COL = 'data-blok-table-heading-col';

const tdAt = (gridEl: HTMLElement, row: number, col: number): HTMLTableCellElement | null =>
  gridEl.querySelector<HTMLTableCellElement>(`[${CELL_ROW_ATTR}="${row}"][${CELL_COL_ATTR}="${col}"]`);

const rebuild = (table: Table): void => {
  (table as unknown as { rebuildTableBody: () => void }).rebuildTableBody();
};

const flat3x3 = (withHeadings: boolean, withHeadingColumn: boolean): TableData => ({
  withHeadings,
  withHeadingColumn,
  content: Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ blocks: [] }))),
});

describe('merge audit: headings and merges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('a merge spanning the heading row and a body row renders as one column header and survives save/load', () => {
    const { table, gridEl } = createTable(flat3x3(true, false));
    const model = getModel(table);

    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 0 });
    rebuild(table);

    const origin = tdAt(gridEl, 0, 0);

    expect(origin?.rowSpan).toBe(2);
    expect(origin?.closest('tr')?.hasAttribute(HEADING_ROW)).toBe(true);
    expect(origin?.getAttribute('role')).toBe('columnheader');
    // Body cells beside the merge are not headers.
    expect(tdAt(gridEl, 1, 1)?.hasAttribute('role')).toBe(false);
    expectDomMatchesModel(gridEl, model);

    const saved = table.save(gridEl);

    expect(saved.withHeadings).toBe(true);
    expect(saved.content[0][0]).toMatchObject({ rowspan: 2 });
    expect(saved.content[1][0]).toMatchObject({ mergedInto: [0, 0] });

    document.body.innerHTML = '';
    const reloaded = createTable(saved);

    expect(tdAt(reloaded.gridEl, 0, 0)?.rowSpan).toBe(2);
    expect(tdAt(reloaded.gridEl, 0, 0)?.getAttribute('role')).toBe('columnheader');
    expectDomMatchesModel(reloaded.gridEl, getModel(reloaded.table));
  });

  it('a merge spanning the heading column paints the heading on the origin only, and rows whose column 0 is covered get none', () => {
    const { table, gridEl } = createTable(flat3x3(false, true));
    const model = getModel(table);

    model.mergeCells({ minRow: 1, maxRow: 2, minCol: 0, maxCol: 1 });
    rebuild(table);

    expect(tdAt(gridEl, 1, 0)?.hasAttribute(HEADING_COL)).toBe(true);
    expect(tdAt(gridEl, 1, 0)?.getAttribute('role')).toBe('rowheader');
    // Row 2's first physical cell is logical column 2, not a heading.
    expect(tdAt(gridEl, 2, 2)?.hasAttribute(HEADING_COL)).toBe(false);
    expect(gridEl.querySelectorAll(`[${HEADING_COL}]`)).toHaveLength(2);
  });

  it('toggling heading row and column off and on keeps a merge that crosses both boundaries intact', () => {
    const { table, gridEl } = createTable(flat3x3(true, true));
    const model = getModel(table);

    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });
    rebuild(table);

    const invoke = (type: 'toggle-heading' | 'toggle-heading-column'): void => {
      const subsystems = (table as unknown as {
        subsystems: { handleRowColAction: (g: HTMLElement, a: { type: typeof type; index: number }) => void };
      }).subsystems;

      subsystems.handleRowColAction(gridEl, { type, index: 0 });
    };

    invoke('toggle-heading');
    invoke('toggle-heading-column');

    expect(model.withHeadings).toBe(false);
    expect(model.withHeadingColumn).toBe(false);
    expect(gridEl.querySelectorAll(`[${HEADING_ROW}], [${HEADING_COL}]`)).toHaveLength(0);
    expect(tdAt(gridEl, 0, 0)?.hasAttribute('role')).toBe(false);

    invoke('toggle-heading');
    invoke('toggle-heading-column');

    expect(tdAt(gridEl, 0, 0)?.getAttribute('role')).toBe('columnheader');
    expect(tdAt(gridEl, 0, 0)?.hasAttribute(HEADING_COL)).toBe(true);
    expectDomMatchesModel(gridEl, model);
    model.validateInvariants();
  });

  it('merging the entire table leaves one cell and empty rows that still round-trip', () => {
    const { table, gridEl } = createTable(flat3x3(true, true));
    const model = getModel(table);

    model.mergeCells({ minRow: 0, maxRow: 2, minCol: 0, maxCol: 2 });
    rebuild(table);

    expect(cellsOf(gridEl)).toHaveLength(1);
    expect(tdAt(gridEl, 0, 0)?.colSpan).toBe(3);
    expect(tdAt(gridEl, 0, 0)?.rowSpan).toBe(3);
    expect(gridEl.querySelectorAll('tr')).toHaveLength(3);
    expectDomMatchesModel(gridEl, model);

    const saved = table.save(gridEl);

    document.body.innerHTML = '';
    const reloaded = createTable(saved);

    expectDomMatchesModel(reloaded.gridEl, getModel(reloaded.table));
    expect(cellsOf(reloaded.gridEl)).toHaveLength(1);
  });

  it('grip insert-row-above and delete-row at the heading row of a merged table keep DOM, model and heading in sync', () => {
    const { table, gridEl } = createTable(flat3x3(true, false));
    const model = getModel(table);

    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 1, maxCol: 1 });
    rebuild(table);

    const invoke = (action: { type: 'insert-row-above' | 'delete-row'; index: number }): void => {
      const subsystems = (table as unknown as {
        subsystems: { handleRowColAction: (g: HTMLElement, a: typeof action) => void };
      }).subsystems;

      subsystems.handleRowColAction(gridEl, action);
    };

    invoke({ type: 'insert-row-above', index: 0 });
    expectDomMatchesModel(gridEl, model);
    expect(tdAt(gridEl, 1, 1)?.rowSpan).toBe(2);
    expect(gridEl.querySelectorAll(`tr[${HEADING_ROW}]`)).toHaveLength(1);
    expect(gridEl.querySelector('tr')?.hasAttribute(HEADING_ROW)).toBe(true);

    invoke({ type: 'delete-row', index: 0 });
    invoke({ type: 'delete-row', index: 0 });
    expectDomMatchesModel(gridEl, model);
    // Origin moved down into the new heading row; span shrank to 1.
    expect(model.getCellSpan(0, 1)).toEqual({ colspan: 1, rowspan: 1 });
    expect(gridEl.querySelector('tr')?.hasAttribute(HEADING_ROW)).toBe(true);
    model.validateInvariants();
  });
});

// ─── Styling on a merged cell ───────────────────────────────────────────────

describe('merge audit: color and placement on a merged cell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('color and placement set on a merged cell land on the origin, paint the whole span, and survive a rebuild and save/load', () => {
    const { table, gridEl } = createTable(flat3x3(false, false));
    const model = getModel(table);

    model.mergeCells({ minRow: 1, maxRow: 2, minCol: 1, maxCol: 2 });
    rebuild(table);

    const subsystems = (table as unknown as {
      subsystems: {
        handleCellColorChange: (cells: HTMLElement[], color: string | null, mode: 'backgroundColor' | 'color') => void;
        handleCellPlacementChange: (cells: HTMLElement[], placement: 'middle-center') => void;
        handleRowColAction: (g: HTMLElement, a: { type: 'insert-row-above'; index: number }) => void;
      };
    }).subsystems;
    const origin = tdAt(gridEl, 1, 1);

    if (origin === null) {
      throw new Error('no origin td');
    }

    subsystems.handleCellColorChange([origin], '#ff0000', 'backgroundColor');
    subsystems.handleCellColorChange([origin], '#0000ff', 'color');
    subsystems.handleCellPlacementChange([origin], 'middle-center');

    expect(model.getCellColor(1, 1)).toBe('#ff0000');
    expect(model.getCellTextColor(1, 1)).toBe('#0000ff');
    expect(model.getCellPlacement(1, 1)).toBe('middle-center');
    // The one <td> carries the paint for the whole span.
    expect(origin.style.backgroundColor).not.toBe('');

    // Insert a row INSIDE the merge: rebuild path.
    subsystems.handleRowColAction(gridEl, { type: 'insert-row-above', index: 2 });

    const rebuilt = tdAt(gridEl, 1, 1);

    expect(rebuilt?.rowSpan).toBe(3);
    expect(rebuilt?.style.backgroundColor).not.toBe('');
    expect(rebuilt?.style.color).not.toBe('');
    expect(rebuilt?.querySelector('[data-blok-cell-placement="middle-center"]')).not.toBeNull();
    expectDomMatchesModel(gridEl, model);

    const saved = table.save(gridEl);

    expect(saved.content[1][1]).toMatchObject({ color: '#ff0000', textColor: '#0000ff', placement: 'middle-center', rowspan: 3, colspan: 2 });

    document.body.innerHTML = '';
    const reloaded = createTable(saved);

    expect(tdAt(reloaded.gridEl, 1, 1)?.style.backgroundColor).not.toBe('');
  });
});

// ─── Grip ops fully inside a merge ──────────────────────────────────────────

describe('merge audit: grip ops on rows/columns fully inside a merge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  type GripAction =
    | { type: 'delete-row' | 'delete-col' | 'duplicate-row' | 'duplicate-col' | 'insert-row-below' | 'insert-col-right'; index: number };

  const invoke = (table: Table, gridEl: HTMLElement, action: GripAction): void => {
    const subsystems = (table as unknown as {
      subsystems: { handleRowColAction: (g: HTMLElement, a: GripAction) => void };
    }).subsystems;

    subsystems.handleRowColAction(gridEl, action);
  };

  /**
   * 4x4 with a 3x3 merge at [0,0]..[2,2]: row 1 and column 1 lie fully inside it.
   */
  const bigMerge = (): TableData => {
    const data = flat3x3(false, false);
    const content = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ({ blocks: [] as string[] })));

    return { ...data, content };
  };

  const cases: GripAction[] = [
    { type: 'delete-row', index: 1 },
    { type: 'delete-col', index: 1 },
    { type: 'duplicate-row', index: 1 },
    { type: 'duplicate-col', index: 1 },
    { type: 'insert-row-below', index: 1 },
    { type: 'insert-col-right', index: 1 },
    { type: 'insert-row-below', index: 2 },
    { type: 'insert-col-right', index: 2 },
  ];

  cases.forEach(action => {
    it(`${action.type} ${action.index} keeps DOM, model and widths in sync`, () => {
      const { table, gridEl } = createTable(bigMerge());
      const model = getModel(table);

      model.mergeCells({ minRow: 0, maxRow: 2, minCol: 0, maxCol: 2 });
      rebuild(table);

      invoke(table, gridEl, action);

      model.validateInvariants();
      expectDomMatchesModel(gridEl, model);
      expect(gridEl.querySelectorAll('colgroup col')).toHaveLength(model.cols);
      expect(model.colWidths === undefined || model.colWidths.length === model.cols).toBe(true);
    });
  });
});

// ─── Widths and grip selection on a merged grid ─────────────────────────────

const colWidthsInDom = (gridEl: HTMLElement): string[] =>
  Array.from(gridEl.querySelectorAll<HTMLElement>('colgroup col')).map(col => col.style.width);

describe('merge audit: resize and grip selection on a merged grid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  /**
   * 3x3 pixel-mode table; columns 1-2 merged in every row, so column 2 has no <td> at all.
   */
  const coveredColumnData = (): TableData => ({
    withHeadings: false,
    withHeadingColumn: false,
    colWidths: [100, 100, 100],
    content: [
      [{ blocks: [] }, { blocks: [], colspan: 2, rowspan: 3 }, { blocks: [], mergedInto: [0, 1] }],
      [{ blocks: [] }, { blocks: [], mergedInto: [0, 1] }, { blocks: [], mergedInto: [0, 1] }],
      [{ blocks: [] }, { blocks: [], mergedInto: [0, 1] }, { blocks: [], mergedInto: [0, 1] }],
    ],
  });

  it('dragging the border of a column no <td> occupies resizes that column and keeps the merge span', () => {
    const { table, gridEl } = createTable(coveredColumnData());
    const model = getModel(table);
    const handle = gridEl.querySelector<HTMLElement>('[data-blok-table-resize][data-col="2"]');

    expect(handle).not.toBeNull();
    handle?.dispatchEvent(new PointerEvent('pointerdown', { clientX: 300, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 360 }));
    document.dispatchEvent(new PointerEvent('pointerup', {}));

    expect(model.colWidths).toEqual([100, 100, 160]);
    expect(colWidthsInDom(gridEl)).toEqual(['100px', '100px', '160px']);
    expect(tdAt(gridEl, 0, 1)?.colSpan).toBe(2);
    expectDomMatchesModel(gridEl, model);
  });

  it('merge then split on a pixel-mode table keeps every <col> width', () => {
    const data = flat3x3(false, false);
    const { table, gridEl } = createTable({ ...data, colWidths: [120, 80, 200] });
    const model = getModel(table);
    const before = colWidthsInDom(gridEl);

    expect(before).toEqual(['120px', '80px', '200px']);

    model.mergeCells({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 2 });
    rebuild(table);
    expect(colWidthsInDom(gridEl)).toEqual(before);

    model.splitCell(0, 0);
    rebuild(table);
    expect(colWidthsInDom(gridEl)).toEqual(before);
    expect(model.colWidths).toEqual([120, 80, 200]);
  });

  it('grip-selecting a row or column crossed by a merge selects the whole merge', () => {
    const { table } = createTable(rowspanInFirstColumn());
    const selection = (table as unknown as {
      subsystems: {
        cellSelection: {
          selectRow: (i: number) => void;
          selectColumn: (i: number) => void;
          getSelectedRange: () => { minRow: number; maxRow: number; minCol: number; maxCol: number } | null;
        } | null;
      };
    }).subsystems.cellSelection;

    if (selection === null) {
      throw new Error('no cell selection');
    }

    selection.selectRow(1);
    expect(selection.getSelectedRange()).toEqual({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 2 });

    selection.selectColumn(1);
    expect(selection.getSelectedRange()).toEqual({ minRow: 0, maxRow: 2, minCol: 1, maxCol: 1 });
  });
});
