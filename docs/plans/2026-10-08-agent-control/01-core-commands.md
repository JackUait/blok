# 01 — Core command layer + document view

Date: 2026-10-08. Builds on `00-brief.md`. Revised to match `06-reconciliation.md`, which is binding where they differ. Every claim about existing code cites `path:line`, read in this session. Anything not checked is labelled **unverified**.

Round 2: every user decision in 06 §5 (D1, D1a, D2–D6) is made. This spec states each outcome inline as "(D#)".

---

## 1. Purpose and success criteria

**Purpose.** Give every agent one way to read and change a Blok document: a typed list of meaning-level commands, plus a compact view of the document. The same planner runs in the browser editor, in Node, and in the C# server's Jint runtime, with no DOM.

**Success criteria.**

1. An agent can do every structural and text edit a human can, through commands. No Markdown is ever written into a rich-text field by accident. If it looks like Markdown, the agent is told.
2. A wrong command never fails silently. It returns a typed error that names the problem and the fix. If the sanitizer changed the content, or a tool was demoted, the result says so in a warning.
3. One `execute` call is atomic. Either every command in it lands, or none does.
4. In the editor, one `execute` call is one undo step. A human can undo the agent's edit with one Cmd+Z.
5. Agent edits are attributed. `lastEditedBy` names the agent on the blocks it touched, and only those.
6. The same command batch, run on the same document, gives the same saved JSON through every applier: `EditorApplier`, `JsonApplier` (Node and Jint), `StoreApplier`, and the C# room translator. A golden test pins this (section 6).
7. The view of a 500-block document fits a small token budget. The agent can page through it and read one subtree in full.
8. No command moves the user's caret, selection, focus or scroll.

---

## 2. What exists today

### 2.1 The public block API is index- and DOM-shaped, and it fails quietly

- `Blocks` (`types/api/blocks.d.ts:110-488`) mixes two eras.
  - Old, flat-index methods: `insert(type, data, config, index, needToFocus, replace, id, tunes, origin)` (`:265-275`), `move(toIndex, fromIndex)` (`:195`), `delete(index)` (`:183`).
  - New, tree-shaped methods: `insertAt` (`:291`), `create` (`:305`), `moveTo` (`:320`). These throw `BlockPlacementError` (`:40-43`).
- `move()` "changes nothing and only logs a warning" for a refused move (`types/api/blocks.d.ts:188-191`). An agent cannot see that.
- `BlockAPI` exposes `holder: HTMLElement` (`types/api/block.d.ts:79`). It is not usable without a DOM.
- `Marks` works only on DOM `Range`s and returns `HTMLElement`s (`types/api/marks.d.ts:90-146`). There is no "bold characters 4–12 of block Y" in the public API.
- `Caret` and `Selection` are DOM-only (`types/api/caret.d.ts:6-77`, `types/api/selection.d.ts:4-47`).
- The framework adapters' `useBlocks` core returns `null` or `[]` on most failures. Examples: `insertTree` (`src/components/utils/blocks-api.ts:600-669`), `insertMarkdown` (`:693-759`, with only a `console.warn` at `:732`). This is the "wrong path fails silently" problem from the brief.

### 2.2 Data from a host goes through one sanitizing path — almost always

- `hostDataForTool` (`src/components/modules/api/blocks.ts:946-961`) turns segments into HTML (`richTextToHtml`, `:933-938`). Then it runs the tool's sanitize config plus the global one (`sanitizeToolData`, `:980-988`). Then it strips unsafe URLs (`:960`). Legacy `items[]` and `body.blocks` are sanitized as the blocks they become (`:950-957`).
- `hostBlockDataForTool` (`:971-973`) runs the host's `config.migrations` first.
- `insert` (`:556`), `placeBlock` (`:631`), `insertMany` (`:823`), `insertInsideParent` (`:872`) and `update` (`:744`) all use it.
- **Gap:** `convert` passes `dataOverrides` through `richTextToHtml` only. It does not sanitize (`:776`). `splitBlock` is the same (`:1052-1054`). See 06 B1, B2.
- A block tool's base sanitize config is built from its enabled inline tools (`src/components/modules/tools.ts:528-570`, `src/components/tools/block.ts:605-617`). A tool's own field rule and the global `sanitizer` config can allow more (`block.ts:562-597`; `api/blocks.ts:980-988`). See 06 02-Q13.

### 2.3 Rich text is segments

- `RichText = RichTextSegment[]`, where a segment is `{ text, marks? }` or `{ embed, marks? }` (`types/rich-text.d.ts:31-53`).
- Marks are `bold | italic | underline | strikethrough | code | sup | sub | highlight | color | background | link`, plus `tag:<name>` for custom inline tools (`types/rich-text.d.ts:13-29`). Other keys are dropped on input with one warning (`src/components/utils/rich-text-input.ts:7-31`).
- Pure, DOM-free helpers already exist in `src/shared/rich-text/`:
  - `canonicalizeSegments` (`html-to-segments.ts:220`) and `inlineTreeToSegments` (`:263`).
  - `segmentsToHtml` (`segments-to-html.ts:163`).
  - `RICH_TEXT_FIELDS` per built-in type (`fields.ts:6-15`), `CURRENT_RICH_TEXT_FIELDS` (`:21`).
- HTML → segments is done by **injecting a parser**. The editor uses the DOM: `htmlToSegmentsDom` (`src/components/utils/rich-text-dom.ts:32`). Node uses parse5: `htmlToSegmentsNode` (`src/view/rich-text-parse5.ts:39`). Both feed the shared `inlineTreeToSegments`. **This is the pattern this spec reuses.**
- The collab write path diffs segments into a formatted `Y.XmlText`. One Y index is "a UTF-16 code unit of text, or one embed" (`src/components/modules/yjs/rich-text-write.ts:20-24`).
- The Yjs serializer renders a `Y.XmlText` to HTML (`src/components/modules/yjs/serializer.ts:953-955`). It can also read one as canonical segments: `readRichText` (`serializer.ts:414-417`).

### 2.4 Containment rules

- `child-tools.ts` holds the declared-contract helpers: `getChildToolRestrictions` (`src/components/utils/child-tools.ts:28-41`), `satisfiesChildToolRestrictions` (`:53-70`), `acceptsChildren` (`:76-77`), `isChildToolAllowed` (`:85-88`), `resolveChildTool` (`:99-109`).
- `resolveChildTool` **demotes** a disallowed tool to `allow[0]` or the default block (`:99-109`). This is right for an Enter key press. For an agent it is a silent wrong result.
- `block-placement.ts` holds `BlockPlacementError` (`src/components/modules/api/block-placement.ts:12-20`), `resolvePlacement` (`:103-...`) and `assertCanMoveUnder` (`:166-212`). Its refusals:
  - own subtree (`:169-171`), table-cell boundary (`:179-181`), parent takes no children (`:189-191`), parent owns its children (`:193-195`), old parent owns its children (`:197-199`), **column boundary** (`:201-203`), `childTools` (`:205-207`), restricted in a table cell (`:209-211`).
- **These rules need the DOM.** `isInsideTableCell` calls `holder.closest('[data-blok-table-cell-blocks]')` (`src/tools/table/table-restrictions.ts:83-91`). `cellOf` does the same (`block-placement.ts:152-153`). `BlockTree` is typed over the DOM-bound `Block` class (`:23-26`).
- `isRestrictedInTableCell` is a plain predicate (`src/tools/table/table-restrictions.ts:100-102`).
- Self-placing parents are a hard-coded name set: `SELF_PLACING_PARENTS = new Set(['table', 'database'])` (`src/tools/nested-blocks.ts:110`).
- **Moving into a column is refused.** `assertCanMoveUnder` throws "cannot move into or out of a column" (`block-placement.ts:201-203`). The comment says column membership is "drag UI only" (`:156-160`). So the brief's own example, "move Z into column 2", has no API today.
- Table cells name their blocks in the table's data: `CellContent.blocks: string[]` (`types/tools/table.d.ts:10-16`), inside `TableData.content: CellContent[][]` (`:29`).
- Tool statics that matter: `conversionConfig`, `ownsChildren`, `childTools`, `acceptsChildren`, `richTextFields`, `deletesChildren`, `isLayout` (`types/tools/block-tool.d.ts:230-400`, lines found by grep).

### 2.5 Undo grouping and origins

- A public API write calls `YjsManager.beginApiCall()` (e.g. `blocks.ts:527`, `:602`, `:742`). Outside a gesture, it opens a step of its own, which lasts until the end of the task (`src/components/modules/yjs/undo-history.ts:2143-2158`, `:2192-2201`).
- `blocks.transact(fn)` groups a synchronous function into one step (`blocks.ts:1072-1075`).
- `beginTransaction` / `endTransaction` hold one step open across awaits (`blocks.ts:1083-1093`). Underneath, `beginToolTransaction` calls `holdCapture()` (`src/components/modules/blockManager/blockManager.ts:1170-1182`), which sets the capture timeout to `Infinity` (`undo-history.ts:2419-2422`).
- `continueEntryThatCreated` merges the next write into the newest stack item by setting `undoManager.lastChange` (`undo-history.ts:1917-1930`). It is a precedent for a turn-merge lever.
- `UndoHistory` is wired to editor modules through `setBlok` (`undo-history.ts:1019`). Running it without an editor is unverified.
- `transactWithoutCapture` keeps repairs out of history (`blocks.ts:1099-...`).
- `trackedOrigins` is `{'local'}` (`undo-history.ts:393`).
- `BlockOrigin` is `'user' | 'api' | 'convert' | 'load' | 'replay' | 'paste' | 'probe'` (`types/tools/block-tool.d.ts:187`). `user`, `api` and `convert` are **creation** origins: a container tool may seed default children (`:171-176`).
- Yjs transaction origins: `TransactionOrigin` (`src/components/modules/yjs/types.ts:54-62`) and the local whitelist `LOCAL_ORIGIN_TAGS` (`:73-80`). An unknown origin is read as `'remote'` (`src/components/modules/yjs/block-observer.ts:193-195`).
- Undo stack items carry no metadata today. A grep for `.meta` in `undo-history.ts` finds nothing.

### 2.6 Attribution and collab

