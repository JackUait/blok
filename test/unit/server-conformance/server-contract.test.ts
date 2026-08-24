// @vitest-environment node

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import {
  runServerCommand,
  startServer,
  type RunningServer,
} from './run-against';
import { sendRequest } from './http-client';

const ALLOWED_ORIGIN = 'https://app.example.com';
const DISALLOWED_ORIGIN = 'https://evil.example.net';

interface TicketFixture {
  compatible: string;
  expired: string;
  malformed: string;
  noncanonicalHeaderTicket: string;
  secret: string;
  tampered: string;
  userTwo: string;
}

function isTicketFixture(value: unknown): value is TicketFixture {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const fixture = value as Record<string, unknown>;

  return ['compatible', 'expired', 'malformed', 'noncanonicalHeaderTicket', 'secret', 'tampered', 'userTwo']
    .every((key) => typeof fixture[key] === 'string');
}

function loadTickets(): TicketFixture {
  const fixturePath = fileURLToPath(new URL('./fixtures/tickets.json', import.meta.url));
  const fixture: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));

  if (!isTicketFixture(fixture)) {
    throw new Error('Server ticket fixture has an invalid shape');
  }

  return fixture;
}

const tickets = loadTickets();

function serverArgs(...args: string[]): string[] {
  return ['--listen', '127.0.0.1:0', ...args];
}

function ticketArgs(...args: string[]): string[] {
  return serverArgs(
    '--auth',
    'ticket',
    '--secret',
    tickets.secret,
    '--allow-origin',
    ALLOWED_ORIGIN,
    ...args,
  );
}

async function withServer(
  args: string[],
  run: (server: RunningServer) => Promise<void>,
): Promise<void> {
  const server = await startServer({ args });

  try {
    await run(server);
  } finally {
    await server.stop();
  }
}

