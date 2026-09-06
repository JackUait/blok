import type { API, BlockAPI, BlockToolData } from '../../../../types';
import type { BlockTuneData } from '../../../../types/block-tunes/block-tune-data';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TableCellBlocks, CELL_BLOCKS_ATTR, getCellFromElement } from '../../../../src/tools/table/table-cell-blocks';
import { TableModel } from '../../../../src/tools/table/table-model';
import { CELL_ATTR, ROW_ATTR, CELL_ROW_ATTR, CELL_COL_ATTR } from '../../../../src/tools/table/table-core';
import { DATA_ATTR } from '../../../../src/components/constants/data-attributes';
import type { CellContent, LegacyCellContent } from '../../../../src/tools/table/types';

interface InsertCall {
  tool: string | undefined;
  data: BlockToolData | undefined;
  index: number | undefined;
  needToFocus: boolean | undefined;
  replace: boolean | undefined;
  id: string | undefined;
  tunes: Record<string, BlockTuneData> | undefined;
}

interface StoredBlock {
  id: string;
  name: string;
  data: BlockToolData;
  holder: HTMLElement;
  parentId: string | null;
  api: BlockAPI;
}

interface Store {
  api: API;
  blocks: StoredBlock[];
  insertCalls: InsertCall[];
  parentCalls: Array<{ id: string; parentId: string | null }>;
  deleteCalls: number[];
  caretCalls: Array<{ id: string; position: string }>;
  transactCalls: number;
  unavailableTools: Set<string>;
  /** Lets a test decide where a freshly inserted holder lands in the DOM. */
  placeInsertedHolder: ((holder: HTMLElement) => void) | null;
  /** Core emits 'block changed' from inside insert(); opt in where that matters. */
  emitInsertEvents: boolean;
  currentBlockIndex: number;
  isSyncingFromYjs: boolean;
  add: (id: string, name?: string, data?: BlockToolData, parentId?: string | null) => StoredBlock;
  byId: (id: string) => StoredBlock;
  eventHandler: () => (data: unknown) => void;
  /** Drops one blocks-API method, the way a host that predates it would. */
  dropBlocksMethod: (name: 'getBlockIndex' | 'getBlockByIndex') => void;
  /**
   * Ids whose index still resolves but whose block does not — the transient
   * state a store is in between removing a block and reindexing.
   */
  hiddenFromIndex: Set<string>;
}

let idCounter = 0;

/**
 * An in-memory stand-in for the editor's block store. Real enough that DOM
 * holders, flat-array order and parentId all move the way core moves them —
 * assertions on cell membership and block order mean something only if these
 * three stay consistent.
 */
const createStore = (): Store => {
  const blocks: StoredBlock[] = [];
  const insertCalls: InsertCall[] = [];
  const parentCalls: Array<{ id: string; parentId: string | null }> = [];
  const deleteCalls: number[] = [];
  const caretCalls: Array<{ id: string; position: string }> = [];
  const unavailableTools = new Set<string>();
  const hiddenFromIndex = new Set<string>();
  const eventHandlers = new Map<string, (data: unknown) => void>();

  const state = {
    currentBlockIndex: -1,
    isSyncingFromYjs: false,
    transactCalls: 0,
    placeInsertedHolder: null as ((holder: HTMLElement) => void) | null,
    emitInsertEvents: false,
  };

  const makeBlock = (id: string, name: string, data: BlockToolData, parentId: string | null): StoredBlock => {
    const holder = document.createElement('div');

    holder.setAttribute('data-blok-id', id);

    // The getters read the record the tests mutate, so a test that re-parents a
    // block is visible through the BlockAPI the code under test holds.
    const api = {
      get id() {
        return stored.id;
      },
      get name() {
        return stored.name;
      },
      get holder() {
        return stored.holder;
      },
      get parentId() {
        return stored.parentId;
      },
      get preservedData() {
        return stored.data;
      },
    } as unknown as BlockAPI;

    const stored: StoredBlock = { id, name, data, holder, parentId, api };

    return stored;
  };

  const add = (id: string, name = 'paragraph', data: BlockToolData = {}, parentId: string | null = null): StoredBlock => {
    const stored = makeBlock(id, name, data, parentId);

    blocks.push(stored);

    return stored;
  };

  const byId = (id: string): StoredBlock => {
    const found = blocks.find(block => block.id === id);

    if (found === undefined) {
      throw new Error(`No block ${id} in the fake store`);
    }

    return found;
  };

  const insert = (
    tool?: string,
    data?: BlockToolData,
    _config?: unknown,
    index?: number,
    needToFocus?: boolean,
    replace?: boolean,
    id?: string,
    tunes?: Record<string, BlockTuneData>
  ): BlockAPI => {
    insertCalls.push({ tool, data, index, needToFocus, replace, id, tunes });

    const name = tool ?? 'paragraph';

    if (unavailableTools.has(name)) {
      throw new Error(`Tool ${name} is not registered`);
    }

    idCounter += 1;

    const stored = makeBlock(id ?? `made-${idCounter}`, name, data ?? {}, null);
    const at = index === undefined ? blocks.length : Math.min(Math.max(index, 0), blocks.length);

    blocks.splice(at, 0, stored);
    state.placeInsertedHolder?.(stored.holder);

    if (state.emitInsertEvents) {
      eventHandlers.get('block changed')?.({
        event: {
          type: 'block-added',
          detail: { target: { id: stored.id, holder: stored.holder }, index: at },
        },
      });
    }

    return stored.api;
  };

  const api = {
    blocks: {
      get isSyncingFromYjs() {
        return state.isSyncingFromYjs;
      },
      insert,
      insertInsideParent: (parentId: string, index?: number): BlockAPI => {
        const created = insert('paragraph', {}, {}, index, true);

        byId(created.id).parentId = parentId;

        return created;
      },
      delete: (index: number): Promise<void> => {
        deleteCalls.push(index);
        blocks.splice(index, 1);

        return Promise.resolve();
      },
      getBlockByIndex: (index: number): BlockAPI | undefined => {
        const found = blocks[index];

        return found === undefined || hiddenFromIndex.has(found.id) ? undefined : found.api;
      },
      getById: (id: string): BlockAPI | null => blocks.find(block => block.id === id)?.api ?? null,
      getBlockIndex: (id: string): number | undefined => {
        const index = blocks.findIndex(block => block.id === id);

        return index === -1 ? undefined : index;
      },
      getBlocksCount: (): number => blocks.length,
      getCurrentBlockIndex: (): number => state.currentBlockIndex,
      getChildren: (parentId: string): BlockAPI[] =>
        blocks.filter(block => block.parentId === parentId).map(block => block.api),
      setBlockParent: (id: string, parentId: string | null): void => {
        parentCalls.push({ id, parentId });
        const found = blocks.find(block => block.id === id);

        if (found !== undefined) {
          found.parentId = parentId;
        }
      },
      transactWithoutCapture: (fn: () => void): void => {
        state.transactCalls += 1;
        fn();
      },
    },
    events: {
      on: (name: string, handler: (data: unknown) => void): void => {
        eventHandlers.set(name, handler);
      },
      off: (name: string): void => {
        eventHandlers.delete(name);
      },
    },
    caret: {
      setToBlock: (id: string, position: string): boolean => {
        caretCalls.push({ id, position });

        return true;
      },
    },
  };

  return {
    api: api as unknown as API,
    blocks,
    insertCalls,
    parentCalls,
    deleteCalls,
    caretCalls,
    unavailableTools,
    hiddenFromIndex,
    get placeInsertedHolder() {
      return state.placeInsertedHolder;
    },
    set placeInsertedHolder(value: ((holder: HTMLElement) => void) | null) {
      state.placeInsertedHolder = value;
    },
    get emitInsertEvents() {
      return state.emitInsertEvents;
    },
    set emitInsertEvents(value: boolean) {
      state.emitInsertEvents = value;
    },
    get transactCalls() {
      return state.transactCalls;
    },
    get currentBlockIndex() {
      return state.currentBlockIndex;
    },
    set currentBlockIndex(value: number) {
      state.currentBlockIndex = value;
    },
    get isSyncingFromYjs() {
      return state.isSyncingFromYjs;
    },
    set isSyncingFromYjs(value: boolean) {
      state.isSyncingFromYjs = value;
    },
    add,
    byId,
    dropBlocksMethod: (name: 'getBlockIndex' | 'getBlockByIndex'): void => {
      const blocksApi = api.blocks as unknown as Record<string, unknown>;

      blocksApi[name] = undefined;
    },
    eventHandler: (): ((data: unknown) => void) => {
      const handler = eventHandlers.get('block changed');

      if (handler === undefined) {
        throw new Error('block changed handler was never registered');
      }

      return handler;
    },
  };
};

interface Grid {
  element: HTMLElement;
  tableHolder: HTMLElement;
  cell: (row: number, col: number) => HTMLElement;
  container: (row: number, col: number) => HTMLElement;
}

/**
 * Builds the DOM shape TableCellBlocks reads: rows carrying ROW_ATTR, cells
 * carrying their LOGICAL row/col, and one CELL_BLOCKS_ATTR container per cell.
 * The colgroup is what getColumnCount prefers over counting cells.
 */
const buildGrid = (rows: number, cols: number): Grid => {
  const tableHolder = document.createElement('div');
  const element = document.createElement('div');
  const colgroup = document.createElement('colgroup');

  for (let col = 0; col < cols; col += 1) {
    colgroup.appendChild(document.createElement('col'));
  }
  element.appendChild(colgroup);

  for (let row = 0; row < rows; row += 1) {
    const rowEl = document.createElement('div');

    rowEl.setAttribute(ROW_ATTR, '');

    for (let col = 0; col < cols; col += 1) {
      const cellEl = document.createElement('div');

      cellEl.setAttribute(CELL_ATTR, '');
      cellEl.setAttribute(CELL_ROW_ATTR, String(row));
      cellEl.setAttribute(CELL_COL_ATTR, String(col));

      const container = document.createElement('div');

      container.setAttribute(CELL_BLOCKS_ATTR, '');
      // table-core stamps both: the nested-blocks marker is what the
      // already-mounted-elsewhere guards in claimBlockForCell read.
      container.setAttribute(DATA_ATTR.nestedBlocks, '');
      cellEl.appendChild(container);
      rowEl.appendChild(cellEl);
    }

    element.appendChild(rowEl);
  }

  tableHolder.appendChild(element);
  document.body.appendChild(tableHolder);

  const cell = (row: number, col: number): HTMLElement => {
    const found = element.querySelectorAll<HTMLElement>(`[${ROW_ATTR}]`)[row]
      ?.querySelector<HTMLElement>(`[${CELL_COL_ATTR}="${col}"]`);

    if (!found) {
      throw new Error(`No cell ${row}:${col}`);
    }

    return found;
  };

  return {
    element,
    tableHolder,
    cell,
    container: (row: number, col: number): HTMLElement => {
      const found = cell(row, col).querySelector<HTMLElement>(`[${CELL_BLOCKS_ATTR}]`);

      if (!found) {
        throw new Error(`No container ${row}:${col}`);
      }

      return found;
    },
  };
};

/** Ids of the block holders mounted in a cell container, in DOM order. */
const holderIds = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('[data-blok-id]')).map(el => el.getAttribute('data-blok-id') ?? '');

/** A contenteditable carrying `text`, mounted as one block inside a cell. */
const mountEditable = (container: HTMLElement, id: string, text: string): HTMLElement => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-id', id);

  const editable = document.createElement('div');

  editable.setAttribute('contenteditable', 'true');
  editable.textContent = text;
  holder.appendChild(editable);
  container.appendChild(holder);

  return editable;
};

/** Puts a collapsed caret at `offset` inside the element's first text node. */
const placeCaret = (editable: HTMLElement, offset: number): void => {
  const textNode = editable.firstChild;

  if (textNode === null) {
    throw new Error('editable has no text node to place a caret in');
  }

  const range = document.createRange();

  range.setStart(textNode, offset);
  range.collapse(true);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);
};

const keyEvent = (key: string, modifiers: Partial<KeyboardEventInit> = {}): KeyboardEvent =>
  new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });

interface SetupOptions {
  rows?: number;
  cols?: number;
  content?: LegacyCellContent[][];
  tableBlockId?: string;
  isStructuralOpActive?: () => boolean;
  onCellReferenceDropped?: () => void;
  onNavigateToCell?: (position: { row: number; col: number }) => void;
}

interface Fixture {
  store: Store;
  grid: Grid;
  model: TableModel;
  instance: TableCellBlocks;
}

const emptyContent = (rows: number, cols: number): CellContent[][] =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ blocks: [] as string[] })));

const setup = (options: SetupOptions = {}): Fixture => {
  const rows = options.rows ?? 2;
  const cols = options.cols ?? 2;
  const grid = buildGrid(rows, cols);
  const store = createStore();
  const tableBlockId = options.tableBlockId ?? 'table-1';
  const tableBlock = store.add(tableBlockId, 'table');

  tableBlock.holder = grid.tableHolder;
  grid.tableHolder.setAttribute('data-blok-id', tableBlockId);

  const model = new TableModel({ content: options.content ?? emptyContent(rows, cols) });
  const instance = new TableCellBlocks({
    api: store.api,
    gridElement: grid.element,
    tableBlockId,
    model,
    isStructuralOpActive: options.isStructuralOpActive,
    onCellReferenceDropped: options.onCellReferenceDropped,
    onNavigateToCell: options.onNavigateToCell,
  });

  return { store, grid, model, instance };
};

/** Mounts a stored block's holder into a cell container and tells the model. */
const mountStoredBlock = (fixture: Fixture, row: number, col: number, id: string): void => {
  const { grid, store, model } = fixture;
  const stored = store.byId(id);

  grid.container(row, col).appendChild(stored.holder);
  stored.parentId = 'table-1';
  model.addBlockToCell(row, col, id);
};

const blockAddedEvent = (id: string, holder: HTMLElement, index?: number): unknown => ({
  event: { type: 'block-added', detail: { target: { id, holder }, index } },
});

const blockRemovedEvent = (id: string, holder: HTMLElement, index?: number): unknown => ({
  event: { type: 'block-removed', detail: { target: { id, holder }, index } },
});

const blockMovedEvent = (id: string, holder: HTMLElement): unknown => ({
  event: { type: 'block-moved', detail: { target: { id, holder } } },
});

