/**
 * A focus ring is a keyboard affordance. A mouse click or tap must never paint one.
 *
 * `:focus-visible` alone cannot promise that. Text fields and `<select>` match
 * it on a plain click, and Blink keeps matching it after a click that does not
 * move focus. So every ring is gated on `data-blok-modality`, which
 * src/components/utils/input-modality.ts writes on <html>.
 *
 * Outline rings are covered once, by the unlayered pointer guard in
 * preflight.css. A box-shadow ring has no such guard and must carry the gate in
 * its own selector. Tailwind's `focus-visible:` variant is redefined in
 * main.css so every utility carries it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');
const SRC_ROOT = join(REPO_ROOT, 'src');
const PLAYGROUND_ROOT = join(SRC_ROOT, 'playground');

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '');

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
      return walk(path);
    }

    return path.endsWith('.css') ? [ path ] : [];
  });

const rules = (file: string): Array<{ selector: string; body: string }> =>
  [ ...stripComments(readFileSync(file, 'utf-8')).matchAll(/([^{}]+)\{([^{}]*)\}/g) ]
    .map(([ , selector, body ]) => ({ selector: selector.trim(), body }));

const paints = (body: string, property: 'outline' | 'box-shadow'): boolean =>
  [ ...body.matchAll(new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+)`, 'g')) ]
    .some(([ , value ]) => !/^(none|0|0px)(\s*!important)?$/.test(value.trim()));

const KEYBOARD_GATE = ':not([data-blok-modality="pointer"])';

describe('focus rings are keyboard-only', () => {
  it('gates every Tailwind focus-visible utility on keyboard modality', () => {
    const main = stripComments(readFileSync(join(SRC_ROOT, 'styles/main.css'), 'utf-8'));
    const variant = main.match(/@custom-variant\s+focus-visible\s+\(([^;]+)\);/);

    expect(variant?.[1]).toContain(':focus-visible');
    expect(variant?.[1]).toContain(KEYBOARD_GATE);
  });

  it('gates every box-shadow focus ring under src on keyboard modality', () => {
    const offenders = walk(SRC_ROOT)
      .filter(file => !file.startsWith(PLAYGROUND_ROOT))
      .flatMap(file => rules(file)
        .filter(({ selector, body }) => selector.includes(':focus-visible') && paints(body, 'box-shadow'))
        .flatMap(({ selector }) => selector.split(',').map(part => part.trim()))
        .filter(part => part.includes(':focus-visible') && !part.includes(KEYBOARD_GATE))
        .map(part => `${relative(REPO_ROOT, file)}: ${part}`));

    expect(offenders).toEqual([]);
  });

  it('paints no ring on plain :focus, which a click matches', () => {
    const offenders = walk(SRC_ROOT).flatMap(file => rules(file)
      .filter(({ selector, body }) => /:focus(?![-\w])/.test(selector) && (paints(body, 'outline') || paints(body, 'box-shadow')))
      .map(({ selector }) => `${relative(REPO_ROOT, file)}: ${selector}`));

    expect(offenders).toEqual([]);
  });
});
