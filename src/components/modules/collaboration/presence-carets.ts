import { resolveCaretRange, type CaretPosition } from './caret-position';

/** What the caret layer needs to know about a peer, after sanitization. */
export interface CaretPeer {
  clientId: number;
  /** Already trimmed and length-capped. The empty string means anonymous. */
  name: string;
  /** Already through the hex gate. */
  color: string;
  /** Already through `readCaret`, or null when they published none. */
  caret: CaretPosition | null;
}

export interface CaretLayerOptions {
  /** The holder of a block, or null when the id names nothing here. */
  resolveHolder: (blockId: string) => HTMLElement | null;
  /** That block's editable elements, in the order its own `inputs` reports. */
  resolveInputs: (blockId: string) => HTMLElement[];
  /** How long a name flag stays up after the caret last moved (default 2500ms). */
  labelLingerMs?: number;
}

export interface CaretLayer {
  /**
   * Draw these peers' carets and remove everyone else's.
   * @param peers - sanitized peers, this client's own already filtered out
   */
  render(peers: CaretPeer[]): void;
  /**
   * Re-measure the carets already drawn, without rebuilding them. Local typing
   * moves a peer's caret with no awareness traffic to ride on.
   */
  reposition(): void;
  /** Undo everything this layer wrote. */
  clear(): void;
}

/** The caret line. Styled by src/styles/presence.css. */
const CARET_ATTR = 'data-blok-presence-caret';
const NAME_ATTR = 'data-blok-presence-caret-name';
/** Set once the peer stops moving: the stylesheet fades the flag out and starts
    the caret's resting pulse. */
const IDLE_ATTR = 'data-blok-presence-caret-idle';
const COLOR_PROPERTY = '--blok-presence-color';

/**
 * How long a name flag stays up after the caret last moved.
 *
 * Notion's behaviour, and the reason to copy it: a document with four people in
 * it becomes a wall of name tags if the flags never go away, so the name
 * answers "who just moved there" and the coloured line carries the position
 * from then on.
 */
const DEFAULT_LABEL_LINGER_MS = 2500;

