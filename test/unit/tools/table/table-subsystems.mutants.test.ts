/*
 * TableSubsystems is pure wiring: every gesture the table offers arrives as a
 * callback it handed to a collaborator (add-controls, corner-drag, row/col
 * controls, cell-selection, resize) or as a paste event on the grid. jsdom
 * reports every rect as zero, so the collaborators are mocked to capture the
 * option objects — the same technique table-corner-drag-content-guard.test.ts
 * uses — and each callback is then driven directly against a REAL TableModel,
 * a REAL TableGrid and a real DOM.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

import { CELL_BLOCKS_ATTR } from '../../../../src/tools/table/table-cell-blocks';
import type { TableCellBlocks } from '../../../../src/tools/table/table-cell-blocks';
import {
  buildClipboardHtml,
  serializeCellsToClipboard,
} from '../../../../src/tools/table/table-cell-clipboard';
import type { CellColorMode } from '../../../../src/tools/table/table-cell-color-picker';
import type { CellMark, FillDirection, SelectionRange } from '../../../../src/tools/table/table-cell-selection';
import { TableGrid, ROW_ATTR, CELL_ATTR, CELL_ROW_ATTR, CELL_COL_ATTR } from '../../../../src/tools/table/table-core';
import { TableModel } from '../../../../src/tools/table/table-model';
import { applyPixelWidths } from '../../../../src/tools/table/table-operations';
import type { ActionData } from '../../../../src/tools/table/table-row-col-action-handler';
import type * as RowColActionHandler from '../../../../src/tools/table/table-row-col-action-handler';
import type { RowColAction } from '../../../../src/tools/table/table-row-col-controls';
import { TableSubsystems } from '../../../../src/tools/table/table-subsystems';
import type { TableHost } from '../../../../src/tools/table/table-subsystems';
import type { CellPlacement, ClipboardBlockData, TableData } from '../../../../src/tools/table/types';
import type { API, BlockAPI, I18n } from '../../../../types';

// ─── Captured collaborator wiring ──────────────────────────────────

const captured = vi.hoisted(() => ({
  addControls: [] as unknown[],
  addControlsSelf: [] as unknown[],
  cornerDrag: [] as unknown[],
  cornerDragSelf: [] as unknown[],
  rowColControls: [] as unknown[],
  rowColControlsSelf: [] as unknown[],
  cellSelection: [] as unknown[],
  cellSelectionSelf: [] as unknown[],
  resize: [] as unknown[],
  resizeSelf: [] as unknown[],
  scrollHazeSelf: [] as unknown[],
  actionCalls: [] as unknown[],
  /** Runs inside executeRowColAction, so a test can move the world mid-action. */
  duringAction: null as (() => void) | null,
  popoverOpen: false,
}));

vi.mock('../../../../src/tools/table/table-add-controls', () => ({
  TableAddControls: class {
    public destroy = vi.fn();
    public syncRowButtonWidth = vi.fn();
    public setDisplay = vi.fn();
    public setInteractive = vi.fn();
    public attachScrollContainer = vi.fn();

    public constructor(options: unknown) {
      captured.addControls.push(options);
      captured.addControlsSelf.push(this);
    }
  },
}));

vi.mock('../../../../src/tools/table/table-corner-drag', () => ({
  TableCornerDrag: class {
    public destroy = vi.fn();
    public syncPosition = vi.fn();
    public attachScrollContainer = vi.fn();
    public setDisplay = vi.fn();
    public setInteractive = vi.fn();

    public constructor(options: unknown) {
      captured.cornerDrag.push(options);
      captured.cornerDragSelf.push(this);
    }
  },
}));

vi.mock('../../../../src/tools/table/table-row-col-controls', () => ({
  TableRowColControls: class {
    public destroy = vi.fn();
    public refresh = vi.fn();
    public positionGrips = vi.fn();
    public hideAllGrips = vi.fn();
    public setGripsDisplay = vi.fn();
    public setActiveGrip = vi.fn();

    public get isPopoverOpen(): boolean {
      return captured.popoverOpen;
    }

    public constructor(options: unknown) {
      captured.rowColControls.push(options);
      captured.rowColControlsSelf.push(this);
    }
  },
}));

vi.mock('../../../../src/tools/table/table-cell-selection', () => ({
  TableCellSelection: class {
    public destroy = vi.fn();
    public selectRow = vi.fn();
    public selectColumn = vi.fn();
    public selectRange = vi.fn();
    public clearActiveSelection = vi.fn();

    public constructor(options: unknown) {
      captured.cellSelection.push(options);
      captured.cellSelectionSelf.push(this);
    }
  },
}));

vi.mock('../../../../src/tools/table/table-resize', () => ({
  TableResize: class {
    public enabled = true;
    public destroy = vi.fn();

    public constructor(...args: unknown[]) {
      captured.resize.push(args);
      captured.resizeSelf.push(this);
    }
  },
}));

vi.mock('../../../../src/tools/table/table-scroll-haze', () => ({
  TableScrollHaze: class {
    public init = vi.fn();
    public update = vi.fn();
    public destroy = vi.fn();

    public constructor() {
      captured.scrollHazeSelf.push(this);
    }
  },
}));

vi.mock('../../../../src/tools/table/table-row-col-action-handler', async (importOriginal) => {
  const actual = await importOriginal<typeof RowColActionHandler>();

  return {
    ...actual,
    executeRowColAction: ((gridEl, action, context) => {
      captured.actionCalls.push({ action, data: context.data, blocksToDelete: context.blocksToDelete });

      const result = actual.executeRowColAction(gridEl, action, context);

      captured.duringAction?.();

      return result;
    }) satisfies typeof actual.executeRowColAction,
  };
});

// ─── Shapes of the captured option objects ─────────────────────────

interface AddControlsOptions {
  wrapper: HTMLElement;
  grid: HTMLElement;
  i18n: I18n;
  onAddRow: () => void;
  onAddColumn: () => void;
  onDragStart: () => void;
  onDragAddRow: () => boolean;
  onDragRemoveRow: () => boolean;
  onDragAddCol: () => boolean;
  onDragRemoveCol: () => boolean;
  onDragEnd: () => void;
  getTableSize: () => { rows: number; cols: number };
  getNewColumnWidth: () => number;
}

interface CornerDragOptions {
  wrapper: HTMLElement;
  gridEl: HTMLElement;
  i18n: I18n;
  onAddRow: () => void;
  onAddColumn: () => void;
  onRemoveLastRow: () => void;
  onRemoveLastColumn: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  getTableSize: () => { rows: number; cols: number };
  canRemoveLastRow: () => boolean;
  canRemoveLastColumn: () => boolean;
  onClickAdd: () => void;
}

interface RowColOptions {
  grid: HTMLElement;
  overlay?: HTMLElement;
  scrollContainer?: HTMLElement;
  getColumnCount: () => number;
  getRowCount: () => number;
  isHeadingRow: () => boolean;
  isHeadingColumn: () => boolean;
  canDrag: (type: 'row' | 'col', index: number) => boolean;
  canDrop: (type: 'row' | 'col', fromIndex: number, toIndex: number) => boolean;
  onAction: (action: RowColAction) => void;
  onClearContents: (type: 'row' | 'col', index: number) => void;
  onColorChange: (type: 'row' | 'col', index: number, color: string | null, mode: CellColorMode) => void;
  onDragStateChange: (isDragging: boolean, dragType: 'row' | 'col' | null, dragIndex: number) => void;
  onGripClick: (type: 'row' | 'col', index: number) => void;
  onGripPopoverClose: () => void;
  i18n: I18n;
}

interface CellSelectionOptions {
  grid: HTMLElement;
  rectangleSelection?: unknown;
  isPopoverOpen: () => boolean;
  onPointerDragActiveChange: (active: boolean) => void;
  onSelectionActiveChange: (hasSelection: boolean, isMultiCell: boolean) => void;
  onSelectionRangeChange: (range: SelectionRange) => void;
  onClearContent: (cells: HTMLElement[]) => void;
  onCopy: (cells: HTMLElement[], clipboardData: DataTransfer) => void;
  onCut: (cells: HTMLElement[], clipboardData: DataTransfer) => void;
  onCopyViaButton: (cells: HTMLElement[]) => void;
  onColorChange: (cells: HTMLElement[], color: string | null, mode: CellColorMode) => void;
  onPlacementChange: (cells: HTMLElement[], placement: CellPlacement) => void;
  getCellPlacement: (row: number, col: number) => CellPlacement | undefined;
  getCellColor: (row: number, col: number) => string | undefined;
  getCellTextColor: (row: number, col: number) => string | undefined;
  canMergeCells: (range: SelectionRange) => boolean;
  onMergeCells: (range: SelectionRange) => void;
  isMergedCell: (row: number, col: number) => boolean;
  onSplitCell: (row: number, col: number) => void;
  getCellSpan: (row: number, col: number) => { colspan: number; rowspan: number };
  getMergeOrigin: (row: number, col: number) => [number, number] | null;
  onFormatCells: (cells: HTMLElement[], mark: CellMark) => void;
  onFillCells: (cells: HTMLElement[], range: SelectionRange, direction: FillDirection) => void;
  i18n: I18n;
}

interface MockAddControls {
  destroy: Mock;
  syncRowButtonWidth: Mock;
  setDisplay: Mock;
  setInteractive: Mock;
  attachScrollContainer: Mock;
}

interface MockCornerDrag {
  destroy: Mock;
  syncPosition: Mock;
  attachScrollContainer: Mock;
  setDisplay: Mock;
  setInteractive: Mock;
}

interface MockRowColControls {
  destroy: Mock;
  refresh: Mock;
  positionGrips: Mock;
  hideAllGrips: Mock;
  setGripsDisplay: Mock;
  setActiveGrip: Mock;
}

interface MockCellSelection {
  destroy: Mock;
  selectRow: Mock;
  selectColumn: Mock;
}

interface MockResize {
  enabled: boolean;
  destroy: Mock;
}

interface MockScrollHaze {
  init: Mock;
  update: Mock;
  destroy: Mock;
}

interface RecordedAction {
  action: RowColAction;
  data: ActionData;
  blocksToDelete?: string[];
}

const last = <T>(items: unknown[]): T => {
  const item = items.at(-1);

  if (item === undefined) {
    throw new Error('collaborator was never constructed');
  }

  return item as T;
};

// ─── Harness ───────────────────────────────────────────────────────

interface InsertCall {
  tool: string;
  data: Record<string, unknown>;
  index: number;
  needToFocus: boolean;
  replace: boolean;
  tunes: Record<string, unknown> | undefined;
}

interface HarnessOptions {
  rows?: number;
  cols?: number;
  colWidths?: number[];
  initialColWidth?: number;
  withHeadings?: boolean;
  withHeadingColumn?: boolean;
  merges?: SelectionRange[];
  readOnly?: boolean;
  blockId?: string | undefined;
  noElement?: boolean;
  noScrollContainer?: boolean;
  noGripOverlay?: boolean;
  noCellBlocks?: boolean;
  seed?: boolean;
  init?: boolean;
  /** Re-render <tbody> from the model, the way Table's real rebuildTableBody does. */
  liveRebuild?: boolean;
}

interface Harness {
  subsystems: TableSubsystems;
  gridEl: HTMLTableElement;
  model: TableModel;
  grid: TableGrid;
  host: MutableHost;
  api: API;
  insertCalls: InsertCall[];
  setBlockParent: Mock;
  ensureCellHasBlock: Mock;
  focusClearedCell: Mock;
  ensureScrollContainer: Mock;
  transactions: string[];
  scrollLeft: () => number;
  cellOf: (row: number, col: number) => HTMLElement;
  maybeCellOf: (row: number, col: number) => HTMLElement | null;
  textOf: (row: number, col: number) => string;
  idsOf: (row: number, col: number) => string[];
  write: (row: number, col: number, html: string) => void;
  blockOf: (id: string) => BlockAPI | undefined;
  setTunes: (row: number, col: number, tunes: Record<string, unknown>) => void;
}

type MutableHost = { -readonly [K in keyof TableHost]: TableHost[K] };

const addControlsOptions = (): AddControlsOptions => last<AddControlsOptions>(captured.addControls);
const cornerDragOptions = (): CornerDragOptions => last<CornerDragOptions>(captured.cornerDrag);
const rowColOptions = (): RowColOptions => last<RowColOptions>(captured.rowColControls);
const cellSelectionOptions = (): CellSelectionOptions => last<CellSelectionOptions>(captured.cellSelection);
const addControlsMock = (): MockAddControls => last<MockAddControls>(captured.addControlsSelf);
const cornerDragMock = (): MockCornerDrag => last<MockCornerDrag>(captured.cornerDragSelf);
const rowColMock = (): MockRowColControls => last<MockRowColControls>(captured.rowColControlsSelf);
const cellSelectionMock = (): MockCellSelection => last<MockCellSelection>(captured.cellSelectionSelf);
const resizeMock = (): MockResize => last<MockResize>(captured.resizeSelf);
const resizeArgs = (): unknown[] => last<unknown[]>(captured.resize);
const scrollHazeMock = (): MockScrollHaze => last<MockScrollHaze>(captured.scrollHazeSelf);
const recordedActions = (): RecordedAction[] => captured.actionCalls as RecordedAction[];

const createHarness = (options: HarnessOptions = {}): Harness => {
  const rows = options.rows ?? 2;
  const cols = options.cols ?? 2;
  const data: TableData = {
    withHeadings: options.withHeadings ?? false,
    withHeadingColumn: options.withHeadingColumn ?? false,
    content: Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ blocks: [] }))),
    ...(options.colWidths !== undefined ? { colWidths: options.colWidths } : {}),
    ...(options.initialColWidth !== undefined ? { initialColWidth: options.initialColWidth } : {}),
  };

  const model = new TableModel(data);
  const grid = new TableGrid({ readOnly: false });

  (options.merges ?? []).forEach((rect) => model.mergeCells(rect));

  const gridEl = (options.merges ?? []).length > 0
    ? grid.createGridFromModel(model)
    : grid.createGrid(rows, cols, options.colWidths);

  const element = document.createElement('div');
  const scrollContainer = document.createElement('div');
  const gripOverlay = document.createElement('div');

  element.appendChild(scrollContainer);
  scrollContainer.appendChild(gridEl);
  element.appendChild(gripOverlay);
  document.body.appendChild(element);

  let scrollLeftValue = 0;

  // jsdom clamps scrollLeft to 0 on a box it never lays out, so the drag-end
  // "scroll to the new column" assignment would be unobservable.
  Object.defineProperty(scrollContainer, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeftValue,
    set: (value: number) => {
      scrollLeftValue = value;
    },
  });
  Object.defineProperty(scrollContainer, 'scrollWidth', { configurable: true, value: 640 });

  const registry = new Map<string, BlockAPI>();
  const order: string[] = [];
  const insertCalls: InsertCall[] = [];
  const setBlockParent = vi.fn();
  let nextId = 1;

  const makeBlock = (id: string, tool: string, blockData: Record<string, unknown>, tunes: Record<string, unknown>): BlockAPI => {
    const holder = document.createElement('div');

    holder.setAttribute('data-blok-id', id);

    const editable = document.createElement('div');

    editable.setAttribute('contenteditable', 'true');
    editable.setAttribute('tabindex', '0');
    editable.innerHTML = typeof blockData.text === 'string' ? blockData.text : '';
    holder.appendChild(editable);

    const block = {
      id,
      name: tool,
      holder,
      dispatchChange: vi.fn(),
      preservedData: blockData,
      preservedTunes: tunes,
    } as unknown as BlockAPI;

    registry.set(id, block);
    order.push(id);

    return block;
  };

  const api = {
    i18n: { t: (key: string) => key },
    rectangleSelection: { cancelActiveSelection: vi.fn() },
    toolbar: { close: vi.fn() },
    blocks: {
      setPointerDragActive: vi.fn(),
      beginTransaction: vi.fn(),
      endTransaction: vi.fn(),
      setBlockParent,
      getBlocksCount: (): number => order.length,
      getById: (id: string): BlockAPI | null => registry.get(id) ?? null,
      getBlockIndex: (id: string): number | undefined => {
        const index = order.indexOf(id);

        return index === -1 ? undefined : index;
      },
      getBlockByIndex: (index: number): BlockAPI | undefined => {
        const id = order[index];

        return id === undefined ? undefined : registry.get(id);
      },
      insert: (
        tool: string,
        blockData: Record<string, unknown>,
        _config: unknown,
        index: number,
        needToFocus: boolean,
        replace: boolean,
        _id: string | undefined,
        tunes: Record<string, unknown> | undefined
      ): BlockAPI => {
        insertCalls.push({ tool, data: blockData, index, needToFocus, replace, tunes });

        return makeBlock(`ins-${nextId++}`, tool, blockData, tunes ?? {});
      },
    },
    caret: { setToBlock: vi.fn() },
  } as unknown as API;

  const ensureCellHasBlock = vi.fn((cell: HTMLElement) => {
    if (cell.querySelector('[data-blok-id]')) {
      return;
    }

    const container = cell.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

    container?.appendChild(makeBlock(`seed-${nextId++}`, 'paragraph', { text: '' }, {}).holder);
  });
  const focusClearedCell = vi.fn();

  const cellBlocks = {
    getBlockIdsFromCells: (cells: HTMLElement[]): string[] =>
      cells.flatMap((cell) =>
        Array.from(cell.querySelectorAll('[data-blok-id]'))
          .map((el) => el.getAttribute('data-blok-id'))
          .filter((id): id is string => id !== null)
      ),
    deleteBlocks: (ids: string[]): void => {
      ids.forEach((id) => {
        registry.get(id)?.holder.remove();
        registry.delete(id);

        const index = order.indexOf(id);

        if (index !== -1) {
          order.splice(index, 1);
        }
      });
    },
    ensureCellHasBlock,
    focusClearedCell,
  } as unknown as TableCellBlocks;

  const transactions: string[] = [];
  const ensureScrollContainerSpy = vi.fn(() => scrollContainer);

  const host: MutableHost = {
    api,
    readOnly: options.readOnly ?? false,
    blockId: 'blockId' in options ? options.blockId : 'table-1',
    model,
    grid,
    cellBlocks: options.noCellBlocks === true ? null : cellBlocks,
    element: options.noElement === true ? null : element,
    gridElement: gridEl,
    scrollContainer: options.noScrollContainer === true ? null : scrollContainer,
    gripOverlay: options.noGripOverlay === true ? null : gripOverlay,
    setDataGeneration: 0,
    runStructuralOp: <T>(fn: () => T): T => {
      transactions.push('structural');

      return fn();
    },
    runTransactedStructuralOp: <T>(fn: () => T): T => {
      transactions.push('transacted');

      return fn();
    },
    ensureScrollContainer: ensureScrollContainerSpy,
    rebuildTableBody: vi.fn(() => {
      if (options.liveRebuild !== true) {
        return;
      }

      const freshBody = grid.createGridFromModel(model).querySelector('tbody');
      const currentBody = gridEl.querySelector('tbody');

      if (freshBody && currentBody) {
        currentBody.replaceWith(freshBody);
      }
    }),
    fitToPageWidth: vi.fn(),
  };

  const subsystems = new TableSubsystems(host);

  if (options.init !== false) {
    subsystems.initAll(gridEl);
  }

  const maybeCellOf = (row: number, col: number): HTMLElement | null =>
    gridEl.querySelector<HTMLElement>(`[${CELL_ROW_ATTR}="${row}"][${CELL_COL_ATTR}="${col}"]`);

  const cellOf = (row: number, col: number): HTMLElement => {
    const cell = maybeCellOf(row, col);

    if (!cell) {
      throw new Error(`no cell at ${row},${col}`);
    }

    return cell;
  };

  const seedCell = (r: number, c: number): void => {
    const cell = maybeCellOf(r, c);
    const container = cell?.querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

    if (!container) {
      return;
    }

    const block = makeBlock(`b-${r}-${c}`, 'paragraph', { text: `r${r}c${c}` }, {});

    container.appendChild(block.holder);
    model.setCellBlocks(r, c, [block.id]);
  };

  if (options.seed !== false) {
    Array.from({ length: rows }, (_, r) => r).forEach((r) => {
      Array.from({ length: cols }, (_, c) => c).forEach((c) => seedCell(r, c));
    });
  }

  return {
    subsystems,
    gridEl,
    model,
    grid,
    host,
    api,
    insertCalls,
    setBlockParent,
    ensureCellHasBlock,
    focusClearedCell,
    ensureScrollContainer: ensureScrollContainerSpy,
    transactions,
    scrollLeft: (): number => scrollLeftValue,
    cellOf,
    maybeCellOf,
    textOf: (row: number, col: number): string => cellOf(row, col).textContent ?? '',
    idsOf: (row: number, col: number): string[] =>
      Array.from(cellOf(row, col).querySelectorAll('[data-blok-id]'))
        .map((el) => el.getAttribute('data-blok-id'))
        .filter((id): id is string => id !== null),
    write: (row: number, col: number, html: string): void => {
      const editable = cellOf(row, col).querySelector<HTMLElement>('[contenteditable="true"]');

      if (!editable) {
        throw new Error(`cell ${row},${col} has no editable`);
      }

      editable.innerHTML = html;
    },
    blockOf: (id: string): BlockAPI | undefined => registry.get(id),
    setTunes: (row: number, col: number, tunes: Record<string, unknown>): void => {
      const id = cellOf(row, col).querySelector('[data-blok-id]')?.getAttribute('data-blok-id');
      const block = id === null || id === undefined ? undefined : registry.get(id);

      if (!block) {
        throw new Error(`cell ${row},${col} has no block`);
      }

      Object.defineProperty(block, 'preservedTunes', { value: tunes, configurable: true });
    },
  };
};

