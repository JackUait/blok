import { throttle } from '../../utils/functional';
import type { AwarenessChange } from '../yjs/types';

import type { CaretPosition } from './caret-position';
import type { PresenceRenderer } from './presence-renderer';

/**
 * The awareness slice presence needs — the same method names YjsManager
 * exposes, so binding it is a pass-through with no adapter.
 *
 * Both events, for two different jobs. RENDERING rides `change` only:
 * y-protocols renews the local state with equal content every 3s to keep peers
 * from pruning it, and that renewal rides `update`, so drawing from `update`
 * would repaint the whole stack on every keepalive of every peer. LATCHING the
 * local client id rides `update`, because `change` is emitted only when the new
 * local state differs from the old one — and after a lineage reset the restored
 * state is identical, so `change` never comes.
 */
export interface PresenceSeam {
  setAwarenessField(field: string, value: unknown): void;
  getAwarenessStates(): Map<number, Record<string, unknown>>;
  onAwarenessChange(callback: (changes: AwarenessChange, origin: unknown) => void): () => void;
  onAwarenessUpdate(callback: (changes: AwarenessChange, origin: unknown) => void): () => void;
}

/** One client's raw, untrusted awareness state, as it came off the wire. */
export interface PresenceState {
  clientId: number;
  state: Record<string, unknown>;
}

/**
 * A state that carries an identity, so a pass can decide to draw it. The NAME
 * is optional — `collaboration.user` is optional too, and a peer who set none
 * is still somebody in the room.
 */
export interface DrawableState extends PresenceState {
  state: Record<string, unknown> & { user: { name?: unknown; color?: unknown } };
}

export interface PresenceOptions {
  yjs: PresenceSeam;
  /** Display identity from `config.collaboration.user`, if the host set one. */
  user?: { name?: string; color?: string };
  /** The block the caret sits in right now. */
  currentBlockId: () => string | null;
  /**
   * Where the caret sits inside that block, or null when it is somewhere no
   * peer could draw. Omit to publish block-level presence only.
   */
  currentCaret?: () => CaretPosition | null;
  /** Draws what the peers publish; omit to publish without rendering. */
  renderer?: PresenceRenderer;
  /** Where the caret listeners bind. Defaults to the ambient `document`. */
  eventTarget?: EventTarget;
  /** Publish window in ms (default 100). */
  throttleMs?: number;
}

export interface Presence {
  /** Publish the local state and start following the caret. Idempotent. */
  start(): void;
  /** Stop publishing and clear everything the renderer drew. Idempotent. */
  stop(): void;
  /** This editor's awareness client id, or null before the first publish. */
  readonly localClientId: number | null;
}

/** Presence outbound window — decision 9's ~100ms. */
const DEFAULT_THROTTLE_MS = 100;

/**
 * Default cursor colours. Each is at least 4.5:1 against white, so a name
 * label printed in white on top of one is readable, and they stay
 * distinguishable under the common forms of colour blindness.
 */
export const PRESENCE_PALETTE = [
  '#0b6e99',
  '#c1461f',
  '#0f7b6c',
  '#6940a5',
  '#ad1a72',
  '#886c1a',
  '#1f5aa8',
  '#8f3a1c',
] as const;

/**
 * The only colour syntax presence will ever hand to CSS.
 *
 * Colours arrive from other browsers, so the value that reaches a custom
 * property must not be able to close the declaration and open another one.
 * Hex-only, with the four lengths CSS actually defines — `#12345` is not a
 * colour, and letting it through would paint unpredictably inside `var()`.
 * @param value - the candidate, from a peer's state or the host's config
 */
export const isPresenceColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value);

/**
 * A stable default colour for a client that published none.
 *
 * Awareness client ids are random 32-bit numbers, so the modulo is already
 * uniform across the palette; hashing first would buy nothing.
 * @param clientId - awareness client id
 */
export const presenceColorFor = (clientId: number): string =>
  PRESENCE_PALETTE[Math.abs(Math.trunc(clientId)) % PRESENCE_PALETTE.length];

/**
 * The most peers one pass will ever take. Counted in DRAWABLE peers, never in
 * raw states: awareness map order is insertion order, so a cap applied before
 * the identity filter would let one client plant enough junk ahead of everyone
 * to blank the presence UI for the whole room.
 */
export const MAX_PEERS = 50;

/**
 * The most awareness entries one pass will LOOK at.
 *
 * A hostile frame can carry tens of thousands of fabricated states, and every
 * awareness change re-walks the map, so the walk has to be bounded. Two orders
 * of magnitude above MAX_PEERS, so a real room never reaches it — junk fills
 * this budget long before it could fill the peer budget. Keeping the map small
 * enough that a genuine peer sits inside this window is the provider's job (its
 * inbound frame and rebroadcast caps), not this walk's.
 */
export const PRESENCE_SCAN_LIMIT = 1000;

