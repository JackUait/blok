import { describeTextEdit } from '../blockManager/remote-edit-caret';

import { measureLine, measureSelection, type CaretPosition, type LineBox } from './caret-position';
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
  /**
   * Somebody else's edit to this block is on its way into the DOM. Carets in
   * it stop being carried until it lands — see `carry`.
   * @param blockId - the block whose text a peer is rewriting
   */
  remoteEdit(blockId: string): void;
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

/**
 * One wrapped line of the text a peer has selected. Overlay divs on the holder
 * and never `<span>`s around the text: the child-holder decoration law forbids
 * writing at or below a child's tool root, which is how the LOCAL fake
 * background works and why that approach cannot be reused here.
 */
const SELECTION_ATTR = 'data-blok-presence-selection';

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

/**
 * A peer's position after it has been carried across the local user's edits,
 * plus the text it now counts into.
 */
interface CarriedCaret {
  anchor: number;
  head: number;
  /** The input's text as of this pass — the baseline the next pass diffs from. */
  text: string;
}

/** What one pass drew for one peer, so the next pass can undo it exactly. */
interface Drawn {
  element: HTMLElement;
  /** One div per wrapped line of the peer's selection. Pooled across passes. */
  selection: HTMLElement[];
  /** The name flag, or null for a peer with no name to say. */
  label: HTMLElement | null;
  holder: HTMLElement;
  /** The position this caret was last drawn at, as its comparison key. */
  key: string;
  /** Their published position, carried along by every local edit since. */
  carried: CarriedCaret | null;
  /**
   * The text this block held when a peer's edit to it was announced, while
   * that edit has still not reached the DOM. Null when nothing is pending.
   */
  awaiting: string | null;
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

  // The ANCHOR counts too: dragging a selection back onto the caret moves only
  // the anchor, and a key without it reads that as a peer who never moved.
  return caret === null
    ? 'none'
    : `${caret.blockId}|${caret.inputIndex}|${caret.anchor}|${caret.head}`;
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
    entry.selection.splice(0).forEach((shade) => shade.remove());
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
   * Is the pointer close enough to this caret to be pointing at it?
   *
   * Measured rather than hovered: a caret is two pixels wide, which is not a
   * hover target, and it must never become one — `pointer-events` on a line
   * lying in a paragraph would swallow the click that puts your own caret
   * there.
   * @param entry - the caret being measured against
   * @param pointer - where the pointer is, in viewport coordinates
   */
  const isNear = (entry: Drawn, pointer: MouseEvent): boolean => {
    const box = entry.holder.getBoundingClientRect();
    const left = pointer.clientX - box.left;
    const top = pointer.clientY - box.top;
    const caretLeft = parseFloat(entry.element.style.left);
    const caretTop = parseFloat(entry.element.style.top);
    const caretHeight = parseFloat(entry.element.style.height);

    return Math.abs(left - caretLeft) <= HOVER_REACH &&
      top >= caretTop - HOVER_REACH &&
      top <= caretTop + caretHeight + HOVER_REACH;
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
      selection: [],
      label: null,
      holder,
      key: '',
      carried: null,
      awaiting: null,
      idleTimer: null,
      greetTimer: null,
      hovered: false,
      unwatch: null,
    };