- `lastEditedBy` is set from `config.user.id` inside a write callback (`blockManager.ts:2689-2693`). That callback can run after an await (06 C3). The saved block carries it (`types/data-formats/output-data.d.ts:102-106`). In a room it is shared (`types/configs/blok-config.d.ts:1296-1310`).
- The block mutation event detail is built at emit time (`blockManager.ts:2118-2130`).
- In a room, `render`, `clear`, `renderFromHTML` and `importMarkdown` throw (`refuseWholesaleReplace`, `blocks.ts:265-282`). Markdown in a room must be additive.
- `insertMany` into a live document uses `yjsSync: 'add'` (`blocks.ts:841`). The default would wipe the document.
- A browser writes nothing back for a peer's block: `BlockRendered` uses `recordOnly: true` for it (`blockManager.ts:424`), and `recordOnly` writes nothing (`blockManager.ts:2454-2463`). Per 06 C17. So a headless author must write complete data itself.
- Only a remote rewrite restores the caret today: `captureCaretAcrossRewrite` runs only for `origin === 'remote'` (`src/components/modules/blockManager/yjs-sync.ts:1316-1318`).
- The sync wire has activity and identity frames 106 and 107 (`src/components/modules/collaboration/sync-wire.ts:38-39`).
- The C# server has a block edit endpoint, `POST /sync/{doc}/edit`. It knows only `Insert`, `Update` and `Remove` (`packages/server/dotnet/Blok.Server/Collab/CollabEditOps.cs:31-41`). It has no move and no text op.
  - **Correction.** The doc comment on `Update` says "last writer wins" (`CollabEditOps.cs:37`). The code does not do that for rich text. `ReplaceData` edits a live `YXmlText` in place and deep-assigns other containers (`packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs:1124-1185`). Only a key that is not yet a formatted text (e.g. a legacy plain string) is a whole-key set (`YDocConverter.cs:1153-1156`, comment). So `Update` is merge-safe for rich text. 06 B6 lists the stale comment.
  - It validates every op before it writes, in one transaction (`Collab/CollabDocConverter.cs:50-83`).
  - v1 does not change its public wire. The C# agent path adds internal room ops only (section 3.14).

### 2.7 What runs without a DOM today

- The server embeds one JS bundle, `Generated/blok-server-runtime.js` (`packages/server/dotnet/Blok.Server/Blok.Server.csproj:48-49`). It runs in Jint 4.16.4 (`:42-43`). It is built from one entry, `src/view/server-runtime.ts` (`scripts/build-server-runtime.mjs:67`). It holds no Y.Doc, no editor and no tools. Its ops are whole-document conversions only (`src/view/server-runtime.ts:377-483`). **There is no block-level edit today.** v1 adds `agentExecute` and `manifest` (section 3.14).
- `invoke` is already `async` and awaits the Markdown converter (`src/view/server-runtime.ts:375-378`). So async ports work in Jint today.
- Each Jint call has a 10 s timeout and a 512 MiB allocation budget (`packages/server/dotnet/Blok.Server/Runtime/JintBlokRuntime.cs:16-30`).
- `DocumentStore` (the Y.Doc wrapper) runs without an editor or a DOM. `downloadOfflinePage` builds one (`src/components/modules/collaboration/headless-offline-page.ts:32`). A Node test drives the real collab provider over the real store (`test/unit/server-conformance/blok-client-contract.test.ts:1`, `:14`, `:25`).
- `DocumentStore` write primitives (`src/components/modules/yjs/document-store.ts`):
  - `addBlockAt(blockData, placement)` (`:681`), `removeBlock(id)` (`:722`), `replaceBlockContent(id, type, data)` (`:751`), `moveBlockTo(id, placement)` (`:824`).
  - `updateBlockData(id, key, input)` (`:1363`) writes **one key**. It deletes the key only when the value is `undefined` (`:1388-1394`). It diffs rich text in place (around `:1464-1470`).
  - `updateBlockTune(id, tuneName, tuneData)` (`:2216`), `updateBlockMetadata(id, lastEditedAt, lastEditedBy)` (`:2244`).
  - `transact(fn, origin: LocalOriginTag)` (`:2281-2283`). `BlockPlacement` is `{ parentId, afterId }` (`src/components/modules/yjs/types.ts:22-25`).
  - `removeBlock` removes only that id from the map and from order arrays (`document-store.ts:722-736`). It does not touch children.
  - Each primitive opens its own `'local'` transaction (e.g. `:730`, `:2228`). Yjs runs a nested `transact` inside the outer one (`node_modules/yjs/src/utils/Transaction.js:415-433`, yjs 13.6.33). So one outer `transact` makes one update. Yjs has **no rollback**: on a throw, the `finally` still runs cleanup (`Transaction.js:434-446`), and cleanup emits `'update'` (`Transaction.js:366-370`). So what was written before the throw is committed and sent.
  - `onUpdate` skips remote updates (`document-store.ts:2399-2415`). `onAnyUpdate` sees every update (`:2428`).
- Other DOM-free building blocks:
  - `buildDocumentModel` normalizes a saved document into its flat-with-references tree (`src/view/document-model.ts:390`; purity contract `:1-10`).
  - `sanitizeHtmlFragment` is a DOM-free sanitizer with html-janitor semantics (`src/view/sanitize.ts:1-24`, `:767`). It runs function rules against an Element facade (`src/view/sanitize.ts:342`, `:410`).
  - `defineBlokSchema` resolves tool classes into a sanitize schema without instantiating them (`src/shared/sanitize-schema.ts:40-66`, `:220`).
  - `flattenTree` turns a nested spec into flat blocks (`src/shared/flatten-tree.ts`).
  - `diffOutputData` compares two saved documents (`src/view/diff-output-data.ts:132`).
  - `blokDocumentSchema`, JSON Schema of the saved format (`src/view/document-schema.ts:83`).
- `OutputData` has no page title or icon field today. Page fields live only in the Yjs `page` map: getter `DocumentStore.page` (`document-store.ts:222`), `pageFromJSON` (`:227`). Helpers `readPageFields` and `writePageField` are in `src/components/modules/yjs/page-fields.ts:25`, `:35`. `YjsManager` has `getPageFields`, `loadPage`, `setPageField`, `onPageChange` (`yjs/index.ts:954-980`). `PageIcon` is `{ type: 'emoji'; value } | { type: 'image'; url }` (`types/tools/page.d.ts:13`).
- **The view-entry law:** no module outside `src/view/` may import from `src/view/`, except `src/migrate/` (`test/unit/architecture/view-entry-law.test.ts:33-38`). parse5 stays inside `src/view/`. So shared command code cannot live in `src/view/`.
- **Unverified:** whether the built-in tool classes in `src/tools/*` import cleanly in Node. 02 moves only each built-in tool's **own** sanitize rules into `src/shared/`, and `buildToolRuntimes(config)` composes them, so Node and Jint do not need the classes (06 C10, R2-02-1).

### 2.8 Markdown

- In the editor: `blocks.importMarkdown` replaces the document (`blocks.ts:420-447`). `blocks.exportMarkdown` saves with `dialect: 'internal'` and serializes (`:454-498`). `useBlocks.insertMarkdown` is additive (`blocks-api.ts:684-...`).
- Without a DOM: `markdownToBlocksWithReport` (`src/markdown/index.ts:198`) and `blocksToMarkdownWithReport` (used at `server-runtime.ts:393-401`). Both report what degraded.

---

## 3. Design

### 3.1 Shape: one planner, three appliers, one C# translator

```
             ┌──────────────────── src/shared/agent/ (pure, no DOM, no parse5) ────────────────────┐
 commands ──▶│ validate args ─▶ resolve ids/refs ─▶ check rules ─▶ rich-text math ─▶ Edit[] (plan) │──▶ applier
 snapshot ──▶│        (uses BlokToolManifest + ToolRuntimeRegistry from 02, AgentPorts below)       │
             └──────────────────────────────────────────────────────────────────────────────────────┘
                                                                                                  │
          ┌──────────────────────────────────┬────────────────────────────────────────────────────┤
          ▼                                  ▼                                                    ▼
 EditorApplier                      JsonApplier (src/shared/agent/, pure)          StoreApplier
 (src/components/modules/agent/)    edits an in-memory OutputData;                 (src/components/modules/agent/)
 drives BlockManager +              the dry run everywhere, and the                writes a DocumentStore with
 hostDataForTool; browser           applier for STORED documents                   origin 'local'; LIVE rooms (Node)
                                    (Node and C# Jint)
                                                                    C# room translator: Edit[] from Jint → CollabEditOps (3.14)
```

- **Planner.** Pure and synchronous. It takes a document snapshot, the manifest, the tool runtimes, any `prepare` results and a batch. It returns either a typed error, or a plan: an ordered list of primitive `Edit`s plus warnings. It writes nothing.
- **Appliers.** They execute a plan.
  - `JsonApplier` edits a plain `OutputData`. It is pure. It is the dry run in every runtime. In Node and in Jint it is also the applier for stored documents: the dry-run output already is the result (06 C1).
  - `EditorApplier` edits the live editor through the existing internals, so tools, Yjs, undo and collab all see a normal API write.
  - `StoreApplier` writes a `DocumentStore` in Node, for live rooms. 04 runs it inside a Node socket member of the room (06 C1, 04).
- **Runtimes in v1** (D1, D1a). Browser, Node, and the C# server's Jint runtime.
  - Jint runs the planner and `JsonApplier` for stored documents. Jint has no Y.Doc (`src/view/server-runtime.ts:377-483`).
  - For a C# live room, Jint plans on an export of the room doc, and C# translates the returned `Edit[]` into internal room edit ops (section 3.14). Stored is built first, then live (D1a).
  - So the planner must stay pure and Jint-safe.
- **The public C# `/edit` wire does not change in v1.** New C# ops are internal only (3.14). Outside agents reach live rooms through the Node MCP socket member (06 01-Q1).
- **Ports.** What differs by runtime is injected, as `htmlToSegmentsDom` / `htmlToSegmentsNode` already are (section 2.3):

```ts
interface AgentPorts {
  /** HTML → segments. Editor: htmlToSegmentsDom. Node: htmlToSegmentsNode. */
  htmlToSegments(html: string): RichText;
  /** One block's data through the tool + global sanitize rules.
   *  Editor: hostDataForTool. Node: src/view/sanitize.ts with ToolRuntime.sanitize. */
  sanitizeBlockData(type: string, data: Record<string, unknown>): Record<string, unknown>;
  /** Editor: dynamic import of src/markdown. Node: the same module, bundled. */
  markdownToBlocks(md: string): Promise<{ blocks: OutputBlockData[]; warnings: AgentWarning[] }>;
  blocksToMarkdown(doc: OutputData): { markdown: string; warnings: AgentWarning[] };
  newId(): string;
  /** Headless page.rename / page.setIcon (3.13 B). Opens another page's document as a session.
   *  Absent → those actions are available: false. Editor: absent (the actions use host hooks). */
  openPageDocument?(pageId: string, actor: AgentActor): Promise<AgentSession & { close(): void }>;
}
```

Headless ports live in `src/view/agent-runtime.ts`. Function sanitize rules travel by reference in-process. No JSON form is needed in v1, in Node or in Jint, because both run the rules in the same JS realm (06 01-Q6).

**Tool runtimes.** `buildToolRuntimes(config)` (02) composes each tool's own sanitize rules with its enabled inline tools and the global `sanitizer` config, as the editor does (`block.ts:562-617`, `tools.ts:528-570`, `api/blocks.ts:980-988`). The executor builds the `ToolRuntimeRegistry` lazily per batch and caches it on `AgentContract.revision` (06 R2-02-1).

