/**
 * Architectural enforcement: the Focus-Visible Law.
 *
 * A focus indicator is an affordance for someone who cannot see the pointer.
 * Blok therefore shows focus state ONLY for keyboard navigation. The single
 * exception is a text-entry field (`input`, `textarea`, `[contenteditable]`),
 * which may look active however focus arrived, because the field itself is the
 * thing the user is now typing into.
 *
 * The browser already tracks that distinction — it is what `:focus-visible`
 * means — so styling plain `:focus` (Tailwind `focus:`) re-opens the door the
 * platform closed. `src/styles/preflight.css` neutralises the OUTLINE of a
 * pointer-driven focus, but nothing there can undo a `box-shadow`, `ring`,
 * `background` or `border` painted by a component's own `:focus` rule.
 *
 * Every pointer-reachable focus state anywhere in SCAN_ROOTS / SCAN_FILES must
 * therefore be `:focus-visible`, or be listed in EXEMPT_FOCUS_SELECTORS with a
 * reason. The scan reaches the published `view.css`, the browser extension and
 * the Storybook shell, not only `src/`. FOCUS_PATTERN lists exactly which
 * spellings count; the raw `:focus-within` pseudo-class is the one focus state
 * this guard leaves alone, because focus-within-modality-law.test.ts owns it.
 *
 * Blok's own focus cursor on popover items (`data-blok-focused`) is invisible
 * to `:focus-visible` — the items are never really focused — so the second
 * case pins the JS half: the cursor is placed only when the last gesture came
 * from the keyboard.
 *
 * If this test fails on your change: switch the selector to `:focus-visible`.
 * Exempt it only when the styled element is a text-entry field, or when the
 * `:focus` rule paints something that is not a focus indicator at all.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');
/**
 * `docs/src` and the root `index.html` ship to real readers and users too, and
 * both grew violations while this guard could only see `src` and `packages`.
 * `override-extension` and `.storybook` carry their own CSS/HTML that no other
 * guard reads.
 */
const SCAN_ROOTS = [ 'src', 'packages', 'docs/src', 'override-extension', '.storybook' ];
/** `view.css` is a PUBLISHED export (package.json `files` + `exports`), generated from main.css. */
const SCAN_FILES = [ 'index.html', 'view.css' ];
/**
 * A ring painted from a `.mjs` / `.js` file is the same ring. `src` genuinely
 * holds `.mjs` (`components/migration/legacy-grammar.mjs`) and every package
 * has a `vite.config.mjs`.
 */
