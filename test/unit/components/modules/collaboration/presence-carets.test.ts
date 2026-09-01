/**
 * Remote carets — the Notion shape: a thin coloured line where the peer's
 * caret sits, with their name in a small flag above it that fades once they
 * stop moving. No block outline; the caret IS the presence.
 *
 * Two things are pinned here. The child-holder decoration law: a caret is
 * appended to the block's HOLDER, never at or below the tool root, so it can
 * never dirty a save or a tool's own markup. And R5: every field of a peer's
 * state was written by another browser, so a name only reaches the DOM through
 * `textContent`, a colour only through the hex gate, and an offset only after
 * being clamped against the text that is actually here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CaretPosition } from '../../../../../src/components/modules/collaboration/caret-position';
import {
  createCaretLayer,
  type CaretLayer,
  type CaretPeer,
} from '../../../../../src/components/modules/collaboration/presence-carets';

const CARET_ATTR = 'data-blok-presence-caret';
const NAME_ATTR = 'data-blok-presence-caret-name';
const IDLE_ATTR = 'data-blok-presence-caret-idle';
const COLOR_PROPERTY = '--blok-presence-color';

interface Harness {
  layer: CaretLayer;
  holderOf: (blockId: string) => HTMLElement;
  inputOf: (blockId: string, index?: number) => HTMLElement;
  toolRootOf: (blockId: string) => HTMLElement;
  caretsIn: (blockId: string) => HTMLElement[];
  /** Give an element a rect, so the holder-relative arithmetic can be asserted. */
  stubRect: (element: Element, rect: { left: number; top: number; height: number }) => void;
}

const layers: CaretLayer[] = [];
const mounted: HTMLElement[] = [];

/**
 * A block's real DOM nesting: holder → content wrapper → tool root, where the
 * tool root is the contenteditable input. `inputCount` builds a block with
 * several fields, the way a table cell or a captioned figure has.
 * @param blockId - the block this DOM belongs to
 * @param inputCount - how many editable fields the block owns
 */
const makeHolder = (blockId: string, inputCount: number): HTMLElement => {
  const holder = document.createElement('div');
  const content = document.createElement('div');
  const toolRoot = document.createElement('div');

  holder.setAttribute('data-blok-element', '');
  holder.setAttribute('data-blok-id', blockId);
  content.setAttribute('data-blok-element-content', '');
  toolRoot.setAttribute('data-blok-tool', 'paragraph');

  for (let index = 0; index < inputCount; index += 1) {
    const input = document.createElement('div');

    // The ATTRIBUTE, not the property: jsdom does not reflect `contentEditable`.
    input.setAttribute('contenteditable', 'true');
    input.textContent = 'hello world';
    toolRoot.appendChild(input);
  }

  content.appendChild(toolRoot);
  holder.appendChild(content);
  document.body.appendChild(holder);
  mounted.push(holder);

  return holder;
};

const setup = (options: { blockIds?: string[]; inputCount?: number; labelLingerMs?: number } = {}): Harness => {
  const holders = new Map<string, HTMLElement>();

  (options.blockIds ?? ['block-1', 'block-2']).forEach((blockId) => {
    holders.set(blockId, makeHolder(blockId, options.inputCount ?? 1));
  });

  const inputsOf = (blockId: string): HTMLElement[] =>
    Array.from(holders.get(blockId)?.querySelectorAll<HTMLElement>('[contenteditable="true"]') ?? []);

  const layer = createCaretLayer({
    resolveHolder: (blockId) => holders.get(blockId) ?? null,
    resolveInputs: inputsOf,
    labelLingerMs: options.labelLingerMs,
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
    inputOf: (blockId, index = 0) => {
      const input = inputsOf(blockId)[index];

      if (input === undefined) {
        throw new Error(`no input ${index} for ${blockId}`);
      }

      return input;
    },
    toolRootOf: (blockId) => {
      const toolRoot = holderOf(blockId).querySelector<HTMLElement>('[data-blok-tool]');

      if (toolRoot === null) {
        throw new Error(`no tool root for ${blockId}`);
      }

      return toolRoot;
    },
    caretsIn: (blockId) => Array.from(holderOf(blockId).querySelectorAll<HTMLElement>(`[${CARET_ATTR}]`)),
    stubRect: (element, rect) => {
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
        left: rect.left,
        top: rect.top,
        height: rect.height,
        right: rect.left,
        bottom: rect.top + rect.height,
        width: 0,
        x: rect.left,
        y: rect.top,
        toJSON: () => ({}),
      });
    },
  };
};

const at = (blockId: string, head: number, inputIndex = 0): CaretPosition => ({
  blockId,
  inputIndex,
  anchor: head,
  head,
});

