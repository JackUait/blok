import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { createTicketSource, readTicketClaims } from '../../../../src/components/utils/access-pass';

/**
 * Mutant-killing tests for src/components/utils/access-pass.ts.
 *
 * Three recorded live mutants are PROVEN equivalent — no input distinguishes
 * them from the original:
 *
 * 1. Emptying the body of `if (payload === undefined)` in readTicketClaims.
 *    `payload` is `token.split('.')[1]`, which is undefined only when the token
 *    carries no dot. Falling through then evaluates `payload.replace(...)` on
 *    undefined, which throws a TypeError inside the try, and the catch returns
 *    null. The guard returns null too, and neither path has a side effect, so
 *    every token produces the identical value.
 *
 * 2. Replacing that same condition with `false`. Identical argument: skipping
 *    the guard lands in the same throwing expression and the same catch.
 *
 * 3. Replacing `decoded !== null` with `true` in the ternary. The operand only
 *    changes the outcome when `decoded` is null, and null is the one value for
 *    which `typeof decoded === 'object'` already holds. The mutant then yields
 *    the consequent, which is `decoded` — that is, null — and the original
 *    yields the alternative, which is also null. Same value for every input.
 *
 * The remaining eleven are killed below. The base64url tests need a payload
 * whose encoding actually contains the substituted characters, so each asserts
 * the character is present before asserting the decode.
 */

/** Encodes JSON the way a host app mints a pass payload: base64, then url-safe. */
const toBase64Url = (json: string): string =>
  btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const passWithPayload = (payload: string): string => `header.${payload}.signature`;

const passWithClaims = (claims: Record<string, unknown>): string =>
  passWithPayload(toBase64Url(JSON.stringify(claims)));

interface FetchResult {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

type FetchMock = Mock<(input: string, init?: unknown) => Promise<FetchResult>>;

const okWith = (ticket: string): FetchMock =>
  vi.fn<(input: string, init?: unknown) => Promise<FetchResult>>().mockResolvedValue({
    ok: true,
    status: 200,
    json: (): Promise<unknown> => Promise.resolve({ ticket }),
  });

describe('access-pass mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('readTicketClaims', () => {
    it('decodes a payload whose base64url form carries a dash', () => {
      const claims = { exp: 1000, tag: 'a>' };
      const payload = toBase64Url(JSON.stringify(claims));

      expect(payload).toContain('-');
      expect(readTicketClaims(passWithPayload(payload))).toEqual(claims);
    });

    it('decodes a payload whose base64url form carries an underscore', () => {
      const claims = { exp: 1000, tag: 'a?' };
      const payload = toBase64Url(JSON.stringify(claims));

      expect(payload).toContain('_');
      expect(readTicketClaims(passWithPayload(payload))).toEqual(claims);
    });

    it('rejects a payload that decodes to JSON which is not an object', () => {
      expect(readTicketClaims(passWithPayload(toBase64Url('123')))).toBeNull();
      expect(readTicketClaims(passWithPayload(toBase64Url('"a string"')))).toBeNull();
    });

    it('returns null rather than undefined when decoding throws', () => {
      expect(readTicketClaims(passWithPayload('!!!!'))).toBeNull();
    });

    it('returns null for a token with no payload segment', () => {
      expect(readTicketClaims('no-dots-here')).toBeNull();
    });
  });

  describe('createTicketSource', () => {
    it('treats a non-numeric exp claim as already expired', async () => {
      // A string exp must not be multiplied into a future expiry: the cache
      // would then serve a pass nobody can vouch for.
      const fetchMock = okWith(passWithClaims({ exp: '1000' }));

      vi.stubGlobal('fetch', fetchMock);

      const source = createTicketSource('/mint', { now: () => 0 });

      await source();
      await source();

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('throws when the mint endpoint answers with a failure status', async () => {
      const fetchMock = vi.fn<(input: string, init?: unknown) => Promise<FetchResult>>().mockResolvedValue({
        ok: false,
        status: 500,
        json: (): Promise<unknown> => Promise.resolve({ ticket: passWithClaims({ exp: 1000 }) }),
      });

      vi.stubGlobal('fetch', fetchMock);

      const source = createTicketSource('/mint', { now: () => 0 });

      await expect(source()).rejects.toThrow(/status 500/);
    });

    it('refetches at the exact moment the refresh margin opens', async () => {
      // exp = 1000s means expiry at 1_000_000ms; the 30s margin opens at 970_000.
      const fetchMock = okWith(passWithClaims({ exp: 1000 }));

      vi.stubGlobal('fetch', fetchMock);

      const clock = { ms: 0 };
      const source = createTicketSource('/mint', { now: () => clock.ms });

      await source();
      clock.ms = 970_000;
      await source();

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('uses a real clock when no clock is injected', async () => {
      const fetchMock = okWith(passWithClaims({ exp: Math.floor(Date.now() / 1000) + 3600 }));

      vi.stubGlobal('fetch', fetchMock);

      const source = createTicketSource('/mint');

      await source();
      await source();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
