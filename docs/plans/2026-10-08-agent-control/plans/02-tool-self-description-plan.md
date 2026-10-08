# Tool Self-Description and Capability Manifest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Blok tool describes its saved data, its named actions, its structure facts and its traps in a machine-readable form, and core assembles one manifest and one agent contract from the live registry, in the browser, in Node and in the C# Jint runtime.

**Architecture:** Each built-in tool gets a pure module under `src/shared/tool-descriptions/` (JSON half) and, where needed, `src/shared/tool-actions/` (code half: handlers, `normalize`, `defaultChildren`, sanitize). Tool classes point new optional statics (`describe`, `actionHandlers`) at those modules. `blokDocumentSchema` is assembled from the same modules and stays byte-identical. A pure `buildToolManifest(snapshot)` and `buildAgentContract(manifest, COMMANDS, where)` in `src/shared/tool-manifest.ts` turn a registry snapshot into the JSON that specs 03 and 04 render.

**Tech Stack:** TypeScript, Vitest 4.1.11 (jsdom project `unit`, `// @vitest-environment node` per file), JSON Schema draft 2020-12 (a closed keyword profile, in-house validator), Vite IIFE build for the Jint bundle (`scripts/build-server-runtime.mjs`).

**Spec:** `docs/plans/2026-10-08-agent-control/02-tool-self-description.md`. Binding contract and decisions: `docs/plans/2026-10-08-agent-control/06-reconciliation.md` §3 and §12 (round 3 wins over older sections). Read both before any task.

Facts in this plan were read at `30c77599` (the spec cites `fb62db72`). Anything not read is labelled **unverified**.

## Global Constraints

- Data schemas are JSON Schema draft 2020-12, restricted to this keyword profile: `type`, `enum`, `const`, `properties`, `required`, `additionalProperties`, `patternProperties`, `items`, `oneOf`, `anyOf`, `allOf`, `if`, `then`, `minimum`, `maximum`, `exclusiveMinimum`, `minLength`, `maxLength`, `minItems`, `maxItems`, `pattern`, `deprecated`, `description`, `default`, `examples`.
  - `pattern` is NOT in spec §3.2's list, but `src/view/document-schema.ts:537,550,567` uses it on image markup `color`. The profile must carry it or image fails the profile law. This plan adds it.
  - `type` may be a string or an array of strings (`src/view/document-schema.ts:297-298`, callout `textColor: { type: ['string', 'null'] }`).
  - `$ref`, `$defs`, `$schema`, `$id`, `title` are envelope-only. They never appear in a per-tool schema.
- No schema library. `package.json` must not change (CLAUDE.md "Configuration").
- `blokDocumentSchema` JSON stays byte-identical through every refactor. The two planned changes are the optional top-level `title` and `icon` (Task 23) and the image markup widening (Task 24a), each re-pinned once, in either order (Task 24a may ship early, see its Step 2). Key order is part of "byte-identical".
- Published-types law: no file under `types/` imports from `src/` (`test/unit/architecture/published-types-no-src-refs.test.ts`). New declarations are hand-authored.
- Every new value exported from `src/view/index.ts` is declared in `types/view.d.ts` (`published-types-no-src-refs.test.ts:214-247`).
- No module outside `src/view/` imports from `src/view/` (`test/unit/architecture/view-entry-law.test.ts:58-66`).
- Modules under `src/shared/tool-descriptions/`, `src/shared/tool-actions/`, `src/shared/schema/` and `src/shared/tool-manifest.ts` import nothing from `src/components/` or `src/tools/`, no DOM, no `window` at load (spec §3.3).
- Tool command names are `<registryKey>.<action>`, action names camelCase. Reserved registry keys: `doc`, `block`, `text`, `markdown`, `history` (06 §3.1).
- An action's `args` schema never declares `id`, `parentId` or `position`. Core adds them by `target` (06 §3.1).
- Agent guidance text is English and lives in the description. Titles come from i18n (spec K7).
- New public surface is additive and approved with a release note (06 D4). Last tag is `v1.16.1`. None of the new surfaces shipped, so nothing here is labelled `BREAKING`.
- Function sanitize rules travel by reference, never as JSON, in v1 (06 01-Q6, R3-9).
- `nanoid` is NOT in the Jint bundle today (`grep -c nanoid` on the generated bundle printed 0), and the Jint realm has no `crypto`. Shared code that mints ids takes an injected minter and defaults to `mintId` (Task 14), which works with no `crypto`.
- Commands:
  - Tests: `yarn test <one file>`. One path per invocation. Several paths in one `vitest run` silently run a subset (memory `blok-agent-gate-traps` #2). Never run two vitest processes at once (#7).
  - Lint: `npx eslint <changed files>`. Full `yarn lint` ESLint cannot run locally (memory #1).
  - Types: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` with a 600000 ms timeout (memory `blok-local-tsc-needs-8gb-heap`).
  - E2E: `yarn e2e <file> -g "<pattern>"`.
- Commits go straight to `main`. Stage explicit paths with `git add <paths>`. Never `git commit -a`, never `git add -A`. Fail the commit if `git diff --cached --name-only` lists a file you did not touch (memory `concurrent-commit-race-shared-index`). Every commit message ends with:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- Code comments follow CLAUDE.md "Comments": only what silently breaks if changed.

## Review Focus

The five inputs the spec implies but no happy-path test exercises. Each one has its test in the owning task.

1. **A legacy table with plain-string cells goes through `normalize`.** Expected: string cells stay strings, untouched. Only object cells gain `id` / `rowId`. `ensureTableIds` spreads every cell, so a string cell would become `{0:'a',1:'b',id,rowId}`. Test in Task 15.
2. **A host config with an empty list: `header.levels: []`, `list.styles: []`.** Expected: no narrowing, the widest schema. The toolbox already reads `[]` as "no restriction" (`src/components/tools/block.ts:479-493`, `filterToolboxEntriesByLevels`). An empty `enum` would reject every write. Test in Task 17. (`image.filters: []` is the one deliberate exception: it hides the Filters tab, so the agent may not set a filter. Test in Task 20.)
3. **A third-party tool that already has an unrelated static `describe`** (a function returning a string, or throwing). Expected: the manifest builds, the tool degrades to `structural`, a warning is logged, nothing throws. The non-description return is tested in Task 5; the throw is caught where `describe` is called, in Task 26 (`describeSafely`), and tested there.
4. **A host that registers the table tool under another key, e.g. `grid`.** Expected: its actions are `grid.insertRows`, etc., and `selfPlacesChildren` is `false`, mirroring core's hard-coded `SELF_PLACING_PARENTS = new Set(['table', 'database'])` (`src/tools/nested-blocks.ts:110`, 06 B7). The manifest mirrors core; it does not fix it. Test in Task 5.
5. **Moved function sanitize rules run in the headless sanitizer.** `<mark style="color:red;font-size:40px">` through `src/view/sanitize.ts` with the moved `INLINE_TEXT_SANITIZE` must keep `color` and drop `font-size`, exactly as the editor sanitizer does. `preserveColorStyles` reads `node.style`. The parse5 path has a minimal `CSSStyleDeclaration` facade (`src/view/sanitize.ts:219-232`); whether it serializes the kept style exactly as jsdom does is **unverified**. Test in Task 8.

## Cross-plan dependencies

Names are the canonical produced names. "Task N" is a task in this plan.

**This plan needs from plan 01 (core commands):**

| Needed | Used by | If 01 has not landed it |
|---|---|---|
| `types/agent.d.ts` publishing `InsertSpec` and `RichTextHelpers` (06 R2-02-5) | Task 12 (`ToolActionImpl`, `ToolActionContext` types), and through it Task 13 and Phase 4 | Task 12 waits. Do Tasks 14, 15 and Phase 3 first; only the runtime registrations (Task 15 Step 2b, the `defaultChildren` lines of Task 18) wait too. |
| `COMMANDS` in `src/shared/agent/commands.ts` (01 Task 3) | Task 50 (Jint `manifest` op returns a contract) | Task 50 waits. `buildAgentContract` itself (Task 6) takes a structural `CoreCommandTable` and never imports 01. Task 50 is the only owner of the `manifest` op; 01 Task 37 adds only `agentExecute` and waits for Task 50. |
| The real recording `ToolActionContext` and the appliers (`EditorApplier`, `JsonApplier`, `StoreApplier`) | Action parity tests (spec §6 item 6) | Action tasks unit-test against a fake recording ctx (Task 12). Parity cases are owned by 05's corpus and 01's appliers. |
| `ctx.newId()` that works in Jint | Every action that mints ids | Handlers pass `() => ctx.newId()` into the models. |
| The Node `pageBackend` object: 01's `createPageMapBackend(open, actor, readBlock)` (01 Task 17) implements this plan's `PageBackendService` (Task 12), block id in | Task 49 | Task 49 declares the actions; only the browser `prepare` path is tested here. |
| `ctx.update(id, { field: undefined })` removes that key, and post-write validation skips removed keys | Every action that clears a field (`image.rotate` back to 0, `image.crop` to the full rect) | **Settled.** 01 Task 14 maps `undefined` to `null` in the recorded `setData` (null survives JSON into Jint), every applier deletes a `null` key, and 01 Task 15 skips `null` keys (`checkKeys`). The fake ctx (Task 12) deletes on `undefined`, the same observable result. |
| The registry key of the tool whose `create` action runs | `create` actions (`table.create`, `column_list.create`, `tabs.create`, `database.create`, `bookmark.create`) | **Settled.** `ToolActionContext.tool: string` (06 §3.4, round 4), filled by 01 Task 14 from `entry.source.tool`. Handlers insert `type: ctx.tool` (Tasks 31, 38, 39, 41, 48); the fake ctx takes `tool` as its third argument. |
| 01's planner refuses a bare `block.insert` of a table | — | **Settled.** 01 Task 8 Step 7: `block.insert` of a type whose manifest entry has `children.ownedByTool: true` (from the class's `ownsChildren`, so a table registered as `grid` is caught too), whose runtime has no `defaultChildren`, and whose contract lists `<type>.create` fails `INVALID_ARGS` with `details.use: '<type>.create'`. `table.defaultChildren` stays unset (Task 31). |

**Plans that depend on this plan's tasks:**

| Consumer | Needs (produced name) | Produced by |
|---|---|---|
| 01 | `validateAgainst`, `SchemaProblem` | Task 2 |
| 01 | `mintId(length?)` (`src/shared/mint-id.ts`; 01's headless `newId` uses it, no second minter) | Task 14 |
| 01, 03 | `PageBackendService`, `LinkMetadataService`, `UploaderService` (`src/shared/tool-actions/services.ts`, types only) | Task 12 |
| 01 | `cleanupEmptiedColumnList(ctx, columnListId): boolean` (01's `block.move` removes the emptied column, then calls it on the list) | Task 38 |
| 01 | `ToolRuntime`, `ToolRuntimeRegistry`, `buildToolRuntimes`, `BUILT_IN_TOOL_RUNTIMES` | Task 13 (actions fill in through Task 49) |
| 01 | Table `ToolRuntime.normalize` (live-mode blocker, 06 C17) | Task 15 |
| 01 | `defaultChildren` for `column_list`, `column`, `callout`, `tabs` | Tasks 38, 39, 18 |
| 01 | `BlockToolManifestEntry.viewState`, `.guardedFields`, `.selfPlacesChildren`, `.restrictedInTableCell`, `.summaryFields`, `.conversion` | Task 5 (fields), Tasks 16-22 (values) |
| 01 | `RESERVED_NAMESPACES` (one constant, exported from `src/shared/tool-manifest.ts`; 01 imports it instead of redefining) | Task 5 |
| 01, 03, 04, 05 | `buildToolManifest`, `buildAgentContract`, `AgentContract`, `CommandEntry`, `AgentGuidance`, `ManifestOverrides`, `ContractWhere`, `CoreCommandTable` | Tasks 5, 6 |
| 01 (editor contract), 03 | `snapshotFromTools`, `runtimesFromTools` (browser registry snapshot and runtimes, `src/components/tools/registry-snapshot.ts`). 03 does not call them directly: it uses 01's `liveContractSource` (01 Task 28), which does. | Task 26 |
| 03 | `inputFields` on every multi-input built-in | Task 28 |
| 03, 04 | `BlokToolManifest`, `BlockToolManifestEntry` and every type in `types/tool-manifest.d.ts` | Task 3 |
| 01, 04, 05 | `BUILT_IN_BLOCK_DESCRIPTIONS`, `buildBuiltInSnapshot`, `BlokCustomToolsFile`, `readCustomToolsFile`, `snapshotWithCustomTools`, `runtimesWithCustomTools`. 01's `createHeadlessAgentSetup` (01 Task 21) composes them for Node; 04 and 05 call that setup, not these directly (04 wraps `readCustomToolsFile` for its `--manifest` parse). | Tasks 16, 27, 3, 29 |
| 04 | Table `normalize` before table writes ship in live mode (04 B5) | Task 15 |
| 04, C# | Jint `manifest` operation | Task 50 |
| 05 | Named menu items (stable `menu:<tool>/<name>` ids) | Task 53 |
| 05 | `ToolActionDeclaration.mirrors` filled with capability ids | Task 54 |
| 05 | The Node-built contract (`buildBuiltInSnapshot` + `buildToolManifest` + `buildAgentContract`) | Tasks 27, 51 |

**Overlap with plan 05 (resolved).** This plan owns the naming (Task 53). 05 Task 2 only asserts "menu items have names" and goes green on these names; it adds no `name:` line. Count, re-measured at `30c77599` with a TypeScript AST scan over all of `src/` (playground and stories excluded): 90 object literals with `onActivate`, 24 with no `name`, all 24 under `src/tools/`, plus 1 spread (`src/components/modules/toolbar/inline/index.ts:637`) that keeps the spread item's `name` (`:626-636`). 05's "25" counted that spread; its own enumerator treats a spread as named. So both plans mean the same 24 items (the table in Task 53).

---

## File Structure

Created:

| Path | Responsibility |
|---|---|
| `src/shared/schema/validate.ts` | `SCHEMA_PROFILE_KEYWORDS`, `validateAgainst`, `unknownKeywords`. Pure. |
| `src/shared/tool-manifest.ts` | `RESERVED_NAMESPACES`, `buildToolManifest`, `buildAgentContract`, `canonicalHash`. Pure. |
| `src/shared/tool-descriptions/rich-text.ts` | `RICH_TEXT_MARKS`, `richText`, `ALIGNMENT` (moved from `document-schema.ts`). |
| `src/shared/tool-descriptions/<tool>.ts` | One per built-in block tool: `<TOOL>_DATA` literal and `describe<Tool>(config)`. |
| `src/shared/tool-descriptions/inline.ts` | `BUILT_IN_INLINE_DESCRIPTIONS`, `BUILT_IN_TUNE_DESCRIPTIONS`. |
| `src/shared/tool-descriptions/index.ts` | `BUILT_IN_BLOCK_DESCRIPTIONS`. |
| `src/shared/tool-descriptions/built-in-statics.ts` | `BUILT_IN_BLOCK_STATICS`, `BUILT_IN_INLINE_STATICS`, `buildBuiltInSnapshot`. |
| `src/shared/tool-descriptions/sanitize/blocks.ts` | Each built-in block tool's own sanitize factory, `BUILT_IN_BLOCK_SANITIZE`. |
| `src/shared/tool-descriptions/sanitize/inline.ts` | Each built-in inline tool's sanitize factory, `BUILT_IN_INLINE_SANITIZE`. |
| `src/shared/inline-text-sanitize.ts` | `INLINE_TEXT_SANITIZE`, `preserveColorStyles`, `preserveEquationSpan` (moved). |
| `src/shared/block-color-sanitize.ts` | `BLOCK_COLOR_SANITIZE` (moved). |
| `src/shared/mint-id.ts` | `mintId(length)`: `crypto.getRandomValues` when present, else `Math.random`. |
| `src/shared/table/table-ids.ts` | `ensureTableIdsWith`, `alignRowsToColumns` (moved, minter injected). |
| `src/shared/table/table-model.ts`, `types.ts` | `TableModel` (moved, minter injected). |
| `src/shared/database/database-model.ts`, `default-text.ts` | `DatabaseModel` (moved, minter injected), English default labels. |
| `src/shared/image/geometry.ts`, `crop-math.ts`, `markup-model.ts` | Pure image math the actions reuse (moved). |
| `src/shared/embed-registry.ts` | `matchEmbedService`, `buildEmbedUrl`, `EMBED_SERVICES` (moved). |
| `src/shared/tool-actions/runtime.ts` | `ToolRuntime`, `ToolRuntimeRegistry`, `buildToolRuntimes`. |
| `src/shared/tool-actions/services.ts` | Host service shapes: `UploaderService`, `LinkMetadataService`, `PageBackendService`. |
| `src/shared/tool-actions/table.ts` | `TABLE_ACTIONS`, `TABLE_ACTION_HANDLERS`, `normalizeTable`. |
| `src/shared/tool-actions/columns.ts` | `COLUMN_LIST_ACTIONS`, handlers, `cleanupEmptiedColumnList`. |
| `src/shared/tool-actions/tabs.ts`, `database.ts`, `media.ts`, `image.ts`, `link.ts`, `page.ts` | The rest of §3.8. |
| `src/shared/tool-actions/index.ts` | `BUILT_IN_ACTION_HANDLERS`, `BUILT_IN_TOOL_RUNTIMES`. |
| `src/components/tools/registry-snapshot.ts` | `snapshotFromTools`, `runtimesFromTools` (browser side). |
| `types/tools/tool-description.d.ts` | Description, declaration and handler types. |
| `types/tool-manifest.d.ts` | Manifest, snapshot, contract, overrides, `BlokCustomToolsFile`. |
| `test/unit/architecture/tool-description-law.test.ts` | The law (spec §6 item 4). |

Modified: `src/view/document-schema.ts`, `src/view/server-runtime.ts`, `src/view/index.ts`, `src/blok.ts`, `types/index.d.ts`, `types/view.d.ts`, `types/tools/block-tool.d.ts`, `types/tools/inline-tool.d.ts`, `types/block-tunes/block-tune.d.ts`, every built-in tool class (one static each), the moved modules' old paths (re-export shims), `src/shared/prop-schema.ts`, the three adapter factories, `test/unit/view/document-schema.test.ts`, `test/unit/scripts/build-server-runtime.test.ts`, `test/unit/architecture/table-cell-content-law.test.ts`.

## Phases

| Phase | Tasks | Outcome |
|---|---|---|
| 1. Contract foundation | 1-7 | Validator, published types, manifest and contract builders, exports. Unblocks 01's validation and 03/04 renderers. |
| 2. Shared runtime layer | 8-15 | Sanitize rules in `src/shared/`, `buildToolRuntimes`, Jint-safe ids, table `normalize`. Unblocks 01's planner and 04's live table writes. |
| 3. Descriptions | 16-29 | Every built-in block tool, inline tool and tune described; schema assembled from descriptions; snapshots for Node and browser. |
| 4. Actions | 30-49 | Every §3.8 action declared and handled. |
| 5. Surfaces, coverage, laws | 50-56 | Jint op, Node build, adapters, menu names, `mirrors`, the law, the final gate. |

**Run-ahead exceptions (06 §14 "Execution order").** These tasks may start before earlier phases finish, because their inputs exist on `main` today: Tasks 8–11, 14 and 15's pure `normalizeTable` (Phase 2; Task 15's registration waits for Task 13), Task 30 (`TableModel` move) and Task 40 (database pieces) from Phase 4, and Task 53 (menu names) from Phase 5. Task 3 waits for 01 Task 1; Task 12 waits for 01 Task 1. Every other task keeps this plan's order.

---

## Phase 1: Contract foundation

### Task 1: Pin `blokDocumentSchema` byte for byte

**Files:**
- Modify: `test/unit/view/document-schema.test.ts` (add one `describe` block after the `'is a draft 2020-12 schema…'` test, around line 266)
- Create: `test/unit/view/__snapshots__/document-schema.json` (written by the first run)

**Interfaces:**
- Consumes: `blokDocumentSchema` (`src/view/document-schema.ts:83`).
- Produces: the stored file `test/unit/view/__snapshots__/document-schema.json`. Every later task that touches the schema must keep this test green. Task 23 and Task 24a each re-pin it once.

This is a characterization pin. It passes on creation by design. The mutation check in Step 3 proves it can fail.

- [ ] **Step 1: Write the pin**

```ts
  describe('published bytes', () => {
    // Re-pin only in the commit that adds `page` (S6). Any other diff here is a published change.
    it('serializes exactly as the pinned snapshot', async () => {
      await expect(JSON.stringify(blokDocumentSchema, null, 2))
        .toMatchFileSnapshot('./__snapshots__/document-schema.json');
    });
  });
```

- [ ] **Step 2: Run it to write the snapshot**

Run: `yarn test test/unit/view/document-schema.test.ts`
Expected: PASS, and `test/unit/view/__snapshots__/document-schema.json` now exists.

- [ ] **Step 3: Prove it can fail**

Change `'A line of rich text.'` to `'A line of rich text!'` in `src/view/document-schema.ts:182`.
Run: `yarn test test/unit/view/document-schema.test.ts`
Expected: FAIL in `published bytes`. Revert the edit and run again: PASS.

- [ ] **Step 4: Commit**

```bash
git add test/unit/view/document-schema.test.ts test/unit/view/__snapshots__/document-schema.json
git commit -m "test(view): pin blokDocumentSchema bytes before the description refactor

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2: The schema-profile validator

**Files:**
- Create: `src/shared/schema/validate.ts`
- Test: `test/unit/shared/schema/validate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SCHEMA_PROFILE_KEYWORDS: readonly string[]` (the Global Constraints list).
  - `interface SchemaProblem { path: string; message: string }`. `path` is a JSON pointer into the value (`''` is the root, `/text/0/marks`).
  - `validateAgainst(schema: Readonly<Record<string, unknown>>, value: unknown): SchemaProblem[]`. Empty array means valid. Pure.
  - `unknownKeywords(schema: unknown): string[]`. Every keyword in a schema tree that is not in the profile, with its schema path. Used by the law (Task 55).

- [ ] **Step 1: Write the failing tests**

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { SCHEMA_PROFILE_KEYWORDS, unknownKeywords, validateAgainst } from '../../../../src/shared/schema/validate';

const ok = (schema: Record<string, unknown>, value: unknown): void => {
  expect(validateAgainst(schema, value)).toEqual([]);
};
const bad = (schema: Record<string, unknown>, value: unknown, path = ''): void => {
  const problems = validateAgainst(schema, value);

  expect(problems.length).toBeGreaterThan(0);
  expect(problems[0].path).toBe(path);
};

describe('validateAgainst', () => {
  it('type: one name, a list, and integer inside number', () => {
    ok({ type: 'string' }, 'a');
    bad({ type: 'string' }, 1);
    ok({ type: ['string', 'null'] }, null);
    bad({ type: ['string', 'null'] }, 1);
    ok({ type: 'number' }, 3);
    ok({ type: 'integer' }, 3);
    bad({ type: 'integer' }, 3.5);
    ok({ type: 'array' }, []);
    bad({ type: 'object' }, []);
  });

  it('enum and const', () => {
    ok({ enum: [0, 90] }, 90);
    bad({ enum: [0, 90] }, 45);
    ok({ const: true }, true);
    bad({ const: true }, false);
  });

  it('minimum, maximum and exclusiveMinimum are different boundaries', () => {
    ok({ minimum: 38 }, 38);
    bad({ minimum: 38 }, 37.9);
    ok({ maximum: 600 }, 600);
    bad({ maximum: 600 }, 600.1);
    bad({ exclusiveMinimum: 0 }, 0);
    ok({ exclusiveMinimum: 0 }, 0.001);
  });

  it('minLength, maxLength and pattern on strings', () => {
    ok({ minLength: 1 }, 'x');
    bad({ minLength: 1 }, '');
    bad({ maxLength: 2 }, 'abc');
    ok({ maxLength: 2 }, '😀😀');
    ok({ pattern: '^#[0-9a-f]{6}$' }, '#ff3b30');
    bad({ pattern: '^#[0-9a-f]{6}$' }, 'red');
  });

  it('items, minItems and maxItems', () => {
    ok({ items: { type: 'number' }, minItems: 2, maxItems: 2 }, [1, 2]);
    bad({ items: { type: 'number' } }, [1, 'x'], '/1');
    bad({ minItems: 2 }, [1]);
    bad({ maxItems: 1 }, [1, 2]);
  });

  it('properties, required, additionalProperties and patternProperties', () => {
    const schema = {
      type: 'object',
      required: ['text'],
      additionalProperties: false,
      properties: { text: { type: 'string' } },
      patternProperties: { '^tag:': { type: 'object' } },
    };

    ok(schema, { text: 'a', 'tag:x': {} });
    bad(schema, {}, '');
    bad(schema, { text: 'a', extra: 1 }, '/extra');
    bad(schema, { text: 1 }, '/text');
    bad(schema, { text: 'a', 'tag:x': 'no' }, '/tag:x');
    ok({ additionalProperties: { type: 'string' } }, { a: 'b' });
    bad({ additionalProperties: { type: 'string' } }, { a: 1 }, '/a');
  });

  it('oneOf needs exactly one branch, anyOf at least one, allOf all', () => {
    const oneOf = { oneOf: [{ type: 'string' }, { type: 'array' }] };

    ok(oneOf, 'a');
    bad(oneOf, 1);
    bad({ oneOf: [{ type: 'number' }, { type: 'integer' }] }, 1);
    ok({ anyOf: [{ type: 'number' }, { type: 'integer' }] }, 1);
    bad({ anyOf: [{ type: 'string' }] }, 1);
    bad({ allOf: [{ type: 'number' }, { minimum: 5 }] }, 4);
  });

  it('if/then applies then only when if matches', () => {
    const schema = {
      if: { required: ['type'], properties: { type: { const: 'p' } } },
      then: { required: ['text'] },
    };

    ok(schema, { type: 'q' });
    bad(schema, { type: 'p' });
    ok(schema, { type: 'p', text: 'x' });
  });

  it('annotation keywords never fail', () => {
    ok({ description: 'x', deprecated: true, default: 1, examples: [1] }, 'anything');
  });

  it('escapes / and ~ in pointer segments', () => {
    bad({ properties: { 'a/b': { type: 'string' } } }, { 'a/b': 1 }, '/a~1b');
  });
});

describe('unknownKeywords', () => {
  it('lists keywords outside the profile, with their schema path', () => {
    expect(unknownKeywords({
      type: 'object',
      properties: { a: { $ref: '#/x' }, format: { type: 'string', format: 'uri' } },
    })).toEqual(['/properties/a/$ref', '/properties/format/format']);
  });

  it('treats property names as names, not keywords', () => {
    expect(unknownKeywords({ properties: { format: { type: 'string' } } })).toEqual([]);
  });

  it('covers the 25 profile keywords', () => {
    expect(SCHEMA_PROFILE_KEYWORDS).toHaveLength(25);
    expect(SCHEMA_PROFILE_KEYWORDS).toContain('pattern');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test test/unit/shared/schema/validate.test.ts`
Expected: FAIL, "Failed to resolve import ../../../../src/shared/schema/validate".

- [ ] **Step 3: Implement**

```ts
/**
 * Validator for the Blok schema profile: a closed subset of JSON Schema
 * draft 2020-12. A keyword outside SCHEMA_PROFILE_KEYWORDS is ignored here,
 * so the tool-description law rejects such schemas before they ship.
 */
export const SCHEMA_PROFILE_KEYWORDS: readonly string[] = [
  'type', 'enum', 'const', 'properties', 'required', 'additionalProperties', 'patternProperties',
  'items', 'oneOf', 'anyOf', 'allOf', 'if', 'then', 'minimum', 'maximum', 'exclusiveMinimum',
  'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'deprecated', 'description',
  'default', 'examples',
];

export interface SchemaProblem {
  path: string;
  message: string;
}

type Schema = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const typeOf = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }

  return typeof value;
};

const matchesType = (value: unknown, name: unknown): boolean => {
  const actual = typeOf(value);

  return actual === name || (name === 'number' && actual === 'integer');
};

const sameJson = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

const pointer = (base: string, key: string | number): string =>
  `${base}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;

const passes = (schema: Schema, value: unknown): boolean => {
  const out: SchemaProblem[] = [];

  check(schema, value, '', out);

  return out.length === 0;
};

const checkNumber = (schema: Schema, value: number, path: string, out: SchemaProblem[]): void => {
  if (typeof schema.minimum === 'number' && value < schema.minimum) {
    out.push({ path, message: `must be >= ${schema.minimum}` });
  }

  if (typeof schema.maximum === 'number' && value > schema.maximum) {
    out.push({ path, message: `must be <= ${schema.maximum}` });
  }

  if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
    out.push({ path, message: `must be > ${schema.exclusiveMinimum}` });
  }
};

const checkString = (schema: Schema, value: string, path: string, out: SchemaProblem[]): void => {
  // JSON Schema counts code points, not UTF-16 units.
  const length = [...value].length;

  if (typeof schema.minLength === 'number' && length < schema.minLength) {
    out.push({ path, message: `must have at least ${schema.minLength} characters` });
  }

  if (typeof schema.maxLength === 'number' && length > schema.maxLength) {
    out.push({ path, message: `must have at most ${schema.maxLength} characters` });
  }

  if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) {
    out.push({ path, message: `must match ${schema.pattern}` });
  }
};

const checkArray = (schema: Schema, value: unknown[], path: string, out: SchemaProblem[]): void => {
  if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
    out.push({ path, message: `must have at least ${schema.minItems} items` });
  }

  if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
    out.push({ path, message: `must have at most ${schema.maxItems} items` });
  }

  if (isRecord(schema.items)) {
    const items = schema.items;

    value.forEach((item, index) => check(items, item, pointer(path, index), out));
  }
};

const checkObject = (schema: Schema, value: Record<string, unknown>, path: string, out: SchemaProblem[]): void => {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const patterns = isRecord(schema.patternProperties) ? Object.entries(schema.patternProperties) : [];

  if (Array.isArray(schema.required)) {
    schema.required
      .filter((key): key is string => typeof key === 'string' && !Object.prototype.hasOwnProperty.call(value, key))
      .forEach(key => out.push({ path, message: `missing required field "${key}"` }));
  }

  Object.entries(value).forEach(([key, item]) => {
    const at = pointer(path, key);
    const declared = Object.prototype.hasOwnProperty.call(properties, key) ? properties[key] : undefined;
    const matched = patterns.filter(([pattern]) => new RegExp(pattern, 'u').test(key));

    if (isRecord(declared)) {
      check(declared, item, at, out);
    }

    matched.forEach(([, sub]) => isRecord(sub) && check(sub, item, at, out));

    if (declared !== undefined || matched.length > 0) {
      return;
    }

    if (schema.additionalProperties === false) {
      out.push({ path: at, message: `unknown field "${key}"` });
    } else if (isRecord(schema.additionalProperties)) {
      check(schema.additionalProperties, item, at, out);
    }
  });
};

const check = (schema: Schema, value: unknown, path: string, out: SchemaProblem[]): void => {
  if ('type' in schema) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];

    if (!types.some(name => matchesType(value, name))) {
      out.push({ path, message: `expected ${types.join(' or ')}, got ${typeOf(value)}` });

      return;
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.some(choice => sameJson(choice, value))) {
    out.push({ path, message: `must be one of ${JSON.stringify(schema.enum)}` });
  }

  if ('const' in schema && !sameJson(schema.const, value)) {
    out.push({ path, message: `must be ${JSON.stringify(schema.const)}` });
  }

  if (typeof value === 'number') {
    checkNumber(schema, value, path, out);
  }

  if (typeof value === 'string') {
    checkString(schema, value, path, out);
  }

  if (Array.isArray(value)) {
    checkArray(schema, value, path, out);
  }

  if (isRecord(value)) {
    checkObject(schema, value, path, out);
  }

  const branches = (key: string): Schema[] => (Array.isArray(schema[key]) ? (schema[key] as unknown[]).filter(isRecord) : []);

  if (Array.isArray(schema.oneOf)) {
    const matching = branches('oneOf').filter(branch => passes(branch, value)).length;

    if (matching !== 1) {
      out.push({ path, message: matching === 0 ? 'matches none of the allowed shapes' : 'matches more than one allowed shape' });
    }
  }

  if (Array.isArray(schema.anyOf) && !branches('anyOf').some(branch => passes(branch, value))) {
    out.push({ path, message: 'matches none of the allowed shapes' });
  }

  branches('allOf').forEach(branch => check(branch, value, path, out));

  if (isRecord(schema.if) && isRecord(schema.then) && passes(schema.if, value)) {
    check(schema.then, value, path, out);
  }
};

export const validateAgainst = (schema: Schema, value: unknown): SchemaProblem[] => {
  const out: SchemaProblem[] = [];

  check(schema, value, '', out);

  return out;
};

const SUBSCHEMA_MAPS = ['properties', 'patternProperties'];
const SUBSCHEMA_LISTS = ['oneOf', 'anyOf', 'allOf'];
const SUBSCHEMA_ONE = ['items', 'additionalProperties', 'if', 'then'];

export const unknownKeywords = (schema: unknown, path = ''): string[] => {
  if (!isRecord(schema)) {
    return [];
  }

  return Object.entries(schema).flatMap(([keyword, value]) => {
    const at = pointer(path, keyword);

    if (!SCHEMA_PROFILE_KEYWORDS.includes(keyword)) {
      return [at];
    }

    if (SUBSCHEMA_MAPS.includes(keyword) && isRecord(value)) {
      return Object.entries(value).flatMap(([name, sub]) => unknownKeywords(sub, pointer(at, name)));
    }

    if (SUBSCHEMA_LISTS.includes(keyword) && Array.isArray(value)) {
      return value.flatMap((sub, index) => unknownKeywords(sub, pointer(at, index)));
    }

    return SUBSCHEMA_ONE.includes(keyword) ? unknownKeywords(value, at) : [];
  });
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test test/unit/shared/schema/validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Validate the whole published schema's defs against real samples**

Append to the same test file. This proves the validator handles every construct the shipped schema uses:

```ts
import { blokDocumentSchema } from '../../../../src/view/document-schema';

describe('validateAgainst on the shipped schema', () => {
  const defs = (blokDocumentSchema as unknown as { $defs: Record<string, Record<string, unknown>> }).$defs;

  it('accepts a callout with a null colour and rejects a numeric one', () => {
    expect(validateAgainst(defs.callout, { emoji: '💡', textColor: null })).toEqual([]);
    expect(validateAgainst(defs.callout, { emoji: '💡', textColor: 3 })[0].path).toBe('/textColor');
  });

  it('rejects an image markup colour outside the pattern', () => {
    const markup = [{ id: 'm', type: 'pen', color: 'red', points: [0, 0, 1], size: 0.1 }];

    expect(validateAgainst(defs.image, { url: 'u', markup }).length).toBeGreaterThan(0);
  });

  it('every def uses only profile keywords', () => {
    Object.entries(defs).forEach(([name, def]) => expect(unknownKeywords(def), name).toEqual([]));
  });
});
```

Run: `yarn test test/unit/shared/schema/validate.test.ts`
Expected: PASS. If `every def uses only profile keywords` fails, the failure lists the keyword; add it to the profile only if it is a validation keyword this validator then implements, with a test.

- [ ] **Step 6: Lint and commit**

```bash
npx eslint src/shared/schema/validate.ts test/unit/shared/schema/validate.test.ts
git add src/shared/schema/validate.ts test/unit/shared/schema/validate.test.ts
git commit -m "feat(shared): schema-profile validator for tool data and action args

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 3: Published description and manifest types

**Files:**
- Create: `types/tools/tool-description.d.ts`
- Create: `types/tool-manifest.d.ts`
- Modify: `types/tools/block-tool.d.ts:216-260` (`BlockToolConstructable`), `types/tools/inline-tool.d.ts:35-90` (`InlineToolConstructable`), `types/block-tunes/block-tune.d.ts` (`BlockTuneConstructable`)
- Modify: `types/tools/index.d.ts` (re-export), `types/index.d.ts` (re-export the manifest types)
- Test: `test/unit/types/tool-description.types.test.ts`

**Gate:** 01 Task 1 (`types/agent.d.ts`) is on `main`. It owns `ToolCommandName` and `CommandName` (06 §3.1); both files are `export *`-ed from `types/index.d.ts`, so a second `ToolCommandName` here would be an ambiguous re-export (TS2308).

**Interfaces:**
- Consumes: `ToolConfig` (`types/tools/tool-config.d.ts`), `BlockPosition` (`types/api/blocks.d.ts:33`), `ToolCommandName`, `CommandName` (`types/agent.d.ts`, 01 Task 1).
- Produces (all published, hand-authored, no `src/` imports):
  - `BlokSchema`, `HostService = 'uploader' | 'linkMetadata' | 'pageBackend' | 'host'`, `ToolActionDeclaration`, `BlockToolDescription`, `InlineToolDescription`, `BlockTuneDescription` (06 §3.4 canonical).
  - `BlokToolManifest`, `BlockToolManifestEntry`, `ManifestAction`, `InlineToolManifestEntry`, `TuneManifestEntry`, `ToolRegistrySnapshot`, `SnapshotBlock`, `SnapshotBlockStatics`, `ManifestOverrides`, `CommandEntry`, `AgentGuidance`, `AgentContract`, `BlokCustomToolsFile` (spec §3.6, §3.6a, §5.1, 06 §3.6, R3-9).
  - Optional statics `describe?(config: ToolConfig)` on `BlockToolConstructable`, `InlineToolConstructable`, `BlockTuneConstructable`. `actionHandlers` is added in Task 12, because its type needs 01's `types/agent.d.ts`.
- Additions over the spec, all on types that never shipped: `SnapshotBlock.handlers: string[]` (action names with a handler in this runtime; spec §3.6 "no handler → unavailable" needs it); `SnapshotBlockStatics.convertible: { import: boolean; export: boolean }` (function-valued conversion sides count, `src/components/utils/tools.ts:20-28`); `InlineToolManifestEntry.effect` optional (spec §3.7: zero or several tags → no effect).

- [ ] **Step 1: Write the failing type test**

```ts
import { describe, expectTypeOf, it } from 'vitest';

import type {
  AgentContract,
  BlockToolConstructable,
  BlockToolDescription,
  BlokCustomToolsFile,
  BlokToolManifest,
  ToolActionDeclaration,
  ToolRegistrySnapshot,
} from '../../../types';

describe('tool description types', () => {
  it('lets a block tool declare describe()', () => {
    expectTypeOf<BlockToolConstructable['describe']>()
      .toEqualTypeOf<((config: Record<string, unknown>) => BlockToolDescription) | undefined>();
  });

  it('keeps action targets closed', () => {
    expectTypeOf<ToolActionDeclaration['target']>().toEqualTypeOf<'block' | 'create'>();
  });

  it('carries the snapshot statics inside a custom tools file', () => {
    expectTypeOf<BlokCustomToolsFile['blocks'][number]['statics']>()
      .toEqualTypeOf<ToolRegistrySnapshot['blocks'][number]['statics']>();
  });

  it('puts the manifest inside the contract', () => {
    expectTypeOf<AgentContract['manifest']>().toEqualTypeOf<BlokToolManifest>();
  });
});
```

`ToolConfig` is `ToolConfig<T extends object = Record<string, unknown>> = T` (`types/tools/tool-config.d.ts:4`), so the default parameter is exactly `Record<string, unknown>`.

- [ ] **Step 2: Run tsc to verify it fails**

Run: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` (timeout 600000)
Expected: FAIL with TS2305 `Module '"../../../types"' has no exported member 'BlockToolDescription'` (and the other names).

- [ ] **Step 3: Write `types/tools/tool-description.d.ts`**

```ts
import { ToolConfig } from './tool-config';

/** A JSON Schema object restricted to the Blok schema profile. */
export type BlokSchema = { readonly [keyword: string]: unknown };

/**
 * Something only the host can provide. An action that `requires` one is
 * unavailable without it. `'host'` marks a custom tool's `prepareInsert`,
 * whose needs Blok cannot know.
 */
export type HostService = 'uploader' | 'linkMetadata' | 'pageBackend' | 'host';

export interface ToolActionDeclaration {
  /** camelCase. The command is `${registryKey}.${name}`. */
  name: string;
  summary: string;
  guidance?: string;
  /** The action's own args. Never declares `id`, `parentId` or `position`: core adds them by `target`. */
  args: BlokSchema;
  result?: BlokSchema;
  /** `'block'` acts on an existing block (`id`); `'create'` makes a new one (`parentId?`, `position?`). */
  target: 'block' | 'create';
  /** Default `'any'`. `'editor'` runs only in the browser editor. */
  runtime?: 'any' | 'editor';
  /** `'host'`: the action changes the world outside this document. It must be alone in its batch. */
  effects?: 'host';
  /** Plain text for the model. The handler enforces them. */
  preconditions?: string[];
  /** Missing → the command is unavailable. */
  requires?: HostService[];
  /** Used when present; the action still works without it. */
  uses?: HostService[];
  /** Capability ids from the coverage ledger, e.g. `'menu:table/table-insert-row-above'`. */
  mirrors?: string[];
}

export interface BlockToolDescription {
  /** One line: what this block is for. */
  summary: string;
  /** When to use it, when not to, traps. English. */
  guidance?: string;
  /** JSON Schema (profile) of `data`. Narrowed by the config passed to `describe()`. */
  data: BlokSchema;
  /** Starting data for a new block when the agent gives none. */
  defaultData?: Record<string, unknown>;
  /** Short realistic examples of valid `data`. */
  examples?: Array<Record<string, unknown>>;
  /** Scalar fields shown in the outline view. */
  summaryFields?: string[];
  /** Entry i is the data field that DOM input i edits. Absent: one rich field maps to input 0, else block-level. */
  inputFields?: string[];
  /** Per-person fields an agent must never write. */
  viewState?: string[];
  /** Fields a plain write may not change, mapped to the command to use instead. */
  guardedFields?: Record<string, string>;
  actions?: ToolActionDeclaration[];
}

export interface InlineToolDescription {
  summary: string;
  effect:
    | { mark: string; value: BlokSchema }
    | { marks: string[]; value: BlokSchema }
    | { embed: string; value: BlokSchema }
    | { clears: 'marks' };
}

export interface BlockTuneDescription {
  summary: string;
  /** Schema of this tune's entry in a block's `tunes`, or null when it saves nothing. */
  data: BlokSchema | null;
}

/** Pure and synchronous. Config narrows the schema, never widens it. Output must survive a JSON round trip. */
export type DescribeBlockTool = (config: ToolConfig) => BlockToolDescription;
```

- [ ] **Step 4: Write `types/tool-manifest.d.ts`**

```ts
import {
  BlockToolDescription,
  BlockTuneDescription,
  BlokSchema,
  HostService,
  InlineToolDescription,
  ToolActionDeclaration,
} from './tools/tool-description';
import { CommandName, ToolCommandName } from './agent';

export interface ManifestAction extends ToolActionDeclaration {
  /** `<registryKey>.<name>`. */
  command: ToolCommandName;
  available: boolean;
}

export interface BlockToolManifestEntry {
  name: string;
  title: string;
  summary: string;
  guidance?: string;
  level: 'described' | 'structural';
  insertable: boolean;
  variants: Array<{ name: string; title: string; data: Record<string, unknown> }>;
  data: BlokSchema;
  defaultData?: Record<string, unknown>;
  examples?: Array<Record<string, unknown>>;
  richTextFields: string[];
  viewState: string[];
  guardedFields: Record<string, string>;
  children: {
    accepts: boolean;
    allow?: string[];
    deny?: string[];
    ownedByTool: boolean;
    layout: boolean;
    deletedWithParent: boolean;
  };
  selfPlacesChildren: boolean;
  restrictedInTableCell: boolean;
  summaryFields?: string[];
  inputFields?: string[];
  convertsTo: string[];
  conversion: { import?: string; export?: string };
  assetKind?: 'image' | 'video' | 'audio' | 'file';
  insertRequires?: HostService[];
  inlineTools: string[];
  tunes: string[];
  actions: ManifestAction[];
  actionsWithheld?: 'reserved-namespace';
}

export interface InlineToolManifestEntry {
  name: string;
  title: string;
  summary: string;
  level: 'described' | 'structural';
  /** Absent for a structural tool whose sanitize config does not name exactly one tag. */
  effect?: InlineToolDescription['effect'];
  shortcut?: string;
}

export interface TuneManifestEntry {
  name: string;
  summary: string;
  level: 'described' | 'structural';
  data: BlokSchema | null;
}

export interface BlokToolManifest {
  formatVersion: 1;
  blokVersion: string;
  revision: string;
  readOnly: boolean;
  defaultBlock: string;
  blocks: BlockToolManifestEntry[];
  inlineTools: InlineToolManifestEntry[];
  tunes: TuneManifestEntry[];
}

export interface SnapshotBlockStatics {
  toolbox: Array<{ name: string; title: string; data?: Record<string, unknown>; previewCaption?: string }>;
  richTextFields: string[];
  acceptsChildren: boolean;
  childTools?: { allow?: string[]; deny?: string[] };
  ownsChildren: boolean;
  isLayout: boolean;
  deletesChildren: boolean;
  selfPlacesChildren: boolean;
  restrictedInTableCell: boolean;
  /** String sides only. */
  conversion: { import?: string; export?: string };
  /** A side counts when it is a string or a function. */
  convertible: { import: boolean; export: boolean };
  assetKind?: string;
  hasPrepareInsert: boolean;
}

export interface SnapshotBlock {
  name: string;
  title: string;
  description: BlockToolDescription | null;
  statics: SnapshotBlockStatics;
  insertable: boolean;
  inlineTools: string[];
  tunes: string[];
  /** Action names that have a handler in this runtime. */
  handlers: string[];
}

export interface ToolRegistrySnapshot {
  blokVersion: string;
  readOnly: boolean;
  defaultBlock: string;
  services: HostService[];
  blocks: SnapshotBlock[];
  inlineTools: Array<{ name: string; title: string; description: InlineToolDescription | null; sanitizeTags: string[]; shortcut?: string }>;
  tunes: Array<{ name: string; description: BlockTuneDescription | null }>;
}

export type ManifestOverrides = Record<string, { hidden?: boolean; hiddenActions?: string[]; guidance?: string }>;

export interface CommandEntry {
  name: CommandName;
  summary: string;
  guidance?: string;
  args: BlokSchema;
  result?: BlokSchema;
  readOnly: boolean;
  runtime: 'any' | 'editor';
  source: 'core' | { tool: string; target: 'block' | 'create' };
  requires?: HostService[];
  effects?: 'host';
  available: boolean;
  unavailableReason?: 'runtime' | 'service';
}

export interface AgentGuidance {
  general: string;
  commands: Record<string, string>;
  tools: Record<string, string>;
}

export interface AgentContract {
  formatVersion: 1;
  revision: string;
  commands: CommandEntry[];
  manifest: BlokToolManifest;
  guidance: AgentGuidance;
}

export interface BlokCustomToolsFile {
  formatVersion: 1;
  blocks: Array<{
    name: string;
    description: BlockToolDescription;
    statics: SnapshotBlockStatics;
    /** The tool's own sanitize rules as JSON: object and boolean rules only. Absent: rich fields get the global inline rules. */
    sanitize?: Record<string, unknown>;
  }>;
}
```

- [ ] **Step 5: Add the `describe` statics**

In `types/tools/block-tool.d.ts`, inside `BlockToolConstructable`, before `new(config…)` (line 260), add:

```ts
  /**
   * Machine-readable self-description for agents: the data schema, actions,
   * structure facts and guidance. Pure and synchronous; config narrows, never
   * widens. A tool without it still appears in the manifest as `structural`.
   */
  describe?(config: ToolConfig): BlockToolDescription;
```

and `import { BlockToolDescription } from './tool-description';` at the top. Do the same in `types/tools/inline-tool.d.ts` (`describe?(config: ToolConfig): InlineToolDescription;`) and `types/block-tunes/block-tune.d.ts` (`describe?(config: ToolConfig): BlockTuneDescription;`, importing from `'../tools/tool-description'`).

In `types/tools/index.d.ts` add `export * from './tool-description';`. In `types/index.d.ts`, after line 138 (`export * from './rich-text';`), add `export * from './tool-manifest';` and add `BlockToolDescription, InlineToolDescription, BlockTuneDescription, ToolActionDeclaration, BlokSchema, HostService` to the `export { … } from './tools';` list at lines 63-89.

- [ ] **Step 6: Run tsc and the law**

Run: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` (timeout 600000)
Expected: PASS.
Run: `yarn test test/unit/architecture/published-types-no-src-refs.test.ts`
Expected: PASS.

- [ ] **Step 7: Check adapter statics still compile**

The adapters' `statics` bag is `Omit<BlockToolConstructable, 'toolbox' | 'isReadOnlySupported'>` (React `packages/react/src/createReactBlock.tsx:51`, Vue `:57`, Angular `:38`). Adding an optional member is additive. The tsc run above covers React and Vue. Run: `yarn lint:angular`. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
npx eslint test/unit/types/tool-description.types.test.ts
git add types/tools/tool-description.d.ts types/tool-manifest.d.ts types/tools/block-tool.d.ts types/tools/inline-tool.d.ts types/block-tunes/block-tune.d.ts types/tools/index.d.ts types/index.d.ts test/unit/types/tool-description.types.test.ts
git commit -m "feat(types): tool description, manifest and contract types

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4: Move the rich-text schema helpers to `src/shared/tool-descriptions/rich-text.ts`

**Files:**
- Create: `src/shared/tool-descriptions/rich-text.ts`
- Modify: `src/view/document-schema.ts:18-81` (delete the three constants, import them)
- Test: `test/unit/shared/tool-descriptions/rich-text.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ALIGNMENT`, `RICH_TEXT_MARKS`, `richText(description: string): Record<string, unknown>`. Every description module (Tasks 16-22) and the manifest builder's structural schema (Task 5) call `richText`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { ALIGNMENT, RICH_TEXT_MARKS, richText } from '../../../../src/shared/tool-descriptions/rich-text';
import { validateAgainst } from '../../../../src/shared/schema/validate';

describe('richText', () => {
  it('accepts segments and inline HTML, and nothing else', () => {
    const schema = richText('Body.');

    expect(schema.description).toBe('Body.');
    expect(validateAgainst(schema, [{ text: 'a', marks: { bold: true } }, { embed: { page: { id: 'p' } } }])).toEqual([]);
    expect(validateAgainst(schema, '<b>a</b>')).toEqual([]);
    expect(validateAgainst(schema, [{ text: 'a', marks: { blink: 'x' } }])).toEqual([]);
    expect(validateAgainst(schema, [{ markdown: '**a**' }]).length).toBeGreaterThan(0);
  });

  it('keeps the shared constants', () => {
    expect(ALIGNMENT).toEqual(['left', 'center', 'right']);
    expect(Object.keys(RICH_TEXT_MARKS.properties)).toContain('link');
  });
});
```

The `blink` case passes because `RICH_TEXT_MARKS` has no `additionalProperties: false` (`document-schema.ts:22-44`). That matches today's published schema; the description says unknown keys are dropped on load.

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test test/unit/shared/tool-descriptions/rich-text.test.ts`
Expected: FAIL, unresolved import.

- [ ] **Step 3: Move the code**

Create `src/shared/tool-descriptions/rich-text.ts` with a one-line header comment (`/** Rich-text schema pieces shared by every tool description and by blokDocumentSchema. */`) and lines 18-81 of `src/view/document-schema.ts` moved verbatim, with `export` added to `ALIGNMENT`, `RICH_TEXT_MARKS` and `richText`. In `document-schema.ts`, delete lines 18-81 and add at the top, after the header comment:

```ts
import { ALIGNMENT, richText } from '../shared/tool-descriptions/rich-text';
```

Rewrite the PURITY CONTRACT lines (`document-schema.ts:5-6`) to:

```ts
 * PURITY CONTRACT (see the banner in ./blocks-to-html.ts): this module imports
 * only the pure description modules under src/shared/tool-descriptions/.
```

- [ ] **Step 4: Run both tests**

Run: `yarn test test/unit/shared/tool-descriptions/rich-text.test.ts` → PASS.
Run: `yarn test test/unit/view/document-schema.test.ts` → PASS (the byte pin from Task 1 holds).
Run: `yarn test test/unit/view/index.purity.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/shared/tool-descriptions/rich-text.ts src/view/document-schema.ts test/unit/shared/tool-descriptions/rich-text.test.ts
git add src/shared/tool-descriptions/rich-text.ts src/view/document-schema.ts test/unit/shared/tool-descriptions/rich-text.test.ts
git commit -m "refactor(view): move rich-text schema helpers to src/shared/tool-descriptions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 5: `buildToolManifest`

**Files:**
- Create: `src/shared/tool-manifest.ts`
- Test: `test/unit/shared/tool-manifest.test.ts`

**Interfaces:**
- Consumes: `richText` (Task 4), `deepEqual` (`src/shared/deep-equal.ts:13`), `ownEntry` (`src/shared/own-entry.ts:7`), the types from Task 3.
- Produces:
  - `RESERVED_NAMESPACES: readonly ['doc', 'block', 'text', 'markdown', 'history']`.
  - `canonicalHash(value: unknown): string`. FNV-1a 32-bit over JSON with sorted keys, as 8 hex chars. Pure.
  - `interface ManifestBuildOptions { onWarning?(message: string): void }`.
  - `buildToolManifest(snapshot: ToolRegistrySnapshot, overrides?: ManifestOverrides, options?: ManifestBuildOptions): BlokToolManifest`.
  - `structuralDataSchema(richTextFields: string[]): BlokSchema`.

Rules encoded (spec §3.6 table, §3.7, §3.9):
- `summary`: `description.summary`, else the first toolbox entry's `previewCaption`, else `Custom block <name>`.
- `guidance`: description guidance, then the override's, joined by a blank line.
- A `describe` result that is not a plain object with a string `summary` and an object `data`, or that does not survive a JSON round trip, degrades to `structural` with a warning.
- `actions[].available`: false in read-only, when the runtime has no handler, or when a `requires` service is missing from `snapshot.services`. `buildAgentContract` (Task 6) applies the runner rules on top.
- A registry key in `RESERVED_NAMESPACES` gets `actions: []` and `actionsWithheld: 'reserved-namespace'`.
- `convertsTo`: when this tool can export, every other tool that can import and has a toolbox entry. This is `getConvertibleToolsForBlock` (`src/components/utils/blocks.ts:51-80`) without its per-block variant filter.
- `insertRequires`: `hasPrepareInsert` → `['pageBackend']` for a described `page`, else `['host']`.
- `revision`: `canonicalHash` of the manifest body plus `snapshot.services` and the overrides.

- [ ] **Step 1: Write the failing tests**

```ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { buildToolManifest, canonicalHash, structuralDataSchema } from '../../../src/shared/tool-manifest';

import type { BlockToolDescription, SnapshotBlock, ToolRegistrySnapshot } from '../../../types';

const statics = (over: Partial<SnapshotBlock['statics']> = {}): SnapshotBlock['statics'] => ({
  toolbox: [{ name: 'x', title: 'X' }],
  richTextFields: [],
  acceptsChildren: true,
  ownsChildren: false,
  isLayout: false,
  deletesChildren: false,
  selfPlacesChildren: false,
  restrictedInTableCell: false,
  conversion: {},
  convertible: { import: false, export: false },
  hasPrepareInsert: false,
  ...over,
});

const block = (name: string, over: Partial<SnapshotBlock> = {}): SnapshotBlock => ({
  name,
  title: name,
  description: null,
  statics: statics(),
  insertable: true,
  inlineTools: [],
  tunes: [],
  handlers: [],
  ...over,
});

const snapshot = (blocks: SnapshotBlock[], over: Partial<ToolRegistrySnapshot> = {}): ToolRegistrySnapshot => ({
  blokVersion: '1.17.0',
  readOnly: false,
  defaultBlock: 'paragraph',
  services: [],
  blocks,
  inlineTools: [],
  tunes: [],
  ...over,
});

const tableDescription: BlockToolDescription = {
  summary: 'A grid.',
  data: { type: 'object' },
  actions: [
    { name: 'insertRows', summary: 'Insert rows.', target: 'block', args: { type: 'object', properties: {} } },
    { name: 'linkCard', summary: 'Needs metadata.', target: 'create', args: { type: 'object' }, requires: ['linkMetadata'] },
  ],
};

describe('buildToolManifest', () => {
  it('describes an undeclared tool structurally, with typed rich-text fields and open data', () => {
    const manifest = buildToolManifest(snapshot([block('quiz', { statics: statics({ richTextFields: ['question'] }) })]));
    const [entry] = manifest.blocks;

    expect(entry.level).toBe('structural');
    expect(entry.summary).toBe('Custom block quiz');
    expect(entry.data).toEqual(structuralDataSchema(['question']));
    expect((entry.data as { additionalProperties: unknown }).additionalProperties).toBe(true);
  });

  it('degrades an unrelated static describe to structural and warns', () => {
    const onWarning = vi.fn();
    const odd = { summary: 'x', data: { type: 'object', f: (): void => undefined } } as unknown as BlockToolDescription;
    const manifest = buildToolManifest(snapshot([
      block('a', { description: 'not a description' as unknown as BlockToolDescription }),
      block('b', { description: odd }),
    ]), {}, { onWarning });

    expect(manifest.blocks.map(entry => entry.level)).toEqual(['structural', 'structural']);
    expect(onWarning).toHaveBeenCalledTimes(2);
  });

  it('prefixes commands with the registry key, so a renamed table is grid.*', () => {
    const manifest = buildToolManifest(snapshot([block('grid', { description: tableDescription, handlers: ['insertRows', 'linkCard'] })]));

    expect(manifest.blocks[0].actions.map(action => action.command)).toEqual(['grid.insertRows', 'grid.linkCard']);
    expect(manifest.blocks[0].selfPlacesChildren).toBe(false);
  });

  it('marks an action unavailable when a required service, a handler or write access is missing', () => {
    const base = block('t', { description: tableDescription, handlers: ['insertRows', 'linkCard'] });

    expect(buildToolManifest(snapshot([base])).blocks[0].actions.map(a => a.available)).toEqual([true, false]);
    expect(buildToolManifest(snapshot([base], { services: ['linkMetadata'] })).blocks[0].actions.map(a => a.available)).toEqual([true, true]);
    expect(buildToolManifest(snapshot([{ ...base, handlers: [] }])).blocks[0].actions.map(a => a.available)).toEqual([false, false]);
    expect(buildToolManifest(snapshot([base], { readOnly: true })).blocks[0].actions.map(a => a.available)).toEqual([false, false]);
  });

  it('withholds actions under a reserved registry key', () => {
    const [entry] = buildToolManifest(snapshot([block('block', { description: tableDescription, handlers: ['insertRows'] })])).blocks;

    expect(entry.actions).toEqual([]);
    expect(entry.actionsWithheld).toBe('reserved-namespace');
  });

  it('applies overrides: hidden tool, hidden action, extra guidance', () => {
    const manifest = buildToolManifest(
      snapshot([block('t', { description: { ...tableDescription, guidance: 'Own.' }, handlers: ['insertRows'] }), block('h')]),
      { h: { hidden: true }, t: { hiddenActions: ['linkCard'], guidance: 'Host.' } }
    );

    expect(manifest.blocks.map(entry => entry.name)).toEqual(['t']);
    expect(manifest.blocks[0].actions.map(action => action.name)).toEqual(['insertRows']);
    expect(manifest.blocks[0].guidance).toBe('Own.\n\nHost.');
  });

  it('keeps only string conversion sides and computes convertsTo like the convert menu', () => {
    const manifest = buildToolManifest(snapshot([
      block('p', { statics: statics({ conversion: { export: 'text', import: 'text' }, convertible: { import: true, export: true } }) }),
      block('h', { statics: statics({ conversion: {}, convertible: { import: true, export: false } }) }),
      block('hidden', { statics: statics({ toolbox: [], convertible: { import: true, export: true } }) }),
    ]));

    expect(manifest.blocks[0].conversion).toEqual({ export: 'text', import: 'text' });
    expect(manifest.blocks[0].convertsTo).toEqual(['h']);
    expect(manifest.blocks[1].convertsTo).toEqual([]);
  });

  it('reads insertable, variants and insertRequires', () => {
    const page = block('page', {
      insertable: false,
      description: { summary: 'Page.', data: { type: 'object' } },
      statics: statics({ hasPrepareInsert: true, toolbox: [{ name: 'page', title: 'Page', data: { pageId: '' } }] }),
    });
    const custom = block('c', { statics: statics({ hasPrepareInsert: true }) });
    const [pageEntry, customEntry] = buildToolManifest(snapshot([page, custom])).blocks;

    expect(pageEntry.insertable).toBe(false);
    expect(pageEntry.variants).toEqual([{ name: 'page', title: 'Page', data: { pageId: '' } }]);
    expect(pageEntry.insertRequires).toEqual(['pageBackend']);
    expect(customEntry.insertRequires).toEqual(['host']);
  });

  it('changes revision when config-dependent output or services change, and only then', () => {
    const one = buildToolManifest(snapshot([block('a')]));

    expect(buildToolManifest(snapshot([block('a')])).revision).toBe(one.revision);
    expect(buildToolManifest(snapshot([block('a', { insertable: false })])).revision).not.toBe(one.revision);
    expect(buildToolManifest(snapshot([block('a')], { services: ['uploader'] })).revision).not.toBe(one.revision);
  });

  it('describes undeclared inline tools by their single sanitize tag, and leaves multi-tag ones without effect', () => {
    const manifest = buildToolManifest(snapshot([], {
      inlineTools: [
        { name: 'kbd', title: 'Kbd', description: null, sanitizeTags: ['kbd'] },
        { name: 'multi', title: 'M', description: null, sanitizeTags: ['b', 'i'] },
      ],
      tunes: [{ name: 'indent', description: null }],
    }));

    expect(manifest.inlineTools[0].effect).toEqual({ mark: 'tag:kbd', value: { type: 'object', additionalProperties: { type: 'string' } } });
    expect(manifest.inlineTools[1].effect).toBeUndefined();
    expect(manifest.tunes[0]).toEqual({ name: 'indent', summary: 'Custom tune indent', level: 'structural', data: { type: 'object', additionalProperties: true } });
  });
});

describe('canonicalHash', () => {
  it('ignores key order and is 8 hex chars', () => {
    expect(canonicalHash({ a: 1, b: [2] })).toBe(canonicalHash({ b: [2], a: 1 }));
    expect(canonicalHash({ a: 1 })).toMatch(/^[0-9a-f]{8}$/);
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test test/unit/shared/tool-manifest.test.ts`
Expected: FAIL, unresolved import `src/shared/tool-manifest`.

- [ ] **Step 3: Implement**

```ts
/**
 * The capability manifest: a pure function of a registry snapshot.
 * The browser, Node and the Jint bundle each feed it their own snapshot.
 */
import type {
  BlockToolDescription,
  BlockToolManifestEntry,
  BlokSchema,
  BlokToolManifest,
  InlineToolManifestEntry,
  ManifestAction,
  ManifestOverrides,
  SnapshotBlock,
  ToolCommandName,
  ToolRegistrySnapshot,
  TuneManifestEntry,
} from '../../types';
import { deepEqual } from './deep-equal';
import { ownEntry } from './own-entry';
import { richText } from './tool-descriptions/rich-text';

export const RESERVED_NAMESPACES = ['doc', 'block', 'text', 'markdown', 'history'] as const;

export interface ManifestBuildOptions {
  onWarning?(message: string): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }

  if (isRecord(value)) {
    return `{${Object.keys(value).sort().filter(key => value[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
};

export const canonicalHash = (value: unknown): string => {
  const text = canonicalJson(value);
  // FNV-1a, 32 bit: cheap, stable across engines (Jint has no crypto).
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
};

export const structuralDataSchema = (richTextFields: string[]): BlokSchema => ({
  type: 'object',
  additionalProperties: true,
  properties: Object.fromEntries(richTextFields.map(field => [field, richText(`Rich-text field "${field}".`)])),
});

const acceptDescription = (
  name: string,
  candidate: unknown,
  warn: (message: string) => void
): BlockToolDescription | null => {
  if (candidate === null || candidate === undefined) {
    return null;
  }

  const shaped = isRecord(candidate) && typeof candidate.summary === 'string' && isRecord(candidate.data);

  if (!shaped || !deepEqual(JSON.parse(JSON.stringify(candidate)), candidate)) {
    warn(`Tool "${name}": describe() did not return a JSON tool description; it is listed as structural.`);

    return null;
  }

  return candidate as unknown as BlockToolDescription;
};

const isReserved = (name: string): boolean => (RESERVED_NAMESPACES as readonly string[]).includes(name);

const actionsFor = (
  block: SnapshotBlock,
  description: BlockToolDescription | null,
  hiddenActions: ReadonlySet<string>,
  snapshot: ToolRegistrySnapshot
): ManifestAction[] => (description?.actions ?? [])
  .filter(action => !hiddenActions.has(action.name))
  .map(action => ({
    ...action,
    command: `${block.name}.${action.name}` as ToolCommandName,
    available: !snapshot.readOnly
      && block.handlers.includes(action.name)
      && (action.requires ?? []).every(service => snapshot.services.includes(service)),
  }));

const blockEntry = (
  block: SnapshotBlock,
  snapshot: ToolRegistrySnapshot,
  overrides: ManifestOverrides,
  warn: (message: string) => void
): BlockToolManifestEntry => {
  const description = acceptDescription(block.name, block.description, warn);
  const override = ownEntry(overrides, block.name);
  const { statics } = block;
  const guidance = [description?.guidance, override?.guidance].filter((text): text is string => typeof text === 'string' && text !== '');
  const reserved = isReserved(block.name);

  return {
    name: block.name,
    title: block.title,
    summary: description?.summary ?? statics.toolbox[0]?.previewCaption ?? `Custom block ${block.name}`,
    ...(guidance.length > 0 ? { guidance: guidance.join('\n\n') } : {}),
    level: description === null ? 'structural' : 'described',
    insertable: block.insertable,
    variants: statics.toolbox.map(entry => ({ name: entry.name, title: entry.title, data: entry.data ?? {} })),
    data: description?.data ?? structuralDataSchema(statics.richTextFields),
    ...(description?.defaultData === undefined ? {} : { defaultData: description.defaultData }),
    ...(description?.examples === undefined ? {} : { examples: description.examples }),
    richTextFields: statics.richTextFields,
    viewState: description?.viewState ?? [],
    guardedFields: description?.guardedFields ?? {},
    children: {
      accepts: statics.acceptsChildren,
      ...(statics.childTools?.allow === undefined ? {} : { allow: statics.childTools.allow }),
      ...(statics.childTools?.deny === undefined ? {} : { deny: statics.childTools.deny }),
      ownedByTool: statics.ownsChildren,
      layout: statics.isLayout,
      deletedWithParent: statics.deletesChildren,
    },
    selfPlacesChildren: statics.selfPlacesChildren,
    restrictedInTableCell: statics.restrictedInTableCell,
    ...(description?.summaryFields === undefined ? {} : { summaryFields: description.summaryFields }),
    ...(description?.inputFields === undefined ? {} : { inputFields: description.inputFields }),
    convertsTo: statics.convertible.export
      ? snapshot.blocks
        .filter(other => other.name !== block.name && other.statics.convertible.import && other.statics.toolbox.length > 0)
        .map(other => other.name)
      : [],
    conversion: statics.conversion,
    ...(statics.assetKind === undefined ? {} : { assetKind: statics.assetKind as BlockToolManifestEntry['assetKind'] }),
    ...(statics.hasPrepareInsert
      ? { insertRequires: [block.name === 'page' && description !== null ? 'pageBackend' : 'host'] as BlockToolManifestEntry['insertRequires'] }
      : {}),
    inlineTools: block.inlineTools,
    tunes: block.tunes,
    actions: reserved ? [] : actionsFor(block, description, new Set(override?.hiddenActions ?? []), snapshot),
    ...(reserved ? { actionsWithheld: 'reserved-namespace' as const } : {}),
  };
};

const inlineEntry = (tool: ToolRegistrySnapshot['inlineTools'][number]): InlineToolManifestEntry => {
  const base = { name: tool.name, title: tool.title, ...(tool.shortcut === undefined ? {} : { shortcut: tool.shortcut }) };

  if (tool.description !== null) {
    return { ...base, summary: tool.description.summary, level: 'described', effect: tool.description.effect };
  }

  const [tag] = tool.sanitizeTags;

  return tool.sanitizeTags.length === 1
    ? { ...base, summary: `Custom inline tool ${tool.name}.`, level: 'structural', effect: { mark: `tag:${tag}`, value: { type: 'object', additionalProperties: { type: 'string' } } } }
    : { ...base, summary: `Custom inline tool ${tool.name}. Leave its marks as they are.`, level: 'structural' };
};

const tuneEntry = (tune: ToolRegistrySnapshot['tunes'][number]): TuneManifestEntry => (tune.description === null
  ? { name: tune.name, summary: `Custom tune ${tune.name}`, level: 'structural', data: { type: 'object', additionalProperties: true } }
  : { name: tune.name, summary: tune.description.summary, level: 'described', data: tune.description.data });

export const buildToolManifest = (
  snapshot: ToolRegistrySnapshot,
  overrides: ManifestOverrides = {},
  options: ManifestBuildOptions = {}
): BlokToolManifest => {
  const warn = options.onWarning ?? ((): void => undefined);
  const visible = (name: string): boolean => ownEntry(overrides, name)?.hidden !== true;
  const blocks = snapshot.blocks.filter(block => visible(block.name)).map(block => blockEntry(block, snapshot, overrides, warn));
  const inlineTools = snapshot.inlineTools.filter(tool => visible(tool.name)).map(inlineEntry);
  const tunes = snapshot.tunes.filter(tune => visible(tune.name)).map(tuneEntry);
  const body = { blokVersion: snapshot.blokVersion, readOnly: snapshot.readOnly, defaultBlock: snapshot.defaultBlock, blocks, inlineTools, tunes };

  return {
    formatVersion: 1,
    ...body,
    revision: canonicalHash({ body, services: snapshot.services, overrides }),
  };
};
```

`ownEntry` returns `T | undefined` for own keys only (`src/shared/own-entry.ts:7`), so an override named `__proto__` or `toString` cannot leak.

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test test/unit/shared/tool-manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/shared/tool-manifest.ts test/unit/shared/tool-manifest.test.ts
git add src/shared/tool-manifest.ts test/unit/shared/tool-manifest.test.ts
git commit -m "feat(shared): buildToolManifest from a registry snapshot

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 6: `buildAgentContract`

**Files:**
- Modify: `src/shared/tool-manifest.ts` (append)
- Test: `test/unit/shared/tool-manifest.contract.test.ts`

**Interfaces:**
- Consumes: `buildToolManifest`, `canonicalHash` (Task 5).
- Produces:
  - `type CoreCommandTable = Readonly<Record<string, { argsSchema: BlokSchema; resultSchema?: BlokSchema; readOnly: boolean; runtime: 'any' | 'editor'; summary: string; guidance?: string }>>`. This is the structural shape of 01's `COMMANDS` (01 line 792). It never imports 01.
  - `interface ContractWhere { runtime: 'editor' | 'node' | 'jint' | 'node-live' | 'csharp-live'; services: HostService[] }`.
  - `buildAgentContract(manifest: BlokToolManifest, core: CoreCommandTable, where: ContractWhere, general?: string): AgentContract`. `general` is 01's/03's anti-Markdown text (spec §3.6a); default `''`.
  - `BLOCK_POSITION_SCHEMA: BlokSchema` (the `BlockChildPosition` union, `types/api/block.d.ts:9`).

Rules (06 R3-1, spec §3.6a):
- Core command: `available: false, unavailableReason: 'runtime'` when `runtime: 'editor'` and the runner is not `'editor'`, or when it is `history.undo` / `history.redo` and the runner is `jint`, `node-live` or `csharp-live`.
- Tool action: unavailable with `'runtime'` when `runtime: 'editor'` and headless; with `'service'` when a `requires` service is missing from `where.services`; with `'runtime'` when the manifest already marked it unavailable for a missing handler; with no reason when the manifest is read-only.
- `args`: `target: 'block'` adds required `id: string`; `target: 'create'` adds optional `parentId: string | null` and `position`.
- `commands` sorted by name. `guidance.tools[<key>]` = entry guidance; `guidance.commands[<command>]` = action guidance then `- <precondition>` lines.
- `revision` = `canonicalHash({ manifest: manifest.revision, core: Object.keys(core).sort(), where })`.
- The returned `manifest` is a copy whose `actions[].available` equals the contract's.

- [ ] **Step 1: Write the failing tests**

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildAgentContract, buildToolManifest } from '../../../src/shared/tool-manifest';
import type { CoreCommandTable } from '../../../src/shared/tool-manifest';

import type { BlockToolDescription, SnapshotBlock, ToolRegistrySnapshot } from '../../../types';

const core: CoreCommandTable = {
  'block.insert': { argsSchema: { type: 'object' }, readOnly: false, runtime: 'any', summary: 'Insert.' },
  'history.undo': { argsSchema: { type: 'object' }, readOnly: false, runtime: 'any', summary: 'Undo.' },
  'doc.read': { argsSchema: { type: 'object' }, readOnly: true, runtime: 'any', summary: 'Read.' },
};

const description: BlockToolDescription = {
  summary: 'T.',
  guidance: 'Use actions.',
  data: { type: 'object' },
  actions: [
    { name: 'insertRows', summary: 'Rows.', target: 'block', args: { type: 'object', required: ['at'], properties: { at: { type: 'integer' } } }, preconditions: ['Keeps one row.'] },
    { name: 'create', summary: 'New.', target: 'create', args: { type: 'object', properties: { rows: { type: 'integer' } } } },
    { name: 'card', summary: 'Card.', target: 'create', args: { type: 'object' }, requires: ['linkMetadata'] },
    { name: 'local', summary: 'Local.', target: 'block', args: { type: 'object' }, runtime: 'editor' },
  ],
};

const snapshot = (over: Partial<ToolRegistrySnapshot> = {}): ToolRegistrySnapshot => ({
  blokVersion: '1', readOnly: false, defaultBlock: 'paragraph', services: ['linkMetadata'],
  blocks: [{
    name: 'table', title: 'Table', description,
    statics: {
      toolbox: [], richTextFields: [], acceptsChildren: true, ownsChildren: false, isLayout: false, deletesChildren: false,
      selfPlacesChildren: true, restrictedInTableCell: true, conversion: {}, convertible: { import: false, export: false }, hasPrepareInsert: false,
    },
    insertable: true, inlineTools: [], tunes: [], handlers: ['insertRows', 'create', 'card', 'local'],
  } satisfies SnapshotBlock],
  inlineTools: [], tunes: [],
  ...over,
});

const byName = (contract: ReturnType<typeof buildAgentContract>, name: string): ReturnType<typeof buildAgentContract>['commands'][number] | undefined =>
  contract.commands.find(command => command.name === name);

describe('buildAgentContract', () => {
  it('merges core and tool commands, sorted by name', () => {
    const contract = buildAgentContract(buildToolManifest(snapshot()), core, { runtime: 'editor', services: ['linkMetadata'] });

    expect(contract.commands.map(command => command.name)).toEqual([
      'block.insert', 'doc.read', 'history.undo', 'table.card', 'table.create', 'table.insertRows', 'table.local',
    ]);
    expect(byName(contract, 'table.insertRows')?.source).toEqual({ tool: 'table', target: 'block' });
  });

  it('adds id to block actions and parentId/position to create actions', () => {
    const contract = buildAgentContract(buildToolManifest(snapshot()), core, { runtime: 'editor', services: [] });
    const rows = byName(contract, 'table.insertRows')?.args as { required: string[]; properties: Record<string, unknown> };
    const create = byName(contract, 'table.create')?.args as { required?: string[]; properties: Record<string, unknown> };

    expect(rows.required).toEqual(['id', 'at']);
    expect(Object.keys(rows.properties)).toEqual(['id', 'at']);
    expect(Object.keys(create.properties)).toEqual(['parentId', 'position', 'rows']);
    expect(create.required ?? []).not.toContain('parentId');
  });

  it('decides availability once per runner', () => {
    const manifest = buildToolManifest(snapshot());
    const jint = buildAgentContract(manifest, core, { runtime: 'jint', services: [] });

    expect(byName(jint, 'history.undo')).toMatchObject({ available: false, unavailableReason: 'runtime' });
    expect(byName(jint, 'table.local')).toMatchObject({ available: false, unavailableReason: 'runtime' });
    expect(byName(jint, 'table.card')).toMatchObject({ available: false, unavailableReason: 'service' });
    expect(byName(jint, 'table.insertRows')?.available).toBe(true);
    expect(byName(buildAgentContract(manifest, core, { runtime: 'node', services: [] }), 'history.undo')?.available).toBe(true);
    expect(byName(buildAgentContract(manifest, core, { runtime: 'node-live', services: [] }), 'history.undo')?.available).toBe(false);
  });

  it('copies availability into the returned manifest', () => {
    const contract = buildAgentContract(buildToolManifest(snapshot()), core, { runtime: 'jint', services: [] });
    const card = contract.manifest.blocks[0].actions.find(action => action.name === 'card');

    expect(card?.available).toBe(false);
  });

  it('fills guidance from descriptions, overrides and preconditions', () => {
    const contract = buildAgentContract(
      buildToolManifest(snapshot(), { table: { guidance: 'Host rule.' } }),
      core,
      { runtime: 'editor', services: [] },
      'Rich fields take segments, never Markdown.'
    );

    expect(contract.guidance.general).toBe('Rich fields take segments, never Markdown.');
    expect(contract.guidance.tools.table).toBe('Use actions.\n\nHost rule.');
    expect(contract.guidance.commands['table.insertRows']).toBe('- Keeps one row.');
  });

  it('changes revision with the runner', () => {
    const manifest = buildToolManifest(snapshot());

    expect(buildAgentContract(manifest, core, { runtime: 'node', services: [] }).revision)
      .not.toBe(buildAgentContract(manifest, core, { runtime: 'jint', services: [] }).revision);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test test/unit/shared/tool-manifest.contract.test.ts`
Expected: FAIL, `buildAgentContract` is not exported.

- [ ] **Step 3: Implement (append to `src/shared/tool-manifest.ts`)**

```ts
import type { AgentContract, CommandEntry, HostService, ManifestAction } from '../../types';

export type CoreCommandTable = Readonly<Record<string, {
  argsSchema: BlokSchema;
  resultSchema?: BlokSchema;
  readOnly: boolean;
  runtime: 'any' | 'editor';
  summary: string;
  guidance?: string;
}>>;

export interface ContractWhere {
  runtime: 'editor' | 'node' | 'jint' | 'node-live' | 'csharp-live';
  services: HostService[];
}

export const BLOCK_POSITION_SCHEMA: BlokSchema = {
  description: 'Where the new block goes among its siblings. Default: the end.',
  oneOf: [
    { enum: ['start', 'end'] },
    { type: 'object', required: ['before'], additionalProperties: false, properties: { before: { type: 'string' } } },
    { type: 'object', required: ['after'], additionalProperties: false, properties: { after: { type: 'string' } } },
  ],
};

// Undo needs a session-local history: none exists per Jint call or in a live room (06 C11, D6).
const UNDO_COMMANDS = new Set(['history.undo', 'history.redo']);
const UNDO_RUNNERS = new Set<ContractWhere['runtime']>(['editor', 'node']);

const withTarget = (action: ManifestAction): BlokSchema => {
  const args = action.args as { properties?: Record<string, unknown>; required?: string[] };
  const own = args.properties ?? {};

  if (action.target === 'block') {
    return {
      ...args,
      properties: { id: { type: 'string', description: 'Id of the block to act on.' }, ...own },
      required: ['id', ...(args.required ?? [])],
    };
  }

  return {
    ...args,
    properties: {
      parentId: { type: ['string', 'null'], description: 'Parent block id. Omit or null for the document root.' },
      position: BLOCK_POSITION_SCHEMA,
      ...own,
    },
  };
};

const toolAvailability = (
  action: ManifestAction,
  readOnly: boolean,
  where: ContractWhere
): Pick<CommandEntry, 'available' | 'unavailableReason'> => {
  if (action.runtime === 'editor' && where.runtime !== 'editor') {
    return { available: false, unavailableReason: 'runtime' };
  }

  if ((action.requires ?? []).some(service => !where.services.includes(service))) {
    return { available: false, unavailableReason: 'service' };
  }

  if (readOnly) {
    return { available: false };
  }

  // The manifest already folded in handler presence: none here means none in this runtime.
  return action.available ? { available: true } : { available: false, unavailableReason: 'runtime' };
};

export const buildAgentContract = (
  manifest: BlokToolManifest,
  core: CoreCommandTable,
  where: ContractWhere,
  general = ''
): AgentContract => {
  const coreCommands: CommandEntry[] = Object.entries(core).map(([name, command]) => {
    const blocked = (command.runtime === 'editor' && where.runtime !== 'editor')
      || (UNDO_COMMANDS.has(name) && !UNDO_RUNNERS.has(where.runtime));

    return {
      name: name as ToolCommandName,
      summary: command.summary,
      ...(command.guidance === undefined ? {} : { guidance: command.guidance }),
      args: command.argsSchema,
      ...(command.resultSchema === undefined ? {} : { result: command.resultSchema }),
      readOnly: command.readOnly,
      runtime: command.runtime,
      source: 'core',
      available: !blocked,
      ...(blocked ? { unavailableReason: 'runtime' as const } : {}),
    };
  });

  const blocks = manifest.blocks.map(block => ({
    ...block,
    actions: block.actions.map(action => ({ ...action, available: toolAvailability(action, manifest.readOnly, where).available })),
  }));

  const toolCommands: CommandEntry[] = manifest.blocks.flatMap(block => block.actions.map(action => ({
    name: action.command,
    summary: action.summary,
    ...(action.guidance === undefined ? {} : { guidance: action.guidance }),
    args: withTarget(action),
    ...(action.result === undefined ? {} : { result: action.result }),
    readOnly: false,
    runtime: action.runtime ?? 'any',
    source: { tool: block.name, target: action.target },
    ...(action.requires === undefined ? {} : { requires: action.requires }),
    ...(action.effects === undefined ? {} : { effects: action.effects }),
    ...toolAvailability(action, manifest.readOnly, where),
  })));

  const commandGuidance = manifest.blocks.flatMap(block => block.actions).flatMap((action) => {
    const lines = [action.guidance, ...(action.preconditions ?? []).map(line => `- ${line}`)]
      .filter((line): line is string => typeof line === 'string' && line !== '');

    return lines.length === 0 ? [] : [[action.command, lines.join('\n')] as const];
  });

  return {
    formatVersion: 1,
    revision: canonicalHash({ manifest: manifest.revision, core: Object.keys(core).sort(), where }),
    commands: [...coreCommands, ...toolCommands].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    manifest: { ...manifest, blocks },
    guidance: {
      general,
      commands: Object.fromEntries(commandGuidance),
      tools: Object.fromEntries(manifest.blocks.flatMap(block => (block.guidance === undefined ? [] : [[block.name, block.guidance]]))),
    },
  };
};
```

Merge the new `import type` into the existing one at the top of the file.

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test test/unit/shared/tool-manifest.contract.test.ts` → PASS.
Run: `yarn test test/unit/shared/tool-manifest.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/shared/tool-manifest.ts test/unit/shared/tool-manifest.contract.test.ts
git add src/shared/tool-manifest.ts test/unit/shared/tool-manifest.contract.test.ts
git commit -m "feat(shared): buildAgentContract decides availability once per runner

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 7: Export `buildToolManifest` and `validateAgainst`

**Files:**
- Modify: `src/blok.ts:37-53` (named exports block), `src/view/index.ts` (after line 24)
- Modify: `types/index.d.ts` (near line 89, `export const version: string;`), `types/view.d.ts`
- Test: `test/unit/shared/tool-manifest.exports.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 5.
- Produces: `buildToolManifest` and `validateAgainst` importable from `@bloklabs/core` and `@bloklabs/core/view` (spec §4, 06 §3.8). `buildAgentContract`, `ToolRuntime` and `BUILT_IN_TOOL_RUNTIMES` stay internal (06 C13).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import * as editorEntry from '../../../src/blok';
import * as viewEntry from '../../../src/view';

describe('agent manifest exports', () => {
  it.each([['@bloklabs/core', editorEntry], ['@bloklabs/core/view', viewEntry]])('%s exports the builder and the validator', (_name, entry) => {
    expect(typeof (entry as Record<string, unknown>).buildToolManifest).toBe('function');
    expect(typeof (entry as Record<string, unknown>).validateAgainst).toBe('function');
  });

  it('keeps the contract builder internal', () => {
    expect((editorEntry as Record<string, unknown>).buildAgentContract).toBeUndefined();
    expect((viewEntry as Record<string, unknown>).buildAgentContract).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test test/unit/shared/tool-manifest.exports.test.ts`
Expected: FAIL, `buildToolManifest` is `undefined`.

- [ ] **Step 3: Add the exports**

`src/blok.ts`, after line 53:

```ts
/**
 * Agent capability manifest and the schema-profile validator. Both are pure:
 * the same functions run in Node through `@bloklabs/core/view`.
 */
export { buildToolManifest } from './shared/tool-manifest';
export { validateAgainst } from './shared/schema/validate';
```

`src/view/index.ts`, after line 24:

```ts
export { buildToolManifest } from '../shared/tool-manifest';
export { validateAgainst } from '../shared/schema/validate';
export type { SchemaProblem } from '../shared/schema/validate';
```

`types/index.d.ts`, next to `export const version: string;` (line 89):

```ts
/**
 * Build the agent capability manifest from a registry snapshot. Pure.
 */
export declare function buildToolManifest(
  snapshot: ToolRegistrySnapshot,
  overrides?: ManifestOverrides,
  options?: { onWarning?(message: string): void }
): BlokToolManifest;

/** One problem found by {@link validateAgainst}. `path` is a JSON pointer into the value. */
export interface SchemaProblem { path: string; message: string }

/** Validate a value against a Blok-profile JSON Schema. Empty array: valid. */
export declare function validateAgainst(schema: BlokSchema, value: unknown): SchemaProblem[];
```

with `import { ToolRegistrySnapshot, ManifestOverrides, BlokToolManifest } from './tool-manifest';` and `BlokSchema` from `./tools`. In `types/view.d.ts`, add the same two `export declare function` lines and `import type { … } from './index';` (check how `types/view.d.ts` already imports from `./index`; follow that file's pattern). `published-types-no-src-refs.test.ts:214-247` reads `export declare function` names, so both names must use that exact form.

- [ ] **Step 4: Run the tests**

Run: `yarn test test/unit/shared/tool-manifest.exports.test.ts` → PASS.
Run: `yarn test test/unit/architecture/published-types-no-src-refs.test.ts` → PASS.
Run: `yarn test test/unit/view/index.purity.test.ts` → PASS.
Run: `yarn test test/unit/architecture/view-entry-law.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/blok.ts src/view/index.ts test/unit/shared/tool-manifest.exports.test.ts
git add src/blok.ts src/view/index.ts types/index.d.ts types/view.d.ts test/unit/shared/tool-manifest.exports.test.ts
git commit -m "feat: export buildToolManifest and validateAgainst from core and view

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Checkpoint 1

- [ ] Run, one at a time: `yarn test test/unit/shared/schema/validate.test.ts`, `yarn test test/unit/shared/tool-manifest.test.ts`, `yarn test test/unit/shared/tool-manifest.contract.test.ts`, `yarn test test/unit/view/document-schema.test.ts`, `yarn test test/unit/architecture/published-types-no-src-refs.test.ts`. All PASS.
- [ ] `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` (timeout 600000) PASS.
- [ ] `git pull --rebase && git push`. `git status` says "up to date with origin".
- [ ] Tell plans 01, 03, 04: `validateAgainst`, `buildToolManifest`, `buildAgentContract`, `CoreCommandTable`, `ContractWhere` and every type in `types/tool-manifest.d.ts` are on `main`.

---
## Phase 2: Shared runtime layer

Node and the Jint bundle load no tool class (06 §7.1). So each built-in tool's own sanitize rules, the inline tools' rules and the pure models move to `src/shared/`. Every old path keeps working through a re-export.

### Task 8: Move `INLINE_TEXT_SANITIZE` and `BLOCK_COLOR_SANITIZE` to `src/shared/`

**Files:**
- Create: `src/shared/inline-text-sanitize.ts` (from `src/components/shared/inline-content-sanitize.ts:11-99`, verbatim)
- Create: `src/shared/block-color-sanitize.ts` (from `src/components/shared/block-color.ts:27-36`)
- Modify: `src/components/shared/inline-content-sanitize.ts` (becomes a re-export), `src/components/shared/block-color.ts:27-36` (re-export), `src/view/blocks-to-html.ts:10`, `src/view/html-to-blocks.ts:25` (import from the new path)
- Test: `test/unit/shared/inline-text-sanitize.test.ts`

**Interfaces:**
- Consumes: `EQUATION_SOURCE_ATTR` (`src/shared/equation-mark.ts`), `preservePageReferenceAnchor` (`src/shared/page-reference.ts`).
- Produces: `INLINE_TEXT_SANITIZE`, `preserveColorStyles`, `preserveEquationSpan` from `src/shared/inline-text-sanitize.ts`; `BLOCK_COLOR_SANITIZE` from `src/shared/block-color-sanitize.ts`. The old modules re-export the same bindings (06 R2-02-2). 13 files import `inline-content-sanitize` and 3 import `BLOCK_COLOR_SANITIZE` from `block-color` (grep at `30c77599`); none of them changes.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import * as oldBlockColor from '../../../src/components/shared/block-color';
import * as oldInline from '../../../src/components/shared/inline-content-sanitize';
import { clean } from '../../../src/components/utils/sanitizer';
import { BLOCK_COLOR_SANITIZE } from '../../../src/shared/block-color-sanitize';
import { INLINE_TEXT_SANITIZE, preserveColorStyles } from '../../../src/shared/inline-text-sanitize';
import { sanitizeHtmlFragment } from '../../../src/view/sanitize';

import type { SanitizerConfig } from '../../../types';

const MARK = '<mark style="color: red; font-size: 40px">hot</mark>';

describe('shared inline sanitize rules', () => {
  it('old import paths resolve to the same bindings', () => {
    expect(oldInline.INLINE_TEXT_SANITIZE).toBe(INLINE_TEXT_SANITIZE);
    expect(oldInline.preserveColorStyles).toBe(preserveColorStyles);
    expect(oldBlockColor.BLOCK_COLOR_SANITIZE).toBe(BLOCK_COLOR_SANITIZE);
  });

  it('keeps colour and drops other styles on <mark>, in the editor sanitizer', () => {
    expect(clean(MARK, INLINE_TEXT_SANITIZE)).toBe('<mark style="color: red;">hot</mark>');
  });

  // The parse5 facade (src/view/sanitize.ts:219-232) must give the function rule the same answer.
  it('keeps colour and drops other styles on <mark>, in the headless sanitizer', () => {
    expect(sanitizeHtmlFragment(MARK, INLINE_TEXT_SANITIZE as SanitizerConfig)).toBe('<mark style="color: red;">hot</mark>');
  });
});
```

The exact serialized `style` text (`color: red;`) is what the jsdom CSSOM writes; if Step 2 shows the editor sanitizer produces a different serialization today, copy that observed string into both assertions before moving any code. Both sanitizers must agree.

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test test/unit/shared/inline-text-sanitize.test.ts`
Expected: FAIL, unresolved `src/shared/block-color-sanitize`.

- [ ] **Step 3: Move**

1. Create `src/shared/inline-text-sanitize.ts` with lines 1-99 of `src/components/shared/inline-content-sanitize.ts`, changing only the import paths: `'../../../types'` → `'../../types'`, `'../../shared/equation-mark'` → `'./equation-mark'`, `'../../shared/page-reference'` → `'./page-reference'`.
2. Replace the whole body of `src/components/shared/inline-content-sanitize.ts` with:

```ts
// Moved to src/shared so Node and the Jint bundle get the rules without the editor.
export { INLINE_TEXT_SANITIZE, preserveColorStyles, preserveEquationSpan } from '../../shared/inline-text-sanitize';
```

3. Create `src/shared/block-color-sanitize.ts`:

```ts
/**
 * Sanitize entries for the block-colour data fields. They hold preset names,
 * not HTML, so they pass through untouched.
 */
export const BLOCK_COLOR_SANITIZE = {
  textColor: false,
  backgroundColor: false,
} as const;
```

4. In `src/components/shared/block-color.ts`, delete the doc comment and constant at lines 27-36 and add `export { BLOCK_COLOR_SANITIZE } from '../../shared/block-color-sanitize';` under the imports.
5. In `src/view/blocks-to-html.ts:10` and `src/view/html-to-blocks.ts:25`, import `INLINE_TEXT_SANITIZE` from `'../shared/inline-text-sanitize'`.

- [ ] **Step 4: Run the tests**

Run, one at a time: `yarn test test/unit/shared/inline-text-sanitize.test.ts`, `yarn test test/unit/components/shared/inline-content-sanitize.test.ts`, `yarn test test/unit/components/shared/block-color.test.ts`, `yarn test test/unit/view/sanitize.parity.test.ts`, `yarn test test/unit/view/index.purity.test.ts`, `yarn test test/unit/view/document-schema.test.ts`.
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/shared/inline-text-sanitize.ts src/shared/block-color-sanitize.ts src/components/shared/inline-content-sanitize.ts src/components/shared/block-color.ts src/view/blocks-to-html.ts src/view/html-to-blocks.ts test/unit/shared/inline-text-sanitize.test.ts
git add src/shared/inline-text-sanitize.ts src/shared/block-color-sanitize.ts src/components/shared/inline-content-sanitize.ts src/components/shared/block-color.ts src/view/blocks-to-html.ts src/view/html-to-blocks.ts test/unit/shared/inline-text-sanitize.test.ts
git commit -m "refactor(shared): move inline-text and block-colour sanitize rules to src/shared

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 9: Move each block tool's own sanitize rules (all but table)

**Files:**
- Create: `src/shared/tool-descriptions/sanitize/blocks.ts`
- Modify: the `static get sanitize()` bodies of `src/tools/paragraph/index.ts:484`, `header/index.ts:754`, `list/static-configs.ts:19` (`getListSanitizeConfig`), `toggle/index.ts:536`, `callout/index.ts:678`, `quote/index.ts:247`, `code/index.ts:1342`, `table-of-contents/index.ts:84`, `spacer/index.ts:207`, `divider/index.ts:114`, `image/index.ts:219`, `video/index.ts:141`, `audio/index.ts:130`, `file/index.ts:178`, `link/embed/index.ts:198`, `link/bookmark/index.ts:79`, `page/index.ts:177`, `page-link/index.ts:50`, `database/index.ts:128`, `database-row/index.ts:159`, `tab/index.ts:207`
- Test: `test/unit/shared/tool-descriptions/sanitize-blocks.test.ts`, snapshot `test/unit/shared/tool-descriptions/__snapshots__/block-sanitize.json`

**Interfaces:**
- Consumes: Task 8's moved constants, `PLAINTEXT` (`src/shared/sanitize-rules.ts:20`).
- Produces: one factory per tool, each returning a FRESH object like today's getters do: `paragraphSanitize()`, `headerSanitize()`, `listSanitize()`, `toggleSanitize()`, `calloutSanitize()`, `quoteSanitize()`, `codeSanitize()`, `tableOfContentsSanitize()`, `spacerSanitize()`, `dividerSanitize()`, `imageSanitize()`, `videoSanitize()`, `audioSanitize()`, `fileSanitize()`, `embedSanitize()`, `bookmarkSanitize()`, `pageSanitize()`, `pageLinkSanitize()`, `databaseSanitize()`, `databaseRowSanitize()`, `tabSanitize()`, and `BUILT_IN_BLOCK_SANITIZE: Readonly<Record<string, () => SanitizerConfig>>` keyed by registry key. `column_list`, `column`, `tabs` declare no `sanitize` today; their entries are `() => ({})`, which is what `BaseToolAdapter.sanitizeConfig` reads for them (`src/components/tools/base.ts:364-366`). `table` is added in Task 10.

- [ ] **Step 1: Pin today's configs before touching them**

```ts
import { describe, expect, it } from 'vitest';

import {
  Audio, Bookmark, Callout, Code, Column, ColumnList, Database, DatabaseRow, Divider, Embed, File as FileTool,
  Header, Image as ImageTool, List, Page, PageLink, Paragraph, Quote, Spacer, TableOfContents, TabTool, TabsTool, Toggle, Video,
} from '../../../../src/tools';

import type { SanitizerConfig } from '../../../../types';

// Functions cannot be compared by value; their names are stable across a move.
const shape = (config: unknown): unknown =>
  JSON.parse(JSON.stringify(config, (_key, value: unknown) => (typeof value === 'function' ? `[fn ${(value as { name: string }).name}]` : value)));

const CLASSES: Record<string, { sanitize?: SanitizerConfig }> = {
  paragraph: Paragraph, header: Header, list: List, toggle: Toggle, callout: Callout, quote: Quote, code: Code,
  table_of_contents: TableOfContents, spacer: Spacer, divider: Divider, image: ImageTool, video: Video, audio: Audio,
  file: FileTool, embed: Embed, bookmark: Bookmark, page: Page, 'page-link': PageLink, database: Database,
  'database-row': DatabaseRow, tab: TabTool, column_list: ColumnList, column: Column, tabs: TabsTool,
};

describe('block tools own sanitize rules', () => {
  it('match the pinned shapes', async () => {
    const shapes = Object.fromEntries(Object.entries(CLASSES).map(([name, tool]) => [name, shape(tool.sanitize ?? {})]));

    await expect(JSON.stringify(shapes, null, 2)).toMatchFileSnapshot('./__snapshots__/block-sanitize.json');
  });
});
```

Run: `yarn test test/unit/shared/tool-descriptions/sanitize-blocks.test.ts`
Expected: PASS and the snapshot file is written. This is the "before" picture.

- [ ] **Step 2: Add the failing half**

Append:

```ts
import { BUILT_IN_BLOCK_SANITIZE } from '../../../../src/shared/tool-descriptions/sanitize/blocks';

describe('BUILT_IN_BLOCK_SANITIZE', () => {
  it.each(Object.keys(CLASSES))('%s: the class getter and the shared factory agree', (name) => {
    expect(shape(BUILT_IN_BLOCK_SANITIZE[name]())).toEqual(shape(CLASSES[name].sanitize ?? {}));
  });

  it('returns a fresh object per call, as the getters did', () => {
    expect(BUILT_IN_BLOCK_SANITIZE.paragraph()).not.toBe(BUILT_IN_BLOCK_SANITIZE.paragraph());
  });
});
```

Run: `yarn test test/unit/shared/tool-descriptions/sanitize-blocks.test.ts`
Expected: FAIL, unresolved `sanitize/blocks`.

- [ ] **Step 3: Create the shared factories**

Each factory body is the tool's current getter body, moved verbatim, with imports pointed at `src/shared/`. The file:

```ts
/**
 * Each built-in block tool's OWN sanitize rules. The tool classes return these,
 * and Node and the Jint bundle read them without loading any tool class.
 * Inline-tool rules are merged in by buildToolRuntimes, like BlockToolAdapter does.
 */
import type { SanitizerConfig, ToolSanitizerConfig } from '../../../../types';
import { BLOCK_COLOR_SANITIZE } from '../../block-color-sanitize';
import { INLINE_TEXT_SANITIZE } from '../../inline-text-sanitize';
import { PLAINTEXT } from '../../sanitize-rules';

export const paragraphSanitize = (): ToolSanitizerConfig => ({
  ...BLOCK_COLOR_SANITIZE,
  text: { ...INLINE_TEXT_SANITIZE, img: { src: true, alt: true, style: true }, p: true, ul: true, li: true },
});

export const headerSanitize = (): SanitizerConfig => ({
  level: false,
  text: { ...INLINE_TEXT_SANITIZE },
  isToggleable: false,
  anchor: false,
  ...BLOCK_COLOR_SANITIZE,
} as SanitizerConfig);

export const listSanitize = (): ToolSanitizerConfig => ({ text: { ...INLINE_TEXT_SANITIZE } });

export const toggleSanitize = (): ToolSanitizerConfig => ({ ...BLOCK_COLOR_SANITIZE, text: { ...INLINE_TEXT_SANITIZE } });

export const calloutSanitize = (): ToolSanitizerConfig => ({ emoji: false, textColor: false, backgroundColor: false });

export const quoteSanitize = (): ToolSanitizerConfig => ({ text: { ...INLINE_TEXT_SANITIZE } });

// `code` and `filename` are literal source text: an HTML pass would entity-encode them.
export const codeSanitize = (): ToolSanitizerConfig => ({ code: PLAINTEXT, filename: PLAINTEXT });

export const tableOfContentsSanitize = (): SanitizerConfig => ({ ...BLOCK_COLOR_SANITIZE });

export const spacerSanitize = (): SanitizerConfig => ({});

export const dividerSanitize = (): SanitizerConfig => ({});

export const imageSanitize = (): SanitizerConfig => ({
  url: PLAINTEXT, caption: PLAINTEXT, alt: PLAINTEXT, fileName: PLAINTEXT, markup: PLAINTEXT,
});

export const videoSanitize = (): SanitizerConfig => ({
  url: PLAINTEXT, caption: PLAINTEXT, fileName: PLAINTEXT, mimeType: PLAINTEXT, aspectRatio: PLAINTEXT,
});

export const audioSanitize = (): SanitizerConfig => ({
  url: PLAINTEXT, caption: PLAINTEXT, title: PLAINTEXT, artist: PLAINTEXT, coverUrl: PLAINTEXT, fileName: PLAINTEXT, mimeType: PLAINTEXT,
});

export const fileSanitize = (): SanitizerConfig => ({ url: PLAINTEXT, caption: PLAINTEXT, fileName: PLAINTEXT, mimeType: PLAINTEXT });

export const embedSanitize = (): SanitizerConfig => ({ service: PLAINTEXT, source: PLAINTEXT, embed: PLAINTEXT, caption: PLAINTEXT });

export const bookmarkSanitize = (): SanitizerConfig => ({
  url: PLAINTEXT, title: PLAINTEXT, description: PLAINTEXT, image: PLAINTEXT, favicon: PLAINTEXT, domain: PLAINTEXT,
});

export const pageSanitize = (): SanitizerConfig => ({ pageId: PLAINTEXT, cache: PLAINTEXT });

export const pageLinkSanitize = (): SanitizerConfig => ({ pageId: PLAINTEXT });

export const databaseSanitize = (): SanitizerConfig => ({ title: PLAINTEXT, schema: PLAINTEXT, views: PLAINTEXT, activeViewId: PLAINTEXT });

export const databaseRowSanitize = (): SanitizerConfig => ({ title: PLAINTEXT, properties: PLAINTEXT, position: PLAINTEXT, pageId: PLAINTEXT });

export const tabSanitize = (): SanitizerConfig => ({ title: false, icon: false });

const none = (): SanitizerConfig => ({});

export const BUILT_IN_BLOCK_SANITIZE: Readonly<Record<string, () => SanitizerConfig>> = {
  paragraph: paragraphSanitize as () => SanitizerConfig,
  header: headerSanitize,
  list: listSanitize as () => SanitizerConfig,
  toggle: toggleSanitize as () => SanitizerConfig,
  callout: calloutSanitize as () => SanitizerConfig,
  quote: quoteSanitize as () => SanitizerConfig,
  code: codeSanitize as () => SanitizerConfig,
  table_of_contents: tableOfContentsSanitize,
  spacer: spacerSanitize,
  divider: dividerSanitize,
  image: imageSanitize,
  video: videoSanitize,
  audio: audioSanitize,
  file: fileSanitize,
  embed: embedSanitize,
  bookmark: bookmarkSanitize,
  page: pageSanitize,
  'page-link': pageLinkSanitize,
  database: databaseSanitize,
  'database-row': databaseRowSanitize,
  tab: tabSanitize,
  column_list: none,
  column: none,
  tabs: none,
};
```

Before writing each factory, open the getter it replaces and copy its body; the code above was read at `30c77599`. Keep each getter's explanatory comment where the rule still lives (e.g. the `code`/`filename` comment, header's "Spread the shared inline whitelist…" comment goes on `headerSanitize`).

- [ ] **Step 4: Point the getters at the factories**

Each getter body becomes one line, e.g. `src/tools/paragraph/index.ts:484`:

```ts
  public static get sanitize(): ToolSanitizerConfig {
    return paragraphSanitize();
  }
```

`src/tools/list/static-configs.ts:19-23` becomes `export const getListSanitizeConfig = (): ToolSanitizerConfig => listSanitize();`. Remove imports that become unused (`BLOCK_COLOR_SANITIZE`, `INLINE_TEXT_SANITIZE`, `PLAINTEXT`) only where `npx eslint` reports them unused; several files use them elsewhere.

- [ ] **Step 5: Run the tests**

Run: `yarn test test/unit/shared/tool-descriptions/sanitize-blocks.test.ts` → PASS (the pinned snapshot is unchanged, and every factory agrees with its getter).
Run, one at a time, the existing suites that read these getters: `yarn test test/unit/tools/header.test.ts`, `yarn test test/unit/tools/toggle/toggle.test.ts`, `yarn test test/unit/ui/toolbox.test.ts`, `yarn test test/unit/shared/sanitize-schema.test.ts`. All PASS.

- [ ] **Step 6: Commit**

```bash
npx eslint src/shared/tool-descriptions/sanitize/blocks.ts src/tools/paragraph/index.ts src/tools/header/index.ts src/tools/list/static-configs.ts src/tools/toggle/index.ts src/tools/callout/index.ts src/tools/quote/index.ts src/tools/code/index.ts src/tools/table-of-contents/index.ts src/tools/spacer/index.ts src/tools/divider/index.ts src/tools/image/index.ts src/tools/video/index.ts src/tools/audio/index.ts src/tools/file/index.ts src/tools/link/embed/index.ts src/tools/link/bookmark/index.ts src/tools/page/index.ts src/tools/page-link/index.ts src/tools/database/index.ts src/tools/database-row/index.ts src/tools/tab/index.ts test/unit/shared/tool-descriptions/sanitize-blocks.test.ts
git add src/shared/tool-descriptions/sanitize/blocks.ts src/tools/paragraph/index.ts src/tools/header/index.ts src/tools/list/static-configs.ts src/tools/toggle/index.ts src/tools/callout/index.ts src/tools/quote/index.ts src/tools/code/index.ts src/tools/table-of-contents/index.ts src/tools/spacer/index.ts src/tools/divider/index.ts src/tools/image/index.ts src/tools/video/index.ts src/tools/audio/index.ts src/tools/file/index.ts src/tools/link/embed/index.ts src/tools/link/bookmark/index.ts src/tools/page/index.ts src/tools/page-link/index.ts src/tools/database/index.ts src/tools/database-row/index.ts src/tools/tab/index.ts test/unit/shared/tool-descriptions/sanitize-blocks.test.ts test/unit/shared/tool-descriptions/__snapshots__/block-sanitize.json
git commit -m "refactor(tools): built-in block sanitize rules live in src/shared

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 10: Move the table's sanitize rules

**Files:**
- Modify: `src/shared/tool-descriptions/sanitize/blocks.ts` (add `tableSanitize`)
- Create: `src/shared/table/cell-sanitize.ts` (`ALLOWED_MARK_STYLE_PROPS` from `src/tools/table/table-cell-clipboard.ts:447`, `CELL_BLOCK_TAGS_SANITIZE` from `src/tools/table/table-cell-paste.ts:27-35`)
- Modify: `src/tools/table/index.ts:548-582`, `table-cell-clipboard.ts:447` and `table-cell-paste.ts:27-35` (re-export from the new module)
- Test: `test/unit/shared/tool-descriptions/sanitize-table.test.ts`

**Interfaces:**
- Consumes: `INLINE_TEXT_SANITIZE` (Task 8), `PAGE_REFERENCE_ATTR`, `preservePageReferenceAnchor` (`src/shared/page-reference.ts`).
- Produces: `tableSanitize(): ToolSanitizerConfig`, `BUILT_IN_BLOCK_SANITIZE.table`, `ALLOWED_MARK_STYLE_PROPS`, `CELL_BLOCK_TAGS_SANITIZE` (shared). The paste attribute law needs `CELL_BLOCK_TAGS_SANITIZE` to keep `li[aria-level]`, `li[data-list-style]` and `input[type|checked]` (CLAUDE.md "Paste attribute law"); the move keeps the same object.

The table's `mark` and `a` rules are inline arrows, so this task pins BEHAVIOUR with the real sanitizer, not identity.

- [ ] **Step 1: Write the behaviour pin (passes today)**

```ts
import { describe, expect, it } from 'vitest';

import { clean } from '../../../../src/components/utils/sanitizer';
import { Table } from '../../../../src/tools';

import type { SanitizerConfig } from '../../../../types';

const CASES: Array<[string, string]> = [
  ['mark keeps colour only', '<mark style="color: red; font-size: 9px">x</mark>'],
  ['plain link gets target and rel', '<a href="https://a.b" onclick="x()">a</a>'],
  ['page reference link keeps its id', '<a href="/p/1" data-blok-page-id="p1">p</a>'],
  ['nested list keeps aria-level and style', '<ul><li aria-level="2" data-list-style="ordered" style="list-style-type: decimal">i</li></ul>'],
  ['checkbox input survives', '<li><input type="checkbox" checked>t</li>'],
  ['paragraph and div survive', '<p>a</p><div>b</div>'],
];

const contentRule = (config: SanitizerConfig): SanitizerConfig => (config as { content: SanitizerConfig }).content;

describe('table sanitize behaviour', () => {
  it.each(CASES)('%s', async (_label, html) => {
    await expect(clean(html, contentRule(Table.sanitize as SanitizerConfig)))
      .toMatchFileSnapshot(`./__snapshots__/table-sanitize/${_label.replace(/\s+/g, '-')}.html`);
  });
});
```

Run: `yarn test test/unit/shared/tool-descriptions/sanitize-table.test.ts`
Expected: PASS, six snapshot files written.

- [ ] **Step 2: Add the failing half**

Append:

```ts
import { BUILT_IN_BLOCK_SANITIZE, tableSanitize } from '../../../../src/shared/tool-descriptions/sanitize/blocks';

describe('shared table sanitize', () => {
  it.each(CASES)('%s: the shared factory sanitizes the same way', (_label, html) => {
    expect(clean(html, contentRule(tableSanitize() as SanitizerConfig))).toBe(clean(html, contentRule(Table.sanitize as SanitizerConfig)));
  });

  it('is registered under "table"', () => {
    expect(Object.keys(BUILT_IN_BLOCK_SANITIZE.table())).toEqual(['content']);
  });
});
```

Run: `yarn test test/unit/shared/tool-descriptions/sanitize-table.test.ts`
Expected: FAIL, `tableSanitize` is not exported.

- [ ] **Step 3: Move**

`src/shared/table/cell-sanitize.ts`:

```ts
/** CSS properties a pasted or saved <mark> may keep. */
export const ALLOWED_MARK_STYLE_PROPS = new Set(['color', 'background-color']);

/**
 * Block tags parseCellContentToBlocks reads, with the attributes it reads.
 * Paste attribute law: an attribute the parser reads must be listed here, or the sanitizer strips it.
 */
export const CELL_BLOCK_TAGS_SANITIZE = {
  ul: true,
  ol: true,
  li: { style: true, 'aria-level': true, 'data-list-style': true },
  input: { type: true, checked: true },
  // Each <p>/<div> is a separate paragraph to the parser; stripped, lines glue together.
  p: {},
  div: {},
};
```

In `table-cell-clipboard.ts:447` replace the declaration with `export { ALLOWED_MARK_STYLE_PROPS } from '../../shared/table/cell-sanitize';` plus a local `import { ALLOWED_MARK_STYLE_PROPS } from '../../shared/table/cell-sanitize';` for its own use at `:471`. Do the same for `CELL_BLOCK_TAGS_SANITIZE` in `table-cell-paste.ts`.

Add to `sanitize/blocks.ts` the body of `src/tools/table/index.ts:549-581` verbatim as:

```ts
export const tableSanitize = (): ToolSanitizerConfig => ({
  content: {
    ...INLINE_TEXT_SANITIZE,
    b: true,
    i: true,
    strong: true,
    em: true,
    u: true,
    s: true,
    del: true,
    code: true,
    mark: (node: Element): { [attr: string]: boolean | string } => {
      const style = (node as HTMLElement).style;
      const props = Array.from({ length: style.length }, (_, i) => style.item(i));

      for (const prop of props) {
        if (!ALLOWED_MARK_STYLE_PROPS.has(prop)) {
          style.removeProperty(prop);
        }
      }

      return style.length > 0 ? { style: true } : {};
    },
    a: (node: Element) => (node.getAttribute(PAGE_REFERENCE_ATTR)
      ? preservePageReferenceAnchor(node)
      : { href: true, target: '_blank', rel: 'nofollow' }),
    // Legacy string cells may hold lists and lines; this runs before parseCellContentToBlocks reads them.
    ...CELL_BLOCK_TAGS_SANITIZE,
  },
});
```

with imports `ALLOWED_MARK_STYLE_PROPS`, `CELL_BLOCK_TAGS_SANITIZE` from `'../../table/cell-sanitize'` and `PAGE_REFERENCE_ATTR`, `preservePageReferenceAnchor` from `'../../page-reference'`, and the entry `table: tableSanitize as () => SanitizerConfig` in `BUILT_IN_BLOCK_SANITIZE`. Then `src/tools/table/index.ts:548` returns `tableSanitize()`. Add `table: Table` to `CLASSES` in `sanitize-blocks.test.ts`.

- [ ] **Step 4: Run the tests**

Run, one at a time: `yarn test test/unit/shared/tool-descriptions/sanitize-table.test.ts`, `yarn test test/unit/shared/tool-descriptions/sanitize-blocks.test.ts` (its snapshot gains the `table` key; run with `-u` ONLY for that file after checking the diff adds only `table`), `yarn test test/unit/architecture/paste-stamp-law.test.ts`, `yarn test test/unit/architecture/table-cell-content-law.test.ts`, `yarn test test/unit/tools/table/table-cell-blocks.test.ts`.
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/shared/table/cell-sanitize.ts src/shared/tool-descriptions/sanitize/blocks.ts src/tools/table/index.ts src/tools/table/table-cell-clipboard.ts src/tools/table/table-cell-paste.ts test/unit/shared/tool-descriptions/sanitize-table.test.ts test/unit/shared/tool-descriptions/sanitize-blocks.test.ts
git add src/shared/table/cell-sanitize.ts src/shared/tool-descriptions/sanitize/blocks.ts src/tools/table/index.ts src/tools/table/table-cell-clipboard.ts src/tools/table/table-cell-paste.ts test/unit/shared/tool-descriptions/sanitize-table.test.ts test/unit/shared/tool-descriptions/sanitize-blocks.test.ts test/unit/shared/tool-descriptions/__snapshots__
git commit -m "refactor(table): table sanitize rules live in src/shared

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 11: Move the built-in inline tools' sanitize rules

**Files:**
- Create: `src/shared/tool-descriptions/sanitize/inline.ts`
- Modify: `src/components/inline-tools/inline-tool-bold.ts:59`, `inline-tool-code.ts:49`, `inline-tool-link.ts:117`, `inline-tool-marker.ts:94`, `inline-tool-equation.ts:73`, `inline-tool-sup-sub.ts:61`, `inline-tool-clear-format.ts:56`
- Test: `test/unit/shared/tool-descriptions/sanitize-inline.test.ts`

**Interfaces:**
- Consumes: `preservePageReferenceAnchor`, `EQUATION_ATTR` (read `inline-tool-equation.ts` for where it comes from; if it lives under `src/components/`, move the constant to `src/shared/equation-mark.ts`, which already exports `EQUATION_SOURCE_ATTR`, and check whether they are the same string).
- Produces: `BUILT_IN_INLINE_SANITIZE: Readonly<Record<string, () => SanitizerConfig>>` keyed by the default inline-tool registry keys (`src/tools/index.ts:108-119`): `marker`, `bold`, `italic`, `underline`, `clearFormat`, `link`, `strikethrough`, `inlineCode`, `equation`, `supSub`. Italic, underline and strikethrough come from `createSimpleMarkTool` (`simple-mark-tool.ts:120-124`): `Object.fromEntries([spec.tag, ...aliasTags].map(tag => [tag, {}]))`. Read each subclass's `tag`/`aliasTags` to write their factories.

- [ ] **Step 1: Write the test (the pin passes now; the shared half fails)**

```ts
import { describe, expect, it } from 'vitest';

import { clean } from '../../../../src/components/utils/sanitizer';
import { BUILT_IN_INLINE_SANITIZE } from '../../../../src/shared/tool-descriptions/sanitize/inline';
import { Bold, ClearFormat, Equation, InlineCode, Italic, Link, Marker, Strikethrough, SupSub, Underline } from '../../../../src/tools';

import type { SanitizerConfig } from '../../../../types';

const CLASSES: Record<string, { sanitize?: SanitizerConfig }> = {
  marker: Marker, bold: Bold, italic: Italic, underline: Underline, clearFormat: ClearFormat, link: Link,
  strikethrough: Strikethrough, inlineCode: InlineCode, equation: Equation, supSub: SupSub,
};

const HTML = '<b>b</b><strong>s</strong><i>i</i><em>e</em><u>u</u><s>s</s><del>d</del><code>c</code>'
  + '<sup>1</sup><sub>2</sub><mark style="color: red; font-size: 3px">m</mark><a href="https://x.y">l</a>'
  + '<span data-latex="x^2">x2</span>';

describe('inline tools sanitize', () => {
  it.each(Object.keys(CLASSES))('%s: the shared factory sanitizes like the class', (name) => {
    expect(clean(HTML, BUILT_IN_INLINE_SANITIZE[name]())).toBe(clean(HTML, CLASSES[name].sanitize ?? {}));
  });
});
```

Run: `yarn test test/unit/shared/tool-descriptions/sanitize-inline.test.ts`
Expected: FAIL, unresolved `sanitize/inline`.

- [ ] **Step 2: Create the factories**

Copy each getter body verbatim into `src/shared/tool-descriptions/sanitize/inline.ts` as `boldSanitize`, `inlineCodeSanitize`, `linkSanitize`, `markerSanitize`, `equationSanitize`, `supSubSanitize`, `clearFormatSanitize`, `italicSanitize`, `underlineSanitize`, `strikethroughSanitize`, then:

```ts
export const BUILT_IN_INLINE_SANITIZE: Readonly<Record<string, () => SanitizerConfig>> = {
  marker: markerSanitize,
  bold: boldSanitize,
  italic: italicSanitize,
  underline: underlineSanitize,
  clearFormat: clearFormatSanitize,
  link: linkSanitize,
  strikethrough: strikethroughSanitize,
  inlineCode: inlineCodeSanitize,
  equation: equationSanitize,
  supSub: supSubSanitize,
};
```

`markerSanitize`'s `mark` rule is the inline arrow at `inline-tool-marker.ts:96-110`; copy it verbatim (it is not `preserveColorStyles`, although it does the same thing; do not merge them in this task). Point each class getter at its factory (`return boldSanitize();`). Leave `simple-mark-tool.ts` alone: its getter derives from the spec, and the test above proves the factories match it.

- [ ] **Step 3: Run the tests**

Run: `yarn test test/unit/shared/tool-descriptions/sanitize-inline.test.ts` → PASS.
Run: `yarn test test/unit/shared/sanitize-schema.test.ts` → PASS.
Run: `yarn test test/unit/view/mark-view-integration.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
npx eslint src/shared/tool-descriptions/sanitize/inline.ts src/components/inline-tools/inline-tool-bold.ts src/components/inline-tools/inline-tool-code.ts src/components/inline-tools/inline-tool-link.ts src/components/inline-tools/inline-tool-marker.ts src/components/inline-tools/inline-tool-equation.ts src/components/inline-tools/inline-tool-sup-sub.ts src/components/inline-tools/inline-tool-clear-format.ts test/unit/shared/tool-descriptions/sanitize-inline.test.ts
git add src/shared/tool-descriptions/sanitize/inline.ts src/components/inline-tools/inline-tool-bold.ts src/components/inline-tools/inline-tool-code.ts src/components/inline-tools/inline-tool-link.ts src/components/inline-tools/inline-tool-marker.ts src/components/inline-tools/inline-tool-equation.ts src/components/inline-tools/inline-tool-sup-sub.ts src/components/inline-tools/inline-tool-clear-format.ts test/unit/shared/tool-descriptions/sanitize-inline.test.ts
git commit -m "refactor(inline-tools): built-in inline sanitize rules live in src/shared

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 12: Action handler types and a fake recording ctx

**Gate:** plan 01 has landed `types/agent.d.ts` with `InsertSpec` and `RichTextHelpers` (06 R2-02-5). If not, do Tasks 14 and 15 first. Phase 3 needs Task 3, which also waits for 01 Task 1, so it cannot run ahead of 01 either. Task 13, Task 15 Step 2b, the `defaultChildren` line of Task 18, Tasks 26-27 and all of Phase 4 wait for this task.

**Files:**
- Modify: `types/tools/tool-description.d.ts` (append), `types/tools/block-tool.d.ts` (`actionHandlers` static)
- Create: `test/unit/shared/tool-actions/fake-ctx.ts` (test helper, not a test file), `src/shared/tool-actions/services.ts` (types only; moved here from Task 44 so 01 Task 17 can import `PageBackendService` early)
- Test: `test/unit/shared/tool-actions/fake-ctx.test.ts`

**Interfaces:**
- Consumes: `InsertSpec`, `RichTextHelpers` (`types/agent.d.ts`, 01), `RichText` (`types/rich-text.d.ts`), `BlockPosition` (`types/api/blocks.d.ts:33`).
- Produces (published, canonical 06 §3.4):
  - `ToolActionImpl<Args = unknown, Prepared = unknown, Result = unknown>` with optional `prepare(ctx: { services: Partial<Record<HostService, unknown>> }, args: Args): Promise<Prepared>` and `run(ctx: ToolActionContext, args: Args, prepared: Prepared | undefined): Result`.
  - `ToolActionContext` exactly as 06 §3.4, including `tool: string` (the registry key the action runs under; 01 Task 14 fills it from `entry.source.tool`). Every `create` handler inserts `type: ctx.tool`, never a built-in name.
  - `src/shared/tool-actions/services.ts`: `UploaderService`, `LinkMetadataService`, `PageBackendService`, exactly as Task 44 lists them (types only). Task 44 adds no new type there.
  - `actionHandlers?: { readonly [actionName: string]: ToolActionImpl }` on `BlockToolConstructable`.
- Produces (test-only): `createFakeCtx(doc: FakeDoc, blockId?: string, tool?: string): FakeCtx` (`tool` defaults to the target block's type; a `create` test passes the key) where `FakeDoc = Map<string, FakeBlock>`, `FakeBlock = { id; type; data; parentId: string | null; children: string[] }`, and `FakeCtx = ToolActionContext & { edits: FakeEdit[]; doc: FakeDoc }`. It records `insert`, `update`, `setRichText`, `move`, `remove` and applies them to `doc`, so later reads see earlier writes. `update` with `undefined` removes the key, the same rule 01's real ctx pins (01 Task 14: the recorded edit carries `null`). `newId()` returns `n1`, `n2`, …. `fail` throws `FakeFailure { code, message }`. Every action task (30-49) unit-tests against it. 01's real ctx replaces it in parity tests.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

describe('fake recording ctx', () => {
  it('records writes and lets later reads see them', () => {
    const doc = docOf([{ id: 't', type: 'table', data: { content: [] } }]);
    const ctx = createFakeCtx(doc, 't');
    const child = ctx.insert({ type: 'paragraph', data: { text: [] }, parentId: 't' });

    ctx.update('t', { content: [[{ blocks: [child] }]] });

    expect(ctx.read('t')).toMatchObject({ children: [child], data: { content: [[{ blocks: [child] }]] } });
    expect(ctx.edits.map(edit => edit.op)).toEqual(['insert', 'update']);
    expect(ctx.block?.id).toBe('t');
    expect(ctx.tool).toBe('table');
    expect(createFakeCtx(doc, undefined, 'grid').tool).toBe('grid');
  });

  it('removes a subtree with withChildren', () => {
    const doc = docOf([{ id: 'a', type: 'column', data: {} }, { id: 'b', type: 'paragraph', data: {}, parentId: 'a' }]);
    const ctx = createFakeCtx(doc);

    ctx.remove('a', { withChildren: true });

    expect(ctx.read('b')).toBeNull();
  });

  it('fail throws a typed failure', () => {
    expect(() => createFakeCtx(docOf([])).fail('PRECONDITION_FAILED', 'nope')).toThrow(FakeFailure);
  });
});
```

Run: `yarn test test/unit/shared/tool-actions/fake-ctx.test.ts`
Expected: FAIL, unresolved `./fake-ctx`.

- [ ] **Step 2: Append the published types**

To `types/tools/tool-description.d.ts`:

```ts
import { BlockPosition } from '../api/blocks';
import { InsertSpec, RichTextHelpers } from '../agent';
import { RichText } from '../rich-text';

export interface ToolActionContext {
  /** The registry key this action runs under. A `create` action inserts a block of this type. */
  tool: string;
  /** The target block. Absent for a `create` action. */
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

export interface ToolActionImpl<Args = unknown, Prepared = unknown, Result = unknown> {
  /** Optional async host work, run before planning. Writes nothing. */
  prepare?(ctx: { services: Partial<Record<HostService, unknown>> }, args: Args): Promise<Prepared>;
  /** Synchronous. Writes are recorded; reads see earlier writes. */
  run(ctx: ToolActionContext, args: Args, prepared: Prepared | undefined): Result;
}
```

Merge the three imports into the top of the file. Confirm `types/agent.d.ts` exports `InsertSpec` and `RichTextHelpers` under those names before writing this (01's file; read it).

To `BlockToolConstructable` in `types/tools/block-tool.d.ts`, after `describe?`:

```ts
  /** Handlers for the actions `describe()` declares, keyed by action name. Browser-only for host tools in v1. */
  actionHandlers?: { readonly [actionName: string]: ToolActionImpl };
```

Add `ToolActionImpl, ToolActionContext` to the `export { … } from './tools'` list in `types/index.d.ts`.

Create `src/shared/tool-actions/services.ts` with the three host service types exactly as Task 44's Interfaces list them (`UploaderService`, `LinkMetadataService`, `PageBackendService`, types only, no runtime code). 01 Task 17's Node page backend implements `PageBackendService`, and 03 Task 9a's browser objects implement all three.

- [ ] **Step 3: Write the helper `test/unit/shared/tool-actions/fake-ctx.ts`**

```ts
import type { RichTextHelpers } from '../../../../types/agent';
import type { BlockPosition, ToolActionContext } from '../../../../types';

export interface FakeBlock { id: string; type: string; data: Record<string, unknown>; parentId: string | null; children: string[] }
export type FakeDoc = Map<string, FakeBlock>;
export type FakeEdit =
  | { op: 'insert'; id: string; type: string; parentId: string | null }
  | { op: 'update'; id: string; patch: Record<string, unknown> }
  | { op: 'setRichText'; id: string; field: string }
  | { op: 'move'; id: string; parentId: string | null }
  | { op: 'remove'; id: string; withChildren: boolean };
export type FakeCtx = ToolActionContext & { edits: FakeEdit[]; doc: FakeDoc };

export class FakeFailure extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export const docOf = (blocks: Array<{ id: string; type: string; data: Record<string, unknown>; parentId?: string }>): FakeDoc => {
  const doc: FakeDoc = new Map(blocks.map(block => [block.id, { ...block, parentId: block.parentId ?? null, children: [] }]));

  blocks.forEach(block => block.parentId !== undefined && doc.get(block.parentId)?.children.push(block.id));

  return doc;
};

const place = (list: string[], id: string, position: BlockPosition | undefined): void => {
  if (position === 'start') {
    list.unshift(id);
  } else if (typeof position === 'object' && 'before' in position) {
    list.splice(Math.max(0, list.indexOf(position.before)), 0, id);
  } else if (typeof position === 'object' && 'after' in position) {
    list.splice(list.indexOf(position.after) + 1, 0, id);
  } else {
    list.push(id);
  }
};

export const createFakeCtx = (doc: FakeDoc, blockId?: string, tool?: string): FakeCtx => {
  const edits: FakeEdit[] = [];
  let counter = 0;
  const siblings = (parentId: string | null): string[] | null => (parentId === null ? null : doc.get(parentId)?.children ?? null);

  const ctx: FakeCtx = {
    edits,
    doc,
    tool: tool ?? (blockId === undefined ? '' : doc.get(blockId)?.type ?? ''),
    get block() {
      const block = blockId === undefined ? undefined : doc.get(blockId);

      return block === undefined ? undefined : { id: block.id, type: block.type, data: block.data, children: [...block.children] };
    },
    read: (id) => {
      const block = doc.get(id);

      return block === undefined ? null : { ...block, children: [...block.children] };
    },
    insert: ({ type, data = {}, parentId = null, position, children = [] }) => {
      counter += 1;
      const id = `n${counter}`;

      doc.set(id, { id, type, data: { ...data }, parentId, children: [] });
      const list = siblings(parentId);

      if (list !== null) {
        place(list, id, position);
      }
      edits.push({ op: 'insert', id, type, parentId });
      children.forEach(child => ctx.insert({ ...child, parentId: id }));

      return id;
    },
    update: (id, patch) => {
      const block = doc.get(id);

      if (block !== undefined) {
        // undefined removes the key: 01 Task 14 pins the same rule for the real ctx.
        const next = { ...block.data, ...patch };

        Object.keys(patch).filter(key => patch[key] === undefined).forEach(key => delete next[key]);
        block.data = next;
      }
      edits.push({ op: 'update', id, patch });
    },
    setRichText: (id, field, value) => {
      const block = doc.get(id);

      if (block !== undefined) {
        block.data = { ...block.data, [field]: value };
      }
      edits.push({ op: 'setRichText', id, field });
    },
    move: (id, to) => {
      const block = doc.get(id);

      if (block === undefined) {
        return;
      }
      const from = siblings(block.parentId);

      from?.splice(from.indexOf(id), 1);
      block.parentId = to.parentId ?? null;
      const list = siblings(block.parentId);

      if (list !== null) {
        place(list, id, to.position);
      }
      edits.push({ op: 'move', id, parentId: block.parentId });
    },
    remove: (id, opts = {}) => {
      const block = doc.get(id);

      if (block === undefined) {
        return;
      }
      if (opts.withChildren === true) {
        [...block.children].forEach(child => ctx.remove(child, { withChildren: true }));
      }
      const list = siblings(block.parentId);

      list?.splice(list.indexOf(id), 1);
      doc.delete(id);
      edits.push({ op: 'remove', id, withChildren: opts.withChildren === true });
    },
    newId: () => {
      counter += 1;

      return `n${counter}`;
    },
    // Handlers in this plan never call richText helpers; 01's real ctx provides them.
    richText: {} as unknown as RichTextHelpers,
    fail: (code, message) => {
      throw new FakeFailure(code, message);
    },
  };

  return ctx;
};
```

- [ ] **Step 4: Run tests and tsc**

Run: `yarn test test/unit/shared/tool-actions/fake-ctx.test.ts` → PASS.
Run: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` (timeout 600000) → PASS.
Run: `yarn test test/unit/architecture/published-types-no-src-refs.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint test/unit/shared/tool-actions/fake-ctx.ts test/unit/shared/tool-actions/fake-ctx.test.ts
git add types/tools/tool-description.d.ts types/tools/block-tool.d.ts types/index.d.ts src/shared/tool-actions/services.ts test/unit/shared/tool-actions/fake-ctx.ts test/unit/shared/tool-actions/fake-ctx.test.ts
git commit -m "feat(types): ToolActionImpl, ToolActionContext and the actionHandlers static

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 13: `ToolRuntime` and `buildToolRuntimes`

**Files:**
- Create: `src/shared/tool-actions/runtime.ts`, `src/shared/tool-actions/index.ts`
- Create: `test/unit/shared/tool-descriptions/built-in-tools.ts` (test helper: real classes and the default editor config)
- Test: `test/unit/shared/tool-actions/runtime.test.ts`

**Interfaces:**
- Consumes: `BUILT_IN_BLOCK_SANITIZE` (Tasks 9, 10), `BUILT_IN_INLINE_SANITIZE` (Task 11), `ToolActionImpl` (Task 12), `InsertSpec` (01).
- Produces:
  - `interface ToolRuntime { name: string; sanitize: SanitizerConfig; normalize?(data: Record<string, unknown>): Record<string, unknown>; defaultChildren?: InsertSpec[]; actions: Readonly<Record<string, ToolActionImpl>> }` (internal, 06 §3.4).
  - `type ToolRuntimeRegistry = ReadonlyMap<string, ToolRuntime>`.
  - `interface RuntimeBlockInput { name: string; ownSanitize: SanitizerConfig; inlineSanitize: SanitizerConfig[]; normalize?: ToolRuntime['normalize']; defaultChildren?: InsertSpec[]; actions?: Readonly<Record<string, ToolActionImpl>> }`.
  - `composeToolSanitize(own: SanitizerConfig, inline: SanitizerConfig[]): SanitizerConfig`. Same rules as `BlockToolAdapter.sanitizeConfig` (`src/components/tools/block.ts:562-617`): fold `inline` with `Object.assign`; empty own rules → the fold; else each plain-object field rule becomes `Object.assign({}, fold, rule)`, other rules pass through.
  - `buildToolRuntimes(blocks: RuntimeBlockInput[]): ToolRuntimeRegistry`.
  - `BUILT_IN_RUNTIME_PARTS: Record<string, Pick<RuntimeBlockInput, 'normalize' | 'defaultChildren' | 'actions'>>` in `index.ts`. Later tasks add their entries here.
  - `BUILT_IN_TOOL_RUNTIMES: ToolRuntimeRegistry` in `index.ts`: every key of `BUILT_IN_BLOCK_SANITIZE`, with the default config's inline tools: all ten `BUILT_IN_INLINE_SANITIZE` entries, except `code`, which has `inlineToolbar: false` (`src/tools/index.ts:98`) and gets none.
- The global `sanitizer` config is NOT folded in. It stays a separate argument to 01's sanitize port, exactly as `sanitizeToolData` passes `this.config.sanitizer` separately to `sanitizeBlocks` (`src/components/modules/api/blocks.ts:995-1002`).

- [ ] **Step 1: Write the test helper**

`test/unit/shared/tool-descriptions/built-in-tools.ts`:

```ts
import {
  Audio, Bold, Bookmark, Callout, ClearFormat, Code, Column, ColumnList, Database, DatabaseRow, Divider, Embed, Equation,
  File as FileTool, Header, Image as ImageTool, InlineCode, Italic, Link, List, Marker, Page, PageLink, Paragraph, Quote,
  Spacer, Strikethrough, SupSub, Table, TableOfContents, TabTool, TabsTool, Toggle, Underline, Video, defaultBlockTools, defaultInlineTools,
} from '../../../../src/tools';

import type { BlokConfig, ToolConstructable } from '../../../../types';

export const BLOCK_CLASSES: Record<string, ToolConstructable> = {
  paragraph: Paragraph, header: Header, list: List, table: Table, toggle: Toggle, callout: Callout, database: Database,
  'database-row': DatabaseRow, divider: Divider, spacer: Spacer, table_of_contents: TableOfContents, quote: Quote, code: Code,
  image: ImageTool, file: FileTool, audio: Audio, video: Video, column_list: ColumnList, column: Column, tabs: TabsTool,
  tab: TabTool, embed: Embed, bookmark: Bookmark, page: Page, 'page-link': PageLink,
} as unknown as Record<string, ToolConstructable>;

export const INLINE_CLASSES: Record<string, ToolConstructable> = {
  marker: Marker, bold: Bold, italic: Italic, underline: Underline, clearFormat: ClearFormat, link: Link,
  strikethrough: Strikethrough, inlineCode: InlineCode, equation: Equation, supSub: SupSub,
} as unknown as Record<string, ToolConstructable>;

/** The default editor registry: defaultBlockTools + page + page-link + defaultInlineTools, each with its default settings. */
export const builtInEditorTools = (): NonNullable<BlokConfig['tools']> => ({
  ...Object.fromEntries(Object.entries(defaultBlockTools).map(([name, settings]) => [name, { class: BLOCK_CLASSES[name], ...settings }])),
  page: { class: BLOCK_CLASSES.page },
  'page-link': { class: BLOCK_CLASSES['page-link'] },
  ...Object.fromEntries(Object.keys(defaultInlineTools).map(name => [name, { class: INLINE_CLASSES[name] }])),
}) as NonNullable<BlokConfig['tools']>;
```

- [ ] **Step 2: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { buildToolRuntimes, composeToolSanitize } from '../../../../src/shared/tool-actions/runtime';
import { builtInEditorTools } from '../tool-descriptions/built-in-tools';

const shape = (config: unknown): unknown =>
  JSON.parse(JSON.stringify(config, (_key, value: unknown) => (typeof value === 'function' ? `[fn ${(value as { name: string }).name}]` : value)));

describe('composeToolSanitize', () => {
  it('folds inline rules into object field rules and passes other rules through', () => {
    const composed = composeToolSanitize({ text: { p: true }, level: false }, [{ b: {} }, { a: { href: true } }]);

    expect(composed).toEqual({ text: { b: {}, a: { href: true }, p: true }, level: false });
  });

  it('uses the inline fold when the tool has no rules', () => {
    expect(composeToolSanitize({}, [{ b: {} }])).toEqual({ b: {} });
  });

  it('builds a registry keyed by name', () => {
    const registry = buildToolRuntimes([{ name: 'x', ownSanitize: {}, inlineSanitize: [] }]);

    expect(registry.get('x')).toEqual({ name: 'x', sanitize: {}, actions: {} });
  });
});

describe('BUILT_IN_TOOL_RUNTIMES', () => {
  let holder: HTMLDivElement;
  let core: Core | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    holder.remove();
    core = undefined;
  });

  it('matches the editor sanitize config of every built-in block tool', async () => {
    core = new Core({ holder, tools: builtInEditorTools() });
    await core.isReady;

    const adapters = core.moduleInstances.Tools.blockTools;

    [...BUILT_IN_TOOL_RUNTIMES.keys()].forEach((name) => {
      expect(shape(BUILT_IN_TOOL_RUNTIMES.get(name)?.sanitize), name).toEqual(shape(adapters.get(name)?.sanitizeConfig));
    });
  }, 60_000);
});
```

Copy the `destroyCore` helper from `test/unit/shared/sanitize-schema.test.ts:28-66` into this file and call it in `afterEach` when `core` is set, so the booted Core does not leak listeners.

Run: `yarn test test/unit/shared/tool-actions/runtime.test.ts`
Expected: FAIL, unresolved `src/shared/tool-actions`.

- [ ] **Step 3: Implement `runtime.ts`**

```ts
import type { SanitizerConfig } from '../../../types';
import type { InsertSpec } from '../../../types/agent';
import type { ToolActionImpl } from '../../../types/tools/tool-description';

/** Code side of a tool for the agent planner. Never serialized in v1. */
export interface ToolRuntime {
  name: string;
  sanitize: SanitizerConfig;
  normalize?(data: Record<string, unknown>): Record<string, unknown>;
  defaultChildren?: InsertSpec[];
  actions: Readonly<Record<string, ToolActionImpl>>;
}

export type ToolRuntimeRegistry = ReadonlyMap<string, ToolRuntime>;

export interface RuntimeBlockInput {
  name: string;
  ownSanitize: SanitizerConfig;
  /** Enabled inline tools then tunes, in registration order. Later wins per tag. */
  inlineSanitize: SanitizerConfig[];
  normalize?: ToolRuntime['normalize'];
  defaultChildren?: InsertSpec[];
  actions?: Readonly<Record<string, ToolActionImpl>>;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as unknown;

  return proto === null || proto === Object.prototype;
};

// Mirrors BlockToolAdapter.sanitizeConfig (src/components/tools/block.ts:562-617). The runtime test pins the two together.
export const composeToolSanitize = (own: SanitizerConfig, inline: SanitizerConfig[]): SanitizerConfig => {
  const base = {} as SanitizerConfig;

  inline.forEach(config => Object.assign(base, config));

  if (Object.keys(own).length === 0) {
    return base;
  }

  return Object.fromEntries(Object.entries(own).map(([field, rule]) =>
    [field, isPlainObject(rule) ? Object.assign({}, base, rule) : rule])) as SanitizerConfig;
};

export const buildToolRuntimes = (blocks: RuntimeBlockInput[]): ToolRuntimeRegistry => new Map(blocks.map(block => [block.name, {
  name: block.name,
  sanitize: composeToolSanitize(block.ownSanitize, block.inlineSanitize),
  ...(block.normalize === undefined ? {} : { normalize: block.normalize }),
  ...(block.defaultChildren === undefined ? {} : { defaultChildren: block.defaultChildren }),
  actions: block.actions ?? {},
}]));
```

`src/shared/tool-actions/index.ts`:

```ts
import { BUILT_IN_BLOCK_SANITIZE } from '../tool-descriptions/sanitize/blocks';
import { BUILT_IN_INLINE_SANITIZE } from '../tool-descriptions/sanitize/inline';
import { buildToolRuntimes } from './runtime';
import type { RuntimeBlockInput, ToolRuntimeRegistry } from './runtime';

/** Per-tool code that is not sanitize: normalize, defaultChildren, action handlers. Filled by later tasks. */
export const BUILT_IN_RUNTIME_PARTS: Readonly<Record<string, Pick<RuntimeBlockInput, 'normalize' | 'defaultChildren' | 'actions'>>> = {};

// defaultBlockTools gives code `inlineToolbar: false` (src/tools/index.ts:98).
const NO_INLINE_TOOLS = new Set(['code']);

export const BUILT_IN_TOOL_RUNTIMES: ToolRuntimeRegistry = buildToolRuntimes(Object.entries(BUILT_IN_BLOCK_SANITIZE).map(([name, own]) => ({
  name,
  ownSanitize: own(),
  inlineSanitize: NO_INLINE_TOOLS.has(name) ? [] : Object.values(BUILT_IN_INLINE_SANITIZE).map(factory => factory()),
  ...BUILT_IN_RUNTIME_PARTS[name],
})));

export { buildToolRuntimes } from './runtime';
export type { ToolRuntime, ToolRuntimeRegistry, RuntimeBlockInput } from './runtime';
```

If Task 15 is already on `main`, also do its Step 2b here (register `table: { normalize: normalizeTable }`) and turn on its last test case.

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test test/unit/shared/tool-actions/runtime.test.ts`
Expected: PASS. If the parity case fails, the printed diff names the tool and the key. The likely cause is inline-tool ORDER (later wins per tag) or an internal inline tool (`convertTo`, `src/components/modules/tools.ts:336-339`) contributing rules. Fix the order in `index.ts` to match what the adapter shows; do not change the adapter.

- [ ] **Step 5: Commit**

```bash
npx eslint src/shared/tool-actions/runtime.ts src/shared/tool-actions/index.ts test/unit/shared/tool-actions/runtime.test.ts test/unit/shared/tool-descriptions/built-in-tools.ts
git add src/shared/tool-actions/runtime.ts src/shared/tool-actions/index.ts test/unit/shared/tool-actions/runtime.test.ts test/unit/shared/tool-descriptions/built-in-tools.ts
git commit -m "feat(shared): ToolRuntime registry with editor-equal sanitize composition

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 14: A Jint-safe id minter and shared table ids

**Files:**
- Create: `src/shared/mint-id.ts`, `src/shared/table/table-ids.ts`
- Move: `src/tools/table/types.ts` → `src/shared/table/types.ts` (old path re-exports `*`)
- Modify: `src/tools/table/table-ids.ts` (delegate to the shared module, keep `nanoid` for the editor)
- Test: `test/unit/shared/mint-id.test.ts`, `test/unit/shared/table/table-ids.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `mintId(length?: number): string` (default 10). URL-safe alphabet, the same 64 characters as nanoid's `urlAlphabet`. Uses `globalThis.crypto.getRandomValues` when present, else `Math.random`. No typed arrays on the fallback path.
  - `alignRowsToColumns(grid: CellContent[][]): CellContent[][]` (moved verbatim from `src/tools/table/table-ids.ts:58-78`).
  - `ensureTableIdsWith(grid: CellContent[][], mint: () => string): CellContent[][]` (from `ensureTableIds`, `:85-96`, with `generateTableId` replaced by `mint`).
  - `src/tools/table/table-ids.ts` keeps `generateTableId` (nanoid, unchanged RNG for the editor) and `ensureTableIds = (grid) => ensureTableIdsWith(grid, generateTableId)`, and re-exports `alignRowsToColumns`.

- [ ] **Step 1: Write the failing tests**

`test/unit/shared/mint-id.test.ts`:

```ts
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mintId } from '../../../src/shared/mint-id';

describe('mintId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('makes a url-safe id of the asked length', () => {
    expect(mintId()).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(mintId(12)).toHaveLength(12);
  });

  // The Jint realm has no crypto (test/unit/scripts/build-server-runtime.test.ts runs a globals-free realm).
  it('works when crypto is missing', () => {
    vi.stubGlobal('crypto', undefined);

    expect(mintId()).toMatch(/^[A-Za-z0-9_-]{10}$/);
  });

  it('does not repeat in a small sample', () => {
    expect(new Set(Array.from({ length: 200 }, () => mintId())).size).toBe(200);
  });
});
```

`test/unit/shared/table/table-ids.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { ensureTableIdsWith } from '../../../../src/shared/table/table-ids';
import { ensureTableIds } from '../../../../src/tools/table/table-ids';

const counter = (): (() => string) => {
  let n = 0;

  return () => {
    n += 1;

    return `id${n}`;
  };
};

describe('ensureTableIdsWith', () => {
  it('mints missing ids with the given minter and keeps existing unique ones', () => {
    const grid = ensureTableIdsWith([[{ blocks: [], id: 'c1' }, { blocks: [] }], [{ blocks: [] }, { blocks: [] }]], counter());

    expect(grid.map(row => row.map(cell => cell.id))).toEqual([['c1', 'id1'], ['c1', 'id1']]);
    expect(new Set(grid.map(row => row[0].rowId)).size).toBe(2);
  });

  it('the editor wrapper still mints with nanoid-shaped ids', () => {
    expect(ensureTableIds([[{ blocks: [] }]])[0][0].id).toMatch(/^[A-Za-z0-9_-]{10}$/);
  });
});
```

Run: `yarn test test/unit/shared/mint-id.test.ts` → FAIL (unresolved). Run: `yarn test test/unit/shared/table/table-ids.test.ts` → FAIL (unresolved).

- [ ] **Step 2: Implement**

`src/shared/mint-id.ts`:

```ts
// nanoid's urlAlphabet: ids minted here and by nanoid look the same.
const ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';

type CryptoLike = { getRandomValues?(array: Uint8Array): Uint8Array };

/**
 * A random id that also works in the C# Jint runtime, which has no `crypto`.
 * Random, never positional: peers mint without coordinating.
 */
export const mintId = (length = 10): string => {
  const cryptoApi = (globalThis as { crypto?: CryptoLike }).crypto;

  if (typeof cryptoApi?.getRandomValues === 'function') {
    return Array.from(cryptoApi.getRandomValues(new Uint8Array(length)), byte => ALPHABET[byte & 63]).join('');
  }

  return Array.from({ length }, () => ALPHABET[Math.floor(Math.random() * 64)]).join('');
};
```

`git mv src/tools/table/types.ts src/shared/table/types.ts`, fix its one import (`'../../../types'` → `'../../../types'` stays correct at the new depth? `src/shared/table/` is also three levels deep, so `../../../types` still resolves; confirm with tsc), then recreate `src/tools/table/types.ts` as:

```ts
export * from '../../shared/table/types';
```

`src/shared/table/table-ids.ts`: move `isId`, `resolveIds` (taking `mint`), `columnIdsOf`, `alignRowsToColumns` verbatim from `src/tools/table/table-ids.ts:12-78`, and:

```ts
/**
 * The grid with a stable id on every row and column: each cell carries its
 * column's id as `id` and its row's id as `rowId`. Missing ids are minted; an
 * id an earlier row or column already uses is replaced.
 */
export const ensureTableIdsWith = (grid: CellContent[][], mint: () => string): CellContent[][] => {
  const cols = grid.reduce((max, row) => Math.max(max, row.length), 0);
  const columnIds = resolveIds(Array.from({ length: cols }, (_, col) => grid.map(row => row[col]?.id)), mint);
  const rowIds = resolveIds(grid.map(row => row.map(cell => cell.rowId)), mint);

  return grid.map((row, rowIndex) => row.map((cell, col) => ({ ...cell, id: columnIds[col], rowId: rowIds[rowIndex] })));
};
```

In `src/tools/table/table-ids.ts`, delete the moved code and add:

```ts
import { alignRowsToColumns, ensureTableIdsWith } from '../../shared/table/table-ids';

export { alignRowsToColumns };

export const ensureTableIds = (grid: CellContent[][]): CellContent[][] => ensureTableIdsWith(grid, generateTableId);
```

- [ ] **Step 3: Run the tests**

Run, one at a time: `yarn test test/unit/shared/mint-id.test.ts`, `yarn test test/unit/shared/table/table-ids.test.ts`, `yarn test test/unit/tools/concurrent-table-ids.test.ts`, `yarn test test/unit/tools/table/table-model.test.ts`.
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
npx eslint src/shared/mint-id.ts src/shared/table/table-ids.ts src/shared/table/types.ts src/tools/table/types.ts src/tools/table/table-ids.ts test/unit/shared/mint-id.test.ts test/unit/shared/table/table-ids.test.ts
git add src/shared/mint-id.ts src/shared/table/table-ids.ts src/shared/table/types.ts src/tools/table/types.ts src/tools/table/table-ids.ts test/unit/shared/mint-id.test.ts test/unit/shared/table/table-ids.test.ts
git commit -m "refactor(table): table ids and types in src/shared with an injectable minter

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 15: Table `normalize` (live-mode blocker)

**Gate:** none. `normalizeTable` needs only Task 14, so it ships early even while Task 12/13 wait on 01. Its registration in the runtime (Step 2b) needs Task 13; if Task 13 is not on `main` yet, skip Step 2b, the last test case and its `BUILT_IN_TOOL_RUNTIMES` import, and leave `src/shared/tool-actions/index.ts` out of the commit. Task 13 adds them.

**Files:**
- Create: `src/shared/tool-actions/table.ts` (starts with `normalizeTable`; actions join in Phase 4)
- Modify: `src/shared/tool-actions/index.ts` (`BUILT_IN_RUNTIME_PARTS.table`)
- Test: `test/unit/shared/tool-actions/table-normalize.test.ts`

**Interfaces:**
- Consumes: `alignRowsToColumns`, `ensureTableIdsWith` (Task 14), `isCellWithBlocks` (`src/shared/table/types.ts`), `mintId` (Task 14).
- Produces: `normalizeTable(data: Record<string, unknown>, mint?: () => string): Record<string, unknown>`, registered as `BUILT_IN_TOOL_RUNTIMES.get('table').normalize`. It fills `id` / `rowId` on rows whose cells are all objects, after aligning id-carrying rows. Rows holding a legacy string cell stay exactly as they are (the same filter `normalizeTableData`'s `alignIdCarryingRows` uses, `src/tools/table/table-operations.ts:640-646`). Idempotent. It does not pad ragged rows or repair merges; whether the parity corpus needs that is **unverified** (05's `TOOL_MINTED` list, 05 Task 6, will show it).

- [ ] **Step 1: Write the failing tests**

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { normalizeTable } from '../../../../src/shared/tool-actions/table';

const mint = (): (() => string) => {
  let n = 0;

  return () => {
    n += 1;

    return `m${n}`;
  };
};

describe('normalizeTable', () => {
  it('fills row and column ids on object cells', () => {
    const out = normalizeTable({ withHeadings: false, content: [[{ blocks: ['a'] }, { blocks: ['b'] }]] }, mint());

    expect(out.content).toEqual([[{ blocks: ['a'], id: 'm1', rowId: 'm3' }, { blocks: ['b'], id: 'm2', rowId: 'm3' }]]);
    expect(out.withHeadings).toBe(false);
  });

  it('leaves rows holding legacy string cells untouched', () => {
    const legacy = ['plain', 'text'];
    const out = normalizeTable({ content: [legacy, [{ blocks: [] }, { blocks: [] }]] }, mint());
    const [first, second] = out.content as unknown[][];

    expect(first).toBe(legacy);
    expect(second.every(cell => typeof (cell as { id?: string }).id === 'string')).toBe(true);
  });

  it('is idempotent', () => {
    const once = normalizeTable({ content: [[{ blocks: [] }], [{ blocks: [] }]] }, mint());

    expect(normalizeTable(once, mint())).toEqual(once);
  });

  it('passes data without content through', () => {
    const data = { withHeadings: true };

    expect(normalizeTable(data)).toBe(data);
  });

  it('is the table runtime normalize', () => {
    expect(BUILT_IN_TOOL_RUNTIMES.get('table')?.normalize).toBe(normalizeTable);
  });
});
```

Run: `yarn test test/unit/shared/tool-actions/table-normalize.test.ts`
Expected: FAIL, unresolved `src/shared/tool-actions/table`.

- [ ] **Step 2: Implement**

`src/shared/tool-actions/table.ts`:

```ts
import { mintId } from '../mint-id';
import { alignRowsToColumns, ensureTableIdsWith } from '../table/table-ids';
import { isCellWithBlocks } from '../table/types';
import type { CellContent } from '../table/types';

const isObjectRow = (row: unknown): row is CellContent[] =>
  Array.isArray(row) && row.every(cell => typeof cell === 'object' && cell !== null && isCellWithBlocks(cell as CellContent));

/**
 * Table data as a browser would have completed it on load: every object cell
 * carries its row and column id. A headless author must write this itself,
 * because no browser writes normalised data back for a peer's block (06 C17).
 * Rows with legacy string cells stay positional and untouched.
 */
export const normalizeTable = (data: Record<string, unknown>, mint: () => string = () => mintId(10)): Record<string, unknown> => {
  if (!Array.isArray(data.content)) {
    return data;
  }

  const rows = data.content as unknown[];
  const fixed = ensureTableIdsWith(alignRowsToColumns(rows.filter(isObjectRow)), mint).values();

  return { ...data, content: rows.map(row => (isObjectRow(row) ? fixed.next().value ?? row : row)) };
};
```

Step 2b (needs Task 13). In `src/shared/tool-actions/index.ts`:

```ts
import { normalizeTable } from './table';

export const BUILT_IN_RUNTIME_PARTS: Readonly<Record<string, Pick<RuntimeBlockInput, 'normalize' | 'defaultChildren' | 'actions'>>> = {
  table: { normalize: normalizeTable },
};
```

`ToolRuntime.normalize` is typed `(data) => data`; `normalizeTable`'s second parameter is optional, so it fits. 01 may pass `ctx.newId` as the second argument; tell 01 in the checkpoint note.

- [ ] **Step 3: Run the tests**

Run: `yarn test test/unit/shared/tool-actions/table-normalize.test.ts` → PASS.
Run: `yarn test test/unit/shared/tool-actions/runtime.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
npx eslint src/shared/tool-actions/table.ts src/shared/tool-actions/index.ts test/unit/shared/tool-actions/table-normalize.test.ts
git add src/shared/tool-actions/table.ts src/shared/tool-actions/index.ts test/unit/shared/tool-actions/table-normalize.test.ts
git commit -m "feat(table): pure normalize fills row and column ids for headless authors

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Checkpoint 2

- [ ] Run, one at a time, every test file created or touched in Tasks 8-15. All PASS.
- [ ] `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` (timeout 600000) PASS.
- [ ] `git pull --rebase && git push`; `git status` up to date.
- [ ] Tell 01 and 04: `BUILT_IN_TOOL_RUNTIMES`, `buildToolRuntimes`, `composeToolSanitize` and table `normalize` (`normalizeTable(data, mint?)`) are on `main`. 01 should pass `() => ctx.newId()` as `mint` in Jint.

---
## Phase 3: Descriptions

Each built-in block tool gets `src/shared/tool-descriptions/<tool>.ts` with a `<TOOL>_DATA` literal and a `describe<Tool>(config)` function. The `$defs` entry in `src/view/document-schema.ts` becomes `describe<Tool>().data`, and the tool class gets `public static describe = describe<Tool>;`. The Task 1 byte pin must stay green in every task of this phase except Task 23.

**How to move a `$defs` literal.** Cut the object literal under the tool's key in `$defs` (e.g. `header: { … },`) and paste it as the value of `<TOOL>_DATA`, unchanged. Keep key order. Keep `richText('…')` calls as they are; they now import from `./rich-text`. Then write `header: describeHeader().data,` in its place. The byte pin proves nothing moved.

**Guidance text rules.** English, short sentences, no Markdown syntax inside the strings except backticks around field names. Every rich-text tool's guidance names the segment shape and says Markdown goes through `markdown.insert`.

### Task 16: Description scaffolding and paragraph

**Files:**
- Create: `src/shared/tool-descriptions/paragraph.ts`, `src/shared/tool-descriptions/index.ts`
- Create (if Task 13 has not made it yet): `test/unit/shared/tool-descriptions/built-in-tools.ts`, exactly as in Task 13 Step 1
- Modify: `src/view/document-schema.ts` (`paragraph` def), `src/tools/paragraph/index.ts` (static)
- Test: `test/unit/shared/tool-descriptions/descriptions.test.ts`

**Interfaces:**
- Consumes: `richText` (Task 4), `validateAgainst` (Task 2), `BlockToolDescription` (Task 3).
- Produces:
  - `PARAGRAPH_DATA`, `describeParagraph(config?: Record<string, unknown>): BlockToolDescription`.
  - `BUILT_IN_BLOCK_DESCRIPTIONS: Readonly<Record<string, (config?: Record<string, unknown>) => BlockToolDescription>>`. Tasks 17-22 add one entry per tool. The Node manifest is built from it, through `buildBuiltInSnapshot` (Task 27) and 01's `createHeadlessAgentSetup` (01 Task 21), which 04 and 05 call.
  - `COLOR_PRESET_NAMES` text constant for guidance: `gray, brown, orange, yellow, green, blue, purple, pink, red` (`src/components/shared/color-presets.ts:15-23`, copied as a string; a test pins it).
- The generic test iterates the registry, so every later tool task gets these checks for free: `$defs` equality, JSON round trip, the class static, `defaultData` and `examples` validate.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { COLOR_PRESETS } from '../../../../src/components/shared/color-presets';
import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_BLOCK_DESCRIPTIONS, COLOR_PRESET_NAMES } from '../../../../src/shared/tool-descriptions';
import { blokDocumentSchema } from '../../../../src/view/document-schema';
import { BLOCK_CLASSES } from './built-in-tools';

const defs = (blokDocumentSchema as unknown as { $defs: Record<string, unknown> }).$defs;

describe('built-in block descriptions', () => {
  const names = Object.keys(BUILT_IN_BLOCK_DESCRIPTIONS);

  it('has at least one entry', () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it.each(names)('%s: describe({}).data is the published $defs entry', (name) => {
    expect(BUILT_IN_BLOCK_DESCRIPTIONS[name]({}).data).toEqual(defs[name]);
  });

  it.each(names)('%s: survives a JSON round trip', (name) => {
    const description = BUILT_IN_BLOCK_DESCRIPTIONS[name]({});

    expect(JSON.parse(JSON.stringify(description))).toEqual(description);
  });

  it.each(names)('%s: the tool class points its describe static at the shared function', (name) => {
    expect((BLOCK_CLASSES[name] as { describe?: unknown }).describe).toBe(BUILT_IN_BLOCK_DESCRIPTIONS[name]);
  });

  it.each(names)('%s: defaultData and examples are valid data', (name) => {
    const { data, defaultData, examples = [] } = BUILT_IN_BLOCK_DESCRIPTIONS[name]({});

    [defaultData, ...examples].filter(sample => sample !== undefined).forEach(sample => expect(validateAgainst(data, sample)).toEqual([]));
  });

  it('names the colour presets the picker offers', () => {
    expect(COLOR_PRESET_NAMES).toBe(COLOR_PRESETS.map(preset => preset.name).join(', '));
  });
});
```

Read `src/components/shared/color-presets.ts:15-23` first: if a preset's key is not `name`, use the real key in the last assertion.

Run: `yarn test test/unit/shared/tool-descriptions/descriptions.test.ts`
Expected: FAIL, unresolved `src/shared/tool-descriptions`.

- [ ] **Step 2: Write `paragraph.ts`**

```ts
import type { BlockToolDescription } from '../../../types/tools/tool-description';
import { richText } from './rich-text';

export const COLOR_PRESET_NAMES = 'gray, brown, orange, yellow, green, blue, purple, pink, red';

export const RICH_TEXT_GUIDANCE = 'Rich-text fields take segments: [{ "text": "…", "marks": { "bold": true } }]. Never write Markdown into them; use markdown.insert to import Markdown.';

export const PARAGRAPH_DATA = /* the `paragraph` $defs literal, moved verbatim */ {
  type: 'object',
  description: 'A line of rich text.',
  required: ['text'],
  additionalProperties: false,
  properties: {
    text: richText('The line\'s rich text.'),
    textColor: { type: 'string', description: 'Text color preset name, e.g. "red".' },
    backgroundColor: { type: 'string', description: 'Background color preset name.' },
  },
};

export const describeParagraph = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A paragraph of rich text. The default block.',
  guidance: `${RICH_TEXT_GUIDANCE} textColor and backgroundColor take a preset name: ${COLOR_PRESET_NAMES}.`,
  data: PARAGRAPH_DATA,
  defaultData: { text: [] },
  examples: [{ text: [{ text: 'Ship it ' }, { text: 'today', marks: { bold: true } }] }],
});
```

Remove the `/* … */` comment when pasting; it marks where the literal comes from.

`index.ts`:

```ts
import type { BlockToolDescription } from '../../../types/tools/tool-description';
import { describeParagraph } from './paragraph';

export { COLOR_PRESET_NAMES, RICH_TEXT_GUIDANCE } from './paragraph';

/** One describe function per built-in block tool, keyed by registry key. */
export const BUILT_IN_BLOCK_DESCRIPTIONS: Readonly<Record<string, (config?: Record<string, unknown>) => BlockToolDescription>> = {
  paragraph: describeParagraph,
};
```

In `document-schema.ts`, replace the `paragraph:` def with `paragraph: describeParagraph().data,` and import `describeParagraph` from `'../shared/tool-descriptions/paragraph'`. In `src/tools/paragraph/index.ts`, add inside the class `public static describe = describeParagraph;` with the import.

- [ ] **Step 3: Run the tests**

Run: `yarn test test/unit/shared/tool-descriptions/descriptions.test.ts` → PASS.
Run: `yarn test test/unit/view/document-schema.test.ts` → PASS (byte pin holds).

- [ ] **Step 4: Commit**

```bash
npx eslint src/shared/tool-descriptions/paragraph.ts src/shared/tool-descriptions/index.ts src/view/document-schema.ts src/tools/paragraph/index.ts test/unit/shared/tool-descriptions/descriptions.test.ts test/unit/shared/tool-descriptions/built-in-tools.ts
git add src/shared/tool-descriptions/paragraph.ts src/shared/tool-descriptions/index.ts src/view/document-schema.ts src/tools/paragraph/index.ts test/unit/shared/tool-descriptions/descriptions.test.ts test/unit/shared/tool-descriptions/built-in-tools.ts
git commit -m "feat(paragraph): self-description; blokDocumentSchema reads it

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 17: Header and list, with config narrowing

**Files:**
- Create: `src/shared/tool-descriptions/header.ts`, `list.ts`
- Modify: `src/shared/tool-descriptions/index.ts`, `src/view/document-schema.ts` (`header`, `list`), `src/tools/header/index.ts`, `src/tools/list/index.ts` (statics)
- Test: `test/unit/shared/tool-descriptions/narrowing.test.ts`

**Interfaces:**
- Consumes: Task 16.
- Produces: `HEADER_DATA`, `describeHeader(config)`, `LIST_DATA`, `describeList(config)`.
  - Header: `levels` (array of 1..6) narrows `level` to `{ type: 'integer', enum: levels }`; an empty or missing list does not narrow (Review Focus 2). `guardedFields: { isToggleable: 'block.convert' }` (06 02-Q3: turning a toggle heading off releases its children, `src/components/utils/turn-into-children.ts:25-39`). `viewState: ['isOpen']`. `summaryFields: ['level', 'isToggleable']`. `defaultData: { text: [], level }` where `level` is `config.defaultLevel` when it is in the allowed levels, else the second allowed level, else the first, else 2 (the tool defaults to `levels[1]`, `src/tools/header/index.ts:1323-1331`).
  - List: `styles` (array of `unordered | ordered | checklist`) narrows `style`; empty does not narrow. `summaryFields: ['style', 'checked', 'start']`. `defaultData: { text: [], style }` with `style` = `config.defaultStyle` when allowed, else `'unordered'` (`src/tools/list/data-normalizer.ts:115`) when allowed, else the first allowed style.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { validateAgainst } from '../../../../src/shared/schema/validate';
import { describeHeader } from '../../../../src/shared/tool-descriptions/header';
import { describeList } from '../../../../src/shared/tool-descriptions/list';

describe('config narrowing', () => {
  it('header levels [1, 2] rejects level 3', () => {
    const { data, defaultData } = describeHeader({ levels: [1, 2] });

    expect(validateAgainst(data, { text: [], level: 3 }).length).toBeGreaterThan(0);
    expect(validateAgainst(data, { text: [], level: 2 })).toEqual([]);
    expect(defaultData).toEqual({ text: [], level: 2 });
  });

  it('header levels [] is no restriction, like the toolbox', () => {
    expect(describeHeader({ levels: [] }).data).toEqual(describeHeader({}).data);
  });

  it('header guards isToggleable and hides isOpen', () => {
    const description = describeHeader({});

    expect(description.guardedFields).toEqual({ isToggleable: 'block.convert' });
    expect(description.viewState).toEqual(['isOpen']);
  });

  it('header defaultLevel wins when allowed', () => {
    expect(describeHeader({ levels: [1, 2, 3], defaultLevel: 3 }).defaultData).toEqual({ text: [], level: 3 });
  });

  it('list styles narrows style; [] does not', () => {
    const { data, defaultData } = describeList({ styles: ['checklist'] });

    expect(validateAgainst(data, { text: [], style: 'ordered' }).length).toBeGreaterThan(0);
    expect(defaultData).toEqual({ text: [], style: 'checklist' });
    expect(describeList({ styles: [] }).data).toEqual(describeList({}).data);
  });
});
```

Run: `yarn test test/unit/shared/tool-descriptions/narrowing.test.ts`
Expected: FAIL, unresolved `header`.

- [ ] **Step 2: Write `header.ts`**

```ts
import type { BlockToolDescription } from '../../../types/tools/tool-description';
import { COLOR_PRESET_NAMES, RICH_TEXT_GUIDANCE } from './paragraph';
import { richText } from './rich-text';

export const HEADER_DATA = /* the `header` $defs literal, moved verbatim */ {};

const readLevels = (config: Record<string, unknown>): number[] => (Array.isArray(config.levels)
  ? config.levels.filter((level): level is number => Number.isInteger(level) && level >= 1 && level <= 6)
  : []);

export const describeHeader = (config: Record<string, unknown> = {}): BlockToolDescription => {
  const levels = readLevels(config);
  const allowed = levels.length > 0 ? levels : [1, 2, 3, 4, 5, 6];
  const preferred = typeof config.defaultLevel === 'number' && allowed.includes(config.defaultLevel) ? config.defaultLevel : undefined;
  const level = preferred ?? allowed[1] ?? allowed[0];

  return {
    summary: 'A heading. With isToggleable it collapses and owns the blocks nested under it.',
    guidance: `${RICH_TEXT_GUIDANCE} Turn a heading into a toggle heading, or back, with block.convert, never by writing isToggleable: turning it off must release its children. textColor and backgroundColor take a preset name: ${COLOR_PRESET_NAMES}.`,
    data: levels.length === 0
      ? HEADER_DATA
      : { ...HEADER_DATA, properties: { ...HEADER_DATA.properties, level: { type: 'integer', enum: levels } } },
    defaultData: { text: [], level },
    examples: [{ text: [{ text: 'Roadmap' }], level: 2 }],
    summaryFields: ['level', 'isToggleable'],
    viewState: ['isOpen'],
    guardedFields: { isToggleable: 'block.convert' },
  };
};
```

Paste the real literal in place of `{}`. Narrowed `data` spreads, so its key order differs from the unnarrowed one; only `describeHeader({})` feeds `blokDocumentSchema`.

`list.ts`:

```ts
import type { BlockToolDescription } from '../../../types/tools/tool-description';
import { RICH_TEXT_GUIDANCE } from './paragraph';
import { richText } from './rich-text';

export const LIST_DATA = /* the `list` $defs literal, moved verbatim */ {};

const STYLES = ['unordered', 'ordered', 'checklist'];

export const describeList = (config: Record<string, unknown> = {}): BlockToolDescription => {
  const styles = Array.isArray(config.styles) ? config.styles.filter((style): style is string => STYLES.includes(style)) : [];
  const allowed = styles.length > 0 ? styles : STYLES;
  const preferred = typeof config.defaultStyle === 'string' && allowed.includes(config.defaultStyle) ? config.defaultStyle : undefined;
  const style = preferred ?? (allowed.includes('unordered') ? 'unordered' : allowed[0]);

  return {
    summary: 'One list item. A list is a run of sibling list blocks.',
    guidance: `${RICH_TEXT_GUIDANCE} Insert one list block per item. Nest an item by inserting it as a child of the item above; depth is derived from nesting and any written value is replaced on save. Set start only on the first item of an ordered run.`,
    data: styles.length === 0
      ? LIST_DATA
      : { ...LIST_DATA, properties: { ...LIST_DATA.properties, style: { type: 'string', enum: styles } } },
    defaultData: { text: [], style },
    examples: [{ text: [{ text: 'Buy milk' }], style: 'checklist', checked: false }],
    summaryFields: ['style', 'checked', 'start'],
  };
};
```

The `depth` sentence is from `src/tools/list/index.ts:703-709` ("derived from the tree on save", spec §2.6). Register both in `BUILT_IN_BLOCK_DESCRIPTIONS`, replace both `$defs` entries, and add `public static describe = describeHeader;` / `describeList` to `Header` and `ListItem`.

- [ ] **Step 3: Run the tests**

Run, one at a time: `yarn test test/unit/shared/tool-descriptions/narrowing.test.ts`, `yarn test test/unit/shared/tool-descriptions/descriptions.test.ts`, `yarn test test/unit/view/document-schema.test.ts`. All PASS.

- [ ] **Step 4: Commit**

```bash
npx eslint src/shared/tool-descriptions/header.ts src/shared/tool-descriptions/list.ts src/shared/tool-descriptions/index.ts src/view/document-schema.ts src/tools/header/index.ts src/tools/list/index.ts test/unit/shared/tool-descriptions/narrowing.test.ts
git add src/shared/tool-descriptions/header.ts src/shared/tool-descriptions/list.ts src/shared/tool-descriptions/index.ts src/view/document-schema.ts src/tools/header/index.ts src/tools/list/index.ts test/unit/shared/tool-descriptions/narrowing.test.ts
git commit -m "feat(header,list): self-descriptions narrowed by levels and styles

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 18: Toggle, callout, quote, code

**Files:**
- Create: `src/shared/tool-descriptions/toggle.ts`, `callout.ts`, `quote.ts`, `code.ts`
- Modify: `index.ts`, `document-schema.ts` (four defs), the four tool classes (`src/tools/toggle/index.ts`, `callout/index.ts`, `quote/index.ts`, `code/index.ts`), `src/shared/tool-actions/index.ts` (callout `defaultChildren`, needs Task 13)
- Test: `test/unit/shared/tool-descriptions/text-blocks.test.ts`

**Interfaces:**
- Produces: `describeToggle`, `describeCallout`, `describeQuote`, `describeCode` and their `*_DATA`.
  - Toggle: `viewState: ['isOpen']`. Guidance: body blocks are its children; open state is personal.
  - Callout: no rich text of its own (`$defs.callout` description). Guidance: write the body as child blocks. `defaultChildren: [{ type: 'paragraph', data: { text: [] } }]` in `BUILT_IN_RUNTIME_PARTS.callout`, because a created callout with no children seeds one body paragraph (`src/tools/callout/index.ts:297-308`).
  - Quote: `summaryFields: ['size']`.
  - Code: `summaryFields: ['language', 'filename']`. Guidance: `code` is raw text, never HTML or Markdown fences; `language` is a lowercase name such as `javascript` or `plain text` (default `plain text`, `src/tools/code/constants.ts:17`). `defaultData: { code: '', language: 'plain text' }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { BUILT_IN_BLOCK_DESCRIPTIONS } from '../../../../src/shared/tool-descriptions';

describe('text block descriptions', () => {
  it('registers toggle, callout, quote and code', () => {
    expect(Object.keys(BUILT_IN_BLOCK_DESCRIPTIONS)).toEqual(expect.arrayContaining(['toggle', 'callout', 'quote', 'code']));
  });

  it('toggle open state is view-state', () => {
    expect(BUILT_IN_BLOCK_DESCRIPTIONS.toggle({}).viewState).toEqual(['isOpen']);
  });

  it('code defaults to plain text and never takes HTML', () => {
    const code = BUILT_IN_BLOCK_DESCRIPTIONS.code({});

    expect(code.defaultData).toEqual({ code: '', language: 'plain text' });
    expect(code.guidance).toMatch(/raw text/);
  });

  it('a callout seeds one body paragraph', () => {
    expect(BUILT_IN_TOOL_RUNTIMES.get('callout')?.defaultChildren).toEqual([{ type: 'paragraph', data: { text: [] } }]);
  });
});
```

Run: `yarn test test/unit/shared/tool-descriptions/text-blocks.test.ts`
Expected: FAIL (`toggle` not registered).

- [ ] **Step 2: Write the four modules**

Follow the Task 16 pattern for each: `<TOOL>_DATA` = the `$defs` literal moved verbatim; `describe<Tool>` returns the fields listed under Interfaces. Example:

```ts
// src/shared/tool-descriptions/code.ts
import type { BlockToolDescription } from '../../../types/tools/tool-description';

export const CODE_DATA = /* the `code` $defs literal, moved verbatim */ {};

export const describeCode = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A code block with a language and an optional file name.',
  guidance: '`code` is raw text, never HTML and never a Markdown fence. language is a lowercase name such as "javascript" or "plain text".',
  data: CODE_DATA,
  defaultData: { code: '', language: 'plain text' },
  examples: [{ code: 'const a = 1;', language: 'javascript', filename: 'a.js' }],
  summaryFields: ['language', 'filename'],
});
```

```ts
// src/shared/tool-descriptions/toggle.ts
export const describeToggle = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A collapsible line. Its body is the blocks nested under it.',
  guidance: `${RICH_TEXT_GUIDANCE} Put the body in child blocks. Open or closed is per person and never saved.`,
  data: TOGGLE_DATA,
  defaultData: { text: [] },
  viewState: ['isOpen'],
});
```

```ts
// src/shared/tool-descriptions/callout.ts
export const describeCallout = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A highlighted panel with an emoji. Its body is child blocks.',
  guidance: `The panel holds no text itself: insert the body as child blocks. emoji is one emoji or "" to hide it. textColor and backgroundColor take a preset name (${COLOR_PRESET_NAMES}) or null.`,
  data: CALLOUT_DATA,
  defaultData: { emoji: '💡' },
  summaryFields: ['emoji'],
});
```

```ts
// src/shared/tool-descriptions/quote.ts
export const describeQuote = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A quotation.',
  guidance: `${RICH_TEXT_GUIDANCE} size is "default" or "large".`,
  data: QUOTE_DATA,
  defaultData: { text: [] },
  summaryFields: ['size'],
});
```

`'💡'` is `DEFAULT_EMOJI` (`src/tools/callout/constants.ts:28`). Register all four, replace the four defs, add the four statics. In `src/shared/tool-actions/index.ts`, add `callout: { defaultChildren: [{ type: 'paragraph', data: { text: [] } }] },` to `BUILT_IN_RUNTIME_PARTS` (skip this line and the last test case until Task 13 exists; add them then).

- [ ] **Step 3: Run the tests**

Run, one at a time: `yarn test test/unit/shared/tool-descriptions/text-blocks.test.ts`, `yarn test test/unit/shared/tool-descriptions/descriptions.test.ts`, `yarn test test/unit/view/document-schema.test.ts`. All PASS.

- [ ] **Step 4: Commit**

```bash
npx eslint src/shared/tool-descriptions/toggle.ts src/shared/tool-descriptions/callout.ts src/shared/tool-descriptions/quote.ts src/shared/tool-descriptions/code.ts src/shared/tool-descriptions/index.ts src/shared/tool-actions/index.ts src/view/document-schema.ts src/tools/toggle/index.ts src/tools/callout/index.ts src/tools/quote/index.ts src/tools/code/index.ts test/unit/shared/tool-descriptions/text-blocks.test.ts
git add src/shared/tool-descriptions/toggle.ts src/shared/tool-descriptions/callout.ts src/shared/tool-descriptions/quote.ts src/shared/tool-descriptions/code.ts src/shared/tool-descriptions/index.ts src/shared/tool-actions/index.ts src/view/document-schema.ts src/tools/toggle/index.ts src/tools/callout/index.ts src/tools/quote/index.ts src/tools/code/index.ts test/unit/shared/tool-descriptions/text-blocks.test.ts
git commit -m "feat(tools): self-descriptions for toggle, callout, quote and code

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 19: Divider, spacer, table of contents, columns and tabs

**Files:**
- Create: `src/shared/tool-descriptions/divider.ts`, `spacer.ts`, `table-of-contents.ts`, `column-list.ts`, `column.ts`, `tabs.ts`, `tab.ts`
- Modify: `index.ts`, `document-schema.ts` (seven defs), the seven tool classes (`src/tools/divider/index.ts`, `spacer/index.ts`, `table-of-contents/index.ts`, `column-list/index.ts`, `column/index.ts`, `tabs/index.ts`, `tab/index.ts`)
- Test: `test/unit/shared/tool-descriptions/layout-blocks.test.ts`

**Interfaces:**
- Produces: `describeDivider`, `describeSpacer`, `describeTableOfContents`, `describeColumnList`, `describeColumn`, `describeTabs`, `describeTab`. Registry keys: `divider`, `spacer`, `table_of_contents`, `column_list`, `column`, `tabs`, `tab`.
  - Spacer: `summaryFields: ['height']`, `defaultData: { height: 38 }`.
  - Column list: guidance says create with `column_list.create`; its toolbox seed `columnCount` is a transient render seed (`src/tools/column-list/index.ts:191-198`) and is not saved data, so the agent must not write it. `actions` arrive in Task 38.
  - Column: `summaryFields: ['widthRatio']`. Guidance: set widths on the list with `column_list.setWidths`.
  - Tabs: guidance says create with `tabs.create`; the open tab is not saved. Actions arrive in Task 39.
  - Tab: `summaryFields: ['title', 'icon']`, guidance: `title` is plain text, `icon` one emoji.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { validateAgainst } from '../../../../src/shared/schema/validate';
import { BUILT_IN_BLOCK_DESCRIPTIONS } from '../../../../src/shared/tool-descriptions';

describe('layout block descriptions', () => {
  it('registers the seven tools', () => {
    expect(Object.keys(BUILT_IN_BLOCK_DESCRIPTIONS)).toEqual(expect.arrayContaining(
      ['divider', 'spacer', 'table_of_contents', 'column_list', 'column', 'tabs', 'tab']
    ));
  });

  it('spacer height is clamped by the schema', () => {
    const { data } = BUILT_IN_BLOCK_DESCRIPTIONS.spacer({});

    expect(validateAgainst(data, { height: 20 }).length).toBeGreaterThan(0);
    expect(validateAgainst(data, { height: 38 })).toEqual([]);
  });

  it('column_list rejects the transient columnCount seed', () => {
    expect(validateAgainst(BUILT_IN_BLOCK_DESCRIPTIONS.column_list({}).data, { columnCount: 3 }).length).toBeGreaterThan(0);
    expect(BUILT_IN_BLOCK_DESCRIPTIONS.column_list({}).guidance).toMatch(/column_list\.create/);
  });
});
```

Run: `yarn test test/unit/shared/tool-descriptions/layout-blocks.test.ts`
Expected: FAIL.

- [ ] **Step 2: Write the seven modules**

Pattern as Task 16. The describe functions:

```ts
export const describeDivider = (): BlockToolDescription => ({
  summary: 'A horizontal rule.', data: DIVIDER_DATA, defaultData: {},
});

export const describeSpacer = (): BlockToolDescription => ({
  summary: 'Vertical whitespace.', guidance: 'height is pixels, 38 to 600.',
  data: SPACER_DATA, defaultData: { height: 38 }, summaryFields: ['height'],
});

export const describeTableOfContents = (): BlockToolDescription => ({
  summary: 'An outline of the page headings, read from the document each time.',
  guidance: `It stores no headings: add or edit header blocks instead. textColor and backgroundColor take a preset name: ${COLOR_PRESET_NAMES}.`,
  data: TABLE_OF_CONTENTS_DATA, defaultData: {},
});

export const describeColumnList = (): BlockToolDescription => ({
  summary: 'A row of columns. The columns are its children.',
  guidance: 'Create one with column_list.create, which makes the columns too. Move an existing block into a column with block.move. The toolbox columnCount value is not saved data; never write it.',
  data: COLUMN_LIST_DATA, defaultData: {},
});

export const describeColumn = (): BlockToolDescription => ({
  summary: 'One column of a column_list. Its content is its children.',
  guidance: 'Change widths with column_list.setWidths on the list, not by writing widthRatio on one column.',
  data: COLUMN_DATA, defaultData: {}, summaryFields: ['widthRatio'],
});

export const describeTabs = (): BlockToolDescription => ({
  summary: 'A set of tabs. Each tab is a child tab block.',
  guidance: 'Create one with tabs.create. Add and delete tabs with tabs.addTab and tabs.deleteTab. Which tab is open is per person and never saved.',
  data: TABS_DATA, defaultData: {},
});

export const describeTab = (): BlockToolDescription => ({
  summary: 'One tab of a tabs block. Its content is its children.',
  guidance: 'title is plain text, not HTML. icon is one emoji, or omit it.',
  data: TAB_DATA, defaultData: { title: '' }, summaryFields: ['title', 'icon'],
});
```

Each takes `(_config: Record<string, unknown> = {})` like Task 16. Register all seven, replace the seven defs, add the seven statics.

- [ ] **Step 3: Run the tests**

Run, one at a time: `yarn test test/unit/shared/tool-descriptions/layout-blocks.test.ts`, `yarn test test/unit/shared/tool-descriptions/descriptions.test.ts`, `yarn test test/unit/view/document-schema.test.ts`. All PASS.

- [ ] **Step 4: Commit**

```bash
npx eslint src/shared/tool-descriptions/divider.ts src/shared/tool-descriptions/spacer.ts src/shared/tool-descriptions/table-of-contents.ts src/shared/tool-descriptions/column-list.ts src/shared/tool-descriptions/column.ts src/shared/tool-descriptions/tabs.ts src/shared/tool-descriptions/tab.ts src/shared/tool-descriptions/index.ts src/view/document-schema.ts src/tools/divider/index.ts src/tools/spacer/index.ts src/tools/table-of-contents/index.ts src/tools/column-list/index.ts src/tools/column/index.ts src/tools/tabs/index.ts src/tools/tab/index.ts test/unit/shared/tool-descriptions/layout-blocks.test.ts
git add src/shared/tool-descriptions/divider.ts src/shared/tool-descriptions/spacer.ts src/shared/tool-descriptions/table-of-contents.ts src/shared/tool-descriptions/column-list.ts src/shared/tool-descriptions/column.ts src/shared/tool-descriptions/tabs.ts src/shared/tool-descriptions/tab.ts src/shared/tool-descriptions/index.ts src/view/document-schema.ts src/tools/divider/index.ts src/tools/spacer/index.ts src/tools/table-of-contents/index.ts src/tools/column-list/index.ts src/tools/column/index.ts src/tools/tabs/index.ts src/tools/tab/index.ts test/unit/shared/tool-descriptions/layout-blocks.test.ts
git commit -m "feat(tools): self-descriptions for layout and simple blocks

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 20: Image, video, audio, file

**Files:**
- Create: `src/shared/tool-descriptions/image.ts`, `video.ts`, `audio.ts`, `file.ts`
- Modify: `index.ts`, `document-schema.ts` (four defs), `src/tools/image/index.ts`, `video/index.ts`, `audio/index.ts`, `file/index.ts`
- Test: `test/unit/shared/tool-descriptions/media-blocks.test.ts`

**Interfaces:**
- Produces: `describeImage(config)`, `describeVideo`, `describeAudio`, `describeFile`.
  - Image: `filters` config narrows `filter`. Each entry is a preset name or `{ name }` (`types/tools/image.d.ts:333`, `ImageFilterDefinition.name`); `'none'` is dropped (it is saved as "omitted"). Missing `filters` → no narrowing. `filters: []` → `filter: { type: 'string', enum: [] }`: the Filters tab is hidden (`types/tools/image.d.ts:326-332`), so the agent may not set one. `guardedFields: { markup: 'image.*Markup' }` (06 02-Q3). `summaryFields: ['alignment', 'size', 'width']`. Guidance: set the source with `image.setSource`; crop, rotate, flip and straighten with their actions, because each also turns `crop` and `markup`.
  - Video, audio, file: guidance points at `<tool>.setSource`; `summaryFields` as in the code below.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { validateAgainst } from '../../../../src/shared/schema/validate';
import { describeImage } from '../../../../src/shared/tool-descriptions/image';

describe('image description', () => {
  it('filters narrows the filter field to configured names, without "none"', () => {
    const { data } = describeImage({ filters: ['none', 'vivid', { name: 'brand', title: 'Brand', css: 'sepia(0.2)' }] });

    expect(validateAgainst(data, { url: 'u', filter: 'brand' })).toEqual([]);
    expect(validateAgainst(data, { url: 'u', filter: 'noir' }).length).toBeGreaterThan(0);
  });

  it('filters [] lets the agent set no filter at all', () => {
    expect(validateAgainst(describeImage({ filters: [] }).data, { url: 'u', filter: 'vivid' }).length).toBeGreaterThan(0);
  });

  it('no filters config is the open published schema', () => {
    expect(validateAgainst(describeImage({}).data, { url: 'u', filter: 'my-host-look' })).toEqual([]);
  });

  it('guards markup', () => {
    expect(describeImage({}).guardedFields).toEqual({ markup: 'image.*Markup' });
  });
});
```

`ImageFilterDefinition` has a CSS field; read `types/tools/image.d.ts:47-60` and use its real field name in the fixture instead of `css` if it differs.

Run: `yarn test test/unit/shared/tool-descriptions/media-blocks.test.ts`
Expected: FAIL.

- [ ] **Step 2: Write the modules**

```ts
// src/shared/tool-descriptions/image.ts
import type { BlockToolDescription } from '../../../types/tools/tool-description';
import { ALIGNMENT } from './rich-text';

export const IMAGE_DATA = /* the `image` $defs literal, moved verbatim (it uses ALIGNMENT) */ {};

const filterNames = (filters: unknown[]): string[] => filters
  .map(entry => (typeof entry === 'string' ? entry : (entry as { name?: unknown } | null)?.name))
  .filter((name): name is string => typeof name === 'string' && name !== '' && name !== 'none');

export const describeImage = (config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'An image with optional caption, crop, turn, colour look and drawings.',
  guidance: 'Set or replace the picture with image.setSource. Crop, rotate, flip and straighten with image.crop, image.rotate, image.flip and image.straighten: each also turns crop and markup. Add or change drawings with image.addMarkup, image.updateMarkup and image.removeMarkup. caption and alt are plain text.',
  data: Array.isArray(config.filters)
    ? { ...IMAGE_DATA, properties: { ...IMAGE_DATA.properties, filter: { type: 'string', enum: filterNames(config.filters) } } }
    : IMAGE_DATA,
  summaryFields: ['alignment', 'size', 'width'],
  guardedFields: { markup: 'image.*Markup' },
});

// src/shared/tool-descriptions/video.ts
export const describeVideo = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A video player.',
  guidance: 'Set the source with video.setSource. caption is plain text.',
  data: VIDEO_DATA,
  summaryFields: ['alignment', 'width', 'autoplay', 'loop'],
});

// src/shared/tool-descriptions/audio.ts
export const describeAudio = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'An audio player with optional title, artist and cover.',
  guidance: 'Set the source with audio.setSource and the cover with audio.setCover. Remove the cover by writing coverUrl as "". caption, title and artist are plain text.',
  data: AUDIO_DATA,
  summaryFields: ['title', 'artist', 'alignment'],
});

// src/shared/tool-descriptions/file.ts
export const describeFile = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A downloadable file card.',
  guidance: 'Set the file with file.setSource. fileName and caption are plain text.',
  data: FILE_DATA,
  summaryFields: ['fileName', 'mimeType'],
});
```

`IMAGE_DATA` keeps `alignment: { type: 'string', enum: ALIGNMENT }` exactly as the literal has it. Register all four, replace the four defs, add the four statics (`ImageTool`, `VideoTool`, `AudioTool`, `FileTool`).

- [ ] **Step 3: Run the tests**

Run, one at a time: `yarn test test/unit/shared/tool-descriptions/media-blocks.test.ts`, `yarn test test/unit/shared/tool-descriptions/descriptions.test.ts`, `yarn test test/unit/view/document-schema.test.ts`. All PASS.

- [ ] **Step 4: Commit**

```bash
npx eslint src/shared/tool-descriptions/image.ts src/shared/tool-descriptions/video.ts src/shared/tool-descriptions/audio.ts src/shared/tool-descriptions/file.ts src/shared/tool-descriptions/index.ts src/view/document-schema.ts src/tools/image/index.ts src/tools/video/index.ts src/tools/audio/index.ts src/tools/file/index.ts test/unit/shared/tool-descriptions/media-blocks.test.ts
git add src/shared/tool-descriptions/image.ts src/shared/tool-descriptions/video.ts src/shared/tool-descriptions/audio.ts src/shared/tool-descriptions/file.ts src/shared/tool-descriptions/index.ts src/view/document-schema.ts src/tools/image/index.ts src/tools/video/index.ts src/tools/audio/index.ts src/tools/file/index.ts test/unit/shared/tool-descriptions/media-blocks.test.ts
git commit -m "feat(media): self-descriptions; image filters narrow the filter field

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 21: Embed, bookmark, page, page-link

**Files:**
- Create: `src/shared/tool-descriptions/embed.ts`, `bookmark.ts`, `page.ts`, `page-link.ts`
- Modify: `index.ts`, `document-schema.ts` (four defs), `src/tools/link/embed/index.ts`, `src/tools/link/bookmark/index.ts`, `src/tools/page/index.ts`, `src/tools/page-link/index.ts`
- Test: `test/unit/shared/tool-descriptions/link-blocks.test.ts`

**Interfaces:**
- Produces: `describeEmbed`, `describeBookmark`, `describePage`, `describePageLink`.
  - Embed: guidance: set the URL with `embed.setUrl`, which derives `service`, `embed` and `kind`; never write `embed` yourself.
  - Bookmark: guidance: create with `bookmark.create`, which fetches the preview.
  - Page: guidance: inserting a page creates a new document through the host (`prepareInsert`, `src/tools/page/index.ts:157-164`); rename or re-icon the TARGET page with `page.rename` / `page.setIcon`; this document's own title is `doc.setTitle`. `summaryFields: ['pageId']`.
  - Page-link: guidance: a reference to an existing page id.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { BUILT_IN_BLOCK_DESCRIPTIONS } from '../../../../src/shared/tool-descriptions';

describe('link block descriptions', () => {
  it('registers embed, bookmark, page and page-link', () => {
    expect(Object.keys(BUILT_IN_BLOCK_DESCRIPTIONS)).toEqual(expect.arrayContaining(['embed', 'bookmark', 'page', 'page-link']));
  });

  it('page guidance separates another page from this document', () => {
    const { guidance } = BUILT_IN_BLOCK_DESCRIPTIONS.page({});

    expect(guidance).toMatch(/page\.rename/);
    expect(guidance).toMatch(/doc\.setTitle/);
  });
});
```

Run: `yarn test test/unit/shared/tool-descriptions/link-blocks.test.ts` → FAIL.

- [ ] **Step 2: Write the modules**

```ts
export const describeEmbed = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A live embed from a known provider (YouTube, Figma, …).',
  guidance: 'Set or change the URL with embed.setUrl: it finds the provider and fills service, embed and kind. Never write embed yourself. caption is plain text.',
  data: EMBED_DATA,
  summaryFields: ['service', 'source'],
});

export const describeBookmark = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A link preview card.',
  guidance: 'Create one with bookmark.create: it fetches title, description and image. Do not invent preview fields.',
  data: BOOKMARK_DATA,
  summaryFields: ['url', 'title'],
});

export const describePage = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A sub-page. Its body is a separate document named by pageId.',
  guidance: 'Inserting a page asks the host to create the page document. To rename the page this block points to, or change its icon, use page.rename or page.setIcon. To change the title of the document you are editing, use doc.setTitle.',
  data: PAGE_DATA,
  summaryFields: ['pageId'],
});

export const describePageLink = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A link to an existing page. It owns nothing.',
  guidance: 'pageId must name a page that exists. To make a new page, insert a page block instead.',
  data: PAGE_LINK_DATA,
  summaryFields: ['pageId'],
});
```

Register, replace the four defs, add the statics (`Embed`, `Bookmark`, `PageTool`, `PageLink`).

- [ ] **Step 3: Run the tests**

Run, one at a time: `yarn test test/unit/shared/tool-descriptions/link-blocks.test.ts`, `yarn test test/unit/shared/tool-descriptions/descriptions.test.ts`, `yarn test test/unit/view/document-schema.test.ts`. All PASS.

- [ ] **Step 4: Commit**

```bash
npx eslint src/shared/tool-descriptions/embed.ts src/shared/tool-descriptions/bookmark.ts src/shared/tool-descriptions/page.ts src/shared/tool-descriptions/page-link.ts src/shared/tool-descriptions/index.ts src/view/document-schema.ts src/tools/link/embed/index.ts src/tools/link/bookmark/index.ts src/tools/page/index.ts src/tools/page-link/index.ts test/unit/shared/tool-descriptions/link-blocks.test.ts
git add src/shared/tool-descriptions/embed.ts src/shared/tool-descriptions/bookmark.ts src/shared/tool-descriptions/page.ts src/shared/tool-descriptions/page-link.ts src/shared/tool-descriptions/index.ts src/view/document-schema.ts src/tools/link/embed/index.ts src/tools/link/bookmark/index.ts src/tools/page/index.ts src/tools/page-link/index.ts test/unit/shared/tool-descriptions/link-blocks.test.ts
git commit -m "feat(tools): self-descriptions for embed, bookmark, page and page-link

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 22: Table, database, database-row; schema fully assembled

**Files:**
- Create: `src/shared/tool-descriptions/table.ts`, `database.ts`, `database-row.ts`
- Modify: `index.ts`, `document-schema.ts` (last three defs), `src/tools/table/index.ts`, `src/tools/database/index.ts`, `src/tools/database-row/index.ts`, `test/unit/shared/tool-descriptions/descriptions.test.ts` (full-coverage case)

**Interfaces:**
- Produces: `describeTable`, `describeDatabase`, `describeDatabaseRow`.
  - Table: `guardedFields: { content: 'table.*' }`. `summaryFields: ['withHeadings', 'withHeadingColumn']`. Guidance: cells are child blocks placed by `content`; create with `table.create`; change rows, columns, merges and cell colours with `table.*` actions; edit a cell by editing its child blocks.
  - Database: `guardedFields: { schema: 'database.*', views: 'database.*' }`. `summaryFields: ['title', 'activeViewId']`. Guidance: rows are child `database-row` blocks; add with `database.addRow`.
  - Database row: guidance: write values with `database.setRowValues` on the parent database (title mirrors the title property).
- After this task every `$defs` entry comes from a description. The generic test adds: `Object.keys($defs)` equals `Object.keys(BUILT_IN_BLOCK_DESCRIPTIONS)` sorted.

- [ ] **Step 1: Add the failing full-coverage case**

Append to `descriptions.test.ts`:

```ts
  it('covers every published $defs entry', () => {
    expect(Object.keys(BUILT_IN_BLOCK_DESCRIPTIONS).sort()).toEqual(Object.keys(defs).sort());
  });

  it('guards the container fields only their actions may change', () => {
    expect(BUILT_IN_BLOCK_DESCRIPTIONS.table({}).guardedFields).toEqual({ content: 'table.*' });
    expect(BUILT_IN_BLOCK_DESCRIPTIONS.database({}).guardedFields).toEqual({ schema: 'database.*', views: 'database.*' });
  });
```

Run: `yarn test test/unit/shared/tool-descriptions/descriptions.test.ts`
Expected: FAIL (`table`, `database`, `database-row` missing).

- [ ] **Step 2: Write the modules**

```ts
export const describeTable = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A grid. Each cell holds child blocks; content maps cells to those block ids.',
  guidance: 'Create tables with table.create, never block.insert. Change rows, columns, merges and cell styles with the table.* actions; content cannot be written directly. To edit text in a cell, edit the cell\'s child block.',
  data: TABLE_DATA,
  summaryFields: ['withHeadings', 'withHeadingColumn'],
  guardedFields: { content: 'table.*' },
});

export const describeDatabase = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'A database: a schema of properties and saved views. Rows are child database-row blocks.',
  guidance: 'Add rows with database.addRow and change their values with database.setRowValues. Change views, properties and select options with the database.* actions; schema and views cannot be written directly.',
  data: DATABASE_DATA,
  summaryFields: ['title', 'activeViewId'],
  guardedFields: { schema: 'database.*', views: 'database.*' },
});

export const describeDatabaseRow = (_config: Record<string, unknown> = {}): BlockToolDescription => ({
  summary: 'One row of a database. Its page body is a separate document named by pageId.',
  guidance: 'Write row values with database.setRowValues on the parent database: the title mirrors the title property.',
  data: DATABASE_ROW_DATA,
  summaryFields: ['title'],
});
```

Register, replace the last three defs, add the statics (`Table`, `DatabaseTool`, `DatabaseRowTool`). `document-schema.ts` now has no literal defs left; delete the `ALIGNMENT` import if eslint reports it unused.

- [ ] **Step 3: Run the tests**

Run, one at a time: `yarn test test/unit/shared/tool-descriptions/descriptions.test.ts`, `yarn test test/unit/view/document-schema.test.ts`, `yarn test test/unit/view/index.purity.test.ts`. All PASS.

- [ ] **Step 4: Commit**

```bash
npx eslint src/shared/tool-descriptions/table.ts src/shared/tool-descriptions/database.ts src/shared/tool-descriptions/database-row.ts src/shared/tool-descriptions/index.ts src/view/document-schema.ts src/tools/table/index.ts src/tools/database/index.ts src/tools/database-row/index.ts test/unit/shared/tool-descriptions/descriptions.test.ts
git add src/shared/tool-descriptions/table.ts src/shared/tool-descriptions/database.ts src/shared/tool-descriptions/database-row.ts src/shared/tool-descriptions/index.ts src/view/document-schema.ts src/tools/table/index.ts src/tools/database/index.ts src/tools/database-row/index.ts test/unit/shared/tool-descriptions/descriptions.test.ts
git commit -m "feat(table,database): self-descriptions; every schema def now comes from a description

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 23: The optional top-level `title` and `icon` on `blokDocumentSchema`

**Files:**
- Modify: `src/view/document-schema.ts` (root `properties`), `src/shared/tool-descriptions/page.ts` (`PAGE_ICON_SCHEMA`), `test/unit/view/document-schema.test.ts` (two assertions), `test/unit/view/__snapshots__/document-schema.json` (re-pinned once)

**Interfaces:**
- Consumes: the flat `OutputData.title?: string` and `OutputData.icon?: PageIcon` that already exist (`types/data-formats/output-data.d.ts:128-132`, added by `8d86c376`, which is after the last tag `v1.16.1`, so unreleased). The saver writes them from the Yjs page map (`src/components/modules/saver.ts`). 06 §10.1 A's `OutputData.page` was dropped for this shape (01 deviation D-1; 06 §10.1 A round 4). This task only adds the schema properties.
- Produces: root properties `title: { type: 'string' }` and `icon: PAGE_ICON_SCHEMA`, and `PAGE_ICON_SCHEMA` exported from `src/shared/tool-descriptions/page.ts` (Task 49's `page.setIcon` args reuse it, so the two cannot drift). `PageIcon` is `{ type: 'emoji'; value: string } | { type: 'image'; url: string }` (`types/tools/page.d.ts:13`).
- `types/view.d.ts:697` declares `blokDocumentSchema: Readonly<Record<string, unknown>>`, a loose type, so the published declaration needs no change.

Two existing assertions break by design and change in this task:
- `'is a draft 2020-12 schema…'` pins the envelope keys to `['blocks', 'id', 'time', 'version']`.
- The `envelope` test compares a real saved document's keys with the schema's keys, and `title` / `icon` are absent when empty (`output-data.d.ts:128`, `:131`).

- [ ] **Step 1: Write the failing test**

Add to `document-schema.test.ts`:

```ts
import { validateAgainst } from '../../../src/shared/schema/validate';

  describe('page fields', () => {
    it('accepts a document carrying page title and icon', () => {
      const doc = { blocks: [], title: 'Roadmap', icon: { type: 'emoji', value: '🗺' } };

      expect(validateAgainst(blokDocumentSchema as unknown as Record<string, unknown>, doc)).toEqual([]);
    });

    it('rejects a malformed icon and a nested page object', () => {
      expect(validateAgainst(blokDocumentSchema as unknown as Record<string, unknown>, { blocks: [], icon: { type: 'emoji' } }).length).toBeGreaterThan(0);
      expect(validateAgainst(blokDocumentSchema as unknown as Record<string, unknown>, { blocks: [], page: { title: 'x' } }).length).toBeGreaterThan(0);
    });
  });
```

Run: `yarn test test/unit/view/document-schema.test.ts`
Expected: FAIL in `page fields` (root `additionalProperties: false` rejects `title` and `icon`).

Note: `validateAgainst` does not resolve `$ref`, so the per-type `allOf` routing is skipped for blocks. That is fine here: these documents have no blocks.

- [ ] **Step 2: Add the property and fix the two assertions**

In `src/shared/tool-descriptions/page.ts`:

```ts
/** PageIcon (types/tools/page.d.ts:13) as a schema. */
export const PAGE_ICON_SCHEMA = {
  oneOf: [
    { type: 'object', required: ['type', 'value'], additionalProperties: false, properties: { type: { const: 'emoji' }, value: { type: 'string' } } },
    { type: 'object', required: ['type', 'url'], additionalProperties: false, properties: { type: { const: 'image' }, url: { type: 'string' } } },
  ],
};
```

In `document-schema.ts`, after the `version` property (import `PAGE_ICON_SCHEMA` beside `describePage`):

```ts
    title: { type: 'string', description: 'This document\'s own page title. Absent when empty.' },
    icon: { ...PAGE_ICON_SCHEMA, description: 'This document\'s own page icon. Absent when none.' },
```

In the test, change `expect(Object.keys(schema.properties ?? {}).sort()).toEqual(['blocks', 'id', 'time', 'version'])` to `['blocks', 'icon', 'id', 'time', 'title', 'version']`, and in `envelope` change `expect(Object.keys(saved).sort()).toEqual(Object.keys(schema.properties ?? {}).sort())` to compare against the schema keys minus `title` and `icon`, with a comment `// title and icon are absent when the document has none`.

- [ ] **Step 3: Re-pin and run**

Run: `yarn test test/unit/view/document-schema.test.ts -u`
Then check `git diff test/unit/view/__snapshots__/document-schema.json`: the only change must be the added `title` and `icon` properties. Run again without `-u`: PASS.

- [ ] **Step 4: Commit**

```bash
npx eslint src/view/document-schema.ts src/shared/tool-descriptions/page.ts test/unit/view/document-schema.test.ts
git add src/view/document-schema.ts src/shared/tool-descriptions/page.ts test/unit/view/document-schema.test.ts test/unit/view/__snapshots__/document-schema.json
git commit -m "feat(view): blokDocumentSchema accepts the optional top-level title and icon

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 24: Validate real `save()` output against every description

**Files:**
- Modify: `test/unit/view/document-schema.test.ts` (new `describe('values', …)` block)

**Interfaces:**
- Consumes: `savedData` (the maximal `save()` samples at `document-schema.test.ts:124-261`), `BUILT_IN_BLOCK_DESCRIPTIONS` (Tasks 16-22), `validateAgainst` (Task 2).
- Produces: spec §6 item 2. Key checks already exist (`:409-427`); this adds VALUE checks, which catch a wrong enum or type the key check misses (spec §2.2).

- [ ] **Step 1: Write the test**

```ts
import { BUILT_IN_BLOCK_DESCRIPTIONS } from '../../../src/shared/tool-descriptions';

  describe('values', () => {
    it.each(BUILT_IN_BLOCK_TOOLS)('%s: the maximal save() sample is valid data', (name) => {
      expect(validateAgainst(BUILT_IN_BLOCK_DESCRIPTIONS[name]({}).data, savedData[name])).toEqual([]);
    });
  });
```

- [ ] **Step 2: Run it**

Run: `yarn test test/unit/view/document-schema.test.ts`
Expected: PASS. If a tool fails, the problem list names the field and why. That is a real drift between `save()` and the published schema. Stop and report it: fixing it changes either a published schema value or a tool's saved shape, which is a decision for the user (CLAUDE.md "Breaking Changes").

- [ ] **Step 2b: Image markup**

The image markup sample is extended, and the schema fixed, in Task 24a. This task keeps the existing sample.

- [ ] **Step 3: Prove it can fail**

In `savedData.spacer`, temporarily seed `height: 20`. Run: FAIL on `spacer` (below `minimum: 38`)… unless `save()` clamps it (`$defs.spacer` says out-of-range values clamp on load). If it still passes, use `quote` with `size: 'huge'` instead. Revert.

- [ ] **Step 4: Commit**

```bash
npx eslint test/unit/view/document-schema.test.ts
git add test/unit/view/document-schema.test.ts
git commit -m "test(view): every tool's real save() output validates against its description

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 24a: Widen `$defs.image.markup` to what v1.16.1 saves (bug fix)

The published TS type allows ten shape types, a shape `rotation`, `tx`, `ty`, and a stroke `cut` (`types/tools/image.d.ts:84-115` at `v1.16.1`). The editor shipped in `v1.16.1` saves all of them: `SHAPES` lists the ten (`src/tools/image/markup/model.ts:50` at the tag), `buildStroke` writes `cut` (`:115-116`), and the shape builder writes `rotation`, `tx`, `ty` (`:131-138`). But `$defs.image.markup` in the same release lists only `rect`, `ellipse`, `line`, `arrow`, and every branch has `additionalProperties: false` (`src/view/document-schema.ts:527-579`, identical at `v1.16.1` and `30c77599`). So a real saved document with a star, a bubble or a cut stroke fails `blokDocumentSchema`, and 01's post-write validation would reject `image.addMarkup` of those shapes.

**Not breaking.** The fix only widens: it adds enum values and optional properties to existing `anyOf` branches. It adds no `required` key and removes nothing, so every item the old schema accepted still matches the same branch (`anyOf`, not `oneOf`, so an item matching two branches is not rejected). No `BREAKING` label (CLAUDE.md "Breaking Changes": a change that rejects nothing previously accepted is a bug fix). The release note lists it as a fix.

**Files:**
- Modify: `src/shared/tool-descriptions/image.ts` (`IMAGE_DATA.properties.markup`), `test/unit/view/document-schema.test.ts` (`savedData.image`), `test/unit/view/__snapshots__/document-schema.json` (re-pinned once, after Task 23's re-pin)

**Interfaces:**
- Consumes: `IMAGE_DATA` (Task 20), `validateAgainst` (Task 2), Task 24's `values` test.
- Produces: `$defs.image.markup.items.anyOf`:
  - stroke branch: adds `cut: { type: 'string', enum: ['start', 'end', 'both'], description: 'Ends the eraser cut. Omitted when none.' }`;
  - shape branch: `type.enum` becomes `['rect', 'rounded-rect', 'ellipse', 'line', 'arrow', 'bubble', 'star', 'polygon', 'spotlight', 'magnifier']`; adds `rotation: { type: 'number', description: 'Star and polygon only: clockwise degrees. Omitted for 0.' }`, `tx: { type: 'number' }`, `ty: { type: 'number' }` (`description: 'Bubble only: where the tail points.'` on `tx`);
  - text branch: unchanged.

- [ ] **Step 1: Write the failing test**

Add one item of each missing shape type (`rounded-rect`, `bubble` with `tx`/`ty`, `star` with `rotation: 30`, `polygon`, `spotlight`, `magnifier`) and a `pen` stroke with `cut: 'both'` to `savedData.image.markup` in `document-schema.test.ts`. Build each item the way the markup editor saves it (read `readItem` in `src/tools/image/markup/model.ts`; colours `#rrggbb` lower case, sizes in `(0, 0.5]`). Add, beside the `values` block:

```ts
  it('accepts every markup item an image saved by v1.16.1 can hold', () => {
    expect(validateAgainst(BUILT_IN_BLOCK_DESCRIPTIONS.image({}).data, savedData.image)).toEqual([]);
  });

  it('still accepts the old markup items unchanged', () => {
    const old = { url: 'https://x.y/a.png', markup: [
      { id: 'a', type: 'pen', color: '#ff0000', points: [0.1, 0.1, 0.5], size: 0.01 },
      { id: 'b', type: 'rect', color: '#00ff00', x1: 0, y1: 0, x2: 1, y2: 1, size: 0.02, fill: true },
      { id: 'c', type: 'text', color: '#0000ff', x: 0.5, y: 0.5, text: 'hi', size: 0.05 },
    ] };

    expect(validateAgainst(BUILT_IN_BLOCK_DESCRIPTIONS.image({}).data, old)).toEqual([]);
  });
```

Run: `yarn test test/unit/view/document-schema.test.ts -t "markup"`
Expected: the first test FAILS with problems under `/markup/…` (enum and `additionalProperties`); the second PASSES (it guards the widening).

- [ ] **Step 2: Widen `IMAGE_DATA`**

Edit the three branches as listed under Interfaces. Change nothing else in `IMAGE_DATA`.

Shipping early: this is a self-contained bug fix. To ship it before Task 20 has moved `$defs.image`, make the same edit in `src/view/document-schema.ts` and write the two tests against `(blokDocumentSchema.$defs as Record<string, Record<string, unknown>>).image`; Task 20 then moves the widened literal verbatim and Task 1's byte pin stays green.

- [ ] **Step 3: Run, re-pin once, run again**

Run: `yarn test test/unit/view/document-schema.test.ts -t "markup"` → PASS.
Run: `yarn test test/unit/view/document-schema.test.ts -u`, then `git diff test/unit/view/__snapshots__/document-schema.json`: the only changes are the six enum values and the four optional properties. Run again without `-u`: PASS.
Run: `yarn test test/unit/tools/image/markup/model.test.ts` (exists at `30c77599`; the editor model is untouched, this confirms nothing else moved).

- [ ] **Step 4: Commit**

```bash
npx eslint src/shared/tool-descriptions/image.ts test/unit/view/document-schema.test.ts
git add src/shared/tool-descriptions/image.ts test/unit/view/document-schema.test.ts test/unit/view/__snapshots__/document-schema.json
git commit -m "fix(view): image markup schema accepts every shape the editor saves

The published schema listed 4 of the 10 shape types and none of cut, rotation,
tx, ty, so documents saved by v1.16.1 failed validation. Widening only.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 25: Inline tool and tune descriptions

**Files:**
- Create: `src/shared/tool-descriptions/inline.ts`
- Modify: the ten inline tool classes (`src/components/inline-tools/inline-tool-*.ts`; italic, underline and strikethrough subclass `createSimpleMarkTool`, so the static goes on the subclass), `src/components/block-tunes/block-tune-delete.ts`, `block-tune-copy-link.ts`
- Test: `test/unit/shared/tool-descriptions/inline.test.ts`

**Interfaces:**
- Produces:
  - `BUILT_IN_INLINE_DESCRIPTIONS: Readonly<Record<string, () => InlineToolDescription>>`, keyed `marker`, `bold`, `italic`, `underline`, `clearFormat`, `link`, `strikethrough`, `inlineCode`, `equation`, `supSub`, plus `convertTo` (the internal convert tool, `src/components/modules/tools.ts:336-339`).
  - `BUILT_IN_TUNE_DESCRIPTIONS: Readonly<Record<string, () => BlockTuneDescription>>` for `delete` and `copyLink`, both `data: null` (neither has `save()`, spec §2.6).
- Effects (spec §2.6 inline table, `types/rich-text.d.ts:13-29`):

| Tool | `effect` |
|---|---|
| bold, italic, underline, strikethrough, inlineCode | `{ mark: 'bold' \| 'italic' \| 'underline' \| 'strikethrough' \| 'code', value: { const: true } }` |
| marker | `{ marks: ['color', 'background', 'highlight'], value: { type: ['string', 'boolean'] } }` |
| link | `{ mark: 'link', value: <the link object schema from RICH_TEXT_MARKS.properties.link> }` |
| equation | `{ embed: 'equation', value: { type: 'object', required: ['expression'], properties: { expression: { type: 'string' } } } }` |
| supSub | `{ marks: ['sup', 'sub'], value: { const: true } }` |
| clearFormat | `{ clears: 'marks' }` |
| convertTo | `{ clears: 'marks' }` is wrong for it; it converts blocks. Give it `{ marks: [], value: { const: true } }` and the summary "Turns the block into another type; use block.convert." |

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { BUILT_IN_INLINE_DESCRIPTIONS, BUILT_IN_TUNE_DESCRIPTIONS } from '../../../../src/shared/tool-descriptions/inline';
import { RICH_TEXT_MARKS } from '../../../../src/shared/tool-descriptions/rich-text';
import { INLINE_CLASSES } from './built-in-tools';

describe('inline tool descriptions', () => {
  it.each(Object.keys(INLINE_CLASSES))('%s: the class static is the shared function', (name) => {
    expect((INLINE_CLASSES[name] as { describe?: unknown }).describe).toBe(BUILT_IN_INLINE_DESCRIPTIONS[name]);
  });

  it('every single mark effect names a real rich-text mark', () => {
    const known = Object.keys(RICH_TEXT_MARKS.properties);

    Object.values(BUILT_IN_INLINE_DESCRIPTIONS).forEach((describe) => {
      const { effect } = describe();

      if ('mark' in effect) {
        expect(known).toContain(effect.mark);
      }
      if ('marks' in effect) {
        effect.marks.forEach(mark => expect(known).toContain(mark));
      }
    });
  });

  it('built-in tunes save nothing', () => {
    expect(BUILT_IN_TUNE_DESCRIPTIONS.delete().data).toBeNull();
    expect(BUILT_IN_TUNE_DESCRIPTIONS.copyLink().data).toBeNull();
  });
});
```

Run: `yarn test test/unit/shared/tool-descriptions/inline.test.ts` → FAIL.

- [ ] **Step 2: Write `inline.ts` and the statics**

```ts
import type { BlockTuneDescription, InlineToolDescription } from '../../../types/tools/tool-description';
import { RICH_TEXT_MARKS } from './rich-text';

const flag = { const: true };

const mark = (name: string, summary: string) => (): InlineToolDescription => ({ summary, effect: { mark: name, value: flag } });

export const BUILT_IN_INLINE_DESCRIPTIONS: Readonly<Record<string, () => InlineToolDescription>> = {
  bold: mark('bold', 'Bold text. Write it as the "bold" mark on a segment.'),
  italic: mark('italic', 'Italic text. The "italic" mark.'),
  underline: mark('underline', 'Underlined text. The "underline" mark.'),
  strikethrough: mark('strikethrough', 'Struck-through text. The "strikethrough" mark.'),
  inlineCode: mark('code', 'Inline code. The "code" mark.'),
  marker: () => ({
    summary: 'Text colour, background colour or a plain highlight. Colours are a preset name or any CSS colour.',
    effect: { marks: ['color', 'background', 'highlight'], value: { type: ['string', 'boolean'] } },
  }),
  link: () => ({ summary: 'A link. The "link" mark with href.', effect: { mark: 'link', value: RICH_TEXT_MARKS.properties.link } }),
  equation: () => ({
    summary: 'An inline LaTeX equation. An embed segment, not a mark.',
    effect: { embed: 'equation', value: { type: 'object', required: ['expression'], properties: { expression: { type: 'string' } } } },
  }),
  supSub: () => ({ summary: 'Superscript or subscript. The "sup" or "sub" mark, never both.', effect: { marks: ['sup', 'sub'], value: flag } }),
  clearFormat: () => ({ summary: 'Removes every mark except links.', effect: { clears: 'marks' } }),
  convertTo: () => ({ summary: 'Turns the block into another type. Use block.convert.', effect: { marks: [], value: flag } }),
};

export const BUILT_IN_TUNE_DESCRIPTIONS: Readonly<Record<string, () => BlockTuneDescription>> = {
  delete: () => ({ summary: 'Deletes the block. Use block.delete.', data: null }),
  copyLink: () => ({ summary: 'Copies a link to the block. Changes nothing in the document.', data: null }),
};
```

Each class gets `public static describe = BUILT_IN_INLINE_DESCRIPTIONS.<key>;` (and the tunes `BUILT_IN_TUNE_DESCRIPTIONS.<key>`). For `ConvertInlineTool` (`src/components/inline-tools/inline-tool-convert.ts`) add the static too. `src/components/` may import from `src/shared/`; the reverse is what the purity rule forbids.

- [ ] **Step 3: Run the test**

Run: `yarn test test/unit/shared/tool-descriptions/inline.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
npx eslint src/shared/tool-descriptions/inline.ts src/components/inline-tools/inline-tool-bold.ts src/components/inline-tools/inline-tool-italic.ts src/components/inline-tools/inline-tool-underline.ts src/components/inline-tools/inline-tool-strikethrough.ts src/components/inline-tools/inline-tool-code.ts src/components/inline-tools/inline-tool-marker.ts src/components/inline-tools/inline-tool-link.ts src/components/inline-tools/inline-tool-equation.ts src/components/inline-tools/inline-tool-sup-sub.ts src/components/inline-tools/inline-tool-clear-format.ts src/components/inline-tools/inline-tool-convert.ts src/components/block-tunes/block-tune-delete.ts src/components/block-tunes/block-tune-copy-link.ts test/unit/shared/tool-descriptions/inline.test.ts
git add src/shared/tool-descriptions/inline.ts src/components/inline-tools/inline-tool-bold.ts src/components/inline-tools/inline-tool-italic.ts src/components/inline-tools/inline-tool-underline.ts src/components/inline-tools/inline-tool-strikethrough.ts src/components/inline-tools/inline-tool-code.ts src/components/inline-tools/inline-tool-marker.ts src/components/inline-tools/inline-tool-link.ts src/components/inline-tools/inline-tool-equation.ts src/components/inline-tools/inline-tool-sup-sub.ts src/components/inline-tools/inline-tool-clear-format.ts src/components/inline-tools/inline-tool-convert.ts src/components/block-tunes/block-tune-delete.ts src/components/block-tunes/block-tune-copy-link.ts test/unit/shared/tool-descriptions/inline.test.ts
git commit -m "feat(inline-tools,tunes): self-descriptions as rich-text effects

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 26: The browser registry snapshot (`snapshotFromTools`, `runtimesFromTools`)

**Requires Task 13** (it reads `BUILT_IN_RUNTIME_PARTS`).

**Files:**
- Create: `src/components/tools/registry-snapshot.ts`
- Test: `test/unit/components/tools/registry-snapshot.test.ts`

**Interfaces:**
- Consumes: `BlockToolAdapter` getters (`src/components/tools/block.ts`: `toolbox` `:379`, `conversionConfig` `:500`, `richTextFields` `:555`, `childTools` `:146`, `acceptsChildren` `:156`, `ownsChildren` `:132`, `isLayout` `:279`, `deletesChildren` `:271`, `assetKind` `:301`, `sanitizeConfig` `:562`, `inlineTools`/`tunes` collections `:46-51`), `translateToolTitle` (`src/components/utils/tools.ts:64`), `SELF_PLACING_PARENTS` (`src/tools/nested-blocks.ts:110`), `isRestrictedInTableCell` (`src/tools/table/table-restrictions.ts:100`), `buildToolRuntimes` (Task 13).
- Produces (03 consumes both):
  - `interface ToolsLike { blockTools: ReadonlyMap<string, BlockToolAdapter>; inlineTools: ReadonlyMap<string, InlineToolAdapter>; blockTunes: ReadonlyMap<string, BlockTuneAdapter> }`.
  - `snapshotFromTools(tools: ToolsLike, input: { blokVersion: string; readOnly: boolean; defaultBlock: string; services: HostService[]; i18n: I18nInstance }): ToolRegistrySnapshot`. Skips internal block tools (`stub`). `insertable` is false only when the tool HAS a toolbox and the host hid it (`adapter.toolbox === undefined` while the constructable declares one). `handlers` = keys of the constructable's `actionHandlers`. `description` = the constructable's `describe(adapter.settings)` when it is a function, wrapped in try/catch (a throw → `null`, which `buildToolManifest` treats as structural; the error is logged).
  - `runtimesFromTools(tools: ToolsLike): ToolRuntimeRegistry`: one entry per block tool, `sanitize` = `adapter.sanitizeConfig` (already composed by the adapter), `actions` = `actionHandlers`, `normalize` / `defaultChildren` from `BUILT_IN_RUNTIME_PARTS[name]` when the constructable is the built-in class registered under that key.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import { snapshotFromTools, runtimesFromTools } from '../../../../src/components/tools/registry-snapshot';
import { buildToolManifest } from '../../../../src/shared/tool-manifest';
import { Header, Paragraph, Table } from '../../../../src/tools';

describe('snapshotFromTools', () => {
  let holder: HTMLDivElement;
  let core: Core;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    holder.remove();
  });

  const boot = async (tools: Record<string, unknown>): Promise<ReturnType<typeof snapshotFromTools>> => {
    core = new Core({ holder, tools } as never);
    await core.isReady;

    const { Tools, I18n } = core.moduleInstances as unknown as { Tools: Parameters<typeof snapshotFromTools>[0]; I18n: unknown };

    return snapshotFromTools(Tools, { blokVersion: 'test', readOnly: false, defaultBlock: 'paragraph', services: [], i18n: I18n as never });
  };

  it('reads a built-in tool as described, with its toolbox variants', async () => {
    const snapshot = await boot({ paragraph: Paragraph, header: { class: Header, levels: [1, 2] } });
    const header = snapshot.blocks.find(block => block.name === 'header');

    expect(header?.description?.summary).toMatch(/heading/i);
    expect(header?.statics.toolbox.map(entry => entry.data)).toEqual(expect.arrayContaining([expect.objectContaining({ level: 1 })]));
    expect(buildToolManifest(snapshot).blocks.find(block => block.name === 'header')?.level).toBe('described');
  });

  it('a host that hides a tool makes it not insertable', async () => {
    const snapshot = await boot({ paragraph: Paragraph, header: { class: Header, toolbox: false } });

    expect(snapshot.blocks.find(block => block.name === 'header')?.insertable).toBe(false);
  });

  it('a table registered as grid is not self-placing (core keys that set by name)', async () => {
    const snapshot = await boot({ paragraph: Paragraph, grid: Table });

    expect(snapshot.blocks.find(block => block.name === 'grid')?.statics.selfPlacesChildren).toBe(false);
  });

  it('runtimes carry the adapter sanitize config', async () => {
    await boot({ paragraph: Paragraph });
    const runtimes = runtimesFromTools((core.moduleInstances as unknown as { Tools: Parameters<typeof runtimesFromTools>[0] }).Tools);

    expect(runtimes.get('paragraph')?.sanitize).toBe(core.moduleInstances.Tools.blockTools.get('paragraph')?.sanitizeConfig);
  });

  it('a table registered as grid still gets the table normalize', async () => {
    await boot({ paragraph: Paragraph, grid: Table });
    const runtimes = runtimesFromTools((core.moduleInstances as unknown as { Tools: Parameters<typeof runtimesFromTools>[0] }).Tools);

    expect(typeof runtimes.get('grid')?.normalize).toBe('function');
  });

  it('a tool whose describe throws is listed as structural, and the editor still boots', async () => {
    class Throws extends Paragraph {
      public static describe = (): never => {
        throw new Error('boom');
      };
    }
    const snapshot = await boot({ paragraph: Paragraph, odd: Throws });

    expect(snapshot.blocks.find(block => block.name === 'odd')?.description).toBeNull();
    expect(buildToolManifest(snapshot).blocks.find(block => block.name === 'odd')?.level).toBe('structural');
  });
});
```

Copy `destroyCore` from `test/unit/shared/sanitize-schema.test.ts:28-66` and call it in `afterEach`. Read how the I18n module is reached in `src/components/utils/tools.ts` (`I18nInstance`) and pass the same object.

Run: `yarn test test/unit/components/tools/registry-snapshot.test.ts` → FAIL (unresolved module).

- [ ] **Step 2: Implement**

```ts
import type { BlockToolConstructable, HostService, SnapshotBlock, ToolRegistrySnapshot } from '../../../types';
import { BUILT_IN_RUNTIME_PARTS } from '../../shared/tool-actions';
import type { ToolRuntime, ToolRuntimeRegistry } from '../../shared/tool-actions/runtime';
import { BUILT_IN_BLOCK_DESCRIPTIONS } from '../../shared/tool-descriptions';
import { SELF_PLACING_PARENTS } from '../../tools/nested-blocks';
import { isRestrictedInTableCell } from '../../tools/table/table-restrictions';
import { log } from '../utils/logger';
import { translateToolTitle } from '../utils/tools';
import type { I18nInstance } from '../utils/tools';
import type { BlockToolAdapter } from './block';
import type { BlockTuneAdapter } from './tune';
import type { InlineToolAdapter } from './inline';

export interface ToolsLike {
  blockTools: ReadonlyMap<string, BlockToolAdapter>;
  inlineTools: ReadonlyMap<string, InlineToolAdapter>;
  blockTunes: ReadonlyMap<string, BlockTuneAdapter>;
}

const describeSafely = <T>(name: string, constructable: unknown, config: unknown): T | null => {
  const describe = (constructable as { describe?: unknown }).describe;

  if (typeof describe !== 'function') {
    return null;
  }

  try {
    return describe.call(constructable, config) as T;
  } catch (error) {
    log(`Tool "${name}": describe() threw; listing it as structural.`, 'warn', error);

    return null;
  }
};

const names = (setting: unknown, all: Iterable<string>): string[] =>
  (setting === false ? [] : Array.isArray(setting) ? setting.filter((name): name is string => typeof name === 'string') : [...all]);

export const snapshotFromTools = (
  tools: ToolsLike,
  input: { blokVersion: string; readOnly: boolean; defaultBlock: string; services: HostService[]; i18n: I18nInstance }
): ToolRegistrySnapshot => ({
  blokVersion: input.blokVersion,
  readOnly: input.readOnly,
  defaultBlock: input.defaultBlock,
  services: input.services,
  blocks: [...tools.blockTools.values()].filter(tool => !tool.isInternal).map((tool): SnapshotBlock => {
    const constructable = tool.constructable as BlockToolConstructable;
    const toolbox = tool.toolbox ?? [];
    const conversion = tool.conversionConfig ?? {};

    return {
      name: tool.name,
      title: translateToolTitle(input.i18n, toolbox[0] ?? {}, tool.name),
      description: describeSafely(tool.name, constructable, tool.settings),
      statics: {
        toolbox: toolbox.map((entry, index) => ({
          name: entry.name ?? `${tool.name}-${index}`,
          title: translateToolTitle(input.i18n, entry, tool.name),
          ...(entry.data === undefined ? {} : { data: entry.data as Record<string, unknown> }),
          ...(entry.preview?.descriptionKey === undefined ? {} : { previewCaption: input.i18n.t(entry.preview.descriptionKey) }),
        })),
        richTextFields: tool.richTextFields,
        acceptsChildren: tool.acceptsChildren,
        ...(tool.childTools === undefined ? {} : { childTools: tool.childTools }),
        ownsChildren: tool.ownsChildren,
        isLayout: tool.isLayout,
        deletesChildren: tool.deletesChildren,
        selfPlacesChildren: SELF_PLACING_PARENTS.has(tool.name),
        restrictedInTableCell: isRestrictedInTableCell(tool.name),
        conversion: {
          ...(typeof conversion.import === 'string' ? { import: conversion.import } : {}),
          ...(typeof conversion.export === 'string' ? { export: conversion.export } : {}),
        },
        convertible: { import: conversion.import !== undefined, export: conversion.export !== undefined },
        ...(tool.assetKind === undefined ? {} : { assetKind: tool.assetKind }),
        hasPrepareInsert: typeof constructable.prepareInsert === 'function',
      },
      insertable: !(constructable.toolbox !== undefined && tool.toolbox === undefined),
      inlineTools: names(tool.enabledInlineTools, tools.inlineTools.keys()).filter(name => tools.inlineTools.has(name)),
      tunes: names(tool.enabledBlockTunes ?? true, tools.blockTunes.keys()),
      handlers: Object.keys(constructable.actionHandlers ?? {}),
    };
  }),
  inlineTools: [...tools.inlineTools.values()].map(tool => ({
    name: tool.name,
    title: tool.title,
    description: describeSafely(tool.name, tool.constructable, tool.settings),
    sanitizeTags: Object.keys(tool.sanitizeConfig),
    ...(tool.shortcut === undefined ? {} : { shortcut: tool.shortcut }),
  })),
  tunes: [...tools.blockTunes.values()].map(tune => ({ name: tune.name, description: describeSafely(tune.name, tune.constructable, tune.settings) })),
});

// normalize / defaultChildren belong to the built-in CLASS, found by its describe function, not by the key it is registered under.
const builtInPartsFor = (constructable: BlockToolConstructable): (typeof BUILT_IN_RUNTIME_PARTS)[string] | undefined => {
  const key = Object.keys(BUILT_IN_BLOCK_DESCRIPTIONS).find(name => BUILT_IN_BLOCK_DESCRIPTIONS[name] === constructable.describe);

  return key === undefined ? undefined : BUILT_IN_RUNTIME_PARTS[key];
};

export const runtimesFromTools = (tools: ToolsLike): ToolRuntimeRegistry => new Map([...tools.blockTools.values()]
  .filter(tool => !tool.isInternal)
  .map((tool): [string, ToolRuntime] => {
    const constructable = tool.constructable as BlockToolConstructable;
    const parts = builtInPartsFor(constructable);

    return [tool.name, {
      name: tool.name,
      // Already composed with the enabled inline tools by the adapter: kept by reference.
      sanitize: tool.sanitizeConfig,
      ...(parts?.normalize === undefined ? {} : { normalize: parts.normalize }),
      ...(parts?.defaultChildren === undefined ? {} : { defaultChildren: parts.defaultChildren }),
      actions: constructable.actionHandlers ?? {},
    }];
  }));
```

Read before writing: `tool.title` / `tool.shortcut` on the inline adapter (`src/components/tools/inline.ts:57`, `base.ts:354`), the tune adapter path (`src/components/tools/tune.ts`; adjust the import), the `log` signature in `src/components/utils/logger.ts`, and whether `I18nInstance` is exported from `src/components/utils/tools.ts`.

- [ ] **Step 3: Run the test**

Run: `yarn test test/unit/components/tools/registry-snapshot.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
npx eslint src/components/tools/registry-snapshot.ts test/unit/components/tools/registry-snapshot.test.ts
git add src/components/tools/registry-snapshot.ts test/unit/components/tools/registry-snapshot.test.ts
git commit -m "feat(tools): registry snapshot and runtimes from the live editor tools

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 27: Built-in statics for Node and Jint (`buildBuiltInSnapshot`)

**Requires Task 13** (handlers come from `BUILT_IN_TOOL_RUNTIMES`).

**Files:**
- Create: `src/shared/tool-descriptions/built-in-statics.ts`, `src/shared/built-in-snapshot.ts`
- Test: `test/unit/shared/built-in-snapshot.test.ts` (jsdom: compares with the real editor), `test/unit/shared/built-in-snapshot.node.test.ts` (`// @vitest-environment node`)

**Interfaces:**
- Consumes: `snapshotFromTools` (Task 26), `BUILT_IN_BLOCK_DESCRIPTIONS`, `BUILT_IN_INLINE_DESCRIPTIONS`, `BUILT_IN_TUNE_DESCRIPTIONS` (Tasks 16-25), `BUILT_IN_TOOL_RUNTIMES` (Task 13), `builtInEditorTools` (Task 13 helper).
- Produces:
  - `BUILT_IN_BLOCK_STATICS: Readonly<Record<string, { title: string; statics: SnapshotBlockStatics; inlineTools: string[]; tunes: string[] }>>` and `BUILT_IN_INLINE_STATICS: Readonly<Record<string, { title: string; sanitizeTags: string[]; shortcut?: string }>>`, English titles.
  - `buildBuiltInSnapshot(input: { blokVersion: string; readOnly?: boolean; services?: HostService[] }): ToolRegistrySnapshot`. Pure, DOM-free. `handlers` come from `BUILT_IN_TOOL_RUNTIMES.get(name).actions`.
- The statics table is a hand copy of what the real editor reports, so it is drift-tested (CLAUDE.md "Hand-transcription drifts"): the jsdom test boots the default editor (`builtInEditorTools()`), takes `snapshotFromTools`, and requires `buildBuiltInSnapshot` to equal it block for block, including `inlineTools`, `tunes` and English titles. Code's `inlineToolbar: false` must show up as `inlineTools: []`.

- [ ] **Step 1: Write the drift test**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../src/components/core';
import { snapshotFromTools } from '../../../src/components/tools/registry-snapshot';
import { buildBuiltInSnapshot } from '../../../src/shared/built-in-snapshot';
import { builtInEditorTools } from './tool-descriptions/built-in-tools';

describe('buildBuiltInSnapshot', () => {
  let holder: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    holder.remove();
  });

  it('equals what the default editor reports, tool by tool', async () => {
    const core = new Core({ holder, tools: builtInEditorTools() });

    await core.isReady;
    const { Tools, I18n } = core.moduleInstances as unknown as { Tools: Parameters<typeof snapshotFromTools>[0]; I18n: never };
    const live = snapshotFromTools(Tools, { blokVersion: 'v', readOnly: false, defaultBlock: 'paragraph', services: [], i18n: I18n });
    const built = buildBuiltInSnapshot({ blokVersion: 'v' });

    expect(built.blocks.map(block => block.name)).toEqual(live.blocks.map(block => block.name));
    live.blocks.forEach((block, index) => expect(built.blocks[index], block.name).toEqual(block));
    expect(built.inlineTools).toEqual(live.inlineTools);
    expect(built.tunes).toEqual(live.tunes);
  }, 60_000);
});
```

Add `destroyCore` as in Task 26. The `description` field compares too: the live one comes from each class's `describe(settings)`, the built one from `BUILT_IN_BLOCK_DESCRIPTIONS[name](defaultSettings)`; with default settings they must be equal.

- [ ] **Step 2: Run it to see the table it needs**

Create `src/shared/built-in-snapshot.ts` and `built-in-statics.ts` with empty tables first, run `yarn test test/unit/shared/built-in-snapshot.test.ts`, and read the diff: it prints every expected `statics`, `title`, `inlineTools` and `tunes`. Fill `BUILT_IN_BLOCK_STATICS` and `BUILT_IN_INLINE_STATICS` from that output, one tool at a time, then re-run until PASS. This is generation by test output; the test keeps it honest afterwards.

The two modules:

```ts
// src/shared/tool-descriptions/built-in-statics.ts
import type { SnapshotBlockStatics } from '../../../types';

/** What the default editor reports for each built-in. Drift-tested against a live editor in test/unit/shared/built-in-snapshot.test.ts. */
export const BUILT_IN_BLOCK_STATICS: Readonly<Record<string, { title: string; statics: SnapshotBlockStatics; inlineTools: string[]; tunes: string[] }>> = {
  // one entry per registry key, filled from the failing test's output
};

export const BUILT_IN_INLINE_STATICS: Readonly<Record<string, { title: string; sanitizeTags: string[]; shortcut?: string }>> = {
  // one entry per inline tool, same source
};
```

```ts
// src/shared/built-in-snapshot.ts
import type { HostService, ToolRegistrySnapshot } from '../../types';
import { BUILT_IN_TOOL_RUNTIMES } from './tool-actions';
import { BUILT_IN_BLOCK_DESCRIPTIONS } from './tool-descriptions';
import { BUILT_IN_BLOCK_STATICS, BUILT_IN_INLINE_STATICS } from './tool-descriptions/built-in-statics';
import { BUILT_IN_INLINE_DESCRIPTIONS, BUILT_IN_TUNE_DESCRIPTIONS } from './tool-descriptions/inline';

/** The default registry, built without any tool class: for Node (04) and the Jint bundle. */
export const buildBuiltInSnapshot = (input: { blokVersion: string; readOnly?: boolean; services?: HostService[] }): ToolRegistrySnapshot => ({
  blokVersion: input.blokVersion,
  readOnly: input.readOnly ?? false,
  defaultBlock: 'paragraph',
  services: input.services ?? [],
  blocks: Object.entries(BUILT_IN_BLOCK_STATICS).map(([name, entry]) => ({
    name,
    title: entry.title,
    description: BUILT_IN_BLOCK_DESCRIPTIONS[name]({}),
    statics: entry.statics,
    insertable: true,
    inlineTools: entry.inlineTools,
    tunes: entry.tunes,
    handlers: Object.keys(BUILT_IN_TOOL_RUNTIMES.get(name)?.actions ?? {}),
  })),
  inlineTools: Object.entries(BUILT_IN_INLINE_STATICS).map(([name, entry]) => ({
    name, title: entry.title, description: BUILT_IN_INLINE_DESCRIPTIONS[name](), sanitizeTags: entry.sanitizeTags,
    ...(entry.shortcut === undefined ? {} : { shortcut: entry.shortcut }),
  })),
  tunes: Object.keys(BUILT_IN_TUNE_DESCRIPTIONS).map(name => ({ name, description: BUILT_IN_TUNE_DESCRIPTIONS[name]() })),
});
```

`BUILT_IN_BLOCK_DESCRIPTIONS[name]({})` vs the class's `describe(settings)` with default settings: paragraph's default settings are `{ preserveBlank: true }`; descriptions ignore unknown keys, so both agree. If the drift test shows a mismatch for a tool whose default config narrows, pass that tool's default settings from `defaultBlockTools` instead of `{}`. `defaultBlockTools` lives in `src/tools/index.ts`, which `src/shared/` may not import; copy the needed settings into `BUILT_IN_BLOCK_STATICS[name]` as a `config` field with a comment.

- [ ] **Step 3: Write the Node test**

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildBuiltInSnapshot } from '../../../src/shared/built-in-snapshot';
import { buildToolManifest } from '../../../src/shared/tool-manifest';

describe('buildBuiltInSnapshot in Node', () => {
  it('builds a described manifest with no DOM', () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    const manifest = buildToolManifest(buildBuiltInSnapshot({ blokVersion: '1.0.0' }));

    expect(manifest.blocks.every(block => block.level === 'described')).toBe(true);
    expect(manifest.blocks.find(block => block.name === 'code')?.inlineTools).toEqual([]);
  });
});
```

Run: `yarn test test/unit/shared/built-in-snapshot.node.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
npx eslint src/shared/tool-descriptions/built-in-statics.ts src/shared/built-in-snapshot.ts test/unit/shared/built-in-snapshot.test.ts test/unit/shared/built-in-snapshot.node.test.ts
git add src/shared/tool-descriptions/built-in-statics.ts src/shared/built-in-snapshot.ts test/unit/shared/built-in-snapshot.test.ts test/unit/shared/built-in-snapshot.node.test.ts
git commit -m "feat(shared): built-in registry snapshot for Node and Jint, drift-tested against a live editor

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 28: `inputFields` for every multi-input built-in

**Files:**
- Modify: the description modules of every built-in that renders more than one DOM input (found by the test, not by a hand list)
- Test: `test/unit/shared/tool-descriptions/input-fields.test.ts`

**Interfaces:**
- Consumes: the editor's per-block input list. Read how `Block` exposes it (`src/components/block/index.ts`, look for `inputs`) and use the same getter the caret code uses.
- Produces: `inputFields` on each multi-input description (06 §10.2): entry `i` is the data field DOM input `i` edits. 03 maps an agent caret through it; without it a block with one rich field maps to input 0 and anything else is block-level.

- [ ] **Step 1: Write the test**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { BUILT_IN_BLOCK_DESCRIPTIONS } from '../../../../src/shared/tool-descriptions';
import { builtInEditorTools } from './built-in-tools';

const SAMPLES: Record<string, Record<string, unknown>> = {
  paragraph: { text: 'a' },
  header: { text: 'a', level: 2 },
  quote: { text: 'a' },
  code: { code: 'x', language: 'plain text', filename: 'a.ts' },
  image: { url: 'https://example.com/a.png', caption: 'c', captionVisible: true },
  video: { url: 'https://example.com/a.mp4', caption: 'c', captionVisible: true },
  audio: { url: 'https://example.com/a.mp3', caption: 'c', captionVisible: true, title: 't', artist: 'r' },
  file: { url: 'https://example.com/a.pdf', fileName: 'a.pdf', caption: 'c', captionVisible: true },
  embed: { service: 'youtube', source: 'https://youtu.be/x', embed: 'https://www.youtube.com/embed/x', caption: 'c', captionVisible: true },
  toggle: { text: 'a' },
  list: { text: 'a', style: 'unordered' },
  tab: { title: 't' },
  database: { title: 'T', schema: [{ id: 'p1', name: 'Name', type: 'title', position: 'a0' }], views: [{ id: 'v1', name: 'All', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['p1'] }], activeViewId: 'v1' },
};

describe('inputFields', () => {
  let holder: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    holder.remove();
  });

  it.each(Object.keys(SAMPLES))('%s: declares one field per DOM input when it has more than one', async (name) => {
    const editor = new Blok({ holder, tools: builtInEditorTools(), data: { blocks: [{ id: 'b', type: name, data: SAMPLES[name] }] } }) as unknown as {
      isReady: Promise<void>; destroy(): void; blocks: { getById(id: string): { holder: HTMLElement } | null };
    };

    try {
      await editor.isReady;
      const inputs = editor.blocks.getById('b')?.holder.querySelectorAll('[contenteditable="true"], input, textarea') ?? [];
      const { inputFields, data } = BUILT_IN_BLOCK_DESCRIPTIONS[name]({});

      if (inputs.length > 1) {
        expect(inputFields, `${name} has ${inputs.length} inputs`).toHaveLength(inputs.length);
        inputFields?.forEach(field => expect(Object.keys((data as { properties: object }).properties)).toContain(field));
      }
    } finally {
      editor.destroy();
    }
  }, 60_000);
});
```

The selector is a stand-in for the editor's own input list. Read how `Block.inputs` is computed (`src/components/block/index.ts`) and use the same rule, so the count is the caret code's count. 06 §10.2 says input order across a tool's states is **unverified**; add a second sample per tool for each state that shows or hides an input (e.g. `captionVisible: false`) and assert the declared order still holds for the inputs that render.

Run: `yarn test test/unit/shared/tool-descriptions/input-fields.test.ts`
Expected: FAIL for each multi-input tool, printing its input count.

- [ ] **Step 2: Declare `inputFields`**

For each failing tool, open its `render()` and list the data field each input edits, in DOM order, then add `inputFields: [...]` to its description. A native `<input>` that edits a non-data value (a search box, a URL entry before submit) is not a data field: if one exists, the test must exclude it by a data attribute the tool already sets, and the description's `inputFields` lists only data fields. Write down each such exclusion in the test with the attribute and the file line.

- [ ] **Step 3: Run until PASS, then the generic test**

Run: `yarn test test/unit/shared/tool-descriptions/input-fields.test.ts` → PASS.
Run: `yarn test test/unit/shared/tool-descriptions/descriptions.test.ts` → PASS.
Run: `yarn test test/unit/view/document-schema.test.ts` → PASS (`inputFields` is not part of `data`).

- [ ] **Step 4: Commit**

Stage the test and every description module you changed, by name. Message: `feat(tools): inputFields map data fields to DOM inputs for agent carets`, with the trailer.

### Task 29: Custom tools from a `BlokCustomToolsFile`

**Files:**
- Create: `src/shared/custom-tools-file.ts`
- Test: `test/unit/shared/custom-tools-file.test.ts` (`// @vitest-environment node`)

**Interfaces:**
- Consumes: `buildBuiltInSnapshot` (Task 27), `validateAgainst` (Task 2), `composeToolSanitize` (Task 13), `BUILT_IN_INLINE_SANITIZE` (Task 11), `INLINE_TEXT_SANITIZE` (Task 8).
- Produces (04 and the Jint op consume them):
  - `readCustomToolsFile(value: unknown): BlokCustomToolsFile` — throws `TypeError` with a message naming the bad path when the value is not a valid file (04 §6: `--manifest` rejects a bad file).
  - `snapshotWithCustomTools(base: ToolRegistrySnapshot, file?: BlokCustomToolsFile): ToolRegistrySnapshot` — appends each custom block with `handlers: []` (custom handlers are editor-only, 06 D6), `insertable: true`, all built-in inline tools, no tunes. A custom name equal to a built-in replaces the built-in entry.
  - `runtimesWithCustomTools(base: ToolRuntimeRegistry, file?: BlokCustomToolsFile): ToolRuntimeRegistry` — each custom block's `sanitize` = its JSON `sanitize` rules composed with the built-in inline rules; with no `sanitize`, each rich-text field gets `INLINE_TEXT_SANITIZE` (06 R3-9). Function rules cannot appear (the file is JSON).

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildBuiltInSnapshot } from '../../../src/shared/built-in-snapshot';
import { readCustomToolsFile, runtimesWithCustomTools, snapshotWithCustomTools } from '../../../src/shared/custom-tools-file';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../src/shared/tool-actions';
import { buildToolManifest } from '../../../src/shared/tool-manifest';

const statics = {
  toolbox: [{ name: 'quiz', title: 'Quiz' }], richTextFields: ['question'], acceptsChildren: false, ownsChildren: false,
  isLayout: false, deletesChildren: false, selfPlacesChildren: false, restrictedInTableCell: false,
  conversion: {}, convertible: { import: false, export: false }, hasPrepareInsert: false,
};

const file = {
  formatVersion: 1,
  blocks: [{
    name: 'quiz',
    description: {
      summary: 'A quiz.', data: { type: 'object', properties: { question: { type: 'array' } } },
      actions: [{ name: 'grade', summary: 'Grade.', target: 'block', args: { type: 'object' } }],
    },
    statics,
  }],
};

describe('custom tools file', () => {
  it('rejects a file that is not one', () => {
    expect(() => readCustomToolsFile({ formatVersion: 2, blocks: [] })).toThrow(/formatVersion/);
    expect(() => readCustomToolsFile({ formatVersion: 1, blocks: [{ name: 'x' }] })).toThrow(/blocks\/0/);
  });

  it('adds custom blocks whose actions have no handler outside the browser', () => {
    const snapshot = snapshotWithCustomTools(buildBuiltInSnapshot({ blokVersion: '1' }), readCustomToolsFile(file));
    const quiz = buildToolManifest(snapshot).blocks.find(block => block.name === 'quiz');

    expect(quiz?.level).toBe('described');
    expect(quiz?.actions[0]).toMatchObject({ command: 'quiz.grade', available: false });
  });

  it('gives rich fields the inline rules when the file carries no sanitize', () => {
    const runtimes = runtimesWithCustomTools(BUILT_IN_TOOL_RUNTIMES, readCustomToolsFile(file));

    expect(Object.keys(runtimes.get('quiz')?.sanitize ?? {})).toEqual(['question']);
    expect(runtimes.get('paragraph')).toBe(BUILT_IN_TOOL_RUNTIMES.get('paragraph'));
  });
});
```

Run: `yarn test test/unit/shared/custom-tools-file.test.ts` → FAIL.

- [ ] **Step 2: Implement**

```ts
import type { BlokCustomToolsFile, SanitizerConfig, ToolRegistrySnapshot } from '../../types';
import { INLINE_TEXT_SANITIZE } from './inline-text-sanitize';
import { validateAgainst } from './schema/validate';
import { composeToolSanitize } from './tool-actions/runtime';
import type { ToolRuntimeRegistry } from './tool-actions/runtime';
import { BUILT_IN_INLINE_SANITIZE } from './tool-descriptions/sanitize/inline';

const FILE_SCHEMA = {
  type: 'object',
  required: ['formatVersion', 'blocks'],
  properties: {
    formatVersion: { const: 1 },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'description', 'statics'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1 },
          description: { type: 'object', required: ['summary', 'data'], properties: { summary: { type: 'string' }, data: { type: 'object' } } },
          statics: { type: 'object', required: ['toolbox', 'richTextFields', 'acceptsChildren', 'conversion', 'convertible'] },
          sanitize: { type: 'object' },
        },
      },
    },
  },
};

export const readCustomToolsFile = (value: unknown): BlokCustomToolsFile => {
  const problems = validateAgainst(FILE_SCHEMA, value);

  if (problems.length > 0) {
    throw new TypeError(`Not a Blok custom tools file: ${problems.map(problem => `${problem.path || '/'} ${problem.message}`).join('; ')}`);
  }

  return value as BlokCustomToolsFile;
};

export const snapshotWithCustomTools = (base: ToolRegistrySnapshot, file?: BlokCustomToolsFile): ToolRegistrySnapshot => {
  if (file === undefined) {
    return base;
  }
  const custom = new Set(file.blocks.map(block => block.name));

  return {
    ...base,
    blocks: [
      ...base.blocks.filter(block => !custom.has(block.name)),
      ...file.blocks.map(block => ({
        name: block.name,
        title: block.statics.toolbox[0]?.title ?? block.name,
        description: block.description,
        statics: block.statics,
        insertable: true,
        inlineTools: base.inlineTools.map(tool => tool.name),
        tunes: [],
        // Custom action handlers run only in the browser in v1 (06 D6).
        handlers: [],
      })),
    ],
  };
};

export const runtimesWithCustomTools = (base: ToolRuntimeRegistry, file?: BlokCustomToolsFile): ToolRuntimeRegistry => {
  if (file === undefined) {
    return base;
  }
  const inline = Object.values(BUILT_IN_INLINE_SANITIZE).map(factory => factory());
  const merged = new Map(base);

  file.blocks.forEach((block) => {
    const own = (block.sanitize ?? Object.fromEntries(block.statics.richTextFields.map(field => [field, { ...INLINE_TEXT_SANITIZE }]))) as SanitizerConfig;

    merged.set(block.name, { name: block.name, sanitize: composeToolSanitize(own, inline), actions: {} });
  });

  return merged;
};
```

- [ ] **Step 3: Run the test**

Run: `yarn test test/unit/shared/custom-tools-file.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
npx eslint src/shared/custom-tools-file.ts test/unit/shared/custom-tools-file.test.ts
git add src/shared/custom-tools-file.ts test/unit/shared/custom-tools-file.test.ts
git commit -m "feat(shared): load host custom tools from a BlokCustomToolsFile for Node and Jint

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Checkpoint 3

- [ ] Run, one at a time, every test file from Tasks 16-29, plus `yarn test test/unit/view/document-schema.test.ts`, `yarn test test/unit/view/index.purity.test.ts`, `yarn test test/unit/architecture/view-entry-law.test.ts`, `yarn test test/unit/architecture/published-types-no-src-refs.test.ts`. All PASS.
- [ ] `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` (timeout 600000) PASS.
- [ ] `git pull --rebase && git push`; `git status` up to date.
- [ ] Tell 03: `snapshotFromTools`, `runtimesFromTools`, `inputFields` are on `main`. Tell 04: `buildBuiltInSnapshot`, `readCustomToolsFile`, `snapshotWithCustomTools`, `runtimesWithCustomTools` are on `main`. Tell 01: `viewState` / `guardedFields` values are declared for header, toggle, image, table, database.

---
## Phase 4: Actions

Every task here needs Task 12 (types, fake ctx) and Task 13 (runtimes). Declarations (JSON) go into the tool's description module as an exported `<TOOL>_ACTIONS: ToolActionDeclaration[]` that `describe<Tool>` returns as `actions`. Handlers (code) go into `src/shared/tool-actions/<tool>.ts` as `<TOOL>_ACTION_HANDLERS`, are registered in `BUILT_IN_RUNTIME_PARTS[<key>].actions`, and the tool class gets `public static actionHandlers = <TOOL>_ACTION_HANDLERS;`.

Rules every action task follows:
- Args schemas never declare `id`, `parentId`, `position` (Task 55 enforces it).
- A handler reads its target through `ctx.block`; a `create` handler reads `args.parentId` / `args.position`, which core adds.
- A handler refuses with `ctx.fail('PRECONDITION_FAILED', '<what is wrong and what to do>')`. The message is for a model: say what to do instead.
- Unit tests run the handler against `createFakeCtx` (Task 12) and assert the resulting fake document. Each task also asserts the declared `args` reject a bad call through `validateAgainst`.
- Parity with the UI path and 01's appliers is 05's corpus plus 01's appliers (spec §6 item 6); each action task adds one fixture to `test/unit/shared/tool-actions/__fixtures__/<tool>.json` (input document, command, expected document) for 05 to load. The fixture is written from the fake-ctx result.

### Task 30: Move `TableModel` to `src/shared/table/` with an injected minter

**Files:**
- Move: `src/tools/table/table-model.ts` → `src/shared/table/table-model.ts`; the old path becomes `export * from '../../shared/table/table-model';`
- Modify: `src/shared/table/table-ids.ts` (add `generateTableId`, moved from `src/tools/table/table-ids.ts:10`, still `nanoid(10)`), `src/tools/table/table-ids.ts` (re-export it)
- Create: `src/shared/table/column-widths.ts` (`insertedColumnWidth`, from `computeHalfAvgWidth` + `planInsertColumnWidths`, `src/tools/table/table-operations.ts:245-281`)
- Modify: `test/unit/architecture/table-cell-content-law.test.ts:47-51` (`EXTRA_FILES` gains `'src/shared/table/table-model.ts'` and `'src/shared/tool-actions/table.ts'`, because the law's header says it scans every table file and these leave `src/tools/table`)
- Test: `test/unit/shared/table/table-model-mint.test.ts`

**Interfaces:**
- Produces: `new TableModel(data?: Partial<TableData>, options?: { mintId?: () => string })`. Default `generateTableId` (nanoid), so the editor's RNG does not change. Every `generateTableId()` call inside the model, and `ensureTableIds(repaired)` in `normalizeContent` (`table-model.ts:1708`), use `this.mint`. `SelectionRect`, `MergeResult` exported from the shared module. `insertedColumnWidth(existing: number[], initialColWidth: number | undefined): number`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { insertedColumnWidth } from '../../../../src/shared/table/column-widths';
import { TableModel } from '../../../../src/shared/table/table-model';
import { TableModel as OldPathModel } from '../../../../src/tools/table/table-model';

describe('shared TableModel', () => {
  it('mints row and column ids with the injected minter', () => {
    let n = 0;
    const model = new TableModel({ content: [[{ blocks: [] }]] }, { mintId: () => `x${(n += 1)}` });

    model.addRow();
    model.addColumn();
    const ids = model.snapshot().content.flat().flatMap(cell => [cell.id, cell.rowId]);

    expect(ids.every(id => typeof id === 'string' && id.startsWith('x'))).toBe(true);
  });

  it('is the class the old path exports', () => {
    expect(OldPathModel).toBe(TableModel);
  });

  it('a new column is half the average width, or half the initial width', () => {
    expect(insertedColumnWidth([100, 200], undefined)).toBe(75);
    expect(insertedColumnWidth([100, 200], 150)).toBe(75);
  });
});
```

Run: `yarn test test/unit/shared/table/table-model-mint.test.ts` → FAIL (unresolved).

- [ ] **Step 2: Move and inject**

`git mv src/tools/table/table-model.ts src/shared/table/table-model.ts`. Fix its imports: `./types` (now `src/shared/table/types.ts`, Task 14), `./table-ids` → `./table-ids` (shared), `'../../shared/css-color'` → `'../css-color'`, `'../../shared/table-merge-repair'` → `'../table-merge-repair'`. In the class:

```ts
  private readonly mint: () => string;

  constructor(data?: Partial<TableData>, options: { mintId?: () => string } = {}) {
    // Before normalizeContent: it mints ids for cells that lack them.
    this.mint = options.mintId ?? generateTableId;
    // …existing body unchanged…
  }
```

Replace `generateTableId()` at `addRow` (`:356`) and `addColumn` (`:437`) with `this.mint()`, and `return ensureTableIds(repaired);` (`:1708`) with `return ensureTableIdsWith(repaired, this.mint);`. Grep the file for any other `generateTableId` and replace it the same way.

`src/shared/table/column-widths.ts`:

```ts
/** Width of a column inserted by the UI: half the initial width, else half the current average. */
export const insertedColumnWidth = (existing: number[], initialColWidth: number | undefined): number => (initialColWidth !== undefined
  ? Math.round((initialColWidth / 2) * 100) / 100
  : Math.round((existing.reduce((sum, w) => sum + w, 0) / existing.length / 2) * 100) / 100);
```

and make `planInsertColumnWidths` (`table-operations.ts:245-262`) call it for `inserted`, so both stay one formula.

- [ ] **Step 3: Run the tests**

Run, one at a time: `yarn test test/unit/shared/table/table-model-mint.test.ts`, `yarn test test/unit/tools/table/table-model.test.ts`, `yarn test test/unit/tools/table/table-model-merge.test.ts`, `yarn test test/unit/tools/concurrent-table-ids.test.ts`, `yarn test test/unit/architecture/table-cell-content-law.test.ts`. All PASS.

- [ ] **Step 4: Commit**

```bash
npx eslint src/shared/table/table-model.ts src/shared/table/table-ids.ts src/shared/table/column-widths.ts src/tools/table/table-model.ts src/tools/table/table-ids.ts src/tools/table/table-operations.ts test/unit/architecture/table-cell-content-law.test.ts test/unit/shared/table/table-model-mint.test.ts
git add src/shared/table/table-model.ts src/shared/table/table-ids.ts src/shared/table/column-widths.ts src/tools/table/table-model.ts src/tools/table/table-ids.ts src/tools/table/table-operations.ts test/unit/architecture/table-cell-content-law.test.ts test/unit/shared/table/table-model-mint.test.ts
git commit -m "refactor(table): TableModel in src/shared with an injectable id minter

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 31: `table.create`

**Files:**
- Modify: `src/shared/tool-descriptions/table.ts` (`TABLE_ACTIONS`), `src/shared/tool-actions/table.ts` (helpers + handler), `src/shared/tool-actions/index.ts`, `src/tools/table/index.ts` (`actionHandlers` static)
- Test: `test/unit/shared/tool-actions/table-create.test.ts`

**Interfaces:**
- Produces:
  - `TABLE_ACTIONS: ToolActionDeclaration[]` starting with `create`.
  - `RANGE_ARGS` (a `{ fromRow, fromCol, toRow, toCol }` schema, inclusive) in `src/shared/tool-descriptions/table.ts`. Helpers in `src/shared/tool-actions/table.ts`, used by Tasks 32-37: `rectOf(range): SelectionRect`, `tableTarget(ctx)`, `assertInTable(ctx, model, rect)`, `tableModel(ctx, block)`, `commitTable(ctx, id, model)`, `seedCell(ctx, tableId, model, row, col, text?)`, `copyBlockTree(ctx, sourceId, parentId): string`.
  - `TABLE_ACTION_HANDLERS: Readonly<Record<string, ToolActionImpl>>`.
- `table.create` args: `{ rows: integer ≥ 1, cols: integer ≥ 1, withHeadings?: boolean, withHeadingColumn?: boolean, cells?: RichText[][] }`. Result: `{ id, childIds }` (06 §3.1). Each cell gets one paragraph child with `cells[r][c]` or `[]`. Children are inserted row by row, which is the reading order of the cells.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { validateAgainst } from '../../../../src/shared/schema/validate';
import { TABLE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/table';
import { TABLE_ACTIONS } from '../../../../src/shared/tool-descriptions/table';
import { createFakeCtx, docOf } from './fake-ctx';

const declaration = (name: string): Record<string, unknown> => TABLE_ACTIONS.find(action => action.name === name)?.args ?? {};

describe('table.create', () => {
  it('makes a rows x cols grid with one paragraph per cell, ids on every cell', () => {
    const ctx = createFakeCtx(docOf([]), undefined, 'table');
    const result = TABLE_ACTION_HANDLERS.create.run(ctx, { rows: 2, cols: 3, cells: [[[{ text: 'a' }]]] }, undefined) as { id: string; childIds: string[] };
    const table = ctx.read(result.id);
    const content = (table?.data as { content: Array<Array<{ blocks: string[]; id: string; rowId: string }>> }).content;

    expect(content).toHaveLength(2);
    expect(content[0]).toHaveLength(3);
    expect(result.childIds).toHaveLength(6);
    expect(content.flat().map(cell => cell.blocks[0])).toEqual(result.childIds);
    expect(ctx.read(result.childIds[0])?.data).toEqual({ text: [{ text: 'a' }] });
    expect(new Set(content[0].map(cell => cell.rowId)).size).toBe(1);
    expect(new Set(content.map(row => row[0].id)).size).toBe(1);
  });

  it('inserts a block of the host\'s registry key (Review Focus 4)', () => {
    const ctx = createFakeCtx(docOf([]), undefined, 'grid');
    const { id } = TABLE_ACTION_HANDLERS.create.run(ctx, { rows: 1, cols: 1 }, undefined) as { id: string };

    expect(ctx.read(id)?.type).toBe('grid');
  });

  it('declares rows and cols as required positive integers', () => {
    expect(validateAgainst(declaration('create'), { rows: 0, cols: 2 }).length).toBeGreaterThan(0);
    expect(validateAgainst(declaration('create'), { rows: 1, cols: 1 })).toEqual([]);
  });
});
```

Run: `yarn test test/unit/shared/tool-actions/table-create.test.ts` → FAIL.

- [ ] **Step 2: Declare**

In `src/shared/tool-descriptions/table.ts`:

```ts
import type { ToolActionDeclaration } from '../../../types/tools/tool-description';

const RICH_CELLS = { type: 'array', items: { type: 'array', items: richText('Text of one cell.') } };

export const RANGE_ARGS = {
  type: 'object',
  description: 'Inclusive cell range, zero-based.',
  required: ['fromRow', 'fromCol', 'toRow', 'toCol'],
  additionalProperties: false,
  properties: {
    fromRow: { type: 'integer', minimum: 0 },
    fromCol: { type: 'integer', minimum: 0 },
    toRow: { type: 'integer', minimum: 0 },
    toCol: { type: 'integer', minimum: 0 },
  },
};

export const TABLE_ACTIONS: ToolActionDeclaration[] = [
  {
    name: 'create',
    summary: 'Create a table with rows x cols cells, each holding one paragraph.',
    target: 'create',
    args: {
      type: 'object',
      required: ['rows', 'cols'],
      additionalProperties: false,
      properties: {
        rows: { type: 'integer', minimum: 1 },
        cols: { type: 'integer', minimum: 1 },
        withHeadings: { type: 'boolean' },
        withHeadingColumn: { type: 'boolean' },
        cells: { ...RICH_CELLS, description: 'Optional starting text, row by row.' },
      },
    },
    result: { type: 'object', required: ['id', 'childIds'], properties: { id: { type: 'string' }, childIds: { type: 'array', items: { type: 'string' } } } },
  },
];
```

and `actions: TABLE_ACTIONS` in `describeTable`.

- [ ] **Step 3: Implement helpers and the handler**

Add to `src/shared/tool-actions/table.ts`:

```ts
import type { BlockPosition, RichText, ToolActionContext, ToolActionImpl } from '../../../types';
import { TableModel } from '../table/table-model';
import type { SelectionRect } from '../table/table-model';
import type { TableData } from '../table/types';

type TargetBlock = NonNullable<ToolActionContext['block']>;

export interface CellRange { fromRow: number; fromCol: number; toRow: number; toCol: number }

export const rectOf = (range: CellRange): SelectionRect => ({
  minRow: Math.min(range.fromRow, range.toRow),
  maxRow: Math.max(range.fromRow, range.toRow),
  minCol: Math.min(range.fromCol, range.toCol),
  maxCol: Math.max(range.fromCol, range.toCol),
});

export const tableTarget = (ctx: ToolActionContext): TargetBlock =>
  ctx.block ?? ctx.fail('INVALID_ARGS', 'Pass the id of a table block.');

export const assertInTable = (ctx: ToolActionContext, model: TableModel, rect: SelectionRect): void => {
  if (rect.maxRow >= model.rows || rect.maxCol >= model.cols) {
    ctx.fail('PRECONDITION_FAILED', `The table is ${model.rows} rows x ${model.cols} columns; indices start at 0.`);
  }
};

export const tableModel = (ctx: ToolActionContext, block: TargetBlock): TableModel =>
  new TableModel(block.data as Partial<TableData>, { mintId: () => ctx.newId() });

export const commitTable = (ctx: ToolActionContext, id: string, model: TableModel): void => {
  const { content, colWidths } = model.snapshot();

  ctx.update(id, colWidths === undefined ? { content } : { content, colWidths });
};

// Cells hold paragraphs: an empty cell must still have one block, or nothing in it can be typed into.
export const seedCell = (ctx: ToolActionContext, tableId: string, model: TableModel, row: number, col: number, text: RichText = []): string => {
  const id = ctx.insert({ type: 'paragraph', data: { text }, parentId: tableId });

  model.addBlockToCell(row, col, id);

  return id;
};

export const copyBlockTree = (ctx: ToolActionContext, sourceId: string, parentId: string): string => {
  const source = ctx.read(sourceId) ?? ctx.fail('PRECONDITION_FAILED', `Block ${sourceId} does not exist.`);
  const id = ctx.insert({ type: source.type, data: structuredCopy(source.data), parentId });

  source.children.forEach(child => copyBlockTree(ctx, child, id));

  return id;
};

// The Jint realm has no structuredClone; block data is JSON.
const structuredCopy = (value: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(value ?? {})) as Record<string, unknown>;

interface CreateArgs {
  rows: number;
  cols: number;
  withHeadings?: boolean;
  withHeadingColumn?: boolean;
  cells?: RichText[][];
  parentId?: string | null;
  position?: BlockPosition;
}

const create: ToolActionImpl<CreateArgs, undefined, { id: string; childIds: string[] }> = {
  run: (ctx, args) => {
    const id = ctx.insert({
      // The host's registry key, not 'table': a host may register the tool as 'grid' (Review Focus 4).
      type: ctx.tool,
      data: { withHeadings: args.withHeadings ?? false, withHeadingColumn: args.withHeadingColumn ?? false, content: [] },
      parentId: args.parentId,
      position: args.position,
    });
    const columnIds = Array.from({ length: args.cols }, () => ctx.newId());
    const childIds: string[] = [];
    const content = Array.from({ length: args.rows }, (_, row) => {
      const rowId = ctx.newId();

      return columnIds.map((columnId, col) => {
        const blockId = ctx.insert({ type: 'paragraph', data: { text: args.cells?.[row]?.[col] ?? [] }, parentId: id });

        childIds.push(blockId);

        return { blocks: [blockId], id: columnId, rowId };
      });
    });

    ctx.update(id, { content });

    return { id, childIds };
  },
};

export const TABLE_ACTION_HANDLERS: Readonly<Record<string, ToolActionImpl>> = { create };
```

Move `structuredCopy` above `copyBlockTree` when writing the file. Register `table: { normalize: normalizeTable, actions: TABLE_ACTION_HANDLERS }` in `BUILT_IN_RUNTIME_PARTS`, and `public static actionHandlers = TABLE_ACTION_HANDLERS;` on `Table`.

- [ ] **Step 4: Run the tests**

Run, one at a time: `yarn test test/unit/shared/tool-actions/table-create.test.ts`, `yarn test test/unit/shared/tool-descriptions/descriptions.test.ts`, `yarn test test/unit/view/document-schema.test.ts`. All PASS.

- [ ] **Step 5: Commit**

```bash
npx eslint src/shared/tool-descriptions/table.ts src/shared/tool-actions/table.ts src/shared/tool-actions/index.ts src/tools/table/index.ts test/unit/shared/tool-actions/table-create.test.ts
git add src/shared/tool-descriptions/table.ts src/shared/tool-actions/table.ts src/shared/tool-actions/index.ts src/tools/table/index.ts test/unit/shared/tool-actions/table-create.test.ts
git commit -m "feat(table): table.create action

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 32: `table.insertRows`, `table.insertColumns`

**Files:** `src/shared/tool-descriptions/table.ts`, `src/shared/tool-actions/table.ts`; Test: `test/unit/shared/tool-actions/table-insert.test.ts`

**Interfaces:**
- `insertRows` args `{ at: integer ≥ 0, count?: integer ≥ 1 (default 1), cells?: RichText[][] }`. Result `{ childIds }`. Uses `TableModel.addRow(at + i)` (`table-model.ts:352`); seeds every new cell that `isSpannedCell` (`:741`, "covered by a merge") reports false.
- `insertColumns` args `{ at, count?, cells? }` where `cells[i][r]` is column i, row r. Uses `addColumn(at + i, width)` (`:430`). When the table has `colWidths`, `width` is `insertedColumnWidth(current, initialColWidth)` (Task 30); without `colWidths` the table fits the page and no width is written.
- Both `mirrors` stay empty until Task 54.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { TABLE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/table';
import { createFakeCtx, docOf } from './fake-ctx';
import type { FakeCtx } from './fake-ctx';

const make = (rows: number, cols: number, extra: Record<string, unknown> = {}): { ctx: FakeCtx; id: string } => {
  const ctx = createFakeCtx(docOf([]), undefined, 'table');
  const { id } = TABLE_ACTION_HANDLERS.create.run(ctx, { rows, cols }, undefined) as { id: string };

  ctx.update(id, extra);

  return { ctx: createFakeCtx(ctx.doc, id), id };
};

const grid = (ctx: FakeCtx, id: string): Array<Array<{ blocks: string[]; id?: string; rowId?: string }>> =>
  (ctx.read(id)?.data as { content: Array<Array<{ blocks: string[] }>> }).content;

describe('table.insertRows / insertColumns', () => {
  it('inserts two rows at index 1, each cell seeded, column ids shared', () => {
    const { ctx, id } = make(2, 2);
    const result = TABLE_ACTION_HANDLERS.insertRows.run(ctx, { at: 1, count: 2 }, undefined) as { childIds: string[] };
    const content = grid(ctx, id);

    expect(content).toHaveLength(4);
    expect(result.childIds).toHaveLength(4);
    expect(content[1].map(cell => cell.blocks.length)).toEqual([1, 1]);
    expect(content[1][0].id).toBe(content[0][0].id);
  });

  it('inserts a column with half the average width when widths are set', () => {
    const { ctx, id } = make(1, 2, { colWidths: [100, 200] });

    TABLE_ACTION_HANDLERS.insertColumns.run(ctx, { at: 2 }, undefined);

    expect((ctx.read(id)?.data as { colWidths: number[] }).colWidths).toEqual([100, 200, 75]);
    expect(grid(ctx, id)[0]).toHaveLength(3);
  });

  it('writes no widths for a fit-to-page table', () => {
    const { ctx, id } = make(1, 2);

    TABLE_ACTION_HANDLERS.insertColumns.run(ctx, { at: 0 }, undefined);

    expect((ctx.read(id)?.data as { colWidths?: number[] }).colWidths).toBeUndefined();
  });
});
```

Run: `yarn test test/unit/shared/tool-actions/table-insert.test.ts` → FAIL.

- [ ] **Step 2: Declare and implement**

Declarations (append to `TABLE_ACTIONS`):

```ts
  {
    name: 'insertRows',
    summary: 'Insert empty rows before row `at` (use the row count to append).',
    target: 'block',
    args: {
      type: 'object', required: ['at'], additionalProperties: false,
      properties: { at: { type: 'integer', minimum: 0 }, count: { type: 'integer', minimum: 1, default: 1 }, cells: { ...RICH_CELLS, description: 'Optional text for the new rows, row by row.' } },
    },
    result: { type: 'object', properties: { childIds: { type: 'array', items: { type: 'string' } } } },
  },
  {
    name: 'insertColumns',
    summary: 'Insert empty columns before column `at` (use the column count to append).',
    target: 'block',
    args: {
      type: 'object', required: ['at'], additionalProperties: false,
      properties: { at: { type: 'integer', minimum: 0 }, count: { type: 'integer', minimum: 1, default: 1 }, cells: { ...RICH_CELLS, description: 'Optional text for the new columns, column by column.' } },
    },
    result: { type: 'object', properties: { childIds: { type: 'array', items: { type: 'string' } } } },
  },
```

Handlers:

```ts
interface InsertArgs { at: number; count?: number; cells?: RichText[][] }

const insertRows: ToolActionImpl<InsertArgs, undefined, { childIds: string[] }> = {
  run: (ctx, args) => {
    const block = tableTarget(ctx);
    const model = tableModel(ctx, block);
    const count = args.count ?? 1;
    const at = Math.min(args.at, model.rows);
    const childIds: string[] = [];

    Array.from({ length: count }, (_, i) => at + i).forEach((row, i) => {
      model.addRow(row);
      Array.from({ length: model.cols }, (_, col) => col)
        .filter(col => !model.isSpannedCell(row, col))
        .forEach(col => childIds.push(seedCell(ctx, block.id, model, row, col, args.cells?.[i]?.[col] ?? [])));
    });
    commitTable(ctx, block.id, model);

    return { childIds };
  },
};

const insertColumns: ToolActionImpl<InsertArgs, undefined, { childIds: string[] }> = {
  run: (ctx, args) => {
    const block = tableTarget(ctx);
    const model = tableModel(ctx, block);
    const at = Math.min(args.at, model.cols);
    const childIds: string[] = [];

    Array.from({ length: args.count ?? 1 }, (_, i) => at + i).forEach((col, i) => {
      const widths = model.colWidths;
      const { cellsToPopulate } = model.addColumn(col, widths === undefined ? undefined : insertedColumnWidth(widths, model.initialColWidth));

      cellsToPopulate
        .filter(cell => !model.isSpannedCell(cell.row, cell.col))
        .forEach(cell => childIds.push(seedCell(ctx, block.id, model, cell.row, cell.col, args.cells?.[i]?.[cell.row] ?? [])));
    });
    commitTable(ctx, block.id, model);

    return { childIds };
  },
};
```

Add both to `TABLE_ACTION_HANDLERS`; import `insertedColumnWidth` from `'../table/column-widths'`.

- [ ] **Step 3: Run, then commit**

Run: `yarn test test/unit/shared/tool-actions/table-insert.test.ts` → PASS.

```bash
npx eslint src/shared/tool-descriptions/table.ts src/shared/tool-actions/table.ts test/unit/shared/tool-actions/table-insert.test.ts
git add src/shared/tool-descriptions/table.ts src/shared/tool-actions/table.ts test/unit/shared/tool-actions/table-insert.test.ts
git commit -m "feat(table): table.insertRows and table.insertColumns actions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 33: `table.deleteRows`, `table.deleteColumns`

**Files:** `src/shared/tool-descriptions/table.ts`, `src/shared/tool-actions/table.ts`; Test: `test/unit/shared/tool-actions/table-delete.test.ts`

**Interfaces:**
- Args `{ at: integer ≥ 0, count?: integer ≥ 1 }`. Precondition: at least one row (column) remains; `at + count` within the table. Uses `deleteRow` / `deleteColumn` (`table-model.ts:380`, `:467`), deleting from the highest index down so indices stay valid. Every id in `blocksToDelete` is removed with `withChildren: true` (a cell block's nested list items go with it).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { TABLE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/table';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

const make = (rows: number, cols: number) => {
  const seed = createFakeCtx(docOf([]), undefined, 'table');
  const { id, childIds } = TABLE_ACTION_HANDLERS.create.run(seed, { rows, cols }, undefined) as { id: string; childIds: string[] };

  return { ctx: createFakeCtx(seed.doc, id), id, childIds };
};

describe('table.deleteRows / deleteColumns', () => {
  it('deletes rows and their cell blocks', () => {
    const { ctx, id, childIds } = make(3, 2);

    TABLE_ACTION_HANDLERS.deleteRows.run(ctx, { at: 0, count: 2 }, undefined);

    expect((ctx.read(id)?.data as { content: unknown[] }).content).toHaveLength(1);
    expect(ctx.read(childIds[0])).toBeNull();
    expect(ctx.read(childIds[4])).not.toBeNull();
  });

  it('refuses to delete the last row or column', () => {
    const { ctx } = make(1, 2);

    expect(() => TABLE_ACTION_HANDLERS.deleteRows.run(ctx, { at: 0 }, undefined)).toThrow(FakeFailure);
    const narrow = make(2, 1);

    expect(() => TABLE_ACTION_HANDLERS.deleteColumns.run(narrow.ctx, { at: 0 }, undefined)).toThrow(FakeFailure);
  });

  it('refuses a range past the end', () => {
    expect(() => TABLE_ACTION_HANDLERS.deleteColumns.run(make(2, 2).ctx, { at: 1, count: 2 }, undefined)).toThrow(/past the end/);
  });
});
```

Run: `yarn test test/unit/shared/tool-actions/table-delete.test.ts` → FAIL.

- [ ] **Step 2: Declare and implement**

```ts
  {
    name: 'deleteRows',
    summary: 'Delete rows and the blocks in their cells.',
    target: 'block',
    preconditions: ['At least one row must remain.'],
    args: { type: 'object', required: ['at'], additionalProperties: false, properties: { at: { type: 'integer', minimum: 0 }, count: { type: 'integer', minimum: 1, default: 1 } } },
  },
  {
    name: 'deleteColumns',
    summary: 'Delete columns and the blocks in their cells.',
    target: 'block',
    preconditions: ['At least one column must remain.'],
    args: { type: 'object', required: ['at'], additionalProperties: false, properties: { at: { type: 'integer', minimum: 0 }, count: { type: 'integer', minimum: 1, default: 1 } } },
  },
```

```ts
const deleteLines = (kind: 'row' | 'column'): ToolActionImpl<{ at: number; count?: number }> => ({
  run: (ctx, args) => {
    const block = tableTarget(ctx);
    const model = tableModel(ctx, block);
    const total = kind === 'row' ? model.rows : model.cols;
    const count = args.count ?? 1;

    if (args.at + count > total) {
      ctx.fail('PRECONDITION_FAILED', `That ${kind} range runs past the end: the table has ${total} ${kind}s.`);
    }
    if (count >= total) {
      ctx.fail('PRECONDITION_FAILED', `A table keeps at least one ${kind}. Delete the table with block.delete instead.`);
    }

    // Highest index first, so the indices still to delete do not shift.
    Array.from({ length: count }, (_, i) => args.at + count - 1 - i).forEach((index) => {
      const { blocksToDelete } = kind === 'row' ? model.deleteRow(index) : model.deleteColumn(index);

      blocksToDelete.forEach(id => ctx.remove(id, { withChildren: true }));
    });
    commitTable(ctx, block.id, model);

    return undefined;
  },
});
```

Register `deleteRows: deleteLines('row')`, `deleteColumns: deleteLines('column')`.

- [ ] **Step 3: Run, then commit**

Run: `yarn test test/unit/shared/tool-actions/table-delete.test.ts` → PASS.

```bash
npx eslint src/shared/tool-descriptions/table.ts src/shared/tool-actions/table.ts test/unit/shared/tool-actions/table-delete.test.ts
git add src/shared/tool-descriptions/table.ts src/shared/tool-actions/table.ts test/unit/shared/tool-actions/table-delete.test.ts
git commit -m "feat(table): table.deleteRows and table.deleteColumns actions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 34: `table.moveRow`, `table.moveColumn`

**Files:** `src/shared/tool-descriptions/table.ts`, `src/shared/tool-actions/table.ts`; Test: `test/unit/shared/tool-actions/table-move.test.ts`

**Interfaces:**
- Args `{ from: integer ≥ 0, to: integer ≥ 0 }`. Precondition: `canMoveRow` / `canMoveColumn` (`table-model.ts:794`, `:811`) — a move that would tear a merge is refused. Uses `moveRow` / `moveColumn` (`:404`, `:501`), which also move `colWidths`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { TABLE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/table';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

describe('table.moveRow / moveColumn', () => {
  it('moves a row and keeps its cells', () => {
    const seed = createFakeCtx(docOf([]), undefined, 'table');
    const { id, childIds } = TABLE_ACTION_HANDLERS.create.run(seed, { rows: 3, cols: 1 }, undefined) as { id: string; childIds: string[] };
    const ctx = createFakeCtx(seed.doc, id);

    TABLE_ACTION_HANDLERS.moveRow.run(ctx, { from: 0, to: 2 }, undefined);

    expect((ctx.read(id)?.data as { content: Array<Array<{ blocks: string[] }>> }).content.map(row => row[0].blocks[0]))
      .toEqual([childIds[1], childIds[2], childIds[0]]);
  });

  it('refuses a move that would tear a merge', () => {
    const seed = createFakeCtx(docOf([]), undefined, 'table');
    const { id } = TABLE_ACTION_HANDLERS.create.run(seed, { rows: 3, cols: 2 }, undefined) as { id: string };
    const ctx = createFakeCtx(seed.doc, id);

    TABLE_ACTION_HANDLERS.mergeCells.run(ctx, { range: { fromRow: 0, fromCol: 0, toRow: 1, toCol: 0 } }, undefined);

    expect(() => TABLE_ACTION_HANDLERS.moveRow.run(createFakeCtx(ctx.doc, id), { from: 0, to: 2 }, undefined)).toThrow(FakeFailure);
  });
});
```

The second case uses `mergeCells` from Task 37. Mark it `it.todo` here and turn it on in Task 37.

Run: `yarn test test/unit/shared/tool-actions/table-move.test.ts` → FAIL.

- [ ] **Step 2: Declare and implement**

```ts
  { name: 'moveRow', summary: 'Move one row to another index.', target: 'block', preconditions: ['The row is not part of a merge and does not land inside one.'],
    args: { type: 'object', required: ['from', 'to'], additionalProperties: false, properties: { from: { type: 'integer', minimum: 0 }, to: { type: 'integer', minimum: 0 } } } },
  { name: 'moveColumn', summary: 'Move one column to another index.', target: 'block', preconditions: ['The column is not part of a merge and does not land inside one.'],
    args: { type: 'object', required: ['from', 'to'], additionalProperties: false, properties: { from: { type: 'integer', minimum: 0 }, to: { type: 'integer', minimum: 0 } } } },
```

```ts
const moveLine = (kind: 'row' | 'column'): ToolActionImpl<{ from: number; to: number }> => ({
  run: (ctx, args) => {
    const block = tableTarget(ctx);
    const model = tableModel(ctx, block);
    const total = kind === 'row' ? model.rows : model.cols;

    if (args.from >= total || args.to >= total) {
      ctx.fail('PRECONDITION_FAILED', `The table has ${total} ${kind}s; indices start at 0.`);
    }
    if (!(kind === 'row' ? model.canMoveRow(args.from, args.to) : model.canMoveColumn(args.from, args.to))) {
      ctx.fail('PRECONDITION_FAILED', `That ${kind} move would split a merged cell. Split it first with table.splitCell.`);
    }
    if (kind === 'row') {
      model.moveRow(args.from, args.to);
    } else {
      model.moveColumn(args.from, args.to);
    }
    commitTable(ctx, block.id, model);

    return undefined;
  },
});
```

Register `moveRow: moveLine('row')`, `moveColumn: moveLine('column')`.

- [ ] **Step 3: Run, then commit**

Run: `yarn test test/unit/shared/tool-actions/table-move.test.ts` → PASS (one todo).

```bash
npx eslint src/shared/tool-descriptions/table.ts src/shared/tool-actions/table.ts test/unit/shared/tool-actions/table-move.test.ts
git add src/shared/tool-descriptions/table.ts src/shared/tool-actions/table.ts test/unit/shared/tool-actions/table-move.test.ts
git commit -m "feat(table): table.moveRow and table.moveColumn actions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 35: `table.duplicateRows`, `table.duplicateColumns`, `table.clearCells`

**Files:** `src/shared/tool-descriptions/table.ts`, `src/shared/tool-actions/table.ts`; Test: `test/unit/shared/tool-actions/table-duplicate-clear.test.ts`

**Interfaces:**
- `duplicateRows` / `duplicateColumns` args `{ at, count? }`: inserts copies right after the range. Each new cell gets a deep copy of the source cell's blocks (`copyBlockTree`) and the source's `color`, `textColor`, `placement`. This mirrors `duplicateRangeContent` (`src/tools/table/table-subsystems.ts:826-860`), which copies blocks then colours and placement.
- `clearCells` args `{ range }` (`RANGE_ARGS`): removes every block in the range's cells and re-seeds each visible cell with one empty paragraph. The UI deletes the blocks and lets its mutation handler re-seed (`table-subsystems.ts:910-928`); headless there is no handler, so the action seeds.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { TABLE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/table';
import { createFakeCtx, docOf } from './fake-ctx';

const make = (rows: number, cols: number) => {
  const seed = createFakeCtx(docOf([]), undefined, 'table');
  const { id, childIds } = TABLE_ACTION_HANDLERS.create.run(seed, { rows, cols, cells: [[[{ text: 'a' }], [{ text: 'b' }]]] }, undefined) as { id: string; childIds: string[] };

  return { ctx: createFakeCtx(seed.doc, id), id, childIds };
};

type Cell = { blocks: string[]; color?: string };
const content = (ctx: ReturnType<typeof createFakeCtx>, id: string): Cell[][] => (ctx.read(id)?.data as { content: Cell[][] }).content;

describe('table.duplicateRows / clearCells', () => {
  it('copies a row after itself with fresh blocks of the same text and colour', () => {
    const { ctx, id } = make(1, 2);

    TABLE_ACTION_HANDLERS.styleCells?.run(ctx, { range: { fromRow: 0, fromCol: 0, toRow: 0, toCol: 0 }, color: 'red' }, undefined);
    TABLE_ACTION_HANDLERS.duplicateRows.run(createFakeCtx(ctx.doc, id), { at: 0 }, undefined);
    const [first, copy] = content(ctx, id);

    expect(copy[0].blocks[0]).not.toBe(first[0].blocks[0]);
    expect(ctx.read(copy[0].blocks[0])?.data).toEqual({ text: [{ text: 'a' }] });
  });

  it('clears a range and leaves one empty paragraph per cell', () => {
    const { ctx, id, childIds } = make(1, 2);

    TABLE_ACTION_HANDLERS.clearCells.run(ctx, { range: { fromRow: 0, fromCol: 0, toRow: 0, toCol: 1 } }, undefined);
    const [row] = content(ctx, id);

    expect(ctx.read(childIds[0])).toBeNull();
    expect(row.map(cell => cell.blocks.length)).toEqual([1, 1]);
    expect(ctx.read(row[0].blocks[0])?.data).toEqual({ text: [] });
  });
});
```

The colour line uses `styleCells` from Task 36 (`?.` keeps it a no-op until then); after Task 36, add `expect(copy[0].color).toBe('red')`.

Run: `yarn test test/unit/shared/tool-actions/table-duplicate-clear.test.ts` → FAIL.

- [ ] **Step 2: Declare and implement**

Declarations follow the Task 33 shape (`{ at, count? }`) for the two duplicate actions, and `{ range: RANGE_ARGS }` (required) for `clearCells`, summary "Empty the cells in a range; each keeps one empty paragraph." Handlers:

```ts
const duplicateLines = (kind: 'row' | 'column'): ToolActionImpl<{ at: number; count?: number }> => ({
  run: (ctx, args) => {
    const block = tableTarget(ctx);
    const model = tableModel(ctx, block);
    const count = args.count ?? 1;
    const lineCount = kind === 'row' ? model.cols : model.rows;

    Array.from({ length: count }, (_, i) => args.at + i).forEach((source, i) => {
      const target = args.at + count + i;
      const widths = model.colWidths;

      if (kind === 'row') {
        model.addRow(target);
      } else {
        model.addColumn(target, widths === undefined ? undefined : widths[source]);
      }

      Array.from({ length: lineCount }, (_, k) => k).forEach((k) => {
        const [sourceRow, sourceCol, row, col] = kind === 'row' ? [source, k, target, k] : [k, source, k, target];

        if (model.isSpannedCell(row, col)) {
          return;
        }
        model.getCellBlocks(sourceRow, sourceCol).forEach(id => model.addBlockToCell(row, col, copyBlockTree(ctx, id, block.id)));
        if (model.getCellBlocks(row, col).length === 0) {
          seedCell(ctx, block.id, model, row, col);
        }
        model.setCellColor(row, col, model.getCellColor(sourceRow, sourceCol));
        model.setCellTextColor(row, col, model.getCellTextColor(sourceRow, sourceCol));
        model.setCellPlacement(row, col, model.getCellPlacement(sourceRow, sourceCol));
      });
    });
    commitTable(ctx, block.id, model);

    return undefined;
  },
});

const clearCells: ToolActionImpl<{ range: CellRange }> = {
  run: (ctx, args) => {
    const block = tableTarget(ctx);
    const model = tableModel(ctx, block);
    const rect = rectOf(args.range);

    for (let row = rect.minRow; row <= rect.maxRow; row += 1) {
      for (let col = rect.minCol; col <= rect.maxCol; col += 1) {
        if (model.isSpannedCell(row, col)) {
          continue;
        }
        model.getCellBlocks(row, col).forEach(id => ctx.remove(id, { withChildren: true }));
        model.setCellBlocks(row, col, []);
        seedCell(ctx, block.id, model, row, col);
      }
    }
    commitTable(ctx, block.id, model);

    return undefined;
  },
};
```

Copies are inserted after the whole source range, so source indices never shift. Guards: `clearCells` calls `assertInTable(ctx, model, rect)` right after building `rect`; the duplicate actions fail with `PRECONDITION_FAILED` when `args.at + count` exceeds the row (column) count, with the Task 33 message. Task 36 and Task 37 call `assertInTable` the same way in `styleCells`, `fillCells` and `mergeCells`.

- [ ] **Step 3: Run, then commit**

Run: `yarn test test/unit/shared/tool-actions/table-duplicate-clear.test.ts` → PASS.

```bash
npx eslint src/shared/tool-descriptions/table.ts src/shared/tool-actions/table.ts test/unit/shared/tool-actions/table-duplicate-clear.test.ts
git add src/shared/tool-descriptions/table.ts src/shared/tool-actions/table.ts test/unit/shared/tool-actions/table-duplicate-clear.test.ts
git commit -m "feat(table): duplicate rows and columns, clear cells

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 36: `table.styleCells`, `table.fillCells`

**Files:** `src/shared/tool-descriptions/table.ts`, `src/shared/tool-actions/table.ts`; Test: `test/unit/shared/tool-actions/table-style-fill.test.ts`

**Interfaces:**
- `styleCells` args `{ range, color?: string | null, textColor?: string | null, placement?: <9-way enum> | null }`. `null` clears. At least one of the three. Uses `setCellColor` / `setCellTextColor` / `setCellPlacement` (`table-model.ts:268`, `:298`, `:325`). The model refuses unsafe CSS colours (`isSafeCssColor`, `table-model.ts:4`); the action reports a refused colour with `PRECONDITION_FAILED`.
- `fillCells` args `{ range, direction: 'right' | 'down' }`. The first column (right) or first row (down) of the range is the source. Each other visible cell's blocks are replaced by copies of its source cell's blocks; a covered source copies its merge origin. Mirrors `handleCellFill` (`src/tools/table/table-subsystems.ts:1273-1312`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { TABLE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/table';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

const make = () => {
  const seed = createFakeCtx(docOf([]), undefined, 'table');
  const { id } = TABLE_ACTION_HANDLERS.create.run(seed, { rows: 2, cols: 2, cells: [[[{ text: 'src' }]]] }, undefined) as { id: string };

  return { ctx: createFakeCtx(seed.doc, id), id };
};

type Cell = { blocks: string[]; color?: string; placement?: string };
const cells = (ctx: ReturnType<typeof createFakeCtx>, id: string): Cell[][] => (ctx.read(id)?.data as { content: Cell[][] }).content;

describe('table.styleCells / fillCells', () => {
  it('colours and places a range, and null clears', () => {
    const { ctx, id } = make();

    TABLE_ACTION_HANDLERS.styleCells.run(ctx, { range: { fromRow: 0, fromCol: 0, toRow: 1, toCol: 0 }, color: 'red', placement: 'middle-center' }, undefined);
    expect(cells(ctx, id).map(row => row[0].color)).toEqual(['red', 'red']);
    TABLE_ACTION_HANDLERS.styleCells.run(createFakeCtx(ctx.doc, id), { range: { fromRow: 0, fromCol: 0, toRow: 0, toCol: 0 }, color: null }, undefined);
    expect(cells(ctx, id)[0][0].color).toBeUndefined();
  });

  it('refuses a style call that sets nothing', () => {
    expect(() => TABLE_ACTION_HANDLERS.styleCells.run(make().ctx, { range: { fromRow: 0, fromCol: 0, toRow: 0, toCol: 0 } }, undefined)).toThrow(FakeFailure);
  });

  it('fills down with copies of the top cell', () => {
    const { ctx, id } = make();

    TABLE_ACTION_HANDLERS.fillCells.run(ctx, { range: { fromRow: 0, fromCol: 0, toRow: 1, toCol: 0 }, direction: 'down' }, undefined);
    const [[top], [bottom]] = cells(ctx, id);

    expect(bottom.blocks[0]).not.toBe(top.blocks[0]);
    expect(ctx.read(bottom.blocks[0])?.data).toEqual({ text: [{ text: 'src' }] });
  });
});
```

Run: `yarn test test/unit/shared/tool-actions/table-style-fill.test.ts` → FAIL.

- [ ] **Step 2: Declare and implement**

```ts
const PLACEMENTS = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];

  {
    name: 'styleCells',
    summary: 'Set or clear background colour, text colour and placement on a range of cells.',
    guidance: 'Colours take a preset name (gray, brown, orange, yellow, green, blue, purple, pink, red) or a CSS colour. null clears.',
    target: 'block',
    args: {
      type: 'object', required: ['range'], additionalProperties: false,
      properties: {
        range: RANGE_ARGS,
        color: { type: ['string', 'null'] },
        textColor: { type: ['string', 'null'] },
        placement: { anyOf: [{ enum: PLACEMENTS }, { type: 'null' }] },
      },
    },
  },
  {
    name: 'fillCells',
    summary: 'Copy the first column (right) or first row (down) of a range across the range.',
    target: 'block',
    args: { type: 'object', required: ['range', 'direction'], additionalProperties: false, properties: { range: RANGE_ARGS, direction: { enum: ['right', 'down'] } } },
  },
```

`RANGE_ARGS` (Task 31) and `PLACEMENTS` live in `src/shared/tool-descriptions/table.ts`: declarations are JSON, and descriptions never import from `tool-actions`.

```ts
interface StyleArgs { range: CellRange; color?: string | null; textColor?: string | null; placement?: CellPlacement | null }

const styleCells: ToolActionImpl<StyleArgs> = {
  run: (ctx, args) => {
    if (args.color === undefined && args.textColor === undefined && args.placement === undefined) {
      ctx.fail('INVALID_ARGS', 'Pass color, textColor or placement (null clears one).');
    }
    const block = tableTarget(ctx);
    const model = tableModel(ctx, block);
    const rect = rectOf(args.range);

    for (let row = rect.minRow; row <= rect.maxRow; row += 1) {
      for (let col = rect.minCol; col <= rect.maxCol; col += 1) {
        if (args.color !== undefined) {
          model.setCellColor(row, col, args.color ?? undefined);
        }
        if (args.textColor !== undefined) {
          model.setCellTextColor(row, col, args.textColor ?? undefined);
        }
        if (args.placement !== undefined) {
          model.setCellPlacement(row, col, args.placement ?? undefined);
        }
      }
    }
    if (typeof args.color === 'string' && model.getCellColor(rect.minRow, rect.minCol) !== args.color) {
      ctx.fail('PRECONDITION_FAILED', `"${args.color}" is not a colour the table accepts. Use a preset name or a plain CSS colour.`);
    }
    commitTable(ctx, block.id, model);

    return undefined;
  },
};

const fillCells: ToolActionImpl<{ range: CellRange; direction: 'right' | 'down' }> = {
  run: (ctx, args) => {
    const block = tableTarget(ctx);
    const model = tableModel(ctx, block);
    const rect = rectOf(args.range);

    for (let row = rect.minRow; row <= rect.maxRow; row += 1) {
      for (let col = rect.minCol; col <= rect.maxCol; col += 1) {
        const isSource = args.direction === 'right' ? col === rect.minCol : row === rect.minRow;

        if (isSource || model.isSpannedCell(row, col)) {
          continue;
        }
        const [sourceRow, sourceCol] = args.direction === 'right' ? [row, rect.minCol] : [rect.minRow, col];
        const [originRow, originCol] = model.getMergeOrigin(sourceRow, sourceCol) ?? [sourceRow, sourceCol];

        model.getCellBlocks(row, col).forEach(id => ctx.remove(id, { withChildren: true }));
        model.setCellBlocks(row, col, model.getCellBlocks(originRow, originCol).map(id => copyBlockTree(ctx, id, block.id)));
      }
    }
    commitTable(ctx, block.id, model);

    return undefined;
  },
};
```

`CellPlacement` comes from `src/shared/table/types.ts`. The colour check reads back one cell: the model ignores an unsafe colour (read `table-model.ts:268-286` to confirm it leaves the old value; if it throws instead, catch and fail with the same message).

- [ ] **Step 3: Run, then commit**

Run: `yarn test test/unit/shared/tool-actions/table-style-fill.test.ts` → PASS. Re-run `table-duplicate-clear.test.ts` with the colour assertion from Task 35 enabled → PASS.

```bash
npx eslint src/shared/tool-descriptions/table.ts src/shared/tool-actions/table.ts test/unit/shared/tool-actions/table-style-fill.test.ts test/unit/shared/tool-actions/table-duplicate-clear.test.ts
git add src/shared/tool-descriptions/table.ts src/shared/tool-actions/table.ts test/unit/shared/tool-actions/table-style-fill.test.ts test/unit/shared/tool-actions/table-duplicate-clear.test.ts
git commit -m "feat(table): table.styleCells and table.fillCells actions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 37: `table.mergeCells`, `table.splitCell`

**Files:** `src/shared/tool-descriptions/table.ts`, `src/shared/tool-actions/table.ts`; Test: `test/unit/shared/tool-actions/table-merge.test.ts`; turn on the todo in `table-move.test.ts`

**Interfaces:**
- `mergeCells` args `{ range }`. Precondition: `canMergeCells(rect)` (`table-model.ts:555`): at least two cells, in bounds, no partial overlap with another merge. `mergeCells` (`:616`) moves the absorbed cells' blocks into the origin cell (`blocksToRelocate`); block ids do not change, so no block is written.
- `splitCell` args `{ row, col }`. Precondition: the cell is a merge origin (`isMergedCell`, `:727`). `splitCell` (`:708`) frees cells with no blocks; each freed visible cell is seeded.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { TABLE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/table';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

const make = () => {
  const seed = createFakeCtx(docOf([]), undefined, 'table');
  const { id, childIds } = TABLE_ACTION_HANDLERS.create.run(seed, { rows: 2, cols: 2 }, undefined) as { id: string; childIds: string[] };

  return { ctx: createFakeCtx(seed.doc, id), id, childIds };
};

type Cell = { blocks: string[]; colspan?: number; rowspan?: number; mergedInto?: number[] };
const cells = (ctx: ReturnType<typeof createFakeCtx>, id: string): Cell[][] => (ctx.read(id)?.data as { content: Cell[][] }).content;

describe('table.mergeCells / splitCell', () => {
  it('merges a 2x2 range into its top-left cell, keeping every block', () => {
    const { ctx, id, childIds } = make();

    TABLE_ACTION_HANDLERS.mergeCells.run(ctx, { range: { fromRow: 0, fromCol: 0, toRow: 1, toCol: 1 } }, undefined);
    const grid = cells(ctx, id);

    expect(grid[0][0]).toMatchObject({ colspan: 2, rowspan: 2, blocks: childIds });
    expect(grid[1][1].mergedInto).toEqual([0, 0]);
  });

  it('refuses a single-cell merge', () => {
    expect(() => TABLE_ACTION_HANDLERS.mergeCells.run(make().ctx, { range: { fromRow: 0, fromCol: 0, toRow: 0, toCol: 0 } }, undefined)).toThrow(FakeFailure);
  });

  it('splits back and seeds the freed cells', () => {
    const { ctx, id } = make();

    TABLE_ACTION_HANDLERS.mergeCells.run(ctx, { range: { fromRow: 0, fromCol: 0, toRow: 0, toCol: 1 } }, undefined);
    TABLE_ACTION_HANDLERS.splitCell.run(createFakeCtx(ctx.doc, id), { row: 0, col: 0 }, undefined);
    const [row] = cells(ctx, id);

    expect(row[0].colspan).toBeUndefined();
    expect(row[1].blocks).toHaveLength(1);
  });

  it('refuses to split a cell that is not merged', () => {
    expect(() => TABLE_ACTION_HANDLERS.splitCell.run(make().ctx, { row: 0, col: 0 }, undefined)).toThrow(/not a merged cell/);
  });
});
```

Run: `yarn test test/unit/shared/tool-actions/table-merge.test.ts` → FAIL.

- [ ] **Step 2: Declare and implement**

```ts
  { name: 'mergeCells', summary: 'Merge a rectangle of cells into its top-left cell. Their blocks move into it.', target: 'block',
    preconditions: ['The range has at least two cells and does not cut through another merged cell.'],
    args: { type: 'object', required: ['range'], additionalProperties: false, properties: { range: RANGE_ARGS } } },
  { name: 'splitCell', summary: 'Split a merged cell back into single cells. Its content stays in the top-left cell.', target: 'block',
    preconditions: ['The cell at row, col is the top-left cell of a merge.'],
    args: { type: 'object', required: ['row', 'col'], additionalProperties: false, properties: { row: { type: 'integer', minimum: 0 }, col: { type: 'integer', minimum: 0 } } } },
```

```ts
const mergeCells: ToolActionImpl<{ range: CellRange }> = {
  run: (ctx, args) => {
    const block = tableTarget(ctx);
    const model = tableModel(ctx, block);
    const rect = rectOf(args.range);

    if (!model.canMergeCells(rect)) {
      ctx.fail('PRECONDITION_FAILED', 'These cells cannot merge: pick at least two cells, inside the table, that do not cut through another merged cell.');
    }
    model.mergeCells(rect);
    commitTable(ctx, block.id, model);

    return undefined;
  },
};

const splitCell: ToolActionImpl<{ row: number; col: number }> = {
  run: (ctx, args) => {
    const block = tableTarget(ctx);
    const model = tableModel(ctx, block);

    if (!model.isMergedCell(args.row, args.col)) {
      ctx.fail('PRECONDITION_FAILED', `Cell ${args.row},${args.col} is not a merged cell. Pass the top-left cell of a merge.`);
    }
    const { colspan, rowspan } = model.getCellSpan(args.row, args.col);

    model.splitCell(args.row, args.col);
    for (let row = args.row; row < args.row + rowspan; row += 1) {
      for (let col = args.col; col < args.col + colspan; col += 1) {
        if (model.getCellBlocks(row, col).length === 0 && !model.isSpannedCell(row, col)) {
          seedCell(ctx, block.id, model, row, col);
        }
      }
    }
    commitTable(ctx, block.id, model);

    return undefined;
  },
};
```

`getCellSpan` is `table-model.ts:895`. Turn the `it.todo` in `table-move.test.ts` into the real case.

- [ ] **Step 3: Run, then commit**

Run: `yarn test test/unit/shared/tool-actions/table-merge.test.ts` → PASS. Run: `yarn test test/unit/shared/tool-actions/table-move.test.ts` → PASS.

```bash
npx eslint src/shared/tool-descriptions/table.ts src/shared/tool-actions/table.ts test/unit/shared/tool-actions/table-merge.test.ts test/unit/shared/tool-actions/table-move.test.ts
git add src/shared/tool-descriptions/table.ts src/shared/tool-actions/table.ts test/unit/shared/tool-actions/table-merge.test.ts test/unit/shared/tool-actions/table-move.test.ts
git commit -m "feat(table): table.mergeCells and table.splitCell actions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 38: Column list actions and the emptied-column helper

**Files:**
- Create: `src/shared/tool-actions/columns.ts`
- Modify: `src/shared/tool-descriptions/column-list.ts` (`COLUMN_LIST_ACTIONS`), `src/shared/tool-actions/index.ts`, `src/tools/column-list/index.ts` (static)
- Test: `test/unit/shared/tool-actions/columns.test.ts`

**Interfaces:**
- Produces:
  - `cleanupEmptiedColumnList(ctx: ToolActionContext, columnListId: string): boolean`. When exactly one column is left, its children move to the list's own parent, right before the list, then the column and the list are removed. Mirrors `unwrapColumnListIfCollapsed` (`src/tools/columns-shared.ts:417-450`), which promotes survivors to the list's enclosing parent, not to the root. 01's `block.move` calls it after moving the last block out of a column (06 01-Q7).
  - `column_list.create` (create): `{ count: 2..5 }` or `{ from: string[] (≥ 2) }`, plus `widths?: number[]`. `count`: N columns, one empty paragraph each (each `Column` seeds one paragraph, `src/tools/column/index.ts:195`). `from`: one column per listed block, in order; the list takes the place of the first block. Read `blockSettings.ts:571-608` ("turn selection into columns") in Step 1 and match how it groups blocks; adjust this rule and the test if it differs.
  - `column_list.addColumn` (block): `{ at: integer ≥ 0, from?: string[] }`.
  - `column_list.removeColumn` (block): `{ index }`. Removes that column with its children, then runs the cleanup.
  - `column_list.setWidths` (block): `{ ratios: number[] }`, length = column count, each > 0. Writes `widthRatio` on each column, removing it (`undefined`) where it is 1, because a column omits an even split (`$defs.column`).
  - `defaultChildren` for `column_list`: two columns, each with an empty paragraph. For `column`: one empty paragraph.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { COLUMN_LIST_ACTION_HANDLERS, cleanupEmptiedColumnList } from '../../../../src/shared/tool-actions/columns';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

describe('column_list actions', () => {
  it('creates N columns with one paragraph each', () => {
    const ctx = createFakeCtx(docOf([]), undefined, 'column_list');
    const { id, childIds } = COLUMN_LIST_ACTION_HANDLERS.create.run(ctx, { count: 3 }, undefined) as { id: string; childIds: string[] };

    expect(ctx.read(id)?.children).toEqual(childIds);
    expect(childIds.map(column => ctx.read(column)?.children.length)).toEqual([1, 1, 1]);
  });

  it('wraps existing blocks, one per column, where the first one stood', () => {
    const ctx = createFakeCtx(docOf([{ id: 'p', type: 'callout', data: {} }, { id: 'a', type: 'paragraph', data: {}, parentId: 'p' }, { id: 'b', type: 'paragraph', data: {}, parentId: 'p' }]));
    const { id } = COLUMN_LIST_ACTION_HANDLERS.create.run(ctx, { from: ['a', 'b'] }, undefined) as { id: string };

    expect(ctx.read(id)?.parentId).toBe('p');
    expect(ctx.read('a')?.parentId).not.toBe('p');
    expect(ctx.read(ctx.read('a')?.parentId ?? '')?.parentId).toBe(id);
  });

  it('removing down to one column unwraps into the list parent', () => {
    const ctx = createFakeCtx(docOf([]), undefined, 'column_list');
    const { id, childIds } = COLUMN_LIST_ACTION_HANDLERS.create.run(ctx, { count: 2 }, undefined) as { id: string; childIds: string[] };
    const survivor = ctx.read(childIds[1])?.children[0] ?? '';

    COLUMN_LIST_ACTION_HANDLERS.removeColumn.run(createFakeCtx(ctx.doc, id), { index: 0 }, undefined);

    expect(ctx.read(id)).toBeNull();
    expect(ctx.read(survivor)?.parentId).toBeNull();
  });

  it('setWidths needs one ratio per column', () => {
    const ctx = createFakeCtx(docOf([]), undefined, 'column_list');
    const { id, childIds } = COLUMN_LIST_ACTION_HANDLERS.create.run(ctx, { count: 2 }, undefined) as { id: string; childIds: string[] };

    expect(() => COLUMN_LIST_ACTION_HANDLERS.setWidths.run(createFakeCtx(ctx.doc, id), { ratios: [1] }, undefined)).toThrow(FakeFailure);
    COLUMN_LIST_ACTION_HANDLERS.setWidths.run(createFakeCtx(ctx.doc, id), { ratios: [2, 1] }, undefined);
    expect(childIds.map(column => (ctx.read(column)?.data as { widthRatio?: number }).widthRatio)).toEqual([2, undefined]);
  });

  it('cleanup leaves a list with two columns alone', () => {
    const ctx = createFakeCtx(docOf([]), undefined, 'column_list');
    const { id } = COLUMN_LIST_ACTION_HANDLERS.create.run(ctx, { count: 2 }, undefined) as { id: string };

    expect(cleanupEmptiedColumnList(ctx, id)).toBe(false);
  });

  it('declares default children', () => {
    expect(BUILT_IN_TOOL_RUNTIMES.get('column_list')?.defaultChildren).toHaveLength(2);
  });
});
```

Run: `yarn test test/unit/shared/tool-actions/columns.test.ts` → FAIL.

- [ ] **Step 2: Implement**

```ts
import type { BlockPosition, InsertSpec, ToolActionContext, ToolActionImpl } from '../../../types';

const COLUMN = 'column';
const EMPTY_PARAGRAPH: InsertSpec = { type: 'paragraph', data: { text: [] } };

export const COLUMN_DEFAULT_CHILDREN: InsertSpec[] = [EMPTY_PARAGRAPH];
export const COLUMN_LIST_DEFAULT_CHILDREN: InsertSpec[] = [
  { type: COLUMN, data: {}, children: [EMPTY_PARAGRAPH] },
  { type: COLUMN, data: {}, children: [EMPTY_PARAGRAPH] },
];

const target = (ctx: ToolActionContext): NonNullable<ToolActionContext['block']> =>
  ctx.block ?? ctx.fail('INVALID_ARGS', 'Pass the id of a column_list block.');

export const cleanupEmptiedColumnList = (ctx: ToolActionContext, columnListId: string): boolean => {
  const list = ctx.read(columnListId);

  if (list === null || list.children.length !== 1) {
    return false;
  }
  const [survivor] = list.children;

  // Survivors go to the list's own parent, so a nested list stays inside its outer column.
  (ctx.read(survivor)?.children ?? []).forEach(child => ctx.move(child, { parentId: list.parentId, position: { before: columnListId } }));
  ctx.remove(survivor);
  ctx.remove(columnListId);

  return true;
};

const writeRatios = (ctx: ToolActionContext, columns: readonly string[], ratios: number[] | undefined): void => {
  if (ratios === undefined) {
    return;
  }
  if (ratios.length !== columns.length) {
    ctx.fail('PRECONDITION_FAILED', `Pass one ratio per column: this list has ${columns.length} columns.`);
  }
  columns.forEach((column, index) => ctx.update(column, { widthRatio: ratios[index] === 1 ? undefined : ratios[index] }));
};

interface CreateArgs { count?: number; from?: string[]; widths?: number[]; parentId?: string | null; position?: BlockPosition }

const create: ToolActionImpl<CreateArgs, undefined, { id: string; childIds: string[] }> = {
  run: (ctx, args) => {
    if ((args.count === undefined) === (args.from === undefined)) {
      ctx.fail('INVALID_ARGS', 'Pass either count (2 to 5) or from (two or more block ids).');
    }
    const first = args.from?.[0] === undefined ? null : ctx.read(args.from[0]);

    if (args.from !== undefined && first === null) {
      ctx.fail('PRECONDITION_FAILED', `Block ${args.from[0]} does not exist.`);
    }
    const id = ctx.insert({
      type: ctx.tool,
      data: {},
      parentId: first === null ? args.parentId : first.parentId,
      position: first === null ? args.position : { before: first.id },
    });
    const childIds = args.from === undefined
      ? Array.from({ length: args.count ?? 2 }, () => ctx.insert({ type: COLUMN, data: {}, parentId: id, children: [EMPTY_PARAGRAPH] }))
      : args.from.map((blockId) => {
        const column = ctx.insert({ type: COLUMN, data: {}, parentId: id });

        ctx.move(blockId, { parentId: column, position: 'end' });

        return column;
      });

    writeRatios(ctx, childIds, args.widths);

    return { id, childIds };
  },
};

const addColumn: ToolActionImpl<{ at: number; from?: string[] }, undefined, { id: string }> = {
  run: (ctx, args) => {
    const list = target(ctx);
    const before = list.children[args.at];
    const column = ctx.insert({
      type: COLUMN, data: {}, parentId: list.id, position: before === undefined ? 'end' : { before },
      ...(args.from === undefined ? { children: [EMPTY_PARAGRAPH] } : {}),
    });

    (args.from ?? []).forEach(blockId => ctx.move(blockId, { parentId: column, position: 'end' }));

    return { id: column };
  },
};

const removeColumn: ToolActionImpl<{ index: number }> = {
  run: (ctx, args) => {
    const list = target(ctx);
    const column = list.children[args.index] ?? ctx.fail('PRECONDITION_FAILED', `This list has ${list.children.length} columns; index starts at 0.`);

    ctx.remove(column, { withChildren: true });
    cleanupEmptiedColumnList(ctx, list.id);

    return undefined;
  },
};

const setWidths: ToolActionImpl<{ ratios: number[] }> = {
  run: (ctx, args) => {
    const list = target(ctx);

    writeRatios(ctx, list.children, args.ratios);

    return undefined;
  },
};

export const COLUMN_LIST_ACTION_HANDLERS: Readonly<Record<string, ToolActionImpl>> = { create, addColumn, removeColumn, setWidths };
```

Declarations in `column-list.ts` (`COLUMN_LIST_ACTIONS`): `create` (args `{ count?: { type: 'integer', minimum: 2, maximum: 5 }, from?: { type: 'array', minItems: 2, items: { type: 'string' } }, widths?: { type: 'array', items: { type: 'number', exclusiveMinimum: 0 } } }`, `oneOf: [{ required: ['count'] }, { required: ['from'] }]`), `addColumn` (`{ at: integer ≥ 0, from?: string[] }`), `removeColumn` (`{ index: integer ≥ 0 }`, precondition "Removing down to one column unwraps the list."), `setWidths` (`{ ratios: number[] }`, required). The 2..5 bound is the toolbox range (`src/tools/column-list/index.ts:258`). Register `column_list: { defaultChildren: COLUMN_LIST_DEFAULT_CHILDREN, actions: COLUMN_LIST_ACTION_HANDLERS }` and `column: { defaultChildren: COLUMN_DEFAULT_CHILDREN }` in `BUILT_IN_RUNTIME_PARTS`, and the static on `ColumnList`. Export `cleanupEmptiedColumnList` from `src/shared/tool-actions/index.ts` for 01.

- [ ] **Step 3: Run, then commit**

Run: `yarn test test/unit/shared/tool-actions/columns.test.ts` → PASS.

```bash
npx eslint src/shared/tool-actions/columns.ts src/shared/tool-descriptions/column-list.ts src/shared/tool-actions/index.ts src/tools/column-list/index.ts test/unit/shared/tool-actions/columns.test.ts
git add src/shared/tool-actions/columns.ts src/shared/tool-descriptions/column-list.ts src/shared/tool-actions/index.ts src/tools/column-list/index.ts test/unit/shared/tool-actions/columns.test.ts
git commit -m "feat(columns): column_list actions and the shared emptied-column cleanup

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 39: Tabs actions

**Files:**
- Create: `src/shared/tool-actions/tabs.ts`
- Modify: `src/shared/tool-descriptions/tabs.ts` (`TABS_ACTIONS`), `src/shared/tool-actions/index.ts`, `src/tools/tabs/index.ts` (static)
- Test: `test/unit/shared/tool-actions/tabs.test.ts`

**Interfaces:**
- `tabs.create` (create): `{ tabs?: Array<{ title: string; icon?: string }> }` (min 1). Default: three tabs titled `Tab 1`..`Tab 3` (`SEEDED_TABS = 3`, `src/tools/tabs/index.ts:34`; English `tools.tabs.defaultTitle` = `"Tab {number}"`, `en.json:207`).
- `tabs.addTab` (block): `{ title?: string; icon?: string; at?: integer ≥ 0 }`. Default title `Tab <n>` where n = tab count + 1 (`tabs/index.ts:384-386`).
- `tabs.deleteTab` (block): `{ tabId: string }`. Deleting the last tab deletes the tabs block (`tabs/index.ts:307-322`). Content goes with the tab.
- `defaultChildren` for `tabs`: the same three tabs, no bodies (a new tab has no body until clicked, `src/tools/tab/index.ts:170-182`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { TABS_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/tabs';
import { createFakeCtx, docOf } from './fake-ctx';

describe('tabs actions', () => {
  it('creates three default tabs', () => {
    const ctx = createFakeCtx(docOf([]), undefined, 'tabs');
    const { childIds } = TABS_ACTION_HANDLERS.create.run(ctx, {}, undefined) as { childIds: string[] };

    expect(childIds.map(id => (ctx.read(id)?.data as { title: string }).title)).toEqual(['Tab 1', 'Tab 2', 'Tab 3']);
  });

  it('adds a tab at an index with the next default title', () => {
    const ctx = createFakeCtx(docOf([]), undefined, 'tabs');
    const { id } = TABS_ACTION_HANDLERS.create.run(ctx, {}, undefined) as { id: string };
    const { id: added } = TABS_ACTION_HANDLERS.addTab.run(createFakeCtx(ctx.doc, id), { at: 0 }, undefined) as { id: string };

    expect(ctx.read(id)?.children[0]).toBe(added);
    expect((ctx.read(added)?.data as { title: string }).title).toBe('Tab 4');
  });

  it('deleting the last tab deletes the tabs block', () => {
    const ctx = createFakeCtx(docOf([]), undefined, 'tabs');
    const { id, childIds } = TABS_ACTION_HANDLERS.create.run(ctx, { tabs: [{ title: 'Only' }] }, undefined) as { id: string; childIds: string[] };

    TABS_ACTION_HANDLERS.deleteTab.run(createFakeCtx(ctx.doc, id), { tabId: childIds[0] }, undefined);

    expect(ctx.read(id)).toBeNull();
  });

  it('declares three default tabs', () => {
    expect(BUILT_IN_TOOL_RUNTIMES.get('tabs')?.defaultChildren).toHaveLength(3);
  });
});
```

Run: `yarn test test/unit/shared/tool-actions/tabs.test.ts` → FAIL.

- [ ] **Step 2: Implement**

```ts
import type { BlockPosition, InsertSpec, ToolActionContext, ToolActionImpl } from '../../../types';

// English text of tools.tabs.defaultTitle (en.json "Tab {number}"); agents write English titles.
const defaultTitle = (n: number): string => `Tab ${n}`;
const TAB = 'tab';

export const TABS_DEFAULT_CHILDREN: InsertSpec[] = [1, 2, 3].map(n => ({ type: TAB, data: { title: defaultTitle(n) } }));

const target = (ctx: ToolActionContext): NonNullable<ToolActionContext['block']> =>
  ctx.block ?? ctx.fail('INVALID_ARGS', 'Pass the id of a tabs block.');

const tabData = (title: string, icon?: string): Record<string, unknown> => (icon === undefined ? { title } : { title, icon });

const create: ToolActionImpl<{ tabs?: Array<{ title: string; icon?: string }>; parentId?: string | null; position?: BlockPosition }, undefined, { id: string; childIds: string[] }> = {
  run: (ctx, args) => {
    const id = ctx.insert({ type: ctx.tool, data: {}, parentId: args.parentId, position: args.position });
    const tabs = args.tabs ?? [1, 2, 3].map(n => ({ title: defaultTitle(n) }));

    return { id, childIds: tabs.map(tab => ctx.insert({ type: TAB, data: tabData(tab.title, tab.icon), parentId: id })) };
  },
};

const addTab: ToolActionImpl<{ title?: string; icon?: string; at?: number }, undefined, { id: string }> = {
  run: (ctx, args) => {
    const tabs = target(ctx);
    const before = args.at === undefined ? undefined : tabs.children[args.at];

    return {
      id: ctx.insert({
        type: TAB,
        data: tabData(args.title ?? defaultTitle(tabs.children.length + 1), args.icon),
        parentId: tabs.id,
        position: before === undefined ? 'end' : { before },
      }),
    };
  },
};

const deleteTab: ToolActionImpl<{ tabId: string }> = {
  run: (ctx, args) => {
    const tabs = target(ctx);

    if (!tabs.children.includes(args.tabId)) {
      ctx.fail('PRECONDITION_FAILED', `Block ${args.tabId} is not a tab of this tabs block.`);
    }
    if (tabs.children.length === 1) {
      ctx.remove(tabs.id, { withChildren: true });
    } else {
      ctx.remove(args.tabId, { withChildren: true });
    }

    return undefined;
  },
};

export const TABS_ACTION_HANDLERS: Readonly<Record<string, ToolActionImpl>> = { create, addTab, deleteTab };
```

Declarations in `tabs.ts` (`TABS_ACTIONS`): `create` (`{ tabs?: array (minItems 1) of { title: string, icon?: string } }`), `addTab` (`{ title?, icon?, at?: integer ≥ 0 }`), `deleteTab` (`{ tabId: string }` required, precondition "Deleting the last tab deletes the whole tabs block."). Register `tabs: { defaultChildren: TABS_DEFAULT_CHILDREN, actions: TABS_ACTION_HANDLERS }`; static on `TabsTool`.

- [ ] **Step 3: Run, then commit**

Run: `yarn test test/unit/shared/tool-actions/tabs.test.ts` → PASS.

```bash
npx eslint src/shared/tool-actions/tabs.ts src/shared/tool-descriptions/tabs.ts src/shared/tool-actions/index.ts src/tools/tabs/index.ts test/unit/shared/tool-actions/tabs.test.ts
git add src/shared/tool-actions/tabs.ts src/shared/tool-descriptions/tabs.ts src/shared/tool-actions/index.ts src/tools/tabs/index.ts test/unit/shared/tool-actions/tabs.test.ts
git commit -m "feat(tabs): tabs.create, tabs.addTab and tabs.deleteTab actions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 40: Shared database building blocks

**Files:**
- Create: `src/shared/database/schema-ops.ts`, `src/shared/database/default-text.ts`
- Move: `src/tools/database/types.ts` → `src/shared/database/types.ts` (old path re-exports `*`)
- Modify: `src/tools/database/database-model.ts` (`positionBetween`, `randomKeySuffix`, `createDefaultSchema`, `createDefaultView` delegate), `src/tools/database/database-localization.ts:20-29` (`DATABASE_DEFAULT_TEXT` re-exported from the shared literals)
- Test: `test/unit/shared/database/schema-ops.test.ts`

**Interfaces:**
- `DatabaseModel` itself does not move: its `snapshot`/`hydrate` use `structuredClone` (`database-model.ts:197-221`), which the Jint realm lacks. The actions need only four pure pieces, so only those move:
  - `positionBetween(after: string | null, before: string | null): string` — the body of `DatabaseModel.positionBetween` and `randomKeySuffix` (`database-model.ts:249-283`), moved verbatim. `DatabaseModel.positionBetween` becomes `return positionBetween(after, before);`.
  - `createDefaultSchema(mint: () => string): PropertyDefinition[]` and `createDefaultView(groupBy: string | undefined, mint: () => string): DatabaseViewConfig` — `database-model.ts:286-336`, with `nanoid()` replaced by `mint()`. The model's private statics call them with `nanoid`.
  - `DATABASE_DEFAULT_TEXT` English literals: `titleProperty: 'Title'`, `statusProperty: 'Status'`, `statusNotStarted: 'Not started'`, `statusInProgress: 'In progress'`, `statusDone: 'Done'`, `viewBoard: 'Board'`, `viewTypeBoard: 'Board'`, `viewTypeList: 'List'` (read from `en.json` at `30c77599`). A test pins them to `en.json`, so a copy edit there turns it red.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import en from '../../../../src/components/i18n/locales/en.json';
import { DATABASE_DEFAULT_TEXT } from '../../../../src/shared/database/default-text';
import { createDefaultSchema, createDefaultView, positionBetween } from '../../../../src/shared/database/schema-ops';
import { DatabaseModel } from '../../../../src/tools/database/database-model';

const KEYS: Record<keyof typeof DATABASE_DEFAULT_TEXT, string> = {
  titleProperty: 'tools.database.defaultTitleProperty',
  statusProperty: 'tools.database.defaultStatusProperty',
  statusNotStarted: 'tools.database.defaultStatusNotStarted',
  statusInProgress: 'tools.database.defaultStatusInProgress',
  statusDone: 'tools.database.defaultStatusDone',
  viewBoard: 'tools.database.defaultViewBoard',
  viewTypeBoard: 'tools.database.viewTypeBoard',
  viewTypeList: 'tools.database.viewTypeList',
};

describe('shared database building blocks', () => {
  it('default labels are the English locale strings', () => {
    Object.entries(KEYS).forEach(([field, key]) => expect(DATABASE_DEFAULT_TEXT[field as keyof typeof KEYS]).toBe((en as Record<string, string>)[key]));
  });

  it('positions sort between their neighbours and the model delegates', () => {
    const key = positionBetween('a0', 'a1');

    expect(key > 'a0' && key < 'a1').toBe(true);
    expect(DatabaseModel.positionBetween('a0', 'a1')).toBe(key);
  });

  it('default schema and view mint ids with the given minter', () => {
    let n = 0;
    const mint = (): string => `id${(n += 1)}`;
    const schema = createDefaultSchema(mint);
    const view = createDefaultView(schema[1].id, mint);

    expect(schema.map(property => property.type)).toEqual(['title', 'select']);
    expect(view).toMatchObject({ type: 'board', groupBy: schema[1].id, name: 'Board' });
    expect([...schema.map(p => p.id), view.id].every(id => id.startsWith('id'))).toBe(true);
  });
});
```

Run: `yarn test test/unit/shared/database/schema-ops.test.ts` → FAIL.

- [ ] **Step 2: Move**

Create the two modules with the code moved verbatim as described; `schema-ops.ts` imports `generateKeyBetween` from `fractional-indexing` (already a dependency, `package.json:265`) and types from `./types`. Replace `database-localization.ts`'s `DATABASE_DEFAULT_TEXT` computation (`:20-29`) with `export { DATABASE_DEFAULT_TEXT } from '../../shared/database/default-text';`; keep its `localize*` helpers and `DEFAULT_KEYS` (they still need the keys for `i18n.t`). Point `database-model.ts:14` at the shared module.

- [ ] **Step 3: Run the tests**

Run, one at a time: `yarn test test/unit/shared/database/schema-ops.test.ts`, `yarn test test/unit/tools/database/database-model.test.ts`, `yarn test test/unit/tools/database/database-model.mutants.test.ts`, `yarn test test/unit/tools/database/database.test.ts`. All PASS.

- [ ] **Step 4: Commit**

```bash
npx eslint src/shared/database/schema-ops.ts src/shared/database/default-text.ts src/shared/database/types.ts src/tools/database/types.ts src/tools/database/database-model.ts src/tools/database/database-localization.ts test/unit/shared/database/schema-ops.test.ts
git add src/shared/database/schema-ops.ts src/shared/database/default-text.ts src/shared/database/types.ts src/tools/database/types.ts src/tools/database/database-model.ts src/tools/database/database-localization.ts test/unit/shared/database/schema-ops.test.ts
git commit -m "refactor(database): pure position, default schema and labels in src/shared

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 41: `database.create` and the view actions

**Files:**
- Create: `src/shared/tool-actions/database.ts`
- Modify: `src/shared/tool-descriptions/database.ts` (`DATABASE_ACTIONS`), `src/shared/tool-actions/index.ts`, `src/tools/database/index.ts` (static)
- Test: `test/unit/shared/tool-actions/database-views.test.ts`

**Interfaces:**
- Helpers (used by Tasks 42, 43): `databaseTarget(ctx)`, `readDatabase(block): { schema: PropertyDefinition[]; views: DatabaseViewConfig[]; activeViewId: string }`, `sortedByPosition<T extends { position: string }>(items: T[]): T[]`, `positionAround(items, ref?: { before?: string; after?: string }): string`.
- `database.create` (create): `{ title?: string; view?: 'board' | 'list' | 'table' }`. Writes `createDefaultSchema` + one view (`createDefaultView` for `board`, else a view of that type named `Board`/`List`/`Table`). Which view type each toolbox entry starts with is **unverified**: both entries (`database`, `board`) carry no `data` (`src/tools/database/index.ts:104-122`). Default `view: 'board'`, which is what `createDefaultView` builds. Rows are added with `database.addRow`.
- `database.addView`: `{ type: 'board' | 'list'; name?: string; groupBy?: string }`. The UI adds board or list views only (spec §2.6). A board needs `groupBy` naming a `select` property. The new view is appended (position after the last) and becomes active, as `switchView` does (`index.ts:762`).
- `database.renameView` `{ viewId, name }`, `duplicateView` `{ viewId }` (the UI copy, `src/tools/database/index.ts:770-785`: same name, same type, `groupBy`, `sorts`, `filters` and `visibleProperties` copied, appended after the last view, then made active), `deleteView` `{ viewId }` (at least one view stays; if it was active, the neighbour becomes active), `moveView` `{ viewId, before? | after? }` (exactly one).
- `views` is a guarded field (Task 22), so these actions are the only writers. Each writes the whole `views` array (and `activeViewId` when it changes) in one `ctx.update`; the id-keyed edit happens inside the handler from the overlay read (spec §3.4 rule 5).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { DATABASE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/database';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

type Data = { views: Array<{ id: string; name: string; type: string; position: string; groupBy?: string }>; activeViewId: string; schema: Array<{ id: string; type: string }> };

const make = () => {
  const seed = createFakeCtx(docOf([]), undefined, 'database');
  const { id } = DATABASE_ACTION_HANDLERS.create.run(seed, { title: 'Tasks' }, undefined) as { id: string };

  return { doc: seed.doc, id, data: (): Data => seed.read(id)?.data as Data };
};

describe('database views', () => {
  it('creates a database with the default schema and one board view', () => {
    const { data } = make();

    expect(data().schema.map(property => property.type)).toEqual(['title', 'select']);
    expect(data().views).toHaveLength(1);
    expect(data().activeViewId).toBe(data().views[0].id);
  });

  it('adds a list view at the end and activates it', () => {
    const { doc, id, data } = make();
    const { viewId } = DATABASE_ACTION_HANDLERS.addView.run(createFakeCtx(doc, id), { type: 'list' }, undefined) as { viewId: string };

    expect(data().views.map(view => view.type)).toEqual(['board', 'list']);
    expect(data().views[1].name).toBe('List');
    expect(data().activeViewId).toBe(viewId);
  });

  it('a board view needs a select property to group by', () => {
    const { doc, id } = make();

    expect(() => DATABASE_ACTION_HANDLERS.addView.run(createFakeCtx(doc, id), { type: 'board' }, undefined)).toThrow(FakeFailure);
  });

  it('renames, moves and deletes by id, keeping one view', () => {
    const { doc, id, data } = make();
    const first = data().views[0].id;
    const { viewId } = DATABASE_ACTION_HANDLERS.addView.run(createFakeCtx(doc, id), { type: 'list' }, undefined) as { viewId: string };

    DATABASE_ACTION_HANDLERS.renameView.run(createFakeCtx(doc, id), { viewId, name: 'Mine' }, undefined);
    DATABASE_ACTION_HANDLERS.moveView.run(createFakeCtx(doc, id), { viewId, before: first }, undefined);
    expect(data().views.slice().sort((a, b) => (a.position < b.position ? -1 : 1)).map(view => view.name)).toEqual(['Mine', 'Board']);
    DATABASE_ACTION_HANDLERS.deleteView.run(createFakeCtx(doc, id), { viewId }, undefined);
    expect(data().activeViewId).toBe(first);
    expect(() => DATABASE_ACTION_HANDLERS.deleteView.run(createFakeCtx(doc, id), { viewId: first }, undefined)).toThrow(FakeFailure);
  });

  it('duplicates a view like the UI: same name and settings, last, active', () => {
    const { doc, id, data } = make();
    const source = data().views[0];
    const { viewId } = DATABASE_ACTION_HANDLERS.duplicateView.run(createFakeCtx(doc, id), { viewId: source.id }, undefined) as { viewId: string };
    const copy = data().views.find(view => view.id === viewId);

    expect(copy).toMatchObject({ name: source.name, type: source.type, groupBy: source.groupBy });
    expect((copy?.position ?? '') > source.position).toBe(true);
    expect(data().activeViewId).toBe(viewId);
  });
});
```

Run: `yarn test test/unit/shared/tool-actions/database-views.test.ts` → FAIL.

- [ ] **Step 2: Implement**

```ts
import type { BlockPosition, ToolActionContext, ToolActionImpl } from '../../../types';
import { DATABASE_DEFAULT_TEXT } from '../database/default-text';
import { createDefaultSchema, createDefaultView, positionBetween } from '../database/schema-ops';
import type { DatabaseViewConfig, PropertyDefinition } from '../database/types';

type TargetBlock = NonNullable<ToolActionContext['block']>;
interface DatabaseState { schema: PropertyDefinition[]; views: DatabaseViewConfig[]; activeViewId: string }
interface Placement { before?: string; after?: string }

export const databaseTarget = (ctx: ToolActionContext): TargetBlock => ctx.block ?? ctx.fail('INVALID_ARGS', 'Pass the id of a database block.');

export const readDatabase = (block: TargetBlock): DatabaseState => {
  const data = block.data as Partial<DatabaseState>;

  return { schema: [...(data.schema ?? [])], views: [...(data.views ?? [])], activeViewId: data.activeViewId ?? '' };
};

export const sortedByPosition = <T extends { position: string }>(items: T[]): T[] => [...items].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));

/** A position next to `ref` (by id), or after the last item. */
export const positionAround = <T extends { id: string; position: string }>(ctx: ToolActionContext, items: T[], ref: Placement = {}): string => {
  const sorted = sortedByPosition(items);
  const anchor = ref.before ?? ref.after;

  if (anchor === undefined) {
    return positionBetween(sorted[sorted.length - 1]?.position ?? null, null);
  }
  const index = sorted.findIndex(item => item.id === anchor);

  if (index < 0) {
    ctx.fail('PRECONDITION_FAILED', `No item with id ${anchor}.`);
  }

  return ref.before === undefined
    ? positionBetween(sorted[index].position, sorted[index + 1]?.position ?? null)
    : positionBetween(sorted[index - 1]?.position ?? null, sorted[index].position);
};

const viewIndex = (ctx: ToolActionContext, state: DatabaseState, viewId: string): number => {
  const index = state.views.findIndex(view => view.id === viewId);

  return index >= 0 ? index : ctx.fail('PRECONDITION_FAILED', `This database has no view ${viewId}.`);
};

const VIEW_NAMES: Record<string, string> = { board: DATABASE_DEFAULT_TEXT.viewTypeBoard, list: DATABASE_DEFAULT_TEXT.viewTypeList, table: 'Table' };

const create: ToolActionImpl<{ title?: string; view?: 'board' | 'list' | 'table'; parentId?: string | null; position?: BlockPosition }, undefined, { id: string; childIds: string[] }> = {
  run: (ctx, args) => {
    const mint = (): string => ctx.newId();
    const schema = createDefaultSchema(mint);
    const kind = args.view ?? 'board';
    const view = kind === 'board'
      ? createDefaultView(schema.find(property => property.type === 'select')?.id, mint)
      : { ...createDefaultView(undefined, mint), type: kind, name: VIEW_NAMES[kind] };
    const id = ctx.insert({
      type: ctx.tool,
      data: { ...(args.title === undefined ? {} : { title: args.title }), schema, views: [view], activeViewId: view.id },
      parentId: args.parentId,
      position: args.position,
    });

    return { id, childIds: [] };
  },
};

const addView: ToolActionImpl<{ type: 'board' | 'list'; name?: string; groupBy?: string }, undefined, { viewId: string }> = {
  run: (ctx, args) => {
    const block = databaseTarget(ctx);
    const state = readDatabase(block);

    if (args.type === 'board' && state.schema.find(property => property.id === args.groupBy)?.type !== 'select') {
      ctx.fail('PRECONDITION_FAILED', 'A board view needs groupBy: the id of a select property.');
    }
    const view: DatabaseViewConfig = {
      id: ctx.newId(),
      name: args.name ?? VIEW_NAMES[args.type],
      type: args.type,
      position: positionAround(ctx, state.views),
      ...(args.groupBy === undefined ? {} : { groupBy: args.groupBy }),
      sorts: [],
      filters: [],
      visibleProperties: [],
    };

    ctx.update(block.id, { views: [...state.views, view], activeViewId: view.id });

    return { viewId: view.id };
  },
};

const renameView: ToolActionImpl<{ viewId: string; name: string }> = {
  run: (ctx, args) => {
    const block = databaseTarget(ctx);
    const state = readDatabase(block);
    const index = viewIndex(ctx, state, args.viewId);

    ctx.update(block.id, { views: state.views.map((view, i) => (i === index ? { ...view, name: args.name } : view)) });

    return undefined;
  },
};

const moveView: ToolActionImpl<{ viewId: string } & Placement> = {
  run: (ctx, args) => {
    if ((args.before === undefined) === (args.after === undefined)) {
      ctx.fail('INVALID_ARGS', 'Pass exactly one of before or after.');
    }
    const block = databaseTarget(ctx);
    const state = readDatabase(block);
    const index = viewIndex(ctx, state, args.viewId);
    const others = state.views.filter(view => view.id !== args.viewId);
    const position = positionAround(ctx, others, { before: args.before, after: args.after });

    ctx.update(block.id, { views: state.views.map((view, i) => (i === index ? { ...view, position } : view)) });

    return undefined;
  },
};

const deleteView: ToolActionImpl<{ viewId: string }> = {
  run: (ctx, args) => {
    const block = databaseTarget(ctx);
    const state = readDatabase(block);

    viewIndex(ctx, state, args.viewId);
    if (state.views.length === 1) {
      ctx.fail('PRECONDITION_FAILED', 'A database keeps at least one view.');
    }
    const sorted = sortedByPosition(state.views);
    const at = sorted.findIndex(view => view.id === args.viewId);
    const neighbour = sorted[at + 1] ?? sorted[at - 1];
    const views = state.views.filter(view => view.id !== args.viewId);

    ctx.update(block.id, state.activeViewId === args.viewId ? { views, activeViewId: neighbour.id } : { views });

    return undefined;
  },
};
```

`before: x` places the item between x's predecessor and x; `after: x` between x and its successor. The test's `moveView … before: first` pins the `before` branch.

```ts
const duplicateView: ToolActionImpl<{ viewId: string }, undefined, { viewId: string }> = {
  run: (ctx, args) => {
    const block = databaseTarget(ctx);
    const state = readDatabase(block);
    const source = state.views[viewIndex(ctx, state, args.viewId)];
    // The UI copies through DatabaseModel.addView: same name, appended last (index.ts:770-785).
    const copy: DatabaseViewConfig = {
      ...source,
      id: ctx.newId(),
      position: positionAround(ctx, state.views),
      sorts: [...source.sorts],
      filters: [...source.filters],
      visibleProperties: [...source.visibleProperties],
    };

    ctx.update(block.id, { views: [...state.views, copy], activeViewId: copy.id });

    return { viewId: copy.id };
  },
};

export const DATABASE_ACTION_HANDLERS: Readonly<Record<string, ToolActionImpl>> = { create, addView, renameView, duplicateView, deleteView, moveView };
```

Tasks 42 and 43 add their handlers to this object.

Declarations (`DATABASE_ACTIONS` in `src/shared/tool-descriptions/database.ts`): `create` (target `create`), `addView`, `renameView`, `duplicateView`, `deleteView`, `moveView`, each with the args above as closed object schemas (`additionalProperties: false`), `moveView` with `oneOf: [{ required: ['before'] }, { required: ['after'] }]`. Register `database: { actions: DATABASE_ACTION_HANDLERS }`; static on `DatabaseTool`.

- [ ] **Step 3: Run, then commit**

Run: `yarn test test/unit/shared/tool-actions/database-views.test.ts` → PASS.

```bash
npx eslint src/shared/tool-actions/database.ts src/shared/tool-descriptions/database.ts src/shared/tool-actions/index.ts src/tools/database/index.ts test/unit/shared/tool-actions/database-views.test.ts
git add src/shared/tool-actions/database.ts src/shared/tool-descriptions/database.ts src/shared/tool-actions/index.ts src/tools/database/index.ts test/unit/shared/tool-actions/database-views.test.ts
git commit -m "feat(database): database.create and view actions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 42: Database property and option actions

**Files:** `src/shared/tool-actions/database.ts`, `src/shared/tool-descriptions/database.ts`; Test: `test/unit/shared/tool-actions/database-schema.test.ts`

**Interfaces:**
- `database.addProperty` `{ name: string; type: <PropertyType enum from $defs.database>; options?: Array<{ label: string; color?: string }> }`. Appended after the last property. `options` only for `select` / `multiSelect`.
- `database.addOption` `{ propertyId, label, color? }`, `renameOption` `{ propertyId, optionId, label }`, `moveOption` `{ propertyId, optionId, before? | after? }`, `deleteOption` `{ propertyId, optionId, rows: 'delete' | 'keep' }`. `rows: 'delete'` removes every child row whose value for that property is the option (the board column delete, `database-column-controls.ts:52-60` → `index.ts:1549`); `'keep'` clears that value on those rows. For `multiSelect`, `'keep'` removes the option from each row's array and `'delete'` deletes rows that hold it.
- All edit one element of the id-keyed `schema` array by id (spec §3.4 rule 5).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { DATABASE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/database';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

type Option = { id: string; label: string; position: string };
type Property = { id: string; name: string; type: string; config?: { options: Option[] } };

const make = () => {
  const seed = createFakeCtx(docOf([]), undefined, 'database');
  const { id } = DATABASE_ACTION_HANDLERS.create.run(seed, {}, undefined) as { id: string };
  const schema = (): Property[] => (seed.read(id)?.data as { schema: Property[] }).schema;

  return { doc: seed.doc, id, schema, status: (): Property => schema()[1] };
};

describe('database properties and options', () => {
  it('adds a select property with options', () => {
    const { doc, id, schema } = make();

    DATABASE_ACTION_HANDLERS.addProperty.run(createFakeCtx(doc, id), { name: 'Priority', type: 'select', options: [{ label: 'High' }] }, undefined);

    expect(schema()[2]).toMatchObject({ name: 'Priority', type: 'select', config: { options: [{ label: 'High' }] } });
  });

  it('refuses options on a text property', () => {
    const { doc, id } = make();

    expect(() => DATABASE_ACTION_HANDLERS.addProperty.run(createFakeCtx(doc, id), { name: 'N', type: 'text', options: [{ label: 'x' }] }, undefined)).toThrow(FakeFailure);
  });

  it('renames an option and deletes it together with its rows', () => {
    const { doc, id, status } = make();
    const option = status().config?.options[0] as Option;
    const ctx = createFakeCtx(doc, id);
    const { rowId } = DATABASE_ACTION_HANDLERS.addRow.run(ctx, { values: { [status().id]: option.id } }, undefined) as { rowId: string };

    DATABASE_ACTION_HANDLERS.renameOption.run(createFakeCtx(doc, id), { propertyId: status().id, optionId: option.id, label: 'Todo' }, undefined);
    expect(status().config?.options[0].label).toBe('Todo');
    DATABASE_ACTION_HANDLERS.deleteOption.run(createFakeCtx(doc, id), { propertyId: status().id, optionId: option.id, rows: 'delete' }, undefined);
    expect(status().config?.options.map(o => o.id)).not.toContain(option.id);
    expect(ctx.read(rowId)).toBeNull();
  });
});
```

The last case uses `addRow` from Task 43; keep it `it.todo` until then.

Run: `yarn test test/unit/shared/tool-actions/database-schema.test.ts` → FAIL.

- [ ] **Step 2: Implement**

```ts
const SELECT_TYPES = new Set(['select', 'multiSelect']);

const propertyAt = (ctx: ToolActionContext, state: DatabaseState, propertyId: string): number => {
  const index = state.schema.findIndex(property => property.id === propertyId);

  return index >= 0 ? index : ctx.fail('PRECONDITION_FAILED', `This database has no property ${propertyId}.`);
};

const optionsOf = (ctx: ToolActionContext, property: PropertyDefinition): SelectOption[] => (SELECT_TYPES.has(property.type)
  ? [...((property.config as { options?: SelectOption[] } | undefined)?.options ?? [])]
  : ctx.fail('PRECONDITION_FAILED', `Property ${property.id} is not a select property.`));

const withOptions = (state: DatabaseState, index: number, options: SelectOption[]): PropertyDefinition[] =>
  state.schema.map((property, i) => (i === index ? { ...property, config: { ...(property.config ?? {}), options } } : property));

const addProperty: ToolActionImpl<{ name: string; type: PropertyDefinition['type']; options?: Array<{ label: string; color?: string }> }, undefined, { propertyId: string }> = {
  run: (ctx, args) => {
    if (args.options !== undefined && !SELECT_TYPES.has(args.type)) {
      ctx.fail('PRECONDITION_FAILED', 'Only select and multiSelect properties take options.');
    }
    const block = databaseTarget(ctx);
    const state = readDatabase(block);
    let previous: string | null = null;
    const options = (args.options ?? []).map((option) => {
      previous = positionBetween(previous, null);

      return { id: ctx.newId(), label: option.label, ...(option.color === undefined ? {} : { color: option.color }), position: previous };
    });
    const property: PropertyDefinition = {
      id: ctx.newId(),
      name: args.name,
      type: args.type,
      position: positionAround(ctx, state.schema),
      ...(SELECT_TYPES.has(args.type) ? { config: { options } } : {}),
    };

    ctx.update(block.id, { schema: [...state.schema, property] });

    return { propertyId: property.id };
  },
};

const addOption: ToolActionImpl<{ propertyId: string; label: string; color?: string }, undefined, { optionId: string }> = {
  run: (ctx, args) => {
    const block = databaseTarget(ctx);
    const state = readDatabase(block);
    const index = propertyAt(ctx, state, args.propertyId);
    const options = optionsOf(ctx, state.schema[index]);
    const option = { id: ctx.newId(), label: args.label, ...(args.color === undefined ? {} : { color: args.color }), position: positionAround(ctx, options) };

    ctx.update(block.id, { schema: withOptions(state, index, [...options, option]) });

    return { optionId: option.id };
  },
};

const editOption = (edit: (ctx: ToolActionContext, options: SelectOption[], args: Record<string, unknown>) => SelectOption[]):
  ToolActionImpl<{ propertyId: string; optionId: string } & Record<string, unknown>> => ({
  run: (ctx, args) => {
    const block = databaseTarget(ctx);
    const state = readDatabase(block);
    const index = propertyAt(ctx, state, args.propertyId);
    const options = optionsOf(ctx, state.schema[index]);

    if (!options.some(option => option.id === args.optionId)) {
      ctx.fail('PRECONDITION_FAILED', `Property ${args.propertyId} has no option ${args.optionId}.`);
    }
    ctx.update(block.id, { schema: withOptions(state, index, edit(ctx, options, args)) });

    return undefined;
  },
});

const renameOption = editOption((_ctx, options, args) => options.map(option => (option.id === args.optionId ? { ...option, label: String(args.label) } : option)));

const moveOption = editOption((ctx, options, args) => {
  const others = options.filter(option => option.id !== args.optionId);
  const position = positionAround(ctx, others, { before: args.before as string | undefined, after: args.after as string | undefined });

  return options.map(option => (option.id === args.optionId ? { ...option, position } : option));
});
```

`deleteOption` is its own handler. The UI (`handleOptionDelete`, `src/tools/database/index.ts:1550-1580`) refuses to delete the last option and always deletes the rows in that group; it has no "keep" path, so `rows: 'keep'` (spec §2.6 asks for an explicit choice) removes the value from those rows instead. No UI writes that shape today: **unverified** that the board renders such rows in its "no value" group.

```ts
const holds = (value: unknown, optionId: string): boolean => (Array.isArray(value) ? value.includes(optionId) : value === optionId);

const deleteOption: ToolActionImpl<{ propertyId: string; optionId: string; rows: 'delete' | 'keep' }> = {
  run: (ctx, args) => {
    const block = databaseTarget(ctx);
    const state = readDatabase(block);
    const index = propertyAt(ctx, state, args.propertyId);
    const options = optionsOf(ctx, state.schema[index]);

    if (!options.some(option => option.id === args.optionId)) {
      ctx.fail('PRECONDITION_FAILED', `Property ${args.propertyId} has no option ${args.optionId}.`);
    }
    if (options.length <= 1) {
      ctx.fail('PRECONDITION_FAILED', 'A select property keeps at least one option.');
    }

    rowsOf(ctx, block.id).forEach(({ id: rowId }) => {
      const properties = (ctx.read(rowId)?.data as { properties?: Record<string, unknown> }).properties ?? {};
      const value = properties[args.propertyId];

      if (!holds(value, args.optionId)) {
        return;
      }
      if (args.rows === 'delete') {
        ctx.remove(rowId, { withChildren: true });
      } else {
        const kept = Object.fromEntries(Object.entries(properties).filter(([key]) => key !== args.propertyId));

        ctx.update(rowId, { properties: Array.isArray(value) ? { ...kept, [args.propertyId]: value.filter(id => id !== args.optionId) } : kept });
      }
    });
    ctx.update(block.id, { schema: withOptions(state, index, options.filter(option => option.id !== args.optionId)) });

    return undefined;
  },
};
```

Write `rowsOf` (shown in Task 43) in this task, above `deleteOption`; Task 43 reuses it. Add a `'keep'` case to the test: the row survives and its properties no longer hold the property id. Import `SelectOption` from `'../database/types'`. Declarations as listed under Interfaces; `type` enum copied from `$defs.database…schema.items.properties.type.enum`.

- [ ] **Step 3: Run, then commit**

Run: `yarn test test/unit/shared/tool-actions/database-schema.test.ts` → PASS (one todo).

```bash
npx eslint src/shared/tool-actions/database.ts src/shared/tool-descriptions/database.ts test/unit/shared/tool-actions/database-schema.test.ts
git add src/shared/tool-actions/database.ts src/shared/tool-descriptions/database.ts test/unit/shared/tool-actions/database-schema.test.ts
git commit -m "feat(database): property and select-option actions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 43: Database row actions

**Files:** `src/shared/tool-actions/database.ts`, `src/shared/tool-descriptions/database.ts`; Test: `test/unit/shared/tool-actions/database-rows.test.ts`; turn on the todo in `database-schema.test.ts`

**Interfaces:**
- `database.addRow` `{ values?: Record<string, unknown>; group?: string; before?: string; after?: string }` → inserts a child `database-row` block with `{ properties: values, position, title? }`. `group` sets the active board view's `groupBy` property to that option id. `title` mirrors the title property's value when it is a string (`$defs['database-row'].title`). Result `{ rowId }`.
- `database.moveRow` `{ rowId; group?; before?; after? }` → new `position` among sibling rows (and the group value).
- `database.setRowValues` `{ rowId; values }` → merges into `properties`, re-mirrors `title`.
- Rows are the database block's children; their order key is `data.position` (`DatabaseModel.getOrderedRows`, `database-model.ts:85`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { DATABASE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/database';
import { createFakeCtx, docOf } from './fake-ctx';

type Row = { properties: Record<string, unknown>; position: string; title?: string };

describe('database rows', () => {
  it('adds rows in order and mirrors the title', () => {
    const seed = createFakeCtx(docOf([]), undefined, 'database');
    const { id } = DATABASE_ACTION_HANDLERS.create.run(seed, {}, undefined) as { id: string };
    const titleId = (seed.read(id)?.data as { schema: Array<{ id: string }> }).schema[0].id;
    const add = (values: Record<string, unknown>, extra: Record<string, unknown> = {}): string =>
      (DATABASE_ACTION_HANDLERS.addRow.run(createFakeCtx(seed.doc, id), { values, ...extra }, undefined) as { rowId: string }).rowId;

    const a = add({ [titleId]: 'A' });
    const b = add({ [titleId]: 'B' });
    const c = add({ [titleId]: 'C' }, { before: a });
    const rows = [a, b, c].map(rowId => seed.read(rowId)?.data as Row);

    expect(seed.read(a)?.parentId).toBe(id);
    expect(rows[0].title).toBe('A');
    expect([...rows].sort((x, y) => (x.position < y.position ? -1 : 1)).map(row => row.title)).toEqual(['C', 'A', 'B']);

    DATABASE_ACTION_HANDLERS.setRowValues.run(createFakeCtx(seed.doc, id), { rowId: b, values: { [titleId]: 'Bee' } }, undefined);
    expect((seed.read(b)?.data as Row).title).toBe('Bee');
  });
});
```

Run: `yarn test test/unit/shared/tool-actions/database-rows.test.ts` → FAIL.

- [ ] **Step 2: Implement**

```ts
// rowsOf landed in Task 42:
// const rowsOf = (ctx: ToolActionContext, databaseId: string): Array<{ id: string; position: string }> =>
//   (ctx.read(databaseId)?.children ?? []).flatMap((rowId) => {
//     const row = ctx.read(rowId);
//
//     return row === null ? [] : [{ id: rowId, position: String((row.data as { position?: unknown }).position ?? '') }];
//   });

const titleOf = (state: DatabaseState, values: Record<string, unknown>): string | undefined => {
  const value = values[state.schema.find(property => property.type === 'title')?.id ?? ''];

  return typeof value === 'string' ? value : undefined;
};

const groupValue = (ctx: ToolActionContext, state: DatabaseState, group: string | undefined): Record<string, unknown> => {
  if (group === undefined) {
    return {};
  }
  const groupBy = state.views.find(view => view.id === state.activeViewId)?.groupBy;

  return groupBy === undefined ? ctx.fail('PRECONDITION_FAILED', 'group needs the active view to be a board grouped by a select property.') : { [groupBy]: group };
};

const addRow: ToolActionImpl<{ values?: Record<string, unknown>; group?: string } & Placement, undefined, { rowId: string }> = {
  run: (ctx, args) => {
    const block = databaseTarget(ctx);
    const state = readDatabase(block);
    const properties = { ...(args.values ?? {}), ...groupValue(ctx, state, args.group) };
    const title = titleOf(state, properties);
    const rowId = ctx.insert({
      type: 'database-row',
      data: { properties, position: positionAround(ctx, rowsOf(ctx, block.id), { before: args.before, after: args.after }), ...(title === undefined ? {} : { title }) },
      parentId: block.id,
    });

    return { rowId };
  },
};

const rowData = (ctx: ToolActionContext, databaseId: string, rowId: string): { properties: Record<string, unknown> } => {
  const row = ctx.read(rowId);

  return row !== null && row.parentId === databaseId
    ? row.data as { properties: Record<string, unknown> }
    : ctx.fail('PRECONDITION_FAILED', `Block ${rowId} is not a row of this database.`);
};

const setRowValues: ToolActionImpl<{ rowId: string; values: Record<string, unknown> }> = {
  run: (ctx, args) => {
    const block = databaseTarget(ctx);
    const properties = { ...rowData(ctx, block.id, args.rowId).properties, ...args.values };
    const title = titleOf(readDatabase(block), properties);

    ctx.update(args.rowId, { properties, ...(title === undefined ? {} : { title }) });

    return undefined;
  },
};

const moveRow: ToolActionImpl<{ rowId: string; group?: string } & Placement> = {
  run: (ctx, args) => {
    const block = databaseTarget(ctx);
    const state = readDatabase(block);
    const current = rowData(ctx, block.id, args.rowId);
    const others = rowsOf(ctx, block.id).filter(row => row.id !== args.rowId);

    ctx.update(args.rowId, {
      position: positionAround(ctx, others, { before: args.before, after: args.after }),
      ...(args.group === undefined ? {} : { properties: { ...current.properties, ...groupValue(ctx, state, args.group) } }),
    });

    return undefined;
  },
};
```

Rows compare positions with `localeCompare` in the UI (`database-model.ts:268-274` comment); `positionAround` sorts with `<`. Both agree for the digit-only keys `positionBetween` mints; if the Step 3 run shows an ordering difference on legacy keys, switch `sortedByPosition` to `localeCompare` for rows only and add the case. Declarations as listed under Interfaces; register in `DATABASE_ACTION_HANDLERS`. Turn on the `deleteOption` todo from Task 42.

- [ ] **Step 3: Run, then commit**

Run: `yarn test test/unit/shared/tool-actions/database-rows.test.ts` → PASS. Run: `yarn test test/unit/shared/tool-actions/database-schema.test.ts` → PASS.

```bash
npx eslint src/shared/tool-actions/database.ts src/shared/tool-descriptions/database.ts test/unit/shared/tool-actions/database-rows.test.ts test/unit/shared/tool-actions/database-schema.test.ts
git add src/shared/tool-actions/database.ts src/shared/tool-descriptions/database.ts test/unit/shared/tool-actions/database-rows.test.ts test/unit/shared/tool-actions/database-schema.test.ts
git commit -m "feat(database): addRow, moveRow and setRowValues actions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 44: Media `setSource` and `audio.setCover`

**Files:**
- Create: `src/shared/tool-actions/media.ts` (`services.ts` already exists, Task 12)
- Modify: the four media description modules (`*_ACTIONS`), `src/shared/tool-actions/index.ts`, the four tool classes (statics)
- Test: `test/unit/shared/tool-actions/media.test.ts`

**Interfaces:**
- `services.ts` (internal, created in Task 12; implementations: the browser objects are 03 Task 9a's, the Node `pageBackend` is 01 Task 17's `createPageMapBackend`, which 04 turns on with `--page-titles page-map`):
  - `UploaderService = Pick<BlokUploader, 'uploadByUrl'>` (`types/configs/uploader.d.ts:62-74`; `uploadByUrl(url, { kind, tool })` returns `UploadedAsset { url, fileName? }`).
  - `LinkMetadataService = { fetch(url: string): Promise<BookmarkMeta> }` (`types/tools/bookmark.d.ts`).
  - `PageBackendService = { rename(input: { blockId: string; title: string }): Promise<unknown>; setIcon(input: { blockId: string; icon: PageIcon | null }): Promise<unknown> }`. It takes the BLOCK id, because `prepare` sees only `{ services }` and the args (06 §3.4), not the block's `pageId`. The service resolves the page id itself.
- Actions (all `target: 'block'`, `uses: ['uploader']`, URL only, 06 D6):
  - `image.setSource`, `video.setSource`, `audio.setSource`, `file.setSource` `{ url: string }`. `prepare`: with an uploader that has `uploadByUrl`, re-host and return `{ url, fileName? }`; without, return `{ url }` unchanged (06 R3-3). `run`: `ctx.update(id, { url, fileName? })`, and for image and video also `variants: undefined`, exactly what the UI does when a new source is entered (`writeEnteredUrl`, `src/tools/image/index.ts:435-440`: `{ ...this.data, url, variants: undefined }`). Everything else (crop, turn, markup, caption) is kept, as the UI keeps it (`transitionToEmpty`, `:1512-1523`, clears only `url` and `variants`). Probing natural size, audio title/peaks and file-to-image conversion are browser UI work and are not done here (spec §2.6 notes them; **unverified** whether the editor fills them on the next render of a peer's block; 06 C17 says it does not write them back).
  - `audio.setCover` `{ url }`, same `prepare`, writes `coverUrl`.
  - The URL must be `http(s)`: anything else fails with `INVALID_ARGS` before `prepare` runs host work. Read `src/shared/url-policy.ts` for the existing safe-URL helper and use it.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';

import { MEDIA_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/media';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

describe('media setSource', () => {
  it('re-hosts through the uploader when there is one', async () => {
    const uploadByUrl = vi.fn().mockResolvedValue({ url: 'https://cdn/x.png', fileName: 'x.png' });
    const action = MEDIA_ACTION_HANDLERS.image.setSource;
    const prepared = await action.prepare?.({ services: { uploader: { uploadByUrl } } }, { url: 'https://a.b/x.png' });
    const ctx = createFakeCtx(docOf([{ id: 'i', type: 'image', data: { url: '' } }]), 'i');

    action.run(ctx, { url: 'https://a.b/x.png' }, prepared);

    expect(uploadByUrl).toHaveBeenCalledWith('https://a.b/x.png', { kind: 'image', tool: 'image' });
    expect(ctx.read('i')?.data).toEqual({ url: 'https://cdn/x.png', fileName: 'x.png' });
  });

  it('a new image source drops the stale variants and keeps the crop', async () => {
    const action = MEDIA_ACTION_HANDLERS.image.setSource;
    const ctx = createFakeCtx(docOf([{ id: 'i', type: 'image', data: { url: 'old', variants: [{ url: 'old', mimeType: 'image/png' }], crop: { x: 1, y: 1, w: 50, h: 50 } } }]), 'i');

    action.run(ctx, { url: 'https://a.b/new.png' }, await action.prepare?.({ services: {} }, { url: 'https://a.b/new.png' }));

    expect(ctx.read('i')?.data).toEqual({ url: 'https://a.b/new.png', crop: { x: 1, y: 1, w: 50, h: 50 } });
  });

  it('stores the URL as given without an uploader', async () => {
    const action = MEDIA_ACTION_HANDLERS.video.setSource;
    const prepared = await action.prepare?.({ services: {} }, { url: 'https://a.b/v.mp4' });
    const ctx = createFakeCtx(docOf([{ id: 'v', type: 'video', data: { url: '' } }]), 'v');

    action.run(ctx, { url: 'https://a.b/v.mp4' }, prepared);

    expect(ctx.read('v')?.data).toEqual({ url: 'https://a.b/v.mp4' });
  });

  it('refuses a non-http URL before any host work', async () => {
    await expect(MEDIA_ACTION_HANDLERS.file.setSource.prepare?.({ services: {} }, { url: 'javascript:alert(1)' })).rejects.toBeInstanceOf(Error);
    expect(() => MEDIA_ACTION_HANDLERS.file.setSource.run(createFakeCtx(docOf([{ id: 'f', type: 'file', data: {} }]), 'f'), { url: 'javascript:alert(1)' }, undefined)).toThrow(FakeFailure);
  });

  it('sets an audio cover', async () => {
    const action = MEDIA_ACTION_HANDLERS.audio.setCover;
    const ctx = createFakeCtx(docOf([{ id: 'a', type: 'audio', data: { url: 'u' } }]), 'a');

    action.run(ctx, { url: 'https://a.b/c.png' }, await action.prepare?.({ services: {} }, { url: 'https://a.b/c.png' }));

    expect(ctx.read('a')?.data).toEqual({ url: 'u', coverUrl: 'https://a.b/c.png' });
  });
});
```

Run: `yarn test test/unit/shared/tool-actions/media.test.ts` → FAIL.

- [ ] **Step 2: Implement**

```ts
// src/shared/tool-actions/media.ts
import type { AssetKind, ToolActionImpl } from '../../../types';
import type { UploaderService } from './services';

const isHttp = (url: string): boolean => /^https?:\/\//i.test(url);

interface Source { url: string; fileName?: string }

// Image and video keep renditions in `variants`; a new source makes them stale (image/index.ts:435-440).
const HAS_VARIANTS = new Set(['image', 'video']);

const rehost = (kind: AssetKind, tool: string, field: 'url' | 'coverUrl'): ToolActionImpl<{ url: string }, Source, undefined> => ({
  prepare: async ({ services }, args) => {
    if (!isHttp(args.url)) {
      throw new TypeError('Pass an http(s) URL.');
    }
    const uploader = services.uploader as UploaderService | undefined;

    if (uploader?.uploadByUrl === undefined) {
      return { url: args.url };
    }
    const asset = await uploader.uploadByUrl(args.url, { kind, tool });

    return field === 'url' && asset.fileName !== undefined ? { url: asset.url, fileName: asset.fileName } : { url: asset.url };
  },
  run: (ctx, args, prepared) => {
    if (!isHttp(args.url)) {
      ctx.fail('INVALID_ARGS', 'Pass an http(s) URL.');
    }
    const block = ctx.block ?? ctx.fail('INVALID_ARGS', `Pass the id of a ${tool} block.`);
    const source = prepared ?? { url: args.url };

    ctx.update(block.id, field === 'url'
      ? { ...source, ...(HAS_VARIANTS.has(tool) ? { variants: undefined } : {}) }
      : { coverUrl: source.url });

    return undefined;
  },
});

export const MEDIA_ACTION_HANDLERS = {
  image: { setSource: rehost('image', 'image', 'url') },
  video: { setSource: rehost('video', 'video', 'url') },
  audio: { setSource: rehost('audio', 'audio', 'url'), setCover: rehost('image', 'audio', 'coverUrl') },
  file: { setSource: rehost('file', 'file', 'url') },
} as const;
```

Replace the `isHttp` regex with the existing helper from `src/shared/url-policy.ts` if one fits (read it first). A `prepare` that throws becomes 01's error for that command; 01 maps it (the test only requires it rejects). Declarations, in each media description module:

```ts
export const IMAGE_ACTIONS: ToolActionDeclaration[] = [{
  name: 'setSource',
  summary: 'Set or replace the image from a URL.',
  guidance: 'http(s) URLs only. When the host has an uploader the file is copied to the host first.',
  target: 'block',
  uses: ['uploader'],
  args: { type: 'object', required: ['url'], additionalProperties: false, properties: { url: { type: 'string', pattern: '^https?://' } } },
}];
```

Same shape for video, audio, file, and `audio.setCover` (summary "Set the cover picture from a URL."). Register `image: { actions: MEDIA_ACTION_HANDLERS.image }` etc. in `BUILT_IN_RUNTIME_PARTS` (Tasks 45-46 merge more image actions into the same object) and the statics on the four classes.

- [ ] **Step 3: Run, then commit**

Run: `yarn test test/unit/shared/tool-actions/media.test.ts` → PASS.

```bash
npx eslint src/shared/tool-actions/services.ts src/shared/tool-actions/media.ts src/shared/tool-descriptions/image.ts src/shared/tool-descriptions/video.ts src/shared/tool-descriptions/audio.ts src/shared/tool-descriptions/file.ts src/shared/tool-actions/index.ts src/tools/image/index.ts src/tools/video/index.ts src/tools/audio/index.ts src/tools/file/index.ts test/unit/shared/tool-actions/media.test.ts
git add src/shared/tool-actions/services.ts src/shared/tool-actions/media.ts src/shared/tool-descriptions/image.ts src/shared/tool-descriptions/video.ts src/shared/tool-descriptions/audio.ts src/shared/tool-descriptions/file.ts src/shared/tool-actions/index.ts src/tools/image/index.ts src/tools/video/index.ts src/tools/audio/index.ts src/tools/file/index.ts test/unit/shared/tool-actions/media.test.ts
git commit -m "feat(media): setSource and audio.setCover actions, URL only

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 45: Image crop, rotate, flip, straighten

**Files:**
- Move: `src/tools/image/geometry.ts` → `src/shared/image/geometry.ts`, `src/tools/image/crop-math.ts` → `src/shared/image/crop-math.ts`, `src/tools/image/markup/model.ts` and `markup/freehand.ts` → `src/shared/image/markup-model.ts`, `src/shared/image/freehand.ts`; `Box`, `Point`, `Size` interfaces from `src/tools/image/darkroom/camera.ts:6-8` → `src/shared/image/types.ts`. Each old path re-exports `*`.
- Create: `src/shared/tool-actions/image.ts`
- Modify: `src/shared/tool-descriptions/image.ts`, `src/shared/tool-actions/index.ts`
- Test: `test/unit/shared/tool-actions/image-geometry.test.ts`

**Interfaces:**
- The moved modules are pure: `crop-math.ts` imports one type; `geometry.ts` imports types; `freehand.ts` has no imports; `markup/model.ts` imports `nanoid`, `freehand` and types (read at `30c77599`). `camera.ts` keeps its functions and imports the three interfaces back.
- `image.crop` `{ rect: { x, y, w, h } (percent, 0..100), shape?: 'rect' | 'circle' | 'ellipse' }`. Writes `crop` (removed when it is the full rect, `isFullRect`, `crop-math.ts:8`), and when `width` is set rescales it with `widthForAspectChange` (`crop-math.ts:66`) using `orientedSize` of `naturalWidth`/`naturalHeight` when both are known, else the percent rule. Mirrors `applyCrop` (`src/tools/image/index.ts:985-1000`).
- `image.rotate` `{ turns: 1 | 2 | 3 }` clockwise quarter turns. The UI turns left (`rotateLeft`, `geometry.ts:50`); one clockwise turn is three left turns. Each left turn also turns `crop` and runs `turnMarkupLeft` (`markup/model.ts:292`).
- `image.flip` `{}`: `flipHorizontal` (`geometry.ts:61`) and `flipMarkup` (`:297`).
- `image.straighten` `{ degrees: -45..45 }`: sets `straighten` and shrinks `crop` with `coverCrop(crop, orientedSize(natural, g), degrees)` (`geometry.ts:114`). Precondition: `naturalWidth` and `naturalHeight` are known (the cover math needs them).
- Fields that return to their default are REMOVED (`ctx.update(id, { rotation: undefined })`), because `geometryFields` omits defaults (`geometry.ts:30-36`) and the saved shape omits them (`$defs.image`). See the Cross-plan row on `undefined`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { IMAGE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/image';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

const image = (data: Record<string, unknown>) => createFakeCtx(docOf([{ id: 'i', type: 'image', data: { url: 'u', ...data } }]), 'i');

describe('image geometry actions', () => {
  it('crop writes the rect, and the full rect removes it', () => {
    const ctx = image({});

    IMAGE_ACTION_HANDLERS.crop.run(ctx, { rect: { x: 10, y: 10, w: 50, h: 50 } }, undefined);
    expect(ctx.read('i')?.data).toMatchObject({ crop: { x: 10, y: 10, w: 50, h: 50 } });
    IMAGE_ACTION_HANDLERS.crop.run(ctx, { rect: { x: 0, y: 0, w: 100, h: 100 } }, undefined);
    expect(ctx.read('i')?.data).not.toHaveProperty('crop');
  });

  it('one clockwise turn is rotation 90 and turns the crop with it', () => {
    const ctx = image({ crop: { x: 0, y: 0, w: 50, h: 100 } });

    IMAGE_ACTION_HANDLERS.rotate.run(ctx, { turns: 1 }, undefined);

    expect(ctx.read('i')?.data).toMatchObject({ rotation: 90, crop: { w: 100, h: 50 } });
  });

  it('four turns are back to no rotation field at all', () => {
    const ctx = image({});

    IMAGE_ACTION_HANDLERS.rotate.run(ctx, { turns: 2 }, undefined);
    IMAGE_ACTION_HANDLERS.rotate.run(ctx, { turns: 2 }, undefined);

    expect(ctx.read('i')?.data).not.toHaveProperty('rotation');
  });

  it('flip mirrors and flips markup', () => {
    const ctx = image({ markup: [{ id: 'm', type: 'text', color: '#ffffff', x: 0.2, y: 0.5, text: 'a', size: 0.1 }] });

    IMAGE_ACTION_HANDLERS.flip.run(ctx, {}, undefined);

    expect(ctx.read('i')?.data).toMatchObject({ flipX: true, markup: [{ x: 0.8 }] });
  });

  it('straighten needs the natural size', () => {
    expect(() => IMAGE_ACTION_HANDLERS.straighten.run(image({}), { degrees: 5 }, undefined)).toThrow(FakeFailure);
    const ctx = image({ naturalWidth: 800, naturalHeight: 600 });

    IMAGE_ACTION_HANDLERS.straighten.run(ctx, { degrees: 5 }, undefined);
    expect(ctx.read('i')?.data).toMatchObject({ straighten: 5 });
  });
});
```

The rotate expectation (`crop` w/h swap, `rotation: 90` after one clockwise turn = three `rotateLeft`) follows `geometry.ts:50-58`; verify the exact crop numbers by running `rotateLeft` three times by hand in the test's first draft and keep what it returns.

Run: `yarn test test/unit/shared/tool-actions/image-geometry.test.ts` → FAIL.

- [ ] **Step 2: Move and implement**

Do the moves with `git mv` and shims, then:

```ts
// src/shared/tool-actions/image.ts
import type { ImageCrop, ImageData, ToolActionContext, ToolActionImpl } from '../../../types';
import { isFullRect, widthForAspectChange } from '../image/crop-math';
import { coverCrop, flipHorizontal, geometryFields, orientedSize, readGeometry, rotateLeft } from '../image/geometry';
import type { Geometry } from '../image/geometry';
import { flipMarkup, readMarkup, turnMarkupLeft } from '../image/markup-model';

const FULL: ImageCrop = { x: 0, y: 0, w: 100, h: 100 };

const target = (ctx: ToolActionContext): { id: string; data: Partial<ImageData> } => {
  const block = ctx.block ?? ctx.fail('INVALID_ARGS', 'Pass the id of an image block.');

  return { id: block.id, data: block.data as Partial<ImageData> };
};

const naturalOf = (data: Partial<ImageData>): { w: number; h: number } | null =>
  (typeof data.naturalWidth === 'number' && typeof data.naturalHeight === 'number' ? { w: data.naturalWidth, h: data.naturalHeight } : null);

// geometryFields omits defaults, so each field is written or removed explicitly.
const geometryPatch = (g: Geometry): Record<string, unknown> => ({ rotation: undefined, flipX: undefined, straighten: undefined, ...geometryFields(g) });
const cropPatch = (crop: ImageCrop): Record<string, unknown> => ({ crop: isFullRect(crop) && crop.shape === undefined ? undefined : crop });
const markupPatch = (data: Partial<ImageData>, map: (m: ReturnType<typeof readMarkup>) => ReturnType<typeof readMarkup>): Record<string, unknown> =>
  (data.markup === undefined ? {} : { markup: map(readMarkup(data.markup)) });

const crop: ToolActionImpl<{ rect: Omit<ImageCrop, 'shape'>; shape?: ImageCrop['shape'] }> = {
  run: (ctx, args) => {
    const { id, data } = target(ctx);
    const next: ImageCrop = args.shape === undefined ? { ...args.rect } : { ...args.rect, shape: args.shape };
    const natural = naturalOf(data);
    const g = readGeometry(data);
    const width = data.width === undefined
      ? {}
      : { width: natural === null
        ? widthForAspectChange(data.width, data.crop, next)
        : widthForAspectChange(data.width, data.crop, next, orientedSize(natural, g), orientedSize(natural, g)) };

    ctx.update(id, { ...cropPatch(next), ...width });

    return undefined;
  },
};

const rotate: ToolActionImpl<{ turns: 1 | 2 | 3 }> = {
  run: (ctx, args) => {
    const { id, data } = target(ctx);
    let state = { g: readGeometry(data), crop: data.crop ?? FULL };
    let markup = readMarkup(data.markup);

    // The UI only turns left; one clockwise turn is three left turns.
    for (let i = 0; i < (4 - args.turns) % 4; i += 1) {
      state = rotateLeft(state.g, state.crop);
      markup = turnMarkupLeft(markup);
    }
    ctx.update(id, { ...geometryPatch(state.g), ...cropPatch(state.crop), ...markupPatch(data, () => markup) });

    return undefined;
  },
};

const flip: ToolActionImpl<Record<string, never>> = {
  run: (ctx) => {
    const { id, data } = target(ctx);
    const state = flipHorizontal(readGeometry(data), data.crop ?? FULL);

    ctx.update(id, { ...geometryPatch(state.g), ...cropPatch(state.crop), ...markupPatch(data, flipMarkup) });

    return undefined;
  },
};

const straighten: ToolActionImpl<{ degrees: number }> = {
  run: (ctx, args) => {
    const { id, data } = target(ctx);
    const natural = naturalOf(data) ?? ctx.fail('PRECONDITION_FAILED', 'Straighten needs naturalWidth and naturalHeight; they are filled once the image has loaded in an editor.');
    const g = { ...readGeometry(data), straighten: args.degrees };

    ctx.update(id, { ...geometryPatch(g), ...cropPatch(coverCrop(data.crop ?? FULL, orientedSize(natural, g), args.degrees)) });

    return undefined;
  },
};

export const IMAGE_ACTION_HANDLERS = { crop, rotate, flip, straighten } as const;
```

`crop`'s width rule passes the same oriented size twice because cropping does not change the turn; `applyCrop` passes the before/after geometry, which differ only when the darkroom turned the image in the same session. Declarations in `image.ts` (`IMAGE_ACTIONS` gains `crop`, `rotate`, `flip`, `straighten`): `crop` args `{ rect: { x, y, w, h } numbers 0..100, required all; shape?: enum }`; `rotate` `{ turns: { enum: [1, 2, 3] } }`; `flip` `{}`; `straighten` `{ degrees: number -45..45 }` with precondition text. Merge the handlers in both places: `BUILT_IN_RUNTIME_PARTS.image = { actions: { ...MEDIA_ACTION_HANDLERS.image, ...IMAGE_ACTION_HANDLERS } }` and `ImageTool.actionHandlers = { ...MEDIA_ACTION_HANDLERS.image, ...IMAGE_ACTION_HANDLERS }`, so the law (Task 55) sees one handler per declared action.

- [ ] **Step 3: Run, then commit**

Run, one at a time: `yarn test test/unit/shared/tool-actions/image-geometry.test.ts`, and the image tool suites that import the moved modules (`grep -rl "crop-math\|geometry\|markup/model" test/unit/tools/image` and run each). All PASS.

Stage the moved files, shims, new files and test by name. Message: `feat(image): crop, rotate, flip and straighten actions on shared image math`, with the trailer.

### Task 46: Image markup actions

**Files:** `src/shared/tool-actions/image.ts`, `src/shared/tool-descriptions/image.ts`; Test: `test/unit/shared/tool-actions/image-markup.test.ts`

**Interfaces:**
- `image.addMarkup` `{ items: MarkupItem[] }` (1..500, item schema = `$defs.image.properties.markup.items` without `id`). Each item gets `id = ctx.newId()`. Result `{ markupIds }`.
- `image.updateMarkup` `{ markupId: string; patch: object }`. `id` and `type` cannot change.
- `image.removeMarkup` `{ markupIds: string[] } | { all: true }` (the UI's "clear all", spec §2.6).
- After every write the list goes through `readMarkup` (`markup/model.ts:237`), which validates and normalizes items the way the editor loads them; an item it drops fails the action with `INVALID_ARGS` naming the index. After Task 24a the schema accepts every shape the editor saves (all ten types, `cut`, `rotation`, `tx`, `ty`), so these actions accept what `readMarkup` accepts, and 01's post-write validation checks it against the widened schema.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { IMAGE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/image';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

const RECT = { type: 'rect', color: '#0a84ff', x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5, size: 0.012 };

describe('image markup actions', () => {
  it('adds items with minted ids, updates one, removes all', () => {
    const ctx = createFakeCtx(docOf([{ id: 'i', type: 'image', data: { url: 'u' } }]), 'i');
    const { markupIds } = IMAGE_ACTION_HANDLERS.addMarkup.run(ctx, { items: [RECT] }, undefined) as { markupIds: string[] };

    IMAGE_ACTION_HANDLERS.updateMarkup.run(ctx, { markupId: markupIds[0], patch: { color: '#ff3b30' } }, undefined);
    expect((ctx.read('i')?.data as { markup: Array<{ id: string; color: string }> }).markup[0]).toMatchObject({ id: markupIds[0], color: '#ff3b30' });

    IMAGE_ACTION_HANDLERS.removeMarkup.run(ctx, { all: true }, undefined);
    expect(ctx.read('i')?.data).not.toHaveProperty('markup');
  });

  it('refuses to change an item type and an unknown id', () => {
    const ctx = createFakeCtx(docOf([{ id: 'i', type: 'image', data: { url: 'u' } }]), 'i');
    const { markupIds } = IMAGE_ACTION_HANDLERS.addMarkup.run(ctx, { items: [RECT] }, undefined) as { markupIds: string[] };

    expect(() => IMAGE_ACTION_HANDLERS.updateMarkup.run(ctx, { markupId: markupIds[0], patch: { type: 'text' } }, undefined)).toThrow(FakeFailure);
    expect(() => IMAGE_ACTION_HANDLERS.removeMarkup.run(ctx, { markupIds: ['nope'] }, undefined)).toThrow(FakeFailure);
  });
});
```

Run: `yarn test test/unit/shared/tool-actions/image-markup.test.ts` → FAIL.

- [ ] **Step 2: Implement**

```ts
const writeMarkup = (ctx: ToolActionContext, id: string, items: unknown[]): void => {
  const read = readMarkup(items);

  if (read.length !== items.length) {
    ctx.fail('INVALID_ARGS', 'A markup item is not valid: check its type, color (#rrggbb), coordinates (0..1) and size.');
  }
  ctx.update(id, { markup: read.length === 0 ? undefined : read });
};

const addMarkup: ToolActionImpl<{ items: Array<Record<string, unknown>> }, undefined, { markupIds: string[] }> = {
  run: (ctx, args) => {
    const { id, data } = target(ctx);
    const added = args.items.map(item => ({ ...item, id: ctx.newId() }));

    writeMarkup(ctx, id, [...readMarkup(data.markup), ...added]);

    return { markupIds: added.map(item => item.id) };
  },
};

const updateMarkup: ToolActionImpl<{ markupId: string; patch: Record<string, unknown> }> = {
  run: (ctx, args) => {
    if ('id' in args.patch || 'type' in args.patch) {
      ctx.fail('INVALID_ARGS', 'id and type cannot change. Remove the item and add a new one instead.');
    }
    const { id, data } = target(ctx);
    const items = readMarkup(data.markup);

    if (!items.some(item => item.id === args.markupId)) {
      ctx.fail('PRECONDITION_FAILED', `This image has no markup item ${args.markupId}.`);
    }
    writeMarkup(ctx, id, items.map(item => (item.id === args.markupId ? { ...item, ...args.patch } : item)));

    return undefined;
  },
};

const removeMarkup: ToolActionImpl<{ markupIds?: string[]; all?: true }> = {
  run: (ctx, args) => {
    const { id, data } = target(ctx);
    const items = readMarkup(data.markup);
    const ids = new Set(args.all === true ? items.map(item => item.id) : args.markupIds ?? []);

    [...ids].filter(markupId => !items.some(item => item.id === markupId))
      .forEach(markupId => ctx.fail('PRECONDITION_FAILED', `This image has no markup item ${markupId}.`));
    writeMarkup(ctx, id, items.filter(item => !ids.has(item.id)));

    return undefined;
  },
};
```

Add `addMarkup`, `updateMarkup`, `removeMarkup` to `IMAGE_ACTION_HANDLERS` (Task 45's object); the runtime entry and the class static pick them up through the spread. `readMarkup` keeps a given id when it is unique and mints with nanoid only for a missing one; every item here carries an id, so nanoid never runs (it would fail in Jint). Declarations: `addMarkup` args `{ items: { type: 'array', minItems: 1, maxItems: 500, items: <the three markup branches with id removed from properties and required> } }`; build that schema in `image.ts` by mapping over `IMAGE_DATA.properties.markup.items.anyOf` and dropping `id` (a function at module load, so it stays one source); `updateMarkup` `{ markupId: string, patch: { type: 'object' } }`; `removeMarkup` `oneOf` of `{ markupIds: string[] (minItems 1) }` and `{ all: { const: true } }`.

- [ ] **Step 3: Run, then commit**

Run: `yarn test test/unit/shared/tool-actions/image-markup.test.ts` → PASS.

```bash
npx eslint src/shared/tool-actions/image.ts src/shared/tool-descriptions/image.ts test/unit/shared/tool-actions/image-markup.test.ts
git add src/shared/tool-actions/image.ts src/shared/tool-descriptions/image.ts test/unit/shared/tool-actions/image-markup.test.ts
git commit -m "feat(image): addMarkup, updateMarkup and removeMarkup actions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 47: `embed.setUrl`

**Files:**
- Move: `src/tools/link/registry.ts` → `src/shared/embed-registry.ts` (old path re-exports `*`; `src/tools/index.ts:52-53` keeps exporting `matchEmbedService`, `buildEmbedUrl` through the shim)
- Create: `src/shared/tool-actions/link.ts`
- Modify: `src/shared/tool-descriptions/embed.ts`, `src/shared/tool-actions/index.ts`, `src/tools/link/embed/index.ts` (static)
- Test: `test/unit/shared/tool-actions/embed.test.ts`

**Interfaces:**
- `registry.ts` imports only a type (`SupportedLocale`, `registry.ts:13`), so it is pure.
- `embed.setUrl` `{ url: string }`: `matchEmbedService(url)` (`registry.ts:1600`) → writes `{ service, source: url, embed: match.embedUrl, kind, width: config.width ?? 580, height: config.height ?? 320 }`, as `resolveAndSet` does (`src/tools/link/embed/index.ts:237-252`; defaults `:133-134`). A URL no provider matches fails with `PRECONDITION_FAILED`. The editor's generic-embed path needs the host's `linkPaste.allowGenericEmbed` (`embed/index.ts:296-298`), which a tool runtime does not see; generic embeds are not offered to agents in v1.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import { LINK_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/link';
import { createFakeCtx, docOf, FakeFailure } from './fake-ctx';

describe('embed.setUrl', () => {
  it('fills service, embed and kind from the provider registry', () => {
    const ctx = createFakeCtx(docOf([{ id: 'e', type: 'embed', data: { service: '', source: '', embed: '' } }]), 'e');

    LINK_ACTION_HANDLERS.embed.setUrl.run(ctx, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, undefined);

    expect(ctx.read('e')?.data).toMatchObject({ service: 'youtube', source: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', kind: 'iframe' });
    expect((ctx.read('e')?.data as { embed: string }).embed).toMatch(/^https:\/\/www\.youtube\.com\/embed\//);
  });

  it('refuses a URL no provider knows', () => {
    const ctx = createFakeCtx(docOf([{ id: 'e', type: 'embed', data: {} }]), 'e');

    expect(() => LINK_ACTION_HANDLERS.embed.setUrl.run(ctx, { url: 'https://example.com/x' }, undefined)).toThrow(FakeFailure);
  });
});
```

Run: `yarn test test/unit/shared/tool-actions/embed.test.ts` → FAIL.

- [ ] **Step 2: Implement**

```ts
// src/shared/tool-actions/link.ts
import type { ToolActionImpl } from '../../../types';
import { EMBED_SERVICES, matchEmbedService } from '../embed-registry';

// The embed tool's fallback frame size (src/tools/link/embed/index.ts:133-134).
const DEFAULT_WIDTH = 580;
const DEFAULT_HEIGHT = 320;

const setUrl: ToolActionImpl<{ url: string }> = {
  run: (ctx, args) => {
    const block = ctx.block ?? ctx.fail('INVALID_ARGS', 'Pass the id of an embed block.');
    const match = matchEmbedService(args.url)
      ?? ctx.fail('PRECONDITION_FAILED', 'No embed provider matches this URL. Use a bookmark (bookmark.create) or a link in text instead.');
    const config = EMBED_SERVICES[match.service];

    ctx.update(block.id, {
      service: match.service,
      source: args.url,
      embed: match.embedUrl,
      kind: match.kind,
      width: config.width ?? DEFAULT_WIDTH,
      height: config.height ?? DEFAULT_HEIGHT,
    });

    return undefined;
  },
};

export const LINK_ACTION_HANDLERS = { embed: { setUrl } } as const;
```

Check that `EMBED_SERVICES` is exported from `registry.ts` (the embed tool reads it at `embed/index.ts:244`; follow that import). Declaration `EMBED_ACTIONS` in `embed.ts`: `setUrl`, args `{ url: string, pattern '^https?://' }`, precondition "The URL belongs to a known provider." Register `embed: { actions: LINK_ACTION_HANDLERS.embed }`; static on `Embed`.

- [ ] **Step 3: Run, then commit**

Run: `yarn test test/unit/shared/tool-actions/embed.test.ts` → PASS. Run the embed registry suites (`grep -rl "link/registry" test/unit` and run each) → PASS.

Stage by name (moved registry, shim, new and modified files, test). Message: `feat(embed): embed.setUrl action on the shared provider registry`, with the trailer.

### Task 48: `bookmark.create`

**Files:** `src/shared/tool-actions/link.ts`, `src/shared/tool-descriptions/bookmark.ts`, `src/shared/tool-actions/index.ts`, `src/tools/link/bookmark/index.ts` (static); Test: `test/unit/shared/tool-actions/bookmark.test.ts`

**Interfaces:**
- `bookmark.create` (create) `{ url: string }`, `requires: ['linkMetadata']`. `prepare` calls `linkMetadata.fetch(url)`; a failed fetch yields `{ url }`, exactly as the UI keeps `{ url }` when roughly a third of sites serve no preview (`src/tools/link/bookmark/index.ts:212-221`). `run` inserts a `bookmark` block with the metadata. Result `{ id, childIds: [] }`.
- Browser: 03 provides `linkMetadata` from the bookmark tool's `endpoint` config (`types/tools/bookmark.d.ts`, `BookmarkConfig.endpoint`). Without it the action is unavailable (06 R3-1).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';

import { LINK_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/link';
import { createFakeCtx, docOf } from './fake-ctx';

describe('bookmark.create', () => {
  it('fetches metadata in prepare and inserts the card', async () => {
    const fetch = vi.fn().mockResolvedValue({ url: 'https://a.b', title: 'A' });
    const action = LINK_ACTION_HANDLERS.bookmark.create;
    const prepared = await action.prepare?.({ services: { linkMetadata: { fetch } } }, { url: 'https://a.b' });
    const ctx = createFakeCtx(docOf([]), undefined, 'bookmark');
    const { id } = action.run(ctx, { url: 'https://a.b' }, prepared) as { id: string };

    expect(ctx.read(id)).toMatchObject({ type: 'bookmark', data: { url: 'https://a.b', title: 'A' } });
  });

  it('keeps just the URL when the fetch fails', async () => {
    const action = LINK_ACTION_HANDLERS.bookmark.create;
    const prepared = await action.prepare?.({ services: { linkMetadata: { fetch: vi.fn().mockRejectedValue(new Error('x')) } } }, { url: 'https://a.b' });

    expect(prepared).toEqual({ url: 'https://a.b' });
  });
});
```

Run: `yarn test test/unit/shared/tool-actions/bookmark.test.ts` → FAIL.

- [ ] **Step 2: Implement**

```ts
import type { BlockPosition, BookmarkMeta } from '../../../types';
import type { LinkMetadataService } from './services';

const create: ToolActionImpl<{ url: string; parentId?: string | null; position?: BlockPosition }, BookmarkMeta, { id: string; childIds: string[] }> = {
  prepare: async ({ services }, args) => {
    const metadata = services.linkMetadata as LinkMetadataService;

    try {
      return { ...(await metadata.fetch(args.url)), url: args.url };
    } catch {
      return { url: args.url };
    }
  },
  run: (ctx, args, prepared) => ({
    id: ctx.insert({ type: ctx.tool, data: { ...(prepared ?? { url: args.url }) }, parentId: args.parentId, position: args.position }),
    childIds: [],
  }),
};

export const LINK_ACTION_HANDLERS = { embed: { setUrl }, bookmark: { create } } as const;
```

`BookmarkMeta` is declared in `types/tools/bookmark.d.ts`; import it from that path if `types/index.d.ts` does not re-export it. Declaration `BOOKMARK_ACTIONS`: `create`, target `create`, `requires: ['linkMetadata']`, args `{ url: string, pattern '^https?://' }`. Register `bookmark: { actions: LINK_ACTION_HANDLERS.bookmark }`; static on `Bookmark`.

- [ ] **Step 3: Run, then commit**

Run: `yarn test test/unit/shared/tool-actions/bookmark.test.ts` → PASS.

```bash
npx eslint src/shared/tool-actions/link.ts src/shared/tool-descriptions/bookmark.ts src/shared/tool-actions/index.ts src/tools/link/bookmark/index.ts test/unit/shared/tool-actions/bookmark.test.ts
git add src/shared/tool-actions/link.ts src/shared/tool-descriptions/bookmark.ts src/shared/tool-actions/index.ts src/tools/link/bookmark/index.ts test/unit/shared/tool-actions/bookmark.test.ts
git commit -m "feat(bookmark): bookmark.create action with host link metadata

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 49: `page.rename`, `page.setIcon`

**Files:**
- Create: `src/shared/tool-actions/page.ts`
- Modify: `src/shared/tool-descriptions/page.ts`, `src/shared/tool-actions/index.ts`, `src/tools/page/index.ts` (static)
- Test: `test/unit/shared/tool-actions/page.test.ts`

**Interfaces:**
- Both: `target: 'block'`, `runtime: 'any'`, `effects: 'host'`, `requires: ['pageBackend']` (06 R3-2). The whole effect runs in `prepare` through `PageBackendService` (Task 44); `run` writes nothing in this document and returns the prepared result. They must be alone in their batch (01 enforces, 06 R2-02-3).
- `page.rename` `{ title: string }`; `page.setIcon` `{ icon: PageIcon | null }` (`types/tools/page.d.ts:13`).
- `prepare` receives the core-added `id` in `args` (06 §3.1) and passes it to the service as `blockId`; the browser service reads the block's `pageId` and calls the host hooks `config.rename(pageId, title)` / `config.setIcon(pageId, icon)` (`src/tools/page/index.ts:432-475`, `:489-521`); Node opens the target page document (06 §10.1 B) through 01's `createPageMapBackend` (01 Task 17), which 04 turns on with `--page-titles page-map`. The browser object is 03's (03 Task 9a).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';

import { PAGE_ACTION_HANDLERS } from '../../../../src/shared/tool-actions/page';
import { describePage } from '../../../../src/shared/tool-descriptions/page';
import { createFakeCtx, docOf } from './fake-ctx';

describe('page.rename / page.setIcon', () => {
  it('declares a host effect behind pageBackend', () => {
    const actions = describePage({}).actions ?? [];

    expect(actions.map(action => [action.name, action.effects, action.requires, action.runtime ?? 'any']))
      .toEqual([['rename', 'host', ['pageBackend'], 'any'], ['setIcon', 'host', ['pageBackend'], 'any']]);
  });

  it('does its whole effect in prepare and writes nothing here', async () => {
    const rename = vi.fn().mockResolvedValue({ pageId: 'p', applied: true });
    const action = PAGE_ACTION_HANDLERS.rename;
    const prepared = await action.prepare?.({ services: { pageBackend: { rename, setIcon: vi.fn() } } }, { id: 'b', title: 'Roadmap' });
    const ctx = createFakeCtx(docOf([{ id: 'b', type: 'page', data: { pageId: 'p' } }]), 'b');

    expect(rename).toHaveBeenCalledWith({ blockId: 'b', title: 'Roadmap' });
    expect(action.run(ctx, { id: 'b', title: 'Roadmap' }, prepared)).toEqual({ pageId: 'p', applied: true });
    expect(ctx.edits).toEqual([]);
  });
});
```

Run: `yarn test test/unit/shared/tool-actions/page.test.ts` → FAIL.

- [ ] **Step 2: Implement**

```ts
// src/shared/tool-actions/page.ts
import type { PageIcon, ToolActionImpl } from '../../../types';
import type { PageBackendService } from './services';

const rename: ToolActionImpl<{ id: string; title: string }, unknown, unknown> = {
  prepare: ({ services }, args) => (services.pageBackend as PageBackendService).rename({ blockId: args.id, title: args.title }),
  run: (_ctx, _args, prepared) => prepared,
};

const setIcon: ToolActionImpl<{ id: string; icon: PageIcon | null }, unknown, unknown> = {
  prepare: ({ services }, args) => (services.pageBackend as PageBackendService).setIcon({ blockId: args.id, icon: args.icon }),
  run: (_ctx, _args, prepared) => prepared,
};

export const PAGE_ACTION_HANDLERS = { rename, setIcon } as const;
```

Declarations in `page.ts`:

```ts
export const PAGE_ACTIONS: ToolActionDeclaration[] = [
  {
    name: 'rename',
    summary: 'Rename the page this block points to. Not this document: use doc.setTitle for that.',
    target: 'block', runtime: 'any', effects: 'host', requires: ['pageBackend'],
    preconditions: ['Send it alone in its batch.'],
    args: { type: 'object', required: ['title'], additionalProperties: false, properties: { title: { type: 'string' } } },
  },
  {
    name: 'setIcon',
    summary: 'Set or clear the icon of the page this block points to.',
    target: 'block', runtime: 'any', effects: 'host', requires: ['pageBackend'],
    preconditions: ['Send it alone in its batch.'],
    args: { type: 'object', required: ['icon'], additionalProperties: false, properties: { icon: { anyOf: [PAGE_ICON_SCHEMA, { type: 'null' }] } } },
  },
];
```

`PAGE_ICON_SCHEMA` is the Task 23 constant in the same module. Register `page: { actions: PAGE_ACTION_HANDLERS }`; static on `PageTool`.

- [ ] **Step 3: Run, then commit**

Run: `yarn test test/unit/shared/tool-actions/page.test.ts` → PASS. Run: `yarn test test/unit/view/document-schema.test.ts` → PASS.

```bash
npx eslint src/shared/tool-actions/page.ts src/shared/tool-descriptions/page.ts src/shared/tool-actions/index.ts src/tools/page/index.ts test/unit/shared/tool-actions/page.test.ts
git add src/shared/tool-actions/page.ts src/shared/tool-descriptions/page.ts src/shared/tool-actions/index.ts src/tools/page/index.ts test/unit/shared/tool-actions/page.test.ts
git commit -m "feat(page): page.rename and page.setIcon as host-effect actions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Checkpoint 4

- [ ] Run, one at a time, every test under `test/unit/shared/tool-actions/` and `test/unit/shared/table/`, `test/unit/shared/database/`, plus the moved modules' existing suites (`test/unit/tools/table/*`, `test/unit/tools/database/*`, image and embed suites found by grep in Tasks 45, 47). All PASS.
- [ ] `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` (timeout 600000) PASS.
- [ ] `git pull --rebase && git push`; `git status` up to date.
- [ ] Tell 01: every §3.8 action is declared and handled; `cleanupEmptiedColumnList` is exported for `block.move`. Tell 03 and 04: the three host service shapes are in `src/shared/tool-actions/services.ts`, and `PageBackendService` takes the block id.

---
## Phase 5: Surfaces, coverage, laws

### Task 50: The Jint `manifest` operation

**Gate:** 01's `COMMANDS` exists in `src/shared/agent/commands.ts` (01 §5, 06 §3.6).

**Files:**
- Modify: `src/view/server-runtime.ts` (new `case 'manifest'` next to `'schema'`, `:466-467`)
- Modify: `test/unit/scripts/build-server-runtime.test.ts` (new cases in the globals-free realm)

**Interfaces:**
- Consumes: `buildBuiltInSnapshot` (Task 27), `readCustomToolsFile`, `snapshotWithCustomTools` (Task 29), `buildToolManifest`, `buildAgentContract` (Tasks 5, 6), `COMMANDS` (01), `getBlokVersion` (already imported at `server-runtime.ts:4`).
- Produces (06 §7.2): `blokServerInvoke('manifest', JSON.stringify({ customTools?, overrides?, services? }))` → `JSON.stringify({ manifest, contract })`, with `where = { runtime: 'jint', services: input.services ?? [] }`. C# `IBlokAgentExecutor.GetContractAsync` (01 + 04) calls it. A bad `customTools` value throws the `TypeError` from `readCustomToolsFile`, which reaches C# like every other op's input error (`server-runtime.ts:28-33` pattern).

- [ ] **Step 1: Write the failing tests**

```ts
  /** The agent contract for the C# server: built from the same modules, in a realm with no host globals. */
  it('builds the agent manifest and contract in a realm with no host globals', async () => {
    const outputPath = await buildServerRuntime(outDir);
    const sandbox: Record<string, unknown> = {};

    runInContext(readFileSync(outputPath, 'utf8'), createContext(sandbox));

    const invoke = sandbox.blokServerInvoke as (op: string, input: string) => Promise<string>;
    const { manifest, contract } = JSON.parse(await invoke('manifest', '{}')) as {
      manifest: { blocks: Array<{ name: string; level: string }> };
      contract: { commands: Array<{ name: string; available: boolean; unavailableReason?: string }> };
    };
    const command = (name: string) => contract.commands.find(entry => entry.name === name);

    expect(manifest.blocks.every(block => block.level === 'described')).toBe(true);
    expect(command('table.insertRows')?.available).toBe(true);
    expect(command('image.setSource')?.available).toBe(true);
    expect(command('bookmark.create')).toMatchObject({ available: false, unavailableReason: 'service' });
    expect(command('page.rename')).toMatchObject({ available: false, unavailableReason: 'service' });
    expect(command('history.undo')).toMatchObject({ available: false, unavailableReason: 'runtime' });
  });

  it('adds custom tools without handlers and applies overrides in the bare realm', async () => {
    const outputPath = await buildServerRuntime(outDir);
    const sandbox: Record<string, unknown> = {};

    runInContext(readFileSync(outputPath, 'utf8'), createContext(sandbox));

    const invoke = sandbox.blokServerInvoke as (op: string, input: string) => Promise<string>;
    const statics = {
      toolbox: [], richTextFields: [], acceptsChildren: false, ownsChildren: false, isLayout: false, deletesChildren: false,
      selfPlacesChildren: false, restrictedInTableCell: false, conversion: {}, convertible: { import: false, export: false }, hasPrepareInsert: false,
    };
    const customTools = { formatVersion: 1, blocks: [{ name: 'quiz', statics, description: { summary: 'Q', data: { type: 'object' }, actions: [{ name: 'grade', summary: 'G', target: 'block', args: { type: 'object' } }] } }] };
    const { contract } = JSON.parse(await invoke('manifest', JSON.stringify({ customTools, overrides: { spacer: { hidden: true } } }))) as {
      contract: { commands: Array<{ name: string; available: boolean }>; manifest: { blocks: Array<{ name: string }> } };
    };

    expect(contract.commands.find(entry => entry.name === 'quiz.grade')?.available).toBe(false);
    expect(contract.manifest.blocks.map(block => block.name)).not.toContain('spacer');
  });
```

Also add a Node-equality case in a separate file `test/unit/view/server-runtime-manifest.test.ts` (`// @vitest-environment node`) that imports `invoke` from `src/view/server-runtime.ts` and compares `invoke('manifest', '{}')` with `buildAgentContract(buildToolManifest(buildBuiltInSnapshot({ blokVersion: getBlokVersion() })), COMMANDS, { runtime: 'jint', services: [] })` built directly: they must be equal (spec §6 item 12).

Run: `yarn test test/unit/scripts/build-server-runtime.test.ts`
Expected: FAIL, "Unsupported Blok runtime operation: manifest".

- [ ] **Step 2: Add the operation**

```ts
    /**
     * The agent contract for this server's tools: built-ins plus a host's
     * JSON custom tools file. Custom actions have no handler here (06 D6).
     */
    case 'manifest': {
      const input = parseRecord(inputJson);
      const customTools = input.customTools === undefined ? undefined : readCustomToolsFile(input.customTools);
      const services = Array.isArray(input.services) ? input.services.filter((s): s is HostService => typeof s === 'string') : [];
      const snapshot = snapshotWithCustomTools(buildBuiltInSnapshot({ blokVersion: getBlokVersion(), services }), customTools);
      const manifest = buildToolManifest(snapshot, (input.overrides ?? {}) as ManifestOverrides);

      return JSON.stringify({ manifest, contract: buildAgentContract(manifest, COMMANDS, { runtime: 'jint', services }) });
    }
```

with imports from `'../shared/built-in-snapshot'`, `'../shared/custom-tools-file'`, `'../shared/tool-manifest'`, `'../shared/agent/commands'`, and the `HostService`, `ManifestOverrides` types. If `COMMANDS`' entry type differs from `CoreCommandTable` (Task 6), adapt in one place: a mapping function in `src/shared/tool-manifest.ts`, not a cast at the call site.

- [ ] **Step 3: Run the tests**

Run: `yarn test test/unit/scripts/build-server-runtime.test.ts` → PASS.
Run: `yarn test test/unit/view/server-runtime-manifest.test.ts` → PASS.
Run: `yarn test test/unit/view/index.purity.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
npx eslint src/view/server-runtime.ts test/unit/scripts/build-server-runtime.test.ts test/unit/view/server-runtime-manifest.test.ts
git add src/view/server-runtime.ts test/unit/scripts/build-server-runtime.test.ts test/unit/view/server-runtime-manifest.test.ts
git commit -m "feat(server-runtime): manifest operation returns the agent contract for the C# server

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 51: The default contract builds in plain Node

**Files:**
- Test: `test/unit/shared/node-contract.test.ts` (`// @vitest-environment node`)

**Interfaces:**
- Consumes: `buildBuiltInSnapshot`, `BUILT_IN_TOOL_RUNTIMES`, `buildToolManifest`, `buildAgentContract`.
- Produces: spec §6 item 11 and S5. It is the same build 01's `createHeadlessAgentSetup` (01 Task 21) runs for 04 and 05. It uses an empty core table so it does not wait for 01.

- [ ] **Step 1: Write the test**

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildBuiltInSnapshot } from '../../../src/shared/built-in-snapshot';
import { BUILT_IN_TOOL_RUNTIMES } from '../../../src/shared/tool-actions';
import { buildAgentContract, buildToolManifest } from '../../../src/shared/tool-manifest';

describe('default contract in Node', () => {
  it('needs no DOM and lists every declared action with a handler', () => {
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
    const manifest = buildToolManifest(buildBuiltInSnapshot({ blokVersion: '1.0.0' }));
    const contract = buildAgentContract(manifest, {}, { runtime: 'node', services: [] });
    const declared = manifest.blocks.flatMap(block => block.actions.map(action => action.command));

    expect(contract.commands.map(command => command.name).sort()).toEqual([...declared].sort());
    manifest.blocks.forEach(block => block.actions.forEach((action) => {
      expect(BUILT_IN_TOOL_RUNTIMES.get(block.name)?.actions[action.name], action.command).toBeDefined();
    }));
  });

  it('every table, columns, tabs and database action exists (spec §3.8)', () => {
    const names = buildAgentContract(buildToolManifest(buildBuiltInSnapshot({ blokVersion: '1' })), {}, { runtime: 'node', services: [] })
      .commands.map(command => command.name);

    expect(names).toEqual(expect.arrayContaining([
      'table.create', 'table.insertRows', 'table.insertColumns', 'table.deleteRows', 'table.deleteColumns', 'table.moveRow', 'table.moveColumn',
      'table.duplicateRows', 'table.duplicateColumns', 'table.clearCells', 'table.styleCells', 'table.mergeCells', 'table.splitCell', 'table.fillCells',
      'column_list.create', 'column_list.addColumn', 'column_list.removeColumn', 'column_list.setWidths',
      'tabs.create', 'tabs.addTab', 'tabs.deleteTab',
      'database.create', 'database.addView', 'database.renameView', 'database.duplicateView', 'database.deleteView', 'database.moveView',
      'database.addProperty', 'database.addOption', 'database.renameOption', 'database.moveOption', 'database.deleteOption',
      'database.addRow', 'database.moveRow', 'database.setRowValues',
      'image.setSource', 'video.setSource', 'audio.setSource', 'file.setSource', 'audio.setCover',
      'image.crop', 'image.rotate', 'image.flip', 'image.straighten', 'image.addMarkup', 'image.updateMarkup', 'image.removeMarkup',
      'embed.setUrl', 'bookmark.create', 'page.rename', 'page.setIcon',
    ]));
  });
});
```

- [ ] **Step 2: Run it**

Run: `yarn test test/unit/shared/node-contract.test.ts`
Expected: PASS when Phase 4 is complete. A missing name is a missing task, not a test to edit.

- [ ] **Step 3: Commit**

```bash
npx eslint test/unit/shared/node-contract.test.ts
git add test/unit/shared/node-contract.test.ts
git commit -m "test(shared): the default agent contract builds in plain Node with every spec action

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 52: Derived `describe` for React, Vue and Angular blocks

**Files:**
- Modify: `src/shared/prop-schema.ts` (add `describeFromPropSchema`)
- Modify: `packages/react/src/createReactBlock.tsx:1043-1060`, `packages/vue/src/createVueBlock.ts:722-736`, `packages/angular/src/createAngularBlock.ts:570-584` (set `describe` when the author's `statics` bag has none)
- Test: `test/unit/shared/prop-schema.test.ts` (extend), `test/unit/react/createReactBlock.test.tsx` (near `:1036`), `test/unit/vue/createVueBlock.test.ts` (near `:515`), `test/unit/angular/createAngularBlock.test.ts` (near `:497`)

**Interfaces:**
- Produces: `describeFromPropSchema(input: { type: string; title?: string; propSchema: PropSchema; richTextFields?: string[] }): BlockToolDescription`.
  - Each `propSchema` key becomes a property. `typeof default` gives `string` / `number` / `boolean`; arrays, objects and `null` stay untyped. `values` becomes `enum`. A key in `richTextFields` gets `richText(...)` instead.
  - `additionalProperties: false`, because `propSchema` keys are exactly the `save()` keys (`src/shared/prop-schema.ts:11-15`).
  - `summary`: `<title or type> block`. `defaultData`: every key's default.
- `src/adapters.ts` already re-exports `./shared/prop-schema`, so the adapters import it from `@bloklabs/core/adapters` with no entry change.
- The Angular adapter HAS `propSchema` (`packages/angular/src/createAngularBlock.ts:108`); spec §2.4 marked that unverified. All three adapters get the derived `describe`.
- An author's own `statics.describe` always wins. Only absence triggers the derived one.
- Behaviour to note in the release note (spec §4): with `additionalProperties: false`, 01 rejects an agent write with an extra key that `fillDefaults` would have dropped silently. It affects only agent writes.

- [ ] **Step 1: Write the failing tests**

`test/unit/shared/prop-schema.test.ts`:

```ts
import { describeFromPropSchema } from '../../../src/shared/prop-schema';
import { validateAgainst } from '../../../src/shared/schema/validate';

describe('describeFromPropSchema', () => {
  const description = describeFromPropSchema({
    type: 'counter',
    title: 'Counter',
    propSchema: { count: { default: 0 }, label: { default: 'n' }, mode: { default: 'a', values: ['a', 'b'] }, tags: { default: [] }, body: { default: [] } },
    richTextFields: ['body'],
  });

  it('types keys from their defaults and closes the object', () => {
    expect(validateAgainst(description.data, { count: 1, label: 'x', mode: 'b', tags: ['t'], body: [{ text: 'hi' }] })).toEqual([]);
    expect(validateAgainst(description.data, { count: 'one' }).length).toBeGreaterThan(0);
    expect(validateAgainst(description.data, { mode: 'c' }).length).toBeGreaterThan(0);
    expect(validateAgainst(description.data, { extra: 1 }).length).toBeGreaterThan(0);
  });

  it('gives a summary and the defaults', () => {
    expect(description.summary).toBe('Counter block');
    expect(description.defaultData).toEqual({ count: 0, label: 'n', mode: 'a', tags: [], body: [] });
  });
});
```

Add to each adapter test, next to the existing statics-forwarding tests:

```ts
  it('derives describe from propSchema when the author gives none', () => {
    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: () => <div />,
    });

    expect((Tool as unknown as BlockToolConstructable).describe?.({}).data).toMatchObject({ additionalProperties: false, properties: { count: { type: 'number' } } });
  });

  it('keeps an authored describe', () => {
    const describe = (): BlockToolDescription => ({ summary: 'Mine', data: { type: 'object' } });
    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: () => <div />,
      statics: { describe },
    });

    expect((Tool as unknown as BlockToolConstructable).describe).toBe(describe);
  });
```

(Vue: `createVueBlock` with its component shape from the neighbouring tests; Angular: `createAngularBlock` likewise.)

Run each, one at a time: `yarn test test/unit/shared/prop-schema.test.ts`, `yarn test test/unit/react/createReactBlock.test.tsx`, `yarn test test/unit/vue/createVueBlock.test.ts`, `yarn test test/unit/angular/createAngularBlock.test.ts`. Expected: FAIL in the new cases.

- [ ] **Step 2: Implement**

`src/shared/prop-schema.ts`:

```ts
import type { BlockToolDescription } from '../../types/tools/tool-description';
import { richText } from './tool-descriptions/rich-text';

const typeFor = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { type: typeof value };
  }

  return {};
};

/**
 * A data schema from a framework block's propSchema. The keys are exactly what
 * save() returns, so the object is closed.
 */
export const describeFromPropSchema = (input: { type: string; title?: string; propSchema: PropSchema; richTextFields?: string[] }): BlockToolDescription => {
  const rich = new Set(input.richTextFields ?? []);

  return {
    summary: `${input.title ?? input.type} block`,
    data: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(Object.entries(input.propSchema).map(([key, entry]) => [key, rich.has(key)
        ? richText(`Rich-text field "${key}".`)
        : { ...typeFor(entry.default), ...(entry.values === undefined ? {} : { enum: [...entry.values] }) }])),
    },
    defaultData: Object.fromEntries(Object.entries(input.propSchema).map(([key, entry]) => [key, entry.default])),
  };
};
```

In each factory, after the statics forwarding loop:

```ts
  // An authored describe wins; otherwise agents get the propSchema shape (02 §3.7).
  if (spec.statics?.describe === undefined) {
    Object.defineProperty(ReactBlockTool, 'describe', {
      value: () => describeFromPropSchema({
        type: spec.type,
        title: typeof spec.toolbox === 'object' && !Array.isArray(spec.toolbox) ? spec.toolbox.title : undefined,
        propSchema: spec.propSchema,
        richTextFields: spec.statics?.richTextFields,
      }),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
```

Same block in Vue (`VueBlockTool`) and Angular (its generated class name; read `createAngularBlock.ts:570-590`). Read each spec's `toolbox` field type first; if it is not `ToolboxConfig`-shaped in one adapter, pass `undefined` for `title` there.

- [ ] **Step 3: Run the tests**

Run the four files from Step 1, one at a time → PASS. Run `yarn lint:angular` → PASS.

- [ ] **Step 4: Commit**

```bash
npx eslint src/shared/prop-schema.ts packages/react/src/createReactBlock.tsx packages/vue/src/createVueBlock.ts test/unit/shared/prop-schema.test.ts test/unit/react/createReactBlock.test.tsx test/unit/vue/createVueBlock.test.ts
git add src/shared/prop-schema.ts packages/react/src/createReactBlock.tsx packages/vue/src/createVueBlock.ts packages/angular/src/createAngularBlock.ts test/unit/shared/prop-schema.test.ts test/unit/react/createReactBlock.test.tsx test/unit/vue/createVueBlock.test.ts test/unit/angular/createAngularBlock.test.ts
git commit -m "feat(adapters): framework blocks describe their data from propSchema

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 53: Name the unnamed menu items

**Files:** the 24 sites below; Test: 05's assertion 6 if it has landed, else `test/unit/architecture/menu-item-names.test.ts`

**Interfaces:**
- Produces stable `menu:<tool>/<name>` capability ids for 05 (06 R2-05-4) and `data-blok-item-name` attributes for e2e locators (`types/utils/popover/popover-item.d.ts:210-213`). Adding `name` is additive (05 §5 "not breaking").
- Names must be unique within one popover: `toggleItemHiddenByName` hides every item that shares a name (`src/components/utils/popover/popover-abstract.ts:466-480`).
- 05 Task 2's law asserts "every tool menu item has a name". If 05 Task 2 landed first with that `it` marked `it.fails`, flip it back to `it` in this task's commit and run `yarn test test/unit/architecture/agent-coverage-law.test.ts`; it is this task's acceptance test.

Measured at `30c77599` with a TypeScript AST scan of `src/tools/` (object literals with `onActivate` and no `name`; 73 literals, 24 unnamed). Reconciled with 05: a scan of all of `src/` at `30c77599` finds the same 24 plus one spread that inherits its `name` (`src/components/modules/toolbar/inline/index.ts:637`), which 05's enumerator counts as named. 05 Task 2 asserts on these names and adds none.

| Site | Name |
|---|---|
| `src/tools/code/index.ts:704` (detected language) | `code-language-detected` |
| `src/tools/code/index.ts:716` (each language) | `` `code-language-${lang.id}` `` |
| `src/tools/database/database-tab-bar.ts:295` | `database-view-rename` |
| `src/tools/database/database-tab-bar.ts:303` | `database-view-duplicate` |
| `src/tools/database/database-tab-bar.ts:316` | `database-view-delete` |
| `src/tools/database/index.ts:1065` | `database-card-delete` |
| `src/tools/list/block-operations.ts:217` | `` `list-style-${styleConfig.style}` `` |
| `src/tools/quote/index.ts:173` | `quote-size-default` |
| `src/tools/quote/index.ts:180` | `quote-size-large` |
| `src/tools/table/table-cell-selection.ts:1499` | `table-merge-cells` |
| `src/tools/table/table-cell-selection.ts:1515` | `table-split-cell` |
| `src/tools/table/table-cell-selection.ts:1531` | `table-copy-selection` |
| `src/tools/table/table-cell-selection.ts:1540` | `table-clear-selection` |
| `src/tools/table/table-row-col-popover.ts:99` | `` `table-duplicate-${type}` `` (`type` is `'row' \| 'col'`) |
| `src/tools/table/table-row-col-popover.ts:107` | `` `table-clear-${type}` `` |
| `src/tools/table/table-row-col-popover.ts:158` | `table-insert-column-left` |
| `src/tools/table/table-row-col-popover.ts:166` | `table-insert-column-right` |
| `src/tools/table/table-row-col-popover.ts:180` | `table-delete-column` |
| `src/tools/table/table-row-col-popover.ts:219` | `table-insert-row-above` |
| `src/tools/table/table-row-col-popover.ts:227` | `table-insert-row-below` |
| `src/tools/table/table-row-col-popover.ts:241` | `table-delete-row` |
| `src/tools/tabs/index.ts:807` | `tabs-rename` |
| `src/tools/tabs/index.ts:813` | `tabs-edit-icon` |
| `src/tools/tabs/index.ts:820` | `tabs-delete` |

Line numbers are from `30c77599`; Phase 4 does not touch these files' menus, but re-run the scan in Step 1 to get current lines.

- [ ] **Step 1: Write the failing test (only if 05's assertion 6 is not on `main`)**

```ts
// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const TOOLS = join(ROOT, 'src', 'tools');

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap(entry => (entry.isDirectory() ? walk(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : []));

// Folded into 05's coverage law (assertion 6) when it lands; delete this file then.
describe('tool menu items have names', () => {
  it('every onActivate item under src/tools has a name', () => {
    const unnamed = walk(TOOLS).flatMap((file) => {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const found: string[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isObjectLiteralExpression(node)) {
          const keys = node.properties.map(property => property.name?.getText(source));

          if (keys.includes('onActivate') && !keys.includes('name')) {
            found.push(`${relative(ROOT, file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
          }
        }
        ts.forEachChild(node, visit);
      };

      visit(source);

      return found;
    });

    expect(walk(TOOLS).length).toBeGreaterThan(50);
    expect(unnamed).toEqual([]);
  });
});
```

Run: `yarn test test/unit/architecture/menu-item-names.test.ts`
Expected: FAIL listing the 24 sites.

- [ ] **Step 2: Add the names**

Add `name: '<name>',` (or the template literal) to each literal in the table, as the first key after `icon`.

- [ ] **Step 3: Run the tests**

Run: `yarn test test/unit/architecture/menu-item-names.test.ts` → PASS.
Run the suites of the touched tools one at a time (`test/unit/tools/table/*` that cover the popovers: `grep -rl "insertRowAbove\|duplicateRow\|mergeCells" test/unit/tools/table`; `test/unit/tools/code*`, `test/unit/tools/quote*`, `test/unit/tools/tabs*`, `test/unit/tools/database/database.test.ts`, the list settings test). All PASS. A test that matched items by array index or snapshot may need its expectation updated for the new attribute; check each diff is only `name`.

- [ ] **Step 4: Commit**

Stage the eleven source files and the test by name. Message: `feat(tools): name every tool menu item for coverage ids and test locators`, with the trailer.

### Task 54: Fill `mirrors`

**Files:** the description modules of table, database, tabs, page; Test: `test/unit/shared/tool-descriptions/mirrors.test.ts`

**Interfaces:**
- Produces `ToolActionDeclaration.mirrors` with 05 capability ids `menu:<tool dir>/<item name>` (05 §3.1.1). A template name yields its static prefix plus `*` (05's enumerator rule).
- Mapping (field writes and view-only items are 05 ledger rows, not mirrors):

| Action | `mirrors` |
|---|---|
| `table.insertRows` | `menu:table/table-insert-row-above`, `menu:table/table-insert-row-below` |
| `table.insertColumns` | `menu:table/table-insert-column-left`, `menu:table/table-insert-column-right` |
| `table.deleteRows` | `menu:table/table-delete-row` |
| `table.deleteColumns` | `menu:table/table-delete-column` |
| `table.duplicateRows`, `table.duplicateColumns` | `menu:table/table-duplicate-*` |
| `table.clearCells` | `menu:table/table-clear-*`, `menu:table/table-clear-selection` |
| `table.mergeCells` | `menu:table/table-merge-cells` |
| `table.splitCell` | `menu:table/table-split-cell` |
| `table.styleCells` | `menu:table/cellColor`, `menu:table/cellPlacement` (existing names, `table-row-col-popover.ts:75`, `table-cell-selection.ts:1447`, `:1480`) |
| `database.renameView`, `duplicateView`, `deleteView` | `menu:database/database-view-rename`, `-duplicate`, `-delete` |
| `tabs.deleteTab` | `menu:tabs/tabs-delete` |
| `page.rename`, `page.setIcon` | `menu:page/page-rename`, `menu:page/page-edit-icon` |

Not mirrored here (05 ledger): `code-language-*`, `list-style-*`, `quote-size-*`, `tabs-rename`, `tabs-edit-icon` (field writes); `table-copy-selection` (clipboard); `database-card-delete` (`block.delete`). If 05's enumerator has landed, also add the `action:table/<type>` ids it emits for `RowColAction` members each table action performs.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BUILT_IN_BLOCK_DESCRIPTIONS } from '../../../../src/shared/tool-descriptions';

const TOOLS = resolve(__dirname, '../../../../src/tools');

const sourceOf = (tool: string): string => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));

  return walk(join(TOOLS, tool)).map(file => readFileSync(file, 'utf8')).join('\n');
};

describe('mirrors', () => {
  const mirrored = Object.values(BUILT_IN_BLOCK_DESCRIPTIONS).flatMap(describe => (describe({}).actions ?? []).flatMap(action => action.mirrors ?? []));

  it('the table actions mirror their menu items', () => {
    expect(mirrored).toEqual(expect.arrayContaining(['menu:table/table-insert-row-above', 'menu:table/table-merge-cells', 'menu:page/page-rename']));
  });

  it.each(mirrored)('%s names a menu item that exists in that tool', (id) => {
    const [, tool, name] = /^menu:([^/]+)\/(.+)$/.exec(id) ?? [];
    const literal = name.endsWith('*') ? `name: \`${name.slice(0, -1)}` : `name: '${name}'`;

    expect(sourceOf(tool)).toContain(literal);
  });
});
```

Run: `yarn test test/unit/shared/tool-descriptions/mirrors.test.ts` → FAIL (no mirrors yet).

- [ ] **Step 2: Add `mirrors` to each declaration in the table above.**

- [ ] **Step 3: Run, then commit**

Run: `yarn test test/unit/shared/tool-descriptions/mirrors.test.ts` → PASS.

Stage the four description modules and the test by name. Message: `feat(tools): actions mirror the menu items they perform`, with the trailer.

### Task 55: The tool-description law

**Files:**
- Create: `test/unit/architecture/tool-description-law.test.ts`

**Interfaces:**
- Produces spec §6 item 4 as one mechanical law. Every assertion has a non-vacuity floor (at least N items scanned), like `view-entry-law.test.ts:45-48`.

- [ ] **Step 1: Write the law**

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { unknownKeywords } from '../../../src/shared/schema/validate';
import { BUILT_IN_RUNTIME_PARTS } from '../../../src/shared/tool-actions';
import { BUILT_IN_BLOCK_DESCRIPTIONS } from '../../../src/shared/tool-descriptions';
import { BUILT_IN_INLINE_DESCRIPTIONS, BUILT_IN_TUNE_DESCRIPTIONS } from '../../../src/shared/tool-descriptions/inline';
import { richText } from '../../../src/shared/tool-descriptions/rich-text';
import { defaultBlockTools, defaultInlineTools } from '../../../src/tools';
import { BLOCK_CLASSES } from '../shared/tool-descriptions/built-in-tools';

const ROOT = resolve(__dirname, '../../..');
const BUILT_IN_BLOCKS = [...Object.keys(defaultBlockTools), 'page', 'page-link'];
const RESERVED_ARGS = ['id', 'parentId', 'position'];
// Mirror of the core command list (06 §3.1). Replace with 01's COMMANDS keys once it is on main.
const CORE_COMMANDS = ['doc.read', 'doc.find', 'doc.setTitle', 'doc.setIcon', 'block.insert', 'block.update', 'block.delete', 'block.move',
  'block.convert', 'block.duplicate', 'text.insert', 'text.delete', 'text.replace', 'text.format', 'markdown.insert', 'markdown.export',
  'history.undo', 'history.redo'];
/** runtime: 'editor' actions, each with a reason. None among built-ins (06 R3-2). */
const EDITOR_ONLY_ACTIONS: Record<string, string> = {};

const descriptions = BUILT_IN_BLOCKS.map(name => [name, BUILT_IN_BLOCK_DESCRIPTIONS[name]?.({})] as const);
const actions = descriptions.flatMap(([name, description]) => (description?.actions ?? []).map(action => ({ tool: name, action })));

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap(entry => (entry.isDirectory() ? walk(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : []));

describe('tool description law', () => {
  it('scans real registries (non-vacuity)', () => {
    expect(BUILT_IN_BLOCKS.length).toBeGreaterThanOrEqual(25);
    expect(actions.length).toBeGreaterThanOrEqual(50);
  });

  it('every built-in block tool, inline tool and tune is described', () => {
    descriptions.forEach(([name, description]) => expect(description, name).toBeDefined());
    Object.keys(defaultInlineTools).forEach(name => expect(BUILT_IN_INLINE_DESCRIPTIONS[name], name).toBeDefined());
    ['delete', 'copyLink'].forEach(name => expect(BUILT_IN_TUNE_DESCRIPTIONS[name], name).toBeDefined());
  });

  it('rich-text fields have the rich-text shape, and no other field does', () => {
    const shape = (value: unknown): string => JSON.stringify({ ...(value as object), description: undefined });
    const rich = shape(richText('x'));

    descriptions.forEach(([name, description]) => {
      const declared = new Set((BLOCK_CLASSES[name] as { richTextFields?: string[] }).richTextFields ?? []);
      const properties = (description?.data as { properties?: Record<string, unknown> }).properties ?? {};

      Object.entries(properties).forEach(([field, schema]) => expect(shape(schema) === rich, `${name}.${field}`).toBe(declared.has(field)));
    });
  });

  it('every schema uses only profile keywords', () => {
    descriptions.forEach(([name, description]) => expect(unknownKeywords(description?.data), name).toEqual([]));
    actions.forEach(({ tool, action }) => {
      expect(unknownKeywords(action.args), `${tool}.${action.name} args`).toEqual([]);
      expect(unknownKeywords(action.result ?? {}), `${tool}.${action.name} result`).toEqual([]);
    });
  });

  it('descriptions survive a JSON round trip', () => {
    descriptions.forEach(([name, description]) => expect(JSON.parse(JSON.stringify(description)), name).toEqual(description));
  });

  it('declarations and handlers match one to one, and the class carries the handlers', () => {
    descriptions.forEach(([name, description]) => {
      const declared = (description?.actions ?? []).map(action => action.name).sort();
      const handled = Object.keys(BUILT_IN_RUNTIME_PARTS[name]?.actions ?? {}).sort();

      expect(handled, name).toEqual(declared);
      expect(Object.keys((BLOCK_CLASSES[name] as { actionHandlers?: object }).actionHandlers ?? {}).sort(), name).toEqual(declared);
    });
  });

  it('action args never declare id, parentId or position', () => {
    actions.forEach(({ tool, action }) => {
      const properties = Object.keys((action.args as { properties?: object }).properties ?? {});

      expect(properties.filter(key => RESERVED_ARGS.includes(key)), `${tool}.${action.name}`).toEqual([]);
    });
  });

  it('names are camelCase and unique per tool', () => {
    descriptions.forEach(([name, description]) => {
      const names = (description?.actions ?? []).map(action => action.name);

      names.forEach(action => expect(action, `${name}.${action}`).toMatch(/^[a-z][a-zA-Z0-9]*$/));
      expect(new Set(names).size, name).toBe(names.length);
    });
  });

  it('runtime editor actions are listed with a reason; host-effect actions have prepare', () => {
    actions.forEach(({ tool, action }) => {
      const command = `${tool}.${action.name}`;

      expect(action.runtime === 'editor', command).toBe(command in EDITOR_ONLY_ACTIONS);
      if (action.effects === 'host') {
        expect(typeof BUILT_IN_RUNTIME_PARTS[tool]?.actions?.[action.name]?.prepare, command).toBe('function');
      }
    });
  });

  it('every handler run is synchronous', () => {
    Object.entries(BUILT_IN_RUNTIME_PARTS).forEach(([tool, parts]) => Object.entries(parts.actions ?? {}).forEach(([name, impl]) => {
      expect(impl.run.constructor.name, `${tool}.${name}`).not.toBe('AsyncFunction');
    }));
  });

  it('guardedFields name a core command, a <tool>.* family or a <tool>.*Suffix family', () => {
    descriptions.forEach(([name, description]) => Object.entries(description?.guardedFields ?? {}).forEach(([field, use]) => {
      const family = /^([a-z_-]+)\.\*(\w*)$/.exec(use);
      const ok = CORE_COMMANDS.includes(use)
        || (family !== null && family[1] === name && (description?.actions ?? []).some(action => action.name.endsWith(family[2])));

      expect(ok, `${name}.${field} → ${use}`).toBe(true);
    }));
  });

  it('every action is named as "<tool>.<action>" in some test file', () => {
    const tests = walk(join(ROOT, 'test', 'unit')).map(file => readFileSync(file, 'utf8')).join('\n');

    actions.forEach(({ tool, action }) => expect(tests.includes(`${tool}.${action.name}`), `${tool}.${action.name}`).toBe(true));
  });

  it('pure description and action modules import nothing from src/components or src/tools', () => {
    const pure = [
      ...walk(join(ROOT, 'src', 'shared', 'tool-descriptions')),
      ...walk(join(ROOT, 'src', 'shared', 'tool-actions')),
      ...walk(join(ROOT, 'src', 'shared', 'schema')),
      join(ROOT, 'src', 'shared', 'tool-manifest.ts'),
      join(ROOT, 'src', 'shared', 'built-in-snapshot.ts'),
      join(ROOT, 'src', 'shared', 'custom-tools-file.ts'),
    ];
    const forbidden = [join(ROOT, 'src', 'components') + sep, join(ROOT, 'src', 'tools') + sep];
    const offenders = pure.flatMap(file => [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]*)['"]/g)]
      .map(match => resolve(dirname(file), match[1]))
      .filter(target => forbidden.some(dir => `${target}${sep}`.startsWith(dir) || target.startsWith(dir)))
      .map(target => `${relative(ROOT, file)} → ${relative(ROOT, target)}`));

    expect(pure.length).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });

  // The Jint realm has only ECMAScript globals (test/unit/scripts/build-server-runtime.test.ts). A host global fails there at call time.
  it('code the Jint bundle runs uses no host-only global', () => {
    const jintCode = [
      ...walk(join(ROOT, 'src', 'shared', 'tool-actions')),
      ...walk(join(ROOT, 'src', 'shared', 'table')),
      ...walk(join(ROOT, 'src', 'shared', 'database')),
      ...walk(join(ROOT, 'src', 'shared', 'image')),
      join(ROOT, 'src', 'shared', 'embed-registry.ts'),
      join(ROOT, 'src', 'shared', 'tool-manifest.ts'),
      join(ROOT, 'src', 'shared', 'built-in-snapshot.ts'),
      join(ROOT, 'src', 'shared', 'custom-tools-file.ts'),
    ];
    // Usages, not words: "document" is a provider type in the embed registry, and comments are stripped first.
    const USAGE = /\b(structuredClone\s*\(|new\s+TextDecoder|new\s+TextEncoder|Buffer\.|atob\s*\(|btoa\s*\(|document\.|window\.)/g;
    const code = (file: string): string => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const offenders = jintCode.flatMap(file => [...code(file).matchAll(USAGE)].map(match => `${relative(ROOT, file)}: ${match[1]}`));

    expect(jintCode.length).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and fix what it finds**

Run: `yarn test test/unit/architecture/tool-description-law.test.ts`
Expected: PASS, or a named failure. The likely one is "named in some test file": a test titled `table.insertRows / insertColumns` does not contain `table.insertColumns`. Rename such titles to name each full command (`table.insertRows / table.insertColumns`) in that action's test file. Do not weaken the law.

- [ ] **Step 3: Prove each assertion can fail (record in the commit message)**

One at a time, then revert: (a) delete `describe` from `Spacer` → red at "described" (the class check is in Task 16's test; here, delete the registry entry); (b) add `format: 'uri'` to a property → red at "profile keywords"; (c) add `id` to `table.insertRows` args → red at "never declare"; (d) rename a handler key → red at "match one to one"; (e) make `image.flip`'s `run` `async` → red at "synchronous"; (f) add an `import` of `../../components/utils/tw` to `src/shared/tool-actions/table.ts` → red at "import nothing"; (g) add `structuredClone(x)` to `src/shared/tool-actions/image.ts` → red at "host-only global". `crypto` is allowed only behind the `typeof` guard in `src/shared/mint-id.ts`, which is outside the scanned set. The `nanoid` imports in the moved models are fine at load; handlers always pass `ctx.newId`, so nanoid's `crypto` call never runs in Jint.

- [ ] **Step 4: Commit**

```bash
npx eslint test/unit/architecture/tool-description-law.test.ts
git add test/unit/architecture/tool-description-law.test.ts
git commit -m "test(architecture): tool-description law

Mutation check: (a) registry entry removed, (b) format keyword, (c) id in args,
(d) handler renamed, (e) async run, (f) components import: each turned the law red.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

Add any renamed test files to the `git add` line.

### Task 56: Final gate and hand-off

- [ ] **Step 1: Related tests, one file per run.** Every test file created or modified by this plan, plus: `test/unit/view/document-schema.test.ts`, `test/unit/view/index.purity.test.ts`, `test/unit/architecture/view-entry-law.test.ts`, `test/unit/architecture/published-types-no-src-refs.test.ts`, `test/unit/architecture/table-cell-content-law.test.ts`, `test/unit/architecture/paste-stamp-law.test.ts`, `test/unit/scripts/build-server-runtime.test.ts`, `test/unit/shared/sanitize-schema.test.ts`, and the moved modules' suites (table, database, image, embed). Write each run's output to a file and read its exit code from the unpiped command (memory `blok-agent-gate-traps` #6). Run nothing else in parallel (#7).
- [ ] **Step 2: Types.** `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` (timeout 600000) and `yarn lint:angular`. Both PASS.
- [ ] **Step 3: Lint.** `npx eslint` over every changed file (`git diff --name-only origin/main...HEAD -- '*.ts' '*.tsx'`, passed through `xargs`, because zsh does not word-split, memory #7). Full `yarn lint` ESLint does not run locally (memory #1); say so in the hand-off and let CI run it.
- [ ] **Step 4: Full suite.** CLAUDE.md makes full `yarn test` the final gate; the user's memory rule says never run it locally (>10 min). Ask the user which applies before running it; if not run locally, say CI runs it.
- [ ] **Step 5: Land.** `git pull --rebase`, `git push`, `git status` shows "up to date with origin". No stash left (`git stash list` empty).
- [ ] **Step 6: Hand-off message to the user.**
  - New public surface for the release note (06 D4): `describe` and `actionHandlers` statics; `buildToolManifest` and `validateAgainst` from `@bloklabs/core` and `@bloklabs/core/view`; `types/tools/tool-description.d.ts`, `types/tool-manifest.d.ts` (incl. `BlokCustomToolsFile`); `blokDocumentSchema.page`; Jint `manifest` operation; menu items now carry `data-blok-item-name`; framework blocks get a derived `describe` whose closed schema rejects agent writes with unknown keys.
  - Nothing labelled BREAKING: none of these surfaces shipped in `v1.16.1`.
  - Open items: every **unverified** line in this plan that a task did not settle. (Settled by the cross-plan pass: the image markup drift is Task 24a; `undefined` removes a key and `ctx.tool` are 01 Task 14; table creation routing is 01 Task 8 Step 7.)

---

## Self-review notes (for the executor)

- Spec coverage: S1 → Tasks 16-25, 55; S2 → Tasks 1, 16, 24; S3 → Tasks 31-49, 51, 54; S4 → Tasks 5, 26, 29, 52; S5 → Tasks 27, 50, 51; S6 → Tasks 1, 23. §3.3 sanitize move → Tasks 8-11; §3.5 `ToolRuntime` → Tasks 12, 13, 15; §3.6/3.6a → Tasks 5, 6; §3.7 → Tasks 5, 29, 52; §3.8 → Tasks 31-49; §6 items 1-14 → Tasks 1, 24, 17, 55, 2, (05's corpus + fixtures), 5/26, 5, 6, 13/15, 51, 50, 28, 52.
- Spec items NOT built here, by design: action parity across appliers (spec §6 item 6) needs 01's appliers and 05's corpus; the action tasks leave fixtures for it. E2E per container family is 03's (spec §6 last paragraph).
- Deviations from the spec, all recorded where they happen: `pattern` added to the profile (Global Constraints); `SnapshotBlock.handlers`, `SnapshotBlockStatics.convertible`, optional `InlineToolManifestEntry.effect` (Task 3); `buildToolManifest` third `options` argument (Task 5); `buildAgentContract` fourth `general` argument (Task 6); `normalizeTable`'s optional minter (Task 15); `PageBackendService` takes the block id (Task 44); no `table.defaultChildren` (Cross-plan); `database.addView` offers `board` and `list` only, as the UI does (Task 41).
