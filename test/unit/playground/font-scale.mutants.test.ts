import { describe, it, expect } from 'vitest';

import { applyFontScale } from '../../../src/playground/font-scale';

const styled = (scale: number): HTMLElement => {
  const element = document.createElement('div');

  applyFontScale(element, scale);

  return element;
};

/**
 * All three survivors are equivalent, and the generator's own format is why.
 * It writes `--token: value;`, so the property half never carries padding to
 * trim, the value half holds exactly one semicolon and it is last, and the
 * leading space before the value is normalised away by the CSSOM on
 * setProperty — measured: the assertion below still reads the trimmed value
 * with the trim removed.
 */
describe('playground font scale mutants', () => {
  it('writes every token as a plain declaration, with no stray semicolon or padding', () => {
    const element = styled(1.5);
    const value = element.style.getPropertyValue('--blok-paragraph-font-size');

    expect(value).toBe('calc(1em * 1.5)');
    expect(element.style.getPropertyValue('--blok-heading-1-font-size')).not.toBe('');
  });

  it('clears every token it wrote when the scale returns to one', () => {
    const element = styled(1.5);

    applyFontScale(element, 1);

    expect(element.getAttribute('style')).toBe('');
  });

  it('ignores an absent element', () => {
    expect(() => applyFontScale(null, 1.5)).not.toThrow();
  });
});
