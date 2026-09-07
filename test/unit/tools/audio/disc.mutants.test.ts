import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  stepPlatter,
  createPlatterSpin,
  PLATTER_FULL_DPS,
  PLATTER_SPINUP_TAU,
  PLATTER_SPINDOWN_TAU,
  type PlatterState,
} from '../../../../src/tools/audio/disc';

interface FrameQueue {
  /** Runs the pending frame at `now` milliseconds, if one is scheduled. */
  advance: (now: number) => void;
  pending: () => boolean;
  cancelled: () => number[];
}

const fakeFrames = (): FrameQueue => {
  const scheduled = new Map<number, FrameRequestCallback>();
  const cancelled: number[] = [];
  const next = { id: 0 };

  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
    next.id += 1;
    scheduled.set(next.id, callback);

    return next.id;
  });

  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
    cancelled.push(id);
    scheduled.delete(id);
  });

  return {
    advance: (now) => {
      const [id, callback] = [...scheduled.entries()][0] ?? [];

      if (id === undefined || callback === undefined) {
        return;
      }

      scheduled.delete(id);
      callback(now);
    },
    pending: () => scheduled.size > 0,
    cancelled: () => cancelled,
  };
};

/**
 * jsdom does not implement matchMedia, and the source calls it optionally, so a
 * spy has nothing to replace — the property has to be defined outright.
 */
const reducedMotion = (matches: boolean | null): void => {
  if (matches === null) {
    Reflect.deleteProperty(globalThis, 'matchMedia');

    return;
  }

  Object.defineProperty(globalThis, 'matchMedia', {
    value: vi.fn(() => ({ matches })),
    configurable: true,
    writable: true,
  });
};

const figureWithDisc = (): { figure: HTMLElement; disc: HTMLElement } => {
  const figure = document.createElement('figure');
  const disc = document.createElement('div');

  disc.className = 'blok-audio-cover__disc';
  figure.appendChild(disc);
  document.body.appendChild(figure);

  return { figure, disc };
};

const rotationOf = (disc: HTMLElement): number => {
  const match = /rotate\((-?[\d.]+)deg\)/.exec(disc.style.transform);

  if (match === null) {
    throw new Error(`no rotation in ${JSON.stringify(disc.style.transform)}`);
  }

  return Number(match[1]);
};

