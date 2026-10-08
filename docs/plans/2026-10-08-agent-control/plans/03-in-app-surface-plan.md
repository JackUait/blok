# In-app Agent Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `editor.agent`, an in-app agent surface on the Blok editor instance. It renders ready-made LLM tool definitions, runs agent turns that the user can see, stop and undo, and shows agent work to the local user and to collaboration peers.

**Architecture:**
- The pure renderer `renderAgentTools` (`src/agent/render-tools.ts`) turns 02's `AgentContract` into tool JSON for Anthropic, OpenAI (Responses API) and MCP. `editor.agent.tools()` and 04's MCP server both call it.
- The `AgentAPI` module (`src/components/modules/api/agent.ts`) owns turns. Each turn wraps one `AgentSession` from 01's `createEditorAgentSession`.
- `AgentPresence` (`src/components/modules/api/agent-presence.ts`) draws the agent caret or a block-level marker, pulses changed holders, and publishes the `agentCursor` awareness field.
- The collaboration presence renderer draws peers' agents.

Blok never calls an LLM. The host owns the model loop.

**Tech Stack:** TypeScript, Vitest (jsdom, plus one Node-environment file), Playwright (`chromium-default` project), Yjs awareness (existing), hand-authored `types/*.d.ts`.

**Spec:** `docs/plans/2026-10-08-agent-control/03-in-app-surface.md`. Binding contract: `docs/plans/2026-10-08-agent-control/06-reconciliation.md` sections 3 and 12. Brief: `00-brief.md`.

## Global Constraints

- Name: `editor.agent` (D4: approved, with a release note). Nothing in this plan is labelled `BREAKING`.
- Tool names: exactly `blok_read`, `blok_describe`, `blok_execute`. Every name matches `^[a-zA-Z0-9_-]{1,128}$`.
- `blok_execute` input: `{ commands: AgentCommand[]; expectRevision?: string }`. It is **never** emitted with `strict`, in any mode or format.
- Schema modes: `'envelope'` (default) and `'full'`. `'full'` throws `AgentToolsTooLargeError` past the OpenAI limits: 5000 object properties, 10 levels of nesting, 1000 enum values.
- `strict: true` goes on `blok_read`/`blok_describe` only when the host asks AND every object in the schema has `additionalProperties: false`. Otherwise `tools()` throws `AgentToolsStrictError`.
- Renderers list only `available: true` commands. There is no `runtime` render option (06 R3-1).
- The OpenAI format is the Responses API shape `{ type: 'function', name, description, parameters, strict? }`. The Chat Completions shape is out of scope.
- The renderer and the guidance text are loaded with `import()`.
- One open turn per editor. `begin()` while a turn is open throws `AgentTurnOpenError`.
- `turn.call()` never throws for a model mistake. It returns `{ content, isError: true }`. It throws only for host bugs, such as a call after `editor.destroy()`.
- Error codes come only from 06 §3.2 `AgentErrorCode`. This plan raises `CANCELLED`, `UNKNOWN_COMMAND` and `INVALID_ARGS` itself, and relays the rest from 01.
- Agent writes stay on the Yjs `'local'` origin. `BlockMutationOrigin` is NOT widened.
- The agent never moves the user's caret, selection, focus or scroll. The only scroll is the opt-in `follow`.
- Units in the contract: UTF-16 code units, one per embed. Ranges name a data `field`, never a DOM input.
- Awareness field `agentCursor` uses the shape in 06 §10.2, verbatim. It is a wire field, not a published type.
- Published-types law: `types/api/agent.d.ts` never imports from `src/`.
- UI laws (CLAUDE.md):
  - No blue selected state. Agent chrome uses the agent's identity colour from the presence palette. It is never a selected or current state.
  - Hints show on hover only, after a delay. The agent name label shows on arrival through the caret layer's greet timer, never on focus. The avatar's hover hint goes through `onHover`.
  - No inline `<svg>` anywhere in `src`.
  - RTL: CSS uses logical properties only (`inset-inline-start`, `margin-inline-*`).
  - Child-holder decoration law: write only on a block's holder. Never write at or below the tool root, and never wrap a holder.
- `let` is banned in `src` (`eslint.config.mjs:1150-1153`). Use `const state = { ... }` objects, as `presence-carets.ts` does.
- Every unit test calls `vi.clearAllMocks()` in `beforeEach` and `vi.restoreAllMocks()` in `afterEach`. No `any`, no `@ts-ignore`, no `!`.
- E2E: no CSS class selectors. Use roles, text, `data-blok-testid` or `data-blok-*` attributes. Assert a class with `toHaveClass` on a located element.
- Run one test file per `yarn test` call. Multi-path vitest skips files (repo memory).
- Lint only changed files: `yarn eslint <files>`. Type-check at checkpoints: `NODE_OPTIONS=--max-old-space-size=8192 yarn tsc --noEmit`.
- Commits go straight to `main`. Stage explicit paths. Never `git commit -a`. Before each commit, run `git diff --cached --name-only` and check it lists exactly the task's files. Peer sessions share the index. Every commit message ends with:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- Push at each phase checkpoint: `git pull --rebase && git push`, then `git status` must say "up to date with 'origin/main'".
- Never run the full `yarn test` or full `yarn e2e`. That is a standing user rule. Run the related tests and the tests that reference changed symbols.

## Review Focus

These are five failure modes the spec implies but its own test list does not exercise. Each one is pinned by a test in the task named.

1. **An `execute` still in flight when `end()`/`stop()` runs.** When it resolves, it must not draw a caret, pulse, or publish `agentCursor`. Otherwise peers keep a stale agent cursor for good. Pinned in Task 8 (the turn drops `onExecuted` after close) and Task 16 (presence ignores `show()` after `stop()`).
2. **A human peer and their in-app agent share one awareness client id.** The caret layer's ledger is keyed by `clientId` (`presence-carets.ts:157`). If the agent caret were drawn in the same layer, it would replace the human's caret. Peers' agents get their own caret layer and marker layer. Pinned in Task 24.
3. **`follow` cancelling itself.** The follow scroll fires `scroll` events. Following stops only on user intent: `wheel`, `touchmove`, `keydown`, `pointerdown`. It never stops on `scroll`. Pinned in Task 18.
4. **Parallel tool calls.** A host may `await Promise.all` over the model's parallel tool calls. Calls run in order. One rejected `execute` does not poison the queue. `stop()` with calls still queued returns `CANCELLED` for each one and runs none. Pinned in Task 8.
5. **OpenAI arguments arrive as a JSON string.** In the Responses API, a function call's `arguments` arrive as a JSON string. Anthropic `input` is an object. This is **unverified** in this session. `turn.call` accepts both. A string that does not parse into an object returns `INVALID_ARGS` with a clear message. Pinned in Task 7.

Also covered, beyond the five:
- A batch touching hundreds of blocks: pulses are capped at 50 holders, and ids with no holder are skipped (Task 17).
- `tools()` and the session must render from one contract function, or the enum and the executor could disagree on hidden actions (Task 11).
- OpenAI strict mode may also require every property to be listed in `required`. That is **unverified**. Check the "Structured outputs" page before a host relies on `strict: true` with `format: 'openai'`. Task 3 implements only the confirmed rule (closed objects).

## Cross-plan dependencies

Plans 01 and 02 are written in parallel with this one. Names below follow 06 §3. Where 06 does not name a thing this plan needs, the name is **proposed here, unverified**. The phase gate steps (Task 1 Step 1, Task 9 Step 1) check them before any code is written.

**Needed from 01 (core commands):**

| Need | Canonical name / location | Status |
|---|---|---|
| Published shared types | `types/agent.d.ts` exporting `AgentActor`, `AgentSession`, `AgentBatch`, `AgentCommand`, `AgentResult`, `AgentError`, `AgentErrorCode`, `AgentWarning`, `ChangedSet`, `TextRangeRef`, `DocumentView`, `ViewArgs`, `ContractSlice`, `CommandLogEntry` | 06 §3.2, §3.5 |
| Session factory | `createEditorAgentSession(editor: InternalEditorHandle, actor: AgentActor, options?: { contractSource?; turnId?; mergeSteps?: 'batch' \| 'turn'; attributeLastEditedBy?: boolean; services?: Partial<Record<HostService, unknown>> })` from `src/components/modules/agent/editor-session.ts` | 01 Tasks 28, 28a, 29. This plan always passes `mergeSteps: 'turn'` (03's turn rule, 06 C11). |
| `InternalEditorHandle` shape | `= BlokModules` (01 Task 28). `AgentAPI` passes `this.Blok`. `BlokModules` has no config, so config values this plan needs (`agent.overrides`) are passed as options. | 01 Task 28 |
| Attribution opt-out | `options.attributeLastEditedBy?: boolean` on `createEditorAgentSession`. `false` keeps the human's `lastEditedBy` but still sets `detail.agent` | 01 Task 28a (added to 01 for this plan) |
| `turnId` | `detail.agent.turnId === session.id`: 01's `turnId` option defaults to the session id (01 Task 28), and this plan passes none | 01 Task 28 |
| Contract outside a session | `liveContractSource(Blok, { services, overrides }): ContractSource` (`{ contract(); runtimes(contract) }`) from the same module. `AgentAPI` builds ONE source with `overrides: this.config.agent?.overrides` and the service names of its service objects, uses `source.contract()` for `tools()` / `guidance()` / `inputIndexFor`, and passes the same source as `contractSource` to every session, so the rendered enum matches what the executor accepts. | 01 Task 28 |
| Browser service objects | This plan builds `pageBackend`, `linkMetadata`, `uploader` (Task 9a) to 02's shapes in `src/shared/tool-actions/services.ts` (02 Task 12) and passes them as `services` | 02 says 03 owns them; 01 Task 28a carries them in |
| Executor behaviour 03 relays | `READ_ONLY` before planning (C18); `CANCELLED` at three points with `details.orphaned` (R2-01-5); hidden action → `UNKNOWN_COMMAND` (R2-03-7); `changed` + `lastRange` on success; `revision` optional on failure | 06 |
| Undo | one step per `execute`; turn merge inside the session (C11); `UNDO_NOT_OWN` | 06 C11. 03's Tasks 13 and 25 pin R-U1..R-U6 and stay red until 01 lands the merge lever. **03 writes no undo code.** |
| Focus | `EditorApplier` never scrolls, never selects, never focuses. 06 C14 says internal `scrollToBlock` uses `{ select: false }`, but that call still scrolls. 03's Task 18 test fails if it does. | needs 01's confirmation |
| Caret capture | `EditorApplier` wraps writes to the user's caret block with `captureCaretAcrossRewrite` (06 03-Q5) | 06 |

**Needed from 02 (tool self-description):**

| Need | Canonical name / location |
|---|---|
| `AgentContract`, `CommandEntry`, `AgentGuidance` published types | `types/tool-manifest.d.ts` (02 Task 3 produces them there; `ContractSlice` and the session types are in `types/agent.d.ts`, 01 Tasks 1, 17) |
| `BlokToolManifest`, `BlockToolManifestEntry` (with `richTextFields`, `inputFields?`), `ManifestOverrides` | `types/tool-manifest.d.ts` (06 §3.8) |
| `inputFields` declared on every multi-input built-in | 02 task with its jsdom order test (06 §10.2) |
| `table.insertRows` exists as a `table` action (02 Task 32) | used by Task 10's overrides test |
| `PageBackendService` (block id in), `LinkMetadataService`, `UploaderService` (used by Task 9a) | `src/shared/tool-actions/services.ts` (02 Task 12) |

**What 04 and 05 need from this plan:**

| Consumer | Provided | Task |
|---|---|---|
| 04 | `renderAgentTools(contract, { format: 'mcp', handle: true })` from `src/agent/render-tools.ts`, importable from source in Node (pure, DOM-free). MCP `outputSchema` includes the `{ error: AgentError }` branch for `blok_read`/`blok_describe`, and `AgentResult & { delivery }` for `blok_execute`. | 2–5 |
| 04 | Browsers draw an MCP agent's `agent` and `agentCursor` awareness fields | 21–24 |
| 05 | `renderAgentTools` for the parity compare (`format: 'anthropic'` vs `format: 'mcp'`) | 2–5 |
| 05 | `editor.agent.begin(...)` for the `editor` parity runner and the `in-app-browser` evals | 7–12 |
| 05 | `adapter-blok-instance-law.test.ts` (03 §6 item 12) | 27 |
| 05 | Saved `lastEditedBy` = agent id on touched blocks (default `attributeTo: 'agent'`) | 12 |

---

## File Structure

**Create**

| Path | Responsibility |
|---|---|
| `types/api/agent.d.ts` | Public types: `Agent`, `AgentTurn`, `AgentToolsOptions`, `AgentAnthropicTool`, `AgentOpenAITool`, `AgentToolName`, `AgentIdentity`, `AgentTurnOptions`, `AgentToolResult`, `AgentState` |
| `src/agent/render-tools.ts` | Pure renderer: `renderAgentTools`, `RenderOptions`, `RenderedTool`, the two error classes, limits |
| `src/agent/result-schemas.ts` | JSON schemas for `AgentError`, `AgentWarning`, `AgentResult`, MCP `delivery` |
| `src/agent/schema-walk.ts` | Cycle-safe `measureSchema`, `isClosedSchema`, `hoistDefs` |
| `src/agent/guidance.ts` | `composeGuidance(contract)`: the contract's general guidance plus in-app rules |
| `src/components/modules/api/agent.ts` | `AgentAPI` module: `tools`, `guidance`, `begin`, `state`, `subscribe`, `inputIndexFor`, destroy |
| `src/components/modules/api/agent-turn.ts` | `createAgentTurn`: dispatch, queue, signal, end/stop |
| `src/components/modules/api/agent-services.ts` | `createEditorServices`: browser `pageBackend`, `linkMetadata`, `uploader` objects (Task 9a) |
| `src/components/modules/api/agent-presence.ts` | `createAgentPresence`: local caret/marker, pulse, follow, `agentCursor` publish |
| `src/components/modules/collaboration/agent-placement.ts` | `inputIndexForField`, `contractToDomOffset`, `placeAgent` |
| `src/components/modules/collaboration/agent-marker-layer.ts` | Block-level marker: outline plus name flag on a holder |
| `src/components/modules/collaboration/remote-agents.ts` | Gates `readAgentField`, `readAgentCursor`; `agentColorFor` |
| `test/unit/agent/fixtures/contract.ts` | `makeContract()` test fixture |
| `test/unit/agent/render-tools.test.ts`, `render-tools.node.test.ts`, `render-tools-public-types.test.ts` | Renderer tests |
| `test/unit/architecture/agent-public-types.test.ts` | Exports of the public surface |
| `test/unit/architecture/agent-tool-definition-law.test.ts` | Spec test 11 |
| `test/unit/architecture/adapter-blok-instance-law.test.ts` | Spec test 12 |
| `test/unit/components/modules/api/agent.test.ts`, `agent-turn.test.ts`, `agent-presence.test.ts`, `agent.integration.test.ts` | Module tests |
| `test/unit/components/modules/collaboration/agent-placement.test.ts`, `agent-marker-layer.test.ts`, `remote-agents.test.ts` | Collaboration-side tests |
| `test/playwright/tests/agent/in-app-turn.spec.ts`, `agent-peers.spec.ts`, `agent-adapters.spec.ts` | E2E |

**Modify**

| Path | Change |
|---|---|
| `types/api/index.d.ts` | `export * from './agent'` |
| `types/index.d.ts:18-50` (import), `:237-271` (`interface API`), `:160-208` (export list) | `agent: Agent` on `API`; export the new types |
| `types/configs/blok-config.d.ts` (after `user?` at `:1307`) | `agent?: { overrides?: ManifestOverrides }` |
| `types/events/editor-events.ts:56` | `agent?` on `CollaborationParticipant` |
| `src/components/modules/index.ts` | Register `AgentAPI` (API group, before `Collaboration`/`YjsManager`) |
| `src/types-internal/blok-modules.d.ts` | `AgentAPI: AgentAPI` |
| `src/components/modules/api/index.ts:39-91` | `agent: this.Blok.AgentAPI.methods` |
| `test/unit/components/modules/api/api-methods.test.ts:45-72` | `AgentAPI: emptyMethods` in `createBlokStub` |
| `src/shared/rich-text/html-to-segments.ts:20-23` | export `OPAQUE_TAGS` |
| `src/components/modules/collaboration/presence.ts` | export `capPresenceName` |
| `src/components/modules/collaboration/presence-avatars.ts:8-19`, `:101-127` | `agent?` flag, `data-blok-presence-agent` |
| `src/components/modules/collaboration/presence-renderer.ts` | agent labels, peers' `agentCursor` layers, new options |
| `src/components/modules/collaboration/participants.ts:80-152` | `agent` on rows |
| `src/components/modules/collaboration/index.ts:750-762` | pass agent options to the renderer |
| `src/styles/presence.css` | marker, flag and agent-face rules |
| `src/components/i18n/locales/*.json` (71 files) | `agent.changedOneBlock`, `agent.changedBlocks`, `presence.agentFor` |
| `types/message-keys.d.ts` | regenerated |
| `test/playwright/tests/helpers/collab.ts` | QueryAwareness nudge on join |
| `test/playwright/fixtures/react-test.html`, `vue-test.html`, `scripts/build-angular-vendor.mjs` (`APP_SOURCE`) | expose the live instance as `window.__blokEditor` |
| `docs/src/components/api/api-data.ts`, `api-nav.ts`, `docs-hub-summaries.ts`, `api-data.test.ts`, `docs/src/i18n/en.json`, `ru.json`, `docs/src/seo/lastmod-ledger.json` | Agent API reference |

**Run-ahead exceptions (06 §14 "Execution order").** Tasks 2–5 (renderer) need only 02 Task 3's `AgentContract` and may run before Task 1, which waits for 01 Task 17's `AgentSession`; Task 6 runs after Task 1. Tasks 14, 15 and 21 (placement math, marker layer, remote-field gates) use no 01/02 code and may run in wave 0. Every other task keeps this plan's order.

---

# Phase 1 — Shared renderer and public types

### Task 1: Public types for `editor.agent`

**Files:**
- Create: `types/api/agent.d.ts`
- Modify: `types/api/index.d.ts` (append one line), `types/index.d.ts:160-208` (export list)
- Test: `test/unit/architecture/agent-public-types.test.ts`

**Interfaces:**
- Consumes: from 01/02 via `types/agent.d.ts`: `AgentActor`, `AgentSession`.
- Produces: `Agent`, `AgentTurn`, `AgentToolsOptions`, `AgentAnthropicTool`, `AgentOpenAITool`, `AgentToolName`, `AgentIdentity`, `AgentTurnOptions`, `AgentToolResult`, `AgentState`, all exported from `types/index.d.ts`. `API` does NOT gain `agent` yet. That lands in Task 7, together with the runtime, so `API.methods` keeps type-checking.

- [ ] **Step 1: Gate on 01/02 published types**

Run:
```bash
cd /Users/jackuait/Packages/blok
for n in AgentActor AgentSession AgentBatch AgentCommand AgentResult AgentError ChangedSet TextRangeRef DocumentView ViewArgs ContractSlice; do grep -q "export .*\b$n\b" types/agent.d.ts && echo "ok $n" || echo "MISSING $n"; done
for n in AgentContract CommandEntry AgentGuidance BlokToolManifest BlockToolManifestEntry ManifestOverrides; do grep -q "export .*\b$n\b" types/tool-manifest.d.ts && echo "ok $n" || echo "MISSING $n"; done
```
Expected: every line starts with `ok`. A `MISSING` name may live in the other file: 06 §3.8 lists both `types/agent.d.ts` and `types/tool-manifest.d.ts`. Check with `grep -rn "export .*\b<Name>\b" types/`. If it is there, use that path in every import this plan writes. If it exists nowhere, STOP. Plans 01/02 have not landed it yet. Report which name is missing, and do not invent it here.

- [ ] **Step 2: Write the failing test**

`test/unit/architecture/agent-public-types.test.ts`:
```ts
/**
 * editor.agent's public types must be reachable from the package entry, and
 * AgentIdentity must be AgentActor without `kind` (06 §3.5).
 */
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const ENTRY = join(REPO_ROOT, 'types', 'index.d.ts');

const PUBLIC_NAMES = [
  'Agent', 'AgentTurn', 'AgentToolsOptions', 'AgentAnthropicTool', 'AgentOpenAITool',
  'AgentToolName', 'AgentIdentity', 'AgentTurnOptions', 'AgentToolResult', 'AgentState',
];

describe('editor.agent public types', () => {
  const program = ts.createProgram([ ENTRY ], {
    strict: true, noEmit: true, skipLibCheck: true,
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(ENTRY);

  if (source === undefined) {
    throw new Error(`Could not load ${ENTRY}`);
  }

  const moduleSymbol = checker.getSymbolAtLocation(source);
  const exported = moduleSymbol === undefined ? [] : checker.getExportsOfModule(moduleSymbol);
  const find = (name: string): ts.Symbol | undefined => exported.find((symbol) => symbol.getName() === name);

  it('exports every editor.agent type from the package entry', () => {
    expect(PUBLIC_NAMES.filter((name) => find(name) === undefined)).toEqual([]);
  });

  it('AgentIdentity has no kind but keeps id and name', () => {
    const identity = find('AgentIdentity');

    expect(identity).toBeDefined();

    const type = checker.getDeclaredTypeOfSymbol(identity as ts.Symbol);
    const names = checker.getPropertiesOfType(type).map((symbol) => symbol.getName()).sort();

    expect(names).toContain('id');
    expect(names).toContain('name');
    expect(names).not.toContain('kind');
  });

  it('compiles with no diagnostics', () => {
    const diagnostics = ts.getPreEmitDiagnostics(program)
      .filter((d) => d.file?.fileName.includes('/types/api/agent.d.ts') === true)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));

    expect(diagnostics).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn test test/unit/architecture/agent-public-types.test.ts`
Expected: FAIL. The first test lists all ten names as missing.

- [ ] **Step 4: Write the types**

`types/api/agent.d.ts`:
```ts
import type { AgentActor, AgentSession } from '../agent';

/** The three core tools, the same on the in-app and MCP surfaces. */
export type AgentToolName = 'blok_read' | 'blok_describe' | 'blok_execute';

export interface AgentToolsOptions {
  /** 'openai' = OpenAI Responses API function tool. */
  format: 'anthropic' | 'openai';
  /** Default 'envelope'. 'full' lists every command's argument schema and may throw AgentToolsTooLargeError. */
  schema?: 'envelope' | 'full';
  /** Emit strict: true where possible. Never on blok_execute. Throws AgentToolsStrictError when impossible. Default false. */
  strict?: boolean;
}

export interface AgentAnthropicTool {
  name: AgentToolName;
  description: string;
  input_schema: object;
  strict?: boolean;
}

export interface AgentOpenAITool {
  type: 'function';
  name: AgentToolName;
  description: string;
  parameters: object;
  strict?: boolean;
}

/** AgentActor without `kind`. */
export type AgentIdentity = Omit<AgentActor, 'kind'>;

export interface AgentTurnOptions {
  agent: AgentIdentity;
  /** Scroll to the agent's block until the user scrolls, types or clicks. Default false. */
  follow?: boolean;
  /** Who `lastEditedBy` names on blocks the agent changes. `detail.agent` is set either way. Default 'agent'. */
  attributeTo?: 'agent' | 'user';
}

export interface AgentToolResult {
  /** JSON text, ready for the provider's tool-result block. */
  content: string;
  /** True when the model should correct itself. Pass it as `is_error` (Anthropic). */
  isError: boolean;
}

/**
 * One run of agent work the user can see, stop and undo. An AgentSession plus
 * `signal`, `call`, `end` and `stop`. `close()` is `end()`.
 */
export interface AgentTurn extends AgentSession {
  readonly signal: AbortSignal;
  /** Run one tool call by its tool name. Accepts an object or a JSON string. */
  call(name: string, input: unknown): Promise<AgentToolResult>;
  end(): void;
  stop(): void;
}

export type AgentState =
  | { status: 'idle' }
  | { status: 'working'; turn: { id: string; agent: AgentIdentity } };

/** `editor.agent`. */
export interface Agent {
  /** LLM tool definitions for blok_read, blok_describe, blok_execute. Loads lazily. */
  tools(options: AgentToolsOptions & { format: 'anthropic' }): Promise<AgentAnthropicTool[]>;
  tools(options: AgentToolsOptions & { format: 'openai' }): Promise<AgentOpenAITool[]>;
  /** Guidance text for the system prompt. Loads lazily. */
  guidance(): Promise<string>;
  /** Open a turn. Throws AgentTurnOpenError when one is open. */
  begin(options: AgentTurnOptions): AgentTurn;
  /** Same object until the state changes, so it works with useSyncExternalStore. */
  readonly state: AgentState;
  /** Called on every state change. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}
```

Append to `types/api/index.d.ts`:
```ts
export * from './agent';
```

In `types/index.d.ts`, add to the `export { ... } from './api';` list that ends at line 208 (after `MoveToTarget,`):
```ts
  Agent,
  AgentTurn,
  AgentToolsOptions,
  AgentAnthropicTool,
  AgentOpenAITool,
  AgentToolName,
  AgentIdentity,
  AgentTurnOptions,
  AgentToolResult,
  AgentState,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn test test/unit/architecture/agent-public-types.test.ts`
Expected: PASS (3 tests).
Run: `yarn test test/unit/architecture/published-types-no-src-refs.test.ts`
Expected: PASS. This is spec test 22, partly. `types/api/agent.d.ts` imports only `../agent`.

- [ ] **Step 6: Lint and commit**

```bash
yarn eslint types/api/agent.d.ts types/api/index.d.ts types/index.d.ts test/unit/architecture/agent-public-types.test.ts
git add types/api/agent.d.ts types/api/index.d.ts types/index.d.ts test/unit/architecture/agent-public-types.test.ts
git diff --cached --name-only
git commit -m "feat(agent): public types for editor.agent" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Renderer, envelope mode (Anthropic and OpenAI)

**Files:**
- Create: `src/agent/render-tools.ts`, `test/unit/agent/fixtures/contract.ts`
- Test: `test/unit/agent/render-tools.test.ts`

**Interfaces:**
- Consumes: `AgentContract`, `CommandEntry` from `types/tool-manifest.d.ts` (02 Task 3).
- Produces:
  ```ts
  export type AgentToolName = 'blok_read' | 'blok_describe' | 'blok_execute';
  export interface RenderOptions { format: 'anthropic' | 'openai' | 'mcp'; schema?: 'envelope' | 'full'; strict?: boolean; handle?: boolean }
  export type RenderedTool =
    | { name: AgentToolName; description: string; input_schema: object; strict?: boolean }
    | { type: 'function'; name: AgentToolName; description: string; parameters: object; strict?: boolean }
    | { name: AgentToolName; description: string; inputSchema: object; outputSchema: object };
  export const TOOL_NAME_PATTERN: RegExp;
  export function renderAgentTools(contract: AgentContract, options: RenderOptions): RenderedTool[];
  ```
  Tasks 3–5 extend this same file.

- [ ] **Step 1: Write the fixture**

`test/unit/agent/fixtures/contract.ts`:
```ts
import type { AgentContract, CommandEntry } from '../../../../types/tool-manifest';

type Schema = Record<string, unknown>;

/** A command entry with the defaults most tests do not care about. */
export const command = (name: string, args: Schema, extra: Partial<CommandEntry> = {}): CommandEntry => ({
  name,
  summary: `${name} summary`,
  args,
  readOnly: false,
  runtime: 'any',
  source: 'core',
  available: true,
  ...extra,
});

/** The recursive insert spec, expressed the way a self-contained schema must: $defs + local $ref. */
const insertArgs: Schema = {
  type: 'object',
  properties: {
    type: { type: 'string' },
    children: { type: 'array', items: { $ref: '#/$defs/InsertSpec' } },
  },
  required: ['type'],
  $defs: {
    InsertSpec: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        children: { type: 'array', items: { $ref: '#/$defs/InsertSpec' } },
      },
      required: ['type'],
    },
  },
};

export const FIXTURE_COMMANDS: CommandEntry[] = [
  command('block.insert', insertArgs),
  command('doc.read', { type: 'object', properties: { depth: { type: 'integer' } }, additionalProperties: false },
    { readOnly: true, result: { type: 'object', properties: { blocks: { type: 'array' } } } }),
  command('page.rename', { type: 'object', properties: { title: { type: 'string' } } },
    { source: { tool: 'page', target: 'block' }, available: false, unavailableReason: 'service', requires: ['pageBackend'] }),
  command('poll.addOption', { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] },
    { source: { tool: 'poll', target: 'block' } }),
  command('table.insertRows', { type: 'object', properties: { at: { type: 'integer' }, count: { type: 'integer' } } },
    { source: { tool: 'table', target: 'block' } }),
];

/**
 * A minimal AgentContract. `poll` stands in for a host custom tool.
 * `manifest` fields follow 02's BlokToolManifest (02 spec, BlokToolManifest).
 */
export const makeContract = (commands: CommandEntry[] = FIXTURE_COMMANDS): AgentContract => ({
  formatVersion: 1,
  revision: 'rev-1',
  commands,
  manifest: {
    formatVersion: 1,
    blokVersion: 'test',
    revision: 'manifest-1',
    readOnly: false,
    defaultBlock: 'paragraph',
    blocks: [],
    inlineTools: [],
    tunes: [],
  },
  guidance: { general: 'General guidance.', commands: {}, tools: {} },
});

/** Freeze deeply, so a renderer that mutates its input throws. */
export const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.values(value).forEach((child) => deepFreeze(child));
    Object.freeze(value);
  }

  return value;
};
```

- [ ] **Step 2: Write the failing tests**

`test/unit/agent/render-tools.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderAgentTools, TOOL_NAME_PATTERN, type RenderedTool } from '../../../src/agent/render-tools';
import { deepFreeze, makeContract } from './fixtures/contract';

type Schema = Record<string, unknown>;

const inputOf = (tool: RenderedTool): Schema => {
  if ('input_schema' in tool) {
    return tool.input_schema as Schema;
  }

  if ('parameters' in tool) {
    return tool.parameters as Schema;
  }

  return tool.inputSchema as Schema;
};

const byName = (tools: RenderedTool[], name: string): RenderedTool => {
  const found = tools.find((tool) => tool.name === name);

  if (found === undefined) {
    throw new Error(`no tool ${name}`);
  }

  return found;
};

const executeItems = (tool: RenderedTool): Schema => {
  const commands = (inputOf(tool).properties as Record<string, Schema>).commands;

  return commands.items as Schema;
};

