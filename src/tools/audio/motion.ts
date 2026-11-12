/**
 * Music signals for the ink drop cover.
 *
 * Sound becomes six numbers per frame: loudness, bass, mid, and three hits
 * (kick, snare, hat). Live playback feeds analyser bytes through
 * `bandsFromSpectrum` and a `SignalCore`. A whole decoded file goes through
 * `analyseMotion` once, is packed with `encodeMotion`, saved with the block,
 * and read back with `createMotionReader`. All pure.
 */

import { beatsCrossed, findBeats, smoothLevel } from './ripples';

export interface InkSignals {
  level: number;
  bass: number;
  mid: number;
  /** 0, or the hit strength (0.25..1) when a hit landed in this step. */
  kick: number;
  snare: number;
  hat: number;
}

export interface SignalCore {
  step(raw: number[], dtSec: number): InkSignals;
}

export interface MotionEvent {
  /** Frame at 60 Hz. */
  frame: number;
  /** 0 kick, 1 snare, 2 hat. */
  kind: 0 | 1 | 2;
  strength: number;
}

/** Events in frame order; envelopes sampled at 20 Hz. */
export interface MotionTrack {
  events: MotionEvent[];
  bass: number[];
  mid: number[];
  level: number[];
}

export interface SignalReader {
  read(timeSec: number, dtSec: number): InkSignals;
}

/** Band edges in Hz. Band b covers EDGES[b]..EDGES[b + 1]. */
const EDGES = [30, 90, 200, 450, 1000, 2400, 6000, 14000];
const BAND_COUNT = EDGES.length - 1;
const BAND_INDEXES = Array.from({ length: BAND_COUNT }, (_, b) => b);
const BAND_CURVE = 1.4;

/** Seconds for a band to close ~63% of the gap going up / going down. */
const BAND_ATTACK = 0.025;
const BAND_RELEASE = 0.14;
/** Seconds of history in the running average a hit must rise above. */
const AVERAGE_TAU = 0.45;
const LEVEL_GAIN = 2.4;
const LEVEL_ATTACK = 0.06;
const LEVEL_RELEASE = 0.35;

/** A hit must also rise above this share of the frame before it. */
const PREV_SHARE = 0.9;
const HIT_FLOOR = 0.25;
const HIT_GAIN = 2.2;
const KICK_COOLDOWN = 0.13;
const SNARE_COOLDOWN = 0.1;
const HAT_COOLDOWN = 0.06;
const KICK_RISE_LOW = 0.055;
const KICK_RISE_HIGH = 0.08;
const SNARE_RISE = 0.05;
const HAT_RISE = 0.028;
const SNARE_BAND = 4;
const HAT_BAND = 6;

const FFT_SIZE = 2048;
const FRAME_RATE = 60;
/** One envelope sample per this many frames: 20 Hz. */
const ENVELOPE_EVERY = 3;
const ENVELOPE_RATE = FRAME_RATE / ENVELOPE_EVERY;
/** Matches AnalyserNode with smoothingTimeConstant 0.3 and the default -100..-30 dB range. */
const SPECTRUM_SMOOTHING = 0.3;
const MIN_DB = -100;
const DB_RANGE = 70;

const FORMAT_VERSION = 1;
const HEADER_BYTES = 7;
const MAX_NIBBLE = 15;
const GAP_BYTE = 255;
const CHUNK = 4096;

/** A bigger step between reads is a seek, not playback. */
const MAX_READ_STEP = 0.25;
const PEAKS_BASS_SHARE = 0.5;
const PEAKS_MID_SHARE = 0.3;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const silent = (): InkSignals => ({ level: 0, bass: 0, mid: 0, kick: 0, snare: 0, hat: 0 });

/** Calls `fn(i)` for i in [from, to). */
function eachIndex(from: number, to: number, fn: (i: number) => void): void {
  const cursor = { i: from };

  while (cursor.i < to) {
    fn(cursor.i);
    cursor.i += 1;
  }
}

function bandRanges(hzPerBin: number): Array<{ lo: number; hi: number }> {
  return BAND_INDEXES.map((b) => {
    const lo = Math.max(1, Math.floor((EDGES[b] ?? 0) / hzPerBin));

    return { lo, hi: Math.max(lo + 1, Math.floor((EDGES[b + 1] ?? 0) / hzPerBin)) };
  });
}

