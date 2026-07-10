import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFieldValidity } from '../../../../src/components/utils/field-validity';

describe('setFieldValidity', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('marks an invalid field with aria-invalid="true"', () => {
    const input = document.createElement('input');

    setFieldValidity(input, false);

    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('removes aria-invalid when the field becomes valid', () => {
    const input = document.createElement('input');

    setFieldValidity(input, false);
    setFieldValidity(input, true);

    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('points aria-describedby at the error element when invalid', () => {
    const input = document.createElement('input');

    setFieldValidity(input, false, 'err-1');

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('err-1');
  });

  it('drops only the error id from aria-describedby when valid, preserving others', () => {
    const input = document.createElement('input');

    input.setAttribute('aria-describedby', 'hint-1');
    setFieldValidity(input, false, 'err-1');

    expect(input.getAttribute('aria-describedby')).toBe('hint-1 err-1');

    setFieldValidity(input, true, 'err-1');

    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(input.getAttribute('aria-describedby')).toBe('hint-1');
  });

  it('does not duplicate the error id when marked invalid twice', () => {
    const input = document.createElement('input');

    setFieldValidity(input, false, 'err-1');
    setFieldValidity(input, false, 'err-1');

    expect(input.getAttribute('aria-describedby')).toBe('err-1');
  });

  it('removes aria-describedby entirely when the error id was its only token', () => {
    const input = document.createElement('input');

    setFieldValidity(input, false, 'err-1');
    setFieldValidity(input, true, 'err-1');

    expect(input.hasAttribute('aria-describedby')).toBe(false);
  });
});
