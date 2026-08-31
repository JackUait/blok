import { throttle } from '../../utils/functional';
import type { AwarenessChange } from '../yjs/types';

import type { PresenceRenderer } from './presence-renderer';

/**
 * The awareness slice presence needs — the same method names YjsManager
 * exposes, so binding it is a pass-through with no adapter.
 *
 * `onAwarenessChange`, NOT `onAwarenessUpdate`: y-protocols renews the local
 * state with equal content every 3s to keep peers from pruning it, and that
 * renewal rides `update` only. Rendering from `update` would repaint the whole
 * stack on every keepalive of every peer.
 */
export interface PresenceSeam {
  setAwarenessField(field: string, value: unknown): void;
  getAwarenessStates(): Map<number, Record<string, unknown>>;
  onAwarenessChange(callback: (changes: AwarenessChange, origin: unknown) => void): () => void;
}

/** One client's raw, untrusted awareness state, as it came off the wire. */
export interface PresenceState {
  clientId: number;
  state: Record<string, unknown>;
}

export interface PresenceOptions {
  yjs: PresenceSeam;
  /** Display identity from `config.collaboration.user`, if the host set one. */
  user?: { name?: string; color?: string };
  /** The block the caret sits in right now. */
  currentBlockId: () => string | null;
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
 * Local awareness upkeep: publishes who this editor is and which block its
 * caret is in, and feeds every peer's state to the renderer.
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
    unhookAwareness: null as (() => void) | null,
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

  const publishUser = (): void => {
    const name = options.user?.name;

    if (typeof name !== 'string' || name.trim() === '') {
      return;
    }

    const configured = options.user?.color;
    const color = isPresenceColor(configured) ? configured : presenceColorFor(state.localClientId ?? 0);

    yjs.setAwarenessField('user', { name, color });
  };

  const notify = (): void => {
    renderer?.render(
      Array.from(yjs.getAwarenessStates().entries()).map(([clientId, peerState]) => ({ clientId, state: peerState })),
      state.localClientId
    );
  };

  /**
   * Latch the local client id from the first local-origin change, and repaint
   * whenever a change touched anyone else.
   *
   * The remote test cannot be "origin !== 'local'": a disconnect clears every
   * peer through `clearRemoteAwarenessStates`, and y-protocols tags THAT
   * removal `'local'` too. Skipping it would leave ghost peers on screen until
   * the 30s prune.
   * @param changes - which clients were added, updated or removed
   * @param origin - `'local'` for anything this client caused
   */
  const onAwarenessChange = (changes: AwarenessChange, origin: unknown): void => {
    if (state.localClientId === null && origin === 'local') {
      state.localClientId = changes.updated[0] ?? changes.added[0] ?? null;
    }

    const touchedSomeoneElse = [...changes.added, ...changes.updated, ...changes.removed]
      .some((clientId) => clientId !== state.localClientId);

    if (touchedSomeoneElse) {
      notify();
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
      state.unhookAwareness = yjs.onAwarenessChange(onAwarenessChange);

      // Order matters. The block write fires a local-origin change
      // SYNCHRONOUSLY, which is how the client id gets latched — and the id is
      // what picks the default colour, so the identity has to go second or the
      // colour would change on the next publish.
      publishBlockId();
      publishUser();

      // A fresh throttle per start: the previous one's clock would suppress the
      // first caret move of a restarted session.
      const publish = throttle(publishBlockId, waitMs);

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
