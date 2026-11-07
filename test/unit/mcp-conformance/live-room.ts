import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as Y from 'yjs';

import { createCollabProvider } from '../../../src/components/modules/collaboration/provider';
import { decode, encode } from '../../../src/components/modules/collaboration/sync-wire';
import type { CollabDocSeam, CollabProvider } from '../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import { nodeSocketFactory } from '../../../src/mcp/live/node-socket';
import { htmlToSegmentsNode } from '../../../src/view/rich-text-node';
import { startDocEndpoint, type FixtureDocEndpoint } from '../server-conformance/doc-endpoint';
import { startServer, type RunningServer } from '../server-conformance/run-against';

/**
 * A real sync room for the live group: the conformance host the runner built
 * (BLOK_CONFORMANCE_SERVER), behind a transparent TCP proxy that logs every
 * WebSocket frame. The MCP under test and the scripted peers all connect
 * through the proxy, so "quiet" means no socket moved.
 *
 * Room step actions (one key each, see `act`):
 *   {"peer": name, "connect": true, "doc"?}  join as a human (v1, like a browser without an outbox)
 *   {"peer": name, "edit": [Edit]}        one local transaction; see PeerEdit
 *   {"peer": name, "read": true}          the peer's blocks, after the room is quiet
 *   {"peer": name, "presence": true}      the agent awareness states the peer sees
 *   {"peer": name, "hold": true|false}    queue / release what the peer sends to the host
 *   {"peer": name, "leave": true}
 *   {"frames": true | "withPeers"}        agent frames since the last call, per connection
 *   {"upgrades": true}                    every distinct upgrade answer so far, and whether it repeated
 *   {"inject": Injection}                 a fault: drop the agent's next ack, reject its next
 *                                         operation, refuse every upgrade from now on, close it now,
 *                                         send it a QueryAwareness now, or cut every history request
 *                                         from now on before it is answered
 *   {"settle": true}                      wait for quiet
 *   {"wait": ms}                          sleep, then wait for quiet
 *   {"history": true}                     the host's GET /sync/<doc>/history, normalized
 *
 * Writing cases: settle after every batch. The agent sends at most one awareness
 * frame per 100 ms, so two batches closer than that merge their frames. After a
 * close (injected or a redrive), wait past the reconnect backoff before reading frames.
 */

export const ROOM_SECRET = 'mcp-live-conformance-secret-0123456789';
export const ROOM_ORIGIN = 'https://app.example.com';
export const ROOM_DOC = 'live-doc';

// Longer than the provider's 100 ms awareness throttle.
const QUIET_MS = 300;
const SETTLE_LIMIT_MS = 15_000;

export interface RoomSpec { journal?: boolean }

export type PeerEdit =
  | { insert: { id: string; type: string; data: Record<string, unknown>; index?: number } }
  | { set: { id: string; key: string; value: unknown } }
  | { text: { id: string; key: string; index: number; insert?: string; delete?: number } }
  | { remove: string };

export type Injection =
  | { dropAck: true }
  | { reject: string }
  | { close: number }
  | { refuseUpgrades: number }
  | { queryAwareness: true }
  | { cutHistory: true };

export interface RoomAction {
  peer?: string;
  /** With connect: the room to join; the case's document by default. */
  doc?: string;
  connect?: boolean;
  edit?: PeerEdit[];
  read?: boolean;
  presence?: boolean;
  hold?: boolean;
  leave?: boolean;
  /** "withPeers" also lists the peers in the agent's awareness frames; when a peer's state lands is a race. */
  frames?: boolean | 'withPeers';
  upgrades?: boolean;
  inject?: Injection;
  settle?: boolean;
  /** Milliseconds to sleep, for a timer the case waits out (the 15 s redrive). */
  wait?: number;
  history?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** The ticket's `user`, read from the offered subprotocols without checking it. */
const claimedUser = (offer: string): string | undefined => {
  const parts = offer.split('.');

  if (parts.length !== 3) {
    return undefined;
  }
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));

    return isRecord(payload) && typeof payload.user === 'string' ? payload.user : undefined;
  } catch {
    return undefined;
  }
};

