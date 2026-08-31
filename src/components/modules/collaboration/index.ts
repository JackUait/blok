import type { OutputBlockData } from '../../../../types';
import type { CollaborationPeer } from '../../../../types/events/editor-events';
import type { ModuleConfig } from '../../../types-internal/module-config';
import { Module } from '../../__module';
import { CollaborationStatusChanged } from '../../events';
import { createTicketSource, type TicketRequest } from '../../utils/access-pass';

import { createPresence, type Presence } from './presence';
import { createPresenceRenderer } from './presence-renderer';
import { createCollabProvider } from './provider';
import type {
  CollabDocSeam,
  CollabProvider,
  CollabSocketFactory,
  CollabStatus,
  CollabTicketSource,
} from './types';

/**
 * The `collaboration` block as this module reads it: the published shape plus
 * injection points that are deliberately NOT in `types/`. A test (and the node
 * conformance tier) has to hand the provider a transport and a deterministic
 * clock; the published config surface must not grow a WebSocket-shaped key.
 */
export interface CollaborationConfig {
  /** The document id shared with the sync service. One path segment. */
  doc: string;
  /** Display identity shown to peers; the colour defaults from the client id. */
  user?: {
    name: string;
    color?: string;
  };
  /** @internal Opens the transport; defaults to the global `WebSocket`. */
  socketFactory?: CollabSocketFactory;
  /** @internal How long to wait for the server's control frame. */
  handshakeTimeoutMs?: number;
  /** @internal Backoff jitter source. */
  random?: () => number;
}

/** Wrapper attribute a host (or an e2e test) reads the session state off. */
const COLLAB_STATE_ATTR = 'data-blok-collab';

/** The nanoid alphabet block ids already use, so a derived id looks like one. */
const SEED_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const SEED_ID_LENGTH = 10;

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a over a string. Deterministic across peers and runtimes — which is the
 * only property that matters here.
 * @param input - the string to hash
 */
const fnv1a = (input: string): number =>
  Array.from(input).reduce(
    (hash, character) => Math.imul(hash ^ character.charCodeAt(0), FNV_PRIME) >>> 0,
    FNV_OFFSET_BASIS
  );

/**
 * The id of the one block a peer writes into a document that synced empty.
 *
 * Derived from the document id, so two peers that reach an empty document at
 * the same moment write the SAME id: the Y.Map set converges last-writer-wins
 * and the doubled order entry is dropped by the doc's first-occurrence-only
 * order derivation. The race lands one paragraph, not one per peer — the same
 * trick `restoreDefaultBlockIfDocEmptied` plays with the removed block's id.
 * @param doc - the collaboration document id
 */
const seedBlockId = (doc: string): string =>
  Array.from({ length: SEED_ID_LENGTH }, (_unused, slot) =>
    SEED_ID_ALPHABET[fnv1a(`${slot}:${doc}`) % SEED_ID_ALPHABET.length]).join('');

/**
 * Whether a connection ticket grants writes. Only an explicit `write: false`
 * denies: a ticket without the claim, or one we cannot read, leaves the editor
 * editable — the server enforces the grant regardless, and refusing to let
 * someone type because we could not parse their ticket is the worse failure.
 * @param token - the raw ticket the host's endpoint minted
 */
const grantsWrite = (token: string): boolean => {
  const payload = token.split('.')[1];

  if (payload === undefined) {
    return true;
  }

  try {
    const decoded: unknown = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));

    if (typeof decoded !== 'object' || decoded === null) {
      return true;
    }

    return (decoded as { write?: unknown }).write !== false;
  } catch {
    return true;
  }
};

/**
 * Turns the `server` option into the document's sync URL.
 *
 * A path-form value (`/api/blok`) resolves against the page origin, and the
 * scheme steps up to its WebSocket twin. Trailing slashes are counted rather
 * than matched with `/\/+$/`, which retries at every offset and goes quadratic
 * on a long run — the same reason `expandServerConfig` counts.
 * @param server - the `server` option as the host wrote it
 * @param doc - the collaboration document id
 */