const resetCaptures = (): void => {
  captured.addControls.length = 0;
  captured.addControlsSelf.length = 0;
  captured.cornerDrag.length = 0;
  captured.cornerDragSelf.length = 0;
  captured.rowColControls.length = 0;
  captured.rowColControlsSelf.length = 0;
  captured.cellSelection.length = 0;
  captured.cellSelectionSelf.length = 0;
  captured.resize.length = 0;
  captured.resizeSelf.length = 0;
  captured.scrollHazeSelf.length = 0;
  captured.actionCalls.length = 0;
  captured.duringAction = null;
  captured.popoverOpen = false;
};

// ─── Clipboard helpers ─────────────────────────────────────────────

interface ClipEntry {
  row: number;
  col: number;
  blocks: ClipboardBlockData[];
  color?: string;
  textColor?: string;
  placement?: CellPlacement;
  colspan?: number;
  rowspan?: number;
}

const para = (text: string): ClipboardBlockData => ({ tool: 'paragraph', data: { text } });

const clipHtml = (entries: ClipEntry[]): string => buildClipboardHtml(serializeCellsToClipboard(entries));

/** Focus a cell's editable and fire a real paste event at it. */
const pasteInto = (harness: Harness, row: number, col: number, html: string): Event => {
  const editable = harness.cellOf(row, col).querySelector<HTMLElement>('[contenteditable="true"]');

  if (!editable) {
    throw new Error(`cell ${row},${col} has no editable to focus`);
  }

  editable.focus();

  return pasteAt(editable, html);
};

const pasteAt = (target: HTMLElement, html: string): Event => {
  const event = new Event('paste', { bubbles: true, cancelable: true });

  Object.defineProperty(event, 'clipboardData', {
    // Only 'text/html' carries the payload — a handler asking for anything else
    // must come back empty, the way a real DataTransfer behaves.
    value: { getData: (flavour: string): string => (flavour === 'text/html' ? html : '') },
  });

  target.dispatchEvent(event);

  return event;
};

/** Put a collapsed caret at the end of a cell's editable. */
const caretAtEndOf = (harness: Harness, row: number, col: number): HTMLElement => {
  const editable = harness.cellOf(row, col).querySelector<HTMLElement>('[contenteditable="true"]');

  if (!editable) {
    throw new Error(`cell ${row},${col} has no editable`);
  }

  editable.focus();

  const range = document.createRange();

  range.selectNodeContents(editable);
  range.collapse(false);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);

  return editable;
};

beforeEach(() => {
  vi.clearAllMocks();
  resetCaptures();
});

afterEach(() => {
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
  // restoreAllMocks does NOT undo vi.stubGlobal; the clipboard stub would leak
  // into whatever test runs next.
  vi.unstubAllGlobals();
});

describe('grid paste — guards', () => {
  it('constructs every collaborator on initAll', () => {
    createHarness();

    expect(captured.addControls).toHaveLength(1);
    expect(captured.cornerDrag).toHaveLength(1);
    expect(captured.rowColControls).toHaveLength(1);
    expect(captured.cellSelection).toHaveLength(1);
    expect(captured.resize).toHaveLength(1);
    expect(captured.scrollHazeSelf).toHaveLength(1);
  });

  it('pastes a 2x2 payload over the whole grid', () => {
    const harness = createHarness();
    const html = clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
      { row: 1, col: 0, blocks: [para('P10')] },
      { row: 1, col: 1, blocks: [para('P11')] },
    ]);

    const event = pasteInto(harness, 0, 0, html);

    expect(event.defaultPrevented).toBe(true);
    expect(harness.textOf(0, 0)).toBe('P00');
    expect(harness.textOf(0, 1)).toBe('P01');
    expect(harness.textOf(1, 0)).toBe('P10');
    expect(harness.textOf(1, 1)).toBe('P11');
  });

  it('ignores the paste in read-only mode', () => {
    const harness = createHarness({ readOnly: true });

    const event = pasteInto(harness, 0, 0, clipHtml([{ row: 0, col: 0, blocks: [para('P00')] }, { row: 0, col: 1, blocks: [para('P01')] }]));

    expect(event.defaultPrevented).toBe(false);
    expect(harness.textOf(0, 0)).toBe('r0c0');
  });

  it('ignores a paste with no clipboard data', () => {
    const harness = createHarness();
    const editable = harness.cellOf(0, 0).querySelector<HTMLElement>('[contenteditable="true"]');

    editable?.focus();
    editable?.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }));

    expect(harness.textOf(0, 0)).toBe('r0c0');
  });

  it('leaves an already-handled paste alone', () => {
    const harness = createHarness();
    const editable = harness.cellOf(0, 0).querySelector<HTMLElement>('[contenteditable="true"]');

    editable?.addEventListener('paste', (e) => e.preventDefault());

    pasteInto(harness, 0, 0, clipHtml([{ row: 0, col: 0, blocks: [para('P00')] }, { row: 0, col: 1, blocks: [para('P01')] }]));

    expect(harness.textOf(0, 0)).toBe('r0c0');
  });

  it('ignores clipboard HTML that is not a table', () => {
    const harness = createHarness();

    const event = pasteInto(harness, 0, 0, '<p>just a paragraph</p>');

    expect(event.defaultPrevented).toBe(false);
    expect(harness.textOf(0, 0)).toBe('r0c0');
  });

  it('pastes a plain external HTML table', () => {
    const harness = createHarness();

    pasteInto(harness, 0, 0, '<table><tr><td>X00</td><td>X01</td></tr></table>');

    expect(harness.textOf(0, 0)).toBe('X00');
    expect(harness.textOf(0, 1)).toBe('X01');
  });

  it('hands a multi-table external paste to the document-level paste path', () => {
    const harness = createHarness();

    const event = pasteInto(
      harness,
      0,
      0,
      '<table><tr><td>X00</td></tr></table><table><tr><td>Y00</td></tr></table>'
    );

    expect(event.defaultPrevented).toBe(false);
    expect(harness.textOf(0, 0)).toBe('r0c0');
  });

  it('still pastes a Blok payload whose HTML carries more than one table', () => {
    const harness = createHarness();
    const payload = clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]);

    pasteInto(harness, 0, 0, `${payload}<table><tr><td>decoy</td></tr></table>`);

    expect(harness.textOf(0, 0)).toBe('P00');
  });

  it('ignores a paste whose focus is outside the table', () => {
    const harness = createHarness();
    const outside = document.createElement('div');

    outside.setAttribute('tabindex', '0');
    document.body.appendChild(outside);
    outside.focus();

    pasteAt(outside, clipHtml([{ row: 0, col: 0, blocks: [para('P00')] }, { row: 0, col: 1, blocks: [para('P01')] }]));

    expect(harness.textOf(0, 0)).toBe('r0c0');
  });

  it('ignores a paste aimed at a cell of a different table', () => {
    const harness = createHarness();
    const other = createHarness();

    // The event bubbles to BOTH grids' listeners; only the owning grid may act.
    const event = pasteInto(other, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]));

    expect(event.defaultPrevented).toBe(true);
    expect(other.textOf(0, 0)).toBe('P00');
    expect(harness.textOf(0, 0)).toBe('r0c0');
  });

  it('ignores a paste into a cell that sits outside any row', () => {
    const harness = createHarness();
    const strayCell = document.createElement('div');
    const strayEditable = document.createElement('div');

    strayCell.setAttribute(CELL_ATTR, '');
    strayEditable.setAttribute('tabindex', '0');
    strayCell.appendChild(strayEditable);
    harness.gridEl.appendChild(strayCell);
    strayEditable.focus();

    const event = pasteAt(strayEditable, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]));

    expect(event.defaultPrevented).toBe(false);
    expect(harness.textOf(0, 0)).toBe('r0c0');
  });

  it('stops the paste event from reaching the editor-level paste handler', () => {
    const harness = createHarness();
    const editorLevel = vi.fn();

    document.body.addEventListener('paste', editorLevel);

    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]));
    document.body.removeEventListener('paste', editorLevel);

    expect(editorLevel).not.toHaveBeenCalled();
  });

  it('stops listening once the subsystems are torn down', () => {
    const harness = createHarness();

    harness.subsystems.teardown();
    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]));

    expect(harness.textOf(0, 0)).toBe('r0c0');
  });
});

describe('grid paste — single cell', () => {
  it('inserts a 1x1 text payload at the caret instead of replacing the cell', () => {
    const harness = createHarness();
    const editable = caretAtEndOf(harness, 0, 0);
    const idsBefore = harness.idsOf(0, 0);

    pasteAt(editable, clipHtml([{ row: 0, col: 0, blocks: [para('TAIL')] }]));

    expect(editable.textContent).toBe('r0c0TAIL');
    expect(harness.idsOf(0, 0)).toEqual(idsBefore);
  });

  it('joins several text blocks of one cell with line breaks', () => {
    const harness = createHarness();
    const editable = caretAtEndOf(harness, 0, 0);

    pasteAt(editable, clipHtml([{ row: 0, col: 0, blocks: [para('one'), para('two')] }]));

    expect(editable.innerHTML).toBe('r0c0one<br>two');
  });

  it('replaces the selected text when the caret is a range', () => {
    const harness = createHarness();
    const editable = caretAtEndOf(harness, 0, 0);
    const textNode = editable.firstChild;

    if (textNode === null) {
      throw new Error('editable has no text node');
    }

    const range = document.createRange();

    range.setStart(textNode, 0);
    range.setEnd(textNode, 4);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    pasteAt(editable, clipHtml([{ row: 0, col: 0, blocks: [para('NEW')] }]));

    expect(editable.textContent).toBe('NEW');
  });

  it('leaves the caret after the inserted text', () => {
    const harness = createHarness();
    const editable = caretAtEndOf(harness, 0, 0);

    pasteAt(editable, clipHtml([{ row: 0, col: 0, blocks: [para('TAIL')] }]));

    const range = window.getSelection()?.getRangeAt(0);

    expect(range?.collapsed).toBe(true);
    expect(range?.startOffset).toBe('TAIL'.length);
    expect(range?.startContainer.textContent).toBe('TAIL');
  });

  it('inserts nothing when the single cell carries no text', () => {
    const harness = createHarness();
    const editable = caretAtEndOf(harness, 0, 0);

    pasteAt(editable, clipHtml([{ row: 0, col: 0, blocks: [{ tool: 'paragraph', data: { text: '' } }] }]));

    expect(editable.textContent).toBe('r0c0');
  });

  it('inserts nothing when there is no caret at all', () => {
    const harness = createHarness();
    const editable = harness.cellOf(0, 0).querySelector<HTMLElement>('[contenteditable="true"]');

    editable?.focus();
    window.getSelection()?.removeAllRanges();

    pasteAt(harness.cellOf(0, 0), clipHtml([{ row: 0, col: 0, blocks: [para('TAIL')] }]));

    expect(harness.textOf(0, 0)).toBe('r0c0');
  });

  it('recreates a non-text 1x1 payload as real blocks instead of joining its text', () => {
    const harness = createHarness();

    caretAtEndOf(harness, 0, 0);
    pasteInto(harness, 0, 0, clipHtml([{ row: 0, col: 0, blocks: [{ tool: 'image', data: { url: 'pic.png' } }] }]));

    expect(harness.insertCalls).toHaveLength(1);
    expect(harness.insertCalls[0].tool).toBe('image');
    expect(harness.idsOf(0, 0)).toHaveLength(1);
  });

  it('recreates a paragraph whose text is not a string as a real block', () => {
    const harness = createHarness();

    caretAtEndOf(harness, 0, 0);
    pasteInto(harness, 0, 0, clipHtml([{ row: 0, col: 0, blocks: [{ tool: 'paragraph', data: { text: 42 } }] }]));

    expect(harness.insertCalls).toHaveLength(1);
    expect(harness.insertCalls[0].data).toEqual({ text: 42 });
  });

  it('recreates a mixed 1x1 payload rather than dropping the non-text block', () => {
    const harness = createHarness();

    caretAtEndOf(harness, 0, 0);
    pasteInto(harness, 0, 0, clipHtml([{
      row: 0,
      col: 0,
      blocks: [para('caption'), { tool: 'image', data: { url: 'pic.png' } }],
    }]));

    expect(harness.insertCalls.map((call) => call.tool)).toEqual(['paragraph', 'image']);
  });
});

describe('grid paste — rectangle', () => {
  const twoByTwo = (): string => clipHtml([
    { row: 0, col: 0, blocks: [para('P00')] },
    { row: 0, col: 1, blocks: [para('P01')] },
    { row: 1, col: 0, blocks: [para('P10')] },
    { row: 1, col: 1, blocks: [para('P11')] },
  ]);

  it('grows the grid when the payload runs past its edges', () => {
    const harness = createHarness({ initialColWidth: 33.337 });

    pasteInto(harness, 1, 1, twoByTwo());

    expect(harness.model.rows).toBe(3);
    expect(harness.model.cols).toBe(3);
    expect(harness.textOf(1, 1)).toBe('P00');
    expect(harness.textOf(2, 2)).toBe('P11');
  });

  it('adds no rows or columns when the payload fits', () => {
    const harness = createHarness();

    pasteInto(harness, 0, 0, twoByTwo());

    expect(harness.model.rows).toBe(2);
    expect(harness.model.cols).toBe(2);
  });

  it('gives each grown column half the table initial width', () => {
    const harness = createHarness({ initialColWidth: 33.337, colWidths: [40, 60] });

    pasteInto(harness, 0, 1, twoByTwo());

    expect(harness.model.colWidths).toEqual([40, 60, 16.67]);
  });

  it('averages the existing widths for a grown column when there is no initial width', () => {
    const harness = createHarness({ colWidths: [40, 60] });

    pasteInto(harness, 0, 1, twoByTwo());

    expect(harness.model.colWidths).toEqual([40, 60, 25]);
  });

  it('records the pasted block ids in the model', () => {
    const harness = createHarness();

    pasteInto(harness, 0, 0, twoByTwo());

    expect(harness.model.getCellBlocks(1, 1)).toEqual(harness.idsOf(1, 1));
    expect(harness.model.getCellBlocks(1, 1)).toHaveLength(1);
  });

  it('restores cell colours and text colours from the payload', () => {
    const harness = createHarness();

    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')], color: 'rgb(255, 0, 0)', textColor: 'rgb(0, 0, 255)' },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]));

    expect(harness.model.getCellColor(0, 0)).toBe('rgb(255, 0, 0)');
    expect(harness.model.getCellTextColor(0, 0)).toBe('rgb(0, 0, 255)');
    expect(harness.cellOf(0, 0).style.backgroundColor).toBe('rgb(255, 0, 0)');
    expect(harness.cellOf(0, 0).style.color).toBe('rgb(0, 0, 255)');
  });

  it('clears a destination colour the payload does not carry', () => {
    const harness = createHarness();

    harness.model.setCellColor(0, 1, 'rgb(1, 2, 3)');
    harness.cellOf(0, 1).style.backgroundColor = 'rgb(1, 2, 3)';

    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]));

    expect(harness.model.getCellColor(0, 1)).toBeUndefined();
    expect(harness.cellOf(0, 1).style.backgroundColor).toBe('');
  });

  it('restores the 9-way content placement from the payload', () => {
    const harness = createHarness();

    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')], placement: 'bottom-right' },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]));

    expect(harness.model.getCellPlacement(0, 0)).toBe('bottom-right');
    expect(harness.cellOf(0, 0).querySelector('[data-blok-cell-placement]')?.getAttribute('data-blok-cell-placement'))
      .toBe('bottom-right');
  });

  it('clears a destination placement the payload does not carry', () => {
    const harness = createHarness();
    const container = harness.cellOf(0, 1).querySelector(`[${CELL_BLOCKS_ATTR}]`);

    harness.model.setCellPlacement(0, 1, 'middle-center');
    container?.setAttribute('data-blok-cell-placement', 'middle-center');

    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]));

    expect(harness.model.getCellPlacement(0, 1)).toBeUndefined();
    expect(container?.hasAttribute('data-blok-cell-placement')).toBe(false);
  });

  it('leaves the caret in the last pasted cell', () => {
    const harness = createHarness();

    pasteInto(harness, 0, 0, twoByTwo());

    expect(harness.api.caret.setToBlock).toHaveBeenCalledWith(harness.idsOf(1, 1)[0], 'end');
  });

  it('places no caret when the table has no cell-blocks manager', () => {
    const harness = createHarness();

    harness.host.cellBlocks = null;
    pasteInto(harness, 0, 0, twoByTwo());

    expect(harness.api.caret.setToBlock).not.toHaveBeenCalled();
  });

  it('places no caret when the last pasted cell ended up empty', () => {
    const harness = createHarness();

    harness.ensureCellHasBlock.mockImplementation(() => undefined);
    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [] },
    ]));

    expect(harness.api.caret.setToBlock).not.toHaveBeenCalled();
  });

  it('re-seeds an empty payload cell with a fresh block', () => {
    const harness = createHarness();

    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [] },
    ]));

    expect(harness.ensureCellHasBlock).toHaveBeenCalledWith(harness.cellOf(0, 1));
  });

  it('carries the tunes of every pasted block', () => {
    const harness = createHarness();

    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [{ tool: 'paragraph', data: { text: 'P00' }, tunes: { align: 'center' } }] },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]));

    expect(harness.insertCalls[0].tunes).toEqual({ align: 'center' });
    expect(harness.insertCalls[1].tunes).toBeUndefined();
  });

  it('re-parents every pasted block to the table block', () => {
    const harness = createHarness();

    pasteInto(harness, 0, 0, twoByTwo());

    expect(harness.setBlockParent).toHaveBeenCalledTimes(4);
    expect(harness.setBlockParent).toHaveBeenCalledWith(harness.idsOf(0, 0)[0], 'table-1');
  });

  it('falls back to an empty parent id when the table block has none', () => {
    const harness = createHarness({ blockId: undefined });

    pasteInto(harness, 0, 0, twoByTwo());

    expect(harness.setBlockParent).toHaveBeenCalledWith(harness.idsOf(0, 0)[0], '');
  });

  it('refreshes the widths, add-controls and grips after a paste', () => {
    const harness = createHarness();

    captured.resize.length = 0;
    pasteInto(harness, 0, 0, twoByTwo());

    expect(captured.resize.length).toBeGreaterThan(0);
    expect(addControlsMock().syncRowButtonWidth).toHaveBeenCalled();
    expect(rowColMock().refresh).toHaveBeenCalled();
  });

  it('runs the whole paste in one transaction', () => {
    const harness = createHarness();

    harness.transactions.length = 0;
    pasteInto(harness, 0, 0, twoByTwo());

    expect(harness.transactions).toEqual(['transacted']);
  });
});

