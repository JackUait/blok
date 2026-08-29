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

interface CachedPass {
  token: string;
  expiresAtMs: number;
}

/**
 * Reads `exp` out of a pass's payload segment. A pass we cannot read is treated
 * as expiring now, so it is used once and never assumed still valid.
 * @param token - the pass as the host app minted it
 */
function readExpiry(token: string): number {
  const payload = token.split('.')[1];

  if (payload === undefined) {
    return 0;
  }

  try {
    const decoded: unknown = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));

    if (typeof decoded !== 'object' || decoded === null) {
      return 0;
    }

    const exp = (decoded as { exp?: unknown }).exp;

    return typeof exp === 'number' ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/**
 * Builds a headers function that keeps one short-lived access pass for the
 * whole editor — uploads and link previews share it.
 * @param options - the minting endpoint and an optional clock
 */
export function createPassSource(options: PassSourceOptions): () => Promise<Record<string, string>> {
  const now = options.now ?? ((): number => Date.now());

  // One mutable holder rather than two rebindable locals: the repo bans `let`,
  // and both fields have to survive across calls to the returned function.
  const state: { cached: CachedPass | null; inFlight: Promise<CachedPass> | null } = {
    cached: null,
    inFlight: null,
  };

  const fetchPass = async (): Promise<CachedPass> => {
    // credentials: the endpoint authorises using the host app's own session
    // cookie, which is the entire reason it can vouch for this user.
    const response = await fetch(options.endpoint, { credentials: 'same-origin' });

    if (!response.ok) {
      throw new Error(`Blok could not get an access pass from ${options.endpoint} (status ${response.status})`);
    }

    const body = (await response.json()) as { ticket?: unknown };

    if (typeof body.ticket !== 'string') {
      throw new Error(`${options.endpoint} answered without a "ticket" field`);
    }

    return { token: body.ticket, expiresAtMs: readExpiry(body.ticket) };
  };

  return async (): Promise<Record<string, string>> => {
    const { cached } = state;

    if (cached !== null && now() < cached.expiresAtMs - REFRESH_MARGIN_MS) {
      return { Authorization: `Bearer ${cached.token}` };
    }

    // One request serves every concurrent caller: a page with six images would
    // otherwise mint six passes on load.
    state.inFlight ??= fetchPass().finally(() => {
      state.inFlight = null;
    });

    const pass = await state.inFlight;

    state.cached = pass;

    return { Authorization: `Bearer ${pass.token}` };
  };
}
