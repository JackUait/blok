import { describe, it, expect } from 'vitest';
import { parseColor, mapToNearestPresetColor } from '../../../../src/components/utils/color-mapping';

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

  it('parses rgba() ignoring alpha', () => {
    expect(parseColor('rgba(255, 0, 0, 0.5)')).toEqual([255, 0, 0]);
  });

  it('parses rgba() without spaces', () => {
    expect(parseColor('rgba(128,64,32,0.8)')).toEqual([128, 64, 32]);
  });

  it('parses rgba() with alpha 1', () => {
    expect(parseColor('rgba(0, 128, 255, 1)')).toEqual([0, 128, 255]);
  });

  it('parses hsl() converting to RGB', () => {
    expect(parseColor('hsl(0, 100%, 50%)')).toEqual([255, 0, 0]);
  });

  it('parses hsl() for green', () => {
    expect(parseColor('hsl(120, 100%, 50%)')).toEqual([0, 255, 0]);
  });

  it('parses hsl() for blue', () => {
    expect(parseColor('hsl(240, 100%, 50%)')).toEqual([0, 0, 255]);
  });

  it('parses hsl() for achromatic white', () => {
    expect(parseColor('hsl(0, 0%, 100%)')).toEqual([255, 255, 255]);
  });

  it('parses hsl() for achromatic black', () => {
    expect(parseColor('hsl(0, 0%, 0%)')).toEqual([0, 0, 0]);
  });

  it('parses hsla() ignoring alpha', () => {
    expect(parseColor('hsla(0, 100%, 50%, 0.8)')).toEqual([255, 0, 0]);
  });

  it('parses hsla() for cyan', () => {
    expect(parseColor('hsla(180, 100%, 50%, 0.5)')).toEqual([0, 255, 255]);
  });

  it('parses 8-digit hex ignoring alpha', () => {
    expect(parseColor('#ff000080')).toEqual([255, 0, 0]);
  });

  it('parses 8-digit hex with full alpha', () => {
    expect(parseColor('#00ff00ff')).toEqual([0, 255, 0]);
  });

  it('parses 4-digit hex ignoring alpha', () => {
    expect(parseColor('#f008')).toEqual([255, 0, 0]);
  });

  it('parses 4-digit hex for green with alpha', () => {
    expect(parseColor('#0f0f')).toEqual([0, 255, 0]);
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

describe('mapToNearestPresetColor', () => {
  it('returns exact match for Blok red text color', () => {
    expect(mapToNearestPresetColor('#d44c47', 'text')).toBe('#d44c47');
  });

  it('returns exact match for Blok blue bg color', () => {
    expect(mapToNearestPresetColor('#e7f3f8', 'bg')).toBe('#e7f3f8');
  });

  it('maps Google Docs pure red (#ff0000) text to Blok red', () => {
    expect(mapToNearestPresetColor('#ff0000', 'text')).toBe('#d44c47');
  });

  it('maps Google Docs pure blue (#0000ff) text to Blok blue', () => {
    expect(mapToNearestPresetColor('#0000ff', 'text')).toBe('#337ea9');
  });

  it('maps Google Docs pure green (#00ff00) text to Blok green', () => {
    expect(mapToNearestPresetColor('#00ff00', 'text')).toBe('#448361');
  });

  it('maps Google Docs yellow (#ffff00) bg to Blok yellow bg', () => {
    expect(mapToNearestPresetColor('#ffff00', 'bg')).toBe('#fbf3db');
  });

  it('maps Google Docs dark red (#980000) text to Blok red', () => {
    expect(mapToNearestPresetColor('#980000', 'text')).toBe('#d44c47');
  });

  it('maps Google Docs purple (#9900ff) text to Blok purple', () => {
    expect(mapToNearestPresetColor('#9900ff', 'text')).toBe('#9065b0');
  });

  it('maps Google Docs gray (#999999) text to Blok gray', () => {
    expect(mapToNearestPresetColor('#999999', 'text')).toBe('#787774');
  });

  it('maps Google Docs orange (#ff9900) text to Blok orange', () => {
    expect(mapToNearestPresetColor('#ff9900', 'text')).toBe('#d9730d');
  });

  it('handles rgb() format input', () => {
    expect(mapToNearestPresetColor('rgb(255, 0, 0)', 'text')).toBe('#d44c47');
  });

  it('returns input unchanged for unparseable color', () => {
    expect(mapToNearestPresetColor('not-a-color', 'text')).toBe('not-a-color');
  });

  it('maps black (#000000) text to Blok gray', () => {
    expect(mapToNearestPresetColor('#000000', 'text')).toBe('#787774');
  });

  it('maps white (#ffffff) bg to nearest bg preset', () => {
    const result = mapToNearestPresetColor('#ffffff', 'bg');

    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('maps Google Docs light red bg (#f4cccc) to Blok red bg', () => {
    expect(mapToNearestPresetColor('#f4cccc', 'bg')).toBe('#fdebec');
  });

  it('maps Google Docs light green bg (#d9ead3) to Blok green bg', () => {
    expect(mapToNearestPresetColor('#d9ead3', 'bg')).toBe('#edf3ec');
  });

  it('maps Google Docs light blue bg (#cfe2f3) to Blok blue bg', () => {
    expect(mapToNearestPresetColor('#cfe2f3', 'bg')).toBe('#e7f3f8');
  });

  it('maps Google Docs light purple bg (#d9d2e9) to Blok purple bg', () => {
    expect(mapToNearestPresetColor('#d9d2e9', 'bg')).toBe('#f6f3f9');
  });

  it('maps Google Docs light yellow bg (#fff2cc) to Blok yellow bg', () => {
    expect(mapToNearestPresetColor('#fff2cc', 'bg')).toBe('#fbf3db');
  });

  it('maps rgba red to Blok red text preset', () => {
    expect(mapToNearestPresetColor('rgba(255, 0, 0, 0.5)', 'text')).toBe('#d44c47');
  });

  it('maps hsla red to Blok red text preset', () => {
    expect(mapToNearestPresetColor('hsla(0, 100%, 50%, 0.8)', 'text')).toBe('#d44c47');
  });

  it('maps hsl red to Blok red text preset', () => {
    expect(mapToNearestPresetColor('hsl(0, 100%, 50%)', 'text')).toBe('#d44c47');
  });

  it('maps 8-digit hex red to Blok red bg preset', () => {
    expect(mapToNearestPresetColor('#ff000080', 'bg')).toBe('#fdebec');
  });

  it('maps 4-digit hex red to Blok red bg preset', () => {
    expect(mapToNearestPresetColor('#f008', 'bg')).toBe('#fdebec');
  });
});