describe('renderAgentTools — test 3, envelope mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['anthropic', 'openai'] as const)('%s: renders exactly the three core tools with legal names', (format) => {
    const tools = renderAgentTools(makeContract(), { format });

    expect(tools.map((tool) => tool.name)).toEqual(['blok_read', 'blok_describe', 'blok_execute']);
    tools.forEach((tool) => expect(tool.name).toMatch(TOOL_NAME_PATTERN));
  });

  it.each(['anthropic', 'openai'] as const)('%s: every root schema is an object with no root anyOf/oneOf', (format) => {
    renderAgentTools(makeContract(), { format }).forEach((tool) => {
      const root = inputOf(tool);

      expect(root.type).toBe('object');
      expect(root).not.toHaveProperty('anyOf');
      expect(root).not.toHaveProperty('oneOf');
    });
  });

  it('anthropic shape is { name, description, input_schema }', () => {
    const tool = byName(renderAgentTools(makeContract(), { format: 'anthropic' }), 'blok_read');

    expect(Object.keys(tool).sort()).toEqual(['description', 'input_schema', 'name']);
  });

  it('openai shape is the Responses API function tool', () => {
    const tool = byName(renderAgentTools(makeContract(), { format: 'openai' }), 'blok_read');

    expect(Object.keys(tool).sort()).toEqual(['description', 'name', 'parameters', 'type']);
    expect(tool).toMatchObject({ type: 'function' });
  });

  it('blok_execute envelope: name is an enum of AVAILABLE commands only, args is open', () => {
    const items = executeItems(byName(renderAgentTools(makeContract(), { format: 'anthropic' }), 'blok_execute'));
    const properties = items.properties as Record<string, Schema>;

    expect(properties.name.enum).toEqual(['block.insert', 'doc.read', 'poll.addOption', 'table.insertRows']);
    expect(properties.name.enum).not.toContain('page.rename');
    expect(properties.args).toEqual({ type: 'object' });
    expect(items.required).toEqual(['name', 'args']);
  });

  it('blok_execute input is { commands, expectRevision? } with commands required', () => {
    const root = inputOf(byName(renderAgentTools(makeContract(), { format: 'anthropic' }), 'blok_execute'));

    expect(Object.keys(root.properties as Schema).sort()).toEqual(['commands', 'expectRevision']);
    expect(root.required).toEqual(['commands']);
  });

  it('blok_read input is doc.read args; blok_describe input is { tool?, command? }', () => {
    const tools = renderAgentTools(makeContract(), { format: 'anthropic' });

    expect(inputOf(byName(tools, 'blok_read'))).toMatchObject({ type: 'object', properties: { depth: { type: 'integer' } } });
    expect(inputOf(byName(tools, 'blok_describe'))).toEqual({
      type: 'object',
      properties: { tool: { type: 'string' }, command: { type: 'string' } },
      additionalProperties: false,
    });
  });

  it('never mutates the contract', () => {
    expect(() => renderAgentTools(deepFreeze(makeContract()), { format: 'openai' })).not.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn test test/unit/agent/render-tools.test.ts`
Expected: FAIL with "Failed to resolve import ../../../src/agent/render-tools".

- [ ] **Step 4: Write minimal implementation**

`src/agent/render-tools.ts`:
```ts
import type { AgentContract, CommandEntry } from '../../types/tool-manifest';

export type AgentToolName = 'blok_read' | 'blok_describe' | 'blok_execute';

export interface RenderOptions {
  format: 'anthropic' | 'openai' | 'mcp';
  /** Default 'envelope' until 05's eval decides. */
  schema?: 'envelope' | 'full';
  /** Never applied to blok_execute: its children are recursive. */
  strict?: boolean;
  /** MCP only: adds a required `handle` with `x-mcp-header: "Blok-Handle"` to every core tool. */
  handle?: boolean;
}

export type RenderedTool =
  | { name: AgentToolName; description: string; input_schema: object; strict?: boolean }
  | { type: 'function'; name: AgentToolName; description: string; parameters: object; strict?: boolean }
  | { name: AgentToolName; description: string; inputSchema: object; outputSchema: object };

type Schema = Record<string, unknown>;

/** Anthropic's tool-name rule. It forbids dots, so command names cannot be tool names. */
export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

const DESCRIPTIONS: Record<AgentToolName, string> = {
  blok_read: 'Read the document as a tree of blocks with ids, types and text. Read before you edit, and again after a STALE error.',
  blok_describe: 'Look up what you can do. With no arguments it lists tools and commands. Pass { tool } or { command } to get the argument schema.',
  blok_execute: 'Run a batch of commands. Either all of them land or none do. Use block ids from blok_read. Call blok_describe for a command\'s arguments.',
};

const availableCommands = (contract: AgentContract): CommandEntry[] =>
  contract.commands.filter((entry) => entry.available);

const readInput = (contract: AgentContract): Schema => {
  const entry = contract.commands.find((candidate) => candidate.name === 'doc.read');

  return entry === undefined
    ? { type: 'object', properties: {}, additionalProperties: false }
    : { ...(entry.args as Schema), type: 'object' };
};

const describeInput = (): Schema => ({
  type: 'object',
  properties: { tool: { type: 'string' }, command: { type: 'string' } },
  additionalProperties: false,
});

const envelopeItem = (names: string[]): Schema => ({
  type: 'object',
  properties: {
    name: { type: 'string', enum: names },
    args: { type: 'object' },
    ref: { type: 'string' },
  },
  required: ['name', 'args'],
});

const executeInput = (items: Schema): Schema => ({
  type: 'object',
  properties: {
    commands: { type: 'array', minItems: 1, items },
    expectRevision: { type: 'string' },
  },
  required: ['commands'],
});

const wrap = (options: RenderOptions, name: AgentToolName, input: Schema, strict: boolean): RenderedTool => {
  const description = DESCRIPTIONS[name];
  const strictFlag = strict ? { strict: true } : {};

  if (options.format === 'openai') {
    return { type: 'function', name, description, parameters: input, ...strictFlag };
  }

  return { name, description, input_schema: input, ...strictFlag };
};

/**
 * Turn an AgentContract into the three core tool definitions.
 * Pure and DOM-free: 04 bundles this file into the Node MCP server.
 * @param contract - the contract for the runner that will execute the calls
 * @param options - provider format, schema detail and strictness
 */
export function renderAgentTools(contract: AgentContract, options: RenderOptions): RenderedTool[] {
  const names = availableCommands(contract).map((entry) => entry.name);

  return [
    wrap(options, 'blok_read', readInput(contract), false),
    wrap(options, 'blok_describe', describeInput(), false),
    wrap(options, 'blok_execute', executeInput(envelopeItem(names)), false),
  ];
}
```
The fixture lists commands sorted by name, as 06 §3.6 requires of `AgentContract.commands`. So the enum keeps contract order and the renderer does not re-sort.

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn test test/unit/agent/render-tools.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Lint and commit**

```bash
yarn eslint src/agent/render-tools.ts test/unit/agent/render-tools.test.ts test/unit/agent/fixtures/contract.ts
git add src/agent/render-tools.ts test/unit/agent/render-tools.test.ts test/unit/agent/fixtures/contract.ts
git diff --cached --name-only
git commit -m "feat(agent): renderAgentTools envelope mode for anthropic and openai" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Renderer `strict` rules

**Files:**
- Create: `src/agent/schema-walk.ts`
- Modify: `src/agent/render-tools.ts`
- Test: `test/unit/agent/render-tools.test.ts` (append a `describe`)

**Interfaces:**
- Produces:
  ```ts
  // src/agent/schema-walk.ts
  export function isClosedSchema(schema: unknown): boolean;
  // src/agent/render-tools.ts
  export class AgentToolsStrictError extends Error { readonly tool: AgentToolName; readonly reason: string }
  ```

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/agent/render-tools.test.ts`. Also add `AgentToolsStrictError` to the existing import from `../../../src/agent/render-tools`, and `command` to the import from `./fixtures/contract`:
```ts
describe('renderAgentTools — test 3, strict', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['anthropic', 'openai'] as const)('%s: blok_execute never carries strict, even when asked', (format) => {
    (['envelope', 'full'] as const).forEach((schema) => {
      const tool = byName(renderAgentTools(makeContract(), { format, schema, strict: true }), 'blok_execute');

      expect(tool).not.toHaveProperty('strict');
    });
  });

  it('closed read/describe schemas get strict: true when asked', () => {
    const tools = renderAgentTools(makeContract(), { format: 'anthropic', strict: true });

    expect(byName(tools, 'blok_read')).toMatchObject({ strict: true });
    expect(byName(tools, 'blok_describe')).toMatchObject({ strict: true });
  });

  it('no tool carries strict when strict is not asked', () => {
    renderAgentTools(makeContract(), { format: 'openai' }).forEach((tool) => expect(tool).not.toHaveProperty('strict'));
  });

  it('an open object anywhere in blok_read throws AgentToolsStrictError naming the tool', () => {
    const openRead = makeContract([
      command('doc.read', {
        type: 'object',
        properties: { where: { type: 'object', properties: { id: { type: 'string' } } } },
        additionalProperties: false,
      }, { readOnly: true }),
    ]);

    expect(() => renderAgentTools(openRead, { format: 'anthropic', strict: true }))
      .toThrow(expect.objectContaining({ name: 'AgentToolsStrictError', tool: 'blok_read' }) as Error);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/agent/render-tools.test.ts`
Expected: FAIL. `AgentToolsStrictError` is not exported, and `strict: true` is missing on `blok_read`.

- [ ] **Step 3: Implement**

`src/agent/schema-walk.ts`:
```ts
type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Every object schema inside has `additionalProperties: false`.
 * Guarded by the current path, not a seen-set: a shared sub-schema is checked
 * at each place it appears, and a JS cycle stops instead of overflowing.
 * @param schema - any JSON schema value
 */
export function isClosedSchema(schema: unknown): boolean {
  const path = new Set<object>();

  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) {
      return value.every(visit);
    }

    if (!isNode(value) || path.has(value)) {
      return true;
    }

    path.add(value);

    const isObjectSchema = value.type === 'object' || isNode(value.properties);
    const closed = !isObjectSchema || value.additionalProperties === false;
    const childrenClosed = Object.values(value).every(visit);

    path.delete(value);

    return closed && childrenClosed;
  };

  return visit(schema);
}
```

In `src/agent/render-tools.ts`, add:
```ts
import { isClosedSchema } from './schema-walk';

export class AgentToolsStrictError extends Error {
  public readonly tool: AgentToolName;
  public readonly reason: string;

  public constructor(tool: AgentToolName, reason: string) {
    super(`Cannot render ${tool} with strict: true: ${reason}`);
    this.name = 'AgentToolsStrictError';
    this.tool = tool;
    this.reason = reason;
  }
}

/** Strict only when asked and provable. Throws rather than silently dropping it. */
const strictFor = (options: RenderOptions, name: AgentToolName, input: Schema): boolean => {
  if (options.strict !== true || name === 'blok_execute' || options.format === 'mcp') {
    return false;
  }

  if (!isClosedSchema(input)) {
    throw new AgentToolsStrictError(name, 'an object schema has no additionalProperties: false');
  }

  return true;
};
```
Change the body of `renderAgentTools` to:
```ts
  const names = availableCommands(contract).map((entry) => entry.name);
  const read = readInput(contract);
  const describe = describeInput();
  const execute = executeInput(envelopeItem(names));

  return [
    wrap(options, 'blok_read', read, strictFor(options, 'blok_read', read)),
    wrap(options, 'blok_describe', describe, strictFor(options, 'blok_describe', describe)),
    wrap(options, 'blok_execute', execute, false),
  ];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test test/unit/agent/render-tools.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Lint and commit**

```bash
yarn eslint src/agent/render-tools.ts src/agent/schema-walk.ts test/unit/agent/render-tools.test.ts
git add src/agent/render-tools.ts src/agent/schema-walk.ts test/unit/agent/render-tools.test.ts
git diff --cached --name-only
git commit -m "feat(agent): strict only where provable, never on blok_execute" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Renderer `'full'` mode and OpenAI limits

**Files:**
- Modify: `src/agent/schema-walk.ts`, `src/agent/render-tools.ts`
- Test: `test/unit/agent/render-tools.test.ts` (append)

**Interfaces:**
- Produces:
  ```ts
  // schema-walk.ts
  export interface SchemaSize { properties: number; depth: number; enumValues: number }
  export function measureSchema(schema: unknown): SchemaSize;
  export function hoistDefs(prefix: string, schema: Record<string, unknown>, into: Record<string, unknown>): Record<string, unknown>;
  // render-tools.ts
  export const OPENAI_SCHEMA_LIMITS: { readonly properties: 5000; readonly depth: 10; readonly enumValues: 1000 };
  export class AgentToolsTooLargeError extends Error { readonly limit: keyof typeof OPENAI_SCHEMA_LIMITS; readonly actual: number }
  ```
- **Assumption, unverified (01 owns `COMMANDS`):** a recursive args schema is self-contained. It uses `$ref` only into its own top-level `$defs`, in the form `#/$defs/<Name>`. 02 forbids `$ref` in tool schemas (02 spec §3.4 profile), so only core commands such as `block.insert` can carry one. If 01 expresses recursion differently, adapt `hoistDefs` and its test together.

- [ ] **Step 1: Write the failing tests**

Append (add `AgentToolsTooLargeError` to the import):
```ts
describe('renderAgentTools — test 3, full mode and limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('items are a oneOf with one closed branch per available command', () => {
    const items = executeItems(byName(renderAgentTools(makeContract(), { format: 'anthropic', schema: 'full' }), 'blok_execute'));
    const branches = items.oneOf as Schema[];

    expect(branches.map((branch) => ((branch.properties as Record<string, Schema>).name).const))
      .toEqual(['block.insert', 'doc.read', 'poll.addOption', 'table.insertRows']);
    branches.forEach((branch) => expect(branch.additionalProperties).toBe(false));
  });

  it('hoists a command\'s $defs to the root and rewrites its refs', () => {
    const root = inputOf(byName(renderAgentTools(makeContract(), { format: 'openai', schema: 'full' }), 'blok_execute'));
    const defs = root.$defs as Record<string, Schema>;
    const insert = ((root.properties as Record<string, Schema>).commands.items as Schema).oneOf as Schema[];
    const insertArgs = (insert[0].properties as Record<string, Schema>).args;

    expect(Object.keys(defs)).toEqual(['block_insert__InsertSpec']);
    expect(insertArgs).not.toHaveProperty('$defs');
    expect(JSON.stringify(insertArgs)).toContain('"#/$defs/block_insert__InsertSpec"');
    expect(JSON.stringify(defs)).not.toContain('"#/$defs/InsertSpec"');
  });

  it('throws AgentToolsTooLargeError past 5000 properties', () => {
    const properties = Object.fromEntries(Array.from({ length: 5001 }, (_, index) => [`p${index}`, { type: 'string' }]));
    const big = makeContract([command('huge.action', { type: 'object', properties })]);

    expect(() => renderAgentTools(big, { format: 'openai', schema: 'full' }))
      .toThrow(expect.objectContaining({ name: 'AgentToolsTooLargeError', limit: 'properties' }) as Error);
  });

  it('throws past 10 levels of nesting', () => {
    const nest = (depth: number): Schema => (depth === 0
      ? { type: 'string' }
      : { type: 'object', properties: { child: nest(depth - 1) } });
    const deep = makeContract([command('deep.action', nest(10))]);

    expect(() => renderAgentTools(deep, { format: 'openai', schema: 'full' }))
      .toThrow(expect.objectContaining({ limit: 'depth' }) as Error);
  });

  it('throws past 1000 enum values', () => {
    const values = Array.from({ length: 1001 }, (_, index) => `v${index}`);
    const wide = makeContract([command('wide.action', { type: 'object', properties: { pick: { type: 'string', enum: values } } })]);

    expect(() => renderAgentTools(wide, { format: 'openai', schema: 'full' }))
      .toThrow(expect.objectContaining({ limit: 'enumValues' }) as Error);
  });

  it('envelope mode never throws on size', () => {
    const properties = Object.fromEntries(Array.from({ length: 6000 }, (_, index) => [`p${index}`, { type: 'string' }]));

    expect(() => renderAgentTools(makeContract([command('huge.action', { type: 'object', properties })]), { format: 'openai' }))
      .not.toThrow();
  });

  it('a JS cycle in a schema object does not hang or overflow', () => {
    const node: Schema = { type: 'object', properties: {} };

    (node.properties as Schema).self = node;

    expect(() => renderAgentTools(makeContract([command('cyclic.action', node)]), { format: 'anthropic', schema: 'full' }))
      .not.toThrow(RangeError);
  });
});
```
In the depth test, `nest(10)` gives 10 nested objects inside the branch's `args`. The execute root and the `oneOf` branch each add one level, so the measured depth is 12.

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/agent/render-tools.test.ts`
Expected: FAIL. `items.oneOf` is undefined, and `AgentToolsTooLargeError` is not exported.

- [ ] **Step 3: Implement**

Append to `src/agent/schema-walk.ts`:
```ts
export interface SchemaSize {
  properties: number;
  depth: number;
  enumValues: number;
}

/**
 * Count what OpenAI structured outputs limits. Shared sub-schemas count at
 * each place they appear, as the provider sees them. `$ref` is not followed:
 * a hoisted def is counted once, where it is defined.
 * @param schema - a rendered input schema
 */
export function measureSchema(schema: unknown): SchemaSize {
  const size: SchemaSize = { properties: 0, depth: 0, enumValues: 0 };
  const path = new Set<object>();

  const visit = (value: unknown, depth: number): void => {
    if (Array.isArray(value)) {
      value.forEach((child) => visit(child, depth));

      return;
    }

    if (!isNode(value) || path.has(value)) {
      return;
    }

    path.add(value);

    const props = value.properties;
    const here = isNode(props) ? depth + 1 : depth;

    size.depth = Math.max(size.depth, here);
    size.properties += isNode(props) ? Object.keys(props).length : 0;
    size.enumValues += Array.isArray(value.enum) ? value.enum.length : 0;
    Object.values(value).forEach((child) => visit(child, here));
    path.delete(value);
  };

  visit(schema, 0);

  return size;
}

const LOCAL_DEF = /^#\/\$defs\/(.+)$/;

/**
 * Copy `schema` without its `$defs`. Each def moves into `into` under
 * `<prefix>__<Name>`, and every `#/$defs/<Name>` ref is rewritten. Once a
 * command's args sit inside the execute schema, `#` means that root, so a ref
 * left pointing at the old `$defs` would dangle.
 * @param prefix - the command name, made identifier-safe by the caller
 * @param schema - one command's args schema; never mutated
 * @param into - the root `$defs` being collected
 */
export function hoistDefs(prefix: string, schema: Record<string, unknown>, into: Record<string, unknown>): Record<string, unknown> {
  const defs = isNode(schema.$defs) ? schema.$defs : {};
  const rename = (name: string): string => `${prefix}__${name}`;
  const copies = new Map<object, unknown>();

  const copy = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(copy);
    }

    if (!isNode(value)) {
      return value;
    }

    const known = copies.get(value);

    if (known !== undefined) {
      return known;
    }

    const out: Record<string, unknown> = {};

    copies.set(value, out);
    Object.entries(value).forEach(([key, child]) => {
      const match = key === '$ref' && typeof child === 'string' ? LOCAL_DEF.exec(child) : null;

      if (key === '$defs' && value === schema) {
        return;
      }

      out[key] = match === null ? copy(child) : `#/$defs/${rename(match[1])}`;
    });

    return out;
  };

  Object.entries(defs).forEach(([name, def]) => {
    into[rename(name)] = copy(def);
  });

  return copy(schema) as Record<string, unknown>;
}
```

In `src/agent/render-tools.ts`, add:
```ts
import { hoistDefs, isClosedSchema, measureSchema, type SchemaSize } from './schema-walk';

/** OpenAI "Structured outputs" limits. Only 'full' mode can approach them. */
export const OPENAI_SCHEMA_LIMITS = { properties: 5000, depth: 10, enumValues: 1000 } as const;

export class AgentToolsTooLargeError extends Error {
  public readonly limit: keyof typeof OPENAI_SCHEMA_LIMITS;
  public readonly actual: number;

  public constructor(limit: keyof typeof OPENAI_SCHEMA_LIMITS, actual: number) {
    super(`The 'full' schema has ${actual} ${limit}; the limit is ${OPENAI_SCHEMA_LIMITS[limit]}. Use schema: 'envelope'.`);
    this.name = 'AgentToolsTooLargeError';
    this.limit = limit;
    this.actual = actual;
  }
}

const safePrefix = (name: string): string => name.replace(/[^A-Za-z0-9_]/g, '_');

const fullExecuteInput = (contract: AgentContract): Schema => {
  const defs: Record<string, unknown> = {};
  const branches = availableCommands(contract).map((entry) => ({
    type: 'object',
    properties: {
      name: { const: entry.name },
      args: hoistDefs(safePrefix(entry.name), entry.args as Schema, defs),
      ref: { type: 'string' },
    },
    required: ['name', 'args'],
    additionalProperties: false,
  }));
  const root = executeInput({ oneOf: branches });

  return Object.keys(defs).length === 0 ? root : { ...root, $defs: defs };
};

const assertWithinLimits = (schema: Schema): void => {
  const size: SchemaSize = measureSchema(schema);

  (Object.keys(OPENAI_SCHEMA_LIMITS) as Array<keyof typeof OPENAI_SCHEMA_LIMITS>).forEach((limit) => {
    if (size[limit] > OPENAI_SCHEMA_LIMITS[limit]) {
      throw new AgentToolsTooLargeError(limit, size[limit]);
    }
  });
};
```
In `renderAgentTools`, replace the `execute` line with:
```ts
  const execute = options.schema === 'full' ? fullExecuteInput(contract) : executeInput(envelopeItem(names));

  if (options.schema === 'full') {
    assertWithinLimits(execute);
  }
```
`hoistDefs` copies with a memo map, so the cycle test returns a cyclic copy instead of overflowing. `measureSchema` stops at the cycle through its path guard.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test test/unit/agent/render-tools.test.ts`
Expected: PASS (20 tests).

- [ ] **Step 5: Lint and commit**

```bash
yarn eslint src/agent/render-tools.ts src/agent/schema-walk.ts test/unit/agent/render-tools.test.ts
git add src/agent/render-tools.ts src/agent/schema-walk.ts test/unit/agent/render-tools.test.ts
git diff --cached --name-only
git commit -m "feat(agent): full schema mode with hoisted defs and OpenAI limits" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Renderer MCP format, and a Node purity check

**Files:**
- Create: `src/agent/result-schemas.ts`, `test/unit/agent/render-tools.node.test.ts`
- Modify: `src/agent/render-tools.ts`
- Test: `test/unit/agent/render-tools.test.ts` (append; spec test 27)

**Interfaces:**
- Produces: `AGENT_ERROR_SCHEMA`, `AGENT_RESULT_SCHEMA`, `DELIVERY_SCHEMA` from `src/agent/result-schemas.ts`. MCP tools are `{ name, description, inputSchema, outputSchema }`.
- 04 relies on: `outputSchema` for `blok_read`/`blok_describe` = `{ type: 'object', oneOf: [<success>, { error }] }`; for `blok_execute` = the `AgentResult` branches, each with a required `delivery`. With `handle: true`, every core tool has a required `handle: { type: 'string', 'x-mcp-header': 'Blok-Handle' }`. That shape is taken from 04 spec line 488.
- **Unverified:** whether MCP requires `type: 'object'` at the `outputSchema` root. The renderer always sets it next to `oneOf`, which is valid JSON Schema either way.

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/agent/render-tools.test.ts`:
```ts
describe('renderAgentTools — test 27, MCP format', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mcp = (handle: boolean): RenderedTool[] => renderAgentTools(makeContract(), { format: 'mcp', handle });
  const outputOf = (tool: RenderedTool): Schema => ('outputSchema' in tool ? tool.outputSchema as Schema : {});

  it('shape is { name, description, inputSchema, outputSchema } and never strict', () => {
    renderAgentTools(makeContract(), { format: 'mcp', strict: true }).forEach((tool) => {
      expect(Object.keys(tool).sort()).toEqual(['description', 'inputSchema', 'name', 'outputSchema']);
    });
  });

  it.each(['blok_read', 'blok_describe'])('%s output is a oneOf with an { error } branch', (name) => {
    const output = outputOf(byName(mcp(false), name));
    const branches = output.oneOf as Schema[];

    expect(output.type).toBe('object');
    expect(branches).toHaveLength(2);
    expect(branches[1]).toMatchObject({ type: 'object', required: ['error'], additionalProperties: false });
  });

  it('blok_execute output is AgentResult plus delivery, with no bare { error } branch', () => {
    const branches = outputOf(byName(mcp(false), 'blok_execute')).oneOf as Schema[];

    expect(branches).toHaveLength(2);
    branches.forEach((branch) => {
      expect(branch.required).toContain('delivery');
      expect(branch.required).toContain('ok');
    });
  });

  it('handle: true adds a required x-mcp-header handle to every core tool', () => {
    mcp(true).forEach((tool) => {
      const input = inputOf(tool);

      expect((input.properties as Record<string, Schema>).handle).toEqual({ type: 'string', 'x-mcp-header': 'Blok-Handle' });
      expect(input.required).toContain('handle');
    });
  });

  it('handle is absent without handle: true and in non-MCP formats', () => {
    [...mcp(false), ...renderAgentTools(makeContract(), { format: 'anthropic', handle: true })].forEach((tool) => {
      expect(inputOf(tool).properties).not.toHaveProperty('handle');
    });
  });
});
```

`test/unit/agent/render-tools.node.test.ts`:
```ts
// @vitest-environment node
/**
 * 04 bundles the renderer into a Node server. Nothing in it may touch the DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderAgentTools } from '../../../src/agent/render-tools';
import { makeContract } from './fixtures/contract';

describe('renderAgentTools in Node', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs with no DOM globals', () => {
    expect(typeof document).toBe('undefined');
    expect(renderAgentTools(makeContract(), { format: 'mcp', handle: true, schema: 'full' })).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test test/unit/agent/render-tools.test.ts`
Expected: FAIL. MCP tools come back in the Anthropic shape.
Run: `yarn test test/unit/agent/render-tools.node.test.ts`
Expected: PASS already. It is a guard, not a red test, and stays as the purity pin.

- [ ] **Step 3: Implement**

`src/agent/result-schemas.ts`:
```ts
/** JSON schemas of 06 §3.2 shapes, for MCP outputSchema. Kept in step with types/agent.d.ts by hand: 04's law test compares a real result against them. */
const STRING = { type: 'string' } as const;
const INTEGER = { type: 'integer' } as const;
const IDS = { type: 'array', items: STRING } as const;

export const AGENT_ERROR_SCHEMA = {
  type: 'object',
  properties: {
    code: STRING, message: STRING, commandIndex: INTEGER, path: STRING,
    retryable: { type: 'boolean' }, details: { type: 'object' },
  },
  required: ['code', 'message', 'retryable'],
} as const;

const WARNING = {
  type: 'object',
  properties: { code: STRING, message: STRING, commandIndex: INTEGER, blockId: STRING, field: STRING },
  required: ['code', 'message'],
} as const;

const CHANGED = {
  type: 'object',
  properties: { created: IDS, updated: IDS, moved: IDS, removed: IDS },
  required: ['created', 'updated', 'moved', 'removed'],
} as const;

const RANGE = {
  type: 'object',
  properties: { blockId: STRING, field: STRING, start: INTEGER, end: INTEGER },
  required: ['blockId', 'field', 'start', 'end'],
} as const;

export const DELIVERY_SCHEMA = {
  type: 'object',
  properties: {
    durable: { type: 'boolean' }, pending: { type: 'boolean' },
    serverSequence: { type: ['string', 'null'] }, savedVersion: { type: ['string', 'null'] },
  },
  required: ['durable', 'pending', 'serverSequence', 'savedVersion'],
} as const;

const SUCCESS = {
  type: 'object',
  properties: {
    ok: { const: true }, revision: STRING, results: { type: 'array' },
    refs: { type: 'object', additionalProperties: STRING },
    changed: CHANGED, lastRange: RANGE, warnings: { type: 'array', items: WARNING },
  },
  required: ['ok', 'revision', 'results', 'refs', 'changed', 'warnings'],
} as const;

const FAILURE = {
  type: 'object',
  properties: { ok: { const: false }, revision: STRING, error: AGENT_ERROR_SCHEMA, warnings: { type: 'array', items: WARNING } },
  required: ['ok', 'error', 'warnings'],
} as const;

export const AGENT_RESULT_SCHEMA = { type: 'object', oneOf: [SUCCESS, FAILURE] } as const;

/** AgentResult & { delivery } (06 §3.7). */
export const withDelivery = (branch: typeof SUCCESS | typeof FAILURE): Record<string, unknown> => ({
  ...branch,
  properties: { ...branch.properties, delivery: DELIVERY_SCHEMA },
  required: [...branch.required, 'delivery'],
});

export const EXECUTE_OUTPUT_SCHEMA = { type: 'object', oneOf: [withDelivery(SUCCESS), withDelivery(FAILURE)] } as const;

/** blok_read / blok_describe can fail before a session exists (06 R2-04-3). */
export const orError = (success: Record<string, unknown>): Record<string, unknown> => ({
  type: 'object',
  oneOf: [success, { type: 'object', properties: { error: AGENT_ERROR_SCHEMA }, required: ['error'], additionalProperties: false }],
});
```

In `src/agent/render-tools.ts`:
```ts
import { EXECUTE_OUTPUT_SCHEMA, orError } from './result-schemas';

const HANDLE = { type: 'string', 'x-mcp-header': 'Blok-Handle' } as const;

const withHandle = (options: RenderOptions, input: Schema): Schema => {
  if (options.format !== 'mcp' || options.handle !== true) {
    return input;
  }

  const required = Array.isArray(input.required) ? input.required as string[] : [];

  return { ...input, properties: { ...(input.properties as Schema), handle: HANDLE }, required: [...required, 'handle'] };
};

const outputFor = (contract: AgentContract, name: AgentToolName): Schema => {
  if (name === 'blok_execute') {
    return EXECUTE_OUTPUT_SCHEMA;
  }

  const read = contract.commands.find((entry) => entry.name === 'doc.read');
  const success = name === 'blok_read' && read?.result !== undefined ? read.result as Schema : { type: 'object' };

  return orError(success);
};
```
Change `wrap` to take the contract and attach handle and output for MCP:
```ts
const wrap = (contract: AgentContract, options: RenderOptions, name: AgentToolName, rawInput: Schema, strict: boolean): RenderedTool => {
  const description = DESCRIPTIONS[name];
  const input = withHandle(options, rawInput);
  const strictFlag = strict ? { strict: true } : {};

  if (options.format === 'mcp') {
    return { name, description, inputSchema: input, outputSchema: outputFor(contract, name) };
  }

  if (options.format === 'openai') {
    return { type: 'function', name, description, parameters: input, ...strictFlag };
  }

  return { name, description, input_schema: input, ...strictFlag };
};
```
Pass `contract` as the first argument at the three call sites in `renderAgentTools`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test test/unit/agent/render-tools.test.ts`
Expected: PASS (26 tests).
Run: `yarn test test/unit/agent/render-tools.node.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
yarn eslint src/agent/render-tools.ts src/agent/result-schemas.ts test/unit/agent/render-tools.test.ts test/unit/agent/render-tools.node.test.ts
git add src/agent/render-tools.ts src/agent/result-schemas.ts test/unit/agent/render-tools.test.ts test/unit/agent/render-tools.node.test.ts
git diff --cached --name-only
git commit -m "feat(agent): MCP format with handle and error branches for 04" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Public tool types match the renderer (spec test 28)

**Files:**
- Test: `test/unit/agent/render-tools-public-types.test.ts`

**Interfaces:**
- Consumes: `RenderedTool` (Task 2), `AgentAnthropicTool`, `AgentOpenAITool` (Task 1).

- [ ] **Step 1: Write the test**

```ts
/**
 * The public tool types are the anthropic and openai branches of the internal
 * RenderedTool (06 R2-03-8). tsc checks the type assertions. The runtime half
 * checks a real rendered tool has exactly the public keys.
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { renderAgentTools, type RenderedTool } from '../../../src/agent/render-tools';
import type { AgentAnthropicTool, AgentOpenAITool } from '../../../types';
import { makeContract } from './fixtures/contract';

type AnthropicBranch = Extract<RenderedTool, { input_schema: object }>;
type OpenAIBranch = Extract<RenderedTool, { type: 'function' }>;

describe('public tool types — test 28', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AgentAnthropicTool equals the anthropic branch', () => {
    expectTypeOf<AgentAnthropicTool>().toEqualTypeOf<AnthropicBranch>();
  });

  it('AgentOpenAITool equals the openai branch', () => {
    expectTypeOf<AgentOpenAITool>().toEqualTypeOf<OpenAIBranch>();
  });

  it('rendered tools carry no key the public types lack', () => {
    const anthropicKeys = new Set(['name', 'description', 'input_schema', 'strict']);
    const openaiKeys = new Set(['type', 'name', 'description', 'parameters', 'strict']);

    renderAgentTools(makeContract(), { format: 'anthropic', strict: true })
      .forEach((tool) => Object.keys(tool).forEach((key) => expect(anthropicKeys.has(key)).toBe(true)));
    renderAgentTools(makeContract(), { format: 'openai', strict: true })
      .forEach((tool) => Object.keys(tool).forEach((key) => expect(openaiKeys.has(key)).toBe(true)));
  });
});
```

- [ ] **Step 2: Prove the type half can fail**

Temporarily change `strict?: boolean` to `strict?: true` in `AgentAnthropicTool` (`types/api/agent.d.ts`).
Run: `NODE_OPTIONS=--max-old-space-size=8192 yarn tsc --noEmit 2>&1 | grep render-tools-public-types`
Expected: an error on the `toEqualTypeOf<AnthropicBranch>` line. Revert the change.

- [ ] **Step 3: Run the test**

Run: `yarn test test/unit/agent/render-tools-public-types.test.ts`
Expected: PASS (3 tests). Run `NODE_OPTIONS=--max-old-space-size=8192 yarn tsc --noEmit 2>&1 | grep -c render-tools-public-types` and expect `0`.

- [ ] **Step 4: Commit**

