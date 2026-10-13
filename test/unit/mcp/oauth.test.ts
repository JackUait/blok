// @vitest-environment node
import { createHmac, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { OAuthError } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJwtVerifier, principalOf } from '../../../src/mcp/auth/oauth';

const NOW_S = 1_800_000_000;
const config = { issuer: 'https://id.example.com', audience: 'https://mcp.example.com', jwksUrl: 'https://id.example.com/jwks' };
const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = (key: KeyObject, kid: string, alg: string): Record<string, unknown> => ({ ...key.export({ format: 'jwk' }), kid, alg, use: 'sig' });

const token = (claims: Record<string, unknown>, options: { alg?: string; kid?: string; key?: KeyObject; header?: Record<string, unknown> } = {}): string => {
  const alg = options.alg ?? 'RS256';
  const head = `${b64({ alg, kid: options.kid ?? 'rsa-1', typ: 'JWT', ...options.header })}.${b64(claims)}`;
  const signature = alg === 'ES256'
    ? sign('sha256', Buffer.from(head), { key: options.key ?? ec.privateKey, dsaEncoding: 'ieee-p1363' })
    : sign('sha256', Buffer.from(head), options.key ?? rsa.privateKey);

  return `${head}.${signature.toString('base64url')}`;
};

const good = { iss: config.issuer, aud: config.audience, sub: 'user-42', client_id: 'claude', scope: 'blok.read blok.write', exp: NOW_S + 600 };

const isInvalidToken = (error: unknown): boolean => OAuthError.isInstance(error) && error.toResponseObject().error === 'invalid_token';

