/**
 * Mutant-facing tests for the remote-caret layer.
 *
 * Where presence-carets.test.ts states the contract in prose, this file pins the
 * exact VALUES a mutant would nudge: the attribute names and their empty-string
 * values, the pixel arithmetic behind the hover reach, and which timer a peer's
 * caret owns. Every fixture carries distinct text so a wrong node cannot compare
 * structurally equal to the right one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CaretPosition } from '../../../../../src/components/modules/collaboration/caret-position';
import {
  createCaretLayer,
  type CaretLayer,
  type CaretPeer,
} from '../../../../../src/components/modules/collaboration/presence-carets';

const CARET_ATTR = 'data-blok-presence-caret';
const IDLE_ATTR = 'data-blok-presence-caret-idle';
const LABEL_ATTR = 'data-blok-presence-caret-label';
const SHOWN_ATTR = 'data-blok-presence-caret-shown';
const COLOR_PROPERTY = '--blok-presence-color';

interface Box {
  left: number;
  top: number;
  height: number;
}

/** The holder the caret is placed against: 100px in, 200px down. */
const HOLDER_BOX: Box = { left: 100, top: 200, height: 40 };

/**
 * The measured line, in viewport coordinates. Subtracting the holder box puts
 * the caret at left 40, top 10 with height 18 — the numbers the hover reach is
 * measured against, and the reason the two boxes must not be equal.
 */
const LINE_BOX: Box = { left: 140, top: 210, height: 18 };
const CARET_LEFT = 40;
const CARET_TOP = 10;
const CARET_HEIGHT = 18;

const rectOf = (box: Box): DOMRect => ({
  left: box.left,
  top: box.top,
  height: box.height,
  right: box.left,
  bottom: box.top + box.height,
  width: 0,
  x: box.left,
  y: box.top,
  toJSON: () => ({}),
});

interface Harness {
  layer: CaretLayer;
  holderOf: (blockId: string) => HTMLElement;
  caretsIn: (blockId: string) => HTMLElement[];
  labelsIn: (blockId: string) => HTMLElement[];
  stubRect: (element: Element, box: Box) => void;
}

const layers: CaretLayer[] = [];
const mounted: HTMLElement[] = [];

/** A block's real nesting, with one distinct text per editable field. */
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

    input.setAttribute('contenteditable', 'true');
    input.textContent = `field ${index} of ${blockId}`;
    toolRoot.appendChild(input);
  }

  content.appendChild(toolRoot);
  holder.appendChild(content);
  document.body.appendChild(holder);
  mounted.push(holder);

  return holder;
};