// One pair for the whole file: every fixture builds its own grid into
// document.body, so a leftover grid would make the next test's queries ambiguous.
beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe('TableCellBlocks — surviving-mutant coverage', () => {
  describe('getCellFromElement', () => {
    it('finds the nearest cell ancestor and returns null outside one', () => {
      const grid = buildGrid(1, 1);
      const inner = document.createElement('span');

      grid.container(0, 0).appendChild(inner);

      expect(getCellFromElement(inner)).toBe(grid.cell(0, 0));
      expect(getCellFromElement(document.createElement('span'))).toBeNull();
    });
  });

  describe('reclaimReferencedBlocks', () => {
    it('re-mounts a referenced block into the cell the model names, not the first cell', () => {
      const fixture = setup({ rows: 2, cols: 2 });
      const stray = fixture.store.add('stray', 'paragraph', { text: 'x' }, 'table-1');

      document.body.appendChild(stray.holder);
      fixture.model.addBlockToCell(1, 1, 'stray');

      fixture.instance.reclaimReferencedBlocks();

      expect(stray.holder.parentElement).toBe(fixture.grid.container(1, 1));
      expect(fixture.store.byId('stray').parentId).toBe('table-1');
    });

    it('leaves a block already mounted in its cell untouched', () => {
      const fixture = setup({ rows: 1, cols: 1 });

      fixture.store.add('first', 'paragraph', {}, 'table-1');
      fixture.store.add('second', 'paragraph', {}, 'table-1');
      mountStoredBlock(fixture, 0, 0, 'first');
      mountStoredBlock(fixture, 0, 0, 'second');

      const parentCallsBefore = fixture.store.parentCalls.length;

      fixture.instance.reclaimReferencedBlocks();

      expect(holderIds(fixture.grid.container(0, 0))).toEqual(['first', 'second']);
      expect(fixture.store.parentCalls.length).toBe(parentCallsBefore);
    });

    it('skips ids the store no longer knows and still reclaims the rest of the cell', () => {
      const fixture = setup({ rows: 1, cols: 2 });
      const late = fixture.store.add('late', 'paragraph', {}, 'table-1');

      document.body.appendChild(late.holder);
      fixture.model.setCellBlocks(0, 1, ['gone', 'late']);

      fixture.instance.reclaimReferencedBlocks();

      expect(late.holder.parentElement).toBe(fixture.grid.container(0, 1));
    });

    it('ignores model cells that have no rendered cell element', () => {
      const fixture = setup({ rows: 1, cols: 1, content: emptyContent(2, 2) });
      const stray = fixture.store.add('stray', 'paragraph', {}, 'table-1');

      document.body.appendChild(stray.holder);
      fixture.model.addBlockToCell(1, 1, 'stray');

      expect(() => fixture.instance.reclaimReferencedBlocks()).not.toThrow();
      expect(stray.holder.parentElement).toBe(document.body);
    });

    it('ignores a cell whose blocks container was removed', () => {
      const fixture = setup({ rows: 1, cols: 1 });
      const stray = fixture.store.add('stray', 'paragraph', {}, 'table-1');

      document.body.appendChild(stray.holder);
      fixture.model.addBlockToCell(0, 0, 'stray');
      fixture.grid.container(0, 0).remove();

      expect(() => fixture.instance.reclaimReferencedBlocks()).not.toThrow();
      expect(stray.holder.parentElement).toBe(document.body);
    });
  });

  describe('focusClearedCell', () => {
    it('repairs an emptied cell on the next frame and puts the caret in the new block', () => {
      const fixture = setup({ rows: 1, cols: 1 });

      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
        callback(0);

        return 1;
      });

      fixture.instance.focusClearedCell(fixture.grid.cell(0, 0));

      const holders = holderIds(fixture.grid.container(0, 0));

      expect(holders).toHaveLength(1);
      expect(fixture.store.caretCalls).toEqual([{ id: holders[0], position: 'start' }]);
    });

    it('targets the FIRST block of a cell that still has content', () => {
      const fixture = setup({ rows: 1, cols: 1 });

      fixture.store.add('top', 'paragraph', {}, 'table-1');
      fixture.store.add('bottom', 'paragraph', {}, 'table-1');
      mountStoredBlock(fixture, 0, 0, 'top');
      mountStoredBlock(fixture, 0, 0, 'bottom');

      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
        callback(0);

        return 1;
      });

      fixture.instance.focusClearedCell(fixture.grid.cell(0, 0));

      expect(fixture.store.caretCalls).toEqual([{ id: 'top', position: 'start' }]);
    });

    it('does nothing when the cell has left the grid before the frame runs', () => {
      const fixture = setup({ rows: 1, cols: 1 });
      const cell = fixture.grid.cell(0, 0);
      const frames: FrameRequestCallback[] = [];

      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
        frames.push(callback);

        return 1;
      });

      fixture.instance.focusClearedCell(cell);
      cell.remove();
      frames.forEach(frame => frame(0));

      expect(fixture.store.caretCalls).toEqual([]);
      expect(fixture.store.insertCalls).toEqual([]);
    });
  });

  describe('ensureCellHasBlock', () => {
    it('inserts a focused repair paragraph inside a no-capture transaction and tracks it', () => {
      const fixture = setup({ rows: 1, cols: 1 });

      fixture.instance.ensureCellHasBlock(fixture.grid.cell(0, 0));

      expect(fixture.store.transactCalls).toBe(1);
      expect(fixture.store.insertCalls).toHaveLength(1);
      expect(fixture.store.insertCalls[0]).toMatchObject({
        tool: 'paragraph',
        data: { text: '' },
        needToFocus: true,
      });

      const created = holderIds(fixture.grid.container(0, 0))[0];

      expect(fixture.model.getCellBlocks(0, 0)).toEqual([created]);
      expect(fixture.store.byId(created).parentId).toBe('table-1');
    });

    it('does not insert when the cell already holds a block', () => {
      const fixture = setup({ rows: 1, cols: 1 });

      fixture.store.add('kept', 'paragraph', {}, 'table-1');
      mountStoredBlock(fixture, 0, 0, 'kept');

      fixture.instance.ensureCellHasBlock(fixture.grid.cell(0, 0));

      expect(fixture.store.insertCalls).toEqual([]);
    });

    it('does nothing for a cell that has no blocks container', () => {
      const fixture = setup({ rows: 1, cols: 1 });

      fixture.grid.container(0, 0).remove();
      fixture.instance.ensureCellHasBlock(fixture.grid.cell(0, 0));

      expect(fixture.store.insertCalls).toEqual([]);
    });
  });
});

describe('TableCellBlocks — initializeCells', () => {
  it('turns a legacy list string into one list block per item, keeping order', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    const result = fixture.instance.initializeCells([['<ul><li>one</li><li>two</li></ul>']]);

    expect(fixture.store.insertCalls.map(call => call.tool)).toEqual(['list', 'list']);
    expect(fixture.store.insertCalls.map(call => call.data?.text)).toEqual(['one', 'two']);
    expect(holderIds(fixture.grid.container(0, 0))).toEqual(result[0][0].blocks);
    expect(result[0][0].blocks).toHaveLength(2);
  });

  it('degrades a list item to a paragraph carrying its text when the list tool is missing', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.unavailableTools.add('list');

    const result = fixture.instance.initializeCells([['<ul><li>only</li></ul>']]);

    expect(fixture.store.insertCalls.map(call => call.tool)).toEqual(['list', 'paragraph']);
    expect(fixture.store.insertCalls[1].data).toStrictEqual({ text: 'only' });
    expect(result[0][0].blocks).toHaveLength(1);
  });

  it('does not re-insert a paragraph through the failing branch', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.instance.initializeCells([['plain text']]);

    expect(fixture.store.insertCalls.map(call => call.tool)).toEqual(['paragraph']);
    expect(fixture.store.insertCalls[0].data).toStrictEqual({ text: 'plain text' });
  });

  it('seeds a cell from structured clipboard blocks, tunes and all, instead of re-parsing text', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    const result = fixture.instance.initializeCells([[{
      blocks: [],
      text: 'flattened alt text',
      blockData: [{ tool: 'image', data: { file: { url: 'u' } }, tunes: { align: { value: 'center' } } }],
    }]]);

    expect(fixture.store.insertCalls).toHaveLength(1);
    expect(fixture.store.insertCalls[0]).toStrictEqual({
      tool: 'image',
      data: { file: { url: 'u' } },
      index: 1,
      needToFocus: false,
      replace: false,
      id: undefined,
      tunes: { align: { value: 'center' } },
    });
    expect(result[0][0].blocks).toHaveLength(1);
  });

  it('degrades an unregistered clipboard block to a paragraph carrying its text', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.unavailableTools.add('code');
    fixture.instance.initializeCells([[{
      blocks: [],
      blockData: [{ tool: 'code', data: { text: 'const a = 1;' } }],
    }]]);

    expect(fixture.store.insertCalls.map(call => call.tool)).toEqual(['code', 'paragraph']);
    expect(fixture.store.insertCalls[1]).toStrictEqual({
      tool: 'paragraph',
      data: { text: 'const a = 1;' },
      index: 1,
      needToFocus: false,
      replace: undefined,
      id: undefined,
      tunes: undefined,
    });
  });

  it('degrades an unregistered non-text clipboard block to an EMPTY paragraph', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.unavailableTools.add('image');
    fixture.instance.initializeCells([[{
      blocks: [],
      blockData: [{ tool: 'image', data: { file: { url: 'u' } } }],
    }]]);

    expect(fixture.store.insertCalls[1].data).toStrictEqual({ text: '' });
  });

  it('preserves a merge-covered placeholder as a copy and creates no block for it', () => {
    const merged: CellContent[][] = [
      [{ blocks: ['origin'] }, { blocks: [], mergedInto: [0, 0] }],
    ];
    const fixture = setup({ rows: 1, cols: 2, content: merged });

    fixture.store.add('origin', 'paragraph', {}, 'table-1');

    const result = fixture.instance.initializeCells(merged);

    expect(result[0][1]).toStrictEqual({ blocks: [], mergedInto: [0, 0] });
    expect(result[0][1].mergedInto).not.toBe(merged[0][1].mergedInto);
    expect(fixture.store.insertCalls).toEqual([]);
  });

  it('keeps span metadata only when it actually spans, and omits absent colors', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('kept', 'paragraph', {}, 'table-1');

    const result = fixture.instance.initializeCells([[{
      blocks: ['kept'],
      colspan: 1,
      rowspan: 3,
      placement: 'middle-center',
      color: 'red',
    }]]);

    expect(result[0][0]).toStrictEqual({
      blocks: ['kept'],
      color: 'red',
      rowspan: 3,
      placement: 'middle-center',
    });
  });

  it('keeps a text color without a background color', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('kept', 'paragraph', {}, 'table-1');

    const result = fixture.instance.initializeCells([[{ blocks: ['kept'], textColor: 'blue' }]]);

    expect(result[0][0]).toStrictEqual({ blocks: ['kept'], textColor: 'blue' });
  });

  it('mounts referenced blocks into their cell and strips paragraph placeholders', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const kept = fixture.store.add('kept', 'paragraph', {}, 'table-1');
    const editable = document.createElement('div');

    editable.setAttribute('contenteditable', 'true');
    editable.setAttribute('data-blok-placeholder-active', 'true');
    editable.setAttribute('data-placeholder', 'Type here');
    kept.holder.appendChild(editable);
    document.body.appendChild(kept.holder);

    fixture.instance.initializeCells([[{ blocks: ['kept'] }]]);

    expect(kept.holder.parentElement).toBe(fixture.grid.container(0, 0));
    expect(editable.hasAttribute('data-blok-placeholder-active')).toBe(false);
    expect(editable.hasAttribute('data-placeholder')).toBe(false);
  });

  it('duplicates a referenced block that is mounted in ANOTHER live table and reports the new id', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const foreignGrid = buildGrid(1, 1);
    const owned = fixture.store.add('owned', 'header', { text: 'stolen?' }, 'other-table');

    foreignGrid.container(0, 0).appendChild(owned.holder);

    const result = fixture.instance.initializeCells([[{ blocks: ['owned'] }]]);

    expect(fixture.store.insertCalls[0]).toMatchObject({ tool: 'header', data: { text: 'stolen?' } });
    expect(result[0][0].blocks).not.toEqual(['owned']);
    expect(result[0][0].blocks).toHaveLength(1);
    expect(owned.holder.parentElement).toBe(foreignGrid.container(0, 0));
  });

  it('re-mounts OUR OWN block stranded in a previous render instead of duplicating it', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const detachedGrid = buildGrid(1, 1);
    const own = fixture.store.add('own', 'paragraph', {}, 'table-1');

    detachedGrid.container(0, 0).appendChild(own.holder);
    detachedGrid.tableHolder.remove();

    const result = fixture.instance.initializeCells([[{ blocks: ['own'] }]]);

    expect(fixture.store.insertCalls).toEqual([]);
    expect(result[0][0]).toStrictEqual({ blocks: ['own'] });
    expect(own.holder.parentElement).toBe(fixture.grid.container(0, 0));
  });

  it('duplicates a loose block whose parentId names a different owner', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const foreign = fixture.store.add('foreign', 'paragraph', { text: 'theirs' }, 'other-table');

    document.body.appendChild(foreign.holder);

    const result = fixture.instance.initializeCells([[{ blocks: ['foreign'] }]]);

    expect(fixture.store.insertCalls).toHaveLength(1);
    expect(result[0][0].blocks).not.toEqual(['foreign']);
  });

  it('appends new blocks after the ids it could not mount', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    const result = fixture.instance.initializeCells([[{ blocks: ['ghost'], text: 'typed' }]]);

    expect(result[0][0].blocks[0]).toBe('ghost');
    expect(result[0][0].blocks).toHaveLength(2);
  });

  it('gives a rendered cell the model never described its own editable paragraph', () => {
    const fixture = setup({ rows: 1, cols: 2, content: [[{ blocks: [] }]] });

    const result = fixture.instance.initializeCells([[{ blocks: [] }]]);

    expect(result[0]).toHaveLength(2);
    expect(result[0][1].blocks).toHaveLength(1);
    expect(holderIds(fixture.grid.container(0, 1))).toEqual(result[0][1].blocks);
  });

  it('skips the completeness sweep while Yjs is replaying', () => {
    const fixture = setup({ rows: 1, cols: 2, content: [[{ blocks: [] }]] });

    fixture.store.isSyncingFromYjs = true;

    const result = fixture.instance.initializeCells([[{ blocks: [] }]]);

    expect(result[0]).toHaveLength(1);
    expect(holderIds(fixture.grid.container(0, 1))).toEqual([]);
  });

  it('skips the completeness sweep for a merged table', () => {
    const merged: CellContent[][] = [[{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }]];
    const fixture = setup({ rows: 1, cols: 2, content: merged });

    const result = fixture.instance.initializeCells([[{ blocks: [] }]]);

    expect(result[0]).toHaveLength(1);
  });

  it('ignores content rows the grid does not render', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    const result = fixture.instance.initializeCells([[{ blocks: [] }], [{ blocks: [] }]]);

    expect(result).toHaveLength(1);
  });
});

