import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BlokDataHandler } from '../../../../../src/components/modules/paste/handlers/blok-data-handler';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { ToolRegistry } from '../../../../../src/components/modules/paste/tool-registry';
import type { SanitizerConfigBuilder } from '../../../../../src/components/modules/paste/sanitizer-config';
import type { Block } from '../../../../../src/components/block';
import { rememberCut } from '../../../../../src/components/utils/copy-as-link';

/**
 * Creates a minimal mock of BlokModules for testing BlokDataHandler
 */
const createBlokModulesMock = (): {
  modules: BlokModules;
  insertedBlocks: Array<{ tool: string; data: Record<string, unknown>; replace: boolean }>;
  blockInstances: Block[];
  setBlockParentMock: ReturnType<typeof vi.fn>;
  transactForToolMock: ReturnType<typeof vi.fn>;
  stopCapturingMock: ReturnType<typeof vi.fn>;
  blockLookup: Map<string, Block & { parentId: string | null; contentIds: string[] }>;
} => {
  const insertedBlocks: Array<{ tool: string; data: Record<string, unknown>; replace: boolean }> = [];
  const blockInstances: Block[] = [];
  let blockCounter = 0;

  const blockLookup = new Map<string, Block & { parentId: string | null; contentIds: string[] }>();

  const transactForToolMock = vi.fn((fn: () => void) => fn());
  const stopCapturingMock = vi.fn();

  const setBlockParentMock = vi.fn((block: Block, newParentId: string | null) => {
    const target = block as Block & { parentId: string | null; contentIds: string[] };
    const oldParentId = target.parentId;

    if (oldParentId !== null) {
      const oldParent = blockLookup.get(oldParentId);

      if (oldParent !== undefined) {
        oldParent.contentIds = oldParent.contentIds.filter(id => id !== target.id);
      }
    }
    target.parentId = newParentId;
    if (newParentId !== null) {
      const newParent = blockLookup.get(newParentId);

      if (newParent !== undefined && !newParent.contentIds.includes(target.id)) {
        newParent.contentIds = [...newParent.contentIds, target.id];
      }
    }
  });

  const modules = {
    BlockManager: {
      currentBlock: {
        tool: { isDefault: true },
        isEmpty: true,
      },
      insert: vi.fn((options: { tool: string; data: Record<string, unknown>; replace: boolean }) => {
        insertedBlocks.push(options);

        const newBlock = {
          id: `new-block-${blockCounter++}`,
          name: options.tool,
          parentId: null,
          contentIds: [] as string[],
        } as unknown as Block & { parentId: string | null; contentIds: string[] };

        blockInstances.push(newBlock);
        blockLookup.set(newBlock.id, newBlock);

        return newBlock;
      }),
      setBlockParent: setBlockParentMock,
      getBlockById: vi.fn((id: string) => blockLookup.get(id)),
      removeBlock: vi.fn(() => Promise.resolve()),
      transactForTool: transactForToolMock,
    },
    Caret: {
      setToBlock: vi.fn(),
      positions: { END: 'end' },
    },
    Tools: {
      blockTools: {
        get: vi.fn(() => ({
          sanitizeConfig: {},
        })),
      },
    },
    YjsManager: {
      stopCapturing: stopCapturingMock,
    },
  } as unknown as BlokModules;

  return {
    modules,
    insertedBlocks,
    blockInstances,
    setBlockParentMock,
    transactForToolMock,
    stopCapturingMock,
    blockLookup,
  };
};

const createToolRegistryMock = (): ToolRegistry => {
  return {
    toolsPatterns: [],
    findToolForPattern: vi.fn(),
  } as unknown as ToolRegistry;
};

const createSanitizerBuilderMock = (): SanitizerConfigBuilder => {
  return {} as unknown as SanitizerConfigBuilder;
};