describe('grid paste — merges', () => {
  it('rebuilds the merge a copied region carried', () => {
    const harness = createHarness({ rows: 3, cols: 3 });

    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('WIDE')], colspan: 2 },
      { row: 1, col: 0, blocks: [para('P10')] },
      { row: 1, col: 1, blocks: [para('P11')] },
    ]));

    expect(harness.model.getCellSpan(0, 0)).toEqual({ colspan: 2, rowspan: 1 });
    expect(harness.host.rebuildTableBody).toHaveBeenCalled();
  });

  it('rebuilds a row-spanning merge at the destination offset', () => {
    const harness = createHarness({ rows: 3, cols: 3 });

    pasteInto(harness, 1, 1, clipHtml([
      { row: 0, col: 0, blocks: [para('TALL')], rowspan: 2 },
      { row: 0, col: 1, blocks: [para('P01')] },
      { row: 1, col: 1, blocks: [para('P11')] },
    ]));

    expect(harness.model.getCellSpan(1, 1)).toEqual({ colspan: 1, rowspan: 2 });
    expect(harness.model.getCellSpan(0, 0)).toEqual({ colspan: 1, rowspan: 1 });
  });

  it('clamps a span that reaches past the payload edge', () => {
    const harness = createHarness({ rows: 4, cols: 4 });

    pasteInto(harness, 0, 0, buildClipboardHtml({
      rows: 2,
      cols: 2,
      cells: [
        [{ blocks: [para('WIDE')], colspan: 5, rowspan: 1 }, { blocks: [], covered: true }],
        [{ blocks: [para('P10')] }, { blocks: [para('P11')] }],
      ],
    }));

    expect(harness.model.getCellSpan(0, 0)).toEqual({ colspan: 2, rowspan: 1 });
  });

  it('leaves a flat payload flat', () => {
    const harness = createHarness();

    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]));

    expect(harness.model.hasMerges()).toBe(false);
    expect(harness.host.rebuildTableBody).not.toHaveBeenCalled();
  });

  it('never writes into a merge-covered payload position', () => {
    const harness = createHarness();

    // A covered position with no span anywhere: no merge is rebuilt, so the
    // only thing under test is that the covered slot is skipped.
    pasteInto(harness, 0, 0, buildClipboardHtml({
      rows: 1,
      cols: 2,
      cells: [[{ blocks: [para('P00')] }, { blocks: [para('GHOST')], covered: true }]],
    }));

    expect(harness.textOf(0, 0)).toBe('P00');
    expect(harness.textOf(0, 1)).toBe('r0c1');
  });

  it('clears the cells a rebuilt merge swallows but keeps its origin', () => {
    const harness = createHarness({ rows: 2, cols: 3 });

    harness.model.setCellColor(0, 1, 'rgb(9, 9, 9)');

    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('WIDE')], colspan: 2 },
      { row: 1, col: 0, blocks: [para('P10')] },
      { row: 1, col: 1, blocks: [para('P11')] },
    ]));

    expect(harness.textOf(0, 0)).toBe('WIDE');
    expect(harness.model.getCellColor(0, 1)).toBeUndefined();
    expect(harness.idsOf(0, 1)).toEqual([]);
  });

  it('splits a destination merge so no pasted cell is dropped', () => {
    const harness = createHarness({
      rows: 2,
      cols: 2,
      merges: [{ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 }],
      liveRebuild: true,
    });

    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]));

    expect(harness.model.hasMerges()).toBe(false);
    expect(harness.textOf(0, 0)).toBe('P00');
    expect(harness.textOf(0, 1)).toBe('P01');
  });

  it('splits a destination merge whose origin sits outside the pasted region', () => {
    const harness = createHarness({
      rows: 4,
      cols: 2,
      merges: [{ minRow: 1, maxRow: 2, minCol: 1, maxCol: 1 }],
      liveRebuild: true,
    });

    // The pasted region covers (2,1) only; its merge origin (1,1) is above it.
    pasteInto(harness, 2, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]));

    expect(harness.model.hasMerges()).toBe(false);
    expect(harness.textOf(2, 0)).toBe('P00');
    expect(harness.textOf(2, 1)).toBe('P01');
  });

  it('leaves an unmerged destination untouched', () => {
    const harness = createHarness({ liveRebuild: true });

    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]));

    expect(harness.host.rebuildTableBody).not.toHaveBeenCalled();
  });
});

describe('row/column actions', () => {
  const run = (harness: Harness, action: RowColAction): void => {
    rowColOptions().onAction(action);
  };

  it('inserts an empty row above the grip', () => {
    const harness = createHarness({ rows: 3 });

    run(harness, { type: 'insert-row-above', index: 1 });

    expect(harness.model.rows).toBe(4);
    expect(harness.model.getCellBlocks(1, 0)).toEqual([]);
    expect(harness.model.getCellBlocks(2, 0)).toEqual(['b-1-0']);
  });

  it('inserts an empty row below the grip', () => {
    const harness = createHarness({ rows: 3 });

    run(harness, { type: 'insert-row-below', index: 1 });

    expect(harness.model.getCellBlocks(1, 0)).toEqual(['b-1-0']);
    expect(harness.model.getCellBlocks(2, 0)).toEqual([]);
    expect(harness.model.getCellBlocks(3, 0)).toEqual(['b-2-0']);
  });

  it('inserts an empty column left of the grip', () => {
    const harness = createHarness({ cols: 3 });

    run(harness, { type: 'insert-col-left', index: 1 });

    expect(harness.model.cols).toBe(4);
    expect(harness.model.getCellBlocks(0, 1)).toEqual([]);
    expect(harness.model.getCellBlocks(0, 2)).toEqual(['b-0-1']);
  });

  it('inserts an empty column right of the grip', () => {
    const harness = createHarness({ cols: 3 });

    run(harness, { type: 'insert-col-right', index: 1 });

    expect(harness.model.getCellBlocks(0, 1)).toEqual(['b-0-1']);
    expect(harness.model.getCellBlocks(0, 2)).toEqual([]);
    expect(harness.model.getCellBlocks(0, 3)).toEqual(['b-0-2']);
  });

  it('deletes the grip row and hands its blocks to the DOM half', () => {
    const harness = createHarness({ rows: 3 });

    run(harness, { type: 'delete-row', index: 1 });

    expect(harness.model.rows).toBe(2);
    expect(harness.model.getCellBlocks(1, 0)).toEqual(['b-2-0']);
    expect(recordedActions()[0].blocksToDelete).toEqual(['b-1-0', 'b-1-1']);
  });

  it('deletes the grip column and hands its blocks to the DOM half', () => {
    const harness = createHarness({ cols: 3 });

    run(harness, { type: 'delete-col', index: 1 });

    expect(harness.model.cols).toBe(2);
    expect(harness.model.getCellBlocks(0, 1)).toEqual(['b-0-2']);
    expect(recordedActions()[0].blocksToDelete).toEqual(['b-0-1', 'b-1-1']);
  });

  it('passes no blocks to delete for a non-deleting action', () => {
    const harness = createHarness();

    run(harness, { type: 'insert-row-above', index: 0 });

    expect(recordedActions()[0].blocksToDelete).toBeUndefined();
  });

  it('moves a row in the model', () => {
    const harness = createHarness({ rows: 3 });

    run(harness, { type: 'move-row', fromIndex: 0, toIndex: 2 });

    expect(harness.model.getCellBlocks(2, 0)).toEqual(['b-0-0']);
    expect(harness.model.getCellBlocks(0, 0)).toEqual(['b-1-0']);
  });

  it('moves a column in the model', () => {
    const harness = createHarness({ cols: 3 });

    run(harness, { type: 'move-col', fromIndex: 0, toIndex: 2 });

    expect(harness.model.getCellBlocks(0, 2)).toEqual(['b-0-0']);
    expect(harness.model.getCellBlocks(0, 0)).toEqual(['b-0-1']);
  });

  it('toggles the heading row', () => {
    const harness = createHarness();

    run(harness, { type: 'toggle-heading' });

    expect(harness.model.withHeadings).toBe(true);
    expect(harness.gridEl.querySelector(`[${ROW_ATTR}]`)?.hasAttribute('data-blok-table-heading')).toBe(true);
  });

  it('toggles the heading column', () => {
    const harness = createHarness();

    run(harness, { type: 'toggle-heading-column' });

    expect(harness.model.withHeadingColumn).toBe(true);
  });

  it('keeps the grips in place for a heading-row toggle', () => {
    const harness = createHarness();

    run(harness, { type: 'toggle-heading' });

    expect(rowColMock().refresh).not.toHaveBeenCalled();
  });

  it('keeps the grips in place for a heading-column toggle', () => {
    const harness = createHarness();

    run(harness, { type: 'toggle-heading-column' });

    expect(rowColMock().refresh).not.toHaveBeenCalled();
  });

  it('recreates the grips after a structural action', () => {
    const harness = createHarness();

    run(harness, { type: 'insert-row-above', index: 0 });

    expect(rowColMock().refresh).toHaveBeenCalledTimes(1);
  });

  it('hands the action handler the widths from BEFORE the model mutation', () => {
    const harness = createHarness({ colWidths: [40, 60] });

    run(harness, { type: 'insert-col-right', index: 0 });

    expect(recordedActions()[0].data.colWidths).toEqual([40, 60]);
  });

  it('reports the merge state from BEFORE the model mutation', () => {
    const harness = createHarness({
      rows: 3,
      cols: 2,
      merges: [{ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 }],
    });

    run(harness, { type: 'delete-row', index: 0 });

    expect(recordedActions()[0].data.hasMerges).toBe(true);
    expect(harness.model.hasMerges()).toBe(false);
  });

  it('reports no merges on a flat table', () => {
    const harness = createHarness();

    run(harness, { type: 'delete-row', index: 0 });

    expect(recordedActions()[0].data.hasMerges).toBe(false);
  });

  it('tells the DOM half a legal row move is allowed', () => {
    const harness = createHarness({ rows: 3 });

    run(harness, { type: 'move-row', fromIndex: 0, toIndex: 1 });

    expect(recordedActions()[0].data.moveAllowed).toBe(true);
  });

  it('tells the DOM half a merge-tearing row move is refused', () => {
    const harness = createHarness({
      rows: 3,
      cols: 2,
      merges: [{ minRow: 0, maxRow: 1, minCol: 0, maxCol: 0 }],
    });

    run(harness, { type: 'move-row', fromIndex: 0, toIndex: 2 });

    expect(recordedActions()[0].data.moveAllowed).toBe(false);
  });

  it('tells the DOM half a merge-tearing column move is refused', () => {
    const harness = createHarness({
      rows: 2,
      cols: 3,
      merges: [{ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 }],
    });

    run(harness, { type: 'move-col', fromIndex: 0, toIndex: 2 });

    expect(recordedActions()[0].data.moveAllowed).toBe(false);
  });

  it('treats a non-move action as always allowed', () => {
    const harness = createHarness({
      rows: 3,
      cols: 2,
      merges: [{ minRow: 0, maxRow: 1, minCol: 0, maxCol: 0 }],
    });

    run(harness, { type: 'insert-row-below', index: 2 });

    expect(recordedActions()[0].data.moveAllowed).toBe(true);
  });

  it('passes the current heading flags to the action handler', () => {
    const harness = createHarness({ withHeadings: true, withHeadingColumn: true, initialColWidth: 33.337 });

    run(harness, { type: 'insert-row-above', index: 0 });

    expect(recordedActions()[0].data.withHeadings).toBe(true);
    expect(recordedActions()[0].data.withHeadingColumn).toBe(true);
    expect(recordedActions()[0].data.initialColWidth).toBe(33.337);
  });

  it('selects the row a move landed on', () => {
    const harness = createHarness({ rows: 3 });

    run(harness, { type: 'move-row', fromIndex: 0, toIndex: 2 });

    expect(cellSelectionMock().selectRow).toHaveBeenCalledWith(2);
    expect(rowColMock().setActiveGrip).toHaveBeenCalledWith('row', 2);
  });

  it('selects the column a move landed on', () => {
    const harness = createHarness({ cols: 3 });

    run(harness, { type: 'move-col', fromIndex: 0, toIndex: 2 });

    expect(cellSelectionMock().selectColumn).toHaveBeenCalledWith(2);
    expect(rowColMock().setActiveGrip).toHaveBeenCalledWith('col', 2);
  });

  it('selects nothing after a non-move action', () => {
    const harness = createHarness();

    run(harness, { type: 'insert-row-above', index: 0 });

    expect(cellSelectionMock().selectRow).not.toHaveBeenCalled();
    expect(rowColMock().setActiveGrip).not.toHaveBeenCalled();
  });

  it('re-creates the resize handles and syncs the add-row button', () => {
    const harness = createHarness();

    captured.resize.length = 0;
    run(harness, { type: 'insert-row-above', index: 0 });

    expect(captured.resize).toHaveLength(1);
    expect(addControlsMock().syncRowButtonWidth).toHaveBeenCalledTimes(1);
  });

  it('abandons the action when the table reloaded under it', () => {
    const harness = createHarness();

    harness.host.runTransactedStructuralOp = <T>(fn: () => T): T => {
      harness.host.setDataGeneration = 7;

      return fn();
    };

    run(harness, { type: 'insert-row-above', index: 0 });

    expect(harness.model.rows).toBe(2);
    expect(recordedActions()).toHaveLength(0);
  });

  it('abandons the action when the grid element was replaced', () => {
    const harness = createHarness();

    harness.host.runTransactedStructuralOp = <T>(fn: () => T): T => {
      harness.host.gridElement = document.createElement('table');

      return fn();
    };

    run(harness, { type: 'insert-row-above', index: 0 });

    expect(harness.model.rows).toBe(2);
    expect(recordedActions()).toHaveLength(0);
  });

  it('does not write back results when the table reloaded mid-action', () => {
    const harness = createHarness({ colWidths: [40, 60] });

    captured.duringAction = (): void => {
      harness.host.setDataGeneration = 9;
    };

    run(harness, { type: 'insert-col-right', index: 0 });

    // Only the model's own addColumn ran; the handler's recomputed widths were
    // never written back.
    expect(harness.model.colWidths).toEqual([40, 0, 60]);
    expect(addControlsMock().syncRowButtonWidth).not.toHaveBeenCalled();
    expect(rowColMock().refresh).not.toHaveBeenCalled();
  });

  it('does not write back results when the grid element changed mid-action', () => {
    const harness = createHarness();

    captured.duringAction = (): void => {
      harness.host.gridElement = document.createElement('table');
    };

    run(harness, { type: 'insert-row-above', index: 0 });

    expect(addControlsMock().syncRowButtonWidth).not.toHaveBeenCalled();
  });

  it('runs the action in one transaction', () => {
    const harness = createHarness();

    harness.transactions.length = 0;
    run(harness, { type: 'insert-row-above', index: 0 });

    expect(harness.transactions).toEqual(['transacted']);
  });
});

describe('duplicate row / column', () => {
  it('copies the row content into the new row below it', () => {
    const harness = createHarness({ rows: 2, cols: 2 });

    rowColOptions().onAction({ type: 'duplicate-row', index: 0 });

    expect(harness.model.rows).toBe(3);
    expect(harness.textOf(1, 0)).toBe('r0c0');
    expect(harness.textOf(1, 1)).toBe('r0c1');
    expect(harness.textOf(2, 0)).toBe('r1c0');
  });

  it('copies the column content into the new column right of it', () => {
    const harness = createHarness({ rows: 2, cols: 2 });

    rowColOptions().onAction({ type: 'duplicate-col', index: 0 });

    expect(harness.model.cols).toBe(3);
    expect(harness.textOf(0, 1)).toBe('r0c0');
    expect(harness.textOf(1, 1)).toBe('r1c0');
    expect(harness.textOf(0, 2)).toBe('r0c1');
  });

  it('gives the copy its own block ids', () => {
    const harness = createHarness();

    rowColOptions().onAction({ type: 'duplicate-row', index: 0 });

    expect(harness.idsOf(1, 0)).not.toEqual(['b-0-0']);
    expect(harness.model.getCellBlocks(1, 0)).toEqual(harness.idsOf(1, 0));
    expect(harness.model.getCellBlocks(0, 0)).toEqual(['b-0-0']);
  });

  it('gives the copy its own data object, not the source block data', () => {
    const harness = createHarness();
    const sourceData = harness.blockOf('b-0-0')?.preservedData;

    rowColOptions().onAction({ type: 'duplicate-row', index: 0 });

    expect(harness.insertCalls[0].data).toEqual(sourceData);
    expect(harness.insertCalls[0].data).not.toBe(sourceData);
  });

  it('copies the source cell colours onto the copy', () => {
    const harness = createHarness();

    harness.model.setCellColor(0, 1, 'rgb(1, 2, 3)');
    harness.model.setCellTextColor(0, 1, 'rgb(4, 5, 6)');

    rowColOptions().onAction({ type: 'duplicate-row', index: 0 });

    expect(harness.model.getCellColor(1, 1)).toBe('rgb(1, 2, 3)');
    expect(harness.model.getCellTextColor(1, 1)).toBe('rgb(4, 5, 6)');
    expect(harness.cellOf(1, 1).style.backgroundColor).toBe('rgb(1, 2, 3)');
    expect(harness.cellOf(1, 1).style.color).toBe('rgb(4, 5, 6)');
  });

  it('copies the source cell placement onto the copy', () => {
    const harness = createHarness();

    harness.model.setCellPlacement(0, 1, 'middle-center');

    rowColOptions().onAction({ type: 'duplicate-row', index: 0 });

    expect(harness.model.getCellPlacement(1, 1)).toBe('middle-center');
    expect(harness.cellOf(1, 1).querySelector('[data-blok-cell-placement]')?.getAttribute('data-blok-cell-placement'))
      .toBe('middle-center');
  });

  it('clears a stale placement on the copy when the source has none', () => {
    const harness = createHarness();

    rowColOptions().onAction({ type: 'duplicate-row', index: 0 });

    const container = harness.cellOf(1, 0).querySelector(`[${CELL_BLOCKS_ATTR}]`);

    expect(container?.hasAttribute('data-blok-cell-placement')).toBe(false);
  });

  it('skips a merge-covered coordinate instead of inventing a span', () => {
    const harness = createHarness({
      rows: 3,
      cols: 3,
      merges: [{ minRow: 0, maxRow: 0, minCol: 1, maxCol: 2 }],
      liveRebuild: true,
    });

    rowColOptions().onAction({ type: 'duplicate-row', index: 1 });

    expect(harness.model.getCellSpan(2, 1)).toEqual({ colspan: 1, rowspan: 1 });
    expect(harness.model.hasMerges()).toBe(true);
  });
});

describe('grip row/column menu — clear and colour', () => {
  it('clears every cell of the grip row', () => {
    const harness = createHarness();

    rowColOptions().onClearContents('row', 0);

    expect(harness.idsOf(0, 0)).toEqual([]);
    expect(harness.idsOf(0, 1)).toEqual([]);
    expect(harness.idsOf(1, 0)).toEqual(['b-1-0']);
  });

  it('clears every cell of the grip column', () => {
    const harness = createHarness();

    rowColOptions().onClearContents('col', 1);

    expect(harness.idsOf(0, 1)).toEqual([]);
    expect(harness.idsOf(1, 1)).toEqual([]);
    expect(harness.idsOf(0, 0)).toEqual(['b-0-0']);
  });

  it('keeps the caret in the first cleared cell', () => {
    const harness = createHarness();

    rowColOptions().onClearContents('row', 1);

    expect(harness.focusClearedCell).toHaveBeenCalledWith(harness.cellOf(1, 0));
  });

  it('leaves the model cell entries alone so the mutation handler can re-seed', () => {
    const harness = createHarness();

    rowColOptions().onClearContents('row', 0);

    expect(harness.model.getCellBlocks(0, 0)).toEqual(['b-0-0']);
  });

  it('clears nothing in read-only mode', () => {
    const harness = createHarness({ readOnly: true });

    rowColOptions().onClearContents('row', 0);

    expect(harness.idsOf(0, 0)).toEqual(['b-0-0']);
    expect(harness.focusClearedCell).not.toHaveBeenCalled();
  });

  it('clears nothing when the grid element is gone', () => {
    const harness = createHarness();

    harness.host.gridElement = null;
    rowColOptions().onClearContents('row', 0);

    expect(harness.idsOf(0, 0)).toEqual(['b-0-0']);
  });

  it('clears nothing when there is no cell-blocks manager', () => {
    const harness = createHarness({ noCellBlocks: true });

    rowColOptions().onClearContents('row', 0);

    expect(harness.idsOf(0, 0)).toEqual(['b-0-0']);
    expect(harness.focusClearedCell).not.toHaveBeenCalled();
  });

  it('skips a row index that has no cells', () => {
    const harness = createHarness();

    rowColOptions().onClearContents('row', 9);

    expect(harness.focusClearedCell).not.toHaveBeenCalled();
  });

  it('paints every cell of the grip row', () => {
    const harness = createHarness();

    rowColOptions().onColorChange('row', 1, 'rgb(7, 8, 9)', 'backgroundColor');

    expect(harness.model.getCellColor(1, 0)).toBe('rgb(7, 8, 9)');
    expect(harness.model.getCellColor(1, 1)).toBe('rgb(7, 8, 9)');
    expect(harness.model.getCellColor(0, 0)).toBeUndefined();
    expect(harness.cellOf(1, 1).style.backgroundColor).toBe('rgb(7, 8, 9)');
  });

  it('paints every cell of the grip column with text colour', () => {
    const harness = createHarness();

    rowColOptions().onColorChange('col', 0, 'rgb(7, 8, 9)', 'textColor');

    expect(harness.model.getCellTextColor(0, 0)).toBe('rgb(7, 8, 9)');
    expect(harness.model.getCellTextColor(1, 0)).toBe('rgb(7, 8, 9)');
    expect(harness.model.getCellColor(0, 0)).toBeUndefined();
    expect(harness.cellOf(1, 0).style.color).toBe('rgb(7, 8, 9)');
  });

  it('clears a row colour when the picker hands back null', () => {
    const harness = createHarness();

    rowColOptions().onColorChange('row', 0, 'rgb(7, 8, 9)', 'backgroundColor');
    rowColOptions().onColorChange('row', 0, null, 'backgroundColor');

    expect(harness.model.getCellColor(0, 0)).toBeUndefined();
    expect(harness.cellOf(0, 0).style.backgroundColor).toBe('');
  });

  it('paints nothing in read-only mode', () => {
    const harness = createHarness({ readOnly: true });

    rowColOptions().onColorChange('row', 0, 'rgb(7, 8, 9)', 'backgroundColor');

    expect(harness.model.getCellColor(0, 0)).toBeUndefined();
  });

  it('paints nothing when the grid element is gone', () => {
    const harness = createHarness();

    harness.host.gridElement = null;
    rowColOptions().onColorChange('row', 0, 'rgb(7, 8, 9)', 'backgroundColor');

    expect(harness.model.getCellColor(0, 0)).toBeUndefined();
  });

  it('paints a merge origin once and skips its covered coordinates', () => {
    const harness = createHarness({
      rows: 2,
      cols: 3,
      merges: [{ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 }],
    });

    rowColOptions().onColorChange('row', 0, 'rgb(7, 8, 9)', 'backgroundColor');

    expect(harness.model.getCellColor(0, 0)).toBe('rgb(7, 8, 9)');
    expect(harness.model.getCellColor(0, 2)).toBe('rgb(7, 8, 9)');
  });
});

