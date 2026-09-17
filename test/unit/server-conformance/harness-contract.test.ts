// @vitest-environment node

// The harness allocates a port by binding and closing it, so two vitest workers
// can hand the same port to two servers. Whoever loses the bind used to be
// declared healthy against the winner, and its test then measured the winner's
// flags: `--no-unfurl` answered GET /unfurl with the winner's 400 {"success":0}
// instead of 404.

import { expect, it as baseIt } from 'vitest';

import { allocateLoopbackPort, startServer } from './run-against';
import { startServerProcess } from './server-process';

// Same guard as the other conformance files: only
// scripts/test-server-conformance.mjs builds the executable these drive.
const it = baseIt.skipIf(
  process.env.BLOK_CONFORMANCE_SERVER === undefined ||
  process.env.BLOK_CONFORMANCE_SERVER === '',
);

function serverCommand(): string {
  const command = process.env.BLOK_CONFORMANCE_SERVER;

  if (command === undefined || command === '') {
    throw new Error('BLOK_CONFORMANCE_SERVER must point at a built server executable');
  }

  return command;
}

it('refuses a health answer that came from a server it did not start', async () => {
  const owner = await startServer({ args: ['--listen', '127.0.0.1:0'] });
  const authority = new URL(owner.baseUrl).host;

  try {
    await expect(startServerProcess({
      command: serverCommand(),
      args: ['--listen', authority, '--no-unfurl'],
      baseUrl: owner.baseUrl,
      env: process.env,
    })).rejects.toThrow(/address already in use/);
  } finally {
    await owner.stop();
  }
});

it('takes another port when the one it allocated is already taken', async () => {
  const owner = await startServer({ args: ['--listen', '127.0.0.1:0'] });
  const takenPort = Number(new URL(owner.baseUrl).port);
  let handedOut = 0;

  try {
    const server = await startServer({
      args: ['--listen', '127.0.0.1:0', '--no-unfurl'],
      allocatePort: () => {
        handedOut += 1;

        return handedOut === 1 ? Promise.resolve(takenPort) : allocateLoopbackPort();
      },
    });

    try {
      expect(handedOut).toBe(2);
      expect(server.baseUrl).not.toBe(owner.baseUrl);

      // The route the owner still answers with 400: proof this is our child.
      const response = await server.request('GET', '/unfurl');

      expect(response.status).toBe(404);
    } finally {
      await server.stop();
    }
  } finally {
    await owner.stop();
  }
});