describe('BlokDataHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('insertBlokBlocks hierarchy preservation', () => {
    it('restores parent-child relationships when pasting hierarchical blocks', async () => {
      const { modules, blockInstances } = createBlokModulesMock();
      const handler = new BlokDataHandler(
        modules,
        createToolRegistryMock(),
        createSanitizerBuilderMock(),
        { sanitizer: {} }
      );

      /**
       * Simulate paste data from a copy of hierarchical blocks:
       * - parent-1 has children child-1, child-2
       * - child-1 and child-2 have parentId: parent-1
       */
      const pasteData = JSON.stringify([
        {
          id: 'parent-1',
          tool: 'paragraph',
          data: { text: 'Parent' },
          parentId: null,
          contentIds: ['child-1', 'child-2'],
        },
        {
          id: 'child-1',
          tool: 'paragraph',
          data: { text: 'Child 1' },
          parentId: 'parent-1',
          contentIds: [],
        },
        {
          id: 'child-2',
          tool: 'paragraph',
          data: { text: 'Child 2' },
          parentId: 'parent-1',
          contentIds: [],
        },
      ]);

      await handler.handle(pasteData, {
        canReplaceCurrentBlock: false,
      });

      // All three blocks should be inserted
      expect(blockInstances).toHaveLength(3);

      // Blocks are inserted in DOCUMENT ORDER (parent before its children) so
      // flow-nested blocks (lists, toggle/callout/column children) keep their
      // relative position. Only table cells are inserted children-first
      // (see the table-remap test below).
      const newParent = blockInstances[0];
      const newChild1 = blockInstances[1];
      const newChild2 = blockInstances[2];

      // The newly inserted parent block should have contentIds pointing to new child block IDs
      expect(newParent.contentIds).toContain(newChild1.id);
      expect(newParent.contentIds).toContain(newChild2.id);

      // The newly inserted child blocks should have parentId pointing to new parent block ID
      expect(newChild1.parentId).toBe(newParent.id);
      expect(newChild2.parentId).toBe(newParent.id);
    });

    it('inserts flow-nested blocks in document order so a child never precedes its parent', async () => {
      // Regression: pasting nested Notion content (e.g. a bulleted list with a
      // sub-item) scrambled document order — the two-pass insert put ALL
      // children first, so a nested list child rendered ABOVE its parent and the
      // whole document order collapsed. Flow-nested blocks must be inserted in
      // document order; only table cells stay children-first.
      const { modules, insertedBlocks, blockInstances } = createBlokModulesMock();
      const handler = new BlokDataHandler(
        modules,
        createToolRegistryMock(),
        createSanitizerBuilderMock(),
        { sanitizer: {} }
      );

      const pasteData = JSON.stringify([
        { id: 'p1', tool: 'list', data: { text: 'Parent', style: 'unordered' } },
        { id: 'c1', tool: 'list', data: { text: 'Child', style: 'unordered' }, parentId: 'p1' },
        { id: 'a1', tool: 'paragraph', data: { text: 'After' } },
      ]);

      await handler.handle(pasteData, { canReplaceCurrentBlock: false });

      // Insertion (and therefore document) order is preserved.
      expect(insertedBlocks.map(b => b.data.text)).toEqual(['Parent', 'Child', 'After']);

      // The child still ends up reparented under the parent.
      const [newParent, newChild] = blockInstances;

      expect(newChild.parentId).toBe(newParent.id);
    });

    it('routes parent-child restoration through BlockManager.setBlockParent instead of mutating fields directly', async () => {
      // Regression guard for the callout paste-ejection bug family. Direct
      // `newBlock.parentId =` / `parent.contentIds.push` mutations bypass DOM
      // reparent, collapsed-hidden state sync, and the Yjs parentId/contentIds
      // companion writes. The fix: route every reparent through
      // BlockManager.setBlockParent. This test locks it in by asserting the
      // canonical reparent API is called once per parent-child edge.
      const { modules, blockInstances, setBlockParentMock } = createBlokModulesMock();
      const handler = new BlokDataHandler(
        modules,
        createToolRegistryMock(),
        createSanitizerBuilderMock(),
        { sanitizer: {} }
      );

      const pasteData = JSON.stringify([
        {
          id: 'cal-1',
          tool: 'callout',
          data: { emoji: '💡', color: 'default' },
          parentId: null,
          contentIds: ['cal-child-1', 'cal-child-2'],
        },
        {
          id: 'cal-child-1',
          tool: 'paragraph',
          data: { text: 'First nested line' },
          parentId: 'cal-1',
          contentIds: [],
        },
        {
          id: 'cal-child-2',
          tool: 'paragraph',
          data: { text: 'Second nested line' },
          parentId: 'cal-1',
          contentIds: [],
        },
      ]);

      await handler.handle(pasteData, { canReplaceCurrentBlock: false });

      expect(blockInstances).toHaveLength(3);
      expect(setBlockParentMock).toHaveBeenCalledTimes(2);

      // Document order: the callout (container) is inserted before its children.
      const newCallout = blockInstances[0];
      const newChild1 = blockInstances[1];
      const newChild2 = blockInstances[2];

      expect(setBlockParentMock).toHaveBeenCalledWith(newChild1, newCallout.id);
      expect(setBlockParentMock).toHaveBeenCalledWith(newChild2, newCallout.id);

      // Side-effects through the mock mirror the real hierarchy API: children
      // end up pointing at the new callout and the callout's contentIds include them.
      expect(newChild1.parentId).toBe(newCallout.id);
      expect(newChild2.parentId).toBe(newCallout.id);
      expect(newCallout.contentIds).toContain(newChild1.id);
      expect(newCallout.contentIds).toContain(newChild2.id);
    });

    it('remaps old child block IDs in parent data before inserting the parent', async () => {
      const { modules, insertedBlocks, blockInstances } = createBlokModulesMock();
      const handler = new BlokDataHandler(
        modules,
        createToolRegistryMock(),
        createSanitizerBuilderMock(),
        { sanitizer: {} }
      );

      /**
       * Simulate pasting a table that references old child paragraph IDs in
       * data.content. The root cause of the "text outside table" bug:
       * old IDs in data.content referred to blocks already in the editor,
       * stealing them from the original table instead of using the newly pasted ones.
       */
      const pasteData = JSON.stringify([
        {
          id: 'table-1',
          tool: 'table',
          data: {
            content: [
              [{ blocks: ['child-1'] }, { blocks: ['child-2'] }],
            ],
            colWidths: [50, 50],
          },
          parentId: null,
          contentIds: ['child-1', 'child-2'],
        },
        {
          id: 'child-1',
          tool: 'paragraph',
          data: { text: 'Cell A' },
          parentId: 'table-1',
          contentIds: [],
        },
        {
          id: 'child-2',
          tool: 'paragraph',
          data: { text: 'Cell B' },
          parentId: 'table-1',
          contentIds: [],
        },
      ]);

      await handler.handle(pasteData, { canReplaceCurrentBlock: false });

      // Child paragraphs must be inserted BEFORE the table
      expect(insertedBlocks[0].tool).toBe('paragraph'); // child-1
      expect(insertedBlocks[1].tool).toBe('paragraph'); // child-2
      expect(insertedBlocks[2].tool).toBe('table');     // table last

      // new-block-0 = child-1, new-block-1 = child-2 (insertion order)
      const newChild1Id = blockInstances[0].id;
      const newChild2Id = blockInstances[1].id;

      // The table must be inserted with remapped IDs — old 'child-1'/'child-2'
      // replaced by the new IDs assigned during Pass 1 insertion
      const tableData = insertedBlocks[2].data as {
        content: Array<Array<{ blocks: string[] }>>;
      };

      expect(tableData.content[0][0].blocks).toEqual([newChild1Id]);
      expect(tableData.content[0][1].blocks).toEqual([newChild2Id]);
    });

    it('does not modify blocks that have no hierarchy information', async () => {
      const { modules, blockInstances } = createBlokModulesMock();
      const handler = new BlokDataHandler(
        modules,
        createToolRegistryMock(),
        createSanitizerBuilderMock(),
        { sanitizer: {} }
      );

      const pasteData = JSON.stringify([
        {
          id: 'block-1',
          tool: 'paragraph',
          data: { text: 'Block 1' },
        },
        {
          id: 'block-2',
          tool: 'paragraph',
          data: { text: 'Block 2' },
        },
      ]);

      await handler.handle(pasteData, {
        canReplaceCurrentBlock: false,
      });

      expect(blockInstances).toHaveLength(2);

      // Blocks without hierarchy should remain unchanged
      expect(blockInstances[0].parentId).toBeNull();
      expect(blockInstances[0].contentIds).toEqual([]);
      expect(blockInstances[1].parentId).toBeNull();
      expect(blockInstances[1].contentIds).toEqual([]);
    });

    it('handles partial hierarchy where parent was not copied', async () => {
      const { modules, blockInstances } = createBlokModulesMock();
      const handler = new BlokDataHandler(
        modules,
        createToolRegistryMock(),
        createSanitizerBuilderMock(),
        { sanitizer: {} }
      );

      /**
       * Only copying children without their parent.
       * The parentId references a block that's not in the paste data.
       */
      const pasteData = JSON.stringify([
        {
          id: 'child-1',
          tool: 'paragraph',
          data: { text: 'Child 1' },
          parentId: 'parent-1',
          contentIds: [],
        },
        {
          id: 'child-2',
          tool: 'paragraph',
          data: { text: 'Child 2' },
          parentId: 'parent-1',
          contentIds: [],
        },
      ]);

      await handler.handle(pasteData, {
        canReplaceCurrentBlock: false,
      });

      expect(blockInstances).toHaveLength(2);

      // When parent is not in paste data, children should become root-level blocks
      expect(blockInstances[0].parentId).toBeNull();
      expect(blockInstances[1].parentId).toBeNull();
    });

    it('puts blocks whose copied parent is not in the paste into the container the caret is in', async () => {
      const { modules, blockInstances, setBlockParentMock } = createBlokModulesMock();

      Object.assign(modules.BlockManager.currentBlock ?? {}, { id: 'target', parentId: 'ctr' });

      const handler = new BlokDataHandler(
        modules,
        createToolRegistryMock(),
        createSanitizerBuilderMock(),
        { sanitizer: {} }
      );

      const pasteData = JSON.stringify([
        { id: 'a', tool: 'paragraph', data: { text: 'A' }, parentId: 'gone', contentIds: [] },
        { id: 'b', tool: 'toggle', data: { text: 'B' }, parentId: 'gone', contentIds: ['b-child'] },
        { id: 'b-child', tool: 'paragraph', data: { text: 'B child' }, parentId: 'b', contentIds: [] },
      ]);

      await handler.handle(pasteData, { canReplaceCurrentBlock: false });

      expect(blockInstances).toHaveLength(3);
      expect(blockInstances[0].parentId).toBe('ctr');
      expect(blockInstances[1].parentId).toBe('ctr');
      expect(blockInstances[2].parentId).toBe(blockInstances[1].id);
      expect(setBlockParentMock).not.toHaveBeenCalledWith(blockInstances[2], 'ctr');
    });

    describe('a pasted root the caret container denies', () => {
      type Fake = Block & { parentId: string | null; contentIds: string[] };

      /** The caret sits in an empty paragraph of a tab: root > tabs-host > tab1 > target. */
      const caretInTab = (): ReturnType<typeof createBlokModulesMock> => {
        const mock = createBlokModulesMock();
        const container = (id: string, name: string, parentId: string | null, childTools: { allow?: string[]; deny?: string[] }): Fake =>
          ({ id, name, parentId, contentIds: [], tool: { childTools } }) as unknown as Fake;

        mock.blockLookup.set('tabs-host', container('tabs-host', 'tabs', null, { allow: ['tab'] }));
        mock.blockLookup.set('tab1', container('tab1', 'tab', 'tabs-host', { deny: ['tabs'] }));
        Object.assign(mock.modules.BlockManager.currentBlock ?? {}, { id: 'target', parentId: 'tab1' });

        return mock;
      };

      const tabsPaste = JSON.stringify([
        { id: 'pre', tool: 'paragraph', data: { text: 'Before' } },
        { id: 'tb', tool: 'tabs', data: {}, contentIds: ['t1', 't2'] },
        { id: 't1', tool: 'tab', data: { title: 'Alpha' }, parentId: 'tb', contentIds: ['t1p'] },
        { id: 't1p', tool: 'paragraph', data: { text: 'Alpha body' }, parentId: 't1' },
        { id: 't2', tool: 'tab', data: { title: 'Beta' }, parentId: 'tb', contentIds: ['t2p'] },
        { id: 't2p', tool: 'paragraph', data: { text: 'Beta body' }, parentId: 't2' },
        { id: 'post', tool: 'paragraph', data: { text: 'After' } },
      ]);

      it('puts the whole batch after the nearest container that allows every root', async () => {
        const { modules, insertedBlocks, blockInstances } = caretInTab();
        const handler = new BlokDataHandler(modules, createToolRegistryMock(), createSanitizerBuilderMock(), { sanitizer: {} });

        await handler.handle(tabsPaste, { canReplaceCurrentBlock: true });

        expect(insertedBlocks[0]).toEqual(expect.objectContaining({
          tool: 'paragraph',
          replace: false,
          placement: { parentId: null, afterId: 'tabs-host' },
        }));
        expect(insertedBlocks.slice(1).some(options => 'placement' in options)).toBe(false);
        expect(blockInstances.map(block => [block.name, block.parentId])).toEqual([
          ['paragraph', null],
          ['tabs', null],
          ['tab', blockInstances[1].id],
          ['paragraph', blockInstances[2].id],
          ['tab', blockInstances[1].id],
          ['paragraph', blockInstances[4].id],
          ['paragraph', null],
        ]);
      });

      it('keeps the batch in the container when it allows every root', async () => {
        const { modules, insertedBlocks, blockInstances } = caretInTab();
        const handler = new BlokDataHandler(modules, createToolRegistryMock(), createSanitizerBuilderMock(), { sanitizer: {} });

        await handler.handle(JSON.stringify([
          { id: 'a', tool: 'paragraph', data: { text: 'A' } },
          { id: 'b', tool: 'paragraph', data: { text: 'B' } },
        ]), { canReplaceCurrentBlock: false });

        expect(insertedBlocks.some(options => 'placement' in options)).toBe(false);
        expect(blockInstances.map(block => block.parentId)).toEqual(['tab1', 'tab1']);
      });

      it('never nests children under a parent that was created with another tool', async () => {
        const { modules, blockInstances } = createBlokModulesMock();
        const insert = vi.mocked(modules.BlockManager.insert);
        const realInsert = insert.getMockImplementation();

        insert.mockImplementation((options) => {
          const block = realInsert?.(options) as Block;

          if (options?.tool === 'tabs') {
            Object.assign(block, { name: 'paragraph' });
          }

          return block;
        });
        const handler = new BlokDataHandler(modules, createToolRegistryMock(), createSanitizerBuilderMock(), { sanitizer: {} });

        await handler.handle(JSON.stringify([
          { id: 'tb', tool: 'tabs', data: {}, contentIds: ['t1'] },
          { id: 't1', tool: 'tab', data: { title: 'Alpha' }, parentId: 'tb', contentIds: [] },
        ]), { canReplaceCurrentBlock: false });

        expect(blockInstances[1].parentId).not.toBe(blockInstances[0].id);
      });
    });

    it('pastes a list item whose copied parent list is not in the paste at depth 0', async () => {
      const { modules, insertedBlocks } = createBlokModulesMock();
      const handler = new BlokDataHandler(
        modules,
        createToolRegistryMock(),
        createSanitizerBuilderMock(),
        { sanitizer: {} }
      );

      const pasteData = JSON.stringify([
        { id: 'u2', tool: 'list', data: { text: 'Two', style: 'unordered', depth: 1 }, parentId: 'u1', contentIds: ['u3'] },
        { id: 'u3', tool: 'list', data: { text: 'Three', style: 'unordered', depth: 2 }, parentId: 'u2', contentIds: [] },
        { id: 'f1', tool: 'list', data: { text: 'Flat', style: 'unordered', depth: 1 } },
      ]);

      await handler.handle(pasteData, { canReplaceCurrentBlock: false });

      expect(insertedBlocks[0].data.depth).toBe(0);
      expect(insertedBlocks[1].data.depth).toBe(2);
      expect(insertedBlocks[2].data.depth).toBe(1);
    });

    it('does not replace current block when pasting hierarchical content (table+children)', async () => {
      const { modules, insertedBlocks } = createBlokModulesMock();
      const handler = new BlokDataHandler(
        modules,
        createToolRegistryMock(),
        createSanitizerBuilderMock(),
        { sanitizer: {} }
      );

      /**
       * Simulate pasting a table with two child paragraphs while the cursor is
       * on an empty default block (canReplaceCurrentBlock: true).
       *
       * Without the fix, shouldReplaceFirst would be true and the table insertion
       * would pass replace: true — but with children present, the fix forces
       * replace: false to avoid replacing one of the already-inserted child
       * paragraphs instead of the original empty block.
       */
      const pasteData = JSON.stringify([
        {
          id: 'table-1',
          tool: 'table',
          data: {
            content: [
              [{ blocks: ['child-1'] }, { blocks: ['child-2'] }],
            ],
            colWidths: [50, 50],
          },
          parentId: null,
          contentIds: ['child-1', 'child-2'],
        },
        {
          id: 'child-1',
          tool: 'paragraph',
          data: { text: 'Cell A' },
          parentId: 'table-1',
          contentIds: [],
        },
        {
          id: 'child-2',
          tool: 'paragraph',
          data: { text: 'Cell B' },
          parentId: 'table-1',
          contentIds: [],
        },
      ]);

      await handler.handle(pasteData, { canReplaceCurrentBlock: true });

      // Children inserted first (Pass 1), table last (Pass 2)
      expect(insertedBlocks[0].tool).toBe('paragraph');
      expect(insertedBlocks[1].tool).toBe('paragraph');
      expect(insertedBlocks[2].tool).toBe('table');

      // Table must NOT replace the current block — children.length > 0 disables replace
      expect(insertedBlocks[2].replace).toBe(false);
    });

    it('removes the empty caret block a table paste lands after, in the same undo step', async () => {
      const { modules, transactForToolMock } = createBlokModulesMock();
      const target = modules.BlockManager.currentBlock as Block;
      const removed: Array<{ block: Block; inTransaction: boolean }> = [];
      const inTransaction = { value: false };

      transactForToolMock.mockImplementation((fn: () => void) => {
        inTransaction.value = true;
        fn();
        inTransaction.value = false;
      });
      Object.assign(modules.BlockManager, {
        removeBlock: vi.fn((block: Block) => {
          removed.push({ block, inTransaction: inTransaction.value });

          return Promise.resolve();
        }),
      });
      const handler = new BlokDataHandler(
        modules,
        createToolRegistryMock(),
        createSanitizerBuilderMock(),
        { sanitizer: {} }
      );

      await handler.handle(JSON.stringify([
        { id: 'table-1', tool: 'table', data: { content: [[{ blocks: ['child-1'] }]] }, parentId: null, contentIds: ['child-1'] },
        { id: 'child-1', tool: 'paragraph', data: { text: 'Cell A' }, parentId: 'table-1', contentIds: [] },
      ]), { canReplaceCurrentBlock: true });

      expect(removed).toEqual([{ block: target, inTransaction: true }]);
    });

    it('restores hierarchy when pasting a flat-array table whose children have no parent field', async () => {
      const { modules, insertedBlocks, blockInstances } = createBlokModulesMock();
      const handler = new BlokDataHandler(
        modules,
        createToolRegistryMock(),
        createSanitizerBuilderMock(),
        { sanitizer: {} }
      );

      /**
       * Dodopizza-shape paste: a table block references children only via
       * `data.content[r][c].blocks = [<id>]`. The child paragraphs themselves
       * carry NO `parentId` field. Without normalization, paste classifies
       * them as roots and they end up at the top of the editor instead of
       * inside the table cells.
       */
      const pasteData = JSON.stringify([
        {
          id: 'table-1',
          tool: 'table',
          data: {
            withHeadings: false,
            content: [
              [{ blocks: ['child-1'] }, { blocks: ['child-2'] }],
            ],
          },
        },
        {
          id: 'child-1',
          tool: 'paragraph',
          data: { text: 'Cell A' },
        },
        {
          id: 'child-2',
          tool: 'paragraph',
          data: { text: 'Cell B' },
        },
      ]);

      await handler.handle(pasteData, { canReplaceCurrentBlock: false });

      // Pass 1 inserts both children before the table.
      expect(insertedBlocks[0].tool).toBe('paragraph');
      expect(insertedBlocks[1].tool).toBe('paragraph');
      expect(insertedBlocks[2].tool).toBe('table');

      const newChild1 = blockInstances[0];
      const newChild2 = blockInstances[1];
      const newTable = blockInstances[2];

      // The pasted table must own both children via contentIds, and the
      // children must point back at the table via parentId. Otherwise the
      // children render as detached top-level blocks.
      expect(newTable.contentIds).toContain(newChild1.id);
      expect(newTable.contentIds).toContain(newChild2.id);
      expect(newChild1.parentId).toBe(newTable.id);
      expect(newChild2.parentId).toBe(newTable.id);
    });

    it('wraps insertBlokBlocks work in a single BlockManager.transactForTool undo group', async () => {
      // Regression guard: multi-block paste must land in ONE Yjs undo entry,
      // not N. The Blok JSON handler wraps its children-insert + roots-insert
      // + setBlockParent reparent passes in BlockManager.transactForTool so a
      // single Cmd+Z removes every block the paste created.
      const {
        modules,
        transactForToolMock,
        setBlockParentMock,
      } = createBlokModulesMock();
      const handler = new BlokDataHandler(
        modules,
        createToolRegistryMock(),
        createSanitizerBuilderMock(),
        { sanitizer: {} }
      );

      // Track insert/setBlockParent calls that happen inside the transact body
      // vs. after it has returned. The mock runs fn() synchronously, so any
      // insert/setBlockParent call during fn() counts as "inside".
      const insertMock = modules.BlockManager.insert as ReturnType<typeof vi.fn>;
      let transactActive = false;
      let insertsInsideTransact = 0;
      let setBlockParentInsideTransact = 0;

      transactForToolMock.mockImplementationOnce((fn: () => void) => {
        transactActive = true;
        try {
          fn();
        } finally {
          transactActive = false;
        }
      });

      const originalInsertImpl = insertMock.getMockImplementation() as
        | ((options: { tool: string; data: Record<string, unknown>; replace: boolean }) => Block)
        | undefined;

      insertMock.mockImplementation((options: { tool: string; data: Record<string, unknown>; replace: boolean }) => {
        if (transactActive) {
          insertsInsideTransact++;
        }

        return originalInsertImpl!(options);
      });

      const originalSetBlockParentImpl = setBlockParentMock.getMockImplementation() as
        | ((block: Block, newParentId: string | null) => void)
        | undefined;

      setBlockParentMock.mockImplementation((block: Block, newParentId: string | null) => {
        if (transactActive) {
          setBlockParentInsideTransact++;
        }
        originalSetBlockParentImpl!(block, newParentId);
      });

      // 3-block paste: callout parent + 2 child paragraphs. Exercises
      // Pass 1 (children), Pass 2 (root), and the reparent loop — all three
      // stages must happen inside the single transactForTool call.
      const pasteData = JSON.stringify([
        {
          id: 'cal-1',
          tool: 'callout',
          data: { emoji: '💡', color: 'default' },
          parentId: null,
          contentIds: ['cal-child-1', 'cal-child-2'],
        },
        {
          id: 'cal-child-1',
          tool: 'paragraph',
          data: { text: 'First nested line' },
          parentId: 'cal-1',
          contentIds: [],
        },
        {
          id: 'cal-child-2',
          tool: 'paragraph',
          data: { text: 'Second nested line' },
          parentId: 'cal-1',
          contentIds: [],
        },
      ]);

      await handler.handle(pasteData, { canReplaceCurrentBlock: false });

      // Exactly one transactForTool call wraps the paste.
      expect(transactForToolMock).toHaveBeenCalledTimes(1);
      // Both children and the callout root inserted inside the transact.
      expect(insertsInsideTransact).toBe(3);
      // Two reparent edges happened inside the transact (one per child).
      expect(setBlockParentInsideTransact).toBe(2);
    });

    it('does not call YjsManager.stopCapturing between pasted blocks', async () => {
      // The Blok JSON handler must not fire explicit stopCapturing between
      // block inserts — doing so splits the paste into N undo entries. With
      // the transactForTool wrapper in place, grouping is handled at its
      // boundaries (before+after the whole fn), and the handler itself must
      // not call stopCapturing.
      const { modules, stopCapturingMock } = createBlokModulesMock();
      const handler = new BlokDataHandler(
        modules,
        createToolRegistryMock(),
        createSanitizerBuilderMock(),
        { sanitizer: {} }
      );

      const pasteData = JSON.stringify([
        {
          id: 'p-1',
          tool: 'paragraph',
          data: { text: 'First' },
        },
        {
          id: 'p-2',
          tool: 'paragraph',
          data: { text: 'Second' },
        },
        {
          id: 'p-3',
          tool: 'paragraph',
          data: { text: 'Third' },
        },
      ]);

      await handler.handle(pasteData, { canReplaceCurrentBlock: false });

      // The handler itself must not call stopCapturing. The transactForTool
      // mock ((fn) => fn()) bypasses the real boundary stopCapturing calls,
      // so any invocation recorded here comes from the handler's own code.
      expect(stopCapturingMock).not.toHaveBeenCalled();
    });

    it('replaces current block when pasting flat blocks (no children) with canReplaceCurrentBlock true', async () => {
      const { modules, insertedBlocks } = createBlokModulesMock();
      const handler = new BlokDataHandler(
        modules,
        createToolRegistryMock(),
        createSanitizerBuilderMock(),
        { sanitizer: {} }
      );

      const pasteData = JSON.stringify([
        {
          id: 'block-1',
          tool: 'paragraph',
          data: { text: 'Hello' },
        },
      ]);

      await handler.handle(pasteData, { canReplaceCurrentBlock: true });

      // With no hierarchy (no children), the first root block SHOULD apply replace
      expect(insertedBlocks[0].replace).toBe(true);
    });
  });

  describe('a block that copies as a link (page) pastes as a link outside its document', () => {
    const urlOf = (pageId: unknown): string => `https://x.test/editor/page/${String(pageId)}`;
    const linkText = (pageId: string, title: string): string => `<a href="${urlOf(pageId)}">${title}</a>`;

    const pageAdapter = (copyAsLink: (data: Record<string, unknown>) => { url: string; text: string } | null, settings: Record<string, unknown> = {}) => ({
      name: 'page',
      settings,
      sanitizeConfig: {},
      conversionConfig: {
        export: (data: Record<string, unknown>): string => String((data.cache as { title?: string } | undefined)?.title ?? ''),
      },
      copyAsLink,
    });

    const setup = (options: {
      liveBlocks?: Array<{ name: string; preservedData: Record<string, unknown> }>;
      copyAsLink?: (data: Record<string, unknown>) => { url: string; text: string } | null;
      settings?: Record<string, unknown>;
    } = {}): { handler: BlokDataHandler; insertedBlocks: Array<{ tool: string; data: Record<string, unknown> }>; live: Array<{ name: string; preservedData: Record<string, unknown>; tool: unknown }> } => {
      const { modules, insertedBlocks } = createBlokModulesMock();
      const page = pageAdapter(options.copyAsLink ?? ((data) => ({ url: urlOf(data.pageId), text: String((data.cache as { title?: string } | undefined)?.title ?? '') })), options.settings);
      const paragraph = { name: 'paragraph', sanitizeConfig: {}, conversionConfig: { import: 'text', export: 'text' }, settings: {}, copyAsLink: () => undefined };
      const live = (options.liveBlocks ?? []).map((block) => ({ ...block, tool: block.name === 'page' ? page : paragraph }));

      Object.assign(modules.Tools, {
        defaultTool: paragraph,
        blockTools: { get: vi.fn((name: string) => (name === 'page' ? page : paragraph)) },
      });
      Object.assign(modules.BlockManager, { blocks: live });
      Object.assign(modules, { UI: { nodes: { wrapper: document.createElement('div') } } });

      return {
        handler: new BlokDataHandler(modules, createToolRegistryMock(), createSanitizerBuilderMock(), { sanitizer: {} }),
        insertedBlocks,
        live,
      };
    };

    const pageEntry = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
      id: 'old-page',
      tool: 'page',
      data: { pageId: 'p1', cache: { title: 'Plans' } },
      ...extra,
    });

    it('turns a page entry with no cut token (another tab, an old build) into a link paragraph', async () => {
      const { handler, insertedBlocks } = setup();

      await handler.handle(JSON.stringify([pageEntry()]), { canReplaceCurrentBlock: false });

      expect(insertedBlocks.some((block) => block.tool === 'page')).toBe(false);
      expect(insertedBlocks).toEqual([expect.objectContaining({ tool: 'paragraph', data: { text: linkText('p1', 'Plans') } })]);
    });

    it('recreates the page on the first paste of a cut, and links on the second', async () => {
      const { handler, insertedBlocks } = setup();
      const payload = JSON.stringify([pageEntry({ cut: rememberCut(), link: { url: urlOf('p1'), text: 'Plans' } })]);

      await handler.handle(payload, { canReplaceCurrentBlock: false });
      await handler.handle(payload, { canReplaceCurrentBlock: false });

      expect(insertedBlocks[1]).toEqual(expect.objectContaining({ tool: 'paragraph', data: { text: linkText('p1', 'Plans') } }));
      expect(insertedBlocks[0]).toEqual(expect.objectContaining({ tool: 'page', data: { pageId: 'p1', cache: { title: 'Plans' } } }));
    });

    it('pastes a copied page as another entry point while a block for the same page is live', async () => {
      const { handler, insertedBlocks } = setup({ liveBlocks: [{ name: 'page', preservedData: { pageId: 'p1' } }] });

      await handler.handle(JSON.stringify([pageEntry({ data: { pageId: 'p1', textColor: 'red' } })]), { canReplaceCurrentBlock: false });

      expect(insertedBlocks).toEqual([expect.objectContaining({ tool: 'page', data: { pageId: 'p1', textColor: 'red' } })]);
    });

    it('keeps a cut page while the same page is live (cut, then undo), and the cut stays spent', async () => {
      const { handler, insertedBlocks, live } = setup({ liveBlocks: [{ name: 'page', preservedData: { pageId: 'p1' } }] });
      const payload = JSON.stringify([pageEntry({ cut: rememberCut(), link: { url: urlOf('p1'), text: 'Plans' } })]);

      await handler.handle(payload, { canReplaceCurrentBlock: false });
      live.splice(0, live.length);
      await handler.handle(payload, { canReplaceCurrentBlock: false });

      expect(insertedBlocks.map((block) => block.tool)).toEqual(['page', 'paragraph']);
    });

    it('does not count a different live page as the same page', async () => {
      const { handler, insertedBlocks } = setup({ liveBlocks: [{ name: 'page', preservedData: { pageId: 'other' } }] });

      await handler.handle(JSON.stringify([pageEntry({ cut: rememberCut() })]), { canReplaceCurrentBlock: false });

      expect(insertedBlocks[0].tool).toBe('page');
    });

    it('keeps every page of a cut, two entries for one page included', async () => {
      const { handler, insertedBlocks } = setup();
      const token = rememberCut();
      const payload = JSON.stringify([
        pageEntry({ id: 'a', cut: token }),
        pageEntry({ id: 'b', cut: token }),
        pageEntry({ id: 'c', cut: token, data: { pageId: 'p2', cache: { title: 'Two' } } }),
      ]);

      await handler.handle(payload, { canReplaceCurrentBlock: false });

      expect(insertedBlocks.map((block) => block.data.pageId)).toEqual(['p1', 'p1', 'p2']);
    });

    it('drops the subtree of an entry that became a link', async () => {
      const { handler, insertedBlocks } = setup();

      await handler.handle(
        JSON.stringify([
          pageEntry({ contentIds: ['kid'] }),
          { id: 'kid', tool: 'paragraph', data: { text: 'Kid' }, parentId: 'old-page' },
          { id: 'grandkid', tool: 'paragraph', data: { text: 'Grandkid' }, parentId: 'kid' },
          { id: 'after', tool: 'paragraph', data: { text: 'After' } },
        ]),
        { canReplaceCurrentBlock: false }
      );

      expect(insertedBlocks.map((block) => block.data)).toEqual([{ text: linkText('p1', 'Plans') }, { text: 'After' }]);
    });

    it('never pastes an unsafe carried link url', async () => {
      const { handler, insertedBlocks } = setup();

      await handler.handle(
        JSON.stringify([pageEntry({ link: { url: 'javascript:alert(1)', text: 'x' } })]),
        { canReplaceCurrentBlock: false }
      );

      expect(JSON.stringify(insertedBlocks)).not.toContain('javascript:');
      expect(insertedBlocks[0].data).toEqual({ text: linkText('p1', 'Plans') });
    });

    it('prefers the link the cut carried over one built from the data', async () => {
      const { handler, insertedBlocks } = setup();

      await handler.handle(
        JSON.stringify([pageEntry({ link: { url: 'https://carried.test/p1', text: 'Carried' } })]),
        { canReplaceCurrentBlock: false }
      );

      expect(insertedBlocks[0].data).toEqual({ text: '<a href="https://carried.test/p1">Carried</a>' });
    });

    it('pastes a page with nothing to link to as a non-owning page reference', async () => {
      const { handler, insertedBlocks } = setup({ copyAsLink: () => null, settings: { resolve: () => ({ title: 'Plans' }) } });

      await handler.handle(JSON.stringify([pageEntry()]), { canReplaceCurrentBlock: false });

      expect(insertedBlocks).toEqual([expect.objectContaining({ tool: 'paragraph', data: { text: '<a data-blok-page-id="p1">Page</a>' } })]);
    });

    it('pastes a page the host does not confirm as its exported text, not a reference', async () => {
      const { handler, insertedBlocks } = setup({ copyAsLink: () => null, settings: { resolve: () => null } });

      await handler.handle(JSON.stringify([pageEntry()]), { canReplaceCurrentBlock: false });

      expect(insertedBlocks).toEqual([expect.objectContaining({ tool: 'paragraph', data: { text: 'Plans' } })]);
    });

    it('falls back to the exported text when there is nothing to link to, and skips an empty one', async () => {
      const { handler, insertedBlocks } = setup({ copyAsLink: () => null });

      await handler.handle(
        JSON.stringify([pageEntry({ data: { cache: { title: 'Plans' } } }), pageEntry({ id: 'untitled', data: { cache: {} } })]),
        { canReplaceCurrentBlock: false }
      );

      expect(insertedBlocks.some((block) => block.tool === 'page')).toBe(false);
      expect(insertedBlocks).toEqual([expect.objectContaining({ tool: 'paragraph', data: { text: 'Plans' } })]);
    });
  });
});

