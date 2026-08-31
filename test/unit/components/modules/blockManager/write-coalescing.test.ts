import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { BlockManager } from '../../../../../src/components/modules/blockManager/blockManager';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../../types';
import { BlockChangedMutationType } from '../../../../../types/events/block/BlockChanged';
import { modificationsObserverBatchTimeout } from '../../../../../src/components/constants';

/**
 * Private access surface used to drive the mutation path without a full
 * prepare() harness (same pattern as blockManager.test.ts drag-guard tests).
 */
interface BlockManagerPrivateAccess {
  yjsSync: { isSyncingFromYjs: boolean };
  blockDidMutated: (mutationType: string, block: unknown, detail: Record<string, unknown>) => unknown;
}

interface BlockStub {
  id: string;
  name: string;
  parentId: string | null;
  holder: HTMLElement;
  tool: { name: string };
  save: ReturnType<typeof vi.fn>;
  lastEditedAt?: number;
  lastEditedBy?: string | null;
}

interface Harness {
  yjsManager: YjsManager;
  blockStub: BlockStub;
  /** Simulate one DOM mutation of b1 whose save() yields the given text. */
  mutate: (text: string) => Promise<void>;
  /** Read b1's text straight from the Y.Map (NOT via toJSON — that is a barrier). */
  readText: () => unknown;
  /** Number of Yjs doc update events since the last reset. */
  count: () => number;
  resetCount: () => void;
  doc: Y.Doc;
}

const drainMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

const advance = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

/**
 * Real YjsManager + real BlockManager mutation path (blockDidMutated →
 * syncBlockDataToYjs), with the doc pre-seeded with block b1.
 */
const createHarness = (): Harness => {
  const config: BlokConfig = { defaultBlock: 'paragraph', user: { id: 'user-1' } };
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();

  const yjsManager = new YjsManager({ config, eventsDispatcher });

  const blockManager = new BlockManager({ config, eventsDispatcher });

  blockManager.state = { YjsManager: yjsManager } as unknown as BlokModules;

  const priv = blockManager as unknown as BlockManagerPrivateAccess;

  priv.yjsSync = { isSyncingFromYjs: false };

  yjsManager.addBlock({ id: 'b1', type: 'paragraph', data: { text: '' } });
  // Detach the seed transaction from the typing that follows so undo tests
  // never fold the addBlock into the first typing group.
  yjsManager.stopCapturing();

  const yblock = yjsManager.getBlockById('b1');

  if (yblock === undefined) {
    throw new Error('setup: block b1 missing');
  }

  const doc = yblock.doc;

  if (doc === null) {
    throw new Error('setup: Y.Doc missing');
  }

  let updateCount = 0;

  doc.on('update', () => {
    updateCount += 1;
  });

  const blockStub: BlockStub = {
    id: 'b1',
    name: 'paragraph',
    parentId: null,
    holder: document.createElement('div'),
    tool: { name: 'paragraph' },
    save: vi.fn(),
  };

  const mutate = async (text: string): Promise<void> => {
    blockStub.save.mockResolvedValue({ data: { text } });
    priv.blockDidMutated(BlockChangedMutationType, blockStub, { index: 0 });
    await drainMicrotasks();
  };

  const readText = (): unknown => {
    const current = yjsManager.getBlockById('b1');

    if (current === undefined) {
      return undefined;
    }

    const data = current.get('data');

    return data instanceof Y.Map ? data.get('text') : undefined;
  };

  return {
    yjsManager,
    blockStub,
    mutate,
    readText,
    count: () => updateCount,
    resetCount: () => {
      updateCount = 0;
    },
    doc,
  };
};

