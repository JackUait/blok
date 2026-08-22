# Editor Server Wiring Implementation Plan

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
- **Version lockstep** with the family (currently `1.10.1`).

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/components/utils/server-config.ts` | Expands `server` + `ticket` into existing config keys |
| `src/components/utils/access-pass.ts` | Fetches and caches the access pass |
| `src/components/utils/persistence.ts` | Load on mount, debounced save, in-flight race handling |
| `types/configs/blok-config.d.ts` | `server`, `ticket`, `persistence` declarations |
| `packages/server/src/ticket.ts` | `blokTicket()` — mints a pass in the consumer's backend |
| `src/tools/link/bookmark/index.ts` | Graceful degradation to a plain link |

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

- [ ] **Step 4: Run the tests and watch them pass**

```bash
yarn test test/unit/components/utils/access-pass.test.ts test/unit/components/utils/server-config.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/components/utils/access-pass.ts src/components/utils/server-config.ts types/configs/blok-config.d.ts test/unit/components/utils/access-pass.test.ts
git commit -m "feat(config): fetch and cache access passes for the server option"
```

---

### Task 3: `blokTicket()` — minting a pass in the consumer's backend

**Files:**
- Create: `packages/server/src/ticket.ts`
- Modify: `packages/server/package.json` (add the `./ticket` export and `dist` to `files`)
- Test: `packages/server/src/ticket.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `blokTicket(secret: string, claims: { user: string; doc?: string; write?: boolean; ttlSeconds?: number }): string`

It lives beside the Go verifier deliberately: the signer and the verifier must agree byte for byte, and keeping them in one package means a change to either is one diff. This is pure JavaScript — the package's binary is not involved.

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

/** Must match `minSecretLen` in internal/config/config.go, or the service rejects every pass. */
const MIN_SECRET_LENGTH = 32;
const DEFAULT_TTL_SECONDS = 300;

/** Fixed, never negotiated: the verifier accepts exactly this header. */
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

- [ ] **Step 4: Verify against the Go verifier, not only against itself**

A signer that agrees only with its own tests is worthless. Add a Go test that reads passes minted by this file:

```bash
cd packages/server && node -e "import('./dist/ticket.mjs').then(m => console.log(m.blokTicket('s3cret-value-at-least-32-chars-long!', {user:'u1', ttlSeconds: 3600})))" > /tmp/pass.txt
go test ./internal/ticket/ -run CrossLanguage -v
```

Write `TestCrossLanguagePassFromJS` in `internal/ticket/verify_test.go` reading `BLOK_JS_PASS` from the environment and skipping when unset, so CI can pipe the value in and the default `go test` run stays hermetic.

- [ ] **Step 5: Commit**

```bash
git add packages/server
git commit -m "feat(server): mint access passes from the consumer's backend"
```

---

### Task 4: Bookmarks degrade to a plain link

**Files:**
- Modify: `src/tools/link/bookmark/index.ts:118-152`
- Test: `test/unit/tools/link/bookmark.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: no new API.

Today a failed fetch sets `state = 'ERROR'` and renders a placeholder. But `save()` (`:94`) never persists that state, and the constructor (`:44`) treats any saved `url` as `RENDERED` — so **the same block shows an error placeholder before a reload and a card after one.** This task removes the inconsistency and implements the spec's degradation in one change.

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run the test and watch it fail**

```bash
yarn test test/unit/tools/link/bookmark.test.ts
```

Expected: FAIL — an error placeholder is rendered, and the third test shows the two roots differ.

- [ ] **Step 3: Implement**

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

- [ ] **Step 4: Run the tests and watch them pass**

```bash
yarn test test/unit/tools/link/bookmark.test.ts
yarn lint src/tools/link/bookmark/index.ts
```

- [ ] **Step 5: Commit**

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
- Modify: `docs/src/components/api/api-data.ts`, the docs route table
- Test: `docs/src/components/api/api-data.test.ts`

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

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: document server, ticket, and persistence config keys"
```

---

## Dependencies between the three plans

- This plan's Task 1 imports `fetchStorage` from `@bloklabs/presets`, so the **presets plan lands first**.
- Task 3's cross-language check runs against the Go verifier, so the **service plan's Task 6 lands first**.
- Tasks 4, 5, and 6 depend on neither and can be done at any time. Task 4 in particular is a standing inconsistency in shipped behaviour and is worth doing on its own.
