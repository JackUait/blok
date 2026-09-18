import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';

import { TEST_PAGE_URL } from './ensure-build';

/**
 * In-browser collaboration harness.
 *
 * Blok's `collaboration` block accepts an undocumented `socketFactory` seam
 * (`src/components/modules/collaboration/index.ts`) that the provider dials
 * instead of the global WebSocket. This harness plugs a BroadcastChannel into
 * that seam, so two real Blok editors — each with its own DOM, its own tools
 * and (optionally) its own page — converge against each other with no server
 * and no .NET build.
 *
 * The relay is deliberately dumb: it parses ONE byte pair (sync/SyncStep1) and
 * relays everything else verbatim. That is enough because the y-protocols
 * message set is peer-symmetric — a client answers a peer's SyncStep1 with a
 * SyncStep2 exactly as a server would. The one thing no peer can answer is the
 * FIRST client's SyncStep1 in an empty room, so the opener is told to answer
 * its own (see `seedsEmptyRoom`).
 *
 * TWO CLIENTS PER ROOM, ENFORCED. The real server answers a SyncStep1 only to
 * the client that asked (`CollabRoom.cs:1955-1956`) and relays updates with
 * `BroadcastLocked(frame, except: sender)`. This relay fans everything out to
 * everyone. With two clients that is the same thing; with three it is not —
 * every peer answers a joiner's SyncStep1, so a client that has not synced yet
 * can receive a SyncStep2 computed against SOMEONE ELSE'S state vector and
 * then `markSynced()` (`provider.ts:1113`) on an incomplete document. So
 * `mountCollabEditor` throws on a third member rather than let a 3-client test
 * be quietly false-green. Fan-out would have to become point-to-point (tag the
 * SyncStep1 with a sender id, address the answer back) before that limit can
 * be lifted.
 *
 * What the relay does NOT model, so what must not be tested on it:
 * - The residual SyncStep1 the room sends AFTER its SyncStep2, which is what
 *   makes the asker upload what it holds locally. Adding it keeps all specs
 *   green, so it masks nothing today, but "the room asks a client for what it
 *   has" has no coverage here.
 * - The join-time `QueryAwareness` nudge (`CollabRoom.cs:394`).
 * - The identities frame (type 107).
 *   Presence and participants therefore cannot be tested on this harness
 *   without extending it first.
 */

declare global {
  interface Window {
    /** Builds a socket factory bound to one relay room. */
    __blokRelaySocketFactory?: (options: { seedsEmptyRoom: boolean }) => unknown;
    /** Editors this harness mounted, by name. */
    __collabEditors?: Record<string, Blok>;
    /** While true, this page's relay sockets drop everything the room sends them. */
    __blokRelayPauseInbound?: boolean;
    /** While true, document frames are held back while awareness keeps flowing. */
    __blokRelayHoldDoc?: boolean;
    /** The held document frames, in arrival order. */
    __blokRelayHeldDoc?: Array<() => void>;
  }
}

/**
 * Installs the relay into every document the page loads, before any page
 * script runs — an init script, not an evaluate, so a reload keeps it.
 * @param page - the page to install into
 */
