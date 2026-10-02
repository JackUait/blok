import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSkeletonHandoff } from '../../../../src/components/utils/skeleton-handoff';
import * as motion from '../../../../src/components/utils/reduced-motion';

type AnimateCall = { el: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions };

const last = (keyframes: Keyframe[]): Keyframe => keyframes[keyframes.length - 1] ?? {};

const rect = (top: number, height: number, width = 600, left = 0): DOMRect =>
  ({ top, left, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });

describe('runSkeletonHandoff', () => {
  const calls: AnimateCall[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    Element.prototype.animate = vi.fn(function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      calls.push({ el: this, keyframes, options });

      return { finished: Promise.resolve(), cancel: vi.fn() } as unknown as Animation;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(Element.prototype, 'animate');
  });

  const make = (n: number, tops: number[]): HTMLElement[] => Array.from({ length: n }, (_, i) => {
    const el = document.createElement('div');

    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(tops[i] ?? 0, 20));

    return el;
  });

  it('moves bar i onto block i, staggered top to bottom', async () => {
    const bars = make(2, [0, 30]);
    const targets = make(2, [100, 160]);
    const content = document.createElement('div');

    await runSkeletonHandoff({ bars, targets, content });

    const barCalls = calls.filter(call => bars.includes(call.el as HTMLElement));

    expect(barCalls).toHaveLength(2);
    expect(String(last(barCalls[0].keyframes).transform)).toContain('translate(0px, 100px)');
    expect(String(last(barCalls[1].keyframes).transform)).toContain('translate(0px, 130px)');
    expect(barCalls[1].options.delay).toBeGreaterThan(Number(barCalls[0].options.delay ?? 0));
  });

  it('fades extra bars in place and fades the content in', async () => {
    const bars = make(3, [0, 30, 60]);
    const targets = make(1, [0]);
    const content = document.createElement('div');

    await runSkeletonHandoff({ bars, targets, content });

    const extra = calls.filter(call => call.el === bars[2]);

    expect(extra).toHaveLength(1);
    expect(extra[0].keyframes.some(frame => frame.transform !== undefined)).toBe(false);
    expect(calls.some(call => call.el === content)).toBe(true);
  });

  it('fades a bar in place when its block is hidden, instead of flying it to the viewport corner', async () => {
    const bars = make(1, [40]);
    const hidden = document.createElement('div');

    // A collapsed toggle's child is display:none, so its rect is all zeros.
    vi.spyOn(hidden, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 0, 0));

    await runSkeletonHandoff({ bars, targets: [hidden], content: document.createElement('div') });

    const barCall = calls.find(call => call.el === bars[0]);

    expect(barCall?.keyframes.some(frame => frame.transform !== undefined)).toBe(false);
    expect(last(barCall?.keyframes ?? []).opacity).toBe(0);
  });

  it('in RTL anchors the bar at its right edge and moves it by the right-edge delta', async () => {
    const overlay = document.createElement('div');
    const bar = document.createElement('div');
    const target = document.createElement('div');

    overlay.setAttribute('dir', 'rtl');
    overlay.appendChild(bar);
    document.body.appendChild(overlay);
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue(rect(0, 20, 200, 100));
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rect(50, 20, 400, 0));

    await runSkeletonHandoff({ bars: [bar], targets: [target], content: document.createElement('div') });

    const barCall = calls.find(call => call.el === bar);

    expect(String(last(barCall?.keyframes ?? []).transform)).toContain('translate(100px, 50px)');
    expect(bar.style.transformOrigin).toBe('100% 0');
    overlay.remove();
  });

  it('in LTR anchors the bar at its left edge and moves it by the left-edge delta', async () => {
    const bar = document.createElement('div');
    const target = document.createElement('div');

    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue(rect(0, 20, 200, 100));
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rect(50, 20, 400, 0));

    await runSkeletonHandoff({ bars: [bar], targets: [target], content: document.createElement('div') });

    const barCall = calls.find(call => call.el === bar);

    expect(String(last(barCall?.keyframes ?? []).transform)).toContain('translate(-100px, 50px)');
    expect(bar.style.transformOrigin).toBe('0 0');
  });

  it('a bar starts from its breathing opacity and holds it through its stagger delay', async () => {
    const bars = make(2, [0, 30]);
    const targets = make(1, [100]);

    bars.forEach(bar => bar.style.setProperty('opacity', '0.72'));

    await runSkeletonHandoff({ bars, targets, content: document.createElement('div') });

    // Bar 0 glides onto a block, bar 1 has none and fades in place: both wait out a delay.
    bars.forEach(bar => {
      const call = calls.find(c => c.el === bar);

      expect(Number(call?.keyframes[0].opacity)).toBe(0.72);
      expect(call?.options.fill).toBe('both');
    });
  });

  it('a gliding bar stays solid for the first part of its move, then dissolves', async () => {
    const bars = make(1, [0]);
    const targets = make(1, [100]);

    await runSkeletonHandoff({ bars, targets, content: document.createElement('div') });

    const { keyframes } = calls.find(c => c.el === bars[0]) ?? { keyframes: [] };
    const held = keyframes.find(frame => typeof frame.offset === 'number' && frame.offset >= 0.3);

    expect(held?.opacity).toBe(keyframes[0].opacity);
    expect(held?.transform).toBeUndefined();
    expect(last(keyframes).opacity).toBe(0);
  });

  it('under reduced motion only crossfades: no transforms, no blur', async () => {
    vi.spyOn(motion, 'prefersReducedMotion').mockReturnValue(true);
    const bars = make(1, [0]);
    const targets = make(1, [100]);

    await runSkeletonHandoff({ bars, targets, content: document.createElement('div') });

    expect(calls.length).toBeGreaterThan(0);
    calls.forEach((call) => {
      call.keyframes.forEach(frame => {
        expect(frame.transform).toBeUndefined();
        expect(frame.filter).toBeUndefined();
      });
    });
  });

  describe('when an animation is cancelled', () => {
    beforeEach(() => {
      Element.prototype.animate = vi.fn(() =>
        ({ finished: Promise.reject(new DOMException('', 'AbortError')), cancel: vi.fn() }) as unknown as Animation);
    });

    it('still resolves on the motion path', async () => {
      await expect(runSkeletonHandoff({ bars: make(2, [0, 30]), targets: make(1, [100]), content: document.createElement('div') })).resolves.toBeUndefined();
    });

    it('still resolves on the reduced-motion path', async () => {
      vi.spyOn(motion, 'prefersReducedMotion').mockReturnValue(true);

      await expect(runSkeletonHandoff({ bars: make(1, [0]), targets: make(1, [100]), content: document.createElement('div') })).resolves.toBeUndefined();
    });
  });

  it('resolves at once when animate is unavailable', async () => {
    Reflect.deleteProperty(Element.prototype, 'animate');

    await expect(runSkeletonHandoff({ bars: make(1, [0]), targets: make(1, [0]), content: document.createElement('div') })).resolves.toBeUndefined();
  });
});
