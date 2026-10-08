# Page title server persistence (plan 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The collaboration server keeps the page title and icon. A host record's `title`/`icon` seed the room, survive a reset, and come back in every PUT to the host and every state or version read.

**Architecture:** Only the C# side changes. The JS server runtime (`src/view/server-runtime.ts`, bundled by `scripts/build-server-runtime.mjs`) does no Yjs work, so it needs nothing here. Plan 4 Task 10 handles its `readDocument`.
- `YDocConverter.Seed` writes the `page` map in the same transaction as the blocks.
- A new `YDocConverter.ExportPage` reads it back with the same rules as the client's `readPageFields` (`src/components/modules/yjs/page-fields.ts:11-33`).
- `CollabDocConverter.SeedAsync` / `ExportAsync` wire both in.
- The JS⇄C# fixtures gain page fields so both sides are pinned to one truth.

**Overview and decisions:** `2026-10-08-page-title-followups-overview.md` (D10, Defect 2).

**Order:** After plan 1b Task 1 (schema). Independent of plan 3.

## Changes from the design spec

- The spec named `Generated/blok-server-runtime.js` as a converter to change. It is not a converter. Its ops are HTML, Markdown, texts, schema and segments, and none of them touch Yjs (`server-runtime.ts:375+`).
- Version history already handles the `page` map:
  - diffs list page keys (`CollabVersionChanges.cs:150-170`);
  - restore patches `page` (`CollabRestorePlanner.cs:50-72`);
  - the version read adds a `page` object (`CollabRoomManager.cs:512-518`).
  
  Only seed and export are missing.

## Global Constraints

- `YDocConverter` and `CollabDocConverter` are `internal`. The PUT body gains `title`/`icon` keys, which is additive. The feature shipped after `v1.16.1`, so this is not BREAKING. A host storing the body as-is needs no change (`Blok.Server/Collab/DocEndpointClient.cs` handles bodies as `JsonNode` at `:32, :61, :152, :189`).
- Field rules must equal the client's (`page-fields.ts`):
  - a title is stored only when it is a non-empty string;
  - an icon only when it is `{type:'emoji', value:string}` or `{type:'image', url:string}`, with extra keys passed through;
  - `''`, `null` or a malformed value means "absent".
- Seed must leave the `values` map alone. History-tracked host values are not part of the record.
- `yBlocksMap` ordering and the undo scope are client concerns. The server must not create the `page` map with a different Yjs type than `Y.Map`.
- C# inner loop: `dotnet test packages/server/dotnet/Blok.Server.Tests --filter FullyQualifiedName~YDocConverter -p:SkipBlokServerRuntimeBuild=true`. The flag stops the build from bundling another session's uncommitted `src/` changes.
- JS: scoped `yarn test <file>`. The room-level suite runs with `node scripts/test-server-conformance.mjs --target csharp`.

## Review Focus

1. **Reset keeps the title, up to the last PUT.** `ResetJournalLocked` (`CollabRoom.cs:2109-2126`) calls `endpoint.LoadAsync` and reseeds from the host record. It takes no export first. So the title survives because `SeedAsync` reads it from the record, and the last PUT wrote it there. Edits newer than the last PUT are lost, the same as blocks.
2. **A title-only edit reaches the host.** Every member update calls `MarkDirtyLocked` (`CollabRoom.cs:2807, 3000`). Prove with a room test that the PUT carries the new title.
3. **Malformed icon in a host record is dropped, not refused.** The client stores any non-empty value and reads a bad one as absent (`page-fields.ts:11-42`). A thrown seed fails the whole join (`CollabRoom.cs:1975-1978`). Normalize before `Transact`, the way `Compose` runs before it (`YDocConverter.cs:156-157`). Throw only for structural errors.

## File Structure

| File | Change |
|---|---|
| `scripts/generate-collab-fixtures.mjs` | an optional `page` on each `CASES` entry (`:101+`); writes `page.json` + `page-canonical.json` |
| `test/unit/server-conformance/fixtures/collab/<new cases>/` | generated |
| `test/unit/server-conformance/collab-fixtures.freshness.test.ts`, `collab-fixtures-parser-parity.test.ts` | cover the page files |
| `packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs` | a new 4-argument `Seed` overload (the 2- and 3-argument ones at `:135`/`:146` stay as wrappers passing no page); `ExportPage(doc)` |
| `packages/server/dotnet/Blok.Server/Collab/CollabDocConverter.cs` | read `title`/`icon` in `SeedAsync` (`:30-48`); write them in `ExportAsync` (`:121-125`) |
| `packages/server/dotnet/Blok.Server.Tests/Collab/YDocConverterFixtures.cs`, `YDocConverterConformanceTests.cs` | load and assert the page fixtures |
| `packages/server/dotnet/Blok.Server/Collab/CollabRoomManager.cs:511-517` | version read: D10 |
| `packages/server/dotnet/Blok.Server.AspNetCore.Tests/Collab/HistoryEndpointTests.cs` | version read shape |
| `test/unit/server-conformance/server-contract.test.ts`, `doc-endpoint.ts` | room-level cases |
| `types/api/history.d.ts`, `packages/server/protocol/blok-sync-v2.md` §12.4 (`:945`, `:979`), server README, `docs/src/components/server/server-data.ts` | wording |

