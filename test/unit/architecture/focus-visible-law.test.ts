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
 * Every `:focus` / `focus:` occurrence under `src/` and `packages/<name>/src` must
 * therefore either be `:focus-visible` / `:focus-within`, or be listed in
 * EXEMPT_FOCUS_SELECTORS with a reason.
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
const SCAN_ROOTS = [ 'src', 'packages' ];
const SCAN_EXTENSIONS = [ '.css', '.ts', '.tsx', '.vue' ];
const SKIP_DIRECTORIES = new Set([ 'node_modules', 'dist', 'build' ]);

/**
 * Matches the `:focus` pseudo-class and the Tailwind `focus:` variant, while
 * letting `:focus-visible` and `:focus-within` through.
 */
const FOCUS_PATTERN = /(?<![\w-])focus:|:focus(?![\w-])/g;

/** Characters that end a CSS selector or a Tailwind class token. */
const TOKEN_DELIMITERS = new Set([ ' ', '\t', '\n', ',', '{', '}', "'", '"', '`' ]);

interface FocusExemption {
  /** Repo-relative file the exemption applies to. */
  file: string;
  /** Substring the flagged selector/class token must contain. */
  match: string;
  /** Why this occurrence is allowed to react to a non-keyboard focus. */
  reason: string;
}

const EXEMPT_FOCUS_SELECTORS: FocusExemption[] = [
  {
    file: 'src/styles/preflight.css',
    match: ':focus:not(:focus-visible)',
    reason: 'The rule that ENFORCES the law — it strips the outline from a pointer-driven focus.',
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
 * Finds every focus-state occurrence the law cares about.
 * @returns occurrences across the scanned roots
 */
const findFocusOccurrences = (): FocusOccurrence[] => {
  const files = SCAN_ROOTS.flatMap(root => collectFiles(root));

  return files.flatMap((file) => {
    const source = readFileSync(join(REPO_ROOT, file), 'utf-8');
    const found: FocusOccurrence[] = [];

    for (const match of source.matchAll(FOCUS_PATTERN)) {
      const token = tokenAround(source, match.index);

      /**
       * `focus: this.focus` — an object key in prose or code, not a selector.
       * The token stops at the space, leaving the bare variant behind.
       */
      if (token === 'focus:') {
        continue;
      }

      found.push({
        file,
        line: source.slice(0, match.index).split('\n').length,
        token,
      });
    }

    return found;
  });
};

describe('Focus-Visible Law', () => {
  it('styles focus state only through :focus-visible, outside text-entry fields', () => {
    const violations = findFocusOccurrences()
      .filter(occurrence => !EXEMPT_FOCUS_SELECTORS.some(
        exemption => occurrence.file === exemption.file && occurrence.token.includes(exemption.match)
      ))
      .map(occurrence => `${occurrence.file}:${occurrence.line} — ${occurrence.token}`);

    expect(violations).toEqual([]);
  });

  it('exempts nothing that no longer exists', () => {
    const occurrences = findFocusOccurrences();
    const unused = EXEMPT_FOCUS_SELECTORS
      .filter(exemption => !occurrences.some(
        occurrence => occurrence.file === exemption.file && occurrence.token.includes(exemption.match)
      ))
      .map(exemption => `${exemption.file} — ${exemption.match}`);

    expect(unused).toEqual([]);
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
