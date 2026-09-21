import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { BlockManager } from '../../../../../src/components/modules/blockManager/blockManager';
import { ModificationsObserver } from '../../../../../src/components/modules/modificationsObserver';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { BlockWriteBuffer } from '../../../../../src/components/modules/yjs/write-buffer';
import { RedactorDomChanged } from '../../../../../src/components/events';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../../types';
import { BlockChangedMutationType } from '../../../../../types/events/block/BlockChanged';

/**
 * Data loss around the coalescing write buffer's EDGES: the moment the editor
 * is torn down, the moment read-only takes the DOM mutex, and the moment one
 * block's flush throws while others are still buffered.
 *
 * Every test's FIRST assertion is the loss itself — what a peer (or a reload)
 * can no longer see.
 */

interface BlockManagerPrivateAccess {
  yjsSync: { isSyncingFromYjs: boolean; isMaterializing: (block: unknown) => boolean };
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

const drainMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

interface Harness {
  yjsManager: YjsManager;
  /** The peer on the other end of the provider: fed by `onDocUpdate`, as a real provider feeds it. */
  peer: DocumentStore;
  /** What the peer's copy of b1 says. */
  peerText: () => string;
  /** Start one DOM-mutation-driven sync whose `save()` resolves only when you say so. */
  startMutation: (text: string) => { resolveSave: () => void };
}

/**
 * Real YjsManager + real BlockManager mutation path, with a second real
 * DocumentStore wired to `onDocUpdate` exactly where the provider sits.
 */
const createHarness = (): Harness => {
  const config: BlokConfig = { defaultBlock: 'paragraph',
    user: { id: 'user-1' } };
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();

  const yjsManager = new YjsManager({ config,
    eventsDispatcher });
  const blockManager = new BlockManager({ config,
    eventsDispatcher });

  blockManager.state = { YjsManager: yjsManager } as unknown as BlokModules;

  const priv = blockManager as unknown as BlockManagerPrivateAccess;

  priv.yjsSync = { isSyncingFromYjs: false,
    isMaterializing: (): boolean => false };

  yjsManager.addBlock({ id: 'b1',
    type: 'paragraph',
    data: { text: 'hello' } });

  const peer = new DocumentStore(new YBlockSerializer());

  peer.applyRemoteUpdate(yjsManager.encodeStateAsUpdate());

  // Where the provider sits: every local update is relayed to the peer.
  yjsManager.onDocUpdate((update) => {
    peer.applyRemoteUpdate(update);
  });

  const blockStub: BlockStub = {
    id: 'b1',
    name: 'paragraph',
    parentId: null,
    holder: document.createElement('div'),
    tool: { name: 'paragraph' },
    save: vi.fn(),
  };

  const startMutation = (text: string): { resolveSave: () => void } => {
    let release = (): void => {};
    const pending = new Promise<{ data: { text: string } }>((resolve) => {
      release = (): void => resolve({ data: { text } });
    });

    blockStub.save.mockReturnValue(pending);
    priv.blockDidMutated(BlockChangedMutationType, blockStub, { index: 0 });

    return { resolveSave: release };
  };

  const peerText = (): string => {
    const block = peer.toJSON().find((candidate) => candidate.id === 'b1');

    return ((block?.data ?? {}) as Record<string, string>).text;
  };

  return { yjsManager,
    peer,
    peerText,
    startMutation };
};

describe('teardown — a block.save() still in flight when the editor is destroyed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Only the buffer's trailing timers are faked; every await below is a real
    // microtask drain.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('lands the last thing typed on the peer when nothing tears down (control)', async () => {
    const harness = createHarness();
    const { resolveSave } = harness.startMutation('hello world');

    resolveSave();
    await drainMicrotasks();

    expect(harness.peerText()).toBe('hello world');
  });

  it.fails('lands the last thing typed on the peer when the save resolves after destroy', async () => {
    const harness = createHarness();

    // The user types; BlockManager starts syncBlockDataToYjs and is sitting in
    // `await block.save()`.
    const { resolveSave } = harness.startMutation('hello world');

    // The tab goes away. Both documented flush barriers run — Collaboration's
    // (before the provider dies) and YjsManager.destroy's — and both find an
    // EMPTY buffer, because the write has not been enqueued yet.
    harness.yjsManager.flushPendingBlockWrites();
    harness.yjsManager.destroy();

    // Only now does save() resolve.
    resolveSave();
    await drainMicrotasks();

    // THE DEFECT: the characters the user typed never reach the peer.
    expect(harness.peerText()).toBe('hello world');

    // The late write also arms a fresh 400ms trailing window against a
    // document that no longer exists — a timer that outlives the editor.
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('read-only mutex — the keystroke whose MutationRecord was still queued', () => {
  let eventsDispatcher: EventsDispatcher<BlokEventMap>;
  let redactor: HTMLElement;
  let observer: ModificationsObserver;
  let delivered: MutationRecord[][];

  beforeEach(() => {
    vi.clearAllMocks();

    redactor = document.createElement('div');
    document.body.appendChild(redactor);

    eventsDispatcher = new EventsDispatcher<BlokEventMap>();
    observer = new ModificationsObserver({
      config: {},
      eventsDispatcher,
    });

    observer.state = {
      UI: { nodes: { redactor } },
      ReadOnly: { isEnabled: false },
    } as unknown as BlokModules;

    // This is the editor-level channel every Block's MutationHandler listens
    // on; it is the ONLY way a keystroke reaches syncBlockDataToYjs.
    delivered = [];
    eventsDispatcher.on(RedactorDomChanged, (payload) => {
      delivered.push(payload.mutations);
    });

    observer.enable();
  });

  afterEach(() => {
    observer.destroy();
    redactor.remove();
    vi.restoreAllMocks();
  });

  it('delivers a keystroke that nothing interrupts (control)', async () => {
    redactor.appendChild(document.createTextNode('typed'));

    await drainMicrotasks();

    expect(delivered.flat().length).toBeGreaterThan(0);
  });

  it.fails('still delivers the keystroke when read-only takes the DOM mutex in the same task', async () => {
    redactor.appendChild(document.createTextNode('typed'));

    // What ReadOnly.applyReadOnly does first, before re-rendering or calling
    // setReadOnly on every block (src/components/modules/readonly.ts).
    observer.disable();

    await drainMicrotasks();

    // THE DEFECT: `disconnect()` empties the MutationObserver's record queue,
    // so the character never reaches any Block's mutation handler, never
    // reaches syncBlockDataToYjs, and never reaches the Yjs document.
    expect(delivered.flat().length).toBeGreaterThan(0);

    observer.enable();
    await drainMicrotasks();

    // Nor does re-enabling bring it back.
    expect(delivered.flat().length).toBeGreaterThan(0);
  });
});

describe('write buffer — a flush that throws', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('lands both blocks at the barrier when no flush throws (control)', () => {
    const buffer = new BlockWriteBuffer(400);
    const written: Array<[string, unknown]> = [];
    const record = (entries: ReadonlyMap<string, unknown>): boolean => {
      entries.forEach((value, key) => written.push([key, value]));

      return true;
    };

    buffer.enqueue('a1', { text: 'a-leading' }, () => true);
    buffer.enqueue('b1', { text: 'b-leading' }, () => true);
    buffer.enqueue('a1', { text: 'a-trailing' }, record);
    buffer.enqueue('b1', { text: 'b-trailing' }, record);

    buffer.flushAll();

    expect(written).toEqual([['text', 'a-trailing'], ['text', 'b-trailing']]);
  });

  it.fails('lands every other block buffered when one block flush throws at the barrier', () => {
    const buffer = new BlockWriteBuffer(400);
    const written: Array<[string, unknown]> = [];

    // Two blocks, both with an OPEN window carrying a trailing value.
    buffer.enqueue('a1', { text: 'a-leading' }, () => true);
    buffer.enqueue('b1', { text: 'b-leading' }, () => true);

    buffer.enqueue('a1', { text: 'a-trailing' }, () => {
      throw new Error('tool save data is not writable');
    });
    buffer.enqueue('b1', { text: 'b-trailing' }, (entries) => {
      entries.forEach((value, key) => written.push([key, value]));

      return true;
    });

    // The barrier every teardown / structural chokepoint calls.
    try {
      buffer.flushAll();
    } catch {
      // The caller sees a1's failure; b1's content is a separate question.
    }

    // THE DEFECT: b1's buffered text was abandoned by the barrier.
    expect(written).toEqual([['text', 'b-trailing']]);

    // And b1's window is still open with a live trailing timer, so the barrier
    // did not even leave the buffer drained for the teardown that follows it.
    expect(vi.getTimerCount()).toBe(0);
  });
});
