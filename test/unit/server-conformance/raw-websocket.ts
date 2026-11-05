import { randomBytes } from 'node:crypto';
import { connect, type Socket } from 'node:net';

/**
 * A raw RFC 6455 client for the transport contract. A WebSocket library
 * would hide fragments, pings and the close handshake, which are exactly
 * what the contract checks.
 */

export interface RawResponse {
  readonly status: number;
  /** Header names lower-cased; repeated headers joined with ", ". */
  readonly headers: Record<string, string>;
  /** The body of a non-101 answer (chunked or Content-Length). */
  readonly body: string;
}

export interface ServerFrame {
  readonly fin: boolean;
  readonly opcode: number;
  readonly payload: Buffer;
}

export interface CloseFrame {
  readonly code: number | null;
  readonly reason: string;
  readonly at: number;
}

export interface RawSocket {
  readonly response: RawResponse;
  readonly frames: ServerFrame[];
  /** Sends one masked client frame; `first` holds FIN, RSV and the opcode. */
  sendFrame(first: number, payload?: Uint8Array, options?: { masked?: boolean; length?: number }): void;
  sendRaw(bytes: Uint8Array): void;
  /** Sends many frames in one TCP write. */
  sendFrames(frames: { first: number; payload?: Uint8Array }[]): void;
  /** The server's close frame. */
  closed(timeoutMs?: number): Promise<CloseFrame>;
  /** When the server ended the TCP stream. */
  ended(timeoutMs?: number): Promise<number>;
  /** Resolves once a frame with this opcode arrives. */
  frame(opcode: number, timeoutMs?: number): Promise<ServerFrame>;
  /** Stops reading the socket, so the server's writes back up. */
  pause(): void;
  resume(): void;
  destroy(): void;
}

export const OP_CONTINUATION = 0x0;
export const OP_TEXT = 0x1;
export const OP_BINARY = 0x2;
export const OP_CLOSE = 0x8;
export const OP_PING = 0x9;
export const OP_PONG = 0xa;
export const FIN = 0x80;

