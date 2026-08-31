import {
  isPresenceColor,
  presenceColorFor,
  selectDrawableStates,
  type DrawableState,
  type PresenceState,
} from './presence';

export interface PresenceRendererOptions {
  /**
   * Where the avatar stack mounts. Pass the editor WRAPPER, not the redactor:
   * the redactor is under the modifications observer, and a stack rebuilt on
   * every awareness change would be a stream of records for every block to
   * filter.
   */
  host: HTMLElement;
  /** The holder of a block, or null when the id names nothing here. */
  resolveHolder: (blockId: string) => HTMLElement | null;
  /**
   * Presence UI is suppressed while this is true (`readOnly.hideControls`).
   * Read on every pass rather than at construction — but only on a pass, so a
   * runtime toggle takes effect on the next awareness change, not instantly.
   */
  isHidden?: () => boolean;
  /** How many faces the stack shows before it starts counting (default 4). */
  maxAvatars?: number;
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
  /** Undo everything this renderer wrote. */
  clear(): void;
}

/** Marks a holder a peer is editing. Styled by src/styles/presence.css. */
const PRESENCE_ATTR = 'data-blok-presence';
const PRESENCE_COLOR_PROPERTY = '--blok-presence-color';
const LABEL_ATTR = 'data-blok-presence-label';
const STACK_ATTR = 'data-blok-presence-stack';
const AVATAR_ATTR = 'data-blok-presence-avatar';
const OVERFLOW_ATTR = 'data-blok-presence-overflow';

const DEFAULT_MAX_AVATARS = 4;

/** Longest name drawn. A peer can publish megabytes; the label shows a name. */
const MAX_NAME_LENGTH = 32;

/** A peer after every hostile field has been made safe. */
interface DrawablePeer {
  clientId: number;
  name: string;
  color: string;
  blockId: string | null;
}

/** What one pass wrote for one block, so the next pass can undo it exactly. */
interface Stamp {
  target: HTMLElement;
  attributes: string[];
  properties: string[];
  element: HTMLElement;
}

/**
 * Make one selected state safe to draw. Every field here is a value another
 * browser chose, so nothing but a string name, a hex colour and a string block
 * id survives. An absent name is ordinary — `collaboration.user` is optional —
 * and becomes the empty string, which the pass draws as an anonymous peer.
 * @param entry - a state that passed the identity gate
 */
const readPeer = (entry: DrawableState): DrawablePeer => {
  const { name, color } = entry.state.user;
  const blockId = entry.state.blockId;

  return {
    clientId: entry.clientId,
    // Cut by CODE POINT: slicing a string of astral characters in half leaves a
    // lone surrogate.
    name: typeof name === 'string' ? Array.from(name.trim()).slice(0, MAX_NAME_LENGTH).join('') : '',
    color: isPresenceColor(color) ? color : presenceColorFor(entry.clientId),
    blockId: typeof blockId === 'string' ? blockId : null,
  };
};

/** First letter of each of the first two words — a monogram, not a name. */
const initialsOf = (name: string): string =>
  name
    .split(/\s+/u)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('');

/**
 * Renders remote presence: an avatar stack on the editor wrapper, and on each
 * edited block a marked HOLDER carrying the peer's colour plus one label
 * element appended inside it.
 *
 * Both writes sit at levels the child-holder decoration law blesses. They are
 * inert for change tracking: for the edited block, `isMutationBelongsToElement`
 * compares against the TOOL ROOT, and neither an attribute on the holder nor a
 * node appended to it is inside — the childList escape hatch only covers the
 * tool root being added or removed. For a container whose slot holds that
 * holder, the record's nearest `data-blok-mutation-free` ancestor is the
 * container's own, so it scores mutation-free. Nothing is written at or below a
 * tool root, and no holder is ever wrapped.
 * @param options - host, holder lookup, and the chromeless gate
 */
