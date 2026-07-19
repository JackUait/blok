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

  it('resize handles are fixed at 6px wide', () => {
    const body = findRuleBody('[data-blok-tool="image"] [data-role="resize-handle"]');

    expect(body).not.toBeNull();
    expect(body).toContain('width: 6px');
  });

  it('medium tier hides caption-toggle, replace and download (and nothing else)', () => {
    for (const action of ['caption-toggle', 'replace', 'download']) {
      expect(css).toMatch(
        new RegExp(`\\.blok-image-toolbar\\[data-tier="medium"\\][^{]*\\[data-action="${action}"\\]`)
      );
    }
    for (const action of ['crop', 'fullscreen', 'more']) {
      expect(css).not.toMatch(
        new RegExp(`\\.blok-image-toolbar\\[data-tier="medium"\\][^{]*\\[data-action="${action}"\\]`)
      );
    }
  });

  it('compact tier still collapses to just the "more" button', () => {
    expect(css).toContain('.blok-image-toolbar[data-compact="true"] > :not([data-action="more"])');
  });

  it('caption steps between exactly two fixed sizes at the medium breakpoint', () => {
    const body = findRuleBody('[data-blok-tool="image"] .blok-image-caption');

    expect(body).not.toBeNull();
    expect(body).toContain('font-size: 12px');
    expect(css).toMatch(/@container\s*\(min-width:\s*360px\)/);
  });
});
