# Blok's server side as a .NET library — design

Status: **design approved in conversation 2026-08-23, not implemented.**
Supersedes part of `2026-08-22-backend-service-design.md` (see §Amendments).

---

## The goal

A consumer running a .NET stack (concretely: Dodo KnowledgeBase) adds a package from
their own NuGet feed, writes one line in `Startup`, and gets Blok's server side. They
write no document logic, no storage code, no conversion code, and no HTTP handlers.

The floor is not literal zero: they implement one authorization callback and supply one
connection string. Everything else is ours.

## Why this exists

KB carries **~3800 lines of C# that re-describe Blok's document model** — Markdown in
both directions, HTML import, text extraction for translation, block diffing, plus its
own copies of every Blok constant (block types, list styles, colours, alignments, quote
sizes, embed keys) and a test suite for all of it.

That code drifts by construction. Its own artefacts show it: the converter README
documents a "new flat list model" and a "legacy `items` model" side by side, and
`ContentJsonTextExtractor` carries a `// Support both legacy format (data.text) and new
nested format (data.items[].content)` branch. Every Blok release widens the gap silently.

Blok already holds this knowledge, written once, in TypeScript. The task is to let a
.NET consumer reach **that code**, not a retelling of it.

---

## The architecture

A single package family, deliberately **not** uniform inside. Three kinds of work live
in it and each has a different correct implementation.

```
Consumer's .NET application
│
└── Blok.AspNetCore            one line in Startup: DI + route mapping
     │                         routes live INSIDE their app, so their auth,
     │                         their antiforgery, their logging already cover them
     │
     ├── Blok.Documents        C# API: ToMarkdown / ToPlainText / FromMarkdown / ToHtml
     │    │
     │    └── IBlokRuntime     ← the boundary: JSON string in, JSON string out
     │         ├─ A: a JS engine embedded in .NET
     │         ├─ B: the same code packaged so any language can run it
     │         └─ C: an HTTP call to the container (always works, slowest)
     │
     └── Blok.Database         C#: schema, migrations, queries against THEIR database
          │
          └── IBlokAuthorization  ← the only interface the consumer implements
```

### What may go in, and what may not

| Kind of work | Where it lives | Why |
|---|---|---|
| Document rules (what a list is, how a callout becomes Markdown, what counts as text) | Our real TypeScript, run through `IBlokRuntime` | Re-writing them in C# is exactly the trap KB is in now |
| Talking to the consumer's database | Plain C# | No Blok knowledge is involved in running a query |
| Fetching consumer-supplied URLs (link previews, upload-by-URL) | **Not in the package. Stays the container.** | See below |

**Outbound fetching stays a container on purpose.** A link preview means something
fetches a URL a user pasted. Inside the consumer's own process, that makes their main
service the thing issuing requests to arbitrary addresses from inside their network,
with their credentials and their network position. A separate process with its own
network policy is *better* isolation, not a workaround.

So the split is: **the library is the safe half (document rules and the consumer's own
data); the container is the dangerous half (untrusted outbound traffic and file bytes).**

---

## The four load-bearing decisions

### 1. The boundary is a JSON string, one call, no object marshalling

Nothing crosses `IBlokRuntime` except text: "here is a document, give me Markdown".

This is what makes the runtime choice low-stakes. **The consumer codes against a C#
interface; what sits behind it is our implementation detail and is replaceable without
touching a line of their code.** If the embedded engine does not work, we swap in the
portable package; if that fails, we swap in an HTTP call to the container — slower, but
functional. The probe (below) therefore selects an implementation, it does not decide
whether the design lives.

Practical constraints on the boundary, to be settled when it is built:

- ASP.NET serves requests concurrently; a JS engine instance is single-threaded. A pool
  of pre-initialised instances is required. Parsing the bundle per request is not viable.
- `markdownToBlocks` is `async` and lazily `import()`s the math extensions. The bundle
  must expose a synchronous entry point with math inlined, or the boundary must carry a
  promise — decide when building, prefer the former.

### 2. Routes live inside the consumer's application — which dissolves the auth problem

An earlier design had the browser carry a signed pass to a separate service. With the
library that is unnecessary: the request already passed through the consumer's own
authentication. Passes, secrets, CORS, and a separate rate limiter all disappear from
this path.

Exactly one question remains that we cannot answer for them: *may this person read this
document?* That is their model — spaces, roles, countries, tenants. `IBlokAuthorization`
is that question and nothing else. It is the only code the consumer writes.

### 3. The meaning of a filter is defined once — in our code, not in SQL

Tempting error: since database access is C#, write "filter by status, sort by date" in
C# too. But what a filter *means*, how sorting treats empty values, and how positions
order rows are **Blok rules** — they already exist in the in-memory implementation in
TypeScript. A second copy in C# would drift like KB's converters do.

Therefore: our code interprets the view config and emits a **neutral query description**
(which fields, which comparisons, which order, which page). The C# half turns that
description into SQL. Meaning lives in one place; only the SQL dialect is C#.

### 4. The bundled JS ships inside the package; there is one version number

The package is built from this repository, in the same release, with our code embedded
as a resource. There is no "library version" separate from the Blok version. Nothing can
drift because there is no second copy.

---

## What this fixes that the service design could not

