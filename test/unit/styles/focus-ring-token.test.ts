/**
 * Every keyboard focus ring in Blok is one blue, read from `--blok-focus-ring`.
 * A ring painted from any other color (gray ink, white, the UA default) makes
 * focus look like a different state per surface.
 *
 * The popover cursor ring is also keyboard-only: it shows once the user moves
 * the cursor with a navigation key, never on open.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readMainCss } from './helpers/read-main-css';

const REPO_ROOT = resolve(__dirname, '../../..');
const SRC_ROOT = join(REPO_ROOT, 'src');

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '');

const walk = (dir: string, extensions: string[]): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
      return walk(path, extensions);
    }

    return extensions.some(ext => path.endsWith(ext)) ? [ path ] : [];
  });

/** A ring a focus rule paints: a visible outline or a box-shadow. */
const RING_DECLARATION = /(?:^|;|\s)(outline|box-shadow)\s*:\s*([^;]+)/g;
const NO_RING = /^(none|0|0px|none\s*!important)$/;
const FOCUS_SELECTOR = /:focus-visible|\[data-blok-focused/;

/**
 * Focus rules that paint something that is not the ring itself.
 * Text-entry fields show focus with their border, owned by the field tokens.
 */
const EXEMPT_SELECTORS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\.blok-media-empty__input--bare:focus-visible/, reason: 'Clears the field look; paints no ring.' },
];

describe('focus rings read --blok-focus-ring', () => {
  it('defines a blue --blok-focus-ring in every theme', () => {
    const css = readMainCss();
    const values = [ ...css.matchAll(/--blok-focus-ring:\s*([^;]+);/g) ].map(match => match[1].trim());

    expect(values.length).toBeGreaterThanOrEqual(3);
    values.forEach((value) => {
      const hex = value.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
      const rgb = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      const channels = hex
        ? hex.slice(1).map(channel => parseInt(channel, 16))
        : (rgb ?? []).slice(1).map(Number);

      expect(channels, value).toHaveLength(3);
      const [ r, g, b ] = channels;

      expect(b, value).toBeGreaterThan(r + 60);
      expect(b, value).toBeGreaterThan(g);
    });
  });

  it('every CSS focus ring under src uses the token', () => {
    // A surface token that defaults to the shared ring counts as the ring.
    const aliases = [ ...readMainCss().matchAll(/(--blok-[\w-]+):\s*var\(--blok-focus-ring\);/g) ].map(match => match[1]);
    const usesRing = (value: string): boolean =>
      value.includes('var(--blok-focus-ring)') || aliases.some(alias => value.includes(`var(${alias})`));
    // Playground chrome has its own palette outside Blok roots.
    const offenders = walk(SRC_ROOT, [ '.css' ])
      .filter((file) => !file.includes(`${sep}playground${sep}`))
      .flatMap((file) => {
        const source = stripComments(readFileSync(file, 'utf-8'));

        return [ ...source.matchAll(/([^{}]+)\{([^{}]*)\}/g) ].flatMap(([ , selector, body ]) => {
          if (!FOCUS_SELECTOR.test(selector) || EXEMPT_SELECTORS.some(({ pattern }) => pattern.test(selector))) {
            return [];
          }

          return [ ...body.matchAll(RING_DECLARATION) ]
            .filter(([ , , value ]) => !NO_RING.test(value.trim()) && !usesRing(value))
            .map(([ , property, value ]) => `${relative(REPO_ROOT, file)}: ${selector.trim()} { ${property}: ${value.trim()} }`);
        });
      });

    expect(offenders).toEqual([]);
  });

  it('every Tailwind focus ring under src uses the focus-ring color', () => {
    const offenders = walk(SRC_ROOT, [ '.ts' ]).flatMap((file) => {
      const source = readFileSync(file, 'utf-8');

      return [ ...source.matchAll(/focus-visible:(ring|outline)-([\w/[\]().-]+)/g) ]
        .filter(([ , , value ]) => !/^(\d+|offset-\d+|none|hidden|focus-ring)$/.test(value))
        .map(([ match ]) => `${relative(REPO_ROOT, file)}: ${match}`);
    });

    expect(offenders).toEqual([]);
  });

  it('the popover cursor ring waits for keyboard navigation', () => {
    const css = stripComments(readMainCss());
    const ringRules = [ ...css.matchAll(/([^{}]+)\{([^{}]*)\}/g) ]
      .filter(([ , selector, body ]) => /\[data-blok-popover-item\]\[data-blok-focused='true'\]/.test(selector) && /outline\s*:\s*2px/.test(body));

    expect(ringRules.length).toBeGreaterThan(0);
    ringRules.forEach(([ , selector ]) => {
      expect(selector).toContain('[data-blok-keyboard-navigated]');
      expect(selector).toContain(':not([data-blok-modality="pointer"])');
    });
  });
});
