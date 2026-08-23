# Blok Backend Service — Design

> **Status:** superseded for implementation language and delivery shape by
> [`2026-08-23-blok-dotnet-library-design.md`](2026-08-23-blok-dotnet-library-design.md).
> Its wire contracts, consumer paths, and security invariants remain inputs to the C#
> design. Go is not a permanent implementation.

## Goal

Let a Blok consumer get a fully working editor — uploads, link previews, and a
save/load round-trip — writing as little backend code as possible, while
Blok itself takes on no hosting, no per-language SDK matrix, and no CVE-response
obligation across ecosystems it cannot service.

Two costs are treated as first-class and weighted equally:

- **Lines of code** the consumer writes.
- **Concepts** the consumer must learn. Blok's audience is largely frontend
  developers. A backend feature whose mental model needs backend vocabulary to
  explain will not be adopted, no matter how few lines it takes.

## Scope

**In scope (first step):** file uploads, link-preview (unfurl), and the client half of
the save/load round-trip (debounced autosave, load on mount, race handling) aimed
at the consumer's own endpoint.

**Explicitly not stored by us:** documents. See §3 — the service owns what passes
through it, never the consumer's records.

**Deferred, but the architecture must not have to be rewritten for it:**

- **Multiplayer**: real-time sync, cursors, presence.

The earlier notion of a middle tier — "document storage as a product", with versions,
listing, and per-document permissions — is **dropped, not deferred.** The ownership
line in §3 rules it out: those are the consumer's records, and shipping them would
mean shipping a permissions model that duplicates theirs.

Multiplayer is the one case where we must persist documents, because a sync server
with nothing to persist cannot merge two people's edits. Even there the consumer's
endpoint can remain the system of record, with our storage acting as the sync
working set. That distinction is part of multiplayer's own design, not this one.

## Decisions already made

| Decision | Rationale |
|---|---|
| Service implemented in **Go** | Language is invisible to the consumer in sidecar form. Go gives a single static binary, and the most mature SSRF-protection ecosystem (`doyensec/safeurl`, Stripe Smokescreen are both Go). Production-ready Yjs ports exist in Go (`reearth/ygo`, `Deln0r/ygo`), so multiplayer is not blocked. |
| **Sidecar-first** delivery | Removes the multi-language question entirely: a Python/PHP/Ruby shop runs a container, it does not reimplement anything. `docker run` is fewer lines than any SDK. |
| The service is **one path, not a requirement** | Client-side presets for Supabase/S3/Cloudinary sit beside it with equal billing. Only link previews genuinely require a server. |
| **No hosted service** | Cost, abuse, uptime obligations for other people's production, and privacy — every consumer's link URLs flowing through our infra. |
| **No per-language SDKs** | See Evidence. Empirically the worst-performing model in this space. |

Accepted trade-off: JS apps on serverless hosting (Vercel, Netlify) cannot run a
sidecar next to the app and must deploy the service separately.

---

## 1. Three paths

The three consumer situations need different things. Each installs only what
applies to it.

### Path 1 — "I already have storage"

Consumer is on Supabase, Firebase, S3, or Cloudinary. No service is run at all.

```ts
import { supabaseStorage } from '@bloklabs/presets';

new Blok({
  uploader: supabaseStorage(supabase, { bucket: 'blok' }),
});
```

The browser uploads straight to their storage.

**Exception:** link previews are impossible this way — the browser cannot fetch a
third-party page and read its metadata (CORS). Such a consumer either runs our
service for that one feature, or points at a third-party unfurl service
(Microlink has a free tier). If they do not want link previews, they need nothing.

### Path 2 — "I run my own server"

Django, Rails, Laravel, Go, on their own machine or in Kubernetes. Our container
runs alongside, bound to loopback, unreachable from the internet.

```
docker run bloklabs/server --listen 127.0.0.1:4000
```

The app adds one forwarding route guarded by its existing auth middleware.

```ts
new Blok({ server: '/api/blok' });
```

### Path 3 — "I am on Vercel/Netlify"

No sidecar is possible. The service is deployed separately (Fly, Railway, a VPS)
and is publicly reachable under the consumer's own subdomain. The app adds one
route that issues a pass.

```ts
new Blok({ server: 'https://blok.myapp.com', ticket: '/api/blok-ticket' });
```

### Comparison

| | Path 1 | Path 2 | Path 3 |
|---|---|---|---|
| Runs our service | no¹ | yes, internal | yes, public |
| Route in their app | none | forwarding | pass issuing |
| Domain + TLS | no | no | yes |
| File bytes through their app | no | yes | no |
| Link previews | needs someone's service | yes | yes |

