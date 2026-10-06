import { describe, expect, it } from 'vitest';

import { firstStrongDirection } from '../../../src/shared/text-direction';

describe('firstStrongDirection', () => {
  it('reads Latin, Cyrillic and CJK letters as ltr', () => {
    expect(firstStrongDirection('Hello')).toBe('ltr');
    expect(firstStrongDirection('Привет')).toBe('ltr');
    expect(firstStrongDirection('你好')).toBe('ltr');
  });

  it('reads Arabic, Hebrew, Persian, Syriac and Thaana letters as rtl', () => {
    expect(firstStrongDirection('مرحبا')).toBe('rtl');
    expect(firstStrongDirection('שלום')).toBe('rtl');
    expect(firstStrongDirection('سلام')).toBe('rtl');
    expect(firstStrongDirection('ܫܠܡܐ')).toBe('rtl');
    expect(firstStrongDirection('ދިވެހި')).toBe('rtl');
  });

  it('reads Arabic presentation forms and supplementary-plane RTL letters as rtl', () => {
    expect(firstStrongDirection('ﻻ')).toBe('rtl');
    expect(firstStrongDirection('שׁ')).toBe('rtl');
    // Adlam capital alif
    expect(firstStrongDirection('\u{1E900}')).toBe('rtl');
  });

  it('decides on the FIRST strong letter and skips neutrals before it', () => {
    expect(firstStrongDirection('123 «مرحبا» Hello')).toBe('rtl');
    expect(firstStrongDirection('  (42) Hello مرحبا')).toBe('ltr');
    expect(firstStrongDirection('!؟ مرحبا')).toBe('rtl');
  });

  it('returns null when there is no strong letter', () => {
    expect(firstStrongDirection('')).toBeNull();
    expect(firstStrongDirection('123')).toBeNull();
    expect(firstStrongDirection('12:30 — 3.5%!')).toBeNull();
    // Arabic-Indic digits are weak, not strong
    expect(firstStrongDirection('١٢٣')).toBeNull();
    // Hebrew points alone are non-spacing marks
    expect(firstStrongDirection('ְִ')).toBeNull();
  });

  it('honours explicit direction marks', () => {
    expect(firstStrongDirection('‏123')).toBe('rtl');
    expect(firstStrongDirection('‎١٢٣')).toBe('ltr');
  });
});
