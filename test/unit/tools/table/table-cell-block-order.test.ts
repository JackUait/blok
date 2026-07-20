import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Table } from '../../../../src/tools/table';
import { TableModel } from '../../../../src/tools/table/table-model';
import type { TableData, TableConfig, CellContent } from '../../../../src/tools/table/types';
import type { BlockToolConstructorOptions } from '../../../../types';
import { TableCellBlocks, CELL_BLOCKS_ATTR } from '../../../../src/tools/table/table-cell-blocks';
import { CELL_ATTR, ROW_ATTR, CELL_COL_ATTR } from '../../../../src/tools/table/table-core';
import type { API } from '../../../../types';

/**
 * Regression: images (or any blocks) inserted at the top/middle of a table
 * cell drifted to the BOTTOM of the cell after save. Root cause: the model's
 * per-cell block order was append-only (addBlockToCell always pushed) and
 * never re-synced on within-grid moves, while the DOM showed the true order.
 * save() trusted the stale model order, so WYSIWYG broke permanently.
 */

interface GridFixture {
  grid: HTMLElement;
  cell: HTMLElement;
  container: HTMLElement;
  holders: Map<string, HTMLElement>;
}

const buildGrid = (blockIds: string[]): GridFixture => {
  const grid = document.createElement('div');
  const row = document.createElement('div');

  row.setAttribute(ROW_ATTR, '');
  grid.appendChild(row);

  const cell = document.createElement('div');

  cell.setAttribute(CELL_ATTR, '');
  cell.setAttribute(CELL_COL_ATTR, '0');
  row.appendChild(cell);

  const container = document.createElement('div');

  container.setAttribute(CELL_BLOCKS_ATTR, '');
  cell.appendChild(container);

  const holders = new Map<string, HTMLElement>();

  for (const id of blockIds) {
    const holder = document.createElement('div');

    holder.setAttribute('data-blok-id', id);
    container.appendChild(holder);
    holders.set(id, holder);
  }

  return { grid, cell, container, holders };
};

const createEventsApi = (): { on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn> } => ({
  on: vi.fn(),
  off: vi.fn(),
});

const createApi = (eventsApi: ReturnType<typeof createEventsApi>): API => ({
  blocks: {
    insert: vi.fn(),
    delete: vi.fn(),
    getBlockIndex: vi.fn(() => undefined),
    getBlockByIndex: vi.fn(() => undefined),
    getCurrentBlockIndex: vi.fn(() => -1),
    getBlocksCount: vi.fn(() => 0),
    setBlockParent: vi.fn(),
  },
  events: eventsApi,
  caret: {
    setToBlock: vi.fn(() => true),
  },
} as unknown as API);

const getBlockChangedHandler = (eventsOn: ReturnType<typeof vi.fn>): (data: unknown) => void => {
  const onCall = eventsOn.mock.calls.find(
    (call: unknown[]) => call[0] === 'block changed'
  );

  if (!onCall) {
    throw new Error('block changed handler not registered');
  }

  return onCall[1] as (data: unknown) => void;
};

