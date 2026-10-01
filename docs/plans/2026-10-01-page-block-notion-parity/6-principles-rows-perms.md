# 6. Principles register, mechanism verdicts, database rows, permissions

Date: 2026-10-01. Read-only research. Nothing in the repo was changed.

Labels: **[verified]** = I read the source or ran the command this session. **[code-read]** = follows from source I read, but I did not run it. **[unverified]** / **[design]** = my proposal or an open question.

Short names for sources:
- `BSD` = `docs/plans/2026-08-22-backend-service-design.md`
- `DBA` = `docs/plans/2026-08-22-database-block-architecture.md`
- `NET` = `docs/plans/2026-08-23-blok-dotnet-library-design.md`
- `MPD` = `docs/plans/2026-08-31-multiplayer-design.md`
- `AOP` = `docs/plans/2026-09-01-acknowledged-operation-persistence-design.md`
- `PBR` = `docs/plans/2026-10-01-page-block-research.md`
- `CL` = `/Users/jackuait/Packages/blok/CLAUDE.md`
- `mem:<name>` = `~/.claude/projects/-Users-jackuait-Packages-blok/memory/<name>.md`
- `srv/` = `packages/server/dotnet/`

---

## 1. Principles register

### P1. The ownership line (exact wording)

- BSD:265-266: "**The service may own what passes through it. It must not own the consumer's records.**"
- BSD:273-277: a document "is a business record. It joins to the consumer's users, teams, and permissions; it belongs in their backups; it must be searchable beside their other content and deletable on a data-removal request."
- BSD:279-280: "the service stores no documents. There are no `/documents/*` routes and no bundled database."
- BSD:469-470: "We do not store the consumer's documents. Not in SQLite, not anywhere."
- BSD:41-44, 462-463: versions, listing and per-document permissions are "**dropped, not deferred**".
- BSD:327-329 "Deliberately absent": document versions, listing, per-document ownership or sharing. "Those belong to the consumer's own user system."
- mem:blok-backend-service-direction:39-44 repeats it and calls it "the load-bearing principle".
- MPD:56-58: listing, version history, sharing UI and comments-as-a-service are dropped. "the ownership line from the backend-service design stands."
- MPD:393: "The `doc` id is an opaque string we never interpret."
- AOP:6: "Consumer record ownership, authorization, listing, and sharing stay outside Blok."
- NET:312: "The package owns no roles, spaces, tenants, or countries. Those are consumer concepts."

**Exceptions written into the docs:**

1. **Multiplayer working set.**
   - BSD:46-49: "Multiplayer is the one case where we must persist documents … the consumer's endpoint can remain the system of record, with our storage acting as the sync working set."
   - BSD:310: "When multiplayer lands, storage does become ours". BSD:311 adds that it must be "a blob plus a tag naming its format, never bare JSON".
   - MPD:66: the "sidecar owns a working set in its own storage; consumer endpoint stays the JSON system of record".
   - MPD:304-306: "While a working-set blob exists, the blob is authoritative and out-of-band JSON edits are overwritten by the next export."
2. **Where the working set lives and how it is keyed.** [verified]
   - Keyed by SHA-256 of the doc id: `srv/Blok.Server/Collab/CollabDocKey.cs:7,20`.
   - Local directory or S3: `LocalCollabStore.cs`, `S3CollabStore.cs`.
   - The tag is `{format, epoch}` plus a lineage: MPD:250, mem:multiplayer-design:96-98, :176-179.
   - Files are mode 0600: mem:multiplayer-design:98.
   - The interface has only `ReadAsync`, `WriteAsync` and `ResetAsync` (`ICollabWorkingSetStore.cs:52,57,68`). There is no delete. See C5.
