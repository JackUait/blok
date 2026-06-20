import { describe, it, expect } from 'vitest';
import {
  LAYOUTS,
  CARD_KEYS,
  SLOT_CONTENT_PX,
  FACE_PAD,
  CARD_WIDTH,
  TRANSIT_Z,
  TRANSIT_Z_GAP,
  VIEW_KEYS,
  posesForVariant,
  pickNextAnimation,
  createKindSequencer,
  type CardKey,
  type Variant,
} from './heroFormations';

/** Axis-aligned box (centre x/y, width/height) for a card in a given pose. */
const boxFor = (slot: (typeof CARD_KEYS)[number], pose: Variant[number]['pose']) => {
  const [x, y, , scale] = pose;
  return {
    x,
    y,
    w: CARD_WIDTH * scale,
    h: (SLOT_CONTENT_PX[slot] + FACE_PAD) * scale,
  };
};

/** Two boxes collide when they overlap on BOTH axes beyond a small tolerance. */
const collide = (a: ReturnType<typeof boxFor>, b: ReturnType<typeof boxFor>): boolean => {
  const TOL = 2; // px of allowed overlap
  const sepX = Math.abs(a.x - b.x) - (a.w + b.w) / 2;
  const sepY = Math.abs(a.y - b.y) - (a.h + b.h) / 2;
  return sepX < -TOL && sepY < -TOL;
};

describe('LAYOUTS matrix', () => {
  const cells = Object.entries(LAYOUTS).flatMap(([view, counts]) =>
    Object.entries(counts).flatMap(([count, variants]) =>
      variants.map((variant, vi) => ({ view, count: Number(count), variant, vi }))
    )
  );

  it('has at least one cell', () => {
    expect(cells.length).toBeGreaterThan(0);
  });

  it('authors exactly the required (view, count) cells', () => {
    const required: Record<string, number[]> = {
      stack: [2, 3, 4],
      explode: [2, 3, 4],
      cascade: [2, 3, 4],
      orbit: [3, 4],
    };
    for (const [view, counts] of Object.entries(required)) {
      const present = Object.keys(LAYOUTS[view] ?? {})
        .map(Number)
        .sort((a, b) => a - b);
      expect(present, `${view} counts`).toEqual(counts);
    }
    // No extra views beyond the required set.
    expect(Object.keys(LAYOUTS).sort()).toEqual(Object.keys(required).sort());
  });

  it('never overlaps two cards within any variant', () => {
    for (const { view, count, variant, vi } of cells) {
      for (let i = 0; i < variant.length; i++) {
        for (let j = i + 1; j < variant.length; j++) {
          const a = boxFor(variant[i].slot, variant[i].pose);
          const b = boxFor(variant[j].slot, variant[j].pose);
          expect(
            collide(a, b),
            `${view}@${count} variant ${vi}: "${variant[i].slot}" overlaps "${variant[j].slot}"`
          ).toBe(false);
        }
      }
    }
  });

  it('keeps a wander-safe margin between every pair of resting cards', () => {
    // The no-overlap test above allows cards to come within ~2px of each other. But the
    // perpetual `hero-wander` CSS drift (±7px per card, so ~14px of mutual closure) composes
    // on top of the resting formation at runtime — so two cards that merely "don't overlap"
    // at rest can still touch/interpenetrate once they drift. Every pair must therefore keep a
    // real gap on its separating axis, comfortably past the drift budget. (Was violated by the
    // orbit ring: orbit@3 left only ~14px between its two lower cards, orbit@4 ~12px.)
    const WANDER_MARGIN = 22;
    const violations: string[] = [];
    for (const { view, count, variant, vi } of cells) {
      for (let i = 0; i < variant.length; i++) {
        for (let j = i + 1; j < variant.length; j++) {
          const a = boxFor(variant[i].slot, variant[i].pose);
          const b = boxFor(variant[j].slot, variant[j].pose);
          const sepX = Math.abs(a.x - b.x) - (a.w + b.w) / 2;
          const sepY = Math.abs(a.y - b.y) - (a.h + b.h) / 2;
          // Non-overlapping boxes are separated on at least one axis (its sep is positive);
          // that separating gap is the one the drift can eat into.
          const gap = Math.max(sepX, sepY);
          if (gap < WANDER_MARGIN) {
            violations.push(
              `${view}@${count}#${vi}: "${variant[i].slot}"↔"${variant[j].slot}" gap ${gap.toFixed(1)}px`
            );
          }
        }
      }
    }
    expect(violations, `cards closer than ${WANDER_MARGIN}px:\n${violations.join('\n')}`).toEqual([]);
  });

  it('uses a number of cards equal to its count key', () => {
    for (const { view, count, variant, vi } of cells) {
      expect(variant.length, `${view}@${count} variant ${vi}`).toBe(count);
    }
  });

  it('uses only valid, non-duplicated slots within a variant', () => {
    for (const { view, count, variant, vi } of cells) {
      const slots = variant.map((v) => v.slot);
      for (const s of slots) {
        expect(CARD_KEYS, `${view}@${count} variant ${vi}`).toContain(s);
      }
      expect(new Set(slots).size, `${view}@${count} variant ${vi} has duplicate slot`).toBe(
        slots.length
      );
    }
  });

  it('uses a nested, view-consistent slot set per count so non-decreasing counts morph', () => {
    // Every count reuses the SAME slots across all views, and the sets nest
    // ({a,d} ⊂ {a,c,d} ⊂ {a,b,c,d}). With this, any same-or-higher count keeps every
    // currently-active card (they flip-morph into the new arrangement) and only a count
    // DECREASE removes one — so a block never vanishes-and-another-appears on a non-drop.
    const CANON: Record<number, string[]> = {
      2: ['a', 'd'],
      3: ['a', 'c', 'd'],
      4: ['a', 'b', 'c', 'd'],
    };
    for (const [view, counts] of Object.entries(LAYOUTS)) {
      for (const [count, variants] of Object.entries(counts)) {
        const expected = [...CANON[Number(count)]].sort();
        for (const variant of variants) {
          const slots = variant.map((entry) => entry.slot).sort();
          expect(slots, `${view}@${count}`).toEqual(expected);
        }
      }
    }
    // The chain nests, which is what guarantees the morph-on-non-decrease behaviour.
    expect(CANON[2].every((s) => CANON[3].includes(s)), '2 ⊂ 3').toBe(true);
    expect(CANON[3].every((s) => CANON[4].includes(s)), '3 ⊂ 4').toBe(true);
  });

  it('authors only counts between 2 and 4', () => {
    for (const { view, count } of cells) {
      expect(count, view).toBeGreaterThanOrEqual(2);
      expect(count, view).toBeLessThanOrEqual(4);
    }
  });
});

