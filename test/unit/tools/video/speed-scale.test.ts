import { describe, it, expect } from 'vitest';
import {
  PEG_GRAB,
  PEG_HOLD,
  SPEED_MAX,
  SPEED_MIN,
  SPEED_PEGS,
  SPEED_SLIDER_STEP,
  WIRE_MAX,
  WIRE_MIN,
  clampRate,
  fractionToRate,
  rateToFraction,
  resolveDrag,
  snapRate,
} from '../../../../src/tools/video/speed-scale';

const everyStep = (): number[] =>
  Array.from({ length: Math.round((WIRE_MAX - WIRE_MIN) / SPEED_SLIDER_STEP) + 1 }, (_, i) =>
    Math.round((WIRE_MIN + i * SPEED_SLIDER_STEP) * 100) / 100);

describe('speed scale — pegs', () => {
  it('has five pegs from the slowest speed to the fastest', () => {
    expect(SPEED_PEGS).toEqual([0.25, 0.5, 1, 1.5, 2]);
  });

  it('spaces the pegs equally along the wire', () => {
    expect(SPEED_PEGS.map(rateToFraction)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});

describe('speed scale — rate and fraction', () => {
  it('gives each stretch between two pegs a quarter of the wire', () => {
    expect(rateToFraction(0.375)).toBeCloseTo(0.125, 10);
    expect(rateToFraction(0.75)).toBeCloseTo(0.375, 10);
    expect(rateToFraction(1.25)).toBeCloseTo(0.625, 10);
    expect(rateToFraction(1.75)).toBeCloseTo(0.875, 10);
  });

  it('maps every 0.05 step there and back', () => {
    for (const rate of everyStep()) {
      expect(snapRate(fractionToRate(rateToFraction(rate)))).toBe(rate);
    }
  });

  it('keeps a pointer past either end of the wire inside the range', () => {
    expect(fractionToRate(-1)).toBe(WIRE_MIN);
    expect(fractionToRate(2)).toBe(WIRE_MAX);
    expect(rateToFraction(0)).toBe(0);
    expect(rateToFraction(9)).toBe(1);
  });

  it('rises all the way along the wire', () => {
    const fractions = everyStep().map(rateToFraction);

    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(new Set(fractions).size).toBe(fractions.length);
  });
});

describe('speed scale — clamp and snap', () => {
  it('snaps to the nearest 0.05 inside the range', () => {
    expect(snapRate(1.33)).toBe(1.35);
    expect(snapRate(1.32)).toBe(1.3);
    expect(snapRate(0.04)).toBe(SPEED_MIN);
    expect(snapRate(7)).toBe(SPEED_MAX);
  });

  it('clamps without moving a value off its two decimals', () => {
    expect(clampRate(9)).toBe(SPEED_MAX);
    expect(clampRate(0)).toBe(SPEED_MIN);
    expect(clampRate(1.333)).toBe(1.33);
  });
});

describe('speed scale — a typed speed reaches past the wire', () => {
  it('runs from 0.1x to 3x, wider than the wire\'s 0.25x to 2x', () => {
    expect([SPEED_MIN, SPEED_MAX]).toEqual([0.1, 3]);
    expect([WIRE_MIN, WIRE_MAX]).toEqual([0.25, 2]);
    expect(clampRate(2.7)).toBe(2.7);
    expect(clampRate(0.1)).toBe(0.1);
  });

  it('rests the bead at the end of the wire for a speed past it', () => {
    expect(rateToFraction(3)).toBe(1);
    expect(rateToFraction(2.5)).toBe(1);
    expect(rateToFraction(0.1)).toBe(0);
    expect(rateToFraction(0.15)).toBe(0);
  });
});

describe('speed scale — a peg grabs and holds the bead', () => {
  it('grabs from just inside its reach and not from just outside', () => {
    expect(resolveDrag(0.5 + PEG_GRAB - 0.001, null)).toEqual({ rate: 1, held: 1 });
    expect(resolveDrag(0.5 - PEG_GRAB + 0.001, null)).toEqual({ rate: 1, held: 1 });
    expect(resolveDrag(0.5 + PEG_GRAB + 0.002, null).held).toBeNull();
  });

  it('holds on further than it grabs', () => {
    expect(PEG_HOLD).toBeGreaterThan(PEG_GRAB);
    expect(resolveDrag(0.5 + PEG_HOLD - 0.001, 1)).toEqual({ rate: 1, held: 1 });
    expect(resolveDrag(0.5 + PEG_HOLD + 0.002, 1).held).toBeNull();
  });

  it('gives the plain 0.05 step between pegs', () => {
    expect(resolveDrag(0.6, null)).toEqual({ rate: 1.2, held: null });
    expect(resolveDrag(0.125, null)).toEqual({ rate: 0.4, held: null });
  });

  it('hands the bead from one peg to the next when the pointer jumps', () => {
    expect(resolveDrag(0.74, 1)).toEqual({ rate: 1.5, held: 1.5 });
  });

  it('leaves every speed between 0.25× and 0.5× reachable by dragging', () => {
    const drag = (fractions: number[]): number[] => {
      const seen: number[] = [];
      const state = { held: null as number | null };

      for (const fraction of fractions) {
        const next = resolveDrag(fraction, state.held);

        state.held = next.held;
        if (seen.at(-1) !== next.rate) seen.push(next.rate);
      }

      return seen;
    };
    const sweep = Array.from({ length: 251 }, (_, i) => i / 1000);
    const leftward = drag([...sweep].reverse());
    const rightward = drag(sweep);

    expect(leftward[0]).toBe(0.5);
    expect(leftward.at(-1)).toBe(0.25);
    expect(rightward[0]).toBe(0.25);
    expect(rightward.at(-1)).toBe(0.5);
    expect(leftward).toEqual(expect.arrayContaining([0.4, 0.35, 0.3]));
    expect(rightward).toEqual(expect.arrayContaining([0.35, 0.4, 0.45]));
  });

  it('grabs at both ends of the wire', () => {
    expect(resolveDrag(0, null)).toEqual({ rate: WIRE_MIN, held: WIRE_MIN });
    expect(resolveDrag(1, null)).toEqual({ rate: WIRE_MAX, held: WIRE_MAX });
  });
});