/** Move the scroll container without going through the subsystem. */
const setScrollLeft = (harness: Harness, value: number): void => {
  const container = harness.host.scrollContainer;

  if (container) {
    container.scrollLeft = value;
  }
};

/** Put raw text into a cell's block container, the way real content reads. */
const putText = (harness: Harness, row: number, col: number, text: string): void => {
  const container = harness.cellOf(row, col).querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

  if (!container) {
    throw new Error(`cell ${row},${col} has no block container`);
  }

  container.textContent = text;
};

describe('add-controls wiring', () => {
  it('reports the model size to the buttons', () => {
    createHarness({ rows: 3, cols: 4 });

    expect(addControlsOptions().getTableSize()).toEqual({ rows: 3, cols: 4 });
  });

  it('offers half the table initial column width for a new column', () => {
    createHarness({ initialColWidth: 33.337 });

    expect(addControlsOptions().getNewColumnWidth()).toBe(16.67);
  });

  it('offers half the average width when the table has no initial width', () => {
    createHarness({ colWidths: [40, 60] });

    expect(addControlsOptions().getNewColumnWidth()).toBe(25);
  });

  it('reads the rendered widths when the model carries none', () => {
    const harness = createHarness({ colWidths: [40, 60] });

    applyPixelWidths(harness.gridEl, [40, 60]);
    harness.model.setColWidths(undefined);

    expect(addControlsOptions().getNewColumnWidth()).toBe(25);
  });

  it('adds a row on the button click', () => {
    const harness = createHarness({ withHeadings: true });

    captured.resize.length = 0;
    addControlsOptions().onAddRow();

    expect(harness.model.rows).toBe(3);
    expect(harness.grid.getRowCount(harness.gridEl)).toBe(3);
    expect(harness.ensureCellHasBlock).toHaveBeenCalled();
    expect(harness.gridEl.querySelector(`[${ROW_ATTR}]`)?.hasAttribute('data-blok-table-heading')).toBe(true);
    expect(captured.resize).toHaveLength(1);
    expect(addControlsMock().syncRowButtonWidth).toHaveBeenCalledTimes(1);
    expect(rowColMock().refresh).toHaveBeenCalledTimes(1);
  });

  it('adds a column on the button click', () => {
    const harness = createHarness({ colWidths: [40, 60] });

    addControlsOptions().onAddColumn();

    expect(harness.model.cols).toBe(3);
    expect(harness.model.colWidths).toEqual([40, 60, 25]);
    expect(harness.grid.getColumnCount(harness.gridEl)).toBe(3);
    expect(harness.scrollLeft()).toBe(640);
    expect(addControlsMock().syncRowButtonWidth).toHaveBeenCalledTimes(1);
    expect(rowColMock().refresh).toHaveBeenCalledTimes(1);
  });

  it('survives a button-click column add with no scroll container', () => {
    const harness = createHarness({ noScrollContainer: true, colWidths: [40, 60] });

    addControlsOptions().onAddColumn();

    expect(harness.model.cols).toBe(3);
  });

  it('opens one undo group and parks the other affordances on drag start', () => {
    const harness = createHarness();

    addControlsOptions().onDragStart();

    expect(harness.api.blocks.beginTransaction).toHaveBeenCalledTimes(1);
    expect(resizeMock().enabled).toBe(false);
    expect(rowColMock().hideAllGrips).toHaveBeenCalledTimes(1);
    expect(rowColMock().setGripsDisplay).toHaveBeenCalledWith(false);
  });

  it('adds a row per drag step and reports it happened', () => {
    const harness = createHarness();

    expect(addControlsOptions().onDragAddRow()).toBe(true);
    expect(harness.model.rows).toBe(3);
  });

  it('refuses to drag away the last remaining row', () => {
    const harness = createHarness({ rows: 1, seed: false });

    expect(addControlsOptions().onDragRemoveRow()).toBe(false);
    expect(harness.model.rows).toBe(1);
  });

  it('refuses to drag away a trailing row that holds content', () => {
    const harness = createHarness();

    expect(addControlsOptions().onDragRemoveRow()).toBe(false);
    expect(harness.model.rows).toBe(2);
    expect(harness.textOf(1, 0)).toBe('r1c0');
  });

  it('checks the LAST row for content, not one past it', () => {
    const harness = createHarness({ rows: 2, seed: false });

    putText(harness, 1, 0, 'keep me');

    expect(addControlsOptions().onDragRemoveRow()).toBe(false);
    expect(harness.model.rows).toBe(2);
  });

  it('drags away an empty trailing row and deletes its blocks', () => {
    const harness = createHarness();

    harness.write(1, 0, '');
    harness.write(1, 1, '');

    expect(addControlsOptions().onDragRemoveRow()).toBe(true);
    expect(harness.model.rows).toBe(1);
    expect(harness.grid.getRowCount(harness.gridEl)).toBe(1);
    expect(harness.blockOf('b-1-0')).toBeUndefined();
    expect(harness.blockOf('b-0-0')).toBeDefined();
  });

  it('adds a column per drag step and repaints the pixel widths', () => {
    const harness = createHarness({ colWidths: [40, 60] });

    expect(addControlsOptions().onDragAddCol()).toBe(true);
    expect(harness.model.colWidths).toEqual([40, 60, 25]);
    expect(harness.gridEl.style.width).toBe('126px');
    expect(harness.scrollLeft()).toBe(640);
  });

  it('refuses to drag away the last remaining column', () => {
    const harness = createHarness({ cols: 1, seed: false });

    expect(addControlsOptions().onDragRemoveCol()).toBe(false);
    expect(harness.model.cols).toBe(1);
  });

  it('refuses to drag away a trailing column that holds content', () => {
    const harness = createHarness();

    expect(addControlsOptions().onDragRemoveCol()).toBe(false);
    expect(harness.model.cols).toBe(2);
    expect(harness.textOf(0, 1)).toBe('r0c1');
  });

  it('checks the LAST column for content, not one past it', () => {
    const harness = createHarness({ cols: 2, seed: false });

    putText(harness, 0, 1, 'keep me');

    expect(addControlsOptions().onDragRemoveCol()).toBe(false);
    expect(harness.model.cols).toBe(2);
  });

  it('drags away an empty trailing column and repaints the widths', () => {
    const harness = createHarness({ colWidths: [40, 60] });

    harness.write(0, 1, '');
    harness.write(1, 1, '');

    expect(addControlsOptions().onDragRemoveCol()).toBe(true);
    expect(harness.model.cols).toBe(1);
    expect(harness.model.colWidths).toEqual([40]);
    expect(harness.gridEl.style.width).toBe('41px');
    expect(harness.blockOf('b-0-1')).toBeUndefined();
  });

  it('scrolls to the new columns when the drag added some', () => {
    const harness = createHarness({ colWidths: [40, 60] });

    addControlsOptions().onDragAddCol();
    setScrollLeft(harness, 0);
    addControlsOptions().onDragEnd();

    expect(harness.scrollLeft()).toBe(640);
    expect(harness.api.blocks.endTransaction).toHaveBeenCalledTimes(1);
    expect(addControlsMock().syncRowButtonWidth).toHaveBeenCalled();
    expect(rowColMock().refresh).toHaveBeenCalled();
  });

  it('scrolls back to the start when the drag added nothing', () => {
    const harness = createHarness({ colWidths: [40, 60] });

    setScrollLeft(harness, 500);
    addControlsOptions().onDragEnd();

    expect(harness.scrollLeft()).toBe(0);
  });

  it('forgets the added-column count between drags', () => {
    const harness = createHarness({ colWidths: [40, 60] });

    addControlsOptions().onDragAddCol();
    addControlsOptions().onDragEnd();
    setScrollLeft(harness, 500);
    addControlsOptions().onDragEnd();

    expect(harness.scrollLeft()).toBe(0);
  });

  it('does not count a column the drag removed again', () => {
    const harness = createHarness({ colWidths: [40, 60], seed: false });

    addControlsOptions().onDragAddCol();
    expect(addControlsOptions().onDragRemoveCol()).toBe(true);
    setScrollLeft(harness, 500);
    addControlsOptions().onDragEnd();

    expect(harness.scrollLeft()).toBe(0);
  });

  it('is not created for a table with no wrapper element', () => {
    createHarness({ noElement: true });

    expect(captured.addControls).toHaveLength(0);
  });

  it('hands the existing scroll container to the buttons at init', () => {
    createHarness();

    expect(addControlsMock().attachScrollContainer).toHaveBeenCalledTimes(1);
  });

  it('does not attach a scroll container the table does not have yet', () => {
    createHarness({ noScrollContainer: true });

    expect(addControlsMock().attachScrollContainer).not.toHaveBeenCalled();
  });

  it('forwards a freshly created scroll container to the buttons', () => {
    const harness = createHarness();
    const container = document.createElement('div');

    harness.subsystems.attachScrollContainer(container);

    expect(addControlsMock().attachScrollContainer).toHaveBeenLastCalledWith(container);
  });
});

describe('corner-drag wiring', () => {
  it('reports the model size to the corner', () => {
    createHarness({ rows: 3, cols: 4 });

    expect(cornerDragOptions().getTableSize()).toEqual({ rows: 3, cols: 4 });
  });

  it('adds a row on the corner drag', () => {
    const harness = createHarness({ withHeadings: true });

    cornerDragOptions().onAddRow();

    expect(harness.model.rows).toBe(3);
    expect(harness.grid.getRowCount(harness.gridEl)).toBe(3);
    expect(harness.ensureCellHasBlock).toHaveBeenCalled();
  });

  it('lays down a FULL-width column, not the half-width the insert paths use', () => {
    const harness = createHarness({ initialColWidth: 33.337, colWidths: [40, 60] });

    cornerDragOptions().onAddColumn();

    expect(harness.model.colWidths).toEqual([40, 60, 33.337]);
  });

  it('falls back to the average column width when there is no initial width', () => {
    const harness = createHarness({ colWidths: [40, 60] });

    cornerDragOptions().onAddColumn();

    expect(harness.model.colWidths).toEqual([40, 60, 50]);
    expect(harness.gridEl.style.width).toBe('151px');
  });

  it('refreshes the overflow haze when the new column overflows', () => {
    const harness = createHarness({ colWidths: [40, 60] });

    cornerDragOptions().onAddColumn();

    expect(scrollHazeMock().update).toHaveBeenCalled();
    expect(harness.model.cols).toBe(3);
  });

  it('removes the last row on the corner drag', () => {
    const harness = createHarness({ rows: 3 });

    cornerDragOptions().onRemoveLastRow();

    expect(harness.model.rows).toBe(2);
    expect(harness.grid.getRowCount(harness.gridEl)).toBe(2);
    expect(harness.blockOf('b-2-0')).toBeUndefined();
  });

  it('keeps the last remaining row', () => {
    const harness = createHarness({ rows: 1 });

    cornerDragOptions().onRemoveLastRow();

    expect(harness.model.rows).toBe(1);
  });

  it('removes the last column on the corner drag and repaints the widths', () => {
    const harness = createHarness({ cols: 3, colWidths: [30, 40, 50] });

    cornerDragOptions().onRemoveLastColumn();

    expect(harness.model.cols).toBe(2);
    expect(harness.model.colWidths).toEqual([30, 40]);
    expect(harness.gridEl.style.width).toBe('71px');
    expect(harness.blockOf('b-0-2')).toBeUndefined();
  });

  it('keeps the last remaining column', () => {
    const harness = createHarness({ cols: 1 });

    cornerDragOptions().onRemoveLastColumn();

    expect(harness.model.cols).toBe(1);
  });

  it('allows removing an empty trailing row', () => {
    createHarness({ seed: false });

    expect(cornerDragOptions().canRemoveLastRow()).toBe(true);
    expect(cornerDragOptions().canRemoveLastColumn()).toBe(true);
  });

  it('refuses to shrink over a trailing row that holds content', () => {
    createHarness();

    expect(cornerDragOptions().canRemoveLastRow()).toBe(false);
  });

  it('refuses to shrink over a trailing column that holds content', () => {
    createHarness();

    expect(cornerDragOptions().canRemoveLastColumn()).toBe(false);
  });

  it('checks the LAST row for content, not one past it', () => {
    const harness = createHarness({ seed: false });

    putText(harness, 1, 0, 'keep me');

    expect(cornerDragOptions().canRemoveLastRow()).toBe(false);
  });

  it('checks the LAST column for content, not one past it', () => {
    const harness = createHarness({ seed: false });

    putText(harness, 0, 1, 'keep me');

    expect(cornerDragOptions().canRemoveLastColumn()).toBe(false);
  });

  it('never shrinks a 1x1 table', () => {
    createHarness({ rows: 1, cols: 1, seed: false });

    expect(cornerDragOptions().canRemoveLastRow()).toBe(false);
    expect(cornerDragOptions().canRemoveLastColumn()).toBe(false);
  });

  it('opens one undo group and parks every other affordance on drag start', () => {
    const harness = createHarness();

    cornerDragOptions().onDragStart();

    expect(harness.api.blocks.beginTransaction).toHaveBeenCalledTimes(1);
    expect(resizeMock().enabled).toBe(false);
    expect(rowColMock().hideAllGrips).toHaveBeenCalledTimes(1);
    expect(rowColMock().setGripsDisplay).toHaveBeenCalledWith(false);
    expect(addControlsMock().setDisplay).toHaveBeenCalledWith(false);
  });

  it('restores every affordance and closes the undo group on drag end', () => {
    const harness = createHarness();

    captured.resize.length = 0;
    cornerDragOptions().onDragEnd();

    expect(captured.resize).toHaveLength(1);
    expect(rowColMock().refresh).toHaveBeenCalledTimes(1);
    expect(addControlsMock().setDisplay).toHaveBeenCalledWith(true);
    expect(addControlsMock().syncRowButtonWidth).toHaveBeenCalledTimes(1);
    expect(cornerDragMock().syncPosition).toHaveBeenCalledTimes(1);
    expect(harness.api.blocks.endTransaction).toHaveBeenCalledTimes(1);
  });

  it('adds one row AND one column on the corner tap', () => {
    const harness = createHarness({ colWidths: [40, 60] });

    cornerDragOptions().onClickAdd();

    expect(harness.model.rows).toBe(3);
    expect(harness.model.cols).toBe(3);
    expect(harness.model.colWidths).toEqual([40, 60, 25]);
    expect(harness.gridEl.style.width).toBe('126px');
    expect(rowColMock().refresh).toHaveBeenCalledTimes(1);
    expect(addControlsMock().syncRowButtonWidth).toHaveBeenCalledTimes(1);
  });

  it('is not created for a table with no wrapper element', () => {
    createHarness({ noElement: true });

    expect(captured.cornerDrag).toHaveLength(0);
  });

  it('hands the existing scroll container to the corner at init', () => {
    createHarness();

    expect(cornerDragMock().attachScrollContainer).toHaveBeenCalledTimes(1);
  });

  it('does not attach a scroll container the table does not have yet', () => {
    createHarness({ noScrollContainer: true });

    expect(cornerDragMock().attachScrollContainer).not.toHaveBeenCalled();
  });

  it('runs a corner add outside the transaction wrapper the buttons use', () => {
    const harness = createHarness();

    harness.transactions.length = 0;
    cornerDragOptions().onAddRow();

    expect(harness.transactions).toEqual(['structural']);
  });

  it('runs the corner tap inside a transaction', () => {
    const harness = createHarness();

    harness.transactions.length = 0;
    cornerDragOptions().onClickAdd();

    expect(harness.transactions).toEqual(['transacted']);
  });
});

describe('row/column controls wiring', () => {
  it('hands the grips the grid, the overlay and the scroll container', () => {
    const harness = createHarness();

    expect(rowColOptions().grid).toBe(harness.gridEl);
    expect(rowColOptions().overlay).toBe(harness.host.gripOverlay);
    expect(rowColOptions().scrollContainer).toBe(harness.host.scrollContainer);
  });

  it('passes no overlay when the table has none', () => {
    createHarness({ noGripOverlay: true, noScrollContainer: true });

    expect(rowColOptions().overlay).toBeUndefined();
    expect(rowColOptions().scrollContainer).toBeUndefined();
  });

  it('reports the live row and column counts', () => {
    const harness = createHarness({ rows: 3, cols: 4 });

    expect(rowColOptions().getRowCount()).toBe(3);
    expect(rowColOptions().getColumnCount()).toBe(4);

    harness.grid.addRow(harness.gridEl);

    expect(rowColOptions().getRowCount()).toBe(4);
  });

  it('reports the heading flags', () => {
    const harness = createHarness({ withHeadings: true });

    expect(rowColOptions().isHeadingRow()).toBe(true);
    expect(rowColOptions().isHeadingColumn()).toBe(false);

    harness.model.setWithHeadingColumn(true);

    expect(rowColOptions().isHeadingColumn()).toBe(true);
  });

  it('asks the model per index whether a row or column can be dragged', () => {
    createHarness({
      rows: 3,
      cols: 3,
      merges: [{ minRow: 0, maxRow: 1, minCol: 0, maxCol: 0 }],
    });

    expect(rowColOptions().canDrag('row', 0)).toBe(false);
    expect(rowColOptions().canDrag('row', 2)).toBe(true);
    expect(rowColOptions().canDrag('col', 0)).toBe(true);
  });

  it('asks the model per index whether a column can be dragged', () => {
    createHarness({
      rows: 3,
      cols: 3,
      merges: [{ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 }],
    });

    expect(rowColOptions().canDrag('col', 0)).toBe(false);
    expect(rowColOptions().canDrag('col', 2)).toBe(true);
    expect(rowColOptions().canDrag('row', 0)).toBe(true);
  });

  it('asks the model whether the drop target is legal', () => {
    createHarness({
      rows: 3,
      cols: 3,
      merges: [{ minRow: 0, maxRow: 1, minCol: 0, maxCol: 0 }],
    });

    expect(rowColOptions().canDrop('row', 0, 2)).toBe(false);
    expect(rowColOptions().canDrop('col', 0, 9)).toBe(false);
  });

  it('allows a drop on a table with no merges', () => {
    createHarness({ rows: 3, cols: 3 });

    expect(rowColOptions().canDrop('row', 0, 2)).toBe(true);
    expect(rowColOptions().canDrop('col', 0, 2)).toBe(true);
  });

  it('parks the other affordances and paints the picked-up row', () => {
    const harness = createHarness();

    rowColOptions().onDragStateChange(true, 'row', 1);

    expect(resizeMock().enabled).toBe(false);
    expect(addControlsMock().setDisplay).toHaveBeenCalledWith(false);
    expect(cornerDragMock().setDisplay).toHaveBeenCalledWith(false);
    expect(harness.api.toolbar.close).toHaveBeenCalledWith({ setExplicitlyClosed: false });
    expect(cellSelectionMock().selectRow).toHaveBeenCalledWith(1);
  });

  it('paints the picked-up column', () => {
    createHarness();

    rowColOptions().onDragStateChange(true, 'col', 2);

    expect(cellSelectionMock().selectColumn).toHaveBeenCalledWith(2);
    expect(cellSelectionMock().selectRow).not.toHaveBeenCalled();
  });

  it('paints nothing when the drag has no axis', () => {
    createHarness();

    rowColOptions().onDragStateChange(true, null, 0);

    expect(cellSelectionMock().selectRow).not.toHaveBeenCalled();
    expect(cellSelectionMock().selectColumn).not.toHaveBeenCalled();
  });

  it('restores the affordances when the drag ends without touching the toolbar', () => {
    const harness = createHarness();

    rowColOptions().onDragStateChange(false, null, 0);

    expect(resizeMock().enabled).toBe(true);
    expect(addControlsMock().setDisplay).toHaveBeenCalledWith(true);
    expect(cornerDragMock().setDisplay).toHaveBeenCalledWith(true);
    expect(harness.api.toolbar.close).not.toHaveBeenCalled();
    expect(cellSelectionMock().selectRow).not.toHaveBeenCalled();
  });

  it('selects the whole row or column when its grip is clicked', () => {
    createHarness();

    rowColOptions().onGripClick('row', 1);
    rowColOptions().onGripClick('col', 0);

    expect(cellSelectionMock().selectRow).toHaveBeenCalledWith(1);
    expect(cellSelectionMock().selectColumn).toHaveBeenCalledWith(0);
  });

  it('is not created for a table with no wrapper element', () => {
    createHarness({ noElement: true });

    expect(captured.rowColControls).toHaveLength(0);
  });
});

