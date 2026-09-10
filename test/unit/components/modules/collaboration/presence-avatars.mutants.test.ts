/**
 * Gutter-avatar mutants the existing suite did not notice.
 *
 * The layer's contract is narrow and every survivor sits on one of four facts,
 * so the tests below are grouped by which fact they pin:
 *
 * - EVERY WRITE IS AN ATTRIBUTE, and its VALUE is part of the contract.
 *   presence.css paints the monogram through `content: attr(...)`, so a marker
 *   written as `data-blok-presence-gutter="Stryker was here!"` is a different
 *   strip from the one the stylesheet knows: the assertions name the exact
 *   value, not the attribute's mere presence.
 * - A STRIP IS NOT REBUILT WHEN WHAT IT DRAWS IS UNCHANGED. `stripSignature` is
 *   compared by equality only — it is never written to the DOM — so the kills
 *   here are element IDENTITY across two renders, which is what keeps a hovered
 *   tooltip pointing at a node still in the document.
 * - THE GROUPING PASS AND THE PAINT PASS ASK TWICE, so a holder that answers
 *   the first time and not the second must leave nothing behind.
 * - MEASUREMENT FALLS BACK, in three steps, and each one has an exact height.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DATA_ATTR, TOOLTIP_INTERFACE_VALUE } from '../../../../../src/components/constants';
import {
  buildAvatar,
  createAvatarLayer,
  type AvatarLayer,
  type AvatarPeer,
} from '../../../../../src/components/modules/collaboration/presence-avatars';
import { destroy as destroyTooltip } from '../../../../../src/components/utils/tooltip';

const GUTTER_ATTR = 'data-blok-presence-gutter';
const FACE_ATTR = 'data-blok-presence-face';
const OVERFLOW_ATTR = 'data-blok-presence-face-overflow';
const INITIALS_ATTR = 'data-blok-presence-initials';
const GLYPH_ATTR = 'data-blok-presence-glyph';
const COLOR_PROPERTY = '--blok-presence-color';

const COLOR = '#0b6e99';

/**
 * A silhouette string standing in for "any string at all" — the gutter's
 * signature writes a marker where a peer has no glyph, and that marker must
 * not be a value a peer could wear.
 */
const SILHOUETTE_MARKER = 'Stryker was here!';

interface Harness {
  layer: AvatarLayer;
  holderOf: (blockId: string) => HTMLElement;
  facesIn: (blockId: string) => HTMLElement[];
  gutterOf: (blockId: string) => HTMLElement | null;
  overflowOf: (blockId: string) => HTMLElement | null;
}

const layers: AvatarLayer[] = [];
const mounted: HTMLElement[] = [];

/** A block's real nesting: holder → content wrapper → tool root. */
const makeHolder = (blockId: string): HTMLElement => {
  const holder = document.createElement('div');
  const content = document.createElement('div');
  const toolRoot = document.createElement('div');

  holder.setAttribute('data-blok-element', '');
  holder.setAttribute('data-blok-id', blockId);
  content.setAttribute('data-blok-element-content', '');
  toolRoot.setAttribute('data-blok-tool', 'paragraph');
  toolRoot.textContent = 'hello world';

  content.appendChild(toolRoot);
  holder.appendChild(content);
  document.body.appendChild(holder);
  mounted.push(holder);

  return holder;
};

const setup = (options: { blockIds?: string[]; maxFaces?: number } = {}): Harness => {
  const holders = new Map<string, HTMLElement>();

  (options.blockIds ?? ['block-1', 'block-2']).forEach((blockId) => {
    holders.set(blockId, makeHolder(blockId));
  });

  const layer = createAvatarLayer({
    resolveHolder: (blockId) => holders.get(blockId) ?? null,
    resolveInputs: (blockId) => {
      const toolRoot = holders.get(blockId)?.querySelector<HTMLElement>('[data-blok-tool]');

      return toolRoot === null || toolRoot === undefined ? [] : [toolRoot];
    },
    maxFaces: options.maxFaces,
  });

  layers.push(layer);

  const holderOf = (blockId: string): HTMLElement => {
    const holder = holders.get(blockId);

    if (holder === undefined) {
      throw new Error(`no holder for ${blockId}`);
    }

    return holder;
  };

  return {
    layer,
    holderOf,
    facesIn: (blockId) => Array.from(holderOf(blockId).querySelectorAll<HTMLElement>(`[${FACE_ATTR}]`)),
    gutterOf: (blockId) => holderOf(blockId).querySelector<HTMLElement>(`[${GUTTER_ATTR}]`),
    overflowOf: (blockId) => holderOf(blockId).querySelector<HTMLElement>(`[${OVERFLOW_ATTR}]`),
  };
};