export const installCollabRelay = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    /** `[sync][SyncStep2][len 2][0,0]` — a valid, empty Yjs update. */
    const EMPTY_SYNC_STEP2 = new Uint8Array([0, 1, 2, 0, 0]);

    /**
     * One working-set tag per room. Deriving it from the doc id (rather than
     * one constant for every room) keeps two documents separable, and keeps it
     * stable across a reconnect to the SAME doc — the provider would tear the
     * session down if a room announced a different lineage on a reload.
     * Four FNV-1a passes, 8 hex each: the 32 lowercase hex the codec demands.
     * @param doc - the collaboration document id
     */
    const lineageFor = (doc: string): string => {
      let out = '';

      for (let seed = 0; seed < 4; seed += 1) {
        let hash = (0x811c9dc5 ^ seed) >>> 0;

        for (let index = 0; index < doc.length; index += 1) {
          hash ^= doc.charCodeAt(index);
          hash = Math.imul(hash, 0x01000193) >>> 0;
        }
        out += hash.toString(16).padStart(8, '0');
      }

      return out;
    };

    const isSyncStep1 = (bytes: Uint8Array): boolean =>
      bytes.length >= 2 && bytes[0] === 0 && bytes[1] === 0;

    class RelaySocket {
      public binaryType = 'blob';

      public readyState = 0;

      public readonly protocol = '';

      public onopen: ((event: unknown) => void) | null = null;

      public onmessage: ((event: { data: unknown }) => void) | null = null;

      public onclose: ((event: { code: number; reason: string }) => void) | null = null;

      public onerror: ((event: unknown) => void) | null = null;

      private readonly channel: BroadcastChannel;

      public constructor(url: string, private readonly seedsEmptyRoom: boolean) {
        const doc = decodeURIComponent(url.split('/sync/')[1] ?? 'default');
        const controlPayload = new TextEncoder()
          .encode(JSON.stringify({ epoch: 0,
            format: 1,
            lineage: lineageFor(doc) }));
        /** `[100][varuint len][json]`. The payload is well under 128 bytes, so the length is one byte. */
        const controlFrame = new Uint8Array([100, controlPayload.length, ...controlPayload]);

        // A BroadcastChannel never echoes to the object that posted, and it
        // does reach every other channel of the same name in the same origin —
        // including another editor on this very page.
        this.channel = new BroadcastChannel(`blok-collab:${doc}`);
        this.channel.onmessage = (event: MessageEvent) => {
          this.deliver(new Uint8Array(event.data as ArrayBufferLike));
        };

        setTimeout(() => {
          if (this.readyState !== 0) {
            return;
          }
          this.readyState = 1;
          // Control BEFORE onopen: the real room sends it at join, before the
          // client can say anything (`CollabRoom.cs:376-383`). `deliver` queues
          // a task, and the provider's SyncStep1 (sent synchronously from
          // onopen) queues its self-answer after that one — so frame 100 still
          // lands first, and the specs stop leaning on the provider's
          // before-control inbound buffer for a case production never has.
          this.deliver(controlFrame);
          this.onopen?.({});
        }, 0);
      }

      public send(data: ArrayBufferLike | ArrayBufferView): void {
        const bytes = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
          : new Uint8Array(data as ArrayBuffer);

        this.channel.postMessage(bytes);

        // Nobody else is in the room, so nothing would ever answer this and the
        // editor would sit read-only for good.
        if (this.seedsEmptyRoom && isSyncStep1(bytes)) {
          this.deliver(EMPTY_SYNC_STEP2);
        }
      }

      public close(code = 1000, reason = ''): void {
        if (this.readyState === 3) {
          return;
        }
        this.readyState = 3;
        this.channel.close();
        this.onclose?.({ code,
          reason });
      }

      /** Always a task later: a real socket never calls back inside `send`. */
      private deliver(bytes: Uint8Array): void {
        setTimeout(() => {
          if (window.__blokRelayPauseInbound === true) {
            return;
          }

          // Byte 0 is the y-protocols message type: 0 is sync, 1 is awareness.
          // Holding only sync reproduces the skew production has by design —
          // carets publish on a 100ms throttle, block data is coalesced on the
          // 400ms mutation window — with none of its timing.
          if (window.__blokRelayHoldDoc === true && bytes[0] === 0) {
            const held = window.__blokRelayHeldDoc ?? [];

            held.push(() => this.onmessage?.({ data: bytes }));
            window.__blokRelayHeldDoc = held;

            return;
          }

          if (this.readyState === 1) {
            this.onmessage?.({ data: bytes });
          }
        }, 0);
      }
    }

    window.__blokRelaySocketFactory = ({ seedsEmptyRoom }) =>
      (url: string) => new RelaySocket(url, seedsEmptyRoom);
  });
};

/**
 * Cuts this page off from the room, inbound only: its editors keep publishing,
 * and nothing the peers say reaches them again.
 *
 * Dropped, not queued — a test that pauses a page is testing what the OTHER
 * page draws while this one is out of date, and a queue would deliver the
 * backlog the moment anything else in the realm ran.
 * @param page - the page to cut off
 */
export const pauseCollabInbound = (page: Page): Promise<void> =>
  page.evaluate(() => {
    window.__blokRelayPauseInbound = true;
  });

/**
 * Holds back the document frames this page is sent, while awareness keeps
 * arriving. A peer's caret then reaches this editor while the text it counts
 * into does not — which is what the two publish cadences do in production.
 * @param page - the page to hold frames for
 */
