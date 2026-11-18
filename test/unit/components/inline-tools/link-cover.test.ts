import { describe, expect, it } from 'vitest';
import { coverColors, coverColorsForHue } from '../../../../src/components/inline-tools/link-cover';

const channel = (value: number): number => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

const luminanceOfHsl = (color: string): number => {
  const [hue, saturation, lightness] = (color.match(/[\d.]+/g) ?? []).map(Number);
  const s = saturation / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const part = (n: number): number => {
    const k = (n + hue / 30) % 12;

    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };

  return 0.2126 * channel(part(0)) + 0.7152 * channel(part(8)) + 0.0722 * channel(part(4));
};

const luminanceOfHex = (color: string): number => {
  const full = color.length === 4 ? color.replace(/[0-9a-f]/gi, (digit) => digit + digit) : color;
  const [red, green, blue] = [1, 3, 5].map((at) => parseInt(full.slice(at, at + 2), 16) / 255);

  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
};

const contrast = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

describe('link cover colors', () => {
  it('gives a site the strong color and lighter letter picked in the design', () => {
    expect(coverColors('example.com')).toEqual({
      background: 'hsl(333 68% 44%)',
      letter: 'hsl(333 78% 57%)',
      ink: '#fff',
    });
  });

  it('gives the same site the same cover, and another site another one', () => {
    expect(coverColors('en.wikipedia.org')).toEqual(coverColors('en.wikipedia.org'));
    expect(coverColors('en.wikipedia.org').background).not.toBe(coverColors('example.com').background);
  });

  it('keeps a bright cover bright and writes on it in dark ink', () => {
    const cover = coverColors('info.cern.ch');

    expect(cover.background).toBe('hsl(157 68% 44%)');
    expect(cover.ink).not.toBe('#fff');
  });

  it('keeps the caption readable on every hue', () => {
    const unreadable = Array.from({ length: 360 }, (_, hue) => hue).filter((hue) => {
      const cover = coverColorsForHue(hue);

      return contrast(luminanceOfHsl(cover.background), luminanceOfHex(cover.ink)) < 4.5;
    });

    expect(unreadable).toEqual([]);
  });

  it('keeps the letter lighter than the cover it sits on', () => {
    const flat = Array.from({ length: 360 }, (_, hue) => hue).filter((hue) => {
      const cover = coverColorsForHue(hue);

      return luminanceOfHsl(cover.letter) <= luminanceOfHsl(cover.background);
    });

    expect(flat).toEqual([]);
  });
});