const peer = (clientId: number, overrides: Partial<AvatarPeer> = {}): AvatarPeer => ({
  clientId,
  name: 'Ada Lovelace',
  color: COLOR,
  blockId: 'block-1',
  ...overrides,
});

/** A crowd of `count` peers, all in block-1, each with its own name. */
const crowd = (count: number): AvatarPeer[] =>
  Array.from({ length: count }, (_unused, index) => peer(index + 1, { name: `Peer ${index + 1}` }));

const rect = (top: number, height: number): DOMRect => ({
  left: 0,
  top,
  height,
  right: 0,
  bottom: top + height,
  width: 0,
  x: 0,
  y: top,
  toJSON: () => ({}),
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  layers.splice(0).forEach((layer) => layer.clear());
  mounted.splice(0).forEach((holder) => holder.remove());
  destroyTooltip();
  vi.restoreAllMocks();
});

describe('buildAvatar — every write is an attribute with an exact value', () => {
  it('marks the avatar with the empty string, not a placeholder', () => {
    const avatar = buildAvatar({ name: 'Ada Lovelace', color: COLOR }, FACE_ATTR, 'attribute');

    // The markers are presence-only: a selector matches them, the value carries
    // nothing. Any other value is a different attribute to the stylesheet.
    expect(avatar.getAttribute(FACE_ATTR)).toBe('');
  });

  it('carries the peer colour as the exact custom property', () => {
    const avatar = buildAvatar({ name: 'Ada Lovelace', color: '#c1461f' }, FACE_ATTR, 'attribute');

    expect(avatar.style.getPropertyValue(COLOR_PROPERTY)).toBe('#c1461f');
  });

  it('writes no silhouette for a peer who published no glyph', () => {
    const noGlyph = buildAvatar({ name: 'Ada Lovelace', color: COLOR }, FACE_ATTR, 'attribute');
    const nullGlyph = buildAvatar({ name: 'Ada Lovelace', color: COLOR, glyph: null }, FACE_ATTR, 'attribute');

    // `undefined` and `null` both mean "draw a monogram": a silhouette is a
    // value this client chose for a nameless peer, never a default.
    expect(noGlyph.hasAttribute(GLYPH_ATTR)).toBe(false);
    expect(nullGlyph.hasAttribute(GLYPH_ATTR)).toBe(false);
  });

  it('draws the silhouette on the attribute, and no monogram beside it', () => {
    const avatar = buildAvatar({ name: 'Ada Lovelace', color: COLOR, glyph: 'mask-one' }, FACE_ATTR, 'attribute');

    expect(avatar.getAttribute(GLYPH_ATTR)).toBe('mask-one');
    expect(avatar.hasAttribute(INITIALS_ATTR)).toBe(false);
  });

  it('gives a nameless peer no monogram and no label', () => {
    const avatar = buildAvatar({ name: '', color: COLOR }, FACE_ATTR, 'attribute');

    // A nameless peer is the default configuration, not an error: claiming a
    // name with an empty label or a monogram of nobody is worse than silence.
    expect(avatar.hasAttribute(INITIALS_ATTR)).toBe(false);
    expect(avatar.hasAttribute('aria-label')).toBe(false);
  });

  it('writes the initials as text only when the caller asks for text', () => {
    const asText = buildAvatar({ name: 'Ada Lovelace', color: COLOR }, FACE_ATTR, 'text');

    // The gutter passes 'attribute' — the strip sits inside the holder, and a
    // block copy keeps every text node the holder held. The text shape exists
    // for a caller mounted outside any holder, and it must still draw.
    expect(asText.textContent).toBe('AL');
    expect(asText.hasAttribute(INITIALS_ATTR)).toBe(false);
  });

  it('asks the tooltip for the top placement', () => {
    const avatar = buildAvatar({ name: 'Ada Lovelace', color: COLOR }, FACE_ATTR, 'attribute');

    // A face hangs in the gutter beside a line; a bubble below it would cover
    // the block underneath instead of the face.
    vi.spyOn(avatar, 'getBoundingClientRect').mockReturnValue(rect(400, 20));
    document.body.appendChild(avatar);
    mounted.push(avatar);
    avatar.dispatchEvent(new Event('mouseenter'));

    const bubble = document.querySelector(`[${DATA_ATTR.interface}="${TOOLTIP_INTERFACE_VALUE}"]`);

    expect(bubble?.getAttribute('data-blok-placement')).toBe('top');
  });

  it('writes a hostile name as an attribute value, never as markup', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const avatar = buildAvatar({ name: hostile, color: COLOR }, FACE_ATTR, 'attribute');

    expect(avatar.getAttribute('aria-label')).toBe(hostile);
    expect(avatar.querySelector('img')).toBeNull();
  });
});

