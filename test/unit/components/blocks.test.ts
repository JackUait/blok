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
        expect.objectContaining({
          detail: expect.objectContaining({
            fromIndex: 1,
            toIndex: 0,
          }),
        })
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

      const removeSpy = vi.spyOn(block1.holder, 'remove');

      blocks.insert(0, block2, true);

      expect(blocks.blocks[0]).toBe(block2);
      expect(blocks.length).toBe(1);
      expect(removeSpy).toHaveBeenCalled();
      expect(block1.call).toHaveBeenCalledWith(BlockToolAPI.REMOVED);
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

      const removeSpy = vi.spyOn(block.holder, 'remove');

      blocks.remove(0);

      expect(removeSpy).toHaveBeenCalled();
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
});

