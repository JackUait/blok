# 05 — Coverage law + agent evals

Date: 2026-10-08. Builds on `00-brief.md`. Repo state read at `fb62db72` (last tag `v1.16.1`).

Revised to match `06-reconciliation.md`, rounds 1, 2 and 2b. Every shared shape here is 06's canonical contract (06 §3). The user decided D1, D1a and D2–D6 (06 §5). Where content depends on one, it says "(D#: outcome)".

---

## 1. Purpose and success criteria

"Agents have full control" has to be something a test can fail on. This spec defines three checks that together mean it:

1. **Coverage law (per commit, mechanical).** Every human-reachable capability that code can enumerate maps to a command (01), a tool action (02), a schema-checked field write (02 §3.4), or a written exemption. A new toolbox entry, menu item, shortcut, inline tool or drag outcome with no route turns CI red.
2. **Contract tests (per commit, deterministic).** The same `AgentBatch` gives the same document through every runner: `EditorApplier` (browser), `JsonApplier` in Node (stored documents), `StoreApplier` in Node (over a `DocumentStore`), and the C# server's Jint path, both stored (`IBlokAgentExecutor.ExecuteAsync`) and live room (`ExecuteInRoomAsync`) (06 C1, §7.5) (D1: Node and Jint both in v1; D1a: stored and live C# both in v1). The in-app tools (03) and the MCP tools (04) both come from one renderer, `renderAgentTools`, over one `AgentContract`, with no drift (06 C2).
3. **Agent evals (manual dispatch only, real model calls)** (D3: manual only, token caps). Realistic tasks run end to end through the real surfaces. Deterministic graders score the final document. Pass rates are tracked against a baseline. The original failure (Markdown written into block data) is an explicit eval.

Success criteria:

- The coverage law is green, and every exemption has a reason from a closed list of categories.
- Each enumerator in the law has a fixture test proving it detects a planted capability ("mutation check", the pattern in `test/unit/architecture/tool-tail-append-law.test.ts:99-114`).
- The parity corpus passes on all five runners (3.2.1).
- Every eval task has a reference solution that passes its graders and a known-bad solution that fails them. This runs per commit with no model.
- Each eval run reports pass rate per task, compared with a checked-in baseline. The Markdown eval passes at 100% of trials before the agent surface is called shipped.
- The envelope-vs-full eval has run once and picked the shipped default for `RenderOptions.schema` (06 C2, 03-Q12, 04-Q15).

---

## 2. What exists today

### 2.1 Architecture law pattern

The repo has 79 files under `test/unit/architecture/` (counted with `ls | wc -l`). The ones this spec copies:

| Pattern | Where |
|---|---|
| Walk `src/` with `readdirSync`, parse each file with the TypeScript compiler API, visit nodes | `test/unit/architecture/hint-delay-law.test.ts:36-49`, `:58-84`, `:88-91` |
| Allow-list as `Record<file, reason>` and `toStrictEqual` against the found set, so a stale entry fails too | `hint-delay-law.test.ts:28-32`, `:153-159` |
| Exemption objects `{ file, attr, reason }`, a comment saying an entry without a real reason violates the law | `test/unit/architecture/paste-stamp-law.test.ts:67-92` |
| A separate "stale exemption" test | `paste-stamp-law.test.ts:210-221`; `table-cell-content-law.test.ts:176` |
| Failure message that tells the author both ways out (fix it, or exempt with a reason) | `paste-stamp-law.test.ts:198-204` |
| Self-check that the scan still finds something, so it cannot go silently empty | `hint-delay-law.test.ts:149-151`; `top-level-block-enumeration-law.test.ts:157` |
| Fixture "mutation check" proving the detector detects | `tool-tail-append-law.test.ts:99-114` |
| Skip source-text scans under Stryker, because instrumentation rewrites the text | `test/unit/helpers/instrumented.ts` (`isInstrumented`), used at `paste-stamp-law.test.ts:210` |
| Enumerate registered tools from `defaultBlockTools` plus `page`, with `EXEMPT_TOOLS: Record<tool, reason>` | `test/unit/architecture/markdown-serialization-law.test.ts:5`, `:30-34`, `:67-82` |

### 2.2 Where human capabilities are defined, and whether code can list them

| Source | Where | Enumerable? |
|---|---|---|
| Registered block tools | `defaultBlockTools` in `src/tools/index.ts:81-105` (23 tools incl. `database-row`); `page` ships but is not a default (`markdown-serialization-law.test.ts:63-67`); `PageLink` is exported at `src/tools/index.ts:49`. The column list's registry key is `column_list` (`src/tools/index.ts:99`, per 06 C5) | Yes, statically |
| Toolbox entries | `static get toolbox(): ToolboxConfig` on 21 tool classes (grep, e.g. `src/tools/list/index.ts:786`, `src/tools/database/index.ts:104`). An entry can carry its own `name` (`types/tools/tool-settings.d.ts:61-63`) and a `shortcut` hint (`:82-86`) | Yes, by reading the static on each class |
| Inline tools | `defaultInlineTools` in `src/tools/index.ts:110-121` (10 tools) | Yes, statically |
| Block tunes | Classes with `isTune = true`: `src/components/block-tunes/block-tune-delete.ts:18`, `block-tune-copy-link.ts` | Yes |
| Block settings built-ins | `blockSettings.ts` builds named items: `convert-to` (`src/components/modules/toolbar/blockSettings.ts:614`), `turn-into-columns` (`:576`), `duplicate` (`:651`), `delete` (`:705`), `edit-metadata` (`:477`, `:742`), `block-menu-title` (`:496`), `copy-link` (`:468`) | Yes, by AST (string literal `name:`) |
| Tool settings menus | `renderSettings(): HTMLElement \| MenuConfig` (`types/tools/block-tool.d.ts:49`), implemented in 16 tool files (grep). Item `name` is optional (`types/utils/popover/popover-item.d.ts:212-213`) | **Partly.** See 2.3 |
| Tool-internal menus | Table row/column popover (`src/tools/table/table-row-col-popover.ts:95-116`), table settings (`src/tools/table/index.ts:700-760`), database tab bar (`src/tools/database/database-tab-bar.ts:299-321`) | Partly. Table has a typed action union `RowColAction` (`src/tools/table/table-row-col-controls.ts:28-40`). Database has model methods (`src/tools/database/database-model.ts:54-179`: `addProperty`, `updateProperty`, `deleteProperty`, `addView`, `updateView`, `deleteView`) |
| Raw DOM interactions in tools | `addEventListener('click' \| 'pointerdown' \| 'mousedown')` | **No.** Measured counts in 2.3 |
| Registered keyboard shortcuts | `Shortcuts.add({ name, … })` (`src/components/utils/shortcuts.ts:14-31`), called at `src/components/ui/toolbox.ts:1231`, `src/components/modules/blockSelection.ts:322`, `src/components/modules/toolbar/inline/shortcuts-manager.ts:171`, `src/tools/toggle/toggle-shortcuts.ts:49,62,75` | Yes, by AST of the call sites. Names can be variables (`toolbox.ts:1232` passes `shortcut`) |
| Structural keys | `switch` over `keyCodes.*` in `src/components/modules/blockEvents/index.ts:208-254` (Backspace, Delete, Enter, arrows, Tab); `/` at `:279`; Cmd+/ at `:287` | Yes, by AST of `case keyCodes.X` in that one file |
| Other key handlers | Undo/redo (`src/components/modules/uiControllers/controllers/keyboard.ts:68-77`), find (`src/components/modules/find/index.ts:466-483`), find-bar options (`find-bar.ts:508-510`) | No single registry. Listed by hand |
| Markdown typing shortcuts | `handle*Shortcut` / `handle*Markdown` methods in `src/components/modules/blockEvents/composers/markdownShortcuts.ts:211-847` (list, inline marks, link, header, toggle header, toggle, divider, quote, code) | Yes, by AST of method names |
| Typing triggers | Composer files in `src/components/modules/blockEvents/composers/` (`emojiTrigger.ts`, `pageReferenceTrigger.ts`, …) | Yes, by file list |
| Drag and drop outcomes | `DropTarget.edge: 'top' \| 'bottom' \| 'left' \| 'right'` (`src/components/modules/drag/target/DropTargetDetector.ts:16-24`), drop-into zone (`:21-23`), Alt = duplicate (`src/components/modules/drag/DragController.ts:365`, `:829`) | Yes, by AST of the union plus two fixed flags |
| Existing programmatic API | `Blocks` API methods in `src/components/modules/api/blocks.ts:98-1162` (`insert`, `insertAt`, `create`, `move`, `moveTo`, `update`, `delete`, `render`, `importMarkdown`, `exportMarkdown`, `scrollToBlock`, …) | Yes, from `types/api/blocks.d.ts` |