describe('table cell block order (WYSIWYG save-order regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('TableModel.addBlockToCell with insertion index', () => {
    const createModel = (): TableModel =>
      new TableModel({
        withHeadings: false,
        withHeadingColumn: false,
        content: [[{ blocks: [] }]],
      });

    it('inserts at the given index instead of appending', () => {
      const model = createModel();

      model.addBlockToCell(0, 0, 'b1');
      model.addBlockToCell(0, 0, 'b2');
      model.addBlockToCell(0, 0, 'img', 0);

      expect(model.getCellBlocks(0, 0)).toEqual(['img', 'b1', 'b2']);
    });

    it('inserts in the middle', () => {
      const model = createModel();

      model.addBlockToCell(0, 0, 'b1');
      model.addBlockToCell(0, 0, 'b2');
      model.addBlockToCell(0, 0, 'img', 1);

      expect(model.getCellBlocks(0, 0)).toEqual(['b1', 'img', 'b2']);
    });

    it('appends when index is omitted or beyond the end', () => {
      const model = createModel();

      model.addBlockToCell(0, 0, 'b1');
      model.addBlockToCell(0, 0, 'b2', 99);

      expect(model.getCellBlocks(0, 0)).toEqual(['b1', 'b2']);
    });

    it('re-inserts an existing block at a new index (within-cell reorder)', () => {
      const model = createModel();

      model.addBlockToCell(0, 0, 'b1');
      model.addBlockToCell(0, 0, 'img');
      model.addBlockToCell(0, 0, 'img', 0);

      expect(model.getCellBlocks(0, 0)).toEqual(['img', 'b1']);
    });
  });

  describe('TableCellBlocks syncs model order to DOM order', () => {
    it('block-added at the TOP of a cell records it FIRST in the model, not last', () => {
      const model = new TableModel({
        withHeadings: false,
        withHeadingColumn: false,
        content: [[{ blocks: [] }]],
      });

      model.addBlockToCell(0, 0, 'b1');
      model.addBlockToCell(0, 0, 'b2');

      const { grid, container } = buildGrid(['b1', 'b2']);
      const eventsApi = createEventsApi();
      const api = createApi(eventsApi);

      const cellBlocks = new TableCellBlocks({
        api,
        gridElement: grid,
        tableBlockId: 'table-1',
        model,
      });

      // The image block's holder lands at the TOP of the cell (insertToDOM /
      // claimBlockForCell place it by flat order), then block-added fires.
      const imgHolder = document.createElement('div');

      imgHolder.setAttribute('data-blok-id', 'img');
      container.insertBefore(imgHolder, container.firstChild);

      const handler = getBlockChangedHandler(eventsApi.on);

      handler({
        event: {
          type: 'block-added',
          detail: {
            target: { id: 'img', holder: imgHolder },
            index: 1,
          },
        },
      });

      expect(model.getCellBlocks(0, 0)).toEqual(['img', 'b1', 'b2']);

      cellBlocks.destroy();
    });

    it('claims parentage for an untracked block that landed in a cell container (Enter-at-start / insertToDOM path)', () => {
      const model = new TableModel({
        withHeadings: false,
        withHeadingColumn: false,
        content: [[{ blocks: [] }]],
      });

      model.addBlockToCell(0, 0, 'b1');

      const { grid, container } = buildGrid(['b1']);
      const eventsApi = createEventsApi();
      const api = createApi(eventsApi);

      const cellBlocks = new TableCellBlocks({
        api,
        gridElement: grid,
        tableBlockId: 'table-1',
        model,
      });

      const newHolder = document.createElement('div');

      newHolder.setAttribute('data-blok-id', 'new-block');
      container.insertBefore(newHolder, container.firstChild);

      const handler = getBlockChangedHandler(eventsApi.on);

      handler({
        event: {
          type: 'block-added',
          detail: {
            target: { id: 'new-block', holder: newHolder },
            index: 1,
          },
        },
      });

      // Without the parent claim, save() filters the block out of the cell
      // (its parentId doesn't match the table) and it becomes a top-level
      // orphan that reloads OUTSIDE / at the bottom of the table.
      expect(api.blocks.setBlockParent).toHaveBeenCalledWith('new-block', 'table-1');
      expect(model.getCellBlocks(0, 0)).toEqual(['new-block', 'b1']);

      cellBlocks.destroy();
    });

    it('claims a block inserted ABOVE the first cell block whose holder landed outside the table wrapper (Enter-at-start)', () => {
      const model = new TableModel({
        withHeadings: false,
        withHeadingColumn: false,
        content: [[{ blocks: [] }]],
      });

      model.addBlockToCell(0, 0, 'hello');

      // Real DOM topology: root > tableHolder > grid > ... > cell container.
      const root = document.createElement('div');
      const tableHolder = document.createElement('div');

      tableHolder.setAttribute('data-blok-id', 'table-1');
      root.appendChild(tableHolder);

      const { grid, container, holders } = buildGrid(['hello']);

      tableHolder.appendChild(grid);

      // insertToDOM anchored the new holder AFTER the table wrapper at root
      // (its flat predecessor is the table block itself).
      const newHolder = document.createElement('div');

      newHolder.setAttribute('data-blok-id', 'new-block');
      root.appendChild(newHolder);

      const helloHolder = holders.get('hello');

      if (!helloHolder) {
        throw new Error('missing holder');
      }

      const flat = [
        { id: 'table-1', holder: tableHolder },
        { id: 'new-block', holder: newHolder },
        { id: 'hello', holder: helloHolder },
      ];

      const eventsApi = createEventsApi();
      const api = {
        blocks: {
          insert: vi.fn(),
          delete: vi.fn(),
          getBlockIndex: vi.fn((id: string) => {
            const index = flat.findIndex(block => block.id === id);

            return index === -1 ? undefined : index;
          }),
          getBlockByIndex: vi.fn((index: number) => flat[index]),
          // Case 1 Enter keeps the caret on the block BELOW the insert.
          getCurrentBlockIndex: vi.fn(() => 2),
          getBlocksCount: vi.fn(() => flat.length),
          setBlockParent: vi.fn(),
        },
        events: eventsApi,
        caret: { setToBlock: vi.fn(() => true) },
      } as unknown as API;

      const cellBlocks = new TableCellBlocks({
        api,
        gridElement: grid,
        tableBlockId: 'table-1',
        model,
      });

      const handler = getBlockChangedHandler(eventsApi.on);

      handler({
        event: {
          type: 'block-added',
          detail: {
            target: { id: 'new-block', holder: newHolder },
            index: 1,
          },
        },
      });

      // The block belongs to the cell the user is editing: mounted above the
      // current block, tracked first in the model, parented to the table.
      expect(container.contains(newHolder)).toBe(true);
      expect(model.getCellBlocks(0, 0)).toEqual(['new-block', 'hello']);
      expect(api.blocks.setBlockParent).toHaveBeenCalledWith('new-block', 'table-1');

      cellBlocks.destroy();
    });

    it('still ignores an outside-wrapper block when the caret is NOT in this table', () => {
      const model = new TableModel({
        withHeadings: false,
        withHeadingColumn: false,
        content: [[{ blocks: [] }]],
      });

      model.addBlockToCell(0, 0, 'hello');

      const root = document.createElement('div');
      const tableHolder = document.createElement('div');

      tableHolder.setAttribute('data-blok-id', 'table-1');
      root.appendChild(tableHolder);

      const { grid, container, holders } = buildGrid(['hello']);

      tableHolder.appendChild(grid);

      const newHolder = document.createElement('div');

      newHolder.setAttribute('data-blok-id', 'new-block');
      root.appendChild(newHolder);

      const helloHolder = holders.get('hello');

      if (!helloHolder) {
        throw new Error('missing holder');
      }

      const flat = [
        { id: 'table-1', holder: tableHolder },
        { id: 'new-block', holder: newHolder },
        { id: 'hello', holder: helloHolder },
      ];

      const eventsApi = createEventsApi();
      const api = {
        blocks: {
          insert: vi.fn(),
          delete: vi.fn(),
          getBlockIndex: vi.fn((id: string) => {
            const index = flat.findIndex(block => block.id === id);

            return index === -1 ? undefined : index;
          }),
          getBlockByIndex: vi.fn((index: number) => flat[index]),
          // Caret on the new top-level block itself — a plain insert near the
          // table, not an edit inside it.
          getCurrentBlockIndex: vi.fn(() => 1),
          getBlocksCount: vi.fn(() => flat.length),
          setBlockParent: vi.fn(),
        },
        events: eventsApi,
        caret: { setToBlock: vi.fn(() => true) },
      } as unknown as API;

      const cellBlocks = new TableCellBlocks({
        api,
        gridElement: grid,
        tableBlockId: 'table-1',
        model,
      });

      const handler = getBlockChangedHandler(eventsApi.on);

      handler({
        event: {
          type: 'block-added',
          detail: {
            target: { id: 'new-block', holder: newHolder },
            index: 1,
          },
        },
      });

      expect(container.contains(newHolder)).toBe(false);
      expect(model.getCellBlocks(0, 0)).toEqual(['hello']);
      expect(api.blocks.setBlockParent).not.toHaveBeenCalled();

      cellBlocks.destroy();
    });

    it('does NOT claim parentage for a block owned by another table', () => {
      const model = new TableModel({
        withHeadings: false,
        withHeadingColumn: false,
        content: [[{ blocks: [] }]],
      });

      model.addBlockToCell(0, 0, 'b1');

      const { grid, container } = buildGrid(['b1']);
      const eventsApi = createEventsApi();
      const api = createApi(eventsApi);

      (api.blocks as unknown as { getById: (id: string) => unknown }).getById =
        vi.fn(() => ({ id: 'foreign', parentId: 'other-table' }));

      const cellBlocks = new TableCellBlocks({
        api,
        gridElement: grid,
        tableBlockId: 'table-1',
        model,
      });

      const foreignHolder = document.createElement('div');

      foreignHolder.setAttribute('data-blok-id', 'foreign');
      container.appendChild(foreignHolder);

      const handler = getBlockChangedHandler(eventsApi.on);

      handler({
        event: {
          type: 'block-added',
          detail: {
            target: { id: 'foreign', holder: foreignHolder },
            index: 1,
          },
        },
      });

      expect(api.blocks.setBlockParent).not.toHaveBeenCalled();

      cellBlocks.destroy();
    });

    it('block-moved WITHIN the grid re-syncs the model to the new DOM order', () => {
      const model = new TableModel({
        withHeadings: false,
        withHeadingColumn: false,
        content: [[{ blocks: [] }]],
      });

      model.addBlockToCell(0, 0, 'b1');
      model.addBlockToCell(0, 0, 'img');

      const { grid, container, holders } = buildGrid(['b1', 'img']);
      const eventsApi = createEventsApi();
      const api = createApi(eventsApi);

      const cellBlocks = new TableCellBlocks({
        api,
        gridElement: grid,
        tableBlockId: 'table-1',
        model,
      });

      // User drags the image above the text: DOM order changes, then
      // block-moved fires.
      const imgHolder = holders.get('img');

      if (!imgHolder) {
        throw new Error('missing holder');
      }
      container.insertBefore(imgHolder, container.firstChild);

      const handler = getBlockChangedHandler(eventsApi.on);

      handler({
        event: {
          type: 'block-moved',
          detail: {
            target: { id: 'img', holder: imgHolder },
          },
        },
      });

      expect(model.getCellBlocks(0, 0)).toEqual(['img', 'b1']);

      cellBlocks.destroy();
    });

    it('block-moved to ANOTHER cell within the grid moves the model entry to that cell', () => {
      const model = new TableModel({
        withHeadings: false,
        withHeadingColumn: false,
        content: [[{ blocks: [] }, { blocks: [] }]],
      });

      model.addBlockToCell(0, 0, 'img');
      model.addBlockToCell(0, 1, 'b1');

      const { grid, holders } = buildGrid(['img']);

      // Second cell in the same row
      const row = grid.querySelector(`[${ROW_ATTR}]`);

      if (!row) {
        throw new Error('missing row');
      }
      const cell2 = document.createElement('div');

      cell2.setAttribute(CELL_ATTR, '');
      cell2.setAttribute(CELL_COL_ATTR, '1');
      row.appendChild(cell2);

      const container2 = document.createElement('div');

      container2.setAttribute(CELL_BLOCKS_ATTR, '');
      cell2.appendChild(container2);

      const b1Holder = document.createElement('div');

      b1Holder.setAttribute('data-blok-id', 'b1');
      container2.appendChild(b1Holder);

      const eventsApi = createEventsApi();
      const api = createApi(eventsApi);

      const cellBlocks = new TableCellBlocks({
        api,
        gridElement: grid,
        tableBlockId: 'table-1',
        model,
      });

      // The image holder is moved into the second cell, above b1.
      const imgHolder = holders.get('img');

      if (!imgHolder) {
        throw new Error('missing holder');
      }
      container2.insertBefore(imgHolder, b1Holder);

      const handler = getBlockChangedHandler(eventsApi.on);

      handler({
        event: {
          type: 'block-moved',
          detail: {
            target: { id: 'img', holder: imgHolder },
          },
        },
      });

      expect(model.getCellBlocks(0, 0)).toEqual([]);
      expect(model.getCellBlocks(0, 1)).toEqual(['img', 'b1']);

      cellBlocks.destroy();
    });
  });

  describe('Table.save() WYSIWYG backstop — DOM order wins over a stale model', () => {
    const TABLE_ID = 'table-order-test';

    interface RegistryBlock {
      id: string;
      holder: HTMLElement;
      parentId: string | null;
      name: string;
      preservedData: Record<string, unknown>;
    }

    /**
     * Block registry the table's mount + save() paths can resolve
     * (mirrors the harness in table-cell-editability-invariant.test.ts).
     */
    const createRegistryApi = (seedIds: string[]): {
      api: API;
      blocks: RegistryBlock[];
    } => {
      const makeHolder = (id: string): HTMLElement => {
        const holder = document.createElement('div');

        holder.setAttribute('data-blok-id', id);

        const editable = document.createElement('div');

        editable.setAttribute('contenteditable', 'true');
        holder.appendChild(editable);

        return holder;
      };

      const blocks: RegistryBlock[] = seedIds.map(id => ({
        id,
        holder: makeHolder(id),
        parentId: TABLE_ID,
        name: 'paragraph',
        preservedData: { text: id },
      }));

      let counter = 0;

      const api = {
        styles: {},
        i18n: { t: (key: string) => key },
        blocks: {
          insert: vi.fn().mockImplementation(() => {
            counter += 1;
            const block: RegistryBlock = {
              id: `synth-${counter}`,
              holder: makeHolder(`synth-${counter}`),
              parentId: null,
              name: 'paragraph',
              preservedData: { text: '' },
            };

            blocks.push(block);

            return block;
          }),
          getBlocksCount: vi.fn().mockImplementation(() => blocks.length),
          getBlockIndex: vi.fn().mockImplementation((id: string) => {
            const index = blocks.findIndex(block => block.id === id);

            return index === -1 ? undefined : index;
          }),
          getBlockByIndex: vi.fn().mockImplementation((index: number) => blocks[index]),
          getById: vi.fn().mockImplementation(
            (id: string) => blocks.find(block => block.id === id) ?? null
          ),
          getChildren: vi.fn().mockImplementation(
            (parentId: string) => blocks.filter(block => block.parentId === parentId)
          ),
          setBlockParent: vi.fn().mockImplementation((id: string, parentId: string) => {
            const block = blocks.find(candidate => candidate.id === id);

            if (block) {
              block.parentId = parentId;
            }
          }),
          delete: vi.fn(),
          getCurrentBlockIndex: vi.fn().mockReturnValue(0),
          transactWithoutCapture: vi.fn((fn: () => void) => fn()),
        },
        events: { on: vi.fn(), off: vi.fn() },
        caret: { setToBlock: vi.fn(() => true) },
      } as unknown as API;

      return { api, blocks };
    };

    const createOptions = (
      api: API,
      content: CellContent[][]
    ): BlockToolConstructorOptions<TableData, TableConfig> => ({
      data: { withHeadings: false, withHeadingColumn: false, content },
      config: {},
      api,
      readOnly: false,
      block: { id: TABLE_ID } as never,
    });

    let mountRoot: HTMLElement;

    beforeEach(() => {
      mountRoot = document.createElement('div');
      document.body.appendChild(mountRoot);
    });

    afterEach(() => {
      mountRoot.remove();
    });

    const cellBlocksOf = (saved: TableData, row: number, col: number): string[] => {
      const cell = saved.content[row][col];

      if (typeof cell === 'string' || !('blocks' in cell)) {
        throw new Error('expected block-reference cell shape');
      }

      return cell.blocks;
    };

    it('saves the visible DOM order even when a rogue path reordered holders without syncing the model', () => {
      const { api, blocks } = createRegistryApi(['m1', 'm2']);
      const table = new Table(createOptions(api, [[{ blocks: ['m1', 'm2'] }]]));
      const element = table.render();

      mountRoot.appendChild(element);
      table.rendered();

      // Simulate a code path that reorders the DOM without updating the
      // model or firing block events: m2's holder is moved above m1's.
      const m1 = blocks.find(block => block.id === 'm1');
      const m2 = blocks.find(block => block.id === 'm2');

      if (!m1 || !m2 || !m2.holder.parentElement) {
        throw new Error('holders not mounted');
      }
      m2.holder.parentElement.insertBefore(m2.holder, m1.holder);

      expect(cellBlocksOf(table.save(element), 0, 0)).toEqual(['m2', 'm1']);
    });

    it('re-adopts a model-referenced block whose parent was lost but whose holder is mounted in the cell', () => {
      const { api, blocks } = createRegistryApi(['m1', 'm2']);
      const table = new Table(createOptions(api, [[{ blocks: ['m1', 'm2'] }]]));
      const element = table.render();

      mountRoot.appendChild(element);
      table.rendered();

      // Simulate a path that lost the parent link (the original bug family):
      // the block is still referenced by the model and mounted in the cell,
      // but parentId no longer points at this table.
      const m2 = blocks.find(block => block.id === 'm2');

      if (!m2) {
        throw new Error('missing block');
      }
      m2.parentId = null;

      // The reference must survive: dropping it silently unparents visible
      // content into a top-level orphan (images-below-the-table regression).
      expect(cellBlocksOf(table.save(element), 0, 0)).toEqual(['m1', 'm2']);
      expect(m2.parentId).toBe(TABLE_ID);
    });

    it('includes a table-owned block mounted in the cell but missing from the model, at its DOM position', () => {
      const { api, blocks } = createRegistryApi(['m1', 'm2']);
      const table = new Table(createOptions(api, [[{ blocks: ['m1', 'm2'] }]]));
      const element = table.render();

      mountRoot.appendChild(element);
      table.rendered();

      // Simulate a path that mounted + parented a block into the cell without
      // the table's model ever hearing about it (e.g. a DOM move performed by
      // core code that emits no block event).
      const m1 = blocks.find(block => block.id === 'm1');

      if (!m1 || !m1.holder.parentElement) {
        throw new Error('holders not mounted');
      }

      const ghostHolder = document.createElement('div');

      ghostHolder.setAttribute('data-blok-id', 'ghost');
      m1.holder.parentElement.insertBefore(ghostHolder, m1.holder);
      blocks.push({
        id: 'ghost',
        holder: ghostHolder,
        parentId: TABLE_ID,
        name: 'paragraph',
        preservedData: { text: '' },
      });

      // Dropping it would let the saver's view-reference guard promote the
      // visible cell block into a top-level orphan below the table.
      expect(cellBlocksOf(table.save(element), 0, 0)).toEqual(['ghost', 'm1', 'm2']);
    });

    it('still drops references owned by ANOTHER table', () => {
      const { api, blocks } = createRegistryApi(['m1', 'm2']);
      const table = new Table(createOptions(api, [[{ blocks: ['m1', 'm2'] }]]));
      const element = table.render();

      mountRoot.appendChild(element);
      table.rendered();

      const m2 = blocks.find(block => block.id === 'm2');

      if (!m2) {
        throw new Error('missing block');
      }
      m2.parentId = 'some-other-table';

      expect(cellBlocksOf(table.save(element), 0, 0)).toEqual(['m1']);
      expect(m2.parentId).toBe('some-other-table');
    });

    it('keeps the model order when a referenced block is not mounted in the cell (transitional state)', () => {
      const { api, blocks } = createRegistryApi(['m1', 'm2', 'm3']);
      const table = new Table(createOptions(api, [[{ blocks: ['m1', 'm2', 'm3'] }]]));
      const element = table.render();

      mountRoot.appendChild(element);
      table.rendered();

      // Detach one holder entirely (mid-rebuild transitional state): the
      // backstop must NOT guess an order from an incomplete DOM.
      const m2 = blocks.find(block => block.id === 'm2');

      m2?.holder.remove();

      expect(cellBlocksOf(table.save(element), 0, 0)).toEqual(['m1', 'm2', 'm3']);
    });
  });
});
