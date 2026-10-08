# 02 — Database block: architecture constraints for a Notion-parity roadmap

Repo: `/Users/jackuait/Packages/blok`, HEAD `665c077a`, last release tag **v1.16.1** (`git tag --sort=-v:refname | head -1`, tagged 2026-10-07).
Every claim cites a file:line or command. Anything not verified is labelled **unverified**.

---

## 0. Current shape, in one screen

- `DatabaseData` = `{ title?, schema: PropertyDefinition[], views: DatabaseViewConfig[], activeViewId }` (`src/tools/database/types.ts:91-96`). No rows.
- Rows are child blocks of type `database-row`, data `{ properties, position, title?, pageId? }` (`types.ts:39-53`; `src/tools/database-row/index.ts:7`).
- Property types: `title | text | number | select | multiSelect | date | checkbox | url | richText` (`types.ts:5`). Only `select`/`multiSelect` have config (`PropertyConfig = SelectPropertyConfig`, `types.ts:18`).
- View types declared: `board | table | gallery | list` (`types.ts:57`). Only **board** and **list** render (`index.ts:896-901`: `list` → list view, everything else → board).
- **Filters and sorts are stored but never applied.** `grep operator|direction src/tools/database/*.ts` (excluding types.ts) finds no filter/sort evaluation; the only ordering is by `position` (`database-model.ts:85-87`) and grouping (`database-model.ts:105-118`). They are only copied on duplicate (`index.ts:777-779`).
- `visibleProperties` is used by the list view only (`index.ts:941, 952`).

---

## 1. Collab / Yjs mapping

### How block data maps (generic rules, `src/components/modules/yjs/serializer.ts`)

| Rule | Where | Effect |
|---|---|---|
| Top-level keys `text, code, caption, title, alt, artist` → `Y.Text` (per-char merge) | `serializer.ts:42-45`, `mintDataValue` `:586-596` | Database `title` and row `title` merge per character. |
| Plain object → `Y.Map`, per-key | `plainToYValue` `:845-847`, `objectToYMap` `:611-622` | `properties` is a per-property-id map. |
| Array of objects with unique non-empty string `id` → keyed "identity" wrapper (`Y.Map` by id) | `isIdentityArray` `:673-713`, `plainToIdentityMap` `:879-886` | `schema`, `views`, `config.options` pair by id, so a reorder does not eat a concurrent rename. |
| Other non-empty arrays of objects → `Y.Array`, element-wise | `isConvertibleArray` `:652-656`, `:833-838` | — |
| Primitive arrays and empty arrays → **atomic leaf** (whole-value LWW) | `:639-656`, `:849` | `visibleProperties: string[]`, multiSelect values `string[]` are whole-value. |
| Nested keys `blocks, filters, sorts` → `Y.Array` from birth, even empty | `EAGER_ARRAY_KEYS` `:81`, `objectToYMap` `:616-619` | Two peers adding the first filter/sort both survive. Defers to the identity wrapper if elements carry ids (`:600-610`). |
| Write path: in-place deep assign per key; only changed leaves written | `document-store.ts:1662-1755` | Untouched sub-fields keep CRDT identity. |

### Per field

**Database block**
- `title` → `Y.Text`, per-character merge (`serializer.ts:42`). Pinned: `concurrent-database-loss.test.ts:594`.
- `schema` → identity map keyed by property id; each property a `Y.Map`; `name`, `type`, `position` are leaves (LWW per field); `config.options` → identity map by option id.
- `views` → identity map by view id; `name/type/position/groupBy` leaves; `filters`/`sorts` eager `Y.Array` (filter/sort objects have no `id`, so element-wise, positional); `visibleProperties` whole-value leaf.
- `activeViewId` → leaf in saved block data (`database-model.ts:220`, `index.ts:266-269`). Whether a tab switch writes it to the shared doc / flips peers is **unverified** (see §2).

**Row block**
- `title` (top-level) → `Y.Text`, merges. `properties[titlePropId]` is a mirror healed from it (`database-row/index.ts:107-120`; heal in `database/index.ts:357-366`).
- `properties` → `Y.Map` per property id; each value is a **leaf** (string, number, boolean, string[] all whole-value LWW). A `richText` value is an `OutputData` object → nested `Y.Map`/arrays.
- `position` → leaf (fractional index string). `pageId` → leaf.
- The comment at `serializer.ts:24-41` records why there is **no** nested per-character rule: a property value's meaning depends on the parent's `schema` type, so a per-char rule would invent values (`o2`+`o3`→`o23`) and the representation must be a race-free function of the key path alone, computable identically in `YDocConverter.cs`.

