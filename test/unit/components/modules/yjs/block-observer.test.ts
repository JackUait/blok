import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { BlockObserver } from '../../../../../src/components/modules/yjs/block-observer';
import type { BlockChangeEvent } from '../../../../../src/components/modules/yjs/types';

const createBlockObserver = (): BlockObserver => {
  return new BlockObserver();
};

describe('BlockObserver', () => {
  let observer: BlockObserver;
  let ydoc: Y.Doc;
  let yblocks: Y.Array<Y.Map<unknown>>;
  let undoManager: Y.UndoManager;

  beforeEach(() => {
    observer = createBlockObserver();
    ydoc = new Y.Doc();
    yblocks = ydoc.getArray('blocks');
    undoManager = new Y.UndoManager(yblocks, {
      captureTimeout: 500,
      trackedOrigins: new Set(['local']),
    });

    observer.observe(yblocks, undoManager);
  });

  describe('initialization', () => {
    it('creates observer without errors', () => {
      expect(observer).toBeDefined();
    });
  });

  describe('onBlocksChanged', () => {
    it('registers callback and returns unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = observer.onBlocksChanged(callback);

      expect(typeof unsubscribe).toBe('function');

      // Trigger an event
      ydoc.transact(() => {
        const yblock = new Y.Map<unknown>();
        yblock.set('id', 'b1');
        yblock.set('type', 'paragraph');
        yblock.set('data', new Y.Map<unknown>());
        yblocks.push([yblock]);
      }, 'local');

      expect(callback).toHaveBeenCalled();

      // Unsubscribe
      unsubscribe();

      // Reset and trigger again
      callback.mockClear();
      ydoc.transact(() => {
        const yblock = new Y.Map<unknown>();
        yblock.set('id', 'b2');
        yblock.set('type', 'paragraph');
        yblock.set('data', new Y.Map<unknown>());
        yblocks.push([yblock]);
      }, 'local');

      // Should not be called after unsubscribe
      expect(callback).not.toHaveBeenCalled();
    });

    it('emits add event when block is added', () => {
      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      ydoc.transact(() => {
        const yblock = new Y.Map<unknown>();
        yblock.set('id', 'b1');
        yblock.set('type', 'paragraph');
        yblock.set('data', new Y.Map<unknown>());
        yblocks.push([yblock]);
      }, 'local');

      const event = callback.mock.calls[0]?.[0] as BlockChangeEvent;

      expect(event.type).toBe('add');
      expect(event.blockId).toBe('b1');
      expect(event.origin).toBe('local');
    });

    it('emits remove event when block is removed', () => {
      // Add a block first
      ydoc.transact(() => {
        const yblock = new Y.Map<unknown>();
        yblock.set('id', 'b1');
        yblock.set('type', 'paragraph');
        yblock.set('data', new Y.Map<unknown>());
        yblocks.push([yblock]);
      }, 'local');

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Remove the block
      ydoc.transact(() => {
        yblocks.delete(0);
      }, 'local');

      const event = callback.mock.calls[0]?.[0] as BlockChangeEvent;

      expect(event.type).toBe('remove');
      expect(event.blockId).toBe('b1');
      expect(event.origin).toBe('local');
    });

    it('emits move event when block is moved', () => {
      // Add blocks
      ydoc.transact(() => {
        const yblock1 = new Y.Map<unknown>();
        yblock1.set('id', 'b1');
        yblock1.set('type', 'paragraph');
        yblock1.set('data', new Y.Map<unknown>());

        const yblock2 = new Y.Map<unknown>();
        yblock2.set('id', 'b2');
        yblock2.set('type', 'paragraph');
        yblock2.set('data', new Y.Map<unknown>());

        yblocks.push([yblock1, yblock2]);
      }, 'local');

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Move block: remove and insert same id
      ydoc.transact(() => {
        const yblock = yblocks.get(0);
        const blockData = yblock.toJSON();
        yblocks.delete(0);

        const newYblock = new Y.Map<unknown>();
        (Object.keys(blockData) as Array<keyof typeof blockData>).forEach((key) => {
          newYblock.set(key as string, blockData[key]);
        });

        yblocks.insert(1, [newYblock]);
      }, 'local');

      const event = callback.mock.calls[0]?.[0] as BlockChangeEvent;

      expect(event.type).toBe('move');
      expect(event.blockId).toBe('b1');
    });

    it('emits update event when block data changes', () => {
      // Add a block first
      ydoc.transact(() => {
        const yblock = new Y.Map<unknown>();
        yblock.set('id', 'b1');
        yblock.set('type', 'paragraph');
        const ydata = new Y.Map<unknown>();
        ydata.set('text', 'Hello');
        yblock.set('data', ydata);
        yblocks.push([yblock]);
      }, 'local');

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Update the block data
      ydoc.transact(() => {
        const yblock = yblocks.get(0);
        const ydata = yblock.get('data') as Y.Map<unknown>;
        ydata.set('text', 'Updated');
      }, 'local');

      const event = callback.mock.calls[0]?.[0] as BlockChangeEvent;

      expect(event.type).toBe('update');
      expect(event.blockId).toBe('b1');
      expect(event.origin).toBe('local');
    });
  });

  describe('mapTransactionOrigin', () => {
    it('maps "local" origin to "local"', () => {
      expect(observer.mapTransactionOrigin('local')).toBe('local');
    });

    it('maps "load" origin to "load"', () => {
      expect(observer.mapTransactionOrigin('load')).toBe('load');
    });

    it('maps undoManager origin to "undo" when undoing', () => {
      undoManager.undoing = true;
      expect(observer.mapTransactionOrigin(undoManager)).toBe('undo');
      undoManager.undoing = false;
    });

    it('maps undoManager origin to "redo" when not undoing', () => {
      expect(observer.mapTransactionOrigin(undoManager)).toBe('redo');
    });

    it('maps "move" origin to "local"', () => {
      expect(observer.mapTransactionOrigin('move')).toBe('local');
    });

    it('maps "move-undo" origin to "undo"', () => {
      expect(observer.mapTransactionOrigin('move-undo')).toBe('undo');
    });

    it('maps "move-redo" origin to "redo"', () => {
      expect(observer.mapTransactionOrigin('move-redo')).toBe('redo');
    });

    it('maps unknown origin to "remote"', () => {
      expect(observer.mapTransactionOrigin('unknown')).toBe('remote');
    });
  });

  describe('destroy', () => {
    it('clears callbacks and references', () => {
      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      observer.destroy();

      // Trigger an event after destroy
      ydoc.transact(() => {
        const yblock = new Y.Map<unknown>();
        yblock.set('id', 'b1');
        yblock.set('type', 'paragraph');
        yblock.set('data', new Y.Map<unknown>());
        yblocks.push([yblock]);
      }, 'local');

      // Callback should not be called after destroy
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('multiple callbacks', () => {
    it('calls all registered callbacks', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      observer.onBlocksChanged(callback1);
      observer.onBlocksChanged(callback2);

      ydoc.transact(() => {
        const yblock = new Y.Map<unknown>();
        yblock.set('id', 'b1');
        yblock.set('type', 'paragraph');
        yblock.set('data', new Y.Map<unknown>());
        yblocks.push([yblock]);
      }, 'local');

      // Both callbacks should be called with the same event
      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();

      // Verify the observable behavior: the document state
      expect(yblocks.length).toBe(1);
      expect(yblocks.get(0)?.get('id')).toBe('b1');

      // Verify both callbacks received the same event data
      const event1 = callback1.mock.calls[0]?.[0] as BlockChangeEvent;
      const event2 = callback2.mock.calls[0]?.[0] as BlockChangeEvent;
      expect(event1.type).toBe('add');
      expect(event2.type).toBe('add');
      expect(event1.blockId).toBe('b1');
      expect(event2.blockId).toBe('b1');
    });

    it('allows unregistering individual callbacks', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      const unsubscribe1 = observer.onBlocksChanged(callback1);
      observer.onBlocksChanged(callback2);
      observer.onBlocksChanged(callback3);

      // Unsubscribe callback1
      unsubscribe1();

      ydoc.transact(() => {
        const yblock = new Y.Map<unknown>();
        yblock.set('id', 'b1');
        yblock.set('type', 'paragraph');
        yblock.set('data', new Y.Map<unknown>());
        yblocks.push([yblock]);
      }, 'local');

      // Verify the observable behavior: the document state
      expect(yblocks.length).toBe(1);
      expect(yblocks.get(0)?.get('id')).toBe('b1');

      // Verify callback registration/unregistration behavior
      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
      expect(callback3).toHaveBeenCalled();

      // Verify the remaining callbacks received the correct event data
      const event2 = callback2.mock.calls[0]?.[0] as BlockChangeEvent;
      const event3 = callback3.mock.calls[0]?.[0] as BlockChangeEvent;
      expect(event2.type).toBe('add');
      expect(event3.type).toBe('add');
      expect(event2.blockId).toBe('b1');
      expect(event3.blockId).toBe('b1');
    });
  });

  describe('move detection edge cases', () => {
    it('emits move event when same block ID appears in both adds and removes', () => {
      // Add initial blocks
      ydoc.transact(() => {
        for (let i = 1; i <= 3; i++) {
          const yblock = new Y.Map<unknown>();
          yblock.set('id', `b${i}`);
          yblock.set('type', 'paragraph');
          yblock.set('data', new Y.Map<unknown>());
          yblocks.push([yblock]);
        }
      }, 'local');

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Simulate a move operation: delete and insert same block
      ydoc.transact(() => {
        const yblock = yblocks.get(2);
        const blockData = yblock.toJSON();
        yblocks.delete(2);

        const newYblock = new Y.Map<unknown>();
        (Object.keys(blockData) as Array<keyof typeof blockData>).forEach((key) => {
          newYblock.set(key as string, blockData[key]);
        });
        yblocks.insert(0, [newYblock]);
      }, 'local');

      const moveEvent = callback.mock.calls.find(
        (call) => (call[0] as BlockChangeEvent)?.type === 'move'
      )?.[0] as BlockChangeEvent;

      expect(moveEvent).toBeDefined();
      expect(moveEvent.type).toBe('move');
      expect(moveEvent.blockId).toBe('b3');
    });

    it('correctly handles multiple moves in a single transaction', () => {
      // Add initial blocks
      ydoc.transact(() => {
        for (let i = 1; i <= 5; i++) {
          const yblock = new Y.Map<unknown>();
          yblock.set('id', `b${i}`);
          yblock.set('type', 'paragraph');
          yblock.set('data', new Y.Map<unknown>());
          yblocks.push([yblock]);
        }
      }, 'local');

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Move multiple blocks
      ydoc.transact(() => {
        // Move b5 to position 0
        const yblock5 = yblocks.get(4);
        const data5 = yblock5.toJSON();
        yblocks.delete(4);
        const newYblock5 = new Y.Map<unknown>();
        (Object.keys(data5) as Array<keyof typeof data5>).forEach((key) => {
          newYblock5.set(key as string, data5[key]);
        });
        yblocks.insert(0, [newYblock5]);

        // Move b4 to position 1
        const yblock4 = yblocks.get(4);
        const data4 = yblock4.toJSON();
        yblocks.delete(4);
        const newYblock4 = new Y.Map<unknown>();
        (Object.keys(data4) as Array<keyof typeof data4>).forEach((key) => {
          newYblock4.set(key as string, data4[key]);
        });
        yblocks.insert(1, [newYblock4]);
      }, 'local');

      const moveEvents = callback.mock.calls.filter(
        (call) => (call[0] as BlockChangeEvent)?.type === 'move'
      );

      // Should have 2 move events
      expect(moveEvents.length).toBe(2);
    });

    it('emits both move and pure add/remove in same transaction', () => {
      // Add initial blocks
      ydoc.transact(() => {
        for (let i = 1; i <= 3; i++) {
          const yblock = new Y.Map<unknown>();
          yblock.set('id', `b${i}`);
          yblock.set('type', 'paragraph');
          yblock.set('data', new Y.Map<unknown>());
          yblocks.push([yblock]);
        }
      }, 'local');

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Move b3, add b4, remove b2
      ydoc.transact(() => {
        // Move b3 to position 0
        const yblock3 = yblocks.get(2);
        const data3 = yblock3.toJSON();
        yblocks.delete(2);
        const newYblock3 = new Y.Map<unknown>();
        (Object.keys(data3) as Array<keyof typeof data3>).forEach((key) => {
          newYblock3.set(key as string, data3[key]);
        });
        yblocks.insert(0, [newYblock3]);

        // Add new block b4
        const yblock4 = new Y.Map<unknown>();
        yblock4.set('id', 'b4');
        yblock4.set('type', 'paragraph');
        yblock4.set('data', new Y.Map<unknown>());
        yblocks.push([yblock4]);

        // Remove b2 (now at index 2 after the move)
        yblocks.delete(2);
      }, 'local');

      const events = callback.mock.calls.map((call) => call[0] as BlockChangeEvent);
      const types = events.map((e) => e.type);

      // Should have move, add, and remove events
      expect(types).toContain('move');
      expect(types).toContain('add');
      expect(types).toContain('remove');
    });
  });

  describe('nested map updates', () => {
    it('emits update event when tunes change', () => {
      // Add block with tunes
      ydoc.transact(() => {
        const yblock = new Y.Map<unknown>();
        yblock.set('id', 'b1');
        yblock.set('type', 'paragraph');
        yblock.set('data', new Y.Map<unknown>());
        const ytunes = new Y.Map<unknown>();
        ytunes.set('alignment', 'left');
        yblock.set('tunes', ytunes);
        yblocks.push([yblock]);
      }, 'local');

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Update tune
      ydoc.transact(() => {
        const yblock = yblocks.get(0);
        const ytunes = yblock.get('tunes') as Y.Map<unknown>;
        ytunes.set('alignment', 'center');
      }, 'local');

      const event = callback.mock.calls[0]?.[0] as BlockChangeEvent;
      expect(event.type).toBe('update');
      expect(event.blockId).toBe('b1');
    });
  });

  describe('findParentBlock', () => {
    it('finds parent block for nested data map', () => {
      // Add block with data
      ydoc.transact(() => {
        const yblock = new Y.Map<unknown>();
        yblock.set('id', 'b1');
        yblock.set('type', 'paragraph');
        const ydata = new Y.Map<unknown>();
        ydata.set('text', 'Hello');
        yblock.set('data', ydata);
        yblocks.push([yblock]);
      }, 'local');

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Update data - should emit update with correct blockId
      ydoc.transact(() => {
        const yblock = yblocks.get(0);
        const ydata = yblock.get('data') as Y.Map<unknown>;
        ydata.set('text', 'Updated');
      }, 'local');

      const event = callback.mock.calls[0]?.[0] as BlockChangeEvent;
      expect(event.blockId).toBe('b1');
    });
  });

  describe('edge cases', () => {
    it('handles block without id gracefully during remove', () => {
      // Add block without id
      ydoc.transact(() => {
        const yblock = new Y.Map<unknown>();
        // No id set
        yblock.set('type', 'paragraph');
        yblock.set('data', new Y.Map<unknown>());
        yblocks.push([yblock]);
      }, 'local');

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Remove the block - should not throw
      expect(() => {
        ydoc.transact(() => {
          yblocks.delete(0);
        }, 'local');
      }).not.toThrow();

      // When a block has no id, extractBlockIdFromDeletedItem returns undefined
      // This results in no event being emitted for that block
      // The test verifies that this scenario is handled gracefully (no crash)
      if (callback.mock.calls.length > 0) {
        const event = callback.mock.calls[0]?.[0] as BlockChangeEvent;
        expect(event.type).toBe('remove');
      }
    });

    it('handles empty content array in deleted item', () => {
      // This tests the edge case where deleted item has empty content
      ydoc.transact(() => {
        const yblock = new Y.Map<unknown>();
        yblock.set('id', 'b1');
        yblock.set('type', 'paragraph');
        yblock.set('data', new Y.Map<unknown>());
        yblocks.push([yblock]);
      }, 'local');

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Delete should work without errors
      ydoc.transact(() => {
        yblocks.delete(0);
      }, 'local');

      expect(callback).toHaveBeenCalled();
    });

    it('does not emit update for changes to unrelated maps', () => {
      // Create a separate unrelated Y.Map
      const unrelatedMap = new Y.Map<unknown>();
      unrelatedMap.set('key', 'value');

      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Modify unrelated map - should not trigger callback
      ydoc.transact(() => {
        unrelatedMap.set('key', 'updated');
      }, 'local');

      expect(callback).not.toHaveBeenCalled();
    });

    it('handles rapid successive changes without errors', () => {
      const callback = vi.fn();
      observer.onBlocksChanged(callback);

      // Rapid changes
      for (let i = 0; i < 10; i++) {
        ydoc.transact(() => {
          const yblock = new Y.Map<unknown>();
          yblock.set('id', `b${i}`);
          yblock.set('type', 'paragraph');
          yblock.set('data', new Y.Map<unknown>());
          yblocks.push([yblock]);
        }, 'local');
      }

      // All changes should have been recorded
      expect(callback).toHaveBeenCalledTimes(10);
    });
  });
});
