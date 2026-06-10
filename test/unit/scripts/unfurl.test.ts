import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseMetadata } from '../../../scripts/unfurl/parse-metadata.mjs';
import unfurlPlugin, { createUnfurlHandler } from '../../../scripts/unfurl/vite-plugin-unfurl.mjs';
import type { UnfurlRequest, UnfurlResponse } from '../../../scripts/unfurl/vite-plugin-unfurl.mjs';

const PAGE_URL = 'https://example.com/articles/post?id=1';

interface FakeRes extends UnfurlResponse {
  headers: Record<string, string>;
  body: string;
}

interface UnfurlPayload {
  success: number;
  link?: string;
  meta?: {
    title?: string;
    description?: string;
    image?: { url?: string };
    favicon?: string;
    domain?: string;
  };
}

const createFakeRes = (): FakeRes => ({
  statusCode: 0,
  headers: {},
  body: '',
  setHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value;
  },
  end(body: string): void {
    this.body = body;
  },
});

const createFakeReq = (url?: string): UnfurlRequest => ({ url });

const parsePayload = (res: FakeRes): UnfurlPayload => JSON.parse(res.body) as UnfurlPayload;

const htmlResponse = (html: string, overrides: Partial<Response> = {}): Response =>
  ({
    ok: true,
    status: 200,
    url: 'https://example.com/final',
    headers: {
      get: (name: string): string | null =>
        name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null,
    },
    text: (): Promise<string> => Promise.resolve(html),
    ...overrides,
  }) as unknown as Response;

describe('parseMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers og tags over twitter tags and HTML fallbacks', () => {
    const html = `
      <html><head>
        <title>HTML Title</title>
        <meta name="description" content="HTML description">
        <meta property="og:title" content="OG Title">
        <meta property="og:description" content="OG description">
        <meta property="og:image" content="https://cdn.example.com/og.png">
        <meta name="twitter:title" content="Twitter Title">
        <meta name="twitter:description" content="Twitter description">
        <meta name="twitter:image" content="https://cdn.example.com/tw.png">
      </head></html>`;

    const meta = parseMetadata(html, PAGE_URL);

    expect(meta.title).toBe('OG Title');
    expect(meta.description).toBe('OG description');
    expect(meta.image).toBe('https://cdn.example.com/og.png');
  });

  it('falls back to twitter tags when og tags are absent', () => {
    const html = `
      <head>
        <title>HTML Title</title>
        <meta name="twitter:title" content="Twitter Title">
        <meta name="twitter:description" content="Twitter description">
        <meta name="twitter:image" content="https://cdn.example.com/tw.png">
      </head>`;

    const meta = parseMetadata(html, PAGE_URL);

    expect(meta.title).toBe('Twitter Title');
    expect(meta.description).toBe('Twitter description');
    expect(meta.image).toBe('https://cdn.example.com/tw.png');
  });

  it('falls back to <title> and meta description when social tags are absent', () => {
    const html = `
      <head>
        <title>  Plain Title  </title>
        <meta name="description" content="Plain description">
      </head>`;

    const meta = parseMetadata(html, PAGE_URL);

    expect(meta.title).toBe('Plain Title');
    expect(meta.description).toBe('Plain description');
    expect(meta.image).toBeUndefined();
  });

  it('supports og:image:secure_url and twitter:image:src variants', () => {
    const secure = parseMetadata(
      '<meta property="og:image:secure_url" content="https://cdn.example.com/secure.png">',
      PAGE_URL
    );
    const twitterSrc = parseMetadata(
      '<meta name="twitter:image:src" content="https://cdn.example.com/src.png">',
      PAGE_URL
    );

    expect(secure.image).toBe('https://cdn.example.com/secure.png');
    expect(twitterSrc.image).toBe('https://cdn.example.com/src.png');
  });

  it('decodes named and numeric HTML entities', () => {
    const html = `
      <head>
        <title>Q&amp;A &lt;guide&gt;</title>
        <meta property="og:description" content="It&#39;s &quot;fine&quot; &#8212; really">
      </head>`;

    const meta = parseMetadata(html, PAGE_URL);

    expect(meta.title).toBe('Q&A <guide>');
    expect(meta.description).toBe('It\'s "fine" — really');
  });

  it('resolves relative image and favicon URLs against the page URL', () => {
    const html = `
      <head>
        <meta property="og:image" content="/img/cover.png">
        <link rel="icon" href="../static/favicon.svg">
      </head>`;

    const meta = parseMetadata(html, PAGE_URL);

    expect(meta.image).toBe('https://example.com/img/cover.png');
    expect(meta.favicon).toBe('https://example.com/static/favicon.svg');
  });

  it('supports shortcut icon and apple-touch-icon rel values', () => {
    const shortcut = parseMetadata(
      '<link rel="shortcut icon" href="/short.ico">',
      PAGE_URL
    );
    const appleTouch = parseMetadata(
      '<link rel="apple-touch-icon" href="/apple.png">',
      PAGE_URL
    );

    expect(shortcut.favicon).toBe('https://example.com/short.ico');
    expect(appleTouch.favicon).toBe('https://example.com/apple.png');
  });

  it('falls back to /favicon.ico at the page origin when no icon link exists', () => {
    const meta = parseMetadata('<title>No icons</title>', PAGE_URL);

    expect(meta.favicon).toBe('https://example.com/favicon.ico');
  });

  it('extracts the domain from the page URL', () => {
    const meta = parseMetadata('', 'https://sub.example.org:8443/path');

    expect(meta.domain).toBe('sub.example.org');
  });

  it('handles reversed attribute order, name= for og tags, and single quotes', () => {
    const html = `
      <meta content="Reversed Title" property="og:title">
      <meta name='og:description' content='Named description'>
    `;

    const meta = parseMetadata(html, PAGE_URL);

    expect(meta.title).toBe('Reversed Title');
    expect(meta.description).toBe('Named description');
  });

  it('ignores meta tags with empty or whitespace-only content', () => {
    const html = `
      <meta property="og:title" content="   ">
      <meta name="twitter:title" content="Fallback Title">
    `;

    const meta = parseMetadata(html, PAGE_URL);

    expect(meta.title).toBe('Fallback Title');
  });

  it('returns only domain and favicon fallback for empty html', () => {
    const meta = parseMetadata('', PAGE_URL);

    expect(meta.title).toBeUndefined();
    expect(meta.description).toBeUndefined();
    expect(meta.image).toBeUndefined();
    expect(meta.favicon).toBe('https://example.com/favicon.ico');
    expect(meta.domain).toBe('example.com');
  });
});