const ticketUser = (protocols: string): string | undefined =>
  protocols.split(',').map((part) => claimedUser(part.trim())).find((user) => user !== undefined);

/** Signed like packages/server/src/ticket.ts, so the host accepts it. */
export const signTicket = (secret: string, claims: Record<string, unknown>): string => {
  const head = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');

  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
};

interface WsFrame { fin: boolean; opcode: number; payload: Buffer; raw: Buffer }

/** Reads RFC 6455 frames from a byte stream; partial frames wait for more bytes. */
class FrameReader {
  private buffer = Buffer.alloc(0);

  public push(chunk: Buffer): WsFrame[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: WsFrame[] = [];

    for (;;) {
      const frame = this.next();

      if (frame === undefined) {
        return frames;
      }
      frames.push(frame);
    }
  }

  private next(): WsFrame | undefined {
    const b = this.buffer;

    if (b.length < 2) {
      return undefined;
    }
    if ((b[0] & 0x70) !== 0) {
      throw new Error('live-room proxy: a frame set RSV bits; this proxy reads uncompressed frames only');
    }
    const masked = (b[1] & 0x80) !== 0;
    const short = b[1] & 0x7f;
    const lengthBytes = { 126: 2, 127: 8 }[short] ?? 0;
    const head = 2 + lengthBytes + (masked ? 4 : 0);

    if (b.length < head) {
      return undefined;
    }
    const longLength = (): number => (short === 127 ? Number(b.readBigUInt64BE(2)) : short);
    const length = short === 126 ? b.readUInt16BE(2) : longLength();

    if (b.length < head + length) {
      return undefined;
    }
    const payload = Buffer.from(b.subarray(head, head + length));

    if (masked) {
      const key = b.subarray(2 + lengthBytes, head);

      for (let i = 0; i < payload.length; i += 1) {
        payload[i] ^= key[i % 4];
      }
    }
    const raw = Buffer.from(b.subarray(0, head + length));

    this.buffer = Buffer.from(b.subarray(head + length));

    return { fin: (b[0] & 0x80) !== 0, opcode: b[0] & 0x0f, payload, raw };
  }
}

/** An unmasked server frame. */
const serverFrame = (opcode: number, payload: Buffer): Buffer => {
  const length = payload.length;
  const head = length < 126
    ? Buffer.from([0x80 | opcode, length])
    : Buffer.from([0x80 | opcode, 126, length >> 8, length & 0xff]);

  return Buffer.concat([head, payload]);
};

const closePayload = (code: number): Buffer => {
  const payload = Buffer.alloc(2);

  payload.writeUInt16BE(code);

  return payload;
};

interface Logged { conn: number; dir: 'out' | 'in'; bytes?: Uint8Array; close?: number | null; fault?: 'dropped' | 'injected' }

interface Connection {
  id: number;
  label: string;
  doc: string;
  user: string | undefined;
  client: Socket;
  upstream: Socket;
  holding: boolean;
  held: Buffer[];
}

class FrameProxy {
  public readonly log: Logged[] = [];
  public readonly upgrades: Array<{ label: string; status: number }> = [];
  public lastActivity = Date.now();
  public readonly connections: Connection[] = [];
  public readonly injections: Injection[] = [];
  private server: Server | undefined;
  private readonly sockets = new Set<Socket>();
  private readonly holdUsers = new Set<string>();

  public constructor(private readonly target: { host: string; port: number }) {}

  public async start(): Promise<number> {
    this.server = createServer((client) => this.accept(client));
    await new Promise<void>((done) => this.server?.listen(0, '127.0.0.1', done));
    const address = this.server.address();

    if (address === null || typeof address === 'string') {
      throw new Error('live-room proxy has no port');
    }

    return address.port;
  }