describe('avatar layer — the strip and its markers', () => {
  it('marks the strip as an inert, hidden, gutter-positioned element', () => {
    const harness = setup();

    harness.layer.render([peer(1)]);

    const gutter = harness.gutterOf('block-1');

    // Out of caret traversal, out of a copied selection, out of the
    // accessibility tree — everything on this strip is an attribute with an
    // exact value, and the stylesheet keys off every one of them.
    expect(gutter).not.toBeNull();
    expect(gutter?.getAttribute(GUTTER_ATTR)).toBe('');
    expect(gutter?.getAttribute('contenteditable')).toBe('false');
    expect(gutter?.getAttribute('aria-hidden')).toBe('true');
  });

  it('marks a face with the empty string and the overflow with its count', () => {
    const harness = setup({ maxFaces: 1 });

    harness.layer.render(crowd(3));

    const overflow = harness.overflowOf('block-1');

    expect(harness.facesIn('block-1')[0]?.getAttribute(FACE_ATTR)).toBe('');
    expect(overflow?.getAttribute(OVERFLOW_ATTR)).toBe('');
    expect(overflow?.getAttribute(INITIALS_ATTR)).toBe('+2');
  });
});

describe('avatar layer — an unchanged pass keeps the faces it drew', () => {
  it('hands back the very same face element when nothing changed', () => {
    const harness = setup();

    harness.layer.render([peer(1, { name: 'Ada' })]);

    const first = harness.facesIn('block-1')[0];

    harness.layer.render([peer(1, { name: 'Ada' })]);

    // A peer republishes on every keystroke. Replacing the span would leave a
    // hovered tooltip anchored to a node no longer in the document.
    expect(harness.facesIn('block-1')[0]).toBe(first);
  });

  it('keeps the faces when only a peer past the cap changes', () => {
    const harness = setup({ maxFaces: 2 });

    harness.layer.render([peer(1, { name: 'Ada' }), peer(2, { name: 'Bo' }), peer(3, { name: 'Cy' })]);

    const drawn = harness.facesIn('block-1');

    harness.layer.render([peer(1, { name: 'Ada' }), peer(2, { name: 'Bo' }), peer(3, { name: 'Zed' })]);

    // Cy and Zed are both behind the cap and both counted as "+1", so what the
    // strip DRAWS did not change — the signature only covers the faces it shows
    // plus the count, never the peers it hides.
    expect(harness.facesIn('block-1')[0]).toBe(drawn[0]);
    expect(harness.facesIn('block-1')[1]).toBe(drawn[1]);
  });

  it('redraws when a peer joins the block', () => {
    const harness = setup();

    harness.layer.render([peer(1, { name: 'Ada' })]);
    harness.layer.render([peer(1, { name: 'Ada' }), peer(2, { name: 'Bo' })]);

    expect(harness.facesIn('block-1')).toHaveLength(2);
  });

  it('redraws when a drawn peer is renamed', () => {
    const harness = setup();

    harness.layer.render([peer(1, { name: 'Ada' })]);
    harness.layer.render([peer(1, { name: 'Zed' })]);

    expect(harness.facesIn('block-1')[0]?.getAttribute(INITIALS_ATTR)).toBe('Z');
  });

  it('redraws when a peer swaps silhouette', () => {
    const harness = setup();

    harness.layer.render([peer(1, { name: '', glyph: 'mask-one' })]);
    harness.layer.render([peer(1, { name: '', glyph: 'mask-two' })]);

    expect(harness.facesIn('block-1')[0]?.getAttribute(GLYPH_ATTR)).toBe('mask-two');
  });

  it('does not confuse a peer wearing this exact silhouette with one wearing none', () => {
    const harness = setup();

    // The signature marks "no silhouette" with a value, and that value is
    // compared against real ones. `glyph` is a plain `string | null`, so every
    // string is a legal silhouette: a marker that some peer can wear makes two
    // different peers look like the same strip and skips the redraw.
    harness.layer.render([peer(1, { name: '', glyph: null })]);
    harness.layer.render([peer(1, { name: '', glyph: SILHOUETTE_MARKER })]);

    expect(harness.facesIn('block-1')[0]?.getAttribute(GLYPH_ATTR)).toBe(SILHOUETTE_MARKER);
  });

  it('redraws when the head count climbs past the cap', () => {
    const harness = setup({ maxFaces: 3 });

    harness.layer.render(crowd(4));
    expect(harness.overflowOf('block-1')?.getAttribute(INITIALS_ATTR)).toBe('+1');

    harness.layer.render(crowd(5));

    // The count is part of what the strip draws: a stale "+1" beside a block
    // that now holds five people is a wrong number, not a cosmetic diff.
    expect(harness.overflowOf('block-1')?.getAttribute(INITIALS_ATTR)).toBe('+2');
  });

  it('never mistakes a name for a part boundary', () => {
    const harness = setup();

    // Two nameless peers spell "1:<colour>::2:<colour>::" once their parts run
    // together. That is exactly what ONE peer named after the format's own
    // delimiters spells too. The signature joins with NUL so the two cannot
    // collide — without a separator this client would skip the redraw and leave
    // two strangers on the strip where one peer is working.
    harness.layer.render([peer(1, { name: '' }), peer(2, { name: '' })]);

    expect(harness.facesIn('block-1')).toHaveLength(2);

    harness.layer.render([peer(1, { name: `2:${COLOR}::` })]);

    expect(harness.facesIn('block-1')).toHaveLength(1);
    expect(harness.facesIn('block-1')[0]?.getAttribute(INITIALS_ATTR)).toBe('2');
  });
});

