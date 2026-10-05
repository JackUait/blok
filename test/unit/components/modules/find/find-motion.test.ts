import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import {
  bloom,
  cornerOf,
  growFrames,
  HOP_DELAY,
  HOP_MS,
  hop,
  hopSourceFromRange,
  settleMs,
  springAt,
  springEasing,
  SPRINGS,
  stretch,
} from '../../../../../src/components/modules/find/find-motion';
import { prefersReducedMotion } from '../../../../../src/components/utils/reduced-motion';

const insetOf = (frame: Keyframe): number[] => {
  const match = String(frame.clipPath).match(/^inset\((\S+)px (\S+)px (\S+)px (\S+)px round (\S+)px\)$/);

  if (match === null) {
    throw new Error(`not an inset: ${String(frame.clipPath)}`);
  }

  return match.slice(1).map(Number);
};

describe('find-motion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('springs', () => {
    it('start at rest, overshoot when underdamped, and settle at 1', () => {
      const spring = SPRINGS.bouncy;
      const samples = Array.from({ length: 200 }, (_, i) => springAt(spring, (settleMs(spring) / 1000) * (i / 199)));

      expect(springAt(spring, 0)).toBe(0);
      expect(Math.max(...samples)).toBeGreaterThan(1.02);
      expect(Math.abs(1 - samples[samples.length - 1])).toBeLessThan(0.002);
    });

    it('never overshoot when critically damped or more', () => {
      const spring = { stiffness: 100, damping: 40 };
      const samples = Array.from({ length: 100 }, (_, i) => springAt(spring, i / 50));

      expect(Math.max(...samples)).toBeLessThanOrEqual(1);
    });

    it('turn into a CSS linear() easing that ends exactly at 1', () => {
      const { easing, duration } = springEasing(SPRINGS.soft);

      expect(easing.startsWith('linear(0,')).toBe(true);
      expect(easing.endsWith(', 1)')).toBe(true);
      expect(duration).toBe(settleMs(SPRINGS.soft));
      expect(duration).toBeGreaterThan(300);
      expect(duration).toBeLessThan(1500);
    });
  });

  describe('cornerOf', () => {
    it.each([
      ['top-end', false, { block: 'top', inline: 'right' }],
      ['top-end', true, { block: 'top', inline: 'left' }],
      ['top-start', false, { block: 'top', inline: 'left' }],
      ['top-start', true, { block: 'top', inline: 'right' }],
      ['bottom-start', false, { block: 'bottom', inline: 'left' }],
      ['bottom-end', true, { block: 'bottom', inline: 'left' }],
      ['top-center', false, { block: 'top', inline: 'center' }],
      ['bottom-center', true, { block: 'bottom', inline: 'center' }],
    ] as const)('%s (rtl %s) grows from %o', (placement, rtl, corner) => {
      expect(cornerOf(placement, rtl)).toEqual(corner);
    });
  });

  describe('growFrames', () => {
    const full = { width: 470, height: 44 };
    const dot = { width: 40, height: 40 };
    const options = { springs: { width: SPRINGS.wide, height: SPRINGS.tall }, radius: { from: 20, to: 14 } };

    it('starts as the dot in the top-right corner and ends as the full box', () => {
      const { skin, clip } = growFrames(full, dot, { block: 'top', inline: 'right' }, options);

      expect(skin[0]).toMatchObject({ left: '430px', top: '0px', width: '40px', height: '40px', borderRadius: '20px' });
      expect(insetOf(clip[0])).toEqual([0, 0, 4, 430, 20]);
      expect(skin[skin.length - 1]).toMatchObject({ left: '0px', top: '0px', width: '470px', height: '44px', borderRadius: '14px' });
      expect(insetOf(clip[clip.length - 1])).toEqual([0, 0, 0, 0, 14]);
    });

    it('anchors the dot at the bottom-left for a bottom-start bar', () => {
      const { skin, clip } = growFrames(full, dot, { block: 'bottom', inline: 'left' }, options);

      expect(skin[0]).toMatchObject({ left: '0px', top: '4px' });
      expect(insetOf(clip[0])).toEqual([4, 430, 0, 0, 20]);
    });

    it('centres the dot for a centred bar', () => {
      const { skin } = growFrames(full, dot, { block: 'top', inline: 'center' }, options);

      expect(skin[0]).toMatchObject({ left: '215px' });
    });

    it('overshoots the full width on the way, the skin and clip in step', () => {
      const { skin, clip } = growFrames(full, dot, { block: 'top', inline: 'right' }, options);
      const widest = Math.max(...skin.map((frame) => parseFloat(String(frame.width))));
      const widestIndex = skin.findIndex((frame) => parseFloat(String(frame.width)) === widest);

      expect(widest).toBeGreaterThan(full.width);
      // A wider skin than the box means a negative left inset on the clip.
      expect(insetOf(clip[widestIndex])[3]).toBeLessThan(0);
    });

    it('pinches the width in early when asked, and ends at full width', () => {
      const from = { width: 470, height: 44 };
      const to = { width: 470, height: 84 };
      const { skin } = growFrames(to, from, { block: 'top', inline: 'right' }, { ...options, pinch: 14 });
      const narrowest = Math.min(...skin.map((frame) => parseFloat(String(frame.width))));

      expect(narrowest).toBeLessThan(470 - 10);
      expect(skin[skin.length - 1]).toMatchObject({ width: '470px', height: '84px' });
    });
  });
});