¹ unless link previews are wanted

### The `server` option

One config key replaces three: the uploader, the bookmark endpoint, and the
save/load wiring — the last of these aimed at the consumer's own endpoint, not at
ours. Today these are three separate config blocks with three separate docs pages.

**Precedence:** an explicit `uploader` beats `server`. A consumer may take the
service for link previews while continuing to upload into their own S3. Paths mix
rather than exclude each other — this falls out of the seam design (§3) rather
than needing bridging code.

---

## 2. The service

### Routes

```
GET  /unfurl?url=...      link preview
POST /upload              file upload (multipart)
POST /upload-by-url       re-host a file from a third-party URL
GET  /health              liveness + running version
```

`/health` reports the version for diagnostics only — "which build am I talking
to". It is not a compatibility negotiation; see §4 on lockstep versioning.

### Wire contracts

The response shapes are **exactly those Blok already parses today**, pinned by
`src/tools/link/metadata-fetcher.ts` and `src/tools/file/uploader.ts`:

```jsonc
// GET /unfurl
{ "success": 1, "link": "...", "meta": { "title": "...", "description": "...",
  "image": { "url": "..." }, "favicon": "...", "domain": "..." } }

// POST /upload, POST /upload-by-url
{ "url": "...", "fileName": "...", "size": 123, "mimeType": "..." }
```

Two consequences come free:

- A consumer who already wrote their own backend can point at our service with no
  client-side change.
- A consumer who dislikes one of our four routes replaces that one route with their
  own code and keeps the other three.

### Access modes

One flag at startup.

**`--auth none`** — local development. Nothing to configure.
Safety interlock: with this flag, if the service is told to listen on anything
other than loopback it **refuses to start** and explains why. Shipping an open
service by forgetting a flag is made physically impossible.

**`--auth proxy`** — path 2. Binds loopback and trusts the app: if the request
arrived, the app already authorized it.

**`--auth ticket --secret ...`** — path 3. Verifies a pass on every request.

### The pass

A string carrying: who (user id), what is permitted (read/write, which document),
and an expiry — plus a signature computed from that payload and the shared secret.
It cannot be forged without the secret, and it is verified locally with no
round-trip to the app.

The consumer never writes crypto:

```ts
blokTicket(SECRET, { user: user.id, doc: 'doc-42' })
```

The format is standard JWT, so on Python, PHP, Ruby, and C# this is also one line
with a stock library. Unlike SSRF libraries (§Evidence), JWT libraries are
maintained everywhere.

### Outbound-fetch hardening

**Two routes fetch a consumer-supplied URL from the server: `GET /unfurl` and
`POST /upload-by-url`.** They are the same sink and MUST share one guarded HTTP
client — there is no second, laxer path. Re-hosting an image from a URL is exactly
as exploitable as reading a page's metadata, and treating it as "just an upload"
is how this class of hole ships.

Two distinct threats against that shared client. They are not the same problem and
need separate answers.

**1. Being used to attack the machine we run on.** A user supplies a link; the
service fetches it. Naively implemented, `http://169.254.169.254/…` makes the
service read cloud credentials out of its own host. Required:

- reject private / link-local / loopback / metadata address ranges
- **re-check after every redirect hop**, not only the initial URL
- pin the resolved IP at connect time — validating a hostname then handing it to
  an HTTP client that re-resolves is a TOCTOU hole (DNS rebinding). Substituting
  the IP into the URL is *not* an acceptable fix: it breaks TLS, because the
  certificate is issued for the hostname. The check must live at connection setup.
- cap response bytes, cap redirect count, enforce a timeout
- `http`/`https` only

We do **not** implement this ourselves — see §5.

**2. Being used as a free scanning proxy.** If the service is public (path 3) and
its address is discovered, anyone can drive requests at third-party sites from the
consumer's IP. This is the same abuse we refused to take on by not hosting; here
the consumer receives the complaints.

Therefore, in public mode, both outbound-fetch routes are **contractually** bound
by an origin allowlist and a rate limit. Without an allowlist the service refuses to start in
public mode, the same way `--auth none` refuses a public bind. This is an
interlock, not advice in the docs.

### Honest coverage limit

Link previews will work for roughly 70% of URLs. X, Instagram, LinkedIn, and many
news sites do not serve metadata to bots — bypassing that is what Microlink sells
a separate tier for.

Two requirements follow:

1. **Stated on the first screen of the docs**, not discovered in production.
2. **Failure must not break the paste.** With no metadata the block degrades to a
   plain link showing the domain, never an error state. `MetadataFetcher` currently
   throws; this needs fixing as part of the work.

---

