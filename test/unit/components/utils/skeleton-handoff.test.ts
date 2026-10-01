import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSkeletonHandoff } from '../../../../src/components/utils/skeleton-handoff';
import * as motion from '../../../../src/components/utils/reduced-motion';

type AnimateCall = { el: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions };

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
    expect(String(barCalls[0].keyframes[1].transform)).toContain('translate(0px, 100px)');
    expect(String(barCalls[1].keyframes[1].transform)).toContain('translate(0px, 130px)');
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

    expect(String(barCall?.keyframes[1].transform)).toContain('translate(100px, 50px)');
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

    expect(String(barCall?.keyframes[1].transform)).toContain('translate(-100px, 50px)');
    expect(bar.style.transformOrigin).toBe('0 0');
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

  it('resolves at once when animate is unavailable', async () => {
    Reflect.deleteProperty(Element.prototype, 'animate');

    await expect(runSkeletonHandoff({ bars: make(1, [0]), targets: make(1, [0]), content: document.createElement('div') })).resolves.toBeUndefined();
  });
});
