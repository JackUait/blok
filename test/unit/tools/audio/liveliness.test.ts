import { describe, it, expect } from 'vitest';
import { playheadEnvelope, liveAmplitude, PLAYHEAD_REACH } from '../../../../src/tools/audio/liveliness';

describe('playheadEnvelope', () => {
  it('is 1 at the playhead and 0 once beyond the reach', () => {
    expect(playheadEnvelope(0)).toBe(1);
    expect(playheadEnvelope(PLAYHEAD_REACH)).toBe(0);
    expect(playheadEnvelope(PLAYHEAD_REACH + 5)).toBe(0);
  });

  it('falls off monotonically and is symmetric around the playhead', () => {
    const samples = [0, 1, 2, 3, 4, 5].map((d) => playheadEnvelope(d));
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeLessThan(samples[i - 1]);
    }
    expect(playheadEnvelope(-3)).toBeCloseTo(playheadEnvelope(3), 10);
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

  it('returns the static peak for bars far from the playhead', () => {
    expect(
      liveAmplitude({ basePeak: base, index: 40, playheadIndex: 10, timeSeconds: 0.5, reduced: false })
    ).toBe(base);
  });

  it('animates bars near the playhead — amplitude varies over time', () => {
    const values = [0, 0.05, 0.1, 0.15, 0.2, 0.25].map((t) =>
      liveAmplitude({ basePeak: base, index: 10, playheadIndex: 10, timeSeconds: t, reduced: false })
    );
    const unique = new Set(values.map((v) => v.toFixed(4)));
    expect(unique.size).toBeGreaterThan(1);
  });

  it('keeps amplitudes within the drawable 0..1 range', () => {
    for (let i = 5; i < 16; i++) {
      for (const t of [0, 0.2, 0.4, 0.6, 0.8, 1, 1.3]) {
        const a = liveAmplitude({ basePeak: 0.95, index: i, playheadIndex: 10, timeSeconds: t, reduced: false });
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
    }
  });

  it('lifts even quiet sections into visible life near the playhead', () => {
    // A near-silent bucket (0.04) should still rise meaningfully at some phase
    // so the visualizer never flatlines during quiet passages.
    const peak = Math.max(
      ...[0, 0.1, 0.2, 0.3, 0.4, 0.5].map((t) =>
        liveAmplitude({ basePeak: 0.04, index: 10, playheadIndex: 10, timeSeconds: t, reduced: false })
      )
    );
    expect(peak).toBeGreaterThan(0.04);
  });
});
