// @vitest-environment node

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it as baseIt } from 'vitest';

import { startDocEndpoint, type FixtureDocEndpoint } from './doc-endpoint';
import {
  closePayload,
  encodeClientFrame,
  FIN,
  OP_BINARY,
  OP_CLOSE,
  OP_CONTINUATION,
  OP_PING,
  OP_PONG,
  OP_TEXT,
  openRaw,
  type OpenOptions,
  type RawSocket,
} from './raw-websocket';
import { startServer, type RunningServer } from './run-against';

/**
 * The sync door and socket as raw bytes: what is answered before the
 * upgrade, and every close code and reason after it. Each case asserts only
 * the transport outcome, never the room's frames, so it holds for C#'s real
 * room and for the conformance build of the Go server, whose room is an
 * echo stand-in until the room lands.
 *
 * Message type 105 is unassigned, so a room ignores it: it is the payload
 * for every frame that must reach the room and do nothing there.
 */
const unset = (name: string): boolean =>
  process.env[name] === undefined || process.env[name] === '';

const it = baseIt.skipIf(unset('BLOK_CONFORMANCE_SERVER'));
const onGo = process.env.BLOK_CONFORMANCE_TARGET === 'go';
/** The Go room stand-in has no operation store, so it never selects v2. */
const itNeedsAStore = baseIt.skipIf(unset('BLOK_CONFORMANCE_SERVER') || onGo);

const ALLOWED_ORIGIN = 'https://app.example.com';
const V1 = 'blok-sync.v1';
const V2 = 'blok-sync.v2';
const TICKET_DOC = 'doc-42';
const MAX_MESSAGE_BYTES = 1 << 20;
const UNKNOWN_TYPE = 105;
const TEST_TIMEOUT_MS = 30_000;

interface Tickets {
  compatible: string;
  docMismatch: string;
  malformed: string;
  secret: string;
}

const tickets = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/tickets.json', import.meta.url)),
  'utf8',
)) as Tickets;

/** An HS256 pass in the only header form the verifier accepts. */
function mintTicket(payload: Record<string, unknown>): string {
  const header = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', tickets.secret).update(`${header}.${body}`).digest('base64url');

  return `${header}.${body}.${signature}`;
}

interface Harness {
  readonly server: RunningServer;
  open(path: string, options?: OpenOptions): Promise<RawSocket>;
}

interface HarnessOptions {
  auth?: 'none' | 'ticket';
  rateLimit?: number;
  journal?: boolean;
}

async function withServer(options: HarnessOptions, run: (harness: Harness) => Promise<void>): Promise<void> {
  const auth = options.auth ?? 'none';
  const collabDirectory = await mkdtemp(join(tmpdir(), 'blok-sync-transport-'));
  let endpoint: FixtureDocEndpoint | undefined;
  let server: RunningServer | undefined;
  const sockets: RawSocket[] = [];

  try {
    endpoint = await startDocEndpoint();
    server = await startServer({
      args: [
        '--listen', '127.0.0.1:0',
        '--auth', auth,
        '--storage-dir', '',
        '--rate-limit', String(options.rateLimit ?? 0),
        '--collab',
        '--collab-dir', collabDirectory,
        '--doc-endpoint', endpoint.url,
        ...(options.journal === true ? ['--conformance-journal'] : []),
        ...(auth === 'ticket' ? ['--allow-origin', ALLOWED_ORIGIN] : []),
      ],
      env: auth === 'ticket' ? { BLOK_SECRET: tickets.secret } : {},
    });
    const running = server;

    await run({
      server: running,
      open: async (path, openOptions) => {
        const socket = await openRaw(running.baseUrl, path, openOptions);

        sockets.push(socket);

        return socket;
      },
    });
  } finally {
    for (const socket of sockets) {
      socket.destroy();
    }

    await server?.stop();
    await endpoint?.stop();
    await rm(collabDirectory, { recursive: true, force: true });
  }
}

const ticketHeaders = (...offers: string[]): [string, string][] => [
  ['Origin', ALLOWED_ORIGIN],
  ['Sec-WebSocket-Protocol', offers.join(', ')],
];

const unknownFrame = (size = 1): Buffer => {
  const payload = Buffer.alloc(size);

  payload[0] = UNKNOWN_TYPE;

  return payload;
};

/** A text frame is closed 1003 only by a live member, so it proves the socket is still served. */
async function expectStillServed(socket: RawSocket): Promise<void> {
  socket.sendFrame(FIN | OP_TEXT, Buffer.from('probe'));
  expect(await socket.closed()).toMatchObject({ code: 1003, reason: 'binary frames only' });
}

