// @vitest-environment node

// The host's flag, environment and startup-refusal contract, black-box, for
// every target. Messages come from HostArguments and BlokServerOptions.

import { get } from 'node:http';
import { createServer, type Server } from 'node:net';

import { expect, it as baseIt } from 'vitest';

import { allocateLoopbackPort, runServerCommand } from './run-against';
import { startServerProcess } from './server-process';

const it = baseIt.skipIf(
  process.env.BLOK_CONFORMANCE_SERVER === undefined ||
  process.env.BLOK_CONFORMANCE_SERVER === '',
);

const SECRET = 's3cret-value-at-least-32-chars-long!';
const S3 = [
  '--s3-bucket', 'blok',
  '--s3-region', 'eu-central-1',
  '--s3-bucket-url', 'https://uploads.example.test',
];
const S3_KEYS = { BLOK_S3_ACCESS_KEY: 'a', BLOK_S3_SECRET_KEY: 'b' };

it.each([
  {
    name: 'a value flag with no value',
    args: ['--listen'],
    exitCode: 2,
    stderr: 'flag needs an argument: -listen\nUsage of blok-server:',
  },
  {
    name: 'a max-upload that is not a number',
    args: ['--max-upload', '1x'],
    exitCode: 2,
    stderr: 'invalid value "1x" for flag -max-upload: parse error\nUsage of blok-server:',
  },
  {
    name: 'a rate limit past int64',
    args: ['--rate-limit', '9223372036854775808'],
    exitCode: 2,
    stderr: 'invalid value "9223372036854775808" for flag -rate-limit: parse error',
  },
  {
    name: 'a bool flag with a bad value',
    args: ['--no-unfurl=maybe'],
    exitCode: 2,
    stderr: 'invalid value "maybe" for flag -no-unfurl: parse error',
  },
  {
    name: 'a bad BLOK_COLLAB_JOURNAL',
    args: [],
    env: { BLOK_COLLAB_JOURNAL: 'maybe' },
    exitCode: 2,
    stderr: 'invalid value "maybe" for BLOK_COLLAB_JOURNAL: parse error',
  },
  {
    name: 'rich text fields with a repeated key',
    args: ['--rich-text-fields', '{"a":["x"],"a":["y"]}'],
    exitCode: 2,
    stderr: 'invalid value "{"a":["x"],"a":["y"]}" for flag -rich-text-fields: parse error',
  },
  {
    name: 'rich text fields that are not an object',
    args: [],
    env: { BLOK_RICH_TEXT_FIELDS: '["title"]' },
    exitCode: 2,
    stderr: 'invalid value "["title"]" for BLOK_RICH_TEXT_FIELDS: parse error',
  },
  {
    name: 'an explicit negative rate limit',
    args: ['--rate-limit', '-1'],
    exitCode: 1,
    stderr: 'blok-server refused to start: --rate-limit must be zero or greater (got -1)',
  },
  {
    name: 'a proxy listener on every interface',
    args: ['--auth', 'proxy', '--listen', '0.0.0.0:4000'],
    exitCode: 1,
    stderr: '--auth proxy trusts every caller, so it may only bind loopback, not "0.0.0.0:4000" (which binds every network interface)',
  },
  {
    name: 'an anonymous listener with no host',
    args: ['--listen', ':4000'],
    exitCode: 1,
    stderr: '--auth none serves anyone who can reach ":4000" (an address with no host binds every network interface)',
  },
  {
    name: 'a doc endpoint without collab',
    args: ['--doc-endpoint', 'https://app.example.com/docs'],
    exitCode: 1,
    stderr: '--doc-endpoint needs --collab',
  },
  {
    name: 'a journal from the environment without collab',
    args: [],
    env: { BLOK_COLLAB_JOURNAL: 'true' },
    exitCode: 1,
    stderr: '--collab-journal needs --collab',
  },
  {
    // HostArguments.cs:287: the variable is not even parsed once the flag is given.
    name: 'a journal flag beside a bad BLOK_COLLAB_JOURNAL',
    args: ['--collab-journal'],
    env: { BLOK_COLLAB_JOURNAL: 'maybe' },
    exitCode: 1,
    stderr: '--collab-journal needs --collab',
  },
  {
    name: 'a journal flag with a bad inline value',
    args: ['--collab-journal=maybe'],
    exitCode: 2,
    stderr: 'invalid value "maybe" for flag -collab-journal: parse error',
  },
  {
    name: 'an S3 prefix without collab',
    args: ['--collab-s3-prefix', 'collab/'],
    exitCode: 1,
    stderr: '--collab-s3-prefix needs --collab',
  },
  {
    name: 'a public URL with a query',
    args: ['--public-url', '/files?x'],
    exitCode: 1,
    stderr: 'PublicUrl must not contain a query or fragment (got "/files?x")',
  },
  {
    name: 'an upload cap past Array.MaxLength with remote upload on',
    args: ['--max-upload', '2147483592'],
    exitCode: 1,
    stderr: '--max-upload must be no greater than 2147483591 bytes when remote URL upload is enabled (got 2147483592)',
  },
  {
    name: 'a plain-HTTP S3 endpoint off loopback',
    args: [...S3, '--s3-endpoint', 'http://s3.example.test'],
    env: S3_KEYS,
    exitCode: 1,
    stderr: '--s3-endpoint must use HTTPS unless it targets loopback for local development (got "http://s3.example.test")',
  },
  {
    name: 'an S3 bucket URL with a fragment',
    args: [...S3.slice(0, 4), '--s3-bucket-url', 'https://cdn.example.test/#x', '--s3-endpoint', 'https://s3.example.test'],
    env: S3_KEYS,
    exitCode: 1,
    stderr: '--s3-bucket-url must not contain a query or fragment (got "https://cdn.example.test/#x")',
  },
  {
    name: 'an explicit empty secret over BLOK_SECRET',
    args: ['--auth', 'ticket', '--secret', '', '--allow-origin', 'https://app.example.com'],
    env: { BLOK_SECRET: SECRET },
    exitCode: 1,
    stderr: '--secret must be at least 32 characters (got 0)',
  },
])('refuses $name', async ({ args, env, exitCode, stderr }) => {
  const result = await runServerCommand({ args, env });

  expect(result).toMatchObject({ exitCode, signal: null });
  expect(result.stderr).toContain(stderr);
});