```bash
yarn eslint test/unit/agent/render-tools-public-types.test.ts
git add test/unit/agent/render-tools-public-types.test.ts
git diff --cached --name-only
git commit -m "test(agent): public tool types match the renderer branches" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Checkpoint 1

- [ ] `yarn test test/unit/agent/render-tools.test.ts`, then `yarn test test/unit/agent/render-tools.node.test.ts`, then `yarn test test/unit/agent/render-tools-public-types.test.ts`, then `yarn test test/unit/architecture/agent-public-types.test.ts`, then `yarn test test/unit/architecture/published-types-no-src-refs.test.ts`. All PASS.
- [ ] `NODE_OPTIONS=--max-old-space-size=8192 yarn tsc --noEmit`: no new errors in `src/agent/`, `types/api/agent.d.ts` or `test/unit/agent/`.
- [ ] `git pull --rebase && git push`, then `git status` says "up to date with 'origin/main'".
- [ ] Tell plan 04's executor: `renderAgentTools` is on `main`, with MCP output schemas and `handle`.


# Phase 2 — `editor.agent`, turns, attribution, undo

### Task 7: Turn dispatch (`createAgentTurn`)

**Files:**
- Create: `src/components/modules/api/agent-turn.ts`
- Test: `test/unit/components/modules/api/agent-turn.test.ts`

**Interfaces:**
- Consumes: `AgentSession`, `AgentBatch`, `AgentResult`, `AgentError`, `ViewArgs`, `DocumentView` from `types/agent.d.ts`; `AgentTurn`, `AgentToolResult` from `types/api`.
- Produces:
  ```ts
  export const AGENT_TOOL_NAMES: readonly ['blok_read', 'blok_describe', 'blok_execute'];
  export interface AgentTurnHooks {
    /** A successful execute that resolved while the turn was still open. */
    onExecuted(result: Extract<AgentResult, { ok: true }>): void;
    /** Runs once, on end()/close() or stop(). */
    onClosed(reason: 'end' | 'stop'): void;
    /** True after editor.destroy(): call() then throws (a host bug). */
    isEditorDestroyed(): boolean;
  }
  export const cancelledError: () => AgentError;
  export function createAgentTurn(session: AgentSession, hooks: AgentTurnHooks): AgentTurn;
  ```
- This task covers spec tests 1 (dispatch half), 23 (turn half: the signal reaches every execute), 24, and Review Focus 5.

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentTurn, type AgentTurnHooks } from '../../../../../src/components/modules/api/agent-turn';
import type { AgentResult, AgentSession, DocumentView } from '../../../../../types/agent';

type OkResult = Extract<AgentResult, { ok: true }>;

const ok = (): OkResult => ({
  ok: true, revision: 'r1', results: [], refs: {},
  changed: { created: ['b1'], updated: [], moved: [], removed: [] }, warnings: [],
});

/** Content is irrelevant to these tests; 01 owns DocumentView. */
const VIEW = {} as DocumentView;

const makeSession = () => ({
  id: 'turn-1',
  actor: { id: 'bot', name: 'Bot', kind: 'agent' as const },
  read: vi.fn<AgentSession['read']>().mockResolvedValue(VIEW),
  describe: vi.fn<AgentSession['describe']>().mockReturnValue({ index: { tools: [], commands: [], guidance: '' } }),
  execute: vi.fn<AgentSession['execute']>().mockResolvedValue(ok()),
  log: vi.fn<AgentSession['log']>().mockReturnValue([]),
  close: vi.fn<AgentSession['close']>(),
}) satisfies AgentSession;

const makeHooks = () => ({
  onExecuted: vi.fn<AgentTurnHooks['onExecuted']>(),
  onClosed: vi.fn<AgentTurnHooks['onClosed']>(),
  isEditorDestroyed: vi.fn<AgentTurnHooks['isEditorDestroyed']>(() => false),
});

const BATCH = { commands: [{ name: 'block.insert', args: { type: 'paragraph' } }] };

const errorOf = (content: string): { code: string; details?: Record<string, unknown> } =>
  (JSON.parse(content) as { error: { code: string; details?: Record<string, unknown> } }).error;

describe('createAgentTurn — dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blok_execute runs the batch with the turn signal and reports it', async () => {
    const session = makeSession();
    const hooks = makeHooks();
    const turn = createAgentTurn(session, hooks);

    const result = await turn.call('blok_execute', BATCH);

    expect(session.execute).toHaveBeenCalledWith(BATCH, { signal: turn.signal });
    expect(result).toEqual({ content: JSON.stringify(ok()), isError: false });
    expect(hooks.onExecuted).toHaveBeenCalledWith(ok());
  });

  it('a failed batch is isError: true and is not drawn', async () => {
    const session = makeSession();
    const hooks = makeHooks();

    session.execute.mockResolvedValue({ ok: false, error: { code: 'STALE', message: 're-read', retryable: true }, warnings: [] });

    const result = await createAgentTurn(session, hooks).call('blok_execute', BATCH);

    expect(result.isError).toBe(true);
    expect(errorOf(result.content).code).toBe('STALE');
    expect(hooks.onExecuted).not.toHaveBeenCalled();
  });

  it('accepts OpenAI-style JSON string arguments', async () => {
    const session = makeSession();

    await createAgentTurn(session, makeHooks()).call('blok_execute', JSON.stringify(BATCH));

    expect(session.execute).toHaveBeenCalledWith(BATCH, expect.anything());
  });

  it.each([
    ['a string that is not JSON', '{commands'],
    ['an array', [BATCH]],
    ['a number', 7],
  ])('returns INVALID_ARGS for %s and runs nothing', async (_label, input) => {
    const session = makeSession();
    const result = await createAgentTurn(session, makeHooks()).call('blok_execute', input);

    expect(result.isError).toBe(true);
    expect(errorOf(result.content).code).toBe('INVALID_ARGS');
    expect(session.execute).not.toHaveBeenCalled();
  });

  it('INVALID_ARGS when commands is not an array', async () => {
    const result = await createAgentTurn(makeSession(), makeHooks()).call('blok_execute', { commands: 'block.insert' });

    expect(errorOf(result.content).code).toBe('INVALID_ARGS');
  });

  it('an unknown tool name is UNKNOWN_COMMAND listing the three tools', async () => {
    const result = await createAgentTurn(makeSession(), makeHooks()).call('table.insertRows', {});

    expect(result.isError).toBe(true);
    expect(errorOf(result.content)).toMatchObject({
      code: 'UNKNOWN_COMMAND',
      details: { valid: ['blok_read', 'blok_describe', 'blok_execute'] },
    });
  });

  it('blok_read with no input reads with {}', async () => {
    const session = makeSession();
    const result = await createAgentTurn(session, makeHooks()).call('blok_read', undefined);

    expect(session.read).toHaveBeenCalledWith({});
    expect(result).toEqual({ content: JSON.stringify(VIEW), isError: false });
  });

  it('blok_describe passes { tool, command } and rejects non-strings', async () => {
    const session = makeSession();
    const turn = createAgentTurn(session, makeHooks());

    await turn.call('blok_describe', { tool: 'table' });
    expect(session.describe).toHaveBeenCalledWith({ tool: 'table' });

    const bad = await turn.call('blok_describe', { tool: 5 });

    expect(errorOf(bad.content).code).toBe('INVALID_ARGS');
  });

  it('after stop(): CANCELLED, nothing runs, the signal is aborted, onClosed once', async () => {
    const session = makeSession();
    const hooks = makeHooks();
    const turn = createAgentTurn(session, hooks);

    turn.stop();
    turn.stop();

    const result = await turn.call('blok_execute', BATCH);

    expect(errorOf(result.content).code).toBe('CANCELLED');
    expect(session.execute).not.toHaveBeenCalled();
    expect(turn.signal.aborted).toBe(true);
    expect(hooks.onClosed).toHaveBeenCalledTimes(1);
    expect(hooks.onClosed).toHaveBeenCalledWith('stop');
  });

  it('end() does not abort; later calls are CANCELLED (test 24: close() is end())', async () => {
    const hooks = makeHooks();
    const turn = createAgentTurn(makeSession(), hooks);

    turn.close();

    expect(turn.signal.aborted).toBe(false);
    expect(hooks.onClosed).toHaveBeenCalledWith('end');
    expect(errorOf((await turn.call('blok_read', {})).content).code).toBe('CANCELLED');
  });

  it('closes the session once the queue drains', async () => {
    const session = makeSession();
    const turn = createAgentTurn(session, makeHooks());

    turn.end();
    await Promise.resolve();
    await Promise.resolve();

    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it('call() after the editor is destroyed throws (host bug)', async () => {
    const hooks = makeHooks();

    hooks.isEditorDestroyed.mockReturnValue(true);

    await expect(createAgentTurn(makeSession(), hooks).call('blok_read', {})).rejects.toThrow(/destroyed/);
  });

  it('a direct turn.execute also carries the turn signal (test 23)', async () => {
    const session = makeSession();
    const turn = createAgentTurn(session, makeHooks());

    await turn.execute(BATCH);

    expect(session.execute).toHaveBeenCalledWith(BATCH, { signal: turn.signal });
  });

  it('id, actor and log come from the session', () => {
    const session = makeSession();
    const turn = createAgentTurn(session, makeHooks());

    expect(turn.id).toBe('turn-1');
    expect(turn.actor).toEqual({ id: 'bot', name: 'Bot', kind: 'agent' });
    expect(turn.log()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/api/agent-turn.test.ts`
Expected: FAIL with "Failed to resolve import .../agent-turn".

- [ ] **Step 3: Implement**

`src/components/modules/api/agent-turn.ts`:
```ts
import type { AgentBatch, AgentError, AgentResult, AgentSession, DocumentView, ViewArgs } from '../../../../types/agent';
import type { AgentToolResult, AgentTurn } from '../../../../types/api';

export const AGENT_TOOL_NAMES = ['blok_read', 'blok_describe', 'blok_execute'] as const;

const TOOL_NAMES = new Set<string>(AGENT_TOOL_NAMES);

export interface AgentTurnHooks {
  onExecuted(result: Extract<AgentResult, { ok: true }>): void;
  onClosed(reason: 'end' | 'stop'): void;
  isEditorDestroyed(): boolean;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: AgentError };

const invalid = (message: string, path?: string): Parsed<never> => ({
  ok: false,
  error: { code: 'INVALID_ARGS', message, retryable: true, ...(path === undefined ? {} : { path }) },
});

export const cancelledError = (): AgentError => ({
  code: 'CANCELLED',
  message: 'This turn was stopped or ended. Nothing was applied.',
  retryable: false,
});

const asToolError = (error: AgentError): AgentToolResult => ({
  content: JSON.stringify({ ok: false, error, warnings: [] }),
  isError: true,
});

const UNPARSABLE = Symbol('unparsable');

const parseJson = (text: string): unknown => {
  if (text.trim() === '') {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return UNPARSABLE;
  }
};

/** OpenAI sends arguments as a JSON string, Anthropic as an object. */
const parseInput = (input: unknown): Parsed<Record<string, unknown>> => {
  const raw = typeof input === 'string' ? parseJson(input) : input ?? {};

  if (raw === UNPARSABLE) {
    return invalid('The tool input is a string that is not valid JSON. Send a JSON object.');
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return invalid('The tool input must be a JSON object.');
  }

  return { ok: true, value: raw as Record<string, unknown> };
};

const toQuery = (value: Record<string, unknown>): Parsed<{ tool?: string; command?: string }> => {
  const { tool, command } = value;

  if (tool !== undefined && typeof tool !== 'string') {
    return invalid('`tool` must be a string.', '/tool');
  }

  if (command !== undefined && typeof command !== 'string') {
    return invalid('`command` must be a string.', '/command');
  }

  return { ok: true, value: { ...(tool === undefined ? {} : { tool }), ...(command === undefined ? {} : { command }) } };
};

/** Only the envelope is checked here. 01's executor validates every command. */
const toBatch = (value: Record<string, unknown>): Parsed<AgentBatch> => {
  if (!Array.isArray(value.commands)) {
    return invalid('`commands` must be an array of { name, args }.', '/commands');
  }

  if (value.expectRevision !== undefined && typeof value.expectRevision !== 'string') {
    return invalid('`expectRevision` must be a string.', '/expectRevision');
  }

  return {
    ok: true,
    value: {
      commands: value.commands as AgentBatch['commands'],
      ...(typeof value.expectRevision === 'string' ? { expectRevision: value.expectRevision } : {}),
    },
  };
};

/** Unverified: whether 01's read() reports failures by throwing an AgentError-shaped value. */
const isAgentErrorLike = (value: unknown): value is AgentError =>
  typeof value === 'object' && value !== null
  && typeof (value as Record<string, unknown>).code === 'string'
  && typeof (value as Record<string, unknown>).message === 'string';

/**
 * One turn: an AgentSession with a signal, a call queue, and end/stop.
 * @param session - 01's editor session, bound to the turn's actor
 * @param hooks - what the AgentAPI module does on success and on close
 */
export function createAgentTurn(session: AgentSession, hooks: AgentTurnHooks): AgentTurn {
  const controller = new AbortController();
  const state = { closed: false };
  const queue = { tail: Promise.resolve() as Promise<unknown> };

  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const run = queue.tail.then(job);

    queue.tail = run.catch(() => undefined);

    return run;
  };

  const execute = (batch: AgentBatch): Promise<AgentResult> => enqueue(async (): Promise<AgentResult> => {
    if (state.closed) {
      return { ok: false, error: cancelledError(), warnings: [] };
    }

    const result = await session.execute(batch, { signal: controller.signal });

    // Checked AFTER the await: a turn closed while this batch was in flight
    // must not draw a caret or publish a cursor for it.
    if (result.ok && !state.closed) {
      hooks.onExecuted(result);
    }

    return result;
  });

  const readTool = (args: Record<string, unknown>): Promise<AgentToolResult> => enqueue(async () => {
    if (state.closed) {
      return asToolError(cancelledError());
    }

    try {
      return { content: JSON.stringify(await session.read(args as ViewArgs)), isError: false };
    } catch (thrown) {
      if (isAgentErrorLike(thrown)) {
        return asToolError(thrown);
      }

      throw thrown;
    }
  });

  const close = (reason: 'end' | 'stop'): void => {
    if (state.closed) {
      return;
    }

    state.closed = true;

    if (reason === 'stop') {
      controller.abort();
    }

    hooks.onClosed(reason);
    void queue.tail.then(() => session.close());
  };

  const call = async (name: string, input: unknown): Promise<AgentToolResult> => {
    if (hooks.isEditorDestroyed()) {
      throw new Error('editor.agent: the editor was destroyed. Open a new turn on a live editor.');
    }

    if (state.closed) {
      return asToolError(cancelledError());
    }

    if (!TOOL_NAMES.has(name)) {
      return asToolError({
        code: 'UNKNOWN_COMMAND',
        message: `There is no tool "${name}". The tools are blok_read, blok_describe and blok_execute.`,
        retryable: false,
        details: { valid: [...AGENT_TOOL_NAMES] },
      });
    }

    const parsed = parseInput(input);

    if (!parsed.ok) {
      return asToolError(parsed.error);
    }

    if (name === 'blok_read') {
      return readTool(parsed.value);
    }

    if (name === 'blok_describe') {
      const query = toQuery(parsed.value);

      return query.ok
        ? { content: JSON.stringify(session.describe(query.value)), isError: false }
        : asToolError(query.error);
    }

    const batch = toBatch(parsed.value);

    if (!batch.ok) {
      return asToolError(batch.error);
    }

    const result = await execute(batch.value);

    return { content: JSON.stringify(result), isError: !result.ok };
  };

  return {
    get id(): string {
      return session.id;
    },
    get actor() {
      return session.actor;
    },
    signal: controller.signal,
    read: (args?: ViewArgs): Promise<DocumentView> => enqueue(() => session.read(args)),
    describe: (query) => session.describe(query),
    // The host's own options are ignored on purpose: every execute on a turn carries the turn signal.
    execute: (batch: AgentBatch) => execute(batch),
    log: () => session.log(),
    close: () => close('end'),
    call,
    end: () => close('end'),
    stop: () => close('stop'),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/modules/api/agent-turn.test.ts`
Expected: PASS (17 tests).

- [ ] **Step 5: Lint and commit**

```bash
yarn eslint src/components/modules/api/agent-turn.ts test/unit/components/modules/api/agent-turn.test.ts
git add src/components/modules/api/agent-turn.ts test/unit/components/modules/api/agent-turn.test.ts
git diff --cached --name-only
git commit -m "feat(agent): turn dispatch for blok_read, blok_describe, blok_execute" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Turn queue and stop semantics

**Files:**
- Modify: `src/components/modules/api/agent-turn.ts` (only if a test below fails)
- Test: `test/unit/components/modules/api/agent-turn.test.ts` (append)

**Interfaces:**
- Consumes: `createAgentTurn` (Task 7).
- Pins Review Focus 1 (turn half) and 4.

- [ ] **Step 1: Write the tests**

Append:
```ts
const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } => {
  const box = {} as { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };

  box.promise = new Promise<T>((resolve, reject) => {
    box.resolve = resolve;
    box.reject = reject;
  });

  return box;
};

