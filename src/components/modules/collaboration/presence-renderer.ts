import {
  ANONYMOUS_LABEL_KEYS,
  assignAnonymousGlyphs,
  type AnonymousGlyph,
} from './anonymous-identity';
import { readCaret, type CaretPosition } from './caret-position';
import {
  isPresenceColor,
  presenceColorFor,
  selectDrawableStates,
  type DrawableState,
  type PresenceState,
} from './presence';
import { createAvatarLayer, type AvatarLayer } from './presence-avatars';
import { createCaretLayer, type CaretLayer } from './presence-carets';

export interface PresenceRendererOptions {
  /**
   * The editor WRAPPER, not the redactor: the redactor is under the
   * modifications observer, and writes there would be a stream of records
   * for every block to filter. Watched for reflow so carets stay on the text
   * they point into.
   */
  host: HTMLElement;
  /** The holder of a block, or null when the id names nothing here. */
  resolveHolder: (blockId: string) => HTMLElement | null;
  /** That block's editable elements, in the order its own `inputs` reports. */
  resolveInputs: (blockId: string) => HTMLElement[];
  /**
   * Presence UI is suppressed while this is true (`readOnly.hideControls`).
   * Read on every pass rather than at construction — but only on a pass, so a
   * runtime toggle takes effect on the next awareness change, not instantly.
   */
  isHidden?: () => boolean;
  /** How long after its last move a peer's caret counts as still moving. */
  restAfterMs?: number;
  /**
   * Localizes an anonymous peer's label. Omit and they still get a silhouette,
   * just no tooltip — a label in the wrong language would be worse than none.
   */
  translate?: (key: string) => string;
  /**
   * Whether the READER published a name of their own.
   *
   * Their state is filtered out of the draw list but they are still in the
   * room, so their silhouette is still taken — and every other browser hands
   * it out to them. Without this the same peer is named differently in two
   * tabs, which is the one thing the scheme promises not to do.
   */
  isLocalAnonymous?: () => boolean;
}

export interface PresenceRenderer {
  /**
   * Draw the peers. Every state is untrusted input from another browser, and
   * the pass re-selects them itself — presence already narrowed the list, but
   * this is the last gate before the DOM.
   * @param states - awareness states in map order
   * @param localClientId - this editor's own client id, never drawn
   */
  render(states: PresenceState[], localClientId: number | null): void;
  /**
   * Re-measure the carets already drawn. Local typing moves a remote caret
   * with no awareness traffic to ride on.
   */
  reposition(): void;
  /** Undo everything this renderer wrote. */
  clear(): void;
}

/** Longest name drawn. A peer can publish megabytes; the label shows a name. */
const MAX_NAME_LENGTH = 32;

/** A peer after every hostile field has been made safe. */
interface DrawablePeer {
  clientId: number;
  name: string;
  color: string;
  caret: CaretPosition | null;
  /** The block they are in: the caret's block, or `blockId` when they published no caret. */
  blockId: string | null;
  /** Their silhouette, for a peer who published no name; null for a named one. */
  glyph: AnonymousGlyph | null;
}

/**
 * The block a peer named when they published NO caret — a peer on an image,
 * an embed or a table cell's native field, or a client from before carets
 * shipped. An absent caret is not a malformed one: a caret that is present
 * but rejected must not fall back to this, or a face would sit beside a block
 * whose caret this client refused to draw.
 * @param state - the peer's raw state
 */
const blockIdWithoutCaret = (state: Record<string, unknown>): string | null => {
  const { caret, blockId } = state;

  if (caret !== null && caret !== undefined) {
    return null;
  }

  return typeof blockId === 'string' && blockId !== '' ? blockId : null;
};

/**
 * Make one selected state safe to draw. Every field here is a value another
 * browser chose, so nothing but a string name, a hex colour and a well-formed
 * caret survives. An absent name is ordinary — `collaboration.user` is optional
 * — and becomes the empty string, which the pass draws as an anonymous peer.
 * @param entry - a state that passed the identity gate
 */
const readPeer = (entry: DrawableState): DrawablePeer => {
  const { name, color } = entry.state.user;
  const caret = readCaret(entry.state.caret);

  return {
    clientId: entry.clientId,
    // Cut by CODE POINT: slicing a string of astral characters in half leaves a
    // lone surrogate. The UTF-16 pre-slice bounds what `Array.from` has to
    // materialise — a peer can publish megabytes.
    name: typeof name === 'string'
      ? Array.from(name.trim().slice(0, 2 * MAX_NAME_LENGTH)).slice(0, MAX_NAME_LENGTH).join('')
      : '',
    color: isPresenceColor(color) ? color : presenceColorFor(entry.clientId),
    caret,
    blockId: caret?.blockId ?? blockIdWithoutCaret(entry.state),
    glyph: null,
  };
};

