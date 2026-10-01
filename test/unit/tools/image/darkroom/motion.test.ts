import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageMarkup } from '../../../../../types/tools/image';
import { CHROME_BACK_DELAY_MS, cameraPlane, createDissolve, createVeil, fitCameraPlane, flyOut } from '../../../../../src/tools/image/darkroom/motion';
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

  it('the fly-out clone is the oriented plane with the filter, so it lands looking like the block', () => {
    const { clock } = fakeFrameClock();

    flyOut({
      url: 'x.png', natural: { w: 800, h: 400 }, rect: { x: 0, y: 0, w: 100, h: 50 },
      from: { x: 0, y: 0, w: 400, h: 400 }, fromRound: 0, target: null, targetRound: 0,
      clock, reducedMotion: () => false,
      geometry: { rotation: 90, flipX: true, straighten: 0 }, filter: 'mono', adjust: { brightness: 20 },
    });
    const plane = document.querySelector<HTMLElement>('[data-role="darkroom-flight"] [data-role="image-plane"]');
    const img = plane?.querySelector('img');

    expect(plane?.style.width).toBe('400px');
    expect(plane?.style.height).toBe('800px');
    // The 400 px box shows the full 400 px oriented width.
    expect(plane?.style.transform).toBe('translate(0px, 0px) scale(1)');
    expect(img?.style.transform).toBe('rotate(90deg) scaleX(-1)');
    expect(img?.style.filter).toBe('grayscale(1) brightness(1.1)');
  });

  it('the fly-out clone carries the marks over the photo, in the oriented box', () => {
    const { clock } = fakeFrameClock();
    const markup: ImageMarkup[] = [{ id: 't', type: 'text', color: '#ffffff', x: 0.5, y: 0.5, text: 'Hi', size: 0.06 }];

    flyOut({
      url: 'x.png', natural: { w: 800, h: 400 }, rect: { x: 0, y: 0, w: 100, h: 100 },
      from: { x: 0, y: 0, w: 400, h: 400 }, fromRound: 0, target: null, targetRound: 0,
      clock, reducedMotion: () => false, geometry: { rotation: 90, flipX: false, straighten: 0 }, markup,
    });
    const plane = document.querySelector<HTMLElement>('[data-role="darkroom-flight"] [data-role="image-plane"]');
    const svg = plane?.querySelector('svg[data-role="image-markup"]');

    expect(plane?.lastElementChild).toBe(svg);
    expect(svg?.getAttribute('viewBox')).toBe('0 0 400 800');
    expect(svg?.textContent).toBe('Hi');
  });

  it('a camera plane built before the natural size draws its marks when fitted', () => {
    const img = document.createElement('img');
    const g = { rotation: 0 as const, flipX: false, straighten: 0 };
    const markup: ImageMarkup[] = [{ id: 'l', type: 'line', color: '#111111', x1: 0, y1: 0, x2: 1, y2: 1, size: 0.01 }];
    const plane = cameraPlane(img, null, g, markup);
    const svg = plane.querySelector('svg[data-role="image-markup"]');

    expect(svg?.hasAttribute('viewBox')).toBe(false);
    fitCameraPlane(plane, img, { w: 640, h: 480 }, g);
    expect(svg?.getAttribute('viewBox')).toBe('0 0 640 480');
    expect(svg?.querySelector('[data-markup-id="l"]')).not.toBeNull();
  });
});
