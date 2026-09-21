/**
 * Transport-level data loss between two people editing one document.
 *
 * Every test here drives the REAL provider, the REAL operation store and the
 * REAL Yjs document through an explicit wire: a `Room` that speaks
 * `blok-sync.v2` (packages/server/protocol/blok-sync-v2.md) and whose delivery
 * is hand-pumped, so a frame can be held, dropped or delivered late.
 *
 * "Loss" here means: something a person typed is not in the room, or not in
 * the other person's document, once the wire has settled.
 */
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../../src/components/core';
import type { CollaborationConfig } from '../../../../../src/components/modules/collaboration';
import * as operationStore from '../../../../../src/components/modules/collaboration/operation-store';
import { escapePartitionSegment } from '../../../../../src/components/modules/collaboration/operation-store';
import { decode, encode } from '../../../../../src/components/modules/collaboration/sync-wire';
import type { SyncWireFrame } from '../../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { Bookmark } from '../../../../../src/tools/link/bookmark';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { OutputBlockData } from '../../../../../types';

/** Captured before any test can spy the namespace. */
const { createOperationStore } = operationStore;

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
    const frame = decode(bytes);

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

  private sequence = 0;

  /**
   * @param socket - a socket the client just opened
   */
  public arrive(socket: RoomSocket): void {
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
    socket.protocol = this.protocol;
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

  /** Delivers everything queued, one frame at a time, until the wire is quiet. */
  public async pump(rounds = 40): Promise<void> {
    for (let round = 0; round < rounds; round += 1) {
      const member = this.members.find((candidate) => candidate.online && candidate.outbound.length > 0);

      if (member === undefined) {
        await tick();

        if (!this.members.some((candidate) => candidate.online && candidate.outbound.length > 0)) {
          return;
        }

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
const bootPeer = async (room: Room, scope: string, offline = true): Promise<Peer> => {
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

describe('collaboration transport — losing work between two peers', () => {
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

  it('lands an edit typed while the link was cut, once the link comes back (v2)', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const alice = await bootPeer(room, 'alice');
    const bob = await bootPeer(room, 'bob');

    await waitConnected(room, alice);
    await waitConnected(room, bob);

    // Bob's link dies. Nothing he types can leave the tab.
    room.accepting = false;
    bob.socket().serverClose(1006);
    await waitFor(() => collabAttr(bob.core) === 'offline' || bob.sockets.length > 1, 'bob offline');

    bob.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed in the dark');
    await tick(50);

    room.heal();
    await converge(room, () => room.texts()[0] === 'typed in the dark', "bob's offline edit to reach the room");

    expect(room.texts(), 'the room never received the edit bob typed offline').toEqual(['typed in the dark']);
    expect(docTexts(alice.core)).toEqual(['typed in the dark']);
  }, 30_000);

  it('lands an edit typed while the link was cut, once the link comes back (v1 server)', async () => {
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

    bob.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'v1 in the dark');
    await tick(50);

    room.heal();
    await converge(room, () => room.texts()[0] === 'v1 in the dark', "bob's offline edit to reach the v1 room");

    expect(room.texts(), 'a v1 reconnect never shipped the edit made while offline').toEqual(['v1 in the dark']);
    expect(docTexts(alice.core)).toEqual(['v1 in the dark']);
  }, 30_000);

  it('redrives an operation the server never acknowledged before the socket dropped', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const alice = await bootPeer(room, 'alice');
    const bob = await bootPeer(room, 'bob');

    await waitConnected(room, alice);
    await waitConnected(room, bob);

    const bobMember = room.memberOf(bob.socket());

    // The operation reaches the room and commits, but the acknowledgement and
    // the broadcast die with the socket: an unknown commit outcome.
    bob.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'unacknowledged');
    await waitFor(() => bob.socket().sent.some((frame) => frame.type === 'operation'), 'the operation to leave');

    expect(bobMember).toBeDefined();
    bobMember?.outbound.splice(0);
    room.accepting = false;
    bob.socket().serverClose(1006);
    await waitFor(() => collabAttr(bob.core) === 'offline' || bob.sockets.length > 1, 'bob offline');

    room.heal();
    await converge(
      room,
      () => room.texts()[0] === 'unacknowledged' && docTexts(alice.core)[0] === 'unacknowledged',
      'the redriven operation to land everywhere'
    );

    expect(room.texts(), 'the unacknowledged edit was lost on reconnect').toEqual(['unacknowledged']);
    expect(docTexts(alice.core)).toEqual(['unacknowledged']);
    expect(docTexts(bob.core)).toEqual(['unacknowledged']);
  }, 30_000);

  it('keeps an edit typed after the last acknowledgement when the editor is torn down and reopened', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const alice = await bootPeer(room, 'alice');
    const bob = await bootPeer(room, 'bob');

    await waitConnected(room, alice);
    await waitConnected(room, bob);

    // The link dies, bob types, and the tab closes before it is back.
    room.accepting = false;
    bob.socket().serverClose(1006);
    await waitFor(() => collabAttr(bob.core) === 'offline' || bob.sockets.length > 1, 'bob offline');

    bob.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed then closed');
    await tick(50);
    destroyCore(booted.splice(booted.indexOf(bob.core), 1)[0]);
    await tick(50);

    const reopened = await bootPeer(room, 'bob');

    room.heal();
    await waitConnected(room, reopened);
    await converge(room, () => room.texts()[0] === 'typed then closed', 'the reopened tab to ship its edit');

    expect(room.texts(), 'the edit made before the tab closed never reached the room').toEqual(['typed then closed']);
    expect(docTexts(alice.core)).toEqual(['typed then closed']);
  }, 30_000);

  it('keeps a peer\'s unsynced edit when a full snapshot of the room arrives', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const alice = await bootPeer(room, 'alice');
    const bob = await bootPeer(room, 'bob');

    await waitConnected(room, alice);
    await waitConnected(room, bob);

    const bobMember = room.memberOf(bob.socket());

    // Bob's writes are cut off mid-session, but the room keeps talking: alice
    // edits, and the server hands bob a WHOLE-document SyncStep2 (the state
    // vector of an empty peer) on top of his unsynced local write.
    if (bobMember !== undefined) {
      bobMember.online = false;
    }

    bob.core.moduleInstances.YjsManager.addBlock({
      id: 'bob-only',
      type: 'paragraph',
      data: { text: 'bob unsynced' },
    });
    await tick(50);

    alice.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'alice moved on');
    await settle(room, 10);

    if (bobMember !== undefined) {
      bobMember.online = true;
    }

    bob.socket().deliver({
      type: 'syncStep2',
      update: room.doc.encodeStateAsUpdate(),
    });
    await settle(room, 20);

    expect(
      docTexts(bob.core),
      'a whole-document snapshot replaced the block bob had not synced yet'
    ).toEqual(['alice moved on', 'bob unsynced']);
  }, 30_000);

  it('does not strand a peer whose unsynced edits outlive a lineage reset', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const alice = await bootPeer(room, 'alice');
    const bob = await bootPeer(room, 'bob');

    await waitConnected(room, alice);
    await waitConnected(room, bob);

    // Bob loses the link and types.
    room.accepting = false;
    bob.socket().serverClose(1006);
    await waitFor(() => collabAttr(bob.core) === 'offline' || bob.sockets.length > 1, 'bob offline');

    bob.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed before the reset');
    await tick(50);

    // While he was away the room was reset: a new lineage, same document id.
    room.lineage = OTHER_LINEAGE;
    room.epoch = 1;
    room.committed = new Map();
    room.heal();
    await converge(
      room,
      () => room.texts()[0] === 'typed before the reset',
      "bob's pre-reset edit to reach the new lineage"
    );

    const quarantined = await rawRows('bob', 'quarantine');
    const snapshots = quarantined
      .filter((row) => row.kind === 'snapshot')
      .map((row) => new Uint8Array(row.bytes as Uint8Array));

    // The loss itself is the DESIGNED outcome (protocol section 6: old-lineage
    // rows are quarantined, never replayed into the new lineage). What is not
    // allowed is losing it with nothing to recover from — so the recovery
    // snapshot has to carry what was typed.
    expect(
      textsOf(snapshots),
      'a lineage reset destroyed the offline edit with no recovery copy behind it'
    ).toEqual(['typed before the reset']);
    expect(
      room.texts(),
      'the reset lineage is expected NOT to carry the old edit'
    ).toEqual(['shared']);
  }, 30_000);

  it('lands every one of a burst of edits made while the link was cut', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const alice = await bootPeer(room, 'alice');
    const bob = await bootPeer(room, 'bob');

    await waitConnected(room, alice);
    await waitConnected(room, bob);

    room.accepting = false;
    bob.socket().serverClose(1006);
    await waitFor(() => collabAttr(bob.core) === 'offline' || bob.sockets.length > 1, 'bob offline');

    // Five separate blocks, so every one of them is its own outbox row and a
    // drain that stops after the first is visible.
    for (let index = 0; index < 5; index += 1) {
      bob.core.moduleInstances.YjsManager.addBlock({
        id: `offline-${index}`,
        type: 'paragraph',
        data: { text: `offline ${index}` },
      });
      await tick(20);
    }

    room.heal();
    await converge(room, () => room.texts().length === 6, 'the whole offline burst to drain');

    expect(
      room.texts(),
      'part of the offline burst never reached the room'
    ).toEqual(['shared', 'offline 0', 'offline 1', 'offline 2', 'offline 3', 'offline 4']);
    expect(docTexts(alice.core)).toEqual(['shared', 'offline 0', 'offline 1', 'offline 2', 'offline 3', 'offline 4']);
  }, 30_000);

  /**
   * Two tabs of ONE person on ONE document: same identity partition, so they
   * share a single outbox database, and either tab's drain may pick up the
   * other's row.
   */
  it('keeps both tabs\' edits when one person has the document open twice', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const first = await bootPeer(room, 'same-person');
    const second = await bootPeer(room, 'same-person');

    await waitConnected(room, first);
    await waitConnected(room, second);

    first.core.moduleInstances.YjsManager.addBlock({
      id: 'from-first-tab',
      type: 'paragraph',
      data: { text: 'first tab' },
    });
    await tick(30);
    second.core.moduleInstances.YjsManager.addBlock({
      id: 'from-second-tab',
      type: 'paragraph',
      data: { text: 'second tab' },
    });

    await converge(room, () => room.texts().length === 3, 'both tabs to land');

    expect(
      room.texts().slice().sort(),
      'one of the two tabs of the same person lost its edit to the shared outbox'
    ).toEqual(['first tab', 'second tab', 'shared']);
  }, 30_000);

  /**
   * The deployment case protocol section 7.1 step 4 exists for: work typed
   * while the room spoke v1 is cached with NO outbox row, so the only way it
   * ever reaches a server that has since gained a durable store is the
   * post-drain residual diff.
   */
  it('ships work cached under a v1 session once the room comes back as v2', async () => {
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

    bob.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed under v1');
    await tick(50);

    // The service is upgraded while bob is away.
    room.protocol = V2;
    room.heal();
    await converge(room, () => room.texts()[0] === 'typed under v1', 'the v1-cached edit to be enveloped');

    expect(
      room.texts(),
      'an edit cached under a v1 session never reached the upgraded v2 room'
    ).toEqual(['typed under v1']);
    expect(docTexts(alice.core)).toEqual(['typed under v1']);
  }, 30_000);

  /**
   * The room comes back having lost its content but keeping its lineage — a
   * restore that replayed a checkpoint and dropped the tail. The peers' history
   * IS the document, and the handshake is what has to put it back.
   */
  it('restores a room that came back empty on the same lineage', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const alice = await bootPeer(room, 'alice');
    const bob = await bootPeer(room, 'bob');

    await waitConnected(room, alice);
    await waitConnected(room, bob);

    bob.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'committed once');
    await converge(room, () => room.texts()[0] === 'committed once', 'the edit to commit');

    // The server restarts onto a checkpoint that never carried the tail.
    room.accepting = false;
    room.restart();
    alice.sockets.at(-1)?.serverClose(1006);
    bob.sockets.at(-1)?.serverClose(1006);
    await tick(50);

    room.heal();
    await converge(room, () => room.texts().length > 0, 'the peers to put the document back');

    expect(
      room.texts(),
      'a room that came back empty on the same lineage was never refilled by the peers holding it'
    ).toEqual(['committed once']);
  }, 30_000);

  it('keeps both sides when the room and the offline peer edit the same block', async () => {
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

    bob.core.moduleInstances.YjsManager.updateBlockData('b2', 'text', 'bob while away');
    await tick(50);

    alice.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'alice meanwhile');
    await converge(room, () => room.texts()[0] === 'alice meanwhile', "alice's edit to commit");

    room.heal();
    await converge(
      room,
      () => room.texts()[1] === 'bob while away' && docTexts(bob.core)[0] === 'alice meanwhile',
      'both directions to converge'
    );

    expect(room.texts(), 'a reconnect dropped one side of the two-way divergence').toEqual([
      'alice meanwhile',
      'bob while away',
    ]);
    expect(docTexts(bob.core)).toEqual(['alice meanwhile', 'bob while away']);
    expect(docTexts(alice.core)).toEqual(['alice meanwhile', 'bob while away']);
  }, 30_000);

  /**
   * One person, two tabs, one outbox. The offline tab's row is durable and the
   * ONLINE tab shares the database, so the work can leave the browser without
   * waiting for the offline tab to come back.
   */
  it('does not strand one tab\'s offline row while the other tab of the same person is online', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const online = await bootPeer(room, 'same-person');
    const going = await bootPeer(room, 'same-person');

    await waitConnected(room, online);
    await waitConnected(room, going);

    room.accepting = false;
    going.socket().serverClose(1006);
    await waitFor(() => collabAttr(going.core) === 'offline' || going.sockets.length > 1, 'the second tab offline');

    going.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'typed in the offline tab');

    await converge(
      room,
      () => room.texts()[0] === 'typed in the offline tab',
      "the online tab to ship the offline tab's row",
      3000
    );

    // Tolerated as a wait, asserted here: if the online tab never picks it up,
    // the row is still durable — but nobody else sees the edit until that tab
    // comes back.
    expect(
      room.texts(),
      "the offline tab's row never left the browser although a second tab was online"
    ).toEqual(['typed in the offline tab']);
  }, 30_000);

  /**
   * The drain's wake is DROPPED while a pass is already running
   * (`runDrain` returns on `state.draining`), and a pass that read an empty
   * outbox asks for nothing more. So an edit that commits DURING a pass has
   * no event left to carry it: the residual round is once per connection and
   * already spent, the acknowledgement it would ride never comes because
   * nothing was sent, and `onCommitted` never fires for the tab that wrote
   * the row.
   *
   * The slow read models a store under load; the window is the duration of one
   * IndexedDB cursor read, and the edit that lands in it is the last one the
   * person typed.
   */
  it('sends an edit that is typed while a drain pass is reading an empty outbox', async () => {
    const slowReads = { on: false,
      sleeping: false };

    vi.spyOn(operationStore, 'createOperationStore').mockImplementation((options) => {
      const store = createOperationStore(options);

      return {
        ...store,
        oldestPending: async () => {
          const row = await store.oldestPending();

          // The read STARTED before the append and finishes after it: the pass
          // that owns it will answer "nothing waiting".
          if (slowReads.on && row === null) {
            slowReads.sleeping = true;
            await tick(500);
            slowReads.sleeping = false;
          }

          return row;
        },
      };
    });

    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } }]);

    const alice = await bootPeer(room, 'alice');
    const bob = await bootPeer(room, 'bob');

    await waitConnected(room, alice);
    await waitConnected(room, bob);
    // Spends this connection's once-only residual round, so nothing is left to
    // rescue a dropped wake.
    await settle(room, 10);

    slowReads.on = true;
    bob.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'first edit');
    await converge(room, () => room.texts()[0] === 'first edit', 'the first edit to commit');

    // The acknowledgement above started a drain pass. Wait until that pass has
    // read the outbox — it found nothing — and type while it is still the one
    // holding the flag.
    await waitFor(async () => {
      await room.pump();

      return slowReads.sleeping;
    }, 'a drain pass to be mid-read', 5000).catch(() => undefined);
    expect(slowReads.sleeping, 'the window this test needs never opened').toBe(true);
    bob.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'second edit');

    await converge(room, () => room.texts()[0] === 'second edit', 'the second edit to reach the room', 5000);

    expect(
      room.texts(),
      'an edit that committed while a drain pass was reading has no wake left to carry it'
    ).toEqual(['second edit']);
    expect(docTexts(alice.core)).toEqual(['second edit']);
    expect(
      bob.sockets.flatMap((socket) => socket.sent).filter((frame) => frame.type === 'operation').length,
      'the second edit never reached the wire at all'
    ).toBe(2);
  }, 40_000);

  it('keeps both peers\' edits when the wire delivers a remote update out of order', async () => {
    const room = new Room();

    room.seed([{ id: 'b1', type: 'paragraph', data: { text: 'shared' } },
      { id: 'b2', type: 'paragraph', data: { text: 'second' } }]);

    const alice = await bootPeer(room, 'alice');
    const bob = await bootPeer(room, 'bob');

    await waitConnected(room, alice);
    await waitConnected(room, bob);

    const bobMember = room.memberOf(bob.socket());

    // Two alice edits commit; bob's link drops the FIRST broadcast and keeps
    // the second, so the update he does get depends on one he never saw.
    alice.core.moduleInstances.YjsManager.updateBlockData('b1', 'text', 'alice one');
    await settle(room, 6);

    const dropped = bobMember?.outbound.findIndex((frame) => frame.type === 'update') ?? -1;

    if (bobMember !== undefined && dropped >= 0) {
      bobMember.outbound.splice(dropped, 1);
    }

    alice.core.moduleInstances.YjsManager.updateBlockData('b2', 'text', 'alice two');
    await settle(room, 20);

    expect(
      docTexts(bob.core),
      'a dropped broadcast left the peer stalled on a dependency nothing resends'
    ).toEqual(['alice one', 'alice two']);
  }, 30_000);
});