describe('TableCellBlocks — block order inside a cell', () => {
  it('claims a block into the DOM slot its flat index names, not the end of the cell', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('a');
    fixture.store.add('b');
    fixture.store.add('c');
    mountStoredBlock(fixture, 0, 0, 'a');
    mountStoredBlock(fixture, 0, 0, 'c');
    document.body.appendChild(fixture.store.byId('b').holder);

    fixture.instance.claimBlockForCell(fixture.grid.cell(0, 0), 'b');

    expect(holderIds(fixture.grid.container(0, 0))).toEqual(['a', 'b', 'c']);
  });

  it('appends a claimed block whose flat index is past every mounted sibling', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('a');
    fixture.store.add('b');
    fixture.store.add('tail');
    mountStoredBlock(fixture, 0, 0, 'a');
    mountStoredBlock(fixture, 0, 0, 'b');
    document.body.appendChild(fixture.store.byId('tail').holder);

    fixture.instance.claimBlockForCell(fixture.grid.cell(0, 0), 'tail');

    expect(holderIds(fixture.grid.container(0, 0))).toEqual(['a', 'b', 'tail']);
  });

  it('records a mid-cell insert at the position the user sees, not at the end', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('a');
    fixture.store.add('mid');
    fixture.store.add('c');
    mountStoredBlock(fixture, 0, 0, 'a');
    mountStoredBlock(fixture, 0, 0, 'c');

    const container = fixture.grid.container(0, 0);

    container.insertBefore(fixture.store.byId('mid').holder, fixture.store.byId('c').holder);
    fixture.store.eventHandler()(blockAddedEvent('mid', fixture.store.byId('mid').holder, 2));

    expect(fixture.model.getCellBlocks(0, 0)).toEqual(['a', 'mid', 'c']);
  });

  it('appends to the model when the new holder is last in the cell', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('a');
    fixture.store.add('b');
    fixture.store.add('tail');
    mountStoredBlock(fixture, 0, 0, 'a');
    mountStoredBlock(fixture, 0, 0, 'b');
    fixture.grid.container(0, 0).appendChild(fixture.store.byId('tail').holder);
    fixture.store.eventHandler()(blockAddedEvent('tail', fixture.store.byId('tail').holder, 3));

    expect(fixture.model.getCellBlocks(0, 0)).toEqual(['a', 'b', 'tail']);
  });

  it('refuses to append the table block into one of its own cells', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.instance.claimBlockForCell(fixture.grid.cell(0, 0), 'table-1');

    expect(holderIds(fixture.grid.container(0, 0))).toEqual([]);
  });

  it('does not steal a block that is mounted in another live table', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const foreignGrid = buildGrid(1, 1);
    const owned = fixture.store.add('owned', 'paragraph', {}, 'other-table');

    foreignGrid.container(0, 0).appendChild(owned.holder);
    fixture.instance.claimBlockForCell(fixture.grid.cell(0, 0), 'owned');

    expect(owned.holder.parentElement).toBe(foreignGrid.container(0, 0));
  });

  it('reclaims our own block from a detached previous render', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const detachedGrid = buildGrid(1, 1);
    const own = fixture.store.add('own', 'paragraph', {}, 'table-1');

    detachedGrid.container(0, 0).appendChild(own.holder);
    detachedGrid.tableHolder.remove();
    fixture.instance.claimBlockForCell(fixture.grid.cell(0, 0), 'own');

    expect(own.holder.parentElement).toBe(fixture.grid.container(0, 0));
  });

  it('ignores an unknown block id and a cell with no container', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.instance.claimBlockForCell(fixture.grid.cell(0, 0), 'nobody');
    expect(holderIds(fixture.grid.container(0, 0))).toEqual([]);

    fixture.store.add('loose');
    document.body.appendChild(fixture.store.byId('loose').holder);
    fixture.grid.container(0, 0).remove();
    fixture.instance.claimBlockForCell(fixture.grid.cell(0, 0), 'loose');

    expect(fixture.store.byId('loose').holder.parentElement).toBe(document.body);
  });
});

/** Two editable blocks per cell so "first vs last block" and focusLast are visible. */
const fillGridWithEditables = (grid: Grid, rows: number, cols: number): void => {
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      mountEditable(grid.container(row, col), `b-${row}-${col}-0`, `first ${row}${col}`);
      mountEditable(grid.container(row, col), `b-${row}-${col}-1`, `last ${row}${col}`);
    }
  }
};

const editableIn = (grid: Grid, row: number, col: number, ordinal: number): HTMLElement => {
  const found = grid.container(row, col).querySelectorAll<HTMLElement>('[contenteditable="true"]')[ordinal];

  if (!found) {
    throw new Error(`No editable ${ordinal} in ${row}:${col}`);
  }

  return found;
};

describe('TableCellBlocks — arrow navigation across the grid', () => {
  it.each(['shiftKey', 'metaKey', 'ctrlKey', 'altKey'] as const)(
    'leaves a %s-modified arrow to the browser',
    modifier => {
      const fixture = setup({ rows: 2, cols: 2 });

      fillGridWithEditables(fixture.grid, 2, 2);
      placeCaret(editableIn(fixture.grid, 0, 0, 1), 0);

      const event = keyEvent('ArrowDown', { [modifier]: true });

      fixture.instance.handleArrowNavigation(event, { row: 0, col: 0 });

      expect(event.defaultPrevented).toBe(false);
      expect(fixture.store.caretCalls).toEqual([]);
    }
  );

  it('moves the caret down one row when the caret sits in the cell last block', () => {
    const seen: Array<{ row: number; col: number }> = [];
    const fixture = setup({ rows: 2, cols: 2, onNavigateToCell: position => seen.push(position) });

    fillGridWithEditables(fixture.grid, 2, 2);
    placeCaret(editableIn(fixture.grid, 0, 0, 1), 0);

    const event = keyEvent('ArrowDown');

    fixture.instance.handleArrowNavigation(event, { row: 0, col: 0 });

    expect(event.defaultPrevented).toBe(true);
    expect(editableIn(fixture.grid, 1, 0, 0)).toHaveFocus();
    expect(seen).toEqual([{ row: 1, col: 0 }]);
  });

  it('leaves ArrowDown alone while the caret is above the cell last block', () => {
    const fixture = setup({ rows: 2, cols: 2 });

    fillGridWithEditables(fixture.grid, 2, 2);
    placeCaret(editableIn(fixture.grid, 0, 0, 0), 0);

    const event = keyEvent('ArrowDown');

    fixture.instance.handleArrowNavigation(event, { row: 0, col: 0 });

    expect(event.defaultPrevented).toBe(false);
    expect(editableIn(fixture.grid, 1, 0, 0)).not.toHaveFocus();
  });

  it('moves up into the LAST block of the cell above', () => {
    const fixture = setup({ rows: 2, cols: 2 });

    fillGridWithEditables(fixture.grid, 2, 2);
    placeCaret(editableIn(fixture.grid, 1, 0, 0), 0);

    const event = keyEvent('ArrowUp');

    fixture.instance.handleArrowNavigation(event, { row: 1, col: 0 });

    expect(event.defaultPrevented).toBe(true);
    expect(editableIn(fixture.grid, 0, 0, 1)).toHaveFocus();
  });

  it('leaves ArrowUp alone while the caret is below the cell first block', () => {
    const fixture = setup({ rows: 2, cols: 2 });

    fillGridWithEditables(fixture.grid, 2, 2);
    placeCaret(editableIn(fixture.grid, 1, 0, 1), 0);

    const event = keyEvent('ArrowUp');

    fixture.instance.handleArrowNavigation(event, { row: 1, col: 0 });

    expect(event.defaultPrevented).toBe(false);
  });

  it('skips a merge-covered row when moving down', () => {
    const content: CellContent[][] = [
      [{ blocks: [] }],
      [{ blocks: [], mergedInto: [0, 0] }],
      [{ blocks: [] }],
    ];
    const fixture = setup({ rows: 3, cols: 1, content });

    fillGridWithEditables(fixture.grid, 3, 1);
    placeCaret(editableIn(fixture.grid, 0, 0, 1), 0);
    fixture.instance.handleArrowNavigation(keyEvent('ArrowDown'), { row: 0, col: 0 });

    expect(editableIn(fixture.grid, 2, 0, 0)).toHaveFocus();
  });

  it('exits the table forward from the bottom row', () => {
    const fixture = setup({ rows: 2, cols: 1 });

    fixture.store.add('after');
    fillGridWithEditables(fixture.grid, 2, 1);
    placeCaret(editableIn(fixture.grid, 1, 0, 1), 0);
    fixture.instance.handleArrowNavigation(keyEvent('ArrowDown'), { row: 1, col: 0 });

    expect(fixture.store.caretCalls).toEqual([{ id: 'after', position: 'start' }]);
  });

  it('exits the table backward from the top row', () => {
    const fixture = setup({ rows: 2, cols: 1 });
    const before = fixture.store.add('before');

    fixture.store.blocks.splice(fixture.store.blocks.indexOf(before), 1);
    fixture.store.blocks.unshift(before);
    fillGridWithEditables(fixture.grid, 2, 1);
    placeCaret(editableIn(fixture.grid, 0, 0, 0), 0);
    fixture.instance.handleArrowNavigation(keyEvent('ArrowUp'), { row: 0, col: 0 });

    expect(fixture.store.caretCalls).toEqual([{ id: 'before', position: 'end' }]);
  });

  it('crosses to the next cell only once the caret reaches the end of its text', () => {
    const fixture = setup({ rows: 1, cols: 2 });

    fillGridWithEditables(fixture.grid, 1, 2);

    const source = editableIn(fixture.grid, 0, 0, 1);

    placeCaret(source, 1);

    const midEvent = keyEvent('ArrowRight');

    fixture.instance.handleArrowNavigation(midEvent, { row: 0, col: 0 });
    expect(midEvent.defaultPrevented).toBe(false);

    placeCaret(source, source.textContent?.length ?? 0);

    const edgeEvent = keyEvent('ArrowRight');

    fixture.instance.handleArrowNavigation(edgeEvent, { row: 0, col: 0 });
    expect(edgeEvent.defaultPrevented).toBe(true);
    expect(editableIn(fixture.grid, 0, 1, 0)).toHaveFocus();
  });

  it('crosses to the previous cell LAST block only from the start of its text', () => {
    const fixture = setup({ rows: 1, cols: 2 });

    fillGridWithEditables(fixture.grid, 1, 2);

    const source = editableIn(fixture.grid, 0, 1, 0);

    placeCaret(source, 2);

    const midEvent = keyEvent('ArrowLeft');

    fixture.instance.handleArrowNavigation(midEvent, { row: 0, col: 1 });
    expect(midEvent.defaultPrevented).toBe(false);

    placeCaret(source, 0);

    const edgeEvent = keyEvent('ArrowLeft');

    fixture.instance.handleArrowNavigation(edgeEvent, { row: 0, col: 1 });
    expect(edgeEvent.defaultPrevented).toBe(true);
    expect(editableIn(fixture.grid, 0, 0, 1)).toHaveFocus();
  });

  it('exits forward past the last cell and backward before the first', () => {
    const fixture = setup({ rows: 1, cols: 2 });

    fixture.store.add('after');
    fillGridWithEditables(fixture.grid, 1, 2);

    const last = editableIn(fixture.grid, 0, 1, 1);

    placeCaret(last, last.textContent?.length ?? 0);
    fixture.instance.handleArrowNavigation(keyEvent('ArrowRight'), { row: 0, col: 1 });

    expect(fixture.store.caretCalls).toEqual([{ id: 'after', position: 'start' }]);

    placeCaret(editableIn(fixture.grid, 0, 0, 0), 0);
    fixture.instance.handleArrowNavigation(keyEvent('ArrowLeft'), { row: 0, col: 0 });

    expect(fixture.store.caretCalls).toHaveLength(1);
  });

  it('ignores keys that are not the four arrows', () => {
    const fixture = setup({ rows: 2, cols: 2 });

    fillGridWithEditables(fixture.grid, 2, 2);
    placeCaret(editableIn(fixture.grid, 0, 0, 1), 0);

    const event = keyEvent('Home');

    fixture.instance.handleArrowNavigation(event, { row: 0, col: 0 });

    expect(event.defaultPrevented).toBe(false);
  });

  it('falls back to the focused editable when the selection is gone', () => {
    const fixture = setup({ rows: 2, cols: 1 });

    fillGridWithEditables(fixture.grid, 2, 1);

    const first = editableIn(fixture.grid, 0, 0, 0);

    first.setAttribute('tabindex', '0');
    first.focus();
    window.getSelection()?.removeAllRanges();

    const event = keyEvent('ArrowDown');

    fixture.instance.handleArrowNavigation(event, { row: 0, col: 0 });

    expect(event.defaultPrevented).toBe(false);
  });

  it('navigates on position alone when no caret can be resolved inside the grid', () => {
    const fixture = setup({ rows: 2, cols: 1 });

    fillGridWithEditables(fixture.grid, 2, 1);

    const outside = document.createElement('div');

    outside.setAttribute('contenteditable', 'true');
    outside.textContent = 'elsewhere';
    document.body.appendChild(outside);
    placeCaret(outside, 0);

    const event = keyEvent('ArrowDown');

    fixture.instance.handleArrowNavigation(event, { row: 0, col: 0 });

    expect(event.defaultPrevented).toBe(true);
    expect(editableIn(fixture.grid, 1, 0, 0)).toHaveFocus();
  });

  it('treats a caret outside any cell blocks container as unknowable and navigates', () => {
    const fixture = setup({ rows: 2, cols: 1 });

    fillGridWithEditables(fixture.grid, 2, 1);

    const loose = document.createElement('div');

    loose.setAttribute('contenteditable', 'true');
    loose.textContent = 'loose';
    fixture.grid.element.appendChild(loose);
    placeCaret(loose, 0);

    const event = keyEvent('ArrowDown');

    fixture.instance.handleArrowNavigation(event, { row: 0, col: 0 });

    expect(event.defaultPrevented).toBe(true);
  });

  it('does nothing when the target cell has no editable content', () => {
    const fixture = setup({ rows: 2, cols: 1 });

    mountEditable(fixture.grid.container(0, 0), 'only', 'text');
    placeCaret(editableIn(fixture.grid, 0, 0, 0), 0);

    const event = keyEvent('ArrowDown');

    fixture.instance.handleArrowNavigation(event, { row: 0, col: 0 });

    expect(event.defaultPrevented).toBe(true);
    expect(fixture.store.caretCalls).toEqual([]);
  });
});