describe('TRANSIT_Z depth lanes', () => {
  // The static formations are collision-free in 2D, but the curved paths between them let
  // two cards sweep through the same screen region at once. Pinning each slot to a distinct,
  // well-separated depth lane at the transition waypoint keeps the bunched cards depth-sorted,
  // so an overlap reads as one slab sliding cleanly OVER another instead of interpenetrating.
  it('gives every slot a distinct, strictly increasing depth lane', () => {
    const lanes = CARD_KEYS.map((slot) => TRANSIT_Z[slot]);
    for (let i = 1; i < lanes.length; i++) {
      expect(lanes[i] - lanes[i - 1], `${CARD_KEYS[i - 1]}→${CARD_KEYS[i]}`).toBeGreaterThanOrEqual(
        TRANSIT_Z_GAP
      );
    }
  });

  it('separates any two slots enough to occlude without z-fighting', () => {
    for (let i = 0; i < CARD_KEYS.length; i++) {
      for (let j = i + 1; j < CARD_KEYS.length; j++) {
        expect(
          Math.abs(TRANSIT_Z[CARD_KEYS[i]] - TRANSIT_Z[CARD_KEYS[j]]),
          `${CARD_KEYS[i]}/${CARD_KEYS[j]}`
        ).toBeGreaterThanOrEqual(TRANSIT_Z_GAP);
      }
    }
  });

  it('keeps every formation’s active cards on separate depth lanes', () => {
    for (const [view, counts] of Object.entries(LAYOUTS)) {
      for (const [count, variants] of Object.entries(counts)) {
        for (const variant of variants) {
          const lanes = variant.map((entry) => TRANSIT_Z[entry.slot]).sort((a, b) => a - b);
          for (let i = 1; i < lanes.length; i++) {
            expect(lanes[i] - lanes[i - 1], `${view}@${count}`).toBeGreaterThanOrEqual(TRANSIT_Z_GAP);
          }
        }
      }
    }
  });
});

describe('pickNextAnimation', () => {
  // Deterministic PRNG so the sequence is reproducible across runs.
  const mulberry32 = (seed: number) => () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const runSequence = (seed: number, steps: number) => {
    const rng = mulberry32(seed);
    const out: { view: string; count: number; variantIndex: number }[] = [];
    let prev: { view: string; viewBefore: string; count: number } | null = null;
    for (let i = 0; i < steps; i++) {
      const choice = pickNextAnimation(prev, rng);
      out.push(choice);
      prev = { view: choice.view, viewBefore: prev?.view ?? '__initial__', count: choice.count };
    }
    return out;
  };

  it('never repeats the view, the count, or the full signature back-to-back', () => {
    for (const seed of [1, 7, 42, 1234, 99999]) {
      const seq = runSequence(seed, 400);
      for (let i = 1; i < seq.length; i++) {
        const a = seq[i - 1];
        const b = seq[i];
        expect(b.view, `seed ${seed} @${i}: view repeated`).not.toBe(a.view);
        expect(b.count, `seed ${seed} @${i}: count repeated`).not.toBe(a.count);
        const sig = (x: typeof a) => `${x.view}@${x.count}#${x.variantIndex}`;
        expect(sig(b), `seed ${seed} @${i}: signature repeated`).not.toBe(sig(a));
      }
    }
  });

  it('never echoes the view from two steps back', () => {
    const seq = runSequence(2024, 400);
    for (let i = 2; i < seq.length; i++) {
      expect(seq[i].view, `@${i}: view echoed the one before last`).not.toBe(seq[i - 2].view);
    }
  });

  it('only ever picks real views, counts, and variant indices', () => {
    const seq = runSequence(5, 300);
    for (const { view, count, variantIndex } of seq) {
      expect(VIEW_KEYS).toContain(view);
      expect(LAYOUTS[view][count], `${view}@${count}`).toBeDefined();
      expect(variantIndex).toBeGreaterThanOrEqual(0);
      expect(variantIndex).toBeLessThan(LAYOUTS[view][count].length);
    }
  });
});

