/**
 * Waveform "now playing" liveliness math.
 *
 * The cached peaks are static — there's no real-time FFT — so the sense of a
 * live visualizer is composed from two layers:
 *
 *   1. A focal **comet** at the playhead: a bright head spike, a tight leading
 *      edge, and a longer decaying wake trailing into the already-played bars.
 *      It travels left→right as playback advances.
 *   2. A global **ambient** ripple that flows across the entire field so no bar
 *      sits frozen. It's biased stronger on the played side (a shimmering wake
 *      of music) and faint on the not-yet-played preview ahead.
 *
 * All functions are pure so the behaviour is unit-testable; the canvas in
 * waveform.ts just samples them per bar, per frame.
 */

/** Bars ahead of the playhead (not yet played) that still react. */
export const REACH_AHEAD = 4;
/** Bars behind the playhead (already played) that keep a decaying wake. */
export const REACH_BEHIND = 9;

/**
 * Asymmetric "comet" falloff around the playhead. `distance` is the bar index
 * minus the fractional playhead index: negative = behind (already-played wake),
 * positive = ahead (not yet played). The wake reaches further than the leading
 * edge so the energy reads as travelling with momentum. 1 at the playhead,
 * easing to 0 at the respective reach.
 */
export function cometEnvelope(distance: number, reachAhead = REACH_AHEAD, reachBehind = REACH_BEHIND): number {
  const reach = distance < 0 ? reachBehind : reachAhead;
  const d = Math.abs(distance);
  if (d >= reach) return 0;
  const t = 1 - d / reach;
  return t * t;
}

/**
 * Tight symmetric spike centred on the playhead so the bar under it stands
 * clearly proud of its neighbours — the bright head of the comet. Falls off
 * faster (cubed) than the comet body.
 */
export function headFocus(distance: number, reach = 3): number {
  const d = Math.abs(distance);
  if (d >= reach) return 0;
  const t = 1 - d / reach;
  return t * t * t;
}

/**
 * Deterministic per-bar wobble in [-1, 1]. Two out-of-phase sines keyed to the
 * bar index so neighbouring bars rise and fall independently — the cluster
 * reads as a dancing equalizer rather than one uniform swell.
 */
export function barWobble(index: number, timeSeconds: number): number {
  const a = Math.sin(timeSeconds * 8.5 + index * 0.7);
  const b = Math.sin(timeSeconds * 5.3 + index * 1.9);
  return a * 0.6 + b * 0.4;
}

/**
 * Slow travelling undulation across the whole bar field, in [-1, 1]. Two waves
 * propagate in opposite directions (the `-index`/`+index` phase terms) so the
 * field gently churns rather than sliding uniformly. Kept low-frequency so the
 * motion is graceful, not busy.
 */
export function ambientWave(index: number, timeSeconds: number): number {
  const a = Math.sin(timeSeconds * 2.1 - index * 0.35);
  const b = Math.sin(timeSeconds * 1.3 + index * 0.21);
  return a * 0.6 + b * 0.4;
}

/** Ambient swing applied to every bar (the faint preview-side breath). */
const AMBIENT_BASE = 0.035;
/** Extra ambient swing layered onto the played side (the shimmering wake). */
const AMBIENT_PLAYED = 0.06;
/** Bars ahead of the playhead over which the played-side shimmer fades out. */
const AMBIENT_AHEAD_FADE = 26;

/**
 * Ease-out cubic for the head-colour entrance ramp: 0→1 with most of the travel
 * up front, so the colour blooms in quickly then settles. Clamped to [0, 1].
 */
export function entranceEase(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  return 1 - (1 - t) ** 3;
}

/**
 * 0..1 tint strength for a bar's comet-head colour overlay. Peaks at the
 * playhead (via {@link headFocus}) and scales with both the live `energy` (so it
 * fades out on the pause settle) and the `entrance` ramp (so it animates in when
 * playback starts).
 */
export function headColorBlend(opts: { distance: number; energy: number; entrance: number }): number {
  return headFocus(opts.distance) * opts.energy * opts.entrance;
}

interface LiveAmplitudeOptions {
  basePeak: number;
  index: number;
  /** Fractional bar position of the playhead (played * peaks.length). */
  playheadIndex: number;
  timeSeconds: number;
  reduced: boolean;
  /** 0..1 multiplier on the live boost — 1 while playing, ramps to 0 on the pause settle. */
  energy?: number;
}

/**
 * Final 0..1 bar amplitude, blending the static peak with two live layers: the
 * playhead-localized comet (body swell + bright head spike + bidirectional
 * dance) and a global ambient ripple biased toward the played side. The
 * combined boost is scaled by `energy` (for the pause settle) and zeroed under
 * `reduced` (prefers-reduced-motion).
 */
export function liveAmplitude(opts: LiveAmplitudeOptions): number {
  const { basePeak, index, playheadIndex, timeSeconds, reduced, energy = 1 } = opts;
  if (reduced || energy <= 0) return basePeak;

  const distance = index - playheadIndex;

  // Layer 1 — focal comet near the playhead.
  const env = cometEnvelope(distance);
  const head = headFocus(distance);
  const comet = env * 0.15 + head * 0.2 + env * 0.28 * barWobble(index, timeSeconds);

  // Layer 2 — global ambient ripple. Full strength behind the playhead (the
  // played wake), fading across AMBIENT_AHEAD_FADE bars into the preview ahead.
  const playedBias = distance <= 0 ? 1 : Math.max(0, 1 - distance / AMBIENT_AHEAD_FADE);
  const ambient = ambientWave(index, timeSeconds) * (AMBIENT_BASE + AMBIENT_PLAYED * playedBias);

  const amp = basePeak + (comet + ambient) * energy;

  return Math.min(1, Math.max(0, amp));
}