interface StubAnimation {
  cancel: () => void;
  finished: Promise<void>;
}

type Animate = (keyframes: Keyframe[], options?: KeyframeAnimationOptions) => StubAnimation;

/** jsdom has no Web Animations; a stub records every call. */
const stubAnimate = (finished = new Promise<void>(() => undefined)): ReturnType<typeof vi.fn<Animate>> => {
  const animate = vi.fn<Animate>(() => ({ cancel: vi.fn(), finished }));

  Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true });

  return animate;
};

const stubReducedMotion = (reduce: boolean): void => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: reduce && query.includes('reduce'), media: query })));
};

/**
 * jsdom has neither `CSS.supports` nor `KeyframeEffect`. A modern engine has
 * both; an old one cannot parse linear() or animate a pseudo-element.
 * `CSS` itself stays: find.test.ts reads `CSS.highlights` from it.
 */
const stubEngine = ({ linear, pseudo }: { linear: boolean; pseudo: boolean }): void => {
  Object.defineProperty(CSS, 'supports', {
    value: (_property: string, value: string): boolean => linear || !value.includes('linear('),
    configurable: true,
    writable: true,
  });
  vi.stubGlobal('KeyframeEffect', pseudo ? class { public get pseudoElement(): string | null { return null; } } : class {});
};

const modernEngine = { linear: true, pseudo: true };

