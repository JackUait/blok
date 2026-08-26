// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it as baseIt } from 'vitest';

import {
  runServerCommand,
  startServer,
  type RunningServer,
} from './run-against';
import { FIXTURE_MEDIA_BODY, startFixtureOrigin } from './fixture-origin';
import { startFakeS3 } from './fake-s3';
import { sendRequest } from './http-client';

// These cases drive a real built executable that only
// scripts/test-server-conformance.mjs builds and points BLOK_CONFORMANCE_SERVER at.
// The default `unit` project globs this file too, so without the guard every
// ordinary `yarn test` run is red.
const unset = (name: string): boolean =>
  process.env[name] === undefined || process.env[name] === '';

const it = baseIt.skipIf(unset('BLOK_CONFORMANCE_SERVER'));

// A few cases drive the ordinary binary too, which the same runner builds beside
// the conformance one. `skipIf` returns an API that cannot be narrowed again.
const ordinaryIt = baseIt.skipIf(
  unset('BLOK_CONFORMANCE_SERVER') || unset('BLOK_CONFORMANCE_ORDINARY_SERVER'),
);

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

function ordinaryServerCommand(): string {
  const command = process.env.BLOK_CONFORMANCE_ORDINARY_SERVER;

  if (command === undefined || command === '') {
    throw new Error('BLOK_CONFORMANCE_ORDINARY_SERVER must point at the ordinary built executable');
  }

  return command;
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

const MULTIPART_BOUNDARY = 'blok-server-conformance-boundary';

interface MultipartUpload {
  body: Buffer;
  contentType: string;
}

interface UploadResponse {
  fileName?: string;
  mimeType?: string;
  size?: number;
  url: string;
}

function createMultipartParts(
  parts: Array<{ bytes: Uint8Array; headers: string[] }>,
  boundary = MULTIPART_BOUNDARY,
): MultipartUpload {
  const body: Buffer[] = [];

  for (const part of parts) {
    body.push(
      Buffer.from(`--${boundary}\r\n${part.headers.join('\r\n')}\r\n\r\n`),
      Buffer.from(part.bytes),
      Buffer.from('\r\n'),
    );
  }

  body.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    body: Buffer.concat(body),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function createMultipartUpload(options: {
  boundary?: string;
  bytes: Uint8Array;
  fieldName?: string;
  fileName: string;
  mimeType?: string;
  transferEncoding?: string;
}): MultipartUpload {
  const escapedFileName = options.fileName.replaceAll('\\', '\\\\').replaceAll('"', '\\"');

  return createMultipartParts(
    [{
      bytes: options.bytes,
      headers: [
        `Content-Disposition: form-data; name="${options.fieldName ?? 'file'}"; filename="${escapedFileName}"`,
        `Content-Type: ${options.mimeType ?? 'application/octet-stream'}`,
        ...(options.transferEncoding === undefined
          ? []
          : [`Content-Transfer-Encoding: ${options.transferEncoding}`]),
      ],
    }],
    options.boundary,
  );
}

function isUploadResponse(value: unknown): value is UploadResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const response = value as Record<string, unknown>;

  return typeof response.url === 'string' &&
    (response.fileName === undefined || typeof response.fileName === 'string') &&
    (response.mimeType === undefined || typeof response.mimeType === 'string') &&
    (response.size === undefined || typeof response.size === 'number');
}

function requireUploadResponse(value: unknown): UploadResponse {
  if (!isUploadResponse(value)) {
    throw new Error('Server upload response has an invalid shape');
  }

  return value;
}

async function withTemporaryDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'blok-server-conformance-storage-'));

  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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