describe('TableCellBlocks — Tab navigation and leaving the table', () => {
  it('walks Tab in reading order and wraps onto the next row', () => {
    const fixture = setup({ rows: 2, cols: 2 });

    fillGridWithEditables(fixture.grid, 2, 2);

    const event = keyEvent('Tab');

    fixture.instance.handleKeyDown(event, { row: 0, col: 1 });

    expect(event.defaultPrevented).toBe(true);
    expect(editableIn(fixture.grid, 1, 0, 0)).toHaveFocus();
  });

  it('walks Shift+Tab backward and wraps onto the previous row LAST cell', () => {
    const fixture = setup({ rows: 2, cols: 2 });

    fillGridWithEditables(fixture.grid, 2, 2);

    const event = keyEvent('Tab', { shiftKey: true });

    fixture.instance.handleKeyDown(event, { row: 1, col: 0 });

    expect(event.defaultPrevented).toBe(true);
    expect(editableIn(fixture.grid, 0, 1, 1)).toHaveFocus();
  });

  it('ignores keys other than Tab', () => {
    const fixture = setup({ rows: 2, cols: 2 });

    fillGridWithEditables(fixture.grid, 2, 2);

    const event = keyEvent('Enter');

    fixture.instance.handleKeyDown(event, { row: 0, col: 0 });

    expect(event.defaultPrevented).toBe(false);
  });

  it('Tab out of the last cell lands on the table NEXT SIBLING, skipping nested blocks', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('nested-child', 'paragraph', {}, 'someone-else');
    fixture.store.add('sibling');
    fillGridWithEditables(fixture.grid, 1, 1);
    fixture.instance.handleKeyDown(keyEvent('Tab'), { row: 0, col: 0 });

    expect(fixture.store.caretCalls).toEqual([{ id: 'sibling', position: 'start' }]);
  });

  it('Tab out of the last cell of the last block creates a sibling after the table', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fillGridWithEditables(fixture.grid, 1, 1);
    fixture.instance.handleKeyDown(keyEvent('Tab'), { row: 0, col: 0 });

    expect(fixture.store.insertCalls).toHaveLength(1);
    expect(fixture.store.insertCalls[0]).toMatchObject({ tool: undefined, index: 1, needToFocus: true });
    expect(fixture.store.caretCalls).toHaveLength(1);
    expect(fixture.store.caretCalls[0].position).toBe('start');
  });

  it('pulls a new exit block back out of the grid when it landed inside a cell', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fillGridWithEditables(fixture.grid, 1, 1);
    fixture.store.placeInsertedHolder = holder => fixture.grid.container(0, 0).appendChild(holder);
    fixture.instance.handleKeyDown(keyEvent('Tab'), { row: 0, col: 0 });

    const created = fixture.store.blocks[fixture.store.blocks.length - 1];

    expect(created.holder.parentElement).toBe(fixture.grid.tableHolder.parentElement);
    expect(fixture.grid.tableHolder.nextElementSibling).toBe(created.holder);
  });

  it('a parented table creates its exit block inside the same parent', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.byId('table-1').parentId = 'column-1';
    fillGridWithEditables(fixture.grid, 1, 1);
    fixture.instance.handleKeyDown(keyEvent('Tab'), { row: 0, col: 0 });

    const created = fixture.store.blocks[fixture.store.blocks.length - 1];

    expect(created.parentId).toBe('column-1');
  });

  it('a parented table exits onto its NEXT SIBLING inside the parent', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.byId('table-1').parentId = 'column-1';
    fixture.store.add('root-neighbour');
    fixture.store.add('column-neighbour', 'paragraph', {}, 'column-1');
    fillGridWithEditables(fixture.grid, 1, 1);
    fixture.instance.handleKeyDown(keyEvent('Tab'), { row: 0, col: 0 });

    expect(fixture.store.caretCalls).toEqual([{ id: 'column-neighbour', position: 'start' }]);
  });

  it('Shift+Tab out of the first cell lands on the previous sibling end, or nowhere', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fillGridWithEditables(fixture.grid, 1, 1);
    fixture.instance.handleKeyDown(keyEvent('Tab', { shiftKey: true }), { row: 0, col: 0 });

    expect(fixture.store.caretCalls).toEqual([]);

    const before = fixture.store.add('before');

    fixture.store.blocks.splice(fixture.store.blocks.indexOf(before), 1);
    fixture.store.blocks.unshift(before);
    fixture.instance.handleKeyDown(keyEvent('Tab', { shiftKey: true }), { row: 0, col: 0 });

    expect(fixture.store.caretCalls).toEqual([{ id: 'before', position: 'end' }]);
  });

  it('does nothing when the table block is no longer in the document', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fillGridWithEditables(fixture.grid, 1, 1);
    fixture.store.blocks.length = 0;
    fixture.instance.handleKeyDown(keyEvent('Tab'), { row: 0, col: 0 });

    expect(fixture.store.caretCalls).toEqual([]);
    expect(fixture.store.insertCalls).toEqual([]);
  });

  it('counts columns from the rendered cells when there is no colgroup', () => {
    const fixture = setup({ rows: 1, cols: 2 });

    fixture.grid.element.querySelector('colgroup')?.remove();
    fillGridWithEditables(fixture.grid, 1, 2);
    fixture.instance.handleKeyDown(keyEvent('Tab'), { row: 0, col: 0 });

    expect(editableIn(fixture.grid, 0, 1, 0)).toHaveFocus();
  });
});

const flushMicrotasks = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

describe('TableCellBlocks — routing block lifecycle events into cells', () => {
  it('sends a replacement block back to the cell the removed block came from', async () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const handler = fixture.store.eventHandler();

    fixture.store.add('a');
    fixture.store.add('old');
    mountStoredBlock(fixture, 0, 0, 'a');
    mountStoredBlock(fixture, 0, 0, 'old');

    handler(blockRemovedEvent('old', fixture.store.byId('old').holder, 2));
    fixture.store.byId('old').holder.remove();
    fixture.store.blocks.splice(2, 1);

    const created = fixture.store.add('new');

    document.body.appendChild(created.holder);
    handler(blockAddedEvent('new', created.holder, 2));

    expect(holderIds(fixture.grid.container(0, 0))).toEqual(['a', 'new']);
    expect(fixture.model.getCellBlocks(0, 0)).toEqual(['a', 'new']);

    await flushMicrotasks();

    expect(fixture.store.insertCalls).toEqual([]);
  });

  it('claims a replacement when the table block alone precedes it and nothing follows', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const handler = fixture.store.eventHandler();

    fixture.store.add('old');
    mountStoredBlock(fixture, 0, 0, 'old');
    handler(blockRemovedEvent('old', fixture.store.byId('old').holder, 1));
    fixture.store.byId('old').holder.remove();
    fixture.store.blocks.splice(1, 1);

    const created = fixture.store.add('new');

    document.body.appendChild(created.holder);
    handler(blockAddedEvent('new', created.holder, 1));

    expect(holderIds(fixture.grid.container(0, 0))).toEqual(['new']);
  });

  it('refuses the replacement when the block after it belongs to a different table', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const handler = fixture.store.eventHandler();

    fixture.store.add('old');
    mountStoredBlock(fixture, 0, 0, 'old');
    handler(blockRemovedEvent('old', fixture.store.byId('old').holder, 1));
    fixture.store.byId('old').holder.remove();
    fixture.store.blocks.splice(1, 1);

    const created = fixture.store.add('new');

    document.body.appendChild(created.holder);
    fixture.store.add('foreign');
    handler(blockAddedEvent('new', created.holder, 1));

    expect(holderIds(fixture.grid.container(0, 0))).toEqual([]);
  });

  it('refuses the replacement when no adjacent block belongs to this table', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const handler = fixture.store.eventHandler();

    fixture.store.add('old');
    mountStoredBlock(fixture, 0, 0, 'old');
    handler(blockRemovedEvent('old', fixture.store.byId('old').holder, 1));
    fixture.store.byId('old').holder.remove();
    fixture.store.blocks.splice(1, 1);

    fixture.store.add('stranger');

    const created = fixture.store.add('new');

    document.body.appendChild(created.holder);
    handler(blockAddedEvent('new', created.holder, 2));

    expect(holderIds(fixture.grid.container(0, 0))).toEqual([]);
  });

  it('falls back to the model when the removed holder was already detached', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const handler = fixture.store.eventHandler();

    fixture.store.add('gone');
    mountStoredBlock(fixture, 0, 0, 'gone');
    fixture.store.byId('gone').holder.remove();
    handler(blockRemovedEvent('gone', fixture.store.byId('gone').holder, 1));
    fixture.store.blocks.splice(1, 1);

    const created = fixture.store.add('typed');

    document.body.appendChild(created.holder);
    handler(blockAddedEvent('typed', created.holder, 1));

    expect(holderIds(fixture.grid.container(0, 0))).toEqual(['typed']);
  });

  it('reattaches a Yjs-restored block to the cell the model still records', () => {
    const fixture = setup({ rows: 2, cols: 2 });
    const handler = fixture.store.eventHandler();
    const restored = fixture.store.add('restored', 'paragraph', {}, 'table-1');

    fixture.model.addBlockToCell(1, 1, 'restored');
    document.body.appendChild(restored.holder);
    handler(blockAddedEvent('restored', restored.holder, 1));

    expect(restored.holder.parentElement).toBe(fixture.grid.container(1, 1));
  });

  it('never claims the table block itself', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.eventHandler()(blockAddedEvent('table-1', fixture.grid.tableHolder, 0));

    expect(holderIds(fixture.grid.container(0, 0))).toEqual([]);
  });

  it('ignores payloads that are not block mutation events', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const handler = fixture.store.eventHandler();

    expect(() => {
      handler(null);
      handler('block-added');
      handler({});
      handler({ event: null });
    }).not.toThrow();
    expect(holderIds(fixture.grid.container(0, 0))).toEqual([]);
  });

  it('ignores a block-added event with no index', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const loose = fixture.store.add('loose');

    document.body.appendChild(loose.holder);
    fixture.store.eventHandler()(blockAddedEvent('loose', loose.holder));

    expect(loose.holder.parentElement).toBe(document.body);
  });

  it('tracks a holder that insertToDOM already placed inside a cell', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const created = fixture.store.add('typed');

    fixture.grid.container(0, 0).appendChild(created.holder);

    const editable = document.createElement('div');

    editable.setAttribute('data-blok-placeholder-active', 'true');
    created.holder.appendChild(editable);
    fixture.store.eventHandler()(blockAddedEvent('typed', created.holder, 1));

    expect(fixture.model.getCellBlocks(0, 0)).toEqual(['typed']);
    expect(created.parentId).toBe('table-1');
    expect(editable.hasAttribute('data-blok-placeholder-active')).toBe(false);
  });

  it('does not steal parentage from a block another container already owns', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const created = fixture.store.add('typed', 'paragraph', {}, 'other-owner');

    fixture.grid.container(0, 0).appendChild(created.holder);
    fixture.store.eventHandler()(blockAddedEvent('typed', created.holder, 1));

    expect(fixture.model.getCellBlocks(0, 0)).toEqual(['typed']);
    expect(created.parentId).toBe('other-owner');
  });

  it('leaves a block created outside the table alone', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('anchor');
    mountStoredBlock(fixture, 0, 0, 'anchor');

    const outside = fixture.store.add('outside');

    document.body.appendChild(outside.holder);
    fixture.store.currentBlockIndex = -1;
    fixture.store.eventHandler()(blockAddedEvent('outside', outside.holder, 2));

    expect(outside.holder.parentElement).toBe(document.body);
  });

  it('claims the Enter-at-start block anchored after the whole table wrapper', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const created = fixture.store.add('above');

    fixture.store.add('cell-block');
    mountStoredBlock(fixture, 0, 0, 'cell-block');
    fixture.store.blocks.splice(fixture.store.blocks.indexOf(created), 1);
    fixture.store.blocks.splice(1, 0, created);
    document.body.appendChild(created.holder);
    fixture.store.currentBlockIndex = 2;
    fixture.store.eventHandler()(blockAddedEvent('above', created.holder, 1));

    expect(holderIds(fixture.grid.container(0, 0))).toEqual(['above', 'cell-block']);
    expect(fixture.model.getCellBlocks(0, 0)).toEqual(['above', 'cell-block']);
  });

  it('leaves a block inserted below the table outside the cell', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const created = fixture.store.add('below');

    fixture.store.add('other');
    fixture.store.add('cell-block');
    mountStoredBlock(fixture, 0, 0, 'cell-block');
    fixture.store.blocks.splice(fixture.store.blocks.indexOf(created), 1);
    fixture.store.blocks.splice(1, 0, created);
    document.body.appendChild(created.holder);
    fixture.store.currentBlockIndex = 3;
    fixture.store.eventHandler()(blockAddedEvent('below', created.holder, 1));

    expect(created.holder.parentElement).toBe(document.body);
  });

  it('claims a holder that landed inside the grid but outside any cell container', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('anchor');
    mountStoredBlock(fixture, 0, 0, 'anchor');

    const created = fixture.store.add('loose');

    fixture.grid.element.appendChild(created.holder);
    fixture.store.eventHandler()(blockAddedEvent('loose', created.holder, 2));

    expect(created.holder.parentElement).toBe(fixture.grid.container(0, 0));
    expect(fixture.model.getCellBlocks(0, 0)).toEqual(['anchor', 'loose']);
  });

  it('repairs a cell emptied by a removal, once the microtask runs', async () => {
    const dropped = vi.fn();
    const fixture = setup({ rows: 1, cols: 1, onCellReferenceDropped: dropped });

    fixture.store.add('only');
    mountStoredBlock(fixture, 0, 0, 'only');
    fixture.store.eventHandler()(blockRemovedEvent('only', fixture.store.byId('only').holder, 1));
    fixture.store.byId('only').holder.remove();

    expect(fixture.model.getCellBlocks(0, 0)).toEqual([]);
    expect(dropped).toHaveBeenCalledTimes(1);
    expect(fixture.store.insertCalls).toEqual([]);

    await flushMicrotasks();

    expect(fixture.store.insertCalls).toHaveLength(1);
    expect(fixture.model.getCellBlocks(0, 0)).toHaveLength(1);
  });

  it('does not repair a cell while Yjs is replaying', async () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('only');
    mountStoredBlock(fixture, 0, 0, 'only');
    fixture.store.eventHandler()(blockRemovedEvent('only', fixture.store.byId('only').holder, 1));
    fixture.store.byId('only').holder.remove();
    fixture.store.isSyncingFromYjs = true;

    await flushMicrotasks();

    expect(fixture.store.insertCalls).toEqual([]);
  });

  it('says nothing about a removed block no cell referenced', async () => {
    const dropped = vi.fn();
    const fixture = setup({ rows: 1, cols: 1, onCellReferenceDropped: dropped });

    fixture.store.add('kept');
    mountStoredBlock(fixture, 0, 0, 'kept');

    const stranger = fixture.store.add('stranger');

    document.body.appendChild(stranger.holder);
    fixture.store.eventHandler()(blockRemovedEvent('stranger', stranger.holder, 2));

    await flushMicrotasks();

    expect(dropped).not.toHaveBeenCalled();
    expect(fixture.model.getCellBlocks(0, 0)).toEqual(['kept']);
    expect(fixture.store.insertCalls).toEqual([]);
  });

  it('re-homes a block moved between cells of the same table', () => {
    const fixture = setup({ rows: 1, cols: 2 });

    fixture.store.add('mover');
    mountStoredBlock(fixture, 0, 0, 'mover');
    fixture.grid.container(0, 1).appendChild(fixture.store.byId('mover').holder);
    fixture.store.eventHandler()(blockMovedEvent('mover', fixture.store.byId('mover').holder));

    expect(fixture.model.getCellBlocks(0, 0)).toEqual([]);
    expect(fixture.model.getCellBlocks(0, 1)).toEqual(['mover']);
  });

  it('drops the reference when a block is moved out of the table', () => {
    const dropped = vi.fn();
    const fixture = setup({ rows: 1, cols: 1, onCellReferenceDropped: dropped });

    fixture.store.add('leaver');
    mountStoredBlock(fixture, 0, 0, 'leaver');
    document.body.appendChild(fixture.store.byId('leaver').holder);
    fixture.store.eventHandler()(blockMovedEvent('leaver', fixture.store.byId('leaver').holder));

    expect(fixture.model.getCellBlocks(0, 0)).toEqual([]);
    expect(dropped).toHaveBeenCalledTimes(1);
  });

  it('ignores a move of a block this table never tracked', () => {
    const dropped = vi.fn();
    const fixture = setup({ rows: 1, cols: 1, onCellReferenceDropped: dropped });
    const stranger = fixture.store.add('stranger');

    document.body.appendChild(stranger.holder);
    fixture.store.eventHandler()(blockMovedEvent('stranger', stranger.holder));

    expect(dropped).not.toHaveBeenCalled();
  });

  it('defers events during a structural operation and replays them on flush', () => {
    let locked = true;
    const fixture = setup({ rows: 1, cols: 1, isStructuralOpActive: () => locked });

    fixture.store.add('anchor');
    mountStoredBlock(fixture, 0, 0, 'anchor');

    const created = fixture.store.add('deferred');

    fixture.grid.element.appendChild(created.holder);
    fixture.store.eventHandler()(blockAddedEvent('deferred', created.holder, 2));

    expect(created.holder.parentElement).toBe(fixture.grid.element);

    locked = false;
    fixture.instance.flushDeferredEvents();

    expect(created.holder.parentElement).toBe(fixture.grid.container(0, 0));
  });

  it('drops deferred events when the grid is rebuilt instead', () => {
    let locked = true;
    const fixture = setup({ rows: 1, cols: 1, isStructuralOpActive: () => locked });

    fixture.store.add('anchor');
    mountStoredBlock(fixture, 0, 0, 'anchor');

    const created = fixture.store.add('deferred');

    fixture.grid.element.appendChild(created.holder);
    fixture.store.eventHandler()(blockAddedEvent('deferred', created.holder, 2));
    fixture.instance.discardDeferredEvents();
    locked = false;
    fixture.instance.flushDeferredEvents();

    expect(created.holder.parentElement).toBe(fixture.grid.element);
  });

  it('processes a Yjs replay event even while a structural operation is running', () => {
    const fixture = setup({ rows: 1, cols: 1, isStructuralOpActive: () => true });
    const restored = fixture.store.add('restored', 'paragraph', {}, 'table-1');

    fixture.model.addBlockToCell(0, 0, 'restored');
    document.body.appendChild(restored.holder);
    fixture.store.isSyncingFromYjs = true;
    fixture.store.eventHandler()(blockAddedEvent('restored', restored.holder, 1));

    expect(restored.holder.parentElement).toBe(fixture.grid.container(0, 0));
  });
});

