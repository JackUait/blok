import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { BlockObserver } from '../../../../../src/components/modules/yjs/block-observer';
import type { BlockChangeEvent } from '../../../../../src/components/modules/yjs/types';

type SingleBlockEvent = Extract<BlockChangeEvent, { blockId: string }>;

/**
 * Build a yblock whose `data` holds nested Y.Maps, the shape
 * `YBlockSerializer.objectToYMap` produces for nested plain objects.
 */
const createNestedBlock = (id: string): Y.Map<unknown> => {
  const yblock = new Y.Map<unknown>();

  yblock.set('id', id);
  yblock.set('type', 'paragraph');

  const ydata = new Y.Map<unknown>();

  ydata.set('text', 'Hello');

  const ystyle = new Y.Map<unknown>();

  ystyle.set('color', 'red');
  ydata.set('style', ystyle);

  const ylevelA = new Y.Map<unknown>();
  const ylevelB = new Y.Map<unknown>();
  const ylevelC = new Y.Map<unknown>();

  ylevelC.set('leaf', 'one');
  ylevelB.set('c', ylevelC);
  ylevelA.set('b', ylevelB);
  ydata.set('a', ylevelA);

  yblock.set('data', ydata);

  return yblock;
};

describe('BlockObserver — nested data map updates', () => {
  let observer: BlockObserver;
  let ydoc: Y.Doc;
  let blocksMap: Y.Map<Y.Map<unknown>>;
  let rootOrder: Y.Array<string>;
  let undoManager: Y.UndoManager;
  let callback: ReturnType<typeof vi.fn<(event: BlockChangeEvent) => void>>;

  const getUpdateEvents = (): SingleBlockEvent[] => {
    return callback.mock.calls
      .map((call) => call[0])
      .filter((event): event is SingleBlockEvent => event.type === 'update');
  };

  const addBlock = (id: string): void => {
    ydoc.transact(() => {
      blocksMap.set(id, createNestedBlock(id));
      rootOrder.push([id]);
    }, 'local');
  };

  const getData = (id: string): Y.Map<unknown> => {
    return blocksMap.get(id)?.get('data') as Y.Map<unknown>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    observer = new BlockObserver();
    ydoc = new Y.Doc();
    blocksMap = ydoc.getMap('blocks');
    rootOrder = ydoc.getArray('root');
    undoManager = new Y.UndoManager([blocksMap, rootOrder], {
      captureTimeout: 500,
      trackedOrigins: new Set(['local']),
    });

    observer.observe({ blocksMap, rootOrder }, undoManager);

    addBlock('b1');

    callback = vi.fn<(event: BlockChangeEvent) => void>();
    observer.onBlocksChanged(callback);
  });

  afterEach(() => {
    observer.destroy();
    undoManager.destroy();
    ydoc.destroy();
    vi.restoreAllMocks();
  });

  it('emits one remote update when a grandchild data key changes', () => {
    ydoc.transact(() => {
      const ystyle = getData('b1').get('style') as Y.Map<unknown>;

      ystyle.set('color', 'blue');
    }, 'peer-1');

    const updates = getUpdateEvents();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].blockId).toBe('b1');
    expect(updates[0].origin).toBe('remote');
  });

  it('emits one remote update when a deeply nested data key changes', () => {
    ydoc.transact(() => {
      const ylevelA = getData('b1').get('a') as Y.Map<unknown>;
      const ylevelB = ylevelA.get('b') as Y.Map<unknown>;
      const ylevelC = ylevelB.get('c') as Y.Map<unknown>;

      ylevelC.set('leaf', 'two');
    }, 'peer-1');

    const updates = getUpdateEvents();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].blockId).toBe('b1');
    expect(updates[0].origin).toBe('remote');
  });

  it('still emits exactly one update for a direct data key change', () => {
    ydoc.transact(() => {
      getData('b1').set('text', 'Updated');
    }, 'peer-1');

    const updates = getUpdateEvents();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].blockId).toBe('b1');
    expect(updates[0].origin).toBe('remote');
  });

  it('classifies a local-origin nested write as local', () => {
    ydoc.transact(() => {
      const ystyle = getData('b1').get('style') as Y.Map<unknown>;

      ystyle.set('color', 'green');
    }, 'local');

    const updates = getUpdateEvents();

    expect(updates).toHaveLength(1);
    expect(updates[0].blockId).toBe('b1');
    expect(updates[0].origin).toBe('local');
  });

  it('routes the update to the changed block when a subscriber grows the doc mid-dispatch', () => {
    addBlock('b2');
    callback.mockClear();

    // Mid-dispatch structural writes are legal: yjs-sync inserts a remote
    // block synchronously and a container tool's rendered() hook inserts a
    // child before later events of the same transaction are handled.
    let inserted = false;

    observer.onBlocksChanged(() => {
      if (inserted) {
        return;
      }
      inserted = true;
      ydoc.transact(() => {
        blocksMap.set('injected', createNestedBlock('injected'));
        rootOrder.insert(0, ['injected']);
      }, 'local');
    });

    ydoc.transact(() => {
      getData('b1').set('text', 'first');

      const secondStyle = getData('b2').get('style') as Y.Map<unknown>;

      secondStyle.set('color', 'blue');
    }, 'peer-1');

    const ids = getUpdateEvents().map((event) => event.blockId);

    expect(ids).toEqual(['b1', 'b2']);
  });

  it('drops a junk blocks-map value cleanly and still delivers later updates', () => {
    addBlock('b2');
    callback.mockClear();

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rawBlocks: Y.Map<unknown> = ydoc.getMap<unknown>('blocks');
    let inserted = false;

    observer.onBlocksChanged(() => {
      if (inserted) {
        return;
      }
      inserted = true;
      ydoc.transact(() => {
        rawBlocks.set('garbage-key', 'garbage');
      }, 'local');
    });

    ydoc.transact(() => {
      getData('b1').set('text', 'first');

      const secondStyle = getData('b2').get('style') as Y.Map<unknown>;

      secondStyle.set('color', 'blue');
    }, 'peer-1');

    const ids = getUpdateEvents().map((event) => event.blockId);

    expect(ids).toContain('b2');
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('ignores events from inside a Y.Array member of the blocks map', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rawBlocks: Y.Map<unknown> = ydoc.getMap<unknown>('blocks');

    ydoc.transact(() => {
      const hostileInner = new Y.Map<unknown>();

      hostileInner.set('id', 'hostile');

      const hostile = new Y.Array<unknown>();

      hostile.push([hostileInner]);
      rawBlocks.set('hostile', hostile);
      hostileInner.set('marker', 'x');

      getData('b1').set('text', 'still works');
    }, 'peer-1');

    const ids = getUpdateEvents().map((event) => event.blockId);

    expect(ids).toContain('b1');
    expect(ids).not.toContain('hostile');
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('emits exactly one update when one transaction touches several maps of one block', () => {
    ydoc.transact(() => {
      const yblock = blocksMap.get('b1') as Y.Map<unknown>;
      const ydata = yblock.get('data') as Y.Map<unknown>;
      const ystyle = ydata.get('style') as Y.Map<unknown>;

      ydata.set('text', 'multi');
      ystyle.set('color', 'teal');
      yblock.set('parentId', 'p1');
    }, 'peer-1');

    const updates = getUpdateEvents();

    expect(updates).toHaveLength(1);
    expect(updates[0].blockId).toBe('b1');
  });

  it('does not dedupe updates across transactions', () => {
    ydoc.transact(() => {
      getData('b1').set('text', 'one');
    }, 'peer-1');
    ydoc.transact(() => {
      getData('b1').set('text', 'two');
    }, 'peer-1');

    expect(getUpdateEvents()).toHaveLength(2);
  });

  it('does not suppress add/remove events delivered in the same dispatch as an update', () => {
    addBlock('b2');
    callback.mockClear();

    ydoc.transact(() => {
      getData('b1').set('text', 'changed');

      blocksMap.delete('b2');
      rootOrder.delete(rootOrder.toArray().indexOf('b2'), 1);

      blocksMap.set('b3', createNestedBlock('b3'));
      rootOrder.push(['b3']);
    }, 'peer-1');

    const events = callback.mock.calls
      .map((call) => call[0])
      .filter((event): event is SingleBlockEvent => 'blockId' in event);
    const byType = (type: SingleBlockEvent['type']): string[] =>
      events.filter((event) => event.type === type).map((event) => event.blockId);

    expect(byType('update')).toEqual(['b1']);
    expect(byType('add')).toEqual(['b3']);
    expect(byType('remove')).toEqual(['b2']);
  });

  describe('nested Y.Array (grid) events', () => {
    /**
     * Build a per-cell grid the Wave 1 serializer shape produces:
     * data.content = Y.Array(rows) → Y.Array(cells) → Y.Map(cell fields).
     */
    const makeRow = (cells: string[]): Y.Array<unknown> => {
      const row = new Y.Array<unknown>();

      row.push(cells.map((text) => {
        const cell = new Y.Map<unknown>();

        cell.set('content', text);

        return cell;
      }));

      return row;
    };

    const seedGrid = (id: string): void => {
      ydoc.transact(() => {
        const yblock = new Y.Map<unknown>();

        yblock.set('id', id);
        yblock.set('type', 'table');

        const ydata = new Y.Map<unknown>();
        const grid = new Y.Array<unknown>();

        grid.push([makeRow(['a1', 'b1']), makeRow(['a2', 'b2'])]);
        ydata.set('content', grid);
        yblock.set('data', ydata);

        blocksMap.set(id, yblock);
        rootOrder.push([id]);
      }, 'local');
    };

    const getGrid = (id: string): Y.Array<unknown> => {
      return getData(id).get('content') as Y.Array<unknown>;
    };

    it('emits exactly one remote update for a structural row splice (insert)', () => {
      seedGrid('table-1');
      callback.mockClear();

      ydoc.transact(() => {
        getGrid('table-1').insert(1, [makeRow(['a1.5', 'b1.5'])]);
      }, 'peer-1');

      const updates = getUpdateEvents();

      expect(updates).toHaveLength(1);
      expect(updates[0].blockId).toBe('table-1');
      expect(updates[0].origin).toBe('remote');
    });

    it('emits exactly one remote update for a structural row splice (delete)', () => {
      seedGrid('table-1');
      callback.mockClear();

      ydoc.transact(() => {
        getGrid('table-1').delete(0, 1);
      }, 'peer-1');

      const updates = getUpdateEvents();

      expect(updates).toHaveLength(1);
      expect(updates[0].blockId).toBe('table-1');
      expect(updates[0].origin).toBe('remote');
    });

    it('emits exactly one update when a cell splice and a nested cell edit hit the same block', () => {
      seedGrid('table-1');
      callback.mockClear();

      ydoc.transact(() => {
        const firstRow = getGrid('table-1').get(0) as Y.Array<unknown>;

        // Structural col insert (Y.Array splice inside a row) …
        const newCell = new Y.Map<unknown>();

        newCell.set('content', 'c1');
        firstRow.insert(2, [newCell]);

        // … plus a value edit inside an existing cell Y.Map.
        (firstRow.get(0) as Y.Map<unknown>).set('content', 'edited');
      }, 'peer-1');

      const updates = getUpdateEvents();

      expect(updates).toHaveLength(1);
      expect(updates[0].blockId).toBe('table-1');
    });

    it('does not misread a grid-array splice as a move', () => {
      seedGrid('table-1');
      callback.mockClear();

      ydoc.transact(() => {
        getGrid('table-1').insert(0, [makeRow(['x', 'y'])]);
      }, 'peer-1');

      const moves = callback.mock.calls
        .map((call) => call[0])
        .filter((event) => event.type === 'move');

      expect(moves).toEqual([]);
    });
  });

  it('keeps dispatching events after a callback throws', () => {
    addBlock('b2');

    const throwing = vi.fn<(event: BlockChangeEvent) => void>(() => {
      throw new Error('boom');
    });
    const second = vi.fn<(event: BlockChangeEvent) => void>();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    observer.onBlocksChanged(throwing);
    observer.onBlocksChanged(second);

    ydoc.transact(() => {
      const firstStyle = (getData('b1').get('style')) as Y.Map<unknown>;

      firstStyle.set('color', 'red');
      blocksMap.get('b2')?.set('parentId', 'p1');
    }, 'peer-1');

    // Both events of the transaction reach the later subscriber even though
    // an earlier subscriber threw on each of them.
    expect(throwing.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(second.mock.calls.length).toBe(throwing.mock.calls.length);
    expect(consoleError).toHaveBeenCalled();
  });
});
