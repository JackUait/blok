import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createVolumeIcon, volumeLevelIcon } from '../../../../src/components/utils/volume-icon';
import { IconPlayerVolume, IconPlayerVolumeMute } from '../../../../src/components/icons';

interface Wave {
  x: number;
  top: number;
  bottom: number;
  r: number;
  opacity: number;
}

const paths = (svg: string): Element[] => {
  const host = document.createElement('div');
  host.innerHTML = svg;

  return [...host.querySelectorAll('path')];
};

/** Reads `M x y A r r 0 0 1 x y2` back into numbers. */
const waves = (level: number): Wave[] =>
  paths(volumeLevelIcon(level)).slice(1).map((path) => {
    const n = (path.getAttribute('d') ?? '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];

    return { x: n[0], top: n[1], r: n[2], bottom: n[8], opacity: Number(path.getAttribute('opacity') ?? '1') };
  });

/** Rightmost point of a wave: its centre sits left of the chord. */
const peak = (w: Wave): number => {
  const half = (w.bottom - w.top) / 2;

  return w.x - Math.sqrt(w.r * w.r - half * half) + w.r;
};

describe('volumeLevelIcon', () => {
  it('lands on the published two-wave drawing at full volume', () => {
    const [inner, outer] = waves(1);

    expect(inner).toEqual({ x: 12, top: 7.5, bottom: 12.5, r: 3.5, opacity: 1 });
    expect(outer).toEqual({ x: 14.5, top: 5.5, bottom: 14.5, r: 6.5, opacity: 1 });
  });

  it('keeps the published speaker body and svg root', () => {
    const published = paths(IconPlayerVolume)[0];
    const [body] = paths(volumeLevelIcon(0.4));

    expect(body.outerHTML).toBe(published.outerHTML);
    expect(volumeLevelIcon(0.4).trim().split('\n')[0]).toBe(IconPlayerVolume.trim().split('\n')[0]);
  });

  it('shows only the full inner wave at half volume', () => {
    expect(waves(0.5)).toEqual([{ x: 12, top: 7.5, bottom: 12.5, r: 3.5, opacity: 1 }]);
  });

  it('draws a smaller, closer inner wave when quiet', () => {
    const [quiet, ...rest] = waves(0.25);

    expect(rest).toEqual([]);
    expect(quiet.r).toBeLessThan(3.5);
    expect(quiet.r).toBeGreaterThan(2.4);
    expect(peak(quiet)).toBeLessThan(peak(waves(0.5)[0]));
    expect(quiet.bottom - quiet.top).toBeLessThan(5);
  });

  it('grows each wave as the volume rises', () => {
    const levels = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5];
    const innerPeaks = levels.map((level) => peak(waves(level)[0]));
    const outerPeaks = levels.map((level) => peak(waves(level + 0.5)[1]));

    expect(innerPeaks).toEqual([...innerPeaks].sort((a, b) => a - b));
    expect(outerPeaks).toEqual([...outerPeaks].sort((a, b) => a - b));
    expect(new Set(innerPeaks).size).toBe(levels.length);
    expect(new Set(outerPeaks).size).toBe(levels.length);
  });

  it('never draws a wave shorter than twice the stroke', () => {
    for (const level of [0.05, 0.55]) {
      const w = waves(level).at(-1);

      expect(w && w.bottom - w.top).toBeGreaterThanOrEqual(2.5);
    }
  });

  it('keeps the outer wave clear of the inner one', () => {
    for (const level of [0.55, 0.6, 0.75, 0.9]) {
      const [inner, outer] = waves(level);

      // one stroke width of paint plus half a unit of air
      expect(peak(outer) - peak(inner)).toBeGreaterThanOrEqual(1.75);
    }
  });

  it('fades a wave in over its first steps, then draws it solid', () => {
    expect(waves(0.05)[0].opacity).toBeLessThan(1);
    expect(waves(0.05)[0].opacity).toBeGreaterThan(0);
    expect(waves(0.55)[1].opacity).toBeLessThan(1);
    expect(waves(0.3)[0].opacity).toBe(1);
    expect(waves(0.8)[1].opacity).toBe(1);
  });

  it('draws no wave at zero and clamps out-of-range levels', () => {
    expect(waves(0)).toEqual([]);
    expect(volumeLevelIcon(-1)).toBe(volumeLevelIcon(0));
    expect(volumeLevelIcon(2)).toBe(volumeLevelIcon(1));
    expect(volumeLevelIcon(Number.NaN)).toBe(volumeLevelIcon(1));
  });
});

