import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { BlockHierarchy } from '../../../../../src/components/modules/blockManager/hierarchy';
import { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import type { BlocksStore } from '../../../../../src/components/modules/blockManager/types';
import { Blocks } from '../../../../../src/components/blocks';
import type { Block } from '../../../../../src/components/block';

/**
 * Create a mock Block with hierarchy properties
 */
const createMockBlock = (options: {
  id?: string;
  parentId?: string | null;
  contentIds?: string[];
} = {}): Block => {
  const holder = document.createElement('div');
  holder.setAttribute('data-blok-element', '');

  const block = {
    id: options.id ?? `block-${Math.random().toString(16).slice(2)}`,
    holder,
    parentId: options.parentId ?? null,
    contentIds: options.contentIds ?? [],
    call: vi.fn(),
  } as unknown as Block;

  return block;
};

/**
 * Create a BlocksStore with mock blocks and initialize repository
 */
const createRepositoryWithBlocks = (
  blockConfigs: Array<{ id: string; parentId?: string | null; contentIds?: string[] }>
): BlockRepository => {
  const workingArea = document.createElement('div');
  const blocksStore = new Blocks(workingArea);

  for (const config of blockConfigs) {
    const block = createMockBlock(config);
    blocksStore.push(block);
  }

  const repository = new BlockRepository();
  // Cast to BlocksStore since Blocks has array-like access but missing the index signature in type definition
  repository.initialize(blocksStore as BlocksStore);

  return repository;
};

describe('BlockHierarchy', () => {
  let repository: BlockRepository;
  let hierarchy: BlockHierarchy;
  let workingArea: HTMLElement;

  /**
   * Helper to get a block from repository or throw if it doesn't exist
   * This replaces non-null assertions (!) with proper error handling
   */
  const requireBlock = (blockId: string): Block => {
    const block = repository.getBlockById(blockId);
    if (!block) {
      throw new Error(`Block ${blockId} should exist in repository`);
    }
    return block;
  };

  beforeEach(() => {
    workingArea = document.createElement('div');
    document.body.appendChild(workingArea);
  });

  afterEach(() => {
    workingArea.remove();
  });

  describe('getBlockDepth', () => {
    beforeEach(() => {
      repository = createRepositoryWithBlocks([
        { id: 'root-1', parentId: null },
        { id: 'child-1', parentId: 'root-1' },
        { id: 'child-2', parentId: 'root-1' },
        { id: 'grandchild-1', parentId: 'child-1' },
        { id: 'root-2', parentId: null },
      ]);
      hierarchy = new BlockHierarchy(repository);
    });

    it('returns 0 for root-level blocks', () => {
      const rootBlock = requireBlock('root-1');

      expect(hierarchy.getBlockDepth(rootBlock)).toBe(0);
    });

    it('returns 1 for first-level children', () => {
      const childBlock = requireBlock('child-1');

      expect(hierarchy.getBlockDepth(childBlock)).toBe(1);
    });

    it('returns 2 for second-level children (grandchildren)', () => {
      const grandchildBlock = requireBlock('grandchild-1');

      expect(hierarchy.getBlockDepth(grandchildBlock)).toBe(2);
    });

    it('returns 0 for another root-level block', () => {
      const rootBlock = requireBlock('root-2');

      expect(hierarchy.getBlockDepth(rootBlock)).toBe(0);
    });

    it('returns 0 for block with null parentId', () => {
      const block = createMockBlock({ id: 'no-parent', parentId: null });

      expect(hierarchy.getBlockDepth(block)).toBe(0);
    });

    it('handles circular reference gracefully by returning current depth', () => {
      // Create a block that references itself as parent
      // Use a mock block and override parentId to simulate circular reference
      const circularBlock = createMockBlock({ id: 'circular' }) as Block & { parentId: string };
      circularBlock.parentId = 'circular';

      // Should not enter infinite loop
      expect(hierarchy.getBlockDepth(circularBlock)).toBe(0);
    });

    it('returns current depth when parent is not found in repository', () => {
      const orphanBlock = createMockBlock({ id: 'orphan', parentId: 'non-existent-parent' });

      expect(hierarchy.getBlockDepth(orphanBlock)).toBe(0);
    });

    it('correctly calculates depth for deeply nested hierarchy', () => {
      repository = createRepositoryWithBlocks([
        { id: 'level-0', parentId: null },
        { id: 'level-1', parentId: 'level-0' },
        { id: 'level-2', parentId: 'level-1' },
        { id: 'level-3', parentId: 'level-2' },
        { id: 'level-4', parentId: 'level-3' },
        { id: 'level-5', parentId: 'level-4' },
      ]);
      hierarchy = new BlockHierarchy(repository);

      const level5Block = requireBlock('level-5');

      expect(hierarchy.getBlockDepth(level5Block)).toBe(5);
    });
  });

  describe('setBlockParent', () => {
    beforeEach(() => {
      repository = createRepositoryWithBlocks([
        { id: 'parent-1', parentId: null, contentIds: [] },
        { id: 'parent-2', parentId: null, contentIds: [] },
        { id: 'child', parentId: 'parent-1', contentIds: [] },
      ]);
      hierarchy = new BlockHierarchy(repository);
    });

    it('updates block parentId', () => {
      const block = requireBlock('child');
      requireBlock('parent-2');

      hierarchy.setBlockParent(block, 'parent-2');

      expect(block.parentId).toBe('parent-2');
    });

    it('removes block from old parent contentIds', () => {
      const block = requireBlock('child');
      const oldParent = requireBlock('parent-1');

      // Setup: add child to parent-1's contentIds
      oldParent.contentIds = ['child'];

      hierarchy.setBlockParent(block, 'parent-2');

      expect(oldParent.contentIds).not.toContain('child');
    });

    it('adds block to new parent contentIds', () => {
      const block = requireBlock('child');
      const newParent = requireBlock('parent-2');

      hierarchy.setBlockParent(block, 'parent-2');

      expect(newParent.contentIds).toContain('child');
    });

    it('does not duplicate block in new parent contentIds if already present', () => {
      const block = requireBlock('child');
      const newParent = requireBlock('parent-2');

      // Pre-add child to new parent
      newParent.contentIds = ['child'];

      hierarchy.setBlockParent(block, 'parent-2');

      // Should only appear once
      const count = newParent.contentIds.filter(id => id === 'child').length;
      expect(count).toBe(1);
    });

    it('sets parentId to null when newParentId is null', () => {
      const block = requireBlock('child');
      const oldParent = requireBlock('parent-1');

      oldParent.contentIds = ['child'];

      hierarchy.setBlockParent(block, null);

      expect(block.parentId).toBeNull();
      expect(oldParent.contentIds).not.toContain('child');
    });

    it('handles old parent that does not exist', () => {
      const block = requireBlock('child');
      const newParent = requireBlock('parent-2');

      // Block has a parentId that doesn't correspond to any block
      block.parentId = 'non-existent-parent';

      hierarchy.setBlockParent(block, 'parent-2');

      expect(block.parentId).toBe('parent-2');
      expect(newParent.contentIds).toContain('child');
    });

    it('handles new parent that does not exist', () => {
      const block = requireBlock('child');
      const oldParent = requireBlock('parent-1');

      oldParent.contentIds = ['child'];

      hierarchy.setBlockParent(block, 'non-existent-parent');

      expect(block.parentId).toBe('non-existent-parent');
      expect(oldParent.contentIds).not.toContain('child');
    });

    it('updates visual indentation after reparenting', () => {
      const block = requireBlock('child');
      const oldParent = requireBlock('parent-1');

      oldParent.contentIds = ['child'];

      hierarchy.setBlockParent(block, null);

      // Should have called updateBlockIndentation
      expect(block.holder.style.marginLeft).toBe('');
      expect(block.holder).toHaveAttribute('data-blok-depth', '0');
    });
  });

  describe('updateBlockIndentation', () => {
    beforeEach(() => {
      repository = createRepositoryWithBlocks([
        { id: 'root', parentId: null },
        { id: 'child', parentId: 'root' },
        { id: 'grandchild', parentId: 'child' },
      ]);
      hierarchy = new BlockHierarchy(repository);
    });

    it('sets no margin for root-level blocks (depth 0)', () => {
      const block = requireBlock('root');

      hierarchy.updateBlockIndentation(block);

      expect(block.holder.style.marginLeft).toBe('');
      expect(block.holder).toHaveAttribute('data-blok-depth', '0');
    });

    it('sets 24px margin for depth 1', () => {
      const block = requireBlock('child');

      hierarchy.updateBlockIndentation(block);

      expect(block.holder.style.marginLeft).toBe('24px');
      expect(block.holder).toHaveAttribute('data-blok-depth', '1');
    });

    it('sets 48px margin for depth 2', () => {
      const block = requireBlock('grandchild');

      hierarchy.updateBlockIndentation(block);

      expect(block.holder.style.marginLeft).toBe('48px');
      expect(block.holder).toHaveAttribute('data-blok-depth', '2');
    });

    it('uses 24px per level of depth', () => {
      // Create a deeply nested structure
      repository = createRepositoryWithBlocks([
        { id: 'l0', parentId: null },
        { id: 'l1', parentId: 'l0' },
        { id: 'l2', parentId: 'l1' },
        { id: 'l3', parentId: 'l2' },
        { id: 'l4', parentId: 'l3' },
      ]);
      hierarchy = new BlockHierarchy(repository);

      const l4Block = requireBlock('l4');
      hierarchy.updateBlockIndentation(l4Block);

      expect(blockAtDepth(4)).toBe('96px');
    });

    const blockAtDepth = (depth: number): string => {
      const block = repository.blocks[depth];
      hierarchy.updateBlockIndentation(block);
      return block.holder.style.marginLeft;
    }
  });
});