export const createPresenceRenderer = (options: PresenceRendererOptions): PresenceRenderer => {
  const { host, resolveHolder } = options;
  const maxAvatars = options.maxAvatars ?? DEFAULT_MAX_AVATARS;

  /** The ledger, keyed by block id. */
  const stamps = new Map<string, Stamp>();
  const state = { stack: null as HTMLElement | null };

  const undo = (stamp: Stamp): void => {
    stamp.attributes.forEach((name) => stamp.target.removeAttribute(name));
    stamp.properties.forEach((property) => stamp.target.style.removeProperty(property));
    stamp.element.remove();

    // `style` is left behind as an empty attribute once its last property goes,
    // and a bare `style=""` is a diff nobody asked for.
    if (stamp.target.getAttribute('style') === '') {
      stamp.target.removeAttribute('style');
    }
  };

  const createStamp = (holder: HTMLElement): Stamp => {
    const label = document.createElement('div');

    label.setAttribute(LABEL_ATTR, '');
    // Inert on purpose: out of caret traversal, out of a copied selection, and
    // out of the accessibility tree (the stack already names the peer).
    label.setAttribute('contenteditable', 'false');
    label.setAttribute('aria-hidden', 'true');
    holder.appendChild(label);

    return {
      target: holder,
      attributes: [PRESENCE_ATTR],
      properties: [PRESENCE_COLOR_PROPERTY],
      element: label,
    };
  };

  /**
   * The SAME stamp object is returned when the block still has one on the same
   * holder — the leftover sweep compares by identity, so handing back a fresh
   * record for an unchanged block would make the sweep tear down the very label
   * this pass just reused.
   * @param blockId - the block being decorated
   * @param holder - its holder
   * @param peer - the peer editing it
   */
  const stampHolder = (blockId: string, holder: HTMLElement, peer: DrawablePeer): Stamp => {
    const existing = stamps.get(blockId);
    const stamp = existing !== undefined && existing.target === holder ? existing : createStamp(holder);

    stamp.element.textContent = peer.name;
    // An anonymous peer still gets the coloured outline; an empty name bubble
    // on their block would just look like a rendering fault.
    stamp.element.hidden = peer.name === '';
    stamp.element.style.setProperty(PRESENCE_COLOR_PROPERTY, peer.color);

    holder.setAttribute(PRESENCE_ATTR, '');
    holder.style.setProperty(PRESENCE_COLOR_PROPERTY, peer.color);

    return stamp;
  };

  const renderOutlines = (peers: DrawablePeer[]): void => {
    const next = new Map<string, Stamp>();

    peers.forEach((peer) => {
      const blockId = peer.blockId;

      // An id naming a block this client does not have is ordinary: the peer is
      // ahead of us, or editing a block we just deleted. First peer on a block
      // owns its colour.
      if (blockId === null || next.has(blockId)) {
        return;
      }

      const holder = resolveHolder(blockId);

      if (holder === null) {
        return;
      }

      next.set(blockId, stampHolder(blockId, holder, peer));
    });

    stamps.forEach((stamp, blockId) => {
      if (next.get(blockId) !== stamp) {
        undo(stamp);
      }
    });

    stamps.clear();
    next.forEach((stamp, blockId) => stamps.set(blockId, stamp));
  };

  const renderStack = (peers: DrawablePeer[]): void => {
    if (peers.length === 0) {
      state.stack?.remove();
      state.stack = null;

      return;
    }

    if (state.stack === null) {
      state.stack = document.createElement('div');
      state.stack.setAttribute(STACK_ATTR, '');
      host.appendChild(state.stack);
    }

    const stack = state.stack;

    stack.replaceChildren();

    peers.slice(0, maxAvatars).forEach((peer) => {
      const avatar = document.createElement('span');

      avatar.setAttribute(AVATAR_ATTR, '');

      // A peer who published no name is drawn as their colour alone: no
      // monogram, and no tooltip claiming an empty name.
      if (peer.name !== '') {
        // An attribute value is never parsed as markup, so a hostile name is as
        // safe here as it is in textContent.
        avatar.setAttribute('title', peer.name);
        avatar.textContent = initialsOf(peer.name);
      }

      avatar.style.setProperty(PRESENCE_COLOR_PROPERTY, peer.color);

      stack.appendChild(avatar);
    });

    if (peers.length > maxAvatars) {
      const overflow = document.createElement('span');

      // Deliberately NOT an avatar: it is a count, and anything that asks "how
      // many faces are shown" must not get this one back.
      overflow.setAttribute(OVERFLOW_ATTR, '');
      overflow.textContent = `+${peers.length - maxAvatars}`;

      stack.appendChild(overflow);
    }
  };

  const clear = (): void => {
    stamps.forEach(undo);
    stamps.clear();
    state.stack?.remove();
    state.stack = null;
  };

  return {
    render(states: PresenceState[], localClientId: number | null): void {
      if (options.isHidden?.() === true) {
        clear();

        return;
      }

      // Select, THEN cap — the order is the defence. `selectDrawableStates`
      // counts only peers it would actually draw against the cap, so junk
      // planted ahead of a real collaborator cannot take their place in the
      // stack or their outline off their block.
      const peers = selectDrawableStates(states, localClientId).map(readPeer);

      renderStack(peers);
      renderOutlines(peers);
    },
    clear,
  };
};
