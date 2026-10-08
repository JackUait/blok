# Agent Core Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One typed command layer that lets an agent read and change a Blok document, with the same result in the browser editor, in Node (stored and live), and in the C# server (stored through Jint, live through a room translator).

**Architecture:** A pure, synchronous planner in `src/shared/agent/` turns a batch of commands plus a document snapshot into a list of primitive `Edit`s. Three appliers carry out that list: `JsonApplier` (pure, over a plain document; the dry run everywhere and the stored applier in Node and Jint), `EditorApplier` (browser, through `BlockManager` and the public blocks API), and `StoreApplier` (Node, over a `DocumentStore`, for live rooms). The C# server runs the planner in Jint and translates the returned `Edit[]` into internal room ops.

**Tech Stack:** TypeScript, Vitest (jsdom and `// @vitest-environment node`), Yjs 13.6.33, parse5 (inside `src/view/` only), Playwright, C# / .NET with xUnit and Jint 4.16.4.

**Spec:** `docs/plans/2026-10-08-agent-control/01-core-commands.md`. Binding contract: `docs/plans/2026-10-08-agent-control/06-reconciliation.md` §3 and §12 (they win over any older section). Brief: `00-brief.md`.

## Global Constraints

Every task's requirements include these lines.

- Text offsets: UTF-16 code units, one unit per embed, everywhere in the contract (01 §3.9). Line breaks are `"\n"`.
- Rich text is saved and planned ONLY as segments `{ text, marks? } | { embed, marks? }` (`types/rich-text.d.ts:31-53`). The planner never sees HTML.
- `src/shared/agent/**` imports nothing from `src/components/`, `src/tools/`, `src/view/`, or `parse5`, and touches no `window` / `document` (01 §6 purity law).
- Published types are hand-authored in `types/` and import nothing from `src/` (`test/unit/architecture/published-types-no-src-refs.test.ts`).
- One error union, `UPPER_SNAKE`, copied verbatim from 06 §3.2. `DURABILITY_TIMEOUT`, `SERVICE_UNAVAILABLE` and `UNSUPPORTED_IN_RUNTIME` do not exist.
- Availability: `UNKNOWN_COMMAND` when a name is not in the runner's contract (including hidden actions); `COMMAND_UNAVAILABLE` with `details.reason: 'runtime' | 'service'` when it is listed with `available: false` (06 R3-1).
- No new `BlockOrigin` and no new Yjs transaction origin. Tool constructors see `origin: 'api'`. Headless writes use origin `'local'`.
- Every editor insert uses `yjsSync: 'add'` (`src/components/modules/api/blocks.ts:861`).
- No command moves the user's caret, selection, focus or scroll. Any internal `scrollToBlock` call passes `{ select: false }`.
- Children are explicit: given `children` win; omitted `children` use `ToolRuntime.defaultChildren`; the JSON and store appliers never seed.
- Refuse, never demote, unless the command passes `demote: true` (then a `DEMOTED` warning).
- `history.undo` / `history.redo`: `COMMAND_UNAVAILABLE` (`reason: 'runtime'`) in Jint and in every live room (D6).
- Revision: editor = counter over `YjsManager.onAnyDocUpdate`; Node live = counter over `DocumentStore.onAnyUpdate`; Node stored and Jint stored = hash of the canonical document JSON; C# live = journal head `lineage:sequence` (06 R3-5).
- Jint bundle: one entry `src/view/server-runtime.ts`, ES2020 IIFE, no host globals (no `crypto`, `atob`, `TextDecoder`, `structuredClone`). Each call has a 10 s timeout and a 512 MiB allocation budget (`JintBlokRuntime.cs:17`, `:30`).
- The public C# `/sync/{doc}/edit` wire does not change. New C# ops are internal and are never added to `CollabEditOps.Parse`.
- D5 ships as its own commit, regression test first, `BREAKING` in the subject and a `BREAKING CHANGE:` body.
- Commits go straight to `main` (trunk-based). Stage explicit paths only; never `git commit -a`. Every commit ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Lint only changed files while iterating: `npx eslint <changed files>`. Type check: `NODE_OPTIONS=--max-old-space-size=8192 yarn lint:types` (full `tsc` needs the larger heap here).
- Run only the tests a task names: `yarn test <file>`, `yarn e2e <file> -g "<pattern>"`, `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~<Class>"`.
- Do not modify `vite.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `package.json`, `.env`.
- Comments: short, plain, only for a non-obvious constraint.

## Review Focus

Inputs the spec implies but does not pin. Each line names the expected behaviour; the test that pins it is added to the named task.

1. **An offset that splits a surrogate pair** (`"a😀b"`, `start: 2`). Expect `RANGE_OUT_OF_BOUNDS` naming the field, never half an emoji in saved text. Pinned in Task 6.
2. **`find: ''`, `find: '   '` or `occurrence: 0`.** Expect `INVALID_ARGS`, never "matches everything" or a silent first match. Pinned in Task 6.
3. **A `$ref` used before the command that creates it, or two commands with the same `ref`.** Expect `BLOCK_NOT_FOUND` naming the ref for the first, `INVALID_ARGS` for the duplicate. Pinned in Task 8.
4. **Deleting every block of the document.** The editor adds a default block when the last one goes; JSON does not. Expect the same saved JSON in every applier (the editor applier passes `addLastBlock: false`). Pinned in Task 32.
5. **A `doc.read` cursor whose anchor block was deleted between pages.** Expect `INVALID_ARGS` with "re-read from the start", never a silently skipped or repeated page. Pinned in Task 12.

## Cross-plan dependencies

Names are the canonical produced names from 06 §3. "Needs" means the task cannot start before the named work lands on `main`.

**Plans 02–05 that depend on this plan:**

| Their work | Needs from this plan (task) |
|---|---|
| 02 `types/tools/tool-description.d.ts` (`ToolActionImpl`, `ToolActionContext`) | `InsertSpec`, `RichTextHelpers` in `types/agent.d.ts` (Task 1); `BlockPosition` stays in `types/api/blocks.d.ts` |
| 02 `buildAgentContract(manifest, COMMANDS, where)` | `COMMANDS` and `CoreCommandName` from `src/shared/agent/commands.ts` (Task 3) |
| 02 tool action handlers (`src/shared/tool-actions/*`) and their parity tests | `ToolActionContext` recorder (Task 14), `RichTextHelpers` impl (Task 6), the planner (Tasks 8–13) |
| 02 emptied-column helper used by `block.move` | the shared placement rules (Task 5) |
| 02 `blokDocumentSchema` page property | the decision to reuse the existing flat `OutputData.title` / `OutputData.icon` (see "Deviations", D-1) |
| 03 `AgentAPI` / `editor.agent` / `AgentTurn` | `createEditorAgentSession`, `liveContractSource`, `ContractSource` and `InternalEditorHandle` (= `BlokModules`) from `src/components/modules/agent/editor-session.ts` (Task 28); the options `attributeLastEditedBy` and `services` (Task 28a); the turn-merge lever `mergeSteps: 'turn'` (Task 29); `BlockMutationEventDetail.agent` (Task 24, published here; 03 only tests it). `turnId` defaults to the session id, so `detail.agent.turnId === session.id`. |
| 03 `renderAgentTools` | `AgentContract` built from `COMMANDS` (Task 3) and the published types (Task 1) |
| 04 `@bloklabs/mcp` stored mode | `createDocumentAgentSession` (Task 17), headless ports `createHeadlessPorts` (Task 19), the `src/mcp/` view-entry exception (Task 19) |
| 04 `@bloklabs/mcp` live mode | `createStoreAgentSession` (Task 35) |
| 04 headless `page.rename` / `page.setIcon` | `AgentPorts.openPageDocument` and its executor path (Task 17) |
| 05 parity runners and eval graders | `createDocumentAgentSession`, `AgentSession.log()` (Task 17), `createHeadlessAgentSetup` (Task 21), `createStoreAgentSession` from `src/components/modules/agent/store-session.ts` (Task 35), the C# executor (`new BlokAgentExecutor(runtime, rooms, converter)`, internal, Task 45; `Blok.Server.Tests` sees internals, `Blok.Server/Properties/AssemblyInfo.cs:5`). 05 owns the corpus, the normalizer, the goldens and the `json` / `store` / Playwright `editor` / `jint` / `room` runners (05 Tasks 6–8, 11–13; 06 C1, §7.5). This plan keeps only the jsdom `editor` runner (Task 32) and the concurrent-move test (Task 46). |
| 05 coverage law | `COMMANDS` (Task 3) |
| 02 headless `page.rename` / `page.setIcon` `prepare` | the Node `pageBackend` service object from `createPageMapBackend` (Task 17). It implements 02's `PageBackendService` (`src/shared/tool-actions/services.ts`; 02 Task 12 creates the file, Task 44 uses it): `rename({ blockId, title })`, `setIcon({ blockId, icon })`. It reads the page block's `data.pageId` itself, from the session's current snapshot. |
| 04 Node MCP setup, 05 harness | `createHeadlessAgentSetup(options)` (Task 21), `createHeadlessPorts(input)`, `loadStoredDocument(doc, richTextFieldsFor)` (Task 19) |
| 02 create actions (`table.create`, `column_list.create`, `tabs.create`, `database.create`, `bookmark.create`) | `ToolActionContext.tool`: the registry key the action runs under (Task 14; added to 06 §3.4) |
| 02 bare table insert | `block.insert` refuses a type that owns its children (`ownsChildren`), has no `defaultChildren`, and has a `create` action, naming it in `details.use` (Task 8 Step 7; a table registered as `grid` is caught too) |
| 02 field removal in handlers | `ctx.update(id, { key: undefined })` and `block.update` `{ key: null }` both remove the key; the recorded `Edit` carries `null`, which survives JSON into Jint (Task 14 Step 7; `emitPatch`, Task 9) |

**This plan's tasks that need 02–05:**

| This plan's task | Needs (from plan) |
|---|---|
| Task 3 (envelope validation) | `validateAgainst(schema, value)` in `src/shared/schema/validate.ts` (02). It depends on nothing in 01, so it can land first. |
| Task 17 (`describe`) | `AgentContract`, `CommandEntry`, `ContractSlice`-ready `BlokToolManifest` types in `types/tool-manifest.d.ts` (02) |
| Task 2 (names) | `RESERVED_NAMESPACES` from `src/shared/tool-manifest.ts` (02 Task 5). One constant; this plan re-exports it. |
| Task 19 (headless ports) | `mintId(length?)` from `src/shared/mint-id.ts` (02 Task 14) |
| Task 21 (built-in contract wiring) | `buildToolManifest`, `buildAgentContract` (02 Tasks 5, 6); `buildBuiltInSnapshot({ blokVersion, services })` (02 Task 27); `snapshotWithCustomTools(base, file?)`, `runtimesWithCustomTools(base, file?)` (02 Task 29); `BUILT_IN_TOOL_RUNTIMES` (02 Task 13) |
| Task 28 (editor contract) | `buildToolManifest`, `buildAgentContract`; `snapshotFromTools(tools, { blokVersion, readOnly, defaultBlock, services, i18n })` and `runtimesFromTools(tools)` from `src/components/tools/registry-snapshot.ts` (02 Task 26) |
| Task 30 (`block.move` into columns) | `cleanupEmptiedColumnList(ctx, columnListId): boolean` in `src/shared/tool-actions/columns.ts` (02 Task 38) |
| Task 33 (E2E) | `editor.agent.begin({ agent: { id, name } })` (03 Task 9, `AgentTurnOptions` from 03 Task 1) |
| Task 35 (live tables) | table `ToolRuntime.normalize` (02; v1 blocker for live mode, 06 C17) |
| Tasks 37–46 (C#) | the Jint `manifest` op (02 Task 50 owns it; Task 37 adds only `agentExecute`) |
| Tasks 21, 32 (parity) | 05's corpus format, loader, normalizer and golden helpers (05 Tasks 6, 7) |
| Task 40 | 02's page names, read from 02's plan: the page block's field is `data.pageId` (02 Task 21, `summaryFields: ['pageId']`); `page.rename` args `{ title }` and `page.setIcon` args `{ icon: PageIcon \| null }`, plus the core-added `id` (02 Task 49) |
| Task 28a (browser services) | the browser `pageBackend`, `linkMetadata` and `uploader` objects, built by 03 (03 Task 9a) |

## Deviations from the spec found while reading the code

Each one is evidence from this session. The executor follows the plan's choice and the release note says so.

- **D-1. `OutputData` already has flat `title?` and `icon?`.** Commit `8d86c376` (after `v1.16.1`, so unreleased) added them (`types/data-formats/output-data.d.ts`, the `OutputData` interface), and the saver writes `YjsManager.getPageFields()` into saved output (`src/components/modules/saver.ts:423`, `:1259`). The spec's `OutputData.page?: { title?, icon? }` would be a second shape for the same thing. This plan uses `OutputData.title` / `OutputData.icon`. `DocumentView.page` keeps its spec shape (it is a view type). 02 must add `title` and `icon` (not `page`) to `blokDocumentSchema`.
- **D-2. Line numbers drifted.** `blocks.convert` sits at `src/components/modules/api/blocks.ts:771-801`; its unsanitized call is at `:792`. `hostDataForTool` is at `:961-978`. `insertMany` is at `:817-863`. This plan cites the real lines.
- **D-3. `history.undo` / `history.redo` must be alone in their batch.** The spec does not say how an undo mixes with writes in one atomic batch. This plan refuses a mixed batch with `INVALID_ARGS` (same rule shape as `effects: 'host'`). Flagged for the spec owner.
- **D-4. The editor already has `YjsManager.richSegmentsOf(value)`** (`src/components/modules/yjs/index.ts:1420`), which turns HTML or segments into canonical segments. The editor snapshot uses it instead of a new reader.
- **D-5. `DocumentStore.toJSON()` maps one-to-one onto `OutputBlockData`, `lastEditedBy` included** (`serializer.ts:502-549`). Answers 05-Q14: no converter is needed beyond rich fields → segments and `readPageFields`.

---

## File Structure

New, pure (`src/shared/agent/`, Node + browser + Jint):

| File | Responsibility |
|---|---|
| `src/shared/agent/types.ts` | Internal planner types (`PlannerTool`, `PlannerCommand`, `PlannerContext`, `Plan`, `SchemaValidator`, `AgentPorts`) |
| `src/shared/agent/names.ts` | `CORE_COMMAND_NAMES`, `RESERVED_NAMESPACES`, `splitCommandName` |
| `src/shared/agent/errors.ts` | `AgentFailure`, `failure()`, `warning()`, `RETRYABLE_CODES` |
| `src/shared/agent/commands.ts` | `COMMANDS` registry (args schemas, readOnly, runtime, summary) |
| `src/shared/agent/envelope.ts` | `checkEnvelope()`: shape, names, availability, args, batch rules |
| `src/shared/agent/snapshot.ts` | `DocSnapshot`: mutable working copy of a document, tree queries, table-cell lookup |
| `src/shared/agent/placement-rules.ts` | `checkMove`, `checkInsert` over a `PlacementTree` (shared with `block-placement.ts`) |
| `src/shared/agent/rich-text-ops.ts` | `RichTextHelpers` impl: plain text, range resolve, insert, delete, format, find |
| `src/shared/agent/markdown-lookalike.ts` | `looksLikeMarkdown(text)` |
| `src/shared/agent/json-applier.ts` | `applyEdits(snapshot, edits, stamp)` |
| `src/shared/agent/plan-state.ts` | `PlanState`: the draft, refs, emit, placement, data preparation; `PREPARE_PENDING` |
| `src/shared/agent/planner.ts` | `planBatch()`: per-command dispatch, refs, changed set, warnings |
| `src/shared/agent/plan-block.ts` | `block.*` commands |
| `src/shared/agent/plan-text.ts` | `text.*` commands |
| `src/shared/agent/plan-doc.ts` | `doc.setTitle`, `doc.setIcon`, `doc.read`, `doc.find`, `markdown.*` planning |
| `src/shared/agent/view.ts` | `buildDocumentView`, `findBlocks` |
| `src/shared/agent/tool-action-context.ts` | the recording `ToolActionContext` |
| `src/shared/agent/write-validation.ts` | post-write validation (`DATA_REJECTED`, `FIELD_NOT_WRITABLE`) |
| `src/shared/agent/revision.ts` | `canonicalJson`, `contentRevision` |
| `src/shared/agent/executor.ts` | `runBatch()`: steps 0–6 of 01 §3.3 over an `AgentApplier` |
| `src/shared/agent/context.ts` | `plannerContextFrom(contract, runtimes, ports, validate, services)` |
| `src/shared/agent/describe.ts` | `describeContract(contract, query)` |
| `src/shared/agent/document-session.ts` | `createDocumentAgentSession`, `createPageMapBackend` |
| `src/shared/agent/index.ts` | barrel |
| `src/shared/sanitize-walk.ts` | DOM-free deep sanitize walk shared by the editor and headless sanitizers |

New, editor / Node:

| File | Responsibility |
|---|---|
| `src/components/modules/agent/editor-ports.ts` | `createEditorPorts(Blok)` |
| `src/components/modules/agent/editor-snapshot.ts` | `editorSnapshot(Blok, richFieldsFor)` |
| `src/components/modules/agent/editor-applier.ts` | `EditorApplier` |
| `src/components/modules/agent/editor-session.ts` | `createEditorAgentSession`, `InternalEditorHandle` |
| `src/components/modules/agent/store-applier.ts` | `StoreApplier` |
| `src/components/modules/agent/store-session.ts` | `createStoreAgentSession` |
| `src/view/agent-runtime.ts` | `createHeadlessPorts`, `loadStoredDocument`, `createHeadlessAgentSetup` (parse5) |
| `src/components/errors/convert-conflict.ts` | `ConvertConflictError` (Task 27a) |

New, C# (`packages/server/dotnet/Blok.Server/`):

| File | Responsibility |
|---|---|
| `Agent/IBlokAgentExecutor.cs` | public interface + `BlokAgentActor`, `BlokAgentExecution`, `BlokAgentOptions`, `IBlokPageTarget` |
| `Agent/BlokAgentExecutor.cs` | stored and room execution over `IBlokRuntime` |
| `Agent/RoomEditTranslator.cs` | `Edit[]` JSON → `CollabEditOp`s |

Modified: `types/index.d.ts`, `types/events/block/Base.ts`, `src/components/modules/api/block-placement.ts`, `src/components/modules/api/blocks.ts`, `src/components/utils/sanitizer.ts`, `src/components/modules/blockManager/blockManager.ts`, `src/components/modules/yjs/undo-history.ts`, `src/components/modules/yjs/index.ts`, `src/markdown/blocks-to-markdown.ts`, `src/view/server-runtime.ts`, `test/unit/architecture/view-entry-law.test.ts`, `Collab/CollabEditOps.cs`, `Collab/YDocConverter.cs`, `Collab/CollabDocConverter.cs`, `Collab/CollabRoomManager.cs`, `Blok.Server.AspNetCore/BlokDocumentsServiceCollectionExtensions.cs`, `Documents/BlokDocuments.cs`.

Tests: `test/unit/shared/agent/*.test.ts` (node env), `test/unit/view/agent-setup.test.ts`, `test/unit/agent/applier-parity.editor.test.ts` (jsdom runner over 05's corpus; 05 owns `test/unit/agent/parity/` and `test/fixtures/agent-commands/`), `test/unit/components/modules/agent/*.test.ts` (jsdom), `test/unit/architecture/agent-*-law.test.ts`, `test/playwright/tests/agent/agent-commands.spec.ts`, `packages/server/dotnet/Blok.Server.Tests/Agent/*.cs`.

## Phases

| Phase | Tasks | Unblocks |
|---|---|---|
| 1. Pure core + JsonApplier + document session + headless ports | 1–21 | 02 actions, 04 stored mode, 05 graders |
| 2. EditorApplier (D5 first) | 22–33 | 03 |
| 3. StoreApplier | 34–36 | 04 live mode |
| 4. C# stored (Jint) | 37–40 | 05 Jint runner |
| 5. C# live room translator (D1a) | 41–46 | 05 room runner |

Each phase ends with a checkpoint. Do not start the next phase until the checkpoint passes.

**Run-ahead exception (06 §14 "Execution order").** Task 22 (D5, Phase 2) has no input from Phase 1 and may land in wave 0, as its own `BREAKING` commit. Every other task keeps this plan's order, and the cross-plan waits listed in 06 §14.

---
## Phase 1 — Pure core, JsonApplier, document session, headless ports

### Task 1: Published contract types

**Files:**
- Create: `types/agent.d.ts`
- Modify: `types/index.d.ts:138` (add an `export *` line next to `export * from './rich-text';`)
- Test: `test/unit/types/agent-types.test.ts`

**Interfaces:**
- Consumes: `RichText`, `RichTextMarks` (`types/rich-text.d.ts`), `BlockPosition` (`types/api/blocks.d.ts:33`), `PageIcon` (`types/tools/page.d.ts:13`), `OutputBlockData` (`types/data-formats/output-data.d.ts`).
- Produces (all exported from `types/agent.d.ts` and re-exported from `types/index.d.ts`): `CoreCommandName`, `ToolCommandName`, `CommandName`, `ReservedNamespace`, `AgentCommand`, `AgentBatch`, `ChangedSet`, `TextRangeRef`, `AgentResult`, `AgentError`, `AgentErrorCode`, `AgentWarning`, `AgentWarningCode`, `TextRange`, `InsertSpec`, `BlockInsertArgs`, `Edit`, `PlannedBlock`, `DocumentView`, `ViewBlock`, `ViewArgs`, `AgentActor`, `CommandLogEntry`, `RichTextHelpers`, `PlacementRefusalReason`. `AgentSession` and `ContractSlice` are added in Task 17 (they need 02's `AgentContract`).

- [ ] **Step 1: Write the failing type test**

```ts
// test/unit/types/agent-types.test.ts
import { describe, expectTypeOf, it } from 'vitest';
import type {
  AgentBatch, AgentErrorCode, AgentResult, CoreCommandName, Edit, InsertSpec, RichTextHelpers, TextRange,
} from '../../../types';

describe('published agent types', () => {
  it('names every core command from 06 §3.1', () => {
    expectTypeOf<'doc.setTitle'>().toMatchTypeOf<CoreCommandName>();
    expectTypeOf<'text.format'>().toMatchTypeOf<CoreCommandName>();
    expectTypeOf<'caret.set'>().not.toMatchTypeOf<CoreCommandName>();
  });

  it('has no removed error codes', () => {
    expectTypeOf<'COMMAND_UNAVAILABLE'>().toMatchTypeOf<AgentErrorCode>();
    expectTypeOf<'DURABILITY_TIMEOUT'>().not.toMatchTypeOf<AgentErrorCode>();
    expectTypeOf<'SERVICE_UNAVAILABLE'>().not.toMatchTypeOf<AgentErrorCode>();
  });

  it('keeps revision optional only on failure', () => {
    expectTypeOf<Extract<AgentResult, { ok: true }>['revision']>().toEqualTypeOf<string>();
    expectTypeOf<Extract<AgentResult, { ok: false }>['revision']>().toEqualTypeOf<string | undefined>();
  });

  it('accepts a text range by offsets, by find, or all', () => {
    expectTypeOf<{ start: 0; end: 2 }>().toMatchTypeOf<TextRange>();
    expectTypeOf<{ find: 'x' }>().toMatchTypeOf<TextRange>();
    expectTypeOf<'all'>().toMatchTypeOf<TextRange>();
  });

  it('exposes the edit union and helpers 02 builds on', () => {
    expectTypeOf<Extract<Edit, { op: 'setPageField' }>['key']>().toEqualTypeOf<'title' | 'icon'>();
    expectTypeOf<InsertSpec['children']>().toEqualTypeOf<InsertSpec[] | undefined>();
    expectTypeOf<RichTextHelpers['plainText']>().parameters.toEqualTypeOf<[import('../../../types').RichText]>();
    expectTypeOf<AgentBatch['commands'][number]['ref']>().toEqualTypeOf<string | undefined>();
  });
});
```

- [ ] **Step 2: Run the type check and watch it fail**

Run: `NODE_OPTIONS=--max-old-space-size=8192 yarn lint:types`
Expected: FAIL with `TS2305: Module '"../../../types"' has no exported member 'AgentBatch'` (and the other names).

- [ ] **Step 3: Write the declaration**

```ts
// types/agent.d.ts
import type { BlockPosition } from './api/blocks';
import type { OutputBlockData } from './data-formats/output-data';
import type { RichText, RichTextMarks } from './rich-text';
import type { PageIcon } from './tools/page';

export type CoreCommandName =
  | 'doc.read' | 'doc.find' | 'doc.setTitle' | 'doc.setIcon'
  | 'block.insert' | 'block.update' | 'block.delete' | 'block.move'
  | 'block.convert' | 'block.duplicate'
  | 'text.insert' | 'text.delete' | 'text.replace' | 'text.format'
  | 'markdown.insert' | 'markdown.export'
  | 'history.undo' | 'history.redo';

/** A tool action: `<registryKey>.<action>`, e.g. 'table.insertRows'. */
export type ToolCommandName = `${string}.${string}`;
export type CommandName = CoreCommandName | ToolCommandName;
export type ReservedNamespace = 'doc' | 'block' | 'text' | 'markdown' | 'history';

export interface AgentCommand { name: CommandName; args: Record<string, unknown>; ref?: string }
export interface AgentBatch { commands: AgentCommand[]; expectRevision?: string }

export interface ChangedSet { created: string[]; updated: string[]; moved: string[]; removed: string[] }
export interface TextRangeRef { blockId: string; field: string; start: number; end: number }

export type AgentErrorCode =
  | 'INVALID_ARGS' | 'UNKNOWN_COMMAND' | 'UNKNOWN_TOOL' | 'BLOCK_NOT_FOUND'
  | 'FIELD_NOT_RICH_TEXT' | 'FIELD_NOT_WRITABLE' | 'RANGE_OUT_OF_BOUNDS' | 'RANGE_NOT_FOUND'
  | 'PLACEMENT_REFUSED' | 'CONVERSION_UNSUPPORTED' | 'DATA_REJECTED'
  | 'PRECONDITION_FAILED' | 'COMMAND_UNAVAILABLE' | 'READ_ONLY' | 'STALE' | 'CONFLICT'
  | 'UNDO_NOT_OWN' | 'NOTHING_TO_UNDO' | 'CANCELLED'
  | 'TOOL_ACTION_FAILED' | 'ORPHANED_SIDE_EFFECT' | 'APPLY_FAILED'
  | 'UNKNOWN_HANDLE' | 'HANDLE_LIMIT' | 'FORBIDDEN' | 'ROOM_SYNC_TIMEOUT' | 'ROOM_RESET'
  | 'REJECTED' | 'VERSION_SKEW' | 'DOCUMENT_CHANGED' | 'STORED_WRITE_FORBIDDEN'
  | 'SOURCE_UNAVAILABLE';

export interface AgentError {
  code: AgentErrorCode;
  /** What is wrong and what to do. */
  message: string;
  commandIndex?: number;
  /** JSON pointer into the batch. */
  path?: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export type AgentWarningCode = 'SANITIZED' | 'DEMOTED' | 'LOOKS_LIKE_MARKDOWN' | 'MARKDOWN_DEGRADED' | 'UNKNOWN_MARK_DROPPED';
export interface AgentWarning { code: AgentWarningCode; message: string; commandIndex?: number; blockId?: string; field?: string }

export type AgentResult =
  | { ok: true; revision: string; results: unknown[]; refs: Record<string, string>;
      changed: ChangedSet; lastRange?: TextRangeRef; warnings: AgentWarning[] }
  | { ok: false; revision?: string; error: AgentError; warnings: AgentWarning[] };

export type PlacementRefusalReason =
  | 'NOT_A_CHILD' | 'OWN_SUBTREE' | 'TABLE_CELL_BOUNDARY' | 'TAKES_NO_CHILDREN'
  | 'OWNS_CHILDREN' | 'CHILD_NOT_ALLOWED' | 'RESTRICTED_IN_CELL' | 'SELF_PLACED_PARENT';

/** Units: UTF-16 code units, one unit per embed. `occurrence` is 1-based. */
export type TextRange =
  | { start: number; end: number; expectText?: string }
  | { find: string; occurrence?: number }
  | 'all';

/** `block.insert` args minus placement, recursive. */
export interface InsertSpec {
  type: string;
  data?: Record<string, unknown>;
  tunes?: Record<string, unknown>;
  id?: string;
  children?: InsertSpec[];
}

export interface BlockInsertArgs extends InsertSpec {
  parentId?: string | null;
  position?: BlockPosition;
  demote?: boolean;
}

export interface PlannedBlock {
  id: string;
  type: string;
  /** Sanitized and normalized; rich fields as segments. */
  data: Record<string, unknown>;
  tunes?: Record<string, unknown>;
  children: PlannedBlock[];
}

export type Edit =
  | { op: 'insert'; block: PlannedBlock; parentId: string | null; afterId: string | null }
  | { op: 'remove'; id: string; withChildren: boolean }
  | { op: 'move'; id: string; parentId: string | null; afterId: string | null }
  | { op: 'setData'; id: string; patch: Record<string, unknown> }
  | { op: 'setRichText'; id: string; field: string; value: RichText }
  | { op: 'setTunes'; id: string; tunes: Record<string, unknown> }
  | { op: 'replaceType'; id: string; type: string; data: Record<string, unknown> }
  | { op: 'setPageField'; key: 'title' | 'icon'; value: string | PageIcon | null };

export interface ViewArgs {
  rootId?: string | null;
  depth?: number;
  ids?: string[];
  detail?: 'outline' | 'full';
  limit?: number;
  cursor?: string;
  textLimit?: number;
}

export interface ViewBlock {
  id: string;
  type: string;
  depth: number;
  parentId?: string;
  text?: string;
  truncated?: true;
  attrs?: Record<string, unknown>;
  childCount?: number;
  opaque?: true;
  cell?: { row: number; col: number };
  /** Full detail only. Rich fields as segments. */
  data?: OutputBlockData['data'];
  tunes?: OutputBlockData['tunes'];
}

export interface DocumentView {
  revision: string;
  rootId: string | null;
  page?: { title?: string; icon?: PageIcon };
  blocks: ViewBlock[];
  next?: string;
  /** Editor only. */
  selection?: TextRangeRef;
}

export interface AgentActor { id: string; name: string; kind: 'agent'; onBehalfOf?: string; color?: string }

export interface CommandLogEntry {
  batch: number; index: number; name: string; args: unknown;
  result?: unknown; error?: AgentError; actorId: string;
}

/** Pure range helpers, the same ones `text.*` uses. Offsets in contract units. */
export interface RichTextHelpers {
  plainText(value: RichText): string;
  length(value: RichText): number;
  resolve(value: RichText, range: TextRange): { start: number; end: number };
  slice(value: RichText, start: number, end: number): RichText;
  insert(value: RichText, at: number, inserted: RichText): RichText;
  remove(value: RichText, start: number, end: number): RichText;
  format(value: RichText, start: number, end: number, set?: RichTextMarks, unset?: string[]): RichText;
  canonicalize(value: RichText): RichText;
}
```

Add to `types/index.d.ts` directly after line 138 (`export * from './rich-text';`):

```ts
export * from './agent';
```

- [ ] **Step 4: Run the checks and watch them pass**

Run: `NODE_OPTIONS=--max-old-space-size=8192 yarn lint:types`
Expected: PASS (no errors).
Run: `yarn test test/unit/types/agent-types.test.ts test/unit/architecture/published-types-no-src-refs.test.ts test/unit/architecture/public-export-reachability-law.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint types/agent.d.ts types/index.d.ts test/unit/types/agent-types.test.ts
git add types/agent.d.ts types/index.d.ts test/unit/types/agent-types.test.ts
git commit -m "feat(agent): publish the agent command contract types

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Names and the error helpers

**Files:**
- Create: `src/shared/agent/names.ts`, `src/shared/agent/errors.ts`
- Test: `test/unit/shared/agent/errors.test.ts`

**Interfaces:**
- Consumes: types from Task 1; `RESERVED_NAMESPACES` from `src/shared/tool-manifest.ts` (**02** Task 5 owns the one constant; 02 Phase 1 lands before this task, see 06 "Execution order").
- Produces:
  - `CORE_COMMAND_NAMES: readonly CoreCommandName[]`, `RESERVED_NAMESPACES` (re-exported from 02, not redefined), `splitCommandName(name: string): { namespace: string; action: string } | null`, `isReservedNamespace(ns: string): boolean`.
  - `class AgentFailure extends Error { readonly error: AgentError }`.
  - `failure(code: AgentErrorCode, message: string, extra?: { commandIndex?: number; path?: string; details?: Record<string, unknown> }): AgentFailure`.
  - `warning(code: AgentWarningCode, message: string, extra?: Omit<AgentWarning, 'code' | 'message'>): AgentWarning`.
  - `RETRYABLE_CODES: ReadonlySet<AgentErrorCode>` = `STALE`, `CONFLICT`, `CANCELLED`.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/shared/agent/errors.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentFailure, failure, warning } from '../../../../src/shared/agent/errors';
import { CORE_COMMAND_NAMES, isReservedNamespace, splitCommandName } from '../../../../src/shared/agent/names';

describe('agent errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks only STALE, CONFLICT and CANCELLED retryable', () => {
    expect(failure('STALE', 'x').error.retryable).toBe(true);
    expect(failure('CONFLICT', 'x').error.retryable).toBe(true);
    expect(failure('CANCELLED', 'x').error.retryable).toBe(true);
    expect(failure('INVALID_ARGS', 'x').error.retryable).toBe(false);
  });

  it('carries index, path and details', () => {
    const thrown = failure('BLOCK_NOT_FOUND', 'Block "z" not found.', { commandIndex: 2, path: '/commands/2/args/id', details: { id: 'z' } });

    expect(thrown).toBeInstanceOf(AgentFailure);
    expect(thrown.error).toEqual({
      code: 'BLOCK_NOT_FOUND', message: 'Block "z" not found.', commandIndex: 2,
      path: '/commands/2/args/id', retryable: false, details: { id: 'z' },
    });
  });

  it('builds warnings without undefined keys', () => {
    expect(warning('SANITIZED', 'm', { blockId: 'a' })).toEqual({ code: 'SANITIZED', message: 'm', blockId: 'a' });
  });
});

describe('command names', () => {
  it('lists the 18 core commands of 06 §3.1', () => {
    expect(CORE_COMMAND_NAMES).toHaveLength(18);
    expect(CORE_COMMAND_NAMES).not.toContain('caret.set');
  });

  it('splits at the first dot only', () => {
    expect(splitCommandName('column_list.create')).toEqual({ namespace: 'column_list', action: 'create' });
    expect(splitCommandName('a.b.c')).toEqual({ namespace: 'a', action: 'b.c' });
    expect(splitCommandName('nodot')).toBeNull();
    expect(splitCommandName('.x')).toBeNull();
  });

  it('knows the reserved namespaces', () => {
    expect(isReservedNamespace('history')).toBe(true);
    expect(isReservedNamespace('table')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `yarn test test/unit/shared/agent/errors.test.ts`
Expected: FAIL with `Failed to resolve import "../../../../src/shared/agent/errors"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/agent/names.ts
import type { CoreCommandName } from '../../../types/agent';
// One constant for planner and contract builder (02 Task 5); never redefine it here.
import { RESERVED_NAMESPACES } from '../tool-manifest';

export { RESERVED_NAMESPACES };

export const CORE_COMMAND_NAMES: readonly CoreCommandName[] = [
  'doc.read', 'doc.find', 'doc.setTitle', 'doc.setIcon',
  'block.insert', 'block.update', 'block.delete', 'block.move', 'block.convert', 'block.duplicate',
  'text.insert', 'text.delete', 'text.replace', 'text.format',
  'markdown.insert', 'markdown.export',
  'history.undo', 'history.redo',
];

export const isReservedNamespace = (namespace: string): boolean =>
  (RESERVED_NAMESPACES as readonly string[]).includes(namespace);

export const splitCommandName = (name: string): { namespace: string; action: string } | null => {
  const dot = name.indexOf('.');

  if (dot <= 0 || dot === name.length - 1) {
    return null;
  }

  return { namespace: name.slice(0, dot), action: name.slice(dot + 1) };
};
```

```ts
// src/shared/agent/errors.ts
import type { AgentError, AgentErrorCode, AgentWarning, AgentWarningCode } from '../../../types/agent';

export const RETRYABLE_CODES: ReadonlySet<AgentErrorCode> = new Set<AgentErrorCode>(['STALE', 'CONFLICT', 'CANCELLED']);

/** Thrown inside the planner and executor; the executor turns it into `ok: false`. */
export class AgentFailure extends Error {
  public readonly error: AgentError;

  constructor(error: AgentError) {
    super(error.message);
    this.name = 'AgentFailure';
    this.error = error;
  }
}

export const failure = (
  code: AgentErrorCode,
  message: string,
  extra: { commandIndex?: number; path?: string; details?: Record<string, unknown> } = {}
): AgentFailure => new AgentFailure({
  code,
  message,
  ...(extra.commandIndex !== undefined && { commandIndex: extra.commandIndex }),
  ...(extra.path !== undefined && { path: extra.path }),
  retryable: RETRYABLE_CODES.has(code),
  ...(extra.details !== undefined && { details: extra.details }),
});

export const warning = (
  code: AgentWarningCode,
  message: string,
  extra: Omit<AgentWarning, 'code' | 'message'> = {}
): AgentWarning => ({
  code,
  message,
  ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined)),
});
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `yarn test test/unit/shared/agent/errors.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/shared/agent/names.ts src/shared/agent/errors.ts test/unit/shared/agent/errors.test.ts
git add src/shared/agent/names.ts src/shared/agent/errors.ts test/unit/shared/agent/errors.test.ts
git commit -m "feat(agent): command names and the typed failure helpers

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The `COMMANDS` registry, planner types and envelope checks

**Files:**
- Create: `src/shared/agent/types.ts`, `src/shared/agent/commands.ts`, `src/shared/agent/envelope.ts`
- Test: `test/unit/shared/agent/envelope.test.ts`, `test/unit/shared/agent/fixtures.ts` (shared test fixture used by every later pure task)

**Interfaces:**
- Consumes: `validateAgainst(schema, value): Array<{ path: string; message: string }>` from `src/shared/schema/validate.ts` (**02**). Task 2's names and errors.
- Produces:
  - `type JsonSchema = { readonly [keyword: string]: unknown }` (structurally 02's `BlokSchema`).
  - `type SchemaValidator = (schema: JsonSchema, value: unknown) => Array<{ path: string; message: string }>`.
  - `interface CoreCommandSpec { argsSchema: JsonSchema; resultSchema?: JsonSchema; readOnly: boolean; runtime: 'any' | 'editor'; summary: string; guidance?: string }`.
  - `COMMANDS: Record<CoreCommandName, CoreCommandSpec>`.
  - `interface PlannerCommand { name: string; args: JsonSchema; readOnly: boolean; available: boolean; unavailableReason?: 'runtime' | 'service'; requires?: string[]; effects?: 'host'; source: 'core' | { tool: string; target: 'block' | 'create' } }` (a structural subset of 02's `CommandEntry`).
  - `checkEnvelope(batch: unknown, commands: ReadonlyMap<string, PlannerCommand>, validate: SchemaValidator): { batch: AgentBatch; writes: boolean }` — throws `AgentFailure`.

`args` in a `PlannerCommand` is the **full** args schema (02's `buildAgentContract` already adds `id` / `parentId` / `position` for tool actions, 02 §3.6a). The core rows below are copied into the contract by 02 as is.

- [ ] **Step 1: Write the shared fixture and the failing test**

```ts
// test/unit/shared/agent/fixtures.ts
import { COMMANDS } from '../../../../src/shared/agent/commands';
import type { PlannerCommand, PlannerTool } from '../../../../src/shared/agent/types';

/** Core commands as 02's buildAgentContract lists them for a runner. */
export const coreCommandMap = (unavailable: Record<string, 'runtime' | 'service'> = {}): Map<string, PlannerCommand> =>
  new Map(Object.entries(COMMANDS).map(([name, spec]) => [name, {
    name,
    args: spec.argsSchema,
    readOnly: spec.readOnly,
    available: unavailable[name] === undefined,
    ...(unavailable[name] !== undefined && { unavailableReason: unavailable[name] }),
    source: 'core' as const,
  }]));

const rich = { type: 'array' } as const;

/** Hand-built manifest facts for the pure tests; 02's real builder replaces this in Task 21. */
export const tool = (name: string, over: Partial<PlannerTool['entry']> = {}, runtime: Partial<PlannerTool['runtime']> = {}): PlannerTool => ({
  entry: {
    name,
    richTextFields: [],
    viewState: [],
    guardedFields: {},
    children: { accepts: true, ownedByTool: false, layout: false, deletedWithParent: false },
    selfPlacesChildren: false,
    restrictedInTableCell: false,
    conversion: {},
    data: { type: 'object' },
    ...over,
  },
  runtime: { actions: {}, ...runtime },
});

export const TOOLS: Map<string, PlannerTool> = new Map([
  ['paragraph', tool('paragraph', { richTextFields: ['text'], conversion: { import: 'text', export: 'text' }, data: { type: 'object', properties: { text: rich }, additionalProperties: false } })],
  ['header', tool('header', { richTextFields: ['text'], summaryFields: ['level'], restrictedInTableCell: true, conversion: { import: 'text', export: 'text' }, data: { type: 'object', properties: { text: rich, level: { type: 'integer', minimum: 1, maximum: 6 } }, additionalProperties: false } })],
  ['toggle', tool('toggle', { richTextFields: ['text'], children: { accepts: true, deny: ['table'], ownedByTool: false, layout: false, deletedWithParent: false }, conversion: { import: 'text', export: 'text' }, data: { type: 'object', properties: { text: rich } } })],
  ['divider', tool('divider', { children: { accepts: false, ownedByTool: false, layout: false, deletedWithParent: false } })],
  ['table', tool('table', { selfPlacesChildren: true, restrictedInTableCell: true, guardedFields: { content: 'table.*' }, children: { accepts: true, ownedByTool: true, layout: false, deletedWithParent: true }, data: { type: 'object' } })],
  ['column_list', tool('column_list', { restrictedInTableCell: true, children: { accepts: true, allow: ['column'], ownedByTool: true, layout: true, deletedWithParent: true } }, { defaultChildren: [{ type: 'column' }, { type: 'column' }] })],
  ['column', tool('column', { children: { accepts: true, ownedByTool: false, layout: true, deletedWithParent: true } })],
  ['image', tool('image', { viewState: ['zoom'], data: { type: 'object', properties: { url: { type: 'string' }, zoom: { type: 'number' } } } })],
]);
```

```ts
// test/unit/shared/agent/envelope.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkEnvelope } from '../../../../src/shared/agent/envelope';
import { AgentFailure } from '../../../../src/shared/agent/errors';
import { validateAgainst } from '../../../../src/shared/schema/validate';
import type { PlannerCommand } from '../../../../src/shared/agent/types';
import { coreCommandMap } from './fixtures';

const fails = (batch: unknown, commands = coreCommandMap()): AgentFailure['error'] => {
  try {
    checkEnvelope(batch, commands, validateAgainst);
  } catch (error) {
    if (error instanceof AgentFailure) {
      return error.error;
    }
    throw error;
  }
  throw new Error('expected a failure');
};

describe('checkEnvelope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses a batch that is not { commands: [...] }', () => {
    expect(fails({})).toMatchObject({ code: 'INVALID_ARGS', path: '/commands' });
    expect(fails({ commands: [] })).toMatchObject({ code: 'INVALID_ARGS', path: '/commands' });
  });

  it('names an unknown command and keeps going nowhere', () => {
    expect(fails({ commands: [{ name: 'caret.set', args: {} }] })).toMatchObject({ code: 'UNKNOWN_COMMAND', commandIndex: 0 });
  });

  it('lists a tool’s actions when the action is unknown', () => {
    const commands = coreCommandMap();
    commands.set('table.insertRows', { name: 'table.insertRows', args: { type: 'object' }, readOnly: false, available: true, source: { tool: 'table', target: 'block' } });

    expect(fails({ commands: [{ name: 'table.addRow', args: {} }] }, commands)).toMatchObject({
      code: 'UNKNOWN_COMMAND', details: { tool: 'table', actions: ['table.insertRows'] },
    });
  });

  it('reports a bad arg with a JSON pointer into the batch', () => {
    expect(fails({ commands: [{ name: 'block.delete', args: {} }] })).toMatchObject({ code: 'INVALID_ARGS', commandIndex: 0, path: '/commands/0/args' });
    expect(fails({ commands: [{ name: 'block.update', args: { id: 7 } }] })).toMatchObject({ code: 'INVALID_ARGS', path: '/commands/0/args/id' });
  });

  it('refuses a listed but unavailable command with its reason', () => {
    const commands = coreCommandMap({ 'history.undo': 'runtime' });

    expect(fails({ commands: [{ name: 'history.undo', args: {} }] }, commands)).toMatchObject({
      code: 'COMMAND_UNAVAILABLE', details: { reason: 'runtime' },
    });
  });

  it('refuses a host-effect action that is not alone', () => {
    const commands = coreCommandMap();
    const page: PlannerCommand = { name: 'page.rename', args: { type: 'object' }, readOnly: false, available: true, effects: 'host', source: { tool: 'page', target: 'block' } };
    commands.set('page.rename', page);

    expect(fails({ commands: [{ name: 'page.rename', args: { id: 'p', title: 'x' } }, { name: 'doc.read', args: {} }] }, commands))
      .toMatchObject({ code: 'INVALID_ARGS', commandIndex: 0 });
  });

  it('refuses history.undo mixed with other commands (plan rule D-3)', () => {
    expect(fails({ commands: [{ name: 'history.undo', args: {} }, { name: 'doc.read', args: {} }] })).toMatchObject({ code: 'INVALID_ARGS' });
  });

  it('says whether the batch writes', () => {
    expect(checkEnvelope({ commands: [{ name: 'doc.read', args: {} }] }, coreCommandMap(), validateAgainst).writes).toBe(false);
    expect(checkEnvelope({ commands: [{ name: 'block.delete', args: { id: 'a' } }] }, coreCommandMap(), validateAgainst).writes).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `yarn test test/unit/shared/agent/envelope.test.ts`
Expected: FAIL with `Failed to resolve import "../../../../src/shared/agent/envelope"`.

- [ ] **Step 3: Write the types, the registry and the checks**

```ts
// src/shared/agent/types.ts
import type {
  AgentBatch, AgentWarning, ChangedSet, Edit, InsertSpec, RichTextHelpers, TextRangeRef,
} from '../../../types/agent';
import type { OutputBlockData, OutputData } from '../../../types/data-formats/output-data';
import type { RichText } from '../../../types/rich-text';

export type JsonSchema = { readonly [keyword: string]: unknown };
export type SchemaValidator = (schema: JsonSchema, value: unknown) => Array<{ path: string; message: string }>;

/** Structural subset of 02's CommandEntry. */
export interface PlannerCommand {
  name: string;
  args: JsonSchema;
  readOnly: boolean;
  available: boolean;
  unavailableReason?: 'runtime' | 'service';
  requires?: string[];
  effects?: 'host';
  source: 'core' | { tool: string; target: 'block' | 'create' };
}

/** Structural subset of 02's BlockToolManifestEntry. */
export interface PlannerToolEntry {
  name: string;
  richTextFields: string[];
  viewState: string[];
  guardedFields: Record<string, string>;
  children: { accepts: boolean; allow?: string[]; deny?: string[]; ownedByTool: boolean; layout: boolean; deletedWithParent: boolean };
  selfPlacesChildren: boolean;
  restrictedInTableCell: boolean;
  summaryFields?: string[];
  conversion: { import?: string; export?: string };
  data: JsonSchema;
  defaultData?: Record<string, unknown>;
  insertRequires?: string[];
}

/** Structural subset of 02's ToolActionImpl. The ctx type is Task 14's. */
export interface PlannerActionImpl {
  prepare?(ctx: { services: Partial<Record<string, unknown>> }, args: unknown): Promise<unknown>;
  run(ctx: unknown, args: unknown, prepared: unknown): unknown;
}

/** Structural subset of 02's ToolRuntime. Sanitizing goes through AgentPorts, not here. */
export interface PlannerToolRuntime {
  normalize?(data: Record<string, unknown>): Record<string, unknown>;
  defaultChildren?: InsertSpec[];
  actions: Record<string, PlannerActionImpl>;
}

export interface PlannerTool { entry: PlannerToolEntry; runtime: PlannerToolRuntime }

export interface AgentPorts {
  htmlToSegments(html: string): RichText;
  sanitizeBlockData(type: string, data: Record<string, unknown>): Record<string, unknown>;
  markdownToBlocks(md: string): Promise<{ blocks: OutputBlockData[]; warnings: AgentWarning[] }>;
  blocksToMarkdown(doc: OutputData): { markdown: string; warnings: AgentWarning[] };
  newId(): string;
}

export interface PlannerContext {
  tools: ReadonlyMap<string, PlannerTool>;
  commands: ReadonlyMap<string, PlannerCommand>;
  ports: AgentPorts;
  validate: SchemaValidator;
  defaultBlock: string;
  richText: RichTextHelpers;
  /** Host work done in step 3, keyed by command index. */
  prepared: ReadonlyMap<number, unknown>;
  /** Services the runner has (06 R3-3). */
  services: Partial<Record<string, unknown>>;
}

export interface Plan {
  edits: Edit[];
  results: unknown[];
  refs: Record<string, string>;
  changed: ChangedSet;
  lastRange?: TextRangeRef;
  warnings: AgentWarning[];
  /** Every block id a write touched: attribution scope. */
  touched: Set<string>;
}

export type { AgentBatch };
```

```ts
// src/shared/agent/commands.ts
import type { CoreCommandName } from '../../../types/agent';
import type { JsonSchema } from './types';

export interface CoreCommandSpec {
  argsSchema: JsonSchema;
  resultSchema?: JsonSchema;
  readOnly: boolean;
  runtime: 'any' | 'editor';
  summary: string;
  guidance?: string;
}

const id = { type: 'string', minLength: 1, description: 'A block id, or "$ref" of a block an earlier command created.' } as const;
const position = {
  description: "'start' | 'end' | { before: id } | { after: id }",
  oneOf: [
    { enum: ['start', 'end'] },
    { type: 'object', properties: { before: id }, required: ['before'], additionalProperties: false },
    { type: 'object', properties: { after: id }, required: ['after'], additionalProperties: false },
  ],
} as const;
const parentId = { oneOf: [id, { type: 'null' }] } as const;
const richOrString = { description: 'Plain text, or rich-text segments. Never Markdown.', oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'object' } }] } as const;
const range = {
  oneOf: [
    { const: 'all' },
    { type: 'object', properties: { start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 0 }, expectText: { type: 'string' } }, required: ['start', 'end'], additionalProperties: false },
    { type: 'object', properties: { find: { type: 'string', minLength: 1 }, occurrence: { type: 'integer', minimum: 1 } }, required: ['find'], additionalProperties: false },
  ],
} as const;
const insertSpec: JsonSchema = {
  type: 'object',
  properties: { type: { type: 'string', minLength: 1 }, data: { type: 'object' }, tunes: { type: 'object' }, id: { type: 'string', minLength: 1 }, children: { type: 'array', items: { type: 'object' } } },
  required: ['type'],
  additionalProperties: false,
};
const obj = (properties: Record<string, unknown>, required: string[] = []): JsonSchema =>
  ({ type: 'object', properties, required, additionalProperties: false });
const write = (summary: string, argsSchema: JsonSchema, guidance?: string): CoreCommandSpec =>
  ({ argsSchema, readOnly: false, runtime: 'any', summary, ...(guidance !== undefined && { guidance }) });
const read = (summary: string, argsSchema: JsonSchema): CoreCommandSpec => ({ argsSchema, readOnly: true, runtime: 'any', summary });

export const COMMANDS: Record<CoreCommandName, CoreCommandSpec> = {
  'doc.read': read('Read the document as an outline, a subtree, or chosen blocks in full.', obj({
    rootId: parentId, depth: { type: 'integer', minimum: 0 }, ids: { type: 'array', items: id }, detail: { enum: ['outline', 'full'] },
    limit: { type: 'integer', minimum: 1, maximum: 1000 }, cursor: { type: 'string' }, textLimit: { type: 'integer', minimum: 0 },
  })),
  'doc.find': read('Find blocks by text or type.', obj({ text: { type: 'string', minLength: 1 }, type: { type: 'string' }, rootId: id, limit: { type: 'integer', minimum: 1 } })),
  'doc.setTitle': write("Set this document's title. '' clears it.", obj({ title: { type: 'string' } }, ['title'])),
  'doc.setIcon': write("Set this document's icon. null clears it.", obj({ icon: { oneOf: [{ type: 'null' }, { type: 'object' }] } }, ['icon'])),
  'block.insert': write('Insert a block, with optional children.', { ...insertSpec, properties: { ...(insertSpec.properties as object), parentId, position, demote: { type: 'boolean' } } },
    'Rich-text fields take segments or plain text, never Markdown. Use markdown.insert for Markdown.'),
  'block.update': write('Merge data or tunes into a block. A key set to null is removed.', obj({ id, data: { type: 'object' }, tunes: { type: 'object' } }, ['id'])),
  'block.delete': write("Delete a block. Children move up unless the tool deletes them.", obj({ id }, ['id'])),
  'block.move': write('Move a block and its subtree.', obj({ id, parentId, position }, ['id', 'position'])),
  'block.convert': write("Turn a block into another type through both tools' conversionConfig.", obj({ id, type: { type: 'string', minLength: 1 }, data: { type: 'object' } }, ['id', 'type'])),
  'block.duplicate': write('Deep-copy a block with new ids.', obj({ id, position })),
  'text.insert': write('Insert text into a rich-text field.', obj({
    id, field: { type: 'string' }, at: { oneOf: [{ type: 'integer', minimum: 0 }, obj({ after: { type: 'string', minLength: 1 } }, ['after'])] },
    text: richOrString, marks: { type: 'object' },
  }, ['id', 'at', 'text'])),
  'text.delete': write('Delete a range of text.', obj({ id, field: { type: 'string' }, range }, ['id', 'range'])),
  'text.replace': write('Replace a range, or the whole field.', obj({ id, field: { type: 'string' }, range, with: richOrString }, ['id', 'with'])),
  'text.format': write('Set or clear marks on a range.', obj({ id, field: { type: 'string' }, range, set: { type: 'object' }, unset: { type: 'array', items: { type: 'string' } } }, ['id', 'range'])),
  'markdown.insert': write('Convert Markdown into blocks and insert them. Additive.', obj({ markdown: { type: 'string' }, parentId, position }, ['markdown'])),
  'markdown.export': read('Export the document or a subtree as Markdown.', obj({ rootId: id })),
  'history.undo': write("Undo this session's last step. Never the user's.", obj({})),
  'history.redo': write("Redo this session's last undone step.", obj({})),
};
```

```ts
// src/shared/agent/envelope.ts
import type { AgentBatch, AgentCommand } from '../../../types/agent';
import { failure } from './errors';
import { splitCommandName } from './names';
import type { PlannerCommand, SchemaValidator } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toolActions = (commands: ReadonlyMap<string, PlannerCommand>, tool: string): string[] =>
  [...commands.values()].filter(entry => typeof entry.source === 'object' && entry.source.tool === tool).map(entry => entry.name).sort();

export const checkEnvelope = (
  batch: unknown,
  commands: ReadonlyMap<string, PlannerCommand>,
  validate: SchemaValidator
): { batch: AgentBatch; writes: boolean } => {
  if (!isRecord(batch) || !Array.isArray(batch.commands) || batch.commands.length === 0) {
    throw failure('INVALID_ARGS', 'A batch is { commands: [ { name, args } ... ] } with at least one command.', { path: '/commands' });
  }
  if (batch.expectRevision !== undefined && typeof batch.expectRevision !== 'string') {
    throw failure('INVALID_ARGS', 'expectRevision must be the string a read or result returned.', { path: '/expectRevision' });
  }

  const list = batch.commands as unknown[];
  const entries = list.map((raw, index): { command: AgentCommand; entry: PlannerCommand } => {
    const path = `/commands/${index}`;

    if (!isRecord(raw) || typeof raw.name !== 'string' || !isRecord(raw.args) || (raw.ref !== undefined && typeof raw.ref !== 'string')) {
      throw failure('INVALID_ARGS', 'Each command is { name: string, args: object, ref?: string }.', { commandIndex: index, path });
    }

    const entry = commands.get(raw.name);

    if (entry === undefined) {
      const split = splitCommandName(raw.name);
      const actions = split === null ? [] : toolActions(commands, split.namespace);

      throw failure('UNKNOWN_COMMAND', actions.length > 0
        ? `"${raw.name}" is not an action of "${split?.namespace}". Its actions: ${actions.join(', ')}.`
        : `"${raw.name}" is not a command here. Call describe() for the list.`, {
        commandIndex: index, path: `${path}/name`,
        ...(actions.length > 0 && { details: { tool: split?.namespace, actions } }),
      });
    }
    if (!entry.available) {
      throw failure('COMMAND_UNAVAILABLE', `"${raw.name}" is not available in this runtime${entry.unavailableReason === 'service' ? ': the host has not provided a service it needs' : ''}.`, {
        commandIndex: index, path: `${path}/name`,
        details: { reason: entry.unavailableReason ?? 'runtime', ...(entry.requires !== undefined && { requires: entry.requires }) },
      });
    }

    const problems = validate(entry.args, raw.args);

    if (problems.length > 0) {
      const [first] = problems;

      throw failure('INVALID_ARGS', `${raw.name}: ${first.message}`, {
        commandIndex: index, path: `${path}/args${first.path}`, details: { problems },
      });
    }

    return { command: raw as unknown as AgentCommand, entry };
  });

  entries.forEach(({ command, entry }, index) => {
    const alone = entry.effects === 'host' || command.name.startsWith('history.');

    if (alone && entries.length > 1) {
      throw failure('INVALID_ARGS', `"${command.name}" must be the only command in its batch. Send the other commands in a separate execute call.`, {
        commandIndex: index, path: `/commands/${index}/name`,
      });
    }
  });

  return {
    batch: { commands: entries.map(({ command }) => command), ...(typeof batch.expectRevision === 'string' && { expectRevision: batch.expectRevision }) },
    writes: entries.some(({ entry }) => !entry.readOnly),
  };
};
```

Note: if 02's `validateAgainst` reports a missing required key with a path other than `''` (e.g. `/id`), adjust the second `path` expectation in the test to what it returns for the `block.delete` case; the `block.update` case with `id: 7` must point at `/commands/0/args/id` either way.

- [ ] **Step 4: Run it to make sure it passes**

Run: `yarn test test/unit/shared/agent/envelope.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/shared/agent/types.ts src/shared/agent/commands.ts src/shared/agent/envelope.ts test/unit/shared/agent/envelope.test.ts test/unit/shared/agent/fixtures.ts
git add src/shared/agent/types.ts src/shared/agent/commands.ts src/shared/agent/envelope.ts test/unit/shared/agent/envelope.test.ts test/unit/shared/agent/fixtures.ts
git commit -m "feat(agent): COMMANDS registry and envelope checks

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 4: `DocSnapshot`, the working copy every planner step reads

**Files:**
- Create: `src/shared/agent/snapshot.ts`
- Test: `test/unit/shared/agent/snapshot.test.ts`

**Interfaces:**
- Consumes: `OutputData`, `OutputBlockData` (`types/data-formats/output-data.d.ts`), `PageIcon`.
- Produces:
  - `interface SnapBlock { id: string; type: string; data: Record<string, unknown>; tunes?: Record<string, unknown>; parent: string | null; content: string[]; rest: Record<string, unknown> }` (`rest` keeps `indent`, `lastEditedAt`, `lastEditedBy` and unknown keys).
  - `class DocSnapshot` with: `static fromOutput(doc: OutputData): DocSnapshot`, `toOutput(): OutputData`, `clone(): DocSnapshot`, `has(id)`, `get(id): SnapBlock | undefined`, `ids(): string[]`, `childrenOf(parentId: string | null): readonly string[]`, `parentOf(id): string | null`, `isUnder(id, ancestorId): boolean`, `subtree(id): string[]` (pre-order, root first), `readingOrder(rootId: string | null): Array<{ id: string; depth: number }>`, `cellOf(id): { tableId: string; row: number; col: number } | null`, `put(block: SnapBlock)`, `drop(id)`, `link(id, parentId, afterId)`, `unlink(id)`, `title?: string`, `icon?: PageIcon`.
  - Rich fields in a snapshot are already segments; loaders convert (Tasks 19, 26, 34).

`content` order is the truth for children, parents first in `toOutput()` (pre-order). A child whose `parent` names a block that does not list it is appended to that parent's order (the Notion-model rule, `parentId` is the membership arbiter).

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/shared/agent/snapshot.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';
import type { OutputData } from '../../../../types';

const doc: OutputData = {
  title: 'Plan',
  blocks: [
    { id: 't', type: 'toggle', data: { text: [{ text: 'T' }] }, content: ['a', 'b'] },
    { id: 'a', type: 'paragraph', data: { text: [] }, parent: 't', lastEditedBy: 'u1' },
    { id: 'b', type: 'paragraph', data: { text: [] }, parent: 't' },
    { id: 'tbl', type: 'table', data: { content: [[{ blocks: ['c1'] }, { blocks: ['c2'] }]] }, content: ['c1', 'c2'] },
    { id: 'c1', type: 'paragraph', data: {}, parent: 'tbl' },
    { id: 'c2', type: 'toggle', data: {}, parent: 'tbl', content: ['deep'] },
    { id: 'deep', type: 'paragraph', data: {}, parent: 'c2' },
    { id: 'z', type: 'paragraph', data: {} },
  ],
};

describe('DocSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('round-trips a document, page fields and unknown keys included', () => {
    expect(DocSnapshot.fromOutput(doc).toOutput()).toEqual(doc);
  });

  it('answers tree questions', () => {
    const snap = DocSnapshot.fromOutput(doc);

    expect(snap.childrenOf(null)).toEqual(['t', 'tbl', 'z']);
    expect(snap.parentOf('deep')).toBe('c2');
    expect(snap.isUnder('deep', 'tbl')).toBe(true);
    expect(snap.subtree('t')).toEqual(['t', 'a', 'b']);
    expect(snap.readingOrder('tbl')).toEqual([{ id: 'c1', depth: 0 }, { id: 'c2', depth: 0 }, { id: 'deep', depth: 1 }]);
  });

  it('finds the table cell of a block and of its descendants', () => {
    const snap = DocSnapshot.fromOutput(doc);

    expect(snap.cellOf('c2')).toEqual({ tableId: 'tbl', row: 0, col: 1 });
    expect(snap.cellOf('deep')).toEqual({ tableId: 'tbl', row: 0, col: 1 });
    expect(snap.cellOf('a')).toBeNull();
  });

  it('links and unlinks without touching the clone source', () => {
    const snap = DocSnapshot.fromOutput(doc);
    const copy = snap.clone();

    copy.unlink('b');
    copy.link('b', null, 't');

    expect(copy.childrenOf(null)).toEqual(['t', 'b', 'tbl', 'z']);
    expect(copy.get('b')?.parent).toBeNull();
    expect(snap.childrenOf('t')).toEqual(['a', 'b']);
  });

  it('adopts a child its parent does not list', () => {
    const snap = DocSnapshot.fromOutput({ blocks: [
      { id: 'p', type: 'toggle', data: {} },
      { id: 'k', type: 'paragraph', data: {}, parent: 'p' },
    ] });

    expect(snap.childrenOf('p')).toEqual(['k']);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `yarn test test/unit/shared/agent/snapshot.test.ts`
Expected: FAIL with `Failed to resolve import "../../../../src/shared/agent/snapshot"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/agent/snapshot.ts
import type { OutputBlockData, OutputData } from '../../../types/data-formats/output-data';
import type { PageIcon } from '../../../types/tools/page';

export interface SnapBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
  tunes?: Record<string, unknown>;
  parent: string | null;
  content: string[];
  rest: Record<string, unknown>;
}

const OWN_KEYS = new Set(['id', 'type', 'data', 'tunes', 'parent', 'content']);
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const cellsOf = (block: SnapBlock): Array<{ row: number; col: number; ids: string[] }> => {
  const grid = block.data.content;

  if (!Array.isArray(grid)) {
    return [];
  }

  return grid.flatMap((row, r) => Array.isArray(row)
    ? row.flatMap((cell, c) => {
      const ids = (cell as { blocks?: unknown } | null)?.blocks;

      return Array.isArray(ids) ? [{ row: r, col: c, ids: ids.filter((id): id is string => typeof id === 'string') }] : [];
    })
    : []);
};

export class DocSnapshot {
  public title?: string;
  public icon?: PageIcon;

  private constructor(
    private readonly blocks: Map<string, SnapBlock>,
    private root: string[],
    private readonly head: Record<string, unknown>
  ) {}

  public static fromOutput(doc: OutputData): DocSnapshot {
    const blocks = new Map<string, SnapBlock>();

    for (const raw of doc.blocks) {
      const id = raw.id ?? '';
      const rest = Object.fromEntries(Object.entries(raw).filter(([key]) => !OWN_KEYS.has(key)));

      blocks.set(id, {
        id,
        type: raw.type,
        data: copy(raw.data ?? {}) as Record<string, unknown>,
        ...(raw.tunes !== undefined && { tunes: copy(raw.tunes) as Record<string, unknown> }),
        parent: typeof raw.parent === 'string' && raw.parent !== id ? raw.parent : null,
        content: [],
        rest: copy(rest),
      });
    }

    for (const raw of doc.blocks) {
      const own = blocks.get(raw.id ?? '');

      own?.content.push(...(raw.content ?? []).filter(child => blocks.get(child)?.parent === own.id));
    }

    for (const block of blocks.values()) {
      const parent = block.parent === null ? undefined : blocks.get(block.parent);

      if (block.parent !== null && parent === undefined) {
        block.parent = null;
      }
      if (parent !== undefined && !parent.content.includes(block.id)) {
        parent.content.push(block.id);
      }
    }

    const root = doc.blocks.map(block => block.id ?? '').filter(id => blocks.get(id)?.parent === null);
    const { blocks: _ignored, title, icon, ...head } = doc;
    const snap = new DocSnapshot(blocks, root, copy(head) as Record<string, unknown>);

    if (typeof title === 'string' && title !== '') {
      snap.title = title;
    }
    if (icon !== undefined && icon !== null) {
      snap.icon = copy(icon);
    }

    return snap;
  }

  public toOutput(): OutputData {
    const blocks: OutputBlockData[] = this.readingOrder(null).map(({ id }) => {
      const block = this.blocks.get(id) as SnapBlock;

      return {
        id: block.id,
        type: block.type,
        data: copy(block.data),
        ...(block.tunes !== undefined && { tunes: copy(block.tunes) }),
        ...(block.parent !== null && { parent: block.parent }),
        ...(block.content.length > 0 && { content: [...block.content] }),
        ...copy(block.rest),
      } as OutputBlockData;
    });

    return {
      ...copy(this.head),
      ...(this.title !== undefined && { title: this.title }),
      ...(this.icon !== undefined && { icon: copy(this.icon) }),
      blocks,
    } as OutputData;
  }

  public clone(): DocSnapshot {
    const snap = new DocSnapshot(
      new Map([...this.blocks].map(([id, block]) => [id, { ...copy(block), content: [...block.content] }])),
      [...this.root],
      copy(this.head)
    );

    snap.title = this.title;
    snap.icon = this.icon === undefined ? undefined : copy(this.icon);

    return snap;
  }

  public has(id: string): boolean {
    return this.blocks.has(id);
  }

  public get(id: string): SnapBlock | undefined {
    return this.blocks.get(id);
  }

  public ids(): string[] {
    return [...this.blocks.keys()];
  }

  public childrenOf(parentId: string | null): readonly string[] {
    return parentId === null ? this.root : this.blocks.get(parentId)?.content ?? [];
  }

  public parentOf(id: string): string | null {
    return this.blocks.get(id)?.parent ?? null;
  }

  public isUnder(id: string, ancestorId: string): boolean {
    const seen = new Set<string>();
    let cursor = this.parentOf(id);

    while (cursor !== null && !seen.has(cursor)) {
      if (cursor === ancestorId) {
        return true;
      }
      seen.add(cursor);
      cursor = this.parentOf(cursor);
    }

    return false;
  }

  public subtree(id: string): string[] {
    return [id, ...this.childrenOf(id).flatMap(child => this.subtree(child))];
  }

  public readingOrder(rootId: string | null): Array<{ id: string; depth: number }> {
    const walk = (parentId: string | null, depth: number): Array<{ id: string; depth: number }> =>
      this.childrenOf(parentId).flatMap(id => [{ id, depth }, ...walk(id, depth + 1)]);

    return walk(rootId, 0);
  }

  public cellOf(id: string): { tableId: string; row: number; col: number } | null {
    const lineage = [id];
    let cursor = this.parentOf(id);

    while (cursor !== null && !lineage.includes(cursor)) {
      lineage.push(cursor);
      cursor = this.parentOf(cursor);
    }

    for (const member of lineage) {
      const tableId = this.parentOf(member);
      const table = tableId === null ? undefined : this.blocks.get(tableId);
      const cell = table === undefined ? undefined : cellsOf(table).find(entry => entry.ids.includes(member));

      if (table !== undefined && cell !== undefined) {
        return { tableId: table.id, row: cell.row, col: cell.col };
      }
    }

    return null;
  }

  public put(block: SnapBlock): void {
    this.blocks.set(block.id, block);
  }

  public drop(id: string): void {
    this.unlink(id);
    this.blocks.delete(id);
  }

  /** Places `id` among `parentId`'s children right after `afterId` (null = first). */
  public link(id: string, parentId: string | null, afterId: string | null): void {
    const block = this.blocks.get(id);

    if (block === undefined) {
      return;
    }

    const order = parentId === null ? this.root : this.blocks.get(parentId)?.content;

    if (order === undefined) {
      return;
    }

    order.splice(afterId === null ? 0 : order.indexOf(afterId) + 1, 0, id);
    block.parent = parentId;
  }

  public unlink(id: string): void {
    const block = this.blocks.get(id);

    if (block === undefined) {
      return;
    }

    const order = block.parent === null ? this.root : this.blocks.get(block.parent)?.content;
    const at = order?.indexOf(id) ?? -1;

    if (order !== undefined && at >= 0) {
      order.splice(at, 1);
    }
    block.parent = null;
  }
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `yarn test test/unit/shared/agent/snapshot.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/shared/agent/snapshot.ts test/unit/shared/agent/snapshot.test.ts
git add src/shared/agent/snapshot.ts test/unit/shared/agent/snapshot.test.ts
git commit -m "feat(agent): DocSnapshot working copy with tree and table-cell queries

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Shared placement rules, used by the planner and by `block-placement.ts`

**Files:**
- Create: `src/shared/agent/placement-rules.ts`
- Modify: `src/components/modules/api/block-placement.ts:146-212` (`isColumnPart`, `cellOf`, `assertCanMoveUnder`), `src/components/utils/child-tools.ts:53-70` (`satisfiesChildToolRestrictions` delegates)
- Test: `test/unit/shared/agent/placement-rules.test.ts`, `test/unit/architecture/agent-placement-parity-law.test.ts`

**Interfaces:**
- Consumes: `PlacementRefusalReason` (Task 1), `DocSnapshot` (Task 4).
- Produces:
  - `interface ContainerFacts { accepts: boolean; allow?: string[]; deny?: string[]; ownedByTool: boolean }`
  - `interface PlacementTree { parentOf(id: string): string | null; typeOf(id: string): string; cellOf(id: string, asParent: boolean): unknown; containerFacts(id: string): ContainerFacts; restrictedInCell(type: string): boolean }` (`cellOf` returns any identity, `null` = not in a cell; equal cells compare `===`).
  - `type RefusalReason = PlacementRefusalReason | 'COLUMN_BOUNDARY'`; `interface Refusal { reason: RefusalReason; message: string; allowed?: string[] }`.
  - `satisfiesChildTools(allow: string[] | undefined, deny: string[] | undefined, type: string): boolean`.
  - `checkChildType(tree: PlacementTree, parentId: string | null, type: string): Refusal | null` (insert rule: accepts, allow/deny, restricted in a cell).
  - `checkMove(tree: PlacementTree, blockId: string, parentId: string | null, refId: string | undefined, options?: { allowColumnMoves?: boolean }): Refusal | null` — the same order and messages as today's `assertCanMoveUnder`.
  - `snapshotTree(snap: DocSnapshot, factsOf: (type: string) => (ContainerFacts & { restrictedInTableCell: boolean }) | undefined): PlacementTree` (unknown types read as "accepts anything, owns nothing").
  - `assertCanMoveUnder(tree, block, parentId, refId?, options?: { allowColumnMoves?: boolean })` keeps its exported name and throw type; the 5th parameter is new and internal.

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/shared/agent/placement-rules.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkChildType, checkMove, snapshotTree } from '../../../../src/shared/agent/placement-rules';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';
import { TOOLS } from './fixtures';

const factsOf = (type: string) => {
  const entry = TOOLS.get(type)?.entry;

  return entry === undefined ? undefined : { ...entry.children, restrictedInTableCell: entry.restrictedInTableCell };
};

const snap = DocSnapshot.fromOutput({ blocks: [
  { id: 'tg', type: 'toggle', data: {}, content: ['in'] },
  { id: 'in', type: 'paragraph', data: {}, parent: 'tg' },
  { id: 'dv', type: 'divider', data: {} },
  { id: 'cl', type: 'column_list', data: {}, content: ['c1'] },
  { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['x'] },
  { id: 'x', type: 'paragraph', data: {}, parent: 'c1' },
  { id: 'tbl', type: 'table', data: { content: [[{ blocks: ['cell'] }]] }, content: ['cell'] },
  { id: 'cell', type: 'paragraph', data: {}, parent: 'tbl' },
  { id: 'free', type: 'paragraph', data: {} },
  { id: 'h', type: 'header', data: {} },
] });
const tree = snapshotTree(snap, factsOf);

describe('placement rules over a snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['OWN_SUBTREE', 'tg', 'in'],
    ['TAKES_NO_CHILDREN', 'free', 'dv'],
    ['OWNS_CHILDREN', 'free', 'cl'],
    ['TABLE_CELL_BOUNDARY', 'cell', null],
  ] as Array<[string, string, string | null]>)('refuses %s', (reason, blockId, parentId) => {
    expect(checkMove(tree, blockId, parentId, undefined)?.reason).toBe(reason);
  });

  it('refuses a denied child and lists nothing when only deny is set', () => {
    expect(checkChildType(tree, 'tg', 'table')).toMatchObject({ reason: 'CHILD_NOT_ALLOWED' });
    expect(checkChildType(tree, 'cl', 'paragraph')).toMatchObject({ reason: 'CHILD_NOT_ALLOWED', allowed: ['column'] });
  });

  it('refuses a restricted tool under a cell block', () => {
    expect(checkChildType(tree, 'cell', 'header')).toMatchObject({ reason: 'RESTRICTED_IN_CELL' });
  });

  it('keeps the column rule unless the agent asks for column moves', () => {
    expect(checkMove(tree, 'free', 'c1', undefined)?.reason).toBe('COLUMN_BOUNDARY');
    expect(checkMove(tree, 'free', 'c1', undefined, { allowColumnMoves: true })).toBeNull();
  });

  it('allows a plain move', () => {
    expect(checkMove(tree, 'free', 'tg', 'in')).toBeNull();
  });
});
```

```ts
// test/unit/architecture/agent-placement-parity-law.test.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(resolve(__dirname, '../../../', path), 'utf-8');

/**
 * LAW: one copy of each placement rule. The editor's assertCanMoveUnder and
 * the agent planner both call src/shared/agent/placement-rules.ts.
 */
describe('agent placement parity law', () => {
  const placement = read('src/components/modules/api/block-placement.ts');
  const childTools = read('src/components/utils/child-tools.ts');

  it('block-placement.ts calls the shared checkMove', () => {
    expect(placement).toMatch(/from '\.\.\/\.\.\/\.\.\/shared\/agent\/placement-rules'/);
    expect(placement).toMatch(/checkMove\(/);
  });

  it('block-placement.ts holds no second copy of a rule message', () => {
    for (const message of ['owns its children', 'takes no children', 'into or out of a column', 'is not allowed inside a table cell']) {
      expect(placement).not.toContain(message);
    }
  });

  it('child-tools.ts delegates allow/deny to the shared predicate', () => {
    expect(childTools).toMatch(/satisfiesChildTools\(/);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `yarn test test/unit/shared/agent/placement-rules.test.ts test/unit/architecture/agent-placement-parity-law.test.ts`
Expected: FAIL — the first with `Failed to resolve import`, the law with `expected ... to match /checkMove\(/`.

- [ ] **Step 3: Write the shared rules**

```ts
// src/shared/agent/placement-rules.ts
import type { PlacementRefusalReason } from '../../../types/agent';
import type { DocSnapshot } from './snapshot';

export interface ContainerFacts { accepts: boolean; allow?: string[]; deny?: string[]; ownedByTool: boolean }

export interface PlacementTree {
  parentOf(id: string): string | null;
  typeOf(id: string): string;
  /** Any identity; null = not in a table cell. */
  cellOf(id: string, asParent: boolean): unknown;
  containerFacts(id: string): ContainerFacts;
  restrictedInCell(type: string): boolean;
}

export type RefusalReason = PlacementRefusalReason | 'COLUMN_BOUNDARY';
export interface Refusal { reason: RefusalReason; message: string; allowed?: string[] }

const nameOf = (parentId: string | null): string => parentId === null ? 'the root' : `"${parentId}"`;
// Column membership is keyed by these names in core today (block-placement.ts isColumnPart).
const isColumnPart = (type: string | undefined): boolean => type === 'column' || type === 'column_list';

/** Empty allow/deny lists read as "no restriction", as in child-tools.ts. */
export const satisfiesChildTools = (allow: string[] | undefined, deny: string[] | undefined, type: string): boolean => {
  if (deny !== undefined && deny.length > 0 && deny.includes(type)) {
    return false;
  }

  return allow === undefined || allow.length === 0 || allow.includes(type);
};

const isUnder = (tree: PlacementTree, id: string, ancestorId: string): boolean => {
  const seen = new Set<string>();
  let cursor = tree.parentOf(id);

  while (cursor !== null && !seen.has(cursor)) {
    if (cursor === ancestorId) {
      return true;
    }
    seen.add(cursor);
    cursor = tree.parentOf(cursor);
  }

  return false;
};

export const checkChildType = (tree: PlacementTree, parentId: string | null, type: string): Refusal | null => {
  if (parentId === null) {
    return null;
  }

  const facts = tree.containerFacts(parentId);

  if (!facts.accepts) {
    return { reason: 'TAKES_NO_CHILDREN', message: `${nameOf(parentId)} takes no children` };
  }
  if (!satisfiesChildTools(facts.allow, facts.deny, type)) {
    return {
      reason: 'CHILD_NOT_ALLOWED',
      message: `${nameOf(parentId)} does not allow "${type}" children`,
      ...(facts.allow !== undefined && facts.allow.length > 0 && { allowed: [...facts.allow] }),
    };
  }
  if (tree.cellOf(parentId, true) !== null && tree.restrictedInCell(type)) {
    return { reason: 'RESTRICTED_IN_CELL', message: `"${type}" is not allowed inside a table cell` };
  }

  return null;
};

export const checkMove = (
  tree: PlacementTree,
  blockId: string,
  parentId: string | null,
  refId: string | undefined,
  options: { allowColumnMoves?: boolean } = {}
): Refusal | null => {
  if (parentId !== null && (parentId === blockId || isUnder(tree, parentId, blockId))) {
    return { reason: 'OWN_SUBTREE', message: `cannot move "${blockId}" inside its own subtree` };
  }

  // Before the same-parent return: the cells of one table share the table as parent.
  const parentCell = parentId === null ? null : tree.cellOf(parentId, true);
  const targetCell = refId === undefined ? parentCell : tree.cellOf(refId, false);

  if (tree.cellOf(blockId, false) !== targetCell) {
    return { reason: 'TABLE_CELL_BOUNDARY', message: `cannot move "${blockId}" into, out of or between table cells` };
  }

  const oldParentId = tree.parentOf(blockId);

  if (parentId === oldParentId) {
    return null;
  }

  const type = tree.typeOf(blockId);
  const facts = parentId === null ? undefined : tree.containerFacts(parentId);

  if (facts !== undefined && !facts.accepts) {
    return { reason: 'TAKES_NO_CHILDREN', message: `${nameOf(parentId)} takes no children` };
  }
  if (facts?.ownedByTool === true) {
    return { reason: 'OWNS_CHILDREN', message: `${nameOf(parentId)} owns its children` };
  }
  if (oldParentId !== null && tree.containerFacts(oldParentId).ownedByTool) {
    return { reason: 'OWNS_CHILDREN', message: `"${oldParentId}" owns its children; "${blockId}" cannot leave it` };
  }
  if (options.allowColumnMoves !== true
    && (isColumnPart(oldParentId === null ? undefined : tree.typeOf(oldParentId)) || isColumnPart(parentId === null ? undefined : tree.typeOf(parentId)))) {
    return { reason: 'COLUMN_BOUNDARY', message: `cannot move "${blockId}" into or out of a column` };
  }
  if (facts !== undefined && !satisfiesChildTools(facts.allow, facts.deny, type)) {
    return {
      reason: 'CHILD_NOT_ALLOWED',
      message: `${nameOf(parentId)} does not allow "${type}" children`,
      ...(facts.allow !== undefined && facts.allow.length > 0 && { allowed: [...facts.allow] }),
    };
  }
  if (parentId !== null && tree.cellOf(parentId, true) !== null && tree.restrictedInCell(type)) {
    return { reason: 'RESTRICTED_IN_CELL', message: `"${type}" is not allowed inside a table cell` };
  }

  return null;
};

const OPEN: ContainerFacts = { accepts: true, ownedByTool: false };

export const snapshotTree = (
  snap: DocSnapshot,
  factsOf: (type: string) => (ContainerFacts & { restrictedInTableCell: boolean }) | undefined
): PlacementTree => ({
  parentOf: id => snap.parentOf(id),
  typeOf: id => snap.get(id)?.type ?? '',
  cellOf: (id) => {
    const cell = snap.cellOf(id);

    return cell === null ? null : `${cell.tableId}:${cell.row}:${cell.col}`;
  },
  containerFacts: id => factsOf(snap.get(id)?.type ?? '') ?? OPEN,
  restrictedInCell: type => factsOf(type)?.restrictedInTableCell === true,
});
```

Note: `snapshotTree.cellOf` returns a string key, so equal cells compare `===`. The parity table at the bottom of this task explains why `asParent` is ignored for snapshots.

- [ ] **Step 4: Make `block-placement.ts` and `child-tools.ts` use the shared rules**

In `src/components/modules/api/block-placement.ts`, delete `isColumnPart` and `cellOf` (lines 146-153) and replace the body of `assertCanMoveUnder` (lines 166-212) with:

```ts
import { checkMove, type PlacementTree } from '../../../shared/agent/placement-rules';
import { getChildToolRestrictions } from '../../utils/child-tools';

/** The editor's tree for the shared rules. Cells are found through the DOM here. */
const blockPlacementTree = (tree: BlockTree): PlacementTree => ({
  parentOf: id => tree.getBlockById(id)?.parentId ?? null,
  typeOf: id => tree.getBlockById(id)?.name ?? '',
  cellOf: (id, asParent) => {
    const block = tree.getBlockById(id);

    return block === undefined ? null : (asParent ? block.holder : block.holder.parentElement)?.closest('[data-blok-table-cell-blocks]') ?? null;
  },
  containerFacts: (id) => {
    const block = tree.getBlockById(id);
    const restrictions = getChildToolRestrictions(block);

    return { accepts: acceptsChildren(block), allow: restrictions?.allow, deny: restrictions?.deny, ownedByTool: block?.tool.ownsChildren === true };
  },
  restrictedInCell: isRestrictedInTableCell,
});

export const assertCanMoveUnder = (
  tree: BlockTree,
  block: Block,
  parentId: string | null,
  refId?: string,
  options: { allowColumnMoves?: boolean } = {}
): void => {
  if (parentId !== null) {
    findBlock(tree, parentId, 'parent block');
  }

  const refusal = checkMove(blockPlacementTree(tree), block.id, parentId, refId, options);

  if (refusal !== null) {
    throw new BlockPlacementError(refusal.message);
  }
};
```

Remove the now-unused imports `isInsideTableCell` and `isChildToolAllowed` from that file (keep `isRestrictedInTableCell`, `acceptsChildren`).

In `src/components/utils/child-tools.ts`, replace the body of `satisfiesChildToolRestrictions` (lines 53-70):

```ts
import { satisfiesChildTools } from '../../shared/agent/placement-rules';

export const satisfiesChildToolRestrictions = (
  restrictions: ChildToolRestrictions | undefined,
  toolName: string
): boolean => restrictions === undefined || satisfiesChildTools(restrictions.allow, restrictions.deny, toolName);
```

- [ ] **Step 5: Run the new tests and the existing placement tests**

Run: `yarn test test/unit/shared/agent/placement-rules.test.ts test/unit/architecture/agent-placement-parity-law.test.ts test/unit/components/modules/api/blocks-placement.integration.test.ts test/unit/components/modules/api/block-placement-export.test.ts`
Expected: PASS. The two existing files pin that the editor's refusals and their messages did not change.

Then grep for every other test that names a moved symbol and run those too:
Run (one file per run, so no file is skipped): `for f in $(grep -rlE "assertCanMoveUnder|satisfiesChildToolRestrictions|isChildToolAllowed" test/unit); do yarn test "$f" || break; done`
Expected: every run PASS.

- [ ] **Step 6: Lint and commit**

```bash
npx eslint src/shared/agent/placement-rules.ts src/components/modules/api/block-placement.ts src/components/utils/child-tools.ts test/unit/shared/agent/placement-rules.test.ts test/unit/architecture/agent-placement-parity-law.test.ts
git add src/shared/agent/placement-rules.ts src/components/modules/api/block-placement.ts src/components/utils/child-tools.ts test/unit/shared/agent/placement-rules.test.ts test/unit/architecture/agent-placement-parity-law.test.ts
git commit -m "refactor(placement): one copy of the move rules, shared with the agent planner

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Why `asParent` is ignored for snapshots: in the DOM, `holder.closest(...)` and `holder.parentElement.closest(...)` differ only if a holder itself carries `data-blok-table-cell-blocks`. A snapshot has no holders; a block is "in a cell" when it or an ancestor is listed in a table's `data.content` (01 §3.5 table). **Unverified:** that no holder carries that attribute; the existing placement integration tests are the guard.

---

### Task 6: Rich-text range math (`RichTextHelpers`)

**Files:**
- Create: `src/shared/agent/rich-text-ops.ts`
- Test: `test/unit/shared/agent/rich-text-ops.test.ts`

**Interfaces:**
- Consumes: `canonicalizeSegments` (`src/shared/rich-text/html-to-segments.ts:220`), `failure` (Task 2), `RichTextHelpers`, `TextRange` (Task 1).
- Produces: `richTextHelpers: RichTextHelpers` and `KNOWN_MARKS: ReadonlySet<string>` (the keys of `RichTextMarks`, `types/rich-text.d.ts:13-29`). `resolve` throws `AgentFailure`: `RANGE_OUT_OF_BOUNDS` (bad or surrogate-splitting offsets), `RANGE_NOT_FOUND` (`find` misses; `details.text` holds the field's plain text), `INVALID_ARGS` (blank `find`, `occurrence < 1`), `STALE` (`expectText` mismatch; `details.current.text`).

- [ ] **Step 1: Write the failing test** (Review Focus 1 and 2 are the last two cases)

```ts
// test/unit/shared/agent/rich-text-ops.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentFailure } from '../../../../src/shared/agent/errors';
import { richTextHelpers as rt } from '../../../../src/shared/agent/rich-text-ops';
import type { RichText } from '../../../../types';

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof AgentFailure) {
      return error.error.code;
    }
    throw error;
  }

  return 'none';
};

const value: RichText = [
  { text: 'Hello ' },
  { text: 'bold', marks: { bold: true } },
  { embed: { equation: { expression: 'x' } } },
  { text: ' end' },
];

describe('rich text helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('counts one unit per embed', () => {
    expect(rt.length(value)).toBe(15);
    expect(rt.plainText(value)).toBe('Hello bold￼ end');
  });

  it('formats across segment edges and merges equal neighbours', () => {
    expect(rt.format(value, 3, 8, { italic: true })).toEqual([
      { text: 'Hel' },
      { text: 'lo ', marks: { italic: true } },
      { text: 'bo', marks: { bold: true, italic: true } },
      { text: 'ld', marks: { bold: true } },
      { embed: { equation: { expression: 'x' } } },
      { text: ' end' },
    ]);
    expect(rt.format(value, 0, 15, undefined, ['bold'])[0]).toEqual({ text: 'Hello bold' });
  });

  it('inserts and removes around an embed', () => {
    expect(rt.plainText(rt.insert(value, 11, [{ text: '!' }]))).toBe('Hello bold￼! end');
    expect(rt.remove(value, 10, 11)).toEqual([{ text: 'Hello ' }, { text: 'bold', marks: { bold: true } }, { text: ' end' }]);
  });

  it('resolves find with occurrence, and all', () => {
    const twice: RichText = [{ text: 'a b a b' }];

    expect(rt.resolve(twice, { find: 'b', occurrence: 2 })).toEqual({ start: 6, end: 7 });
    expect(rt.resolve(twice, 'all')).toEqual({ start: 0, end: 7 });
    expect(code(() => rt.resolve(twice, { find: 'zz' }))).toBe('RANGE_NOT_FOUND');
  });

  it('checks expectText and offsets', () => {
    expect(code(() => rt.resolve(value, { start: 0, end: 5, expectText: 'Jello' }))).toBe('STALE');
    expect(code(() => rt.resolve(value, { start: 4, end: 99 }))).toBe('RANGE_OUT_OF_BOUNDS');
    expect(code(() => rt.resolve(value, { start: 5, end: 2 }))).toBe('RANGE_OUT_OF_BOUNDS');
  });

  it('refuses an offset inside a surrogate pair (Review Focus 1)', () => {
    const emoji: RichText = [{ text: 'a\u{1F600}b' }];

    expect(code(() => rt.resolve(emoji, { start: 2, end: 3 }))).toBe('RANGE_OUT_OF_BOUNDS');
    expect(rt.resolve(emoji, { start: 1, end: 3 })).toEqual({ start: 1, end: 3 });
  });

  it('refuses a blank find or occurrence 0 (Review Focus 2)', () => {
    expect(code(() => rt.resolve(value, { find: '' }))).toBe('INVALID_ARGS');
    expect(code(() => rt.resolve(value, { find: '   ' }))).toBe('INVALID_ARGS');
    expect(code(() => rt.resolve(value, { find: 'e', occurrence: 0 }))).toBe('INVALID_ARGS');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `yarn test test/unit/shared/agent/rich-text-ops.test.ts`
Expected: FAIL with `Failed to resolve import "../../../../src/shared/agent/rich-text-ops"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/agent/rich-text-ops.ts
import type { RichTextHelpers, TextRange } from '../../../types/agent';
import type { RichText, RichTextMarks, RichTextSegment } from '../../../types/rich-text';
import { canonicalizeSegments } from '../rich-text/html-to-segments';
import { failure } from './errors';

export const KNOWN_MARKS: ReadonlySet<string> = new Set([
  'bold', 'italic', 'underline', 'strikethrough', 'code', 'sup', 'sub', 'highlight', 'color', 'background', 'link',
]);
const EMBED_CHAR = '￼';

const isText = (segment: RichTextSegment): segment is { text: string; marks?: RichTextMarks } => 'text' in segment;
const unitsOf = (segment: RichTextSegment): number => isText(segment) ? segment.text.length : 1;
const plainText = (value: RichText): string => value.map(segment => isText(segment) ? segment.text : EMBED_CHAR).join('');
const length = (value: RichText): number => value.reduce((sum, segment) => sum + unitsOf(segment), 0);

const isLow = (code: number): boolean => code >= 0xDC00 && code <= 0xDFFF;
const splitsPair = (text: string, offset: number): boolean => offset > 0 && offset < text.length && isLow(text.charCodeAt(offset));

/** [left, right] at a contract offset; an embed is never split. */
const splitAt = (value: RichText, offset: number): [RichText, RichText] => {
  const left: RichText = [];
  const right: RichText = [];
  let cursor = 0;

  for (const segment of value) {
    const size = unitsOf(segment);

    if (cursor + size <= offset) {
      left.push(segment);
    } else if (cursor >= offset) {
      right.push(segment);
    } else if (isText(segment)) {
      const cut = offset - cursor;

      left.push({ ...segment, text: segment.text.slice(0, cut) });
      right.push({ ...segment, text: segment.text.slice(cut) });
    }
    cursor += size;
  }

  return [left, right];
};

const slice = (value: RichText, start: number, end: number): RichText => splitAt(splitAt(value, end)[0], start)[1];

const withMarks = (segment: RichTextSegment, set: RichTextMarks | undefined, unset: string[] | undefined): RichTextSegment => {
  const marks: Record<string, unknown> = { ...(segment.marks ?? {}), ...(set ?? {}) };

  for (const key of unset ?? []) {
    delete marks[key];
  }

  const { marks: _old, ...rest } = segment;

  return Object.keys(marks).length === 0 ? rest as RichTextSegment : { ...rest, marks: marks as RichTextMarks } as RichTextSegment;
};

const resolve = (value: RichText, range: TextRange): { start: number; end: number } => {
  const text = plainText(value);

  if (range === 'all') {
    return { start: 0, end: text.length };
  }
  if ('find' in range) {
    if (range.find.trim() === '') {
      throw failure('INVALID_ARGS', '`find` must contain non-space text.');
    }
    if (range.occurrence !== undefined && (!Number.isInteger(range.occurrence) || range.occurrence < 1)) {
      throw failure('INVALID_ARGS', '`occurrence` counts from 1.');
    }

    let at = -1;

    for (let count = 0; count < (range.occurrence ?? 1); count++) {
      at = text.indexOf(range.find, at + 1);
      if (at < 0) {
        throw failure('RANGE_NOT_FOUND', `"${range.find}" occurs fewer than ${range.occurrence ?? 1} time(s). Read the field text in details and retry.`, { details: { text } });
      }
    }

    return { start: at, end: at + range.find.length };
  }

  const { start, end } = range;

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length) {
    throw failure('RANGE_OUT_OF_BOUNDS', `Range ${start}..${end} is outside 0..${text.length}.`, { details: { length: text.length } });
  }
  if (splitsPair(text, start) || splitsPair(text, end)) {
    throw failure('RANGE_OUT_OF_BOUNDS', `Range ${start}..${end} splits an emoji or other surrogate pair. Move the edge by one unit.`, { details: { length: text.length } });
  }
  if (range.expectText !== undefined && text.slice(start, end) !== range.expectText) {
    throw failure('STALE', `The text at ${start}..${end} changed. It is now "${text.slice(start, end)}".`, { details: { current: { text } } });
  }

  return { start, end };
};

export const richTextHelpers: RichTextHelpers = {
  plainText,
  length,
  resolve,
  slice,
  insert: (value, at, inserted) => {
    const [left, right] = splitAt(value, at);

    return canonicalizeSegments([...left, ...inserted, ...right]);
  },
  remove: (value, start, end) => canonicalizeSegments([...splitAt(value, start)[0], ...splitAt(value, end)[1]]),
  format: (value, start, end, set, unset) => {
    const [head, tail] = splitAt(value, end);
    const [before, middle] = splitAt(head, start);

    return canonicalizeSegments([...before, ...middle.map(segment => withMarks(segment, set, unset)), ...tail]);
  },
  canonicalize: canonicalizeSegments,
};
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `yarn test test/unit/shared/agent/rich-text-ops.test.ts`
Expected: PASS (7 tests). If `canonicalizeSegments` orders mark keys differently than the expectation in "formats across segment edges", use `toEqual` on each segment's `marks` object (key order does not matter for `toEqual`) — it already does; do not change the implementation for key order.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/shared/agent/rich-text-ops.ts test/unit/shared/agent/rich-text-ops.test.ts
git add src/shared/agent/rich-text-ops.ts test/unit/shared/agent/rich-text-ops.test.ts
git commit -m "feat(agent): rich-text range math in contract units

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `JsonApplier`

**Files:**
- Create: `src/shared/agent/json-applier.ts`
- Test: `test/unit/shared/agent/json-applier.test.ts`

**Interfaces:**
- Consumes: `DocSnapshot`, `SnapBlock` (Task 4), `Edit`, `PlannedBlock` (Task 1).
- Produces: `interface EditStamp { actorId: string; at: number }` and `applyEdits(snap: DocSnapshot, edits: readonly Edit[], stamp: EditStamp | null): void` (mutates `snap`). Attribution rule used by every applier: `lastEditedBy` / `lastEditedAt` are stamped on blocks an edit **creates** (`insert`, every planned descendant) or **changes** (`setData`, `setRichText`, `setTunes`, `replaceType`). `move` and `remove` stamp nothing.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/shared/agent/json-applier.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyEdits } from '../../../../src/shared/agent/json-applier';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';

const base = (): DocSnapshot => DocSnapshot.fromOutput({ blocks: [
  { id: 't', type: 'toggle', data: { text: [{ text: 'T' }] }, content: ['a', 'b'] },
  { id: 'a', type: 'paragraph', data: { text: [{ text: 'A' }], keep: 1 }, parent: 't' },
  { id: 'b', type: 'paragraph', data: {}, parent: 't' },
  { id: 'z', type: 'paragraph', data: {} },
] });
const stamp = { actorId: 'agent-1', at: 42 };

describe('applyEdits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts a tree after a sibling and stamps every new block', () => {
    const snap = base();

    applyEdits(snap, [{ op: 'insert', parentId: null, afterId: 't', block: { id: 'n', type: 'toggle', data: {}, children: [{ id: 'n1', type: 'paragraph', data: {}, children: [] }] } }], stamp);

    expect(snap.childrenOf(null)).toEqual(['t', 'n', 'z']);
    expect(snap.childrenOf('n')).toEqual(['n1']);
    expect(snap.get('n1')?.rest).toMatchObject({ lastEditedBy: 'agent-1', lastEditedAt: 42 });
  });

  it('removes with children, or lifts them into the slot', () => {
    const gone = base();
    const lifted = base();

    applyEdits(gone, [{ op: 'remove', id: 't', withChildren: true }], stamp);
    applyEdits(lifted, [{ op: 'remove', id: 't', withChildren: false }], stamp);

    expect(gone.ids().sort()).toEqual(['z']);
    expect(lifted.childrenOf(null)).toEqual(['a', 'b', 'z']);
    expect(lifted.get('a')?.parent).toBeNull();
  });

  it('moves without stamping', () => {
    const snap = base();

    applyEdits(snap, [{ op: 'move', id: 'z', parentId: 't', afterId: 'a' }], stamp);

    expect(snap.childrenOf('t')).toEqual(['a', 'z', 'b']);
    expect(snap.get('z')?.rest.lastEditedBy).toBeUndefined();
  });

  it('merges data, deletes a null key, and sets one rich field', () => {
    const snap = base();

    applyEdits(snap, [
      { op: 'setData', id: 'a', patch: { keep: null, extra: 'x' } },
      { op: 'setRichText', id: 'a', field: 'text', value: [{ text: 'B', marks: { bold: true } }] },
    ], stamp);

    expect(snap.get('a')?.data).toEqual({ text: [{ text: 'B', marks: { bold: true } }], extra: 'x' });
  });

  it('retypes in place and keeps children and tunes', () => {
    const snap = base();

    applyEdits(snap, [
      { op: 'setTunes', id: 't', tunes: { align: { value: 'center' } } },
      { op: 'replaceType', id: 't', type: 'callout', data: { title: [{ text: 'T' }] } },
    ], stamp);

    expect(snap.get('t')).toMatchObject({ type: 'callout', data: { title: [{ text: 'T' }] }, tunes: { align: { value: 'center' } } });
    expect(snap.childrenOf('t')).toEqual(['a', 'b']);
  });

  it('writes and clears the page fields on the saved document', () => {
    const snap = base();

    applyEdits(snap, [{ op: 'setPageField', key: 'title', value: 'Plan' }, { op: 'setPageField', key: 'icon', value: { type: 'emoji', value: '🚀' } }], stamp);
    expect(snap.toOutput()).toMatchObject({ title: 'Plan', icon: { type: 'emoji', value: '🚀' } });

    applyEdits(snap, [{ op: 'setPageField', key: 'title', value: '' }, { op: 'setPageField', key: 'icon', value: null }], stamp);
    expect(snap.toOutput()).not.toHaveProperty('title');
    expect(snap.toOutput()).not.toHaveProperty('icon');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `yarn test test/unit/shared/agent/json-applier.test.ts`
Expected: FAIL with `Failed to resolve import "../../../../src/shared/agent/json-applier"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/agent/json-applier.ts
import type { Edit, PlannedBlock } from '../../../types/agent';
import type { PageIcon } from '../../../types/tools/page';
import type { DocSnapshot, SnapBlock } from './snapshot';

export interface EditStamp { actorId: string; at: number }

const stampOn = (block: SnapBlock | undefined, stamp: EditStamp | null): void => {
  if (block !== undefined && stamp !== null) {
    block.rest.lastEditedAt = stamp.at;
    block.rest.lastEditedBy = stamp.actorId;
  }
};

const insertTree = (snap: DocSnapshot, planned: PlannedBlock, parentId: string | null, afterId: string | null, stamp: EditStamp | null): void => {
  snap.put({
    id: planned.id,
    type: planned.type,
    data: JSON.parse(JSON.stringify(planned.data)) as Record<string, unknown>,
    ...(planned.tunes !== undefined && { tunes: JSON.parse(JSON.stringify(planned.tunes)) as Record<string, unknown> }),
    parent: null,
    content: [],
    rest: {},
  });
  snap.link(planned.id, parentId, afterId);
  stampOn(snap.get(planned.id), stamp);
  planned.children.reduce<string | null>((previous, child) => {
    insertTree(snap, child, planned.id, previous, stamp);

    return child.id;
  }, null);
};

export const applyEdits = (snap: DocSnapshot, edits: readonly Edit[], stamp: EditStamp | null): void => {
  for (const edit of edits) {
    switch (edit.op) {
      case 'insert':
        insertTree(snap, edit.block, edit.parentId, edit.afterId, stamp);
        break;
      case 'remove': {
        const block = snap.get(edit.id);

        if (block === undefined) {
          break;
        }
        if (edit.withChildren) {
          [...snap.subtree(edit.id)].reverse().forEach(id => snap.drop(id));
          break;
        }

        const parentId = block.parent;
        const siblings = snap.childrenOf(parentId);
        const at = siblings.indexOf(edit.id);
        let after = at > 0 ? siblings[at - 1] : null;

        for (const child of [...block.content]) {
          snap.unlink(child);
          snap.link(child, parentId, after);
          after = child;
        }
        snap.drop(edit.id);
        break;
      }
      case 'move':
        snap.unlink(edit.id);
        snap.link(edit.id, edit.parentId, edit.afterId);
        break;
      case 'setData': {
        const block = snap.get(edit.id);

        if (block === undefined) {
          break;
        }
        for (const [key, value] of Object.entries(edit.patch)) {
          if (value === null) {
            delete block.data[key];
          } else {
            block.data[key] = JSON.parse(JSON.stringify(value)) as unknown;
          }
        }
        stampOn(block, stamp);
        break;
      }
      case 'setRichText': {
        const block = snap.get(edit.id);

        if (block !== undefined) {
          block.data[edit.field] = JSON.parse(JSON.stringify(edit.value)) as unknown;
          stampOn(block, stamp);
        }
        break;
      }
      case 'setTunes': {
        const block = snap.get(edit.id);

        if (block !== undefined) {
          const tunes: Record<string, unknown> = { ...(block.tunes ?? {}) };

          for (const [name, value] of Object.entries(edit.tunes)) {
            if (value === null) {
              delete tunes[name];
            } else {
              tunes[name] = JSON.parse(JSON.stringify(value)) as unknown;
            }
          }
          block.tunes = Object.keys(tunes).length > 0 ? tunes : undefined;
          stampOn(block, stamp);
        }
        break;
      }
      case 'replaceType': {
        const block = snap.get(edit.id);

        if (block !== undefined) {
          block.type = edit.type;
          block.data = JSON.parse(JSON.stringify(edit.data)) as Record<string, unknown>;
          stampOn(block, stamp);
        }
        break;
      }
      case 'setPageField':
        if (edit.key === 'title') {
          snap.title = typeof edit.value === 'string' && edit.value !== '' ? edit.value : undefined;
        } else {
          snap.icon = edit.value !== null && typeof edit.value === 'object' ? edit.value as PageIcon : undefined;
        }
        break;
    }
  }
};
```

Also make `DocSnapshot.toOutput()` drop `tunes` when it is `undefined` (the spread guard in Task 4 already does: `block.tunes !== undefined`).

- [ ] **Step 4: Run it to make sure it passes**

Run: `yarn test test/unit/shared/agent/json-applier.test.ts test/unit/shared/agent/snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/shared/agent/json-applier.ts test/unit/shared/agent/json-applier.test.ts
git add src/shared/agent/json-applier.ts test/unit/shared/agent/json-applier.test.ts
git commit -m "feat(agent): JsonApplier for the eight primitive edits

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 8: Planner core, refs, and `block.insert`

**Files:**
- Create: `src/shared/agent/plan-state.ts`, `src/shared/agent/planner.ts`, `src/shared/agent/plan-block.ts`, `src/shared/agent/markdown-lookalike.ts`
- Modify: `test/unit/shared/agent/fixtures.ts` (add `plannerContext` and `planOn`)
- Test: `test/unit/shared/agent/plan-insert.test.ts`

**Interfaces:**
- Consumes: Tasks 2–7. `PlannerContext`, `Plan` (Task 3), `checkChildType`, `snapshotTree` (Task 5), `applyEdits`, `EditStamp` (Task 7), `richTextHelpers`, `KNOWN_MARKS` (Task 6).
- Produces:
  - `PREPARE_PENDING: unique symbol` (pre-plan sentinel in `ctx.prepared`).
  - `class PlanState` with `draft`, `ctx`, `index`, `edits`, `editCommand: number[]`, `results`, `refs`, `changed`, `touched`, `lastRange`, `warnings`, and methods `tool(type)`, `resolveId(value, path)`, `requireBlock(value, path): SnapBlock`, `place(parentArg, positionArg): { parentId: string | null; afterId: string | null }`, `emit(...edits)`, `warn(code, message, extra?)`, `fail(code, message, path?, details?): never`, `tree(): PlacementTree`, `prepareData(type, data, path, blockId, options?: { normalize?: boolean }): Record<string, unknown>`, `actionsOf(tool): string[]`.
  - `type CommandHandler = (state: PlanState, args: Record<string, unknown>) => unknown`.
  - `planBatch(input: { snapshot: DocSnapshot; batch: AgentBatch; ctx: PlannerContext; stamp: EditStamp; warnings: AgentWarning[] }): { plan: Plan; draft: DocSnapshot }` — `warnings` is the caller's array so warnings survive a thrown failure.
  - `registerHandlers(entries: Record<string, CommandHandler>): void` and `HANDLERS` (later tasks register `block.*`, `text.*`, `doc.*`, `markdown.*`).
  - `buildPlannedBlock(state, spec: InsertSpec, parent: { id: string | null } | { type: string; inCell: boolean }, path, demote, extra?): PlannedBlock` (reused by `block.duplicate`, `markdown.insert`, tool actions).
  - `looksLikeMarkdown(text: string): boolean`.

- [ ] **Step 1: Add the planner fixture**

Append to `test/unit/shared/agent/fixtures.ts`:

```ts
import { planBatch } from '../../../../src/shared/agent/planner';
import { richTextHelpers } from '../../../../src/shared/agent/rich-text-ops';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';
import type { AgentPorts, PlannerContext } from '../../../../src/shared/agent/types';
import { validateAgainst } from '../../../../src/shared/schema/validate';
import type { AgentCommand, AgentWarning, OutputData } from '../../../../types';

export const stubPorts = (over: Partial<AgentPorts> = {}): AgentPorts => {
  let next = 0;

  return {
    htmlToSegments: html => (html === '' ? [] : [{ text: html }]),
    sanitizeBlockData: (_type, data) => data,
    markdownToBlocks: () => Promise.resolve({ blocks: [], warnings: [] }),
    blocksToMarkdown: () => ({ markdown: '', warnings: [] }),
    newId: () => `n${++next}`,
    ...over,
  };
};

export const plannerContext = (over: Partial<PlannerContext> = {}): PlannerContext => ({
  tools: TOOLS,
  commands: coreCommandMap(),
  ports: stubPorts(),
  validate: validateAgainst,
  defaultBlock: 'paragraph',
  richText: richTextHelpers,
  prepared: new Map(),
  services: {},
  ...over,
});

/** Plans `commands` on `doc`. Returns the plan, the draft and the warnings, or the failure. */
export const planOn = (doc: OutputData, commands: AgentCommand[], over: Partial<PlannerContext> = {}) => {
  const warnings: AgentWarning[] = [];
  const out = planBatch({ snapshot: DocSnapshot.fromOutput(doc), batch: { commands }, ctx: plannerContext(over), stamp: { actorId: 'agent', at: 1 }, warnings });

  return { ...out, warnings };
};
```

- [ ] **Step 2: Write the failing test** (Review Focus 3 is the "refs" block)

```ts
// test/unit/shared/agent/plan-insert.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentFailure } from '../../../../src/shared/agent/errors';
import type { OutputData } from '../../../../types';
import { planOn, stubPorts } from './fixtures';

const doc: OutputData = { blocks: [
  { id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } },
  { id: 'tg', type: 'toggle', data: { text: [] } },
  { id: 'tbl', type: 'table', data: { content: [] } },
] };

const failOf = (fn: () => unknown): AgentFailure['error'] => {
  try {
    fn();
  } catch (error) {
    if (error instanceof AgentFailure) {
      return error.error;
    }
    throw error;
  }
  throw new Error('expected a failure');
};

describe('block.insert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts after a sibling with plain text turned into segments', () => {
    const { plan, draft } = planOn(doc, [{ name: 'block.insert', args: { type: 'paragraph', data: { text: '<b>x</b>' }, position: { after: 'p' } } }]);

    expect(plan.results[0]).toEqual({ id: 'n1', childIds: [] });
    expect(draft.childrenOf(null)).toEqual(['p', 'n1', 'tg', 'tbl']);
    expect(draft.get('n1')?.data.text).toEqual([{ text: '<b>x</b>' }]);
    expect(plan.changed.created).toEqual(['n1']);
  });

  it('keeps explicit children and seeds defaults only when none are given', () => {
    const explicit = planOn(doc, [{ name: 'block.insert', args: { type: 'column_list', children: [{ type: 'column' }] } }]);
    const seeded = planOn(doc, [{ name: 'block.insert', args: { type: 'column_list' } }]);

    expect(explicit.draft.childrenOf('n1')).toHaveLength(1);
    expect(seeded.draft.childrenOf('n1')).toHaveLength(2);
  });

  it('refuses a disallowed child and lists the allowed ones', () => {
    expect(failOf(() => planOn(doc, [{ name: 'block.insert', args: { type: 'paragraph', parentId: '$cl' } }, ]))).toMatchObject({ code: 'BLOCK_NOT_FOUND' });
    expect(failOf(() => planOn(doc, [
      { name: 'block.insert', args: { type: 'column_list', children: [{ type: 'column' }] }, ref: 'cl' },
      { name: 'block.insert', args: { type: 'paragraph', parentId: '$cl' } },
    ]))).toMatchObject({ code: 'PLACEMENT_REFUSED', commandIndex: 1, details: { reason: 'CHILD_NOT_ALLOWED', allowed: ['column'] } });
  });

  it('demotes on request and warns', () => {
    const { draft, warnings } = planOn(doc, [{ name: 'block.insert', args: { type: 'table', parentId: 'tg', demote: true } }]);

    expect(draft.get('n1')?.type).toBe('paragraph');
    expect(warnings.map(w => w.code)).toContain('DEMOTED');
  });

  it('refuses an unknown type and a self-placed parent', () => {
    expect(failOf(() => planOn(doc, [{ name: 'block.insert', args: { type: 'kanban' } }]))).toMatchObject({ code: 'UNKNOWN_TOOL' });
    expect(failOf(() => planOn(doc, [{ name: 'block.insert', args: { type: 'paragraph', parentId: 'tbl' } }]))).toMatchObject({
      code: 'PLACEMENT_REFUSED', details: { reason: 'SELF_PLACED_PARENT' },
    });
  });

  it('warns when sanitizing changed a field', () => {
    const ports = stubPorts({ sanitizeBlockData: (_type, data) => ({ ...data, text: [{ text: 'clean' }] }) });
    const { warnings } = planOn(doc, [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'dirty' } } }], { ports });

    expect(warnings).toContainEqual(expect.objectContaining({ code: 'SANITIZED', blockId: 'n1', field: 'text' }));
  });

  it('warns when text looks like Markdown, and still inserts', () => {
    const { warnings, draft } = planOn(doc, [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'see **this**' } } }]);

    expect(warnings.map(w => w.code)).toContain('LOOKS_LIKE_MARKDOWN');
    expect(draft.has('n1')).toBe(true);
  });

  it('refuses a caller id that is already taken', () => {
    expect(failOf(() => planOn(doc, [{ name: 'block.insert', args: { type: 'paragraph', id: 'p' } }]))).toMatchObject({ code: 'INVALID_ARGS', path: '/commands/0/args/id' });
  });

  describe('refs (Review Focus 3)', () => {
    it('resolves a ref made by an earlier command', () => {
      const { plan, draft } = planOn(doc, [
        { name: 'block.insert', args: { type: 'toggle' }, ref: 'a' },
        { name: 'block.insert', args: { type: 'paragraph', parentId: '$a' } },
      ]);

      expect(plan.refs).toEqual({ a: 'n1' });
      expect(draft.childrenOf('n1')).toEqual(['n2']);
    });

    it('names a ref used before the command that makes it', () => {
      expect(failOf(() => planOn(doc, [
        { name: 'block.insert', args: { type: 'paragraph', parentId: '$a' } },
        { name: 'block.insert', args: { type: 'toggle' }, ref: 'a' },
      ]))).toMatchObject({ code: 'BLOCK_NOT_FOUND', commandIndex: 0, details: { ref: 'a' } });
    });

    it('refuses the same ref twice', () => {
      expect(failOf(() => planOn(doc, [
        { name: 'block.insert', args: { type: 'toggle' }, ref: 'a' },
        { name: 'block.insert', args: { type: 'toggle' }, ref: 'a' },
      ]))).toMatchObject({ code: 'INVALID_ARGS', commandIndex: 1, path: '/commands/1/ref' });
    });
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `yarn test test/unit/shared/agent/plan-insert.test.ts`
Expected: FAIL with `Failed to resolve import "../../../../src/shared/agent/planner"`.

- [ ] **Step 4: Write the implementation**

```ts
// src/shared/agent/markdown-lookalike.ts
const MARKDOWN = /\*\*[^*\n]+\*\*|__[^_\n]+__|^#{1,6}\s|^\s*[-*+]\s+\S|^\s*\d+\.\s+\S|\[[^\]\n]+\]\([^)\n]+\)|`[^`\n]+`/m;

export const looksLikeMarkdown = (text: string): boolean => MARKDOWN.test(text);
```

```ts
// src/shared/agent/plan-state.ts
import type { AgentErrorCode, AgentWarning, AgentWarningCode, ChangedSet, Edit, TextRangeRef } from '../../../types/agent';
import type { RichText, RichTextSegment } from '../../../types/rich-text';
import { failure, warning } from './errors';
import { applyEdits, type EditStamp } from './json-applier';
import { looksLikeMarkdown } from './markdown-lookalike';
import { snapshotTree, type PlacementTree } from './placement-rules';
import { KNOWN_MARKS } from './rich-text-ops';
import type { DocSnapshot, SnapBlock } from './snapshot';
import type { PlannerContext, PlannerTool } from './types';

export const PREPARE_PENDING: unique symbol = Symbol('prepare-pending');

const nameOf = (parentId: string | null): string => parentId === null ? 'the root' : `"${parentId}"`;
const subtreeIds = (block: { id: string; children: Array<{ id: string; children: unknown[] }> }): string[] =>
  [block.id, ...block.children.flatMap(child => subtreeIds(child as typeof block))];

export class PlanState {
  public index = 0;
  public readonly edits: Edit[] = [];
  public readonly editCommand: number[] = [];
  public readonly results: unknown[] = [];
  public readonly refs: Record<string, string> = {};
  public readonly changed: ChangedSet = { created: [], updated: [], moved: [], removed: [] };
  public readonly touched = new Set<string>();
  public lastRange?: TextRangeRef;

  constructor(
    public readonly draft: DocSnapshot,
    public readonly ctx: PlannerContext,
    public readonly warnings: AgentWarning[],
    private readonly stamp: EditStamp
  ) {}

  public tool(type: string): PlannerTool | undefined {
    return this.ctx.tools.get(type);
  }

  public actionsOf(tool: string): string[] {
    return [...this.ctx.commands.values()]
      .filter(entry => typeof entry.source === 'object' && entry.source.tool === tool)
      .map(entry => entry.name)
      .sort();
  }

  public fail(code: AgentErrorCode, message: string, path = '', details?: Record<string, unknown>): never {
    throw failure(code, message, { commandIndex: this.index, path: `/commands/${this.index}/args${path}`, ...(details !== undefined && { details }) });
  }

  public warn(code: AgentWarningCode, message: string, extra: { blockId?: string; field?: string } = {}): void {
    this.warnings.push(warning(code, message, { commandIndex: this.index, ...extra }));
  }

  public resolveId(value: unknown, path: string): string {
    if (typeof value !== 'string' || value === '') {
      return this.fail('INVALID_ARGS', 'Expected a block id or "$ref".', path);
    }
    if (value.startsWith('$')) {
      const ref = value.slice(1);
      const id = this.refs[ref];

      return id ?? this.fail('BLOCK_NOT_FOUND', `No earlier command in this batch has ref "${ref}". A ref works only after the command that creates it.`, path, { ref });
    }

    return this.draft.has(value)
      ? value
      : this.fail('BLOCK_NOT_FOUND', `Block "${value}" does not exist. Read the document for current ids.`, path, { id: value });
  }

  public requireBlock(value: unknown, path: string): SnapBlock {
    return this.draft.get(this.resolveId(value, path)) as SnapBlock;
  }

  public tree(): PlacementTree {
    return snapshotTree(this.draft, (type) => {
      const entry = this.tool(type)?.entry;

      return entry === undefined ? undefined : { ...entry.children, restrictedInTableCell: entry.restrictedInTableCell };
    });
  }

  public place(parentArg: unknown, position: unknown): { parentId: string | null; afterId: string | null } {
    const parentId = parentArg === undefined ? undefined : parentArg === null ? null : this.resolveId(parentArg, '/parentId');

    if (typeof position === 'object' && position !== null) {
      const key = 'before' in position ? 'before' : 'after';
      const refId = this.resolveId((position as Record<string, unknown>)[key], `/position/${key}`);
      const refParent = this.draft.parentOf(refId);

      if (parentId !== undefined && parentId !== refParent) {
        this.fail('PLACEMENT_REFUSED', `Block "${refId}" is not a child of ${nameOf(parentId)}. Drop parentId or pick a sibling inside it.`, '/position', { reason: 'NOT_A_CHILD' });
      }
      if (key === 'after') {
        return { parentId: refParent, afterId: refId };
      }

      const siblings = this.draft.childrenOf(refParent);
      const at = siblings.indexOf(refId);

      return { parentId: refParent, afterId: at > 0 ? siblings[at - 1] : null };
    }

    const resolved = parentId ?? null;
    const siblings = this.draft.childrenOf(resolved);

    return { parentId: resolved, afterId: position === 'start' ? null : siblings[siblings.length - 1] ?? null };
  }

  /** Records edits and applies them to the draft, so later commands see them. */
  public emit(...edits: Edit[]): void {
    for (const edit of edits) {
      this.edits.push(edit);
      this.editCommand.push(this.index);
      switch (edit.op) {
        case 'insert':
          subtreeIds(edit.block).forEach((id) => {
            this.changed.created.push(id);
            this.touched.add(id);
          });
          break;
        case 'remove': {
          const ids = edit.withChildren ? this.draft.subtree(edit.id) : [edit.id];

          this.changed.removed.push(...ids);
          if (!edit.withChildren) {
            this.changed.moved.push(...this.draft.childrenOf(edit.id));
          }
          break;
        }
        case 'move':
          this.changed.moved.push(edit.id);
          break;
        case 'setPageField':
          break;
        default:
          this.changed.updated.push(edit.id);
          this.touched.add(edit.id);
      }
      applyEdits(this.draft, [edit], this.stamp);
    }
  }

  /** Rich fields → canonical segments; unknown marks dropped; sanitize; normalize. */
  public prepareData(type: string, raw: Record<string, unknown>, path: string, blockId: string, options: { normalize?: boolean } = {}): Record<string, unknown> {
    const tool = this.tool(type);
    const input: Record<string, unknown> = { ...raw };

    for (const field of tool?.entry.richTextFields ?? []) {
      const value = input[field];

      if (value === undefined) {
        continue;
      }

      const rich = typeof value === 'string'
        ? (value === '' ? [] : [{ text: value }])
        : Array.isArray(value) ? this.ctx.richText.canonicalize(this.dropUnknownMarks(value as RichText, blockId, field)) : null;

      if (rich === null) {
        this.fail('INVALID_ARGS', `"${field}" takes plain text or rich-text segments.`, `${path}/${field}`);
      }
      input[field] = rich;
      if (looksLikeMarkdown(this.ctx.richText.plainText(rich))) {
        this.warn('LOOKS_LIKE_MARKDOWN', `"${field}" looks like Markdown. It was saved as literal text. Use marks for formatting, or markdown.insert to convert Markdown.`, { blockId, field });
      }
    }

    const sanitized = this.ctx.ports.sanitizeBlockData(type, input);

    for (const key of Object.keys(input)) {
      if (JSON.stringify(sanitized[key]) !== JSON.stringify(input[key])) {
        this.warn('SANITIZED', `"${key}" was changed by the sanitizer. Read the block to see what was kept.`, { blockId, field: key });
      }
    }

    // A partial patch is normalized by the caller, after merging (block.update).
    return options.normalize === false || tool?.runtime.normalize === undefined ? sanitized : tool.runtime.normalize(sanitized);
  }

  private dropUnknownMarks(value: RichText, blockId: string, field: string): RichText {
    return value.map((segment): RichTextSegment => {
      const marks = segment.marks as Record<string, unknown> | undefined;

      if (marks === undefined) {
        return segment;
      }

      const unknown = Object.keys(marks).filter(key => !KNOWN_MARKS.has(key) && !key.startsWith('tag:'));

      if (unknown.length === 0) {
        return segment;
      }
      this.warn('UNKNOWN_MARK_DROPPED', `Unknown mark(s) ${unknown.join(', ')} dropped. Marks: ${[...KNOWN_MARKS].join(', ')}.`, { blockId, field });

      return { ...segment, marks: Object.fromEntries(Object.entries(marks).filter(([key]) => !unknown.includes(key))) } as RichTextSegment;
    });
  }
}
```

```ts
// src/shared/agent/plan-block.ts
import type { InsertSpec, PlannedBlock } from '../../../types/agent';
import { checkChildType, satisfiesChildTools } from './placement-rules';
import { PREPARE_PENDING, type PlanState } from './plan-state';

type Parent = { id: string | null } | { type: string; inCell: boolean };

const allowedHint = (allowed: string[] | undefined): string =>
  allowed === undefined ? ' Insert it next to the container instead, or pass demote: true.' : ` Allowed: ${allowed.join(', ')}. Or pass demote: true.`;

export const buildPlannedBlock = (
  state: PlanState,
  spec: InsertSpec,
  parent: Parent,
  path: string,
  demote: boolean,
  extra?: Record<string, unknown>
): PlannedBlock => {
  let type = spec.type;
  const parentType = 'type' in parent ? parent.type : parent.id === null ? undefined : state.draft.get(parent.id)?.type;

  if ('id' in parent && parent.id !== null && parentType !== undefined && state.tool(parentType)?.entry.selfPlacesChildren === true) {
    state.fail('PLACEMENT_REFUSED', `"${parentType}" places its own children. Use one of: ${state.actionsOf(parentType).join(', ')}.`, `${path}/parentId`, {
      reason: 'SELF_PLACED_PARENT', use: state.actionsOf(parentType),
    });
  }

  const refusal = 'type' in parent
    ? (() => {
      const facts = state.tool(parent.type)?.entry.children;

      if (facts !== undefined && !facts.accepts) {
        return { reason: 'TAKES_NO_CHILDREN' as const, message: `"${parent.type}" takes no children` };
      }
      if (facts !== undefined && !satisfiesChildTools(facts.allow, facts.deny, type)) {
        return { reason: 'CHILD_NOT_ALLOWED' as const, message: `"${parent.type}" does not allow "${type}" children`, allowed: facts.allow };
      }
      if (parent.inCell && state.tool(type)?.entry.restrictedInTableCell === true) {
        return { reason: 'RESTRICTED_IN_CELL' as const, message: `"${type}" is not allowed inside a table cell` };
      }

      return null;
    })()
    : checkChildType(state.tree(), parent.id, type);

  if (refusal !== null) {
    if (refusal.reason === 'CHILD_NOT_ALLOWED' && demote) {
      const to = refusal.allowed?.[0] ?? state.ctx.defaultBlock;

      state.warn('DEMOTED', `"${type}" is not allowed here and was inserted as "${to}".`);
      type = to;
    } else {
      state.fail('PLACEMENT_REFUSED', `${refusal.message}.${refusal.reason === 'CHILD_NOT_ALLOWED' ? allowedHint(refusal.allowed) : ''}`, `${path}/type`, {
        reason: refusal.reason, ...(refusal.allowed !== undefined && { allowed: refusal.allowed }),
      });
    }
  }

  const tool = state.tool(type);

  if (tool === undefined) {
    state.fail('UNKNOWN_TOOL', `No block tool "${type}" is registered. Known: ${[...state.ctx.tools.keys()].join(', ')}.`, `${path}/type`, { known: [...state.ctx.tools.keys()] });
  }
  if (spec.id !== undefined && state.draft.has(spec.id)) {
    state.fail('INVALID_ARGS', `Id "${spec.id}" is already in use. Omit id to get a fresh one.`, `${path}/id`);
  }

  const id = spec.id ?? state.ctx.ports.newId();
  const data = state.prepareData(type, { ...(spec.data ?? tool.entry.defaultData ?? {}), ...(extra ?? {}) }, `${path}/data`, id);
  const inCell = 'type' in parent ? parent.inCell : parent.id !== null && state.draft.cellOf(parent.id) !== null;
  const children = (spec.children ?? tool.runtime.defaultChildren ?? [])
    .map((child, i) => buildPlannedBlock(state, child, { type, inCell }, `${path}/children/${i}`, demote));

  return { id, type, data, ...(spec.tunes !== undefined && { tunes: spec.tunes }), children };
};

export const planInsert = (state: PlanState, args: Record<string, unknown>): unknown => {
  const placement = state.place(args.parentId, args.position ?? 'end');
  const prepared = state.ctx.prepared.get(state.index);
  const spec = args as unknown as InsertSpec;

  if (prepared === PREPARE_PENDING) {
    return { id: '', childIds: [] };
  }

  const planned = buildPlannedBlock(state, spec, { id: placement.parentId }, '', args.demote === true, prepared as Record<string, unknown> | undefined);

  state.emit({ op: 'insert', block: planned, parentId: placement.parentId, afterId: placement.afterId });

  return { id: planned.id, childIds: planned.children.map(child => child.id) };
};
```

```ts
// src/shared/agent/planner.ts
import type { AgentBatch, AgentWarning } from '../../../types/agent';
import { failure } from './errors';
import type { EditStamp } from './json-applier';
import { planInsert } from './plan-block';
import { PlanState } from './plan-state';
import type { DocSnapshot } from './snapshot';
import type { Plan, PlannerContext } from './types';

export type CommandHandler = (state: PlanState, args: Record<string, unknown>) => unknown;

export const HANDLERS: Record<string, CommandHandler> = { 'block.insert': planInsert };

export const registerHandlers = (entries: Record<string, CommandHandler>): void => {
  Object.assign(HANDLERS, entries);
};

/** Removed wins; a created block is not also "updated" or "moved". */
const settleChanged = (changed: Plan['changed']): Plan['changed'] => {
  const removed = new Set(changed.removed);
  const created = new Set(changed.created.filter(id => !removed.has(id)));
  const unique = (ids: string[], skip: Set<string>[]): string[] => [...new Set(ids)].filter(id => skip.every(set => !set.has(id)));

  return {
    created: [...created],
    updated: unique(changed.updated, [removed, created]),
    moved: unique(changed.moved, [removed, created]),
    removed: unique(changed.removed, [created]),
  };
};

export const planBatch = (input: {
  snapshot: DocSnapshot; batch: AgentBatch; ctx: PlannerContext; stamp: EditStamp; warnings: AgentWarning[];
}): { plan: Plan; draft: DocSnapshot } => {
  const state = new PlanState(input.snapshot.clone(), input.ctx, input.warnings, input.stamp);

  input.batch.commands.forEach((command, index) => {
    state.index = index;
    if (command.ref !== undefined && state.refs[command.ref] !== undefined) {
      throw failure('INVALID_ARGS', `ref "${command.ref}" is already used by an earlier command. Pick another name.`, { commandIndex: index, path: `/commands/${index}/ref` });
    }

    const handler = HANDLERS[command.name];

    if (handler === undefined) {
      throw failure('UNKNOWN_COMMAND', `"${command.name}" has no planner.`, { commandIndex: index, path: `/commands/${index}/name` });
    }

    const result = handler(state, command.args);

    state.results.push(result);
    if (command.ref !== undefined) {
      const id = (result as { id?: unknown } | undefined)?.id;

      if (typeof id !== 'string') {
        throw failure('INVALID_ARGS', `"${command.name}" creates no block, so it cannot carry a ref.`, { commandIndex: index, path: `/commands/${index}/ref` });
      }
      state.refs[command.ref] = id;
    }
  });

  return {
    plan: {
      edits: state.edits,
      results: state.results,
      refs: state.refs,
      changed: settleChanged(state.changed),
      ...(state.lastRange !== undefined && { lastRange: state.lastRange }),
      warnings: input.warnings,
      touched: state.touched,
    },
    draft: state.draft,
  };
};
```

Note: `Plan` gains no new field; `editCommand` stays on `PlanState` and is passed to Task 15's validation through `planBatch`'s return in that task.

- [ ] **Step 5: Run it to make sure it passes**

Run: `yarn test test/unit/shared/agent/plan-insert.test.ts`
Expected: PASS (11 tests). The first "refuses a disallowed child" assertion pins that an unknown `$cl` fails as `BLOCK_NOT_FOUND` before any rule runs.

- [ ] **Step 6: Lint and commit**

```bash
npx eslint src/shared/agent/plan-state.ts src/shared/agent/planner.ts src/shared/agent/plan-block.ts src/shared/agent/markdown-lookalike.ts test/unit/shared/agent/plan-insert.test.ts test/unit/shared/agent/fixtures.ts
git add src/shared/agent/plan-state.ts src/shared/agent/planner.ts src/shared/agent/plan-block.ts src/shared/agent/markdown-lookalike.ts test/unit/shared/agent/plan-insert.test.ts test/unit/shared/agent/fixtures.ts
git commit -m "feat(agent): planner core, refs and block.insert

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Refuse a bare insert of a tool that must be created by its action (02 open item)**

A table's cells are child blocks placed by `data.content`. `InsertSpec[]` cannot say which cell a child goes in, so 02 leaves `table.defaultChildren` unset and creates tables with `table.create` (02 Task 31). A bare `block.insert { type: 'table' }` would make a table with no cells. The rule is keyed on facts that come from the tool class, never on the name `table`: a host may register the table tool under another key, and then `selfPlacesChildren` is `false`, because `SELF_PLACING_PARENTS` is keyed by name (`src/tools/nested-blocks.ts:110`; 02 Review Focus 4, 06 B7). `ownedByTool` comes from the class's static `ownsChildren` (02 Task 5 reads `statics.ownsChildren`; the table declares it, `src/tools/table/index.ts:509`), so it survives a rename.

Rule: `block.insert` (the command handler only, not `buildPlannedBlock`, which `markdown.insert`, `block.duplicate` and tool actions reuse) refuses a type when all three hold: the manifest entry has `children.ownedByTool: true`, the tool runtime has no `defaultChildren`, and the contract lists `<type>.create`. Error: `INVALID_ARGS`, path `/type`, `details: { use: '<type>.create' }`, message "Create a <type> with <type>.create; block.insert cannot place its children." Still allowed: `column_list` and `tabs` (they own their children but declare `defaultChildren`, 02 Tasks 38, 39), `bookmark` (has `create` but owns no children, `ownsChildren` is declared only by table, tabs and column-list at `30c77599`).

Append to `test/unit/shared/agent/plan-insert.test.ts`:

```ts
  it('sends a bare insert of a tool that owns its children and has no default children to its create action', () => {
    const createOf = (tool: string): PlannerCommand => ({ name: `${tool}.create`, args: { type: 'object' }, readOnly: false, available: true, source: { tool, target: 'create' } });
    const commands = coreCommandMap();
    const tools = new Map(TOOLS);

    // A host's table under another key: selfPlacesChildren is false (name-keyed), ownedByTool stays true.
    tools.set('grid', tool('grid', { ...TOOLS.get('table')?.entry, name: 'grid', selfPlacesChildren: false }));
    commands.set('table.create', createOf('table'));
    commands.set('grid.create', createOf('grid'));
    commands.set('column_list.create', createOf('column_list'));

    expect(failOf(() => planOn(doc, [{ name: 'block.insert', args: { type: 'table' } }], { commands, tools }))).toMatchObject({
      code: 'INVALID_ARGS', commandIndex: 0, path: '/commands/0/args/type', details: { use: 'table.create' },
    });
    expect(failOf(() => planOn(doc, [{ name: 'block.insert', args: { type: 'grid' } }], { commands, tools }))).toMatchObject({ details: { use: 'grid.create' } });
    // column_list owns its children but seeds them, so the bare insert stays allowed.
    expect(planOn(doc, [{ name: 'block.insert', args: { type: 'column_list' } }], { commands, tools }).draft.get('n1')?.type).toBe('column_list');
    // No create action in the contract: unchanged.
    expect(planOn(doc, [{ name: 'block.insert', args: { type: 'table' } }]).draft.get('n1')?.type).toBe('table');
  });
```

Add `coreCommandMap`, `TOOLS` and `tool` to the file's import from `./fixtures`, and `import type { PlannerCommand } from '../../../../src/shared/agent/types';`.

Run: `yarn test test/unit/shared/agent/plan-insert.test.ts -t "owns its children"`
Expected: FAIL (the insert succeeds).

At the top of `planInsert` in `src/shared/agent/plan-block.ts`, after `const spec = …`:

```ts
  const type = String(spec.type);
  const target = state.tool(type);

  // Keyed on class facts, not the name: a renamed table keeps ownedByTool (06 B7).
  if (target?.entry.children.ownedByTool === true && target.runtime.defaultChildren === undefined && state.ctx.commands.has(`${type}.create`)) {
    state.fail('INVALID_ARGS', `Create a ${type} with ${type}.create; block.insert cannot place its children.`, '/type', { use: `${type}.create` });
  }
```

Run: `yarn test test/unit/shared/agent/plan-insert.test.ts`
Expected: PASS.

```bash
npx eslint src/shared/agent/plan-block.ts test/unit/shared/agent/plan-insert.test.ts
git add src/shared/agent/plan-block.ts test/unit/shared/agent/plan-insert.test.ts
git commit -m "feat(agent): block.insert sends a tool that must be created by its action to that action

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 9: `block.update`, `block.delete`, `block.duplicate`

**Files:**
- Modify: `src/shared/agent/plan-block.ts` (add three handlers), `src/shared/agent/planner.ts` (register them in `HANDLERS`)
- Test: `test/unit/shared/agent/plan-update-delete.test.ts`

**Interfaces:**
- Consumes: `PlanState`, `buildPlannedBlock` (Task 8).
- Produces: `planUpdate`, `planDelete`, `planDuplicate` (all `CommandHandler`). Results: `block.update` → `{ id }`; `block.delete` → `{ removedIds: string[]; liftedIds: string[] }` (children of a non-deleting container are lifted with explicit `move` edits right after the block, then the block is removed with `withChildren: false`); `block.duplicate` → `{ id; childIds }`. `block.update` raises `FIELD_NOT_WRITABLE` with `details: { reason: 'view-state' | 'guarded'; field; use? }` and `UNKNOWN_TOOL` with `details.opaque: true` for an unregistered type.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/shared/agent/plan-update-delete.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentFailure } from '../../../../src/shared/agent/errors';
import type { OutputData } from '../../../../types';
import { planOn, TOOLS, tool } from './fixtures';

const doc: OutputData = { blocks: [
  { id: 'h', type: 'header', data: { text: [{ text: 'H' }], level: 2, old: 'x' } },
  { id: 'tg', type: 'toggle', data: { text: [{ text: 'T' }] }, content: ['k'] },
  { id: 'k', type: 'paragraph', data: { text: [{ text: 'K' }] }, parent: 'tg' },
  { id: 'cl', type: 'column_list', data: {}, content: ['c'] },
  { id: 'c', type: 'column', data: {}, parent: 'cl' },
  { id: 'img', type: 'image', data: { url: 'u', zoom: 1 } },
  { id: 'tbl', type: 'table', data: { content: [] } },
  { id: 'kb', type: 'kanban', data: {} },
] };

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof AgentFailure) {
      return `${error.error.code}:${String(error.error.details?.reason ?? '')}`;
    }
    throw error;
  }

  return 'ok';
};

describe('block.update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes rich fields as setRichText and the rest as one setData; null removes', () => {
    const { plan, draft } = planOn(doc, [{ name: 'block.update', args: { id: 'h', data: { text: 'New', level: 3, old: null } } }]);

    expect(plan.edits).toEqual([
      { op: 'setRichText', id: 'h', field: 'text', value: [{ text: 'New' }] },
      { op: 'setData', id: 'h', patch: { old: null, level: 3 } },
    ]);
    expect(draft.get('h')?.data).toEqual({ text: [{ text: 'New' }], level: 3 });
    expect(plan.changed.updated).toEqual(['h']);
  });

  it('refuses view-state and guarded fields and names the command to use', () => {
    expect(codeOf(() => planOn(doc, [{ name: 'block.update', args: { id: 'img', data: { zoom: 2 } } }]))).toBe('FIELD_NOT_WRITABLE:view-state');
    expect(codeOf(() => planOn(doc, [{ name: 'block.update', args: { id: 'tbl', data: { content: [] } } }]))).toBe('FIELD_NOT_WRITABLE:guarded');
  });

  it('refuses an opaque block', () => {
    expect(codeOf(() => planOn(doc, [{ name: 'block.update', args: { id: 'kb', data: {} } }]))).toBe('UNKNOWN_TOOL:');
  });

  it('normalizes the merged data, not the patch', () => {
    const tools = new Map(TOOLS);
    tools.set('header', tool('header', { ...TOOLS.get('header')?.entry }, { normalize: data => ({ ...data, level: data.level ?? 2 }) }));

    const { plan } = planOn(doc, [{ name: 'block.update', args: { id: 'h', data: { old: null } } }], { tools });

    expect(plan.edits).toEqual([{ op: 'setData', id: 'h', patch: { old: null } }]);
  });
});

describe('block.delete', () => {
  it('lifts the children of a plain container', () => {
    const { plan, draft } = planOn(doc, [{ name: 'block.delete', args: { id: 'tg' } }]);

    expect(plan.results[0]).toEqual({ removedIds: ['tg'], liftedIds: ['k'] });
    expect(draft.childrenOf(null)[1]).toBe('k');
  });

  it('takes the subtree of a tool that deletes its children, and works on opaque blocks', () => {
    expect(planOn(doc, [{ name: 'block.delete', args: { id: 'cl' } }]).plan.results[0]).toEqual({ removedIds: ['cl', 'c'], liftedIds: [] });
    expect(planOn(doc, [{ name: 'block.delete', args: { id: 'kb' } }]).draft.has('kb')).toBe(false);
  });
});

describe('block.duplicate', () => {
  it('deep-copies with fresh ids right after the source', () => {
    const { plan, draft } = planOn(doc, [{ name: 'block.duplicate', args: { id: 'tg' } }]);
    const copy = plan.results[0] as { id: string; childIds: string[] };

    expect(draft.childrenOf(null).slice(0, 3)).toEqual(['h', 'tg', copy.id]);
    expect(copy.childIds).toHaveLength(1);
    expect(draft.get(copy.childIds[0])?.data.text).toEqual([{ text: 'K' }]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `yarn test test/unit/shared/agent/plan-update-delete.test.ts`
Expected: FAIL with `UNKNOWN_COMMAND` failures ("has no planner").

- [ ] **Step 3: Write the handlers**

Append to `src/shared/agent/plan-block.ts`:

```ts
import type { Edit, InsertSpec } from '../../../types/agent';
import type { PlannerTool } from './types';

const requireTool = (state: PlanState, blockId: string, type: string): PlannerTool => state.tool(type)
  ?? state.fail('UNKNOWN_TOOL', `Block "${blockId}" is a "${type}", which is not registered here. Only block.move and block.delete work on it.`, '/id', { opaque: true });

export const planUpdate = (state: PlanState, args: Record<string, unknown>): unknown => {
  const block = state.requireBlock(args.id, '/id');
  const tool = requireTool(state, block.id, block.type);
  const patch = (args.data ?? {}) as Record<string, unknown>;

  for (const field of Object.keys(patch)) {
    if (tool.entry.viewState.includes(field)) {
      state.fail('FIELD_NOT_WRITABLE', `"${field}" is view state. Agents do not set it.`, `/data/${field}`, { reason: 'view-state', field });
    }
    if (tool.entry.guardedFields[field] !== undefined) {
      const use = tool.entry.guardedFields[field];

      state.fail('FIELD_NOT_WRITABLE', `"${field}" keeps an invariant. Use ${use} instead.`, `/data/${field}`, { reason: 'guarded', field, use });
    }
  }

  const rich = tool.entry.richTextFields;
  const written = state.prepareData(block.type, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null)), '/data', block.id, { normalize: false });
  const after: Record<string, unknown> = { ...block.data, ...written };

  Object.entries(patch).filter(([, value]) => value === null).forEach(([key]) => delete after[key]);

  const normalized = tool.runtime.normalize?.(after) ?? after;
  const dataPatch: Record<string, unknown> = {
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value === null)),
    ...Object.fromEntries(Object.entries(written).filter(([key]) => !rich.includes(key))),
    ...Object.fromEntries(Object.entries(normalized).filter(([key, value]) => !rich.includes(key) && JSON.stringify(value) !== JSON.stringify(after[key]))),
  };
  const edits: Edit[] = [
    ...rich.filter(field => written[field] !== undefined).map((field): Edit => ({ op: 'setRichText', id: block.id, field, value: written[field] as never })),
    ...(Object.keys(dataPatch).length > 0 ? [{ op: 'setData', id: block.id, patch: dataPatch } as Edit] : []),
    ...(args.tunes !== undefined ? [{ op: 'setTunes', id: block.id, tunes: args.tunes as Record<string, unknown> } as Edit] : []),
  ];

  state.emit(...edits);

  return { id: block.id };
};

export const planDelete = (state: PlanState, args: Record<string, unknown>): unknown => {
  const block = state.requireBlock(args.id, '/id');
  const entry = state.tool(block.type)?.entry;
  const withChildren = entry?.children.deletedWithParent === true || entry?.selfPlacesChildren === true;
  const result = {
    removedIds: withChildren ? state.draft.subtree(block.id) : [block.id],
    liftedIds: withChildren ? [] : [...state.draft.childrenOf(block.id)],
  };

  // Lift the children with explicit moves first, so every applier (and the C#
  // room translator) only ever removes a block with no children left to lift.
  if (!withChildren) {
    let after = block.id;

    for (const child of [...block.content]) {
      state.emit({ op: 'move', id: child, parentId: block.parent, afterId: after });
      after = child;
    }
  }
  state.emit({ op: 'remove', id: block.id, withChildren });

  return result;
};

/** Every string equal to an id of the copied subtree is rewritten (table cells list child ids in data). */
const remapIds = (value: unknown, ids: ReadonlyMap<string, string>): unknown => {
  if (typeof value === 'string') {
    return ids.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map(item => remapIds(item, ids));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapIds(item, ids)]));
  }

  return value;
};

export const planDuplicate = (state: PlanState, args: Record<string, unknown>): unknown => {
  const source = state.requireBlock(args.id, '/id');

  requireTool(state, source.id, source.type);

  const placement = state.place(undefined, args.position ?? { after: source.id });
  const ids = new Map(state.draft.subtree(source.id).map(id => [id, state.ctx.ports.newId()]));
  const toSpec = (id: string): InsertSpec => {
    const block = state.draft.get(id);

    return {
      type: block?.type ?? '',
      id: ids.get(id),
      data: remapIds(block?.data ?? {}, ids) as Record<string, unknown>,
      ...(block?.tunes !== undefined && { tunes: block.tunes }),
      children: (block?.content ?? []).map(toSpec),
    };
  };
  const planned = buildPlannedBlock(state, toSpec(source.id), { id: placement.parentId }, '', false);

  state.emit({ op: 'insert', block: planned, parentId: placement.parentId, afterId: placement.afterId });

  return { id: planned.id, childIds: planned.children.map(child => child.id) };
};
```

In `src/shared/agent/planner.ts`, change the `HANDLERS` line to:

```ts
import { planDelete, planDuplicate, planInsert, planUpdate } from './plan-block';

export const HANDLERS: Record<string, CommandHandler> = {
  'block.insert': planInsert,
  'block.update': planUpdate,
  'block.delete': planDelete,
  'block.duplicate': planDuplicate,
};
```

**Unverified:** that the editor's own duplicate rewrites table-cell id lists the same way `remapIds` does. The duplicate parity case in Task 32 pins it; if it differs, the editor behaviour wins and `remapIds` changes.

- [ ] **Step 4: Run it to make sure it passes**

Run: `yarn test test/unit/shared/agent/plan-update-delete.test.ts test/unit/shared/agent/plan-insert.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/shared/agent/plan-block.ts src/shared/agent/planner.ts test/unit/shared/agent/plan-update-delete.test.ts
git add src/shared/agent/plan-block.ts src/shared/agent/planner.ts test/unit/shared/agent/plan-update-delete.test.ts
git commit -m "feat(agent): block.update, block.delete and block.duplicate planning

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `block.move` and `block.convert`

**Files:**
- Modify: `src/shared/agent/plan-block.ts`, `src/shared/agent/planner.ts`
- Test: `test/unit/shared/agent/plan-move-convert.test.ts`

**Interfaces:**
- Consumes: `checkMove` (Task 5), `PlanState` (Task 8), `requireTool` (Task 9).
- Produces: `planMove` → `{ id }`; `planConvert` → `{ id }`. `block.move` passes `{ allowColumnMoves: true }` to `checkMove` (01 §3.5 "Columns"); the emptied-column cleanup lands in Task 30. `block.convert` raises `CONVERSION_UNSUPPORTED` with `details.missing: string[]` (the types whose side has no string `conversion` field).

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/shared/agent/plan-move-convert.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentFailure } from '../../../../src/shared/agent/errors';
import type { OutputData } from '../../../../types';
import { planOn } from './fixtures';

const doc: OutputData = { blocks: [
  { id: 'a', type: 'paragraph', data: { text: [{ text: 'A', marks: { bold: true } }] } },
  { id: 'tg', type: 'toggle', data: { text: [] }, content: ['k'] },
  { id: 'k', type: 'paragraph', data: { text: [] }, parent: 'tg' },
  { id: 'cl', type: 'column_list', data: {}, content: ['c1'] },
  { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['x'] },
  { id: 'x', type: 'paragraph', data: {}, parent: 'c1' },
  { id: 'dv', type: 'divider', data: {} },
  { id: 'kb', type: 'kanban', data: {} },
] };

const err = (fn: () => unknown): AgentFailure['error'] => {
  try {
    fn();
  } catch (error) {
    if (error instanceof AgentFailure) {
      return error.error;
    }
    throw error;
  }
  throw new Error('expected a failure');
};

describe('block.move', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('moves into a container at the end, and an opaque block too', () => {
    const { draft, plan } = planOn(doc, [
      { name: 'block.move', args: { id: 'a', parentId: 'tg', position: 'end' } },
      { name: 'block.move', args: { id: 'kb', position: 'start' } },
    ]);

    expect(draft.childrenOf('tg')).toEqual(['k', 'a']);
    expect(draft.childrenOf(null)[0]).toBe('kb');
    expect(plan.changed.moved).toEqual(['a', 'kb']);
  });

  it('moves an existing block into an existing column', () => {
    expect(planOn(doc, [{ name: 'block.move', args: { id: 'a', parentId: 'c1', position: 'start' } }]).draft.childrenOf('c1')).toEqual(['a', 'x']);
  });

  it('keeps its place when told to go to the end of its own parent', () => {
    expect(planOn(doc, [{ name: 'block.move', args: { id: 'k', parentId: 'tg', position: 'end' } }]).draft.childrenOf('tg')).toEqual(['k']);
  });

  it('refuses its own subtree and a block that takes no children', () => {
    expect(err(() => planOn(doc, [{ name: 'block.move', args: { id: 'tg', parentId: 'k', position: 'end' } }]))).toMatchObject({ details: { reason: 'OWN_SUBTREE' } });
    expect(err(() => planOn(doc, [{ name: 'block.move', args: { id: 'a', parentId: 'dv', position: 'end' } }]))).toMatchObject({ details: { reason: 'TAKES_NO_CHILDREN' } });
  });

  it('refuses a position relative to itself', () => {
    expect(err(() => planOn(doc, [{ name: 'block.move', args: { id: 'a', position: { after: 'a' } } }]))).toMatchObject({ code: 'INVALID_ARGS' });
  });
});

describe('block.convert', () => {
  it('carries the text field across and keeps id and children', () => {
    const { plan, draft } = planOn(doc, [{ name: 'block.convert', args: { id: 'tg', type: 'header', data: { level: 3 } } }]);

    expect(plan.edits[0]).toMatchObject({ op: 'replaceType', id: 'tg', type: 'header', data: { text: [], level: 3 } });
    expect(draft.childrenOf('tg')).toEqual(['k']);
  });

  it('refuses a side with no conversion field and a target that takes no children', () => {
    expect(err(() => planOn(doc, [{ name: 'block.convert', args: { id: 'a', type: 'divider' } }]))).toMatchObject({
      code: 'CONVERSION_UNSUPPORTED', details: { missing: ['divider'] },
    });
  });
});
```

The second convert case only checks the conversion side: divider has no `conversion.import` in the fixture, so `CONVERSION_UNSUPPORTED` comes first.

- [ ] **Step 2: Run it to make sure it fails**

Run: `yarn test test/unit/shared/agent/plan-move-convert.test.ts`
Expected: FAIL with "has no planner".

- [ ] **Step 3: Write the handlers**

Append to `src/shared/agent/plan-block.ts`:

```ts
import { checkMove } from './placement-rules';

export const planMove = (state: PlanState, args: Record<string, unknown>): unknown => {
  const block = state.requireBlock(args.id, '/id');
  const position = args.position as Record<string, unknown> | string;
  const refKey = typeof position === 'object' ? ('before' in position ? 'before' : 'after') : undefined;
  const refId = refKey === undefined ? undefined : state.resolveId((position as Record<string, unknown>)[refKey], `/position/${refKey}`);

  if (refId === block.id) {
    state.fail('INVALID_ARGS', `Cannot place "${block.id}" relative to itself.`, '/position');
  }

  const placement = state.place(args.parentId, position);
  const parentType = placement.parentId === null ? undefined : state.draft.get(placement.parentId)?.type;

  if (parentType !== undefined && placement.parentId !== block.parent && state.tool(parentType)?.entry.selfPlacesChildren === true) {
    state.fail('PLACEMENT_REFUSED', `"${parentType}" places its own children. Use one of: ${state.actionsOf(parentType).join(', ')}.`, '/parentId', {
      reason: 'SELF_PLACED_PARENT', use: state.actionsOf(parentType),
    });
  }

  const refusal = checkMove(state.tree(), block.id, placement.parentId, refId, { allowColumnMoves: true });

  if (refusal !== null) {
    state.fail('PLACEMENT_REFUSED', `${refusal.message}.`, '/parentId', { reason: refusal.reason, ...(refusal.allowed !== undefined && { allowed: refusal.allowed }) });
  }

  const siblings = state.draft.childrenOf(placement.parentId);
  const afterId = placement.afterId === block.id
    ? (siblings.indexOf(block.id) > 0 ? siblings[siblings.indexOf(block.id) - 1] : null)
    : placement.afterId;

  state.emit({ op: 'move', id: block.id, parentId: placement.parentId, afterId });

  return { id: block.id };
};

export const planConvert = (state: PlanState, args: Record<string, unknown>): unknown => {
  const block = state.requireBlock(args.id, '/id');
  const source = requireTool(state, block.id, block.type);
  const targetType = args.type as string;
  const target = state.tool(targetType) ?? state.fail('UNKNOWN_TOOL', `No block tool "${targetType}" is registered.`, '/type');
  const from = source.entry.conversion.export;
  const to = target.entry.conversion.import;

  if (from === undefined || to === undefined) {
    const missing = [from === undefined ? block.type : null, to === undefined ? targetType : null].filter((type): type is string => type !== null);

    state.fail('CONVERSION_UNSUPPORTED', `Conversion from "${block.type}" to "${targetType}" is not possible: ${missing.join(' and ')} cannot convert here.`, '/type', { missing });
  }
  if (block.content.length > 0 && !target.entry.children.accepts) {
    state.fail('PLACEMENT_REFUSED', `"${targetType}" takes no children, and "${block.id}" has some. Move them out first.`, '/type', { reason: 'TAKES_NO_CHILDREN' });
  }

  const text = block.data[from];
  const carried = target.entry.richTextFields.includes(to) || !Array.isArray(text) ? text : state.ctx.richText.plainText(text as never);
  const data = state.prepareData(targetType, {
    ...(target.entry.defaultData ?? {}),
    [to]: carried ?? [],
    ...((args.data ?? {}) as Record<string, unknown>),
  }, '/data', block.id);

  state.emit({ op: 'replaceType', id: block.id, type: targetType, data });

  return { id: block.id };
};
```

Register in `HANDLERS` (`src/shared/agent/planner.ts`): `'block.move': planMove, 'block.convert': planConvert`.

- [ ] **Step 4: Run it to make sure it passes**

Run: `yarn test test/unit/shared/agent/plan-move-convert.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/shared/agent/plan-block.ts src/shared/agent/planner.ts test/unit/shared/agent/plan-move-convert.test.ts
git add src/shared/agent/plan-block.ts src/shared/agent/planner.ts test/unit/shared/agent/plan-move-convert.test.ts
git commit -m "feat(agent): block.move and block.convert planning

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: `text.insert`, `text.delete`, `text.replace`, `text.format`

**Files:**
- Create: `src/shared/agent/plan-text.ts`
- Modify: `src/shared/agent/planner.ts` (register)
- Test: `test/unit/shared/agent/plan-text.test.ts`

**Interfaces:**
- Consumes: `richTextHelpers` (Task 6), `PlanState` (Task 8).
- Produces: `planTextInsert` → `{ length }`, `planTextDelete` → `{ removed: string }`, `planTextReplace` → `{ length }`, `planTextFormat` → `{}`. Each sets `state.lastRange`. `field` defaults to the tool's first rich field; a field outside `richTextFields` → `FIELD_NOT_RICH_TEXT` with `details.fields`. An `expectText` mismatch → `STALE` with `details.current: [{ id, type, text }]` and `details.text` (the field's plain text).

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/shared/agent/plan-text.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentFailure } from '../../../../src/shared/agent/errors';
import type { OutputData } from '../../../../types';
import { planOn } from './fixtures';

const doc: OutputData = { blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'Hello world' }] } }, { id: 'dv', type: 'divider', data: {} }] };

const err = (fn: () => unknown): AgentFailure['error'] => {
  try {
    fn();
  } catch (error) {
    if (error instanceof AgentFailure) {
      return error.error;
    }
    throw error;
  }
  throw new Error('expected a failure');
};

describe('text commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bolds characters 6–11 and reports the range', () => {
    const { draft, plan } = planOn(doc, [{ name: 'text.format', args: { id: 'p', range: { start: 6, end: 11 }, set: { bold: true } } }]);

    expect(draft.get('p')?.data.text).toEqual([{ text: 'Hello ' }, { text: 'world', marks: { bold: true } }]);
    expect(plan.lastRange).toEqual({ blockId: 'p', field: 'text', start: 6, end: 11 });
  });

  it('inserts after found text with marks', () => {
    const { draft, plan } = planOn(doc, [{ name: 'text.insert', args: { id: 'p', at: { after: 'Hello' }, text: ',', marks: { italic: true } } }]);

    expect(draft.get('p')?.data.text).toEqual([{ text: 'Hello' }, { text: ',', marks: { italic: true } }, { text: ' world' }]);
    expect(plan.results[0]).toEqual({ length: 1 });
  });

  it('deletes and replaces', () => {
    expect(planOn(doc, [{ name: 'text.delete', args: { id: 'p', range: { find: ' world' } } }]).plan.results[0]).toEqual({ removed: ' world' });
    expect(planOn(doc, [{ name: 'text.replace', args: { id: 'p', with: [{ text: 'Hi', marks: { code: true } }] } }]).draft.get('p')?.data.text)
      .toEqual([{ text: 'Hi', marks: { code: true } }]);
  });

  it('refuses a block with no rich field', () => {
    expect(err(() => planOn(doc, [{ name: 'text.insert', args: { id: 'dv', at: 0, text: 'x' } }]))).toMatchObject({ code: 'FIELD_NOT_RICH_TEXT' });
  });

  it('returns STALE with the fresh text when expectText no longer matches', () => {
    expect(err(() => planOn(doc, [{ name: 'text.format', args: { id: 'p', range: { start: 0, end: 5, expectText: 'Howdy' }, set: { bold: true } } }])))
      .toMatchObject({ code: 'STALE', retryable: true, details: { text: 'Hello world', current: [{ id: 'p', type: 'paragraph', text: 'Hello world' }] } });
  });

  it('warns about Markdown-looking inserted text', () => {
    expect(planOn(doc, [{ name: 'text.insert', args: { id: 'p', at: 0, text: '# ' } }]).warnings.map(w => w.code)).toContain('LOOKS_LIKE_MARKDOWN');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `yarn test test/unit/shared/agent/plan-text.test.ts`
Expected: FAIL with "has no planner".

- [ ] **Step 3: Write the handlers**

```ts
// src/shared/agent/plan-text.ts
import type { TextRange } from '../../../types/agent';
import type { RichText, RichTextMarks } from '../../../types/rich-text';
import { AgentFailure, failure } from './errors';
import { looksLikeMarkdown } from './markdown-lookalike';
import type { PlanState } from './plan-state';

interface Target { id: string; type: string; field: string; value: RichText }

const target = (state: PlanState, args: Record<string, unknown>): Target => {
  const block = state.requireBlock(args.id, '/id');
  const fields = state.tool(block.type)?.entry.richTextFields
    ?? state.fail('UNKNOWN_TOOL', `Block "${block.id}" is a "${block.type}", which is not registered here.`, '/id', { opaque: true });
  const field = (args.field as string | undefined) ?? fields[0];

  if (field === undefined || !fields.includes(field)) {
    state.fail('FIELD_NOT_RICH_TEXT', `"${String(field)}" is not a rich-text field of "${block.type}". Rich fields: ${fields.join(', ') || 'none'}.`, '/field', { fields });
  }

  return { id: block.id, type: block.type, field, value: (block.data[field] ?? []) as RichText };
};

const resolve = (state: PlanState, t: Target, range: TextRange): { start: number; end: number } => {
  try {
    return state.ctx.richText.resolve(t.value, range);
  } catch (error) {
    if (!(error instanceof AgentFailure)) {
      throw error;
    }

    const text = state.ctx.richText.plainText(t.value);

    throw failure(error.error.code, error.error.message, {
      commandIndex: state.index,
      path: `/commands/${state.index}/args/range`,
      details: { ...error.error.details, text, ...(error.error.code === 'STALE' && { current: [{ id: t.id, type: t.type, text }] }) },
    });
  }
};

const input = (state: PlanState, t: Target, value: unknown, marks?: RichTextMarks): RichText => {
  const rich = typeof value === 'string' ? (value === '' ? [] : [{ text: value, ...(marks !== undefined && { marks }) }]) : value as RichText;

  if (looksLikeMarkdown(state.ctx.richText.plainText(rich))) {
    state.warn('LOOKS_LIKE_MARKDOWN', 'The text looks like Markdown. It was saved as literal text. Use marks, or markdown.insert.', { blockId: t.id, field: t.field });
  }

  return rich;
};

const write = (state: PlanState, t: Target, value: RichText, start: number, end: number): void => {
  const clean = state.prepareData(t.type, { [t.field]: value }, '', t.id)[t.field] as RichText;

  state.emit({ op: 'setRichText', id: t.id, field: t.field, value: clean });
  state.lastRange = { blockId: t.id, field: t.field, start, end };
};

export const planTextInsert = (state: PlanState, args: Record<string, unknown>): unknown => {
  const t = target(state, args);
  const at = typeof args.at === 'number' ? resolve(state, t, { start: args.at, end: args.at }).start : resolve(state, t, { find: (args.at as { after: string }).after }).end;
  const inserted = input(state, t, args.text, args.marks as RichTextMarks | undefined);
  const length = state.ctx.richText.length(inserted);

  write(state, t, state.ctx.richText.insert(t.value, at, inserted), at, at + length);

  return { length };
};

export const planTextDelete = (state: PlanState, args: Record<string, unknown>): unknown => {
  const t = target(state, args);
  const { start, end } = resolve(state, t, args.range as TextRange);
  const removed = state.ctx.richText.plainText(state.ctx.richText.slice(t.value, start, end));

  write(state, t, state.ctx.richText.remove(t.value, start, end), start, start);

  return { removed };
};

export const planTextReplace = (state: PlanState, args: Record<string, unknown>): unknown => {
  const t = target(state, args);
  const { start, end } = resolve(state, t, (args.range ?? 'all') as TextRange);
  const inserted = input(state, t, args.with);
  const length = state.ctx.richText.length(inserted);
  const removed = state.ctx.richText.remove(t.value, start, end);

  write(state, t, state.ctx.richText.insert(removed, start, inserted), start, start + length);

  return { length };
};

export const planTextFormat = (state: PlanState, args: Record<string, unknown>): unknown => {
  const t = target(state, args);
  const { start, end } = resolve(state, t, args.range as TextRange);

  write(state, t, state.ctx.richText.format(t.value, start, end, args.set as RichTextMarks | undefined, args.unset as string[] | undefined), start, end);

  return {};
};
```

Register in `HANDLERS`: `'text.insert': planTextInsert, 'text.delete': planTextDelete, 'text.replace': planTextReplace, 'text.format': planTextFormat`.

`write` runs `prepareData` on the whole field, so `text.format` with an unknown mark in `set` gets the `UNKNOWN_MARK_DROPPED` warning and the sanitizer's `SANITIZED` warning like every other write.

- [ ] **Step 4: Run it to make sure it passes**

Run: `yarn test test/unit/shared/agent/plan-text.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/shared/agent/plan-text.ts src/shared/agent/planner.ts test/unit/shared/agent/plan-text.test.ts
git add src/shared/agent/plan-text.ts src/shared/agent/planner.ts test/unit/shared/agent/plan-text.test.ts
git commit -m "feat(agent): text.insert/delete/replace/format over rich-text segments

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 12: The document view: `doc.read` and `doc.find`

**Files:**
- Create: `src/shared/agent/view.ts`, `src/shared/agent/plan-doc.ts`
- Modify: `src/shared/agent/planner.ts` (register; stamp `commandIndex` on failures raised by pure helpers)
- Test: `test/unit/shared/agent/view.test.ts`

**Interfaces:**
- Consumes: `DocSnapshot` (Task 4), `PlannerTool`, `RichTextHelpers`.
- Produces:
  - `buildDocumentView(snap: DocSnapshot, args: ViewArgs, ctx: Pick<PlannerContext, 'tools' | 'richText'>, revision: string): DocumentView`.
  - `findBlocks(snap, args: { text?: string; type?: string; rootId?: string; limit?: number }, ctx): { matches: Array<{ id: string; type: string; snippet: string }> }`.
  - Handlers `planRead`, `planFind` (results carry `revision: ''`; the executor fills it, Task 16).
  - Cursor format: `"c:<blockId>"`, the first block of the next page. A cursor whose block is gone → `INVALID_ARGS` "re-read from the start" (Review Focus 5).
  - `depth` counts levels below the root: `depth: 0` lists only the root's direct children.
  - `planBatch` now rethrows an `AgentFailure` that has no `commandIndex` with the current index and a `/commands/<i>` path.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/shared/agent/view.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentFailure } from '../../../../src/shared/agent/errors';
import type { DocumentView, OutputData } from '../../../../types';
import { planOn } from './fixtures';

const long = 'x'.repeat(130);
const doc: OutputData = {
  title: 'Launch plan',
  blocks: [
    { id: 'h1', type: 'header', data: { text: [{ text: 'Plan' }], level: 2 } },
    { id: 't1', type: 'toggle', data: { text: [{ text: 'Details' }] }, content: ['p9'] },
    { id: 'p9', type: 'paragraph', data: { text: [{ text: long, marks: { bold: true } }] }, parent: 't1' },
    { id: 'x4', type: 'kanban', data: {} },
    { id: 'tbl', type: 'table', data: { content: [[{ blocks: ['c'] }]] }, content: ['c'] },
    { id: 'c', type: 'paragraph', data: { text: [{ text: 'cell' }] }, parent: 'tbl' },
  ],
};

const read = (args: Record<string, unknown>, source = doc): DocumentView =>
  planOn(source, [{ name: 'doc.read', args }]).plan.results[0] as DocumentView;

describe('doc.read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gives the outline with attrs, truncation, opaque blocks, cells and the page', () => {
    const view = read({});

    expect(view.page).toEqual({ title: 'Launch plan' });
    expect(view.blocks).toEqual([
      { id: 'h1', type: 'header', depth: 0, text: 'Plan', attrs: { level: 2 } },
      { id: 't1', type: 'toggle', depth: 0, text: 'Details' },
      { id: 'p9', type: 'paragraph', depth: 1, parentId: 't1', text: `${'x'.repeat(120)}…`, truncated: true },
      { id: 'x4', type: 'kanban', depth: 0, opaque: true },
      { id: 'tbl', type: 'table', depth: 0 },
      { id: 'c', type: 'paragraph', depth: 1, parentId: 'tbl', text: 'cell', cell: { row: 0, col: 0 } },
    ]);
  });

  it('counts children it does not list', () => {
    expect(read({ depth: 0 }).blocks.find(b => b.id === 't1')).toMatchObject({ childCount: 1 });
  });

  it('gives chosen blocks in full, segments included', () => {
    expect(read({ ids: ['p9'] }).blocks[0]).toMatchObject({ id: 'p9', data: { text: [{ text: long, marks: { bold: true } }] } });
  });

  it('pages with a cursor', () => {
    const first = read({ limit: 2 });

    expect(first.blocks.map(b => b.id)).toEqual(['h1', 't1']);
    expect(first.next).toBe('c:p9');
    expect(read({ limit: 2, cursor: first.next }).blocks.map(b => b.id)).toEqual(['p9', 'x4']);
  });

  it('refuses a cursor whose block is gone (Review Focus 5)', () => {
    const without = { blocks: doc.blocks.filter(b => b.id !== 'p9' && b.id !== 't1') };

    try {
      read({ limit: 2, cursor: 'c:p9' }, without);
      throw new Error('expected a failure');
    } catch (error) {
      expect(error).toBeInstanceOf(AgentFailure);
      expect((error as AgentFailure).error).toMatchObject({ code: 'INVALID_ARGS', commandIndex: 0 });
    }
  });

  it('sees the batch’s own earlier writes', () => {
    const { plan } = planOn(doc, [
      { name: 'block.insert', args: { type: 'paragraph', data: { text: 'new' }, position: 'start' } },
      { name: 'doc.read', args: { limit: 1 } },
    ]);

    expect((plan.results[1] as DocumentView).blocks[0].text).toBe('new');
  });
});

describe('doc.find', () => {
  it('finds by text, case-insensitive, with a snippet', () => {
    expect(planOn(doc, [{ name: 'doc.find', args: { text: 'DETAIL' } }]).plan.results[0]).toEqual({
      matches: [{ id: 't1', type: 'toggle', snippet: 'Details' }],
    });
  });

  it('finds by type inside a subtree', () => {
    expect(planOn(doc, [{ name: 'doc.find', args: { type: 'paragraph', rootId: 't1' } }]).plan.results[0]).toMatchObject({ matches: [{ id: 'p9' }] });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `yarn test test/unit/shared/agent/view.test.ts`
Expected: FAIL with "has no planner".

- [ ] **Step 3: Write the view and the handlers**

```ts
// src/shared/agent/view.ts
import type { DocumentView, RichTextHelpers, ViewArgs, ViewBlock } from '../../../types/agent';
import type { RichText } from '../../../types/rich-text';
import { failure } from './errors';
import type { DocSnapshot, SnapBlock } from './snapshot';
import type { PlannerTool } from './types';

type ViewCtx = { tools: ReadonlyMap<string, PlannerTool>; richText: RichTextHelpers };

const textOf = (block: SnapBlock, ctx: ViewCtx, field?: string): string | undefined => {
  const name = field ?? ctx.tools.get(block.type)?.entry.richTextFields[0];
  const value = name === undefined ? undefined : block.data[name];

  return Array.isArray(value) ? ctx.richText.plainText(value as RichText) : undefined;
};

const depthOf = (snap: DocSnapshot, id: string): number => {
  let depth = 0;

  for (let cursor = snap.parentOf(id); cursor !== null; cursor = snap.parentOf(cursor)) {
    depth++;
  }

  return depth;
};

const entry = (snap: DocSnapshot, block: SnapBlock, depth: number, ctx: ViewCtx, full: boolean, textLimit: number, listedChildren: boolean): ViewBlock => {
  const tool = ctx.tools.get(block.type);
  const text = tool === undefined ? undefined : textOf(block, ctx);
  const cell = snap.cellOf(block.id);
  const attrs = Object.fromEntries((tool?.entry.summaryFields ?? []).filter(key => block.data[key] !== undefined).map(key => [key, block.data[key]]));

  return {
    id: block.id,
    type: block.type,
    depth,
    ...(block.parent !== null && { parentId: block.parent }),
    ...(text !== undefined && text !== '' && { text: text.length > textLimit ? `${text.slice(0, textLimit)}…` : text }),
    ...(text !== undefined && text.length > textLimit && { truncated: true as const }),
    ...(Object.keys(attrs).length > 0 && { attrs }),
    ...(!listedChildren && block.content.length > 0 && { childCount: block.content.length }),
    ...(tool === undefined && { opaque: true as const }),
    ...(cell !== null && cell.tableId === block.parent && { cell: { row: cell.row, col: cell.col } }),
    ...(full && { data: block.data, ...(block.tunes !== undefined && { tunes: block.tunes }) }),
  };
};

export const buildDocumentView = (snap: DocSnapshot, args: ViewArgs, ctx: ViewCtx, revision: string): DocumentView => {
  const rootId = args.rootId ?? null;
  const textLimit = args.textLimit ?? 120;
  const limit = args.limit ?? 200;

  if (rootId !== null && !snap.has(rootId)) {
    throw failure('BLOCK_NOT_FOUND', `Block "${rootId}" does not exist.`, { details: { id: rootId } });
  }

  const order = args.ids !== undefined
    ? args.ids.map((id) => {
      if (!snap.has(id)) {
        throw failure('BLOCK_NOT_FOUND', `Block "${id}" does not exist.`, { details: { id } });
      }

      return { id, depth: depthOf(snap, id) };
    })
    : snap.readingOrder(rootId).filter(item => args.depth === undefined || item.depth <= args.depth);
  const start = args.cursor === undefined ? 0 : order.findIndex(item => `c:${item.id}` === args.cursor);

  if (start < 0) {
    throw failure('INVALID_ARGS', 'The cursor is no longer valid: the document changed. Re-read from the start.', { path: '/cursor' });
  }

  const page = order.slice(start, start + limit);
  const full = args.ids !== undefined || args.detail === 'full';

  return {
    revision,
    rootId,
    ...((snap.title !== undefined || snap.icon !== undefined) && {
      page: { ...(snap.title !== undefined && { title: snap.title }), ...(snap.icon !== undefined && { icon: snap.icon }) },
    }),
    blocks: page.map(({ id, depth }) => entry(snap, snap.get(id) as SnapBlock, depth, ctx, full, textLimit,
      args.ids !== undefined || args.depth === undefined || depth < args.depth)),
    ...(order[start + limit] !== undefined && { next: `c:${order[start + limit].id}` }),
  };
};

export const findBlocks = (
  snap: DocSnapshot,
  args: { text?: string; type?: string; rootId?: string; limit?: number },
  ctx: ViewCtx
): { matches: Array<{ id: string; type: string; snippet: string }> } => {
  if (args.text === undefined && args.type === undefined) {
    throw failure('INVALID_ARGS', 'Give text, type, or both.');
  }
  if (args.rootId !== undefined && !snap.has(args.rootId)) {
    throw failure('BLOCK_NOT_FOUND', `Block "${args.rootId}" does not exist.`, { details: { id: args.rootId } });
  }

  const needle = args.text?.toLowerCase();
  const matches: Array<{ id: string; type: string; snippet: string }> = [];

  for (const { id } of snap.readingOrder(args.rootId ?? null)) {
    const block = snap.get(id) as SnapBlock;
    const text = (ctx.tools.get(block.type)?.entry.richTextFields ?? []).map(field => textOf(block, ctx, field) ?? '').join(' ');
    const at = needle === undefined ? 0 : text.toLowerCase().indexOf(needle);

    if ((args.type === undefined || block.type === args.type) && at >= 0) {
      matches.push({ id, type: block.type, snippet: text.slice(Math.max(0, at - 20), at + (needle?.length ?? 0) + 20) });
    }
    if (matches.length >= (args.limit ?? 20)) {
      break;
    }
  }

  return { matches };
};
```

```ts
// src/shared/agent/plan-doc.ts
import type { ViewArgs } from '../../../types/agent';
import type { PlanState } from './plan-state';
import { buildDocumentView, findBlocks } from './view';

export const planRead = (state: PlanState, args: Record<string, unknown>): unknown => {
  const view = args.rootId === undefined || args.rootId === null ? args : { ...args, rootId: state.resolveId(args.rootId, '/rootId') };

  return buildDocumentView(state.draft, view as ViewArgs, state.ctx, '');
};

export const planFind = (state: PlanState, args: Record<string, unknown>): unknown =>
  findBlocks(state.draft, { ...args, ...(args.rootId !== undefined && { rootId: state.resolveId(args.rootId, '/rootId') }) }, state.ctx);
```

In `src/shared/agent/planner.ts`, register `'doc.read': planRead, 'doc.find': planFind`, and wrap the handler call:

```ts
import { AgentFailure } from './errors';

    const result = (() => {
      try {
        return handler(state, command.args);
      } catch (error) {
        if (error instanceof AgentFailure && error.error.commandIndex === undefined) {
          throw failure(error.error.code, error.error.message, {
            commandIndex: index,
            path: `/commands/${index}/args${error.error.path ?? ''}`,
            ...(error.error.details !== undefined && { details: error.error.details }),
          });
        }
        throw error;
      }
    })();
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `yarn test test/unit/shared/agent/view.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/shared/agent/view.ts src/shared/agent/plan-doc.ts src/shared/agent/planner.ts test/unit/shared/agent/view.test.ts
git add src/shared/agent/view.ts src/shared/agent/plan-doc.ts src/shared/agent/planner.ts test/unit/shared/agent/view.test.ts
git commit -m "feat(agent): document view, paging and doc.find

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: `doc.setTitle`, `doc.setIcon`, `markdown.insert`, `markdown.export`

**Files:**
- Modify: `src/shared/agent/plan-doc.ts`, `src/shared/agent/planner.ts`
- Test: `test/unit/shared/agent/plan-doc.test.ts`

**Interfaces:**
- Consumes: `buildPlannedBlock`, `PREPARE_PENDING` (Task 8), `AgentPorts.blocksToMarkdown` (Task 3).
- Produces: `planSetTitle`, `planSetIcon` → `{}`; `planMarkdownInsert` → `{ ids: string[] }` (reads `ctx.prepared.get(index)` as `{ blocks: OutputBlockData[]; warnings: AgentWarning[] }`; with `PREPARE_PENDING` it checks placement only); `planMarkdownExport` → `{ markdown: string }`. Markdown warnings arrive from the ports already coded `MARKDOWN_DEGRADED`; the planner stamps `commandIndex`.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/shared/agent/plan-doc.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PREPARE_PENDING } from '../../../../src/shared/agent/plan-state';
import type { OutputData } from '../../../../types';
import { planOn, stubPorts } from './fixtures';

const doc: OutputData = { title: 'Old', blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } }] };

describe('page fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets and clears the title and icon', () => {
    const set = planOn(doc, [
      { name: 'doc.setTitle', args: { title: 'New' } },
      { name: 'doc.setIcon', args: { icon: { type: 'emoji', value: '🚀' } } },
    ]);

    expect(set.draft.toOutput()).toMatchObject({ title: 'New', icon: { type: 'emoji', value: '🚀' } });
    expect(planOn(doc, [{ name: 'doc.setTitle', args: { title: '' } }]).draft.toOutput()).not.toHaveProperty('title');
  });

  it('refuses an icon that is not a PageIcon', () => {
    expect(() => planOn(doc, [{ name: 'doc.setIcon', args: { icon: { type: 'emoji' } } }])).toThrow(/PageIcon/);
  });
});

describe('markdown', () => {
  it('inserts the converted blocks with fresh ids and keeps the degradation warnings', () => {
    const prepared = new Map<number, unknown>([[0, {
      blocks: [
        { id: 'm1', type: 'toggle', data: { text: 'T' }, content: ['m2'] },
        { id: 'm2', type: 'paragraph', data: { text: 'child' }, parent: 'm1' },
        { id: 'm3', type: 'paragraph', data: { text: 'after' } },
      ],
      warnings: [{ code: 'MARKDOWN_DEGRADED', message: 'html dropped' }],
    }]]);
    const { plan, draft, warnings } = planOn(doc, [{ name: 'markdown.insert', args: { markdown: 'ignored here', position: { after: 'p' } } }], { prepared });

    expect(plan.results[0]).toEqual({ ids: ['n1', 'n3'] });
    expect(draft.childrenOf(null)).toEqual(['p', 'n1', 'n3']);
    expect(draft.childrenOf('n1')).toEqual(['n2']);
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'MARKDOWN_DEGRADED', commandIndex: 0 }));
  });

  it('checks the place even before conversion ran', () => {
    expect(() => planOn(doc, [{ name: 'markdown.insert', args: { markdown: 'x', parentId: 'gone' } }], { prepared: new Map([[0, PREPARE_PENDING]]) }))
      .toThrow(/does not exist/);
  });

  it('exports through the port', () => {
    const ports = stubPorts({ blocksToMarkdown: d => ({ markdown: `${d.blocks.length} block(s)`, warnings: [] }) });

    expect(planOn(doc, [{ name: 'markdown.export', args: {} }], { ports }).plan.results[0]).toEqual({ markdown: '1 block(s)' });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `yarn test test/unit/shared/agent/plan-doc.test.ts`
Expected: FAIL with "has no planner".

- [ ] **Step 3: Write the handlers**

Append to `src/shared/agent/plan-doc.ts`:

```ts
import type { AgentWarning, InsertSpec } from '../../../types/agent';
import type { OutputBlockData } from '../../../types/data-formats/output-data';
import { buildPlannedBlock } from './plan-block';
import { PREPARE_PENDING } from './plan-state';

const isPageIcon = (value: unknown): boolean => {
  const icon = value as { type?: unknown; value?: unknown; url?: unknown } | null;

  return icon === null
    || (icon?.type === 'emoji' && typeof icon.value === 'string' && icon.value !== '')
    || (icon?.type === 'image' && typeof icon.url === 'string' && icon.url !== '');
};

export const planSetTitle = (state: PlanState, args: Record<string, unknown>): unknown => {
  state.emit({ op: 'setPageField', key: 'title', value: args.title as string });

  return {};
};

export const planSetIcon = (state: PlanState, args: Record<string, unknown>): unknown => {
  if (!isPageIcon(args.icon)) {
    state.fail('INVALID_ARGS', 'icon must be a PageIcon: { type: "emoji", value } or { type: "image", url }, or null to clear it.', '/icon');
  }
  state.emit({ op: 'setPageField', key: 'icon', value: args.icon as never });

  return {};
};

/** Flat converted blocks → a forest of InsertSpecs; converter ids are dropped. */
const toForest = (blocks: OutputBlockData[]): InsertSpec[] => {
  const ids = new Set(blocks.map(block => block.id));
  const childrenOf = (id: string | undefined): InsertSpec[] => blocks
    .filter(block => (id === undefined ? block.parent === undefined || !ids.has(block.parent) : block.parent === id))
    .map(block => ({ type: block.type, data: block.data as Record<string, unknown>, ...(block.tunes !== undefined && { tunes: block.tunes }), children: childrenOf(block.id) }));

  return childrenOf(undefined);
};

export const planMarkdownInsert = (state: PlanState, args: Record<string, unknown>): unknown => {
  const placement = state.place(args.parentId, args.position ?? 'end');
  const prepared = state.ctx.prepared.get(state.index);

  if (prepared === PREPARE_PENDING || prepared === undefined) {
    return { ids: [] };
  }

  const { blocks, warnings } = prepared as { blocks: OutputBlockData[]; warnings: AgentWarning[] };

  warnings.forEach(item => state.warnings.push({ ...item, commandIndex: state.index }));

  let afterId = placement.afterId;
  const ids = toForest(blocks).map((spec, i) => {
    const planned = buildPlannedBlock(state, spec, { id: placement.parentId }, `/markdown/${i}`, false);

    state.emit({ op: 'insert', block: planned, parentId: placement.parentId, afterId });
    afterId = planned.id;

    return planned.id;
  });

  return { ids };
};

export const planMarkdownExport = (state: PlanState, args: Record<string, unknown>): unknown => {
  const doc = state.draft.toOutput();
  const keep = args.rootId === undefined ? null : new Set(state.draft.subtree(state.resolveId(args.rootId, '/rootId')));
  const scoped = keep === null ? doc : {
    ...doc,
    blocks: doc.blocks.filter(block => keep.has(block.id ?? '')).map(block => (block.id === args.rootId ? { ...block, parent: undefined } : block)),
  };
  const { markdown, warnings } = state.ctx.ports.blocksToMarkdown(scoped);

  warnings.forEach(item => state.warnings.push({ ...item, commandIndex: state.index }));

  return { markdown };
};
```

Register in `HANDLERS`: `'doc.setTitle': planSetTitle, 'doc.setIcon': planSetIcon, 'markdown.insert': planMarkdownInsert, 'markdown.export': planMarkdownExport`.

- [ ] **Step 4: Run it to make sure it passes**

Run: `yarn test test/unit/shared/agent/plan-doc.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/shared/agent/plan-doc.ts src/shared/agent/planner.ts test/unit/shared/agent/plan-doc.test.ts
git add src/shared/agent/plan-doc.ts src/shared/agent/planner.ts test/unit/shared/agent/plan-doc.test.ts
git commit -m "feat(agent): doc.setTitle/setIcon and Markdown insert/export planning

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Tool actions: dispatch and the recording `ToolActionContext`

**Files:**
- Create: `src/shared/agent/tool-action-context.ts`
- Modify: `src/shared/agent/plan-block.ts` (extract `emitPatch` and `emitMove`; add `allowSelfPlaced` to `buildPlannedBlock`), `src/shared/agent/planner.ts` (fallback to tool actions)
- Test: `test/unit/shared/agent/tool-actions.test.ts`

**Interfaces:**
- Consumes: Tasks 8–10. 02's canonical `ToolActionContext` and `ToolActionImpl` shapes (06 §3.4) — implemented here structurally; 02's published type in `types/tools/tool-description.d.ts` must be assignable from `RecordingContext` (02's type test pins it once both exist).
- Produces:
  - `createActionContext(state: PlanState, block: SnapBlock | undefined, tool: string): RecordingContext` where `RecordingContext` has exactly the 06 §3.4 members: `tool`, `block?`, `read`, `insert`, `update`, `setRichText`, `move`, `remove`, `newId`, `richText`, `fail`. `tool` is the registry key the action runs under (`entry.source.tool`), so a `create` action inserts a block of the host's key, not the built-in name (02 open item; 06 §3.4).
  - `ctx.update(id, patch)`: a key whose value is `undefined` or `null` is removed. The recorded `setData` edit carries `null` for it, because `undefined` does not survive `JSON.stringify` on the Jint `edits` output (Task 37). This is the one removal rule for `block.update` and for handlers (02 open item).
  - `planToolAction(state: PlanState, name: string, args: Record<string, unknown>): unknown`.
  - `emitPatch(state, block: SnapBlock, patch: Record<string, unknown>, tunes?: Record<string, unknown>): void` (shared by `block.update` and `ctx.update`; no guard check).
  - `emitMove(state, blockId: string, parentArg: unknown, position: unknown, options: { allowSelfPlaced: boolean }): void`.
  - `buildPlannedBlock(..., options?: { allowSelfPlaced?: boolean })` (7th parameter).
  - Errors: wrong block type for a `target: 'block'` action → `INVALID_ARGS`; no handler in this runtime → `COMMAND_UNAVAILABLE` `reason: 'runtime'`; `ctx.fail` → `PRECONDITION_FAILED` / `INVALID_ARGS`; any other throw → `TOOL_ACTION_FAILED`. `args` are passed to `run` unchanged (flat, including `id` / `parentId` / `position`).

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/shared/agent/tool-actions.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentFailure } from '../../../../src/shared/agent/errors';
import { PREPARE_PENDING } from '../../../../src/shared/agent/plan-state';
import type { PlannerCommand } from '../../../../src/shared/agent/types';
import type { OutputData } from '../../../../types';
import { coreCommandMap, planOn, TOOLS, tool } from './fixtures';

const doc: OutputData = { blocks: [
  { id: 'tbl', type: 'table', data: { content: [[{ blocks: ['c'] }]] }, content: ['c'] },
  { id: 'c', type: 'paragraph', data: { text: [] }, parent: 'tbl' },
  { id: 'p', type: 'paragraph', data: { text: [] } },
] };

interface Ctx {
  block?: { id: string; data: Record<string, unknown> };
  read(id: string): { children: readonly string[] } | null;
  insert(input: Record<string, unknown>): string;
  update(id: string, patch: Record<string, unknown>): void;
  fail(code: 'PRECONDITION_FAILED' | 'INVALID_ARGS', message: string): never;
}

const addRow = vi.fn((ctx: Ctx) => {
  const id = ctx.insert({ type: 'paragraph', parentId: ctx.block?.id, position: 'end' });
  const seen = ctx.read(ctx.block?.id ?? '')?.children ?? [];

  ctx.update(ctx.block?.id ?? '', { content: [...(ctx.block?.data.content as unknown[]), [{ blocks: [id] }]] });

  return { rowIds: [id], seen };
});

const withTable = (impl: Record<string, unknown>) => {
  const tools = new Map(TOOLS);
  tools.set('table', tool('table', { ...TOOLS.get('table')?.entry }, { actions: impl as never }));
  const commands = coreCommandMap();
  const entry = (name: string, extra: Partial<PlannerCommand> = {}): PlannerCommand => ({ name, args: { type: 'object' }, readOnly: false, available: true, source: { tool: 'table', target: 'block' }, ...extra });
  commands.set('table.insertRows', entry('table.insertRows'));
  commands.set('table.guarded', entry('table.guarded'));
  commands.set('table.broken', entry('table.broken'));

  return { tools, commands };
};

const err = (fn: () => unknown): AgentFailure['error'] => {
  try {
    fn();
  } catch (error) {
    if (error instanceof AgentFailure) {
      return error.error;
    }
    throw error;
  }
  throw new Error('expected a failure');
};

describe('tool actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records inserts and guarded writes into a self-placed parent, and reads see earlier writes', () => {
    const { plan, draft } = planOn(doc, [{ name: 'table.insertRows', args: { id: 'tbl' } }], withTable({ insertRows: { run: addRow } }));

    expect(plan.results[0]).toEqual({ rowIds: ['n1'], seen: ['c', 'n1'] });
    expect(draft.cellOf('n1')).toEqual({ tableId: 'tbl', row: 1, col: 0 });
    expect(plan.edits.map(edit => edit.op)).toEqual(['insert', 'setData']);
  });

  it('refuses the wrong block type, a missing handler, ctx.fail and a throw', () => {
    const setup = withTable({
      insertRows: { run: addRow },
      guarded: { run: (ctx: Ctx) => ctx.fail('PRECONDITION_FAILED', 'Table has merged cells.') },
      broken: { run: () => { throw new Error('boom'); } },
    });

    expect(err(() => planOn(doc, [{ name: 'table.insertRows', args: { id: 'p' } }], setup))).toMatchObject({ code: 'INVALID_ARGS', commandIndex: 0 });
    expect(err(() => planOn(doc, [{ name: 'table.guarded', args: { id: 'tbl' } }], setup))).toMatchObject({ code: 'PRECONDITION_FAILED', message: 'Table has merged cells.' });
    expect(err(() => planOn(doc, [{ name: 'table.broken', args: { id: 'tbl' } }], setup))).toMatchObject({ code: 'TOOL_ACTION_FAILED' });
    expect(err(() => planOn(doc, [{ name: 'table.insertRows', args: { id: 'tbl' } }], withTable({})))).toMatchObject({ code: 'COMMAND_UNAVAILABLE', details: { reason: 'runtime' } });
  });

  it('does not run the action during the pre-plan', () => {
    planOn(doc, [{ name: 'table.insertRows', args: { id: 'tbl' } }], { ...withTable({ insertRows: { run: addRow } }), prepared: new Map([[0, PREPARE_PENDING]]) });

    expect(addRow).not.toHaveBeenCalled();
  });

  it('tells a create action its registry key and removes keys set to undefined', () => {
    const create = vi.fn((ctx: Ctx & { tool: string }) => ctx.insert({ type: ctx.tool, position: 'end' }));
    const clear = vi.fn((ctx: Ctx) => ctx.update(ctx.block?.id ?? '', { content: undefined }));
    const setup = withTable({ create: { run: create }, clear: { run: clear } });

    setup.commands.set('table.create', { name: 'table.create', args: { type: 'object' }, readOnly: false, available: true, source: { tool: 'table', target: 'create' } });
    setup.commands.set('table.clear', { name: 'table.clear', args: { type: 'object' }, readOnly: false, available: true, source: { tool: 'table', target: 'block' } });

    const created = planOn(doc, [{ name: 'table.create', args: {} }], setup);
    const cleared = planOn(doc, [{ name: 'table.clear', args: { id: 'tbl' } }], setup);

    expect(created.draft.get('n1')?.type).toBe('table');
    expect(cleared.plan.edits).toContainEqual({ op: 'setData', id: 'tbl', patch: { content: null } });
    expect(cleared.draft.get('tbl')?.data).not.toHaveProperty('content');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `yarn test test/unit/shared/agent/tool-actions.test.ts`
Expected: FAIL with `"table.insertRows" has no planner.`

- [ ] **Step 3: Extract the shared emit helpers in `plan-block.ts`**

Replace the body of `planUpdate` after the guard loop with a call to a new exported `emitPatch`, and the tail of `planMove` with `emitMove`:

```ts
export const emitPatch = (state: PlanState, block: SnapBlock, patch: Record<string, unknown>, tunes?: Record<string, unknown>): void => {
  const tool = requireTool(state, block.id, block.type);
  const rich = tool.entry.richTextFields;
  const written = state.prepareData(block.type, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null)), '/data', block.id, { normalize: false });
  const after: Record<string, unknown> = { ...block.data, ...written };

  Object.entries(patch).filter(([, value]) => value === null).forEach(([key]) => delete after[key]);

  const normalized = tool.runtime.normalize?.(after) ?? after;
  const dataPatch: Record<string, unknown> = {
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value === null)),
    ...Object.fromEntries(Object.entries(written).filter(([key]) => !rich.includes(key))),
    ...Object.fromEntries(Object.entries(normalized).filter(([key, value]) => !rich.includes(key) && JSON.stringify(value) !== JSON.stringify(after[key]))),
  };

  state.emit(
    ...rich.filter(field => written[field] !== undefined).map((field): Edit => ({ op: 'setRichText', id: block.id, field, value: written[field] as never })),
    ...(Object.keys(dataPatch).length > 0 ? [{ op: 'setData', id: block.id, patch: dataPatch } as Edit] : []),
    ...(tunes !== undefined ? [{ op: 'setTunes', id: block.id, tunes } as Edit] : []),
  );
};

export const emitMove = (state: PlanState, blockId: string, parentArg: unknown, position: unknown, options: { allowSelfPlaced: boolean }): void => {
  const block = state.draft.get(blockId) as SnapBlock;
  const refKey = typeof position === 'object' && position !== null ? ('before' in position ? 'before' : 'after') : undefined;
  const refId = refKey === undefined ? undefined : state.resolveId((position as Record<string, unknown>)[refKey], `/position/${refKey}`);

  if (refId === block.id) {
    state.fail('INVALID_ARGS', `Cannot place "${block.id}" relative to itself.`, '/position');
  }

  const placement = state.place(parentArg, position);
  const parentType = placement.parentId === null ? undefined : state.draft.get(placement.parentId)?.type;

  if (!options.allowSelfPlaced && parentType !== undefined && placement.parentId !== block.parent && state.tool(parentType)?.entry.selfPlacesChildren === true) {
    state.fail('PLACEMENT_REFUSED', `"${parentType}" places its own children. Use one of: ${state.actionsOf(parentType).join(', ')}.`, '/parentId', {
      reason: 'SELF_PLACED_PARENT', use: state.actionsOf(parentType),
    });
  }

  const refusal = checkMove(state.tree(), block.id, placement.parentId, refId, { allowColumnMoves: true });

  if (refusal !== null && !(options.allowSelfPlaced && refusal.reason === 'OWNS_CHILDREN')) {
    state.fail('PLACEMENT_REFUSED', `${refusal.message}.`, '/parentId', { reason: refusal.reason, ...(refusal.allowed !== undefined && { allowed: refusal.allowed }) });
  }

  const siblings = state.draft.childrenOf(placement.parentId);
  const afterId = placement.afterId === block.id
    ? (siblings.indexOf(block.id) > 0 ? siblings[siblings.indexOf(block.id) - 1] : null)
    : placement.afterId;

  state.emit({ op: 'move', id: block.id, parentId: placement.parentId, afterId });
};
```

`planUpdate` keeps its guard loop and then calls `emitPatch(state, block, patch, args.tunes as Record<string, unknown> | undefined)`; `planMove` becomes `emitMove(state, state.requireBlock(args.id, '/id').id, args.parentId, args.position, { allowSelfPlaced: false })` followed by `return { id }`. In `buildPlannedBlock`, add the 7th parameter `options: { allowSelfPlaced?: boolean } = {}` and guard the self-placed refusal with `options.allowSelfPlaced !== true &&`.

- [ ] **Step 4: Write the context and the dispatcher**

```ts
// src/shared/agent/tool-action-context.ts
import type { BlockPosition, InsertSpec, RichTextHelpers } from '../../../types/agent';
import type { RichText } from '../../../types/rich-text';
import { AgentFailure, failure } from './errors';
import { buildPlannedBlock, emitMove, emitPatch } from './plan-block';
import { PREPARE_PENDING, type PlanState } from './plan-state';
import { splitCommandName } from './names';
import type { SnapBlock } from './snapshot';

export interface RecordingContext {
  tool: string;
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

const view = (block: SnapBlock): { id: string; type: string; data: Record<string, unknown>; parentId: string | null; children: readonly string[] } =>
  ({ id: block.id, type: block.type, data: block.data, parentId: block.parent, children: [...block.content] });

export const createActionContext = (state: PlanState, block: SnapBlock | undefined, tool: string): RecordingContext => ({
  tool,
  ...(block !== undefined && { block: { id: block.id, type: block.type, data: block.data, children: [...block.content] } }),
  read: (id) => {
    const found = state.draft.get(id);

    return found === undefined ? null : view(found);
  },
  insert: (input) => {
    const placement = state.place(input.parentId, input.position ?? 'end');
    const planned = buildPlannedBlock(state, input, { id: placement.parentId }, '', false, undefined, { allowSelfPlaced: true });

    state.emit({ op: 'insert', block: planned, parentId: placement.parentId, afterId: placement.afterId });

    return planned.id;
  },
  // undefined → null: null is the removal marker every applier and the Jint JSON output understand.
  update: (id, patch) => emitPatch(state, state.requireBlock(id, '/id'), Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value === undefined ? null : value]))),
  setRichText: (id, field, value) => emitPatch(state, state.requireBlock(id, '/id'), { [field]: value }),
  move: (id, to) => emitMove(state, state.resolveId(id, '/id'), to.parentId, to.position, { allowSelfPlaced: true }),
  remove: (id, opts = {}) => {
    const target = state.requireBlock(id, '/id');
    const entry = state.tool(target.type)?.entry;

    state.emit({ op: 'remove', id: target.id, withChildren: opts.withChildren ?? (entry?.children.deletedWithParent === true || entry?.selfPlacesChildren === true) });
  },
  newId: () => state.ctx.ports.newId(),
  richText: state.ctx.richText,
  fail: (code, message) => {
    throw failure(code, message);
  },
});

export const planToolAction = (state: PlanState, name: string, args: Record<string, unknown>): unknown => {
  const entry = state.ctx.commands.get(name);
  const split = splitCommandName(name);

  if (entry === undefined || typeof entry.source !== 'object' || split === null) {
    return state.fail('UNKNOWN_COMMAND', `"${name}" is not a command here.`);
  }

  const { tool, target } = entry.source;
  const block = target === 'block' ? state.requireBlock(args.id, '/id') : undefined;

  if (block !== undefined && block.type !== tool) {
    state.fail('INVALID_ARGS', `"${name}" works on "${tool}" blocks; "${block.id}" is a "${block.type}".`, '/id');
  }

  const prepared = state.ctx.prepared.get(state.index);

  if (prepared === PREPARE_PENDING) {
    return {};
  }

  const impl = state.tool(tool)?.runtime.actions[split.action];

  if (impl === undefined) {
    return state.fail('COMMAND_UNAVAILABLE', `"${name}" has no handler in this runtime.`, '', { reason: 'runtime' });
  }

  try {
    return impl.run(createActionContext(state, block, tool), args, prepared);
  } catch (error) {
    if (error instanceof AgentFailure) {
      throw error;
    }

    return state.fail('TOOL_ACTION_FAILED', `"${name}" failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};
```

In `src/shared/agent/planner.ts`, replace the "has no planner" throw with:

```ts
import { planToolAction } from './tool-action-context';

    const handler: CommandHandler = HANDLERS[command.name] ?? ((s, a) => planToolAction(s, command.name, a));
```

`plan-block.ts` imports `PlanState` from `plan-state.ts`, and `tool-action-context.ts` imports `plan-block.ts`; `planner.ts` imports both. There is no cycle.

- [ ] **Step 5: Run the new and the touched tests**

Run: `yarn test test/unit/shared/agent/tool-actions.test.ts test/unit/shared/agent/plan-update-delete.test.ts test/unit/shared/agent/plan-move-convert.test.ts test/unit/shared/agent/plan-insert.test.ts`
Expected: PASS.

- [ ] **Step 6: Lint and commit**

```bash
npx eslint src/shared/agent/tool-action-context.ts src/shared/agent/plan-block.ts src/shared/agent/planner.ts test/unit/shared/agent/tool-actions.test.ts
git add src/shared/agent/tool-action-context.ts src/shared/agent/plan-block.ts src/shared/agent/planner.ts test/unit/shared/agent/tool-actions.test.ts
git commit -m "feat(agent): tool action dispatch through a recording context

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Note on removal: `null` and absence read the same for every built-in that allows `null` today. Checked for callout: `src/tools/callout/index.ts:164` loads a non-string `textColor` as `null`. So removing a key never changes what the editor shows.

---

### Task 15: Post-write validation (`DATA_REJECTED`)

**Files:**
- Create: `src/shared/agent/write-validation.ts`
- Modify: `src/shared/agent/planner.ts` (call it after the last command)
- Test: `test/unit/shared/agent/write-validation.test.ts`

**Interfaces:**
- Consumes: `PlanState.edits`, `PlanState.editCommand` (Task 8), `PlannerContext.validate` (Task 3, 02's `validateAgainst`).
- Produces: `validateWrites(state: PlanState): void` — throws `DATA_REJECTED` with `commandIndex` (the command that wrote it) and `details: { blockId, problems }`. Scope (06 02-Q3): the whole `data` of every inserted block (planned children included) and of every `replaceType`; for `setData` / `setRichText`, only the keys written. A key not in `properties` fails only when the schema says `additionalProperties: false`. Untouched legacy keys are never checked.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/shared/agent/write-validation.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentFailure } from '../../../../src/shared/agent/errors';
import type { OutputData } from '../../../../types';
import { planOn } from './fixtures';

const doc: OutputData = { blocks: [{ id: 'h', type: 'header', data: { text: [], level: 2, legacy: 'kept' } }] };

const err = (fn: () => unknown): AgentFailure['error'] => {
  try {
    fn();
  } catch (error) {
    if (error instanceof AgentFailure) {
      return error.error;
    }
    throw error;
  }
  throw new Error('expected a failure');
};

describe('post-write validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a bad value the batch wrote, naming the command', () => {
    expect(err(() => planOn(doc, [
      { name: 'doc.setTitle', args: { title: 'x' } },
      { name: 'block.update', args: { id: 'h', data: { level: 9 } } },
    ]))).toMatchObject({ code: 'DATA_REJECTED', commandIndex: 1, details: { blockId: 'h' } });
  });

  it('rejects an unknown key when the schema is closed', () => {
    expect(err(() => planOn(doc, [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'a', colour: 'red' } } }]))).toMatchObject({ code: 'DATA_REJECTED' });
  });

  it('does not re-check an untouched legacy key', () => {
    expect(() => planOn(doc, [{ name: 'block.update', args: { id: 'h', data: { level: 3 } } }])).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `yarn test test/unit/shared/agent/write-validation.test.ts`
Expected: FAIL — the first two cases do not throw.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/agent/write-validation.ts
import type { PlannedBlock } from '../../../types/agent';
import { failure } from './errors';
import type { PlanState } from './plan-state';
import type { JsonSchema } from './types';

const reject = (state: PlanState, commandIndex: number, blockId: string, problems: Array<{ path: string; message: string }>): never => {
  throw failure('DATA_REJECTED', `Block "${blockId}": ${problems[0].message}. Read the tool's data schema with describe({ tool }).`, {
    commandIndex, path: `/commands/${commandIndex}`, details: { blockId, problems },
  });
};

const checkWhole = (state: PlanState, commandIndex: number, type: string, blockId: string, data: unknown): void => {
  const schema = state.tool(type)?.entry.data;
  const problems = schema === undefined ? [] : state.ctx.validate(schema, data);

  if (problems.length > 0) {
    reject(state, commandIndex, blockId, problems);
  }
};

const checkKeys = (state: PlanState, commandIndex: number, type: string, blockId: string, patch: Record<string, unknown>): void => {
  const schema = state.tool(type)?.entry.data as { properties?: Record<string, JsonSchema>; additionalProperties?: unknown } | undefined;

  for (const [key, value] of Object.entries(patch)) {
    if (value === null || schema === undefined) {
      continue;
    }

    const property = schema.properties?.[key];

    if (property === undefined && schema.additionalProperties === false) {
      reject(state, commandIndex, blockId, [{ path: `/${key}`, message: `"${key}" is not a field of "${type}"` }]);
    }

    const problems = property === undefined ? [] : state.ctx.validate(property, value).map(problem => ({ ...problem, path: `/${key}${problem.path}` }));

    if (problems.length > 0) {
      reject(state, commandIndex, blockId, problems);
    }
  }
};

const walk = (block: PlannedBlock): PlannedBlock[] => [block, ...block.children.flatMap(walk)];

export const validateWrites = (state: PlanState): void => {
  state.edits.forEach((edit, i) => {
    const commandIndex = state.editCommand[i];

    switch (edit.op) {
      case 'insert':
        walk(edit.block).forEach(block => checkWhole(state, commandIndex, block.type, block.id, block.data));
        break;
      case 'replaceType':
        checkWhole(state, commandIndex, edit.type, edit.id, edit.data);
        break;
      case 'setData':
        checkKeys(state, commandIndex, state.draft.get(edit.id)?.type ?? '', edit.id, edit.patch);
        break;
      case 'setRichText':
        checkKeys(state, commandIndex, state.draft.get(edit.id)?.type ?? '', edit.id, { [edit.field]: edit.value });
        break;
      default:
        break;
    }
  });
};
```

In `planBatch` (`src/shared/agent/planner.ts`), right after the `forEach` over commands:

```ts
import { validateWrites } from './write-validation';

  validateWrites(state);
```

The draft's type is read after the whole batch ran; a block retyped later in the same batch is checked against its final type. That is intended: the final document is what must be valid.

- [ ] **Step 4: Run it, plus every earlier planner test**

Run: `yarn test test/unit/shared/agent/write-validation.test.ts test/unit/shared/agent/plan-insert.test.ts test/unit/shared/agent/plan-update-delete.test.ts test/unit/shared/agent/plan-move-convert.test.ts test/unit/shared/agent/plan-text.test.ts test/unit/shared/agent/plan-doc.test.ts test/unit/shared/agent/view.test.ts test/unit/shared/agent/tool-actions.test.ts`
Expected: PASS. (`tool-actions.test.ts` writes table `content`; the fixture's table schema is `{ type: 'object' }`, open, so it passes.)

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/shared/agent/write-validation.ts src/shared/agent/planner.ts test/unit/shared/agent/write-validation.test.ts
git add src/shared/agent/write-validation.ts src/shared/agent/planner.ts test/unit/shared/agent/write-validation.test.ts
git commit -m "feat(agent): validate what a batch wrote against the tool schema

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 16: The executor (`runBatch`)

**Files:**
- Create: `src/shared/agent/executor.ts`
- Test: `test/unit/shared/agent/executor.test.ts`

**Interfaces:**
- Consumes: `checkEnvelope` (Task 3), `planBatch`, `PREPARE_PENDING` (Tasks 8, 12–15).
- Produces:
  - `interface AgentApplier { readonly runtime: 'editor' | 'node' | 'jint' | 'node-live'; isReadOnly(): boolean; settle?(): Promise<void>; snapshot(): DocSnapshot; revision(): string; apply(plan: Plan, draft: DocSnapshot): Promise<void>; prepareInsert?(type: string): Promise<Record<string, unknown> | undefined>; undo?(): Promise<void>; redo?(): Promise<void> }`. `snapshot()` is synchronous: there is no await between the fresh snapshot and the start of `apply` (06 R2-01-2).
  - `interface BatchInput { batch: unknown; ctx: Omit<PlannerContext, 'prepared'>; applier: AgentApplier; actor: AgentActor; signal?: AbortSignal; log: CommandLogEntry[]; batchNo: number; now?: () => number }`.
  - `runBatch(input: BatchInput): Promise<AgentResult>` — steps 0–6 of 01 §3.3. `CANCELLED` checked before start, after prep, and right before apply. Host work done in prep (`effects: 'host'` prepares, `prepareInsert`) is reported as `details.orphaned` on `CANCELLED`, and as `ORPHANED_SIDE_EFFECT` (`details: { orphaned, cause }`) when the batch then fails. An `apply` throw that is not an `AgentFailure` becomes `APPLY_FAILED`. Warnings gathered before an error ride on the failure. `doc.read` results get the post-batch revision.
  - `history.undo` / `history.redo` (alone, Task 3) call `applier.undo()` / `redo()`; a missing method → `COMMAND_UNAVAILABLE` `reason: 'runtime'`.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/shared/agent/executor.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runBatch, type AgentApplier } from '../../../../src/shared/agent/executor';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';
import type { PlannerCommand } from '../../../../src/shared/agent/types';
import type { AgentResult, CommandLogEntry, OutputData } from '../../../../types';
import { coreCommandMap, plannerContext, stubPorts, TOOLS, tool } from './fixtures';

const doc: OutputData = { blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } }] };
const actor = { id: 'agent-1', name: 'Agent', kind: 'agent' as const };

const memoryApplier = (over: Partial<AgentApplier> = {}): AgentApplier & { current: DocSnapshot; applied: number } => {
  const state = {
    current: DocSnapshot.fromOutput(doc),
    applied: 0,
    runtime: 'node' as const,
    isReadOnly: () => false,
    snapshot: () => state.current,
    revision: () => `r${state.applied}`,
    apply: (_plan: unknown, draft: DocSnapshot) => {
      state.current = draft;
      state.applied++;

      return Promise.resolve();
    },
    ...over,
  };

  return state;
};

const run = (batch: unknown, applier = memoryApplier(), extra: Partial<Parameters<typeof runBatch>[0]> = {}): Promise<AgentResult> => {
  const { prepared: _prepared, ...ctx } = plannerContext();

  return runBatch({ batch, ctx, applier, actor, log: [], batchNo: 1, now: () => 7, ...extra });
};

describe('runBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies a good batch and reports refs, changed and the new revision', async () => {
    const applier = memoryApplier();
    const result = await run({ commands: [
      { name: 'block.insert', args: { type: 'paragraph', data: { text: 'x' } }, ref: 'a' },
      { name: 'doc.read', args: { limit: 1 } },
    ] }, applier);

    expect(result).toMatchObject({ ok: true, revision: 'r1', refs: { a: 'n1' }, changed: { created: ['n1'] } });
    expect((result as { results: Array<{ revision?: string }> }).results[1].revision).toBe('r1');
    expect(applier.current.get('n1')?.rest.lastEditedBy).toBe('agent-1');
  });

  it('writes nothing when the third command fails, and keeps earlier warnings', async () => {
    const applier = memoryApplier();
    const before = JSON.stringify(applier.current.toOutput());
    const result = await run({ commands: [
      { name: 'block.insert', args: { type: 'paragraph', data: { text: '**md**' } } },
      { name: 'block.insert', args: { type: 'paragraph' } },
      { name: 'block.delete', args: { id: 'missing' } },
    ] }, applier);

    expect(result).toMatchObject({ ok: false, error: { code: 'BLOCK_NOT_FOUND', commandIndex: 2 } });
    expect(result.warnings.map(w => w.code)).toContain('LOOKS_LIKE_MARKDOWN');
    expect(JSON.stringify(applier.current.toOutput())).toBe(before);
    expect(applier.applied).toBe(0);
  });

  it('refuses writes when read-only and still reads', async () => {
    const applier = memoryApplier({ isReadOnly: () => true });

    expect(await run({ commands: [{ name: 'block.delete', args: { id: 'p' } }] }, applier)).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
    expect(await run({ commands: [{ name: 'doc.read', args: {} }] }, applier)).toMatchObject({ ok: true });
  });

  it('returns STALE for a wrong expectRevision', async () => {
    expect(await run({ commands: [{ name: 'doc.read', args: {} }], expectRevision: 'r9' })).toMatchObject({ ok: false, error: { code: 'STALE', retryable: true } });
  });

  it('cancels at each check point and never mid-apply', async () => {
    const stopped = new AbortController();

    stopped.abort();
    expect(await run({ commands: [{ name: 'doc.read', args: {} }] }, memoryApplier(), { signal: stopped.signal })).toMatchObject({ error: { code: 'CANCELLED' } });

    const duringPrep = new AbortController();
    const { prepared: _p, ...ctx } = plannerContext({ ports: stubPorts({ markdownToBlocks: () => { duringPrep.abort(); return Promise.resolve({ blocks: [], warnings: [] }); } }) });
    expect(await runBatch({ batch: { commands: [{ name: 'markdown.insert', args: { markdown: '# x' } }] }, ctx, applier: memoryApplier(), actor, signal: duringPrep.signal, log: [], batchNo: 1 }))
      .toMatchObject({ error: { code: 'CANCELLED' } });

    const beforeApply = new AbortController();
    const applier = memoryApplier();
    let calls = 0;
    // Call 1 is the pre-plan; call 2 is the real plan, right before apply.
    const { prepared: _q, ...ctx2 } = plannerContext({ ports: stubPorts({ sanitizeBlockData: (_t, data) => { if (++calls === 2) beforeApply.abort(); return data; } }) });
    expect(await runBatch({ batch: { commands: [{ name: 'block.insert', args: { type: 'paragraph' } }] }, ctx: ctx2, applier, actor, signal: beforeApply.signal, log: [], batchNo: 1 }))
      .toMatchObject({ error: { code: 'CANCELLED' } });
    expect(applier.applied).toBe(0);
  });

  it('reports host work done in prep as orphaned', async () => {
    const tools = new Map(TOOLS);
    tools.set('page', tool('page', {}, { actions: { rename: { prepare: () => Promise.resolve({ renamed: 'pg-1' }), run: (ctx: { fail(c: 'PRECONDITION_FAILED', m: string): never }) => ctx.fail('PRECONDITION_FAILED', 'no') } } as never }));
    const commands = coreCommandMap();
    const rename: PlannerCommand = { name: 'page.rename', args: { type: 'object' }, readOnly: false, available: true, effects: 'host', source: { tool: 'page', target: 'create' } };
    commands.set('page.rename', rename);
    const { prepared: _p, ...ctx } = plannerContext({ tools, commands });
    const result = await runBatch({ batch: { commands: [{ name: 'page.rename', args: {} }] }, ctx, applier: memoryApplier(), actor, log: [], batchNo: 1 });

    expect(result).toMatchObject({ ok: false, error: { code: 'ORPHANED_SIDE_EFFECT', details: { orphaned: [{ command: 'page.rename', prepared: { renamed: 'pg-1' } }], cause: { code: 'PRECONDITION_FAILED' } } } });
  });

  it('turns an apply throw into APPLY_FAILED', async () => {
    const applier = memoryApplier({ apply: () => Promise.reject(new Error('tool bug')) });

    expect(await run({ commands: [{ name: 'block.delete', args: { id: 'p' } }] }, applier)).toMatchObject({ ok: false, error: { code: 'APPLY_FAILED' } });
  });

  it('logs every command with its result or error', async () => {
    const log: CommandLogEntry[] = [];

    await run({ commands: [{ name: 'block.delete', args: { id: 'p' } }] }, memoryApplier(), { log, batchNo: 3 });
    await run({ commands: [{ name: 'block.delete', args: { id: 'zz' } }] }, memoryApplier(), { log, batchNo: 4 });

    expect(log).toEqual([
      { batch: 3, index: 0, name: 'block.delete', args: { id: 'p' }, result: { removedIds: ['p'], liftedIds: [] }, actorId: 'agent-1' },
      expect.objectContaining({ batch: 4, index: 0, error: expect.objectContaining({ code: 'BLOCK_NOT_FOUND' }) }),
    ]);
  });

  it('routes history commands to the applier, or says they are unavailable', async () => {
    const undo = vi.fn(() => Promise.resolve());

    expect(await run({ commands: [{ name: 'history.undo', args: {} }] }, memoryApplier({ undo }))).toMatchObject({ ok: true });
    expect(undo).toHaveBeenCalledOnce();
    expect(await run({ commands: [{ name: 'history.redo', args: {} }] })).toMatchObject({ ok: false, error: { code: 'COMMAND_UNAVAILABLE' } });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `yarn test test/unit/shared/agent/executor.test.ts`
Expected: FAIL with `Failed to resolve import "../../../../src/shared/agent/executor"`.

- [ ] **Step 3: Write the executor**

```ts
// src/shared/agent/executor.ts
import type { AgentActor, AgentBatch, AgentError, AgentResult, AgentWarning, CommandLogEntry, DocumentView } from '../../../types/agent';
import { checkEnvelope } from './envelope';
import { AgentFailure, failure } from './errors';
import { splitCommandName } from './names';
import { PREPARE_PENDING } from './plan-state';
import { planBatch } from './planner';
import type { DocSnapshot } from './snapshot';
import type { Plan, PlannerContext } from './types';

export interface AgentApplier {
  readonly runtime: 'editor' | 'node' | 'jint' | 'node-live';
  isReadOnly(): boolean;
  settle?(): Promise<void>;
  snapshot(): DocSnapshot;
  revision(): string;
  apply(plan: Plan, draft: DocSnapshot): Promise<void>;
  prepareInsert?(type: string): Promise<Record<string, unknown> | undefined>;
  undo?(): Promise<void>;
  redo?(): Promise<void>;
}

export interface BatchInput {
  batch: unknown;
  ctx: Omit<PlannerContext, 'prepared'>;
  applier: AgentApplier;
  actor: AgentActor;
  signal?: AbortSignal;
  log: CommandLogEntry[];
  batchNo: number;
  now?: () => number;
}

type Prep = (index: number) => Promise<unknown>;

/** Which commands need async work before planning, and how to do it. */
const prepsFor = (input: BatchInput, batch: AgentBatch, orphaned: unknown[]): Map<number, Prep> => {
  const preps = new Map<number, Prep>();

  batch.commands.forEach((command, index) => {
    if (command.name === 'markdown.insert') {
      preps.set(index, () => input.ctx.ports.markdownToBlocks(String(command.args.markdown)));

      return;
    }

    const entry = input.ctx.commands.get(command.name);
    const split = splitCommandName(command.name);
    const impl = typeof entry?.source === 'object' && split !== null ? input.ctx.tools.get(entry.source.tool)?.runtime.actions[split.action] : undefined;

    if (impl?.prepare !== undefined) {
      const prepare = impl.prepare.bind(impl);

      preps.set(index, async () => {
        const prepared = await prepare({ services: input.ctx.services }, command.args);

        if (entry?.effects === 'host') {
          orphaned.push({ command: command.name, prepared });
        }

        return prepared;
      });

      return;
    }

    const type = command.name === 'block.insert' ? String(command.args.type) : undefined;
    const requires = type === undefined ? undefined : input.ctx.tools.get(type)?.entry.insertRequires;

    if (type !== undefined && requires !== undefined && requires.length > 0) {
      preps.set(index, async () => {
        if (input.applier.prepareInsert === undefined) {
          throw failure('COMMAND_UNAVAILABLE', `Inserting "${type}" needs the host (${requires.join(', ')}), which is absent here.`, {
            commandIndex: index, details: { reason: 'service', requires },
          });
        }

        const prepared = await input.applier.prepareInsert(type);

        orphaned.push({ command: 'block.insert', type, prepared });

        return prepared;
      });
    }
  });

  return preps;
};

const toAgentError = (error: unknown, index: number | undefined): AgentError => {
  if (error instanceof AgentFailure) {
    return error.error;
  }

  return failure('TOOL_ACTION_FAILED', `A prepare step failed: ${error instanceof Error ? error.message : String(error)}`, index === undefined ? {} : { commandIndex: index }).error;
};

export const runBatch = async (input: BatchInput): Promise<AgentResult> => {
  const warnings: AgentWarning[] = [];
  const orphaned: unknown[] = [];
  const cancelled = (): AgentFailure => failure('CANCELLED', 'The turn was stopped before anything was written.', orphaned.length > 0 ? { details: { orphaned } } : {});
  const checkCancel = (): void => {
    if (input.signal?.aborted === true) {
      throw cancelled();
    }
  };
  let batch: AgentBatch | undefined;

  const record = (results: unknown[] | null, error: AgentError | null): void => {
    const commands = batch?.commands ?? [{ name: '', args: input.batch as Record<string, unknown> }];

    commands.forEach((command, index) => input.log.push({
      batch: input.batchNo, index, name: command.name, args: command.args,
      ...(results !== null && { result: results[index] }),
      ...(error !== null && (error.commandIndex ?? 0) === index && { error }),
      actorId: input.actor.id,
    }));
  };

  try {
    checkCancel();

    const checked = checkEnvelope(input.batch, input.ctx.commands, input.ctx.validate);

    batch = checked.batch;
    if (checked.writes && input.applier.isReadOnly()) {
      throw failure('READ_ONLY', 'The document is read-only now. Reads still work.');
    }

    const [first] = batch.commands;

    if (first.name === 'history.undo' || first.name === 'history.redo') {
      const step = first.name === 'history.undo' ? input.applier.undo : input.applier.redo;

      if (step === undefined) {
        throw failure('COMMAND_UNAVAILABLE', `${first.name} is not available here.`, { commandIndex: 0, details: { reason: 'runtime' } });
      }
      await step.call(input.applier);
      record([{}], null);

      return { ok: true, revision: input.applier.revision(), results: [{}], refs: {}, changed: { created: [], updated: [], moved: [], removed: [] }, warnings };
    }

    const preps = prepsFor(input, batch, orphaned);
    const stamp = { actorId: input.actor.id, at: (input.now ?? Date.now)() };

    // Step 2: check structure before any host work.
    planBatch({ snapshot: input.applier.snapshot(), batch, ctx: { ...input.ctx, prepared: new Map([...preps.keys()].map(i => [i, PREPARE_PENDING])) }, stamp, warnings: [] });

    // Step 3: host work, nothing written.
    const prepared = new Map<number, unknown>();

    for (const [index, prep] of preps) {
      try {
        prepared.set(index, await prep(index));
      } catch (error) {
        throw new AgentFailure(toAgentError(error, index));
      }
    }

    checkCancel();
    await input.applier.settle?.();

    // Step 5: no await from here to the start of apply.
    const snapshot = input.applier.snapshot();
    const current = input.applier.revision();

    if (batch.expectRevision !== undefined && batch.expectRevision !== current) {
      throw failure('STALE', 'The document changed since you read it. Read it again, then retry.', { details: { revision: current } });
    }

    const { plan, draft } = planBatch({ snapshot, batch, ctx: { ...input.ctx, prepared }, stamp, warnings });

    checkCancel();
    if (plan.edits.length > 0) {
      try {
        await input.applier.apply(plan, draft);
      } catch (error) {
        if (error instanceof AgentFailure) {
          throw error;
        }
        throw failure('APPLY_FAILED', `Applying the batch failed: ${error instanceof Error ? error.message : String(error)}. The document may be partly changed; read it again.`);
      }
    }

    const revision = input.applier.revision();
    const results = plan.results.map((result, index) => (batch?.commands[index].name === 'doc.read' ? { ...(result as DocumentView), revision } : result));

    record(results, null);

    return { ok: true, revision, results, refs: plan.refs, changed: plan.changed, ...(plan.lastRange !== undefined && { lastRange: plan.lastRange }), warnings };
  } catch (error) {
    if (!(error instanceof AgentFailure)) {
      throw error;
    }

    const failed = orphaned.length > 0 && error.error.code !== 'CANCELLED'
      ? failure('ORPHANED_SIDE_EFFECT', `The batch failed after the host did work for it (${error.error.message}). Clean up the listed items.`, {
        ...(error.error.commandIndex !== undefined && { commandIndex: error.error.commandIndex }),
        details: { orphaned, cause: error.error },
      }).error
      : error.error;

    record(null, failed);

    return { ok: false, revision: input.applier.revision(), error: failed, warnings };
  }
};
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `yarn test test/unit/shared/agent/executor.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/shared/agent/executor.ts test/unit/shared/agent/executor.test.ts
git add src/shared/agent/executor.ts test/unit/shared/agent/executor.test.ts
git commit -m "feat(agent): batch executor with cancel points, read-only guard and orphan reporting

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: `createDocumentAgentSession`, revision hash, stored undo, `describe`, page-map backend

**Files:**
- Create: `src/shared/agent/revision.ts`, `src/shared/agent/context.ts`, `src/shared/agent/describe.ts`, `src/shared/agent/document-session.ts`, `src/shared/agent/index.ts`
- Modify: `types/agent.d.ts` (add `AgentSession`, `ContractSlice`), `src/shared/agent/types.ts` (`AgentPorts.openPageDocument?`)
- Test: `test/unit/shared/agent/document-session.test.ts`

**Interfaces:**
- Consumes: **02** `AgentContract`, `CommandEntry`, `BlockToolManifestEntry` from `types/tool-manifest.d.ts` (02 Task 3); **02** `ToolRuntime`, `ToolRuntimeRegistry` from `src/shared/tool-actions/runtime.ts` (02 Task 13); **02** `PageBackendService` from `src/shared/tool-actions/services.ts` (02 Task 12 creates the file, types only); `runBatch` (Task 16); `validateAgainst` from `src/shared/schema/validate.ts` (02 Task 2).
- Produces:
  - `types/agent.d.ts` additions: `ContractSlice` (06 §3.5 verbatim) and `AgentSession` (06 §3.5 verbatim).
  - `canonicalJson(value: unknown): string` (sorted keys) and `contentRevision(doc: OutputData): string` (`"h" + cyrb53` hex; pure, no `crypto`, Jint-safe).
  - `plannerContextFrom(contract: ContractLike, runtimes: ReadonlyMap<string, PlannerToolRuntime>, ports: AgentPorts, validate: SchemaValidator, services: Partial<Record<string, unknown>>): Omit<PlannerContext, 'prepared'>` with `type ContractLike = { commands: readonly PlannerCommand[]; manifest: { defaultBlock: string; blocks: readonly PlannerToolEntry[] } }` (02's `AgentContract` is assignable).
  - `describeContract(contract: AgentContract, query?: { tool?: string; command?: string }): AgentContract | ContractSlice` — no args → the `index` slice; unknown tool → `UNKNOWN_TOOL`; unknown command → `UNKNOWN_COMMAND`.
  - `AgentPorts.openPageDocument?(pageId: string, actor: AgentActor): Promise<AgentSession & { close(): void }>`.
  - `createPageMapBackend(open: NonNullable<AgentPorts['openPageDocument']>, actor: AgentActor, readBlock: (blockId: string) => { type: string; data: Record<string, unknown> } | undefined): PageBackendService`. `PageBackendService` is **02's** type (`src/shared/tool-actions/services.ts`; 02 Task 12 creates the file, Task 44 uses it): `rename(input: { blockId: string; title: string }): Promise<unknown>; setIcon(input: { blockId: string; icon: PageIcon | null }): Promise<unknown>`. It takes the block id because 02's `prepare` sees only `{ services }` and the args. The backend reads the page block's `data.pageId` (02 Task 21) through `readBlock`, which the session points at its current snapshot; a missing block or a block that is not a `page` with a string `pageId` → `AgentFailure('BLOCK_NOT_FOUND' | 'INVALID_ARGS')`. It resolves to `{ pageId, applied: true }` (06 §10.1 B). An error inside the target session is rethrown as an `AgentFailure` with `details.pageId`.
  - `createDocumentAgentSession(input: { document: OutputData; tools: ToolRuntimeRegistry; contract: AgentContract; actor: AgentActor; ports: AgentPorts; services?: Partial<Record<string, unknown>>; pageTitles?: 'page-map'; validate?: SchemaValidator; runtime?: 'node' | 'jint' }): AgentSession & { output(): OutputData }`. Rich fields in `document` must already be segments (Task 19's `loadStoredDocument` does that). Stored undo: one pre-batch snapshot per successful write batch; `history.undo` restores it; `NOTHING_TO_UNDO` when empty; a new write batch clears redo.

- [ ] **Step 1: Publish the session types**

Append to `types/agent.d.ts`:

```ts
import type { AgentContract, BlockToolManifestEntry, CommandEntry } from './tool-manifest';

export type ContractSlice =
  | { index: { tools: { name: string; summary: string }[]; commands: { name: CommandName; summary: string }[]; guidance: string } }
  | { tool: BlockToolManifestEntry; commands: CommandEntry[] }
  | { command: CommandEntry };

export interface AgentSession {
  readonly id: string;
  readonly actor: AgentActor;
  read(args?: ViewArgs): Promise<DocumentView>;
  describe(query?: { tool?: string; command?: string }): AgentContract | ContractSlice;
  execute(batch: AgentBatch, options?: { signal?: AbortSignal }): Promise<AgentResult>;
  log(): readonly CommandLogEntry[];
  close(): void;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// test/unit/shared/agent/document-session.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentAgentSession, createPageMapBackend } from '../../../../src/shared/agent/document-session';
import { contentRevision } from '../../../../src/shared/agent/revision';
import type { AgentContract } from '../../../../types/tool-manifest';
import type { AgentSession, OutputData } from '../../../../types';
import { coreCommandMap, stubPorts, TOOLS } from './fixtures';

const actor = { id: 'agent-1', name: 'Agent', kind: 'agent' as const };
const contract = {
  formatVersion: 1,
  revision: 'c1',
  commands: [...coreCommandMap().values()].map(entry => ({ ...entry, summary: '' })),
  manifest: { defaultBlock: 'paragraph', blocks: [...TOOLS.values()].map(item => ({ ...item.entry, summary: `${item.entry.name} block` })) },
  guidance: { general: 'Use segments, never Markdown.', commands: {}, tools: {} },
} as unknown as AgentContract;
const runtimes = new Map([...TOOLS].map(([name, item]) => [name, { name, sanitize: {}, ...item.runtime }]));
const doc: OutputData = { blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } }] };

const open = (document = doc, extra: Record<string, unknown> = {}) =>
  createDocumentAgentSession({ document, tools: runtimes as never, contract, actor, ports: stubPorts(), ...extra });

describe('createDocumentAgentSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hashes the canonical document, key order ignored', () => {
    expect(contentRevision({ blocks: [], title: 'a' })).toBe(contentRevision({ title: 'a', blocks: [] }));
    expect(contentRevision({ blocks: [] })).not.toBe(contentRevision({ blocks: [], title: 'a' }));
  });

  it('executes, stamps, and moves the revision', async () => {
    const session = open();
    const before = (await session.read()).revision;
    const result = await session.execute({ commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'x' } } }] });

    expect(result.ok).toBe(true);
    expect(result.ok && result.revision).not.toBe(before);
    expect(session.output().blocks[1]).toMatchObject({ lastEditedBy: 'agent-1' });
  });

  it('undoes and redoes its own batches, and says when there is nothing', async () => {
    const session = open();

    await session.execute({ commands: [{ name: 'block.delete', args: { id: 'p' } }] });
    expect(session.output().blocks).toHaveLength(0);
    expect(await session.execute({ commands: [{ name: 'history.undo', args: {} }] })).toMatchObject({ ok: true });
    expect(session.output()).toEqual(doc);
    expect(await session.execute({ commands: [{ name: 'history.undo', args: {} }] })).toMatchObject({ ok: false, error: { code: 'NOTHING_TO_UNDO' } });
    await session.execute({ commands: [{ name: 'history.redo', args: {} }] });
    expect(session.output().blocks).toHaveLength(0);
  });

  it('describes the contract: index, tool, command', () => {
    const session = open();

    expect(session.describe()).toMatchObject({ index: { guidance: 'Use segments, never Markdown.' } });
    expect(session.describe({ tool: 'header' })).toMatchObject({ tool: { name: 'header' } });
    expect(session.describe({ command: 'text.format' })).toMatchObject({ command: { name: 'text.format' } });
    expect(() => session.describe({ tool: 'kanban' })).toThrow(/kanban/);
  });

  it('keeps a log across batches', async () => {
    const session = open();

    await session.execute({ commands: [{ name: 'doc.read', args: {} }] });
    await session.execute({ commands: [{ name: 'doc.read', args: {} }] });

    expect(session.log().map(entry => entry.batch)).toEqual([1, 2]);
  });

  it('renames another page through the page-map backend', async () => {
    const target = open({ blocks: [] });
    const blocks: Record<string, { type: string; data: Record<string, unknown> }> = { pb: { type: 'page', data: { pageId: 'pg-1' } } };
    const backend = createPageMapBackend((pageId) => {
      expect(pageId).toBe('pg-1');

      // A fresh wrapper per open: the backend closes what it opens.
      return Promise.resolve({ ...target, close: vi.fn() } as AgentSession & { close(): void });
    }, actor, blockId => blocks[blockId]);

    // 02's PageBackendService shape: the block id in, the page id read from the block.
    await expect(backend.rename({ blockId: 'pb', title: 'Roadmap' })).resolves.toEqual({ pageId: 'pg-1', applied: true });
    await backend.setIcon({ blockId: 'pb', icon: { type: 'emoji', value: '🗺️' } });

    expect(target.output()).toMatchObject({ title: 'Roadmap', icon: { type: 'emoji', value: '🗺️' } });
    await expect(backend.rename({ blockId: 'missing', title: 'x' })).rejects.toMatchObject({ error: { code: 'BLOCK_NOT_FOUND' } });
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `yarn test test/unit/shared/agent/document-session.test.ts`
Expected: FAIL with `Failed to resolve import "../../../../src/shared/agent/document-session"`.

- [ ] **Step 4: Write the implementation**

```ts
// src/shared/agent/revision.ts
import type { OutputData } from '../../../types/data-formats/output-data';

export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
};

/** cyrb53: a 53-bit string hash. Pure arithmetic, so it runs in Jint (no crypto). */
const cyrb53 = (text: string): string => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;

  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);

    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
};

export const contentRevision = (doc: OutputData): string => `h${cyrb53(canonicalJson(doc))}`;
```

```ts
// src/shared/agent/context.ts
import { richTextHelpers } from './rich-text-ops';
import type { AgentPorts, PlannerCommand, PlannerContext, PlannerToolEntry, PlannerToolRuntime, SchemaValidator } from './types';

export type ContractLike = { commands: readonly PlannerCommand[]; manifest: { defaultBlock: string; blocks: readonly PlannerToolEntry[] } };

export const plannerContextFrom = (
  contract: ContractLike,
  runtimes: ReadonlyMap<string, PlannerToolRuntime>,
  ports: AgentPorts,
  validate: SchemaValidator,
  services: Partial<Record<string, unknown>>
): Omit<PlannerContext, 'prepared'> => ({
  tools: new Map(contract.manifest.blocks.map(entry => [entry.name, { entry, runtime: runtimes.get(entry.name) ?? { actions: {} } }])),
  commands: new Map(contract.commands.map(entry => [entry.name, entry])),
  ports,
  validate,
  defaultBlock: contract.manifest.defaultBlock,
  richText: richTextHelpers,
  services,
});
```

```ts
// src/shared/agent/describe.ts
import type { ContractSlice } from '../../../types/agent';
import type { AgentContract } from '../../../types/tool-manifest';
import { failure } from './errors';

export const describeContract = (contract: AgentContract, query: { tool?: string; command?: string } = {}): AgentContract | ContractSlice => {
  if (query.command !== undefined) {
    const command = contract.commands.find(entry => entry.name === query.command);

    if (command === undefined) {
      throw failure('UNKNOWN_COMMAND', `No command "${query.command}". Call describe() for the list.`);
    }

    return { command };
  }
  if (query.tool !== undefined) {
    const tool = contract.manifest.blocks.find(entry => entry.name === query.tool);

    if (tool === undefined) {
      throw failure('UNKNOWN_TOOL', `No block tool "${query.tool}". Call describe() for the list.`);
    }

    return { tool, commands: contract.commands.filter(entry => typeof entry.source === 'object' && entry.source.tool === query.tool) };
  }

  return {
    index: {
      tools: contract.manifest.blocks.map(entry => ({ name: entry.name, summary: entry.summary })),
      commands: contract.commands.map(entry => ({ name: entry.name, summary: entry.summary })),
      guidance: contract.guidance.general,
    },
  };
};
```

```ts
// src/shared/agent/document-session.ts
import type { AgentActor, AgentSession, CommandLogEntry, DocumentView, ViewArgs } from '../../../types/agent';
import type { OutputData } from '../../../types/data-formats/output-data';
import type { AgentContract } from '../../../types/tool-manifest';
import { validateAgainst } from '../schema/validate';
import type { PageBackendService } from '../tool-actions/services';
import { plannerContextFrom } from './context';
import { describeContract } from './describe';
import { failure } from './errors';
import { runBatch, type AgentApplier } from './executor';
import { contentRevision } from './revision';
import { DocSnapshot } from './snapshot';
import type { AgentPorts, PlannerToolRuntime, SchemaValidator } from './types';

type ReadBlock = (blockId: string) => { type: string; data: Record<string, unknown> } | undefined;

export const createPageMapBackend = (open: NonNullable<AgentPorts['openPageDocument']>, actor: AgentActor, readBlock: ReadBlock): PageBackendService => {
  const pageIdOf = (blockId: string): string => {
    const block = readBlock(blockId);

    if (block === undefined) {
      throw failure('BLOCK_NOT_FOUND', `No block "${blockId}".`, { details: { blockId } });
    }
    if (block.type !== 'page' || typeof block.data.pageId !== 'string') {
      throw failure('INVALID_ARGS', `Block "${blockId}" is not a page block with a pageId.`, { details: { blockId } });
    }

    return block.data.pageId;
  };

  const write = async (blockId: string, name: 'doc.setTitle' | 'doc.setIcon', args: Record<string, unknown>): Promise<{ pageId: string; applied: true }> => {
    const pageId = pageIdOf(blockId);
    const session = await open(pageId, actor);

    try {
      const result = await session.execute({ commands: [{ name, args }] });

      if (!result.ok) {
        throw failure(result.error.code, `Page "${pageId}": ${result.error.message}`, { details: { ...result.error.details, pageId } });
      }
    } finally {
      session.close();
    }

    return { pageId, applied: true };
  };

  return {
    rename: ({ blockId, title }) => write(blockId, 'doc.setTitle', { title }),
    setIcon: ({ blockId, icon }) => write(blockId, 'doc.setIcon', { icon }),
  };
};

let sessionCount = 0;

export const createDocumentAgentSession = (input: {
  document: OutputData;
  tools: ReadonlyMap<string, PlannerToolRuntime>;
  contract: AgentContract;
  actor: AgentActor;
  ports: AgentPorts;
  services?: Partial<Record<string, unknown>>;
  pageTitles?: 'page-map';
  validate?: SchemaValidator;
  runtime?: 'node' | 'jint';
}): AgentSession & { output(): OutputData } => {
  const id = `doc-session-${++sessionCount}`;
  const log: CommandLogEntry[] = [];
  const past: DocSnapshot[] = [];
  const future: DocSnapshot[] = [];
  let current = DocSnapshot.fromOutput(input.document);
  let closed = false;
  // prepare runs on the batch's fresh snapshot, so the backend reads the block from `current`.
  const services = {
    ...(input.services ?? {}),
    ...(input.pageTitles === 'page-map' && input.ports.openPageDocument !== undefined && { pageBackend: createPageMapBackend(input.ports.openPageDocument, input.actor, blockId => current.get(blockId)) }),
  };
  const ctx = plannerContextFrom(input.contract, input.tools, input.ports, input.validate ?? validateAgainst, services);

  const applier: AgentApplier = {
    runtime: input.runtime ?? 'node',
    isReadOnly: () => closed,
    snapshot: () => current,
    revision: () => contentRevision(current.toOutput()),
    apply: (_plan, draft) => {
      past.push(current);
      future.length = 0;
      current = draft;

      return Promise.resolve();
    },
    undo: () => {
      const previous = past.pop();

      if (previous === undefined) {
        return Promise.reject(failure('NOTHING_TO_UNDO', 'This session has no step to undo.'));
      }
      future.push(current);
      current = previous;

      return Promise.resolve();
    },
    redo: () => {
      const next = future.pop();

      if (next === undefined) {
        return Promise.reject(failure('NOTHING_TO_UNDO', 'This session has no undone step to redo.'));
      }
      past.push(current);
      current = next;

      return Promise.resolve();
    },
  };

  let batchNo = 0;

  return {
    id,
    actor: input.actor,
    read: async (args: ViewArgs = {}): Promise<DocumentView> => {
      const result = await runBatch({ batch: { commands: [{ name: 'doc.read', args }] }, ctx, applier, actor: input.actor, log: [], batchNo: 0 });

      if (!result.ok) {
        throw failure(result.error.code, result.error.message, { ...(result.error.details !== undefined && { details: result.error.details }) });
      }

      return result.results[0] as DocumentView;
    },
    describe: query => describeContract(input.contract, query),
    execute: (batch, options = {}) => runBatch({ batch, ctx, applier, actor: input.actor, signal: options.signal, log, batchNo: ++batchNo }),
    log: () => [...log],
    close: () => {
      closed = true;
    },
    output: () => current.toOutput(),
  };
};
```

```ts
// src/shared/agent/index.ts
export { COMMANDS } from './commands';
export { createDocumentAgentSession, createPageMapBackend } from './document-session';
export { plannerContextFrom } from './context';
export { runBatch, type AgentApplier } from './executor';
export { DocSnapshot } from './snapshot';
export { applyEdits } from './json-applier';
export { contentRevision, canonicalJson } from './revision';
export { richTextHelpers } from './rich-text-ops';
export { describeContract } from './describe';
export type { AgentPorts, PlannerContext, Plan } from './types';
```

Add to `AgentPorts` in `src/shared/agent/types.ts`:

```ts
import type { AgentActor, AgentSession } from '../../../types/agent';

  /** Headless page.rename / page.setIcon. Absent: those actions are unavailable. */
  openPageDocument?(pageId: string, actor: AgentActor): Promise<AgentSession & { close(): void }>;
```

`NOTHING_TO_UNDO` reused for an empty redo stack is the spec's code list (01 §3.10 has no separate redo code).

- [ ] **Step 5: Run it, the type check, and the published-types law**

Run: `yarn test test/unit/shared/agent/document-session.test.ts test/unit/architecture/published-types-no-src-refs.test.ts`
Expected: PASS (6 + law tests).
Run: `NODE_OPTIONS=--max-old-space-size=8192 yarn lint:types`
Expected: PASS. If 02's `types/tool-manifest.d.ts` is not on `main` yet, this task is blocked (see "Cross-plan dependencies").

- [ ] **Step 6: Lint and commit**

```bash
npx eslint src/shared/agent/revision.ts src/shared/agent/context.ts src/shared/agent/describe.ts src/shared/agent/document-session.ts src/shared/agent/index.ts src/shared/agent/types.ts types/agent.d.ts test/unit/shared/agent/document-session.test.ts
git add src/shared/agent/revision.ts src/shared/agent/context.ts src/shared/agent/describe.ts src/shared/agent/document-session.ts src/shared/agent/index.ts src/shared/agent/types.ts types/agent.d.ts test/unit/shared/agent/document-session.test.ts
git commit -m "feat(agent): stored-document sessions with undo, describe and the page-map backend

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 18: One deep-sanitize walk for the editor and for headless runtimes

**Files:**
- Create: `src/shared/sanitize-walk.ts`
- Modify: `src/components/utils/sanitizer.ts` (move code out; import it back)
- Test: `test/unit/shared/sanitize-walk.test.ts`

**Interfaces:**
- Consumes: nothing new. `isObject`, `isFunction`, `isString`, `isBoolean`, `isEmpty` (`src/components/utils/type-guards.ts`), `deepMerge` (`src/components/utils/object.ts`) — both are DOM-free modules.
- Produces (from `src/shared/sanitize-walk.ts`): `type DeepSanitizerRule`, `type DeepData`, `MAX_SANITIZE_DEPTH`, `isPlaintextRule`, `isRule`, `getEffectiveRuleForString(rule, globalRules): SanitizerConfig | null`, `type StringCleaner = (value: string, rule: DeepSanitizerRule, globalRules: SanitizerConfig) => string`, and `walkSanitize(data: DeepData, rules: DeepSanitizerRule, globalRules: SanitizerConfig, clean: StringCleaner, depth?: number): DeepData` (today's `deepSanitize` with `cleanOneItem` injected). Behaviour of the editor's `sanitizeBlocks`, `clean`, `stripUnsafeUrlsDeep` and `composeSanitizerConfig` does not change.

Why: the headless sanitizer (Task 19) must pick per-field rules exactly as the editor does. A second copy of the walk would drift.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/shared/sanitize-walk.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getEffectiveRuleForString, walkSanitize, type StringCleaner } from '../../../src/shared/sanitize-walk';

describe('walkSanitize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('gives each field its own rule and falls back to the parent rule', () => {
    const seen: Array<[string, unknown]> = [];
    const clean: StringCleaner = (value, rule) => {
      seen.push([value, rule]);

      return value.toUpperCase();
    };
    const out = walkSanitize({ text: 'a', caption: 'b', items: ['c'] }, { text: { b: true }, items: false }, {}, clean);

    expect(out).toEqual({ text: 'A', caption: 'B', items: ['C'] });
    expect(seen).toEqual([['a', { b: true }], ['b', { text: { b: true }, items: false }], ['c', false]]);
  });

  it('reads past the depth cap as null', () => {
    let deep: unknown = 'x';

    for (let i = 0; i < 300; i++) {
      deep = [deep];
    }

    expect(JSON.stringify(walkSanitize(deep as never, {}, {}, value => value))).toContain('null');
  });

  it('merges a field rule over the global one', () => {
    expect(getEffectiveRuleForString({ b: true }, { i: true })).toEqual({ b: true, i: true });
    expect(getEffectiveRuleForString(false, { i: true })).toEqual({});
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `yarn test test/unit/shared/sanitize-walk.test.ts`
Expected: FAIL with `Failed to resolve import "../../../src/shared/sanitize-walk"`.

- [ ] **Step 3: Move the code**

Create `src/shared/sanitize-walk.ts` and move into it, verbatim, these ranges of `src/components/utils/sanitizer.ts` (line numbers as of `30c77599`):

- line 41 (`type DeepSanitizerRule`), lines 53-56 (`isPlaintextRule`), line 60 (`type DeepData`), line 69 (`MAX_SANITIZE_DEPTH`);
- lines 158-251 (`deepSanitize`, `cleanArray`, `cleanObject`);
- lines 305-307 (`isRule`);
- lines 413-588 (`cloneSanitizerConfig`, `SanitizerFunctionRule`, `wrapFunctionRule`, `preserveExistingAttributesRule`, `cloneTagConfig`, `mergeTagRules`, `getEffectiveRuleForString`).

Then make these edits inside the new file:

```ts
import type { SanitizerConfig, SanitizerRule } from '../../types';
import type { TagConfig } from '../../types/configs/sanitizer-config';
import { deepMerge } from '../components/utils/object';
import { isBoolean, isEmpty, isFunction, isObject, isString } from '../components/utils/type-guards';
import { PLAINTEXT } from './sanitize-rules';

export type StringCleaner = (value: string, rule: DeepSanitizerRule, globalRules: SanitizerConfig) => string;

// deepSanitize → exported walkSanitize, with the string step injected:
export const walkSanitize = (
  dataToSanitize: DeepData,
  rules: DeepSanitizerRule,
  globalRules: SanitizerConfig,
  clean: StringCleaner,
  depth = 0
): DeepData => {
  if (depth > MAX_SANITIZE_DEPTH) {
    return null;
  }
  if (Array.isArray(dataToSanitize)) {
    return dataToSanitize.map(item => walkSanitize(item, rules, globalRules, clean, depth + 1));
  }
  if (isObject(dataToSanitize)) {
    return cleanObject(dataToSanitize, rules, globalRules, clean, depth);
  }
  if (isString(dataToSanitize)) {
    return clean(dataToSanitize, rules, globalRules);
  }

  return dataToSanitize;
};
```

`cleanObject` gains the `clean: StringCleaner` parameter and calls `walkSanitize(item, ruleForItem, globalRules, clean, depth + 1)`; `cleanArray` is folded into the array branch above. Add `export` to `DeepSanitizerRule`, `DeepData`, `MAX_SANITIZE_DEPTH`, `isPlaintextRule`, `isRule`, `getEffectiveRuleForString`, `cloneSanitizerConfig`, `mergeTagRules`, `wrapFunctionRule`.

In `src/components/utils/sanitizer.ts`, delete the moved ranges and add:

```ts
import {
  cloneSanitizerConfig, getEffectiveRuleForString, isPlaintextRule, isRule, MAX_SANITIZE_DEPTH, mergeTagRules,
  walkSanitize, wrapFunctionRule, type DeepData, type DeepSanitizerRule,
} from '../../shared/sanitize-walk';
```

and in `sanitizeBlocks` (line 107) replace `deepSanitize(block.data, rules, globalSanitizer)` with `walkSanitize(block.data, rules, globalSanitizer, cleanOneItem)`. `cleanOneItem` (lines 268-297) stays in this file; its signature already matches `StringCleaner`. Remove now-unused imports the linter flags.

- [ ] **Step 4: Run the new test and every test that imports the sanitizer**

Run: `yarn test test/unit/shared/sanitize-walk.test.ts`
Expected: PASS (3 tests).
Run: `for f in $(grep -rl "utils/sanitizer'" test/unit); do yarn test "$f" || break; done`
Expected: every run PASS (35 files at the time of writing). This is the guard that the move changed nothing.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/shared/sanitize-walk.ts src/components/utils/sanitizer.ts test/unit/shared/sanitize-walk.test.ts
git add src/shared/sanitize-walk.ts src/components/utils/sanitizer.ts test/unit/shared/sanitize-walk.test.ts
git commit -m "refactor(sanitizer): share the deep-sanitize walk with headless runtimes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: Headless ports, the stored-document loader, and the `src/mcp/` view-entry exception

**Files:**
- Create: `src/view/agent-runtime.ts`
- Modify: `test/unit/architecture/view-entry-law.test.ts` (extract a pure checker; add the `src/mcp/` exception and its guard)
- Test: `test/unit/view/agent-runtime.test.ts` (node), `test/unit/view/agent-runtime.parity.test.ts` (jsdom), the law file

**Interfaces:**
- Consumes: `walkSanitize`, `getEffectiveRuleForString`, `isPlaintextRule` (Task 18); `sanitizeHtmlFragment` (`src/view/sanitize.ts:767`); `htmlToSegmentsNode` (`src/view/rich-text-parse5.ts:39`); `outputBlocksToSegments` (`src/shared/rich-text/block-data.ts:165`); `markdownToBlocksWithReport` (`src/markdown/index.ts:198`); `blocksToMarkdownWithReport` (`src/view/blocks-to-markdown.ts:258`); `hasUnsafeUrlProtocol` (`src/shared/url-policy.ts:27`).
- Produces:
  - `createHeadlessPorts(input: { sanitizeFor(type: string): SanitizerConfig | undefined; richTextFieldsFor(type: string): string[]; globalSanitizer?: SanitizerConfig; openPageDocument?: AgentPorts['openPageDocument']; newId?: () => string }): AgentPorts`.
  - `loadStoredDocument(doc: OutputData, richTextFieldsFor: (type: string) => string[]): OutputData` (rich-field HTML → segments; `title` / `icon` kept).
  - No minter of its own: `newId` defaults to `mintId` from `src/shared/mint-id.ts` (**02** Task 14; 10 chars, URL-safe, `crypto` when present, else `Math.random`, so it runs in Jint).
  - Markdown warnings become `{ code: 'MARKDOWN_DEGRADED', message: '<construct> <action>: <detail>' }`.
  - View-entry law: `src/mcp/**` may import `src/view/**`; no module outside `src/mcp/` may import `src/mcp/**` (06 C13; 04 relies on it).

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/view/agent-runtime.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHeadlessPorts, loadStoredDocument } from '../../../src/view/agent-runtime';

const fields = (type: string): string[] => (type === 'paragraph' ? ['text'] : []);
const ports = createHeadlessPorts({ sanitizeFor: type => (type === 'paragraph' ? { text: { b: true, a: { href: true } } } : undefined), richTextFieldsFor: fields });

describe('headless agent ports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sanitizes rich segments through the tool rule and gives segments back', () => {
    const out = ports.sanitizeBlockData('paragraph', { text: [
      { text: 'ok', marks: { bold: true } },
      { text: 'gone', marks: { italic: true } },
      { text: 'bad', marks: { link: { href: 'javascript:alert(1)' } } },
    ] });

    expect(out.text).toEqual([{ text: 'ok', marks: { bold: true } }, { text: 'gonebad' }]);
  });

  it('strips unsafe URLs even for a tool with no rules', () => {
    expect(ports.sanitizeBlockData('embed', { html: '<a href="javascript:x">x</a>' }).html).not.toMatch(/javascript:/);
  });

  it('loads HTML rich fields as segments and keeps page fields', () => {
    expect(loadStoredDocument({ title: 'T', blocks: [{ id: 'p', type: 'paragraph', data: { text: 'a <b>b</b>' } }] }, fields)).toEqual({
      title: 'T', blocks: [{ id: 'p', type: 'paragraph', data: { text: [{ text: 'a ' }, { text: 'b', marks: { bold: true } }] } }],
    });
  });

  it('converts Markdown with segments and degradation warnings', async () => {
    const { blocks, warnings } = await ports.markdownToBlocks('**hi**\n\n<div>x</div>');

    expect(blocks[0].data.text).toEqual([{ text: 'hi', marks: { bold: true } }]);
    expect(warnings.every(item => item.code === 'MARKDOWN_DEGRADED')).toBe(true);
  });

  it('mints ids with the shared minter', () => {
    expect(ports.newId()).toMatch(/^[A-Za-z0-9_-]{10}$/);
  });
});
```

```ts
// test/unit/view/agent-runtime.parity.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sanitizeBlocks } from '../../../src/components/utils/sanitizer';
import { htmlToSegmentsDom } from '../../../src/components/utils/rich-text-dom';
import { segmentsToHtml } from '../../../src/shared/rich-text/segments-to-html';
import { createHeadlessPorts } from '../../../src/view/agent-runtime';
import type { RichText, SanitizerConfig } from '../../../types';

const rule: SanitizerConfig = { b: true, i: true, a: { href: true, target: '_blank', rel: 'nofollow' }, mark: { class: true } };
const CASES: RichText[] = [
  [{ text: 'plain' }],
  [{ text: 'b', marks: { bold: true } }, { text: 'i', marks: { italic: true } }],
  [{ text: 'u', marks: { underline: true } }],
  [{ text: 'l', marks: { link: { href: 'https://x.com', target: '_blank' } } }],
  [{ text: 'x', marks: { link: { href: 'javascript:alert(1)' } } }],
  [{ text: 'h', marks: { highlight: true } }],
  [{ embed: { equation: { expression: 'x^2' } } }],
];

/**
 * The editor's path (DOM sanitizer) and the headless path (parse5) must keep
 * the same segments for the same tool rule.
 */
describe('headless sanitize matches the editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(CASES.map((value, i) => [i, value] as const))('case %i', (_i, value) => {
    const editor = sanitizeBlocks([{ tool: 'paragraph', data: { text: segmentsToHtml(value) } }], { text: rule })[0].data.text as string;
    const headless = createHeadlessPorts({ sanitizeFor: () => ({ text: rule }), richTextFieldsFor: () => ['text'] }).sanitizeBlockData('paragraph', { text: value });

    expect(headless.text).toEqual(htmlToSegmentsDom(editor));
  });
});
```

In `test/unit/architecture/view-entry-law.test.ts`, add a pure checker and its unit test before the existing `it` blocks:

```ts
/** Offenders against the view and mcp entry rules, for given files. */
export const entryOffenders = (files: Array<{ path: string; text: string }>, src: string): string[] => {
  const inside = (file: string, dir: string): boolean => file.startsWith(`${src}${sep}${dir}${sep}`);
  const importsDir = (file: { path: string; text: string }, dir: string): boolean =>
    [...file.text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]*)['"]/g)]
      .some(match => `${resolve(dirname(file.path), match[1])}${sep}`.startsWith(`${src}${sep}${dir}${sep}`));

  return files.filter(file =>
    (!inside(file.path, 'view') && !inside(file.path, 'migrate') && !inside(file.path, 'mcp') && importsDir(file, 'view'))
    || (!inside(file.path, 'mcp') && importsDir(file, 'mcp'))).map(file => file.path);
};

it('lets src/mcp/ import the view graph, and nothing else import src/mcp/', () => {
  const src = resolve('/repo/src');

  expect(entryOffenders([
    { path: `${src}/mcp/server.ts`, text: "import { createHeadlessPorts } from '../view/agent-runtime';" },
    { path: `${src}/components/x.ts`, text: "import { start } from '../mcp/server';" },
    { path: `${src}/components/y.ts`, text: "import { invoke } from '../view/server-runtime';" },
  ], src)).toEqual([`${src}/components/x.ts`, `${src}/components/y.ts`]);
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `yarn test test/unit/view/agent-runtime.test.ts test/unit/view/agent-runtime.parity.test.ts test/unit/architecture/view-entry-law.test.ts`
Expected: FAIL — `Failed to resolve import "../../../src/view/agent-runtime"`, and the law's new case fails until `entryOffenders` exists and knows `mcp`.

- [ ] **Step 3: Write the ports and the loader**

```ts
// src/view/agent-runtime.ts
import type { AgentWarning } from '../../types/agent';
import type { SanitizerConfig } from '../../types';
import type { OutputBlockData, OutputData } from '../../types/data-formats/output-data';
import { markdownToBlocksWithReport } from '../markdown';
import { outputBlocksToSegments } from '../shared/rich-text/block-data';
import { isRichText } from '../shared/rich-text/guards';
import { segmentsToHtml } from '../shared/rich-text/segments-to-html';
import type { AgentPorts } from '../shared/agent/types';
import { getEffectiveRuleForString, isPlaintextRule, walkSanitize, type DeepData, type StringCleaner } from '../shared/sanitize-walk';
import { hasUnsafeUrlProtocol } from '../shared/url-policy';
import { blocksToMarkdownWithReport } from './blocks-to-markdown';
import { htmlToSegmentsNode } from './rich-text-parse5';
import { sanitizeHtmlFragment } from './sanitize';
import { mintId } from '../shared/mint-id';

// Same pattern as the non-DOM branch of stripUnsafeUrls (src/components/utils/sanitizer.ts:349-357);
// that module also loads html-janitor, which the server bundle must not carry.
const URL_ATTR = /\s*(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/gi;
const stripUnsafeUrlAttributes = (html: string): string => (html.indexOf('<') === -1 ? html : html.replace(URL_ATTR,
  (match, attribute: string, dq?: string, sq?: string, uq?: string) => (hasUnsafeUrlProtocol(dq ?? sq ?? uq ?? '', attribute.toLowerCase()) ? '' : match)));

const cleanHeadless: StringCleaner = (value, rule, globalRules) => {
  if (isPlaintextRule(rule)) {
    return value;
  }

  const effective = getEffectiveRuleForString(rule, globalRules);

  return effective === null ? stripUnsafeUrlAttributes(value) : sanitizeHtmlFragment(value, effective);
};

const isEmptyRules = (rules: unknown): boolean => typeof rules === 'object' && rules !== null && Object.keys(rules).length === 0;

const urlsOnly = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return stripUnsafeUrlAttributes(value);
  }
  if (Array.isArray(value)) {
    return value.map(urlsOnly);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, urlsOnly(item)]));
  }

  return value;
};

export const loadStoredDocument = (doc: OutputData, richTextFieldsFor: (type: string) => string[]): OutputData => ({
  ...doc,
  blocks: outputBlocksToSegments(doc.blocks, richTextFieldsFor, htmlToSegmentsNode),
});

export const createHeadlessPorts = (input: {
  sanitizeFor(type: string): SanitizerConfig | undefined;
  richTextFieldsFor(type: string): string[];
  globalSanitizer?: SanitizerConfig;
  openPageDocument?: AgentPorts['openPageDocument'];
  newId?: () => string;
}): AgentPorts => {
  const global = input.globalSanitizer ?? {};

  return {
    htmlToSegments: htmlToSegmentsNode,
    sanitizeBlockData: (type, data) => {
      const rich = input.richTextFieldsFor(type);
      const html: Record<string, unknown> = Object.fromEntries(Object.entries(data).map(([key, value]) =>
        [key, rich.includes(key) && isRichText(value) ? segmentsToHtml(value) : value]));
      const rules = input.sanitizeFor(type) ?? {};
      // Mirrors sanitizeBlocks: no tool rule and no global rule means URL hardening only.
      const cleaned = (isEmptyRules(rules) && isEmptyRules(global) ? urlsOnly(html) : walkSanitize(html as DeepData, rules, global, cleanHeadless)) as Record<string, unknown>;

      return Object.fromEntries(Object.entries(cleaned).map(([key, value]) =>
        [key, rich.includes(key) && typeof value === 'string' ? htmlToSegmentsNode(value) : value]));
    },
    markdownToBlocks: async (md) => {
      const { blocks, warnings } = await markdownToBlocksWithReport(md);

      return {
        blocks: outputBlocksToSegments(blocks, input.richTextFieldsFor, htmlToSegmentsNode),
        warnings: warnings.map((item): AgentWarning => ({ code: 'MARKDOWN_DEGRADED', message: `${item.construct} ${item.action}: ${item.detail}` })),
      };
    },
    blocksToMarkdown: (doc) => {
      const { markdown, warnings } = blocksToMarkdownWithReport(doc);

      return { markdown, warnings: warnings.map((item): AgentWarning => ({ code: 'MARKDOWN_DEGRADED', message: `${item.construct} ${item.action}: ${item.detail}` })) };
    },
    newId: input.newId ?? (() => mintId()),
    ...(input.openPageDocument !== undefined && { openPageDocument: input.openPageDocument }),
  };
};

export type { OutputBlockData };
```

In `view-entry-law.test.ts`, change the existing "no module outside src/view/ imports from src/view/" filter to also skip `src/mcp/` modules (`&& !file.startsWith(\`${srcDir}${sep}mcp${sep}\`)`), and add:

```ts
  it('no module outside src/mcp/ imports from src/mcp/', () => {
    const mcpDir = `${srcDir}${sep}mcp${sep}`;
    const offenders = sourceFiles.filter(file => !file.startsWith(mcpDir) && relativeImports(file).some(target => `${target}${sep}`.startsWith(mcpDir)));

    expect(offenders).toEqual([]);
  });
```

Update the law's doc comment: "The exceptions are `src/migrate/` and `src/mcp/` (the `@bloklabs/mcp` bundle, 06 C13); no other module may import either."

- [ ] **Step 4: Run them to make sure they pass**

Run: `yarn test test/unit/view/agent-runtime.test.ts`
Expected: PASS (5 tests). **Unverified before this run:** that `markdownToBlocksWithReport` reports `<div>` HTML as a degradation and that `blocksToMarkdownWithReport` reads segment-shaped rich fields. If the first assertion about warnings is vacuous (empty list), keep it; if `blocksToMarkdownWithReport` needs HTML, convert with `outputBlocksToHtml` (`src/shared/rich-text/block-data.ts:158`) inside `blocksToMarkdown` and add a test case that exports a bold segment as `**…**`.
Run: `yarn test test/unit/view/agent-runtime.parity.test.ts`
Expected: PASS (7 cases). A failing case is a real headless/editor drift: fix `cleanHeadless`, never the expectation.
Run: `yarn test test/unit/architecture/view-entry-law.test.ts test/unit/view/index.purity.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/view/agent-runtime.ts test/unit/view/agent-runtime.test.ts test/unit/view/agent-runtime.parity.test.ts test/unit/architecture/view-entry-law.test.ts
git add src/view/agent-runtime.ts test/unit/view/agent-runtime.test.ts test/unit/view/agent-runtime.parity.test.ts test/unit/architecture/view-entry-law.test.ts
git commit -m "feat(agent): headless ports on parse5 and the src/mcp view-entry exception

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 20: Purity and silent-failure laws

**Files:**
- Create: `test/unit/architecture/agent-purity-law.test.ts`, `test/unit/architecture/agent-silent-failure-law.test.ts`

**Interfaces:**
- Consumes: the files of Tasks 2–17.
- Produces: two law tests. The silent-failure law also scans `src/components/modules/agent/` (empty until Phase 2; the scan must still find at least the `src/shared/agent/` files).

- [ ] **Step 1: Write the law tests**

```ts
// test/unit/architecture/agent-purity-law.test.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = resolve(__dirname, '../../../src/shared/agent');
const files = readdirSync(dir).filter(name => name.endsWith('.ts')).map(name => ({ name, text: readFileSync(join(dir, name), 'utf-8') }));

/**
 * LAW: the planner runs in the browser, in Node and in Jint. Its own files
 * import nothing DOM-bound or parse5-bound, and touch no browser global.
 * Direct imports only: shared helpers it imports carry their own purity tests.
 */
describe('agent purity law', () => {
  it('scans the planner (non-vacuity)', () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it.each(files.map(file => [file.name, file.text] as const))('%s imports no editor, tool, view or parse5 module', (_name, text) => {
    const specifiers = [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(match => match[1]);

    expect(specifiers.filter(spec => /(^|\/)(components|tools|view)\//.test(spec) || spec === 'parse5')).toEqual([]);
  });

  it.each(files.map(file => [file.name, file.text] as const))('%s touches no browser global', (_name, text) => {
    expect(text).not.toMatch(/\b(window|document|navigator|localStorage)\s*[.[]/);
  });
});
```

```ts
// test/unit/architecture/agent-silent-failure-law.test.ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../../src');
const dirs = ['shared/agent', 'components/modules/agent'].map(d => join(root, d)).filter(existsSync);
const files = dirs.flatMap(d => readdirSync(d).filter(n => n.endsWith('.ts')).map(n => ({ name: n, text: readFileSync(join(d, n), 'utf-8') })));

/** Every "nothing" return here is part of a typed contract, not a swallowed failure. */
const EXEMPT: Record<string, { count: number; reason: string }> = {
  'snapshot.ts': { count: 2, reason: 'cellOf: null = "not in a cell"; cellsOf: [] = "this block has no grid"; both valid answers' },
  'placement-rules.ts': { count: 4, reason: 'null = "no refusal"' },
};

/**
 * LAW: agent code never fails quietly. It returns an AgentError or an
 * AgentWarning instead of logging, or returning null / [] to mean "it failed".
 */
describe('agent silent-failure law', () => {
  it('scans the agent code (non-vacuity)', () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it.each(files.map(f => [f.name, f.text] as const))('%s does not log', (_name, text) => {
    expect(text).not.toMatch(/\bconsole\.(warn|error|log|info)\(/);
  });

  it.each(files.map(f => [f.name, f.text] as const))('%s returns null or [] only where exempted', (name, text) => {
    const count = (text.match(/return (null|\[\]);/g) ?? []).length;

    expect(count).toBe(EXEMPT[name]?.count ?? 0);
  });
});
```

- [ ] **Step 2: Run them**

Run: `yarn test test/unit/architecture/agent-purity-law.test.ts test/unit/architecture/agent-silent-failure-law.test.ts`
Expected: PASS if Tasks 2–17 followed the plan. If a count differs, read each `return null;` / `return [];` in that file: either it is a valid answer (fix the count and keep the reason accurate) or it hides a failure (replace it with a `failure(...)` or a warning). Then mutation-check the law: temporarily add `console.warn('x');` to `src/shared/agent/names.ts`, rerun, see it FAIL, and revert.

- [ ] **Step 3: Commit**

```bash
npx eslint test/unit/architecture/agent-purity-law.test.ts test/unit/architecture/agent-silent-failure-law.test.ts
git add test/unit/architecture/agent-purity-law.test.ts test/unit/architecture/agent-silent-failure-law.test.ts
git commit -m "test(architecture): agent purity and silent-failure laws

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

These are law tests over code already written, so they pass on first run; the mutation check in Step 2 is the "watch it fail" step.

---

### Task 21: Built-in contract wiring, and 01's cases in 05's parity corpus

Parity is 05's (06 C1, §7.5). 05 owns the corpus format, the loader, the normalizer, the goldens and the `json` / `store` / Playwright `editor` / `jint` / `room` runners (05 Tasks 6–8, 11–13). This task builds the headless setup every runner uses and adds 01's cases to that corpus. It writes no runner, no normalizer and no golden.

**Files:**
- Modify: `src/view/agent-runtime.ts` (add `createHeadlessAgentSetup`)
- Create: `test/unit/view/agent-setup.test.ts` (node), `test/fixtures/agent-commands/cases/01-<name>.json` (one per case below, 05's `ParityCase` format)

**Interfaces:**
- Consumes (**02**): `buildToolManifest(snapshot, overrides?)` (02 Task 5), `buildAgentContract(manifest, COMMANDS, where)` (02 Task 6), `buildBuiltInSnapshot({ blokVersion, readOnly?, services? })` (02 Task 27), `snapshotWithCustomTools(base, file?)` and `runtimesWithCustomTools(base, file?)` (02 Task 29), `BUILT_IN_TOOL_RUNTIMES` (02 Task 13). `getBlokVersion()` (`src/components/utils/version.ts`).
- Consumes (**05**): the corpus format and loader (05 Task 6: `ParityCase { name, seed, batches, expect?, expectByRunner? }`, `test/fixtures/agent-commands/cases/*.json`).
- Produces:
  - `createHeadlessAgentSetup(options?: { customTools?: BlokCustomToolsFile; overrides?: ManifestOverrides; services?: HostService[]; runtime?: 'node' | 'jint' | 'node-live'; globalSanitizer?: SanitizerConfig; openPageDocument?: AgentPorts['openPageDocument'] }): { contract: AgentContract; tools: ToolRuntimeRegistry; ports: AgentPorts; richTextFieldsFor(type: string): string[] }` — used by 04 (Node MCP), by Task 37 (Jint), and by 05's harness (`nodeContract`, `openJsonSession`, `openStoreSession`).
  - 14 corpus cases named `01-<name>` (the list below).

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/view/agent-setup.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHeadlessAgentSetup } from '../../../src/view/agent-runtime';

describe('createHeadlessAgentSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds a contract with the core commands and the built-in tools', () => {
    const setup = createHeadlessAgentSetup();
    const names = setup.contract.commands.map(entry => entry.name);

    expect(names).toContain('block.insert');
    expect(setup.contract.manifest.blocks.some(entry => entry.name === 'table')).toBe(true);
    expect(setup.tools.get('paragraph')?.sanitize).toBeDefined();
    expect(setup.richTextFieldsFor('paragraph')).toEqual(['text']);
  });

  // Only core commands here: tool actions (table.create, page.rename) land with 02 Tasks 31-49,
  // which this task does not wait for. 05's corpus and 04's contract tests cover them later.
  it('marks undo unavailable in a live room and available in a stored one', () => {
    const entry = (runtime: 'node' | 'node-live') => createHeadlessAgentSetup({ runtime }).contract.commands.find(item => item.name === 'history.undo');

    expect(entry('node-live')).toMatchObject({ available: false, unavailableReason: 'runtime' });
    expect(entry('node')).toMatchObject({ available: true });
  });

  it('adds a custom tool from a BlokCustomToolsFile', () => {
    const setup = createHeadlessAgentSetup({ customTools: { formatVersion: 1, blocks: [{
      name: 'rating',
      description: { summary: 'A star rating.', data: { type: 'object', properties: { stars: { type: 'integer', minimum: 0, maximum: 5 } } } },
      statics: {} as never,
    }] } });

    expect(setup.contract.manifest.blocks.some(entry => entry.name === 'rating')).toBe(true);
    expect(setup.tools.has('rating')).toBe(true);
  });
});
```

**Unverified:** the minimum `statics` a `BlokCustomToolsFile` block needs (02 Task 29 `readCustomToolsFile` defines it). Copy a valid file from 02 Task 29's test instead of `{} as never` if the cast is refused.

Run: `yarn test test/unit/view/agent-setup.test.ts`
Expected: FAIL with `createHeadlessAgentSetup` not exported.

- [ ] **Step 2: Write `createHeadlessAgentSetup`**

Append to `src/view/agent-runtime.ts`:

```ts
import { COMMANDS } from '../shared/agent/commands';
import { buildAgentContract, buildToolManifest } from '../shared/tool-manifest';
import { buildBuiltInSnapshot } from '../shared/built-in-snapshot';
import { runtimesWithCustomTools, snapshotWithCustomTools } from '../shared/custom-tools-file';
import { BUILT_IN_TOOL_RUNTIMES } from '../shared/tool-actions';
import { getBlokVersion } from '../components/utils/version';
import type { AgentContract, BlokCustomToolsFile, HostService, ManifestOverrides } from '../../types/tool-manifest';

export const createHeadlessAgentSetup = (options: {
  customTools?: BlokCustomToolsFile;
  overrides?: ManifestOverrides;
  services?: HostService[];
  runtime?: 'node' | 'jint' | 'node-live';
  globalSanitizer?: SanitizerConfig;
  openPageDocument?: AgentPorts['openPageDocument'];
} = {}) => {
  const services = options.services ?? [];
  const snapshot = snapshotWithCustomTools(buildBuiltInSnapshot({ blokVersion: getBlokVersion(), services }), options.customTools);
  const manifest = buildToolManifest(snapshot, options.overrides);
  const contract: AgentContract = buildAgentContract(manifest, COMMANDS, { runtime: options.runtime ?? 'node', services });
  // Per-registry effective rules (06 R2-02-1); the global sanitizer stays a separate port argument (02 Task 13).
  const tools = runtimesWithCustomTools(BUILT_IN_TOOL_RUNTIMES, options.customTools);
  const richTextFieldsFor = (type: string): string[] => manifest.blocks.find(entry => entry.name === type)?.richTextFields ?? [];
  const ports = createHeadlessPorts({
    sanitizeFor: type => tools.get(type)?.sanitize,
    richTextFieldsFor,
    globalSanitizer: options.globalSanitizer,
    openPageDocument: options.openPageDocument,
  });

  return { contract, tools, ports, richTextFieldsFor };
};
```

Paths are 02's: `buildBuiltInSnapshot` in `src/shared/built-in-snapshot.ts` (02 Task 27), `snapshotWithCustomTools` / `runtimesWithCustomTools` in `src/shared/custom-tools-file.ts` (02 Task 29), `BUILT_IN_TOOL_RUNTIMES` in `src/shared/tool-actions/index.ts` (02 Task 13). Names and paths read from 02's plan; confirm against `main` before writing. `getBlokVersion` reads a build-time `VERSION` define (`src/components/utils/version.ts:15-30`); the server-runtime build defines it (`scripts/build-server-runtime.mjs:87`).

Run: `yarn test test/unit/view/agent-setup.test.ts`
Expected: PASS.

- [ ] **Step 3: Add 01's cases to 05's corpus**

Gated on 05 Task 6 (corpus format and loader) being on `main`. Write one JSON file per case under `test/fixtures/agent-commands/cases/`, named `01-<name>.json`, in 05's format: `{ "name": "01-<name>", "seed": <PARITY_SEED below>, "batches": [<batch>] }`. Every case below expects `ok` on every runner. 05's format has no `skip` or `ignoreFields`: a runner that legitimately refuses a case gets `"expectByRunner": { "<runner>": { "errorCode": "<CODE>" } }`, and a tool-minted field goes in 05's `TOOL_MINTED` with a reason (05 Task 6). The source data, as TypeScript for reading only:

```ts
export const PARITY_SEED: OutputData = {
  title: 'Seed',
  blocks: [
    { id: 'h', type: 'header', data: { text: [{ text: 'Title' }], level: 2 } },
    { id: 'p', type: 'paragraph', data: { text: [{ text: 'Hello world' }] } },
    { id: 'tg', type: 'toggle', data: { text: [{ text: 'More' }] }, content: ['k'] },
    { id: 'k', type: 'paragraph', data: { text: [{ text: 'inside' }] }, parent: 'tg' },
    { id: 'q', type: 'quote', data: { text: [{ text: 'Q' }] } },
  ],
};

export const PARITY_CASES: ParityCase[] = [
  { name: 'insert-leaf', batch: { commands: [{ name: 'block.insert', args: { id: 'n1', type: 'paragraph', data: { text: 'new' }, position: { after: 'h' } } }] } },
  { name: 'insert-tree', batch: { commands: [{ name: 'block.insert', args: { id: 't1', type: 'toggle', data: { text: 'T' }, children: [{ id: 't2', type: 'paragraph', data: { text: 'child' } }] } }] } },
  { name: 'insert-columns-default', batch: { commands: [{ name: 'block.insert', args: { id: 'cl', type: 'column_list' } }] }, ignoreFields: { column_list: [], column: [] } },
  { name: 'update-merge-and-null', batch: { commands: [{ name: 'block.update', args: { id: 'h', data: { level: 3 } } }] } },
  { name: 'delete-lifts-children', batch: { commands: [{ name: 'block.delete', args: { id: 'tg' } }] } },
  { name: 'delete-everything', batch: { commands: ['h', 'p', 'tg', 'k', 'q'].map(id => ({ name: 'block.delete' as const, args: { id } })) } },
  { name: 'move-into-toggle', batch: { commands: [{ name: 'block.move', args: { id: 'q', parentId: 'tg', position: 'start' } }] } },
  { name: 'convert-paragraph-to-header', batch: { commands: [{ name: 'block.convert', args: { id: 'p', type: 'header', data: { level: 3 } } }] } },
  { name: 'duplicate-toggle', batch: { commands: [{ name: 'block.duplicate', args: { id: 'tg' } }] } },
  { name: 'text-format-bold', batch: { commands: [{ name: 'text.format', args: { id: 'p', range: { find: 'world' }, set: { bold: true } } }] } },
  { name: 'text-insert-delete-replace', batch: { commands: [
    { name: 'text.insert', args: { id: 'p', at: 5, text: ',' } },
    { name: 'text.delete', args: { id: 'k', range: 'all' } },
    { name: 'text.replace', args: { id: 'q', with: [{ text: 'R', marks: { italic: true } }] } },
  ] } },
  { name: 'refs', batch: { commands: [
    { name: 'block.insert', args: { id: 'r1', type: 'toggle', data: { text: 'R' } }, ref: 'r' },
    { name: 'block.insert', args: { id: 'r2', type: 'paragraph', data: { text: 'in r' }, parentId: '$r' } },
  ] } },
  { name: 'doc-title-icon-set', batch: { commands: [{ name: 'doc.setTitle', args: { title: 'Launch' } }, { name: 'doc.setIcon', args: { icon: { type: 'emoji', value: '🚀' } } }] } },
  { name: 'doc-title-icon-clear', batch: { commands: [{ name: 'doc.setTitle', args: { title: '' } }, { name: 'doc.setIcon', args: { icon: null } }] } },
];
```

Do not write goldens here. 05 Task 7's `json` runner writes them with `reviewed: false`, and a person reviews each one (05 Review Focus 3). Read each golden against its batch then: `01-text-format-bold` must hold `{ "text": "world", "marks": { "bold": true } }`; `01-delete-lifts-children` must list `k` at the root where `tg` was; `01-duplicate-toggle` must hold two relabelled ids. A wrong golden is a planner bug: fix the planner, delete the file, regenerate.

Run: `yarn test test/unit/agent/parity/normalize.test.ts` (05 Task 6's test; it loads the corpus)
Expected: PASS. Then check by hand that `loadParityCases()` (`test/unit/agent/parity/corpus.ts`) lists the 14 `01-*` cases.

- [ ] **Step 4: Lint and commit**

```bash
npx eslint src/view/agent-runtime.ts test/unit/view/agent-setup.test.ts
git add src/view/agent-runtime.ts test/unit/view/agent-setup.test.ts test/fixtures/agent-commands/cases/01-*.json
git commit -m "feat(agent): headless agent setup over the built-in contract; 01 cases in the parity corpus

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Checkpoint 1

- [ ] `for f in test/unit/shared/agent/*.test.ts test/unit/shared/sanitize-walk.test.ts test/unit/view/agent-runtime*.test.ts test/unit/view/agent-setup.test.ts test/unit/architecture/agent-*.test.ts test/unit/architecture/view-entry-law.test.ts test/unit/architecture/published-types-no-src-refs.test.ts; do yarn test "$f" || break; done` — all PASS. Then 05 Task 7 (`json` runner and goldens) can start.
- [ ] `NODE_OPTIONS=--max-old-space-size=8192 yarn lint:types` — PASS.
- [ ] `git pull --rebase && git push` — succeeds; `git status` says "up to date with origin".
- [ ] Tell plans 02, 04 and 05 that `COMMANDS`, the published types, `createDocumentAgentSession`, `createHeadlessAgentSetup` and the `01-*` corpus cases are on `main`.

---
## Phase 2 — EditorApplier

### Task 22: BREAKING (D5) — public `blocks.convert()` sanitizes its overrides

**Files:**
- Modify: `src/components/modules/api/blocks.ts:792`
- Test: `test/unit/components/modules/api/blocks-insert-sanitize.test.ts` (add a `blocks.convert` case to the `describe.each` at line 93)

**Interfaces:**
- Consumes: `hostDataForTool` (`src/components/modules/api/blocks.ts:961-978`).
- Produces: `blocks.convert(id, type, overrides)` runs `overrides` through the same path as `insert` / `update` (tool + global sanitize, unsafe URL strip). `EditorApplier` (Task 27) relies on this for `replaceType` and has no sanitize step of its own (06 R3-4).

This is a published behaviour change (06 D5; `convert` shipped in `v1.16.1`, the unsanitized call was at `api/blocks.ts:748` at the tag). **Tell the user in your reply when you make this commit**: what breaks (markup in `convert` overrides outside the target tool's rules is now stripped), who it breaks for (hosts that pass such markup), and the migration (widen the tool's `sanitize` or the global `sanitizer` config).

- [ ] **Step 1: Write the failing regression test**

In `test/unit/components/modules/api/blocks-insert-sanitize.test.ts`, add `convert: (id: string, type: string, data?: Record<string, unknown>) => Promise<{ id: string }>;` to `TestEditor['blocks']` (line 18), and add this case inside the `describe.each` block (after the `blocks.update` case at line 135):

```ts
    it('blocks.convert overrides', async () => {
      const instance = await boot(one());

      await instance.blocks.convert('p', 'header', { text });

      await expectInert(instance);
    });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `yarn test test/unit/components/modules/api/blocks-insert-sanitize.test.ts -t "blocks.convert overrides"`
Expected: FAIL in both the `html` and `segments` runs — an `[onerror]` element or a `javascript:` href survives. If it PASSES, stop: the bug (06 B1, verified only by reading) does not reproduce, and the BREAKING change must not ship. Report back instead.

- [ ] **Step 3: Fix it**

In `src/components/modules/api/blocks.ts`, line 792, change:

```ts
      const newBlock = await BlockManager.convert(blockToConvert, newType, dataOverrides === undefined ? dataOverrides : this.richTextToHtml(newType, dataOverrides));
```

to:

```ts
      const newBlock = await BlockManager.convert(blockToConvert, newType, dataOverrides === undefined ? dataOverrides : this.hostDataForTool(newType, dataOverrides));
```

Delete the comment above it only if it no longer says something true ("Overrides reach the Yjs document before the factory converts anything" is still true; keep it).

- [ ] **Step 4: Run it and the convert tests**

Run: `yarn test test/unit/components/modules/api/blocks-insert-sanitize.test.ts`
Expected: PASS.
Run: `for f in $(grep -rl "blocks.convert\|\.convert(" test/unit/components/modules/api test/unit/api 2>/dev/null); do yarn test "$f" || break; done`
Expected: every run PASS. A failing existing test that passed markup on purpose is the breaking change showing: update it only if the stripped markup is outside the target tool's rules, and list it in the commit body.

- [ ] **Step 5: Commit on its own**

```bash
npx eslint src/components/modules/api/blocks.ts test/unit/components/modules/api/blocks-insert-sanitize.test.ts
git add src/components/modules/api/blocks.ts test/unit/components/modules/api/blocks-insert-sanitize.test.ts
git commit -m "fix(api)!: BREAKING blocks.convert sanitizes its data overrides

BREAKING CHANGE: blocks.convert(id, type, overrides) now sanitizes overrides.
Old behaviour: overrides were written into the block unsanitized (only segments were turned into HTML).
New behaviour: overrides go through hostDataForTool (tool + global sanitize, unsafe URL strip), like insert and update.
Migration: a host that passes markup outside the target tool's sanitize rules must widen those rules (the tool's sanitize or the global sanitizer config), or the markup is stripped.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 23: Editor ports

**Files:**
- Modify: `src/components/modules/api/blocks.ts:961` (`private hostDataForTool` → `public`), `src/markdown/blocks-to-markdown.ts` (export a report variant)
- Create: `src/components/modules/agent/editor-ports.ts`
- Test: `test/unit/components/modules/agent/editor-ports.test.ts`

**Interfaces:**
- Consumes: `BlocksAPI.hostDataForTool` (now public on the module class, not on `methods`, so the public API is unchanged); `htmlToSegmentsDom` (`src/components/utils/rich-text-dom.ts:32`); `outputBlocksToSegments`, `outputBlocksToHtml` (`src/shared/rich-text/block-data.ts:158`, `:165`); `serializeBlocksToMarkdown` (`src/markdown/blocks-to-markdown-core.ts:1500`); `generateBlockId` (`src/components/utils/id-generator.ts:17`).
- Produces:
  - `blocksToMarkdownWithReport(blocks: SerializableBlock[]): { markdown: string; warnings: MarkdownDegradation[] }` in `src/markdown/blocks-to-markdown.ts`.
  - `editorRichTextFieldsFor(Blok: BlokModules): (type: string) => string[]` (reads `BlockToolAdapter.richTextFields`, `src/components/tools/block.ts:555`).
  - `createEditorPorts(Blok: BlokModules): AgentPorts`.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/components/modules/agent/editor-ports.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Core } from '../../../../../src/components/core';
import { createEditorPorts } from '../../../../../src/components/modules/agent/editor-ports';
import { Header, Paragraph } from '../../../../../src/tools';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

let holder: HTMLDivElement;

const boot = async (): Promise<BlokModules> => {
  const core = new Core({ holder, tools: { paragraph: { class: Paragraph }, header: { class: Header as never } }, data: { blocks: [] } });

  await core.isReady;

  return core.moduleInstances as BlokModules;
};

describe('editor agent ports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    holder.remove();
    vi.restoreAllMocks();
  });

  it('sanitizes through hostDataForTool and gives segments back', async () => {
    const ports = createEditorPorts(await boot());
    const out = ports.sanitizeBlockData('paragraph', { text: [{ text: 'x', marks: { link: { href: 'javascript:alert(1)' } } }, { text: 'b', marks: { bold: true } }] });

    expect(JSON.stringify(out)).not.toMatch(/javascript:/);
    expect(out.text).toContainEqual({ text: 'b', marks: { bold: true } });
  });

  it('round-trips Markdown with segments', async () => {
    const ports = createEditorPorts(await boot());
    const { blocks } = await ports.markdownToBlocks('# Hi **there**');

    expect(blocks[0]).toMatchObject({ type: 'header', data: { text: [{ text: 'Hi ' }, { text: 'there', marks: { bold: true } }] } });
    expect(ports.blocksToMarkdown({ blocks }).markdown).toContain('**there**');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `yarn test test/unit/components/modules/agent/editor-ports.test.ts`
Expected: FAIL with `Failed to resolve import ".../editor-ports"`.

- [ ] **Step 3: Write the ports**

In `src/components/modules/api/blocks.ts` line 961, change `private hostDataForTool` to `public hostDataForTool` and add one comment line above the JSDoc: `// Public on the module (not on methods) for the agent's editor ports.`

Append to `src/markdown/blocks-to-markdown.ts`:

```ts
/** blocksToMarkdown plus what degraded on the way out. */
export const blocksToMarkdownWithReport = (blocks: SerializableBlock[]): { markdown: string; warnings: MarkdownDegradation[] } =>
  serializeBlocksToMarkdown(blocks, domInlineBackend);
```

(Import `MarkdownDegradation` as a type from `./blocks-to-markdown-core` if the file does not already.)

```ts
// src/components/modules/agent/editor-ports.ts
import type { AgentWarning } from '../../../../types/agent';
import type { OutputBlockData } from '../../../../types/data-formats/output-data';
import { blocksToMarkdownWithReport } from '../../../markdown/blocks-to-markdown';
import type { AgentPorts } from '../../../shared/agent/types';
import { outputBlocksToHtml, outputBlocksToSegments } from '../../../shared/rich-text/block-data';
import type { BlokModules } from '../../../types-internal/blok-modules';
import { generateBlockId } from '../../utils/id-generator';
import { htmlToSegmentsDom } from '../../utils/rich-text-dom';

export const editorRichTextFieldsFor = (Blok: BlokModules) => (type: string): string[] =>
  Blok.Tools.blockTools.get(type)?.richTextFields ?? [];

const degraded = (item: { construct: string; action: string; detail: string }): AgentWarning =>
  ({ code: 'MARKDOWN_DEGRADED', message: `${item.construct} ${item.action}: ${item.detail}` });

export const createEditorPorts = (Blok: BlokModules): AgentPorts => {
  const fieldsFor = editorRichTextFieldsFor(Blok);

  return {
    htmlToSegments: htmlToSegmentsDom,
    sanitizeBlockData: (type, data) => {
      const rich = fieldsFor(type);
      const cleaned = Blok.BlocksAPI.hostDataForTool(type, data) as Record<string, unknown>;

      return Object.fromEntries(Object.entries(cleaned).map(([key, value]) =>
        [key, rich.includes(key) && typeof value === 'string' ? htmlToSegmentsDom(value) : value]));
    },
    markdownToBlocks: async (md) => {
      const { markdownToBlocksWithReport } = await import('../../../markdown/index');
      const { blocks, warnings } = await markdownToBlocksWithReport(md);

      return { blocks: outputBlocksToSegments(blocks, fieldsFor, htmlToSegmentsDom), warnings: warnings.map(degraded) };
    },
    blocksToMarkdown: (doc) => {
      const blocks = outputBlocksToHtml(doc.blocks, fieldsFor);
      const parentOf = new Map(blocks.map((block): [string, string | null] => [block.id ?? '', block.parent ?? null]));
      const depthOf = (id: string | undefined, seen = new Set<string>()): number => {
        const parent = id === undefined ? null : parentOf.get(id) ?? null;

        return parent === null || seen.has(parent) ? 0 : 1 + depthOf(parent, seen.add(parent));
      };
      const { markdown, warnings } = blocksToMarkdownWithReport(blocks.map((block: OutputBlockData) => ({
        id: block.id, tool: block.type, data: block.data, parentId: block.parent ?? null,
        ...(block.content !== undefined && { contentIds: block.content }), indent: depthOf(block.id),
      })));

      return { markdown, warnings: warnings.map(degraded) };
    },
    newId: generateBlockId,
  };
};
```

The depth rule copies `exportMarkdown` (`src/components/modules/api/blocks.ts:478-513`), so agent export equals host export.

- [ ] **Step 4: Run it to make sure it passes**

Run: `yarn test test/unit/components/modules/agent/editor-ports.test.ts test/unit/components/modules/api/blocks-export-markdown.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/components/modules/agent/editor-ports.ts src/components/modules/api/blocks.ts src/markdown/blocks-to-markdown.ts test/unit/components/modules/agent/editor-ports.test.ts
git add src/components/modules/agent/editor-ports.ts src/components/modules/api/blocks.ts src/markdown/blocks-to-markdown.ts test/unit/components/modules/agent/editor-ports.test.ts
git commit -m "feat(agent): editor ports over hostDataForTool and the Markdown converters

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 24: Per-touched-block attribution and `BlockMutationEventDetail.agent`

**Files:**
- Modify: `types/events/block/Base.ts` (add `agent?`), `src/components/modules/blockManager/blockManager.ts:2691` (stamp) and `:2123-2128` (event detail), plus a new method
- Test: `test/unit/components/modules/blockManager/agent-attribution.test.ts`

**Interfaces:**
- Consumes: none new.
- Produces:
  - Published: `BlockMutationEventDetail.agent?: { id: string; name: string; turnId: string }` (06 D4, additive; `origin` stays `'local'`).
  - `BlockManager.attributeTo(scope: { ids: ReadonlySet<string>; actor: { id: string; name: string }; turnId: string }): () => void` — while set, a data write to a block whose id is in `ids` stamps `lastEditedBy = actor.id`; any other block keeps `config.user.id`. Mutation events for those ids carry `detail.agent`. The returned function releases the scope (only if it is still the current one).

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/components/modules/blockManager/agent-attribution.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Core } from '../../../../../src/components/core';
import { BlockChanged } from '../../../../../src/components/events';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

let holder: HTMLDivElement;

const boot = async (): Promise<BlokModules> => {
  const core = new Core({
    holder,
    user: { id: 'human-1', name: 'Human' },
    tools: { paragraph: { class: Paragraph } },
    data: { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'A' } }, { id: 'b', type: 'paragraph', data: { text: 'B' } }] },
  });

  await core.isReady;

  return core.moduleInstances as BlokModules;
};

const settle = async (Blok: BlokModules): Promise<void> => new Promise((resolve) => {
  Blok.YjsManager.onPendingBlockWritesSettled(resolve);
});

describe('agent attribution scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    holder.remove();
    vi.restoreAllMocks();
  });

  it('stamps the agent on touched blocks only, and tags their events', async () => {
    const Blok = await boot();
    const details: Array<Record<string, unknown>> = [];

    Blok.EventsAPI.methods.on(BlockChanged, ({ event }: { event: CustomEvent }) => details.push(event.detail as Record<string, unknown>));

    const release = Blok.BlockManager.attributeTo({ ids: new Set(['a']), actor: { id: 'agent-1', name: 'Agent' }, turnId: 't1' });

    await Blok.BlockManager.update(Blok.BlockManager.getBlockById('a') as never, { text: 'A2' });
    await Blok.BlockManager.update(Blok.BlockManager.getBlockById('b') as never, { text: 'B2' });
    await settle(Blok);
    release();

    const saved = Blok.YjsManager.toJSON();

    expect(saved.find(block => block.id === 'a')?.lastEditedBy).toBe('agent-1');
    expect(saved.find(block => block.id === 'b')?.lastEditedBy).toBe('human-1');
    expect(details.find(detail => (detail.target as { id: string }).id === 'a')).toMatchObject({ agent: { id: 'agent-1', name: 'Agent', turnId: 't1' }, origin: 'local' });
    expect(details.find(detail => (detail.target as { id: string }).id === 'b')).not.toHaveProperty('agent');
  });
});
```

**Unverified:** that `Blok.EventsAPI.methods.on(BlockChanged, …)` is how an internal test listens to the dispatcher. If not, subscribe with `Blok.BlockManager`'s `eventsDispatcher` the way `test/unit/components/modules/blockManager.test.ts` does (`useCustomEventsDispatcher`).

- [ ] **Step 2: Run it to make sure it fails**

Run: `yarn test test/unit/components/modules/blockManager/agent-attribution.test.ts`
Expected: FAIL with `Blok.BlockManager.attributeTo is not a function`.

- [ ] **Step 3: Write the scope**

In `types/events/block/Base.ts`, add to `BlockMutationEventDetail`:

```ts
  /** Set when an in-app agent made this change. `origin` stays 'local'. */
  agent?: { id: string; name: string; turnId: string };
```

In `src/components/modules/blockManager/blockManager.ts`, add the field and methods to the class:

```ts
  private agentScope: { ids: ReadonlySet<string>; actor: { id: string; name: string }; turnId: string } | null = null;

  /**
   * Writes to these block ids are the agent's until released. Per block, not a
   * global flag: the stamp below can run after an await, while the user types elsewhere.
   * @param scope - the ids a batch touches and who touches them
   */
  public attributeTo(scope: { ids: ReadonlySet<string>; actor: { id: string; name: string }; turnId: string }): () => void {
    this.agentScope = scope;

    return () => {
      if (this.agentScope === scope) {
        this.agentScope = null;
      }
    };
  }

  private agentFor(blockId: string): { id: string; name: string; turnId: string } | undefined {
    const scope = this.agentScope;

    return scope !== null && scope.ids.has(blockId) ? { id: scope.actor.id, name: scope.actor.name, turnId: scope.turnId } : undefined;
  }
```

At line 2691, replace `block.lastEditedBy = this.config.user?.id ?? null;` with:

```ts
      block.lastEditedBy = this.agentFor(block.id)?.id ?? this.config.user?.id ?? null;
```

In `emitBlockMutation` (line 2123), build the detail as:

```ts
    const agent = this.agentFor(block.id);
    const eventDetail = {
      target: new BlockAPI(block, this.Blok.API),
      ...this.placementDetail(mutationType, block, detailData),
      ...detailData,
      ...(agent !== undefined && { agent }),
      origin,
    };
```

- [ ] **Step 4: Run it and the BlockManager suite**

Run: `yarn test test/unit/components/modules/blockManager/agent-attribution.test.ts`
Expected: PASS.
Run: `yarn test test/unit/components/modules/blockManager.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint types/events/block/Base.ts src/components/modules/blockManager/blockManager.ts test/unit/components/modules/blockManager/agent-attribution.test.ts
git add types/events/block/Base.ts src/components/modules/blockManager/blockManager.ts test/unit/components/modules/blockManager/agent-attribution.test.ts
git commit -m "feat(agent): per-block agent attribution and detail.agent on mutation events

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 25: Undo levers: group-closed callback, step tags, top token

**Files:**
- Modify: `src/components/modules/blockManager/blockManager.ts:1187-1240` (`endToolTransaction`), `src/components/modules/yjs/undo-history.ts`, `src/components/modules/yjs/index.ts` (forwarders)
- Test: `test/unit/components/modules/yjs/undo-step-tags.test.ts`

**Interfaces:**
- Consumes: `caretUndoStack`, `caretRedoStack` (`undo-history.ts:219`, `:224`).
- Produces:
  - `BlockManager.endToolTransaction(onClosed?: () => void): void` — `onClosed` runs after the group really closes (after pending writes settle). Existing callers pass nothing; `blocks.endTransaction()` is unchanged.
  - `UndoHistory.topUndoToken(): object | undefined`, `UndoHistory.topRedoToken(): object | undefined`, `UndoHistory.tagTopUndo(tag: { actorId: string; sessionId: string }): void`, `UndoHistory.tagOf(token: object | undefined): { actorId: string; sessionId: string } | undefined`, `UndoHistory.gestureCount: number` (read-only getter, bumped in `startGesture`).
  - `YjsManager` forwards: `topUndoToken()`, `topRedoToken()`, `tagTopUndoStep(tag)`, `undoStepTag(token)`, `gestureCount()`.
  - Tokens are the caret-history entries (`CaretHistoryEntry`), one per undo step. **Unverified:** that every step, a move group included, has exactly one caret entry and that undo moves the same object to the redo stack; this task's tests pin both.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/components/modules/yjs/undo-step-tags.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Core } from '../../../../../src/components/core';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

let holder: HTMLDivElement;

const boot = async (): Promise<BlokModules> => {
  const core = new Core({ holder, tools: { paragraph: { class: Paragraph } }, data: { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'A' } }] } });

  await core.isReady;

  return core.moduleInstances as BlokModules;
};

const group = (Blok: BlokModules, fn: () => void): Promise<void> => new Promise((resolve) => {
  Blok.YjsManager.beginApiCall();
  Blok.BlockManager.beginToolTransaction();
  fn();
  Blok.BlockManager.endToolTransaction(resolve);
});

describe('undo step tags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    holder.remove();
    vi.restoreAllMocks();
  });

  it('calls back when the group closes, and tags that step', async () => {
    const Blok = await boot();

    await group(Blok, () => Blok.API.methods.blocks.insert('paragraph', { text: 'B' }));
    Blok.YjsManager.tagTopUndoStep({ actorId: 'agent-1', sessionId: 's1' });

    expect(Blok.YjsManager.undoStepTag(Blok.YjsManager.topUndoToken())).toEqual({ actorId: 'agent-1', sessionId: 's1' });
  });

  it('moves the same token to the redo side on undo', async () => {
    const Blok = await boot();

    await group(Blok, () => Blok.API.methods.blocks.insert('paragraph', { text: 'B' }));
    const token = Blok.YjsManager.topUndoToken();

    Blok.YjsManager.undo();

    expect(Blok.YjsManager.topRedoToken()).toBe(token);
  });

  it('gives a move-only step a token of its own', async () => {
    const Blok = await boot();

    await group(Blok, () => Blok.API.methods.blocks.insert('paragraph', { text: 'B' }, {}, 1, false, false, 'b'));
    const before = Blok.YjsManager.topUndoToken();

    await group(Blok, () => Blok.API.methods.blocks.moveTo('b', { position: 'start' }));

    expect(Blok.YjsManager.topUndoToken()).not.toBe(before);
  });

  it('counts gestures', async () => {
    const Blok = await boot();
    const before = Blok.YjsManager.gestureCount();

    Blok.YjsManager.beginGesture('discrete');

    expect(Blok.YjsManager.gestureCount()).toBe(before + 1);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `yarn test test/unit/components/modules/yjs/undo-step-tags.test.ts`
Expected: FAIL with `tagTopUndoStep is not a function` (and the callback never resolving → test timeout in the first case).

- [ ] **Step 3: Write the levers**

In `UndoHistory` (`src/components/modules/yjs/undo-history.ts`):

```ts
  private readonly stepTags = new WeakMap<object, { actorId: string; sessionId: string }>();
  private gestures = 0;

  public get gestureCount(): number {
    return this.gestures;
  }

  /** The entry the next undo pops: one object per step. */
  public topUndoToken(): object | undefined {
    return this.caretUndoStack.at(-1);
  }

  public topRedoToken(): object | undefined {
    return this.caretRedoStack.at(-1);
  }

  public tagTopUndo(tag: { actorId: string; sessionId: string }): void {
    const token = this.topUndoToken();

    if (token !== undefined) {
      this.stepTags.set(token, tag);
    }
  }

  public tagOf(token: object | undefined): { actorId: string; sessionId: string } | undefined {
    return token === undefined ? undefined : this.stepTags.get(token);
  }
```

At the top of `startGesture` (line 2210, after the `isPerformingUndoRedo` early return) add `this.gestures++;`.

In `YjsManager` (`src/components/modules/yjs/index.ts`), next to `undo()` (line 883):

```ts
  public topUndoToken(): object | undefined {
    return this.undoHistory.topUndoToken();
  }

  public topRedoToken(): object | undefined {
    return this.undoHistory.topRedoToken();
  }

  public tagTopUndoStep(tag: { actorId: string; sessionId: string }): void {
    this.undoHistory.tagTopUndo(tag);
  }

  public undoStepTag(token: object | undefined): { actorId: string; sessionId: string } | undefined {
    return this.undoHistory.tagOf(token);
  }

  public gestureCount(): number {
    return this.undoHistory.gestureCount;
  }
```

In `BlockManager.endToolTransaction` (line 1187), take `onClosed?: () => void` and call it at the end of `close` once the depth reached 0:

```ts
  public endToolTransaction(onClosed?: () => void): void {
    // ...existing comment...
    const close = (): void => {
      this.toolTransactionDepth = Math.max(0, this.toolTransactionDepth - 1);

      if (this.toolTransactionDepth > 0) {
        onClosed?.();

        return;
      }

      this.Blok.YjsManager.stopCapturing();

      if (this.toolTransactionHoldsCapture) {
        this.toolTransactionHoldsCapture = false;
        this.Blok.YjsManager.releaseCapture();
      }
      this.operations.suppressStopCapturing = this.suppressBeforeToolTransaction;
      onClosed?.();
    };
    // ...rest unchanged...
  }
```

- [ ] **Step 4: Run it and the undo suites it touches**

Run: `yarn test test/unit/components/modules/yjs/undo-step-tags.test.ts test/unit/components/modules/api/blocks-transact-undo.integration.test.ts test/unit/components/modules/yjs/page-fields.test.ts`
Expected: PASS. If "moves the same token to the redo side" fails, the caret entry is copied on undo: tag by the Yjs `StackItem` instead (`undoManager.undoStack.at(-1)` / `redoStack.at(-1)`, which Yjs moves by reference), and keep a move-only step's token as its caret entry. Re-run.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/components/modules/yjs/undo-history.ts src/components/modules/yjs/index.ts src/components/modules/blockManager/blockManager.ts test/unit/components/modules/yjs/undo-step-tags.test.ts
git add src/components/modules/yjs/undo-history.ts src/components/modules/yjs/index.ts src/components/modules/blockManager/blockManager.ts test/unit/components/modules/yjs/undo-step-tags.test.ts
git commit -m "feat(undo): tag undo steps and report when a tool transaction closes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 26: Editor snapshot and revision counter

**Files:**
- Create: `src/components/modules/agent/editor-snapshot.ts`
- Test: `test/unit/components/modules/agent/editor-snapshot.test.ts`

**Interfaces:**
- Consumes: `YjsManager.toJSON()` (`yjs/index.ts:386`, flushes buffered writes), `YjsManager.richSegmentsOf(value)` (`:1420`), `YjsManager.getPageFields()` (`:954`), `YjsManager.onAnyDocUpdate` (`:1304`), `editorRichTextFieldsFor` (Task 23).
- Produces: `editorSnapshot(Blok: BlokModules): DocSnapshot` (rich fields as canonical segments; `title` / `icon` from the page map) and `createRevisionCounter(Blok: BlokModules): { value(): string; dispose(): void }` (`"e<n>"`, bumped on every doc update).

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/components/modules/agent/editor-snapshot.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Core } from '../../../../../src/components/core';
import { createRevisionCounter, editorSnapshot } from '../../../../../src/components/modules/agent/editor-snapshot';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

let holder: HTMLDivElement;

describe('editor snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    holder.remove();
    vi.restoreAllMocks();
  });

  it('reads rich fields as segments, page fields included, and counts updates', async () => {
    const core = new Core({ holder, tools: { paragraph: { class: Paragraph } }, data: { title: 'T', blocks: [{ id: 'a', type: 'paragraph', data: { text: 'a <b>b</b>' } }] } });

    await core.isReady;
    const Blok = core.moduleInstances as BlokModules;
    const counter = createRevisionCounter(Blok);
    const before = counter.value();

    expect(editorSnapshot(Blok).toOutput()).toMatchObject({
      title: 'T',
      blocks: [{ id: 'a', type: 'paragraph', data: { text: [{ text: 'a ' }, { text: 'b', marks: { bold: true } }] } }],
    });

    Blok.YjsManager.setPageField('title', 'U');

    expect(counter.value()).not.toBe(before);
    counter.dispose();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `yarn test test/unit/components/modules/agent/editor-snapshot.test.ts`
Expected: FAIL with `Failed to resolve import ".../editor-snapshot"`.

- [ ] **Step 3: Write it**

```ts
// src/components/modules/agent/editor-snapshot.ts
import type { OutputData } from '../../../../types/data-formats/output-data';
import { DocSnapshot } from '../../../shared/agent/snapshot';
import type { BlokModules } from '../../../types-internal/blok-modules';
import { htmlToSegmentsDom } from '../../utils/rich-text-dom';
import { editorRichTextFieldsFor } from './editor-ports';

export const editorSnapshot = (Blok: BlokModules): DocSnapshot => {
  const fieldsFor = editorRichTextFieldsFor(Blok);
  const blocks = Blok.YjsManager.toJSON().map(block => ({
    ...block,
    data: Object.fromEntries(Object.entries(block.data).map(([key, value]) => [key, fieldsFor(block.type).includes(key)
      ? Blok.YjsManager.richSegmentsOf(value) ?? htmlToSegmentsDom(typeof value === 'string' ? value : '')
      : value])),
  }));

  return DocSnapshot.fromOutput({ ...Blok.YjsManager.getPageFields(), blocks } as OutputData);
};

export const createRevisionCounter = (Blok: BlokModules): { value(): string; dispose(): void } => {
  let count = 0;
  const dispose = Blok.YjsManager.onAnyDocUpdate(() => {
    count++;
  });

  return { value: () => `e${count}`, dispose };
};
```

**Unverified (01 §3.3 "Snapshot freshness"):** whether `toJSON()` includes typing whose DOM-driven save is still in flight. `EditorApplier.settle()` (Task 27) awaits `onPendingBlockWritesSettled` before the snapshot; Task 31 pins that typing in progress is in the snapshot.

- [ ] **Step 4: Run it to make sure it passes**

Run: `yarn test test/unit/components/modules/agent/editor-snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/components/modules/agent/editor-snapshot.ts test/unit/components/modules/agent/editor-snapshot.test.ts
git add src/components/modules/agent/editor-snapshot.ts test/unit/components/modules/agent/editor-snapshot.test.ts
git commit -m "feat(agent): editor snapshot in segments and a doc-update revision counter

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 27: `EditorApplier`

**Files:**
- Create: `src/components/modules/agent/editor-applier.ts`
- Test: `test/unit/components/modules/agent/editor-applier.test.ts`

**Interfaces:**
- Consumes: Task 16 `AgentApplier`; Task 23 `hostDataForTool` (public), `editorRichTextFieldsFor`; Task 24 `attributeTo`; Task 25 `endToolTransaction(onClosed)`, `tagTopUndoStep`, `topUndoToken`, `undoStepTag`, `topRedoToken`; Task 26 `editorSnapshot`, `createRevisionCounter`; `resolvePlacement`, `assertCanMoveUnder` (`src/components/modules/api/block-placement.ts`); `captureCaretAcrossRewrite` (`src/components/modules/blockManager/remote-edit-caret.ts:128`); `BlockManager.composeBlock` (`:645`), `insertMany` (`:720`), `insertInsideParent` (`:1248`), `removeBlock` (`:971`), `moveTo` (`:1685`), `update` (`:901`); `API.methods.blocks.convert` (D5 path, Task 22); `YjsManager.setPageField` (`:963`).
- Produces: `class EditorApplier implements AgentApplier` with `constructor(Blok: BlokModules, options: { actor: AgentActor; sessionId: string; turnId: string })`, plus `lastStepToken(): object | undefined` (the token of the step this applier last closed; Task 29 uses it). Mapping (01 §3.4 table):

| Edit | Editor call |
|---|---|
| `insert` | Planned tree flattened to `OutputBlockData[]` (parent/content explicit, `lastEditedBy = actor.id`), each composed with `composeBlock({ …, data: hostDataForTool(type, data), origin: 'api' })`, then `insertMany(blocks, index, { notify: true, yjsSync: 'add' })` with `index` from `resolvePlacement(tree, parentId, afterId === null ? 'start' : { after: afterId })`. Under a self-placed parent: `insertInsideParent(parentId, index, html, type, { id })` per planned block. |
| `remove` | `removeBlock(block, false)`; a block already gone is skipped (a tool may have cleaned it up) |
| `move` | `assertCanMoveUnder(…, { allowColumnMoves: true })` then `moveTo(block, { parentId, afterId })` |
| `setData` | `update(block, hostDataForTool(type, patchWithoutNulls))`; null keys: see note |
| `setRichText` | `update(block, hostDataForTool(type, { [field]: value }))`, with caret capture if the user's selection is in that block |
| `setTunes` | `update(block, undefined, tunes)` |
| `replaceType` | `API.methods.blocks.convert(id, type, data)` (sanitized by D5), caret capture as above |
| `setPageField` | `YjsManager.setPageField(key, value)` |

The whole apply runs between `YjsManager.beginApiCall()` + `BlockManager.beginToolTransaction()` and `endToolTransaction(onClosed)`; the applier awaits `onClosed`, then tags the step `{ actorId, sessionId }`. A throw closes the group, undoes it if it is tagged as this session's, and rethrows (the executor reports `APPLY_FAILED`).

**Note on null keys (unverified):** whether `BlockManager.update` removes a key that is absent from the new data. The "update with null" test below pins it. If the key survives, write `YjsManager.updateBlockData(id, key, undefined)` for each null key inside the same bracket (06 R2-01-1 uses the same `undefined`-deletes rule, `document-store.ts:1388-1394`).

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/components/modules/agent/editor-applier.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Core } from '../../../../../src/components/core';
import { EditorApplier } from '../../../../../src/components/modules/agent/editor-applier';
import { Header, Paragraph, Toggle } from '../../../../../src/tools';
import type { Plan } from '../../../../../src/shared/agent/types';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { Edit } from '../../../../../types';

let holder: HTMLDivElement;
const actor = { id: 'agent-1', name: 'Agent', kind: 'agent' as const };

const boot = async (): Promise<BlokModules> => {
  const core = new Core({
    holder,
    tools: { paragraph: { class: Paragraph }, header: { class: Header as never }, toggle: { class: Toggle as never } },
    data: { blocks: [
      { id: 'p', type: 'paragraph', data: { text: 'Hello' } },
      { id: 'tg', type: 'toggle', data: { text: 'T' }, content: ['k'] },
      { id: 'k', type: 'paragraph', data: { text: 'K' }, parent: 'tg' },
    ] },
  });

  await core.isReady;

  return core.moduleInstances as BlokModules;
};

const plan = (edits: Edit[], touched: string[]): Plan => ({
  edits, results: [], refs: {}, changed: { created: [], updated: [], moved: [], removed: [] }, warnings: [], touched: new Set(touched),
});

describe('EditorApplier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    holder.remove();
    vi.restoreAllMocks();
  });

  it('inserts a tree after a block, live, attributed, in one undo step', async () => {
    const Blok = await boot();
    const applier = new EditorApplier(Blok, { actor, sessionId: 's1', turnId: 't1' });

    await applier.apply(plan([{ op: 'insert', parentId: null, afterId: 'p', block: {
      id: 'n', type: 'toggle', data: { text: [{ text: 'N' }] }, children: [{ id: 'n1', type: 'paragraph', data: { text: [{ text: 'c' }] }, children: [] }],
    } }], ['n', 'n1']), applier.snapshot());

    const saved = Blok.YjsManager.toJSON();

    expect(saved.map(block => block.id)).toEqual(['p', 'n', 'n1', 'tg', 'k']);
    expect(saved.find(block => block.id === 'n1')).toMatchObject({ parent: 'n', lastEditedBy: 'agent-1' });
    expect(Blok.YjsManager.undoStepTag(Blok.YjsManager.topUndoToken())).toEqual({ actorId: 'agent-1', sessionId: 's1' });

    Blok.YjsManager.undo();
    expect(Blok.YjsManager.toJSON().map(block => block.id)).toEqual(['p', 'tg', 'k']);
  });

  it('formats rich text, moves, retypes, deletes and sets the title', async () => {
    const Blok = await boot();
    const applier = new EditorApplier(Blok, { actor, sessionId: 's1', turnId: 't1' });

    await applier.apply(plan([
      { op: 'setRichText', id: 'p', field: 'text', value: [{ text: 'Hel' }, { text: 'lo', marks: { bold: true } }] },
      { op: 'move', id: 'p', parentId: 'tg', afterId: 'k' },
      { op: 'replaceType', id: 'k', type: 'header', data: { text: [{ text: 'K' }], level: 3 } },
      { op: 'setPageField', key: 'title', value: 'Plan' },
    ], ['p', 'k']), applier.snapshot());

    const output = applier.snapshot().toOutput();

    expect(output.title).toBe('Plan');
    expect(output.blocks.find(block => block.id === 'p')).toMatchObject({ parent: 'tg', data: { text: [{ text: 'Hel' }, { text: 'lo', marks: { bold: true } }] } });
    expect(output.blocks.find(block => block.id === 'k')).toMatchObject({ type: 'header', data: { level: 3 } });
  });

  it('removes a key set to null', async () => {
    const Blok = await boot();
    const applier = new EditorApplier(Blok, { actor, sessionId: 's1', turnId: 't1' });

    await applier.apply(plan([{ op: 'setData', id: 'k', patch: { extra: 'x' } }], ['k']), applier.snapshot());
    await applier.apply(plan([{ op: 'setData', id: 'k', patch: { extra: null } }], ['k']), applier.snapshot());

    expect(applier.snapshot().get('k')?.data).not.toHaveProperty('extra');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `yarn test test/unit/components/modules/agent/editor-applier.test.ts`
Expected: FAIL with `Failed to resolve import ".../editor-applier"`.

- [ ] **Step 3: Write the applier**

```ts
// src/components/modules/agent/editor-applier.ts
import type { AgentActor, Edit, PlannedBlock } from '../../../../types/agent';
import type { OutputBlockData } from '../../../../types/data-formats/output-data';
import type { AgentApplier } from '../../../shared/agent/executor';
import type { DocSnapshot } from '../../../shared/agent/snapshot';
import type { Plan } from '../../../shared/agent/types';
import { SELF_PLACING_PARENTS } from '../../../tools/nested-blocks';
import type { BlokModules } from '../../../types-internal/blok-modules';
import type { Block } from '../../block';
import { assertCanMoveUnder, resolvePlacement, type BlockTree } from '../api/block-placement';
import { captureCaretAcrossRewrite } from '../blockManager/remote-edit-caret';
import { createRevisionCounter, editorSnapshot } from './editor-snapshot';

const flatten = (block: PlannedBlock, parentId: string | null, stamp: { by: string; at: number }): OutputBlockData[] => [
  {
    id: block.id, type: block.type, data: block.data,
    ...(block.tunes !== undefined && { tunes: block.tunes }),
    ...(parentId !== null && { parent: parentId }),
    ...(block.children.length > 0 && { content: block.children.map(child => child.id) }),
    lastEditedAt: stamp.at, lastEditedBy: stamp.by,
  },
  ...block.children.flatMap(child => flatten(child, block.id, stamp)),
];

export class EditorApplier implements AgentApplier {
  public readonly runtime = 'editor' as const;
  private readonly counter: ReturnType<typeof createRevisionCounter>;
  private lastToken: object | undefined;

  constructor(private readonly Blok: BlokModules, private readonly options: { actor: AgentActor; sessionId: string; turnId: string }) {
    this.counter = createRevisionCounter(Blok);
  }

  public isReadOnly(): boolean {
    return this.Blok.ReadOnly.isEnabled;
  }

  public settle(): Promise<void> {
    return new Promise((resolve) => {
      this.Blok.YjsManager.onPendingBlockWritesSettled(resolve);
    });
  }

  public snapshot(): DocSnapshot {
    return editorSnapshot(this.Blok);
  }

  public revision(): string {
    return this.counter.value();
  }

  public lastStepToken(): object | undefined {
    return this.lastToken;
  }

  public dispose(): void {
    this.counter.dispose();
  }

  public async apply(plan: Plan, _draft: DocSnapshot): Promise<void> {
    const { BlockManager, YjsManager } = this.Blok;
    const release = BlockManager.attributeTo({ ids: plan.touched, actor: this.options.actor, turnId: this.options.turnId });
    const tag = { actorId: this.options.actor.id, sessionId: this.options.sessionId };
    const close = (): Promise<void> => new Promise((resolve) => BlockManager.endToolTransaction(resolve));

    YjsManager.beginApiCall();
    BlockManager.beginToolTransaction();
    try {
      for (const edit of plan.edits) {
        await this.applyOne(edit);
      }
    } catch (error) {
      await close();
      release();
      if (YjsManager.undoStepTag(YjsManager.topUndoToken()) === undefined) {
        YjsManager.tagTopUndoStep(tag);
        YjsManager.undo();
      }
      throw error;
    }
    await close();
    YjsManager.tagTopUndoStep(tag);
    this.lastToken = YjsManager.topUndoToken();
    release();
  }

  private get tree(): BlockTree {
    const { BlockManager } = this.Blok;

    return { blocks: BlockManager.blocks, getBlockById: id => BlockManager.getBlockById(id) };
  }

  private html(type: string, data: Record<string, unknown>): Record<string, unknown> {
    return this.Blok.BlocksAPI.hostDataForTool(type, data) as Record<string, unknown>;
  }

  /** Keeps the user's caret where it was when a write rewrites the block it is in. */
  private async keepingCaret(block: Block, write: () => Promise<unknown>): Promise<void> {
    const restore = captureCaretAcrossRewrite(block, document.getSelection());

    await write();
    restore?.();
  }

  private async applyOne(edit: Edit): Promise<void> {
    const { BlockManager, YjsManager, API } = this.Blok;
    const block = 'id' in edit ? BlockManager.getBlockById(edit.id) : undefined;

    switch (edit.op) {
      case 'insert': {
        const parentType = edit.parentId === null ? undefined : BlockManager.getBlockById(edit.parentId)?.name;
        const at = (): number => resolvePlacement(this.tree, edit.parentId, edit.afterId === null ? 'start' : { after: edit.afterId }).index;

        if (parentType !== undefined && SELF_PLACING_PARENTS.has(parentType)) {
          flatten(edit.block, edit.parentId, { by: this.options.actor.id, at: Date.now() }).forEach((item) => {
            API.methods.blocks.insertInsideParent(item.parent ?? edit.parentId ?? '', at(), this.html(item.type, item.data as Record<string, unknown>), item.type, { id: item.id });
          });
          break;
        }

        const composed = flatten(edit.block, edit.parentId, { by: this.options.actor.id, at: Date.now() }).map(item => BlockManager.composeBlock({
          id: item.id, tool: item.type, data: this.html(item.type, item.data as Record<string, unknown>), tunes: item.tunes,
          parentId: item.parent, contentIds: item.content, lastEditedAt: item.lastEditedAt, lastEditedBy: item.lastEditedBy, origin: 'api',
        }));

        BlockManager.insertMany(composed, at(), { notify: true, yjsSync: 'add' });
        break;
      }
      case 'remove':
        if (block !== undefined) {
          await BlockManager.removeBlock(block, false);
        }
        break;
      case 'move':
        if (block !== undefined) {
          assertCanMoveUnder(this.tree, block, edit.parentId, undefined, { allowColumnMoves: true });
          BlockManager.moveTo(block, { parentId: edit.parentId, afterId: edit.afterId });
        }
        break;
      case 'setData':
        if (block !== undefined) {
          const kept = Object.fromEntries(Object.entries(edit.patch).filter(([, value]) => value !== null));

          await this.keepingCaret(block, () => BlockManager.update(block, this.html(block.name, kept)));
          Object.entries(edit.patch).filter(([, value]) => value === null).forEach(([key]) => YjsManager.updateBlockData(block.id, key, undefined));
        }
        break;
      case 'setRichText':
        if (block !== undefined) {
          await this.keepingCaret(block, () => BlockManager.update(block, this.html(block.name, { [edit.field]: edit.value })));
        }
        break;
      case 'setTunes':
        if (block !== undefined) {
          await BlockManager.update(block, undefined, edit.tunes as never);
        }
        break;
      case 'replaceType':
        if (block !== undefined) {
          await this.keepingCaret(block, () => API.methods.blocks.convert(edit.id, edit.type, edit.data as never));
        }
        break;
      case 'setPageField':
        YjsManager.setPageField(edit.key, edit.value);
        break;
    }
  }
}
```

The `updateBlockData(…, undefined)` line is the null-key rule; drop it only if the "removes a key set to null" test passes without it (then `BlockManager.update` already removes absent keys, and the extra write is noise).

- [ ] **Step 4: Run it to make sure it passes**

Run: `yarn test test/unit/components/modules/agent/editor-applier.test.ts`
Expected: PASS (3 tests). **Unverified before this run:** that `insertMany` with `yjsSync: 'add'` places a block whose `parent` is an existing block under it at the planned slot (`placementsUnderExistingParents`, `blockManager.ts:735`), and that awaited `update` / `convert` writes land in the open group (01 §3.6). The first test pins both (one undo removes the whole tree).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/components/modules/agent/editor-applier.ts test/unit/components/modules/agent/editor-applier.test.ts
git add src/components/modules/agent/editor-applier.ts test/unit/components/modules/agent/editor-applier.test.ts
git commit -m "feat(agent): EditorApplier maps primitive edits onto BlockManager in one undo step

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 27a: A concurrent-convert refusal becomes `CONFLICT`

01 §3.8 maps a concurrent `convert` refusal to `CONFLICT` (retryable). `EditorApplier` runs `replaceType` through the public `blocks.convert` (06 R3-4). `BlockMutation.convert` refuses a block a peer is editing by throwing a plain `Error`: "Could not convert Block «<id>»: it is being edited by someone else. Nothing was changed." at three sites (`src/components/modules/blockManager/block-mutation.ts:1700`, `:1829`, `:1879`; read at `30c77599`). Today that throw reaches the executor as a non-`AgentFailure` and becomes `APPLY_FAILED` ("may be partly applied"), which tells the agent the wrong thing.

A message match is fragile, so the throw gets a class. The throw shipped in `v1.16.1` (`git show v1.16.1:src/components/modules/blockManager/block-mutation.ts | grep -c "being edited by someone else"` prints 3). So the class keeps everything a host can observe: the same message, `instanceof Error`, and the inherited `name` `'Error'` (no `name` override, so `String(err)` and `err.name` do not change). Not breaking.

**Files:**
- Create: `src/components/errors/convert-conflict.ts`
- Modify: `src/components/modules/blockManager/block-mutation.ts` (the three throws), `src/components/modules/agent/editor-applier.ts` (`replaceType` case)
- Test: `test/unit/components/modules/agent/editor-applier-conflict.test.ts`

**Interfaces:**
- Produces: `class ConvertConflictError extends Error { readonly blockId: string }` (internal, not in `types/`). `EditorApplier.apply` maps it to `failure('CONFLICT', 'Block «<id>» is being edited by someone else. Nothing was changed; re-read and retry.', { details: { blockId } })`. The applier's existing throw path closes and undoes the group first (Task 27), so the batch leaves nothing behind. `RETRYABLE_CODES` already holds `CONFLICT` (Task 2).

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/components/modules/agent/editor-applier-conflict.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConvertConflictError } from '../../../../../src/components/errors/convert-conflict';

describe('concurrent convert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the public message and stays an Error', () => {
    const error = new ConvertConflictError('b1');

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Could not convert Block «b1»: it is being edited by someone else. Nothing was changed.');
    // Shipped in v1.16.1: a host may read err.name or String(err).
    expect(error.name).toBe('Error');
  });
});
```

Then append an `EditorApplier` case to `test/unit/components/modules/agent/editor-applier.test.ts` (Task 27's file, same editor set-up): stub `Blok.API.methods.blocks.convert` with `vi.spyOn(...).mockRejectedValue(new ConvertConflictError('p'))`, apply a plan holding an `insert` edit FIRST and then one `replaceType` edit, and expect the rejection to be an `AgentFailure` with `error.code === 'CONFLICT'`, `error.retryable === true`, `error.details.blockId === 'p'`, and the saved document equal to the seed (the inserted block is gone too). The leading insert proves "Nothing was changed" for a multi-edit batch, which rests on Task 27's throw path undoing the group.

A forced real concurrent edit needs two Yjs docs and is costly, so the applier case stubs `convert` (the dependency), never `EditorApplier` (the unit under test). The three call sites are checked by grep in Step 2.

Run: `yarn test test/unit/components/modules/agent/editor-applier-conflict.test.ts` and then `yarn test test/unit/components/modules/agent/editor-applier.test.ts -t "CONFLICT"`
Expected: both FAIL (no module; the applier reports `APPLY_FAILED`).

- [ ] **Step 2: Write the class, use it at the three throws, map it in the applier**

```ts
// src/components/errors/convert-conflict.ts
/** A peer is editing the block; convert changed nothing. The message is public text hosts may match on. */
export class ConvertConflictError extends Error {
  public constructor(public readonly blockId: string) {
    // No `name` override: this throw shipped in v1.16.1 as a plain Error, so `err.name` stays 'Error'.
    super(`Could not convert Block «${blockId}»: it is being edited by someone else. Nothing was changed.`);
  }
}
```

In `block-mutation.ts`, replace each of the three "being edited by someone else" throws with `throw new ConvertConflictError(<the same id expression>)`. Then `grep -n "being edited by someone else" src/components/modules/blockManager/block-mutation.ts` must print nothing. In `editor-applier.ts`, wrap the `replaceType` call:

```ts
      } catch (error) {
        if (error instanceof ConvertConflictError) {
          throw failure('CONFLICT', `Block «${error.blockId}» is being edited by someone else. Nothing was changed; re-read and retry.`, { details: { blockId: error.blockId } });
        }
        throw error;
      }
```

Run both tests again. Expected: PASS. Then run the existing convert tests that pin the message: `grep -rln "being edited by someone else" test/unit` and run each file it lists with `yarn test <file>`.

- [ ] **Step 3: Lint and commit**

```bash
npx eslint src/components/errors/convert-conflict.ts src/components/modules/blockManager/block-mutation.ts src/components/modules/agent/editor-applier.ts test/unit/components/modules/agent/editor-applier-conflict.test.ts test/unit/components/modules/agent/editor-applier.test.ts
git add src/components/errors/convert-conflict.ts src/components/modules/blockManager/block-mutation.ts src/components/modules/agent/editor-applier.ts test/unit/components/modules/agent/editor-applier-conflict.test.ts test/unit/components/modules/agent/editor-applier.test.ts
git commit -m "feat(agent): a concurrent convert refusal is a retryable CONFLICT

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 28: `createEditorAgentSession`: own-step undo, read-only, contract cache

**Files:**
- Create: `src/components/modules/agent/editor-session.ts`
- Modify: `src/components/modules/agent/editor-applier.ts` (add `undo` / `redo`)
- Test: `test/unit/components/modules/agent/editor-session.test.ts`

**Interfaces:**
- Consumes: Task 27 `EditorApplier`, Task 23 `createEditorPorts`, Task 17 `plannerContextFrom`, `describeContract`, Task 16 `runBatch`. **02**: `buildToolManifest`, `buildAgentContract` (02 Tasks 5, 6); `snapshotFromTools(tools, { blokVersion, readOnly, defaultBlock, services, i18n })` and `runtimesFromTools(tools)` from `src/components/tools/registry-snapshot.ts` (02 Task 26). The `Tools` module has the three collections `snapshotFromTools` reads (`blockTools`, `inlineTools`, `blockTunes`, `src/components/modules/tools.ts:77-92`) and `defaultTool` (`:99`).
- Produces:
  - `type InternalEditorHandle = BlokModules`.
  - `interface ContractSource { contract(): AgentContract; runtimes(contract: AgentContract): ToolRuntimeRegistry }` and `liveContractSource(Blok: BlokModules, options?: { services?: HostService[]; overrides?: ManifestOverrides }): ContractSource` (02's builders, `where: { runtime: 'editor', services }`). `BlokModules` carries no config (`src/types-internal/blok-modules.d.ts`; config is the protected `Module.config`, `src/components/__module.ts:61`), so the caller passes `overrides`: 03's `AgentAPI` reads `this.config.agent?.overrides` (03 Task 10) and hands the SAME source to `tools()` and to every session, so the rendered enum and the executor agree.
  - `createEditorAgentSession(editor: InternalEditorHandle, actor: AgentActor, options?: { contractSource?: ContractSource; turnId?: string; mergeSteps?: 'batch' | 'turn' }): AgentSession` (03 consumes; `mergeSteps` is Task 29). The tool runtime registry is rebuilt only when `contract.revision` changes (06 R2-02-1).
  - `EditorApplier.undo()` / `redo()`: only when the top undo (or redo) step is tagged with this session's id; else `UNDO_NOT_OWN`; nothing to undo → `NOTHING_TO_UNDO`.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/components/modules/agent/editor-session.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Core } from '../../../../../src/components/core';
import { createEditorAgentSession, type ContractSource } from '../../../../../src/components/modules/agent/editor-session';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { AgentContract } from '../../../../../types/tool-manifest';
import { coreCommandMap, TOOLS } from '../../../shared/agent/fixtures';

let holder: HTMLDivElement;
const actor = { id: 'agent-1', name: 'Agent', kind: 'agent' as const };
const contract = (revision: string): AgentContract => ({
  formatVersion: 1, revision,
  commands: [...coreCommandMap().values()].map(entry => ({ ...entry, summary: '' })),
  manifest: { defaultBlock: 'paragraph', blocks: [TOOLS.get('paragraph')?.entry].map(entry => ({ ...entry, summary: '' })) },
  guidance: { general: '', commands: {}, tools: {} },
}) as unknown as AgentContract;

const boot = async (): Promise<BlokModules> => {
  const core = new Core({ holder, tools: { paragraph: { class: Paragraph } }, data: { blocks: [{ id: 'p', type: 'paragraph', data: { text: 'P' } }] } });

  await core.isReady;

  return core.moduleInstances as BlokModules;
};

const source = (revisions: string[]): ContractSource & { built: number } => {
  const state = { built: 0, contract: () => contract(revisions.shift() ?? 'r-last'), runtimes: () => { state.built++; return new Map([['paragraph', { name: 'paragraph', sanitize: {}, actions: {} }]]) as never; } };

  return state;
};

describe('createEditorAgentSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    holder.remove();
    vi.restoreAllMocks();
  });

  it('makes one execute one undo step', async () => {
    const Blok = await boot();
    const session = createEditorAgentSession(Blok, actor, { contractSource: source([]) });

    await session.execute({ commands: [
      { name: 'block.insert', args: { type: 'paragraph', data: { text: 'a' } } },
      { name: 'block.insert', args: { type: 'paragraph', data: { text: 'b' } } },
      { name: 'text.format', args: { id: 'p', range: 'all', set: { bold: true } } },
    ] });
    Blok.YjsManager.undo();

    expect(Blok.YjsManager.toJSON().map(block => block.id)).toEqual(['p']);
  });

  it('undoes only its own step', async () => {
    const Blok = await boot();
    const session = createEditorAgentSession(Blok, actor, { contractSource: source([]) });

    await session.execute({ commands: [{ name: 'block.insert', args: { type: 'paragraph' } }] });
    await new Promise(resolve => setTimeout(resolve, 0));
    await Blok.API.methods.blocks.update('p', { text: 'human' });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(await session.execute({ commands: [{ name: 'history.undo', args: {} }] })).toMatchObject({ ok: false, error: { code: 'UNDO_NOT_OWN' } });
  });

  it('refuses writes when read-only and still reads', async () => {
    const Blok = await boot();
    const session = createEditorAgentSession(Blok, actor, { contractSource: source([]) });

    await Blok.ReadOnly.toggle(true);

    expect(await session.execute({ commands: [{ name: 'block.delete', args: { id: 'p' } }] })).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
    expect((await session.read()).blocks).toHaveLength(1);
  });

  it('rebuilds tool runtimes only when the contract revision changes', async () => {
    const Blok = await boot();
    const contracts = source(['r1', 'r1', 'r2']);
    const session = createEditorAgentSession(Blok, actor, { contractSource: contracts });

    await session.execute({ commands: [{ name: 'doc.read', args: {} }] });
    await session.execute({ commands: [{ name: 'doc.read', args: {} }] });
    await session.execute({ commands: [{ name: 'doc.read', args: {} }] });

    expect(contracts.built).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `yarn test test/unit/components/modules/agent/editor-session.test.ts`
Expected: FAIL with `Failed to resolve import ".../editor-session"`.

- [ ] **Step 3: Write undo/redo on the applier and the session**

Add to `EditorApplier`:

```ts
import { failure } from '../../../shared/agent/errors';

  public undo(): Promise<void> {
    const { YjsManager } = this.Blok;

    if (!YjsManager.canUndo()) {
      return Promise.reject(failure('NOTHING_TO_UNDO', 'There is nothing to undo.'));
    }
    if (YjsManager.undoStepTag(YjsManager.topUndoToken())?.sessionId !== this.options.sessionId) {
      return Promise.reject(failure('UNDO_NOT_OWN', 'The last step is not this agent\'s. The user\'s own edits are never undone by an agent.'));
    }
    YjsManager.undo();

    return Promise.resolve();
  }

  public redo(): Promise<void> {
    const { YjsManager } = this.Blok;

    if (!YjsManager.canRedo()) {
      return Promise.reject(failure('NOTHING_TO_UNDO', 'There is nothing to redo.'));
    }
    if (YjsManager.undoStepTag(YjsManager.topRedoToken())?.sessionId !== this.options.sessionId) {
      return Promise.reject(failure('UNDO_NOT_OWN', 'The next redo step is not this agent\'s.'));
    }
    YjsManager.redo();

    return Promise.resolve();
  }
```

```ts
// src/components/modules/agent/editor-session.ts
import type { AgentActor, AgentSession, CommandLogEntry, DocumentView, ViewArgs } from '../../../../types/agent';
import type { AgentContract, HostService } from '../../../../types/tool-manifest';
import { COMMANDS } from '../../../shared/agent/commands';
import { plannerContextFrom } from '../../../shared/agent/context';
import { describeContract } from '../../../shared/agent/describe';
import { failure } from '../../../shared/agent/errors';
import { runBatch } from '../../../shared/agent/executor';
import type { PlannerToolRuntime } from '../../../shared/agent/types';
import { validateAgainst } from '../../../shared/schema/validate';
import { buildAgentContract, buildToolManifest } from '../../../shared/tool-manifest';
import type { ManifestOverrides } from '../../../../types/tool-manifest';
import { getBlokVersion } from '../../utils/version';
import { runtimesFromTools, snapshotFromTools } from '../../tools/registry-snapshot';
import type { BlokModules } from '../../../types-internal/blok-modules';
import { EditorApplier } from './editor-applier';
import { createEditorPorts } from './editor-ports';

export type InternalEditorHandle = BlokModules;

export interface ContractSource {
  contract(): AgentContract;
  runtimes(contract: AgentContract): ReadonlyMap<string, PlannerToolRuntime>;
}

export const liveContractSource = (Blok: BlokModules, options: { services?: HostService[]; overrides?: ManifestOverrides } = {}): ContractSource => {
  const services = options.services ?? [];
  const snapshot = () => snapshotFromTools(Blok.Tools, {
    blokVersion: getBlokVersion(),
    readOnly: Blok.ReadOnly.isEnabled,
    defaultBlock: Blok.Tools.defaultTool.name,
    services,
    i18n: Blok.I18n,
  });

  return {
    contract: () => buildAgentContract(buildToolManifest(snapshot(), options.overrides), COMMANDS, { runtime: 'editor', services }),
    runtimes: () => runtimesFromTools(Blok.Tools),
  };
};

let editorSessions = 0;

export const createEditorAgentSession = (
  editor: InternalEditorHandle,
  actor: AgentActor,
  options: { contractSource?: ContractSource; turnId?: string; mergeSteps?: 'batch' | 'turn' } = {}
): AgentSession => {
  const id = `editor-session-${++editorSessions}`;
  const source = options.contractSource ?? liveContractSource(editor);
  const ports = createEditorPorts(editor);
  const applier = new EditorApplier(editor, { actor, sessionId: id, turnId: options.turnId ?? id });
  const log: CommandLogEntry[] = [];
  let cached: { revision: string; runtimes: ReadonlyMap<string, PlannerToolRuntime> } | null = null;
  let batchNo = 0;

  const context = () => {
    const contract = source.contract();

    if (cached === null || cached.revision !== contract.revision) {
      cached = { revision: contract.revision, runtimes: source.runtimes(contract) };
    }

    return { contract, ctx: plannerContextFrom(contract, cached.runtimes, ports, validateAgainst, {}) };
  };

  return {
    id,
    actor,
    read: async (args: ViewArgs = {}): Promise<DocumentView> => {
      const result = await runBatch({ batch: { commands: [{ name: 'doc.read', args }] }, ctx: context().ctx, applier, actor, log: [], batchNo: 0 });

      if (!result.ok) {
        throw failure(result.error.code, result.error.message);
      }

      return result.results[0] as DocumentView;
    },
    describe: query => describeContract(source.contract(), query),
    execute: (batch, opts = {}) => runBatch({ batch, ctx: context().ctx, applier, actor, signal: opts.signal, log, batchNo: ++batchNo }),
    log: () => [...log],
    close: () => applier.dispose(),
  };
};
```

The read-only guard is the executor's (06 C18); `EditorApplier.isReadOnly()` reads `ReadOnly.isEnabled` (`src/components/modules/readonly.ts:59`).

- [ ] **Step 4: Run it to make sure it passes**

Run: `yarn test test/unit/components/modules/agent/editor-session.test.ts`
Expected: PASS (4 tests). "makes one execute one undo step" pins 01 §6 "One execute = one history.undo()".

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/components/modules/agent/editor-session.ts src/components/modules/agent/editor-applier.ts test/unit/components/modules/agent/editor-session.test.ts
git add src/components/modules/agent/editor-session.ts src/components/modules/agent/editor-applier.ts test/unit/components/modules/agent/editor-session.test.ts
git commit -m "feat(agent): editor sessions with own-step undo and a cached tool registry

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 28a: Session options 03 needs: `attributeLastEditedBy` and `services`

03's `AgentAPI` needs two levers Task 28 lacks (03 cross-plan table):
- `attributeTo: 'user'` (03 §4.1): the agent's edits keep the human's `lastEditedBy`, while events still carry `detail.agent`.
- Browser service objects: `plannerContextFrom(…, {})` in Task 28 passes no services, so `prepare` of `page.rename`, `bookmark.create` and the media `setSource` actions would never see a `pageBackend`, `linkMetadata` or `uploader`. 03 builds those objects (03 Task 9a); this task carries them in.

**Files:**
- Modify: `src/components/modules/blockManager/blockManager.ts` (`attributeTo` scope gains `stampLastEditedBy?: boolean`), `src/components/modules/agent/editor-applier.ts` (option `attributeLastEditedBy`), `src/components/modules/agent/editor-session.ts` (options `attributeLastEditedBy`, `services`)
- Test: `test/unit/components/modules/agent/editor-session.test.ts` (append), `test/unit/components/modules/blockManager/agent-attribution.test.ts` (append; Task 24's file)

**Interfaces:**
- Produces:
  - `BlockManager.attributeTo(scope: { ids; actor; turnId; stampLastEditedBy?: boolean })` — `stampLastEditedBy: false` keeps `config.user.id` on touched blocks; `detail.agent` is still set. Default `true`.
  - `EditorApplier` options gain `attributeLastEditedBy?: boolean` (default `true`), passed as `stampLastEditedBy`.
  - `createEditorAgentSession(editor, actor, options?: { contractSource?; turnId?; mergeSteps?; attributeLastEditedBy?: boolean; services?: Partial<Record<HostService, unknown>> })`. `services` goes to `plannerContextFrom` as the service objects. When no `contractSource` is given, the session builds `liveContractSource(editor, { services: Object.keys(services) as HostService[] })`, so a service object and its availability always agree.

- [ ] **Step 1: Write the failing tests**

Append to `agent-attribution.test.ts`:

```ts
  it('keeps the human id when stampLastEditedBy is false, and still tags the event', async () => {
    const release = Blok.BlockManager.attributeTo({ ids: new Set(['a']), actor: { id: 'agent-1', name: 'Agent' }, turnId: 't1', stampLastEditedBy: false });
    // same write and event capture as the first case in this file
    …
    expect(saved.blocks.find(b => b.id === 'a')?.lastEditedBy).toBe('human-1');
    expect(events.at(-1)?.detail.agent).toEqual({ id: 'agent-1', name: 'Agent', turnId: 't1' });
    release();
  });
```

Copy the write, event capture and `saved` lines from Task 24's first case in this file; only the scope and the `lastEditedBy` expectation differ.

Append to `editor-session.test.ts`:

```ts
  it('hands service objects to prepare and lists them as available', async () => {
    const pageBackend = { rename: vi.fn(async () => ({ pageId: 'pg', applied: true })), setIcon: vi.fn() };
    const session = createEditorAgentSession(Blok, actor, { services: { pageBackend } });

    expect(session.describe({ command: 'page.rename' })).toMatchObject({ command: { available: true } });
  });

  it('attributeLastEditedBy: false keeps the human lastEditedBy', async () => {
    const session = createEditorAgentSession(Blok, actor, { attributeLastEditedBy: false });

    await session.execute({ commands: [{ name: 'block.update', args: { id: 'p', data: { text: 'x' } } }] });

    expect((await Blok.Saver.save())?.blocks.find(b => b.id === 'p')?.lastEditedBy).not.toBe(actor.id);
  });
```

The first test needs the `page` tool registered in this file's editor set-up; add it if Task 28's set-up lacks it.

Run: `yarn test test/unit/components/modules/blockManager/agent-attribution.test.ts` and `yarn test test/unit/components/modules/agent/editor-session.test.ts`
Expected: FAIL (unknown option; `page.rename` unavailable).

- [ ] **Step 2: Implement**

- `attributeTo`: store `stampLastEditedBy` on the scope; the stamping branch checks it; the event branch does not.
- `EditorApplier`: `BlockManager.attributeTo({ ids: plan.touched, actor: this.options.actor, turnId: this.options.turnId, stampLastEditedBy: this.options.attributeLastEditedBy !== false })`.
- `createEditorAgentSession`:

```ts
  const services = options.services ?? {};
  const source = options.contractSource ?? liveContractSource(editor, { services: Object.keys(services) as HostService[] });
  const applier = new EditorApplier(editor, { actor, sessionId: id, turnId: options.turnId ?? id, attributeLastEditedBy: options.attributeLastEditedBy });
  …
    return { contract, ctx: plannerContextFrom(contract, cached.runtimes, ports, validateAgainst, services) };
```

**Unverified:** that the `I18n` module instance satisfies 02's `snapshotFromTools` `i18n` input type (02 Task 26 names it `I18nInstance`). Read 02 Task 26 when it lands and pass what it takes.

Run both test files again. Expected: PASS.

- [ ] **Step 3: Lint and commit**

```bash
npx eslint src/components/modules/blockManager/blockManager.ts src/components/modules/agent/editor-applier.ts src/components/modules/agent/editor-session.ts test/unit/components/modules/blockManager/agent-attribution.test.ts test/unit/components/modules/agent/editor-session.test.ts
git add src/components/modules/blockManager/blockManager.ts src/components/modules/agent/editor-applier.ts src/components/modules/agent/editor-session.ts test/unit/components/modules/blockManager/agent-attribution.test.ts test/unit/components/modules/agent/editor-session.test.ts
git commit -m "feat(agent): editor sessions take service objects and an attribution opt-out

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 29: Turn merge (R-U1, R-U3)

**Files:**
- Modify: `src/components/modules/blockManager/blockManager.ts` (`beginToolTransaction(options?)`), `src/components/modules/yjs/undo-history.ts` (`continueTopStep`), `src/components/modules/yjs/index.ts` (forwarder), `src/components/modules/agent/editor-applier.ts`, `src/components/modules/agent/editor-session.ts`
- Test: `test/unit/components/modules/agent/editor-turn-merge.test.ts`

**Interfaces:**
- Consumes: Task 25 tokens and `gestureCount`.
- Produces:
  - `BlockManager.beginToolTransaction(options?: { continueStep?: boolean })` — with `continueStep`, it skips the opening `stopCapturing()` (`blockManager.ts:1172`).
  - `UndoHistory.continueTopStep(): void` — sets `undoManager.lastChange = Date.now()`, the lever `continueEntryThatCreated` uses (`undo-history.ts:1917-1930`); `YjsManager.continueTopUndoStep()` forwards.
  - `EditorApplier` with `mergeSteps: 'turn'`: a batch joins the previous batch's step only if that step's token is still on top (`topUndoToken() === lastStepToken()`) and `gestureCount()` has not moved since it closed. Otherwise a new step (01 §3.6, 06 C11). No capture is ever held across a model call: the bracket opens and closes inside `apply`.
  - **The lever is unverified until both tests below pass.** If R-U1 cannot be made to pass with this lever, stop and report: 03's turn rule then needs another design.

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/components/modules/agent/editor-turn-merge.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Core } from '../../../../../src/components/core';
import { createEditorAgentSession } from '../../../../../src/components/modules/agent/editor-session';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

let holder: HTMLDivElement;
const actor = { id: 'agent-1', name: 'Agent', kind: 'agent' as const };
const nextTask = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

const boot = async (): Promise<BlokModules> => {
  const core = new Core({ holder, tools: { paragraph: { class: Paragraph } }, data: { blocks: [{ id: 'p', type: 'paragraph', data: { text: 'P' } }] } });

  await core.isReady;

  return core.moduleInstances as BlokModules;
};

const ids = (Blok: BlokModules): string[] => Blok.YjsManager.toJSON().map(block => block.id ?? '');

describe('agent turn merge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    holder.remove();
    vi.restoreAllMocks();
  });

  it('R-U1: two batches of one turn, nothing in between, undo as one step', async () => {
    const Blok = await boot();
    const session = createEditorAgentSession(Blok, actor, { mergeSteps: 'turn' });

    await session.execute({ commands: [{ name: 'block.insert', args: { id: 'a', type: 'paragraph' } }] });
    await nextTask();
    await session.execute({ commands: [{ name: 'block.insert', args: { id: 'b', type: 'paragraph' } }] });
    Blok.YjsManager.undo();

    expect(ids(Blok)).toEqual(['p']);
  });

  it('R-U3: a user gesture between batches splits the steps', async () => {
    const Blok = await boot();
    const session = createEditorAgentSession(Blok, actor, { mergeSteps: 'turn' });

    await session.execute({ commands: [{ name: 'block.insert', args: { id: 'a', type: 'paragraph' } }] });
    await nextTask();
    Blok.YjsManager.beginGesture('discrete');
    await nextTask();
    await session.execute({ commands: [{ name: 'block.insert', args: { id: 'b', type: 'paragraph' } }] });
    Blok.YjsManager.undo();

    expect(ids(Blok)).toEqual(['p', 'a']);
  });
});
```

These use the live contract source, so 02's builders must be on `main`.

- [ ] **Step 2: Run them and watch R-U1 fail**

Run: `yarn test test/unit/components/modules/agent/editor-turn-merge.test.ts`
Expected: R-U1 FAILS (after undo, `a` is still there); R-U3 passes already.

- [ ] **Step 3: Write the lever**

`UndoHistory`:

```ts
  /** The next tracked write joins the newest step (an agent turn continuing). */
  public continueTopStep(): void {
    this.undoManager.lastChange = Date.now();
  }
```

`YjsManager`: `public continueTopUndoStep(): void { this.undoHistory.continueTopStep(); }`.

`BlockManager.beginToolTransaction` (line 1170):

```ts
  public beginToolTransaction(options: { continueStep?: boolean } = {}): void {
    if (this.toolTransactionDepth === 0) {
      if (options.continueStep !== true) {
        this.Blok.YjsManager.stopCapturing();
      }
      this.Blok.YjsManager.holdCapture();
      this.toolTransactionHoldsCapture = true;
      this.suppressBeforeToolTransaction = this.operations.suppressStopCapturing;
    }

    this.toolTransactionDepth++;
    this.operations.suppressStopCapturing = true;
  }
```

`EditorApplier`: add `mergeSteps?: 'batch' | 'turn'` to the constructor options, keep `private gesturesAtClose = -1;`, and open the bracket in `apply` with:

```ts
    const joins = this.options.mergeSteps === 'turn'
      && this.lastToken !== undefined
      && YjsManager.topUndoToken() === this.lastToken
      && YjsManager.gestureCount() === this.gesturesAtClose;

    if (joins) {
      BlockManager.beginToolTransaction({ continueStep: true });
      YjsManager.continueTopUndoStep();
    } else {
      YjsManager.beginApiCall();
      BlockManager.beginToolTransaction();
    }
```

and after the group closes and is tagged: `this.gesturesAtClose = YjsManager.gestureCount();`. `createEditorAgentSession` passes `mergeSteps: options.mergeSteps ?? 'batch'` into the applier.

- [ ] **Step 4: Run them, plus the undo suites**

Run: `yarn test test/unit/components/modules/agent/editor-turn-merge.test.ts test/unit/components/modules/agent/editor-session.test.ts test/unit/components/modules/yjs/undo-step-tags.test.ts test/unit/components/modules/api/blocks-transact-undo.integration.test.ts`
Expected: PASS. If R-U1 still fails because the second insert's own flat-index path calls `stopCapturing()` (`BlockManager.insertMany` / `operations` with `suppressStopCapturing`), log which call closes the step (a temporary `vi.spyOn(Blok.YjsManager, 'stopCapturing')` in the test), fix that one path, and remove the spy before committing.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/components/modules/blockManager/blockManager.ts src/components/modules/yjs/undo-history.ts src/components/modules/yjs/index.ts src/components/modules/agent/editor-applier.ts src/components/modules/agent/editor-session.ts test/unit/components/modules/agent/editor-turn-merge.test.ts
git add src/components/modules/blockManager/blockManager.ts src/components/modules/yjs/undo-history.ts src/components/modules/yjs/index.ts src/components/modules/agent/editor-applier.ts src/components/modules/agent/editor-session.ts test/unit/components/modules/agent/editor-turn-merge.test.ts
git commit -m "feat(agent): merge an agent turn's batches into one undo step when nothing came between

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 30: `block.move` into and out of existing columns

**Files:**
- Modify: `src/shared/agent/plan-block.ts` (`emitMove` calls the emptied-column helper)
- Test: `test/unit/shared/agent/plan-move-columns.test.ts`, `test/unit/components/modules/agent/editor-column-move.test.ts`

**Interfaces:**
- Consumes (**02** Task 38): `cleanupEmptiedColumnList(ctx: ToolActionContext, columnListId: string): boolean` from `src/shared/tool-actions/columns.ts` (06 01-Q7). It takes the LIST id and unwraps the list when exactly one column is left (survivors move to the list's own parent, then the column and the list are removed); it does not remove an emptied column itself. Task 14's `createActionContext`.
- Produces: after a `move` whose old parent is a `column` that is now empty, `emitMove` removes that column and then runs the helper on its list, which records the same `remove` / `move` edits the column tool does (unwrap when one column is left, `src/tools/column/index.ts:303-311`). Public `blocks.moveTo` keeps throwing for columns (the editor path passes no `allowColumnMoves`).

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/shared/agent/plan-move-columns.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutputData } from '../../../../types';
import { planOn } from './fixtures';

const doc: OutputData = { blocks: [
  { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
  { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['x'] },
  { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['y'] },
  { id: 'x', type: 'paragraph', data: {}, parent: 'c1' },
  { id: 'y', type: 'paragraph', data: {}, parent: 'c2' },
] };

describe('block.move and columns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('moves the last block out of a column and cleans the emptied column up', () => {
    const { draft } = planOn(doc, [{ name: 'block.move', args: { id: 'x', position: 'start' } }]);

    expect(draft.has('c1')).toBe(false);
  });
});
```

```ts
// test/unit/components/modules/agent/editor-column-move.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blok } from '../../../../../src/blok';
import { Column, ColumnList, Paragraph } from '../../../../../src/tools';
import type { OutputData } from '../../../../../types';

let holder: HTMLDivElement;

describe('column moves stay refused on the public API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    holder.remove();
    vi.restoreAllMocks();
  });

  it('blocks.moveTo into a column still throws', async () => {
    const data: OutputData = { blocks: [
      { id: 'p', type: 'paragraph', data: { text: 'p' } },
      { id: 'cl', type: 'column_list', data: {}, content: ['c1'] },
      { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['x'] },
      { id: 'x', type: 'paragraph', data: { text: 'x' }, parent: 'c1' },
    ] };
    const editor = new Blok({ holder, tools: { paragraph: Paragraph, column_list: ColumnList as never, column: Column as never }, data }) as unknown as {
      isReady: Promise<unknown>; blocks: { moveTo(id: string, target: unknown): void }; destroy(): void;
    };

    await editor.isReady;

    expect(() => editor.blocks.moveTo('p', { parentId: 'c1', position: 'start' })).toThrow(/column/);
    editor.destroy();
  });
});
```

**Unverified:** the export names `Column` / `ColumnList` from `src/tools`; use the names `src/tools/index.ts` exports for the `column` and `column_list` registry keys (`src/tools/index.ts:99`).

- [ ] **Step 2: Run them and watch the planner one fail**

Run: `yarn test test/unit/shared/agent/plan-move-columns.test.ts test/unit/components/modules/agent/editor-column-move.test.ts`
Expected: the planner test FAILS (`c1` still exists); the public-API test PASSES (it guards that nothing public changed).

- [ ] **Step 3: Call the helper from `emitMove`**

At the end of `emitMove` in `src/shared/agent/plan-block.ts`, after `state.emit({ op: 'move', … })`:

```ts
import { cleanupEmptiedColumnList } from '../tool-actions/columns';
import { createActionContext } from './tool-action-context';

  const oldParent = block.parent === null ? undefined : state.draft.get(block.parent);

  if (oldParent?.type === 'column' && oldParent.content.length === 0) {
    const list = oldParent.parent === null ? undefined : state.draft.get(oldParent.parent);
    const ctx = createActionContext(state, undefined, list?.type ?? 'column_list');

    ctx.remove(oldParent.id);
    if (list !== undefined) {
      cleanupEmptiedColumnList(ctx, list.id);
    }
  }
```

`block.parent` here is read from the snapshot **before** the move edit (capture `const previousParent = block.parent;` at the top of `emitMove` and use it, because `state.emit` mutates the draft). `tool-action-context.ts` already imports `plan-block.ts`; to avoid a cycle, move `createActionContext` into its own module `src/shared/agent/action-context.ts` if the bundler reports a cycle at runtime.

On the editor side, `EditorApplier` already skips a `remove` whose block is gone, in case the column tool cleaned up first. The editor parity case `move-out-of-column` (added to the corpus in Task 32) pins that both sides end equal.

- [ ] **Step 4: Run them**

Run: `yarn test test/unit/shared/agent/plan-move-columns.test.ts test/unit/shared/agent/plan-move-convert.test.ts test/unit/components/modules/agent/editor-column-move.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/shared/agent/plan-block.ts test/unit/shared/agent/plan-move-columns.test.ts test/unit/components/modules/agent/editor-column-move.test.ts
git add src/shared/agent/plan-block.ts test/unit/shared/agent/plan-move-columns.test.ts test/unit/components/modules/agent/editor-column-move.test.ts
git commit -m "feat(agent): block.move across existing columns with the shared emptied-column cleanup

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 31: Editor integration pins

**Files:**
- Test: `test/unit/components/modules/agent/editor-pins.test.ts`
- Modify (only if a pin fails): `src/components/modules/agent/editor-applier.ts`

**Interfaces:**
- Consumes: Tasks 22–29.
- Produces: tests for the unverified editor claims of 01 §3.3, §3.4, §3.6, §3.7, §3.13 and 06 R3-6, C3, 02-Q4, B8. Each pin names its fallback; apply the fallback only when the pin fails.

- [ ] **Step 1: Write the pins**

```ts
// test/unit/components/modules/agent/editor-pins.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Core } from '../../../../../src/components/core';
import { createEditorAgentSession } from '../../../../../src/components/modules/agent/editor-session';
import { Database, Header, Paragraph } from '../../../../../src/tools';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { OutputData } from '../../../../../types';

let holder: HTMLDivElement;
const actor = { id: 'agent-1', name: 'Agent', kind: 'agent' as const };

const boot = async (data: OutputData, extra: Record<string, unknown> = {}): Promise<BlokModules> => {
  const core = new Core({
    holder, user: { id: 'human-1' }, ...extra,
    tools: { paragraph: { class: Paragraph }, header: { class: Header as never }, database: { class: Database as never } },
    data,
  });

  await core.isReady;

  return core.moduleInstances as BlokModules;
};

const two: OutputData = { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'Alpha' } }, { id: 'b', type: 'paragraph', data: { text: 'Beta' } }] };

describe('editor pins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    holder.remove();
    vi.restoreAllMocks();
  });

  it('R3-6: doc.setTitle inside a batch is undone with the batch', async () => {
    const Blok = await boot(two);
    const session = createEditorAgentSession(Blok, actor);

    await session.execute({ commands: [{ name: 'block.insert', args: { type: 'paragraph' } }, { name: 'doc.setTitle', args: { title: 'New' } }] });
    Blok.YjsManager.undo();

    expect(Blok.YjsManager.getPageFields()).toEqual({});
    expect(Blok.YjsManager.toJSON()).toHaveLength(2);
    // Fallback if this fails: in EditorApplier, write the page map with writePageField inside the open group instead of setPageField.
  });

  it('C3: a block the user edits during the apply window keeps the human id', async () => {
    const Blok = await boot(two);
    const session = createEditorAgentSession(Blok, actor);
    const running = session.execute({ commands: [{ name: 'text.format', args: { id: 'a', range: 'all', set: { bold: true } } }] });

    await Blok.API.methods.blocks.update('b', { text: 'Beta typed' });
    await running;
    await new Promise(resolve => setTimeout(resolve, 0));

    const saved = Blok.YjsManager.toJSON();

    expect(saved.find(block => block.id === 'a')?.lastEditedBy).toBe('agent-1');
    expect(saved.find(block => block.id === 'b')?.lastEditedBy).toBe('human-1');
  });

  it('B8: a write to the block holding the caret leaves the caret where it was', async () => {
    const Blok = await boot(two);
    const session = createEditorAgentSession(Blok, actor);
    const input = Blok.BlockManager.getBlockById('a')?.inputs[0] as HTMLElement;
    const range = document.createRange();

    range.setStart(input.firstChild as Node, 2);
    range.collapse(true);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);

    await session.execute({ commands: [{ name: 'text.insert', args: { id: 'a', at: 5, text: '!' } }] });

    const after = document.getSelection()?.getRangeAt(0);

    expect(after?.startOffset).toBe(2);
    expect(input.contains(after?.startContainer ?? null)).toBe(true);
  });

  it('D5 second half: block.convert data is sanitized on the agent path', async () => {
    const Blok = await boot(two);
    const session = createEditorAgentSession(Blok, actor);

    await session.execute({ commands: [{ name: 'block.convert', args: { id: 'a', type: 'header', data: { text: [{ text: 'x', marks: { link: { href: 'javascript:alert(1)' } } }] } } }] });

    expect(JSON.stringify(Blok.YjsManager.toJSON())).not.toMatch(/javascript:/);
  });

  it('02-Q4: block.update on a database keeps its rows attached', async () => {
    const Blok = await boot({ blocks: [
      { id: 'db', type: 'database', data: { title: 'DB' }, content: ['r1'] },
      { id: 'r1', type: 'database-row', data: { properties: {} }, parent: 'db' },
    ] });
    const session = createEditorAgentSession(Blok, actor);

    await session.execute({ commands: [{ name: 'block.update', args: { id: 'db', data: { title: 'Renamed' } } }] });

    expect(Blok.YjsManager.toJSON().find(block => block.id === 'r1')?.parent).toBe('db');
    // Fallback if this fails: add setData to the database tool (06 02-Q4) in its own task, test first.
  });

  it('01 §3.3: typing still being saved is in the snapshot', async () => {
    const Blok = await boot(two);
    const session = createEditorAgentSession(Blok, actor);
    const input = Blok.BlockManager.getBlockById('b')?.inputs[0] as HTMLElement;

    input.textContent = 'Beta typed';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));

    expect((await session.read({ ids: ['b'] })).blocks[0].data?.text).toEqual([{ text: 'Beta typed' }]);
  });
});
```

**Unverified:** that `Database` is exported from `src/tools` under that name and that a `database` block with one `database-row` child boots from this minimal data; fix the fixture (not the expectation) to the smallest data the database tool accepts, as in `test/unit/tools/database/*.test.ts`.

- [ ] **Step 2: Run them**

Run: `yarn test test/unit/components/modules/agent/editor-pins.test.ts`
Expected: each pin PASSES, or FAILS and names its fallback. For each failing pin: write down the failure, apply the fallback named in the test (or the fix below), and re-run until it passes.
- B8 fails → `keepingCaret` in `EditorApplier` must capture before the write's first `await` and restore after the block re-renders; await `this.settle()` before `restore()`.
- "typing still being saved" fails → `EditorApplier.settle()` must also call `this.Blok.YjsManager.flushPendingBlockWrites()` (`yjs/index.ts:841`) before waiting.

- [ ] **Step 3: Commit**

```bash
npx eslint test/unit/components/modules/agent/editor-pins.test.ts src/components/modules/agent/editor-applier.ts
git add test/unit/components/modules/agent/editor-pins.test.ts src/components/modules/agent/editor-applier.ts
git commit -m "test(agent): pin the editor-side undo, attribution, caret and sanitize claims

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 32: Editor parity runner (jsdom)

05 owns the corpus, the goldens and the Playwright `editor` runner (05 Tasks 6, 7, 11). This task adds the fast jsdom `EditorApplier` runner over the same corpus, importing 05's helpers (05 cross-plan: "01's runner imports `loadParityCases`, `runCorpusCase`, `normalizeForParity`, `callerChosenIds`, `compareToGolden` from `test/unit/agent/parity/`; it adds only the jsdom runner"). It creates no corpus file of its own.

**Files:**
- Create: `test/unit/agent/applier-parity.editor.test.ts`, `test/fixtures/agent-commands/cases/01-insert-callout-explicit-children.json`, `01-insert-toggle-explicit-children.json`, `01-move-out-of-column.json`

**Interfaces:**
- Consumes (**05** Tasks 6, 7): `loadParityCases`, `expectationFor(c, 'editor')`, `callerChosenIds`, `normalizeForParity`, `runCorpusCase`, `compareToGolden` from `test/unit/agent/parity/{corpus,normalize,run-case}.ts`. Task 28 `createEditorAgentSession`; the editor's `save()`.
- Produces: the jsdom `editor` runner. Review Focus 4 is the `01-delete-everything` case: the editor must not add a default block (the applier removes with `addLastBlock: false`).

- [ ] **Step 1: Add the container cases to the corpus**

Three more JSON cases in 05's format, seed = Task 21's `PARITY_SEED`, one batch each. Source data:

```ts
  { name: 'insert-callout-explicit-children', batch: { commands: [{ name: 'block.insert', args: { id: 'co', type: 'callout', children: [{ id: 'co1', type: 'paragraph', data: { text: 'only me' } }] } }] } },
  { name: 'insert-toggle-explicit-children', batch: { commands: [{ name: 'block.insert', args: { id: 'tz', type: 'toggle', children: [{ id: 'tz1', type: 'paragraph' }] } }] } },
  { name: 'move-out-of-column', batch: { commands: [
    { name: 'block.insert', args: { id: 'cl2', type: 'column_list', children: [
      { id: 'cA', type: 'column', children: [{ id: 'xA', type: 'paragraph', data: { text: 'A' } }] },
      { id: 'cB', type: 'column', children: [{ id: 'xB', type: 'paragraph', data: { text: 'B' } }] },
    ] } },
    { name: 'block.move', args: { id: 'xA', position: 'end' } },
  ] } },
```

Their goldens come from 05's `json` runner (`BLOK_UPDATE_GOLDENS=1 yarn test test/unit/agent/parity/json-runner.test.ts`), written `reviewed: false`; read each and set `reviewed` (05 Task 7). The two "explicit children" cases are 01 §6 "one case per built-in container inserted with explicit children → no seeded extras"; add one per container the built-in registry has (`tabs`, toggle heading; a table goes through `table.create`, Task 8 Step 7).

- [ ] **Step 2: Write the editor runner**

The runner reads every case from 05's loader, so 05's own cases run here too. The built-in tool list must cover every type the corpus uses; add a tool when a case fails with `UNKNOWN_TOOL`.

```ts
// test/unit/agent/applier-parity.editor.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Core } from '../../../src/components/core';
import { createEditorAgentSession } from '../../../src/components/modules/agent/editor-session';
import * as Tools from '../../../src/tools';
import type { BlokModules } from '../../../src/types-internal/blok-modules';
import { callerChosenIds, expectationFor, loadParityCases } from './parity/corpus';
import { normalizeForParity } from './parity/normalize';
import { compareToGolden, runCorpusCase } from './parity/run-case';

const actor = { id: 'agent-test', name: 'Parity', kind: 'agent' as const };   // = 05's TEST_ACTOR
let holder: HTMLDivElement;

const builtInTools = (): Record<string, { class: unknown }> => ({
  paragraph: { class: Tools.Paragraph }, header: { class: Tools.Header }, toggle: { class: Tools.Toggle },
  quote: { class: Tools.Quote }, callout: { class: Tools.Callout }, column_list: { class: Tools.ColumnList }, column: { class: Tools.Column },
});

describe('applier parity — EditorApplier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    holder.remove();
    vi.restoreAllMocks();
  });

  it.each(loadParityCases().map(c => [c.name, c] as const))('%s', async (_name, c) => {
    const core = new Core({ holder, tools: builtInTools() as never, data: c.seed });

    await core.isReady;
    const Blok = core.moduleInstances as BlokModules;

    expect(await runCorpusCase(createEditorAgentSession(Blok, actor), c)).toEqual(expectationFor(c, 'editor'));
    await new Promise(resolve => setTimeout(resolve, 0));

    compareToGolden(c, normalizeForParity(await Blok.Saver.save() as never, callerChosenIds(c)));
  });
});
```

**Unverified:** the `src/tools` export names in `builtInTools` (check `src/tools/index.ts`), and that `Saver.save()` (default dialect) returns segments for rich fields like the golden; if it returns the internal dialect, call it with the host dialect the public `blok.save()` uses.

- [ ] **Step 3: Run it**

Run: `yarn test test/unit/agent/applier-parity.editor.test.ts`
Expected: PASS for every case. A difference is either a planner bug (fix the planner, regenerate the `json` goldens, re-run every runner) or an editor-only behaviour (a container seeding children under origin `'api'` despite explicit `content`, 01 §3.5 unverified): then the fix is in that tool, in its own task with a failing test first. A case the editor legitimately refuses gets an `expectByRunner.editor` error code with the open bug named in the case's commit message; never a silent skip.

- [ ] **Step 4: Commit**

```bash
npx eslint test/unit/agent/applier-parity.editor.test.ts
git add test/unit/agent/applier-parity.editor.test.ts test/fixtures/agent-commands/cases/01-insert-callout-explicit-children.json test/fixtures/agent-commands/cases/01-insert-toggle-explicit-children.json test/fixtures/agent-commands/cases/01-move-out-of-column.json test/fixtures/agent-commands/goldens
git commit -m "test(agent): jsdom EditorApplier runner over the shared parity corpus

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 33: E2E — one Cmd+Z undoes an agent batch

**Files:**
- Create: `test/playwright/tests/agent/agent-commands.spec.ts`

**Interfaces:**
- Consumes (**03** Task 9): `blok.agent.begin({ agent: { id, name } }): AgentTurn` (`AgentTurnOptions`, 03 Task 1) with `turn.execute(batch)` — the public in-app surface. This task waits for 03's `AgentAPI` on `main`.
- Produces: the 01 §6 E2E: an in-app session inserts a toggle with children and bolds a range; the user presses Cmd/Ctrl+Z once; both edits are gone.

- [ ] **Step 1: Write the failing spec**

```ts
// test/playwright/tests/agent/agent-commands.spec.ts
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const mount = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async (list) => {
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.setAttribute('data-blok-testid', 'blok');
    document.body.appendChild(holder);
    const blok = new window.Blok({ holder: 'blok', data: { blocks: list } });

    window.blokInstance = blok;
    await blok.isReady;
  }, blocks);
};

test.describe('agent commands', () => {
  test('one undo removes an agent batch', async ({ page }) => {
    await mount(page, [{ id: 'p', type: 'paragraph', data: { text: 'Hello world' } }]);

    const result = await page.evaluate(async () => {
      const turn = (window.blokInstance as unknown as { agent: { begin(options: { agent: { id: string; name: string } }): { execute(b: unknown): Promise<{ ok: boolean }>; end(): void } } }).agent.begin({ agent: { id: 'agent-e2e', name: 'Agent' } });
      const out = await turn.execute({ commands: [
        { name: 'block.insert', args: { type: 'toggle', data: { text: 'Details' }, children: [{ type: 'paragraph', data: { text: 'inside' } }] } },
        { name: 'text.format', args: { id: 'p', range: { find: 'world' }, set: { bold: true } } },
      ] });

      turn.end();

      return out;
    });

    expect(result.ok).toBe(true);
    await expect(page.getByTestId('blok').getByText('Details')).toBeVisible();

    const isMac = await page.evaluate(() => navigator.userAgent.toLowerCase().includes('mac'));

    await page.getByTestId('blok').getByText('Hello').click();
    await page.keyboard.press(`${isMac ? 'Meta' : 'Control'}+z`);

    await expect(page.getByTestId('blok').getByText('Details')).toHaveCount(0);
    await expect.poll(() => page.evaluate(async () => (await window.blokInstance?.save())?.blocks[0]?.data.text)).toEqual([{ text: 'Hello world' }]);
  });
});
```

Clicking into the paragraph before Cmd+Z is the user's gesture that would split a merged turn; here the turn ended, and the agent step is the top step, so one press undoes it.

- [ ] **Step 2: Run it**

Run: `yarn e2e test/playwright/tests/agent/agent-commands.spec.ts -g "one undo removes an agent batch"`
Expected before 03 lands: FAIL with `Cannot read properties of undefined (reading 'begin')`. After 03's `AgentAPI` is on `main`: PASS.

- [ ] **Step 3: Commit**

```bash
npx eslint test/playwright/tests/agent/agent-commands.spec.ts
git add test/playwright/tests/agent/agent-commands.spec.ts
git commit -m "test(e2e): one undo removes an in-app agent batch

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Checkpoint 2

- [ ] `for f in test/unit/components/modules/agent/*.test.ts test/unit/components/modules/yjs/undo-step-tags.test.ts test/unit/components/modules/blockManager/agent-attribution.test.ts test/unit/agent/applier-parity*.test.ts test/unit/components/modules/api/blocks-insert-sanitize.test.ts test/unit/architecture/agent-*.test.ts; do yarn test "$f" || break; done` — all PASS. Update the silent-failure law's `EXEMPT` for any new `src/components/modules/agent/` file, with a reason per entry.
- [ ] `yarn e2e test/playwright/tests/agent/agent-commands.spec.ts` — PASS (once 03 is on `main`).
- [ ] `NODE_OPTIONS=--max-old-space-size=8192 yarn lint:types` — PASS.
- [ ] `git pull --rebase && git push`; `git status` up to date.
- [ ] Tell 03 that `createEditorAgentSession`, `InternalEditorHandle`, `mergeSteps: 'turn'` and `detail.agent` are on `main`. Remind the user that the D5 BREAKING change needs a release note.

---

## Phase 3 — StoreApplier (Node, live rooms)

### Task 34: `StoreApplier`

**Files:**
- Create: `src/components/modules/agent/store-applier.ts`
- Test: `test/unit/components/modules/agent/store-applier.test.ts` (node env)

**Interfaces:**
- Consumes: `DocumentStore` (`src/components/modules/yjs/document-store.ts`): `toJSON` (`:353`), `page` (`:222`), `addBlockAt` (`:681`), `removeBlock` (`:722`), `replaceBlockContent` (`:751`), `moveBlockTo` (`:824`), `updateBlockData` (`:1363`), `updateBlockTune` (`:2216`), `updateBlockMetadata` (`:2244`), `transact(fn, 'local')` (`:2281`), `onAnyUpdate` (`:2428`); `YBlockSerializer.toRichSegments` (`serializer.ts:372`); `readPageFields`, `writePageField` (`page-fields.ts:25`, `:35`).
- Produces: `class StoreApplier implements AgentApplier` with `constructor(store: DocumentStore, options: { actorId: string; richTextFieldsFor(type: string): string[]; htmlToSegments(html: string): RichText })`, `runtime = 'node-live'`, `isReadOnly()` (true after an `APPLY_FAILED`), `revision()` = `"l<n>"` counter over `onAnyUpdate`, `snapshot()` from `toJSON()` + `readPageFields(store.page)`, `apply(plan)` = one `store.transact(…, 'local')` with the mapping of 01 §3.4 (StoreApplier table), stamping `updateBlockMetadata(id, now, actorId)` on every id in `plan.touched` that still exists. No `undo` / `redo` (live → `COMMAND_UNAVAILABLE`, D6). `dispose()`.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/components/modules/agent/store-applier.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreApplier } from '../../../../../src/components/modules/agent/store-applier';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import type { Plan } from '../../../../../src/shared/agent/types';
import { htmlToSegmentsNode } from '../../../../../src/view/rich-text-parse5';
import type { Edit } from '../../../../../types';

const fields = (type: string): string[] => (type === 'paragraph' || type === 'toggle' ? ['text'] : []);
const fresh = (): DocumentStore => {
  const store = new DocumentStore(new YBlockSerializer({ htmlToSegments: htmlToSegmentsNode, richTextFieldsFor: fields }));

  store.fromJSON([
    { id: 'tg', type: 'toggle', data: { text: [{ text: 'T' }] }, content: ['a', 'b'] },
    { id: 'a', type: 'paragraph', data: { text: [{ text: 'A' }], keep: 1 }, parent: 'tg' },
    { id: 'b', type: 'paragraph', data: { text: [] }, parent: 'tg' },
  ]);

  return store;
};
const plan = (edits: Edit[], touched: string[] = []): Plan => ({ edits, results: [], refs: {}, changed: { created: [], updated: [], moved: [], removed: [] }, warnings: [], touched: new Set(touched) });
const applierOn = (store: DocumentStore): StoreApplier => new StoreApplier(store, { actorId: 'agent-1', richTextFieldsFor: fields, htmlToSegments: htmlToSegmentsNode });

describe('StoreApplier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies a batch as one local update', async () => {
    const store = fresh();
    const updates: unknown[] = [];

    store.onUpdate((_update, origin) => updates.push(origin));
    await applierOn(store).apply(plan([
      { op: 'insert', parentId: null, afterId: 'tg', block: { id: 'n', type: 'paragraph', data: { text: [{ text: 'N' }] }, children: [] } },
      { op: 'setRichText', id: 'a', field: 'text', value: [{ text: 'A!', marks: { bold: true } }] },
    ], ['n', 'a']), null as never);

    expect(updates).toEqual(['local']);
  });

  it('lifts children on remove without children, and deletes a null key', async () => {
    const store = fresh();
    const applier = applierOn(store);

    await applier.apply(plan([{ op: 'setData', id: 'a', patch: { keep: null } }, { op: 'remove', id: 'tg', withChildren: false }], ['a']), null as never);

    const out = applier.snapshot().toOutput();

    expect(out.blocks.map(block => block.id)).toEqual(['a', 'b']);
    expect(out.blocks[0].data).toEqual({ text: [{ text: 'A' }] });
    expect(out.blocks[0].lastEditedBy).toBe('agent-1');
    expect(out.blocks[1].lastEditedBy).toBeUndefined();
  });

  it('writes the page map', async () => {
    const store = fresh();
    const applier = applierOn(store);

    await applier.apply(plan([{ op: 'setPageField', key: 'title', value: 'Live' }]), null as never);

    expect(applier.snapshot().title).toBe('Live');
  });

  it('goes read-only after a throw mid-apply', async () => {
    const store = fresh();
    const applier = applierOn(store);

    vi.spyOn(store, 'moveBlockTo').mockImplementation(() => {
      throw new Error('boom');
    });

    await expect(applier.apply(plan([{ op: 'move', id: 'a', parentId: null, afterId: null }]), null as never)).rejects.toThrow('boom');
    expect(applier.isReadOnly()).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `yarn test test/unit/components/modules/agent/store-applier.test.ts`
Expected: FAIL with `Failed to resolve import ".../store-applier"`.

- [ ] **Step 3: Write the applier**

```ts
// src/components/modules/agent/store-applier.ts
import type { Edit, PlannedBlock } from '../../../../types/agent';
import type { OutputData } from '../../../../types/data-formats/output-data';
import type { RichText } from '../../../../types/rich-text';
import type { AgentApplier } from '../../../shared/agent/executor';
import { DocSnapshot } from '../../../shared/agent/snapshot';
import type { Plan } from '../../../shared/agent/types';
import type { DocumentStore } from '../yjs/document-store';
import { readPageFields, writePageField } from '../yjs/page-fields';

export class StoreApplier implements AgentApplier {
  public readonly runtime = 'node-live' as const;
  private count = 0;
  private broken = false;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly store: DocumentStore,
    private readonly options: { actorId: string; richTextFieldsFor(type: string): string[]; htmlToSegments(html: string): RichText }
  ) {
    this.unsubscribe = store.onAnyUpdate(() => {
      this.count++;
    });
  }

  public isReadOnly(): boolean {
    return this.broken;
  }

  public revision(): string {
    return `l${this.count}`;
  }

  public dispose(): void {
    this.unsubscribe();
  }

  public snapshot(): DocSnapshot {
    const blocks = this.store.toJSON().map(block => ({
      ...block,
      data: Object.fromEntries(Object.entries(block.data).map(([key, value]) =>
        [key, this.options.richTextFieldsFor(block.type).includes(key) && typeof value === 'string' ? this.options.htmlToSegments(value) : value])),
    }));

    return DocSnapshot.fromOutput({ ...readPageFields(this.store.page), blocks } as OutputData);
  }

  public apply(plan: Plan): Promise<void> {
    const at = Date.now();
    // touched = created and updated ids (PlanState.emit); moves and removals stamp nothing.
    const stamped = plan.touched;

    try {
      this.store.transact(() => {
        plan.edits.forEach(edit => this.applyOne(edit));
        stamped.forEach((id) => {
          if (this.store.getBlockById(id) !== undefined) {
            this.store.updateBlockMetadata(id, at, this.options.actorId);
          }
        });
      }, 'local');
    } catch (error) {
      // Yjs has no rollback: what ran before the throw is committed and sent.
      this.broken = true;

      return Promise.reject(error);
    }

    return Promise.resolve();
  }

  private insertTree(block: PlannedBlock, parentId: string | null, afterId: string | null): void {
    this.store.addBlockAt({ id: block.id, type: block.type, data: block.data, ...(block.tunes !== undefined && { tunes: block.tunes }) }, { parentId, afterId });
    block.children.reduce<string | null>((previous, child) => {
      this.insertTree(child, block.id, previous);

      return child.id;
    }, null);
  }

  private childrenOf(id: string): string[] {
    return this.store.toJSON().find(block => block.id === id)?.content ?? [];
  }

  private applyOne(edit: Edit): void {
    switch (edit.op) {
      case 'insert':
        this.insertTree(edit.block, edit.parentId, edit.afterId);
        break;
      case 'remove': {
        if (edit.withChildren) {
          const walk = (id: string): string[] => [...this.childrenOf(id).flatMap(walk), id];

          walk(edit.id).forEach(id => this.store.removeBlock(id));
          break;
        }

        const placement = this.store.getPlacement(edit.id);
        let after = placement?.afterId ?? null;

        for (const child of this.childrenOf(edit.id)) {
          this.store.moveBlockTo(child, { parentId: placement?.parentId ?? null, afterId: after });
          after = child;
        }
        this.store.removeBlock(edit.id);
        break;
      }
      case 'move':
        this.store.moveBlockTo(edit.id, { parentId: edit.parentId, afterId: edit.afterId });
        break;
      case 'setData':
        Object.entries(edit.patch).forEach(([key, value]) => this.store.updateBlockData(edit.id, key, value === null ? undefined : value));
        break;
      case 'setRichText':
        this.store.updateBlockData(edit.id, edit.field, edit.value);
        break;
      case 'setTunes':
        Object.entries(edit.tunes).forEach(([name, value]) => this.store.updateBlockTune(edit.id, name, value));
        break;
      case 'replaceType':
        this.store.replaceBlockContent(edit.id, edit.type, edit.data);
        break;
      case 'setPageField':
        writePageField(this.store.page, edit.key, edit.value);
        break;
    }
  }
}
```

`store.getPlacement(id)` is `document-store.ts:961`. **Unverified:** that `writePageField` on `store.page` inside `store.transact` joins the same transaction (it writes to a map of the same doc, so it should); "applies a batch as one local update" pins the single update.

- [ ] **Step 4: Run it to make sure it passes**

Run: `yarn test test/unit/components/modules/agent/store-applier.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/components/modules/agent/store-applier.ts test/unit/components/modules/agent/store-applier.test.ts
git add src/components/modules/agent/store-applier.ts test/unit/components/modules/agent/store-applier.test.ts
git commit -m "feat(agent): StoreApplier writes a DocumentStore in one local transaction

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 35: `createStoreAgentSession`

**Files:**
- Create: `src/components/modules/agent/store-session.ts`
- Test: `test/unit/components/modules/agent/store-session.test.ts` (node env)

**Interfaces:**
- Consumes: Task 34; Task 17 `plannerContextFrom`, `describeContract`, `createPageMapBackend`; Task 16 `runBatch`. **02**: table `ToolRuntime.normalize` must exist before 04 lets agents write tables in live mode (06 C17); this task's test for tables is skipped with that reason until it does.
- Produces: `createStoreAgentSession(input: { store: DocumentStore; tools: ToolRuntimeRegistry; contract: AgentContract; actor: AgentActor; ports: AgentPorts; services?: Partial<Record<string, unknown>>; pageTitles?: 'page-map'; richTextFieldsFor(type: string): string[] }): AgentSession` (04 consumes). The contract passed in is built with `where.runtime = 'node-live'`, so `history.undo` / `redo` are already `available: false`; the applier has no `undo` either (`COMMAND_UNAVAILABLE`).

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/components/modules/agent/store-session.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStoreAgentSession } from '../../../../../src/components/modules/agent/store-session';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import { createHeadlessAgentSetup } from '../../../../../src/view/agent-runtime';
import { htmlToSegmentsNode } from '../../../../../src/view/rich-text-parse5';

const actor = { id: 'agent-1', name: 'Agent', kind: 'agent' as const };

const open = () => {
  const setup = createHeadlessAgentSetup({ runtime: 'node-live' });
  const store = new DocumentStore(new YBlockSerializer({ htmlToSegments: htmlToSegmentsNode, richTextFieldsFor: setup.richTextFieldsFor }));

  store.fromJSON([{ id: 'p', type: 'paragraph', data: { text: [{ text: 'P' }] } }]);

  return { store, session: createStoreAgentSession({ store, tools: setup.tools, contract: setup.contract, actor, ports: setup.ports, richTextFieldsFor: setup.richTextFieldsFor }) };
};

describe('createStoreAgentSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes against the live store and stamps the agent', async () => {
    const { store, session } = open();

    expect(await session.execute({ commands: [{ name: 'text.format', args: { id: 'p', range: 'all', set: { bold: true } } }] })).toMatchObject({ ok: true });
    expect(store.toJSON()[0]).toMatchObject({ lastEditedBy: 'agent-1' });
  });

  it('says undo is unavailable in a live room', async () => {
    expect(await open().session.execute({ commands: [{ name: 'history.undo', args: {} }] })).toMatchObject({ ok: false, error: { code: 'COMMAND_UNAVAILABLE', details: { reason: 'runtime' } } });
  });

  it('refuses a stale revision and accepts the current one', async () => {
    const { session } = open();
    const { revision } = await session.read();

    expect(await session.execute({ commands: [{ name: 'doc.read', args: {} }], expectRevision: 'l999' })).toMatchObject({ ok: false, error: { code: 'STALE' } });
    expect(await session.execute({ commands: [{ name: 'block.delete', args: { id: 'p' } }], expectRevision: revision })).toMatchObject({ ok: true });
  });

  it('goes read-only after APPLY_FAILED', async () => {
    const { store, session } = open();

    vi.spyOn(store, 'removeBlock').mockImplementation(() => {
      throw new Error('boom');
    });

    expect(await session.execute({ commands: [{ name: 'block.delete', args: { id: 'p' } }] })).toMatchObject({ ok: false, error: { code: 'APPLY_FAILED' } });
    expect(await session.execute({ commands: [{ name: 'doc.setTitle', args: { title: 'x' } }] })).toMatchObject({ ok: false, error: { code: 'READ_ONLY' } });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `yarn test test/unit/components/modules/agent/store-session.test.ts`
Expected: FAIL with `Failed to resolve import ".../store-session"`.

- [ ] **Step 3: Write the session**

```ts
// src/components/modules/agent/store-session.ts
import type { AgentActor, AgentSession, CommandLogEntry, DocumentView, ViewArgs } from '../../../../types/agent';
import type { AgentContract } from '../../../../types/tool-manifest';
import { plannerContextFrom } from '../../../shared/agent/context';
import { describeContract } from '../../../shared/agent/describe';
import { createPageMapBackend } from '../../../shared/agent/document-session';
import { failure } from '../../../shared/agent/errors';
import { runBatch } from '../../../shared/agent/executor';
import type { AgentPorts, PlannerToolRuntime } from '../../../shared/agent/types';
import { validateAgainst } from '../../../shared/schema/validate';
import type { DocumentStore } from '../yjs/document-store';
import { StoreApplier } from './store-applier';

let storeSessions = 0;

export const createStoreAgentSession = (input: {
  store: DocumentStore;
  tools: ReadonlyMap<string, PlannerToolRuntime>;
  contract: AgentContract;
  actor: AgentActor;
  ports: AgentPorts;
  services?: Partial<Record<string, unknown>>;
  pageTitles?: 'page-map';
  richTextFieldsFor(type: string): string[];
}): AgentSession => {
  const id = `store-session-${++storeSessions}`;
  const applier = new StoreApplier(input.store, { actorId: input.actor.id, richTextFieldsFor: input.richTextFieldsFor, htmlToSegments: input.ports.htmlToSegments });
  const services = {
    ...(input.services ?? {}),
    // prepare runs before the batch's snapshot is applied; read the block from the live store.
    ...(input.pageTitles === 'page-map' && input.ports.openPageDocument !== undefined && { pageBackend: createPageMapBackend(input.ports.openPageDocument, input.actor, blockId => applier.snapshot().get(blockId)) }),
  };
  const ctx = plannerContextFrom(input.contract, input.tools, input.ports, validateAgainst, services);
  const log: CommandLogEntry[] = [];
  let batchNo = 0;

  return {
    id,
    actor: input.actor,
    read: async (args: ViewArgs = {}): Promise<DocumentView> => {
      const result = await runBatch({ batch: { commands: [{ name: 'doc.read', args }] }, ctx, applier, actor: input.actor, log: [], batchNo: 0 });

      if (!result.ok) {
        throw failure(result.error.code, result.error.message);
      }

      return result.results[0] as DocumentView;
    },
    describe: query => describeContract(input.contract, query),
    execute: (batch, options = {}) => runBatch({ batch, ctx, applier, actor: input.actor, signal: options.signal, log, batchNo: ++batchNo }),
    log: () => [...log],
    close: () => applier.dispose(),
  };
};
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `yarn test test/unit/components/modules/agent/store-session.test.ts`
Expected: PASS (4 tests). The undo case relies on 02's `buildAgentContract` marking `history.undo` `available: false` for `'node-live'` (06 R3-1); if it does not, the executor's own guard (`applier.undo === undefined`) still returns `COMMAND_UNAVAILABLE`, and the `details.reason` is `'runtime'` either way.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/components/modules/agent/store-session.ts test/unit/components/modules/agent/store-session.test.ts
git add src/components/modules/agent/store-session.ts test/unit/components/modules/agent/store-session.test.ts
git commit -m "feat(agent): live-room sessions over a DocumentStore

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 36: Store parity runner — moved to 05 Task 8

05 owns the `store` runner (`test/unit/agent/parity/store-runner.test.ts`, 05 Task 8; 06 C1). Its harness calls `createStoreAgentSession` from `src/components/modules/agent/store-session.ts` (Task 35) with `createHeadlessAgentSetup({ runtime: 'node-live' })` (Task 21). Nothing to build here. A store-only difference that 05's runner finds is a `StoreApplier` mapping bug: fix it in `store-applier.ts` with a failing focused test in `store-applier.test.ts` first.

---

### Checkpoint 3

- [ ] `for f in test/unit/components/modules/agent/store-*.test.ts test/unit/agent/applier-parity.editor.test.ts test/unit/architecture/agent-*.test.ts; do yarn test "$f" || break; done` — all PASS. 05 Task 8 (`store` runner) can start.
- [ ] `git pull --rebase && git push`; `git status` up to date.
- [ ] Tell 04 and 05 that `createStoreAgentSession` is on `main`; remind them table writes in live mode wait for 02's table `normalize` (02 Task 15; 06 C17).

---
## Phase 4 — C# stored execution (Jint)

### Task 37: Jint op `agentExecute` (`manifest` is 02 Task 50's)

**Files:**
- Modify: `src/view/server-runtime.ts:375-493` (new `invoke` cases), `src/shared/agent/document-session.ts` (add `lastEdits()`), `test/unit/scripts/build-server-runtime.test.ts`
- Test: `test/unit/view/server-runtime-agent.test.ts` (node env), the build test

**Interfaces:**
- Consumes: Task 21 `createHeadlessAgentSetup`, Task 19 `loadStoredDocument`, Task 17 `createDocumentAgentSession`.
- Produces (06 §7.2, string in / string out):
  - `blokServerInvoke('agentExecute', JSON.stringify({ document, batch, actor, customTools?, overrides?, services? }))` → `JSON.stringify({ result: AgentResult, document: OutputData, edits: Edit[] })`. `edits` are the edits the batch applied (empty on failure). One call is one batch; reads run through it too. Revision is the stored content hash.
  - Not here: `blokServerInvoke('manifest', …)` is owned and built by **02 Task 50** (one owner, no conditional copy). This task starts after 02 Task 50 is on `main`, and Task 38's `GetContractAsync` calls that op.
  - `createDocumentAgentSession(...).lastEdits(): readonly Edit[]`.
  - Malformed input throws `TypeError` with a message naming the missing field, like every other op (`server-runtime.ts:493`).

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/view/server-runtime-agent.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '../../../src/view/server-runtime';

const actor = { id: 'agent-jint', name: 'Server agent', kind: 'agent' };
const document = { blocks: [{ id: 'p', type: 'paragraph', data: { text: 'Hello world' } }] };

describe('server runtime agentExecute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs a batch on a stored document and returns the edits', async () => {
    const out = JSON.parse(await invoke('agentExecute', JSON.stringify({
      document, actor, batch: { commands: [{ name: 'text.format', args: { id: 'p', range: { find: 'world' }, set: { bold: true } } }] },
    })));

    expect(out.result).toMatchObject({ ok: true, revision: expect.stringMatching(/^h/) });
    expect(out.document.blocks[0].data.text).toEqual([{ text: 'Hello ' }, { text: 'world', marks: { bold: true } }]);
    expect(out.edits).toEqual([{ op: 'setRichText', id: 'p', field: 'text', value: out.document.blocks[0].data.text }]);
  });

  it('says undo is unavailable', async () => {
    const out = JSON.parse(await invoke('agentExecute', JSON.stringify({ document, actor, batch: { commands: [{ name: 'history.undo', args: {} }] } })));

    expect(out.result).toMatchObject({ ok: false, error: { code: 'COMMAND_UNAVAILABLE' } });
    expect(out.edits).toEqual([]);
  });

  it('refuses input with no document', async () => {
    await expect(invoke('agentExecute', JSON.stringify({ actor, batch: { commands: [] } }))).rejects.toThrow(/document/);
  });
});
```

Add to `test/unit/scripts/build-server-runtime.test.ts`, after the "loads and converts in a realm with no host globals" case:

```ts
  it('runs agentExecute in a realm with no host globals', async () => {
    const outputPath = await buildServerRuntime(outDir);
    const source = readFileSync(outputPath, 'utf8');
    const sandbox: Record<string, unknown> = {};

    runInContext(source, createContext(sandbox));

    const invoke = sandbox.blokServerInvoke as (op: string, input: string) => Promise<string>;
    const executed = JSON.parse(await invoke('agentExecute', JSON.stringify({
      document: { blocks: [{ id: 'p', type: 'paragraph', data: { text: 'x' } }] },
      actor: { id: 'a', name: 'A', kind: 'agent' },
      batch: { commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'y' } } }] },
    })));

    expect(executed.result.ok).toBe(true);
    expect(executed.document.blocks).toHaveLength(2);
    // A loose ceiling so a runaway import shows up here; 05 owns the real size budget.
    expect(source.length).toBeLessThan(4 * 1024 * 1024);
  });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `yarn test test/unit/view/server-runtime-agent.test.ts`
Expected: FAIL with `Unsupported Blok runtime operation: agentExecute`.

- [ ] **Step 3: Write the ops**

In `src/shared/agent/document-session.ts`, keep the last applied plan's edits: in the applier's `apply`, set `lastEdits = plan.edits` (declare `let lastEdits: readonly Edit[] = [];` and reset it to `[]` at the start of `execute`), and return `lastEdits: () => lastEdits` beside `output`.

In `src/view/server-runtime.ts`, add the imports and the case before `default:` (02 Task 50's `manifest` case is already there):

```ts
import { createDocumentAgentSession } from '../shared/agent/document-session';
import { createHeadlessAgentSetup, loadStoredDocument } from './agent-runtime';
import type { AgentActor, AgentBatch } from '../../types/agent';

const requireField = (input: Record<string, unknown>, key: string, op: string): unknown => {
  if (input[key] === undefined || input[key] === null) {
    throw new TypeError(`${op} input requires \`${key}\`.`);
  }

  return input[key];
};

    case 'agentExecute': {
      const input = parseRecord(inputJson);
      const setup = createHeadlessAgentSetup({
        customTools: input.customTools as never, overrides: input.overrides as never, services: (input.services ?? []) as never, runtime: 'jint',
      });
      const session = createDocumentAgentSession({
        document: loadStoredDocument(requireField(input, 'document', 'agentExecute') as OutputData, setup.richTextFieldsFor),
        tools: setup.tools, contract: setup.contract, actor: requireField(input, 'actor', 'agentExecute') as AgentActor, ports: setup.ports, runtime: 'jint',
      });
      const result = await session.execute(requireField(input, 'batch', 'agentExecute') as AgentBatch);

      return JSON.stringify({ result, document: session.output(), edits: session.lastEdits() });
    }
```

`parseRecord` is the existing helper used by `pageIndex` (line 476). **Unverified:** that the whole planner and 02's modules run in the bare realm (no `structuredClone`, `crypto`, `TextEncoder`). The build test is the check; a failure names the missing global — replace that use with a pure one in the module that needs it.

- [ ] **Step 4: Run them**

Run: `yarn test test/unit/view/server-runtime-agent.test.ts`
Expected: PASS (3 tests).
Run: `yarn test test/unit/scripts/build-server-runtime.test.ts`
Expected: PASS, including the new case.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/view/server-runtime.ts src/shared/agent/document-session.ts test/unit/view/server-runtime-agent.test.ts test/unit/scripts/build-server-runtime.test.ts
git add src/view/server-runtime.ts src/shared/agent/document-session.ts test/unit/view/server-runtime-agent.test.ts test/unit/scripts/build-server-runtime.test.ts
git commit -m "feat(server-runtime): agentExecute op runs a batch on a stored document

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 38: `IBlokAgentExecutor` with `ExecuteAsync` and `GetContractAsync`

**Files:**
- Create: `packages/server/dotnet/Blok.Server/Agent/IBlokAgentExecutor.cs`, `packages/server/dotnet/Blok.Server/Agent/BlokAgentExecutor.cs`
- Modify: `packages/server/dotnet/Blok.Server/Documents/BlokDocuments.cs` (add `CreateAgentExecutor`), `packages/server/dotnet/Blok.Server.AspNetCore/BlokDocumentsServiceCollectionExtensions.cs:76` (register next to `IBlokDocumentConverter`)
- Test: `packages/server/dotnet/Blok.Server.Tests/Agent/BlokAgentExecutorTests.cs`

**Interfaces:**
- Consumes: `IBlokRuntime.InvokeAsync(operation, inputJson, timeout?, cancellationToken)` (`Runtime/IBlokRuntime.cs`); `JintBlokRuntime.FromEmbeddedResource(poolSize, timeout, allocationBudgetBytes)` (`BlokDocuments.cs:126`); Task 37 ops.
- Produces (public, NuGet `Blok.Server`, namespace `Blok.Server.Agent`; 06 §7.3; approved D4):

```csharp
public interface IBlokAgentExecutor
{
  ValueTask<BlokAgentExecution> ExecuteAsync(string documentJson, string batchJson, BlokAgentActor actor, BlokAgentOptions? options = null, CancellationToken cancellationToken = default);
  ValueTask<string> GetContractAsync(BlokAgentOptions? options = null, CancellationToken cancellationToken = default);
  ValueTask<BlokAgentExecution> ExecuteInRoomAsync(string docId, string batchJson, BlokAgentActor actor, BlokAgentOptions? options = null, CancellationToken cancellationToken = default);
}
public sealed record BlokAgentActor(string Id, string Name, string? OnBehalfOf = null);
public sealed record BlokAgentExecution(string ResultJson, string? DocumentJson, string Revision);
public sealed class BlokAgentOptions { bool PageTitles; IBlokPageTarget? PageTarget; string? CustomToolsJson; string? OverridesJson; }
public interface IBlokPageTarget { ValueTask<BlokPageLocation?> ResolveAsync(string pageId, CancellationToken cancellationToken = default); }
public abstract record BlokPageLocation { Stored(LoadAsync, SaveAsync); Room(DocId) }
```

  `DocumentJson` is the saved document after a successful stored batch, `null` when the batch failed (nothing to save). `ExecuteInRoomAsync` returns `COMMAND_UNAVAILABLE` (`reason: 'runtime'`) until Task 45 gives the executor a room manager. `pageBackend` is passed to the Jint ops only when `PageTitles` is true and `PageTarget` is set (06 R3-2).

- [ ] **Step 1: Write the failing tests**

```csharp
// packages/server/dotnet/Blok.Server.Tests/Agent/BlokAgentExecutorTests.cs
using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Documents;
using Blok.Server.Runtime;
using Xunit;

namespace Blok.Server.Tests.Agent;

public sealed class BlokAgentExecutorTests
{
  private const string Document = """{"blocks":[{"id":"p","type":"paragraph","data":{"text":"Hello world"}}]}""";
  private static readonly BlokAgentActor Actor = new("agent-cs", "Server agent");

  [Fact]
  public async Task RunsABatchOnAStoredDocument()
  {
    var executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);

    var execution = await executor.ExecuteAsync(
        Document,
        """{"commands":[{"name":"text.format","args":{"id":"p","range":{"find":"world"},"set":{"bold":true}}}]}""",
        Actor);

    var result = JsonNode.Parse(execution.ResultJson)!;
    Assert.True(result["ok"]!.GetValue<bool>());
    Assert.StartsWith("h", execution.Revision);
    Assert.Contains("\"bold\":true", execution.DocumentJson);
    Assert.Contains("\"lastEditedBy\":\"agent-cs\"", execution.DocumentJson);
  }

  [Fact]
  public async Task UndoIsUnavailableAndNothingIsReturnedToSave()
  {
    var executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);

    var execution = await executor.ExecuteAsync(Document, """{"commands":[{"name":"history.undo","args":{}}]}""", Actor);

    Assert.Equal("COMMAND_UNAVAILABLE", JsonNode.Parse(execution.ResultJson)!["error"]!["code"]!.GetValue<string>());
    Assert.Null(execution.DocumentJson);
  }

  [Fact]
  public async Task ReturnsTheContract()
  {
    var contract = JsonNode.Parse(await BlokDocuments.CreateAgentExecutor(poolSize: 1).GetContractAsync())!;

    Assert.Contains(contract["commands"]!.AsArray(), entry => entry!["name"]!.GetValue<string>() == "block.insert");
  }

  [Fact]
  public async Task PassesPageBackendOnlyWhenTheHostOptedIn()
  {
    var runtime = new RecordingRuntime();
    var executor = new BlokAgentExecutor(runtime);

    await executor.GetContractAsync();
    await executor.GetContractAsync(new BlokAgentOptions { PageTitles = true, PageTarget = new NoPages() });

    Assert.Equal("[]", JsonNode.Parse(runtime.Inputs[0])!["services"]!.ToJsonString());
    Assert.Equal("""["pageBackend"]""", JsonNode.Parse(runtime.Inputs[1])!["services"]!.ToJsonString());
  }

  [Fact]
  public async Task RoomsAreUnavailableWithoutCollab()
  {
    var execution = await BlokDocuments.CreateAgentExecutor(poolSize: 1).ExecuteInRoomAsync("doc", """{"commands":[{"name":"doc.read","args":{}}]}""", Actor);

    Assert.Equal("COMMAND_UNAVAILABLE", JsonNode.Parse(execution.ResultJson)!["error"]!["code"]!.GetValue<string>());
  }

  private sealed class RecordingRuntime : IBlokRuntime
  {
    internal List<string> Inputs { get; } = [];

    public ValueTask<string> InvokeAsync(string operation, string inputJson, TimeSpan? timeout = null, CancellationToken cancellationToken = default)
    {
      Inputs.Add(inputJson);

      return ValueTask.FromResult("""{"manifest":{},"contract":{"commands":[]}}""");
    }
  }

  private sealed class NoPages : IBlokPageTarget
  {
    public ValueTask<BlokPageLocation?> ResolveAsync(string pageId, CancellationToken cancellationToken = default) => ValueTask.FromResult<BlokPageLocation?>(null);
  }
}
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~BlokAgentExecutorTests"`
Expected: FAIL to compile: `The type or namespace name 'Agent' does not exist in the namespace 'Blok.Server'`. (The build also rebuilds the embedded bundle from `src/`, `Blok.Server.csproj:57-63`.)

- [ ] **Step 3: Write the interface and the executor**

```csharp
// packages/server/dotnet/Blok.Server/Agent/IBlokAgentExecutor.cs
namespace Blok.Server.Agent;

/// <summary>Runs agent command batches with Blok's own planner, embedded in this package.</summary>
public interface IBlokAgentExecutor
{
  /// <summary>Stored documents: the caller loads <paramref name="documentJson"/> and saves the returned document.</summary>
  ValueTask<BlokAgentExecution> ExecuteAsync(
      string documentJson, string batchJson, BlokAgentActor actor,
      BlokAgentOptions? options = null, CancellationToken cancellationToken = default);

  /// <summary>The agent contract for this server's tools, for a host that renders its own LLM tools.</summary>
  ValueTask<string> GetContractAsync(BlokAgentOptions? options = null, CancellationToken cancellationToken = default);

  /// <summary>Live rooms. Answers COMMAND_UNAVAILABLE when collaboration is not set up.</summary>
  ValueTask<BlokAgentExecution> ExecuteInRoomAsync(
      string docId, string batchJson, BlokAgentActor actor,
      BlokAgentOptions? options = null, CancellationToken cancellationToken = default);
}

public sealed record BlokAgentActor(string Id, string Name, string? OnBehalfOf = null);

/// <param name="ResultJson">An AgentResult.</param>
/// <param name="DocumentJson">Stored runs: the document to save; null when the batch failed.</param>
/// <param name="Revision">Stored: content hash. Rooms: the journal head "lineage:sequence".</param>
public sealed record BlokAgentExecution(string ResultJson, string? DocumentJson, string Revision);

public sealed class BlokAgentOptions
{
  /// <summary>Opt in to page.rename / page.setIcon writing the target page's own title and icon.</summary>
  public bool PageTitles { get; init; }

  public IBlokPageTarget? PageTarget { get; init; }

  /// <summary>A BlokCustomToolsFile, as JSON.</summary>
  public string? CustomToolsJson { get; init; }

  /// <summary>ManifestOverrides, as JSON.</summary>
  public string? OverridesJson { get; init; }
}

/// <summary>Finds where another page's document lives, for page.rename / page.setIcon.</summary>
public interface IBlokPageTarget
{
  ValueTask<BlokPageLocation?> ResolveAsync(string pageId, CancellationToken cancellationToken = default);
}

public abstract record BlokPageLocation
{
  private BlokPageLocation()
  {
  }

  public sealed record Stored(
      Func<CancellationToken, ValueTask<string>> LoadAsync,
      Func<string, CancellationToken, ValueTask> SaveAsync) : BlokPageLocation;

  public sealed record Room(string DocId) : BlokPageLocation;
}
```

```csharp
// packages/server/dotnet/Blok.Server/Agent/BlokAgentExecutor.cs
using System.Text.Json.Nodes;
using Blok.Server.Runtime;

namespace Blok.Server.Agent;

internal sealed class BlokAgentExecutor(IBlokRuntime runtime) : IBlokAgentExecutor
{
  private readonly IBlokRuntime runtime = runtime ?? throw new ArgumentNullException(nameof(runtime));

  public async ValueTask<BlokAgentExecution> ExecuteAsync(
      string documentJson, string batchJson, BlokAgentActor actor,
      BlokAgentOptions? options = null, CancellationToken cancellationToken = default)
  {
    ArgumentNullException.ThrowIfNull(documentJson);
    ArgumentNullException.ThrowIfNull(batchJson);
    ArgumentNullException.ThrowIfNull(actor);

    var input = Common(options);
    input["document"] = JsonNode.Parse(documentJson);
    input["batch"] = JsonNode.Parse(batchJson);
    input["actor"] = ActorNode(actor);

    var output = JsonNode.Parse(await runtime.InvokeAsync("agentExecute", input.ToJsonString(), cancellationToken: cancellationToken))!;
    var result = output["result"]!;
    var ok = result["ok"]?.GetValue<bool>() == true;

    return new BlokAgentExecution(result.ToJsonString(), ok ? output["document"]!.ToJsonString() : null, result["revision"]?.GetValue<string>() ?? "");
  }

  public async ValueTask<string> GetContractAsync(BlokAgentOptions? options = null, CancellationToken cancellationToken = default)
  {
    var output = JsonNode.Parse(await runtime.InvokeAsync("manifest", Common(options).ToJsonString(), cancellationToken: cancellationToken))!;

    return output["contract"]!.ToJsonString();
  }

  public ValueTask<BlokAgentExecution> ExecuteInRoomAsync(
      string docId, string batchJson, BlokAgentActor actor,
      BlokAgentOptions? options = null, CancellationToken cancellationToken = default)
  {
    return ValueTask.FromResult(Unavailable("Live rooms need collaboration on this server."));
  }

  internal static BlokAgentExecution Unavailable(string message)
  {
    var error = new JsonObject
    {
      ["ok"] = false,
      ["error"] = new JsonObject { ["code"] = "COMMAND_UNAVAILABLE", ["message"] = message, ["retryable"] = false, ["details"] = new JsonObject { ["reason"] = "runtime" } },
      ["warnings"] = new JsonArray(),
    };

    return new BlokAgentExecution(error.ToJsonString(), null, "");
  }

  internal static JsonObject Common(BlokAgentOptions? options)
  {
    var services = new JsonArray();

    if (options is { PageTitles: true, PageTarget: not null })
    {
      services.Add("pageBackend");
    }

    var input = new JsonObject { ["services"] = services };

    if (options?.CustomToolsJson is { } tools)
    {
      input["customTools"] = JsonNode.Parse(tools);
    }

    if (options?.OverridesJson is { } overrides)
    {
      input["overrides"] = JsonNode.Parse(overrides);
    }

    return input;
  }

  internal static JsonObject ActorNode(BlokAgentActor actor)
  {
    var node = new JsonObject { ["id"] = actor.Id, ["name"] = actor.Name, ["kind"] = "agent" };

    if (actor.OnBehalfOf is { } onBehalfOf)
    {
      node["onBehalfOf"] = onBehalfOf;
    }

    return node;
  }
}
```

In `Documents/BlokDocuments.cs`, after `Create` (line 126):

```csharp
  /// <summary>An agent executor over its own engine pool. Register one per process.</summary>
  public static Agent.IBlokAgentExecutor CreateAgentExecutor(
      int? poolSize = null,
      TimeSpan? timeout = null,
      long? allocationBudgetBytes = null)
  {
    return new Agent.BlokAgentExecutor(
        JintBlokRuntime.FromEmbeddedResource(poolSize, timeout, allocationBudgetBytes));
  }
```

In `BlokDocumentsServiceCollectionExtensions.cs` after line 76:

```csharp
    services.TryAddSingleton<Agent.IBlokAgentExecutor>(provider => new Agent.BlokAgentExecutor(provider.GetRequiredService<IBlokRuntime>()));
```

- [ ] **Step 4: Run them**

Run: `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~BlokAgentExecutorTests"`
Expected: PASS (5 tests).
Run: `dotnet test packages/server/dotnet/Blok.Server.AspNetCore.Tests/Blok.Server.AspNetCore.Tests.csproj`
Expected: PASS (the registration change).

- [ ] **Step 5: Commit**

```bash
git add packages/server/dotnet/Blok.Server/Agent packages/server/dotnet/Blok.Server/Documents/BlokDocuments.cs packages/server/dotnet/Blok.Server.AspNetCore/BlokDocumentsServiceCollectionExtensions.cs packages/server/dotnet/Blok.Server.Tests/Agent/BlokAgentExecutorTests.cs
git commit -m "feat(server): IBlokAgentExecutor runs agent batches on stored documents

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

`IBlokAgentExecutor` and its records are new public surface on NuGet (06 D4, approved). Note it for the release notes.

---

### Task 39: Jint parity — moved to 05 Task 12

05 owns the C# corpus reader, the C# normalizer and the `jint` runner (05 Task 12: `AgentParityCorpus`, `AgentParityNormalizer`, `JintAgentParityTests`; 06 §7.5). They read 05's corpus and goldens under `test/fixtures/agent-commands/`. 05 builds the executor the way Task 38's tests do (`new BlokAgentExecutor(...)`; internal, visible to `Blok.Server.Tests` through `Blok.Server/Properties/AssemblyInfo.cs:5`). Nothing to build here. A Jint-only difference is a bundle or op bug: fix it in Task 37's op or the module that misbehaves, with a failing case in `test/unit/view/server-runtime-agent.test.ts` first.

---

### Task 40: Headless `page.rename` / `page.setIcon` in C# (stored target)

**Files:**
- Modify: `packages/server/dotnet/Blok.Server/Agent/BlokAgentExecutor.cs`
- Test: `packages/server/dotnet/Blok.Server.Tests/Agent/BlokAgentPageActionTests.cs`

**Interfaces:**
- Consumes: Task 38 `IBlokPageTarget`, `BlokPageLocation`; 02's `page.rename` args (`{ id, title }`) and `page.setIcon` args (`{ id, icon: PageIcon | null }`) (02 Task 49: `{ title }` / `{ icon }` plus the core-added `id`) and the page block's `data.pageId` (02 Task 21, `summaryFields: ['pageId']`). Names read from 02's plan; the code check is 02 Task 49's test.
- Produces: when a batch is exactly one `page.rename` / `page.setIcon` command and `PageTitles` + `PageTarget` are set, `ExecuteAsync` runs it in C# (never inside Jint, 06 R3-2 / R3-7): it reads the block's `pageId` through a Jint `doc.read` (`ids: [id]`), resolves the target, runs one `doc.setTitle` / `doc.setIcon` there (`ExecuteAsync` + `SaveAsync` for `Stored`, `ExecuteInRoomAsync` for `Room`), and returns `{ ok: true, results: [{ pageId, applied: true }] }`. An error from the target comes back with `details.pageId`. Without opt-in, the Jint contract already lists the actions `available: false`, so Jint answers `COMMAND_UNAVAILABLE`.

- [ ] **Step 1: Write the failing test**

```csharp
// packages/server/dotnet/Blok.Server.Tests/Agent/BlokAgentPageActionTests.cs
using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Documents;
using Xunit;

namespace Blok.Server.Tests.Agent;

public sealed class BlokAgentPageActionTests
{
  private const string Parent = """{"blocks":[{"id":"pg","type":"page","data":{"pageId":"page-2"}}]}""";

  [Fact]
  public async Task RenamesTheTargetPageAndSavesIt()
  {
    string saved = "";
    var target = new OnePage(new BlokPageLocation.Stored(
        _ => ValueTask.FromResult("""{"blocks":[]}"""),
        (json, _) => { saved = json; return ValueTask.CompletedTask; }));
    var executor = BlokDocuments.CreateAgentExecutor(poolSize: 1);

    var execution = await executor.ExecuteAsync(
        Parent, """{"commands":[{"name":"page.rename","args":{"id":"pg","title":"Roadmap"}}]}""",
        new BlokAgentActor("agent-cs", "Agent"), new BlokAgentOptions { PageTitles = true, PageTarget = target });

    var result = JsonNode.Parse(execution.ResultJson)!;
    Assert.True(result["ok"]!.GetValue<bool>(), execution.ResultJson);
    Assert.Equal("page-2", result["results"]![0]!["pageId"]!.GetValue<string>());
    Assert.Equal("Roadmap", JsonNode.Parse(saved)!["title"]!.GetValue<string>());
  }

  [Fact]
  public async Task IsUnavailableWithoutOptIn()
  {
    var execution = await BlokDocuments.CreateAgentExecutor(poolSize: 1).ExecuteAsync(
        Parent, """{"commands":[{"name":"page.rename","args":{"id":"pg","title":"x"}}]}""", new BlokAgentActor("a", "A"));

    Assert.Equal("COMMAND_UNAVAILABLE", JsonNode.Parse(execution.ResultJson)!["error"]!["code"]!.GetValue<string>());
  }

  private sealed class OnePage(BlokPageLocation location) : IBlokPageTarget
  {
    public ValueTask<BlokPageLocation?> ResolveAsync(string pageId, CancellationToken cancellationToken = default) =>
        ValueTask.FromResult<BlokPageLocation?>(pageId == "page-2" ? location : null);
  }
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~BlokAgentPageActionTests"`
Expected: `RenamesTheTargetPageAndSavesIt` FAILS (Jint refuses: `effects: 'host'` actions never run inside Jint); `IsUnavailableWithoutOptIn` passes once 02's page actions are in the Jint contract.

- [ ] **Step 3: Handle the page action in C#**

At the top of `ExecuteAsync`, before building the Jint input:

```csharp
    var batch = JsonNode.Parse(batchJson)!.AsObject();

    if (options is { PageTitles: true, PageTarget: { } pages } && SinglePageAction(batch) is { } action)
    {
      return await RunPageActionAsync(documentJson, action, actor, pages, options, cancellationToken);
    }
```

and add:

```csharp
  private static (string Name, JsonObject Args)? SinglePageAction(JsonObject batch)
  {
    var commands = batch["commands"]?.AsArray();

    if (commands is not { Count: 1 } || commands[0]?["name"]?.GetValue<string>() is not ("page.rename" or "page.setIcon") || commands[0]!["args"] is not JsonObject args)
    {
      return null;
    }

    return (commands[0]!["name"]!.GetValue<string>(), args);
  }

  private async ValueTask<BlokAgentExecution> RunPageActionAsync(
      string documentJson, (string Name, JsonObject Args) action, BlokAgentActor actor, IBlokPageTarget pages,
      BlokAgentOptions options, CancellationToken cancellationToken)
  {
    var read = await ExecuteAsync(documentJson, new JsonObject
    {
      ["commands"] = new JsonArray(new JsonObject { ["name"] = "doc.read", ["args"] = new JsonObject { ["ids"] = new JsonArray(action.Args["id"]!.DeepClone()), ["detail"] = "full" } }),
    }.ToJsonString(), actor, null, cancellationToken);
    var pageId = JsonNode.Parse(read.ResultJson)?["results"]?[0]?["blocks"]?[0]?["data"]?["pageId"]?.GetValue<string>();
    var location = pageId is null ? null : await pages.ResolveAsync(pageId, cancellationToken);

    if (pageId is null || location is null)
    {
      return Failure("PRECONDITION_FAILED", $"Block \"{action.Args["id"]}\" points at no page this server can open.", pageId);
    }

    var command = action.Name == "page.rename"
        ? new JsonObject { ["name"] = "doc.setTitle", ["args"] = new JsonObject { ["title"] = action.Args["title"]?.DeepClone() } }
        : new JsonObject { ["name"] = "doc.setIcon", ["args"] = new JsonObject { ["icon"] = action.Args["icon"]?.DeepClone() } };
    var inner = new JsonObject { ["commands"] = new JsonArray(command) }.ToJsonString();
    BlokAgentExecution done;

    switch (location)
    {
      case BlokPageLocation.Stored stored:
        done = await ExecuteAsync(await stored.LoadAsync(cancellationToken), inner, actor, null, cancellationToken);
        if (done.DocumentJson is { } saved)
        {
          await stored.SaveAsync(saved, cancellationToken);
        }
        break;
      case BlokPageLocation.Room room:
        done = await ExecuteInRoomAsync(room.DocId, inner, actor, null, cancellationToken);
        break;
      default:
        throw new InvalidOperationException("Unknown page location.");
    }

    var result = JsonNode.Parse(done.ResultJson)!.AsObject();

    if (result["ok"]?.GetValue<bool>() != true)
    {
      result["error"]!["details"] ??= new JsonObject();
      result["error"]!["details"]!["pageId"] = pageId;

      return new BlokAgentExecution(result.ToJsonString(), null, "");
    }

    result["results"] = new JsonArray(new JsonObject { ["pageId"] = pageId, ["applied"] = true });

    return new BlokAgentExecution(result.ToJsonString(), null, read.Revision);
  }

  private static BlokAgentExecution Failure(string code, string message, string? pageId)
  {
    var details = new JsonObject();

    if (pageId is not null)
    {
      details["pageId"] = pageId;
    }

    return new BlokAgentExecution(new JsonObject
    {
      ["ok"] = false,
      ["error"] = new JsonObject { ["code"] = code, ["message"] = message, ["retryable"] = false, ["details"] = details },
      ["warnings"] = new JsonArray(),
    }.ToJsonString(), null, "");
  }
```

The source document does not change, so `DocumentJson` is `null` (nothing to save on the caller's side).

- [ ] **Step 4: Run them**

Run: `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~BlokAgent"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/dotnet/Blok.Server/Agent/BlokAgentExecutor.cs packages/server/dotnet/Blok.Server.Tests/Agent/BlokAgentPageActionTests.cs
git commit -m "feat(server): headless page.rename and page.setIcon run in C# against the target page

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Checkpoint 4

- [ ] `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~Agent"` and `yarn test test/unit/scripts/build-server-runtime.test.ts` — PASS.
- [ ] `git pull --rebase && git push`; `git status` up to date.
- [ ] Tell 05 that `IBlokAgentExecutor.ExecuteAsync` is on `main`, so 05 Task 12 (`jint` runner) can start.

---
## Phase 5 — C# live rooms (room translator, D1a)

All ops added here are `internal` records on `CollabEditOp`. None is added to `CollabEditOps.Parse` (`CollabEditOps.cs:235-251`): the public `/edit` wire does not change. `CollabEditOps.WriteCanonicalOp` (`:153-185`) gets a case for each new op, so `CanonicalBodyDigest` (`:148`) can digest an agent edit.

### Task 41: The `page` root: `SetPageField`, seed and export

**Files:**
- Modify: `packages/server/dotnet/Blok.Server/Collab/CollabEditOps.cs` (op + canonical case), `packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs` (`EditStep` gets the page map; `PlanOne` case; `InputWriter.Atomic` becomes `internal`; `PageRoot` constant), `packages/server/dotnet/Blok.Server/Collab/CollabDocConverter.cs` (`SeedAsync`, `ExportAsync`)
- Create: `test/unit/server-conformance/agent-page-fields-fixture.test.ts` (writes the lockstep fixture), `test/unit/server-conformance/fixtures/agent-page-fields.json`
- Test: `packages/server/dotnet/Blok.Server.Tests/Collab/AgentRoomOpsTests.cs`

**Interfaces:**
- Consumes: `writePageField` / `readPageFields` (`src/components/modules/yjs/page-fields.ts:25`, `:35`) as the reference; `EditStep` (`YDocConverter.cs:1083-1100`), `ApplyOps` (`:276-320`).
- Produces:
  - `internal sealed record SetPageField(string Key, JsonNode? Value) : CollabEditOp` — `Key` is `"title"` or `"icon"`; `null`, `""` delete the key (as `writePageField` does); an icon must be `{ type: 'emoji', value }` or `{ type: 'image', url }`, else `CollabEditException`.
  - `EditStep`'s delegate becomes `Action<YTransaction, YMap, YArray, YMap>` (blocks, root order, page). Existing factories ignore the 4th argument.
  - `SeedAsync` writes `title` / `icon` from the saved document into the `page` root; `ExportAsync` reads them back as top-level `title` / `icon` (the flat `OutputData` fields, see D-1). Absent stays absent.

- [ ] **Step 1: Write the lockstep fixture generator (TS) and the failing C# test**

```ts
// test/unit/server-conformance/agent-page-fields-fixture.test.ts
// @vitest-environment node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import { readPageFields, writePageField } from '../../../src/components/modules/yjs/page-fields';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';

const FILE = resolve(__dirname, 'fixtures/agent-page-fields.json');
const STEPS = [
  { key: 'title', value: 'Plan' },
  { key: 'icon', value: { type: 'emoji', value: '🚀' } },
  { key: 'title', value: '' },
  { key: 'icon', value: null },
] as const;

/** C# SetPageField must leave the page map as page-fields.ts does after each step. */
describe('agent page-field lockstep fixture', () => {
  it('matches page-fields.ts', () => {
    const store = new DocumentStore(new YBlockSerializer());
    const after = STEPS.map((step) => {
      store.transact(() => writePageField(store.page, step.key, step.value), 'local');

      return readPageFields(store.page);
    });
    const fixture = { steps: STEPS, after };

    if (process.env.UPDATE_AGENT_GOLDENS === '1') {
      writeFileSync(FILE, `${JSON.stringify(fixture, null, 2)}\n`);
    }

    expect(JSON.parse(readFileSync(FILE, 'utf-8'))).toEqual(fixture);
  });
});
```

```csharp
// packages/server/dotnet/Blok.Server.Tests/Collab/AgentRoomOpsTests.cs
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Collab;

public sealed class AgentRoomOpsTests
{
  [Fact]
  public void SetPageFieldMatchesPageFieldsTs()
  {
    var fixture = RichTextFixtures.ReadJson("agent-page-fields.json");
    var doc = new YDoc();
    RichTextRuntime.Seed(doc, new JsonArray());

    var steps = fixture["steps"]!.AsArray();
    var after = fixture["after"]!.AsArray();

    for (var i = 0; i < steps.Count; i++)
    {
      RichTextRuntime.ApplyOps(doc, [new CollabEditOp.SetPageField(steps[i]!["key"]!.GetValue<string>(), steps[i]!["value"]?.DeepClone())]);

      var exported = new CollabDocConverter(TimeProvider.System, RichTextRuntime.Reader).ExportAsync(doc).AsTask().GetAwaiter().GetResult();
      var page = new JsonObject();

      if (exported["title"] is { } title) page["title"] = title.DeepClone();
      if (exported["icon"] is { } icon) page["icon"] = icon.DeepClone();

      Assert.True(JsonNode.DeepEquals(after[i], page), $"step {i}: {page.ToJsonString()}");
    }
  }

  [Fact]
  public void RefusesABadIcon()
  {
    var doc = new YDoc();

    Assert.Throws<CollabEditException>(() => RichTextRuntime.ApplyOps(doc, [new CollabEditOp.SetPageField("icon", new JsonObject { ["type"] = "emoji" })]));
  }

  [Fact]
  public async Task SeedCarriesTitleAndIconIntoThePageRoot()
  {
    var converter = new CollabDocConverter(TimeProvider.System, RichTextRuntime.Reader);
    var doc = new YDoc();

    await converter.SeedAsync(doc, JsonNode.Parse("""{"title":"T","icon":{"type":"emoji","value":"x"},"blocks":[]}""")!);
    var exported = await converter.ExportAsync(doc);

    Assert.Equal("T", exported["title"]!.GetValue<string>());
    Assert.Equal("x", exported["icon"]!["value"]!.GetValue<string>());
  }
}
```

Run: `UPDATE_AGENT_GOLDENS=1 yarn test test/unit/server-conformance/agent-page-fields-fixture.test.ts` (writes the fixture; read it), then `yarn test test/unit/server-conformance/agent-page-fields-fixture.test.ts` → PASS.
Run: `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~AgentRoomOpsTests"`
Expected: FAIL to compile: `'CollabEditOp' does not contain a definition for 'SetPageField'`.

- [ ] **Step 2: Write the op, the step, and the root**

`CollabEditOps.cs`, inside `CollabEditOp`:

```csharp
  /// <summary>Agent path only, never on the /edit wire. Writes the page root's title or icon; null or "" deletes it.</summary>
  internal sealed record SetPageField(string Key, JsonNode? Value) : CollabEditOp;
```

and in `WriteCanonicalOp`:

```csharp
      case CollabEditOp.SetPageField set:
        writer.WriteString("key", set.Key);
        writer.WriteString("op", "setPageField");
        writer.WritePropertyName("value");
        WriteCanonicalNode(set.Value, writer);
        break;
```

`YDocConverter.cs`:

- add `private const string PageRoot = "page";` next to `OrderRoot` (line 78);
- `EditStep`: change the delegate type to `Action<YTransaction, YMap, YArray, YMap>`, `Apply(transaction, blockMap, rootOrder, page)`, and every existing factory lambda gains a fourth `_` parameter;
- in `ApplyOps` (line 289-303) get `var page = doc.GetMap(PageRoot);` and call `step.Apply(transaction, blockMap, rootOrder, page)`;
- in `PlanOne` add `CollabEditOp.SetPageField set => PlanSetPageField(set, index),`;
- make `InputWriter.Atomic` (line 2550) `internal`;
- add to `EditPlanner`:

```csharp
    private List<EditStep> PlanSetPageField(CollabEditOp.SetPageField op, int index)
    {
      if (op.Key is not ("title" or "icon"))
      {
        throw new CollabEditException(Where(index, $"\"{op.Key}\" is not a page field."));
      }

      var clears = op.Value is null || (op.Value is JsonValue text && text.TryGetValue<string>(out var s) && s.Length == 0);

      if (!clears && op.Key == "icon" && !IsPageIcon(op.Value))
      {
        throw new CollabEditException(Where(index, "an icon is { type: \"emoji\", value } or { type: \"image\", url }."));
      }

      return [EditStep.SetPage(op.Key, clears ? null : op.Value)];
    }

    private static bool IsPageIcon(JsonNode? value) =>
        value is JsonObject icon && icon["type"]?.GetValue<string>() switch
        {
          "emoji" => icon["value"] is JsonValue v && v.TryGetValue<string>(out _),
          "image" => icon["url"] is JsonValue u && u.TryGetValue<string>(out _),
          _ => false,
        };
```

- add to `EditStep`:

```csharp
    internal static EditStep SetPage(string key, JsonNode? value)
    {
      return new EditStep((transaction, _, _, page) =>
      {
        if (value is null)
        {
          page.Delete(transaction, key);
        }
        else
        {
          page.Set(transaction, key, InputWriter.Atomic(value, 0));
        }
      });
    }
```

`CollabDocConverter.cs`: in `SeedAsync`, after `YDocConverter.Seed(doc, blocks, input);`, apply `[new CollabEditOp.SetPageField("title", document["title"]?.DeepClone()), new CollabEditOp.SetPageField("icon", document["icon"]?.DeepClone())]` through `YDocConverter.ApplyOps(doc, …, input)` only for keys the document carries. In `ExportAsync`, read `doc.GetMap("page")` before the first await (the converter's rule, `ICollabDocConverter.cs:26-29`) and add `title` (non-empty string) and `icon` (valid icon) to the returned object.

**Unverified:** the C# `YMap` API names `Set` / `Delete` with a transaction and how `Atomic` values round-trip on export; follow `PutBlock` / `RemoveBlock` (`YDocConverter.cs:1102-1112`) for the call shape, and the export reader's plain-value path for the read.

- [ ] **Step 3: Run them**

Run: `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~AgentRoomOpsTests|FullyQualifiedName~YDocConverterEditTests|FullyQualifiedName~CollabEditOpsTests|FullyQualifiedName~CollabDocConverterTests"`
Expected: PASS. The three existing classes guard that the `EditStep` signature change broke nothing.

- [ ] **Step 4: Commit**

```bash
git add packages/server/dotnet/Blok.Server/Collab/CollabEditOps.cs packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs packages/server/dotnet/Blok.Server/Collab/CollabDocConverter.cs packages/server/dotnet/Blok.Server.Tests/Collab/AgentRoomOpsTests.cs test/unit/server-conformance/agent-page-fields-fixture.test.ts test/unit/server-conformance/fixtures/agent-page-fields.json
git commit -m "feat(server): page root in room seed/export and an internal SetPageField op

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 42: Internal `Move` op

**Files:**
- Modify: `CollabEditOps.cs` (op + canonical case), `YDocConverter.cs` (`PlanMove`, `EditStep.SetParentId`)
- Create: `test/unit/server-conformance/agent-move-fixture.test.ts`, `test/unit/server-conformance/fixtures/agent-moves.json`
- Test: `packages/server/dotnet/Blok.Server.Tests/Collab/AgentRoomOpsTests.cs` (add cases)

**Interfaces:**
- Consumes: `EditPlanner` bookkeeping (`parents`, `children`, `order`, `contents`, `ListedBy`, `Index`; `YDocConverter.cs:634-800`), `RemoveRootOrder` / `UnlinkChild` / `InsertRootOrder` / `LinkChild` (`:1236-1290`); `DocumentStore.moveBlockTo` (`document-store.ts:824`) as the reference.
- Produces: `internal sealed record Move(string Id, string? After, string? Parent) : CollabEditOp`. Planning refuses (with `CollabEditException`): unknown id; unknown parent; a parent inside the moved subtree (walk `parents`); an `After` that is not a child of the target parent. Steps: unlink from the old place, `SetParentId(id, parent)`, link at the new place. No `RemoveBlock` / `PutBlock`, so the block map keeps its identity and a peer's concurrent edit inside it merges (06 §7.4).

- [ ] **Step 1: Write the lockstep fixture generator and the failing C# cases**

```ts
// test/unit/server-conformance/agent-move-fixture.test.ts
// @vitest-environment node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import type { OutputBlockData } from '../../../types';

const FILE = resolve(__dirname, 'fixtures/agent-moves.json');
const SEED: OutputBlockData[] = [
  { id: 'a', type: 'toggle', data: {}, content: ['a1', 'a2'] },
  { id: 'a1', type: 'paragraph', data: {}, parent: 'a' },
  { id: 'a2', type: 'paragraph', data: {}, parent: 'a' },
  { id: 'b', type: 'paragraph', data: {} },
];
const CASES = [
  { name: 'root-into-parent-first', id: 'b', parent: 'a', after: null },
  { name: 'child-to-root-after', id: 'a1', parent: null, after: 'b' },
  { name: 'reorder-siblings', id: 'a1', parent: 'a', after: 'a2' },
];

/** C# Move must give the same export as DocumentStore.moveBlockTo. */
describe('agent move lockstep fixture', () => {
  it('matches DocumentStore.moveBlockTo', () => {
    const out = CASES.map((c) => {
      const store = new DocumentStore(new YBlockSerializer());

      store.fromJSON(SEED);
      store.moveBlockTo(c.id, { parentId: c.parent, afterId: c.after });

      return { ...c, expected: store.toJSON() };
    });
    const fixture = { seed: SEED, cases: out };

    if (process.env.UPDATE_AGENT_GOLDENS === '1') {
      writeFileSync(FILE, `${JSON.stringify(fixture, null, 2)}\n`);
    }

    expect(JSON.parse(readFileSync(FILE, 'utf-8'))).toEqual(fixture);
  });
});
```

Add to `AgentRoomOpsTests`:

```csharp
  public static IEnumerable<object[]> MoveCases() =>
      RichTextFixtures.ReadJson("agent-moves.json")["cases"]!.AsArray().Select(c => new object[] { c!["name"]!.GetValue<string>() });

  [Theory]
  [MemberData(nameof(MoveCases))]
  public void MoveMatchesDocumentStore(string name)
  {
    var fixture = RichTextFixtures.ReadJson("agent-moves.json");
    var c = fixture["cases"]!.AsArray().Single(x => x!["name"]!.GetValue<string>() == name)!;
    var doc = new YDoc();
    RichTextRuntime.Seed(doc, fixture["seed"]!.DeepClone().AsArray());

    RichTextRuntime.ApplyOps(doc, [new CollabEditOp.Move(c["id"]!.GetValue<string>(), c["after"]?.GetValue<string>(), c["parent"]?.GetValue<string>())]);

    var exported = RichTextRuntime.Export(doc);
    Assert.True(JsonNode.DeepEquals(c["expected"], exported), $"{name}: {exported.ToJsonString()}");
  }

  [Fact]
  public void MoveRefusesItsOwnSubtree()
  {
    var doc = new YDoc();
    RichTextRuntime.Seed(doc, RichTextFixtures.ReadJson("agent-moves.json")["seed"]!.DeepClone().AsArray());

    Assert.Throws<CollabEditException>(() => RichTextRuntime.ApplyOps(doc, [new CollabEditOp.Move("a", null, "a1")]));
  }
```

Run: `UPDATE_AGENT_GOLDENS=1 yarn test test/unit/server-conformance/agent-move-fixture.test.ts`, read the fixture, re-run without the flag → PASS.
Run: `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~AgentRoomOpsTests"`
Expected: FAIL to compile (`Move` missing).

- [ ] **Step 2: Write `Move`**

`CollabEditOps.cs`: `internal sealed record Move(string Id, string? After, string? Parent) : CollabEditOp;` and a canonical case writing `after`, `id`, `op: "move"`, `parent` in that order (sorted keys, like `Insert`).

`YDocConverter.cs`, `PlanOne`: `CollabEditOp.Move move => PlanMove(move, index),` and in `EditPlanner`:

```csharp
    private List<EditStep> PlanMove(CollabEditOp.Move op, int index)
    {
      NoNul(op.Id, "a block id");

      if (!parents.TryGetValue(op.Id, out var oldParent))
      {
        throw new CollabEditException(Where(index, $"there is no block \"{op.Id}\" to move."));
      }

      if (op.Parent is not null && !parents.ContainsKey(op.Parent))
      {
        throw new CollabEditException(Where(index, $"there is no parent block \"{op.Parent}\"."));
      }

      for (var cursor = op.Parent; cursor is not null; cursor = parents.GetValueOrDefault(cursor))
      {
        if (cursor == op.Id)
        {
          throw new CollabEditException(Where(index, $"block \"{op.Id}\" cannot move inside its own subtree."));
        }
      }

      RefuseUnlessBlockMap(op.Id, index);

      var steps = new List<EditStep>();

      if (oldParent is null)
      {
        var at = order.IndexOf(op.Id);

        order.RemoveAt(at);
        steps.Add(EditStep.RemoveRootOrder(at));
      }
      else
      {
        contents[oldParent]?.Remove(op.Id);
        steps.Add(EditStep.UnlinkChild(oldParent, op.Id));
      }

      steps.Add(EditStep.SetParentId(op.Id, op.Parent));
      parents[op.Id] = op.Parent;

      if (op.Parent is null)
      {
        var found = op.After is null ? -1 : order.IndexOf(op.After);

        if (op.After is not null && found < 0)
        {
          throw new CollabEditException(Where(index, $"block \"{op.After}\" is not in the document order."));
        }

        order.Insert(found + 1, op.Id);
        steps.Add(EditStep.InsertRootOrder(found + 1, op.Id));
      }
      else
      {
        var siblings = contents[op.Parent] ??= [];

        if (op.After is not null && !siblings.Contains(op.After))
        {
          throw new CollabEditException(Where(index, $"block \"{op.After}\" is not a child of \"{op.Parent}\"."));
        }

        siblings.Insert(op.After is null ? 0 : siblings.IndexOf(op.After) + 1, op.Id);
        steps.Add(EditStep.LinkChild(op.Parent, op.Id, op.After));
      }

      return steps;
    }
```

`EditStep`:

```csharp
    internal static EditStep SetParentId(string id, string? parentId)
    {
      return new EditStep((transaction, blockMap, _, _) =>
      {
        if (Value(blockMap, id) is not YMap block)
        {
          return;
        }

        if (parentId is null)
        {
          block.Delete(transaction, "parentId");
        }
        else
        {
          block.Set(transaction, "parentId", parentId);
        }
      });
    }
```

Keep the planner's other indexes (`children`, `ListedBy`) in step with the move the same way `PlanInsert` (`:880-930`) and `PlanRemove` (`:959-1045`) do; if the planner has an index the code above does not update, update it here and add a case to `agent-moves.json` that a later op in the same request depends on (a move then an insert after the moved block).

- [ ] **Step 3: Run them**

Run: `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~AgentRoomOpsTests|FullyQualifiedName~YDocConverterEditTests"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/dotnet/Blok.Server/Collab/CollabEditOps.cs packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs packages/server/dotnet/Blok.Server.Tests/Collab/AgentRoomOpsTests.cs test/unit/server-conformance/agent-move-fixture.test.ts test/unit/server-conformance/fixtures/agent-moves.json
git commit -m "feat(server): internal Move op that keeps the block map, in lockstep with moveBlockTo

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 43: Internal `Retype`, `SetTunes`, `SetMetadata` ops

**Files:**
- Modify: `CollabEditOps.cs`, `YDocConverter.cs`
- Test: `AgentRoomOpsTests.cs` (add cases)

**Interfaces:**
- Consumes: `InputWriter.BlockDataEntries(type, NormalizeBlockData(type, data), input)` and `InputWriter.Screen(entries)` (as `PlanUpdate` uses them, `YDocConverter.cs:944-950`), `EditStep.ReplaceData` (`:1124`), `types` map; `InputWriter.Block`'s handling of `tunes` and `lastEditedAt` / `lastEditedBy` (`:2333-2390`).
- Produces:
  - `internal sealed record Retype(string Id, string Type, JsonObject Data) : CollabEditOp` — sets `type`, then `ReplaceData` for the new type's entries; block map, id, position, children and tunes kept (like `replaceBlockContent`, `document-store.ts:751`). `types[id]` updated.
  - `internal sealed record SetTunes(string Id, JsonObject Tunes) : CollabEditOp` — per tune: `null` deletes, else sets the value the way `InputWriter.Block` writes tunes.
  - `internal sealed record SetMetadata(string Id, double LastEditedAt, string LastEditedBy) : CollabEditOp` — writes the two keys as `InputWriter.Block` does (`Atomic`, `:2379-2386`).

- [ ] **Step 1: Write the failing cases**

Add to `AgentRoomOpsTests`:

```csharp
  [Fact]
  public void RetypeKeepsTheBlockAndItsChildren()
  {
    var doc = new YDoc();
    RichTextRuntime.Seed(doc, JsonNode.Parse("""[{"id":"t","type":"toggle","data":{"text":[{"text":"T"}]},"content":["k"]},{"id":"k","type":"paragraph","data":{},"parent":"t"}]""")!.AsArray());

    RichTextRuntime.ApplyOps(doc, [new CollabEditOp.Retype("t", "header", new JsonObject { ["text"] = JsonNode.Parse("""[{"text":"T"}]"""), ["level"] = 2 })]);

    var t = RichTextRuntime.Export(doc).Single(b => b!["id"]!.GetValue<string>() == "t")!;
    Assert.Equal("header", t["type"]!.GetValue<string>());
    Assert.Equal(2, t["data"]!["level"]!.GetValue<int>());
    Assert.Equal("""["k"]""", t["content"]!.ToJsonString());
  }

  [Fact]
  public void SetTunesAndMetadataLandOnTheBlock()
  {
    var doc = new YDoc();
    RichTextRuntime.Seed(doc, JsonNode.Parse("""[{"id":"p","type":"paragraph","data":{}}]""")!.AsArray());

    RichTextRuntime.ApplyOps(doc, [
      new CollabEditOp.SetTunes("p", new JsonObject { ["align"] = new JsonObject { ["value"] = "center" } }),
      new CollabEditOp.SetMetadata("p", 42, "agent-cs"),
    ]);

    var p = RichTextRuntime.Export(doc).Single()!;
    Assert.Equal("center", p["tunes"]!["align"]!["value"]!.GetValue<string>());
    Assert.Equal("agent-cs", p["lastEditedBy"]!.GetValue<string>());
  }
```

Run: `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~AgentRoomOpsTests"`
Expected: FAIL to compile (`Retype`, `SetTunes`, `SetMetadata` missing).

- [ ] **Step 2: Write the ops**

`CollabEditOps.cs`: the three records, each with a canonical case (keys sorted: `data`, `id`, `op`, `type` for `Retype`; `id`, `op`, `tunes` for `SetTunes`; `id`, `lastEditedAt`, `lastEditedBy`, `op` for `SetMetadata`).

`YDocConverter.cs`, `PlanOne` cases and `EditPlanner` methods:

```csharp
    private List<EditStep> PlanRetype(CollabEditOp.Retype op, int index)
    {
      NoNul(op.Id, "a block id");
      NoNul(op.Type, "a block type");

      if (!parents.ContainsKey(op.Id))
      {
        throw new CollabEditException(Where(index, $"there is no block \"{op.Id}\" to retype."));
      }

      RefuseUnlessBlockMap(op.Id, index);

      var entries = InputWriter.BlockDataEntries(op.Type, NormalizeBlockData(op.Type, op.Data), input);

      InputWriter.Screen(entries);
      types[op.Id] = op.Type;

      return [EditStep.SetBlockField(op.Id, "type", op.Type), EditStep.ReplaceData(op.Id, entries)];
    }

    private List<EditStep> PlanSetTunes(CollabEditOp.SetTunes op, int index)
    {
      if (!parents.ContainsKey(op.Id))
      {
        throw new CollabEditException(Where(index, $"there is no block \"{op.Id}\" to set tunes on."));
      }

      RefuseUnlessBlockMap(op.Id, index);

      return [EditStep.SetTunes(op.Id, op.Tunes.Select(pair => new KeyValuePair<string, object?>(pair.Key, pair.Value is null ? null : InputWriter.Atomic(pair.Value, 1))).ToList())];
    }

    private List<EditStep> PlanSetMetadata(CollabEditOp.SetMetadata op, int index)
    {
      if (!parents.ContainsKey(op.Id))
      {
        throw new CollabEditException(Where(index, $"there is no block \"{op.Id}\"."));
      }

      RefuseUnlessBlockMap(op.Id, index);

      return [EditStep.SetBlockField(op.Id, "lastEditedAt", op.LastEditedAt), EditStep.SetBlockField(op.Id, "lastEditedBy", op.LastEditedBy)];
    }
```

`EditStep`:

```csharp
    internal static EditStep SetBlockField(string id, string key, object value)
    {
      return new EditStep((transaction, blockMap, _, _) =>
      {
        if (Value(blockMap, id) is YMap block)
        {
          block.Set(transaction, key, value);
        }
      });
    }

    internal static EditStep SetTunes(string id, IReadOnlyList<KeyValuePair<string, object?>> tunes)
    {
      return new EditStep((transaction, blockMap, _, _) =>
      {
        if (Value(blockMap, id) is not YMap block)
        {
          return;
        }

        if (Value(block, "tunes") is not YMap map)
        {
          map = new YMap();
          block.Set(transaction, "tunes", map);
        }

        foreach (var (name, tune) in tunes)
        {
          if (tune is null)
          {
            map.Delete(transaction, name);
          }
          else
          {
            map.Set(transaction, name, tune);
          }
        }
      });
    }
```

**Unverified:** that tunes are a `YMap` of atomic values on the JS side (`DocumentStore.updateBlockTune`, `document-store.ts:2216`) and that a number written with `Set` exports as the JS number `lastEditedAt` expects; mirror exactly what `InputWriter.Block` (`:2333-2390`) writes for `tunes` and `lastEditedAt` if it differs, and add a lockstep case to `agent-moves.json`'s generator style for `updateBlockTune` if the shapes are not obviously the same.

- [ ] **Step 3: Run them**

Run: `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~AgentRoomOpsTests|FullyQualifiedName~YDocConverterEditTests|FullyQualifiedName~CollabEditOpsTests"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/dotnet/Blok.Server/Collab/CollabEditOps.cs packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs packages/server/dotnet/Blok.Server.Tests/Collab/AgentRoomOpsTests.cs
git commit -m "feat(server): internal Retype, SetTunes and SetMetadata ops for the agent room path

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 44: `RoomEditTranslator`: `Edit[]` → room ops

**Files:**
- Create: `packages/server/dotnet/Blok.Server/Agent/RoomEditTranslator.cs`
- Test: `packages/server/dotnet/Blok.Server.Tests/Agent/RoomEditTranslatorTests.cs`

**Interfaces:**
- Consumes: the Jint `agentExecute` output `{ result, document, edits }` (Task 37); ops from Tasks 41–43 and today's `Insert`, `Update`, `Remove` (`CollabEditOps.cs:31-41`).
- Produces: `internal static IReadOnlyList<CollabEditOp> RoomEditTranslator.Translate(JsonArray edits, JsonObject after, JsonObject result)` — `after` is the document Jint returned, `result` the `AgentResult`. Mapping (06 §7.4 table):

| Edit | Ops |
|---|---|
| `insert` | `Insert` per planned block, parent first, chained `After`; the block JSON has no `parent` / `content` (the op carries the position) |
| `remove` | `Remove` (children were already lifted with `move` edits, Task 9, so `withChildren: false` removes a childless block) |
| `move` | `Move` |
| `setData`, `setRichText` | one `Update` per block, at that block's last such edit, with the block's **full** final `data` from `after` (`ReplaceData` deletes keys the new data lacks, `YDocConverter.cs:1141-1149`) |
| `setTunes` | `SetTunes` with the final tunes from `after` |
| `replaceType` | `Retype` with the final type and data from `after` |
| `setPageField` | `SetPageField` |
| then | `SetMetadata` for every id in `result.changed.created` ∪ `result.changed.updated`, from `after`'s `lastEditedAt` / `lastEditedBy` |

- [ ] **Step 1: Write the failing test**

```csharp
// packages/server/dotnet/Blok.Server.Tests/Agent/RoomEditTranslatorTests.cs
using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Collab;
using Xunit;

namespace Blok.Server.Tests.Agent;

public sealed class RoomEditTranslatorTests
{
  [Fact]
  public void TranslatesEachEditKind()
  {
    var edits = JsonNode.Parse("""
      [
        {"op":"insert","parentId":null,"afterId":"p","block":{"id":"n","type":"toggle","data":{"text":[]},"children":[{"id":"n1","type":"paragraph","data":{},"children":[]}]}},
        {"op":"setRichText","id":"p","field":"text","value":[{"text":"x"}]},
        {"op":"setData","id":"p","patch":{"keep":null}},
        {"op":"move","id":"q","parentId":"n","afterId":"n1"},
        {"op":"setPageField","key":"title","value":"T"}
      ]
      """)!.AsArray();
    var after = JsonNode.Parse("""
      {"title":"T","blocks":[
        {"id":"p","type":"paragraph","data":{"text":[{"text":"x"}]},"lastEditedAt":7,"lastEditedBy":"agent"},
        {"id":"n","type":"toggle","data":{"text":[]},"content":["n1","q"],"lastEditedAt":7,"lastEditedBy":"agent"},
        {"id":"n1","type":"paragraph","data":{},"parent":"n","lastEditedAt":7,"lastEditedBy":"agent"},
        {"id":"q","type":"paragraph","data":{},"parent":"n"}
      ]}
      """)!.AsObject();
    var result = JsonNode.Parse("""{"ok":true,"changed":{"created":["n","n1"],"updated":["p"],"moved":["q"],"removed":[]}}""")!.AsObject();

    var ops = RoomEditTranslator.Translate(edits, after, result);

    Assert.Collection(ops,
        op => Assert.Equal(("n", "p", (string?)null), (((CollabEditOp.Insert)op).Id, ((CollabEditOp.Insert)op).After, ((CollabEditOp.Insert)op).Parent)),
        op => Assert.Equal(("n1", (string?)null, "n"), (((CollabEditOp.Insert)op).Id, ((CollabEditOp.Insert)op).After, ((CollabEditOp.Insert)op).Parent)),
        op => Assert.Equal("""{"text":[{"text":"x"}]}""", ((CollabEditOp.Update)op).Data.ToJsonString()),
        op => Assert.Equal(new CollabEditOp.Move("q", "n1", "n"), op),
        op => Assert.Equal("title", ((CollabEditOp.SetPageField)op).Key),
        op => Assert.Equal("n", ((CollabEditOp.SetMetadata)op).Id),
        op => Assert.Equal("n1", ((CollabEditOp.SetMetadata)op).Id),
        op => Assert.Equal(new CollabEditOp.SetMetadata("p", 7, "agent"), op));
  }
}
```

Run: `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~RoomEditTranslatorTests"`
Expected: FAIL to compile (`RoomEditTranslator` missing).

- [ ] **Step 2: Write the translator**

```csharp
// packages/server/dotnet/Blok.Server/Agent/RoomEditTranslator.cs
using System.Text.Json.Nodes;
using Blok.Server.Collab;

namespace Blok.Server.Agent;

/// <summary>Turns the planner's primitive edits into the room's internal edit ops.</summary>
internal static class RoomEditTranslator
{
  internal static IReadOnlyList<CollabEditOp> Translate(JsonArray edits, JsonObject after, JsonObject result)
  {
    var blocks = after["blocks"]!.AsArray().Select(node => node!.AsObject()).ToDictionary(block => block["id"]!.GetValue<string>(), StringComparer.Ordinal);
    var lastDataEdit = new Dictionary<string, int>(StringComparer.Ordinal);

    for (var i = 0; i < edits.Count; i++)
    {
      if (edits[i]!["op"]!.GetValue<string>() is "setData" or "setRichText")
      {
        lastDataEdit[edits[i]!["id"]!.GetValue<string>()] = i;
      }
    }

    var ops = new List<CollabEditOp>();

    for (var i = 0; i < edits.Count; i++)
    {
      var edit = edits[i]!.AsObject();
      var id = edit["id"]?.GetValue<string>();

      switch (edit["op"]!.GetValue<string>())
      {
        case "insert":
          InsertTree(edit["block"]!.AsObject(), edit["parentId"]?.GetValue<string>(), edit["afterId"]?.GetValue<string>(), ops);
          break;
        case "remove":
          ops.Add(new CollabEditOp.Remove(id!));
          break;
        case "move":
          ops.Add(new CollabEditOp.Move(id!, edit["afterId"]?.GetValue<string>(), edit["parentId"]?.GetValue<string>()));
          break;
        case "setData" or "setRichText" when lastDataEdit[id!] == i && blocks.TryGetValue(id!, out var changed):
          ops.Add(new CollabEditOp.Update(id!, changed["data"]!.DeepClone().AsObject()));
          break;
        case "setTunes" when blocks.TryGetValue(id!, out var tuned):
        {
          // The final value of each tune the edit named; null where the batch removed it.
          var tunes = new JsonObject();

          foreach (var (name, _) in edit["tunes"]!.AsObject())
          {
            tunes[name] = tuned["tunes"]?[name]?.DeepClone();
          }

          ops.Add(new CollabEditOp.SetTunes(id!, tunes));
          break;
        }
        case "replaceType" when blocks.TryGetValue(id!, out var retyped):
          ops.Add(new CollabEditOp.Retype(id!, retyped["type"]!.GetValue<string>(), retyped["data"]!.DeepClone().AsObject()));
          break;
        case "setPageField":
          ops.Add(new CollabEditOp.SetPageField(edit["key"]!.GetValue<string>(), edit["value"]?.DeepClone()));
          break;
      }
    }

    var stamped = (result["changed"]?["created"]?.AsArray() ?? []).Concat(result["changed"]?["updated"]?.AsArray() ?? [])
        .Select(node => node!.GetValue<string>()).Distinct(StringComparer.Ordinal);

    foreach (var stampedId in stamped)
    {
      if (blocks.TryGetValue(stampedId, out var block) && block["lastEditedBy"] is JsonValue by && block["lastEditedAt"] is JsonValue at)
      {
        ops.Add(new CollabEditOp.SetMetadata(stampedId, at.GetValue<double>(), by.GetValue<string>()));
      }
    }

    return ops;
  }

  private static void InsertTree(JsonObject planned, string? parentId, string? afterId, List<CollabEditOp> ops)
  {
    var id = planned["id"]!.GetValue<string>();
    var block = new JsonObject { ["type"] = planned["type"]!.DeepClone(), ["data"] = planned["data"]!.DeepClone() };

    if (planned["tunes"] is { } tunes)
    {
      block["tunes"] = tunes.DeepClone();
    }

    ops.Add(new CollabEditOp.Insert(id, block, afterId, parentId));

    string? previous = null;

    foreach (var child in planned["children"]!.AsArray())
    {
      InsertTree(child!.AsObject(), id, previous, ops);
      previous = child!["id"]!.GetValue<string>();
    }
  }
}
```

The insert uses the planned data; a later `setData` on the same new block becomes an `Update` after it, as the table above says.

- [ ] **Step 3: Run it**

Run: `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~RoomEditTranslatorTests"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/dotnet/Blok.Server/Agent/RoomEditTranslator.cs packages/server/dotnet/Blok.Server.Tests/Agent/RoomEditTranslatorTests.cs
git commit -m "feat(server): translate planner edits into internal room edit ops

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 45: `ExecuteInRoomAsync`

**Files:**
- Modify: `packages/server/dotnet/Blok.Server/Agent/BlokAgentExecutor.cs`, `packages/server/dotnet/Blok.Server/Collab/CollabRoomManager.cs` (an internal agent entry point next to `RestoreAsync`, `:536`), the collab DI registration in `Blok.Server.AspNetCore` (construct the executor with the room manager and converter when collab is registered)
- Test: `packages/server/dotnet/Blok.Server.Tests/Agent/BlokAgentRoomTests.cs`

**Interfaces:**
- Consumes: `CollabRoom.EditAsync(planOps, operationId, digest, actorId, expect, ct)` (`CollabRoom.cs:553-563`), `EditInRoomAsync` (`CollabRoomManager.cs:373`), `ICollabDocConverter.ExportAsync` (`ICollabDocConverter.cs:29`), `CollabEditPrecondition(Lineage, Sequence)` (`CollabRoomManager.cs:90`), `CollabEditResult` / `CollabEditReceipt(Tag, ServerSequence)` (`:92-97`), `CollabEditOps.CanonicalBodyDigest` (`CollabEditOps.cs:148`); Task 44.
- Produces:
  - `internal ValueTask<CollabEditResult> CollabRoomManager.AgentEditAsync(string docId, Func<YDoc, CancellationToken, ValueTask<IReadOnlyList<CollabEditOp>>> planOps, string operationId, ReadOnlyMemory<byte> digest, string? actorId, CollabEditPrecondition? expect, CancellationToken cancellationToken)` (wraps `EditInRoomAsync(docId, room => room.EditAsync(planOps, …))`, as `RestoreAsync` does at `:563-576`).
  - `internal BlokAgentExecutor(IBlokRuntime runtime, CollabRoomManager? rooms, ICollabDocConverter? converter)`.
  - `ExecuteInRoomAsync` per 01 §3.14: removes `expectRevision` from the batch before Jint; parses it as `lineage:sequence` into the precondition (malformed → `INVALID_ARGS`); plans inside the room lane (export → Jint `agentExecute` → `RoomEditTranslator`); a failed Jint result aborts the edit with nothing written and returns that result; `PreconditionFailed` → `STALE` (retryable); success → `result.revision` and `BlokAgentExecution.Revision` = the journal head `lineage:sequence` after commit; `DocumentJson` is `null`. `history.undo` / `redo` → `COMMAND_UNAVAILABLE` (Jint's contract; D6). The journal names `actor.Id` (`actorId`).

- [ ] **Step 1: Write the failing tests**

```csharp
// packages/server/dotnet/Blok.Server.Tests/Agent/BlokAgentRoomTests.cs
using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Collab;
using Blok.Server.Runtime;
using Blok.Server.Tests.Collab;
using Xunit;

namespace Blok.Server.Tests.Agent;

public sealed class BlokAgentRoomTests
{
  private const string DocId = "agent-room";
  private readonly FakeDocEndpoint endpoint = new();
  private readonly FakeCollabOperationStore operations = new();
  private readonly ManualTimeProvider time = new();

  public BlokAgentRoomTests()
  {
    endpoint.HoldsDocument(DocId, """{"blocks":[{"id":"p","type":"paragraph","data":{"text":"Hello world"}}]}""");
  }

  private (BlokAgentExecutor Executor, CollabRoomManager Rooms) Create()
  {
    var converter = new CollabDocConverter(time, RichTextRuntime.Reader);
    var rooms = new CollabRoomManager(new LocalCollabStore(Path.GetTempPath()), endpoint, converter, new CollabRoomOptions(), time, _ => { }, operations);

    return (new BlokAgentExecutor(JintBlokRuntime.FromEmbeddedResource(1, null, null), rooms, converter), rooms);
  }

  [Fact]
  public async Task EditsTheLiveRoomAndReturnsTheJournalHead()
  {
    var (executor, rooms) = Create();

    var execution = await executor.ExecuteInRoomAsync(DocId,
        """{"commands":[{"name":"text.format","args":{"id":"p","range":{"find":"world"},"set":{"bold":true}}}]}""",
        new BlokAgentActor("agent-cs", "Agent"));

    Assert.True(JsonNode.Parse(execution.ResultJson)!["ok"]!.GetValue<bool>(), execution.ResultJson);
    Assert.Matches("^[0-9a-f]+:[0-9]+$", execution.Revision);
    var state = JsonNode.Parse((await rooms.StateAsync(DocId)).Json)!;
    Assert.Equal("agent-cs", state["blocks"]![0]!["lastEditedBy"]!.GetValue<string>());
  }

  [Fact]
  public async Task AStaleJournalHeadWritesNothing()
  {
    var (executor, rooms) = Create();
    var before = (await rooms.StateAsync(DocId)).Json;

    var execution = await executor.ExecuteInRoomAsync(DocId,
        """{"expectRevision":"ffffffffffffffffffffffffffffffff:99","commands":[{"name":"block.delete","args":{"id":"p"}}]}""",
        new BlokAgentActor("agent-cs", "Agent"));

    Assert.Equal("STALE", JsonNode.Parse(execution.ResultJson)!["error"]!["code"]!.GetValue<string>());
    Assert.Equal(JsonNode.Parse(before)!["blocks"]!.ToJsonString(), JsonNode.Parse((await rooms.StateAsync(DocId)).Json)!["blocks"]!.ToJsonString());
  }

  [Fact]
  public async Task UndoIsUnavailableInARoom()
  {
    var (executor, _) = Create();

    var execution = await executor.ExecuteInRoomAsync(DocId, """{"commands":[{"name":"history.undo","args":{}}]}""", new BlokAgentActor("a", "A"));

    Assert.Equal("COMMAND_UNAVAILABLE", JsonNode.Parse(execution.ResultJson)!["error"]!["code"]!.GetValue<string>());
  }
}
```

**Unverified:** the exact constructors of `CollabRoomManager`, `LocalCollabStore`, `FakeDocEndpoint.HoldsDocument` and `StateAsync(...).Json` beyond what `CollabHistoryManagerTests.cs:438-468` shows; copy that file's `ManagerOver` setup (store, endpoint, converter, options, time, log, operation store) exactly.

Run: `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~BlokAgentRoomTests"`
Expected: FAIL to compile (the 3-argument constructor is missing).

- [ ] **Step 2: Write the room path**

`CollabRoomManager.cs`, next to `RestoreAsync`:

```csharp
  /// <summary>An agent batch planned against the live doc inside the room lane (01 §3.14).</summary>
  internal ValueTask<CollabEditResult> AgentEditAsync(
      string docId,
      Func<YDoc, CancellationToken, ValueTask<IReadOnlyList<CollabEditOp>>> planOps,
      string operationId,
      ReadOnlyMemory<byte> digest,
      string? actorId,
      CollabEditPrecondition? expect,
      CancellationToken cancellationToken)
  {
    return EditInRoomAsync(docId, room => room.EditAsync(planOps, operationId, digest, actorId, expect, cancellationToken));
  }
```

`BlokAgentExecutor.cs` — add the fields and constructor, and replace `ExecuteInRoomAsync`:

```csharp
  private readonly CollabRoomManager? rooms;
  private readonly ICollabDocConverter? converter;

  internal BlokAgentExecutor(IBlokRuntime runtime, CollabRoomManager? rooms, ICollabDocConverter? converter) : this(runtime)
  {
    this.rooms = rooms;
    this.converter = converter;
  }

  public async ValueTask<BlokAgentExecution> ExecuteInRoomAsync(
      string docId, string batchJson, BlokAgentActor actor,
      BlokAgentOptions? options = null, CancellationToken cancellationToken = default)
  {
    if (rooms is null || converter is null)
    {
      return Unavailable("Live rooms need collaboration on this server.");
    }

    var batch = JsonNode.Parse(batchJson)!.AsObject();
    var expect = batch["expectRevision"]?.GetValue<string>();

    batch.Remove("expectRevision");

    CollabEditPrecondition? precondition = null;

    if (expect is not null)
    {
      var colon = expect.LastIndexOf(':');

      if (colon <= 0 || !ulong.TryParse(expect.AsSpan(colon + 1), out var sequence))
      {
        return Failure("INVALID_ARGS", "In a room, expectRevision is the journal head \"lineage:sequence\" a result returned.", null);
      }

      precondition = new CollabEditPrecondition(expect[..colon], sequence);
    }

    JsonObject? planned = null;
    var operationId = Guid.NewGuid().ToString("N");
    var digest = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes($"agent\n{actor.Id}\n{batch.ToJsonString()}"));

    var edit = await rooms.AgentEditAsync(docId, async (doc, token) =>
    {
      var input = Common(options);
      input["document"] = await converter.ExportAsync(doc, token);
      input["batch"] = batch.DeepClone();
      input["actor"] = ActorNode(actor);

      var output = JsonNode.Parse(await runtime.InvokeAsync("agentExecute", input.ToJsonString(), cancellationToken: token))!.AsObject();

      planned = output;

      return output["result"]?["ok"]?.GetValue<bool>() == true
          ? RoomEditTranslator.Translate(output["edits"]!.AsArray(), output["document"]!.AsObject(), output["result"]!.AsObject())
          : [];
    }, operationId, digest, actor.Id, precondition, cancellationToken);

    if (edit.Status == CollabEditStatus.PreconditionFailed)
    {
      var head = edit.Receipt is { } r ? $"{r.Tag.Lineage}:{r.ServerSequence}" : "";

      return new BlokAgentExecution(Failure("STALE", "The room changed since you read it. Read it again, then retry.", null).ResultJson.Replace("\"retryable\":false", "\"retryable\":true"), null, head);
    }

    var result = planned?["result"]?.AsObject() ?? JsonNode.Parse(Failure("APPLY_FAILED", $"The room refused the edit ({edit.Status}).", null).ResultJson)!.AsObject();

    if (edit.Status != CollabEditStatus.Applied && result["ok"]?.GetValue<bool>() == true)
    {
      result = JsonNode.Parse(Failure("APPLY_FAILED", $"The room refused the edit ({edit.Status}). Nothing was written.", null).ResultJson)!.AsObject();
    }

    var revision = edit.Receipt is { } receipt ? $"{receipt.Tag.Lineage}:{receipt.ServerSequence}" : "";

    if (result["ok"]?.GetValue<bool>() == true)
    {
      result["revision"] = revision;
    }

    return new BlokAgentExecution(result.ToJsonString(), null, revision);
  }
```

An empty op list for a failed Jint result: **unverified** whether `CollabRoom.EditAsync` accepts zero ops (`ApplyOps` returns early on `ops.Count == 0`, `YDocConverter.cs:285-288`, but the room may still journal an empty commit). If it journals one, throw a private `AgentRefusedException` from `planOps` instead and catch it around `AgentEditAsync` (as `RestoreAsync` does with `RestorePointMissingException`, `CollabRoomManager.cs:578-581`), returning `planned["result"]`.

In the AspNetCore collab registration (the code that registers `CollabRoomManager`), register `IBlokAgentExecutor` with the 3-argument constructor so it takes precedence over the stored-only registration (register it before `AddBlokDocuments`' `TryAddSingleton`, or replace it).

- [ ] **Step 3: Run them**

Run: `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~BlokAgent"`
Expected: PASS.
Run: `dotnet test packages/server/dotnet/Blok.Server.AspNetCore.Tests/Blok.Server.AspNetCore.Tests.csproj`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/dotnet/Blok.Server/Agent/BlokAgentExecutor.cs packages/server/dotnet/Blok.Server/Collab/CollabRoomManager.cs packages/server/dotnet/Blok.Server.AspNetCore packages/server/dotnet/Blok.Server.Tests/Agent/BlokAgentRoomTests.cs
git commit -m "feat(server): ExecuteInRoomAsync plans agent batches inside the live room

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 46: The concurrent-move test (room parity is 05 Task 13)

05 owns the C# `room` parity runner (05 Task 13, `RoomAgentParityTests`; 06 §7.5). This task keeps only 06 §7.5's concurrency test, which 05 leaves to this plan: "a `Move` while a second client types inside the moved block keeps both edits".

**Files:**
- Create: `packages/server/dotnet/Blok.Server.Tests/Agent/AgentRoomMoveTests.cs`

**Interfaces:**
- Consumes: Task 42 `Move`, `CollabRoomTestSupport.cs` helpers (`YDocs`), `RichTextRuntime` test helpers.
- Produces: the concurrent-move test.

- [ ] **Step 1: Write the test**

```csharp
// packages/server/dotnet/Blok.Server.Tests/Agent/AgentRoomMoveTests.cs
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Tests.Collab;
using Blok.Server.Yjs;
using Xunit;

namespace Blok.Server.Tests.Agent;

public sealed class AgentRoomMoveTests
{
  [Fact]
  public void AMoveKeepsAPeersConcurrentTyping()
  {
    var seed = JsonNode.Parse("""[{"id":"t","type":"toggle","data":{"text":[]}},{"id":"p","type":"paragraph","data":{"text":[{"text":"ab"}]}}]""")!.AsArray();
    var server = new YDoc();
    RichTextRuntime.Seed(server, seed);
    var peer = new YDoc();
    YDocs.Apply(peer, YDocs.FullState(server));

    // The peer types inside "p" while the server moves "p" into "t"; then they sync both ways.
    RichTextRuntime.ApplyOps(peer, [new CollabEditOp.Update("p", (JsonObject)JsonNode.Parse("""{"text":[{"text":"aXb"}]}""")!)]);
    RichTextRuntime.ApplyOps(server, [new CollabEditOp.Move("p", null, "t")]);
    YDocs.Apply(server, YDocs.FullState(peer));
    YDocs.Apply(peer, YDocs.FullState(server));

    foreach (var doc in new[] { server, peer })
    {
      var p = RichTextRuntime.Export(doc).Single(b => b!["id"]!.GetValue<string>() == "p")!;
      Assert.Equal("t", p["parent"]!.GetValue<string>());
      Assert.Equal("""[{"text":"aXb"}]""", p["data"]!["text"]!.ToJsonString());
    }
  }
}
```

- [ ] **Step 2: Run it**

Run: `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~AgentRoomMoveTests"`
Expected: PASS once Task 42's `Move` keeps the block map's identity. A failure here is a `Move` bug: fix `PlanMove` with a focused case in `AgentRoomOpsTests` first.

- [ ] **Step 3: Commit**

```bash
git add packages/server/dotnet/Blok.Server.Tests/Agent/AgentRoomMoveTests.cs
git commit -m "test(server): a room move keeps a peer's concurrent typing

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Checkpoint 5 (final gates)

- [ ] `dotnet test packages/server/dotnet/Blok.Server.slnx` — PASS.
- [ ] The full JS gates, which are the final gate for this plan (CLAUDE.md "Landing the Plane"): `yarn lint` and `yarn test`. If a failure is in a file this plan did not change (`git diff --name-only <first commit of this plan>^..HEAD`), it is pre-existing: note it, do not fix it here.
- [ ] `yarn e2e test/playwright/tests/agent/agent-commands.spec.ts` — PASS.
- [ ] `git pull --rebase && git push`; `git status` says "up to date with origin".
- [ ] Release-note items for the user (06 D4, D5): the D5 BREAKING `blocks.convert` change; `types/agent.d.ts` and its re-export; `BlockMutationEventDetail.agent`; the `doc.setTitle` / `doc.setIcon` commands and the use of `OutputData.title` / `.icon` (D-1); NuGet `IBlokAgentExecutor`, `BlokAgentActor`, `BlokAgentExecution`, `BlokAgentOptions`, `IBlokPageTarget`, `BlokPageLocation`.

---

## Self-review

**Spec coverage (01 section → task).**

| Spec item | Task |
|---|---|
| §3.1 planner / three appliers / ports / code locations | 3, 8, 7, 27, 34, 19, 23 |
| §3.1 view-entry exception for `src/mcp/` | 19 |
| §3.2 browser goes through BlockManager; Node writes the store | 27, 34 |
| §3.3 steps 0–6, three cancel points, host-effect alone, read-only guard, post-write validation scope, `prepareInsert` / `ORPHANED_SIDE_EFFECT`, snapshot dialect and freshness, loading | 16, 3, 15, 26, 31, 19 |
| §3.4 `Edit` union and every applier mapping; self-placed parents; tool-minted data (`normalize`) | 1, 7, 27, 34, 44, 8 |
| §3.5 refuse never demote; rules from data; shared predicates + parity; columns; explicit children; sanitize everything; Markdown look-alike; opaque blocks | 5, 8, 10, 30, 32, 19, 23 |
| §3.6 one step per execute; turn merge; own steps only; stored undo; Jint / live undo unavailable; step metadata | 27, 28, 29, 17, 35, 37, 45, 25 |
| §3.7 per-touched-block attribution, `detail.agent`, Node stamps, C# metadata | 24, 7, 34, 43, 44 |
| §3.8 Markdown additive; `yjsSync: 'add'`; `expectRevision` / `expectText` / `STALE.details.current`; revision per runtime; `CONFLICT` | 13, 27, 11, 16, 17, 26, 34, 45 |
| §3.9 text units and ranges | 6, 11 |
| §3.10 error model and warnings | 2, every task |
| §3.11 view, paging, find | 12 |
| §3.12 tool action dispatch | 14 |
| §3.13 A page fields everywhere; B headless page actions | 13, 7, 27, 34, 41; 17, 40 |
| §3.14 Jint ops, `IBlokAgentExecutor`, translator, internal ops, `ExecuteInRoomAsync` | 37, 38, 41–45 |
| §4 D5 BREAKING commit | 22 |
| §6 laws (purity, placement parity, silent failure, view-entry), parity corpus and runners, editor and store integration, C# tests, E2E | 20, 5, 19, 21 (cases), 32 (jsdom runner), 46 (concurrent move); corpus, goldens and the other runners are 05 Tasks 6–8, 11–13; 28–31, 34–35, 33 |

**`CONFLICT`:** a concurrent `convert` refusal maps to `CONFLICT` in Task 27a (typed `ConvertConflictError` at `block-mutation.ts:1700`, `:1829`, `:1879`).

**D-3 propagated:** `history.undo` / `history.redo` alone in their batch. 03 sends no undo through `execute`, 04 passes batches through unchanged (01's executor refuses a mixed one), and 05's corpus and eval references put each undo in its own batch (06 "Execution order").

**Placeholder scan:** done. Remaining "unverified" labels are real unknowns, each with the test that pins it and the fallback.

**Type consistency checked:** `PlannerTool` / `PlannerCommand` / `PlannerToolRuntime` (Task 3) are structural subsets of 02's `BlockToolManifestEntry` / `CommandEntry` / `ToolRuntime`; `AgentApplier` (16) is implemented by the document applier (17), `EditorApplier` (27) and `StoreApplier` (34); `buildPlannedBlock`'s 7th parameter (14) is used by `createActionContext`; `prepareData(…, { normalize })` (8) is used by `emitPatch` (14); `lastEdits()` (37) is added to the session factory of 17.
