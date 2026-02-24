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

    it('should not place inserted block inside a nested container when previous block holder is nested', () => {
      const blocks = createBlocks();

      /**
       * Simulate two consecutive tables: Table1 with a cell block nested inside it,
       * then Table2 after it. When Table2 is deleted and undo restores it,
       * the insert method uses the previous block (cellBlock) as the reference.
       * Since cellBlock's holder is nested inside Table1's DOM, inserting
       * 'afterend' of cellBlock.holder places Table2 INSIDE Table1's cell — a bug.
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

      // Insert a new top-level block at index 2 (after all existing blocks)
      const restoredTable = createMockBlock('table-2', 'table');

      blocks.insert(2, restoredTable);

      // CRITICAL: The restored table must be a direct child of workingArea,
      // not nested inside Table1's cell container
      expect(restoredTable.holder.parentElement).toBe(workingArea);
      expect(tableBlock.holder.contains(restoredTable.holder)).toBe(false);
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