export const holdCollabDocFrames = (page: Page): Promise<void> =>
  page.evaluate(() => {
    window.__blokRelayHoldDoc = true;
  });

/**
 * Delivers everything `holdCollabDocFrames` held, in arrival order. Yjs
 * updates are incremental, so they are queued rather than dropped: a lost one
 * never comes back without a full resync.
 * @param page - the page to release frames to
 */
export const releaseCollabDocFrames = (page: Page): Promise<void> =>
  page.evaluate(() => {
    window.__blokRelayHoldDoc = false;

    const held = window.__blokRelayHeldDoc ?? [];

    window.__blokRelayHeldDoc = [];
    held.forEach((deliver) => deliver());
  });

export interface MountOptions {
  /** Collaboration document id — one path segment, shared by every peer. */
  doc: string;
  /** Name this editor is looked up by, and the id of the holder created for it. */
  name: string;
  /** Whether this editor answers its own first SyncStep1. Exactly one opener per room. */
  seedsEmptyRoom: boolean;
  /** Display name shown to peers. */
  user?: string;
}

/** Pages whose init script is already registered — it survives reloads by itself. */
const relayed = new WeakSet<Page>();

/** Which editor names are currently in each room. At most two — see the file docstring. */
const roomMembers = new Map<string, Set<string>>();

/** Which room each mounted name belongs to, so an unmount can leave it. */
const roomOfName = new Map<string, string>();

/**
 * Opens the shared test page with the relay installed. Safe to call again on a
 * page that is being reloaded.
 * @param page - the page to navigate
 */
export const gotoCollabPage = async (page: Page): Promise<void> => {
  if (!relayed.has(page)) {
    relayed.add(page);
    await installCollabRelay(page);
  }
  await page.goto(TEST_PAGE_URL);
  await page.waitForFunction(() => typeof window.Blok === 'function');
};

/**
 * Mounts one collaboration editor and waits until its session reports
 * `connected` — the state attribute the module writes on the wrapper, which is
 * also the moment the first sync has landed and the editor is writable.
 *
 * Throws on a THIRD name in one room: the relay's fan-out is only faithful for
 * two clients (see the file docstring).
 * @param page - the page to mount into
 * @param options - which room this editor joins and under what name
 */
export const mountCollabEditor = async (page: Page, options: MountOptions): Promise<void> => {
  const members = roomMembers.get(options.doc) ?? new Set<string>();

  // Re-mounting a name that is already in the room is a reload, not a third
  // member: the previous page's socket died with its realm.
  if (!members.has(options.name) && members.size >= 2) {
    throw new Error(
      `room ${options.doc} already holds ${[...members].join(', ')}: this relay is faithful for two clients only`
    );
  }
  members.add(options.name);
  roomMembers.set(options.doc, members);
  roomOfName.set(options.name, options.doc);

  await page.evaluate(async ({ doc, name, seedsEmptyRoom, user }: MountOptions) => {
    const holder = document.createElement('div');

    holder.id = name;
    // The Playwright testIdAttribute, so every locator below can be scoped to
    // one editor without an id selector.
    holder.setAttribute('data-blok-testid', name);
    document.body.appendChild(holder);

    const factory = window.__blokRelaySocketFactory;

    if (factory === undefined) {
      throw new Error('the collaboration relay was not installed');
    }

    const editor = new window.Blok({
      holder: name,
      server: '/collab',
      collaboration: {
        doc,
        user: { name: user ?? name },
        // `socketFactory` is accepted at runtime but deliberately absent from
        // the published config type — see the module's CollaborationConfig.
        socketFactory: factory({ seedsEmptyRoom }),
      },
    });

    window.__collabEditors = { ...window.__collabEditors,
      [name]: editor };
    await editor.isReady;
  }, options);

  await page.waitForFunction(
    (name: string) =>
      document.getElementById(name)?.querySelector('[data-blok-collab="connected"]') !== null,
    options.name
  );
};

/**
 * Tears one mounted editor down: destroys it (which closes its relay socket —
 * a live one would keep answering SyncStep1 for a room it has left), drops its
 * holder, forgets it here and in the fixture's `__blokInstances` list, and
 * frees its seat in the room. Without this the spec can never move to the
 * shared-page fixture, which drains `__blokInstances` and nothing else.
 * @param page - the page the editor is on
 * @param name - the editor's harness name
 */
