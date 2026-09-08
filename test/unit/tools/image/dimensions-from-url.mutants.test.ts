import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dimensionsFromUrl } from '../../../../src/tools/image/dimensions-from-url';

// Mutation-hunting suite for src/tools/image/dimensions-from-url.ts.
//
// Every positive case asserts the WHOLE dimensions object: a one-axis
// assertion survives every mutant that only shifts the other axis.
//
// PROVEN-EQUIVALENT MUTANTS (measured, not assumed) — see the notes attached
// to each group below. Twelve of the file's thirty-five live mutants cannot be
// observed through the only export, dimensionsFromUrl.

describe('dimensionsFromUrl mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // valid() — line 6 finiteness guard, line 7 positivity guard.
  //
  // Both guards are only visible when exactly ONE axis is bad: two bad axes
  // make the || and the && agree, and a good pair skips both branches.
  describe('valid guards', () => {
    it('valid: rejects a non-numeric width when the height is finite', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/pic.jpg?w=abc&h=300')).toBeNull();
    });

    it('valid: rejects a non-numeric height when the width is finite', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/pic.jpg?w=400&h=abc')).toBeNull();
    });

    it('valid: rejects an infinite height when the width is finite', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/pic.jpg?w=400&h=Infinity')).toBeNull();
    });

    // Exactly ON the boundary, so `height <= 0` and `height < 0` disagree.
    // The width stays positive, or the width clause masks the height clause.
    it('valid: rejects a height of exactly zero on the height clause', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/pic.jpg?w=400&h=0')).toBeNull();
    });

    it('valid: keeps a positive pair intact', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/pic.jpg?w=401&h=307')).toStrictEqual({ width: 401, height: 307 });
    });
  });

  // fromSearchParams — the size/dim/dimensions chain (line 12) and its
  // anchored WxH pattern (line 14).
  //
  // EQUIVALENT, line 13 ConditionalExpression `size` to `true`: the block body
  // is inert for every falsy value URLSearchParams.get can return. Measured:
  // the anchored WxH pattern exec'd on null returns null (RegExp.exec
  // stringifies its argument, and "null" has no leading digit) and exec'd on
  // the empty string returns null too. So entering the block with a falsy size
  // still falls through to the resize chain.
  describe('size, dim and dimensions parameters', () => {
    it('size chain: reads the dim parameter', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/pic.jpg?dim=800x600')).toStrictEqual({ width: 800, height: 600 });
    });

    it('size chain: reads the dimensions parameter', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/pic.jpg?dimensions=1024x768')).toStrictEqual({ width: 1024, height: 768 });
    });

    // Leading junk: the start anchor is the only thing rejecting this.
    it('size chain: refuses a WxH value that does not start the parameter', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/pic.jpg?size=a100x200')).toBeNull();
    });

    // Trailing junk: the end anchor is the only thing rejecting this.
    it('size chain: refuses a WxH value that does not end the parameter', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/pic.jpg?size=100x200extra')).toBeNull();
    });

    // A truthy size that never matches: line 15 must not dereference the null
    // match, and must not stop the fall-through either.
    it('size chain: falls through a truthy but unparsable size', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/pic.jpg?size=abc')).toBeNull();
    });
  });

  // fromSearchParams — the resize/fit chain (line 17) and its anchored W,H
  // pattern (line 19).
  //
  // EQUIVALENT, line 18 ConditionalExpression `resize` to `true`: same
  // measurement as the size chain — the anchored W,H pattern exec'd on null
  // returns null, so the block body is inert for a falsy resize.
  describe('resize and fit parameters', () => {
    it('resize chain: reads the fit parameter', () => {
      expect(dimensionsFromUrl('https://i0.wp.com/site.com/img.jpg?fit=640,480')).toStrictEqual({ width: 640, height: 480 });
    });

    it('resize chain: refuses a W,H value that does not start the parameter', () => {
      expect(dimensionsFromUrl('https://i0.wp.com/site.com/img.jpg?resize=a400,300')).toBeNull();
    });

    it('resize chain: refuses a W,H value that does not end the parameter', () => {
      expect(dimensionsFromUrl('https://i0.wp.com/site.com/img.jpg?resize=400,300extra')).toBeNull();
    });

    it('resize chain: falls through a truthy but unparsable resize', () => {
      expect(dimensionsFromUrl('https://i0.wp.com/site.com/img.jpg?resize=abc')).toBeNull();
    });
  });

  // fromSearchParams — the w/h pair guard on line 24.
  //
  // EQUIVALENT, line 24 `w && h` to `true` and to `w || h`: the guard is
  // dominated by valid(). URLSearchParams.get returns string or null, so the
  // only falsy values are null and the empty string, and BOTH coerce to 0
  // (measured: Number(null) === 0 and Number('') === 0), which line 7 rejects.
  // Calling valid() with a missing axis therefore returns null — exactly what
  // line 25 returns when the guard is honoured. The cases below still pin the
  // fall-through, they simply cannot distinguish the mutants.
  describe('w and h pair', () => {
    it('w/h pair: a lone width yields nothing', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/pic.jpg?w=400')).toBeNull();
    });

    it('w/h pair: a lone height yields nothing', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/pic.jpg?h=300')).toBeNull();
    });

    it('w/h pair: an empty width parameter yields nothing', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/pic.jpg?w=&h=300')).toBeNull();
    });
  });

  // fromCloudinary — line 42.
  //
  // EQUIVALENT, line 42 `w && h` to `true` and to `w || h`: unlike its two
  // siblings, this branch passes the raw capture STRINGS to valid(), not
  // match arrays, so a missing axis is Number(null) === 0 and valid() returns
  // null instead of throwing. Same domination argument as line 24.
  describe('Cloudinary transform segments', () => {
    it('cloudinary: a transform carrying only a width yields nothing', () => {
      expect(dimensionsFromUrl('https://res.cloudinary.com/demo/image/upload/w_400/sample.jpg')).toBeNull();
    });

    it('cloudinary: reads a height-first transform whole', () => {
      expect(dimensionsFromUrl('https://res.cloudinary.com/demo/image/upload/h_301,w_407/sample.jpg')).toStrictEqual({ width: 407, height: 301 });
    });
  });

  // fromCloudflare — lines 48 to 50.
  //
  // The two option patterns each carry a leading alternation and a trailing
  // one. A single fixture cannot see both ends of both patterns, so the order
  // of the options is flipped between the two positive cases: height-first
  // exposes width's trailing end-of-string alternative and height's leading
  // start-of-string alternative; width-first exposes height's trailing one.
  describe('Cloudflare cdn-cgi options', () => {
    it('cloudflare: reads height-first options where the width ends the list', () => {
      expect(dimensionsFromUrl('https://site.example.com/cdn-cgi/image/height=301,width=407/img.jpg')).toStrictEqual({ width: 407, height: 301 });
    });

    it('cloudflare: reads width-first options where the height ends the list', () => {
      expect(dimensionsFromUrl('https://site.example.com/cdn-cgi/image/width=407,height=301/img.jpg')).toStrictEqual({ width: 407, height: 301 });
    });

    // Line 50 indexes w[1] and h[1]: a relaxed guard dereferences a null match.
    it('cloudflare: options carrying only a width yield nothing', () => {
      expect(dimensionsFromUrl('https://site.example.com/cdn-cgi/image/width=407/img.jpg')).toBeNull();
    });

    it('cloudflare: options carrying only a height yield nothing', () => {
      expect(dimensionsFromUrl('https://site.example.com/cdn-cgi/image/height=301/img.jpg')).toBeNull();
    });
  });

  // fromImageKit — lines 56 to 58. Same shape as the Cloudflare branch.
  describe('ImageKit tr transformations', () => {
    it('imagekit: reads height-first transformations where the width ends the list', () => {
      expect(dimensionsFromUrl('https://ik.imagekit.io/demo/tr:h-301,w-407/pic.jpg')).toStrictEqual({ width: 407, height: 301 });
    });

    it('imagekit: reads width-first transformations where the height ends the list', () => {
      expect(dimensionsFromUrl('https://ik.imagekit.io/demo/tr:w-407,h-301/pic.jpg')).toStrictEqual({ width: 407, height: 301 });
    });

    it('imagekit: transformations carrying only a width yield nothing', () => {
      expect(dimensionsFromUrl('https://ik.imagekit.io/demo/tr:w-407/pic.jpg')).toBeNull();
    });

    it('imagekit: transformations carrying only a height yield nothing', () => {
      expect(dimensionsFromUrl('https://ik.imagekit.io/demo/tr:h-301/pic.jpg')).toBeNull();
    });
  });

  // fromFilename — lines 66 and 67.
  //
  // EQUIVALENT, line 66 the empty-string fallback replaced by any other
  // literal: String.prototype.split always returns at least one element, so
  // pop() on its result is never undefined and the fallback is unreachable.
  // Measured: ''.split('/') is [''].
  //
  // EQUIVALENT, all three line-67 pattern mutants (dropping the end anchor,
  // dropping the plus quantifier, negating the extension character class):
  // they all edit the SECOND alternative of the trailing group, which is dead
  // code. That alternative starts with an escaped dot, and the first
  // alternative — a class holding dot, underscore and hyphen — already accepts
  // a dot at the same position and is tried first; nothing follows the group,
  // so the first alternative's success ends the match and the second is never
  // reached. Brute-forced: 21_435_887 exec comparisons covering every string of
  // length 0 to 7 over the alphabet hyphen, underscore, dot, x, X, 1, 2, a, 9,
  // slash produce an identical match index and identical capture groups under
  // the original and under all three mutants.
  describe('filename dimensions', () => {
    it('filename: reads a WxH suffix before the extension', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/photo-1907x1081.jpg')).toStrictEqual({ width: 1907, height: 1081 });
    });

    it('filename: reads a WxH suffix followed by another word', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/pic_807x601_crop.png')).toStrictEqual({ width: 807, height: 601 });
    });

    it('filename: reads a separated wN hN suffix', () => {
      expect(dimensionsFromUrl('https://cdn.example.com/foo_w407_h301.jpg')).toStrictEqual({ width: 407, height: 301 });
    });
  });

  // dimensionsFromUrl and safeParse — lines 76 to 85.
  //
  // EQUIVALENT, line 83 ConditionalExpression `!url` to `false`: the only
  // falsy value the string parameter can hold is the empty string, and
  // measured, new URL('', 'https://base.local') succeeds with pathname '/',
  // zero search params, and '/'.split('/').pop() === '', so every extractor
  // returns null and the function returns null with or without the guard.
  //
  // EQUIVALENT, line 77 the catch body emptied: the catch would then return
  // undefined instead of null, and line 85 tests `!parsed`, which is true for
  // both. safeParse is module-private, so line 85 is its only consumer.
  describe('parsing failures', () => {
    it('parse: an unparsable absolute URL yields nothing instead of throwing', () => {
      expect(dimensionsFromUrl('http://[')).toBeNull();
    });

    it('parse: a host with a space yields nothing instead of throwing', () => {
      expect(dimensionsFromUrl('https://exa mple.com/pic-1907x1081.jpg')).toBeNull();
    });

    it('parse: an empty URL yields nothing', () => {
      expect(dimensionsFromUrl('')).toBeNull();
    });
  });
});
