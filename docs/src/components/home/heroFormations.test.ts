import { describe, it, expect } from 'vitest';
import {
  LAYOUTS,
  CARD_KEYS,
  SLOT_CONTENT_PX,
  FACE_PAD,
  CARD_WIDTH,
  posesForVariant,
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
      stack: [1, 2, 3, 4, 5],
      explode: [2, 3, 4, 5],
      cascade: [2, 3, 4, 5],
      orbit: [3, 4, 5],
    };
    for (const [view, counts] of Object.entries(required)) {
      for (const count of counts) {
        expect(LAYOUTS[view]?.[count], `${view}@${count} missing`).toBeDefined();
      }
    }
    // No extra views beyond the required set.
    expect(Object.keys(LAYOUTS).sort()).toEqual(Object.keys(required).sort());
  });

  it('gives stack@1 three single-card variants', () => {
    expect(LAYOUTS.stack[1]).toHaveLength(3);
    for (const variant of LAYOUTS.stack[1]) {
      expect(variant).toHaveLength(1);
    }
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

  it('authors only counts between 1 and 5', () => {
    for (const { view, count } of cells) {
      expect(count, view).toBeGreaterThanOrEqual(1);
      expect(count, view).toBeLessThanOrEqual(5);
    }
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
