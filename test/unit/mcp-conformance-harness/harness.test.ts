// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { Agent, createServer, request } from 'node:http';
import { type AddressInfo, connect, createServer as createTcpServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, inflateSync } from 'node:zlib';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type FixtureCase, runCase } from '../mcp-conformance/exchange';
import { startFakeHost } from '../mcp-conformance/fake-host';
import { encode } from '../../../src/components/modules/collaboration/sync-wire';
import { FrameProxy, signTicket } from '../mcp-conformance/live-room';

// Stand-in "binaries" for the harness's own steps; no MCP server is built.
const scratch = mkdtempSync(join(tmpdir(), 'mcp-harness-test-'));

const script = (name: string, source: string): string[] => {
  const path = join(scratch, name);

  writeFileSync(path, source);

  return [process.execPath, path];
};

/** Answers every request with a text item whose JSON escapes U+2028, as   in the text itself. */
const escapingServer = script('escaping.cjs', `
const rl = require('node:readline').createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const { id } = JSON.parse(line);
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: '{"a":"\\\\u2028"}' }], structuredContent: { a: '\\u2028' } } }) + '\\n');
});
`);

/** Reads requests, and answers them all only once stdin has ended. */
const answersAtEofServer = script('eof.cjs', `
const ids = [];
const rl = require('node:readline').createInterface({ input: process.stdin });
rl.on('line', (line) => { try { ids.push(JSON.parse(line).id); } catch { ids.push('bad'); } });
rl.on('close', () => {
  for (const id of ids) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: { seen: ids } }) + '\\n');
});
`);

/** Prints its URL and answers each POST with the body bytes it got, as hex. */
const echoHttpServer = script('echo-http.cjs', `
const server = require('node:http').createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ hex: Buffer.concat(chunks).toString('hex') }));
  });
});
server.listen(0, '127.0.0.1', () => process.stderr.write('listening on http://127.0.0.1:' + server.address().port + '/mcp\\n'));
process.on('SIGTERM', () => process.exit(0));
`);

// Answers a batch over SSE in reverse, as a port that streams each answer as it ends may.
const reversedSseServer = script('reversed-sse.cjs', `
const server = require('node:http').createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const batch = JSON.parse(Buffer.concat(chunks).toString());
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const call of batch.reverse()) {
      res.write('event: message\\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: call.id, result: {} }) + '\\n\\n');
    }
    res.end();
  });
});
server.listen(0, '127.0.0.1', () => process.stderr.write('listening on http://127.0.0.1:' + server.address().port + '/mcp\\n'));
process.on('SIGTERM', () => process.exit(0));
`);

const toolCall = { method: 'tools/call', params: { name: 'x', arguments: {} } };