function bandsFromRanges(bytes: ArrayLike<number>, ranges: Array<{ lo: number; hi: number }>): number[] {
  return ranges.map(({ lo, hi }) => {
    // A bin past the end of the data counts as silent.
    const end = Math.min(hi, bytes.length);
    const acc = { i: lo, sum: 0 };

    while (acc.i < end) {
      acc.sum += bytes[acc.i] ?? 0;
      acc.i += 1;
    }

    return Math.pow(acc.sum / (hi - lo) / 255, BAND_CURVE);
  });
}

/** 7 raw band values (0..1) from analyser byte data. hzPerBin = sampleRate / fftSize. */
export function bandsFromSpectrum(bytes: ArrayLike<number>, hzPerBin: number): number[] {
  if (!(hzPerBin > 0) || !Number.isFinite(hzPerBin)) return BAND_INDEXES.map(() => 0);

  return bandsFromRanges(bytes, bandRanges(hzPerBin));
}

const approach = (dt: number, tau: number): number => 1 - Math.exp(-dt / tau);

/** One analysis step: smooths the bands and finds the hits. Keeps its own state. */
export function createSignalCore(): SignalCore {
  const cur = new Float32Array(BAND_COUNT);
  const bands = new Float32Array(BAND_COUNT);
  const avg = new Float32Array(BAND_COUNT);
  const prev = new Float32Array(BAND_COUNT);
  const cool = { kick: 0, snare: 0, hat: 0 };
  const state = { level: 0 };

  /**
   * The cooldown counts down on every call, not once per step. The kick asks
   * twice (two low bands, one cooldown), so a step with no kick on the first
   * band counts its cooldown down twice. The thresholds are tuned to that.
   */
  const hitOf = (b: number, slot: keyof typeof cool, minRise: number, cooldown: number, dt: number): number => {
    cool[slot] -= dt;
    const value = cur[b] ?? 0;
    const before = prev[b] ?? 0;
    const rise = value - Math.max(avg[b] ?? 0, before * PREV_SHARE);

    if (rise <= minRise || value <= before || cool[slot] > 0) return 0;
    cool[slot] = cooldown;

    return clamp(HIT_FLOOR + rise * HIT_GAIN, 0, 1);
  };

  return {
    step(raw, dtSec) {
      const dt = dtSec > 0 ? dtSec : 0;

      BAND_INDEXES.forEach((b) => {
        const target = Number(raw[b]) || 0;
        const band = bands[b] ?? 0;

        cur[b] = target;
        bands[b] = band + (target - band) * approach(dt, target > band ? BAND_ATTACK : BAND_RELEASE);
        avg[b] = (avg[b] ?? 0) + ((cur[b] ?? 0) - (avg[b] ?? 0)) * approach(dt, AVERAGE_TAU);
      });

      const kick = hitOf(0, 'kick', KICK_RISE_LOW, KICK_COOLDOWN, dt) || hitOf(1, 'kick', KICK_RISE_HIGH, KICK_COOLDOWN, dt);
      const snare = hitOf(SNARE_BAND, 'snare', SNARE_RISE, SNARE_COOLDOWN, dt);
      const hat = hitOf(HAT_BAND, 'hat', HAT_RISE, HAT_COOLDOWN, dt);

      prev.set(cur);

      const loud = clamp((cur.reduce((sum, v) => sum + v, 0) / BAND_COUNT) * LEVEL_GAIN, 0, 1);

      state.level += (loud - state.level) * approach(dt, loud > state.level ? LEVEL_ATTACK : LEVEL_RELEASE);

      return {
        level: state.level,
        bass: ((bands[0] ?? 0) + (bands[1] ?? 0)) / 2,
        mid: ((bands[3] ?? 0) + (bands[4] ?? 0) + (bands[5] ?? 0)) / 3,
        kick,
        snare,
        hat,
      };
    },
  };
}

interface Fft {
  /** Input and output, in place. */
  re: Float32Array;
  im: Float32Array;
  run(): void;
}

function reverseBits(value: number, bits: number): number {
  return Array.from({ length: bits }).reduce<number>((acc, _, bit) => acc | (((value >> bit) & 1) << (bits - 1 - bit)), 0);
}

