import { describe, it, expect, afterEach, vi } from 'vitest';
import { dimensionsFromSvg } from '../../../../src/tools/image/dimensions-from-svg';

const mockFetch = (body: string, ok = true): void => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    text: (): Promise<string> => Promise.resolve(body),
  }));
};

describe('dimensionsFromSvg', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns null when the URL is not an SVG', async () => {
    await expect(dimensionsFromSvg('https://cdn.example.com/pic.png')).resolves.toBeNull();
  });

  it('extracts width and height attributes', async () => {
    mockFetch('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"></svg>');
    await expect(dimensionsFromSvg('https://cdn.example.com/logo.svg')).resolves.toEqual({ width: 400, height: 200 });
  });

  it('extracts dimensions from viewBox when width/height are missing', async () => {
    mockFetch('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"></svg>');
    await expect(dimensionsFromSvg('https://cdn.example.com/logo.svg')).resolves.toEqual({ width: 800, height: 600 });
  });

  it('accepts bare numbers and px suffixes', async () => {
    mockFetch('<svg width="120px" height="80px"></svg>');
    await expect(dimensionsFromSvg('https://cdn.example.com/logo.svg')).resolves.toEqual({ width: 120, height: 80 });
  });

  it('falls back to viewBox when width/height are relative (%)', async () => {
    mockFetch('<svg width="100%" height="100%" viewBox="0 0 24 16"></svg>');
    await expect(dimensionsFromSvg('https://cdn.example.com/logo.svg')).resolves.toEqual({ width: 24, height: 16 });
  });

  it('falls back to viewBox when width/height use em or cm units', async () => {
    mockFetch('<svg width="10em" height="5em" viewBox="0 0 200 100"></svg>');
    await expect(dimensionsFromSvg('https://cdn.example.com/logo.svg')).resolves.toEqual({ width: 200, height: 100 });
  });

  it('resolves null when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(dimensionsFromSvg('https://cdn.example.com/logo.svg')).resolves.toBeNull();
  });

  it('resolves null when response is not ok', async () => {
    mockFetch('', false);
    await expect(dimensionsFromSvg('https://cdn.example.com/logo.svg')).resolves.toBeNull();
  });

  it('resolves null when root element is not <svg>', async () => {
    mockFetch('<html><body></body></html>');
    await expect(dimensionsFromSvg('https://cdn.example.com/logo.svg')).resolves.toBeNull();
  });
});
