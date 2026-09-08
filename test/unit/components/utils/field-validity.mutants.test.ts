import { describe, it, expect } from 'vitest';

import { setFieldValidity } from '../../../../src/components/utils/field-validity';

const input = (describedBy?: string): HTMLElement => {
  const element = document.createElement('input');

  if (describedBy !== undefined) {
    element.setAttribute('aria-describedby', describedBy);
  }

  return element;
};

/**
 * One survivor is equivalent: narrowing the split pattern from a run of
 * whitespace to a single character. A run then yields empty strings between
 * the tokens, and the filter on the next line drops exactly those.
 */
describe('setFieldValidity mutants', () => {
  it('marks and clears the invalid state', () => {
    const control = input();

    setFieldValidity(control, false);

    expect(control.getAttribute('aria-invalid')).toBe('true');

    setFieldValidity(control, true);

    expect(control.hasAttribute('aria-invalid')).toBe(false);
  });

  // With no error element to point at, the description must be left exactly as
  // the caller had it.
  it('leaves the description alone when no error id was given', () => {
    const control = input('hint');

    setFieldValidity(control, false);

    expect(control.getAttribute('aria-describedby')).toBe('hint');
  });

  it('links the error element and unlinks it again, keeping other tokens', () => {
    const control = input('hint');

    setFieldValidity(control, false, 'err');

    expect(control.getAttribute('aria-describedby')).toBe('hint err');

    setFieldValidity(control, true, 'err');

    expect(control.getAttribute('aria-describedby')).toBe('hint');
  });

  it('drops the attribute entirely once nothing is left to point at', () => {
    const control = input();

    setFieldValidity(control, false, 'err');
    setFieldValidity(control, true, 'err');

    expect(control.hasAttribute('aria-describedby')).toBe(false);
  });

  it('does not link the same error element twice', () => {
    const control = input('err');

    setFieldValidity(control, false, 'err');

    expect(control.getAttribute('aria-describedby')).toBe('err');
  });
});
