/**
 * Static analysis of src/styles/image.css guaranteeing the image block's
 * controls use discrete size tiers instead of fluid cqw scaling.
 *
 * Interactive controls (toolbar buttons, align pill, resize handles) must
 * render at a fixed comfortable size in every tier — what adapts per tier is
 * how many controls show inline (data-tier="full" | "medium" | "compact" set
 * by updateOverlayTier in src/tools/image/ui.ts). Only display text (caption,
 * Alt badge) may step down once, via an @container query at the same medium
 * breakpoint.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/image.css'), 'utf-8');

const findRuleBody = (selector: string): string | null => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|,\\s*|\\s)${escaped}\\s*\\{([^}]*)\\}`, 'm');
  const match = css.match(pattern);

  return match === null ? null : match[1];
};

describe('Image control size tiers (src/styles/image.css)', () => {
  it('never sizes interactive controls with fluid cqw units', () => {
    expect(css).not.toContain('cqw');
  });

  it('toolbar buttons are fixed at 28px squares', () => {
    const body = findRuleBody('[data-blok-tool="image"] .blok-image-toolbar button');

    expect(body).not.toBeNull();
    expect(body).toContain('width: 28px');
    expect(body).toContain('height: 28px');
  });

  it('toolbar icons are fixed at 14px', () => {
    const body = findRuleBody('[data-blok-tool="image"] .blok-image-toolbar button svg');

    expect(body).not.toBeNull();
    expect(body).toContain('width: 14px');
    expect(body).toContain('height: 14px');
  });

  it('handles are 3x32 bars 8px inside the picture, in the overlay ink', () => {
    const body = findRuleBody('[data-blok-tool="image"] [data-role="resize-handle"]');

    expect(body).not.toBeNull();
    expect(body).toContain('width: 3px');
    expect(body).toContain('height: 32px');
    // Inverted against the cards: a paper area gets dark ink, a graphite one light ink.
    expect(body).toContain('background: var(--blok-overlay-fg)');
    expect(findRuleBody('[data-blok-tool="image"] [data-role="resize-handle"][data-edge="left"]')).toContain('left: var(--blok-space-2)');
    expect(findRuleBody('[data-blok-tool="image"] [data-role="resize-handle"][data-edge="right"]')).toContain('right: var(--blok-space-2)');
  });

  it('a hidden handle keeps its box, so tone-sampler can read what is under it', () => {
    const body = findRuleBody('[data-blok-tool="image"] [data-role="resize-handle"]');

    expect(body).toContain('transform: translateY(-50%)');
    expect(css).not.toMatch(/\[data-role="resize-handle"\][^{]*\{[^}]*scale\(/);
  });

  it('the hit area is 16px wide', () => {
    expect(findRuleBody('[data-blok-tool="image"] [data-role="resize-handle"]::before')).toContain('inset: -4px -6.5px');
  });

  it('a table cell needs no handle override: the handles are already inside', () => {
    expect(css).not.toMatch(/\[data-blok-table-cell\][^{]*\[data-role="resize-handle"\]/);
  });

  it('caption steps between exactly two fixed sizes at the medium breakpoint', () => {
    const body = findRuleBody('[data-blok-tool="image"] .blok-image-caption');

    expect(body).not.toBeNull();
    /**
     * The two steps are the FALLBACKS of the host font-size hook
     * (`config.style.fontSize.image.caption`): configuring it pins one size at
     * every width, leaving it unset keeps the historical 12px/13.5px step.
     */
    expect(body).toContain('font-size: var(--blok-image-caption-font-size, 12px)');
    expect(css).toMatch(/@container\s*\(min-width:\s*360px\)/);
  });
});

const mainCss = readFileSync(resolve(__dirname, '../../../src/styles/main.css'), 'utf-8');

