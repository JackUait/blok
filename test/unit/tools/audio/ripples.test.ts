import { describe, it, expect } from 'vitest';
import {
  findBeats,
  beatsCrossed,
  rippleLift,
  smoothLevel,
  kickAt,
  rippleInk,
  RIPPLE_LIFE,
  RIPPLE_SPEED,
} from '../../../../src/tools/audio/ripples';

describe('findBeats', () => {
  it('marks a bar that jumps well above the bars just before it', () => {
    const peaks = [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.9, 0.9, 0.2, 0.2];

    expect(findBeats(peaks).map((b) => b.index)).toEqual([6]);
  });

  it('ignores a steady loud passage', () => {
    expect(findBeats(new Array<number>(40).fill(0.8))).toEqual([]);
  });

  it('keeps beats a few bars apart so one hit is one ripple', () => {
    const peaks = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.6, 0.8, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.9];

    expect(findBeats(peaks).map((b) => b.index)).toEqual([6, 16]);
  });

  it('ripples harder for the big hits than the small ones in the same track', () => {
    // Every 5th bar is a hit; every other hit is a big one.
    const peaks = Array.from({ length: 100 }, (_, i) => {
      if (i % 10 === 0) return 0.95;
      if (i % 10 === 5) return 0.89;
      return 0.84;
    });
    const beats = findBeats(peaks);
    const big = beats.filter((b) => b.index % 10 === 0);
    const small = beats.filter((b) => b.index % 10 === 5);

    expect(big.length).toBeGreaterThan(0);
    expect(small.length).toBeGreaterThan(0);
    expect(Math.max(...small.map((b) => b.strength))).toBeLessThan(Math.min(...big.map((b) => b.strength)));
    expect(big.every((b) => b.strength === 1)).toBe(true);
  });

  it('finds the hits in a loud, compressed track', () => {
    // Real mixes sit near full scale; hits are small bumps on a high floor.
    const peaks = Array.from({ length: 60 }, (_, i) => (i % 5 === 0 ? 0.9 : 0.84 + (i % 3) * 0.005));
    const hits = findBeats(peaks).map((b) => b.index);

    expect(hits.length).toBeGreaterThanOrEqual(9);
    expect(hits.every((i) => i % 5 === 0)).toBe(true);
  });
});

describe('beatsCrossed', () => {
  const beats = [10, 20, 30].map((index) => ({ index, strength: 1 }));

  it('returns beats the playhead passed this frame', () => {
    expect(beatsCrossed(beats, 9.5, 10.2).map((b) => b.index)).toEqual([10]);
    expect(beatsCrossed(beats, 10.2, 19.9).map((b) => b.index)).toEqual([]);
  });

  it('includes a beat exactly at the new position but not the old one', () => {
    expect(beatsCrossed(beats, 10, 20).map((b) => b.index)).toEqual([20]);
  });

  it('fires nothing when the playhead jumps (seek), backward or far forward', () => {
    expect(beatsCrossed(beats, 25, 5).map((b) => b.index)).toEqual([]);
    expect(beatsCrossed(beats, 0, 40).map((b) => b.index)).toEqual([]);
  });
});

describe('rippleLift', () => {
  it('puts the crest where the ripple has travelled to', () => {
    const age = 0.2;
    const crest = RIPPLE_SPEED * age;

    expect(rippleLift(crest, age)).toBeGreaterThan(rippleLift(crest - 4, age));
    expect(rippleLift(crest, age)).toBeGreaterThan(rippleLift(crest + 4, age));
  });

  it('travels both ways from the origin', () => {
    expect(rippleLift(-5, 0.15)).toBeCloseTo(rippleLift(5, 0.15), 10);
  });

  it('fades as it ages and is gone after its life', () => {
    const early = rippleLift(RIPPLE_SPEED * 0.1, 0.1);
    const late = rippleLift(RIPPLE_SPEED * 0.5, 0.5);

    expect(late).toBeLessThan(early);
    expect(rippleLift(RIPPLE_SPEED * RIPPLE_LIFE, RIPPLE_LIFE)).toBe(0);
    expect(rippleLift(0, -0.01)).toBe(0);
  });

  it('scales with strength', () => {
    expect(rippleLift(0, 0, 0.5)).toBeCloseTo(rippleLift(0, 0, 1) / 2, 10);
  });
});

describe('smoothLevel', () => {
  it('rises faster than it falls', () => {
    const up = smoothLevel(0, 1, 1 / 60);
    const down = 1 - smoothLevel(1, 0, 1 / 60);

    expect(up).toBeGreaterThan(down);
  });

  it('is frame-rate independent', () => {
    const once = smoothLevel(0.2, 0.9, 2 / 60);
    const twice = smoothLevel(smoothLevel(0.2, 0.9, 1 / 60), 0.9, 1 / 60);

    expect(once).toBeCloseTo(twice, 10);
  });

  it('holds still on a zero or negative step', () => {
    expect(smoothLevel(0.4, 1, 0)).toBe(0.4);
    expect(smoothLevel(0.4, 1, -1)).toBe(0.4);
  });
});

describe('kickAt', () => {
  it('is strongest the moment a ripple starts and decays to nothing', () => {
    const fresh = kickAt([{ age: 0, strength: 1 }]);
    const old = kickAt([{ age: 0.3, strength: 1 }]);

    expect(fresh).toBe(1);
    expect(old).toBeLessThan(0.2);
    expect(kickAt([])).toBe(0);
  });

  it('never exceeds 1 when ripples overlap', () => {
    expect(kickAt([{ age: 0, strength: 1 }, { age: 0, strength: 1 }])).toBe(1);
  });
});

describe('rippleInk', () => {
  it('inks a full-strength crest fully and leaves untouched bars alone', () => {
    expect(rippleInk(rippleLift(0, 0, 1))).toBe(1);
    expect(rippleInk(0)).toBe(0);
  });

  it('never goes past full ink when crests overlap', () => {
    expect(rippleInk(rippleLift(0, 0, 1) * 3)).toBe(1);
  });

  it('inks a weak ripple partly', () => {
    const ink = rippleInk(rippleLift(0, 0, 0.4));

    expect(ink).toBeGreaterThan(0);
    expect(ink).toBeLessThan(1);
  });
});