### 2.3 Measured gaps (one-off scans, not tests)

I ran a read-only TypeScript-AST scan over `src/` (excluding `src/playground`, `src/stories`) on `fb62db72`:

- **Popover item literals with `onActivate`: 90. Of those, 65 carry a `name`.** Unnamed ones cluster in `src/tools/table` (18 literals, 6 named), `src/tools/database` (4, 0), `src/tools/tabs` (3, 0), `src/tools/quote` (2, 0), `src/tools/list` (1, 0), `src/tools/code` (3, 1). Example: the table row/col popover items at `src/tools/table/table-row-col-popover.ts:99-115` have `title` and `onActivate` but no `name`.
- **Raw click/pointerdown/mousedown listeners** (grep): `tools/image` 43, `tools/video` 23, `tools/database` 19, `tools/table` 14, `tools/audio` 12, `tools/callout` 10, plus smaller counts elsewhere. **Keydown listeners in `src/tools`: 55.**

So menu items are mostly enumerable. Tool-internal DOM UIs (image darkroom, media controls, database views) are not. The law has to treat those two cases differently (3.1.3).

### 2.4 Test infra and CI budget

- Vitest `unit` project runs `test/unit/**/*.test.ts` in jsdom (`vitest.config.ts:55-67`, include glob at `:61`). Anything under `test/evals/` is outside that glob.
- Playwright: `testDir: 'test/playwright/tests'`, timeout 15 s, `failOnFlakyTests: true`, fixture page served on port 4444 (`playwright.config.ts:212-272`; `test/playwright/tests/helpers/ensure-build.ts:11`). A spec not named in a project list lands in `chromium-default` (`playwright.config.ts:243-251`).
- Collab browser harness: `test/playwright/tests/helpers/collab.ts:8-45`. BroadcastChannel relay, **two clients max**, and it does **not** model the identities frame (type 107) or presence (`:41-45`). So it cannot test "the agent shows up as a participant".
- Real collab server is C#: `packages/server/dotnet/Blok.Server` (`yarn serve` starts it, per CLAUDE.md).
- A test can start that server on its own. `test/unit/server-conformance/run-against.ts:159` exports `startServer`. `scripts/test-server-conformance.mjs:170` sets `BLOK_CONFORMANCE_SERVER` to the built binary. Verified (06 05-Q12).
- `DocumentStore` runs with no editor and no DOM. It is built bare in `src/components/modules/collaboration/headless-offline-page.ts:31`. It loads and dumps blocks with `fromJSON` (`src/components/modules/yjs/document-store.ts:239`) and `toJSON` (`:353`, returns `YjsOutputBlockData[]`). Verified. Whether `toJSON` output maps one-to-one onto `OutputData` blocks is unverified (Q-new-1).
- Saved blocks carry `lastEditedBy?: string` (`types/data-formats/output-data.d.ts:106`) and `lastEditedAt?: number` (`:100`). Verified.
- Server-side JS runtime: `src/view/server-runtime.ts:375` (`invoke(operation, inputJson)`), built by `scripts/build-server-runtime.mjs:67-70`, embedded in Jint (`packages/server/dotnet/Blok.Server/Blok.Server.csproj:48-49`, `Blok.Server/Runtime/JintBlokRuntime.cs`). Today it only converts (markdown/html/text); it has no edit operations. v1 adds two ops, `manifest` and `agentExecute` (06 §7.2) (D1: Jint in v1).
- The bundle's build test is `test/unit/scripts/build-server-runtime.test.ts`. Its cases run the bundle in a realm with no host globals (e.g. `:40`, `:72`). It has no size check today (grep for `size|length|bytes`). The generated bundle is 689,655 bytes on disk (`packages/server/dotnet/Blok.Server/Generated/blok-server-runtime.js`, `ls -la`; the commit it was built from is unverified). Verified.
- C# Jint tests live at `packages/server/dotnet/Blok.Server.Tests/Runtime/JintBlokRuntimeTests.cs`. Verified the file exists.
- Page fields: `DocumentStore.page` returns the Yjs `page` map (`document-store.ts:222`); `pageFromJSON` writes it (`:227-232`); `readPageFields` / `writePageField` are in `src/components/modules/yjs/page-fields.ts:25`, `:35`. Verified.
- The page block's menu has named items `page-edit-icon`, `page-rename`, `page-open-new-tab`, `page-open-side-peek` (`src/tools/page/index.ts:315`, `:324`, `:337`, `:356`). Verified.
- Document comparison exists: `diffOutputData(before, after, options)` (`src/view/diff-output-data.ts:132`) diffs by block id with rich-text canonicalization.
- Document schema exists: `blokDocumentSchema` (`src/view/document-schema.ts:1-15`, exported at `src/view/index.ts:24`), drift-tested against each tool's real `save()` (`test/unit/view/document-schema.test.ts:1-11`). Its header says it is used "to constrain LLM structured output".
- Block ids are random: `generateBlockId = nanoid(10)` (`src/components/utils/id-generator.ts:17-21`). No seed. This matters for parity (3.2.1).
- CI budget: every job under 7 minutes (memory, user goal). The approved exception is a scheduled job: `mutation.yml` runs a nightly `sweep` with `timeout-minutes: 330` on cron `17 3 * * *` (`.github/workflows/mutation.yml:13-14`, `:113-116`), and keeps its ledger as an artifact with `retention-days: 90` (`:109`).
- `package.json` scripts (read): `test`, `e2e`, `mutate`, no eval script. `package.json` must not be edited without an explicit request (CLAUDE.md, Configuration).

### 2.5 LLM / eval infra today

**None.** A grep of `src packages scripts test .github` for `anthropic|openai|ANTHROPIC_API_KEY|modelcontextprotocol|llm` finds only an LLM-friendly migration guide (`src/cli/index.ts:9`, `src/cli/commands/migration.ts:5`) and the schema comment (`src/view/document-schema.ts:8`). No SDK dependency, no API key secret referenced, no eval runner.

---

## 3. Design

### 3.1 The coverage law

File: `test/unit/architecture/agent-coverage-law.test.ts`. Data: `test/unit/architecture/agent-coverage.ledger.ts`.

