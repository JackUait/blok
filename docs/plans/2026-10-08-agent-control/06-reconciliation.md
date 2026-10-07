# 06 — Reconciliation of specs 01–05

Date: 2026-10-08. Repo state: `fb62db72`. Last release tag: `v1.16.1`.

**Round 2 (same day).** The user decided D1, D2, D3 and D5 (section 5). D1 overrides C1: the C# Jint path is in v1. Section 7 designs it. Section 8 resolves every "Issues with 06" item from the revised specs. Section 9 lists what each spec must change now. Where a round-2 section disagrees with an earlier one, round 2 wins. A later message decided D4 and D6 too. Section 10 designs the two features D6 kept (page title/icon, agent caret for peers). C14's agent-caret line and C15 are superseded by section 10.

**Round 3 (final, same day).** Section 12 fixes one rule per remaining conflict and closes every "Issues with 06" item. The canonical contract in section 3 is updated in place to match. Section 3 is the single source; where an older section disagrees, section 3 and section 12 win.

This file settles every place where specs 01–05 disagree. It answers every open question. It fixes one shared contract. Specs 01–05 will be revised to match section 3.

Labels:

- **Verified**: read in this session, cited `path:line`.
- **Unverified**: not checked. Must get a test before anyone relies on it.

---

## 1. Conflicts

### C1. Where headless execution runs (01 vs 04, 05)

- **01** runs headless in the server's Jint runtime. It adds an `agentExecute` op and a pure `JsonApplier` over `OutputData` (01 §3.1, §5.1). For live rooms it leans to extending the C# `/edit` route with `move` and `setRichText` (01 Q1 option a).
- **04** runs headless in Node over the real `DocumentStore` and `createCollabProvider` (04 §3.1). It says Jint is unsuitable. Its blocking Q1 asks: DocumentStore or plain JSON?
- **05** assumes three runtimes, including a Jint edit op (05 §3.2.1, A-04 "Stored-doc edit").

Facts checked:

- The Jint bundle holds no Y.Doc. Its ops are whole-document conversions only (`src/view/server-runtime.ts:377-483`). Verified.
- The C# edit wire has `Insert`, `Update`, `Remove`. It has no move (`packages/server/dotnet/Blok.Server/Collab/CollabEditOps.cs:31-41`). Verified.
- 01's premise that `Update` overwrites a peer's typing is wrong. `ReplaceData` edits a live `YXmlText` in place and deep-assigns other containers (`YDocConverter.cs:1124-1185`). Only the doc comment at `CollabEditOps.cs:37` still says "last writer wins". Verified.
- `DocumentStore` runs without an editor or DOM. `downloadOfflinePage` builds one (`src/components/modules/collaboration/headless-offline-page.ts:31`). A Node test drives the real provider over the real store (`test/unit/server-conformance/blok-client-contract.test.ts:1`, `:14`, `:25`). Verified.
- `DocumentStore` has the write primitives an applier needs: `addBlockAt` (`document-store.ts:681`), `removeBlock` (`:722`), `replaceBlockContent` (`:751`), `moveBlockTo` (`:824`), `updateBlockData` (`:1363`, which diffs rich text in place, around `:1464-1470`), `updateBlockTune` (`:2216`), `updateBlockMetadata` (`:2244`). Verified.
- `onUpdate` skips remote updates (`document-store.ts:2399-2415`). So a write tap on it sends only the agent's own work. Verified.
- 01's reason for not writing the Y.Doc directly is about the **browser editor**: an unknown origin maps to `'remote'` (`src/components/modules/yjs/block-observer.ts:193-195`, `yjs/types.ts:65-80`). In Node there is no editor and no `BlockYjsSync`, so that reason does not apply there. Verified.
- `OutputData` has no page title or icon field (grep of `types/data-formats/output-data.d.ts`). Page fields live only in the Yjs `page` map (`document-store.ts:227`, `yjs/index.ts:955-960`). Verified.

**Resolution.**

- One pure planner in `src/shared/agent/`, as 01 designs it. It returns `Edit[]`.
- Three appliers implement `Edit[]`:
  - `EditorApplier` (browser, through BlockManager). Unchanged from 01.
  - `JsonApplier` (pure, over `OutputData`). Used for the dry run and for **stored** documents.
  - `StoreApplier` (new, over a `DocumentStore`). Used for **live rooms** from Node. It writes with origin `'local'` inside `DocumentStore.transact`.
- ~~v1 runs headless only in Node; Jint deferred.~~ **Superseded by D1 (DECIDED): Node and C# Jint both ship in v1.** Section 7 is the Jint design. The planner must stay pure and Jint-safe.
- No change to the public C# `/edit` wire in v1. Live rooms are reached by a Node socket member (04) and, after D1, by the C# room path with internal ops only (section 7.4).
- Stored mode uses `JsonApplier`, not a socketless `DocumentStore`. Reason: the dry-run output already is the result, and a Y.Doc adds nothing for a document with no peers. (Round 3: the old reason "the saved format has no page fields" is stale; section 10.1 adds `OutputData.page`, which `JsonApplier` writes directly.)
- Parity (05) runs the appliers: `EditorApplier` (jsdom/browser), `JsonApplier` (Node and Jint), `StoreApplier`, and the C# `RoomEditTranslator` (section 7).

**Reason.** Node reuses the exact Yjs code browsers run. Moves keep their Yjs identity. 01's `Edit` list maps onto `DocumentStore` methods, though not one-to-one (R2-01-1), so 01's planner survives intact.

### C2. LLM tool set vs MCP tool set (03 vs 04, 05)

- **03**: three tools, `blok_read`, `blok_apply`, `blok_describe`. Default schema mode `'envelope'`.
- **04**: six tools, `blok_list_documents`, `blok_open`, `blok_read`, `blok_capabilities`, `blok_execute`, `blok_close`. `blok_execute` carries a full `oneOf` per command.
- **05** wants one manifest rendered twice with no drift.

**Resolution.**

- Three **core tools**, identical on both surfaces: `blok_read`, `blok_describe`, `blok_execute`.
  - `blok_apply` is renamed `blok_execute`, to match 01's `execute` entry.
  - `blok_capabilities` is renamed `blok_describe`. It takes `{ tool?, command? }`. With no args it returns the index.
- MCP adds three **lifecycle tools**: `blok_list_documents`, `blok_open`, `blok_close`. MCP core tools add one property, `handle`.
- One pure renderer, `renderAgentTools`, in `src/agent/render-tools.ts` (section 3.7). 03 uses it. 04 bundles it at build time from source, like `src/cli/`. So no new core subpath is needed.
- Both surfaces use the **same schema mode**. Default `'envelope'`; `'full'` is an option. 05's eval (03-Q12, 04-Q15) picks the shipped default before release.

**Reason.** One renderer cannot drift from itself. Same names make 05's parity test a straight compare, with only `handle` added on MCP.

### C3. Attribution and origin (01 vs 03 vs 04)

- **01**: an acting-author scope in BlockManager; `lastEditedBy` = actor id. Undo steps carry `{ actor, sessionId }`. No new `BlockOrigin`.
- **03**: actor travels as turn context beside a `'local'` transaction. Events gain `detail.agent`. Opt-out `attributeTo: 'user'`.
- **04**: the agent is its own room actor. Ticket `user` = agent actor id. New awareness field `agent: { kind, onBehalfOf }`.

Facts checked:

- `lastEditedBy` is stamped inside a write callback from `config.user.id` (`src/components/modules/blockManager/blockManager.ts:2689-2693`). That callback can run after an await. Verified.
- The event detail object is built at emit time (`blockManager.ts:2118-2130`). An actor stamped there survives later batched delivery. Verified.
- `trackedOrigins` is `{'local'}` (`undo-history.ts:393`). Unknown origins read as `'remote'` (`block-observer.ts:193-195`). Verified. 01 and 03 already agree: no new origin.

**Resolution.**

- One actor type, `AgentActor` (section 3.5). 03's `AgentIdentity` becomes an alias of it.
- Browser: attribution is **per touched block**, not a global flag. The applier holds a set of block ids the batch touched until its undo group closes. A write to one of those ids stamps `actor.id`. Any other block keeps the human's id. Events built for those ids carry `detail.agent`.
- Node: `StoreApplier` stamps through `DocumentStore.updateBlockMetadata` (`document-store.ts:2244`). `JsonApplier` writes the `OutputData` fields `lastEditedAt`/`lastEditedBy` directly. (Round-2 citation fix, R2-01-3.)
- Rooms:
  - MCP agent: ticket `user` = `actor.id`. They must be equal. The journal and frame 107 then name the agent.
  - In-app agent in a room: it rides the human's socket. So the journal names the human, while `lastEditedBy` names the agent. This split is accepted and documented.
- 05's `attributed` grader reads saved `lastEditedBy` on touched blocks. That works in every runtime.
- Test required: the user types in another block during the apply window, and that block keeps the human's id.

**Reason.** The stamp can run after an await, so a global flag would mislabel the human's typing. Ids are known per batch, so a per-block set is exact.

### C4. Does a field write count as coverage? (02 vs 05)

- **02** routes most UI items as "field": one saved field, written through generic update, checked by schema (02 §2.6, §3.4).
- **05** (Q13) says generic `blocks.update` must not count for features with their own UI. It allows it only when the whole effect is one data field.

**Resolution.** They agree in substance. 02's §3.4 rule is the test. 05's ledger gets a fourth coverage kind, `{ field: '<registryKey>.<field>' }`. The law checks that the field exists in the tool's manifest `data` schema and is not in `viewState` or `guardedFields`. `{ command: 'block.update' }` is not a valid ledger entry. Anything 02 routes as `tool.action` must map to that action.

**Reason.** A field write is safe when the schema checks it and no invariant spans fields. That is exactly 02's rule, and the law can check it mechanically.

### C5. Command naming and tool-action syntax (01 vs 02 vs 05)

- **01**: core names `block.insert`, `text.format`; tool actions through one generic command `tool.action { id, action, params }`.
- **02**: actions are top-level commands `<registryKey>.<action>`, some with no target (`create`). It also writes `columns.*`, but the registry key is `column_list` (`src/tools/index.ts:99`). Verified.
- **05**: examples use `blocks.insert`, `table.addRow`, `columns.wrap`.

**Resolution.**

- Core namespaces: `doc.`, `block.`, `text.`, `markdown.`, `history.`. Singular `block`.
- A tool action is a top-level command `<registryKey>.<action>`. The generic `tool.action` command is dropped.
- Args are flat. A `target: 'block'` action takes `id`. A `target: 'create'` action takes `parentId?` and `position?`. Action arg schemas may not declare `id`, `parentId` or `position` themselves.
- Reserved registry keys: `doc`, `block`, `text`, `markdown`, `history`. A tool registered under one gets no exposed actions. Its manifest entry says why.
- 02's `columns.*` becomes `column_list.*`. 05's examples are rewritten to real names.

**Reason.** Flat names read naturally to a model and match 02's manifest. A reserved-namespace check is cheap. The registry key is what a block's `type` carries, so names follow the host's own keys.

### C6. Tool action handler shape (01 vs 02)

- **01**: pure `(ctx, params) => Edit[] | ToolActionError`.
- **02**: imperative `ctx.update/insert/move/remove/fail`, may return a Promise, gets `services`.

**Resolution.** 02's ergonomic ctx, 01's semantics. The ctx **records** `Edit[]` into the plan and keeps an overlay, so later reads in the handler see earlier writes. The handler is **synchronous**. Async host work (uploader, link metadata, page backend) runs in an optional `prepare` step before planning, like 01's step 3. Its result is passed to the handler. Shape in section 3.4.

**Reason.** The planner must be pure and synchronous so it can dry-run before writing. Host calls have side effects, so they must finish before the plan, as `prepareInsert` does in 01.

### C7. Error codes (01 vs 02 vs 03 vs 04)

- 01: `UPPER_SNAKE`. 02 and 03: `lower_snake` (`invalid_args`, `stale`, `cancelled`...). 04: `UPPER_SNAKE` surface codes, plus a duplicate `READ_ONLY`.

**Resolution.** One `UPPER_SNAKE` union (section 3.2). Mappings:

| Was | Becomes |
|---|---|
| 02 `unknown_action` | `UNKNOWN_COMMAND` with `details.tool` |
| 02 `invalid_args`, 03 `validation` | `INVALID_ARGS` |
| 02 `invalid_data` | `DATA_REJECTED` |
| 02 `precondition_failed` | `PRECONDITION_FAILED` (new) |
| 02 `service_unavailable` | `SERVICE_UNAVAILABLE` (new; merged into `COMMAND_UNAVAILABLE` in round 3, R3-1) |
| 02 `view_state_field`, `guarded_field` | `FIELD_NOT_WRITABLE`, `details.reason: 'view-state' \| 'guarded'`, `details.use` |
| 03 `stale` / `read_only` / `not_found` | `STALE` / `READ_ONLY` / `BLOCK_NOT_FOUND` |
| 03 `cancelled` | `CANCELLED` (new) |
| 04 `READ_ONLY` | the same `READ_ONLY` |