describe('avatar layer — the overflow face', () => {
  it('counts nobody when everybody fits', () => {
    const harness = setup();

    harness.layer.render([peer(1, { name: 'Ada' })]);

    // "+-2" beside a lone peer would be a count of a crowd that is not there.
    expect(harness.overflowOf('block-1')).toBeNull();

    harness.layer.render(crowd(3));

    // Exactly at the cap nobody is hidden, so "+0" is not a count.
    expect(harness.facesIn('block-1')).toHaveLength(3);
    expect(harness.overflowOf('block-1')).toBeNull();
  });
});

describe('avatar layer — measurement, and its fallbacks', () => {
  it('centres the strip on the measured line', () => {
    const harness = setup();
    const wrapper = harness.holderOf('block-1').querySelector('[data-blok-element-content]');

    vi.spyOn(wrapper as Element, 'getBoundingClientRect').mockReturnValue(rect(300, 48));
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(rect(310, 20));

    harness.layer.render([peer(1)]);

    // Line centre 320 is 20 below the wrapper's top, and the strip is twice
    // that tall with the face centred inside it.
    expect(harness.gutterOf('block-1')?.style.height).toBe('40px');
  });

  it('falls back to one body line when the measured line has no height', () => {
    const harness = setup();

    // An empty paragraph's collapsed Range measures zero in every engine. A
    // zero-height line would place the face ON the wrapper's edge.
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(rect(0, 0));

    harness.layer.render([peer(1)]);

    expect(harness.gutterOf('block-1')?.style.height).toBe('24px');
  });

  it('falls back to one body line when nobody can measure the block', () => {
    const holder = makeHolder('lone-block');
    const layer = createAvatarLayer({ resolveHolder: (blockId) => (blockId === 'lone-block' ? holder : null) });

    layers.push(layer);

    // `resolveInputs` is the optional half of the layer: a host that draws
    // block-level presence alone never supplies it, and asking it anyway throws
    // before the strip is ever placed.
    expect(() => layer.render([peer(1, { blockId: 'lone-block' })])).not.toThrow();
    expect(holder.querySelector<HTMLElement>(`[${GUTTER_ATTR}]`)?.style.height).toBe('24px');
  });
});

