# Blok server as a .NET library and host

Status: **implementation started.** The embedded-runtime probe passed on
2026-08-24: Jint 4.16.1 loaded the real self-contained bundle and passed Markdown
(including math), HTML, plain-text, 64-call concurrency, and cancellation-recovery tests.
The runtime choice is now Jint; ClearScript remains only a fallback if a later Blok
feature exceeds Jint's compatibility.

This document supersedes the Go implementation decision in
`2026-08-22-backend-service-design.md`. The existing HTTP contracts and security
invariants remain. The Go code is now a temporary reference implementation used only
while the C# replacement is proved.

---

## Goal

A .NET consumer such as Dodo KnowledgeBase installs a NuGet package and runs Blok's
server code inside its existing application. It does not write routes, document
converters, database queries, schema migrations, or storage logic for the database
block.

The same C# implementation also ships as a standalone executable and Docker image for
consumers that do not run .NET. There is one server implementation, not a C# library
beside a permanent Go service.

The unavoidable consumer-specific inputs are configuration, not a second backend:

- a database connection string;
- a small authorization implementation that answers whether the current user may read
  or change a document;
- optional mapping to the consumer's document table when Blok should clean up database
  rows after document deletion.

## One implementation, two delivery forms

```text
                              Blok's TypeScript rules
                         (embedded, self-contained bundle)
                                        │
                                        ▼
                              Blok.Server (C# core)
                         documents · databases · uploads
                         unfurl · tickets · wire contracts
                              │                     │
                 ┌────────────┘                     └────────────┐
                 ▼                                               ▼
       Blok.Server.AspNetCore                           Blok.Server.Host
       NuGet in an existing app                        standalone ASP.NET app
       existing auth and logging                       config from flags and env
                 │                                               │
                 ▼                                               ▼
       Dodo KnowledgeBase                         Docker / self-contained binaries
                                                  / @bloklabs/server npm wrapper
```

Both forms call the same feature classes and map the same handlers. The standalone host
contains startup and configuration only. It must not fork business logic from the
NuGet path.

### .NET consumer

The intended KB integration is ordinary ASP.NET registration:

```csharp
builder.Services
    .AddBlokServer()
    .UseMySql(connectionString)
    .UseAuthorization<KnowledgeBaseBlokAuthorization>();

app.MapBlokServer("/api/blok");
```

This registration shape is the public design contract: one server builder, one MySQL
provider call, one authorization implementation, and one route mapping. Names may be
polished without adding another integration concept. KB does not implement a
`DatabaseAdapter`, controller, query builder, migration, or Blok document converter.

The first database provider is MySQL because KB uses MySQL. We do not design a provider
matrix before a second consumer asks for one.

### Non-.NET consumer

The standalone host keeps the current product surface:

```text
docker run bloklabs/server ...
# or
npx @bloklabs/server ...
```

The image name, CLI name, route paths, request bodies, response bodies, flags, and
environment variables remain compatible with the existing Go implementation wherever
the Go implementation already defines them. The npm package changes only which binary
it downloads.

The standalone executable is published with `dotnet publish` as self-contained
platform artifacts. NativeAOT is not a goal: the embedded JavaScript runtime and server
libraries must not be distorted merely to reduce binary size.

---

## Package boundaries

Start with the smallest package family that expresses the real boundaries:

| Project | Responsibility |
|---|---|
| `Blok.Server` | Feature services, wire contracts, document runtime boundary, upload and database abstractions |
| `Blok.Server.AspNetCore` | DI registration, endpoints, authentication hooks, limits, CORS, health checks |
| `Blok.Server.AspNetCore.MySql` | MySQL schema, migrations, row queries, group counts, and document cleanup; depends on the two packages above |
| `Blok.Server.Host` | Standalone process: reads config and composes the same packages |

KB installs `Blok.Server.AspNetCore.MySql` as its one direct package; NuGet brings the
lower layers transitively. Splitting more projects before a real dependency boundary
appears is out of scope.

All projects initially target `net10.0`: KB already runs .NET 10, the standalone host is
self-contained, and speculative multi-targeting adds a test matrix without helping the
first consumer.

---

## What belongs in C# and what stays TypeScript

The server moves to C#. Blok's document semantics do not.

### C# owns server concerns

- ASP.NET routes and dependency injection;
- access checks and ticket verification;
- rate limits, CORS, size limits, redirects, and timeouts;
- guarded outbound HTTP;
- local, S3, and MySQL persistence;
- schema migrations and SQL generation;
- standalone host configuration and health reporting.

