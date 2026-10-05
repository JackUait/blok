import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import {
  bloom,
  cornerOf,
  growFrames,
  HOP_DELAY,
  HOP_MS,
  hop,
  hopSourceFromRange,
  prefersReducedMotion,
  settleMs,
  springAt,
  springEasing,
  SPRINGS,
  stretch,
} from '../../../../../src/components/modules/find/find-motion';

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

/** jsdom has no Web Animations; a stub records every call. */
const stubAnimate = (): ReturnType<typeof vi.fn> => {
  const animate = vi.fn(() => ({ cancel: vi.fn(), finished: new Promise<void>(() => undefined) }));

  Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true });

  return animate;
};

const stubReducedMotion = (reduce: boolean): void => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: reduce && query.includes('reduce'), media: query })));
};

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
  });

  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'animate');
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

  afterEach(() => {
    document.body.replaceChildren();
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
  });

  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'animate');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('flies a hidden copy of the word, then removes it and reports a landing', async () => {
    let land: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      land = resolve;
    });

    Object.defineProperty(Element.prototype, 'animate', {
      value: vi.fn(() => ({ cancel: vi.fn(), finished })),
      configurable: true,
      writable: true,
    });
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
    const arc: unknown = animate.mock.calls[0]?.[0];

    if (!Array.isArray(arc)) {
      throw new Error('no arc');
    }

    return arc.filter((frame): frame is Keyframe => typeof frame === 'object' && frame !== null);
  };
  const liftOf = (frame: Keyframe): number => Number(/translate\(\S+px, (\S+)px\)/.exec(String(frame.transform))?.[1]);
  const scaleOf = (frame: Keyframe): number => Number(/scale\((\S+)\)/.exec(String(frame.transform))?.[1]);

  it('keeps the word on screen when the field sits near the top of the window', () => {
    const arc = flyTo(21, { input: '16px' });

    expect(Math.min(...arc.map((frame) => source.rect.top + liftOf(frame)))).toBeGreaterThanOrEqual(8);
  });

  it('keeps the full lift when there is room above', () => {
    const arc = flyTo(source.rect.top, { input: '16px' });

    expect(liftOf(arc[Math.floor(arc.length / 2)])).toBeLessThan(-60);
  });

  it('lands at the field\'s text size, so the text does not jump when it shows', () => {
    const arc = flyTo(source.rect.top, { input: '13px' });

    expect(scaleOf(arc[arc.length - 1])).toBeCloseTo(13 / 16, 3);
  });

  it('lasts long enough to read as a hop', () => {
    expect(HOP_MS).toBeGreaterThanOrEqual(400);
  });
});