const SCAN_EXTENSIONS = [ '.css', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.html' ];
const SKIP_DIRECTORIES = new Set([ 'node_modules', 'dist', 'build' ]);
/**
 * Repo-relative directories holding BUILT output of code this guard already
 * scans at source. `override-extension/payload` alone is 137 MB of minified
 * Blok bundles; reading it would be slow and would flag src twice.
 */
const SKIP_PATHS = new Set([ 'override-extension/payload', 'packages/server/dotnet/Blok.Server/Generated' ]);
/** A spec asserting the law is not a surface that can paint a ring. */
const TEST_FILE_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/;

/**
 * Matches every focus state that can react to a POINTER gesture. Compiled with
 * this repo's Tailwind 4.3.3 to record what each variant actually becomes:
 *
 * - `:focus` and `focus:` — the plain pseudo-class and variant.
 * - `group-focus:` compiles to `:is(:where(.group):focus *)`, `peer-focus:` to
 *   `:is(:where(.peer):focus ~ *)`, `has-focus:` to `:has(:focus)` and
 *   `group-has-focus:` to `:is(:where(.group):has(:focus) *)`. Every one is
 *   built on PLAIN `:focus`, and every one usually carries a `ring`, which is
 *   a box-shadow the outline suppression in `preflight.css` cannot reach.
 * - `focus-within:` compiles to `:focus-within`, which lights a wrapper up
 *   when anything inside it takes focus, a mouse-clicked button included.
 *   Only the Tailwind VARIANT is matched here: the `:` in that branch's
 *   lookbehind excludes the raw CSS pseudo-class, which is policed by
 *   `test/unit/styles/focus-within-modality-law.test.ts` instead. That guard
 *   reads the main.css graph and cannot see a class string, so the two halves
 *   are complementary — do not merge them.
 * - `:-moz-focusring` — Firefox's own pseudo-class, invisible to the
 *   `:focus-visible` suppression. Measured in Firefox 153: it tracks
 *   `:focus-visible` exactly, so it is keyboard-only, but a new one still
 *   deserves a look.
 *
 * `:focus-visible` and every `*-focus-visible:` variant are let through: those
 * compiled to `:focus-visible` selectors, which the browser already restricts
 * to a keyboard gesture.
 */
const FOCUS_PATTERN = /(?<![\w-])(?:(?:group|peer)-(?:has-)?|has-)focus(?:-within)?:|(?<![\w-:])focus-within:|(?<![\w-])focus:|:focus(?![\w-])|:-moz-focusring/g;

/** A variant with no utility after it — `focus: active` is an object key, not a class. */
const BARE_VARIANT_PATTERN = /^(?:(?:group|peer)-(?:has-)?|has-)?focus(?:-within)?:$/;

/** Characters that end a CSS selector or a Tailwind class token. */
const TOKEN_DELIMITERS = new Set([ ' ', '\t', '\n', ',', '{', '}', "'", '"', '`' ]);

interface FocusExemption {
  /** Repo-relative file the exemption applies to. */
  file: string;
  /**
   * Substring the flagged TOKEN must contain. Scoped to the token, never to the
   * source line: an exemption for one class must not silently swallow a new
   * `focus:` variant appended beside it.
   */
  match?: string;
  /**
   * Exact tokens covered, for a single element whose class string spreads the
   * variant across many tokens (the docs skip link). Listing them keeps the
   * blast radius explicit — an unlisted token on the same line stays a
   * violation, and a listed token that disappears is reported as dead.
   */
  tokens?: string[];
  /** Why this occurrence is allowed to react to a non-keyboard focus. */
  reason: string;
}

const EXEMPT_FOCUS_SELECTORS: FocusExemption[] = [
  {
    file: 'index.html',
    match: '#locale-search:focus',
    reason: 'Text input: the language picker search field may look active however it was focused.',
  },
  {
    file: 'docs/src/components/layout/Nav.tsx',
    tokens: [
      'focus:not-sr-only',
      'focus:fixed',
      'focus:left-4',
      'focus:top-4',
      'focus:z-[100]',
      'focus:rounded-full',
      'focus:bg-primary',
      'focus:px-4',
      'focus:py-2',
      'focus:text-sm',
      'focus:font-semibold',
      'focus:text-white',
    ],
    reason: 'Skip link: sr-only at rest, so no pointer can reach it. The `focus:` variants REVEAL and position it for Tab; the indicator on top is already focus-visible:ring-2. Listed one by one so a ring or shadow added to the same class string is still caught.',
  },
  {
    file: 'src/styles/preflight.css',
    match: ':focus:not(:focus-visible)',
    reason: 'The rule that ENFORCES the law — it strips the outline from a pointer-driven focus.',
  },
  {
    file: 'src/styles/preflight.css',
    match: ':-moz-focusring',
    reason: 'Firefox\'s own modality-aware pseudo-class, inherited verbatim from Tailwind Preflight. Measured in Firefox 153: it tracked :focus-visible exactly — false on a mouse-clicked button, true on Tab and on a clicked text input. It restores a ring only where the browser would already draw one.',
  },
  {
    file: 'view.css',
    match: ':-moz-focusring',
    reason: 'Generated from main.css: the same Preflight rule as src/styles/preflight.css. Listed so the published stylesheet is scanned rather than trusted.',
  },
  {
    file: 'src/components/utils/popover/components/search-input/search-input.const.ts',
    match: 'focus-within:border-search-input-focus-border',
    reason: 'Text input: the wrapper it sits on has exactly one child, the `type="search"` input (search-input.ts appends only `this.input`), so focus-within here can only ever mean that field is focused.',
  },
  {
    file: 'src/styles/media-empty.css',
    match: '.blok-media-empty__input',
    reason: 'Text input: the URL field may look active however it was focused.',
  },
  {
    file: 'src/styles/media-empty.css',
    match: '[aria-invalid="true"]',
    reason: 'Text input: the invalid-value border belongs to the field, not to keyboard navigation.',
  },
  {
    file: 'src/styles/embed.css',
    match: ':has(input:focus)',
    reason: 'Text input: the URL bar accent tracks the field, not the submit button beside it.',
  },
  {
    file: 'src/styles/media-empty.css',
    match: ':has(input:focus)',
    reason: 'Text input: the URL bar accent tracks the field, not the submit button beside it.',
  },
  {
    file: 'src/styles/image.css',
    match: '.blok-image-caption:focus',
    reason: 'The caption is a contenteditable; typing in it reveals the alt-text button.',
  },
  {
    file: 'src/components/utils/placeholder.ts',
    match: ':focus:before:',
    reason: 'Renders placeholder TEXT inside a contenteditable — content, not a focus indicator.',
  },
  {
    file: 'src/components/utils/placeholder.ts',
    match: ':focus]:before:',
    reason: 'Renders placeholder TEXT inside a contenteditable — content, not a focus indicator.',
  },
  {
    file: 'src/components/modules/ui.ts',
    match: ':focus]:before:opacity-0',
    reason: 'Hides that same contenteditable placeholder while the toolbox is open.',
  },
  {
    file: 'src/tools/callout/emoji-picker/index.ts',
    match: 'focus:ring',
    reason: 'Text input: the emoji picker search field.',
  },
  {
    file: 'src/styles/emoji-picker.css',
    match: 'input:focus',
    reason: 'Text input: the emoji picker search field may look active however it was focused.',
  },
  {
    file: 'src/components/inline-tools/inline-tool-link.ts',
    match: 'focus:bg-popover-bg',
    reason: 'Text input: the link URL field.',
  },
  {
    file: 'src/components/inline-tools/inline-tool-link.ts',
    match: 'focus:border-search-input-focus-border',
    reason: 'Text input: the link URL field.',
  },
  {
    file: 'src/components/inline-tools/inline-tool-link.ts',
    match: 'focus:aria-invalid:border-',
    reason: 'Text input: the link URL field in its invalid state.',
  },
  {
    file: 'src/components/utils/notifier/draw.ts',
    match: 'focus:border-white/20',
    reason: 'Text input: the notifier prompt field.',
  },
];

/**
 * Collects every scannable file below a repo-relative directory.
 * @param dir - repo-relative directory to walk
 * @returns repo-relative file paths
 */
const collectFiles = (dir: string): string[] => {
  const absolute = join(REPO_ROOT, dir);

  let entries: string[];

  try {
    entries = readdirSync(absolute);
  } catch {
    return [];
  }

  return entries.flatMap((entry) => {
    if (SKIP_DIRECTORIES.has(entry)) {
      return [];
    }

    const child = join(dir, entry);

    if (SKIP_PATHS.has(child)) {
      return [];
    }

    if (statSync(join(REPO_ROOT, child)).isDirectory()) {
      return collectFiles(child);
    }

    return SCAN_EXTENSIONS.some(extension => entry.endsWith(extension)) ? [ child ] : [];
  });
};

/**
 * Expands a match position out to the whole selector / class token around it.
 * @param source - full file text
 * @param index - offset of the match inside the text
 * @returns the token containing the match
 */
const tokenAround = (source: string, index: number): string => {
  let start = index;
  let end = index;

  /**
   * Quotes delimit a class string but also live INSIDE an attribute selector
   * (`[aria-invalid="true"]:focus`), so a quote only ends the token while no
   * bracket is open around it.
   */
  let depth = 0;

  while (start > 0) {
    const character = source[start - 1];

    if (character === ']') {
      depth += 1;
    } else if (character === '[') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && TOKEN_DELIMITERS.has(character)) {
      break;
    }

    start -= 1;
  }

  depth = 0;

  while (end < source.length) {
    const character = source[end];

    if (character === '[') {
      depth += 1;
    } else if (character === ']') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && TOKEN_DELIMITERS.has(character)) {
      break;
    }

    end += 1;
  }

  return source.slice(start, end);
};