describe('TableCellBlocks — blank space clicks, deletion and teardown', () => {
  const click = (target: HTMLElement): void => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  };

  it('puts the caret at the END of the LAST block when a cell blank space is clicked', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    mountEditable(fixture.grid.container(0, 0), 'top', 'one');
    mountEditable(fixture.grid.container(0, 0), 'bottom', 'two');
    click(fixture.grid.cell(0, 0));

    expect(fixture.store.caretCalls).toEqual([{ id: 'bottom', position: 'end' }]);
  });

  it('accepts a click on the blocks container itself', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    mountEditable(fixture.grid.container(0, 0), 'only', 'one');
    click(fixture.grid.container(0, 0));

    expect(fixture.store.caretCalls).toEqual([{ id: 'only', position: 'end' }]);
  });

  it('ignores a click that landed on block content', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const editable = mountEditable(fixture.grid.container(0, 0), 'only', 'one');

    click(editable);

    expect(fixture.store.caretCalls).toEqual([]);
  });

  it('ignores a click on an empty cell', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    click(fixture.grid.cell(0, 0));

    expect(fixture.store.caretCalls).toEqual([]);
  });

  it('does not steal the caret while blocks in the grid are selected', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    mountEditable(fixture.grid.container(0, 0), 'only', 'one');
    fixture.grid.container(0, 0).setAttribute(DATA_ATTR.selected, 'true');
    click(fixture.grid.cell(0, 0));

    expect(fixture.store.caretCalls).toEqual([]);
  });

  it('does not steal the caret while a text selection spans two blocks of the cell', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const first = mountEditable(fixture.grid.container(0, 0), 'top', 'one');
    const second = mountEditable(fixture.grid.container(0, 0), 'bottom', 'two');
    const range = document.createRange();

    range.setStart(first.firstChild ?? first, 0);
    range.setEnd(second.firstChild ?? second, 1);

    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
    click(fixture.grid.cell(0, 0));

    expect(fixture.store.caretCalls).toEqual([]);
  });

  it('collects every cell block id in document order', () => {
    const fixture = setup({ rows: 1, cols: 2 });

    mountEditable(fixture.grid.container(0, 0), 'a', 'a');
    mountEditable(fixture.grid.container(0, 0), 'b', 'b');
    mountEditable(fixture.grid.container(0, 1), 'c', 'c');

    expect(fixture.instance.getBlockIdsFromCells(fixture.grid.element.querySelectorAll(`[${CELL_ATTR}]`)))
      .toEqual(['a', 'b', 'c']);
  });

  it('skips a cell whose blocks container is gone when collecting ids', () => {
    const fixture = setup({ rows: 1, cols: 2 });

    mountEditable(fixture.grid.container(0, 0), 'a', 'a');
    fixture.grid.container(0, 1).remove();

    expect(fixture.instance.getBlockIdsFromCells([fixture.grid.cell(0, 0), fixture.grid.cell(0, 1)]))
      .toEqual(['a']);
  });

  it('deletes cell blocks from the highest flat index down', async () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('a');
    fixture.store.add('b');
    fixture.store.add('c');
    fixture.instance.deleteBlocks(['a', 'unknown', 'c', 'b']);

    expect(fixture.store.deleteCalls).toEqual([3, 2, 1]);

    await flushMicrotasks();
  });

  it('restores the scroll position the async deletes moved', async () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    let scrollY = 120;

    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY);

    fixture.store.add('a');
    fixture.instance.deleteBlocks(['a']);
    scrollY = 0;

    await flushMicrotasks();

    expect(scrollTo).toHaveBeenCalledWith(0, 120);
  });

  it('leaves the scroll position alone when nothing moved it', async () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);

    fixture.store.add('a');
    fixture.instance.deleteBlocks(['a']);

    await flushMicrotasks();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('deletes every block the grid holds when the table itself goes', async () => {
    const fixture = setup({ rows: 1, cols: 2 });

    fixture.store.add('a');
    fixture.store.add('b');
    fixture.grid.container(0, 0).appendChild(fixture.store.byId('a').holder);
    fixture.grid.container(0, 1).appendChild(fixture.store.byId('b').holder);
    fixture.instance.deleteAllBlocks();

    expect(fixture.store.deleteCalls).toEqual([2, 1]);

    await flushMicrotasks();
  });

  it('stops answering clicks and block events after destroy', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const handler = fixture.store.eventHandler();

    mountEditable(fixture.grid.container(0, 0), 'only', 'one');
    fixture.instance.setActiveCellWithBlocks({ row: 0, col: 0 });
    fixture.instance.destroy();
    click(fixture.grid.cell(0, 0));

    expect(fixture.store.caretCalls).toEqual([]);
    expect(fixture.instance.activeCellWithBlocks).toBeNull();
    expect(() => handler(blockAddedEvent('x', document.createElement('div'), 1))).not.toThrow();
  });

  it('remembers and clears the active cell', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.instance.setActiveCellWithBlocks({ row: 1, col: 2 });
    expect(fixture.instance.activeCellWithBlocks).toStrictEqual({ row: 1, col: 2 });

    fixture.instance.clearActiveCellWithBlocks();
    expect(fixture.instance.activeCellWithBlocks).toBeNull();
  });
});

describe('TableCellBlocks — caret resolution and grid-edge arithmetic', () => {
  it('stops the arrow event reaching the block-level handler that would leave the table', () => {
    const fixture = setup({ rows: 2, cols: 1 });

    fillGridWithEditables(fixture.grid, 2, 1);
    placeCaret(editableIn(fixture.grid, 0, 0, 1), 0);

    const event = keyEvent('ArrowDown');
    const stopPropagation = vi.spyOn(event, 'stopPropagation');

    fixture.instance.handleArrowNavigation(event, { row: 0, col: 0 });

    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('resolves the caret from an ELEMENT-anchored selection', () => {
    const fixture = setup({ rows: 2, cols: 1 });

    fillGridWithEditables(fixture.grid, 2, 1);

    const first = editableIn(fixture.grid, 0, 0, 0);
    const range = document.createRange();

    range.setStart(first, 0);
    range.collapse(true);

    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);

    const event = keyEvent('ArrowDown');

    fixture.instance.handleArrowNavigation(event, { row: 0, col: 0 });

    expect(event.defaultPrevented).toBe(false);
  });

  it('refuses a caret that lives outside this grid and navigates on position alone', () => {
    const fixture = setup({ rows: 1, cols: 2 });

    fillGridWithEditables(fixture.grid, 1, 2);

    const outside = document.createElement('div');

    outside.setAttribute('contenteditable', 'true');
    outside.textContent = 'elsewhere';
    document.body.appendChild(outside);
    placeCaret(outside, 1);

    const event = keyEvent('ArrowRight');

    fixture.instance.handleArrowNavigation(event, { row: 0, col: 0 });

    expect(event.defaultPrevented).toBe(true);
    expect(editableIn(fixture.grid, 0, 1, 0)).toHaveFocus();
  });

  it('refuses a FOCUSED element that lives outside this grid', () => {
    const fixture = setup({ rows: 1, cols: 2 });

    fillGridWithEditables(fixture.grid, 1, 2);

    const outside = document.createElement('div');

    outside.setAttribute('contenteditable', 'true');
    outside.setAttribute('tabindex', '0');
    outside.textContent = 'elsewhere';
    document.body.appendChild(outside);
    outside.focus();
    window.getSelection()?.removeAllRanges();

    const event = keyEvent('ArrowRight');

    fixture.instance.handleArrowNavigation(event, { row: 0, col: 0 });

    expect(event.defaultPrevented).toBe(true);
  });

  it('skips a merge-covered column when Tab walks reading order', () => {
    const content: CellContent[][] = [
      [{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }, { blocks: [] }],
    ];
    const fixture = setup({ rows: 1, cols: 3, content });

    fillGridWithEditables(fixture.grid, 1, 3);
    fixture.instance.handleKeyDown(keyEvent('Tab'), { row: 0, col: 0 });

    expect(editableIn(fixture.grid, 0, 2, 0)).toHaveFocus();
  });
});

describe('TableCellBlocks — leaving the table around root and parent ids', () => {
  it('treats an EMPTY-STRING parentId as root on both the sibling walk and the insert', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.byId('table-1').parentId = '';
    fixture.store.add('root-sibling', 'paragraph', {}, '');
    fillGridWithEditables(fixture.grid, 1, 1);
    fixture.instance.handleKeyDown(keyEvent('Tab'), { row: 0, col: 0 });

    expect(fixture.store.caretCalls).toEqual([{ id: 'root-sibling', position: 'start' }]);
  });

  it('creates the exit block at root when the table parentId is an empty string', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.byId('table-1').parentId = '';
    fillGridWithEditables(fixture.grid, 1, 1);
    fixture.instance.handleKeyDown(keyEvent('Tab'), { row: 0, col: 0 });

    const created = fixture.store.blocks[fixture.store.blocks.length - 1];

    expect(created.parentId).toBeNull();
    expect(fixture.store.insertCalls[0]).toMatchObject({ index: 1 });
  });

  it('places the exit block right after the table wherever the table sits in the flat list', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const before = fixture.store.add('before');

    fixture.store.blocks.splice(fixture.store.blocks.indexOf(before), 1);
    fixture.store.blocks.unshift(before);
    fillGridWithEditables(fixture.grid, 1, 1);
    fixture.instance.handleKeyDown(keyEvent('Tab'), { row: 0, col: 0 });

    expect(fixture.store.insertCalls[0]).toMatchObject({ index: 2 });
  });

  it('leaves an exit block that never landed in the grid where the editor put it', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fillGridWithEditables(fixture.grid, 1, 1);
    fixture.instance.handleKeyDown(keyEvent('Tab'), { row: 0, col: 0 });

    const created = fixture.store.blocks[fixture.store.blocks.length - 1];

    expect(created.holder.parentElement).toBeNull();
  });

  it('does not record the exit block as cell content', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('cell-block');
    mountStoredBlock(fixture, 0, 0, 'cell-block');
    fixture.store.emitInsertEvents = true;
    fixture.store.placeInsertedHolder = holder => fixture.grid.container(0, 0).appendChild(holder);
    fixture.instance.handleKeyDown(keyEvent('Tab'), { row: 0, col: 0 });

    expect(fixture.model.getCellBlocks(0, 0)).toEqual(['cell-block']);
  });

  it('resumes claiming blocks once the table exit has finished', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('cell-block');
    mountStoredBlock(fixture, 0, 0, 'cell-block');
    fixture.store.emitInsertEvents = true;
    fixture.instance.handleKeyDown(keyEvent('Tab'), { row: 0, col: 0 });

    const later = fixture.store.add('later');

    fixture.grid.element.appendChild(later.holder);
    fixture.store.eventHandler()(blockAddedEvent('later', later.holder, fixture.store.blocks.length - 1));

    expect(later.holder.parentElement).toBe(fixture.grid.container(0, 0));
  });
});