/** Radix-2 FFT with the swaps and butterflies laid out once, in run order. */
function createFft(size: number): Fft {
  const bits = Math.round(Math.log2(size));
  const swaps = Array.from({ length: size }, (_, i) => [i, reverseBits(i, bits)] as const).filter(([i, j]) => i < j);
  const swapA = Uint16Array.from(swaps, ([i]) => i);
  const swapB = Uint16Array.from(swaps, ([, j]) => j);
  const count = (size / 2) * bits;
  const lows = new Uint16Array(count);
  const highs = new Uint16Array(count);
  const wr = new Float64Array(count);
  const wi = new Float64Array(count);
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const cursor = { n: 0 };

  Array.from({ length: bits }, (_, stage) => 2 << stage).forEach((len) => {
    const half = len / 2;
    const angle = (-2 * Math.PI) / len;
    const stepR = Math.cos(angle);
    const stepI = Math.sin(angle);
    const twiddle = { r: 1, i: 0 };

    eachIndex(0, half, (k) => {
      eachIndex(0, size / len, (block) => {
        const n = cursor.n + block * half + k;

        lows[n] = block * len + k;
        highs[n] = block * len + k + half;
        wr[n] = twiddle.r;
        wi[n] = twiddle.i;
      });

      const nextR = twiddle.r * stepR - twiddle.i * stepI;

      twiddle.i = twiddle.r * stepI + twiddle.i * stepR;
      twiddle.r = nextR;
    });
    cursor.n += (size / len) * half;
  });

  // Plain loops here and in analyseMotion: a callback per butterfly is several times slower.
  const run = (): void => {
    const at = { n: 0 };

    while (at.n < swapA.length) {
      const i = swapA[at.n] ?? 0;
      const j = swapB[at.n] ?? 0;
      const r = re[i] ?? 0;
      const m = im[i] ?? 0;

      re[i] = re[j] ?? 0;
      im[i] = im[j] ?? 0;
      re[j] = r;
      im[j] = m;
      at.n += 1;
    }
    at.n = 0;
    while (at.n < count) {
      const lo = lows[at.n] ?? 0;
      const hi = highs[at.n] ?? 0;
      const cr = wr[at.n] ?? 0;
      const ci = wi[at.n] ?? 0;
      const hiR = re[hi] ?? 0;
      const hiI = im[hi] ?? 0;
      const xr = hiR * cr - hiI * ci;
      const xi = hiR * ci + hiI * cr;
      const loR = re[lo] ?? 0;
      const loI = im[lo] ?? 0;

      re[hi] = loR - xr;
      im[hi] = loI - xi;
      re[lo] = loR + xr;
      im[lo] = loI + xi;
      at.n += 1;
    }
  };

  return { re, im, run };
}

function blackmanWindow(size: number): Float32Array {
  return Float32Array.from({ length: size }, (_, j) => {
    const phase = (2 * Math.PI * j) / size;

    return 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase);
  });
}

/**
 * Runs the live analysis over a whole file: the same spectrum an AnalyserNode
 * (fftSize 2048, smoothing 0.3) would report at each 60 Hz frame, through the
 * same core. So saved motion matches what live analysis would have shown.
 */
export function analyseMotion(mono: Float32Array, sampleRate: number): MotionTrack {
  const track: MotionTrack = { events: [], bass: [], mid: [], level: [] };

  if (!(sampleRate > 0) || !Number.isFinite(sampleRate)) return track;

  const hzPerBin = sampleRate / FFT_SIZE;
  const hop = sampleRate / FRAME_RATE;
  const frames = Math.floor((mono.length / sampleRate) * FRAME_RATE);
  const maxBin = Math.min(FFT_SIZE / 2, Math.ceil((EDGES[BAND_COUNT] ?? 0) / hzPerBin) + 1);
  const fft = createFft(FFT_SIZE);
  const { re, im } = fft;
  const window = blackmanWindow(FFT_SIZE);
  const smooth = new Float32Array(maxBin);
  const bytes = new Float32Array(maxBin);
  const ranges = bandRanges(hzPerBin);
  const core = createSignalCore();

  eachIndex(0, frames, (frame) => {
    // The window ends at the frame time, like an analyser read at that moment.
    const start = Math.round(frame * hop) - FFT_SIZE;

    const at = { j: 0, k: 1 };

    while (at.j < FFT_SIZE) {
      re[at.j] = (mono[start + at.j] ?? 0) * (window[at.j] ?? 0);
      im[at.j] = 0;
      at.j += 1;
    }
    fft.run();
    while (at.k < maxBin) {
      const r = re[at.k] ?? 0;
      const m = im[at.k] ?? 0;

      smooth[at.k] = SPECTRUM_SMOOTHING * (smooth[at.k] ?? 0) + ((1 - SPECTRUM_SMOOTHING) * Math.sqrt(r * r + m * m)) / FFT_SIZE;
      bytes[at.k] = clamp(Math.floor((255 * (20 * Math.log10(smooth[at.k] || 1e-12) - MIN_DB)) / DB_RANGE), 0, 255);
      at.k += 1;
    }

    const out = core.step(bandsFromRanges(bytes, ranges), 1 / FRAME_RATE);

    if (out.kick > 0) track.events.push({ frame, kind: 0, strength: out.kick });
    if (out.snare > 0) track.events.push({ frame, kind: 1, strength: out.snare });
    if (out.hat > 0) track.events.push({ frame, kind: 2, strength: out.hat });
    if (frame % ENVELOPE_EVERY !== 0) return;
    track.bass.push(out.bass);
    track.mid.push(out.mid);
    track.level.push(out.level);
  });

  return track;
}