  public setHold(user: string, hold: boolean): void {
    if (hold) {
      this.holdUsers.add(user);
    } else {
      this.holdUsers.delete(user);
    }
    for (const connection of this.connections.filter((c) => c.user === user)) {
      connection.holding = hold;
      if (!hold) {
        connection.held.splice(0).forEach((raw) => connection.upstream.write(raw));
      }
    }
  }

  public async close(): Promise<void> {
    this.sockets.forEach((socket) => socket.destroy());
    await new Promise<void>((done) => (this.server === undefined ? done() : this.server.close(() => done())));
  }

  private touch(): void {
    this.lastActivity = Date.now();
  }

  private track(socket: Socket): void {
    this.sockets.add(socket);
    socket.once('close', () => this.sockets.delete(socket));
    socket.on('error', () => undefined);
  }

  private accept(client: Socket): void {
    this.track(client);
    let head = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      this.touch();
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');

      if (end < 0) {
        return;
      }
      client.off('data', onData);
      this.route(client, head.subarray(0, end + 4), head.subarray(end + 4));
    };

    client.on('data', onData);
  }

  private route(client: Socket, head: Buffer, rest: Buffer): void {
    const text = head.toString('latin1');
    const [requestLine, ...lines] = text.split('\r\n');
    const headers = new Map(lines.filter((line) => line.includes(':')).map((line) => {
      const colon = line.indexOf(':');

      return [line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()] as const;
    }));
    const path = requestLine.split(' ')[1] ?? '';
    const isUpgrade = (headers.get('upgrade') ?? '').toLowerCase() === 'websocket';
    const upstream = createConnection(this.target);

    this.track(upstream);
    if (!isUpgrade && path.includes('/history') && this.injections.some((injection) => 'cutHistory' in injection)) {
      // No answer at all, as when the route is down.
      upstream.destroy();
      client.destroy();

      return;
    }
    if (!isUpgrade) {
      // Plain HTTP (the history routes): pass it through untouched.
      upstream.write(Buffer.concat([head, rest]));
      client.pipe(upstream);
      upstream.pipe(client);
      client.on('data', () => this.touch());
      upstream.on('data', () => this.touch());
      upstream.once('close', () => client.destroy());
      client.once('close', () => upstream.destroy());

      return;
    }
    const user = ticketUser(headers.get('sec-websocket-protocol') ?? '');
    const doc = decodeURIComponent(path.split('/').at(-1) ?? '');
    const label = user?.startsWith('agent:') === true ? 'agent' : `peer:${user ?? '?'}`;
    const refusal = this.injections.find((injection) => 'refuseUpgrades' in injection);

    if (refusal !== undefined && 'refuseUpgrades' in refusal && label === 'agent') {
      upstream.destroy();
      this.upgrades.push({ label, status: refusal.refuseUpgrades });
      client.end(`HTTP/1.1 ${refusal.refuseUpgrades} Refused\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);

      return;
    }
    const connection: Connection = {
      id: this.connections.length,
      label,
      doc,
      user,
      client,
      upstream,
      holding: user !== undefined && this.holdUsers.has(user),
      held: [],
    };

    this.connections.push(connection);
    upstream.write(Buffer.concat([head, rest]));
    this.pipeResponse(connection);
    client.once('close', () => upstream.destroy());
    upstream.once('close', () => client.destroy());
  }

  private takeInjection<K extends 'dropAck' | 'reject'>(kind: K): Extract<Injection, Record<K, unknown>> | undefined {
    const index = this.injections.findIndex((injection) => kind in injection);

    if (index < 0) {
      return undefined;
    }

    return this.injections.splice(index, 1)[0] as Extract<Injection, Record<K, unknown>>;
  }

  private pipeResponse(connection: Connection): void {
    const { client, upstream } = connection;
    let head = Buffer.alloc(0);
    const onHead = (chunk: Buffer): void => {
      this.touch();
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');

      if (end < 0) {
        return;
      }
      upstream.off('data', onHead);
      const status = Number(head.subarray(0, end).toString('latin1').split(' ')[1]);

      this.upgrades.push({ label: connection.label, status });
      client.write(head.subarray(0, end + 4));
      if (status !== 101) {
        client.write(head.subarray(end + 4));
        upstream.pipe(client);

        return;
      }
      this.frames(connection, head.subarray(end + 4));
    };

    upstream.on('data', onHead);
  }

  private frames(connection: Connection, firstServerBytes: Buffer): void {
    const { client, upstream } = connection;
    const fromServer = new FrameReader();
    const fromClient = new FrameReader();
    const message = { in: [] as Buffer[], out: [] as Buffer[] };

    const record = (dir: 'in' | 'out', frame: WsFrame): void => {
      if (frame.opcode === 8) {
        this.log.push({ conn: connection.id, dir, close: frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : null });

        return;
      }
      if (frame.opcode !== 0 && frame.opcode !== 2) {
        return;
      }
      message[dir].push(frame.payload);
      if (frame.fin) {
        this.log.push({ conn: connection.id, dir, bytes: new Uint8Array(Buffer.concat(message[dir].splice(0))) });
      }
    };

    const onServer = (chunk: Buffer): void => {
      this.touch();
      for (const frame of fromServer.push(chunk)) {
        if (connection.label === 'agent' && frame.opcode === 2 && this.intercept(connection, frame)) {
          continue;
        }
        record('in', frame);
        client.write(frame.raw);
      }
    };
    const onClient = (chunk: Buffer): void => {
      this.touch();
      for (const frame of fromClient.push(chunk)) {
        record('out', frame);
        if (connection.label === 'agent' && frame.opcode === 2 && this.rejectOperation(connection, frame.payload)) {
          continue;
        }
        if (connection.holding) {
          connection.held.push(frame.raw);
        } else {
          upstream.write(frame.raw);
        }
      }
    };

    upstream.on('data', onServer);
    client.on('data', onClient);
    if (firstServerBytes.length > 0) {
      onServer(firstServerBytes);
    }
  }

  /** True when the host must not see the operation: the agent gets a rejection instead. */
  private rejectOperation(connection: Connection, payload: Buffer): boolean {
    const frame = decode(new Uint8Array(payload));

    if (frame.type !== 'operation') {
      return false;
    }
    const rejection = this.takeInjection('reject');

    if (rejection === undefined) {
      return false;
    }
    const bytes = encode({ type: 'rejection', lineage: frame.lineage, operationId: frame.operationId, code: rejection.reject });

    this.log.push({ conn: connection.id, dir: 'in', bytes, fault: 'injected' });
    connection.client.write(serverFrame(2, Buffer.from(bytes)));

    return true;
  }

  /** True when the frame must not reach the agent. */
  private intercept(connection: Connection, frame: WsFrame): boolean {
    const decoded = decode(new Uint8Array(frame.payload));

    if (decoded.type === 'acknowledgement' && this.takeInjection('dropAck') !== undefined) {
      this.log.push({ conn: connection.id, dir: 'in', bytes: new Uint8Array(frame.payload), fault: 'dropped' });

      return true;
    }

    return false;
  }

  private openAgent(): Connection {
    const connection = [...this.connections].reverse().find((c) => c.label === 'agent' && !c.client.destroyed);

    if (connection === undefined) {
      throw new Error('live-room: no open agent socket');
    }

    return connection;
  }

  public queryAgent(): void {
    const connection = this.openAgent();
    const bytes = encode({ type: 'queryAwareness' });

    this.log.push({ conn: connection.id, dir: 'in', bytes, fault: 'injected' });
    connection.client.write(serverFrame(2, Buffer.from(bytes)));
  }

  /** Closes the agent's newest socket with `code`, as if the host had. */
  public closeAgent(code: number): void {
    const connection = this.openAgent();

    this.log.push({ conn: connection.id, dir: 'in', close: code, fault: 'injected' });
    connection.upstream.destroy();
    connection.client.write(serverFrame(8, closePayload(code)));
  }
}


/** One awareness update as role + state keys; clientIDs and clocks vary per run. */
const awarenessEntries = (update: Uint8Array): Array<{ clientId: number; state: Record<string, unknown> | null }> => {
  // lib0's varuint: seven bits per byte, low bits first. Read here because lib0 is not a declared dependency.
  const cursor = { at: 0 };
  const readVarUint = (): number => {
    let num = 0;
    let scale = 1;

    for (;;) {
      if (cursor.at >= update.length) {
        throw new Error('awareness update ends inside a varuint');
      }
      const byte = update[cursor.at++];

      num += (byte & 0x7f) * scale;
      if (byte < 0x80) {
        return num;
      }
      scale *= 128;
    }
  };
  const readVarString = (): string => {
    const length = readVarUint();

    if (cursor.at + length > update.length) {
      throw new Error('awareness update ends inside a string');
    }
    const text = new TextDecoder().decode(update.subarray(cursor.at, cursor.at + length));

    cursor.at += length;

    return text;
  };
  const count = readVarUint();

  return Array.from({ length: count }, () => {
    const clientId = readVarUint();

    readVarUint();
    const state: unknown = JSON.parse(readVarString());

    return { clientId, state: isRecord(state) ? state : null };
  });
};

interface Peer { name: string; store: DocumentStore; provider: CollabProvider; destroy(): void }

const seamFor = (store: DocumentStore): CollabDocSeam => ({
  applyRemoteUpdate: (update, origin) => store.applyRemoteUpdate(update, origin),
  onDocUpdate: (callback) => store.onUpdate(callback),
  onAnyDocUpdate: (callback) => store.onAnyUpdate(callback),
  getStateVector: () => store.getStateVector(),
  encodeStateAsUpdate: (stateVector) => store.encodeStateAsUpdate(stateVector),
  enableAwareness: () => store.enableAwareness(),
  setAwarenessField: (field, value) => store.setAwarenessField(field, value),
  getAwarenessStates: () => store.getAwarenessStates(),
  onAwarenessChange: (callback) => store.onAwarenessChange(callback),
  onAwarenessUpdate: (callback) => store.onAwarenessUpdate(callback),
  encodeAwarenessUpdate: (clients) => store.encodeAwarenessUpdate(clients),
  encodeLocalAwarenessDeparture: () => store.encodeLocalAwarenessDeparture(),
  applyAwarenessUpdate: (update, origin) => store.applyAwarenessUpdate(update, origin),
  clearRemoteAwarenessStates: () => store.clearRemoteAwarenessStates(),
  resetForRelineage: () => store.resetForRelineage(),
});

const dataMap = (store: DocumentStore, id: string): Y.Map<unknown> => {
  const data = store.getBlockById(id)?.get('data');

  if (!(data instanceof Y.Map)) {
    throw new Error(`live-room peer: no block ${id}`);
  }

  return data;
};

const applyEdit = (store: DocumentStore, edit: PeerEdit): void => {
  if ('insert' in edit) {
    store.addBlock({ id: edit.insert.id, type: edit.insert.type, data: edit.insert.data }, edit.insert.index);
  } else if ('set' in edit) {
    store.updateBlockData(edit.set.id, edit.set.key, edit.set.value);
  } else if ('text' in edit) {
    const text = dataMap(store, edit.text.id).get(edit.text.key);

    if (!(text instanceof Y.XmlText)) {
      throw new Error(`live-room peer: ${edit.text.id}.${edit.text.key} is not rich text`);
    }
    if (edit.text.delete !== undefined) {
      text.delete(edit.text.index, edit.text.delete);
    }
    if (edit.text.insert !== undefined) {
      text.insert(edit.text.index, edit.text.insert);
    }
  } else {
    store.removeBlock(edit.remove);
  }
};

export interface LiveRoom {
  /** ws://127.0.0.1:<proxy>/sync */
  wsUrl: string;
  act(action: RoomAction): Promise<unknown>;
  close(): Promise<void>;
}

export const startLiveRoom = async (spec: RoomSpec): Promise<LiveRoom> => {
  const collabDirectory = await mkdtemp(join(tmpdir(), 'blok-mcp-live-'));
  const cleanups: Array<() => Promise<void>> = [() => rm(collabDirectory, { recursive: true, force: true })];
  const cleanup = async (): Promise<void> => {
    for (const step of cleanups.splice(0).reverse()) {
      await step().catch(() => undefined);
    }
  };

  try {
    const endpoint: FixtureDocEndpoint = await startDocEndpoint();

    cleanups.push(() => endpoint.stop());
    const server: RunningServer = await startServer({
      args: [
        '--listen', '127.0.0.1:0', '--auth', 'ticket', '--storage-dir', '', '--rate-limit', '0',
        '--collab', '--collab-dir', collabDirectory, '--doc-endpoint', endpoint.url,
        ...(spec.journal === false ? [] : ['--conformance-journal']), '--allow-origin', ROOM_ORIGIN,
      ],
      env: { BLOK_SECRET: ROOM_SECRET },
    });

    cleanups.push(() => server.stop());
    const target = new URL(server.baseUrl);
    const proxy = new FrameProxy({ host: target.hostname, port: Number(target.port) });
    const port = await proxy.start();

    cleanups.push(() => proxy.close());

    return roomApi(`ws://127.0.0.1:${port}/sync`, server, proxy, cleanup);
  } catch (error) {
    await cleanup();
    throw error;
  }
};

const roomApi = (wsUrl: string, server: RunningServer, proxy: FrameProxy, cleanup: () => Promise<void>): LiveRoom => {
  const peers = new Map<string, Peer>();
  const names = { lineage: new Map<string, string>(), operation: new Map<string, string>(), doc: new Map<string, string>([[ROOM_DOC, ROOM_DOC]]) };
  const clientRoles = new Map<number, string>();
  let mark = 0;

  const nameOf = (map: Map<string, string>, prefix: string, value: string): string => {
    if (!map.has(value)) {
      map.set(value, `${prefix}${map.size + 1}`);
    }

    return map.get(value) ?? value;
  };

  const settle = async (): Promise<void> => {
    const deadline = Date.now() + SETTLE_LIMIT_MS;

    await sleep(QUIET_MS);
    while (Date.now() - proxy.lastActivity < QUIET_MS) {
      if (Date.now() > deadline) {
        throw new Error('live-room: the room never went quiet');
      }
      await sleep(50);
    }
  };

  const roleOf = (clientId: number, state: Record<string, unknown> | null): string => {
    const user = state !== null && isRecord(state.user) ? state.user : undefined;

    if (state !== null && state.agent !== undefined) {
      clientRoles.set(clientId, 'agent');
    } else if (user !== undefined && typeof user.id === 'string') {
      clientRoles.set(clientId, `peer:${user.id}`);
    }

    return clientRoles.get(clientId) ?? 'unknown';
  };

  const describeFrame = (entry: Logged, withPeers: boolean): unknown => {
    const described = describeBytes(entry, withPeers);

    return entry.fault === undefined ? described : { ...described, fault: entry.fault };
  };

  const describeBytes = (entry: Logged, withPeers: boolean): Record<string, unknown> => {
    if (entry.close !== undefined) {
      return { type: 'close', code: entry.close };
    }
    const frame = decode(entry.bytes ?? new Uint8Array());

    switch (frame.type) {
      case 'control':
        return { type: 'control', format: frame.tag.format, epoch: typeof frame.tag.epoch, lineage: nameOf(names.lineage, 'L', frame.tag.lineage) };
      case 'limits':
        return { type: 'limits', maxMessageBytes: typeof frame.maxMessageBytes };
      case 'operation':
        return { type: 'operation', lineage: nameOf(names.lineage, 'L', frame.lineage), operationId: nameOf(names.operation, 'op', frame.operationId) };
      case 'acknowledgement':
        return {
          type: 'acknowledgement',
          lineage: nameOf(names.lineage, 'L', frame.lineage),
          operationId: nameOf(names.operation, 'op', frame.operationId),
          serverSequence: frame.serverSequence,
        };
      case 'rejection':
        return { type: 'rejection', lineage: nameOf(names.lineage, 'L', frame.lineage), operationId: nameOf(names.operation, 'op', frame.operationId), code: frame.code };
      case 'awareness':
        return {
          type: 'awareness',
          states: awarenessEntries(frame.update)
            // The agent never relays a peer's departure, so a null state it sends is its own.
            .map(({ clientId, state }) => ({ client: entry.dir === 'out' && state === null ? 'agent' : roleOf(clientId, state), keys: state === null ? null : Object.keys(state).sort() }))
            .filter((entry) => withPeers || entry.client === 'agent'),
        };
      case 'permissionDenied':
        return { type: 'permissionDenied', reason: frame.reason };
      case 'unknown':
        return { type: 'unknown', messageType: frame.messageType };
      case 'malformed':
        return { type: 'malformed' };
      case 'activity':
      case 'identities':
      case 'queryAwareness':
      case 'syncStep1':
      case 'syncStep2':
      case 'update':
        return { type: frame.type };
    }
  };

  // Presence and identity frames depend on when peers join, so IN keeps the protocol and doc frames only.
  const IN_SKIPPED = new Set(['awareness', 'identities', 'queryAwareness']);
  const SYNC_ROUND = new Set(['syncStep1', 'syncStep2']);

  const frames = (withPeers: boolean): unknown => {
    const entries = proxy.log.slice(mark);

    mark = proxy.log.length;
    const out: Record<string, { out: unknown[]; in: unknown[] }> = {};

    for (const entry of entries) {
      const connection = proxy.connections[entry.conn];

      if (connection.label !== 'agent') {
        continue;
      }
      const key = `agent ${nameOf(names.doc, 'doc', connection.doc)} #${proxy.connections.filter((c) => c.label === 'agent' && c.id <= connection.id).length}`;
      const described = describeFrame(entry, withPeers);

      out[key] ??= { out: [], in: [] };
      if (entry.dir === 'in' && entry.fault === undefined && isRecord(described) && IN_SKIPPED.has(String(described.type))) {
        continue;
      }
      const type = isRecord(described) ? String(described.type) : '';

      // A page room closes right after its first sync, so whether the residual SyncStep1 round fits is a race.
      if (connection.doc !== ROOM_DOC && SYNC_ROUND.has(type) && out[key][entry.dir].some((seen) => isRecord(seen) && seen.type === type)) {
        continue;
      }
      out[key][entry.dir].push(described);
    }

    return out;
  };

  const peerFor = (name: string | undefined): Peer => {
    const peer = name === undefined ? undefined : peers.get(name);

    if (peer === undefined) {
      throw new Error(`live-room: no connected peer ${String(name)}`);
    }

    return peer;
  };

  const connectPeer = async (name: string, doc = ROOM_DOC): Promise<null> => {
    const store = new DocumentStore(new YBlockSerializer({ htmlToSegments: htmlToSegmentsNode }));
    const provider = createCollabProvider({
      url: `${wsUrl}/${encodeURIComponent(doc)}`,
      docId: doc,
      yjs: seamFor(store),
      ticketSource: async () => signTicket(ROOM_SECRET, { user: name, doc, write: true, exp: Math.floor(Date.now() / 1000) + 600 }),
      socketFactory: nodeSocketFactory(ROOM_ORIGIN),
      random: () => 0,
    });

    provider.connect();
    peers.set(name, { name, store, provider, destroy: () => { provider.destroy(); store.destroy(); } });
    const deadline = Date.now() + SETTLE_LIMIT_MS;

    while (provider.status !== 'connected') {
      if (Date.now() > deadline) {
        throw new Error(`live-room: peer ${name} did not connect (${provider.status})`);
      }
      await sleep(25);
    }
    store.setAwarenessField('user', { name, color: '#000000', id: name });
    await settle();

    return null;
  };

  const presenceSeenBy = (peer: Peer): unknown =>
    [...peer.store.getAwarenessStates().values()].filter((state) => state.agent !== undefined);

  const history = async (): Promise<unknown> => {
    const answer = await server.request('GET', `/sync/${ROOM_DOC}/history`, {
      headers: { Origin: ROOM_ORIGIN, Authorization: `Bearer ${signTicket(ROOM_SECRET, { user: 'harness', doc: ROOM_DOC, write: true, exp: Math.floor(Date.now() / 1000) + 600 })}` },
    });
    const body: unknown = JSON.parse(answer.text);

    if (!isRecord(body) || !Array.isArray(body.versions)) {
      return { status: answer.status, body };
    }

    return {
      status: answer.status,
      versions: body.versions.filter(isRecord).map((version) => ({
        lineage: nameOf(names.lineage, 'L', String(version.lineage)),
        sequence: version.sequence,
        actors: version.actors,
      })),
    };
  };

  const act = async (action: RoomAction): Promise<unknown> => {
    if (action.settle === true || action.wait !== undefined) {
      await sleep(action.wait ?? 0);
      await settle();

      return null;
    }
    if (action.frames !== undefined && action.frames !== false) {
      await settle();

      return frames(action.frames === 'withPeers');
    }
    if (action.upgrades === true) {
      // Retries run on a jittered backoff, so only whether an answer repeated is stable.
      const seen = proxy.upgrades.map((u) => JSON.stringify(u));

      return proxy.upgrades
        .filter((u, index) => seen.indexOf(JSON.stringify(u)) === index)
        .map((u) => ({ ...u, repeated: seen.filter((key) => key === JSON.stringify(u)).length > 1 }));
    }
    if (action.inject !== undefined && 'queryAwareness' in action.inject) {
      proxy.queryAgent();
      await settle();

      return null;
    }
    if (action.inject !== undefined && 'close' in action.inject) {
      proxy.closeAgent(action.inject.close);
      await settle();

      return null;
    }
    if (action.inject !== undefined) {
      proxy.injections.push(action.inject);

      return null;
    }
    if (action.history === true) {
      await settle();

      return history();
    }
    if (action.connect === true) {
      return connectPeer(action.peer ?? 'alice', action.doc);
    }
    const peer = peerFor(action.peer);

    if (action.edit !== undefined) {
      peer.store.transact(() => action.edit?.forEach((edit) => applyEdit(peer.store, edit)), 'local');
      await settle();

      return null;
    }
    if (action.hold !== undefined) {
      proxy.setHold(peer.name, action.hold);
      await settle();

      return null;
    }
    if (action.read === true) {
      await settle();

      return peer.store.toJSON();
    }
    if (action.presence === true) {
      await settle();

      return presenceSeenBy(peer);
    }
    if (action.leave === true) {
      peer.destroy();
      peers.delete(peer.name);
      await settle();

      return null;
    }
    throw new Error(`live-room: unknown action ${JSON.stringify(action)}`);
  };

  return {
    wsUrl,
    act,
    close: async () => {
      peers.forEach((peer) => peer.destroy());
      peers.clear();
      await cleanup();
    },
  };
};
