import { describe, it, expect } from 'vitest';

import { trimTrailingBreaks } from '../../../../src/components/utils/trailing-breaks';

/** The pattern this helper replaces, kept here to pin equivalence. */
const LEGACY = /(?:<br\s*\/?>|\s)+$/i;
const legacyTrim = (html: string): string => html.replace(LEGACY, '');

describe('trimTrailingBreaks', () => {
  const cases = [
    '',
    'text',
    'text  ',
    'text<br>',
    'text<br/>',
    'text<br />',
    'text <br> <br/>  ',
    'text<BR>',
    '<br><br>',
    '   ',
    'a<br>b',
    'a<br>b<br>',
    'keep <br> inner text',
    'trailing\n\t<br>\n',
    '<p>x</p><br>',
  ];

  it.each(cases)('matches the pattern it replaces for %j', (input) => {
    expect(trimTrailingBreaks(input)).toBe(legacyTrim(input));
  });

  it('strips whitespace that precedes a trailing break', () => {
    expect(trimTrailingBreaks('text   <br>')).toBe('text');
  });

  it('keeps breaks that are not at the end', () => {
    expect(trimTrailingBreaks('a<br>b')).toBe('a<br>b');
  });

  /**
   * The run must NOT reach the end: `/(?:<br\s*\/?>|\s)+$/` then retries the
   * whole run from every offset and fails each time — 40k spaces measured
   * 2551ms, doubling 4x per doubling of n. A trailing run that DOES reach the
   * end is fast even with the old pattern, so it proves nothing.
   * Generous bound: a guard against quadratic blowup, not a benchmark.
   */
  it('stays fast on a long run that does not reach the end', () => {
    const hostile = `${' '.repeat(40_000)}x`;
    const started = performance.now();

    expect(trimTrailingBreaks(hostile)).toBe(hostile);
    expect(performance.now() - started).toBeLessThan(150);
  });

  it('stays fast on a long run of breaks that does not reach the end', () => {
    const hostile = `${'<br>'.repeat(20_000)}x`;
    const started = performance.now();

    expect(trimTrailingBreaks(hostile)).toBe(hostile);
    expect(performance.now() - started).toBeLessThan(150);
  });
});
