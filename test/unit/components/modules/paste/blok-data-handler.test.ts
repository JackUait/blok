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
} => {
  const insertedBlocks: Array<{ tool: string; data: Record<string, unknown>; replace: boolean }> = [];
  const blockInstances: Block[] = [];
  let blockCounter = 0;

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
        } as unknown as Block;

        blockInstances.push(newBlock);

        return newBlock;
      }),
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
  } as unknown as BlokModules;

  return { modules, insertedBlocks, blockInstances };
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

      // The newly inserted parent block should have contentIds pointing to new child block IDs
      const newParent = blockInstances[0];
      const newChild1 = blockInstances[1];
      const newChild2 = blockInstances[2];

      expect(newParent.contentIds).toContain(newChild1.id);
      expect(newParent.contentIds).toContain(newChild2.id);

      // The newly inserted child blocks should have parentId pointing to new parent block ID
      expect(newChild1.parentId).toBe(newParent.id);
      expect(newChild2.parentId).toBe(newParent.id);
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
  });
});
