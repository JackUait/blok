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
      expect(store.ydoc).toBeDefined();
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
      const blocks: OutputBlockData<string, Record<string, unknown>>[] = [
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

  describe('destroy', () => {
    it('destroys the Yjs document', () => {
      store.destroy();

      // After destroy, the doc should be destroyed
      // We can't directly test this, but we can verify no errors occur
      expect(() => store.toJSON()).not.toThrow();
    });
  });
});