describe('bloom and stretch', () => {
  const parts = (): Parameters<typeof bloom>[0] => {
    const dock = document.createElement('div');
    const bar = document.createElement('div');

    dock.append(bar);
    document.body.append(dock);
    Object.defineProperty(bar, 'offsetWidth', { value: 470 });
    Object.defineProperty(bar, 'offsetHeight', { value: 44 });

    return {
      dock,
      bar,
      field: document.createElement('div'),
      query: document.createElement('input'),
      counter: document.createElement('span'),
      controls: [document.createElement('button'), document.createElement('button')],
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    stubEngine(modernEngine);
  });

  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'animate');
    Reflect.deleteProperty(CSS, 'supports');
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('grows the skin on the dock and clips the bar, from the dot to the full box', () => {
    const animate = stubAnimate();

    stubReducedMotion(false);
    const p = parts();

    bloom(p, { block: 'top', inline: 'right' });

    const skinCall = animate.mock.calls.find((call) => call[1]?.pseudoElement === '::before');
    const clipCall = animate.mock.calls.find((call) => Array.isArray(call[0]) && 'clipPath' in call[0][0]);

    expect(skinCall?.[0][0]).toMatchObject({ width: '40px', left: '430px' });
    expect(skinCall?.[1]).toMatchObject({ easing: 'linear' });
    expect(clipCall).toBeDefined();
    expect(animate.mock.contexts).toContain(p.dock);
  });

  it('fades the skin in, so the dot is not a full-strength disc on the first frame', () => {
    const animate = stubAnimate();

    stubReducedMotion(false);
    bloom(parts(), { block: 'top', inline: 'right' });

    const fade = animate.mock.calls.find((call) => call[1]?.pseudoElement === '::before' && 'opacity' in call[0][0]);

    expect(fade?.[0][0]).toMatchObject({ opacity: 0 });
    expect(fade?.[0].at(-1)).toMatchObject({ opacity: 1 });
  });

  // The bar is already visible when the row opens, so a fade would flash it.
  it('does not fade the skin when the row stretches open', () => {
    const animate = stubAnimate();

    stubReducedMotion(false);
    const p = parts();

    stretch({ dock: p.dock, bar: p.bar, field: p.field, buttons: [] }, { width: 470, height: 40 }, { block: 'top', inline: 'right' });

    const skinCalls = animate.mock.calls.filter((call) => call[1]?.pseudoElement === '::before');

    expect(skinCalls).toHaveLength(1);
    expect(skinCalls.some((call) => call[0].some((frame) => 'opacity' in frame))).toBe(false);
  });

  it('lands the parts in reading order: field, then controls one after another', () => {
    const animate = stubAnimate();

    stubReducedMotion(false);
    const p = parts();

    bloom(p, { block: 'top', inline: 'right' });

    const delayOf = (element: Element): number => {
      const index = animate.mock.contexts.indexOf(element);

      return Number(animate.mock.calls[index]?.[1]?.delay ?? -1);
    };

    expect(delayOf(p.field)).toBeLessThan(delayOf(p.controls[0]));
    expect(delayOf(p.controls[0])).toBeLessThan(delayOf(p.controls[1]));
  });

  // A disabled control rests at opacity 0.4; a keyframe ending at 1 would pop it down when the motion ends.
  it('lands each control on its own opacity, so a disabled one does not pop at the end', () => {
    const animate = stubAnimate();

    stubReducedMotion(false);
    const p = parts();

    bloom(p, { block: 'top', inline: 'right' });

    p.controls.forEach((control) => {
      const keyframes = animate.mock.calls[animate.mock.contexts.indexOf(control)]?.[0];

      expect(keyframes.at(-1)).not.toHaveProperty('opacity');
    });
  });

  it('lands the replace buttons on their own opacity when the row stretches open', () => {
    const animate = stubAnimate();

    stubReducedMotion(false);
    const p = parts();
    const buttons = [document.createElement('button'), document.createElement('button')];

    stretch({ dock: p.dock, bar: p.bar, field: p.field, buttons }, { width: 470, height: 40 }, { block: 'top', inline: 'right' });

    buttons.forEach((element) => {
      const keyframes = animate.mock.calls[animate.mock.contexts.indexOf(element)]?.[0];

      expect(keyframes.at(-1)).not.toHaveProperty('opacity');
    });
  });

  it('does nothing under reduced motion', () => {
    const animate = stubAnimate();

    stubReducedMotion(true);

    expect(prefersReducedMotion()).toBe(true);
    expect(bloom(parts(), { block: 'top', inline: 'right' })).toEqual([]);
    expect(animate).not.toHaveBeenCalled();
  });

  it('does nothing where Web Animations are missing', () => {
    stubReducedMotion(false);

    expect(bloom(parts(), { block: 'top', inline: 'right' })).toEqual([]);
  });

  // An engine older than linear() throws on the spring easings.
  it('does nothing where CSS cannot parse linear()', () => {
    const animate = stubAnimate();
    const p = parts();

    stubReducedMotion(false);
    stubEngine({ linear: false, pseudo: true });

    expect(bloom(p, { block: 'top', inline: 'right' })).toEqual([]);
    expect(stretch({ dock: p.dock, bar: p.bar, field: p.field, buttons: [] }, { width: 470, height: 40 }, { block: 'top', inline: 'right' })).toEqual([]);
    expect(animate).not.toHaveBeenCalled();
  });

  // Such an engine would animate the dock's own box instead of its ::before skin.
  it('does nothing where animations cannot target a pseudo-element', () => {
    const animate = stubAnimate();
    const p = parts();

    stubReducedMotion(false);
    stubEngine({ linear: true, pseudo: false });

    expect(bloom(p, { block: 'top', inline: 'right' })).toEqual([]);
    expect(stretch({ dock: p.dock, bar: p.bar, field: p.field, buttons: [] }, { width: 470, height: 40 }, { block: 'top', inline: 'right' })).toEqual([]);
    expect(animate).not.toHaveBeenCalled();
  });
});

