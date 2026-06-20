/**
 * Waveform "now playing" liveliness math.
 *
 * The cached peaks are static — we have no real-time FFT — so the sense of a
 * live visualizer comes from animating a small cluster of bars around the
 * playhead. Each frame, bars within {@link PLAYHEAD_REACH} of the playhead get
 * a time-varying boost; everything else holds at its resting peak. As playback
 * advances, that pumping cluster travels left→right across the waveform.
 *
 * All functions are pure so the behaviour is unit-testable; the canvas in
 * waveform.ts just samples them per bar, per frame.
 */

/** How many bars on each side of the playhead still "dance". */
export const PLAYHEAD_REACH = 6;

/**
 * Smooth 1→0 falloff with distance (in bars) from the playhead. 1 at the
 * playhead, easing to 0 once |distance| reaches PLAYHEAD_REACH. Symmetric.
 */
export function playheadEnvelope(distanceBars: number, reach = PLAYHEAD_REACH): number {
  const d = Math.abs(distanceBars);
  if (d >= reach) return 0;
  const t = 1 - d / reach;
  return t * t;
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
}

/**
 * Final 0..1 bar amplitude, blending the static peak with a playhead-localized
 * live boost. A steady swell ({@link playheadEnvelope}) lifts the cluster while
 * a bidirectional wobble makes it flicker. `reduced` (prefers-reduced-motion)
 * returns the static peak untouched.
 */
export function liveAmplitude(opts: LiveAmplitudeOptions): number {
  const { basePeak, index, playheadIndex, timeSeconds, reduced } = opts;
  if (reduced) return basePeak;

  const env = playheadEnvelope(index - playheadIndex);
  if (env === 0) return basePeak;

  // Steady spotlight swell keeps even quiet sections alive; the wobble adds the
  // dancing flicker on top. Both scale with the distance envelope.
  const swell = env * 0.18;
  const dance = env * 0.3 * barWobble(index, timeSeconds);
  const amp = basePeak + swell + dance;

  return Math.min(1, Math.max(0, amp));
}
