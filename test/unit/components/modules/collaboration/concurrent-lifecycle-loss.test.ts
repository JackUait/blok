/**
 * Data loss across the collaboration provider's LIFECYCLE: connect, disconnect,
 * reconnect, offline editing and resync.
 *
 * Same wire as `concurrent-transport-loss.test.ts` — a hand-pumped `Room` that
 * speaks `blok-sync.v2` — but the sequences here are about the session's own
 * comings and goings rather than about frames in flight.
 *
 * "Loss" here means: something a person typed is not in the room, or not in
 * the other person's document, once the wire has settled.
 */
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../../src/components/core';
import type { CollaborationConfig } from '../../../../../src/components/modules/collaboration';
import { escapePartitionSegment } from '../../../../../src/components/modules/collaboration/operation-store';
import { decode, encode } from '../../../../../src/components/modules/collaboration/sync-wire';
import type { SyncWireFrame } from '../../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { Bookmark } from '../../../../../src/tools/link/bookmark';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { OutputBlockData } from '../../../../../types';

const LINEAGE = '0123456789abcdef0123456789abcdef';
const OTHER_LINEAGE = 'fedcba9876543210fedcba9876543210';
const V2 = 'blok-sync.v2';
const V1 = 'blok-sync.v1';

/** Frames the room has queued for one member, and whether it can receive them. */
interface Member {
  socket: RoomSocket;
  online: boolean;
  outbound: SyncWireFrame[];
}

/**
 * The transport. Every client write goes to the room synchronously, exactly as
 * a socket hands bytes to the server; everything the room sends back is queued
 * and delivered only when a test pumps the wire.
 */
class RoomSocket {
  public binaryType = 'blob';

  public readyState = 0;

  public protocol = '';

  public onopen: ((event: unknown) => void) | null = null;

  public onmessage: ((event: { data: unknown }) => void) | null = null;

  public onclose: ((event: { code: number; reason: string }) => void) | null = null;

  public onerror: ((event: unknown) => void) | null = null;

  public readonly sent: SyncWireFrame[] = [];

  public room: Room | null = null;

  public constructor(public readonly url: string, public readonly protocols: string[]) {}

  /**
   * @param data - the encoded frame the provider wrote
   */
  public send(data: ArrayBufferLike | ArrayBufferView): void {
    const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer);
    const decoded = decode(bytes);

    // The harness stands in for the server, so a frame it cannot read is a bug
    // in the test rather than something to swallow: swallowing one would make
    // a dropped edit look like a passing assertion.
    if (decoded.type === 'unknown' || decoded.type === 'malformed') {
      throw new Error(`the test room could not read a frame: ${JSON.stringify(decoded)}`);
    }

    const frame: SyncWireFrame = decoded;

    this.sent.push(frame);
    this.room?.receive(this, frame);
  }

  /**
   * @param code - close code the client asked for
   */
  public close(code?: number): void {
    this.readyState = 3;
    this.room?.forget(this);
    void code;
  }

  /**
   * @param frame - what the room is handing this client
   */
  public deliver(frame: SyncWireFrame): void {
    this.onmessage?.({ data: encode(frame) });
  }

  /**
   * @param code - close code the room is hanging up with
   * @param reason - the close reason
   */
  public serverClose(code: number, reason = ''): void {
    this.readyState = 3;
    this.room?.forget(this);
    this.onclose?.({ code, reason });
  }
}

/**
 * A conformant-enough `blok-sync.v2` room: one document, per-member outbound
 * queues, operation acknowledgement with gap-free sequences, idempotent
 * re-sends, and a type-0 broadcast of every committed update.
 */
class Room {
  public doc = new DocumentStore(new YBlockSerializer());

  public lineage = LINEAGE;

  public epoch = 0;

  public protocol: string = V2;

  /** New sockets are connected as they arrive while this is true. */
  public accepting = true;

  public readonly members: Member[] = [];

  /** Sockets created while the room was unreachable. */
  public readonly pending: RoomSocket[] = [];

  /** Operations committed on the current lineage: id → its sequence. */
  public committed = new Map<string, number>();

  /** Refuses the next operation with this code, once. */
  public rejectOnce: string | null = null;

  private sequence = 0;

  /**
   * @param socket - a socket the client just opened
   */
  public arrive(socket: RoomSocket): void {
    /* eslint-disable-next-line no-param-reassign -- this room stands in for the
       server, and attaching to the socket it was handed is what a server does. */
    socket.room = this;

    if (!this.accepting) {
      this.pending.push(socket);

      return;
    }

    this.connect(socket);
  }