- **Translations stay whole.** Once database rows live outside the document, a consumer
  walking the document JSON stops seeing them — silently. In-process, the library can
  return the full text of an article *including* its rows in one call, so their
  translation pipeline never learns where rows live.
- **Deletion becomes solvable.** Rows live in the consumer's own database under a schema
  we ship, so cascade can be expressed in the database itself and fires on their ordinary
  article deletion, with no code on their side.

---

## Honest costs

- We publish and maintain a .NET package: released in lockstep with the npm package, CI
  on a stack this team does not write daily, and support questions in a language we do
  not use.
- **`Blok.Database` is real C# logic that we own** — schema, migrations, query building.
  The "no rules in C#" argument does not cover it, and should not be stretched to. It
  does not need to: that half has no TypeScript counterpart, so there is nothing for it
  to drift from.
- The named risk from the service design ("security-critical code in a language the team
  does not write daily") now applies to a second language — and the library, unlike the
  container, runs inside the consumer's process and holds credentials to the database
  where their business records live.

---

## Amendments to earlier decisions

`2026-08-22-backend-service-design.md` — **the ownership line is amended, not dropped.**
It said the service must never own the consumer's records. What it protected was that
records stay in the consumer's own store: their backups, their SQL, their deletion, their
search. That is preserved exactly — rows live in the consumer's database. What changes is
that the *code managing them* is ours, shipped as a library that runs inside their
process rather than as an endpoint they write.

`2026-08-22-database-block-architecture.md` — that document says the remote answer to
`queryRows` comes from the consumer's endpoint, "never from our Go service". Still true
about the Go service. It is now answered by our C# half running in-process instead of by
an endpoint they hand-write.

**Dead idea, so nobody builds on it:** the `Doc` claim in the access pass was going to
scope "may read these rows". Row access is in-process now. The pass survives for the
container paths (uploads, previews) only.

---

## Transition

Nothing is switched off at once. For every piece: run the library beside the existing C#,
**compare both over real articles**, then retire the old path.

### Stop doing now

- Do not write the table or gallery database views against the in-memory row array. They
  do not exist yet; writing them now guarantees rework once the query shape lands.
- Do not extend KB's C# converters with new features — they are scheduled to die.

### Order of work

**0. The probe.** Bundle the DOM-free published surfaces — `markdownToBlocks` (its async
and dynamic `import()` are the real unknown) and `/view`'s `blocksToHtml` /
`blocksToPlainText` — into one self-contained file and run it inside a minimal .NET host.
Hours of work. Selects what sits behind `IBlokRuntime`. **`blocksToMarkdown` is
deliberately excluded**: it calls `document.createElement`, so it would fail for a reason
that teaches nothing.

**1. Make our code fit, on two tracks that do not block each other.**
- A DOM-free rewrite of `blocksToMarkdown`, published under `/markdown`. Needed on
  *every* path including the container, so it is decidable now. `src/view/emitters.ts`
  is already DOM-free and was modelled on it — the traversal to copy exists in-repo.
- A **server entry bundle**: one file exposing exactly the boundary functions, string in,
  string out, no dynamic import, synchronous where possible. This is the real JS-side
  deliverable, not merely an added export.

**2. An empty package in their feed.** Publishing pipeline, feed access, signing, and
embedding the JS as a resource are their own unknowns on a stack we do not write daily.
Do not discover them while simultaneously proving the runtime boundary.

**3. Markdown → document.** The one piece that is ready today: published, DOM-free, and
shaped identically to `MarkdownToBlokConverter`. Replaces KB's MCP `preview_content` and
content-creation path. First real proof of the whole chain.

**4. Document → Markdown.** After step 1's rewrite. Agent-facing (`get_content`), so the
side-by-side comparison matters most here.

**5. Translatable text: extract and inject.** KB's `ContentJsonTextExtractor` is an
ordered extract/inject pair, not a plain-text renderer — `blocksToPlainText` cannot
substitute for it. This is **new Blok work**, and it is generally useful: any consumer
translating documents needs it.

**6. The container, in parallel with everything above.** It is built and **not released**;
nothing can be used until it is. Then: the upload-forwarding driver (hand bytes to the
consumer's existing upload endpoint instead of our own store — this is what makes
`/upload-by-url` useful to a consumer who already has a CDN), and editor wiring plan
tasks 1–4 as written. Task 5 (`persistence`) stays general Blok work; KB has its own save
path and does not need it.

**7. The database block, last.** The query-shape refactor in TypeScript
(`DatabaseModel` + four call sites in `src/tools/database/index.ts`), then the neutral
query description, then the C# half against the consumer's tables. `DatabaseAdapter`
currently exists as a **write mirror with no read path**; `queryRows` / `queryGroups`
are added to it when the refactor lands, and `Blok.Database` is what implements it.

### Explicitly not now

Relations and rollups across databases. They need an index spanning documents and arrive,
if ever, with their own design.

---

## Stays with the consumer, by design

- **The block differ** (`ContentJsonBlockDiffer`). It is KB's own translation algorithm
  built on top of the stable block-JSON shape — source hashes, reuse, rebuild — not a
  retelling of Blok rules. Blok is not growing a differ.
- **HTML → document** (`HtmlToBlokConverter`). Its only callers are four one-off legacy
  import jobs. It dies with them; growing a Blok counterpart would be wasted work.
