import { createHmac, createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { deflateSync, gzipSync } from 'node:zlib';

/**
 * One loopback HTTP server per case, standing in for every outside service
 * blok-mcp calls: the document endpoint, the authorize webhook, the ticket
 * route, the JWKS and the sync room's WebSocket upgrade. A case scripts it with
 * a route table keyed `"METHOD /path"` (query left out of the key). A key ending
 * in `/*` matches any deeper path when no exact key does.
 */

export interface RouteResponse {
  status: number;
  /** A JSON body. `{"$ticket": claims}` anywhere in it becomes a ticket JWT. */
  json?: unknown;
  /** A raw body, sent as is. */
  text?: string;
  /** Serve the harness's public signing keys as a JWKS. */
  jwks?: boolean;
  headers?: Record<string, string>;
  /** Compress the body and say so in Content-Encoding, whatever the request asked for. */
  encoding?: 'gzip' | 'deflate';
  /** Answer this many ms late. */
  delayMs?: number;
  /** Send the head and the body, promise more bytes, then drop the connection. */
  dropMidBody?: boolean;
  /** Never answer; the socket closes with the host. */
  stall?: boolean;
}

export interface Route extends Partial<RouteResponse> {
  /** First rule whose `when` is a subset of the JSON request body wins. */
  byBody?: Array<{ when: Record<string, unknown>; response: RouteResponse }>;
  /** The nth request on this route gets the nth answer; the last one repeats. */
  sequence?: RouteResponse[];
  /** Record the request body as the exact text sent (`bodyText`), not parsed JSON. */
  rawBody?: boolean;
}

export type RouteTable = Record<string, Route>;

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, unknown>;
  body?: unknown;
  bodyText?: string;
}

// Header names a request record keeps; everything else varies by client library.
const RECORDED_HEADERS = [
  'authorization', 'content-type', 'blok-doc-version', 'origin', 'sec-websocket-protocol',
  // The embed example's custom document source (packages/mcp/examples/embed/server.mjs).
  'blok-if-version', 'blok-caller', 'blok-caller-client', 'blok-caller-actor', 'blok-caller-on-behalf-of',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const base64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

interface SigningKey { kid: string; alg: 'RS256' | 'ES256'; privateKey: KeyObject; jwk: Record<string, unknown> }

const makeKey = (kid: string, alg: 'RS256' | 'ES256'): SigningKey => {
  const pair = alg === 'RS256'
    ? generateKeyPairSync('rsa', { modulusLength: 2048 })
    : generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

  return { kid, alg, privateKey: pair.privateKey, jwk: { ...pair.publicKey.export({ format: 'jwk' }), kid, alg, use: 'sig' } };
};

let keys: SigningKey[] | undefined;

/** `rsa-1` (RS256) and `ec-1` (ES256), made once per worker. */
export const signingKeys = (): SigningKey[] => {
  keys ??= [makeKey('rsa-1', 'RS256'), makeKey('ec-1', 'ES256')];

  return keys;
};

export interface BearerSpec {
  /** Header fields; `alg` and `kid` pick the key unless `key` names another kid. */
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
  /** Seconds from now for `exp`; left out means no `exp` claim. */
  expiresIn?: number;
  /** Seconds from now for `nbf`. */
  notBeforeIn?: number;
  key?: string;
}

export const signAccessToken = (spec: BearerSpec): string => {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    ...spec.claims,
    ...(spec.expiresIn !== undefined && { exp: now + spec.expiresIn }),
    ...(spec.notBeforeIn !== undefined && { nbf: now + spec.notBeforeIn }),
  };
  const signingInput = `${base64url(JSON.stringify(spec.header))}.${base64url(JSON.stringify(claims))}`;
  const kid = spec.key ?? spec.header.kid;
  const key = signingKeys().find((candidate) => candidate.kid === kid) ?? signingKeys()[0];
  const signer = createSign('SHA256');

  signer.update(signingInput);
  const signature = key.alg === 'RS256'
    ? signer.sign(key.privateKey)
    : signer.sign({ key: key.privateKey, dsaEncoding: 'ieee-p1363' });

  return `${signingInput}.${base64url(signature)}`;
};

export interface TicketSpec {
  claims: Record<string, unknown>;
  /** Seconds from now for `exp`. */
  expiresIn?: number;
  /** HS256-sign it, so a real sync host accepts it. */
  secret?: string;
}

/** A ticket the host would mint. blok-mcp reads its claims without checking the signature. */
export const mintTicket = (spec: TicketSpec): string => {
  const claims = {
    ...spec.claims,
    ...(spec.expiresIn !== undefined && { exp: Math.floor(Date.now() / 1000) + spec.expiresIn }),
  };
  const signingInput = `${base64url('{"alg":"HS256","typ":"JWT"}')}.${base64url(JSON.stringify(claims))}`;

  return `${signingInput}.${spec.secret === undefined ? base64url('not-checked') : createHmac('sha256', spec.secret).update(signingInput).digest('base64url')}`;
};

const materialize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(materialize);
  }
  if (!isRecord(value)) {
    return value;
  }
  if (isRecord(value.$ticket)) {
    return mintTicket(value.$ticket as unknown as TicketSpec);
  }

  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, materialize(inner)]));
};

const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * A JWT in a record becomes its decoded parts, `exp` masked, and whether its
 * HS256 signature holds under `secret`. Raw tokens differ on every run.
 */