3. **Memory.**
   - One in-process `Doc` per open room (MPD:213-217).
   - A room is evicted `EvictionLinger` = 30 s after the last member leaves (`srv/Blok.Server/Collab/CollabRoomOptions.cs:12`).
   - JSON export runs on a 2 s debounce with a 10 s cap (`:6,:9`).
   - 30 s is a **floor, not a ceiling**:
     - A room whose persist failed is not evicted (mem:multiplayer-design:174-176).
     - A room whose projection is dirty is not evicted (AOP:519-521).
4. **Operation journal.**
   - AOP:6 supersedes only "the decision to drop operation history". It names a "consumer-supplied durable operation store" (BSD:9-12 amendment).
   - The seam is public: `ICollabOperationStore` (`srv/Blok.Server/Collab/ICollabOperationStore.cs:112`), registered with `UseCollabOperationStore<T>` (`srv/Blok.Server.AspNetCore/BlokServerBuilderExtensions.cs:50-58`).
   - The built-in `LocalCollabOperationStore` is `internal` (`LocalCollabOperationStore.cs:87`). It is wired only under `#if BLOK_SERVER_CONFORMANCE` (`BlokServerConformanceExtensions.cs:1,17-22`; `Blok.Server.Host/Program.cs:84-96`).
   - "a stock host negotiates blok-sync.v1 and journals nothing" (`BlokServerConformanceExtensions.cs:19-21`). [verified]
   - **Consequence:** only a .NET host that writes its own store gets a journal. The standalone binary and Docker image cannot get one.
5. **Awareness and presence.** "relay verbatim (never persisted, never decoded)" (MPD:215-216).
6. **Activity observer precedent.** `ICollabActivityObserver.cs:30-32`: "Blok stores none of this. The room reports and forgets; keeping it is the host's job". This is the house pattern for derived facts: emit them to the host, keep nothing.
7. **Uploads.** Bytes go "where the consumer pointed it — their directory, their bucket, their credentials. It processes; it does not own" (BSD:270-272).
8. **Browser storage.**
   - `collaboration.offline` is opt-in "because it writes document content to origin-scoped disk" (AOP:178-179).
   - It needs a host-supplied `offlineScope` (AOP:184-196).
   - The `indexedDBStorage` preset stores assets (`packages/presets/src/indexeddb.ts`).

### P2. No hosted service

- BSD:58: "No hosted service — cost, abuse, uptime obligations … privacy".
- BSD:458-459: "We host nothing. Not free, not paid."
- MPD:391: "No hosted sync service, free or paid."
- MPD:20: "Blok hosts nothing."

### P3. No per-language SDKs

- BSD:59: "Empirically the worst-performing model". The evidence is at BSD:480-495: Froala's six SDKs, and a path-traversal hole in a *documented example*.
- BSD:460-461: "not six SDKs, one container."
- MPD:394: "no per-language sync servers."
- mem:editor-server-wiring-status:50-52: "Backends that are not JS get the raw contract in the docs, never a second signer."
- NET:25: "one server implementation". The NuGet library and the standalone host are the same C# code. NuGet counts as a delivery form, not as a per-language SDK (NET:24-27).

### P4. Zero-dependency presets

- `docs/plans/2026-08-23-storage-presets-plan.md:7,15,1246`: "Zero runtime dependencies is a constraint, not a preference". Vendor clients are passed in, never imported.
- `packages/presets/package.json` has no `dependencies` and no `peerDependencies` [verified, via node].
- `scripts/release-manifest.mjs:49`: "No peerDependency on @bloklabs/core (zero runtime deps)".
- The presets today are five browser-side uploaders (`packages/presets/src/`). They contain no server code and no SQL [verified by ls/grep].
- Core also ships zero runtime deps (mem:editor-server-wiring-status:25-29).

### P5. Everything is a block (CL:91-117)

1. CL:97: "A database is a block."
2. CL:98: "A database row is a block … child of the database block (via `parentId`/`contentIds`)."
3. CL:99: "A page is a block with children. Any block with `contentIds` can act as a 'page.' Opening a database row means navigating into that block's children."
4. CL:100: "Properties are NOT blocks."
5. CL:101: "Page body IS blocks. Rich content inside a row/page is stored as child blocks via `contentIds`."