describe('grip popover close', () => {
  const flushFrame = (): void => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback): number => {
      callback(0);

      return 0;
    });
  };

  it('does nothing when no action left a row to highlight', () => {
    createHarness();

    flushFrame();
    rowColOptions().onGripPopoverClose();

    expect(rowColMock().setActiveGrip).not.toHaveBeenCalled();
  });

  it('re-highlights the row an insert created', () => {
    createHarness({ rows: 3 });

    flushFrame();
    rowColOptions().onAction({ type: 'insert-row-below', index: 1 });
    rowColOptions().onGripPopoverClose();

    expect(rowColMock().setActiveGrip).toHaveBeenCalledWith('row', 2);
    expect(cellSelectionMock().selectRow).toHaveBeenCalledWith(2);
  });

  it('re-highlights the column a heading toggle marked', () => {
    createHarness();

    flushFrame();
    rowColOptions().onAction({ type: 'toggle-heading-column' });
    rowColOptions().onGripPopoverClose();

    expect(rowColMock().setActiveGrip).toHaveBeenCalledWith('col', 0);
    expect(cellSelectionMock().selectColumn).toHaveBeenCalledWith(0);
  });

  it('locks the grip before waiting for layout', () => {
    createHarness();

    const frames: FrameRequestCallback[] = [];

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback): number => {
      frames.push(callback);

      return 0;
    });

    rowColOptions().onAction({ type: 'toggle-heading' });
    rowColOptions().onGripPopoverClose();

    expect(rowColMock().setActiveGrip).toHaveBeenCalledWith('row', 0);
    expect(cellSelectionMock().selectRow).not.toHaveBeenCalled();

    frames[0](0);

    expect(cellSelectionMock().selectRow).toHaveBeenCalledWith(0);
  });

  it('highlights only once per action', () => {
    createHarness();

    flushFrame();
    rowColOptions().onAction({ type: 'toggle-heading' });
    rowColOptions().onGripPopoverClose();
    rowColOptions().onGripPopoverClose();

    expect(rowColMock().setActiveGrip).toHaveBeenCalledTimes(1);
  });
});

describe('cell-selection wiring', () => {
  it('hands the selection the grid and the editor rectangle selection', () => {
    const harness = createHarness();

    expect(cellSelectionOptions().grid).toBe(harness.gridEl);
    expect(cellSelectionOptions().rectangleSelection).toBe(harness.api.rectangleSelection);
  });

  it('reports whether a grip popover is open', () => {
    createHarness();

    expect(cellSelectionOptions().isPopoverOpen()).toBe(false);

    captured.popoverOpen = true;

    expect(cellSelectionOptions().isPopoverOpen()).toBe(true);
  });

  it('reports no open popover when there are no grips at all', () => {
    createHarness({ noElement: true });

    captured.popoverOpen = true;

    expect(cellSelectionOptions().isPopoverOpen()).toBe(false);
  });

  it('tells the editor when a pointer drag owns the pointer', () => {
    const harness = createHarness();

    cellSelectionOptions().onPointerDragActiveChange(true);

    expect(harness.api.blocks.setPointerDragActive).toHaveBeenCalledWith(true);
  });

  it('suppresses the pointer gestures only for a real multi-cell range', () => {
    createHarness();

    cellSelectionOptions().onSelectionActiveChange(true, false);

    expect(resizeMock().enabled).toBe(false);
    expect(addControlsMock().setInteractive).toHaveBeenCalledWith(true);
    expect(cornerDragMock().setInteractive).toHaveBeenCalledWith(true);
    expect(rowColMock().setGripsDisplay).toHaveBeenCalledWith(false);
  });

  it('suppresses the pointer gestures for a multi-cell range', () => {
    createHarness();

    cellSelectionOptions().onSelectionActiveChange(true, true);

    expect(addControlsMock().setInteractive).toHaveBeenCalledWith(false);
    expect(cornerDragMock().setInteractive).toHaveBeenCalledWith(false);
  });

  it('restores everything when the selection is dropped', () => {
    createHarness();

    cellSelectionOptions().onSelectionActiveChange(false, false);

    expect(resizeMock().enabled).toBe(true);
    expect(addControlsMock().setInteractive).toHaveBeenCalledWith(true);
    expect(rowColMock().setGripsDisplay).toHaveBeenCalledWith(true);
  });

  it('brings the grips back once the range is finalized', () => {
    createHarness();

    cellSelectionOptions().onSelectionRangeChange({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 });

    expect(rowColMock().setGripsDisplay).toHaveBeenCalledWith(true);
  });

  it('clears the selected cells on request', () => {
    const harness = createHarness();

    cellSelectionOptions().onClearContent([harness.cellOf(0, 0), harness.cellOf(1, 1)]);

    expect(harness.idsOf(0, 0)).toEqual([]);
    expect(harness.idsOf(1, 1)).toEqual([]);
    expect(harness.focusClearedCell).toHaveBeenCalledWith(harness.cellOf(0, 0));
  });

  it('reads cell metadata straight off the model', () => {
    const harness = createHarness();

    harness.model.setCellColor(1, 0, 'rgb(1, 1, 1)');
    harness.model.setCellTextColor(1, 0, 'rgb(2, 2, 2)');
    harness.model.setCellPlacement(1, 0, 'bottom-right');

    expect(cellSelectionOptions().getCellColor(1, 0)).toBe('rgb(1, 1, 1)');
    expect(cellSelectionOptions().getCellTextColor(1, 0)).toBe('rgb(2, 2, 2)');
    expect(cellSelectionOptions().getCellPlacement(1, 0)).toBe('bottom-right');
    expect(cellSelectionOptions().getCellColor(0, 0)).toBeUndefined();
  });

  it('asks the model whether a rectangle may be merged', () => {
    createHarness({ rows: 2, cols: 2 });

    expect(cellSelectionOptions().canMergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 })).toBe(true);
    expect(cellSelectionOptions().canMergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 })).toBe(false);
  });

  it('merges through the model and rebuilds the body and the grips', () => {
    const harness = createHarness();

    cellSelectionOptions().onMergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

    expect(harness.model.getCellSpan(0, 0)).toEqual({ colspan: 2, rowspan: 1 });
    expect(harness.host.rebuildTableBody).toHaveBeenCalledTimes(1);
    expect(rowColMock().refresh).toHaveBeenCalledTimes(1);
    expect(harness.transactions).toContain('transacted');
  });

  it('reports which cells are merge origins', () => {
    createHarness({ merges: [{ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 }] });

    expect(cellSelectionOptions().isMergedCell(0, 0)).toBe(true);
    expect(cellSelectionOptions().isMergedCell(1, 0)).toBe(false);
    expect(cellSelectionOptions().getCellSpan(0, 0)).toEqual({ colspan: 2, rowspan: 1 });
    expect(cellSelectionOptions().getMergeOrigin(0, 1)).toEqual([0, 0]);
    expect(cellSelectionOptions().getMergeOrigin(1, 1)).toBeNull();
  });

  it('splits through the model and rebuilds the body and the grips', () => {
    const harness = createHarness({ merges: [{ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 }] });

    cellSelectionOptions().onSplitCell(0, 0);

    expect(harness.model.hasMerges()).toBe(false);
    expect(harness.host.rebuildTableBody).toHaveBeenCalledTimes(1);
    expect(rowColMock().refresh).toHaveBeenCalledTimes(1);
  });
});

describe('bulk cell formatting', () => {
  const bothCells = (harness: Harness): HTMLElement[] => [harness.cellOf(0, 0), harness.cellOf(0, 1)];

  it.each([
    ['bold', 'strong'],
    ['italic', 'i'],
    ['underline', 'u'],
    ['strikethrough', 's'],
    ['code', 'code'],
  ] as Array<[CellMark, string]>)('wraps every selected cell in the %s tag', (mark, tag) => {
    const harness = createHarness();

    cellSelectionOptions().onFormatCells(bothCells(harness), mark);

    expect(harness.textOf(0, 0)).toBe('r0c0');
    expect(harness.cellOf(0, 0).innerHTML).toContain(`<${tag}>r0c0</${tag}>`);
    expect(harness.cellOf(0, 1).innerHTML).toContain(`<${tag}>r0c1</${tag}>`);
  });

  it('removes the mark only when every cell already carries it', () => {
    const harness = createHarness();

    cellSelectionOptions().onFormatCells(bothCells(harness), 'bold');
    cellSelectionOptions().onFormatCells(bothCells(harness), 'bold');

    expect(harness.cellOf(0, 0).innerHTML).toContain('>r0c0<');
    expect(harness.cellOf(0, 0).innerHTML).not.toContain('strong');
  });

  it('marks the rest instead of unmarking the one cell that had it', () => {
    const harness = createHarness();

    harness.write(0, 0, '<strong>r0c0</strong>');
    cellSelectionOptions().onFormatCells(bothCells(harness), 'bold');

    expect(harness.cellOf(0, 0).innerHTML).toContain('<strong>r0c0</strong>');
    expect(harness.cellOf(0, 1).innerHTML).toContain('<strong>r0c1</strong>');
  });

  it('recognises a pasted <b> as bold', () => {
    const harness = createHarness();

    harness.write(0, 0, '<b>r0c0</b>');
    harness.write(0, 1, '<b>r0c1</b>');
    cellSelectionOptions().onFormatCells(bothCells(harness), 'bold');

    expect(harness.cellOf(0, 0).innerHTML).toContain('>r0c0<');
    expect(harness.cellOf(0, 0).innerHTML).not.toContain('<b>');
  });

  it('recognises a pasted <em> as italic', () => {
    const harness = createHarness();

    harness.write(0, 0, '<em>r0c0</em>');
    harness.write(0, 1, '<em>r0c1</em>');
    cellSelectionOptions().onFormatCells(bothCells(harness), 'italic');

    expect(harness.cellOf(0, 0).innerHTML).not.toContain('<em>');
  });

  it('ignores whitespace between the marked nodes', () => {
    const harness = createHarness();

    harness.write(0, 0, '<strong>a</strong> ');
    harness.write(0, 1, '<strong>b</strong>');
    cellSelectionOptions().onFormatCells(bothCells(harness), 'bold');

    expect(harness.cellOf(0, 0).innerHTML).toContain('a </div>');
  });

  it('keeps the text and the foreign markup when unwrapping', () => {
    const harness = createHarness();

    harness.write(0, 0, '<strong>a</strong>');
    harness.write(0, 1, '<strong>b</strong>');
    cellSelectionOptions().onFormatCells(bothCells(harness), 'bold');
    harness.write(0, 0, 'plain<i>x</i>');
    harness.write(0, 1, '<strong>b</strong>');
    cellSelectionOptions().onFormatCells(bothCells(harness), 'bold');

    expect(harness.cellOf(0, 0).innerHTML).toContain('<strong>plain<i>x</i></strong>');
  });

  it('unwraps only the mark tag and keeps everything else', () => {
    const harness = createHarness();

    harness.write(0, 0, '<strong>a</strong>');
    harness.write(0, 1, '<strong>b</strong>');
    cellSelectionOptions().onFormatCells(bothCells(harness), 'bold');

    expect(harness.cellOf(0, 0).innerHTML).toContain('>a</div>');
  });

  it('skips a cell whose block carries no text', () => {
    const harness = createHarness();

    harness.write(0, 1, '');
    cellSelectionOptions().onFormatCells(bothCells(harness), 'bold');

    expect(harness.cellOf(0, 0).innerHTML).toContain('<strong>r0c0</strong>');
    expect(harness.cellOf(0, 1).innerHTML).not.toContain('strong');
    expect(harness.textOf(0, 1)).toBe('');
  });

  it('does nothing at all when every selected cell is empty', () => {
    const harness = createHarness();

    harness.write(0, 0, '');
    harness.write(0, 1, '');
    harness.transactions.length = 0;
    cellSelectionOptions().onFormatCells(bothCells(harness), 'bold');

    expect(harness.transactions).toEqual([]);
  });

  it('leaves a mutation-free editable alone', () => {
    const harness = createHarness();

    const editable = harness.cellOf(0, 0).querySelector('[contenteditable="true"]');

    editable?.setAttribute('data-blok-mutation-free', '');
    cellSelectionOptions().onFormatCells(bothCells(harness), 'bold');

    expect(harness.cellOf(0, 0).innerHTML).toContain('>r0c0<');
    expect(harness.cellOf(0, 0).innerHTML).not.toContain('strong');
  });

  it('notifies every mutated block so the data is persisted', () => {
    const harness = createHarness();

    cellSelectionOptions().onFormatCells(bothCells(harness), 'bold');

    expect(harness.blockOf('b-0-0')?.dispatchChange).toHaveBeenCalledTimes(1);
    expect(harness.blockOf('b-1-1')?.dispatchChange).not.toHaveBeenCalled();
  });

  it('formats the whole rectangle in one transaction', () => {
    const harness = createHarness();

    harness.transactions.length = 0;
    cellSelectionOptions().onFormatCells(bothCells(harness), 'bold');

    expect(harness.transactions).toEqual(['transacted']);
  });

  it('formats nothing in read-only mode', () => {
    const harness = createHarness({ readOnly: true });

    cellSelectionOptions().onFormatCells(bothCells(harness), 'bold');

    expect(harness.cellOf(0, 0).innerHTML).not.toContain('strong');
  });

  it('formats nothing when there is no cell-blocks manager', () => {
    const harness = createHarness({ noCellBlocks: true });

    cellSelectionOptions().onFormatCells(bothCells(harness), 'bold');

    expect(harness.cellOf(0, 0).innerHTML).not.toContain('strong');
  });
});

describe('fill right / fill down', () => {
  const fullRange: SelectionRange = { minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 };

  it('copies the leftmost column across the rectangle', () => {
    const harness = createHarness();

    cellSelectionOptions().onFillCells([], fullRange, 'right');

    expect(harness.textOf(0, 1)).toBe('r0c0');
    expect(harness.textOf(1, 1)).toBe('r1c0');
    expect(harness.textOf(0, 0)).toBe('r0c0');
    expect(harness.textOf(1, 0)).toBe('r1c0');
  });

  it('copies the top row down the rectangle', () => {
    const harness = createHarness();

    cellSelectionOptions().onFillCells([], fullRange, 'down');

    expect(harness.textOf(1, 0)).toBe('r0c0');
    expect(harness.textOf(1, 1)).toBe('r0c1');
    expect(harness.textOf(0, 0)).toBe('r0c0');
  });

  it('fills every column of a wide rectangle, not just the next one', () => {
    const harness = createHarness({ cols: 3 });

    cellSelectionOptions().onFillCells([], { minRow: 0, maxRow: 0, minCol: 0, maxCol: 2 }, 'right');

    expect(harness.textOf(0, 1)).toBe('r0c0');
    expect(harness.textOf(0, 2)).toBe('r0c0');
  });

  it('fills every row of a tall rectangle', () => {
    const harness = createHarness({ rows: 3 });

    cellSelectionOptions().onFillCells([], { minRow: 0, maxRow: 2, minCol: 0, maxCol: 0 }, 'down');

    expect(harness.textOf(1, 0)).toBe('r0c0');
    expect(harness.textOf(2, 0)).toBe('r0c0');
  });

  it('fills a rectangle that does not start at the table origin', () => {
    const harness = createHarness({ rows: 3, cols: 3 });

    cellSelectionOptions().onFillCells([], { minRow: 1, maxRow: 2, minCol: 1, maxCol: 2 }, 'right');

    expect(harness.textOf(1, 2)).toBe('r1c1');
    expect(harness.textOf(2, 2)).toBe('r2c1');
    expect(harness.textOf(0, 2)).toBe('r0c2');
  });

  it('gives every filled cell its own block ids and records them', () => {
    const harness = createHarness();

    cellSelectionOptions().onFillCells([], fullRange, 'right');

    expect(harness.idsOf(0, 1)).not.toEqual(['b-0-1']);
    expect(harness.model.getCellBlocks(0, 1)).toEqual(harness.idsOf(0, 1));
  });

  it('fills the whole rectangle in one transaction', () => {
    const harness = createHarness();

    harness.transactions.length = 0;
    cellSelectionOptions().onFillCells([], fullRange, 'right');

    expect(harness.transactions).toEqual(['transacted']);
  });

  it('fills nothing in read-only mode', () => {
    const harness = createHarness({ readOnly: true });

    cellSelectionOptions().onFillCells([], fullRange, 'right');

    expect(harness.textOf(0, 1)).toBe('r0c1');
  });

  it('fills nothing when the grid element is gone', () => {
    const harness = createHarness();

    harness.host.gridElement = null;
    cellSelectionOptions().onFillCells([], fullRange, 'right');

    expect(harness.textOf(0, 1)).toBe('r0c1');
  });

  it('fills nothing for a single-cell rectangle', () => {
    const harness = createHarness();

    harness.transactions.length = 0;
    cellSelectionOptions().onFillCells([], { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 }, 'right');

    expect(harness.idsOf(0, 0)).toEqual(['b-0-0']);
  });
});

