import { describe, it, expect } from 'vitest';

import { buildFontSizeVarLines } from '../../../../src/components/utils/font-size-tokens';
import type { BlokFontSizeConfig } from '../../../../types/configs/blok-config';

/** The wire can hand back null where the type promises a nested object. */
const offSpec = (shape: Record<string, unknown>): BlokFontSizeConfig => shape;

/**
 * Two survivors are equivalent: both mutants of the `fontSize === undefined`
 * early return. Reading a path out of `undefined` yields `undefined` at the
 * first step, which is not a string, so every token is skipped and the result
 * is the same empty list the guard returned.
 */
describe('font size token lines mutants', () => {
  it('writes one line per configured token, in spec order', () => {
    expect(buildFontSizeVarLines({ paragraph: '18px', heading: { 1: '2rem' } })).toStrictEqual([
      '--blok-paragraph-font-size: 18px;',
      '--blok-heading-1-font-size: 2rem;',
    ]);
  });

  it('writes nothing for a config that sets nothing', () => {
    expect(buildFontSizeVarLines(undefined)).toStrictEqual([]);
    expect(buildFontSizeVarLines({})).toStrictEqual([]);
  });

  // A blank value is not a size; a padded one is the same size with noise.
  it('skips a blank value and trims a padded one', () => {
    expect(buildFontSizeVarLines({ paragraph: '   ' })).toStrictEqual([]);
    expect(buildFontSizeVarLines({ paragraph: '  18px  ' })).toStrictEqual(['--blok-paragraph-font-size: 18px;']);
  });

  it('walks past a null where a nested group was expected', () => {
    expect(buildFontSizeVarLines(offSpec({ heading: null, paragraph: '18px' })))
      .toStrictEqual(['--blok-paragraph-font-size: 18px;']);
  });
});