function requestHeaders(origin?: string, token?: string): Record<string, string> {
  const headers: Record<string, string> = {};

  if (origin !== undefined) {
    headers.Origin = origin;
  }
  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function expectNoCors(headers: Record<string, string>): void {
  expect(headers['access-control-allow-origin']).toBeUndefined();
  expect(headers.vary).toBeUndefined();
}

it('applies the total request deadline while a response keeps sending bytes', async () => {
  const server = createServer((_request, response) => {
    const chunks = setInterval(() => response.write('.'), 20);
    const finish = setTimeout(() => response.end(), 300);

    response.once('close', () => {
      clearInterval(chunks);
      clearTimeout(finish);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();

  if (address === null || typeof address === 'string') {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    });
    throw new Error('Could not allocate a test HTTP port');
  }

  try {
    await expect(sendRequest('GET', new URL(`http://127.0.0.1:${address.port}`), {
      timeoutMs: 100,
    })).rejects.toThrow('HTTP request timed out after 100 ms');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    });
  }
});

it('returns the exact ungated health response without CORS', async () => {
  await withServer(ticketArgs('--storage-dir', ''), async (server) => {
    const response = await server.request('GET', '/health', {
      headers: requestHeaders(ALLOWED_ORIGIN),
      parseJson: true,
    });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/json');
    expect(response.text).toBe('{"status":"ok","version":"dev"}\n');
    expect(response.json).toEqual({ status: 'ok', version: 'dev' });
    expectNoCors(response.headers);
  });
});

it('returns the Go method and unknown-route responses', async () => {
  await withServer(serverArgs('--storage-dir', ''), async (server) => {
    const wrongMethod = await server.request('POST', '/health');
    const unknownRoute = await server.request('GET', '/missing');
    const unregisteredUpload = await server.request('POST', '/upload');

    expect(wrongMethod).toMatchObject({
      status: 405,
      headers: {
        allow: 'GET, HEAD',
        'content-type': 'text/plain; charset=utf-8',
      },
      text: 'Method Not Allowed\n',
    });
    expect(unknownRoute).toMatchObject({
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      text: '404 page not found\n',
    });
    expect(unregisteredUpload).toMatchObject({
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      text: '404 page not found\n',
    });
  });
});

it('unregisters both outbound routes when unfurling is disabled', async () => {
  await withServer(serverArgs('--no-unfurl'), async (server) => {
    const requests = await Promise.all([
      server.request('GET', '/unfurl'),
      server.request('OPTIONS', '/unfurl', { headers: requestHeaders(ALLOWED_ORIGIN) }),
      server.request('POST', '/upload-by-url'),
      server.request('OPTIONS', '/upload-by-url', { headers: requestHeaders(ALLOWED_ORIGIN) }),
    ]);

    for (const response of requests) {
      expect(response).toMatchObject({
        status: 404,
        text: '404 page not found\n',
      });
    }
  });
});

it('unregisters both upload routes when storage is absent', async () => {
  await withServer(serverArgs('--storage-dir', ''), async (server) => {
    const requests = await Promise.all([
      server.request('POST', '/upload'),
      server.request('OPTIONS', '/upload', { headers: requestHeaders(ALLOWED_ORIGIN) }),
      server.request('POST', '/upload-by-url'),
      server.request('OPTIONS', '/upload-by-url', { headers: requestHeaders(ALLOWED_ORIGIN) }),
    ]);

    for (const response of requests) {
      expect(response).toMatchObject({
        status: 404,
        text: '404 page not found\n',
      });
    }
  });
});

it.each([
  {
    name: 'none',
    args: serverArgs('--auth', 'none', '--allow-origin', ALLOWED_ORIGIN, '--rate-limit', '0'),
    token: undefined,
    rejectedRequest: {
      contentType: 'application/json',
      status: 400,
      text: '{"success":0}\n',
    },
  },
  {
    name: 'proxy',
    args: serverArgs('--auth', 'proxy', '--allow-origin', ALLOWED_ORIGIN, '--rate-limit', '0'),
    token: undefined,
    rejectedRequest: {
      contentType: 'application/json',
      status: 400,
      text: '{"success":0}\n',
    },
  },
  {
    name: 'ticket',
    args: ticketArgs('--rate-limit', '0'),
    token: tickets.compatible,
    rejectedRequest: {
      contentType: 'text/plain; charset=utf-8',
      status: 403,
      text: 'origin not allowed\n',
    },
  },
])('$name mode handles allowed, disallowed, and missing origins', async (testCase) => {
  await withServer(testCase.args, async (server) => {
    const allowed = await server.request('GET', '/unfurl', {
      headers: requestHeaders(ALLOWED_ORIGIN, testCase.token),
      parseJson: true,
    });

    expect(allowed).toMatchObject({
      status: 400,
      headers: { 'access-control-allow-origin': ALLOWED_ORIGIN },
      json: { success: 0 },
      text: '{"success":0}\n',
    });
    expect(allowed.rawHeaders.vary).toEqual(['Origin']);

    for (const [name, origin] of [
      ['disallowed', DISALLOWED_ORIGIN],
      ['missing', undefined],
    ] as const) {
      const rejectedRequest = await server.request('GET', '/unfurl', {
        headers: requestHeaders(origin, testCase.token),
      });
      const rejectedPreflight = await server.request('OPTIONS', '/unfurl', {
        headers: {
          ...requestHeaders(origin),
          'Access-Control-Request-Method': 'GET',
        },
      });

      expect(rejectedRequest, name).toMatchObject({
        status: testCase.rejectedRequest.status,
        headers: { 'content-type': testCase.rejectedRequest.contentType },
        text: testCase.rejectedRequest.text,
      });
      expectNoCors(rejectedRequest.headers);
      expect(rejectedPreflight, name).toMatchObject({
        status: 403,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        text: 'origin not allowed\n',
      });
      expectNoCors(rejectedPreflight.headers);
    }
  });
});

it('answers anonymous preflights with the exact CORS headers without spending a ticket limit', async () => {
  await withServer(ticketArgs('--rate-limit', '1', '--storage-dir', ''), async (server) => {
    for (let index = 0; index < 3; index += 1) {
      const preflight = await server.request('OPTIONS', '/unfurl', {
        headers: {
          ...requestHeaders(ALLOWED_ORIGIN),
          'Access-Control-Request-Headers': 'authorization, x-tenant-id',
          'Access-Control-Request-Method': 'GET',
        },
      });

      expect(preflight.status).toBe(204);
      expect(preflight.text).toBe('');
      expect(preflight.headers).toMatchObject({
        'access-control-allow-headers': 'authorization, x-tenant-id',
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-origin': ALLOWED_ORIGIN,
        'access-control-max-age': '600',
      });
      expect(preflight.rawHeaders.vary).toEqual(['Access-Control-Request-Headers', 'Origin']);
    }

    const firstRequest = await server.request('GET', '/unfurl', {
      headers: requestHeaders(ALLOWED_ORIGIN, tickets.compatible),
      parseJson: true,
    });
    const limitedRequest = await server.request('GET', '/unfurl', {
      headers: requestHeaders(ALLOWED_ORIGIN, tickets.compatible),
    });

    expect(firstRequest).toMatchObject({ status: 400, json: { success: 0 } });
    expect(limitedRequest).toMatchObject({
      status: 429,
      headers: { 'access-control-allow-origin': ALLOWED_ORIGIN },
      text: 'rate limit exceeded\n',
    });
  });
});

it('accepts the fixed compatible ticket and rejects malformed ticket cases', async () => {
  await withServer(ticketArgs('--rate-limit', '0', '--storage-dir', ''), async (server) => {
    const compatible = await server.request('GET', '/unfurl', {
      headers: requestHeaders(ALLOWED_ORIGIN, tickets.compatible),
      parseJson: true,
    });

    expect(compatible).toMatchObject({
      status: 400,
      json: { success: 0 },
      text: '{"success":0}\n',
    });

    for (const [name, token, text] of [
      ['missing', undefined, 'missing pass\n'],
      ['malformed', tickets.malformed, 'invalid pass\n'],
      ['expired', tickets.expired, 'invalid pass\n'],
      ['tampered', tickets.tampered, 'invalid pass\n'],
    ] as const) {
      const response = await server.request('GET', '/unfurl', {
        headers: requestHeaders(ALLOWED_ORIGIN, token),
      });

      expect(response).toMatchObject({
        status: 401,
        headers: { 'access-control-allow-origin': ALLOWED_ORIGIN },
        text,
      });
      expect(response.rawHeaders.vary).toEqual(['Origin']);
      expect(response.text, name).toBe(text);
    }
  });
});

it('preserves Go ticket header and authorization grammar', async () => {
  await withServer(ticketArgs('--rate-limit', '0', '--storage-dir', ''), async (server) => {
    for (const testCase of [
      {
        name: 'a correctly signed ticket with a reordered header',
        authorization: `Bearer ${tickets.noncanonicalHeaderTicket}`,
        status: 401,
        contentType: 'text/plain; charset=utf-8',
        text: 'invalid pass\n',
      },
      {
        name: 'a bare compatible ticket',
        authorization: tickets.compatible,
        status: 400,
        contentType: 'application/json',
        text: '{"success":0}\n',
      },
      {
        name: 'a lowercase bearer prefix',
        authorization: `bearer ${tickets.compatible}`,
        status: 401,
        contentType: 'text/plain; charset=utf-8',
        text: 'invalid pass\n',
      },
    ]) {
      const response = await server.request('GET', '/unfurl', {
        headers: {
          ...requestHeaders(ALLOWED_ORIGIN),
          Authorization: testCase.authorization,
        },
        parseJson: testCase.status === 400,
      });

      expect(response, testCase.name).toMatchObject({
        status: testCase.status,
        headers: {
          'access-control-allow-origin': ALLOWED_ORIGIN,
          'content-type': testCase.contentType,
        },
        text: testCase.text,
      });
      expect(response.rawHeaders.vary).toEqual(['Origin']);
      if (testCase.status === 400) {
        expect(response.json).toEqual({ success: 0 });
      }
    }
  });
});

it('runs origin checks before ticket checks and ticket checks before the limiter', async () => {
  await withServer(ticketArgs('--rate-limit', '1', '--storage-dir', ''), async (server) => {
    const forbiddenOrigin = await server.request('GET', '/unfurl', {
      headers: requestHeaders(DISALLOWED_ORIGIN),
    });
    const rejectedTicket = await server.request('GET', '/unfurl', {
      headers: requestHeaders(ALLOWED_ORIGIN, tickets.malformed),
    });
    const allowedTicket = await server.request('GET', '/unfurl', {
      headers: requestHeaders(ALLOWED_ORIGIN, tickets.compatible),
      parseJson: true,
    });
    const limitedTicket = await server.request('GET', '/unfurl', {
      headers: requestHeaders(ALLOWED_ORIGIN, tickets.compatible),
    });

    expect(forbiddenOrigin).toMatchObject({
      status: 403,
      text: 'origin not allowed\n',
    });
    expectNoCors(forbiddenOrigin.headers);
    expect(rejectedTicket).toMatchObject({
      status: 401,
      headers: { 'access-control-allow-origin': ALLOWED_ORIGIN },
      text: 'invalid pass\n',
    });
    expect(allowedTicket).toMatchObject({
      status: 400,
      json: { success: 0 },
    });
    expect(limitedTicket).toMatchObject({
      status: 429,
      headers: { 'access-control-allow-origin': ALLOWED_ORIGIN },
      text: 'rate limit exceeded\n',
    });
  });
});

it('uses the default ticket limit of 60 and an explicit small limit', async () => {
  await withServer(ticketArgs('--storage-dir', ''), async (server) => {
    for (let index = 0; index < 60; index += 1) {
      const response = await server.request('GET', '/unfurl', {
        headers: requestHeaders(ALLOWED_ORIGIN, tickets.compatible),
      });

      expect(response.status).toBe(400);
    }

    expect(await server.request('GET', '/unfurl', {
      headers: requestHeaders(ALLOWED_ORIGIN, tickets.compatible),
    })).toMatchObject({
      status: 429,
      text: 'rate limit exceeded\n',
    });
  });

  await withServer(ticketArgs('--storage-dir', '', '--rate-limit', '2'), async (server) => {
    for (let index = 0; index < 2; index += 1) {
      expect((await server.request('GET', '/unfurl', {
        headers: requestHeaders(ALLOWED_ORIGIN, tickets.compatible),
      })).status).toBe(400);
    }

    expect((await server.request('GET', '/unfurl', {
      headers: requestHeaders(ALLOWED_ORIGIN, tickets.compatible),
    }))).toMatchObject({
      status: 429,
      text: 'rate limit exceeded\n',
    });
  });
});

it('uses separate fixed-window buckets for ticket users and disables zero limits', async () => {
  await withServer(ticketArgs('--rate-limit', '1', '--storage-dir', ''), async (server) => {
    expect((await server.request('GET', '/unfurl', {
      headers: requestHeaders(ALLOWED_ORIGIN, tickets.compatible),
    })).status).toBe(400);
    expect((await server.request('GET', '/unfurl', {
      headers: requestHeaders(ALLOWED_ORIGIN, tickets.compatible),
    }))).toMatchObject({
      status: 429,
      text: 'rate limit exceeded\n',
    });
    expect((await server.request('GET', '/unfurl', {
      headers: requestHeaders(ALLOWED_ORIGIN, tickets.userTwo),
    })).status).toBe(400);
  });

  await withServer(ticketArgs('--rate-limit', '0', '--storage-dir', ''), async (server) => {
    for (let index = 0; index < 3; index += 1) {
      expect((await server.request('GET', '/unfurl', {
        headers: requestHeaders(ALLOWED_ORIGIN, tickets.compatible),
      })).status).toBe(400);
    }
  });
});

it('resets a ticket rate-limit bucket after its fixed one-minute window', async () => {
  await withServer(ticketArgs('--rate-limit', '1', '--storage-dir', ''), async (server) => {
    const firstRequestStartedAt = Date.now();

    expect((await server.request('GET', '/unfurl', {
      headers: requestHeaders(ALLOWED_ORIGIN, tickets.compatible),
    })).status).toBe(400);
    expect((await server.request('GET', '/unfurl', {
      headers: requestHeaders(ALLOWED_ORIGIN, tickets.compatible),
    })).status).toBe(429);

    const deadline = firstRequestStartedAt + 65_000;
    let response = await server.request('GET', '/unfurl', {
      headers: requestHeaders(ALLOWED_ORIGIN, tickets.compatible),
    });

    while (response.status === 429 && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      response = await server.request('GET', '/unfurl', {
        headers: requestHeaders(ALLOWED_ORIGIN, tickets.compatible),
      });
    }

    const elapsed = Date.now() - firstRequestStartedAt;

    expect(response).toMatchObject({ status: 400, text: '{"success":0}\n' });
    expect(elapsed).toBeGreaterThanOrEqual(59_000);
    expect(elapsed).toBeLessThanOrEqual(65_000);
  });
}, 70_000);

it('reads BLOK_SECRET and lets an explicit secret override it', async () => {
  const fromEnvironment = await startServer({
    args: serverArgs(
      '--auth',
      'ticket',
      '--allow-origin',
      ALLOWED_ORIGIN,
      '--rate-limit',
      '0',
      '--storage-dir',
      '',
    ),
    env: { BLOK_SECRET: tickets.secret },
  });

  try {
    expect((await fromEnvironment.request('GET', '/unfurl', {
      headers: requestHeaders(ALLOWED_ORIGIN, tickets.compatible),
    })).status).toBe(400);
  } finally {
    await fromEnvironment.stop();
  }

  const fromFlag = await startServer({
    args: ticketArgs('--rate-limit', '0', '--storage-dir', ''),
    env: { BLOK_SECRET: 'a-different-secret-with-at-least-32-characters' },
  });

  try {
    expect((await fromFlag.request('GET', '/unfurl', {
      headers: requestHeaders(ALLOWED_ORIGIN, tickets.compatible),
    })).status).toBe(400);
  } finally {
    await fromFlag.stop();
  }
});

it.each([
  {
    name: 'help',
    args: ['--help'],
    exitCode: 0,
    stderr: 'Usage of blok-server:',
    env: undefined,
  },
  {
    name: 'unknown flag',
    args: ['--not-a-real-flag'],
    exitCode: 2,
    stderr: 'flag provided but not defined: -not-a-real-flag',
    env: undefined,
  },
  {
    name: 'unknown auth mode',
    args: ['--auth', 'unknown'],
    exitCode: 1,
    stderr: '--auth must be none, proxy, or ticket (got "unknown")',
    env: undefined,
  },
  {
    name: 'non-loopback anonymous listener',
    args: ['--listen', '0.0.0.0:4000'],
    exitCode: 1,
    stderr: '--auth none',
    env: undefined,
  },
  {
    name: 'short ticket secret',
    args: ['--auth', 'ticket', '--secret', 'short', '--allow-origin', ALLOWED_ORIGIN],
    exitCode: 1,
    stderr: '--secret must be at least 32 characters (got 5)',
    env: undefined,
  },
  {
    name: 'missing ticket origin',
    args: ['--auth', 'ticket', '--secret', tickets.secret],
    exitCode: 1,
    stderr: 'a public service needs --allow-origin',
    env: undefined,
  },
  {
    name: 'S3 without endpoint',
    args: ['--s3-bucket', 'blok'],
    exitCode: 1,
    stderr: '--s3-bucket needs --s3-endpoint',
    env: undefined,
  },
  {
    name: 'S3 with a malformed endpoint',
    args: [
      '--s3-bucket',
      'blok',
      '--s3-endpoint',
      's3.example.test',
      '--s3-region',
      'eu-central-1',
      '--s3-bucket-url',
      'https://uploads.example.test',
    ],
    exitCode: 1,
    stderr: '--s3-endpoint must be a full URL with a scheme and a host',
    env: {
      BLOK_S3_ACCESS_KEY: 'access-key',
      BLOK_S3_SECRET_KEY: 'secret-key',
    },
  },
  {
    name: 'S3 without region',
    args: [
      '--s3-bucket',
      'blok',
      '--s3-endpoint',
      'https://s3.example.test',
      '--s3-bucket-url',
      'https://uploads.example.test',
    ],
    exitCode: 1,
    stderr: '--s3-bucket needs --s3-region',
    env: {
      BLOK_S3_ACCESS_KEY: 'access-key',
      BLOK_S3_SECRET_KEY: 'secret-key',
    },
  },
  {
    name: 'S3 without bucket URL',
    args: [
      '--s3-bucket',
      'blok',
      '--s3-endpoint',
      'https://s3.example.test',
      '--s3-region',
      'eu-central-1',
    ],
    exitCode: 1,
    stderr: '--s3-bucket needs --s3-bucket-url',
    env: {
      BLOK_S3_ACCESS_KEY: 'access-key',
      BLOK_S3_SECRET_KEY: 'secret-key',
    },
  },
  {
    name: 'S3 without credentials',
    args: [
      '--s3-bucket',
      'blok',
      '--s3-endpoint',
      'https://s3.example.test',
      '--s3-region',
      'eu-central-1',
      '--s3-bucket-url',
      'https://uploads.example.test',
    ],
    exitCode: 1,
    stderr: 'BLOK_S3_ACCESS_KEY and BLOK_S3_SECRET_KEY',
    env: {
      BLOK_S3_ACCESS_KEY: '',
      BLOK_S3_SECRET_KEY: '',
    },
  },
  {
    name: 'S3 with invalid addressing',
    args: [
      '--s3-bucket',
      'blok',
      '--s3-endpoint',
      'https://s3.example.test',
      '--s3-region',
      'eu-central-1',
      '--s3-bucket-url',
      'https://uploads.example.test',
      '--s3-addressing',
      'dns',
    ],
    exitCode: 1,
    stderr: '--s3-addressing must be "path" or "virtual"',
    env: {
      BLOK_S3_ACCESS_KEY: 'access-key',
      BLOK_S3_SECRET_KEY: 'secret-key',
    },
  },
])('exits with the contract code for $name', async (testCase) => {
  const result = await runServerCommand({ args: testCase.args, env: testCase.env });

  expect(result.exitCode).toBe(testCase.exitCode);
  expect(result.signal).toBeNull();
  expect(result.stderr).toContain(testCase.stderr);
});
