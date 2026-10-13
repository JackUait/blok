// @vitest-environment node
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { createServer as createTcpServer, type AddressInfo, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nodeSocketFactory } from '../../../src/mcp/live/node-socket';

describe('nodeSocketFactory', () => {
  let server: Server;
  let url: string;
  const upgrades: IncomingHttpHeaders[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    upgrades.length = 0;
    server = createServer();
    server.on('upgrade', (request, socket) => {
      upgrades.push(request.headers);
      socket.destroy();
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();

    if (address === null || typeof address === 'string') {
      throw new Error('The test server has no TCP address');
    }
    url = `ws://127.0.0.1:${(address satisfies AddressInfo).port}/sync/doc-1`;
  });

  afterEach(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    vi.restoreAllMocks();
  });

  const opened = async (origin: string | null): Promise<IncomingHttpHeaders> => {
    const socket = nodeSocketFactory(origin)(url, ['blok-sync.v2', 'blok-sync.v1', 'ticket-abc']);

    await new Promise<void>((done) => {
      socket.onclose = () => done();
      socket.onerror = () => undefined;
    });

    return upgrades[0];
  };

  it('offers the provider subprotocols and sends Origin in ticket mode', async () => {
    const headers = await opened('https://app.example.com');

    expect(headers['sec-websocket-protocol']).toBe('blok-sync.v2,blok-sync.v1,ticket-abc');
    expect(headers.origin).toBe('https://app.example.com');
  });

  it('sends no Origin when none is configured', async () => {
    expect((await opened(null)).origin).toBeUndefined();
  });

  it('exposes the WebSocketLike surface the provider drives', () => {
    const socket = nodeSocketFactory(null)(url, ['blok-sync.v1']);

    socket.onerror = () => undefined;
    socket.binaryType = 'arraybuffer';
    expect(socket.binaryType).toBe('arraybuffer');
    expect(typeof socket.readyState).toBe('number');
    expect(socket.protocol).toBe('');
    socket.close();
  });

  it('survives teardown of a socket whose upgrade never got an answer', async () => {
    const accepted: Socket[] = [];
    const silent = createTcpServer((socket) => {
      accepted.push(socket);
    });
    const uncaught: unknown[] = [];
    const record = (error: unknown): void => {
      uncaught.push(error);
    };

    await new Promise<void>((done) => silent.listen(0, '127.0.0.1', done));
    const address = silent.address();

    if (address === null || typeof address === 'string') {
      throw new Error('The silent server has no TCP address');
    }
    process.prependListener('uncaughtException', record);
    try {
      const connected = new Promise<void>((done) => silent.once('connection', () => done()));
      const socket = nodeSocketFactory(null)(`ws://127.0.0.1:${address.port}/sync/doc-1`, ['blok-sync.v2']);

      await connected;
      // The provider's teardown order: drop the handler, then close while CONNECTING.
      socket.onerror = null;
      socket.close(1000);
      await new Promise<void>((done) => setImmediate(done));
      await new Promise<void>((done) => setTimeout(done, 20));

      expect(uncaught).toEqual([]);
    } finally {
      process.removeListener('uncaughtException', record);
      accepted.forEach((socket) => socket.destroy());
      await new Promise<void>((done) => silent.close(() => done()));
    }
  });
});