/**
 * Does this state claim to be a person presence can draw?
 *
 * The test is the `user` OBJECT, not a name inside it: `collaboration.user` is
 * optional, so requiring a name made the DEFAULT configuration a room where
 * everybody is connected and nobody sees anyone. A nameless peer is drawn
 * anonymously, in the colour their client id assigns them.
 *
 * Every field arrived from another browser, so nothing here trusts its own type
 * — including the state itself, which a peer can publish as a number, an array
 * or nothing at all.
 * @param entry - one client's raw state
 */
export const hasDrawableIdentity = (entry: PresenceState): entry is DrawableState => {
  const state: unknown = entry.state;

  if (typeof state !== 'object' || state === null) {
    return false;
  }

  const user: unknown = (state as Record<string, unknown>).user;

  return typeof user === 'object' && user !== null;
};

/**
 * Pick the states one pass will work on: not this client's own, carrying an
 * identity, at most MAX_PEERS of them, after looking at no more than
 * PRESENCE_SCAN_LIMIT entries.
 *
 * The selection happens INSIDE the walk, and that is the whole point. Capping
 * first and filtering after lets junk hide real collaborators; walking without
 * a cap lets one hostile frame make every later awareness change expensive.
 * Only the two together are safe.
 * @param entries - awareness states in map order, pulled lazily
 * @param localClientId - this editor's own client id, or null before it is known
 */
export const selectDrawableStates = (
  entries: Iterable<PresenceState>,
  localClientId: number | null
): DrawableState[] => {
  const selected: DrawableState[] = [];
  const walk = { scanned: 0 };

  for (const entry of entries) {
    walk.scanned += 1;

    if (entry.clientId !== localClientId && hasDrawableIdentity(entry)) {
      selected.push(entry);
    }

    // Tested AFTER the entry, not before it: breaking on the way in would have
    // already pulled one more state out of the source than the budget allows.
    if (walk.scanned >= PRESENCE_SCAN_LIMIT || selected.length >= MAX_PEERS) {
      break;
    }
  }

  return selected;
};

/**
 * The awareness map as presence states, one at a time. A generator, not a
 * mapped array: the consumer stops at the first cap it hits, and a fabricated
 * map of 100k entries must not be materialised before that happens.
 * @param states - the awareness map, keyed by client id
 */
function* asPresenceStates(states: Map<number, Record<string, unknown>>): Generator<PresenceState> {
  for (const [clientId, state] of states) {
    yield { clientId, state };
  }
}

/**
 * Local awareness upkeep: publishes who this editor is and which block its
 * caret is in, and feeds the peers worth drawing to the renderer.
 *
 * Publishing is unconditional — a read-only viewer broadcasts exactly what an
 * editor does, which is what puts them in everyone else's avatar stack. Only
 * the DRAWING is suppressed for a chromeless editor, and that decision lives in
 * the renderer.
 * @param options - the seam, the identity, the caret, and where to draw
 */
