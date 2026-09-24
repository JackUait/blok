import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { BlockManager } from '../../../../../src/components/modules/blockManager/blockManager';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../../types';
import { BlockChangedMutationType } from '../../../../../types/events/block/BlockChanged';


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
  startMutation: (text: string | null) => { resolveSave: () => void };
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

  const startMutation = (text: string | null): { resolveSave: () => void } => {
    let release = (): void => {};
    const pending = new Promise<{ data: { text: string } } | undefined>((resolve) => {
      release = (): void => resolve(text === null ? undefined : { data: { text } });
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

describe('a gesture that starts while an earlier save is still in flight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const undoSteps = (harness: Harness): number =>
    (harness.yjsManager as unknown as { undoHistory: { undoManager: { undoStack: unknown[] } } }).undoHistory.undoManager.undoStack.length;

  it('keeps the late write of the earlier typing out of the new gesture\'s step', async () => {
    const harness = createHarness();
    const steps = undoSteps(harness);
    const typing = harness.startMutation('hello X');

    harness.yjsManager.beginGesture('discrete');
    typing.resolveSave();
    await drainMicrotasks();

    const format = harness.startMutation('<b>hello</b> X');

    format.resolveSave();
    await drainMicrotasks();
    vi.runAllTimers();

    expect(harness.peerText()).toBe('<b>hello</b> X');
    expect(undoSteps(harness) - steps).toBe(2);
  });

  it('keeps the late write out of a gesture that already wrote', async () => {
    const harness = createHarness();

    // b1's creation is not the typing's step.
    harness.yjsManager.stopCapturing();
    const steps = undoSteps(harness);
    const typing = harness.startMutation('hello X');

    // Enter: a gesture that writes at once, before the typing's save lands.
    harness.yjsManager.beginGesture('discrete');
    harness.yjsManager.addBlock({ id: 'b2',
      type: 'paragraph',
      data: { text: '' } });
    typing.resolveSave();
    await drainMicrotasks();
    vi.runAllTimers();

    expect(undoSteps(harness) - steps).toBe(2);

    harness.yjsManager.undo();

    expect(harness.yjsManager.toJSON().map((block) => block.id)).toEqual(['b1']);
    expect(harness.yjsManager.toJSON()[0]?.data).toEqual({ text: 'hello X' });

    harness.yjsManager.undo();

    expect(harness.yjsManager.toJSON()[0]?.data).toEqual({ text: 'hello' });
  });

  it('keeps the gesture one step when the save it waited on writes nothing', async () => {
    const harness = createHarness();

    harness.yjsManager.stopCapturing();

    const steps = undoSteps(harness);
    const typing = harness.startMutation(null);

    harness.yjsManager.beginGesture('discrete');
    harness.yjsManager.addBlock({ id: 'b2',
      type: 'paragraph',
      data: { text: '' } });
    typing.resolveSave();
    await drainMicrotasks();
    // The gesture's own deferred write.
    harness.yjsManager.updateBlockData('b2', 'text', 'x');
    vi.runAllTimers();

    expect(undoSteps(harness) - steps).toBe(1);
  });

  it('adds the late write to the typing step it belongs to', async () => {
    const harness = createHarness();
    // The typing run starts its own step.
    harness.yjsManager.beginGesture('typing');

    const steps = undoSteps(harness);
    const first = harness.startMutation('hello X');

    first.resolveSave();
    await drainMicrotasks();

    const typing = harness.startMutation('hello XY');

    harness.yjsManager.beginGesture('discrete');
    harness.yjsManager.addBlock({ id: 'b2',
      type: 'paragraph',
      data: { text: '' } });
    typing.resolveSave();
    await drainMicrotasks();
    vi.runAllTimers();

    expect(undoSteps(harness) - steps).toBe(2);

    harness.yjsManager.undo();

    expect(harness.yjsManager.toJSON().map((block) => block.id)).toEqual(['b1']);
    expect(harness.yjsManager.toJSON()[0]?.data).toEqual({ text: 'hello XY' });

    harness.yjsManager.undo();

    expect(harness.yjsManager.toJSON()[0]?.data).toEqual({ text: 'hello' });
    expect(harness.yjsManager.canUndo()).toBe(true);
  });
});
