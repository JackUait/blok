/**
 * The last keystroke before the tab closes must still reach the room.
 *
 * `syncBlockDataToYjs` awaits `block.save()` BEFORE it enqueues anything, so
 * at teardown every flush barrier finds an empty buffer. `YjsManager.destroy`
 * already waits for that save and lands the write into a still-live document
 * — but `Collaboration.destroy` runs FIRST and kills the provider, so the
 * write that finally lands has nothing left to carry it to the peer.
 *
 * "Loss" here is the room's own copy: what the other person would see.
 */
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../../src/components/core';
import type { CollaborationConfig } from '../../../../../src/components/modules/collaboration';
import { decode, encode } from '../../../../../src/components/modules/collaboration/sync-wire';
import type { SyncWireFrame } from '../../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { Bookmark } from '../../../../../src/tools/link/bookmark';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { BlockToolConstructorOptions } from '../../../../../types';

const LINEAGE = '0123456789abcdef0123456789abcdef';

/** One macrotask, so IndexedDB transactions and timers can run. */
const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Generous on purpose: every `waitFor` here is waiting for an EVENT, and a
 * loaded event loop only ever makes an event later, never earlier. A tight
 * deadline buys nothing and turns a full-suite run into a flake.
 * @param predicate - what to wait for
 * @param label - named in the timeout message
 */
const waitFor = async (predicate: () => boolean, label: string): Promise<void> => {
  const deadline = Date.now() + 15000;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await tick(5);
  }
};

/**
 * A `blok-sync.v1` room: it applies every update the client sends and keeps
 * its own copy of the document, which is what a peer would be looking at.
 */
class Room {
  public doc = new DocumentStore(new YBlockSerializer());

  public readonly sockets: RoomSocket[] = [];

  /**
   * @param socket - a socket the client just opened
   */
  public arrive(socket: RoomSocket): void {
    this.sockets.push(socket);
    /* eslint-disable-next-line no-param-reassign -- the room owns the
       server-side fields of the socket it was handed, like a real server. */
    socket.protocol = 'blok-sync.v1';
    // eslint-disable-next-line no-param-reassign -- same reason
    socket.readyState = 1;
    socket.deliver({
      type: 'control',
      tag: {
        format: 1,
        epoch: 0,
        lineage: LINEAGE,
      },
    });
    socket.onopen?.({});
  }

  /**
   * @param socket - the connection the frame came in on
   * @param frame - the decoded frame
   */
  public receive(socket: RoomSocket, frame: SyncWireFrame): void {
    switch (frame.type) {
      case 'syncStep1':
        socket.deliver({
          type: 'syncStep2',
          update: this.doc.encodeStateAsUpdate(frame.stateVector),
        });
        socket.deliver({
          type: 'syncStep1',
          stateVector: this.doc.getStateVector(),
        });
        break;
      case 'syncStep2':
      case 'update':
        this.doc.applyRemoteUpdate(frame.update);
        break;
      // Frames this room does not model. Listed one by one rather than folded
      // into `default`, so a NEW frame type reds this switch instead of being
      // quietly ignored by a harness that stands in for the server.
      case 'awareness':
      case 'queryAwareness':
      case 'permissionDenied':
      case 'control':
      case 'limits':
      case 'operation':
      case 'acknowledgement':
      case 'rejection':
      case 'activity':
      case 'identities':
        break;
      default:
        break;
    }
  }

  public texts(): (string | undefined)[] {
    return this.doc.toJSON().map((block) => (block.data as { text?: string }).text);
  }
}

/** The socket the provider writes to; every frame goes straight to the room. */
class RoomSocket {
  public binaryType = 'blob';

  public readyState = 0;

  public protocol = '';

  public onopen: ((event: unknown) => void) | null = null;

  public onmessage: ((event: { data: unknown }) => void) | null = null;

  public onclose: ((event: { code: number; reason: string }) => void) | null = null;

  public onerror: ((event: unknown) => void) | null = null;

  public room: Room | null = null;

  /**
   * @param url - where the provider dialled
   * @param protocols - the subprotocols it offered
   */
  public constructor(public readonly url: string, public readonly protocols: string[]) {}

  /**
   * @param data - the encoded frame the provider wrote
   */
  public send(data: ArrayBufferLike | ArrayBufferView): void {
    const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer);
    const decoded = decode(bytes);

    if (decoded.type === 'unknown' || decoded.type === 'malformed') {
      throw new Error(`the test room could not read a frame: ${JSON.stringify(decoded)}`);
    }

    this.room?.receive(this, decoded);
  }

  /**
   * @param code - close code the client asked for
   */
  public close(code?: number): void {
    this.readyState = 3;
    void code;
  }

  /**
   * @param frame - what the room is handing this client
   */
  public deliver(frame: SyncWireFrame): void {
    this.onmessage?.({ data: encode(frame) });
  }
}

