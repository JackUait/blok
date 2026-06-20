import { describe, it, expect } from 'vitest';
import {
  cometEnvelope,
  headFocus,
  ambientWave,
  liveAmplitude,
  entranceEase,
  headColorBlend,
  REACH_AHEAD,
  REACH_BEHIND,
} from '../../../../src/tools/audio/liveliness';

/** Peak-to-peak swing of a bar's amplitude across a time sweep. */
function swing(index: number, playheadIndex: number): number {
  const vals: number[] = [];
  for (let k = 0; k < 100; k++) {
    vals.push(
      liveAmplitude({ basePeak: 0.5, index, playheadIndex, timeSeconds: k * 0.05, reduced: false })
    );
  }
  return Math.max(...vals) - Math.min(...vals);
}

describe('cometEnvelope', () => {
  it('is 1 at the playhead and 0 beyond each reach', () => {
    expect(cometEnvelope(0)).toBe(1);
    expect(cometEnvelope(REACH_AHEAD)).toBe(0);
    expect(cometEnvelope(-REACH_BEHIND)).toBe(0);
    expect(cometEnvelope(REACH_AHEAD + 3)).toBe(0);
    expect(cometEnvelope(-(REACH_BEHIND + 3))).toBe(0);
  });

  it('trails further behind the playhead than ahead (a wake)', () => {
    for (const d of [1, 2, 3]) {
      expect(cometEnvelope(-d)).toBeGreaterThan(cometEnvelope(d));
    }
  });

  it('falls off monotonically on each side', () => {
    const ahead = [0, 1, 2, 3].map((d) => cometEnvelope(d));
    const behind = [0, 1, 2, 3, 4, 5].map((d) => cometEnvelope(-d));
    for (let i = 1; i < ahead.length; i++) expect(ahead[i]).toBeLessThan(ahead[i - 1]);
    for (let i = 1; i < behind.length; i++) expect(behind[i]).toBeLessThan(behind[i - 1]);
  });
});

describe('headFocus', () => {
  it('peaks at the playhead and fades fast', () => {
    expect(headFocus(0)).toBe(1);
    expect(headFocus(3)).toBe(0);
    expect(headFocus(1)).toBeLessThan(headFocus(0));
    expect(headFocus(1)).toBeLessThan(cometEnvelope(1));
  });
});

describe('ambientWave', () => {
  it('stays within [-1, 1]', () => {
    for (let i = 0; i < 40; i++) {
      for (const t of [0, 0.3, 0.7, 1.1, 1.9, 2.7, 3.6]) {
        const v = ambientWave(i, t);
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('varies across the field and over time', () => {
    expect(ambientWave(3, 0.5)).not.toBe(ambientWave(9, 0.5));
    expect(ambientWave(5, 0.2)).not.toBe(ambientWave(5, 0.9));
  });
});

describe('entranceEase', () => {
  it('runs 0→1 and clamps outside that range', () => {
    expect(entranceEase(0)).toBe(0);
    expect(entranceEase(1)).toBe(1);
    expect(entranceEase(-0.5)).toBe(0);
    expect(entranceEase(2)).toBe(1);
  });

  it('eases out — most of the progress lands early', () => {
    expect(entranceEase(0.5)).toBeGreaterThan(0.5);
    // monotonically increasing
    const xs = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => entranceEase(t));
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  });
});

describe('headColorBlend', () => {
  it('is 0 outside the head and peaks at the playhead', () => {
    expect(headColorBlend({ distance: 5, energy: 1, entrance: 1 })).toBe(0);
    expect(headColorBlend({ distance: 0, energy: 1, entrance: 1 })).toBe(1);
  });

  it('scales with both energy and the entrance ramp', () => {
    const full = headColorBlend({ distance: 0, energy: 1, entrance: 1 });
    expect(headColorBlend({ distance: 0, energy: 0.5, entrance: 1 })).toBeCloseTo(full * 0.5, 10);
    expect(headColorBlend({ distance: 0, energy: 1, entrance: 0.5 })).toBeCloseTo(full * 0.5, 10);
    expect(headColorBlend({ distance: 0, energy: 0, entrance: 1 })).toBe(0);
    expect(headColorBlend({ distance: 0, energy: 1, entrance: 0 })).toBe(0);
  });
});

describe('liveAmplitude', () => {
  const base = 0.5;

  it('returns the static peak untouched when reduced motion is requested', () => {
    for (const t of [0, 0.3, 0.9, 1.7]) {
      expect(
        liveAmplitude({ basePeak: base, index: 10, playheadIndex: 10, timeSeconds: t, reduced: true })
      ).toBe(base);
    }
  });

  it('returns the static peak when energy is zero (fully settled)', () => {
    expect(
      liveAmplitude({ basePeak: base, index: 30, playheadIndex: 10, timeSeconds: 0.5, reduced: false, energy: 0 })
    ).toBe(base);
  });

  it('brings the whole field to life — even bars far from the playhead move', () => {
    // The ambient ripple reaches everywhere, so a far-ahead preview bar still
    // breathes instead of sitting frozen.
    expect(swing(60, 10)).toBeGreaterThan(0);
  });

  it('keeps the playhead the most energetic point', () => {
    expect(swing(10, 10)).toBeGreaterThan(swing(60, 10));
  });

  it('shimmers the played trail more than the unplayed preview', () => {
    // Equal distance on each side, both beyond the comet reach: the played wake
    // (behind) keeps more ambient energy than the preview (ahead).
    expect(swing(10 - 15, 10)).toBeGreaterThan(swing(10 + 15, 10));
  });

  it('keeps amplitudes within the drawable 0..1 range', () => {
    for (let i = 0; i < 64; i++) {
      for (const t of [0, 0.2, 0.4, 0.6, 0.8, 1, 1.3, 2.2]) {
        const a = liveAmplitude({ basePeak: 0.95, index: i, playheadIndex: 10, timeSeconds: t, reduced: false });
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
    }
  });

  it('lifts even quiet sections into visible life near the playhead', () => {
    const peak = Math.max(
      ...[0, 0.1, 0.2, 0.3, 0.4, 0.5].map((t) =>
        liveAmplitude({ basePeak: 0.04, index: 10, playheadIndex: 10, timeSeconds: t, reduced: false })
      )
    );
    expect(peak).toBeGreaterThan(0.04);
  });

  it('scales the live boost by energy (for the pause settle)', () => {
    const opts = { basePeak: 0.2, index: 10, playheadIndex: 10, timeSeconds: 0.12, reduced: false };
    const full = liveAmplitude({ ...opts, energy: 1 });
    const half = liveAmplitude({ ...opts, energy: 0.5 });
    const none = liveAmplitude({ ...opts, energy: 0 });
    expect(none).toBe(0.2);
    expect(half - 0.2).toBeCloseTo((full - 0.2) / 2, 10);
  });

  it('defaults energy to full when omitted', () => {
    const opts = { basePeak: 0.2, index: 10, playheadIndex: 10, timeSeconds: 0.12, reduced: false };
    expect(liveAmplitude(opts)).toBe(liveAmplitude({ ...opts, energy: 1 }));
  });
});
