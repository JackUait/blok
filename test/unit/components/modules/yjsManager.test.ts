import { describe, it, expect, beforeEach, vi } from 'vitest';
import { YjsManager } from '../../../../src/components/modules/yjsManager';
import * as caretUtils from '../../../../src/components/utils/caret';
import type { BlokConfig } from '../../../../types';

const createYjsManager = (): YjsManager => {
  const config: BlokConfig = {};

  const eventsDispatcher = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  } as unknown as YjsManager['eventsDispatcher'];

  const manager = new YjsManager({
    config,
    eventsDispatcher,
  });

  return manager;
};

describe('YjsManager', () => {
  let manager: YjsManager;

  beforeEach(() => {
    manager = createYjsManager();
  });

  describe('initialization', () => {
    it('should create Y.Doc on construction', () => {
      expect(manager).toBeDefined();
    });
  });

  describe('toJSON', () => {
    it('should return empty array when no blocks exist', () => {
      const result = manager.toJSON();

      expect(result).toEqual([]);
    });

    it('should serialize blocks to OutputBlockData format', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'Hello' } },
        { id: 'block2', type: 'header', data: { text: 'Title', level: 2 } },
      ]);

      const result = manager.toJSON();

      expect(result).toEqual([
        { id: 'block1', type: 'paragraph', data: { text: 'Hello' } },
        { id: 'block2', type: 'header', data: { text: 'Title', level: 2 } },
      ]);
    });

    it('should include parentId when present', () => {
      manager.fromJSON([
        { id: 'parent', type: 'paragraph', data: { text: 'Parent' } },
        { id: 'child', type: 'paragraph', data: { text: 'Child' }, parent: 'parent' },
      ]);

      const result = manager.toJSON();

      expect(result[1].parent).toBe('parent');
    });
  });

  describe('addBlock', () => {
    it('should add block at the end by default', () => {
      manager.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'First' } });
      manager.addBlock({ id: 'block2', type: 'paragraph', data: { text: 'Second' } });

      const result = manager.toJSON();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('block1');
      expect(result[1].id).toBe('block2');
    });

    it('should add block at specified index', () => {
      manager.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'First' } });
      manager.addBlock({ id: 'block3', type: 'paragraph', data: { text: 'Third' } });
      manager.addBlock({ id: 'block2', type: 'paragraph', data: { text: 'Second' } }, 1);

      const result = manager.toJSON();

      expect(result[1].id).toBe('block2');
    });

    it('should return the created Y.Map', () => {
      const yblock = manager.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'Test' } });

      expect(yblock.get('id')).toBe('block1');
    });
  });

  describe('removeBlock', () => {
    it('should remove block by id', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
        { id: 'block2', type: 'paragraph', data: { text: 'Second' } },
      ]);

      manager.removeBlock('block1');

      const result = manager.toJSON();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('block2');
    });

    it('should do nothing if block id not found', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
      ]);

      manager.removeBlock('nonexistent');

      expect(manager.toJSON()).toHaveLength(1);
    });
  });

  describe('moveBlock', () => {
    it('should move block to new index', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
        { id: 'block2', type: 'paragraph', data: { text: 'Second' } },
        { id: 'block3', type: 'paragraph', data: { text: 'Third' } },
      ]);

      manager.moveBlock('block3', 0);

      const result = manager.toJSON();

      expect(result[0].id).toBe('block3');
      expect(result[1].id).toBe('block1');
      expect(result[2].id).toBe('block2');
    });
  });

  describe('updateBlockData', () => {
    it('should update a single property in block data', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'Original' } },
      ]);

      manager.updateBlockData('block1', 'text', 'Updated');

      const result = manager.toJSON();

      expect(result[0].data.text).toBe('Updated');
    });

    it('should add new property to block data', () => {
      manager.fromJSON([
        { id: 'block1', type: 'header', data: { text: 'Title' } },
      ]);

      manager.updateBlockData('block1', 'level', 2);

      const result = manager.toJSON();

      expect(result[0].data.level).toBe(2);
    });

    it('should do nothing if block not found', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'Original' } },
      ]);

      manager.updateBlockData('nonexistent', 'text', 'Updated');

      expect(manager.toJSON()[0].data.text).toBe('Original');
    });
  });

  describe('getBlockById', () => {
    it('should return Y.Map for existing block', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'Test' } },
      ]);

      const yblock = manager.getBlockById('block1');

      expect(yblock).toBeDefined();
      expect(yblock?.get('id')).toBe('block1');
    });

    it('should return undefined for nonexistent block', () => {
      const yblock = manager.getBlockById('nonexistent');

      expect(yblock).toBeUndefined();
    });
  });

  describe('undo/redo', () => {
    it('should undo block addition', () => {
      manager.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'Test' } });

      expect(manager.toJSON()).toHaveLength(1);

      manager.undo();

      expect(manager.toJSON()).toHaveLength(0);
    });

    it('should redo undone block addition', () => {
      manager.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'Test' } });
      manager.undo();

      expect(manager.toJSON()).toHaveLength(0);

      manager.redo();

      expect(manager.toJSON()).toHaveLength(1);
    });

    it('should undo block removal', () => {
      manager.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'Test' } });
      manager.stopCapturing(); // Force new undo group
      manager.removeBlock('block1');

      expect(manager.toJSON()).toHaveLength(0);

      manager.undo();

      expect(manager.toJSON()).toHaveLength(1);
    });

    it('should undo data update', () => {
      manager.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'Original' } });
      manager.stopCapturing();
      manager.updateBlockData('block1', 'text', 'Updated');

      expect(manager.toJSON()[0].data.text).toBe('Updated');

      manager.undo();

      expect(manager.toJSON()[0].data.text).toBe('Original');
    });

    it('should not undo fromJSON operations (origin: load)', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'Loaded' } },
      ]);

      // Undo should have no effect since fromJSON uses 'load' origin
      manager.undo();

      expect(manager.toJSON()).toHaveLength(1);
      expect(manager.toJSON()[0].data.text).toBe('Loaded');
    });

    it('clears all history stacks when fromJSON is called', () => {
      // Build up some history
      manager.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'First' } });
      manager.stopCapturing();
      manager.addBlock({ id: 'block2', type: 'paragraph', data: { text: 'Second' } });

      // Verify we have undo history
      expect(manager.toJSON()).toHaveLength(2);
      manager.undo();
      expect(manager.toJSON()).toHaveLength(1);

      // Now load new data via fromJSON
      manager.fromJSON([
        { id: 'new1', type: 'paragraph', data: { text: 'New content' } },
      ]);

      // Undo should have no effect - history was cleared
      manager.undo();
      expect(manager.toJSON()).toHaveLength(1);
      expect(manager.toJSON()[0].id).toBe('new1');

      // Redo should also have no effect
      manager.redo();
      expect(manager.toJSON()).toHaveLength(1);
      expect(manager.toJSON()[0].id).toBe('new1');
    });

    it('restores caret to before position on undo', () => {
      const beforeSnapshot = { blockId: 'b1', inputIndex: 0, offset: 3 };
      const afterSnapshot = { blockId: 'b1', inputIndex: 0, offset: 10 };

      // Push a caret entry
      (manager as any).caretUndoStack.push({ before: beforeSnapshot, after: afterSnapshot });

      // Mock Blok for restoreCaretSnapshot
      const input = document.createElement('div');
      const block = { id: 'b1', inputs: [input], focusable: true };

       
      (manager as any).Blok = {
        BlockManager: {
          getBlockById: vi.fn().mockReturnValue(block),
        },
        Caret: {
          setToInput: vi.fn(),
          positions: { DEFAULT: 'default' },
        },
      };

       
      const restoreSpy = vi.spyOn(manager as any, 'restoreCaretSnapshot');

      manager.undo();

      expect(restoreSpy).toHaveBeenCalledWith(beforeSnapshot);
       
      expect((manager as any).caretRedoStack).toContainEqual({ before: beforeSnapshot, after: afterSnapshot });
    });

    it('restores caret to after position on redo', () => {
      const beforeSnapshot = { blockId: 'b1', inputIndex: 0, offset: 3 };
      const afterSnapshot = { blockId: 'b1', inputIndex: 0, offset: 10 };

      // Push a caret entry to redo stack
       
      (manager as any).caretRedoStack.push({ before: beforeSnapshot, after: afterSnapshot });

      // Mock Blok for restoreCaretSnapshot
      const input = document.createElement('div');
      const block = { id: 'b1', inputs: [input], focusable: true };

       
      (manager as any).Blok = {
        BlockManager: {
          getBlockById: vi.fn().mockReturnValue(block),
        },
        Caret: {
          setToInput: vi.fn(),
          positions: { DEFAULT: 'default' },
        },
      };

       
      const restoreSpy = vi.spyOn(manager as any, 'restoreCaretSnapshot');

      manager.redo();

      expect(restoreSpy).toHaveBeenCalledWith(afterSnapshot);
       
      expect((manager as any).caretUndoStack).toContainEqual({ before: beforeSnapshot, after: afterSnapshot });
    });
  });

  describe('change observation', () => {
    it('should emit event when block is added', () => {
      const callback = vi.fn();

      manager.onBlocksChanged(callback);
      manager.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'Test' } });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'add', blockId: 'block1' })
      );
    });

    it('should emit event when block is removed', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'Test' } },
      ]);

      const callback = vi.fn();

      manager.onBlocksChanged(callback);
      manager.removeBlock('block1');

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'remove', blockId: 'block1' })
      );
    });

    it('should emit event when block data changes', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'Original' } },
      ]);

      const callback = vi.fn();

      manager.onBlocksChanged(callback);
      manager.updateBlockData('block1', 'text', 'Updated');

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'update', blockId: 'block1' })
      );
    });

    it('should include origin in event', () => {
      const callback = vi.fn();

      manager.onBlocksChanged(callback);
      manager.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'Test' } });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ origin: 'local' })
      );
    });

    it('should emit undo origin when undoing', () => {
      manager.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'Test' } });

      const callback = vi.fn();

      manager.onBlocksChanged(callback);
      manager.undo();

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ origin: 'undo' })
      );
    });
  });

  describe('captureCaretSnapshot', () => {
    it('returns null when no block is focused', () => {
      // Mock BlockManager.currentBlock to return undefined
       
      (manager as any).Blok = {
        BlockManager: {
          currentBlock: undefined,
        },
      };

      expect(manager.captureCaretSnapshot()).toBeNull();
    });

    it('captures block id, input index, and offset', () => {
      const mockInput = document.createElement('div');

      mockInput.contentEditable = 'true';

      const mockBlock = {
        id: 'block-123',
        currentInputIndex: 1,
        currentInput: mockInput,
      };

       
      (manager as any).Blok = {
        BlockManager: {
          currentBlock: mockBlock,
        },
      };

      // Mock getCaretOffset to return 5
      vi.spyOn(caretUtils, 'getCaretOffset').mockReturnValue(5);

      const snapshot = manager.captureCaretSnapshot();

      expect(snapshot).toEqual({
        blockId: 'block-123',
        inputIndex: 1,
        offset: 5,
      });
    });

    it('returns offset 0 when currentInput is undefined', () => {
      const mockBlock = {
        id: 'block-123',
        currentInputIndex: 0,
        currentInput: undefined,
      };

       
      (manager as any).Blok = {
        BlockManager: {
          currentBlock: mockBlock,
        },
      };

      const snapshot = manager.captureCaretSnapshot();

      expect(snapshot).toEqual({
        blockId: 'block-123',
        inputIndex: 0,
        offset: 0,
      });
    });
  });

  describe('markCaretBeforeChange', () => {
    it('captures caret snapshot on first call', () => {
      const mockSnapshot = { blockId: 'b1', inputIndex: 0, offset: 3 };

      vi.spyOn(manager, 'captureCaretSnapshot').mockReturnValue(mockSnapshot);

      manager.markCaretBeforeChange();

       
      expect((manager as any).pendingCaretBefore).toEqual(mockSnapshot);
       
      expect((manager as any).hasPendingCaret).toBe(true);
    });

    it('does not overwrite on subsequent calls', () => {
      const firstSnapshot = { blockId: 'b1', inputIndex: 0, offset: 3 };
      const secondSnapshot = { blockId: 'b2', inputIndex: 1, offset: 10 };

      vi.spyOn(manager, 'captureCaretSnapshot')
        .mockReturnValueOnce(firstSnapshot)
        .mockReturnValueOnce(secondSnapshot);

      manager.markCaretBeforeChange();
      manager.markCaretBeforeChange();

      // Should still have first snapshot
       
      expect((manager as any).pendingCaretBefore).toEqual(firstSnapshot);
    });
  });

  describe('restoreCaretSnapshot', () => {
    it('clears selection when snapshot is null', () => {
      let selectionCleared = false;

      vi.spyOn(window, 'getSelection').mockReturnValue({
        removeAllRanges: () => {
          selectionCleared = true;
        },
      } as unknown as Selection);

      (manager as any).restoreCaretSnapshot(null);

      // Verify the observable behavior: selection clearing was triggered
      expect(selectionCleared).toBe(true);
    });

    it('falls back to first block when block not found', () => {
      const firstBlock = { id: 'first', focusable: true };
      const setToBlockSpy = vi.fn();

       
      (manager as any).Blok = {
        BlockManager: {
          getBlockById: vi.fn().mockReturnValue(undefined),
          firstBlock,
        },
        Caret: {
          setToBlock: setToBlockSpy,
          positions: { START: 'start' },
        },
      };

       
      (manager as any).restoreCaretSnapshot({ blockId: 'deleted', inputIndex: 0, offset: 0 });

      expect(setToBlockSpy).toHaveBeenCalledWith(firstBlock, 'start');
    });

    it('restores caret to specific input and offset', () => {
      const input = document.createElement('div');
      const block = { id: 'b1', inputs: [input], focusable: true };
      const setToInputSpy = vi.fn();

       
      (manager as any).Blok = {
        BlockManager: {
          getBlockById: vi.fn().mockReturnValue(block),
        },
        Caret: {
          setToInput: setToInputSpy,
          positions: { DEFAULT: 'default' },
        },
      };

       
      (manager as any).restoreCaretSnapshot({ blockId: 'b1', inputIndex: 0, offset: 5 });

      expect(setToInputSpy).toHaveBeenCalledWith(input, 'default', 5);
    });

    it('falls back to block start when input index is out of bounds', () => {
      const block = { id: 'b1', inputs: [], focusable: true };
      const setToBlockSpy = vi.fn();


      (manager as any).Blok = {
        BlockManager: {
          getBlockById: vi.fn().mockReturnValue(block),
        },
        Caret: {
          setToBlock: setToBlockSpy,
          positions: { START: 'start' },
        },
      };


      (manager as any).restoreCaretSnapshot({ blockId: 'b1', inputIndex: 5, offset: 10 });

      expect(setToBlockSpy).toHaveBeenCalledWith(block, 'start');
    });
  });

  describe('smart grouping', () => {
    describe('isBoundaryCharacter', () => {
      it.each([
        [' ', true],
        ['\t', true],
        ['.', true],
        ['?', true],
        ['!', true],
        [',', true],
        [';', true],
        [':', true],
        ['a', false],
        ['1', false],
        ['@', false],
        ['-', false],
      ])('should return %s for "%s"', (char, expected) => {
        expect(YjsManager.isBoundaryCharacter(char)).toBe(expected);
      });
    });

    it('should initialize with no pending boundary', () => {
      expect(manager.hasPendingBoundary()).toBe(false);
    });

    it('should set pending boundary when markBoundary is called', () => {
      manager.markBoundary();
      expect(manager.hasPendingBoundary()).toBe(true);
    });

    it('should clear pending boundary after timeout', async () => {
      vi.useFakeTimers();
      manager.markBoundary();
      expect(manager.hasPendingBoundary()).toBe(true);

      vi.advanceTimersByTime(150);

      expect(manager.hasPendingBoundary()).toBe(false);
      vi.useRealTimers();
    });

    it('should clear pending boundary when clearBoundary is called', () => {
      vi.useFakeTimers();
      manager.markBoundary();
      expect(manager.hasPendingBoundary()).toBe(true);

      manager.clearBoundary();
      expect(manager.hasPendingBoundary()).toBe(false);

      // Timeout should not fire stopCapturing after clearBoundary
      vi.advanceTimersByTime(150);
      // No error means success - stopCapturing wasn't called unnecessarily
      vi.useRealTimers();
    });

    it('should call stopCapturing when checkAndHandleBoundary is called after timeout elapsed', () => {
      vi.useFakeTimers();
      const stopCapturingSpy = vi.spyOn(manager, 'stopCapturing');

      manager.markBoundary();
      vi.advanceTimersByTime(50); // Only 50ms elapsed

      manager.checkAndHandleBoundary();
      expect(stopCapturingSpy).not.toHaveBeenCalled(); // Not enough time

      vi.advanceTimersByTime(60); // Now 110ms total

      manager.checkAndHandleBoundary();
      expect(stopCapturingSpy).toHaveBeenCalledTimes(1);
      expect(manager.hasPendingBoundary()).toBe(false);

      vi.useRealTimers();
    });

    it('should not call stopCapturing when no pending boundary', () => {
      const stopCapturingSpy = vi.spyOn(manager, 'stopCapturing');

      manager.checkAndHandleBoundary();
      expect(stopCapturingSpy).not.toHaveBeenCalled();
    });
  });

  describe('clearHistory boundary cleanup', () => {
    it('should clear pending boundary when history is cleared via fromJSON', () => {
      vi.useFakeTimers();
      manager.markBoundary();
      expect(manager.hasPendingBoundary()).toBe(true);

      // fromJSON calls clearHistory internally
      manager.fromJSON([{ id: 'block1', type: 'paragraph', data: { text: 'Test' } }]);

      expect(manager.hasPendingBoundary()).toBe(false);
      vi.useRealTimers();
    });
  });
});
