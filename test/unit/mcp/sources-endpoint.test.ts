// @vitest-environment node
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isMcpSurfaceError } from '../../../src/mcp/errors';
import { createEndpointSource } from '../../../src/mcp/sources/endpoint';

interface Seen {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: string;
}

type Answer = (request: Seen, response: ServerResponse) => void;

const FIXTURE_TIMEOUT_MS = 2000;
const AUTH = 'Fixture task11-dummy-token';
const emptyAnswer: Answer = (_request, response) => response.end();

const json = (response: ServerResponse, status: number, value: unknown): void => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
};

const codeOf = async (operation: () => unknown): Promise<string | undefined> => {
  try {
    await operation();

    return undefined;
  } catch (thrown: unknown) {
    return isMcpSurfaceError(thrown) ? thrown.agentError.code : `Non-surface error: ${String(thrown)}`;
  }
};

const closeOwnedServer = (fixture: Server): Promise<void> => new Promise((resolve, reject) => {
  let settled = false;
  const finish = (error?: Error): void => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timer);
    if (error === undefined || ('code' in error && error.code === 'ERR_SERVER_NOT_RUNNING')) {
      resolve();
    } else {
      reject(error);
    }
  };
  const timer = setTimeout(() => {
    fixture.closeAllConnections();
    finish(new Error('Owned HTTP fixture cleanup timed out'));
  }, FIXTURE_TIMEOUT_MS);

  try {
    fixture.close((error) => finish(error));
    fixture.closeAllConnections();
  } catch (thrown: unknown) {
    fixture.closeAllConnections();
    finish(thrown instanceof Error ? thrown : new Error(String(thrown)));
  }
});

