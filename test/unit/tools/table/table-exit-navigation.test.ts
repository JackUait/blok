import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { API, BlockToolData } from '../../../../types';
import type { TableModel } from '../../../../src/tools/table/table-model';
import { TableCellBlocks } from '../../../../src/tools/table/table-cell-blocks';

/**
 * Minimal in-memory block tree that mirrors the parts of BlockManager the
 * table-exit path relies on:
 * - a flat block array (index order),
 * - a parentId/contentIds tree,
 * - the DOM placement rules of Blocks.insert (holder anchored 'afterend' the
 *   predecessor) and BlockHierarchy.setBlockParent (holder mounted into the
 *   parent's [data-blok-nested-blocks] container),
 * - the column-inheritance rescue of BlockInsertion.insert (a non-replace
 *   insert whose PREDECESSOR lives in a `column` inherits that column).
 */
interface FakeBlock {
  id: string;
  name: string;
  parentId: string | null;
  holder: HTMLElement;
}

interface SavedNode {
  id: string;
  children: SavedNode[];
}

interface FakeEditor {
  api: API;
  flat: FakeBlock[];
  workingArea: HTMLElement;
  addBlock: (id: string, name: string, parentId: string | null, holder?: HTMLElement) => FakeBlock;
  save: () => SavedNode[];
  caretCalls: Array<{ id: string; position?: string }>;
}

const createNestedContainer = (): HTMLElement => {
  const container = document.createElement('div');

  container.setAttribute('data-blok-nested-blocks', '');

  return container;
};

const createFakeEditor = (): FakeEditor => {
  const flat: FakeBlock[] = [];
  const workingArea = document.createElement('div');
  const caretCalls: Array<{ id: string; position?: string }> = [];
  let autoId = 0;

  document.body.appendChild(workingArea);

  const byId = (id: string): FakeBlock | undefined => flat.find(block => block.id === id);

  const setBlockParent = (blockId: string, parentId: string | null): void => {
    const block = byId(blockId);

    if (!block) {
      return;
    }

    block.parentId = parentId;

    if (parentId === null) {
      return;
    }

    const parent = byId(parentId);
    const container = parent?.holder.querySelector<HTMLElement>('[data-blok-nested-blocks]');

    if (container) {
      container.appendChild(block.holder);
    }
  };

  const createHolder = (id: string): HTMLElement => {
    const holder = document.createElement('div');

    holder.setAttribute('data-blok-id', id);

    return holder;
  };

  const addBlock = (id: string, name: string, parentId: string | null, holder?: HTMLElement): FakeBlock => {
    const block: FakeBlock = {
      id,
      name,
      parentId,
      holder: holder ?? createHolder(id),
    };

    block.holder.setAttribute('data-blok-id', id);
    flat.push(block);

    if (parentId === null) {
      workingArea.appendChild(block.holder);
    } else {
      const parent = byId(parentId);
      const container = parent?.holder.querySelector<HTMLElement>('[data-blok-nested-blocks]');

      if (container) {
        container.appendChild(block.holder);
      }
    }

    return block;
  };

  const insertAtIndex = (name: string, index: number): FakeBlock => {
    autoId += 1;
    const id = `inserted-${autoId}`;
    const block: FakeBlock = {
      id,
      name,
      parentId: null,
      holder: createHolder(id),
    };
    const at = Math.min(index, flat.length);
    const predecessor: FakeBlock | undefined = at > 0 ? flat[at - 1] : undefined;

    flat.splice(at, 0, block);

    if (predecessor) {
      predecessor.holder.after(block.holder);
    } else {
      workingArea.prepend(block.holder);
    }

    // Column-inheritance rescue (BlockInsertion.insert)
    const predecessorParent = predecessor?.parentId !== null && predecessor?.parentId !== undefined
      ? byId(predecessor.parentId)
      : undefined;

    if (predecessorParent?.name === 'column') {
      setBlockParent(block.id, predecessorParent.id);
    }

    return block;
  };

  const save = (): SavedNode[] => {
    const toNode = (block: FakeBlock): SavedNode => ({
      id: block.id,
      children: flat.filter(child => child.parentId === block.id).map(toNode),
    });

    return flat.filter(block => block.parentId === null).map(toNode);
  };

  const api = {
    blocks: {
      getBlocksCount: (): number => flat.length,
      getBlockIndex: (id: string): number | undefined => {
        const index = flat.findIndex(block => block.id === id);

        return index === -1 ? undefined : index;
      },
      getBlockByIndex: (index: number): FakeBlock | undefined => flat[index],
      getChildren: (parentId: string): FakeBlock[] => flat.filter(block => block.parentId === parentId),
      setBlockParent,
      insert: (
        name?: string,
        _data?: BlockToolData,
        _config?: unknown,
        index?: number
      ): FakeBlock => insertAtIndex(name ?? 'paragraph', index ?? flat.length),
      insertInsideParent: (parentId: string, insertIndex: number): FakeBlock => {
        const block = insertAtIndex('paragraph', insertIndex);

        setBlockParent(block.id, parentId);

        return block;
      },
      isSyncingFromYjs: false,
      transactWithoutCapture: (fn: () => void): void => fn(),
      delete: vi.fn(),
      getCurrentBlockIndex: (): number => -1,
    },
    events: {
      on: vi.fn(),
      off: vi.fn(),
    },
    caret: {
      setToBlock: (id: string, position?: string): boolean => {
        caretCalls.push({
          id,
          ...(position !== undefined && { position }),
        });

        return true;
      },
    },
  } as unknown as API;

  return {
    api,
    flat,
    workingArea,
    addBlock,
    save,
    caretCalls,
  };
};