### Lockstep with C#
Every representation rule is mirrored in `packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs`: `DiffableTextKeys` (`:101`), `OrderedIdArrayKeys = ["blocks","filters","sorts"]` (`:124`), `IsIdentityArray` (referenced at `serializer.ts:692-696`), `DeepAssign.Map` (`document-store.ts:1657-1661`). Any new rule must change both sides, or "the same field is two different CRDT types and an edit to it is lost with no error" (`serializer.ts:694-696`).

### Existing concurrency tests (what they pin)
- `test/unit/tools/database/concurrent-database-loss.test.ts` (605 lines): both board columns / properties / views kept when added concurrently (`:96,117,170`); rename survives a concurrent reorder (`:132`); filter + sort on the same view both kept (`:186`); distinct fractional positions (`:161,203`); adapter does not push stale option arrays or update deleted rows (`:234,254`); rename survives deletion of another column/property (`:282,302`); concurrent board reorders keep every column (`:320`); row title per-char merge, mirror convergence, legacy rows without `title` not promoted (`:424-516`); value write survives a row move / a column delete (`:529,539`); orphan group still shown (`:550`); backend load racing a live edit (`:568`); database title bursts merge (`:594`).
- `concurrent-database-loss-wave2.test.ts`: an in-flight save keeps a peer's new column/view/row/value (`:96-173`); two peers' first filters/sorts both kept (`:205,225,252`).
- `concurrent-row-body.test.ts`: row bodies reopen when peers edit different rows before schema sync (`:289`); later edit stays on the existing body property (`:310`).
- C#: `Blok.Server.Tests/Collab/YDocConverterConcurrentLossTests.cs`, `YDocConverterDatabaseRowTitleTests.cs` exist (`grep -rli database packages --include=*.cs`); contents not read — **unverified** what they pin.

### Known whole-value (LWW) spots a roadmap must respect
- Two peers editing the **same** property value of the same row: last writer wins (leaf).
- `visibleProperties`, multiSelect value arrays: whole-value (primitive arrays).
- Filter/sort objects lack `id` → positional `Y.Array`; a reorder of filters is delete+insert (the problem the identity rule solves elsewhere, `serializer.ts:677-684`). Adding `id` to filters/sorts would switch them to the identity wrapper automatically (`objectToYMap` defers, `:600-610`), but only for newly born arrays — "there is no promotion, only a new birth shape" (`:689-691`).

### What a new nested field needs to merge safely
1. **Lists of entities must carry a unique string `id`** on every element (filter groups, property configs with option-like lists, rollup definitions) → identity wrapper, merge by id.
2. **Lists born empty that two peers grow** need eager `Y.Array` birth: either add the key to `EAGER_ARRAY_KEYS` (`serializer.ts:81`) **and** `OrderedIdArrayKeys` (`YDocConverter.cs:124`), or give elements ids. Note the eager set is key-name based and global across all tools' nested data.
3. **Prose that two people type** must be a top-level row/block key in `DIFFABLE_TEXT_KEYS` (precedent: row `title`, commit referenced in memory `50c9ab63`); nested text never merges per character.
4. **Primitive arrays are LWW** — if concurrent add/remove matters (e.g. person lists, file lists, relation id lists), store as objects with ids, not `string[]`.
5. Type-dependent representation is forbidden (`serializer.ts:31-41`): the representation must depend on the key path alone.
6. Old docs keep their old representation; changes are birth-shape only.

---

## 2. Undo / redo