export function encodeClientFrame(
  first: number,
  payload: Uint8Array = new Uint8Array(),
  options: { masked?: boolean; length?: number } = {},
): Buffer {
  const masked = options.masked ?? true;
  const length = options.length ?? payload.length;
  const maskBit = masked ? 0x80 : 0;
  let header: Buffer;

  if (length <= 125) {
    header = Buffer.from([first, maskBit | length]);
  } else if (length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = first;
    header[1] = maskBit | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = first;
    header[1] = maskBit | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  if (!masked) {
    return Buffer.concat([header, payload]);
  }

  const mask = randomBytes(4);
  const body = Buffer.alloc(payload.length);

  for (let i = 0; i < payload.length; i++) {
    body[i] = payload[i] ^ mask[i & 3];
  }

  return Buffer.concat([header, mask, body]);
}

export function closePayload(code: number, reason = ''): Buffer {
  const payload = Buffer.alloc(2);

  payload.writeUInt16BE(code, 0);

  return Buffer.concat([payload, Buffer.from(reason, 'utf8')]);
}

function deadline<T>(promise: Promise<T>, timeoutMs: number, what: () => string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms waiting for ${what()}`)), timeoutMs);

    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error: unknown) => {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

interface HeadParse {
  status: number;
  headers: Record<string, string>;
  rest: Buffer;
}

function parseHead(buffer: Buffer): HeadParse | null {
  const end = buffer.indexOf('\r\n\r\n');

  if (end < 0) {
    return null;
  }

  const lines = buffer.subarray(0, end).toString('latin1').split('\r\n');
  const status = Number(lines[0].split(' ')[1]);
  const headers: Record<string, string> = {};

  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    headers[name] = name in headers ? `${headers[name]}, ${value}` : value;
  }

  return { status, headers, rest: buffer.subarray(end + 4) };
}

/** One chunk: its bytes and where the next starts; null while incomplete. */
function readChunk(rest: Buffer, offset: number): { data: Buffer; next: number } | null {
  const lineEnd = rest.indexOf('\r\n', offset);

  if (lineEnd < 0) {
    return null;
  }

  const size = parseInt(rest.subarray(offset, lineEnd).toString('latin1'), 16);
  const next = lineEnd + 2 + size + 2;

  return rest.length < next ? null : { data: rest.subarray(lineEnd + 2, lineEnd + 2 + size), next };
}

function parseChunked(rest: Buffer): string | null {
  const parts: Buffer[] = [];

  for (let chunk = readChunk(rest, 0); chunk !== null; chunk = readChunk(rest, chunk.next)) {
    if (chunk.data.length === 0) {
      return Buffer.concat(parts).toString('utf8');
    }

    parts.push(chunk.data);
  }

  return null;
}

/** null while the body is incomplete. */
function parseBody(head: HeadParse, ended: boolean): string | null {
  const { headers, rest } = head;

  if ((headers['transfer-encoding'] ?? '').toLowerCase() === 'chunked') {
    return parseChunked(rest);
  }

  if (headers['content-length'] !== undefined) {
    const length = Number(headers['content-length']);

    return rest.length >= length ? rest.subarray(0, length).toString('utf8') : null;
  }

  return ended ? rest.toString('utf8') : null;
}

/** An unmasked server frame at the start of buffer; null while incomplete. */
function parseServerFrame(buffer: Buffer): { frame: ServerFrame; size: number } | null {
  if (buffer.length < 2) {
    return null;
  }

  const marker = buffer[1] & 0x7f;
  const offset = { 126: 4, 127: 10 }[marker] ?? 2;

  if (buffer.length < offset) {
    return null;
  }

  const lengths: Record<number, () => number> = {
    126: () => buffer.readUInt16BE(2),
    127: () => Number(buffer.readBigUInt64BE(2)),
  };
  const length = lengths[marker]?.() ?? marker;

  if (buffer.length < offset + length) {
    return null;
  }

  return {
    frame: { fin: (buffer[0] & 0x80) !== 0, opcode: buffer[0] & 0x0f, payload: Buffer.from(buffer.subarray(offset, offset + length)) },
    size: offset + length,
  };
}

export interface OpenOptions {
  /** Extra request header lines, in order; a repeated name is sent twice. */
  headers?: [string, string][];
  method?: string;
  /** false sends a plain GET with no upgrade headers. */
  upgrade?: boolean;
  /** Overrides the default 16-byte key. */
  key?: string;
  version?: string;
}

/**
 * Opens `path` on `baseUrl` and resolves once the response head (and, for a
 * non-101, its body) has arrived.
 */
export function openRaw(baseUrl: string, path: string, options: OpenOptions = {}): Promise<RawSocket> {
  const url = new URL(baseUrl);
  const socket: Socket = connect(Number(url.port), url.hostname);

  socket.setNoDelay(true);

  const lines = [`${options.method ?? 'GET'} ${path} HTTP/1.1`, `Host: ${url.host}`];

  if (options.upgrade !== false) {
    lines.push(
      'Connection: Upgrade',
      'Upgrade: websocket',
      `Sec-WebSocket-Version: ${options.version ?? '13'}`,
      `Sec-WebSocket-Key: ${options.key ?? randomBytes(16).toString('base64')}`,
    );
  }

  for (const [name, value] of options.headers ?? []) {
    lines.push(`${name}: ${value}`);
  }

  socket.write(`${lines.join('\r\n')}\r\n\r\n`);

  return new Promise<RawSocket>((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let head: HeadParse | null = null;
    let upgraded = false;
    let endedAt: number | null = null;
    const frames: ServerFrame[] = [];
    let closeFrame: CloseFrame | null = null;
    const waiters = new Set<() => void>();
    const wake = (): void => {
      for (const waiter of [...waiters]) {
        waiter();
      }
    };

    const until = <T>(check: () => T | undefined, timeoutMs: number, what: () => string): Promise<T> => deadline(new Promise<T>((done) => {
      const poll = (): void => {
        const value = check();

        if (value !== undefined) {
          waiters.delete(poll);
          done(value);
        }
      };

      waiters.add(poll);
      poll();
    }), timeoutMs, what);

    const describe = (): string => `frames [${frames.map((f) => f.opcode).join(',')}], close ${JSON.stringify(closeFrame)}, ended ${endedAt}`;

    const raw: RawSocket = {
      get response(): RawResponse {
        if (head === null) {
          throw new Error('no response yet');
        }

        return { status: head.status, headers: head.headers, body: '' };
      },
      frames,
      sendFrame: (first, payload, frameOptions) => socket.write(encodeClientFrame(first, payload, frameOptions)),
      sendRaw: (bytes) => socket.write(bytes),
      sendFrames: (list) => socket.write(Buffer.concat(list.map(({ first, payload }) => encodeClientFrame(first, payload)))),
      closed: (timeoutMs = 10_000) => until(() => closeFrame ?? undefined, timeoutMs, () => `a close frame; saw ${describe()}`),
      ended: (timeoutMs = 10_000) => until(() => endedAt ?? undefined, timeoutMs, () => `the stream to end; saw ${describe()}`),
      frame: (opcode, timeoutMs = 10_000) => until(() => frames.find((f) => f.opcode === opcode), timeoutMs, () => `opcode ${opcode}; saw ${describe()}`),
      pause: () => socket.pause(),
      resume: () => socket.resume(),
      destroy: () => socket.destroy(),
    };

    const readFrames = (): void => {
      for (let next = parseServerFrame(buffer); next !== null; next = parseServerFrame(buffer)) {
        const { frame, size } = next;

        buffer = buffer.subarray(size);
        frames.push(frame);

        if (frame.opcode === OP_CLOSE && closeFrame === null) {
          closeFrame = {
            code: frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : null,
            reason: frame.payload.subarray(2).toString('utf8'),
            at: Date.now(),
          };
        }
      }
    };

    const settleHead = (ended: boolean): void => {
      head ??= parseHead(buffer);

      if (head === null) {
        if (ended) {
          reject(new Error(`the stream ended before a response head: ${buffer.toString('latin1')}`));
        }

        return;
      }

      if (head.status === 101) {
        upgraded = true;
        buffer = Buffer.from(head.rest);
        const response = { status: 101, headers: head.headers, body: '' };

        Object.defineProperty(raw, 'response', { value: response });
        resolve(raw);
        readFrames();

        return;
      }

      const body = parseBody({ ...head, rest: buffer.subarray(buffer.indexOf('\r\n\r\n') + 4) }, ended);

      if (body !== null) {
        Object.defineProperty(raw, 'response', { value: { status: head.status, headers: head.headers, body } });
        resolve(raw);
        socket.destroy();
      } else if (ended) {
        reject(new Error(`the stream ended inside the body of a ${head.status}`));
      }
    };

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (upgraded) {
        readFrames();
      } else {
        settleHead(false);
      }

      wake();
    });
    socket.on('end', () => {
      endedAt ??= Date.now();

      if (!upgraded) {
        settleHead(true);
      }

      wake();
    });
    socket.on('close', () => {
      endedAt ??= Date.now();
      wake();
    });
    socket.on('error', (error) => {
      endedAt ??= Date.now();

      if (head === null) {
        reject(error);
      }

      wake();
    });
  });
}