/** 0..1 to 4 bits. The square root keeps detail in the quiet end. */
const quantise = (value: number): number => clamp(Math.round(MAX_NIBBLE * Math.sqrt(clamp(value || 0, 0, 1))), 0, MAX_NIBBLE);
const dequantise = (nibble: number): number => (nibble / MAX_NIBBLE) ** 2;

const quantiseStrength = (strength: number): number =>
  clamp(Math.round((((strength || 0) - HIT_FLOOR) / (1 - HIT_FLOOR)) * MAX_NIBBLE), 0, MAX_NIBBLE);
const dequantiseStrength = (nibble: number): number => HIT_FLOOR + (nibble / MAX_NIBBLE) * (1 - HIT_FLOOR);

const uint24 = (value: number): number[] => [value & 255, (value >> 8) & 255, (value >> 16) & 255];

/**
 * Packs a track into base64. Layout: version byte, envelope count (3 bytes,
 * little-endian), event count (3 bytes), then 3 nibbles per envelope sample
 * (bass, mid, level), then per event: frames since the last event (a 255 byte
 * means "add 255 and keep reading"), then kind in the high nibble and strength
 * in the low one. Saved blocks hold this, so the layout must not change
 * without a new version byte.
 */
export function encodeMotion(track: MotionTrack): string {
  const count = track.bass.length;
  const nibbles = Array.from({ length: count * 3 }, (_, n) => {
    const source = [track.bass, track.mid, track.level][n % 3] ?? [];

    return quantise(source[Math.floor(n / 3)] ?? 0);
  });
  const envelope = Array.from({ length: Math.ceil(nibbles.length / 2) }, (_, i) => ((nibbles[i * 2] ?? 0) << 4) | (nibbles[i * 2 + 1] ?? 0));
  const last = { frame: 0 };
  const events = track.events.flatMap((event) => {
    const frame = Math.max(last.frame, Math.round(event.frame));
    const gap = frame - last.frame;

    last.frame = frame;

    return [
      ...new Array<number>(Math.floor(gap / GAP_BYTE)).fill(GAP_BYTE),
      gap % GAP_BYTE,
      (event.kind << 4) | quantiseStrength(event.strength),
    ];
  });
  const bytes = [FORMAT_VERSION, ...uint24(count), ...uint24(track.events.length), ...envelope, ...events];
  const text = Array.from({ length: Math.ceil(bytes.length / CHUNK) }, (_, c) =>
    String.fromCharCode(...bytes.slice(c * CHUNK, (c + 1) * CHUNK))
  ).join('');

  return btoa(text);
}