const syncUrl = (server: string, doc: string): string => {
  const trailingSlashes = Array.from(server)
    .reduce((count, character) => (character === '/' ? count + 1 : 0), 0);
  const base = new URL(server.slice(0, server.length - trailingSlashes), window.location.origin);
  const scheme = base.protocol === 'https:' || base.protocol === 'wss:' ? 'wss:' : 'ws:';
  const path = base.pathname === '/' ? '' : base.pathname;

  return `${scheme}//${base.host}${path}/sync/${encodeURIComponent(doc)}`;
};

/**
 * Maps one awareness state to the peer shape the host renders.
 *
 * A state without a display identity is not a peer anybody can draw. The LOCAL
 * client is filtered out by client id BEFORE this runs — presence publishes an
 * identity for it too, so "no identity" stopped being an accidental exclusion
 * the moment C3 landed.
 * @param clientId - awareness client id
 * @param state - the raw, untrusted state that client broadcast
 */
const toPeer = (clientId: number, state: Record<string, unknown>): CollaborationPeer | null => {
  const user = state.user;

  if (typeof user !== 'object' || user === null) {
    return null;
  }

  const { name, color } = user as { name?: unknown; color?: unknown };

  if (typeof name !== 'string') {
    return null;
  }

  const blockId = state.blockId;

  return {
    clientId,
    user: { name, color: typeof color === 'string' ? color : '' },
    blockId: typeof blockId === 'string' ? blockId : null,
  };
};

interface CollabSettings {
  doc: string;
  url: string;
  user: { name?: string; color?: string } | undefined;
  ticketEndpoint: string | undefined;
  socketFactory: CollabSocketFactory | undefined;
  handshakeTimeoutMs: number | undefined;
  random: (() => number) | undefined;
}

/**
 * @module Collaboration
 *
 * Owns the sync-first load: with `collaboration` configured, core seeds
 * nothing — not the Yjs document, not the default empty block — and this module
 * drives the editor through connecting → connected off the provider's status.
 *
 * Three rules carry it:
 *
 * 1. ABSENT IS FREE. No `collaboration` key and the constructor returns before
 *    allocating anything: no provider, no awareness, no socket.
 * 2. NEVER EDITABLE UNSYNCED. Until the first SyncStep2 lands, the editor is
 *    read-only, because an edit made against a document that never carried
 *    server lineage has nowhere to go.
 * 3. AFTER THE FIRST SYNC, OFFLINE IS STILL EDITABLE. The document now carries
 *    server lineage, so a reconnect ships the diff. Only a TERMINAL provider —
 *    one that will not reconnect — drops the editor back to read-only.
 */
export class Collaboration extends Module {
  /** Non-null exactly when collaboration is configured. The whole gate. */
  private settings: CollabSettings | null = null;

  private provider: CollabProvider | null = null;

  private status: CollabStatus = 'connecting';

  /** Latched: the document has carried server lineage since the first sync. */
  private firstSynced = false;

  /** The provider gave up; no reconnect will ever ship pending edits. */
  private terminal = false;

  /**
   * Bumped by every lineage reset. An in-flight `handleStatus` captures it
   * before it awaits and abandons its tail if the document was swapped
   * underneath — see the guard there.
   */
  private resetGeneration = 0;

  /** An explicit `write: false` claim on the connection ticket. */
  private writeDenied = false;

  /** What the host passed as `config.data`, shown read-only while offline. */
  private lastKnown: OutputBlockData[] = [];

  /** The last-known DOM is on screen and has to go before remote blocks land. */
  private degraded = false;

  /** Last-known is rendered at most once per unsynced lifetime. */
  private degradeRendered = false;

  private awarenessUnhook: (() => void) | null = null;

  /** Publishes this editor's presence and draws everybody else's. */
  private presence: Presence | null = null;

  /**
   * @param moduleConfig - the editor config and the shared event bus
   */
  constructor(moduleConfig: ModuleConfig) {
    super(moduleConfig);

    // Typed as the widened shape, not asserted into it: the published
    // `collaboration` type carries none of the injection points, and the
    // structural assignment is what makes them readable here.
    const collaboration: CollaborationConfig | undefined = this.config.collaboration;
    const server = this.config.server;

    // Zero cost when absent. `server` is guaranteed by the config setter's
    // refusal matrix; the check is what makes that guarantee visible here.
    if (collaboration === undefined || server === undefined) {
      return;
    }

    this.settings = {
      doc: collaboration.doc,
      url: syncUrl(server, collaboration.doc),
      user: collaboration.user,
      ticketEndpoint: this.config.ticket,
      socketFactory: collaboration.socketFactory,
      handshakeTimeoutMs: collaboration.handshakeTimeoutMs,
      random: collaboration.random,
    };
  }

