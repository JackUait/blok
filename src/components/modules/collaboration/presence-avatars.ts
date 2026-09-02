import { DATA_ATTR } from '../../constants/data-attributes';

import { measureLine } from './caret-position';
import { PRESENCE_COLOR_PROPERTY, initialsOf } from './presence';

/** The identity half of a peer, as both avatar shapes draw it. */
export interface AvatarIdentity {
  /** Already trimmed and length-capped. The empty string means anonymous. */
  name: string;
  /** Already through the hex gate. */
  color: string;
}

/** What the avatar layer needs to know about a peer, after sanitization. */
export interface AvatarPeer extends AvatarIdentity {
  clientId: number;
  /** The block they are working in, or null when they named none. */
  blockId: string | null;
}

export interface AvatarLayerOptions {
  /** The holder of a block, or null when the id names nothing here. */
  resolveHolder: (blockId: string) => HTMLElement | null;
  /** That block's editable elements; only the first is measured. */
  resolveInputs?: (blockId: string) => HTMLElement[];
  /** How many faces one block shows before it starts counting (default 3). */
  maxFaces?: number;
}

export interface AvatarLayer {
  /**
   * Park these peers' faces beside their blocks and take everyone else's down.
   * @param peers - sanitized peers, this client's own already filtered out
   */
  render(peers: AvatarPeer[]): void;
  /** Undo everything this layer wrote. */
  clear(): void;
}

/** One block's gutter strip. Styled by src/styles/presence.css. */
const GUTTER_ATTR = 'data-blok-presence-gutter';
const FACE_ATTR = 'data-blok-presence-face';
const OVERFLOW_ATTR = 'data-blok-presence-face-overflow';
/**
 * The monogram (or the `+N`), painted by presence.css through `content:
 * attr()`. An attribute and NOT a text node, because the strip sits inside the
 * holder: block-select → copy sanitizes `holder.innerHTML`, unwraps the strip
 * and keeps every text node it held, so a monogram written as text would paste
 * into the next document.
 */
const INITIALS_ATTR = 'data-blok-presence-initials';

/**
 * Faces one block shows before it starts counting.
 *
 * Smaller than the editor-wide avatar stack's four: this strip lives in the
 * gutter beside a single block, and a column of faces taller than the block it
 * belongs to stops pointing at anything.
 */
const DEFAULT_MAX_FACES = 3;

/**
 * Where the face sits when nothing measures at all — neither the first line
 * nor the input's box, which only a hidden input (or a test DOM) gives. One
 * body line, halved by the centring below.
 */
const FALLBACK_LINE_CENTRE = 12;

/**
 * One avatar disc: the peer's colour and, for a named peer, the full name in a
 * `title` and their monogram. Attribute values are never parsed as markup, so
 * a hostile name is safe in both.
 *
 * `monogram` says where the initials go. The gutter face sits INSIDE a block
 * holder, and block copy sanitizes `holder.innerHTML` keeping every text node
 * it held, so the face carries them in an attribute presence.css paints. The
 * editor-wide stack sits outside every holder and writes them as text.
 * @param peer - the peer's sanitized identity
 * @param attr - the attribute that marks this avatar shape
 * @param monogram - where the initials are written
 */
export const buildAvatar = (peer: AvatarIdentity, attr: string, monogram: 'text' | 'attribute'): HTMLElement => {
  const avatar = document.createElement('span');

  avatar.setAttribute(attr, '');
  avatar.style.setProperty(PRESENCE_COLOR_PROPERTY, peer.color);

  // A peer who published no name is drawn as their colour alone: no monogram,
  // and no tooltip claiming an empty name.
  if (peer.name !== '') {
    avatar.setAttribute('title', peer.name);

    if (monogram === 'attribute') {
      avatar.setAttribute(INITIALS_ATTR, initialsOf(peer.name));
    } else {
      avatar.textContent = initialsOf(peer.name);
    }
  }

  return avatar;
};

/**
 * Parks a peer's face in the gutter beside the block they are working in, and
 * moves it as they move — the Notion shape.
 *
 * This is where identity lives, which is why the caret carries none: a coloured
 * line says where in the sentence somebody is, and the face beside the block
 * says who. Putting a name on both would label one person twice.
 *
 * Everything is written on the block HOLDER, which the child-holder decoration
 * law blesses and which is already `position: relative`, so the strip can hang
 * in the gutter without the layer touching layout. Nothing is written at or
 * below a tool root.
 * @param options - how to find a block's holder, and how many faces it shows
 */