describe('createUnfurlHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the unfurl contract shape on success', async () => {
    const html = `
      <head>
        <meta property="og:title" content="Page Title">
        <meta property="og:description" content="Page description">
        <meta property="og:image" content="https://cdn.example.com/og.png">
        <link rel="icon" href="/favicon.svg">
      </head>`;
    const fetchMock = vi.fn(() => Promise.resolve(htmlResponse(html)));
    const handler = createUnfurlHandler(fetchMock);
    const res = createFakeRes();

    await handler(createFakeReq(`/?url=${encodeURIComponent('https://example.com/start')}`), res);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    expect(parsePayload(res)).toEqual({
      success: 1,
      link: 'https://example.com/final',
      meta: {
        title: 'Page Title',
        description: 'Page description',
        image: { url: 'https://cdn.example.com/og.png' },
        favicon: 'https://example.com/favicon.svg',
        domain: 'example.com',
      },
    });
  });

  it('omits absent meta fields from the JSON payload', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(htmlResponse('<title>Only Title</title>')));
    const handler = createUnfurlHandler(fetchMock);
    const res = createFakeRes();

    await handler(createFakeReq(`/?url=${encodeURIComponent('https://example.com/start')}`), res);

    const payload = parsePayload(res);

    expect(payload.success).toBe(1);
    expect(payload.meta).toEqual({
      title: 'Only Title',
      favicon: 'https://example.com/favicon.ico',
      domain: 'example.com',
    });
    expect(payload.meta).not.toHaveProperty('image');
    expect(payload.meta).not.toHaveProperty('description');
  });

  it('sends a browser-like user-agent and follows redirects', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(htmlResponse('<title>T</title>'))
    );
    const handler = createUnfurlHandler(fetchMock);

    await handler(
      createFakeReq(`/?url=${encodeURIComponent('https://example.com/start')}`),
      createFakeRes()
    );

    const [target, init] = fetchMock.mock.calls[0];

    expect(target).toBe('https://example.com/start');
    expect(init?.redirect).toBe('follow');
    expect(init?.headers).toMatchObject({
      'user-agent': expect.stringContaining('BlokDevUnfurl') as unknown as string,
    });
  });

  it('responds with success: 0 when the url param is missing', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(htmlResponse('')));
    const handler = createUnfurlHandler(fetchMock);
    const res = createFakeRes();

    await handler(createFakeReq('/'), res);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(parsePayload(res)).toEqual({ success: 0 });
  });

  it('responds with success: 0 when the request url is undefined', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(htmlResponse('')));
    const handler = createUnfurlHandler(fetchMock);
    const res = createFakeRes();

    await handler(createFakeReq(undefined), res);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(parsePayload(res)).toEqual({ success: 0 });
  });

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'not a url'])(
    'responds with success: 0 for non-http(s) target %s',
    async (target) => {
      const fetchMock = vi.fn(() => Promise.resolve(htmlResponse('')));
      const handler = createUnfurlHandler(fetchMock);
      const res = createFakeRes();

      await handler(createFakeReq(`/?url=${encodeURIComponent(target)}`), res);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(parsePayload(res)).toEqual({ success: 0 });
    }
  );

  it('responds with success: 0 (never 500) when fetch rejects', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('DNS failure')));
    const handler = createUnfurlHandler(fetchMock);
    const res = createFakeRes();

    await handler(createFakeReq(`/?url=${encodeURIComponent('https://example.com')}`), res);

    expect(res.statusCode).toBe(200);
    expect(parsePayload(res)).toEqual({ success: 0 });
  });

  it('responds with success: 0 for a non-ok upstream status', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(htmlResponse('', { ok: false, status: 404 } as Partial<Response>))
    );
    const handler = createUnfurlHandler(fetchMock);
    const res = createFakeRes();

    await handler(createFakeReq(`/?url=${encodeURIComponent('https://example.com')}`), res);

    expect(parsePayload(res)).toEqual({ success: 0 });
  });

  it('responds with success: 0 for a non-HTML content-type', async () => {
    const jsonHeaders = {
      get: (name: string): string | null =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null,
    };
    const fetchMock = vi.fn(() =>
      Promise.resolve(htmlResponse('{}', { headers: jsonHeaders } as Partial<Response>))
    );
    const handler = createUnfurlHandler(fetchMock);
    const res = createFakeRes();

    await handler(createFakeReq(`/?url=${encodeURIComponent('https://example.com')}`), res);

    expect(parsePayload(res)).toEqual({ success: 0 });
  });

  /**
   * Some sites (YouTube) serve an empty shell page to unknown user-agents but
   * full OpenGraph metadata to link-preview crawlers, while others (Wikipedia)
   * 403 spoofed crawler UAs — so the handler retries with a crawler UA only
   * when the primary parse is missing title or image, and keeps whichever
   * parse is richer.
   */
  describe('crawler user-agent retry', () => {
    const shellHtml = '<title> - YouTube</title>';
    const fullHtml = `
      <meta property="og:title" content="Real Video Title">
      <meta property="og:description" content="Real description">
      <meta property="og:image" content="https://i.ytimg.com/vi/abc/maxresdefault.jpg">
    `;

    it('retries with a crawler user-agent when the primary parse lacks an image', async () => {
      const fetchMock = vi
        .fn<(url: string, init?: RequestInit) => Promise<Response>>()
        .mockResolvedValueOnce(htmlResponse(shellHtml))
        .mockResolvedValueOnce(htmlResponse(fullHtml));
      const handler = createUnfurlHandler(fetchMock);
      const res = createFakeRes();

      await handler(createFakeReq(`/?url=${encodeURIComponent('https://example.com/watch')}`), res);

      expect(fetchMock).toHaveBeenCalledTimes(2);

      const retryInit = fetchMock.mock.calls[1][1];

      expect(retryInit?.headers).toMatchObject({
        'user-agent': expect.stringContaining('facebookexternalhit') as unknown as string,
      });

      const payload = parsePayload(res);

      expect(payload.success).toBe(1);
      expect(payload.meta?.title).toBe('Real Video Title');
      expect(payload.meta?.image).toEqual({ url: 'https://i.ytimg.com/vi/abc/maxresdefault.jpg' });
    });

    it('keeps the primary metadata when the crawler retry is rejected upstream', async () => {
      const fetchMock = vi
        .fn<(url: string, init?: RequestInit) => Promise<Response>>()
        .mockResolvedValueOnce(htmlResponse('<title>Primary Title</title>'))
        .mockResolvedValueOnce(htmlResponse('', { ok: false, status: 403 } as Partial<Response>));
      const handler = createUnfurlHandler(fetchMock);
      const res = createFakeRes();

      await handler(createFakeReq(`/?url=${encodeURIComponent('https://example.com/page')}`), res);

      expect(fetchMock).toHaveBeenCalledTimes(2);

      const payload = parsePayload(res);

      expect(payload.success).toBe(1);
      expect(payload.meta?.title).toBe('Primary Title');
    });

    it('keeps the primary metadata when the retry parse is poorer', async () => {
      const fetchMock = vi
        .fn<(url: string, init?: RequestInit) => Promise<Response>>()
        .mockResolvedValueOnce(htmlResponse('<title>Primary Title</title>'))
        .mockResolvedValueOnce(htmlResponse(''));
      const handler = createUnfurlHandler(fetchMock);
      const res = createFakeRes();

      await handler(createFakeReq(`/?url=${encodeURIComponent('https://example.com/page')}`), res);

      const payload = parsePayload(res);

      expect(payload.success).toBe(1);
      expect(payload.meta?.title).toBe('Primary Title');
    });

    it('does not retry when the primary parse already has title and image', async () => {
      const fetchMock = vi
        .fn<(url: string, init?: RequestInit) => Promise<Response>>()
        .mockResolvedValue(htmlResponse(fullHtml));
      const handler = createUnfurlHandler(fetchMock);

      await handler(
        createFakeReq(`/?url=${encodeURIComponent('https://example.com/rich')}`),
        createFakeRes()
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe('unfurlPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers the /unfurl middleware on both dev and preview servers', () => {
    const plugin = unfurlPlugin();
    const use = vi.fn();
    const server = { middlewares: { use } };

    plugin.configureServer(server);
    plugin.configurePreviewServer(server);

    expect(plugin.name).toBe('blok-unfurl');
    expect(use).toHaveBeenCalledTimes(2);
    expect(use.mock.calls[0][0]).toBe('/unfurl');
    expect(use.mock.calls[1][0]).toBe('/unfurl');
    expect(typeof use.mock.calls[0][1]).toBe('function');
  });
});
