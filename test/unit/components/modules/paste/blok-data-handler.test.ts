import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BlokDataHandler } from '../../../../../src/components/modules/paste/handlers/blok-data-handler';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { ToolRegistry } from '../../../../../src/components/modules/paste/tool-registry';
import type { SanitizerConfigBuilder } from '../../../../../src/components/modules/paste/sanitizer-config';
import type { Block } from '../../../../../src/components/block';

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
        blockLookup.set(newBlock.id as unknown as string, newBlock);

        return newBlock;
      }),
      setBlockParent: setBlockParentMock,
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

      // Children are inserted first (Pass 1), then the parent (Pass 2)
      const newChild1 = blockInstances[0];
      const newChild2 = blockInstances[1];
      const newParent = blockInstances[2];

      // The newly inserted parent block should have contentIds pointing to new child block IDs
      expect(newParent.contentIds).toContain(newChild1.id);
      expect(newParent.contentIds).toContain(newChild2.id);

      // The newly inserted child blocks should have parentId pointing to new parent block ID
      expect(newChild1.parentId).toBe(newParent.id);
      expect(newChild2.parentId).toBe(newParent.id);
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

      const newChild1 = blockInstances[0];
      const newChild2 = blockInstances[1];
      const newCallout = blockInstances[2];

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
});