- The database records history only through core: rows via `rowBlock.dispatchChange()` (`index.ts:368, 559, 582, 682`), schema via `this.block.dispatchChange()` (only one explicit call, `index.ts:1284`). Host-committed derived values use `dispatchChange({ derived: true })` so undo never strips them (`index.ts:658-659, 1713-1714`). Contract: `types/api/block.d.ts:154-168` (`derived` = saved, not an undo step; `from` joins a step).
- How schema/view changes other than `:1284` reach the saved document: **unverified**. The tool has no other `this.block.dispatchChange` call; the likely route is core's DOM MutationHandler seeing the re-render (hypothesis, not traced).
- **`DatabaseTool` has no `setData`** (`grep setData src/tools/database/index.ts` → none). So an undo, redo or peer change to the database block's own data takes core's recompose path: `data-persistence-manager.ts:168-208` returns false for non-text tools → `yjs-sync.ts:1305-1335` → `rematerialize` → `replaceBlock` (`yjs-sync.ts:1455-1480`). The whole database block is rebuilt. The agent-control plan flags whether recompose keeps rows attached as **unverified** (`docs/plans/2026-10-08-agent-control/01-core-commands.md:307`).
- `DatabaseRowTool.setData` takes undo/peer data in place (`database-row/index.ts:88-98`). The parent reprojects on `block changed` for its rows in a microtask, "inside the reconcile window; after it closes, this block's write-back would be a new undo step" (`database/index.ts:382-397`).
- `activeViewId` is saved block data. `switchView` (`index.ts:715-746`) calls no `dispatchChange`, so no explicit write path was found. The e2e audit spec asserts that **switching the view tab** changes the saved data and is undoable with redo available (`test/playwright/tests/undo-audit/w4-database.spec.ts:326` gesture C5, assertions `:355-373`, where `snap` = saved data + screen, `:124`). That spec was not run here, and memory says the w4 specs are skipped in CI, so whether it passes is **unverified**. If it does pass, the active view is a shared, undoable document edit for all collaborators. A per-user selected view would then change saved semantics; its cost depends on this answer.
- Other audited database gestures: add/rename/delete/drag board column, add/rename/delete/duplicate view, title typing (`w4-database.spec.ts` gesture list `:298-350`), card drawer redo and outer-doc leaks (`:172-272`).
- New features must: write through row blocks + `dispatchChange`; use `{derived:true}` for host/computed values (e.g. formula/rollup caches, created-time stamps); avoid write-backs after the reconcile window.

---

## 3. Backend

### `DatabaseAdapter` (`types.ts:117-170`, published `types/tools/database.d.ts:98-162`)
- A **write mirror, not a data source**. `loadDatabase()` returns `{schema, views}` and no rows (`types.ts:118-121`). The rest: `createRow/updateRow/moveRow/deleteRow`, `createProperty/updateProperty/deleteProperty`, `createView/updateView/deleteView`.
- `updateProperty.changes` is limited to `name | config` (`types.ts:149`); `updateView.changes` to `name|type|position|groupBy|sorts|filters|visibleProperties` (`types.ts:163-166`). New property/view fields need adapter signature changes.
- Loaded schema/views hydrate the model and overwrite memory (`index.ts:248-260`).

### `DatabaseBackendSync` (`src/tools/database/database-backend-sync.ts`)
- 500 ms debounce for row and property updates (`:3`, `:41-53`, `:136-146`). Row updates merge properties per key while pending (`:47`).
- Per-row write serialisation via `inFlightRowWrites` (`:216-235`); delete cancels pending writes and waits for in-flight ones so an upsert backend cannot resurrect a deleted row (`:96-113`).
- `syncUpdateProperty` drains a pending debounced update and merges `changes`, because `changes` carries whole arrays like the full option list (`:120-131`).
- Errors are swallowed into `onError` (`:21-28`); view switches rebuild the sync object after flushing (`index.ts:704-712, 731-733`).
- View create/update/delete are fire-and-forget, not debounced (`:154-164`).

### C# package (`packages/server/dotnet/`)
- Projects: `Blok.Server`, `Blok.Server.AspNetCore`, `Blok.Server.Host` + tests (`ls packages/server/dotnet`). **No `Blok.Server.AspNetCore.MySql`** — the planned database backend does not exist.
- C# models **no database operations**: grep for database in `.cs` hits only the CRDT converter, a doc comment, page-copy remap, and a handshake comment. Specifically:
  - `YDocConverter.cs` mirrors the CRDT rules above (`:101`, `:124`) and walks `database-row` nested documents in `properties.*.blocks` as plain JSON (`:3547-3560`, contract §8; client counterpart `src/shared/rich-text/block-data.ts:16,25,96`).
  - `IBlokDocumentConverter.cs:258-264`: page copy remaps `pageId` of `database-row` blocks; `GetPageIndexAsync` does **not** list `database-row` pages.
- No `rowPages`/`copyFromLegacy` implementation in `packages/` (`grep` only hits a built Angular bundle).