describe('MCP conformance harness steps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('rawText compares content[].text byte for byte, so an escaped U+2028 differs from a raw one', async () => {
    const recorded: FixtureCase = {
      name: 'raw',
      transport: 'stdio',
      steps: [{ send: toolCall, rawText: true, expect: { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"a":" "}' }], structuredContent: { a: ' ' } } } }],
      expectExit: { code: 0 },
    };

    await expect(runCase(escapingServer, recorded, false)).rejects.toThrow(/expected/i);
  });

  it('rawText records the text item as it came, not parsed', async () => {
    const result = await runCase(escapingServer, { name: 'raw', transport: 'stdio', steps: [{ send: toolCall, rawText: true }] }, true);

    expect(result.steps?.[0].expect).toEqual({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"a":"\\u2028"}' }], structuredContent: { a: ' ' } } });
  });

  it('closeInputAfter ends stdin right after the write and still reads the answer', async () => {
    const result = await runCase(answersAtEofServer, {
      name: 'eof',
      transport: 'stdio',
      steps: [{ send: { method: 'ping' }, closeInputAfter: true }],
    }, true);

    expect(result.steps?.[0].expect).toEqual({ jsonrpc: '2.0', id: 1, result: { seen: [1] } });
    expect(result.expectExit).toEqual({ code: 0 });
  });

  it('closeInputAfter records null when the process exits without answering', async () => {
    const silent = script('silent.cjs', 'process.stdin.resume(); process.stdin.on("end", () => process.exit(0));');
    const result = await runCase(silent, { name: 'eof', transport: 'stdio', steps: [{ send: { method: 'ping' }, closeInputAfter: true }] }, true);

    expect(result.steps?.[0].expect).toBeNull();
  });

  it('sendText with noAnswer writes a line that is not JSON', async () => {
    const result = await runCase(answersAtEofServer, {
      name: 'bad line',
      transport: 'stdio',
      steps: [{ sendText: '﻿not json', noAnswer: true }, { send: { method: 'ping' }, closeInputAfter: true }],
    }, true);

    expect(result.steps?.[1].expect).toEqual({ jsonrpc: '2.0', id: 1, result: { seen: ['bad', 1] } });
  });

  it('http bodyBase64 sends the exact bytes, invalid UTF-8 included', async () => {
    const result = await runCase(echoHttpServer, {
      name: 'bytes',
      transport: 'http',
      steps: [{ http: { method: 'POST', path: '/mcp', bodyBase64: Buffer.from([0x7b, 0xff, 0xfe, 0x7d]).toString('base64') } }],
    }, true);

    expect(result.steps?.[0].expect).toEqual({ json: { hex: '7bfffe7d' } });
  });

  it('sseOrder byId compares the SSE answers of a batch by id, not by arrival', async () => {
    const batch = JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 2, method: 'ping' }]);
    const recorded = await runCase(reversedSseServer, {
      name: 'batch',
      transport: 'http',
      steps: [{ http: { method: 'POST', path: '/mcp', bodyText: batch }, sseOrder: 'byId' }],
    }, true);

    expect(recorded.steps?.[0].expect).toEqual({ sse: [{ jsonrpc: '2.0', id: 1, result: {} }, { jsonrpc: '2.0', id: 2, result: {} }] });
  });
});

const fetchRaw = (url: string): Promise<{ headers: Record<string, unknown>; body: Buffer }> => new Promise((resolve, reject) => {
  request(url, (res) => {
    const chunks: Buffer[] = [];

    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
  }).on('error', reject).end();
});

describe('MCP conformance fake host', () => {
  it.each([
    ['gzip', gunzipSync],
    ['deflate', inflateSync],
  ] as const)('a route with encoding %s sends its body compressed, with Content-Encoding', async (encoding, decode) => {
    const host = await startFakeHost({ 'GET /doc': { status: 200, json: { blocks: [] }, encoding } });

    try {
      const answer = await fetchRaw(`${host.url}/doc`);

      expect(answer.headers['content-encoding']).toBe(encoding);
      expect(decode(answer.body).toString('utf8')).toBe('{"blocks":[]}');
    } finally {
      await host.close();
    }
  });

  it('a route with dropMidBody sends part of its body, then drops the connection', async () => {
    const host = await startFakeHost({ 'GET /doc': { status: 200, text: '{"blocks":[', dropMidBody: true } });

    try {
      const outcome = await new Promise<{ partial: string; aborted: boolean }>((resolve, reject) => {
        request(`${host.url}/doc`, (res) => {
          let partial = '';

          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            partial += chunk;
          });
          res.on('aborted', () => resolve({ partial, aborted: true }));
          res.on('end', () => resolve({ partial, aborted: false }));
        }).on('error', reject).end();
      });

      expect(outcome).toEqual({ partial: '{"blocks":[', aborted: true });
    } finally {
      await host.close();
    }
  });

  it('records request header bytes as Latin-1, so a UTF-8 é shows as two characters', async () => {
    const host = await startFakeHost({ 'GET /doc': { status: 200, text: '' } });

    try {
      await new Promise<void>((resolve, reject) => {
        const req = request(`${host.url}/doc`, { headers: { authorization: Buffer.from('Bearer é', 'utf8').toString('latin1') } }, (res) => {
          res.resume();
          res.on('end', resolve);
        });

        req.on('error', reject);
        req.end();
      });

      expect(host.requests[0].headers.authorization).toBe('Bearer Ã©');
    } finally {
      await host.close();
    }
  });
});

