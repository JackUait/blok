/* Hero formation geometry + the hand-authored layout matrix.
 *
 * Each `(view, count)` cell holds one or more variants. A variant names exactly which
 * cards take part and the pose each one holds, so every on-screen arrangement was tuned
 * by hand with the real card heights in mind — no runtime subsetting, no collisions.
 * The overlap invariant is enforced by heroFormations.test.ts. */

export type CardKey = 'a' | 'b' | 'c' | 'd' | 'e';
export const CARD_KEYS: readonly CardKey[] = ['a', 'b', 'c', 'd', 'e'];

/** `[x, y, rotZ, scale, rotX, rotY, skewX, z]` in stack-centre px. */
export type FormTuple = readonly [number, number, number, number, number, number, number, number];

export interface VariantEntry {
  slot: CardKey;
  pose: FormTuple;
}
export type Variant = readonly VariantEntry[];

/** Resting vertical centre of each card relative to the stack centre (px) — the flex-column
 *  flow position, used so a pose's `y` maps straight to an on-screen y. */
export const REST_Y: Record<CardKey, number> = { a: -218, b: -135, c: -21, d: 100, e: 204 };

/** Content-box height (px) per slot — the `SLOT_BODY_H` value. Face height = this + FACE_PAD. */
export const SLOT_CONTENT_PX: Record<CardKey, number> = { a: 36, b: 42, c: 98, d: 56, e: 64 };
/** p-3.5 (28px) + 2px border. */
export const FACE_PAD = 30;
/** Worst-case card width (sm:w-80) used for collision-free authoring. */
export const CARD_WIDTH = 320;

const v = (...entries: VariantEntry[]): Variant => entries;
const e = (slot: CardKey, pose: FormTuple): VariantEntry => ({ slot, pose });

/** The matrix. A view authors only the counts that read well at that view; a missing count
 *  is simply skipped for that view. Counts present overall span 1..5. */