export const describeJwt = (token: string, secret?: string): unknown => {
  if (!JWT.test(token)) {
    return token;
  }
  const [head, body, signature] = token.split('.');

  try {
    const header: unknown = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'));
    const payload: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));

    return {
      $jwt: {
        headerBytes: Buffer.from(head, 'base64url').toString('utf8'),
        header,
        payload: isRecord(payload) && typeof payload.exp === 'number' ? { ...payload, exp: '<exp>' } : payload,
        ...(secret !== undefined && {
          signedWithSecret: createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url') === signature,
        }),
      },
    };
  } catch {
    return token;
  }
};

const describeHeader = (name: string, value: string, secret?: string): unknown => {
  if (name === 'sec-websocket-protocol') {
    return value.split(',').map((part) => describeJwt(part.trim(), secret));
  }
  if (name === 'authorization' && value.startsWith('Bearer ')) {
    const token = value.slice('Bearer '.length);

    return JWT.test(token) ? { bearer: describeJwt(token, secret) } : value;
  }

  return value;
};

const parseBody = (raw: string): unknown => {
  if (raw === '') {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { text: raw };
  }
};

const subsetOf = (when: Record<string, unknown>, body: unknown): boolean =>
  isRecord(body) && Object.entries(when).every(([key, value]) => JSON.stringify(body[key]) === JSON.stringify(value));

export interface FakeHost {
  /** `http://127.0.0.1:<port>` */
  url: string;
  requests: RecordedRequest[];
  /** Resolves once `count` requests matched "METHOD /path" (exact path, query left out). */
  waitForRequests(key: string, count: number, timeoutMs: number): Promise<void>;
  close(): Promise<void>;
}

const readBody = (req: IncomingMessage): Promise<string> => new Promise((resolve, reject) => {
  const chunks: Buffer[] = [];

  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

const recordOf = (req: IncomingMessage, body: unknown, secret?: string, bodyText?: string): RecordedRequest => ({
  method: req.method ?? '',
  path: req.url ?? '',
  headers: Object.fromEntries(RECORDED_HEADERS
    .filter((name) => typeof req.headers[name] === 'string')
    .map((name) => [name, describeHeader(name, String(req.headers[name]), secret)])),
  ...(bodyText === undefined ? body !== undefined && { body } : { bodyText }),
});

/**
 * `secret` lets a record say whether a ticket was signed with BLOK_SECRET.
 * A WebSocket upgrade is recorded and refused with `upgradeStatus`.
 */
export const startFakeHost = async (routes: RouteTable, options: { secret?: string; upgradeStatus?: number } = {}): Promise<FakeHost> => {
  const requests: RecordedRequest[] = [];
  const seen = new Map<string, number>();
  const sockets = new Set<Socket>();
  const routeFor = (key: string): Route | undefined => {
    if (routes[key] !== undefined) {
      return routes[key];
    }
    const wildcard = Object.keys(routes).filter((name) => name.endsWith('/*') && key.startsWith(name.slice(0, -1)))
      .sort((a, b) => b.length - a.length)[0];

    return wildcard === undefined ? undefined : routes[wildcard];
  };
  const keyOf = (request: RecordedRequest): string => `${request.method} ${request.path.split('?')[0]}`;
  const server: Server = createServer((req, res) => {
    void (async () => {
      const raw = await readBody(req);
      const body = parseBody(raw);
      const key = `${req.method ?? ''} ${(req.url ?? '').split('?')[0]}`;
      const route = routeFor(key);

      requests.push(recordOf(req, body, options.secret, route?.rawBody === true ? raw : undefined));
      const nth = seen.get(key) ?? 0;

      seen.set(key, nth + 1);
      const response = (route?.sequence === undefined ? undefined : route.sequence[Math.min(nth, route.sequence.length - 1)])
        ?? route?.byBody?.find((rule) => subsetOf(rule.when, body))?.response
        ?? (route?.status === undefined && route?.stall !== true ? undefined : route as RouteResponse);

      if (response === undefined) {
        res.writeHead(404).end();
        return;
      }
      if (response.stall === true) {
        return;
      }
      if (response.delayMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, response.delayMs));
      }
      const send = (headers: Record<string, string>, body: string): void => {
        if (response.dropMidBody === true) {
          res.writeHead(response.status, { ...headers, 'content-length': String(Buffer.byteLength(body) + 1000) });
          res.write(body, () => res.socket?.destroy());
          return;
        }
        if (response.encoding === undefined) {
          res.writeHead(response.status, headers).end(body);
          return;
        }
        const bytes = response.encoding === 'gzip' ? gzipSync(body) : deflateSync(body);

        res.writeHead(response.status, { ...headers, 'content-encoding': response.encoding }).end(bytes);
      };

      if (response.jwks === true) {
        send({ 'content-type': 'application/json', ...response.headers }, JSON.stringify({ keys: signingKeys().map((k) => k.jwk) }));
        return;
      }
      if (response.json !== undefined) {
        send({ 'content-type': 'application/json', ...response.headers }, JSON.stringify(materialize(response.json)));
        return;
      }
      send({ ...response.headers }, response.text ?? '');
    })().catch((error: unknown) => {
      res.writeHead(500).end(String(error));
    });
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (req: IncomingMessage, socket: Socket) => {
    requests.push(recordOf(req, undefined, options.secret));
    const status = options.upgradeStatus ?? 403;

    socket.end(`HTTP/1.1 ${status} Refused\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    waitForRequests: async (key, count, timeoutMs) => {
      const deadline = Date.now() + timeoutMs;

      while (requests.filter((request) => keyOf(request) === key).length < count) {
        if (Date.now() > deadline) {
          throw new Error(`the fake host got no ${count} × ${key} within ${timeoutMs} ms`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
    close: () => new Promise<void>((resolve) => {
      sockets.forEach((socket) => socket.destroy());
      server.close(() => resolve());
    }),
  };
};
