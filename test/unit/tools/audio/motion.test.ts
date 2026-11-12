import { describe, it, expect } from 'vitest';
import {
  bandsFromSpectrum,
  createSignalCore,
  analyseMotion,
  encodeMotion,
  decodeMotion,
  createMotionReader,
  createPeaksReader,
  type InkSignals,
  type MotionTrack,
} from '../../../../src/tools/audio/motion';

const SAMPLE_RATE = 44100;
const FFT_SIZE = 2048;
const HZ_PER_BIN = SAMPLE_RATE / FFT_SIZE;
const DT = 1 / 60;
const SILENT: InkSignals = { level: 0, bass: 0, mid: 0, kick: 0, snare: 0, hat: 0 };

const silence = (): number[] => new Array<number>(7).fill(0);
const band = (index: number, value: number): number[] => silence().map((v, i) => (i === index ? value : v));

/** Byte spectrum with `value` in bins [fromHz, toHz) and 0 elsewhere. */
const spectrum = (fromHz: number, toHz: number, value = 255): Uint8Array =>
  Uint8Array.from({ length: FFT_SIZE / 2 }, (_, bin) => (bin * HZ_PER_BIN >= fromHz && bin * HZ_PER_BIN < toHz ? value : 0));

const bytesOf = (encoded: string): number[] => Array.from(atob(encoded), (ch) => ch.charCodeAt(0));
const toBase64 = (bytes: number[]): string => btoa(String.fromCharCode(...bytes));

const track = (partial: Partial<MotionTrack>): MotionTrack => ({ events: [], bass: [], mid: [], level: [], ...partial });

describe('bandsFromSpectrum', () => {
  it('puts low-bin energy in band 0 and not in band 6', () => {
    const bands = bandsFromSpectrum(spectrum(0, 100), HZ_PER_BIN);

    expect(bands[6]).toBe(0);
    expect(bands[0]).toBeGreaterThan(0.5);
    expect(bands).toHaveLength(7);
  });

  it('puts high-bin energy in band 6 and not in band 0', () => {
    const bands = bandsFromSpectrum(spectrum(6000, 14000), HZ_PER_BIN);

    expect(bands[0]).toBe(0);
    expect(bands[6]).toBeGreaterThan(0.9);
  });

  it('scales a full band to 1 and a half-loud band below half', () => {
    expect(bandsFromSpectrum(spectrum(0, 22050), HZ_PER_BIN)).toEqual([1, 1, 1, 1, 1, 1, 1]);

    const half = bandsFromSpectrum(spectrum(0, 22050, 128), HZ_PER_BIN);

    expect(half[3]).toBeCloseTo(Math.pow(128 / 255, 1.4), 6);
  });

  it('returns zeros for an all-zero spectrum', () => {
    expect(bandsFromSpectrum(new Uint8Array(FFT_SIZE / 2), HZ_PER_BIN)).toEqual(silence());
  });

  it('returns finite zeros for a spectrum that is too short or a bad bin width', () => {
    expect(bandsFromSpectrum(new Uint8Array(4), HZ_PER_BIN).every((v) => Number.isFinite(v))).toBe(true);
    expect(bandsFromSpectrum(spectrum(0, 22050), 0)).toEqual(silence());
    expect(bandsFromSpectrum(spectrum(0, 22050), Number.NaN)).toEqual(silence());
  });
});