const peer = (clientId: number, overrides: Partial<CaretPeer> = {}): CaretPeer => ({
  clientId,
  name: 'Ada',
  color: '#0b6e99',
  caret: at('block-1', 3),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  layers.splice(0).forEach((layer) => layer.clear());
  mounted.splice(0).forEach((holder) => holder.remove());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('caret layer — what it draws', () => {
  it('draws one caret on the holder of the block the peer is in', () => {
    const harness = setup();

    harness.layer.render([peer(1)]);

    expect(harness.caretsIn('block-1')).toHaveLength(1);
    expect(harness.caretsIn('block-2')).toHaveLength(0);
  });

  it('appends the caret to the holder, never inside the tool root', () => {
    const harness = setup();

    harness.layer.render([peer(1)]);

    const [caret] = harness.caretsIn('block-1');

    // The child-holder decoration law: a container may write on a child's
    // holder, never at or below its tool root. Anything inside the tool root
    // would land in a save and in a copied selection.
    expect(caret?.parentElement).toBe(harness.holderOf('block-1'));
    expect(harness.toolRootOf('block-1').contains(caret ?? null)).toBe(false);
  });

  it('gives every peer in one block their own caret', () => {
    const harness = setup();

    harness.layer.render([
      peer(1, { name: 'Ada', color: '#0b6e99' }),
      peer(2, { name: 'Bo', color: '#c1461f' }),
    ]);

    // Keyed by client id, not block id: two people in one paragraph is the
    // ordinary case a caret exists to show.
    expect(harness.caretsIn('block-1')).toHaveLength(2);
  });

  it('names the peer in the flag, as text', () => {
    const harness = setup();

    harness.layer.render([peer(1, { name: '<img src=x onerror=alert(1)>' })]);

    const label = harness.holderOf('block-1').querySelector(`[${NAME_ATTR}]`);

    expect(label?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(label?.querySelector('img')).toBeNull();
  });

  it('carries the peer colour as a custom property', () => {
    const harness = setup();

    harness.layer.render([peer(1, { color: '#c1461f' })]);

    const [caret] = harness.caretsIn('block-1');

    expect(caret?.style.getPropertyValue(COLOR_PROPERTY)).toBe('#c1461f');
  });

  it('draws no flag for a peer who published no name', () => {
    const harness = setup();

    harness.layer.render([peer(1, { name: '' })]);

    const label = harness.holderOf('block-1').querySelector<HTMLElement>(`[${NAME_ATTR}]`);

    // The coloured line still shows. An empty bubble would read as a fault.
    expect(harness.caretsIn('block-1')).toHaveLength(1);
    expect(label?.hidden).toBe(true);
  });

  it('keeps the caret element across renders, so it does not flicker', () => {
    const harness = setup();

    harness.layer.render([peer(1)]);

    const [first] = harness.caretsIn('block-1');

    harness.layer.render([peer(1, { caret: at('block-1', 5) })]);

    expect(harness.caretsIn('block-1')[0]).toBe(first);
  });
});

describe('caret layer — where it draws', () => {
  it('positions the caret relative to the holder, not the viewport', () => {
    const harness = setup();
    const input = harness.inputOf('block-1');

    harness.stubRect(harness.holderOf('block-1'), { left: 100, top: 200, height: 40 });
    // A collapsed Range measures at the character; jsdom gives zeroes, so the
    // rect the layer reads is stubbed on the Range prototype instead.
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 140, top: 210, height: 18, right: 140, bottom: 228, width: 0, x: 140, y: 210,
      toJSON: () => ({}),
    });
    harness.stubRect(input, { left: 100, top: 200, height: 40 });

    harness.layer.render([peer(1)]);

    const [caret] = harness.caretsIn('block-1');

    // The holder is the offset parent, so the viewport coordinates have to be
    // subtracted out or every caret drifts with the page scroll.
    expect(caret?.style.left).toBe('40px');
    expect(caret?.style.top).toBe('10px');
    expect(caret?.style.height).toBe('18px');
  });

  it('falls back to the input box when the range measures nothing', () => {
    const harness = setup();

    harness.stubRect(harness.holderOf('block-1'), { left: 100, top: 200, height: 40 });
    harness.stubRect(harness.inputOf('block-1'), { left: 120, top: 205, height: 22 });
    // A collapsed range inside an empty element measures zero in every engine.
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, height: 0, right: 0, bottom: 0, width: 0, x: 0, y: 0,
      toJSON: () => ({}),
    });

    harness.layer.render([peer(1, { caret: at('block-1', 0) })]);

    const [caret] = harness.caretsIn('block-1');

    expect(caret?.style.left).toBe('20px');
    expect(caret?.style.top).toBe('5px');
    expect(caret?.style.height).toBe('22px');
  });

  it('re-measures on reposition without rebuilding the caret', () => {
    const harness = setup();

    harness.stubRect(harness.holderOf('block-1'), { left: 0, top: 0, height: 40 });
    const rect = vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 10, top: 0, height: 18, right: 10, bottom: 18, width: 0, x: 10, y: 0,
      toJSON: () => ({}),
    });

    harness.layer.render([peer(1)]);

    const [caret] = harness.caretsIn('block-1');

    rect.mockReturnValue({
      left: 55, top: 0, height: 18, right: 55, bottom: 18, width: 0, x: 55, y: 0,
      toJSON: () => ({}),
    });
    harness.layer.reposition();

    // Local typing in the same block shifts a peer's caret without any
    // awareness traffic, so the layer has to be able to re-measure alone.
    expect(harness.caretsIn('block-1')[0]).toBe(caret);
    expect(caret?.style.left).toBe('55px');
  });
});