**Where the code lives** (06 §3.8).

| Piece | Path | Why there |
|---|---|---|
| Planner, `JsonApplier`, view builder, envelope validation, `COMMANDS`, `createDocumentAgentSession` | `src/shared/agent/` | Importable by the editor, by Node, and by the Jint bundle entry `src/view/server-runtime.ts`. Must not import `src/view/` (view-entry law) or touch the DOM. |
| `EditorApplier`, editor ports, `createEditorAgentSession` | `src/components/modules/agent/` | Needs BlockManager and YjsManager. |
| `StoreApplier`, `createStoreAgentSession` | `src/components/modules/agent/` | Needs `DocumentStore` and Yjs, so it cannot live under the agent purity law. |
| Browser API object (`editor.agent`) | `src/components/modules/api/agent.ts` | Owned by 03. |
| Headless ports (parse5) | `src/view/agent-runtime.ts` | parse5 sanitizer and parser live in `src/view/`. |
| Jint ops `agentExecute`, `manifest` | `src/view/server-runtime.ts` (new `invoke` cases) | The bundle's one entry (`scripts/build-server-runtime.mjs:67`). |
| C# executor and room translator | `packages/server/dotnet/Blok.Server/` (3.14) | Owned by 01 + 04 until a server spec exists (06 §11). |
| Public types | `types/agent.d.ts` (hand-authored, no `src/` imports) | Published-types law. |

**View-entry law change.** `src/mcp/` (04) must import `src/view/agent-runtime.ts`. The law gets a second exception for `src/mcp/`, with the same guard it has for `src/migrate/`: no other module may import `src/mcp/` (06 C13). Both 01 and 04 name this change. `@bloklabs/mcp` ships in v1 (D2).

### 3.2 Why the browser does not write the Y.Doc directly

In the **browser**, I do not run commands as raw `DocumentStore` writes:

- The editor reads a write with an unknown origin as remote, and BlockYjsSync then overwrites the tool's state (`block-observer.ts:193-195`, `yjs/types.ts:65-80`).
- Remote writes are not undoable by the local user.
- Tool lifecycle (`prepareInsert`, default children, `rendered()`) would be skipped.

None of these apply in **Node**. There is no editor and no `BlockYjsSync` there (06 C1). So `StoreApplier` writes the store directly, with origin `'local'`. `onUpdate` skips remote updates (`document-store.ts:2399-2415`), so a write tap on it sends only the agent's own work.

### 3.3 Execution of one batch

```
execute(batch, { signal })
 0. CANCELLED check #1: signal already aborted → CANCELLED.
    Read-only? Any write command → READ_ONLY. Reads still run.
 1. Check the envelope (shape, names, arg types)            → INVALID_ARGS / UNKNOWN_COMMAND.
    A hidden action is absent from the contract              → UNKNOWN_COMMAND.
    A host-effect command (effects: 'host') not alone        → INVALID_ARGS.
 2. Pre-plan on a first snapshot with placeholder ids. Nothing written.
 3. Async prep, nothing written to the document:
      - Markdown conversion for markdown.insert
      - each tool action's optional prepare(ctx, args) (section 3.12)
      - tool prepareInsert for block types whose manifest entry has insertRequires
 4. CANCELLED check #2 (after prep). If prep did host work, details.orphaned carries it.
 5. Fresh snapshot → plan → validate → dry run → CANCELLED check #3 → apply.
    No await from this snapshot to the start of apply (live and stored).
      snapshot: editor  YjsManager.toJSON() (flushes buffered writes first, yjs/index.ts:386-390),
                        then rich fields → segments (see "Snapshot dialect")
                stored  the session's OutputData (rich fields already segments, see "Loading")
                live    the session DocumentStore, rich fields read as segments
      plan:     planner(snapshot, batch, prepared) → Edit[] + warnings, or the first error
      validate: what the plan wrote (02-Q3 scope, below)
      dry run:  JsonApplier(snapshot, plan); any failure → error, nothing written
      apply:    stored  the dry-run result IS the result
                editor  one undo group (3.6), touched-block attribution (3.7)
                live    one DocumentStore.transact(…, 'local') (3.4)
 6. Read back: new revision, refs, changed set, lastRange, warnings. Append to the session log.
```

**Cancel** (06 R2-01-5). `CANCELLED` is checked at three points: before start, after prep, and right before apply. Never during apply. If prep already did host work, the `CANCELLED` error carries `details.orphaned`, the same data as `ORPHANED_SIDE_EFFECT`. 03's `turn.stop()` aborts the signal every `turn.execute` passes.

**Host-effect actions** (06 R2-02-3). An action whose `prepare` changes the world outside the document declares `effects: 'host'` (02). It must be the **only** command in its batch, else `INVALID_ARGS` with a message saying so. Then nothing can fail after its host call. `prepareInsert` keeps the `ORPHANED_SIDE_EFFECT` rule below.

**Read-only guard.** The executor refuses every write command with `READ_ONLY` before planning (step 0). A live session that hit `APPLY_FAILED` is read-only from then on, until reopened. This is the one guard for every surface. Today `api/history.ts:53`, `:63` and `api/saver.ts:28` check `ReadOnly.isEnabled`, but `api/blocks.ts` does not (06 C18). The executor does not rely on the public API to guard.

**Post-write validation scope.** After planning, the executor validates against the manifest `data` schema (02):

- the keys each `setData` edit wrote;
- the whole `data` of each inserted block.

It does not re-validate untouched legacy keys of existing blocks (06 02-Q3). A plain write to a `viewState` or `guardedFields` key fails with `FIELD_NOT_WRITABLE`, `details.reason: 'view-state' | 'guarded'`, `details.use` naming the action to use.

**Atomicity.** Nothing before apply writes the document.

- Editor: apply runs inside one undo group (section 3.6). If an apply call still throws (a tool bug), the applier closes the group, undoes it, and returns `APPLY_FAILED`. **Unverified, and weaker than the dry run:** that undoing a half-applied group restores the document exactly, given that some applier calls are async (3.6). A test must pin it. Until then, `APPLY_FAILED` says "the document may be partly changed; re-read it".
- Live Node (06 R2-01-2): there is no await from the fresh snapshot to the start of apply, so no peer update lands between plan and apply. The whole plan runs in one outer `transact`. Yjs has no rollback (`Transaction.js:434-446`, `:366-370`). So a throw mid-apply leaves partial writes, and they are sent to the room. `StoreApplier` returns `APPLY_FAILED` ("may be partly applied; re-read"), and the session goes read-only until reopened. The dry run is the real guard.
- Stored (Node and Jint): the dry run is the apply, so it cannot half-apply.
- C# live: atomic. `ApplyOpsAsync` validates every op before it writes, in one transaction (3.14).

**`prepareInsert` and `prepare` have side effects.** A `page` block's `prepareInsert` asks the host to create a page (`types/api/blocks.d.ts:293-305`). If the batch then fails, that page is orphaned. Rule: run step 3 only after steps 0–2 pass, including the placeholder-id pre-plan. Then patch the real ids in and plan again in step 5. If the batch still fails, report `ORPHANED_SIDE_EFFECT` with the host's id, so the host can clean up.

**Snapshot dialect (editor).** Verified: the Yjs serializer renders a `Y.XmlText` to HTML (`serializer.ts:953-955`). The planner works on segments only. So the snapshot step reads rich fields as segments with `serializer.readRichText` (`serializer.ts:414-417`) where it can reach the `Y.XmlText`. Otherwise it runs the string through `ports.htmlToSegments`.

**Snapshot freshness (editor).** **Unverified:** whether `YjsManager.toJSON()` includes typing whose DOM-driven save is still in flight. If it can lag, the EditorApplier must await the pending saves first (`YjsManager.onPendingBlockWritesSettled`, `yjs/index.ts:781`).

**Loading (Node and Jint).** The loader turns HTML rich fields into segments with `htmlToSegmentsNode`. Sanitize runs on `src/view/sanitize.ts` (parse5) (06 04-Q6). It also loads the optional `OutputData.page` (3.13).

### 3.4 Primitive edits (the plan)

Every command, including tool actions from spec 02, becomes a list of these. Appliers implement only these.

```ts
type Edit =
  | { op: 'insert'; block: PlannedBlock; parentId: string | null; afterId: string | null }
  | { op: 'remove'; id: string; withChildren: boolean }        // false: children move up into the slot
  | { op: 'move'; id: string; parentId: string | null; afterId: string | null }
  | { op: 'setData'; id: string; patch: Record<string, unknown> } // shallow merge; null deletes a key
  | { op: 'setRichText'; id: string; field: string; value: RichText } // full field, applier diffs it
  | { op: 'setTunes'; id: string; tunes: Record<string, unknown> }
  | { op: 'replaceType'; id: string; type: string; data: Record<string, unknown> } // convert
  | { op: 'setPageField'; key: 'title' | 'icon'; value: string | PageIcon | null }; // this document's page fields (3.13)

interface PlannedBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;      // already sanitized and normalized, rich fields as segments
  tunes?: Record<string, unknown>;
  children: PlannedBlock[];           // always explicit; see 3.5
}
```

**Self-placed parents.** Tables and databases place their own children in cells and views (`src/components/modules/blockManager/block-insertion.ts:1109-1110`, `isSelfPlacedParent`). `blocks.insertAt` keeps a separate index path for them (`blocks.ts:617-621`). The generic `insert` edit cannot know which cell or view a child belongs in. So the planner refuses a `block.insert` or `block.move` whose parent's manifest entry has `selfPlacesChildren` (`PLACEMENT_REFUSED`, reason `SELF_PLACED_PARENT`). The hint names the tool actions that do it (02, e.g. `table.insertIntoCell`, `database.addRow`). Those actions emit both the child insert and the parent's data change. The editor applier runs them through `insertInsideParent`, as `placeBlock` does.

**Tool-minted data.** A headless author must write complete data, because no browser fills the gaps for a peer's block (section 2.6). So the planner runs each tool's pure `ToolRuntime.normalize(data)` (02) on inserted and changed data. The table's column and row ids are the known case (`types/tools/table.d.ts:12-14`). Table `normalize` is a **v1 blocker for live mode** (06 C17). Until a tool has `normalize`, the parity test ignores a listed set of its minted fields, each with a reason.

`EditorApplier` mapping (all existing internals):