describe('createSignalCore', () => {
  it('reports all zeros for silence', () => {
    const core = createSignalCore();

    expect(core.step(silence(), DT)).toEqual(SILENT);
    expect(core.step(silence(), DT)).toEqual(SILENT);
  });

  it('reports a kick when a low band jumps', () => {
    const core = createSignalCore();

    core.step(silence(), DT);
    const hit = core.step(band(0, 0.8), DT);

    expect(hit.kick).toBeGreaterThanOrEqual(0.25);
    expect(hit.kick).toBeLessThanOrEqual(1);
    expect(hit.snare).toBe(0);
    expect(hit.hat).toBe(0);
  });

  it('reports a kick from the second low band too', () => {
    const core = createSignalCore();

    core.step(silence(), DT);

    expect(core.step(band(1, 0.8), DT).kick).toBeGreaterThanOrEqual(0.25);
  });

  it('gives a small jump a weak kick and a big jump a strong one', () => {
    const weak = createSignalCore();
    const strong = createSignalCore();

    // The running average has already moved toward the new value in this step.
    expect(weak.step(band(0, 0.1), DT).kick).toBeCloseTo(0.25 + 0.1 * Math.exp(-DT / 0.45) * 2.2, 5);
    expect(strong.step(band(0, 0.9), DT).kick).toBe(1);
  });

  it('ignores a jump below the threshold', () => {
    const core = createSignalCore();

    expect(core.step(band(0, 0.05), DT).kick).toBe(0);
  });

  it('reports no second kick inside the cooldown', () => {
    const core = createSignalCore();

    core.step(band(0, 0.8), DT);
    core.step(silence(), DT);
    core.step(silence(), DT);

    expect(core.step(band(0, 0.8), DT).kick).toBe(0);
  });

  it('reports the next kick once the cooldown is over', () => {
    const core = createSignalCore();

    core.step(band(0, 0.8), DT);
    Array.from({ length: 12 }).forEach(() => core.step(silence(), DT));

    expect(core.step(band(0, 0.8), DT).kick).toBeGreaterThanOrEqual(0.25);
  });

  // The two low bands share one cooldown, and a frame without a kick counts it
  // down twice. So 0.13 s of cooldown is over after 5 frames at 60 Hz, not 8.
  it('lets a kick through 5 frames after the last one', () => {
    const core = createSignalCore();

    core.step(band(0, 0.8), DT);
    Array.from({ length: 4 }).forEach(() => core.step(silence(), DT));

    expect(core.step(band(0, 0.8), DT).kick).toBeGreaterThanOrEqual(0.25);
  });

  it('blocks a kick 4 frames after the last one', () => {
    const core = createSignalCore();

    core.step(band(0, 0.8), DT);
    Array.from({ length: 3 }).forEach(() => core.step(silence(), DT));

    expect(core.step(band(0, 0.8), DT).kick).toBe(0);
  });

  it('reports a hat, not a kick, when the top band jumps', () => {
    const core = createSignalCore();

    core.step(silence(), DT);
    const hit = core.step(band(6, 0.6), DT);

    expect(hit.kick).toBe(0);
    expect(hit.snare).toBe(0);
    expect(hit.hat).toBeGreaterThanOrEqual(0.25);
    expect(hit.hat).toBeLessThanOrEqual(1);
  });

  it('reports a snare when band 4 jumps', () => {
    const core = createSignalCore();

    core.step(silence(), DT);
    const hit = core.step(band(4, 0.6), DT);

    expect(hit.kick).toBe(0);
    expect(hit.hat).toBe(0);
    expect(hit.snare).toBeGreaterThanOrEqual(0.25);
  });

  it('reports no hit while a band holds or falls', () => {
    const core = createSignalCore();

    core.step(band(0, 0.8), DT);
    Array.from({ length: 30 }).forEach(() => core.step(band(0, 0.8), DT));

    expect(core.step(band(0, 0.8), DT).kick).toBe(0);
    expect(core.step(band(0, 0.7), DT).kick).toBe(0);
  });

  it('raises the level fast and drops it slowly', () => {
    const core = createSignalCore();
    const loud = silence().map(() => 1);

    const up = core.step(loud, DT).level;
    const down = core.step(silence(), DT).level;

    expect(up).toBeCloseTo(1 - Math.exp(-DT / 0.06), 6);
    expect(down).toBeCloseTo(up * Math.exp(-DT / 0.35), 6);
    expect(up - 0).toBeGreaterThan(4 * (up - down));
  });

  it('takes bass from bands 0-1 and mid from bands 3-5', () => {
    const low = createSignalCore();
    const middle = createSignalCore();
    const approach = 1 - Math.exp(-DT / 0.025);

    const lowOut = low.step([0.6, 0.2, 0, 0, 0, 0, 0], DT);
    const midOut = middle.step([0, 0, 0, 0.3, 0.6, 0.9, 0], DT);

    expect(lowOut.bass).toBeCloseTo((0.8 * approach) / 2, 5);
    expect(lowOut.mid).toBe(0);
    expect(midOut.mid).toBeCloseTo((1.8 * approach) / 3, 5);
    expect(midOut.bass).toBe(0);
  });

  it('keeps separate state per core', () => {
    const first = createSignalCore();
    const second = createSignalCore();

    first.step(band(0, 0.8), DT);

    expect(second.step(band(0, 0.8), DT).kick).toBeGreaterThanOrEqual(0.25);
  });

  it('survives a zero or NaN time step', () => {
    const core = createSignalCore();

    core.step(band(0, 0.8), Number.NaN);
    const out = core.step(silence().map(() => 1), 0);

    expect(Object.values(out).every((v) => Number.isFinite(v))).toBe(true);
    expect(core.step(silence().map(() => 1), DT).level).toBeGreaterThan(0);
  });
});

