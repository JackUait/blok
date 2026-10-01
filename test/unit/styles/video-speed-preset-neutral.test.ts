/**
 * The pressed speed preset is gray, never blue (CLAUDE.md "No blue selected states").
 * jsdom has no CSS, so this reads the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/video.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');

const block = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));

  return match?.[1] ?? '';
};

const CHIP = '[data-blok-tool="video"] .blok-video-controls__speed-chip';

describe('video speed preset — pressed state', () => {
  const PUCK = '[data-blok-tool="video"] .blok-video-controls__speed-puck';
  const SNAPPED = '[data-blok-tool="video"] .blok-video-controls__speed-chips[data-snapped] .blok-video-controls__speed-puck';

  it('the snapped puck fills with the hover gray; the pressed chip shows primary ink', () => {
    expect(block(SNAPPED)).toContain('background: var(--blok-video-control-bg-hover)');
    expect(block(`${CHIP}[aria-pressed="true"]`)).toContain('color: var(--blok-video-control-fg)');
  });

  it('between presets the puck is a thin line under the labels, not a tile across them', () => {
    // A 2px line resting just above the well's bottom edge; snapping lifts its top to a full tile.
    expect(block(PUCK)).toContain('top: calc(100% - var(--blok-space-1) - 2px)');
    expect(block(PUCK)).toContain('bottom: var(--blok-space-1)');
    expect(block(SNAPPED)).toContain('top: var(--blok-space-0-5)');
    expect(block(SNAPPED)).toContain('bottom: var(--blok-space-0-5)');
  });

  it('paints no blue and no focus-ring token', () => {
    [block(SNAPPED), block(PUCK), block(`${CHIP}[aria-pressed="true"]`)].forEach((rule) => {
      expect(rule).not.toMatch(/blue|focus-ring|#[0-9a-f]{3,6}|rgb/i);
    });
  });
});

describe('video speed ruler — focus ring', () => {
  it('rings the needle only when the range was not focused by a pointer press', () => {
    expect(css).toMatch(/\.blok-video-controls__speed-ruler:not\(\[data-pointer-focus\]\) \.blok-video-controls__speed-slider:focus-visible ~ \.blok-video-controls__speed-needle\s*\{/);
  });
});

describe('video speed ruler — size', () => {
  const px = (selector: string, prop: string): number =>
    Number(block(selector).match(new RegExp(`(?:^|;|\\s)${prop}:\\s*([\\d.]+)px`))?.[1] ?? NaN);

  it('stays a compact strip, not taller than the preset bar plus its gap', () => {
    expect(px('[data-blok-tool="video"] .blok-video-controls__speed-ruler', 'height')).toBeLessThanOrEqual(32);
    expect(px('[data-blok-tool="video"] .blok-video-controls__speed-needle', 'height')).toBeLessThanOrEqual(16);
    expect(px('[data-blok-tool="video"] .blok-video-controls__speed-tick.is-major', 'height')).toBeLessThanOrEqual(9);
  });
});
