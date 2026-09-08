/**
 * The emoji picker root may not anchor a `:has()` rule.
 *
 * Blink flags an element that anchors `:has()` as "affected by :has()". Every
 * childList mutation anywhere below it then schedules a subtree invalidation
 * with `allDescendantsMightBeInvalid`, so the next forced style flush recalcs
 * the WHOLE subtree. The picker root holds ~1870 emoji buttons (~8300 nodes),
 * and `applySkinToneToGrid` rewrites one glyph's text at a time, so a single
 * `[data-blok-emoji-picker]:has(...)` rule turned a skin-tone switch into 305
 * full recalcs: 7352 ms in Chromium, against 12.7 ms without the rule.
 *
 * State the picker's own script already knows must be published as an
 * attribute on the root, never re-derived by the selector engine.
 */
import { describe, expect, it } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();

/** Selectors of every rule in the flattened stylesheet, comments stripped. */
function selectors(): string[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

  return [...bare.matchAll(/(^|[};])\s*([^{};@]+?)\s*\{/gm)].map(match => match[2].trim());
}

describe('emoji picker :has() invalidation', () => {
  it('never anchors a :has() rule on the picker root', () => {
    const anchored = selectors().filter(selector => /\[data-blok-emoji-picker\][^\s>+~]*:has\(/.test(selector));

    expect(anchored).toEqual([]);
  });

  it('drives the nav-less layout from a root attribute instead of :has()', () => {
    expect(css).toContain('[data-blok-emoji-picker][data-emoji-picker-navless] [data-emoji-picker-body]');
    expect(css).toContain('[data-blok-emoji-picker][data-emoji-picker-navless] [data-emoji-picker-footer]');
  });
});
