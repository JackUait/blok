/* Hero formation geometry + the hand-authored layout matrix.
 *
 * Each `(view, count)` cell holds one or more variants. A variant names exactly which
 * cards take part and the pose each one holds, so every on-screen arrangement was tuned
 * by hand with the real card heights in mind — no runtime subsetting, no collisions.
 * The overlap invariant is enforced by heroFormations.test.ts. */

export type CardKey = 'a' | 'b' | 'c' | 'd';
export const CARD_KEYS: readonly CardKey[] = ['a', 'b', 'c', 'd'];

/** `[x, y, rotZ, scale, rotX, rotY, skewX, z]` in stack-centre px. */
export type FormTuple = readonly [number, number, number, number, number, number, number, number];

export interface VariantEntry {
  slot: CardKey;
  pose: FormTuple;
}
export type Variant = readonly VariantEntry[];

/** Resting vertical centre of each card relative to the stack centre (px) — the flex-column
 *  flow position, used so a pose's `y` maps straight to an on-screen y. Derived from the four
 *  face heights (`SLOT_CONTENT_PX` + `FACE_PAD`) stacked in a gap-3.5 (14px) column. */
export const REST_Y: Record<CardKey, number> = { a: -164, b: -81, c: 33, d: 154 };

/** Content-box height (px) per slot — the `SLOT_BODY_H` value. Face height = this + FACE_PAD. */
export const SLOT_CONTENT_PX: Record<CardKey, number> = { a: 36, b: 42, c: 98, d: 56 };
/** p-3.5 (28px) + 2px border. */
export const FACE_PAD = 30;
/** Worst-case card width (sm:w-80) used for collision-free authoring. */
export const CARD_WIDTH = 320;

/** Depth (px) between adjacent transit lanes — comfortably past the slab thickness so the
 *  front card decisively occludes the one behind (no z-fighting). */
export const TRANSIT_Z_GAP = 60;
/** Forward pop of the rearmost lane, so the whole bunch floats toward the viewer mid-move. */
const TRANSIT_Z_BASE = 40;
/** The depth lane each slot rides at a transition's midpoint. Resting formations are authored
 *  collision-free in 2D, but the curved paths between them let two cards cross the same screen
 *  region at once. Pinning each slot to a distinct, strictly-ordered depth where the cards
 *  bunch up (the waypoint) guarantees an overlap reads as one slab sliding cleanly OVER
 *  another (occlusion) rather than two slabs interpenetrating. */
export const TRANSIT_Z: Record<CardKey, number> = CARD_KEYS.reduce(
  (lanes, slot, i) => ({ ...lanes, [slot]: TRANSIT_Z_BASE + i * TRANSIT_Z_GAP }),
  {} as Record<CardKey, number>
);

const v = (...entries: VariantEntry[]): Variant => entries;
const e = (slot: CardKey, pose: FormTuple): VariantEntry => ({ slot, pose });

/** The matrix. Every count reuses the SAME, NESTED slot set across all views — count 2 =
 *  {a,d}, count 3 = {a,c,d}, count 4 = {a,b,c,d}. Because the sets nest, going to an equal or
 *  higher count keeps every active card (they flip-morph into the new arrangement) and only a
 *  count DROP removes one. A view authors only the counts that read well at it; missing counts
 *  are skipped. Counts present overall span 2..4. */