  /** True when this editor is a collaboration session. */
  public get isEnabled(): boolean {
    return this.settings !== null;
  }

  /**
   * The collaboration half of read-only arbitration (`ReadOnly` reads it):
   * unsynced, write-denied, or terminally disconnected means "not editable",
   * whatever the host asked for.
   */
  public get isEditingBlocked(): boolean {
    return this.settings !== null && (!this.firstSynced || this.writeDenied || this.terminal);
  }

  /**
   * Starts the session in place of core's ordinary render.
   *
   * Resolves immediately: readiness must NOT wait on the network, or an editor
   * that cannot reach the service would never finish booting. It comes up
   * empty and read-only, and the blocks arrive when the document does.
   * @param lastKnown - `config.data`, kept for the offline degrade path
   */
  public load(lastKnown: OutputBlockData[]): Promise<void> {
    const settings = this.settings;

    if (settings === null) {
      return Promise.resolve();
    }

    this.lastKnown = lastKnown;
    this.setStateAttribute('connecting');

    // Before subscribing: `onAwarenessChange` throws until awareness exists.
    // Collab-gated, so "absent = zero cost" still holds.
    this.Blok.YjsManager.enableAwareness();
    this.awarenessUnhook = this.Blok.YjsManager.onAwarenessChange(() => this.emitStatus());

    this.presence = createPresence({
      yjs: this.Blok.YjsManager,
      user: settings.user,
      currentBlockId: () => this.Blok.BlockManager.currentBlock?.id ?? null,
      renderer: createPresenceRenderer({
        // The WRAPPER, not the redactor: the stack must not sit inside the
        // subtree the modifications observer watches.
        host: this.Blok.UI.nodes.wrapper,
        resolveHolder: (blockId) => this.Blok.BlockManager.getBlockById(blockId)?.holder ?? null,
        isHidden: () => this.Blok.ReadOnly.isControlsHidden,
      }),
    });
    this.presence.start();

    this.provider = createCollabProvider({
      url: settings.url,
      docId: settings.doc,
      yjs: this.seam(),
      ticketSource: this.ticketSource(),
      socketFactory: settings.socketFactory,
      handshakeTimeoutMs: settings.handshakeTimeoutMs,
      random: settings.random,
      onStatus: (status) => {
        void this.handleStatus(status);
      },
    });

    this.provider.connect();

    return Promise.resolve();
  }

  /**
   * Stops the session. Runs BEFORE `YjsManager.destroy` (module order in
   * `modules/index.ts`), so the provider's teardown still has a live document
   * and a live awareness to clear.
   */
  public destroy(): void {
    // Presence first: awareness prunes a vanished peer only after 30 seconds,
    // so the outlines and the stack have to come down now, not then.
    this.presence?.stop();
    this.presence = null;
    this.awarenessUnhook?.();
    this.awarenessUnhook = null;
    this.provider?.destroy();
    this.provider = null;
  }

  /**
   * The real YjsManager for every method, with ONE interception.
   *
   * `applyRemoteUpdate` is the only moment between "the first sync's bytes
   * arrived" and "the blocks exist": BlockYjsSync materialises them
   * synchronously from the document observer inside that call. So the degraded
   * last-known DOM is dropped here, not on the `connected` status that follows
   * it — by then the remote blocks would already be sitting next to it.
   */
  private seam(): CollabDocSeam {
    const yjs = this.Blok.YjsManager;

    return {
      applyRemoteUpdate: (update, origin) => {
        this.dropDegradedView();
        yjs.applyRemoteUpdate(update, origin);
      },
      onDocUpdate: (callback) => yjs.onDocUpdate(callback),
      getStateVector: () => yjs.getStateVector(),
      encodeStateAsUpdate: (stateVector) => yjs.encodeStateAsUpdate(stateVector),
      enableAwareness: () => yjs.enableAwareness(),
      setAwarenessField: (field, value) => yjs.setAwarenessField(field, value),
      getAwarenessStates: () => yjs.getAwarenessStates(),
      onAwarenessChange: (callback) => yjs.onAwarenessChange(callback),
      onAwarenessUpdate: (callback) => yjs.onAwarenessUpdate(callback),
      encodeAwarenessUpdate: (clients) => yjs.encodeAwarenessUpdate(clients),
      applyAwarenessUpdate: (update, origin) => yjs.applyAwarenessUpdate(update, origin),
      clearRemoteAwarenessStates: () => yjs.clearRemoteAwarenessStates(),
      resetForRelineage: () => this.resetForRelineage(),
    };
  }