| Edit | Editor call |
|---|---|
| `insert` (leaf or tree) | `BlockManager.insertMany(..., { notify: true, yjsSync: 'add' })` with explicit `content`, as `blocks.insertMany` does (`blocks.ts:802-846`) and as `useBlocks.insertTree` uses it (`blocks-api.ts:654-658`). Self-placed parents: `insertInsideParent`, above. |
| `remove` | `BlockManager` removal by id (same path as `blocks.delete`) |
| `move` | `BlockManager.moveTo(block, { parentId, afterId })` (`blocks.ts:682`) |
| `setData`, `setTunes` | `BlockManager.update(block, hostDataForTool(...), tunes)` (`blocks.ts:744`) |
| `setRichText` | the same `update`; the Yjs layer diffs segments into `Y.XmlText` (`rich-text-write.ts`), so a peer's typing elsewhere in the field survives |
| `replaceType` | the same path public `blocks.convert` uses (`api/blocks.ts:774-776`), after the D5 fix sanitizes overrides there. No private sanitize step. It must not call `BlockManager.convert` directly, which sits below that sanitize. |
| `setPageField` | `YjsManager.setPageField(key, value)` (`yjs/index.ts:963-974`) |

**Database blocks have no `setData`.** So `BlockMutation.update` takes the recompose path for them, not the in-place one (`src/components/modules/blockManager/block-mutation.ts:316-320`, gate on `supportsInPlaceSetData`). **Unverified:** whether recompose keeps database rows attached. Section 6 adds a test. The fallback fix is a `setData` on the database tool (06 02-Q4).

**Caret.** When an edit rewrites the block that holds the user's caret, `EditorApplier` wraps it with the same `captureCaretAcrossRewrite` the remote path uses (`yjs-sync.ts:1316-1318`). Today a local API write has no such capture (06 B8, 03-Q5). Every internal `scrollToBlock` call passes `{ select: false }`.

`StoreApplier` mapping. All calls run inside one `store.transact(fn, 'local')` (`document-store.ts:2281`). Placement is `{ parentId, afterId }` (`yjs/types.ts:22-25`).

| Edit | `DocumentStore` call |
|---|---|
| `insert` | `addBlockAt(block, { parentId, afterId })` (`:681`) for the block, then for each child in order, depth-first |
| `remove`, `withChildren: true` | `removeBlock(id)` (`:722`) for each descendant, then the block |
| `remove`, `withChildren: false` | `moveBlockTo(child, …)` (`:824`) for each child into the block's slot, then `removeBlock(id)` |
| `move` | `moveBlockTo(id, { parentId, afterId })` (`:824`) |
| `setData` | `updateBlockData(id, key, value)` (`:1363`) once per patch key. A `null` in the patch is passed as `undefined`, which deletes the key (`:1388-1394`; 06 R2-01-1). |
| `setRichText` | `updateBlockData(id, field, segments)`. It diffs rich text in place (around `:1464-1470`). |
| `setTunes` | `updateBlockTune(id, name, value)` (`:2216`) once per tune |
| `replaceType` | `replaceBlockContent(id, type, data)` (`:751`). Keeps id, position, children and tunes. |
| `setPageField` | `writePageField(store.page, key, value)` (`page-fields.ts:35`, `document-store.ts:222`) |
| (every touched id) | `updateBlockMetadata(id, now, actor.id)` (`:2244`) |

`removeBlock` does not touch children (`:722-736`), which is why `remove` needs the extra steps above. With `withChildren: true`, descendants are removed deepest first.

`JsonApplier` (Node and Jint) writes `setPageField` into the optional `OutputData.page` (3.13). The C# translator mapping is in 3.14.

### 3.5 Rules the planner enforces

**Refuse, never demote.** If a parent does not allow the tool, the planner returns `PLACEMENT_REFUSED` with reason `CHILD_NOT_ALLOWED` and the list of allowed tools. It does not call `resolveChildTool`. An agent may pass `demote: true` to get the editor's behaviour, and then gets a `DEMOTED` warning.

**Same rules, from data.** The planner re-implements `assertCanMoveUnder` and the insert checks over the snapshot, not over `Block`. Its inputs come from the `BlokToolManifest` entry (02):

| Rule today | Data source in the planner |
|---|---|
| `isChildToolAllowed`, `acceptsChildren` (`child-tools.ts:76-88`) | manifest `children` (`allow`, `deny`, accepts) |
| `ownsChildren` (`block-placement.ts:193-199`) | manifest `children.ownedByTool` |
| table cell membership (`table-restrictions.ts:83-91`) | a block is in a cell if some table's `data.content[r][c].blocks` lists its id (`types/tools/table.d.ts:10-29`) |
| restricted in a cell (`isRestrictedInTableCell`, `table-restrictions.ts:100-102`) | manifest `restrictedInTableCell` |
| self-placing parent (`nested-blocks.ts:110`) | manifest `selfPlacesChildren` |
| own subtree, not a child of parent (`block-placement.ts:117`, `:169-171`) | snapshot tree |

To keep the two copies honest, the predicates move into `src/shared/agent/placement-rules.ts` over a small `TreeView` interface. `block-placement.ts` then calls them with a `Block`-backed `TreeView`. One rule set, two adapters. A parity test runs both on the same fixtures.

**Columns** (06 01-Q7).

- Moving an existing block into or out of an existing column is core `block.move`. This needs one core change: `assertCanMoveUnder` gets an option to skip the column rule (`block-placement.ts:201-203`), used only by the agent appliers. `blocks.moveTo` keeps throwing, so nothing public changes.
- Creating columns and side-drop are `column_list.*` actions (02).
- Emptied-column cleanup is one pure helper. Both `block.move` and the `column_list.*` actions use it.

**Children are explicit.** `api` is a creation origin, so a container tool may seed default children when the editor inserts it (`types/tools/block-tool.d.ts:171-176`). The JSON and store appliers never seed. To keep the runtimes equal:

- If the agent passes `children`, those are the children. Nothing is seeded.
- If the agent omits `children`, the planner fills in the tool's `ToolRuntime.defaultChildren` (02, 06 01-Q4).
- The EditorApplier always inserts with explicit `content`. **Unverified:** that every built-in container skips seeding when its block arrives with non-empty `content` under origin `api`. A parity case per container is required (section 6). If one does not, the fix is in that tool.

**Sanitize everything.** Every rich field and every data string goes through `ports.sanitizeBlockData`. In the editor that is `hostDataForTool`. In Node it is `src/view/sanitize.ts` with `ToolRuntime.sanitize`. When sanitizing changes a value, the result carries a `SANITIZED` warning naming the block and field.

**Markdown look-alike guard.** If a `text.*` or `block.insert` string contains Markdown syntax (`**x**`, `# `, `- ` at a line start, `[a](b)`, backticks), the command still runs, and the result carries `LOOKS_LIKE_MARKDOWN`. The hint says: use `marks`, or use `markdown.insert`. This targets the exact failure in the brief.

**Opaque blocks.** A block whose type is not registered appears in the view with `opaque: true`. Only `block.move` and `block.delete` accept it. Any other command on it returns `UNKNOWN_TOOL` (06 §3.3).

### 3.6 Undo

**Editor: one step per `execute`.**

- Some applier calls are async: `BlockManager.update` (`blocks.ts:744`) and `BlockManager.convert` (`blocks.ts:776`) are awaited. So a synchronous `transactForTool` bracket cannot hold them.
- The editor apply (step 5) is bracketed by `BlockManager.beginToolTransaction()` and `endToolTransaction()`, as `blocks.beginTransaction` does (`blocks.ts:1083-1093`), wrapped in `YjsManager.joinMovesToStep` for moves (`blocks.ts:1074`). `endToolTransaction` closes the group only after pending block writes settle (`blockManager.ts:1205-1235`, via `onPendingBlockWritesSettled`). **Unverified:** that the writes of an awaited `update`/`convert` started inside the bracket land in the group. A test must pin it.
- All other async work (Markdown, `prepare`, `prepareInsert`) happens in step 3, before the group opens. The bracket spans only the applier's own awaits, never a model call.
- **Known risk:** if the user types during those few awaits, the keystrokes can join the agent's step. The window is short (no network, no model). A test should measure it.
- Capture is never held across a model call. `beginToolTransaction` sets the capture timeout to `Infinity` (`undo-history.ts:2419-2422`). Held across a model call, it would pull the user's own typing into the agent's step.

**Editor: turn merge** (06 C11, 03-Q3). An agent often makes several `execute` calls in one turn. A batch joins the turn's previous step only if:

- that step is still the top of the undo stack, and
- no user gesture started since.

Otherwise it opens a new step. The candidate lever is the one `continueEntryThatCreated` uses (`undo-history.ts:1917-1930`). **The lever is unverified.** `beginApiCall` starts a discrete gesture when nothing holds capture (`undo-history.ts:2143-2158`), which may split the step before a merge can land. Tests must pin R-U1 and R-U3 (03) before this is called done.

**Own steps only.** `history.undo` from an agent undoes only that session's last step, and only if it is on top of the stack. Otherwise: `UNDO_NOT_OWN`. This stops an agent from undoing the human's typing.

**Node, stored mode.** The session keeps the pre-batch snapshot of each `execute`. `history.undo` restores it. 04 saves the result with `ifVersion`.

**Jint.** `history.undo` / `redo` return `COMMAND_UNAVAILABLE`. Jint is stateless per call; the C# caller owns any snapshot (06 §7.2).

**Any live room, Node or C#.** `history.undo` and `history.redo` return `COMMAND_UNAVAILABLE` in v1. The user cut headless undo in live rooms (D6). A snapshot restore would erase peers' concurrent edits.

**New internal lever needed:** undo steps must be able to carry `{ actor, sessionId }`, so the session can tell its own steps apart and 03 can label "Undo agent edit". There is no step metadata today (section 2.5).

### 3.7 Attribution and origin

- A session has an `actor: AgentActor` (section 5.1).
- **Browser: per touched block, not a global flag** (06 C3). The `lastEditedBy` stamp runs inside a write callback that can run after an await (`blockManager.ts:2689-2693`). A global "acting author" flag would mislabel the human's typing in that window. So:
  - The applier holds the set of block ids the batch touches until its undo group closes.
  - A write to one of those ids stamps `actor.id`. Any other block keeps the human's `config.user.id`.
  - Mutation events built for those ids carry `detail.agent = { id, name, turnId }` (new public field, approved in D4). The detail is built at emit time (`blockManager.ts:2118-2130`), so the field survives batched delivery. `origin` stays `'local'`.
- **Node.** `StoreApplier` stamps `lastEditedBy`/`lastEditedAt` with `updateBlockMetadata` (`document-store.ts:2244`). `JsonApplier` (Node and Jint) writes the two fields on the touched `OutputBlockData` directly.
- **C# live.** The room edit takes `actor.Id` as its `actorId`, so the journal names the agent (`Collab/CollabRoom.cs:553-563`). Writing `lastEditedBy` on updated blocks needs a metadata step (3.14).
- **Rooms** (04 owns these, listed so the split is clear):
  - MCP agent: the ticket `user` must equal `actor.id`. The journal and frame 107 then name the agent.
  - In-app agent in a room: it rides the human's socket. The journal names the human, while `lastEditedBy` names the agent. This split is accepted.