export const createPresence = (options: PresenceOptions): Presence => {
  const { yjs, currentBlockId, renderer } = options;
  const target = options.eventTarget ?? document;
  const waitMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;

  const state = {
    running: false,
    localClientId: null as number | null,
    /** `undefined` means "never published", which is distinct from a null block. */
    publishedBlockId: undefined as string | null | undefined,
    /** The last caret tuple put on the wire, as its comparison key. */
    publishedCaret: undefined as string | undefined,
    unhookAwareness: null as (() => void) | null,
    unhookAwarenessUpdate: null as (() => void) | null,
    onCaretMove: null as (() => void) | null,
  };

  const publishBlockId = (): void => {
    if (!state.running) {
      return;
    }

    const blockId = currentBlockId();

    // Load-bearing, not an optimisation: every field write bumps the awareness
    // clock and puts a frame on the wire, and `selectionchange` fires on every
    // keystroke.
    if (blockId === state.publishedBlockId) {
      return;
    }

    state.publishedBlockId = blockId;
    yjs.setAwarenessField('blockId', blockId);
  };

  /**
   * Publish where the caret sits inside the block.
   *
   * A SEPARATE field from `blockId`, never folded into it: awareness state is
   * read by clients that shipped before carets existed, and they read `blockId`
   * by that exact name. New information goes in a new field, the same way it
   * goes in a new message type on the sync wire.
   *
   * Deduped on the whole tuple — `selectionchange` fires on every keystroke,
   * and an unchanged position reaching the wire would be a frame per keypress.
   */
  const publishCaret = (): void => {
    if (!state.running) {
      return;
    }

    const position = options.currentCaret?.() ?? null;
    const key = position === null
      ? 'none'
      : `${position.blockId}|${position.inputIndex}|${position.anchor}|${position.head}`;

    if (key === state.publishedCaret) {
      return;
    }

    state.publishedCaret = key;
    yjs.setAwarenessField('caret', position);
  };

  /**
   * Publishes who this editor is. UNCONDITIONAL: `collaboration.user` is
   * optional, and a client that published nothing about itself is invisible to
   * every peer — which made the default configuration a room where everybody is
   * present and nobody sees anyone. With no name configured the identity is the
   * colour alone, and peers draw an anonymous avatar.
   */
  const publishUser = (): void => {
    const name = options.user?.name;
    const configured = options.user?.color;
    const color = isPresenceColor(configured) ? configured : presenceColorFor(state.localClientId ?? 0);

    yjs.setAwarenessField(
      'user',
      typeof name === 'string' && name.trim() !== '' ? { name, color } : { color }
    );
  };

  const notify = (): void => {
    if (renderer === undefined) {
      return;
    }

    // Lazily, through the generator: `selectDrawableStates` stops at the first
    // cap it hits, and a fabricated map must not be materialised before it does.
    const peers = selectDrawableStates(asPresenceStates(yjs.getAwarenessStates()), state.localClientId);

    renderer.render(peers, state.localClientId);
  };

  /**
   * Remember which awareness client id is this editor's own.
   *
   * A local-origin removal (`clearRemoteAwarenessStates`) names only remote
   * clients, so an empty delta must leave the latch alone rather than write
   * null over it.
   * @param changes - which clients were added, updated or removed
   */
  const latchLocalClientId = (changes: AwarenessChange): void => {
    if (state.localClientId !== null) {
      return;
    }

    const local = changes.updated[0] ?? changes.added[0];

    if (local !== undefined) {
      state.localClientId = local;
    }
  };

  /**
   * Repaint whenever a change touched anyone else.
   *
   * The remote test cannot be "origin !== 'local'": a disconnect clears every
   * peer through `clearRemoteAwarenessStates`, and y-protocols tags THAT
   * removal `'local'` too. Skipping it would leave ghost peers on screen until
   * the 30s prune.
   * @param changes - which clients were added, updated or removed
   * @param origin - `'local'` for anything this client caused
   */
  const onAwarenessChange = (changes: AwarenessChange, origin: unknown): void => {
    if (origin === 'local') {
      latchLocalClientId(changes);
    }

    const touchedSomeoneElse = [...changes.added, ...changes.updated, ...changes.removed]
      .some((clientId) => clientId !== state.localClientId);

    if (touchedSomeoneElse) {
      notify();
    }
  };

  /**
   * The latch's only reliable arm, and it does nothing else.
   *
   * y-protocols emits `change` only when the new local state DIFFERS from the
   * old one. A lineage reset restores this peer's state onto the fresh
   * Awareness, so `start()` republishes something deep-equal and `update` is
   * the only event that comes — without this, the latch would stay null and the
   * user would be drawn as a peer to themselves. Nothing may ever RENDER from
   * here: the 3s keepalive rides this event too.
   * @param changes - which clients were added, updated or removed
   * @param origin - `'local'` for anything this client caused
   */
  const onAwarenessUpdate = (changes: AwarenessChange, origin: unknown): void => {
    if (origin === 'local') {
      latchLocalClientId(changes);
    }
  };

  return {
    get localClientId(): number | null {
      return state.localClientId;
    },

    start(): void {
      if (state.running) {
        return;
      }

      state.running = true;
      state.publishedBlockId = undefined;
      state.publishedCaret = undefined;
      state.unhookAwareness = yjs.onAwarenessChange(onAwarenessChange);
      state.unhookAwarenessUpdate = yjs.onAwarenessUpdate(onAwarenessUpdate);

      // Order matters. The block write fires a local-origin update
      // SYNCHRONOUSLY, which is how the client id gets latched — and the id is
      // what picks the default colour, so the identity has to go second or the
      // colour would change on the next publish.
      publishBlockId();
      publishCaret();
      publishUser();

      // A fresh throttle per start: the previous one's clock would suppress the
      // first caret move of a restarted session.
      const publish = throttle(() => {
        publishBlockId();
        publishCaret();

        // Local typing reflows the line every remote caret in this block points
        // into. Nothing on the wire announces that — the peers did not move,
        // the text under them did — so the re-measure has to ride the local
        // caret, not an awareness change.
        renderer?.reposition();
      }, waitMs);

      state.onCaretMove = () => {
        publish();
      };

      target.addEventListener('selectionchange', state.onCaretMove);
      target.addEventListener('focusin', state.onCaretMove);

      notify();
    },

    stop(): void {
      if (!state.running) {
        return;
      }

      // Before the listeners go: `throttle` has no `cancel`, so a trailing call
      // can still land after teardown. `running` is what makes it a no-op.
      state.running = false;

      if (state.onCaretMove !== null) {
        target.removeEventListener('selectionchange', state.onCaretMove);
        target.removeEventListener('focusin', state.onCaretMove);
        state.onCaretMove = null;
      }

      state.unhookAwareness?.();
      state.unhookAwareness = null;
      state.unhookAwarenessUpdate?.();
      state.unhookAwarenessUpdate = null;

      // A lineage reset replaces the Awareness, and the new one binds a new
      // client id. Forgetting it here is what lets the next `start()` latch the
      // new one instead of filtering peers against a dead number.
      state.localClientId = null;

      // Not "let the states expire": awareness prunes an absent peer after 30
      // seconds, and a closed session must not leave a ghost outline for half a
      // minute.
      renderer?.clear();
    },
  };
};