### TypeScript remains the source of truth for Blok semantics

- Markdown conversion;
- HTML and plain-text rendering;
- translatable-text extraction and reinsertion;
- database filter, sort, grouping, and position semantics;
- validation and normalization of block-shaped data.

These rules are bundled once from this repository and embedded as a resource in the
NuGet package. They are not transcribed into C#. The same embedded resource is used by
the standalone host, so the two delivery forms cannot drift.

The bundle resolves package exports under the `worker` condition. Vite's default client
conditions select browser implementations, and `decode-named-character-reference`
creates a DOM element at module load. The worker condition selects its pure implementation
and is pinned by loading the built resource in the .NET test suite. Do not replace it
with the default Vite condition set or a DOM shim.

### Runtime boundary

Pure document operations cross the runtime boundary as JSON strings:

```text
operation name + JSON input → JSON or text output
```

C# does not mirror every Blok data type. It validates the outer request and lets the
Blok runtime own the document shape.

Server-backed database documents need one extension to the pure boundary: C# loads
external row blocks page by page and passes them back to the runtime as block-shaped
JSON. The runtime decides how those blocks participate in Markdown, plain text, and
translation. C# never learns which fields inside a block are meaningful text.

### Runtime selection

The first probe uses Jint because it is managed, ships cleanly inside a NuGet package,
and avoids per-platform native assets. It must execute the self-contained bundle and
pass the same fixtures as the browser implementation, including math, nested blocks,
and concurrent calls.

If Jint fails compatibility or the concurrency/latency gate, the implementation uses
ClearScript V8 behind the same internal interface. We do not introduce a Node service
as a third permanent implementation. The probe selects the JavaScript engine, not the
architecture.

ASP.NET handles requests concurrently while one JavaScript engine is single-threaded.
The package therefore owns a bounded pool of pre-initialized runtimes. It never parses
the bundle for every request, and request cancellation must release a rented runtime.

---

## Outbound fetching and process isolation

Moving from Go to C# does not mean link previews should automatically run inside the
consumer's main process.

`/unfurl` and `/upload-by-url` fetch addresses supplied by users. The same C# feature is
available in both delivery forms, but the recommended production layout is:

- run document and database features in-process through NuGet;
- run untrusted outbound fetching in `Blok.Server.Host`, with its own network policy;
- allow in-process outbound fetching only as an explicit opt-in.

The process boundary, container network, and egress policy provide isolation. Go itself
never did.

### Safe outbound HTTP invariant

Every consumer-supplied URL must pass through one C# guarded client. Automatic redirects
are disabled. For every initial URL and every redirect, the client:

1. accepts only HTTP or HTTPS, without embedded credentials;
2. checks the allowed port;
3. resolves the host;
4. rejects loopback, private, link-local, multicast, unspecified, documentation, and
   cloud-metadata destinations for IPv4 and IPv6;
5. connects to the exact validated address rather than resolving the hostname again;
6. preserves the original hostname for HTTP `Host` and TLS SNI;
7. enforces redirect, response-size, and time limits while streaming;
8. refuses non-success responses before unfurling or storing bytes.

In .NET this is implemented below `HttpClient` with a guarded
`SocketsHttpHandler.ConnectCallback` and manual redirect handling. Code outside that
component must not construct a client for consumer-supplied URLs. A static architecture
test enforces the rule.

The C# port cannot replace Go until black-box tests prove these properties, including
DNS rebinding and redirect-to-private-address cases.

---

## Database block backend

### The block law remains

A database is a block. A row is a `database-row` block. Properties are metadata on the
row block. Server storage changes where row blocks are persisted and queried; it does
not create a parallel entity model.

For small documents, rows continue to live in the document and the in-memory source
answers every query. For large databases, rows are loaded as block-shaped records from
the server.

### Query shape

The TypeScript refactor from
`2026-08-22-database-block-architecture.md` remains the first database task:

```ts
queryRows({ view, group?, cursor?, limit? })
queryGroups(view)
```

Per-group cursors and group counts remain mandatory. Table and gallery views must be
written against this shape rather than the current all-rows array.

### Query semantics and SQL

The embedded Blok runtime converts a view config into a small allowlisted query plan:

```text
filters + sorts + group + cursor + limit
```

