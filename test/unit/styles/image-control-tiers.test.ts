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

  it('align-pill buttons are fixed at 26px wide', () => {
    const body = findRuleBody('[data-blok-tool="image"] .blok-image-toolbar__pill button');

    expect(body).not.toBeNull();
    expect(body).toContain('width: 26px');
  });

  it('handles are 9px dots, not 6px bars', () => {
    const body = findRuleBody('[data-blok-tool="image"] [data-role="resize-handle"]');

    expect(body).not.toBeNull();
    expect(body).toContain('width: 9px');
    expect(body).toContain('height: 9px');
    expect(body).toContain('border-radius: 50%');
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

describe('image islands (frame and islands design)', () => {
  it('the toolbar is a transparent row; each island is the card', () => {
    const island = findRuleBody('[data-blok-tool="image"] .blok-image-toolbar__island');

    expect(island).toContain('background: var(--blok-overlay-surface)');
    expect(mainCss).toMatch(/\.blok-image-toolbar \{[^}]*background: transparent/);
  });

  it('floats 20px above the figure, or 10px inside when told to', () => {
    expect(mainCss).toMatch(/\.blok-image-toolbar \{[^}]*bottom: calc\(100% \+ 20px\)/);
    expect(findRuleBody('[data-blok-tool="image"] .blok-image-toolbar[data-islands-placement="inside"]')).toContain('top: 10px');
  });

  it('medium tier shows only the edit island and more', () => {
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

  it('one show rule per element, so hover then select does not replay the split', () => {
    const island = css.match(/[^}]*\.blok-image-toolbar__island \{[^}]*animation:[^}]*\}/g) ?? [];
    const row = (css.match(/[^}]*\.blok-image-toolbar \{[^}]*animation:[^}]*\}/g) ?? [])
      .filter((rule) => !rule.includes('animation: none'));

    expect(island).toHaveLength(1);
    expect(island[0]).toContain('blok-image-islands-split');
    expect(row).toHaveLength(1);
    expect(row[0]).toContain('blok-image-islands-rise');
  });

  it('never animates gap, so buttons do not slide under a placed tooltip', () => {
    expect(css).not.toMatch(/@keyframes blok-image-islands[^{]*\{[^@]*\bgap:/);
  });

  it('reduced motion switches the split off', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*\.blok-image-toolbar__island[\s\S]*animation: none/);
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

  it('caps the alt pill so a long description does not cover the picture', () => {
    expect(findRuleBody('[data-blok-tool="image"] .blok-image-alt-pill')).toContain('max-width: min(calc(100% - 20px), 240px)');
  });
});

describe('image chrome inside a table cell (the cell clips overflow)', () => {
  it('keeps the ring and the dots inside the figure', () => {
    expect(css).toMatch(/\[data-blok-table-cell\] \[data-blok-tool="image"\] \[data-role="image-selection-ring"\][^{]*\{[^}]*left: 0/);
    expect(css).toMatch(/\[data-blok-table-cell\] \[data-blok-tool="image"\] \[data-role="resize-handle"\]\[data-edge="left"\]\s*\{\s*left: var\(--blok-space-1\)/);
    expect(css).toMatch(/\[data-blok-table-cell\] \[data-blok-tool="image"\] \[data-role="resize-handle"\]\[data-edge="right"\]\s*\{\s*right: var\(--blok-space-1\)/);
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

describe('hover bridge above the picture', () => {
  it('spans the 20px gap below islands that float above', () => {
    const body = findRuleBody('[data-blok-tool="image"] .blok-image-toolbar[data-islands-placement="above"]::after');

    expect(body).toContain('top: 100%');
    expect(body).toContain('height: 20px');
  });
});
