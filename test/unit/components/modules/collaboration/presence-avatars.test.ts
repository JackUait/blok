/**
 * Gutter avatars — the other half of the Notion shape.
 *
 * Notion parks a peer's face in the page margin beside the block they are
 * working in, and moves it as they move. The caret says WHERE in the sentence;
 * the face says WHO, which is why the caret carries no name of its own.
 *
 * Same two guarantees as the caret layer: everything is written on the block
 * HOLDER (never at or below a tool root, per the child-holder decoration law),
 * and every field arrived from another browser, so a name only reaches the DOM
 * as an attribute value and a colour only through the hex gate. A third one is
 * this layer's own: the strip sits INSIDE the holder, so it contributes no
 * text nodes — a copied block carries every text node its holder has.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAvatarLayer,
  type AvatarLayer,
  type AvatarPeer,
} from '../../../../../src/components/modules/collaboration/presence-avatars';

const GUTTER_ATTR = 'data-blok-presence-gutter';
const FACE_ATTR = 'data-blok-presence-face';
const INITIALS_ATTR = 'data-blok-presence-initials';
const COLOR_PROPERTY = '--blok-presence-color';

interface Harness {
  layer: AvatarLayer;
  holderOf: (blockId: string) => HTMLElement;
  toolRootOf: (blockId: string) => HTMLElement;
  facesIn: (blockId: string) => HTMLElement[];
  gutterOf: (blockId: string) => HTMLElement | null;
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
    toolRootOf: (blockId) => {
      const toolRoot = holderOf(blockId).querySelector<HTMLElement>('[data-blok-tool]');

      if (toolRoot === null) {
        throw new Error(`no tool root for ${blockId}`);
      }

      return toolRoot;
    },
    facesIn: (blockId) => Array.from(holderOf(blockId).querySelectorAll<HTMLElement>(`[${FACE_ATTR}]`)),
    gutterOf: (blockId) => holderOf(blockId).querySelector<HTMLElement>(`[${GUTTER_ATTR}]`),
  };
};

const peer = (clientId: number, overrides: Partial<AvatarPeer> = {}): AvatarPeer => ({
  clientId,
  name: 'Ada Lovelace',
  color: '#0b6e99',
  blockId: 'block-1',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  layers.splice(0).forEach((layer) => layer.clear());
  mounted.splice(0).forEach((holder) => holder.remove());
  vi.restoreAllMocks();
});

describe('avatar layer — what it draws', () => {
  it('parks a face on the holder of the block the peer is in', () => {
    const harness = setup();

    harness.layer.render([peer(1)]);

    expect(harness.facesIn('block-1')).toHaveLength(1);
    expect(harness.facesIn('block-2')).toHaveLength(0);
  });

  it('writes on the content wrapper, never inside the tool root', () => {
    const harness = setup();
    const toolRoot = harness.toolRootOf('block-1');
    const before = toolRoot.outerHTML;

    harness.layer.render([peer(1)]);

    const wrapper = harness.holderOf('block-1').querySelector('[data-blok-element-content]');

    // The child-holder decoration law blesses the holder AND its content
    // wrapper; the wrapper is the one that marks the content edge, and the
    // holder spans the whole editor. A face inside the tool root would land in
    // a save and in a copied selection.
    expect(toolRoot.outerHTML).toBe(before);
    expect(harness.gutterOf('block-1')?.parentElement).toBe(wrapper);
  });

  it('mounts on its own wrapper, not a nested child block\'s', () => {
    const harness = setup();
    const holder = harness.holderOf('block-1');
    const childHolder = document.createElement('div');
    const childWrapper = document.createElement('div');

    childHolder.setAttribute('data-blok-element', '');
    childWrapper.setAttribute('data-blok-element-content', '');
    childHolder.appendChild(childWrapper);
    holder.querySelector('[data-blok-element-content]')?.appendChild(childHolder);

    harness.layer.render([peer(1)]);

    // A container's holder also contains its CHILDREN's wrappers, so an
    // unscoped lookup could park the face inside the wrong block.
    expect(childWrapper.querySelector(`[${GUTTER_ATTR}]`)).toBeNull();
    expect(harness.gutterOf('block-1')?.parentElement)
      .toBe(holder.querySelector(':scope > [data-blok-element-content]'));
  });

  it('shows a monogram, not the whole name', () => {
    const harness = setup();

    harness.layer.render([peer(1, { name: 'Ada Lovelace' })]);

    const [face] = harness.facesIn('block-1');

    // Blok's presence identity is a name and a colour — there is no photo to
    // show, so the initials stand in for one. They ride an ATTRIBUTE that the
    // stylesheet paints, never a text node: the strip lives inside the holder,
    // and a copied block carries every text node the holder has.
    expect(face?.getAttribute(INITIALS_ATTR)).toBe('AL');
    expect(face?.textContent).toBe('');
  });

  it('leaves the holder text exactly as the tool wrote it', () => {
    const harness = setup({ maxFaces: 2 });
    const crowd = [1, 2, 3, 4, 5].map((id) => peer(id, { name: `Peer ${id}` }));

    harness.layer.render(crowd);

    expect(harness.facesIn('block-1')).toHaveLength(2);
    expect(harness.holderOf('block-1').textContent).toBe('hello world');
  });

  it('names the peer in a title, so hovering identifies them', () => {
    const harness = setup();

    harness.layer.render([peer(1, { name: 'Ada Lovelace' })]);

    expect(harness.facesIn('block-1')[0]?.getAttribute('title')).toBe('Ada Lovelace');
  });

  it('carries the peer colour as a custom property', () => {
    const harness = setup();

    harness.layer.render([peer(1, { color: '#c1461f' })]);

    expect(harness.facesIn('block-1')[0]?.style.getPropertyValue(COLOR_PROPERTY)).toBe('#c1461f');
  });

  it('draws an anonymous peer as their colour alone', () => {
    const harness = setup();

    harness.layer.render([peer(1, { name: '' })]);

    const [face] = harness.facesIn('block-1');

    // `collaboration.user` is optional, so a nameless peer is the DEFAULT
    // configuration. They still get a face; it just has no monogram and no
    // tooltip claiming an empty name.
    expect(face).toBeDefined();
    expect(face?.hasAttribute(INITIALS_ATTR)).toBe(false);
    expect(face?.hasAttribute('title')).toBe(false);
  });

  it('writes a hostile name as text, never as markup', () => {
    const harness = setup();
    const hostile = '<img src=x onerror=alert(1)>';

    harness.layer.render([peer(1, { name: hostile })]);

    const [face] = harness.facesIn('block-1');

    expect(face?.querySelector('img')).toBeNull();
    expect(face?.getAttribute('title')).toBe(hostile);
  });
});

describe('avatar layer — vertical placement', () => {
  it('centres the face on the block\'s first line, not on its box', () => {
    const harness = setup();

    // A block's first line does not start at the top of its wrapper: there is
    // half-leading above it, and a heading's line is far taller than a
    // paragraph's, so no fixed offset is right for both.
    vi.spyOn(harness.holderOf('block-1').querySelector('[data-blok-element-content]') as Element,
      'getBoundingClientRect').mockReturnValue({
        left: 0, top: 175, height: 48, right: 0, bottom: 223, width: 0, x: 0, y: 175,
        toJSON: () => ({}),
      });
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 184, height: 20, right: 0, bottom: 204, width: 0, x: 0, y: 184,
      toJSON: () => ({}),
    });

    harness.layer.render([peer(1)]);

    // Line centre is 194, which is 19 below the wrapper top — so a strip twice
    // that tall, with the face centred in it, lands the face on the line.
    expect(harness.gutterOf('block-1')?.style.height).toBe('38px');
  });

  it('falls back to a line-height box when the block has no text to measure', () => {
    const harness = setup();

    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, height: 0, right: 0, bottom: 0, width: 0, x: 0, y: 0,
      toJSON: () => ({}),
    });

    harness.layer.render([peer(1)]);

    // An empty block measures nothing in every engine. The strip still has to
    // be somewhere sane rather than collapsing to zero.
    expect(harness.gutterOf('block-1')?.style.height).not.toBe('0px');
  });
});

describe('avatar layer — several peers', () => {
  it('stacks every peer working in one block', () => {
    const harness = setup();

    harness.layer.render([
      peer(1, { name: 'Ada' }),
      peer(2, { name: 'Bo', color: '#c1461f' }),
    ]);

    // One gutter per block, one face per person in it — two people editing the
    // same paragraph is exactly what presence exists to show.
    expect(harness.gutterOf('block-1')).not.toBeNull();
    expect(harness.facesIn('block-1')).toHaveLength(2);
  });

  it('caps the faces and counts the rest', () => {
    const harness = setup({ maxFaces: 2 });
    const crowd = [1, 2, 3, 4, 5].map((id) => peer(id, { name: `P${id}` }));

    harness.layer.render(crowd);

    expect(harness.facesIn('block-1')).toHaveLength(2);
    expect(harness.gutterOf('block-1')?.querySelector('[data-blok-presence-face-overflow]')?.getAttribute(INITIALS_ATTR))
      .toBe('+3');
  });

  it('keeps the gutter element across renders, so faces do not flicker', () => {
    const harness = setup();

    harness.layer.render([peer(1)]);

    const first = harness.gutterOf('block-1');

    harness.layer.render([peer(1), peer(2, { name: 'Bo' })]);

    expect(harness.gutterOf('block-1')).toBe(first);
  });
});

describe('avatar layer — what it refuses to draw', () => {
  it('draws nothing for a peer with no block', () => {
    const harness = setup();

    harness.layer.render([peer(1, { blockId: null })]);

    expect(harness.facesIn('block-1')).toHaveLength(0);
  });

  it('draws nothing for a block this client does not have', () => {
    const harness = setup();

    // Ordinary: the peer is ahead of us, or in a block we just deleted.
    harness.layer.render([peer(1, { blockId: 'block-missing' })]);

    expect(document.querySelectorAll(`[${FACE_ATTR}]`)).toHaveLength(0);
  });
});

describe('avatar layer — teardown', () => {
  it('takes the gutter down when the last peer leaves a block', () => {
    const harness = setup();

    harness.layer.render([peer(1)]);
    harness.layer.render([]);

    expect(harness.gutterOf('block-1')).toBeNull();
  });

  it('moves the face with the peer, leaving nothing behind', () => {
    const harness = setup();

    harness.layer.render([peer(1)]);
    harness.layer.render([peer(1, { blockId: 'block-2' })]);

    expect(harness.gutterOf('block-1')).toBeNull();
    expect(harness.facesIn('block-2')).toHaveLength(1);
  });

  it('leaves the holder exactly as it found it', () => {
    const harness = setup();
    const holder = harness.holderOf('block-1');
    const before = holder.outerHTML;

    harness.layer.render([peer(1)]);
    harness.layer.clear();

    expect(holder.outerHTML).toBe(before);
  });
});