The plan contains operators and typed values, never raw SQL, table names, or arbitrary
column names. `Blok.Server.AspNetCore.MySql` translates that plan into parameterized SQL and always
adds the document id and database-block id itself. A client cannot remove those scope
predicates.

This keeps filter and sorting meaning in TypeScript while leaving SQL and storage in C#.

### Storage

Blok owns tables with a `blok_` prefix inside the consumer's MySQL database. Rows are
keyed by both document id and database-block id. The schema and its migrations ship in
`Blok.Server.AspNetCore.MySql`; KB does not create or maintain them.

The first provider is allowed to be MySQL-specific. We do not create a generic relational
query layer until another provider is real.

Migrations are applied under a database lock by an explicit deployment command from the
same package. An opt-in apply-on-start mode is permitted for development. Production
startup checks the schema version and fails with an actionable message rather than
silently mutating the database from every replica.

### Saving and partial materialization

The current editor assumes every child block belongs in one complete document snapshot.
Server-backed databases break that assumption: a visible page of rows is only a partial
materialization, and saving it must not overwrite the rows that were not loaded.

Before remote rows are enabled, core gains a generic externally-persisted-child contract:

- queried rows are real `database-row` blocks with the database block as parent;
- loaded rows participate in rendering, selection, and block APIs normally;
- the document saver omits externally persisted children from the snapshot;
- row mutations go through the database source and use optimistic versions;
- unloading a page removes only its local materialization, never the server record.

This is a core lever, not database-tool defensive code. Without it, `queryRows` alone
would make large databases appear to work while the next article save could destroy
unloaded data.

### Authorization

Every database read and write is scoped to a document id and calls the consumer's
`IBlokAuthorization` implementation. In the NuGet form it receives the current
`ClaimsPrincipal`; in the standalone form the same request identity comes from proxy or
ticket authentication.

The package owns no roles, spaces, tenants, or countries. Those are consumer concepts.

### Document deletion

A foreign-key cascade only handles hard deletion. KB uses soft deletion
(`kb_articles.Deleted = true`), so the old design's claim that cascade solves cleanup was
wrong.

`Blok.Server.AspNetCore.MySql` accepts a document-table mapping: table name, id column, and optional
soft-delete column. It uses that mapping for two built-in mechanisms:

- a hard foreign key when the database permits it;
- a scheduled, provider-owned cleanup query that removes Blok rows whose document is
  absent or soft-deleted.

Access is denied immediately by `IBlokAuthorization`; physical cleanup may be eventual.
KB supplies identifiers as configuration and writes no deletion handler. Identifiers are
validated and quoted by the provider, never interpolated from a request.

---

## Document services

KB currently carries thousands of lines that re-describe Blok. The package replaces the
parts that are Blok semantics, not KB business logic.

### Supplied by Blok

- Markdown → blocks;
- blocks → Markdown, after the existing renderer becomes DOM-free;
- blocks → HTML and plain text;
- extraction of translatable slots and reinsertion of translated values.

Translation slots use stable block id + field path identities rather than a bare ordered
string list. This continues to work when database rows are loaded from server storage.

### Stays in KB

- `ContentJsonBlockDiffer`: source hashes, reuse, and rebuilding translated articles are
  KB's translation policy, not Blok semantics;
- `HtmlToBlokConverter`: its current callers are one-off legacy import jobs, so growing a
  new public Blok surface for them would be wasted work.

Each replacement is introduced beside the existing C# converter, compared over real
article fixtures, and switched only after the outputs and documented degradations are
accepted.

---

## Existing Go implementation: migration oracle, then deletion

The Go service is not a second product and receives no new features. Until removal, only
security and correctness fixes are allowed.

### What it contributes to the move

- exact wire responses for `/health`, `/unfurl`, `/upload`, and `/upload-by-url`;
- CLI and environment-variable behavior;
- auth, origin, and rate-limit ordering;
- ticket behavior;
- local-directory and S3 storage behavior;
- a mature regression suite for outbound-fetch attacks and size limits.

### How parity is proved

Move route-level behavior into a language-independent black-box conformance suite. The
suite starts a server binary or targets a supplied URL, then runs the same cases against
Go and C#.

The suite covers success and failure responses, headers, preflights, auth modes, rate
limits, upload limits, redirect limits, unsafe addresses, DNS rebinding, malformed
tickets, storage key validation, and shutdown behavior. C# also keeps focused unit tests;
the black-box suite is the cross-language acceptance gate.

### Removal gate

Go is deleted only after all of the following are true:

1. the C# unit and integration tests pass;
2. the black-box suite passes against both implementations;
3. the C# host passes Docker and self-contained-binary smoke tests on supported
   platforms;
4. a packed NuGet package works in a minimal .NET application and in a .NET 10 fixture
   shaped like KB;
5. the npm wrapper downloads and runs the C# artifact;
6. an independent security review accepts the guarded outbound client;
7. no public release points at the Go assets.

Then remove the Go sources, modules, Go CI setup, goreleaser configuration, and Go build
artifacts in the same change. `packages/server` remains the product directory and becomes
the C# source, host, npm wrapper, and Docker build context.

Because the Go server has not been released, this transition should happen before its
first public release. We preserve its contract because the editor wiring and tests already
depend on that contract, not because users need a language migration.

---

## What changes in the existing plans and code

| Existing asset | Decision |
|---|---|
| `packages/server` Go code | Frozen, used for parity, then deleted |
| `packages/server/package.json` and `bin/blok-server.mjs` | Kept; wrapper downloads the C# host artifact |
| `packages/server/Dockerfile` | Replaced by a .NET multi-stage build using the same image name |
| Go blob stores | Ported once to C#; interfaces and behaviors stay |
| Go fetch guard | Replaced by the guarded C# client only after adversarial parity |
| Go ticket and middleware | Ported to ASP.NET authentication/endpoints with the same wire behavior |
| `packages/presets` | Unchanged; browser storage remains a peer path |
| editor `server`/ticket wiring plan | Wire contract stays; it targets the C# host or in-process routes |
| bookmark degradation | Already implemented in `f8083d54` |
| editor persistence option | Remains general Blok work; KB keeps its article save path |
| `src/markdown` | `blocksToMarkdown` becomes DOM-free and public |
| new embedded runtime bundle | Built as one self-contained resource for the NuGet package; not initially a public npm subpath |
| `src/tools/database` | Gains query-shaped reads and externally persisted child blocks before server storage is enabled |
| release pipeline | Builds NuGet packages, self-contained host artifacts, Docker image, and existing npm wrapper from one version |
| docs site | Documents NuGet integration, standalone deployment, module selection, and database storage |

`2026-08-23-editor-server-wiring-plan.md` tasks 1–3 remain relevant to standalone
host access. Ticket minting is unnecessary when routes run inside an already-authorized
ASP.NET application. Its persistence task is independent of this server transition.

---

## Delivery sequence

Each phase leaves one implementation path, not a permanent bridge.

### 1. Prove the embedded runtime

Build one self-contained bundle from the existing DOM-free Markdown import and view
surfaces. Run it in Jint inside a minimal .NET 10 test app. Add concurrent-call and
cancellation tests. If Jint fails the fixed gate, repeat behind ClearScript without
changing the public C# API.

### 2. Make document code server-safe

Rewrite `blocksToMarkdown` without DOM APIs, expose the document operations through the
embedded bundle, and add drift tests so the resource packed into NuGet cannot lag behind
TypeScript source.

### 3. Freeze and extract the Go contract

Create the black-box conformance suite from the Go route tests. No feature work starts in
C# until the success, failure, and security behavior to preserve is executable outside
Go.

### 4. Build the C# package and host

Port health, tickets, middleware, unfurl, uploads, local storage, and S3 in small TDD
slices. The NuGet path and host path must exercise the same handlers in every integration
test.

### 5. Replace delivery artifacts

Pack NuGet, publish self-contained host binaries, rebuild the Docker image, and point
`@bloklabs/server` at the C# assets. Run the removal gate, then delete Go before the first
server release.

### 6. Adopt document services in KB

Run old and new converters side by side over real fixtures. Switch Markdown import,
Markdown export, plain text, then translation slots. Leave the KB-specific differ and
legacy import jobs alone.

### 7. Add the database backend

Refactor the editor to query rows, add the external-child persistence contract, build the
MySQL provider and cleanup, then connect KB with configuration plus authorization only.
Table and gallery views are written against the query source from their first commit.

Relations and rollups remain a separate later design because they require an index across
documents.

---

## Non-goals

- Keeping Go as an alternative implementation.
- Rewriting Blok document rules in C#.
- A hosted Blok cloud service.
- A database provider matrix before MySQL works for KB.
- NativeAOT as a release requirement.
- Relations, rollups, or multiplayer in this transition.
- Moving KB's business authorization or translation policy into Blok.
