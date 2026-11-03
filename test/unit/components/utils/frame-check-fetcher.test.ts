import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFrameCheck } from '../../../../src/components/utils/frame-check-fetcher';
import { expandServerConfig } from '../../../../src/components/utils/server-config';

const respond = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe('createFrameCheck — client for the server\'s GET /frame-check', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', { origin: 'https://editor.example' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('asks the endpoint about the URL and returns its verdict only', async () => {
    fetchMock.mockResolvedValue(respond(200, {
      verdict: 'blocked',
      link: 'https://a.test/final',
      oembed: { title: 'x' },
    }));

    const check = createFrameCheck({ endpoint: 'https://blok.example.com/frame-check' });

    await expect(check('https://a.test/x?y=1')).resolves.toEqual({ verdict: 'blocked' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://blok.example.com/frame-check?url=https%3A%2F%2Fa.test%2Fx%3Fy%3D1&embedder=https%3A%2F%2Feditor.example',
      { headers: undefined }
    );
  });

  // A same-origin GET carries no Origin header, so the server needs the page's origin from the query.
  it('names the page\'s own origin as the embedder', async () => {
    fetchMock.mockResolvedValue(respond(200, { verdict: 'allowed' }));
    vi.stubGlobal('location', { origin: 'http://localhost:3000' });

    await createFrameCheck({ endpoint: '/api/blok/frame-check' })('https://a.test/');

    expect(fetchMock.mock.calls[0][0]).toBe('/api/blok/frame-check?url=https%3A%2F%2Fa.test%2F&embedder=http%3A%2F%2Flocalhost%3A3000');
  });

  it('names no embedder when the page has no real origin', async () => {
    fetchMock.mockResolvedValue(respond(200, { verdict: 'unknown' }));
    const check = createFrameCheck({ endpoint: '/frame-check' });

    vi.stubGlobal('location', { origin: 'null' });
    await check('https://a.test/');
    vi.stubGlobal('location', undefined);
    await check('https://a.test/');

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      '/frame-check?url=https%3A%2F%2Fa.test%2F',
      '/frame-check?url=https%3A%2F%2Fa.test%2F',
    ]);
  });

  it('sends headers, minting them per request when given a function', async () => {
    fetchMock.mockResolvedValue(respond(200, { verdict: 'allowed' }));

    const headers = vi.fn(async () => ({ Authorization: 'Bearer p' }));

    await createFrameCheck({ endpoint: '/frame-check', headers })('https://a.test/');

    expect(headers).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer p' } });
  });

  it('answers unknown for an error status, an odd verdict or a failed request', async () => {
    const check = createFrameCheck({ endpoint: '/frame-check' });

    fetchMock.mockResolvedValueOnce(respond(400, { verdict: 'blocked' }));
    await expect(check('https://a.test/')).resolves.toEqual({ verdict: 'unknown' });

    fetchMock.mockResolvedValueOnce(respond(200, { verdict: 'nope' }));
    await expect(check('https://a.test/')).resolves.toEqual({ verdict: 'unknown' });

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(check('https://a.test/')).resolves.toEqual({ verdict: 'unknown' });
  });
});

describe('expandServerConfig — linkPaste.checkEmbed', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', { origin: 'https://editor.example' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('defaults to the server\'s /frame-check and keeps the rest of linkPaste', async () => {
    fetchMock.mockResolvedValue(respond(200, { verdict: 'insecure' }));

    const result = expandServerConfig({ server: 'https://blok.example.com/', linkPaste: { allowGenericEmbed: true } });

    expect(result.linkPaste?.allowGenericEmbed).toBe(true);
    await expect(result.linkPaste?.checkEmbed?.('https://a.test/')).resolves.toEqual({ verdict: 'insecure' });
    expect(fetchMock.mock.calls[0][0])
      .toBe('https://blok.example.com/frame-check?url=https%3A%2F%2Fa.test%2F&embedder=https%3A%2F%2Feditor.example');
  });

  it('keeps a checkEmbed the host passed', () => {
    const mine = async (): Promise<{ verdict: 'allowed' }> => ({ verdict: 'allowed' });
    const result = expandServerConfig({ server: 'https://blok.example.com', linkPaste: { checkEmbed: mine } });

    expect(result.linkPaste?.checkEmbed).toBe(mine);
  });

  it('sends the same pass as link previews', async () => {
    const PASS = `x.${btoa(JSON.stringify({ exp: 4102444800 })).replace(/=+$/, '')}.y`;

    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/blok-ticket' ? respond(200, { ticket: PASS }) : respond(200, { verdict: 'allowed' }));

    const result = expandServerConfig({ server: 'https://blok.example.com', ticket: '/api/blok-ticket' });

    await result.linkPaste?.checkEmbed?.('https://a.test/');

    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/frame-check'));

    expect(call?.[1]).toEqual({ headers: { Authorization: `Bearer ${PASS}` } });
  });

  it('adds no check without a server', () => {
    expect(expandServerConfig({ linkPaste: {} }).linkPaste?.checkEmbed).toBeUndefined();
  });
});