describe('copy and cut', () => {
  const setData = vi.fn();
  const clipboard = (): DataTransfer => ({ setData } as unknown as DataTransfer);

  it('writes both clipboard flavours for the selected cells', () => {
    const harness = createHarness();

    cellSelectionOptions().onCopy([harness.cellOf(0, 0), harness.cellOf(0, 1)], clipboard());

    expect(setData).toHaveBeenCalledTimes(2);
    expect(setData.mock.calls[0][0]).toBe('text/html');
    expect(setData.mock.calls[0][1]).toContain('data-blok-table-cells');
    expect(setData.mock.calls[1]).toEqual(['text/plain', 'r0c0\tr0c1']);
  });

  it('writes the same payload on cut', () => {
    const harness = createHarness();

    cellSelectionOptions().onCut([harness.cellOf(1, 0)], clipboard());

    expect(setData.mock.calls[1]).toEqual(['text/plain', 'r1c0']);
  });

  it('writes nothing when the grid element is gone', () => {
    const harness = createHarness();

    harness.host.gridElement = null;
    cellSelectionOptions().onCopy([harness.cellOf(0, 0)], clipboard());

    expect(setData).not.toHaveBeenCalled();
  });

  it('writes both flavours to the system clipboard from the copy button', async () => {
    const harness = createHarness();
    const write = vi.fn<(items: Array<{ items: Record<string, Blob> }>) => Promise<void>>(() => Promise.resolve());

    vi.stubGlobal('ClipboardItem', class {
      public constructor(public readonly items: Record<string, Blob>) {}
    });
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });

    cellSelectionOptions().onCopyViaButton([harness.cellOf(0, 0)]);

    expect(write).toHaveBeenCalledTimes(1);

    const items = write.mock.calls[0][0];

    expect(Object.keys(items[0].items)).toEqual(['text/html', 'text/plain']);
    await expect(items[0].items['text/plain'].text()).resolves.toBe('r0c0');
  });

  it('does not touch the system clipboard when there is nothing to copy', () => {
    const harness = createHarness();
    const write = vi.fn<(items: Array<{ items: Record<string, Blob> }>) => Promise<void>>(() => Promise.resolve());

    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
    harness.host.gridElement = null;
    cellSelectionOptions().onCopyViaButton([harness.cellOf(0, 0)]);

    expect(write).not.toHaveBeenCalled();
  });

  it('carries the cell colours, placement and spans into the payload', () => {
    const harness = createHarness({ merges: [{ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 }] });

    harness.model.setCellColor(0, 0, 'rgb(1, 2, 3)');
    harness.model.setCellTextColor(0, 0, 'rgb(4, 5, 6)');
    harness.model.setCellPlacement(0, 0, 'middle-center');

    cellSelectionOptions().onCopy([harness.cellOf(0, 0)], clipboard());

    const html = String(setData.mock.calls[0][1]);

    expect(html).toContain('"color":"rgb(1, 2, 3)"');
    expect(html).toContain('"textColor":"rgb(4, 5, 6)"');
    expect(html).toContain('"placement":"middle-center"');
    expect(html).toContain('"colspan":2');
  });

  it('omits the metadata a plain cell does not have', () => {
    const harness = createHarness();

    cellSelectionOptions().onCopy([harness.cellOf(0, 0)], clipboard());

    const html = String(setData.mock.calls[0][1]);

    expect(html).not.toContain('color');
    expect(html).not.toContain('placement');
    expect(html).not.toContain('colspan');
    expect(html).not.toContain('rowspan');
    expect(html).not.toContain('tunes');
  });

  it('carries a block tune into the payload', () => {
    const harness = createHarness();

    harness.setTunes(0, 0, { align: 'right' });
    cellSelectionOptions().onCopy([harness.cellOf(0, 0)], clipboard());

    expect(String(setData.mock.calls[0][1])).toContain('"tunes":{"align":"right"}');
  });

  it('reads a legacy cell that renders plain text with no mounted block', () => {
    const harness = createHarness({ seed: false });

    putText(harness, 0, 0, 'legacy text');
    cellSelectionOptions().onCopy([harness.cellOf(0, 0)], clipboard());

    expect(setData.mock.calls[1]).toEqual(['text/plain', 'legacy text']);
  });

  it('reads an empty cell as an empty payload cell', () => {
    const harness = createHarness({ seed: false });

    cellSelectionOptions().onCopy([harness.cellOf(0, 0)], clipboard());

    expect(setData.mock.calls[1]).toEqual(['text/plain', '']);
  });

  it('reads a cell with no block container as an empty payload cell', () => {
    const harness = createHarness();
    const cell = harness.cellOf(0, 0);

    cell.querySelector(`[${CELL_BLOCKS_ATTR}]`)?.remove();
    cellSelectionOptions().onCopy([cell], clipboard());

    expect(setData.mock.calls[1]).toEqual(['text/plain', '']);
  });

  it('skips a holder that carries no block id', () => {
    const harness = createHarness();
    const holder = harness.cellOf(0, 0).querySelector('[data-blok-id]');

    holder?.setAttribute('data-blok-id', '');
    cellSelectionOptions().onCopy([harness.cellOf(0, 0)], clipboard());

    expect(setData.mock.calls[1]).toEqual(['text/plain', 'r0c0']);
  });

  it('skips a holder whose block the editor no longer knows', () => {
    const harness = createHarness();
    const holder = harness.cellOf(0, 0).querySelector('[data-blok-id]');

    holder?.setAttribute('data-blok-id', 'ghost');
    cellSelectionOptions().onCopy([harness.cellOf(0, 0)], clipboard());

    expect(setData.mock.calls[1]).toEqual(['text/plain', 'r0c0']);
  });

  it('reads the cell coordinates off the cell, defaulting to the origin', () => {
    const harness = createHarness();
    const cell = harness.cellOf(1, 1);

    cell.removeAttribute(CELL_ROW_ATTR);
    cell.removeAttribute(CELL_COL_ATTR);
    harness.model.setCellColor(0, 0, 'rgb(1, 2, 3)');
    cellSelectionOptions().onCopy([cell], clipboard());

    expect(String(setData.mock.calls[0][1])).toContain('"color":"rgb(1, 2, 3)"');
  });
});

describe('cell colour and placement', () => {
  it('paints the selected cells and records the colour', () => {
    const harness = createHarness();

    cellSelectionOptions().onColorChange([harness.cellOf(0, 0), harness.cellOf(1, 1)], 'rgb(1, 2, 3)', 'backgroundColor');

    expect(harness.model.getCellColor(0, 0)).toBe('rgb(1, 2, 3)');
    expect(harness.model.getCellColor(1, 1)).toBe('rgb(1, 2, 3)');
    expect(harness.model.getCellColor(0, 1)).toBeUndefined();
    expect(harness.cellOf(1, 1).style.backgroundColor).toBe('rgb(1, 2, 3)');
    expect(harness.cellOf(1, 1).style.color).toBe('');
  });

  it('paints the text colour when that is the mode', () => {
    const harness = createHarness();

    cellSelectionOptions().onColorChange([harness.cellOf(0, 1)], 'rgb(1, 2, 3)', 'textColor');

    expect(harness.model.getCellTextColor(0, 1)).toBe('rgb(1, 2, 3)');
    expect(harness.model.getCellColor(0, 1)).toBeUndefined();
    expect(harness.cellOf(0, 1).style.color).toBe('rgb(1, 2, 3)');
  });

  it('clears the colour when the picker hands back null', () => {
    const harness = createHarness();

    cellSelectionOptions().onColorChange([harness.cellOf(0, 0)], 'rgb(1, 2, 3)', 'backgroundColor');
    cellSelectionOptions().onColorChange([harness.cellOf(0, 0)], null, 'backgroundColor');

    expect(harness.model.getCellColor(0, 0)).toBeUndefined();
    expect(harness.cellOf(0, 0).style.backgroundColor).toBe('');
  });

  it('skips a cell that does not belong to this grid', () => {
    const harness = createHarness();
    const stray = document.createElement('td');

    stray.setAttribute(CELL_ATTR, '');
    document.body.appendChild(stray);

    cellSelectionOptions().onColorChange([stray, harness.cellOf(0, 0)], 'rgb(1, 2, 3)', 'backgroundColor');

    expect(stray.style.backgroundColor).toBe('');
    expect(harness.model.getCellColor(0, 0)).toBe('rgb(1, 2, 3)');
  });

  it('paints nothing when the grid element is gone', () => {
    const harness = createHarness();

    harness.host.gridElement = null;
    cellSelectionOptions().onColorChange([harness.cellOf(0, 0)], 'rgb(1, 2, 3)', 'backgroundColor');

    expect(harness.model.getCellColor(0, 0)).toBeUndefined();
  });

  it('writes the 9-way placement to the model and the container', () => {
    const harness = createHarness();

    cellSelectionOptions().onPlacementChange([harness.cellOf(1, 0)], 'bottom-right');

    expect(harness.model.getCellPlacement(1, 0)).toBe('bottom-right');
    expect(harness.cellOf(1, 0).querySelector('[data-blok-cell-placement]')?.getAttribute('data-blok-cell-placement'))
      .toBe('bottom-right');
  });

  it('treats the default top-left as no placement at all', () => {
    const harness = createHarness();

    cellSelectionOptions().onPlacementChange([harness.cellOf(1, 0)], 'middle-center');
    cellSelectionOptions().onPlacementChange([harness.cellOf(1, 0)], 'top-left');

    expect(harness.model.getCellPlacement(1, 0)).toBeUndefined();
    expect(harness.cellOf(1, 0).querySelector('[data-blok-cell-placement]')).toBeNull();
  });

  it('skips a placement change on a cell of another grid', () => {
    const harness = createHarness();
    const stray = document.createElement('td');

    stray.setAttribute(CELL_ATTR, '');
    document.body.appendChild(stray);

    cellSelectionOptions().onPlacementChange([stray], 'bottom-right');

    expect(harness.model.getCellPlacement(0, 0)).toBeUndefined();
  });

  it('records a placement even when the cell has no block container', () => {
    const harness = createHarness();
    const cell = harness.cellOf(0, 0);

    cell.querySelector(`[${CELL_BLOCKS_ATTR}]`)?.remove();
    cellSelectionOptions().onPlacementChange([cell], 'bottom-right');

    expect(harness.model.getCellPlacement(0, 0)).toBe('bottom-right');
  });

  it('changes no placement when the grid element is gone', () => {
    const harness = createHarness();

    harness.host.gridElement = null;
    cellSelectionOptions().onPlacementChange([harness.cellOf(0, 0)], 'bottom-right');

    expect(harness.model.getCellPlacement(0, 0)).toBeUndefined();
  });
});

describe('resize wiring', () => {
  type ResizeChange = (widths: number[]) => void;
  type ResizeHook = () => void;

  it('starts in percent mode when the model carries no widths', () => {
    const harness = createHarness();

    expect(resizeArgs()[0]).toBe(harness.gridEl);
    expect(resizeArgs()[5]).toBe(true);
    expect(harness.ensureScrollContainer).not.toHaveBeenCalled();
  });

  it('starts in pixel mode and turns on scroll overflow when the model has widths', () => {
    const harness = createHarness({ colWidths: [40, 60] });

    expect(resizeArgs()[1]).toEqual([40, 60]);
    expect(resizeArgs()[5]).toBe(false);
    expect(harness.ensureScrollContainer).toHaveBeenCalled();
  });

  it('reads the rendered widths in percent mode', () => {
    const harness = createHarness({ init: false });

    applyPixelWidths(harness.gridEl, [40, 60]);
    harness.subsystems.initAll(harness.gridEl);

    expect(resizeArgs()[1]).toEqual([40, 60]);
  });

  it('records a drag result and re-syncs everything that depends on the widths', () => {
    const harness = createHarness();
    const onChange = resizeArgs()[2] as ResizeChange;

    onChange([11, 22]);

    expect(harness.model.colWidths).toEqual([11, 22]);
    expect(harness.ensureScrollContainer).toHaveBeenCalled();
    expect(rowColMock().positionGrips).toHaveBeenCalledTimes(1);
    expect(addControlsMock().syncRowButtonWidth).toHaveBeenCalledTimes(1);
    expect(scrollHazeMock().update).toHaveBeenCalledTimes(1);
  });

  it('hides the grips while a resize drag runs', () => {
    createHarness();

    (resizeArgs()[3] as ResizeHook)();

    expect(rowColMock().hideAllGrips).toHaveBeenCalledTimes(1);
  });

  it('keeps the add-row button and the haze in step during the drag', () => {
    createHarness();

    (resizeArgs()[4] as ResizeHook)();

    expect(addControlsMock().syncRowButtonWidth).toHaveBeenCalledTimes(1);
    expect(scrollHazeMock().update).toHaveBeenCalledTimes(1);
  });

  it('hands a width reset back to the table', () => {
    const harness = createHarness();

    (resizeArgs()[6] as ResizeHook)();

    expect(harness.host.fitToPageWidth).toHaveBeenCalledTimes(1);
  });

  it('re-creates the handles and repositions the grips on refreshResize', () => {
    const harness = createHarness();
    const first = resizeMock();

    harness.subsystems.refreshResize(harness.gridEl);

    expect(captured.resize).toHaveLength(2);
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(rowColMock().positionGrips).toHaveBeenCalledTimes(1);
    expect(addControlsMock().syncRowButtonWidth).toHaveBeenCalledTimes(1);
    expect(scrollHazeMock().update).toHaveBeenCalledTimes(1);
  });
});

describe('scroll haze and lifecycle', () => {
  it('binds the haze to the wrapper and the scroll container', () => {
    const harness = createHarness();

    expect(scrollHazeMock().init).toHaveBeenCalledWith(harness.host.element, harness.host.scrollContainer);
  });

  it('creates no haze without a wrapper', () => {
    createHarness({ noElement: true });

    expect(captured.scrollHazeSelf).toHaveLength(0);
  });

  it('creates no haze without a scroll container', () => {
    createHarness({ noScrollContainer: true });

    expect(captured.scrollHazeSelf).toHaveLength(0);
  });

  it('creates only the haze on the read-only render path', () => {
    const harness = createHarness({ init: false });

    harness.subsystems.initScrollHazeOnly();

    expect(captured.scrollHazeSelf).toHaveLength(1);
    expect(captured.addControls).toHaveLength(0);
    expect(captured.cellSelection).toHaveLength(0);
    expect(harness.subsystems.cellSelectionSubsystem).toBeNull();
    expect(harness.subsystems.rowColControlsSubsystem).toBeNull();
  });

  it('exposes the cell-selection and grip subsystems once initialized', () => {
    const harness = createHarness();

    expect(harness.subsystems.cellSelectionSubsystem).toBe(cellSelectionMock());
    expect(harness.subsystems.rowColControlsSubsystem).toBe(rowColMock());
  });

  it('destroys every subsystem on teardown', () => {
    const harness = createHarness();
    const mocks = {
      addControls: addControlsMock(),
      cornerDrag: cornerDragMock(),
      rowCol: rowColMock(),
      selection: cellSelectionMock(),
      resize: resizeMock(),
      haze: scrollHazeMock(),
    };

    harness.subsystems.teardown();

    expect(mocks.addControls.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.cornerDrag.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.rowCol.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.selection.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.resize.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.haze.destroy).toHaveBeenCalledTimes(1);
    expect(harness.subsystems.cellSelectionSubsystem).toBeNull();
    expect(harness.subsystems.rowColControlsSubsystem).toBeNull();
  });

  it('is safe to tear down twice', () => {
    const harness = createHarness();

    harness.subsystems.teardown();

    expect(() => harness.subsystems.teardown()).not.toThrow();
  });

  it('is safe to tear down before anything was initialized', () => {
    const harness = createHarness({ init: false });

    expect(() => harness.subsystems.teardown()).not.toThrow();
  });

  it('replaces the previous subsystems on a second initAll', () => {
    const harness = createHarness();
    const first = {
      addControls: addControlsMock(),
      cornerDrag: cornerDragMock(),
      rowCol: rowColMock(),
      selection: cellSelectionMock(),
      haze: scrollHazeMock(),
    };

    harness.subsystems.initAll(harness.gridEl);

    expect(first.addControls.destroy).toHaveBeenCalledTimes(1);
    expect(first.cornerDrag.destroy).toHaveBeenCalledTimes(1);
    expect(first.rowCol.destroy).toHaveBeenCalledTimes(1);
    expect(first.selection.destroy).toHaveBeenCalledTimes(1);
    expect(first.haze.destroy).toHaveBeenCalledTimes(1);
    expect(captured.addControls).toHaveLength(2);
  });
});

describe('wiring that must survive missing collaborators', () => {
  it('pastes into a table that never rendered a wrapper', () => {
    const harness = createHarness({ noElement: true });

    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]));

    expect(harness.textOf(0, 0)).toBe('P00');
  });

  it('handles a selection change with no buttons, corner or grips', () => {
    createHarness({ noElement: true });

    expect(() => cellSelectionOptions().onSelectionActiveChange(true, true)).not.toThrow();
    expect(() => cellSelectionOptions().onSelectionRangeChange({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 })).not.toThrow();
  });

  it('merges and splits with no grips to refresh', () => {
    const harness = createHarness({ noElement: true });

    cellSelectionOptions().onMergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 });

    expect(harness.model.getCellSpan(0, 0)).toEqual({ colspan: 2, rowspan: 1 });

    cellSelectionOptions().onSplitCell(0, 0);

    expect(harness.model.hasMerges()).toBe(false);
  });

  it('parks the affordances on a drag start that follows a teardown', () => {
    const harness = createHarness();

    harness.subsystems.teardown();

    expect(() => cornerDragOptions().onDragStart()).not.toThrow();
    expect(harness.api.blocks.beginTransaction).toHaveBeenCalledTimes(1);
  });

  it('closes the undo group on a drag end that follows a teardown', () => {
    const harness = createHarness();

    harness.subsystems.teardown();

    expect(() => cornerDragOptions().onDragEnd()).not.toThrow();
    expect(harness.api.blocks.endTransaction).toHaveBeenCalledTimes(1);
  });

  it('handles an add-controls drag start and end after a teardown', () => {
    const harness = createHarness();

    harness.subsystems.teardown();

    expect(() => addControlsOptions().onDragStart()).not.toThrow();
    expect(() => addControlsOptions().onDragEnd()).not.toThrow();
    expect(harness.api.blocks.endTransaction).toHaveBeenCalledTimes(1);
  });

  it('re-highlights nothing when the grips are already gone', () => {
    const harness = createHarness();

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback): number => {
      callback(0);

      return 0;
    });
    rowColOptions().onAction({ type: 'toggle-heading' });
    harness.subsystems.teardown();

    expect(() => rowColOptions().onGripPopoverClose()).not.toThrow();
  });

  it('adds a row after a teardown without the grips or buttons', () => {
    const harness = createHarness();

    harness.subsystems.teardown();

    expect(() => addControlsOptions().onAddRow()).not.toThrow();
    expect(harness.model.rows).toBe(3);
  });
});

describe('wiring that must survive a missing cell-blocks manager', () => {
  it('pastes a rectangle with nothing to delete or re-seed', () => {
    const harness = createHarness({ noCellBlocks: true });

    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]));

    expect(harness.model.getCellBlocks(0, 0)).toEqual([]);
    expect(harness.insertCalls).toHaveLength(2);
  });

  it('rebuilds a pasted merge with no blocks to clear', () => {
    const harness = createHarness({ rows: 2, cols: 3, noCellBlocks: true });

    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('WIDE')], colspan: 2 },
      { row: 1, col: 0, blocks: [para('P10')] },
      { row: 1, col: 1, blocks: [para('P11')] },
    ]));

    expect(harness.model.getCellSpan(0, 0)).toEqual({ colspan: 2, rowspan: 1 });
    expect(harness.model.getCellBlocks(0, 1)).toEqual([]);
  });

  it('fills a rectangle with no blocks to read', () => {
    const harness = createHarness({ noCellBlocks: true });

    cellSelectionOptions().onFillCells([], { minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 }, 'right');

    expect(harness.model.getCellBlocks(0, 1)).toEqual([]);
    expect(harness.insertCalls).toHaveLength(0);
  });

  it('duplicates a row with no blocks to copy', () => {
    const harness = createHarness({ noCellBlocks: true });

    rowColOptions().onAction({ type: 'duplicate-row', index: 0 });

    expect(harness.model.rows).toBe(3);
    expect(harness.model.getCellBlocks(1, 0)).toEqual([]);
  });

  it('drops the corner-drag row with no blocks to delete', () => {
    const harness = createHarness({ rows: 3, noCellBlocks: true });

    cornerDragOptions().onRemoveLastRow();

    expect(harness.model.rows).toBe(2);
  });

  it('drops the corner-drag column with no blocks to delete', () => {
    const harness = createHarness({ cols: 3, noCellBlocks: true });

    cornerDragOptions().onRemoveLastColumn();

    expect(harness.model.cols).toBe(2);
  });
});

describe('stale block references', () => {
  it('skips a holder whose block the editor forgot when formatting', () => {
    const harness = createHarness();

    harness.cellOf(0, 0).querySelector('[data-blok-id]')?.setAttribute('data-blok-id', 'ghost');
    cellSelectionOptions().onFormatCells([harness.cellOf(0, 0), harness.cellOf(0, 1)], 'bold');

    expect(harness.cellOf(0, 1).innerHTML).toContain('<strong>r0c1</strong>');
  });

  it('skips a holder whose block the editor forgot when filling', () => {
    const harness = createHarness();

    harness.cellOf(0, 0).querySelector('[data-blok-id]')?.setAttribute('data-blok-id', 'ghost');
    cellSelectionOptions().onFillCells([], { minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 }, 'right');

    expect(harness.insertCalls).toHaveLength(0);
    expect(harness.textOf(0, 1)).toBe('');
  });
});