The law builds the contract in Node: `buildToolManifest` over a snapshot from `BUILT_IN_BLOCK_DESCRIPTIONS`, then `buildAgentContract(manifest, COMMANDS, { runtime: 'node', services: [] })` (06 §3.6, R3-1, 04-Q9). It reads command names from `contract.commands` and tool facts from `contract.manifest.blocks`.

#### 3.1.1 Capability ids

Each enumerator emits capability ids. An id is a stable string, `<source>:<key>`:

| Source | Id shape | Enumerator |
|---|---|---|
| `insert` | `insert:<tool>` or `insert:<tool>/<entryName>` | For each tool in `defaultBlockTools` + `page`, read `toolbox` (single or array). One id per entry |
| `format` | `format:<inlineTool>` | Keys of `defaultInlineTools` |
| `tune` | `tune:<name>` | Tune classes (`isTune`), plus the literal `name:` values in `blockSettings.ts` |
| `menu` | `menu:<tool>/<itemName>` | AST of every object literal with `onActivate` under `src/tools/<tool>/`. A template name (`block-color-${…}`, `src/components/shared/block-color.ts:129`) yields its static prefix with `*` |
| `action-union` | `action:<tool>/<type>` | AST of exported discriminated unions named `*Action` under `src/tools/` (today `RowColAction`) |
| `shortcut` | `shortcut:<file>/<name>` | AST of `Shortcuts.add` calls. A non-literal `name` yields `shortcut:<file>/<dynamic>`; the dynamic set is covered by the `insert` ids (tool shortcuts open a tool) |
| `key` | `key:<KEY>` | `case keyCodes.X` labels in `blockEvents/index.ts`, plus `/` and the hand list (undo, redo, find) |
| `typing` | `typing:<handler>` | `handle*` methods of `MarkdownShortcuts` + composer file names |
| `drag` | `drag:<edge>`, `drag:into`, `drag:duplicate` | Members of `DropTarget['edge']` + two fixed outcomes |
| `api` | `api:blocks.<method>` | Method names of the published `Blocks` interface in `types/api/blocks.d.ts` |
| `ui-file` | `ui-file:<path>` | Every file under `src/tools/` that calls `addEventListener` with `click`, `pointerdown`, `mousedown` or `keydown` (see 3.1.3) |

Every enumerator runs on real source. None is hand-typed, except the short `key` hand list, which carries a comment naming the files it mirrors.

These ids are what 02's `ToolActionDeclaration.mirrors` holds (06 §3.4, 05-Q7). Example: `mirrors: ['menu:table/insert-row-above']`.

#### 3.1.2 The ledger

```ts
// test/unit/architecture/agent-coverage.ledger.ts
export type Coverage =
  | { command: CommandName }                     // a core command or a tool action, by contract name
  | { commands: CommandName[]; note: string }    // the capability is a composition
  | { field: `${string}.${string}` }            // '<registryKey>.<field>': one schema-checked data field (06 C4)
  | { exempt: ExemptCategory; reason: string };

export type ExemptCategory =
  | 'view-only'        // changes nothing in the document (scroll, find highlight, hover card)
  | 'clipboard'        // writes the OS clipboard (copy-link)
  | 'chrome'           // editor UI state, not content (menu title, open/close a popover)
  | 'read-only-info'   // shows metadata (edit-metadata footer)
  | 'gesture-alias'    // another id already covers the same effect (Cmd+D = duplicate)
  | 'cut-v1';          // a v1 scope cut the user can revisit (D6), e.g. view-state control

export const LEDGER: Record<CapabilityId, Coverage> = {
  'insert:table': { command: 'table.create' },
  'action:table/insert-row-above': { command: 'table.insertRows' },
  'menu:image/size-*': { field: 'image.size' },
  'tune:copy-link': { exempt: 'clipboard', reason: 'Writes the OS clipboard; the agent reads block ids from the document view.' },
  'drag:left': { command: 'column_list.create' },
  'menu:page/page-rename': { command: 'page.rename' },
  'menu:page/page-edit-icon': { command: 'page.setIcon' },
  'menu:page/page-open-side-peek': { exempt: 'view-only', reason: 'Opens another page in a panel; this document does not change.' },
  'api:blocks.scrollToBlock': { exempt: 'view-only', reason: 'Moves the viewport only. caret.set is not in v1; following the agent is the host follow option (06 C14).' },
  // …
};
```

The `menu:page/*` ids come from the named items at `src/tools/page/index.ts:315-356`. The page block's rename and icon items change **another** page, so they map to `page.rename` / `page.setIcon`. This document's own title and icon map to `doc.setTitle` / `doc.setIcon` (06 §10.1). No UI calls the page map today (06 §10.1 facts), so no capability id maps to `doc.set*` yet; the parity corpus covers them (D6: page title and icon kept in v1). View-state UI items (database sorts, filters, view layout) are enumerated and exempt as `cut-v1` with the reason "view-state control cut from v1, user can revisit" (06 §11 item 12) (D6). The `insert:table`, `image.size` and `menu:image/size-*` rows are examples. Real ids come from the enumerators. Real command names come from 01 §5.1 and 02 §3.8. `table.create`, `table.insertRows` and `column_list.create` are 02 §3.8 names after 06 C5's rename (`columns.*` → `column_list.*`). That `image.size` is a field write is 06's answer to 02-Q12. Its exact ledger id is unverified until the enumerator runs.

A capability id listed in any action's `mirrors` (`contract.manifest.blocks[].actions[].mirrors`) is **auto-covered** by that action and needs no ledger row (05-Q7).

`{ command: 'block.update' }` is **not** a valid entry (06 C4). A generic data patch is a field write and must use the `{ field }` kind. Anything 02 routes as a tool action must map to that action.