### Architecture doc `docs/plans/2026-08-22-database-block-architecture.md`
- Premise "Notion uses a database per collection" is false; a Notion database is a block with row-block children; their problem is volume (`:17-35`).
- **Three regimes** (`:84-95`):
  1. Rows in the document (today) — fine to low thousands, in-memory filter/sort.
  2. Rows behind a query — the view asks `queryRows`; memory answers today, the consumer's server later; views never know.
  3. Relations and rollups across databases — need a cross-document index; **explicitly out of scope**, a backend feature with its own future design.
- **Deferred decision** (`:97-133`): lay down the *query shape*, not storage:
  `queryRows({view, group?, cursor?, limit?}) → {rows, nextCursor?, total?}` and `queryGroups(view) → [{key, count}]`. Must-haves from line one: **per-group paging** (each board column pages separately) and **group counts without rows**.
- Sizing (`:142-155`): `DatabaseModel` gains query methods; ~4 call sites in `index.ts`; views unchanged (renderer contract already has `appendRow`). Table and gallery must be written against the query shape, not migrated.
- Status amendment (`:3-5`): remote source moved to Blok's C# package. The .NET design (`docs/plans/2026-08-23-blok-dotnet-library-design.md:233-300`) adds: TS stays the source of truth for filter/sort/group/position semantics (`:146`); a TS-built allowlisted query plan → parameterised MySQL in `Blok.Server.AspNetCore.MySql` (`:259-270`); `blok_`-prefixed tables keyed by document id + database-block id; and a required **core "externally-persisted child" contract** before remote rows: saver omits external children, mutations go through the source with optimistic versions, unloading never deletes server records (`:286-300`).
- Verified **not implemented**: `grep queryRows|queryGroups src types packages` → no hits. The all-rows-in-memory assumption still holds: `database-model.ts:21` (`private rows`), `index.ts:907, 933, 949, 1566`.

---

## 4. Row pages

- `DatabaseRowPages` (`types.ts:183-194`, published): `lookup`, `copyFromLegacy`, `reconcileLegacy`, `mount(pageId, holder) → {destroy}`. `DatabaseConfig = { adapter?, rowPages? }` (`types.ts:196-199`).
- Two body regimes:
  - **Legacy** (no `rowPages`, or row has no `pageId`): the body is an `OutputData` value stored in a `richText` property of the row (`index.ts:1271-1290`, created on demand as "Card details"). The card drawer lazily imports and boots a nested `Blok` over it (`database-card-drawer.ts:796+`), with `data-blok-mutation-free` on the holder (`:289`).
  - **Row page**: the row stores `pageId`; the drawer calls the host's `rowPages.mount(pageId, holder)` (`database-card-drawer.ts:769-776`). Migration copies the legacy body once (`index.ts:588-685`: lookup → `copyFromLegacy` with retry → receipt checks → `updatePageId` + `dispatchChange({derived:true})`).
- The row "opens" in a **side drawer** (`DatabaseCardDrawer`), not as navigation into a page.
- Relation to the `page` block (`src/tools/page`): **none in code** (`grep -i database src/tools/page/*.ts` → no hits). Both use the "body in another document, pointer `pageId`" pattern; `page` declares `acceptsChildren = false` (`page/index.ts:189-191`). The row page is host-provided, separate from the page platform's own host API.
- CLAUDE.md rule 5 says page body is child blocks via `contentIds`; the shipped row body is neither (nested OutputData or a separate doc). Memory `page-block-research.md:12` records the nested-blob body shipped in v1.15.2, so moving it is BREAKING unless read-compatible (background; matches `nestedDocumentsFor` still handling it, `block-data.ts:25`).
- Row tool keeps unknown top-level keys so a newer client's fields survive an older client's save (`database-row/index.ts:9-15, 70-75`). The **database** tool does not: `save()` returns `{...model.snapshot(), title, activeViewId}` (`index.ts:262-270`), and `snapshot()` returns only `schema, views, activeViewId` (`database-model.ts:216-222`). So **a new top-level `DatabaseData` key is dropped by every current (v1.16.1) client on save**, and a full save prunes keys it leaves out (`document-store.ts:1611-1640`). Nested unknown fields survive: properties and views are copied with object spread (`database-model.ts:29, 35`), so a new field *inside* a property or view object is kept by old clients. Design new database-level state as fields inside existing objects, or accept that old clients delete it.