/** Resolved by the test, so a save can be caught mid-flight. */
let pendingSave: (() => void) | null = null;
/** True once a save has actually started and is waiting to be released. */
let saveStarted = false;

/**
 * A text tool whose `save()` does not settle until the test says so — the
 * window `syncBlockDataToYjs` spends awaiting a real tool's save.
 */
class SlowText {
  public static readonly isReadOnlySupported = true;

  private readonly element: HTMLElement;

  /**
   * @param options - tool constructor options
   */
  public constructor({ data }: BlockToolConstructorOptions<{ text?: string }>) {
    this.element = document.createElement('div');
    this.element.setAttribute('contenteditable', 'true');
    this.element.textContent = data?.text ?? '';
  }

  /** @returns the tool's root element */
  public render(): HTMLElement {
    return this.element;
  }

  /** @returns the saved data, once the test releases it */
  public async save(): Promise<{ text: string }> {
    const text = this.element.textContent ?? '';

    if (pendingSave === null) {
      return { text };
    }

    const gate = new Promise<void>((resolve) => {
      const release = pendingSave;

      pendingSave = (): void => {
        release?.();
        resolve();
      };
      saveStarted = true;
    });

    await gate;

    return { text: this.element.textContent ?? '' };
  }
}

/**
 * Mirrors `INFLIGHT_WRITE_GRACE_MS` in the collaboration module, which is not
 * exported. A drift makes the give-up below uncapturable and reds the test,
 * which is the point: the bound is what that test pins.
 */
const GIVE_UP_AFTER_MS = 2000;

/** `WebSocket.CLOSED`. */
const CLOSED = 3;

/**
 * Comfortably past every `waitFor` below. Vitest's 5s default would expire
 * FIRST under load and report a timeout instead of the condition that was
 * actually missed.
 */
const TEST_TIMEOUT_MS = 30000;

const holders: HTMLElement[] = [];

/**
 * The document a set of updates replays into. The base state comes first: a
 * bare delta carries no parent structure, so replaying one alone yields an
 * empty document and would make any loss look identical to any success.
 * @param base - full state the deltas are relative to
 * @param updates - update bytes, applied in order
 */
const textsOf = (base: Uint8Array, updates: Uint8Array[]): (string | undefined)[] => {
  const replay = new DocumentStore(new YBlockSerializer());

  replay.applyRemoteUpdate(base);

  for (const update of updates) {
    replay.applyRemoteUpdate(update);
  }

  const texts = replay.toJSON().map((block) => (block.data as { text?: string }).text);

  replay.destroy();

  return texts;
};

/**
 * Module teardown, mirroring what `Blok.destroy()` does.
 * @param core - a booted core
 */
const destroyCore = (core: Core): void => {
  Object.values(core.moduleInstances).forEach((moduleInstance) => {
    const instance = moduleInstance as { markDestroyed?: () => void } | null | undefined;

    if (instance && typeof instance.markDestroyed === 'function') {
      instance.markDestroyed();
    }
  });

  Object.values(core.moduleInstances).forEach((moduleInstance) => {
    const instance = moduleInstance as {
      destroy?: () => void;
      listeners?: { removeAll?: () => void };
    } | null | undefined;

    if (instance && typeof instance.destroy === 'function') {
      instance.destroy();
    }

    if (instance?.listeners && typeof instance.listeners.removeAll === 'function') {
      instance.listeners.removeAll();
    }
  });
};

/**
 * Type into a block until the editor actually reacts.
 *
 * One write is not a keystroke. `ModificationsObserver.disable()` DISCONNECTS
 * the MutationObserver — the mutex `blocks.insert`, the read-only flip and
 * every remote application take — so a DOM change made while it is held is
 * discarded rather than delayed, and afterwards `disabled`/`suspendDepth` read
 * perfectly normal with no trace that anything was lost. On a quiet machine
 * those windows have closed by the time a test types; under a loaded suite
 * they have not. Measured: the doc still said 'a' 15s after the DOM said 'ab',
 * with the observer enabled and the session connected.
 * @param input - the block's editable element
 * @param text - what to type
 * @param observed - how to tell the editor reacted
 */
const typeUntilObserved = async (
  input: HTMLElement,
  text: string,
  observed: () => boolean
): Promise<void> => {
  const deadline = Date.now() + 15000;

  while (!observed()) {
    if (Date.now() > deadline) {
      throw new Error(`typing "${text}" was never observed`);
    }

    /* eslint-disable-next-line no-param-reassign -- typing IS writing to the
       element the caller handed over; that is the whole operation. */
    input.textContent = '';
    // eslint-disable-next-line no-param-reassign -- same reason
    input.textContent = text;

    await tick(20);
  }
};

/**
 * Boots one editor against the room, with a block already in it and every
 * later `save()` hanging until the test releases it.
 * @param room - the room its socket joins
 */
