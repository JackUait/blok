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
  it('fills with the hover gray and primary ink, like a hovered chip', () => {
    const pressed = block(`${CHIP}[aria-pressed="true"]`);

    expect(pressed).toContain('background: var(--blok-video-control-bg-hover)');
    expect(pressed).toContain('color: var(--blok-video-control-fg)');
  });

  it('paints no blue and no focus-ring token', () => {
    const pressed = block(`${CHIP}[aria-pressed="true"]`);

    expect(pressed).not.toMatch(/blue|focus-ring|#[0-9a-f]{3,6}|rgb/i);
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