The law asserts, in this order (the defect assertion first, per the repo's mutation-test rule):

1. **Uncovered:** every enumerated id has a ledger entry or is auto-covered through `mirrors`. The message lists each missing id, the file and line it came from, and the ways out (add an action with `mirrors`, add a ledger row, or exempt with a category and reason).
2. **Dangling:** every `command` / `commands` name exists in `contract.commands`. Every `mirrors` id is one the enumerators still emit. A renamed or removed command, or a stale mirror, fails here.
3. **Field rows are real field writes:** for `{ field: 'k.f' }`, the manifest entry `k` exists, `f` is a property of its `data` schema, and `f` is not in its `viewState` or `guardedFields` (06 C4; field names from 02 §3.6). `{ command: 'block.update' }` fails here too.
4. **Stale:** every ledger key is still enumerated (pattern of `paste-stamp-law.test.ts:210-221`). A ledger row for an id that is also auto-covered through `mirrors` is stale.
5. **Exemption quality:** `reason` is non-empty and does not repeat the category word alone. `gesture-alias` must name the id it aliases, and that id must be covered by a command, an action or a field. `cut-v1` must name the D6 cut it follows.
6. **Menu items have names:** every `onActivate` literal under `src/tools/` has a `name`, or is listed in `UNNAMED_MENU_ITEMS: Record<file:line-anchor, reason>`. Today 25 are unnamed (2.3). Adding `name` is also what lets `data-blok-item-name` e2e locators find them (`popover-item.d.ts:210-213`), so the fix is useful on its own.
7. **Scan self-checks:** each enumerator returns more than a floor (e.g. `insert` ≥ 20 ids, `menu` ≥ 60), so a broken scan cannot pass empty.

**Landing order (R2-05-4).** Assertion 6 and the naming of all 25 unnamed items land **first**, in their own commit. An unnamed item has no stable `menu:` id, so no action can mirror it. Only then does 02 fill `mirrors`, and only then does the `mirrors` auto-cover in assertions 1, 2 and 4 switch on. Until then, assertions 1–4 read the ledger only.

Source-text scans skip under Stryker with `it.skipIf(isInstrumented())`, as `paste-stamp-law.test.ts:210` does.

Scope (06 answer to 02-Q12, §11 item 12): the law counts only human-reachable UI. No action is declared for view-state UI in v1 (02-Q5); those ids are `cut-v1` exemptions, so they come back into view when the cut is lifted (D6: view-state control cut, user can revisit).

#### 3.1.3 What code cannot enumerate: the file-level audit gate

Raw DOM listeners in tool UIs cannot be mapped one by one. Image alone has 43 (2.3). Instead the law works at file level:

- Every `ui-file:<path>` id must appear in the ledger as `{ commands: [...], note }` (the actions that file's UI performs) or as an exemption. It can also be auto-covered when an action lists it in `mirrors`.
- A **new** interactive file therefore fails the law until someone audits it and writes down which commands cover it.
- An **existing** file that gains a new button does not fail. This is a known blind spot. The eval suite (3.3) and 02's per-tool action list are the backstop. I accept it rather than a per-listener count ratchet, which would fail on every refactor.

The first ledger is written by hand during implementation. It is an audit: every interactive tool file is opened, every capability is listed, and each is mapped to a 02 action or field. Where no action exists and 02 §3.4 says one is needed, that is a gap for 02 to fill, not an exemption. The audit output is the list of 02 actions that must exist on day one.

#### 3.1.4 Mutation-verifying the law

Two layers:

- **Fixture tests** inside the law, one per enumerator, in the style of `tool-tail-append-law.test.ts:99-114`. Each feeds a source string with a planted capability (a toolbox entry, an `onActivate` literal, a `Shortcuts.add`, a new `edge` member, a new `*Action` union member) and asserts the enumerator returns it. Each also feeds a near-miss that must NOT be returned.
- **A manual mutation checklist** run once when the law lands, recorded in the commit message: (a) delete one ledger entry → red at assertion 1; (b) rename a command in the contract → red at 2; (c) point a `{ field }` row at a `guardedFields` key → red at 3; (d) remove a toolbox entry → red at 4; (e) strip `name` from a named menu item → red at 6; (f) empty the `src/tools` walk root → red at 7; (g) drop a `mirrors` id from an action → red at 1.

### 3.2 Contract tests

#### 3.2.1 Runner parity: one batch, one document, five runners

Corpus: `test/fixtures/agent-commands/*.json`. Each case is:

```ts
type RunnerName = 'editor' | 'json' | 'store' | 'jint' | 'room';

interface ParityCase {
  name: string;
  seed: OutputData;                 // start document; may carry the optional `page` field (06 §10.1 A)
  batches: AgentBatch[];            // 06 §3.2, applied in order
  expect?: 'ok' | { errorCode: AgentErrorCode };   // a case can pin a rejection too
  /** Per-runner outcome where 06 says runtimes differ (history.undo, runtime:'editor'). */
  expectByRunner?: Partial<Record<RunnerName, 'ok' | { errorCode: AgentErrorCode }>>;
}
```

Cases never pin a concrete `expectRevision` value. Its meaning differs per runtime: a content hash in stored mode (Node and Jint), an update counter in live Node, the journal head `lineage:sequence` in a C# room (06 R2-04-1).

Runners (06 C1, §7.5):

| Runner | How | Job |
|---|---|---|
| `json` — `JsonApplier` (Node) | Vitest, `// @vitest-environment node`, `createDocumentAgentSession({ document: seed, … })`, then `output()` | unit (per commit) |
| `store` — `StoreApplier` (Node) | Vitest, `// @vitest-environment node`, `createStoreAgentSession` over a bare `DocumentStore` loaded with `fromJSON(seed.blocks)` (`document-store.ts:239`) and `pageFromJSON(seed.page)` (`:227`). Result read with `toJSON()` (`:353`) and `readPageFields(store.page)` (`page-fields.ts:25`). No socket | unit (per commit) |
| `editor` — `EditorApplier` | One Playwright spec, `test/playwright/tests/agent/command-parity.spec.ts`. It opens `editor.agent.begin(...)` (03) on the fixture page and calls `execute` per batch, one test per case (D4: `editor.agent` approved) | e2e, `chromium-default` |
| `jint` — C# stored | A C# test beside `Blok.Server.Tests/Runtime/JintBlokRuntimeTests.cs`. It runs each case through `IBlokAgentExecutor.ExecuteAsync` and compares `DocumentJson` with the golden (06 §7.3, §7.5) (D1) | server tests (per commit) |
| `room` — C# live | A C# room test. It seeds a scratch room, runs each case through `ExecuteInRoomAsync`, and compares `ExportAsync` output with the golden (06 §7.4, §7.5) (D1a: (b), live C# in v1) | server tests (per commit) |

The C# runners land in the order the C# path is built: `jint` first, then `room` (06 §7.6, §11 item 13) (D1a). The corpus files are shared. The C# tests read the same `test/fixtures/agent-commands/*.json`.

The `room` runner also gets one concurrency case from 06 §7.5: a `block.move` while a second client types inside the moved block keeps both edits. It is C#-only, because the other runners have no second client.

Each runner writes its final document, and the `DocumentView` (01 §3.11), into a normalized form:

- caller-chosen ids are kept as they are. Cases name new blocks with `ref` / `$ref` or with `block.insert`'s optional `id` (05-Q1);
- tool-minted inner ids (table cells) stay random, so those are replaced by tree-position labels (`b0`, `b0.1`, …), and every reference to them (parent, `contentIds`, ids inside data) is renamed the same way (05-Q1);
- tool-minted data fields that have no pure `normalize` yet are ignored, from one listed set with a reason per entry. Each entry leaves the set when its tool ships `normalize` (06 answer to 01-Q11; table ids are the known case, 06 C17);
- `time`, `version`, `createdAt`, `lastEditedAt` dropped. Creation time is assigned by each runtime and is not part of content parity. `createdBy` and `lastEditedBy` stay in the comparison;
- the top-level `page` field is kept and compared (06 §10.1 A);
- rich text canonicalized to segments (reuse the canonicalizer behind `diffOutputData`, `src/view/diff-output-data.ts:139-142`). This also absorbs the HTML that the editor snapshot and `DocumentStore` serialize (06 C16).

The `json` result is checked in as a golden file per case. Every other runner compares against that one golden. 06 §7.5 names a separate `StoreApplier` golden for the `room` runner; one golden is enough, because `store` must already equal it. On mismatch, the Node failure prints `diffOutputData(golden, actual)`. The C# failure prints both normalized JSON texts; a C# diff helper is unverified.

Page fields (06 §11 item 9) (D6: page title and icon kept in v1): cases for `doc.setTitle` and `doc.setIcon` run on every runner, including both C# runners. Set, change and clear (`''` and `null`) each get a case. The `room` runner's output is how the "page root lockstep" between C# and `page-fields.ts` is checked here; 01 and 04 own the C# fixture tests themselves.

Every eval task's `reference` batches are also parity cases (06 answer to 01-Q9).

Coverage of the corpus (06 answer to 03-Q13): a command is "reachable" when it is listed in the contract and covered by at least one parity case. The law (3.1) gets one more assertion: every name in `contract.commands` appears in at least one parity case. Exemptions, each with a reason, use `expectByRunner`:

- One rule (06 R3-1): a command with `available: false` in a runner's contract expects `COMMAND_UNAVAILABLE` there; a name not in the contract expects `UNKNOWN_COMMAND`. No built-in action is `runtime: 'editor'` today; a host fixture tool's `runtime: 'editor'` action runs on `editor` only and expects `COMMAND_UNAVAILABLE` (`reason: 'runtime'`) on `json`, `store`, `jint`, `room`.
- Actions whose `requires` service is absent expect `COMMAND_UNAVAILABLE` (`reason: 'service'`) on that runner. A `prepare` step alone does not make an action unavailable, in Jint either: `uses`-only `setSource` actions run there and store the URL as given (06 R3-3).
- `history.undo` / `history.redo` expect `COMMAND_UNAVAILABLE` on `jint` (stateless per call, 06 §7.2), `store` and `room` (live rooms, D6: headless undo in live rooms cut). They run on `editor` and `json` (stored snapshot undo, 06 C11).
- Headless `page.rename` / `page.setIcon` is a cross-document write, opt-in per deployment (`pageTitles: 'page-map'`, 06 §10.1 B). The corpus has one document per case, so this form is not a parity case. 04 and 01 test it.

#### 3.2.2 Server bundle size

06 §7.1 adds the planner, contract and ports to the Jint bundle. Its growth is unmeasured. `test/unit/scripts/build-server-runtime.test.ts` gets one more case: it builds the bundle and asserts its byte size is at most a checked-in budget. The budget is set from the first build that contains the agent code, plus a margin written next to it with a reason. The test prints the size on failure. Raising the budget is a reviewed edit, like the `--update-baseline` rule in 3.3.8. Today's size, 689,655 bytes (2.4), is the "before" number for that first review.

#### 3.2.3 One contract, one renderer, two option sets

There is one pure renderer, `renderAgentTools(contract, options)` in `src/agent/render-tools.ts` (06 §3.7). The test imports it from source (06 C13).

Test (unit, per commit): `test/unit/agent/render-tools-parity.test.ts`.

1. Build the contract from the default registry plus one fixture host custom tool (so the custom-tool path is covered).
2. Render twice:
   - in-app: `renderAgentTools(contract, { format: 'anthropic' })`;
   - MCP: `renderAgentTools(contract, { format: 'mcp', handle: true })` (06 revision 04-1).
3. Assert both give exactly the three core tools, `blok_read`, `blok_describe`, `blok_execute` (06 C2).
4. Build both contracts from the same snapshot and services. Assert, per tool: same description text, and deep-equal input JSON Schema after two declared differences are removed first: the MCP `handle` property, and commands whose `available` differs between the `editor` and `node` contracts (06 R3-1; today only `history.*` differs, and only for live handles, which the static tool list does not show). (The input schema key is `input_schema` for Anthropic and `inputSchema` for MCP, 06 §3.7.)
5. Assert the `blok_execute` command names equal the `available: true` names of the contract each surface rendered from (06 R3-1). No rendered command exists that the contract does not list. This is the brief's "neither may invent a command".
6. Assert `blok_execute` never carries `strict` (06 answer to 03-Q6).
7. Run steps 2–5 once per schema mode, `'envelope'` and `'full'`. Both surfaces use the same mode (06 C2).
8. A golden snapshot of the default contract is checked in. Changing a description or schema shows up in review as a diff.

The three MCP lifecycle tools are rendered by 04 only and are out of this test.

#### 3.2.4 Saved output stays valid

Every parity case's final document must validate against `blokDocumentSchema`. That schema is already drift-tested against real `save()`, so this ties command output to the published saved format.

#### 3.2.5 Adapter parity

03 adds `adapter-blok-instance-law.test.ts` (03 §6 item 12; 06 answer to 05-Q5). This spec does not duplicate it.

### 3.3 Agent eval suite

#### 3.3.1 Layout

```
test/evals/agent/
  tasks/<id>.ts          one task per file
  graders/*.ts           pure functions over a document + a command log
  runner/                model loop, surfaces, reporting
  baseline.json          checked-in pass rates
```

`test/evals/` is outside the unit glob (`vitest.config.ts:61`) and the Playwright `testDir` (`playwright.config.ts:213`). Nothing here runs in normal CI by accident.

#### 3.3.2 Task shape

```ts
interface EvalTask {
  id: string;
  prompt: string;                         // what a user would type
  surface: 'in-app' | 'in-app-browser' | 'mcp-stored' | 'mcp-live';
  seed: OutputData;                       // start document
  tools?: 'default' | ToolRegistryFixture;
  graders: Grader[];
  reference: AgentBatch[];                // a correct solution, written by hand; also a parity case
  knownBad: OutputData[];                 // documents the graders must reject
  budget: { maxTurns: number; maxOutputTokens: number };
}

type Grader = (input: {
  seed: OutputData;
  final: OutputData;
  log: readonly CommandLogEntry[];        // from AgentSession.log() (06 §3.5)
  results?: readonly AgentResult[];       // MCP: AgentResult & { delivery } per blok_execute call
  answer?: string;                        // the model's final message
}) => { pass: boolean; detail: string };
```

`CommandLogEntry` is 06's canonical shape: `{ batch, index, name, args, result?, error?, actorId }` (06 §3.5). Graders read the log from `AgentSession.log()`, which exists in every runtime (06 answer to 05-Q2).

#### 3.3.3 Graders

All graders are deterministic code. No LLM judge.

- `schemaValid` — final document validates against `blokDocumentSchema`.
- `shape(query)` — a small structural query over the tree: block type, parent, child order, count. Example: "one `column_list` with two `column` children; column 2 holds a `table` with ≥ 3 rows".
- `text(query, matcher)` — normalized plain text of a block (whitespace collapsed, case kept).
- `marks(query, range, marks)` — given segments carry the given marks.
- `noMarkdownResidue` — scans every rich-text segment for Markdown fingerprints: `**x**`, `__x__`, `` `x` `` pairs, a line starting with `#{1,6} `, `- `, `* `, `1. `, `> `, a `|---|` row, a ```` ``` ```` fence, `[x](url)`. A match fails. Fingerprints that a task legitimately types as literal text are listed per task. It also fails if the log holds a `LOOKS_LIKE_MARKDOWN` warning (06 §3.2) that the agent never acted on.
- `untouched` — blocks the task did not ask to change are unchanged: `diffOutputData(seed, final)` reports no change on ids outside an allowed set. Ids of new blocks are known from `refs` and `changed` in each result (06 C8).
- `logClean` — the log has no unhandled error at the end, and no batch was retried more than N times.
- `usedAction(name)` — where a task is about a tool action (e.g. `table.mergeCells`), the log shows that action, not a raw data overwrite of the whole block. This checks the agent found the feature, not just the outcome.
- Collab only:
  - `humanPreserved` — every character the scripted human typed is present.
  - `agentVisible` — the agent appeared in the room's participants with its name, and the human's page saw the agent's `agentCursor` awareness field on a block the agent touched. A block-level cursor is enough; offsets are not required (06 §10.2, §11 item 11).
  - `attributed` — every block the agent touched has saved `lastEditedBy` equal to `actor.id`, and every block only the human touched keeps the human's id (06 C3, 05-Q11). In rooms with an MCP agent, the journal `actors` must name the agent too. An in-app agent in a room rides the human's socket, so its journal names the human; that split is accepted (06 C3).
- MCP only: `ackedOnly` — no result reported `delivery.durable: true` for work the server did not ack (06 answer to 04-Q16).

Grader self-test (per commit, no model): for every task, apply `reference` to `seed` with `createDocumentAgentSession` and assert all graders pass; run graders over each `knownBad` and assert at least one fails. File: `test/unit/agent/eval-graders.test.ts` (in the unit glob on purpose, so it is per commit). This keeps tasks honest when commands change, and mutation-verifies the graders.

#### 3.3.4 Starting task list

| Id | Surface | Prompt (short) | Key graders |
|---|---|---|---|
| `markdown-regression` | in-app, mcp-stored | "Add a section 'Plan' with a bold intro, three bullets, and a code sample" — the exact kind of request where agents wrote `## Plan\n**intro**\n- a` into one paragraph | `noMarkdownResidue`, `shape` (header + paragraph + 3 list items + code), `marks` (bold on intro) |
| `markdown-import` | mcp-stored | Seed has one paragraph holding a pasted Markdown note. "Turn this into proper blocks." | `noMarkdownResidue`, `shape`, `untouched` for other blocks. Accepts either `markdown.insert` or hand-built blocks |
| `two-column-table` | in-app | "Build a two-column comparison of Plan A and Plan B, with a table of costs in each" | `shape` (column_list → 2 columns → header + table), table rows ≥ 3, `schemaValid` |
| `database-status` | in-app | "Add a tasks database with a Status property (Todo/Doing/Done) and 3 rows" | `shape` (database with 3 `database-row` children), property type `select` with 3 options, each row has a status value |
| `format-range` | mcp-stored | "Bold 'quarterly' and link 'report' to https://example.com in the second paragraph" | `marks`, `untouched` |
| `toggle-nest` | in-app-browser | "Put the three FAQ paragraphs into a toggle titled FAQ" | `shape` (toggle with those 3 ids as children, order kept), `untouched` text |
| `table-ops` | in-app-browser | "Add a header row, merge the first two cells of row 2, delete the last column" | `usedAction` for `table.mergeCells` and `table.deleteColumns`, `shape` |
| `convert` | mcp-stored | "Make every line that starts with 'TODO' a checklist item" | `shape`, `text`, `noMarkdownResidue` |
| `move-into-column` | in-app | "Move the image into the right column" | `shape`, image data unchanged. `block.move` (06 answer to 01-Q7) |
| `read-and-answer` | mcp-stored | "Which headings mention 'budget'? Reply with their ids." | `answer` equals the expected id set; document unchanged |
| `custom-tool` | in-app-browser | Registry includes a fixture host tool with one declared action. "Add a rating block set to 4" | `shape`, `usedAction`. Browser only: custom action handlers outside the browser are cut from v1 (06 answer to 01-Q5) (D6: cut, user can revisit) |
| `live-coedit` | mcp-live | A scripted human types into paragraph 1 while the agent is asked to add a summary list below it | `humanPreserved`, `agentVisible`, `attributed`, `ackedOnly`, `shape` |
| `stored-lifecycle` | mcp-stored | "Open doc X, add a closing paragraph, and save" | `blok_list_documents` → `blok_open` → `blok_execute` → `blok_close` in the log; saved file has the paragraph; `ackedOnly` (06 answer to 04-Q16) |
| `page-title-icon` | in-app, mcp-stored | "Rename this page to 'Q3 plan' and give it a 📅 icon" | final `page.title` and `page.icon` equal the asked values; blocks `untouched`; the log shows `doc.setTitle` and `doc.setIcon` (06 §10.1 A, §11 item 10) (D6: page title and icon kept) |
| `live-lifecycle` | mcp-live | "Join room X, add a heading at the end, then leave" | `blok_open` → `blok_execute` → `blok_close`; the agent leaves the participants list; `ackedOnly`; nothing durable that was not acked (04-Q16) |

Fifteen tasks is the start. Add a task when a real user report shows an agent failing.

`in-app` tasks run in Node against a document session with the same tool definitions the browser uses. `in-app-browser` tasks run in Playwright and are the subset that covers `EditorApplier` (06 answer to 05-Q4).

#### 3.3.5 The envelope-vs-full eval

06 C2 leaves the shipped default of `RenderOptions.schema` to this eval (03-Q12, 04-Q15).

- Run every non-live task in both modes, `'envelope'` and `'full'`, with the same model and trial count.
- Report pass@1 per task per mode, and total input tokens per mode.
- Rule: the mode with the higher mean pass@1 wins. On a tie within one trial's worth, `'envelope'` wins, because it is smaller.
- The result is recorded in `baseline.json` with the model id. It is run once before release, and again when the model changes.

#### 3.3.6 How it runs

- **Model loop.** The runner sends the prompt with `renderAgentTools` output (in-app) or connects to 04's MCP server (mcp-*). It executes tool calls, feeds results back, and stops at a final message or `budget.maxTurns`.
- **in-app** runs in Node: `createDocumentAgentSession` behind the three core tools.
- **in-app-browser** runs in Playwright on the fixture page through `editor.agent.begin(...)` (03) (D4: approved). The turn must not pass `attributeTo: 'user'` (03 §3.8), or `attributed` cannot pass.
- **mcp-stored** starts `blok-mcp` from `@bloklabs/mcp` (D2: approved) against a temp directory of seed JSON files. Edits go through `JsonApplier` (06 C1).
- **mcp-live** needs the real C# room. The BroadcastChannel harness cannot do it: it has no identities frame and a two-client cap (`collab.ts:25-45`). The runner starts the room server with `startServer` from `test/unit/server-conformance/run-against.ts:159` (06 answer to 05-Q12). It opens one Playwright page as the human (scripted typing with fixed timing) and connects the agent through 04, whose ticket `user` equals `actor.id` (06 C3). Edits go through `StoreApplier`. This task is the slowest.
- **Trials.** Each task runs 3 times. Report pass@1 (mean) and pass^3 (all three pass). Model output varies, so a single run is not a measurement.
- **Model.** Configurable by env. The default model id is not fixed here; it is chosen when the runner lands.
- **Dependency.** The runner needs a model SDK and an MCP client library. Both are new devDependencies, and `package.json` is protected. Package names are unverified. D2 approves the `package.json` edits for `@bloklabs/mcp` itself (06 §5). D3 also approves the eval-runner devDependencies in the root `package.json` (a model SDK and an MCP client) and one API key secret for the manual-dispatch workflow (06 D3, R3-10).

#### 3.3.7 Where and when

- **Not per commit.** Real model calls cost money, are slow, and vary.
- New workflow `.github/workflows/agent-evals.yml` with `workflow_dispatch` only, inputs `tasks` (filter), `trials` and `schema`. No `schedule` trigger (D3: manual only). A manual job is outside the per-commit 7-minute budget, like the scheduled sweep in `mutation.yml` (`:13-14`, `:113-116`). The job needs an API key secret. The repo references none today (2.5).
- Locally: `node test/evals/agent/runner/run.mjs --tasks markdown-regression --trials 3`. A `yarn eval` script can be added only if the user approves a `package.json` change.
- **Cost.** Unmeasured. Cost per full run = tasks × trials × (input + output tokens per run) × model price. 06 D3 (round 3) counts 15 tasks × 3 trials = 45 runs per full run, plus a one-off 13 non-live tasks × 3 trials × 2 modes = 78 for envelope-vs-full. The first run records tokens per task in its report, and that number replaces this formula. A per-run token cap (`budget.maxOutputTokens`) and a per-dispatch total cap in the runner stop a runaway loop (D3: token caps stay).

#### 3.3.8 Baseline and regression tracking

- Each run writes `results.json`: per task, per trial, pass/fail per grader, turns, tokens, command log. Uploaded as an artifact with 90-day retention (same as `mutation.yml:109`).
- `test/evals/agent/baseline.json` is checked in: per task pass@1, the model id it was measured on, and the chosen schema mode.
- The job fails when a task's pass@1 drops below its baseline by more than one trial's worth (≥ 1/3 with 3 trials), or when `markdown-regression` fails any trial. The job summary lists each task: baseline, now, failing graders.
- The baseline moves only by an explicit `--update-baseline` run committed by a person. It never moves automatically, so a slow decline cannot hide.
- A model change resets the comparison: the report says "baseline measured on a different model" instead of failing.

### 3.4 Error handling

- The law's messages always name the file:line of the capability and the allowed fixes.
- Parity failures print a diff, not two JSON blobs.
- An eval run that fails for infrastructure reasons (API error, server did not start, `ROOM_SYNC_TIMEOUT`, `SOURCE_UNAVAILABLE`) is reported as `error`, not `fail`, and does not count against the pass rate. Three infra errors in a row fail the job loudly.
- Command errors the agent caused (`AgentError` from 06 §3.2) are not infra errors. They show up in the log and the graders judge them.
- A grader that throws is a grader bug. It is reported as `error` with the stack, never as `fail`.

---

## 4. Public surface and breaking changes

Nothing published changes. All new files are tests, test data, a runner script and a workflow:

- `test/unit/architecture/agent-coverage-law.test.ts`, `agent-coverage.ledger.ts`
- `test/unit/agent/render-tools-parity.test.ts`, `eval-graders.test.ts`, the Node parity runner tests (`JsonApplier`, `StoreApplier`)
- `test/fixtures/agent-commands/*.json` + goldens
- `test/playwright/tests/agent/command-parity.spec.ts`
- C# `jint` and `room` parity tests in `Blok.Server.Tests`, reading the shared corpus
- one size case in `test/unit/scripts/build-server-runtime.test.ts`, plus its budget file
- `test/evals/agent/**`
- `.github/workflows/agent-evals.yml`

**Not breaking.** Two side effects on source:

- Assertion 6 will push authors to add `name` to 25 unnamed menu items. `name` already exists on the type and becomes a `data-blok-item-name` attribute. Adding an attribute to an item is additive. Not breaking.
- New root devDependencies (model SDK, MCP client) and one API key secret: approved under D3 (06 R3-10). Package names are picked when the runner lands.

This spec relies on public surface that 01, 03 and 04 add: `editor.agent` (D4: approved), `@bloklabs/mcp` (D2: approved), `IBlokAgentExecutor` on NuGet (D4), and the optional `OutputData.page` field (D4, 06 §10.1 A). Those specs own the release note.

---

## 5. Interfaces

### 5.1 I provide

```ts
// The capability ledger contract (test-only, not published)
export type CapabilityId = string;            // '<source>:<key>', see 3.1.1
export type Coverage =
  | { command: CommandName }
  | { commands: CommandName[]; note: string }
  | { field: `${string}.${string}` }
  | { exempt: ExemptCategory; reason: string };
export type ExemptCategory = 'view-only' | 'clipboard' | 'chrome' | 'read-only-info' | 'gesture-alias';
export const LEDGER: Record<CapabilityId, Coverage>;

// Parity corpus case
export type RunnerName = 'editor' | 'json' | 'store' | 'jint' | 'room';
export interface ParityCase {
  name: string;
  seed: OutputData;
  batches: AgentBatch[];
  expect?: 'ok' | { errorCode: AgentErrorCode };
  expectByRunner?: Partial<Record<RunnerName, 'ok' | { errorCode: AgentErrorCode }>>;
}

// Eval task and grader
export interface EvalTask { /* 3.3.2 */ }
export type Grader = (input: {
  seed: OutputData; final: OutputData; log: readonly CommandLogEntry[];
  results?: readonly AgentResult[]; answer?: string;
}) => { pass: boolean; detail: string };

// Results file written by every eval run
export interface EvalResults {
  model: string;
  commit: string;
  schema: 'envelope' | 'full';
  tasks: Array<{
    id: string;
    trials: Array<{ outcome: 'pass' | 'fail' | 'error'; graders: Record<string, { pass: boolean; detail: string }>; turns: number; inputTokens: number; outputTokens: number }>;
    passAt1: number;
    passAll: boolean;
  }>;
}
```

To 02: the capability ids that `ToolActionDeclaration.mirrors` holds (3.1.1), and the list of 02 actions that the first ledger audit says must exist (3.1.3), at implementation time.

To 03 and 04: the shipped default for `RenderOptions.schema`, from the envelope-vs-full eval (3.3.5).

### 5.2 I consume

All shapes are 06's canonical contract (06 §3). No assumptions remain about their form.

| From | What | Shape (06 section) |
|---|---|---|
| 01 | Envelope, result, errors, warnings | `AgentCommand`, `AgentBatch`, `AgentResult` (with `changed`, `lastRange`, `refs`), `AgentError`, `AgentErrorCode`, `AgentWarningCode` (§3.2) |
| 01 | Command names | `CoreCommandName`, `ToolCommandName = \`${registryKey}.${action}\``, `RESERVED_NAMESPACES` (§3.1) |
| 01 | Sessions | `createDocumentAgentSession` (`JsonApplier`, has `output()`), `createStoreAgentSession` (`StoreApplier`), `createEditorAgentSession` (§3.5) |
| 01 | Command log | `AgentSession.log(): readonly CommandLogEntry[]` in every runtime (§3.5) |
| 01 | Ids | `ref` / `$ref` and `block.insert.id`; tool-minted inner ids stay random (05-Q1) |
| 01 | Document view | `DocumentView`, `ViewArgs` (§3.3; 01 §3.11) |
| 01 | Attribution | `lastEditedBy` = `actor.id` on touched blocks only, in every applier (C3) |
| 02 | Manifest and contract | `buildToolManifest`, `buildAgentContract`, `AgentContract`, `CommandEntry` (`runtime`, `available`, `source`) (§3.6) |
| 02 | Field facts | `BlockToolManifestEntry.data`, `viewState`, `guardedFields` (02 §3.6) |
| 02 | Coverage hook | `ToolActionDeclaration.mirrors: string[]` holding 05 capability ids (§3.4) |
| 02 | Node build | Contract builds in Node from `BUILT_IN_BLOCK_DESCRIPTIONS` (04-Q9) |
| 03 | Renderer | `renderAgentTools(contract, options): RenderedTool[]` in `src/agent/render-tools.ts`, pure, imported from source (§3.7, C13) |
| 03 | Browser surface | `editor.agent.begin(options): AgentTurn`, an `AgentSession` plus `call`, `end`, `stop` (§3.5) (D4: approved) |
| 03 | Adapter law | `adapter-blok-instance-law.test.ts` (03 §6 item 12) |
| 04 | MCP server | `@bloklabs/mcp`, bin `blok-mcp`; tools from `renderAgentTools({ format: 'mcp', handle: true })` plus three lifecycle tools (§3.7, §3.8) (D2: approved) |
| 04 | MCP result | `AgentResult & { delivery: { durable; pending; serverSequence; savedVersion } }` (§3.7). A timed-out wait is `ok: true` with `delivery.pending: true`; `DURABILITY_TIMEOUT` is gone (R2-04-2) |
| 04 | Agent cursor | Awareness field `agentCursor: { actorId, name, color?, blockId, field?, start?, end? } \| null`, published by the MCP agent in live mode (06 §10.2) |
| 01, 04 | C# path | `IBlokAgentExecutor.ExecuteAsync`, `ExecuteInRoomAsync`, `GetContractAsync`; `BlokAgentExecution(ResultJson, DocumentJson, Revision)` (06 §7.3) |
| 01 | Page fields | `doc.setTitle { title }`, `doc.setIcon { icon }`; optional `OutputData.page?: { title?, icon? }`; `doc.read` returns `page` (06 §10.1 A) |
| 04 | Live room | Agent is a room actor; ticket `user` = `actor.id`; journal `actors` names it (C3) |
| server | Room for tests | `startServer` (`test/unit/server-conformance/run-against.ts:159`) (05-Q12) |

---

## 6. Testing strategy

TDD order for implementation:

1. **Law fixture tests first.** Write each enumerator's planted-capability test. Watch it fail (no enumerator). Write the enumerator.
2. **Name the unnamed menu items.** Write assertion 6 and watch it list the 25 unnamed `onActivate` items. Name them. This lands before any `mirrors` work (R2-05-4).
3. **Law against real source.** With an empty ledger the law fails, listing every capability. That failing list is the audit worklist. Fill the ledger from it; each `command` entry stays red at assertion 2 until 01/02 ship that command. That red is the honest state. The `mirrors` auto-cover switches on only after 02 fills `mirrors`.
4. **Manual mutation checklist** (3.1.4), recorded in the commit message.
5. **Parity:** write one corpus case and the `JsonApplier` golden. Write the `StoreApplier` runner and the browser spec; they fail until 01 and 03 exist. Then the C# `jint` runner, then the C# `room` runner, in the order the C# path is built (D1a). Each fails until its `IBlokAgentExecutor` method exists.
6. **Bundle size:** add the size case to `build-server-runtime.test.ts` (3.2.2). It first fails with no budget file; the first agent-code build sets the budget.
7. **Renderer parity:** write `render-tools-parity.test.ts` against a stub contract first; it fails until `renderAgentTools` exists.
8. **Graders:** write `eval-graders.test.ts` with reference and known-bad documents per task before writing any grader body. The `markdown-regression` known-bad is the real failure: one paragraph whose text is `## Plan\n**intro**\n- a\n- b`. The `attributed` known-bad is a document where a block only the human typed in carries the agent's id (06 C3's required test).
9. **Runner** last. It is only verified by running it (manual, with a key). Its first green run sets the baseline, and the envelope-vs-full run sets the schema default.

Budgets:

- The law is a static scan plus one contract build. It belongs in the unit job and must stay well under a second or two. Unmeasured until written.
- The browser parity spec runs one test per case, on one page. It must fit the 15 s Playwright test timeout (`playwright.config.ts:214`) per case.
- The C# runners run the whole corpus in the server test job. Jint has a 10 s default per-call timeout and a 512 MiB allocation budget (`packages/server/dotnet/Blok.Server/Runtime/JintBlokRuntime.cs:16`, `:30`). Verified. Each case must stay well inside it. Unmeasured.
- Evals never run in the per-commit workflow.

Scoped runs while iterating: only the new test files (CLAUDE.md "Tests").

---

## 7. Open questions for other specs

### Resolved by 06

1. **To 01, client-chosen ids.** Resolved: yes. `ref` / `$ref`, and `block.insert` takes an optional `id`. Tool-minted inner ids (table cells) stay random, so position renaming stays for those only (3.2.1).
2. **To 01, command log.** Resolved: yes. `AgentSession.log()` in every runtime, shape `CommandLogEntry` (06 §3.5).
3. **To 01, browser-only commands.** Resolved (06 R3-1): any command with `available: false` in a runner's contract, answered with `COMMAND_UNAVAILABLE`. Today: actions whose `requires` service is absent, and `history.undo` / `redo` in Jint and in any live room (D6). Exemptions in 3.2.1.
4. **To 03, in-app evals without a browser.** Resolved: tool definitions are identical everywhere. Most in-app tasks run in Node against a document session. A small subset (`in-app-browser`) runs in Playwright to cover `EditorApplier`.
5. **To 03, adapter-parity law.** Resolved: yes, `adapter-blok-instance-law.test.ts` (03 §6 item 12).
6. **To 03 and 04, renderers.** Resolved: one pure `renderAgentTools`, imported from source; no name mapping needed (06 C2, C13).
7. **To 02, menu names as action names.** Resolved: not via popover `name`. Via `mirrors`, which lists 05 capability ids. A mirrored id needs no ledger row (3.1.2).
8. **To 02, table and database actions.** Resolved: yes for every member with UI, under 02's §3.4 rule. Exact names in 02 §3.8.
9. **To 02, Node manifest build.** Resolved: yes. `buildToolManifest` is pure and builds from `BUILT_IN_BLOCK_DESCRIPTIONS` in Node (04-Q9).
10. **To 04, Jint edit entry.** Resolved in round 2: the Jint op is `agentExecute` (06 §7.2), reached from C# through `IBlokAgentExecutor.ExecuteAsync` (§7.3). Node's stored entry is `createDocumentAgentSession` (D1: Node and Jint both in v1).
11. **To 04, where attribution lives.** Resolved: saved `lastEditedBy` on touched blocks; in rooms, the journal `actors` too, for MCP agents only (06 C3).
12. **To 04, starting the room server from a test.** Resolved: `startServer` from `test/unit/server-conformance/run-against.ts:159`; `scripts/test-server-conformance.mjs:170` sets `BLOK_CONFORMANCE_SERVER`.
13. **To all, generic update as coverage.** Resolved: `{ field: '<registryKey>.<field>' }` only for one-field effects that are not `viewState` or `guardedFields`. `{ command: 'block.update' }` is banned (06 C4).

### Still open

14. **To 01:** Does `DocumentStore.toJSON()` (`document-store.ts:353`, `YjsOutputBlockData[]`) map one-to-one onto `OutputData` blocks, including `lastEditedBy`? If not, `StoreApplier` parity needs a named converter, and 01 should say which. The same converter should add `page` from `readPageFields` (06 §10.1 A: "`DocumentStore` load and save carry it").
15. **To 02:** Will 02 keep `mirrors` ids in the published manifest (`blocks[].actions[].mirrors`)? The law reads them from there. If 02 strips them from model-facing JSON, the law needs another source.

---

## 8. Out of scope

- LLM-as-judge grading. Every grader is code.
- Per-listener coverage of raw DOM handlers in tool UIs. The file-level gate (3.1.3) plus evals cover this.
- Visual or pixel checks of agent edits. The document is the truth.
- Measuring "how humans do it" (gesture replay). The brief rules out simulated input.
- Host custom tools beyond one fixture tool. A host checks its own tools with the same law helper if it wants; shipping that helper is not part of this spec.
- Cost dashboards. The results artifact and the job summary are enough.
- Choosing the model. The runner takes it as config.
- Evals through the C# agent path. It serves a .NET host's own backend agent and has no HTTP route or MCP surface in v1 (06 §7.3). Parity covers it (3.2.1).
- Coverage and evals for v1 scope cuts (D6): file uploads (media by URL only), undo in live rooms, view-state control (ledger `cut-v1`), custom tool action handlers outside the browser, the MCP Docker image. `caret.set` stays cut by 06 C14.

---

## 9. Issues with 06

None open (closed in 06 round 3).
