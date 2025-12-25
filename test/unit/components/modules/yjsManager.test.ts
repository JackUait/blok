import { describe, it, expect, beforeEach, vi } from 'vitest';
import { YjsManager } from '../../../../src/components/modules/yjsManager';
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
});
