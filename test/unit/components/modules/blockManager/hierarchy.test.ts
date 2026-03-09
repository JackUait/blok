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

    it('calls onParentChanged callback when parent is set', () => {
      const onParentChanged = vi.fn();

      hierarchy = new BlockHierarchy(repository, onParentChanged);

      const block = requireBlock('child');

      hierarchy.setBlockParent(block, 'parent-2');

      expect(onParentChanged).toHaveBeenCalledWith('parent-2');
      expect(onParentChanged).toHaveBeenCalledTimes(1);
    });

    it('does not call onParentChanged when parent is null', () => {
      const onParentChanged = vi.fn();

      hierarchy = new BlockHierarchy(repository, onParentChanged);

      const block = requireBlock('child');

      hierarchy.setBlockParent(block, null);

      expect(onParentChanged).not.toHaveBeenCalled();
    });

    it('hides new child block when parent toggle is collapsed (existing children have hidden class)', () => {
      // Simulate a collapsed toggle: parent-1 has an existing child with 'hidden' class
      repository = createRepositoryWithBlocks([
        { id: 'toggle', parentId: null, contentIds: ['existing-child'] },
        { id: 'existing-child', parentId: 'toggle', contentIds: [] },
        { id: 'new-child', parentId: null, contentIds: [] },
        { id: 'after-toggle', parentId: null, contentIds: [] },
      ]);
      hierarchy = new BlockHierarchy(repository);

      // Mark the existing child as hidden (toggle is collapsed)
      const existingChild = requireBlock('existing-child');
      existingChild.holder.classList.add('hidden');

      const newChild = requireBlock('new-child');

      // Assign new-child to the collapsed toggle
      hierarchy.setBlockParent(newChild, 'toggle');

      // new-child should be hidden because the toggle is collapsed
      expect(newChild.holder.classList.contains('hidden')).toBe(true);
    });

    it('does not hide new child block when parent toggle is expanded (existing children are visible)', () => {
      repository = createRepositoryWithBlocks([
        { id: 'toggle', parentId: null, contentIds: ['existing-child'] },
        { id: 'existing-child', parentId: 'toggle', contentIds: [] },
        { id: 'new-child', parentId: null, contentIds: [] },
      ]);
      hierarchy = new BlockHierarchy(repository);

      // Existing child is visible (toggle is expanded)
      // new-child's holder has no 'hidden' class to start with

      const newChild = requireBlock('new-child');

      hierarchy.setBlockParent(newChild, 'toggle');

      // new-child should remain visible because the toggle is expanded
      expect(newChild.holder.classList.contains('hidden')).toBe(false);
    });

    it('does not hide new child block when parent has no existing children (cannot determine state)', () => {
      repository = createRepositoryWithBlocks([
        { id: 'toggle', parentId: null, contentIds: [] },
        { id: 'new-child', parentId: null, contentIds: [] },
      ]);
      hierarchy = new BlockHierarchy(repository);

      const newChild = requireBlock('new-child');

      hierarchy.setBlockParent(newChild, 'toggle');

      // No existing children to infer collapsed state from, so leave visible
      expect(newChild.holder.classList.contains('hidden')).toBe(false);
    });

    it('calls onParentChanged for each setBlockParent call', () => {
      const onParentChanged = vi.fn();

      hierarchy = new BlockHierarchy(repository, onParentChanged);

      const block = requireBlock('child');

      hierarchy.setBlockParent(block, 'parent-2');
      hierarchy.setBlockParent(block, 'parent-1');

      expect(onParentChanged).toHaveBeenCalledTimes(2);
      expect(onParentChanged).toHaveBeenNthCalledWith(1, 'parent-2');
      expect(onParentChanged).toHaveBeenNthCalledWith(2, 'parent-1');
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

    it('skips visual indentation for blocks inside table cells', () => {
      const cellBlocksContainer = document.createElement('div');
      cellBlocksContainer.setAttribute('data-blok-table-cell-blocks', '');

      const cellBlock = requireBlock('child'); // parentId = 'root' → depth 1

      cellBlocksContainer.appendChild(cellBlock.holder);

      hierarchy.updateBlockIndentation(cellBlock);

      expect(cellBlock.holder.style.marginLeft).toBe('');
      expect(cellBlock.holder).toHaveAttribute('data-blok-depth', '0');
    });

    it('does NOT apply margin-left when block.holder is inside [data-blok-toggle-children]', () => {
      // child has parentId = 'root', so depth = 1, which would normally yield 24px.
      // But because its holder is physically inside a toggle-children container it
      // should receive '' instead.
      const toggleContainer = document.createElement('div');
      toggleContainer.setAttribute('data-blok-toggle-children', '');

      const block = requireBlock('child'); // depth 1 normally → 24px
      toggleContainer.appendChild(block.holder);

      hierarchy.updateBlockIndentation(block);

      expect(block.holder.style.marginLeft).toBe('');
    });
  });

  describe('setBlockParent() DOM placement', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('moves block.holder into the [data-blok-toggle-children] container when the parent has one', () => {
      repository = createRepositoryWithBlocks([
        { id: 'toggle-parent', parentId: null, contentIds: [] },
        { id: 'new-child', parentId: null, contentIds: [] },
      ]);
      hierarchy = new BlockHierarchy(repository);

      const toggleParent = requireBlock('toggle-parent');
      const newChild = requireBlock('new-child');

      // Attach a toggle-children container to the parent holder
      const toggleContainer = document.createElement('div');
      toggleContainer.setAttribute('data-blok-toggle-children', '');
      toggleParent.holder.appendChild(toggleContainer);

      // Place the child somewhere outside the parent
      const externalWrapper = document.createElement('div');
      externalWrapper.appendChild(newChild.holder);

      hierarchy.setBlockParent(newChild, 'toggle-parent');

      expect(toggleContainer.contains(newChild.holder)).toBe(true);
      expect(externalWrapper.contains(newChild.holder)).toBe(false);
    });

    it('moves block.holder back after old parent holder when clearing parent and block was inside [data-blok-toggle-children]', () => {
      repository = createRepositoryWithBlocks([
        { id: 'old-toggle', parentId: null, contentIds: ['child-in-toggle'] },
        { id: 'child-in-toggle', parentId: 'old-toggle', contentIds: [] },
      ]);
      hierarchy = new BlockHierarchy(repository);

      const oldToggle = requireBlock('old-toggle');
      const child = requireBlock('child-in-toggle');

      // Set up DOM: old toggle holder and the child sit in an editor wrapper;
      // the child's holder is inside the toggle-children container
      const editorWrapper = document.createElement('div');
      const toggleContainer = document.createElement('div');
      toggleContainer.setAttribute('data-blok-toggle-children', '');
      oldToggle.holder.appendChild(toggleContainer);
      toggleContainer.appendChild(child.holder);

      const sibling = document.createElement('div');
      editorWrapper.appendChild(oldToggle.holder);
      editorWrapper.appendChild(sibling);

      hierarchy.setBlockParent(child, null);

      // child.holder should be immediately after oldToggle.holder, not inside it
      expect(oldToggle.holder.nextSibling).toBe(child.holder);
      expect(toggleContainer.contains(child.holder)).toBe(false);
    });

    it('places extracted block at flat-array position when other blocks come between the toggle and the drop target', () => {
      // Mimics what happens during drag: moveBlocks() has already updated the flat array
      // so child is at index 3 (after G), but child.holder is still physically inside the
      // toggle's [data-blok-toggle-children] container.
      // setBlockParent must honour the flat-array order, not always place right after the toggle.
      repository = createRepositoryWithBlocks([
        { id: 'toggle', parentId: null, contentIds: ['childD'] },
        { id: 'childD', parentId: 'toggle', contentIds: [] },
        { id: 'G', parentId: null, contentIds: [] },
        { id: 'child', parentId: 'toggle', contentIds: [] },
      ]);
      hierarchy = new BlockHierarchy(repository);

      const toggle = requireBlock('toggle');
      const childD = requireBlock('childD');
      const G = requireBlock('G');
      const child = requireBlock('child');

      // DOM: toggle and G in editorWrapper; childD and child inside toggle's container
      const editorWrapper = document.createElement('div');
      const toggleContainer = document.createElement('div');
      toggleContainer.setAttribute('data-blok-toggle-children', '');
      toggle.holder.appendChild(toggleContainer);
      toggleContainer.appendChild(childD.holder);
      toggleContainer.appendChild(child.holder);
      editorWrapper.appendChild(toggle.holder);
      editorWrapper.appendChild(G.holder);

      hierarchy.setBlockParent(child, null);

      // child.holder must land AFTER G.holder (flat-array index 3, G is at 2)
      expect(G.holder.nextSibling).toBe(child.holder);
      expect(toggleContainer.contains(child.holder)).toBe(false);
    });

    it('inserts block at correct DOM position (between existing siblings) based on flat array order', () => {
      // Scenario: toggle has C1 and C2 as children. A is being dropped between C1 and C2.
      // The flat array (repository.blocks) is already [toggle, C1, A, C2] (moveBlocks ran first).
      // setBlockParent(A, toggle.id) must produce DOM order [C1, A, C2], NOT [C1, C2, A].
      repository = createRepositoryWithBlocks([
        { id: 'toggle', parentId: null, contentIds: ['c1', 'c2'] },
        { id: 'c1', parentId: 'toggle', contentIds: [] },
        { id: 'a', parentId: null, contentIds: [] },
        { id: 'c2', parentId: 'toggle', contentIds: [] },
      ]);
      hierarchy = new BlockHierarchy(repository);

      const toggle = requireBlock('toggle');
      const c1 = requireBlock('c1');
      const a = requireBlock('a');
      const c2 = requireBlock('c2');

      // Build DOM: toggle holds a toggle-children container with C1 and C2 already in it.
      // A's holder is outside (it will be moved in by setBlockParent).
      const editorWrapper = document.createElement('div');
      const toggleContainer = document.createElement('div');
      toggleContainer.setAttribute('data-blok-toggle-children', '');
      toggleContainer.appendChild(c1.holder);
      toggleContainer.appendChild(c2.holder);
      toggle.holder.appendChild(toggleContainer);
      editorWrapper.appendChild(toggle.holder);
      editorWrapper.appendChild(a.holder);

      hierarchy.setBlockParent(a, 'toggle');

      // DOM order inside toggleContainer should be [C1, A, C2]
      const children = Array.from(toggleContainer.children);
      expect(children[0]).toBe(c1.holder);
      expect(children[1]).toBe(a.holder);
      expect(children[2]).toBe(c2.holder);
    });

    it('does NOT move block.holder when the new parent has no [data-blok-toggle-children] container', () => {
      repository = createRepositoryWithBlocks([
        { id: 'plain-parent', parentId: null, contentIds: [] },
        { id: 'child', parentId: null, contentIds: [] },
      ]);
      hierarchy = new BlockHierarchy(repository);

      const plainParent = requireBlock('plain-parent');
      const child = requireBlock('child');

      // No toggle container — plain-parent.holder has no special child
      const externalWrapper = document.createElement('div');
      externalWrapper.appendChild(child.holder);

      hierarchy.setBlockParent(child, 'plain-parent');

      // child.holder should remain in the external wrapper, not pulled into parent.holder
      expect(externalWrapper.contains(child.holder)).toBe(true);
      expect(plainParent.holder.contains(child.holder)).toBe(false);
    });
  });
});