describe('platter spin mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    reducedMotion(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    reducedMotion(null);
    document.body.innerHTML = '';
  });

  describe('stepPlatter', () => {
    const at = (angle: number, velocity: number): PlatterState => ({ angle, velocity });

    it('treats a zero or negative frame as a no-op', () => {
      expect(stepPlatter(at(10, 20), 0, PLATTER_FULL_DPS, PLATTER_SPINUP_TAU)).toStrictEqual(at(10, 20));
      expect(stepPlatter(at(10, 20), -1, PLATTER_FULL_DPS, PLATTER_SPINUP_TAU)).toStrictEqual(at(10, 20));
    });

    it('eases the velocity toward the target without overshooting it', () => {
      const stepped = stepPlatter(at(0, 0), 0.1, PLATTER_FULL_DPS, PLATTER_SPINUP_TAU);

      expect(stepped.velocity).toBeGreaterThan(0);
      expect(stepped.velocity).toBeLessThan(PLATTER_FULL_DPS);
    });

    it('eases a spinning platter down toward zero', () => {
      const stepped = stepPlatter(at(0, PLATTER_FULL_DPS), 0.1, 0, PLATTER_SPINDOWN_TAU);

      expect(stepped.velocity).toBeLessThan(PLATTER_FULL_DPS);
      expect(stepped.velocity).toBeGreaterThan(0);
    });

    it('composes exactly across substeps, so the spin is frame-rate independent', () => {
      const one = stepPlatter(at(0, 0), 0.2, PLATTER_FULL_DPS, PLATTER_SPINUP_TAU);
      const first = stepPlatter(at(0, 0), 0.1, PLATTER_FULL_DPS, PLATTER_SPINUP_TAU);
      const two = stepPlatter(first, 0.1, PLATTER_FULL_DPS, PLATTER_SPINUP_TAU);

      expect(two.velocity).toBeCloseTo(one.velocity, 10);
    });

    it('reaches a slower velocity with the heavier wind-down constant', () => {
      const brisk = stepPlatter(at(0, PLATTER_FULL_DPS), 0.1, 0, PLATTER_SPINUP_TAU);
      const heavy = stepPlatter(at(0, PLATTER_FULL_DPS), 0.1, 0, PLATTER_SPINDOWN_TAU);

      expect(heavy.velocity).toBeGreaterThan(brisk.velocity);
    });

    it('integrates the new velocity into the angle', () => {
      const stepped = stepPlatter(at(0, 90), 1, 90, PLATTER_SPINUP_TAU);

      expect(stepped.angle).toBeCloseTo(90, 6);
    });

    it('wraps the angle back into a single turn', () => {
      expect(stepPlatter(at(350, 90), 1, 90, PLATTER_SPINUP_TAU).angle).toBeCloseTo(80, 6);
    });

    it('wraps a negative angle up into a single turn', () => {
      const stepped = stepPlatter(at(10, -90), 1, -90, PLATTER_SPINUP_TAU);

      expect(stepped.angle).toBeGreaterThanOrEqual(0);
      expect(stepped.angle).toBeCloseTo(280, 6);
    });
  });

  describe('createPlatterSpin', () => {
    it('holds still when the viewer prefers reduced motion', () => {
      const frames = fakeFrames();
      const { figure } = figureWithDisc();

      reducedMotion(true);
      createPlatterSpin(figure).start();

      expect(frames.pending()).toBe(false);
    });

    it('spins on a platform with no matchMedia at all', () => {
      const frames = fakeFrames();
      const { figure, disc } = figureWithDisc();

      reducedMotion(null);
      createPlatterSpin(figure).start();
      frames.advance(1000);
      frames.advance(1040);

      expect(rotationOf(disc)).toBeGreaterThan(0);
    });

    it('does nothing when a cover image is shown instead of the disc', () => {
      const frames = fakeFrames();
      const figure = document.createElement('figure');

      document.body.appendChild(figure);
      createPlatterSpin(figure).start();

      expect(frames.pending()).toBe(false);
    });

    it('turns the disc once the motor is engaged', () => {
      const frames = fakeFrames();
      const { figure, disc } = figureWithDisc();

      createPlatterSpin(figure).start();
      frames.advance(1000);
      frames.advance(1040);

      expect(rotationOf(disc)).toBeGreaterThan(0);
      expect(frames.pending()).toBe(true);
    });

    it('measures no time on the first frame, so a stale timestamp cannot jump the disc', () => {
      const frames = fakeFrames();
      const { figure, disc } = figureWithDisc();

      createPlatterSpin(figure).start();
      frames.advance(9_000_000);

      expect(rotationOf(disc)).toBe(0);
    });

    it('clamps a long gap so a backgrounded tab does not fling the disc', () => {
      const frames = fakeFrames();
      const short = figureWithDisc();
      const long = figureWithDisc();

      createPlatterSpin(short.figure).start();
      frames.advance(1000);
      frames.advance(1050);

      const shortRotation = rotationOf(short.disc);

      vi.mocked(globalThis.requestAnimationFrame).mockClear();

      const frames2 = fakeFrames();

      createPlatterSpin(long.figure).start();
      frames2.advance(1000);
      frames2.advance(11_000);

      expect(rotationOf(long.disc)).toBeCloseTo(shortRotation, 6);
    });

    it('writes the rotation to two decimal places', () => {
      const frames = fakeFrames();
      const { figure, disc } = figureWithDisc();

      createPlatterSpin(figure).start();
      frames.advance(1000);
      frames.advance(1033);

      expect(disc.style.transform).toMatch(/^rotate\(\d+\.\d{2}deg\)$/);
    });

    it('coasts to rest and then parks the frame loop', () => {
      const frames = fakeFrames();
      const { figure } = figureWithDisc();
      const platter = createPlatterSpin(figure);

      platter.start();
      frames.advance(1000);
      frames.advance(1050);

      platter.stop();

      for (let now = 1100; now <= 120_000 && frames.pending(); now += 50) {
        frames.advance(now);
      }

      expect(frames.pending()).toBe(false);
    });

    it('does not wake the loop when stopping a platter that never span', () => {
      const frames = fakeFrames();
      const { figure } = figureWithDisc();
      const platter = createPlatterSpin(figure);

      platter.stop();

      expect(frames.pending()).toBe(false);
    });

    it('keeps a single loop rather than one per start', () => {
      fakeFrames();

      const { figure } = figureWithDisc();
      const platter = createPlatterSpin(figure);

      platter.start();
      platter.start();
      platter.start();

      expect(vi.mocked(globalThis.requestAnimationFrame)).toHaveBeenCalledTimes(1);
    });

    it('cancels the frame loop on teardown', () => {
      const frames = fakeFrames();
      const { figure } = figureWithDisc();
      const platter = createPlatterSpin(figure);

      platter.start();
      platter.destroy();

      expect(frames.cancelled()).toHaveLength(1);
      expect(frames.pending()).toBe(false);
    });

    it('has nothing to cancel when the loop is already parked', () => {
      const frames = fakeFrames();
      const { figure } = figureWithDisc();

      createPlatterSpin(figure).destroy();

      expect(frames.cancelled()).toHaveLength(0);
    });
  });
});