  /**
   * The room was reset: throw this session's document away and start over.
   *
   * The DOM goes FIRST and the document second. `BlockManager.clear` runs block
   * teardown, and any stray write it provokes must land in the document we are
   * discarding — landing it in the FRESH one would put pre-reset content back on
   * the wire on the very next connection, which is the leak this whole reset
   * exists to prevent. `skipYjsSync` keeps the clear itself out of the document
   * either way; the ordering is the belt to that brace.
   *
   * `clear` is declared async but its body never awaits, so the holders are gone
   * before this returns — the same contract `dropDegradedView` relies on. The
   * provider reconnects immediately after, and the room's blocks materialise
   * through the ordinary remote path.
   */
  private resetForRelineage(): void {
    const { BlockManager, ModificationsObserver, YjsManager } = this.Blok;

    ModificationsObserver.disable();
    void BlockManager.clear(false, { skipYjsSync: true });
    ModificationsObserver.enable();

    this.degraded = false;

    // Awareness subscriptions bind to the Awareness INSTANCE, and the reset
    // builds a new one. Unhook before and re-subscribe after, or the published
    // peer list silently stops updating for the rest of the session. Presence
    // rides the same instance AND caches which client id is local — the new
    // Awareness binds a new one — so it is stopped and started, not kept.
    this.presence?.stop();
    this.awarenessUnhook?.();
    YjsManager.resetForRelineage();
    this.awarenessUnhook = YjsManager.onAwarenessChange(() => this.emitStatus());
    this.presence?.start();

    // The document no longer carries server lineage, so decision 7's
    // "offline is still editable" asymmetry no longer applies: this is an
    // unsynced document again, and unsynced is read-only.
    this.firstSynced = false;
    this.resetGeneration += 1;
    void this.applyArbitration();
  }

  /**
   * Wraps the shared ticket source so the `write` claim is read on every mint —
   * a refreshed ticket can downgrade a session that started with write access.
   */
  private ticketSource(): CollabTicketSource | undefined {
    const settings = this.settings;

    if (settings === null || settings.ticketEndpoint === undefined) {
      return undefined;
    }

    const mint = createTicketSource(settings.ticketEndpoint, { doc: settings.doc });

    // Load-bearing forward of `request`: the provider's one retry after a 4401
    // asks for a fresh mint, and a wrapper that swallowed the argument would
    // hand the rejected ticket straight back.
    return async (request?: TicketRequest): Promise<string> => {
      const token = await mint(request);
      const denied = !grantsWrite(token);

      if (denied !== this.writeDenied) {
        this.writeDenied = denied;
        await this.applyArbitration();
      }

      return token;
    };
  }

  /**
   * The state machine. Every transition is driven from the provider's status;
   * nothing here inspects the socket.
   * @param status - the provider's new connection state
   */
  private async handleStatus(status: CollabStatus): Promise<void> {
    if (this.isDestroyed) {
      return;
    }

    const isFirstSync = status === 'connected' && !this.firstSynced;
    const generation = this.resetGeneration;

    this.status = status;
    // 'error' is the provider's last word — it never reports again — so this
    // only ever latches on.
    this.terminal = status === 'error';
    this.firstSynced = this.firstSynced || status === 'connected';

    this.setStateAttribute(status);
    this.emitStatus();

    await this.applyArbitration();

    // Arbitration re-renders, so a lineage reset can land while it is in
    // flight. Everything below writes to the document or the DOM, and doing so
    // for a transition that belongs to a document we have since thrown away
    // seeds a stale block into the FRESH one — which the next connection then
    // broadcasts into the reset room.
    if (this.resetGeneration !== generation || this.isDestroyed) {
      return;
    }

    if (isFirstSync) {
      this.seedEmptyDocument();

      return;
    }

    if (status === 'offline' || status === 'error') {
      await this.renderLastKnown();
    }
  }