export const unmountCollabEditor = async (page: Page, name: string): Promise<void> => {
  const doc = roomOfName.get(name);

  if (doc !== undefined) {
    roomMembers.get(doc)?.delete(name);
    roomOfName.delete(name);
  }

  await page.evaluate(async (editorName: string) => {
    const editor = window.__collabEditors?.[editorName];

    if (editor === undefined) {
      return;
    }

    await editor.destroy();

    const { [editorName]: removed, ...rest } = window.__collabEditors ?? {};

    void removed;
    window.__collabEditors = rest;
    window.__blokInstances = window.__blokInstances?.filter((instance) => instance !== editor);
    document.getElementById(editorName)?.remove();
  }, name);
};

/** One editor's saved blocks — the WHOLE saved block, plus a readable `text`. */
export interface SavedBlock extends OutputBlockData {
  /** Always present: `savedBlocks` throws on a block the tool saved without one. */
  id: string;
  /**
   * `data.text` when the tool has one, `''` otherwise. Convenience only: it is
   * IN ADDITION to `data`, so a spec can diff readable text without any field
   * of the real saved block going unwatched.
   */
  text: string;
  /** The container this block sits in, or `''` at root level. */
  parent: string;
  /** Ids of this block's children, in order. */
  content: string[];
}

/**
 * Saves one editor and normalises the result for comparison. Everything the
 * tool saved is kept — `data` and `tunes` included — because data divergence
 * (a heading at the wrong level, a toggle collapsed on one side, a table with
 * different cells) is exactly what a bad merge produces, and a projection down
 * to id/type/text cannot see any of it. Specs project further when they want a
 * readable diff.
 * @param page - the page the editor lives on
 * @param name - the editor's harness name
 */
export const savedBlocks = (page: Page, name: string): Promise<SavedBlock[]> =>
  page.evaluate(async (editorName: string) => {
    const editor = window.__collabEditors?.[editorName];

    if (editor === undefined) {
      throw new Error(`no editor named ${editorName}`);
    }

    const output = await editor.save();

    return output.blocks.map((block) => {
      // Every assertion here is keyed by id; an id-less block would make two
      // unrelated blocks compare equal and quietly weaken the whole spec.
      if (block.id === undefined) {
        throw new Error(`editor ${editorName} saved a ${block.type} block with no id`);
      }

      return {
        ...block,
        id: block.id,
        text: typeof (block.data as { text?: unknown }).text === 'string'
          ? (block.data as { text: string }).text
          : '',
        parent: block.parent ?? '',
        content: block.content ?? [],
      };
    });
  }, name);

/** One block a test asks the harness to author. */
export interface SeedBlock {
  id: string;
  /** Tool name. Defaults to `paragraph`. */
  type?: string;
  /** Tool data. Defaults to `{ text: id }`. */
  data?: Record<string, unknown>;
  /** Id of the container this block goes into; omit for root level. */
  parent?: string;
}

/**
 * Authors a document one block at a time, through the same public API a host
 * uses: `blocks.insert` at root and `BlockAPI.insertChild` inside a container.
 * @param page - the page the editor is on
 * @param name - the editor's harness name
 * @param blocks - the blocks to author, parents before their children
 */
export const seedDocument = async (page: Page, name: string, blocks: SeedBlock[]): Promise<void> => {
  await page.evaluate(
    async ({ editorName, payload }: { editorName: string; payload: SeedBlock[] }) => {
      const editor = window.__collabEditors?.[editorName];

      if (editor === undefined) {
        throw new Error(`no editor named ${editorName}`);
      }

      for (const block of payload) {
        const data = block.data ?? { text: block.id };
        const tool = block.type ?? 'paragraph';

        if (block.parent === undefined) {
          editor.blocks.insert(tool, data, undefined, undefined, false, false, block.id);
          continue;
        }

        const container = editor.blocks.getById(block.parent);

        if (container === null) {
          throw new Error(`no container named ${block.parent}`);
        }

        container.insertChild(data, 'end', tool, { id: block.id });
      }

      await editor.save();
    },
    { editorName: name,
      payload: blocks }
  );
};