describe('hopSourceFromRange', () => {
  const rangeWithRects = (rects: Array<Partial<DOMRect>>): Range => {
    const p = document.createElement('p');

    p.textContent = 'pick this word';
    p.style.fontSize = '16px';
    document.body.append(p);
    const range = document.createRange();
    const text = p.firstChild;

    if (!(text instanceof Text)) {
      throw new Error('text missing');
    }
    range.setStart(text, 5);
    range.setEnd(text, 9);
    Object.defineProperty(range, 'getClientRects', {
      value: () => rects.map((rect) => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, ...rect })),
    });

    return range;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('takes the first visible line box and the text style', () => {
    const source = hopSourceFromRange(rangeWithRects([{ left: 50, top: 100, width: 30, height: 20, right: 80, bottom: 120 }]), 'this');

    expect(source?.rect).toEqual({ left: 50, top: 100, width: 30, height: 20 });
    expect(source?.text).toBe('this');
    expect(source?.font.size).toBe('16px');
  });

  it('gives no hop for a selection scrolled out of view', () => {
    expect(hopSourceFromRange(rangeWithRects([{ left: 50, top: -400, width: 30, height: 20, right: 80, bottom: -380 }]), 'this')).toBeNull();
  });

  it('gives no hop for a range with no boxes', () => {
    expect(hopSourceFromRange(rangeWithRects([]), 'this')).toBeNull();
  });

  it('gives no hop where ranges cannot measure (jsdom)', () => {
    const range = document.createRange();

    Object.defineProperty(range, 'getClientRects', { value: undefined });

    expect(hopSourceFromRange(range, 'this')).toBeNull();
  });
});

