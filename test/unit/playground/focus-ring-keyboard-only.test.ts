/**
 * A playground focus ring is a keyboard affordance: a click must never paint one.
 * `:focus-visible` alone cannot promise that (text fields and <select> match it
 * on a click), so every ring is gated on the `data-pg-modality` attribute that
 * the inline <head> script in index.html writes.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');
const PLAYGROUND_ROOT = join(REPO_ROOT, 'src/playground');

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '');

const sources = (): Array<{ name: string; css: string }> => [
  {
    name: 'index.html',
    css: [ ...readFileSync(join(REPO_ROOT, 'index.html'), 'utf-8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g) ]
      .map(([ , css ]) => css)
      .join('\n'),
  },
  ...readdirSync(PLAYGROUND_ROOT)
    .filter(name => name.endsWith('.css'))
    .map(name => ({ name: `src/playground/${name}`, css: readFileSync(join(PLAYGROUND_ROOT, name), 'utf-8') })),
];

const ringRules = (): Array<{ name: string; selector: string }> =>
  sources().flatMap(({ name, css }) => [ ...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g) ]
    .filter(([ , , body ]) => [ ...body.matchAll(/(?:^|;|\s)(?:outline|box-shadow)\s*:\s*([^;]+)/g) ]
      .some(([ , value ]) => !/^(none|0|0px)(\s*!important)?$/.test(value.trim())))
    .map(([ , selector ]) => ({ name, selector: selector.trim() })));

describe('playground focus rings are keyboard-only', () => {
  it('gates every :focus-visible ring on keyboard modality', () => {
    const offenders = ringRules()
      .flatMap(({ name, selector }) => selector.split(',').map(part => ({ name, part: part.trim() })))
      .filter(({ part }) => part.includes(':focus-visible') && !part.includes('[data-pg-modality="keyboard"]'))
      .map(({ name, part }) => `${name}: ${part}`);

    expect(offenders).toEqual([]);
  });

  it("drops the browser's own ring after a pointer gesture", () => {
    const css = stripComments(sources().map(({ css: source }) => source).join('\n'));

    expect(css).toMatch(/html\[data-pg-modality="pointer"\] :focus-visible\s*\{\s*outline:\s*none;?\s*\}/);
  });

  it('paints no ring on plain :focus, which a click matches', () => {
    const offenders = ringRules()
      .filter(({ selector }) => /:focus(?![-\w])/.test(selector))
      .map(({ name, selector }) => `${name}: ${selector}`);

    expect(offenders).toEqual([]);
  });
});
