import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetadataFetcher } from '../../../../src/tools/link/metadata-fetcher';

const okResponse = (body: unknown): Response =>
  ({ ok: true, json: () => Promise.resolve(body) }) as unknown as Response;

describe('MetadataFetcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // A static object freezes whatever pass was resolved when the editor was
  // built. A function is re-resolved per request, so a refreshed pass is used.
  it('resolves a headers function on every request', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(okResponse({ success: 1, meta: {} }));
    const headers = vi.fn()
      .mockResolvedValueOnce({ Authorization: 'Bearer pass-1' })
      .mockResolvedValueOnce({ Authorization: 'Bearer pass-2' });
    const fetcher = new MetadataFetcher({ endpoint: 'https://api.test/unfurl', headers });

    await fetcher.fetch('https://example.com/a');
    await fetcher.fetch('https://example.com/b');

    expect(headers).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1]?.[1]?.headers).toEqual({ Authorization: 'Bearer pass-2' });
  });

  it('GETs the configured endpoint with the encoded url and custom headers', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(okResponse({ success: 1, meta: { title: 'T' } }));
    const fetcher = new MetadataFetcher({
      endpoint: 'https://api.test/unfurl',
      headers: { Authorization: 'Bearer x' },
    });

    await fetcher.fetch('https://example.com/a b');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchSpy.mock.calls[0];

    expect(calledUrl).toBe('https://api.test/unfurl?url=https%3A%2F%2Fexample.com%2Fa%20b');
    expect(init?.headers).toEqual({ Authorization: 'Bearer x' });
  });

  it('normalizes a successful response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      okResponse({
        success: 1,
        link: 'https://example.com/article',
        meta: {
          title: 'Title',
          description: 'Desc',
          image: { url: 'https://example.com/og.png' },
          favicon: 'https://example.com/favicon.ico',
          domain: 'example.com',
        },
      })
    );
    const fetcher = new MetadataFetcher({ endpoint: 'https://api.test/unfurl' });

    const meta = await fetcher.fetch('https://example.com/article');

    expect(meta).toEqual({
      url: 'https://example.com/article',
      title: 'Title',
      description: 'Desc',
      image: 'https://example.com/og.png',
      favicon: 'https://example.com/favicon.ico',
      domain: 'example.com',
    });
  });

  it('falls back to the requested url when the response link uses an unsafe scheme', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      okResponse({
        success: 1,
        link: 'javascript:alert(1)',
        meta: { title: 'Title' },
      })
    );
    const fetcher = new MetadataFetcher({ endpoint: 'https://api.test/unfurl' });

    const meta = await fetcher.fetch('https://example.com/article');

    expect(meta.url).toBe('https://example.com/article');
    expect(meta.url).not.toContain('javascript:');
  });

  it('rejects when the backend reports success: 0', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({ success: 0 }));
    const fetcher = new MetadataFetcher({ endpoint: 'https://api.test/unfurl' });

    await expect(fetcher.fetch('https://example.com')).rejects.toThrow();
  });

  it('rejects on a non-ok HTTP response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      { ok: false, status: 500 } as unknown as Response
    );
    const fetcher = new MetadataFetcher({ endpoint: 'https://api.test/unfurl' });

    await expect(fetcher.fetch('https://example.com')).rejects.toThrow();
  });

  it('throws a clear configuration error when no endpoint is set', async () => {
    const fetcher = new MetadataFetcher({ endpoint: '' });

    await expect(fetcher.fetch('https://example.com')).rejects.toThrow(/endpoint/i);
  });
});