## 3. Seams

A seam is an interface needed today that happens to have one implementation instead
of five. Reserved space for an interface with no implementations is not a seam — it
is a guess, and a guess belongs in prose, not in code.

### The ownership line

**The service may own what passes through it. It must not own the consumer's
records.**

- A **link preview** is pure passthrough. Nothing is stored at all.
- An **uploaded image** is a commodity blob: it joins to nothing, and teams already
  routinely hand these to S3, Cloudinary, or Uploadcare. The service accepts the
  bytes and writes them **where the consumer pointed it** — their directory, their
  bucket, their credentials. It processes; it does not own.
- A **document** is a business record. It joins to the consumer's users, teams, and
  permissions; it belongs in their backups; it must be searchable beside their other
  content and deletable on a data-removal request. Every one of those becomes a
  bridge to build if the record lives in our schema, which is why teams refuse to
  put their primary content in a third party's storage.

Therefore the service stores no documents. There are no `/documents/*` routes and no
bundled database.

### Seam 1 — BlobStore (files)

```
put(bytes, name, mimeType) -> url
delete(url)
```

Two drivers at launch: local directory (works immediately) and S3-compatible —
which covers S3, R2, MinIO, and Spaces, since the protocol is one.

The path-1 presets are **the same seam executed in the browser**: the Supabase
preset performs `put` and returns a `url`. There are not two parallel upload
systems, only one contract with implementations on either side of the network.
This is why "service for previews, own S3 for files" needs no bridging code.

### What remains of the save/load round-trip

The client half — and it is the half worth shipping: debounced autosave, load on
mount, and race handling between an in-flight save and a fresh edit. It points at
the consumer's endpoint instead of ours. Pure client-side work, no service involved.

The consumer writes the storage endpoint themselves. That is roughly ten lines, and
it is code they want to own regardless, because their permission check lives in it.

### DocumentStore is not a seam for this step

It is recorded here as a decision for when it arrives, not built now.

**When multiplayer lands, storage does become ours** — a sync server with nothing to
persist cannot merge two people's edits. At that point the store must hold **a blob
plus a tag naming its format**, never bare JSON. Multiplayer keeps a stream of small
binary updates rather than finished snapshots, so hard-coding "JSON lives in this
column" would force either a breaking migration or a second parallel table.

The write shapes genuinely differ, which is why multiplayer brings its own store
rather than inheriting one: today a write is "replace the document
wholesale" every few seconds; under multiplayer it is "append this small change",
tens of times per second, from several people at once. Saving each keystroke as a
whole-document replacement collapses on the first mid-sized document.

This section exists so that store is designed with the format tag from its first
line rather than discovering the need later.

### Deliberately absent

Document versions, document listing, and per-document ownership or sharing. Those
belong to the consumer's own user system. This step asks exactly one question: does
this pass permit uploading, or reading a preview?

## 4. Repository, build, release

### Location

`packages/server/`, in this monorepo, with its own `go.mod`.

One reason dominates: **the contract and the client half must change in a single
commit.** Add a field to the unfurl response and the same PR updates the client
parsing and the test that drives one through the other. Split across repositories,
a permanent desync window opens where the service already speaks a dialect the
editor does not.

To verify: `packages/*` is the yarn workspaces glob. A directory without a
`package.json` is skipped — and we need one there anyway for the npm wrapper, so
there should be no conflict. Must be checked against `yarn install --immutable`,
which CI treats as fatal (YN0028).

### Versioning

The service keeps the **family-wide lockstep version**. `scripts/release.mjs`
already rewrites the workspace manifests in one pass; the service joins that list.

This removes a whole class of support questions: "service 1.11 works with editor
1.11" needs no compatibility table, and a compatibility table would rot at our
team size.

The formal cost — a "new service version" containing no change on every editor
patch — is handled cheaply: **the version is always bumped, but the image is only
rebuilt when `packages/server/` changed.** Otherwise the new tag points at the
existing image, byte for byte.

### Release train

Separate from npm, because the artifacts differ in kind.

- `goreleaser` builds binaries for macOS/Linux/Windows plus the image.
- The image is published to **GHCR** — free for public packages and already tied
  to our GitHub identity, so no new registry account.
- `release.mjs` triggers this **after** the npm publish. The existing
  publish-before-push ordering is preserved.

### Running it without Docker

`npx` is the familiar entry point for our audience, and it has an honest cost.

esbuild distributes binaries as **one npm package per platform** — five or six
extra publishes per release, a real weight and extra failure points.

Cheap first version: **one package**, `@bloklabs/server`, which downloads the
right binary from the GitHub release on first run.