describe('avatar layer — the two lookups of a holder', () => {
  it('never asks about a peer who named no block', () => {
    const holder = makeHolder('block-1');
    const resolveHolder = vi.fn((_blockId: string): HTMLElement | null => holder);
    const layer = createAvatarLayer({ resolveHolder });

    layers.push(layer);
    layer.render([peer(1, { blockId: null })]);

    // An id that does not exist must not reach the resolver at all — and the
    // pass must not park a strip anywhere for it.
    expect(resolveHolder).not.toHaveBeenCalled();
    expect(document.querySelectorAll(`[${GUTTER_ATTR}]`)).toHaveLength(0);
  });

  it('drops a block the resolver answered null for, without a second look', () => {
    const holder = makeHolder('block-1');
    const resolveHolder = vi.fn((_blockId: string): HTMLElement | null => holder);

    resolveHolder.mockReturnValueOnce(null);

    const layer = createAvatarLayer({ resolveHolder });

    layers.push(layer);
    layer.render([peer(1)]);

    // The grouping pass asked once and was told the block is not here. The
    // paint pass must not ask again — a holder that appeared in between is
    // somebody else's pass to draw.
    expect(resolveHolder).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(`[${GUTTER_ATTR}]`)).toHaveLength(0);
  });

  it('drops a block whose holder vanished between the two passes', () => {
    const holder = makeHolder('block-1');
    const resolveHolder = vi.fn((_blockId: string): HTMLElement | null => null);

    resolveHolder.mockReturnValueOnce(holder);

    const layer = createAvatarLayer({ resolveHolder });

    layers.push(layer);
    layer.render([peer(1)]);

    // The block was deleted between the two lookups — the pass must leave
    // rather than decorate a holder that is no longer there.
    expect(holder.querySelector(`[${GUTTER_ATTR}]`)).toBeNull();
  });
});

describe('avatar layer — re-mounting', () => {
  it('slides the strip into a wrapper that replaced the old one', () => {
    const harness = setup();

    harness.layer.render([peer(1)]);

    const holder = harness.holderOf('block-1');

    // The block re-rendered: its wrapper, and the strip inside it, are gone.
    holder.replaceChildren();
    harness.layer.render([peer(1)]);

    // A strip still parked in a detached branch is a face nobody can see.
    expect(harness.gutterOf('block-1')).not.toBeNull();
    expect(harness.gutterOf('block-1')?.parentElement).toBe(holder);
  });

  it('mounts exactly one strip for a block whose peers leave and come back', () => {
    const harness = setup();

    harness.layer.render([peer(1)]);
    harness.layer.render([]);
    harness.layer.render([peer(1)]);

    // The block left the ledger when the sweep took its strip down, so the
    // return trip builds a strip that is IN the document — and the ledger
    // holds one entry per live block, never a second one pointing at the
    // element the sweep already detached.
    expect(document.querySelectorAll(`[${GUTTER_ATTR}]`)).toHaveLength(1);
    expect(harness.gutterOf('block-1')).toBe(document.querySelector(`[${GUTTER_ATTR}]`));
  });

  it('mounts a fresh strip after clear, and only that one', () => {
    const harness = setup();

    harness.layer.render([peer(1), peer(2, { blockId: 'block-2' })]);
    harness.layer.clear();
    harness.layer.render([peer(1)]);

    // `clear` drops the ledger as well as the elements: a strip it took down is
    // not a strip this pass may hand back.
    expect(document.querySelectorAll(`[${GUTTER_ATTR}]`)).toHaveLength(1);
    expect(harness.gutterOf('block-1')).toBe(document.querySelector(`[${GUTTER_ATTR}]`));
  });
});