describe('analyseMotion', () => {
  const BURSTS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5];

  /** Decaying 60 Hz bursts every 0.5 s up to 3.5 s, then silence to 6 s. */
  const kickTrack = (): Float32Array =>
    Float32Array.from({ length: SAMPLE_RATE * 6 }, (_, i) => {
      const t = i / SAMPLE_RATE;
      const since = t % 0.5;

      if (t < 0.5 || t >= 4) return 0;

      return 0.9 * Math.exp(-since / 0.06) * Math.sin(2 * Math.PI * 60 * since);
    });

  it('finds a kick near each burst and none in the silent stretch', () => {
    const result = analyseMotion(kickTrack(), SAMPLE_RATE);
    const kicks = result.events.filter((e) => e.kind === 0).map((e) => e.frame);

    expect(kicks.filter((frame) => frame > 4.2 * 60)).toEqual([]);
    BURSTS.forEach((at) => {
      const near = kicks.filter((frame) => frame >= at * 60 && frame <= at * 60 + 3);

      expect(near, `kick near ${at}s, got frames ${kicks.join(',')}`).toHaveLength(1);
    });
    expect(kicks).toHaveLength(BURSTS.length);
    expect(result.events.every((e) => e.strength >= 0.25 && e.strength <= 1)).toBe(true);
  });

  it('samples the envelopes at 20 Hz and raises bass during the bursts', () => {
    const result = analyseMotion(kickTrack(), SAMPLE_RATE);

    expect(result.bass).toHaveLength(120);
    expect(result.mid).toHaveLength(120);
    expect(result.level).toHaveLength(120);
    expect(Math.max(...result.bass.slice(10, 80))).toBeGreaterThan(0.3);
    expect(result.bass[5]).toBe(0);
    expect(result.bass[119]).toBeLessThan(0.01);
  });

  it('finds nothing in silence', () => {
    const result = analyseMotion(new Float32Array(SAMPLE_RATE * 2), SAMPLE_RATE);

    expect(result.events).toEqual([]);
    expect(result.bass).toEqual(new Array<number>(40).fill(0));
    expect(result.mid).toEqual(new Array<number>(40).fill(0));
    expect(result.level).toEqual(new Array<number>(40).fill(0));
  });

  it('finds hats, not kicks, in soft-edged bursts of a high tone', () => {
    const samples = Float32Array.from({ length: SAMPLE_RATE * 2 }, (_, i) => {
      const since = (i / SAMPLE_RATE) % 0.5;

      // 9 kHz, inside the 6-14 kHz band. The 4 ms fade-in keeps it from being a click, which has bass in it.
      const shape = (1 - Math.exp(-since / 0.004)) * Math.exp(-since / 0.03);

      return i < SAMPLE_RATE * 0.5 ? 0 : 0.8 * shape * Math.sin(2 * Math.PI * 9000 * since);
    });
    const result = analyseMotion(samples, SAMPLE_RATE);

    expect(result.events.filter((e) => e.kind === 0)).toEqual([]);
    expect(result.events.filter((e) => e.kind === 2).map((e) => e.frame)).toEqual([31, 61, 91]);
  });

  it('returns an empty track for no samples or a bad sample rate', () => {
    const empty = track({});

    expect(analyseMotion(new Float32Array(0), SAMPLE_RATE)).toEqual(empty);
    expect(analyseMotion(new Float32Array(1000), 0)).toEqual(empty);
    expect(analyseMotion(new Float32Array(1000), Number.NaN)).toEqual(empty);
  });
});