```
npx @bloklabs/server --auth none
```

Known limitation: corporate networks and `--ignore-scripts` may block the
download; the image remains for those. If that becomes a real problem, moving to
esbuild's scheme is a one-off change that breaks no consumer.

### CI

Adds a Go toolchain: build, `go vet`, tests. Plus a dedicated **security test
suite**, written before the implementation, whose cases are not invented:

- cloud metadata address in decimal form (`http://2852039166/`)
- the same in IPv6-mapped form (`http://[::ffff:169.254.169.254]/`)
- a hostname resolving to an internal address (`10.0.0.1.nip.io`)
- a redirect from an external site into a private range
- an address that changes between validation and connection (DNS rebinding)
- a 500 MB response body
- a host that never answers

Cases 1, 3, and 5 are the ones AutoGPT and MLflow shipped advisories for.

### Docs

`docs/` is canonical, README does not count. A new section is needed, and inside
it the **three paths become three separate pages**, not one page enumerating
flags. A reader should recognize their situation in a heading and not read the
other two thirds.

---

## 5. Risks and non-goals

### The risk the Go decision created

**We take on a service whose correctness governs other people's production
security, in a language nobody on this team writes daily.**

The choice is not reopened — its reasons stand. But the mitigation belongs in the
design, not in hope:

- **The service stays small.** Six routes, no business logic. Anything that can
  live outside it does. Small size is the only real compensation for an unfamiliar
  language.
- **We do not write the address filter ourselves.** `doyensec/safeurl` is used —
  a live library from a firm that audits security for a living. This is precisely
  where "write it ourselves" is unacceptable and "take someone else's" is correct.
- **The security test suite is written before the code.** It is the insurance: a
  filter bypass introduced by someone weak in Go hits a red test.
- **Vulnerability response is decided up front.** `SECURITY.md` with a response
  window. And note the emergency answer already exists and is instant: link
  previews are disabled by a config flag, no release required.

### Other risks

**The service is a new support axis.** Everything used to break in the browser.
Now there will be "won't start", "doesn't see the env var", "CORS", "we're behind
a corporate proxy". A different class of question, slower to answer, permanent.

**An extra service depresses adoption.** Some people, told to run a container,
will install nothing at all. This is a direct argument for **path 1 occupying the
first screen of the docs** and the service appearing second — otherwise we raise
the barrier to entry above where it is today.

**The 70% preview coverage will be the top complaint.** Mitigated by honesty in
the docs and by graceful degradation, not eliminated.

**Two access modes double the scenario matrix** in tests and support. Accepted
deliberately; e2e coverage for both is a real cost to budget.

**A package that downloads a binary trips corporate scanners.** Some companies
forbid it by policy. The image covers them, but the questions will come.

### Non-goals, stated explicitly

- **We host nothing.** Not free, not paid. It will be requested; that is a separate
  product decision with its own conversation about money, abuse, and obligations.
- **No service implementations in other languages.** The sidecar removed the need:
  not six SDKs, one container.
- **No document versions, listing, or per-document permissions.** Dropped, not
  deferred — see §Scope.
- **No multiplayer.** The seams exist; the feature does not.
- **No anti-bot circumvention.** Not our business and an endless arms race.
- **No image transforms, no CDN.** The temptation is real — "the files are already
  here, let's resize on the fly" — and it would sink a small service.
- **We do not replace S3 or Supabase.** Presets are a peer path, not a fallback.
- **We do not store the consumer's documents.** Not in SQLite, not anywhere. See the
  ownership line in §3.
- **No second outbound HTTP client.** Every server-side fetch of a consumer-supplied
  URL goes through the one guarded client, or it does not ship.

---

## Evidence

Gathered 2026-08-22. GitHub figures from the API on that date.

### Per-language SDKs: empirically the worst model

**Froala** — a commercial editor with funding — ships six official server SDKs
(PHP, Node, Java, .NET, Python, Ruby). All six were pushed within 25 minutes of
each other on 2026-08-19, and every commit is lockstep version automation
("Update to v5.4.0"). No substantive maintenance. One star each.

Open issues tell the real story:

| Repo | Issue | Opened | Comments |
|---|---|---|---|
| php-sdk | "Even examples shouldn't have massive security holes" | 2017-09-07 | 5 |
| node-sdk | "High level security vulnerability in dependent merge package" | 2021-05-10 | 0 |
| python-sdk | upload image cannot be loaded from passed link | 2021-04-21 | 0 |

The first is arbitrary file deletion via path traversal in a *documented example*,
open for nine years.

**SafeURL** — a controlled experiment in the same domain (SSRF protection):