describe('typing write coalescing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('leading + trailing window', () => {
    it('coalesces rapid mutations within the 400ms window into exactly 2 transactions', async () => {
      const { mutate, readText, count, resetCount } = createHarness();

      resetCount();

      // Leading flush: the first write of an idle block lands immediately.
      await mutate('a');
      expect(count()).toBe(1);
      expect(readText()).toBe('a');

      for (const text of ['ab', 'abc', 'abcd', 'abcde']) {
        await advance(20);
        await mutate(text);
      }

      // Mid-window: follow-up writes are buffered, not transacted.
      expect(count()).toBe(1);
      expect(readText()).toBe('a');

      await advance(modificationsObserverBatchTimeout);

      // Trailing flush: one transaction carries the coalesced tail.
      expect(count()).toBe(2);
      expect(readText()).toBe('abcde');
    });

    it('never extends the window on continued typing', async () => {
      const { mutate, readText, count, resetCount } = createHarness();

      resetCount();

      await mutate('a');
      await advance(350);
      await mutate('ab');

      // 50ms later the window (opened at the leading flush) ends — the
      // 350ms keystroke must not have pushed it out.
      await advance(50);

      expect(readText()).toBe('ab');
      expect(count()).toBe(2);
    });

    it('starts a new leading flush for a mutation after the window closed', async () => {
      const { mutate, readText, count, resetCount } = createHarness();

      resetCount();

      await mutate('a');
      await advance(modificationsObserverBatchTimeout);
      // Window closed with nothing buffered: no trailing transaction.
      expect(count()).toBe(1);

      await mutate('ab');

      // Idle block again → immediate leading flush, no timer needed.
      expect(count()).toBe(2);
      expect(readText()).toBe('ab');

      await advance(modificationsObserverBatchTimeout);
      // Nothing buffered → no trailing transaction for the second window.
      expect(count()).toBe(2);
    });

    it('computes lastEditedAt/lastEditedBy at flush time from actual changed-ness', async () => {
      const { mutate, blockStub } = createHarness();

      await mutate('a');
      const windowOpenedAt = Date.now();

      await advance(20);
      await mutate('ab');

      await advance(modificationsObserverBatchTimeout);

      // The trailing flush is when the buffered change lands — metadata must
      // carry the flush-time clock (window open + 400ms), not the enqueue-time
      // clock of the buffered keystroke.
      expect(blockStub.lastEditedAt).toBe(windowOpenedAt + modificationsObserverBatchTimeout);
      expect(blockStub.lastEditedBy).toBe('user-1');
    });

    it('does not write metadata (or any transaction) for a no-change trailing flush', async () => {
      const { mutate, count, resetCount } = createHarness();

      resetCount();

      await mutate('a');
      const afterLeading = count();

      await advance(20);
      // Same value again: equality diff at flush must produce no write.
      await mutate('a');

      await advance(modificationsObserverBatchTimeout);

      expect(count()).toBe(afterLeading);
    });
  });

  describe('flush barriers', () => {
    /**
     * Arm the buffer: 'a' lands via the leading flush, 'ab' stays buffered.
     */
    const arm = async (harness: Harness): Promise<void> => {
      harness.resetCount();
      await harness.mutate('a');
      await advance(10);
      await harness.mutate('ab');
      expect(harness.readText()).toBe('a');
    };

    it('stopCapturing flushes buffered writes before closing the capture group', async () => {
      const harness = createHarness();

      await arm(harness);
      harness.yjsManager.stopCapturing();

      expect(harness.readText()).toBe('ab');
    });

    it('undo flushes buffered writes first, so they are part of the undone group', async () => {
      const harness = createHarness();

      await arm(harness);
      harness.yjsManager.undo();

      expect(harness.readText()).toBe('');

      harness.yjsManager.redo();

      // Redo restores the WHOLE typed run — proof the buffered tail was
      // flushed into the group before undo popped it.
      expect(harness.readText()).toBe('ab');
    });

    it('redo flushes buffered writes at its start', async () => {
      const harness = createHarness();

      await arm(harness);
      harness.yjsManager.redo();

      expect(harness.readText()).toBe('ab');
    });

    it('moveBlock flushes buffered writes first', async () => {
      const harness = createHarness();

      harness.yjsManager.addBlock({ id: 'b2', type: 'paragraph', data: { text: 'x' } });
      await arm(harness);
      harness.yjsManager.moveBlock('b1', 1);

      expect(harness.readText()).toBe('ab');
    });

    it('addBlock flushes buffered writes first', async () => {
      const harness = createHarness();

      await arm(harness);
      harness.yjsManager.addBlock({ id: 'b2', type: 'paragraph', data: { text: 'x' } });

      expect(harness.readText()).toBe('ab');
    });

    it('applyRemoteUpdate flushes buffered writes first', async () => {
      const harness = createHarness();

      await arm(harness);
      // A no-op update from an empty doc — the barrier is the point.
      harness.yjsManager.applyRemoteUpdate(Y.encodeStateAsUpdate(new Y.Doc()));

      expect(harness.readText()).toBe('ab');
    });

    it('getStateVector flushes buffered writes first', async () => {
      const harness = createHarness();

      await arm(harness);
      harness.yjsManager.getStateVector();

      expect(harness.readText()).toBe('ab');
    });

    it('encodeStateAsUpdate flushes buffered writes, so peers receive them', async () => {
      const harness = createHarness();

      await arm(harness);
      const encoded = harness.yjsManager.encodeStateAsUpdate();

      expect(harness.readText()).toBe('ab');

      const peer = new Y.Doc();

      Y.applyUpdate(peer, encoded);
      const peerBlocks = Object.values(
        peer.getMap<{ data?: { text?: string } }>('blocks').toJSON()
      );

      expect(peerBlocks.some((b) => b.data?.text === 'ab')).toBe(true);
    });

    it('removeBlock flushes buffered writes first', async () => {
      const harness = createHarness();

      harness.yjsManager.addBlock({ id: 'b2', type: 'paragraph', data: { text: 'x' } });
      await arm(harness);
      harness.yjsManager.removeBlock('b2');

      expect(harness.readText()).toBe('ab');
    });

    it('replaceBlockContent flushes buffered writes first', async () => {
      const harness = createHarness();

      harness.yjsManager.addBlock({ id: 'b2', type: 'paragraph', data: { text: 'x' } });
      await arm(harness);
      harness.yjsManager.replaceBlockContent('b2', 'header', { text: 'x', level: 2 });

      expect(harness.readText()).toBe('ab');
    });

    it('transact flushes buffered writes before running the callback', async () => {
      const harness = createHarness();

      await arm(harness);

      let textInsideTransact: unknown;

      harness.yjsManager.transact(() => {
        textInsideTransact = harness.readText();
      });

      expect(textInsideTransact).toBe('ab');
    });

    it('transactMoves flushes buffered writes before running the callback', async () => {
      const harness = createHarness();

      await arm(harness);

      let textInsideGroup: unknown;

      harness.yjsManager.transactMoves(() => {
        textInsideGroup = harness.readText();
      });

      expect(textInsideGroup).toBe('ab');
    });

    it('toJSON flushes buffered writes so the serialized doc is current', async () => {
      const harness = createHarness();

      await arm(harness);
      const json = harness.yjsManager.toJSON();

      expect(json[0].data.text).toBe('ab');
    });

    it('fromJSON flushes buffered writes before clearing the doc', async () => {
      const harness = createHarness();

      await arm(harness);

      const seenTexts: unknown[] = [];

      harness.doc.on('update', () => {
        seenTexts.push(harness.readText());
      });

      harness.yjsManager.fromJSON([{ id: 'n1', type: 'paragraph', data: { text: 'new' } }]);

      // The first transaction after the barrier is the flush of 'ab' —
      // it must land before the doc is cleared and re-seeded.
      expect(seenTexts[0]).toBe('ab');
      expect(harness.yjsManager.getBlockById('n1')).toBeDefined();
      expect(harness.yjsManager.getBlockById('b1')).toBeUndefined();

      const updatesSoFar = seenTexts.length;

      await advance(modificationsObserverBatchTimeout + 100);

      // No stray trailing write of the dead block after the reload.
      expect(seenTexts.length).toBe(updatesSoFar);
    });

    it('getBlockDataObject flushes buffered writes first', async () => {
      const harness = createHarness();

      await arm(harness);

      expect(harness.yjsManager.getBlockDataObject('b1')).toEqual({ text: 'ab' });
    });

    it('updateBlockData flushes buffered writes, so the trailing flush cannot regress it', async () => {
      const harness = createHarness();

      await arm(harness);
      harness.yjsManager.updateBlockData('b1', 'text', 'fresh');

      expect(harness.readText()).toBe('fresh');

      // Without the barrier the still-open window's trailing flush lands the
      // STALE 'ab' 400ms later and silently reverts the fresh write.
      await advance(modificationsObserverBatchTimeout + 100);

      expect(harness.readText()).toBe('fresh');
    });

    it('updateBlockMetadata flushes buffered writes first', async () => {
      const harness = createHarness();

      await arm(harness);
      harness.yjsManager.updateBlockMetadata('b1', 1234, 'user-2');

      expect(harness.readText()).toBe('ab');
    });

    it('clear flushes buffered writes, so the cleared history cannot resurrect', async () => {
      const harness = createHarness();

      await arm(harness);
      harness.yjsManager.clear();

      // The buffered tail LANDED (it was not discarded) before the wipe.
      expect(harness.readText()).toBe('ab');

      // Without the barrier the trailing flush lands after the wipe as a
      // tracked transaction and repopulates the just-cleared undo stack.
      await advance(modificationsObserverBatchTimeout + 100);

      expect(harness.readText()).toBe('ab');
      expect(harness.yjsManager.canUndo()).toBe(false);
    });

    it('destroy flushes buffered writes before tearing down', async () => {
      const harness = createHarness();

      await arm(harness);

      const before = harness.count();

      harness.yjsManager.destroy();

      expect(harness.count()).toBe(before + 1);

      // The trailing timer must be gone: advancing past the window neither
      // throws nor produces further updates on the destroyed doc.
      await advance(modificationsObserverBatchTimeout + 100);
      expect(harness.count()).toBe(before + 1);
    });
  });

  describe('word-boundary undo grouping (parity with per-keystroke writes)', () => {
    it('boundary checkpoint at 100ms splits undo groups exactly as before coalescing', async () => {
      const harness = createHarness();
      const { mutate, readText, yjsManager } = harness;

      for (const text of ['h', 'he', 'hel', 'hell', 'hello']) {
        await mutate(text);
        await advance(20);
      }

      await mutate('hello ');
      yjsManager.markBoundary();

      // 100ms idle at the boundary → checkpoint (internal stopCapturing).
      // The buffered tail must flush BEFORE the capture group closes, so
      // "hello " belongs to the first group.
      await advance(100);

      for (const text of ['hello w', 'hello wo', 'hello wor', 'hello worl', 'hello world']) {
        await advance(20);
        await mutate(text);
      }

      await advance(modificationsObserverBatchTimeout);
      expect(readText()).toBe('hello world');

      yjsManager.undo();
      expect(readText()).toBe('hello ');

      yjsManager.undo();
      expect(readText()).toBe('');

      yjsManager.redo();
      expect(readText()).toBe('hello ');

      yjsManager.redo();
      expect(readText()).toBe('hello world');
    });
  });

  describe('capture-window anchoring (trailing flush must not extend the merge window)', () => {
    // REAL timers on purpose: Y.UndoManager's captureTimeout math runs on
    // lib0/time's `getUnixTime = Date.now`, a reference pinned at module
    // load — fake timers swap the Date global but cannot reach it (yjs is
    // externalized, so vi.mock cannot intercept its lib0 sub-imports).
    // The scenario keeps >=100ms of slack on every timing edge, and the
    // group-boundary assertions are phrased to hold regardless of how a
    // slow runner sub-splits a group.
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

    beforeEach(() => {
      vi.useRealTimers();
    });

    it('typing groups separated by more than captureTimeout stay separate undo entries', async () => {
      const harness = createHarness();
      const { mutate, readText, yjsManager } = harness;

      // Group 1: two rapid keystrokes. The trailing flush lands ~400ms
      // later, but it carries typing that happened NOW — the undo merge
      // clock must anchor here, not at the flush.
      await mutate('first');
      await mutate('first!');

      // Past the trailing flush (+400), ~650ms after the last keystroke:
      // more than captureTimeout (500ms) since the typing, but LESS than
      // 500ms since the trailing flush — the regression merged both groups
      // into ONE undo entry, so a single undo jumped past group 2 AND 1.
      await sleep(650);
      expect(readText()).toBe('first!');

      await mutate('first! second');

      yjsManager.undo();
      expect(readText()).toBe('first!');

      // Draining the rest unwinds group 1 (and finally the seed addBlock)
      // no matter how a slow runner sub-split group 1.
      while (yjsManager.canUndo()) {
        yjsManager.undo();
      }
      expect(['', undefined]).toContain(readText());
    });

    it('a tune change after a completed typing pause lands in its own undo entry', async () => {
      const harness = createHarness();
      const { mutate, readText, yjsManager } = harness;

      await mutate('Original Modified');
      await mutate('Original Modified!');

      // ~650ms after the last keystroke (past the ~400ms trailing flush), a
      // tune changes (blocks.update with tunes) — its own action, its own
      // undo entry.
      await sleep(650);
      yjsManager.updateBlockTune('b1', 'exampleTune', 'center');

      // One undo removes ONLY the tune change.
      yjsManager.undo();

      const yblock = yjsManager.getBlockById('b1');
      const tunes = yblock?.get('tunes');
      const tuneValue = tunes instanceof Y.Map ? tunes.get('exampleTune') : undefined;

      expect(tuneValue).toBeUndefined();
      expect(readText()).toBe('Original Modified!');
    });
  });
});