describe('hop', () => {
  const source = {
    rect: { left: 50, top: 100, width: 30, height: 20 },
    text: 'this',
    font: { family: 'serif', size: '16px', weight: '400', style: 'normal', color: 'rgb(0, 0, 0)' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    stubEngine(modernEngine);
  });

  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'animate');
    Reflect.deleteProperty(CSS, 'supports');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('flies a hidden copy of the word, then removes it and reports a landing', async () => {
    let land: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      land = resolve;
    });

    stubAnimate(finished);
    stubReducedMotion(false);
    const dock = document.createElement('div');
    const input = document.createElement('input');

    dock.append(input);
    document.body.append(dock);
    const onEnd = vi.fn();

    hop(dock, source, input, HOP_DELAY, onEnd);

    const chip = dock.querySelector('[data-blok-find-hop-chip]');

    expect(chip?.textContent).toBe('this');
    expect(chip?.getAttribute('aria-hidden')).toBe('true');

    land();
    await finished;
    await Promise.resolve();

    expect(dock.querySelector('[data-blok-find-hop-chip]')).toBeNull();
    expect(onEnd).toHaveBeenCalledWith(true);
  });

  it('ends at once when stopped, without a landing', () => {
    stubAnimate();
    stubReducedMotion(false);
    const dock = document.createElement('div');
    const input = document.createElement('input');

    dock.append(input);
    document.body.append(dock);
    const onEnd = vi.fn();

    hop(dock, source, input, 0, onEnd)?.end();

    expect(dock.querySelector('[data-blok-find-hop-chip]')).toBeNull();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith(false);
  });

  it('does not fly under reduced motion', () => {
    stubAnimate();
    stubReducedMotion(true);
    const dock = document.createElement('div');

    document.body.append(dock);

    expect(hop(dock, source, document.createElement('input'), 0, vi.fn())).toBeNull();
    expect(dock.childElementCount).toBe(0);
  });

  it('does not fly where CSS cannot parse linear()', () => {
    const animate = stubAnimate();

    stubReducedMotion(false);
    stubEngine({ linear: false, pseudo: true });
    const dock = document.createElement('div');

    document.body.append(dock);

    expect(hop(dock, source, document.createElement('input'), 0, vi.fn())).toBeNull();
    expect(dock.childElementCount).toBe(0);
    expect(animate).not.toHaveBeenCalled();
  });

  /** Fly from `source` to an input at `inputTop`, and return the arc keyframes. */
  const flyTo = (inputTop: number, fonts: { input: string }): Keyframe[] => {
    const animate = stubAnimate();

    stubReducedMotion(false);
    const dock = document.createElement('div');
    const input = document.createElement('input');

    input.style.fontSize = fonts.input;
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(new DOMRect(900, inputTop, 160, 22));
    dock.append(input);
    document.body.append(dock);
    hop(dock, source, input, 0, vi.fn());
    const arc = animate.mock.calls[0]?.[0];

    if (arc === undefined) {
      throw new Error('no arc');
    }

    return arc;
  };
  const liftOf = (frame: Keyframe): number => Number(/translate\(\S+px, (\S+)px\)/.exec(String(frame.transform))?.[1]);
  const scaleOf = (frame: Keyframe): number => Number(/scale\((\S+)\)/.exec(String(frame.transform))?.[1]);

  const shiftOf = (frame: Keyframe): number => Number(/translate\((\S+)px,/.exec(String(frame.transform))?.[1]);

  /** The chip as find.css draws it: a 24px line box, 1px padding at each side. */
  const styleChip = (): void => {
    const style = document.createElement('style');

    style.textContent = '[data-blok-find-hop-chip] { padding-left: 1px; padding-right: 1px; }';
    document.body.append(style);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(24);
  };

  // The chip's line box is not the word's: top-aligned, its text sat lower than the word.
  it('takes off with its text right over the word', () => {
    stubAnimate();
    stubReducedMotion(false);
    styleChip();
    const dock = document.createElement('div');

    document.body.append(dock);
    hop(dock, source, document.createElement('input'), 0, vi.fn());
    const chip = dock.querySelector<HTMLElement>('[data-blok-find-hop-chip]');

    // Word: left 50, top 100, 20 tall. Centred 24px box: 100 + (20 - 24) / 2.
    expect(chip?.style.top).toBe('98px');
    expect(chip?.style.left).toBe('49px');
  });

  it('lands its box on the field\'s text box wherever it took off', () => {
    styleChip();
    const arc = flyTo(200, { input: '16px' });
    const chip = document.querySelector<HTMLElement>('[data-blok-find-hop-chip]');
    const last = arc[arc.length - 1];

    // Field: left 900, top 200, 22 tall; the 24px box centres on it.
    expect(parseFloat(chip?.style.left ?? '') + shiftOf(last)).toBeCloseTo(900, 3);
    expect(parseFloat(chip?.style.top ?? '') + liftOf(last)).toBeCloseTo(199, 3);
  });

  it('keeps the word on screen when the field sits near the top of the window', () => {
    const arc = flyTo(21, { input: '16px' });
    const top = parseFloat(document.querySelector<HTMLElement>('[data-blok-find-hop-chip]')?.style.top ?? '');

    expect(Math.min(...arc.map((frame) => top + liftOf(frame)))).toBeGreaterThanOrEqual(8);
  });

  it('keeps the full lift when there is room above', () => {
    const arc = flyTo(source.rect.top, { input: '16px' });

    expect(Math.min(...arc.map(liftOf))).toBeLessThan(-60);
  });

  it('lands at the field\'s text size, so the text does not jump when it shows', () => {
    const arc = flyTo(source.rect.top, { input: '13px' });

    expect(scaleOf(arc[arc.length - 1])).toBeCloseTo(13 / 16, 3);
  });

  it('is snappy but still reads as a hop', () => {
    expect(HOP_MS).toBeLessThanOrEqual(360);
    expect(HOP_MS).toBeGreaterThanOrEqual(250);
    expect(HOP_DELAY).toBeLessThanOrEqual(60);
  });

  it('stops turning and rising once it reaches the field', () => {
    const arc = flyTo(source.rect.top, { input: '16px' });
    const dxOf = (frame: Keyframe): number => Number(/translate\((\S+)px,/.exec(String(frame.transform))?.[1]);
    const turnOf = (frame: Keyframe): number => Number(/rotate\((\S+)deg\)/.exec(String(frame.transform))?.[1]);
    const total = dxOf(arc[arc.length - 1]);
    const arrived = arc.filter((frame) => dxOf(frame) / total > 0.97);

    expect(arrived.length).toBeGreaterThan(3);
    expect(Math.max(...arrived.map((frame) => Math.abs(turnOf(frame))))).toBeLessThan(1);
  });

  it('turns into the field\'s type on the way, so the hand-off does not swap fonts', () => {
    const animate = stubAnimate();

    stubReducedMotion(false);
    const dock = document.createElement('div');
    const input = document.createElement('input');

    Object.assign(input.style, { fontFamily: 'monospace', fontWeight: '500', color: 'rgb(1, 2, 3)' });
    dock.append(input);
    document.body.append(dock);
    hop(dock, { ...source, font: { ...source.font, weight: '700' } }, input, 0, vi.fn());
    const chip = dock.querySelector<HTMLElement>('[data-blok-find-hop-chip]');
    const calls = animate.mock.calls;
    const landing = calls.find(([, options]) => typeof options === 'object' && options.pseudoElement === '::after');
    const leaving = calls.find(([frames]) => Array.isArray(frames) && frames.some((frame) => frame.color === 'transparent'));

    expect(chip?.getAttribute('data-blok-find-hop-text')).toBe('this');
    expect(chip?.style.getPropertyValue('--blok-find-hop-land-family')).toBe('monospace');
    expect(chip?.style.getPropertyValue('--blok-find-hop-land-weight')).toBe('500');
    expect(chip?.style.getPropertyValue('--blok-find-hop-land-color')).toBe('rgb(1, 2, 3)');
    expect(Array.isArray(landing?.[0]) ? landing[0].at(-1)?.opacity : undefined).toBe(1);
    expect(Array.isArray(leaving?.[0]) ? leaving[0].at(-1)?.color : undefined).toBe('transparent');
  });

  it('keeps its tint all the way, so it hands over to the field\'s selection', () => {
    const animate = stubAnimate();

    stubReducedMotion(false);
    const dock = document.createElement('div');
    const input = document.createElement('input');

    dock.append(input);
    document.body.append(dock);
    hop(dock, source, input, 0, vi.fn());

    expect(animate.mock.calls.some(([frames]) => Array.isArray(frames) && frames.some((frame) => 'backgroundColor' in frame))).toBe(false);
  });

  it('leaves fast and eases into the field', () => {
    const arc = flyTo(source.rect.top, { input: '16px' });
    const dxOf = (frame: Keyframe): number => Number(/translate\((\S+)px,/.exec(String(frame.transform))?.[1]);
    const total = dxOf(arc[arc.length - 1]);

    expect(dxOf(arc[Math.floor(arc.length / 4)]) / total).toBeGreaterThan(0.55);
  });
});

// jsdom has no CSS, so these read the authored source.
describe('hop hand-off styles', () => {
  const css = readFileSync(resolve(__dirname, '../../../../../src/styles/find.css'), 'utf8');
  const rule = (selector: string): string => {
    const start = css.indexOf(`${selector} {`);

    return start === -1 ? '' : css.slice(start, css.indexOf('}', start));
  };

  it('draws the landing layer in the field\'s type', () => {
    const layer = rule('[data-blok-find-hop-chip]::after');

    expect(layer).toContain('content: attr(data-blok-find-hop-text)');
    expect(layer).toContain('var(--blok-find-hop-land-family)');
    expect(layer).toContain('var(--blok-find-hop-land-weight)');
    expect(layer).toContain('var(--blok-find-hop-land-color)');
  });

  it('selects the field\'s text in the chip\'s tint, so the tint carries on after landing', () => {
    expect(rule('[data-blok-find-field] > input::selection')).toContain('background: var(--blok-selection-inline)');
  });
});
