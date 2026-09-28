import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makePreview } from '../../../../src/components/utils/media-empty-preview';
import { leanPreview, projectPoint } from '../../../../src/components/utils/media-preview-3d';

// jsdom has no SVG geometry: give every shape a 4-point outline so the
// projector has something to sample.
const stubGeometry = (): void => {
  const proto = SVGElement.prototype as SVGElement & {
    getTotalLength?: () => number;
    getPointAtLength?: (d: number) => { x: number; y: number };
  };
  proto.getTotalLength = () => 40;
  proto.getPointAtLength = (d: number) => ({ x: 20 + (d % 20), y: 10 + Math.floor(d / 20) * 10 });
};

const clearGeometry = (): void => {
  Reflect.deleteProperty(SVGElement.prototype, 'getTotalLength');
  Reflect.deleteProperty(SVGElement.prototype, 'getPointAtLength');
};

const frames = { queue: [] as FrameRequestCallback[], time: 0 };

const runFrames = (limit: number): number => {
  const ran = { count: 0 };
  while (frames.queue.length > 0 && ran.count < limit) {
    const next = frames.queue.shift();
    frames.time += 16;
    next?.(frames.time);
    ran.count += 1;
  }
  return ran.count;
};

describe('projectPoint', () => {
  it('makes the side the pointer leans toward come closer and grow taller', () => {
    const right = projectPoint(190, 10, 0, 1, 0);
    const left = projectPoint(10, 10, 0, 1, 0);

    expect(Math.abs(right[1] - 60)).toBeGreaterThan(Math.abs(left[1] - 60));
  });

  it('shifts a deeper layer further than a flat one', () => {
    const flat = projectPoint(100, 60, 0, 1, 1);
    const deep = projectPoint(100, 60, 28, 1, 1);

    expect(Math.hypot(deep[0] - 100, deep[1] - 60)).toBeGreaterThan(Math.hypot(flat[0] - 100, flat[1] - 60));
  });

  it('leaves the drawing untouched at rest', () => {
    expect(projectPoint(30, 20, 12, 0, 0)).toEqual([30, 20]);
  });
});

describe('leanPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubGeometry();
    frames.queue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.queue.push(cb);
      return frames.queue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
  });

  afterEach(() => {
    clearGeometry();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not touch the drawing before the first lean', () => {
    const stage = makePreview('video');

    expect(stage.querySelectorAll('rect, circle').length).toBeGreaterThan(0);
  });

  it('redraws every shape as a projected path once the pointer leans', () => {
    const stage = makePreview('video');

    leanPreview(stage, 1, 0);
    runFrames(5);

    expect(stage.querySelectorAll('svg rect, svg circle, svg ellipse').length).toBe(0);
    expect(stage.querySelector('.blok-media-preview__frame')?.getAttribute('d')).toMatch(/^M/);
  });

  it('stops asking for frames once the tilt has settled, and wakes on the next lean', () => {
    const stage = makePreview('video');
    leanPreview(stage, 1, 0);

    const ran = runFrames(2000);

    expect(ran).toBeLessThan(2000);
    expect(frames.queue).toHaveLength(0);

    leanPreview(stage, 0, 0);

    expect(frames.queue).toHaveLength(1);
  });

  it('shares its live tilt so the shadows can follow the light', () => {
    const stage = makePreview('video');
    leanPreview(stage, 1, -1);

    runFrames(3);
    const midway = Number(stage.style.getPropertyValue('--tilt-x'));
    runFrames(2000);

    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(1);
    expect(stage.style.getPropertyValue('--tilt-x')).toBe('1');
    expect(stage.style.getPropertyValue('--tilt-y')).toBe('-1');
  });

  it('does nothing when a never-tilted drawing is told to rest', () => {
    const stage = makePreview('video');

    leanPreview(stage, 0, 0);

    expect(frames.queue).toHaveLength(0);
    expect(stage.querySelectorAll('rect, circle').length).toBeGreaterThan(0);
  });
});
