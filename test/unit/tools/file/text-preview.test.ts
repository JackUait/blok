import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadTextPreview } from '../../../../src/tools/file/text-preview';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadTextPreview', () => {
  it('returns the body text on a 2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('hello world'),
    }));

    const result = await loadTextPreview('blob:abc');
    expect(result).toEqual({ ok: true, text: 'hello world' });
  });

  it('returns fetch-error on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      text: () => Promise.resolve(''),
    }));

    const result = await loadTextPreview('https://x/y.txt');
    expect(result).toEqual({ ok: false, reason: 'fetch-error' });
  });

  it('returns fetch-error when fetch throws (CORS/offline)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const result = await loadTextPreview('https://x/y.txt');
    expect(result).toEqual({ ok: false, reason: 'fetch-error' });
  });

  it('returns ok with empty string for an empty body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    }));

    const result = await loadTextPreview('blob:empty');
    expect(result).toEqual({ ok: true, text: '' });
  });
});