describe('BlokDataHandler — tools the pasting editor does not have', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Editor with only the given block tools. Inserting any other tool throws,
   * as the block factory does.
   */
  const setup = (registered: string[], options: { throwsOnInsert?: string } = {}): {
    handler: BlokDataHandler;
    inserted: Array<{ tool: string; data: Record<string, unknown> }>;
    blocks: Array<Block & { parentId: string | null; contentIds: string[] }>;
  } => {
    const tools = new Set([...registered, 'stub']);
    const inserted: Array<{ tool: string; data: Record<string, unknown> }> = [];
    const blocks: Array<Block & { parentId: string | null; contentIds: string[] }> = [];
    const byId = new Map<string, Block & { parentId: string | null; contentIds: string[] }>();

    const modules = {
      BlockManager: {
        currentBlock: undefined,
        insert: vi.fn((opts: { tool: string; data: Record<string, unknown> }) => {
          if (!tools.has(opts.tool)) {
            throw new Error(`Could not compose Block. Tool «${opts.tool}» not found.`);
          }
          if (opts.tool === options.throwsOnInsert) {
            throw new Error('tool constructor failed');
          }
          inserted.push(opts);

          const block = { id: `new-${blocks.length}`, name: opts.tool, parentId: null, contentIds: [] } as unknown as Block & { parentId: string | null; contentIds: string[] };

          blocks.push(block);
          byId.set(block.id, block);

          return block;
        }),
        setBlockParent: vi.fn((block: Block, parentId: string | null) => {
          const child = byId.get(block.id);

          if (child !== undefined) {
            child.parentId = parentId;
          }
          if (parentId !== null) {
            byId.get(parentId)?.contentIds.push(block.id);
          }
        }),
        transactForTool: vi.fn((fn: () => void) => fn()),
      },
      Caret: { setToBlock: vi.fn(), positions: { END: 'end' } },
      Tools: {
        stubTool: 'stub',
        unavailable: new Map(),
        getAllInlineToolsSanitizeConfig: vi.fn(() => ({ b: {}, a: { href: true } })),
        blockTools: {
          get: vi.fn((name: string) => (tools.has(name) ? { sanitizeConfig: {} } : undefined)),
        },
      },
      YjsManager: { stopCapturing: vi.fn() },
    } as unknown as BlokModules;

    const handler = new BlokDataHandler(modules, createToolRegistryMock(), createSanitizerBuilderMock(), { sanitizer: {} });

    return { handler, inserted, blocks };
  };

  it('pastes every block when one tool is missing, the missing one as a stub that keeps its children', async () => {
    const { handler, inserted, blocks } = setup(['paragraph']);

    await handler.handle(JSON.stringify([
      { id: 'b', tool: 'paragraph', data: { text: 'Before' } },
      { id: 't', tool: 'toggle', data: { text: '<b>Toggle</b>' }, contentIds: ['c'] },
      { id: 'c', tool: 'paragraph', data: { text: 'Child' }, parentId: 't' },
      { id: 'a', tool: 'paragraph', data: { text: 'After' } },
    ]), { canReplaceCurrentBlock: false });

    expect(inserted.map(entry => entry.tool)).toEqual(['paragraph', 'stub', 'paragraph', 'paragraph']);
    expect(inserted[1].data).toEqual({
      savedData: { type: 'toggle', data: { text: '<b>Toggle</b>' } },
      title: 'Toggle',
    });
    expect(blocks[2].parentId).toBe(blocks[1].id);
    expect(inserted[3].data).toEqual({ text: 'After' });
  });

  it('sanitizes the data of a block whose tool is missing before keeping it in a stub', async () => {
    const { handler, inserted } = setup(['paragraph']);

    await handler.handle(JSON.stringify([
      { id: 't', tool: 'toggle', data: { text: '<img src="x" onerror="alert(1)"><b>Hi</b> <a href="javascript:alert(1)">x</a>' } },
    ]), { canReplaceCurrentBlock: false });

    const text = (inserted[0].data as { savedData: { data: { text: string } } }).savedData.data.text;

    expect(text).not.toMatch(/onerror|javascript:|<img/i);
    expect(text).toContain('<b>Hi</b>');
  });

  it('sanitizes the data of a copied stub whose tool is still missing', async () => {
    const { handler, inserted } = setup(['paragraph']);

    await handler.handle(JSON.stringify([
      { id: 't', tool: 'stub', data: { type: 'toggle', data: { text: '<img src="x" onerror="alert(1)">Hi' } } },
    ]), { canReplaceCurrentBlock: false });

    const text = (inserted[0].data as { savedData: { data: { text: string } } }).savedData.data.text;

    expect(text).not.toMatch(/onerror|<img/i);
  });

  it('unwraps a copied stub whose tool this editor has', async () => {
    const { handler, inserted } = setup(['paragraph', 'toggle']);

    await handler.handle(JSON.stringify([
      { id: 't', tool: 'stub', data: { id: 't', type: 'toggle', data: { text: 'Toggle' } } },
    ]), { canReplaceCurrentBlock: false });

    expect(inserted).toEqual([expect.objectContaining({ tool: 'toggle', data: { text: 'Toggle' } })]);
  });

  it('pastes a copied stub whose tool is still missing as one stub, not a stub of a stub', async () => {
    const { handler, inserted } = setup(['paragraph']);

    await handler.handle(JSON.stringify([
      { id: 't', tool: 'stub', data: { id: 't', type: 'toggle', data: { text: 'Toggle' } } },
    ]), { canReplaceCurrentBlock: false });

    expect(inserted).toEqual([expect.objectContaining({
      tool: 'stub',
      data: { savedData: { type: 'toggle', data: { text: 'Toggle' } }, title: 'Toggle' },
    })]);
  });

  it('pastes a block whose tool throws on insert as a stub and keeps going', async () => {
    const { handler, inserted } = setup(['paragraph', 'callout'], { throwsOnInsert: 'callout' });

    await handler.handle(JSON.stringify([
      { id: 'co', tool: 'callout', data: { emoji: 'x' } },
      { id: 'a', tool: 'paragraph', data: { text: 'After' } },
    ]), { canReplaceCurrentBlock: false });

    expect(inserted.map(entry => entry.tool)).toEqual(['stub', 'paragraph']);
    expect(inserted[0].data).toEqual(expect.objectContaining({ savedData: { type: 'callout', data: { emoji: 'x' } } }));
  });
});

