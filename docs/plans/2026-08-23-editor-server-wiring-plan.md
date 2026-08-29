# Editor Server Wiring Implementation Plan

> **Status amendment (re-verified against the code 2026-08-29):**
>
> - **Task 4 is DONE.** `ToolState` no longer has an `'ERROR'` member at all, the catch
>   branch renders a plain link, and `test/unit/tools/link/bookmark.test.ts` exists. The
>   optional cleanup in its Step 3 was taken: neither `'ERROR'` nor a
>   `tools.bookmark.error` i18n key survives.
> - **Tasks 1, 2, 3, 5, 6 are NOT started.** `grep -rn blokTicket src/ types/` is empty and
>   no `server` / `ticket` / `persistence` key exists in the config surface.
> - **Nothing blocks the rest.** Both upstream plans shipped: `@bloklabs/presets` and
>   `@bloklabs/server` are published at 1.12.0.
> - The server target is the C# host or in-process ASP.NET routes. **Tickets apply only when
>   requests cross into a standalone host**; in-process routes use the consumer's existing
>   identity. See
>   [`2026-08-23-blok-dotnet-library-design.md`](2026-08-23-blok-dotnet-library-design.md).
> - Task 3 was re-scoped — see the decision block on it. Its original justification named the
>   Go verifier, which no longer exists.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the backend wiring a consumer writes today — an uploader, a bookmark endpoint, and save/load plumbing — into one config key, and make link previews degrade to a plain link instead of an error.

**Architecture:** `server` is expanded at config-normalization time into the options that already exist, so no module downstream learns a new concept. Access passes are fetched and cached by the editor and handed to presets as a headers function. Persistence points at the consumer's own endpoint, never at the service.

**Tech Stack:** TypeScript, Vitest, the existing `BlokConfig` surface.

**Spec:** `docs/plans/2026-08-22-backend-service-design.md` (§1 "The `server` option", §2 the pass, §2 honest coverage limit, §3 what remains of the save/load round-trip)

## Global Constraints

- **`server` is sugar, not a new subsystem.** It expands into `config.uploader` and `config.tools.bookmark.config.endpoint` at `src/components/core.ts:84` (`set configuration`), before `validate()` and before any module reads the config. Nothing downstream may branch on `server`.
- **An explicit option always wins.** A consumer setting both `server` and `uploader` keeps their uploader — the spec states this precedence and paths must remain mixable.
- **Published-types law:** no file under `types/` may import from a module resolving into `src/`. Hand-author the signatures.
- **`Blok` class ⊇ API parity:** a new public config key that has a runtime setter must be reachable the same way the existing ones are.
- **Persistence targets the consumer's endpoint.** The service stores no documents; nothing in this plan may point save/load at `server`.
- **Version lockstep** with the family (currently `1.12.0`).

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/components/utils/server-config.ts` | Expands `server` + `ticket` into existing config keys |
| `src/components/utils/access-pass.ts` | Fetches and caches the access pass |
| `src/components/utils/persistence.ts` | Load on mount, debounced save, in-flight race handling |
| `types/configs/blok-config.d.ts` | `server`, `ticket`, `persistence` declarations |
| `packages/server/src/ticket.ts` | `blokTicket()` — mints a pass in the consumer's backend. **The package ships `files: ["bin"]` today: this is the first built JS in it, so Task 3 carries a full build setup.** |
| `src/tools/link/bookmark/index.ts` | Graceful degradation to a plain link — **done** |
| `types/tools/bookmark.d.ts`, `src/tools/link/metadata-fetcher.ts` | Widen `headers` to accept a function, so previews share the cached pass instead of freezing one at construction |
| `docs/src/components/server/server-data.ts` | The standalone-path example whose hand-written wiring these keys replace |

---

### Task 1: The `server` option

**Files:**
- Create: `src/components/utils/server-config.ts`
- Modify: `src/components/core.ts:84-100`, `types/configs/blok-config.d.ts`
- Test: `test/unit/components/utils/server-config.test.ts`

**Interfaces:**
- Consumes: `fetchStorage` from `@bloklabs/presets`.
- Produces: `expandServerConfig(config: BlokConfig): BlokConfig` — pure, returns a new object, never mutates its input.

- [ ] **Step 1: Write the failing test**

`test/unit/components/utils/server-config.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expandServerConfig } from '../../../../src/components/utils/server-config';
import type { BlokConfig } from '../../../../types';

