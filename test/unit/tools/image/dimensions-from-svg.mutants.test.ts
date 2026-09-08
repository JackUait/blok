import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dimensionsFromSvg } from '../../../../src/tools/image/dimensions-from-svg';

/**
 * Mutation coverage for the SVG intrinsic-size reader.
 *
 * Two recorded mutants are provably equivalent and cannot be killed:
 *
 * 1. `isSvgUrl`: the catch block emptied. The original returns false there; the
 *    emptied block falls off the end and returns undefined. The value is
 *    consumed only by the caller guard `if (!isSvgUrl(url)) return null`, and
 *    false and undefined are both falsy, so the same branch runs. The function
 *    is module-private, so nothing else can see the difference.
 *
 * 2. `fetchSvgText`: the catch block emptied. Same shape: null becomes
 *    undefined, and the caller guard is the loose `text == null`, which is true
 *    for both. No other consumer exists.
 */

const svgResponse = (body: string, ok = true): void => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    text: (): Promise<string> => Promise.resolve(body),
  }));
};

const SVG_URL = 'https://cdn.example.com/logo.svg';

describe('dimensionsFromSvg mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('treats a URL the parser rejects as not an SVG', async () => {
    svgResponse('<svg width="400" height="200"></svg>');

    // The space makes `new URL(...)` throw even with a base, so the .svg suffix must not matter.
    await expect(dimensionsFromSvg('https://exa mple.com/logo.svg')).resolves.toBeNull();
  });

  it('ignores a width that merely ends in digits', async () => {
    svgResponse('<svg width="x400" height="x200"></svg>');

    await expect(dimensionsFromSvg(SVG_URL)).resolves.toBeNull();
  });

  it('keeps every digit of a fractional dimension', async () => {
    svgResponse('<svg width="1.25" height="2.5"></svg>');

    await expect(dimensionsFromSvg(SVG_URL)).resolves.toEqual({ width: 1.25, height: 2.5 });
  });

  it('trims whitespace around a dimension attribute', async () => {
    svgResponse('<svg width=" 400 " height=" 200 "></svg>');

    await expect(dimensionsFromSvg(SVG_URL)).resolves.toEqual({ width: 400, height: 200 });
  });

  it('rejects negative dimensions', async () => {
    svgResponse('<svg width="-5" height="-8"></svg>');

    await expect(dimensionsFromSvg(SVG_URL)).resolves.toBeNull();
  });

  it('rejects zero dimensions', async () => {
    svgResponse('<svg width="0" height="0"></svg>');

    await expect(dimensionsFromSvg(SVG_URL)).resolves.toBeNull();
  });

  it('ignores the body of a failed response', async () => {
    svgResponse('<svg width="400" height="200"></svg>', false);

    await expect(dimensionsFromSvg(SVG_URL)).resolves.toBeNull();
  });

  it('does not attempt a parse when the fetch failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    vi.stubGlobal('DOMParser', class {
      public parseFromString(): Document {
        throw new Error('parse attempted on a failed fetch');
      }
    });

    await expect(dimensionsFromSvg(SVG_URL)).resolves.toBeNull();
  });

  it('returns null when there is no width, height or viewBox', async () => {
    svgResponse('<svg></svg>');

    await expect(dimensionsFromSvg(SVG_URL)).resolves.toBeNull();
  });

  it('trims a padded viewBox', async () => {
    svgResponse('<svg viewBox="  0 0 800 600  "></svg>');

    await expect(dimensionsFromSvg(SVG_URL)).resolves.toEqual({ width: 800, height: 600 });
  });

  it('collapses repeated viewBox separators', async () => {
    svgResponse('<svg viewBox="0,  0,  800,  600"></svg>');

    await expect(dimensionsFromSvg(SVG_URL)).resolves.toEqual({ width: 800, height: 600 });
  });

  it('rejects a viewBox with more than four values', async () => {
    svgResponse('<svg viewBox="0 0 800 600 5"></svg>');

    await expect(dimensionsFromSvg(SVG_URL)).resolves.toBeNull();
  });

  it('rejects a viewBox whose width is not a number', async () => {
    svgResponse('<svg viewBox="0 0 abc 600"></svg>');

    await expect(dimensionsFromSvg(SVG_URL)).resolves.toBeNull();
  });

  it('rejects a viewBox whose height is not a number', async () => {
    svgResponse('<svg viewBox="0 0 800 abc"></svg>');

    await expect(dimensionsFromSvg(SVG_URL)).resolves.toBeNull();
  });

  it('ignores width and height on a non-svg root element', async () => {
    svgResponse('<foo width="10" height="20"></foo>');

    await expect(dimensionsFromSvg(SVG_URL)).resolves.toBeNull();
  });

  it('falls back to the viewBox when only the width attribute is usable', async () => {
    svgResponse('<svg width="400" viewBox="0 0 10 20"></svg>');

    await expect(dimensionsFromSvg(SVG_URL)).resolves.toEqual({ width: 10, height: 20 });
  });

  it('falls back to the viewBox when only the height attribute is usable', async () => {
    svgResponse('<svg height="200" viewBox="0 0 10 20"></svg>');

    await expect(dimensionsFromSvg(SVG_URL)).resolves.toEqual({ width: 10, height: 20 });
  });
});