function base64ToBytes(encoded: unknown): Uint8Array | null {
  if (typeof encoded !== 'string') return null;
  try {
    return Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

const isKind = (value: number): value is 0 | 1 | 2 => value === 0 || value === 1 || value === 2;

/** Null when the bytes run out, a kind is unknown, or bytes are left over. */
function readEvents(bytes: Uint8Array, start: number, count: number): MotionEvent[] | null {
  // Each event is at least 2 bytes, so a bad count fails before any work.
  if (count * 2 > bytes.length - start) return null;

  const events: MotionEvent[] = [];
  const cursor = { at: start, frame: 0, bad: false };

  while (events.length < count && !cursor.bad) {
    while (bytes[cursor.at] === GAP_BYTE) {
      cursor.frame += GAP_BYTE;
      cursor.at += 1;
    }

    const gap = bytes[cursor.at];
    const packed = bytes[cursor.at + 1];
    const kind = (packed ?? 0) >> 4;

    if (gap === undefined || packed === undefined || !isKind(kind)) {
      cursor.bad = true;
      continue;
    }
    cursor.frame += gap;
    cursor.at += 2;
    events.push({ frame: cursor.frame, kind, strength: dequantiseStrength(packed & MAX_NIBBLE) });
  }

  return cursor.bad || cursor.at !== bytes.length ? null : events;
}

/** Reads what `encodeMotion` wrote. Null for anything else; never throws. */
export function decodeMotion(encoded: string): MotionTrack | null {
  const bytes = base64ToBytes(encoded);

  if (!bytes || bytes.length < HEADER_BYTES || bytes[0] !== FORMAT_VERSION) return null;

  const count = (bytes[1] ?? 0) | ((bytes[2] ?? 0) << 8) | ((bytes[3] ?? 0) << 16);
  const eventCount = (bytes[4] ?? 0) | ((bytes[5] ?? 0) << 8) | ((bytes[6] ?? 0) << 16);
  const eventsStart = HEADER_BYTES + Math.ceil((count * 3) / 2);

  if (bytes.length < eventsStart) return null;

  const events = readEvents(bytes, eventsStart, eventCount);

  if (!events) return null;

  const nibbleAt = (n: number): number => {
    const byte = bytes[HEADER_BYTES + (n >> 1)] ?? 0;

    return n & 1 ? byte & MAX_NIBBLE : byte >> 4;
  };
  const envelope = (offset: number): number[] => Array.from({ length: count }, (_, i) => dequantise(nibbleAt(i * 3 + offset)));

  return { events, bass: envelope(0), mid: envelope(1), level: envelope(2) };
}

/**
 * Envelopes interpolated at timeSec; hits are the events passed since the
 * previous read. After a jump (time went backwards, or forward by more than
 * 0.25 s) it reports no hits for that read and re-syncs.
 */
export function createMotionReader(track: MotionTrack): SignalReader {
  const { events } = track;
  const state = { prev: -1, next: 0 };
  const sampleAt = (values: number[], position: number): number => {
    const last = values.length - 1;
    const i0 = Math.min(last, Math.floor(position));
    const from = values[i0] ?? 0;

    return from + ((values[Math.min(last, i0 + 1)] ?? 0) - from) * (position - Math.floor(position));
  };

  return {
    read(timeSec) {
      const out = silent();

      if (!Number.isFinite(timeSec)) {
        state.prev = -1;

        return out;
      }

      const time = Math.max(0, timeSec);
      const jumped = state.prev < 0 || time < state.prev || time - state.prev > MAX_READ_STEP;
      const keys = ['kick', 'snare', 'hat'] as const;

      out.bass = sampleAt(track.bass, time * ENVELOPE_RATE);
      out.mid = sampleAt(track.mid, time * ENVELOPE_RATE);
      out.level = sampleAt(track.level, time * ENVELOPE_RATE);
      state.next = jumped ? 0 : state.next;
      state.prev = time;

      while (state.next < events.length && (events[state.next]?.frame ?? 0) / FRAME_RATE <= time) {
        const event = events[state.next];
        const key = keys[event?.kind ?? 0];

        state.next += 1;
        if (!jumped && event) out[key] = Math.max(out[key], event.strength);
      }

      return out;
    },
  };
}

/**
 * Coarse fallback from the block's stored loudness peaks (0..1 buckets across
 * the track). level is the smoothed peak under the playhead, kick the strength
 * of the beats the playhead crossed. All zeros until the duration is known.
 */
export function createPeaksReader(peaks: number[], durationSec: () => number): SignalReader {
  const beats = findBeats(peaks);
  const state = { level: 0, index: -1 };

  return {
    read(timeSec, dtSec) {
      const duration = durationSec();

      if (!(duration > 0) || !Number.isFinite(duration) || !Number.isFinite(timeSec) || peaks.length === 0) {
        state.index = -1;

        return silent();
      }

      const index = clamp(Math.floor((timeSec / duration) * peaks.length), 0, peaks.length - 1);
      const crossed = state.index < 0 ? [] : beatsCrossed(beats, state.index, index);

      state.index = index;
      state.level = smoothLevel(state.level, peaks[index] ?? 0, dtSec);

      return {
        level: state.level,
        bass: state.level * PEAKS_BASS_SHARE,
        mid: state.level * PEAKS_MID_SHARE,
        kick: crossed.reduce((max, beat) => Math.max(max, beat.strength), 0),
        snare: 0,
        hat: 0,
      };
    },
  };
}