const setup = (
  options: { blockIds?: string[]; inputCount?: number; restAfterMs?: number; greetForMs?: number } = {}
): Harness => {
  const holders = new Map<string, HTMLElement>();

  (options.blockIds ?? ['block-1', 'block-2']).forEach((blockId) => {
    holders.set(blockId, makeHolder(blockId, options.inputCount ?? 1));
  });

  const inputsOf = (blockId: string): HTMLElement[] =>
    Array.from(holders.get(blockId)?.querySelectorAll<HTMLElement>('[contenteditable="true"]') ?? []);

  const layer = createCaretLayer({
    resolveHolder: (blockId) => holders.get(blockId) ?? null,
    resolveInputs: inputsOf,
    restAfterMs: options.restAfterMs,
    greetForMs: options.greetForMs,
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
    caretsIn: (blockId) => Array.from(holderOf(blockId).querySelectorAll<HTMLElement>(`[${CARET_ATTR}]`)),
    labelsIn: (blockId) => Array.from(holderOf(blockId).querySelectorAll<HTMLElement>(`[${LABEL_ATTR}]`)),
    stubRect: (element, box) => {
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rectOf(box));
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
  name: 'Ada Lovelace',
  color: '#0b6e99',
  caret: at('block-1', 3),
  ...overrides,
});

/** A pointer move at holder-relative coordinates, so the holder offset matters. */
const pointerMove = (holder: HTMLElement, relLeft: number, relTop: number): MouseEvent => {
  const box = holder.getBoundingClientRect();

  return new MouseEvent('pointermove', {
    clientX: box.left + relLeft,
    clientY: box.top + relTop,
    bubbles: true,
  });
};

/**
 * Draw one named peer on a stubbed holder, let the arrival greeting expire, then
 * point at the caret at the given holder-relative spot. Returns whether the name
 * flag is up afterwards.
 */
const flagAfterPointingAt = (relLeft: number, relTop: number): boolean => {
  const harness = setup({ greetForMs: 1000 });

  harness.stubRect(harness.holderOf('block-1'), HOLDER_BOX);
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(rectOf(LINE_BOX));

  harness.layer.render([peer(1, { name: 'Ada Lovelace' })]);
  vi.advanceTimersByTime(1000);

  const holder = harness.holderOf('block-1');

  holder.dispatchEvent(pointerMove(holder, relLeft, relTop));

  return harness.labelsIn('block-1')[0]?.hasAttribute(SHOWN_ATTR) ?? false;
};

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

describe('caret layer — the marks it writes', () => {
  it('writes the caret attribute with an empty value, and no other marks', () => {
    const harness = setup();

    harness.layer.render([peer(1)]);

    const [caret] = harness.caretsIn('block-1');

    expect(caret?.getAttribute(CARET_ATTR)).toBe('');
    expect(caret?.getAttributeNames().sort()).toEqual([
      'aria-hidden',
      'contenteditable',
      'data-blok-presence-caret',
      'style',
    ]);
  });

  it('writes the idle attribute with an empty value once the peer rests', () => {
    const harness = setup({ restAfterMs: 2000 });

    harness.layer.render([peer(1)]);
    vi.advanceTimersByTime(2000);

    const [caret] = harness.caretsIn('block-1');

    expect(caret?.getAttribute(IDLE_ATTR)).toBe('');
  });

  it('writes the shown attribute with an empty value while the flag is up', () => {
    const harness = setup();

    harness.layer.render([peer(1, { name: 'Ada Lovelace' })]);

    const [label] = harness.labelsIn('block-1');

    expect(label?.getAttribute(LABEL_ATTR)).toBe('Ada Lovelace');
    expect(label?.getAttribute(SHOWN_ATTR)).toBe('');
  });

  it('places and colours the name flag at the caret it belongs to', () => {
    const harness = setup();

    harness.stubRect(harness.holderOf('block-1'), HOLDER_BOX);
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(rectOf(LINE_BOX));

    harness.layer.render([peer(1, { name: 'Ada Lovelace', color: '#c1461f' })]);

    const [label] = harness.labelsIn('block-1');

    expect(label?.style.left).toBe(`${CARET_LEFT}px`);
    expect(label?.style.top).toBe(`${CARET_TOP}px`);
    expect(label?.style.getPropertyValue(COLOR_PROPERTY)).toBe('#c1461f');
  });
});

describe('caret layer — the hover reach', () => {
  it('keeps the flag down for a pointer far to the side, level with the caret', () => {
    // 200px to the side is past the 12px reach however the vertical bounds fall.
    expect(flagAfterPointingAt(200, 20)).toBe(false);
  });

  it('brings the flag up at exactly the hover reach to the side of the caret', () => {
    expect(flagAfterPointingAt(CARET_LEFT + 12, 20)).toBe(true);
  });

  it('brings the flag up for a pointer level with the caret', () => {
    expect(flagAfterPointingAt(CARET_LEFT, 20)).toBe(true);
  });

  it('brings the flag up at exactly the hover reach above the caret', () => {
    expect(flagAfterPointingAt(CARET_LEFT, CARET_TOP - 12)).toBe(true);
  });

  it('keeps the flag down for a pointer above the caret, past the reach', () => {
    expect(flagAfterPointingAt(CARET_LEFT, CARET_TOP - 12 - 1)).toBe(false);
  });

  it('brings the flag up at exactly the hover reach below the caret line', () => {
    expect(flagAfterPointingAt(CARET_LEFT, CARET_TOP + CARET_HEIGHT + 12)).toBe(true);
  });

  it('keeps the flag down for a pointer below the caret line, past the reach', () => {
    expect(flagAfterPointingAt(CARET_LEFT, CARET_TOP + CARET_HEIGHT + 12 + 1)).toBe(false);
  });
});

describe('caret layer — greeting timing', () => {
  it('keeps the flag up for exactly the greet window it was given', () => {
    const harness = setup({ greetForMs: 1 });

    harness.layer.render([peer(1, { name: 'Ada Lovelace' })]);

    const [label] = harness.labelsIn('block-1');

    expect(label?.hasAttribute(SHOWN_ATTR)).toBe(true);

    vi.advanceTimersByTime(1);

    // A window that ran out has to take the flag down on its own, without a
    // pointer move to trigger it.
    expect(label?.hasAttribute(SHOWN_ATTR)).toBe(false);
  });
});

describe('caret layer — the timers a drawn caret owns', () => {
  it('cancels the rest timer when the caret comes down', () => {
    const harness = setup({ restAfterMs: 2000 });

    harness.layer.render([peer(1)]);

    const [caret] = harness.caretsIn('block-1');

    harness.layer.clear();
    vi.advanceTimersByTime(5000);

    // A timer firing against a removed caret is a ghost nobody asked for.
    expect(caret?.hasAttribute(IDLE_ATTR)).toBe(false);
  });

  it('cancels the greet timer when the caret comes down', () => {
    const harness = setup({ greetForMs: 2000 });

    harness.layer.render([peer(1, { name: 'Ada Lovelace' })]);

    const [label] = harness.labelsIn('block-1');

    harness.layer.clear();
    vi.advanceTimersByTime(5000);

    // Same timer, same reason: the flag belongs to a caret that is gone.
    expect(label?.hasAttribute(SHOWN_ATTR)).toBe(true);
  });

  it('restarts the rest timer rather than leaving the old one running', () => {
    const harness = setup({ restAfterMs: 2000 });

    harness.layer.render([peer(1)]);
    vi.advanceTimersByTime(1000);
    harness.layer.render([peer(1, { caret: at('block-1', 9) })]);

    vi.advanceTimersByTime(1000);

    // The first timer was due here; the caret moved, so it must have been
    // replaced by one that starts counting from the move.
    expect(harness.caretsIn('block-1')[0]?.hasAttribute(IDLE_ATTR)).toBe(false);

    vi.advanceTimersByTime(1000);

    expect(harness.caretsIn('block-1')[0]?.hasAttribute(IDLE_ATTR)).toBe(true);
  });

  it('stops watching the holder once the caret is taken down', () => {
    const harness = setup({ greetForMs: 1000 });

    harness.stubRect(harness.holderOf('block-1'), HOLDER_BOX);
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(rectOf(LINE_BOX));

    harness.layer.render([peer(1, { name: 'Ada Lovelace' })]);
    vi.advanceTimersByTime(1000);

    const [label] = harness.labelsIn('block-1');

    expect(label?.hasAttribute(SHOWN_ATTR)).toBe(false);

    harness.layer.render([]);
    expect(harness.caretsIn('block-1')).toHaveLength(0);

    const holder = harness.holderOf('block-1');

    holder.dispatchEvent(pointerMove(holder, CARET_LEFT, 20));

    // Nobody is watching for this caret any more, so a pointer move where it
    // used to sit must leave the detached flag exactly as it was.
    expect(label?.hasAttribute(SHOWN_ATTR)).toBe(false);
  });
});

describe('caret layer — what clear() forgets', () => {
  it('rebuilds the caret after clear, rather than reusing a removed element', () => {
    const harness = setup();

    harness.layer.render([peer(1)]);
    harness.layer.clear();
    harness.layer.render([peer(1)]);

    expect(harness.caretsIn('block-1')).toHaveLength(1);
    expect(harness.caretsIn('block-1')[0]?.isConnected).toBe(true);
  });

  it('greets a peer again after clear, rather than remembering the greeting', () => {
    const harness = setup({ greetForMs: 1000 });

    harness.layer.render([peer(1, { name: 'Ada Lovelace' })]);
    vi.advanceTimersByTime(1000);
    harness.layer.clear();
    harness.layer.render([peer(1, { name: 'Ada Lovelace' })]);

    expect(harness.labelsIn('block-1')[0]?.hasAttribute(SHOWN_ATTR)).toBe(true);
  });

  it('keeps no peer list through clear, so reposition draws nothing', () => {
    const harness = setup();

    harness.layer.render([peer(1)]);
    harness.layer.clear();

    expect(() => harness.layer.reposition()).not.toThrow();
    expect(document.querySelectorAll(`[${CARET_ATTR}]`)).toHaveLength(0);
  });

  it('repositions nothing before any peer has been drawn', () => {
    const harness = setup();

    expect(() => harness.layer.reposition()).not.toThrow();
    expect(document.querySelectorAll(`[${CARET_ATTR}]`)).toHaveLength(0);
  });
});