- No new `BlockOrigin` and no new transaction origin. Tool constructors see `origin: 'api'`. Adding a member to `BlockOrigin` could break a consumer's exhaustive `switch`. An unknown transaction origin reads as remote (`block-observer.ts:193-195`), and only `'local'` is tracked by undo (`undo-history.ts:393`).

### 3.8 Collab safety

- Markdown is always additive. There is no "replace the document" command. `blocks.importMarkdown` is refused in rooms anyway (`blocks.ts:265-282`).
- Every editor insert uses `yjsSync: 'add'` (`blocks.ts:841`).
- **Optimistic checks.** A batch may carry `expectRevision`. A text range may carry `expectText`. A mismatch returns `STALE`, and nothing is written. `STALE.details.current` holds the fresh outline entries (and field text) of the blocks the check named. Positions are ids, not child indexes (06 03-Q2). Offsets go stale in a live room. Ids do not.
- **Revision.** An opaque string, never a state vector, and never the source's `savedVersion` (06 04-Q4, R2-04-1). What `expectRevision` compares against:
  - Editor: a counter bumped by `YjsManager.onAnyDocUpdate` (`yjs/index.ts:1304`).
  - Live Node: a counter over the session store's updates, `DocumentStore.onAnyUpdate` (`document-store.ts:2428`). In a busy room it goes stale fast, so agents should prefer `expectText`.
  - Stored, Node and Jint: a hash of the canonical document JSON, one shared function, returned by the session.
  - C# live: the room journal head `lineage:sequence`. It maps onto the room edit precondition (`Collab/CollabRoom.cs:676-684`).
- A concurrent `convert` can be refused by core today (memory: `blocks.convert()` rejects under concurrency, commit `6b36a1b9`; **unverified in this session**). The applier maps that to `CONFLICT`, retryable.

### 3.9 Text addressing

- **Unit: UTF-16 code units, and one unit per embed**, everywhere in the contract. This is what the Yjs write path counts (`rich-text-write.ts:20-24`) and what JavaScript `string.length` gives. Line breaks are `"\n"` (`types/rich-text.d.ts:32`).
- A range always names a data `field`, never a DOM input. 03 maps `field` to an input in the editor (06 C12).
- Counting characters is hard for a model. So a range can also be named by text:

```ts
type TextRange =
  | { start: number; end: number; expectText?: string }
  | { find: string; occurrence?: number }   // 1-based; default 1
  | 'all';
```

- `find` matches against the field's plain text (embeds are `"￼"`). No match → `RANGE_NOT_FOUND`, with the field's text in `details`.
- `text.format` splits segments at the range edges, sets or clears marks, then `canonicalizeSegments` (`src/shared/rich-text/html-to-segments.ts:220`) merges equal neighbours.
- A successful batch reports the last text range it wrote as `lastRange` (section 5.1), so 03 can draw the agent caret.

### 3.10 Error model

One union for every surface: `AgentErrorCode` in section 5.1 (06 §3.2). Every error stops the batch. Nothing is written (see 3.3 for `APPLY_FAILED`).

The codes this spec raises:

| Code | When | `retryable` |
|---|---|---|
| `INVALID_ARGS` | arg missing, wrong type, unknown key; a host-effect command not alone in its batch; a tool action's `ctx.fail('INVALID_ARGS', …)` | no |
| `UNKNOWN_COMMAND` | name not in the contract; a hidden action is absent, so it lands here too; for an unknown action on a known tool, `details.tool` names it and lists its actions | no |
| `UNKNOWN_TOOL` | block type not registered, or a non-move/delete command on an opaque block | no |
| `BLOCK_NOT_FOUND` | id or `$ref` does not resolve | no |
| `FIELD_NOT_RICH_TEXT` | `field` is not in the tool's rich fields | no |
| `FIELD_NOT_WRITABLE` | a plain write to a `viewState` or `guardedFields` key; `details.reason: 'view-state' \| 'guarded'`, `details.use` | no |
| `RANGE_OUT_OF_BOUNDS` / `RANGE_NOT_FOUND` | bad offsets / `find` misses | no |
| `PLACEMENT_REFUSED` | a rule in 3.5; `details.reason` is one of `NOT_A_CHILD`, `OWN_SUBTREE`, `TABLE_CELL_BOUNDARY`, `TAKES_NO_CHILDREN`, `OWNS_CHILDREN`, `CHILD_NOT_ALLOWED`, `RESTRICTED_IN_CELL`, `SELF_PLACED_PARENT`; `details.allowed` lists allowed tools when known | no |
| `CONVERSION_UNSUPPORTED` | a side lacks `conversionConfig` | no |
| `DATA_REJECTED` | data fails the tool's schema (02) | no |
| `PRECONDITION_FAILED` | a tool action's `ctx.fail('PRECONDITION_FAILED', …)` | no |
| `READ_ONLY` | the editor is read-only, or a live session hit `APPLY_FAILED`, and the batch has a write | no |
| `STALE` | `expectRevision` / `expectText` mismatch; `details.current` (3.8) | yes, after re-reading |
| `CONFLICT` | core refused because of a concurrent edit | yes |
| `UNKNOWN_COMMAND` (availability) | the name is not in this runner's contract, including an action hidden by overrides (06 R3-1) | no |
| `COMMAND_UNAVAILABLE` | the command is in the contract with `available: false`. `details.reason`: `'service'` (a `requires` service is absent; `details.requires` names it) or `'runtime'` (`runtime: 'editor'` headless; `history.undo`/`redo` in Jint or any live room). Replaces the old `SERVICE_UNAVAILABLE` and `UNSUPPORTED_IN_RUNTIME` (06 R3-1) | no |
| `UNDO_NOT_OWN` / `NOTHING_TO_UNDO` | see 3.6 | no |
| `CANCELLED` | the `signal` aborted, seen at one of the three check points (3.3); `details.orphaned` if prep did host work | yes |
| `TOOL_ACTION_FAILED` | a tool action's `run` or `prepare` threw | no |
| `ORPHANED_SIDE_EFFECT` | see 3.3 | no |
| `APPLY_FAILED` | an applier threw after a clean dry run (see 3.3); a live Node session is read-only afterwards | no |

The surface codes (`UNKNOWN_HANDLE`, `ROOM_SYNC_TIMEOUT` and the rest) are raised by 04, not by this layer. `DURABILITY_TIMEOUT` is gone (06 R2-04-2).

Every message says what was wrong and what to do. Example: `Block "a1b2" is a "toggle"; "table" is not allowed as its child. Allowed: paragraph, header, list, ... Insert the table after "a1b2" instead.`

Warnings never stop a batch: `SANITIZED`, `DEMOTED`, `LOOKS_LIKE_MARKDOWN`, `MARKDOWN_DEGRADED` (carries the `MarkdownDegradation` entries from the converters), `UNKNOWN_MARK_DROPPED`. A failed result still carries the warnings gathered before the error.

### 3.11 The document view

Two detail levels. Both are plain JSON. Types: `DocumentView` and `ViewArgs` (the canonical names, 06 C9).

**Outline** (default). One entry per block, for orientation. Text is plain and cut to `textLimit` (default 120 chars). Marks are not shown, so the model is never shown Markdown-like text it might copy back.

```json
{
  "revision": "r42",
  "rootId": null,
  "page": { "title": "Launch plan", "icon": { "type": "emoji", "value": "🚀" } },
  "blocks": [
    { "id": "h1", "type": "header", "attrs": { "level": 2 }, "text": "Plan", "depth": 0 },
    { "id": "t1", "type": "toggle", "text": "Details", "depth": 0, "childCount": 3 },
    { "id": "p9", "type": "paragraph", "text": "First step is to…", "depth": 1, "parentId": "t1", "truncated": true },
    { "id": "x4", "type": "kanban", "depth": 0, "opaque": true }
  ],
  "next": "cursor-abc",
  "selection": { "blockId": "p9", "field": "text", "start": 4, "end": 9 }
}
```

- `attrs` holds only the fields the tool lists in `summaryFields` (02, 06 01-Q8). Example: `level`, `checked`, `style`, `language`.
- `childCount` appears when the children are not included (depth limit).
- `opaque: true` marks a block whose type is not registered (3.5).
- `page` holds this document's title and icon (3.13). It is absent when both are empty.
- `selection` appears only in the editor. Offsets use the units in 3.9.

**Full.** The same entries, with `data` as stored (rich fields as segments, host dialect) and `tunes`. Used for the blocks the agent is about to edit.

**Paging and scope.**

```ts
interface ViewArgs {
  rootId?: string | null;    // subtree root; null = document
  depth?: number;            // levels below root; default unlimited
  ids?: string[];            // exactly these blocks (full detail)
  detail?: 'outline' | 'full';
  limit?: number;            // blocks per page; default 200
  cursor?: string;           // from `next`
  textLimit?: number;
}
```

Blocks are listed in reading order: depth-first, children in `content` order. Table cell blocks are listed under their table, with `cell: { row, col }`.

**Find.** `doc.find` returns matching block ids with a text snippet, so the agent does not need to page through a long document.

### 3.12 Tool actions (the hook for spec 02)

Core defines how a tool action is **run**. Spec 02 defines how a tool **declares** one. Shapes are canonical (06 §3.4); they are repeated in section 5.1.

**Naming.** A tool action is a top-level command `<registryKey>.<action>`, e.g. `table.insertRows`, `column_list.create`. There is no generic `tool.action` command (06 C5). The registry key is what a block's `type` carries, so a host that registers Header as `heading` gets `heading.*`.

**Reserved namespaces.** `doc`, `block`, `text`, `markdown`, `history`. A tool registered under one of these keys gets no exposed actions. Its manifest entry says why.

**Args are flat.**

- `target: 'block'`: `{ id, ...actionArgs }`.
- `target: 'create'`: `{ parentId?, position?, ...actionArgs }`. The result includes `{ id, childIds }`.
- Action arg schemas may not declare `id`, `parentId` or `position`.

**Dispatch** for `{ name: '<key>.<action>', args }`:

1. Split the name at the first dot. Look up the tool by registry key, then the action in its manifest entry. Missing → `UNKNOWN_COMMAND` with `details.tool` and the tool's actions.
2. `target: 'block'`: find the block by `args.id`, check its `type` equals the key. Else `BLOCK_NOT_FOUND` or `INVALID_ARGS`.
3. Validate the rest of `args` against the action's `args` schema (02) → `INVALID_ARGS`.
4. Availability (06 R3-1). `buildAgentContract` set `available` for this runner. Renderers list only available commands, but an agent may still name any command:
   - not in the contract → `UNKNOWN_COMMAND`;
   - `available: false` → `COMMAND_UNAVAILABLE` with `details.reason` `'service'` (a `requires` service is absent, e.g. `pageBackend` without the page hooks, `openPageDocument` + `pageTitles`, or `IBlokPageTarget`) or `'runtime'`.
