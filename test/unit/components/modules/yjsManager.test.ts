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
});
