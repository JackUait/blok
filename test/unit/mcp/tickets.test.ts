// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readTicketClaims } from '../../../src/components/utils/access-pass';
import { createTicketProvider } from '../../../src/mcp/auth/tickets';
import { isMcpSurfaceError } from '../../../src/mcp/errors';

const SECRET = 'x'.repeat(32);
const request = { documentId: 'doc-1', write: true, principal: 'alice', clientName: 'claude', actorId: 'agent:alice:claude' };
const jwt = (claims: Record<string, unknown>): string =>
  `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

const codeOf = async (promise: Promise<unknown>): Promise<string | undefined> =>
  promise.then(() => undefined, (thrown: unknown) => (isMcpSurfaceError(thrown) ? thrown.agentError.code : String(thrown)));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('secret tickets', () => {
  it('mint user = actor id, never the human, scoped to the doc, 30 minutes', async () => {
    const source = await createTicketProvider({ kind: 'secret', secret: SECRET })(request);
    const claims = readTicketClaims(await source());

    expect(claims).toMatchObject({ user: 'agent:alice:claude', doc: 'doc-1', write: true });
    expect(claims?.user).not.toBe('alice');
    const exp = claims?.exp;

    expect(typeof exp).toBe('number');
    expect(typeof exp === 'number' ? exp - Math.floor(Date.now() / 1000) : 0).toBeGreaterThan(1790);
  });

  it('follow the write flag', async () => {
    const source = await createTicketProvider({ kind: 'secret', secret: SECRET })({ ...request, write: false });

    expect(readTicketClaims(await source())?.write).toBe(false);
  });
});

describe('ticket URL', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
  });

  const answer = (status: number, body: unknown): void => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
  };

  it('posts who and what to the host with the host token only', async () => {
    answer(200, { ticket: jwt({ user: 'agent:alice:claude', doc: 'doc-1', write: true, exp: 2_000_000_000 }) });
    const source = await createTicketProvider({ kind: 'url', url: 'https://app/mcp-tickets', hostToken: 'host-t' }, fetchMock)(request);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const body = init?.body;

    expect(url).toBe('https://app/mcp-tickets');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer host-t');
    expect(typeof body === 'string' ? JSON.parse(body) : body)
      .toEqual({ doc: 'doc-1', write: true, principal: 'alice', clientName: 'claude', actorId: 'agent:alice:claude' });
    expect(readTicketClaims(await source())?.user).toBe('agent:alice:claude');
  });

  it('refuses a ticket minted for the human with FORBIDDEN', async () => {
    answer(200, { ticket: jwt({ user: 'alice', doc: 'doc-1', exp: 2_000_000_000 }) });
    expect(await codeOf(createTicketProvider({ kind: 'url', url: 'https://app/t', hostToken: 'h' }, fetchMock)(request))).toBe('FORBIDDEN');
  });

  it('refuses a ticket for another document', async () => {
    answer(200, { ticket: jwt({ user: 'agent:alice:claude', doc: 'other', exp: 2_000_000_000 }) });
    expect(await codeOf(createTicketProvider({ kind: 'url', url: 'https://app/t', hostToken: 'h' }, fetchMock)(request))).toBe('FORBIDDEN');
  });

  it.each([[401, 'FORBIDDEN'], [403, 'FORBIDDEN'], [500, 'SOURCE_UNAVAILABLE']])('maps host %i to %s', async (status, code) => {
    answer(status, {});
    expect(await codeOf(createTicketProvider({ kind: 'url', url: 'https://app/t', hostToken: 'h' }, fetchMock)(request))).toBe(code);
  });

  it('maps an unreachable host and an answer without a ticket to SOURCE_UNAVAILABLE', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('down'));
    answer(200, { nope: true });
    const provider = createTicketProvider({ kind: 'url', url: 'https://app/t', hostToken: 'h' }, fetchMock);

    expect(await codeOf(provider(request))).toBe('SOURCE_UNAVAILABLE');
    expect(await codeOf(provider(request))).toBe('SOURCE_UNAVAILABLE');
  });

  it('caches until 30 s before expiry and refreshes on forceRefresh', async () => {
    const nowSeconds = 1_000_000;
    const ticket = jwt({ user: 'agent:alice:claude', doc: 'doc-1', exp: nowSeconds + 600 });

    answer(200, { ticket });
    answer(200, { ticket });
    const source = await createTicketProvider({ kind: 'url', url: 'https://app/t', hostToken: 'h' }, fetchMock, () => nowSeconds * 1000)(request);

    await source();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await source({ forceRefresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fetches again within 30 s of expiry', async () => {
    const clock = { ms: 1_000_000_000 };
    const ticket = jwt({ user: 'agent:alice:claude', doc: 'doc-1', exp: clock.ms / 1000 + 60 });

    answer(200, { ticket });
    answer(200, { ticket });
    const source = await createTicketProvider({ kind: 'url', url: 'https://app/t', hostToken: 'h' }, fetchMock, () => clock.ms)(request);

    clock.ms += 31_000;
    await source();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