  /**
   * A restart onto storage that never carried the tail: a genuinely fresh
   * document, NOT a delete — a delete would be history the peers must honour.
   */
  public restart(): void {
    const previous = this.doc;

    this.doc = new DocumentStore(new YBlockSerializer());
    previous.destroy();
    this.committed = new Map();
  }

  /** Lets every socket that was waiting through. */
  public heal(): void {
    this.accepting = true;

    this.pending.splice(0).forEach((socket) => this.connect(socket));
  }

  /**
   * @param socket - the socket to negotiate and send the control frame to
   */
  public connect(socket: RoomSocket): void {
    const member: Member = {
      socket,
      online: true,
      outbound: [],
    };

    this.members.push(member);
    /* eslint-disable-next-line no-param-reassign -- see `arrive`: the room owns
       the socket's server-side fields, the same way the real server does. */
    socket.protocol = this.protocol;
    // eslint-disable-next-line no-param-reassign -- same reason
    socket.readyState = 1;

    // Queued BEFORE the open: the provider writes its SyncStep1 inside
    // `onopen`, and the control frame is the server's first word either way.
    member.outbound.push({
      type: 'control',
      tag: {
        format: 1,
        epoch: this.epoch,
        lineage: this.lineage,
      },
    });

    socket.onopen?.({});
  }

  /**
   * @param socket - the socket to stop tracking
   */
  public forget(socket: RoomSocket): void {
    const index = this.members.findIndex((member) => member.socket === socket);

    if (index >= 0) {
      this.members.splice(index, 1);
    }
  }

  /**
   * @param socket - the socket whose member row to read
   */
  public memberOf(socket: RoomSocket): Member | undefined {
    return this.members.find((member) => member.socket === socket);
  }

  /**
   * One inbound client frame.
   * @param socket - the connection it came in on
   * @param frame - the decoded frame
   */
  public receive(socket: RoomSocket, frame: SyncWireFrame): void {
    const member = this.memberOf(socket);

    // A member the room dropped, or one whose link is cut: the bytes never
    // reach the server.
    if (member === undefined || !member.online) {
      return;
    }

    switch (frame.type) {
      case 'syncStep1':
        member.outbound.push({
          type: 'syncStep2',
          update: this.doc.encodeStateAsUpdate(frame.stateVector),
        });
        member.outbound.push({
          type: 'syncStep1',
          stateVector: this.doc.getStateVector(),
        });
        break;
      case 'syncStep2':
      case 'update':
        // The v1 write path: apply, then relay verbatim to everyone else.
        this.doc.applyRemoteUpdate(frame.update);
        this.broadcast(frame.update, member, false);
        break;
      case 'operation':
        this.commit(member, frame);
        break;
      case 'awareness':
        this.members.forEach((other) => {
          if (other !== member) {
            other.outbound.push(frame);
          }
        });
        break;
      // Frames this room does not model — server-to-client only, or never sent
      // by the client in these specs. Listed one by one rather than folded into
      // `default`, so a NEW frame type in the protocol reds this switch instead
      // of being quietly ignored by a harness that stands in for the server.
      case 'queryAwareness':
      case 'permissionDenied':
      case 'control':
      case 'limits':
      case 'acknowledgement':
      case 'rejection':
      case 'activity':
      case 'identities':
        break;
      default:
        break;
    }
  }

  /**
   * Protocol section 7.2 + section 8: commit once, acknowledge always.
   * @param member - who sent it
   * @param frame - the operation frame
   */
  private commit(member: Member, frame: Extract<SyncWireFrame, { type: 'operation' }>): void {
    // A room that is not ready yet: the client must keep the row and retry.
    if (this.rejectOnce !== null) {
      const code = this.rejectOnce;

      this.rejectOnce = null;
      member.outbound.push({
        type: 'rejection',
        lineage: frame.lineage,
        operationId: frame.operationId,
        code,
      });

      return;
    }

    if (frame.lineage !== this.lineage) {
      member.outbound.push({
        type: 'rejection',
        lineage: frame.lineage,
        operationId: frame.operationId,
        code: 'lineage-mismatch',
      });

      return;
    }

    const already = this.committed.get(frame.operationId);
    const assigned = already ?? (this.sequence += 1);

    if (already === undefined) {
      this.committed.set(frame.operationId, assigned);
      this.doc.applyRemoteUpdate(frame.update);
      // Section 7: the broadcast goes to every member, the submitter included.
      this.broadcast(frame.update, member, true);
    }

    member.outbound.push({
      type: 'acknowledgement',
      lineage: this.lineage,
      operationId: frame.operationId,
      serverSequence: String(assigned),
    });
  }

