// @vitest-environment node

import { expect, it } from 'vitest';

import { startServer } from './run-against';

it('starts a supplied server and reports its version', async () => {
  const server = await startServer({ args: ['--listen', '127.0.0.1:0', '--storage-dir', ''] });

  try {
    expect(await server.request('GET', '/health')).toMatchObject({
      status: 200,
      headers: { 'content-type': 'application/json' },
      json: { status: 'ok', version: expect.any(String) as unknown },
    });
  } finally {
    await server.stop();
  }
});