describe('createKindSequencer', () => {
  // Deterministic PRNG so the dealt order is reproducible across runs.
  const mulberry32 = (seed: number) => () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Pool shape mirrors the real hero: a deep media slot (c) plus shallow ones.
  const POOLS: Record<CardKey, readonly string[]> = {
    a: ['heading', 'quote', 'callout'],
    b: ['todo', 'bulletList'],
    c: ['image', 'table', 'bookmarkRich', 'video', 'embed', 'embedSocial', 'embedMap', 'database', 'bookmark', 'audio', 'columns'],
    d: ['code', 'toggle', 'numberList'],
  };

  /** Run the sequencer `count` times and return each slot's column of dealt kinds. */
  const columns = (seq: ReturnType<typeof createKindSequencer<string>>, count: number) => {
    const draws = Array.from({ length: count }, () => seq.next());
    return Object.fromEntries(CARD_KEYS.map((slot) => [slot, draws.map((d) => d[slot])])) as Record<
      CardKey,
      string[]
    >;
  };

  it('deals every kind in a slot exactly once per pool-sized window (no clustering)', () => {
    // The whole point: a block can never appear twice before its pool-mates have each appeared
    // once. So every consecutive window the size of the pool is a full permutation of the pool —
    // perfectly even airtime, the opposite of uniform-random sampling's clumps.
    const seq = createKindSequencer(POOLS, mulberry32(1));
    const cols = columns(seq, POOLS.c.length * 6);
    for (const slot of CARD_KEYS) {
      const pool = [...POOLS[slot]].sort();
      const col = cols[slot];
      for (let start = 0; start + POOLS[slot].length <= col.length; start += POOLS[slot].length) {
        const window = col.slice(start, start + POOLS[slot].length).sort();
        expect(window, `${slot} window @${start}`).toEqual(pool);
      }
    }
  });

  it('never repeats a slot’s kind back-to-back, even across bag seams', () => {
    const seq = createKindSequencer(POOLS, mulberry32(42));
    const cols = columns(seq, POOLS.c.length * 6);
    for (const slot of CARD_KEYS) {
      const col = cols[slot];
      for (let i = 1; i < col.length; i++) {
        expect(col[i], `${slot} repeated at ${i}`).not.toBe(col[i - 1]);
      }
    }
  });

  it('keeps every kind’s long-run frequency within one of perfectly even', () => {
    // Across whole cycles each kind in a slot is dealt the same number of times (±1 for a
    // partial trailing cycle) — there is no favoured block.
    const seq = createKindSequencer(POOLS, mulberry32(7));
    const cols = columns(seq, 330);
    for (const slot of CARD_KEYS) {
      const counts = POOLS[slot].map((k) => cols[slot].filter((x) => x === k).length);
      expect(Math.max(...counts) - Math.min(...counts), `${slot} spread`).toBeLessThanOrEqual(1);
    }
  });

  it('honours the seeded current kind so the first deal differs from the opening quartet', () => {
    const initial: Record<CardKey, string> = { a: 'heading', b: 'todo', c: 'image', d: 'code' };
    for (const seed of [1, 2, 3, 99]) {
      const first = createKindSequencer(POOLS, mulberry32(seed), initial).next();
      for (const slot of CARD_KEYS) {
        expect(first[slot], `seed ${seed} slot ${slot}`).not.toBe(initial[slot]);
      }
    }
  });

  it('returns the sole kind for a single-element pool', () => {
    const pools: Record<CardKey, readonly string[]> = { a: ['solo'], b: ['x', 'y'], c: ['m', 'n'], d: ['p', 'q'] };
    const seq = createKindSequencer(pools, mulberry32(2));
    for (let i = 0; i < 6; i++) expect(seq.next().a).toBe('solo');
  });
});

describe('posesForVariant', () => {
  it('returns one pose per card, parking absent slots', () => {
    const variant = LAYOUTS.stack[2][0];
    const poses = posesForVariant(variant);

    expect(poses).toHaveLength(CARD_KEYS.length);
    const activeSlots = new Set(variant.map((entry) => entry.slot));
    CARD_KEYS.forEach((slot, i) => {
      if (activeSlots.has(slot)) {
        expect(poses[i].scale).toBeGreaterThan(0);
      } else {
        expect(poses[i].scale).toBe(0);
      }
    });
  });
});