---

### Task 1: Page fields in the JS⇄C# fixtures

**Files:** `scripts/generate-collab-fixtures.mjs`, `test/unit/server-conformance/collab-fixtures.freshness.test.ts`, `collab-fixtures-parser-parity.test.ts`, new fixture directories.

- [ ] **Step 1: Failing test.** In `collab-fixtures.freshness.test.ts`, add the expectation that every case directory with a `page.json` also has a `page-canonical.json` equal to `readPageFields` applied after `store.pageFromJSON(page)`. Name the new cases in the test:
  - `page-title-emoji`
  - `page-title-image-icon`
  - `page-title-empty-string`
  - `page-title-null`
  - `page-title-non-string`
  - `page-icon-malformed`
  - `page-icon-extra-key`
- [ ] **Step 2: Run** `yarn test test/unit/server-conformance/collab-fixtures.freshness.test.ts`. Expect FAIL (no cases).
- [ ] **Step 3: Implement** in the generator. Cases are entries in the `CASES` array (`:101+`), not input files. For an entry with `page`, call `store.pageFromJSON(testCase.page)` after `fromJSON` (`:572`). Write `page.json` and `page-canonical.json` (from `readPageFields(store.page)`). Let the page map ride in `update.b64`.
  - That is safe: `toJSON` and the C# `Export` read only blocks and order roots, so existing pins, including the round-trip at `YDocConverterConformanceTests.cs:56`, are unaffected.
  - Add the seven entries. Run the generator (its header comment names the command).
- [ ] **Step 4: Run** both test files. Expect PASS.
- [ ] **Step 5: Commit** `test(collab): pin page title and icon in the JS and C# fixtures`.

### Task 2: C# seed and export of page fields

**Files:** `YDocConverter.cs` (`Seed`, around `:146-181`), `CollabDocConverter.cs`, `YDocConverterFixtures.cs` (loader around `:84-92`), `YDocConverterConformanceTests.cs`.

- [ ] **Step 1: Failing tests.**
  - Extend the fixture loader (`LoadFrom`, `YDocConverterFixtures.cs:79-91`) to read `page.json` and `page-canonical.json`, behind `File.Exists` guards like the ones for `canonical.segments.json`. C# already reads maps (`doc.GetMap`, `AnyObject`, `IsPlainMapValue`, `YDocConverter.cs:477-521`).
  - In `YDocConverterConformanceTests`:
    - (a) seed from `input.json` + `page.json`, then `ExportPage(doc)` equals `page-canonical.json`;
    - (b) decode `update.b64` and `ExportPage` equals `page-canonical.json`.
  - Add a hardening test: a seed onto a doc whose `page` map has a title, from input with no title, removes it (reseed is a replace).
  - Add a test that `values` keys survive the seed.
- [ ] **Step 2: Run** the inner-loop command. Expect FAIL (no `ExportPage`, `Seed` has no page argument).
- [ ] **Step 3: Implement.**
  - Add `Seed(YDoc doc, JsonArray blocks, RichTextInput input, JsonObject? page)`. Keep the existing overloads (`:135`, `:146`) as wrappers that pass `null`, so the 14 existing call sites, almost all tests, stay unchanged.
  - Normalize `page` before `doc.Transact`: keep a non-empty string title and a valid icon, and drop anything else. Inside the same transaction, set each valid key or delete it. With `null`, leave the page map alone.
  - `ExportPage(YDoc doc)` returns a `JsonObject` with only the valid keys.
  - Only `CollabDocConverter.SeedAsync` (`:47`) passes the page: `{ title: document["title"], icon: document["icon"] }`. `ExportAsync` adds them to its returned object (`:121-125`) only when present.
  - `CollabRoom.cs:1992, 2124, 2298` call `SeedAsync` through `ICollabDocConverter` (`ICollabDocConverter.cs:23`). They stay unchanged and get the title through it.
- [ ] **Step 4: Run** the inner loop (PASS), then the full `Blok.Server.Tests` project once.
- [ ] **Step 5: Commit** `feat(server): seed and export the page title and icon`.