5. In step 3 of the batch (3.3), run the optional async `prepare(ctx, args)`. Its result is passed to `run`. Nothing is written.
6. In step 5 (plan), call `run(ctx, args, prepared)`. It is **synchronous**. The `ToolActionContext` **records** each `insert`, `update`, `setRichText`, `move`, `remove` as `Edit`s. It keeps an overlay, so a later `ctx.read` in the handler sees earlier writes.
7. The recorded `Edit[]` go through the same rules as any other command (3.5). A tool action cannot bypass placement, sanitize, validation, undo or attribution.

`ctx.fail(code, message)` aborts with `PRECONDITION_FAILED` or `INVALID_ARGS`. A thrown error becomes `TOOL_ACTION_FAILED`.

**Custom tools.** Custom tool action handlers run in the browser only in v1. Handlers outside the browser are cut, and the user can revisit (D6). In Node and Jint, custom tools come from a `BlokCustomToolsFile` of JSON descriptions (02): structural and field writes work, actions do not (06 01-Q5).

**Jint availability** (06 R3-3). In Jint, an action is `available: false` only when a `requires` service is absent from the `services` C# passed. `prepare` runs in Jint with those services (normally none), so `uses`-only actions such as `image.setSource` store the URL as given. `effects: 'host'` actions never run inside Jint; C# runs them (3.14). `runtime: 'editor'` commands are listed with `available: false`.

**Page actions.** `page.rename` and `page.setIcon` change **another** page. In the browser they call the host hooks from `prepare`, with `effects: 'host'`, alone in their batch. Headless they are cross-document writes (3.13 B).

### 3.13 Page title and icon (D6: kept in v1)

There are two different things. They get two different commands (06 §10.1).

**A. This document's own title and icon: `doc.setTitle`, `doc.setIcon`.** New core commands under the reserved `doc.` namespace.

```ts
'doc.setTitle': { title: string }            // '' clears
'doc.setIcon':  { icon: PageIcon | null }   // PageIcon from types/tools/page.d.ts:13
```

- Both plan to one `setPageField` edit (3.4).
- Editor: `YjsManager.setPageField` (`yjs/index.ts:963-974`). It opens its own value-edit step through `undoHistory.beginValueEdit` (`:971`, gated at `:969-972`). **Unverified:** that this joins the batch's open tool transaction instead of splitting it. A test pins it (section 6).
- Live Node: `writePageField(store.page, key, value)` inside the batch's `transact`.
- Stored (Node and Jint): a new optional top-level field on the saved format, `page?: { title?: string; icon?: PageIcon }` on `OutputData`. Absent when empty. Additive (D4). `JsonApplier` reads and writes it. `DocumentStore` load and save carry it through `pageFromJSON` (`document-store.ts:227`) and `readPageFields` (`page-fields.ts:25`).
- C# live: a new internal `SetPageField` op (3.14).
- `doc.read` returns `page` at the top of the view (3.11).

**B. Another page's title and icon: `page.rename`, `page.setIcon`** (page-block actions, 02).

- Browser: unchanged. The action's `prepare` calls the host hooks `config.rename` / `config.setIcon` (`src/tools/page/index.ts:433`, `:490`). `effects: 'host'`, alone in its batch.
- Headless: the target page is its own document; the page block holds a `pageId`. So the action is a **cross-document write**:
  1. It must be alone in its batch (host effect).
  2. The executor reads `pageId` from the block's data and calls `ports.openPageDocument(pageId, actor)` (3.1).
  3. It runs `doc.setTitle` / `doc.setIcon` on that session, then closes it.
  4. Result: `{ pageId, applied: true }`. An error from the target session is returned with `details.pageId`.
- Without the port, the action is `available: false`. 04 provides the port in Node MCP; C# provides it through an optional host callback (3.14).
- It is opt-in per deployment, because hosts may store titles behind their own `rename` hook, not in the page map (unverified per host). MCP option `pageTitles: 'page-map'`, C# `BlokAgentOptions.PageTitles`. Default off → `available: false`.

### 3.14 The C# server path (D1, D1a)

Owned by 01 and 04 until a server spec exists (06 §11). Stored is built first, then live; both are v1 (D1a).

**Bundle contents** (06 §7.1). The Jint bundle's one entry, `src/view/server-runtime.ts`, imports: the planner, `JsonApplier`, view builder, `COMMANDS` and envelope validation (`src/shared/agent/`); the validator (`src/shared/schema/validate.ts`); descriptions, action impls, `buildToolManifest`, `buildAgentContract` (02); the built-in tool runtimes and moved sanitize rules (02); and the headless ports (`src/view/agent-runtime.ts`). parse5 is already in the bundle: `server-runtime.ts:17` imports `rich-text-parse5`, which imports parse5 (`src/view/rich-text-parse5.ts:1`). Not in the bundle: yjs, `DocumentStore`, `StoreApplier`, `EditorApplier`, any tool class, any host service. **Unverified:** that every planner feature runs under Jint 4.16.4, and how much the bundle grows.

**Jint ops** (06 §7.2). String in, string out, like every other `blokServerInvoke` op.

```ts
// blokServerInvoke('manifest', JSON.stringify(input)) → JSON.stringify(output)
input:  { customTools?: BlokCustomToolsFile; overrides?: ManifestOverrides; services?: HostService[] }
output: { manifest: BlokToolManifest; contract: AgentContract }

// blokServerInvoke('agentExecute', JSON.stringify(input)) → JSON.stringify(output)
input:  { document: OutputData; batch: AgentBatch; actor: AgentActor;
          customTools?: BlokCustomToolsFile; overrides?: ManifestOverrides; services?: HostService[] }
output: { result: AgentResult; document: OutputData; edits: Edit[] }
```

- One call is one batch. Reads (`doc.read`, `doc.find`, `markdown.export`) run through it too.
- `edits` are the applied primitive edits. The live path uses them.
- Revision: the stored content hash (3.8), for stored execution only. Live rooms use the journal head (below).
- No callbacks. A Jint op is one string-in, string-out call. I read no code that lets JS call back into C# during it. So `ports.openPageDocument` is absent inside Jint.

**C# API** (06 §7.3). A new public interface in the `Blok.Server` NuGet package, `IBlokAgentExecutor`, registered next to `IBlokDocumentConverter` (`Documents/IBlokDocumentConverter.cs:112`). A new interface, so hosts that implement the old one do not break.

```csharp
public interface IBlokAgentExecutor
{
  ValueTask<BlokAgentExecution> ExecuteAsync(
      string documentJson, string batchJson, BlokAgentActor actor,
      BlokAgentOptions? options = null, CancellationToken cancellationToken = default);
  ValueTask<string> GetContractAsync(BlokAgentOptions? options = null, CancellationToken cancellationToken = default);
  ValueTask<BlokAgentExecution> ExecuteInRoomAsync(
      string docId, string batchJson, BlokAgentActor actor,
      BlokAgentOptions? options = null, CancellationToken cancellationToken = default);
}

public sealed record BlokAgentActor(string Id, string Name, string? OnBehalfOf = null);
public sealed record BlokAgentExecution(string ResultJson, string? DocumentJson, string Revision);
```

`BlokAgentOptions` carries `PageTitles` and an optional `IBlokPageTarget` callback for 3.13 B. No new HTTP route and no MCP server inside C# in v1.

**Headless `page.rename` / `page.setIcon` in C#.** The command is alone in its batch (host effect), so C# handles it outside Jint:

1. C# sees the single page-action command in the batch.
2. It reads `pageId` from the block (through a Jint `doc.read`) and resolves the target through `IBlokPageTarget`.
3. It runs a separate `ExecuteAsync` (stored target) or `ExecuteInRoomAsync` (room target) with one `doc.setTitle` / `doc.setIcon` command.
4. It returns `{ pageId, applied: true }` as the command result.

Without `IBlokPageTarget`, or with `PageTitles` off, the `pageBackend` service is absent, so the action is `available: false` (06 R3-2). With both, C# passes `services: ['pageBackend']` to the Jint `manifest` op, so the contract lists it.

**Live rooms: translate `Edit[]` into room edit ops** (06 §7.4 (b)).

- `CollabRoom.EditAsync` takes a `planOps` callback over the live `YDoc`, an `actorId` and a precondition (`Collab/CollabRoom.cs:553-563`). Version restore already uses it this way: it exports the live doc with `converter.ExportAsync` and plans ops (`Collab/CollabRoomManager.cs:563-576`).
- The C# path: `ExecuteInRoomAsync` → `room.EditAsync(planOps: export the live doc → Jint agentExecute → translate edits → ops, actorId: actor.Id, expect)`.
- `ApplyOpsAsync` validates every op before writing, in one transaction (`Collab/ICollabDocConverter.cs:36`). So the C# live path is atomic.
- The precondition compares the journal head (`CollabRoom.cs:676-684`), so `expectRevision` is `lineage:sequence` here. So `ExecuteInRoomAsync`:
  1. removes `expectRevision` from the batch before it calls Jint (else Jint would compare a journal head against its content hash and always return `STALE`);
  2. passes that value as the `EditAsync` precondition; a failed precondition becomes `STALE`;
  3. sets `result.revision` and `BlokAgentExecution.Revision` to the journal head after commit, never Jint's hash.

| `Edit` | Room op today | Needed |
|---|---|---|
| `insert` (tree) | `Insert` per block, parent first, chained `After` (`CollabEditOps.cs:31-35`) | none |
| `remove`, `withChildren: true` | `Remove` takes the subtree (`CollabEditOps.cs:40-41`) | none |
| `remove`, `withChildren: false` | — | `Move` each child into the slot, then `Remove` |
| `move` | — | new internal `Move(Id, After, Parent)` |
| `setData`, `setRichText` | `Update`; rich text edits in place (`YDocConverter.cs:1124-1185`) | the translator composes the **full** new `data`, because `ReplaceData` removes keys the new data lacks (`YDocConverter.cs:1141-1149`) |
| `setTunes` | — | new `SetTunes` (or optional `tunes` on `Update`) |
| `replaceType` | — | new `Retype(id, type, data)`, keeping the block map, like `replaceBlockContent` (`document-store.ts:751`) |
| `setPageField` | — | new `SetPageField`. The converter knows only the `blocks` and `root` roots today (`YDocConverter.cs:77-78`), so `SeedAsync` / `ExportAsync` (`ICollabDocConverter.cs:23`, `:29`) must read and write the `page` root |
| `lastEditedBy` / `lastEditedAt` | read from an inserted block (`YDocConverter.cs:2384-2386`) | a metadata step on `Update` / `Retype` / `Move` (unverified whether `Update` can write it today) |

