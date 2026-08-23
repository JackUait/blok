// @vitest-environment node

import { expect, it as baseIt } from 'vitest';

import { startServer } from './run-against';

// These cases drive a real built executable that only
// scripts/test-server-conformance.mjs builds and points BLOK_CONFORMANCE_SERVER at.
// The default `unit` project globs this file too, so without the guard every
// ordinary `yarn test` run is red.
const it = baseIt.skipIf(
  process.env.BLOK_CONFORMANCE_SERVER === undefined || process.env.BLOK_CONFORMANCE_SERVER === '',
);

it('starts a supplied server and reports its version', async () => {
  const server = await startServer({ args: ['--listen', '127.0.0.1:0', '--storage-dir', ''] });

  try {
    expect(await server.request('GET', '/health', { parseJson: true })).toMatchObject({
      status: 200,
      headers: { 'content-type': 'application/json' },
      json: { status: 'ok', version: expect.any(String) as unknown },
    });
  } finally {
    await server.stop();
  }
});

it('returns a plain-text response without parsing JSON by default', async () => {
  const server = await startServer({ args: ['--listen', '127.0.0.1:0', '--storage-dir', ''] });

  try {
    const response = await server.request('GET', '/missing');

    expect(response).toMatchObject({
      status: 404,
      json: undefined,
      text: '404 page not found\n',
    });
  } finally {
    await server.stop();
  }
});
