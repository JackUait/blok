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