describe('encodeMotion / decodeMotion', () => {
  it('keeps every event frame and kind, and strength within 0.05', () => {
    const source = track({
      events: [
        { frame: 3, kind: 0, strength: 0.25 },
        { frame: 3, kind: 2, strength: 0.61 },
        { frame: 40, kind: 1, strength: 1 },
        { frame: 41, kind: 0, strength: 0.47 },
      ],
      bass: [0, 0.5],
      mid: [0.1, 0.2],
      level: [1, 0.3],
    });
    const decoded = decodeMotion(encodeMotion(source));

    expect(decoded?.events.map((e) => [e.frame, e.kind])).toEqual(source.events.map((e) => [e.frame, e.kind]));
    source.events.forEach((event, i) => {
      expect(Math.abs((decoded?.events[i]?.strength ?? -1) - event.strength)).toBeLessThanOrEqual(0.05);
    });
  });

  it('keeps the envelopes within the 4-bit tolerance', () => {
    const ramp = Array.from({ length: 41 }, (_, i) => i / 40);
    const source = track({ bass: ramp, mid: [...ramp].reverse(), level: ramp.map((v) => v * v) });
    const decoded = decodeMotion(encodeMotion(source));

    expect(decoded?.bass).toHaveLength(41);
    expect(decoded?.mid).toHaveLength(41);
    expect(decoded?.level).toHaveLength(41);
    ramp.forEach((_, i) => {
      expect(Math.abs((decoded?.bass[i] ?? -1) - (source.bass[i] ?? 0))).toBeLessThan(0.07);
      expect(Math.abs((decoded?.mid[i] ?? -1) - (source.mid[i] ?? 0))).toBeLessThan(0.07);
      expect(Math.abs((decoded?.level[i] ?? -1) - (source.level[i] ?? 0))).toBeLessThan(0.07);
    });
    expect(decoded?.bass[0]).toBe(0);
    expect(decoded?.bass[40]).toBe(1);
  });

  it('keeps long gaps between events', () => {
    const frames = [0, 255, 765, 766, 1066, 1700, 9000];
    const source = track({ events: frames.map((frame) => ({ frame, kind: 0 as const, strength: 0.5 })) });

    expect(decodeMotion(encodeMotion(source))?.events.map((e) => e.frame)).toEqual(frames);
  });

  it('round-trips an empty track', () => {
    expect(decodeMotion(encodeMotion(track({})))).toEqual(track({}));
  });

  it('round-trips an odd number of envelope samples with events after them', () => {
    const source = track({
      events: [{ frame: 7, kind: 1, strength: 1 }],
      bass: [1],
      mid: [1],
      level: [1],
    });

    expect(decodeMotion(encodeMotion(source))).toEqual(source);
  });

  it('writes version 1 and plain base64', () => {
    const encoded = encodeMotion(track({ bass: [1], mid: [0], level: [1] }));

    expect(bytesOf(encoded)).toEqual([1, 1, 0, 0, 0, 0, 0, 0xf0, 0xf0]);
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('clamps values outside 0..1 instead of wrapping', () => {
    const decoded = decodeMotion(
      encodeMotion(track({ events: [{ frame: 1, kind: 2, strength: 4 }], bass: [3], mid: [-2], level: [Number.NaN] }))
    );

    expect(decoded).toEqual(track({ events: [{ frame: 1, kind: 2, strength: 1 }], bass: [1], mid: [0], level: [0] }));
  });

  it('round-trips a track longer than one string chunk', () => {
    const level = Array.from({ length: 9000 }, (_, i) => (i % 16) / 15);
    const source = track({ bass: level, mid: level, level });
    const decoded = decodeMotion(encodeMotion(source));

    expect(decoded?.level).toHaveLength(9000);
    expect(decoded?.level[8999]).toBeCloseTo(((8999 % 16) / 15), 1);
  });
});

describe('decodeMotion on bad input', () => {
  const valid = (): number[] =>
    bytesOf(
      encodeMotion(
        track({
          events: [
            { frame: 10, kind: 0, strength: 0.8 },
            { frame: 400, kind: 2, strength: 0.4 },
          ],
          bass: [0.2, 0.4, 0.6],
          mid: [0.1, 0.1, 0.1],
          level: [0.5, 0.5, 0.5],
        })
      )
    );

  it('reads the valid sample (so the cases below fail for the right reason)', () => {
    expect(decodeMotion(toBase64(valid()))?.events).toHaveLength(2);
  });

  it('returns null for an empty string', () => {
    expect(decodeMotion('')).toBeNull();
  });

  it('returns null for text that is not base64', () => {
    expect(decodeMotion('%%% not base64 %%%')).toBeNull();
    expect(decodeMotion('hello world, this is not a motion track')).toBeNull();
  });

  it('returns null for a wrong version', () => {
    expect(decodeMotion(toBase64(valid().map((byte, i) => (i === 0 ? 2 : byte))))).toBeNull();
  });

  it('returns null for every truncated length', () => {
    const bytes = valid();

    bytes.forEach((_, length) => {
      expect(decodeMotion(toBase64(bytes.slice(0, length))), `cut to ${length} bytes`).toBeNull();
    });
  });

  it('returns null when the header promises more than the payload holds', () => {
    expect(decodeMotion(toBase64([1, 255, 255, 255, 0, 0, 0, 1, 2, 3]))).toBeNull();
    expect(decodeMotion(toBase64([1, 0, 0, 0, 255, 255, 255, 1, 2]))).toBeNull();
  });

  it('returns null for an unknown event kind', () => {
    expect(decodeMotion(toBase64([1, 0, 0, 0, 1, 0, 0, 5, 0x3f]))).toBeNull();
  });

  it('returns null for bytes left over after the last event', () => {
    expect(decodeMotion(toBase64([...valid(), 0]))).toBeNull();
  });

  it('returns null for a value that is not a string', () => {
    const decodeUnknown: (value: unknown) => MotionTrack | null = decodeMotion as (value: unknown) => MotionTrack | null;

    expect(decodeUnknown(undefined)).toBeNull();
    expect(decodeUnknown(42)).toBeNull();
  });
});

describe('createMotionReader', () => {
  const sample = (): MotionTrack =>
    track({
      events: [
        { frame: 30, kind: 0, strength: 0.8 },
        { frame: 33, kind: 2, strength: 0.4 },
        { frame: 60, kind: 1, strength: 0.6 },
        { frame: 61, kind: 0, strength: 0.5 },
        { frame: 62, kind: 0, strength: 0.9 },
      ],
      bass: [0, 1, 0.5],
      mid: [0.2, 0.4, 0.8],
      level: [1, 0, 0],
    });

  it('interpolates the envelopes between samples', () => {
    const reader = createMotionReader(sample());
    const quarter = reader.read(0.0125, DT);

    expect(quarter.bass).toBeCloseTo(0.25, 6);
    expect(quarter.mid).toBeCloseTo(0.25, 6);
    expect(quarter.level).toBeCloseTo(0.75, 6);
    expect(reader.read(0.05, DT).bass).toBeCloseTo(1, 6);
    expect(reader.read(0.075, DT).bass).toBeCloseTo(0.75, 6);
  });

  it('delivers each hit exactly once as time advances', () => {
    const reader = createMotionReader(sample());
    const reads = Array.from({ length: 90 }, (_, i) => reader.read(i / 60 + 0.001, DT));

    expect(reads.map((r) => r.kick).filter((v) => v > 0)).toEqual([0.8, 0.5, 0.9]);
    expect(reads.map((r) => r.hat).filter((v) => v > 0)).toEqual([0.4]);
    expect(reads.map((r) => r.snare).filter((v) => v > 0)).toEqual([0.6]);
    expect(reads[30]?.kick).toBe(0.8);
    expect(reads[29]?.kick).toBe(0);
  });

  it('keeps the strongest hit when two of a kind land in one read', () => {
    const reader = createMotionReader(sample());

    reader.read(0.95, DT);

    expect(reader.read(1.1, DT)).toMatchObject({ kick: 0.9, snare: 0.6, hat: 0 });
  });

  it('reports no hits on the first read', () => {
    const reader = createMotionReader(sample());

    expect(reader.read(0.6, DT)).toMatchObject({ kick: 0, snare: 0, hat: 0 });
  });

  it('reports no hits on a backwards jump, then re-syncs', () => {
    const reader = createMotionReader(sample());

    reader.read(1.2, DT);

    expect(reader.read(0.52, DT)).toMatchObject({ kick: 0, snare: 0, hat: 0 });
    expect(reader.read(0.56, DT)).toMatchObject({ kick: 0, snare: 0, hat: 0.4 });
    expect(reader.read(0.6, DT)).toMatchObject({ kick: 0, snare: 0, hat: 0 });
  });

  it('reports no hits on a forward jump longer than 0.25 s, then re-syncs', () => {
    const reader = createMotionReader(sample());

    reader.read(0.1, DT);

    expect(reader.read(0.52, DT)).toMatchObject({ kick: 0, snare: 0, hat: 0 });
    expect(reader.read(0.56, DT).hat).toBe(0.4);
  });

  it('still reports hits across a step just under 0.25 s', () => {
    const reader = createMotionReader(sample());

    reader.read(0.31, DT);

    expect(reader.read(0.555, DT)).toMatchObject({ kick: 0.8, hat: 0.4 });
  });

  it('is safe past the end and holds the last envelope sample', () => {
    const reader = createMotionReader(sample());

    reader.read(1.2, DT);
    const out = reader.read(1.3, DT);

    expect(out).toEqual({ level: 0, bass: 0.5, mid: 0.8, kick: 0, snare: 0, hat: 0 });
    expect(reader.read(500, DT)).toEqual(out);
  });

  it('returns zeros for an empty track and for a time that is not a number', () => {
    expect(createMotionReader(track({})).read(1, DT)).toEqual(SILENT);
    expect(createMotionReader(sample()).read(Number.NaN, DT)).toEqual(SILENT);
  });

  it('reads back what analyseMotion and the codec produce', () => {
    const samples = Float32Array.from({ length: SAMPLE_RATE * 2 }, (_, i) => {
      const t = i / SAMPLE_RATE;

      return t < 1 ? 0 : 0.9 * Math.exp(-(t - 1) / 0.06) * Math.sin(2 * Math.PI * 60 * (t - 1));
    });
    const decoded = decodeMotion(encodeMotion(analyseMotion(samples, SAMPLE_RATE)));
    const reader = createMotionReader(decoded ?? track({}));
    const reads = Array.from({ length: 120 }, (_, i) => reader.read(i / 60, DT));
    const kickFrames = reads.flatMap((r, i) => (r.kick > 0 ? [i] : []));

    expect(kickFrames).toHaveLength(1);
    expect(kickFrames[0]).toBeGreaterThanOrEqual(60);
    expect(kickFrames[0]).toBeLessThanOrEqual(63);
    expect(reads[66]?.bass).toBeGreaterThan(0.2);
    expect(reads[30]?.bass).toBe(0);
  });
});

describe('createPeaksReader', () => {
  /** 300 quiet buckets with one loud pair in the middle. */
  const peaks = (): number[] => Array.from({ length: 300 }, (_, i) => (i === 150 || i === 151 ? 0.9 : 0.2));
  const DURATION = 30;

  /** Reads frame by frame from `fromSec` to `toSec`. */
  const play = (reader: ReturnType<typeof createPeaksReader>, fromSec: number, toSec: number): InkSignals[] =>
    Array.from({ length: Math.round((toSec - fromSec) * 60) + 1 }, (_, i) => reader.read(fromSec + i / 60, DT));

  it('returns zeros while the duration is 0 or NaN', () => {
    expect(createPeaksReader(peaks(), () => 0).read(15, DT)).toEqual(SILENT);
    expect(createPeaksReader(peaks(), () => Number.NaN).read(15, DT)).toEqual(SILENT);
    expect(createPeaksReader(peaks(), () => Number.POSITIVE_INFINITY).read(15, DT)).toEqual(SILENT);
  });

  it('kicks once when the playhead crosses a jump in the peaks', () => {
    const reader = createPeaksReader(peaks(), () => DURATION);
    const kicks = play(reader, 14, 16).map((r) => r.kick).filter((v) => v > 0);

    expect(kicks).toHaveLength(1);
    expect(kicks[0]).toBeGreaterThanOrEqual(0.35);
    expect(kicks[0]).toBeLessThanOrEqual(1);
  });

  it('does not kick on a seek over the jump', () => {
    const reader = createPeaksReader(peaks(), () => DURATION);

    reader.read(10, DT);

    expect(reader.read(20, DT).kick).toBe(0);
    expect(play(reader, 20, 21).every((r) => r.kick === 0)).toBe(true);
  });

  it('does not kick on the first read or on a backwards seek', () => {
    const reader = createPeaksReader(peaks(), () => DURATION);

    expect(reader.read(15.05, DT).kick).toBe(0);
    reader.read(16, DT);
    expect(reader.read(14.99, DT).kick).toBe(0);
    expect(play(reader, 14.99, 15.2).filter((r) => r.kick > 0)).toHaveLength(1);
  });

  it('follows the peak under the playhead and derives bass and mid from it', () => {
    const reader = createPeaksReader(peaks(), () => DURATION);
    const settled = play(reader, 5, 9).at(-1);

    expect(settled?.level).toBeCloseTo(0.2, 3);
    expect(settled?.bass).toBeCloseTo((settled?.level ?? 0) * 0.5, 9);
    expect(settled?.mid).toBeCloseTo((settled?.level ?? 0) * 0.3, 9);
    expect(settled?.snare).toBe(0);
    expect(settled?.hat).toBe(0);
  });

  it('raises the level fast on the loud bars and drops it slowly after', () => {
    const reader = createPeaksReader(peaks(), () => DURATION);
    const before = play(reader, 13, 14.99).at(-1)?.level ?? 0;
    const during = play(reader, 15, 15.19).at(-1)?.level ?? 0;
    const after = reader.read(15.2 + DT, DT).level;

    expect(during).toBeGreaterThan(0.8);
    expect(before).toBeCloseTo(0.2, 2);
    expect(after).toBeGreaterThan(0.8);
  });

  it('starts working once the duration becomes known', () => {
    const state = { duration: Number.NaN };
    const reader = createPeaksReader(peaks(), () => state.duration);

    expect(reader.read(14.9, DT)).toEqual(SILENT);
    state.duration = DURATION;

    expect(play(reader, 14.9, 15.2).filter((r) => r.kick > 0)).toHaveLength(1);
  });

  it('is safe with no peaks and past the end', () => {
    expect(createPeaksReader([], () => DURATION).read(3, DT)).toEqual(SILENT);

    const reader = createPeaksReader(peaks(), () => DURATION);

    expect(Object.values(reader.read(999, DT)).every((v) => Number.isFinite(v))).toBe(true);
    expect(Object.values(reader.read(-5, DT)).every((v) => Number.isFinite(v))).toBe(true);
  });
});