describe('image toolbar (one bar)', () => {
  it('the toolbar itself is the card; groups have none', () => {
    expect(mainCss).toMatch(/\.blok-image-toolbar \{[^}]*background: var\(--blok-overlay-surface\)/);
    expect(findRuleBody('[data-blok-tool="image"] .blok-image-toolbar__island')).not.toContain('background');
    expect(css).not.toContain('.blok-image-toolbar::after');
    expect(css).not.toContain('.blok-image-toolbar__island::after');
    expect(css).not.toContain('blok-image-islands');
  });

  it('sits 8px inside the top of the picture', () => {
    expect(mainCss).toMatch(/\.blok-image-toolbar \{[^}]*top: 8px/);
    expect(mainCss).not.toMatch(/\.blok-image-toolbar \{[^}]*bottom:/);
  });

  it('fades in by opacity only, so a placed tooltip never ends up off its button', () => {
    expect(mainCss).toMatch(/\.blok-image-toolbar \{[^}]*transition: opacity 120ms ease/);
    const animated = (css.match(/\.blok-image-toolbar[^{]*\{[^}]*animation:[^;]*/g) ?? [])
      .filter((rule) => !rule.includes('animation: none'));

    expect(animated).toHaveLength(0);
  });

  it('a divider opens a group only after the first visible one', () => {
    expect(css).toContain('.blok-image-toolbar:not([data-tier="medium"]):not([data-compact="true"]) [data-island="edit"]::before');
    expect(css).toContain('.blok-image-toolbar:not([data-compact="true"]) [data-island="view"]::before');
    expect(css).not.toMatch(/\[data-island\] \+ \[data-island\]/);
  });

  it('medium tier shows only the edit group and more', () => {
    expect(css).toMatch(/\.blok-image-toolbar\[data-tier="medium"\] \[data-island="layout"\] \{\s*display: none/);
    expect(css).toMatch(/\.blok-image-toolbar\[data-tier="medium"\] \[data-island="view"\] > :not\(\[data-action="more"\]\)/);
  });

  it('compact tier keeps only the more button', () => {
    expect(css).toMatch(/\.blok-image-toolbar\[data-compact="true"\] \[data-island="layout"\],\s*\[data-blok-tool="image"\] \.blok-image-toolbar\[data-compact="true"\] \[data-island="edit"\]/);
  });

  it('selection is read from the block holder, not the dead data-selected', () => {
    expect(css).toContain('[data-blok-selected="true"] [data-blok-tool="image"] [data-role="image-selection-ring"]');
    expect(css).toContain('[data-blok-selected="true"] [data-blok-tool="image"] [data-role="resize-handle"]');
  });
});

describe('image chrome anchors to the picture, not the whole figure', () => {
  it.each([
    '[data-blok-tool="image"] [data-role="image-selection-ring"]',
    '[data-blok-tool="image"] [data-role="resize-handle"]',
    '[data-blok-tool="image"] .blok-image-alt-pill',
    '[data-blok-tool="image"] [data-role="image-resize-readout"]',
  ])('%s is placed from --blok-image-media-height', (selector) => {
    expect(findRuleBody(selector)).toContain('var(--blok-image-media-height');
  });
});

describe('alt hint and pill width', () => {
  it('wraps the hint to a readable width', () => {
    const body = findRuleBody('.blok-image-alt-hint');

    expect(body).toContain('max-width: 260px');
    expect(body).toContain('white-space: normal');
  });

  it('caps the alt tag so a long description does not cover the picture', () => {
    expect(findRuleBody('[data-blok-tool="image"] .blok-image-alt-pill')).toContain('max-width: min(calc(100% - 16px), 240px)');
  });

  it('the alt tag is painted from the overlay tokens, so data-tone repaints it', () => {
    const body = findRuleBody('[data-blok-tool="image"] .blok-image-alt-pill');

    expect(body).toContain('background: var(--blok-overlay-surface)');
    expect(body).toContain('color: var(--blok-overlay-fg-strong)');
    expect(findRuleBody('[data-blok-tool="image"] .blok-image-alt-pill__text')).toContain('color: var(--blok-overlay-fg)');
    expect(findRuleBody('[data-blok-tool="image"] .blok-image-alt-pill__label')).toContain('text-transform: uppercase');
    expect(css).not.toContain('blok-image-alt-pill__mark');
    expect(css).not.toContain('blok-image-alt-pill__help');
  });
});

describe('image chrome inside a table cell (the cell clips overflow)', () => {
  it('keeps the ring inside the figure', () => {
    expect(css).toMatch(/\[data-blok-table-cell\] \[data-blok-tool="image"\] \[data-role="image-selection-ring"\][^{]*\{[^}]*left: 0/);
  });
});

describe('alt stays reachable on small images', () => {
  it('does not hide the alt pill in the compact tier (the settings menu has no alt entry)', () => {
    expect(css).not.toContain('[data-compact="true"] ~ .blok-image-alt-pill');
  });
});

describe('snap guides', () => {
  it('show only while resizing, and the hit guide is stronger', () => {
    expect(findRuleBody('[data-blok-tool="image"] [data-role="image-snap-guides"]')).toContain('opacity: 0');
    expect(findRuleBody('[data-blok-tool="image"][data-resizing="true"] [data-role="image-snap-guides"]')).toContain('opacity: 1');
    expect(findRuleBody('[data-blok-tool="image"] [data-role="image-snap-guides"] > [data-hit]')).toContain('var(--blok-image-frame-ring-strong)');
  });
});