- New ops are internal only. They are not added to the `/edit` wire parser (`CollabEditOps.cs:235-251`). No protocol change.
- `Move` plans in `EditPlanner` (`YDocConverter.cs:634`) and keeps the block map, so a peer's concurrent edit inside the moved block merges. Lockstep fixtures pin it against `DocumentStore.moveBlockTo` (`document-store.ts:824`). `SetPageField` gets lockstep fixtures against `page-fields.ts`.
- Known gap: the C# live agent has no socket, so it is not a visible participant (no awareness, no frame 107, no agent cursor). Its edits are attributed in the journal. The visible-participant path is Node MCP (04).

---

## 4. Public surface

**New, additive, not breaking** (D4: approved, ships with a release note listing every item).

- `types/agent.d.ts`: the envelope, command arg types, results, errors, view types, `Edit`, `AgentActor`, `AgentSession`, `InsertSpec`, `RichTextHelpers`. Hand-authored. No `src/` imports. Re-exported from `types/index.d.ts` (06 R2-02-5).
- `types/tools/tool-description.d.ts` (02) holds `ToolActionDeclaration`, `ToolActionImpl`, `ToolActionContext`. This spec consumes them.
- `editor.agent`, owned by spec 03. Core constructs the object.
- `BlockMutationEventDetail.agent?: { id; name; turnId }` (3.7). One edge: a consumer who hand-implements the full `API` interface gets a TS error for the new `agent` member, as with `media`, `viewState`, `marks`.
- `doc.setTitle` / `doc.setIcon` commands, and the optional saved field `OutputData.page` (3.13).
- Jint ops `agentExecute` and `manifest` in `src/view/server-runtime.ts` (3.14). Internal to the server bundle.
- NuGet `Blok.Server`: new public interface `IBlokAgentExecutor` and its records (3.14).

**BREAKING (D5): public `blocks.convert()` sanitizes its overrides.**

- `convert(id, type, overrides)` shipped in `v1.16.1` (06 D5). Today it runs overrides through `richTextToHtml` only (`api/blocks.ts:776`), and `BlockMutation.convert` spreads them raw over the sanitized import (`block-mutation.ts:1739-1740`, 06 B1).
- Who it breaks: a host that passes markup outside the target tool's sanitize rules.
- Old behaviour: overrides are written into the block unsanitized (only segments → HTML).
- New behaviour: overrides go through `hostDataForTool` (tool + global sanitize, unsafe URL strip), like `insert` and `update`.
- Migration: widen the target tool's `sanitize` or the global `sanitizer` config, or the markup is stripped.
- It ships as its own commit, with the regression test written first. Subject has `BREAKING`; body has a `BREAKING CHANGE:` line with the three lines above.
- `EditorApplier` then goes through that same path for `replaceType` (3.4) and has no private sanitize step.

**Internal changes, no public effect:**

- `placement-rules.ts` shared by the planner and `block-placement.ts`.
- An `allowColumnMoves` option on `assertCanMoveUnder` (agent appliers only).
- A per-touched-block attribution scope in BlockManager (3.7).
- Undo step metadata `{ actor, sessionId }`, and the turn-merge lever (3.6).
- Caret capture on local agent writes to the user's caret block (3.4).
- The view-entry law exception for `src/mcp/` (3.1). `@bloklabs/mcp` ships (D2).
- C# internal room ops `Move`, `SetParentId` step, `Retype`, `SetTunes` / metadata, `SetPageField` (3.14).

---

## 5. Interfaces

### 5.1 Interfaces I provide

All shapes below are 06's canonical contract (06 §3.1, §3.2, §3.5), copied verbatim (06 round 3 added `doc.setTitle` / `doc.setIcon` to its §3.1).

**Commands.**

```ts
type CoreCommandName =
  | 'doc.read' | 'doc.find'
  | 'block.insert' | 'block.update' | 'block.delete' | 'block.move'
  | 'block.convert' | 'block.duplicate'
  | 'text.insert' | 'text.delete' | 'text.replace' | 'text.format'
  | 'markdown.insert' | 'markdown.export'
  | 'history.undo' | 'history.redo'
  | 'doc.setTitle' | 'doc.setIcon';   // 06 §3.1, §10.1 A

/** A tool action: `<registryKey>.<action>`, e.g. 'table.insertRows', 'column_list.create'. */
type ToolCommandName = `${string}.${string}`;
type CommandName = CoreCommandName | ToolCommandName;

const RESERVED_NAMESPACES = ['doc', 'block', 'text', 'markdown', 'history'] as const;
```

**Envelope, result, errors.**

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

`ref` names a block the command creates. Later commands may use `"$<ref>"` as an id. `refs` maps each ref to the real id. `changed` lists every id the batch touched, by kind. 03 uses `changed` and `lastRange` for the agent caret; 04 uses `changed` for presence.

**Core command args.** Ids may be real ids or `"$ref"`. `position` is the existing `BlockPosition` (`types/api/blocks.d.ts:33`): `'start' | 'end' | { before: id } | { after: id }`. Text ranges are `TextRange` (3.9).

| Name | Args | Result | Notes |
|---|---|---|---|
| `doc.read` | `ViewArgs` (3.11) | `DocumentView` | read-only |
| `doc.find` | `{ text?: string; type?: string; rootId?: string; limit?: number }` | `{ matches: { id, type, snippet }[] }` | read-only |
| `block.insert` | `{ type: string; data?: object; tunes?: object; parentId?: string \| null; position?: BlockPosition; children?: InsertSpec[]; id?: string; demote?: boolean }` | `{ id; childIds: string[] }` | `InsertSpec` = same fields minus placement, recursive. Rich fields take `RichText` or a plain string. `id` lets a caller pick a stable id (06 05-Q1). |
| `block.update` | `{ id; data?: object; tunes?: object }` | `{ id }` | shallow merge; a key set to `null` is removed; `viewState`/`guardedFields` keys → `FIELD_NOT_WRITABLE` |
| `block.delete` | `{ id }` | `{ removedIds: string[]; liftedIds: string[] }` | follows the editor: children move up into the deleted block's slot, unless the tool declares `deletesChildren` (`types/tools/block-tool.d.ts:382-391`), then the subtree goes. Accepts opaque blocks. |
| `block.move` | `{ id; parentId?: string \| null; position: BlockPosition }` | `{ id }` | with subtree; existing columns allowed (3.5). Accepts opaque blocks. |
| `block.convert` | `{ id; type: string; data?: object }` | `{ id }` | uses `conversionConfig`; `data` overrides are sanitized (3.4) |
| `block.duplicate` | `{ id; position?: BlockPosition }` | `{ id; childIds }` | deep copy, new ids |
| `text.insert` | `{ id; field?: string; at: number \| { after: string }; text: string \| RichText; marks?: RichTextMarks }` | `{ length }` | `field` defaults to the tool's first rich field |
| `text.delete` | `{ id; field?; range: TextRange }` | `{ removed: string }` | |
| `text.replace` | `{ id; field?; range?: TextRange; with: string \| RichText }` | `{ length }` | no range = whole field |
| `text.format` | `{ id; field?; range: TextRange; set?: RichTextMarks; unset?: (keyof RichTextMarks \| \`tag:${string}\`)[] }` | `{}` | |
| `markdown.insert` | `{ markdown: string; parentId?: string \| null; position?: BlockPosition }` | `{ ids: string[] }` | additive; warnings carry degradations |
| `markdown.export` | `{ rootId?: string }` | `{ markdown: string }` | read-only; warnings carry degradations |
| `history.undo` / `history.redo` | `{}` | `{}` | own steps only (3.6); Jint and any live room → `COMMAND_UNAVAILABLE` |
| `doc.setTitle` | `{ title: string }` | `{}` | `''` clears (3.13 A) |
| `doc.setIcon` | `{ icon: PageIcon \| null }` | `{}` | `null` clears (3.13 A) |

`caret.set` and `tool.action` are dropped (06 C14, C5; `caret.set` stays cut per D6). The agent never moves the user's caret; 03 draws an agent caret from `lastRange`, and following it is the host's `follow` option.

Read commands may appear in a batch. They see the document as the earlier commands in the batch left it.

Tool action args and results follow 3.12.

**Registry.** `COMMANDS: Record<CoreCommandName, { argsSchema: BlokSchema; resultSchema?: BlokSchema; readOnly: boolean; runtime: 'any' | 'editor'; summary: string; guidance?: string }>`, exported from `src/shared/agent/commands.ts`. 02's `buildAgentContract(manifest, COMMANDS)` merges it with every tool action into `AgentContract.commands` (06 §3.6). 03, 04 and 05 consume the contract, not `COMMANDS` directly.

**Sessions** (06 §3.5).

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

```ts
type ToolRuntimeRegistry = ReadonlyMap<string, ToolRuntime>;   // keyed by registry key
type ContractSlice =
  | { index: { tools: { name: string; summary: string }[]; commands: { name: CommandName; summary: string }[]; guidance: string } }
  | { tool: BlockToolManifestEntry; commands: CommandEntry[] }
  | { command: CommandEntry };
```

- `createEditorAgentSession` uses `EditorApplier`. It builds its contract from the live registry.
- `createDocumentAgentSession` uses `JsonApplier`. Stored documents in Node (04, 06 05-Q10).
- `createStoreAgentSession` uses `StoreApplier`. Live rooms in Node (04).
- The Jint `agentExecute` op builds a `createDocumentAgentSession` per call (3.14).
- `log()` returns every command run in the session, in every runtime (06 05-Q2). 05 reads it.
- `AgentPorts` is defined in 3.1.

**Event** (D4: approved). `BlockMutationEventDetail.agent?: { id: string; name: string; turnId: string }`. `origin` stays `'local'`. 03 names the public surface around it. 01's earlier `AgentChange` event is dropped: `AgentResult.changed` carries the ids, and the per-block event carries the actor.

**Tool action runtime shapes** (06 §3.4, owned by 02, run by 01).