Corollaries:
- CL:114: "No internal data models that shadow the block tree."
- CL:115: "Use `parentId`/`contentIds` for containment. Don't reinvent hierarchy inside a tool's data blob."
- CL:116: "The Saver/Renderer pipeline handles serialization."
- CL:117: "Block operations … are the API."

### P6. Published-types law (CL:242-244)

- No file under `types/` may import from `src/`. Types are hand-authored.
- Mirrors of `src/` values must be generated and drift-tested.
- Enforced by `test/unit/architecture/published-types-no-src-refs.test.ts`.

### P7. Breaking-changes policy (CL:71-85)

- Breaking (CL:79) includes: renaming or removing a `types/` symbol or config key, "a field in a block's saved data", "changing a tool's saved JSON shape", and "anything a consumer's `tsc` or runtime would notice".
- A surface newer than the last tag is not breaking (CL:83).
- "If the break is avoidable, say so and offer the compatible route" (CL:85).
- Labelling: CL:75-77.

### P8. Declared container contracts (CL:138-141)

- `static childTools = { allow?, deny? }` and `data-blok-keyboard-owner` are the levers. The rule is to add the generic lever, not tool-side workarounds.
- The child-holder decoration law (CL:153) bans per-child wrappers.

### P9. Concepts are a cost

- BSD:21-26 weighs "Lines of code" and "Concepts" equally.
- mem:user-is-frontend-not-backend:13-24: plain language is "a DESIGN CONSTRAINT".

### P10. Scale-out shape

- "shard by doc id so one doc's clients land on one node; never fan a doc across nodes" (MPD:218-220).
- "one process per document is the standing scale-out rule" (AOP:446-447).

### P11. Revocation

- "Revocation is honestly 'takes effect on next reconnect'" (MPD:240).
- The ticket is verified once, at the handshake (mem:multiplayer-design:377-379).

---

## 1b. Contradictions and tensions between the docs

| # | Side A | Side B | Status |
|---|---|---|---|
| C1 | DBA:127-130: the remote `queryRows` comes from "the consumer's endpoint, or their BaaS via a preset — never from our Go service". DBA:155 says the same. | DBA:3-5 amendment: the remote source "is now implemented by Blok's C# package inside the consumer's application (or the same code in the standalone host), not by consumer-written endpoints". | **Open.** The amendment reverses the body, but the body was never edited. mem:database-block-query-shape:37-39 still states side A. |
| C2 | BSD:265-266 "must not own the consumer's records"; BSD:279 "no bundled database". | NET:275-277: "Blok owns tables with a `blok_` prefix inside the consumer's MySQL database … KB does not create or maintain them." | **Fits the spirit, breaks the letter.** The line's reasons hold: the data sits in the consumer's DB, so it is in their backups and queryable, and auth goes through `IBlokAuthorization` (NET:307). Deletion is solved by the document-table mapping plus cleanup (NET:316-326). But the word "owns" and Blok-managed migrations (NET:282-285) make Blok the schema owner of business records. Not implemented (NET:7). |
| C3 | MPD:392: "No document listing, history". BSD:462 says the same. | AOP:15-18: the journal "is the foundation for version history". | **Resolved on paper.** AOP:6 explicitly supersedes it. |
| C4 | MPD:20, MPD:66: the consumer endpoint "remains the system of record". | AOP:523: "the operation store remains authoritative". MPD:304: "the blob is authoritative". | **Tension.** Blok says the record is the consumer's, yet the server-side state wins. It is acceptable only because `ICollabOperationStore` is consumer-supplied, so it can live in their DB. The working-set blob, however, lives on the sidecar's disk or S3. |
| C5 | MPD:245: the store contract includes `delete(docId)`. BSD:276: a record must be "deletable on a data-removal request". | Shipped `ICollabWorkingSetStore` has only Read, Write and Reset (`ICollabWorkingSetStore.cs:52-68`). The only `File.Delete` calls in `LocalCollabStore.cs` (:231, :358) remove temp files. No delete route exists: the only route mapped in `BlokServerEndpointRouteBuilderExtensions.cs` is `MapGet("/sync/{doc}")` at :92, plus the edit and reset endpoints. [verified by grep] | **Real gap.** Document content can stay on the sidecar's disk or S3 indefinitely after the consumer deletes the record. Reset (`ResetEndpoint.cs`) re-seeds; it does not purge. This breaks one of the line's own reasons. |
| C6 | CL:99, CL:101 (row body = child blocks). `src/view/document-schema.ts:326`: "Rich page content lives in this block's children, not here." | The row body is an `OutputData` blob in a `richText` property (`src/tools/database/index.ts:1091,1154-1159`; drawer `database-card-drawer.ts:602-627`). It shipped in v1.15.2 (`7f372a16` is an ancestor [verified]). | **Open.** See Task 3. |
| C7 | CL:99: "A page is a block with children." | PBR §6.1 model B: the page body lives in another document; the pointer is a leaf. | Decision D1 (PBR:153). |