const bootTypingPeer = async (room: Room): Promise<{ core: Core; input: HTMLElement }> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  holders.push(holder);

  const collaboration: CollaborationConfig = {
    doc: 'doc-1',
    offline: true,
    offlineScope: 'scope-a',
    random: () => 0,
    socketFactory: (url, protocols) => {
      const socket = new RoomSocket(url, protocols);

      socket.room = room;
      // Deferred: the provider attaches its handlers AFTER the factory returns.
      setTimeout(() => room.arrive(socket), 0);

      return socket;
    },
  };

  const core = new Core({
    holder,
    minHeight: 50,
    tools: {
      paragraph: { class: Paragraph },
      bookmark: { class: Bookmark },
      text: { class: SlowText },
    },
    defaultBlock: 'text',
    server: 'https://sync.test/api/',
    collaboration,
  });

  await core.isReady;

  await core.moduleInstances.API.methods.blocks.insert('text', { text: 'a' }, undefined, 0, true);
  await waitFor(() => room.texts().includes('a'), 'the room to receive the first block');

  const block = core.moduleInstances.BlockManager.getBlockByIndex(0);

  if (block === undefined) {
    throw new Error('the block under test is missing');
  }

  const input = block.inputs[0];

  /**
   * A warm-up keystroke, and the scenario does not start until it has gone
   * all the way to the room.
   *
   * Booting is NOT enough. `ModificationsObserver.disable()/enable()` is a
   * mutex `blocks.insert`, the read-only flip and every remote application
   * take, and a DOM change made while it is held is never observed at all —
   * not delayed, dropped. On a quiet machine those windows have closed by
   * now; under a loaded suite they have not, and the scenario's keystroke
   * vanishes. Typing reaching the room is the only honest proof the path is
   * live.
   */
  await typeUntilObserved(input, 'ab', () => room.texts().includes('ab'));

  // From here on every save hangs until the test releases it.
  pendingSave = (): void => undefined;

  return {
    core,
    input,
  };
};

describe('Collaboration teardown — a save still in flight', () => {
  let room: Room;

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    room = new Room();
    pendingSave = null;
    saveStarted = false;
  });

  afterEach(() => {
    holders.splice(0).forEach((holder) => holder.remove());
    room.doc.destroy();
  });

  it('sends the last keystroke to the room even when destroy lands mid-save', async () => {
    const { core, input } = await bootTypingPeer(room);

    // The keystroke: a DOM mutation the observer turns into a block save.
    await typeUntilObserved(input, 'abc', () => saveStarted);

    // The same channel Collaboration's outbox tap sits on, so this records
    // exactly what the provider would have had to send.
    const baseState = room.doc.encodeStateAsUpdate();
    const landedLocally: Uint8Array[] = [];
    const unhook = core.moduleInstances.YjsManager.onDocUpdate((update) => {
      landedLocally.push(update);
    });

    // The tab closes while that save is still running.
    destroyCore(core);

    pendingSave?.();

    // The barrier is the write ITSELF landing, not a fixed sleep: both hooks
    // fire in the same synchronous dispatch, so once the document has it the
    // provider has had its chance too. A sleep would let a loaded event loop
    // assert before the save's promise chain had run.
    await waitFor(() => landedLocally.length > 0, 'the late write to land in the document');
    unhook();

    // The defect first: what the other person can see.
    expect(room.texts()).toContain('abc');

    // And the half that already works — the write DOES reach the document
    // (YjsManager.destroy defers for it), so what is missing above was
    // dropped by Collaboration's teardown, not by the write path.
    expect(textsOf(baseState, landedLocally)).toContain('abc');
  }, TEST_TIMEOUT_MS);

  it('gives up on a save that never settles instead of holding the socket open', async () => {
    const { core, input } = await bootTypingPeer(room);

    await typeUntilObserved(input, 'abc', () => saveStarted);

    const socket = room.sockets.at(-1);

    if (socket === undefined) {
      throw new Error('no socket was opened');
    }

    /**
     * The grace period is ADVANCED, never waited out: 2000ms of wall clock
     * under a full suite is a starved event loop and a drifting deadline,
     * i.e. a flake. Only the timers are faked — the store's IndexedDB work is
     * promise-based and keeps running.
     */
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    try {
      // This save is never released: a tool whose save() hangs forever must
      // not leave the tab with a live WebSocket and a beforeunload guard on
      // an editor that is gone.
      destroyCore(core);

      // The deferral is real, and it lasts the WHOLE bound: the wire is still
      // up with a millisecond to go.
      vi.advanceTimersByTime(GIVE_UP_AFTER_MS - 1);
      expect(socket.readyState).not.toBe(CLOSED);

      vi.advanceTimersByTime(1);
      expect(socket.readyState).toBe(CLOSED);
    } finally {
      vi.useRealTimers();
    }
  }, TEST_TIMEOUT_MS);
});
