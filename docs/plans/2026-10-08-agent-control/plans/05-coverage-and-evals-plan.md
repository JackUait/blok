# Agent Coverage Law, Parity Corpus and Evals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "agents have full control of Blok" something CI can fail on: a coverage law over every human-reachable capability, one parity corpus run through all five appliers, a renderer drift test, deterministic graders checked on every commit, and a manual-dispatch eval runner that calls a real model.

**Architecture:** Everything here is test code, test data, one runner script and one workflow. The coverage law is a TypeScript-AST scan of `src/` plus a hand-written ledger, in the style of the existing `test/unit/architecture/*-law.test.ts` files. The parity corpus is JSON under `test/fixtures/agent-commands/`. Node, browser and C# runners all read it and compare against one golden per case. Graders are pure functions over saved documents. The eval runner reuses the graders and only adds the model loop.

**Tech Stack:** Vitest 4.1.11 (`unit` project, jsdom; `// @vitest-environment node` where noted), TypeScript 6.0.3 compiler API, Playwright 1.63.0, xunit 2.9.3 on .NET 10, `yaml` 2.x, one new root devDependency approved under D3: `@anthropic-ai/sdk` 0.132.0 (read from `npm view` on 2026-10-08). The MCP client is `@modelcontextprotocol/client` 2.3.1, which plan 04 Task 1 adds as the one root MCP-client devDependency (D3, R3-10); it matches 04's `@modelcontextprotocol/server` 2.3.1. Its `./stdio` export has `StdioClientTransport({ command, args?, env?, cwd? })`, and `Client` has `connect`, `listTools`, `callTool` (read from the packed 2.3.1 `.d.mts` on 2026-10-08).

**Spec:** `docs/plans/2026-10-08-agent-control/05-coverage-and-evals.md`. Binding contract: `docs/plans/2026-10-08-agent-control/06-reconciliation.md` §3 and §12. Read both before any task.

## Global Constraints

- Every per-commit CI job stays under 7 minutes (user goal, memory `ci-job-time-budget-7min`). The eval job is manual only and is the one exception (D3).
- Real-model evals run on `workflow_dispatch` only. No `schedule` trigger. Token caps per run and per dispatch stay (D3).
- Approved under D3/R3-10: root `devDependencies` `@anthropic-ai/sdk` (this plan) and `@modelcontextprotocol/client` (plan 04 Task 1 adds it; this plan does not add a second MCP client), and one repository secret `ANTHROPIC_API_KEY` read only by `.github/workflows/agent-evals.yml`. No other `package.json` edit is approved. No `yarn eval` script.
- Do NOT modify `vite.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `.env` (CLAUDE.md, Configuration). New config files under `test/evals/` are allowed.
- Command names are 06 §3.1 exactly: `doc.read`, `doc.find`, `doc.setTitle`, `doc.setIcon`, `block.insert`, `block.update`, `block.delete`, `block.move`, `block.convert`, `block.duplicate`, `text.insert`, `text.delete`, `text.replace`, `text.format`, `markdown.insert`, `markdown.export`, `history.undo`, `history.redo`, and tool actions `<registryKey>.<action>` from 02 §3.8 (`table.insertRows`, `column_list.create`, …).
- `{ command: 'block.update' }` is never a valid ledger entry (06 C4). A one-field effect is `{ field: '<registryKey>.<field>' }`.
- Availability errors are exactly `UNKNOWN_COMMAND` (not in the contract) and `COMMAND_UNAVAILABLE` (in it with `available: false`) (06 R3-1).
- Parity cases never pin a concrete `expectRevision` value (06 R3-5).
- `history.undo` / `history.redo` sit alone in their batch in every case and eval reference (01 deviation D-3: a mixed batch is `INVALID_ARGS`).
- All graders are code. No LLM judge.
- Source-text scans skip under Stryker with `it.skipIf(isInstrumented())` (`test/unit/helpers/instrumented.ts`).
- Unit tests: `vi.clearAllMocks()` in `beforeEach`, `vi.restoreAllMocks()` in `afterEach`. No `any`, no `@ts-ignore`, no `!`.
- E2E: no CSS class selectors; semantic locators or `data-blok-testid`.
- Comments: short, and only for what silently breaks if changed (global CLAUDE.md).
- Commits go straight to `main`. Never `git commit -a`. Stage explicit paths, then run `git diff --cached --name-only` and check it lists only this task's paths before committing (memory `concurrent-commit-race-shared-index`). Every commit message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- A step that says "append" and shows `import` lines means: merge those imports into the file's top import block.
- Run one test file per `yarn test <file>` call. A multi-path vitest run skips files (memory `blok-agent-gate-traps`).
- Lint only changed files while iterating: `node_modules/.bin/eslint <paths>`. Full `yarn lint` and the related tests are the gate at each phase checkpoint.

## Review Focus

1. **A capability whose name is computed, not written.** Template names (`` `image-alignment-${a.value}` ``), conditional names and identifier names must still produce a stable id. Owner: Task 1 (`staticNames` fixture test with a template, a conditional, and an identifier) and Task 2 (the file-scoped wildcard id for a non-static name).
2. **New popover `name` values that collide with names already in the same popover.** Popovers hide and find items by `name` (`src/components/utils/popover/popover-abstract.ts:469-541`); a tool settings menu renders inside block settings, whose built-ins are `delete`, `duplicate`, `convert-to`. A tool item named `delete` would be hidden or found by the wrong code. Owner: Task 2 (assertion that no tool menu name equals any `tune:` name, and no static name repeats inside one tool directory).
3. **Two runners that are both wrong in the same way.** Every runner compares to the `json` golden, and the first golden comes from the code under test. Owner: Task 7 (`run-case.test.ts`: a generated golden starts `reviewed: false`, comparing against it fails, and a reviewed golden is never regenerated; a person must read each one).
4. **Random ids leaking into a comparison.** Table cells and ref-only inserts get random ids. If one is not relabelled, parity flakes; if a seed id is relabelled, a real move bug hides. Owner: Task 6 (normalizer test: seed ids kept, ref ids relabelled, the same id renamed inside `content`, `parent` and table cell `blocks`).
5. **A model run that loops or spends without bound.** A model that keeps calling `blok_execute` must stop at `budget.maxTurns`, and a whole dispatch must stop at its total token cap, recorded as `error`, not `fail`. Owner: Task 21 (fake-client test where every reply is a tool call).

## Cross-plan dependencies

Names are the canonical names from 06 §3. "Gated" means the task cannot start until the named piece is on `main`.

**What this plan needs from plans 01–04:**

| From | Piece (canonical name) | Needed by |
|---|---|---|
| 01 | `createDocumentAgentSession` (`JsonApplier`, with `output()`; 01 Task 17), `COMMANDS` from `src/shared/agent/commands.ts` (01 Task 3), `AgentSession.log()`, and `createHeadlessAgentSetup({ runtime?, customTools?, services? })` → `{ contract, tools, ports, richTextFieldsFor }` plus `loadStoredDocument(doc, richTextFieldsFor)` from `src/view/agent-runtime.ts` (01 Tasks 19, 21) | Tasks 7, 9, 14, 20, 22 |
| 01 | `createStoreAgentSession({ store, tools, contract, actor, ports, richTextFieldsFor })` from `src/components/modules/agent/store-session.ts` (01 Task 35). Q14 answered by 01 deviation D-5: `DocumentStore.toJSON()` maps one-to-one onto `OutputBlockData`, `lastEditedBy` included (`serializer.ts:502-549`); only rich fields need HTML → segments, and the page fields come from `readPageFields(store.page)` as flat `title` / `icon` | Task 8 |
| 01, 02 | Agent code in the Jint bundle: `agentExecute` (01 Task 37), `manifest` (02 Task 50) | Task 10 |
| 01 (C# server) | `IBlokAgentExecutor.ExecuteAsync` (namespace `Blok.Server.Agent`, 01 Task 38). Tests build it as `new BlokAgentExecutor(JintBlokRuntime.FromEmbeddedResource(1, null, null), rooms, converter)` (internal constructor, 01 Task 45; `rooms`/`converter` may be `null` for stored execution). `Blok.Server.Tests` sees internals (`Blok.Server/Properties/AssemblyInfo.cs:5`) | Task 12 |
| 01 (C# server) | `IBlokAgentExecutor.ExecuteInRoomAsync` (01 Task 45; room set-up as in 01's `CollabRoomManager` construction there); the `Move`-while-typing concurrency test is 01 Task 46, not duplicated here | Task 13 |
| 01 | Headless ports: no constant export. `createHeadlessAgentSetup(...).ports` (01 Task 21), or `createHeadlessPorts({ sanitizeFor, richTextFieldsFor, ... })` (01 Task 19). Adapted in one seam file, Task 7 | Tasks 7, 8 |
| 02 | `buildToolManifest`, `buildAgentContract`, `BUILT_IN_BLOCK_DESCRIPTIONS`, `BUILT_IN_TOOL_RUNTIMES`; the Node snapshot builder is `buildBuiltInSnapshot({ blokVersion, readOnly?, services? })` (`src/shared/built-in-snapshot.ts`, 02 Task 27) and custom tools go through `snapshotWithCustomTools(base, file?)` (`src/shared/custom-tools-file.ts`, 02 Task 29), both composed by 01's `createHeadlessAgentSetup`; `validateAgainst(schema, value): SchemaProblem[]` (empty = valid; `SchemaProblem = { path, message }`, 02 Task 2) | Tasks 7, 14, 15 |
| 02 | Named menu items (02 Task 53 adds the 24 `name:` lines) | Task 2 (its assertion goes green on them) |
| 02 | `ToolActionDeclaration.mirrors` filled (02 Task 54, after 02 Task 53 and this plan's Task 2) | Task 15 |
| 02 | Manifest entry fields `data`, `viewState`, `guardedFields`, `actions[].mirrors` | Task 15 |
| 03 | `renderAgentTools` in `src/agent/render-tools.ts` | Tasks 14, 22 |
| 03 | `editor.agent.begin({ agent })`, `AgentTurn.call`, `editor.agent.tools({ format, schema })` (03 Tasks 1, 7, 9), editor `save()` carrying flat `title` / `icon` (01 D-1; the saver already writes them, `8d86c376`), the peer agent marker: a block-level marker carries `data-blok-agent-marker` and its flag `data-blok-agent-marker-label="<name>"` (03 Task 15); a caret-level peer agent is drawn by the caret layer (03 Task 24) | Tasks 11, 23, 24 |
| 04 | `@bloklabs/mcp` bin `blok-mcp` with `--source files:<dir>`, `--schema`, `--sync-url`, `--origin` (04 Task 4 `parseMcpArgs`), stdio transport, root `build:mcp` script (04 Task 1). `blok_open` input is `{ documentId: string; mode?: 'auto' \| 'live' \| 'stored'; write?: boolean (default false); view? }` and its result carries `handle` (04 Task 6). There is no identity flag: over stdio the principal is `local` (04 Task 4 `DEFAULTS`) and the actor id is `agent:local:<MCP client name>` (04 Task 9 `defaultAgentActor`, `safeClientName`) | Tasks 22, 24, 26 |

**Ownership of shared files (one owner each):**

- This plan owns `test/fixtures/agent-commands/**` (cases, goldens, eval fixtures), the loader `test/unit/agent/parity/corpus.ts`, the normalizer `test/unit/agent/parity/normalize.ts`, the Node runner files `test/unit/agent/parity/json-runner.test.ts` and `store-runner.test.ts`, the Playwright spec `test/playwright/tests/agent/command-parity.spec.ts`, and the C# corpus tests.
- 01's `test/unit/agent/applier-parity.editor.test.ts` (01 Task 32) **imports** `loadParityCases`, `runCorpusCase`, `normalizeForParity`, `callerChosenIds`, `compareToGolden` from this plan and adds only the jsdom `EditorApplier` runner. 01 Task 21 adds 01's cases as `test/fixtures/agent-commands/cases/01-*.json`. 01 writes no corpus, normalizer, golden or other runner (01 Tasks 36, 39 and 46's room parity were moved here).
- 02's action parity tests (02 §6 item 6) add their fixture batches as corpus cases under `test/fixtures/agent-commands/cases/` and do not add runners.

**Which tasks here gate other plans:**

- **Task 2 gates 02's `mirrors` work.** 02 must not fill `mirrors` (02 Task 54) before every tool menu item has a `name` (02 Task 53) and this plan's "menu items have names" assertion is green (06 R2-05-4).
- **Task 16 gates "01 and 02 are done".** It asserts zero `pending` ledger rows and that every contract command appears in at least one parity case. 01 and 02 are not complete until Task 16 is green.
- **Task 27 gates 03 and 04 shipping a default `RenderOptions.schema`.** The first envelope-vs-full run picks it (06 C2).
- **Task 5's ledger is the day-one action list for 02** (05 §3.1.3): every row with `pending: 'plan-02'` names an action 02 must declare.

---

## File Structure

```
test/unit/architecture/
  agent-coverage/
    scan.ts                       walk + parse + AST helpers shared by every enumerator
    registry.ts                   registry key → block tool class (drift-tested)
    enumerators.ts                one function per capability source; pure source variants for fixtures
  agent-coverage.ledger.ts        Coverage types + LEDGER (the audit)
  agent-coverage-enumerators.test.ts   planted-capability fixture tests ("mutation checks")
  agent-coverage-law.test.ts      the law: uncovered, dangling, field rows, stale, exemption quality, names, floors
test/fixtures/agent-commands/
  cases/<name>.json               ParityCase
  evals/<task-id>.json            seed + reference + knownBad per eval task (reference = parity case)
  goldens/<name>.json             normalized json-runner output per case
  normalizer-cases.json           input/expected pairs shared by the TS and C# normalizers
test/unit/agent/
  parity/corpus.ts                ParityCase types, loader, expectation lookup, golden paths
  parity/normalize.ts             normalizeForParity + stableStringify
  parity/normalize.test.ts
  parity/run-case.ts              runCorpusCase over any session-like object
  parity/json-runner.test.ts      // @vitest-environment node
  parity/store-runner.test.ts     // @vitest-environment node
  harness.ts                      THE ONLY file importing plan 01–04 modules; adapt names here
  render-tools-parity.test.ts
  eval-graders.test.ts            reference passes, every knownBad fails, per task
test/unit/scripts/
  build-server-runtime.test.ts    (modify) + bundle size case
  server-runtime-size-budget.json
test/playwright/tests/agent/command-parity.spec.ts
packages/server/dotnet/Blok.Server.Tests/Agent/
  AgentParityCorpus.cs            locate + read the shared corpus (walk-up, like RichTextFixtures.cs)
  AgentParityNormalizer.cs        C# twin of normalizeForParity, pinned by normalizer-cases.json
  AgentParityNormalizerTests.cs
  JintAgentParityTests.cs
  RoomAgentParityTests.cs
test/evals/agent/
  types.ts                        EvalTask, Grader, GraderInput, EvalResults
  graders/structure.ts            schemaValid, shape, text, marks, untouched
  graders/behaviour.ts            noMarkdownResidue, logClean, usedAction, answerIds, pageFields
  graders/collab.ts               humanPreserved, agentVisible, attributed, ackedOnly
  tasks/<id>.ts                   one EvalTask per file (imports its JSON fixture)
  tasks/index.ts                  ALL_TASKS
  runner/model-loop.ts            manual tool loop, caps, outcome classification
  runner/surfaces/in-app.ts       Node document session behind renderAgentTools
  runner/surfaces/mcp.ts          stdio blok-mcp client (stored and live)
  runner/surfaces/browser.spec.ts Playwright, in-app-browser tasks
  runner/live-room.ts             startServer + scripted human page
  runner/report.ts                results.json, baseline compare, job summary
  runner/run.mjs                  CLI entry: spawns vitest/playwright, merges, compares
  vitest.evals.config.ts          node project for the Node surfaces (outside the unit glob)
  playwright.evals.config.ts      browser surface config
  baseline.json
test/unit/evals/                  per-commit tests of runner logic with a fake model client
.github/workflows/agent-evals.yml
test/unit/architecture/agent-evals-workflow-law.test.ts
```

`test/evals/**` is outside the unit include glob (`vitest.config.ts:61` is `test/unit/**/*.test.ts`) and outside Playwright's `testDir` (`playwright.config.ts:213`), so nothing there runs in normal CI. `tsconfig.json:39-45` includes `**/*.ts`, so `tsc` still type-checks it; `eslint.config.mjs:1103` applies to `**/*.ts`.

**Order across plans (06 §14 "Execution order").** Tasks 1–6 run in wave 0. Task 2's "items have names" assertion is green only after 02 Task 53 (until then `it.fails`). Every later task names its gate; 06 §14 lists the waves.

---

# Phase 1 — Coverage law against today's code (no dependency on 01–04)

### Task 1: Scan helpers and the `insert`, `format`, `tune` enumerators

**Files:**
- Create: `test/unit/architecture/agent-coverage/scan.ts`
- Create: `test/unit/architecture/agent-coverage/registry.ts`
- Create: `test/unit/architecture/agent-coverage/enumerators.ts`
- Test: `test/unit/architecture/agent-coverage-enumerators.test.ts`

**Interfaces:**
- Consumes: `defaultBlockTools`, `defaultInlineTools` and the tool classes from `src/tools/index.ts:22-121`.
- Produces:
  - `scan.ts`: `REPO_ROOT: string`, `SRC_ROOT: string`, `interface Capability { id: string; file: string; line: number }`, `walkTs(dir: string): string[]`, `toRepoPath(file: string): string`, `parseSource(text: string, fileName?: string): ts.SourceFile`, `parseFile(file: string): ts.SourceFile`, `visit(node, fn)`, `lineOf(source, node): number`, `propertyNamed(literal, key): ts.ObjectLiteralElementLike | undefined`, `staticNames(expr: ts.Expression): string[] | null`.
  - `registry.ts`: `BLOCK_TOOL_CLASSES: Record<string, unknown>`.
  - `enumerators.ts`: `insertIds(registry: Record<string, unknown>): Capability[]`, `formatIds(): Capability[]`, `tuneIdsFromToolsModule(source, repoPath): Capability[]`, `tuneIdsFromBlockSettings(source, repoPath): Capability[]`, `enumerateTunes(): Capability[]`.

- [ ] **Step 1: Write the failing fixture tests**

```ts
// test/unit/architecture/agent-coverage-enumerators.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultBlockTools } from '../../../src/tools';
import { BLOCK_TOOL_CLASSES } from './agent-coverage/registry';
import {
  formatIds,
  insertIds,
  tuneIdsFromBlockSettings,
  tuneIdsFromToolsModule,
} from './agent-coverage/enumerators';
import { parseSource, staticNames } from './agent-coverage/scan';
import ts from 'typescript';

const ids = (list: Array<{ id: string }>): string[] => list.map((c) => c.id).sort();

const firstExpression = (code: string): ts.Expression => {
  const statement = parseSource(code).statements[0];

  if (statement === undefined || !ts.isExpressionStatement(statement)) {
    throw new Error('fixture must be one expression statement');
  }

  return statement.expression;
};

describe('agent coverage enumerators', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('staticNames reads literals, templates and two-branch conditionals', () => {
    expect(staticNames(firstExpression(`'image-caption';`))).toEqual(['image-caption']);
    expect(staticNames(firstExpression('`image-alignment-${a.value}`;'))).toEqual(['image-alignment-*']);
    expect(staticNames(firstExpression(`type === 'row' ? 'table-duplicate-row' : 'table-duplicate-column';`)))
      .toEqual(['table-duplicate-row', 'table-duplicate-column']);
    expect(staticNames(firstExpression('id;'))).toBeNull();
  });

  it('insert: one id per toolbox entry (mutation check)', () => {
    const registry = {
      solo: { toolbox: { title: 'Solo' } },
      named: { toolbox: { title: 'Named', name: 'named' } },
      multi: { toolbox: [{ title: 'A', name: 'a' }, { title: 'B', name: 'b' }] },
      hidden: { toolbox: undefined },
    };

    expect(ids(insertIds(registry))).toEqual(['insert:multi/a', 'insert:multi/b', 'insert:named', 'insert:solo']);
  });

  it('insert: the registry covers every default block tool plus page', () => {
    expect(Object.keys(BLOCK_TOOL_CLASSES).sort()).toEqual([...Object.keys(defaultBlockTools), 'page'].sort());
  });

  it('format: one id per default inline tool', () => {
    expect(ids(formatIds())).toContain('format:bold');
    expect(formatIds()).toHaveLength(10);
  });

  it('tune: reads internal tunes from the tools module (mutation check)', () => {
    const source = parseSource(`
      class Tools {
        private get internalTools() {
          return {
            stub: { class: toToolConstructable(Stub), isInternal: true },
            delete: { class: toToolConstructable(DeleteTune), isInternal: true },
            copyLink: { class: toToolConstructable(CopyLinkTune), isInternal: true },
            convertTo: { class: toToolConstructable(ConvertInlineTool), isInternal: true },
          };
        }
      }
    `);

    expect(ids(tuneIdsFromToolsModule(source, 'src/components/modules/tools.ts'))).toEqual(['tune:copyLink', 'tune:delete']);
  });

  it('tune: reads named block settings items (mutation check)', () => {
    const source = parseSource(`
      const items = [{ name: 'duplicate', onActivate: () => {} }, { title: 'no name', onActivate: () => {} }];
    `);

    expect(ids(tuneIdsFromBlockSettings(source, 'src/components/modules/toolbar/blockSettings.ts'))).toEqual(['tune:duplicate']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn test test/unit/architecture/agent-coverage-enumerators.test.ts`
Expected: FAIL, "Failed to resolve import './agent-coverage/registry'".

- [ ] **Step 3: Write `scan.ts`**

```ts
// test/unit/architecture/agent-coverage/scan.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import ts from 'typescript';

export const REPO_ROOT = join(__dirname, '../../../..');
export const SRC_ROOT = join(REPO_ROOT, 'src');

export interface Capability {
  id: string;
  file: string;
  line: number;
}

// Demo and story code. A user of the published editor never reaches it.
const SKIPPED_DIRS = new Set(['playground', 'stories']);

export const walkTs = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      if (!SKIPPED_DIRS.has(entry)) {
        walkTs(full, out);
      }
    } else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) {
      out.push(full);
    }
  }

  return out;
};

export const toRepoPath = (file: string): string => relative(REPO_ROOT, file).split(sep).join('/');

export const parseSource = (text: string, fileName = 'fixture.ts'): ts.SourceFile =>
  ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);

export const parseFile = (file: string): ts.SourceFile => parseSource(readFileSync(file, 'utf8'), file);

export const visit = (node: ts.Node, fn: (node: ts.Node) => void): void => {
  fn(node);
  ts.forEachChild(node, (child) => visit(child, fn));
};

export const lineOf = (source: ts.SourceFile, node: ts.Node): number =>
  source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

export const propertyNamed = (
  literal: ts.ObjectLiteralExpression,
  key: string
): ts.ObjectLiteralElementLike | undefined =>
  literal.properties.find(
    (property) => !ts.isSpreadAssignment(property) && property.name !== undefined && ts.isIdentifier(property.name) && property.name.text === key
  );

/** Names an expression can statically take. A template keeps its head and ends in `*`. */
export const staticNames = (expr: ts.Expression): string[] | null => {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return [expr.text];
  }

  if (ts.isTemplateExpression(expr)) {
    return [`${expr.head.text}*`];
  }

  if (ts.isParenthesizedExpression(expr)) {
    return staticNames(expr.expression);
  }

  if (ts.isConditionalExpression(expr)) {
    const whenTrue = staticNames(expr.whenTrue);
    const whenFalse = staticNames(expr.whenFalse);

    return whenTrue !== null && whenFalse !== null ? [...whenTrue, ...whenFalse] : null;
  }

  return null;
};
```

- [ ] **Step 4: Write `registry.ts`**

```ts
// test/unit/architecture/agent-coverage/registry.ts
import {
  Audio,
  Bookmark,
  Callout,
  Code,
  Column,
  ColumnList,
  Database,
  DatabaseRow,
  Divider,
  Embed,
  File as FileTool,
  Header,
  Image as ImageTool,
  List,
  Page,
  Paragraph,
  Quote,
  Spacer,
  Table,
  TableOfContents,
  TabTool,
  TabsTool,
  Toggle,
  Video,
} from '../../../../src/tools';

/** Registry key → class. `page` ships but is not a default (markdown-serialization-law.test.ts:63). */
export const BLOCK_TOOL_CLASSES: Record<string, unknown> = {
  paragraph: Paragraph,
  header: Header,
  list: List,
  table: Table,
  toggle: Toggle,
  callout: Callout,
  database: Database,
  'database-row': DatabaseRow,
  divider: Divider,
  spacer: Spacer,
  table_of_contents: TableOfContents,
  quote: Quote,
  code: Code,
  image: ImageTool,
  file: FileTool,
  audio: Audio,
  video: Video,
  column_list: ColumnList,
  column: Column,
  tabs: TabsTool,
  tab: TabTool,
  embed: Embed,
  bookmark: Bookmark,
  page: Page,
};
```

- [ ] **Step 5: Write the three enumerators in `enumerators.ts`**

```ts
// test/unit/architecture/agent-coverage/enumerators.ts
import { join } from 'node:path';

import ts from 'typescript';

import { defaultInlineTools } from '../../../../src/tools';
import { BLOCK_TOOL_CLASSES } from './registry';
import { SRC_ROOT, lineOf, parseFile, propertyNamed, toRepoPath, visit } from './scan';
import type { Capability } from './scan';

type ToolboxEntry = { name?: string };

const toolboxOf = (tool: unknown): ToolboxEntry[] => {
  const toolbox = (tool as { toolbox?: ToolboxEntry | ToolboxEntry[] | false }).toolbox;

  if (toolbox === undefined || toolbox === false) {
    return [];
  }

  return Array.isArray(toolbox) ? toolbox : [toolbox];
};

export const insertIds = (registry: Record<string, unknown>): Capability[] =>
  Object.entries(registry).flatMap(([key, tool]) => {
    const entries = toolboxOf(tool);

    return entries.map((entry) => {
      const single = entries.length === 1 && (entry.name === undefined || entry.name === key);

      return { id: single ? `insert:${key}` : `insert:${key}/${entry.name ?? key}`, file: 'src/tools/index.ts', line: 0 };
    });
  });

export const formatIds = (): Capability[] =>
  Object.keys(defaultInlineTools).map((key) => ({ id: `format:${key}`, file: 'src/tools/index.ts', line: 0 }));

/** Keys of `internalTools` whose class name ends in `Tune` (tools.ts:323-341). */
export const tuneIdsFromToolsModule = (source: ts.SourceFile, repoPath: string): Capability[] => {
  const out: Capability[] = [];

  visit(source, (node) => {
    if (!ts.isGetAccessorDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== 'internalTools') {
      return;
    }

    visit(node, (inner) => {
      if (!ts.isPropertyAssignment(inner) || !ts.isObjectLiteralExpression(inner.initializer)) {
        return;
      }

      const classProperty = propertyNamed(inner.initializer, 'class');

      if (classProperty === undefined || !ts.isPropertyAssignment(classProperty)) {
        return;
      }

      const text = classProperty.initializer.getText(source);

      if (/Tune\)?$/.test(text) && (ts.isIdentifier(inner.name) || ts.isStringLiteral(inner.name))) {
        out.push({ id: `tune:${inner.name.text}`, file: repoPath, line: lineOf(source, inner) });
      }
    });
  });

  return out;
};

/** Every object literal in blockSettings.ts with a string `name`. */
export const tuneIdsFromBlockSettings = (source: ts.SourceFile, repoPath: string): Capability[] => {
  const out: Capability[] = [];

  visit(source, (node) => {
    if (!ts.isObjectLiteralExpression(node)) {
      return;
    }

    const name = propertyNamed(node, 'name');

    if (name !== undefined && ts.isPropertyAssignment(name) && ts.isStringLiteral(name.initializer)) {
      out.push({ id: `tune:${name.initializer.text}`, file: repoPath, line: lineOf(source, node) });
    }
  });

  return out;
};

export const enumerateTunes = (): Capability[] => {
  const tools = join(SRC_ROOT, 'components/modules/tools.ts');
  const settings = join(SRC_ROOT, 'components/modules/toolbar/blockSettings.ts');

  return [
    ...tuneIdsFromToolsModule(parseFile(tools), toRepoPath(tools)),
    ...tuneIdsFromBlockSettings(parseFile(settings), toRepoPath(settings)),
  ];
};

export const enumerateInsert = (): Capability[] => insertIds(BLOCK_TOOL_CLASSES);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `yarn test test/unit/architecture/agent-coverage-enumerators.test.ts`
Expected: PASS, 6 tests. If `insert: the registry covers…` fails, a tool was added or renamed in `defaultBlockTools`: fix `BLOCK_TOOL_CLASSES`, never the assertion.

- [ ] **Step 7: Lint the new files**

Run: `node_modules/.bin/eslint test/unit/architecture/agent-coverage/scan.ts test/unit/architecture/agent-coverage/registry.ts test/unit/architecture/agent-coverage/enumerators.ts test/unit/architecture/agent-coverage-enumerators.test.ts`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add test/unit/architecture/agent-coverage/scan.ts test/unit/architecture/agent-coverage/registry.ts test/unit/architecture/agent-coverage/enumerators.ts test/unit/architecture/agent-coverage-enumerators.test.ts
git diff --cached --name-only
git commit -m "test(agent-coverage): scan helpers and insert/format/tune enumerators

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The `menu` enumerator and the "menu items have names" assertion (02 Task 53 adds the names)

This lands before any `mirrors` work (06 R2-05-4). A one-off AST scan on 2026-10-08 found 90 `onActivate` literals in `src/` (excluding playground and stories), 65 named. 24 of the 25 unnamed ones are under `src/tools/`. The 25th, `src/components/modules/toolbar/inline/index.ts:637`, spreads `button`, which keeps the item's `name` (`:623-636`), so the scanner treats a spread as "name inherited" and does not flag it.

**Ownership (cross-plan pass).** 02 Task 53 owns the 24 `name:` lines and their exact values; this task adds none. Re-measured at `30c77599` over all of `src/`: 90 literals, 24 unnamed (all under `src/tools/`), 1 named-by-spread. Both plans mean the same 24 items. Order: this task's enumerator and law land first with the assertion red-by-design held as `it.fails` (or land right after 02 Task 53); the assertion must be green before 02 Task 54 fills `mirrors`.

**Files:**
- Modify: `test/unit/architecture/agent-coverage/enumerators.ts` (append)
- Modify: `test/unit/architecture/agent-coverage-enumerators.test.ts` (append)
- Create: `test/unit/architecture/agent-coverage-law.test.ts`
- No `src/` change: the names are 02 Task 53's.

**Interfaces:**
- Consumes: `scan.ts` helpers and `enumerateTunes()` from Task 1.
- Produces: `toolOf(repoPath: string): string`, `interface MenuScan { capabilities: Capability[]; unnamed: string[] }`, `scanMenus(source: ts.SourceFile, repoPath: string): MenuScan`, `scanToolMenus(): MenuScan`. The law file with its first two `it` blocks, exported constant `UNNAMED_MENU_ITEMS: Record<string, string>` inside it.

- [ ] **Step 1: Append the failing fixture test**

```ts
// append to test/unit/architecture/agent-coverage-enumerators.test.ts
import { scanMenus, toolOf } from './agent-coverage/enumerators';

describe('menu enumerator', () => {
  it('maps a file to its tool directory', () => {
    expect(toolOf('src/tools/table/table-row-col-popover.ts')).toBe('table');
    expect(toolOf('src/tools/link/bookmark/index.ts')).toBe('bookmark');
    expect(toolOf('src/tools/column-drop.ts')).toBe('column-drop');
  });

  it('finds named, templated, conditional, unnamed and spread items (mutation check)', () => {
    const source = parseSource(`
      const a = { name: 'image-caption', onActivate: () => {} };
      const b = { name: \`image-alignment-\${x}\`, onActivate: () => {} };
      const c = { name: type === 'row' ? 'table-clear-row' : 'table-clear-column', onActivate: () => {} };
      const d = { title: 'unnamed', onActivate: () => {} };
      const e = { ...button, onActivate: () => {} };
      const f = { name: 'not-a-menu-item' };
    `);
    const scan = scanMenus(source, 'src/tools/image/index.ts');

    expect(ids(scan.capabilities)).toEqual([
      'menu:image/image-alignment-*',
      'menu:image/image-caption',
      'menu:image/table-clear-column',
      'menu:image/table-clear-row',
    ]);
    expect(scan.unnamed).toEqual(['src/tools/image/index.ts:5']);
  });

  it('gives a non-static name a file-scoped wildcard id', () => {
    const scan = scanMenus(parseSource(`const a = { name: id, onActivate: () => {} };`), 'src/tools/code/language-picker.ts');

    expect(ids(scan.capabilities)).toEqual(['menu:code/*@src/tools/code/language-picker.ts']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn test test/unit/architecture/agent-coverage-enumerators.test.ts`
Expected: FAIL, "scanMenus is not a function" (or a missing-export error).

- [ ] **Step 3: Append the menu enumerator**

```ts
// append to test/unit/architecture/agent-coverage/enumerators.ts
import { walkTs } from './scan';

export const toolOf = (repoPath: string): string => {
  const parts = repoPath.replace(/^src\/tools\//, '').split('/');

  if (parts[0] === 'link' && parts.length > 2) {
    return parts[1];
  }

  return parts[0].replace(/\.ts$/, '');
};

export interface MenuScan {
  capabilities: Capability[];
  unnamed: string[];
}

export const scanMenus = (source: ts.SourceFile, repoPath: string): MenuScan => {
  const tool = toolOf(repoPath);
  const capabilities: Capability[] = [];
  const unnamed: string[] = [];

  visit(source, (node) => {
    if (!ts.isObjectLiteralExpression(node) || propertyNamed(node, 'onActivate') === undefined) {
      return;
    }

    const line = lineOf(source, node);
    const name = propertyNamed(node, 'name');

    if (name === undefined) {
      // A spread may carry the name (toolbar/inline/index.ts:637 does).
      if (!node.properties.some(ts.isSpreadAssignment)) {
        unnamed.push(`${repoPath}:${line}`);
      }

      return;
    }

    const names = ts.isPropertyAssignment(name) ? staticNames(name.initializer) : null;

    for (const itemName of names ?? [`*@${repoPath}`]) {
      capabilities.push({ id: `menu:${tool}/${itemName}`, file: repoPath, line });
    }
  });

  return { capabilities, unnamed };
};

export const scanToolMenus = (): MenuScan => {
  const scans = walkTs(join(SRC_ROOT, 'tools')).map((file) => scanMenus(parseFile(file), toRepoPath(file)));

  return {
    capabilities: scans.flatMap((scan) => scan.capabilities),
    unnamed: scans.flatMap((scan) => scan.unnamed),
  };
};
```

Also add `staticNames` to the existing `./scan` import line in `enumerators.ts`.

- [ ] **Step 4: Run the fixture tests to verify they pass**

Run: `yarn test test/unit/architecture/agent-coverage-enumerators.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing law (assertions 6 and the collision guard)**

```ts
// test/unit/architecture/agent-coverage-law.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { enumerateTunes, scanToolMenus } from './agent-coverage/enumerators';
import { isInstrumented } from '../helpers/instrumented';

/**
 * ARCHITECTURE LAW — every human-reachable capability has an agent route.
 * Spec: docs/plans/2026-10-08-agent-control/05-coverage-and-evals.md §3.1.
 */

/**
 * `onActivate` items allowed to stay unnamed, keyed `file:line`. An unnamed item
 * has no stable capability id, so no tool action can mirror it.
 */
const UNNAMED_MENU_ITEMS: Record<string, string> = {};

describe('agent coverage law', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.skipIf(isInstrumented())('every tool menu item has a name (assertion 6)', () => {
    const unnamed = scanToolMenus().unnamed.filter((key) => UNNAMED_MENU_ITEMS[key] === undefined);

    expect(
      unnamed,
      'These popover items have onActivate but no `name`. Add a unique `name` ' +
        '(prefix it with the tool, e.g. `table-merge-cells`). It also becomes data-blok-item-name ' +
        'for e2e locators. Only if a name is impossible, add the file:line to UNNAMED_MENU_ITEMS with a reason.'
    ).toEqual([]);
  });

  it.skipIf(isInstrumented())('no tool menu name collides with a block settings item', () => {
    const settingsNames = new Set(enumerateTunes().map((c) => c.id.replace(/^tune:/, '')));
    const collisions = scanToolMenus().capabilities
      .map((c) => ({ ...c, name: c.id.slice(c.id.indexOf('/') + 1) }))
      .filter((c) => settingsNames.has(c.name))
      .map((c) => `${c.file}:${c.line} "${c.name}"`);

    // Tool settings render inside block settings, and popovers hide/find items by name.
    expect(collisions).toEqual([]);
  });

  it.skipIf(isInstrumented())('no static menu name repeats inside one tool', () => {
    const seen = new Map<string, string>();
    const repeats: string[] = [];

    for (const c of scanToolMenus().capabilities) {
      if (c.id.includes('*')) {
        continue;
      }

      const first = seen.get(c.id);
      const where = `${c.file}:${c.line}`;

      if (first !== undefined && first !== where) {
        repeats.push(`${c.id} at ${first} and ${where}`);
      }

      seen.set(c.id, first ?? where);
    }

    expect(repeats).toEqual([]);
  });
});
```

- [ ] **Step 6: Run the law**

Run: `yarn test test/unit/architecture/agent-coverage-law.test.ts`
Expected before 02 Task 53 is on `main`: FAIL in "every tool menu item has a name", listing exactly the 24 sites in 02 Task 53's table (`src/tools/code/index.ts:704`, `:716`; `src/tools/database/database-tab-bar.ts:295`, `:303`, `:316`; `src/tools/database/index.ts:1065`; `src/tools/list/block-operations.ts:217`; `src/tools/quote/index.ts:173`, `:180`; `src/tools/table/table-cell-selection.ts:1499`, `:1515`, `:1531`, `:1540`; `src/tools/table/table-row-col-popover.ts:99`, `:107`, `:158`, `:166`, `:180`, `:219`, `:227`, `:241`; `src/tools/tabs/index.ts:807`, `:813`, `:820`; lines at `30c77599`). If 02 Task 53 has not landed, mark that one `it` as `it.fails` with a comment naming 02 Task 53 and commit; flip it back to `it` in 02 Task 53's commit or right after. Do not add names here.
Expected after 02 Task 53: PASS, 3 tests. The names are 02's (for example `table-duplicate-${type}`, `tabs-rename`), so the enumerator emits `menu:table/table-duplicate-*`, `menu:table/table-clear-*` and `menu:tabs/tabs-*` ids; Task 5's ledger uses those.

- [ ] **Step 7: Lint and commit**

```bash
node_modules/.bin/eslint test/unit/architecture/agent-coverage/enumerators.ts test/unit/architecture/agent-coverage-enumerators.test.ts test/unit/architecture/agent-coverage-law.test.ts
git add test/unit/architecture/agent-coverage/enumerators.ts test/unit/architecture/agent-coverage-enumerators.test.ts test/unit/architecture/agent-coverage-law.test.ts
git diff --cached --name-only
git commit -m "test(architecture): menu enumerator; the coverage law requires named menu items

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The `action-union`, `shortcut`, `key`, `typing` and `drag` enumerators

**Files:**
- Modify: `test/unit/architecture/agent-coverage/enumerators.ts` (append)
- Modify: `test/unit/architecture/agent-coverage-enumerators.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 and 2 helpers.
- Produces: `actionUnionIds(source, repoPath): Capability[]`, `shortcutIds(source, repoPath): Capability[]`, `keyIds(source, repoPath): Capability[]`, `HAND_KEYS: Record<string, string>`, `typingHandlerIds(source, repoPath): Capability[]`, `triggerFileIds(dir: string): Capability[]`, `dragIds(source, repoPath): Capability[]`, and the real-source wrappers `enumerateActionUnions()`, `enumerateShortcuts()`, `enumerateKeys()`, `enumerateTyping()`, `enumerateDrag()`.

- [ ] **Step 1: Append the failing fixture tests**

```ts
// append to test/unit/architecture/agent-coverage-enumerators.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  actionUnionIds,
  dragIds,
  keyIds,
  shortcutIds,
  triggerFileIds,
  typingHandlerIds,
} from './agent-coverage/enumerators';

describe('action, shortcut, key, typing and drag enumerators', () => {
  it('action-union: each `type` member of an exported *Action union (mutation check)', () => {
    const source = parseSource(`
      export type RowColAction = | { type: 'insert-row-above'; index: number } | { type: 'move-row'; from: number };
      type PrivateAction = { type: 'nope' };
      export type NotAnUnion = { type: 'nope' };
    `);

    expect(ids(actionUnionIds(source, 'src/tools/table/table-row-col-controls.ts'))).toEqual([
      'action:table/insert-row-above',
      'action:table/move-row',
    ]);
  });

  it('shortcut: literal, constant and dynamic names (mutation check)', () => {
    const source = parseSource(`
      Shortcuts.add({ name: 'CMD+A', handler });
      Shortcuts.add({ name: COLLAPSE_ALL, handler });
      Shortcuts.add({ name: shortcut, handler });
      Other.add({ name: 'CMD+B' });
    `);

    expect(ids(shortcutIds(source, 'src/x/y.ts'))).toEqual([
      'shortcut:x/y.ts/<dynamic>',
      'shortcut:x/y.ts/CMD+A',
      'shortcut:x/y.ts/COLLAPSE_ALL',
    ]);
  });

  it('key: case keyCodes.X labels and the slash check (mutation check)', () => {
    const source = parseSource(`
      switch (code) { case keyCodes.ENTER: break; case keyCodes.TAB: break; case 3: break; }
      if (event.key === '/') {}
    `);

    expect(ids(keyIds(source, 'src/components/modules/blockEvents/index.ts'))).toEqual(['key:/', 'key:ENTER', 'key:TAB']);
  });

  it('typing: handle*Shortcut and handle*Markdown methods (mutation check)', () => {
    const source = parseSource(`
      class M { private handleListShortcut() {} private handleLinkMarkdown() {} private handleOther() {} }
    `);

    expect(ids(typingHandlerIds(source, 'src/m.ts'))).toEqual(['typing:handleLinkMarkdown', 'typing:handleListShortcut']);
  });

  it('drag: members of DropTarget.edge only (mutation check + near miss)', () => {
    const source = parseSource(`
      export interface DropTarget { edge: 'top' | 'bottom' | 'left'; depth: number }
      export interface OtherTarget { edge: 'inside' | 'outside' }
    `);

    expect(ids(dragIds(source, 'src/d.ts'))).toEqual(['drag:bottom', 'drag:left', 'drag:top']);
  });

  it('typing: only *Trigger.ts composer files (mutation check + near miss)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'composers-'));

    writeFileSync(join(dir, 'slashTrigger.ts'), '');
    writeFileSync(join(dir, 'keyboardNavigation.ts'), '');

    expect(ids(triggerFileIds(dir))).toEqual(['typing:slashTrigger']);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test test/unit/architecture/agent-coverage-enumerators.test.ts`
Expected: FAIL, missing exports.

- [ ] **Step 3: Append the implementations**

```ts
// append to test/unit/architecture/agent-coverage/enumerators.ts
import { readdirSync } from 'node:fs';

const isExported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

const literalTypeText = (type: ts.TypeNode | undefined): string | null =>
  type !== undefined && ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal) ? type.literal.text : null;

export const actionUnionIds = (source: ts.SourceFile, repoPath: string): Capability[] => {
  const tool = toolOf(repoPath);
  const out: Capability[] = [];

  for (const statement of source.statements) {
    if (!ts.isTypeAliasDeclaration(statement) || !statement.name.text.endsWith('Action') || !isExported(statement)) {
      continue;
    }

    if (!ts.isUnionTypeNode(statement.type)) {
      continue;
    }

    for (const member of statement.type.types) {
      if (!ts.isTypeLiteralNode(member)) {
        continue;
      }

      const typeProperty = member.members.find(
        (m): m is ts.PropertySignature => ts.isPropertySignature(m) && ts.isIdentifier(m.name) && m.name.text === 'type'
      );
      const value = literalTypeText(typeProperty?.type);

      if (value !== null) {
        out.push({ id: `action:${tool}/${value}`, file: repoPath, line: lineOf(source, member) });
      }
    }
  }

  return out;
};

const CONSTANT_NAME = /^[A-Z][A-Z0-9_]*$/;

export const shortcutIds = (source: ts.SourceFile, repoPath: string): Capability[] => {
  const out: Capability[] = [];
  const scope = repoPath.replace(/^src\//, '');

  visit(source, (node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      node.expression.name.text !== 'add' ||
      !ts.isIdentifier(node.expression.expression) ||
      node.expression.expression.text !== 'Shortcuts'
    ) {
      return;
    }

    const options = node.arguments[0];
    const name = options !== undefined && ts.isObjectLiteralExpression(options) ? propertyNamed(options, 'name') : undefined;
    let value = '<dynamic>';

    if (name !== undefined && ts.isPropertyAssignment(name)) {
      if (ts.isStringLiteral(name.initializer)) {
        value = name.initializer.text;
      } else if (ts.isIdentifier(name.initializer) && CONSTANT_NAME.test(name.initializer.text)) {
        value = name.initializer.text;
      }
    }

    out.push({ id: `shortcut:${scope}/${value}`, file: repoPath, line: lineOf(source, node) });
  });

  return out;
};

/**
 * Key handling with no registry. Each entry names the code it mirrors; keep in
 * sync by hand when those handlers change.
 */
export const HAND_KEYS: Record<string, string> = {
  'key:Mod+/': 'src/components/modules/blockEvents/index.ts:287 opens block settings',
  'key:Mod+Z': 'src/components/modules/uiControllers/controllers/keyboard.ts:75-77 undo',
  'key:Mod+Shift+Z': 'src/components/modules/uiControllers/controllers/keyboard.ts:75-77 redo',
  'key:Ctrl+Y': 'src/components/modules/uiControllers/controllers/keyboard.ts:77 redo on Windows/Linux',
  'key:Mod+F': 'src/components/modules/find/index.ts:466 find',
  'key:Replace': 'src/components/modules/find/index.ts:467-469 replace (Mod+Alt+F on macOS, Ctrl+H elsewhere)',
};

export const keyIds = (source: ts.SourceFile, repoPath: string): Capability[] => {
  const out: Capability[] = [];

  visit(source, (node) => {
    if (
      ts.isCaseClause(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'keyCodes'
    ) {
      out.push({ id: `key:${node.expression.name.text}`, file: repoPath, line: lineOf(source, node) });
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === 'key' &&
      ts.isStringLiteral(node.right) &&
      node.right.text === '/'
    ) {
      out.push({ id: 'key:/', file: repoPath, line: lineOf(source, node) });
    }
  });

  return out;
};

const TYPING_HANDLER = /^handle[A-Z]\w*(Shortcut|Markdown)$/;

export const typingHandlerIds = (source: ts.SourceFile, repoPath: string): Capability[] => {
  const out: Capability[] = [];

  visit(source, (node) => {
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && TYPING_HANDLER.test(node.name.text)) {
      out.push({ id: `typing:${node.name.text}`, file: repoPath, line: lineOf(source, node) });
    }
  });

  return out;
};

/** Composer files that react to typed characters (`@`, `[[`, `:`). The other composers are key navigation. */
export const triggerFileIds = (dir: string): Capability[] =>
  readdirSync(dir)
    .filter((file) => /Trigger\.ts$/.test(file))
    .map((file) => ({ id: `typing:${file.replace(/\.ts$/, '')}`, file: toRepoPath(join(dir, file)), line: 0 }));

export const dragIds = (source: ts.SourceFile, repoPath: string): Capability[] => {
  const out: Capability[] = [];

  visit(source, (node) => {
    if (!ts.isInterfaceDeclaration(node) || node.name.text !== 'DropTarget') {
      return;
    }

    const edge = node.members.find(
      (m): m is ts.PropertySignature => ts.isPropertySignature(m) && ts.isIdentifier(m.name) && m.name.text === 'edge'
    );

    if (edge?.type === undefined || !ts.isUnionTypeNode(edge.type)) {
      return;
    }

    for (const member of edge.type.types) {
      const value = literalTypeText(member);

      if (value !== null) {
        out.push({ id: `drag:${value}`, file: repoPath, line: lineOf(source, member) });
      }
    }
  });

  return out;
};

const fromFile = (relative: string, fn: (source: ts.SourceFile, repoPath: string) => Capability[]): Capability[] => {
  const file = join(SRC_ROOT, relative);

  return fn(parseFile(file), toRepoPath(file));
};

export const enumerateActionUnions = (): Capability[] =>
  walkTs(join(SRC_ROOT, 'tools')).flatMap((file) => actionUnionIds(parseFile(file), toRepoPath(file)));

export const enumerateShortcuts = (): Capability[] =>
  walkTs(SRC_ROOT).flatMap((file) => shortcutIds(parseFile(file), toRepoPath(file)));

export const enumerateKeys = (): Capability[] => [
  ...fromFile('components/modules/blockEvents/index.ts', keyIds),
  ...Object.keys(HAND_KEYS).map((id) => ({ id, file: HAND_KEYS[id].split(' ')[0], line: 0 })),
];

export const enumerateTyping = (): Capability[] => [
  ...fromFile('components/modules/blockEvents/composers/markdownShortcuts.ts', typingHandlerIds),
  ...triggerFileIds(join(SRC_ROOT, 'components/modules/blockEvents/composers')),
];

export const enumerateDrag = (): Capability[] => [
  ...fromFile('components/modules/drag/target/DropTargetDetector.ts', dragIds),
  // DropTargetDetector.ts:21-23 (named drop-into zone) and DragController.ts:365 (Alt duplicates).
  { id: 'drag:into', file: 'src/components/modules/drag/target/DropTargetDetector.ts', line: 21 },
  { id: 'drag:duplicate', file: 'src/components/modules/drag/DragController.ts', line: 365 },
];
```

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test test/unit/architecture/agent-coverage-enumerators.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
node_modules/.bin/eslint test/unit/architecture/agent-coverage/enumerators.ts test/unit/architecture/agent-coverage-enumerators.test.ts
git add test/unit/architecture/agent-coverage/enumerators.ts test/unit/architecture/agent-coverage-enumerators.test.ts
git diff --cached --name-only
git commit -m "test(agent-coverage): action, shortcut, key, typing and drag enumerators

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The `api` and `ui-file` enumerators, `enumerateAll`, and the scan floors

**Files:**
- Modify: `test/unit/architecture/agent-coverage/enumerators.ts` (append)
- Modify: `test/unit/architecture/agent-coverage-enumerators.test.ts` (append)
- Modify: `test/unit/architecture/agent-coverage-law.test.ts` (append assertion 7)

**Interfaces:**
- Produces: `apiIds(source, repoPath): Capability[]`, `uiFileIds(source, repoPath): Capability[]`, `type CapabilitySource = 'insert' | 'format' | 'tune' | 'menu' | 'action' | 'shortcut' | 'key' | 'typing' | 'drag' | 'api' | 'ui-file'`, `ENUMERATORS: Record<CapabilitySource, () => Capability[]>`, `enumerateAll(): Map<string, Capability>` (first location wins for a repeated id), `SCAN_FLOORS: Record<CapabilitySource, number>`.

- [ ] **Step 1: Append the failing fixture tests**

```ts
// append to test/unit/architecture/agent-coverage-enumerators.test.ts
import { apiIds, uiFileIds } from './agent-coverage/enumerators';

describe('api and ui-file enumerators', () => {
  it('api: methods and function properties of the Blocks interface only (mutation check)', () => {
    const source = parseSource(`
      export interface Blocks { insert(type: string): void; insert(type: string, x: number): void; render: (d: unknown) => Promise<void>; count: number }
      export interface Other { nope(): void }
    `);

    expect(ids(apiIds(source, 'types/api/blocks.d.ts'))).toEqual(['api:blocks.insert', 'api:blocks.render']);
  });

  it('ui-file: a file with a click/pointerdown/mousedown/keydown listener (mutation check)', () => {
    expect(ids(uiFileIds(parseSource(`el.addEventListener('pointerdown', fn);`), 'src/tools/a.ts'))).toEqual(['ui-file:src/tools/a.ts']);
    expect(uiFileIds(parseSource(`el.addEventListener('focus', fn);`), 'src/tools/b.ts')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test test/unit/architecture/agent-coverage-enumerators.test.ts`
Expected: FAIL, missing exports.

- [ ] **Step 3: Append the implementations**

```ts
// append to test/unit/architecture/agent-coverage/enumerators.ts
import { REPO_ROOT } from './scan';

export const apiIds = (source: ts.SourceFile, repoPath: string): Capability[] => {
  const seen = new Set<string>();
  const out: Capability[] = [];

  visit(source, (node) => {
    if (!ts.isInterfaceDeclaration(node) || node.name.text !== 'Blocks') {
      return;
    }

    for (const member of node.members) {
      const isFunction =
        ts.isMethodSignature(member) ||
        (ts.isPropertySignature(member) && member.type !== undefined && ts.isFunctionTypeNode(member.type));

      if (!isFunction || member.name === undefined || !ts.isIdentifier(member.name) || seen.has(member.name.text)) {
        continue;
      }

      seen.add(member.name.text);
      out.push({ id: `api:blocks.${member.name.text}`, file: repoPath, line: lineOf(source, member) });
    }
  });

  return out;
};

const UI_EVENTS = new Set(['click', 'pointerdown', 'mousedown', 'keydown']);

export const uiFileIds = (source: ts.SourceFile, repoPath: string): Capability[] => {
  let line = 0;

  visit(source, (node) => {
    if (
      line === 0 &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'addEventListener' &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0]) &&
      UI_EVENTS.has(node.arguments[0].text)
    ) {
      line = lineOf(source, node);
    }
  });

  return line === 0 ? [] : [{ id: `ui-file:${repoPath}`, file: repoPath, line }];
};

export type CapabilitySource =
  | 'insert' | 'format' | 'tune' | 'menu' | 'action' | 'shortcut' | 'key' | 'typing' | 'drag' | 'api' | 'ui-file';

export const ENUMERATORS: Record<CapabilitySource, () => Capability[]> = {
  insert: enumerateInsert,
  format: formatIds,
  tune: enumerateTunes,
  menu: () => scanToolMenus().capabilities,
  action: enumerateActionUnions,
  shortcut: enumerateShortcuts,
  key: enumerateKeys,
  typing: enumerateTyping,
  drag: enumerateDrag,
  api: () => {
    const file = join(REPO_ROOT, 'types/api/blocks.d.ts');

    return apiIds(parseFile(file), toRepoPath(file));
  },
  'ui-file': () => walkTs(join(SRC_ROOT, 'tools')).flatMap((file) => uiFileIds(parseFile(file), toRepoPath(file))),
};

/**
 * Lower bounds so a broken walk cannot pass empty. Set at ~80% of the count on
 * 2026-10-08; raise them as features land, never lower them to make a scan pass.
 */
export const SCAN_FLOORS: Record<CapabilitySource, number> = {
  insert: 20,
  format: 10,
  tune: 5,
  menu: 60,
  action: 10,
  shortcut: 5,
  key: 8,
  typing: 9,
  drag: 6,
  api: 20,
  'ui-file': 50,
};

export const enumerateAll = (): Map<string, Capability> => {
  const all = new Map<string, Capability>();

  for (const enumerate of Object.values(ENUMERATORS)) {
    for (const capability of enumerate()) {
      if (!all.has(capability.id)) {
        all.set(capability.id, capability);
      }
    }
  }

  return all;
};
```

`walkTs` skips `.d.ts`, which is why `api` parses `types/api/blocks.d.ts` directly with `parseFile`.

The `ui-file` scan sees only `addEventListener`. On 2026-10-08, `grep -rnE "listeners\.on\(" src/tools` found nothing, so no tool attaches clicks through a listener helper today. If one starts to, widen `uiFileIds` to that helper in the same change.

- [ ] **Step 4: Append assertion 7 and a runtime probe to the law**

```ts
// append inside describe('agent coverage law', …) in agent-coverage-law.test.ts
import { ENUMERATORS, SCAN_FLOORS } from './agent-coverage/enumerators';
import type { CapabilitySource } from './agent-coverage/enumerators';

it.skipIf(isInstrumented())('every enumerator still finds its floor (assertion 7)', () => {
  const below = (Object.keys(ENUMERATORS) as CapabilitySource[])
    .map((source) => ({ source, found: new Set(ENUMERATORS[source]().map((c) => c.id)).size }))
    .filter(({ source, found }) => found < SCAN_FLOORS[source])
    .map(({ source, found }) => `${source}: found ${found}, floor ${SCAN_FLOORS[source]}`);

  expect(below).toEqual([]);
});
```

- [ ] **Step 5: Run the fixtures and the law**

Run: `yarn test test/unit/architecture/agent-coverage-enumerators.test.ts`
Expected: PASS.
Run: `yarn test test/unit/architecture/agent-coverage-law.test.ts`
Expected: PASS. If a floor fails, the measured count is in the message. Set that floor to 80% of the measured count, rounded down, and note the measured count in the commit message. Do not set a floor above what the scan finds.

- [ ] **Step 6: Measure the law's runtime**

Run: `yarn test test/unit/architecture/agent-coverage-law.test.ts 2>&1 | grep -E "Duration|Tests"`
Expected: the duration line. Record it in the commit message. If it is above 5 s, cache each enumerator's result in a module-level `const` (scan once per file run) before committing; the unit job is sharded 5 ways (`.github/workflows/ci.yml:368-397`) and must stay under 7 minutes.

- [ ] **Step 7: Lint and commit**

```bash
node_modules/.bin/eslint test/unit/architecture/agent-coverage/enumerators.ts test/unit/architecture/agent-coverage-enumerators.test.ts test/unit/architecture/agent-coverage-law.test.ts
git add test/unit/architecture/agent-coverage/enumerators.ts test/unit/architecture/agent-coverage-enumerators.test.ts test/unit/architecture/agent-coverage-law.test.ts
git diff --cached --name-only
git commit -m "test(agent-coverage): api and ui-file enumerators, scan floors

Law file runtime: <measured> s.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 5: The ledger and the ledger-only assertions (uncovered, stale, exemption quality, banned update)

The ledger is the audit (05 §3.1.3). Rows that name a command not yet built carry `pending: 'plan-01'` or `pending: 'plan-02'`. That keeps `main` green while 01 and 02 land; Task 15 turns the marker into a check and Task 16 requires zero markers.

**Files:**
- Create: `test/unit/architecture/agent-coverage.ledger.ts`
- Modify: `test/unit/architecture/agent-coverage-law.test.ts` (append assertions 1, 4, 5 and the update ban)

**Interfaces:**
- Consumes: `enumerateAll()` (Task 4).
- Produces (`agent-coverage.ledger.ts`):

```ts
export type CapabilityId = string;
export type PendingOn = 'plan-01' | 'plan-02';
export type ExemptCategory = 'view-only' | 'clipboard' | 'chrome' | 'read-only-info' | 'gesture-alias' | 'cut-v1';
export type Route =
  | { command: string; pending?: PendingOn }
  | { commands: string[]; note: string; pending?: PendingOn }
  | { field: `${string}.${string}`; pending?: PendingOn };
export type Coverage = Route | { exempt: ExemptCategory; reason: string };
export const LEDGER: Record<CapabilityId, Coverage>;
export const isExempt: (c: Coverage) => c is { exempt: ExemptCategory; reason: string };
```

`command` is `string` here because `CommandName` (06 §3.1, `types/agent.d.ts`) does not exist until 01 lands. Task 15 narrows it.

- [ ] **Step 1: Write the ledger types with an empty `LEDGER`**

```ts
// test/unit/architecture/agent-coverage.ledger.ts
/**
 * Coverage ledger for agent-coverage-law.test.ts. One row per capability id the
 * law enumerates. A row says which agent command covers it, or why nothing must.
 * An exemption without a real reason violates the law.
 */
export type CapabilityId = string;

/** The command is designed (06 §3) but not built yet. Task 16 requires none left. */
export type PendingOn = 'plan-01' | 'plan-02';

export type ExemptCategory =
  | 'view-only'      // changes nothing in the document
  | 'clipboard'      // writes the OS clipboard
  | 'chrome'         // editor UI state, not content
  | 'read-only-info' // shows metadata
  | 'gesture-alias'  // another id already covers the same effect; the reason names it
  | 'cut-v1';        // a v1 scope cut the user can revisit; the reason names D6

export type Route =
  | { command: string; pending?: PendingOn }
  | { commands: string[]; note: string; pending?: PendingOn }
  | { field: `${string}.${string}`; pending?: PendingOn };

export type Coverage = Route | { exempt: ExemptCategory; reason: string };

export const isExempt = (coverage: Coverage): coverage is { exempt: ExemptCategory; reason: string } =>
  'exempt' in coverage;

export const LEDGER: Record<CapabilityId, Coverage> = {};
```

- [ ] **Step 2: Append the failing assertions**

```ts
// append to agent-coverage-law.test.ts (merge imports into the top block)
import { LEDGER, isExempt } from './agent-coverage.ledger';
import type { Coverage } from './agent-coverage.ledger';
import { enumerateAll } from './agent-coverage/enumerators';

const ID_TOKEN = /\b[a-z-]+:[^\s,;)]+/g;
const FIELD_TOKEN = /\b[a-z_-]+\.[a-zA-Z]+\b/;

const routeNames = (coverage: Coverage): string[] => {
  if ('command' in coverage) {
    return [coverage.command];
  }

  return 'commands' in coverage ? coverage.commands : [];
};

// inside describe('agent coverage law', …):

it.skipIf(isInstrumented())('every capability has a ledger row (assertion 1)', () => {
  const missing = [...enumerateAll().values()]
    .filter((c) => LEDGER[c.id] === undefined)
    .map((c) => `${c.id}  (${c.file}:${c.line})`);

  expect(
    missing,
    'These human-reachable capabilities have no agent route. For each one: declare a tool action ' +
      'whose `mirrors` lists the id (02), or add a LEDGER row in agent-coverage.ledger.ts naming the ' +
      'command / field, or exempt it with a category and a reason.'
  ).toEqual([]);
});

it.skipIf(isInstrumented())('no ledger row is stale (assertion 4)', () => {
  const found = enumerateAll();
  const stale = Object.keys(LEDGER).filter((id) => !found.has(id));

  expect(stale, 'These ledger rows name ids the scan no longer finds. Delete them.').toEqual([]);
});

it('every exemption has a real reason (assertion 5)', () => {
  const problems: string[] = [];

  for (const [id, coverage] of Object.entries(LEDGER)) {
    if (!isExempt(coverage)) {
      continue;
    }

    const reason = coverage.reason.trim();

    if (reason.length < 20 || reason.toLowerCase().replace(/[^a-z]/g, '') === coverage.exempt.replace(/-/g, '')) {
      problems.push(`${id}: reason only repeats the category`);
    }

    if (coverage.exempt === 'cut-v1' && !reason.includes('D6')) {
      problems.push(`${id}: a cut-v1 reason must name the D6 cut it follows`);
    }

    if (coverage.exempt === 'gesture-alias') {
      const named = (reason.match(ID_TOKEN) ?? []).filter((token) => LEDGER[token] !== undefined);
      const covered = named.filter((token) => !isExempt(LEDGER[token]));

      if (covered.length === 0) {
        problems.push(`${id}: a gesture-alias reason must name a ledger id that a command or field covers`);
      }
    }
  }

  expect(problems).toEqual([]);
});

it('block.update is never the coverage of a UI capability (06 C4)', () => {
  const problems: string[] = [];

  for (const [id, coverage] of Object.entries(LEDGER)) {
    if ('command' in coverage && coverage.command === 'block.update') {
      problems.push(`${id}: use { field: '<registryKey>.<field>' } instead of { command: 'block.update' }`);
    }

    if ('commands' in coverage && coverage.commands.includes('block.update') && !FIELD_TOKEN.test(coverage.note)) {
      problems.push(`${id}: a commands row with block.update must name the fields it writes ('<key>.<field>') in its note`);
    }
  }

  expect(problems).toEqual([]);
});

it('reports how many rows still wait on 01 and 02', () => {
  const pending = Object.values(LEDGER).filter((c) => !isExempt(c) && c.pending !== undefined).length;

  // Informational until Task 16, which requires zero.
  expect(pending).toBeGreaterThanOrEqual(0);
});
```

`routeNames` is used by Task 15; keep it now so Task 15 only adds assertions.

- [ ] **Step 3: Run to verify assertion 1 fails with the full worklist**

Run: `yarn test test/unit/architecture/agent-coverage-law.test.ts`
Expected: FAIL in "every capability has a ledger row", listing every id with its `file:line`. This list is the audit worklist. Save it: `yarn test test/unit/architecture/agent-coverage-law.test.ts 2>&1 | grep -E "^\s+\"?[a-z-]+:" > /private/tmp/claude-501/agent-coverage-worklist.txt` (scratch, not committed).

- [ ] **Step 4: Fill `LEDGER` (the audit)**

Replace the empty `LEDGER` with the rows below. They were derived from the scan output on 2026-10-08 and the route table in 02 §2.6 and §3.8. After pasting, re-run the law: any id it still reports missing gets a row by the same rules; any row it reports stale is deleted. The `ui-file` rows require opening each file and checking what its listeners do; the table lists the expected routes per file, and any listener doing something not listed is either added to that row's `commands` or becomes a gap for 02 (a new `pending: 'plan-02'` command), never an exemption, per 05 §3.1.3.

```ts
const c01 = (command: string): Route => ({ command, pending: 'plan-01' });
const c02 = (command: string): Route => ({ command, pending: 'plan-02' });
const f = (field: `${string}.${string}`): Route => ({ field, pending: 'plan-02' });
const many = (commands: string[], note: string, pending: PendingOn): Route => ({ commands, note, pending });
const exempt = (category: ExemptCategory, reason: string): Coverage => ({ exempt: category, reason });

const VIEW_ONLY_DOWNLOAD = 'Saves a copy of the file to the user\'s disk; the document does not change.';
const COPY_URL = 'Writes the media URL to the OS clipboard; the agent reads the URL from the block data.';
const OPEN_ORIGINAL = 'Opens the source URL in a new browser tab; the document does not change.';
const VIEW_STATE_CUT = 'View-state control is cut from v1 by D6 (user can revisit); open/closed state is never saved.';

export const LEDGER: Record<CapabilityId, Coverage> = {
  // insert — toolbox entries (src/tools/*/index.ts `static get toolbox`)
  'insert:paragraph': c01('block.insert'),
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].flatMap((n) => [
    [`insert:header/header-${n}`, c01('block.insert')],
    [`insert:header/toggle-header-${n}`, c01('block.insert')],
  ])),
  'insert:list/bulleted-list': c01('block.insert'),
  'insert:list/numbered-list': c01('block.insert'),
  'insert:list/check-list': c01('block.insert'),
  'insert:table': c02('table.create'),
  'insert:toggle': c01('block.insert'),
  'insert:callout': c01('block.insert'),
  'insert:database/database': c02('database.create'),
  'insert:database/board': c02('database.create'),
  'insert:divider': c01('block.insert'),
  'insert:spacer': c01('block.insert'),
  'insert:table_of_contents': c01('block.insert'),
  'insert:quote': c01('block.insert'),
  'insert:code': c01('block.insert'),
  'insert:image': c01('block.insert'),
  'insert:file': c01('block.insert'),
  'insert:audio': c01('block.insert'),
  'insert:video': c01('block.insert'),
  ...Object.fromEntries([2, 3, 4, 5].map((n) => [`insert:column_list/column_list-${n}`, c02('column_list.create')])),
  'insert:tabs': c02('tabs.create'),
  'insert:embed': c01('block.insert'),
  'insert:bookmark': c02('bookmark.create'),
  'insert:page': c01('block.insert'),

  // format — inline tools (src/tools/index.ts:110-121)
  'format:marker': c01('text.format'),
  'format:bold': c01('text.format'),
  'format:italic': c01('text.format'),
  'format:underline': c01('text.format'),
  'format:clearFormat': c01('text.format'),
  'format:link': c01('text.format'),
  'format:strikethrough': c01('text.format'),
  'format:inlineCode': c01('text.format'),
  'format:equation': many(['text.insert', 'text.replace'], 'An equation is an embed segment {equation:{expression}}; insert it, or replace the selected range with it.', 'plan-01'),
  'format:supSub': c01('text.format'),

  // tune — internal tunes (tools.ts:323-341) and block settings items (blockSettings.ts)
  'tune:delete': c01('block.delete'),
  'tune:copyLink': exempt('clipboard', 'Copies a link to the block to the OS clipboard; agents address blocks by id from doc.read.'),
  'tune:duplicate': c01('block.duplicate'),
  'tune:convert-to': c01('block.convert'),
  'tune:turn-into-columns': c02('column_list.create'),
  'tune:edit-metadata': exempt('read-only-info', 'Shows who last edited the block and when; it writes nothing.'),
  'tune:block-menu-title': exempt('chrome', 'The block menu heading row; it is a label, not an action.'),

  // menu — tool popover items (named in Task 2)
  'menu:audio/audio-alignment-*': f('audio.alignment'),
  'menu:audio/audio-caption': f('audio.captionVisible'),
  'menu:audio/audio-loop': f('audio.loop'),
  'menu:audio/audio-replace': c02('audio.setSource'),
  'menu:audio/audio-cover-set': c02('audio.setCover'),
  'menu:audio/audio-cover-remove': f('audio.coverUrl'),
  'menu:audio/audio-download': exempt('view-only', VIEW_ONLY_DOWNLOAD),
  'menu:audio/audio-copy-url': exempt('clipboard', COPY_URL),
  'menu:callout/callout-edit-icon': f('callout.emoji'),
  'menu:code/code-language-detected': f('code.language'),
  'menu:code/code-language-*': f('code.language'),
  'menu:code/*@src/tools/code/language-picker.ts': f('code.language'),
  'menu:file/file-caption': f('file.captionVisible'),
  'menu:file/file-replace': c02('file.setSource'),
  'menu:file/file-open-new-tab': exempt('view-only', 'Opens the file in a new browser tab; the document does not change.'),
  'menu:file/file-download': exempt('view-only', VIEW_ONLY_DOWNLOAD),
  'menu:file/file-copy-url': exempt('clipboard', COPY_URL),
  'menu:header/header-level-*': f('header.level'),
  'menu:image/image-alignment-*': f('image.alignment'),
  'menu:image/image-caption': f('image.captionVisible'),
  'menu:image/image-replace': f('image.url'),
  'menu:image/image-crop': c02('image.crop'),
  'menu:image/image-fullscreen': exempt('view-only', 'Opens the image in a lightbox; the document does not change.'),
  'menu:image/image-download': exempt('view-only', VIEW_ONLY_DOWNLOAD),
  'menu:image/image-copy-url': exempt('clipboard', COPY_URL),
  'menu:bookmark/bookmark-open-original': exempt('view-only', OPEN_ORIGINAL),
  'menu:bookmark/bookmark-copy-url': exempt('clipboard', COPY_URL),
  'menu:embed/embed-open-original': exempt('view-only', OPEN_ORIGINAL),
  'menu:embed/embed-replace': c02('embed.setUrl'),
  'menu:embed/embed-copy-url': exempt('clipboard', COPY_URL),
  'menu:paste-menu/paste-menu-*': many(['bookmark.create', 'embed.setUrl', 'text.format'], 'Paste-as choices for a pasted URL: a bookmark block, an embed block, or a plain link mark.', 'plan-02'),
  'menu:page/page-edit-icon': c02('page.setIcon'),
  'menu:page/page-rename': c02('page.rename'),
  'menu:page/page-open-new-tab': exempt('view-only', 'Opens the linked page in a new tab; this document does not change.'),
  'menu:page/page-open-side-peek': exempt('view-only', 'Opens another page in a panel; this document does not change.'),
  'menu:table/table-heading-row': f('table.withHeadings'),
  'menu:table/table-heading-column': f('table.withHeadingColumn'),
  'menu:table/table-fit-to-page-width': f('table.colWidths'),
  'menu:table/table-full-width': f('table.stretched'),
  'menu:table/table-text-compact': f('table.textSize'),
  'menu:table/table-text-comfortable': f('table.textSize'),
  'menu:table/table-merge-cells': c02('table.mergeCells'),
  'menu:table/table-split-cell': c02('table.splitCell'),
  'menu:table/table-copy-selection': exempt('clipboard', 'Copies the selected cells to the OS clipboard; agents read cells with doc.read.'),
  'menu:table/table-clear-selection': c02('table.clearCells'),
  // 02 Task 53 names these with a template (`table-duplicate-${type}`, `table-clear-${type}`), so one wildcard id each.
  'menu:table/table-duplicate-*': { commands: ['table.duplicateRows', 'table.duplicateColumns'], note: 'One menu item; row or column by type.', pending: 'plan-02' },
  'menu:table/table-clear-*': c02('table.clearCells'),
  'menu:table/table-insert-column-left': c02('table.insertColumns'),
  'menu:table/table-insert-column-right': c02('table.insertColumns'),
  'menu:table/table-delete-column': c02('table.deleteColumns'),
  'menu:table/table-insert-row-above': c02('table.insertRows'),
  'menu:table/table-insert-row-below': c02('table.insertRows'),
  'menu:table/table-delete-row': c02('table.deleteRows'),
  'menu:video/video-alignment-*': f('video.alignment'),
  'menu:video/video-caption': f('video.captionVisible'),
  'menu:video/video-autoplay': f('video.autoplay'),
  'menu:video/video-loop': f('video.loop'),
  'menu:video/video-hide-controls': f('video.hideControls'),
  'menu:video/video-replace': c02('video.setSource'),
  'menu:video/video-download': exempt('view-only', VIEW_ONLY_DOWNLOAD),
  'menu:video/video-copy-url': exempt('clipboard', COPY_URL),
  'menu:video/video-copy-url-at-time': exempt('clipboard', 'Writes the URL with the current time to the OS clipboard; nothing is saved.'),
  'menu:video/video-statistics': exempt('read-only-info', 'Shows file size, codec and resolution; it writes nothing.'),
  'menu:database/database-view-rename': c02('database.renameView'),
  'menu:database/database-view-duplicate': c02('database.duplicateView'),
  'menu:database/database-view-delete': c02('database.deleteView'),
  'menu:database/database-card-delete': c01('block.delete'),
  'menu:list/list-style-*': f('list.style'),
  'menu:quote/quote-size-default': f('quote.size'),
  'menu:quote/quote-size-large': f('quote.size'),
  'menu:tabs/tabs-rename': f('tab.title'),
  'menu:tabs/tabs-edit-icon': f('tab.icon'),
  'menu:tabs/tabs-delete': c02('tabs.deleteTab'),

  // action — RowColAction (src/tools/table/table-row-col-controls.ts:29-41)
  'action:table/insert-row-above': c02('table.insertRows'),
  'action:table/insert-row-below': c02('table.insertRows'),
  'action:table/insert-col-left': c02('table.insertColumns'),
  'action:table/insert-col-right': c02('table.insertColumns'),
  'action:table/move-row': c02('table.moveRow'),
  'action:table/move-col': c02('table.moveColumn'),
  'action:table/duplicate-row': c02('table.duplicateRows'),
  'action:table/duplicate-col': c02('table.duplicateColumns'),
  'action:table/delete-row': c02('table.deleteRows'),
  'action:table/delete-col': c02('table.deleteColumns'),
  'action:table/toggle-heading': f('table.withHeadings'),
  'action:table/toggle-heading-column': f('table.withHeadingColumn'),

  // shortcut — Shortcuts.add call sites
  'shortcut:tools/toggle/toggle-shortcuts.ts/COLLAPSE_EXPAND_ALL_SHORTCUT': exempt('cut-v1', VIEW_STATE_CUT),
  'shortcut:tools/toggle/toggle-shortcuts.ts/COLLAPSE_EXPAND_CURRENT_SHORTCUT': exempt('cut-v1', VIEW_STATE_CUT),
  'shortcut:tools/toggle/toggle-shortcuts.ts/COLLAPSE_EXPAND_SCOPED_SHORTCUT': exempt('cut-v1', VIEW_STATE_CUT),
  'shortcut:components/ui/toolbox.ts/<dynamic>': exempt('gesture-alias', 'A tool shortcut inserts that tool, the same effect as insert:paragraph and the other insert ids.'),
  'shortcut:components/modules/blockSelection.ts/CMD+A': exempt('chrome', 'Selects blocks; selection is editor UI state and agents address blocks by id.'),
  'shortcut:components/modules/toolbar/inline/shortcuts-manager.ts/<dynamic>': exempt('gesture-alias', 'An inline tool shortcut applies the same mark as format:bold and the other format ids.'),

  // key — blockEvents/index.ts switch + HAND_KEYS
  'key:BACKSPACE': many(['text.delete', 'block.delete'], 'Deletes text, or merges/removes an empty block.', 'plan-01'),
  'key:DELETE': many(['text.delete', 'block.delete'], 'Deletes text forward, or merges the next block.', 'plan-01'),
  'key:ENTER': many(['text.delete', 'block.insert'], 'A split: delete the tail from this block and insert it as a new block.', 'plan-01'),
  'key:DOWN': exempt('chrome', 'Moves the caret; agents never move the user\'s caret (06 C14).'),
  'key:UP': exempt('chrome', 'Moves the caret; agents never move the user\'s caret (06 C14).'),
  'key:RIGHT': exempt('chrome', 'Moves the caret; agents never move the user\'s caret (06 C14).'),
  'key:LEFT': exempt('chrome', 'Moves the caret; agents never move the user\'s caret (06 C14).'),
  'key:TAB': c01('block.move'),
  'key:/': exempt('gesture-alias', 'Opens the toolbox, which inserts a block: the same effect as insert:paragraph and the other insert ids.'),
  'key:Mod+/': exempt('chrome', 'Opens the block settings menu; each item there has its own tune or menu id.'),
  'key:Mod+Z': c01('history.undo'),
  'key:Mod+Shift+Z': c01('history.redo'),
  'key:Ctrl+Y': c01('history.redo'),
  'key:Mod+F': exempt('view-only', 'Opens find and highlights matches; the document does not change.'),
  'key:Replace': c01('text.replace'),

  // typing — markdownShortcuts.ts handlers and *Trigger composers
  'typing:handleListShortcut': c01('block.convert'),
  'typing:handleInlineMarkdown': c01('text.format'),
  'typing:handleLinkMarkdown': c01('text.format'),
  'typing:handleHeaderShortcut': c01('block.convert'),
  'typing:handleToggleHeaderShortcut': c01('block.convert'),
  'typing:handleToggleShortcut': c01('block.convert'),
  'typing:handleDividerShortcut': c01('block.insert'),
  'typing:handleQuoteShortcut': c01('block.convert'),
  'typing:handleCodeShortcut': c01('block.convert'),
  'typing:emojiTrigger': c01('text.insert'),
  'typing:pageReferenceTrigger': c01('text.insert'),

  // drag — DropTarget.edge + two fixed outcomes
  'drag:top': c01('block.move'),
  'drag:bottom': c01('block.move'),
  'drag:left': many(['column_list.create', 'column_list.addColumn'], 'Side drop: beside a plain block makes a column list; on an existing column list adds a column.', 'plan-02'),
  'drag:right': many(['column_list.create', 'column_list.addColumn'], 'Side drop: beside a plain block makes a column list; on an existing column list adds a column.', 'plan-02'),
  'drag:into': c01('block.move'),
  'drag:duplicate': c01('block.duplicate'),

  // api — Blocks interface (types/api/blocks.d.ts:110)
  'api:blocks.beginTransaction': exempt('chrome', 'Groups host writes into one undo step; every agent batch is already one step (06 C11).'),
  'api:blocks.endTransaction': exempt('chrome', 'Groups host writes into one undo step; every agent batch is already one step (06 C11).'),
  'api:blocks.transact': exempt('chrome', 'Groups host writes into one undo step; every agent batch is already one step (06 C11).'),
  'api:blocks.transactWithoutCapture': exempt('chrome', 'Writes outside undo history for host bookkeeping; agent writes are always undoable.'),
  'api:blocks.clear': many(['block.delete'], 'Delete every root block.', 'plan-01'),
  'api:blocks.composeBlockData': exempt('read-only-info', 'Returns a tool\'s default data; it writes nothing. Agents read defaults from blok_describe.'),
  'api:blocks.convert': c01('block.convert'),
  'api:blocks.create': c01('block.insert'),
  'api:blocks.delete': c01('block.delete'),
  'api:blocks.exportMarkdown': c01('markdown.export'),
  'api:blocks.getBlockByElement': c01('doc.read'),
  'api:blocks.getBlockByIndex': c01('doc.read'),
  'api:blocks.getBlockIndex': c01('doc.read'),
  'api:blocks.getBlocksCount': c01('doc.read'),
  'api:blocks.getById': c01('doc.read'),
  'api:blocks.getChildren': c01('doc.read'),
  'api:blocks.getCurrentBlockIndex': exempt('chrome', 'Reads where the user\'s caret is; agents never use the user\'s caret (06 C14).'),
  'api:blocks.importMarkdown': c01('markdown.insert'),
  'api:blocks.insert': c01('block.insert'),
  'api:blocks.insertAt': c01('block.insert'),
  'api:blocks.insertInsideParent': c01('block.insert'),
  'api:blocks.insertMany': c01('block.insert'),
  'api:blocks.move': c01('block.move'),
  'api:blocks.moveTo': c01('block.move'),
  'api:blocks.render': many(['block.delete', 'block.insert'], 'Replace the whole document: delete the roots, then insert the new blocks.', 'plan-01'),
  'api:blocks.renderFromHTML': many(['block.delete', 'block.insert'], 'Replace the whole document from HTML: delete the roots, then insert.', 'plan-01'),
  'api:blocks.scrollToBlock': exempt('view-only', 'Moves the viewport only. caret.set is not in v1; following the agent is the host follow option (06 C14).'),
  'api:blocks.setBlockParent': c01('block.move'),
  'api:blocks.setPointerDragActive': exempt('chrome', 'Tells core a pointer drag is running; it is UI state, not content.'),
  'api:blocks.splitBlock': many(['text.delete', 'block.insert'], 'Split = delete the tail from the block and insert it as a new block.', 'plan-01'),
  'api:blocks.startBlockMutationWatching': exempt('chrome', 'Toggles DOM mutation tracking for a tool; agent writes do not go through the DOM.'),
  'api:blocks.stopBlockMutationWatching': exempt('chrome', 'Toggles DOM mutation tracking for a tool; agent writes do not go through the DOM.'),
  'api:blocks.update': many(['block.update'], 'Host-level generic patch over any data field, for example paragraph.text; agents use block.update or a field route.', 'plan-01'),

  // ui-file — interactive tool files (see the per-file table below)
  ...UI_FILE_ROWS,
};
```

`UI_FILE_ROWS` is declared above `LEDGER` in the same file. Its expected routes per file, taken from 02 §2.6 (each row is `{ commands, note, pending }` unless marked exempt; confirm by opening the file):

```ts
const ui = (commands: string[], note: string, pending: PendingOn = 'plan-02'): Route => ({ commands, note, pending });
const PLAYBACK = 'Plays, pauses, seeks and scrubs media; playback state is never saved.';

const UI_FILE_ROWS: Record<CapabilityId, Coverage> = {
  'ui-file:src/tools/audio/controls.ts': exempt('view-only', PLAYBACK),
  'ui-file:src/tools/audio/waveform.ts': exempt('view-only', PLAYBACK),
  'ui-file:src/tools/audio/cover-picker.ts': ui(['audio.setCover', 'block.update'], 'Sets or removes the cover; removing writes audio.coverUrl.'),
  'ui-file:src/tools/audio/index.ts': ui(['audio.setSource', 'block.update'], 'Upload/URL, then audio.title, audio.artist, audio.caption edits.'),
  'ui-file:src/tools/audio/ui.ts': ui(['block.update'], 'Inline edits of audio.title, audio.artist, audio.caption.'),
  'ui-file:src/tools/callout/emoji-picker/index.ts': ui(['block.update'], 'Picks the callout icon: writes callout.emoji.'),
  'ui-file:src/tools/code/index.ts': ui(['block.update'], 'Language and filename: code.language, code.filename.'),
  'ui-file:src/tools/column/index.ts': ui(['column_list.removeColumn'], 'Removes a column; unwraps when one is left.'),
  'ui-file:src/tools/columns-shared.ts': ui(['column_list.setWidths'], 'Resize and equalize column widths.'),
  'ui-file:src/tools/database/database-board-view.ts': ui(['database.addRow', 'database.setRowValues', 'database.addOption', 'block.delete'], 'Board cards and columns.'),
  'ui-file:src/tools/database/database-card-drag.ts': ui(['database.moveRow'], 'Drag a card between groups or within one.'),
  'ui-file:src/tools/database/database-card-drawer.ts': ui(['database.setRowValues', 'database.addProperty'], 'Row title, description and property edits.'),
  'ui-file:src/tools/database/database-column-controls.ts': ui(['database.addOption', 'database.renameOption', 'database.deleteOption'], 'Board column (select option) controls.'),
  'ui-file:src/tools/database/database-column-drag.ts': ui(['database.moveOption'], 'Reorder board columns.'),
  'ui-file:src/tools/database/database-keyboard.ts': exempt('chrome', 'Moves keyboard focus between cards and rows; nothing is saved.'),
  'ui-file:src/tools/database/database-list-row-drag.ts': ui(['database.moveRow'], 'Reorder rows in the list view.'),
  'ui-file:src/tools/database/database-list-view.ts': ui(['database.addRow', 'database.setRowValues', 'block.delete'], 'List view rows.'),
  'ui-file:src/tools/database/database-property-type-popover.ts': ui(['database.addProperty'], 'Pick a type for a new property.'),
  'ui-file:src/tools/database/database-tab-bar.ts': ui(['database.addView', 'database.renameView', 'database.duplicateView', 'database.deleteView', 'database.moveView', 'block.update'], 'View tabs; switching writes database.activeViewId.'),
  'ui-file:src/tools/database/database-view-popover.ts': ui(['database.addView'], 'Choose a new view type.'),
  'ui-file:src/tools/database/index.ts': ui(['block.update', 'database.addRow'], 'Title edit writes database.title; add-row buttons.'),
  'ui-file:src/tools/file/index.ts': ui(['file.setSource'], 'Upload or URL.'),
  'ui-file:src/tools/file/preview-modal.ts': exempt('view-only', 'Shows a preview of the file; nothing is saved.'),
  'ui-file:src/tools/file/ui.ts': ui(['block.update'], 'Rename and caption: file.fileName, file.caption.'),
  'ui-file:src/tools/file/uploading-state.ts': exempt('chrome', 'Cancel button of an in-flight upload; uploads are cut from v1 for agents (D6: URL only).'),
  'ui-file:src/tools/header/index.ts': exempt('cut-v1', 'Opens and closes a toggle heading. View-state control is cut from v1 by D6 (user can revisit).'),
  'ui-file:src/tools/image/alt-popover.ts': ui(['block.update'], 'Alt text: image.alt.'),
  'ui-file:src/tools/image/darkroom/adjust-panel.ts': ui(['block.update'], 'image.adjust sliders.'),
  'ui-file:src/tools/image/darkroom/dial.ts': ui(['image.straighten'], 'Straighten dial.'),
  'ui-file:src/tools/image/darkroom/filter-strip.ts': ui(['block.update'], 'image.filter and image.filterStrength.'),
  'ui-file:src/tools/image/darkroom/gestures.ts': ui(['image.crop'], 'Crop handles and pan.'),
  'ui-file:src/tools/image/darkroom/index.ts': ui(['image.crop', 'image.rotate', 'image.flip', 'image.straighten'], 'Darkroom toolbar.'),
  'ui-file:src/tools/image/darkroom/markup-editor.ts': ui(['image.addMarkup', 'image.updateMarkup', 'image.removeMarkup'], 'Draw, move and delete markup items.'),
  'ui-file:src/tools/image/darkroom/markup-panel.ts': ui(['image.addMarkup', 'image.removeMarkup'], 'Markup tools and clear all.'),
  'ui-file:src/tools/image/darkroom/mode-tabs.ts': exempt('chrome', 'Switches darkroom panels; nothing is saved.'),
  'ui-file:src/tools/image/error-state.ts': ui(['image.setSource'], 'Retry or replace a failed image.'),
  'ui-file:src/tools/image/index.ts': ui(['image.setSource', 'block.update'], 'Upload/URL, caption: image.caption.'),
  'ui-file:src/tools/image/resizer.ts': ui(['block.update'], 'Resize handles write image.width.'),
  'ui-file:src/tools/image/ui.ts': ui(['image.setSource', 'block.update'], 'Empty state and caption: image.caption.'),
  'ui-file:src/tools/image/uploading-state.ts': exempt('chrome', 'Cancel button of an in-flight upload; uploads are cut from v1 for agents (D6: URL only).'),
  'ui-file:src/tools/link/embed/index.ts': ui(['embed.setUrl', 'block.update'], 'URL entry, resize: embed.width, embed.caption.'),
  'ui-file:src/tools/link/embed/overlay.ts': exempt('chrome', 'Click shield that activates the embedded frame; nothing is saved.'),
  'ui-file:src/tools/link/paste-menu/controller.ts': ui(['bookmark.create', 'embed.setUrl', 'text.format'], 'Paste-as menu for a pasted URL.'),
  'ui-file:src/tools/list/dom-builder.ts': ui(['block.update'], 'Checkbox writes list.checked.'),
  'ui-file:src/tools/list/index.ts': ui(['block.update', 'block.move'], 'list.checked; Tab/Shift+Tab nest.', 'plan-01'),
  'ui-file:src/tools/page-link/index.ts': exempt('view-only', 'Opens the linked page; this document does not change.'),
  'ui-file:src/tools/page/hover-preview.ts': exempt('view-only', 'Shows a preview card of the linked page; nothing is saved.'),
  'ui-file:src/tools/page/index.ts': ui(['page.rename', 'page.setIcon'], 'Rename and icon of the linked page.'),
  'ui-file:src/tools/page/page-picker.ts': ui(['block.insert'], 'Picks a page to link: inserts a page block.', 'plan-01'),
  'ui-file:src/tools/spacer/index.ts': ui(['block.update'], 'Drag writes spacer.height.'),
  'ui-file:src/tools/tab/index.ts': ui(['block.update'], 'Tab title edit: tab.title.'),
  'ui-file:src/tools/table-of-contents/index.ts': exempt('view-only', 'Jumps to a heading; the document does not change.'),
  'ui-file:src/tools/table/table-add-controls.ts': ui(['table.insertRows', 'table.insertColumns'], 'Add-row and add-column buttons and drag.'),
  'ui-file:src/tools/table/table-cell-blocks.ts': exempt('chrome', 'Routes clicks into the cell\'s child blocks; cell content is edited as ordinary blocks.'),
  'ui-file:src/tools/table/table-cell-placement-picker.ts': ui(['table.styleCells'], 'Nine-way cell placement.'),
  'ui-file:src/tools/table/table-cell-selection.ts': ui(['table.mergeCells', 'table.splitCell', 'table.clearCells', 'table.styleCells', 'table.fillCells'], 'Cell selection pill and Cmd+R / Cmd+D fill.'),
  'ui-file:src/tools/table/table-corner-drag.ts': ui(['table.insertRows', 'table.insertColumns', 'table.deleteRows', 'table.deleteColumns'], 'Corner drag grows or shrinks the grid.'),
  'ui-file:src/tools/table/table-heading-toggle.ts': ui(['block.update'], 'Heading toggles: table.withHeadings, table.withHeadingColumn.'),
  'ui-file:src/tools/table/table-operations.ts': ui(['table.insertRows', 'table.insertColumns'], 'Shared grid operations behind the controls.'),
  'ui-file:src/tools/table/table-resize.ts': ui(['block.update'], 'Column resize writes table.colWidths.'),
  'ui-file:src/tools/table/table-row-col-controls.ts': ui(['table.moveRow', 'table.moveColumn', 'table.deleteRows', 'table.deleteColumns'], 'Row and column grips.'),
  'ui-file:src/tools/tabs/index.ts': ui(['tabs.addTab', 'tabs.deleteTab', 'block.move'], 'Add, delete and reorder tabs.'),
  'ui-file:src/tools/tabs/pill-gestures.ts': ui(['block.move'], 'Reorder tab pills.', 'plan-01'),
  'ui-file:src/tools/toggle/dom-builder.ts': exempt('cut-v1', 'Toggle arrow opens and closes. View-state control is cut from v1 by D6 (user can revisit).'),
  'ui-file:src/tools/toggle/index.ts': exempt('cut-v1', 'Opens and closes the toggle. View-state control is cut from v1 by D6 (user can revisit).'),
  'ui-file:src/tools/video/controls.ts': exempt('view-only', PLAYBACK),
  'ui-file:src/tools/video/ui.ts': ui(['video.setSource', 'block.update'], 'Upload/URL and caption: video.caption.'),
};
```

Two `ui-file` rows (`image/darkroom/dial.ts`, `link/paste-menu/controller.ts`) name commands whose routing is the reading in 02 §2.6, not checked against the file. Opening each file in this step is the check.

- [ ] **Step 5: Run the law until green**

Run: `yarn test test/unit/architecture/agent-coverage-law.test.ts`
Expected: PASS. Iterate on Step 4 until it does: add rows for ids it reports missing, delete rows it reports stale. Never weaken an assertion.

- [ ] **Step 6: Run the manual mutation checks available now (05 §3.1.4 a, d, e, f)**

Each is a temporary edit, run, revert. Record each result in the commit message.

(a) Delete the `'insert:table'` row → expect FAIL at "every capability has a ledger row".
(d) Rename `'insert:table'` to `'insert:tablex'` → expect FAIL at "no ledger row is stale".
(e) Delete `name: 'quote-size-large',` from `src/tools/quote/index.ts` → expect FAIL at "every tool menu item has a name".
(f) In `scan.ts`, make `walkTs` return `[]` → expect FAIL at "every enumerator still finds its floor".

Then run `git diff` and confirm all four edits are reverted.

- [ ] **Step 7: Lint and commit**

```bash
node_modules/.bin/eslint test/unit/architecture/agent-coverage.ledger.ts test/unit/architecture/agent-coverage-law.test.ts
git add test/unit/architecture/agent-coverage.ledger.ts test/unit/architecture/agent-coverage-law.test.ts
git diff --cached --name-only
git commit -m "test(agent-coverage): ledger audit and ledger-only law assertions

Every enumerated capability has a route or a reasoned exemption.
Rows waiting on 01/02 carry pending markers.

Mutation checks: (a) <result> (d) <result> (e) <result> (f) <result>

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Checkpoint 1

- [ ] Run each Phase 1 test file on its own: `yarn test test/unit/architecture/agent-coverage-enumerators.test.ts`, `yarn test test/unit/architecture/agent-coverage-law.test.ts`. Expected: PASS.
- [ ] Run the full lint gate once: `yarn lint`. Expected: exit 0.
- [ ] `git pull --rebase && git push`, then `git status` shows "up to date with origin".
- [ ] Tell 02's executor: the "menu items have names" assertion is live (green once 02 Task 53's names land); after that `mirrors` may be filled (02 Task 54, 06 R2-05-4). Hand them the list of `pending: 'plan-02'` commands in the ledger as the day-one action list.

---

# Phase 2 — Parity corpus and Node runners

### Task 6: Corpus format, loader and normalizer (no dependency on 01–04)

**Files:**
- Create: `test/unit/agent/parity/corpus.ts`
- Create: `test/unit/agent/parity/normalize.ts`
- Create: `test/unit/agent/parity/normalize.test.ts`
- Create: `test/fixtures/agent-commands/normalizer-cases.json`
- Create: `test/fixtures/agent-commands/cases/insert-paragraph.json`, `toggle-with-children.json`, `bold-range.json`, `move-into-toggle.json`, `delete-lifts-children.json`, `convert-to-quote.json`, `markdown-insert.json`, `unknown-command.json`
- Create: `test/fixtures/agent-commands/goldens/.gitkeep`

**Interfaces:**
- Consumes: `outputBlocksToCanonicalSegments` (`src/shared/rich-text/block-data.ts:227`), `CURRENT_RICH_TEXT_FIELDS` (`src/shared/rich-text/fields.ts`, imported at `src/view/diff-output-data.ts:9`), `htmlToSegmentsNode` (`src/view/rich-text-parse5.ts:39`), `OutputData` (`types`).
- Produces:

```ts
// corpus.ts
export type RunnerName = 'editor' | 'json' | 'store' | 'jint' | 'room';
export type Expectation = 'ok' | { errorCode: string };
export interface CorpusCommand { name: string; args: Record<string, unknown>; ref?: string }
export interface CorpusBatch { commands: CorpusCommand[] }
export interface ParityCase {
  name: string;
  seed: OutputData;
  batches: CorpusBatch[];
  expect?: Expectation;
  expectByRunner?: Partial<Record<RunnerName, Expectation>>;
}
export const CORPUS_ROOT: string;
export const loadParityCases(): ParityCase[];          // cases/*.json, then evals/*.json as `eval:<id>`
export const expectationFor(c: ParityCase, runner: RunnerName): Expectation;
export const goldenPath(name: string): string;
export const callerChosenIds(c: ParityCase): Set<string>;   // seed ids + every explicit `id` arg, recursively in `children`

// normalize.ts
export interface ParityDocument { blocks: OutputData['blocks']; title?: OutputData['title']; icon?: OutputData['icon'] }
export const normalizeForParity(doc: OutputData, keepIds: ReadonlySet<string>): ParityDocument;
export const stableStringify(value: unknown): string;
export const TOOL_MINTED: Record<string, { reason: string; strip(data: Record<string, unknown>): Record<string, unknown> }>;
```

`CorpusBatch` is structurally an `AgentBatch` (06 §3.2) with no `expectRevision`; cases never pin a revision (06 R3-5). The page fields are the flat `OutputData.title` / `OutputData.icon` that already exist (`types/data-formats/output-data.d.ts:128-132`, commit `8d86c376`, unreleased; 01 deviation D-1, 06 §10.1 A round 4). There is no `OutputData.page`.

- [ ] **Step 1: Write the shared normalizer cases**

```json
// test/fixtures/agent-commands/normalizer-cases.json
{
  "cases": [
    {
      "name": "keeps seed ids, relabels minted ids everywhere they appear",
      "keepIds": ["p1"],
      "input": {
        "time": 1, "version": "x",
        "blocks": [
          { "id": "p1", "type": "paragraph", "data": { "text": [{ "text": "a" }] }, "lastEditedAt": 5, "lastEditedBy": "agent-test" },
          { "id": "Zq81", "type": "toggle", "data": { "text": [{ "text": "t" }] }, "content": ["Xx9"] },
          { "id": "Xx9", "type": "paragraph", "parent": "Zq81", "data": { "text": [{ "text": "c", "marks": { "bold": true } }] } }
        ]
      },
      "expected": {
        "blocks": [
          { "id": "p1", "type": "paragraph", "data": { "text": [{ "text": "a" }] }, "lastEditedBy": "agent-test" },
          { "id": "b1", "type": "toggle", "data": { "text": [{ "text": "t" }] }, "content": ["b1.0"] },
          { "id": "b1.0", "type": "paragraph", "parent": "b1", "data": { "text": [{ "text": "c", "marks": { "bold": true } }] } }
        ]
      }
    },
    {
      "name": "turns an HTML rich field into segments",
      "tsOnly": "The C# runners emit segments; HTML parsing is the TS canonicalizer's job (06 C16).",
      "keepIds": ["p"],
      "input": { "blocks": [ { "id": "p", "type": "paragraph", "data": { "text": "<b>c</b>" } } ] },
      "expected": { "blocks": [ { "id": "p", "type": "paragraph", "data": { "text": [{ "text": "c", "marks": { "bold": true } }] } } ] }
    },
    {
      "name": "orders children by content, roots by array order",
      "keepIds": ["r", "c1", "c2"],
      "input": {
        "blocks": [
          { "id": "c2", "type": "paragraph", "parent": "r", "data": { "text": [] } },
          { "id": "r", "type": "toggle", "data": { "text": [] }, "content": ["c1", "c2"] },
          { "id": "c1", "type": "paragraph", "parent": "r", "data": { "text": [] } }
        ]
      },
      "expected": {
        "blocks": [
          { "id": "r", "type": "toggle", "data": { "text": [] }, "content": ["c1", "c2"] },
          { "id": "c1", "type": "paragraph", "parent": "r", "data": { "text": [] } },
          { "id": "c2", "type": "paragraph", "parent": "r", "data": { "text": [] } }
        ]
      }
    },
    {
      "name": "keeps the page field",
      "keepIds": [],
      "input": { "blocks": [], "title": "Q3 plan", "icon": { "type": "emoji", "value": "📅" } },
      "expected": { "blocks": [], "title": "Q3 plan", "icon": { "type": "emoji", "value": "📅" } }
    }
  ]
}
```

The `icon` shape is `PageIcon = { type: 'emoji'; value: string } | { type: 'image'; url: string }` (`types/tools/page.d.ts:13`).

- [ ] **Step 2: Write the failing normalizer test**

```ts
// test/unit/agent/parity/normalize.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutputData } from '../../../../types';
import { CORPUS_ROOT } from './corpus';
import { normalizeForParity, stableStringify } from './normalize';

type NormalizerCase = { name: string; keepIds: string[]; input: OutputData; expected: unknown; tsOnly?: string };

const cases = (JSON.parse(readFileSync(join(CORPUS_ROOT, 'normalizer-cases.json'), 'utf8')) as { cases: NormalizerCase[] }).cases;

describe('normalizeForParity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(cases)('$name', ({ input, keepIds, expected }) => {
    expect(normalizeForParity(input, new Set(keepIds))).toEqual(expected);
  });

  it('renames a minted id inside table cell data too', () => {
    const doc = {
      blocks: [
        { id: 't', type: 'table', data: { withHeadings: false, withHeadingColumn: false, content: [[{ blocks: ['m1'] }]] }, content: ['m1'] },
        { id: 'm1', type: 'paragraph', parent: 't', data: { text: [] } },
      ],
    } as unknown as OutputData;
    const out = normalizeForParity(doc, new Set(['t']));

    expect(stableStringify(out)).not.toContain('m1');
    expect(stableStringify(out)).toContain('"blocks":["t.0"]');
  });

  it('stableStringify sorts keys', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `yarn test test/unit/agent/parity/normalize.test.ts`
Expected: FAIL, "Failed to resolve import './corpus'".

- [ ] **Step 4: Write `corpus.ts`**

```ts
// test/unit/agent/parity/corpus.ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { OutputData } from '../../../../types';

export type RunnerName = 'editor' | 'json' | 'store' | 'jint' | 'room';
export type Expectation = 'ok' | { errorCode: string };

export interface CorpusCommand {
  name: string;
  args: Record<string, unknown>;
  ref?: string;
}

export interface CorpusBatch {
  commands: CorpusCommand[];
}

export interface ParityCase {
  name: string;
  seed: OutputData;
  batches: CorpusBatch[];
  expect?: Expectation;
  expectByRunner?: Partial<Record<RunnerName, Expectation>>;
}

export const CORPUS_ROOT = join(__dirname, '../../../fixtures/agent-commands');

const readJsonDir = <T>(dir: string): T[] =>
  existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as T)
    : [];

interface EvalFixture {
  id: string;
  seed: OutputData;
  reference: CorpusBatch[];
  referenceExpectByRunner?: Partial<Record<RunnerName, Expectation>>;
  /** Why this reference is not a parity case (e.g. it needs a browser-only host tool). */
  parityExcluded?: string;
}

/** Every eval reference is a parity case too (06 answer to 01-Q9). */
export const loadParityCases = (): ParityCase[] => [
  ...readJsonDir<ParityCase>(join(CORPUS_ROOT, 'cases')),
  ...readJsonDir<EvalFixture>(join(CORPUS_ROOT, 'evals')).filter((e) => e.parityExcluded === undefined).map((e) => ({
    name: `eval:${e.id}`,
    seed: e.seed,
    batches: e.reference,
    expectByRunner: e.referenceExpectByRunner,
  })),
];

export const expectationFor = (c: ParityCase, runner: RunnerName): Expectation =>
  c.expectByRunner?.[runner] ?? c.expect ?? 'ok';

export const goldenPath = (name: string): string => join(CORPUS_ROOT, 'goldens', `${name.replace(/[^a-zA-Z0-9_-]/g, '__')}.json`);

const explicitIds = (value: unknown, out: Set<string>): void => {
  if (Array.isArray(value)) {
    value.forEach((item) => explicitIds(item, out));

    return;
  }

  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;

    if (typeof record.id === 'string' && typeof record.type === 'string') {
      out.add(record.id);
    }

    explicitIds(record.children, out);
  }
};

/** Seed ids plus every `id` an insert spells out (06 05-Q1). Everything else is minted. */
export const callerChosenIds = (c: ParityCase): Set<string> => {
  const ids = new Set<string>(c.seed.blocks.map((b) => b.id).filter((id): id is string => id !== undefined));

  c.batches.forEach((batch) => batch.commands.forEach((command) => {
    if (command.name === 'block.insert') {
      explicitIds(command.args, ids);
    }
  }));

  return ids;
};
```

- [ ] **Step 5: Write `normalize.ts`**

```ts
// test/unit/agent/parity/normalize.ts
import type { OutputBlockData, OutputData } from '../../../../types';
import { outputBlocksToCanonicalSegments } from '../../../../src/shared/rich-text/block-data';
import { CURRENT_RICH_TEXT_FIELDS } from '../../../../src/shared/rich-text/fields';
import { htmlToSegmentsNode } from '../../../../src/view/rich-text-parse5';

export interface ParityDocument {
  blocks: OutputBlockData[];
  title?: OutputData['title'];
  icon?: OutputData['icon'];
}

/**
 * Tool-minted data with no pure normalize yet. Each entry leaves when its tool
 * ships ToolRuntime.normalize (06 C17, 01-Q11).
 */
export const TOOL_MINTED: Record<string, { reason: string; strip(data: Record<string, unknown>): Record<string, unknown> }> = {
  table: {
    reason: 'Table column and row ids are random until table normalize ships (06 C17).',
    strip: (data) => {
      const content = data.content;

      if (!Array.isArray(content)) {
        return data;
      }

      return {
        ...data,
        content: content.map((row: unknown) => (Array.isArray(row)
          ? row.map((cell: unknown) => {
            if (cell === null || typeof cell !== 'object') {
              return cell;
            }

            const { id: _id, rowId: _rowId, ...rest } = cell as Record<string, unknown>;

            return rest;
          })
          : row)),
      };
    },
  },
};

const richFields = (type: string): string[] =>
  Object.prototype.hasOwnProperty.call(CURRENT_RICH_TEXT_FIELDS, type) ? CURRENT_RICH_TEXT_FIELDS[type] : [];

const renameDeep = (value: unknown, names: Map<string, string>): unknown => {
  if (typeof value === 'string') {
    return names.get(value) ?? value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => renameDeep(item, names));
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renameDeep(v, names)]));
  }

  return value;
};

export const normalizeForParity = (doc: OutputData, keepIds: ReadonlySet<string>): ParityDocument => {
  const blocks = doc.blocks;
  const byId = new Map(blocks.filter((b) => b.id !== undefined).map((b) => [b.id as string, b]));
  const childrenOf = (block: OutputBlockData): OutputBlockData[] => {
    const listed = (block.content ?? []).map((id) => byId.get(id)).filter((b): b is OutputBlockData => b !== undefined);

    return listed.length > 0 ? listed : blocks.filter((b) => b.parent === block.id);
  };
  const ordered: Array<{ block: OutputBlockData; label: string }> = [];
  const walk = (block: OutputBlockData, label: string): void => {
    ordered.push({ block, label });
    childrenOf(block).forEach((child, index) => walk(child, `${label}.${index}`));
  };

  blocks.filter((b) => b.parent === undefined || b.parent === null).forEach((root, index) => walk(root, `b${index}`));

  const names = new Map<string, string>();

  ordered.forEach(({ block, label }) => {
    if (block.id !== undefined && !keepIds.has(block.id)) {
      names.set(block.id, label);
    }
  });

  const cleaned = ordered.map(({ block }) => {
    const { createdAt: _createdAt, lastEditedAt: _at, ...rest } = block;
    const minted = TOOL_MINTED[rest.type];
    const data = minted === undefined ? rest.data : minted.strip(rest.data as Record<string, unknown>);

    return renameDeep({ ...rest, data }, names) as OutputBlockData;
  });
  const canonical = outputBlocksToCanonicalSegments(cleaned, richFields, htmlToSegmentsNode);
  return {
    blocks: canonical,
    ...(doc.title !== undefined && { title: doc.title }),
    ...(doc.icon !== undefined && { icon: doc.icon }),
  };
};

export const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);

    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
};
```

The first normalizer case expects root labels `b1` for the second root because `p1` (a kept id) still takes position `b0`. That matches `ordered` above: every root gets a position label, kept ids just do not use theirs.

Execution ruling: also drop `createdAt` from parity comparisons. Editor insertion stamps creation time, while JSON insertion does not. Keep production creation metadata unchanged and compare `createdBy` and `lastEditedBy`. Add a test using both real insertion producers before changing the normalizer. This helper accepts coherent, acyclic hierarchies; partial or dangling hierarchies need a separate input-boundary decision.

- [ ] **Step 6: Run the test to verify it passes**

Run: `yarn test test/unit/agent/parity/normalize.test.ts`
Expected: PASS, 6 tests. If `CURRENT_RICH_TEXT_FIELDS` has no `toggle` entry, case 1's toggle text stays as given (already segments) and still matches.

- [ ] **Step 7: Write the starter cases**

Small enough to check by hand. Ids that matter are chosen with `id`. Example (write all eight with the same shape):

```json
// test/fixtures/agent-commands/cases/toggle-with-children.json
{
  "name": "toggle-with-children",
  "seed": { "blocks": [ { "id": "p1", "type": "paragraph", "data": { "text": [{ "text": "Intro" }] } } ] },
  "batches": [
    { "commands": [
      { "name": "block.insert", "args": {
        "id": "tg", "type": "toggle", "data": { "text": [{ "text": "FAQ" }] }, "position": { "after": "p1" },
        "children": [
          { "id": "q1", "type": "paragraph", "data": { "text": [{ "text": "Q1" }] } },
          { "id": "q2", "type": "paragraph", "data": { "text": [{ "text": "Q2" }] } }
        ] } }
    ] }
  ]
}
```

The other seven, one line each (seed + commands):

- `insert-paragraph`: empty seed; `block.insert { id: 'a', type: 'paragraph', data: { text: 'Hello' }, position: 'end' }`.
- `bold-range`: seed paragraph `p1` "quarterly report"; `text.format { id: 'p1', range: { find: 'quarterly' }, set: { bold: true } }`.
- `move-into-toggle`: seed toggle `tg` and paragraph `p2`; `block.move { id: 'p2', parentId: 'tg', position: 'end' }`.
- `delete-lifts-children`: seed toggle `tg` with child `c1`; `block.delete { id: 'tg' }` (children lift into the slot, 01 §5.1).
- `convert-to-quote`: seed paragraph `p1`; `block.convert { id: 'p1', type: 'quote' }`.
- `markdown-insert`: empty seed; `markdown.insert { markdown: '## Plan\n\n- a\n- b', position: 'end' }` (all ids minted, relabelled).
- `unknown-command`: seed paragraph; `{ name: 'nope.nothing', args: {} }`, `"expect": { "errorCode": "UNKNOWN_COMMAND" }`.

- [ ] **Step 8: Lint and commit**

```bash
node_modules/.bin/eslint test/unit/agent/parity/corpus.ts test/unit/agent/parity/normalize.ts test/unit/agent/parity/normalize.test.ts
git add test/unit/agent/parity/corpus.ts test/unit/agent/parity/normalize.ts test/unit/agent/parity/normalize.test.ts test/fixtures/agent-commands/normalizer-cases.json test/fixtures/agent-commands/cases test/fixtures/agent-commands/goldens/.gitkeep
git diff --cached --name-only
git commit -m "test(agent-parity): corpus format, loader and normalizer

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 7: The harness seam and the `json` runner with goldens

**Gated on:** 01's `createDocumentAgentSession` and `COMMANDS`; 02's `buildToolManifest`, `buildAgentContract`, `BUILT_IN_TOOL_RUNTIMES`, `validateAgainst`.

**Files:**
- Create: `test/unit/agent/harness.ts`
- Create: `test/unit/agent/parity/run-case.ts`
- Create: `test/unit/agent/parity/json-runner.test.ts`
- Create: `test/unit/agent/parity/run-case.test.ts` (no dependency on 01–04; write it first)
- Create: `test/fixtures/agent-commands/goldens/*.json` (generated, then reviewed by a person)

**Interfaces:**
- Consumes: Task 6 (`loadParityCases`, `expectationFor`, `goldenPath`, `callerChosenIds`, `normalizeForParity`, `stableStringify`); `diffOutputData` (`src/view/diff-output-data.ts:132`); `blokDocumentSchema` (`src/view/document-schema.ts:83`).
- Produces:

```ts
// harness.ts — the only module here that imports plan 01–04 code.
export const TEST_ACTOR: { id: 'agent-test'; name: 'Parity'; kind: 'agent' };
export const nodeContract(runtime?: 'node' | 'node-live'): AgentContract;
export const openJsonSession(seed: OutputData): AgentSession & { output(): OutputData };
export const validateSaved(doc: OutputData): string[];          // [] = valid against blokDocumentSchema

// run-case.ts
export interface SessionLike { execute(batch: CorpusBatch): Promise<{ ok: boolean; error?: { code: string } }> }
export const runCorpusCase(session: SessionLike, c: ParityCase): Promise<Expectation>;
export interface GoldenFile { reviewed: string | false; document: ParityDocument }
export const readGolden(name: string): GoldenFile | null;
export const compareToGolden(c: ParityCase, actual: ParityDocument): void;   // vitest expect inside
```

A golden is `{ "reviewed": false | "<who checked it>", "document": <ParityDocument> }`. `BLOK_UPDATE_GOLDENS=1` writes only missing or unreviewed goldens, always with `reviewed: false`, and never overwrites a reviewed one. Comparing against an unreviewed golden fails. So a wrong applier cannot bless its own output: a person must read the file and set `reviewed` (Review Focus 3).

- [ ] **Step 1: Read what 01 and 02 actually exported**

The names are settled by the cross-plan pass (read from 01's and 02's plans): `createHeadlessAgentSetup({ runtime })` and `loadStoredDocument(doc, richTextFieldsFor)` from `src/view/agent-runtime.ts` (01 Tasks 19, 21) give the contract, the runtimes and the ports; there is no `HEADLESS_PORTS` constant. `validateAgainst(schema, value)` returns `SchemaProblem[]` (`{ path, message }`, empty = valid; 02 Task 2). Open those two files on `main` and confirm the exports before Step 3. Only `harness.ts` changes if they moved.

- [ ] **Step 2: Write the failing golden-guard test (Review Focus 3)**

```ts
// test/unit/agent/parity/run-case.test.ts
// @vitest-environment node
import { existsSync, rmSync, writeFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { goldenPath } from './corpus';
import type { ParityCase } from './corpus';
import { compareToGolden, readGolden } from './run-case';

const c: ParityCase = { name: 'zz-golden-guard-test', seed: { blocks: [] }, batches: [] };
const doc = { blocks: [] };

describe('golden guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();

    if (existsSync(goldenPath(c.name))) {
      rmSync(goldenPath(c.name));
    }
  });

  it('writes a new golden as unreviewed', () => {
    vi.stubEnv('BLOK_UPDATE_GOLDENS', '1');
    compareToGolden(c, doc);

    expect(readGolden(c.name)).toEqual({ reviewed: false, document: doc });
  });

  it('fails a comparison against an unreviewed golden', () => {
    writeFileSync(goldenPath(c.name), JSON.stringify({ reviewed: false, document: doc }));

    expect(() => compareToGolden(c, doc)).toThrow(/not reviewed/);
  });

  it('refuses to regenerate a reviewed golden', () => {
    writeFileSync(goldenPath(c.name), JSON.stringify({ reviewed: 'ana', document: doc }));
    vi.stubEnv('BLOK_UPDATE_GOLDENS', '1');

    expect(() => compareToGolden(c, { blocks: [{ id: 'x', type: 'paragraph', data: {} }] })).toThrow(/edited by hand/);
  });

  it('passes against a reviewed, equal golden', () => {
    writeFileSync(goldenPath(c.name), JSON.stringify({ reviewed: 'ana', document: doc }));

    expect(() => compareToGolden(c, doc)).not.toThrow();
  });
});
```

Run: `yarn test test/unit/agent/parity/run-case.test.ts`
Expected: FAIL, cannot resolve `./run-case`. It passes after Step 3 writes `run-case.ts`; run it again then.

- [ ] **Step 2b: Write the failing runner test**

```ts
// test/unit/agent/parity/json-runner.test.ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openJsonSession, validateSaved } from '../harness';
import { callerChosenIds, expectationFor, loadParityCases } from './corpus';
import { normalizeForParity } from './normalize';
import { compareToGolden, runCorpusCase } from './run-case';

describe.each(loadParityCases())('json runner: $name', (c) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches its expectation, the saved schema and the golden', async () => {
    const session = openJsonSession(c.seed);
    const outcome = await runCorpusCase(session, c);

    expect(outcome).toEqual(expectationFor(c, 'json'));
    expect(validateSaved(session.output())).toEqual([]);
    compareToGolden(c, normalizeForParity(session.output(), callerChosenIds(c)));
  });
});
```

- [ ] **Step 3: Write `harness.ts` and `run-case.ts`**

```ts
// test/unit/agent/harness.ts
import type { OutputData } from '../../../types';
import type { AgentActor, AgentContract, AgentSession } from '../../../types/agent';
import { createDocumentAgentSession } from '../../../src/shared/agent';
import { validateAgainst } from '../../../src/shared/schema/validate';
import { createHeadlessAgentSetup, loadStoredDocument } from '../../../src/view/agent-runtime';
import { blokDocumentSchema } from '../../../src/view/document-schema';

export const TEST_ACTOR: AgentActor = { id: 'agent-test', name: 'Parity', kind: 'agent' };

// 01 Task 21: built-in snapshot (02 Task 27) + runtimes (02 Task 13) + COMMANDS (01 Task 3) + headless ports (01 Task 19).
export const nodeSetup = (runtime: 'node' | 'node-live' = 'node') => createHeadlessAgentSetup({ runtime });

export const nodeContract = (runtime: 'node' | 'node-live' = 'node'): AgentContract => nodeSetup(runtime).contract;

export const openJsonSession = (seed: OutputData, actor: AgentActor = TEST_ACTOR): AgentSession & { output(): OutputData } => {
  const setup = nodeSetup('node');

  return createDocumentAgentSession({
    document: loadStoredDocument(structuredClone(seed), setup.richTextFieldsFor),
    tools: setup.tools,
    contract: setup.contract,
    actor,
    ports: setup.ports,
  });
};

// validateAgainst returns SchemaProblem[] (02 Task 2); empty means valid.
export const validateSaved = (doc: OutputData): string[] =>
  validateAgainst(blokDocumentSchema as unknown as Record<string, unknown>, doc).map((e) => `${e.path}: ${e.message}`);
```

```ts
// test/unit/agent/parity/run-case.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { expect } from 'vitest';

import type { OutputData } from '../../../../types';
import { diffOutputData } from '../../../../src/view/diff-output-data';
import type { CorpusBatch, Expectation, ParityCase } from './corpus';
import { goldenPath } from './corpus';
import type { ParityDocument } from './normalize';
import { stableStringify } from './normalize';

export interface SessionLike {
  execute(batch: CorpusBatch): Promise<{ ok: boolean; error?: { code: string } }>;
}

/** Runs batches in order and stops at the first refused one. */
export const runCorpusCase = async (session: SessionLike, c: ParityCase): Promise<Expectation> => {
  for (const batch of c.batches) {
    const result = await session.execute(batch);

    if (!result.ok) {
      return { errorCode: result.error?.code ?? 'MISSING_ERROR' };
    }
  }

  return 'ok';
};

export interface GoldenFile {
  reviewed: string | false;
  document: ParityDocument;
}

export const readGolden = (name: string): GoldenFile | null => {
  const path = goldenPath(name);

  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as GoldenFile) : null;
};

/** The first golden comes from the code under test, so only a person may mark it reviewed. */
export const compareToGolden = (c: ParityCase, actual: ParityDocument): void => {
  const existing = readGolden(c.name);

  if (process.env.BLOK_UPDATE_GOLDENS === '1') {
    expect(existing?.reviewed ?? false, `${c.name}: a reviewed golden is edited by hand, never regenerated`).toBe(false);
    writeFileSync(goldenPath(c.name), `${JSON.stringify({ reviewed: false, document: actual }, null, 2)}\n`);

    return;
  }

  expect(existing, `No golden for ${c.name}. Run BLOK_UPDATE_GOLDENS=1 on the json runner, then review it.`).not.toBeNull();
  expect(existing?.reviewed, `${c.name}: golden not reviewed. Check it by hand, then set "reviewed" to your name.`).not.toBe(false);

  const golden = (existing as GoldenFile).document;

  if (stableStringify(actual) !== stableStringify(golden)) {
    expect(diffOutputData(golden as OutputData, actual as OutputData), `${c.name} differs from its golden`).toEqual({
      added: [], removed: [], changed: [], moved: [],
    });
  }

  expect(stableStringify(actual)).toBe(stableStringify(golden));
};
```

The `diffOutputData` print comes first so a mismatch shows block-level changes, not two JSON blobs (05 §3.4). It does not compare `page`; the final `stableStringify` assertion does.

- [ ] **Step 4: Run both to verify**

Run: `yarn test test/unit/agent/parity/run-case.test.ts`
Expected: PASS, 4 tests.
Run: `yarn test test/unit/agent/parity/json-runner.test.ts`
Expected: FAIL with "No golden for <name>" for every case.

- [ ] **Step 5: Generate the goldens**

Run: `BLOK_UPDATE_GOLDENS=1 yarn test test/unit/agent/parity/json-runner.test.ts`
Expected: PASS; one file per case under `test/fixtures/agent-commands/goldens/`.

- [ ] **Step 6: Review every golden by hand, then mark it**

The goldens come from the code under test, so a wrong applier writes a wrong golden. For each file, check against the case, then set `"reviewed"` to your name. Check: `toggle-with-children` has `tg` with `content: ["q1","q2"]` and both children have `parent: "tg"`; `bold-range` has segments `[{text:"quarterly",marks:{bold:true}},{text:" report"}]`; `delete-lifts-children` has `c1` at the root where `tg` was; `move-into-toggle` has `p2` as the last child of `tg`; every touched block has `lastEditedBy: "agent-test"` and untouched seed blocks do not (06 C3). Any mismatch is a bug report for 01 with the case name; leave that golden `reviewed: false` (the test stays red) and do not commit it.

- [ ] **Step 7: Run again without the flag**

Run: `yarn test test/unit/agent/parity/json-runner.test.ts`
Expected: PASS.

- [ ] **Step 8: Lint and commit**

```bash
node_modules/.bin/eslint test/unit/agent/harness.ts test/unit/agent/parity/run-case.ts test/unit/agent/parity/run-case.test.ts test/unit/agent/parity/json-runner.test.ts
git add test/unit/agent/harness.ts test/unit/agent/parity/run-case.ts test/unit/agent/parity/run-case.test.ts test/unit/agent/parity/json-runner.test.ts test/fixtures/agent-commands/goldens
git diff --cached --name-only
git commit -m "test(agent-parity): json runner, harness seam and reviewed goldens

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The `store` runner

**Gated on:** 01's `createStoreAgentSession` and an answer to 05 Q14 (does `DocumentStore.toJSON()` map one-to-one onto `OutputData` blocks, including `lastEditedBy`?). **Unverified** today.

**Files:**
- Modify: `test/unit/agent/harness.ts` (append `openStoreSession`, `storeToOutput`)
- Create: `test/unit/agent/parity/store-runner.test.ts`

**Interfaces:**
- Consumes: `DocumentStore` (`src/components/modules/yjs/document-store.ts:183` constructor, `fromJSON` `:239`, `pageFromJSON` `:227`, `toJSON` `:353`, `page` getter `:222`), `YBlockSerializer` (`src/components/modules/yjs/serializer`), `readPageFields` (`src/components/modules/yjs/page-fields.ts:25`). The bare construction `new DocumentStore(new YBlockSerializer())` is the one at `src/components/modules/collaboration/headless-offline-page.ts:31`.
- Produces: `openStoreSession(seed: OutputData): AgentSession & { output(): OutputData }`.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/agent/parity/store-runner.test.ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openStoreSession } from '../harness';
import { callerChosenIds, expectationFor, loadParityCases } from './corpus';
import { normalizeForParity } from './normalize';
import { compareToGolden, runCorpusCase } from './run-case';

describe.each(loadParityCases())('store runner: $name', (c) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches the json golden', async () => {
    const session = openStoreSession(c.seed);
    const outcome = await runCorpusCase(session, c);

    expect(outcome).toEqual(expectationFor(c, 'store'));

    // A runner that refuses where json succeeds has no golden to match.
    if (outcome === 'ok' && expectationFor(c, 'json') === 'ok') {
      compareToGolden(c, normalizeForParity(session.output(), callerChosenIds(c)));
    }
  });
});
```

The `store` runner never writes goldens: run it without `BLOK_UPDATE_GOLDENS`.

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test test/unit/agent/parity/store-runner.test.ts`
Expected: FAIL, "openStoreSession is not exported".

- [ ] **Step 3: Append to `harness.ts`**

```ts
import { createStoreAgentSession } from '../../../src/components/modules/agent/store-session';
import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import { readPageFields } from '../../../src/components/modules/yjs/page-fields';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import { htmlToSegmentsNode } from '../../../src/view/rich-text-parse5';

/** 05 Q14, answered by 01 D-5: toJSON maps one-to-one; rich fields stay HTML here and the normalizer canonicalizes them. */
const storeToOutput = (store: DocumentStore): OutputData => ({
  ...readPageFields(store.page),   // flat title / icon (01 D-1)
  blocks: store.toJSON() as unknown as OutputData['blocks'],
});

export const openStoreSession = (seed: OutputData): AgentSession & { output(): OutputData } => {
  const setup = nodeSetup('node-live');
  // Node has no DOM: the default htmlToSegmentsDom would throw (04 facts, serializer.ts:345).
  const store = new DocumentStore(new YBlockSerializer({ htmlToSegments: htmlToSegmentsNode, richTextFieldsFor: setup.richTextFieldsFor }));
  const copy = loadStoredDocument(structuredClone(seed), setup.richTextFieldsFor);

  store.fromJSON(copy.blocks as Parameters<DocumentStore['fromJSON']>[0]);
  store.pageFromJSON({ title: copy.title, icon: copy.icon });

  const session = createStoreAgentSession({
    store,
    tools: setup.tools,
    contract: setup.contract,
    actor: TEST_ACTOR,
    ports: setup.ports,
    richTextFieldsFor: setup.richTextFieldsFor,
  });

  return Object.assign(session, { output: () => storeToOutput(store) });
};
```

01 ships no named `DocumentStore` → `OutputData` converter; 01 D-5 says none is needed beyond rich fields and the page fields. `readPageFields` returns only the keys that are set (`page-fields.ts:25-33`, verified), and `pageFromJSON({ title, icon })` deletes a key for `undefined` (`document-store.ts:226-231`, `page-fields.ts:35-40`).

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test test/unit/agent/parity/store-runner.test.ts`
Expected: PASS. If it fails only on `// @vitest-environment node` (a DOM global missing inside `YBlockSerializer`), that is a finding: report it to 01 (StoreApplier must run in Node, 04 §3.1) rather than switching this file to jsdom.

- [ ] **Step 5: Lint and commit**

```bash
node_modules/.bin/eslint test/unit/agent/harness.ts test/unit/agent/parity/store-runner.test.ts
git add test/unit/agent/harness.ts test/unit/agent/parity/store-runner.test.ts
git diff --cached --name-only
git commit -m "test(agent-parity): store runner over a bare DocumentStore

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Page-field and availability cases

**Gated on:** 01's `doc.setTitle`, `doc.setIcon` (01 Task 13), the flat `OutputData.title` / `icon` (already on `main`, 01 D-1), `history.undo` (01 Task 16; alone in its batch, 01 D-3).

**Files:**
- Create: `test/fixtures/agent-commands/cases/doc-set-title.json`, `doc-change-title.json`, `doc-clear-title.json`, `doc-set-icon.json`, `doc-clear-icon.json`, `history-undo.json`, `history-redo.json`
- Create: the matching goldens (generated in Step 3, reviewed in Step 4)

**Interfaces:**
- Consumes: Tasks 6–8.
- Produces: corpus coverage of `doc.setTitle`, `doc.setIcon`, `history.undo`, `history.redo`.

- [ ] **Step 1: Write the cases**

```json
// test/fixtures/agent-commands/cases/doc-change-title.json
{
  "name": "doc-change-title",
  "seed": { "blocks": [], "title": "Old" },
  "batches": [ { "commands": [ { "name": "doc.setTitle", "args": { "title": "New" } } ] } ]
}
```

- `doc-set-title`: seed `{ blocks: [] }`; `doc.setTitle { title: 'Q3 plan' }`.
- `doc-clear-title`: seed page title `"Old"`; `doc.setTitle { title: '' }` (`''` clears, 01 §5.1).
- `doc-set-icon`: seed `{ blocks: [] }`; `doc.setIcon { icon: { type: 'emoji', value: '📅' } }` (`PageIcon`, `types/tools/page.d.ts:13`).
- `doc-clear-icon`: seed with that icon; `doc.setIcon { icon: null }`.
- `history-undo`:

```json
{
  "name": "history-undo",
  "seed": { "blocks": [ { "id": "p1", "type": "paragraph", "data": { "text": [{ "text": "keep" }] } } ] },
  "batches": [
    { "commands": [ { "name": "block.insert", "args": { "id": "a", "type": "paragraph", "data": { "text": "temp" }, "position": "end" } } ] },
    { "commands": [ { "name": "history.undo", "args": {} } ] }
  ],
  "expectByRunner": {
    "jint": { "errorCode": "COMMAND_UNAVAILABLE" },
    "store": { "errorCode": "COMMAND_UNAVAILABLE" },
    "room": { "errorCode": "COMMAND_UNAVAILABLE" }
  }
}
```

- `history-redo`: same, plus a third batch `history.redo`; same `expectByRunner` (06 R3-1, D6).

- [ ] **Step 2: Run the json runner to see the new cases fail**

Run: `yarn test test/unit/agent/parity/json-runner.test.ts`
Expected: FAIL, "No golden for doc-set-title" (and the other six).

- [ ] **Step 3: Generate goldens**

Run: `BLOK_UPDATE_GOLDENS=1 yarn test test/unit/agent/parity/json-runner.test.ts`
Expected: PASS.

- [ ] **Step 4: Review by hand and set `reviewed`**

`doc-change-title` golden has `page.title: "New"`. `doc-clear-title` and `doc-clear-icon` have no `title` / `icon` key (absent when empty, 06 §10.1 A). `history-undo` golden equals the seed (block `a` gone). `history-redo` golden has block `a` again.

- [ ] **Step 5: Run both Node runners**

Run: `yarn test test/unit/agent/parity/json-runner.test.ts`, then `yarn test test/unit/agent/parity/store-runner.test.ts`
Expected: both PASS; the store runner reports `COMMAND_UNAVAILABLE` for the two history cases, as declared.

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/agent-commands/cases test/fixtures/agent-commands/goldens
git diff --cached --name-only
git commit -m "test(agent-parity): page title/icon and history availability cases

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Server bundle size budget

**Gated on:** 01's agent code in the Jint bundle (`agentExecute` and `manifest` ops). The budget is set from that first build (05 §3.2.2).

**Files:**
- Modify: `test/unit/scripts/build-server-runtime.test.ts` (append one `it`)
- Create: `test/unit/scripts/server-runtime-size-budget.json`

**Interfaces:**
- Consumes: `buildServerRuntime(outDir): Promise<string>` (`scripts/build-server-runtime.mjs`, used at `test/unit/scripts/build-server-runtime.test.ts:9,25`).
- Produces: `{ "maxBytes": number, "measuredBytes": number, "measuredAt": string, "reason": string }`.

- [ ] **Step 1: Append the failing case**

```ts
// append inside describe('buildServerRuntime', …) in test/unit/scripts/build-server-runtime.test.ts
import { statSync } from 'node:fs';

it('stays within the checked-in size budget', async () => {
  const budgetPath = join(__dirname, 'server-runtime-size-budget.json');

  expect(existsSync(budgetPath), 'Create server-runtime-size-budget.json from a measured build').toBe(true);

  const budget = JSON.parse(readFileSync(budgetPath, 'utf8')) as { maxBytes: number };
  const size = statSync(await buildServerRuntime(outDir)).size;

  // Every Jint engine parses this bundle at startup (packages/server/README.md:150).
  expect(size, `bundle is ${size} bytes; budget ${budget.maxBytes}. Raising it is a reviewed edit.`).toBeLessThanOrEqual(budget.maxBytes);
});
```

Merge `statSync` into the existing `node:fs` import at line 2.

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test test/unit/scripts/build-server-runtime.test.ts`
Expected: FAIL, "Create server-runtime-size-budget.json from a measured build".

- [ ] **Step 3: Measure and write the budget**

Run: `node -e "import('./scripts/build-server-runtime.mjs').then(async m => { const fs = await import('node:fs'); const os = await import('node:os'); const d = fs.mkdtempSync(os.tmpdir() + '/srt-'); const p = await m.buildServerRuntime(d); console.log(fs.statSync(p).size); })"`
Expected: a byte count. The pre-agent bundle was 689,655 bytes (05 §2.4; build commit unverified).

Write (with the real numbers):

```json
{
  "measuredBytes": <measured>,
  "maxBytes": <measured rounded up to the next 10,000, plus 5%>,
  "measuredAt": "<commit sha>",
  "reason": "First build with the agent planner, contract and ports (06 §7.1). The 5% margin absorbs small fixes; anything larger is a reviewed raise. Pre-agent size was 689,655 bytes."
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test test/unit/scripts/build-server-runtime.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
node_modules/.bin/eslint test/unit/scripts/build-server-runtime.test.ts
git add test/unit/scripts/build-server-runtime.test.ts test/unit/scripts/server-runtime-size-budget.json
git diff --cached --name-only
git commit -m "test(server-runtime): bundle size budget

Measured <n> bytes with the agent code (was 689,655 before it).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Checkpoint 2

- [ ] Run each file alone: `normalize.test.ts`, `json-runner.test.ts`, `store-runner.test.ts`, `build-server-runtime.test.ts`. Expected: PASS.
- [ ] `yarn lint`. Expected: exit 0.
- [ ] `git pull --rebase && git push`; `git status` shows up to date.
- [ ] Tell 01's executor: `test/unit/agent/applier-parity.test.ts` imports `loadParityCases`, `runCorpusCase`, `normalizeForParity`, `callerChosenIds`, `compareToGolden` from `test/unit/agent/parity/`; it adds only the jsdom `EditorApplier` runner.

---

# Phase 3 — Browser and C# runners

### Task 11: The `editor` runner (Playwright)

**Gated on:** 03's `editor.agent.begin({ agent })` (03 Task 9) and the editor `save()` carrying the flat `title` / `icon` (already on `main` since `8d86c376`; 01 D-1).

**Files:**
- Create: `test/playwright/tests/agent/command-parity.spec.ts`

**Interfaces:**
- Consumes: `gotoTestPage`, `expect`, `test` from `test/playwright/tests/helpers/shared-page.ts` (pattern in `rich-text-segments.spec.ts:1-25`); Task 6–7 helpers imported from `../../../unit/agent/parity/*` (Playwright specs already import from `src/`, e.g. `drag-drop.spec.ts:5`).
- Produces: one Playwright test per corpus case in the `chromium-default` project (a spec named in no project list lands there, `playwright.config.ts:243-251`).

- [ ] **Step 1: Write the spec**

```ts
// test/playwright/tests/agent/command-parity.spec.ts
import type { Blok, OutputData } from '@/types';

import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { callerChosenIds, expectationFor, loadParityCases } from '../../../unit/agent/parity/corpus';
import type { CorpusBatch } from '../../../unit/agent/parity/corpus';
import { goldenPath } from '../../../unit/agent/parity/corpus';
import { normalizeForParity, stableStringify } from '../../../unit/agent/parity/normalize';
import { existsSync, readFileSync } from 'node:fs';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

for (const c of loadParityCases()) {
  test(`editor runner: ${c.name}`, async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');

    const run = await page.evaluate(async ({ seed, batches }: { seed: OutputData; batches: CorpusBatch[] }) => {
      document.getElementById('blok')?.remove();
      const holder = document.createElement('div');

      holder.id = 'blok';
      holder.setAttribute('data-blok-testid', 'blok');
      document.body.appendChild(holder);

      const blok = new window.Blok({ holder: 'blok', data: seed });

      window.blokInstance = blok;
      await blok.isReady;

      const turn = blok.agent.begin({ agent: { id: 'agent-test', name: 'Parity' } });
      let error: string | null = null;

      for (const batch of batches) {
        const result = await turn.execute(batch);

        if (!result.ok) {
          error = result.error.code;
          break;
        }
      }

      turn.end();

      return { error, saved: await blok.save() };
    }, { seed: c.seed, batches: c.batches });

    expect(run.error === null ? 'ok' : { errorCode: run.error }).toEqual(expectationFor(c, 'editor'));

    if (run.error === null && expectationFor(c, 'json') === 'ok') {
      const path = goldenPath(c.name);

      expect(existsSync(path)).toBe(true);
      expect(stableStringify(normalizeForParity(run.saved, callerChosenIds(c))))
        .toBe(stableStringify(JSON.parse(readFileSync(path, 'utf8')).document));
    }
  });
}
```

- [ ] **Step 2: Run it**

Run: `yarn e2e test/playwright/tests/agent/command-parity.spec.ts --project=chromium-default`
Expected: PASS for every case. A failure here and a pass on `json` is a real `EditorApplier` divergence: report it to 01 with the case name. Each test must finish inside the 15 s Playwright timeout (`playwright.config.ts:214`).

- [ ] **Step 3: Run one case by name to confirm `-g` filtering works**

Run: `yarn e2e test/playwright/tests/agent/command-parity.spec.ts --project=chromium-default -g "editor runner: bold-range"`
Expected: 1 passed.

- [ ] **Step 4: Lint and commit**

```bash
node_modules/.bin/eslint test/playwright/tests/agent/command-parity.spec.ts
git add test/playwright/tests/agent/command-parity.spec.ts
git diff --cached --name-only
git commit -m "test(agent-parity): editor runner in the browser

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: C# corpus reader, normalizer, and the `jint` runner

**Gated on:** 01's C# `IBlokAgentExecutor.ExecuteAsync` (06 §7.3).

**Files:**
- Create: `packages/server/dotnet/Blok.Server.Tests/Agent/AgentParityCorpus.cs`
- Create: `packages/server/dotnet/Blok.Server.Tests/Agent/AgentParityNormalizer.cs`
- Create: `packages/server/dotnet/Blok.Server.Tests/Agent/AgentParityNormalizerTests.cs`
- Create: `packages/server/dotnet/Blok.Server.Tests/Agent/JintAgentParityTests.cs`

**Interfaces:**
- Consumes: the walk-up root lookup pattern of `Blok.Server.Tests/Collab/RichTextFixtures.cs:34-53`; `RichText.IsRichText(AnyArray)`, `RichText.Canonicalize(IEnumerable<object?>)`, `RichText.ToJson(AnyArray)` (`Blok.Server/Collab/RichText.cs:47,65,266`); `JsJson.Parse` (used at `RichTextFixtures.cs:25`); `JintBlokRuntime.FromEmbeddedResource(poolSize: 1)` (`Runtime/JintBlokRuntimeTests.cs:13`); `IBlokAgentExecutor.ExecuteAsync(documentJson, batchJson, BlokAgentActor, options, ct)` → `BlokAgentExecution(ResultJson, DocumentJson, Revision)` (06 §7.3).
- Produces:

```csharp
internal sealed record ParityCaseData(string Name, JsonObject Seed, IReadOnlyList<JsonObject> Batches, JsonObject? Expect, JsonObject? ExpectByRunner);
internal static class AgentParityCorpus
{
  internal static IReadOnlyList<ParityCaseData> Load();
  internal static TheoryData<string> Names();
  internal static ParityCaseData Get(string name);
  internal static string? ExpectedError(ParityCaseData c, string runner);   // null = ok
  internal static ISet<string> CallerChosenIds(ParityCaseData c);
  internal static JsonNode? Golden(string name);
}
internal static class AgentParityNormalizer
{
  internal static JsonObject Normalize(JsonObject document, ISet<string> keepIds);
  internal static string Stable(JsonNode? node);
}
```

- [ ] **Step 1: Write the failing normalizer lockstep test**

```csharp
// packages/server/dotnet/Blok.Server.Tests/Agent/AgentParityNormalizerTests.cs
using System.Text.Json.Nodes;
using Xunit;

namespace Blok.Server.Tests.Agent;

/// <summary>
/// The C# normalizer must agree with test/unit/agent/parity/normalize.ts on
/// test/fixtures/agent-commands/normalizer-cases.json, or C# parity compares
/// against a golden it cannot reproduce.
/// </summary>
public sealed class AgentParityNormalizerTests
{
  public static TheoryData<string> Cases()
  {
    var data = new TheoryData<string>();

    foreach (var item in CasesFile())
    {
      if (item!["tsOnly"] is null)
      {
        data.Add(item["name"]!.GetValue<string>());
      }
    }

    return data;
  }

  [Theory]
  [MemberData(nameof(Cases))]
  public void MatchesTheTypeScriptNormalizer(string name)
  {
    var item = CasesFile().First(c => c!["name"]!.GetValue<string>() == name)!;
    var keep = item["keepIds"]!.AsArray().Select(n => n!.GetValue<string>()).ToHashSet();

    var actual = AgentParityNormalizer.Normalize(item["input"]!.AsObject(), keep);

    Assert.Equal(AgentParityNormalizer.Stable(item["expected"]), AgentParityNormalizer.Stable(actual));
  }

  private static JsonArray CasesFile()
  {
    return JsonNode.Parse(File.ReadAllText(Path.Combine(AgentParityCorpus.Root, "normalizer-cases.json")))!["cases"]!.AsArray();
  }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~AgentParityNormalizerTests"`
Expected: build FAIL, "The name 'AgentParityNormalizer' does not exist".

- [ ] **Step 3: Write `AgentParityCorpus.cs`**

```csharp
// packages/server/dotnet/Blok.Server.Tests/Agent/AgentParityCorpus.cs
using System.Text.Json.Nodes;
using Xunit;

namespace Blok.Server.Tests.Agent;

internal sealed record ParityCaseData(
    string Name,
    JsonObject Seed,
    IReadOnlyList<JsonObject> Batches,
    JsonObject? Expect,
    JsonObject? ExpectByRunner);

/// <summary>Reads test/fixtures/agent-commands, the corpus the TS runners read.</summary>
internal static class AgentParityCorpus
{
  private const string RelativeRoot = "test/fixtures/agent-commands";

  private static readonly Lazy<string> RootPath = new(LocateRoot);
  private static readonly Lazy<IReadOnlyList<ParityCaseData>> Cases = new(LoadAll);

  internal static string Root => RootPath.Value;

  internal static IReadOnlyList<ParityCaseData> Load() => Cases.Value;

  internal static TheoryData<string> Names()
  {
    var data = new TheoryData<string>();

    foreach (var c in Load())
    {
      data.Add(c.Name);
    }

    return data;
  }

  internal static ParityCaseData Get(string name) => Load().First(c => c.Name == name);

  internal static string? ExpectedError(ParityCaseData c, string runner)
  {
    var expectation = c.ExpectByRunner?[runner] ?? c.Expect;

    return expectation?["errorCode"]?.GetValue<string>();
  }

  internal static ISet<string> CallerChosenIds(ParityCaseData c)
  {
    var ids = new HashSet<string>();

    foreach (var block in c.Seed["blocks"]!.AsArray())
    {
      if (block?["id"] is JsonValue id)
      {
        ids.Add(id.GetValue<string>());
      }
    }

    foreach (var batch in c.Batches)
    {
      foreach (var command in batch["commands"]!.AsArray())
      {
        if (command!["name"]!.GetValue<string>() == "block.insert")
        {
          CollectIds(command["args"], ids);
        }
      }
    }

    return ids;
  }

  internal static JsonNode? Golden(string name)
  {
    var file = Path.Combine(Root, "goldens", $"{System.Text.RegularExpressions.Regex.Replace(name, "[^a-zA-Z0-9_-]", "__")}.json");

    return File.Exists(file) ? JsonNode.Parse(File.ReadAllText(file))?["document"] : null;
  }

  private static void CollectIds(JsonNode? node, HashSet<string> ids)
  {
    if (node is JsonArray array)
    {
      foreach (var item in array)
      {
        CollectIds(item, ids);
      }
    }
    else if (node is JsonObject obj)
    {
      if (obj["id"] is JsonValue id && obj["type"] is JsonValue)
      {
        ids.Add(id.GetValue<string>());
      }

      CollectIds(obj["children"], ids);
    }
  }

  private static IReadOnlyList<ParityCaseData> LoadAll()
  {
    var list = new List<ParityCaseData>();

    foreach (var file in Directory.GetFiles(Path.Combine(Root, "cases"), "*.json").Order(StringComparer.Ordinal))
    {
      var json = JsonNode.Parse(File.ReadAllText(file))!.AsObject();
      list.Add(new ParityCaseData(
          json["name"]!.GetValue<string>(),
          json["seed"]!.AsObject(),
          json["batches"]!.AsArray().Select(b => b!.AsObject()).ToList(),
          json["expect"] as JsonObject,
          json["expectByRunner"] as JsonObject));
    }

    var evals = Path.Combine(Root, "evals");

    if (Directory.Exists(evals))
    {
      foreach (var file in Directory.GetFiles(evals, "*.json").Order(StringComparer.Ordinal))
      {
        var json = JsonNode.Parse(File.ReadAllText(file))!.AsObject();

        if (json["parityExcluded"] is not null)
        {
          continue;
        }

        list.Add(new ParityCaseData(
            $"eval:{json["id"]!.GetValue<string>()}",
            json["seed"]!.AsObject(),
            json["reference"]!.AsArray().Select(b => b!.AsObject()).ToList(),
            null,
            json["referenceExpectByRunner"] as JsonObject));
      }
    }

    return list;
  }

  private static string LocateRoot()
  {
    var directory = new DirectoryInfo(AppContext.BaseDirectory);

    for (var depth = 0; directory is not null && depth < 12; depth++)
    {
      var candidate = Path.Combine(directory.FullName, RelativeRoot);

      if (File.Exists(Path.Combine(candidate, "normalizer-cases.json")))
      {
        return candidate;
      }

      directory = directory.Parent;
    }

    throw new DirectoryNotFoundException($"agent corpus not found above {AppContext.BaseDirectory}");
  }
}
```

A JSON string `"expect": "ok"` makes `c.Expect` null (`as JsonObject`), which reads as "ok". That matches the TS default.

- [ ] **Step 4: Write `AgentParityNormalizer.cs`**

```csharp
// packages/server/dotnet/Blok.Server.Tests/Agent/AgentParityNormalizer.cs
using System.Text.Json.Nodes;
using Blok.Server.Collab;
using Blok.Server.Yjs;

namespace Blok.Server.Tests.Agent;

/// <summary>C# twin of test/unit/agent/parity/normalize.ts. Pinned by normalizer-cases.json.</summary>
internal static class AgentParityNormalizer
{
  internal static JsonObject Normalize(JsonObject document, ISet<string> keepIds)
  {
    var blocks = document["blocks"]!.AsArray().Select(b => b!.AsObject()).ToList();
    var byId = blocks.Where(b => b["id"] is not null).ToDictionary(b => b["id"]!.GetValue<string>());
    var ordered = new List<(JsonObject Block, string Label)>();

    void Walk(JsonObject block, string label)
    {
      ordered.Add((block, label));
      var listed = (block["content"] as JsonArray)?.Select(id => byId.GetValueOrDefault(id!.GetValue<string>())).OfType<JsonObject>().ToList()
          ?? new List<JsonObject>();
      var children = listed.Count > 0
          ? listed
          : blocks.Where(b => b["parent"]?.GetValue<string>() == block["id"]?.GetValue<string>()).ToList();

      for (var i = 0; i < children.Count; i++)
      {
        Walk(children[i], $"{label}.{i}");
      }
    }

    var roots = blocks.Where(b => b["parent"] is null).ToList();

    for (var i = 0; i < roots.Count; i++)
    {
      Walk(roots[i], $"b{i}");
    }

    var names = ordered
        .Where(o => o.Block["id"] is not null && !keepIds.Contains(o.Block["id"]!.GetValue<string>()))
        .ToDictionary(o => o.Block["id"]!.GetValue<string>(), o => o.Label);
    var output = new JsonArray();

    foreach (var (block, _) in ordered)
    {
      var copy = block.DeepClone().AsObject();
      copy.Remove("lastEditedAt");

      if (copy["type"]?.GetValue<string>() == "table" && copy["data"]?["content"] is JsonArray rows)
      {
        foreach (var cell in rows.OfType<JsonArray>().SelectMany(r => r).OfType<JsonObject>())
        {
          cell.Remove("id");
          cell.Remove("rowId");
        }
      }

      output.Add(Canonical(Rename(copy, names)));
    }

    var result = new JsonObject { ["blocks"] = output };

    // Flat page fields, as OutputData saves them (01 D-1).
    foreach (var key in new[] { "title", "icon" })
    {
      if (document[key] is JsonNode value)
      {
        result[key] = value.DeepClone();
      }
    }

    return result;
  }

  internal static string Stable(JsonNode? node)
  {
    return node switch
    {
      JsonObject obj => "{" + string.Join(",", obj.OrderBy(p => p.Key, StringComparer.Ordinal)
          .Select(p => $"{System.Text.Json.JsonSerializer.Serialize(p.Key)}:{Stable(p.Value)}")) + "}",
      JsonArray array => "[" + string.Join(",", array.Select(Stable)) + "]",
      null => "null",
      _ => node.ToJsonString(),
    };
  }

  private static JsonNode? Rename(JsonNode? node, IReadOnlyDictionary<string, string> names)
  {
    switch (node)
    {
      case JsonValue value when value.TryGetValue<string>(out var text):
        return names.TryGetValue(text, out var label) ? JsonValue.Create(label) : value.DeepClone();
      case JsonArray array:
        return new JsonArray(array.Select(item => Rename(item, names)).ToArray());
      case JsonObject obj:
        var copy = new JsonObject();

        foreach (var (key, value) in obj)
        {
          copy[key] = Rename(value, names);
        }

        return copy;
      default:
        return node?.DeepClone();
    }
  }

  private static JsonNode? Canonical(JsonNode? node)
  {
    switch (node)
    {
      case JsonArray array:
        var engine = JsJson.Parse(array.ToJsonString());

        if (engine is AnyArray segments && segments.Count > 0 && RichText.IsRichText(segments))
        {
          return RichText.ToJson(RichText.Canonicalize(segments));
        }

        return new JsonArray(array.Select(Canonical).ToArray());
      case JsonObject obj:
        var copy = new JsonObject();

        foreach (var (key, value) in obj)
        {
          copy[key] = Canonical(value);
        }

        return copy;
      default:
        return node?.DeepClone();
    }
  }
}
```

`AnyArray`'s namespace and the exact `JsJson.Parse` return type are read from `RichTextFixtures.cs:1-30` and `RichText.cs:19-70`; fix the `using` lines to match. `RichText` is `internal`; the existing tests use it (`RichTextCanonicalTests.cs:37`), so `InternalsVisibleTo` already covers this project.

- [ ] **Step 5: Run the normalizer test to verify it passes**

Run: `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~AgentParityNormalizerTests"`
Expected: PASS for every case without `tsOnly`.

- [ ] **Step 6: Write the failing Jint runner test**

```csharp
// packages/server/dotnet/Blok.Server.Tests/Agent/JintAgentParityTests.cs
using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Blok.Server.Runtime;
using Xunit;

namespace Blok.Server.Tests.Agent;

/// <summary>One runtime for the whole corpus: each instance parses the ~700 KB bundle.</summary>
public sealed class JintAgentRuntimeFixture
{
  // Internal ctor (01 Task 45); Blok.Server.Tests sees internals (Blok.Server/Properties/AssemblyInfo.cs:5). No rooms for stored runs.
  internal IBlokAgentExecutor Executor { get; } = new BlokAgentExecutor(JintBlokRuntime.FromEmbeddedResource(1, null, null), null, null);
}

public sealed class JintAgentParityTests(JintAgentRuntimeFixture fixture) : IClassFixture<JintAgentRuntimeFixture>
{
  public static TheoryData<string> Cases() => AgentParityCorpus.Names();

  [Theory]
  [MemberData(nameof(Cases))]
  public async Task MatchesTheJsonGolden(string name)
  {
    var c = AgentParityCorpus.Get(name);
    var document = c.Seed.ToJsonString();
    string? error = null;

    foreach (var batch in c.Batches)
    {
      var execution = await fixture.Executor.ExecuteAsync(document, batch.ToJsonString(), new BlokAgentActor("agent-test", "Parity"));
      var result = JsonNode.Parse(execution.ResultJson)!;

      if (!result["ok"]!.GetValue<bool>())
      {
        error = result["error"]!["code"]!.GetValue<string>();
        break;
      }

      document = execution.DocumentJson!;
    }

    Assert.Equal(AgentParityCorpus.ExpectedError(c, "jint"), error);

    if (error is null && AgentParityCorpus.ExpectedError(c, "json") is null)
    {
      var golden = AgentParityCorpus.Golden(name);
      Assert.NotNull(golden);
      var actual = AgentParityNormalizer.Normalize(JsonNode.Parse(document)!.AsObject(), AgentParityCorpus.CallerChosenIds(c));
      Assert.Equal(AgentParityNormalizer.Stable(golden), AgentParityNormalizer.Stable(actual));
    }
  }
}
```

Settled by the cross-plan pass from 01's plan: namespace `Blok.Server.Agent` (01 Task 38); constructor `internal BlokAgentExecutor(IBlokRuntime runtime, CollabRoomManager? rooms, ICollabDocConverter? converter)` (01 Task 45), built in 01's own tests as `new BlokAgentExecutor(JintBlokRuntime.FromEmbeddedResource(1, null, null), rooms, converter)` (01 Task 46). No test factory is needed. Confirm the constructor on `main` before Step 3.

- [ ] **Step 7: Run it and verify**

Run: `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~JintAgentParityTests"`
Expected: PASS. Note the wall time printed by `dotnet test`. The whole `Server` CI job (`.github/workflows/ci.yml:288-326`) must stay under 7 minutes; if this class adds more than 60 s, raise `poolSize` only if Jint tests show it is parse-bound, otherwise report the number to the user before committing.

- [ ] **Step 8: Format and commit**

```bash
dotnet format packages/server/dotnet/Blok.Server.slnx --verify-no-changes --include packages/server/dotnet/Blok.Server.Tests/Agent/
git add packages/server/dotnet/Blok.Server.Tests/Agent
git diff --cached --name-only
git commit -m "test(server): C# corpus reader, normalizer and Jint parity runner

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: The C# `room` runner

**Gated on:** 01's C# `IBlokAgentExecutor.ExecuteInRoomAsync` and its room `SeedAsync` / `ExportAsync` page support (06 §7.4, §10.1 A).

The concurrency case from 05 §3.2.1 ("a `block.move` while a second client types inside the moved block keeps both edits") is the same test 01 §6 "C# server" already lists. It is owned there; this task does not duplicate it.

**Files:**
- Create: `packages/server/dotnet/Blok.Server.Tests/Agent/RoomAgentParityTests.cs`

**Interfaces:**
- Consumes: Task 12's corpus and normalizer; the room test support in `Blok.Server.Tests/Collab/CollabRoomTestSupport.cs` (`FakeDocEndpoint` `:460`, `FakeWorkingSetStore` `:224`) and the `CreateManager` helper pattern in `Collab/CollabRoomManagerTests.cs:22`.
- Produces: a theory over the corpus, runner name `room`.

- [ ] **Step 1: Write the test**

```csharp
// packages/server/dotnet/Blok.Server.Tests/Agent/RoomAgentParityTests.cs
using System.Text.Json.Nodes;
using Blok.Server.Agent;
using Xunit;

namespace Blok.Server.Tests.Agent;

public sealed class RoomAgentParityTests
{
  public static TheoryData<string> Cases() => AgentParityCorpus.Names();

  [Theory]
  [MemberData(nameof(Cases))]
  public async Task MatchesTheJsonGolden(string name)
  {
    var c = AgentParityCorpus.Get(name);
    await using var room = await AgentRoomForTests.SeedAsync($"parity-{Guid.NewGuid():N}", c.Seed);
    string? error = null;

    foreach (var batch in c.Batches)
    {
      var execution = await room.Executor.ExecuteInRoomAsync(room.DocId, batch.ToJsonString(), new BlokAgentActor("agent-test", "Parity"));
      var result = JsonNode.Parse(execution.ResultJson)!;

      if (!result["ok"]!.GetValue<bool>())
      {
        error = result["error"]!["code"]!.GetValue<string>();
        break;
      }
    }

    Assert.Equal(AgentParityCorpus.ExpectedError(c, "room"), error);

    if (error is null && AgentParityCorpus.ExpectedError(c, "json") is null)
    {
      var exported = await room.ExportAsync();
      var actual = AgentParityNormalizer.Normalize(exported, AgentParityCorpus.CallerChosenIds(c));
      Assert.Equal(AgentParityNormalizer.Stable(AgentParityCorpus.Golden(name)), AgentParityNormalizer.Stable(actual));
    }
  }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~RoomAgentParityTests"`
Expected: build FAIL, "AgentRoomForTests does not exist".

- [ ] **Step 3: Write `AgentRoomForTests` in the same file**

It uses the real `CollabDocConverter` (a fake converter would make the room runner check nothing). Constructors are read from `Blok.Server/Collab/CollabRoomManager.cs:207-215`, `CollabDocConverter.cs:14-18`, `RichTextHtmlReader.cs:25`, and `Blok.Server.Tests/Collab/CollabRoomTestSupport.cs:224,460,476-481` (`FakeDocEndpoint.HoldsDocument(docId, JsonObject, version?)`). The live document is read with `CollabRoomManager.StateAsync(docId)` (`CollabRoomManager.cs:694-696`, the `GET /sync/{doc}/state` path), whose `Json` is the room's export.

```csharp
internal sealed class AgentRoomForTests : IAsyncDisposable
{
  private static readonly Lazy<JintBlokRuntime> Runtime = new(() => JintBlokRuntime.FromEmbeddedResource(poolSize: 1));

  private CollabRoomManager manager = null!;

  internal required string DocId { get; init; }

  internal required IBlokAgentExecutor Executor { get; init; }

  internal static Task<AgentRoomForTests> SeedAsync(string docId, JsonObject seed)
  {
    var endpoint = new FakeDocEndpoint();
    endpoint.HoldsDocument(docId, seed);

    var converter = new CollabDocConverter(TimeProvider.System, new RuntimeRichTextHtmlReader(Runtime.Value));
    var manager = new CollabRoomManager(
        new FakeWorkingSetStore(),
        endpoint,
        converter,
        new CollabRoomOptions(),
        TimeProvider.System,
        operationStore: new FakeCollabOperationStore());

    return Task.FromResult(new AgentRoomForTests
    {
      DocId = docId,
      Executor = new BlokAgentExecutor(Runtime.Value, manager, converter),
      manager = manager,
    });
  }

  internal async Task<JsonObject> ExportAsync()
  {
    var state = await manager.StateAsync(DocId);

    Assert.NotEmpty(state.Json);

    return JsonNode.Parse(state.Json)!.AsObject();
  }

  public async ValueTask DisposeAsync()
  {
    await manager.DrainAsync();
  }
}
```

The executor is built with 01's internal constructor (01 Task 45) and the same `converter` the manager uses. Stand-ins, checked when 01's C# lands: the no-argument constructors of `FakeWorkingSetStore` and `FakeCollabOperationStore` (read `CollabRoomTestSupport.cs:224` and `:1071` and pass what they require); and `DrainAsync` as the cleanup (`ICollabRoomManager.cs:21`).

- [ ] **Step 4: Run to verify it passes**

Run: `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~RoomAgentParityTests"`
Expected: PASS; `history-undo` and `history-redo` report `COMMAND_UNAVAILABLE` (D6). Record the wall time as in Task 12 Step 7.

- [ ] **Step 5: Format and commit**

```bash
dotnet format packages/server/dotnet/Blok.Server.slnx --verify-no-changes --include packages/server/dotnet/Blok.Server.Tests/Agent/
git add packages/server/dotnet/Blok.Server.Tests/Agent/RoomAgentParityTests.cs
git diff --cached --name-only
git commit -m "test(server): C# live-room parity runner

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Checkpoint 3

- [ ] `yarn e2e test/playwright/tests/agent/command-parity.spec.ts --project=chromium-default` PASS.
- [ ] `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~Agent"` PASS. Total added time recorded.
- [ ] `dotnet format packages/server/dotnet/Blok.Server.slnx --verify-no-changes` exit 0.
- [ ] `git pull --rebase && git push`; `git status` up to date.

---
# Phase 4 — Contract-bound law and renderer parity

### Task 14: Renderer parity (`renderAgentTools`, in-app vs MCP)

**Gated on:** 03's `renderAgentTools` (`src/agent/render-tools.ts`, 06 §3.7) and Task 7's `harness.ts`.

**Files:**
- Create: `test/fixtures/agent-commands/custom-tools/rating.json`
- Modify: `test/unit/agent/harness.ts` (add `contractFor(runtime, customTools?)`)
- Create: `test/unit/agent/render-tools-parity.test.ts`
- Create (generated): `test/unit/agent/__snapshots__/render-tools.anthropic.envelope.json`, `render-tools.anthropic.full.json`

**Interfaces:**
- Consumes: `renderAgentTools(contract, { format, schema?, handle? }): RenderedTool[]`; `AgentContract`, `CommandEntry` (06 §3.6); `BlokCustomToolsFile` (06 R2-04-Q17).
- Produces: `contractFor(runtime: 'editor' | 'node', customTools?: BlokCustomToolsFile): AgentContract` in `harness.ts`.

- [ ] **Step 1: Write the fixture host tool**

```json
// test/fixtures/agent-commands/custom-tools/rating.json
{
  "formatVersion": 1,
  "blocks": [
    {
      "name": "rating",
      "description": {
        "summary": "A star rating from 0 to 5.",
        "data": { "type": "object", "properties": { "value": { "type": "integer", "minimum": 0, "maximum": 5 } }, "required": ["value"], "additionalProperties": false },
        "actions": [
          { "name": "setValue", "summary": "Set the rating.", "target": "block",
            "args": { "type": "object", "properties": { "value": { "type": "integer", "minimum": 0, "maximum": 5 } }, "required": ["value"], "additionalProperties": false } }
        ]
      },
      "statics": {
        "toolbox": [{ "name": "rating", "title": "Rating" }],
        "richTextFields": [],
        "acceptsChildren": false, "ownsChildren": false, "isLayout": false, "deletesChildren": false,
        "selfPlacesChildren": false, "restrictedInTableCell": false,
        "conversion": {}, "hasPrepareInsert": false
      }
    }
  ]
}
```

The `statics` keys are 02 §5.1's `ToolRegistrySnapshot['blocks'][number]['statics']`. The `description` keys follow 02 §3.5; check them against the landed `types/tools/tool-description.d.ts` and fix this file if a key differs.

- [ ] **Step 2: Write the failing test**

```ts
// test/unit/agent/render-tools-parity.test.ts
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderAgentTools } from '../../../src/agent/render-tools';
import type { AgentContract } from '../../../types/agent';
import { contractFor } from './harness';
import { CORPUS_ROOT } from './parity/corpus';

type Schema = { properties?: Record<string, Schema>; items?: Schema; oneOf?: Schema[]; enum?: string[]; const?: string };
type Rendered = { name: string; description: string; input_schema?: Schema; inputSchema?: Schema; strict?: boolean };

const rating = JSON.parse(readFileSync(join(CORPUS_ROOT, 'custom-tools/rating.json'), 'utf8'));
const editor = contractFor('editor', rating);
const node = contractFor('node', rating);

const schemaOf = (tool: Rendered): Schema => tool.input_schema ?? tool.inputSchema ?? {};

/** Command names a blok_execute schema accepts, in envelope (enum) or full (oneOf + const) mode. */
const executeNames = (tool: Rendered): string[] => {
  const item = schemaOf(tool).properties?.commands?.items ?? {};

  if (item.oneOf !== undefined) {
    return item.oneOf.map((branch) => branch.properties?.name?.const ?? '').sort();
  }

  return [...(item.properties?.name?.enum ?? [])].sort();
};

/** Commands both contracts list but with a different `available` (06 R3-1). */
const differing = (a: AgentContract, b: AgentContract): Set<string> =>
  new Set(a.commands.filter((x) => b.commands.find((y) => y.name === x.name)?.available !== x.available).map((x) => x.name));

const withoutDeclaredDifferences = (schema: Schema, skip: Set<string>): Schema => {
  const copy = structuredClone(schema);

  delete copy.properties?.handle;

  const item = copy.properties?.commands?.items;

  if (item?.oneOf !== undefined) {
    item.oneOf = item.oneOf.filter((branch) => !skip.has(branch.properties?.name?.const ?? ''));
  } else if (item?.properties?.name?.enum !== undefined) {
    item.properties.name.enum = item.properties.name.enum.filter((name) => !skip.has(name));
  }

  return copy;
};

describe.each(['envelope', 'full'] as const)('renderAgentTools parity (%s)', (schema) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const inApp = renderAgentTools(editor, { format: 'anthropic', schema }) as Rendered[];
  const mcp = renderAgentTools(node, { format: 'mcp', schema, handle: true }) as Rendered[];

  it('both surfaces render exactly the three core tools', () => {
    expect(inApp.map((t) => t.name).sort()).toEqual(['blok_describe', 'blok_execute', 'blok_read']);
    expect(mcp.map((t) => t.name).sort()).toEqual(['blok_describe', 'blok_execute', 'blok_read']);
  });

  it('descriptions and input schemas match apart from the declared differences', () => {
    const skip = differing(editor, node);

    for (const tool of inApp) {
      const twin = mcp.find((t) => t.name === tool.name);

      expect(twin?.description).toBe(tool.description);
      expect(withoutDeclaredDifferences(schemaOf(twin ?? tool), skip)).toEqual(withoutDeclaredDifferences(schemaOf(tool), skip));
    }
  });

  it('blok_execute lists exactly the available commands of its own contract', () => {
    const available = (c: AgentContract): string[] => c.commands.filter((x) => x.available).map((x) => x.name).sort();

    expect(executeNames(inApp.find((t) => t.name === 'blok_execute') as Rendered)).toEqual(available(editor));
    expect(executeNames(mcp.find((t) => t.name === 'blok_execute') as Rendered)).toEqual(available(node));
  });

  it('includes the custom tool action', () => {
    expect(executeNames(inApp.find((t) => t.name === 'blok_execute') as Rendered)).toContain('rating.setValue');
  });

  it('never marks blok_execute strict', () => {
    expect(inApp.find((t) => t.name === 'blok_execute')?.strict).toBeUndefined();
  });

  it('matches the checked-in snapshot', async () => {
    await expect(JSON.stringify(inApp, null, 2)).toMatchFileSnapshot(`./__snapshots__/render-tools.anthropic.${schema}.json`);
  });
});
```

`rating.setValue` has no handler outside the browser (06 D6 cut), so in the `node` contract it is `available: false`. That is a declared difference: `differing()` removes it before the schema compare, and the availability test checks each surface against its own contract.

- [ ] **Step 3: Run to verify it fails**

Run: `yarn test test/unit/agent/render-tools-parity.test.ts`
Expected: FAIL, "contractFor is not exported".

- [ ] **Step 4: Add `contractFor` to `harness.ts`**

```ts
import type { BlokCustomToolsFile } from '../../../types/tool-manifest';
import { COMMANDS } from '../../../src/shared/agent/commands';
import { buildBuiltInSnapshot } from '../../../src/shared/built-in-snapshot';
import { snapshotWithCustomTools } from '../../../src/shared/custom-tools-file';
import { buildAgentContract, buildToolManifest } from '../../../src/shared/tool-manifest';

// The same snapshot for both runners, so only `where.runtime` differs (06 R3-1).
export const contractFor = (runtime: 'editor' | 'node', customTools?: BlokCustomToolsFile): AgentContract =>
  buildAgentContract(
    buildToolManifest(snapshotWithCustomTools(buildBuiltInSnapshot({ blokVersion: 'test' }), customTools)),
    COMMANDS,
    { runtime, services: [] },
  );
```

Names and paths are 02's (`buildBuiltInSnapshot`, 02 Task 27; `snapshotWithCustomTools`, 02 Task 29) and 01's (`COMMANDS`, 01 Task 3). Custom tools go through `snapshotWithCustomTools`, not an option of `buildBuiltInSnapshot`.

- [ ] **Step 5: Run to verify it passes and writes the snapshots**

Run: `yarn test test/unit/agent/render-tools-parity.test.ts`
Expected: PASS; two snapshot files created. Read them: three tools, `blok_execute` with no `strict`, the custom action present.

- [ ] **Step 6: Lint and commit**

```bash
node_modules/.bin/eslint test/unit/agent/harness.ts test/unit/agent/render-tools-parity.test.ts
git add test/unit/agent/harness.ts test/unit/agent/render-tools-parity.test.ts test/unit/agent/__snapshots__ test/fixtures/agent-commands/custom-tools/rating.json
git diff --cached --name-only
git commit -m "test(agent): renderer parity between in-app and MCP tool sets

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Contract-bound law assertions (dangling, field rows, `mirrors`, pending promotion)

**Gated on:** 02's manifest with `data`, `viewState`, `guardedFields`, `actions[].mirrors`; Task 7's `nodeContract`.

**Files:**
- Modify: `test/unit/architecture/agent-coverage.ledger.ts` (narrow `command` to `CommandName`)
- Modify: `test/unit/architecture/agent-coverage-law.test.ts`

**Interfaces:**
- Consumes: `nodeContract()` (Task 7), `CommandName` (`types/agent.d.ts`, 06 §3.1), `routeNames` (Task 5).
- Produces: `mirroredIds(contract): Map<string, string>` (capability id → action command), and assertions 2 and 3.

- [ ] **Step 1: Append the failing assertions**

```ts
// append to agent-coverage-law.test.ts (merge imports)
import { nodeContract } from '../agent/harness';
import type { AgentContract } from '../../../types/agent';

type ManifestBlock = AgentContract['manifest']['blocks'][number];

const contract = nodeContract('node');

const mirroredIds = (c: AgentContract): Map<string, string> =>
  new Map(c.manifest.blocks.flatMap((b: ManifestBlock) => b.actions.flatMap((a) => (a.mirrors ?? []).map((id) => [id, a.command] as const))));

const fieldProblem = (field: string): string | null => {
  const [key, name] = field.split('.');
  const entry = contract.manifest.blocks.find((b: ManifestBlock) => b.name === key);

  if (entry === undefined) {
    return `no manifest entry "${key}"`;
  }

  const properties = (entry.data as { properties?: Record<string, unknown> }).properties ?? {};

  if (!(name in properties)) {
    return `"${name}" is not a property of ${key}'s data schema`;
  }

  if (entry.viewState.includes(name)) {
    return `"${name}" is view-state on ${key}`;
  }

  if (name in entry.guardedFields) {
    return `"${name}" is guarded on ${key}; use ${entry.guardedFields[name]}`;
  }

  return null;
};

// inside describe('agent coverage law', …):

it.skipIf(isInstrumented())('every named command exists, and pending markers are dropped once it does (assertion 2)', () => {
  const known = new Set(contract.commands.map((c) => c.name));
  const problems: string[] = [];

  for (const [id, coverage] of Object.entries(LEDGER)) {
    if (isExempt(coverage)) {
      continue;
    }

    const missing = routeNames(coverage).filter((name) => !known.has(name));

    if (coverage.pending === undefined && missing.length > 0) {
      problems.push(`${id}: unknown command(s) ${missing.join(', ')}`);
    }

    if (coverage.pending !== undefined && missing.length === 0 && !('field' in coverage)) {
      problems.push(`${id}: every command now exists; drop pending: '${coverage.pending}'`);
    }
  }

  for (const [id, command] of mirroredIds(contract)) {
    if (!enumerateAll().has(id)) {
      problems.push(`${command} mirrors "${id}", which the scan no longer finds`);
    }
  }

  expect(problems).toEqual([]);
});

it('field rows are real field writes (assertion 3)', () => {
  const problems: string[] = [];

  for (const [id, coverage] of Object.entries(LEDGER)) {
    if (!('field' in coverage)) {
      continue;
    }

    const problem = fieldProblem(coverage.field);

    if (coverage.pending === undefined && problem !== null) {
      problems.push(`${id}: ${coverage.field}: ${problem}`);
    }

    if (coverage.pending !== undefined && problem === null) {
      problems.push(`${id}: ${coverage.field} is now a valid field write; drop pending`);
    }
  }

  expect(problems).toEqual([]);
});
```

Then change assertion 1 and assertion 4 to honour `mirrors` (06 05-Q7):

```ts
// assertion 1: treat mirrored ids as covered
const mirrored = mirroredIds(contract);
const missing = [...enumerateAll().values()]
  .filter((c) => LEDGER[c.id] === undefined && !mirrored.has(c.id))
  .map((c) => `${c.id}  (${c.file}:${c.line})`);

// assertion 4: a row for a mirrored id is stale too
const stale = Object.keys(LEDGER).filter((id) => !found.has(id) || mirroredIds(contract).has(id));
```

In `agent-coverage.ledger.ts`, change `command: string` / `commands: string[]` to `CommandName` / `CommandName[]` with `import type { CommandName } from '../../../types/agent';`, and the helpers `c01`, `c02`, `many` to take `CommandName`.

- [ ] **Step 2: Run to see what fails**

Run: `yarn test test/unit/architecture/agent-coverage-law.test.ts`
Expected: FAIL in assertions 2/3 and 4. Assertion 2 lists each row whose command now exists ("drop pending"); assertion 4 lists rows that 02's `mirrors` now cover. Both lists are the expected state after 01/02 land.

- [ ] **Step 3: Update the ledger**

Drop every `pending` marker assertion 2/3 names. Delete every row assertion 4 names as mirrored. Any row in assertion 2 with an unknown command and no `pending` is a real gap: either a 02 action was renamed (fix the row to the landed name) or it was not built (put `pending` back and tell 02).

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test test/unit/architecture/agent-coverage-law.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the remaining manual mutation checks (05 §3.1.4 b, c, g)**

(b) Rename `'table.insertRows'` to `'table.insertRowz'` in its ledger rows → expect FAIL at assertion 2.
(c) Point `'menu:table/table-heading-row'` at `{ field: 'table.content' }` (a guarded field, 02 §7.1 item 3) → expect FAIL at assertion 3.
(g) Remove one id from an action's `mirrors` in `src/shared/tool-descriptions/` → expect FAIL at assertion 1.
Revert each; `git diff` must be empty for these edits.

- [ ] **Step 6: Lint and commit**

```bash
node_modules/.bin/eslint test/unit/architecture/agent-coverage.ledger.ts test/unit/architecture/agent-coverage-law.test.ts
git add test/unit/architecture/agent-coverage.ledger.ts test/unit/architecture/agent-coverage-law.test.ts
git diff --cached --name-only
git commit -m "test(agent-coverage): contract-bound assertions and mirrors auto-cover

Mutation checks: (b) <result> (c) <result> (g) <result>

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: Final gate — zero pending rows, every command in a parity case

This task gates "01 and 02 are done".

**Files:**
- Modify: `test/unit/architecture/agent-coverage-law.test.ts`

**Interfaces:**
- Consumes: `loadParityCases()` (Task 6), `nodeContract`, `contractFor` (Tasks 7, 14).

- [ ] **Step 1: Replace the informational pending test and add corpus coverage**

```ts
import { loadParityCases } from '../agent/parity/corpus';

/**
 * Commands that are not a single-document parity case, each with the spec line
 * that says so.
 */
const UNCORPUSED_COMMANDS: Record<string, string> = {
  'page.rename': 'Headless form writes another document; one document per case cannot hold it (05 §3.2.1). 01 and 04 test it.',
  'page.setIcon': 'Headless form writes another document; one document per case cannot hold it (05 §3.2.1). 01 and 04 test it.',
};

it('no ledger row waits on 01 or 02 any more', () => {
  const pending = Object.entries(LEDGER)
    .filter(([, c]) => !isExempt(c) && c.pending !== undefined)
    .map(([id, c]) => `${id} (${(c as { pending: string }).pending})`);

  expect(pending).toEqual([]);
});

it('every contract command is reached by at least one parity case', () => {
  const used = new Set(loadParityCases().flatMap((c) => c.batches.flatMap((b) => b.commands.map((x) => x.name))));
  const unreached = contract.commands
    .map((c) => c.name)
    .filter((name) => !used.has(name) && UNCORPUSED_COMMANDS[name] === undefined);

  expect(
    unreached,
    'Add a case under test/fixtures/agent-commands/cases/ for each command, and its golden.'
  ).toEqual([]);
});
```

- [ ] **Step 2: Run it**

Run: `yarn test test/unit/architecture/agent-coverage-law.test.ts`
Expected: PASS only when 01 and 02 are complete. Each command it lists needs a case (02 §6 item 6 adds action cases; 01 adds core cases). Each pending row it lists is unfinished 01/02 work.

- [ ] **Step 3: Commit**

```bash
node_modules/.bin/eslint test/unit/architecture/agent-coverage-law.test.ts
git add test/unit/architecture/agent-coverage-law.test.ts
git diff --cached --name-only
git commit -m "test(agent-coverage): no pending rows; every command has a parity case

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Checkpoint 4

- [ ] Each Phase 1–4 unit file alone: PASS. `yarn e2e test/playwright/tests/agent/command-parity.spec.ts --project=chromium-default`: PASS. C# `--filter "FullyQualifiedName~Agent"`: PASS.
- [ ] `yarn lint`: exit 0. `NODE_OPTIONS=--max-old-space-size=8192 node_modules/.bin/tsc --noEmit` (memory `blok-local-tsc-needs-8gb-heap`): exit 0.
- [ ] `git pull --rebase && git push`; `git status` up to date.
- [ ] Tell the user Task 16 is green: 01 and 02 meet the coverage bar.

---

# Phase 5 — Deterministic graders (per commit, no model)

### Task 17: Eval types and the structural graders

Pure, no dependency on 01–04: graders read saved documents. `schemaValid` takes its validator as an argument, so this task does not import 02's `validateAgainst`.

**Files:**
- Create: `test/evals/agent/types.ts`
- Create: `test/evals/agent/graders/text.ts`
- Create: `test/evals/agent/graders/structure.ts`
- Create: `test/unit/evals/graders-structure.test.ts`

**Interfaces:**
- Produces (`types.ts`):

```ts
import type { OutputData } from '../../../types';
import type { CorpusBatch } from '../../unit/agent/parity/corpus';

export interface LogEntry { batch: number; index: number; name: string; args: unknown; result?: unknown; error?: { code: string; message?: string }; actorId: string }
export interface ChangedSet { created: string[]; updated: string[]; moved: string[]; removed: string[] }
export interface ExecuteResult {
  ok: boolean;
  changed?: ChangedSet;
  warnings?: Array<{ code: string; blockId?: string }>;
  error?: { code: string };
  delivery?: { durable: boolean; pending: boolean; serverSequence: string | null; savedVersion: string | null };
}
export interface Observed {
  humanId?: string;
  humanTyped?: { blockId: string; text: string };
  participants?: Array<{ id: string; name: string }>;
  participantsAfterClose?: Array<{ id: string; name: string }>;
  peerSawAgentCursorOn?: string[];
  journalActors?: string[];
  serverAckedSequences?: string[];
}
export interface GraderInput {
  seed: OutputData;
  final: OutputData;
  actorId: string;
  log: readonly LogEntry[];
  results?: readonly ExecuteResult[];
  toolCalls?: readonly string[];
  answer?: string;
  observed?: Observed;
}
export interface Verdict { pass: boolean; detail: string }
export interface Grader { name: string; check(input: GraderInput): Verdict }
export type Surface = 'in-app' | 'in-app-browser' | 'mcp-stored' | 'mcp-live';
export interface KnownBad { why: string; final: OutputData; log?: LogEntry[]; results?: ExecuteResult[]; toolCalls?: string[]; answer?: string; observed?: Observed }
export interface EvalTask {
  id: string;
  prompt: string;
  surfaces: Surface[];
  seed: OutputData;
  tools?: 'default' | 'rating-fixture';
  graders: Grader[];
  reference: CorpusBatch[];
  /** Set when the reference cannot be replayed in Node (a browser-only tool, a live room's human edits). */
  referenceFinal?: OutputData;
  referenceLog?: LogEntry[];
  referenceResults?: ExecuteResult[];
  referenceAnswer?: string;
  referenceObserved?: Observed;
  referenceToolCalls?: string[];
  docId?: string;
  knownBad: KnownBad[];
  budget: { maxTurns: number; maxOutputTokens: number };
}
export interface EvalResults {
  model: string; effort: string; commit: string; schema: 'envelope' | 'full';
  tasks: Array<{
    id: string; surface: Surface;
    trials: Array<{ outcome: 'pass' | 'fail' | 'error'; graders: Record<string, Verdict>; turns: number; inputTokens: number; outputTokens: number; errorDetail?: string }>;
    passAt1: number; passAll: boolean;
  }>;
}
```

Deviations from 05 §3.3.2, each needed by a grader: `Grader` carries a `name` (reports need it); `surfaces` is an array (`markdown-regression` and `page-title-icon` run on two surfaces, 05 §3.3.4); `knownBad` entries carry an optional log, results, tool calls, answer and observations, because `usedAction`, `toolSequence`, `answerIds` and the collab graders judge those, not the document; `GraderInput` adds `actorId`, `toolCalls` and `observed` for the same reason.

- `text.ts`: `plainText(value: unknown): string` (segments joined, an embed counts as `￼`, an HTML string is parsed with `htmlToSegmentsNode`), `childrenOf(doc, block)`, `blockById(doc, id)`, `type BlockRef = { id: string } | { type: string; nth?: number }`, `resolveBlock(doc, ref)`, `segmentsOf(block, field?)`.
- `structure.ts`: `schemaValid(validate: (doc: OutputData) => string[]): Grader`, `shape(name: string, query: ShapeQuery): Grader`, `sequence(name: string, types: string[], parentId?: string | null): Grader`, `text(name: string, ref: BlockRef, expected: string | RegExp): Grader`, `marks(name: string, ref: BlockRef, substring: string, expected: Record<string, unknown>): Grader`, `untouched(allowed: string[]): Grader`, `unchanged(): Grader`, `dataCheck(name: string, type: string, test: (data: Record<string, unknown>) => boolean, detail: string): Grader`, with `interface ShapeQuery { type: string; id?: string; data?: Record<string, unknown>; children?: ShapeQuery[]; count?: number }`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/evals/graders-structure.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutputData } from '../../../types';
import { marks, schemaValid, sequence, shape, text, unchanged, untouched } from '../../evals/agent/graders/structure';
import type { GraderInput } from '../../evals/agent/types';

const doc = (blocks: OutputData['blocks']): OutputData => ({ blocks });

const input = (final: OutputData, seed: OutputData = doc([])): GraderInput => ({ seed, final, actorId: 'agent', log: [] });

const toggle = doc([
  { id: 't', type: 'toggle', data: { text: [{ text: 'FAQ' }] }, content: ['a', 'b'] },
  { id: 'a', type: 'paragraph', parent: 't', data: { text: [{ text: 'quarterly', marks: { bold: true } }, { text: ' report' }] } },
  { id: 'b', type: 'paragraph', parent: 't', data: { text: 'plain' } },
]);

describe('structural graders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shape matches a container and its ordered children, and rejects a wrong order', () => {
    const good = shape('faq toggle', { type: 'toggle', children: [{ type: 'paragraph', id: 'a' }, { type: 'paragraph', id: 'b' }] });
    const bad = shape('faq toggle', { type: 'toggle', children: [{ type: 'paragraph', id: 'b' }, { type: 'paragraph', id: 'a' }] });

    expect(good.check(input(toggle)).pass).toBe(true);
    expect(bad.check(input(toggle)).pass).toBe(false);
  });

  it('shape count consumes a run of same-type children', () => {
    expect(shape('two paras', { type: 'toggle', children: [{ type: 'paragraph', count: 2 }] }).check(input(toggle)).pass).toBe(true);
    expect(shape('three paras', { type: 'toggle', children: [{ type: 'paragraph', count: 3 }] }).check(input(toggle)).pass).toBe(false);
  });

  it('sequence finds consecutive root types', () => {
    const final = doc([
      { id: 'h', type: 'header', data: { text: 'Plan', level: 2 } },
      { id: 'p', type: 'paragraph', data: { text: 'x' } },
    ]);

    expect(sequence('plan', ['header', 'paragraph']).check(input(final)).pass).toBe(true);
    expect(sequence('plan', ['paragraph', 'header']).check(input(final)).pass).toBe(false);
  });

  it('text reads segments and HTML strings alike', () => {
    expect(text('b text', { id: 'b' }, 'plain').check(input(toggle)).pass).toBe(true);
    expect(text('a text', { id: 'a' }, /^quarterly report$/).check(input(toggle)).pass).toBe(true);
  });

  it('marks checks every character of the substring', () => {
    expect(marks('bold quarterly', { id: 'a' }, 'quarterly', { bold: true }).check(input(toggle)).pass).toBe(true);
    expect(marks('bold report', { id: 'a' }, 'report', { bold: true }).check(input(toggle)).pass).toBe(false);
  });

  it('untouched fails when a block outside the allowed set changed', () => {
    const seed = doc([{ id: 'x', type: 'paragraph', data: { text: [{ text: 'same' }] } }]);
    const changed = doc([{ id: 'x', type: 'paragraph', data: { text: [{ text: 'edited' }] } }]);

    expect(untouched([]).check(input(changed, seed)).pass).toBe(false);
    expect(untouched(['x']).check(input(changed, seed)).pass).toBe(true);
    expect(unchanged().check(input(seed, seed)).pass).toBe(true);
  });

  it('schemaValid reports the validator errors', () => {
    expect(schemaValid(() => ['/blocks/0: bad']).check(input(toggle))).toEqual({ pass: false, detail: '/blocks/0: bad' });
    expect(schemaValid(() => []).check(input(toggle)).pass).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test test/unit/evals/graders-structure.test.ts`
Expected: FAIL, cannot resolve `../../evals/agent/graders/structure`.

- [ ] **Step 3: Write `types.ts` (as in Interfaces), `text.ts` and `structure.ts`**

```ts
// test/evals/agent/graders/text.ts
import type { OutputBlockData, OutputData } from '../../../../types';
import { htmlToSegmentsNode } from '../../../../src/view/rich-text-parse5';

type Segment = { text?: string; embed?: unknown; marks?: Record<string, unknown> };

export type BlockRef = { id: string } | { type: string; nth?: number };

export const segmentsOf = (block: OutputBlockData, field = 'text'): Segment[] => {
  const value = (block.data as Record<string, unknown>)[field];

  if (typeof value === 'string') {
    return htmlToSegmentsNode(value) as Segment[];
  }

  return Array.isArray(value) ? (value as Segment[]) : [];
};

export const plainText = (block: OutputBlockData, field = 'text'): string =>
  segmentsOf(block, field).map((s) => (s.text !== undefined ? s.text : '￼')).join('');

export const blockById = (doc: OutputData, id: string): OutputBlockData | undefined => doc.blocks.find((b) => b.id === id);

export const childrenOf = (doc: OutputData, block: OutputBlockData): OutputBlockData[] => {
  const listed = (block.content ?? []).map((id) => blockById(doc, id)).filter((b): b is OutputBlockData => b !== undefined);

  return listed.length > 0 ? listed : doc.blocks.filter((b) => b.parent === block.id);
};

export const rootsOf = (doc: OutputData): OutputBlockData[] => doc.blocks.filter((b) => b.parent === undefined || b.parent === null);

/** Document order: roots, each followed by its subtree. */
export const inOrder = (doc: OutputData): OutputBlockData[] => {
  const out: OutputBlockData[] = [];
  const walk = (block: OutputBlockData): void => {
    out.push(block);
    childrenOf(doc, block).forEach(walk);
  };

  rootsOf(doc).forEach(walk);

  return out;
};

export const resolveBlock = (doc: OutputData, ref: BlockRef): OutputBlockData | undefined =>
  'id' in ref ? blockById(doc, ref.id) : inOrder(doc).filter((b) => b.type === ref.type)[ref.nth ?? 0];
```

```ts
// test/evals/agent/graders/structure.ts
import type { OutputBlockData, OutputData } from '../../../../types';
import { diffOutputData } from '../../../../src/view/diff-output-data';
import type { Grader, Verdict } from '../types';
import type { BlockRef } from './text';
import { childrenOf, inOrder, plainText, resolveBlock, rootsOf, segmentsOf } from './text';

export interface ShapeQuery {
  type: string;
  id?: string;
  data?: Record<string, unknown>;
  children?: ShapeQuery[];
  count?: number;
}

const ok = (detail: string): Verdict => ({ pass: true, detail });
const no = (detail: string): Verdict => ({ pass: false, detail });

const includesDeep = (actual: unknown, expected: unknown): boolean => {
  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    return actual !== null && typeof actual === 'object' &&
      Object.entries(expected).every(([k, v]) => includesDeep((actual as Record<string, unknown>)[k], v));
  }

  return JSON.stringify(actual) === JSON.stringify(expected);
};

const matches = (doc: OutputData, block: OutputBlockData, q: ShapeQuery): boolean => {
  if (block.type !== q.type || (q.id !== undefined && block.id !== q.id) || (q.data !== undefined && !includesDeep(block.data, q.data))) {
    return false;
  }

  if (q.children === undefined) {
    return true;
  }

  const kids = childrenOf(doc, block);
  let at = 0;

  for (const child of q.children) {
    for (let n = 0; n < (child.count ?? 1); n++) {
      if (at >= kids.length || !matches(doc, kids[at], { ...child, count: 1 })) {
        return false;
      }

      at++;
    }
  }

  return at === kids.length;
};

export const shape = (name: string, query: ShapeQuery): Grader => ({
  name: `shape:${name}`,
  check: ({ final }) => (inOrder(final).some((b) => matches(final, b, query)) ? ok(name) : no(`no block matches ${JSON.stringify(query)}`)),
});

export const sequence = (name: string, types: string[], parentId: string | null = null): Grader => ({
  name: `sequence:${name}`,
  check: ({ final }) => {
    const parent = parentId === null ? undefined : final.blocks.find((b) => b.id === parentId);
    const list = (parent === undefined ? rootsOf(final) : childrenOf(final, parent)).map((b) => b.type);

    for (let i = 0; i + types.length <= list.length; i++) {
      if (types.every((t, j) => list[i + j] === t)) {
        return ok(name);
      }
    }

    return no(`expected ${types.join(' → ')} in ${list.join(', ')}`);
  },
});

export const text = (name: string, ref: BlockRef, expected: string | RegExp): Grader => ({
  name: `text:${name}`,
  check: ({ final }) => {
    const block = resolveBlock(final, ref);
    const actual = block === undefined ? '' : plainText(block).replace(/\s+/g, ' ').trim();
    const pass = typeof expected === 'string' ? actual === expected : expected.test(actual);

    return pass ? ok(name) : no(`text was "${actual}"`);
  },
});

export const marks = (name: string, ref: BlockRef, substring: string, expected: Record<string, unknown>): Grader => ({
  name: `marks:${name}`,
  check: ({ final }) => {
    const block = resolveBlock(final, ref);

    if (block === undefined) {
      return no('block not found');
    }

    const chars: Array<Record<string, unknown>> = [];

    segmentsOf(block).forEach((s) => {
      const length = s.text !== undefined ? s.text.length : 1;

      for (let i = 0; i < length; i++) {
        chars.push(s.marks ?? {});
      }
    });

    const start = plainText(block).indexOf(substring);

    if (start < 0) {
      return no(`"${substring}" not in the block`);
    }

    const all = chars.slice(start, start + substring.length).every((m) => includesDeep(m, expected));

    return all ? ok(name) : no(`"${substring}" lacks ${JSON.stringify(expected)}`);
  },
});

export const untouched = (allowed: string[]): Grader => ({
  name: 'untouched',
  check: ({ seed, final }) => {
    const diff = diffOutputData(seed, final);
    const touched = [...diff.changed, ...diff.moved, ...diff.removed]
      .map((x) => ('id' in x ? x.id : (x as OutputBlockData).id))
      .filter((id): id is string => id !== undefined && !allowed.includes(id));

    return touched.length === 0 ? ok('only allowed blocks changed') : no(`also changed: ${[...new Set(touched)].join(', ')}`);
  },
});

export const unchanged = (): Grader => ({
  name: 'unchanged',
  check: ({ seed, final }) => {
    const diff = diffOutputData(seed, final);
    const count = diff.added.length + diff.removed.length + diff.changed.length + diff.moved.length;

    return count === 0 ? ok('document unchanged') : no(`${count} block change(s)`);
  },
});

export const schemaValid = (validate: (doc: OutputData) => string[]): Grader => ({
  name: 'schemaValid',
  check: ({ final }) => {
    const errors = validate(final);

    return errors.length === 0 ? ok('valid saved document') : no(errors.join('; '));
  },
});

export const dataCheck = (name: string, type: string, test: (data: Record<string, unknown>) => boolean, detail: string): Grader => ({
  name: `data:${name}`,
  check: ({ final }) => {
    const blocks = final.blocks.filter((b) => b.type === type);

    return blocks.length > 0 && blocks.every((b) => test(b.data as Record<string, unknown>)) ? ok(detail) : no(`not every ${type}: ${detail}`);
  },
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test test/unit/evals/graders-structure.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Lint and commit**

```bash
node_modules/.bin/eslint test/evals/agent/types.ts test/evals/agent/graders/text.ts test/evals/agent/graders/structure.ts test/unit/evals/graders-structure.test.ts
git add test/evals/agent/types.ts test/evals/agent/graders/text.ts test/evals/agent/graders/structure.ts test/unit/evals/graders-structure.test.ts
git diff --cached --name-only
git commit -m "test(evals): eval types and structural graders

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: Behaviour graders (`noMarkdownResidue`, `logClean`, `usedAction`, `answerIds`, `pageFields`, `toolSequence`)

**Files:**
- Create: `test/evals/agent/graders/behaviour.ts`
- Create: `test/unit/evals/graders-behaviour.test.ts`

**Interfaces:**
- Consumes: Task 17 `types.ts`, `text.ts`.
- Produces: `MARKDOWN_FINGERPRINTS: Array<[string, RegExp]>`, `noMarkdownResidue(allow?: RegExp[]): Grader`, `logClean(maxFailedBatches?: number): Grader`, `usedAction(command: string): Grader`, `answerIds(expected: string[]): Grader`, `pageFields(expected: { title?: string; icon?: unknown }): Grader`, `toolSequence(names: string[]): Grader`.

- [ ] **Step 1: Write the failing tests**

The first known-bad is the real failure the brief describes (05 §6 item 8).

```ts
// test/unit/evals/graders-behaviour.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutputData } from '../../../types';
import { answerIds, logClean, noMarkdownResidue, pageFields, toolSequence, usedAction } from '../../evals/agent/graders/behaviour';
import type { GraderInput, LogEntry } from '../../evals/agent/types';

const one = (text: unknown): OutputData => ({ blocks: [{ id: 'p', type: 'paragraph', data: { text } }] });
const base = (final: OutputData, extra: Partial<GraderInput> = {}): GraderInput => ({ seed: { blocks: [] }, final, actorId: 'agent', log: [], ...extra });
const entry = (batch: number, name: string, error?: string): LogEntry => ({ batch, index: 0, name, args: {}, actorId: 'agent', ...(error === undefined ? {} : { error: { code: error } }) });

describe('behaviour graders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('noMarkdownResidue rejects the original failure: Markdown written into one paragraph', () => {
    expect(noMarkdownResidue().check(base(one([{ text: '## Plan\n**intro**\n- a\n- b' }]))).pass).toBe(false);
  });

  it.each([
    ['bold', '**x**'], ['underscore bold', '__x__'], ['code', 'use `npm`'], ['heading', '# Title'], ['bullet', '- item'],
    ['ordered', '1. first'], ['quote', '> said'], ['table', '| a | b |\n|---|---|'], ['fence', '```js'], ['link', '[docs](https://x.y)'],
  ])('noMarkdownResidue catches %s', (_label, residue) => {
    expect(noMarkdownResidue().check(base(one([{ text: residue }]))).pass).toBe(false);
  });

  it('noMarkdownResidue passes real marks and honours an allow-list', () => {
    expect(noMarkdownResidue().check(base(one([{ text: 'intro', marks: { bold: true } }]))).pass).toBe(true);
    expect(noMarkdownResidue([/- item/]).check(base(one([{ text: '- item' }]))).pass).toBe(true);
  });

  it('noMarkdownResidue fails an unanswered LOOKS_LIKE_MARKDOWN warning', () => {
    const results = [{ ok: true, warnings: [{ code: 'LOOKS_LIKE_MARKDOWN', blockId: 'p' }] }];

    expect(noMarkdownResidue([/\*\*/]).check(base(one([{ text: '**x**' }]), { results })).pass).toBe(false);
  });

  it('logClean: the last batch must succeed and failures stay under the cap', () => {
    expect(logClean(1).check(base(one([]), { log: [entry(0, 'block.insert', 'INVALID_ARGS'), entry(1, 'block.insert')] })).pass).toBe(true);
    expect(logClean(1).check(base(one([]), { log: [entry(0, 'x', 'A'), entry(1, 'x', 'B'), entry(2, 'x')] })).pass).toBe(false);
    expect(logClean(2).check(base(one([]), { log: [entry(0, 'x'), entry(1, 'x', 'B')] })).pass).toBe(false);
  });

  it('usedAction needs a successful call of that command', () => {
    expect(usedAction('table.mergeCells').check(base(one([]), { log: [entry(0, 'table.mergeCells')] })).pass).toBe(true);
    expect(usedAction('table.mergeCells').check(base(one([]), { log: [entry(0, 'block.update')] })).pass).toBe(false);
    expect(usedAction('table.mergeCells').check(base(one([]), { log: [entry(0, 'table.mergeCells', 'PRECONDITION_FAILED')] })).pass).toBe(false);
  });

  it('answerIds compares the set of seed ids named in the answer', () => {
    const seed: OutputData = { blocks: [{ id: 'h1', type: 'header', data: {} }, { id: 'h2', type: 'header', data: {} }, { id: 'h3', type: 'header', data: {} }] };

    expect(answerIds(['h1', 'h3']).check({ ...base(seed), seed, answer: 'They are h3 and h1.' }).pass).toBe(true);
    expect(answerIds(['h1', 'h3']).check({ ...base(seed), seed, answer: 'h1, h2, h3' }).pass).toBe(false);
  });

  it('pageFields compares the saved page field', () => {
    const final = { blocks: [], title: 'Q3 plan', icon: { type: 'emoji', value: '📅' } } as OutputData;

    expect(pageFields({ title: 'Q3 plan', icon: { type: 'emoji', value: '📅' } }).check(base(final)).pass).toBe(true);
    expect(pageFields({ title: 'Q4' }).check(base(final)).pass).toBe(false);
  });

  it('toolSequence needs the names in order, gaps allowed', () => {
    const toolCalls = ['blok_list_documents', 'blok_open', 'blok_read', 'blok_execute', 'blok_close'];

    expect(toolSequence(['blok_open', 'blok_execute', 'blok_close']).check(base(one([]), { toolCalls })).pass).toBe(true);
    expect(toolSequence(['blok_execute', 'blok_open']).check(base(one([]), { toolCalls })).pass).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test test/unit/evals/graders-behaviour.test.ts`
Expected: FAIL, cannot resolve `behaviour`.

- [ ] **Step 3: Write `behaviour.ts`**

```ts
// test/evals/agent/graders/behaviour.ts
import type { Grader, Verdict } from '../types';
import { inOrder, plainText } from './text';

const ok = (detail: string): Verdict => ({ pass: true, detail });
const no = (detail: string): Verdict => ({ pass: false, detail });

export const MARKDOWN_FINGERPRINTS: Array<[string, RegExp]> = [
  ['**bold**', /\*\*[^*\n]+\*\*/],
  ['__bold__', /__[^_\n]+__/],
  ['`code`', /`[^`\n]+`/],
  ['# heading', /(^|\n)#{1,6} /],
  ['- or * bullet', /(^|\n)[-*] /],
  ['1. item', /(^|\n)\d+\. /],
  ['> quote', /(^|\n)> /],
  ['|---| table row', /\|\s*:?-{3,}/],
  ['``` fence', /```/],
  ['[text](url)', /\[[^\]\n]+\]\([^)\s]+\)/],
];

const residueIn = (text: string, allow: RegExp[]): string[] =>
  MARKDOWN_FINGERPRINTS.filter(([, pattern]) => pattern.test(text) && !allow.some((a) => a.test(text))).map(([label]) => label);

export const noMarkdownResidue = (allow: RegExp[] = []): Grader => ({
  name: 'noMarkdownResidue',
  check: ({ final, results }) => {
    const found = inOrder(final).flatMap((b) => residueIn(plainText(b), allow).map((label) => `${b.id ?? '?'}: ${label}`));
    const warned = (results ?? []).flatMap((r) => r.warnings ?? []).filter((w) => w.code === 'LOOKS_LIKE_MARKDOWN' && w.blockId !== undefined);
    const ignored = warned
      .map((w) => final.blocks.find((b) => b.id === w.blockId))
      .filter((b) => b !== undefined && residueIn(plainText(b), []).length > 0)
      .map((b) => `${b?.id ?? '?'}: LOOKS_LIKE_MARKDOWN warning not acted on`);
    const problems = [...found, ...ignored];

    return problems.length === 0 ? ok('no Markdown residue') : no(problems.join('; '));
  },
});

export const logClean = (maxFailedBatches = 2): Grader => ({
  name: 'logClean',
  check: ({ log }) => {
    if (log.length === 0) {
      return ok('no commands run');
    }

    const lastBatch = Math.max(...log.map((e) => e.batch));
    const failed = new Set(log.filter((e) => e.error !== undefined).map((e) => e.batch));

    if (failed.has(lastBatch)) {
      return no('the last batch failed');
    }

    return failed.size <= maxFailedBatches ? ok(`${failed.size} failed batch(es)`) : no(`${failed.size} failed batches, cap ${maxFailedBatches}`);
  },
});

export const usedAction = (command: string): Grader => ({
  name: `usedAction:${command}`,
  check: ({ log }) => (log.some((e) => e.name === command && e.error === undefined) ? ok(`${command} used`) : no(`${command} never succeeded`)),
});

export const answerIds = (expected: string[]): Grader => ({
  name: 'answerIds',
  check: ({ seed, answer }) => {
    const ids = seed.blocks.map((b) => b.id).filter((id): id is string => id !== undefined);
    const named = ids.filter((id) => new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(answer ?? '')).sort();
    const want = [...expected].sort();

    return JSON.stringify(named) === JSON.stringify(want) ? ok(named.join(', ')) : no(`named ${named.join(', ') || 'nothing'}, expected ${want.join(', ')}`);
  },
});

export const pageFields = (expected: { title?: string; icon?: unknown }): Grader => ({
  name: 'pageFields',
  check: ({ final }) => {
    // Flat OutputData.title / .icon (01 D-1).
    const page: Record<string, unknown> = { title: final.title, icon: final.icon };
    const wrong = Object.entries(expected).filter(([k, v]) => JSON.stringify(page[k]) !== JSON.stringify(v)).map(([k]) => k);

    return wrong.length === 0 ? ok('page fields match') : no(`wrong: ${wrong.join(', ')} (page = ${JSON.stringify(page)})`);
  },
});

export const toolSequence = (names: string[]): Grader => ({
  name: `toolSequence:${names.join('>')}`,
  check: ({ toolCalls }) => {
    let at = 0;

    for (const call of toolCalls ?? []) {
      if (call === names[at]) {
        at++;
      }
    }

    return at === names.length ? ok('tool order kept') : no(`saw ${(toolCalls ?? []).join(' > ')}`);
  },
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test test/unit/evals/graders-behaviour.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
node_modules/.bin/eslint test/evals/agent/graders/behaviour.ts test/unit/evals/graders-behaviour.test.ts
git add test/evals/agent/graders/behaviour.ts test/unit/evals/graders-behaviour.test.ts
git diff --cached --name-only
git commit -m "test(evals): Markdown-residue, log, action, answer and page graders

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: Collab and MCP graders (`humanPreserved`, `agentVisible`, `attributed`, `ackedOnly`, `leftRoom`)

**Files:**
- Create: `test/evals/agent/graders/collab.ts`
- Create: `test/unit/evals/graders-collab.test.ts`

**Interfaces:**
- Consumes: Task 17 types and `text.ts`.
- Produces: `agentTouched(results?: readonly ExecuteResult[]): Set<string>`, `humanPreserved(): Grader`, `agentVisible(): Grader`, `attributed(): Grader`, `ackedOnly(): Grader`, `leftRoom(): Grader`.

- [ ] **Step 1: Write the failing tests**

The `attributed` known-bad is 06 C3's required test: a block only the human typed in carries the agent's id.

```ts
// test/unit/evals/graders-collab.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutputData } from '../../../types';
import { ackedOnly, agentVisible, attributed, humanPreserved, leftRoom } from '../../evals/agent/graders/collab';
import type { ExecuteResult, GraderInput, Observed } from '../../evals/agent/types';

const final: OutputData = {
  blocks: [
    { id: 'h', type: 'paragraph', data: { text: [{ text: 'human typed this' }] }, lastEditedBy: 'human' },
    { id: 'a', type: 'list', data: { text: [{ text: 'summary' }], style: 'unordered' }, lastEditedBy: 'agent' },
  ],
} as OutputData;
const results: ExecuteResult[] = [{ ok: true, changed: { created: ['a'], updated: [], moved: [], removed: [] } }];
const observed: Observed = {
  humanId: 'human',
  humanTyped: { blockId: 'h', text: 'human typed this' },
  participants: [{ id: 'human', name: 'Ana' }, { id: 'agent', name: 'Agent' }],
  participantsAfterClose: [{ id: 'human', name: 'Ana' }],
  peerSawAgentCursorOn: ['a'],
  journalActors: ['human', 'agent'],
  serverAckedSequences: ['l1:7'],
};
const run = (over: Partial<GraderInput> = {}): GraderInput => ({ seed: { blocks: [] }, final, actorId: 'agent', log: [], results, observed, ...over });

describe('collab graders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('humanPreserved needs every typed character', () => {
    expect(humanPreserved().check(run()).pass).toBe(true);
    expect(humanPreserved().check(run({ observed: { ...observed, humanTyped: { blockId: 'h', text: 'human typed this too' } } })).pass).toBe(false);
  });

  it('agentVisible needs the participant row and a cursor on a touched block', () => {
    expect(agentVisible().check(run()).pass).toBe(true);
    expect(agentVisible().check(run({ observed: { ...observed, peerSawAgentCursorOn: [] } })).pass).toBe(false);
    expect(agentVisible().check(run({ observed: { ...observed, participants: [{ id: 'human', name: 'Ana' }] } })).pass).toBe(false);
  });

  it('attributed fails when a human-only block carries the agent id (06 C3)', () => {
    const stolen = { blocks: final.blocks.map((b) => (b.id === 'h' ? { ...b, lastEditedBy: 'agent' } : b)) } as OutputData;

    expect(attributed().check(run()).pass).toBe(true);
    expect(attributed().check(run({ final: stolen })).pass).toBe(false);
  });

  it('attributed fails when the journal does not name the agent', () => {
    expect(attributed().check(run({ observed: { ...observed, journalActors: ['human'] } })).pass).toBe(false);
  });

  it('ackedOnly fails on durable work the server never acked', () => {
    const durable = (seq: string | null): ExecuteResult[] => [{ ok: true, delivery: { durable: true, pending: false, serverSequence: seq, savedVersion: null } }];

    expect(ackedOnly().check(run({ results: durable('l1:7') })).pass).toBe(true);
    expect(ackedOnly().check(run({ results: durable('l1:9') })).pass).toBe(false);
    expect(ackedOnly().check(run({ results: durable(null) })).pass).toBe(false);
  });

  it('leftRoom needs the agent gone from the participants after close', () => {
    expect(leftRoom().check(run()).pass).toBe(true);
    expect(leftRoom().check(run({ observed: { ...observed, participantsAfterClose: observed.participants } })).pass).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test test/unit/evals/graders-collab.test.ts`
Expected: FAIL, cannot resolve `collab`.

- [ ] **Step 3: Write `collab.ts`**

```ts
// test/evals/agent/graders/collab.ts
import type { ExecuteResult, Grader, Verdict } from '../types';
import { plainText } from './text';

const ok = (detail: string): Verdict => ({ pass: true, detail });
const no = (detail: string): Verdict => ({ pass: false, detail });

export const agentTouched = (results?: readonly ExecuteResult[]): Set<string> =>
  new Set((results ?? []).flatMap((r) => (r.changed === undefined ? [] : [...r.changed.created, ...r.changed.updated, ...r.changed.moved])));

export const humanPreserved = (): Grader => ({
  name: 'humanPreserved',
  check: ({ final, observed }) => {
    const typed = observed?.humanTyped;

    if (typed === undefined) {
      return no('no record of what the human typed');
    }

    const block = final.blocks.find((b) => b.id === typed.blockId);

    return block !== undefined && plainText(block).includes(typed.text) ? ok('human text kept') : no(`"${typed.text}" missing from ${typed.blockId}`);
  },
});

export const agentVisible = (): Grader => ({
  name: 'agentVisible',
  check: ({ actorId, observed, results }) => {
    if (!(observed?.participants ?? []).some((p) => p.id === actorId)) {
      return no('agent not in the participants list');
    }

    const touched = agentTouched(results);
    const seen = (observed?.peerSawAgentCursorOn ?? []).filter((id) => touched.has(id));

    // Block-level is enough (06 §10.2).
    return seen.length > 0 ? ok(`cursor seen on ${seen.join(', ')}`) : no('peer never saw agentCursor on a block the agent touched');
  },
});

export const attributed = (): Grader => ({
  name: 'attributed',
  check: ({ final, actorId, results, observed }) => {
    const touched = agentTouched(results);
    const problems: string[] = [];

    for (const block of final.blocks) {
      const by = (block as { lastEditedBy?: string }).lastEditedBy;

      if (block.id !== undefined && touched.has(block.id) && by !== actorId) {
        problems.push(`${block.id} touched by the agent but lastEditedBy=${by ?? 'none'}`);
      }
    }

    const human = observed?.humanTyped?.blockId;

    if (human !== undefined && !touched.has(human)) {
      const by = (final.blocks.find((b) => b.id === human) as { lastEditedBy?: string } | undefined)?.lastEditedBy;

      if (by !== observed?.humanId) {
        problems.push(`${human} only the human typed in, but lastEditedBy=${by ?? 'none'}`);
      }
    }

    if (observed?.journalActors !== undefined && !observed.journalActors.includes(actorId)) {
      problems.push('journal actors do not name the agent');
    }

    return problems.length === 0 ? ok('attribution correct') : no(problems.join('; '));
  },
});

export const ackedOnly = (): Grader => ({
  name: 'ackedOnly',
  check: ({ results, observed }) => {
    const acked = new Set(observed?.serverAckedSequences ?? []);
    const bad = (results ?? []).filter((r) => {
      const d = r.delivery;

      return d !== undefined && d.durable && d.savedVersion === null && (d.serverSequence === null || !acked.has(d.serverSequence));
    });

    return bad.length === 0 ? ok('every durable result was acked') : no(`${bad.length} result(s) reported durable without an ack`);
  },
});

export const leftRoom = (): Grader => ({
  name: 'leftRoom',
  check: ({ actorId, observed }) => {
    const after = observed?.participantsAfterClose;

    if (after === undefined) {
      return no('participants after close were not recorded');
    }

    return after.some((p) => p.id === actorId) ? no('agent still listed after close') : ok('agent left');
  },
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test test/unit/evals/graders-collab.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
node_modules/.bin/eslint test/evals/agent/graders/collab.ts test/unit/evals/graders-collab.test.ts
git add test/evals/agent/graders/collab.ts test/unit/evals/graders-collab.test.ts
git diff --cached --name-only
git commit -m "test(evals): collab and MCP delivery graders

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 20: The fifteen eval tasks and the per-commit grader self-test

Each task's `seed`, `reference` and `knownBad` live in JSON under `test/fixtures/agent-commands/evals/`, so the C# runners read every reference as a parity case too (Task 12 loader). The `.ts` file adds the graders and imports the JSON with a default import.

**Gated on:** Task 7 (`openJsonSession`, `validateSaved`). Commands named in references must exist (01, 02); a reference that fails with `INVALID_ARGS` means an action's landed arg schema differs from the 02 §3.8 sketch used below. Fix the reference to the landed schema, never the grader.

**Files:**
- Create: `test/fixtures/agent-commands/evals/<id>.json` × 15
- Create: `test/evals/agent/tasks/<id>.ts` × 15, `test/evals/agent/tasks/index.ts`
- Create: `test/unit/agent/eval-graders.test.ts`
- Create (generated, reviewed): goldens `test/fixtures/agent-commands/goldens/eval__<id>.json`

**Interfaces:**
- Consumes: Tasks 17–19 graders; `openJsonSession`, `validateSaved`, `TEST_ACTOR` (Task 7).
- Produces: `ALL_TASKS: EvalTask[]` from `test/evals/agent/tasks/index.ts`.

- [ ] **Step 1: Write the failing self-test**

```ts
// test/unit/agent/eval-graders.test.ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ALL_TASKS } from '../../evals/agent/tasks';
import type { EvalTask, ExecuteResult, GraderInput, LogEntry } from '../../evals/agent/types';
import { TEST_ACTOR, openJsonSession } from './harness';

const referenceInput = async (task: EvalTask): Promise<GraderInput> => {
  const shared = {
    seed: task.seed,
    actorId: TEST_ACTOR.id,
    toolCalls: task.referenceToolCalls,
    answer: task.referenceAnswer,
    observed: task.referenceObserved,
  };

  if (task.referenceFinal !== undefined) {
    return { ...shared, final: task.referenceFinal, log: task.referenceLog ?? [], results: task.referenceResults };
  }

  const session = openJsonSession(task.seed);
  const results: ExecuteResult[] = [];

  for (const batch of task.reference) {
    results.push((await session.execute(batch)) as ExecuteResult);
  }

  return { ...shared, final: session.output(), log: session.log() as readonly LogEntry[], results: task.referenceResults ?? results };
};

/** A grader that throws is a grader bug, never a fail (05 §3.4). */
const verdicts = (task: EvalTask, input: GraderInput): Array<{ name: string; pass: boolean; detail: string }> =>
  task.graders.map((g) => ({ name: g.name, ...g.check(input) }));

describe.each(ALL_TASKS)('eval task $id', (task) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('its reference passes every grader', async () => {
    expect(verdicts(task, await referenceInput(task)).filter((v) => !v.pass)).toEqual([]);
  });

  it('has at least one known-bad', () => {
    expect(task.knownBad.length).toBeGreaterThan(0);
  });

  it.each(task.knownBad.map((bad, index) => ({ ...bad, index })))('known-bad $index ($why) fails a grader', (bad) => {
    const input: GraderInput = {
      seed: task.seed,
      final: bad.final,
      actorId: TEST_ACTOR.id,
      log: bad.log ?? [],
      results: bad.results,
      toolCalls: bad.toolCalls,
      answer: bad.answer,
      observed: bad.observed ?? task.referenceObserved,
    };

    expect(verdicts(task, input).some((v) => !v.pass)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test test/unit/agent/eval-graders.test.ts`
Expected: FAIL, cannot resolve `../../evals/agent/tasks`.

- [ ] **Step 3: Write the fifteen fixtures and task files**

Shared header for every task file:

```ts
import type { EvalTask } from '../types';
import { schemaValid, sequence, shape, text, marks, untouched, unchanged, dataCheck } from '../graders/structure';
import { noMarkdownResidue, logClean, usedAction, answerIds, pageFields, toolSequence } from '../graders/behaviour';
import { humanPreserved, agentVisible, attributed, ackedOnly, leftRoom } from '../graders/collab';
import { validateSaved } from '../../../unit/agent/harness';
```

(Import only what each file uses; eslint flags the rest.)

**1. `markdown-regression`** (surfaces `in-app`, `mcp-stored`). The exact failure from the brief.

```json
{
  "id": "markdown-regression",
  "seed": { "blocks": [ { "id": "p1", "type": "paragraph", "data": { "text": [{ "text": "Notes" }] } } ] },
  "reference": [ { "commands": [
    { "name": "block.insert", "args": { "id": "h", "type": "header", "data": { "text": "Plan", "level": 2 }, "position": "end" } },
    { "name": "block.insert", "args": { "id": "i", "type": "paragraph", "data": { "text": [{ "text": "We ship in three steps.", "marks": { "bold": true } }] }, "position": "end" } },
    { "name": "block.insert", "args": { "id": "l1", "type": "list", "data": { "text": "Write the spec", "style": "unordered" }, "position": "end" } },
    { "name": "block.insert", "args": { "id": "l2", "type": "list", "data": { "text": "Build it", "style": "unordered" }, "position": "end" } },
    { "name": "block.insert", "args": { "id": "l3", "type": "list", "data": { "text": "Ship it", "style": "unordered" }, "position": "end" } },
    { "name": "block.insert", "args": { "id": "c", "type": "code", "data": { "code": "npm run build", "language": "bash" }, "position": "end" } }
  ] } ],
  "knownBad": [
    { "why": "Markdown written into one paragraph", "final": { "blocks": [
      { "id": "p1", "type": "paragraph", "data": { "text": [{ "text": "Notes" }] } },
      { "id": "x", "type": "paragraph", "data": { "text": [{ "text": "## Plan\n**We ship in three steps.**\n- Write the spec\n- Build it\n- Ship it\n```\nnpm run build\n```" }] } }
    ] } }
  ]
}
```

```ts
// test/evals/agent/tasks/markdown-regression.ts
import fixture from '../../../fixtures/agent-commands/evals/markdown-regression.json';

export const markdownRegression: EvalTask = {
  ...(fixture as Pick<EvalTask, 'id' | 'seed' | 'reference' | 'knownBad'>),
  prompt: 'Add a section titled "Plan": a bold intro "We ship in three steps.", three bullets "Write the spec", "Build it" and "Ship it", and a code sample with npm run build.',
  surfaces: ['in-app', 'mcp-stored'],
  graders: [
    noMarkdownResidue(),
    sequence('plan section', ['header', 'paragraph', 'list', 'list', 'list', 'code']),
    text('heading', { type: 'header' }, 'Plan'),
    marks('bold intro', { type: 'paragraph', nth: 1 }, 'We ship in three steps.', { bold: true }),
    schemaValid(validateSaved),
    logClean(2),
  ],
  budget: { maxTurns: 8, maxOutputTokens: 8000 },
};
```

**2. `markdown-import`** (`mcp-stored`).

```json
{
  "id": "markdown-import",
  "seed": { "blocks": [
    { "id": "p0", "type": "paragraph", "data": { "text": [{ "text": "Weekly note" }] } },
    { "id": "p1", "type": "paragraph", "data": { "text": [{ "text": "## Goals\n- ship v1\n- write docs\n\n**Owner:** Ana" }] } }
  ] },
  "reference": [ { "commands": [
    { "name": "markdown.insert", "args": { "markdown": "## Goals\n- ship v1\n- write docs\n\n**Owner:** Ana", "position": { "after": "p1" } } },
    { "name": "block.delete", "args": { "id": "p1" } }
  ] } ],
  "knownBad": [ { "why": "left the raw Markdown in place", "final": { "blocks": [
    { "id": "p0", "type": "paragraph", "data": { "text": [{ "text": "Weekly note" }] } },
    { "id": "p1", "type": "paragraph", "data": { "text": [{ "text": "## Goals\n- ship v1\n- write docs\n\n**Owner:** Ana" }] } }
  ] } } ]
}
```

Graders: `noMarkdownResidue()`, `sequence('imported note', ['paragraph', 'header', 'list', 'list', 'paragraph'])`, `untouched(['p1'])`, `marks('owner bold', { type: 'paragraph', nth: 1 }, 'Owner:', { bold: true })`, `logClean(2)`. Prompt: `'The second paragraph is a pasted Markdown note. Turn it into proper blocks and remove the raw text.'` Budget `{ maxTurns: 8, maxOutputTokens: 6000 }`.

**3. `two-column-table`** (`in-app`).

```json
{
  "id": "two-column-table",
  "seed": { "blocks": [] },
  "reference": [ { "commands": [
    { "name": "block.insert", "args": { "id": "cl", "type": "column_list", "data": {}, "position": "end", "children": [
      { "id": "c1", "type": "column", "data": {}, "children": [ { "id": "ha", "type": "header", "data": { "text": "Plan A", "level": 3 } } ] },
      { "id": "c2", "type": "column", "data": {}, "children": [ { "id": "hb", "type": "header", "data": { "text": "Plan B", "level": 3 } } ] }
    ] } },
    { "name": "table.create", "args": { "parentId": "c1", "position": "end", "rows": 3, "cols": 2, "cells": [["Item", "Cost"], ["Hosting", "$20"], ["Support", "$50"]] } },
    { "name": "table.create", "args": { "parentId": "c2", "position": "end", "rows": 3, "cols": 2, "cells": [["Item", "Cost"], ["Hosting", "$35"], ["Support", "$0"]] } }
  ] } ],
  "knownBad": [ { "why": "a Markdown table in a paragraph", "final": { "blocks": [
    { "id": "x", "type": "paragraph", "data": { "text": [{ "text": "| Item | Cost |\n|---|---|\n| Hosting | $20 |" }] } }
  ] } } ]
}
```

Graders: `shape('two columns', { type: 'column_list', children: [{ type: 'column', children: [{ type: 'header' }, { type: 'table' }] }, { type: 'column', children: [{ type: 'header' }, { type: 'table' }] }] })`, `dataCheck('3+ rows', 'table', (d) => Array.isArray(d.content) && d.content.length >= 3, 'every table has at least 3 rows')`, `noMarkdownResidue()`, `schemaValid(validateSaved)`, `logClean(2)`. Prompt: `'Build a two-column comparison of Plan A and Plan B. Each column has a heading and a table of costs with at least three rows.'` Budget `{ maxTurns: 10, maxOutputTokens: 10000 }`.

**4. `database-status`** (`in-app`).

```json
{
  "id": "database-status",
  "seed": { "blocks": [] },
  "reference": [ { "commands": [
    { "name": "database.create", "ref": "db", "args": { "position": "end", "variant": "table",
      "properties": [ { "name": "Status", "type": "select", "options": ["Todo", "Doing", "Done"] } ],
      "rows": [ { "values": { "title": "Write spec", "Status": "Todo" } }, { "values": { "title": "Build", "Status": "Doing" } }, { "values": { "title": "Ship", "Status": "Done" } } ] } }
  ] } ],
  "knownBad": [ { "why": "a bullet list instead of a database", "final": { "blocks": [
    { "id": "a", "type": "list", "data": { "text": [{ "text": "Write spec — Todo" }], "style": "unordered" } },
    { "id": "b", "type": "list", "data": { "text": [{ "text": "Build — Doing" }], "style": "unordered" } },
    { "id": "c", "type": "list", "data": { "text": [{ "text": "Ship — Done" }], "style": "unordered" } }
  ] } } ]
}
```

Task-specific grader in `database-status.ts` (database shape from `types/tools/database.d.ts:24-45,90-93`):

```ts
import type { Grader } from '../types';

const statusOk: Grader = {
  name: 'database:status',
  check: ({ final }) => {
    const db = final.blocks.find((b) => b.type === 'database');
    const schema = (db?.data as { schema?: Array<{ id: string; type: string; config?: { options?: Array<{ id: string; label: string }> } }> } | undefined)?.schema ?? [];
    const status = schema.find((p) => p.type === 'select' && ['Todo', 'Doing', 'Done'].every((l) => p.config?.options?.some((o) => o.label === l)));

    if (status === undefined) {
      return { pass: false, detail: 'no select property with Todo/Doing/Done' };
    }

    const optionIds = new Set((status.config?.options ?? []).map((o) => o.id));
    const rows = final.blocks.filter((b) => b.type === 'database-row' && b.parent === db?.id);
    const allSet = rows.length === 3 && rows.every((r) => optionIds.has(String((r.data as { properties?: Record<string, unknown> }).properties?.[status.id])));

    return allSet ? { pass: true, detail: 'three rows with a status' } : { pass: false, detail: `${rows.length} row(s); not every row has a status option` };
  },
};
```

Graders: `shape('database with 3 rows', { type: 'database', children: [{ type: 'database-row', count: 3 }] })`, `statusOk`, `schemaValid(validateSaved)`, `logClean(2)`. Prompt: `'Add a tasks database with a Status property whose options are Todo, Doing and Done, and three rows: "Write spec" (Todo), "Build" (Doing) and "Ship" (Done).'` Budget `{ maxTurns: 10, maxOutputTokens: 8000 }`. The `database.create` args are 02 §3.8's sketch (`{ variant, properties?, rows? }`); unverified until 02 lands.

**5. `format-range`** (`mcp-stored`).

```json
{
  "id": "format-range",
  "seed": { "blocks": [
    { "id": "p1", "type": "paragraph", "data": { "text": [{ "text": "Intro" }] } },
    { "id": "p2", "type": "paragraph", "data": { "text": [{ "text": "See the quarterly report for details." }] } }
  ] },
  "reference": [ { "commands": [
    { "name": "text.format", "args": { "id": "p2", "range": { "find": "quarterly" }, "set": { "bold": true } } },
    { "name": "text.format", "args": { "id": "p2", "range": { "find": "report" }, "set": { "link": { "href": "https://example.com" } } } }
  ] } ],
  "knownBad": [ { "why": "Markdown marks typed as text", "final": { "blocks": [
    { "id": "p1", "type": "paragraph", "data": { "text": [{ "text": "Intro" }] } },
    { "id": "p2", "type": "paragraph", "data": { "text": [{ "text": "See the **quarterly** [report](https://example.com) for details." }] } }
  ] } } ]
}
```

Graders: `marks('bold', { id: 'p2' }, 'quarterly', { bold: true })`, `marks('link', { id: 'p2' }, 'report', { link: { href: 'https://example.com' } })`, `text('text kept', { id: 'p2' }, 'See the quarterly report for details.')`, `untouched(['p2'])`, `noMarkdownResidue()`. Prompt: `'In the second paragraph, make "quarterly" bold and link "report" to https://example.com.'` Budget `{ maxTurns: 6, maxOutputTokens: 4000 }`.

**6. `toggle-nest`** (`in-app-browser`).

```json
{
  "id": "toggle-nest",
  "seed": { "blocks": [
    { "id": "p0", "type": "paragraph", "data": { "text": [{ "text": "FAQ section" }] } },
    { "id": "q1", "type": "paragraph", "data": { "text": [{ "text": "How do I start?" }] } },
    { "id": "q2", "type": "paragraph", "data": { "text": [{ "text": "Where is the data?" }] } },
    { "id": "q3", "type": "paragraph", "data": { "text": [{ "text": "Who can edit?" }] } },
    { "id": "p4", "type": "paragraph", "data": { "text": [{ "text": "Footer" }] } }
  ] },
  "reference": [ { "commands": [
    { "name": "block.insert", "args": { "id": "tg", "type": "toggle", "data": { "text": "FAQ" }, "position": { "after": "p0" } } },
    { "name": "block.move", "args": { "id": "q1", "parentId": "tg", "position": "end" } },
    { "name": "block.move", "args": { "id": "q2", "parentId": "tg", "position": "end" } },
    { "name": "block.move", "args": { "id": "q3", "parentId": "tg", "position": "end" } }
  ] } ],
  "knownBad": [ { "why": "copied the text into new blocks and deleted the originals", "final": { "blocks": [
    { "id": "p0", "type": "paragraph", "data": { "text": [{ "text": "FAQ section" }] } },
    { "id": "tg", "type": "toggle", "data": { "text": [{ "text": "FAQ" }] }, "content": ["n1", "n2", "n3"] },
    { "id": "n1", "type": "paragraph", "parent": "tg", "data": { "text": [{ "text": "How do I start?" }] } },
    { "id": "n2", "type": "paragraph", "parent": "tg", "data": { "text": [{ "text": "Where is the data?" }] } },
    { "id": "n3", "type": "paragraph", "parent": "tg", "data": { "text": [{ "text": "Who can edit?" }] } },
    { "id": "p4", "type": "paragraph", "data": { "text": [{ "text": "Footer" }] } }
  ] } } ]
}
```

Graders: `shape('faq toggle', { type: 'toggle', children: [{ type: 'paragraph', id: 'q1' }, { type: 'paragraph', id: 'q2' }, { type: 'paragraph', id: 'q3' }] })`, `text('toggle title', { type: 'toggle' }, 'FAQ')`, `untouched(['q1', 'q2', 'q3'])`, `logClean(2)`. Prompt: `'Put the three question paragraphs into a toggle titled "FAQ", keeping their order.'` Budget `{ maxTurns: 8, maxOutputTokens: 6000 }`.

**7. `table-ops`** (`in-app-browser`). Seed: a 3×3 table whose cells are child paragraphs (`types/tools/table.d.ts:10-31`).

```json
{
  "id": "table-ops",
  "seed": { "blocks": [
    { "id": "t", "type": "table", "data": { "withHeadings": false, "withHeadingColumn": false, "content": [
      [{ "blocks": ["a1"] }, { "blocks": ["a2"] }, { "blocks": ["a3"] }],
      [{ "blocks": ["b1"] }, { "blocks": ["b2"] }, { "blocks": ["b3"] }],
      [{ "blocks": ["c1"] }, { "blocks": ["c2"] }, { "blocks": ["c3"] }]
    ] }, "content": ["a1", "a2", "a3", "b1", "b2", "b3", "c1", "c2", "c3"] },
    { "id": "a1", "type": "paragraph", "parent": "t", "data": { "text": [{ "text": "Name" }] } },
    { "id": "a2", "type": "paragraph", "parent": "t", "data": { "text": [{ "text": "Owner" }] } },
    { "id": "a3", "type": "paragraph", "parent": "t", "data": { "text": [{ "text": "Notes" }] } },
    { "id": "b1", "type": "paragraph", "parent": "t", "data": { "text": [{ "text": "Spec" }] } },
    { "id": "b2", "type": "paragraph", "parent": "t", "data": { "text": [] } },
    { "id": "b3", "type": "paragraph", "parent": "t", "data": { "text": [{ "text": "draft" }] } },
    { "id": "c1", "type": "paragraph", "parent": "t", "data": { "text": [{ "text": "Build" }] } },
    { "id": "c2", "type": "paragraph", "parent": "t", "data": { "text": [{ "text": "Ana" }] } },
    { "id": "c3", "type": "paragraph", "parent": "t", "data": { "text": [{ "text": "late" }] } }
  ] },
  "reference": [ { "commands": [
    { "name": "block.update", "args": { "id": "t", "data": { "withHeadings": true } } },
    { "name": "table.mergeCells", "args": { "id": "t", "range": { "fromRow": 1, "fromCol": 0, "toRow": 1, "toCol": 1 } } },
    { "name": "table.deleteColumns", "args": { "id": "t", "at": 2, "count": 1 } }
  ] } ],
  "knownBad": [ { "why": "rewrote the whole table data instead of using the actions", "log": [
    { "batch": 0, "index": 0, "name": "block.update", "args": {}, "actorId": "agent-test" }
  ], "final": { "blocks": [ { "id": "t", "type": "table", "data": { "withHeadings": true, "withHeadingColumn": false, "content": [] } } ] } } ]
}
```

Graders: `usedAction('table.mergeCells')`, `usedAction('table.deleteColumns')`, `dataCheck('heading row', 'table', (d) => d.withHeadings === true, 'heading row on')`, `dataCheck('two columns', 'table', (d) => Array.isArray(d.content) && (d.content as unknown[][]).every((row) => row.length === 2), 'last column gone')`, `dataCheck('merged', 'table', (d) => (d.content as Array<Array<{ colspan?: number }>>)[1]?.[0]?.colspan === 2, 'row 2 cells 1-2 merged')` (merge origins carry `colspan`, `src/tools/table/types.ts:40`), `logClean(2)`. Prompt: `'In the table, turn on the header row, merge the first two cells of row 2, and delete the last column.'` Budget `{ maxTurns: 10, maxOutputTokens: 8000 }`. The `range` shape is a stand-in for 02's landed `table.mergeCells` args; fix it there.

**8. `convert`** (`mcp-stored`).

```json
{
  "id": "convert",
  "seed": { "blocks": [
    { "id": "p1", "type": "paragraph", "data": { "text": [{ "text": "TODO call Ana" }] } },
    { "id": "p2", "type": "paragraph", "data": { "text": [{ "text": "Notes from Monday" }] } },
    { "id": "p3", "type": "paragraph", "data": { "text": [{ "text": "TODO send invoice" }] } }
  ] },
  "reference": [ { "commands": [
    { "name": "block.convert", "args": { "id": "p1", "type": "list", "data": { "style": "checklist" } } },
    { "name": "text.delete", "args": { "id": "p1", "range": { "find": "TODO " } } },
    { "name": "block.convert", "args": { "id": "p3", "type": "list", "data": { "style": "checklist" } } },
    { "name": "text.delete", "args": { "id": "p3", "range": { "find": "TODO " } } }
  ] } ],
  "knownBad": [ { "why": "Markdown checkboxes typed as text", "final": { "blocks": [
    { "id": "p1", "type": "paragraph", "data": { "text": [{ "text": "- [ ] call Ana" }] } },
    { "id": "p2", "type": "paragraph", "data": { "text": [{ "text": "Notes from Monday" }] } },
    { "id": "p3", "type": "paragraph", "data": { "text": [{ "text": "- [ ] send invoice" }] } }
  ] } } ]
}
```

Graders: `shape('p1 checklist', { type: 'list', id: 'p1', data: { style: 'checklist' } })`, `shape('p3 checklist', { type: 'list', id: 'p3', data: { style: 'checklist' } })`, `text('p1', { id: 'p1' }, 'call Ana')`, `text('p3', { id: 'p3' }, 'send invoice')`, `untouched(['p1', 'p3'])`, `noMarkdownResidue()`. Prompt: `'Make every line that starts with "TODO" a checklist item, and drop the "TODO" prefix.'` Budget `{ maxTurns: 8, maxOutputTokens: 6000 }`.

**9. `move-into-column`** (`in-app`).

```json
{
  "id": "move-into-column",
  "seed": { "blocks": [
    { "id": "cl", "type": "column_list", "data": {}, "content": ["c1", "c2"] },
    { "id": "c1", "type": "column", "parent": "cl", "data": {}, "content": ["l"] },
    { "id": "l", "type": "paragraph", "parent": "c1", "data": { "text": [{ "text": "Left text" }] } },
    { "id": "c2", "type": "column", "parent": "cl", "data": {}, "content": ["r"] },
    { "id": "r", "type": "paragraph", "parent": "c2", "data": { "text": [{ "text": "Right text" }] } },
    { "id": "img", "type": "image", "data": { "url": "https://example.com/a.png" } }
  ] },
  "reference": [ { "commands": [ { "name": "block.move", "args": { "id": "img", "parentId": "c2", "position": "end" } } ] } ],
  "knownBad": [ { "why": "deleted the image and inserted a copy", "final": { "blocks": [
    { "id": "cl", "type": "column_list", "data": {}, "content": ["c1", "c2"] },
    { "id": "c1", "type": "column", "parent": "cl", "data": {}, "content": ["l"] },
    { "id": "l", "type": "paragraph", "parent": "c1", "data": { "text": [{ "text": "Left text" }] } },
    { "id": "c2", "type": "column", "parent": "cl", "data": {}, "content": ["r", "img2"] },
    { "id": "r", "type": "paragraph", "parent": "c2", "data": { "text": [{ "text": "Right text" }] } },
    { "id": "img2", "type": "image", "parent": "c2", "data": { "url": "https://example.com/a.png" } }
  ] } } ]
}
```

Graders: `shape('image in right column', { type: 'column', id: 'c2', children: [{ type: 'paragraph' }, { type: 'image', id: 'img' }] })`, `dataCheck('image data kept', 'image', (d) => d.url === 'https://example.com/a.png', 'url unchanged')`, `untouched(['img'])`. Prompt: `'Move the image into the right column, below its text.'` Budget `{ maxTurns: 6, maxOutputTokens: 4000 }`.

**10. `read-and-answer`** (`mcp-stored`).

```json
{
  "id": "read-and-answer",
  "seed": { "blocks": [
    { "id": "h1", "type": "header", "data": { "text": [{ "text": "Budget 2026" }], "level": 2 } },
    { "id": "h2", "type": "header", "data": { "text": [{ "text": "Hiring" }], "level": 2 } },
    { "id": "h3", "type": "header", "data": { "text": [{ "text": "Marketing budget" }], "level": 2 } },
    { "id": "p", "type": "paragraph", "data": { "text": [{ "text": "The budget is tight." }] } }
  ] },
  "reference": [ { "commands": [ { "name": "doc.find", "args": { "text": "budget", "type": "header" } } ] } ],
  "knownBad": [
    { "why": "named the paragraph too", "answer": "h1, h3 and p", "final": { "blocks": [
      { "id": "h1", "type": "header", "data": { "text": [{ "text": "Budget 2026" }], "level": 2 } },
      { "id": "h2", "type": "header", "data": { "text": [{ "text": "Hiring" }], "level": 2 } },
      { "id": "h3", "type": "header", "data": { "text": [{ "text": "Marketing budget" }], "level": 2 } },
      { "id": "p", "type": "paragraph", "data": { "text": [{ "text": "The budget is tight." }] } }
    ] } },
    { "why": "edited a read-only question's document", "answer": "h1 and h3", "final": { "blocks": [
      { "id": "h1", "type": "header", "data": { "text": [{ "text": "Budget 2026 (checked)" }], "level": 2 } }
    ] } }
  ]
}
```

Graders: `answerIds(['h1', 'h3'])`, `unchanged()`. `referenceAnswer: 'h1 and h3'`. Prompt: `'Which headings mention "budget"? Reply with their block ids.'` Budget `{ maxTurns: 6, maxOutputTokens: 3000 }`.

**11. `custom-tool`** (`in-app-browser`, tools `rating-fixture`). Not a parity case: the rating tool exists only on the browser page (06 D6 cut handlers outside the browser).

```json
{
  "id": "custom-tool",
  "parityExcluded": "The rating tool and its handler exist only in the browser (06 D6: custom handlers outside the browser are cut).",
  "seed": { "blocks": [] },
  "reference": [ { "commands": [
    { "name": "block.insert", "args": { "id": "r", "type": "rating", "data": { "value": 0 }, "position": "end" } },
    { "name": "rating.setValue", "args": { "id": "r", "value": 4 } }
  ] } ],
  "referenceFinal": { "blocks": [ { "id": "r", "type": "rating", "data": { "value": 4 }, "lastEditedBy": "agent-test" } ] },
  "referenceLog": [
    { "batch": 0, "index": 0, "name": "block.insert", "args": {}, "actorId": "agent-test" },
    { "batch": 0, "index": 1, "name": "rating.setValue", "args": {}, "actorId": "agent-test" }
  ],
  "knownBad": [ { "why": "wrote data directly instead of the action", "final": { "blocks": [ { "id": "r", "type": "rating", "data": { "value": 4 } } ] },
    "log": [ { "batch": 0, "index": 0, "name": "block.insert", "args": {}, "actorId": "agent-test" } ] } ]
}
```

Graders: `shape('rating 4', { type: 'rating', data: { value: 4 } })`, `usedAction('rating.setValue')`. Prompt: `'Add a rating block set to 4.'` Budget `{ maxTurns: 6, maxOutputTokens: 3000 }`. `tools: 'rating-fixture'`.

**12. `live-coedit`** (`mcp-live`). The reference is a parity case from the seed; the grader self-test uses `referenceFinal` because the human's typing is not in any batch.

```json
{
  "id": "live-coedit",
  "docId": "live-coedit",
  "seed": { "blocks": [
    { "id": "p1", "type": "paragraph", "data": { "text": [{ "text": "Meeting notes:" }] } },
    { "id": "p2", "type": "paragraph", "data": { "text": [{ "text": "Action items follow." }] } }
  ] },
  "reference": [ { "commands": [
    { "name": "block.insert", "args": { "id": "s1", "type": "list", "data": { "text": "Agree on Friday", "style": "unordered" }, "position": { "after": "p1" } } },
    { "name": "block.insert", "args": { "id": "s2", "type": "list", "data": { "text": "Send recap", "style": "unordered" }, "position": { "after": "s1" } } }
  ] } ],
  "referenceFinal": { "blocks": [
    { "id": "p1", "type": "paragraph", "data": { "text": [{ "text": "Meeting notes: we agreed on Friday" }] }, "lastEditedBy": "human" },
    { "id": "s1", "type": "list", "data": { "text": [{ "text": "Agree on Friday" }], "style": "unordered" }, "lastEditedBy": "agent-test" },
    { "id": "s2", "type": "list", "data": { "text": [{ "text": "Send recap" }], "style": "unordered" }, "lastEditedBy": "agent-test" },
    { "id": "p2", "type": "paragraph", "data": { "text": [{ "text": "Action items follow." }] } }
  ] },
  "referenceResults": [ { "ok": true, "changed": { "created": ["s1", "s2"], "updated": [], "moved": [], "removed": [] },
    "delivery": { "durable": true, "pending": false, "serverSequence": "l:1", "savedVersion": null } } ],
  "referenceObserved": {
    "humanId": "human", "humanTyped": { "blockId": "p1", "text": "we agreed on Friday" },
    "participants": [ { "id": "human", "name": "Ana" }, { "id": "agent-test", "name": "Parity" } ],
    "peerSawAgentCursorOn": ["s1"], "journalActors": ["human", "agent-test"], "serverAckedSequences": ["l:1"]
  },
  "knownBad": [
    { "why": "the human's typing was lost", "final": { "blocks": [
      { "id": "p1", "type": "paragraph", "data": { "text": [{ "text": "Meeting notes:" }] }, "lastEditedBy": "human" },
      { "id": "s1", "type": "list", "data": { "text": [{ "text": "Agree on Friday" }], "style": "unordered" }, "lastEditedBy": "agent-test" },
      { "id": "s2", "type": "list", "data": { "text": [{ "text": "Send recap" }], "style": "unordered" }, "lastEditedBy": "agent-test" },
      { "id": "p2", "type": "paragraph", "data": { "text": [{ "text": "Action items follow." }] } }
    ] } },
    { "why": "the human-only block carries the agent's id (06 C3)", "results": [ { "ok": true, "changed": { "created": ["s1", "s2"], "updated": [], "moved": [], "removed": [] } } ], "final": { "blocks": [
      { "id": "p1", "type": "paragraph", "data": { "text": [{ "text": "Meeting notes: we agreed on Friday" }] }, "lastEditedBy": "agent-test" },
      { "id": "s1", "type": "list", "data": { "text": [{ "text": "Agree on Friday" }], "style": "unordered" }, "lastEditedBy": "agent-test" },
      { "id": "s2", "type": "list", "data": { "text": [{ "text": "Send recap" }], "style": "unordered" }, "lastEditedBy": "agent-test" },
      { "id": "p2", "type": "paragraph", "data": { "text": [{ "text": "Action items follow." }] } }
    ] } }
  ]
}
```

Graders: `humanPreserved()`, `agentVisible()`, `attributed()`, `ackedOnly()`, `sequence('summary below p1', ['paragraph', 'list', 'list', 'paragraph'])`, `noMarkdownResidue()`. Prompt: `'Add a bullet list summary with two items, "Agree on Friday" and "Send recap", right below the first paragraph.'` Budget `{ maxTurns: 8, maxOutputTokens: 5000 }`.

**13. `stored-lifecycle`** (`mcp-stored`).

```json
{
  "id": "stored-lifecycle",
  "docId": "doc-x",
  "seed": { "blocks": [ { "id": "p1", "type": "paragraph", "data": { "text": [{ "text": "Report body" }] } } ] },
  "reference": [ { "commands": [
    { "name": "block.insert", "args": { "id": "end", "type": "paragraph", "data": { "text": "Thanks for reading." }, "position": "end" } }
  ] } ],
  "referenceToolCalls": ["blok_list_documents", "blok_open", "blok_execute", "blok_close"],
  "knownBad": [ { "why": "never closed, so nothing was saved", "toolCalls": ["blok_list_documents", "blok_open", "blok_execute"],
    "final": { "blocks": [ { "id": "p1", "type": "paragraph", "data": { "text": [{ "text": "Report body" }] } } ] } } ]
}
```

Graders: `toolSequence(['blok_list_documents', 'blok_open', 'blok_execute', 'blok_close'])`, `text('closing', { type: 'paragraph', nth: 1 }, 'Thanks for reading.')`, `ackedOnly()`. Prompt: `'Open the document "doc-x", add a closing paragraph "Thanks for reading.", and save it.'` Budget `{ maxTurns: 8, maxOutputTokens: 4000 }`.

**14. `page-title-icon`** (`in-app`, `mcp-stored`).

```json
{
  "id": "page-title-icon",
  "seed": { "blocks": [ { "id": "p1", "type": "paragraph", "data": { "text": [{ "text": "Body" }] } } ] },
  "reference": [ { "commands": [
    { "name": "doc.setTitle", "args": { "title": "Q3 plan" } },
    { "name": "doc.setIcon", "args": { "icon": { "type": "emoji", "value": "📅" } } }
  ] } ],
  "knownBad": [ { "why": "wrote the title as a heading block", "final": { "blocks": [
    { "id": "t", "type": "header", "data": { "text": [{ "text": "📅 Q3 plan" }], "level": 1 } },
    { "id": "p1", "type": "paragraph", "data": { "text": [{ "text": "Body" }] } }
  ] } } ]
}
```

Graders: `pageFields({ title: 'Q3 plan', icon: { type: 'emoji', value: '📅' } })`, `unchanged()`, `usedAction('doc.setTitle')`, `usedAction('doc.setIcon')`. Prompt: `'Rename this page to "Q3 plan" and give it a 📅 icon.'` Budget `{ maxTurns: 6, maxOutputTokens: 3000 }`.

**15. `live-lifecycle`** (`mcp-live`).

```json
{
  "id": "live-lifecycle",
  "docId": "room-y",
  "seed": { "blocks": [ { "id": "p1", "type": "paragraph", "data": { "text": [{ "text": "Live doc" }] } } ] },
  "reference": [ { "commands": [
    { "name": "block.insert", "args": { "id": "w", "type": "header", "data": { "text": "Wrap-up", "level": 2 }, "position": "end" } }
  ] } ],
  "referenceToolCalls": ["blok_open", "blok_execute", "blok_close"],
  "referenceResults": [ { "ok": true, "changed": { "created": ["w"], "updated": [], "moved": [], "removed": [] },
    "delivery": { "durable": true, "pending": false, "serverSequence": "l:1", "savedVersion": null } } ],
  "referenceObserved": {
    "participants": [ { "id": "human", "name": "Ana" }, { "id": "agent-test", "name": "Parity" } ],
    "participantsAfterClose": [ { "id": "human", "name": "Ana" } ],
    "serverAckedSequences": ["l:1"]
  },
  "knownBad": [ { "why": "never left the room", "toolCalls": ["blok_open", "blok_execute"],
    "observed": { "participants": [ { "id": "agent-test", "name": "Parity" } ], "participantsAfterClose": [ { "id": "agent-test", "name": "Parity" } ], "serverAckedSequences": ["l:1"] },
    "final": { "blocks": [ { "id": "p1", "type": "paragraph", "data": { "text": [{ "text": "Live doc" }] } }, { "id": "w", "type": "header", "data": { "text": [{ "text": "Wrap-up" }], "level": 2 } } ] } } ]
}
```

Graders: `toolSequence(['blok_open', 'blok_execute', 'blok_close'])`, `leftRoom()`, `ackedOnly()`, `sequence('heading at end', ['paragraph', 'header'])`. Prompt: `'Join the room "room-y", add a heading "Wrap-up" at the end, then leave.'` Budget `{ maxTurns: 6, maxOutputTokens: 3000 }`.

`tasks/index.ts`:

```ts
import { convert } from './convert';
import { customTool } from './custom-tool';
import { databaseStatus } from './database-status';
import { formatRange } from './format-range';
import { liveCoedit } from './live-coedit';
import { liveLifecycle } from './live-lifecycle';
import { markdownImport } from './markdown-import';
import { markdownRegression } from './markdown-regression';
import { moveIntoColumn } from './move-into-column';
import { pageTitleIcon } from './page-title-icon';
import { readAndAnswer } from './read-and-answer';
import { storedLifecycle } from './stored-lifecycle';
import { tableOps } from './table-ops';
import { toggleNest } from './toggle-nest';
import { twoColumnTable } from './two-column-table';
import type { EvalTask } from '../types';

export const ALL_TASKS: EvalTask[] = [
  markdownRegression, markdownImport, twoColumnTable, databaseStatus, formatRange, toggleNest, tableOps,
  convert, moveIntoColumn, readAndAnswer, customTool, liveCoedit, storedLifecycle, pageTitleIcon, liveLifecycle,
];
```

Every task file follows the `markdown-regression.ts` shape: spread the JSON fixture, then `prompt`, `surfaces`, `graders`, `budget` (and `tools` for `custom-tool`).

- [ ] **Step 4: Run the self-test**

Run: `yarn test test/unit/agent/eval-graders.test.ts`
Expected: PASS. A reference that fails a grader is either a reference written against a sketch arg shape (fix the args to the landed schema) or a real applier bug (report to 01/02 with the task id). A known-bad that passes every grader means the graders miss that failure: add or tighten a grader, never delete the known-bad.

- [ ] **Step 5: Generate and review the new goldens**

The fourteen non-excluded references are now parity cases (`eval:<id>`).
Run: `BLOK_UPDATE_GOLDENS=1 yarn test test/unit/agent/parity/json-runner.test.ts`, then review each `goldens/eval__*.json` by hand as in Task 7 Step 6 and set its `reviewed`, then run `yarn test test/unit/agent/parity/json-runner.test.ts` and `yarn test test/unit/agent/parity/store-runner.test.ts` (both PASS).

- [ ] **Step 6: Lint and commit**

```bash
node_modules/.bin/eslint test/evals/agent/tasks test/unit/agent/eval-graders.test.ts
git add test/fixtures/agent-commands/evals test/fixtures/agent-commands/goldens test/evals/agent/tasks test/unit/agent/eval-graders.test.ts
git diff --cached --name-only
git commit -m "test(evals): fifteen eval tasks with references and known-bads

Each reference passes its graders and each known-bad fails one, on
every commit, with no model. Fourteen references join the parity corpus.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Checkpoint 5

- [ ] Each Phase 5 unit file alone: PASS. `json-runner.test.ts` and `store-runner.test.ts`: PASS with the new eval cases. The C# `Agent` filter: PASS (it reads the new eval fixtures too).
- [ ] `yarn lint`: exit 0.
- [ ] `git pull --rebase && git push`; up to date.

---
# Phase 6 — Manual eval runner (D3: `workflow_dispatch` only, token caps)

The model calls follow the `claude-api` skill (read in this session): `client.messages.create({ model, max_tokens, tools, messages, output_config: { effort } })`, a manual tool loop that returns all `tool_result` blocks in one user message, `stop_reason` checked before reading content. Three rules from it bind this runner:

- No forced `tool_choice` (`any`/`tool` return 400 on `claude-opus-5-5`). The loop sends no `tool_choice`.
- `claude-opus-5-5` cannot disable thinking, and its effort defaults to `medium`. The runner always sets `output_config.effort` explicitly and records the model and effort in every result.
- A `refusal` stop is recorded as `error` with its `stop_details`. Server-side `fallbacks` stay **off on purpose**: a fallback would answer with a different model inside one measured trial and mix two models into one pass rate.

The default model is `claude-opus-5-5` (the skill's default); the workflow input overrides it.

### Task 21: Dependencies and the model loop with caps

**Files:**
- Modify: `package.json` (devDependencies only; approved under D3/R3-10), `yarn.lock`
- Create: `test/evals/agent/runner/model-loop.ts`
- Create: `test/unit/evals/model-loop.test.ts`

**Interfaces:**
- Consumes: `@anthropic-ai/sdk` types (`Anthropic.Message`, `Anthropic.MessageParam`, `Anthropic.Tool`, `Anthropic.ToolUseBlock`, `Anthropic.ToolResultBlockParam`, `Anthropic.MessageCreateParamsNonStreaming`).
- Produces:

```ts
export interface MessagesClient { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> }
export interface ToolOutcome { content: string; isError: boolean }
export type Execute = (name: string, input: unknown) => Promise<ToolOutcome>;
export class TokenBudget { constructor(total: number); spend(tokens: number): void; get remaining(): number; get spent(): number }
export interface LoopResult {
  stop: 'done' | 'turn-cap' | 'run-token-cap' | 'dispatch-token-cap' | 'refusal' | 'max-tokens';
  answer: string; turns: number; inputTokens: number; outputTokens: number; toolCalls: string[]; detail?: string;
}
export const runModelLoop(options: {
  client: MessagesClient; model: string; effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  system: string; prompt: string; tools: Anthropic.Tool[]; execute: Execute;
  budget: { maxTurns: number; maxOutputTokens: number }; dispatch: TokenBudget;
}): Promise<LoopResult>;
export const classifyTrial(loop: LoopResult, verdicts: Array<{ pass: boolean }>, graderThrew: boolean): 'pass' | 'fail' | 'error';
```

- [ ] **Step 1: Add the devDependencies**

Run: `yarn add -D -E @anthropic-ai/sdk@0.132.0`
Gated on 04 Task 1, which adds `@modelcontextprotocol/client` 2.3.1 (the one MCP client devDependency; do not add `@modelcontextprotocol/sdk`). Check with `grep -n '"@modelcontextprotocol/client"' package.json`.
Expected: `package.json` gains the one exact pin under `devDependencies`; `yarn.lock` updates. Read the `package.json` diff: nothing else may change (CLAUDE.md, Configuration).

- [ ] **Step 2: Run the dependency laws**

Run each alone: `yarn test test/unit/architecture/dependency-security-law.test.ts`, `yarn test test/unit/architecture/no-phantom-dependencies-law.test.ts`, `yarn test test/unit/architecture/package-metadata-law.test.ts`, `yarn test test/unit/architecture/engines-consistency-law.test.ts`.
Expected: all PASS. If one fails, fix the cause in this task (for example a peer engine range), and say what changed in the commit message.

- [ ] **Step 3: Write the failing loop tests**

```ts
// test/unit/evals/model-loop.test.ts
import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TokenBudget, classifyTrial, runModelLoop } from '../../evals/agent/runner/model-loop';
import type { MessagesClient } from '../../evals/agent/runner/model-loop';

const message = (content: Anthropic.ContentBlock[], stop: Anthropic.Message['stop_reason'], usage = { input_tokens: 100, output_tokens: 50 }): Anthropic.Message =>
  ({ id: 'm', type: 'message', role: 'assistant', model: 'test', content, stop_reason: stop, stop_sequence: null, usage } as unknown as Anthropic.Message);

const toolUse = (id: string): Anthropic.ContentBlock => ({ type: 'tool_use', id, name: 'blok_execute', input: { commands: [] } } as unknown as Anthropic.ContentBlock);
const textBlock = (text: string): Anthropic.ContentBlock => ({ type: 'text', text, citations: null } as unknown as Anthropic.ContentBlock);

const options = (client: MessagesClient, dispatch = new TokenBudget(1_000_000)) => ({
  client,
  model: 'claude-opus-5-5',
  effort: 'high' as const,
  system: 'sys',
  prompt: 'do it',
  tools: [],
  execute: vi.fn(async () => ({ content: '{"ok":true}', isError: false })),
  budget: { maxTurns: 3, maxOutputTokens: 10_000 },
  dispatch,
});

describe('runModelLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops at the turn cap when every reply is a tool call (no runaway loop)', async () => {
    const create = vi.fn(async () => message([toolUse('t')], 'tool_use'));
    const result = await runModelLoop(options({ create }));

    expect(result.stop).toBe('turn-cap');
    expect(create).toHaveBeenCalledTimes(3);
    expect(classifyTrial(result, [{ pass: true }], false)).toBe('fail');
  });

  it('stops the whole dispatch at its token cap and calls it an error', async () => {
    const dispatch = new TokenBudget(120);
    const create = vi.fn(async () => message([toolUse('t')], 'tool_use'));
    const result = await runModelLoop(options({ create }, dispatch));

    expect(result.stop).toBe('dispatch-token-cap');
    expect(create).toHaveBeenCalledTimes(1);
    expect(classifyTrial(result, [{ pass: true }], false)).toBe('error');
  });

  it('finishes on a text reply and returns it as the answer', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce(message([toolUse('a'), toolUse('b')], 'tool_use'))
      .mockResolvedValueOnce(message([textBlock('done: h1')], 'end_turn'));
    const opts = options({ create });
    const result = await runModelLoop(opts);

    expect(result).toMatchObject({ stop: 'done', answer: 'done: h1', turns: 2, toolCalls: ['blok_execute', 'blok_execute'] });
    expect(opts.execute).toHaveBeenCalledTimes(2);

    // Both tool results go back in ONE user message.
    const second = create.mock.calls[1][0] as Anthropic.MessageCreateParamsNonStreaming;
    const last = second.messages[second.messages.length - 1];

    expect(last.role).toBe('user');
    expect(Array.isArray(last.content) && last.content.length).toBe(2);
  });

  it('never forces a tool and always sets effort', async () => {
    const create = vi.fn(async () => message([textBlock('ok')], 'end_turn'));

    await runModelLoop(options({ create }));

    const params = create.mock.calls[0][0] as Anthropic.MessageCreateParamsNonStreaming & { output_config?: { effort?: string } };

    expect(params.tool_choice).toBeUndefined();
    expect(params.output_config?.effort).toBe('high');
  });

  it('records a refusal as an error', async () => {
    const create = vi.fn(async () => ({ ...message([], 'refusal'), stop_details: { type: 'refusal', category: 'cyber', explanation: 'x' } } as unknown as Anthropic.Message));
    const result = await runModelLoop(options({ create }));

    expect(result.stop).toBe('refusal');
    expect(classifyTrial(result, [{ pass: true }], false)).toBe('error');
  });

  it('a grader that throws is an error, a failing grader is a fail', () => {
    const done = { stop: 'done' as const, answer: '', turns: 1, inputTokens: 0, outputTokens: 0, toolCalls: [] };

    expect(classifyTrial(done, [{ pass: true }], true)).toBe('error');
    expect(classifyTrial(done, [{ pass: false }], false)).toBe('fail');
    expect(classifyTrial(done, [{ pass: true }], false)).toBe('pass');
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `yarn test test/unit/evals/model-loop.test.ts`
Expected: FAIL, cannot resolve `model-loop`.

- [ ] **Step 5: Write `model-loop.ts`**

```ts
// test/evals/agent/runner/model-loop.ts
import type Anthropic from '@anthropic-ai/sdk';

export interface MessagesClient {
  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
}

export type Execute = (name: string, input: unknown) => Promise<ToolOutcome>;

export class TokenBudget {
  private used = 0;

  public constructor(private readonly total: number) {}

  public spend(tokens: number): void {
    this.used += tokens;
  }

  public get remaining(): number {
    return this.total - this.used;
  }

  public get spent(): number {
    return this.used;
  }
}

export interface LoopResult {
  stop: 'done' | 'turn-cap' | 'run-token-cap' | 'dispatch-token-cap' | 'refusal' | 'max-tokens';
  answer: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: string[];
  detail?: string;
}

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// Non-streaming keeps requests under SDK timeouts at this size (claude-api skill, max_tokens defaults).
const PER_CALL_MAX_TOKENS = 16_000;

export const runModelLoop = async (o: {
  client: MessagesClient;
  model: string;
  effort: Effort;
  system: string;
  prompt: string;
  tools: Anthropic.Tool[];
  execute: Execute;
  budget: { maxTurns: number; maxOutputTokens: number };
  dispatch: TokenBudget;
}): Promise<LoopResult> => {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: o.prompt }];
  const result: LoopResult = { stop: 'turn-cap', answer: '', turns: 0, inputTokens: 0, outputTokens: 0, toolCalls: [] };

  while (result.turns < o.budget.maxTurns) {
    if (o.dispatch.remaining <= 0) {
      return { ...result, stop: 'dispatch-token-cap' };
    }

    const params = {
      model: o.model,
      max_tokens: Math.max(1, Math.min(PER_CALL_MAX_TOKENS, o.budget.maxOutputTokens - result.outputTokens)),
      system: o.system,
      tools: o.tools,
      messages,
      output_config: { effort: o.effort },
    } as Anthropic.MessageCreateParamsNonStreaming;
    const response = await o.client.create(params);

    result.turns += 1;
    result.inputTokens += response.usage.input_tokens;
    result.outputTokens += response.usage.output_tokens;
    o.dispatch.spend(response.usage.input_tokens + response.usage.output_tokens);

    if (response.stop_reason === 'refusal') {
      return { ...result, stop: 'refusal', detail: JSON.stringify((response as { stop_details?: unknown }).stop_details ?? null) };
    }

    if (response.stop_reason === 'max_tokens') {
      return { ...result, stop: 'max-tokens' };
    }

    messages.push({ role: 'assistant', content: response.content });

    const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

    if (uses.length === 0) {
      const answer = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n');

      return { ...result, stop: 'done', answer };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const use of uses) {
      result.toolCalls.push(use.name);

      const outcome = await o.execute(use.name, use.input);

      toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: outcome.content, is_error: outcome.isError });
    }

    messages.push({ role: 'user', content: toolResults });

    if (result.outputTokens >= o.budget.maxOutputTokens) {
      return { ...result, stop: 'run-token-cap' };
    }

    if (o.dispatch.remaining <= 0) {
      return { ...result, stop: 'dispatch-token-cap' };
    }
  }

  return result;
};

/** Infra stops and grader bugs are `error` and never count against the pass rate (05 §3.4). */
export const classifyTrial = (loop: LoopResult, verdicts: Array<{ pass: boolean }>, graderThrew: boolean): 'pass' | 'fail' | 'error' => {
  if (graderThrew || loop.stop === 'refusal' || loop.stop === 'dispatch-token-cap') {
    return 'error';
  }

  if (loop.stop !== 'done') {
    return 'fail';
  }

  return verdicts.every((v) => v.pass) ? 'pass' : 'fail';
};
```

If `output_config` is not on `MessageCreateParamsNonStreaming` in SDK 0.132.0, the `as` cast keeps it; check with `grep -n "output_config" node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts` and drop the cast if the type has it.

- [ ] **Step 6: Run to verify it passes**

Run: `yarn test test/unit/evals/model-loop.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Lint and commit**

```bash
node_modules/.bin/eslint test/evals/agent/runner/model-loop.ts test/unit/evals/model-loop.test.ts
git add package.json yarn.lock test/evals/agent/runner/model-loop.ts test/unit/evals/model-loop.test.ts
git diff --cached --name-only
git commit -m "test(evals): model loop with turn and token caps; eval SDK devDependencies

Adds @anthropic-ai/sdk 0.132.0 as a devDependency (approved under D3).
The MCP client is @modelcontextprotocol/client, added by plan 04. No server-side fallbacks: one
trial measures one model.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 22: Running a task on the Node surfaces (`in-app`, `mcp-stored`)

**Gated on:** 03's `renderAgentTools`; 04's `blok-mcp` with `--source files:<dir>` and `--schema`.

**Files:**
- Create: `test/evals/agent/runner/run-task.ts`
- Create: `test/evals/agent/runner/surfaces/in-app.ts`
- Create: `test/evals/agent/runner/surfaces/mcp.ts`
- Create: `test/evals/agent/runner/node-surfaces.eval.ts`
- Create: `test/evals/agent/vitest.evals.config.ts`
- Create: `test/evals/agent/runner/replay-client.ts`
- Create: `test/unit/evals/run-task.test.ts`
- Create: `test/unit/evals/in-app-replay.test.ts` (per commit, no model)

**Interfaces:**
- Consumes: Task 21 loop; Task 20 `ALL_TASKS`; Task 7 `openJsonSession`, `nodeContract`, `TEST_ACTOR`; `renderAgentTools`; MCP `Client` (`@modelcontextprotocol/client`, `connect(transport)`, `listTools()`, `callTool(params)`) and `StdioClientTransport({ command, args?, env?, cwd? })` (`@modelcontextprotocol/client/stdio`) — read from the packed 2.3.1 `.d.mts` (`index.d.mts:2317`, `:2694`, `:2722`; `stdio.d.mts:6-32`, `:62`) on 2026-10-08. **Unverified:** that a 2.3.1 `Client` with no `mode` option talks to 04's `serveStdio` (both default to the legacy `initialize` opening per their docs).
- Produces:

```ts
// run-task.ts
export interface SurfaceRun {
  tools: Anthropic.Tool[];
  execute: Execute;
  finish(): Promise<{ final: OutputData; log: LogEntry[]; results: ExecuteResult[]; observed?: Observed; actorId?: string }>;
  close(): Promise<void>;
}
export type OpenSurface = (task: EvalTask, schema: 'envelope' | 'full') => Promise<SurfaceRun>;
export interface TrialRecord { taskId: string; surface: Surface; trial: number; outcome: 'pass' | 'fail' | 'error'; graders: Record<string, Verdict>; turns: number; inputTokens: number; outputTokens: number; errorDetail?: string }
export const runTrial(o: { task: EvalTask; surface: Surface; open: OpenSurface; trial: number; client: MessagesClient; model: string; effort: Effort; schema: 'envelope' | 'full'; dispatch: TokenBudget }): Promise<TrialRecord>;
export const logFromExecuteCalls(calls: Array<{ input: { commands?: Array<{ name: string; args: unknown }> }; result: ExecuteResult & { error?: { code: string; commandIndex?: number } } }>, actorId: string): LogEntry[];
export const SYSTEM_PROMPT: string;

// replay-client.ts — plays a task's reference as tool calls, so every surface is testable with no model.
export const replayClient(task: EvalTask, mode: 'session' | 'mcp'): MessagesClient;
```

- [ ] **Step 1: Write the failing tests for `runTrial` and `logFromExecuteCalls`**

```ts
// test/unit/evals/run-task.test.ts
import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TokenBudget } from '../../evals/agent/runner/model-loop';
import { logFromExecuteCalls, runTrial } from '../../evals/agent/runner/run-task';
import type { OpenSurface } from '../../evals/agent/runner/run-task';
import type { EvalTask, Grader } from '../../evals/agent/types';

const reply = (text: string): Anthropic.Message =>
  ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } as unknown as Anthropic.Message);

const task = (graders: Grader[]): EvalTask => ({
  id: 't', prompt: 'p', surfaces: ['in-app'], seed: { blocks: [] }, graders, reference: [], knownBad: [], budget: { maxTurns: 2, maxOutputTokens: 100 },
});

const open: OpenSurface = async () => ({
  tools: [],
  execute: async () => ({ content: '', isError: false }),
  finish: async () => ({ final: { blocks: [] }, log: [], results: [] }),
  close: async () => undefined,
});

const run = (graders: Grader[]) => runTrial({
  task: task(graders), surface: 'in-app', open, trial: 0, client: { create: vi.fn(async () => reply('done')) },
  model: 'm', effort: 'high', schema: 'envelope', dispatch: new TokenBudget(1000),
});

describe('runTrial', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes when every grader passes', async () => {
    expect((await run([{ name: 'g', check: () => ({ pass: true, detail: '' }) }])).outcome).toBe('pass');
  });

  it('turns a throwing grader into an error with its stack, not a fail', async () => {
    const record = await run([{ name: 'g', check: () => { throw new Error('boom'); } }]);

    expect(record.outcome).toBe('error');
    expect(record.errorDetail).toContain('boom');
  });

  it('turns a surface that fails to open into an error', async () => {
    const record = await runTrial({
      task: task([]), surface: 'in-app', open: async () => { throw new Error('server did not start'); }, trial: 0,
      client: { create: vi.fn() }, model: 'm', effort: 'high', schema: 'envelope', dispatch: new TokenBudget(1000),
    });

    expect(record.outcome).toBe('error');
  });
});

describe('logFromExecuteCalls', () => {
  it('numbers batches by call and marks the failing command', () => {
    const log = logFromExecuteCalls([
      { input: { commands: [{ name: 'block.insert', args: {} }] }, result: { ok: true } },
      { input: { commands: [{ name: 'a', args: {} }, { name: 'b', args: {} }] }, result: { ok: false, error: { code: 'INVALID_ARGS', commandIndex: 1 } } },
    ], 'agent');

    expect(log.map((e) => [e.batch, e.index, e.name, e.error?.code])).toEqual([
      [0, 0, 'block.insert', undefined],
      [1, 0, 'a', undefined],
      [1, 1, 'b', 'INVALID_ARGS'],
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test test/unit/evals/run-task.test.ts`
Expected: FAIL, cannot resolve `run-task`.

- [ ] **Step 3: Write `run-task.ts`**

```ts
// test/evals/agent/runner/run-task.ts
import type Anthropic from '@anthropic-ai/sdk';

import type { OutputData } from '../../../../types';
import type { EvalTask, ExecuteResult, LogEntry, Observed, Surface, Verdict } from '../types';
import type { Execute, MessagesClient, TokenBudget } from './model-loop';
import { classifyTrial, runModelLoop } from './model-loop';

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const SYSTEM_PROMPT =
  'You edit a Blok document through the provided tools. Read the document first, then change it with blok_execute. ' +
  'When you are done, reply with a short summary.';

export interface SurfaceRun {
  tools: Anthropic.Tool[];
  execute: Execute;
  finish(): Promise<{ final: OutputData; log: LogEntry[]; results: ExecuteResult[]; observed?: Observed; actorId?: string }>;
  close(): Promise<void>;
}

export type OpenSurface = (task: EvalTask, schema: 'envelope' | 'full') => Promise<SurfaceRun>;

export interface TrialRecord {
  taskId: string;
  surface: Surface;
  trial: number;
  outcome: 'pass' | 'fail' | 'error';
  graders: Record<string, Verdict>;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  errorDetail?: string;
}

const errorRecord = (o: { task: EvalTask; surface: Surface; trial: number }, error: unknown): TrialRecord => ({
  taskId: o.task.id, surface: o.surface, trial: o.trial, outcome: 'error', graders: {}, turns: 0, inputTokens: 0, outputTokens: 0,
  errorDetail: error instanceof Error ? (error.stack ?? error.message) : String(error),
});

export const runTrial = async (o: {
  task: EvalTask; surface: Surface; open: OpenSurface; trial: number; client: MessagesClient;
  model: string; effort: Effort; schema: 'envelope' | 'full'; dispatch: TokenBudget;
}): Promise<TrialRecord> => {
  let surface: SurfaceRun;

  try {
    surface = await o.open(o.task, o.schema);
  } catch (error) {
    return errorRecord(o, error);
  }

  try {
    const prompt = o.task.docId === undefined ? o.task.prompt : `The document id is "${o.task.docId}". ${o.task.prompt}`;
    const loop = await runModelLoop({
      client: o.client, model: o.model, effort: o.effort, system: SYSTEM_PROMPT, prompt,
      tools: surface.tools, execute: surface.execute, budget: o.task.budget, dispatch: o.dispatch,
    });
    const end = await surface.finish();
    const graders: Record<string, Verdict> = {};
    let threw: unknown = null;

    for (const grader of o.task.graders) {
      try {
        graders[grader.name] = grader.check({
          seed: o.task.seed, final: end.final, actorId: end.actorId ?? 'agent-eval', log: end.log, results: end.results,
          toolCalls: loop.toolCalls, answer: loop.answer, observed: end.observed,
        });
      } catch (error) {
        threw = error;
      }
    }

    return {
      taskId: o.task.id, surface: o.surface, trial: o.trial,
      outcome: classifyTrial(loop, Object.values(graders), threw !== null),
      graders, turns: loop.turns, inputTokens: loop.inputTokens, outputTokens: loop.outputTokens,
      errorDetail: threw instanceof Error ? (threw.stack ?? threw.message) : (loop.detail ?? (loop.stop === 'done' ? undefined : loop.stop)),
    };
  } catch (error) {
    return errorRecord(o, error);
  } finally {
    await surface.close();
  }
};

export const logFromExecuteCalls = (
  calls: Array<{ input: { commands?: Array<{ name: string; args: unknown }> }; result: ExecuteResult & { error?: { code: string; commandIndex?: number } } }>,
  actorId: string
): LogEntry[] =>
  calls.flatMap((call, batch) => (call.input.commands ?? []).map((command, index) => ({
    batch, index, name: command.name, args: command.args, actorId,
    ...(call.result.ok === false && call.result.error !== undefined && (call.result.error.commandIndex ?? 0) === index ? { error: { code: call.result.error.code } } : {}),
  })));
```

The session surfaces use the actor id `agent-eval`; the MCP surfaces use `agent:local:agent-eval` (04's naming rule, see `openMcpStored`), reported through `finish().actorId`. `attributed` and `agentVisible` compare against the id the surface reports.

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test test/unit/evals/run-task.test.ts`
Expected: PASS.

- [ ] **Step 4b: Write the replay client and the failing in-app replay test**

```ts
// test/evals/agent/runner/replay-client.ts
import type Anthropic from '@anthropic-ai/sdk';

import type { EvalTask } from '../types';
import type { MessagesClient } from './model-loop';

type Step = { name: string; input: () => unknown };

const message = (content: unknown[], stop: Anthropic.Message['stop_reason']): Anthropic.Message =>
  ({ id: 'replay', type: 'message', role: 'assistant', model: 'replay', content, stop_reason: stop, stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 } } as unknown as Anthropic.Message);

const handleIn = (text: string): string | undefined => {
  try {
    return (JSON.parse(text) as { handle?: string }).handle;
  } catch {
    return undefined;
  }
};

/** Plays a task's reference as tool calls: a deterministic, free check of a surface. */
export const replayClient = (task: EvalTask, mode: 'session' | 'mcp'): MessagesClient => {
  let handle = '';
  const steps: Step[] = mode === 'mcp'
    ? [
      { name: 'blok_list_documents', input: () => ({}) },
      { name: 'blok_open', input: () => ({ documentId: task.docId ?? task.id, write: true }) },
      ...task.reference.map((batch) => ({ name: 'blok_execute', input: () => ({ handle, ...batch }) })),
      { name: 'blok_close', input: () => ({ handle }) },
    ]
    : task.reference.map((batch) => ({ name: 'blok_execute', input: () => batch }));
  let at = 0;

  return {
    create: async (params) => {
      const last = params.messages[params.messages.length - 1];

      if (Array.isArray(last.content)) {
        for (const block of last.content) {
          if (block.type === 'tool_result' && typeof block.content === 'string') {
            handle = handleIn(block.content) ?? handle;
          }
        }
      }

      if (at >= steps.length) {
        return message([{ type: 'text', text: task.referenceAnswer ?? 'done', citations: null }], 'end_turn');
      }

      const step = steps[at];

      at += 1;

      return message([{ type: 'tool_use', id: `replay-${at}`, name: step.name, input: step.input() }], 'tool_use');
    },
  };
};
```

`blok_open`'s input is 04's (04 Task 6): `{ documentId, mode?, write? }`, and `write` defaults to `false`, so the replay passes `write: true` or every `blok_execute` answers `READ_ONLY`. Its result carries `handle` (04 Task 8).

```ts
// test/unit/evals/in-app-replay.test.ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TokenBudget } from '../../evals/agent/runner/model-loop';
import { replayClient } from '../../evals/agent/runner/replay-client';
import { runTrial } from '../../evals/agent/runner/run-task';
import { openInApp } from '../../evals/agent/runner/surfaces/in-app';
import { ALL_TASKS } from '../../evals/agent/tasks';

describe.each(ALL_TASKS.filter((t) => t.surfaces.includes('in-app')))('in-app surface replays $id', (task) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['envelope', 'full'] as const)('passes every grader with the reference as tool calls (%s)', async (schema) => {
    const record = await runTrial({
      task, surface: 'in-app', open: openInApp, trial: 0, client: replayClient(task, 'session'),
      model: 'replay', effort: 'high', schema, dispatch: new TokenBudget(1),
    });

    expect(record.errorDetail).toBeUndefined();
    expect(record.outcome).toBe('pass');
  });
});
```

Run: `yarn test test/unit/evals/in-app-replay.test.ts`
Expected: FAIL, cannot resolve `surfaces/in-app`.

- [ ] **Step 5: Write the two Node surfaces**

```ts
// test/evals/agent/runner/surfaces/in-app.ts
import type Anthropic from '@anthropic-ai/sdk';

import { renderAgentTools } from '../../../../../src/agent/render-tools';
import { nodeContract, openJsonSession } from '../../../../unit/agent/harness';
import type { ExecuteResult, LogEntry } from '../../types';
import type { OpenSurface } from '../run-task';

/** In-app tasks run in Node behind the same three tools the browser renders (05 §3.3.4). */
export const openInApp: OpenSurface = async (task, schema) => {
  const session = openJsonSession(task.seed);
  const results: ExecuteResult[] = [];
  const tools = renderAgentTools(nodeContract('node'), { format: 'anthropic', schema }) as unknown as Anthropic.Tool[];

  return {
    tools,
    execute: async (name, input) => {
      if (name === 'blok_read') {
        return { content: JSON.stringify(await session.read(input as Parameters<typeof session.read>[0])), isError: false };
      }

      if (name === 'blok_describe') {
        return { content: JSON.stringify(session.describe(input as Parameters<typeof session.describe>[0])), isError: false };
      }

      if (name === 'blok_execute') {
        const result = await session.execute(input as Parameters<typeof session.execute>[0]);

        results.push(result as ExecuteResult);

        return { content: JSON.stringify(result), isError: false };
      }

      return { content: `Unknown tool ${name}`, isError: true };
    },
    finish: async () => ({ final: session.output(), log: session.log() as LogEntry[], results }),
    close: async () => session.close(),
  };
};
```

`openJsonSession` uses `TEST_ACTOR` (`agent-test`); add an optional `actor` parameter to it in `harness.ts` and pass `{ id: 'agent-eval', name: 'Eval agent', kind: 'agent' }` here.

```ts
// test/evals/agent/runner/surfaces/mcp.ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

import type { ExecuteResult } from '../../types';
import type { OpenSurface } from '../run-task';
import { logFromExecuteCalls } from '../run-task';

const REPO_ROOT = resolve(__dirname, '../../../../..');

/** The bin path @bloklabs/mcp publishes, read from its package.json (04, D2). */
const mcpBin = (): string => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'packages/mcp/package.json'), 'utf8')) as { bin: Record<string, string> };

  return join(REPO_ROOT, 'packages/mcp', pkg.bin['blok-mcp']);
};

/** 04 Task 9 `defaultAgentActor('local', safeClientName('agent-eval'))`. */
export const MCP_ACTOR_ID = 'agent:local:agent-eval';

const textOf = (content: unknown): string =>
  Array.isArray(content) ? content.map((c) => (c as { text?: string }).text ?? '').join('') : JSON.stringify(content);

export const openMcpStored = (extraArgs: string[] = [], extraEnv: Record<string, string> = {}): OpenSurface => async (task, schema) => {
  const dir = mkdtempSync(join(tmpdir(), 'blok-evals-'));
  const docId = task.docId ?? task.id;

  writeFileSync(join(dir, `${docId}.json`), JSON.stringify(task.seed));

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpBin(), '--source', `files:${dir}`, '--schema', schema, ...extraArgs],
    env: { ...(process.env as Record<string, string>), ...extraEnv },
  });
  // 04 has no identity flag: the actor id is `agent:local:<client name>` (04 Task 9), so this name fixes it.
  const client = new Client({ name: 'agent-eval', version: '1.0.0' });

  await client.connect(transport);

  const listed = await client.listTools();
  const tools = listed.tools.map((t) => ({ name: t.name, description: t.description ?? '', input_schema: t.inputSchema })) as Anthropic.Tool[];
  const calls: Array<{ input: { commands?: Array<{ name: string; args: unknown }> }; result: ExecuteResult }> = [];

  return {
    tools,
    execute: async (name, input) => {
      const response = await client.callTool({ name, arguments: input as Record<string, unknown> });
      const text = textOf(response.content);

      if (name === 'blok_execute') {
        calls.push({ input: input as { commands?: Array<{ name: string; args: unknown }> }, result: JSON.parse(text) as ExecuteResult });
      }

      return { content: text, isError: response.isError === true };
    },
    finish: async () => ({
      final: JSON.parse(readFileSync(join(dir, `${docId}.json`), 'utf8')),
      log: logFromExecuteCalls(calls, MCP_ACTOR_ID),
      actorId: MCP_ACTOR_ID,
      results: calls.map((c) => c.result),
    }),
    close: async () => client.close(),
  };
};
```

04 has no identity flag or env (04 Task 4 `parseMcpArgs`; `agentActor` exists only as a programmatic option, 04 Task 27). Over stdio the principal is `local` and the actor id is `agent:local:<MCP client name>` (04 Task 9 `defaultAgentActor`, `safeClientName`), so naming this client `agent-eval` makes it `agent:local:agent-eval` (`MCP_ACTOR_ID`). `finish()` reports it, and the trial passes it to the graders. The saved file is read after the loop because `blok_close` saves (04 §3.6); if the model never closed, the file still holds the seed and `stored-lifecycle` fails, as it should.

- [ ] **Step 6: Write the Node eval entry and its config**

```ts
// test/evals/agent/runner/node-surfaces.eval.ts
import { appendFileSync } from 'node:fs';

import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';

import { ALL_TASKS } from '../tasks';
import type { EvalTask } from '../types';
import { TokenBudget } from './model-loop';
import type { MessagesClient } from './model-loop';
import { replayClient } from './replay-client';
import { runTrial } from './run-task';
import type { OpenSurface } from './run-task';
import { openInApp } from './surfaces/in-app';
import { openMcpStored } from './surfaces/mcp';

const env = (key: string): string => {
  const value = process.env[key];

  if (value === undefined || value === '') {
    throw new Error(`${key} is required; run through test/evals/agent/runner/run.mjs`);
  }

  return value;
};

const selected = env('BLOK_EVAL_TASKS') === 'all' ? ALL_TASKS : ALL_TASKS.filter((t) => env('BLOK_EVAL_TASKS').split(',').includes(t.id));
const SURFACES: Partial<Record<string, OpenSurface>> = { 'in-app': openInApp, 'mcp-stored': openMcpStored() };
const dispatch = new TokenBudget(Number(env('BLOK_EVAL_MAX_TOTAL_TOKENS')));
const replay = process.env.BLOK_EVAL_REPLAY === '1';
// Constructed only for real runs: the SDK needs a key.
const client = replay ? null : new Anthropic();
const clientFor = (task: EvalTask, surface: string): MessagesClient =>
  client === null ? replayClient(task, surface.startsWith('mcp') ? 'mcp' : 'session') : client.messages;

// run.mjs compares this list with the records, so a crash cannot pass as "no regression".
for (const task of selected) {
  for (const surface of task.surfaces.filter((s) => SURFACES[s] !== undefined)) {
    appendFileSync(`${env('BLOK_EVAL_OUT')}.expected.jsonl`, `${JSON.stringify({ taskId: task.id, surface, trials: Number(env('BLOK_EVAL_TRIALS')) })}\n`);
  }
}

describe('agent evals (node surfaces)', () => {
  for (const task of selected) {
    for (const surface of task.surfaces.filter((s) => SURFACES[s] !== undefined)) {
      for (let trial = 0; trial < Number(env('BLOK_EVAL_TRIALS')); trial++) {
        it(`${task.id} on ${surface} #${trial}`, async () => {
          const record = await runTrial({
            task, surface, open: SURFACES[surface] as OpenSurface, trial,
            client: clientFor(task, surface), model: env('BLOK_EVAL_MODEL'), effort: env('BLOK_EVAL_EFFORT') as 'high',
            schema: env('BLOK_EVAL_SCHEMA') as 'envelope' | 'full', dispatch,
          });

          appendFileSync(env('BLOK_EVAL_OUT'), `${JSON.stringify(record)}\n`);
          // The report decides pass/fail against the baseline; a trial never fails the run here.
          expect(record.taskId).toBe(task.id);
        });
      }
    }
  }
});
```

```ts
// test/evals/agent/vitest.evals.config.ts
import path from 'node:path';

import { defineConfig } from 'vitest/config';

// Separate from vitest.config.ts so no eval ever runs in the per-commit unit job.
export default defineConfig({
  root: path.resolve(__dirname, '../../..'),
  resolve: { alias: { '@/types': path.resolve(__dirname, '../../../types') } },
  test: {
    name: 'agent-evals',
    environment: 'node',
    include: ['test/evals/agent/runner/node-surfaces.eval.ts'],
    testTimeout: 600_000,
    fileParallelism: false,
  },
});
```

`client.messages` matches `MessagesClient` (`create(params)` → `Promise<Message>`).

- [ ] **Step 6b: Run the in-app replay test**

Run: `yarn test test/unit/evals/in-app-replay.test.ts`
Expected: PASS for every `in-app` task in both schema modes. A failure is a surface bug (or a 01/03 bug: compare with `eval-graders.test.ts`, which applies the same reference without the tool layer).

- [ ] **Step 7: Replay every Node-surface task with no model (deterministic, free)**

Needs 04's built `blok-mcp` (`yarn build:mcp`).
Run: `rm -f /private/tmp/claude-501/eval-replay.jsonl*; BLOK_EVAL_REPLAY=1 BLOK_EVAL_TASKS=all BLOK_EVAL_TRIALS=1 BLOK_EVAL_MODEL=replay BLOK_EVAL_EFFORT=high BLOK_EVAL_SCHEMA=envelope BLOK_EVAL_MAX_TOTAL_TOKENS=1 BLOK_EVAL_OUT=/private/tmp/claude-501/eval-replay.jsonl yarn vitest run --config test/evals/agent/vitest.evals.config.ts`
Expected: every record in the JSONL has `"outcome":"pass"`, except `mcp-live` tasks before Task 24 (not registered yet, so absent). Check with `grep -v '"outcome":"pass"' /private/tmp/claude-501/eval-replay.jsonl` → no output.

- [ ] **Step 7b: Optional real-model smoke (costs tokens)**

Only with `ANTHROPIC_API_KEY` set and the user's go-ahead for spend: the Step 7 command with `BLOK_EVAL_REPLAY` unset, `BLOK_EVAL_TASKS=format-range`, `BLOK_EVAL_MODEL=claude-opus-5-5`, `BLOK_EVAL_MAX_TOTAL_TOKENS=200000`. Expected: one record with token counts. Skip without a key and say so in the commit message.

- [ ] **Step 8: Lint and commit**

```bash
node_modules/.bin/eslint test/evals/agent/runner test/evals/agent/vitest.evals.config.ts test/unit/evals/run-task.test.ts test/unit/evals/in-app-replay.test.ts test/unit/agent/harness.ts
git add test/evals/agent/runner/run-task.ts test/evals/agent/runner/replay-client.ts test/evals/agent/runner/surfaces test/evals/agent/runner/node-surfaces.eval.ts test/evals/agent/vitest.evals.config.ts test/unit/evals/run-task.test.ts test/unit/evals/in-app-replay.test.ts test/unit/agent/harness.ts
git diff --cached --name-only
git commit -m "test(evals): run tasks on the in-app and MCP stored surfaces

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 23: The `in-app-browser` surface

**Gated on:** 03's `editor.agent.begin`, `AgentTurn.call(name, input)`, `editor.agent.tools({ format, schema })` (06 §3.5, R2-03-8); 02's `describe` / `actionHandlers` statics for the fixture rating tool.

**Files:**
- Create: `test/evals/agent/runner/browser.eval.ts`
- Create: `test/evals/agent/runner/rating-tool.ts` (class source as a string, per CLAUDE.md "Custom tools in E2E")
- Create: `test/evals/agent/playwright.evals.config.ts`

**Interfaces:**
- Consumes: Tasks 20–22; `gotoTestPage` (`test/playwright/tests/helpers/shared-page.ts`); `test/playwright/global-setup.ts` (builds the bundle).
- Produces: the same JSONL records as Task 22, for surface `in-app-browser`.

- [ ] **Step 1: Write the config**

```ts
// test/evals/agent/playwright.evals.config.ts
import { defineConfig } from '@playwright/test';

// Same fixture server as playwright.config.ts:254-262; separate so evals never run per commit.
export default defineConfig({
  globalSetup: '../../playwright/global-setup.ts',
  testDir: './runner',
  testMatch: 'browser.eval.ts',
  timeout: 600_000,
  workers: 1,
  retries: 0,
  use: { headless: true, testIdAttribute: 'data-blok-testid', browserName: 'chromium' },
  // Reused on purpose: the workflow starts this server before the Node live surface, which needs it too.
  webServer: { command: 'npx serve . -l 4444 --no-clipboard --no-compression', port: 4444, reuseExistingServer: true, timeout: 120_000, cwd: '../../..' },
});
```

- [ ] **Step 2: Write the rating tool source**

```ts
// test/evals/agent/runner/rating-tool.ts
/** Evaluated in the page with new Function; mirrors test/fixtures/agent-commands/custom-tools/rating.json. */
export const RATING_TOOL_SOURCE = `
class RatingTool {
  static get toolbox() { return { title: 'Rating', name: 'rating' }; }
  static describe() {
    return {
      summary: 'A star rating from 0 to 5.',
      data: { type: 'object', properties: { value: { type: 'integer', minimum: 0, maximum: 5 } }, required: ['value'], additionalProperties: false },
      actions: [{ name: 'setValue', summary: 'Set the rating.', target: 'block',
        args: { type: 'object', properties: { value: { type: 'integer', minimum: 0, maximum: 5 } }, required: ['value'], additionalProperties: false } }],
    };
  }
  static get actionHandlers() {
    return { setValue: { run: (ctx, args) => { ctx.update(ctx.block.id, { value: args.value }); return {}; } } };
  }
  constructor({ data }) { this.data = { value: typeof data?.value === 'number' ? data.value : 0 }; }
  render() { const el = document.createElement('div'); el.textContent = '★'.repeat(this.data.value); return el; }
  save() { return { value: this.data.value }; }
}
return RatingTool;
`;
```

`describe` and `actionHandlers` are the statics D4 approves; their exact shapes are 02 §3.5 and 06 §3.4 (`ToolActionImpl.run(ctx, args)`, `ctx.update(id, patch)`). Re-check against 02's landed types.

- [ ] **Step 3: Write the browser eval**

```ts
// test/evals/agent/runner/browser.eval.ts
import { appendFileSync } from 'node:fs';

import Anthropic from '@anthropic-ai/sdk';
import { test } from '@playwright/test';

import type { OutputData } from '../../../../types';
import { gotoTestPage } from '../../../playwright/tests/helpers/shared-page';
import { ALL_TASKS } from '../tasks';
import type { ExecuteResult, LogEntry } from '../types';
import { TokenBudget } from './model-loop';
import { RATING_TOOL_SOURCE } from './rating-tool';
import { replayClient } from './replay-client';
import { runTrial } from './run-task';
import type { OpenSurface } from './run-task';

const env = (key: string): string => process.env[key] ?? '';
const selected = env('BLOK_EVAL_TASKS') === 'all' ? ALL_TASKS : ALL_TASKS.filter((t) => env('BLOK_EVAL_TASKS').split(',').includes(t.id));
const dispatch = new TokenBudget(Number(env('BLOK_EVAL_MAX_TOTAL_TOKENS')));
const client = env('BLOK_EVAL_REPLAY') === '1' ? null : new Anthropic();

for (const task of selected.filter((t) => t.surfaces.includes('in-app-browser'))) {
  appendFileSync(`${env('BLOK_EVAL_OUT')}.expected.jsonl`, `${JSON.stringify({ taskId: task.id, surface: 'in-app-browser', trials: Number(env('BLOK_EVAL_TRIALS')) })}\n`);
}

for (const task of selected.filter((t) => t.surfaces.includes('in-app-browser'))) {
  for (let trial = 0; trial < Number(env('BLOK_EVAL_TRIALS')); trial++) {
    test(`${task.id} on in-app-browser #${trial}`, async ({ page }) => {
      const open: OpenSurface = async (t, schema) => {
        await gotoTestPage(page);
        await page.waitForFunction(() => typeof window.Blok === 'function');

        const tools = await page.evaluate(async ({ seed, schema: mode, rating, withRating }) => {
          document.getElementById('blok')?.remove();
          const holder = document.createElement('div');

          holder.id = 'blok';
          document.body.appendChild(holder);

          const extra = withRating ? { rating: { class: new Function(rating)() } } : {};
          const blok = new window.Blok({ holder: 'blok', data: seed, tools: extra });

          window.blokInstance = blok;
          await blok.isReady;
          (window as unknown as { __turn: unknown }).__turn = blok.agent.begin({ agent: { id: 'agent-eval', name: 'Eval agent' } });

          return blok.agent.tools({ format: 'anthropic', schema: mode });
        }, { seed: t.seed, schema, rating: RATING_TOOL_SOURCE, withRating: t.tools === 'rating-fixture' });

        const results: ExecuteResult[] = [];

        return {
          tools: tools as Anthropic.Tool[],
          execute: async (name, input) => {
            const out = await page.evaluate(async ({ n, i }) => (window as unknown as { __turn: { call(n: string, i: unknown): Promise<unknown> } }).__turn.call(n, i), { n: name, i: input });

            if (name === 'blok_execute') {
              results.push(out as ExecuteResult);
            }

            return { content: JSON.stringify(out), isError: false };
          },
          finish: async () => {
            const end = await page.evaluate(async () => {
              const turn = (window as unknown as { __turn: { log(): unknown[]; end(): void } }).__turn;
              const log = turn.log();

              turn.end();

              return { log, final: await window.blokInstance?.save() };
            });

            return { final: end.final as OutputData, log: end.log as LogEntry[], results };
          },
          close: async () => undefined,
        };
      };

      const record = await runTrial({
        task, surface: 'in-app-browser', open, trial, client: client === null ? replayClient(task, 'session') : client.messages,
        model: env('BLOK_EVAL_MODEL'), effort: env('BLOK_EVAL_EFFORT') as 'high', schema: env('BLOK_EVAL_SCHEMA') as 'envelope' | 'full', dispatch,
      });

      appendFileSync(env('BLOK_EVAL_OUT'), `${JSON.stringify(record)}\n`);
    });
  }
}
```

The turn never passes `attributeTo: 'user'` (05 §3.3.6), so `attributed` can pass. `window.Blok` merges extra tools with the defaults (`test/playwright/fixtures/test.html:128-136`).

- [ ] **Step 4: Replay the browser tasks with no model (deterministic, free) — the failing-first check**

Run before Step 3's file exists to see it fail ("No tests found" / missing module), then after:
`rm -f /private/tmp/claude-501/eval-browser.jsonl*; BLOK_EVAL_REPLAY=1 BLOK_EVAL_TASKS=all BLOK_EVAL_TRIALS=1 BLOK_EVAL_MODEL=replay BLOK_EVAL_EFFORT=high BLOK_EVAL_SCHEMA=envelope BLOK_EVAL_MAX_TOTAL_TOKENS=1 BLOK_EVAL_OUT=/private/tmp/claude-501/eval-browser.jsonl yarn playwright test --config test/evals/agent/playwright.evals.config.ts`
Expected: `toggle-nest`, `table-ops` and `custom-tool` each write one record with `"outcome":"pass"`; `grep -v '"outcome":"pass"' /private/tmp/claude-501/eval-browser.jsonl` prints nothing.

- [ ] **Step 4b: Run the laws that read Playwright and fixture config**

Run each alone: `yarn test test/unit/architecture/e2e-webserver-offline-law.test.ts`, `yarn test test/unit/architecture/no-phantom-dependencies-law.test.ts`.
Expected: PASS. (The webserver law reads `playwright.config.ts:23`; the new config's `npx serve` uses the declared `serve` 14.2.6.)

- [ ] **Step 4c: Optional real-model smoke (costs tokens)**

With a key and the user's go-ahead: the Step 4 command with `BLOK_EVAL_REPLAY` unset, `BLOK_EVAL_TASKS=toggle-nest`, `BLOK_EVAL_MODEL=claude-opus-5-5`, `BLOK_EVAL_MAX_TOTAL_TOKENS=200000`. Skip without a key and say so in the commit.

- [ ] **Step 5: Lint and commit**

```bash
node_modules/.bin/eslint test/evals/agent/runner/browser.eval.ts test/evals/agent/runner/rating-tool.ts test/evals/agent/playwright.evals.config.ts
git add test/evals/agent/runner/browser.eval.ts test/evals/agent/runner/rating-tool.ts test/evals/agent/playwright.evals.config.ts
git diff --cached --name-only
git commit -m "test(evals): in-app browser surface

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 24: The `mcp-live` surface (real C# room, scripted human)

**Gated on:** 04's live mode (`--sync-url`, `--origin`, `BLOK_SECRET`, agent awareness `agentCursor`, participant row); 03's peer drawing of `agentCursor` and `CollaborationParticipant.agent`.

**Files:**
- Create: `test/evals/agent/runner/live-room-helpers.ts`
- Create: `test/unit/evals/live-room-helpers.test.ts` (per commit, no server)
- Create: `test/evals/agent/runner/live-room.ts`
- Modify: `test/evals/agent/runner/node-surfaces.eval.ts` (register `mcp-live`)

**Interfaces:**
- Consumes: `startServer`, `RunningServer` (`test/unit/server-conformance/run-against.ts:14-28,159`), server args from `test/unit/server-conformance/sync-contract.test.ts:279-291`, `startDocEndpoint` / `FixtureDocEndpoint.serve(docId, document)` (`test/unit/server-conformance/doc-endpoint.ts:14-21,56`), `blokTicket(secret, { user, doc, write, ttlSeconds })` (`packages/server/src/ticket.ts:45`, secret ≥ 32 chars, `:4`), `chromium` from `@playwright/test` (a bare `playwright` import would trip `no-phantom-dependencies-law`), Task 22's `openMcpStored(extraArgs, extraEnv)`.
- Produces: `waitForStable<T>(read: () => Promise<T>, o: { intervalMs: number; timeoutMs: number }): Promise<T>`, `blocksWithMarker(samples: string[][]): string[]`, `openMcpLive: OpenSurface`.

- [ ] **Step 1: Write the failing helper tests**

```ts
// test/unit/evals/live-room-helpers.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blocksWithMarker, waitForStable } from '../../evals/agent/runner/live-room-helpers';

describe('live room helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('waitForStable returns once two reads in a row match', async () => {
    const reads = ['a', 'b', 'b'];
    const read = vi.fn(async () => reads.shift() ?? 'b');

    await expect(waitForStable(read, { intervalMs: 1, timeoutMs: 1000 })).resolves.toBe('b');
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('waitForStable gives up loudly instead of returning a moving value', async () => {
    let n = 0;

    await expect(waitForStable(async () => n++, { intervalMs: 1, timeoutMs: 20 })).rejects.toThrow(/did not settle/);
  });

  it('blocksWithMarker unions the sampled block ids', () => {
    expect(blocksWithMarker([[], ['s1'], ['s1', 's2']])).toEqual(['s1', 's2']);
  });
});
```

Run: `yarn test test/unit/evals/live-room-helpers.test.ts`
Expected: FAIL, cannot resolve `live-room-helpers`.

- [ ] **Step 1b: Write the helpers**

```ts
// test/evals/agent/runner/live-room-helpers.ts
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Both sides have converged when two reads in a row are equal. */
export const waitForStable = async <T>(read: () => Promise<T>, o: { intervalMs: number; timeoutMs: number }): Promise<T> => {
  const deadline = Date.now() + o.timeoutMs;
  let previous = JSON.stringify(await read());

  while (Date.now() < deadline) {
    await sleep(o.intervalMs);

    const value = await read();
    const text = JSON.stringify(value);

    if (text === previous) {
      return value;
    }

    previous = text;
  }

  throw new Error('live room did not settle before the deadline');
};

export const blocksWithMarker = (samples: string[][]): string[] => [...new Set(samples.flat())].sort();
```

Run: `yarn test test/unit/evals/live-room-helpers.test.ts`
Expected: PASS.

- [ ] **Step 1c: Write `live-room.ts`**

```ts
// test/evals/agent/runner/live-room.ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { chromium } from '@playwright/test';

import type { OutputData } from '../../../../types';
import { blokTicket } from '../../../../packages/server/src/ticket';
import { startDocEndpoint } from '../../../unit/server-conformance/doc-endpoint';
import { startServer } from '../../../unit/server-conformance/run-against';
import type { Observed } from '../types';
import { blocksWithMarker, waitForStable } from './live-room-helpers';
import type { OpenSurface } from './run-task';
import { openMcpStored } from './surfaces/mcp';

const FIXTURE = 'http://localhost:4444/test/playwright/fixtures/test.html';
const ORIGIN = 'http://localhost:4444';
// The holder attribute 03 sets while drawing a peer's agentCursor (06 §10.2). Unverified until 03 lands.
// 03 Task 15: the block-level agent marker; the element sits inside the block holder.
const AGENT_MARKER = '[data-blok-agent-marker]';

export const openMcpLive: OpenSurface = async (task, schema) => {
  const docId = task.docId ?? task.id;
  const secret = randomBytes(32).toString('hex');
  const endpoint = await startDocEndpoint();

  endpoint.serve(docId, task.seed);

  const server = await startServer({
    args: [
      '--listen', '127.0.0.1:0', '--auth', 'ticket', '--storage-dir', '', '--rate-limit', '0',
      '--collab', '--collab-dir', mkdtempSync(join(tmpdir(), 'blok-eval-room-')),
      '--doc-endpoint', endpoint.url, '--allow-origin', ORIGIN,
    ],
    env: { BLOK_SECRET: secret },
  });
  const wsUrl = `${server.baseUrl.replace(/^http:/, 'ws:')}/sync`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const ticket = blokTicket(secret, { user: 'human', doc: docId, write: true, ttlSeconds: 1800 });

  await page.goto(FIXTURE);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ doc, url, t }) => {
    const holder = document.createElement('div');

    holder.id = 'blok';
    document.body.appendChild(holder);

    const w = window as unknown as { __participants: unknown[]; blokInstance: unknown };

    w.__participants = [];

    const blok = new window.Blok({ holder: 'blok', collaboration: { doc, url, ticket: t, user: { name: 'Ana' } } });

    blok.on('collaboration:status', (status: { participants?: unknown[] }) => {
      w.__participants = status.participants ?? w.__participants;
    });
    w.blokInstance = blok;
    await blok.isReady;
  }, { doc: docId, url: wsUrl, t: ticket });

  const marker: string[][] = [];
  const sampler = setInterval(() => {
    void page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => el.closest('[data-blok-id]')?.getAttribute('data-blok-id') ?? ''), AGENT_MARKER)
      .then((ids) => marker.push(ids.filter(Boolean)))
      .catch(() => undefined);
  }, 100);
  let participants: Observed['participants'] = [];
  const watcher = setInterval(() => {
    void page.evaluate(() => (window as unknown as { __participants: Array<{ id: string; name: string }> }).__participants)
      .then((list) => {
        participants = list.length > (participants?.length ?? 0) ? list : participants;
      })
      .catch(() => undefined);
  }, 100);

  // The human types while the agent works; not awaited before the agent starts.
  const typing = (async () => {
    await page.locator('[data-blok-id="p1"] [contenteditable="true"]').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' we agreed on Friday', { delay: 80 });
  })();

  const agent = await openMcpStored(['--sync-url', wsUrl, '--origin', ORIGIN], { BLOK_SECRET: secret })(task, schema);

  return {
    tools: agent.tools,
    execute: agent.execute,
    finish: async () => {
      await typing;

      const end = await agent.finish();
      const saved = (): Promise<OutputData> => page.evaluate(async () => (window as unknown as { blokInstance: { save(): Promise<OutputData> } }).blokInstance.save());
      const final = await waitForStable(saved, { intervalMs: 250, timeoutMs: 15_000 });

      clearInterval(sampler);
      clearInterval(watcher);

      return {
        ...end,
        final,
        observed: {
          humanId: 'human',
          humanTyped: { blockId: 'p1', text: 'we agreed on Friday' },
          participants,
          peerSawAgentCursorOn: blocksWithMarker(marker),
          // Read after blok_close: the agent row must be gone.
          participantsAfterClose: await page.evaluate(() => (window as unknown as { __participants: Array<{ id: string; name: string }> }).__participants),
          serverAckedSequences: undefined,
        },
      };
    },
    close: async () => {
      clearInterval(sampler);
      clearInterval(watcher);
      await agent.close();
      await browser.close();
      await server.stop();
      await endpoint.stop();
    },
  };
};
```

Stand-ins, each checked when its owner lands: the `collaboration` config keys (`doc`, `url`, `ticket`, `user`) are from `types/configs/blok-config.d.ts:159,662,821-840` but `url`'s exact place in that object is **unverified**; `AGENT_MARKER` is 03's `data-blok-agent-marker` (03 Task 15; a caret-level peer agent is drawn by 03 Task 24's agent caret layer instead, so the scripted human's page must be on a block whose field cannot map to an input, or this check also reads the caret layer); participant rows carry the actor id as `id` (06 C3 ticket `user` = `actor.id`) — **unverified** field name; `serverAckedSequences` stays `undefined` until a journal read is reachable from a test (none was found in this session), so `ackedOnly` then checks only that every durable result names a sequence or a saved version. Say so in the eval report's notes.

`participantsAfterClose` is read when `finish()` runs, which `runTrial` calls after the model loop. If the model never called `blok_close`, the agent is still listed and `leftRoom` fails, which is the point of `live-lifecycle`. The human's typing only targets `p1`, which exists in both live tasks' seeds.

- [ ] **Step 2: Register the surface**

In `node-surfaces.eval.ts`: `const SURFACES: Partial<Record<string, OpenSurface>> = { 'in-app': openInApp, 'mcp-stored': openMcpStored(), 'mcp-live': openMcpLive };` and `import { openMcpLive } from './live-room';`.

- [ ] **Step 3: Replay both live tasks with no model (deterministic, free)**

Build the bundle (`yarn build:test`) and the host (`dotnet build packages/server/dotnet/Blok.Server.Host/Blok.Server.Host.csproj --configuration Release --output .eval-server`, as `scripts/test-server-conformance.mjs:118-127` does), export `BLOK_CONFORMANCE_SERVER=$PWD/.eval-server/Blok.Server.Host`, start the fixture server (`npx serve . -l 4444 --no-clipboard --no-compression`), then:
`rm -f /private/tmp/claude-501/eval-live.jsonl*; BLOK_EVAL_REPLAY=1 BLOK_EVAL_TASKS=live-coedit,live-lifecycle BLOK_EVAL_TRIALS=1 BLOK_EVAL_MODEL=replay BLOK_EVAL_EFFORT=high BLOK_EVAL_SCHEMA=envelope BLOK_EVAL_MAX_TOTAL_TOKENS=1 BLOK_EVAL_OUT=/private/tmp/claude-501/eval-live.jsonl yarn vitest run --config test/evals/agent/vitest.evals.config.ts`
Expected: two records, both `"outcome":"pass"`. Run it once before Step 2 registers the surface: it writes no records, which is the failing state. A server that does not start is `error`, not `fail`.

- [ ] **Step 3b: Optional real-model smoke (costs tokens)**

The Step 3 command with `BLOK_EVAL_REPLAY` unset and `BLOK_EVAL_MODEL=claude-opus-5-5`, with a key and the user's go-ahead. Skip otherwise and say so in the commit.

- [ ] **Step 4: Lint and commit**

```bash
node_modules/.bin/eslint test/evals/agent/runner/live-room.ts test/evals/agent/runner/live-room-helpers.ts test/unit/evals/live-room-helpers.test.ts test/evals/agent/runner/node-surfaces.eval.ts
git add test/evals/agent/runner/live-room.ts test/evals/agent/runner/live-room-helpers.ts test/unit/evals/live-room-helpers.test.ts test/evals/agent/runner/node-surfaces.eval.ts
git diff --cached --name-only
git commit -m "test(evals): live room surface with a scripted human

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 25: Report, baseline compare and the envelope-vs-full rule

Plain `.mjs` so `run.mjs` can import it without a TypeScript loader; vitest imports it for the per-commit test.

**Files:**
- Create: `test/evals/agent/runner/report.mjs`
- Create: `test/evals/agent/baseline.json`
- Create: `test/unit/evals/report.test.ts`

**Interfaces:**
- Produces:

```js
/** @returns {EvalResults} */ export function summarize(records, meta)              // meta = { model, effort, commit, schema }
/** @returns {{ failed: boolean, lines: string[] }} */ export function compareToBaseline(results, baseline, trials)
/** @returns {'envelope' | 'full'} */ export function pickSchema(envelopeResults, fullResults, trials)
/** @returns {boolean} */ export function tooManyInfraErrors(records)                  // three `error` records in a row
/** @returns {string[]} */ export function missingRecords(expected, records)            // "task on surface: n of m trials recorded"
/** @returns {object} */ export function updatedBaseline(results)
```

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/evals/report.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { compareToBaseline, missingRecords, pickSchema, summarize, tooManyInfraErrors } from '../../evals/agent/runner/report.mjs';

const rec = (taskId: string, outcome: 'pass' | 'fail' | 'error', inputTokens = 100) =>
  ({ taskId, surface: 'in-app', trial: 0, outcome, graders: {}, turns: 1, inputTokens, outputTokens: 10 });
const meta = { model: 'claude-opus-5-5', effort: 'high', commit: 'abc', schema: 'envelope' };

describe('eval report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pass@1 ignores error trials', () => {
    const results = summarize([rec('a', 'pass'), rec('a', 'fail'), rec('a', 'error')], meta);

    expect(results.tasks[0]).toMatchObject({ id: 'a', passAt1: 0.5, passAll: false });
  });

  it('fails when a task drops more than one trial below its baseline', () => {
    const baseline = { model: 'claude-opus-5-5', schema: 'envelope', tasks: { a: { passAt1: 1 } } };
    const now = summarize([rec('a', 'pass'), rec('a', 'fail'), rec('a', 'fail')], meta);

    expect(compareToBaseline(now, baseline, 3).failed).toBe(true);
    expect(compareToBaseline(summarize([rec('a', 'pass'), rec('a', 'pass'), rec('a', 'fail')], meta), baseline, 3).failed).toBe(false);
  });

  it('any markdown-regression failure fails the run', () => {
    const baseline = { model: 'claude-opus-5-5', schema: 'envelope', tasks: {} };
    const now = summarize([rec('markdown-regression', 'pass'), rec('markdown-regression', 'fail')], meta);

    expect(compareToBaseline(now, baseline, 3).failed).toBe(true);
  });

  it('a different model resets the comparison instead of failing', () => {
    const baseline = { model: 'other-model', schema: 'envelope', tasks: { a: { passAt1: 1 } } };
    const result = compareToBaseline(summarize([rec('a', 'fail')], meta), baseline, 3);

    expect(result.failed).toBe(false);
    expect(result.lines.join('\n')).toContain('baseline measured on a different model');
  });

  it('pickSchema: higher mean pass@1 wins; a tie within one trial goes to envelope', () => {
    const env = summarize([rec('a', 'pass'), rec('b', 'fail')], meta);
    const full = summarize([rec('a', 'pass'), rec('b', 'pass')], { ...meta, schema: 'full' });

    expect(pickSchema(env, full, 1)).toBe('envelope'); // 0.5 vs 1.0 differ by 0.5 < 1/1
    expect(pickSchema(env, full, 3)).toBe('full');     // 0.5 vs 1.0 differ by more than 1/3
  });

  it('reports selected trials that wrote no record', () => {
    const expected = [{ taskId: 'a', surface: 'in-app', trials: 2 }, { taskId: 'b', surface: 'mcp-stored', trials: 1 }];

    expect(missingRecords(expected, [rec('a', 'pass')])).toEqual([
      'a on in-app: 1 of 2 trials recorded',
      'b on mcp-stored: 0 of 1 trials recorded',
    ]);
  });

  it('three infra errors in a row is loud', () => {
    expect(tooManyInfraErrors([rec('a', 'error'), rec('b', 'error'), rec('c', 'error')])).toBe(true);
    expect(tooManyInfraErrors([rec('a', 'error'), rec('b', 'pass'), rec('c', 'error')])).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test test/unit/evals/report.test.ts`
Expected: FAIL, cannot resolve `report.mjs`.

- [ ] **Step 3: Write `report.mjs`**

```js
// test/evals/agent/runner/report.mjs
/**
 * Summaries and the regression rule for agent evals (05 §3.3.5, §3.3.8).
 * Error trials never count toward pass@1.
 */

const mean = (values) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);

export function summarize(records, meta) {
  const byTask = new Map();

  for (const r of records) {
    const list = byTask.get(r.taskId) ?? [];

    list.push(r);
    byTask.set(r.taskId, list);
  }

  return {
    ...meta,
    tasks: [...byTask.entries()].map(([id, trials]) => {
      const scored = trials.filter((t) => t.outcome !== 'error');

      return {
        id,
        surface: trials[0].surface,
        trials,
        passAt1: mean(scored.map((t) => (t.outcome === 'pass' ? 1 : 0))),
        passAll: scored.length > 0 && scored.length === trials.length && scored.every((t) => t.outcome === 'pass'),
        inputTokens: trials.reduce((s, t) => s + t.inputTokens, 0),
        outputTokens: trials.reduce((s, t) => s + t.outputTokens, 0),
      };
    }),
  };
}

export function compareToBaseline(results, baseline, trials) {
  const lines = [];
  let failed = false;

  if (baseline.model !== results.model) {
    lines.push(`baseline measured on a different model (${baseline.model}); not compared`);
  }

  for (const task of results.tasks) {
    const before = baseline.tasks?.[task.id]?.passAt1;
    const failing = Object.entries(task.trials.flatMap((t) => Object.entries(t.graders)).reduce((acc, [name, v]) => (v.pass ? acc : { ...acc, [name]: true }), {})).map(([n]) => n);

    lines.push(`${task.id}: baseline ${before ?? '-'}, now ${task.passAt1.toFixed(2)}${failing.length ? `, failing: ${failing.join(', ')}` : ''}`);

    if (task.id === 'markdown-regression' && task.trials.some((t) => t.outcome === 'fail')) {
      failed = true;
    }

    // More than one trial's worth: 1.0 → 0.67 with 3 trials is noise, 1.0 → 0.33 is a regression.
    if (baseline.model === results.model && before !== undefined && before - task.passAt1 > 1 / trials + 1e-9) {
      failed = true;
    }
  }

  return { failed, lines };
}

export function pickSchema(envelopeResults, fullResults, trials) {
  const e = mean(envelopeResults.tasks.map((t) => t.passAt1));
  const f = mean(fullResults.tasks.map((t) => t.passAt1));

  return f - e > 1 / trials ? 'full' : 'envelope';
}

export function tooManyInfraErrors(records) {
  let run = 0;

  for (const r of records) {
    run = r.outcome === 'error' ? run + 1 : 0;

    if (run >= 3) {
      return true;
    }
  }

  return false;
}

/** A crash before a trial writes its record must not read as "nothing regressed". */
export function missingRecords(expected, records) {
  return expected
    .map((e) => ({ ...e, got: records.filter((r) => r.taskId === e.taskId && r.surface === e.surface).length }))
    .filter((e) => e.got < e.trials)
    .map((e) => `${e.taskId} on ${e.surface}: ${e.got} of ${e.trials} trials recorded`);
}

export function updatedBaseline(results) {
  return {
    model: results.model,
    effort: results.effort,
    schema: results.schema,
    measuredAt: results.commit,
    tasks: Object.fromEntries(results.tasks.map((t) => [t.id, { passAt1: t.passAt1 }])),
  };
}
```

The drop rule: a task fails when its pass@1 falls by **more than** one trial's worth. 05 §3.3.8 says both "by more than one trial's worth" and "(≥ 1/3 with 3 trials)", which disagree at exactly one trial. This plan takes "more than": a single flipped trial out of three is within model noise. The test pins it (1.0 → 0.67 passes, 1.0 → 0.33 fails). Tell the user about this reading when the task lands.

- [ ] **Step 4: Write the empty baseline**

```json
{ "model": null, "effort": null, "schema": "envelope", "measuredAt": null, "tasks": {} }
```

- [ ] **Step 5: Run to verify it passes**

Run: `yarn test test/unit/evals/report.test.ts`
Expected: PASS.

- [ ] **Step 6: Lint and commit**

```bash
node_modules/.bin/eslint test/evals/agent/runner/report.mjs test/unit/evals/report.test.ts
git add test/evals/agent/runner/report.mjs test/evals/agent/baseline.json test/unit/evals/report.test.ts
git diff --cached --name-only
git commit -m "test(evals): results summary, baseline rule and schema pick

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 26: `run.mjs`, the `agent-evals.yml` workflow, and its law

**Files:**
- Create: `test/evals/agent/runner/run.mjs`
- Create: `.github/workflows/agent-evals.yml`
- Create: `test/unit/architecture/agent-evals-workflow-law.test.ts`

**Interfaces:**
- Consumes: Tasks 22–25.
- Produces: CLI `node test/evals/agent/runner/run.mjs --tasks <ids|all> --trials <n> --schema envelope|full|both --model <id> --effort <level> --max-total-tokens <n> [--update-baseline] --out <dir>`; exit code 1 on a regression or three infra errors in a row.

- [ ] **Step 1: Write the failing workflow law**

```ts
// test/unit/architecture/agent-evals-workflow-law.test.ts
// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

const root = resolve(__dirname, '../../..');
const path = join(root, '.github/workflows/agent-evals.yml');

type Workflow = {
  on: Record<string, unknown>;
  concurrency?: { 'cancel-in-progress'?: boolean };
  jobs: Record<string, { 'timeout-minutes'?: number; steps: Array<{ name?: string; with?: Record<string, unknown>; env?: Record<string, string> }> }>;
};

describe('agent evals workflow (D3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const workflow = parse(readFileSync(path, 'utf8')) as Workflow;
  const steps = Object.values(workflow.jobs).flatMap((j) => j.steps);

  // Real model calls cost money and vary; a person starts every run.
  it('runs on manual dispatch only', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
  });

  it('has a job timeout', () => {
    expect(Object.values(workflow.jobs).every((j) => typeof j['timeout-minutes'] === 'number')).toBe(true);
  });

  it('caps total tokens per dispatch', () => {
    expect(readFileSync(path, 'utf8')).toContain('--max-total-tokens');
  });

  it('keeps results for 90 days', () => {
    const upload = steps.find((s) => s.name === 'Upload eval results');

    expect(upload?.with?.['retention-days']).toBe(90);
  });

  it('no other workflow reads the model API key', () => {
    const others = readdirSync(join(root, '.github/workflows'))
      .filter((f) => /\.ya?ml$/.test(f) && f !== 'agent-evals.yml')
      .filter((f) => readFileSync(join(root, '.github/workflows', f), 'utf8').includes('ANTHROPIC_API_KEY'));

    expect(others).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test test/unit/architecture/agent-evals-workflow-law.test.ts`
Expected: FAIL, ENOENT on `agent-evals.yml`.

- [ ] **Step 3: Write the workflow**

Action pins are copied from `.github/workflows/mutation.yml:42,96` and `ci.yml:212` (the SHA-pin law, `production-readiness-gates.test.ts:340-354`, scans every file under `.github`).

```yaml
name: Agent evals

# Manual only (D3). Real model calls cost money and vary from run to run.
on:
  workflow_dispatch:
    inputs:
      tasks:
        description: "Comma-separated task ids, or all"
        type: string
        default: "all"
      trials:
        description: "Trials per task"
        type: number
        default: 3
      schema:
        description: "envelope, full, or both (the one-off comparison)"
        type: choice
        options: [envelope, full, both]
        default: envelope
      model:
        description: "Model id"
        type: string
        default: "claude-opus-5-5"
      effort:
        description: "Effort level, recorded with the results"
        type: choice
        options: [low, medium, high, xhigh, max]
        default: high
      max_total_tokens:
        description: "Stop the whole dispatch after this many tokens"
        type: number
        default: 3000000

concurrency:
  group: agent-evals
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  evals:
    name: Agent evals
    runs-on: ubuntu-latest
    timeout-minutes: 120
    steps:
      - name: Checkout code
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1

      - name: Setup Node.js and Dependencies
        uses: ./.github/actions/setup-node-deps

      - name: Setup Playwright browsers
        uses: ./.github/actions/setup-playwright-browsers
        with:
          browsers: chromium
          cache-key-prefix: playwright-chromium

      - name: Setup .NET
        uses: actions/setup-dotnet@a98b56852c35b8e3190ac28c8c2271da59106c68 # v6.0.0
        with:
          dotnet-version: '10.0.x'

      - name: Build the room server
        run: dotnet build packages/server/dotnet/Blok.Server.Host/Blok.Server.Host.csproj --configuration Release --output .eval-server

      - name: Build the MCP server
        run: yarn build:mcp

      # The live surface's human page loads dist/ from this server before Playwright starts.
      - name: Build the test bundle and serve the fixture page
        run: |
          yarn build:test
          (npx serve . -l 4444 --no-clipboard --no-compression > /dev/null 2>&1 &)
          for i in $(seq 1 60); do curl -sf http://localhost:4444/test/playwright/fixtures/test.html > /dev/null && break; sleep 1; done

      - name: Run evals
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          BLOK_CONFORMANCE_SERVER: ${{ github.workspace }}/.eval-server/Blok.Server.Host
          TASKS: ${{ inputs.tasks }}
          TRIALS: ${{ inputs.trials }}
          SCHEMA: ${{ inputs.schema }}
          MODEL: ${{ inputs.model }}
          EFFORT: ${{ inputs.effort }}
          MAX_TOTAL_TOKENS: ${{ inputs.max_total_tokens }}
        run: >
          node test/evals/agent/runner/run.mjs
          --tasks "$TASKS" --trials "$TRIALS" --schema "$SCHEMA"
          --model "$MODEL" --effort "$EFFORT"
          --max-total-tokens "$MAX_TOTAL_TOKENS"
          --out .eval-results
          --summary "$GITHUB_STEP_SUMMARY"

      - name: Upload eval results
        if: always()
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: agent-eval-results
          path: .eval-results/
          if-no-files-found: warn
          retention-days: 90
```

Inputs reach the shell through `env`, never `${{ }}` inside `run`, so a crafted input cannot inject shell (actionlint flags the inline form). `yarn build:mcp` is 04's root script (D2); if 04 names it differently, use that name. The default `max_total_tokens` (3,000,000) is a chosen cap, not a measured one: 05 §3.3.7 counts 45 runs per full run and has no token measurement yet. The first run's report replaces it with a measured number.

- [ ] **Step 4: Write `run.mjs`**

```js
#!/usr/bin/env node
// test/evals/agent/runner/run.mjs
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { compareToBaseline, missingRecords, pickSchema, summarize, tooManyInfraErrors, updatedBaseline } from './report.mjs';

const ROOT = resolve(import.meta.dirname, '../../../..');
const BASELINE = join(ROOT, 'test/evals/agent/baseline.json');
const { values } = parseArgs({
  options: {
    tasks: { type: 'string', default: 'all' },
    trials: { type: 'string', default: '3' },
    schema: { type: 'string', default: 'envelope' },
    model: { type: 'string', default: 'claude-opus-5-5' },
    effort: { type: 'string', default: 'high' },
    'max-total-tokens': { type: 'string', default: '3000000' },
    'update-baseline': { type: 'boolean', default: false },
    out: { type: 'string', default: '.eval-results' },
    summary: { type: 'string' },
  },
});
const out = resolve(ROOT, values.out);

mkdirSync(out, { recursive: true });

const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const readRecords = (file) => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const spent = (records) => records.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);

const runMode = (schema, budgetLeft) => {
  const file = join(out, `trials-${schema}.jsonl`);
  const env = {
    ...process.env,
    BLOK_EVAL_TASKS: values.tasks, BLOK_EVAL_TRIALS: values.trials, BLOK_EVAL_SCHEMA: schema,
    BLOK_EVAL_MODEL: values.model, BLOK_EVAL_EFFORT: values.effort, BLOK_EVAL_OUT: file,
    BLOK_EVAL_MAX_TOTAL_TOKENS: String(budgetLeft),
  };

  // No selected test is fine; any other non-zero exit is a crash, not a measurement.
  const node = spawnSync('yarn', ['vitest', 'run', '--config', 'test/evals/agent/vitest.evals.config.ts', '--passWithNoTests'], { cwd: ROOT, env, stdio: 'inherit' });
  const afterNode = budgetLeft - spent(readRecords(file));
  const browser = spawnSync('yarn', ['playwright', 'test', '--config', 'test/evals/agent/playwright.evals.config.ts', '--pass-with-no-tests'], {
    cwd: ROOT, env: { ...env, BLOK_EVAL_MAX_TOTAL_TOKENS: String(Math.max(0, afterNode)) }, stdio: 'inherit',
  });
  const records = readRecords(file);
  const crashed = [['vitest', node.status], ['playwright', browser.status]].filter(([, status]) => status !== 0).map(([name, status]) => `${name} exited ${status}`);
  const missing = missingRecords(readRecords(`${file}.expected.jsonl`), records);

  return { records, crashed, missing, results: summarize(records, { model: values.model, effort: values.effort, commit, schema }) };
};

const total = Number(values['max-total-tokens']);
const modes = values.schema === 'both' ? ['envelope', 'full'] : [values.schema];
const runs = {};
let left = total;

for (const mode of modes) {
  runs[mode] = runMode(mode, left);
  left -= spent(runs[mode].records);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const trials = Number(values.trials);
const lines = [`# Agent evals — ${values.model}, effort ${values.effort}, ${commit}`, `Tokens spent: ${total - left} of ${total}`];
let failed = false;

for (const mode of modes) {
  const { records, results, crashed, missing } = runs[mode];

  writeFileSync(join(out, `results-${mode}.json`), `${JSON.stringify(results, null, 2)}\n`);

  if (crashed.length > 0 || missing.length > 0) {
    lines.push('The run did not complete:', ...crashed, ...missing);
    failed = true;
  }

  const compared = compareToBaseline(results, baseline, trials);

  lines.push(`## ${mode}`, ...compared.lines);
  failed ||= compared.failed;

  if (tooManyInfraErrors(records)) {
    lines.push('Three infrastructure errors in a row. The run is not a measurement.');
    failed = true;
  }
}

if (modes.length === 2) {
  lines.push(`Schema default by the 05 §3.3.5 rule: ${pickSchema(runs.envelope.results, runs.full.results, trials)}`);
}

if (values['update-baseline']) {
  const chosen = modes.length === 2 ? pickSchema(runs.envelope.results, runs.full.results, trials) : modes[0];

  writeFileSync(BASELINE, `${JSON.stringify(updatedBaseline(runs[chosen].results), null, 2)}\n`);
  lines.push('baseline.json rewritten; a person reviews and commits it.');
}

const text = `${lines.join('\n')}\n`;

process.stdout.write(text);

if (values.summary !== undefined) {
  appendFileSync(values.summary, text);
}

process.exit(failed ? 1 : 0);
```

`import.meta.dirname` needs Node 20.11+; the repo's CI node is 26.5.0 (`.github/actions/setup-node-deps/action.yml`, default input).

- [ ] **Step 5: Run the law and the existing workflow gates**

Run each alone: `yarn test test/unit/architecture/agent-evals-workflow-law.test.ts`, `yarn test test/unit/architecture/production-readiness-gates.test.ts`, `yarn test test/unit/scripts/check-action-pins.test.ts`.
Expected: all PASS.

- [ ] **Step 6: Lint and commit**

```bash
node_modules/.bin/eslint test/evals/agent/runner/run.mjs test/unit/architecture/agent-evals-workflow-law.test.ts
git add test/evals/agent/runner/run.mjs .github/workflows/agent-evals.yml test/unit/architecture/agent-evals-workflow-law.test.ts
git diff --cached --name-only
git commit -m "ci(evals): manual-dispatch agent eval workflow and runner CLI

workflow_dispatch only (D3), a per-dispatch token cap, results kept
90 days. Needs the ANTHROPIC_API_KEY repository secret.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 27: First manual run — baseline and the schema default

Done by a person with the API key and the user's approval of the spend. Nothing here runs in CI.

**Files:**
- Modify: `test/evals/agent/baseline.json`
- Modify: `.github/workflows/agent-evals.yml` (the measured `max_total_tokens` default)

**Interfaces:**
- Consumes: `updatedBaseline(results)` and `pickSchema(...)` (Task 25); the `agent-evals.yml` workflow (Task 26).
- Produces: a committed `baseline.json` (`{ model, effort, schema, measuredAt, tasks: { [id]: { passAt1 } } }`) and the chosen `RenderOptions.schema` default, handed to 03 and 04.

- [ ] **Step 1: Ask the user to add the secret**

The repository needs a secret named `ANTHROPIC_API_KEY` (approved under D3/R3-10). The plan cannot add it. Confirm it exists: `gh secret list | grep ANTHROPIC_API_KEY`.

- [ ] **Step 2: Dispatch the one-off envelope-vs-full run**

Run: `gh workflow run agent-evals.yml -f tasks=all -f trials=3 -f schema=both -f model=claude-opus-5-5 -f effort=high`
This is the 05 §3.3.5 comparison over every non-live task in both modes. 06 D3 counts 78 runs for it.
Expected: the job summary ends with "Schema default by the 05 §3.3.5 rule: <mode>", and the artifact holds per-task tokens.

- [ ] **Step 3: Record the baseline**

Download the artifact and write the baseline from the chosen mode's results:

```bash
gh run download <run-id> -n agent-eval-results -D /private/tmp/claude-501/agent-eval-results
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs';
import { updatedBaseline } from './test/evals/agent/runner/report.mjs';
const results = JSON.parse(readFileSync('/private/tmp/claude-501/agent-eval-results/results-<chosen-mode>.json', 'utf8'));
writeFileSync('test/evals/agent/baseline.json', JSON.stringify(updatedBaseline(results), null, 2) + '\n');
"
```

Check before committing: `markdown-regression` pass@1 is 1.0 (05 §1: the agent surface is not called shipped until it is). If it is below 1.0, that is the headline finding for 03 and 04. Report it; do not commit a baseline that accepts it.

- [ ] **Step 4: Replace the cost guess**

Put the measured tokens per task from the report into the `max_total_tokens` default comment in `agent-evals.yml` (full run = sum over tasks × trials, plus headroom) and in the commit message.

- [ ] **Step 5: Commit and hand off the schema default**

```bash
git add test/evals/agent/baseline.json .github/workflows/agent-evals.yml
git diff --cached --name-only
git commit -m "test(evals): first baseline and the measured token cap

Model claude-opus-5-5, effort high. Envelope-vs-full picked <mode>.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git pull --rebase && git push
```

Tell 03's and 04's executors the chosen default for `RenderOptions.schema` (06 C2). Changing that default is their edit, not this plan's.

### Checkpoint 6 (final)

- [ ] Run each new per-commit file alone: the architecture laws (`agent-coverage-enumerators`, `agent-coverage-law`, `agent-evals-workflow-law`), `test/unit/agent/**` (`normalize`, `json-runner`, `store-runner`, `render-tools-parity`, `eval-graders`), `test/unit/evals/**` (`graders-structure`, `graders-behaviour`, `graders-collab`, `model-loop`, `run-task`, `report`), `test/unit/scripts/build-server-runtime.test.ts`. Expected: all PASS.
- [ ] `yarn e2e test/playwright/tests/agent/command-parity.spec.ts --project=chromium-default`: PASS.
- [ ] `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --filter "FullyQualifiedName~Agent"` and `dotnet format packages/server/dotnet/Blok.Server.slnx --verify-no-changes`: PASS.
- [ ] Final gate per the repo CLAUDE.md: `yarn lint` and `yarn test`. (Memory `run-only-related-tests` says the user prefers related tests over a full run; the repo CLAUDE.md "Landing the Plane" requires the full `yarn test` as the final gate. Ask the user which wins before running the >10-minute suite.)
- [ ] `git pull --rebase && git push`; `git status` shows "up to date with origin".
- [ ] Remove any worktree this work used, per the global Worktrees rule.

---

## Self-review

**Spec coverage (05 section → task):**

| Spec | Task |
|---|---|
| §3.1.1 capability ids, all 11 sources | 1 (insert, format, tune), 2 (menu), 3 (action, shortcut, key, typing, drag), 4 (api, ui-file) |
| §3.1.2 ledger, `{ field }` kind, `block.update` ban, `mirrors` auto-cover | 5, 15 |
| §3.1.2 assertions 1–7 in order, landing order R2-05-4 | 2 (6), 4 (7), 5 (1, 4, 5), 15 (2, 3, mirrors) |
| §3.1.3 file-level audit gate | 4 (`ui-file`), 5 (`UI_FILE_ROWS`) |
| §3.1.4 fixture tests + manual mutation checklist a–g | 1–4 fixtures; 5 (a, d, e, f); 15 (b, c, g) |
| §3.2.1 five runners, one golden, normalization rules, page-field cases, availability exemptions | 6, 7, 8, 9, 11, 12, 13 |
| §3.2.1 every command reached by a parity case | 16 |
| §3.2.2 bundle size budget | 10 |
| §3.2.3 renderer parity, both schema modes, snapshot | 14 |
| §3.2.4 saved output validates | 7 (`validateSaved` in the json runner) |
| §3.2.5 adapter parity | owned by 03; not duplicated |
| §3.3.2–3.3.4 task shape, graders, 15 tasks, grader self-test | 17, 18, 19, 20 |
| §3.3.5 envelope-vs-full | 25 (`pickSchema`), 27 |
| §3.3.6 surfaces, trials, model config, dependencies | 21–24 |
| §3.3.7 workflow_dispatch only, cost caps | 26 |
| §3.3.8 baseline, regression rule, model reset, `--update-baseline` | 25, 26, 27 |
| §3.4 error handling (infra = error, grader throw = error, diff on mismatch) | 7 (`diffOutputData` print), 21, 22, 25 |

**Deviations from the spec, each stated where it happens:** `pending` ledger marker (keeps `main` green, Task 5); `Grader` has a `name`, `surfaces` is a list, `knownBad` and `GraderInput` carry logs/tool calls/observations (Task 17); `parityExcluded` for `custom-tool` (Task 20); the `room` concurrency case is owned by 01 (Task 13); `run.mjs` spawns vitest/playwright with dedicated configs so TypeScript sources resolve (Task 26).

**Settled by the cross-plan pass:** 02's Node snapshot builder (`buildBuiltInSnapshot`, composed by 01's `createHeadlessAgentSetup`), 01's headless ports (no constant; `createHeadlessAgentSetup().ports`), `validateAgainst`'s return type (`SchemaProblem[]`), 05 Q14 (01 D-5), the C# executor construction (01 Task 45's internal constructor), 04's identity rule and `blok_open` args, 03's agent marker attribute. **Still unverified, and where it gets checked:** 02's final arg schemas for `database.create`, `table.mergeCells`, `table.create` (Task 20 Step 4); the `collaboration.url` key, the participant `id` field, and a journal read reachable from a test (Task 24); `output_config` typing in SDK 0.132.0 (Task 21 Step 5); the token cap default (Task 27).
