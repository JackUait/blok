import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPassSource, createTicketSource } from '../../../../src/components/utils/access-pass';

// A pass whose payload declares exp = 1000 (seconds).
const PASS = `x.${btoa(JSON.stringify({ exp: 1000 })).replace(/=+$/, '')}.y`;

describe('createPassSource', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ticket: PASS }) });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches a pass and returns it as an Authorization header', async () => {
    const headers = await createPassSource({ endpoint: '/api/blok-ticket', now: () => 0 })();

    expect(headers).toEqual({ Authorization: `Bearer ${PASS}` });
    expect(fetchMock).toHaveBeenCalledWith('/api/blok-ticket', expect.objectContaining({ credentials: 'same-origin' }));
  });

  it('reuses a cached pass until it is close to expiring', async () => {
    const source = createPassSource({ endpoint: '/api/blok-ticket', now: () => 0 });

    await source();
    await source();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Refreshing only at the moment of expiry guarantees some requests race the
  // clock and arrive already invalid, so the pass is replaced early.
  it('refetches once the pass is within the refresh margin of expiry', async () => {
    let clock = 0;
    const source = createPassSource({ endpoint: '/api/blok-ticket', now: () => clock });

    await source();
    clock = 990_000; // 990s — inside the 30s margin before exp = 1000s
    await source();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('collapses concurrent callers onto a single request', async () => {
    const source = createPassSource({ endpoint: '/api/blok-ticket', now: () => 0 });

    await Promise.all([source(), source(), source()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws a message naming the endpoint when it answers non-ok', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    await expect(createPassSource({ endpoint: '/api/blok-ticket', now: () => 0 })())
      .rejects.toThrow(/\/api\/blok-ticket/);
  });

  it('throws when the endpoint answers without a ticket field', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await expect(createPassSource({ endpoint: '/api/blok-ticket', now: () => 0 })())
      .rejects.toThrow(/ticket/);
  });

  // A failed mint must not poison the source: the next call has to try again
  // rather than replay the rejection forever.
  it('retries after a failure instead of caching it', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    const source = createPassSource({ endpoint: '/api/blok-ticket', now: () => 0 });

    await expect(source()).rejects.toThrow('offline');
    await expect(source()).resolves.toEqual({ Authorization: `Bearer ${PASS}` });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // A pass whose payload cannot be read is treated as already expired, so it is
  // used once and never trusted to still be valid on the next call.
  it('does not cache a pass whose expiry cannot be read', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ticket: 'not.a.jwt' }) });

    const source = createPassSource({ endpoint: '/api/blok-ticket', now: () => 0 });

    await source();
    await source();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('createTicketSource', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ticket: PASS }) });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the raw ticket token rather than a headers object', async () => {
    const token = await createTicketSource('/api/blok-ticket', { now: () => 0 })();

    expect(token).toBe(PASS);
  });

  it('appends ?doc= when the endpoint carries no query string', async () => {
    await createTicketSource('/api/blok-ticket', { doc: 'doc-1', now: () => 0 })();

    expect(fetchMock).toHaveBeenCalledWith('/api/blok-ticket?doc=doc-1', expect.objectContaining({ credentials: 'same-origin' }));
  });

  it('appends &doc= when the endpoint already carries a query string', async () => {
    await createTicketSource('/api/blok-ticket?tenant=acme', { doc: 'doc-1', now: () => 0 })();

    expect(fetchMock).toHaveBeenCalledWith('/api/blok-ticket?tenant=acme&doc=doc-1', expect.objectContaining({ credentials: 'same-origin' }));
  });

  it('url-encodes the doc value', async () => {
    await createTicketSource('/api/blok-ticket', { doc: 'a b/c', now: () => 0 })();

    expect(fetchMock).toHaveBeenCalledWith('/api/blok-ticket?doc=a%20b%2Fc', expect.objectContaining({ credentials: 'same-origin' }));
  });
});