```ts
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

`RichTextHelpers` and `InsertSpec` are provided by this spec and published in `types/agent.d.ts` (R2-02-5). `RichTextHelpers` holds the same range helpers `text.*` uses (split at offsets, set/clear marks, `find`, canonicalize). `InsertSpec` is `block.insert`'s args minus placement, recursive.

The action declaration also carries `effects?: 'host'` (02, R2-02-3), used by the batch rule in 3.3.

### 5.2 Interfaces I consume

| From | What | Assumption |
|---|---|---|
| **02** | `BlokToolManifest` entries (JSON): `name`, `richTextFields`, `children` (`allow`, `deny`, `ownedByTool`, `layout`, `deletedWithParent`, accepts), `selfPlacesChildren`, `restrictedInTableCell`, `conversion: { import?: string; export?: string }`, `data` schema with `viewState`/`guardedFields`, `summaryFields`, `insertRequires`, `actions` (`ToolActionDeclaration` with `target`, `runtime`, `requires`) | 02 adds the C10 fields. `selfPlacesChildren` comes from `SELF_PLACING_PARENTS` (06 B7). |
| **02** | `ToolRuntime` per tool (code, never serialized in v1), composed by `buildToolRuntimes(config)`: `sanitize` (function rules by reference), `normalize?`, `defaultChildren?`, `actions: Record<string, ToolActionImpl>` | Only each tool's own rules move to `src/shared/`; the composition matches the editor (R2-02-1). Table `normalize` is a live-mode blocker (C17). |
| **02** | `effects?: 'host'` on actions; `BlokCustomToolsFile` for Node and Jint custom tools | `page.rename` / `page.setIcon` carry `effects: 'host'`. |
| **02** | `AgentContract` from `buildAgentContract(manifest, COMMANDS, where)` (06 §3.6, R3-1); `validateAgainst` from `src/shared/schema/validate.ts` | Used by `describe` and post-write validation. |
| **03** | Public name and adapter exposure of the session (`editor.agent`, `AgentTurn`); the turn's `signal` for `CANCELLED`; R-U1..R-U6 tests | 03 adds no commands or shapes. |
| **04** | The Node socket member that owns the room's `DocumentStore`; saving stored output with `ifVersion`; ticket `user` = `actor.id`; `ports.openPageDocument` under the same principal and mode rules as `blok_open`; the `pageTitles` option | 04 picks stored vs live per document. |

---

## 6. Testing strategy (TDD)

Write each test first and watch it fail.

**Unit, pure (`test/unit/shared/agent/`, Node environment):**

- Envelope validation: every command, every bad arg → `INVALID_ARGS` with a correct `path`.
- Planner rules: one test per `PLACEMENT_REFUSED` reason, with the same fixtures as `block-placement` tests.
- Rich-text math: `text.format` across segment edges, embeds, surrogate pairs, `find` with `occurrence`, `expectText` mismatch → `STALE` with `details.current`.
- Atomicity: a batch whose third command fails leaves the snapshot byte-identical.
- Refs: `$a` created in command 1 and used in command 3; unknown ref → `BLOCK_NOT_FOUND`.
- Sanitize warning: `<script>` in a rich string → stripped + `SANITIZED`.
- Markdown look-alike: `"**hi**"` in `text.insert` → `LOOKS_LIKE_MARKDOWN`.
- Tool actions: `<key>.<action>` dispatch; reserved key gets no actions; arg schema declaring `id` is rejected; recording ctx overlay (a `read` after an `insert` in the same handler sees it); `prepare` runs before planning and writes nothing.
- Post-write validation: a `viewState` key → `FIELD_NOT_WRITABLE`; an untouched invalid legacy key does not fail the batch.
- Opaque block: `block.move` works, `block.update` → `UNKNOWN_TOOL`.
- Failure result carries the warnings gathered before the error.
- `log()` records every command with its result or error.
- Cancel: an aborted signal at each of the three check points → `CANCELLED`; after a `prepare` with host work → `details.orphaned`; never mid-apply.
- A host-effect action with a second command in the batch → `INVALID_ARGS`.
- A hidden action → `UNKNOWN_COMMAND`.
- `doc.setTitle` / `doc.setIcon` round trip through `OutputData.page`; `doc.read` returns `page`.
- Headless `page.rename`: without `openPageDocument` → `available: false`; with it, the target session gets `doc.setTitle`.
- The `ToolRuntimeRegistry` is rebuilt only when `AgentContract.revision` changes.

**Parity, the key test (`test/unit/agent/applier-parity.test.ts`):**

- A corpus of batches: every 05 eval `reference` batch plus hand-written ones (06 01-Q9).
- Runners: `JsonApplier` (`createDocumentAgentSession`), `StoreApplier` (`createStoreAgentSession` over a fresh `DocumentStore`), `EditorApplier` (`createEditorAgentSession` on a jsdom editor). The Jint and C# room runners are in "C# server" below.
- Commands with `available: false` in a runner's contract expect `COMMAND_UNAVAILABLE` there (06 R3-1). `history.undo` is skipped on Jint and live runners.
- `doc.setTitle` / `doc.setIcon` cases on every runner.
- Compare saved JSON after `canonicalizeSegments`, ignoring `lastEditedAt` and the listed tool-minted fields (3.4). Any difference fails.
- One case per built-in container inserted with explicit `children` → no seeded extras (3.5).

**Editor integration (unit, jsdom):**

- One `execute` = one `history.undo()` restores the prior save.
- An agent `history.undo` after the user typed → `UNDO_NOT_OWN`.
- **Attribution:** the user types in another block during the apply window. That block keeps the human's id. Touched blocks carry `actor.id`, and their events carry `detail.agent` (06 C3).
- Turn merge: R-U1 and R-U3 (03). The merge lever is unverified until these pass.
- Read-only editor: a write batch → `READ_ONLY`; `doc.read` still works.
- `block.move` into an existing column works; `blocks.moveTo` still throws (public behaviour unchanged).
- D5 regression test, written first and watched fail: public `blocks.convert` with overrides carrying forbidden markup → stripped (fails today at `api/blocks.ts:776`). The same case through `block.convert`.
- `doc.setTitle` inside a batch joins the batch's single undo step (pins the unverified `beginValueEdit` interaction, 3.13).
- A `block.update` on a database block keeps its rows attached (06 02-Q4, unverified today).
- A write to the block holding the user's caret leaves the caret where it was. No command changes focus, selection or scroll.

**Store integration (unit, Node):**

- `StoreApplier` emits one update per batch on `onUpdate`, with origin `'local'`.
- `remove` with `withChildren: false` lifts the children into the slot.
- `setData` with `null` removes the key (passed as `undefined`).
- `history.undo` in live mode → `COMMAND_UNAVAILABLE`.
- Live atomicity: a forced throw mid-apply → `APPLY_FAILED`; the next write batch → `READ_ONLY`.
- `doc.setTitle` writes the store's `page` map.
- `lastEditedBy` = `actor.id` on touched blocks only.

**Law tests (`test/unit/architecture/`):**

- `agent-purity-law.test.ts`: `src/shared/agent/**` imports nothing from `src/components/`, `src/tools/`, `src/view/` or `parse5`, and touches no `window`/`document`. Same shape as `view-entry-law.test.ts`.
- `agent-placement-parity-law.test.ts`: `block-placement.ts` uses the shared predicates; no second copy of a rule.
- `agent-silent-failure-law.test.ts`: no code path in `src/shared/agent/` or `src/components/modules/agent/` returns `null`/`[]` or calls `console.warn` instead of producing an `AgentError` or `AgentWarning`. Exemptions need reasons.
- `view-entry-law.test.ts`: extend with the `src/mcp/` exception and its "nobody imports `src/mcp/`" guard (D2).
- 05 owns the coverage law over the contract's commands.

**C# server (06 §7.5):**

- Build test (`test/unit/scripts/build-server-runtime.test.ts`): `manifest` and `agentExecute` round trips in the globals-free realm, plus a bundle-size line (05).
- C# tests beside `Runtime/JintBlokRuntimeTests.cs`: the parity corpus through `IBlokAgentExecutor.ExecuteAsync`; output equals the Node `JsonApplier` golden.
- C# room tests: the corpus through `ExecuteInRoomAsync` on a scratch room; `ExportAsync` equals the Node `StoreApplier` golden. A `Move` while a second client types inside the moved block keeps both edits.
- Lockstep fixtures: C# `Move` vs `DocumentStore.moveBlockTo`; C# `SetPageField` vs `page-fields.ts`.

**E2E:** one Playwright spec: an in-app session inserts a toggle with children and bolds a range; the user presses Cmd+Z once and both edits are gone. Uses semantic locators.

---

## 7. Open questions for other specs

All questions from the first draft are answered by 06. They are kept here, marked resolved, so the history is clear.

1. **Resolved (06 01-Q1, C1, §7.4).** Outside agents reach live rooms through a Node socket member that applies `Edit[]` to a `DocumentStore` (`StoreApplier`). The C# server reaches its own rooms by translating `Edit[]` into internal room ops (3.14). The public `/edit` wire does not change. `/edit` Update is already merge-safe for rich text (`YDocConverter.cs:1124-1185`).
2. **Resolved (D1, D1a).** Both Node and C# Jint ship in v1. Jint has `agentExecute` and `manifest`; stored first, then live (3.14).
3. **Resolved (06 01-Q3, C11).** Merge into the turn's previous step only if it is still on top and no gesture came between. The lever is unverified; tests pin it (3.6).
4. **Resolved (06 01-Q4).** `defaultChildren` lives in each container's `ToolRuntime`. Parity tests pin that explicit `children` suppress seeding.
5. **Resolved (06 01-Q5, D6).** Custom action handlers run in the browser only. Node and Jint load custom tools as JSON descriptions (`BlokCustomToolsFile`).
6. **Resolved (06 01-Q6).** No serialization in v1. Function rules travel by reference; `src/view/sanitize.ts` runs them (`:342`, `:410`), in Node and in Jint.
7. **Resolved (06 01-Q7).** Existing block into existing column = `block.move`. Creating columns and side-drop = `column_list.*`. Cleanup is one shared pure helper.
8. **Resolved (06 01-Q8).** 02 adds `summaryFields?: string[]`.
9. **Resolved (06 01-Q9).** Every 05 eval `reference` batch is a parity case.
10. **Resolved (D6, 06 §10.1).** Page title and icon are in v1: `doc.setTitle` / `doc.setIcon` for this document, and headless `page.rename` / `page.setIcon` as opt-in cross-document writes (3.13).
11. **Resolved (06 01-Q11, C17).** Pure `normalize(data)` per tool. Required for live mode. Parity ignores listed tool-minted fields until each tool has it.

No new questions.

---

## 8. Out of scope

- The public name of the browser entry point and adapter parity (03).
- MCP, auth, deployment, rooms' presence frames (04). The agent cursor shown to peers is in v1 (D6) and owned by 03 and 04.
- How tools declare schemas and actions (02). I only run them.
- Simulated input: clicks, keystrokes, pixels.
- Moving the user's caret, selection, focus or scroll. `caret.set` stays cut (06 C14, D6).
- Changes to the public C# `/edit` wire, an HTTP route for the C# agent path, and an MCP server inside C# (06 §7.3, D6).
- Undo in any live room, Node or C# (cut by the user, D6).
- Uploads and media bytes (cut by the user, D6). Media commands and actions take URLs only; there is no byte input anywhere.
- View-state control, and custom tool action handlers outside the browser (cut, user can revisit, D6).
- Replacing the whole document. Agents edit additively; a full reset stays the server's `POST /sync/{doc}/reset` (`blocks.ts:276-280`).
- Moving blocks between documents. (Headless `page.rename` / `page.setIcon` write another document's page fields only, 3.13 B.)
- Deprecating the old index-based `blocks.*` methods.
- Sanitizing `splitBlock` input (06 B2). Not decided; separate work.

---

## Issues with 06

None open (closed in 06 round 3).
