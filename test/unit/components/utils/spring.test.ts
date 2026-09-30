import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpring, SPRING_SNAPPY } from '../../../../src/components/utils/spring';
import { fakeFrameClock } from '../../helpers/fake-frame-clock';

describe('createSpring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('settles every value on its target and reports it once', () => {
    const { clock, advance } = fakeFrameClock();
    const onSettle = vi.fn();
    const seen: number[] = [];
    const spring = createSpring({
      from: { x: 0, y: 10 },
      clock,
      reducedMotion: () => false,
      onUpdate: (v) => seen.push(v.x),
      onSettle,
    });

    spring.to({ x: 100, y: -10 });
    advance(3000);

    expect(spring.values()).toEqual({ x: 100, y: -10 });
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(spring.isSettled()).toBe(true);
    expect(seen.length).toBeGreaterThan(5);
  });

  it('keeps its velocity when retargeted mid-flight', () => {
    const { clock, advance } = fakeFrameClock();
    const spring = createSpring({ from: { x: 0 }, clock, reducedMotion: () => false, onUpdate: () => {} });

    spring.to({ x: 100 });
    advance(64);
    const before = spring.values().x;

    // The new target is behind the value; a spring that dropped its velocity would move back at once.
    spring.to({ x: before - 1 });
    advance(16);

    expect(spring.values().x).toBeGreaterThan(before);
  });

  it('gives the same result at any frame rate', () => {
    const run = (frameMs: number): number => {
      const { clock, advance } = fakeFrameClock();
      const spring = createSpring({ from: { x: 0 }, clock, reducedMotion: () => false, onUpdate: () => {} });

      spring.to({ x: 100 });
      advance(96, frameMs);

      return spring.values().x;
    };

    expect(run(8)).toBeCloseTo(run(32), 6);
  });

  it('jumps straight to the target when motion is reduced', () => {
    const { clock } = fakeFrameClock();
    const onUpdate = vi.fn();
    const onSettle = vi.fn();
    const spring = createSpring({ from: { x: 0 }, clock, reducedMotion: () => true, onUpdate, onSettle });

    spring.to({ x: 42 });

    expect(spring.values().x).toBe(42);
    expect(onUpdate).toHaveBeenLastCalledWith({ x: 42 });
    expect(onSettle).toHaveBeenCalledTimes(1);
  });

  it('jump() moves without animating and drops velocity', () => {
    const { clock, advance } = fakeFrameClock();
    const spring = createSpring({ from: { x: 0 }, config: SPRING_SNAPPY, clock, reducedMotion: () => false, onUpdate: () => {} });

    spring.to({ x: 100 });
    advance(32);
    spring.stop();
    spring.jump({ x: 5 });
    advance(200);

    expect(spring.values().x).toBe(5);
  });
});