interface FocusOccurrence {
  file: string;
  line: number;
  token: string;
}

/**
 * Decides whether an exemption entry covers a flagged occurrence.
 * Matching is TOKEN-scoped in both forms, so an exemption can never absolve a
 * neighbouring class that merely shares its source line.
 * @param exemption - entry to test
 * @param occurrence - flagged occurrence
 * @returns whether the entry covers the occurrence
 */
const covers = (exemption: FocusExemption, occurrence: FocusOccurrence): boolean => {
  if (occurrence.file !== exemption.file) {
    return false;
  }

  if (exemption.tokens !== undefined) {
    return exemption.tokens.includes(occurrence.token);
  }

  return exemption.match !== undefined && occurrence.token.includes(exemption.match);
};

/**
 * Finds every focus-state occurrence the law cares about.
 * @returns occurrences across the scanned roots
 */
const findFocusOccurrences = (): FocusOccurrence[] => {
  const files = [ ...SCAN_ROOTS.flatMap(root => collectFiles(root)), ...SCAN_FILES ]
    .filter(file => !TEST_FILE_PATTERN.test(file));

  return files.flatMap((file) => {
    const source = readFileSync(join(REPO_ROOT, file), 'utf-8');
    const found: FocusOccurrence[] = [];

    for (const match of source.matchAll(FOCUS_PATTERN)) {
      const token = tokenAround(source, match.index);

      /**
       * `focus: this.focus` — an object key in prose or code, not a selector.
       * The token stops at the space, leaving the bare variant behind.
       */
      if (BARE_VARIANT_PATTERN.test(token)) {
        continue;
      }

      const lines = source.slice(0, match.index).split('\n');

      found.push({
        file,
        line: lines.length,
        token,
      });
    }

    return found;
  });
};