export const LAYOUTS: Record<string, Record<number, readonly Variant[]>> = {
  // Vertical column, depth-layered — the resting reader. Does counts 2..4.
  stack: {
    2: [
      v(e('a', [0, -64, 0, 0.92, 0, 6, 0, 30]), e('d', [0, 70, 0, 0.92, 0, -6, 0, -30])),
      v(e('d', [0, -72, 0, 0.9, 0, 6, 0, 30]), e('a', [0, 64, 0, 0.9, 0, -6, 0, -30])),
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
  },
  // Regional burst — quadrants at varied depth + tilt. 1 skipped (one card can't "explode").
  explode: {
    2: [
      v(e('a', [-110, -66, -5, 0.82, 5, 12, 0, 50]), e('d', [114, 76, 4, 0.82, -5, -12, 0, -50])),
      v(e('d', [-114, 78, -4, 0.82, -5, 12, 0, -50]), e('a', [112, -68, 5, 0.82, 5, -12, 0, 50])),
    ],
    3: [
      v(
        e('a', [-130, -82, -5, 0.74, 5, 12, 0, 55]),
        e('d', [130, -74, 5, 0.74, 5, -12, 0, -40]),
        e('c', [0, 100, 0, 0.78, -5, 0, 0, 15])
      ),
    ],
    4: [
      v(
        e('a', [-138, -78, -5, 0.77, 5, 13, 0, 64]),
        e('b', [132, -98, 5, 0.75, 6, -14, 0, -48]),
        e('c', [-128, 104, 6, 0.79, -6, 12, 0, 32]),
        e('d', [158, 86, -4, 0.77, -5, -13, 0, -68])
      ),
    ],
  },
  // Diagonal staircase plunging into depth — equal scale, evenly stepped. 1 skipped.
  cascade: {
    2: [
      v(e('a', [-92, -96, -6, 0.85, 0, 10, 0, 45]), e('d', [92, 96, -6, 0.85, 0, 10, 0, -45])),
      v(e('a', [92, -96, -6, 0.85, 0, 10, 0, 45]), e('d', [-92, 96, -6, 0.85, 0, 10, 0, -45])),
    ],
    3: [
      v(
        e('a', [-122, -122, -6, 0.82, 0, 11, 0, 50]),
        e('c', [0, 0, -6, 0.82, 0, 11, 0, 0]),
        e('d', [128, 130, -6, 0.82, 0, 11, 0, -50])
      ),
    ],
    4: [
      v(
        e('a', [-140, -168, -6, 0.86, 0, 12, 0, 64]),
        e('b', [-47, -62, -6, 0.86, 0, 12, 0, 22]),
        e('c', [47, 48, -6, 0.86, 0, 12, 0, -22]),
        e('d', [140, 168, -6, 0.86, 0, 12, 0, -64])
      ),
    ],
  },
  // Spinning ring — needs >=3 to read as an orbit. 1 and 2 skipped.
  orbit: {
    3: [
      // A triangle ring: a prominent card up top with two wider-spread cards below it. The
      // top card is the biggest (0.82) so it reads as the focal point rather than a small
      // chip, and the two lower cards sit far enough apart to keep a wander-safe gap.
      v(
        e('a', [0, -116, 0, 0.82, 0, 0, 0, 60]),
        e('c', [-142, 84, 0, 0.74, 0, 0, 0, -60]),
        e('d', [142, 84, 0, 0.74, 0, 0, 0, 60])
      ),
    ],
    4: [
      // A diamond ring, spread wide enough that the left/right points clear each other across
      // the empty centre (the top/bottom points sit above/below it).
      v(
        e('a', [0, -150, 0, 0.8, 0, 0, 0, 80]),
        e('b', [150, 0, 0, 0.8, 0, 0, 0, -80]),
        e('c', [0, 150, 0, 0.8, 0, 0, 0, 80]),
        e('d', [-150, 0, 0, 0.8, 0, 0, 0, -80])
      ),
    ],
  },
};

/** A per-slot "shuffle bag" sequencer for the block kinds shown in each card slot.
 *
 *  The hero used to draw a fresh uniform-random kind per slot on every swap. Independent random
 *  draws CLUSTER: the deeper the pool, the longer some kinds go unseen while others reappear —
 *  so the 11-deep media slot looked like it only ever cycled two or three blocks. A shuffle bag
 *  instead deals every kind in a slot's pool exactly once before reshuffling, giving each block
 *  equal, evenly-spaced airtime. The reshuffle swaps away a seam repeat (last of the old bag ===
 *  first of the new one) so a kind never shows back-to-back. `initial` seeds the per-slot "last
 *  shown" so the very first deal still differs from the opening quartet. */
export const createKindSequencer = <T>(
  pools: Record<CardKey, readonly T[]>,
  rng: () => number,
  initial?: Partial<Record<CardKey, T>>
): { next: () => Record<CardKey, T> } => {
  const bags: Record<CardKey, T[]> = { a: [], b: [], c: [], d: [] };
  const last: Partial<Record<CardKey, T>> = { ...initial };

  const shuffle = (arr: T[]): T[] => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  };

  const draw = (slot: CardKey): T => {
    const pool = pools[slot];
    if (pool.length < 2) return pool[0];
    if (bags[slot].length === 0) {
      const fresh = shuffle(pool.slice());
      if (fresh[0] === last[slot]) {
        const swap = fresh[1];
        fresh[1] = fresh[0];
        fresh[0] = swap;
      }
      bags[slot] = fresh;
    }
    const kind = bags[slot][0];
    bags[slot] = bags[slot].slice(1);
    last[slot] = kind;
    return kind;
  };

  return {
    next: () => ({ a: draw('a'), b: draw('b'), c: draw('c'), d: draw('d') }),
  };
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

export const VIEW_KEYS: readonly string[] = Object.keys(LAYOUTS);
/** Views the whole stack spins a full turn through — the orbit "wow" moment. */
export const SPIN_VIEWS: ReadonlySet<string> = new Set(['orbit']);

export interface AnimationChoice {
  view: string;
  count: number;
  variantIndex: number;
}

/** Pick the next formation so the same animation never plays twice in a row. The view skips
 *  the current one AND the one before it (no immediate echo), and the count skips the previous
 *  count — so consecutive animations always differ in BOTH which gesture plays and how many
 *  blocks take part. (Different views with the same block count read as "the same animation":
 *  e.g. three count-3 shuffles in a row.) The variant is then chosen freely. `prev` is null for
 *  the first pick; `rng` yields [0, 1). */
export const pickNextAnimation = (
  prev: { view: string; viewBefore: string; count: number } | null,
  rng: () => number
): AnimationChoice => {
  const choose = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
  const viewChoices = VIEW_KEYS.filter((vw) => vw !== prev?.view && vw !== prev?.viewBefore);
  const view = choose(viewChoices.length ? viewChoices : VIEW_KEYS.filter((vw) => vw !== prev?.view));
  const allCounts = Object.keys(LAYOUTS[view]).map(Number);
  const countChoices = allCounts.filter((c) => c !== prev?.count);
  const count = choose(countChoices.length ? countChoices : allCounts);
  const variantIndex = Math.floor(rng() * LAYOUTS[view][count].length);
  return { view, count, variantIndex };
};
