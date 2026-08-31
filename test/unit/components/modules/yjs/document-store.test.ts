import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import type { OutputBlockData } from '../../../../../types/data-formats/output-data';

const createDocumentStore = (): DocumentStore => {
  const serializer = new YBlockSerializer();
  return new DocumentStore(serializer);
};

describe('DocumentStore', () => {
  let store: DocumentStore;

  beforeEach(() => {
    store = createDocumentStore();
  });

  describe('initialization', () => {
    it('creates Y.Doc on construction', () => {
      expect((store as unknown as { ydoc: unknown }).ydoc).toBeDefined();
      expect(store.yblocks).toBeDefined();
    });

    it('starts with empty blocks array', () => {
      expect(store.toJSON()).toEqual([]);
    });
  });

  describe('addBlock', () => {
    it('adds block at the end by default', () => {
      store.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'First' } });
      store.addBlock({ id: 'block2', type: 'paragraph', data: { text: 'Second' } });

      const result = store.toJSON();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('block1');
      expect(result[1].id).toBe('block2');
    });

    it('adds block at specified index', () => {
      store.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'First' } });
      store.addBlock({ id: 'block3', type: 'paragraph', data: { text: 'Third' } });
      store.addBlock({ id: 'block2', type: 'paragraph', data: { text: 'Second' } }, 1);

      const result = store.toJSON();

      expect(result[1].id).toBe('block2');
    });

    it('returns the created Y.Map', () => {
      const yblock = store.addBlock({
        id: 'block1',
        type: 'paragraph',
        data: { text: 'Test' },
      });

      expect(yblock.get('id')).toBe('block1');
    });

    it('clamps index to array length when index exceeds bounds', () => {
      store.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'First' } });

      // Index 99 exceeds array length of 1 — should clamp to end
      store.addBlock({ id: 'block2', type: 'paragraph', data: { text: 'Second' } }, 99);

      const result = store.toJSON();

      expect(result).toHaveLength(2);
      expect(result[1].id).toBe('block2');
    });

    it('clamps negative index to zero', () => {
      store.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'First' } });

      store.addBlock({ id: 'block2', type: 'paragraph', data: { text: 'Second' } }, -5);

      const result = store.toJSON();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('block2');
    });
  });

  describe('removeBlock', () => {
    it('removes block by id', () => {
      store.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
        { id: 'block2', type: 'paragraph', data: { text: 'Second' } },
      ]);

      store.removeBlock('block1');

      const result = store.toJSON();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('block2');
    });

    it('does nothing if block id not found', () => {
      store.fromJSON([{ id: 'block1', type: 'paragraph', data: { text: 'First' } }]);

      store.removeBlock('nonexistent');

      expect(store.toJSON()).toHaveLength(1);
    });
  });

  describe('replaceBlockContent', () => {
    it('changes type and data in place, preserving id, position and hierarchy', () => {
      store.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
        { id: 'block2', type: 'paragraph', data: { text: 'Second' }, parent: 'block1', content: ['c1'] },
      ]);

      const before = store.getBlockById('block2');

      const result = store.replaceBlockContent('block2', 'list', { text: 'Second', style: 'unordered' });

      expect(result).toBe(true);

      const json = store.toJSON();

      // Same position, same id, other keys untouched.
      expect(json[1].id).toBe('block2');
      expect(json[1].type).toBe('list');
      expect(json[1].data).toEqual({ text: 'Second', style: 'unordered' });
      expect(json[1].parent).toBe('block1');
      expect(json[1].content).toEqual(['c1']);

      // The SAME Y.Map instance is mutated — NOT a remove+add of a new entry.
      // (A remove+add of the same id was misread by BlockObserver as a no-op
      // move and broke undo of conversions.)
      expect(store.getBlockById('block2')).toBe(before);
    });

    it('returns false when the block id does not exist', () => {
      store.fromJSON([{ id: 'block1', type: 'paragraph', data: { text: 'First' } }]);

      expect(store.replaceBlockContent('nonexistent', 'list', { text: '' })).toBe(false);
      expect(store.toJSON()).toHaveLength(1);
    });

    it('is a single undo entry that restores the original type and data', () => {
      store.fromJSON([{ id: 'block1', type: 'list', data: { text: 'Item', style: 'unordered' } }]);

      const undoManager = new Y.UndoManager(store.yblocks, {
        trackedOrigins: new Set(['local']),
      });

      store.replaceBlockContent('block1', 'paragraph', { text: 'Item' });

      // Exactly one undo entry for the whole conversion.
      expect(undoManager.undoStack.length).toBe(1);
      expect(store.toJSON()[0]).toMatchObject({ type: 'paragraph', data: { text: 'Item' } });

      // Undo restores the list; redo re-applies the paragraph.
      undoManager.undo();
      expect(store.toJSON()[0]).toMatchObject({ type: 'list', data: { text: 'Item', style: 'unordered' } });

      undoManager.redo();
      expect(store.toJSON()[0]).toMatchObject({ type: 'paragraph', data: { text: 'Item' } });

      undoManager.destroy();
    });
  });

  describe('moveBlock', () => {
    it('moves block to new index', () => {
      store.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
        { id: 'block2', type: 'paragraph', data: { text: 'Second' } },
        { id: 'block3', type: 'paragraph', data: { text: 'Third' } },
      ]);

      store.moveBlock('block3', 0, 'local');

      const result = store.toJSON();

      expect(result[0].id).toBe('block3');
      expect(result[1].id).toBe('block1');
      expect(result[2].id).toBe('block2');
    });

    it('does nothing if block not found', () => {
      store.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
      ]);

      store.moveBlock('nonexistent', 0, 'local');

      expect(store.toJSON()[0].id).toBe('block1');
    });

    it('does nothing when fromIndex equals toIndex', () => {
      store.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
      ]);

      store.moveBlock('block1', 0, 'local');

      expect(store.toJSON()[0].id).toBe('block1');
    });

    it('clamps toIndex when it exceeds array length after delete', () => {
      store.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
        { id: 'block2', type: 'paragraph', data: { text: 'Second' } },
        { id: 'block3', type: 'paragraph', data: { text: 'Third' } },
      ]);

      // toIndex 3 was valid before delete, but after deleting block1
      // the array is length 2, so insert at index 3 would exceed bounds.
      // Should clamp to index 2 (end of array).
      store.moveBlock('block1', 3, 'local');

      const result = store.toJSON();

      expect(result).toHaveLength(3);
      // block1 should be at the end
      expect(result[2].id).toBe('block1');
    });

    it('handles moving last block to position beyond bounds', () => {
      store.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
        { id: 'block2', type: 'paragraph', data: { text: 'Second' } },
      ]);

      // Moving block2 (at index 1) to index 2:
      // After delete, array is length 1, index 2 exceeds bounds.
      // Should clamp to index 1 (end).
      store.moveBlock('block2', 2, 'local');

      const result = store.toJSON();

      expect(result).toHaveLength(2);
      expect(result[1].id).toBe('block2');
    });

    it('clamps negative toIndex to zero', () => {
      store.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
        { id: 'block2', type: 'paragraph', data: { text: 'Second' } },
        { id: 'block3', type: 'paragraph', data: { text: 'Third' } },
      ]);

      store.moveBlock('block3', -1, 'local');

      const result = store.toJSON();

      expect(result[0].id).toBe('block3');
    });
  });

  describe('updateBlockData', () => {
    it('updates a single property in block data', () => {
      store.fromJSON([{ id: 'block1', type: 'paragraph', data: { text: 'Original' } }]);

      store.updateBlockData('block1', 'text', 'Updated');

      const result = store.toJSON();

      expect(result[0].data.text).toBe('Updated');
    });

    it('adds new property to block data', () => {
      store.fromJSON([{ id: 'block1', type: 'header', data: { text: 'Title' } }]);

      store.updateBlockData('block1', 'level', 2);

      const result = store.toJSON();

      expect(result[0].data.level).toBe(2);
    });

    it('does nothing if block not found', () => {
      store.fromJSON([{ id: 'block1', type: 'paragraph', data: { text: 'Original' } }]);

      store.updateBlockData('nonexistent', 'text', 'Updated');

      expect(store.toJSON()[0].data.text).toBe('Original');
    });

    it('skips update if value has not changed', () => {
      // This test verifies that we don't create unnecessary Yjs transactions
      // when the value is the same (prevents creating extra undo entries)
      store.fromJSON([{ id: 'block1', type: 'paragraph', data: { text: 'Hello' } }]);

      // Update with same value - should not cause a Yjs transaction
      store.updateBlockData('block1', 'text', 'Hello');

      // Value should still be there
      expect(store.toJSON()[0].data.text).toBe('Hello');
    });

    it('skips update when array value is deeply equal but reference-different', () => {
      const originalContent = [
        [{ blocks: ['p1', 'p2'] }, { blocks: ['p3'] }],
        [{ blocks: ['p4'] }, { blocks: ['p5', 'p6'] }],
      ];

      store.fromJSON([{ id: 'block1', type: 'table', data: { content: originalContent } }]);

      // Create a Y.UndoManager to track whether new undo entries are created
      const undoManager = new Y.UndoManager(store.yblocks, {
        trackedOrigins: new Set(['local']),
      });

      const initialStackLength = undoManager.undoStack.length;

      // Update with a deeply-equal but reference-different array
      const newContent = [
        [{ blocks: ['p1', 'p2'] }, { blocks: ['p3'] }],
        [{ blocks: ['p4'] }, { blocks: ['p5', 'p6'] }],
      ];

      store.updateBlockData('block1', 'content', newContent);

      // No new undo entry should be created — the value hasn't semantically changed
      expect(undoManager.undoStack.length).toBe(initialStackLength);

      // Data should still be intact
      expect(store.toJSON()[0].data.content).toEqual(originalContent);

      undoManager.destroy();
    });

    it('skips update when simple array value is deeply equal but reference-different', () => {
      store.fromJSON([{ id: 'block1', type: 'table', data: { colWidths: [100, 200, 150] } }]);

      const undoManager = new Y.UndoManager(store.yblocks, {
        trackedOrigins: new Set(['local']),
      });

      const initialStackLength = undoManager.undoStack.length;

      // Update with deeply-equal but new reference
      store.updateBlockData('block1', 'colWidths', [100, 200, 150]);

      expect(undoManager.undoStack.length).toBe(initialStackLength);

      undoManager.destroy();
    });

    it('still updates when array value has actually changed', () => {
      store.fromJSON([{ id: 'block1', type: 'table', data: { content: [{ blocks: ['p1'] }] } }]);

      const undoManager = new Y.UndoManager(store.yblocks, {
        trackedOrigins: new Set(['local']),
      });

      const initialStackLength = undoManager.undoStack.length;

      // Update with a different value
      store.updateBlockData('block1', 'content', [{ blocks: ['p1', 'p2'] }]);

      // Should create a new undo entry
      expect(undoManager.undoStack.length).toBe(initialStackLength + 1);

      // Data should reflect the change
      expect(store.toJSON()[0].data.content).toEqual([{ blocks: ['p1', 'p2'] }]);

      undoManager.destroy();
    });

    it('skips update when a NESTED OBJECT value is deeply equal (no spurious first-save undo entry)', () => {
      // A nested object (e.g. database-row properties) is serialized as a nested
      // Y.Map. equals(Y.Map, plainObject) was a false-negative, so the FIRST sync
      // after load always wrote + bumped an undo entry even when nothing changed.
      store.fromJSON([
        { id: 'block1', type: 'database-row', data: { properties: { status: 'todo', priority: 1 } } },
      ]);

      const undoManager = new Y.UndoManager(store.yblocks, {
        trackedOrigins: new Set(['local']),
      });
      const initialStackLength = undoManager.undoStack.length;

      // Same content, new reference — must be a no-op.
      store.updateBlockData('block1', 'properties', { status: 'todo', priority: 1 });

      expect(undoManager.undoStack.length).toBe(initialStackLength);
      expect(store.toJSON()[0].data.properties).toEqual({ status: 'todo', priority: 1 });

      undoManager.destroy();
    });

    it('updates a changed sub-field IN PLACE, keeping the nested value a merge-capable Y.Map', () => {
      store.fromJSON([
        { id: 'block1', type: 'database-row', data: { properties: { status: 'todo', priority: 1 } } },
      ]);

      const undoManager = new Y.UndoManager(store.yblocks, {
        trackedOrigins: new Set(['local']),
      });
      const initialStackLength = undoManager.undoStack.length;

      // Change only `status`; `priority` is unchanged.
      store.updateBlockData('block1', 'properties', { status: 'done', priority: 1 });

      expect(undoManager.undoStack.length).toBe(initialStackLength + 1);
      expect(store.toJSON()[0].data.properties).toEqual({ status: 'done', priority: 1 });

      // The nested value stays a Y.Map (not flattened to a plain object), so
      // concurrent edits to DIFFERENT sub-fields can merge rather than clobber.
      const yblock = store.getBlockById('block1');
      const props = (yblock?.get('data') as Y.Map<unknown>).get('properties');

      expect(props instanceof Y.Map).toBe(true);
    });

    it('merges concurrent edits to different sub-fields of a nested object (field-level CRDT)', () => {
      store.fromJSON([
        { id: 'block1', type: 'database-row', data: { properties: { status: 'todo', priority: 1 } } },
      ]);

      // A second peer started from the same state.
      const peer = createDocumentStore();
      const baseUpdate = Y.encodeStateAsUpdate(
        (store as unknown as { ydoc: Y.Doc }).ydoc
      );

      Y.applyUpdate((peer as unknown as { ydoc: Y.Doc }).ydoc, baseUpdate);

      // Each peer edits a DIFFERENT sub-field of the same nested object.
      store.updateBlockData('block1', 'properties', { status: 'done', priority: 1 });
      peer.updateBlockData('block1', 'properties', { status: 'todo', priority: 5 });

      // Exchange updates both ways.
      Y.applyUpdate(
        (store as unknown as { ydoc: Y.Doc }).ydoc,
        Y.encodeStateAsUpdate((peer as unknown as { ydoc: Y.Doc }).ydoc)
      );
      Y.applyUpdate(
        (peer as unknown as { ydoc: Y.Doc }).ydoc,
        Y.encodeStateAsUpdate((store as unknown as { ydoc: Y.Doc }).ydoc)
      );

      // Both sub-field edits survive — not last-writer-wins on the whole object.
      expect(store.toJSON()[0].data.properties).toEqual({ status: 'done', priority: 5 });
      expect(peer.toJSON()[0].data.properties).toEqual({ status: 'done', priority: 5 });
    });
  });

  describe('getBlockById', () => {
    it('returns Y.Map for existing block', () => {
      store.fromJSON([{ id: 'block1', type: 'paragraph', data: { text: 'Test' } }]);

      const yblock = store.getBlockById('block1');

      expect(yblock).toBeDefined();
      expect(yblock?.get('id')).toBe('block1');
    });

    it('returns undefined for nonexistent block', () => {
      const yblock = store.getBlockById('nonexistent');

      expect(yblock).toBeUndefined();
    });
  });

  describe('findBlockIndex', () => {
    it('returns index of existing block', () => {
      store.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
        { id: 'block2', type: 'paragraph', data: { text: 'Second' } },
      ]);

      expect(store.findBlockIndex('block2')).toBe(1);
    });

    it('returns -1 for nonexistent block', () => {
      expect(store.findBlockIndex('nonexistent')).toBe(-1);
    });
  });

  describe('toJSON', () => {
    it('returns empty array when no blocks exist', () => {
      expect(store.toJSON()).toEqual([]);
    });

    it('serializes blocks to OutputBlockData format', () => {
      store.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'Hello' } },
        { id: 'block2', type: 'header', data: { text: 'Title', level: 2 } },
      ]);

      const result = store.toJSON();

      expect(result).toEqual([
        { id: 'block1', type: 'paragraph', data: { text: 'Hello' } },
        { id: 'block2', type: 'header', data: { text: 'Title', level: 2 } },
      ]);
    });

    it('includes parentId when present', () => {
      store.fromJSON([
        { id: 'parent', type: 'paragraph', data: { text: 'Parent' } },
        { id: 'child', type: 'paragraph', data: { text: 'Child' }, parent: 'parent' },
      ]);

      const result = store.toJSON();

      expect(result[1].parent).toBe('parent');
    });

    it('includes tunes when present', () => {
      store.fromJSON([
        {
          id: 'block1',
          type: 'paragraph',
          data: { text: 'Hello' },
          tunes: { alignment: 'center' },
        },
      ]);

      const result = store.toJSON();

      expect(result[0].tunes).toEqual({ alignment: 'center' });
    });

    it('includes content when present', () => {
      store.fromJSON([
        {
          id: 'block1',
          type: 'list',
          data: { style: 'ordered' },
          content: ['block2', 'block3'],
        },
      ]);

      const result = store.toJSON();

      expect(result[0].content).toEqual(['block2', 'block3']);
    });
  });

  describe('fromJSON', () => {
    it('loads blocks from JSON data', () => {
      const blocks: OutputBlockData[] = [
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
        { id: 'block2', type: 'paragraph', data: { text: 'Second' } },
      ];

      store.fromJSON(blocks);

      expect(store.toJSON()).toEqual(blocks);
    });

    it('clears existing blocks before loading', () => {
      store.addBlock({ id: 'old', type: 'paragraph', data: { text: 'Old' } });

      store.fromJSON([{ id: 'new', type: 'paragraph', data: { text: 'New' } }]);

      expect(store.toJSON()).toHaveLength(1);
      expect(store.toJSON()[0].id).toBe('new');
    });
  });

  describe('transact', () => {
    it('wraps operations in a transaction', () => {
      let transactionOrigin: string | null = null;

      // Track the origin by observing the yblocks
      store.yblocks.observe((event) => {
        transactionOrigin = event.transaction.origin as string;
      });

      store.transact(() => {
        store.yblocks.push([new Y.Map()]);
      }, 'local');

      expect(transactionOrigin).toBe('local');
    });
  });

  describe('updateBlockTune', () => {
    it('adds new tune to block', () => {
      store.fromJSON([{ id: 'block1', type: 'paragraph', data: { text: 'Hello' } }]);

      store.updateBlockTune('block1', 'alignment', 'center');

      const result = store.toJSON();

      expect(result[0].tunes).toEqual({ alignment: 'center' });
    });

    it('updates existing tune', () => {
      store.fromJSON([
        {
          id: 'block1',
          type: 'paragraph',
          data: { text: 'Hello' },
          tunes: { alignment: 'left' },
        },
      ]);

      store.updateBlockTune('block1', 'alignment', 'center');

      const result = store.toJSON();

      expect(result[0].tunes?.alignment).toBe('center');
    });

    it('does nothing if block not found', () => {
      store.fromJSON([{ id: 'block1', type: 'paragraph', data: { text: 'Hello' } }]);

      store.updateBlockTune('nonexistent', 'alignment', 'center');

      expect(store.toJSON()[0].tunes).toBeUndefined();
    });
  });

  describe('updateBlockMetadata', () => {
    it('should set lastEditedAt and lastEditedBy on the Y.Map', () => {
      store.fromJSON([{ id: 'block1', type: 'paragraph', data: { text: 'Hello' } }]);

      store.updateBlockMetadata('block1', 1700000000000, 'Alice');

      const yblock = store.getBlockById('block1')!;

      expect(yblock.get('lastEditedAt')).toBe(1700000000000);
      expect(yblock.get('lastEditedBy')).toBe('Alice');
    });

    it('should not set lastEditedBy when null', () => {
      store.fromJSON([{ id: 'block1', type: 'paragraph', data: { text: 'Hello' } }]);

      // First set a value for lastEditedBy
      store.updateBlockMetadata('block1', 1700000000000, 'Alice');

      // Now call with null — lastEditedBy should retain its previous value
      store.updateBlockMetadata('block1', 1700000001000, null);

      const yblock = store.getBlockById('block1')!;

      expect(yblock.get('lastEditedAt')).toBe(1700000001000);
      expect(yblock.get('lastEditedBy')).toBe('Alice');
    });

    it('does nothing if block not found', () => {
      store.fromJSON([{ id: 'block1', type: 'paragraph', data: { text: 'Hello' } }]);

      // Should not throw
      store.updateBlockMetadata('nonexistent', 1700000000000, 'Alice');

      // Original block is unaffected
      const yblock = store.getBlockById('block1')!;

      expect(yblock.get('lastEditedAt')).toBeUndefined();
    });
  });

  describe('per-cell grids — representation', () => {
    type CellShape = { blocks: string[] };

    const grid = (): CellShape[][] => [
      [{ blocks: ['c00'] }, { blocks: ['c01'] }, { blocks: ['c02'] }],
      [{ blocks: ['c10'] }, { blocks: ['c11'] }, { blocks: ['c12'] }],
      [{ blocks: ['c20'] }, { blocks: ['c21'] }, { blocks: ['c22'] }],
    ];

    const getDataMap = (id: string): Y.Map<unknown> => {
      const yblock = store.getBlockById(id) as Y.Map<unknown>;

      return yblock.get('data') as Y.Map<unknown>;
    };

    it('stores a table grid as Y.Array(rows) → Y.Array(cells) → Y.Map, with plain blocks arrays', () => {
      store.fromJSON([{ id: 't1', type: 'table', data: { content: grid() } }]);

      const content = getDataMap('t1').get('content') as Y.Array<unknown>;

      expect(content instanceof Y.Array).toBe(true);

      const row = content.get(0) as Y.Array<unknown>;

      expect(row instanceof Y.Array).toBe(true);

      const cellMap = row.get(0) as Y.Map<unknown>;

      expect(cellMap instanceof Y.Map).toBe(true);
      expect(Array.isArray(cellMap.get('blocks'))).toBe(true);
    });

    it('keeps colWidths a plain atomic array through load and write', () => {
      store.fromJSON([{ id: 't1', type: 'table', data: { content: grid(), colWidths: [100, 200, 150] } }]);

      expect(Array.isArray(getDataMap('t1').get('colWidths'))).toBe(true);

      store.updateBlockData('t1', 'colWidths', [110, 200, 150]);

      expect(Array.isArray(getDataMap('t1').get('colWidths'))).toBe(true);
      expect(store.toJSON()[0].data.colWidths).toEqual([110, 200, 150]);
    });

    it('keeps a populated cell blocks array plain (representation-flip hole stays closed)', () => {
      const initial = grid();

      initial[1][1] = { blocks: [] };
      store.fromJSON([{ id: 't1', type: 'table', data: { content: initial } }]);

      const next = grid();

      next[1][1] = { blocks: ['p9'] };
      store.updateBlockData('t1', 'content', next);

      const content = getDataMap('t1').get('content') as Y.Array<unknown>;
      const cellMap = (content.get(1) as Y.Array<unknown>).get(1) as Y.Map<unknown>;

      expect(Array.isArray(cellMap.get('blocks'))).toBe(true);
      expect(cellMap.get('blocks')).toEqual(['p9']);
    });

    it('upgrades an empty content array to a Y.Array on the first qualifying write', () => {
      store.fromJSON([{ id: 't1', type: 'table', data: { content: [] } }]);

      // Empty arrays stay plain atomic leaves on load
      expect(Array.isArray(getDataMap('t1').get('content'))).toBe(true);

      store.updateBlockData('t1', 'content', grid());

      expect(getDataMap('t1').get('content') instanceof Y.Array).toBe(true);
      expect(store.toJSON()[0].data.content).toEqual(grid());
    });

    it('downshifts to a plain empty array when the grid empties', () => {
      store.fromJSON([{ id: 't1', type: 'table', data: { content: grid() } }]);

      store.updateBlockData('t1', 'content', []);

      expect(Array.isArray(getDataMap('t1').get('content'))).toBe(true);
      expect(store.toJSON()[0].data.content).toEqual([]);
    });
  });

  describe('per-cell grids — write granularity', () => {
    // Wave 2 extends these with two-doc convergence laws through the binary seam.
    type CellShape = { blocks: string[] };

    const grid = (): CellShape[][] => [
      [{ blocks: ['c00'] }, { blocks: ['c01'] }, { blocks: ['c02'] }],
      [{ blocks: ['c10'] }, { blocks: ['c11'] }, { blocks: ['c12'] }],
      [{ blocks: ['c20'] }, { blocks: ['c21'] }, { blocks: ['c22'] }],
    ];

    // event.changes must be computed INSIDE the handler (yjs forbids lazy
    // computation after dispatch), so capture plain snapshots per event.
    type CapturedEvent = {
      target: unknown;
      keys: string[];
      delta: { insert?: unknown[] | string; retain?: number; delete?: number }[];
    };

    let batches: CapturedEvent[][];

    const observe = (): void => {
      store.yblocks.observeDeep((events) => {
        batches.push(events.map((event) => ({
          target: event.target,
          keys: Array.from(event.changes.keys.keys()),
          delta: event.changes.delta.map((op) => ({ ...op })),
        })));
      });
    };

    const getContentArray = (id: string): Y.Array<unknown> => {
      const yblock = store.getBlockById(id) as Y.Map<unknown>;

      return (yblock.get('data') as Y.Map<unknown>).get('content') as Y.Array<unknown>;
    };

    beforeEach(() => {
      batches = [];
      store.fromJSON([{ id: 't1', type: 'table', data: { content: grid() } }]);
    });

    it('editing one cell touches only that cell Y.Map', () => {
      const content = getContentArray('t1');
      const cell11 = (content.get(1) as Y.Array<unknown>).get(1) as Y.Map<unknown>;

      observe();

      const next = grid();

      next[1][1] = { blocks: ['c11', 'extra'] };
      store.updateBlockData('t1', 'content', next);

      expect(batches).toHaveLength(1);

      const events = batches[0];

      expect(events).toHaveLength(1);
      // Same Y.Map identity — the edit lands INSIDE the existing cell map
      expect(events[0].target).toBe(cell11);

      expect(events[0].keys).toEqual(['blocks']);
    });

    it('inserting a row produces one splice event on the rows Y.Array', () => {
      const content = getContentArray('t1');

      observe();

      const next = grid();

      next.splice(1, 0, [{ blocks: ['n0'] }, { blocks: ['n1'] }, { blocks: ['n2'] }]);
      store.updateBlockData('t1', 'content', next);

      expect(batches).toHaveLength(1);

      const events = batches[0];

      expect(events).toHaveLength(1);
      expect(events[0].target).toBe(content);

      const delta = events[0].delta;
      const inserts = delta.filter((op) => op.insert !== undefined);
      const deletes = delta.filter((op) => op.delete !== undefined);

      expect(inserts).toHaveLength(1);
      expect(deletes).toHaveLength(0);
      expect((inserts[0].insert as unknown[]).length).toBe(1);
    });

    it('deleting a row produces one splice event on the rows Y.Array', () => {
      const content = getContentArray('t1');

      observe();

      const next = grid();

      next.splice(1, 1);
      store.updateBlockData('t1', 'content', next);

      expect(batches).toHaveLength(1);

      const events = batches[0];

      expect(events).toHaveLength(1);
      expect(events[0].target).toBe(content);

      const delta = events[0].delta;
      const deletes = delta.filter((op) => op.delete !== undefined);

      expect(deletes).toHaveLength(1);
      expect(deletes[0].delete).toBe(1);
    });

    it('a deep-equal grid write emits zero events and returns false', () => {
      observe();

      const changed = store.updateBlockData('t1', 'content', grid());

      expect(changed).toBe(false);
      expect(batches).toHaveLength(0);
    });

    it('a changed grid write creates exactly one undo entry', () => {
      const undoManager = new Y.UndoManager(store.yblocks, {
        trackedOrigins: new Set(['local']),
      });
      const initialStackLength = undoManager.undoStack.length;

      const next = grid();

      next[2][0] = { blocks: ['c20', 'more'] };
      store.updateBlockData('t1', 'content', next);

      expect(undoManager.undoStack.length).toBe(initialStackLength + 1);

      undoManager.destroy();
    });

    it('inserting a column rewrites each row with one splice (row-wise writes, accepted)', () => {
      const content = getContentArray('t1');

      observe();

      const next = grid();

      for (const row of next) {
        row.splice(1, 0, { blocks: [] });
      }
      store.updateBlockData('t1', 'content', next);

      expect(batches).toHaveLength(1);

      const events = batches[0];

      // One Y.Array splice per row, no cell-map events
      expect(events).toHaveLength(3);

      for (const event of events) {
        expect(event.target instanceof Y.Array).toBe(true);
        expect(event.target === content).toBe(false);
      }
    });
  });

  describe('per-cell grids — blast-radius round-trips', () => {
    it('round-trips table content through updateBlockData and toJSON', () => {
      store.fromJSON([
        {
          id: 't1',
          type: 'table',
          data: {
            withHeadings: true,
            colWidths: [120, 240],
            content: [
              [{ blocks: ['p1'], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
              [{ blocks: ['p2'] }, { blocks: ['p3'] }],
            ],
          },
        },
      ]);

      const next = [
        [{ blocks: ['p1'], colspan: 2 }, { blocks: [], mergedInto: [0, 0] }],
        [{ blocks: ['p2'] }, { blocks: ['p3', 'p4'] }],
        [{ blocks: [] }, { blocks: ['p5'] }],
      ];

      store.updateBlockData('t1', 'content', next);

      expect(store.toJSON()[0].data.content).toEqual(next);
    });

    it('round-trips database schema and views through updateBlockData and toJSON', () => {
      const schema = [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        {
          id: 'p-status',
          name: 'Status',
          type: 'select',
          position: 'a1',
          config: { options: [{ id: 'o1', label: 'Todo', color: 'gray' }] },
        },
      ];
      const views = [
        { id: 'v1', name: 'All', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['p-title'] },
      ];

      store.fromJSON([{ id: 'db1', type: 'database', data: { schema, views, activeViewId: 'v1' } }]);

      // Schema and views convert per-element
      const yblock = store.getBlockById('db1') as Y.Map<unknown>;
      const ydata = yblock.get('data') as Y.Map<unknown>;

      expect(ydata.get('schema') instanceof Y.Array).toBe(true);
      expect((ydata.get('schema') as Y.Array<unknown>).get(0) instanceof Y.Map).toBe(true);

      const nextSchema = [
        ...schema,
        { id: 'p-due', name: 'Due', type: 'date', position: 'a2' },
      ];
      const nextViews = [
        {
          id: 'v1',
          name: 'All',
          type: 'table',
          position: 'a0',
          sorts: [{ propertyId: 'p-due', direction: 'desc' }],
          filters: [],
          visibleProperties: ['p-title', 'p-due'],
        },
      ];

      store.updateBlockData('db1', 'schema', nextSchema);
      store.updateBlockData('db1', 'views', nextViews);

      const result = store.toJSON()[0].data;

      expect(result.schema).toEqual(nextSchema);
      expect(result.views).toEqual(nextViews);
    });

    it('round-trips list data and keeps primitive arrays in data atomic', () => {
      store.fromJSON([
        { id: 'l1', type: 'list', data: { text: 'Item', style: 'ordered', depth: 0 } },
      ]);

      store.updateBlockData('l1', 'style', 'checklist');
      store.updateBlockData('l1', 'checked', true);

      expect(store.toJSON()[0].data).toEqual({ text: 'Item', style: 'checklist', depth: 0, checked: true });

      // A primitive string array in data (like cell.blocks) is an atomic plain leaf
      store.updateBlockData('l1', 'tags', ['a', 'b']);

      const yblock = store.getBlockById('l1') as Y.Map<unknown>;
      const ydata = yblock.get('data') as Y.Map<unknown>;

      expect(Array.isArray(ydata.get('tags'))).toBe(true);
      expect(store.toJSON()[0].data.tags).toEqual(['a', 'b']);
    });
  });

  describe('per-cell grids — undo restores nested writes', () => {
    type CellShape = { blocks: string[] };

    const grid = (): CellShape[][] => [
      [{ blocks: ['c00'] }, { blocks: ['c01'] }],
      [{ blocks: ['c10'] }, { blocks: ['c11'] }],
    ];

    const createUndoManager = (): Y.UndoManager => {
      return new Y.UndoManager(store.yblocks, {
        trackedOrigins: new Set(['local']),
      });
    };

    it('undo of a cell edit restores the original grid', () => {
      store.fromJSON([{ id: 't1', type: 'table', data: { content: grid() } }]);

      const undoManager = createUndoManager();
      const next = grid();

      next[1][1] = { blocks: ['c11', 'extra'] };
      store.updateBlockData('t1', 'content', next);

      undoManager.undo();

      expect(store.toJSON()[0].data.content).toEqual(grid());

      undoManager.destroy();
    });

    it('undo of a row insert restores the original grid (splice reversal)', () => {
      store.fromJSON([{ id: 't1', type: 'table', data: { content: grid() } }]);

      const undoManager = createUndoManager();
      const next = grid();

      next.splice(1, 0, [{ blocks: ['n0'] }, { blocks: ['n1'] }]);
      store.updateBlockData('t1', 'content', next);

      undoManager.undo();

      expect(store.toJSON()[0].data.content).toEqual(grid());

      undoManager.destroy();
    });

    it('undo of a row delete restores the deleted row', () => {
      store.fromJSON([{ id: 't1', type: 'table', data: { content: grid() } }]);

      const undoManager = createUndoManager();
      const next = grid();

      next.splice(0, 1);
      store.updateBlockData('t1', 'content', next);

      undoManager.undo();

      expect(store.toJSON()[0].data.content).toEqual(grid());

      undoManager.destroy();
    });

    it('undo of schema and views edits restores both', () => {
      const schema = [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }];
      const views = [
        { id: 'v1', name: 'All', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['p-title'] },
      ];

      store.fromJSON([{ id: 'db1', type: 'database', data: { schema, views, activeViewId: 'v1' } }]);

      const undoManager = createUndoManager();

      store.updateBlockData('db1', 'schema', [
        ...schema,
        { id: 'p-due', name: 'Due', type: 'date', position: 'a1' },
      ]);
      store.updateBlockData('db1', 'views', [
        { ...views[0], sorts: [{ propertyId: 'p-due', direction: 'asc' }] },
      ]);

      // Both writes land within captureTimeout — one undo reverses both
      undoManager.undo();

      const result = store.toJSON()[0].data;

      expect(result.schema).toEqual(schema);
      expect(result.views).toEqual(views);

      undoManager.destroy();
    });
  });

  describe('destroy', () => {
    it('destroys the Yjs document', () => {
      store.destroy();

      // After destroy, the doc should be destroyed
      // We can't directly test this, but we can verify no errors occur
      expect(() => store.toJSON()).not.toThrow();
    });
  });
});