const createModelStub = (): TableModel => ({
  findCellForBlock: vi.fn(() => null),
  addBlockToCell: vi.fn(),
  removeBlockFromCell: vi.fn(),
  isSpannedCell: vi.fn(() => false),
  hasMerges: vi.fn(() => false),
  snapshot: vi.fn(() => ({ content: [] })),
} as unknown as TableModel);

/**
 * Build a 1x1 grid element (one cell, one paragraph block inside it) plus the
 * table block holder that wraps it.
 */
const createTableWithGrid = (editor: FakeEditor, tableId: string, parentId: string | null): {
  table: FakeBlock;
  gridElement: HTMLElement;
} => {
  const tableHolder = document.createElement('div');
  const grid = document.createElement('div');
  const row = document.createElement('div');
  const cell = document.createElement('div');
  const cellBlocks = document.createElement('div');

  row.setAttribute('data-blok-table-row', '0');
  cell.setAttribute('data-blok-table-cell', '');
  cell.setAttribute('data-blok-table-cell-row', '0');
  cell.setAttribute('data-blok-table-cell-col', '0');
  cellBlocks.setAttribute('data-blok-table-cell-blocks', '');

  cell.appendChild(cellBlocks);
  row.appendChild(cell);
  grid.appendChild(row);
  tableHolder.appendChild(grid);

  const table = editor.addBlock(tableId, 'table', parentId, tableHolder);
  // Cell blocks are appended at the TAIL of the flat array by the table tool.
  const cellParagraph = editor.addBlock(`${tableId}-cell-0-0`, 'paragraph', tableId);

  cellBlocks.appendChild(cellParagraph.holder);

  return {
    table,
    gridElement: grid,
  };
};

const createColumnLayout = (editor: FakeEditor): { columnListId: string; leftId: string; rightId: string } => {
  const listHolder = document.createElement('div');
  const listContainer = createNestedContainer();

  listHolder.appendChild(listContainer);
  editor.addBlock('column-list', 'column_list', null, listHolder);

  const makeColumn = (id: string): void => {
    const holder = document.createElement('div');

    holder.setAttribute('data-blok-column', '');
    holder.appendChild(createNestedContainer());
    editor.addBlock(id, 'column', 'column-list', holder);
  };

  makeColumn('column-left');
  makeColumn('column-right');

  return {
    columnListId: 'column-list',
    leftId: 'column-left',
    rightId: 'column-right',
  };
};

const pressKey = (
  cellBlocks: TableCellBlocks,
  key: string,
  options: { shiftKey?: boolean } = {}
): void => {
  const event = new KeyboardEvent('keydown', {
    key,
    shiftKey: options.shiftKey ?? false,
    cancelable: true,
  });

  const position = { row: 0, col: 0 };

  // Arrow navigation moved to the capture-phase handler; Tab stays on handleKeyDown.
  if (key.startsWith('Arrow')) {
    cellBlocks.handleArrowNavigation(event, position);
  } else {
    cellBlocks.handleKeyDown(event, position);
  }
};

/**
 * DOM/model invariant every table-exit gesture must preserve:
 * the block the caret lands on (or the one just created) must live OUTSIDE
 * the table's cells and must be a SIBLING of the table in the block tree.
 */
const expectExitTargetIsTableSibling = (block: FakeBlock, table: FakeBlock): void => {
  expect(block.holder.closest('[data-blok-table-cell]')).toBeNull();
  expect(block.parentId).toBe(table.parentId);
};

