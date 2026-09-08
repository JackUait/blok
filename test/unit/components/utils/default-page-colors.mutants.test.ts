import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isDefaultDarkBackground,
  isInvisibleBackground,
} from '../../../../src/components/utils/default-page-colors';

const classify = (
  colors: readonly string[],
  predicate: (color: string) => boolean
): Record<string, boolean> => Object.fromEntries(colors.map((color) => [color, predicate(color)]));

const dark = (colors: readonly string[]): Record<string, boolean> =>
  classify(colors, isDefaultDarkBackground);

const invisible = (colors: readonly string[]): Record<string, boolean> =>
  classify(colors, isInvisibleBackground);

/*
 * Mutants that survive every input this module can be given, with the reason:
 *
 * - `if (s === 0)` -> `false` / `{}` : with s === 0 the general path computes
 *   q = p = l exactly, so every channel is l and the result is bit-identical to
 *   the achromatic shortcut.
 * - `l < 0.5` -> `l <= 0.5` : the two q formulas can only diverge at l === 0.5.
 *   There every channel lies in [p, q] with p = 1 - q, and the three luminance
 *   weights sum to 1, so luminance also lies in [p, q] and the predicate can
 *   only change once p < 0.12, i.e. saturation > 76%. From 76% up the formulas
 *   agree bit for bit — provably in [50%, 100%), where `1 + s` and `0.5 + s`
 *   round the same direction, and over 64M sampled doubles (~3M per binade) up
 *   to 2^21. They diverge again only from a saturation of 2^52 * 100% up, which
 *   is not worth an input.
 * - `t < 0` -> `t <= 0` and `t > 1` -> `t >= 1` : wrap then returns 1 instead of
 *   0 (or 0 instead of 1), and hueToChannel maps both to p.
 * - `wrapped < 2 / 3` -> `wrapped <= 2 / 3` : at wrapped === 2/3 the extra
 *   branch computes p + (q - p) * 0 * 6, which is p — what the fall-through
 *   returns anyway.
 * - `return -1` -> `return +1` : both fail `luminance < 0.12`, so the predicate
 *   answers false either way.
 * - `rgbMatch[4] !== undefined` -> `true` : alpha is only ever read as
 *   `rgba.a === 0`, and parseFloat(undefined) is NaN, which is !== 0 just as 1 is.
 */
describe('default-page-colors — luminance parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isDefaultDarkBackground with hsl()', () => {
    it('reads an achromatic hsl() as luminance === lightness', () => {
      expect(
        dark(['hsl(0,0%,0%)', 'hsl(0,0%,5%)', 'hsl(0,0%,10%)', 'hsl(0,0%,11%)', 'hsl(0,0%,12%)', 'hsl(0,0%,100%)'])
      ).toStrictEqual({
        'hsl(0,0%,0%)': true,
        'hsl(0,0%,5%)': true,
        'hsl(0,0%,10%)': true,
        'hsl(0,0%,11%)': true,
        'hsl(0,0%,12%)': false,
        'hsl(0,0%,100%)': false,
      });
    });

    it('converts each hue sector to its own channel mix', () => {
      expect(
        dark([
          'hsl(0,90%,10%)',
          'hsl(60,90%,10%)',
          'hsl(120,90%,10%)',
          'hsl(180,90%,10%)',
          'hsl(240,90%,10%)',
          'hsl(300,90%,10%)',
          'hsl(220,93%,18%)',
          'hsl(5,1%,11%)',
        ])
      ).toStrictEqual({
        'hsl(0,90%,10%)': true,
        'hsl(60,90%,10%)': false,
        'hsl(120,90%,10%)': false,
        'hsl(180,90%,10%)': false,
        'hsl(240,90%,10%)': true,
        'hsl(300,90%,10%)': true,
        'hsl(220,93%,18%)': true,
        'hsl(5,1%,11%)': true,
      });
    });

    it('takes the other q formula from 50% lightness up', () => {
      expect(dark(['hsl(245,93%,50%)', 'hsl(245,99%,52%)'])).toStrictEqual({
        'hsl(245,93%,50%)': true,
        'hsl(245,99%,52%)': false,
      });
    });

    it('ignores the alpha of an hsla()', () => {
      expect(dark(['hsla(0,0%,3%,0)', 'hsla(0,0%,3%,0.5)', 'hsla(0,0%,3%,1)'])).toStrictEqual({
        'hsla(0,0%,3%,0)': true,
        'hsla(0,0%,3%,0.5)': true,
        'hsla(0,0%,3%,1)': true,
      });
    });

    it('refuses an hsl() that is not the whole value', () => {
      expect(dark(['xhsl(0,0%,10%)', 'hsl(0,0%,10%)x'])).toStrictEqual({
        'xhsl(0,0%,10%)': false,
        'hsl(0,0%,10%)x': false,
      });
    });

    /*
     * Hue 60 lands hueToChannel exactly on a sector edge — wrapped === 1/6 for
     * green, wrapped === 1/2 for red. The lightness is tuned so the edge's two
     * candidate formulas fall on opposite sides of the 0.12 cut, which is the
     * only way a strict `<` there is distinguishable from `<=`.
     */
    it('compares against each sector edge strictly', () => {
      expect(dark(['hsl(60,66%,7.669221369518423%)', 'hsl(60,64%,7.75402175261569%)'])).toStrictEqual({
        'hsl(60,66%,7.669221369518423%)': false,
        'hsl(60,64%,7.75402175261569%)': true,
      });
    });
  });

  describe('isDefaultDarkBackground with hex', () => {
    it('doubles each digit of a 3-digit hex before weighing the channels', () => {
      expect(dark(['#000', '#111', '#123', '#11d', '#00a'])).toStrictEqual({
        '#000': true,
        '#111': true,
        '#123': false,
        '#11d': false,
        '#00a': true,
      });
    });

    it('refuses a hex that is not the whole value', () => {
      expect(dark(['x#000', '#000x'])).toStrictEqual({
        'x#000': false,
        '#000x': false,
      });
    });
  });

  describe('isDefaultDarkBackground with rgb()', () => {
    it('weighs blue least and ignores alpha', () => {
      expect(dark(['rgb(0,0,0)', 'rgb(0,0,15)', 'rgba(0,0,0,.5)'])).toStrictEqual({
        'rgb(0,0,0)': true,
        'rgb(0,0,15)': true,
        'rgba(0,0,0,.5)': true,
      });
    });

    it('refuses an rgb() that is not the whole value', () => {
      expect(dark(['xrgb(0,0,0)', 'rgb(0,0,0)x'])).toStrictEqual({
        'xrgb(0,0,0)': false,
        'rgb(0,0,0)x': false,
      });
    });
  });

  describe('isInvisibleBackground', () => {
    it('needs every channel at the near-white floor, not just one', () => {
      expect(invisible(['#0ff', '#02f', '#f0f', '#fa00fa', '#00fafa'])).toStrictEqual({
        '#0ff': false,
        '#02f': false,
        '#f0f': false,
        '#fa00fa': false,
        '#00fafa': false,
      });
    });

    it('drops a zero-alpha colour whose channels are above the dark cut', () => {
      expect(invisible(['rgba(31,31,31,0.0)'])).toStrictEqual({
        'rgba(31,31,31,0.0)': true,
      });
    });

    it('parses whole values only', () => {
      expect(invisible(['x#fff', '#fffx', 'xrgba(0,0,0,0)', 'rgba(0,0,0,0)x'])).toStrictEqual({
        'x#fff': false,
        '#fffx': false,
        'xrgba(0,0,0,0)': false,
        'rgba(0,0,0,0)x': false,
      });
    });
  });
});