04's other codes stay as surface codes in the same union. All errors use one `AgentError` shape.

**Reason.** One union means one `switch` for every surface and one list for the model to learn.

### C8. Result envelope (01 vs 03 vs 04)

- 03 needs touched ids and ranges for the agent caret. 04 needs touched ids for presence. 01's `AgentResult` has neither.
- 04 puts `error` beside `result`. 01 has `ok: false` with `error`.

**Resolution.** `AgentResult` gains `changed` and `lastRange` (section 3.2). MCP's `structuredContent` for `blok_execute` is `AgentResult` plus a `delivery` object. There is no second `error` field.

**Reason.** Both consumers need the same ids. One error location keeps the MCP result a strict superset of the in-app result.

### C9. Document view names (01 vs 03 vs 04)

01 says `DocumentView` / `ViewArgs`. 03 says `ViewOptions`. 04 says `View01` / `ViewOptions01`. **Resolution:** `DocumentView` and `ViewArgs` (01's names) everywhere. **Reason.** 01 owns the view.

### C10. Manifest shape (01 vs 02 vs 03 vs 04)

- **01** wants a plain-JSON `ToolDescriptor` with fields 02 does not have: `selfPlacesChildren`, `restrictedInTableCell`, `summaryFields`, `defaultChildren`, conversion field names, serializable sanitize rules.
- **02**'s `BlockToolManifestEntry` covers tools only. It has no core commands.
- **03** and **04** assume the manifest lists every command with an args schema.

**Resolution.** Split model-facing JSON from runtime code.

- `BlokToolManifest` (02, JSON). For models and renderers. 02 adds `selfPlacesChildren`, `restrictedInTableCell`, `summaryFields`, `conversion: { import?: string; export?: string }`.
- `AgentContract` (new, JSON) = 01's `COMMANDS` merged with every tool's actions, plus the manifest and guidance. This is what 03, 04 and 05 consume. Built by `buildAgentContract`.
- `ToolRuntime` (code, not JSON). Per tool: sanitize config, `normalize`, `defaultChildren`, action handlers. The planner consumes it. It never crosses a process boundary in v1, so function sanitize rules travel by reference.
- `selfPlacesChildren` comes from `SELF_PLACING_PARENTS`, today keyed by the names `table` and `database` (`src/tools/nested-blocks.ts:110`). Verified. See B7.
- `restrictedInTableCell` comes from `isRestrictedInTableCell` (`src/tools/table/table-restrictions.ts:100-102`). Verified.
- **Open blocker (unverified).** `ToolRuntime.sanitize` needs each built-in tool's rules in Node. Today they are statics on the tool classes, e.g. `src/tools/paragraph/index.ts:484`, `src/tools/header/index.ts:754`. `src/view/` does not reuse them; it uses one shared `INLINE_TEXT_SANITIZE` (`src/view/html-to-blocks.ts:25`, `:197`). `src/cli` builds a `JSDOM` to run its work (`src/cli/index.ts:71-72`). Whether the tool classes import cleanly in Node is unverified (01 §2.7 said the same). Until checked, 02 moves each built-in sanitize config into `src/shared/tool-descriptions/` and the tool class reads it from there.

**Reason.** Models need JSON. The planner needs code (sanitize functions, `normalize`, handlers). Mixing them forces function rules into JSON, which only Jint would need.

### C11. Undo semantics (01 vs 03 vs 04)

- **01**: one step per `execute`. Never hold capture across a model call. Turn merging is 03's policy. Headless undo restores a pre-batch snapshot.
- **03**: one step per uninterrupted turn, across awaits (R-U1..R-U6).
- **04**: no undo tool; asks for one (Q5).

Facts checked:

- `continueEntryThatCreated` merges the next write into the newest stack item by setting `undoManager.lastChange` (`undo-history.ts:1917-1930`). That is a precedent lever. Verified.
- `beginApiCall` starts a discrete gesture when nothing holds capture (`undo-history.ts:2143-2158`). That may split the step before a merge can land. Verified that the code reads so; the interaction is unverified.
- `UndoHistory` is wired to editor modules (`setBlok`, `undo-history.ts:1019`). Running it without an editor is unverified.
- Snapshot restore in a live room would erase peers' concurrent edits.

**Resolution.**

- Browser: one step per `execute` (01). 03's turn rule: a batch joins the turn's previous step only if that step is still the top of the undo stack and no user gesture started since. Otherwise it opens a new step. Capture is never held across a model call. **The lever is unverified.** Tests must pin R-U1 and R-U3 before this is called done.
- `history.undo` from an agent undoes only its own top step, else `UNDO_NOT_OWN` (01).
- Node stored mode: undo restores the pre-batch snapshot and saves it with `ifVersion`.
- Node live mode: `history.undo` returns `COMMAND_UNAVAILABLE` in v1. A bare `Y.UndoManager` over the session's local origin is a later option (unverified).

**Reason.** Holding capture across a model call pulls the user's typing in (01 §3.6). Merging only when the turn's step is still on top gives 03 one step per turn without that risk. Snapshot restore is safe only where no peer writes.

### C12. Text offset units (01 vs 03 vs 04)

01 uses UTF-16 code units, one unit per embed (`src/components/modules/yjs/rich-text-write.ts:10-23`, per 01, not re-read here). 03 maps ranges to `CaretPosition { inputIndex, anchor, head }`. 04 publishes no caret.

**Resolution.** UTF-16 code units, one per embed, everywhere in the contract. Ranges name a data `field`, never a DOM `inputIndex`. 03 maps `field` to an input inside the editor. When it cannot, it puts the agent caret at the block level. Whether `CaretPosition.anchor/head` use the same units is unverified; 03 checks it.

**Reason.** Data fields exist in every runtime. DOM inputs exist only in the browser.

### C13. Package and file locations (01 vs 03 vs 04 vs 05)

- 03: generator in `src/agent/`, asks for a `./agent` subpath for 04.
- 04: `src/mcp/`, `packages/mcp/`, `@bloklabs/mcp`. It needs parse5-based headless ports, which 01 puts in `src/view/agent-runtime.ts`.
- 05: assumes `renderMcpTools` is importable from a unit test.

Facts checked:

- npm scope is `@bloklabs` (`package.json` `name` = `@bloklabs/core`; `packages/*/package.json` names). Workspaces are `packages/*`. Verified.
- The view-entry law forbids any module outside `src/view/` to import from it, except `src/migrate/` (`test/unit/architecture/view-entry-law.test.ts:35-38`, `:58-66`). Verified. So `src/mcp/` cannot import `src/view/agent-runtime.ts` today.

**Resolution.**

- Renderer: `src/agent/render-tools.ts`, pure. No `./agent` subpath. 04 bundles it from source. 05 imports it from source.
- MCP: `src/mcp/` + `packages/mcp/` → `@bloklabs/mcp`, bin `blok-mcp`.
- The view-entry law gets a second exception for `src/mcp/`, with the same "nobody imports `src/mcp/`" guard it has for `src/migrate/`. 01 and 04 both name this change.

**Reason.** Bundling from source is how `@bloklabs/cli` already ships. It avoids a new published subpath.

### C14. `caret.set` vs focus neutrality (01 vs 03)

01 has a `caret.set` command that moves and reveals the caret. 03's success criterion 3 says the agent never moves the user's caret, selection, focus or scroll.

**Resolution.** Drop `caret.set` from v1. The agent caret is drawn from results (03). Following the agent is the host's `follow` option. 05 marks `api:blocks.scrollToBlock` as `view-only`.

**Reason.** Moving the user's caret while they type is the worst failure an in-app agent can cause. No eval task needs it.

### C15. Page title and icon (01 vs 02 vs 04)

01 wants `page.setTitle` / `page.setIcon` later. 02 has `page.rename` / `page.setIcon` as page-block actions. 04 says page fields work in both modes.

Facts: `page-fields.ts` exists with no public API (grep of `types/` and `src/components/modules/api/`). `OutputData` has no page fields. Both commits are after `v1.16.1`. Verified.

**Resolution.** No document page-field commands in v1. If added later, they live under `doc.` (`doc.setTitle`, `doc.setIcon`), so they never collide with the `page` block tool's actions. 02's `page.rename` / `page.setIcon` stay host-hook actions with `runtime: 'editor'` and `requires: ['pageBackend']`.

**Reason.** There is no saved shape and no public API to build on yet.

### C16. Snapshot dialect in the editor (01, unverified there)

01 did not know whether `YjsManager.toJSON()` returns segments or HTML. The serializer renders a `Y.XmlText` to HTML (`src/components/modules/yjs/serializer.ts:952-955`). Verified. **Resolution:** the editor snapshot step converts rich fields to segments. It reads them with `serializer.readRichText` (`serializer.ts:415`) where it can, else `ports.htmlToSegments`.

**Reason.** The planner works on segments only (01 §3.3).

### C17. Live-mode completeness of tool data (01 vs 04)

A browser does not write normalised data back for a block another client authored. `BlockRendered` uses `recordOnly: true` for a peer's block (`blockManager.ts:424`). `recordOnly` writes nothing (`blockManager.ts:2454-2463`). A collab document render is also record-only (`blockManager.ts:2433-2437`). Verified.

**Resolution.** A headless author must write complete data itself. 02's pure `normalize(data)` is a **v1 blocker for live mode** for any tool that fills data on load. The table's column and row ids are the known case (`types/tools/table.d.ts:12-14`). Whether the table writes minted ids through another path is unverified.

**Reason.** No receiver fills the gaps for a peer's block, by design, so the author must.

### C18. Read-only enforcement (01 vs 03)

01 lists `READ_ONLY` but no guard location. 03 found no guard in `api/blocks.ts`. Verified: `api/history.ts:53`, `:63` and `api/saver.ts:28` check `ReadOnly.isEnabled`; `api/blocks.ts` does not. **Resolution:** 01's executor refuses every write command with `READ_ONLY` before planning. Reads still work.

**Reason.** One guard in one place covers every surface, whatever the public API does.

---

## 2. Answers to every open question

| Id | To | Answer | Specs to change |
|---|---|---|---|
| 01-Q1 | 04 | Live rooms: a Node socket member applying `Edit[]` to a `DocumentStore` (`StoreApplier`). No `/edit` change. Note: `/edit` Update is already merge-safe (`YDocConverter.cs:1124-1185`). See C1. | 01, 04 |
| 01-Q2 | 04 | ~~Node, not Jint.~~ **Superseded:** Node and C# Jint both in v1 (D1, D1a; section 7). | 01, 05 |
| 01-Q3 | 03 | Merge into the turn's previous step only if it is still on top and no gesture came between. Lever unverified. See C11. | 01, 03 |
| 01-Q4 | 02 | Yes. `defaultChildren` goes in each container's description (code side, `ToolRuntime`). Parity tests pin that explicit `children` suppress seeding. | 02 |
| 01-Q5 | 02 | Yes. Custom actions are editor-only in v1. MCP loads custom tools as JSON descriptions (structural + field writes). A host-shipped Node handler module is later. | 02, 04 |
| 01-Q6 | 02 | No serialization needed in v1. Function rules travel by reference in-process. The headless sanitizer already runs them against an Element facade (`src/view/sanitize.ts:342`, `:410`). Verified. Round 3: Jint carries built-in function rules inside the bundle as code, so no JSON form is needed; a `BlokCustomToolsFile` carries object rules only (R3-9). | 01, 02 |
| 01-Q7 | 02 | Moving an existing block into an existing column is `block.move` (core). Creating columns and side-drop are `column_list.*` actions. Emptied-column cleanup is one pure helper both use. | 01, 02 |
| 01-Q8 | 02 | 02 adds `summaryFields?: string[]` to the description. | 02 |
| 01-Q9 | 05 | Yes. Every eval `reference` batch is also a parity case. | 05 |
| 01-Q10 | 03, 04 | ~~Not in v1.~~ **Superseded:** in v1 as `doc.setTitle` / `doc.setIcon` and headless `page.rename` / `page.setIcon` (D6; section 10.1). | 01, 04 |
| 01-Q11 | 02 | Yes, `normalize(data)` per tool, pure. Required for live mode (C17). Parity ignores a listed set of tool-minted fields until each tool has it. | 02, 01 |
| 02-Q1 | 01 | `<registryKey>.<action>`, flat args, no generic `tool.action` (C5). | 01, 02 |
| 02-Q2 | 01 | Yes, as a recording ctx, synchronous, with an optional async `prepare` (C6). | 01, 02 |
| 02-Q3 | 01 | Yes. Plain writes to `viewState`/`guardedFields` → `FIELD_NOT_WRITABLE`. After planning, 01 validates the keys the batch wrote, and whole `data` of inserted blocks. It does not re-validate untouched legacy keys. | 01 |
| 02-Q4 | 01 | No tool `setData` → `BlockMutation.update` takes the recompose path (`src/components/modules/blockManager/block-mutation.ts:316-320`, gate on `supportsInPlaceSetData`). Verified. Whether recompose keeps database rows attached is unverified; 01 adds a test. Adding `setData` to database is the fallback fix. | 01 |
| 02-Q5 | 01, 03 | No view-state control in v1. | 02, 03 |
| 02-Q6 | 03, 04 | URL only in v1. No byte transport. | 03, 04 |
| 02-Q7 | 01, 04 | ~~`runtime: 'editor'`.~~ **Superseded:** `runtime: 'any'`, `effects: 'host'`, `requires: ['pageBackend']` (section 12, R3-2). | 02 |
| 02-Q8 | 04 | JSON descriptions via `--manifest <file>` in v1. Handlers in Node later. | 04 |
| 02-Q9 | 03, 04 | The shared renderer owns provider adaptation. 02 adds no `flattenForProvider`. Which keywords providers reject is unverified; 03's law test checks the rendered output. | 02, 03 |
| 02-Q10 | 03, 04 | Both. Browser: new optional `BlokConfig.agent.overrides` (additive key, D4). MCP: `overrides` option and `--manifest-overrides <file>`. Overrides also refuse hidden actions at execute time. | 03, 04 |
| 02-Q11 | 05 | Yes, with 05's `{ field }` kind (C4). `mirrors` holds 05 **capability ids**, not i18n keys, so the law can auto-cover them (see 05-Q7). | 02, 05 |
| 02-Q12 | 05 | No. The law counts only human-reachable UI. Database sorts/filters/etc. stay out. Image `size`/`frame`/`rounded` are field writes already. | 05 |
| 02-Q13 | 01 | Mostly yes. A block tool's base sanitize config is built from its enabled inline tools only (`src/components/modules/tools.ts:528-570`, `src/components/tools/block.ts:605-617`). Verified. But a tool's own field rule and the global `sanitizer` config can allow more tags (`block.ts:562-597`; `api/blocks.ts:980-988`). The manifest says per-block `inlineTools` is "enabled", not "the only marks that survive". | 02 |
| 03-Q1 | 01 | Yes. Per-touched-block attribution beside `'local'` (C3). | 01 |
| 03-Q2 | 01 | Yes. `expectRevision` and `expectText`. `STALE` carries `details.current`: the outline entries (and field text) of the blocks the check named. Positions are ids, not child indexes. | 01 |
| 03-Q3 | 01 | Yes. Every command is focus-neutral. `caret.set` is dropped (C14). Internal `scrollToBlock` calls use `{ select: false }`. | 01 |
| 03-Q4 | 01 | 01's executor (C18). | 01 |
| 03-Q5 | 01 | Today only a remote rewrite restores the caret (`src/components/modules/blockManager/yjs-sync.ts:1316-1318`). Verified. `EditorApplier` wraps a write to the user's caret block with the same `captureCaretAcrossRewrite`. | 01 |
| 03-Q6 | 01 | Yes. `block.insert.children` is recursive. `strict` is never emitted for `blok_execute`. | 03 |
| 03-Q7 | 01 | R-U1..R-U5 by design (C11). R-U1, R-U3, R-U6 need tests; the merge lever is unverified. | 01, 03 |
| 03-Q8 | 02 | Yes. Names are stable strings and valid enum members. | — |
| 03-Q9 | 02 | Sections: `AgentGuidance` (section 3.6). | 02, 03 |
| 03-Q10 | 04 | Yes, same three core tools (C2). No subpath: 04 bundles the renderer from source. | 03, 04 |
| 03-Q11 | 04 | ~~Stays local.~~ **Superseded:** shown to peers via the `agentCursor` awareness field (D6; section 10.2). | 03, 04 |
| 03-Q12 | 05 | Yes. Compare `'envelope'` vs `'full'` on the same tasks; the result sets the default. | 05 |
| 03-Q13 | 05 | Reachable = listed in the contract + covered by a parity case. No eval task per command. | 05 |
| 04-Q1 | 01 | `Edit[]` over both: `JsonApplier` (stored) and `StoreApplier` over `DocumentStore` (live). A move stays a move (C1). | 01, 04 |
| 04-Q2 | 01 | Section 3.2. | 04 |
| 04-Q3 | 01 | Yes, `AgentResult.changed` (C8). | 01 |
| 04-Q4 | 01 | `expectRevision` is an opaque counter over the session's store updates (`DocumentStore.onAnyUpdate`, `document-store.ts:2428`). Not a state vector. In a busy room it goes stale fast, so prefer `expectText`. | 01, 04 |
| 04-Q5 | 01 | Stored: yes (snapshot). Live (Node or C#): `COMMAND_UNAVAILABLE` in v1 (C11, D6). | 01, 04 |
| 04-Q6 | 01 | Yes. The loader turns HTML rich fields into segments with `htmlToSegmentsNode`. Sanitize runs on `src/view/sanitize.ts` (parse5). | 01 |
| 04-Q7 | 01 | ~~No Jint work.~~ **Superseded:** the C# Jint path ships in v1 (D1); 01 and 04 co-own it until a server spec exists (section 11). MCP itself stays Node-only. | 01, 04 |
| 04-Q8 | 01 | ~~No page fields.~~ **Superseded:** page fields ship in both modes (D6; section 10.1). | 04 |
| 04-Q9 | 02 | Yes. `buildToolManifest` is pure. The default snapshot is built from `BUILT_IN_BLOCK_DESCRIPTIONS` in Node. Custom tools via `--manifest <file>`. | — |
| 04-Q10 | 02 | Yes, `richTextFields` is in each manifest entry. `richTextFieldsFor` reads it. The config list is only for types missing from the manifest. | 04 |
| 04-Q11 | 02 | ~~Not in v1.~~ **Superseded:** `inputFields` on `BlockToolDescription` maps field → input; else block-level (section 10.2). | 02, 04 |
| 04-Q12 | 02 | Yes: `runtime: 'editor'` on a command entry. Round 3: the contract builder turns it into `available: false` headless, and every renderer lists only available commands (R3-1). No built-in action is `'editor'` today. | 02 |
| 04-Q13 | 03 | Yes, `renderAgentTools` (section 3.7). | 03, 04 |
| 04-Q14 | 03 | 03 draws a participant whose awareness has `agent` with an agent marker and "for <name>". The human's undo stays free of agent edits: remote origins are untracked (`undo-history.ts:393`). | 03 |
| 04-Q15 | 05 | Measured by the eval (03-Q12). | 05 |
| 04-Q16 | 05 | Yes. Add live and stored lifecycle tasks. Pass criterion includes "nothing reported durable that was not acked". | 05 |
| 05-Q1 | 01 | Yes. `ref` / `$ref`, and `block.insert` takes an optional `id`. Tool-minted inner ids (table cells) stay random, so normalisation by position stays for those. | 05 |
| 05-Q2 | 01 | Yes. `AgentSession.log()` in every runtime (section 3.5). | 01 |
| 05-Q3 | 01 | Round 3: any command with `available: false` in that runner's contract → `COMMAND_UNAVAILABLE` (R3-1). Today: actions whose `requires` service is absent (incl. `page.*` without `pageBackend`), and `history.undo` / `redo` in Jint and live rooms. | 05 |
| 05-Q4 | 03 | Tool definitions are identical everywhere. Most in-app tasks can run in Node against a document session. A small subset runs in Playwright to cover `EditorApplier`. | 05 |
| 05-Q5 | 03 | Yes, `adapter-blok-instance-law.test.ts` (03 §6 item 12). | — |
| 05-Q6 | 03, 04 | Yes. One pure `renderAgentTools`; no name mapping needed (C2). | 05 |
| 05-Q7 | 02 | Not via popover `name`. Via `mirrors`, which lists 05 capability ids. An id listed in some action's `mirrors` needs no ledger row. | 02, 05 |
| 05-Q8 | 02 | Yes for every member with UI, under 02's §3.4 rule. Exact names in 02 §3.8. | 05 |
| 05-Q9 | 02 | Yes (04-Q9). | — |
| 05-Q10 | 04 | ~~None in v1.~~ **Superseded:** Jint op `agentExecute`, exposed as `IBlokAgentExecutor.ExecuteAsync` (section 7.2-7.3). | 05 |
| 05-Q11 | 04 | Saved `lastEditedBy` on touched blocks. In rooms, the journal `actors` too (MCP agents only; C3). | 05 |
| 05-Q12 | 04 | Yes. `scripts/test-server-conformance.mjs` builds the binary and sets `BLOK_CONFORMANCE_SERVER` (`:170`). `test/unit/server-conformance/run-against.ts` exports `startServer` (import at `blok-client-contract.test.ts:30`). Verified. | 05 |
| 05-Q13 | all | Agreed: `{ field }` only for one-field effects (C4). | 05 |

---

## 3. Canonical shared contract

All shapes below are the agreed versions. Published ones are hand-authored in `types/` with no `src/` imports.

### 3.1 Commands

```ts
type CoreCommandName =
  | 'doc.read' | 'doc.find' | 'doc.setTitle' | 'doc.setIcon'
  | 'block.insert' | 'block.update' | 'block.delete' | 'block.move'
  | 'block.convert' | 'block.duplicate'
  | 'text.insert' | 'text.delete' | 'text.replace' | 'text.format'
  | 'markdown.insert' | 'markdown.export'
  | 'history.undo' | 'history.redo';

/** A tool action: `<registryKey>.<action>`, e.g. 'table.insertRows', 'column_list.create'. */
type ToolCommandName = `${string}.${string}`;
type CommandName = CoreCommandName | ToolCommandName;

const RESERVED_NAMESPACES = ['doc', 'block', 'text', 'markdown', 'history'] as const;
```

Core args and results are 01's table (01 §5.1), minus `caret.set` and `tool.action`. Positions are `BlockPosition` (`types/api/blocks.d.ts:33`). Text ranges are 01's `TextRange` (01 §3.9). Units: UTF-16 code units, one per embed.

Tool action args:

- `target: 'block'`: `{ id: string; ...actionArgs }`.
- `target: 'create'`: `{ parentId?: string | null; position?: BlockPosition; ...actionArgs }`, result includes `{ id: string; childIds: string[] }`.
- `actionArgs` may not declare `id`, `parentId`, `position`.

### 3.2 Envelope, result, errors

```ts
interface AgentCommand { name: CommandName; args: Record<string, unknown>; ref?: string }
interface AgentBatch { commands: AgentCommand[]; expectRevision?: string }

interface ChangedSet { created: string[]; updated: string[]; moved: string[]; removed: string[] }
interface TextRangeRef { blockId: string; field: string; start: number; end: number }

type AgentResult =
  | { ok: true; revision: string; results: unknown[]; refs: Record<string, string>;
      changed: ChangedSet; lastRange?: TextRangeRef; warnings: AgentWarning[] }
  | { ok: false; revision?: string; error: AgentError; warnings: AgentWarning[] };   // revision absent before a session exists (R2-04-3)

interface AgentError {
  code: AgentErrorCode;
  message: string;          // what is wrong + what to do
  commandIndex?: number;
  path?: string;            // JSON pointer into the batch
  retryable: boolean;
  details?: Record<string, unknown>;
}

type AgentErrorCode =
  // command errors (01, 02, 03)
  | 'INVALID_ARGS' | 'UNKNOWN_COMMAND' | 'UNKNOWN_TOOL' | 'BLOCK_NOT_FOUND'
  | 'FIELD_NOT_RICH_TEXT' | 'FIELD_NOT_WRITABLE' | 'RANGE_OUT_OF_BOUNDS' | 'RANGE_NOT_FOUND'
  | 'PLACEMENT_REFUSED' | 'CONVERSION_UNSUPPORTED' | 'DATA_REJECTED'
  | 'PRECONDITION_FAILED' | 'COMMAND_UNAVAILABLE' | 'READ_ONLY' | 'STALE' | 'CONFLICT'
  | 'UNDO_NOT_OWN' | 'NOTHING_TO_UNDO' | 'CANCELLED'
  | 'TOOL_ACTION_FAILED' | 'ORPHANED_SIDE_EFFECT' | 'APPLY_FAILED'
  // surface errors (04)
  | 'UNKNOWN_HANDLE' | 'HANDLE_LIMIT' | 'FORBIDDEN' | 'ROOM_SYNC_TIMEOUT' | 'ROOM_RESET'
  | 'REJECTED' | 'VERSION_SKEW' | 'DOCUMENT_CHANGED' | 'STORED_WRITE_FORBIDDEN'
  | 'SOURCE_UNAVAILABLE';   // DURABILITY_TIMEOUT removed in round 2 (R2-04-2)

type AgentWarningCode = 'SANITIZED' | 'DEMOTED' | 'LOOKS_LIKE_MARKDOWN' | 'MARKDOWN_DEGRADED' | 'UNKNOWN_MARK_DROPPED';
interface AgentWarning { code: AgentWarningCode; message: string; commandIndex?: number; blockId?: string; field?: string }
```

`PLACEMENT_REFUSED.details.reason` is 01's list (01 §3.10).

Availability codes (round 3, R3-1). Exactly two:

- `UNKNOWN_COMMAND`: the name is not in this runner's contract (never existed, wrong tool, or hidden by `ManifestOverrides`).
- `COMMAND_UNAVAILABLE`: the name is in the contract with `available: false`. `details.reason` is `'runtime'` (e.g. `history.undo` in Jint or a live room, a `runtime: 'editor'` command headless) or `'service'` (a `requires` service is absent; `details.requires` names it). It replaces the round-1/2 codes `SERVICE_UNAVAILABLE` and `UNSUPPORTED_IN_RUNTIME`, which no longer exist.
- `READ_ONLY` stays separate: read-only is a document state, not a command property. `STALE.details.current` holds the fresh outline entries of the blocks the check named.

### 3.3 Document view

01's `DocumentView` and `ViewArgs` (01 §3.11), unchanged, minus `selection` outside the editor. Opaque blocks (type not registered) appear with `opaque: true`; only `block.move` and `block.delete` accept them.

### 3.4 Tool description, actions and runtime

02's `BlockToolDescription`, `ToolActionDeclaration`, `InlineToolDescription`, `BlockTuneDescription` (02 §3.5), with these changes:

```ts
interface ToolActionDeclaration {
  name: string;                       // camelCase; command = `${registryKey}.${name}`
  summary: string; guidance?: string;
  args: BlokSchema; result?: BlokSchema;
  target: 'block' | 'create';
  runtime?: 'any' | 'editor';         // default 'any'; no built-in action is 'editor' (R3-2)
  /** 'host': prepare changes the world outside the document. Must be alone in its batch. Never runs inside Jint. */
  effects?: 'host';
  preconditions?: string[];
  requires?: HostService[]; uses?: HostService[];
  mirrors?: string[];                 // 05 capability ids, e.g. 'menu:table/insert-row-above'
}

interface BlockToolDescription {
  // ...02 fields...
  summaryFields?: string[];           // scalar fields shown in the outline view
  /** Entry i = the data field DOM input i edits (section 10.2). Absent: one rich field → input 0, else block-level. */
  inputFields?: string[];
}

/** Code side. Never serialized in v1. */
interface ToolRuntime {
  name: string;
  sanitize: SanitizerConfig;          // function rules by reference
  normalize?(data: Record<string, unknown>): Record<string, unknown>;   // pure
  defaultChildren?: InsertSpec[];
  actions: Record<string, ToolActionImpl>;
}

interface ToolActionImpl<Args = unknown, Prepared = unknown, Result = unknown> {
  /** Optional async host work, run before planning. Nothing is written. */
  prepare?(ctx: { services: Partial<Record<HostService, unknown>> }, args: Args): Promise<Prepared>;
  /** Synchronous. Writes are recorded as Edit[]; reads see earlier writes. */
  run(ctx: ToolActionContext, args: Args, prepared: Prepared | undefined): Result;
}

interface ToolActionContext {
  block?: { id: string; type: string; data: Readonly<Record<string, unknown>>; children: readonly string[] };
  read(id: string): { id: string; type: string; data: unknown; parentId: string | null; children: readonly string[] } | null;
  insert(input: { type: string; data?: Record<string, unknown>; parentId?: string | null; position?: BlockPosition; children?: InsertSpec[] }): string;
  update(id: string, patch: Record<string, unknown>): void;
  setRichText(id: string, field: string, value: RichText): void;
  move(id: string, to: { parentId?: string | null; position: BlockPosition }): void;
  remove(id: string, opts?: { withChildren?: boolean }): void;
  newId(): string;
  richText: RichTextHelpers;
  fail(code: 'PRECONDITION_FAILED' | 'INVALID_ARGS', message: string): never;
}
```

Every recorded edit goes through 01's rules: placement, sanitize, validation, undo, attribution.

### 3.5 Sessions

```ts
interface AgentActor { id: string; name: string; kind: 'agent'; onBehalfOf?: string; color?: string }

interface CommandLogEntry { batch: number; index: number; name: string; args: unknown; result?: unknown; error?: AgentError; actorId: string }

interface AgentSession {
  readonly id: string;
  readonly actor: AgentActor;
  read(args?: ViewArgs): Promise<DocumentView>;
  describe(query?: { tool?: string; command?: string }): AgentContract | ContractSlice;
  execute(batch: AgentBatch, options?: { signal?: AbortSignal }): Promise<AgentResult>;   // R2-01-5
  log(): readonly CommandLogEntry[];
  close(): void;
}

// Internal factories (not published)
createEditorAgentSession(editor: InternalEditorHandle, actor: AgentActor): AgentSession;
createDocumentAgentSession(input: { document: OutputData; tools: ToolRuntimeRegistry; contract: AgentContract;
  actor: AgentActor; ports: AgentPorts }): AgentSession & { output(): OutputData };
createStoreAgentSession(input: { store: DocumentStore; tools: ToolRuntimeRegistry; contract: AgentContract;
  actor: AgentActor; ports: AgentPorts }): AgentSession;
```

`AgentPorts` is 01's (01 §3.1). Headless ports live in `src/view/agent-runtime.ts`.

```ts
type ToolRuntimeRegistry = ReadonlyMap<string, ToolRuntime>;   // keyed by registry key
type ContractSlice =
  | { index: { tools: { name: string; summary: string }[]; commands: { name: CommandName; summary: string }[]; guidance: string } }
  | { tool: BlockToolManifestEntry; commands: CommandEntry[] }
  | { command: CommandEntry };
```

Public browser surface (03): `editor.agent` with `begin(options): AgentTurn`. `AgentTurn` is an `AgentSession` plus `signal`, `call(name, input)`, `end()`, `stop()`. `AgentIdentity` = `AgentActor` without `kind`.

Event: `BlockMutationEventDetail.agent?: { id: string; name: string; turnId: string }`. `origin` stays `'local'`.

### 3.6 Contract and manifest

```ts
interface CommandEntry {
  name: CommandName;
  summary: string; guidance?: string;
  args: BlokSchema; result?: BlokSchema;
  readOnly: boolean;
  runtime: 'any' | 'editor';
  source: 'core' | { tool: string; target: 'block' | 'create' };
  requires?: HostService[];
  effects?: 'host';
  available: boolean;                // false → COMMAND_UNAVAILABLE (R3-1)
  unavailableReason?: 'runtime' | 'service';
}

interface AgentGuidance { general: string; commands: Record<string, string>; tools: Record<string, string> }

interface AgentContract {
  formatVersion: 1;
  revision: string;                 // hash; changes with tools, config, overrides
  commands: CommandEntry[];         // 01 COMMANDS + every tool action, sorted by name
  manifest: BlokToolManifest;       // 02, with the C10 additions
  guidance: AgentGuidance;
}

function buildToolManifest(snapshot: ToolRegistrySnapshot, overrides?: ManifestOverrides): BlokToolManifest;
function buildAgentContract(manifest: BlokToolManifest, core: typeof COMMANDS,
  where: { runtime: 'editor' | 'node' | 'jint' | 'node-live' | 'csharp-live'; services: HostService[] }): AgentContract;
// `available` is computed here, once, for every surface (R3-1, R3-2).

type ManifestOverrides = Record<string, { hidden?: boolean; hiddenActions?: string[]; guidance?: string }>;
```

### 3.7 Renderer

```ts
// src/agent/render-tools.ts — pure, DOM-free
type AgentToolName = 'blok_read' | 'blok_describe' | 'blok_execute';

interface RenderOptions {
  format: 'anthropic' | 'openai' | 'mcp';
  schema?: 'envelope' | 'full';     // default 'envelope' until 05 decides
  strict?: boolean;                 // never for blok_execute (recursive children)
  /** MCP only: adds `handle` with `x-mcp-header: "Blok-Handle"` to every core tool. */
  handle?: boolean;
}
// Round 3: the `runtime` option is removed. Every renderer lists only `available: true` commands;
// availability is decided by buildAgentContract (R3-1). blok_describe still shows all commands with `available`.

function renderAgentTools(contract: AgentContract, options: RenderOptions): RenderedTool[];

type RenderedTool =
  | { name: AgentToolName; description: string; input_schema: object; strict?: boolean }               // anthropic
  | { type: 'function'; name: AgentToolName; description: string; parameters: object; strict?: boolean } // openai (Responses)
  | { name: AgentToolName; description: string; inputSchema: object; outputSchema: object };            // mcp
```

`blok_execute` input: `{ commands: AgentCommand[]; expectRevision?: string }`. In `'envelope'`, `name` is an enum of the `available: true` names in `contract.commands` and `args` is an open object. In `'full'`, items are a `oneOf` with one branch per command. Tool names match `^[a-zA-Z0-9_-]{1,128}$`.

MCP lifecycle tools (`blok_list_documents`, `blok_open`, `blok_close`) are rendered by 04 only. `blok_execute` MCP output = `AgentResult & { delivery: { durable: boolean; pending: boolean; serverSequence: string | null; savedVersion: string | null } }`.

### 3.8 Locations and packages

| Piece | Path / name |
|---|---|
| Planner, `JsonApplier`, view, validation, `COMMANDS` | `src/shared/agent/` |
| `StoreApplier` | `src/components/modules/agent/` (it needs `DocumentStore` and Yjs, so it cannot live under 01's purity law) |
| `EditorApplier`, `AgentAPI` (`editor.agent`) | `src/components/modules/agent/`, `src/components/modules/api/agent.ts` |
| Headless ports (parse5) | `src/view/agent-runtime.ts` |
| Descriptions, action impls, manifest, validator | `src/shared/tool-descriptions/`, `src/shared/tool-actions/`, `src/shared/tool-manifest.ts`, `src/shared/schema/validate.ts` |
| Renderer | `src/agent/render-tools.ts` |
| MCP | `src/mcp/`, `packages/mcp/` → `@bloklabs/mcp`, bin `blok-mcp` |
| Public types | `types/agent.d.ts`, `types/api/agent.d.ts`, `types/tools/tool-description.d.ts`, `types/tool-manifest.d.ts`, `packages/mcp/types/index.d.ts` |

No new core subpath. `buildToolManifest` and `validateAgainst` export from `@bloklabs/core` and `@bloklabs/core/view` (02 §4).

---

## 4. Per-spec revision instructions

### 01 — Core commands

1. Replace the Jint `agentExecute` op with "deferred" (C1, D1). Remove `src/view/server-runtime.ts` from section 4.
2. Add `StoreApplier` and `createStoreAgentSession`. Map each `Edit` to a `DocumentStore` method (C1 list).
3. Drop `caret.set` and `tool.action`. Adopt flat `<registryKey>.<action>` with reserved namespaces (C5).
4. Adopt the recording `ToolActionContext` and `ToolActionImpl` with `prepare` (3.4). Run `prepare` in step 3.
5. Replace the error table with section 3.2's union. Add `FIELD_NOT_WRITABLE`, `PRECONDITION_FAILED`, `COMMAND_UNAVAILABLE (round 3)`, `CANCELLED`.
6. Add `changed`, `lastRange`, and `warnings` on failure to `AgentResult`. Add `STALE.details.current`.
7. Add `log()` to `AgentSession`.
8. Attribution: per-touched-block scope held until the group closes. Add the "user types elsewhere" test (C3).
9. Undo: per-batch step; the turn-merge lever is unverified and needs tests; live Node undo → `COMMAND_UNAVAILABLE`; stored undo → snapshot + save (C11).
10. Correct §2.6 and Q1: `/edit` Update is merge-safe (`YDocConverter.cs:1124-1185`).
11. Snapshot dialect is HTML, verified (C16). Read rich fields as segments.
12. Read-only guard in the executor (C18). Replace §4's "`convert` overrides go through `hostDataForTool`" with: `EditorApplier` sanitizes its own overrides; public `blocks.convert` is unchanged (D5). Caret capture/restore for the user's caret block (03-Q5).
13. Post-write validation scope per 02-Q3.
14. Name the view-entry law exception for `src/mcp/` (C13).
15. Consume `ToolRuntime` + `BlokToolManifest` instead of a single JSON `ToolDescriptor` (C10).
16. Parity test: three appliers, not Jint.

### 02 — Tool self-description

1. Rename `columns.*` to `column_list.*` (C5). Use `<registryKey>.<action>` everywhere.
2. Replace the handler type with `ToolActionImpl` (3.4). Handlers are synchronous; async host work goes in `prepare`.
3. Add `runtime` to `ToolActionDeclaration`. Mark `page.rename`, `page.setIcon` as `runtime: 'editor'`.
4. Change `mirrors` to 05 capability ids (05-Q7).
5. Add `summaryFields`, and to the manifest entry `selfPlacesChildren`, `restrictedInTableCell`, `conversion` field names (C10).
6. Add the code-side `ToolRuntime`: `sanitize`, `normalize`, `defaultChildren`, `actions` (C10). `normalize` for table is a v1 blocker (C17).
7. Replace the error table with codes from 3.2 (C7).
8. Forbid `id`, `parentId`, `position` in action arg schemas; add to the description law test.
9. Add `buildAgentContract` and `AgentGuidance` sections (3.6, 03-Q9).
10. Drop the `flattenForProvider` offer (02-Q9).
11. Add Q13's answer: per-block `inlineTools` means "enabled", not "only survivors".
12. Move each built-in tool's sanitize config into `src/shared/tool-descriptions/`, read by the tool class, so Node gets it without importing tool classes (C10 open blocker). First check whether the classes import cleanly in Node.

### 03 — In-app surface

1. Rename `blok_apply` → `blok_execute`. `blok_describe` takes `{ tool?, command? }`.
2. Rename `renderLlmTools` → `renderAgentTools` with section 3.7 options. Add `format: 'mcp'` support for 04. `AgentToolDefinition` becomes `RenderedTool`.
3. Drop the `./agent` subpath request (C13).
4. `AgentTurn` gains `read`, `describe`, `execute`, `log` (session methods), beside `call`.
5. `AgentIdentity` = `AgentActor` without `kind` (C3). Document the in-room split: journal names the human.
6. Error names to section 3.2 (`CANCELLED`, `READ_ONLY`, `STALE`, `INVALID_ARGS`).
7. Undo: state the turn-merge rule from C11 and mark the lever unverified. Keep R-U1..R-U6 tests.
8. Caret: map `lastRange.field` to an input, else block-level (C12). Check `CaretPosition` units.
9. Add drawing of remote participants whose awareness carries `agent` (04-Q14).
10. Add `BlokConfig.agent.overrides` (02-Q10).
11. Never emit `strict` for `blok_execute` (03-Q6).

### 04 — Outside surface

1. Rename `blok_capabilities` → `blok_describe`. Use `renderAgentTools({ format: 'mcp', handle: true })` for the three core tools.
2. Live mode: `createStoreAgentSession` over the session's `DocumentStore`. Stored mode: `createDocumentAgentSession` (`JsonApplier`), not a socketless store (C1).
3. Drop page-field support claims (C15). Remove `pageFromJSON` from stored open.
4. Replace `BatchResult01`/`Error04` with `AgentResult` + `delivery`; one error union (3.2).
5. `history.undo`: live → `COMMAND_UNAVAILABLE`; stored → supported.
6. Add `--manifest <file>` and `--manifest-overrides <file>`; `richTextFields` config only for types missing from the manifest.
7. Name the view-entry law exception for `src/mcp/` (C13).
8. Require ticket `user` = `actor.id` (C3).
9. Note `normalize` as a prerequisite for writing tables in live mode (C17).
10. `expectRevision` semantics per 04-Q4.

### 05 — Coverage and evals

1. Remove the Jint parity runner. Parity = `EditorApplier`, `JsonApplier`, `StoreApplier` (C1).
2. Add coverage kind `{ field: '<registryKey>.<field>' }` with its checks. Ban `{ command: 'block.update' }` (C4).
3. Auto-cover ids listed in an action's `mirrors` (05-Q7).
4. Rewrite example names: `blocks.insert` → `block.insert`; `table.addRow` → `table.insertRows`; `columns.wrap` → `column_list.create`.
5. Replace the assumed `renderLlmTools`/`renderMcpTools` with one `renderAgentTools` called with two option sets (C2).
6. Read the log from `AgentSession.log()`; ids via `ref`/`id` (05-Q1, Q2).
7. `attributed` reads saved `lastEditedBy` (05-Q11).
8. Add the envelope-vs-full eval and live/stored lifecycle tasks (03-Q12, 04-Q15, 04-Q16).
9. `live-coedit` uses `startServer` from `test/unit/server-conformance/run-against.ts` (05-Q12).
10. Ledger: `api:blocks.scrollToBlock` → `view-only` (C14).

---

## 5. Decisions for the user

**D1. DECIDED 2026-10-08: Node AND C# Jint both in v1.** The user overrode the Node-only recommendation. Design in section 7. **D1a DECIDED 2026-10-08: option (b).** Stored and live C# paths both ship in v1. Stored is built first (section 7.6).

**D2. DECIDED 2026-10-08: yes, new package `@bloklabs/mcp`.** It needs `packages/mcp/`, `scripts/build-mcp.mjs`, a `scripts/release-manifest.mjs` entry, a root `build:mcp` script (a `package.json` edit, now approved), and an MCP SDK dependency (package name unverified). If Node's `WebSocket` cannot send an `Origin` header, 04 falls back to `ws`. `ws` 8.21.0 is in `node_modules` only as a transitive package, so `@bloklabs/mcp` would declare it.

**D3. DECIDED 2026-10-08: real-model evals run manually only, with token caps.** No nightly schedule. The workflow has `workflow_dispatch` only.
- Approved with it (round 3, R3-10): the user answered a question that stated the runner "needs new devDependencies, an API key secret and a model budget". So D3 covers: root `devDependencies` for a model SDK and an MCP client (exact package names chosen when the runner lands; unverified today), and one API key secret read only by the manual-dispatch workflow.
- Run count per full run (round 3): 15 tasks × 3 trials = 45 runs, plus a one-off 78 runs for the envelope-vs-full comparison (05 §3.3.7). Per-run and per-dispatch token caps stay.

**D4. DECIDED 2026-10-08: approved. Ship with a release note listing the new surface.** New public surface (additive, not breaking): `editor.agent`; `BlockMutationEventDetail.agent`; config key `BlokConfig.agent.overrides`; statics `describe` and `actionHandlers`; exports `buildToolManifest`, `validateAgainst`. Round 2 adds: `CollaborationParticipant.agent?` (optional field on a type shipped in `v1.16.1`, `types/events/editor-events.ts:56`; R2-03-5); published `InsertSpec`, `RichTextHelpers`, `BlokCustomToolsFile` types (R2-02-5, R2-04-17); and on NuGet `Blok.Server`, a new public interface `IBlokAgentExecutor` (section 7.3). One edge: a consumer who hand-implements the full `API` interface gets a TS error for missing `agent`, as with `media`, `viewState`, `marks`.
- The release note lists every item above, plus section 10's additions: `doc.setTitle` / `doc.setIcon` commands, the optional saved `page` field on `OutputData`, and the awareness field `agentCursor`.

**D5. DECIDED 2026-10-08: fix public `blocks.convert()` too, labelled BREAKING.**
- Confirmed breaking. `git tag --sort=-v:refname | head -1` → `v1.16.1`. `git log v1.16.1..HEAD -- src/components/modules/api/blocks.ts` lists `bb1f557f` and `474c8334`; neither diff mentions `convert`. At the tag, the same unsanitized call is at `src/components/modules/api/blocks.ts:748` and the raw spread at `block-mutation.ts:1740` (`git show v1.16.1:...`). So the gap shipped.
- Old behaviour: `convert(id, type, overrides)` writes `overrides` into the block unsanitized (only segments → HTML).
- New behaviour: `overrides` go through `hostDataForTool` (tool + global sanitize, unsafe URL strip), like `insert` and `update`.
- Migration: a host that passes markup outside the target tool's sanitize rules must widen those rules (the tool's `sanitize` or the global `sanitizer` config), or the markup is stripped.
- Commit: `BREAKING` in the subject and a `BREAKING CHANGE:` body with the three lines above. It ships as its own commit. `EditorApplier` then needs no private sanitize step for convert.

**D6. DECIDED 2026-10-08.**
- **Cut by the user:** file uploads (media is set by URL only); undo from Node in live rooms (`COMMAND_UNAVAILABLE`; C# room undo is cut with it, since it is the same "headless undo in a live room").
- **Kept in v1 by the user:** page title and icon commands, working headless too (section 10.1); the agent caret shown to collab peers (section 10.2).
- **Cut, user can revisit** (not shown to the user as options): view-state control; Docker image for MCP; custom tool action handlers outside the browser (Node and Jint).
- **Still cut by earlier resolutions, not by D6:** `caret.set` (C14); an MCP server inside the C# host and an HTTP route for the C# agent path (7.3).

---

## 6. Possible existing bugs found by the specs

| # | Claim (source) | Verdict | Evidence |
|---|---|---|---|
| B1 | `blocks.convert` does not sanitize overrides (01 §2.2) | **Verified by reading.** Not reproduced by a test. | `api/blocks.ts:777` only calls `richTextToHtml`. In `BlockMutation.convert`, the import string is sanitized (`block-mutation.ts:1721`), then raw overrides are spread over it (`:1739-1740`). The comment at `api/blocks.ts:776` says overrides reach the Yjs document before the factory runs. |
| B2 | `splitBlock` does not sanitize (01 §2.2) | **Verified by reading** for the API layer. | `api/blocks.ts:1048-1054` passes `richTextToHtml` output only. Whether `splitBlockWithData` sanitizes downstream is unverified. |
| B3 | No read-only guard on the API write path (03 §2.6) | **Absence verified.** Bug status unverified. | `api/history.ts:53`, `:63` and `api/saver.ts:28` check `ReadOnly.isEnabled`. `api/blocks.ts` has no such check (grep). Host writes in read-only may be intended. The agent executor guards itself either way (C18). |
| B4 | Embed URL submit never calls `dispatchChange` (02 §2.6) | **Unverified, likely not a bug.** | `submitUrl` → `resolveAndSet` (`src/tools/link/embed/index.ts:237-271`, `:839-863`) sets `this.data` and calls `renderState`, with no `dispatchChange`. But `renderState` calls `replaceChildren` on the tool root (`:421-445`), and no `data-blok-mutation-free` marker exists in the file. The mutation observer likely saves it. Needs a test. |
| B5 | Database view changes never call `dispatchChange` (02 §2.6) | **Plausible for `renameView`, unverified.** | `renameView` (`src/tools/database/index.ts:765-768`) updates the model and calls the host adapter sync only (`DatabaseBackendSync`, `:714`). It neither dispatches a change nor rebuilds the DOM. `reorderView` rebuilds the tab bar (`:814-818`). `deleteView` calls `switchView` or `rebuildTabBar` (`:805-811`). `addView`/`duplicateView` call `switchView` (`:762`, `:784`). So the observer may catch those. Needs a failing test first. |
| B6 | `/edit` Update doc comment says "last writer wins" | **Verified, doc-only.** | `CollabEditOps.cs:37` vs in-place `ReplaceData` at `YDocConverter.cs:1124-1185`. |
| B7 | Self-placing parents keyed by hard-coded names | **Verified code fact.** Impact unverified. | `SELF_PLACING_PARENTS = new Set(['table', 'database'])` (`src/tools/nested-blocks.ts:110`). A host that registers the table tool under another key may lose self-placement. |
| B8 | Local API writes do not keep the user's caret | **Verified that restore is remote-only.** Impact unverified. | `yjs-sync.ts:1316-1318` captures the caret only for `origin === 'remote'`. The local update path (`block-mutation.ts:316-320`) has no capture. |

---

## 7. Round 2: the C# Jint path in v1 (D1)

D1 puts headless execution in the C# server's embedded runtime as well as in Node. This section designs it. It replaces C1's "Jint deferred" lines.

### 7.1 What the embedded bundle must contain

The bundle has one entry, `src/view/server-runtime.ts` (`scripts/build-server-runtime.mjs:67`), built as an ES2020 IIFE (`:64-69`). Its `invoke` is already `async` and awaits the Markdown converter (`src/view/server-runtime.ts:375-378`). So async ports work in Jint today. Verified.

Added to the bundle, all imported by `server-runtime.ts`:

| Piece | From | Why |
|---|---|---|
| Planner, `JsonApplier`, view builder, `COMMANDS`, envelope validation | `src/shared/agent/` | executes batches |
| Validator | `src/shared/schema/validate.ts` | args and data checks |
| Descriptions, action impls, `buildToolManifest`, `buildAgentContract` | `src/shared/tool-descriptions/`, `src/shared/tool-actions/`, `src/shared/tool-manifest.ts` | the contract |
| `BUILT_IN_TOOL_RUNTIMES` and the moved sanitize rules | `src/shared/tool-descriptions/sanitize/` (02 R2) | sanitizing without tool classes |
| Headless ports | `src/view/agent-runtime.ts` | parse5 HTML → segments and the parse5 sanitizer; parse5 is already in the bundle (`src/view/rich-text-parse5.ts:1`) |

Not in the bundle: yjs, `DocumentStore`, `StoreApplier`, `EditorApplier`, any tool class, any host service.

Limits that apply:

- The generated bundle on disk is 689,655 bytes (`packages/server/dotnet/Blok.Server/Generated/blok-server-runtime.js`, `ls -la`; build time of that file unverified). The growth is unmeasured. 05 adds a size line to the build test.
- Every engine parses the bundle, about a second in total (`packages/server/README.md:150`). A larger bundle costs more at startup.
- Each call has a 10 s timeout and a 512 MiB allocation budget (`packages/server/dotnet/Blok.Server/Runtime/JintBlokRuntime.cs:16-30`). A batch on a very large document may hit them. Unmeasured.
- Whether every planner feature runs under Jint 4.16.4 is unverified. The existing build test runs the bundle in a globals-free realm; 01 extends it with an `agentExecute` round trip.

### 7.2 New Jint operations

```ts
// blokServerInvoke('manifest', JSON.stringify(input)) → JSON.stringify(output)
input:  { customTools?: BlokCustomToolsFile; overrides?: ManifestOverrides; services?: HostService[] }
output: { manifest: BlokToolManifest; contract: AgentContract }

// blokServerInvoke('agentExecute', JSON.stringify(input)) → JSON.stringify(output)
input:  { document: OutputData; batch: AgentBatch; actor: AgentActor;
          customTools?: BlokCustomToolsFile; overrides?: ManifestOverrides; services?: HostService[] }
output: { result: AgentResult; document: OutputData; edits: Edit[] }
```

- One `agentExecute` call is one batch. Read commands (`doc.read`, `doc.find`, `markdown.export`) run through it too.
- `edits` are the applied primitive edits. The live path (7.4) uses them.
- ~~Actions with a `prepare` step are unavailable in Jint.~~ Round 3 (R3-3): an action is `available: false` in Jint only when a `requires` service is absent. `prepare` runs in Jint with whatever services C# passed (normally none), so `uses`-only actions such as `image.setSource` work and store the URL as given. `effects: 'host'` actions never run inside Jint; C# runs them (R3-2). `runtime: 'editor'` commands are listed with `available: false`.
- Custom tools are JSON descriptions only, as in Node (02-Q8). No custom handlers in Jint.
- `history.undo` / `redo` return `COMMAND_UNAVAILABLE` (`reason: 'runtime'`). Jint is stateless per call.
- Revision: a hash of the canonical document JSON, the same function `JsonApplier` uses in Node. This holds for stored execution only. For rooms, see R3-5.

### 7.3 How C# exposes it

`IBlokDocumentConverter` is a public interface in the published `Blok.Server` NuGet package (`Documents/IBlokDocumentConverter.cs:112`; `Blok.Server.csproj:7`, `:13`). Adding a member breaks hosts that implement it. So the agent path is a **new public interface**, registered next to it:

```csharp
public interface IBlokAgentExecutor
{
  // Stored documents: the caller loads and saves.
  ValueTask<BlokAgentExecution> ExecuteAsync(
      string documentJson, string batchJson, BlokAgentActor actor,
      BlokAgentOptions? options = null, CancellationToken cancellationToken = default);

  // The contract for this server's tools, for a host that renders its own LLM tools.
  ValueTask<string> GetContractAsync(BlokAgentOptions? options = null, CancellationToken cancellationToken = default);

  // Live rooms (7.4). Present only when collab is on.
  ValueTask<BlokAgentExecution> ExecuteInRoomAsync(
      string docId, string batchJson, BlokAgentActor actor,
      BlokAgentOptions? options = null, CancellationToken cancellationToken = default);
}

public sealed record BlokAgentActor(string Id, string Name, string? OnBehalfOf = null);
public sealed record BlokAgentExecution(string ResultJson, string? DocumentJson, string Revision);
```

- `ResultJson` is an `AgentResult`. `DocumentJson` is set for stored execution.
- No new HTTP route in v1 (D6). Outside agents use `@bloklabs/mcp`. The C# path serves a .NET host's own backend agent.
- This is new public surface on NuGet, listed in D4.

### 7.4 Reaching live rooms from C#: options checked

**(a) A Y.Doc inside Jint.** Rejected.
- Rooms run on the C# Yjs port, not JS Yjs (`packages/server/dotnet/Blok.Server/Yjs/*.cs`; 04 §2.4).
- A JS Y.Doc in Jint would be a second copy. Each batch would encode the room doc, apply it in Jint, run the agent, and encode an update back. JS yjs under Jint is unverified. Bundle and allocation costs grow.
- Disproportionate for what (b) gives.

**(b) Translate `Edit[]` into C# room edit ops.** Recommended.

The room already has the exact shape needed. Version restore plans inside the room from the live doc, then applies ops:

- `CollabRoom.EditAsync` takes a `planOps: Func<YDoc, CancellationToken, ValueTask<IReadOnlyList<CollabEditOp>>>` plus an `actorId` and a precondition (`Collab/CollabRoom.cs:553-563`).
- Restore uses it: it exports the live doc with `converter.ExportAsync` and plans ops (`Collab/CollabRoomManager.cs:563-576`).
- `ApplyOpsAsync` validates every op before writing, in one transaction (`Collab/ICollabDocConverter.cs` docs on `ApplyOpsAsync`). A failed plan leaves the doc untouched. This is stronger than Node's `StoreApplier` (R2-01-2).
- The precondition compares the journal head (`CollabRoom.cs:676-684`), so `expectRevision` maps to `lineage:sequence` here.
- The `actorId` goes to the journal, so the agent is attributed in room history.

The C# agent path: `ExecuteInRoomAsync` → `room.EditAsync(planOps: export the live doc → Jint `agentExecute` → translate `edits` → ops, actorId: actor.Id, expect)`.

Mapping `Edit` → `CollabEditOp`:

| `Edit` | Today | Needed |
|---|---|---|
| `insert` (tree) | `Insert` per block, parent first, chained `After` (`CollabEditOps.cs:31-35`) | none |
| `remove`, `withChildren: true` | `Remove` takes the subtree by `parentId` (`CollabEditOps.cs:40-41`; `YDocConverter.cs:959-1045`) | none |
| `remove`, `withChildren: false` | — | `Move` each child into the slot, then `Remove` |
| `move` | — | new `Move` |
| `setData`, `setRichText` | `Update` replaces data key by key; rich text edits in place (`YDocConverter.cs:1124-1185`) | the translator composes the **full** new `data`, because `ReplaceData` deletes keys the new data lacks (`:1141-1149`) |
| `setTunes` | — | new `SetTunes` (or optional `tunes` on `Update`) |
| `replaceType` | — | new `Retype(id, type, data)`, keeping the block map, like `DocumentStore.replaceBlockContent` (`document-store.ts:751`). Restore today does remove + insert for everything else (`CollabRestorePlanner.cs:24-30`) |
| `lastEditedBy` / `lastEditedAt` | C# reads `lastEditedBy` from an inserted block (`YDocConverter.cs:2384-2386`) | a metadata step on `Update`/`Retype`/`Move` (unverified whether `Update` can write it today) |

What adding `Move` takes:

- A new internal record `Move(Id, After, Parent)` in `CollabEditOps.cs`. Internal only; not added to the `/edit` wire parser (`CollabEditOps.cs:235-251`). So no protocol change.
- `PlanMove` in `EditPlanner` (`YDocConverter.cs:634`). It checks the id exists, the target parent exists, and the target is not inside the moved subtree. The planner already indexes every `parentId` and child list (`:710-730`, `:784-797`).
- Steps: the existing `RemoveRootOrder` / `UnlinkChild` (`:1242`, `:1268`), a new `SetParentId` step, then the existing `InsertRootOrder` / `LinkChild` (`:1236`, `:1255`). No `RemoveBlock` / `PutBlock`, so the block map keeps its identity and a peer's concurrent edit inside it merges.
- Lockstep fixtures against `DocumentStore.moveBlockTo` (`document-store.ts:824`), the same way rich-text edits are kept in lockstep (`Collab/RichTextEdit.cs:21-31`).

Cost: one translator, four internal op kinds (`Move`, `SetParentId` step, `Retype`, `SetTunes`/metadata), and fixtures. This is moderate, not disproportionate.

Known gap of (b): the agent is **not a visible participant**. It has no socket, so no awareness entry and no frame-107 identity (04 §3.1). People see its edits and the journal names it. Whether an in-process edit feeds the room's activity records (`CollabRoom.cs:16-23`) is unverified. The brief's "agent joins as a participant people can see" is met only by the Node MCP path.

**(c) Stored documents only in Jint for v1; live rooms Node-only.** The scoped fallback. See D1a.

### 7.5 Tests for the C# path

- Build test (`test/unit/scripts/build-server-runtime.test.ts`): `manifest` and `agentExecute` round trips in the globals-free realm.
- C# tests beside `Runtime/JintBlokRuntimeTests.cs`: the 05 parity corpus through `IBlokAgentExecutor.ExecuteAsync`; output equals the Node `JsonApplier` golden.
- C# room tests: the corpus through `ExecuteInRoomAsync` on a scratch room; `ExportAsync` equals the Node `StoreApplier` golden. A `Move` while a second client types inside the moved block keeps both edits.
- A move-fixture lockstep test, C# `PlanMove` vs `DocumentStore.moveBlockTo`.

### 7.6 D1a — DECIDED 2026-10-08: (b)

The user chose (b). The two options as presented:


- **(b) full, recommended:** stored and live C# paths in v1. Build stored first, then live. Cost: section 7.4. The C# live agent is attributed but not a visible participant.
- **(c) scoped:** stored-only C# in v1 (`ExecuteAsync`, `GetContractAsync`). `ExecuteInRoomAsync` follows in a later release. Live rooms in v1 go through `@bloklabs/mcp` only.

Outcome: (b). `ExecuteAsync` and `GetContractAsync` land first, then `ExecuteInRoomAsync`. Both are v1.

---

## 8. Round 2: resolutions of "Issues with 06"

Ids: `R2-<spec>-<n>` is item n of that spec's "Issues with 06" section. Questions raised in the revised specs' own section 7 are included.

| Id | Issue | Verdict | Fix | Specs |
|---|---|---|---|---|
| R2-01-1 | `Edit` is not 1:1 onto `DocumentStore` | **Accept.** Verified: `removeBlock` deletes one map entry and order slots only (`document-store.ts:722-736`); `updateBlockData` writes one key and deletes a key only for `undefined` (`:1363`, `:1384-1394`). | `StoreApplier`: `remove withChildren` removes descendants deepest first; `withChildren: false` first `moveBlockTo`s each child into the slot. `setData` loops keys; a `null` in the patch is passed as `undefined`. C1 wording fixed. | 01 |
| R2-01-2 | No Yjs rollback when a live apply throws | **Accept.** Verified: `transact` runs cleanup in `finally` (`node_modules/yjs/src/utils/Transaction.js:431-447`), and cleanup emits `'update'` (`:364-370`). | Plan, dry run and apply run with **no await between snapshot and apply**, so no peer update lands in between. Apply runs in one `transact`. A throw returns `APPLY_FAILED` ("may be partly applied; re-read"), and the session goes read-only until reopened. The C# path is atomic (7.4). | 01, 04 |
| R2-01-3, R2-05-3 | C3 cites `document-store.ts:2244` for `JsonApplier` | **Accept.** | Citation fixed in C3. | — |
| R2-01-4 | What replaces `AgentChange` | **Accept the drop.** | Nothing replaces it. Consumers use `AgentResult.changed` (03 presence, 04 awareness) and `BlockMutationEventDetail.agent` (host `onChange`). 03 and 04 confirm they need nothing else. | 01, 03, 04 |
| R2-01-5, R2-03-2 | When `CANCELLED` fires; `stop()` during `prepare` | **Accept.** | `execute(batch, { signal })`. `CANCELLED` is checked at three points: before start, after `prepare`, and right before apply. Never during apply. If `prepare` already did host work, the `CANCELLED` error carries `details.orphaned` (the same data as `ORPHANED_SIDE_EFFECT`). `turn.stop()` aborts `turn.signal`, which every `turn.execute` passes. | 01, 03 |
| R2-02-1 | `ToolRuntime.sanitize` is per config, not per tool | **Accept.** Verified merge: `block.ts:562-617`, `tools.ts:528-570`, global at `api/blocks.ts:980-988`. | Only each tool's **own** rules move to `src/shared/`. `buildToolRuntimes(config)` composes the effective config per registry. 01 rebuilds it lazily per batch, cached on `AgentContract.revision` (answers 02 §7.2 Q2). | 01, 02 |
| R2-02-2 | `BLOCK_COLOR_SANITIZE` lives in a DOM-heavy file | **Accept.** Verified: defined at `src/components/shared/block-color.ts:33`, which imports icons and the color picker (`:14-15`); paragraph spreads it (`src/tools/paragraph/index.ts:484-486`). Also used by toggle, header, table-of-contents, toolbox (grep). | Move `BLOCK_COLOR_SANITIZE` and `INLINE_TEXT_SANITIZE` to `src/shared/`. `block-color.ts` re-exports them so existing imports keep working. | 02 |
| R2-02-3 | `prepare` side effects on a failed batch | **Accept.** | An action whose `prepare` changes the world outside the document declares `effects: 'host'`. Such an action must be the **only** command in its batch, else `INVALID_ARGS` with a message. Then nothing can fail after its host call. `prepareInsert` keeps 01's `ORPHANED_SIDE_EFFECT` rule. | 01, 02 |
| R2-02-4 | Fate of the Jint `manifest` op | **Resolved by D1.** | `manifest` ships in v1 (7.2). | 02 |
| R2-02-5 | `InsertSpec` / `RichTextHelpers` not placed | **Accept.** | Both are hand-authored and published in `types/agent.d.ts`. Listed in D4. | 01, 02 |
| R2-03-1 | Field → input map vs `lastRange` | **Accept.** | Single-input blocks map to input 0. Multi-input blocks put the agent caret at block level. No field map in v1. | 03 |
| R2-03-3 | `close()` vs `end()` / `stop()` | **Accept.** | On a turn, `close()` is `end()`. | 03 |
| R2-03-4 | Two `kind` fields; "for <name>" needs a name | **Accept.** | Awareness field becomes `agent: { via: 'mcp'; onBehalfOf: string; onBehalfOfName?: string }`. 03 shows `onBehalfOfName`, else resolves the participant row by id, else shows nothing. | 03, 04 |
| R2-03-5 | `CollaborationParticipant.agent` not in D4 | **Accept.** Verified the type shipped (`types/events/editor-events.ts:56`; present at `v1.16.1`). | An optional field is additive. Added to D4. | 03 |
| R2-03-6 | Offsets after an embed may differ from `CaretPosition` | **Accept as unverified.** `CaretPosition` counts DOM text (`caret-position.ts:54-61`, per 03). | Contract units stay (C12). 03 converts at the boundary and adds a test with an embed before the range. | 03 |
| R2-03-7 | Error code for a hidden action | **Accept.** | `UNKNOWN_COMMAND`. A hidden action is absent from the contract. | 01, 03 |
| R2-03-8 | `RenderedTool` as the public return type | **Accept 03's fix.** | `RenderedTool` stays internal. `editor.agent.tools()` uses overloads narrowed by `format`. | 03 |
| R2-04-1 | `expectRevision` in stored mode | **Accept.** | Stored (Node and Jint): a hash of the canonical document JSON, returned by the session. Live Node: the update counter (04-Q4). C# live: the journal head `lineage:sequence` (7.4). It is never the source's `savedVersion`. | 01, 04 |
| R2-04-2 | `DURABILITY_TIMEOUT` unreachable | **Accept.** | Removed from the union. A timed-out wait is `ok: true` with `delivery.pending: true`. | 04 |
| R2-04-3 | `ok: false` requires `revision` before a session exists | **Accept.** | `revision` is optional on `ok: false` (section 3.2). The renderer's MCP `outputSchema` for `blok_read` and `blok_describe` is `oneOf: [<success>, { error: AgentError }]`. `blok_execute` uses `AgentResult`. | 01, 03, 04 |
| R2-04-Q17 | Published type of a `--manifest` file | **Answer.** | `BlokCustomToolsFile = { formatVersion: 1; blocks: Array<{ name: string; description: BlockToolDescription; statics: ToolRegistrySnapshot['blocks'][number]['statics'] }> }` in `types/tool-manifest.d.ts`. The Jint `manifest` and `agentExecute` ops take the same file. | 02, 04 |
| R2-04-Q18 | Who emits the error branch | **Answer.** | The renderer (R2-04-3). 04 does not wrap. | 03, 04 |
| R2-05-1 | MCP and in-app command lists differ | **Accept.** | 05's compare removes `runtime: 'editor'` commands first. Parity runs those on `EditorApplier` only; headless runners expect `COMMAND_UNAVAILABLE`. | 05 |
| R2-05-2 | D3 run count | **Accept.** | 42 runs per full manual run, plus a one-off 72. Updated in D3. | 05 |
| R2-05-4 | 25 unnamed menu items vs `mirrors` | **Accept.** | Order: (1) name every unnamed `onActivate` item; (2) then 02 fills `mirrors`. The law's "menu items have names" assertion lands before the `mirrors` auto-cover. | 02, 05 |

---

## 9. Round 2 revision instructions

### 01 — Core commands (11 changes)

1. Restore the Jint path: `agentExecute` op (7.2), bundle contents (7.1), the build-test round trip.
2. `StoreApplier` mapping per R2-01-1.
3. Live atomicity per R2-01-2: no await between snapshot and apply; one `transact`; read-only after `APPLY_FAILED`.
4. `execute(batch, { signal })` and the three `CANCELLED` check points (R2-01-5).
5. Host-effect actions alone in their batch (R2-02-3).
6. Publish `InsertSpec` and `RichTextHelpers` in `types/agent.d.ts`.
7. `ToolRuntimeRegistry` lazy per batch, cached on contract revision (R2-02-1).
8. `revision` optional on `ok: false`; drop `DURABILITY_TIMEOUT`.
9. `expectRevision` meanings per runtime (R2-04-1).
10. Hidden action → `UNKNOWN_COMMAND`.
11. D5: the public `blocks.convert` fix ships as its own `BREAKING` commit with the regression test first; drop any private convert sanitize step from `EditorApplier`.

### 02 — Tool self-description (7 changes)

1. Move only each tool's own sanitize rules; `buildToolRuntimes(config)` composes (R2-02-1).
2. Move `BLOCK_COLOR_SANITIZE` and `INLINE_TEXT_SANITIZE` to `src/shared/`, re-exported from the old paths (R2-02-2).
3. Add `effects?: 'host'` to `ToolActionDeclaration`; set it on `page.rename`, `page.setIcon` (R2-02-3).
4. Restore the Jint `manifest` op and its test (D1, 7.2).
5. Publish `BlokCustomToolsFile` (R2-04-Q17).
6. Mark `prepare`/`requires` actions `available: false` in Jint.
7. `mirrors` filled only after menu items are named (R2-05-4).

### 03 — In-app surface (8 changes)

1. Turn passes `turn.signal` to every `execute`; `stop()` semantics per R2-01-5.
2. `close()` = `end()`.
3. Caret: input 0 or block level (R2-03-1); embed-offset test (R2-03-6).
4. Read awareness `agent.via` / `onBehalfOfName` (R2-03-4).
5. `CollaborationParticipant.agent?` (pending D4).
6. Renderer: MCP `outputSchema` error branch for `blok_read` / `blok_describe` (R2-04-3).
7. `tools()` overloads by `format`; `RenderedTool` internal (R2-03-8).
8. Confirm `AgentChange` is not needed (R2-01-4).

### 04 — Outside surface (8 changes)

1. Drop `DURABILITY_TIMEOUT`; timeout → `delivery.pending`.
2. Pre-session errors: `ok: false` with no `revision`; lifecycle tools use the renderer's error branch.
3. `expectRevision` in stored mode = the session's content hash.
4. Awareness field `agent: { via: 'mcp', onBehalfOf, onBehalfOfName? }`.
5. `--manifest` file type = `BlokCustomToolsFile`.
6. Live apply: session goes read-only after `APPLY_FAILED` (R2-01-2).
7. Out-of-scope list: the C# path is now in v1 as a service API (7.3), not an MCP server; update §3.1 and §8 to say MCP stays Node-only.
8. Confirm `AgentChange` is not needed (R2-01-4).

### 05 — Coverage and evals (8 changes)

1. Bring back the Jint parity runner: corpus through `IBlokAgentExecutor.ExecuteAsync`, compared to the Node `JsonApplier` golden (7.5).
2. Add the C# room runner (D1a = (b), 7.5).
3. Remove `runtime: 'editor'` commands before the renderer compare; headless runners expect `COMMAND_UNAVAILABLE` (R2-05-1).
4. Workflow is `workflow_dispatch` only; token caps; run counts per D3.
5. Ordering: name the 25 unnamed menu items before `mirrors` auto-cover (R2-05-4).
6. Add a bundle-size line to the server-runtime build test (7.1).
7. Fix the C3 citation note.
8. Parity skips `history.undo` on Jint and live runners (`COMMAND_UNAVAILABLE`).

---

## 10. Round 2: features D6 kept in v1

### 10.1 Page title and icon, headless too

Facts checked:

- Commit `b679a115` adds a Yjs map `page` with `title` and `icon` (`src/components/modules/yjs/document-store.ts:166`, getter `:222`, `pageFromJSON` `:227-232`; helpers `readPageFields` / `writePageField` in `src/components/modules/yjs/page-fields.ts`). Verified.
- Commit `fb62db72` adds `YjsManager.getPageFields`, `loadPage`, `setPageField` (one undo step, typing runs merged) and `onPageChange` (`src/components/modules/yjs/index.ts:954-980`). Verified.
- Nothing calls `setPageField` or `getPageFields` yet outside that file (grep of `src/`). No public API exposes them. Verified.
- The saved format has no page field (grep of `types/data-formats/output-data.d.ts`). Verified.
- The C# converter knows only the `blocks` and `root` roots (`packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs:77-78`). A grep for `"page"` in `Collab/*.cs` hits only a page-mention check (`RichText.cs:375`). Verified.
- The `page` block's rename and icon call the host hooks `config.rename(pageId, title)` and `config.setIcon(pageId, icon)` for **another** page (`src/tools/page/index.ts:432-475`, `:489-521`). Verified.

There are two different things here. They get two different commands.

**A. This document's own title and icon: `doc.setTitle`, `doc.setIcon`.** New core commands (C15's reserved `doc.` names).

```ts
'doc.setTitle': { title: string }                 // '' clears
'doc.setIcon':  { icon: PageIcon | null }        // PageIcon from types/tools/page.d.ts:13
```

- New `Edit` op: `{ op: 'setPageField'; key: 'title' | 'icon'; value: string | PageIcon | null }`.
- Browser (`EditorApplier`): `YjsManager.setPageField` (`yjs/index.ts:963-974`). It is already one undo step, so it joins the batch's group.
- Node live (`StoreApplier`): `writePageField(store.page, key, value)` in the batch's `transact`.
- Stored (Node `JsonApplier` and Jint): needs a saved slot. Add an optional top-level field `page?: { title?: string; icon?: PageIcon }` to `OutputData`. It is additive, and absent when empty. `DocumentStore` load and save carry it through `pageFromJSON` / `readPageFields`. `blokDocumentSchema` gains the property, so 02's "byte-identical" pin is updated once, on purpose. Listed in D4.
- C# live (7.4): a new internal op `SetPageField`, and `SeedAsync` / `ExportAsync` must read and write the `page` root. Today they do not. Lockstep fixtures against `page-fields.ts`.
- The document view (`doc.read`) returns `page: { title?, icon? }` at the top.
- Core has an internal `YjsManager.onPageChange` (`yjs/index.ts:976`). **No public page-change API in v1** (round 3, R3-8): the agent does not need it and it is not in D4's approved list. A host can ask for it later as new surface.

**B. Another page's title and icon: `page.rename`, `page.setIcon` (page-block actions).**

- Browser: unchanged. The action's `prepare` calls the host hooks; `effects: 'host'`, alone in its batch (R2-02-3).
- Headless: the target page is its own document (the page block holds a `pageId` pointer). So the headless action is a **cross-document write**: it opens the target document through the session's document source and runs `doc.setTitle` / `doc.setIcon` there.
  - Node MCP: the server opens the target with the same source and mode rules as `blok_open` (live room if a sync URL is set, else stored), using the same principal checks. Result: `{ pageId, applied: true }`.
  - C#: `IBlokAgentExecutor` gets an optional `IBlokPageTarget` callback from the host to resolve and open the target (stored JSON or room). Without it, the action is `available: false`. (Round 3: the single mechanism is the `pageBackend` host service, R3-2.)
- **Unverified:** whether hosts treat the target document's `page` map as the source of truth for a page's title. Today hosts store titles behind their own `rename` hook. So headless `page.rename` is **opt-in per deployment**: MCP option `pageTitles: 'page-map'` (default off → `available: false`), C# `BlokAgentOptions.PageTitles`. The README explains that the host must read titles from the page map for this to show up.

### 10.2 Agent caret shown to collab peers

Facts checked:

- The awareness `caret` is `{ blockId, inputIndex, anchor, head }`, and `inputIndex` counts the block's DOM inputs (`src/components/modules/collaboration/caret-position.ts:18-29`). Verified. A headless agent has no DOM inputs.
- New awareness information must go in a new field; old clients read existing fields by name (`src/components/modules/collaboration/presence.ts:314-322`). Verified.

**Design: a data-level cursor field that each browser maps locally.**

```ts
// New awareness field. Old clients ignore it.
agentCursor: {
  actorId: string;
  name: string;
  color?: string;
  blockId: string;
  field?: string;        // a data field of that block; absent = block-level
  start?: number;        // contract units (C12): UTF-16, one per embed
  end?: number;
} | null
```

- **Who publishes it.**
  - MCP agent (Node live): its own awareness, set from `AgentResult.changed` / `lastRange` after each batch. Cleared on `blok_close` and handle expiry.
  - In-app agent: the human's own client publishes `agentCursor` beside its normal `caret`, during a turn. One turn per editor (03), so one agent per client. Cleared on `turn.end()` / `stop()`.
  - C# live path: no awareness, so no cursor (7.4 gap stands).
- **How a browser draws it.**
  1. Map `field` to an input index with the tool's declared `inputFields` (below). If that works and offsets are present, draw a caret with the existing caret layer (`createCaretLayer`, 03), converting contract units to DOM offsets at the boundary (R2-03-6).
  2. Else draw a **block-level marker**: a name label and outline on the block's holder. Writing to a holder is allowed by the child-holder decoration law (CLAUDE.md).
- **Field → input map.** 02 adds `inputFields?: string[]` to `BlockToolDescription`: entry `i` is the data field DOM input `i` edits. Default when absent: a block with exactly one rich-text field maps it to input 0; anything else is block-level. Built-ins with several inputs (image caption, code filename, callout…) declare it, and a jsdom test per tool checks the order against the real `inputs`. **Unverified:** that every built-in's input order is stable across states.
- The same map serves 03's own agent caret (R2-03-1 becomes "map via `inputFields`, else block-level").
- `CollaborationParticipant.agent?` (R2-03-5) marks the participant row; `agentCursor` is the position.

---

## 11. Round 2b: per-spec additions from D1a, D4, D6

These add to section 9. Counts in parentheses are the new totals.

### 01 (16)

12. Add `doc.setTitle`, `doc.setIcon` and the `setPageField` edit; map it in all appliers and the C# translator (10.1 A).
13. `doc.read` returns `page`. `OutputData.page` load/save in `JsonApplier` and `DocumentStore` paths.
14. Cross-document execution for headless `page.rename` / `page.setIcon`: a session hook to open a target document (10.1 B).
15. `history.undo` in any live room (Node or C#) → `COMMAND_UNAVAILABLE` (D6).
16. Media commands take URLs only; no byte input anywhere (D6).

### 02 (11)

8. `inputFields?: string[]` on `BlockToolDescription`, declared for every multi-input built-in, with a jsdom order test (10.2).
9. `page.rename` / `page.setIcon`: headless form = cross-document `doc.set*`, opt-in via `pageTitles: 'page-map'` (10.1 B).
10. `blokDocumentSchema` gains the optional `page` property; re-pin the byte snapshot once (10.1 A).
11. `setSource` actions are URL-only; drop any byte path (D6).

### 03 (12)

9. Publish `agentCursor` from the human's client during a turn; clear on end/stop (10.2).
10. Draw peers' `agentCursor`: caret via `inputFields`, else block-level marker (10.2). Replaces R2-03-1's "input 0" rule.
11. Release-note list for D4 (03 owns `editor.agent` docs).
12. Remove "agent caret to peers" and "page fields" from out-of-scope.

### 04 (13)

9. Publish `agentCursor` in live mode; clear on close/expiry (10.2). Remove "no caret in v1" and "caret presence" from out-of-scope.
10. Page fields in both modes: live via `DocumentStore.page`, stored via `OutputData.page` (10.1 A). Remove the C15 cut.
11. Headless `page.rename` / `page.setIcon` with `--page-titles page-map` (10.1 B); the target opens under the same principal and mode rules.
12. Docker image and custom handlers: mark "cut, user can revisit".
13. Note the C# path is in v1 as a service API, stored first then live (D1a).

### 05 (13)

9. Parity cases for `doc.setTitle` / `doc.setIcon` on every runner, including C# (page root lockstep).
10. An eval task: "rename this page and set its icon".
11. `live-coedit` grader `agentVisible` also checks the peer sees `agentCursor` (block-level is enough).
12. Ledger: page title/icon UI items map to `doc.set*` / `page.*`; view-state items stay `exempt` with "cut, user can revisit".
13. C# runners run stored first, then room (D1a).

### C# server (owned by 01 + 04 until a server spec exists)

- `IBlokAgentExecutor`, the Jint ops, the translator, and the internal ops `Move`, `SetParentId` step, `Retype`, `SetTunes`/metadata, `SetPageField` (7.4, 10.1).
- `SeedAsync` / `ExportAsync` read and write the `page` root.

---

## 12. Round 3 (final): one rule per remaining conflict

Each rule is written into section 3 where it touches a shared shape. All five specs are edited to match in this round.

### R3-1. Availability and its error codes

- `buildAgentContract` computes `available` once, for the runner it is built for (`where.runtime`, `where.services`). Section 3.6.
- A command is `available: false` when: a `requires` service is absent (`reason: 'service'`); or it is `runtime: 'editor'` and the runner is headless, or it is `history.undo` / `redo` in Jint or a live room (`reason: 'runtime'`).
- Errors: `UNKNOWN_COMMAND` when the name is not in the contract (including hidden by overrides). `COMMAND_UNAVAILABLE` when it is in the contract with `available: false`. `SERVICE_UNAVAILABLE` and `UNSUPPORTED_IN_RUNTIME` are removed from the union. Section 3.2.
- Every renderer lists only `available: true` commands. The renderer's `runtime` option is removed. `blok_describe` still shows every command with its `available` flag. Section 3.7.
- Reason: one place decides availability, so the manifest, both renderers, Node, Jint and C# cannot disagree.

### R3-2. `page.rename` / `page.setIcon`: one availability mechanism

- Declaration (02): `runtime: 'any'`, `effects: 'host'`, `requires: ['pageBackend']`. Never `'editor'`.
- The `pageBackend` service is present when:
  - browser: the page tool's config has the `rename` / `setIcon` hooks it calls today (`src/tools/page/index.ts:432-475`, `:489-521`);
  - Node: `pageTitles: 'page-map'` is set and the session has the `openPageDocument` port (01 §3.13 B, 04);
  - C#: the host registered `IBlokPageTarget` and set `BlokAgentOptions.PageTitles` (01 §3.14).
- Otherwise `available: false`, `reason: 'service'`, `details.requires: ['pageBackend']`.
- Execution: an `effects: 'host'` action is alone in its batch. Its `prepare` runs in the host language: browser JS, Node JS, or C#. It **never runs inside Jint**. The C# executor sees the single-command batch and runs it in C# (01 §3.14), because a Jint call cannot call back into C# (01 found none; every op is one string-in, string-out call, `src/view/server-runtime.ts:375`, `:493`).

### R3-3. `prepare` in Jint

`prepare` runs in Jint with the services C# passes (`services` input on both Jint ops, section 7.2), normally none. An action is unavailable in Jint only per R3-1. So `uses`-only actions (`image.setSource`, `video.setSource`, `audio.setSource`, `file.setSource`, `audio.setCover`) run and store the URL as given. Async `prepare` is fine: `invoke` is already `async` (`src/view/server-runtime.ts:375`).

### R3-4. D5 covers agents too

`replaceType` in `EditorApplier` goes through the API-layer convert (`src/components/modules/api/blocks.ts:756-777`), where D5's fix lands. It never calls `BlockManager.convert` directly. So the one BREAKING fix sanitizes both host and agent overrides.

### R3-5. Revision per runtime

| Runtime | `revision` / `expectRevision` |
|---|---|
| Browser editor | counter bumped on every doc update (01) |
| Node live (`StoreApplier`) | counter over `DocumentStore.onAnyUpdate` |
| Node stored, Jint stored | hash of the canonical document JSON |
| C# live | the journal head `lineage:sequence`. `ExecuteInRoomAsync` strips `expectRevision` before Jint, passes it as the room precondition (`Collab/CollabRoom.cs:676-684`), and returns the journal head after commit. Jint's hash is never exposed for rooms. |

Revisions are opaque and only comparable within one runtime and one document.

### R3-6. `setPageField` and the batch undo step

`setPageField` calls `undoHistory.beginValueEdit` (`src/components/modules/yjs/index.ts:969-972`) before its `transact` (`:973`). Whether that joins the open tool transaction or splits it is **unverified**. 01 adds a test: a batch with `block.insert` + `doc.setTitle` is undone by one `history.undo`. If it splits, `EditorApplier` writes the page map with `writePageField` inside the batch's own transaction instead of calling `setPageField`.

### R3-7. Where C# headless page actions run

Accept 01 §3.14: in C#, outside Jint. C# reads `pageId` with a Jint `doc.read`, resolves the target with `IBlokPageTarget`, then runs a one-command `doc.setTitle` / `doc.setIcon` batch on the target with `ExecuteAsync` or `ExecuteInRoomAsync`.

### R3-8. Public page-change API

Not in v1. It is not needed by the agent and not in D4's approved list. 03 lists it as out of scope.

### R3-9. Sanitize rules for custom tools outside the browser

`BlokCustomToolsFile.blocks[].sanitize?` carries the tool's own sanitize rules as JSON (object and boolean rules only). Function rules cannot be written in the file. Without `sanitize`, the tool's rich fields get the global inline rules. Built-in tools need no file: their rules are code inside the Node build and the Jint bundle (02's moved rules).

### R3-10. Eval runner dependencies

Recorded under D3 (section 5): root `devDependencies` for a model SDK and an MCP client, and one API key secret for the manual-dispatch workflow. Approved.

### Closure of every "Issues with 06" item

| Spec item | Closed by | Spec edit |
|---|---|---|
| 01 #1 `doc.setTitle` / `doc.setIcon` missing from §3.1 | §3.1 updated | 01 already has them; issue removed |
| 01 #2 `effects` missing from §3.4 | §3.4 updated | issue removed |
| 01 #3 D5 and the convert path | R3-4 | 01 §3.4 already requires the API path; issue removed |
| 01 #4 stale C1 rationale | C1 updated | issue removed |
| 01 #5 `setPageField` undo | R3-6 (test; fallback) | issue removed; test stays in 01 §6 |
| 01 #6 code for `available: false` | R3-1 | 01 codes renamed to `COMMAND_UNAVAILABLE` |
| 01 #7 C# live revision | R3-5 | issue removed |
| 01 #8 where C# page actions run | R3-2, R3-7 | issue removed |
| 02 #1 §3.4 lacks `effects` / `inputFields` | §3.4 updated | issue removed |
| 02 #2 page actions runtime vs Jint | R3-2 | issue removed |
| 02 #3 `setSource` in Jint | R3-3 | 02 Jint rule narrowed |
| 03 #1 public page-change API | R3-8 | issue removed |
| 04 #1 stale §2 rows | §2 rows 01-Q2, 01-Q10, 02-Q7, 03-Q11, 04-Q5, 04-Q7, 04-Q8, 04-Q11, 04-Q12, 05-Q3, 05-Q10 marked superseded | issue removed |
| 04 #2 page actions dropped by the MCP renderer | R3-1, R3-2 | 04 renderer call drops `runtime` |
| 05 #1 three answers for unavailable commands | R3-1 | 05 codes renamed |
| 05 #2 run count | D3 updated | issue removed |
| 05 #3 eval devDependencies | R3-10 | issue removed |

Still open: none. Remaining items are implementation tests already labelled unverified (R3-6; section 7.1 bundle growth and Jint feature support; section 10.2 input order; section 10.1 B whether hosts read titles from the page map).