/** Rewrites the flat block order; ids the store does not know are created empty. */
const orderBlocks = (store: Store, ids: string[]): void => {
  const { blocks } = store;
  const ordered = ids.map(id => blocks.find(block => block.id === id) ?? store.add(id));

  blocks.length = 0;
  blocks.push(...ordered);
};

describe('TableCellBlocks — repair, removal bookkeeping and ownership edges', () => {
  it('strips the cell placeholder while repairing and does not re-claim its own repair block', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const ghost = document.createElement('div');

    ghost.setAttribute('data-blok-placeholder-active', 'true');
    fixture.grid.container(0, 0).appendChild(ghost);
    fixture.store.emitInsertEvents = true;
    fixture.store.placeInsertedHolder = holder => fixture.grid.container(0, 0).appendChild(holder);
    fixture.instance.ensureCellHasBlock(fixture.grid.cell(0, 0));

    expect(ghost.hasAttribute('data-blok-placeholder-active')).toBe(false);
    expect(fixture.model.getCellBlocks(0, 0)).toHaveLength(1);
    expect(fixture.store.insertCalls).toHaveLength(1);
  });

  it('claims blocks again after a repair has finished', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.emitInsertEvents = true;
    fixture.instance.ensureCellHasBlock(fixture.grid.cell(0, 0));

    const later = fixture.store.add('later');

    fixture.grid.element.appendChild(later.holder);
    fixture.store.eventHandler()(blockAddedEvent('later', later.holder, fixture.store.blocks.length - 1));

    expect(later.holder.parentElement).toBe(fixture.grid.container(0, 0));
  });

  it('does nothing when the cleared cell lost its blocks container', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.grid.container(0, 0).remove();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);

      return 1;
    });

    expect(() => fixture.instance.focusClearedCell(fixture.grid.cell(0, 0))).not.toThrow();
    expect(fixture.store.caretCalls).toEqual([]);
  });

  it('matches a replacement to the removal that shares its flat index', () => {
    const fixture = setup({ rows: 1, cols: 2 });
    const handler = fixture.store.eventHandler();

    fixture.store.add('left');
    fixture.store.add('right');
    fixture.store.add('gone-left');
    fixture.store.add('gone-right');
    mountStoredBlock(fixture, 0, 0, 'left');
    mountStoredBlock(fixture, 0, 1, 'right');
    mountStoredBlock(fixture, 0, 0, 'gone-left');
    mountStoredBlock(fixture, 0, 1, 'gone-right');

    handler(blockRemovedEvent('gone-left', fixture.store.byId('gone-left').holder, 3));
    handler(blockRemovedEvent('gone-right', fixture.store.byId('gone-right').holder, 4));
    fixture.store.byId('gone-left').holder.remove();
    fixture.store.byId('gone-right').holder.remove();

    const created = fixture.store.add('replacement');

    document.body.appendChild(created.holder);
    // Flat order the editor is left with: the replacement lands at 4, right
    // next to the still-owned 'right' block.
    orderBlocks(fixture.store, ['table-1', 'left', 'filler', 'right', 'replacement']);
    handler(blockAddedEvent('replacement', created.holder, 4));

    expect(holderIds(fixture.grid.container(0, 1))).toEqual(['right', 'replacement']);
    expect(holderIds(fixture.grid.container(0, 0))).toEqual(['left']);
  });

  it('consumes a removal record so a second insert at the same index is not claimed', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const handler = fixture.store.eventHandler();

    fixture.store.add('a');
    fixture.store.add('old');
    mountStoredBlock(fixture, 0, 0, 'a');
    mountStoredBlock(fixture, 0, 0, 'old');
    handler(blockRemovedEvent('old', fixture.store.byId('old').holder, 2));
    fixture.store.byId('old').holder.remove();
    fixture.store.blocks.splice(2, 1);

    const first = fixture.store.add('first');

    document.body.appendChild(first.holder);
    handler(blockAddedEvent('first', first.holder, 2));

    const second = fixture.store.add('second');

    document.body.appendChild(second.holder);
    fixture.store.currentBlockIndex = -1;
    handler(blockAddedEvent('second', second.holder, 2));

    expect(holderIds(fixture.grid.container(0, 0))).toEqual(['a', 'first']);
    expect(second.holder.parentElement).toBe(document.body);
  });

  it('survives an insert at the index of a removal it could not place', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const handler = fixture.store.eventHandler();
    const stranger = fixture.store.add('stranger');

    document.body.appendChild(stranger.holder);
    handler(blockRemovedEvent('stranger', stranger.holder, 1));
    fixture.store.blocks.splice(1, 1);

    const created = fixture.store.add('new');

    document.body.appendChild(created.holder);

    expect(() => handler(blockAddedEvent('new', created.holder, 1))).not.toThrow();
  });

  it('counts a cell block sitting BEFORE the table as adjacent ownership', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const handler = fixture.store.eventHandler();

    fixture.store.add('anchor');
    fixture.store.add('old');
    mountStoredBlock(fixture, 0, 0, 'anchor');
    mountStoredBlock(fixture, 0, 0, 'old');
    orderBlocks(fixture.store, ['anchor', 'old', 'table-1']);
    handler(blockRemovedEvent('old', fixture.store.byId('old').holder, 1));
    fixture.store.byId('old').holder.remove();

    const created = fixture.store.add('replacement');

    document.body.appendChild(created.holder);
    orderBlocks(fixture.store, ['anchor', 'replacement', 'table-1']);
    handler(blockAddedEvent('replacement', created.holder, 1));

    expect(holderIds(fixture.grid.container(0, 0))).toEqual(['anchor', 'replacement']);
  });
});

describe('TableCellBlocks — navigation targets that are missing or ragged', () => {
  it('forgets the active cell when the caret moves to another one', () => {
    const fixture = setup({ rows: 2, cols: 1 });

    fillGridWithEditables(fixture.grid, 2, 1);
    fixture.instance.setActiveCellWithBlocks({ row: 0, col: 0 });
    placeCaret(editableIn(fixture.grid, 0, 0, 1), 0);
    fixture.instance.handleArrowNavigation(keyEvent('ArrowDown'), { row: 0, col: 0 });

    expect(fixture.instance.activeCellWithBlocks).toBeNull();
  });

  it('survives a target row that renders no cell for that column', () => {
    const fixture = setup({ rows: 2, cols: 1 });

    fillGridWithEditables(fixture.grid, 2, 1);
    fixture.grid.cell(1, 0).remove();
    placeCaret(editableIn(fixture.grid, 0, 0, 1), 0);

    expect(() => fixture.instance.handleArrowNavigation(keyEvent('ArrowDown'), { row: 0, col: 0 })).not.toThrow();
    expect(fixture.store.caretCalls).toEqual([]);
  });

  it('survives a target cell that lost its blocks container', () => {
    const fixture = setup({ rows: 2, cols: 1 });

    fillGridWithEditables(fixture.grid, 2, 1);
    fixture.grid.container(1, 0).remove();
    placeCaret(editableIn(fixture.grid, 0, 0, 1), 0);

    expect(() => fixture.instance.handleArrowNavigation(keyEvent('ArrowDown'), { row: 0, col: 0 })).not.toThrow();
  });

  it('counts columns from the colgroup even when a merge leaves the first row short', () => {
    const content: CellContent[][] = [
      [{ blocks: [], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
      [{ blocks: [] }, { blocks: [] }],
    ];
    const fixture = setup({ rows: 2, cols: 2, content });

    fillGridWithEditables(fixture.grid, 2, 2);
    fixture.grid.cell(0, 1).remove();
    fixture.instance.handleKeyDown(keyEvent('Tab'), { row: 1, col: 0 });

    expect(editableIn(fixture.grid, 1, 1, 0)).toHaveFocus();
  });

  it('treats a caret outside any cell block as the first block when moving up', () => {
    const fixture = setup({ rows: 2, cols: 1 });

    fillGridWithEditables(fixture.grid, 2, 1);

    const loose = document.createElement('div');

    loose.setAttribute('contenteditable', 'true');
    loose.textContent = 'loose';
    fixture.grid.element.appendChild(loose);
    placeCaret(loose, 0);

    const event = keyEvent('ArrowUp');

    fixture.instance.handleArrowNavigation(event, { row: 1, col: 0 });

    expect(event.defaultPrevented).toBe(true);
    expect(editableIn(fixture.grid, 0, 0, 1)).toHaveFocus();
  });

  it('survives a grid with neither colgroup nor rows', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.grid.element.replaceChildren();

    expect(() => fixture.instance.handleKeyDown(keyEvent('Tab'), { row: 0, col: 0 })).not.toThrow();
  });

  it('survives a removal recorded for a row the grid no longer renders', () => {
    const fixture = setup({ rows: 1, cols: 1, content: emptyContent(2, 1) });
    const stray = fixture.store.add('stray');

    document.body.appendChild(stray.holder);
    fixture.model.addBlockToCell(1, 0, 'stray');

    expect(() => fixture.store.eventHandler()(blockRemovedEvent('stray', stray.holder, 1))).not.toThrow();
    expect(fixture.model.getCellBlocks(1, 0)).toEqual([]);
  });
});

describe('TableCellBlocks — initializeCells edges and exact insert arguments', () => {
  it('inserts parsed cell content unfocused, at the end of the flat list', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.instance.initializeCells([['<ul><li>one</li></ul>']]);

    expect(fixture.store.insertCalls[0]).toStrictEqual({
      tool: 'list',
      data: { text: 'one', style: 'unordered', checked: false, depth: 0 },
      index: 1,
      needToFocus: false,
      replace: undefined,
      id: undefined,
      tunes: undefined,
    });
  });

  it('keeps colspan above one and drops a rowspan of one', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('kept', 'paragraph', {}, 'table-1');

    const result = fixture.instance.initializeCells([[{ blocks: ['kept'], colspan: 2, rowspan: 1 }]]);

    expect(result[0][0]).toStrictEqual({ blocks: ['kept'], colspan: 2 });
  });

  it('falls back to the text channel when the clipboard payload carries no blocks', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.instance.initializeCells([[{ blocks: [], blockData: [], text: 'typed' }]]);

    expect(fixture.store.insertCalls.map(call => call.data?.text)).toEqual(['typed']);
  });

  it('ignores a content column the grid does not render', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    const result = fixture.instance.initializeCells([[{ blocks: [] }, { blocks: [] }]]);

    expect(result[0]).toHaveLength(1);
  });

  it('ignores a rendered cell whose blocks container was removed', () => {
    const fixture = setup({ rows: 1, cols: 2 });

    fixture.grid.container(0, 0).remove();

    const result = fixture.instance.initializeCells([[{ blocks: [] }, { blocks: [] }]]);

    expect(result[0]).toHaveLength(1);
    expect(result[0][0].blocks).toHaveLength(1);
  });

  it('fills the hole a container-less column leaves so the saved row stays dense', () => {
    const fixture = setup({ rows: 1, cols: 3, content: [[{ blocks: [] }]] });

    fixture.grid.container(0, 1).remove();

    const result = fixture.instance.initializeCells([[{ blocks: [] }]]);

    expect(result[0]).toHaveLength(3);
    expect(result[0][1]).toStrictEqual({ blocks: [] });
    expect(result[0][2].blocks).toHaveLength(1);
  });

  it('creates the completeness paragraph unfocused, parented and placeholder-free', () => {
    const fixture = setup({ rows: 1, cols: 2, content: [[{ blocks: [] }]] });
    const ghost = document.createElement('div');

    ghost.setAttribute('data-placeholder', 'Type');
    fixture.grid.container(0, 1).appendChild(ghost);

    const result = fixture.instance.initializeCells([[{ blocks: [] }]]);
    const created = fixture.store.byId(result[0][1].blocks[0]);

    expect(fixture.store.insertCalls[fixture.store.insertCalls.length - 1]).toStrictEqual({
      tool: 'paragraph',
      data: { text: '' },
      index: fixture.store.blocks.length - 1,
      needToFocus: false,
      replace: undefined,
      id: undefined,
      tunes: undefined,
    });
    expect(created.parentId).toBe('table-1');
    expect(created.holder.parentElement).toBe(fixture.grid.container(0, 1));
    expect(ghost.hasAttribute('data-placeholder')).toBe(false);
  });

  it('leaves a rendered cell with an unreadable column index alone', () => {
    const fixture = setup({ rows: 1, cols: 1, content: [[{ blocks: [] }]] });
    const rogue = document.createElement('div');

    rogue.setAttribute(CELL_ATTR, '');
    rogue.setAttribute(CELL_COL_ATTR, 'not-a-number');

    const rogueContainer = document.createElement('div');

    rogueContainer.setAttribute(CELL_BLOCKS_ATTR, '');
    rogue.appendChild(rogueContainer);
    fixture.grid.cell(0, 0).parentElement?.appendChild(rogue);

    fixture.instance.initializeCells([[{ blocks: [] }]]);

    expect(holderIds(rogueContainer)).toEqual([]);
  });
});

