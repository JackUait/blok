import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHROME_BACK_DELAY_MS, createDissolve, createVeil, flyOut } from '../../../../../src/tools/image/darkroom/motion';
import { fakeFrameClock } from '../../../helpers/fake-frame-clock';

describe('darkroom motion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('dissolve fades the chrome by opacity only and brings it back after the gesture', () => {
    const bar = document.createElement('div');
    const grid = document.createElement('div');
    const d = createDissolve([bar], grid);

    d.begin();
    expect(bar.style.opacity).toBe('0');
    expect(grid.style.opacity).toBe('1');
    expect(bar.hidden).toBe(false);
    expect(bar.hasAttribute('aria-hidden')).toBe(false);

    d.end();
    vi.advanceTimersByTime(CHROME_BACK_DELAY_MS);
    expect(bar.style.opacity).toBe('');
    expect(grid.style.opacity).toBe('');
  });

  it('fly-out lands the clone on the target box, then reveals the target', () => {
    const { clock, advance } = fakeFrameClock();
    const target = document.createElement('div');

    document.body.appendChild(target);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 300, 200, 100));
    const onDone = vi.fn();

    flyOut({
      url: 'x.png', natural: { w: 800, h: 400 }, rect: { x: 0, y: 0, w: 100, h: 100 },
      from: { x: 100, y: 100, w: 800, h: 400 }, fromRound: 0, target, targetRound: 0,
      clock, reducedMotion: () => false, onDone,
    });

    const flight = document.querySelector<HTMLElement>('[data-role="darkroom-flight"]');

    expect(flight).not.toBeNull();
    expect(target.style.visibility).toBe('hidden');
    advance(3000);

    expect(document.querySelector('[data-role="darkroom-flight"]')).toBeNull();
    expect(target.style.visibility).toBe('');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('fly-out without a target fades away and still finishes', () => {
    const { clock, advance } = fakeFrameClock();
    const onDone = vi.fn();

    flyOut({
      url: 'x.png', natural: { w: 800, h: 400 }, rect: { x: 0, y: 0, w: 100, h: 100 },
      from: { x: 0, y: 0, w: 800, h: 400 }, fromRound: 0, target: null, targetRound: 0,
      clock, reducedMotion: () => false, onDone,
    });
    advance(3000);

    expect(document.querySelector('[data-role="darkroom-flight"]')).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('the veil covers the page without taking presses or the backdrop test id', () => {
    const veil = createVeil();

    expect(veil.isConnected).toBe(true);
    expect(veil.getAttribute('data-role')).toBe('darkroom-veil');
    expect(veil.getAttribute('aria-hidden')).toBe('true');
    expect(veil.classList.contains('blok-darkroom-veil')).toBe(true);
    expect(veil.hasAttribute('data-blok-testid')).toBe(false);
    expect(veil.getAttribute('data-blok-top-layer')).toBe('true');
  });

  it('fly-out fades the veil on the clone spring and removes it with the clone', () => {
    const { clock, advance } = fakeFrameClock();
    const target = document.createElement('div');

    document.body.appendChild(target);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 300, 200, 100));
    const veil = createVeil();

    flyOut({
      url: 'x.png', natural: { w: 800, h: 400 }, rect: { x: 0, y: 0, w: 100, h: 100 },
      from: { x: 100, y: 100, w: 800, h: 400 }, fromRound: 0, target, targetRound: 0,
      clock, reducedMotion: () => false, veil,
    });
    advance(64);
    const mid = Number(veil.style.opacity);

    expect(veil.isConnected).toBe(true);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    advance(3000);

    expect(veil.isConnected).toBe(false);
    expect(document.querySelector('[data-role="darkroom-flight"]')).toBeNull();
  });

  it('fly-out without a target removes the veil with the faded clone', () => {
    const { clock, advance } = fakeFrameClock();
    const veil = createVeil();

    flyOut({
      url: 'x.png', natural: { w: 800, h: 400 }, rect: { x: 0, y: 0, w: 100, h: 100 },
      from: { x: 0, y: 0, w: 800, h: 400 }, fromRound: 0, target: null, targetRound: 0,
      clock, reducedMotion: () => false, veil,
    });
    advance(3000);

    expect(veil.isConnected).toBe(false);
  });

  it('under reduced motion the veil and the clone go at once', () => {
    const { clock } = fakeFrameClock();
    const target = document.createElement('div');

    document.body.appendChild(target);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 300, 200, 100));
    const veil = createVeil();

    flyOut({
      url: 'x.png', natural: { w: 800, h: 400 }, rect: { x: 0, y: 0, w: 100, h: 100 },
      from: { x: 0, y: 0, w: 800, h: 400 }, fromRound: 0, target, targetRound: 0,
      clock, reducedMotion: () => true, veil,
    });

    expect(veil.isConnected).toBe(false);
    expect(document.querySelector('[data-role="darkroom-flight"]')).toBeNull();
  });
});
