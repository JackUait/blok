import { describe, it, expect } from 'vitest';
import { parseColor } from '../../../../src/components/utils/color-mapping';

describe('parseColor', () => {
  it('parses 6-digit hex color', () => {
    expect(parseColor('#ff0000')).toEqual([255, 0, 0]);
  });

  it('parses 3-digit hex color', () => {
    expect(parseColor('#f00')).toEqual([255, 0, 0]);
  });

  it('parses rgb() with spaces', () => {
    expect(parseColor('rgb(255, 128, 0)')).toEqual([255, 128, 0]);
  });

  it('parses rgb() without spaces', () => {
    expect(parseColor('rgb(255,128,0)')).toEqual([255, 128, 0]);
  });

  it('returns null for invalid input', () => {
    expect(parseColor('not-a-color')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseColor('')).toBeNull();
  });

  it('parses uppercase hex', () => {
    expect(parseColor('#FF0000')).toEqual([255, 0, 0]);
  });

  it('parses black', () => {
    expect(parseColor('#000000')).toEqual([0, 0, 0]);
  });

  it('parses white', () => {
    expect(parseColor('#ffffff')).toEqual([255, 255, 255]);
  });
});