describe('heading styles follow every structural change', () => {
  it('marks the heading column after a row is added', () => {
    const harness = createHarness({ withHeadingColumn: true });

    addControlsOptions().onAddRow();

    const firstCells = Array.from(harness.gridEl.querySelectorAll(`[${CELL_COL_ATTR}="0"]`));

    expect(firstCells).toHaveLength(3);
    expect(firstCells.every((cell) => cell.hasAttribute('data-blok-table-heading-col'))).toBe(true);
  });

  it('marks the heading column after a column is added', () => {
    const harness = createHarness({ withHeadingColumn: true, colWidths: [40, 60] });

    addControlsOptions().onAddColumn();

    expect(harness.cellOf(0, 0).hasAttribute('data-blok-table-heading-col')).toBe(true);
    expect(harness.cellOf(0, 2).hasAttribute('data-blok-table-heading-col')).toBe(false);
  });

  it('marks the heading row after the corner drag adds a row', () => {
    const harness = createHarness({ withHeadings: true });

    cornerDragOptions().onAddRow();

    const rows = harness.gridEl.querySelectorAll(`[${ROW_ATTR}]`);

    expect(rows[0].hasAttribute('data-blok-table-heading')).toBe(true);
    expect(rows[2].hasAttribute('data-blok-table-heading')).toBe(false);
  });

  it('turns on scroll overflow when the corner drag adds a column', () => {
    const harness = createHarness({ colWidths: [40, 60] });

    harness.ensureScrollContainer.mockClear();
    cornerDragOptions().onAddColumn();

    expect(harness.ensureScrollContainer).toHaveBeenCalled();
  });

  it('marks the heading row on the rows a paste grew', () => {
    const harness = createHarness({ withHeadings: true });

    pasteInto(harness, 1, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 1, col: 0, blocks: [para('P10')] },
    ]));

    const rows = harness.gridEl.querySelectorAll(`[${ROW_ATTR}]`);

    expect(rows).toHaveLength(3);
    expect(rows[0].hasAttribute('data-blok-table-heading')).toBe(true);
  });
});

/** The one editable of a cell, as markup — the exact string the mark helpers write. */
const editableHtml = (harness: Harness, row: number, col: number): string => {
  const editable = harness.cellOf(row, col).querySelector<HTMLElement>('[contenteditable="true"]');

  if (!editable) {
    throw new Error(`cell ${row},${col} has no editable`);
  }

  return editable.innerHTML;
};

describe('what counts as "already marked"', () => {
  const bothCells = (harness: Harness): HTMLElement[] => [harness.cellOf(0, 0), harness.cellOf(0, 1)];

  it('counts a bare text node as unmarked content', () => {
    const harness = createHarness();

    harness.write(0, 0, 'plain<strong>a</strong>');
    harness.write(0, 1, '<strong>b</strong>');
    cellSelectionOptions().onFormatCells(bothCells(harness), 'bold');

    expect(editableHtml(harness, 0, 0)).toBe('<strong>plain<strong>a</strong></strong>');
  });

  it('needs EVERY node marked, not just one of them', () => {
    const harness = createHarness();

    harness.write(0, 0, '<strong>a</strong>plain');
    harness.write(0, 1, '<strong>b</strong>');
    cellSelectionOptions().onFormatCells(bothCells(harness), 'bold');

    expect(editableHtml(harness, 0, 0)).toBe('<strong><strong>a</strong>plain</strong>');
  });

  it('counts a whitespace-only ELEMENT as content, unlike a whitespace text node', () => {
    const harness = createHarness();

    harness.write(0, 0, '<strong>a</strong><em> </em>');
    harness.write(0, 1, '<strong>b</strong>');
    cellSelectionOptions().onFormatCells(bothCells(harness), 'bold');

    expect(editableHtml(harness, 0, 0)).toBe('<strong><strong>a</strong><em> </em></strong>');
  });

  it('never wraps a cell that already carries the mark a second time', () => {
    const harness = createHarness();

    harness.write(0, 0, '<strong>a</strong>');
    harness.write(0, 1, 'plain');
    cellSelectionOptions().onFormatCells(bothCells(harness), 'bold');

    expect(editableHtml(harness, 0, 0)).toBe('<strong>a</strong>');
    expect(editableHtml(harness, 0, 1)).toBe('<strong>plain</strong>');
  });

  it('keeps the markup that sat inside the mark when unwrapping', () => {
    const harness = createHarness();

    harness.write(0, 0, '<strong><i>a</i></strong>');
    harness.write(0, 1, '<strong>b</strong>');
    cellSelectionOptions().onFormatCells(bothCells(harness), 'bold');

    expect(editableHtml(harness, 0, 0)).toBe('<i>a</i>');
  });

  it('keeps the whitespace between marked nodes when unwrapping', () => {
    const harness = createHarness();

    harness.write(0, 0, '<strong>a</strong> ');
    harness.write(0, 1, '<strong>b</strong>');
    cellSelectionOptions().onFormatCells(bothCells(harness), 'bold');

    expect(editableHtml(harness, 0, 0)).toBe('a ');
  });

  it('joins several marked nodes back together when unwrapping', () => {
    const harness = createHarness();

    harness.write(0, 0, '<strong>a</strong><strong>b</strong>');
    harness.write(0, 1, '<strong>c</strong>');
    cellSelectionOptions().onFormatCells(bothCells(harness), 'bold');

    expect(editableHtml(harness, 0, 0)).toBe('ab');
  });
});

describe('every grow path seeds its new cells and sizes its new column', () => {
  it('button-click column add uses half the table initial width', () => {
    const harness = createHarness({ initialColWidth: 33.337, colWidths: [40, 60] });

    addControlsOptions().onAddColumn();

    expect(harness.model.colWidths).toEqual([40, 60, 16.67]);
  });

  it('button-click column add seeds the new cells', () => {
    const harness = createHarness({ colWidths: [40, 60], withHeadingColumn: true });

    addControlsOptions().onAddColumn();

    expect(harness.idsOf(0, 2)).toHaveLength(1);
    expect(harness.idsOf(1, 2)).toHaveLength(1);
    expect(harness.cellOf(0, 2).hasAttribute('data-blok-table-heading-col')).toBe(false);
  });

  it('button-click row add seeds the new cells', () => {
    const harness = createHarness();

    addControlsOptions().onAddRow();

    expect(harness.idsOf(2, 0)).toHaveLength(1);
    expect(harness.idsOf(2, 1)).toHaveLength(1);
  });

  it('drag row add seeds the new cells and keeps the heading styles', () => {
    const harness = createHarness({ withHeadings: true, withHeadingColumn: true });

    addControlsOptions().onDragAddRow();

    expect(harness.idsOf(2, 0)).toHaveLength(1);
    expect(harness.gridEl.querySelectorAll(`[${ROW_ATTR}]`)[0].hasAttribute('data-blok-table-heading')).toBe(true);
    expect(harness.cellOf(2, 0).hasAttribute('data-blok-table-heading-col')).toBe(true);
  });

  it('drag column add uses half the table initial width', () => {
    const harness = createHarness({ initialColWidth: 33.337, colWidths: [40, 60] });

    addControlsOptions().onDragAddCol();

    expect(harness.model.colWidths).toEqual([40, 60, 16.67]);
    expect(harness.gridEl.style.width).toBe('117.67px');
  });

  it('drag column add seeds the new cells and keeps the heading column', () => {
    const harness = createHarness({ colWidths: [40, 60], withHeadingColumn: true });

    addControlsOptions().onDragAddCol();

    expect(harness.idsOf(0, 2)).toHaveLength(1);
    expect(harness.cellOf(0, 0).hasAttribute('data-blok-table-heading-col')).toBe(true);
  });

  it('corner tap uses half the table initial width for its column', () => {
    const harness = createHarness({ initialColWidth: 33.337, colWidths: [40, 60] });

    cornerDragOptions().onClickAdd();

    expect(harness.model.colWidths).toEqual([40, 60, 16.67]);
  });

  it('corner tap seeds the new row and the new column', () => {
    const harness = createHarness({ colWidths: [40, 60], withHeadings: true, withHeadingColumn: true });

    cornerDragOptions().onClickAdd();

    expect(harness.idsOf(2, 0)).toHaveLength(1);
    expect(harness.idsOf(0, 2)).toHaveLength(1);
    expect(harness.idsOf(2, 2)).toHaveLength(1);
    expect(harness.gridEl.querySelectorAll(`[${ROW_ATTR}]`)[0].hasAttribute('data-blok-table-heading')).toBe(true);
    expect(harness.cellOf(2, 0).hasAttribute('data-blok-table-heading-col')).toBe(true);
  });

  it('corner drag column add seeds the new cells and keeps the heading column', () => {
    const harness = createHarness({ colWidths: [40, 60], withHeadingColumn: true });

    cornerDragOptions().onAddColumn();

    expect(harness.idsOf(0, 2)).toHaveLength(1);
    expect(harness.idsOf(1, 2)).toHaveLength(1);
    expect(harness.cellOf(0, 0).hasAttribute('data-blok-table-heading-col')).toBe(true);
  });

  it('corner drag row add seeds the new cells', () => {
    const harness = createHarness({ withHeadingColumn: true });

    cornerDragOptions().onAddRow();

    expect(harness.idsOf(2, 0)).toHaveLength(1);
    expect(harness.cellOf(2, 0).hasAttribute('data-blok-table-heading-col')).toBe(true);
  });

  it('a paste that grows the grid seeds every new cell', () => {
    const harness = createHarness({ withHeadingColumn: true });

    pasteInto(harness, 1, 1, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
      { row: 1, col: 0, blocks: [para('P10')] },
      { row: 1, col: 1, blocks: [para('P11')] },
    ]));

    expect(harness.idsOf(2, 0)).toHaveLength(1);
    expect(harness.idsOf(0, 2)).toHaveLength(1);
    expect(harness.cellOf(2, 0).hasAttribute('data-blok-table-heading-col')).toBe(true);
    expect(harness.cellOf(0, 2).hasAttribute('data-blok-table-heading-col')).toBe(false);
  });
});

describe('gestures that outlive their subsystems', () => {
  it('adds a column after a teardown without the grips or buttons', () => {
    const harness = createHarness({ colWidths: [40, 60] });

    harness.subsystems.teardown();
    captured.resize.length = 0;

    expect(() => addControlsOptions().onAddColumn()).not.toThrow();
    expect(harness.model.cols).toBe(3);
    expect(captured.resize).toHaveLength(1);
  });

  it('drags a column in and out after a teardown', () => {
    const harness = createHarness({ colWidths: [40, 60], seed: false });

    harness.subsystems.teardown();

    expect(() => addControlsOptions().onDragAddCol()).not.toThrow();
    expect(() => addControlsOptions().onDragRemoveCol()).not.toThrow();
    expect(harness.model.cols).toBe(2);
  });

  it('adds a corner column and taps the corner after a teardown', () => {
    const harness = createHarness({ colWidths: [40, 60] });

    harness.subsystems.teardown();

    expect(() => cornerDragOptions().onAddColumn()).not.toThrow();
    expect(() => cornerDragOptions().onClickAdd()).not.toThrow();
    expect(harness.model.cols).toBe(4);
  });

  it('runs a grip action after a teardown', () => {
    const harness = createHarness({ rows: 3 });

    harness.subsystems.teardown();

    expect(() => rowColOptions().onAction({ type: 'insert-row-above', index: 1 })).not.toThrow();
    expect(harness.model.rows).toBe(4);
  });

  it('runs a grip move after a teardown without a selection to paint', () => {
    const harness = createHarness({ rows: 3 });

    harness.subsystems.teardown();

    expect(() => rowColOptions().onAction({ type: 'move-row', fromIndex: 0, toIndex: 2 })).not.toThrow();
    expect(harness.model.getCellBlocks(2, 0)).toEqual(['b-0-0']);
  });

  it('clears and paints a grip range after a teardown', () => {
    const harness = createHarness();

    harness.subsystems.teardown();

    expect(() => rowColOptions().onColorChange('row', 0, 'rgb(1, 2, 3)', 'backgroundColor')).not.toThrow();
    expect(() => rowColOptions().onClearContents('row', 0)).not.toThrow();
    expect(harness.model.getCellColor(0, 0)).toBe('rgb(1, 2, 3)');
    expect(harness.idsOf(0, 0)).toEqual([]);
  });

  it('merges and splits after a teardown', () => {
    const harness = createHarness();

    harness.subsystems.teardown();

    expect(() => cellSelectionOptions().onMergeCells({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 })).not.toThrow();
    expect(() => cellSelectionOptions().onSplitCell(0, 0)).not.toThrow();
    expect(harness.model.hasMerges()).toBe(false);
  });

  it('changes the resize state after a teardown', () => {
    const harness = createHarness();

    harness.subsystems.teardown();

    expect(() => cellSelectionOptions().onSelectionActiveChange(true, true)).not.toThrow();
    expect(() => rowColOptions().onDragStateChange(true, 'row', 0)).not.toThrow();
    expect(harness.api.toolbar.close).toHaveBeenCalledTimes(1);
  });
});

describe('optional editor APIs', () => {
  it('drags without an undo-transaction API', () => {
    const harness = createHarness();

    Reflect.deleteProperty(harness.api.blocks, 'beginTransaction');
    Reflect.deleteProperty(harness.api.blocks, 'endTransaction');

    expect(() => cornerDragOptions().onDragStart()).not.toThrow();
    expect(() => cornerDragOptions().onDragEnd()).not.toThrow();
    expect(() => addControlsOptions().onDragStart()).not.toThrow();
    expect(() => addControlsOptions().onDragEnd()).not.toThrow();
  });

  it('reports a pointer drag without the editor hook', () => {
    const harness = createHarness();

    Reflect.deleteProperty(harness.api.blocks, 'setPointerDragActive');

    expect(() => cellSelectionOptions().onPointerDragActiveChange(true)).not.toThrow();
  });

  it('pastes without a caret API', () => {
    const harness = createHarness();

    Reflect.deleteProperty(harness.api, 'caret');
    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]));

    expect(harness.textOf(0, 0)).toBe('P00');
  });
});

describe('drag-shrink with no cell-blocks manager', () => {
  it('drags away an empty trailing row with no blocks to delete', () => {
    const harness = createHarness({ seed: false, noCellBlocks: true });

    expect(addControlsOptions().onDragRemoveRow()).toBe(true);
    expect(harness.model.rows).toBe(1);
    expect(harness.grid.getRowCount(harness.gridEl)).toBe(1);
  });

  it('drags away an empty trailing column with no blocks to delete', () => {
    const harness = createHarness({ seed: false, noCellBlocks: true, colWidths: [40, 60] });

    expect(addControlsOptions().onDragRemoveCol()).toBe(true);
    expect(harness.model.cols).toBe(1);
    expect(harness.gridEl.style.width).toBe('41px');
  });
});

describe('one-cell payloads versus one-row payloads', () => {
  it('replaces both cells of a 1x2 text payload instead of inlining the first', () => {
    const harness = createHarness();

    caretAtEndOf(harness, 0, 0);
    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]));

    expect(harness.textOf(0, 0)).toBe('P00');
    expect(harness.textOf(0, 1)).toBe('P01');
  });

  it('replaces both cells of a 2x1 text payload instead of inlining the first', () => {
    const harness = createHarness();

    caretAtEndOf(harness, 0, 0);
    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 1, col: 0, blocks: [para('P10')] },
    ]));

    expect(harness.textOf(0, 0)).toBe('P00');
    expect(harness.textOf(1, 0)).toBe('P10');
  });

  it('puts the caret inside the last element the inline insert created', () => {
    const harness = createHarness();
    const editable = caretAtEndOf(harness, 0, 0);

    pasteAt(editable, clipHtml([{ row: 0, col: 0, blocks: [para('x<b>y</b>')] }]));

    const range = window.getSelection()?.getRangeAt(0);

    expect(range?.startContainer.nodeType).toBe(Node.TEXT_NODE);
    expect(range?.startContainer.textContent).toBe('y');
    expect(range?.startOffset).toBe(1);
  });
});

describe('gaps a first mutation pass found', () => {
  it('ends an add-controls drag on a table with no scroll container', () => {
    const harness = createHarness({ noScrollContainer: true, colWidths: [40, 60] });

    addControlsOptions().onDragAddCol();

    expect(() => addControlsOptions().onDragEnd()).not.toThrow();
    expect(harness.model.cols).toBe(3);
  });

  it('copies EVERY row of a duplicated column, not just as many as there are columns', () => {
    const harness = createHarness({ rows: 4, cols: 2 });

    rowColOptions().onAction({ type: 'duplicate-col', index: 0 });

    expect(harness.textOf(3, 1)).toBe('r3c0');
    expect(harness.textOf(0, 1)).toBe('r0c0');
  });

  it('records an empty cell list for a duplicate made without a cell-blocks manager', () => {
    const harness = createHarness({
      rows: 3,
      cols: 2,
      noCellBlocks: true,
      liveRebuild: true,
      merges: [{ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 }],
    });

    rowColOptions().onAction({ type: 'duplicate-row', index: 1 });

    expect(harness.model.getCellBlocks(2, 0)).toEqual([]);
    expect(harness.model.getCellBlocks(2, 1)).toEqual([]);
  });

  it('names the tool of a legacy plain-text cell in the payload', () => {
    const harness = createHarness({ seed: false });
    const setData = vi.fn();

    putText(harness, 0, 0, 'legacy text');
    cellSelectionOptions().onCopy([harness.cellOf(0, 0)], { setData } as unknown as DataTransfer);

    expect(String(setData.mock.calls[0][1])).toContain('"tool":"paragraph"');
  });

  it('pastes at the table origin when the target cell carries no coordinates', () => {
    const harness = createHarness();
    const cell = harness.cellOf(1, 1);
    const editable = cell.querySelector<HTMLElement>('[contenteditable="true"]');

    cell.removeAttribute(CELL_ROW_ATTR);
    cell.removeAttribute(CELL_COL_ATTR);
    editable?.focus();
    pasteAt(cell, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]));

    expect(harness.textOf(0, 0)).toBe('P00');
    expect(harness.textOf(0, 1)).toBe('P01');
  });

  it('inserts no node at all when the single pasted cell is empty', () => {
    const harness = createHarness();
    const editable = caretAtEndOf(harness, 0, 0);
    const before = editable.childNodes.length;

    pasteAt(editable, clipHtml([{ row: 0, col: 0, blocks: [{ tool: 'paragraph', data: { text: '' } }] }]));

    expect(editable.childNodes.length).toBe(before);
  });

  it('clamps a row span that reaches past the bottom of the payload', () => {
    const harness = createHarness({ rows: 5, cols: 2 });

    pasteInto(harness, 0, 0, buildClipboardHtml({
      rows: 2,
      cols: 1,
      cells: [
        [{ blocks: [para('A')] }],
        [{ blocks: [para('B')], rowspan: 3 }],
      ],
    }));

    expect(harness.model.hasMerges()).toBe(false);
    expect(harness.textOf(1, 0)).toBe('B');
  });

  it('clamps a column span that reaches past the right edge of the payload', () => {
    const harness = createHarness({ rows: 2, cols: 5 });

    pasteInto(harness, 0, 0, buildClipboardHtml({
      rows: 1,
      cols: 2,
      cells: [
        [{ blocks: [para('A')] }, { blocks: [para('B')], colspan: 3 }],
      ],
    }));

    expect(harness.model.hasMerges()).toBe(false);
    expect(harness.textOf(0, 1)).toBe('B');
  });

  it('clears the cell a row-spanning pasted merge swallows', () => {
    const harness = createHarness({ rows: 3, cols: 2 });

    pasteInto(harness, 0, 0, buildClipboardHtml({
      rows: 2,
      cols: 1,
      cells: [
        [{ blocks: [para('TALL')], rowspan: 2 }],
        [{ blocks: [], covered: true }],
      ],
    }));

    expect(harness.model.getCellSpan(0, 0)).toEqual({ colspan: 1, rowspan: 2 });
    expect(harness.idsOf(1, 0)).toEqual([]);
    expect(harness.textOf(0, 0)).toBe('TALL');
  });
});