describe('sync transport: before the upgrade', () => {
  it('answers a plain GET with 426 and a text body', async () => {
    await withServer({}, async ({ open }) => {
      const socket = await open('/sync/doc', { upgrade: false });

      expect(socket.response.status).toBe(426);
      expect(socket.response.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(socket.response.body).toBe('WebSocket upgrade required\n');
    });
  }, TEST_TIMEOUT_MS);

  it('answers 426 for a version other than 13 and for a key that is not 16 bytes', async () => {
    await withServer({}, async ({ open }) => {
      expect((await open('/sync/doc', { version: '12' })).response.status).toBe(426);
      expect((await open('/sync/doc', { key: Buffer.alloc(15).toString('base64') })).response.status).toBe(426);
      expect((await open('/sync/doc', { key: Buffer.alloc(17).toString('base64') })).response.status).toBe(426);
    });
  }, TEST_TIMEOUT_MS);

  it('answers a non-GET with 405 and Allow: GET', async () => {
    await withServer({}, async ({ open }) => {
      const socket = await open('/sync/doc', { method: 'POST', upgrade: false, headers: [['Content-Length', '0']] });

      expect(socket.response.status).toBe(405);
      expect(socket.response.headers.allow).toBe('GET');
    });
  }, TEST_TIMEOUT_MS);

  it('refuses an origin outside the list with 403, also when only Sec-Fetch-Site says cross-site', async () => {
    await withServer({}, async ({ open }) => {
      const foreign = await open('/sync/doc', { headers: [['Origin', 'https://evil.example']] });

      expect(foreign.response.status).toBe(403);
      expect(foreign.response.body).toBe('origin not allowed\n');

      const crossSite = await open('/sync/doc', { headers: [['Sec-Fetch-Site', 'Cross-Site']] });

      expect(crossSite.response.status).toBe(403);
    });
  }, TEST_TIMEOUT_MS);

  it('in ticket mode refuses a missing origin with 403 and an offer without blok-sync.v1 with 400', async () => {
    await withServer({ auth: 'ticket' }, async ({ open }) => {
      const noOrigin = await open(`/sync/${TICKET_DOC}`, { headers: [['Sec-WebSocket-Protocol', `${V1}, ${tickets.compatible}`]] });

      expect(noOrigin.response.status).toBe(403);

      const noVersion = await open(`/sync/${TICKET_DOC}`, { headers: ticketHeaders(tickets.compatible) });

      expect(noVersion.response.status).toBe(400);
      expect(noVersion.response.body).toBe('blok-sync.v1 must be offered in Sec-WebSocket-Protocol\n');

      const wrongCase = await open(`/sync/${TICKET_DOC}`, { headers: ticketHeaders('BLOK-SYNC.V1', tickets.compatible) });

      expect(wrongCase.response.status).toBe(400);
    });
  }, TEST_TIMEOUT_MS);

  it('spends the rate limit on a rejection but not on a refusal, keyed on the address until a pass verifies', async () => {
    await withServer({ auth: 'ticket', rateLimit: 1 }, async ({ open }) => {
      for (let i = 0; i < 3; i++) {
        expect((await open(`/sync/${TICKET_DOC}`, { headers: [['Origin', 'https://evil.example']] })).response.status).toBe(403);
      }

      const rejected = await open(`/sync/${TICKET_DOC}`, { headers: ticketHeaders(V1) });

      expect(rejected.response.status).toBe(101);
      expect(await rejected.closed()).toMatchObject({ code: 4401, reason: 'missing pass' });

      const limited = await open(`/sync/${TICKET_DOC}`, { headers: ticketHeaders(V1, tickets.malformed) });

      expect(limited.response.status).toBe(429);
      expect(limited.response.body).toBe('rate limit exceeded\n');

      // A verified pass is billed to its user, not to the address.
      const verified = await open(`/sync/${TICKET_DOC}`, { headers: ticketHeaders(V1, tickets.compatible) });

      expect(verified.response.status).toBe(101);

      const again = await open(`/sync/${TICKET_DOC}`, { headers: ticketHeaders(V1, tickets.compatible) });

      expect(again.response.status).toBe(429);
    });
  }, TEST_TIMEOUT_MS);

  it('caps one user at 8 sockets per document with 429, and frees the slot before answering a close', async () => {
    await withServer({ auth: 'ticket' }, async ({ open }) => {
      const sockets: RawSocket[] = [];

      for (let i = 0; i < 8; i++) {
        const socket = await open(`/sync/${TICKET_DOC}`, { headers: ticketHeaders(V1, tickets.compatible) });

        expect(socket.response.status).toBe(101);
        sockets.push(socket);
      }

      const ninth = await open(`/sync/${TICKET_DOC}`, { headers: ticketHeaders(V1, tickets.compatible) });

      expect(ninth.response.status).toBe(429);
      expect(ninth.response.body).toBe('too many connections\n');

      sockets[0].sendFrame(FIN | OP_CLOSE, closePayload(1000));
      expect(await sockets[0].closed()).toMatchObject({ code: 1000, reason: '' });

      const again = await open(`/sync/${TICKET_DOC}`, { headers: ticketHeaders(V1, tickets.compatible) });

      expect(again.response.status).toBe(101);
    });
  }, TEST_TIMEOUT_MS);
});

describe('sync transport: subprotocol', () => {
  it('echoes blok-sync.v1 only when offered with that exact spelling, from either header shape', async () => {
    await withServer({}, async ({ open }) => {
      const none = await open('/sync/doc');

      expect(none.response.status).toBe(101);
      expect(none.response.headers['sec-websocket-protocol']).toBeUndefined();

      const upper = await open('/sync/doc', { headers: [['Sec-WebSocket-Protocol', 'BLOK-SYNC.V1']] });

      expect(upper.response.headers['sec-websocket-protocol']).toBeUndefined();

      const repeated = await open('/sync/doc', {
        headers: [['Sec-WebSocket-Protocol', 'other'], ['Sec-WebSocket-Protocol', ` ${V1} ,`]],
      });

      expect(repeated.response.headers['sec-websocket-protocol']).toBe(V1);

      const both = await open('/sync/doc', { headers: [['Sec-WebSocket-Protocol', `${V2}, ${V1}`]] });

      expect(both.response.headers['sec-websocket-protocol']).toBe(V1);
    });
  }, TEST_TIMEOUT_MS);

  itNeedsAStore('selects blok-sync.v2 when the server keeps a journal', async () => {
    await withServer({ journal: true }, async ({ open }) => {
      const both = await open('/sync/doc', { headers: [['Sec-WebSocket-Protocol', `${V1}, ${V2}`]] });

      expect(both.response.headers['sec-websocket-protocol']).toBe(V2);
    });
  }, TEST_TIMEOUT_MS);
});

describe('sync transport: accept, then close', () => {
  it('closes a multi-segment doc id 4400, before the ticket checks', async () => {
    await withServer({ auth: 'ticket' }, async ({ open }) => {
      const socket = await open('/sync/a%2Fb', { headers: [['Origin', ALLOWED_ORIGIN]] });

      expect(socket.response.status).toBe(101);
      expect(socket.response.headers['sec-websocket-protocol']).toBeUndefined();
      expect(await socket.closed()).toMatchObject({ code: 4400, reason: 'document ids must be a single path segment' });
    });
  }, TEST_TIMEOUT_MS);

  it('closes 4401 with the reason for each bad pass, echoing blok-sync.v1', async () => {
    await withServer({ auth: 'ticket' }, async ({ open }) => {
      const cases: [string[], string][] = [
        [[V1], 'missing pass'],
        [[V1, V2], 'missing pass'],
        [[V1, tickets.malformed], 'invalid pass'],
        [[V1, tickets.docMismatch], 'pass is for another document'],
        [[V1, mintTicket({ doc: TICKET_DOC, write: true, exp: 4102444800 })], 'pass names no user'],
      ];

      for (const [offers, reason] of cases) {
        const socket = await open(`/sync/${TICKET_DOC}`, { headers: ticketHeaders(...offers) });

        expect(socket.response.status, reason).toBe(101);
        expect(socket.response.headers['sec-websocket-protocol'], reason).toBe(V1);
        expect(await socket.closed(), reason).toMatchObject({ code: 4401, reason });
      }
    });
  }, TEST_TIMEOUT_MS);

  it('tries every offered token as the pass', async () => {
    await withServer({ auth: 'ticket' }, async ({ open }) => {
      const socket = await open(`/sync/${TICKET_DOC}`, { headers: ticketHeaders(tickets.malformed, V1, tickets.compatible) });

      expect(socket.response.status).toBe(101);
      await expectStillServed(socket);
    });
  }, TEST_TIMEOUT_MS);

  it('ends a rejected socket about 250 ms after its close when the peer never answers', async () => {
    await withServer({ auth: 'ticket' }, async ({ open }) => {
      const socket = await open(`/sync/${TICKET_DOC}`, { headers: ticketHeaders(V1) });
      const close = await socket.closed();
      const ended = await socket.ended();

      expect(ended - close.at).toBeGreaterThanOrEqual(150);
      expect(ended - close.at).toBeLessThan(2_000);
    });
  }, TEST_TIMEOUT_MS);

  it('reads and drops frames after a rejection until the peer closes', async () => {
    await withServer({ auth: 'ticket' }, async ({ open }) => {
      const socket = await open(`/sync/${TICKET_DOC}`, { headers: ticketHeaders(V1) });

      socket.sendFrame(FIN | OP_TEXT, Buffer.from('dropped'));
      socket.sendFrame(FIN | OP_BINARY, unknownFrame());
      socket.sendFrame(FIN | OP_CLOSE, closePayload(1000));

      expect(await socket.closed()).toMatchObject({ code: 4401, reason: 'missing pass' });
      await socket.ended();
      expect(socket.frames.filter((frame) => frame.opcode === OP_CLOSE)).toHaveLength(1);
    });
  }, TEST_TIMEOUT_MS);
});

describe('sync transport: a served socket', () => {
  it('answers the peer close with 1000 and no reason', async () => {
    await withServer({}, async ({ open }) => {
      const socket = await open('/sync/doc');

      socket.sendFrame(FIN | OP_CLOSE, closePayload(1000, 'bye'));
      expect(await socket.closed()).toMatchObject({ code: 1000, reason: '' });
      await socket.ended();
    });
  }, TEST_TIMEOUT_MS);

  it('answers a ping with a pong carrying the same bytes', async () => {
    await withServer({}, async ({ open }) => {
      const socket = await open('/sync/doc');

      socket.sendFrame(FIN | OP_PING, Buffer.from('are you there'));
      expect((await socket.frame(OP_PONG)).payload.toString()).toBe('are you there');
    });
  }, TEST_TIMEOUT_MS);

  it('closes a text frame 1003, then waits about 5 s for the peer close', async () => {
    await withServer({}, async ({ open }) => {
      const socket = await open('/sync/doc');

      socket.sendFrame(FIN | OP_TEXT, Buffer.from('hello'));

      const close = await socket.closed();

      expect(close).toMatchObject({ code: 1003, reason: 'binary frames only' });

      const ended = await socket.ended(15_000);

      expect(ended - close.at).toBeGreaterThanOrEqual(4_000);
      expect(ended - close.at).toBeLessThan(8_000);
    });
  }, TEST_TIMEOUT_MS);

  it('serves a message of exactly the cap and closes one byte over it 1009', async () => {
    await withServer({}, async ({ open }) => {
      const atCap = await open('/sync/doc');
      const whole = unknownFrame(MAX_MESSAGE_BYTES);

      atCap.sendFrame(OP_BINARY, whole.subarray(0, 1000));
      atCap.sendFrame(FIN | OP_CONTINUATION, whole.subarray(1000));
      await expectStillServed(atCap);

      const over = await open('/sync/doc');
      const tooBig = unknownFrame(MAX_MESSAGE_BYTES + 1);

      over.sendFrame(OP_BINARY, tooBig.subarray(0, 1000));
      over.sendFrame(FIN | OP_CONTINUATION, tooBig.subarray(1000));
      expect(await over.closed()).toMatchObject({ code: 1009, reason: 'message too big' });
    });
  }, TEST_TIMEOUT_MS);

  it('serves a message in 16 receives and closes the 17th 1008', async () => {
    await withServer({}, async ({ open }) => {
      const fragments = (count: number): { first: number; payload?: Uint8Array }[] => [
        { first: OP_BINARY },
        ...Array.from({ length: count - 2 }, () => ({ first: OP_CONTINUATION })),
        { first: FIN | OP_CONTINUATION, payload: unknownFrame() },
      ];

      const sixteen = await open('/sync/doc');

      sixteen.sendFrames(fragments(16));
      await expectStillServed(sixteen);

      const seventeen = await open('/sync/doc');

      seventeen.sendFrames(fragments(17));
      expect(await seventeen.closed()).toMatchObject({ code: 1008, reason: 'inbound rate exceeded' });
    });
  }, TEST_TIMEOUT_MS);

  it('counts receives, not frames: a message dribbled a byte at a time', async () => {
    await withServer({}, async ({ open }) => {
      const socket = await open('/sync/doc');
      const bytes = [...Buffer.from(encodeDribble())];

      for (const byte of bytes) {
        socket.sendRaw(Buffer.from([byte]));
        await new Promise((resolve) => setTimeout(resolve, 2));
      }

      // A receive fills the buffer or ends the frame (ReadAtLeastAsync), so
      // dribbled bytes are one receive, not a thousand.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(socket.frames.some((frame) => frame.opcode === OP_CLOSE)).toBe(false);
      await expectStillServed(socket);
    });
  }, 60_000);

  it('closes 1008 past the frame burst', async () => {
    await withServer({}, async ({ open }) => {
      const socket = await open('/sync/doc');

      socket.sendFrames(Array.from({ length: 150 }, () => ({ first: FIN | OP_BINARY, payload: unknownFrame() })));
      expect(await socket.closed()).toMatchObject({ code: 1008, reason: 'inbound rate exceeded' });
    });
  }, TEST_TIMEOUT_MS);

  it('serves 10 resyncs and closes 1008 past them, reading the type as a varuint', async () => {
    // [0x80, 0x00] is a non-canonical 0: still a sync frame.
    const resync = Buffer.from([0x80, 0x00, 0x00, 0x00]);

    await withServer({}, async ({ open }) => {
      const ten = await open('/sync/doc');

      ten.sendFrames(Array.from({ length: 10 }, () => ({ first: FIN | OP_BINARY, payload: resync })));
      await expectStillServed(ten);

      const twenty = await open('/sync/doc');

      twenty.sendFrames(Array.from({ length: 20 }, () => ({ first: FIN | OP_BINARY, payload: resync })));
      expect(await twenty.closed()).toMatchObject({ code: 1008, reason: 'inbound rate exceeded' });
    });
  }, TEST_TIMEOUT_MS);

  it('closes 1008 for one awareness frame over the 512 KiB burst', async () => {
    await withServer({}, async ({ open }) => {
      const socket = await open('/sync/doc');
      const awareness = Buffer.alloc(512 * 1024 + 1);

      awareness[0] = 1;
      socket.sendFrame(FIN | OP_BINARY, awareness);
      expect(await socket.closed()).toMatchObject({ code: 1008, reason: 'inbound rate exceeded' });
    });
  }, TEST_TIMEOUT_MS);
});

describe('sync transport: frames RFC 6455 refuses', () => {
  const cases: [string, (socket: RawSocket) => void, number][] = [
    // A server waits for the four mask bytes before it checks the mask bit.
    ['an unmasked frame', (s) => s.sendFrame(FIN | OP_BINARY, unknownFrame(8), { masked: false }), 1002],
    ['a reserved bit', (s) => s.sendFrame(FIN | 0x40 | OP_BINARY, unknownFrame()), 1002],
    ['an unknown opcode', (s) => s.sendFrame(FIN | 0x3, unknownFrame()), 1002],
    ['a continuation with nothing to continue', (s) => s.sendFrame(FIN | OP_CONTINUATION, unknownFrame()), 1002],
    ['a new message inside a fragmented one', (s) => {
      s.sendFrame(OP_BINARY, unknownFrame());
      s.sendFrame(FIN | OP_BINARY, unknownFrame());
    }, 1002],
    ['a fragmented ping', (s) => s.sendFrame(OP_PING, Buffer.from('x')), 1002],
    ['a ping over 125 bytes', (s) => s.sendFrame(FIN | OP_PING, Buffer.alloc(126)), 1002],
    ['a close with one byte', (s) => s.sendFrame(FIN | OP_CLOSE, Buffer.from([3])), 1002],
    ['a close with status 1005', (s) => s.sendFrame(FIN | OP_CLOSE, closePayload(1005)), 1002],
    ['a close reason that is not UTF-8', (s) => s.sendFrame(FIN | OP_CLOSE, Buffer.concat([closePayload(1000), Buffer.from([0xff])])), 1002],
    ['a text frame that is not UTF-8', (s) => s.sendFrame(FIN | OP_TEXT, Buffer.from([0xc3, 0x28])), 1007],
  ];

  for (const [name, send, code] of cases) {
    it(`closes ${name} ${code} with no reason`, async () => {
      await withServer({}, async ({ open }) => {
        const socket = await open('/sync/doc');

        send(socket);
        expect(await socket.closed()).toMatchObject({ code, reason: '' });
      });
    }, TEST_TIMEOUT_MS);
  }
});

/** 1 KiB in one frame: 16 + 1024 / 64 = 32 receives allowed. */
function encodeDribble(): Buffer {
  return encodeClientFrame(FIN | OP_BINARY, unknownFrame(1024));
}
