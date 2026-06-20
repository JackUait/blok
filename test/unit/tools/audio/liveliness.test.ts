import { describe, it, expect } from 'vitest';
import {
  cometEnvelope,
  headFocus,
  liveAmplitude,
  REACH_AHEAD,
  REACH_BEHIND,
} from '../../../../src/tools/audio/liveliness';

describe('cometEnvelope', () => {
  it('is 1 at the playhead and 0 beyond each reach', () => {
    expect(cometEnvelope(0)).toBe(1);
    expect(cometEnvelope(REACH_AHEAD)).toBe(0);
    expect(cometEnvelope(-REACH_BEHIND)).toBe(0);
    expect(cometEnvelope(REACH_AHEAD + 3)).toBe(0);
    expect(cometEnvelope(-(REACH_BEHIND + 3))).toBe(0);
  });

  it('trails further behind the playhead than ahead (a wake)', () => {
    // Same magnitude, opposite sides: the already-played side (negative) keeps
    // more energy than the not-yet-played side (positive).
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
    // Sharper than the comet body: at distance 1 the head spike has dropped
    // below the body envelope.
    expect(headFocus(1)).toBeLessThan(cometEnvelope(1));
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

  it('returns the static peak for bars beyond the wake', () => {
    expect(
      liveAmplitude({ basePeak: base, index: 40, playheadIndex: 10, timeSeconds: 0.5, reduced: false })
    ).toBe(base);
    expect(
      liveAmplitude({ basePeak: base, index: 0, playheadIndex: 40, timeSeconds: 0.5, reduced: false })
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
    for (let i = 0; i < 22; i++) {
      for (const t of [0, 0.2, 0.4, 0.6, 0.8, 1, 1.3]) {
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
    expect(none).toBe(0.2); // energy 0 → back to the resting peak
    // The boost above the resting peak should halve with energy.
    expect(half - 0.2).toBeCloseTo((full - 0.2) / 2, 10);
  });

  it('defaults energy to full when omitted', () => {
    const opts = { basePeak: 0.2, index: 10, playheadIndex: 10, timeSeconds: 0.12, reduced: false };
    expect(liveAmplitude(opts)).toBe(liveAmplitude({ ...opts, energy: 1 }));
  });
});