export const LAYOUTS: Record<string, Record<number, readonly Variant[]>> = {
  // Vertical column, depth-layered — the resting reader. Does every count 1..5.
  stack: {
    1: [v(e('c', [0, 0, 0, 1, 0, 8, 0, 0])), v(e('d', [0, 0, 0, 1, 0, 8, 0, 0])), v(e('a', [0, 0, 0, 1, 0, 8, 0, 0]))],
    2: [
      v(e('a', [0, -74, 0, 0.92, 0, 6, 0, 30]), e('c', [0, 80, 0, 0.92, 0, -6, 0, -30])),
      v(e('b', [0, -74, 0, 0.92, 0, 6, 0, 30]), e('d', [0, 80, 0, 0.92, 0, -6, 0, -30])),
    ],
    3: [v(e('a', [0, -120, 0, 0.88, 0, 6, 0, 40]), e('c', [0, 0, 0, 0.88, 0, 0, 0, 0]), e('d', [0, 120, 0, 0.88, 0, -6, 0, -40]))],
    4: [
      v(
        e('a', [0, -165, 0, 0.9, 0, 5, 0, 50]),
        e('b', [0, -70, 0, 0.9, 0, 5, 0, 18]),
        e('c', [0, 45, 0, 0.9, 0, -5, 0, -18]),
        e('d', [0, 165, 0, 0.9, 0, -5, 0, -50])
      ),
    ],
    5: [
      v(
        e('a', [0, -173, 0, 0.8, 0, 5, 0, 60]),
        e('b', [0, -108, 0, 0.8, 0, 5, 0, 30]),
        e('c', [0, -13, 0, 0.8, 0, 0, 0, 0]),
        e('d', [0, 87, 0, 0.8, 0, -5, 0, -30]),
        e('e', [0, 172, 0, 0.8, 0, -5, 0, -60])
      ),
    ],
  },
  // Regional burst — quadrants at varied depth + tilt. 1 skipped (one card can't "explode").
  explode: {
    2: [
      v(e('c', [-118, -70, -5, 0.8, 5, 12, 0, 50]), e('d', [120, 80, 4, 0.8, -5, -12, 0, -50])),
      v(e('a', [-118, -70, -5, 0.8, 5, 12, 0, 50]), e('e', [120, 80, 4, 0.8, -5, -12, 0, -50])),
    ],
    3: [
      v(
        e('a', [-130, -82, -5, 0.74, 5, 12, 0, 55]),
        e('e', [130, -74, 5, 0.74, 5, -12, 0, -40]),
        e('c', [0, 100, 0, 0.78, -5, 0, 0, 15])
      ),
    ],
    4: [
      v(
        e('a', [-138, -78, -5, 0.77, 5, 13, 0, 64]),
        e('b', [132, -98, 5, 0.75, 6, -14, 0, -48]),
        e('c', [-116, 102, 6, 0.79, -6, 12, 0, 32]),
        e('d', [148, 86, -4, 0.77, -5, -13, 0, -68])
      ),
    ],
    5: [
      v(
        e('a', [-132, -92, -5, 0.72, 5, 12, 0, 60]),
        e('b', [134, -96, 5, 0.7, 6, -13, 0, 40]),
        e('d', [-138, 94, 6, 0.72, -6, 12, 0, -40]),
        e('e', [140, 92, -5, 0.7, -6, -12, 0, -60]),
        e('c', [0, 0, 0, 0.6, 0, 0, 0, 85])
      ),
    ],
  },
  // Diagonal staircase plunging into depth — equal scale, evenly stepped. 1 skipped.
  cascade: {
    2: [
      v(e('a', [-92, -96, -6, 0.85, 0, 10, 0, 45]), e('d', [92, 96, -6, 0.85, 0, 10, 0, -45])),
      v(e('b', [-92, -96, -6, 0.85, 0, 10, 0, 45]), e('e', [92, 96, -6, 0.85, 0, 10, 0, -45])),
    ],
    3: [
      v(
        e('a', [-122, -122, -6, 0.82, 0, 11, 0, 50]),
        e('c', [0, 0, -6, 0.82, 0, 11, 0, 0]),
        e('e', [122, 122, -6, 0.82, 0, 11, 0, -50])
      ),
    ],
    4: [
      v(
        e('a', [-140, -162, -6, 0.86, 0, 12, 0, 64]),
        e('b', [-47, -54, -6, 0.86, 0, 12, 0, 22]),
        e('c', [47, 54, -6, 0.86, 0, 12, 0, -22]),
        e('d', [140, 162, -6, 0.86, 0, 12, 0, -64])
      ),
    ],
    5: [
      v(
        e('a', [-150, -180, -6, 0.78, 0, 11, 0, 64]),
        e('b', [-75, -90, -6, 0.78, 0, 11, 0, 32]),
        e('c', [0, 0, -6, 0.78, 0, 11, 0, 0]),
        e('d', [75, 90, -6, 0.78, 0, 11, 0, -32]),
        e('e', [150, 180, -6, 0.78, 0, 11, 0, -64])
      ),
    ],
  },
  // Spinning ring — needs >=3 to read as an orbit. 1 and 2 skipped.
  orbit: {
    3: [
      v(
        e('a', [0, -128, 0, 0.68, 0, 0, 0, 60]),
        e('c', [-116, 64, 0, 0.68, 0, 0, 0, -60]),
        e('d', [116, 64, 0, 0.68, 0, 0, 0, 60])
      ),
    ],
    4: [
      v(
        e('a', [0, -134, 0, 0.8, 0, 0, 0, 80]),
        e('b', [134, 0, 0, 0.8, 0, 0, 0, -80]),
        e('c', [0, 134, 0, 0.8, 0, 0, 0, 80]),
        e('d', [-134, 0, 0, 0.8, 0, 0, 0, -80])
      ),
    ],
    5: [
      v(
        e('a', [0, -140, 0, 0.66, 0, 0, 0, 70]),
        e('b', [-186, 0, 0, 0.66, 0, 0, 0, -40]),
        e('e', [186, 0, 0, 0.66, 0, 0, 0, 40]),
        e('d', [0, 140, 0, 0.66, 0, 0, 0, -70]),
        e('c', [0, 0, 0, 0.42, 0, 0, 0, 90])
      ),
    ],
  },
};

export interface Pose {
  tx: number;
  ty: number;
  tz: number;
  rot: number;
  scale: number;
  rx: number;
  ry: number;
  kx: number;
}

/** A card sitting a view out: shrink to nothing at the stack centre, tucked back in depth. */
export const parked = (slot: CardKey): Pose => ({
  tx: 0,
  ty: -REST_Y[slot],
  tz: -60,
  rot: 0,
  scale: 0,
  rx: 0,
  ry: 0,
  kx: 0,
});

/** Resolve a variant into per-card poses (translate deltas + depth + 3D rotation), parking
 *  every slot the variant does not name. Pose `y` is absolute stack-centre, converted to a
 *  translate delta against the card's resting flow position. */
export const posesForVariant = (variant: Variant): Pose[] => {
  const bySlot = new Map<CardKey, FormTuple>(variant.map((entry) => [entry.slot, entry.pose]));
  return CARD_KEYS.map((slot) => {
    const tuple = bySlot.get(slot);
    if (!tuple) return parked(slot);
    const [x, y, rot, scale, rx, ry, kx, z] = tuple;
    return { tx: x, ty: y - REST_Y[slot], tz: z, rot, scale, rx, ry, kx };
  });
};

/** All cards at rest (flow position, full size) — the opening state before the loop runs. */
export const identityPoses = (): Pose[] =>
  CARD_KEYS.map(() => ({ tx: 0, ty: 0, tz: 0, rot: 0, scale: 1, rx: 0, ry: 0, kx: 0 }));

export const VIEW_KEYS: readonly string[] = Object.keys(LAYOUTS);
/** Views the whole stack spins a full turn through — the orbit "wow" moment. */
export const SPIN_VIEWS: ReadonlySet<string> = new Set(['orbit']);
