import { measureLine, type CaretPosition, type LineBox } from './caret-position';
import { PRESENCE_COLOR_PROPERTY } from './presence';

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
  /** How long a caret counts as moving before it rests (default 2500ms). */
  restAfterMs?: number;
  /** How long an arriving peer's name stays up (default 3000ms). */
  greetForMs?: number;
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

/**
 * The name flag above a caret. Its value is the name, which presence.css
 * paints through `content: attr()` — never a text node, because the flag hangs
 * off the block HOLDER and a copied block carries every text node its holder
 * had. A SIBLING of the caret and not a pseudo-element of it, so the resting
 * pulse that animates the line's opacity leaves the name alone.
 */
const LABEL_ATTR = 'data-blok-presence-caret-label';
/** Present while the flag is up. */
const SHOWN_ATTR = 'data-blok-presence-caret-shown';

/** How long after its last move a caret counts as still moving. */
const DEFAULT_REST_AFTER_MS = 2500;

/** How long an arriving peer's name stays up before it fades. */
const DEFAULT_GREET_FOR_MS = 3000;

/**
 * How close the pointer comes before a caret says its name again.
 *
 * A caret is two pixels wide, which is not a hover target — and it must not
 * become one: `pointer-events` on a line lying in the middle of a paragraph
 * would swallow the click that puts your own caret there. So the layer watches
 * the holder's pointer moves instead and measures the distance itself.
 */
const HOVER_REACH = 12;

/** What one pass drew for one peer, so the next pass can undo it exactly. */
interface Drawn {
  element: HTMLElement;
  /** The name flag, or null for a peer with no name to say. */
  label: HTMLElement | null;
  holder: HTMLElement;
  /** The position this caret was last drawn at, as its comparison key. */
  key: string;
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** Runs while the arrival greeting is still up. */
  greetTimer: ReturnType<typeof setTimeout> | null;
  /** True while the pointer is within reach of the line. */
  hovered: boolean;
  /** Takes the holder's pointer watch back down. */
  unwatch: (() => void) | null;
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
  const greetMs = options.greetForMs ?? DEFAULT_GREET_FOR_MS;

  /** The ledger, keyed by client id — two peers can share one block. */
  const drawn = new Map<number, Drawn>();

  /**
   * Who has already been greeted, so a peer is named on arrival and not again
   * every time they walk into another block. Kept OUTSIDE the drawn ledger,
   * which loses its entry whenever a peer moves to a new holder and gets a
   * fresh caret built for them. A client id leaves this set when the peer
   * leaves the room, which is what makes coming back a fresh arrival.
   */
  const greeted = new Set<number>();
  const state = { peers: [] as CaretPeer[] };

  const remove = (entry: Drawn): void => {
    if (entry.idleTimer !== null) {
      clearTimeout(entry.idleTimer);
    }

    if (entry.greetTimer !== null) {
      clearTimeout(entry.greetTimer);
    }

    entry.unwatch?.();
    entry.element.remove();
    entry.label?.remove();
  };

  /** Inert the same way the caret is, and for the same reasons. */
  const inert = (element: HTMLElement): HTMLElement => {
    element.setAttribute('contenteditable', 'false');
    element.setAttribute('aria-hidden', 'true');

    return element;
  };

  /** Up when the peer has just arrived, or when the pointer is near the line. */
  const applyFlag = (entry: Drawn): void => {
    if (entry.label === null) {
      return;
    }

    if (entry.greetTimer !== null || entry.hovered) {
      entry.label.setAttribute(SHOWN_ATTR, '');
    } else {
      entry.label.removeAttribute(SHOWN_ATTR);
    }
  };

  /**
   * Watch the holder for pointer moves and flag the caret while one is near.
   *
   * On the HOLDER rather than the document: a document listener would be one
   * per editor on the page, and this one already has the element whose
   * coordinates it needs to measure against.
   * @param entry - the caret being watched
   */
  const watchPointer = (entry: Drawn): void => {
    const onMove = (event: Event): void => {
      const pointer = event as MouseEvent;
      const box = entry.holder.getBoundingClientRect();
      const left = pointer.clientX - box.left;
      const top = pointer.clientY - box.top;
      const spot = {
        left: parseFloat(entry.element.style.left),
        top: parseFloat(entry.element.style.top),
        height: parseFloat(entry.element.style.height),
      };
      const near = Math.abs(left - spot.left) <= HOVER_REACH &&
        top >= spot.top - HOVER_REACH &&
        top <= spot.top + spot.height + HOVER_REACH;

      if (near === entry.hovered) {
        return;
      }

      entry.hovered = near;
      applyFlag(entry);
    };

    entry.holder.addEventListener('pointermove', onMove, { passive: true });
    entry.unwatch = () => entry.holder.removeEventListener('pointermove', onMove);
  };

  const create = (holder: HTMLElement, name: string): Drawn => {
    const element = inert(document.createElement('div'));

    element.setAttribute(CARET_ATTR, '');

    // Inert on purpose: out of caret traversal, out of a copied selection, and
    // out of the accessibility tree — a screen reader announcing every remote
    // keystroke would be unusable.
    holder.appendChild(element);

    const entry: Drawn = {
      element,
      label: null,
      holder,
      key: '',
      idleTimer: null,
      greetTimer: null,
      hovered: false,
      unwatch: null,
    };

    if (name !== '') {
      entry.label = inert(document.createElement('div'));
      entry.label.setAttribute(LABEL_ATTR, name);
      holder.appendChild(entry.label);
      watchPointer(entry);
    }

    return entry;
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
      const entry = existing !== undefined && existing.holder === holder
        ? existing
        : create(holder, peer.name);
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

      if (entry.label !== null) {
        entry.label.style.left = `${spot.left}px`;
        entry.label.style.top = `${spot.top}px`;
        entry.label.style.setProperty(PRESENCE_COLOR_PROPERTY, peer.color);
      }

      if (!greeted.has(peer.clientId)) {
        greeted.add(peer.clientId);
        entry.greetTimer = setTimeout(() => {
          entry.greetTimer = null;
          applyFlag(entry);
        }, greetMs);
      }

      applyFlag(entry);

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

      // Anybody no longer in the room is forgotten, so the next time they show
      // up they are greeted by name again. Peers who are here but published no
      // caret stay remembered: they never left, they just stopped typing.
      const present = new Set(peers.map((peer) => peer.clientId));

      greeted.forEach((clientId) => {
        if (!present.has(clientId)) {
          greeted.delete(clientId);
        }
      });

      draw(peers);
    },

    reposition(): void {
      draw(state.peers);
    },

    clear(): void {
      drawn.forEach(remove);
      drawn.clear();
      greeted.clear();
      state.peers = [];
    },
  };
};