describe('endpoint source', () => {
  let server: Server | undefined;
  let base = '';
  let answer: Answer = emptyAnswer;
  const seen: Seen[] = [];

  const observed = (index: number): Seen => {
    const request = seen[index];

    if (request === undefined) {
      throw new Error(`Owned HTTP fixture saw no request at index ${index}`);
    }

    return request;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    answer = emptyAnswer;
    seen.length = 0;
    base = '';
    const fixture = createServer((request, response) => {
      let body = '';

      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        body += chunk;
      });
      request.on('end', () => {
        const entry: Seen = {
          method: request.method ?? '',
          path: request.url ?? '',
          headers: request.headers,
          body,
        };

        seen.push(entry);
        answer(entry, response);
      });
    });

    server = fixture;
    const startup = new AbortController();

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error): void => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          fixture.off('error', onError);
          fixture.off('listening', onListening);
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        };
        const onError = (error: Error): void => finish(error);
        const onListening = (): void => finish();
        const timer = setTimeout(() => {
          startup.abort();
          finish(new Error('Owned HTTP fixture setup timed out'));
        }, FIXTURE_TIMEOUT_MS);

        fixture.once('error', onError);
        fixture.once('listening', onListening);
        try {
          fixture.listen({ port: 0, host: '127.0.0.1', signal: startup.signal });
        } catch (thrown: unknown) {
          finish(thrown instanceof Error ? thrown : new Error(String(thrown)));
        }
      });
      const address = fixture.address();

      if (address === null || typeof address === 'string') {
        throw new Error('Owned HTTP fixture has no TCP address');
      }
      base = `http://127.0.0.1:${address.port}/docs`;
    } catch (thrown: unknown) {
      startup.abort();
      server = undefined;
      await closeOwnedServer(fixture);
      throw thrown;
    }
  });

  afterEach(async () => {
    const fixture = server;

    server = undefined;
    answer = emptyAnswer;
    try {
      if (fixture !== undefined) {
        await closeOwnedServer(fixture);
      }
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('loads an envelope and sends dummy auth verbatim', async () => {
    answer = (_request, response) => json(response, 200, {
      data: {
        title: 'Loaded page',
        blocks: [{ id: 'load-a', type: 'paragraph', data: { text: '<b>Envelope content</b>' } }],
      },
      version: '7',
    });
    const source = createEndpointSource({ url: base, endpointAuth: AUTH });

    expect(await source.load('doc-1')).toEqual({
      raw: {
        title: 'Loaded page',
        blocks: [{ id: 'load-a', type: 'paragraph', data: { text: '<b>Envelope content</b>' } }],
      },
      version: '7',
    });
    expect(source.kind).toBe('endpoint');
    expect(observed(0)).toMatchObject({ method: 'GET', path: '/docs/doc-1' });
    expect(observed(0).headers.authorization).toBe(AUTH);
  });

  const loadBodies: Array<{ label: string; body: unknown; raw: unknown; version: string | null }> = [
    { label: 'null', body: null, raw: { blocks: [] }, version: null },
    { label: 'an empty envelope', body: { data: null, version: '0' }, raw: { blocks: [] }, version: '0' },
    {
      label: 'a bare document',
      body: { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'x' } }] },
      raw: { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'x' } }] },
      version: null,
    },
  ];

  it.each(loadBodies)('loads $label', async ({ body, raw, version }) => {
    answer = (_request, response) => json(response, 200, body);

    expect(await createEndpointSource({ url: base, endpointAuth: AUTH }).load('d')).toEqual({ raw, version });
  });

  it('percent-encodes the GET document id', async () => {
    answer = (_request, response) => json(response, 200, null);
    await createEndpointSource({ url: base, endpointAuth: AUTH }).load('../a b/%2e');

    expect(observed(0).path).toBe('/docs/..%2Fa%20b%2F%252e');
  });

  it.each([404, 500, 204])('maps GET %i to SOURCE_UNAVAILABLE', async (status) => {
    answer = (_request, response) => {
      response.writeHead(status);
      response.end();
    };

    expect(await codeOf(() => createEndpointSource({ url: base, endpointAuth: AUTH }).load('d'))).toBe('SOURCE_UNAVAILABLE');
  });

  const wrongLoadBodies: Array<{ label: string; body: unknown }> = [
    { label: 'a number', body: 7 },
    { label: 'an array', body: [] },
    { label: 'an object without blocks', body: { title: 'Not a document' } },
    { label: 'non-array blocks', body: { blocks: {} } },
    { label: 'an envelope with array data', body: { data: [], version: '7' } },
    { label: 'an envelope with missing-blocks data', body: { data: {}, version: '7' } },
    { label: 'an envelope with non-array blocks', body: { data: { blocks: null }, version: '7' } },
  ];

  it.each(wrongLoadBodies)('maps GET 200 with $label to SOURCE_UNAVAILABLE', async ({ body }) => {
    answer = (_request, response) => json(response, 200, body);

    expect(await codeOf(() => createEndpointSource({ url: base, endpointAuth: AUTH }).load('d'))).toBe('SOURCE_UNAVAILABLE');
  });

  it.each([
    { label: 'an empty body', text: '' },
    { label: 'non-JSON', text: 'not JSON' },
  ])('maps GET 200 with $label to SOURCE_UNAVAILABLE', async ({ text }) => {
    answer = (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(text);
    };

    expect(await codeOf(() => createEndpointSource({ url: base, endpointAuth: AUTH }).load('d'))).toBe('SOURCE_UNAVAILABLE');
  });

  it('PUTs bare JSON with auth and chains the returned version into the next save', async () => {
    answer = (_request, response) => json(response, 200, { version: '8' });
    const source = createEndpointSource({ url: base, endpointAuth: AUTH });
    const saved = await source.save('d', {
      title: 'First save',
      blocks: [{ id: 'save-a', type: 'paragraph', data: { text: 'First content' } }],
    }, { ifVersion: '7' });

    expect(saved).toEqual({ version: '8' });
    expect(observed(0)).toMatchObject({
      method: 'PUT',
      path: '/docs/d',
      body: '{"title":"First save","blocks":[{"id":"save-a","type":"paragraph","data":{"text":"First content"}}]}',
    });
    expect(observed(0).headers.authorization).toBe(AUTH);
    expect(observed(0).headers['content-type']).toBe('application/json');
    expect(observed(0).headers['blok-doc-version']).toBe('7');
    expect(await source.save('d', {
      title: 'Second save',
      blocks: [{ id: 'save-b', type: 'paragraph', data: { text: 'Second content' } }],
    }, { ifVersion: saved.version })).toEqual({ version: '8' });
    expect(observed(1).body).toBe(
      '{"title":"Second save","blocks":[{"id":"save-b","type":"paragraph","data":{"text":"Second content"}}]}',
    );
    expect(observed(1).headers['blok-doc-version']).toBe('8');
  });

  it('percent-encodes the PUT document id', async () => {
    answer = (_request, response) => json(response, 200, { version: '1' });
    await createEndpointSource({ url: base, endpointAuth: AUTH }).save('../a b/%2e', { blocks: [] }, { ifVersion: null });

    expect(observed(0).path).toBe('/docs/..%2Fa%20b%2F%252e');
  });

  it.each([200, 201, 204, 299])('keeps ifVersion on an empty PUT %i and omits only an unknown version header', async (status) => {
    answer = (_request, response) => {
      response.writeHead(status);
      response.end();
    };
    const source = createEndpointSource({ url: base, endpointAuth: AUTH });

    expect(await source.save('d', { blocks: [] }, { ifVersion: null })).toEqual({ version: null });
    expect(observed(0).headers['blok-doc-version']).toBeUndefined();
    expect(await source.save('d', { blocks: [] }, { ifVersion: '3' })).toEqual({ version: '3' });
    expect(observed(1).headers['blok-doc-version']).toBe('3');
  });

  it('maps PUT 409 to DOCUMENT_CHANGED', async () => {
    answer = (_request, response) => {
      response.writeHead(409);
      response.end();
    };

    expect(await codeOf(() => createEndpointSource({ url: base, endpointAuth: AUTH })
      .save('d', { blocks: [] }, { ifVersion: '1' }))).toBe('DOCUMENT_CHANGED');
  });

  it.each([400, 500])('maps PUT %i to SOURCE_UNAVAILABLE', async (status) => {
    answer = (_request, response) => {
      response.writeHead(status);
      response.end();
    };

    expect(await codeOf(() => createEndpointSource({ url: base, endpointAuth: AUTH })
      .save('d', { blocks: [] }, { ifVersion: '1' }))).toBe('SOURCE_UNAVAILABLE');
  });

  it.each(['load', 'save', 'list'] as const)('maps an injected fetch rejection during %s to SOURCE_UNAVAILABLE', async (operation) => {
    let rejectedCalls = 0;
    const rejectedFetch: typeof fetch = async () => {
      rejectedCalls += 1;
      throw new TypeError('Injected fixture fetch rejection');
    };

    expect(await codeOf(() => {
      const source = createEndpointSource({ url: base, endpointAuth: AUTH, list: `${base}-index` }, rejectedFetch);

      if (operation === 'load') {
        return source.load('d');
      }
      if (operation === 'save') {
        return source.save('d', { blocks: [] }, { ifVersion: null });
      }
      const list = source.list;

      if (list === undefined) {
        throw new Error('Configured source has no list method');
      }

      return list({ limit: 2 });
    })).toBe('SOURCE_UNAVAILABLE');
    expect(rejectedCalls).toBe(1);
    expect(seen).toHaveLength(0);
  });

  it('lists through the optional route with encoded query, limit and verbatim auth', async () => {
    answer = (_request, response) => json(response, 200, {
      documents: [{ id: 'a', title: 'A' }, { id: 'b' }],
      nextCursor: 'b',
    });
    const source = createEndpointSource({ url: base, endpointAuth: AUTH, list: `${base}-index` });
    const list = source.list;

    if (list === undefined) {
      throw new Error('Configured source has no list method');
    }

    expect(await list({ query: 'pl an', limit: 2 })).toEqual({
      documents: [{ id: 'a', title: 'A' }, { id: 'b', title: null }],
      nextCursor: 'b',
    });
    expect(observed(0)).toMatchObject({ method: 'GET', path: '/docs-index?query=pl+an&limit=2' });
    expect(observed(0).headers.authorization).toBe(AUTH);
  });

  it('forwards an encoded list cursor, omits an absent query and normalizes an absent nextCursor', async () => {
    answer = (_request, response) => json(response, 200, { documents: [{ id: 'b' }] });
    const source = createEndpointSource({ url: base, endpointAuth: AUTH, list: `${base}-index` });
    const list = source.list;

    if (list === undefined) {
      throw new Error('Configured source has no list method');
    }

    expect(await list({ cursor: 'next /?&', limit: 3 })).toEqual({
      documents: [{ id: 'b', title: null }],
      nextCursor: null,
    });
    const requestUrl = new URL(observed(0).path, base);

    expect(requestUrl.pathname).toBe('/docs-index');
    expect(requestUrl.searchParams.get('cursor')).toBe('next /?&');
    expect(requestUrl.searchParams.get('limit')).toBe('3');
    expect(requestUrl.searchParams.has('query')).toBe(false);
  });

  const wrongListBodies: Array<{ label: string; body: unknown }> = [
    { label: 'null', body: null },
    { label: 'an array', body: [] },
    { label: 'an object without documents', body: {} },
    { label: 'non-array documents', body: { documents: {} } },
  ];

  it.each(wrongListBodies)('maps list 200 with $label to SOURCE_UNAVAILABLE', async ({ body }) => {
    answer = (_request, response) => json(response, 200, body);

    expect(await codeOf(() => {
      const list = createEndpointSource({ url: base, endpointAuth: AUTH, list: `${base}-index` }).list;

      if (list === undefined) {
        throw new Error('Configured source has no list method');
      }

      return list({ limit: 2 });
    })).toBe('SOURCE_UNAVAILABLE');
  });

  it.each([
    { label: 'an empty body', text: '' },
    { label: 'non-JSON', text: 'not JSON' },
  ])('maps list 200 with $label to SOURCE_UNAVAILABLE', async ({ text }) => {
    answer = (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(text);
    };

    expect(await codeOf(() => {
      const list = createEndpointSource({ url: base, endpointAuth: AUTH, list: `${base}-index` }).list;

      if (list === undefined) {
        throw new Error('Configured source has no list method');
      }

      return list({ limit: 2 });
    })).toBe('SOURCE_UNAVAILABLE');
  });

  it.each([404, 500])('maps list %i to SOURCE_UNAVAILABLE', async (status) => {
    answer = (_request, response) => {
      response.writeHead(status);
      response.end();
    };

    expect(await codeOf(() => {
      const list = createEndpointSource({ url: base, endpointAuth: AUTH, list: `${base}-index` }).list;

      if (list === undefined) {
        throw new Error('Configured source has no list method');
      }

      return list({ limit: 2 });
    })).toBe('SOURCE_UNAVAILABLE');
  });

  it('has no list without a configured list route', () => {
    expect(createEndpointSource({ url: base, endpointAuth: AUTH }).list).toBeUndefined();
  });
  it.each(['.', '..', ''])('refuses id %j before any request, on load and save', async (id) => {
    const source = createEndpointSource({ url: base, endpointAuth: AUTH });

    expect(await codeOf(() => source.load(id))).toBe('INVALID_ARGS');
    expect(await codeOf(() => source.save(id, { blocks: [] }, { ifVersion: null }))).toBe('INVALID_ARGS');
    expect(seen).toHaveLength(0);
  });

  it.each(['load', 'save', 'list'] as const)('maps a hung %s to SOURCE_UNAVAILABLE after the timeout', async (operation) => {
    answer = () => undefined;
    const source = createEndpointSource({ url: base, endpointAuth: AUTH, list: `${base}-index`, timeoutMs: 50 });

    expect(await codeOf(() => {
      if (operation === 'load') {
        return source.load('d');
      }
      if (operation === 'save') {
        return source.save('d', { blocks: [] }, { ifVersion: null });
      }
      const list = source.list;

      if (list === undefined) {
        throw new Error('Configured source has no list method');
      }

      return list({ limit: 2 });
    })).toBe('SOURCE_UNAVAILABLE');
  });

  it('does not follow a redirect with the PUT body', async () => {
    answer = (request, response) => {
      if (request.path === '/docs/d') {
        response.writeHead(307, { Location: '/elsewhere/d' });
        response.end();

        return;
      }
      json(response, 200, { version: '1' });
    };

    expect(await codeOf(() => createEndpointSource({ url: base, endpointAuth: AUTH })
      .save('d', { blocks: [] }, { ifVersion: '1' }))).toBe('SOURCE_UNAVAILABLE');
    expect(seen.map((request) => request.path)).toEqual(['/docs/d']);
  });

  it.each(['load', 'save'] as const)('maps a body cut off mid-read during %s to SOURCE_UNAVAILABLE', async (operation) => {
    answer = (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '100' });
      response.write('{"blocks":', () => {
        setTimeout(() => response.socket?.destroy(), 20);
      });
    };
    const source = createEndpointSource({ url: base, endpointAuth: AUTH });

    expect(await codeOf(() => (operation === 'load'
      ? source.load('d')
      : source.save('d', { blocks: [] }, { ifVersion: '1' })))).toBe('SOURCE_UNAVAILABLE');
  });
  it.each(['load', 'save'] as const)('maps a body that stalls mid-read during %s to SOURCE_UNAVAILABLE after the timeout', async (operation) => {
    answer = (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '100' });
      response.write('{"blocks":');
    };
    const source = createEndpointSource({ url: base, endpointAuth: AUTH, timeoutMs: 50 });

    expect(await codeOf(() => (operation === 'load'
      ? source.load('d')
      : source.save('d', { blocks: [] }, { ifVersion: '1' })))).toBe('SOURCE_UNAVAILABLE');
  });
});
