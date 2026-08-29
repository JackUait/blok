import { createHmac } from 'node:crypto';

/** Must match the check at BlokServerOptions.cs:61, or the service refuses to start. */
const MIN_SECRET_LENGTH = 32;
const DEFAULT_TTL_SECONDS = 300;

/**
 * Byte-exact, never negotiated: the service compares the ENCODED header segment
 * against a hard-coded constant, ordinally. Reordering these two keys, or adding
 * a space, is rejected — see the noncanonicalHeaderTicket conformance fixture.
 */
const HEADER = '{"alg":"HS256","typ":"JWT"}';

export interface BlokTicketClaims {
  /** Your own user id. The service stores it but never interprets it. */
  user: string;
  /** Restrict the pass to one document. */
  doc?: string;
  /** Whether the holder may write. Defaults to false. */
  write?: boolean;
  /** Lifetime in seconds. Defaults to 300 — short on purpose. */
  ttlSeconds?: number;
}

/**
 * Mints an access pass for one of your users, in your own backend.
 *
 * Not a Blok concept: it is a plain HS256 JWT. Any language can produce the
 * same thing with its own JWT library — this exists so a JavaScript backend
 * does not have to.
 * @param secret - the same secret the service runs with (BLOK_SECRET)
 * @param claims - who the pass is for and how long it lives
 */
export function blokTicket(secret: string, claims: BlokTicketClaims): string {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`blokTicket: the secret must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  const payload = {
    user: claims.user,
    ...(claims.doc === undefined ? {} : { doc: claims.doc }),
    write: claims.write ?? false,
    exp: Math.floor(Date.now() / 1000) + (claims.ttlSeconds ?? DEFAULT_TTL_SECONDS),
  };

  const signing = `${b64(HEADER)}.${b64(JSON.stringify(payload))}`;
  const signature = createHmac('sha256', secret).update(signing).digest('base64url');

  return `${signing}.${signature}`;
}

/**
 * @param value - text to encode
 */
function b64(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64url');
}