describe('expandServerConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('leaves a config without `server` untouched', () => {
    const config: BlokConfig = { holder: 'app' };

    expect(expandServerConfig(config)).toEqual(config);
  });

  it('fills in an uploader and the bookmark endpoint from one key', () => {
    const result = expandServerConfig({ server: 'https://blok.example.com' });

    expect(result.uploader?.uploadByFile).toBeTypeOf('function');
    expect(result.tools?.bookmark?.config?.endpoint).toBe('https://blok.example.com/unfurl');
  });

  it('strips a trailing slash so the endpoint has no double slash', () => {
    const result = expandServerConfig({ server: 'https://blok.example.com/' });

    expect(result.tools?.bookmark?.config?.endpoint).toBe('https://blok.example.com/unfurl');
  });

  // The spec's precedence rule: paths mix. "Service for previews, own S3 for
  // files" must work without any bridging code.
  it('keeps an explicit uploader and still fills the bookmark endpoint', () => {
    const uploader = { uploadByFile: vi.fn() };

    const result = expandServerConfig({ server: 'https://blok.example.com', uploader });

    expect(result.uploader).toBe(uploader);
    expect(result.tools?.bookmark?.config?.endpoint).toBe('https://blok.example.com/unfurl');
  });

  it('keeps an explicit bookmark endpoint and still fills the uploader', () => {
    const result = expandServerConfig({
      server: 'https://blok.example.com',
      tools: { bookmark: { config: { endpoint: 'https://unfurl.mine.example.com' } } },
    });

    expect(result.tools?.bookmark?.config?.endpoint).toBe('https://unfurl.mine.example.com');
    expect(result.uploader?.uploadByFile).toBeTypeOf('function');
  });

  it('preserves unrelated tool config while filling the bookmark endpoint', () => {
    const result = expandServerConfig({
      server: 'https://blok.example.com',
      tools: { image: { config: { types: 'image/png' } } },
    });

    expect(result.tools?.image?.config?.types).toBe('image/png');
    expect(result.tools?.bookmark?.config?.endpoint).toBe('https://blok.example.com/unfurl');
  });

  it('does not mutate the config it was given', () => {
    const config: BlokConfig = { server: 'https://blok.example.com' };

    expandServerConfig(config);

    expect(config.uploader).toBeUndefined();
    expect(config.tools).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
yarn test test/unit/components/utils/server-config.test.ts
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

`src/components/utils/server-config.ts`:

```typescript
import { fetchStorage } from '@bloklabs/presets';
import type { BlokConfig } from '../../../types';

/**
 * Expands the `server` shorthand into the options that already exist.
 *
 * Runs once at config-normalization time, so no module downstream ever learns
 * that `server` exists. Explicit options always win: a consumer may take the
 * service for link previews while keeping their own uploader.
 * @param config - the user-supplied configuration
 */
export function expandServerConfig(config: BlokConfig): BlokConfig {
  const server = config.server;

  if (server === undefined) {
    return config;
  }

  const base = server.replace(/\/+$/, '');
  const expanded: BlokConfig = { ...config };

  if (expanded.uploader === undefined) {
    expanded.uploader = fetchStorage({ baseUrl: base });
  }

  const bookmark = config.tools?.bookmark;
  const bookmarkConfig = (bookmark as { config?: Record<string, unknown> } | undefined)?.config;

  if (bookmarkConfig?.endpoint === undefined) {
    expanded.tools = {
      ...config.tools,
      bookmark: {
        ...(typeof bookmark === 'object' ? bookmark : {}),
        config: { ...bookmarkConfig, endpoint: `${base}/unfurl` },
      },
    };
  }

  return expanded;
}
```

In `src/components/core.ts`, inside `set configuration`, run the expansion before anything else touches the value — the setter already normalizes a string-or-object argument, so apply it to the normalized object, not the raw one.

Declare the key in `types/configs/blok-config.d.ts`:

```typescript
  /**
   * Base URL of a service speaking Blok's upload and unfurl contracts, e.g.
   * `https://blok.myapp.com` or a same-origin path like `/api/blok`.
   *
   * Shorthand only: it fills in `uploader` and the bookmark tool's `endpoint`
   * if you have not set them yourself. Anything you set explicitly wins, so
   * taking the service for link previews while uploading into your own S3 needs
   * no extra wiring.
   *
   * It does NOT configure document storage — that stays yours. See `persistence`.
   */
  server?: string;
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
yarn test test/unit/components/utils/server-config.test.ts
yarn lint src/components/utils/server-config.ts types/configs/blok-config.d.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/components/utils/server-config.ts src/components/core.ts types/configs/blok-config.d.ts test/unit/components/utils/server-config.test.ts
git commit -m "feat(config): expand the server option into uploader and unfurl endpoint"
```

---

### Task 2: Access passes

**Files:**
- Create: `src/components/utils/access-pass.ts`
- Modify: `src/components/utils/server-config.ts`, `types/configs/blok-config.d.ts`
- Test: `test/unit/components/utils/access-pass.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `createPassSource(options: { endpoint: string; now?: () => number }): () => Promise<Record<string, string>>` — a headers function suitable for `fetchStorage({ headers })`.

- [ ] **Step 1: Write the failing test**

`test/unit/components/utils/access-pass.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPassSource } from '../../../../src/components/utils/access-pass';

// A pass whose payload declares exp = 1000 (seconds).
const PASS = `x.${btoa(JSON.stringify({ exp: 1000 })).replace(/=+$/, '')}.y`;

describe('createPassSource', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ticket: PASS }) });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches a pass and returns it as an Authorization header', async () => {
    const headers = await createPassSource({ endpoint: '/api/blok-ticket', now: () => 0 })();

    expect(headers).toEqual({ Authorization: `Bearer ${PASS}` });
    expect(fetchMock).toHaveBeenCalledWith('/api/blok-ticket', expect.objectContaining({ credentials: 'same-origin' }));
  });

  it('reuses a cached pass until it is close to expiring', async () => {
    const source = createPassSource({ endpoint: '/api/blok-ticket', now: () => 0 });

    await source();
    await source();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Refreshing only at the moment of expiry guarantees some requests race the
  // clock and arrive already invalid, so the pass is replaced early.
  it('refetches once the pass is within the refresh margin of expiry', async () => {
    let clock = 0;
    const source = createPassSource({ endpoint: '/api/blok-ticket', now: () => clock });

    await source();
    clock = 990_000; // 990s — inside the 30s margin before exp = 1000s
    await source();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('collapses concurrent callers onto a single request', async () => {
    const source = createPassSource({ endpoint: '/api/blok-ticket', now: () => 0 });

    await Promise.all([source(), source(), source()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws a message naming the endpoint when it answers non-ok', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    await expect(createPassSource({ endpoint: '/api/blok-ticket', now: () => 0 })())
      .rejects.toThrow(/\/api\/blok-ticket/);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
yarn test test/unit/components/utils/access-pass.test.ts
```

- [ ] **Step 3: Implement**

`src/components/utils/access-pass.ts`:

```typescript
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

export function createPassSource(options: PassSourceOptions): () => Promise<Record<string, string>> {
  const now = options.now ?? ((): number => Date.now());
  let cached: CachedPass | null = null;
  let inFlight: Promise<CachedPass> | null = null;

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
    if (cached !== null && now() < cached.expiresAtMs - REFRESH_MARGIN_MS) {
      return { Authorization: `Bearer ${cached.token}` };
    }

    // One request serves every concurrent caller: a page with six images would
    // otherwise mint six passes on load.
    inFlight ??= fetchPass().finally(() => {
      inFlight = null;
    });

    cached = await inFlight;

    return { Authorization: `Bearer ${cached.token}` };
  };
}

/** Reads `exp` out of the payload segment. A pass we cannot read is treated as expiring now. */
function readExpiry(token: string): number {
  const segment = token.split('.')[1];

  if (segment === undefined) {
    return 0;
  }

  try {
    const payload = JSON.parse(atob(segment.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown };

    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}
```

Extend `expandServerConfig` so a `ticket` option feeds `fetchStorage({ headers })` and the bookmark tool's `headers` config, and declare `ticket?: string` in `types/configs/blok-config.d.ts`.

**A gap found 2026-08-29 that this step must close first: the bookmark tool cannot accept a
live pass.** The two sides disagree today —

| | type |
|---|---|
| `fetchStorage` (`packages/presets/types/index.d.ts:67`) | `Record<string, string> \| (() => Promise<Record<string, string>>)` |
| bookmark (`types/tools/bookmark.d.ts:30`, read at `src/tools/link/metadata-fetcher.ts:48`) | `Record<string, string>` only |

So a pass handed to the bookmark tool is resolved **once, at editor construction, and then
frozen** — link previews start failing the moment it expires, while uploads keep working.
This is not hypothetical: the documented example in
`docs/src/components/server/server-data.ts` writes exactly that
(`bookmark: { config: { endpoint, headers: await authHeaders() } }`), and its passes live an
hour.

Widen bookmark's `headers` to the same union as `fetchStorage`, resolve it per request in
`MetadataFetcher`, and cover it with a test that mints two different values and asserts the
second request carries the second one. Then one `createPassSource` instance feeds both sides
and the whole editor shares one cached pass.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
yarn test test/unit/components/utils/access-pass.test.ts test/unit/components/utils/server-config.test.ts test/unit/tools/link/metadata-fetcher.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/components/utils/access-pass.ts src/components/utils/server-config.ts types/configs/blok-config.d.ts test/unit/components/utils/access-pass.test.ts
git commit -m "feat(config): fetch and cache access passes for the server option"
```

---

### Task 3: `blokTicket()` — minting a pass in the consumer's backend

> **Re-scoped 2026-08-29.** The original justification — "it lives beside the Go verifier, so
> a change to either is one diff" — rests on two dead premises. The verifier is now
> `packages/server/dotnet/Blok.Server/TicketVerifier.cs`, and `packages/server/package.json`
> declares `files: ["bin"]` with no `scripts` block at all: **the package has never shipped
> built JS, only the launcher.** The location still holds, for a weaker but sufficient
> reason — one function, in a package that already exists and is already in
> `release-manifest.mjs`'s `FAMILY`. But the signer is now the small half of this task and
> the build wiring is the large half. Budget accordingly.
>
> **Backends that are not JavaScript get no signer.** Task 6 documents the raw contract
> instead. One signer per language is the option this project's design deliberately rejected,
> and the audience that most needs a ticket — the serverless path — is JavaScript by
> definition.

**Files:**
- Create: `packages/server/src/ticket.ts`, `packages/server/vite.config.mjs`,
  `packages/server/types/index.d.ts`, `packages/server/src/ticket.conformance.test.ts`
- Modify: `packages/server/package.json` (`scripts.build`, `scripts.test`, `exports`, `files`),
  `scripts/build-all.mjs`, `test/unit/scripts/build-all.test.ts`, `.github/workflows/ci.yml`,
  `test/unit/architecture/ci-critical-path-law.test.ts`,
  `scripts/release-manifest.mjs` (its `@bloklabs/server` comment says "Ships only the npm
  wrapper (bin/)" — that stops being true)
- Test: `packages/server/src/ticket.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `blokTicket(secret: string, claims: { user: string; doc?: string; write?: boolean; ttlSeconds?: number }): string`

**The wire contract, and two couplings that fail silently if broken:**

1. **The header segment is compared as a string, not parsed.** `TicketVerifier.TryVerify`
   holds a hard-coded constant (`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`) and rejects anything
   else ordinally. So the signer must emit byte-exact `{"alg":"HS256","typ":"JWT"}` — that
   key order, no spaces. A reordered header is a KNOWN failing case, already fixtured as
   `noncanonicalHeaderTicket`.
2. **Claim names are `user` / `doc` / `write` / `exp`** (`TicketPayload`'s
   `[JsonPropertyName]` attributes). The payload is parsed, so its key order does not matter
   to the verifier — but it does matter to the byte-comparison in Step 5, so emit them in
   that order.

The minimum secret length is **32**, enforced at `BlokServerOptions.cs:61`, which refuses to
start rather than warn.

- [ ] **Step 0: Give the package a test runner**

`packages/server/package.json` has **no `scripts` block at all**, so Step 2 has nothing to run.
Before writing the test, add `"test": "yarn run -T vitest run"` and a `vitest.config.ts`
copied from `packages/presets`. Nothing else — the build half stays in Step 4, where it can be
driven by a signer that already works.

```bash
yarn workspace @bloklabs/server test   # 0 tests, exits clean
```

- [ ] **Step 1: Write the failing test**

`packages/server/src/ticket.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blokTicket } from './ticket';

const SECRET = 's3cret-value-at-least-32-chars-long!';

afterEach(() => {
  vi.useRealTimers();
});

describe('blokTicket', () => {
  it('produces three base64url segments', () => {
    const parts = blokTicket(SECRET, { user: 'u1' }).split('.');

    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part).not.toMatch(/[+/=]/);
    }
  });

  it('declares HS256, which is the only algorithm the service accepts', () => {
    const [header] = blokTicket(SECRET, { user: 'u1' }).split('.');

    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
  });

  it('carries the claims and a default five-minute expiry', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const [, payload] = blokTicket(SECRET, { user: 'u1', doc: 'doc-42', write: true }).split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());

    expect(claims).toMatchObject({ user: 'u1', doc: 'doc-42', write: true });
    expect(claims.exp).toBe(Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000) + 300);
  });

  it('honours an explicit ttl', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const [, payload] = blokTicket(SECRET, { user: 'u1', ttlSeconds: 60 }).split('.');

    expect(JSON.parse(Buffer.from(payload, 'base64url').toString()).exp)
      .toBe(Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000) + 60);
  });

  it('refuses a secret shorter than the service will accept', () => {
    expect(() => blokTicket('short', { user: 'u1' })).toThrow(/32/);
  });

  it('produces a different signature for a different secret', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const a = blokTicket(SECRET, { user: 'u1' });
    const b = blokTicket('another-secret-that-is-long-enough!!', { user: 'u1' });

    expect(a.split('.')[2]).not.toBe(b.split('.')[2]);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
yarn workspace @bloklabs/server test src/ticket.test.ts
```

- [ ] **Step 3: Implement**

`packages/server/src/ticket.ts`:

```typescript
import { createHmac } from 'node:crypto';

/** Must match the check at BlokServerOptions.cs:61, or the service refuses to start. */
const MIN_SECRET_LENGTH = 32;
const DEFAULT_TTL_SECONDS = 300;

/**
 * Byte-exact, never negotiated: TicketVerifier compares the encoded header segment
 * against a hard-coded constant ORDINALLY. Reordering these two keys, or adding a
 * space, is rejected — see the noncanonicalHeaderTicket fixture.
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

function b64(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64url');
}
```

- [ ] **Step 4: Make the package able to ship JavaScript**

This is the part with no precedent in `packages/server`. Mirror `packages/presets`, which is
the closest shape — a published, zero-runtime-dependency package.

- `packages/server/package.json`: add `"type": "module"`, `sideEffects: false`, a `build`
  script (`yarn run -T vite build --mode production`), an `exports` map with a `./ticket`
  subpath, and extend `files` to `["bin", "dist", "types"]`. (`test` landed in Step 0.) **Re-run `npx @bloklabs/server --help` from the packed
  tarball afterwards** — the launcher is the package's existing product and must not regress.
- `packages/server/vite.config.mjs`: copy the presets one. Keep `node:crypto` external — this code runs in the consumer's backend, never in a browser.
- `packages/server/types/index.d.ts`: hand-authored, per the published-types law. It must not
  reference anything under `src/`.

Then the registration lists. **Nothing iterates `packages/*`** — each of these is explicit,
and two of them are pinned by tests that go red the moment you touch the thing they pin:

| Where | What | Pinned by |
|---|---|---|
| `scripts/build-all.mjs` | a `server` build task | `test/unit/scripts/build-all.test.ts` pins task-graph LENGTHS — 10 at `:79`, 14 at `:125` |
| `.github/workflows/ci.yml` | a `yarn workspace @bloklabs/server test` step, beside the presets one at `:349` | `test/unit/architecture/ci-critical-path-law.test.ts` snapshots CI's exact ordered steps |
| `scripts/release-manifest.mjs` | `FAMILY` **already has** `@bloklabs/server` — no entry to add, but its comment is now wrong | — |
| `test/unit/architecture/package-metadata-law.test.ts` | already lists the package; check whether the new fields trip any of its assertions | itself |

**Verify the release path actually builds `dist` before `release-manifest` packs
`packages/server`.** This package has never needed a build step, so that ordering has never
been exercised — a green local `yarn build` proves nothing about it. Pack the tarball and
list its contents.

- [ ] **Step 5: Verify against the real verifier, not only against itself**

A signer that agrees only with its own tests is worthless. The cross-language fixtures
already exist on the JS side: **`test/unit/server-conformance/fixtures/tickets.json`** —
a secret plus five passes (`compatible`, `expired`, `malformed`, `tampered`,
`noncanonicalHeaderTicket`), the same file the C# suites read.

`packages/server/src/ticket.conformance.test.ts` freezes the clock, mints with that fixture's
secret and the claims baked into `compatible` (`user: 'u1'`, `doc: 'doc-42'`, `write: true`,
`exp: 4102444800`), and asserts **byte equality with the fixture string**. Not "the verifier
accepts it" — equality, so a drift in header bytes or payload key order fails here rather
than in production.

```bash
yarn workspace @bloklabs/server test
```

Do not add a copy of the fixture under `packages/server`. One file, two readers: the copies
you will find under `bin/` are build output.

- [ ] **Step 6: Commit**

```bash
git add packages/server scripts test .github
git commit -m "feat(server): mint access passes from the consumer's backend"
```

---

### Task 4: Bookmarks degrade to a plain link — ✅ DONE

> Shipped. Verified in the code 2026-08-29: `ToolState` is `'EMPTY' | 'LOADING' | 'RENDERED'`
> — the `'ERROR'` member is gone entirely, both catch branches set `'RENDERED'`, and
> `test/unit/tools/link/bookmark.test.ts` exists. Step 3's optional cleanup was taken: no
> `tools.bookmark.error` key survives in any locale. The steps below are kept as the record of
> what was done; nothing here is outstanding.

**Files:**
- Modify: `src/tools/link/bookmark/index.ts:118-152`
- Test: `test/unit/tools/link/bookmark.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: no new API.

Today a failed fetch sets `state = 'ERROR'` and renders a placeholder. But `save()` (`:94`) never persists that state, and the constructor (`:44`) treats any saved `url` as `RENDERED` — so **the same block shows an error placeholder before a reload and a card after one.** This task removes the inconsistency and implements the spec's degradation in one change.

- [x] **Step 1: Write the failing test**

Append to `test/unit/tools/link/bookmark.test.ts` (create it following the conventions in `test/unit/tools/`):

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Bookmark — failed metadata fetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a plain link card instead of an error placeholder', async () => {
    const tool = createBookmarkTool({ endpoint: 'https://unfurl.example.com' });

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    const root = tool.render();

    await pasteUrl(tool, 'https://example.com/article');

    expect(root.querySelector('[data-blok-testid="bookmark-error"]')).toBeNull();

    const card = root.querySelector('[data-blok-testid="bookmark-card"]');

    expect(card).not.toBeNull();
    expect(card?.getAttribute('href')).toBe('https://example.com/article');
  });

  it('shows the domain as the title when no metadata arrived', async () => {
    const tool = createBookmarkTool({ endpoint: 'https://unfurl.example.com' });

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    const root = tool.render();

    await pasteUrl(tool, 'https://example.com/article');

    expect(root.querySelector('[data-role="bookmark-title"]')?.textContent).toContain('example.com');
  });

  // The inconsistency this task removes: before, a fresh failure and the same
  // block after a reload rendered differently.
  it('renders identically to the same block loaded from saved data', async () => {
    const failed = createBookmarkTool({ endpoint: 'https://unfurl.example.com' });

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    const freshRoot = failed.render();

    await pasteUrl(failed, 'https://example.com/article');

    const reloaded = createBookmarkTool({ endpoint: 'https://unfurl.example.com' }, { url: 'https://example.com/article' });
    const reloadedRoot = reloaded.render();

    expect(freshRoot.innerHTML).toBe(reloadedRoot.innerHTML);
  });

  it('saves only the url when metadata never arrived', async () => {
    const tool = createBookmarkTool({ endpoint: 'https://unfurl.example.com' });

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    tool.render();

    await pasteUrl(tool, 'https://example.com/article');

    expect(tool.save()).toEqual({ url: 'https://example.com/article' });
  });
});
```

`createBookmarkTool` and `pasteUrl` are local helpers in the test file: the first constructs the tool with a stub `api` exposing `i18n.t`, the second dispatches the pattern paste event `onPaste` expects and awaits a microtask flush.

- [x] **Step 2: Run the test and watch it fail**

```bash
yarn test test/unit/tools/link/bookmark.test.ts
```

Expected: FAIL — an error placeholder is rendered, and the third test shows the two roots differ.

- [x] **Step 3: Implement**

In `startFetch`, replace the catch branch:

```typescript
      .catch(() => {
        // No metadata is not an error state: roughly 30% of sites refuse bots,
        // and a red placeholder for a link that is perfectly valid is worse than
        // a plain card. This also matches how the same block renders after a
        // reload, where only `url` survives — see save() and the constructor.
        this.state = 'RENDERED';
        this.renderState();
      });
```

`buildCard` already falls back to `fallbackTitle()` when `data.title` is absent, so no rendering change is needed.

Keep `ToolState`'s `'ERROR'` member and `buildError` only if something still reaches them; if nothing does, delete both and the now-unused `tools.bookmark.error` i18n key across all locale files — a key no code reads is a translation cost with no reader. Check first:

```bash
grep -rn "'ERROR'" src/tools/link/bookmark/index.ts
grep -rn "tools.bookmark.error" src/ | head
```

- [x] **Step 4: Run the tests and watch them pass**

```bash
yarn test test/unit/tools/link/bookmark.test.ts
yarn lint src/tools/link/bookmark/index.ts
```

- [x] **Step 5: Commit**

```bash
git add src/tools/link/bookmark/index.ts test/unit/tools/link/bookmark.test.ts
git commit -m "fix(bookmark): fall back to a plain link when no metadata arrives"
```

---

### Task 5: `persistence` — load on mount, debounced save, race handling

**Files:**
- Create: `src/components/utils/persistence.ts`
- Modify: `src/components/utils/server-config.ts`, `types/configs/blok-config.d.ts`
- Test: `test/unit/components/utils/persistence.test.ts`

**Interfaces:**
- Consumes: the existing `data` and `onSave` config keys.
- Produces: `expandPersistenceConfig(config: BlokConfig): BlokConfig` — turns a `persistence` block into `data` (a promise the editor already accepts) plus an `onSave` handler.

```ts
interface PersistenceConfig {
  load(): Promise<OutputData | null>;
  save(data: OutputData): Promise<void>;
}
```

Callbacks rather than a URL: the consumer's endpoint shape, auth, and document id are theirs, and a URL template would need to grow options for each. Two functions cost them three lines and cost us no configuration surface.

- [ ] **Step 1: Write the failing test**

`test/unit/components/utils/persistence.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expandPersistenceConfig } from '../../../../src/components/utils/persistence';
import type { OutputData } from '../../../../types';

const DOC: OutputData = { blocks: [], time: 0, version: '1' };

describe('expandPersistenceConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('leaves a config without `persistence` untouched', () => {
    const config = { holder: 'app' };

    expect(expandPersistenceConfig(config)).toEqual(config);
  });

  it('wires load() into data and save() into onSave', async () => {
    const load = vi.fn().mockResolvedValue(DOC);
    const save = vi.fn().mockResolvedValue(undefined);

    const result = expandPersistenceConfig({ persistence: { load, save } });

    await expect(result.data as Promise<OutputData>).resolves.toEqual(DOC);

    result.onSave?.(DOC, {} as never);
    expect(save).toHaveBeenCalledWith(DOC);
  });

  it('treats a null from load() as an empty document rather than a failure', async () => {
    const result = expandPersistenceConfig({ persistence: { load: async () => null, save: vi.fn() } });

    await expect(result.data as Promise<OutputData | null>).resolves.toBeNull();
  });

  // onSave is already debounced upstream, but a slow save can still be overtaken
  // by the next one. Out-of-order completion would resurrect stale content.
  it('never runs two saves concurrently and always sends the newest payload last', async () => {
    const started: OutputData[] = [];
    let release: (() => void) | null = null;
    const save = vi.fn().mockImplementation(async (data: OutputData) => {
      started.push(data);
      if (started.length === 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
    });

    const result = expandPersistenceConfig({ persistence: { load: async () => null, save } });
    const first = { ...DOC, time: 1 };
    const second = { ...DOC, time: 2 };
    const third = { ...DOC, time: 3 };

    result.onSave?.(first, {} as never);
    result.onSave?.(second, {} as never);
    result.onSave?.(third, {} as never);

    expect(started).toEqual([first]);

    release?.();
    await vi.waitFor(() => expect(started).toHaveLength(2));

    // Only the newest queued payload is sent: the intermediate one is obsolete.
    expect(started[1]).toEqual(third);
  });

  it('reports a failed save without stopping later saves', async () => {
    const onError = vi.fn();
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);

    const result = expandPersistenceConfig({ persistence: { load: async () => null, save, onError } });

    result.onSave?.(DOC, {} as never);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(Error)));

    result.onSave?.(DOC, {} as never);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
yarn test test/unit/components/utils/persistence.test.ts
```

- [ ] **Step 3: Implement**

`src/components/utils/persistence.ts`:

```typescript
import type { BlokConfig, OutputData } from '../../../types';

export interface PersistenceConfig {
  /** Read the document. Return null for "nothing saved yet". */
  load(): Promise<OutputData | null>;
  /** Write the document. Called at most once at a time. */
  save(data: OutputData): Promise<void>;
  /** Called when a save rejects. Without it, failures are silent. */
  onError?(error: unknown): void;
}

/**
 * Turns a `persistence` block into the `data` and `onSave` keys the editor
 * already has.
 *
 * The queue matters: `onSave` is debounced upstream, but a slow save can still
 * be overtaken by the next one, and out-of-order completion resurrects stale
 * content. One save runs at a time, and only the NEWEST pending payload is sent
 * after it — intermediate ones are already obsolete.
 * @param config - the user-supplied configuration
 */
export function expandPersistenceConfig(config: BlokConfig): BlokConfig {
  const persistence = config.persistence;

  if (persistence === undefined) {
    return config;
  }

  let inFlight: Promise<void> | null = null;
  let pending: OutputData | null = null;

  const drain = (): void => {
    if (inFlight !== null || pending === null) {
      return;
    }

    const payload = pending;

    pending = null;
    inFlight = persistence
      .save(payload)
      .catch((error: unknown) => {
        persistence.onError?.(error);
      })
      .finally(() => {
        inFlight = null;
        drain();
      });
  };

  return {
    ...config,
    data: config.data ?? persistence.load(),
    onSave: (data: OutputData): void => {
      pending = data;
      drain();
    },
  };
}
```

Declare `persistence?: PersistenceConfig` in `types/configs/blok-config.d.ts`, hand-authoring `PersistenceConfig` there rather than importing it from `src/` — the published-types law forbids the import.

Confirm that `config.data` accepts a promise; if it does not, resolve `load()` before construction in `core.ts` and set `data` from the result, keeping `expandPersistenceConfig` pure by returning the promise for the caller to await.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
yarn test test/unit/components/utils/persistence.test.ts
yarn lint src/components/utils/persistence.ts types/configs/blok-config.d.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/components/utils/persistence.ts src/components/utils/server-config.ts types/configs/blok-config.d.ts test/unit/components/utils/persistence.test.ts
git commit -m "feat(config): add persistence wiring against the consumer's own endpoint"
```

---

### Task 6: Documentation

**Files:**
- Modify: `docs/src/components/api/api-data.ts`, the docs route table,
  **`docs/src/components/server/server-data.ts`**
- Test: `docs/src/components/api/api-data.test.ts`,
  `docs/src/components/server/server-data.test.ts`

`server-data.ts` is the plain-language source of truth for the four consumer paths, and it
already carries **hand-written wiring that these tasks make obsolete** — see Step 5.

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { configOptions } from './api-data';

describe('server wiring docs', () => {
  it('documents the three new config keys', () => {
    const names = configOptions.map((o) => o.option);

    expect(names).toContain('server');
    expect(names).toContain('ticket');
    expect(names).toContain('persistence');
  });

  it('states that server does not configure document storage', () => {
    const server = configOptions.find((o) => o.option === 'server');

    expect(server?.description).toMatch(/does not.*document/i);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd docs && yarn test src/components/api/api-data.test.ts
```

- [ ] **Step 3: Write the entries**

Three entries, each with the precedence rule stated plainly: anything set explicitly beats `server`. The `server` description must say it does **not** configure document storage — that is the single most likely wrong assumption a reader will bring, given the name.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd docs && yarn test src/components/api/api-data.test.ts
```

- [ ] **Step 5: Replace the hand-written wiring in `server-data.ts`**

This file documents the standalone-host path with working code, and three pieces of it are
superseded:

| What it shows today | After these tasks |
|---|---|
| `appRoute` — a Next.js handler that builds the JWT by hand with `createHmac` and two `b64` calls | `blokTicket(process.env.BLOK_SECRET, { user: session.userId, write: true })` |
| `editorConfig` — `uploader: fetchStorage({ baseUrl })` plus a `bookmark.config.endpoint` | one `server` key, plus `ticket` |
| `authHeaders` — refetches a pass **before every upload**, and freezes a second one for bookmarks with `await authHeaders()` | `createPassSource` caches, refreshes ahead of expiry, and feeds both sides |

**Keep the hand-rolled version, moved and relabelled** — it is the contract for backends that
are not JavaScript, and its own comment already makes that argument ("Every language has a
one-line library for this; it is spelled out here so you can see there is no magic in it").
State the contract explicitly beside it: HS256, claims `user` / `doc` / `write` / `exp`,
secret at least 32 characters, header keys in that order.

Pin it: extend `server-data.test.ts` so the standalone path's editor config uses `server` and
the raw contract entry names all four claims. That file already asserts things at this
granularity — it checks which flags the binary parses and which limits are stated.

- [ ] **Step 6: Run the docs tests and watch them pass**

```bash
cd docs && yarn test src/components/api/api-data.test.ts src/components/server/server-data.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add docs
git commit -m "docs: document server, ticket, and persistence config keys"
```

---

## Dependencies between the three plans

**Both upstream plans have shipped — nothing here is blocked.** `@bloklabs/presets` and
`@bloklabs/server` are published at 1.12.0.

- This plan's Task 1 imports `fetchStorage` from `@bloklabs/presets`. **Satisfied.**
- Task 3's cross-language check ran against the Go verifier in the original plan. Go is gone:
  it now checks against `test/unit/server-conformance/fixtures/tickets.json`, which already
  exists and is already read by the C# suites. **Satisfied.**

## Suggested order

Tasks 1 → 2 → 5 are one run of work on the editor and share `expandServerConfig`. Task 3 is
independent and can go in parallel, but it is the longest — its weight is the package build
and the pinned lists, not the signer. Task 6 last, since it documents all of them. Task 4 is
done.
- Tasks 4, 5, and 6 depend on neither and can be done at any time. Task 4 in particular is a standing inconsistency in shipped behaviour and is worth doing on its own.
