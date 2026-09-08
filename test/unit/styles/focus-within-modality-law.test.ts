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
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '');

const css = stripComments(readMainCss());

const REPO_ROOT = resolve(__dirname, '../../..');
const SRC_ROOT = join(REPO_ROOT, 'src');
const MAIN_CSS = join(SRC_ROOT, 'styles/main.css');

/**
 * Stylesheets under `src/` that main.css does NOT import, and which this guard
 * therefore has to open itself. Without an entry here a file is in a blind
 * spot: `focus-visible-law.test.ts` deliberately lets `:focus-within` through
 * (policing it is this file's job), and this file used to read only the
 * flattened main.css graph — so a `:focus-within` rule planted in
 * playground.css was caught by neither guard.
 */
const STANDALONE_CSS_ENTRIES = [
  {
    file: 'src/playground/playground.css',
    reason: 'Dev-page Tailwind entry, loaded by index.html alone — never reachable from main.css.',
  },
];

/** Every local .css file main.css pulls in, transitively. */
function reachableFromMainCss(): Set<string> {
  const seen = new Set<string>();

  const walk = (filePath: string): void => {
    if (seen.has(filePath)) return;
    seen.add(filePath);

    const source = readFileSync(filePath, 'utf-8');
    const baseDir = dirname(filePath);

    for (const [ , spec ] of source.matchAll(/@import\s+['"]([^'"]+)['"]/g)) {
      // Package specifiers (tailwindcss/…) are framework output, not authored source.
      if (!spec.startsWith('.')) continue;
      walk(resolve(baseDir, spec));
    }
  };

  walk(MAIN_CSS);

  return seen;
}

/** Every .css file under src/, whatever imports it. */
function allSrcCssFiles(directory: string = SRC_ROOT): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = join(directory, entry);

    if (statSync(fullPath).isDirectory()) return allSrcCssFiles(fullPath);

    return fullPath.endsWith('.css') ? [ fullPath ] : [];
  });
}

/** Named sources this guard reads: the flattened main.css graph, plus the standalone entries. */
const SCANNED_SOURCES = [
  { label: 'src/styles/main.css (flattened)', source: css },
  ...STANDALONE_CSS_ENTRIES.map(({ file }) => ({
    label: file,
    source: stripComments(readFileSync(join(REPO_ROOT, file), 'utf-8')),
  })),
];

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

/** Every `:focus-within` selector still present in the given stylesheet source. */
function focusWithinSelectors(source: string): string[] {
  return [...source.matchAll(/(?:^|[};])\s*([^{};@]*:focus-within[^{};@]*)\{/gm)]
    .flatMap(match => splitSelectorList(match[1]))
    .map(part => part.trim())
    .filter(part => part.includes(':focus-within'));
}

describe('focus-within modality law', () => {
  it.each(SCANNED_SOURCES)('leaves no :focus-within outside the documented allowlist ($label)', ({ source }) => {
    const allowed = new Set(ALLOWED_FOCUS_WITHIN.map(entry => entry.selector));
    const unexpected = focusWithinSelectors(source).filter(selector => !allowed.has(selector));

    expect(unexpected).toEqual([]);
  });

  it('reads every stylesheet under src/ — nothing sits in the gap between the two focus guards', () => {
    const reachable = reachableFromMainCss();
    const standalone = new Set(STANDALONE_CSS_ENTRIES.map(entry => join(REPO_ROOT, entry.file)));

    const unread = allSrcCssFiles()
      .filter(file => !reachable.has(file) && !standalone.has(file))
      .map(file => relative(REPO_ROOT, file))
      .sort();

    expect(
      unread,
      'this stylesheet is neither imported by main.css nor listed in STANDALONE_CSS_ENTRIES, so no focus guard reads it — add it to that list with a reason'
    ).toEqual([]);
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