### Task 3: Room-level behaviour against the real server

**Files:** `test/unit/server-conformance/server-contract.test.ts`, `doc-endpoint.ts` (only if the fake host cannot serve a `title` yet).

- [ ] **Step 1: Failing tests** (`--target csharp`):
  - (a) host record `{ title: 'Plan', icon: {type:'emoji', value:'🚀'}, blocks: [...] }` → a joining client sees both in its `page` map;
  - (b) a client changes only the title → the next PUT body has `title` equal to the new value;
  - (c) title edit → wait for the PUT to settle → room reset → after rejoin the title is still there;
  - (e) `GET /state` (`CollabRoom.cs:944`, through `ExportAsync`) carries `title`/`icon`;
  - (d) the client clears the title → the PUT body has no `title` key.
- [ ] **Step 2:** Write these tests and run them BEFORE Task 2 lands. Never revert or stash to watch them fail, because another session may share the tree. Run `node scripts/test-server-conformance.mjs --target csharp`, filtered by full test name (see the runner's usage text, `:39-52`). Expect (a)–(c) and (e) to fail. Then do Task 2.
- [ ] **Step 3:** Fix anything Task 2 missed. Expect PASS.
- [ ] **Step 4: Commit** `test(server): page title survives seed, edit, reset and clear`.

### Task 4: The dev seed carries titles

The playground's dev server seeds rooms through `playgroundSeedFor` (`scripts/dev.mjs:223-233`), which returns `{ blocks }` only for demo pages.

**Files:** `scripts/dev.mjs:223-234`, `test/unit/scripts/dev.test.ts` (around `:92`).

- [ ] **Step 1: Failing test.** `playgroundSeedFor(...)('page:<demo id>')` returns `title` and `icon` from `playground-pages.json`.
  - That file stores icons as bare strings (`"icon":"🚀"`). Map them to `{ type: 'emoji', value }`, because a bare string is malformed and would read as absent.
  - The root (`playground-document.json`, a bare block array) has no title of its own. Seed it with the playground's default root title `'Blok'` (`page-host.ts:37-41`). `scripts/dev.mjs` is plain `.mjs` and cannot import the `.ts` constant, so copy the value and add a test asserting the two are equal. Without this, a collab root page has no title, because plan 4 Task 6 seeds only pages the profile just created. A root the user renamed is local-only and is not seeded.
- [ ] **Step 2–4:** Run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(playground): the dev server seeds page titles`.

### Task 5: One place for the title in the version read (D10)

**Files:** `CollabRoomManager.cs:512-518`, `HistoryEndpointTests.cs`, `packages/server/protocol/blok-sync-v2.md` (§12.4, `:945`, `:979`), server README, `docs/src/components/server/server-data.ts`.

- [ ] **Step 1: Failing test** in `HistoryEndpointTests`: a version read returns top-level `title`/`icon` (from `ExportAsync`), and its `page` object carries no `title`/`icon` keys. `values` is unchanged.
- [ ] **Step 2: Run** `dotnet test packages/server/dotnet/Blok.Server.AspNetCore.Tests --filter FullyQualifiedName~HistoryEndpoint -p:SkipBlokServerRuntimeBuild=true`. Expect FAIL.
- [ ] **Step 3: Implement.** Skip `title`/`icon` when copying the `page` map in the loop at `:512-518`. If the `page` object is then empty, leave it out.
  - Then check the client consumers: `grep -rn "onRestored\|adoptRestoredTitle\|restored\.page" src index.html`. Today `history-drawer.ts:1337` forwards `restored.page`/`restored.values`, and `index.html:2474` adopts the title from `values`.
  - Nothing reads `page.title` at planning time. Plan 4 Task 5 deletes `adoptRestoredTitle`, because a restore now reaches Blok as a `remote` page-map change.
- [ ] **Step 4:** Update the protocol doc, README and `server-data.ts` (Prose rules: `docs/CLAUDE.md`). Run `node docs/scripts/update-lastmod-ledger.mjs`.
- [ ] **Step 5: Commit** `feat(server): version reads carry the title once, at the top level`.

### Task 6: Wording and final gate

- [ ] `types/api/history.d.ts:40-46`: keep the `values` loss note. Add that the page title and icon are saved by the server, unlike tracked values.
- [ ] `dotnet format --verify-no-changes` on the changed C# projects (CI runs it on the whole `.slnx`, `ci.yml:326`).
- [ ] Scoped lint and scoped tests. Run the full `Blok.Server.Tests` and `Blok.Server.AspNetCore.Tests` once.
- [ ] `git pull --ff-only`, `git push`, `git status` up to date.