it('warns when the secret comes from the flag, then starts', async () => {
  const port = await allocateLoopbackPort();
  const server = await startServerProcess({
    command: process.env.BLOK_CONFORMANCE_SERVER ?? '',
    args: [
      '--listen', `127.0.0.1:${port}`,
      '--auth', 'ticket',
      '--secret', SECRET,
      '--allow-origin', 'https://app.example.com',
      '--storage-dir', '',
    ],
    baseUrl: `http://127.0.0.1:${port}`,
    env: process.env,
  });

  try {
    expect(server.stderr).toContain(
      "warning: --secret puts the shared secret in this machine's process list; " +
      'set BLOK_SECRET in the environment instead\n',
    );
    expect(server.stderr).toContain(`listening on 127.0.0.1:${port} (--auth ticket)`);
  } finally {
    await server.stop();
  }
});

const TICKET_HOST = ['--auth', 'ticket', '--allow-origin', 'https://app.example.com', '--storage-dir', ''];

function answersHealth(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = get({ host, port, path: '/health', timeout: 2_000 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });

    request.once('timeout', () => request.destroy());
    request.once('error', () => resolve(false));
  });
}

function listenOn(host: string, port: number): Promise<Server | undefined> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', () => resolve(undefined));
    server.listen(port, host, () => resolve(server));
  });
}

const canListenOnIpv6Loopback = await (async () => {
  const server = await listenOn('::1', 0);

  server?.close();

  return server !== undefined;
})();

// Kestrel binds what UseUrls makes of the address: an IPv4 address alone,
// any IPv6 address for a wildcard, and both loopbacks for localhost.
const itWithIpv6 = baseIt.skipIf(
  process.env.BLOK_CONFORMANCE_SERVER === undefined ||
  process.env.BLOK_CONFORMANCE_SERVER === '' ||
  !canListenOnIpv6Loopback,
);

itWithIpv6.each([
  { listen: ':', ipv4: true, ipv6: false },
  { listen: '0.0.0.0:', ipv4: true, ipv6: false },
  { listen: '127.1:', ipv4: true, ipv6: false },
  { listen: '*:', ipv4: true, ipv6: true },
  { listen: '+:', ipv4: true, ipv6: true },
  { listen: '[::]:', ipv4: true, ipv6: true },
  { listen: 'localhost:', ipv4: true, ipv6: true },
  { listen: 'LOCALHOST:', ipv4: true, ipv6: true },
  { listen: '[::1]:', ipv4: false, ipv6: true },
])('binds $listen for IPv4 $ipv4 and IPv6 $ipv6', async ({ listen, ipv4, ipv6 }) => {
  const port = await allocateLoopbackPort();
  const server = await startServerProcess({
    command: process.env.BLOK_CONFORMANCE_SERVER ?? '',
    args: ['--listen', `${listen}${port}`, ...TICKET_HOST],
    baseUrl: ipv4 ? `http://127.0.0.1:${port}` : `http://[::1]:${port}`,
    env: { ...process.env, BLOK_SECRET: SECRET },
  });

  try {
    expect({
      ipv4: await answersHealth('127.0.0.1', port),
      ipv6: await answersHealth('::1', port),
    }).toEqual({ ipv4, ipv6 });
  } finally {
    await server.stop();
  }
});

it.each([
  {
    name: 'localhost with a dynamic port',
    listen: async () => 'localhost:0',
    stderr: async () => 'blok-server refused to start: Dynamic port binding is not supported when binding to localhost. ' +
      'You must either bind to 127.0.0.1:0 or [::1]:0, or both.\n',
  },
  {
    name: 'an IPv4-mapped IPv6 address',
    listen: async () => `[::ffff:127.0.0.1]:${await allocateLoopbackPort()}`,
    stderr: async () => 'blok-server refused to start: ',
  },
])('refuses to start on $name', async ({ listen, stderr }) => {
  const result = await runServerCommand({
    args: ['--listen', await listen(), ...TICKET_HOST],
    env: { ...process.env, BLOK_SECRET: SECRET },
  });

  expect(result).toMatchObject({ exitCode: 1, signal: null });
  expect(result.stderr).toContain(await stderr());
  expect(result.stderr).not.toContain('listening on');
});

it.each(['127.0.0.1:', 'localhost:'])('names the address already in use for %s', async (listen) => {
  const port = await allocateLoopbackPort();
  const holder = await listenOn('127.0.0.1', port);

  try {
    const result = await runServerCommand({
      args: ['--listen', `${listen}${port}`, ...TICKET_HOST],
      env: { ...process.env, BLOK_SECRET: SECRET },
    });

    expect(result).toMatchObject({ exitCode: 1, signal: null });
    expect(result.stderr).toBe(
      `blok-server refused to start: Failed to bind to address http://127.0.0.1:${port}: address already in use.\n`,
    );
  } finally {
    holder?.close();
  }
});