| Implementation | Status | Stars |
|---|---|---|
| IncludeSecurity/safeurl-python | archived 2024-08-29 | 11 |
| IncludeSecurity/safeurl-php | archived 2024-08-29 | 4 |
| IncludeSecurity/safeurl-scala | archived 2024-08-29 | 1 |
| doyensec/safeurl (Go only) | alive, 2026-06-11 | 113 |
| slab/safeurl-elixir (one language) | 2025-01-15 | 73 |

The multi-language set was archived in one sweep with 16 stars between them;
focused single-language ones are alive with an order of magnitude more adoption.

### Why recipes cannot lean on per-language SSRF libraries

| Language | Library | State |
|---|---|---|
| Ruby | arkadiyt/ssrf_filter | alive, 124★ |
| Go | doyensec/safeurl | alive, 113★ |
| Elixir | slab/safeurl-elixir | quiet since 01.2025, 73★ |
| Node | azu/request-filtering-agent | alive, 26★ |
| **Python** | Advocate — archived 2023; safeurl-python — archived | none viable |
| **PHP** | wkcaj/safecurl — quiet since 2023 | none viable |
| C# | blowdart/idunno.Security.Ssrf | new, 20★ |

Python and PHP — the second and third most likely consumer backends — have nothing
maintained to delegate to. This is a primary reason the sidecar wins over recipes.

### Precedent for the chosen model

- **Uppy Companion** (Transloadit): one Node service solving the same
  fetch-arbitrary-URL problem, with SSRF protection built in and an allowlist;
  self-hosted, mountable as middleware, or hosted by Transloadit.
- **Tiptap**: Hocuspocus open-source self-hosted, plus paid cloud.
- **Iframely**: open-source core, paid cloud.
- **Stripe Smokescreen** (1329★, Go, alive): SSRF protection as an egress proxy —
  language-agnostic by construction.

### Multiplayer is not blocked by the Go choice

Per the official Yjs documentation, `reearth/ygo` and `Deln0r/ygo` are
production-ready pure-Go ports, wire-compatible with the JavaScript reference;
`Deln0r/ygo` ships a Hocuspocus-compatible single-binary server. Rust (`yrs`) and
WASM are listed as work in progress. Python's `ypy` is archived.

Note: Blok's document is already a `Y.Doc` internally
(`src/components/modules/yjs/`), but `ydoc` is private by design and writes pass a
`LocalOriginTag` type barrier. Exposing it for sync changes a load-bearing
invariant — multiplayer needs its own design pass.

---

## Resolved before planning

Both questions this design opened were answered empirically on 2026-08-22.

### 1. Does a Go workspace sit cleanly in the yarn graph? — Yes

Verified with a throwaway stub (`packages/server/` containing `package.json`,
`bin/blok-server.mjs`, `go.mod`, `cmd/blok-server/main.go`), then removed.

- `yarn workspaces list` picks it up as a normal workspace.
- `yarn install --immutable` fails with **YN0028** until the lockfile carries the
  workspace entry — an 8-line addition produced by `yarn install
  --mode=update-lockfile`, which `scripts/release.mjs` already runs. After that,
  `--immutable` passes. So: the lockfile change ships in the same commit, exactly as
  for any new workspace.
- `tsconfig.json` include is `**/*.ts|tsx|js|json` plus `vite.config*.mjs`. A
  `bin/*.mjs` wrapper is therefore outside the type-check, and `.go` files are
  invisible to both `tsc` and ESLint. ESLint on the stub wrapper was clean.
- Nothing auto-iterates workspaces: `scripts/build-all.mjs`, `.github/workflows/ci.yml`,
  and `release.mjs` all use explicit lists. Consequence: `packages/server` must be
  added to `WORKSPACE_MANIFESTS` in `release.mjs` and to CI deliberately — nothing
  will pick it up for us, and nothing will break if we forget.
- The install warnings observed (YN0060 eslint/eslint-plugin-import, YN0002
  `@vue/compiler-dom`, `playwright-core`) are pre-existing and unrelated.

### 2. Do already-saved failed bookmarks need a migration? — No

Read from `src/tools/link/bookmark/index.ts`:

- `save()` (`:94`) writes `url` plus whatever preview fields actually arrived. The
  `ERROR` state lives only in memory and never reaches the saved data.
- A bookmark whose fetch failed is therefore already stored as `{ url }` —
  indistinguishable from "a link with no preview".
- On load (`:44`) the block is treated as rendered and does **not** re-fetch;
  `startFetch` runs only on paste (`:81`).

So existing data falls into the new "URL only — render a plain link" path by itself.
The graceful-degradation work covers old blocks with no migration.