/**
 * Give every peer who published no name a silhouette and a localized label.
 *
 * The READER is counted too, though they are never drawn: the assignment has
 * to come out the same in every browser in the room, and each browser is the
 * one client missing from its own draw list.
 * @param peers - the peers this pass will draw
 * @param localClientId - this editor's own client id, or null before it is known
 * @param options - the label seam and whether the reader is nameless
 */
const nameTheNameless = (
  peers: DrawablePeer[],
  localClientId: number | null,
  options: Pick<PresenceRendererOptions, 'translate' | 'isLocalAnonymous'>
): DrawablePeer[] => {
  const anonymous = peers.flatMap(peer => (peer.name === '' ? [peer.clientId] : []));

  if (localClientId !== null && options.isLocalAnonymous?.() === true) {
    anonymous.push(localClientId);
  }

  if (anonymous.length === 0) {
    return peers;
  }

  const glyphs = assignAnonymousGlyphs(anonymous);

  return peers.map((peer) => {
    const glyph = peer.name === '' ? glyphs.get(peer.clientId) : undefined;

    return glyph === undefined
      ? peer
      : { ...peer, glyph, name: options.translate?.(ANONYMOUS_LABEL_KEYS[glyph]) ?? '' };
  });
};

/**
 * Renders remote presence the way Notion splits it two ways: a face parked in
 * the gutter beside each peer's block, and a caret line at their exact
 * position.
 *
 * Each answers a different question — who is on this block, and where in the
 * sentence they are — which is why the caret carries no name. There is
 * deliberately NO block outline: an outline says only "somebody is in this
 * paragraph", which the gutter face says better and the caret says exactly.
 * Who is in the document at all is the HOST's to draw, from the
 * `collaboration:status` event's `participants` list.
 *
 * The caret write sits at a level the child-holder decoration law blesses — a
 * caret appended to a block's holder. It is inert for change tracking: for the
 * edited block, `isMutationBelongsToElement` compares against the TOOL ROOT,
 * and a node appended to the holder is not inside it — the childList escape
 * hatch only covers the tool root being added or removed. For a container
 * whose slot holds that holder, the record's nearest `data-blok-mutation-free`
 * ancestor is the container's own, so it scores mutation-free. Nothing is
 * written at or below a tool root, and no holder is ever wrapped.
 * @param options - host, block lookups, and the chromeless gate
 */
export const createPresenceRenderer = (options: PresenceRendererOptions): PresenceRenderer => {
  const { host } = options;

  const carets: CaretLayer = createCaretLayer({
    resolveHolder: options.resolveHolder,
    resolveInputs: options.resolveInputs,
    restAfterMs: options.restAfterMs,
  });

  const avatars: AvatarLayer = createAvatarLayer({
    resolveHolder: options.resolveHolder,
    resolveInputs: options.resolveInputs,
  });

  const state = {
    reflow: null as ResizeObserver | null,
  };

  /**
   * Watch the editor for reflow, so carets follow the text they point into.
   *
   * A window resize rewraps every line under every remote caret and puts no
   * awareness traffic on the wire, so without this the carets sit at their old
   * coordinates until some peer happens to move. Attached lazily and dropped in
   * `clear()`, which is what a chromeless editor and a stopped session both go
   * through.
   */
  const watchReflow = (): void => {
    if (state.reflow !== null || typeof ResizeObserver === 'undefined') {
      return;
    }

    state.reflow = new ResizeObserver(() => carets.reposition());
    state.reflow.observe(host);
  };

  const clear = (): void => {
    carets.clear();
    avatars.clear();
    state.reflow?.disconnect();
    state.reflow = null;
  };

  return {
    render(states: PresenceState[], localClientId: number | null): void {
      if (options.isHidden?.() === true) {
        clear();

        return;
      }

      // Select, THEN cap — the order is the defence. `selectDrawableStates`
      // counts only peers it would actually draw against the cap, so junk
      // planted ahead of a real collaborator cannot take their place beside
      // their block or their caret off it.
      const peers = nameTheNameless(
        selectDrawableStates(states, localClientId).map(readPeer),
        localClientId,
        options
      );

      avatars.render(peers);
      carets.render(peers);
      watchReflow();
    },

    reposition(): void {
      if (options.isHidden?.() === true) {
        return;
      }

      carets.reposition();
    },

    clear,
  };
};
