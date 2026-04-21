const RUBBER_BAND_COEF = 0.55;

// Classic iOS rubber-band curve: asymptotically approaches `dimension` as overshoot grows.
export function rubberBand(overshoot: number, dimension: number): number {
  if (overshoot === 0) return 0;
  const sign = overshoot < 0 ? -1 : 1;
  const abs = Math.abs(overshoot);
  return sign * (1 - 1 / (abs / dimension * RUBBER_BAND_COEF + 1)) * dimension;
}

export function applyRubberBand(value: number, limit: number, dimension: number): number {
  if (value >= -limit && value <= limit) return value;
  const sign = value < 0 ? -1 : 1;
  const overshoot = Math.abs(value) - limit;
  return sign * (limit + rubberBand(overshoot, dimension));
}