---

## 2. Verdicts on candidate mechanisms

A cross-cutting condition applies to (a), (b) and (c). Anything in the sidecar that spans two rooms only works while both rooms are on one node (P10). Under the documented scale-out, it needs a bus between nodes. That is new infrastructure, so these three are "single-node only" unless that bus is designed.

**(a) The sidecar keeps an operation journal for move sagas. Verdict: allowed with conditions.**
- The general op journal is allowed because it sits behind the consumer-supplied `ICollabOperationStore` (AOP:435, P1.4). The record then lives in the consumer's store.
- A saga log ("move X from A to B, step 2 of 3") is a cross-document record. Conditions:
  1. Write it through a consumer-supplied seam, as with `ICollabOperationStore`, not into the sidecar's own disk. Otherwise it is a new Blok-owned record.
  2. Keep it short-lived. Delete it on completion; it is not history.
  3. It is single-node only (P10, AOP:446).
  4. The standalone host cannot register a store (P1.4), so non-.NET consumers would get no saga safety. That is a gap between delivery forms.
- Cheaper route that needs no saga log:
  - The client drives copy-then-delete with stable operation IDs.
  - The op journal's exact-ID dedupe (AOP:74-76, :125-127) makes a retry safe wherever a store exists.
  - Where none exists, PBR:140 holds: "duplicate on failure, never a loss".

**(b) The sidecar keeps an in-memory index of which open rooms reference which pages, to relay title changes. Verdict: allowed with conditions.**
- In memory and derived from documents passing through, it fits "may own what passes through it" (BSD:265). The `ICollabActivityObserver` precedent is "reports and forgets" (`ICollabActivityObserver.cs:30`).
- Conditions:
  1. Never persisted. Rebuilt from open rooms. Dies on eviction.
  2. It breaks MPD:393 ("doc id is an opaque string we never interpret"). The sidecar would have to read `data.pageId` out of block maps. The server already reads block maps structurally (`YDocConverter`, edit API), so this is a deliberate amendment to MPD:393, not a free move.
  3. **Leak.** Relaying page A's title into room B shows it to B's members who may not read A. Each recipient needs a `CanReadDocumentAsync(user, A)` check (`IBlokAuthorization.cs:33-36`), or the relay is limited to readers of A.
  4. Single-node only (P10).
- Simpler alternative: the client asks `pages.resolve` (PBR:111) when it renders or focuses the page. The host answers from its own records.

**(c) The sidecar relays meta messages between rooms without persisting them. Verdict: allowed with conditions.**
- Same footing as awareness relay (MPD:215-216: "never persisted, never decoded").
- Conditions:
  - The same per-recipient read check as (b).
  - Single-node only.
  - New information goes in a **new message type**, never a new field on an existing frame (NEW-FRAME LAW, mem:multiplayer-design:380-387). Type 105 is reserved (MEMORY.md, collab-activity entry).