### Old-client forward compatibility for new types (v1.16.1 behaviour)
- **New view type**: every type other than `list` renders as a board (`index.ts:896-901`). The view object itself survives old-client saves (spread copy, `database-model.ts:35`). A board view also requires `groupBy` to pass `validate` (`index.ts:276-278`) — whether a non-board new type passes validation on old clients: `validate` only checks `type === 'board'` views, so yes.
- **New property type**: the drawer renders `select`/`multiSelect` as pills and any other primitive value as plain text; an object or array value renders **nothing** (`database-card-drawer.ts:673-691`). The list view special-cases `select` and `checkbox` (`database-list-view.ts:287-301`); other types' fallback not read — **unverified**.
- The drawer renders non-title property values as static `<span>` text (`database-card-drawer.ts:669-691`). Inline editors for number/date/url/text values were not found in the files read; whether they exist elsewhere is **unverified**.

---

## 5. Public surface and BREAKING status

Last tag v1.16.1. `git log v1.16.1..HEAD --oneline -- <file>`:

| Surface | Changes since tag | Status |
|---|---|---|
| `types/tools/database.d.ts` (272 lines) | none | shipped → changes are BREAKING |
| `types/tools/database-row.d.ts` | none | shipped |
| `types/tools-entry.d.ts` (`Database`, `DatabaseRow`, data/config/adapter exports `:87-89,125,160,208-209,292-293`) | none | shipped |
| `types/index.d.ts:152-171` (PropertyType … DatabaseRowPages, DatabaseConfig) | not checked per-line; `DatabaseRowPages` first appeared in `762992c0`, contained in **v1.16.0** | shipped |
| `src/tools/database/types.ts`, `database-row/index.ts`, `database/index.ts` | only `11d78277`, `63468e13` (agent describe, sanitizer refactor) | saved-data shape shipped |
| `src/shared/tool-descriptions/database*.ts` | **added after tag** (`11d78277`, 2026-10-08), plus uncommitted WIP (`inputFields: ['title']`) | never shipped — free to change |
| `types/tools/tool-description.d.ts` | added after tag (`36fa93eb`) | never shipped |
| `src/view/document-schema.ts` → published `blokDocumentSchema` (`src/view/index.ts:24`) | database `$defs` **present at v1.16.1** (`git show v1.16.1:src/view/document-schema.ts`, lines 155-156, 302-402) | shipped |

Key consequences:
- **Published `blokDocumentSchema` is strict**: `additionalProperties: false` on `database`, on each view, property, option, filter, sort and on `database-row` (tag version `:302-306`, `:395-399`; current source `src/shared/tool-descriptions/database.ts:7,17,30,37,56,69,80`). The property `type` enum and view `type` enum are closed; `config` requires `options`. So **any new property type, property config, view field, or top-level database key makes new documents fail the schema consumers already have.** Adding fields is not "additive" for validators.
- **Drift found**: the published `DatabaseData` (`types/tools/database.d.ts:90-94`) has **no `title`**, while `src/tools/database/types.ts:92` and the document schema have it.
- Public class methods on `Database`: `addView`, `renameView`, `duplicateView`, `deleteView`, `reorderView`, `setReadOnly` etc. (`types/tools/database.d.ts` ~`:200-272`).
- **Data attributes**: 81 distinct `data-blok-database-*` strings in `src` (`grep -rhoE "data-blok-database[-a-z]*" src | sort -u | wc -l`). None are in `DATA_ATTR` (`grep -i database src/components/constants/data-attributes.ts` → none), so none are in the published `DataAttributes` type; they are raw strings in tool code. CLAUDE.md lists data attributes as breaking surface, so renames should be treated as BREAKING (judgement: they are consumer-styleable DOM hooks).
- **CSS variables**: 30 `--blok-database-*` tokens (list via grep), defined in `src/styles/colors.css`, used in `src/styles/database.css`, `src/styles/block-preview/database.css`, `database-board-view.ts`. Renaming/removing = BREAKING per CLAUDE.md.
- **Framework adapters**: no database-specific code in `packages/react`, `packages/vue`, `packages/angular`, `packages/server/src` (grep excluding dist/node_modules → none). They expose it as a generic block tool. Memory `tabs-block-levers` says tool statics auto-forward to adapters (background, not verified here).

---

## 6. Core levers