  /**
   * @param update - the committed bytes
   * @param from - the member that submitted them
   * @param includeSender - whether the submitter gets the broadcast too
   */
  private broadcast(update: Uint8Array, from: Member, includeSender: boolean): void {
    this.members.forEach((member) => {
      if (member === from && !includeSender) {
        return;
      }

      member.outbound.push({
        type: 'update',
        update,
      });
    });
  }

  /** Whether no online member still has a frame waiting to go out. */
  private isQuiet(): boolean {
    return !this.members.some((candidate) => candidate.online && candidate.outbound.length > 0);
  }

  /**
   * Let pending work settle, then report whether the wire went quiet. The tick
   * matters: a provider often queues its next frame from a promise callback,
   * so "nothing queued right now" is only true after the microtasks drain.
   */
  private async settleIdle(): Promise<boolean> {
    await tick();

    return this.isQuiet();
  }

  /** Delivers everything queued, one frame at a time, until the wire is quiet. */
  public async pump(rounds = 40): Promise<void> {
    for (let round = 0; round < rounds; round += 1) {
      const member = this.members.find((candidate) => candidate.online && candidate.outbound.length > 0);

      // Split in two so neither branch nests: the first answers "idle and
      // nothing left to send", the second just goes round again.
      if (member === undefined && await this.settleIdle()) {
        return;
      }

      if (member === undefined) {
        continue;
      }

      const frame = member.outbound.shift();

      if (frame !== undefined) {
        member.socket.deliver(frame);
      }

      await tick();
    }
  }

  /**
   * @param blocks - what the room holds before anybody joins
   */
  public seed(blocks: OutputBlockData[]): void {
    this.doc.fromJSON(blocks.map((block, index) => ({
      id: block.id ?? `room-${index}`,
      type: block.type,
      data: block.data,
    })));
  }

  public texts(): (string | undefined)[] {
    return this.doc.toJSON().map((block) => (block.data as { text?: string }).text);
  }
}

/** One macrotask, so the store's IndexedDB transactions can commit. */
const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param predicate - what to wait for
 * @param label - what the caller was waiting for
 * @param timeoutMs - how long before giving up
 */
const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  label = 'condition',
  timeoutMs = 4000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (!(await predicate())) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }

    await tick(10);
  }
};

interface Peer {
  core: Core;
  sockets: RoomSocket[];
  socket: () => RoomSocket;
  scope: string;
}

const holders: HTMLElement[] = [];
const booted: Core[] = [];

/**
 * Module teardown, mirroring what Blok.destroy() does.
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
 * Boots one editor against a room.
 * @param room - the room its sockets join
 * @param scope - the identity partition (one per browser)
 * @param offline - whether this peer keeps a local copy
 */
const bootPeer = async (room: Room, scope: string, offline = true, handshakeTimeoutMs?: number): Promise<Peer> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  holders.push(holder);

  const sockets: RoomSocket[] = [];
  const collaboration: CollaborationConfig = {
    doc: 'doc-1',
    offline,
    offlineScope: offline ? scope : undefined,
    // Deterministic backoff: half the ceiling, never a random wait.
    random: () => 0,
    ...(handshakeTimeoutMs === undefined ? {} : { handshakeTimeoutMs }),
    socketFactory: (url, protocols) => {
      const socket = new RoomSocket(url, protocols);

      sockets.push(socket);
      socket.room = room;
      // Deferred: the provider attaches its handlers AFTER the factory returns.
      setTimeout(() => room.arrive(socket), 0);

      return socket;
    },
  };

  const core = new Core({
    holder,
    minHeight: 50,
    tools: { paragraph: { class: Paragraph },
      bookmark: { class: Bookmark } },
    server: 'https://sync.test/api/',
    collaboration,
  });

  await core.isReady;
  booted.push(core);

  return {
    core,
    sockets,
    socket: () => {
      const socket = sockets.at(-1);

      if (socket === undefined) {
        throw new Error('no socket was opened');
      }

      return socket;
    },
    scope,
  };
};

/**
 * The database one identity partition's store opens, spelled exactly as
 * `createOperationStore` spells it.
 * @param scope - the identity partition
 */
const cacheDbName = (scope: string): string =>
  `blok-ops-${escapePartitionSegment('wss://sync.test/api/sync/doc-1')}|${escapePartitionSegment('doc-1')}|${escapePartitionSegment(scope)}`;