describe('createAgentTurn — queue and stop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parallel calls run one at a time, in call order', async () => {
    const session = makeSession();
    const first = deferred<AgentResult>();
    const order: string[] = [];

    session.execute
      .mockImplementationOnce(async () => {
        order.push('first:start');
        const result = await first.promise;

        order.push('first:end');

        return result;
      })
      .mockImplementationOnce(async () => {
        order.push('second:start');

        return ok();
      });

    const turn = createAgentTurn(session, makeHooks());
    const calls = Promise.all([turn.call('blok_execute', BATCH), turn.call('blok_execute', BATCH)]);

    await Promise.resolve();
    expect(order).toEqual(['first:start']);

    first.resolve(ok());
    await calls;
    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('a rejected execute does not poison the queue', async () => {
    const session = makeSession();

    session.execute.mockRejectedValueOnce(new Error('session bug')).mockResolvedValueOnce(ok());

    const turn = createAgentTurn(session, makeHooks());
    const [failed, next] = await Promise.allSettled([turn.call('blok_execute', BATCH), turn.call('blok_execute', BATCH)]);

    expect(failed.status).toBe('rejected');
    expect(next).toMatchObject({ status: 'fulfilled', value: { isError: false } });
  });

  it('stop() with calls queued: each queued call is CANCELLED and none runs', async () => {
    const session = makeSession();
    const first = deferred<AgentResult>();

    session.execute.mockReturnValueOnce(first.promise);

    const turn = createAgentTurn(session, makeHooks());
    const running = turn.call('blok_execute', BATCH);
    const queued = [turn.call('blok_execute', BATCH), turn.call('blok_read', {})];

    await Promise.resolve();
    turn.stop();
    first.resolve(ok());

    await running;
    const results = await Promise.all(queued);

    expect(session.execute).toHaveBeenCalledTimes(1);
    expect(session.read).not.toHaveBeenCalled();
    results.forEach((result) => expect(errorOf(result.content).code).toBe('CANCELLED'));
  });

  it('a batch that resolves after end() is returned but never drawn (Review Focus 1)', async () => {
    const session = makeSession();
    const hooks = makeHooks();
    const first = deferred<AgentResult>();

    session.execute.mockReturnValueOnce(first.promise);

    const turn = createAgentTurn(session, hooks);
    const running = turn.call('blok_execute', BATCH);

    await Promise.resolve();
    turn.end();
    first.resolve(ok());

    expect((await running).isError).toBe(false);
    expect(hooks.onExecuted).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `yarn test test/unit/components/modules/api/agent-turn.test.ts`
Expected: PASS (21 tests), because Task 7's queue already implements this. If any test fails, fix `agent-turn.ts` until it passes. Then prove the stop test bites: temporarily delete the `if (state.closed)` early return inside `execute`, run again, and see "stop() with calls queued" FAIL. Restore the line.

- [ ] **Step 3: Lint and commit**

```bash
yarn eslint test/unit/components/modules/api/agent-turn.test.ts src/components/modules/api/agent-turn.ts
git add test/unit/components/modules/api/agent-turn.test.ts src/components/modules/api/agent-turn.ts
git diff --cached --name-only
git commit -m "test(agent): turn queue order, rejection isolation, stop with queued calls" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
(Stage `agent-turn.ts` only if Step 2 changed it.)

---

### Task 9: The `AgentAPI` module and the `editor.agent` namespace

**Files:**
- Create: `src/components/modules/api/agent.ts`, `src/agent/guidance.ts`
- Modify:
  - `src/components/modules/index.ts:1-25` (import), `:58-82` (`Modules`, API group)
  - `src/types-internal/blok-modules.d.ts:1-24` (import), `:58-83` (interface)
  - `src/components/modules/api/index.ts:42-65` (`methods`)
  - `types/index.d.ts:18-50` (import `Agent`), `:237-271` (`interface API`)
  - `test/unit/components/modules/api/api-methods.test.ts:45-72` (`createBlokStub`)
- Test: `test/unit/components/modules/api/agent.test.ts`

**Interfaces:**
- Consumes (01, gated in Step 1): `createEditorAgentSession(editor: InternalEditorHandle, actor: AgentActor, options?: { contractSource?: ContractSource; mergeSteps?: 'batch' | 'turn'; attributeLastEditedBy?: boolean; services?: Partial<Record<HostService, unknown>> }): AgentSession`, `liveContractSource(Blok: BlokModules, options?: { services?: HostService[]; overrides?: ManifestOverrides }): ContractSource`, `interface ContractSource { contract(): AgentContract; runtimes(contract): ToolRuntimeRegistry }`, `type InternalEditorHandle = BlokModules`, all from `src/components/modules/agent/editor-session.ts` (01 Tasks 28, 28a, 29).
- Consumes: `createAgentTurn` (Task 7), `renderAgentTools` (Tasks 2–5).
- Produces:
  ```ts
  export class AgentTurnOpenError extends Error {}   // name 'AgentTurnOpenError'
  export class AgentAPI extends Module {
    get methods(): Agent;
    destroy(): void;
    /** For the collaboration renderer and agent presence (Task 16). */
    inputIndexFor(blockId: string, field: string): number | null;   // added in Task 16
  }
  // src/agent/guidance.ts
  export function composeGuidance(contract: AgentContract): string;
  ```
  `API.agent: Agent`. Through `interface Blok extends Omit<API, 'i18n'>`, it reaches every adapter's instance type.

- [ ] **Step 1: Gate on 01's editor session module**

Run:
```bash
cd /Users/jackuait/Packages/blok
grep -n "export" src/components/modules/agent/editor-session.ts | grep -E "createEditorAgentSession|liveContractSource|ContractSource|InternalEditorHandle"
grep -rn "attributeLastEditedBy\|mergeSteps" src/components/modules/agent/editor-session.ts | head -3
```
Expected: four export lines and hits for both options. If anything is missing, STOP: 01 Tasks 28, 28a or 29 have not landed.

- [ ] **Step 2: Write the failing tests**

`test/unit/components/modules/api/agent.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { API } from '../../../../../src/components/modules/api';
import { AgentAPI } from '../../../../../src/components/modules/api/agent';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { AgentSession } from '../../../../../types/agent';
import type { BlokConfig } from '../../../../../types';
import { makeContract } from '../../../agent/fixtures/contract';

const agentModule = vi.hoisted(() => ({
  createEditorAgentSession: vi.fn(),
  liveContractSource: vi.fn(),
}));

vi.mock('../../../../../src/components/modules/agent/editor-session', () => agentModule);

const sourceOf = (contract: unknown) => ({ contract: () => contract, runtimes: () => new Map() });

const fakeSession = (id = 'turn-1'): AgentSession => ({
  id,
  actor: { id: 'bot', name: 'Bot', kind: 'agent' },
  read: vi.fn(),
  describe: vi.fn(),
  execute: vi.fn(),
  log: vi.fn(() => []),
  close: vi.fn(),
});

/** Only what AgentAPI reaches. Later tasks add to it. */
const stubModules = (): BlokModules => ({
  BlockManager: { getBlockById: () => undefined },
  UI: { nodes: { wrapper: document.createElement('div') } },
  ReadOnly: { isControlsHidden: false },
  YjsManager: { setAwarenessField: vi.fn() },
  I18n: { t: (key: string) => key },
}) as unknown as BlokModules;

const createAgentApi = (config: BlokConfig = {}): AgentAPI => {
  const api = new AgentAPI({ config, eventsDispatcher: new EventsDispatcher<BlokEventMap>() });

  api.state = stubModules();

  return api;
};

describe('AgentAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentModule.createEditorAgentSession.mockImplementation(() => fakeSession());
    agentModule.liveContractSource.mockReturnValue(sourceOf(makeContract()));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('API.methods exposes the agent namespace', () => {
    const sentinel = { begin: vi.fn() };
    const api = new API({ config: {}, eventsDispatcher: new EventsDispatcher<BlokEventMap>() });

    api.state = new Proxy({}, {
      get: (_target, key) => (key === 'AgentAPI' ? { methods: sentinel } : { methods: {}, classes: {} }),
    }) as unknown as BlokModules;

    expect(api.methods.agent).toBe(sentinel);
  });

  it('state starts idle and is the same object until it changes', () => {
    const agent = createAgentApi().methods;

    expect(agent.state).toEqual({ status: 'idle' });
    expect(agent.state).toBe(agent.state);
  });

  it('begin opens a working turn, notifies, and binds the actor', () => {
    const api = createAgentApi();
    const agent = api.methods;
    const listener = vi.fn();

    agent.subscribe(listener);

    const turn = agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    expect(agent.state).toEqual({ status: 'working', turn: { id: 'turn-1', agent: { id: 'bot', name: 'Bot' } } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(agentModule.createEditorAgentSession).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'bot', name: 'Bot', kind: 'agent' },
      expect.objectContaining({ attributeLastEditedBy: true, mergeSteps: 'turn', contractSource: agentModule.liveContractSource.mock.results[0]?.value as unknown })
    );
    expect(turn.id).toBe('turn-1');
  });

  it('attributeTo: user turns off lastEditedBy stamping', () => {
    createAgentApi().methods.begin({ agent: { id: 'bot', name: 'Bot' }, attributeTo: 'user' });

    expect(agentModule.createEditorAgentSession).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ attributeLastEditedBy: false }));
  });

  it('begin while a turn is open throws AgentTurnOpenError', () => {
    const agent = createAgentApi().methods;

    agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    expect(() => agent.begin({ agent: { id: 'bot', name: 'Bot' } })).toThrow(expect.objectContaining({ name: 'AgentTurnOpenError' }) as Error);
  });

  it('begin with an empty id or name throws TypeError', () => {
    expect(() => createAgentApi().methods.begin({ agent: { id: '', name: 'Bot' } })).toThrow(TypeError);
    expect(() => createAgentApi().methods.begin({ agent: { id: 'bot', name: '   ' } })).toThrow(TypeError);
  });

  it('end and stop return to idle; a new turn can then begin', () => {
    const agent = createAgentApi().methods;
    const listener = vi.fn();
    const unsubscribe = agent.subscribe(listener);

    agent.begin({ agent: { id: 'bot', name: 'Bot' } }).end();
    expect(agent.state).toEqual({ status: 'idle' });

    agentModule.createEditorAgentSession.mockImplementation(() => fakeSession('turn-2'));
    agent.begin({ agent: { id: 'bot', name: 'Bot' } }).stop();
    expect(agent.state).toEqual({ status: 'idle' });
    expect(listener).toHaveBeenCalledTimes(4);

    unsubscribe();
    agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('tools() renders the editor contract in the asked format', async () => {
    const tools = await createAgentApi().methods.tools({ format: 'anthropic' });

    expect(tools.map((tool) => tool.name)).toEqual(['blok_read', 'blok_describe', 'blok_execute']);
    expect(agentModule.liveContractSource).toHaveBeenCalledTimes(1);
  });

  it('guidance() joins the contract guidance with the in-app rules', async () => {
    const text = await createAgentApi().methods.guidance();

    expect(text.startsWith('General guidance.')).toBe(true);
    expect(text).toContain('blok_read');
  });

  it('destroy() stops the open turn', () => {
    const api = createAgentApi();
    const turn = api.methods.begin({ agent: { id: 'bot', name: 'Bot' } });

    api.destroy();

    expect(turn.signal.aborted).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/api/agent.test.ts`
Expected: FAIL with "Failed to resolve import .../api/agent".

- [ ] **Step 4: Implement the module and the guidance**

`src/agent/guidance.ts`:
```ts
import type { AgentContract } from '../../types/tool-manifest';

/** Rules that hold only in the browser editor, where a person edits beside the agent. */
const IN_APP_RULES = [
  'You are editing the document the user has open. They may be typing in it at the same time.',
  '',
  '- Call blok_read before you edit. Address blocks by the ids it returns.',
  '- Rich text is segments, not Markdown and not HTML. To add Markdown, use the markdown.insert command.',
  '- Call blok_describe with { command } before using a command for the first time.',
  '- On a STALE error, call blok_read again and retry with fresh ids and text.',
  '- Put related edits in one blok_execute call. The user can undo your work with Cmd+Z.',
  '- You cannot move the user\'s caret, selection or scroll.',
].join('\n');

/**
 * The system-prompt text editor.agent.guidance() returns.
 * @param contract - the editor's contract
 */
export function composeGuidance(contract: AgentContract): string {
  return `${contract.guidance.general.trim()}\n\n${IN_APP_RULES}`;
}
```

`src/components/modules/api/agent.ts`:
```ts
import type { AgentContract } from '../../../../types/tool-manifest';
import type {
  Agent,
  AgentAnthropicTool,
  AgentIdentity,
  AgentOpenAITool,
  AgentState,
  AgentToolsOptions,
  AgentTurn,
  AgentTurnOptions,
} from '../../../../types/api';
import { Module } from '../../__module';
import { createEditorAgentSession, liveContractSource, type ContractSource } from '../agent/editor-session';

import { createAgentTurn } from './agent-turn';

export class AgentTurnOpenError extends Error {
  public constructor() {
    super('An agent turn is already open. Call end() or stop() on it before begin().');
    this.name = 'AgentTurnOpenError';
  }
}

const IDLE: AgentState = { status: 'idle' };

const readIdentity = (agent: AgentIdentity | undefined): AgentIdentity => {
  if (typeof agent?.id !== 'string' || agent.id === '' || typeof agent.name !== 'string' || agent.name.trim() === '') {
    throw new TypeError('editor.agent.begin() needs agent.id and agent.name as non-empty strings.');
  }

  return { ...agent };
};

/**
 * editor.agent: turns, tool definitions, guidance and state.
 * Blok never calls a model. The host runs the loop and forwards each tool call.
 */
export class AgentAPI extends Module {
  private readonly current = { state: IDLE as AgentState, turn: null as AgentTurn | null };

  private readonly listeners = new Set<() => void>();

  public get methods(): Agent {
    const readState = (): AgentState => this.current.state;

    return {
      tools: ((options: AgentToolsOptions) => this.tools(options)) as Agent['tools'],
      guidance: () => this.guidance(),
      begin: (options: AgentTurnOptions) => this.begin(options),
      get state(): AgentState {
        return readState();
      },
      subscribe: (listener: () => void) => this.subscribe(listener),
    };
  }

  public destroy(): void {
    this.current.turn?.stop();
    this.listeners.clear();
  }

  private readonly sourceCache = { source: null as ContractSource | null };

  // One source, so the rendered enum and every session's executor agree (Task 11).
  // Task 9a adds the service objects; Task 10 adds config.agent.overrides.
  private source(): ContractSource {
    this.sourceCache.source ??= liveContractSource(this.Blok);

    return this.sourceCache.source;
  }

  private contract(): AgentContract {
    return this.source().contract();
  }

  private async tools(options: AgentToolsOptions): Promise<AgentAnthropicTool[] | AgentOpenAITool[]> {
    const { renderAgentTools } = await import('../../../agent/render-tools');

    // The format narrows RenderedTool to exactly one public branch (pinned by test 28).
    return renderAgentTools(this.contract(), {
      format: options.format,
      schema: options.schema,
      strict: options.strict,
    }) as AgentAnthropicTool[] | AgentOpenAITool[];
  }

  private async guidance(): Promise<string> {
    const { composeGuidance } = await import('../../../agent/guidance');

    return composeGuidance(this.contract());
  }

  private begin(options: AgentTurnOptions): AgentTurn {
    if (this.current.turn !== null) {
      throw new AgentTurnOpenError();
    }

    const identity = readIdentity(options?.agent);
    const session = createEditorAgentSession(
      this.Blok,
      { ...identity, kind: 'agent' },
      {
        contractSource: this.source(),
        mergeSteps: 'turn',
        attributeLastEditedBy: options.attributeTo !== 'user',
      }
    );
    const turn = createAgentTurn(session, {
      onExecuted: () => undefined,
      onClosed: () => this.closeTurn(turn),
      isEditorDestroyed: () => this.isDestroyed,
    });

    this.current.turn = turn;
    this.setState({ status: 'working', turn: { id: turn.id, agent: identity } });

    return turn;
  }

  private closeTurn(turn: AgentTurn): void {
    if (this.current.turn !== turn) {
      return;
    }

    this.current.turn = null;
    this.setState(IDLE);
  }

  private subscribe(listener: () => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(next: AgentState): void {
    this.current.state = next;
    this.listeners.forEach((listener) => listener());
  }
}
```
Task 16 replaces `onExecuted: () => undefined` with the presence call. That is a real no-op until presence exists, not a stub of planned behaviour.

- [ ] **Step 5: Wire the namespace**

`src/components/modules/index.ts`: add `import { AgentAPI } from './api/agent';` with the other API imports. Add `AgentAPI,` as the first entry of the `// API Modules` group in `Modules`. It must come before `Collaboration` and `YjsManager`: teardown destroys modules in map order, and the turn's `agentCursor: null` must go out while awareness still exists.

`src/types-internal/blok-modules.d.ts`: add `import { AgentAPI } from '../components/modules/api/agent';` and `AgentAPI: AgentAPI,` in `BlokModules`.

`src/components/modules/api/index.ts`, inside the `methods` object after `viewState`:
```ts
      agent: this.Blok.AgentAPI.methods,
```

`types/index.d.ts`: add `Agent,` to the import list from `'./api'` (lines 18–50). Add to `interface API` after `viewState`:
```ts
  /** In-app agent turns, LLM tool definitions and agent state (see {@link Agent}). */
  agent: Agent;
```
Do NOT add it to `PendingBlok`. It is unreachable before `isReady`, like `blocks`.

`test/unit/components/modules/api/api-methods.test.ts`, in `createBlokStub`: add `AgentAPI: emptyMethods,`.

- [ ] **Step 6: Run the tests**

Run, one file per call:
- `yarn test test/unit/components/modules/api/agent.test.ts`: PASS (10 tests).
- `yarn test test/unit/components/modules/api/api-methods.test.ts`: PASS.
- `yarn test test/unit/architecture/blok-class-api-parity-law.test.ts`: PASS (spec test 10).
- `yarn test test/unit/components/modules/api/viewState.test.ts`: PASS. It boots a real editor, which now constructs `AgentAPI`.

- [ ] **Step 7: Lint and commit**

```bash
yarn eslint src/components/modules/api/agent.ts src/agent/guidance.ts src/components/modules/index.ts src/types-internal/blok-modules.d.ts src/components/modules/api/index.ts types/index.d.ts test/unit/components/modules/api/agent.test.ts test/unit/components/modules/api/api-methods.test.ts
git add src/components/modules/api/agent.ts src/agent/guidance.ts src/components/modules/index.ts src/types-internal/blok-modules.d.ts src/components/modules/api/index.ts types/index.d.ts test/unit/components/modules/api/agent.test.ts test/unit/components/modules/api/api-methods.test.ts
git diff --cached --name-only
git commit -m "feat(agent): editor.agent namespace with turns, tools() and guidance()" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
Tell the user now (D4, not breaking): "`editor.agent` is on the public `API` type. A consumer who hand-implements the full `API` interface, for example in a test mock, gets a TS error for the missing `agent` member, as with `media`, `viewState` and `marks`. Fix: add an `agent` member to the mock."

---

### Task 9a: Browser service objects for tool actions (`pageBackend`, `linkMetadata`, `uploader`)

02 declares actions whose `prepare` needs a host service (02 Tasks 44, 48, 49) and says the browser objects are this plan's (02 Task 44). 01 carries them into the planner (01 Task 28a: `services` option on `createEditorAgentSession`, and the same names make the actions `available`). Without this task `page.rename`, `page.setIcon` and `bookmark.create` are `COMMAND_UNAVAILABLE` in every editor, and `image.setSource` stores URLs without re-hosting.

**Files:**
- Create: `src/components/modules/api/agent-services.ts`
- Modify: `src/components/modules/api/agent.ts` (`services()`; pass them to `liveContractSource` and to every session)
- Test: `test/unit/components/modules/api/agent-services.test.ts`

**Interfaces:**
- Consumes: `PageBackendService`, `LinkMetadataService`, `UploaderService` (`src/shared/tool-actions/services.ts`, 02 Task 12); `MetadataFetcher` (`src/tools/link/metadata-fetcher.ts:44`, `fetch(url)`); `BlockToolAdapter.settings` (`src/components/tools/base.ts:301`); `Block.preservedData` (`src/components/block/index.ts:913`, synchronous); the page tool hooks `rename?(pageId, title)` / `setIcon?(pageId, icon)` (`types/tools/page.d.ts:109`, `:114`; called at `src/tools/page/index.ts:432-475`, `:489-521`); `BookmarkConfig.endpoint` (`types/tools/bookmark.d.ts:28`); `BlokConfig.uploader?.uploadByUrl` (`types/configs/blok-config.d.ts:759`, `types/configs/uploader.d.ts:74`).
- Produces: `createEditorServices(Blok: BlokModules, config: BlokConfig): Partial<Record<HostService, unknown>>`. A key is present only when the host configured it (06 R3-2):
  - `pageBackend` when some block tool's settings has a `rename` or `setIcon` function. `rename({ blockId, title })` reads the block (`BlockManager.getBlockById`), takes `preservedData.pageId`, calls that block's tool hook, and resolves `{ pageId, applied: true }`. A missing block, a non-string `pageId`, or a tool with no such hook rejects with a message naming the block.
  - `linkMetadata` when some block tool's settings has a non-empty string `endpoint` and that tool is the bookmark tool's class: `{ fetch: url => new MetadataFetcher(settings).fetch(url) }`.
  - `uploader` when `config.uploader?.uploadByUrl` is a function: `{ uploadByUrl: (url, ctx) => config.uploader.uploadByUrl(url, ctx) }`. Tool-level uploaders (`tools.image.config.uploader`) are not consulted in v1; **unverified** whether hosts rely on them more than on the editor-level one.
- `AgentAPI.services()` builds them once; `source()` becomes `liveContractSource(this.Blok, { services: Object.keys(this.services()) as HostService[] })`; `begin()` passes `services: this.services()`.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/components/modules/api/agent-services.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEditorServices } from '../../../../../src/components/modules/api/agent-services';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

const modules = (settings: Record<string, Record<string, unknown>>, blocks: Record<string, { name: string; preservedData: Record<string, unknown> }>): BlokModules => ({
  Tools: { blockTools: new Map(Object.entries(settings).map(([name, s]) => [name, { name, settings: s }])) },
  BlockManager: { getBlockById: (id: string) => blocks[id] },
}) as unknown as BlokModules;

describe('createEditorServices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers nothing the host did not configure', () => {
    expect(createEditorServices(modules({ paragraph: {} }, {}), {})).toEqual({});
  });

  it('pageBackend takes the block id and calls the page tool hook with the page id', async () => {
    const rename = vi.fn();
    const services = createEditorServices(modules({ page: { rename } }, { b1: { name: 'page', preservedData: { pageId: 'pg-1' } } }), {});
    const backend = services.pageBackend as { rename(input: { blockId: string; title: string }): Promise<unknown> };

    await expect(backend.rename({ blockId: 'b1', title: 'Roadmap' })).resolves.toEqual({ pageId: 'pg-1', applied: true });
    expect(rename).toHaveBeenCalledWith('pg-1', 'Roadmap');
    await expect(backend.rename({ blockId: 'missing', title: 'x' })).rejects.toThrow(/missing/);
  });

  it('uploader wraps the editor-level uploadByUrl', async () => {
    const uploadByUrl = vi.fn().mockResolvedValue({ url: 'https://cdn/x.png' });
    const services = createEditorServices(modules({}, {}), { uploader: { uploadByUrl } } as never);

    await expect((services.uploader as { uploadByUrl(u: string, c: unknown): Promise<unknown> }).uploadByUrl('https://a/x.png', { kind: 'image', tool: 'image' })).resolves.toEqual({ url: 'https://cdn/x.png' });
  });
});
```

Add a `linkMetadata` case once you have read how the bookmark tool's class is exported from `src/tools` (check `src/tools/index.ts`): register it under `bookmark` with `{ endpoint: 'https://unfurl' }`, stub `fetch`, and expect `linkMetadata.fetch(url)` to call `https://unfurl?url=<encoded>` (the URL `MetadataFetcher` builds, `metadata-fetcher.ts:51`).

Run: `yarn test test/unit/components/modules/api/agent-services.test.ts`
Expected: FAIL, cannot resolve `agent-services`.

- [ ] **Step 2: Write `agent-services.ts` and wire `AgentAPI`**

Implement the three rules under Interfaces. In `agent.ts`:

```ts
import type { HostService } from '../../../../types/tool-manifest';
import { createEditorServices } from './agent-services';

  private readonly serviceCache = { services: null as Partial<Record<HostService, unknown>> | null };

  private services(): Partial<Record<HostService, unknown>> {
    this.serviceCache.services ??= createEditorServices(this.Blok, this.config);

    return this.serviceCache.services;
  }
```

`source()` passes `{ services: Object.keys(this.services()) as HostService[] }`, and `begin()` adds `services: this.services()` to the session options. `createEditorServices` is real code and reads `Blok.Tools.blockTools`, so add `Tools: { blockTools: new Map() }` to `stubModules()` in `agent.test.ts` (Task 9's stub has no `Tools`; without it `begin()` and `tools()` throw). Update Task 9's `begin` test expectation to `expect.objectContaining({ ..., services: {} })`.

Run: `yarn test test/unit/components/modules/api/agent-services.test.ts` and `yarn test test/unit/components/modules/api/agent.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
npx eslint src/components/modules/api/agent-services.ts src/components/modules/api/agent.ts test/unit/components/modules/api/agent-services.test.ts test/unit/components/modules/api/agent.test.ts
git add src/components/modules/api/agent-services.ts src/components/modules/api/agent.ts test/unit/components/modules/api/agent-services.test.ts test/unit/components/modules/api/agent.test.ts
git commit -m "feat(agent): browser service objects for page, bookmark and upload actions" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 10: Real-editor integration: read-only, destroy, cancel, overrides

**Files:**
- Modify: `types/configs/blok-config.d.ts` (add `agent?` after `user?`, which ends near line 1332; add an import at the top), `src/components/modules/api/agent.ts` (`source()` passes the overrides)
- Test: `test/unit/components/modules/api/agent.integration.test.ts`

**Interfaces:**
- Consumes: `editor.agent` (Task 9); 01's executor (`READ_ONLY`, `CANCELLED`, `UNKNOWN_COMMAND` for hidden actions); 02's `table.insertRows` action; `ManifestOverrides` from `types/tool-manifest.d.ts`.
- Produces: `BlokConfig.agent?: { overrides?: ManifestOverrides }`. `AgentAPI.source()` passes `overrides: this.config.agent?.overrides` to 01's `liveContractSource` (01 Task 28), which hands them to `buildToolManifest`.
- Covers spec tests 1 (destroy half), 2, 20, and 23 (point one, against a real session).

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Table } from '../../../../../src/tools/table';
import type { API, BlokConfig, OutputData } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  agent: API['agent'];
  blocks: API['blocks'];
  history: API['history'];
}

const settle = (ms = 0): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const editors: TestEditor[] = [];

const createRealEditor = async (config: Partial<BlokConfig> = {}): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);

  const editor = new Blok({
    holder,
    tools: { paragraph: Paragraph },
    data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'First' } }] },
    ...config,
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;
  await settle();

  return editor;
};

const INSERT = { commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'From agent' }, position: 'end' } }] };

const errorCode = (content: string): string => (JSON.parse(content) as { error: { code: string } }).error.code;

describe('editor.agent on a real editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    editors.splice(0).forEach((editor) => editor.destroy());
    document.body.innerHTML = '';
  });

  it('a turn inserts a block', async () => {
    const editor = await createRealEditor();
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const result = await turn.call('blok_execute', INSERT);

    turn.end();
    await settle();

    expect(result.isError).toBe(false);
    expect((await editor.save()).blocks).toHaveLength(2);
  });

  it('test 2: read-only refuses blok_execute with READ_ONLY and still reads', async () => {
    const editor = await createRealEditor({ readOnly: true });
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    const write = await turn.call('blok_execute', INSERT);
    const read = await turn.call('blok_read', {});

    expect(write.isError).toBe(true);
    expect(errorCode(write.content)).toBe('READ_ONLY');
    expect(read.isError).toBe(false);
  });

  it('test 23 (point 1): stop before start writes nothing', async () => {
    const editor = await createRealEditor();
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    turn.stop();

    const result = await turn.execute(INSERT);

    expect(result).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect((await editor.save()).blocks).toHaveLength(1);
  });

  it('test 1: destroy() stops the open turn, and a later call throws', async () => {
    const editor = await createRealEditor();
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    editors.splice(editors.indexOf(editor), 1);
    editor.destroy();

    expect(turn.signal.aborted).toBe(true);
    await expect(turn.call('blok_read', {})).rejects.toThrow(/destroyed/);
  });

  it('test 20: an action hidden by overrides is absent from tools() and refused at execute', async () => {
    const visible = await createRealEditor({ tools: { paragraph: Paragraph, table: Table } });
    const visibleTools = await visible.agent.tools({ format: 'anthropic' });

    // Guard: without overrides the action IS listed, so the next assertions mean something.
    expect(JSON.stringify(visibleTools)).toContain('"table.insertRows"');

    const hidden = await createRealEditor({
      tools: { paragraph: Paragraph, table: Table },
      agent: { overrides: { table: { hiddenActions: ['insertRows'] } } },
    });
    const hiddenTools = await hidden.agent.tools({ format: 'anthropic' });
    const turn = hidden.agent.begin({ agent: { id: 'bot', name: 'Bot' } });
    const result = await turn.execute({ commands: [{ name: 'table.insertRows', args: { id: 'missing', at: 0 } }] });

    expect(JSON.stringify(hiddenTools)).not.toContain('"table.insertRows"');
    expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN_COMMAND' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/api/agent.integration.test.ts`
Expected: FAIL. `tsc` would reject `agent:` as an unknown config key, but vitest does not type-check. The real failure is test 20: overrides are ignored until `AgentAPI.source()` passes them to `liveContractSource`. Then confirm red with `NODE_OPTIONS=--max-old-space-size=8192 yarn tsc --noEmit 2>&1 | grep agent.integration` (expect an error on `agent:`).

- [ ] **Step 3: Add the config key**

At the top of `types/configs/blok-config.d.ts`, with the other type imports:
```ts
import type { ManifestOverrides } from '../tool-manifest';
```
After the `user?: { ... };` member:
```ts
  /**
   * Settings for the in-app agent surface, `editor.agent`.
   */
  agent?: {
    /**
     * Hide tools or tool actions from agents, or add guidance to one tool.
     * Keyed by the tool's registry key. A hidden action is missing from
     * `editor.agent.tools()`, and calling it returns `UNKNOWN_COMMAND`.
     */
    overrides?: ManifestOverrides;
  };
```

In `src/components/modules/api/agent.ts`, `source()` now passes the overrides:
```ts
    this.sourceCache.source ??= liveContractSource(this.Blok, {
      services: Object.keys(this.services()) as HostService[],
      overrides: this.config.agent?.overrides,
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test test/unit/components/modules/api/agent.integration.test.ts`
Expected: PASS (5 tests). A failure in test 2, 20 or 23 points at 01's executor or contract builder. Report it to plan 01. Do not patch around it in `agent.ts`. Do not commit a red test: hold this task until 01's fix lands, as in Task 13.

- [ ] **Step 5: Lint and commit**

```bash
yarn eslint types/configs/blok-config.d.ts src/components/modules/api/agent.ts test/unit/components/modules/api/agent.integration.test.ts
git add types/configs/blok-config.d.ts src/components/modules/api/agent.ts test/unit/components/modules/api/agent.integration.test.ts
git diff --cached --name-only
git commit -m "feat(agent): BlokConfig.agent.overrides; real-editor turn tests" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Agent tool definition law (spec test 11)

**Files:**
- Test: `test/unit/architecture/agent-tool-definition-law.test.ts`

**Interfaces:**
- Consumes: `editor.agent.tools()`, `turn.describe({ command })` on a real jsdom editor with `allTools` (`src/full.ts:108`).
- Assumption (inferred from `test/unit/full.test.ts` importing it): `src/full.ts` imports cleanly in the unit environment.

- [ ] **Step 1: Write the law test**

```ts
/**
 * Law: the tool definitions rendered from the LIVE contract of every built-in
 * tool satisfy the provider rules Blok can confirm (03 §2.9), and the enum the
 * model sees agrees with what the executor accepts. A new tool whose schema
 * breaks a rule fails here, not in a host's production traffic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { allTools } from '../../../src/full';
import { TOOL_NAME_PATTERN } from '../../../src/agent/render-tools';
import type { API, BlokConfig } from '../../../types';

type Schema = Record<string, unknown>;

interface TestEditor { isReady: Promise<unknown>; destroy: () => void; agent: API['agent'] }

const boot = async (): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);

  const editor = new Blok({ holder, tools: allTools as BlokConfig['tools'] }) as unknown as TestEditor;

  await editor.isReady;

  return editor;
};

const inputOf = (tool: Schema): Schema => (tool.input_schema ?? tool.parameters) as Schema;

describe('agent tool definition law', () => {
  const state = { editor: null as TestEditor | null };

  beforeEach(async () => {
    vi.clearAllMocks();
    state.editor = await boot();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    state.editor?.destroy();
    document.body.innerHTML = '';
  });

  it.each(['anthropic', 'openai'] as const)('%s envelope: names, root objects, no strict on blok_execute', async (format) => {
    const tools = await (state.editor as TestEditor).agent.tools({ format, strict: false }) as unknown as Schema[];

    expect(tools.map((tool) => tool.name)).toEqual(['blok_read', 'blok_describe', 'blok_execute']);
    tools.forEach((tool) => {
      const root = inputOf(tool);

      expect(String(tool.name)).toMatch(TOOL_NAME_PATTERN);
      expect(root.type).toBe('object');
      expect(root).not.toHaveProperty('anyOf');
      expect(root).not.toHaveProperty('oneOf');
    });
    expect(tools[2]).not.toHaveProperty('strict');
  });

  it.each(['anthropic', 'openai'] as const)('%s full: renders within limits or throws AgentToolsTooLargeError', async (format) => {
    const editor = state.editor as TestEditor;

    try {
      const tools = await editor.agent.tools({ format, schema: 'full', strict: true }) as unknown as Schema[];

      expect(tools[2]).not.toHaveProperty('strict');
    } catch (error) {
      expect(error).toMatchObject({ name: expect.stringMatching(/^AgentTools(TooLarge|Strict)Error$/) as unknown });
    }
  });

  it('every command the enum offers is described as available', async () => {
    const editor = state.editor as TestEditor;
    const tools = await editor.agent.tools({ format: 'anthropic' }) as unknown as Schema[];
    const items = ((inputOf(tools[2]).properties as Record<string, Schema>).commands.items as Schema);
    const names = ((items.properties as Record<string, Schema>).name.enum as string[]);
    const turn = editor.agent.begin({ agent: { id: 'law', name: 'Law' } });

    const unavailable = names.filter((name) => {
      const slice = turn.describe({ command: name }) as { command?: { available?: boolean } };

      return slice.command?.available !== true;
    });

    turn.end();
    expect(names.length).toBeGreaterThan(0);
    expect(unavailable).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `yarn test test/unit/architecture/agent-tool-definition-law.test.ts`
Expected: PASS. If the last test fails, `tools()` and the session are rendering from different contracts: check that `AgentAPI` passes its one `source()` as `contractSource` to every session.

- [ ] **Step 3: Prove it bites**

Temporarily make `renderAgentTools` return `name: 'blok.read'` for the read tool. Run the law test, see the first test FAIL, then revert.

- [ ] **Step 4: Lint and commit**

```bash
yarn eslint test/unit/architecture/agent-tool-definition-law.test.ts
git add test/unit/architecture/agent-tool-definition-law.test.ts
git diff --cached --name-only
git commit -m "test(agent): tool definition law over the live contract" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Attribution (spec tests 4 and 17)

**Files:**
- Test: `test/unit/components/modules/api/agent.integration.test.ts` (append)

**Interfaces:**
- Consumes: 01's per-touched-block attribution and `detail.agent` stamping (06 C3); `attributeLastEditedBy` (Task 9).
- Consumes, does not produce: `BlockMutationEventDetail.agent?: { id: string; name: string; turnId: string }` is published by 01 Task 24 (`types/events/block/Base.ts`).
- 03 writes no stamping code and no type. If these tests fail, the fix belongs to 01.

- [ ] **Step 1: Write the failing tests**

Append to `agent.integration.test.ts`:
```ts
import type { BlockMutationEvent } from '../../../../../types';

const collect = (): { config: Partial<BlokConfig>; events: BlockMutationEvent[] } => {
  const events: BlockMutationEvent[] = [];

  return {
    events,
    config: {
      user: { id: 'human' },
      onChange: (_api, event) => {
        events.push(...(Array.isArray(event) ? event : [event]));
      },
    },
  };
};

const savedBlock = async (editor: TestEditor, id: string) => (await editor.save()).blocks.find((block) => block.id === id);

describe('agent attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    editors.splice(0).forEach((editor) => editor.destroy());
    document.body.innerHTML = '';
  });

  it('test 4: a block the agent changes names the agent, and its event carries detail.agent', async () => {
    const { config, events } = collect();
    const editor = await createRealEditor(config);
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    await turn.execute({ commands: [{ name: 'block.update', args: { id: 'p1', data: { text: 'Agent text' } } }] });
    turn.end();
    await settle(500);

    expect((await savedBlock(editor, 'p1'))?.lastEditedBy).toBe('bot');

    const forP1 = events.filter((event) => event.detail.target.id === 'p1');

    expect(forP1.length).toBeGreaterThan(0);
    forP1.forEach((event) => {
      expect(event.detail.agent).toEqual({ id: 'bot', name: 'Bot', turnId: turn.id });
      expect(event.detail.origin).toBe('local');
    });
  });

  it('attributeTo: user keeps the human id but still marks the event', async () => {
    const { config, events } = collect();
    const editor = await createRealEditor(config);
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' }, attributeTo: 'user' });

    await turn.execute({ commands: [{ name: 'block.update', args: { id: 'p1', data: { text: 'Agent text' } } }] });
    turn.end();
    await settle(500);

    expect((await savedBlock(editor, 'p1'))?.lastEditedBy).toBe('human');
    expect(events.some((event) => event.detail.agent?.id === 'bot')).toBe(true);
  });

  it('outside a turn nothing is attributed to an agent', async () => {
    const { config, events } = collect();
    const editor = await createRealEditor(config);

    await editor.blocks.update('p1', { text: 'Host text' });
    await settle(500);

    expect((await savedBlock(editor, 'p1'))?.lastEditedBy).toBe('human');
    expect(events.every((event) => event.detail.agent === undefined)).toBe(true);
  });

  it('test 17: a write to another block during the agent batch keeps the human id', async () => {
    const { config, events } = collect();
    const editor = await createRealEditor({
      ...config,
      data: { blocks: [
        { id: 'p1', type: 'paragraph', data: { text: 'First' } },
        { id: 'p2', type: 'paragraph', data: { text: 'Second' } },
      ] },
    });
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    // Started, not awaited: the host write lands inside the batch's open undo group.
    const agentWrite = turn.execute({ commands: [{ name: 'block.update', args: { id: 'p1', data: { text: 'Agent' } } }] });
    const humanWrite = editor.blocks.update('p2', { text: 'Human' });

    await Promise.all([agentWrite, humanWrite]);
    turn.end();
    await settle(500);

    expect((await savedBlock(editor, 'p2'))?.lastEditedBy).toBe('human');
    expect(events.filter((event) => event.detail.target.id === 'p2').every((event) => event.detail.agent === undefined)).toBe(true);
    expect((await savedBlock(editor, 'p1'))?.lastEditedBy).toBe('bot');
  });
});
```
A host API write stands in for the user's typing in test 17. It goes through the same `lastEditedBy` stamp (`blockManager.ts:2689-2693`). The e2e Task 25 covers real typing for undo. The 500 ms settle waits past the mutation window. That number is inferred from the 400 ms coalescing window noted in `collaboration/index.ts:769-771`.

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/api/agent.integration.test.ts -t "attribution"`
Expected: FAIL while 01 Tasks 24 and 28a are not on `main` (`event.detail.agent` undefined). Once they are, this passes at once: it pins 01's behaviour, which this plan does not implement.

- [ ] **Step 3: Check the public field exists (01 owns it)**

Run: `grep -n "agent?:" types/events/block/Base.ts`
Expected: one hit inside `BlockMutationEventDetail` with `{ id: string; name: string; turnId: string }` (01 Task 24). If it is missing, STOP: 01 Task 24 has not landed. Do not add it here; two writers of one published type drift.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test test/unit/components/modules/api/agent.integration.test.ts`
Expected: PASS (9 tests). If test 4 or 17 stays red, 01's per-touched-block attribution is missing or wrong. Report to plan 01 with the failing assertion. Do not commit a red test: hold this task until 01's fix lands, as in Task 13.

- [ ] **Step 5: Lint and commit**

```bash
yarn eslint test/unit/components/modules/api/agent.integration.test.ts
git add test/unit/components/modules/api/agent.integration.test.ts
git diff --cached --name-only
git commit -m "test(agent): attribution pins for in-app turns" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Undo pins R-U1, R-U4, R-U5 (spec tests 7 and 9)

**Files:**
- Test: `test/unit/components/modules/api/agent.integration.test.ts` (append)

**Interfaces:**
- Consumes: 01's per-execute undo step and turn merge (06 C11); `editor.history.undo()` / `canUndo()`.
- **03 writes no undo code.** These tests pin 01's lever, which 06 marks unverified. R-U3 and R-U6 need real typing, so they live in Task 25's e2e.

- [ ] **Step 1: Write the tests**

Append:
```ts
const texts = async (editor: TestEditor): Promise<string[]> => (await editor.save()).blocks.map((block) => {
  const text = block.data.text as unknown;

  return Array.isArray(text)
    ? text.map((segment: { text?: string }) => segment.text ?? '').join('')
    : String(text);
});

describe('agent undo pins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    editors.splice(0).forEach((editor) => editor.destroy());
    document.body.innerHTML = '';
  });

  const insert = (text: string) => ({ commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text }, position: 'end' } }] });

  it('test 9 (R-U4): an agent batch is undoable by the user', async () => {
    const editor = await createRealEditor();
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    await turn.execute(insert('A'));
    turn.end();
    await settle(50);

    expect(editor.history.canUndo()).toBe(true);
  });

  it('test 7 (R-U1): two batches across an await, past the capture window, undo as one step', async () => {
    const editor = await createRealEditor();
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    await turn.execute(insert('A'));
    // Past Yjs's 500ms captureTimeout: only the turn-merge lever can join these.
    await settle(600);
    await turn.execute(insert('B'));
    turn.end();
    await settle(50);

    editor.history.undo();
    await settle(50);

    expect(await texts(editor)).toEqual(['First']);
  });

  it('R-U5: after end(), the next write starts its own step', async () => {
    const editor = await createRealEditor();
    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    await turn.execute(insert('A'));
    turn.end();
    await settle(50);
    editor.blocks.insert('paragraph', { text: 'Host' });
    await settle(600);

    editor.history.undo();
    await settle(50);

    expect(await texts(editor)).toEqual(['First', 'A']);
  });
});
```

- [ ] **Step 2: Run them**

Run: `yarn test test/unit/components/modules/api/agent.integration.test.ts -t "undo pins"`
Expected: PASS once 01's merge lever has landed.
- If test 7 fails with `['First', 'A']`, 01's turn merge is missing. Do NOT commit a red test and do NOT add undo code here. Report to plan 01 and hold this task until its lever lands.
- If R-U5 fails with `['First']`, the merge leaks past `end()`. Report it to 01 the same way.

- [ ] **Step 3: Prove test 7 bites**

Temporarily replace the second `turn.execute(insert('B'))` with `turn.end(); const second = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } }); await second.execute(insert('B')); second.end();`. Two turns must never merge, so test 7 must now FAIL with `['First', 'A']`. If it still passes, the test is not measuring the merge, so find out why before going on. Restore the original lines.

- [ ] **Step 4: Commit**

```bash
yarn eslint test/unit/components/modules/api/agent.integration.test.ts
git add test/unit/components/modules/api/agent.integration.test.ts
git diff --cached --name-only
git commit -m "test(agent): undo pins R-U1, R-U4, R-U5 for agent turns" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Checkpoint 2

- [ ] Run, one per call: `agent-turn.test.ts`, `agent.test.ts`, `agent.integration.test.ts`, `api-methods.test.ts`, `viewState.test.ts`, `blok-class-api-parity-law.test.ts`, `agent-tool-definition-law.test.ts`, `published-types-no-src-refs.test.ts` (paths as in the tasks). All PASS.
- [ ] Referencing tests: `grep -rln "BlockMutationEventDetail\|createBlokStub\|BlokModules" test/unit | head -20`. Run each file that touches the changed types. All PASS.
- [ ] `NODE_OPTIONS=--max-old-space-size=8192 yarn tsc --noEmit`: no new errors.
- [ ] `git pull --rebase && git push`. `git status` says "up to date with 'origin/main'".
- [ ] Tell plan 05's executor: `editor.agent.begin(...)` is on `main` for the `editor` parity runner.

# Phase 3 — Visibility: agent caret, pulse, follow, peers

### Task 14: Field → input mapping and contract → DOM offsets (spec test 19)

**Files:**
- Create: `src/components/modules/collaboration/agent-placement.ts`
- Modify: `src/shared/rich-text/html-to-segments.ts:20` (`const OPAQUE_TAGS` → `export const OPAQUE_TAGS`)
- Test: `test/unit/components/modules/collaboration/agent-placement.test.ts`

**Interfaces:**
- Consumes: `CaretPosition` (`caret-position.ts:22-29`); `PAGE_REFERENCE_ATTR` (`src/shared/page-reference.ts:3`); `EQUATION_SOURCE_ATTR` (`src/shared/equation-mark.ts:21`); `OPAQUE_TAGS` (`html-to-segments.ts:20-23`).
- Produces:
  ```ts
  export interface AgentTarget { blockId: string; field?: string | null; start?: number | null; end?: number | null }
  export type AgentPlacement = { kind: 'caret'; caret: CaretPosition } | { kind: 'block'; blockId: string };
  export interface PlacementDeps {
    resolveInputs(blockId: string): HTMLElement[];
    inputIndexFor(blockId: string, field: string): number | null;
  }
  export function inputIndexForField(field: string, entry: { inputFields?: string[]; richTextFields: string[] } | undefined): number | null;
  export function contractToDomOffset(input: HTMLElement, units: number): number;
  export function placeAgent(target: AgentTarget, deps: PlacementDeps): AgentPlacement;
  ```
- Why the conversion exists: the contract counts one unit per embed and one per `"\n"` (06 C12). `CaretPosition` counts DOM text with `range.toString()` (`caret-position.ts:54-61`). There, an equation embed counts its whole source text, and a `<br>` counts zero.

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  contractToDomOffset,
  inputIndexForField,
  placeAgent,
} from '../../../../../src/components/modules/collaboration/agent-placement';

const inputWith = (html: string): HTMLElement => {
  const input = document.createElement('div');

  input.setAttribute('contenteditable', 'true');
  input.innerHTML = html;
  document.body.appendChild(input);

  return input;
};

describe('agent placement — test 19', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('inputIndexForField', () => {
    it('maps through inputFields', () => {
      expect(inputIndexForField('caption', { inputFields: ['text', 'caption'], richTextFields: ['text', 'caption'] })).toBe(1);
    });

    it('with no inputFields, a block with one rich field maps it to input 0', () => {
      expect(inputIndexForField('text', { richTextFields: ['text'] })).toBe(0);
    });

    it.each([
      ['two rich fields and no inputFields', 'a', { richTextFields: ['a', 'b'] }],
      ['a field inputFields does not list', 'title', { inputFields: ['text'], richTextFields: ['text'] }],
      ['an unknown tool', 'text', undefined],
    ])('is null for %s', (_label, field, entry) => {
      expect(inputIndexForField(field, entry)).toBeNull();
    });
  });

  describe('contractToDomOffset', () => {
    it('plain text: units equal DOM offsets', () => {
      expect(contractToDomOffset(inputWith('hello'), 3)).toBe(3);
    });

    it('an equation embed is one unit but its whole source in DOM text', () => {
      const input = inputWith('ab<span data-latex="x^2">x^2</span>cd');

      // a, b, [embed], c  →  2 + 3 + 1
      expect(contractToDomOffset(input, 4)).toBe(6);
    });

    it('a page mention embed is one unit', () => {
      const input = inputWith('a<a data-blok-page-id="p9">Untitled</a>b');

      expect(contractToDomOffset(input, 3)).toBe('a'.length + 'Untitled'.length + 1);
    });

    it('a line break is one unit and zero DOM characters', () => {
      const input = inputWith('ab<br>cd');

      expect(contractToDomOffset(input, 3)).toBe(2);
      expect(contractToDomOffset(input, 4)).toBe(3);
    });

    it('marks are transparent', () => {
      expect(contractToDomOffset(inputWith('a<b>bc</b>d'), 3)).toBe(3);
    });

    it('clamps past the end to the DOM length', () => {
      expect(contractToDomOffset(inputWith('ab<br>cd'), 99)).toBe(4);
    });
  });

  describe('placeAgent', () => {
    const deps = (inputs: HTMLElement[], index: number | null) => ({
      resolveInputs: () => inputs,
      inputIndexFor: () => index,
    });

    it('a mapped field with offsets gives a caret in DOM units', () => {
      const input = inputWith('ab<span data-latex="y">y</span>cd');

      expect(placeAgent({ blockId: 'b1', field: 'text', start: 3, end: 4 }, deps([input], 0))).toEqual({
        kind: 'caret',
        caret: { blockId: 'b1', inputIndex: 0, anchor: 3, head: 4 },
      });
    });

    it.each([
      ['no field', { blockId: 'b1' }, 0],
      ['no offsets', { blockId: 'b1', field: 'text' }, 0],
      ['an unmapped field', { blockId: 'b1', field: 'text', start: 0, end: 0 }, null],
    ])('%s gives a block-level marker', (_label, target, index) => {
      expect(placeAgent(target, deps([inputWith('x')], index))).toEqual({ kind: 'block', blockId: 'b1' });
    });

    it('a native <input> gives a block-level marker', () => {
      const native = document.createElement('input');

      expect(placeAgent({ blockId: 'b1', field: 'text', start: 0, end: 1 }, deps([native], 0))).toEqual({ kind: 'block', blockId: 'b1' });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/collaboration/agent-placement.test.ts`
Expected: FAIL with "Failed to resolve import .../agent-placement".

- [ ] **Step 3: Implement**

In `src/shared/rich-text/html-to-segments.ts`, change `const OPAQUE_TAGS = new Set([` to `export const OPAQUE_TAGS = new Set([`.

`src/components/modules/collaboration/agent-placement.ts`:
```ts
import { EQUATION_SOURCE_ATTR } from '../../../shared/equation-mark';
import { PAGE_REFERENCE_ATTR } from '../../../shared/page-reference';
import { OPAQUE_TAGS } from '../../../shared/rich-text/html-to-segments';

import type { CaretPosition } from './caret-position';

export interface AgentTarget {
  blockId: string;
  field?: string | null;
  start?: number | null;
  end?: number | null;
}

export type AgentPlacement =
  | { kind: 'caret'; caret: CaretPosition }
  | { kind: 'block'; blockId: string };

export interface PlacementDeps {
  resolveInputs(blockId: string): HTMLElement[];
  inputIndexFor(blockId: string, field: string): number | null;
}

/**
 * Which DOM input edits a data field (06 §10.2).
 * @param field - the data field a range names
 * @param entry - the block tool's manifest entry, or undefined for an unknown tool
 */
export function inputIndexForField(
  field: string,
  entry: { inputFields?: string[]; richTextFields: string[] } | undefined
): number | null {
  if (entry === undefined) {
    return null;
  }

  if (entry.inputFields !== undefined) {
    const index = entry.inputFields.indexOf(field);

    return index === -1 ? null : index;
  }

  return entry.richTextFields.length === 1 && entry.richTextFields[0] === field ? 0 : null;
}

/** The same elements html-to-segments turns into one embed segment. */
const isEmbed = (element: Element): boolean =>
  (element.localName === 'a' && element.hasAttribute(PAGE_REFERENCE_ATTR))
  || (element.localName === 'span' && element.hasAttribute(EQUATION_SOURCE_ATTR))
  || OPAQUE_TAGS.has(element.localName);

/**
 * Contract units (UTF-16, one per embed, one per line break) to the DOM text
 * offset CaretPosition counts. Past the end, clamps to the input's DOM length.
 * @param input - the editable element the range counts into
 * @param units - an offset in contract units
 */
export function contractToDomOffset(input: HTMLElement, units: number): number {
  const walk = { left: Math.max(0, units), dom: 0, done: false };

  const visit = (node: Node): void => {
    if (walk.done) {
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;

      if (walk.left <= length) {
        walk.dom += walk.left;
        walk.left = 0;
        walk.done = true;

        return;
      }

      walk.dom += length;
      walk.left -= length;

      return;
    }

    if (!(node instanceof Element)) {
      return;
    }

    if (node.localName === 'br' || isEmbed(node)) {
      if (walk.left === 0) {
        walk.done = true;

        return;
      }

      // range.toString() counts an embed's text and counts a <br> as nothing.
      walk.dom += node.localName === 'br' ? 0 : node.textContent?.length ?? 0;
      walk.left -= 1;

      return;
    }

    node.childNodes.forEach(visit);
  };

  input.childNodes.forEach(visit);

  return walk.dom;
}

const isMeasurable = (input: HTMLElement): boolean =>
  !(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement);

/**
 * Where to draw an agent: a caret when the field maps to a measurable input
 * and both offsets are known, else a block-level marker.
 * @param target - a block, optionally a field and a contract-unit range
 * @param deps - how to find a block's inputs and a field's input index
 */
export function placeAgent(target: AgentTarget, deps: PlacementDeps): AgentPlacement {
  const block: AgentPlacement = { kind: 'block', blockId: target.blockId };
  const { field, start, end } = target;

  if (typeof field !== 'string' || typeof start !== 'number' || typeof end !== 'number') {
    return block;
  }

  const index = deps.inputIndexFor(target.blockId, field);

  if (index === null) {
    return block;
  }

  const input = deps.resolveInputs(target.blockId)[index];

  if (input === undefined || !isMeasurable(input)) {
    return block;
  }

  return {
    kind: 'caret',
    caret: {
      blockId: target.blockId,
      inputIndex: index,
      anchor: contractToDomOffset(input, start),
      head: contractToDomOffset(input, end),
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test test/unit/components/modules/collaboration/agent-placement.test.ts`
Expected: PASS (17 tests).
Run: `yarn test test/unit/shared/rich-text/html-to-segments.test.ts`
Expected: PASS. Only an `export` keyword changed. If that path does not exist, find the file with `grep -rln "html-to-segments" test/unit | head -3` and run it.

- [ ] **Step 5: Lint and commit**

```bash
yarn eslint src/components/modules/collaboration/agent-placement.ts src/shared/rich-text/html-to-segments.ts test/unit/components/modules/collaboration/agent-placement.test.ts
git add src/components/modules/collaboration/agent-placement.ts src/shared/rich-text/html-to-segments.ts test/unit/components/modules/collaboration/agent-placement.test.ts
git diff --cached --name-only
git commit -m "feat(agent): map agent ranges to DOM inputs and offsets" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Block-level agent marker layer and its CSS

**Files:**
- Create: `src/components/modules/collaboration/agent-marker-layer.ts`
- Modify: `src/styles/presence.css` (append rules; add one line to the `prefers-reduced-motion` block near line 92)
- Test: `test/unit/components/modules/collaboration/agent-marker-layer.test.ts`, `test/unit/components/modules/collaboration/presence-css.test.ts` (append)

**Interfaces:**
- Consumes: `PRESENCE_COLOR_PROPERTY` (`presence.ts:155`).
- Produces:
  ```ts
  export interface AgentMarker { key: number; blockId: string; name: string; color: string }
  export interface AgentMarkerLayer { render(markers: AgentMarker[]): void; clear(): void }
  export function createAgentMarkerLayer(options: { resolveHolder(blockId: string): HTMLElement | null; greetForMs?: number }): AgentMarkerLayer;
  ```
  Attributes: `data-blok-agent-marker` (the outline), `data-blok-agent-marker-label="<name>"` (the flag), `data-blok-agent-marker-shown` (set while greeting). These are local constants, like `CARET_ATTR` in `presence-carets.ts:52`, and are not in `DATA_ATTR`.
- UI laws: writes only append children to the holder (child-holder decoration law). The flag shows on arrival only, never on focus. Styling is identity colour, not a selected state. CSS uses logical properties (RTL). No `<svg>`.

- [ ] **Step 1: Write the failing tests**

`agent-marker-layer.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentMarkerLayer } from '../../../../../src/components/modules/collaboration/agent-marker-layer';

const holderFor = (id: string): HTMLElement => {
  const holder = document.createElement('div');
  const toolRoot = document.createElement('div');

  holder.setAttribute('data-blok-id', id);
  toolRoot.setAttribute('data-blok-tool', 'paragraph');
  holder.appendChild(toolRoot);
  document.body.appendChild(holder);

  return holder;
};

describe('agent marker layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('appends an inert outline and a name flag to the holder, never into the tool root', () => {
    const holder = holderFor('b1');
    const layer = createAgentMarkerLayer({ resolveHolder: (id) => (id === 'b1' ? holder : null) });

    layer.render([{ key: -1, blockId: 'b1', name: 'Bot', color: '#0b6e99' }]);

    const outline = holder.querySelector('[data-blok-agent-marker]');
    const flag = holder.querySelector('[data-blok-agent-marker-label="Bot"]');

    expect(outline?.parentElement).toBe(holder);
    expect(flag?.parentElement).toBe(holder);
    expect(outline?.getAttribute('aria-hidden')).toBe('true');
    expect(outline?.getAttribute('contenteditable')).toBe('false');
    expect(holder.querySelector('[data-blok-tool]')?.children).toHaveLength(0);
    expect(flag?.textContent).toBe('');
  });

  it('greets on arrival, then hides the flag', () => {
    const holder = holderFor('b1');
    const layer = createAgentMarkerLayer({ resolveHolder: () => holder, greetForMs: 1000 });

    layer.render([{ key: -1, blockId: 'b1', name: 'Bot', color: '#0b6e99' }]);
    expect(holder.querySelector('[data-blok-agent-marker-shown]')).not.toBeNull();

    vi.advanceTimersByTime(1000);
    expect(holder.querySelector('[data-blok-agent-marker-shown]')).toBeNull();
  });

  it('moves to another block, and removes markers no longer listed', () => {
    const first = holderFor('b1');
    const second = holderFor('b2');
    const layer = createAgentMarkerLayer({ resolveHolder: (id) => (id === 'b1' ? first : second) });

    layer.render([{ key: -1, blockId: 'b1', name: 'Bot', color: '#0b6e99' }]);
    layer.render([{ key: -1, blockId: 'b2', name: 'Bot', color: '#0b6e99' }]);

    expect(first.querySelector('[data-blok-agent-marker]')).toBeNull();
    expect(second.querySelector('[data-blok-agent-marker]')).not.toBeNull();

    layer.render([]);
    expect(document.querySelector('[data-blok-agent-marker]')).toBeNull();
  });

  it('skips a block with no holder and clears everything on clear()', () => {
    const holder = holderFor('b1');
    const layer = createAgentMarkerLayer({ resolveHolder: (id) => (id === 'b1' ? holder : null) });

    layer.render([
      { key: 1, blockId: 'gone', name: 'A', color: '#0b6e99' },
      { key: 2, blockId: 'b1', name: 'B', color: '#0b6e99' },
    ]);
    expect(document.querySelectorAll('[data-blok-agent-marker]')).toHaveLength(1);

    layer.clear();
    expect(document.querySelectorAll('[data-blok-agent-marker], [data-blok-agent-marker-label]')).toHaveLength(0);
  });
});
```

Append to `presence-css.test.ts` (it already reads `STYLESHEET`):
```ts
describe('agent marker and agent face styles', () => {
  const ruleText = (selector: string): string => {
    const start = STYLESHEET.indexOf(`${selector} {`);

    return start === -1 ? '' : STYLESHEET.slice(start, STYLESHEET.indexOf('}', start));
  };

  it('the outline sits on the holder and never takes the pointer', () => {
    const rule = ruleText('[data-blok-agent-marker]');

    expect(rule).toContain('position: absolute');
    expect(rule).toContain('pointer-events: none');
  });

  it('the flag is placed with logical properties only (RTL)', () => {
    const rule = ruleText('[data-blok-agent-marker-label]');

    expect(rule).toContain('inset-inline-start');
    expect(rule).not.toMatch(/(^|[^-])left:/m);
    expect(rule).toContain('opacity: 0');
  });

  it('the flag text is painted from the attribute, not a text node', () => {
    expect(STYLESHEET).toContain('content: attr(data-blok-agent-marker-label)');
  });

  it('the flag does not fade under reduced motion', () => {
    const reduced = STYLESHEET.slice(STYLESHEET.indexOf('@media (prefers-reduced-motion: reduce)'));

    expect(reduced).toContain('[data-blok-agent-marker-label]');
  });

  it('an agent face is a rounded square, not a disc', () => {
    expect(ruleText('[data-blok-presence-face][data-blok-presence-agent]')).toContain('border-radius: var(--blok-radius-control-sm)');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test test/unit/components/modules/collaboration/agent-marker-layer.test.ts`
Expected: FAIL with "Failed to resolve import".
Run: `yarn test test/unit/components/modules/collaboration/presence-css.test.ts`
Expected: the five new tests FAIL.

- [ ] **Step 3: Implement the layer**

`src/components/modules/collaboration/agent-marker-layer.ts`:
```ts
import { PRESENCE_COLOR_PROPERTY } from './presence';

/** The outline on a holder. Styled by src/styles/presence.css. */
const MARKER_ATTR = 'data-blok-agent-marker';
/** The name flag. Its value is the name, painted by `content: attr()`: a copied block keeps text nodes. */
const FLAG_ATTR = 'data-blok-agent-marker-label';
const SHOWN_ATTR = 'data-blok-agent-marker-shown';
/** Same greeting as the caret layer's default (presence-carets.ts). */
const DEFAULT_GREET_FOR_MS = 3000;

export interface AgentMarker {
  /** One marker per key: the awareness client id, or the local agent's constant. */
  key: number;
  blockId: string;
  /** Already through the name gate. */
  name: string;
  /** Already through the colour gate. */
  color: string;
}

export interface AgentMarkerLayer {
  render(markers: AgentMarker[]): void;
  clear(): void;
}

interface Drawn {
  holder: HTMLElement;
  outline: HTMLElement;
  flag: HTMLElement;
  greetTimer: ReturnType<typeof setTimeout> | null;
}

const inert = (element: HTMLElement): HTMLElement => {
  element.setAttribute('contenteditable', 'false');
  element.setAttribute('aria-hidden', 'true');

  return element;
};

/**
 * Where an agent works when no caret can be drawn: an outline and a name flag
 * appended to the block's HOLDER. The child-holder decoration law allows that.
 * Nothing goes at or below the tool root, and no holder is wrapped.
 * @param options - how to find a holder, and how long the name stays up
 */
export function createAgentMarkerLayer(options: {
  resolveHolder(blockId: string): HTMLElement | null;
  greetForMs?: number;
}): AgentMarkerLayer {
  const greetMs = options.greetForMs ?? DEFAULT_GREET_FOR_MS;
  const drawn = new Map<number, Drawn>();
  /** Keys already named once: a marker moving to the next block is not re-announced. */
  const greeted = new Set<number>();

  const remove = (entry: Drawn): void => {
    if (entry.greetTimer !== null) {
      clearTimeout(entry.greetTimer);
    }

    entry.outline.remove();
    entry.flag.remove();
  };

  const paint = (entry: Drawn, marker: AgentMarker): void => {
    entry.outline.style.setProperty(PRESENCE_COLOR_PROPERTY, marker.color);
    entry.flag.style.setProperty(PRESENCE_COLOR_PROPERTY, marker.color);
    entry.flag.setAttribute(FLAG_ATTR, marker.name);
  };

  const draw = (marker: AgentMarker, holder: HTMLElement): Drawn => {
    const outline = inert(document.createElement('div'));
    const flag = inert(document.createElement('div'));
    const entry: Drawn = { holder, outline, flag, greetTimer: null };

    outline.setAttribute(MARKER_ATTR, '');
    holder.append(outline, flag);
    paint(entry, marker);

    if (!greeted.has(marker.key)) {
      greeted.add(marker.key);
      flag.setAttribute(SHOWN_ATTR, '');
      entry.greetTimer = setTimeout(() => {
        flag.removeAttribute(SHOWN_ATTR);
        entry.greetTimer = null;
      }, greetMs);
    }

    return entry;
  };

  return {
    render(markers: AgentMarker[]): void {
      const keep = new Set<number>();

      markers.forEach((marker) => {
        const holder = options.resolveHolder(marker.blockId);

        if (holder === null) {
          return;
        }

        keep.add(marker.key);

        const existing = drawn.get(marker.key);

        if (existing !== undefined && existing.holder === holder) {
          paint(existing, marker);

          return;
        }

        if (existing !== undefined) {
          remove(existing);
        }

        drawn.set(marker.key, draw(marker, holder));
      });

      [...drawn.entries()].forEach(([key, entry]) => {
        if (!keep.has(key)) {
          remove(entry);
          drawn.delete(key);
          greeted.delete(key);
        }
      });
    },

    clear(): void {
      drawn.forEach(remove);
      drawn.clear();
      greeted.clear();
    },
  };
}
```

- [ ] **Step 4: Add the CSS**

Append to `src/styles/presence.css`:
```css
/* Where an agent works when no caret can be drawn. On the holder, which is
   already position: relative. Identity colour, never a selected state. */
[data-blok-agent-marker] {
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: var(--blok-radius-control);
  box-shadow: inset 0 0 0 var(--blok-presence-caret-width) var(--blok-presence-color);
  pointer-events: none;
  user-select: none;
}

/* The agent's name above the block. Painted from the attribute, because a
   copied block keeps text nodes. Shown on arrival only, never on focus. */
[data-blok-agent-marker-label] {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
  z-index: 2;
  padding: var(--blok-space-0-5) var(--blok-space-1-5);
  border-radius: var(--blok-radius-control-sm);
  background: var(--blok-presence-color);
  color: var(--blok-text-on-dark);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.45;
  white-space: nowrap;
  opacity: 0;
  transform: translateY(calc(-100% - 4px));
  transition: opacity 140ms ease;
  pointer-events: none;
  user-select: none;
}

[data-blok-agent-marker-label]::after {
  content: attr(data-blok-agent-marker-label);
}

[data-blok-agent-marker-shown] {
  opacity: 1;
}

/* An agent's face is a rounded square, so it never reads as a person. */
[data-blok-presence-face][data-blok-presence-agent] {
  border-radius: var(--blok-radius-control-sm);
}
```
Inside the existing `@media (prefers-reduced-motion: reduce)` block (it starts near `presence.css:92`), add:
```css
  /* The agent's name still comes and goes; it just does not fade. */
  [data-blok-agent-marker-label] {
    transition: none;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn test test/unit/components/modules/collaboration/agent-marker-layer.test.ts`
Expected: PASS (4 tests).
Run: `yarn test test/unit/components/modules/collaboration/presence-css.test.ts`
Expected: PASS.
Then find and run the CSS gates, one file per call: `ls test/unit/styles/ test/unit/architecture/ | grep -iE "radius|css|selected|svg"`. These cover the radius-role law, `selected-state-neutral.test.ts` and `no-inline-svg.test.ts`.

- [ ] **Step 6: Lint and commit**

```bash
yarn eslint src/components/modules/collaboration/agent-marker-layer.ts test/unit/components/modules/collaboration/agent-marker-layer.test.ts test/unit/components/modules/collaboration/presence-css.test.ts
git add src/components/modules/collaboration/agent-marker-layer.ts src/styles/presence.css test/unit/components/modules/collaboration/agent-marker-layer.test.ts test/unit/components/modules/collaboration/presence-css.test.ts
git diff --cached --name-only
git commit -m "feat(agent): block-level agent marker on the holder" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: Local agent presence (spec test 5) and wiring it into `AgentAPI`

**Files:**
- Create: `src/components/modules/api/agent-presence.ts`
- Modify: `src/components/modules/collaboration/presence.ts` (export `capPresenceName`, `agentColorFor`), `src/components/modules/api/agent.ts`
- Test: `test/unit/components/modules/api/agent-presence.test.ts`, `test/unit/components/modules/api/agent.test.ts` (append)

**Interfaces:**
- Consumes: `createCaretLayer` (`presence-carets.ts:151`), `createAgentMarkerLayer` (Task 15), `placeAgent`, `inputIndexForField` (Task 14), `isPresenceColor`, `presenceColorFor` (`presence.ts:121`, `:172`).
- Produces:
  ```ts
  // presence.ts
  export const capPresenceName: (value: unknown) => string;   // trim, cut by code point at 32
  export const agentColorFor: (actorId: string) => string;     // stable palette colour, same in every browser
  // agent-presence.ts
  export const AGENT_CLIENT_ID = -1;
  export interface AgentCursorField { actorId: string; name: string; color?: string; blockId: string; field?: string; start?: number; end?: number }
  export interface AgentPresenceOptions {
    host: HTMLElement;
    resolveHolder(blockId: string): HTMLElement | null;
    resolveInputs(blockId: string): HTMLElement[];
    inputIndexFor(blockId: string, field: string): number | null;
    isHidden(): boolean;
    publish(cursor: AgentCursorField | null): void;   // used from Task 20
    scrollTo(blockId: string): void;                  // used from Task 18
  }
  export interface AgentPresence {
    start(agent: AgentIdentity, options: { follow: boolean }): void;
    show(result: { changed: ChangedSet; lastRange?: TextRangeRef }): void;
    stop(): void;
  }
  export function createAgentPresence(options: AgentPresenceOptions): AgentPresence;
  // agent.ts
  public inputIndexFor(blockId: string, field: string): number | null;
  ```
- Notes:
  - `AGENT_CLIENT_ID` is negative. It never collides with an awareness id, and this layer never sees awareness states anyway.
  - The caret layer only re-measures when told. In single-player there is no collaboration renderer to tell it. So presence re-measures on its own: a `ResizeObserver` on the host (guarded) and the host's `input` event.

- [ ] **Step 1: Write the failing tests**

`test/unit/components/modules/api/agent-presence.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentPresence, type AgentPresenceOptions } from '../../../../../src/components/modules/api/agent-presence';
import { createCaretLayer } from '../../../../../src/components/modules/collaboration/presence-carets';
import { agentColorFor } from '../../../../../src/components/modules/collaboration/presence';
import type { ChangedSet } from '../../../../../types/agent';

interface FakeBlock { holder: HTMLElement; input: HTMLElement }

const blocks = new Map<string, FakeBlock>();

const addBlock = (id: string, text = 'hello world'): FakeBlock => {
  const holder = document.createElement('div');
  const content = document.createElement('div');
  const input = document.createElement('div');

  holder.setAttribute('data-blok-id', id);
  content.setAttribute('data-blok-element-content', '');
  input.setAttribute('contenteditable', 'true');
  input.textContent = text;
  content.appendChild(input);
  holder.appendChild(content);
  document.body.appendChild(holder);
  blocks.set(id, { holder, input });

  return { holder, input };
};

const stubRangeRect = (left: number): void => {
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue({
    left, top: 0, height: 18, right: left, bottom: 18, width: 0, x: left, y: 0, toJSON: () => ({}),
  });
};

const options = (overrides: Partial<AgentPresenceOptions> = {}): AgentPresenceOptions => ({
  host: document.body,
  resolveHolder: (id) => blocks.get(id)?.holder ?? null,
  resolveInputs: (id) => {
    const block = blocks.get(id);

    return block === undefined ? [] : [block.input];
  },
  inputIndexFor: (_id, field) => (field === 'text' ? 0 : null),
  isHidden: () => false,
  publish: vi.fn(),
  scrollTo: vi.fn(),
  ...overrides,
});

const NONE: ChangedSet = { created: [], updated: [], moved: [], removed: [] };
const AGENT = { id: 'bot', name: 'Bot' };

describe('agent presence — test 5', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubRangeRect(10);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    blocks.clear();
    document.body.innerHTML = '';
  });

  it('draws exactly one named caret in the block lastRange names', () => {
    const { holder } = addBlock('b1');
    const presence = createAgentPresence(options());

    presence.start(AGENT, { follow: false });
    presence.show({ changed: { ...NONE, updated: ['b1'] }, lastRange: { blockId: 'b1', field: 'text', start: 2, end: 2 } });

    expect(holder.querySelectorAll('[data-blok-presence-caret]')).toHaveLength(1);
    expect(holder.querySelector('[data-blok-presence-caret-label="Bot"]')).not.toBeNull();
    expect(document.querySelector('[data-blok-agent-marker]')).toBeNull();
  });

  it('with no lastRange, marks the last created block at block level', () => {
    addBlock('b1');
    const { holder } = addBlock('b2');
    const presence = createAgentPresence(options());

    presence.start(AGENT, { follow: false });
    presence.show({ changed: { ...NONE, created: ['b1', 'b2'] } });

    expect(holder.querySelector('[data-blok-agent-marker]')).not.toBeNull();
    expect(document.querySelector('[data-blok-presence-caret]')).toBeNull();
  });

  it('an unmapped field gives a block-level marker', () => {
    const { holder } = addBlock('b1');
    const presence = createAgentPresence(options());

    presence.start(AGENT, { follow: false });
    presence.show({ changed: { ...NONE, updated: ['b1'] }, lastRange: { blockId: 'b1', field: 'caption', start: 0, end: 1 } });

    expect(holder.querySelector('[data-blok-agent-marker]')).not.toBeNull();
  });

  it('a page-only batch draws nothing', () => {
    addBlock('b1');
    const presence = createAgentPresence(options());

    presence.start(AGENT, { follow: false });
    presence.show({ changed: NONE });

    expect(document.querySelector('[data-blok-presence-caret], [data-blok-agent-marker]')).toBeNull();
  });

  it('hideControls hides it', () => {
    addBlock('b1');
    const presence = createAgentPresence(options({ isHidden: () => true }));

    presence.start(AGENT, { follow: false });
    presence.show({ changed: { ...NONE, updated: ['b1'] }, lastRange: { blockId: 'b1', field: 'text', start: 0, end: 0 } });

    expect(document.querySelector('[data-blok-presence-caret], [data-blok-agent-marker]')).toBeNull();
  });

  it('stop removes it, and a show after stop draws nothing (Review Focus 1)', () => {
    addBlock('b1');
    const presence = createAgentPresence(options());

    presence.start(AGENT, { follow: false });
    presence.show({ changed: { ...NONE, created: ['b1'] } });
    presence.stop();
    presence.show({ changed: { ...NONE, created: ['b1'] } });

    expect(document.querySelector('[data-blok-presence-caret], [data-blok-agent-marker]')).toBeNull();
  });

  it('leaves the collaboration caret layer alone', () => {
    addBlock('b1');
    const { holder: peerHolder } = addBlock('peer');
    const collab = createCaretLayer({
      resolveHolder: (id) => blocks.get(id)?.holder ?? null,
      resolveInputs: (id) => {
        const block = blocks.get(id);

        return block === undefined ? [] : [block.input];
      },
    });

    collab.render([{ clientId: 7, name: 'Ann', color: '#0b6e99', caret: { blockId: 'peer', inputIndex: 0, anchor: 1, head: 1 } }]);

    const presence = createAgentPresence(options());

    presence.start(AGENT, { follow: false });
    presence.show({ changed: { ...NONE, updated: ['b1'] }, lastRange: { blockId: 'b1', field: 'text', start: 1, end: 1 } });
    presence.stop();

    expect(peerHolder.querySelectorAll('[data-blok-presence-caret]')).toHaveLength(1);
    collab.clear();
  });

  it('gates the name and the colour', () => {
    const { holder } = addBlock('b1');
    const presence = createAgentPresence(options());

    presence.start({ id: 'bot', name: `  ${'x'.repeat(40)}  `, color: 'red' }, { follow: false });
    presence.show({ changed: { ...NONE, created: ['b1'] } });

    const flag = holder.querySelector('[data-blok-agent-marker-label]');

    expect(flag?.getAttribute('data-blok-agent-marker-label')).toBe('x'.repeat(32));
    expect((flag as HTMLElement | null)?.style.getPropertyValue('--blok-presence-color')).toBe(agentColorFor('bot'));
  });

  it('re-measures the caret when the user types in the editor', () => {
    const { holder } = addBlock('b1');
    const presence = createAgentPresence(options());

    presence.start(AGENT, { follow: false });
    presence.show({ changed: { ...NONE, updated: ['b1'] }, lastRange: { blockId: 'b1', field: 'text', start: 2, end: 2 } });
    expect(holder.querySelector<HTMLElement>('[data-blok-presence-caret]')?.style.left).toBe('10px');

    stubRangeRect(40);
    document.body.dispatchEvent(new Event('input'));

    expect(holder.querySelector<HTMLElement>('[data-blok-presence-caret]')?.style.left).toBe('40px');
  });
});
```
If the caret's `left` is written relative to the holder box, also stub `holder.getBoundingClientRect` the way `presence-carets.test.ts:133` does, and keep the expected values matching.

Append to `agent.test.ts`:
```ts
describe('AgentAPI presence wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentModule.liveContractSource.mockReturnValue(sourceOf(makeContract()));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('inputIndexFor maps through the block tool\'s manifest entry', () => {
    const contract = makeContract();

    agentModule.liveContractSource.mockReturnValue(sourceOf({
      ...contract,
      manifest: { ...contract.manifest, blocks: [{ name: 'image', inputFields: ['caption'], richTextFields: ['caption'] }] },
    }));

    const api = createAgentApi();

    api.state = { ...stubModules(), BlockManager: { getBlockById: () => ({ name: 'image' }) } } as unknown as BlokModules;

    expect(api.inputIndexFor('i1', 'caption')).toBe(0);
    expect(api.inputIndexFor('i1', 'url')).toBeNull();
  });
});
```
The manifest entry literal is partial. Cast it with `as unknown as BlockToolManifestEntry` if `tsc` complains. It only needs `name`, `inputFields` and `richTextFields`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test test/unit/components/modules/api/agent-presence.test.ts`
Expected: FAIL with "Failed to resolve import .../agent-presence".
Run: `yarn test test/unit/components/modules/api/agent.test.ts -t "presence wiring"`
Expected: FAIL. `inputIndexFor` is not a function.

- [ ] **Step 3: Implement**

In `src/components/modules/collaboration/presence.ts`, after `presenceColorFor`:
```ts
/** Longest display name drawn anywhere in presence. */
export const MAX_PRESENCE_NAME_LENGTH = 32;

/**
 * Trim and cap a display name. Cut by CODE POINT: slicing an astral character
 * in half leaves a lone surrogate. The UTF-16 pre-slice bounds what Array.from
 * has to build, since a peer can publish megabytes.
 * @param value - an untrusted name
 */
export const capPresenceName = (value: unknown): string => (typeof value !== 'string'
  ? ''
  : Array.from(value.trim().slice(0, 2 * MAX_PRESENCE_NAME_LENGTH)).slice(0, MAX_PRESENCE_NAME_LENGTH).join(''));

/**
 * A stable palette colour for an agent id, the same in every browser.
 * FNV-1a, so every client hashes the id the same way with no crypto.
 * @param actorId - the agent's actor id
 */
export const agentColorFor = (actorId: string): string =>
  presenceColorFor(Array.from(actorId).reduce(
    (hash, char) => Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0,
    0x811c9dc5
  ));
```

`src/components/modules/api/agent-presence.ts`:
```ts
import type { ChangedSet, TextRangeRef } from '../../../../types/agent';
import type { AgentIdentity } from '../../../../types/api';
import { createAgentMarkerLayer } from '../collaboration/agent-marker-layer';
import { placeAgent, type AgentTarget } from '../collaboration/agent-placement';
import { agentColorFor, capPresenceName, isPresenceColor } from '../collaboration/presence';
import { createCaretLayer } from '../collaboration/presence-carets';

/** Negative: awareness ids are positive Yjs ids, and this private layer never sees them anyway. */
export const AGENT_CLIENT_ID = -1;

export interface AgentCursorField {
  actorId: string;
  name: string;
  color?: string;
  blockId: string;
  field?: string;
  start?: number;
  end?: number;
}

export interface AgentPresenceOptions {
  host: HTMLElement;
  resolveHolder(blockId: string): HTMLElement | null;
  resolveInputs(blockId: string): HTMLElement[];
  inputIndexFor(blockId: string, field: string): number | null;
  isHidden(): boolean;
  publish(cursor: AgentCursorField | null): void;
  scrollTo(blockId: string): void;
}

export interface AgentPresence {
  start(agent: AgentIdentity, options: { follow: boolean }): void;
  show(result: { changed: ChangedSet; lastRange?: TextRangeRef }): void;
  stop(): void;
}

const lastOf = (ids: string[]): string | undefined => ids[ids.length - 1];

/** lastRange when the batch wrote text, else the last created, moved or updated block. */
const targetOf = (result: { changed: ChangedSet; lastRange?: TextRangeRef }): AgentTarget | null => {
  if (result.lastRange !== undefined) {
    const { blockId, field, start, end } = result.lastRange;

    return { blockId, field, start, end };
  }

  const blockId = lastOf(result.changed.created) ?? lastOf(result.changed.moved) ?? lastOf(result.changed.updated);

  return blockId === undefined ? null : { blockId };
};

/**
 * The in-app agent, drawn for the person at this editor: one caret or one
 * block-level marker. Separate from the collaboration renderer, which never
 * draws this client and keeps its own ledger.
 * @param options - DOM lookups, the hide gate, and the publish/scroll seams
 */
export function createAgentPresence(options: AgentPresenceOptions): AgentPresence {
  const carets = createCaretLayer({ resolveHolder: options.resolveHolder, resolveInputs: options.resolveInputs });
  const markers = createAgentMarkerLayer({ resolveHolder: options.resolveHolder });
  const state = {
    agent: null as { id: string; name: string; color: string } | null,
    reflow: null as ResizeObserver | null,
    onInput: null as (() => void) | null,
  };

  const watch = (): void => {
    if (state.reflow === null && typeof ResizeObserver !== 'undefined') {
      state.reflow = new ResizeObserver(() => carets.reposition());
      state.reflow.observe(options.host);
    }

    if (state.onInput === null) {
      state.onInput = (): void => carets.reposition();
      options.host.addEventListener('input', state.onInput);
    }
  };

  const unwatch = (): void => {
    state.reflow?.disconnect();
    state.reflow = null;

    if (state.onInput !== null) {
      options.host.removeEventListener('input', state.onInput);
      state.onInput = null;
    }
  };

  const draw = (agent: { name: string; color: string }, target: AgentTarget): void => {
    if (options.isHidden()) {
      carets.clear();
      markers.clear();

      return;
    }

    const placement = placeAgent(target, options);

    if (placement.kind === 'caret') {
      markers.render([]);
      carets.render([{ clientId: AGENT_CLIENT_ID, name: agent.name, color: agent.color, caret: placement.caret }]);

      return;
    }

    carets.render([]);
    markers.render([{ key: AGENT_CLIENT_ID, blockId: placement.blockId, name: agent.name, color: agent.color }]);
  };

  return {
    start(agent: AgentIdentity): void {
      state.agent = {
        id: agent.id,
        name: capPresenceName(agent.name),
        color: isPresenceColor(agent.color) ? agent.color : agentColorFor(agent.id),
      };
      watch();
    },

    show(result): void {
      const agent = state.agent;

      if (agent === null) {
        return;
      }

      const target = targetOf(result);

      if (target !== null) {
        draw(agent, target);
      }
    },

    stop(): void {
      state.agent = null;
      carets.clear();
      markers.clear();
      unwatch();
    },
  };
}
```

In `src/components/modules/api/agent.ts`:
- Add imports:
  ```ts
  import { inputIndexForField } from '../collaboration/agent-placement';
  import { createAgentPresence, type AgentPresence } from './agent-presence';
  ```
- Add a cache field and replace `contract()`:
  ```ts
  private readonly cache = { contract: null as AgentContract | null, presence: null as AgentPresence | null };

  // Inferred, not verified: tools and config.agent.overrides do not change after boot.
  private contract(): AgentContract {
    this.cache.contract ??= this.source().contract();

    return this.cache.contract;
  }
  ```
- Add:
  ```ts
  /**
   * Which input of a block edits `field`, or null. Used to draw agents (local and peers').
   * @param blockId - the block
   * @param field - a data field of that block
   */
  public inputIndexFor(blockId: string, field: string): number | null {
    const type = this.Blok.BlockManager.getBlockById(blockId)?.name;

    if (type === undefined) {
      return null;
    }

    return inputIndexForField(field, this.contract().manifest.blocks.find((entry) => entry.name === type));
  }

  private presence(): AgentPresence {
    this.cache.presence ??= createAgentPresence({
      host: this.Blok.UI.nodes.wrapper,
      resolveHolder: (id) => this.Blok.BlockManager.getBlockById(id)?.holder ?? null,
      resolveInputs: (id) => this.Blok.BlockManager.getBlockById(id)?.inputs ?? [],
      inputIndexFor: (id, field) => this.inputIndexFor(id, field),
      isHidden: () => this.Blok.ReadOnly.isControlsHidden,
      publish: () => undefined,
      scrollTo: () => undefined,
    });

    return this.cache.presence;
  }
  ```
- In `begin`, replace `onExecuted: () => undefined` with `onExecuted: (result) => this.presence().show(result)`. Before `return turn;` add `this.presence().start(identity, { follow: options.follow === true });`.
- In `closeTurn`, after `this.current.turn = null;` add `this.presence().stop();`.

Tasks 18 and 20 replace the `publish` and `scrollTo` no-ops.

- [ ] **Step 4: Run tests to verify they pass**

Run, one per call: `agent-presence.test.ts` (9 tests), `agent.test.ts`, `agent.integration.test.ts`, `presence-renderer.test.ts`, `participants.test.ts`. All PASS. The last two only gained exports in `presence.ts`.

- [ ] **Step 5: Lint and commit**

```bash
yarn eslint src/components/modules/api/agent-presence.ts src/components/modules/api/agent.ts src/components/modules/collaboration/presence.ts test/unit/components/modules/api/agent-presence.test.ts test/unit/components/modules/api/agent.test.ts
git add src/components/modules/api/agent-presence.ts src/components/modules/api/agent.ts src/components/modules/collaboration/presence.ts test/unit/components/modules/api/agent-presence.test.ts test/unit/components/modules/api/agent.test.ts
git diff --cached --name-only
git commit -m "feat(agent): draw the agent caret or a block marker for the local user" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: Pulse on changed blocks, capped

**Files:**
- Modify: `src/components/modules/api/agent-presence.ts`
- Test: `test/unit/components/modules/api/agent-presence.test.ts` (append)

**Interfaces:**
- Consumes: `highlightBlockArrival(el)` (`src/components/utils/highlight-block-arrival.ts:19-50`). Its class is `blok-block--target`. Its reduced-motion rule is verified: `main.css:365-370` drops the keyframes and keeps a static background.
- Produces: `export const MAX_PULSES = 50;`. Every holder in `created ∪ updated ∪ moved`, de-duplicated, gets the class, up to 50. Ids with no holder are skipped. `removed` ids are never pulsed.

- [ ] **Step 1: Write the failing tests**

Append:
```ts
describe('agent presence — pulse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubRangeRect(10);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    blocks.clear();
    document.body.innerHTML = '';
  });

  it('pulses created, updated and moved holders once each', () => {
    ['a', 'b', 'c', 'd'].forEach((id) => addBlock(id));
    const presence = createAgentPresence(options());

    presence.start(AGENT, { follow: false });
    presence.show({ changed: { created: ['a'], updated: ['b', 'a'], moved: ['c'], removed: ['d'] } });

    expect(['a', 'b', 'c'].every((id) => blocks.get(id)?.holder.classList.contains('blok-block--target'))).toBe(true);
    expect(blocks.get('d')?.holder.classList.contains('blok-block--target')).toBe(false);
  });

  it('caps a huge batch at MAX_PULSES and skips ids with no holder', () => {
    const ids = Array.from({ length: 60 }, (_, index) => `b${index}`);

    ids.forEach((id) => addBlock(id));

    const presence = createAgentPresence(options());

    presence.start(AGENT, { follow: false });

    expect(() => presence.show({ changed: { ...NONE, created: ['missing', ...ids] } })).not.toThrow();
    expect(document.querySelectorAll('.blok-block--target')).toHaveLength(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/api/agent-presence.test.ts -t "pulse"`
Expected: FAIL. No holder has the class.

- [ ] **Step 3: Implement**

In `agent-presence.ts`:
```ts
import { highlightBlockArrival } from '../../utils/highlight-block-arrival';

/** highlightBlockArrival forces a reflow per call, so a huge batch must not pulse every holder. */
export const MAX_PULSES = 50;

const pulse = (changed: ChangedSet, resolveHolder: (id: string) => HTMLElement | null): void => {
  // `missing` ids do not consume the cap: the slice runs over holders that exist.
  [...new Set([...changed.created, ...changed.updated, ...changed.moved])]
    .map(resolveHolder)
    .filter((holder): holder is HTMLElement => holder !== null)
    .slice(0, MAX_PULSES)
    .forEach(highlightBlockArrival);
};
```
In `show`, right after the `if (agent === null) return;` guard, add `pulse(result.changed, options.resolveHolder);`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test test/unit/components/modules/api/agent-presence.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Lint and commit**

```bash
yarn eslint src/components/modules/api/agent-presence.ts test/unit/components/modules/api/agent-presence.test.ts
git add src/components/modules/api/agent-presence.ts test/unit/components/modules/api/agent-presence.test.ts
git diff --cached --name-only
git commit -m "feat(agent): pulse blocks an agent batch changed, capped at 50" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: Focus neutrality (spec test 6) and opt-in follow

**Files:**
- Modify: `src/components/modules/api/agent-presence.ts`, `src/components/modules/api/agent.ts`
- Test: `test/unit/components/modules/api/agent-presence.test.ts` (append), `test/unit/components/modules/api/agent.integration.test.ts` (append)

**Interfaces:**
- Consumes: `prefersReducedMotion` (`src/components/utils/reduced-motion`, imported at `api/blocks.ts:19`); `config.scrollToBlock?.topOffset` (`types/configs/blok-config.d.ts:1295-1300`).
- Produces: `follow: true` scrolls to the agent's target block after each successful batch. Following stops for the rest of the turn on `wheel`, `touchmove`, `keydown` or `pointerdown` on `window` (capture phase). It does NOT stop on `scroll`, because the follow scroll fires `scroll` itself (Review Focus 3).
- **Spec deviation, with reason:** 03 §3.7 says follow uses `scrollToBlock(id, { select: false })`. But `BlocksAPI.scrollToBlock` also calls `highlightBlockArrival` and `announce('a11y.navigatedToBlock')` on every call (`api/blocks.ts:1217-1220`). Per batch, that is one screen-reader announcement, which 03 §3.7 forbids ("No per-command announcements; they would flood"). So follow repeats only the scroll part of `scrollToBlock` (`api/blocks.ts:1200-1207`).

- [ ] **Step 1: Write the failing tests**

Append to `agent-presence.test.ts`:
```ts
describe('agent presence — follow (Review Focus 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubRangeRect(10);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    blocks.clear();
    document.body.innerHTML = '';
  });

  const batch = (id: string) => ({ changed: { ...NONE, created: [id] } });

  it('follow: false never scrolls', () => {
    addBlock('b1');
    const scrollTo = vi.fn();
    const presence = createAgentPresence(options({ scrollTo }));

    presence.start(AGENT, { follow: false });
    presence.show(batch('b1'));

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('follow: true scrolls to the agent block and keeps following through scroll events', () => {
    addBlock('b1');
    addBlock('b2');
    const scrollTo = vi.fn();
    const presence = createAgentPresence(options({ scrollTo }));

    presence.start(AGENT, { follow: true });
    presence.show(batch('b1'));
    window.dispatchEvent(new Event('scroll'));
    presence.show(batch('b2'));

    expect(scrollTo.mock.calls).toEqual([['b1'], ['b2']]);
    presence.stop();
  });

  it.each(['wheel', 'touchmove', 'keydown', 'pointerdown'])('%s stops following for the rest of the turn', (type) => {
    addBlock('b1');
    addBlock('b2');
    const scrollTo = vi.fn();
    const presence = createAgentPresence(options({ scrollTo }));

    presence.start(AGENT, { follow: true });
    presence.show(batch('b1'));
    window.dispatchEvent(new Event(type));
    presence.show(batch('b2'));

    expect(scrollTo.mock.calls).toEqual([['b1']]);
    presence.stop();
  });

  it('a new turn follows again after a stopped one', () => {
    addBlock('b1');
    const scrollTo = vi.fn();
    const presence = createAgentPresence(options({ scrollTo }));

    presence.start(AGENT, { follow: true });
    window.dispatchEvent(new Event('wheel'));
    presence.stop();
    presence.start(AGENT, { follow: true });
    presence.show(batch('b1'));

    expect(scrollTo).toHaveBeenCalledWith('b1');
    presence.stop();
  });
});
```

Append to `agent.integration.test.ts`:
```ts
describe('focus neutrality — test 6', () => {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (original === undefined) {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    } else {
      Object.defineProperty(Element.prototype, 'scrollIntoView', original);
    }
    editors.splice(0).forEach((editor) => editor.destroy());
    document.body.innerHTML = '';
  });

  it('an agent batch leaves focus, selection and scroll where the user put them', async () => {
    const editor = await createRealEditor({
      data: { blocks: [
        { id: 'p1', type: 'paragraph', data: { text: 'First' } },
        { id: 'p2', type: 'paragraph', data: { text: 'Second' } },
      ] },
    });
    const input = document.querySelector<HTMLElement>('[data-blok-id="p1"] [contenteditable="true"]');
    const textNode = input?.firstChild ?? null;

    if (input === null || textNode === null) {
      throw new Error('p1 has no editable text');
    }

    input.focus();

    const range = document.createRange();

    range.setStart(textNode, 2);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const scrollIntoView = vi.fn();

    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true });

    const turn = editor.agent.begin({ agent: { id: 'bot', name: 'Bot' } });

    await turn.execute({ commands: [
      { name: 'block.insert', args: { type: 'paragraph', data: { text: 'New' }, position: 'end' } },
      { name: 'text.replace', args: { id: 'p2', with: 'Changed' } },
    ] });
    turn.end();
    await settle(50);

    expect(document.activeElement).toBe(input);
    expect(window.getSelection()?.anchorNode).toBe(textNode);
    expect(window.getSelection()?.anchorOffset).toBe(2);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
```
`window.scrollY` is always 0 in jsdom, so asserting it would prove nothing. The spies are the real check.

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test test/unit/components/modules/api/agent-presence.test.ts -t "follow"`
Expected: FAIL. `scrollTo` is never called with `follow: true`.
Run: `yarn test test/unit/components/modules/api/agent.integration.test.ts -t "focus neutrality"`
Expected: PASS if 01's applier is focus-neutral. If it FAILS, the cause is in 01's `EditorApplier` (06 C14: it must not scroll, select or focus). Report to plan 01. Do not patch it here. Do not commit the focus test red: commit the follow half of this task, and hold the focus test until 01's fix lands, as in Task 13.

- [ ] **Step 3: Implement follow**

In `agent-presence.ts`, add to `state`: `following: false,` and `stopFollowing: null as (() => void) | null,`. Add:
```ts
/** User intent only. `scroll` is NOT here: the follow scroll fires it too. */
const INTENT_EVENTS = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const;
```
In `start(agent, { follow })`, after `watch();`:
```ts
      state.following = follow;

      if (follow) {
        const stop = (): void => {
          state.following = false;
        };

        INTENT_EVENTS.forEach((type) => window.addEventListener(type, stop, { capture: true, passive: true }));
        state.stopFollowing = (): void => {
          INTENT_EVENTS.forEach((type) => window.removeEventListener(type, stop, { capture: true }));
        };
      }
```
Change the signature to `start(agent: AgentIdentity, startOptions: { follow: boolean }): void` and use `startOptions.follow`, so it does not shadow the outer `options`.
In `show`, after `draw(agent, target);`, inside the `target !== null` branch:
```ts
        if (state.following) {
          options.scrollTo(target.blockId);
        }
```
In `stop()`, add first:
```ts
      state.following = false;
      state.stopFollowing?.();
      state.stopFollowing = null;
```

In `agent.ts`, add `import { prefersReducedMotion } from '../../utils/reduced-motion';` and replace `scrollTo: () => undefined` with:
```ts
      // The scroll half of BlocksAPI.scrollToBlock (api/blocks.ts:1200-1207) without
      // its per-call announce and pulse, which would flood a screen reader per batch.
      scrollTo: (id) => {
        const holder = this.Blok.BlockManager.getBlockById(id)?.holder;

        if (holder === undefined) {
          return;
        }

        const top = holder.getBoundingClientRect().top + window.scrollY - (this.config.scrollToBlock?.topOffset ?? 0);

        window.scrollTo({ top, behavior: prefersReducedMotion() ? 'instant' : 'smooth' });
      },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test test/unit/components/modules/api/agent-presence.test.ts`
Expected: PASS (18 tests).
Run: `yarn test test/unit/components/modules/api/agent.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
yarn eslint src/components/modules/api/agent-presence.ts src/components/modules/api/agent.ts test/unit/components/modules/api/agent-presence.test.ts test/unit/components/modules/api/agent.integration.test.ts
git add src/components/modules/api/agent-presence.ts src/components/modules/api/agent.ts test/unit/components/modules/api/agent-presence.test.ts test/unit/components/modules/api/agent.integration.test.ts
git diff --cached --name-only
git commit -m "feat(agent): opt-in follow that stops on user intent; focus neutrality pin" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: Screen reader summary at the end of a turn

**Files:**
- Modify: `src/components/modules/api/agent.ts`, `src/components/i18n/locales/en.json` and the other 70 locale files, `types/message-keys.d.ts` (regenerated)
- Test: `test/unit/components/modules/api/agent.test.ts` (append)

**Interfaces:**
- Consumes: `announce(message, { politeness })` (`src/components/utils/announcer.ts:273`); `I18n.t(key, vars)` (`src/components/modules/i18n.ts:102`).
- Produces three i18n keys:
  - `"agent.changedOneBlock": "{agent} changed 1 block"`
  - `"agent.changedBlocks": "{agent} changed {count} blocks"`
  - `"presence.agentFor": "{agent} for {person}"` (used in Task 23)
  The singular/plural split follows the existing `a11y.dragStarted` / `a11y.dragStartedMultiple` pair (`en.json:150-151`).
- One polite announcement per turn, on `end()` or `stop()`, counting distinct block ids in `created ∪ updated ∪ moved ∪ removed`. Nothing is announced when nothing changed. `stop()` announces too, because applied work stays. (The spec names only `end()`; announcing on `stop()` is this plan's choice.)

- [ ] **Step 1: Write the failing tests**

At the top of `agent.test.ts`, add:
```ts
const announcer = vi.hoisted(() => ({ announce: vi.fn() }));

vi.mock('../../../../../src/components/utils/announcer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../src/components/utils/announcer')>()),
  announce: announcer.announce,
}));
```
In `stubModules`, change `I18n` to `I18n: { t: (key: string, vars?: Record<string, unknown>) => `${key}|${JSON.stringify(vars ?? {})}` },`.
Append:
```ts
describe('AgentAPI announcement', () => {
  type OkResult = Extract<import('../../../../../types/agent').AgentResult, { ok: true }>;

  const result = (changed: Partial<OkResult['changed']>): OkResult => ({
    ok: true, revision: 'r', results: [], refs: {}, warnings: [],
    changed: { created: [], updated: [], moved: [], removed: [], ...changed },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    agentModule.liveContractSource.mockReturnValue(sourceOf(makeContract()));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sessionReturning = (...results: OkResult[]): AgentSession => {
    const session = fakeSession();
    const execute = vi.fn<AgentSession['execute']>();

    results.forEach((value) => execute.mockResolvedValueOnce(value));

    return { ...session, execute };
  };

  it('end() announces the distinct blocks the turn changed', async () => {
    agentModule.createEditorAgentSession.mockReturnValue(sessionReturning(result({ created: ['b1'] }), result({ updated: ['b1'], created: ['b2'] })));

    const turn = createAgentApi().methods.begin({ agent: { id: 'bot', name: 'Bot' } });

    await turn.execute({ commands: [] });
    await turn.execute({ commands: [] });
    turn.end();

    expect(announcer.announce).toHaveBeenCalledTimes(1);
    expect(announcer.announce).toHaveBeenCalledWith('agent.changedBlocks|{"agent":"Bot","count":2}', { politeness: 'polite' });
  });

  it('one block uses the singular key; stop() announces too', async () => {
    agentModule.createEditorAgentSession.mockReturnValue(sessionReturning(result({ removed: ['b1'] })));

    const turn = createAgentApi().methods.begin({ agent: { id: 'bot', name: 'Bot' } });

    await turn.execute({ commands: [] });
    turn.stop();

    expect(announcer.announce).toHaveBeenCalledWith('agent.changedOneBlock|{"agent":"Bot","count":1}', { politeness: 'polite' });
  });

  it('a turn that changed nothing announces nothing', () => {
    agentModule.createEditorAgentSession.mockReturnValue(fakeSession());
    createAgentApi().methods.begin({ agent: { id: 'bot', name: 'Bot' } }).end();

    expect(announcer.announce).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/api/agent.test.ts -t "announcement"`
Expected: FAIL. `announce` is never called.

- [ ] **Step 3: Implement**

In `agent.ts`:
- `import { announce } from '../../utils/announcer';`
- Extend `current` to `{ state, turn, agentName: '', changed: new Set<string>() }`.
- In `begin`, before creating the turn: `this.current.agentName = identity.name; this.current.changed = new Set<string>();`.
- Change `onExecuted` to:
  ```ts
      onExecuted: (result) => {
        const { created, updated, moved, removed } = result.changed;

        [...created, ...updated, ...moved, ...removed].forEach((id) => this.current.changed.add(id));
        this.presence().show(result);
      },
  ```
- In `closeTurn`, after `this.presence().stop();`:
  ```ts
    const count = this.current.changed.size;

    if (count > 0) {
      const key = count === 1 ? 'agent.changedOneBlock' : 'agent.changedBlocks';

      announce(this.Blok.I18n.t(key, { agent: this.current.agentName, count }), { politeness: 'polite' });
    }
  ```

- [ ] **Step 4: Add the keys in every locale**

1. Add the three keys to `src/components/i18n/locales/en.json`. Put the `agent.*` pair next to the other `a11y.*` announcements and `presence.agentFor` next to `presence.anonymous.*` (`en.json:751`).
2. Invoke the `blok-translations` skill to translate the three keys into the other 70 locale files. Keep `{agent}`, `{count}` and `{person}` verbatim.
3. Run `node scripts/i18n/check-translations.mjs`. Expected: exit 0.
4. Run `node scripts/generate-message-keys-dts.mjs` to regenerate `types/message-keys.d.ts`.
5. Run `yarn test test/unit/architecture/published-types-no-src-refs.test.ts`. Expected: PASS (message keys in sync).

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn test test/unit/components/modules/api/agent.test.ts`
Expected: PASS.
Find the i18n tests with `ls test/unit/i18n 2>/dev/null; grep -rln "locales/en.json" test/unit | head -5` and run each, one per call. All PASS.

- [ ] **Step 6: Lint and commit**

```bash
yarn eslint src/components/modules/api/agent.ts test/unit/components/modules/api/agent.test.ts
git add src/components/modules/api/agent.ts test/unit/components/modules/api/agent.test.ts src/components/i18n/locales/*.json types/message-keys.d.ts
git diff --cached --name-only
git commit -m "feat(agent): announce what a turn changed, in every locale" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
(`git diff --cached --name-only` must list 71 locale files plus the three others, and nothing else.)

---

### Task 20: Publish `agentCursor` to peers (spec test 25)

**Files:**
- Modify: `src/components/modules/api/agent-presence.ts`, `src/components/modules/api/agent.ts`
- Test: `test/unit/components/modules/api/agent-presence.test.ts` (append), `test/unit/components/modules/api/agent.test.ts` (append)

**Interfaces:**
- Consumes: `YjsManager.setAwarenessField(field, value)` (`yjs/index.ts:1341`). It is a no-op before `enableAwareness` (`document-store.ts:2477-2484`), so single-player pays nothing.
- Produces: the awareness field `agentCursor` in the 06 §10.2 shape. It is set after each successful batch that names a block. It is set to `null` on `end()`, `stop()` and `editor.destroy()`. `AgentAPI` sits before `Collaboration` and `YjsManager` in `Modules`, so the `null` goes out while awareness exists. Nothing is published after a stop (Review Focus 1).

- [ ] **Step 1: Write the failing tests**

Append to `agent-presence.test.ts`:
```ts
describe('agent presence — agentCursor publish (test 25)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubRangeRect(10);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    blocks.clear();
    document.body.innerHTML = '';
  });

  it('publishes the range in data-field terms, then null on stop', () => {
    addBlock('b1');
    const publish = vi.fn();
    const presence = createAgentPresence(options({ publish }));

    presence.start(AGENT, { follow: false });
    presence.show({ changed: { ...NONE, updated: ['b1'] }, lastRange: { blockId: 'b1', field: 'text', start: 2, end: 5 } });
    presence.stop();

    expect(publish.mock.calls).toEqual([
      [{ actorId: 'bot', name: 'Bot', color: agentColorFor('bot'), blockId: 'b1', field: 'text', start: 2, end: 5 }],
      [null],
    ]);
  });

  it('a block-level batch publishes no field or offsets', () => {
    addBlock('b1');
    const publish = vi.fn();
    const presence = createAgentPresence(options({ publish }));

    presence.start(AGENT, { follow: false });
    presence.show({ changed: { ...NONE, created: ['b1'] } });

    expect(publish).toHaveBeenCalledWith({ actorId: 'bot', name: 'Bot', color: agentColorFor('bot'), blockId: 'b1' });
    presence.stop();
  });

  it('publishes while hidden (drawing is gated, presence is not)', () => {
    addBlock('b1');
    const publish = vi.fn();
    const presence = createAgentPresence(options({ publish, isHidden: () => true }));

    presence.start(AGENT, { follow: false });
    presence.show({ changed: { ...NONE, created: ['b1'] } });

    expect(publish).toHaveBeenCalledTimes(1);
    presence.stop();
  });

  it('never publishes after stop, and stop without a publish sends no null', () => {
    const publish = vi.fn();
    const presence = createAgentPresence(options({ publish }));

    presence.start(AGENT, { follow: false });
    presence.stop();
    presence.show({ changed: { ...NONE, created: ['b1'] } });

    expect(publish).not.toHaveBeenCalled();
  });
});
```
Append to `agent.test.ts`:
```ts
describe('AgentAPI agentCursor wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentModule.liveContractSource.mockReturnValue(sourceOf(makeContract()));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes agentCursor through YjsManager and clears it on end()', async () => {
    const setAwarenessField = vi.fn();
    const session = fakeSession();

    agentModule.createEditorAgentSession.mockReturnValue({
      ...session,
      execute: vi.fn<AgentSession['execute']>().mockResolvedValue({
        ok: true, revision: 'r', results: [], refs: {}, warnings: [],
        changed: { created: ['b1'], updated: [], moved: [], removed: [] },
      }),
    });

    const api = createAgentApi();

    api.state = { ...stubModules(), YjsManager: { setAwarenessField } } as unknown as BlokModules;

    const turn = api.methods.begin({ agent: { id: 'bot', name: 'Bot' } });

    await turn.execute({ commands: [] });
    turn.end();

    expect(setAwarenessField.mock.calls).toEqual([
      ['agentCursor', expect.objectContaining({ actorId: 'bot', blockId: 'b1' })],
      ['agentCursor', null],
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test test/unit/components/modules/api/agent-presence.test.ts -t "agentCursor"`
Expected: FAIL. `publish` is never called.

- [ ] **Step 3: Implement**

In `agent-presence.ts`, add `published: false,` to `state` and:
```ts
const cursorFor = (agent: { id: string; name: string; color: string }, target: AgentTarget): AgentCursorField => ({
  actorId: agent.id,
  name: agent.name,
  color: agent.color,
  blockId: target.blockId,
  ...(typeof target.field === 'string' ? { field: target.field } : {}),
  ...(typeof target.start === 'number' && typeof target.end === 'number' ? { start: target.start, end: target.end } : {}),
});
```
In `show`, inside `if (target !== null)`, before `draw(agent, target);`:
```ts
        options.publish(cursorFor(agent, target));
        state.published = true;
```
In `stop()`, before `state.agent = null;`:
```ts
      if (state.published) {
        options.publish(null);
        state.published = false;
      }
```
In `agent.ts`, replace `publish: () => undefined` with:
```ts
      publish: (cursor) => this.Blok.YjsManager.setAwarenessField('agentCursor', cursor),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test test/unit/components/modules/api/agent-presence.test.ts`, then `yarn test test/unit/components/modules/api/agent.test.ts`. Both PASS.

- [ ] **Step 5: Lint and commit**

```bash
yarn eslint src/components/modules/api/agent-presence.ts src/components/modules/api/agent.ts test/unit/components/modules/api/agent-presence.test.ts test/unit/components/modules/api/agent.test.ts
git add src/components/modules/api/agent-presence.ts src/components/modules/api/agent.ts test/unit/components/modules/api/agent-presence.test.ts test/unit/components/modules/api/agent.test.ts
git diff --cached --name-only
git commit -m "feat(agent): publish agentCursor awareness during a turn" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 21: Gates for remote agent fields

**Files:**
- Create: `src/components/modules/collaboration/remote-agents.ts`
- Test: `test/unit/components/modules/collaboration/remote-agents.test.ts`

**Interfaces:**
- Consumes: `capPresenceName`, `isPresenceColor` (`presence.ts`).
- Produces:
  ```ts
  export interface RemoteAgent { via: string; onBehalfOf: string; onBehalfOfName: string | null }
  export interface RemoteAgentCursor { actorId: string; name: string; color: string | null; blockId: string; field: string | null; start: number | null; end: number | null }
  export const MAX_AGENT_ID_LENGTH = 256;
  export function readAgentField(value: unknown): RemoteAgent | null;
  export function readAgentCursor(value: unknown): RemoteAgentCursor | null;
  ```
- Rules follow 03 §3.10. Additions made by this plan: ids longer than 256 UTF-16 units are dropped. `agentColorFor` hashes the whole `actorId`, and a peer can publish megabytes. Only the known keys survive.

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readAgentCursor, readAgentField } from '../../../../../src/components/modules/collaboration/remote-agents';

describe('remote agent gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('readAgentField', () => {
    it('keeps via, onBehalfOf and a capped onBehalfOfName; drops other keys', () => {
      expect(readAgentField({ via: 'mcp', onBehalfOf: 'u1', onBehalfOfName: `  ${'n'.repeat(40)}`, evil: '<img>' }))
        .toEqual({ via: 'mcp', onBehalfOf: 'u1', onBehalfOfName: 'n'.repeat(32) });
    });

    it('a missing or blank onBehalfOfName becomes null', () => {
      expect(readAgentField({ via: 'mcp', onBehalfOf: 'u1' })).toEqual({ via: 'mcp', onBehalfOf: 'u1', onBehalfOfName: null });
      expect(readAgentField({ via: 'mcp', onBehalfOf: 'u1', onBehalfOfName: '  ' })?.onBehalfOfName).toBeNull();
    });

    it.each([
      ['not an object', 'mcp'],
      ['null', null],
      ['via not a string', { via: 1, onBehalfOf: 'u1' }],
      ['empty onBehalfOf', { via: 'mcp', onBehalfOf: '' }],
      ['onBehalfOfName not a string', { via: 'mcp', onBehalfOf: 'u1', onBehalfOfName: 5 }],
      ['an oversized id', { via: 'mcp', onBehalfOf: 'u'.repeat(257) }],
    ])('drops the field when %s', (_label, value) => {
      expect(readAgentField(value)).toBeNull();
    });
  });

  describe('readAgentCursor', () => {
    const valid = { actorId: 'bot', name: 'Bot', color: '#0b6e99', blockId: 'b1', field: 'text', start: 1, end: 3 };

    it('keeps a valid cursor', () => {
      expect(readAgentCursor(valid)).toEqual(valid);
    });

    it('an invalid colour becomes null (the caller uses the palette)', () => {
      expect(readAgentCursor({ ...valid, color: 'red; background:url(x)' })?.color).toBeNull();
    });

    it.each([
      ['field not a string', { field: 7 }],
      ['negative start', { start: -1 }],
      ['fractional end', { end: 1.5 }],
    ])('%s falls back to block level', (_label, patch) => {
      expect(readAgentCursor({ ...valid, ...patch })).toMatchObject({ blockId: 'b1', field: null, start: null, end: null });
    });

    it.each([
      ['no actorId', { actorId: '' }],
      ['blank name', { name: '   ' }],
      ['no blockId', { blockId: 3 }],
      ['oversized actorId', { actorId: 'a'.repeat(257) }],
    ])('drops the cursor when %s', (_label, patch) => {
      expect(readAgentCursor({ ...valid, ...patch })).toBeNull();
    });

    it('null and junk are dropped', () => {
      expect(readAgentCursor(null)).toBeNull();
      expect(readAgentCursor([valid])).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/collaboration/remote-agents.test.ts`
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 3: Implement**

`src/components/modules/collaboration/remote-agents.ts`:
```ts
import { capPresenceName, isPresenceColor } from './presence';

export interface RemoteAgent {
  via: string;
  onBehalfOf: string;
  onBehalfOfName: string | null;
}

export interface RemoteAgentCursor {
  actorId: string;
  name: string;
  color: string | null;
  blockId: string;
  field: string | null;
  start: number | null;
  end: number | null;
}

/** Ids are hashed and compared; a peer can publish megabytes. */
export const MAX_AGENT_ID_LENGTH = 256;

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value !== '' && value.length <= MAX_AGENT_ID_LENGTH;

const isOffset = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

/**
 * A peer's `agent` awareness field (04 publishes it for MCP agents), or null.
 * Anything malformed drops the whole field, so the peer is drawn as a person.
 * @param value - untrusted
 */
export function readAgentField(value: unknown): RemoteAgent | null {
  const raw = asRecord(value);

  if (raw === null || !isId(raw.via) || !isId(raw.onBehalfOf)) {
    return null;
  }

  if (raw.onBehalfOfName !== undefined && typeof raw.onBehalfOfName !== 'string') {
    return null;
  }

  const name = capPresenceName(raw.onBehalfOfName);

  return { via: raw.via, onBehalfOf: raw.onBehalfOf, onBehalfOfName: name === '' ? null : name };
}

/**
 * A peer's `agentCursor` awareness field (06 §10.2), or null.
 * A bad actorId, name or blockId drops it. A bad field or offset keeps the
 * block and falls back to block level.
 * @param value - untrusted
 */
export function readAgentCursor(value: unknown): RemoteAgentCursor | null {
  const raw = asRecord(value);
  const name = capPresenceName(raw?.name);

  if (raw === null || !isId(raw.actorId) || name === '' || !isId(raw.blockId)) {
    return null;
  }

  const base = { actorId: raw.actorId, name, color: isPresenceColor(raw.color) ? raw.color : null, blockId: raw.blockId };
  const broken = (raw.field !== undefined && typeof raw.field !== 'string')
    || (raw.start !== undefined && !isOffset(raw.start))
    || (raw.end !== undefined && !isOffset(raw.end));

  if (broken) {
    return { ...base, field: null, start: null, end: null };
  }

  return {
    ...base,
    field: typeof raw.field === 'string' ? raw.field : null,
    start: isOffset(raw.start) ? raw.start : null,
    end: isOffset(raw.end) ? raw.end : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/modules/collaboration/remote-agents.test.ts`
Expected: PASS (21 tests).

- [ ] **Step 5: Lint and commit**

```bash
yarn eslint src/components/modules/collaboration/remote-agents.ts test/unit/components/modules/collaboration/remote-agents.test.ts
git add src/components/modules/collaboration/remote-agents.ts test/unit/components/modules/collaboration/remote-agents.test.ts
git diff --cached --name-only
git commit -m "feat(agent): gates for peers' agent and agentCursor awareness fields" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 22: `CollaborationParticipant.agent` (spec test 21, rows)

**Files:**
- Modify: `types/events/editor-events.ts:56` (`CollaborationParticipant`), `src/components/modules/collaboration/participants.ts:15-21` (`Member`), `:94-152` (`buildParticipants`)
- Test: `test/unit/components/modules/collaboration/participants.test.ts` (append)

**Interfaces:**
- Consumes: `readAgentField` (Task 21).
- Produces: `CollaborationParticipant.agent?: { via: string; onBehalfOf: string; onBehalfOfName: string | null }`. It is set only when the identity member's `agent` field passes the gate. Otherwise the key is absent. This is additive on a type shipped in v1.16.1 (D4 approved).

- [ ] **Step 1: Write the failing tests**

Append:
```ts
import { buildParticipants as buildRows } from '../../../../../src/components/modules/collaboration/participants';

describe('participants — agent rows (test 21)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const row = (state: Record<string, unknown>) =>
    buildRows([{ clientId: 7, state: { user: { name: 'Claude' }, ...state } }], null, new Map(), undefined, Date.now())[0];

  it('a valid agent field marks the row', () => {
    expect(row({ agent: { via: 'mcp', onBehalfOf: 'u1', onBehalfOfName: 'Ann' } }).agent)
      .toEqual({ via: 'mcp', onBehalfOf: 'u1', onBehalfOfName: 'Ann' });
  });

  it('a malformed agent field leaves a plain participant', () => {
    expect(row({ agent: { via: 1, onBehalfOf: 'u1' } })).not.toHaveProperty('agent');
    expect(row({})).not.toHaveProperty('agent');
  });
});
```
If `participants.test.ts` already imports `vi`, `beforeEach` or `afterEach`, do not import them twice.

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/collaboration/participants.test.ts -t "agent rows"`
Expected: FAIL. `agent` is undefined.

- [ ] **Step 3: Implement**

`types/events/editor-events.ts`, inside `CollaborationParticipant` after `user`:
```ts
  /**
   * Set when this participant is an agent connected through MCP, and its
   * `agent` awareness field passed Blok's checks. `onBehalfOf` is the user id
   * the agent works for. Treat every field as untrusted text.
   */
  agent?: {
    via: string;
    onBehalfOf: string;
    onBehalfOfName: string | null;
  };
```
`participants.ts`:
- `import { readAgentField, type RemoteAgent } from './remote-agents';`
- Add `agent: RemoteAgent | null;` to `Member`.
- In the member literal inside `buildParticipants`: `agent: readAgentField(entry.state.agent),`.
- In `rows.push({ ... })`, after `user: { ... },`: `...(identity.agent === null ? {} : { agent: identity.agent }),`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test test/unit/components/modules/collaboration/participants.test.ts`
Expected: PASS (all, including existing tests that compare rows with `toEqual`; those stay green because the key is absent for non-agents).

- [ ] **Step 5: Lint and commit**

```bash
yarn eslint types/events/editor-events.ts src/components/modules/collaboration/participants.ts test/unit/components/modules/collaboration/participants.test.ts
git add types/events/editor-events.ts src/components/modules/collaboration/participants.ts test/unit/components/modules/collaboration/participants.test.ts
git diff --cached --name-only
git commit -m "feat(agent): CollaborationParticipant.agent for MCP agents in the room" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 23: Draw MCP agents as agents: "X for Y" and an agent face (spec test 21, drawing)

**Files:**
- Modify: `src/components/modules/collaboration/presence-avatars.ts:8-19` (`AvatarIdentity`), `:101-127` (`buildAvatar`); `src/components/modules/collaboration/presence-renderer.ts`; `src/components/modules/collaboration/index.ts:750-762`
- Test: `test/unit/components/modules/collaboration/presence-renderer.test.ts` (append; extend `setup`)

**Interfaces:**
- Consumes: `readAgentField` (Task 21), i18n key `presence.agentFor` (Task 19), `capPresenceName`.
- Produces:
  - `AvatarIdentity.isAgent?: boolean`, which writes `data-blok-presence-agent` on the face.
  - `PresenceRendererOptions` changes: `translate?: (key: string, vars?: Record<string, string>) => string` (widened, so existing callers still type-check) and the new `resolvePersonName?: (userId: string) => string | null`.
  - A peer whose `agent` field passes the gate gets its caret flag and face labelled `translate('presence.agentFor', { agent, person })`. `person` is `onBehalfOfName`, else `resolvePersonName(onBehalfOf)`, else the label is the agent name alone. Without `translate`, the label is the agent name alone, because a label in the wrong language is worse.
  - The face hint keeps going through `onHover` (`presence-avatars.ts:116`), so the hint-delay law holds.

- [ ] **Step 1: Write the failing tests**

In `presence-renderer.test.ts`, widen `setup`'s options type to:
```ts
    translate?: (key: string, vars?: Record<string, string>) => string;
    isLocalAnonymous?: () => boolean;
    resolvePersonName?: (userId: string) => string | null;
    resolveAgentInput?: (blockId: string, field: string) => number | null;
```
Pass the two new options through to `createPresenceRenderer`. `resolveAgentInput` is used in Task 24, and passing an `undefined` option is harmless before then. Append:
```ts
describe('presence — MCP agent participants (test 21)', () => {
  const agentFor = (key: string, vars?: Record<string, string>): string =>
    (key === 'presence.agentFor' ? `${vars?.agent} for ${vars?.person}` : key);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 10, top: 0, height: 18, right: 10, bottom: 18, width: 0, x: 10, y: 0, toJSON: () => ({}),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mcpPeer = (agent: unknown): PresenceState =>
    peer(9, { user: { name: 'Claude' }, caret: caretAt('block-1'), agent });

  it('labels the caret "<agent> for <onBehalfOfName>" and marks the face', () => {
    const harness = setup({ translate: agentFor });

    harness.renderer.render([mcpPeer({ via: 'mcp', onBehalfOf: 'u1', onBehalfOfName: 'Ann' })], 1);

    const holder = harness.holderOf('block-1');

    expect(holder.querySelector('[data-blok-presence-caret-label]')?.getAttribute('data-blok-presence-caret-label')).toBe('Claude for Ann');
    expect(harness.host.querySelector('[data-blok-presence-face][data-blok-presence-agent]')).not.toBeNull();
  });

  it('falls back to the participant row by id, then to the agent name alone', () => {
    const byRow = setup({ translate: agentFor, resolvePersonName: (id) => (id === 'u1' ? 'Bob' : null) });

    byRow.renderer.render([mcpPeer({ via: 'mcp', onBehalfOf: 'u1' })], 1);
    expect(byRow.holderOf('block-1').querySelector('[data-blok-presence-caret-label]')?.getAttribute('data-blok-presence-caret-label')).toBe('Claude for Bob');

    const alone = setup({ translate: agentFor, resolvePersonName: () => null });

    alone.renderer.render([mcpPeer({ via: 'mcp', onBehalfOf: 'u2' })], 1);
    expect(alone.holderOf('block-1').querySelector('[data-blok-presence-caret-label]')?.getAttribute('data-blok-presence-caret-label')).toBe('Claude');
  });

  it('a malformed agent field draws a plain participant', () => {
    const harness = setup({ translate: agentFor });

    harness.renderer.render([mcpPeer({ via: 5, onBehalfOf: 'u1' })], 1);

    expect(harness.host.querySelector('[data-blok-presence-agent]')).toBeNull();
    expect(harness.holderOf('block-1').querySelector('[data-blok-presence-caret-label]')?.getAttribute('data-blok-presence-caret-label')).toBe('Claude');
  });
});
```
If the caret flag attribute holds the name somewhere other than `data-blok-presence-caret-label`, read `LABEL_ATTR` in `presence-carets.ts:61` and use that.

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/collaboration/presence-renderer.test.ts -t "MCP agent"`
Expected: FAIL. The label is 'Claude' and no face has the agent attribute.

- [ ] **Step 3: Implement**

`presence-avatars.ts`:
- Add to `AvatarIdentity`: `/** An agent, not a person: the face is drawn as a rounded square. */ isAgent?: boolean;`
- Add the constant `const AGENT_ATTR = 'data-blok-presence-agent';` next to `GLYPH_ATTR`.
- In `buildAvatar`, after the colour line: `if (peer.isAgent === true) { avatar.setAttribute(AGENT_ATTR, ''); }`

`presence-renderer.ts`:
- `import { readAgentField, type RemoteAgent } from './remote-agents';`
- In `PresenceRendererOptions`, change `translate?: (key: string) => string;` to `translate?: (key: string, vars?: Record<string, string>) => string;` and add:
  ```ts
  /** The display name of the participant with this verified user id, or null. */
  resolvePersonName?: (userId: string) => string | null;
  ```
- Add `agent: RemoteAgent | null; isAgent: boolean;` to `DrawablePeer`. In `readPeer`, add `agent: readAgentField(entry.state.agent),` and `isAgent: false,`. Set `isAgent` from `agent` in the next step, so a malformed field stays a person.
- Add after `nameTheNameless`:
  ```ts
  /**
   * Name an MCP agent "<agent> for <person>". The person comes from the
   * field's own name, else the participant row with that verified id.
   * @param peers - peers after the anonymous pass
   * @param options - the label seam and the person lookup
   */
  const labelAgents = (
    peers: DrawablePeer[],
    options: Pick<PresenceRendererOptions, 'translate' | 'resolvePersonName'>
  ): DrawablePeer[] => peers.map((peer) => {
    if (peer.agent === null) {
      return peer;
    }

    const person = peer.agent.onBehalfOfName ?? options.resolvePersonName?.(peer.agent.onBehalfOf) ?? null;
    const name = person === null || options.translate === undefined || peer.name === ''
      ? peer.name
      : options.translate('presence.agentFor', { agent: peer.name, person });

    return { ...peer, name, isAgent: true };
  });
  ```
- In `render`, wrap the existing pipeline: `const peers = labelAgents(nameTheNameless(...), options);`.

`collaboration/index.ts`, inside the `createPresenceRenderer({ ... })` call at lines 750–762:
- Change `translate: (key) => this.Blok.I18n.t(key),` to `translate: (key, vars) => this.Blok.I18n.t(key, vars),`.
- Add `resolvePersonName: (userId) => this.personNameFor(userId),`.
Add the private method:
```ts
  /**
   * A verified participant's display name, for "<agent> for <person>".
   * @param userId - a verified actor id from the identities frame
   */
  private personNameFor(userId: string): string | null {
    const states = this.Blok.YjsManager.getAwarenessStates();

    for (const [clientId, actorId] of this.identities) {
      const user = actorId === userId ? states.get(clientId)?.user : undefined;
      const name = typeof user === 'object' && user !== null ? capPresenceName((user as Record<string, unknown>).name) : '';

      if (name !== '') {
        return name;
      }
    }

    return null;
  }
```
Import `capPresenceName` from `./presence`. `this.identities` is `Map<number, string>` (`collaboration/index.ts:378`).

- [ ] **Step 4: Run tests to verify they pass**

Run, one per call: `presence-renderer.test.ts`, `presence-avatars.test.ts`, `presence-css.test.ts`, `test/unit/architecture/hint-delay-law.test.ts`. All PASS.

- [ ] **Step 5: Lint and commit**

```bash
yarn eslint src/components/modules/collaboration/presence-avatars.ts src/components/modules/collaboration/presence-renderer.ts src/components/modules/collaboration/index.ts test/unit/components/modules/collaboration/presence-renderer.test.ts
git add src/components/modules/collaboration/presence-avatars.ts src/components/modules/collaboration/presence-renderer.ts src/components/modules/collaboration/index.ts test/unit/components/modules/collaboration/presence-renderer.test.ts
git diff --cached --name-only
git commit -m "feat(agent): draw MCP agents as agents, named for the person they act for" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 24: Draw peers' `agentCursor` on separate layers (spec test 26, Review Focus 2)

**Files:**
- Modify: `src/components/modules/collaboration/presence-renderer.ts`, `src/components/modules/collaboration/presence.ts` (`Presence` interface `:73-80`, `notify` `:423-433`), `src/components/modules/collaboration/index.ts:750-783`
- Test: `test/unit/components/modules/collaboration/presence-renderer.test.ts` (append), `test/unit/components/modules/collaboration/presence.test.ts` (append)

**Interfaces:**
- Consumes: `readAgentCursor` (Task 21), `placeAgent` (Task 14), `createAgentMarkerLayer` (Task 15), `createCaretLayer`, `agentColorFor`, `AgentAPI.inputIndexFor` (Task 16).
- Produces: the new option `resolveAgentInput?: (blockId: string, field: string) => number | null`.
  - Each selected peer's `agentCursor` is drawn on an agent-only caret layer or an agent-only marker layer, keyed by that peer's client id.
  - The human's own caret stays on the existing layer. Keeping the layers apart is the whole point: the caret layer's ledger is keyed by client id (`presence-carets.ts:157`), so one layer would replace the human's caret with their agent's.
  - Label: an MCP agent uses its composed name (Task 23). A human's in-app agent uses `translate('presence.agentFor', { agent: cursor.name, person: <human name> })`, or `cursor.name` with no translator.
  - Colour: `cursor.color ?? agentColorFor(cursor.actorId)`, the same rule the publishing browser uses.
  - This client's own `agentCursor` is never drawn here: `selectDrawableStates` drops the local client (`presence.ts:232-260`).
  - `Presence.redraw(): void` redraws from the current awareness states, coalesced to one render per microtask. The collaboration module calls it when a REMOTE `'add'` lands.
    - Why: awareness and document frames travel on separate schedules (`collaboration/index.ts:769-771`). An `agentCursor` can name a block this browser does not have yet. Then `resolveHolder` returns null and nothing is drawn.
    - Today the module reacts only to remote `'update'` (`collaboration/index.ts:778-783`), so nothing redraws when the block arrives. After the turn's last batch, the peer would never see the marker.
    - Before adding it, confirm that no other path already redraws on a remote add: `grep -n "onBlocksChanged" src/components/modules/collaboration/*.ts`.

- [ ] **Step 1: Write the failing tests**

Append:
```ts
describe('presence — peers\' agentCursor (test 26)', () => {
  const agentFor = (key: string, vars?: Record<string, string>): string =>
    (key === 'presence.agentFor' ? `${vars?.agent} for ${vars?.person}` : key);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 10, top: 0, height: 18, right: 10, bottom: 18, width: 0, x: 10, y: 0, toJSON: () => ({}),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const humanWithAgent = (cursor: unknown): PresenceState =>
    peer(7, { user: { name: 'Ann' }, caret: caretAt('block-1'), agentCursor: cursor });

  it('a block-level cursor draws a marker, and the human caret survives', () => {
    const harness = setup({ translate: agentFor });

    harness.renderer.render([humanWithAgent({ actorId: 'bot', name: 'Bot', blockId: 'block-2' })], 1);

    expect(harness.holderOf('block-1').querySelectorAll('[data-blok-presence-caret]')).toHaveLength(1);
    expect(harness.holderOf('block-2').querySelector('[data-blok-agent-marker-label]')?.getAttribute('data-blok-agent-marker-label')).toBe('Bot for Ann');
  });

  it('a mapped cursor draws a second caret; both carets stay (Review Focus 2)', () => {
    const harness = setup({ translate: agentFor, resolveAgentInput: () => 0 });

    harness.renderer.render([humanWithAgent({ actorId: 'bot', name: 'Bot', blockId: 'block-2', field: 'text', start: 1, end: 1 })], 1);

    expect(harness.holderOf('block-1').querySelectorAll('[data-blok-presence-caret]')).toHaveLength(1);
    expect(harness.holderOf('block-2').querySelectorAll('[data-blok-presence-caret]')).toHaveLength(1);
  });

  it('a bad offset falls back to a marker; a bad actorId draws nothing', () => {
    const harness = setup({ translate: agentFor, resolveAgentInput: () => 0 });

    harness.renderer.render([humanWithAgent({ actorId: 'bot', name: 'Bot', blockId: 'block-2', field: 'text', start: -1, end: 1 })], 1);
    expect(harness.holderOf('block-2').querySelector('[data-blok-agent-marker]')).not.toBeNull();

    harness.renderer.render([humanWithAgent({ actorId: '', name: 'Bot', blockId: 'block-2' })], 1);
    expect(harness.host.querySelector('[data-blok-agent-marker]')).toBeNull();
  });

  it('this client\'s own agentCursor is not drawn (test 25)', () => {
    const harness = setup({ translate: agentFor });

    harness.renderer.render([peer(1, { user: { name: 'Me' }, agentCursor: { actorId: 'bot', name: 'Bot', blockId: 'block-2' } })], 1);

    expect(harness.host.querySelector('[data-blok-agent-marker]')).toBeNull();
  });

  it('hidden controls draw no agent', () => {
    const harness = setup({ translate: agentFor });

    harness.hidden.value = true;
    harness.renderer.render([humanWithAgent({ actorId: 'bot', name: 'Bot', blockId: 'block-2' })], 1);

    expect(harness.host.querySelector('[data-blok-agent-marker]')).toBeNull();
  });

  it('clear() removes agent layers too', () => {
    const harness = setup({ translate: agentFor });

    harness.renderer.render([humanWithAgent({ actorId: 'bot', name: 'Bot', blockId: 'block-2' })], 1);
    harness.renderer.clear();

    expect(harness.host.querySelector('[data-blok-agent-marker]')).toBeNull();
  });
});
```

Append to `presence.test.ts`:
```ts
import { createPresence, type PresenceSeam } from '../../../../../src/components/modules/collaboration/presence';
import type { PresenceRenderer } from '../../../../../src/components/modules/collaboration/presence-renderer';

describe('presence — redraw for late blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const harness = () => {
    const seam: PresenceSeam = {
      setAwarenessField: vi.fn(),
      getAwarenessStates: () => new Map([[5, { user: { name: 'Ann' }, agentCursor: { actorId: 'bot', name: 'Bot', blockId: 'late' } }]]),
      onAwarenessChange: vi.fn(() => () => undefined),
      onAwarenessUpdate: vi.fn(() => () => undefined),
    };
    const renderer: PresenceRenderer = { render: vi.fn(), reposition: vi.fn(), remoteEdit: vi.fn(), clear: vi.fn() };

    return { presence: createPresence({ yjs: seam, currentBlockId: () => null, renderer }), renderer };
  };

  it('redraw() re-renders the current states once per burst', async () => {
    const { presence, renderer } = harness();

    presence.start();
    vi.mocked(renderer.render).mockClear();
    presence.redraw();
    presence.redraw();
    presence.redraw();
    await Promise.resolve();

    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(vi.mocked(renderer.render).mock.calls[0][0][0]).toMatchObject({ clientId: 5 });
    presence.stop();
  });

  it('redraw() does nothing when presence is stopped', async () => {
    const { presence, renderer } = harness();

    presence.redraw();
    await Promise.resolve();

    expect(renderer.render).not.toHaveBeenCalled();
  });
});
```
If `presence.test.ts` already imports these names, reuse its imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/collaboration/presence-renderer.test.ts -t "agentCursor"`
Expected: FAIL. No marker is drawn.

- [ ] **Step 3: Implement**

`presence-renderer.ts`:
- Imports:
  ```ts
  import { createAgentMarkerLayer, type AgentMarker } from './agent-marker-layer';
  import { placeAgent } from './agent-placement';
  import { agentColorFor } from './presence';   // add to the existing import from './presence'
  import { readAgentCursor } from './remote-agents';   // add to the existing import from './remote-agents'
  import type { CaretPeer } from './presence-carets';
  ```
- Option:
  ```ts
  /** Which input of a block edits a data field, for drawing peers' agents. Omit: block level only. */
  resolveAgentInput?: (blockId: string, field: string) => number | null;
  ```
- In `createPresenceRenderer`, beside `carets` and `avatars`:
  ```ts
  // Separate from `carets`: that layer is keyed by client id, and a person and
  // their in-app agent share one, so one layer would let the agent's caret
  // replace the person's.
  const agentCarets: CaretLayer = createCaretLayer({
    resolveHolder: options.resolveHolder,
    resolveInputs: options.resolveInputs,
    restAfterMs: options.restAfterMs,
  });
  const agentMarkers = createAgentMarkerLayer({ resolveHolder: options.resolveHolder });
  ```
- Add a draw helper inside `createPresenceRenderer`:
  ```ts
  const drawAgents = (selected: DrawableState[], peers: DrawablePeer[]): void => {
    const caretPeers: CaretPeer[] = [];
    const markers: AgentMarker[] = [];

    selected.forEach((entry, index) => {
      const cursor = readAgentCursor(entry.state.agentCursor);
      const owner = peers[index];

      if (cursor === null || owner === undefined) {
        return;
      }

      const name = owner.agent !== null || options.translate === undefined || owner.name === ''
        ? (owner.agent !== null ? owner.name : cursor.name)
        : options.translate('presence.agentFor', { agent: cursor.name, person: owner.name });
      const color = cursor.color ?? agentColorFor(cursor.actorId);
      const placement = placeAgent(cursor, {
        resolveInputs: options.resolveInputs,
        inputIndexFor: options.resolveAgentInput ?? ((): null => null),
      });

      if (placement.kind === 'caret') {
        caretPeers.push({ clientId: entry.clientId, name, color, caret: placement.caret });
      } else {
        markers.push({ key: entry.clientId, blockId: placement.blockId, name, color });
      }
    });

    agentCarets.render(caretPeers);
    agentMarkers.render(markers);
  };
  ```
- In `render`, keep the selected list so indexes line up with `peers` (`map` keeps order):
  ```ts
      const selected = selectDrawableStates(states, localClientId);
      const peers = labelAgents(nameTheNameless(selected.map(readPeer), localClientId, options), options);

      avatars.render(peers);
      carets.render(peers);
      drawAgents(selected, peers);
      watchReflow();
  ```
- `clear`: add `agentCarets.clear(); agentMarkers.clear();`. `reposition`: add `agentCarets.reposition();`. `remoteEdit`: add `agentCarets.remoteEdit(blockId);`. `watchReflow`'s observer and font callback: call `agentCarets.reposition()` beside `carets.reposition()`.

`collaboration/index.ts`, in the `createPresenceRenderer({ ... })` options:
```ts
      resolveAgentInput: (blockId, field) => this.Blok.AgentAPI.inputIndexFor(blockId, field),
```

`presence.ts`: add to the `Presence` interface:
```ts
  /** Redraw from the current awareness states, once per microtask burst. For blocks that arrive after the awareness that names them. */
  redraw(): void;
```
In `createPresence`, add `redrawQueued: false,` to `state`, and return:
```ts
    redraw(): void {
      if (!state.running || state.redrawQueued) {
        return;
      }

      state.redrawQueued = true;
      queueMicrotask(() => {
        state.redrawQueued = false;

        if (state.running) {
          notify();
        }
      });
    },
```
`collaboration/index.ts`, in the `onBlocksChanged` handler at lines 778–783, add beside the `'update'` branch:
```ts
      // An agentCursor (or a caret) can name a block before the block itself
      // syncs; awareness and document frames travel separately. Redraw when it lands.
      if (event.type === 'add' && event.origin === 'remote') {
        this.presence?.redraw();
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run, one per call: `presence-renderer.test.ts`, `presence-renderer.mutants.test.ts`, `presence-carets.test.ts`, `presence.test.ts`. All PASS. Then `grep -rln "createPresence\b\|Presence =" test/unit` and run any other file that builds a `Presence` stub, because the interface gained `redraw`.

- [ ] **Step 5: Lint and commit**

```bash
yarn eslint src/components/modules/collaboration/presence-renderer.ts src/components/modules/collaboration/presence.ts src/components/modules/collaboration/index.ts test/unit/components/modules/collaboration/presence-renderer.test.ts test/unit/components/modules/collaboration/presence.test.ts
git add src/components/modules/collaboration/presence-renderer.ts src/components/modules/collaboration/presence.ts src/components/modules/collaboration/index.ts test/unit/components/modules/collaboration/presence-renderer.test.ts test/unit/components/modules/collaboration/presence.test.ts
git diff --cached --name-only
git commit -m "feat(agent): draw peers' agentCursor beside, never instead of, their caret" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 25: E2E in-app turn (spec tests 13, 14, 15; also 8 and 18 with real typing)

**Files:**
- Create: `test/playwright/tests/agent/in-app-turn.spec.ts`

**Interfaces:**
- Consumes: the built bundle (`ensureBlokBundleBuilt`), `gotoTestPage`/`test`/`expect` from `helpers/shared-page.ts`, and `window.Blok`. On the test page `window.Blok` merges in `defaultBlockTools` (`test/playwright/fixtures/test.html:116-133`), which registers `header` and `list` (`src/tools/index.ts:81-84`).
- The "fake model" is a fixed list of tool calls sent through `turn.call` in the page. There is no network.
- Locators: holders by `[data-blok-id="..."]` and agent chrome by its `data-blok-*` attributes. The pulse is checked with `toHaveClass` on a located holder. No CSS class selectors.
- List data `{ text }` is assumed enough for `block.insert` of `list`. That is unverified; 01 validates it. If it is refused, read the error's `path` and add the field it names.

- [ ] **Step 1: Write the spec**

```ts
import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

declare global {
  interface Window {
    blokInstance?: Blok;
    agentTurn?: ReturnType<Blok['agent']['begin']>;
  }
}

const setup = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    document.body.append(container);

    const blok = new window.Blok({
      holder,
      user: { id: 'human' },
      data: { blocks: [
        { id: 'p1', type: 'paragraph', data: { text: 'First' } },
        { id: 'p2', type: 'paragraph', data: { text: 'Second' } },
      ] },
    });

    window.blokInstance = blok;
    await blok.isReady;
    window.agentTurn = blok.agent.begin({ agent: { id: 'assistant', name: 'Assistant' } });
  }, { holder: HOLDER_ID });
};

/** One scripted tool call, as a model would send it. */
const callTool = (page: Page, name: string, input: unknown): Promise<{ content: string; isError: boolean }> =>
  page.evaluate(async ({ toolName, toolInput }) => {
    const turn = window.agentTurn;

    if (turn === undefined) {
      throw new Error('no open turn');
    }

    return turn.call(toolName, toolInput);
  }, { toolName: name, toolInput: input });

const insert = (type: string, data: Record<string, unknown>) =>
  ({ commands: [{ name: 'block.insert', args: { type, data, position: 'end' } }] });

const createdId = (content: string): string =>
  (JSON.parse(content) as { changed: { created: string[] } }).changed.created[0];

const savedTexts = (page: Page): Promise<string[]> => page.evaluate(async () => {
  const saved = await window.blokInstance?.save();

  return (saved?.blocks ?? []).map((block) => {
    const text = block.data.text as unknown;

    return Array.isArray(text) ? text.map((segment: { text?: string }) => segment.text ?? '').join('') : String(text ?? '');
  });
});

const endTurn = (page: Page): Promise<void> => page.evaluate(() => window.agentTurn?.end());

test.describe('in-app agent turn', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await setup(page);
  });

  test('test 13: the user sees the agent work, and one Cmd+Z undoes the turn', async ({ page }) => {
    const heading = await callTool(page, 'blok_execute', insert('header', { text: 'Plan', level: 2 }));
    const list = await callTool(page, 'blok_execute', insert('list', { text: 'Step one' }));

    expect(heading.isError).toBe(false);
    expect(list.isError).toBe(false);

    const listHolder = page.locator(`[data-blok-id="${createdId(list.content)}"]`);

    await expect(listHolder.locator('[data-blok-agent-marker-label="Assistant"]')).toHaveCount(1);
    await expect(listHolder).toHaveClass(/blok-block--target/);

    await endTurn(page);
    await expect(page.locator('[data-blok-agent-marker]')).toHaveCount(0);

    await page.locator('[data-blok-id="p1"] [contenteditable="true"]').click();
    await page.keyboard.press(UNDO);

    await expect.poll(() => savedTexts(page)).toEqual(['First', 'Second']);
  });

  test('test 14 + R-U3 (test 8) + R-U6 (test 18): user typing mid-turn is its own step', async ({ page }) => {
    const first = await callTool(page, 'blok_execute', insert('paragraph', { text: 'Agent A' }));
    const agentA = createdId(first.content);
    const p2 = page.locator('[data-blok-id="p2"] [contenteditable="true"]');

    await p2.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' typed');

    await callTool(page, 'blok_execute', insert('paragraph', { text: 'Agent B' }));
    await endTurn(page);

    await p2.click();
    await page.keyboard.press(UNDO);
    await expect.poll(() => savedTexts(page)).toEqual(['First', 'Second typed', 'Agent A']);

    const focusedBlock = await page.evaluate(() => document.activeElement?.closest('[data-blok-id]')?.getAttribute('data-blok-id') ?? null);

    expect(focusedBlock).not.toBe(agentA);

    await page.keyboard.press(UNDO);
    await expect.poll(() => savedTexts(page)).toEqual(['First', 'Second', 'Agent A']);

    await page.keyboard.press(UNDO);
    await expect.poll(() => savedTexts(page)).toEqual(['First', 'Second']);
  });

  test('test 15: stop mid-turn lands no later command', async ({ page }) => {
    const first = await callTool(page, 'blok_execute', insert('paragraph', { text: 'Landed' }));
    const landedHolder = page.locator(`[data-blok-id="${createdId(first.content)}"]`);

    // The turn is visibly working before the stop.
    await expect(landedHolder.locator('[data-blok-agent-marker-label="Assistant"]')).toHaveCount(1);

    const [queued, after] = await page.evaluate(async () => {
      const turn = window.agentTurn;

      if (turn === undefined) {
        throw new Error('no open turn');
      }

      const pending = turn.call('blok_execute', { commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'Never' }, position: 'end' } }] });

      turn.stop();

      return Promise.all([pending, turn.call('blok_read', {})]);
    });

    expect(JSON.parse(queued.content).error.code).toBe('CANCELLED');
    expect(JSON.parse(after.content).error.code).toBe('CANCELLED');
    expect(await savedTexts(page)).toEqual(['First', 'Second', 'Landed']);
    await expect(page.locator('[data-blok-agent-marker], [data-blok-presence-caret]')).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run it**

Run: `yarn e2e test/playwright/tests/agent/in-app-turn.spec.ts --project=chromium-default`
Expected: PASS (3 tests).
- If test 14's first undo also removes "Agent A", R-U3 is broken in 01's merge rule. Report it with the trace. Do not edit undo code here.
- If a test reaches the 30 s hook timeout, see the repo memory note "hook timeout = load". Check that the bundle built before suspecting the test.

- [ ] **Step 3: Prove the pulse assertion bites**

Temporarily comment out the `pulse(...)` call in `agent-presence.ts`. Run `yarn e2e test/playwright/tests/agent/in-app-turn.spec.ts --project=chromium-default -g "test 13"` and expect FAIL on `toHaveClass`. Restore the call.

- [ ] **Step 4: Lint and commit**

```bash
yarn eslint test/playwright/tests/agent/in-app-turn.spec.ts
git add test/playwright/tests/agent/in-app-turn.spec.ts
git diff --cached --name-only
git commit -m "test(agent): e2e in-app turn, typing mid-turn, stop" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 26: E2E: a peer sees the in-app agent (spec test 29)

**Files:**
- Modify: `test/playwright/tests/helpers/collab.ts` (inside the `RelaySocket` constructor's `setTimeout`, around lines 213–227)
- Create: `test/playwright/tests/agent/agent-peers.spec.ts`

**Interfaces:**
- Consumes: `gotoCollabPage`, `mountCollabEditor` (`collab.ts:392`, `:411`); `window.__collabEditors`.
- Harness change: on open, a relay socket posts a single `QueryAwareness` frame `[3]` (`sync-wire.ts:16`, `:32`) to its channel. This mirrors the server, which broadcasts `QueryAwareness` to every member except the joiner (`packages/server/dotnet/Blok.Server/Collab/CollabRoom.cs:453`). Peers answer through `scheduleAwareness(true)` (`provider.ts:1203-1204`). Without it, a page that joins mid-turn would not see the agent until the next keepalive.
- The harness header (`collab.ts:37-45`) lists the missing nudge as a limitation. Update that list.

- [ ] **Step 1: Write the spec**

```ts
import { expect, test, type Page } from '@playwright/test';

import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import {
  gotoCollabPage,
  holdCollabDocFrames,
  mountCollabEditor,
  releaseCollabDocFrames,
  waitForHeldDocFramesToSettle,
} from '../helpers/collab';

const newDoc = (): string => `agent-peers-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const open = async (page: Page, doc: string, name: string, seedsEmptyRoom: boolean): Promise<void> => {
  await gotoCollabPage(page);
  await mountCollabEditor(page, { doc, name, seedsEmptyRoom });
};

const runAgentBatch = (page: Page, editorName: string): Promise<void> => page.evaluate(async (name) => {
  const editor = window.__collabEditors?.[name];

  if (editor === undefined) {
    throw new Error(`no editor ${name}`);
  }

  const turn = editor.agent.begin({ agent: { id: 'assistant', name: 'Assistant' } });

  (window as unknown as { __turn?: typeof turn }).__turn = turn;
  await turn.call('blok_execute', { commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'from agent' }, position: 'end' } }] });
}, editorName);

const endAgentTurn = (page: Page): Promise<void> => page.evaluate(() => {
  (window as unknown as { __turn?: { end(): void } }).__turn?.end();
});

test.describe('agent visible to collaboration peers', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test('test 29: a peer sees the in-app agent, and it leaves on end()', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);
    await open(pageB, doc, 'beta', false);
    await runAgentBatch(pageA, 'alpha');

    const marker = pageB.getByTestId('beta').locator('[data-blok-agent-marker-label]');

    await expect(marker).toHaveCount(1);
    await expect(marker).toHaveAttribute('data-blok-agent-marker-label', /Assistant/);

    await endAgentTurn(pageA);
    await expect(pageB.getByTestId('beta').locator('[data-blok-agent-marker]')).toHaveCount(0);
  });

  test('the marker appears when the agent\'s new block syncs after its cursor', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);
    await open(pageB, doc, 'beta', false);
    await holdCollabDocFrames(pageB);
    await runAgentBatch(pageA, 'alpha');
    await waitForHeldDocFramesToSettle(pageB);

    // The cursor arrived, but its block has not: nothing can be drawn yet.
    await expect(pageB.getByTestId('beta').locator('[data-blok-agent-marker]')).toHaveCount(0);

    await releaseCollabDocFrames(pageB);
    await expect(pageB.getByTestId('beta').locator('[data-blok-agent-marker-label]')).toHaveCount(1);
    await endAgentTurn(pageA);
  });

  test('a peer that joins mid-turn still sees the agent (QueryAwareness nudge)', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);
    await runAgentBatch(pageA, 'alpha');
    await open(pageB, doc, 'beta', false);

    await expect(pageB.getByTestId('beta').locator('[data-blok-agent-marker-label]')).toHaveCount(1, { timeout: 5000 });
    await endAgentTurn(pageA);
  });
});
```
The label reads "Assistant for alpha", because the human on page A is named `alpha` by `mountCollabEditor`. The regex allows the exact translation to vary.

- [ ] **Step 2: Run to verify the second test fails**

Run: `yarn e2e test/playwright/tests/agent/agent-peers.spec.ts --project=chromium-default`
Expected: the first two tests PASS (Task 24 already added the redraw). The mid-turn join test FAILS on the 5 s count, because page A never re-sends its awareness to the late joiner. If the mid-turn join test passes, a keepalive arrived inside 5 s. Note that, and keep the nudge anyway, because it models the server.

- [ ] **Step 3: Add the nudge to the relay**

In `collab.ts`, inside the `setTimeout` in the `RelaySocket` constructor, right after `this.onopen?.({});`:
```ts
          // The room asks every OTHER member to re-announce when someone joins
          // (CollabRoom.cs:453). A BroadcastChannel never echoes, so this reaches
          // only the peers, exactly like the server's except-joiner broadcast.
          this.channel.postMessage(new Uint8Array([3]));
```
In the header comment (lines 37–45), delete the bullet "The join-time `QueryAwareness` nudge (`CollabRoom.cs:394`)." Then change "Presence and participants therefore cannot be tested on this harness without extending it first." to "Participants (frame 107) therefore cannot be tested on this harness without extending it first."

- [ ] **Step 4: Run tests to verify they pass, then re-run every collab spec**

Run: `yarn e2e test/playwright/tests/agent/agent-peers.spec.ts --project=chromium-default`
Expected: PASS (3 tests). If the held-frames test fails on the last count, Task 24's `redraw` on remote add is missing or not wired.
The relay change alters every collab spec's traffic, so re-run each, one per call, with `--project=chromium-default`:
- `test/playwright/tests/modules/collaboration.spec.ts`
- `test/playwright/tests/modules/collaboration-rich-text.spec.ts`
- `test/playwright/tests/modules/collaboration-same-block.spec.ts`
- `test/playwright/tests/modules/collaboration-loss-verification.spec.ts`
Expected: PASS. Sample a red one twice before blaming the nudge (repo memory: flaky collab specs).

- [ ] **Step 5: Lint and commit**

```bash
yarn eslint test/playwright/tests/agent/agent-peers.spec.ts test/playwright/tests/helpers/collab.ts
git add test/playwright/tests/agent/agent-peers.spec.ts test/playwright/tests/helpers/collab.ts
git diff --cached --name-only
git commit -m "test(agent): peers see the in-app agent; relay sends the join-time QueryAwareness" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Checkpoint 3

- [ ] Unit, one per call: `agent-placement.test.ts`, `agent-marker-layer.test.ts`, `remote-agents.test.ts`, `participants.test.ts`, `presence-renderer.test.ts`, `presence-renderer.mutants.test.ts`, `presence-avatars.test.ts`, `presence-css.test.ts`, `presence-carets.test.ts`, `presence.test.ts`, `agent-presence.test.ts`, `agent.test.ts`, `agent.integration.test.ts`, `hint-delay-law.test.ts`, `published-types-no-src-refs.test.ts`. All PASS.
- [ ] Referencing tests: `grep -rln "createPresenceRenderer\|buildParticipants\|OPAQUE_TAGS\|CollaborationParticipant" test/unit` and run each hit. All PASS.
- [ ] E2E: `in-app-turn.spec.ts` and `agent-peers.spec.ts`, `--project=chromium-default`. PASS.
- [ ] `NODE_OPTIONS=--max-old-space-size=8192 yarn tsc --noEmit`: no new errors.
- [ ] Runtime check with the `verify` skill on the built bundle: open the test page, run one turn, and look at the marker and caret at DPR 2 in light and dark. Then set `dir="rtl"` on the holder and check the flag sits at the inline start.
- [ ] `git pull --rebase && git push`. `git status` says "up to date with 'origin/main'".
- [ ] Tell plan 04's executor: browsers draw `agent` and `agentCursor` on `main`.

# Phase 4 — Adapters, docs, release note

### Task 27: Adapter Blok-instance law (spec test 12)

**Files:**
- Create: `test/unit/architecture/adapter-blok-instance-law.test.ts`

**Interfaces:**
- Consumes the published adapter types as text:
  - `packages/react/types/index.d.ts:6` (import), `:74`, `:163-165`.
  - `packages/vue/types/index.d.ts:2-16` (import), `:78-81`, `:124`.
  - `packages/angular/src/blok-editor.component.ts:26-40` (import), `:140`, `:458`.
- Produces the law 05 relies on (06 answer 05-Q5). This is a guard: it passes on first run, and Step 3 proves it bites.

- [ ] **Step 1: Write the law**

```ts
/**
 * Adapter law (03 §6 item 12, 06 05-Q5): React, Vue and Angular hand the host
 * the CORE `Blok` type for the live instance. That is why `editor.agent`, and
 * every later API namespace, reaches adapter users with no adapter code. An
 * adapter that narrowed the instance to a type of its own would drop it.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const read = (relative: string): string => readFileSync(join(REPO_ROOT, relative), 'utf-8');

/** `import type { ..., Blok, ... } from '@bloklabs/core';`, on one line or many. */
const importsCoreBlok = (source: string): boolean =>
  /import type \{[^}]*\bBlok\b[^}]*\} from '@bloklabs\/core';/.test(source);

describe('adapter Blok instance law', () => {
  it('the core API carries agent, and Blok merges the API', () => {
    const core = read('types/index.d.ts');

    expect(core).toMatch(/export interface API \{[\s\S]*?\n {2}agent: Agent;/);
    expect(core).toMatch(/export interface Blok extends Omit<API,/);
  });

  it('React publishes the core Blok for the ref and the editor', () => {
    const types = read('packages/react/types/index.d.ts');

    expect(importsCoreBlok(types)).toBe(true);
    expect(types).toContain('React.RefAttributes<Blok | null>');
    expect(types).toContain('editor: Blok | null');
  });

  it('Vue publishes the core Blok for the exposed instance and useBlok', () => {
    const types = read('packages/vue/types/index.d.ts');

    expect(importsCoreBlok(types)).toBe(true);
    expect(types).toContain('instance: Blok | null');
    expect(types).toContain('Ref<Blok | null>');
  });

  it('Angular exposes the core Blok on instance() and (ready)', () => {
    const source = read('packages/angular/src/blok-editor.component.ts');

    expect(importsCoreBlok(source)).toBe(true);
    expect(source).toContain('computed<Blok | null>');
    expect(source).toContain('new EventEmitter<Blok>()');
  });
});
```

- [ ] **Step 2: Run it**

Run: `yarn test test/unit/architecture/adapter-blok-instance-law.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Prove it bites**

Temporarily change `instance: Blok | null` to `instance: unknown` in `packages/vue/types/index.d.ts`. Run again and see the Vue test FAIL. Revert.

- [ ] **Step 4: Commit**

```bash
yarn eslint test/unit/architecture/adapter-blok-instance-law.test.ts
git add test/unit/architecture/adapter-blok-instance-law.test.ts
git diff --cached --name-only
git commit -m "test(agent): adapters expose the core Blok instance, so editor.agent needs no adapter code" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 28: E2E through React, Vue and Angular (spec test 16)

**Files:**
- Modify: `test/playwright/fixtures/react-test.html` (inside `App`, after the `useBlocks` effect around line 68), `test/playwright/fixtures/vue-test.html` (the `onReady` arrow around line 44), `scripts/build-angular-vendor.mjs:65-98` (`APP_SOURCE`)
- Create: `test/playwright/tests/agent/agent-adapters.spec.ts`

**Interfaces:**
- Each fixture exposes its live instance as `window.__blokEditor`, read from the adapter's own public surface:
  - React: the `useBlok` return value.
  - Vue: `editorRef.value.instance`.
  - Angular: the `(ready)` payload.
- `test/playwright/fixtures/vendor/` is gitignored (`.gitignore:34`). Commit the script change only, and rebuild locally.

- [ ] **Step 1: Write the spec**

```ts
import { expect, test } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';

declare global {
  interface Window {
    __blokEditor?: Blok | null;
  }
}

const FIXTURES = [
  { name: 'react', url: 'http://localhost:4444/test/playwright/fixtures/react-test.html', container: 'editor-container' },
  { name: 'vue', url: 'http://localhost:4444/test/playwright/fixtures/vue-test.html', container: 'editor-container' },
  { name: 'angular', url: 'http://localhost:4444/test/playwright/fixtures/angular-test.html', container: 'editor-host' },
] as const;

test.describe('editor.agent through the framework adapters', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  for (const fixture of FIXTURES) {
    test(`test 16: ${fixture.name} reaches editor.agent on the instance`, async ({ page }) => {
      await page.goto(fixture.url);
      await expect(page.getByTestId('status')).toHaveText('ready');
      await page.waitForFunction(() => window.__blokEditor !== undefined && window.__blokEditor !== null);

      const createdId = await page.evaluate(async () => {
        const editor = window.__blokEditor;

        if (editor === undefined || editor === null) {
          throw new Error('no editor instance');
        }

        const turn = editor.agent.begin({ agent: { id: 'assistant', name: 'Assistant' } });

        (window as unknown as { __turn?: typeof turn }).__turn = turn;

        const result = await turn.call('blok_execute', {
          commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'from agent' }, position: 'end' } }],
        });

        return (JSON.parse(result.content) as { changed: { created: string[] } }).changed.created[0];
      });
      const host = page.getByTestId(fixture.container);

      await expect(host.locator(`[data-blok-id="${createdId}"] [data-blok-agent-marker-label="Assistant"]`)).toHaveCount(1);

      await page.evaluate(() => (window as unknown as { __turn?: { end(): void } }).__turn?.end());
      await expect(host.getByText('from agent')).toBeVisible();

      await page.evaluate(() => window.__blokEditor?.history.undo());
      await expect(host.getByText('from agent')).toHaveCount(0);
    });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn e2e test/playwright/tests/agent/agent-adapters.spec.ts --project=chromium-default`
Expected: FAIL in all three, timing out in `waitForFunction`, because no fixture sets `window.__blokEditor` yet.

- [ ] **Step 3: Expose the instance in each fixture**

`react-test.html`, inside `App`, after the effect that sets `window.__blocksApi`:
```js
      React.useEffect(() => {
        window.__blokEditor = editor;
      }, [editor]);
```
`vue-test.html`: replace `const onReady = () => { status.value = 'ready'; };` with:
```js
        const onReady = () => {
          status.value = 'ready';
          window.__blokEditor = editorRef.value?.instance ?? null;
        };
```
`scripts/build-angular-vendor.mjs`, in `APP_SOURCE`:
- Change `(ready)="onReady()"` to `(ready)="onReady($event)"`.
- Change `onReady() { this.status = 'ready'; }` to:
```ts
  onReady(editor) {
    this.status = 'ready';
    (globalThis as unknown as { __blokEditor?: unknown }).__blokEditor = editor;
  }
```
Then run `node scripts/build-angular-vendor.mjs`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn e2e test/playwright/tests/agent/agent-adapters.spec.ts --project=chromium-default`
Expected: PASS (3 tests).
Then run the existing adapter specs, one per call, to show the fixture edits broke nothing: `react-adapter.spec.ts`, `vue-adapter.spec.ts` and `angular-adapter.spec.ts` under `test/playwright/tests/`, each with `--project=chromium-default`. All PASS.

- [ ] **Step 5: Lint and commit**

```bash
yarn eslint test/playwright/tests/agent/agent-adapters.spec.ts scripts/build-angular-vendor.mjs
git add test/playwright/tests/agent/agent-adapters.spec.ts test/playwright/fixtures/react-test.html test/playwright/fixtures/vue-test.html scripts/build-angular-vendor.mjs
git diff --cached --name-only
git commit -m "test(agent): editor.agent through React, Vue and Angular instances" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 29: Agent API reference docs

**Files:**
- Modify: `docs/src/components/api/api-data.ts` (new section after `id: "view-state-api"`, near line 3172), `docs/src/components/api/api-data.test.ts:85-112` (expected order), `docs/src/components/api/api-nav.ts:8` (the `extending` group) and its title map (near line 52), `docs/src/components/api/docs-hub-summaries.ts` (en near line 22, ru near line 97), `docs/src/i18n/en.json` (nav label near line 94, section near line 1002), `docs/src/i18n/ru.json` (same keys), `docs/src/seo/lastmod-ledger.json` (regenerated)

**Interfaces:**
- Section id `agent-api`, badge `Agent`, title `Agent API`. It sits right after `view-state-api` in every list.
- Follow `docs/CLAUDE.md`, the reference-prose law:
  - Render through `<Prose>` grammar.
  - A paragraph holds at most 5 sentences or 60 words. A sentence stays under 34 words.
  - Never open a value with a list. Never join clauses with a dash.
  - `en.json` and `ru.json` keep the same block shape.
  - Where a literal in `api-data.ts` and an `en.json` value both exist, keep them identical.

- [ ] **Step 1: Make the order test fail first**

In `api-data.test.ts`, insert `"agent-api",` after `"view-state-api",` in the expected list.
Run: `cd /Users/jackuait/Packages/blok/docs && yarn test src/components/api/api-data.test.ts`
Expected: FAIL. The actual order lacks `agent-api`.

- [ ] **Step 2: Find every place view-state-api is registered**

Run: `cd /Users/jackuait/Packages/blok && grep -rn "view-state-api\|viewStateApi\|\"viewState\": \"ViewState\"" docs/src | grep -v "\.test\."`
Add the agent equivalent beside each hit:
- the nav label `"agent": "Agent"`;
- the summary;
- the group entry `'agent-api'` after `'view-state-api'` in `api-nav.ts:8`;
- the title map entry `'agent-api': 'Agent'`.
Read how `api-data.ts` derives a method's i18n key from its `name` (for example, `viewState.get(blockId, key)` → `viewStateApi.methods.viewState.get`). Use the same derivation for the method names below.

- [ ] **Step 3: Add the section**

`api-data.ts`, after the `view-state-api` section:
```ts
  {
    id: "agent-api",
    badge: "Agent",
    title: "Agent API",
    description:
      "An assistant built into your app edits the open document through `editor.agent`. Blok gives you tool definitions for your model and runs each tool call. Your app owns the model, the API keys and the chat UI.\n\nThe user sees where the agent works. The agent never moves the user's caret, selection or scroll. One Cmd+Z undoes one uninterrupted run of agent work.",
    methods: [
      {
        name: "agent.tools(options)",
        returnType: "Promise<AgentAnthropicTool[] | AgentOpenAITool[]>",
        description:
          "Tool definitions for `blok_read`, `blok_describe` and `blok_execute`. Pass them to your model as they are.\n\n- `format`: `'anthropic'` or `'openai'` (the Responses API).\n- `schema`: `'envelope'` (default) or `'full'`. `'full'` lists every command's arguments and throws `AgentToolsTooLargeError` when the result is too big.\n- `strict`: adds `strict: true` where it is safe. `blok_execute` never gets it.",
        example: `const tools = await editor.agent.tools({ format: 'anthropic' });`,
      },
      {
        name: "agent.guidance()",
        returnType: "Promise<string>",
        description:
          "Text for your system prompt. It tells the model how to address blocks, how to add Markdown and how to recover from errors.",
        example: `const system = await editor.agent.guidance();`,
      },
      {
        name: "agent.begin(options)",
        returnType: "AgentTurn",
        description:
          "Opens a turn and returns it. Only one turn can be open per editor, so a second call throws `AgentTurnOpenError`.\n\n- `agent`: `{ id, name, color? }`. The name is shown to the user. The id is saved as `lastEditedBy`.\n- `follow`: scrolls to the agent's block until the user scrolls, types or clicks. Default `false`.\n- `attributeTo`: `'user'` keeps the user's id in `lastEditedBy`.",
        example: `const tools = await editor.agent.tools({ format: 'anthropic' });
const system = await editor.agent.guidance();
const turn = editor.agent.begin({ agent: { id: 'assistant', name: 'Assistant' } });

stopButton.onclick = () => turn.stop();

try {
  // Your own model loop. For each tool_use block:
  //   const result = await turn.call(block.name, block.input);
  //   reply with { type: 'tool_result', tool_use_id: block.id,
  //                content: result.content, is_error: result.isError }
} finally {
  turn.end();
}`,
      },
      {
        name: "turn.call(name, input)",
        returnType: "Promise<AgentToolResult>",
        description:
          "Runs one tool call from your model and returns `{ content, isError }`. Send `content` back as the tool result. A model mistake comes back with `isError: true`, so the model can fix it.",
        example: `const result = await turn.call(block.name, block.input);`,
      },
      {
        name: "turn.end()",
        returnType: "void",
        description:
          "Closes the turn when your model has finished. Calls made after it return a `CANCELLED` error.",
        example: `turn.end();`,
      },
      {
        name: "turn.stop()",
        returnType: "void",
        description:
          "Closes the turn and cancels calls that have not started. Wire it to your Stop button. Work already applied stays, and the user can undo it.",
        example: `stopButton.onclick = () => turn.stop();`,
      },
      {
        name: "agent.state",
        returnType: "AgentState",
        description:
          "`{ status: 'idle' }` or `{ status: 'working', turn }`. It stays the same object until it changes, so it works with `useSyncExternalStore`.",
        example: `const state = useSyncExternalStore(editor.agent.subscribe, () => editor.agent.state);`,
      },
      {
        name: "agent.subscribe(listener)",
        returnType: "() => void",
        description:
          "Calls `listener` every time `state` changes. Returns a function that unsubscribes.",
        example: `const unsubscribe = editor.agent.subscribe(() => render(editor.agent.state));`,
      },
    ],
  },
```
Add the same texts under the derived keys in `en.json`, beside `viewStateApi` (`title`, `badge`, `description`, and one `description` per method).
Add these texts in `ru.json`, with the same block shape:
- description: "Ассистент, встроенный в ваше приложение, редактирует открытый документ через `editor.agent`. Blok даёт описания инструментов для вашей модели и выполняет каждый вызов инструмента. Модель, ключи API и чат остаются в вашем приложении.\n\nПользователь видит, где работает агент. Агент никогда не двигает курсор, выделение или прокрутку пользователя. Одно нажатие Cmd+Z отменяет один непрерывный отрезок работы агента."
- tools: "Описания инструментов `blok_read`, `blok_describe` и `blok_execute`. Передайте их модели как есть.\n\n- `format`: `'anthropic'` или `'openai'` (Responses API).\n- `schema`: `'envelope'` (по умолчанию) или `'full'`. `'full'` перечисляет аргументы каждой команды и бросает `AgentToolsTooLargeError`, если результат слишком большой.\n- `strict`: добавляет `strict: true` там, где это безопасно. `blok_execute` его никогда не получает."
- guidance: "Текст для системного промпта. Он объясняет модели, как обращаться к блокам, как добавлять Markdown и как исправлять ошибки."
- begin: "Открывает ход и возвращает его. В одном редакторе может быть открыт только один ход, поэтому второй вызов бросает `AgentTurnOpenError`.\n\n- `agent`: `{ id, name, color? }`. Имя видит пользователь. Идентификатор сохраняется в `lastEditedBy`.\n- `follow`: прокручивает к блоку агента, пока пользователь не прокрутит, не начнёт печатать или не кликнет. По умолчанию `false`.\n- `attributeTo`: `'user'` оставляет в `lastEditedBy` идентификатор пользователя."
- call: "Выполняет один вызов инструмента от модели и возвращает `{ content, isError }`. Отправьте `content` обратно как результат инструмента. Ошибка модели приходит с `isError: true`, чтобы модель могла её исправить."
- end: "Закрывает ход, когда модель закончила. Вызовы после этого возвращают ошибку `CANCELLED`."
- stop: "Закрывает ход и отменяет вызовы, которые ещё не начались. Подключите его к кнопке «Стоп». Уже применённые изменения остаются, и пользователь может их отменить."
- state: "`{ status: 'idle' }` или `{ status: 'working', turn }`. Это тот же объект, пока состояние не изменится, поэтому он работает с `useSyncExternalStore`."
- subscribe: "Вызывает `listener` при каждом изменении `state`. Возвращает функцию отписки."
- Hub summary: en "Let an assistant in your app edit the open document, visibly and undoably."; ru "Ассистент в вашем приложении редактирует открытый документ так, что пользователь видит и может отменить его работу."

- [ ] **Step 4: Update the ledger and run the docs tests**

```bash
cd /Users/jackuait/Packages/blok && node docs/scripts/update-lastmod-ledger.mjs
```
Then, one per call, from `/Users/jackuait/Packages/blok/docs`:
- `yarn test src/components/api/api-data.test.ts`
- `yarn test src/i18n/reference-prose.test.ts`
- `yarn test src/components/api/api-data.ru-coverage.test.ts`
- `yarn test src/i18n/ru-language-purity.test.tsx`
- `yarn test src/seo/lastmod-ledger.test.ts`
- `yarn test src/components/api/api-nav.test.ts`
All PASS. If the prose law fails, fix the sentence. Do not raise a threshold (`docs/CLAUDE.md`).

- [ ] **Step 5: Commit**

```bash
cd /Users/jackuait/Packages/blok
git add docs/src/components/api/api-data.ts docs/src/components/api/api-data.test.ts docs/src/components/api/api-nav.ts docs/src/components/api/docs-hub-summaries.ts docs/src/i18n/en.json docs/src/i18n/ru.json docs/src/seo/lastmod-ledger.json
git diff --cached --name-only
git commit -m "docs(agent): Agent API reference" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 30: Final gate and the D4 release-note list

**Files:** none new.

- [ ] **Step 1: Scoped lint over everything this plan touched**

```bash
cd /Users/jackuait/Packages/blok
BASE=$(git log --reverse --format=%H --grep="feat(agent): public types for editor.agent" | head -1)
# This plan's own commits only: peers also commit to main in between.
git log --format= --name-only --grep='(agent)' "$BASE^..HEAD" | sort -u | grep -E '\.(ts|mjs)$' | grep -v '^docs/' | xargs yarn eslint
NODE_OPTIONS=--max-old-space-size=8192 yarn tsc --noEmit
```
Expected: both exit 0.

- [ ] **Step 2: Related tests**

These are the tests the standing user rule allows: no full `yarn test` or `yarn e2e`. Note that repo `CLAUDE.md` asks for full-project `yarn lint`/`yarn test` as the final gate. The user's later standing rule overrides it. Say so in the hand-off.
- Every unit file named in Checkpoints 1–3 and Tasks 27–29, one per call.
- The referencing tests: `grep -rln "agent\b\|AgentAPI\|BlockMutationEventDetail\|CollaborationParticipant\|createPresenceRenderer" test/unit | sort -u`.
- E2E with `--project=chromium-default`: `test/playwright/tests/agent/in-app-turn.spec.ts`, `agent-peers.spec.ts`, `agent-adapters.spec.ts`.
All PASS.

- [ ] **Step 3: Measure the bundle cost (03 §4.3 is unverified)**

Run `yarn build`. Then:
- Build a baseline in a worktree, never with `git stash` on the shared trunk: `git worktree add ~/Packages/.blok-undo/agent-baseline "$BASE^"`, then `yarn install && yarn build` there.
- Compare `ls -la dist/*.mjs` in both trees.
- Remove the worktree afterwards with the CLAUDE.md worktree checks (`git worktree remove`, `git worktree prune`).
- Confirm `render-tools` lands in its own chunk: `ls dist/chunks | grep -i render`.
- Record whether the UMD/IIFE builds inline it (03 §2.8, unverified).
Report the numbers. Do not change code over them in this plan.

- [ ] **Step 4: Push**

```bash
git pull --rebase && git push && git status
```
Expected: "up to date with 'origin/main'".

- [ ] **Step 5: Hand the release-note list to the user (D4)**

Do not create a file. Paste this into the final report. The release skill moves it into `CHANGELOG.md` at release time. Entries 3–5 belong to plans 01, 02 and 04: confirm their final names before the release.

```markdown
### Features

- **In-app agent API** — `editor.agent` lets an assistant inside your app edit the open document, visibly and undoably.
  - `tools({ format })` returns tool definitions for Anthropic or OpenAI. `begin()` opens a turn, and `turn.call()` runs each tool call.
  - Users see an agent caret or block marker. One Cmd+Z undoes a run of agent work, and `stop()` cancels what has not started.
  - `BlockMutationEventDetail.agent` marks agent edits. `BlokConfig.agent.overrides` hides tools or actions from agents.
- **`API` gains `agent`** — A hand-written object typed as the full `API` interface, such as a test mock, now needs an `agent` member.
- **Agents in collaboration rooms** — Peers see each other's agents, and agents connected through MCP show as agents.
  - New awareness fields `agent` and `agentCursor`. Older clients ignore them.
  - `CollaborationParticipant.agent` marks an MCP agent in the `participants` list.
- **Tool self-description** — Tools describe their data and actions to agents.
  - New tool statics `describe` and `actionHandlers`, and new exports `buildToolManifest` and `validateAgainst`.
  - New published types `InsertSpec`, `RichTextHelpers` and `BlokCustomToolsFile`.
- **Page title and icon commands** — Agents set a document's title and icon with `doc.setTitle` and `doc.setIcon`.
  - Saved output may carry an optional top-level `page` field.
- **Blok.Server agent executor** — The NuGet package adds the `IBlokAgentExecutor` interface for a .NET backend agent.
```
Also tell the user that 01's `BREAKING` `blocks.convert()` sanitization (D5) ships in the same release. That note is 01's.

---

## Self-review

**Spec coverage (03 §6 test numbers → task):**

| Test | Task | Test | Task |
|---|---|---|---|
| 1 AgentAPI behaviour | 7, 8, 9, 10 | 16 adapters e2e | 28 |
| 2 read-only | 10 | 17 user writes elsewhere | 12 |
| 3 renderer rules | 2, 3, 4, 5 | 18 R-U6 | 25 |
| 4 attribution | 12 | 19 caret mapping + embed/br units | 14 |
| 5 presence | 16 | 20 overrides | 10 |
| 6 focus neutrality | 18 | 21 remote agent participant | 21, 22, 23 |
| 7 R-U1 | 13 | 22 published-types law | 1 (existing law re-run in 19, checkpoints) |
| 8 R-U3 | 25 | 23 cancel points | 7 (turn signal), 10 (point 1); points 2–3 are 01's tests |
| 9 R-U4 | 13 | 24 close() = end() | 7 |
| 10 parity law | 9 | 25 publish agentCursor | 20, 24 |
| 11 tool definition law | 11 | 26 drawing peers' agentCursor | 24 |
| 12 adapter law | 27 | 27 MCP output schemas | 5 |
| 13 turn e2e | 25 | 28 public tool types | 6 |
| 14 typing mid-turn e2e | 25 | 29 two-page e2e | 26 |
| 15 stop e2e | 25 | | |

Other spec items:
- Guidance (§3.1): Task 9.
- Lazy loading (§4.3): Task 9 imports, with a measurement in Task 30.
- Screen-reader summary (§3.7): Task 19.
- `follow` (§3.7): Task 18.
- `hideControls` (§3.7): Tasks 16, 24.
- Name and colour gates (§3.7, §3.10): Tasks 16, 21.
- `CollaborationParticipant.agent` (§4.1): Task 22.
- `BlokConfig.agent.overrides` (§4.1): Task 10.
- `BlockMutationEventDetail.agent` (§4.1): Task 12.
- Release-note list (§4.5): Task 30.
- Docs (06 §11, 03 item 11): Task 29.

**Deviations from the spec, each with its reason:**
- `follow` repeats the scroll part of `scrollToBlock` instead of calling it. The public call announces on every batch, which §3.7 forbids. See Task 18.
- `stop()` also announces the turn summary. Applied work stays after a stop, so a screen-reader user should hear it. See Task 19.
- Remote ids longer than 256 characters are dropped. This bounds the colour hash and comparisons. See Task 21.

**Unverified, and where it is checked:**
- 01's names are settled by the cross-plan pass (`src/components/modules/agent/editor-session.ts`: `createEditorAgentSession`, `liveContractSource`, `InternalEditorHandle = BlokModules`; options `attributeLastEditedBy`, `services`, `mergeSteps`). Gate: Task 9 Step 1 checks they landed.
- 01/02 published type names. Gate: Task 1 Step 1.
- The turn-merge lever, pinned by Tasks 13 and 25.
- 01's applier focus neutrality, pinned by Task 18.
- `BlokSchema` recursion form (`$defs`/`$ref`): the Task 4 assumption.
- OpenAI `arguments` as a JSON string: handled both ways in Task 7.
- OpenAI strict "all properties required": see Review Focus.
- MCP `outputSchema` root type: always set (Task 5).
- Whether 01's `read()` throws `AgentError`-shaped values: handled in Task 7.
- That tools and overrides do not change after boot: the contract cache in Task 16.
- UMD/IIFE chunking and bundle cost: measured in Task 30.
- Each built-in's `inputFields` order: 02's test.
