export const SPEED_MIN = 0.25;
export const SPEED_MAX = 2;
export const SPEED_SLIDER_STEP = 0.05;

/** The presets. They sit at equal distances along the wire, not at their true ratios. */
export const SPEED_PEGS: readonly number[] = [0.25, 0.5, 1, 1.5, 2];

// Shares of the wire's length, not speeds: between 0.25× and 0.5× a speed-based
// reach would cover the whole stretch and no value there could be dragged to.
export const PEG_GRAB = 0.045;
export const PEG_HOLD = 0.075;

const STRETCHES = SPEED_PEGS.length - 1;

export const clampRate = (rate: number): number =>
  Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(rate * 100) / 100));

export const snapRate = (rate: number): number =>
  clampRate(Math.round(rate / SPEED_SLIDER_STEP) * SPEED_SLIDER_STEP);

/** Where a speed sits along the wire, 0 to 1. */
export const rateToFraction = (rate: number): number => {
  const clamped = Math.min(SPEED_MAX, Math.max(SPEED_MIN, rate));
  const upper = SPEED_PEGS.findIndex((peg, index) => index > 0 && clamped <= peg);
  const from = SPEED_PEGS[upper - 1];

  return (upper - 1 + (clamped - from) / (SPEED_PEGS[upper] - from)) / STRETCHES;
};

/** The speed at a point along the wire. Not snapped to a step. */
export const fractionToRate = (fraction: number): number => {
  const along = Math.min(1, Math.max(0, fraction)) * STRETCHES;
  const lower = Math.min(STRETCHES - 1, Math.floor(along));

  return SPEED_PEGS[lower] + (along - lower) * (SPEED_PEGS[lower + 1] - SPEED_PEGS[lower]);
};

/**
 * One sample of a drag. `held` is the peg holding the bead, or null. A peg takes
 * the bead from PEG_GRAB away and keeps it until the pointer is past PEG_HOLD.
 */
export const resolveDrag = (fraction: number, held: number | null): { rate: number; held: number | null } => {
  const along = Math.min(1, Math.max(0, fraction));
  const kept = held !== null && Math.abs(along - rateToFraction(held)) <= PEG_HOLD ? held : null;
  const peg = kept ?? SPEED_PEGS.find((candidate) => Math.abs(rateToFraction(candidate) - along) <= PEG_GRAB) ?? null;

  return { rate: peg ?? snapRate(fractionToRate(along)), held: peg };
};