    if (name !== '') {
      entry.label = inert(document.createElement('div'));
      entry.label.setAttribute(LABEL_ATTR, name);
      holder.appendChild(entry.label);

      // On the HOLDER rather than the document: a document listener would be
      // one per editor on the page, and this one already has the element it
      // measures against.
      const onMove = (event: Event): void => {
        const near = isNear(entry, event as MouseEvent);

        if (near !== entry.hovered) {
          entry.hovered = near;
          applyFlag(entry);
        }
      };

      holder.addEventListener('pointermove', onMove, { passive: true });
      entry.unwatch = () => holder.removeEventListener('pointermove', onMove);
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
   * @param box - the holder's own box, measured once for the whole pass
   * @param input - the editable element the peer's offsets count into
   * @param offset - the peer's published character offset
   */
  const locate = (box: DOMRect, input: HTMLElement, offset: number): LineBox | null => {
    const spot = measureLine(input, offset);

    if (spot === null) {
      return null;
    }

    return {
      left: spot.left - box.left,
      top: spot.top - box.top,
      height: spot.height,
    };
  };

  /**
   * Lay the shade over the text the peer has selected, one div per wrapped
   * line.
   *
   * Pooled rather than rebuilt: a selection grows a line at a time while the
   * peer drags, and tearing the divs down on every pass flickers the shade.
   * @param entry - the peer's ledger row, which owns the pool
   * @param holder - the holder the shade is parented on
   * @param box - the holder's own box, measured once for the whole pass
   * @param input - the same element the caret line was measured in
   * @param caret - the peer's published position
   * @param color - their already hex-gated colour
   */
  const shade = (
    entry: Drawn,
    holder: HTMLElement,
    box: DOMRect,
    input: HTMLElement,
    caret: CaretPosition,
    color: string
  ): void => {
    const rects = measureSelection(input, caret.anchor, caret.head);

    while (entry.selection.length > rects.length) {
      entry.selection.pop()?.remove();
    }

    rects.forEach((rect, index) => {
      const element = entry.selection[index] ?? inert(document.createElement('div'));

      if (entry.selection[index] === undefined) {
        element.setAttribute(SELECTION_ATTR, '');
        holder.appendChild(element);
        entry.selection.push(element);
      }

      element.style.left = `${rect.left - box.left}px`;
      element.style.top = `${rect.top - box.top}px`;
      element.style.width = `${rect.width}px`;
      element.style.height = `${rect.height}px`;
      element.style.setProperty(PRESENCE_COLOR_PROPERTY, color);
    });
  };

  /**
   * Where a peer really is, once the local user has typed under them.
   *
   * A published offset counts into the text the PEER had. Local typing rewrites
   * that text and puts nothing on the wire — the peer did not move, the
   * characters under them did — so re-measuring the published number draws them
   * as many columns off as the local user typed, until the peer's next publish
   * arrives a round trip later.
   *
   * So the offset is carried forward one edit at a time, by the same
   * prefix/suffix diff that keeps the LOCAL caret alive across a remote edit.
   * Carried incrementally from the last pass, never re-derived from the
   * original publish: a pass sees one edit and the diff names one changed
   * region, while a diff spanning a whole typing burst at two different places
   * would straddle the offset.
   *
   * Straddling is REFUSED rather than guessed. `adjustCaretOffset` parks a
   * straddled offset at the start of the changed region, which is the least
   * surprising answer for the local user's own caret — but for a remote one it
   * is absorbing: an idle peer's caret jumps to column 0, every later insert
   * before it takes the unchanged branch and keeps it there, and no publish
   * comes to correct somebody who is not typing. The published number is stale
   * by a few characters; column 0 is wrong by a paragraph.
   *
   * A null baseline means the peer's own number is the only thing to go on: a
   * fresh publish, or an edit this editor did not author (see `remoteEdit`).
   * @param baseline - the last pass's position and the text it counted into, or null
   * @param caret - what the peer published
   * @param text - the text in their input right now
   */
  const carry = (baseline: CarriedCaret | null, caret: CaretPosition, text: string): CarriedCaret => {
    const published = { anchor: caret.anchor,
      head: caret.head,
      text };

    if (baseline === null) {
      return published;
    }

    // The common case by a wide margin — every peer in every block nobody is
    // editing — and the diff below walks both strings end to end, on a pass
    // that runs up to ten times a second.
    if (baseline.text === text) {
      return baseline;
    }

    const { prefix, end, delta } = describeTextEdit(baseline.text, text);
    const shift = (offset: number): number | null => {
      if (offset <= prefix) {
        return offset;
      }

      return offset >= end ? offset + delta : null;
    };
    const anchor = shift(baseline.anchor);
    const head = shift(baseline.head);

    return anchor === null || head === null
      ? published
      : { anchor,
        head,
        text };
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
      // Resolved once and shared: the line and its shade must measure the
      // SAME input, or a table cell gets a caret in one cell and a shade in
      // another.
      const input = resolveInputs(caret.blockId)[caret.inputIndex];
      // One holder measurement for the whole peer: the line and the shade are
      // placed against the same box, and each read forces a layout.
      const box = holder.getBoundingClientRect();
      const key = positionKey(peer);
      const text = input?.textContent ?? '';
      // Cleared once the text differs from what it was when the peer's edit was
      // announced — that difference IS the rewrite arriving. The pass that sees
      // it arrive still refuses to carry, because that pass is precisely the
      // one whose diff would be the peer's own typing.
      const awaiting = entry.awaiting === text ? entry.awaiting : null;
      // The key carries `inputIndex`, so a peer who moved to another field of
      // the same block is a fresh publish here and never inherits a baseline
      // whose text came from the field they left.
      const baseline = entry.awaiting !== null || key !== entry.key ? null : entry.carried;
      const carried = input === undefined ? null : carry(baseline, caret, text);
      const shown = carried === null
        ? caret
        : { ...caret,
          anchor: carried.anchor,
          head: carried.head };
      const spot = input === undefined ? null : locate(box, input, shown.head);

      if (input === undefined || spot === null) {
        // Nothing could be drawn, so nothing goes in the ledger — and an entry
        // that never reaches the ledger is never swept either. It has to come
        // down WHOLE: the name flag and the holder's pointer watch are only
        // reachable through here.
        if (entry !== existing) {
          remove(entry);
        }

        return;
      }

      entry.carried = carried;
      entry.awaiting = awaiting;
      entry.element.style.left = `${spot.left}px`;
      entry.element.style.top = `${spot.top}px`;
      entry.element.style.height = `${spot.height}px`;
      entry.element.style.setProperty(PRESENCE_COLOR_PROPERTY, peer.color);
      shade(entry, holder, box, input, shown, peer.color);

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

    remoteEdit(blockId: string): void {
      state.peers.forEach((peer) => {
        const caret = peer.caret;
        const entry = drawn.get(peer.clientId);

        if (caret === null || caret.blockId !== blockId || entry === undefined) {
          return;
        }

        // The text as it is NOW, before the rewrite lands. A pass that finds it
        // unchanged knows the edit is still in flight; the first pass that
        // finds it different knows it has arrived, and starts a fresh baseline
        // from the peer's published number.
        entry.awaiting = resolveInputs(blockId)[caret.inputIndex]?.textContent ?? '';
      });
    },

    clear(): void {
      drawn.forEach(remove);
      drawn.clear();
      greeted.clear();
      state.peers = [];
    },
  };
};
