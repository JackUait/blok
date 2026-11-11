import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoScroll } from '../../../../../../src/components/modules/drag/utils/AutoScroll';

/** Frames queued by the helper, run by hand with a chosen timestamp. */
let frames: Array<(now: number) => void> = [];

const runFrame = (now: number): void => {
  const queued = frames;

  frames = [];
  queued.forEach((callback) => callback(now));
};

const scroller = (): HTMLElement => {
  const el = document.createElement('div');

  document.body.appendChild(el);

  return el;
};

/** jsdom keeps scrollTop/scrollLeft at 0, so give them plain storage. */
const trackScroll = (el: HTMLElement): void => {
  let top = 0;
  let left = 0;

  Object.defineProperty(el, 'scrollTop', { get: () => top, set: (v: number) => { top = Math.max(0, v); }, configurable: true });
  Object.defineProperty(el, 'scrollLeft', { get: () => left, set: (v: number) => { left = Math.max(0, v); }, configurable: true });
};

describe('AutoScroll with a speed option', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: (now: number) => void) => {
      frames.push(callback);

      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      frames = [];
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('scrolls down in steps, by speed × time, while the pointer holds still near the end edge', () => {
    const el = scroller();

    trackScroll(el);
    const auto = new AutoScroll(el, {
      bounds: () => ({ start: 0, end: 450 }),
      speed: (distance) => (distance <= 10 ? 1 : 0),
      stepMs: 24,
    });

    auto.start(440);
    runFrame(1000);
    runFrame(1008);
    runFrame(1016);
    expect(el.scrollTop).toBe(0);

    runFrame(1024);
    expect(el.scrollTop).toBe(24);

    runFrame(1048);
    expect(el.scrollTop).toBe(48);
  });

  it('follows the latest pointer position: slower further from the edge, stopped outside the zone', () => {
    const el = scroller();

    trackScroll(el);
    const auto = new AutoScroll(el, {
      bounds: () => ({ start: 0, end: 450 }),
      speed: (distance) => Math.max(0, (30 - distance) / 20),
      stepMs: 24,
    });

    auto.start(440);
    runFrame(0);
    runFrame(24);
    expect(el.scrollTop).toBe(24);

    auto.start(430);
    runFrame(48);
    expect(el.scrollTop).toBe(36);

    auto.start(200);
    runFrame(72);
    runFrame(96);
    expect(el.scrollTop).toBe(36);
    expect(frames).toHaveLength(0);
  });

  it('scrolls back toward the start edge', () => {
    const el = scroller();

    trackScroll(el);
    el.scrollTop = 100;
    const auto = new AutoScroll(el, {
      bounds: () => ({ start: 50, end: 450 }),
      speed: (distance) => (distance <= 10 ? 1 : 0),
      stepMs: 24,
    });

    auto.start(55);
    runFrame(0);
    runFrame(24);
    expect(el.scrollTop).toBe(76);
  });

  it('scrolls sideways on the x axis', () => {
    const el = scroller();

    trackScroll(el);
    const auto = new AutoScroll(el, {
      axis: 'x',
      bounds: () => ({ start: 270, end: 900 }),
      speed: (distance) => (distance <= 10 ? 1.5 : 0),
      stepMs: 24,
    });

    auto.start(890);
    runFrame(0);
    runFrame(24);
    expect(el.scrollLeft).toBe(36);
    expect(el.scrollTop).toBe(0);
  });

  it('calls onStep after each step that moved the scroller, and not once it is at the end', () => {
    const el = scroller();
    const onStep = vi.fn();

    trackScroll(el);
    el.scrollTop = 30;
    const auto = new AutoScroll(el, {
      bounds: () => ({ start: 0, end: 450 }),
      speed: (distance) => (distance <= 10 ? 1 : 0),
      stepMs: 24,
      onStep,
    });

    auto.start(5);
    runFrame(0);
    runFrame(24);
    expect(onStep).toHaveBeenCalledTimes(1);

    runFrame(48);
    expect(el.scrollTop).toBe(0);
    expect(onStep).toHaveBeenCalledTimes(2);

    runFrame(72);
    expect(onStep).toHaveBeenCalledTimes(2);
  });

  it('stops scrolling on stop()', () => {
    const el = scroller();

    trackScroll(el);
    const auto = new AutoScroll(el, {
      bounds: () => ({ start: 0, end: 450 }),
      speed: () => 1,
      stepMs: 24,
    });

    auto.start(445);
    runFrame(0);
    auto.stop();
    runFrame(24);
    expect(el.scrollTop).toBe(0);
    expect(frames).toHaveLength(0);
  });

  it('scrolls the window when there is no scroller', () => {
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const auto = new AutoScroll(null, {
      axis: 'x',
      bounds: () => ({ start: 0, end: 900 }),
      speed: () => 1,
      stepMs: 24,
    });

    auto.start(895);
    runFrame(0);
    runFrame(24);
    expect(scrollBy).toHaveBeenCalledWith(24, 0);
  });
});