**(d) The client caches page docs in the end user's IndexedDB. Verdict: allowed with conditions.**
- This is the end user's device, not Blok's storage, and `collaboration.offline` already does it (AOP:178-196).
- Conditions:
  - Opt-in only, because it writes content to origin disk (AOP:178).
  - Scoped by `server URL + document id + offlineScope` (AOP:189), so one person's cache is not replayed under the next person's ticket.
  - Lineage-stamped (mem:multiplayer-design:399-411).
- Notion does the same with an LRU RecordCache (PBR report 2:280).

**(e) Blok derives a PageIndex payload (refs, text, title) and hands it to the consumer on save. Verdict: allowed.**
- Blok computes, the consumer stores. This is the observer pattern (`ICollabActivityObserver.cs:30`) and the same kind of thing as the planned server-side "translatable-text extraction" (NET:145).
- Conditions:
  - Additive and optional.
  - Hand-authored in `types/` (P6).
  - Derived, never authoritative.
  - It must stop at page boundaries (PBR:171).
- Under collaboration, the export PUT goes to `--doc-endpoint` (MPD:282-286). Adding a field to that body changes a consumer-facing contract, so make it additive. Better: ship a pure function the consumer can run on the `OutputData` they already receive.

**(f) A consumer batch endpoint for multi-doc atomic writes. Verdict: allowed (the consumer's code), with conditions.**
- The ownership line favours it: their records, their transaction.
- Conditions:
  - Optional. Blok falls back to copy-then-delete.
  - It works only on the `persistence` path. Under collaboration, writes go through per-doc rooms, and the sidecar has no cross-room transaction (P10).
  - It costs a new concept for frontend users (P9).

**(g) Blok ships SQL schema recipes in presets. Verdict: forbidden as package code; allowed as docs.**
- Presets are a zero-dep browser package of uploaders (P4). SQL is server-side, so it is not "presets" by function.
- A per-dialect recipe matrix repeats the per-language SDK failure (P3). The Froala hole was in a *documented example* (BSD:491-495).
- Allowed form: docs pages with one fenced, tested recipe per dialect, clearly marked as the consumer's code. Or, for .NET only, the planned `Blok.Server.AspNetCore.MySql` (NET:114).

**(h) `blok_` tables in the consumer DB, managed by the .NET library. Verdict: allowed with conditions. Contradiction C2 is open.**
- It meets the line's reasons: the data is in their DB and backups, auth goes through `IBlokAuthorization`, and deletion is mapped (NET:275-326).
- It breaks the letter ("owns tables").
- Conditions:
  - In-process NuGet only. The standalone host connecting to a consumer DB is the same code (NET:24), so it is allowed, but it makes the sidecar hold DB credentials.
  - Migrations are explicit, never silent (NET:282-285).
  - A cleanup mapping is mandatory, otherwise a data-removal request is not honoured.
  - Not started (NET:7; mem:blok-backend-service-direction:10).
- Before building, amend BSD:265 to say "may maintain a schema inside the consumer's database".

---

## 3. Database rows: a non-breaking path to "row = page document"

### 3.1 Facts

- Last tag: `v1.15.2` [verified: `git tag --sort=-v:refname | head -1`].
- `git log v1.15.2..HEAD -- src/tools/database` shows 13 unreleased commits, all fixes or refactors [verified]. Among them: `50c9ab63` (row `title` mirror), `043e7f2d` ("card page skips writing a page body that did not change") and `b48fe654` (refresh open card on undo or peer change).
- The body is stored at `properties[<first richText prop id>]`:
  - lookup: `index.ts:1091`;
  - written by `onDescriptionChange`: `index.ts:1154-1159`;
  - sent through `sync.syncUpdateRow`, so it reaches `DatabaseAdapter.updateRow` with a 500 ms debounce (`database-backend-sync.ts:36-44`).
- The drawer mounts `new Blok({...toolsConfig, holder, data, readOnly, onChange})` (`database-card-drawer.ts:602-627`). There is no collaboration or persistence config.
- The published `PropertyValue` includes `OutputData` (`types/tools/database.d.ts:32`). `DatabaseAdapter` is published (`:96`), and so is `adapter?` (`:163`).
- **How many consumers are exposed** [verified by grep]:
  - `richText` is not in the default schema (`database-model.ts:284-321`).
  - It is not offered in the property-type popover (`database-property-type-popover.ts:24-32`).
  - It is not mentioned in `docs/src`.
  - It appears only in `playground-document.json:892,1460` and tests.
  - So only consumers who wrote a `richText` property into their schema (in data or via `adapter.loadDatabase`) have blobs.
- **Possible data-loss bug** [code-read, not run]:
  - With the default schema, `descriptionPropId` is `undefined`. The drawer still mounts the body editor (`database-card-drawer.ts:204` → `:602`).
  - `onDescriptionChange` then does nothing (`index.ts:1155` guard).
  - So text typed into the card body appears to be discarded on close. This needs a failing test to confirm.
- **Old clients drop unknown keys** [verified by `git show v1.15.2:src/tools/database-row/index.ts`]:
  - The v1.15.2 `DatabaseRowTool` constructor keeps only `{properties, position}`, and `save()` returns only those two keys (lines 19-21, 33-37).
  - HEAD `snapshot()` keeps `properties`, `position` and `title` only (`src/tools/database-row/index.ts:52-62`).
  - So **any new row key, such as `pageId`, is erased when a v1.15.2 client (and also a HEAD client) saves that row**. That is certain for whole-JSON `persistence`. Whether the key is also deleted in a Yjs room depends on the serializer diff [unverified].
- `document-schema.ts` `database-row` has `additionalProperties: false` and lists `properties`, `position` and `title` (`:323-340`). A new key must be added there too.

### 3.2 Choosing the pointer

Recommendation: `data.pageId` (PBR D9). For migrated rows, set it to the row id at migration time.
- Several peers migrating the same row then converge on one page id.
- A duplicated or pasted row (new row id) still names a page.
- The host's `pages.create` must be idempotent by id (an upsert), or two concurrent migrations create two documents.

There is a fallback that needs no new key: derive the page id as `rowId` and never write it. This survives the key-erasure problem above, but breaks on duplicate or paste. It is acceptable only if duplicate deep-copies the body.

### 3.3 Phased migration [design]

**Phase 0. Make the code tolerant (ships first, no behaviour change, not breaking).**
1. `toRowData` and `snapshot()` preserve unknown top-level keys, or at least `pageId`. Today they drop them (see 3.1).
2. Add optional `pageId?: string` to `DatabaseRowData`, both in `src/tools/database/types.ts` and hand-authored in `types/tools/database.d.ts`. Add it to `document-schema.ts` `database-row`.
3. Add a body-source seam inside the drawer (`src/` only, internal): `{ read(row): OutputData | PageRef | undefined; write(rowId, body) }`. Today's implementation is the legacy blob.

Phase 0 must ship and reach consumers **before** any client writes `pageId`. Otherwise mixed fleets erase it. The wait is the consumer's to judge, so make the opt-in in Phase 1 explicit.

**Phase 1. Opt-in, read-compatible.**
- Opt-in lives in the database tool's own config, e.g. `Database` config `rowPages: true`, plus the editor-level `pages` contract (PBR §6.2).
  - A tool-config key is one additive edit.
  - A new `BlokConfig` key costs four edits: types, React `config-keys.ts`, Vue `config-keys.ts` and a Vue prop (mem:editor-server-wiring-status:17-22).
- Reading, in order:
  1. If `data.pageId` is set, mount the page document.
  2. Else, if `properties[richTextId]` looks like `OutputData` (has a `blocks` array), render it as today.
  3. Else, empty.
- Writing:
  - **Never on load or open.** The precedent is the row `title` mirror, which is "never rewritten on load" (`types.ts` `title` doc comment).
  - On the **first body edit** of an unmigrated row:
    1. Call `pages.create({ id: rowId, parentId: <database page id>, blocks: legacy.blocks })`.
    2. Await success.
    3. Set `data.pageId`.
    4. Only then stop writing the blob.
  - Order is create, confirm, switch. Never delete first (PBR:129).
- **Keep the old blob. Do not clear it.** Older clients and downgrades keep reading a stale but valid body, and nothing is lost.
- Optional dual-write window: a flag `rowPages: { mirrorBlob: true }` keeps writing the blob while the fleet is mixed. The consumer turns it off.
- Read-only viewers never migrate.

**Phase 2. Drawer mounts the page document.**
- If `pages.open` exists and a peek mode is supported, hand off with `pages.open(pageId, { mode: 'peek', source: 'database-row' })`. The host mounts its own editor with its own `persistence` or `collaboration` for `pageId`. This is the drawer's missing collaboration config (PBR:147).
- Otherwise, a nested `new Blok` whose load and save go to a host-supplied per-page config, e.g. `pages.editorConfig?(pageId)` [design, new surface].
- The title stays on the row (`data.title`, `properties[titleId]`) as the canonical value. This matches Notion: the row is the page record (PBR:35).

**DatabaseAdapter changes (additive only).**
- `createRow` and `updateRow` params gain optional `pageId?`. Adding an optional field to an argument object does not break implementers' `tsc`.
- No new required methods. An optional `onRowPageCreated?` is possible but not needed: `pages.create` already reaches the host.
- After migration, `updateRow` stops carrying the body for that row. Consumers who read the blob from their adapter DB would see it go stale. This is why the change is opt-in and must be stated in the release notes as a behaviour of the opt-in.

**Phase 3, optional and much later.** A one-shot bulk migration helper the consumer runs (for example on the server via the edit API). Removing the blob path is a separate BREAKING release with a `BREAKING CHANGE:` line (CL:77).

**Alternative to page documents (model A, the literal law 5).** Migrate the blob into child blocks of the row (`parentId = rowId`).
- Needs: `childTools` on `database-row`, the board hiding children, and the drawer rendering the row subtree.
- It keeps one document, but every row body loads with the database. That is the all-rows-in-memory risk (DBA:63-76), multiplied.
- The `externally-persisted-child` contract (NET:293-301) would then be required.

### 3.4 Breaking-change assessment

| Step | Breaking? |
|---|---|
| Phase 0 | No. Additive optional key; tolerant readers. |
| Phase 1-2 behind opt-in | No. The default path is byte-identical. |
| Making it the default | Yes ("changing a default", CL:79). It needs a label, or must stay opt-in. |
| Clearing old blobs | Yes. |

---

## 4. Permissions: Notion feel, consumer ownership

**What exists** [verified]:
- `IBlokAuthorization` (`srv/Blok.Server.AspNetCore/IBlokAuthorization.cs:20-54`) has two members:
  - `CanReadDocumentAsync(ClaimsPrincipal user, string documentId, CancellationToken)` (:33-36). False closes the sync upgrade "as forbidden"; an edit or reset answers 403.
  - `CanWriteDocumentAsync(...)` (:50-53). False admits the caller read-only.
- Both only **narrow** what the transport granted (:15-17).
- It is called at `SyncHandshake.cs:196-208`, `EditEndpoint.cs:51` and `ResetEndpoint.cs:41`.
- Forbidden is close code 4403 (`SyncClose.cs:50-51`). The client maps it to the published terminal reason `'forbidden'` (`src/components/modules/collaboration/provider.ts:133`; `types/events/editor-events.ts:116,132`).
- Tickets are per document: `?doc=` (`src/components/utils/access-pass.ts:14-20`). Claims are `user`/`doc`/`write`/`exp` (mem:editor-server-wiring-status:44).
- The interface predates v1.15.2 (`git log v1.15.2 -- …/IBlokAuthorization.cs` shows `00097151`, `b537fb2e`) and is unchanged since. **Changing its members is BREAKING for C# implementers.**

**Notion behaviour to imitate** (report 1):
- Sub-pages inherit from the parent, with per-page overrides (1-notion-ux.md:162-164).
- A mention without access shows "Untitled" (:56).
- Backlinks to private pages are labelled Private (:115).
- Effective permission is computed by walking ancestors (2-notion-backend.md:316-318).

**What Blok can do:**

1. **A "no access" pointer state** [design, allowed].
   - `pages.resolve(pageId)` may return `{ access: 'none' }`, distinct from `null` (missing page, PBR:141).
   - The page block then renders a neutral, gray "No access" state (no blue, per CL "No blue selected states"). Click does nothing, or calls `open` and lets the host decide.
   - When a mounted page editor gets the `'forbidden'` terminal reason, the host can show the same state. The plumbing already exists.
   - For `persistence.load`, whether a 403 reaches the host as a distinct error is [unverified].
2. **The cached title leaks** (ties to D2, PBR:154-158).
   - There is no per-block read filter: one document syncs whole (PBR:54; report 4:16).
   - A title cached on the pointer in the parent document is readable by everyone who can read the parent, even if the child page is restricted.
   - Model B cannot give Notion's "Untitled/Private" with a cached title. Choose one:
     - (i) No cached title for restricted children: write an empty title and fetch it via `resolve` on render.
     - (ii) The consumer accepts the leak, and the docs say so.
3. **Passing parentPageId to the auth hook.** Not as a client-supplied value.
   - Anything the browser sends is untrusted, so it cannot decide authorization: a client could name any parent.
   - The trustworthy sources are the consumer's own page tree (their records) or their mint endpoint (they mint the ticket).
   - Blok gains nothing by threading a parent id through. The consumer's `CanReadDocumentAsync(user, pageId)` already has the page id and can walk its own tree.
   - If a server-side hint is ever wanted, add it as a **default interface member** or a new optional interface. Adding an abstract member breaks every implementer. Whether default interface members fit this package's analyzers is [unverified, not built].
4. **An inheritance recipe.** Not in presets: presets run in the browser, and a permission check must run on the server (P4, and (g)).
   - **Docs recipe:** "effective access = nearest explicit grant walking `parentId` up", with "broadest grant wins" (1-notion-ux.md:163). One tested SQL example per dialect, marked as the consumer's code.
   - **Optional .NET helper:** e.g. an `InheritedAuthorization` that composes consumer-supplied lookups such as `Func<pageId, parentId?>` and `Func<user, pageId, Grant?>`. It owns no roles (NET:312). Non-.NET consumers get the docs only (P3).
5. **Revocation gap.**
   - Access is checked once, at the handshake (P11).
   - Changing a parent's sharing does not drop members already connected to open child rooms until they reconnect.
   - I found no kick or disconnect API: the only routes are `/sync/{doc}`, edit and reset [verified by grep of `Map*` calls].
   - A "re-check members of doc X" endpoint (the consumer calls it after a permission change) would close the gap. It stays inside the line, because Blok re-asks `IBlokAuthorization` and stores nothing [design].

---

## 5. Open items for the user

- C1 and C2: edit DBA's body or the ownership wording so the docs agree.
- C5: working-set purge. A delete route or store method, and a retention statement in the docs.
- Confirm or refute the default-schema body loss (3.1) with a failing test.
- Phase 0 (key-preserving row tool) must be released before any client writes `pageId`.
- D2 title placement decides whether Notion-style "No access" is possible without a leak.
