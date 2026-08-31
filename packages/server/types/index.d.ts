/**
 * Public types for `@bloklabs/server/ticket`.
 *
 * Hand-authored, not generated: a published `.d.ts` may not reach outside its
 * own tarball, so it cannot import from `src/`. Keep it in step with
 * `src/ticket.ts` — `packages/server/src/ticket.test.ts` pins the runtime
 * behaviour, and the shape below is the whole public surface.
 */

export interface BlokTicketClaims {
  /** Your own user id. The service stores it but never interprets it. */
  user: string;
  /**
   * Scope the pass to one document for sync (collaboration) access. The HTTP
   * upload and unfurl routes do not read it — those stay user-scoped.
   */
  doc?: string;
  /** Whether the holder may write. Defaults to false. */
  write?: boolean;
  /**
   * Lifetime in seconds. Defaults to 300 — short on purpose. A collaboration
   * pass outlives its handshake (verified at connect only), so ~1800 is a
   * reasonable ceiling there.
   */
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
export declare function blokTicket(secret: string, claims: BlokTicketClaims): string;