describe('TableCellBlocks — ownership guards and DOM placement details', () => {
  it.each(['getBlockIndex', 'getBlockByIndex'] as const)(
    'reclaims nothing and throws nothing when the host has no %s',
    method => {
      const fixture = setup({ rows: 1, cols: 1 });
      const stray = fixture.store.add('stray', 'paragraph', {}, 'table-1');

      document.body.appendChild(stray.holder);
      fixture.model.addBlockToCell(0, 0, 'stray');
      fixture.store.dropBlocksMethod(method);

      expect(() => fixture.instance.reclaimReferencedBlocks()).not.toThrow();
      expect(stray.holder.parentElement).toBe(document.body);
    }
  );

  it('treats an empty-string parentId as unowned and mounts the block', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const loose = fixture.store.add('loose', 'paragraph', {}, '');

    document.body.appendChild(loose.holder);

    const result = fixture.instance.initializeCells([[{ blocks: ['loose'] }]]);

    expect(fixture.store.insertCalls).toEqual([]);
    expect(result[0][0]).toStrictEqual({ blocks: ['loose'] });
  });

  it('parents the duplicate it makes for a block owned elsewhere', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const foreignGrid = buildGrid(1, 1);
    const owned = fixture.store.add('owned', 'paragraph', {}, 'other-table');

    foreignGrid.container(0, 0).appendChild(owned.holder);

    const result = fixture.instance.initializeCells([[{ blocks: ['owned'] }]]);

    expect(fixture.store.byId(result[0][0].blocks[0]).parentId).toBe('table-1');
  });

  it('parents a claimed block and clears its placeholder', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const loose = fixture.store.add('loose');
    const editable = document.createElement('div');

    editable.setAttribute('data-blok-placeholder-active', 'true');
    loose.holder.appendChild(editable);
    document.body.appendChild(loose.holder);
    fixture.instance.claimBlockForCell(fixture.grid.cell(0, 0), 'loose');

    expect(loose.parentId).toBe('table-1');
    expect(editable.hasAttribute('data-blok-placeholder-active')).toBe(false);
  });

  it('skips flat neighbours that live in a different cell when choosing the DOM slot', () => {
    const fixture = setup({ rows: 1, cols: 2 });

    fixture.store.add('a');
    fixture.store.add('b');
    fixture.store.add('elsewhere');
    fixture.store.add('d');
    mountStoredBlock(fixture, 0, 0, 'a');
    mountStoredBlock(fixture, 0, 1, 'elsewhere');
    mountStoredBlock(fixture, 0, 0, 'd');
    document.body.appendChild(fixture.store.byId('b').holder);
    orderBlocks(fixture.store, ['table-1', 'a', 'b', 'elsewhere', 'd']);
    fixture.instance.claimBlockForCell(fixture.grid.cell(0, 0), 'b');

    expect(holderIds(fixture.grid.container(0, 0))).toEqual(['a', 'b', 'd']);
  });

  it('does not adopt a flat neighbour that belongs to another table grid', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const foreignGrid = buildGrid(1, 1);
    const neighbour = fixture.store.add('neighbour');
    const created = fixture.store.add('created');

    foreignGrid.container(0, 0).appendChild(neighbour.holder);
    fixture.grid.element.appendChild(created.holder);
    fixture.store.eventHandler()(blockAddedEvent('created', created.holder, 2));

    expect(created.holder.parentElement).toBe(fixture.grid.element);
    expect(holderIds(foreignGrid.container(0, 0))).toEqual(['neighbour']);
  });

  it('survives a recorded cell position the grid does not render', () => {
    const fixture = setup({ rows: 1, cols: 1, content: emptyContent(2, 1) });
    const restored = fixture.store.add('restored', 'paragraph', {}, 'table-1');

    fixture.model.addBlockToCell(1, 0, 'restored');
    document.body.appendChild(restored.holder);

    expect(() => fixture.store.eventHandler()(blockAddedEvent('restored', restored.holder, 1))).not.toThrow();
  });

  it('leaves a holder the editor already placed in a cell where it is', () => {
    const fixture = setup({ rows: 1, cols: 2 });

    fixture.store.add('anchor');
    mountStoredBlock(fixture, 0, 0, 'anchor');

    const typed = fixture.store.add('typed');

    fixture.grid.container(0, 1).appendChild(typed.holder);
    fixture.store.eventHandler()(blockAddedEvent('typed', typed.holder, 2));

    expect(typed.holder.parentElement).toBe(fixture.grid.container(0, 1));
    expect(fixture.model.getCellBlocks(0, 1)).toEqual(['typed']);
  });

  it('adopts a cell block whose parentId is an empty string', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const typed = fixture.store.add('typed', 'paragraph', {}, '');

    fixture.grid.container(0, 0).appendChild(typed.holder);
    fixture.store.eventHandler()(blockAddedEvent('typed', typed.holder, 1));

    expect(typed.parentId).toBe('table-1');
  });

  it('re-states parentage for a cell block it already owns', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const typed = fixture.store.add('typed', 'paragraph', {}, 'table-1');

    fixture.grid.container(0, 0).appendChild(typed.holder);
    fixture.store.eventHandler()(blockAddedEvent('typed', typed.holder, 1));

    expect(fixture.store.parentCalls).toContainEqual({ id: 'typed', parentId: 'table-1' });
  });

  it('ignores an outside block while the caret sits in a different table', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('anchor');
    mountStoredBlock(fixture, 0, 0, 'anchor');

    const foreign = fixture.store.add('foreign');
    const outside = fixture.store.add('outside');

    document.body.appendChild(foreign.holder);
    document.body.appendChild(outside.holder);
    fixture.store.currentBlockIndex = fixture.store.blocks.indexOf(foreign);
    fixture.store.eventHandler()(blockAddedEvent('outside', outside.holder, 3));

    expect(outside.holder.parentElement).toBe(document.body);
  });

  it('cancels the empty-cell repair once a restored block is routed back', async () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const handler = fixture.store.eventHandler();
    const foreignGrid = buildGrid(1, 1);

    fixture.store.add('only');
    mountStoredBlock(fixture, 0, 0, 'only');
    handler(blockRemovedEvent('only', fixture.store.byId('only').holder, 1));
    fixture.store.byId('only').holder.remove();

    const restored = fixture.store.add('restored', 'paragraph', {}, 'other-table');

    foreignGrid.container(0, 0).appendChild(restored.holder);
    fixture.model.addBlockToCell(0, 0, 'restored');
    handler(blockAddedEvent('restored', restored.holder, 1));

    await flushMicrotasks();

    expect(fixture.store.insertCalls).toEqual([]);
  });

  it('cancels the empty-cell repair once a replacement is routed back', async () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const handler = fixture.store.eventHandler();
    const foreignGrid = buildGrid(1, 1);

    fixture.store.add('only');
    mountStoredBlock(fixture, 0, 0, 'only');
    handler(blockRemovedEvent('only', fixture.store.byId('only').holder, 1));
    fixture.store.byId('only').holder.remove();
    fixture.store.blocks.splice(1, 1);

    const replacement = fixture.store.add('replacement', 'paragraph', {}, 'other-table');

    foreignGrid.container(0, 0).appendChild(replacement.holder);
    handler(blockAddedEvent('replacement', replacement.holder, 1));

    await flushMicrotasks();

    expect(fixture.store.insertCalls).toEqual([]);
  });
});

describe('TableCellBlocks — model order follows the DOM the user sees', () => {
  it('records a block dragged to the TOP of its own cell above its former sibling', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('mover');
    fixture.store.add('other');
    mountStoredBlock(fixture, 0, 0, 'mover');
    mountStoredBlock(fixture, 0, 0, 'other');

    const container = fixture.grid.container(0, 0);

    container.insertBefore(fixture.store.byId('mover').holder, fixture.store.byId('other').holder);
    fixture.store.eventHandler()(blockMovedEvent('mover', fixture.store.byId('mover').holder));

    expect(fixture.model.getCellBlocks(0, 0)).toEqual(['mover', 'other']);
  });

  it('records a block dragged to the BOTTOM of its own cell below its former sibling', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('mover');
    fixture.store.add('other');
    mountStoredBlock(fixture, 0, 0, 'mover');
    mountStoredBlock(fixture, 0, 0, 'other');

    const container = fixture.grid.container(0, 0);

    container.appendChild(fixture.store.byId('mover').holder);
    fixture.store.eventHandler()(blockMovedEvent('mover', fixture.store.byId('mover').holder));

    expect(fixture.model.getCellBlocks(0, 0)).toEqual(['other', 'mover']);
  });

  it('appends a tracked block whose holder never reached the cell', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const handler = fixture.store.eventHandler();
    const foreignGrid = buildGrid(1, 1);

    fixture.store.add('a');
    fixture.store.add('old');
    mountStoredBlock(fixture, 0, 0, 'a');
    mountStoredBlock(fixture, 0, 0, 'old');
    handler(blockRemovedEvent('old', fixture.store.byId('old').holder, 2));
    fixture.store.byId('old').holder.remove();
    fixture.store.blocks.splice(2, 1);

    const replacement = fixture.store.add('replacement', 'paragraph', {}, 'other-table');

    foreignGrid.container(0, 0).appendChild(replacement.holder);
    handler(blockAddedEvent('replacement', replacement.holder, 2));

    expect(fixture.model.getCellBlocks(0, 0)).toEqual(['a', 'replacement']);
  });
});

describe('TableCellBlocks — guards that keep other tables out', () => {
  it('does not record a removal that happened inside another table grid', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const handler = fixture.store.eventHandler();
    const foreignGrid = buildGrid(1, 1);

    fixture.store.add('anchor');
    mountStoredBlock(fixture, 0, 0, 'anchor');

    const gone = fixture.store.add('gone');

    foreignGrid.container(0, 0).appendChild(gone.holder);
    handler(blockRemovedEvent('gone', gone.holder, 2));
    fixture.store.blocks.splice(2, 1);

    const created = fixture.store.add('new');

    document.body.appendChild(created.holder);
    fixture.store.currentBlockIndex = -1;
    handler(blockAddedEvent('new', created.holder, 2));

    expect(holderIds(foreignGrid.container(0, 0))).toEqual(['gone']);
    expect(created.holder.parentElement).toBe(document.body);
  });

  it('survives a grid-local insert that matches no cell', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const loose = fixture.store.add('loose');

    fixture.grid.element.appendChild(loose.holder);

    expect(() => fixture.store.eventHandler()(blockAddedEvent('loose', loose.holder, 1))).not.toThrow();
    expect(loose.holder.parentElement).toBe(fixture.grid.element);
  });

  it('survives a wrapper-local insert that matches no cell', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('anchor');
    mountStoredBlock(fixture, 0, 0, 'anchor');

    const foreign = fixture.store.add('foreign');
    const created = fixture.store.add('created');

    document.body.appendChild(foreign.holder);
    fixture.grid.tableHolder.appendChild(created.holder);
    fixture.store.currentBlockIndex = 1;

    expect(() => fixture.store.eventHandler()(blockAddedEvent('created', created.holder, 3))).not.toThrow();
    expect(created.holder.parentElement).toBe(fixture.grid.tableHolder);
  });

  it('survives a removal whose recorded cell has no rendered element', async () => {
    const fixture = setup({ rows: 1, cols: 1, content: emptyContent(2, 1) });
    const stray = fixture.store.add('stray');

    document.body.appendChild(stray.holder);
    fixture.model.addBlockToCell(1, 0, 'stray');
    fixture.store.eventHandler()(blockRemovedEvent('stray', stray.holder, 1));

    await flushMicrotasks();

    expect(fixture.store.insertCalls).toEqual([]);
  });
});

describe('TableCellBlocks — repeated repairs, stale records and blank-space edges', () => {
  it('leaves a modified non-Tab key alone', () => {
    const fixture = setup({ rows: 2, cols: 2 });

    fillGridWithEditables(fixture.grid, 2, 2);

    const event = keyEvent('Enter', { shiftKey: true });

    fixture.instance.handleKeyDown(event, { row: 0, col: 0 });

    expect(event.defaultPrevented).toBe(false);
  });

  it('repairs a cell emptied a SECOND time', async () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const handler = fixture.store.eventHandler();

    fixture.store.add('first');
    mountStoredBlock(fixture, 0, 0, 'first');
    handler(blockRemovedEvent('first', fixture.store.byId('first').holder, 1));
    fixture.store.byId('first').holder.remove();

    await flushMicrotasks();

    expect(fixture.store.insertCalls).toHaveLength(1);

    const repaired = holderIds(fixture.grid.container(0, 0))[0];

    handler(blockRemovedEvent(repaired, fixture.store.byId(repaired).holder, 1));
    fixture.store.byId(repaired).holder.remove();

    await flushMicrotasks();

    expect(fixture.store.insertCalls).toHaveLength(2);
  });

  it('forgets a removal record once the pending check has run', async () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const handler = fixture.store.eventHandler();

    fixture.store.add('anchor');
    fixture.store.add('old');
    mountStoredBlock(fixture, 0, 0, 'anchor');
    mountStoredBlock(fixture, 0, 0, 'old');
    handler(blockRemovedEvent('old', fixture.store.byId('old').holder, 2));
    fixture.store.byId('old').holder.remove();
    fixture.store.blocks.splice(2, 1);

    await flushMicrotasks();

    const created = fixture.store.add('late');

    document.body.appendChild(created.holder);
    fixture.store.currentBlockIndex = -1;
    handler(blockAddedEvent('late', created.holder, 2));

    expect(created.holder.parentElement).toBe(document.body);
    expect(fixture.model.getCellBlocks(0, 0)).toEqual(['anchor']);
  });

  it('skips holders whose block id attribute is empty', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const container = fixture.grid.container(0, 0);
    const nameless = document.createElement('div');

    mountEditable(container, 'named', 'text');
    nameless.setAttribute('data-blok-id', '');
    container.appendChild(nameless);

    expect(fixture.instance.getBlockIdsFromCells([fixture.grid.cell(0, 0)])).toEqual(['named']);

    fixture.grid.cell(0, 0).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(fixture.store.caretCalls).toEqual([]);
  });

  it('ignores a click on the row rather than on a cell or its blocks container', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    mountEditable(fixture.grid.container(0, 0), 'only', 'text');

    const row = fixture.grid.element.querySelector<HTMLElement>(`[${ROW_ATTR}]`);

    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(fixture.store.caretCalls).toEqual([]);
  });
});