const httpThrough = (port: number, path: string, headers: Record<string, string>, agent?: Agent): Promise<{ status: number; body: string }> => new Promise((resolve, reject) => {
  request({ host: '127.0.0.1', port, path, method: 'POST', headers, ...(agent !== undefined && { agent }) }, (res) => {
    let body = '';

    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      body += chunk;
    });
    res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
  }).on('error', reject).end();
});

describe('MCP conformance live-room proxy', () => {
  it('records plain HTTP requests, and answers the ones an answerHttp injection names', async () => {
    const upstream = createServer((req, res) => {
      res.writeHead(200).end('from upstream');
    });

    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const proxy = new FrameProxy({ host: '127.0.0.1', port: (upstream.address() as AddressInfo).port });
    const port = await proxy.start();

    try {
      proxy.injections.push({ answerHttp: { match: '/restore', status: 412 } });

      expect(await httpThrough(port, '/sync/d/history/v1/restore', { 'if-match': '"v1"', 'blok-idempotency-key': 'k' })).toEqual({ status: 412, body: '' });
      expect(await httpThrough(port, '/sync/d/history', {})).toEqual({ status: 200, body: 'from upstream' });
      expect(proxy.httpRequests).toEqual([
        { method: 'POST', path: '/sync/d/history/v1/restore', ifMatch: '"v1"', idempotencyKey: true, answered: 412 },
        { method: 'POST', path: '/sync/d/history', ifMatch: null, idempotencyKey: false, answered: null },
      ]);
    } finally {
      await proxy.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it('a closeOnOperation injection closes the agent with that code on every operation, and the host never sees one', async () => {
    const upstreamGot: Buffer[] = [];
    const upstream = createTcpServer((socket) => {
      socket.once('data', () => {
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
        socket.on('data', (chunk: Buffer) => upstreamGot.push(chunk));
      });
    });

    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const proxy = new FrameProxy({ host: '127.0.0.1', port: (upstream.address() as AddressInfo).port });
    const port = await proxy.start();
    const ticket = signTicket('s', { user: 'agent:alice:x', doc: 'd', write: true });
    const operation = Buffer.from(encode({ type: 'operation', lineage: 'a'.repeat(32), operationId: 'b'.repeat(32), update: new Uint8Array([0, 0]) }));
    // A masked client frame with a zero mask, so the payload goes as is.
    const clientFrame = Buffer.concat([Buffer.from([0x82, 0x80 | operation.length, 0, 0, 0, 0]), operation]);
    const openAgent = async (): Promise<{ socket: Socket; got: Buffer[] }> => {
      const socket = connect(port, '127.0.0.1');
      const got: Buffer[] = [];

      socket.on('data', (chunk: Buffer) => got.push(chunk));
      socket.write(`GET /sync/d HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Protocol: ${ticket}\r\n\r\n`);
      await vi.waitFor(() => expect(Buffer.concat(got).toString('latin1')).toContain('101'));

      return { socket, got };
    };

    try {
      proxy.injections.push({ closeOnOperation: 1009 });
      for (let round = 0; round < 2; round += 1) {
        const agent = await openAgent();

        agent.got.length = 0;
        agent.socket.write(clientFrame);
        await vi.waitFor(() => expect(Buffer.concat(agent.got)).toEqual(Buffer.from([0x88, 2, 0x03, 0xf1])));
        agent.socket.destroy();
      }
      expect(Buffer.concat(upstreamGot).includes(operation)).toBe(false);
    } finally {
      await proxy.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it('sees every request of a keep-alive client, not just the first on a connection', async () => {
    const upstream = createServer((req, res) => {
      res.writeHead(200).end('ok');
    });

    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const proxy = new FrameProxy({ host: '127.0.0.1', port: (upstream.address() as AddressInfo).port });
    const port = await proxy.start();
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });

    try {
      await httpThrough(port, '/sync/d/history', {}, agent);
      await httpThrough(port, '/sync/d/history/v1/restore', {}, agent);

      expect(proxy.httpRequests.map((r) => r.path)).toEqual(['/sync/d/history', '/sync/d/history/v1/restore']);
    } finally {
      agent.destroy();
      await proxy.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});
