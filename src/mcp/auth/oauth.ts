import { createPublicKey, verify, type KeyObject, type webcrypto } from 'node:crypto';
import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from '@modelcontextprotocol/server';

export interface JwtVerifierConfig { issuer: string; audience: string; jwksUrl: string }

type Jwk = webcrypto.JsonWebKey & { kid: string };

interface SigningKey { key: KeyObject; alg?: string }

const JWKS_TTL_MS = 10 * 60_000;
// Bounds how often tokens with made-up kids can make us fetch the JWKS.
const MISS_REFETCH_COOLDOWN_MS = 30_000;

const invalid = (message: string): OAuthError => new OAuthError(OAuthErrorCode.InvalidToken, message);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isJwk = (value: unknown): value is Jwk => isRecord(value) && typeof value.kid === 'string';

// The header alg must match the key type, or an ES256 key could check an "RS256" token.
const fitsAlg = (key: KeyObject, alg: string): boolean => {
  if (alg === 'RS256') {
    return key.asymmetricKeyType === 'rsa';
  }

  return alg === 'ES256' && key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1';
};

const decodePart = (part: string | undefined): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(Buffer.from(part ?? '', 'base64url').toString('utf-8'));

    if (isRecord(value)) {
      return value;
    }
  } catch {
    // Reported below as a malformed token.
  }
  throw invalid('Malformed token');
};

const toSigningKey = (jwk: Jwk): SigningKey | undefined => {
  try {
    const key = createPublicKey({ key: jwk, format: 'jwk' });

    return key.type === 'public' ? { key, alg: jwk.alg } : undefined;
  } catch {
    // One unusable key must not take the whole set down.
    return undefined;
  }
};

export const principalOf = (info: AuthInfo): string => {
  const sub = info.extra?.sub;

  return typeof sub === 'string' && sub !== '' ? sub : info.clientId;
};

export const createJwtVerifier = (
  config: JwtVerifierConfig,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): OAuthTokenVerifier => {
  const cache: { keys: Map<string, SigningKey>; fetchedAt: number; lastMissRefetchAt: number; pending?: Promise<void> } = {
    keys: new Map(),
    fetchedAt: -Infinity,
    lastMissRefetchAt: -Infinity,
  };

  const fetchJwks = async (): Promise<unknown> => {
    try {
      const response = await fetchImpl(config.jwksUrl);

      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Reported below.
    }
    throw invalid('Signing keys unavailable');
  };

  const load = async (): Promise<void> => {
    const body = await fetchJwks();
    const keys: unknown[] = isRecord(body) && Array.isArray(body.keys) ? body.keys : [];
    const entries = keys.filter(isJwk).flatMap((jwk): Array<[string, SigningKey]> => {
      const signingKey = toSigningKey(jwk);

      return signingKey === undefined ? [] : [[jwk.kid, signingKey]];
    });

    cache.keys = new Map(entries);
    cache.fetchedAt = now();
  };

  // Concurrent callers share one in-flight fetch.
  const refresh = (): Promise<void> => {
    cache.pending ??= load().finally(() => {
      cache.pending = undefined;
    });

    return cache.pending;
  };

  const keyFor = async (kid: string): Promise<SigningKey> => {
    if (now() - cache.fetchedAt > JWKS_TTL_MS) {
      await refresh();
    }
    // A miss may mean the issuer rotated keys: refetch, at most once per cooldown.
    if (!cache.keys.has(kid)) {
      if (cache.pending !== undefined) {
        await cache.pending;
      } else if (now() - cache.lastMissRefetchAt >= MISS_REFETCH_COOLDOWN_MS) {
        cache.lastMissRefetchAt = now();
        await refresh();
      }
    }
    const key = cache.keys.get(kid);

    if (key === undefined) {
      throw invalid('Unknown signing key');
    }

    return key;
  };

  return {
    verifyAccessToken: async (token: string): Promise<AuthInfo> => {
      const [head, body, signature, ...rest] = token.split('.');
      const header = decodePart(head);
      const claims = decodePart(body);
      const alg = header.alg;

      if ((alg !== 'RS256' && alg !== 'ES256') || typeof header.kid !== 'string' || signature === undefined || rest.length > 0) {
        throw invalid('Unsupported token');
      }
      const { key, alg: keyAlg } = await keyFor(header.kid);

      if ((keyAlg !== undefined && keyAlg !== alg) || !fitsAlg(key, alg)) {
        throw invalid('Signing key does not match the token algorithm');
      }
      const data = Buffer.from(`${head}.${body}`);
      const bytes = Buffer.from(signature, 'base64url');
      const valid = alg === 'ES256'
        ? verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, bytes)
        : verify('sha256', data, key, bytes);

      if (!valid) {
        throw invalid('Bad signature');
      }
      const nowS = Math.floor(now() / 1000);
      const audiences: unknown[] = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

      if (claims.iss !== config.issuer) {
        throw invalid('Wrong issuer');
      }
      // RFC 8707: the token must be issued for this server.
      if (!audiences.includes(config.audience)) {
        throw invalid('Token not issued for this server');
      }
      if (typeof claims.exp !== 'number' || claims.exp <= nowS) {
        throw invalid('Token expired');
      }
      if (typeof claims.nbf === 'number' && claims.nbf > nowS) {
        throw invalid('Token not valid yet');
      }
      const scp: unknown[] = Array.isArray(claims.scp) ? claims.scp : [];
      const scopes = typeof claims.scope === 'string'
        ? claims.scope.split(' ').filter((scope) => scope !== '')
        : scp.filter((scope): scope is string => typeof scope === 'string');
      const clientId = [claims.client_id, claims.azp, claims.sub].find((value): value is string => typeof value === 'string') ?? 'unknown';

      return {
        token,
        clientId,
        scopes,
        expiresAt: claims.exp,
        resource: new URL(config.audience),
        extra: { sub: claims.sub },
      };
    },
  };
};
