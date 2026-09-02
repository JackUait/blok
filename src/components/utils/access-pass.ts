/**
 * Refresh this many milliseconds BEFORE the stated expiry. Without a margin,
 * a pass fetched at the last moment can arrive at the service already expired.
 */
const REFRESH_MARGIN_MS = 30_000;

export interface PassSourceOptions {
  /** Endpoint in the host app that mints a pass for the current session. */
  endpoint: string;
  /** Injectable clock; production uses Date.now. */
  now?: () => number;
}

export interface TicketSourceOptions {
  /**
   * When set, the minted ticket is scoped to one document: `?doc=<enc>` is
   * composed onto the endpoint. Live collaboration needs this; uploads and link
   * previews do not.
   */
  doc?: string;
  /** Injectable clock; production uses Date.now. */
  now?: () => number;
}

/** What a caller may ask of a ticket source on any single call. */
export interface TicketRequest {
  /**
   * Skip the cache and mint a new ticket. A ticket the service rejects for
   * anything but expiry — revoked, signing key rotated, server restarted, scope
   * re-granted — is still far from expiring, so re-serving the cached bytes
   * would fail exactly the same way. This is what the collaboration provider
   * asks for on its one retry after a 4401.
   */
  forceRefresh?: boolean;
}

/** Hands back a raw ticket, minting one when the cache cannot serve the call. */
export type TicketSource = (request?: TicketRequest) => Promise<string>;

interface CachedPass {
  token: string;
  expiresAtMs: number;
}

/**
 * Composes a `doc` claim onto the mint endpoint. Uses `&` when the endpoint
 * already carries a query string, `?` otherwise.
 * @param endpoint - the mint endpoint as the host app configured it
 * @param doc - the document id to scope the ticket to, if any
 */
function composeEndpoint(endpoint: string, doc: string | undefined): string {
  if (doc === undefined) {
    return endpoint;
  }

  const separator = endpoint.includes('?') ? '&' : '?';

  return `${endpoint}${separator}doc=${encodeURIComponent(doc)}`;
}

/**
 * Decodes a pass's payload segment. Null when the pass is not dot-joined
 * segments, the payload is not base64url JSON, or the JSON is not an object;
 * each caller decides what an unreadable pass means for it.
 * @param token - the pass as the host app minted it
 */
export function readTicketClaims(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1];

  if (payload === undefined) {
    return null;
  }

  try {
    const decoded: unknown = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));

    return typeof decoded === 'object' && decoded !== null ? (decoded as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Reads `exp` out of a pass's payload segment. A pass we cannot read is treated
 * as expiring now, so it is used once and never assumed still valid.
 * @param token - the pass as the host app minted it
 */
function readExpiry(token: string): number {
  const exp = readTicketClaims(token)?.exp;

  return typeof exp === 'number' ? exp * 1000 : 0;
}

/**
 * Builds a source that keeps one short-lived ticket for the whole editor and
 * hands back the raw token. Caches it, refreshes 30s before expiry, and
 * collapses concurrent callers onto a single mint.
 *
 * A caller that knows the cached ticket was refused passes
 * {@link TicketRequest.forceRefresh} to skip the cache; the mint that follows is
 * still shared with any concurrent caller and still replaces the cache.
 * @param endpoint - the host app route that mints a ticket for the session
 * @param options - an optional document scope (`?doc=`) and clock
 */
export function createTicketSource(endpoint: string, options: TicketSourceOptions = {}): TicketSource {
  const now = options.now ?? ((): number => Date.now());
  const url = composeEndpoint(endpoint, options.doc);

  // One mutable holder rather than two rebindable locals: the repo bans `let`,
  // and both fields have to survive across calls to the returned function.
  const state: { cached: CachedPass | null; inFlight: Promise<CachedPass> | null } = {
    cached: null,
    inFlight: null,
  };

  const fetchPass = async (): Promise<CachedPass> => {
    // credentials: the endpoint authorises using the host app's own session
    // cookie, which is the entire reason it can vouch for this user.
    const response = await fetch(url, { credentials: 'same-origin' });

    if (!response.ok) {
      throw new Error(`Blok could not get an access pass from ${url} (status ${response.status})`);
    }

    const body = (await response.json()) as { ticket?: unknown };

    if (typeof body.ticket !== 'string') {
      throw new Error(`${url} answered without a "ticket" field`);
    }

    return { token: body.ticket, expiresAtMs: readExpiry(body.ticket) };
  };

  return async (request?: TicketRequest): Promise<string> => {
    const { cached } = state;

    if (request?.forceRefresh !== true && cached !== null && now() < cached.expiresAtMs - REFRESH_MARGIN_MS) {
      return cached.token;
    }

    // One request serves every concurrent caller: a page with six images would
    // otherwise mint six passes on load.
    state.inFlight ??= fetchPass().finally(() => {
      state.inFlight = null;
    });

    const pass = await state.inFlight;

    state.cached = pass;

    return pass.token;
  };
}

/**
 * Builds a headers function that keeps one short-lived access pass for the
 * whole editor — uploads and link previews share it. Thin wrapper over
 * {@link createTicketSource} that turns the raw token into a Bearer header.
 * @param options - the minting endpoint and an optional clock
 */
export function createPassSource(options: PassSourceOptions): () => Promise<Record<string, string>> {
  const ticketSource = createTicketSource(options.endpoint, { now: options.now });

  return async (): Promise<Record<string, string>> => {
    const token = await ticketSource();

    return { Authorization: `Bearer ${token}` };
  };
}