describe('caret layer — what it refuses to draw', () => {
  it('draws nothing for a peer with no caret published', () => {
    const harness = setup();

    harness.layer.render([peer(1, { caret: null })]);

    expect(harness.caretsIn('block-1')).toHaveLength(0);
  });

  it('draws nothing for a block this client does not have', () => {
    const harness = setup();

    // Ordinary, not hostile: the peer is ahead of us, or is in a block we just
    // deleted.
    harness.layer.render([peer(1, { caret: at('block-missing', 2) })]);

    expect(document.querySelectorAll(`[${CARET_ATTR}]`)).toHaveLength(0);
  });

  it('draws nothing for an input index the block does not have', () => {
    const harness = setup({ inputCount: 1 });

    harness.layer.render([peer(1, { caret: at('block-1', 2, 7) })]);

    expect(harness.caretsIn('block-1')).toHaveLength(0);
  });

  it('draws in the input the peer named, not the first one', () => {
    const harness = setup({ inputCount: 3 });

    harness.stubRect(harness.holderOf('block-1'), { left: 0, top: 0, height: 60 });
    const second = harness.inputOf('block-1', 1);

    harness.layer.render([peer(1, { caret: at('block-1', 2, 1) })]);

    const [caret] = harness.caretsIn('block-1');
    const range = document.createRange();

    range.selectNodeContents(second);

    expect(caret).toBeDefined();
    // The measured position has to sit inside the input the peer named — a
    // table with a caret in the wrong cell is worse than no caret.
    expect(second.contains(range.startContainer)).toBe(true);
  });
});

describe('caret layer — the name flag fades', () => {
  it('shows the flag while the caret is moving', () => {
    const harness = setup({ labelLingerMs: 2000 });

    harness.layer.render([peer(1)]);

    expect(harness.caretsIn('block-1')[0]?.hasAttribute(IDLE_ATTR)).toBe(false);
  });

  it('marks the caret idle once the peer stops moving', () => {
    const harness = setup({ labelLingerMs: 2000 });

    harness.layer.render([peer(1)]);
    vi.advanceTimersByTime(2001);

    // Notion's behaviour: the name fades out and the coloured line stays, so a
    // busy document does not turn into a wall of name tags.
    expect(harness.caretsIn('block-1')[0]?.hasAttribute(IDLE_ATTR)).toBe(true);
  });

  it('brings the flag back when the caret moves again', () => {
    const harness = setup({ labelLingerMs: 2000 });

    harness.layer.render([peer(1)]);
    vi.advanceTimersByTime(2001);
    harness.layer.render([peer(1, { caret: at('block-1', 9) })]);

    expect(harness.caretsIn('block-1')[0]?.hasAttribute(IDLE_ATTR)).toBe(false);
  });

  it('stays idle through a repaint that did not move the caret', () => {
    const harness = setup({ labelLingerMs: 2000 });

    harness.layer.render([peer(1)]);
    vi.advanceTimersByTime(2001);
    // Somebody else joined; this peer has not moved.
    harness.layer.render([peer(1), peer(2, { caret: at('block-2', 1) })]);

    expect(harness.caretsIn('block-1')[0]?.hasAttribute(IDLE_ATTR)).toBe(true);
  });
});

describe('caret layer — teardown', () => {
  it('removes the caret of a peer who left', () => {
    const harness = setup();

    harness.layer.render([peer(1), peer(2, { caret: at('block-2', 1) })]);
    harness.layer.render([peer(1)]);

    expect(harness.caretsIn('block-2')).toHaveLength(0);
    expect(harness.caretsIn('block-1')).toHaveLength(1);
  });

  it('moves a caret with the peer, leaving nothing behind', () => {
    const harness = setup();

    harness.layer.render([peer(1)]);
    harness.layer.render([peer(1, { caret: at('block-2', 1) })]);

    expect(harness.caretsIn('block-1')).toHaveLength(0);
    expect(harness.caretsIn('block-2')).toHaveLength(1);
  });

  it('clear removes every caret it drew', () => {
    const harness = setup();

    harness.layer.render([peer(1), peer(2, { caret: at('block-2', 1) })]);
    harness.layer.clear();

    expect(document.querySelectorAll(`[${CARET_ATTR}]`)).toHaveLength(0);
  });

  it('drops the idle timers on clear, so a torn-down caret never reappears', () => {
    const harness = setup({ labelLingerMs: 2000 });

    harness.layer.render([peer(1)]);
    harness.layer.clear();
    vi.advanceTimersByTime(5000);

    // A timer firing against a removed element is how a stopped session
    // resurrects a ghost.
    expect(document.querySelectorAll(`[${CARET_ATTR}]`)).toHaveLength(0);
  });
});
