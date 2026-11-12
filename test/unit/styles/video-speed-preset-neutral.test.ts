/**
 * The speed presets are plain buttons: same size, no selected state, never blue
 * (CLAUDE.md "No blue selected states"). jsdom has no CSS, so this reads the source.
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
const px = (selector: string, prop: string): number =>
  Number(block(selector).match(new RegExp(`(?:^|;|\\s)${prop}:\\s*(-?[\\d.]+)px`))?.[1] ?? NaN);

const PRESET = '[data-blok-tool="video"] .blok-video-controls__speed-preset';
const STEP = '[data-blok-tool="video"] .blok-video-controls__speed-step';

describe('video speed presets', () => {
  it('gives every preset the same 42 × 24 pill, whatever its label', () => {
    expect(px(PRESET, 'width')).toBe(42);
    expect(px(PRESET, 'height')).toBe(24);
    expect(block(PRESET)).toContain('padding: 0');
    expect(block(PRESET)).toContain('border-radius: var(--blok-radius-pill)');
  });

  it('centres each preset under its peg from the wire geometry', () => {
    // 26 and 188 are the pad and span in speed-wire.ts; 240 is its viewBox width.
    expect(block(PRESET)).toContain('left: calc((26 + var(--blok-speed-at, 0) * 188) / 240 * 100%)');
    expect(block(PRESET)).toContain('transform: translateX(-50%)');
  });

  it('leaves a gap between neighbours: pegs are 188 / 4 apart', () => {
    expect(188 / 4 - px(PRESET, 'width')).toBeGreaterThanOrEqual(4);
  });

  it('paints no selected state at all', () => {
    expect(css).not.toMatch(/speed-preset[^{]*\[aria-pressed/);
    expect(css).not.toMatch(/speed-preset[^{]*\[aria-checked/);
    expect(css).not.toMatch(/speed-preset[^{]*\[aria-current/);
    expect(css).not.toMatch(/speed-preset[^{]*\[data-(active|selected|snapped)/);
  });

  it('brightens on hover with the hover gray and primary ink', () => {
    expect(block(`${PRESET}:hover`)).toContain('background: var(--blok-video-control-bg-hover)');
    expect(block(`${PRESET}:hover`)).toContain('color: var(--blok-video-control-fg)');
  });

  it('paints no blue', () => {
    [block(PRESET), block(`${PRESET}:hover`), block(`${PRESET}:active`)].forEach((rule) => {
      expect(rule).not.toMatch(/blue|focus-ring|#[0-9a-f]{3,6}|rgb/i);
    });
  });
});

describe('video speed step buttons', () => {
  it('are 32px round buttons that dim when they cannot step', () => {
    expect(px(STEP, 'width')).toBe(32);
    expect(px(STEP, 'height')).toBe(32);
    expect(block(STEP)).toContain('border-radius: var(--blok-radius-pill)');
    expect(block(`${STEP}:disabled`)).toContain('opacity: 0.35');
  });
});

describe('video speed wire', () => {
  const WIRE = '[data-blok-tool="video"] .blok-video-controls__speed-wire';

  it('keeps the 240 × 62 shape the drawing and the presets are measured in', () => {
    expect(block(WIRE)).toContain('aspect-ratio: 240 / 62');
  });

  it('takes its ink from the player accent, not a colour of its own', () => {
    expect(block(WIRE)).toContain('color: var(--blok-video-accent)');
    ['wire-lit', 'wire-dim', 'wire-glow', 'wire-ghost', 'wire-peg', 'wire-bead'].forEach((part) => {
      expect(block(`[data-blok-tool="video"] .blok-video-controls__${part}`)).not.toMatch(/#[0-9a-f]{3,6}|rgb/i);
    });
  });

  it('rings the bead only when the range was not focused by a pointer press', () => {
    expect(css).toMatch(/\.blok-video-controls__speed-wire:not\(\[data-pointer-focus\]\) \.blok-video-controls__speed-slider:focus-visible ~ \.blok-video-controls__speed-wire-art \.blok-video-controls__wire-bead\s*\{/);
  });

  it('has no ripple and no pointer marker', () => {
    expect(css).not.toMatch(/wire-(ripple|marker|tether)/);
  });
});

describe('video settings card panes', () => {
  it('slides the two panes in opposite directions, mirrored in RTL', () => {
    // The same selectors also sit in a shared rule above, so match the rule by its body.
    expect(css).toMatch(/\[data-pane="main"\] \[data-role="menu-speed"\]\s*\{\s*transform: translateX\(calc\(28% \* var\(--_blok-inline-sign, 1\)\)\);/);
    expect(css).toMatch(/\[data-pane="speed"\] \[data-role="menu-main"\]\s*\{\s*transform: translateX\(calc\(-28% \* var\(--_blok-inline-sign, 1\)\)\);/);
  });

  it('keeps the card at 264px', () => {
    expect(px('[data-blok-tool="video"] .blok-video-controls__menu', 'width')).toBe(264);
  });
});