describe('createJwtVerifier', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const jwks = (keys: Array<Record<string, unknown>>): void => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ keys })));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    jwks([jwk(rsa.publicKey, 'rsa-1', 'RS256'), jwk(ec.publicKey, 'ec-1', 'ES256')]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const verifier = (): ReturnType<typeof createJwtVerifier> => createJwtVerifier(config, fetchMock, () => NOW_S * 1000);
  const refusal = async (raw: string): Promise<unknown> => verifier().verifyAccessToken(raw).then(() => undefined, (error: unknown) => error);

  it('accepts a valid RS256 token and maps scopes, expiry, resource and principal', async () => {
    const info = await verifier().verifyAccessToken(token(good));

    expect(info).toMatchObject({ clientId: 'claude', scopes: ['blok.read', 'blok.write'], expiresAt: NOW_S + 600 });
    expect(info.resource?.href).toBe('https://mcp.example.com/');
    expect(principalOf(info)).toBe('user-42');
    expect(fetchMock).toHaveBeenCalledWith(config.jwksUrl, { signal: expect.any(AbortSignal) });
  });

  it('falls back to a namespaced client id as principal when there is no sub', async () => {
    const info = await verifier().verifyAccessToken(token({ ...good, sub: undefined }));

    expect(principalOf(info)).toBe('client:claude');
  });

  it('never gives a machine token the principal of a user whose sub equals its client id', async () => {
    const check = verifier();
    const user = await check.verifyAccessToken(token({ ...good, sub: 'alice', client_id: 'web' }));
    const machine = await check.verifyAccessToken(token({ ...good, sub: undefined, client_id: undefined, azp: 'alice' }));

    expect(principalOf(user)).toBe('alice');
    expect(principalOf(machine)).not.toBe(principalOf(user));
  });

  it('accepts ES256 and an scp array', async () => {
    const info = await verifier().verifyAccessToken(token({ ...good, scope: undefined, scp: ['blok.read'] }, { alg: 'ES256', kid: 'ec-1' }));

    expect(info.scopes).toEqual(['blok.read']);
  });

  it('accepts an audience array that contains this server', async () => {
    await expect(verifier().verifyAccessToken(token({ ...good, aud: ['other', config.audience] }))).resolves.toBeDefined();
  });

  it.each([
    ['another audience (RFC 8707)', { ...good, aud: 'https://other' }],
    ['no audience', { ...good, aud: undefined }],
    ['another issuer', { ...good, iss: 'https://evil' }],
    ['an expired token', { ...good, exp: NOW_S - 1 }],
    ['a token expiring this second', { ...good, exp: NOW_S }],
    ['a token not valid yet', { ...good, nbf: NOW_S + 60 }],
    ['a token without exp', { ...good, exp: undefined }],
  ])('refuses %s as invalid_token', async (_label, claims) => {
    expect(isInvalidToken(await refusal(token(claims)))).toBe(true);
  });

  it('refuses alg none, HS256 signed with the public key, and a forged signature', async () => {
    const unsigned = `${b64({ alg: 'none', kid: 'rsa-1' })}.${b64(good)}.`;
    const hmacHead = `${b64({ alg: 'HS256', kid: 'rsa-1' })}.${b64(good)}`;
    const publicPem = rsa.publicKey.export({ type: 'spki', format: 'pem' });
    const hmac = `${hmacHead}.${createHmac('sha256', publicPem).update(hmacHead).digest('base64url')}`;
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

    expect(isInvalidToken(await refusal(unsigned))).toBe(true);
    expect(isInvalidToken(await refusal(hmac))).toBe(true);
    expect(isInvalidToken(await refusal(token(good, { key: other.privateKey })))).toBe(true);
  });

  // RFC 7515 §4.1.11: a recipient that does not understand every listed extension must reject.
  it('refuses a token whose header lists critical extensions', async () => {
    expect(isInvalidToken(await refusal(token(good, { header: { crit: ['exp'], exp: NOW_S + 600 } })))).toBe(true);
    expect(isInvalidToken(await refusal(token(good, { header: { crit: [] } })))).toBe(true);
  });

  // RFC 7517 §4.2: a key published for encryption must not verify signatures.
  it('refuses a token signed by a key published for encryption', async () => {
    jwks([{ ...jwk(rsa.publicKey, 'rsa-1', 'RS256'), use: 'enc' }]);

    expect(isInvalidToken(await refusal(token(good)))).toBe(true);
  });

  it('still accepts a key that names no use', async () => {
    const { use: _use, ...plain } = jwk(rsa.publicKey, 'rsa-1', 'RS256');

    jwks([plain]);
    await expect(verifier().verifyAccessToken(token(good))).resolves.toBeDefined();
  });

  it('refuses a malformed token', async () => {
    expect(isInvalidToken(await refusal('not-a-jwt'))).toBe(true);
  });

  it('refuses a header alg that does not match the key type', async () => {
    expect(isInvalidToken(await refusal(token(good, { alg: 'RS256', kid: 'ec-1', key: ec.privateKey })))).toBe(true);
  });

  it('refuses an RS256 header on an EC key whose JWK names no alg', async () => {
    jwks([{ ...ec.publicKey.export({ format: 'jwk' }), kid: 'ec-bare' }]);

    expect(isInvalidToken(await refusal(token(good, { alg: 'RS256', kid: 'ec-bare', key: ec.privateKey })))).toBe(true);
  });

  it('skips an unusable JWKS entry and still uses the good ones', async () => {
    jwks([{ kty: 'oct', k: 'c2VjcmV0', kid: 'hmac-1' }, jwk(rsa.publicKey, 'rsa-1', 'RS256')]);

    await expect(verifier().verifyAccessToken(token(good))).resolves.toBeDefined();
  });

  it.each([
    ['a failed response', async () => new Response('down', { status: 503 })],
    ['a network error', async () => { throw new TypeError('fetch failed'); }],
    ['a body that is not JSON', async () => new Response('<html>')],
  ])('refuses as invalid_token when the JWKS fetch gives %s', async (_label, reply: () => Promise<Response>) => {
    fetchMock.mockImplementation(reply);

    expect(isInvalidToken(await refusal(token(good)))).toBe(true);
  });

  it('refetches the JWKS once for an unknown kid, then refuses', async () => {
    const check = verifier();

    await check.verifyAccessToken(token(good));
    await expect(check.verifyAccessToken(token(good, { kid: 'rotated' }))).rejects.toSatisfy(isInvalidToken);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rate-limits refetches caused by unknown kids to one per 30 s', async () => {
    const clock = { ms: NOW_S * 1000 };
    const check = createJwtVerifier(config, fetchMock, () => clock.ms);

    await check.verifyAccessToken(token(good));
    await expect(check.verifyAccessToken(token(good, { kid: 'random-1' }))).rejects.toSatisfy(isInvalidToken);
    clock.ms += 1000;
    await expect(check.verifyAccessToken(token(good, { kid: 'random-2' }))).rejects.toSatisfy(isInvalidToken);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    clock.ms += 29_000;
    await expect(check.verifyAccessToken(token(good, { kid: 'random-3' }))).rejects.toSatisfy(isInvalidToken);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('shares one in-flight fetch between concurrent unknown-kid misses', async () => {
    const check = verifier();

    await check.verifyAccessToken(token(good));
    jwks([jwk(rsa.publicKey, 'rotated', 'RS256')]);
    const results = await Promise.all([
      check.verifyAccessToken(token(good, { kid: 'rotated' })),
      check.verifyAccessToken(token(good, { kid: 'rotated' })),
      check.verifyAccessToken(token(good, { kid: 'random' })).catch((error: unknown) => error),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results[0]).toMatchObject({ clientId: 'claude' });
    expect(results[1]).toMatchObject({ clientId: 'claude' });
    expect(isInvalidToken(results[2])).toBe(true);
  });

  it('shares one in-flight fetch between concurrent first requests', async () => {
    const check = verifier();

    await Promise.all([check.verifyAccessToken(token(good)), check.verifyAccessToken(token(good))]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps serving cached keys when a refresh after the TTL fails', async () => {
    const clock = { ms: NOW_S * 1000 };
    const check = createJwtVerifier(config, fetchMock, () => clock.ms);
    const longLived = token({ ...good, exp: NOW_S + 3600 });

    await check.verifyAccessToken(longLived);
    fetchMock.mockImplementation(async () => new Response('down', { status: 503 }));
    clock.ms += 10 * 60_000 + 1;
    await expect(check.verifyAccessToken(longLived)).resolves.toMatchObject({ clientId: 'claude' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the cached keys when a refresh answers with no usable key', async () => {
    const clock = { ms: NOW_S * 1000 };
    const check = createJwtVerifier(config, fetchMock, () => clock.ms);
    const longLived = token({ ...good, exp: NOW_S + 3600 });

    await check.verifyAccessToken(longLived);
    fetchMock.mockImplementation(async () => Response.json({ keys: [] }));
    clock.ms += 10 * 60_000 + 1;
    await expect(check.verifyAccessToken(longLived)).resolves.toMatchObject({ clientId: 'claude' });
  });

  it('waits 30 s after a failed refresh before fetching again', async () => {
    const clock = { ms: NOW_S * 1000 };
    const check = createJwtVerifier(config, fetchMock, () => clock.ms);
    const longLived = token({ ...good, exp: NOW_S + 3600 });

    await check.verifyAccessToken(longLived);
    fetchMock.mockImplementation(async () => new Response('down', { status: 503 }));
    clock.ms += 10 * 60_000 + 1;
    await check.verifyAccessToken(longLived);
    await check.verifyAccessToken(longLived);
    await expect(check.verifyAccessToken(token(good, { kid: 'random' }))).rejects.toSatisfy(isInvalidToken);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    clock.ms += 30_000;
    await check.verifyAccessToken(longLived);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not refetch on every request while the first load keeps failing', async () => {
    const clock = { ms: NOW_S * 1000 };
    const check = createJwtVerifier(config, fetchMock, () => clock.ms);

    fetchMock.mockImplementation(async () => new Response('down', { status: 503 }));
    await expect(check.verifyAccessToken(token(good))).rejects.toSatisfy(isInvalidToken);
    await expect(check.verifyAccessToken(token(good))).rejects.toSatisfy(isInvalidToken);
    await expect(check.verifyAccessToken(token(good, { kid: 'random' }))).rejects.toSatisfy(isInvalidToken);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clock.ms += 30_000;
    jwks([jwk(rsa.publicKey, 'rsa-1', 'RS256')]);
    await expect(check.verifyAccessToken(token(good))).resolves.toMatchObject({ clientId: 'claude' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses as invalid_token when the JWKS fetch is aborted by its timeout', async () => {
    fetchMock.mockImplementation(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });

    expect(isInvalidToken(await refusal(token(good)))).toBe(true);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('caches the JWKS for 10 minutes', async () => {
    const clock = { ms: NOW_S * 1000 };
    const check = createJwtVerifier(config, fetchMock, () => clock.ms);
    const longLived = token({ ...good, exp: NOW_S + 3600 });

    await check.verifyAccessToken(longLived);
    clock.ms += 10 * 60_000;
    await check.verifyAccessToken(longLived);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clock.ms += 1;
    await check.verifyAccessToken(longLived);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