/**
 * Every row of one object store, read raw — the store exposes no reader for
 * `quarantine`, and quarantine is where a lineage reset puts the work it
 * refuses to send.
 * @param scope - the identity partition
 * @param objectStore - which object store to read
 */
const rawRows = async (scope: string, objectStore: string): Promise<Record<string, unknown>[]> =>
  new Promise((resolve) => {
    const request = indexedDB.open(cacheDbName(scope));

    request.onerror = () => resolve([]);
    request.onsuccess = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(objectStore)) {
        db.close();
        resolve([]);

        return;
      }

      const all = db.transaction(objectStore, 'readonly').objectStore(objectStore).getAll();

      all.onsuccess = () => {
        db.close();
        resolve(all.result as Record<string, unknown>[]);
      };
      all.onerror = () => {
        db.close();
        resolve([]);
      };
    };
  });

/**
 * The document a set of updates replays into.
 * @param updates - update bytes, applied in order
 */
const textsOf = (updates: Uint8Array[]): (string | undefined)[] => {
  const replay = new DocumentStore(new YBlockSerializer());

  for (const update of updates) {
    replay.applyRemoteUpdate(update);
  }

  const texts = replay.toJSON().map((block) => (block.data as { text?: string }).text);

  replay.destroy();

  return texts;
};

const collabAttr = (core: Core): string | null =>
  core.moduleInstances.UI.nodes.wrapper.getAttribute('data-blok-collab');

const docTexts = (core: Core): (string | undefined)[] =>
  core.moduleInstances.YjsManager.toJSON().map((block) => (block.data as { text?: string }).text);

/**
 * Waits for a peer's first sync, pumping the wire while it waits.
 * @param room - the wire
 * @param peer - the editor
 */
const waitConnected = async (room: Room, peer: Peer): Promise<void> => {
  await waitFor(async () => {
    await room.pump();

    return collabAttr(peer.core) === 'connected';
  }, 'the peer to connect');
};

/**
 * Settles the wire: pump, let stores commit, pump again.
 * @param room - the wire
 * @param rounds - how many pump/idle cycles
 */
const settle = async (room: Room, rounds = 8): Promise<void> => {
  for (let round = 0; round < rounds; round += 1) {
    await room.pump();
    await tick(10);
  }
};

/**
 * Pumps the wire until it converges, or gives up. A timeout is TOLERATED: the
 * assertion that follows is the one that has to name the loss.
 * @param room - the wire
 * @param predicate - what convergence looks like
 * @param label - what the caller was waiting for
 * @param timeoutMs - how long to keep pumping (reconnect backoff is 500ms+)
 */
const converge = async (
  room: Room,
  predicate: () => boolean,
  label: string,
  timeoutMs = 8000
): Promise<void> => {
  await waitFor(async () => {
    await room.pump();
    await tick(10);

    return predicate();
  }, label, timeoutMs).catch(() => undefined);

  await settle(room, 6);
};


/**
 * Waits until a rebooted peer has its offline copy back in the document.
 * @param peer - the editor
 * @param label - what the caller was waiting for
 */
const waitAdopted = async (peer: Peer, label = 'the offline copy to be adopted'): Promise<void> => {
  await waitFor(() => docTexts(peer.core).length > 0, label);
};

