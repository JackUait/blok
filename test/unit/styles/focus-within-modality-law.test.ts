/**
 * Focus indicators belong to the keyboard, never to a mouse click.
 *
 * `:focus-within` matches plain `:focus`, so it also matches after a pointer
 * click on any focusable node in the subtree — and the painted state survives
 * the pointer leaving, because the click left focus behind. Wherever the
 * subtree is buttons rather than a text field, the rule must key off
 * `:has(:focus-visible)` (the browser's own keyboard-modality heuristic) or off
 * the text field itself.
 *
 * Text-entry nodes (input, textarea, contenteditable) are the exception: they
 * legitimately show a focused state after a click, because a click into them
 * starts text entry.
 */
import { describe, expect, it } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '');

const css = stripComments(readMainCss());

/**
 * The only `:focus-within` selectors allowed to survive, each with the reason
 * the pointer case is either impossible or harmless there.
 */
const ALLOWED_FOCUS_WITHIN = [
  {
    // Wrapper holds exactly one <input type="search"> — the text-entry exception.
    selector: '&:focus-within',
    reason: 'popover-animation.css search wrapper wraps a single text input',
  },
  {
    // Scrollbar affordance only. The body is the direct parent of ~1870 emoji
    // buttons and `applySkinToneToGrid` rewrites glyphs one at a time, so a
    // `:has()` here would re-anchor the invalidation storm that
    // emoji-picker-has-invalidation.test.ts exists to prevent.
    selector: '[data-emoji-picker-body]:is(:hover, :focus-within)',
    reason: 'emoji scrollbar colour; :has() on this subtree is a known perf cliff',
  },
  {
    selector: '[data-emoji-picker-body]:focus-within::-webkit-scrollbar-thumb',
    reason: 'emoji scrollbar colour; :has() on this subtree is a known perf cliff',
  },
];

/** Split a selector list on its top-level commas, ignoring those inside `:is(…)`. */
function splitSelectorList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const char of list) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);

  return parts;
}

/** Every `:focus-within` selector still present in the flattened stylesheet. */
function focusWithinSelectors(): string[] {
  return [...css.matchAll(/(?:^|[};])\s*([^{};@]*:focus-within[^{};@]*)\{/gm)]
    .flatMap(match => splitSelectorList(match[1]))
    .map(part => part.trim())
    .filter(part => part.includes(':focus-within'));
}

describe('focus-within modality law', () => {
  it('leaves no :focus-within outside the documented allowlist', () => {
    const allowed = new Set(ALLOWED_FOCUS_WITHIN.map(entry => entry.selector));
    const unexpected = focusWithinSelectors().filter(selector => !allowed.has(selector));

    expect(unexpected).toEqual([]);
  });

  it('reveals link-card actions only for keyboard focus', () => {
    expect(css).toContain('.blok-embed-linkcard:has(:focus-visible) .blok-embed-linkcard__actions');
  });

  it('reveals database card actions only for keyboard focus', () => {
    expect(css).toContain('[data-blok-database-card-actions]:has(:focus-visible)');
  });

  it('keeps the video volume slider keyboard-reachable without a wrapper-wide rule', () => {
    expect(css).toContain('.blok-video-controls__volume:focus-visible');
    expect(css).not.toContain('.blok-video-controls__volume-wrap:focus-within');
  });

  it('gives audio a :focus-visible counterpart in place of the wrapper rule', () => {
    expect(css).toContain('.blok-audio-controls__volume:focus-visible');
    expect(css).not.toContain('.blok-audio-controls__volume-wrap:focus-within');
  });

  it('reveals the video title bar and control bar only for keyboard focus', () => {
    expect(css).toContain('.blok-video-controls:has(:focus-visible) .blok-video-controls__title');
    expect(css).toContain('.blok-video-controls:has(:focus-visible) .blok-video-controls__bar');
  });

  it('drives the embed URL bar accent from the input, not the submit button', () => {
    expect(css).toContain('.blok-embed-empty__bar:has(input:focus)');
    expect(css).toContain('.blok-media-empty__embed-bar:has(input:focus)');
  });

  it('drops rules whose subtree holds nothing focusable', () => {
    // Crop handles are <span> with no tabindex; `.blok-media-empty__search` is
    // rendered nowhere in src/.
    expect(css).not.toContain('.blok-image-crop-editor__rect:focus-within');
    expect(css).not.toContain('.blok-media-empty__search:focus-within');
  });
});