/** What one pass drew for one peer, so the next pass can undo it exactly. */
interface Drawn {
  element: HTMLElement;
  label: HTMLElement;
  holder: HTMLElement;
  /** The position this caret was last drawn at, as its comparison key. */
  key: string;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

/** Where a caret line goes, in viewport coordinates. */
interface Measurement {
  left: number;
  top: number;
  height: number;
}

const positionKey = (peer: CaretPeer): string => {
  const caret = peer.caret;

  return caret === null ? 'none' : `${caret.blockId}|${caret.inputIndex}|${caret.head}`;
};

/**
 * Measure where a caret line belongs.
 *
 * A collapsed Range measures zero in every engine when the element it sits in
 * has no text — an empty paragraph is the ordinary case, not an edge one — so
 * the input's own box is the fallback. Without it a peer's caret disappears
 * exactly when they are about to type.
 * @param input - the editable element the offset counts into
 * @param offset - the peer's published character offset
 */
const measure = (input: HTMLElement, offset: number): Measurement | null => {
  const range = resolveCaretRange(input, offset);

  if (range === null) {
    return null;
  }

  const rect = range.getBoundingClientRect();

  if (rect.height > 0) {
    return {
      left: rect.left,
      top: rect.top,
      height: rect.height,
    };
  }

  const box = input.getBoundingClientRect();

  return {
    left: box.left,
    top: box.top,
    height: box.height,
  };
};

/**
 * Draws remote carets: a coloured line at each peer's position, with their name
 * in a flag above it that fades once they stop moving. This is the whole of
 * remote presence inside the text — there is no block outline, because Notion
 * has none and a highlighted block says far less than a caret does.
 *
 * Every caret is appended to a block's HOLDER, which the child-holder
 * decoration law blesses and which is already `position: relative`. Writing at
 * or below the tool root instead would put presence chrome inside saves, inside
 * copied selections, and inside the tool's own markup.
 * @param options - how to find a block's holder and inputs, and the flag timing
 */
export const createCaretLayer = (options: CaretLayerOptions): CaretLayer => {
  const { resolveHolder, resolveInputs } = options;
  const lingerMs = options.labelLingerMs ?? DEFAULT_LABEL_LINGER_MS;

  /** The ledger, keyed by client id — two peers can share one block. */
  const drawn = new Map<number, Drawn>();
  const state = { peers: [] as CaretPeer[] };

  const remove = (entry: Drawn): void => {
    if (entry.idleTimer !== null) {
      clearTimeout(entry.idleTimer);
    }

    entry.element.remove();
  };

  const create = (holder: HTMLElement): Drawn => {
    const element = document.createElement('div');
    const label = document.createElement('span');

    element.setAttribute(CARET_ATTR, '');
    label.setAttribute(NAME_ATTR, '');

    // Inert on purpose: out of caret traversal, out of a copied selection, and
    // out of the accessibility tree — a screen reader announcing every remote
    // keystroke would be unusable.
    element.setAttribute('contenteditable', 'false');
    element.setAttribute('aria-hidden', 'true');

    element.appendChild(label);
    holder.appendChild(element);

    return {
      element,
      label,
      holder,
      key: '',
      idleTimer: null,
    };
  };

  /**
   * Show the name flag and start its fade over again. Called only when the
   * caret actually MOVED: a repaint caused by somebody else joining must not
   * bring every idle name flag back.
   * @param element - the caret being kept awake
   * @param previous - its running idle timer, if it has one
   */
  const wake = (
    element: HTMLElement,
    previous: ReturnType<typeof setTimeout> | null
  ): ReturnType<typeof setTimeout> => {
    if (previous !== null) {
      clearTimeout(previous);
    }

    element.removeAttribute(IDLE_ATTR);

    return setTimeout(() => element.setAttribute(IDLE_ATTR, ''), lingerMs);
  };

  /**
   * Where a caret belongs on its holder, or null when it cannot be placed.
   *
   * Holder-relative, because the holder is the offset parent. Viewport
   * coordinates written straight through would drift with every scroll.
   * @param holder - the holder the caret is parented on
   * @param caret - the peer's published position
   */
  const locate = (holder: HTMLElement, caret: CaretPosition): Measurement | null => {
    const input = resolveInputs(caret.blockId)[caret.inputIndex];

    if (input === undefined) {
      return null;
    }

    const spot = measure(input, caret.head);

    if (spot === null) {
      return null;
    }

    const box = holder.getBoundingClientRect();

    return {
      left: spot.left - box.left,
      top: spot.top - box.top,
      height: spot.height,
    };
  };

  const draw = (peers: CaretPeer[]): void => {
    const next = new Map<number, Drawn>();

    peers.forEach((peer) => {
      const caret = peer.caret;

      if (caret === null) {
        return;
      }

      const holder = resolveHolder(caret.blockId);

      // An id naming a block this client does not have is ordinary: the peer is
      // ahead of us, or is in a block we just deleted.
      if (holder === null) {
        return;
      }

      const existing = drawn.get(peer.clientId);
      const entry = existing !== undefined && existing.holder === holder ? existing : create(holder);
      const spot = locate(holder, caret);

      if (spot === null) {
        // Nothing could be drawn, so nothing goes in the ledger — and a caret
        // built for this pass has to come back down.
        if (entry !== existing) {
          entry.element.remove();
        }

        return;
      }

      entry.element.style.left = `${spot.left}px`;
      entry.element.style.top = `${spot.top}px`;
      entry.element.style.height = `${spot.height}px`;
      entry.label.textContent = peer.name;
      // An anonymous peer keeps the coloured line; an empty flag on their
      // caret would just look like a rendering fault.
      entry.label.hidden = peer.name === '';
      entry.element.style.setProperty(COLOR_PROPERTY, peer.color);

      const key = positionKey(peer);

      if (key !== entry.key) {
        entry.key = key;
        entry.idleTimer = wake(entry.element, entry.idleTimer);
      }

      next.set(peer.clientId, entry);
    });

    // Compared by identity: a caret reused for an unchanged peer is the same
    // object in both maps, so only genuinely stale ones come down.
    drawn.forEach((entry, clientId) => {
      if (next.get(clientId) !== entry) {
        remove(entry);
      }
    });

    drawn.clear();
    next.forEach((entry, clientId) => drawn.set(clientId, entry));
  };

  return {
    render(peers: CaretPeer[]): void {
      state.peers = peers;
      draw(peers);
    },

    reposition(): void {
      draw(state.peers);
    },

    clear(): void {
      drawn.forEach(remove);
      drawn.clear();
      state.peers = [];
    },
  };
};