  /**
   * Shows `config.data` read-only while the first sync has never happened —
   * "here is what we last saw", not an editable document. The Yjs document is
   * left untouched (`skipYjsSync`), so nothing rendered here can ever be
   * mistaken for content the server sent.
   */
  private async renderLastKnown(): Promise<void> {
    if (this.firstSynced || this.degradeRendered || this.lastKnown.length === 0) {
      return;
    }

    this.degradeRendered = true;
    this.degraded = true;

    const { BlockManager, ModificationsObserver, Renderer } = this.Blok;

    ModificationsObserver.disable();

    try {
      await BlockManager.withViewRebuild(async () => {
        await BlockManager.clear(false, { skipYjsSync: true });
        await Renderer.render(this.lastKnown, { skipYjsSync: true });
      });
    } finally {
      ModificationsObserver.enable();
    }
  }

  /**
   * Drops the degraded DOM. `BlockManager.clear` is declared async but its body
   * never awaits, so the holders are gone before this returns — which is the
   * whole contract: the caller is `applyRemoteUpdate`, and the remote blocks
   * materialise synchronously in the very next statement. Adding an `await`
   * inside `clear` would leave the last-known blocks stacked on top of the
   * server's; the degrade-swap test is the tripwire for that.
   */
  private dropDegradedView(): void {
    if (!this.degraded) {
      return;
    }

    this.degraded = false;

    const { BlockManager, ModificationsObserver } = this.Blok;

    ModificationsObserver.disable();
    void BlockManager.clear(false, { skipYjsSync: true });
    ModificationsObserver.enable();
  }

  /**
   * A document that synced empty gets exactly one block, so the user has
   * something to type in. Write-gated: a read-only member must not author the
   * first block of somebody else's document.
   */
  private seedEmptyDocument(): void {
    const settings = this.settings;

    if (settings === null || this.writeDenied || this.terminal) {
      return;
    }

    const yjs = this.Blok.YjsManager;

    if (yjs.toJSON().length > 0) {
      return;
    }

    const block = this.Blok.BlockManager.insert({ id: seedBlockId(settings.doc), skipYjsSync: true });

    // 'no-capture': this is reactive infrastructure, not a user edit, so it
    // must not become an undo step. It still broadcasts — peers materialise it
    // through their ordinary remote-add path.
    yjs.transactWithoutCapture(() => {
      yjs.addBlock({
        id: block.id,
        type: block.name,
        data: block.preservedData,
      });
    });
  }

  private async applyArbitration(): Promise<void> {
    await this.Blok.ReadOnly.reapplyCollaborationArbitration();
  }

  /**
   * @param status - the state to publish on the wrapper
   */
  private setStateAttribute(status: CollabStatus): void {
    this.Blok.UI.nodes.wrapper?.setAttribute(COLLAB_STATE_ATTR, status);
  }

  /**
   * Publishes the session state. `error` is folded into `offline` because the
   * published payload has no term for a terminal stop — the wrapper attribute
   * is where that distinction lives.
   */
  private emitStatus(): void {
    if (this.settings === null || this.isDestroyed) {
      return;
    }

    // Presence publishes a display identity for THIS client too, so the local
    // state now satisfies `toPeer` and would otherwise show up in the host's own
    // peer list. This is the explicit exclusion `toPeer` was waiting for.
    const localClientId = this.presence?.localClientId ?? null;

    this.eventsDispatcher.emit(CollaborationStatusChanged, {
      status: this.status === 'error' ? 'offline' : this.status,
      peers: Array.from(this.Blok.YjsManager.getAwarenessStates().entries())
        .filter(([clientId]) => clientId !== localClientId)
        .map(([clientId, state]) => toPeer(clientId, state))
        .filter((peer): peer is CollaborationPeer => peer !== null),
    });
  }
}