export const createAvatarLayer = (options: AvatarLayerOptions): AvatarLayer => {
  const { resolveHolder } = options;
  const maxFaces = options.maxFaces ?? DEFAULT_MAX_FACES;

  /** The ledger, keyed by block id — a gutter belongs to a block, not a peer. */
  const strips = new Map<string, HTMLElement>();

  const buildFace = (peer: AvatarPeer): HTMLElement => buildAvatar(peer, FACE_ATTR, 'attribute');

  const buildOverflow = (hidden: number): HTMLElement => {
    const overflow = document.createElement('span');

    // Deliberately NOT a face: it is a count, and anything asking "how many
    // people are on this block" must not get this one back.
    overflow.setAttribute(OVERFLOW_ATTR, '');
    overflow.setAttribute(INITIALS_ATTR, `+${hidden}`);

    return overflow;
  };

  /**
   * Where a strip mounts: the block's own content wrapper.
   *
   * NOT the holder, which spans the editor's full width — the content column is
   * centred inside it, so a strip parked against the holder's edge lands a
   * hundred-odd pixels out in the margin instead of beside the text. The
   * wrapper is the content edge, and the decoration law blesses it alongside
   * the holder. `:scope >` because a container block's holder also contains its
   * CHILDREN's wrappers, and the first one found would be the wrong block's.
   * @param holder - the block's holder
   */
  const mountFor = (holder: HTMLElement): HTMLElement =>
    holder.querySelector<HTMLElement>(`:scope > [${DATA_ATTR.elementContent}]`) ?? holder;

  /**
   * How far below the mount's top edge the block's FIRST LINE is centred.
   *
   * Measured, not assumed: a line does not start at the top of its wrapper —
   * there is half-leading above it — and a heading's line is far taller than a
   * paragraph's, so no fixed offset is right for both. Measured through the
   * same `measureLine` the carets use, so the face and the caret agree about
   * where a line is — including an empty block, where both take the input's
   * box.
   * @param blockId - the block being decorated
   * @param mount - the element the strip is positioned against
   */
  const lineCentreIn = (blockId: string, mount: HTMLElement): number => {
    const input = options.resolveInputs?.(blockId)[0];
    const line = input === undefined ? null : measureLine(input, 0);

    if (line === null || line.height === 0) {
      return FALLBACK_LINE_CENTRE;
    }

    return line.top + line.height / 2 - mount.getBoundingClientRect().top;
  };

  /**
   * The SAME strip is reused while the block still has one in the same place —
   * the leftover sweep compares by identity, so handing back a fresh element
   * for an unchanged block would tear down the strip this pass just filled.
   * @param blockId - the block being decorated
   * @param holder - its holder
   */
  const stripFor = (blockId: string, holder: HTMLElement): HTMLElement => {
    const existing = strips.get(blockId);
    const mount = mountFor(holder);

    if (existing !== undefined && existing.parentElement === mount) {
      return existing;
    }

    const strip = document.createElement('div');

    strip.setAttribute(GUTTER_ATTR, '');
    // Inert on purpose: out of caret traversal, out of a copied selection, and
    // out of the accessibility tree — the editor-wide stack already names who
    // is in the document.
    strip.setAttribute('contenteditable', 'false');
    strip.setAttribute('aria-hidden', 'true');
    mount.appendChild(strip);

    return strip;
  };

  return {
    render(peers: AvatarPeer[]): void {
      /** Peers grouped by the block they are in, in the order they arrived. */
      const byBlock = new Map<string, AvatarPeer[]>();

      peers.forEach((peer) => {
        const blockId = peer.blockId;

        if (blockId === null || resolveHolder(blockId) === null) {
          return;
        }

        const group = byBlock.get(blockId);

        if (group === undefined) {
          byBlock.set(blockId, [peer]);
        } else {
          group.push(peer);
        }
      });

      const next = new Map<string, HTMLElement>();

      byBlock.forEach((group, blockId) => {
        const holder = resolveHolder(blockId);

        if (holder === null) {
          return;
        }

        const strip = stripFor(blockId, holder);
        const shown = group.slice(0, maxFaces).map(buildFace);

        if (group.length > maxFaces) {
          shown.push(buildOverflow(group.length - maxFaces));
        }

        // Replaced wholesale rather than diffed: a strip holds at most a
        // handful of spans, and the identity that must survive a pass is the
        // STRIP's (so the sweep below can tell it apart), not each face's.
        strip.replaceChildren(...shown);

        // Twice the line centre, with the faces centred inside: that lands them
        // ON the line without a transform, which the hover slide already owns.
        strip.style.height = `${2 * lineCentreIn(blockId, strip.parentElement ?? holder)}px`;

        next.set(blockId, strip);
      });

      strips.forEach((strip, blockId) => {
        if (next.get(blockId) !== strip) {
          strip.remove();
        }
      });

      strips.clear();
      next.forEach((strip, blockId) => strips.set(blockId, strip));
    },

    clear(): void {
      strips.forEach((strip) => strip.remove());
      strips.clear();
    },
  };
};