it('returns the frozen method and unknown-route responses', async () => {
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

it('returns the exact wrong-method wire for every active route', async () => {
  await withServer(serverArgs(), async (server) => {
    const cases = [
      { method: 'POST', path: '/unfurl', allow: 'GET, HEAD, OPTIONS' },
      { method: 'GET', path: '/upload', allow: 'OPTIONS, POST' },
      { method: 'GET', path: '/upload-by-url', allow: 'OPTIONS, POST' },
    ];

    for (const testCase of cases) {
      const response = await server.request(testCase.method, testCase.path);

      expect(response).toMatchObject({
        status: 405,
        headers: {
          allow: testCase.allow,
          'content-type': 'text/plain; charset=utf-8',
        },
        text: 'Method Not Allowed\n',
      });
    }
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

it('preserves the frozen ticket header and authorization grammar', async () => {
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

it.each([
  {
    listen: 'localhost',
    error: 'listen tcp: address localhost: missing port in address',
  },
  {
    listen: 'localhost:65536',
    error: 'listen tcp: address 65536: invalid port',
  },
])('rejects malformed listen address $listen before serving', async (testCase) => {
  const result = await runServerCommand({
    args: ['--listen', testCase.listen],
    timeoutMs: 5_000,
  });

  expect(result).toMatchObject({ exitCode: 1, signal: null });
  expect(result.stderr).toContain(testCase.error);
});

it('serves a preseeded local file at the public URL path as an attachment', async () => {
  await withTemporaryDirectory(async (directory) => {
    const storedName = '0123456789abcdef0123456789abcdef.html';
    const bytes = Buffer.from('<h1>preseeded upload</h1>');

    await writeFile(join(directory, storedName), bytes);
    await withServer(serverArgs(
      '--storage-dir',
      directory,
      '--public-url',
      'https://uploads.example.com/media/files/',
    ), async (server) => {
      const served = await server.request('GET', `/media/files/${storedName}`);

      expect(served).toMatchObject({
        status: 200,
        headers: {
          'content-disposition': 'attachment',
          'x-content-type-options': 'nosniff',
        },
      });
      expect(served.bytes).toEqual(bytes);
    });
  });
});

it('stores multipart bytes under safe local keys and serves them as attachments', async () => {
  await withTemporaryDirectory(async (directory) => {
    await withServer(serverArgs('--storage-dir', directory), async (server) => {
      const cases = [
        { fileName: String.raw`C:\Users\me\PHOTO.PNG`, expectedName: 'PHOTO.PNG', expectedExtension: '.png' },
        { fileName: '../../notes/report.txt', expectedName: 'report.txt', expectedExtension: '.txt' },
      ];

      for (const [index, testCase] of cases.entries()) {
        const bytes = Buffer.from(`stored bytes ${index}`);
        const upload = createMultipartUpload({
          bytes,
          fileName: testCase.fileName,
          mimeType: 'text/plain; charset=utf-8',
        });
        const response = await server.request('POST', '/upload', {
          body: upload.body,
          headers: { 'Content-Type': upload.contentType },
          parseJson: true,
        });
        const payload = requireUploadResponse(response.json);
        const storedURL = new URL(payload.url);
        const storedName = storedURL.pathname.split('/').at(-1) ?? '';

        expect(response).toMatchObject({
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
        expect(response.json).toEqual({
          fileName: testCase.expectedName,
          mimeType: 'text/plain; charset=utf-8',
          size: bytes.byteLength,
          url: `${server.baseUrl}/files/${storedName}`,
        });
        expect(storedName).toMatch(new RegExp(`^[0-9a-f]{32}\\${testCase.expectedExtension}$`));
        expect(await readFile(join(directory, storedName))).toEqual(bytes);

        const served = await server.request('GET', storedURL.pathname);

        expect(served).toMatchObject({
          status: 200,
          headers: {
            'content-disposition': 'attachment',
            'x-content-type-options': 'nosniff',
          },
        });
        expect(served.bytes).toEqual(bytes);
      }

      const entries = await readdir(directory);
      const listing = await server.request('GET', '/files/');

      expect(entries).toHaveLength(cases.length);
      expect(listing).toMatchObject({ status: 404, text: '404 page not found\n' });
      for (const entry of entries) {
        expect(listing.text).not.toContain(entry);
      }
    });
  });
});

it('omits unavailable optional multipart response metadata', async () => {
  await withTemporaryDirectory(async (directory) => {
    await withServer(serverArgs('--storage-dir', directory), async (server) => {
      const upload = createMultipartUpload({
        bytes: Buffer.alloc(0),
        fileName: '.',
        mimeType: 'not a media type',
      });
      const response = await server.request('POST', '/upload', {
        body: upload.body,
        headers: { 'Content-Type': upload.contentType },
        parseJson: true,
      });
      const payload = requireUploadResponse(response.json);
      const storedName = new URL(payload.url).pathname.split('/').at(-1) ?? '';

      expect(response.status).toBe(200);
      expect(response.json).toEqual({ url: `${server.baseUrl}/files/${storedName}` });
      expect(storedName).toMatch(/^[0-9a-f]{32}$/);
      expect(await readFile(join(directory, storedName))).toEqual(Buffer.alloc(0));
    });
  });
});

it('requires a valid multipart file field named file', async () => {
  await withTemporaryDirectory(async (directory) => {
    await withServer(serverArgs('--storage-dir', directory), async (server) => {
      const wrongField = createMultipartUpload({
        bytes: Buffer.from('bytes'),
        fieldName: 'asset',
        fileName: 'photo.png',
      });
      const missing = await server.request('POST', '/upload', {
        body: wrongField.body,
        headers: { 'Content-Type': wrongField.contentType },
      });
      const malformed = await server.request('POST', '/upload', {
        body: 'not a multipart body',
        headers: { 'Content-Type': 'multipart/form-data; boundary=missing' },
      });

      expect(missing).toMatchObject({
        status: 400,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        text: 'missing file field\n',
      });
      expect(malformed).toMatchObject({
        status: 400,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        text: 'malformed upload\n',
      });
      expect(await readdir(directory)).toEqual([]);
    });
  });
});

it.each([129, 4_089])('accepts a matching %i-character multipart boundary', async (length) => {
  await withTemporaryDirectory(async (directory) => {
    await withServer(serverArgs('--storage-dir', directory), async (server) => {
      const upload = createMultipartUpload({
        boundary: 'a'.repeat(length),
        bytes: Buffer.from('long boundary'),
        fileName: 'long-boundary.txt',
      });
      const response = await server.request('POST', '/upload', {
        body: upload.body,
        headers: { 'Content-Type': upload.contentType },
        parseJson: true,
      });

      expect(response.status).toBe(200);
      expect(requireUploadResponse(response.json).size).toBe(13);
      expect(await readdir(directory)).toHaveLength(1);
    });
  });
});

it('preserves frozen duplicate multipart boundary handling', async () => {
  await withTemporaryDirectory(async (directory) => {
    await withServer(serverArgs('--storage-dir', directory), async (server) => {
      const upload = createMultipartUpload({
        bytes: Buffer.from('duplicate boundary'),
        fileName: 'duplicate-boundary.txt',
      });
      const equalBoundary = await server.request('POST', '/upload', {
        body: upload.body,
        headers: {
          'Content-Type': `${upload.contentType}; boundary=${MULTIPART_BOUNDARY}`,
        },
        parseJson: true,
      });

      expect(equalBoundary.status).toBe(200);
      expect(requireUploadResponse(equalBoundary.json).size).toBe(18);

      const conflictingBoundary = await server.request('POST', '/upload', {
        body: upload.body,
        headers: {
          'Content-Type': `${upload.contentType}; boundary=other-boundary`,
        },
      });

      expect(conflictingBoundary).toMatchObject({
        status: 400,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        text: 'malformed upload\n',
      });
      expect(await readdir(directory)).toHaveLength(1);
    });
  });
});

it('rejects conflicting escaped duplicate multipart boundaries with frozen behavior', async () => {
  await withTemporaryDirectory(async (directory) => {
    await withServer(serverArgs('--storage-dir', directory), async (server) => {
      const upload = createMultipartUpload({
        boundary: String.raw`m\z`,
        bytes: Buffer.from('escaped boundary'),
        fileName: 'escaped-boundary.txt',
      });
      const response = await server.request('POST', '/upload', {
        body: upload.body,
        headers: {
          'Content-Type': String.raw`multipart/form-data; boundary="m\z"; boundary=mz`,
        },
      });

      expect(response).toMatchObject({
        status: 400,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        text: 'malformed upload\n',
      });
      expect(await readdir(directory)).toEqual([]);
    });
  });
});

it('sanitizes conflicting escaped duplicate media parameters with frozen behavior', async () => {
  await withTemporaryDirectory(async (directory) => {
    await withServer(serverArgs('--storage-dir', directory), async (server) => {
      const upload = createMultipartUpload({
        bytes: Buffer.from('escaped media'),
        fileName: 'escaped-media.txt',
        mimeType: String.raw`text/plain; charset="a\z"; charset=az`,
      });
      const response = await server.request('POST', '/upload', {
        body: upload.body,
        headers: { 'Content-Type': upload.contentType },
        parseJson: true,
      });

      expect(response.status).toBe(200);
      expect(requireUploadResponse(response.json).mimeType).toBeUndefined();
      expect(await readdir(directory)).toHaveLength(1);
    });
  });
});

it('preserves frozen MIME-special quoted parameter escapes', async () => {
  await withTemporaryDirectory(async (directory) => {
    await withServer(serverArgs('--storage-dir', directory), async (server) => {
      const mimeType = String.raw`text/plain; charset="a\/b"; charset="a/b"`;
      const upload = createMultipartUpload({
        bytes: Buffer.from('escaped special'),
        fileName: 'escaped-special.txt',
        mimeType,
      });
      const response = await server.request('POST', '/upload', {
        body: upload.body,
        headers: { 'Content-Type': upload.contentType },
        parseJson: true,
      });

      expect(response.status).toBe(200);
      expect(requireUploadResponse(response.json).mimeType).toBe(mimeType);
      expect(await readdir(directory)).toHaveLength(1);
    });
  });
});

it('preserves frozen duplicate media parameter handling', async () => {
  await withTemporaryDirectory(async (directory) => {
    await withServer(serverArgs('--storage-dir', directory), async (server) => {
      const equalMediaType = 'text/plain; charset=utf-8; charset=utf-8';
      const equalUpload = createMultipartUpload({
        bytes: Buffer.from('equal media'),
        fileName: 'equal-media.txt',
        mimeType: equalMediaType,
      });
      const equalMedia = await server.request('POST', '/upload', {
        body: equalUpload.body,
        headers: { 'Content-Type': equalUpload.contentType },
        parseJson: true,
      });

      expect(equalMedia.status).toBe(200);
      expect(requireUploadResponse(equalMedia.json).mimeType).toBe(equalMediaType);

      const conflictingUpload = createMultipartUpload({
        bytes: Buffer.from('conflicting media'),
        fileName: 'conflicting-media.txt',
        mimeType: 'text/plain; charset=utf-8; charset=us-ascii',
      });
      const conflictingMedia = await server.request('POST', '/upload', {
        body: conflictingUpload.body,
        headers: { 'Content-Type': conflictingUpload.contentType },
        parseJson: true,
      });

      expect(conflictingMedia.status).toBe(200);
      expect(requireUploadResponse(conflictingMedia.json).mimeType).toBeUndefined();
      expect(await readdir(directory)).toHaveLength(2);
    });
  });
});

it('decodes quoted-printable multipart file bytes before storage', async () => {
  await withTemporaryDirectory(async (directory) => {
    await withServer(serverArgs('--storage-dir', directory), async (server) => {
      const upload = createMultipartUpload({
        bytes: Buffer.from('=00=FF'),
        fileName: 'encoded.bin',
        transferEncoding: 'quoted-printable',
      });
      const response = await server.request('POST', '/upload', {
        body: upload.body,
        headers: { 'Content-Type': upload.contentType },
        parseJson: true,
      });
      const payload = requireUploadResponse(response.json);
      const storedName = new URL(payload.url).pathname.split('/').at(-1) ?? '';

      expect(response.status).toBe(200);
      expect(payload.size).toBe(2);
      expect(await readFile(join(directory, storedName))).toEqual(Buffer.from([0, 255]));
    });
  });
});

it.each([
  {
    disposition: 'Content-Disposition: form-data; name="note"',
    label: 'ignored field',
  },
  {
    disposition: 'Content-Disposition: form-data; name="file"; filename="later.txt"',
    label: 'later file',
  },
])('rejects malformed quoted-printable in a $label before storage', async ({ disposition }) => {
  await withTemporaryDirectory(async (directory) => {
    await withServer(serverArgs('--storage-dir', directory), async (server) => {
      const upload = createMultipartParts([
        {
          bytes: Buffer.from('valid file'),
          headers: [
            'Content-Disposition: form-data; name="file"; filename="first.txt"',
            'Content-Type: text/plain',
          ],
        },
        {
          bytes: Buffer.from('='),
          headers: [
            disposition,
            'Content-Transfer-Encoding: quoted-printable',
          ],
        },
      ]);
      const response = await server.request('POST', '/upload', {
        body: upload.body,
        headers: { 'Content-Type': upload.contentType },
      });

      expect(response).toMatchObject({
        status: 400,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        text: 'malformed upload\n',
      });
      expect(await readdir(directory)).toEqual([]);
    });
  });
});

it('applies max-upload to the complete multipart request body', async () => {
  const upload = createMultipartUpload({
    bytes: Buffer.from('small file'),
    fileName: 'small.txt',
  });

  expect(upload.body.byteLength).toBeGreaterThan('small file'.length);

  await withTemporaryDirectory(async (directory) => {
    await withServer(serverArgs(
      '--storage-dir',
      directory,
      '--max-upload',
      String(upload.body.byteLength - 1),
    ), async (server) => {
      const response = await server.request('POST', '/upload', {
        body: upload.body,
        headers: { 'Content-Type': upload.contentType },
      });

      expect(response).toMatchObject({
        status: 413,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        text: 'file too large\n',
      });
      expect(await readdir(directory)).toEqual([]);
    });
  });
});

it('refuses a zero upload cap at process startup', async () => {
  const result = await runServerCommand({
    args: serverArgs('--storage-dir', '', '--max-upload', '0'),
  });

  expect(result).toMatchObject({ exitCode: 1, signal: null });
  expect(result.stderr).toContain(
    '--max-upload must be a positive number of bytes (got 0): a zero cap refuses every upload',
  );
});

ordinaryIt('accepts only an exact HTTP 127.0.0.1 origin in the tagged binary', async () => {
  for (const origin of [
    'https://127.0.0.1:43123',
    'http://localhost:43123',
    'http://127.0.0.1',
    'http://user@127.0.0.1:43123',
    'http://127.0.0.1:43123/',
    'http://127.0.0.1:43123?query',
    'http://127.0.0.1:43123#fragment',
  ]) {
    const result = await runServerCommand({
      args: ['--conformance-origin', origin],
    });

    expect(result, origin).toMatchObject({ exitCode: 2, signal: null });
    expect(result.stderr).toContain(
      'must be exactly http://127.0.0.1:PORT with a port from 1 to 65535 and no userinfo, path, query, or fragment',
    );
  }
});

ordinaryIt('keeps the conformance-only origin flag out of an ordinary binary', async () => {
  await expect(startServer({
    command: ordinaryServerCommand(),
    args: serverArgs(
      '--conformance-origin',
      'http://127.0.0.1:43123',
      '--not-a-real-flag',
    ),
  })).rejects.toThrow(
    /code 2[\s\S]*flag provided but not defined: -conformance-origin/,
  );
});

it('unfurls redirected metadata with stable precedence and resolved URLs', async () => {
  const origin = await startFixtureOrigin();

  try {
    await withServer(serverArgs(
      '--storage-dir',
      '',
      '--conformance-origin',
      origin.baseUrl,
    ), async (server) => {
      const response = await server.request(
        'GET',
        `/unfurl?url=${encodeURIComponent(origin.metadataRedirectUrl)}`,
        { parseJson: true },
      );

      expect(response).toMatchObject({
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      expect(response.json).toEqual({
        success: 1,
        link: origin.metadataFinalUrl,
        meta: {
          title: 'OpenGraph title',
          description: 'OpenGraph description',
          image: { url: origin.metadataImageUrl },
          favicon: origin.metadataFaviconUrl,
          domain: '127.0.0.1',
        },
      });
    });
  } finally {
    await origin.stop();
  }
});

it('distinguishes a missing unfurl URL from fetch and upstream failures', async () => {
  const origin = await startFixtureOrigin();

  try {
    await withServer(serverArgs(
      '--storage-dir',
      '',
      '--conformance-origin',
      origin.baseUrl,
    ), async (server) => {
      const missing = await server.request('GET', '/unfurl', { parseJson: true });

      expect(missing).toMatchObject({
        status: 400,
        headers: { 'content-type': 'application/json' },
        json: { success: 0 },
        text: '{"success":0}\n',
      });

      for (const target of [origin.errorUrl, origin.oversizedUrl, 'file:///etc/passwd']) {
        const failed = await server.request(
          'GET',
          `/unfurl?url=${encodeURIComponent(target)}`,
          { parseJson: true },
        );

        expect(failed, target).toMatchObject({
          status: 200,
          headers: { 'content-type': 'application/json' },
          json: { success: 0 },
          text: '{"success":0}\n',
        });
      }
    });
  } finally {
    await origin.stop();
  }
});

it('reports an upstream unfurl timeout as success zero', async () => {
  const origin = await startFixtureOrigin();

  try {
    await withServer(serverArgs(
      '--storage-dir',
      '',
      '--conformance-origin',
      origin.baseUrl,
    ), async (server) => {
      const response = await server.request(
        'GET',
        `/unfurl?url=${encodeURIComponent(origin.delayedUrl)}`,
        { parseJson: true },
      );

      expect(response).toMatchObject({
        status: 200,
        headers: { 'content-type': 'application/json' },
        json: { success: 0 },
        text: '{"success":0}\n',
      });
    });
  } finally {
    await origin.stop();
  }
}, 15_000);

it('stores redirected upload-by-url bytes with final response metadata', async () => {
  const origin = await startFixtureOrigin();

  try {
    await withTemporaryDirectory(async (directory) => {
      await withServer(serverArgs(
        '--storage-dir',
        directory,
        '--max-upload',
        '64',
        '--conformance-origin',
        origin.baseUrl,
      ), async (server) => {
        const response = await server.request('POST', '/upload-by-url', {
          body: JSON.stringify({ url: origin.mediaRedirectUrl }),
          headers: { 'Content-Type': 'application/json' },
          parseJson: true,
        });
        const payload = requireUploadResponse(response.json);
        const storedURL = new URL(payload.url);
        const storedName = storedURL.pathname.split('/').at(-1) ?? '';

        expect(response).toMatchObject({
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
        expect(response.json).toEqual({
          fileName: 'photo.jpeg',
          mimeType: 'image/jpeg',
          size: Buffer.byteLength(FIXTURE_MEDIA_BODY),
          url: `${server.baseUrl}/files/${storedName}`,
        });
        expect(storedName).toMatch(/^[0-9a-f]{32}\.jpeg$/);
        expect(await readFile(join(directory, storedName), 'utf8')).toBe(FIXTURE_MEDIA_BODY);
      });
    });
  } finally {
    await origin.stop();
  }
});

it('refuses non-success and oversized upload-by-url responses before storage', async () => {
  const origin = await startFixtureOrigin();

  try {
    await withTemporaryDirectory(async (directory) => {
      await withServer(serverArgs(
        '--storage-dir',
        directory,
        '--max-upload',
        '64',
        '--conformance-origin',
        origin.baseUrl,
      ), async (server) => {
        for (const target of [origin.errorUrl, origin.oversizedUrl]) {
          const response = await server.request('POST', '/upload-by-url', {
            body: JSON.stringify({ url: target }),
            headers: { 'Content-Type': 'application/json' },
          });

          expect(response, target).toMatchObject({
            status: 400,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
            text: 'the URL could not be fetched\n',
          });
        }

        expect(await readdir(directory)).toEqual([]);
      });
    });
  } finally {
    await origin.stop();
  }
});

it('reports an upload-by-url storage failure as a bad gateway', async () => {
  const origin = await startFixtureOrigin();

  try {
    await withTemporaryDirectory(async (directory) => {
      const storageFile = join(directory, 'not-a-directory');

      await writeFile(storageFile, 'occupied');
      await withServer(serverArgs(
        '--storage-dir',
        storageFile,
        '--conformance-origin',
        origin.baseUrl,
      ), async (server) => {
        const response = await server.request('POST', '/upload-by-url', {
          body: JSON.stringify({ url: origin.mediaRedirectUrl }),
          headers: { 'Content-Type': 'application/json' },
        });

        expect(response).toMatchObject({
          status: 502,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
          text: 'upload failed\n',
        });
      });
    });
  } finally {
    await origin.stop();
  }
});

it('uploads to S3 with a known length, SigV4 headers, and path addressing', async () => {
  const fakeS3 = await startFakeS3();

  try {
    const server = await startServer({
      command: ordinaryServerCommand(),
      args: serverArgs(
        '--storage-dir',
        '',
        '--s3-endpoint',
        fakeS3.baseUrl,
        '--s3-region',
        'eu-central-1',
        '--s3-bucket',
        'media',
        '--s3-bucket-url',
        'https://cdn.example.com/media',
        '--s3-addressing',
        'path',
      ),
      env: {
        BLOK_S3_ACCESS_KEY: 'AKIAEXAMPLE',
        BLOK_S3_SECRET_KEY: 'conformance-secret-key',
      },
    });

    try {
      const bytes = Buffer.from('signed S3 bytes');
      const upload = createMultipartUpload({
        bytes,
        fileName: String.raw`C:\fakepath\PHOTO.PNG`,
        mimeType: 'image/png',
      });
      const response = await server.request('POST', '/upload', {
        body: upload.body,
        headers: { 'Content-Type': upload.contentType },
        parseJson: true,
      });
      const payload = requireUploadResponse(response.json);
      const storedName = new URL(payload.url).pathname.split('/').at(-1) ?? '';

      expect(response).toMatchObject({
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      expect(response.json).toEqual({
        fileName: 'PHOTO.PNG',
        mimeType: 'image/png',
        size: bytes.byteLength,
        url: `https://cdn.example.com/media/${storedName}`,
      });
      expect(storedName).toMatch(/^[0-9a-f]{32}\.png$/);
      expect(fakeS3.requests).toHaveLength(1);

      const request = fakeS3.requests[0];

      expect(request).toMatchObject({
        method: 'PUT',
        path: `/media/${storedName}`,
        headers: {
          'content-length': String(bytes.byteLength),
          'content-type': 'image/png',
          host: new URL(fakeS3.baseUrl).host,
          'x-amz-content-sha256': createHash('sha256').update(bytes).digest('hex'),
        },
      });
      expect(request.headers['transfer-encoding']).toBeUndefined();
      expect(request.headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
      expect(request.headers.authorization).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/\d{8}\/eu-central-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
      );
      expect(request.body).toEqual(bytes);
    } finally {
      await server.stop();
    }
  } finally {
    await fakeS3.stop();
  }
});

it('maps a configured S3 error status to an upload bad gateway', async () => {
  const fakeS3 = await startFakeS3(403);

  try {
    const server = await startServer({
      command: ordinaryServerCommand(),
      args: serverArgs(
        '--storage-dir',
        '',
        '--s3-endpoint',
        fakeS3.baseUrl,
        '--s3-region',
        'eu-central-1',
        '--s3-bucket',
        'media',
        '--s3-bucket-url',
        'https://cdn.example.com/media',
        '--s3-addressing',
        'path',
      ),
      env: {
        BLOK_S3_ACCESS_KEY: 'AKIAEXAMPLE',
        BLOK_S3_SECRET_KEY: 'conformance-secret-key',
      },
    });

    try {
      const upload = createMultipartUpload({
        bytes: Buffer.from('rejected'),
        fileName: 'photo.png',
        mimeType: 'image/png',
      });
      const response = await server.request('POST', '/upload', {
        body: upload.body,
        headers: { 'Content-Type': upload.contentType },
      });

      expect(response).toMatchObject({
        status: 502,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        text: 'upload failed\n',
      });
      expect(fakeS3.requests).toHaveLength(1);
      expect(fakeS3.requests[0]).toMatchObject({ method: 'PUT' });
    } finally {
      await server.stop();
    }
  } finally {
    await fakeS3.stop();
  }
});

it('bounds and validates the upload-by-url JSON envelope', async () => {
  const origin = await startFixtureOrigin();

  try {
    await withTemporaryDirectory(async (directory) => {
      await withServer(serverArgs(
        '--storage-dir',
        directory,
        '--conformance-origin',
        origin.baseUrl,
      ), async (server) => {
        const bodies = [
          '',
          'not json',
          '{}',
          '{"url":""}',
          `{"url":"${'x'.repeat(8 << 10)}"}`,
        ];

        for (const body of bodies) {
          const response = await server.request('POST', '/upload-by-url', {
            body,
            headers: { 'Content-Type': 'application/json' },
          });

          expect(response, body.slice(0, 40)).toMatchObject({
            status: 400,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
            text: 'expected {"url": "..."}\n',
          });
        }

        expect(await readdir(directory)).toEqual([]);
      });
    });
  } finally {
    await origin.stop();
  }
});