- **Container declarations: database and database-row declare none** of `childTools`, `acceptsChildren`, `ownsChildren` (`grep -rn -E "childTools|acceptsChildren|ownsChildren" src/tools/database src/tools/database-row` → none). Rows are found by filtering `child.name === 'database-row'` (`index.ts:349`) — the defensive pattern CLAUDE.md says `childTools` replaces. Caveat for a future fix: `childTools.allow = ['database-row']` would **demote** a disallowed insert to `allow[0]` (`CLAUDE.md:140`), turning e.g. an Enter-created paragraph into a row — needs care. Whether a foreign child can actually land under a database today is **unverified**.
- **Hard-coded self-placing parent**: `SELF_PLACING_PARENTS = new Set(['table','database'])` (`src/tools/nested-blocks.ts:110`), read by `registry-snapshot.ts:73` (agent manifest `selfPlacesChildren`), `turn-into-children.ts:48`, `home-slot.ts:56,83`, `hierarchy-invariant.ts:3`. Saver exempts `database` children from the DOM-order guard (`saver.ts:549`). A registered-under-another-name database loses these.
- **Keyboard owner**: used by the tab bar (`database-tab-bar.ts:105`) and its overflow dropdown (`:453`). Not on the card drawer or inline editors (grep). New grid/table cell editing should use `data-blok-keyboard-owner` (`DATA_ATTR.keyboardOwner`, `data-attributes.ts:399`).
- **Popovers**: `PopoverDesktop` from `src/components/utils/popover` for card menu (`index.ts:24`), tab bar (`database-tab-bar.ts:5`), view popover (`database-view-popover.ts:2`). The property-type popover is custom DOM with `anchored-position` (`database-property-type-popover.ts:13-17`) and its own outside-click listener (`:101-121`).
- **Tooltip law**: `src/components/utils/tooltip.ts` `HINT_DELAY=500`, `MIN_HINT_DELAY=300` (`:25-26`, clamp `:283`), enforced by `test/unit/architecture/hint-delay-law.test.ts` (per CLAUDE.md). The database uses no tooltips today (`grep tooltip src/tools/database` → none).
- **Reusable utilities** (verified exports):
  - Color picker: `createColorPicker` (`src/components/shared/color-picker.ts:188`); table cell variant (`src/tools/table/table-cell-color-picker.ts:25`).
  - Emoji picker: `EmojiPicker` (`src/tools/callout/emoji-picker/index.ts:163`), data in `src/components/utils/emoji/`.
  - Page picker: `PagePicker` (`src/tools/page/page-picker.ts:22`) — candidate for relation-style pickers.
  - Language-picker items builder for popovers (`src/tools/code/language-picker.ts:421`); cover picker (`src/tools/audio/cover-picker.ts:49`).
  - Uploads: `src/components/utils/asset-uploader.ts` (routing by asset kind), `fetch-uploader.ts`, `upload-xhr.ts`, `upload-error-message.ts`, `media-upload-error.ts` — for a Files property.
  - **No date picker / calendar** anywhere (`grep -rli "date ?picker|datepicker|calendar-grid|class .*Calendar" src` → none). Only `IconCalendar` exists. A Date property editor must be built.
  - **Person**: no people directory. Only `user.id` (`types/configs/blok-config.d.ts:1305-1320`) written as block `lastEditedBy`, and `lastEditedAt` (`types/data-formats/output-data.d.ts:100-107`). No `createdAt/createdBy`. "Last edited time/by" properties could read row-block metadata; a Person property needs a new host lever.

---

## 7. Agent / MCP tool descriptions

- `src/shared/tool-descriptions/database.ts` (`DATABASE_DATA`, `describeDatabase`) mirrors the saved shape exactly, with `additionalProperties: false` throughout, closed `type` enums for properties and views, and `config.required: ['options']` (`:5-94`). `guardedFields: { schema: 'database.*', views: 'database.*' }` and guidance pointing at `database.addRow` / `database.setRowValues` (`:96-103`).
- Those `database.*` actions are **not implemented**: no code hits for `database\.addRow|setRowValues` outside descriptions/locales; they are named in agent plans (`docs/plans/2026-10-08-agent-control/01-core-commands.md:291`).
- `src/shared/tool-descriptions/database-row.ts`: `properties` open (`additionalProperties: true`), `position`, `title`, `pageId` (`:3-21`).
- The same `data` objects feed the published `blokDocumentSchema` (`src/view/document-schema.ts:159-161`). So **every shape change must update `DATABASE_DATA`**, and that also changes the published JSON schema. The description files themselves are post-tag; the schema they feed is not.
- Test referencing them: `test/unit/shared/tool-descriptions/container-blocks.test.ts`.
- Uncommitted WIP from another session touches `database.ts` (`git diff`: adds `inputFields: ['title']`). Coordinate before editing.