describe('BlokDataHandler — a database row pasted without its database', () => {
  type Fake = Block & { parentId: string | null; contentIds: string[] };

  const setup = (caretParentId: string | null): ReturnType<typeof createBlokModulesMock> => {
    const mock = createBlokModulesMock();
    const paragraph = { name: 'paragraph', sanitizeConfig: {}, conversionConfig: { import: 'text', export: 'text' }, settings: {}, isDefault: true };
    const container = (id: string, name: string, parentId: string | null, childTools: { allow?: string[]; deny?: string[] }): Fake =>
      ({ id, name, parentId, contentIds: [], tool: { childTools } }) as unknown as Fake;

    mock.blockLookup.set('db', container('db', 'database', null, { allow: ['database-row', 'database', 'tabs', 'database-comment'] }));
    mock.blockLookup.set('r2', container('r2', 'database-row', 'db', { deny: ['database-row'] }));
    Object.assign(mock.modules.Tools, {
      defaultTool: paragraph,
      blockTools: { get: vi.fn((name: string) => (name === 'paragraph' ? paragraph : { name, sanitizeConfig: {} })) },
    });
    Object.assign(mock.modules.BlockManager.currentBlock ?? {}, { id: 'target', parentId: caretParentId });

    return mock;
  };

  const rowCopy = (title: string): string => JSON.stringify([
    { id: 'r1', tool: 'database-row', title, data: { properties: { 'p-title': 'Alpha' }, position: 'a0' }, parentId: 'db-old', contentIds: ['b1'] },
    { id: 'b1', tool: 'paragraph', data: { text: 'Body' }, parentId: 'r1', contentIds: [] },
  ]);

  it('lands as a paragraph with its title, and its page body follows it, where no database takes it', async () => {
    const { modules, insertedBlocks, blockInstances } = setup(null);
    const handler = new BlokDataHandler(modules, createToolRegistryMock(), createSanitizerBuilderMock(), { sanitizer: {} });

    await handler.handle(rowCopy('Alpha & <b>co</b>'), { canReplaceCurrentBlock: true });

    expect(insertedBlocks.map((block) => [block.tool, block.data])).toEqual([
      ['paragraph', { text: 'Alpha &amp; &lt;b&gt;co&lt;/b&gt;' }],
      ['paragraph', { text: 'Body' }],
    ]);
    expect(blockInstances.map((block) => (block as Fake).parentId)).toEqual([null, null]);
  });

  it('stays a row when it lands in a database, from a row page body', async () => {
    const { modules, insertedBlocks, blockInstances } = setup('r2');
    const handler = new BlokDataHandler(modules, createToolRegistryMock(), createSanitizerBuilderMock(), { sanitizer: {} });

    await handler.handle(rowCopy('Alpha'), { canReplaceCurrentBlock: false });

    expect(insertedBlocks.map((block) => block.tool)).toEqual(['database-row', 'paragraph']);
    expect(blockInstances[1].parentId).toBe(blockInstances[0].id);
  });
});
