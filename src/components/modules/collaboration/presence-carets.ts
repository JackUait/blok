import { measureLine, type CaretPosition, type LineBox } from './caret-position';
import { PRESENCE_COLOR_PROPERTY } from './presence';

/** What the caret layer needs to know about a peer, after sanitization. */
export interface CaretPeer {
  clientId: number;
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
  /** How long a caret counts as moving before it rests (default 2500ms). */
  restAfterMs?: number;
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
/** Set once the peer stops moving; the stylesheet starts the resting pulse. */
const IDLE_ATTR = 'data-blok-presence-caret-idle';

/** How long after its last move a caret counts as still moving. */
const DEFAULT_REST_AFTER_MS = 2500;

/** What one pass drew for one peer, so the next pass can undo it exactly. */
interface Drawn {
  element: HTMLElement;
  holder: HTMLElement;
  /** The position this caret was last drawn at, as its comparison key. */
  key: string;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const positionKey = (peer: CaretPeer): string => {
  const caret = peer.caret;

  return caret === null ? 'none' : `${caret.blockId}|${caret.inputIndex}|${caret.head}`;
};

/**
 * Draws remote carets: a coloured line at each peer's position, pulsing while
 * they rest so it reads as a person rather than a rendering artefact.
 *
 * It carries NO name. Identity lives on the face parked in the gutter beside
 * the block (`presence-avatars.ts`), which is how Notion splits the job: the
 * line says where in the sentence somebody is, the face says who. Labelling
 * both would name one person twice.
 *
 * Every caret is appended to a block's HOLDER, which the child-holder
 * decoration law blesses and which is already `position: relative`. Writing at
 * or below the tool root instead would put presence chrome inside saves, inside
 * copied selections, and inside the tool's own markup.
 * @param options - how to find a block's holder and inputs, and the flag timing
 */
export const createCaretLayer = (options: CaretLayerOptions): CaretLayer => {
  const { resolveHolder, resolveInputs } = options;
  const lingerMs = options.restAfterMs ?? DEFAULT_REST_AFTER_MS;

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

    element.setAttribute(CARET_ATTR, '');

    // Inert on purpose: out of caret traversal, out of a copied selection, and
    // out of the accessibility tree — a screen reader announcing every remote
    // keystroke would be unusable.
    element.setAttribute('contenteditable', 'false');
    element.setAttribute('aria-hidden', 'true');

    holder.appendChild(element);

    return {
      element,
      holder,
      key: '',
      idleTimer: null,
    };
  };

  /**
   * Mark the caret as moving and restart its rest timer. Called only when the
   * caret actually MOVED: a repaint caused by somebody else joining must not
   * wake every resting caret in the document.
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
  const locate = (holder: HTMLElement, caret: CaretPosition): LineBox | null => {
    const input = resolveInputs(caret.blockId)[caret.inputIndex];

    if (input === undefined) {
      return null;
    }

    const spot = measureLine(input, caret.head);

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
      entry.element.style.setProperty(PRESENCE_COLOR_PROPERTY, peer.color);

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
