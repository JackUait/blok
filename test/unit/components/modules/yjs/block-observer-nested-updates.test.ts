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
  let yblocks: Y.Array<Y.Map<unknown>>;
  let undoManager: Y.UndoManager;
  let callback: ReturnType<typeof vi.fn<(event: BlockChangeEvent) => void>>;

  const getUpdateEvents = (): SingleBlockEvent[] => {
    return callback.mock.calls
      .map((call) => call[0])
      .filter((event): event is SingleBlockEvent => event.type === 'update');
  };

  beforeEach(() => {
    vi.clearAllMocks();

    observer = new BlockObserver();
    ydoc = new Y.Doc();
    yblocks = ydoc.getArray('blocks');
    undoManager = new Y.UndoManager(yblocks, {
      captureTimeout: 500,
      trackedOrigins: new Set(['local']),
    });

    observer.observe(yblocks, undoManager);

    ydoc.transact(() => {
      yblocks.push([createNestedBlock('b1')]);
    }, 'local');

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
      const ydata = yblocks.get(0).get('data') as Y.Map<unknown>;
      const ystyle = ydata.get('style') as Y.Map<unknown>;

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
      const ydata = yblocks.get(0).get('data') as Y.Map<unknown>;
      const ylevelA = ydata.get('a') as Y.Map<unknown>;
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
      const ydata = yblocks.get(0).get('data') as Y.Map<unknown>;

      ydata.set('text', 'Updated');
    }, 'peer-1');

    const updates = getUpdateEvents();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].blockId).toBe('b1');
    expect(updates[0].origin).toBe('remote');
  });

  it('classifies a local-origin nested write as local', () => {
    ydoc.transact(() => {
      const ydata = yblocks.get(0).get('data') as Y.Map<unknown>;
      const ystyle = ydata.get('style') as Y.Map<unknown>;

      ystyle.set('color', 'green');
    }, 'local');

    const updates = getUpdateEvents();

    expect(updates).toHaveLength(1);
    expect(updates[0].blockId).toBe('b1');
    expect(updates[0].origin).toBe('local');
  });

  it('routes the update to the changed block when a subscriber grows yblocks mid-dispatch', () => {
    ydoc.transact(() => {
      yblocks.push([createNestedBlock('b2')]);
    }, 'local');
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
        yblocks.insert(0, [createNestedBlock('injected')]);
      }, 'local');
    });

    ydoc.transact(() => {
      const firstData = yblocks.get(0).get('data') as Y.Map<unknown>;

      firstData.set('text', 'first');

      const secondData = yblocks.get(1).get('data') as Y.Map<unknown>;
      const secondStyle = secondData.get('style') as Y.Map<unknown>;

      secondStyle.set('color', 'blue');
    }, 'peer-1');

    const ids = getUpdateEvents().map((event) => event.blockId);

    expect(ids).toEqual(['b1', 'b2']);
  });

  it('drops a primitive yblocks member cleanly and still delivers later updates', () => {
    ydoc.transact(() => {
      yblocks.push([createNestedBlock('b2')]);
    }, 'local');
    callback.mockClear();

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rawBlocks: Y.Array<unknown> = ydoc.getArray<unknown>('blocks');
    let inserted = false;

    observer.onBlocksChanged(() => {
      if (inserted) {
        return;
      }
      inserted = true;
      ydoc.transact(() => {
        rawBlocks.insert(1, ['garbage']);
      }, 'local');
    });

    ydoc.transact(() => {
      const firstData = yblocks.get(0).get('data') as Y.Map<unknown>;

      firstData.set('text', 'first');

      const secondData = yblocks.get(1).get('data') as Y.Map<unknown>;
      const secondStyle = secondData.get('style') as Y.Map<unknown>;

      secondStyle.set('color', 'blue');
    }, 'peer-1');

    const ids = getUpdateEvents().map((event) => event.blockId);

    expect(ids).toContain('b2');
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('ignores events from inside a Y.Array member of yblocks', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rawBlocks: Y.Array<unknown> = ydoc.getArray<unknown>('blocks');

    ydoc.transact(() => {
      const hostileInner = new Y.Map<unknown>();

      hostileInner.set('id', 'hostile');

      const hostile = new Y.Array<unknown>();

      hostile.push([hostileInner]);
      rawBlocks.insert(0, [hostile]);
      hostileInner.set('marker', 'x');

      const ydata = yblocks.get(1).get('data') as Y.Map<unknown>;

      ydata.set('text', 'still works');
    }, 'peer-1');

    const ids = getUpdateEvents().map((event) => event.blockId);

    expect(ids).toContain('b1');
    expect(ids).not.toContain('hostile');
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('emits exactly one update when one transaction touches several maps of one block', () => {
    ydoc.transact(() => {
      const yblock = yblocks.get(0);
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
      (yblocks.get(0).get('data') as Y.Map<unknown>).set('text', 'one');
    }, 'peer-1');
    ydoc.transact(() => {
      (yblocks.get(0).get('data') as Y.Map<unknown>).set('text', 'two');
    }, 'peer-1');

    expect(getUpdateEvents()).toHaveLength(2);
  });

  it('does not suppress add/remove events delivered in the same dispatch as an update', () => {
    ydoc.transact(() => {
      yblocks.push([createNestedBlock('b2')]);
    }, 'local');
    callback.mockClear();

    ydoc.transact(() => {
      (yblocks.get(0).get('data') as Y.Map<unknown>).set('text', 'changed');
      yblocks.delete(1, 1);
      yblocks.push([createNestedBlock('b3')]);
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

  it('keeps dispatching events after a callback throws', () => {
    ydoc.transact(() => {
      yblocks.push([createNestedBlock('b2')]);
    }, 'local');

    const throwing = vi.fn<(event: BlockChangeEvent) => void>(() => {
      throw new Error('boom');
    });
    const second = vi.fn<(event: BlockChangeEvent) => void>();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    observer.onBlocksChanged(throwing);
    observer.onBlocksChanged(second);

    ydoc.transact(() => {
      const firstStyle = (yblocks.get(0).get('data') as Y.Map<unknown>).get('style') as Y.Map<unknown>;

      firstStyle.set('color', 'red');
      yblocks.get(1).set('parentId', 'p1');
    }, 'peer-1');

    // Both events of the transaction reach the later subscriber even though
    // an earlier subscriber threw on each of them.
    expect(throwing.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(second.mock.calls.length).toBe(throwing.mock.calls.length);
    expect(consoleError).toHaveBeenCalled();
  });
});