describe('Focus-Visible Law', () => {
  it('styles focus state only through :focus-visible, outside text-entry fields', () => {
    const violations = findFocusOccurrences()
      .filter(occurrence => !EXEMPT_FOCUS_SELECTORS.some(exemption => covers(exemption, occurrence)))
      .map(occurrence => `${occurrence.file}:${occurrence.line} — ${occurrence.token}`);

    expect(violations).toEqual([]);
  });

  it('exempts nothing that no longer exists', () => {
    const occurrences = findFocusOccurrences();
    const unused = EXEMPT_FOCUS_SELECTORS.flatMap((exemption) => {
      /** Each listed token is checked on its own, so one stale entry cannot hide behind its siblings. */
      if (exemption.tokens !== undefined) {
        return exemption.tokens
          .filter(token => !occurrences.some(occurrence => occurrence.file === exemption.file && occurrence.token === token))
          .map(token => `${exemption.file} — ${token}`);
      }

      return occurrences.some(occurrence => covers(exemption, occurrence)) ? [] : [ `${exemption.file} — ${exemption.match}` ];
    });

    expect(unused).toEqual([]);
  });

  it('recognises every composed focus variant, and none of the keyboard-only spellings', () => {
    /** @param source - text to test @returns whether the guard's pattern fires */
    const flags = (source: string): boolean => new RegExp(FOCUS_PATTERN.source).test(source);

    /**
     * Verified against this repo's Tailwind: each of these compiles to a
     * selector built on plain `:focus` (`.group-focus\:ring-2:is(:where(.group):focus *)`),
     * so a `ring` painted through them survives the outline suppression.
     */
    for (const variant of [
      'group-focus:ring-2', 'peer-focus:ring-2', 'has-focus:ring-2', 'focus-within:ring-2',
      'group-has-focus:ring-2', 'peer-focus-within:ring-2', 'group-focus-within:ring-2',
      'focus:ring-2', 'md:focus:ring-2', '.x:focus { }', ':-moz-focusring { }',
    ]) {
      expect(flags(variant), variant).toBe(true);
    }

    /**
     * Keyboard-only by the browser's own heuristic, plus the RAW `:focus-within`
     * pseudo-class, which focus-within-modality-law.test.ts owns.
     */
    for (const allowed of [
      'focus-visible:ring-2', 'group-focus-visible:ring-2', 'peer-focus-visible:ring-2',
      '.x:focus-visible { }', '.x:focus-visible::before { }',
      '.x:focus-within { }', '.x:focus-within::-webkit-scrollbar-thumb { }',
      ':is(:hover, :focus-within)', 'onFocus={handler}', 'element.focus()', 'input.focus();',
    ]) {
      expect(flags(allowed), allowed).toBe(false);
    }
  });

  it('places Blok\'s own popover focus cursor only for keyboard gestures', () => {
    const source = readFileSync(join(REPO_ROOT, 'src/components/utils/popover/popover-desktop.ts'), 'utf-8');

    expect(source).toContain("import { isKeyboardModality } from '../input-modality'");

    const focusInitial = source.slice(source.indexOf('private focusInitialElement('));
    const body = focusInitial.slice(0, focusInitial.indexOf('\n  }\n'));

    expect(body).toContain('isKeyboardModality()');
    expect(body.indexOf('isKeyboardModality()')).toBeLessThan(body.indexOf('focusItem(0'));
  });
});