describe('table keyboard exit is container-aware', () => {
  let editor: FakeEditor;

  beforeEach(() => {
    vi.clearAllMocks();
    editor = createFakeEditor();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  const mountCellBlocks = (tableId: string, gridElement: HTMLElement): TableCellBlocks => {
    return new TableCellBlocks({
      api: editor.api,
      gridElement,
      tableBlockId: tableId,
      model: createModelStub(),
    });
  };

  it('Tab out of the last cell lands on the next block in the SAME column', () => {
    const { leftId } = createColumnLayout(editor);
    const { table, gridElement } = createTableWithGrid(editor, 'table-1', leftId);
    const sameColumnNext = editor.addBlock('left-p2', 'paragraph', leftId);

    editor.addBlock('right-p1', 'paragraph', 'column-right');

    const cellBlocks = mountCellBlocks('table-1', gridElement);

    pressKey(cellBlocks, 'Tab');

    expect(editor.caretCalls).toEqual([{
      id: 'left-p2',
      position: 'start',
    }]);
    expectExitTargetIsTableSibling(sameColumnNext, table);
  });

  it('Tab out of a table that is LAST in its column never teleports to the other column', () => {
    const { leftId } = createColumnLayout(editor);
    const { table, gridElement } = createTableWithGrid(editor, 'table-1', leftId);

    editor.addBlock('right-p1', 'paragraph', 'column-right');

    const cellBlocks = mountCellBlocks('table-1', gridElement);

    pressKey(cellBlocks, 'Tab');

    const focusedIds = editor.caretCalls.map(call => call.id);

    expect(focusedIds).not.toContain('right-p1');
    expect(focusedIds).not.toContain('column-right');

    const created = editor.flat.find(block => block.id === focusedIds[0]);

    expect(created).toBeDefined();

    if (!created) {
      return;
    }

    // The new block belongs to the LEFT column, both in the model and the DOM.
    expectExitTargetIsTableSibling(created, table);
    expect(created.parentId).toBe(leftId);
    expect(created.holder.closest('[data-blok-column]')?.getAttribute('data-blok-id')).toBe(leftId);

    // save() must agree with the DOM: the new block is a sibling of the table
    // INSIDE the left column, never a root block.
    const tree = editor.save();
    const columnList = tree.find(node => node.id === 'column-list');
    const leftColumn = columnList?.children.find(node => node.id === leftId);

    expect(leftColumn?.children.map(node => node.id)).toEqual(['table-1', created.id]);
    expect(tree.map(node => node.id)).not.toContain(created.id);
  });

  it('Tab out of a table that is the last ROOT block creates a paragraph after it at root', () => {
    const { table, gridElement } = createTableWithGrid(editor, 'table-1', null);
    const cellBlocks = mountCellBlocks('table-1', gridElement);

    pressKey(cellBlocks, 'Tab');

    const focusedId = editor.caretCalls[0]?.id;
    const created = editor.flat.find(block => block.id === focusedId);

    expect(created).toBeDefined();

    if (!created) {
      return;
    }

    expectExitTargetIsTableSibling(created, table);
    expect(created.holder.closest('[data-blok-table-cell]')).toBeNull();
    expect(table.holder.contains(created.holder)).toBe(false);
    expect(table.holder.nextElementSibling).toBe(created.holder);

    const rootIds = editor.save().map(node => node.id);

    expect(rootIds).toEqual(['table-1', created.id]);
  });

  it('ArrowDown at the last row exits into the same column, not the neighbouring one', () => {
    const { leftId } = createColumnLayout(editor);
    const { table, gridElement } = createTableWithGrid(editor, 'table-1', leftId);

    editor.addBlock('right-p1', 'paragraph', 'column-right');

    const cellBlocks = mountCellBlocks('table-1', gridElement);

    pressKey(cellBlocks, 'ArrowDown');

    const focusedId = editor.caretCalls[0]?.id;

    expect(focusedId).not.toBe('right-p1');
    expect(focusedId).not.toBe('column-right');

    const created = editor.flat.find(block => block.id === focusedId);

    expect(created).toBeDefined();

    if (!created) {
      return;
    }

    expectExitTargetIsTableSibling(created, table);
  });

  it('Shift+Tab out of the first cell lands on the previous block in the SAME column', () => {
    const { leftId } = createColumnLayout(editor);
    const previous = editor.addBlock('left-p1', 'paragraph', leftId);
    const { table, gridElement } = createTableWithGrid(editor, 'table-1', leftId);

    const cellBlocks = mountCellBlocks('table-1', gridElement);

    pressKey(cellBlocks, 'Tab', { shiftKey: true });

    expect(editor.caretCalls).toEqual([{
      id: 'left-p1',
      position: 'end',
    }]);
    expectExitTargetIsTableSibling(previous, table);
  });

  it('Shift+Tab out of a table that is FIRST in its column never teleports to the other column', () => {
    const { rightId } = createColumnLayout(editor);

    editor.addBlock('left-p1', 'paragraph', 'column-left');

    const { gridElement } = createTableWithGrid(editor, 'table-1', rightId);
    const cellBlocks = mountCellBlocks('table-1', gridElement);

    pressKey(cellBlocks, 'Tab', { shiftKey: true });

    expect(editor.caretCalls).toEqual([]);
  });
});
