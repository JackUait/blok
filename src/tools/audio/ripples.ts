/**
 * Beat ripples and loudness level for the "now playing" waveform.
 *
 * Beats come from the cached peaks: a bar that jumps well above the bars just
 * before it. When the playhead crosses one, a ripple starts there and a crest
 * runs outward both ways. The same beats kick the record, and the smoothed peak
 * under the playhead drives the glow behind the cover. All pure.
 */

export interface Beat {
  index: number;
  /** 0..1 — how far the bar jumped above its lead-in. */
  strength: number;
}

export interface Ripple {
  /** Bar index where it started. */
  origin: number;
  strength: number;
  /** Seconds since it started. */
  age: number;
}

/** Bars per second the crest travels. */
export const RIPPLE_SPEED = 80;
/** Seconds until a ripple is gone. */
export const RIPPLE_LIFE = 0.9;
/** Oldest ripples are dropped past this, so a dense passage stays readable. */
export const MAX_RIPPLES = 4;
/** Crest half-width in bars. */
const RIPPLE_WIDTH = 3.5;
/** Height a full-strength crest adds, as a fraction of the bar box. */
const RIPPLE_LIFT = 0.38;

/** Bars of lead-in averaged to judge a jump. */
const BEAT_WINDOW = 6;
/**
 * A beat is a jump in the top fifth of this track's jumps. Fixed thresholds
 * fail: real mixes sit near full scale, so their hits are bumps of ~0.05.
 */
const BEAT_QUANTILE = 0.8;
/** Smallest jump that can count, so a flat or silent track has no beats. */
const BEAT_MIN_RISE = 0.015;
/** Jumps at this quantile and above get full strength. */
const BEAT_FULL_QUANTILE = 0.98;
/** Weakest ripple, so every beat that fires is still visible. */
const BEAT_MIN_STRENGTH = 0.35;
/** Bars after a beat during which no other beat may start. */
const BEAT_MIN_GAP = 2;

/**
 * More than this many bars in one frame is a seek, not playback. At 300 buckets
 * even a 10s track moves ~0.5 bar per 60Hz frame, so real playback never gets close.
 */
const MAX_CROSS_STEP = 12;

function quantile(sorted: number[], q: number): number {
  return sorted[Math.floor(q * (sorted.length - 1))] ?? 0;
}

export function findBeats(peaks: number[]): Beat[] {
  const rises = peaks.map((peak, i) => {
    if (i < BEAT_WINDOW) return 0;
    return peak - peaks.slice(i - BEAT_WINDOW, i).reduce((sum, v) => sum + v, 0) / BEAT_WINDOW;
  });
  const sorted = rises.slice(BEAT_WINDOW).sort((x, y) => x - y);
  const threshold = Math.max(BEAT_MIN_RISE, quantile(sorted, BEAT_QUANTILE));
  const full = Math.max(threshold, quantile(sorted, BEAT_FULL_QUANTILE));

  return rises.reduce<Beat[]>((beats, rise, i) => {
    if (i < BEAT_WINDOW || rise < threshold) return beats;
    const last = beats[beats.length - 1];
    if (last && i - last.index < BEAT_MIN_GAP) return beats;
    beats.push({ index: i, strength: Math.max(BEAT_MIN_STRENGTH, Math.min(1, rise / full)) });
    return beats;
  }, []);
}

/** Beats the playhead passed going from `from` to `to`; none on a seek. */
export function beatsCrossed(beats: Beat[], from: number, to: number): Beat[] {
  if (to <= from || to - from > MAX_CROSS_STEP) return [];
  return beats.filter((b) => b.index > from && b.index <= to);
}

/** Lift a ripple adds to a bar `distance` bars from its origin, `age` seconds in. */
export function rippleLift(distance: number, age: number, strength = 1): number {
  if (age < 0 || age >= RIPPLE_LIFE) return 0;
  const offset = (Math.abs(distance) - RIPPLE_SPEED * age) / RIPPLE_WIDTH;
  const fade = 1 - age / RIPPLE_LIFE;
  return RIPPLE_LIFT * strength * fade * fade * Math.exp(-offset * offset);
}

/**
 * 0..1 ink for a bar a crest is lifting. Loud tracks leave bars no headroom to
 * grow, so on the unplayed side the crest also darkens toward the played ink.
 */
export function rippleInk(lift: number): number {
  return Math.min(1, Math.max(0, lift / RIPPLE_LIFT));
}

/** Seconds for the level to close ~63% of the gap going up / going down. */
const LEVEL_ATTACK = 0.06;
const LEVEL_RELEASE = 0.35;

/** Ease the level toward `target`: quick up, slow down, frame-rate independent. */
export function smoothLevel(prev: number, target: number, dtSec: number): number {
  if (dtSec <= 0) return prev;
  const tau = target > prev ? LEVEL_ATTACK : LEVEL_RELEASE;
  return prev + (target - prev) * (1 - Math.exp(-dtSec / tau));
}

/** Seconds for a kick to fall to ~37%. */
const KICK_DECAY = 0.12;

/** 0..1 punch from fresh ripples, used to pulse the record. */
export function kickAt(ripples: Array<Pick<Ripple, 'age' | 'strength'>>): number {
  const sum = ripples.reduce((acc, r) => acc + r.strength * Math.exp(-Math.max(0, r.age) / KICK_DECAY), 0);
  return Math.min(1, sum);
}
