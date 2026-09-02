// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createUnfurlHandler } from '../../../scripts/unfurl/vite-plugin-unfurl.mjs';
import type {
  UnfurlRequest,
  UnfurlResponse,
} from '../../../scripts/unfurl/vite-plugin-unfurl.mjs';

type Address = {
  address: string;
  family: 4 | 6;
};

type ResponseBody = AsyncIterable<Uint8Array> & {
  destroy?: () => void;
};

type RequestResult = {
  statusCode: number;
  headers: Record<string, string | undefined>;
  body: ResponseBody;
};

type GuardedFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

type GuardedFetchFactory = (options: {
  lookup: (host: string) => Promise<Address[]>;
  request: (
    target: URL,
    address: Address,
    init: RequestInit,
  ) => Promise<RequestResult>;
}) => GuardedFetch;

const loadFactory = async (): Promise<GuardedFetchFactory> => {
  const module = await import(
    '../../../scripts/unfurl/guarded-fetch.mjs'
  ) as unknown as {
    createGuardedFetch: GuardedFetchFactory;
  };

  return module.createGuardedFetch;
};

const body = (...chunks: Uint8Array[]): ResponseBody => ({
  async *[Symbol.asyncIterator]() {
    yield* chunks;
  },
});

const response = (
  statusCode: number,
  headers: Record<string, string | undefined> = {},
  chunks: Uint8Array[] = [],
): RequestResult => ({
  statusCode,
  headers,
  body: body(...chunks),
});

describe('guarded development unfurl fetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the pinned address shape requested by Node', async () => {
    const module = await import(
      '../../../scripts/unfurl/guarded-fetch.mjs'
    ) as unknown as {
      createPinnedLookup: (address: Address) => (
        hostname: string,
        options: { all?: boolean },
        callback: (...args: unknown[]) => void,
      ) => void;
    };
    const address = { address: '93.184.216.34', family: 4 } as const;
    const lookup = module.createPinnedLookup(address);
    const allCallback = vi.fn();
    const singleCallback = vi.fn();

    lookup('public.example', { all: true }, allCallback);
    lookup('public.example', { all: false }, singleCallback);

    expect(allCallback).toHaveBeenCalledWith(null, [address]);
    expect(singleCallback).toHaveBeenCalledWith(null, address.address, address.family);
  });

  it.each([
    ['loopback IPv4', '127.0.0.1', 4],
    ['private IPv4', '10.0.0.1', 4],
    ['cloud metadata IPv4', '169.254.169.254', 4],
    ['loopback IPv6', '::1', 6],
    ['private IPv6', 'fc00::1', 6],
    ['documentation IPv6', '2001:db8::1', 6],
  ] as const)('blocks a %s DNS result before opening a socket', async (
    _label,
    address,
    family,
  ) => {
    const createGuardedFetch = await loadFactory();
    const request = vi.fn();
    const guardedFetch = createGuardedFetch({
      lookup: vi.fn(async (): Promise<Address[]> => [{ address, family }]),
      request,
    });

    await expect(guardedFetch('https://public.example/page')).rejects.toThrow(
      'not permitted',
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects a mixed public and private DNS answer', async () => {
    const createGuardedFetch = await loadFactory();
    const request = vi.fn();
    const guardedFetch = createGuardedFetch({
      lookup: vi.fn(async (): Promise<Address[]> => [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
      request,
    });

    await expect(guardedFetch('https://public.example/page')).rejects.toThrow(
      'not permitted',
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('pins a public DNS answer into the request', async () => {
    const createGuardedFetch = await loadFactory();
    const pinnedAddress = { address: '93.184.216.34', family: 4 } as const;
    const request = vi.fn(async () => response(
      200,
      { 'content-type': 'text/html' },
      [Buffer.from('<title>Safe</title>')],
    ));
    const guardedFetch = createGuardedFetch({
      lookup: vi.fn(async (): Promise<Address[]> => [pinnedAddress]),
      request,
    });

    const result = await guardedFetch('https://public.example/page');

    expect(await result.text()).toBe('<title>Safe</title>');
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'public.example' }),
      pinnedAddress,
      expect.any(Object),
    );
  });

  it('revalidates a redirect before making the next request', async () => {
    const createGuardedFetch = await loadFactory();
    const request = vi.fn(async () => response(
      302,
      { location: 'http://169.254.169.254/latest/meta-data' },
    ));
    const guardedFetch = createGuardedFetch({
      lookup: vi.fn(async (): Promise<Address[]> => [
        { address: '93.184.216.34', family: 4 },
      ]),
      request,
    });

    await expect(guardedFetch('https://public.example/start')).rejects.toThrow(
      'not permitted',
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('stops reading after the bounded HTML prefix', async () => {
    const createGuardedFetch = await loadFactory();
    let chunksRead = 0;
    const streamingBody: ResponseBody = {
      async *[Symbol.asyncIterator]() {
        while (chunksRead < 100) {
          chunksRead += 1;
          yield Buffer.alloc(64 * 1024, 0x61);
        }
      },
    };
    const guardedFetch = createGuardedFetch({
      lookup: vi.fn(async (): Promise<Address[]> => [
        { address: '93.184.216.34', family: 4 },
      ]),
      request: vi.fn(async () => ({
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        body: streamingBody,
      })),
    });

    const result = await guardedFetch('https://public.example/large');
    const html = await result.text();

    expect(Buffer.byteLength(html)).toBeLessThanOrEqual(1.5 * 1024 * 1024);
    expect(chunksRead).toBeLessThan(100);
  });

  it('rejects private literal targets without invoking the injected fetch', async () => {
    const fetchMock = vi.fn(async () => new Response('<title>unsafe</title>', {
      headers: { 'content-type': 'text/html' },
    }));
    const handler = createUnfurlHandler(fetchMock);
    const request: UnfurlRequest = {
      url: `/?url=${encodeURIComponent('http://127.0.0.1/admin')}`,
    };
    const result: UnfurlResponse & { body: string } = {
      body: '',
      statusCode: 0,
      setHeader: vi.fn(),
      end(value) {
        this.body = value;
      },
    };

    await handler(request, result);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(result.body)).toEqual({ success: 0 });
  });
});