describe('collaboration lifecycle — losing work across connect, disconnect and resync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('indexedDB', new IDBFactory());
  });

  afterEach(() => {
    booted.splice(0).forEach(destroyCore);
    holders.splice(0).forEach((holder) => holder.remove());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /**
   * The plain offline story: close the laptop, reopen the tab with no network,
   * type, then get the network back. The new session has never connected, so
   * everything it knows about the room comes from the adopted copy.
   */
  it('lands an edit typed after a reload that never reached the server', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const alice = await bootPeer(room, 'alice');
    const bob = await bootPeer(room, 'bob');

    await waitConnected(room, alice);
    await waitConnected(room, bob);

    // The tab closes cleanly, and the network is gone before it comes back.
    destroyCore(booted.splice(booted.indexOf(bob.core), 1)[0]);
    await tick(50);
    room.accepting = false;

    const reopened = await bootPeer(room, 'bob');

    await waitAdopted(reopened);

    reopened.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed before any socket');
    await tick(100);

    room.heal();
    await converge(
      room,
      () => room.texts()[0] === 'typed before any socket',
      'the edit typed before the first socket to reach the room'
    );

    expect(
      room.texts(),
      'an edit typed after a reload, before the session ever connected, never reached the room'
    ).toEqual(['typed before any socket']);
    expect(docTexts(alice.core)).toEqual(['typed before any socket']);
  }, 30_000);

  /**
   * Both people lose the link at the same moment and both type. Neither has
   * seen the other's work; the reconnect has to carry both.
   */
  it('keeps both peers\' work when both were offline at once', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const alice = await bootPeer(room, 'alice');
    const bob = await bootPeer(room, 'bob');

    await waitConnected(room, alice);
    await waitConnected(room, bob);

    room.accepting = false;
    alice.socket().serverClose(1006);
    bob.socket().serverClose(1006);
    await tick(50);

    alice.core.moduleInstances.YjsManager.addBlock({
      id: 'alice-dark',
      type: 'paragraph',
      data: { text: 'alice in the dark' },
    });
    bob.core.moduleInstances.YjsManager.addBlock({
      id: 'bob-dark',
      type: 'paragraph',
      data: { text: 'bob in the dark' },
    });
    await tick(100);

    room.heal();
    await converge(room, () => room.texts().length === 3, 'both dark edits to land');

    expect(
      room.texts().slice().sort(),
      'work typed while both peers were offline did not survive the reconnect'
    ).toEqual(['alice in the dark', 'bob in the dark', 'shared']);
  }, 30_000);

  /**
   * A flapping link: the server hangs up on every connection right after the
   * control frame while the peer holds a queue of offline rows.
   */
  it('lands a whole offline queue through a flapping link', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const alice = await bootPeer(room, 'alice');
    const bob = await bootPeer(room, 'bob');

    await waitConnected(room, alice);
    await waitConnected(room, bob);

    room.accepting = false;
    bob.socket().serverClose(1006);
    await waitFor(() => collabAttr(bob.core) === 'offline' || bob.sockets.length > 1, 'bob offline');

    for (let index = 0; index < 4; index += 1) {
      bob.core.moduleInstances.YjsManager.addBlock({
        id: `flap-${index}`,
        type: 'paragraph',
        data: { text: `flap ${index}` },
      });
      await tick(20);
    }

    // Three connections that die the moment they are negotiated, then one
    // that survives.
    room.heal();

    for (let flap = 0; flap < 3; flap += 1) {
      await waitFor(() => bob.sockets.at(-1)?.readyState === 1, 'a new socket');
      await room.pump(4);
      bob.sockets.at(-1)?.serverClose(1006);
      await tick(30);
    }

    await converge(room, () => room.texts().length === 5, 'the offline queue to drain through the flapping link');

    expect(
      room.texts().slice().sort(),
      'a flapping link dropped part of the offline queue'
    ).toEqual(['flap 0', 'flap 1', 'flap 2', 'flap 3', 'shared']);
  }, 30_000);

  /**
   * A session configured WITHOUT a local copy still has an in-memory outbox.
   * Losing the link and typing must not lose the edit while the tab is alive.
   */
  it('lands an edit a memory-mode session typed while the link was cut', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const alice = await bootPeer(room, 'alice');
    const bob = await bootPeer(room, 'bob', false);

    await waitConnected(room, alice);
    await waitConnected(room, bob);

    room.accepting = false;
    bob.socket().serverClose(1006);
    await waitFor(() => collabAttr(bob.core) === 'offline' || bob.sockets.length > 1, 'bob offline');

    bob.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'memory mode in the dark');
    await tick(50);

    room.heal();
    await converge(room, () => room.texts()[0] === 'memory mode in the dark', 'the memory-mode edit to land');

    expect(
      room.texts(),
      'a session with no local copy lost the edit it typed while the link was cut'
    ).toEqual(['memory mode in the dark']);
    expect(docTexts(alice.core)).toEqual(['memory mode in the dark']);
  }, 30_000);

  /**
   * The room is restored from a checkpoint that lost the tail WHILE a peer is
   * away holding unsent work. The peer's own rows and the history it alone
   * still holds both have to come back.
   */
  it('restores both the offline rows and the lost tail when the room comes back empty', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const alice = await bootPeer(room, 'alice');
    const bob = await bootPeer(room, 'bob');

    await waitConnected(room, alice);
    await waitConnected(room, bob);

    bob.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'committed once');
    await converge(room, () => room.texts()[0] === 'committed once', 'the edit to commit');

    // Bob goes away, types, and the room restarts empty on the same lineage
    // while he is gone.
    room.accepting = false;
    bob.socket().serverClose(1006);
    alice.sockets.at(-1)?.serverClose(1006);
    await tick(50);

    bob.core.moduleInstances.YjsManager.addBlock({
      id: 'bob-away',
      type: 'paragraph',
      data: { text: 'typed while away' },
    });
    await tick(80);

    room.restart();
    room.heal();
    await converge(room, () => room.texts().length === 2, 'the room to be refilled');

    expect(
      room.texts().slice().sort(),
      'a room that came back empty lost the work its peer typed while away'
    ).toEqual(['committed once', 'typed while away']);
  }, 30_000);

  /**
   * Cmd+W right after the last keystroke. Nothing is given time to settle: the
   * teardown is the only thing between the edit and the closed tab.
   */
  it('keeps the last keystroke when the tab is closed the instant it is typed', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const alice = await bootPeer(room, 'alice');
    const bob = await bootPeer(room, 'bob');

    await waitConnected(room, alice);
    await waitConnected(room, bob);

    room.accepting = false;
    bob.socket().serverClose(1006);
    await waitFor(() => collabAttr(bob.core) === 'offline' || bob.sockets.length > 1, 'bob offline');

    // No tick at all between the edit and the teardown.
    bob.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed then closed at once');
    destroyCore(booted.splice(booted.indexOf(bob.core), 1)[0]);
    await tick(50);

    const reopened = await bootPeer(room, 'bob');

    room.heal();
    await waitConnected(room, reopened);
    await converge(room, () => room.texts()[0] === 'typed then closed at once', 'the last keystroke to ship');

    expect(
      room.texts(),
      'the keystroke typed in the same turn as the teardown never reached the room'
    ).toEqual(['typed then closed at once']);
  }, 30_000);

  /**
   * The browser hides the page rather than tearing the editor down — the
   * `pagehide` path, which is what a phone gives you instead of a clean close.
   */
  it('keeps an edit typed in the same turn as pagehide', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const alice = await bootPeer(room, 'alice');
    const bob = await bootPeer(room, 'bob');

    await waitConnected(room, alice);
    await waitConnected(room, bob);

    room.accepting = false;
    bob.socket().serverClose(1006);
    await waitFor(() => collabAttr(bob.core) === 'offline' || bob.sockets.length > 1, 'bob offline');

    bob.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed at pagehide');
    window.dispatchEvent(new Event('pagehide'));
    destroyCore(booted.splice(booted.indexOf(bob.core), 1)[0]);
    await tick(50);

    const reopened = await bootPeer(room, 'bob');

    room.heal();
    await waitConnected(room, reopened);
    await converge(room, () => room.texts()[0] === 'typed at pagehide', 'the pagehide edit to ship');

    expect(
      room.texts(),
      'the edit typed as the page was hidden never reached the room'
    ).toEqual(['typed at pagehide']);
  }, 30_000);

  /**
   * The room does not stand still while a peer is away: a reboot has to carry
   * its own unsent rows AND take the work that landed meanwhile.
   */
  it('keeps a rebooted peer\'s unsent rows when the room moved on without it', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } },
      { id: 'b2', type: 'paragraph', data: { text: 'second' } }]);

    const alice = await bootPeer(room, 'alice');
    const bob = await bootPeer(room, 'bob');

    await waitConnected(room, alice);
    await waitConnected(room, bob);

    room.accepting = false;
    bob.socket().serverClose(1006);
    await waitFor(() => collabAttr(bob.core) === 'offline' || bob.sockets.length > 1, 'bob offline');

    bob.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'bob was here');
    await tick(50);
    destroyCore(booted.splice(booted.indexOf(bob.core), 1)[0]);
    await tick(50);

    // Alice keeps working while bob's tab is gone.
    alice.core.moduleInstances.YjsManager.updateBlockData('b2', 'text', 'alice kept going');
    await converge(room, () => room.texts()[1] === 'alice kept going', 'alice to land');

    const reopened = await bootPeer(room, 'bob');

    room.heal();
    await waitConnected(room, reopened);
    await converge(
      room,
      () => room.texts()[0] === 'bob was here' && room.texts()[1] === 'alice kept going',
      'both sides to land'
    );

    expect(
      room.texts(),
      'a reboot lost one of the two sides after the room moved on'
    ).toEqual(['bob was here', 'alice kept going']);
  }, 30_000);

  /**
   * v1 work that outlives a reload: cached with no outbox row, adopted by a
   * session that has never connected, and only then does the room come back
   * speaking v2. The residual round is the only thing that can ship it.
   */
  it('ships v1 work that was typed offline and survived a reload, once the room is v2', async () => {
    const room = new Room();

    room.protocol = V1;
    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const alice = await bootPeer(room, 'alice');
    const bob = await bootPeer(room, 'bob');

    await waitConnected(room, alice);
    await waitConnected(room, bob);

    room.accepting = false;
    bob.socket().serverClose(1006);
    await waitFor(() => collabAttr(bob.core) === 'offline' || bob.sockets.length > 1, 'bob offline');

    bob.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'v1 offline then reloaded');
    await tick(80);
    destroyCore(booted.splice(booted.indexOf(bob.core), 1)[0]);
    await tick(50);

    const reopened = await bootPeer(room, 'bob');

    await waitAdopted(reopened);

    room.protocol = V2;
    room.heal();
    await converge(
      room,
      () => room.texts()[0] === 'v1 offline then reloaded',
      'the reloaded v1 work to be enveloped'
    );

    expect(
      room.texts(),
      'v1 work that survived a reload never reached the upgraded room'
    ).toEqual(['v1 offline then reloaded']);
    expect(docTexts(alice.core)).toEqual(['v1 offline then reloaded']);
  }, 30_000);

  /**
   * The room was still loading when the reconnect got there. Protocol section
   * 6 calls `not-synced` transient: nothing is judged invalid, so every row has
   * to survive the refusal.
   */
  it('keeps the offline queue when the room refuses the first operation as not-synced', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const alice = await bootPeer(room, 'alice');
    const bob = await bootPeer(room, 'bob');

    await waitConnected(room, alice);
    await waitConnected(room, bob);

    room.accepting = false;
    bob.socket().serverClose(1006);
    await waitFor(() => collabAttr(bob.core) === 'offline' || bob.sockets.length > 1, 'bob offline');

    bob.core.moduleInstances.YjsManager.addBlock({
      id: 'not-synced-1',
      type: 'paragraph',
      data: { text: 'first offline' },
    });
    await tick(30);
    bob.core.moduleInstances.YjsManager.addBlock({
      id: 'not-synced-2',
      type: 'paragraph',
      data: { text: 'second offline' },
    });
    await tick(30);

    room.rejectOnce = 'not-synced';
    room.heal();
    await converge(room, () => room.texts().length === 3, 'both rows to survive the refusal');

    expect(
      room.texts().slice().sort(),
      'a transient refusal threw away the offline queue behind it'
    ).toEqual(['first offline', 'second offline', 'shared']);
  }, 30_000);

  /**
   * A rollback: the service goes back to v1 while a peer holds journalled rows,
   * then forward to v2 again. The rows may reach nobody in between, and they
   * must still be there when v2 returns.
   */
  it('ships rows held back by a v1 rollback once the room is v2 again', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const alice = await bootPeer(room, 'alice');
    const bob = await bootPeer(room, 'bob');

    await waitConnected(room, alice);
    await waitConnected(room, bob);

    room.accepting = false;
    bob.socket().serverClose(1006);
    await waitFor(() => collabAttr(bob.core) === 'offline' || bob.sockets.length > 1, 'bob offline');

    bob.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'journalled under v2');
    await tick(80);

    // The service rolls back. Bob reconnects onto a v1 room that can receipt
    // nothing, then it rolls forward again.
    room.protocol = V1;
    room.heal();
    await settle(room, 10);

    room.accepting = false;
    bob.sockets.at(-1)?.serverClose(1006);
    await tick(50);

    room.protocol = V2;
    room.heal();
    await converge(room, () => room.texts()[0] === 'journalled under v2', 'the held row to drain');

    expect(
      room.texts(),
      'a row journalled under v2 was lost across a rollback to v1 and back'
    ).toEqual(['journalled under v2']);
    expect(docTexts(alice.core)).toEqual(['journalled under v2']);
  }, 30_000);

  /**
   * Typing THROUGH a flapping link: every connection dies while the queue it
   * was draining is still growing.
   */
  it('lands every edit typed while the link flaps', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const alice = await bootPeer(room, 'alice');
    const bob = await bootPeer(room, 'bob');

    await waitConnected(room, alice);
    await waitConnected(room, bob);

    for (let round = 0; round < 4; round += 1) {
      bob.core.moduleInstances.YjsManager.addBlock({
        id: `during-flap-${round}`,
        type: 'paragraph',
        data: { text: `during flap ${round}` },
      });
      // The socket dies in the same turn the row is written.
      bob.sockets.at(-1)?.serverClose(1006);
      await tick(40);
      await room.pump(6);
    }

    await converge(room, () => room.texts().length === 5, 'every edit typed through the flap to land');

    expect(
      room.texts().slice().sort(),
      'an edit typed in the same turn the socket died was lost'
    ).toEqual(['during flap 0', 'during flap 1', 'during flap 2', 'during flap 3', 'shared']);
  }, 30_000);

  /**
   * Two generations of offline work — one from before the tab closed, one typed
   * after the reload — meet a room that was reset while the tab was away. The
   * loss is designed (old-lineage rows are never replayed), but the recovery
   * copy has to carry BOTH.
   */
  it('keeps both generations of offline work in the recovery copy after a reset', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const alice = await bootPeer(room, 'alice');
    const bob = await bootPeer(room, 'bob');

    await waitConnected(room, alice);
    await waitConnected(room, bob);

    room.accepting = false;
    bob.socket().serverClose(1006);
    await waitFor(() => collabAttr(bob.core) === 'offline' || bob.sockets.length > 1, 'bob offline');

    bob.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'before the reload');
    await tick(80);
    destroyCore(booted.splice(booted.indexOf(bob.core), 1)[0]);
    await tick(50);

    const reopened = await bootPeer(room, 'bob');

    await waitAdopted(reopened);
    reopened.core.moduleInstances.YjsManager.addBlock({
      id: 'after-reload',
      type: 'paragraph',
      data: { text: 'after the reload' },
    });
    await tick(100);

    // The room was reset while bob was away.
    room.lineage = OTHER_LINEAGE;
    room.epoch = 1;
    room.committed = new Map();
    room.heal();
    await settle(room, 14);

    const quarantined = await rawRows('bob', 'quarantine');
    const snapshots = quarantined
      .filter((row) => row.kind === 'snapshot')
      .map((row) => new Uint8Array(row.bytes as Uint8Array));

    expect(
      textsOf(snapshots).slice().sort(),
      'the recovery copy left behind by the reset is missing one of the two generations of offline work'
    ).toEqual(['after the reload', 'before the reload']);
  }, 30_000);

  /**
   * The peers ARE the backup: a reload that adopted a copy, typed on it, and
   * then found the room restored from a checkpoint that lost everything has to
   * put both back.
   */
  it('refills a room that came back empty from a peer that only has its offline copy', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const bob = await bootPeer(room, 'bob');

    await waitConnected(room, bob);

    destroyCore(booted.splice(booted.indexOf(bob.core), 1)[0]);
    await tick(50);
    room.accepting = false;

    const reopened = await bootPeer(room, 'bob');

    await waitAdopted(reopened);
    reopened.core.moduleInstances.YjsManager.addBlock({
      id: 'offline-after-reload',
      type: 'paragraph',
      data: { text: 'typed on the copy' },
    });
    await tick(100);

    // The room restarts having lost everything, but keeps its lineage.
    room.restart();
    room.heal();
    await converge(room, () => room.texts().length === 2, 'the peer to refill the room');

    expect(
      room.texts().slice().sort(),
      'the only peer holding the document did not put it back into a room that came back empty'
    ).toEqual(['shared', 'typed on the copy']);
  }, 30_000);

  /**
   * The endpoint stops answering for long enough that the provider calls the
   * session dead. The work it was holding is on disk, and the next boot is what
   * has to carry it.
   */
  it('ships work stranded by a session the provider gave up on, on the next boot', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const alice = await bootPeer(room, 'alice');
    const bob = await bootPeer(room, 'bob', true, 60);

    await waitConnected(room, alice);
    await waitConnected(room, bob);

    room.accepting = false;
    bob.socket().serverClose(1006);
    await waitFor(() => collabAttr(bob.core) === 'offline' || bob.sockets.length > 1, 'bob offline');

    bob.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'stranded by a dead session');
    await tick(80);

    // Three silent handshakes end the session for good.
    await waitFor(() => collabAttr(bob.core) === 'error', 'the provider to give up', 20_000);

    destroyCore(booted.splice(booted.indexOf(bob.core), 1)[0]);
    await tick(50);

    const reopened = await bootPeer(room, 'bob');

    room.heal();
    await waitConnected(room, reopened);
    await converge(room, () => room.texts()[0] === 'stranded by a dead session', 'the stranded row to ship');

    expect(
      room.texts(),
      'work stranded by a session the provider gave up on never shipped on the next boot'
    ).toEqual(['stranded by a dead session']);
    expect(docTexts(alice.core)).toEqual(['stranded by a dead session']);
  }, 40_000);
});