---

## 8. Memory notes (background; cited items re-verified where marked)

- `database-block-query-shape.md`: same content as §3 doc. Re-verified: still not implemented.
- `blok-backend-service-direction.md:10`: "ONLY the database backend (MySQL, queryRows) from the .NET library design is not started." Re-verified: no MySql project, no `queryRows`.
- `page-block-research.md:12`: drawer body as OutputData blob in a richText prop shipped in v1.15.2; moving it is BREAKING unless read-compatible. `:20` suspected bug (body lost with default schema) — code now adds a richText "Card details" property on demand (`index.ts:1281-1285`), so likely addressed (**unverified** by test).
- `page-backend-readiness-fixes.md:18`: rowPages = host `lookup` + `reconcileLegacy`; never recopy; row tool keeps unknown keys; v1.15.2 clients still write via `adapter.updateRow`, so reconciliation is the real fix. Re-verified row tool unknown keys (`database-row/index.ts:9-15`).
- `collab-loss-audit-2026-09-21.md:17-19`: containers with stable identity must be diffed by identity — now the identity rule. `:67-69`: row title fixed by top-level key, additive mirror. Re-verified.
- `collab-loss-wave2-2026-09-21.md:21-24`: filters/sorts born `[]` lost the first concurrent element → now `EAGER_ARRAY_KEYS`. Re-verified (`serializer.ts:81`).
- `same-block-concurrency-verified.md:38`: same-row same-property edits are LWW. Consistent with leaf mapping.
- `undo-redo-audit-2026-09-23.md:23`: "database board not re-projected on undo/redo (CON-9/10/11)"; index says all pins fixed 2026-09-24. Current code has `handleBlockChanged` reprojection (`index.ts:382-397`), consistent with a fix.
- `undo-redo-audit-wave4-5.md:36`: card drawer close wrote the page body (killed redo); outer-doc paragraph leak — now pinned by W4D-1..3d (`w4-database.spec.ts:172-272`).
- `page-entry-points.md`: user model — never create an independent page; same-doc duplicate = same `pageId`. Relevant if rows become openable pages.
- `table-undo-setdata-ghost-duplicates.md:26`: database references children by `parentId` only (not ids in data), unlike table.

---

## 9. Checklist for any new database feature

1. Is it a block? Rows stay `database-row` children; properties stay in `data.properties`; never shadow the tree.
2. CRDT shape: id-bearing objects for lists; eager arrays for born-empty lists (both TS `EAGER_ARRAY_KEYS` and C# `OrderedIdArrayKeys`); top-level key for mergeable prose; no type-dependent representation. Add a concurrent-loss test pair (TS + `YDocConverter` tests).
3. Old clients: database tool `save()` drops unknown top-level keys (`database-model.ts:216-222`) but keeps unknown fields nested in property/view objects (`:29, 35`); row tool preserves unknown top-level keys. Old clients prune on full save.
4. Undo: go through `dispatchChange`; computed/host values `{derived:true}`. Database block has no `setData` → every peer/undo change rebuilds the block.
5. Adapter: new property/view fields need `DatabaseAdapter` signature changes (published → BREAKING unless optional additions; widening `changes` Pick is additive to callers but implementers' types change — judge per case).
6. Published JSON schema + `DATABASE_DATA`: strict, closed enums → update together; consumers validating with an older schema will reject new docs.
6b. Old clients: a new view type opens as a board; a new property type with an object/array value shows nothing in the drawer (`database-card-drawer.ts:673-691`).
7. Scale: new views (table, gallery, calendar, timeline) should consume a `queryRows`/`queryGroups` shape, not `getOrderedRows()`; filters/sorts need an evaluator first (none exists).
8. Relations/rollups across databases: out of scope per the architecture doc; need a cross-document index on the backend.
9. UI: `PopoverDesktop`, `data-blok-keyboard-owner`, tooltip delays, no blue selected states, existing color/emoji/page pickers; a date picker and person directory do not exist.
10. Public DOM hooks: 81 `data-blok-database-*` attributes and 30 `--blok-database-*` tokens are consumer-visible.
