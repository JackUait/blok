import { describe, it, expect, vi } from 'vitest';
import { Blocks } from '../../../src/components/blocks';
import type { Block } from '../../../src/components/block';
import { BlockToolAPI } from '../../../src/components/block';

/**
 * Unit tests for Blocks class
 *
 * Tests internal block management functionality
 */
describe('Blocks', () => {
  const workingArea: HTMLElement = document.createElement('div');

  /**
   * Create a mock Block instance
   * @param id - The block ID
   * @param name - The block name (default: 'paragraph')
   */
  const createMockBlock = (id: string, name: string = 'paragraph'): Block => {
    const holder = document.createElement('div');

    holder.setAttribute('data-blok-testid', 'block-wrapper');
    holder.setAttribute('data-blok-id', id);

    const mockBlock = {
      id,
      name,
      holder,
      call: vi.fn(),
      destroy: vi.fn(),
      tool: {
        name,
      },
    } as unknown as Block;

    return mockBlock;
  };

  /**
   * Create a fresh Blocks instance for testing
   */
  const createBlocks = (): Blocks => {
    // Reset working area for each test
    workingArea.setAttribute('data-blok-testid', 'editor-wrapper');
    workingArea.innerHTML = '';
    if (!document.body.contains(workingArea)) {
      document.body.appendChild(workingArea);
    }

    return new Blocks(workingArea);
  };

  describe('constructor', () => {
    it('should initialize with empty blocks array', () => {
      const blocks = createBlocks();

      expect(blocks.blocks).toEqual([]);
      expect(blocks.length).toBe(0);
    });

    it('should set workingArea', () => {
      const blocks = createBlocks();

      expect(blocks.workingArea).toBe(workingArea);
    });
  });

  describe('getters', () => {
    describe('length', () => {
      it('should return 0 for empty blocks array', () => {
        const blocks = createBlocks();

        expect(blocks.length).toBe(0);
      });

      it('should return correct length after adding blocks', () => {
        const blocks = createBlocks();
        const block1 = createMockBlock('block-1');
        const block2 = createMockBlock('block-2');

        blocks.push(block1);
        expect(blocks.length).toBe(1);

        blocks.push(block2);
        expect(blocks.length).toBe(2);
      });
    });

    describe('array', () => {
      it('should return empty array initially', () => {
        const blocks = createBlocks();

        expect(blocks.array).toEqual([]);
      });

      it('should return array of blocks', () => {
        const blocks = createBlocks();
        const block1 = createMockBlock('block-1');
        const block2 = createMockBlock('block-2');

        blocks.push(block1);
        blocks.push(block2);

        expect(blocks.array).toHaveLength(2);
        expect(blocks.array[0]).toBe(block1);
        expect(blocks.array[1]).toBe(block2);
      });
    });

    describe('nodes', () => {
      it('should return empty array when no blocks', () => {
        const blocks = createBlocks();

        expect(blocks.nodes).toEqual([]);
      });

      it('should return array of block holder elements', () => {
        const blocks = createBlocks();
        const block1 = createMockBlock('block-1');
        const block2 = createMockBlock('block-2');

        blocks.push(block1);
        blocks.push(block2);

        const nodes = blocks.nodes;

        expect(nodes).toHaveLength(2);
        expect(nodes[0]).toBe(block1.holder);
        expect(nodes[1]).toBe(block2.holder);
      });
    });
  });

  describe('Proxy traps', () => {
    describe('Blocks.set', () => {
      it('should set non-numeric properties via Reflect', () => {
        const blocks = createBlocks();
        const testValue = 'test';

        Blocks.set(blocks, 'testProperty', testValue);

        expect((blocks as unknown as { testProperty: string }).testProperty).toBe(testValue);
      });

      it('should call insert for numeric properties', () => {
        const blocks = createBlocks();
        const block = createMockBlock('block-1');
        const insertSpy = vi.spyOn(blocks, 'insert');

        Blocks.set(blocks, '0', block);

        expect(insertSpy).toHaveBeenCalledWith(0, block);
      });
    });

    describe('Blocks.get', () => {
      it('should get non-numeric properties via Reflect', () => {
        const blocks = createBlocks();

        (blocks as unknown as { testProperty: string }).testProperty = 'test';

        const result = Blocks.get(blocks, 'testProperty');

        expect(result).toBe('test');
      });

      it('should call get method for numeric properties', () => {
        const blocks = createBlocks();
        const block = createMockBlock('block-1');

        blocks.push(block);

        const result = Blocks.get(blocks, '0');

        expect(result).toBe(block);
      });

      it('should return undefined for out of bounds numeric property', () => {
        const blocks = createBlocks();
        const result = Blocks.get(blocks, '999');

        expect(result).toBeUndefined();
      });
    });
  });

  describe('push', () => {
    it('should add block to blocks array', () => {
      const blocks = createBlocks();
      const block = createMockBlock('block-1');

      blocks.push(block);

      expect(blocks.blocks).toContain(block);
      expect(blocks.length).toBe(1);
    });

    it('should append block holder to workingArea', () => {
      const blocks = createBlocks();
      const block = createMockBlock('block-1');

      blocks.push(block);

      expect(workingArea.children).toContain(block.holder);
      expect(workingArea.children.length).toBe(1);
    });

    it('should call RENDERED event on block', () => {
      const blocks = createBlocks();
      const block = createMockBlock('block-1');

      blocks.push(block);

      expect(block.call).toHaveBeenCalledWith(BlockToolAPI.RENDERED);
    });

    it('should add multiple blocks in order', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');
      const block3 = createMockBlock('block-3');

      blocks.push(block1);
      blocks.push(block2);
      blocks.push(block3);

      const expectedLength = 3;

      expect(blocks.length).toBe(expectedLength);
      expect(blocks.blocks[0]).toBe(block1);
      expect(blocks.blocks[1]).toBe(block2);
      expect(blocks.blocks[2]).toBe(block3);
    });
  });

  describe('move', () => {
    it('should move block from one index to another', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');
      const block3 = createMockBlock('block-3');

      blocks.push(block1);
      blocks.push(block2);
      blocks.push(block3);

      blocks.move(0, 2);

      expect(blocks.blocks[0]).toBe(block3);
      expect(blocks.blocks[1]).toBe(block1);
      expect(blocks.blocks[2]).toBe(block2);
    });

    it('should move block to beginning (index 0)', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.push(block1);
      blocks.push(block2);

      blocks.move(0, 1);

      expect(blocks.blocks[0]).toBe(block2);
      expect(blocks.blocks[1]).toBe(block1);
    });

    it('should move block to end', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');
      const block3 = createMockBlock('block-3');

      blocks.push(block1);
      blocks.push(block2);
      blocks.push(block3);

      blocks.move(2, 0);

      expect(blocks.blocks[0]).toBe(block2);
      expect(blocks.blocks[1]).toBe(block3);
      expect(blocks.blocks[2]).toBe(block1);
    });

    it('should call MOVED event on block', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.push(block1);
      blocks.push(block2);

      blocks.move(0, 1);

      expect(block2.call).toHaveBeenCalledWith(
        BlockToolAPI.MOVED,
        {
          fromIndex: 1,
          toIndex: 0,
        }
      );
    });

    it('should handle moving to same index', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.push(block1);
      blocks.push(block2);

      blocks.move(1, 1);

      expect(blocks.blocks[0]).toBe(block1);
      expect(blocks.blocks[1]).toBe(block2);
    });

    it('should handle moving first block to index 0 (no-op)', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.push(block1);
      blocks.push(block2);

      blocks.move(0, 0);

      expect(blocks.blocks[0]).toBe(block1);
      expect(blocks.blocks[1]).toBe(block2);
    });

    it('should handle moving last block to beginning', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');
      const block3 = createMockBlock('block-3');

      blocks.push(block1);
      blocks.push(block2);
      blocks.push(block3);

      blocks.move(0, 2);

      expect(blocks.blocks[0]).toBe(block3);
      expect(blocks.blocks[1]).toBe(block1);
      expect(blocks.blocks[2]).toBe(block2);
    });

    it('should handle moving block forward in array', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');
      const block3 = createMockBlock('block-3');
      const block4 = createMockBlock('block-4');

      blocks.push(block1);
      blocks.push(block2);
      blocks.push(block3);
      blocks.push(block4);

      const targetIndex = 3;
      const destinationIndex = 1;

      blocks.move(targetIndex, destinationIndex);

      expect(blocks.blocks[0]).toBe(block1);
      expect(blocks.blocks[1]).toBe(block3);
      expect(blocks.blocks[2]).toBe(block4);
      expect(blocks.blocks[3]).toBe(block2);
    });

    it('should handle moving block backward in array', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');
      const block3 = createMockBlock('block-3');
      const block4 = createMockBlock('block-4');

      blocks.push(block1);
      blocks.push(block2);
      blocks.push(block3);
      blocks.push(block4);

      const sourceIndex = 1;
      const targetIndex = 3;

      blocks.move(sourceIndex, targetIndex);

      expect(blocks.blocks[0]).toBe(block1);
      expect(blocks.blocks[1]).toBe(block4);
      expect(blocks.blocks[2]).toBe(block2);
      expect(blocks.blocks[3]).toBe(block3);
    });

    it('should keep block in workingArea when previous block is inside a nested container', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');
      const block3 = createMockBlock('block-3');

      blocks.push(block1);
      blocks.push(block2);
      blocks.push(block3);

      // Simulate block2's holder being inside a nested container (e.g. a table cell)
      const nestedContainer = document.createElement('div');

      workingArea.appendChild(nestedContainer);
      nestedContainer.appendChild(block2.holder);

      /**
       * move(toIndex=1, fromIndex=0): moves block1 to index 1.
       * After splice of block1, blocks = [block2, block3].
       * previousBlock = blocks[toIndex-1] = blocks[0] = block2 (nested!).
       * insertAdjacentElement('afterend', block1.holder) on block2.holder
       * places block1 inside the nested container — this is the bug.
       */
      blocks.move(1, 0);

      // block1's holder should remain in the workingArea, NOT inside the nested container
      expect(block1.holder.parentElement).toBe(workingArea);
      expect(nestedContainer.contains(block1.holder)).toBe(false);
    });

    it('should not place moved block inside table cell container', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');
      const block3 = createMockBlock('block-3');

      blocks.push(block1);
      blocks.push(block2);
      blocks.push(block3);

      // Create a table cell container with the actual attribute used in the codebase
      const tableCellContainer = document.createElement('div');

      tableCellContainer.setAttribute('data-blok-table-cell-blocks', '');
      workingArea.appendChild(tableCellContainer);
      tableCellContainer.appendChild(block2.holder);

      /**
       * move(toIndex=1, fromIndex=0): moves block1 to index 1.
       * After splice, previousBlock is block2 whose holder is inside
       * tableCellContainer. insertAdjacentElement('afterend') on block2.holder
       * places block1 inside the table cell container — this is the bug.
       */
      blocks.move(1, 0);

      // The moved block must stay in workingArea, not end up inside the table cell
      expect(block1.holder.parentElement).toBe(workingArea);
      expect(tableCellContainer.contains(block1.holder)).toBe(false);
    });

    it('should re-sort nested blocks to be immediately after the moved block in flat array', () => {
      const blocks = createBlocks();
      const p0 = createMockBlock('p0');
      const tableBlock = createMockBlock('table', 'table');
      const cellBlock = createMockBlock('cell', 'paragraph');
      const p1 = createMockBlock('p1');

      // Build flat array: [p0, tableBlock, cellBlock, p1]
      blocks.push(p0);
      blocks.push(tableBlock);

      // Nest cellBlock.holder inside tableBlock.holder via an intermediate div
      const innerContainer = document.createElement('div');

      tableBlock.holder.appendChild(innerContainer);
      innerContainer.appendChild(cellBlock.holder);

      // Add cellBlock to the flat array manually (already in DOM inside tableBlock)
      blocks.blocks.push(cellBlock);

      // Add p1 as a direct child of workingArea
      blocks.push(p1);

      // Verify initial state: [p0(0), tableBlock(1), cellBlock(2), p1(3)]
      expect(blocks.blocks[0]).toBe(p0);
      expect(blocks.blocks[1]).toBe(tableBlock);
      expect(blocks.blocks[2]).toBe(cellBlock);
      expect(blocks.blocks[3]).toBe(p1);

      // Move tableBlock from index 1 to index 2 (before p1's old position)
      blocks.move(2, 1);

      // After move, cellBlock must immediately follow tableBlock in the flat array
      const tableIdx = blocks.blocks.indexOf(tableBlock);
      const cellIdx = blocks.blocks.indexOf(cellBlock);

      expect(cellIdx).toBe(tableIdx + 1);
    });

    it('should maintain correct flat array order when the reference block is nested inside the moved block', () => {
      const blocks = createBlocks();
      const tableBlock = createMockBlock('table', 'table');
      const cellBlock = createMockBlock('cell', 'paragraph');
      const p1 = createMockBlock('p1');

      // Build flat array: [tableBlock, cellBlock, p1]
      blocks.push(tableBlock);

      // Nest cellBlock.holder inside tableBlock.holder
      tableBlock.holder.appendChild(cellBlock.holder);
      blocks.blocks.push(cellBlock);

      // Add p1 as a direct child of workingArea after the table
      blocks.push(p1);

      // Sanity check initial flat array: [tableBlock(0), cellBlock(1), p1(2)]
      expect(blocks.blocks[0]).toBe(tableBlock);
      expect(blocks.blocks[1]).toBe(cellBlock);
      expect(blocks.blocks[2]).toBe(p1);

      // Move tableBlock from index 0 to index 1
      // previousBlockIndex = 0 → blocks[0] after splice = cellBlock (nested inside tableBlock)
      // findWorkingAreaChild(cellBlock.holder) walks up and returns tableBlock.holder — self-reference
      // Without the nested re-sort fix, flat array becomes [cellBlock, tableBlock, p1] (cellBlock before table)
      blocks.move(1, 0);

      // tableBlock must still be in the workingArea (not detached)
      expect(tableBlock.holder.parentElement).toBe(workingArea);

      // cellBlock must still be inside tableBlock
      expect(tableBlock.holder.contains(cellBlock.holder)).toBe(true);

      // Flat array must have tableBlock before cellBlock (table owns cell, so table comes first)
      const tableIdx = blocks.blocks.indexOf(tableBlock);
      const cellIdx = blocks.blocks.indexOf(cellBlock);

      expect(tableIdx).toBeLessThan(cellIdx);
    });

    it('should place moved block immediately before the target-index block in the DOM when the target-index block is nested inside a container', () => {
      /**
       * Regression for DOM placement bug: when toIndex points to a nested block (e.g. a
       * toggle child), moveHolderInDOM used findWorkingAreaChild to walk up to the root
       * ancestor and inserted relative to that. This placed the moved block after the entire
       * toggle instead of immediately before the nested child in the toggle-children container.
       *
       * Flat array before move: [toggleBlock(0), child1Block(1), rootB(2)]
       * - toggleBlock.holder is a direct workingArea child
       * - child1Block.holder lives inside toggleBlock.holder > childContainer (toggle-children)
       * - rootB.holder is a direct workingArea child
       *
       * move(toIndex=1, fromIndex=2) moves rootB from index 2 to index 1.
       * After splice, blocks = [toggleBlock, child1Block], blocks[toIndex=1] = child1Block.
       * Correct placement: rootB.holder immediately before child1Block.holder in the DOM.
       */
      const blocks = createBlocks();
      const toggleBlock = createMockBlock('toggle', 'toggle');
      const child1Block = createMockBlock('child1', 'paragraph');
      const rootB = createMockBlock('rootB', 'paragraph');

      // Place toggleBlock in workingArea
      blocks.push(toggleBlock);

      // Build the toggle-children container inside toggleBlock's holder
      const childContainer = document.createElement('div');

      childContainer.setAttribute('data-blok-toggle-children', '');
      toggleBlock.holder.appendChild(childContainer);

      // Place child1Block.holder inside the toggle-children container
      childContainer.appendChild(child1Block.holder);

      // Register child1Block in the flat array (its holder is already in DOM via childContainer)
      blocks.blocks.push(child1Block);

      // Place rootB in workingArea (direct child, after toggleBlock)
      blocks.push(rootB);

      // Verify initial DOM state:
      // workingArea: [toggleBlock.holder, rootB.holder]
      // toggleBlock.holder > childContainer: [child1Block.holder]
      expect(workingArea.children[0]).toBe(toggleBlock.holder);
      expect(workingArea.children[1]).toBe(rootB.holder);
      expect(childContainer.children[0]).toBe(child1Block.holder);

      // Move rootB from index 2 to index 1 (between toggleBlock and child1Block in flat array)
      blocks.move(1, 2);

      // rootB.holder must be immediately before child1Block.holder in the DOM.
      // The DOM sibling relationship inside childContainer should be [rootB.holder, child1Block.holder].
      expect(rootB.holder.nextElementSibling).toBe(child1Block.holder);
    });

    it('should not throw and should keep moved block in workingArea when target-index block is nested inside it (self-reference guard)', () => {
      /**
       * Regression for the self-reference branch in moveHolderInDOM:
       *   `else if (block.holder.contains(nextBlock.holder))`
       *
       * Without this guard, the else path runs:
       *   child2Block.holder.insertAdjacentElement('beforebegin', toggleHolder)
       * child2Block.holder is a descendant of toggleHolder. jsdom throws a
       * HierarchyRequestError when you attempt to insert an ancestor before one of
       * its own descendants — the operation would create a circular tree.
       *
       * Scenario:
       *   Flat array: [p0Block(0), toggleBlock(1), child1Block(2), child2Block(3), p1Block(4)]
       *   workingArea DOM:         [p0Holder, toggleHolder, p1Holder]
       *   child1Block.holder and child2Block.holder live inside toggleHolder.
       *
       *   move(toIndex=2, fromIndex=1): move toggleBlock from index 1 to index 2.
       *   After splice(1,1): blocks = [p0Block, child1Block, child2Block, p1Block]
       *   this.blocks[2] = child2Block — its holder IS inside toggleHolder → self-reference.
       *   The guard fires: uses toggleHolder.nextElementSibling (= p1Holder) instead,
       *   re-inserting toggleHolder immediately before p1Holder and avoiding the error.
       */
      const blocks = createBlocks();
      const p0Block = createMockBlock('p0');
      const toggleBlock = createMockBlock('toggle', 'toggle');
      const child1Block = createMockBlock('child1', 'paragraph');
      const child2Block = createMockBlock('child2', 'paragraph');
      const p1Block = createMockBlock('p1');

      // Push p0 and toggleBlock as direct workingArea children
      blocks.push(p0Block);
      blocks.push(toggleBlock);

      // Nest both child holders inside toggleHolder
      toggleBlock.holder.appendChild(child1Block.holder);
      toggleBlock.holder.appendChild(child2Block.holder);

      // Register children in the flat array without re-inserting into workingArea
      blocks.blocks.push(child1Block);
      blocks.blocks.push(child2Block);

      // Push p1 as a direct workingArea child after the toggle
      blocks.push(p1Block);

      // Initial state: flat [p0(0), toggle(1), child1(2), child2(3), p1(4)]
      // workingArea DOM: [p0Holder, toggleHolder, p1Holder]
      expect(workingArea.children[0]).toBe(p0Block.holder);
      expect(workingArea.children[1]).toBe(toggleBlock.holder);
      expect(workingArea.children[2]).toBe(p1Block.holder);
      expect(blocks.blocks[1]).toBe(toggleBlock);
      expect(blocks.blocks[2]).toBe(child1Block);
      expect(blocks.blocks[3]).toBe(child2Block);

      // move(2, 1): after splice blocks[2] = child2Block (inside toggleHolder) → self-reference.
      // Without the guard this throws HierarchyRequestError.
      expect(() => blocks.move(2, 1)).not.toThrow();

      // toggleHolder must remain attached to workingArea
      expect(toggleBlock.holder.parentElement).toBe(workingArea);

      // toggleHolder must be immediately before p1Holder in the DOM
      expect(toggleBlock.holder.nextElementSibling).toBe(p1Block.holder);
    });

    describe('invalid index guard (regression: wrong-block-dropped)', () => {
      /**
       * Regression: `Array.splice(-1, 1)` removes the LAST element. If a stale
       * Block reference is passed anywhere up the call chain and `getBlockIndex`
       * returns -1, `move(toIndex, -1)` would silently delete the last block
       * instead of moving the stale one — this is the "wrong block dropped"
       * symptom. Guard must live at the lowest level (`Blocks.move`) so every
       * caller — drag, yjs-sync, API, tool conversion — is protected.
       */
      it('should be a no-op when fromIndex is -1 (stale reference)', () => {
        const blocks = createBlocks();
        const block1 = createMockBlock('block-1');
        const block2 = createMockBlock('block-2');
        const block3 = createMockBlock('block-3');

        blocks.push(block1);
        blocks.push(block2);
        blocks.push(block3);

        blocks.move(0, -1);

        expect(blocks.length).toBe(3);
        expect(blocks.blocks[0]).toBe(block1);
        expect(blocks.blocks[1]).toBe(block2);
        expect(blocks.blocks[2]).toBe(block3);
        expect(block1.call).not.toHaveBeenCalledWith(BlockToolAPI.MOVED, expect.anything());
        expect(block2.call).not.toHaveBeenCalledWith(BlockToolAPI.MOVED, expect.anything());
        expect(block3.call).not.toHaveBeenCalledWith(BlockToolAPI.MOVED, expect.anything());
      });

      it('should be a no-op when fromIndex is out of range (stale reference past end)', () => {
        const blocks = createBlocks();
        const block1 = createMockBlock('block-1');
        const block2 = createMockBlock('block-2');

        blocks.push(block1);
        blocks.push(block2);

        blocks.move(0, 5);

        expect(blocks.length).toBe(2);
        expect(blocks.blocks[0]).toBe(block1);
        expect(blocks.blocks[1]).toBe(block2);
      });

      it('should be a no-op when toIndex is -1', () => {
        const blocks = createBlocks();
        const block1 = createMockBlock('block-1');
        const block2 = createMockBlock('block-2');

        blocks.push(block1);
        blocks.push(block2);

        blocks.move(-1, 0);

        expect(blocks.length).toBe(2);
        expect(blocks.blocks[0]).toBe(block1);
        expect(blocks.blocks[1]).toBe(block2);
      });
    });
  });

  describe('insert', () => {
    it('should insert block at specified index', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');
      const block3 = createMockBlock('block-3');

      blocks.push(block1);
      blocks.push(block2);

      blocks.insert(1, block3);

      expect(blocks.blocks[0]).toBe(block1);
      expect(blocks.blocks[1]).toBe(block3);
      expect(blocks.blocks[2]).toBe(block2);
    });

    it('should insert block at beginning (index 0)', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.push(block1);

      blocks.insert(0, block2);

      expect(blocks.blocks[0]).toBe(block2);
      expect(blocks.blocks[1]).toBe(block1);
    });

    it('should insert block at end when index equals length', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.push(block1);

      blocks.insert(1, block2);

      expect(blocks.blocks[0]).toBe(block1);
      expect(blocks.blocks[1]).toBe(block2);
    });

    it('should clamp index to length when index exceeds length', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.push(block1);

      const outOfBoundsIndex = 999;

      blocks.insert(outOfBoundsIndex, block2);

      expect(blocks.blocks[0]).toBe(block1);
      expect(blocks.blocks[1]).toBe(block2);
    });

    it('should push block when blocks array is empty', () => {
      const blocks = createBlocks();
      const block = createMockBlock('block-1');

      blocks.insert(0, block);

      expect(blocks.blocks).toContain(block);
      expect(blocks.length).toBe(1);
    });

    it('should replace block when replace is true', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.push(block1);

      const replaceWithSpy = vi.spyOn(block1.holder, 'replaceWith');

      blocks.insert(0, block2, true);

      expect(blocks.blocks[0]).toBe(block2);
      expect(blocks.length).toBe(1);
      expect(replaceWithSpy).toHaveBeenCalledWith(block2.holder);
      expect(block1.call).toHaveBeenCalledWith(BlockToolAPI.REMOVED);
      expect(block2.call).toHaveBeenCalledWith(BlockToolAPI.RENDERED);
    });

    it('should insert block after previous block when index > 0', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');
      const block3 = createMockBlock('block-3');

      blocks.push(block1);
      blocks.push(block2);

      const insertAdjacentSpy = vi.spyOn(block1.holder, 'insertAdjacentElement');

      blocks.insert(1, block3);

      expect(insertAdjacentSpy).toHaveBeenCalledWith('afterend', block3.holder);
    });

    it('should insert block before next block when index is 0 and next block exists', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.push(block1);

      const insertAdjacentSpy = vi.spyOn(block1.holder, 'insertAdjacentElement');

      blocks.insert(0, block2);

      expect(insertAdjacentSpy).toHaveBeenCalledWith('beforebegin', block2.holder);
    });

    it('should append to workingArea when index is 0 and no next block', () => {
      const blocks = createBlocks();
      const block = createMockBlock('block-1');

      const appendChildSpy = vi.spyOn(workingArea, 'appendChild');

      blocks.insert(0, block);

      expect(appendChildSpy).toHaveBeenCalledWith(block.holder);
    });

    it('should call RENDERED event on inserted block', () => {
      const blocks = createBlocks();
      const block = createMockBlock('block-1');

      blocks.insert(0, block);

      expect(block.call).toHaveBeenCalledWith(BlockToolAPI.RENDERED);
    });

    it('should preserve DOM position when replacing a block whose previous sibling is nested inside another element', () => {
      const blocks = createBlocks();

      // Set up a container that nests some block holders (simulating a table)
      const tableBlock = createMockBlock('table-1', 'table');
      const cellBlock = createMockBlock('cell-1', 'paragraph');
      const slashBlock = createMockBlock('slash-1', 'paragraph');

      // Push table block first (goes into workingArea)
      blocks.push(tableBlock);

      // Nest the cell block's holder INSIDE the table block's holder
      tableBlock.holder.appendChild(cellBlock.holder);
      blocks.blocks.push(cellBlock);

      // Push the slash block - manually place it AFTER the table in workingArea
      // (simulating what PlusButtonHandler does when it relocates the "/" paragraph)
      blocks.blocks.push(slashBlock);
      workingArea.appendChild(slashBlock.holder);
      slashBlock.call(BlockToolAPI.RENDERED);

      // Verify initial DOM: workingArea has [tableHolder, slashHolder]
      // and cellHolder is inside tableHolder
      expect(workingArea.children.length).toBe(2);
      expect(workingArea.children[0]).toBe(tableBlock.holder);
      expect(workingArea.children[1]).toBe(slashBlock.holder);
      expect(tableBlock.holder.contains(cellBlock.holder)).toBe(true);

      // Now replace slashBlock (index 2) with a new block
      const newBlock = createMockBlock('new-1', 'header');

      blocks.insert(2, newBlock, true);

      // The new block should be in the array at index 2
      expect(blocks.blocks[2]).toBe(newBlock);
      expect(blocks.length).toBe(3);

      // CRITICAL: The new block's holder should be in workingArea (not inside the table)
      expect(workingArea.children.length).toBe(2);
      expect(workingArea.children[0]).toBe(tableBlock.holder);
      expect(workingArea.children[1]).toBe(newBlock.holder);

      // The cell block should still be inside the table
      expect(tableBlock.holder.contains(cellBlock.holder)).toBe(true);

      // The new block should NOT be inside the table
      expect(tableBlock.holder.contains(newBlock.holder)).toBe(false);
    });

    describe('invalid index guard (regression: wrong-block-dropped via alt+drag)', () => {
      /**
       * Regression: `Array.splice(-1, 0, block)` inserts the block BEFORE the
       * LAST element, diverging the array from the DOM. A later move() then
       * reads `indexOf(block)` and splices the wrong slot, dropping an
       * unrelated block. Happens when alt+drag (duplicate) resolves a stale
       * target block whose getBlockIndex returns -1 and baseInsertIndex ends
       * up negative. Guard must live at the lowest level (`Blocks.insert`)
       * so every caller is protected symmetrically with `Blocks.move`.
       */
      it('should be a no-op when index is -1 (negative insert index)', () => {
        const blocks = createBlocks();
        const block1 = createMockBlock('block-1');
        const block2 = createMockBlock('block-2');
        const block3 = createMockBlock('block-3');

        blocks.push(block1);
        blocks.push(block2);

        blocks.insert(-1, block3);

        expect(blocks.length).toBe(2);
        expect(blocks.blocks[0]).toBe(block1);
        expect(blocks.blocks[1]).toBe(block2);
        expect(workingArea.contains(block3.holder)).toBe(false);
      });

      it('should be a no-op when index is a large negative number', () => {
        const blocks = createBlocks();
        const block1 = createMockBlock('block-1');
        const block2 = createMockBlock('block-2');

        blocks.push(block1);

        blocks.insert(-5, block2);

        expect(blocks.length).toBe(1);
        expect(blocks.blocks[0]).toBe(block1);
        expect(workingArea.contains(block2.holder)).toBe(false);
      });
    });
  });

  describe('replace', () => {
    it('should replace block at specified index', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.push(block1);

      blocks.replace(0, block2);

      expect(blocks.blocks[0]).toBe(block2);
      expect(blocks.length).toBe(1);
    });

    it('should replace block holder in DOM', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.push(block1);

      const replaceWithSpy = vi.spyOn(block1.holder, 'replaceWith');

      blocks.replace(0, block2);

      expect(replaceWithSpy).toHaveBeenCalledWith(block2.holder);
    });

    it('should throw error for incorrect index', () => {
      const blocks = createBlocks();
      const block = createMockBlock('block-1');

      const invalidIndex = 999;

      expect(() => {
        blocks.replace(invalidIndex, block);
      }).toThrow('Incorrect index');
    });

    /**
     * Regression: blocks.replace() used to swap the DOM holder and drop the
     * reference without calling destroy() on the previous block. The orphan
     * Block instance kept its drag-handle listener alive on the shared
     * settings-toggler element because cleanupDraggable() lives inside
     * destroy(). The next mousedown then dispatched to the orphan via closure
     * and an unrelated block was dragged.
     */
    it('should destroy the replaced block so drag listeners are cleaned up', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.push(block1);
      workingArea.appendChild(block1.holder);

      blocks.replace(0, block2);

      expect(block1.destroy).toHaveBeenCalledTimes(1);
      expect(blocks.blocks[0]).toBe(block2);
      expect(workingArea.contains(block1.holder)).toBe(false);
      expect(workingArea.contains(block2.holder)).toBe(true);
    });
  });

  describe('insertMany', () => {
    it('should insert multiple blocks at specified index', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');
      const block3 = createMockBlock('block-3');

      blocks.push(block1);

      blocks.insertMany([block2, block3], 0);

      const expectedLength = 3;

      expect(blocks.blocks[0]).toBe(block2);
      expect(blocks.blocks[1]).toBe(block3);
      expect(blocks.blocks[2]).toBe(block1);
      expect(blocks.length).toBe(expectedLength);
    });

    it('should insert blocks at beginning when index is 0', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');
      const block3 = createMockBlock('block-3');

      blocks.push(block1);

      const prependSpy = vi.spyOn(workingArea, 'prepend');

      blocks.insertMany([block2, block3], 0);

      expect(prependSpy).toHaveBeenCalled();
      expect(blocks.blocks[0]).toBe(block2);
      expect(blocks.blocks[1]).toBe(block3);
    });

    it('should insert blocks after previous block when index > 0', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');
      const block3 = createMockBlock('block-3');

      blocks.push(block1);

      const afterSpy = vi.spyOn(block1.holder, 'after');

      blocks.insertMany([block2, block3], 1);

      expect(afterSpy).toHaveBeenCalled();
      expect(blocks.blocks[1]).toBe(block2);
      expect(blocks.blocks[2]).toBe(block3);
    });

    it('should append blocks when blocks array is empty', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      const appendChildSpy = vi.spyOn(workingArea, 'appendChild');

      blocks.insertMany([block1, block2], 0);

      expect(appendChildSpy).toHaveBeenCalled();
      expect(blocks.length).toBe(2);
    });

    it('should call RENDERED event on each inserted block', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.insertMany([block1, block2], 0);

      expect(block1.call).toHaveBeenCalledWith(BlockToolAPI.RENDERED);
      expect(block2.call).toHaveBeenCalledWith(BlockToolAPI.RENDERED);
    });

    it('should handle index greater than length', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');
      const block3 = createMockBlock('block-3');

      blocks.push(block1);

      const outOfBoundsIndex = 999;

      blocks.insertMany([block2, block3], outOfBoundsIndex);

      expect(blocks.blocks[0]).toBe(block1);
      expect(blocks.blocks[1]).toBe(block2);
      expect(blocks.blocks[2]).toBe(block3);
    });

    it('should insert before the next top-level block when previous block is nested mid-article', () => {
      const blocks = createBlocks();

      /**
       * Regression: table cell paragraphs land at the end of the flat blocks
       * array even though the table appears mid-article in the DOM.
       *
       * Flat array: [tableBlock(0), quoteBlock(1), emptyBlock(2), cellBlock(3)]
       * DOM order:  [tableBlock(contains cellBlock), quoteBlock, emptyBlock]
       *
       * When inserting at index 3 (after cellBlock), previousBlock is
       * cellBlock(3) which is nested inside the table. Inserting after the
       * table's holder would place content mid-article. Instead, insertMany
       * should place blocks at the correct DOM position — after emptyBlock
       * (by appending to workingArea since no top-level blocks follow in
       * the array).
       */
      const tableBlock = createMockBlock('table-1', 'table');
      const quoteBlock = createMockBlock('quote-1', 'quote');
      const emptyBlock = createMockBlock('empty-1', 'paragraph');
      const cellBlock = createMockBlock('cell-1', 'paragraph');

      blocks.push(tableBlock);
      blocks.push(quoteBlock);
      blocks.push(emptyBlock);

      // Nest the cell block inside the table — but it's at the END of the flat array
      const cellContainer = document.createElement('div');

      cellContainer.setAttribute('data-blok-table-cell-blocks', '');
      tableBlock.holder.appendChild(cellContainer);
      cellContainer.appendChild(cellBlock.holder);
      blocks.blocks.push(cellBlock);

      // Array is now: [tableBlock(0), quoteBlock(1), emptyBlock(2), cellBlock(3)]
      // DOM is:       [tableBlock(contains cellBlock), quoteBlock, emptyBlock]

      // Insert at index 3 (shouldReplace scenario: replacing emptyBlock, which is at
      // array index 2, but cellBlock at index 3 pushes things around)
      // Simulating: currentBlockIndex=3, previous=blocks[2]=emptyBlock — this case works.
      //
      // The REAL bug: insert at index 4 (after all blocks including the trailing cellBlock)
      const newBlock1 = createMockBlock('new-1', 'header');
      const newBlock2 = createMockBlock('new-2', 'paragraph');

      blocks.insertMany([newBlock1, newBlock2], 4);

      // New blocks must be direct children of workingArea, not inside the table
      expect(newBlock1.holder.parentElement).toBe(workingArea);
      expect(newBlock2.holder.parentElement).toBe(workingArea);
      expect(tableBlock.holder.contains(newBlock1.holder)).toBe(false);

      // New blocks must appear AFTER emptyBlock (at the end), not after the table (mid-article)
      const workingAreaChildren = Array.from(workingArea.children);
      const newBlock1Pos = workingAreaChildren.indexOf(newBlock1.holder);
      const emptyBlockPos = workingAreaChildren.indexOf(emptyBlock.holder);
      const tableBlockPos = workingAreaChildren.indexOf(tableBlock.holder);

      expect(newBlock1Pos).toBeGreaterThan(emptyBlockPos);
      expect(newBlock1Pos).toBeGreaterThan(tableBlockPos);
    });

    it('should append to workingArea when previous block is nested and no top-level blocks follow', () => {
      const blocks = createBlocks();

      /**
       * When all blocks after the insertion index are nested, there is
       * no top-level block to insert before — append to workingArea.
       */
      const tableBlock = createMockBlock('table-1', 'table');
      const cellBlock = createMockBlock('cell-1', 'paragraph');

      blocks.push(tableBlock);

      const cellContainer = document.createElement('div');

      tableBlock.holder.appendChild(cellContainer);
      cellContainer.appendChild(cellBlock.holder);
      blocks.blocks.push(cellBlock);

      const newBlock = createMockBlock('new-1', 'paragraph');

      blocks.insertMany([newBlock], 2);

      // Should be a direct child of workingArea, not inside the table
      expect(newBlock.holder.parentElement).toBe(workingArea);
      expect(tableBlock.holder.contains(newBlock.holder)).toBe(false);
    });

    describe('invalid index guard (regression: wrong-block-dropped)', () => {
      /**
       * Mirrors the guards in Blocks.move and Blocks.insert. `splice(-1, 0, block)`
       * inserts BEFORE the last element, silently diverging the flat array from
       * the DOM. Yjs sync batch-add paths pass computed indices that can resolve
       * to -1 when a target is stale — without this guard, the next move() reads
       * the wrong slot and drops an unrelated block.
       */
      it('should be a no-op when index is -1', () => {
        const blocks = createBlocks();
        const block1 = createMockBlock('block-1');
        const block2 = createMockBlock('block-2');
        const newBlock = createMockBlock('new-block');

        blocks.push(block1);
        blocks.push(block2);

        blocks.insertMany([newBlock], -1);

        expect(blocks.length).toBe(2);
        expect(blocks.blocks[0]).toBe(block1);
        expect(blocks.blocks[1]).toBe(block2);
        expect(workingArea.contains(newBlock.holder)).toBe(false);
      });
    });
  });

  describe('remove', () => {
    it('should remove block at specified index', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.push(block1);
      blocks.push(block2);

      blocks.remove(0);

      expect(blocks.length).toBe(1);
      expect(blocks.blocks[0]).toBe(block2);
    });

    it('should remove last block when index is NaN', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.push(block1);
      blocks.push(block2);

      blocks.remove(NaN);

      expect(blocks.length).toBe(1);
      expect(blocks.blocks[0]).toBe(block1);
    });

    it('should remove block holder from DOM', () => {
      const blocks = createBlocks();
      const block = createMockBlock('block-1');

      blocks.push(block);

      // Verify holder is in DOM before removal
      expect(workingArea.children).toContain(block.holder);

      blocks.remove(0);

      // Verify holder is no longer in DOM after removal
      expect(workingArea.children).not.toContain(block.holder);
      expect(blocks.blocks).not.toContain(block);
      expect(blocks.length).toBe(0);
    });

    it('should call REMOVED event on block', () => {
      const blocks = createBlocks();
      const block = createMockBlock('block-1');

      blocks.push(block);

      blocks.remove(0);

      expect(block.call).toHaveBeenCalledWith(BlockToolAPI.REMOVED);
    });

    describe('invalid index guard (regression: wrong-block-dropped family)', () => {
      /**
       * Layer 15: defensive guard for Blocks.remove.
       *
       * Before this guard, a stale caller passing `-1` would hit
       * `this.blocks[-1]` (undefined) and crash on `.call(REMOVED)`. A large
       * negative like `-5` also crashes. Either way it's an uncaught exception
       * that can abort a larger batch (e.g. a Yjs undo transaction) halfway,
       * leaving the flat array inconsistent with the DOM — exactly the soil
       * that grows the wrong-block-dropped bug. Reject nonsense indices at the
       * lowest level and keep the array intact.
       */
      it('should be a no-op when index is negative', () => {
        const blocks = createBlocks();
        const block1 = createMockBlock('block-1');
        const block2 = createMockBlock('block-2');

        blocks.push(block1);
        blocks.push(block2);

        expect(() => blocks.remove(-1)).not.toThrow();

        expect(blocks.length).toBe(2);
        expect(blocks.blocks[0]).toBe(block1);
        expect(blocks.blocks[1]).toBe(block2);
        expect(block1.call).not.toHaveBeenCalledWith(BlockToolAPI.REMOVED);
        expect(block2.call).not.toHaveBeenCalledWith(BlockToolAPI.REMOVED);
      });

      it('should be a no-op when index is past the end', () => {
        const blocks = createBlocks();
        const block1 = createMockBlock('block-1');

        blocks.push(block1);

        expect(() => blocks.remove(99)).not.toThrow();

        expect(blocks.length).toBe(1);
        expect(blocks.blocks[0]).toBe(block1);
        expect(block1.call).not.toHaveBeenCalledWith(BlockToolAPI.REMOVED);
      });
    });
  });

  describe('removeAll', () => {
    it('should remove all blocks', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');
      const block3 = createMockBlock('block-3');

      blocks.push(block1);
      blocks.push(block2);
      blocks.push(block3);

      blocks.removeAll();

      expect(blocks.length).toBe(0);
      expect(blocks.blocks).toEqual([]);
    });

    it('should clear workingArea innerHTML', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.push(block1);
      blocks.push(block2);

      blocks.removeAll();

      expect(workingArea.innerHTML).toBe('');
    });

    it('should call REMOVED event on each block', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.push(block1);
      blocks.push(block2);

      blocks.removeAll();

      expect(block1.call).toHaveBeenCalledWith(BlockToolAPI.REMOVED);
      expect(block2.call).toHaveBeenCalledWith(BlockToolAPI.REMOVED);
    });

    it('should handle empty blocks array', () => {
      const blocks = createBlocks();

      expect(() => {
        blocks.removeAll();
      }).not.toThrow();

      expect(blocks.length).toBe(0);
    });

    it('should destroy each block so drag-handle listeners are released', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.push(block1);
      blocks.push(block2);

      blocks.removeAll();

      expect(block1.destroy).toHaveBeenCalledTimes(1);
      expect(block2.destroy).toHaveBeenCalledTimes(1);
      expect(blocks.length).toBe(0);
      expect(workingArea.innerHTML).toBe('');
    });
  });

  describe('insertAfter', () => {
    it('should insert block after target block', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');
      const block3 = createMockBlock('block-3');

      blocks.push(block1);
      blocks.push(block2);

      blocks.insertAfter(block1, block3);

      expect(blocks.blocks[0]).toBe(block1);
      expect(blocks.blocks[1]).toBe(block3);
      expect(blocks.blocks[2]).toBe(block2);
    });

    it('should insert at end when target is last block', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.push(block1);

      blocks.insertAfter(block1, block2);

      expect(blocks.blocks[0]).toBe(block1);
      expect(blocks.blocks[1]).toBe(block2);
    });

    describe('stale target guard (regression: wrong-block-dropped family)', () => {
      /**
       * Layer 14: defensive guard for Blocks.insertAfter.
       *
       * Without the guard, passing a stale targetBlock (not in `this.blocks`
       * anymore) makes `indexOf` return `-1`, then `insert(index + 1, …)` =
       * `insert(0, …)` which silently teleports the new block to the TOP of
       * the document. The symptom is identical to wrong-block-dropped: the
       * user expected the new block to land next to a specific target, and
       * it lands somewhere completely unrelated. insertAfter currently has
       * no live callers, but codifying the guard now stops any future caller
       * from reintroducing the bug class.
       */
      it('should be a no-op when targetBlock is not in the array', () => {
        const blocks = createBlocks();
        const block1 = createMockBlock('block-1');
        const block2 = createMockBlock('block-2');
        const staleBlock = createMockBlock('stale');
        const newBlock = createMockBlock('new-block');

        blocks.push(block1);
        blocks.push(block2);

        blocks.insertAfter(staleBlock, newBlock);

        expect(blocks.length).toBe(2);
        expect(blocks.blocks[0]).toBe(block1);
        expect(blocks.blocks[1]).toBe(block2);
      });
    });
  });

  describe('get', () => {
    it('should return block at specified index', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.push(block1);
      blocks.push(block2);

      expect(blocks.get(0)).toBe(block1);
      expect(blocks.get(1)).toBe(block2);
    });

    it('should return undefined for out of bounds index', () => {
      const blocks = createBlocks();

      expect(blocks.get(0)).toBeUndefined();

      const outOfBoundsIndex = 999;

      expect(blocks.get(outOfBoundsIndex)).toBeUndefined();
    });

    it('should return undefined for negative index', () => {
      const blocks = createBlocks();
      const block = createMockBlock('block-1');

      blocks.push(block);

      expect(blocks.get(-1)).toBeUndefined();
    });
  });

  describe('indexOf', () => {
    it('should return index of block', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');
      const block3 = createMockBlock('block-3');

      blocks.push(block1);
      blocks.push(block2);
      blocks.push(block3);

      expect(blocks.indexOf(block1)).toBe(0);
      expect(blocks.indexOf(block2)).toBe(1);
      expect(blocks.indexOf(block3)).toBe(2);
    });

    it('should return -1 for block not in array', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.push(block1);

      expect(blocks.indexOf(block2)).toBe(-1);
    });

    it('should return -1 for empty array', () => {
      const blocks = createBlocks();
      const block = createMockBlock('block-1');

      expect(blocks.indexOf(block)).toBe(-1);
    });
  });

  describe('edge cases and integration', () => {
    it('should handle complex sequence of operations', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');
      const block3 = createMockBlock('block-3');
      const block4 = createMockBlock('block-4');

      // Push initial blocks
      blocks.push(block1);
      blocks.push(block2);

      // Insert in middle
      blocks.insert(1, block3);

      const expectedLengthAfterInsert = 3;

      expect(blocks.length).toBe(expectedLengthAfterInsert);
      expect(blocks.blocks[1]).toBe(block3);

      // Move block
      blocks.move(0, 2);

      expect(blocks.blocks[0]).toBe(block2);
      expect(blocks.blocks[1]).toBe(block1);
      expect(blocks.blocks[2]).toBe(block3);

      // Insert many
      blocks.insertMany([ block4 ], 1);

      const expectedLengthAfterInsertMany = 4;

      expect(blocks.length).toBe(expectedLengthAfterInsertMany);
      expect(blocks.blocks[1]).toBe(block4);

      // Remove
      blocks.remove(2);

      const expectedLengthAfterRemove = 3;

      expect(blocks.length).toBe(expectedLengthAfterRemove);
      expect(blocks.blocks[2]).toBe(block3);
    });

    it('should maintain DOM order after multiple operations', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');
      const block3 = createMockBlock('block-3');

      blocks.push(block1);
      blocks.push(block2);
      blocks.insert(1, block3);

      const nodes = blocks.nodes;

      expect(nodes[0]).toBe(block1.holder);
      expect(nodes[1]).toBe(block3.holder);
      expect(nodes[2]).toBe(block2.holder);
    });

    it('should handle insertMany with empty array', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');

      blocks.push(block1);

      blocks.insertMany([], 0);

      expect(blocks.length).toBe(1);
      expect(blocks.blocks[0]).toBe(block1);
    });

    it('should place inserted block directly after the nested previous block holder (no escape to workingArea)', () => {
      const blocks = createBlocks();

      /**
       * insert() now uses target.holder.insertAdjacentElement directly, without
       * walking up to the workingArea root via findWorkingAreaChild.
       *
       * When the previous block (cellBlock) is nested inside a table cell container,
       * inserting 'afterend' of cellBlock.holder places the new block directly after
       * it inside cellContainer — matching the same DOM parent as cellBlock.
       *
       * Callers that need a block placed at root level (e.g. undo restoring a top-level
       * block after a nested one) should use the appendToWorkingArea flag instead.
       */
      const tableBlock = createMockBlock('table-1', 'table');
      const cellBlock = createMockBlock('cell-1', 'paragraph');

      blocks.push(tableBlock);

      // Nest the cell block's holder inside the table (simulating a table cell container)
      const cellContainer = document.createElement('div');

      cellContainer.setAttribute('data-blok-table-cell-blocks', '');
      tableBlock.holder.appendChild(cellContainer);
      cellContainer.appendChild(cellBlock.holder);
      blocks.blocks.push(cellBlock);

      // Insert a new block at index 2 (after all existing blocks)
      const newBlock = createMockBlock('table-2', 'table');

      blocks.insert(2, newBlock);

      // With direct insertion (no findWorkingAreaChild walk-up), the new block lands
      // directly after cellBlock.holder — i.e., inside cellContainer.
      expect(newBlock.holder.parentElement).toBe(cellContainer);
      expect(newBlock.holder.nextElementSibling).toBeNull();
      expect(cellBlock.holder.nextElementSibling).toBe(newBlock.holder);
    });

    it('should append to workingArea when appendToWorkingArea is true, even when previous block is nested', () => {
      const blocks = createBlocks();

      // Set up a table-like structure: table block in workingArea, cell block nested inside it
      const tableBlock = createMockBlock('table-1', 'table');
      const cellBlock = createMockBlock('cell-1', 'paragraph');

      blocks.push(tableBlock);

      // Nest the cell block's holder inside the table (simulating a table cell)
      tableBlock.holder.appendChild(cellBlock.holder);
      blocks.blocks.push(cellBlock);

      // Insert a new block at the end with appendToWorkingArea=true
      const newBlock = createMockBlock('new-1', 'paragraph');

      blocks.insert(2, newBlock, false, true);

      // The new block should be in the array at index 2
      expect(blocks.blocks[2]).toBe(newBlock);
      expect(blocks.length).toBe(3);

      // CRITICAL: The new block's holder should be a direct child of workingArea,
      // not inside the table block's holder
      expect(newBlock.holder.parentElement).toBe(workingArea);
      expect(tableBlock.holder.contains(newBlock.holder)).toBe(false);

      // The cell block should still be nested inside the table
      expect(tableBlock.holder.contains(cellBlock.holder)).toBe(true);
    });

    it('should place inserted block directly after previous block when previous block holder is nested in a container', () => {
      const blocks = createBlocks();

      /**
       * Regression for toggle-child paste bug: when pasting blocks while the
       * cursor is inside a toggle child, the pasted blocks should appear INSIDE
       * the toggle's child container (directly after the child), not escape to
       * the workingArea root.
       *
       * Flat array: [toggleBlock(0), childBlock(1)]
       * - toggleBlock.holder is a direct workingArea child
       * - childBlock.holder lives inside toggleBlock.holder > childContainer
       *
       * insert(2, newBlock) should place newBlock directly after childBlock.holder
       * inside childContainer (same parent as childBlock.holder).
       */
      const toggleBlock = createMockBlock('toggle-1', 'toggle');
      const childBlock = createMockBlock('child-1', 'paragraph');

      blocks.push(toggleBlock);

      // Build the toggle-children container inside toggleBlock's holder
      const childContainer = document.createElement('div');

      childContainer.setAttribute('data-blok-toggle-children', '');
      toggleBlock.holder.appendChild(childContainer);

      // Place childBlock.holder inside the toggle-children container
      childContainer.appendChild(childBlock.holder);

      // Register childBlock in the flat array (its holder is already in DOM)
      blocks.blocks.push(childBlock);

      // Insert a new block at index 2 (after the child, simulating a paste)
      const newBlock = createMockBlock('pasted-1', 'paragraph');

      blocks.insert(2, newBlock);

      // CRITICAL: newBlock should be inside the childContainer (same parent as childBlock),
      // not escaped to the workingArea root
      expect(newBlock.holder.parentElement).toBe(childContainer);
      expect(newBlock.holder.parentElement).not.toBe(workingArea);
    });

    it('should place new top-level block at workingArea root when previous block is nested inside a callout', () => {
      const blocks = createBlocks();

      /**
       * Regression for Enter-at-start-after-callout bug.
       *
       * Flat array: [callout, nestedChild, textBlock]
       *   - callout.holder: direct workingArea child
       *   - nestedChild.holder: inside callout.holder > childContainer (data-blok-nested-blocks)
       *   - textBlock.holder: direct workingArea child
       *
       * User caret at offset 0 of textBlock, presses Enter. keyboardNavigation
       * inserts a new top-level block at index 2 (the index of textBlock), with
       * `forceTopLevel: true` because currentBlock.parentId === null.
       *
       * The new block must land at workingArea level, immediately before textBlock,
       * NOT inside callout's nested container. Without the fix, Blocks.insert would
       * anchor on nestedChild (blocks[1]) and insertAdjacentElement('afterend', ...)
       * would place the new holder inside callout's nested container.
       */
      const callout = createMockBlock('callout-1', 'callout');
      const nestedChild = createMockBlock('nested-1', 'paragraph');
      const textBlock = createMockBlock('text-1', 'paragraph');

      blocks.push(callout);

      // Build callout's nested-blocks container and move nestedChild into it
      const nestedContainer = document.createElement('div');

      nestedContainer.setAttribute('data-blok-nested-blocks', '');
      callout.holder.appendChild(nestedContainer);
      nestedContainer.appendChild(nestedChild.holder);
      blocks.blocks.push(nestedChild);

      // textBlock is top-level
      workingArea.appendChild(textBlock.holder);
      blocks.blocks.push(textBlock);

      // Now insert a new top-level block at index 2 with forceTopLevel
      const newBlock = createMockBlock('new-1', 'paragraph');

      blocks.insert(2, newBlock, false, false, true);

      // New block must be at workingArea level
      expect(newBlock.holder.parentElement).toBe(workingArea);
      // Must NOT land inside callout's nested container
      expect(nestedContainer.contains(newBlock.holder)).toBe(false);
      // Must be immediately before textBlock in DOM
      expect(newBlock.holder.nextElementSibling).toBe(textBlock.holder);
    });

    it('should append new top-level block to workingArea end when no top-level block follows (forceTopLevel)', () => {
      const blocks = createBlocks();

      const callout = createMockBlock('callout-1', 'callout');
      const nestedChild = createMockBlock('nested-1', 'paragraph');

      blocks.push(callout);

      const nestedContainer = document.createElement('div');

      nestedContainer.setAttribute('data-blok-nested-blocks', '');
      callout.holder.appendChild(nestedContainer);
      nestedContainer.appendChild(nestedChild.holder);
      blocks.blocks.push(nestedChild);

      // Insert at index 2 (end) with forceTopLevel — no top-level sibling after
      const newBlock = createMockBlock('new-1', 'paragraph');

      blocks.insert(2, newBlock, false, false, true);

      expect(newBlock.holder.parentElement).toBe(workingArea);
      expect(nestedContainer.contains(newBlock.holder)).toBe(false);
      // Should be last child of workingArea
      expect(workingArea.lastElementChild).toBe(newBlock.holder);
    });

    it('should handle replace followed by remove', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.push(block1);

      blocks.replace(0, block2);

      expect(blocks.blocks[0]).toBe(block2);

      blocks.remove(0);

      expect(blocks.length).toBe(0);
    });
  });

  describe('addToArray', () => {
    it('adds block to the array at the specified index without DOM insertion', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.push(block1);

      blocks.addToArray(1, block2);

      expect(blocks.blocks[1]).toBe(block2);
      expect(blocks.length).toBe(2);

      // Block should NOT be in the DOM
      expect(block2.holder.parentElement).toBeNull();
      expect(workingArea.contains(block2.holder)).toBe(false);

      // RENDERED should NOT have been called
      expect(block2.call).not.toHaveBeenCalled();
    });

    it('inserts at the correct position in a non-empty array', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');
      const block3 = createMockBlock('block-3');

      blocks.push(block1);
      blocks.push(block3);

      blocks.addToArray(1, block2);

      expect(blocks.blocks[0]).toBe(block1);
      expect(blocks.blocks[1]).toBe(block2);
      expect(blocks.blocks[2]).toBe(block3);
    });

    describe('invalid index guard (regression: wrong-block-dropped)', () => {
      /**
       * Same splice-negative vulnerability as Blocks.move/insert/insertMany.
       * addToArray is called by yjs-sync batch-add during undo of hierarchical
       * blocks — if any stale index slips in, splice(-1, 0, block) would
       * silently corrupt the array and cause a later move to drop the wrong
       * block. Guard rejects negative indices at the lowest level.
       */
      it('should be a no-op when index is -1', () => {
        const blocks = createBlocks();
        const block1 = createMockBlock('block-1');
        const block2 = createMockBlock('block-2');
        const newBlock = createMockBlock('new-block');

        blocks.push(block1);
        blocks.push(block2);

        blocks.addToArray(-1, newBlock);

        expect(blocks.length).toBe(2);
        expect(blocks.blocks[0]).toBe(block1);
        expect(blocks.blocks[1]).toBe(block2);
      });
    });
  });

  describe('activateBlock', () => {
    it('inserts block into DOM and calls RENDERED when holder is not connected', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');

      // Add to array only (no DOM)
      blocks.addToArray(0, block1);

      expect(block1.holder.parentElement).toBeNull();

      blocks.activateBlock(block1);

      // Now it should be in DOM and RENDERED called
      expect(workingArea.contains(block1.holder)).toBe(true);
      expect(block1.call).toHaveBeenCalledWith(BlockToolAPI.RENDERED);
    });

    it('only calls RENDERED (no DOM move) when holder already has a parent', () => {
      const blocks = createBlocks();
      const tableBlock = createMockBlock('table-1');
      const cellBlock = createMockBlock('cell-1');

      // Table is in DOM
      blocks.push(tableBlock);

      // Cell is in array but its holder is inside the table (simulating mountBlocksInCell)
      blocks.addToArray(1, cellBlock);
      tableBlock.holder.appendChild(cellBlock.holder);

      // Cell holder has a parent element (the table holder)
      expect(cellBlock.holder.parentElement).toBe(tableBlock.holder);

      (cellBlock.call as ReturnType<typeof vi.fn>).mockClear();
      blocks.activateBlock(cellBlock);

      // Should only call RENDERED, not move the holder
      expect(cellBlock.call).toHaveBeenCalledWith(BlockToolAPI.RENDERED);
      // Should still be inside the table, not moved to working area
      expect(tableBlock.holder.contains(cellBlock.holder)).toBe(true);
    });

    it('positions block relative to previous block in array when not connected', () => {
      const blocks = createBlocks();
      const block1 = createMockBlock('block-1');
      const block2 = createMockBlock('block-2');

      blocks.push(block1);
      blocks.addToArray(1, block2);

      blocks.activateBlock(block2);

      // block2 should be after block1 in the DOM
      const children = Array.from(workingArea.children);
      expect(children.indexOf(block1.holder)).toBeLessThan(children.indexOf(block2.holder));
    });
  });
});