describe('volumeLevelIcon — muted', () => {
  it('is the published muted drawing once no wave is left', () => {
    expect(volumeLevelIcon(0, true)).toBe(IconPlayerVolumeMute);
  });

  it('keeps the waves under the cross while they leave', () => {
    const drawn = paths(volumeLevelIcon(0.4, true)).map((path) => path.getAttribute('d'));

    expect(drawn).toHaveLength(3);
    expect(drawn[2]).toBe('M13 8L17 12M17 8L13 12');
    expect(drawn[1]).toBe(paths(volumeLevelIcon(0.4))[1].getAttribute('d'));
  });
});

describe('createVolumeIcon', () => {
  const markup = (svg: string): string => {
    const holder = document.createElement('div');

    holder.innerHTML = svg;

    return holder.innerHTML;
  };
  const reducedMotion = (reduce: boolean): void => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce') }));
  };
  let host: HTMLButtonElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    reducedMotion(false);
    host = document.createElement('button');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('draws the first state at once', () => {
    const icon = createVolumeIcon(host);

    icon.paint(0.3, false);

    expect(host.innerHTML).toBe(markup(volumeLevelIcon(0.3)));
    icon.destroy();
  });

  it('glides to a new level instead of jumping', () => {
    const icon = createVolumeIcon(host);

    icon.paint(0.2, false);
    icon.paint(1, false);
    vi.advanceTimersByTime(34);

    expect(host.innerHTML).not.toBe(markup(volumeLevelIcon(0.2)));
    expect(host.innerHTML).not.toBe(markup(volumeLevelIcon(1)));

    vi.advanceTimersByTime(1000);
    expect(host.innerHTML).toBe(markup(volumeLevelIcon(1)));
    icon.destroy();
  });

  it('shows the cross at once on mute and lets the waves shrink away', () => {
    const icon = createVolumeIcon(host);

    icon.paint(1, false);
    icon.paint(1, true);

    expect(host.querySelectorAll('path')).toHaveLength(4);
    expect(host.querySelector('path:last-of-type')?.getAttribute('d')).toBe('M13 8L17 12M17 8L13 12');

    vi.advanceTimersByTime(1000);
    expect(host.innerHTML).toBe(markup(IconPlayerVolumeMute));
    icon.destroy();
  });

  it('grows the waves back on unmute', () => {
    const icon = createVolumeIcon(host);

    icon.paint(0.8, true);
    expect(host.innerHTML).toBe(markup(IconPlayerVolumeMute));

    icon.paint(0.8, false);
    expect(host.innerHTML).not.toBe(markup(volumeLevelIcon(0.8)));

    vi.advanceTimersByTime(1000);
    expect(host.innerHTML).toBe(markup(volumeLevelIcon(0.8)));
    icon.destroy();
  });

  // The video player pops the svg on a mute flip. A new svg would restart that.
  it('keeps one svg element across frames', () => {
    const icon = createVolumeIcon(host);

    icon.paint(0.2, false);
    const svg = host.querySelector('svg');

    icon.paint(1, false);
    vi.advanceTimersByTime(1000);
    icon.paint(1, true);
    vi.advanceTimersByTime(1000);

    expect(host.querySelector('svg')).toBe(svg);
    icon.destroy();
  });

  it('jumps straight to the level under reduced motion', () => {
    reducedMotion(true);
    const icon = createVolumeIcon(host);

    icon.paint(0.2, false);
    icon.paint(1, false);

    expect(host.innerHTML).toBe(markup(volumeLevelIcon(1)));
    icon.destroy();
  });

  it('stops drawing after destroy', () => {
    const icon = createVolumeIcon(host);

    icon.paint(0.2, false);
    icon.paint(1, false);
    icon.destroy();
    const frozen = host.innerHTML;

    vi.advanceTimersByTime(1000);
    expect(host.innerHTML).toBe(frozen);
  });
});
