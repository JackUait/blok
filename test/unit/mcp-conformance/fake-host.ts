import { createHmac, createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

/**
 * One loopback HTTP server per case, standing in for every outside service
 * blok-mcp calls: the document endpoint, the authorize webhook, the ticket
 * route, the JWKS and the sync room's WebSocket upgrade. A case scripts it with
 * a route table keyed `"METHOD /path"` (query left out of the key).
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
}

export interface Route extends Partial<RouteResponse> {
  /** First rule whose `when` is a subset of the JSON request body wins. */
  byBody?: Array<{ when: Record<string, unknown>; response: RouteResponse }>;
}

export type RouteTable = Record<string, Route>;

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, unknown>;
  body?: unknown;
}

// Header names a request record keeps; everything else varies by client library.
const RECORDED_HEADERS = ['authorization', 'content-type', 'blok-doc-version', 'origin', 'sec-websocket-protocol'];

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
  close(): Promise<void>;
}

const readBody = (req: IncomingMessage): Promise<string> => new Promise((resolve, reject) => {
  const chunks: Buffer[] = [];

  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

const recordOf = (req: IncomingMessage, body: unknown, secret?: string): RecordedRequest => ({
  method: req.method ?? '',
  path: req.url ?? '',
  headers: Object.fromEntries(RECORDED_HEADERS
    .filter((name) => typeof req.headers[name] === 'string')
    .map((name) => [name, describeHeader(name, String(req.headers[name]), secret)])),
  ...(body !== undefined && { body }),
});

/**
 * `secret` lets a record say whether a ticket was signed with BLOK_SECRET.
 * A WebSocket upgrade is recorded and refused with `upgradeStatus`.
 */
export const startFakeHost = async (routes: RouteTable, options: { secret?: string; upgradeStatus?: number } = {}): Promise<FakeHost> => {
  const requests: RecordedRequest[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((req, res) => {
    void (async () => {
      const raw = await readBody(req);
      const body = parseBody(raw);

      requests.push(recordOf(req, body, options.secret));
      const key = `${req.method ?? ''} ${(req.url ?? '').split('?')[0]}`;
      const route = routes[key];
      const response = route?.byBody?.find((rule) => subsetOf(rule.when, body))?.response
        ?? (route?.status === undefined ? undefined : route as RouteResponse);

      if (response === undefined) {
        res.writeHead(404).end();
        return;
      }
      if (response.jwks === true) {
        res.writeHead(response.status, { 'content-type': 'application/json', ...response.headers })
          .end(JSON.stringify({ keys: signingKeys().map((k) => k.jwk) }));
        return;
      }
      if (response.json !== undefined) {
        res.writeHead(response.status, { 'content-type': 'application/json', ...response.headers })
          .end(JSON.stringify(materialize(response.json)));
        return;
      }
      res.writeHead(response.status, response.headers).end(response.text ?? '');
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
    close: () => new Promise<void>((resolve) => {
      sockets.forEach((socket) => socket.destroy());
      server.close(() => resolve());
    }),
  };
};