describe('gaps a second mutation pass found', () => {
  it('re-creates the resize handles on each drag column add', () => {
    const harness = createHarness({ colWidths: [40, 60] });

    captured.resize.length = 0;
    addControlsOptions().onDragAddCol();

    expect(captured.resize).toHaveLength(1);
    expect(harness.model.cols).toBe(3);
  });

  it('pins the widths of a percent table when the corner adds a column', () => {
    const harness = createHarness({ colWidths: [40, 60] });

    applyPixelWidths(harness.gridEl, [40, 60]);
    harness.model.setColWidths(undefined);
    cornerDragOptions().onAddColumn();

    expect(harness.model.colWidths).toEqual([40, 60, 50]);
  });

  it('pins the widths of a percent table on the corner tap', () => {
    const harness = createHarness({ colWidths: [40, 60] });

    applyPixelWidths(harness.gridEl, [40, 60]);
    harness.model.setColWidths(undefined);
    cornerDragOptions().onClickAdd();

    expect(harness.model.colWidths).toEqual([40, 60, 25]);
  });

  it('asks the model about the right axis when a drop lands out of range', () => {
    createHarness({ rows: 4, cols: 2 });

    expect(rowColOptions().canDrop('col', 0, 3)).toBe(false);
    expect(rowColOptions().canDrop('row', 0, 3)).toBe(true);
  });

  it('skips a merge-covered source cell when duplicating a row', () => {
    const harness = createHarness({
      rows: 4,
      cols: 2,
      merges: [{ minRow: 1, maxRow: 2, minCol: 1, maxCol: 1 }],
      liveRebuild: true,
    });

    expect(() => rowColOptions().onAction({ type: 'duplicate-row', index: 2 })).not.toThrow();
    expect(harness.model.rows).toBe(5);
  });

  it('re-renders the body from the model for a structural op on a merged grid', () => {
    const harness = createHarness({
      rows: 3,
      cols: 2,
      merges: [{ minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 }],
    });

    rowColOptions().onAction({ type: 'delete-row', index: 2 });

    expect(harness.host.rebuildTableBody).toHaveBeenCalled();
  });

  it('syncs the add-row button after a resize drag that outlived the buttons', () => {
    const harness = createHarness();
    const onChange = resizeArgs()[2] as (widths: number[]) => void;

    harness.subsystems.teardown();

    expect(() => onChange([11, 22])).not.toThrow();
    expect(harness.model.colWidths).toEqual([11, 22]);
  });

  it('labels each clipboard blob with its MIME type', () => {
    const harness = createHarness();
    const write = vi.fn<(items: Array<{ items: Record<string, Blob> }>) => Promise<void>>(() => Promise.resolve());

    vi.stubGlobal('ClipboardItem', class {
      public constructor(public readonly items: Record<string, Blob>) {}
    });
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });

    cellSelectionOptions().onCopyViaButton([harness.cellOf(0, 0)]);

    const items = write.mock.calls[0][0];

    expect(items[0].items['text/html'].type).toBe('text/html');
    expect(items[0].items['text/plain'].type).toBe('text/plain');
  });

  it('fills only the rows the rectangle covers', () => {
    const harness = createHarness({ rows: 5, cols: 3 });

    cellSelectionOptions().onFillCells([], { minRow: 1, maxRow: 2, minCol: 1, maxCol: 2 }, 'right');

    expect(harness.textOf(2, 2)).toBe('r2c1');
    expect(harness.textOf(3, 2)).toBe('r3c2');
    expect(harness.textOf(4, 2)).toBe('r4c2');
  });

  it('fills only the columns the rectangle covers', () => {
    const harness = createHarness({ rows: 3, cols: 5 });

    cellSelectionOptions().onFillCells([], { minRow: 1, maxRow: 2, minCol: 1, maxCol: 2 }, 'down');

    expect(harness.textOf(2, 2)).toBe('r1c2');
    expect(harness.textOf(2, 3)).toBe('r2c3');
    expect(harness.textOf(2, 4)).toBe('r2c4');
  });

  it('carries a tune through a duplicated row and omits it when there is none', () => {
    const harness = createHarness();

    harness.setTunes(0, 0, { align: 'right' });
    rowColOptions().onAction({ type: 'duplicate-row', index: 0 });

    expect(harness.insertCalls[0].tunes).toEqual({ align: 'right' });
    expect(harness.insertCalls[1].tunes).toBeUndefined();
  });

  it('reports an empty cell as carrying no blocks at all', () => {
    const harness = createHarness({ seed: false });
    const setData = vi.fn();

    cellSelectionOptions().onCopy([harness.cellOf(0, 0)], { setData } as unknown as DataTransfer);

    expect(String(setData.mock.calls[0][1])).toContain('"blocks":[]');
  });

  it('reads the clipboard as HTML, not as some other flavour', () => {
    const harness = createHarness();

    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]));

    expect(harness.textOf(0, 0)).toBe('P00');
  });

  it('leaves the caret alone when the inline insert ends on an empty element', () => {
    const harness = createHarness();
    const editable = caretAtEndOf(harness, 0, 0);

    expect(() => pasteAt(editable, clipHtml([{ row: 0, col: 0, blocks: [para('tail<br>')] }]))).not.toThrow();
    expect(editable.textContent).toBe('r0c0tail');
  });

  it('clears a destination text colour the payload does not carry', () => {
    const harness = createHarness();

    harness.model.setCellTextColor(0, 1, 'rgb(1, 2, 3)');
    harness.cellOf(0, 1).style.color = 'rgb(1, 2, 3)';

    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]));

    expect(harness.model.getCellTextColor(0, 1)).toBeUndefined();
    expect(harness.cellOf(0, 1).style.color).toBe('');
  });

  it('rebuilds a merge that starts below the top row of the payload', () => {
    const harness = createHarness({ rows: 4, cols: 4 });

    pasteInto(harness, 1, 1, buildClipboardHtml({
      rows: 2,
      cols: 2,
      cells: [
        [{ blocks: [para('A')] }, { blocks: [para('B')] }],
        [{ blocks: [para('WIDE')], colspan: 2 }, { blocks: [], covered: true }],
      ],
    }));

    expect(harness.model.getCellSpan(2, 1)).toEqual({ colspan: 2, rowspan: 1 });
  });

  it('marks the heading column on rows a paste grew without growing columns', () => {
    const harness = createHarness({ withHeadingColumn: true });

    pasteInto(harness, 1, 0, buildClipboardHtml({
      rows: 2,
      cols: 1,
      cells: [[{ blocks: [para('A')] }], [{ blocks: [para('B')] }]],
    }));

    expect(harness.model.rows).toBe(3);
    expect(harness.model.cols).toBe(2);
    expect(harness.cellOf(2, 0).hasAttribute('data-blok-table-heading-col')).toBe(true);
  });

  it('skips a target cell that has no block container', () => {
    const harness = createHarness();

    harness.cellOf(0, 1).querySelector(`[${CELL_BLOCKS_ATTR}]`)?.remove();

    expect(() => pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]))).not.toThrow();
    expect(harness.textOf(0, 0)).toBe('P00');
  });

  it('inserts a pasted block without stealing focus or replacing a block', () => {
    const harness = createHarness();

    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]));

    expect(harness.insertCalls[0].needToFocus).toBe(false);
    expect(harness.insertCalls[0].replace).toBe(false);
  });
});

describe('heading column after a columns-only paste', () => {
  it('marks the heading column the paste itself has to apply', () => {
    const harness = createHarness();

    // The grid was built without the heading column, so the paste's own
    // updateHeadingColumnStyles is the only thing that can mark it.
    harness.model.setWithHeadingColumn(true);
    pasteInto(harness, 0, 0, buildClipboardHtml({
      rows: 1,
      cols: 3,
      cells: [[{ blocks: [para('A')] }, { blocks: [para('B')] }, { blocks: [para('C')] }]],
    }));

    expect(harness.model.cols).toBe(3);
    expect(harness.model.rows).toBe(2);
    expect(harness.cellOf(0, 0).hasAttribute('data-blok-table-heading-col')).toBe(true);
    expect(harness.cellOf(1, 0).hasAttribute('data-blok-table-heading-col')).toBe(true);
  });
});

// ─── Second sweep round: call sites a passing test never noticed ─────
/*
 * Each test here pins a statement whose removal changed nothing any earlier
 * test observed: a repaint that happened to be repeated elsewhere, a guard
 * whose callee re-decides, a throw that jsdom routed to window's error event
 * instead of the test. The last group needs `windowErrorsWhile` — inside a
 * listener `dispatchEvent` swallows the exception, so "the test still passed"
 * is not evidence that nothing threw.
 */

/** The messages window reports while `fn` runs. A listener throw lands here. */
const windowErrorsWhile = (fn: () => void): string[] => {
  const messages: string[] = [];
  const onError = (event: ErrorEvent): void => {
    messages.push(String(event.error ?? event.message));
  };

  window.addEventListener('error', onError);

  try {
    fn();
  } finally {
    window.removeEventListener('error', onError);
  }

  return messages;
};

describe('add-controls — the statements a repaint repeated elsewhere', () => {
  it('pins the widths of a percent table when a drag adds a column', () => {
    const harness = createHarness({ colWidths: [40, 60] });

    applyPixelWidths(harness.gridEl, [40, 60]);
    harness.model.setColWidths(undefined);
    addControlsOptions().onDragAddCol();

    expect(harness.model.colWidths).toEqual([40, 60, 25]);
  });

  it('drops the trailing column from the DOM, not the one past it', () => {
    const harness = createHarness({ colWidths: [40, 60], seed: false });

    expect(addControlsOptions().onDragRemoveCol()).toBe(true);
    expect(harness.grid.getColumnCount(harness.gridEl)).toBe(1);
  });

  it('removes a trailing column of a percent table without pinning widths', () => {
    const harness = createHarness({ seed: false });

    expect(addControlsOptions().onDragRemoveCol()).toBe(true);
    expect(harness.model.cols).toBe(1);
    expect(harness.model.colWidths).toBeUndefined();
  });

  it('re-creates the resize handles when a drag removes a column', () => {
    createHarness({ colWidths: [40, 60], seed: false });

    const before = captured.resizeSelf.length;

    addControlsOptions().onDragRemoveCol();

    expect(captured.resizeSelf.length).toBe(before + 1);
  });

  it('re-creates the resize handles when a drag ends', () => {
    createHarness({ colWidths: [40, 60] });

    const before = captured.resizeSelf.length;

    addControlsOptions().onDragEnd();

    expect(captured.resizeSelf.length).toBe(before + 1);
  });
});

describe('corner drag — the statements a repaint repeated elsewhere', () => {
  it('drops the trailing column from the DOM on the corner drag', () => {
    const harness = createHarness({ seed: false });

    cornerDragOptions().onRemoveLastColumn();

    expect(harness.model.cols).toBe(1);
    expect(harness.grid.getColumnCount(harness.gridEl)).toBe(1);
  });

  it('re-creates the resize handles on the corner tap', () => {
    createHarness({ colWidths: [40, 60] });

    const before = captured.resizeSelf.length;

    cornerDragOptions().onClickAdd();

    expect(captured.resizeSelf.length).toBe(before + 1);
  });
});

describe('gestures that run after their collaborators are gone', () => {
  it('parks the affordances on a drag start that follows a teardown', () => {
    const harness = createHarness();
    const options = rowColOptions();

    harness.subsystems.teardown();

    expect(() => options.onDragStateChange(true, 'row', 0)).not.toThrow();
    expect(() => options.onDragStateChange(true, 'col', 0)).not.toThrow();
  });

  it('selects on a grip click that follows a teardown', () => {
    const harness = createHarness();
    const options = rowColOptions();

    harness.subsystems.teardown();

    expect(() => options.onGripClick('row', 0)).not.toThrow();
    expect(() => options.onGripClick('col', 0)).not.toThrow();
  });

  it('paints the moved column after a teardown', () => {
    const harness = createHarness();

    harness.subsystems.teardown();

    expect(() => rowColOptions().onAction({ type: 'move-col', fromIndex: 0, toIndex: 1 })).not.toThrow();
  });

  it('repositions the grips on refreshResize after a teardown', () => {
    const harness = createHarness();

    harness.subsystems.teardown();

    expect(() => harness.subsystems.refreshResize(harness.gridEl)).not.toThrow();
  });

  it('runs the resize callbacks after a teardown', () => {
    const harness = createHarness();
    const args = resizeArgs();
    const onResizeDragStart = args[3] as () => void;
    const onResizeDragEnd = args[4] as () => void;

    harness.subsystems.teardown();

    expect(() => onResizeDragStart()).not.toThrow();
    expect(() => onResizeDragEnd()).not.toThrow();
  });
});

describe('the copy button puts the payload in the blobs', () => {
  it('writes the html and the plain text, not two empty blobs', () => {
    const harness = createHarness();
    const write = vi.fn<(items: Array<{ items: Record<string, Blob> }>) => Promise<void>>(() => Promise.resolve());

    vi.stubGlobal('ClipboardItem', class {
      public constructor(public readonly items: Record<string, Blob>) {}
    });
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });

    cellSelectionOptions().onCopyViaButton([harness.cellOf(0, 0)]);

    const items = write.mock.calls[0][0];

    expect(items[0].items['text/plain'].size).toBe('r0c0'.length);
    expect(items[0].items['text/html'].size).toBeGreaterThan('r0c0'.length);
  });
});


describe('grid paste — the exceptions jsdom swallows', () => {
  it('ignores a grid paste whose focus is not inside any cell', () => {
    const harness = createHarness();
    const errors = windowErrorsWhile(() => {
      pasteAt(harness.gridEl, clipHtml([
        { row: 0, col: 0, blocks: [para('P00')] },
        { row: 0, col: 1, blocks: [para('P01')] },
      ]));
    });

    expect(errors).toStrictEqual([]);
    expect(harness.textOf(0, 0)).toBe('r0c0');
  });

  it('inserts nothing at all when the caret is gone', () => {
    const harness = createHarness();
    const errors = windowErrorsWhile(() => {
      const editable = harness.cellOf(0, 0).querySelector<HTMLElement>('[contenteditable="true"]');

      editable?.focus();
      window.getSelection()?.removeAllRanges();
      pasteAt(harness.cellOf(0, 0), clipHtml([{ row: 0, col: 0, blocks: [para('TAIL')] }]));
    });

    expect(errors).toStrictEqual([]);
    expect(harness.textOf(0, 0)).toBe('r0c0');
  });

  it('leaves the caret alone when the inline insert ends on a childless element', () => {
    const harness = createHarness();
    const errors = windowErrorsWhile(() => {
      caretAtEndOf(harness, 0, 0);
      pasteInto(harness, 0, 0, clipHtml([{ row: 0, col: 0, blocks: [para('<br>')] }]));
    });

    expect(errors).toStrictEqual([]);
  });

  it('recreates a list item carrying text instead of joining its text inline', () => {
    const harness = createHarness();

    caretAtEndOf(harness, 0, 0);
    pasteInto(harness, 0, 0, clipHtml([{ row: 0, col: 0, blocks: [{ tool: 'list-item', data: { text: 'item' } }] }]));

    expect(harness.insertCalls.map((call) => call.tool)).toEqual(['list-item']);
  });

  it('joins only the blocks that carry text, with no blank line', () => {
    const harness = createHarness();

    caretAtEndOf(harness, 0, 0);
    pasteInto(harness, 0, 0, clipHtml([{ row: 0, col: 0, blocks: [para(''), para('TAIL')] }]));

    expect(editableHtml(harness, 0, 0)).toBe('r0c0TAIL');
  });
});

describe('duplicate row/column — the axis the copy walks', () => {
  it('copies every column of a duplicated row, not just as many as there are rows', () => {
    const harness = createHarness({ rows: 2, cols: 4 });

    rowColOptions().onAction({ type: 'duplicate-row', index: 0 });

    expect(harness.textOf(1, 3)).toBe('r0c3');
  });

  it('adds the duplicated column to the RIGHT of its source in the model', () => {
    const harness = createHarness({ rows: 2, cols: 2 });

    rowColOptions().onAction({ type: 'duplicate-col', index: 0 });

    expect(harness.model.getCellBlocks(0, 0)).toStrictEqual(['b-0-0']);
    expect(harness.model.getCellBlocks(0, 2)).toStrictEqual(['b-0-1']);
  });
});

describe('cell colour — an invalid colour is dropped, an empty one is applied', () => {
  it('clears a painted text colour off the cell when the picker hands back null', () => {
    const harness = createHarness();
    const cell = harness.cellOf(0, 0);

    cell.style.color = 'red';
    cellSelectionOptions().onColorChange([cell], null, 'textColor');

    expect(cell.style.color).toBe('');
  });
});

describe('paste over a merge splits every origin in the region', () => {
  it('splits a merge whose origin sits below the first row of the region', () => {
    const harness = createHarness({
      rows: 5,
      cols: 2,
      merges: [{ minRow: 3, maxRow: 4, minCol: 0, maxCol: 0 }],
      liveRebuild: true,
    });

    pasteInto(harness, 2, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P0')] },
      { row: 1, col: 0, blocks: [para('P1')] },
      { row: 2, col: 0, blocks: [para('P2')] },
    ]));

    expect(harness.textOf(3, 0)).toBe('P1');
  });

  it('splits both merge origins the region covers, not just the last one', () => {
    const harness = createHarness({
      rows: 3,
      cols: 2,
      merges: [
        { minRow: 0, maxRow: 0, minCol: 0, maxCol: 1 },
        { minRow: 2, maxRow: 2, minCol: 0, maxCol: 1 },
      ],
      liveRebuild: true,
    });

    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P0')] },
      { row: 1, col: 0, blocks: [para('P1')] },
      { row: 2, col: 0, blocks: [para('P2')] },
    ]));

    expect(harness.model.isMergedCell(0, 0)).toBe(false);
    expect(harness.model.isMergedCell(2, 0)).toBe(false);
  });
});

describe('heading column markup follows a grip toggle', () => {
  it('marks the heading column in the DOM when a grip action turns it on', () => {
    const harness = createHarness();

    // The variant does not declare an index, and that is the point: the mutant
    // under test ignores what the action carries.
    rowColOptions().onAction(
      { type: 'toggle-heading-column', index: 0 } as unknown as Parameters<ReturnType<typeof rowColOptions>['onAction']>[0]
    );

    expect(harness.cellOf(1, 0).hasAttribute('data-blok-table-heading-col')).toBe(true);
  });
});

describe('pasted coordinates are read from the destination, not mirrored', () => {
  it('records a pasted cell at the row it actually landed on', () => {
    const harness = createHarness({ rows: 3, cols: 3 });

    pasteInto(harness, 1, 1, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 1, col: 0, blocks: [para('P10')] },
    ]));

    expect(harness.model.getCellBlocks(2, 1)).toStrictEqual(harness.idsOf(2, 1));
  });

  it('records an empty block list for a pasted cell with no cell-blocks manager', () => {
    const harness = createHarness({ rows: 2, cols: 2, noCellBlocks: true });

    pasteInto(harness, 0, 0, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
    ]));

    expect(harness.model.getCellBlocks(0, 0)).toStrictEqual([]);
  });

  it('seeds every cell a paste grows the grid with', () => {
    const harness = createHarness({ rows: 2, cols: 2 });

    pasteInto(harness, 1, 1, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')] },
      { row: 0, col: 1, blocks: [para('P01')] },
      { row: 1, col: 0, blocks: [para('P10')] },
      { row: 1, col: 1, blocks: [para('P11')] },
    ]));

    expect(harness.idsOf(2, 0)).toHaveLength(1);
    expect(harness.idsOf(0, 2)).toHaveLength(1);
  });

  it('lands a payload merge on the destination the payload names, clearing what it covers', () => {
    const harness = createHarness({ rows: 4, cols: 4, liveRebuild: true });

    harness.model.setCellColor(2, 3, 'red');
    harness.model.setCellTextColor(2, 3, 'blue');

    pasteInto(harness, 1, 1, buildClipboardHtml({
      rows: 3,
      cols: 3,
      cells: [
        [{ blocks: [para('A')] }, { blocks: [para('B')] }, { blocks: [para('C')] }],
        [{ blocks: [para('D')] }, { blocks: [para('WIDE')], colspan: 2 }, { blocks: [], covered: true }],
        [{ blocks: [para('G')] }, { blocks: [para('H')] }, { blocks: [para('I')] }],
      ],
    }));

    expect(harness.model.getCellSpan(2, 2)).toEqual({ colspan: 2, rowspan: 1 });
    expect(harness.model.getCellBlocks(2, 2)).toHaveLength(1);
    expect(harness.model.getCellColor(2, 3)).toBeUndefined();
    expect(harness.model.getCellTextColor(2, 3)).toBeUndefined();
  });

  it('skips a target cell with no block container instead of throwing', () => {
    const harness = createHarness();

    harness.cellOf(0, 1).querySelector(`[${CELL_BLOCKS_ATTR}]`)?.remove();

    const errors = windowErrorsWhile(() => {
      pasteInto(harness, 0, 0, clipHtml([
        { row: 0, col: 0, blocks: [para('P00')] },
        { row: 0, col: 1, blocks: [para('P01')] },
      ]));
    });

    expect(errors).toStrictEqual([]);
    expect(harness.textOf(0, 0)).toBe('P00');
  });
});

describe('pasted colours land on the destination too', () => {
  it('paints the second payload row at the row it landed on', () => {
    const harness = createHarness({ rows: 3, cols: 3 });

    pasteInto(harness, 1, 1, clipHtml([
      { row: 0, col: 0, blocks: [para('P00')], color: '#eee' },
      { row: 1, col: 0, blocks: [para('P10')], color: '#ddd' },
    ]));

    expect(harness.model.getCellColor(2, 1)).toBe('#ddd');
  });
});
