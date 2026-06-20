/**
 * Waveform "now playing" liveliness math.
 *
 * The cached peaks are static — there's no real-time FFT — so the sense of a
 * live visualizer comes from animating a cluster of bars around the playhead.
 * The cluster is shaped like a comet: a bright head at the playhead, a tight
 * leading edge, and a longer decaying wake trailing into the already-played
 * bars. As playback advances, that comet travels left→right across the
 * waveform.
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
 * Final 0..1 bar amplitude, blending the static peak with the playhead-localized
 * comet. The comet body swells the cluster, the head spike brightens the bar at
 * the playhead, and a bidirectional wobble makes the whole thing flicker. The
 * combined boost is scaled by `energy` (for the pause settle) and zeroed under
 * `reduced` (prefers-reduced-motion).
 */
export function liveAmplitude(opts: LiveAmplitudeOptions): number {
  const { basePeak, index, playheadIndex, timeSeconds, reduced, energy = 1 } = opts;
  if (reduced || energy <= 0) return basePeak;

  const distance = index - playheadIndex;
  const env = cometEnvelope(distance);
  if (env === 0) return basePeak;

  const head = headFocus(distance);
  // Comet body swell + bright head spike, with a bidirectional dance on top.
  const boost = env * 0.15 + head * 0.2 + env * 0.28 * barWobble(index, timeSeconds);
  const amp = basePeak + boost * energy;

  return Math.min(1, Math.max(0, amp));
}
