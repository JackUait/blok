import { describe, it, expect } from 'vitest';
import {
  stepPlatter,
  PLATTER_FULL_DPS,
  PLATTER_SPINUP_TAU,
  PLATTER_SPINDOWN_TAU,
  type PlatterState,
} from '../../../../src/tools/audio/disc';

/** Run `stepPlatter` `n` times with a fixed dt/target/tau and return the end state. */
function run(start: PlatterState, n: number, dt: number, target: number, tau: number): PlatterState {
  let s = start;
  for (let i = 0; i < n; i++) s = stepPlatter(s, dt, target, tau);
  return s;
}

describe('stepPlatter', () => {
  it('spins UP toward the target speed without overshooting it', () => {
    const next = stepPlatter({ angle: 0, velocity: 0 }, 0.1, PLATTER_FULL_DPS, PLATTER_SPINUP_TAU);
    expect(next.velocity).toBeGreaterThan(0);
    expect(next.velocity).toBeLessThan(PLATTER_FULL_DPS);
  });

  it('converges to full speed after the platter has had time to come up', () => {
    const end = run({ angle: 0, velocity: 0 }, 400, 1 / 60, PLATTER_FULL_DPS, PLATTER_SPINUP_TAU);
    expect(end.velocity).toBeCloseTo(PLATTER_FULL_DPS, 1);
  });

  it('winds DOWN toward rest when the target drops to zero (a coasting platter)', () => {
    const mid = stepPlatter({ angle: 0, velocity: PLATTER_FULL_DPS }, 0.1, 0, PLATTER_SPINDOWN_TAU);
    expect(mid.velocity).toBeGreaterThan(0);
    expect(mid.velocity).toBeLessThan(PLATTER_FULL_DPS);
    const end = run({ angle: 0, velocity: PLATTER_FULL_DPS }, 600, 1 / 60, 0, PLATTER_SPINDOWN_TAU);
    expect(end.velocity).toBeCloseTo(0, 1);
  });

  it('advances the angle while the platter is turning', () => {
    const next = stepPlatter({ angle: 0, velocity: PLATTER_FULL_DPS }, 0.1, PLATTER_FULL_DPS, PLATTER_SPINUP_TAU);
    expect(next.angle).toBeGreaterThan(0);
  });

  it('keeps the angle wrapped into [0, 360) so it never grows unbounded', () => {
    const next = stepPlatter({ angle: 350, velocity: PLATTER_FULL_DPS }, 1, PLATTER_FULL_DPS, PLATTER_SPINUP_TAU);
    expect(next.angle).toBeGreaterThanOrEqual(0);
    expect(next.angle).toBeLessThan(360);
    expect(next.angle).toBeCloseTo(80, 5);
  });

  it('is a no-op for a non-positive frame delta (paused/zero-length frame)', () => {
    const start: PlatterState = { angle: 42, velocity: 30 };
    expect(stepPlatter(start, 0, PLATTER_FULL_DPS, PLATTER_SPINUP_TAU)).toEqual(start);
    expect(stepPlatter(start, -0.016, PLATTER_FULL_DPS, PLATTER_SPINUP_TAU)).toEqual(start);
  });

  it('updates velocity frame-rate independently (one big step == two half steps)', () => {
    const one = stepPlatter({ angle: 0, velocity: 0 }, 0.2, PLATTER_FULL_DPS, PLATTER_SPINUP_TAU);
    const two = run({ angle: 0, velocity: 0 }, 2, 0.1, PLATTER_FULL_DPS, PLATTER_SPINUP_TAU);
    expect(two.velocity).toBeCloseTo(one.velocity, 10);
  });

  it('approaches more slowly with a larger time constant (heavy platter coasts longer)', () => {
    const fast = stepPlatter({ angle: 0, velocity: PLATTER_FULL_DPS }, 0.1, 0, PLATTER_SPINUP_TAU);
    const slow = stepPlatter({ angle: 0, velocity: PLATTER_FULL_DPS }, 0.1, 0, PLATTER_SPINDOWN_TAU);
    // both are slowing from full speed; the larger-tau (spindown) one sheds less speed per frame
    expect(slow.velocity).toBeGreaterThan(fast.velocity);
  });
});