describe('TableCellBlocks — transient store states and event types it must ignore', () => {
  it('ignores a mutation event that is neither add, remove nor move', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('anchor');
    mountStoredBlock(fixture, 0, 0, 'anchor');

    const loose = fixture.store.add('loose');

    fixture.grid.element.appendChild(loose.holder);
    fixture.store.eventHandler()({
      event: { type: 'block-updated', detail: { target: { id: 'loose', holder: loose.holder }, index: 2 } },
    });

    expect(loose.holder.parentElement).toBe(fixture.grid.element);
    expect(fixture.model.getCellBlocks(0, 0)).toEqual(['anchor']);
  });

  it('never records the table block itself as cell content', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('anchor');
    mountStoredBlock(fixture, 0, 0, 'anchor');
    fixture.store.currentBlockIndex = 1;
    fixture.store.eventHandler()(blockAddedEvent('table-1', fixture.grid.tableHolder, 0));

    expect(fixture.model.getCellBlocks(0, 0)).toEqual(['anchor']);
  });

  it('ignores an indexless add even when the holder already sits in a cell', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const typed = fixture.store.add('typed');
    const editable = document.createElement('div');

    editable.setAttribute('data-blok-placeholder-active', 'true');
    typed.holder.appendChild(editable);
    fixture.grid.container(0, 0).appendChild(typed.holder);
    fixture.store.eventHandler()(blockAddedEvent('typed', typed.holder));

    expect(fixture.model.getCellBlocks(0, 0)).toEqual([]);
    expect(editable.hasAttribute('data-blok-placeholder-active')).toBe(true);
  });

  it('survives a block whose index resolves but whose block does not', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('ghost');
    fixture.store.hiddenFromIndex.add('ghost');

    expect(() => fixture.instance.claimBlockForCell(fixture.grid.cell(0, 0), 'ghost')).not.toThrow();
    expect(holderIds(fixture.grid.container(0, 0))).toEqual([]);
  });

  it('mounts nothing for a referenced block the store cannot resolve', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('ghost');
    fixture.store.hiddenFromIndex.add('ghost');

    const result = fixture.instance.initializeCells([[{ blocks: ['ghost'], text: 'typed' }]]);

    expect(result[0][0].blocks[0]).toBe('ghost');
    expect(result[0][0].blocks).toHaveLength(2);
  });

  it('survives an unresolvable neighbour when picking the DOM slot', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('a');
    fixture.store.add('b');
    fixture.store.add('c');
    mountStoredBlock(fixture, 0, 0, 'a');
    mountStoredBlock(fixture, 0, 0, 'c');
    document.body.appendChild(fixture.store.byId('b').holder);
    fixture.store.hiddenFromIndex.add('c');

    expect(() => fixture.instance.claimBlockForCell(fixture.grid.cell(0, 0), 'b')).not.toThrow();
    expect(holderIds(fixture.grid.container(0, 0))).toEqual(['a', 'c', 'b']);
  });

  it('survives an unresolvable neighbour when hunting for the new block cell', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('anchor');
    mountStoredBlock(fixture, 0, 0, 'anchor');

    const loose = fixture.store.add('loose');

    fixture.grid.element.appendChild(loose.holder);
    fixture.store.hiddenFromIndex.add('anchor');

    expect(() => fixture.store.eventHandler()(blockAddedEvent('loose', loose.holder, 2))).not.toThrow();
    expect(loose.holder.parentElement).toBe(fixture.grid.element);
  });

  it('claims a loose block whose parentId is an empty string', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const loose = fixture.store.add('loose', 'paragraph', {}, '');

    document.body.appendChild(loose.holder);
    fixture.instance.claimBlockForCell(fixture.grid.cell(0, 0), 'loose');

    expect(loose.holder.parentElement).toBe(fixture.grid.container(0, 0));
  });

  it('does not move a block that is already mounted in another cell of this table', () => {
    const fixture = setup({ rows: 1, cols: 2 });

    fixture.store.add('settled');
    mountStoredBlock(fixture, 0, 1, 'settled');
    fixture.instance.claimBlockForCell(fixture.grid.cell(0, 0), 'settled');

    expect(fixture.store.byId('settled').holder.parentElement).toBe(fixture.grid.container(0, 1));
  });

  it('duplicates rather than steals a block another cell of this table still holds', () => {
    const fixture = setup({ rows: 1, cols: 2 });
    const settled = fixture.store.add('settled', 'header', { text: 'mine' }, 'table-1');

    fixture.grid.container(0, 1).appendChild(settled.holder);

    const result = fixture.instance.initializeCells([[{ blocks: ['settled'] }, { blocks: [] }]]);

    expect(settled.holder.parentElement).toBe(fixture.grid.container(0, 1));
    expect(result[0][0].blocks).not.toEqual(['settled']);
    expect(fixture.store.insertCalls[0]).toMatchObject({ tool: 'header', data: { text: 'mine' } });
  });
});

describe('TableCellBlocks — the repair block must not be stolen by a stale removal', () => {
  it('leaves the cell that lost its content pending, and repairs it too', async () => {
    const fixture = setup({ rows: 1, cols: 3 });
    const handler = fixture.store.eventHandler();

    // Cell C keeps a tracked block so the emptied cell's flat index still looks
    // adjacent to this table; cell B is the one that loses its content.
    fixture.store.add('c');
    mountStoredBlock(fixture, 0, 2, 'c');
    fixture.store.add('gone');
    mountStoredBlock(fixture, 0, 1, 'gone');

    handler(blockRemovedEvent('gone', fixture.store.byId('gone').holder, 2));
    fixture.store.byId('gone').holder.remove();
    fixture.store.blocks.splice(2, 1);

    // The repair for cell A is inserted at the very index cell B recorded its
    // removal at. Claiming it into B would cancel B's own empty-cell check and
    // leave B with no editable target at all.
    fixture.store.emitInsertEvents = true;
    fixture.instance.ensureCellHasBlock(fixture.grid.cell(0, 0));

    expect(holderIds(fixture.grid.container(0, 0))).toHaveLength(1);

    await flushMicrotasks();

    expect(holderIds(fixture.grid.container(0, 1))).toHaveLength(1);
    expect(fixture.store.insertCalls).toHaveLength(2);
  });

  it('survives a referenced block whose index resolves but whose block does not', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('ghost', 'paragraph', {}, 'table-1');
    fixture.model.addBlockToCell(0, 0, 'ghost');
    fixture.store.hiddenFromIndex.add('ghost');

    expect(() => fixture.instance.reclaimReferencedBlocks()).not.toThrow();
    expect(holderIds(fixture.grid.container(0, 0))).toEqual([]);
  });

  it('does not adopt a block sitting in a DETACHED grid cell', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const detached = buildGrid(1, 1);
    const stray = fixture.store.add('stray');

    detached.tableHolder.remove();
    detached.container(0, 0).appendChild(stray.holder);
    fixture.store.eventHandler()(blockAddedEvent('stray', stray.holder, 1));

    expect(fixture.store.parentCalls).toEqual([]);
    expect(stray.parentId).toBeNull();
  });
});

describe('TableCellBlocks — the paragraph fallback is never attempted twice', () => {
  it('does not retry the same insert when the paragraph tool itself is missing', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.unavailableTools.add('paragraph');

    // The try/catch above the fallback exists for NON-paragraph tools. Routing a
    // paragraph through it makes the identical insert run twice — the retry can
    // only fail the same way, and a tool with side effects would run them twice.
    expect(() => fixture.instance.initializeCells([['plain text']])).toThrow();
    expect(fixture.store.insertCalls).toHaveLength(1);
  });
});

describe('TableCellBlocks — a block anchored after the table wrapper is not cell content', () => {
  it('refuses to claim it even though its flat neighbour IS a cell block', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('cell-block');
    mountStoredBlock(fixture, 0, 0, 'cell-block');

    const below = fixture.store.add('below');

    document.body.appendChild(below.holder);
    // The caret is in the cell, and index 1 IS a cell block — adjacency alone
    // would claim this. Only the "outside the table's own wrapper" test stops it,
    // and letting it through unparents visible content on the next save.
    fixture.store.currentBlockIndex = 1;
    fixture.store.eventHandler()(blockAddedEvent('below', below.holder, 2));

    expect(below.holder.parentElement).toBe(document.body);
    expect(fixture.model.getCellBlocks(0, 0)).toEqual(['cell-block']);
  });

  it('refuses a block inside the wrapper while the caret sits in another table', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('cell-block');
    mountStoredBlock(fixture, 0, 0, 'cell-block');

    const foreign = fixture.store.add('foreign');
    const created = fixture.store.add('created');

    document.body.appendChild(foreign.holder);
    // Inside the table wrapper but outside the grid, so the wrapper guard passes.
    // Its flat neighbour IS a cell block, so adjacency would claim it — only
    // "was the caret in OUR table" can refuse.
    fixture.grid.tableHolder.appendChild(created.holder);
    orderBlocks(fixture.store, ['table-1', 'foreign', 'cell-block', 'created']);
    fixture.store.currentBlockIndex = 1;
    fixture.store.eventHandler()(blockAddedEvent('created', created.holder, 3));

    expect(created.holder.parentElement).toBe(fixture.grid.tableHolder);
    expect(fixture.model.getCellBlocks(0, 0)).toEqual(['cell-block']);
  });

  it('survives a current-block index whose block the store cannot resolve', () => {
    const fixture = setup({ rows: 1, cols: 1 });

    fixture.store.add('vanished');
    fixture.store.hiddenFromIndex.add('vanished');

    const created = fixture.store.add('created');

    document.body.appendChild(created.holder);
    fixture.store.currentBlockIndex = 1;

    expect(() => fixture.store.eventHandler()(blockAddedEvent('created', created.holder, 2))).not.toThrow();
    expect(created.holder.parentElement).toBe(document.body);
  });
});

describe('TableCellBlocks — cells the grid renders but cannot be located', () => {
  it('tracks nothing for a cell carrying no logical column', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    // Resolve both before stripping the attribute the helpers look cells up by.
    const cell = fixture.grid.cell(0, 0);
    const container = fixture.grid.container(0, 0);

    cell.removeAttribute(CELL_COL_ATTR);

    const typed = fixture.store.add('typed');

    container.appendChild(typed.holder);

    expect(() => fixture.store.eventHandler()(blockAddedEvent('typed', typed.holder, 1))).not.toThrow();
    expect(fixture.model.getCellBlocks(0, 0)).toEqual([]);
  });

  it('appends to the model when the recorded cell lost its blocks container', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const handler = fixture.store.eventHandler();

    fixture.store.add('old');
    mountStoredBlock(fixture, 0, 0, 'old');
    handler(blockRemovedEvent('old', fixture.store.byId('old').holder, 1));
    fixture.grid.container(0, 0).remove();
    fixture.store.blocks.splice(1, 1);

    const created = fixture.store.add('new');

    document.body.appendChild(created.holder);

    expect(() => handler(blockAddedEvent('new', created.holder, 1))).not.toThrow();
    expect(fixture.model.getCellBlocks(0, 0)).toEqual(['new']);
  });
});

describe('TableCellBlocks — removal records for blocks the model never tracked', () => {
  it('routes a replacement back using the holder DOM position alone', () => {
    const fixture = setup({ rows: 1, cols: 2 });
    const handler = fixture.store.eventHandler();

    fixture.store.add('anchor');
    mountStoredBlock(fixture, 0, 0, 'anchor');

    // Mounted in cell B but never synced to the model — the DOM is the only
    // record of where it lived.
    const ghost = fixture.store.add('ghost');

    fixture.grid.container(0, 1).appendChild(ghost.holder);
    handler(blockRemovedEvent('ghost', ghost.holder, 2));
    ghost.holder.remove();
    fixture.store.blocks.splice(2, 1);

    const created = fixture.store.add('replacement');

    document.body.appendChild(created.holder);
    handler(blockAddedEvent('replacement', created.holder, 2));

    expect(holderIds(fixture.grid.container(0, 1))).toEqual(['replacement']);
  });

  it('forgets that record once the pending check has run', async () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const handler = fixture.store.eventHandler();

    fixture.store.add('tracked');
    mountStoredBlock(fixture, 0, 0, 'tracked');

    const ghost = fixture.store.add('ghost');

    fixture.grid.container(0, 0).appendChild(ghost.holder);
    handler(blockRemovedEvent('ghost', ghost.holder, 2));
    ghost.holder.remove();
    fixture.store.blocks.splice(2, 1);

    await flushMicrotasks();

    const created = fixture.store.add('late');

    document.body.appendChild(created.holder);
    fixture.store.currentBlockIndex = -1;
    handler(blockAddedEvent('late', created.holder, 2));

    expect(created.holder.parentElement).toBe(document.body);
  });
});

describe('TableCellBlocks — a replacement is only claimed when this table is really adjacent', () => {
  it('refuses it when neither neighbour is ours and the table block is not next to it', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const handler = fixture.store.eventHandler();

    fixture.store.add('filler');
    fixture.store.add('old');
    mountStoredBlock(fixture, 0, 0, 'old');
    orderBlocks(fixture.store, ['table-1', 'filler', 'old']);
    handler(blockRemovedEvent('old', fixture.store.byId('old').holder, 2));
    fixture.store.byId('old').holder.remove();

    const created = fixture.store.add('new');

    document.body.appendChild(created.holder);
    // Same flat index as the removal, but nothing here belongs to this table —
    // claiming it would pull another table's block into our cell.
    orderBlocks(fixture.store, ['table-1', 'filler', 'new']);
    fixture.store.currentBlockIndex = -1;
    handler(blockAddedEvent('new', created.holder, 2));

    expect(holderIds(fixture.grid.container(0, 0))).toEqual([]);
    expect(created.holder.parentElement).toBe(document.body);
  });

  it('claims it when the table sits before it and the block after cannot be resolved', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const handler = fixture.store.eventHandler();

    fixture.store.add('old');
    mountStoredBlock(fixture, 0, 0, 'old');
    fixture.store.add('ghost');
    fixture.store.hiddenFromIndex.add('ghost');
    orderBlocks(fixture.store, ['table-1', 'old', 'ghost']);
    handler(blockRemovedEvent('old', fixture.store.byId('old').holder, 1));
    fixture.store.byId('old').holder.remove();

    const created = fixture.store.add('new');

    document.body.appendChild(created.holder);
    orderBlocks(fixture.store, ['table-1', 'new', 'ghost']);
    handler(blockAddedEvent('new', created.holder, 1));

    expect(holderIds(fixture.grid.container(0, 0))).toEqual(['new']);
  });
});

describe('TableCellBlocks — blank-space clicks only answer for the cell chrome', () => {
  it('ignores a click on a wrapper that is part of the block content', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const wrapper = document.createElement('div');

    fixture.grid.container(0, 0).appendChild(wrapper);
    mountEditable(wrapper, 'inner', 'text');
    wrapper.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(fixture.store.caretCalls).toEqual([]);
  });

  it('ignores a blocks container that is not inside a cell', () => {
    const fixture = setup({ rows: 1, cols: 1 });
    const orphan = document.createElement('div');

    orphan.setAttribute(CELL_BLOCKS_ATTR, '');
    fixture.grid.element.appendChild(orphan);
    mountEditable(orphan, 'orphaned', 'text');
    orphan.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(fixture.store.caretCalls).toEqual([]);
  });
});
