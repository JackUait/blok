# Assistant Model Adapters and Thinking Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a host run Blok's in-editor assistant on any LLM through four zero-dependency adapters, and let the end user pick a thinking level in the Ask AI bar.

**Architecture:**
- Each adapter is an `AgentModel` that translates the loop's Anthropic-shaped request into a provider's native body, and the native reply back.
- The host's `send` callback carries the body to its own backend.
- Reasoning data that must be sent back unchanged is kept in an opaque `{ type: 'provider', format, raw }` content block. `runAssistantLoop` already passes that block through untouched.
- The thinking level flows from config through `AgentRun` and the loop into `AgentModelRequest.thinking`.

**Tech Stack:** TypeScript, Vitest (unit), Playwright (e2e), the existing Popover, Vite lib build.

**Spec:** `docs/plans/2026-10-15-assistant-model-adapters-design.md`

## Global Constraints

- Zero runtime dependencies. `package.json` `dependencies` stays empty. No vendor SDK or AI SDK is imported from `src/`.
- `AgentThinkingLevel` is exactly `'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'`, in that order.
- A hand-written `model` function keeps working. `AgentModelRequest.thinking` is optional and absent when no level applies.
- The API key never reaches the page. Adapters only build bodies and parse replies. The HTTP call is the host's `send`.
- Published types live in `types/` and never import from `src/` (`test/unit/architecture/published-types-no-src-refs.test.ts`).
- Selected states are never blue. A selected row uses `IconCheck` + `--blok-text-primary` on a neutral surface.
- Hints show on hover only, after `HINT_DELAY`. No focus-triggered hint.
- Not BREAKING: the `editor.agent` surface postdates v1.16.1.
- `package.json` and `vite.config.mjs` edits are approved by the user (spec approval, 2026-10-15), but ONLY the `./agent-models` export and entry.
- Tests: write each test first and watch it fail. Run one vitest file per invocation: `npx vitest run --project=unit <file>`. Passing several paths silently runs a subset.
- Lint only changed files: `npx eslint <file> <file>` (an array, not a zsh string).
- `tsc`: `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`, with a 600000 ms timeout.
- Never run the full `yarn test` or the full e2e suite (user rule). Run related tests plus the files that reference changed symbols.
- Commit and push each green task. Commit with `git commit --only -- <paths>`, because other sessions share the index. Use `git add -f` only for files under `docs/plans/`.
- Comments: short and plain. Write one only for a non-obvious constraint.

## Review Focus

1. **A host switches adapters mid-conversation, e.g. after a follow-up.** Old `provider` blocks of another `format` must be dropped, never sent to the new provider. The turn is rebuilt from text and tool calls (Tasks 4–7, "foreign provider block" test).
2. **The model returns tool arguments that are not valid JSON** (Chat Completions and Responses send strings). The run must not throw. The tool gets `{ invalidJson }`, and the model can retry (Tasks 5–6).
3. **The provider returns an error body instead of a reply**, e.g. `{ error: { message } }` from a proxy. The run ends `failed` with that message, not with a TypeError about `undefined` (Tasks 4–7, "error body" test).
4. **The user changes the level while an answer is running.** The running answer keeps its level, and the next prompt uses the new one (Task 2 unit test, Task 11 e2e).
5. **Gemini replies with no `functionCall.id`.** The adapter invents a stable id, and the matching `functionResponse` carries the same id and name (Task 7).

---

### Task 1: Thinking level type and config reader

**Files:**
- Modify: `types/api/agent.d.ts` (add `AgentThinkingLevel`, `AgentAssistantConfig.thinking`, `AgentModelRequest.thinking`, `AgentAskOptions.thinking`)
- Create: `src/agent/thinking.ts`
- Test: `test/unit/agent/thinking.test.ts`

**Interfaces:**
- Produces:
  - `type AgentThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'`
  - `THINKING_LEVELS: readonly AgentThinkingLevel[]`
  - `isThinkingLevel(value: unknown): value is AgentThinkingLevel`
  - `readThinkingConfig(thinking: AgentAssistantConfig['thinking']): ThinkingChoice | null`, where `ThinkingChoice = { levels: AgentThinkingLevel[]; initial: AgentThinkingLevel }`

- [ ] **Step 1: Add the public types** to `types/api/agent.d.ts`.

Insert above `AgentModelRequest`:

```ts
/** How hard the model thinks. Each adapter maps it to its provider's setting. */
export type AgentThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
```

Add this to `AgentModelRequest` after `signal`:

```ts
  /** The level for this prompt. Absent when the host set no `thinking` and the caller passed none. */
  thinking?: AgentThinkingLevel;
```

Add this to `AgentAssistantConfig` after `maxSteps`:

```ts
  /** Levels the user may pick in the Ask AI bar. The picker shows only with two or more. */
  thinking?: {
    levels: AgentThinkingLevel[];
    /** Must be one of `levels`. Default: the first level. */
    default?: AgentThinkingLevel;
  };
```

Add this to `AgentAskOptions`:

```ts
  /** Thinking level for this run. Overrides the Ask AI bar's pick. */
  thinking?: AgentThinkingLevel;
```

- [ ] **Step 2: Write the failing test** `test/unit/agent/thinking.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isThinkingLevel, readThinkingConfig, THINKING_LEVELS } from '../../../src/agent/thinking';

describe('readThinkingConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when the host set no thinking', () => {
    expect(readThinkingConfig(undefined)).toBeNull();
  });

  it('starts on the first level when no default is given', () => {
    expect(readThinkingConfig({ levels: ['low', 'high'] })).toEqual({ levels: ['low', 'high'], initial: 'low' });
  });

  it('starts on the default when it is one of the levels', () => {
    expect(readThinkingConfig({ levels: ['off', 'low', 'high'], default: 'high' })).toMatchObject({ initial: 'high' });
  });

  it.each([
    [{ levels: [] }, 'at least one level'],
    [{ levels: ['low', 'turbo'] }, 'unknown level: turbo'],
    [{ levels: ['low', 'low'] }, 'twice'],
    [{ levels: ['low', 'high'], default: 'max' }, 'default must be one of'],
  ])('rejects %j', (thinking, message) => {
    expect(() => readThinkingConfig(thinking as never)).toThrow(TypeError);
    expect(() => readThinkingConfig(thinking as never)).toThrow(message);
  });

  it('keeps the six levels in order', () => {
    expect(THINKING_LEVELS).toEqual(['off', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(isThinkingLevel('xhigh')).toBe(true);
    expect(isThinkingLevel('turbo')).toBe(false);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run --project=unit test/unit/agent/thinking.test.ts`
Expected: FAIL, `Cannot find module '../../../src/agent/thinking'`.

- [ ] **Step 4: Implement** `src/agent/thinking.ts`

```ts
import type { AgentAssistantConfig, AgentThinkingLevel } from '../../types/api';

export const THINKING_LEVELS: readonly AgentThinkingLevel[] = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];

export interface ThinkingChoice {
  levels: AgentThinkingLevel[];
  initial: AgentThinkingLevel;
}

export const isThinkingLevel = (value: unknown): value is AgentThinkingLevel =>
  typeof value === 'string' && (THINKING_LEVELS as readonly string[]).includes(value);

/**
 * Checks `agent.assistant.thinking`. Throws TypeError on a bad config.
 * Called from editor.agent.ask(), not from module prepare: core swallows prepare errors.
 * @param thinking - the host's setting
 */
export function readThinkingConfig(thinking: AgentAssistantConfig['thinking']): ThinkingChoice | null {
  if (thinking === undefined) {
    return null;
  }

  const levels: unknown = thinking.levels;

  if (!Array.isArray(levels) || levels.length === 0) {
    throw new TypeError('agent.assistant.thinking.levels needs at least one level.');
  }

  const unknown = levels.find((level: unknown) => !isThinkingLevel(level));

  if (levels.some((level: unknown) => !isThinkingLevel(level))) {
    throw new TypeError(`agent.assistant.thinking.levels has an unknown level: ${String(unknown)}. Use ${THINKING_LEVELS.join(', ')}.`);
  }
  if (new Set(levels).size !== levels.length) {
    throw new TypeError('agent.assistant.thinking.levels lists a level twice.');
  }

  const valid = levels.filter(isThinkingLevel);
  const initial = thinking.default ?? valid[0];

  if (!valid.includes(initial)) {
    throw new TypeError('agent.assistant.thinking.default must be one of thinking.levels.');
  }

  return { levels: valid, initial };
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run --project=unit test/unit/agent/thinking.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Run the public-types laws that read `types/api/agent.d.ts`**

Run each one separately:
- `npx vitest run --project=unit test/unit/architecture/agent-public-types.test.ts`
- `npx vitest run --project=unit test/unit/agent/render-tools-public-types.test.ts`
- `npx vitest run --project=unit test/unit/architecture/published-types-no-src-refs.test.ts`

Expected: PASS. If a law lists public agent types, add `AgentThinkingLevel` the way that law's other entries are written.

- [ ] **Step 7: Lint, commit, push**

```bash
npx eslint src/agent/thinking.ts test/unit/agent/thinking.test.ts
git add types/api/agent.d.ts src/agent/thinking.ts test/unit/agent/thinking.test.ts
git commit --only -m "feat(agent): thinking levels for the assistant config" -- types/api/agent.d.ts src/agent/thinking.ts test/unit/agent/thinking.test.ts
git fetch -q && git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main
```

---

### Task 2: Carry the level from config to every model request

**Files:**
- Modify: `src/agent/assistant-loop.ts` (option `thinking`, put on each request)
- Modify: `src/components/modules/api/agent-run.ts` (`AgentRunDeps.thinking()`, read once per answer)
- Modify: `src/components/modules/api/agent.ts:107-137` (`startRun` takes a level getter; `ask` validates and resolves)
- Test: `test/unit/agent/assistant-loop.test.ts`, `test/unit/components/modules/api/agent-ask.integration.test.ts`

**Interfaces:**
- Consumes: `readThinkingConfig`, `isThinkingLevel` (Task 1).
- Produces:
  - `AssistantLoopOptions.thinking?: AgentThinkingLevel`
  - `AgentRunDeps.thinking(): AgentThinkingLevel | undefined`
  - `AgentAPI.startRun(prompt: string, context: string, thinking: () => AgentThinkingLevel | undefined): AgentRun`
  - `AgentAPI.thinkingChoice(): ThinkingChoice | null`. Throws TypeError on a bad config. Task 11 uses it.

- [ ] **Step 1: Write the failing loop test.** Append inside `describe('runAssistantLoop')` in `test/unit/agent/assistant-loop.test.ts`:

```ts
  it('puts the thinking level on every model request of the run, and leaves it off when none is given', async () => {
    const withLevel = scripted(
      reply([{ type: 'tool_use', id: 't1', name: 'blok_read', input: {} }], 'tool_use'),
      reply([{ type: 'text', text: 'Done.' }], 'end_turn')
    );

    await runAssistantLoop({
      model: withLevel, system: 's', tools: [], messages: [{ role: 'user', content: 'Go' }],
      call: async () => ok(), signal: new AbortController().signal, maxSteps: 5, thinking: 'high',
    });

    expect(withLevel.requests.map((request) => request.thinking)).toEqual(['high', 'high']);

    const without = scripted(reply([{ type: 'text', text: 'Hi' }], 'end_turn'));

    await runAssistantLoop({
      model: without, system: 's', tools: [], messages: [{ role: 'user', content: 'Go' }],
      call: async () => ok(), signal: new AbortController().signal, maxSteps: 5,
    });

    expect('thinking' in without.requests[0]).toBe(false);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --project=unit test/unit/agent/assistant-loop.test.ts`
Expected: FAIL. The first expectation gets `[undefined, undefined]`.

- [ ] **Step 3: Implement it in the loop.** In `src/agent/assistant-loop.ts`, add `AgentThinkingLevel` to the type import. Then add this to `AssistantLoopOptions`:

```ts
  /** Sent on every model request of this run. */
  thinking?: AgentThinkingLevel;
```

Replace the body of `ask`:

```ts
const ask = (options: AssistantLoopOptions): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> =>
  options.model({
    system: options.system,
    messages: options.messages,
    tools: options.tools,
    signal: options.signal,
    ...(options.thinking === undefined ? {} : { thinking: options.thinking }),
  }).then(
    (value) => ({ ok: true as const, value }),
    (thrown: unknown) => ({ ok: false as const, error: messageOf(thrown) })
  );
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run --project=unit test/unit/agent/assistant-loop.test.ts`
Expected: PASS (every test in the file).

- [ ] **Step 5: Write the failing integration tests.** First change `createEditor` in `test/unit/components/modules/api/agent-ask.integration.test.ts` to take the assistant's extra settings:

```ts
const createEditor = async (
  model: AgentModel | null,
  assistant: Partial<NonNullable<NonNullable<BlokConfig['agent']>['assistant']>> = {}
): Promise<TestEditor> => {
```

In that function, replace the `agent` spread line:

```ts
    ...(model === null ? {} : { agent: { assistant: { model, name: 'Writer', ...assistant } } }),
```

Then append inside `describe('editor.agent.ask')`:

```ts
  it('sends the configured default level, and an ask() option overrides it', async () => {
    const model = scripted(answer('One'), answer('Two'));
    const editor = await createEditor(model, { thinking: { levels: ['low', 'high'], default: 'high' } });

    const first = editor.agent.ask('First');

    await first.result;
    first.end();

    const second = editor.agent.ask('Second', { thinking: 'low' });

    await second.result;
    second.end();

    expect(model.requests.map((request) => request.thinking)).toEqual(['high', 'low']);
  });

  it('sends no level when the host configured none', async () => {
    const model = scripted(answer('Hi'));
    const editor = await createEditor(model);
    const run = editor.agent.ask('Hi');

    await run.result;
    run.end();

    expect('thinking' in model.requests[0]).toBe(false);
  });

  it('throws on a bad thinking config, before any model call', async () => {
    const model = scripted();
    const editor = await createEditor(model, { thinking: { levels: ['low', 'turbo' as never] } });

    expect(() => editor.agent.ask('Hi')).toThrow(TypeError);
    expect(model.requests).toHaveLength(0);
  });

  it('throws on an unknown ask() level', async () => {
    const editor = await createEditor(scripted());

    expect(() => editor.agent.ask('Hi', { thinking: 'turbo' as never })).toThrow(TypeError);
  });
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run --project=unit test/unit/components/modules/api/agent-ask.integration.test.ts`
Expected: FAIL. The level arrays come back `[undefined, undefined]`, and the bad configs don't throw.

- [ ] **Step 7: Implement it in `agent-run.ts`.** Add `AgentThinkingLevel` to the type import. Add this to `AgentRunDeps`:

```ts
  /** Read once per prompt, so a run already answering keeps its level. */
  thinking(): AgentThinkingLevel | undefined;
```

In `answer()`, read the level before the async block:

```ts
    const thinking = deps.thinking();
```

Then pass it to the loop:

```ts
        const outcome = await runAssistantLoop({
          model: deps.model,
          system,
          tools,
          messages,
          call: (name, input) => deps.turn.call(name, input),
          signal: controller.signal,
          maxSteps: deps.maxSteps,
          ...(thinking === undefined ? {} : { thinking }),
        });
```

- [ ] **Step 8: Implement it in `agent.ts`.**

Import:

```ts
import type { AgentThinkingLevel } from '../../../../types/api';
import { isThinkingLevel, readThinkingConfig, type ThinkingChoice } from '../../../agent/thinking';
```

(`AgentThinkingLevel` joins the existing type import list.)

Add a public method next to `hasAssistant`:

```ts
  /** The host's thinking levels, or null. Throws TypeError on a bad config. */
  public thinkingChoice(): ThinkingChoice | null {
    return readThinkingConfig(this.config.agent?.assistant?.thinking);
  }
```

Replace `startRun` and the head of `ask`:

```ts
  /**
   * Start an assistant run with editor context captured earlier.
   * @param prompt - the user's request
   * @param context - from describeUserPlace()
   * @param thinking - the bar's current pick, read at each prompt
   */
  public startRun(prompt: string, context: string, thinking: () => AgentThinkingLevel | undefined): AgentRun {
    return this.ask(prompt, { context: false }, context, thinking);
  }

  private ask(
    prompt: string,
    options: AgentAskOptions = {},
    captured = '',
    picked: () => AgentThinkingLevel | undefined = () => undefined
  ): AgentRun {
    const assistant = this.config.agent?.assistant;

    if (typeof assistant?.model !== 'function') {
      throw new TypeError('editor.agent.ask() needs agent.assistant.model in the editor config.');
    }
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new TypeError('editor.agent.ask() needs a non-empty prompt.');
    }
    if (options.thinking !== undefined && !isThinkingLevel(options.thinking)) {
      throw new TypeError(`editor.agent.ask() got an unknown thinking level: ${String(options.thinking)}.`);
    }

    const choice = this.thinkingChoice();
    const thinking = (): AgentThinkingLevel | undefined => options.thinking ?? picked() ?? choice?.initial;
```

Add `thinking,` to the object passed to `createAgentRun` (next to `maxSteps`).

- [ ] **Step 9: Fix the one existing caller.** In `src/components/modules/assistant/index.ts` `startRun`, pass a getter that returns nothing for now. Task 11 replaces it.

```ts
      this.run = this.Blok.AgentAPI.startRun(prompt, this.context, () => undefined);
```

- [ ] **Step 10: Run each related file and watch it pass**

Run each separately:
- `npx vitest run --project=unit test/unit/components/modules/api/agent-ask.integration.test.ts`
- `npx vitest run --project=unit test/unit/agent/assistant-loop.test.ts`
- `npx vitest run --project=unit test/unit/components/modules/api/agent.test.ts`
- `npx vitest run --project=unit test/unit/components/modules/assistant/assistant.test.ts`

Expected: all PASS. Also grep for other callers: `grep -rn "startRun(" src test`. Every caller must pass three arguments.

- [ ] **Step 11: Lint, commit, push**

```bash
npx eslint src/agent/assistant-loop.ts src/components/modules/api/agent-run.ts src/components/modules/api/agent.ts src/components/modules/assistant/index.ts test/unit/agent/assistant-loop.test.ts test/unit/components/modules/api/agent-ask.integration.test.ts
git add src/agent/assistant-loop.ts src/components/modules/api/agent-run.ts src/components/modules/api/agent.ts src/components/modules/assistant/index.ts test/unit/agent/assistant-loop.test.ts test/unit/components/modules/api/agent-ask.integration.test.ts
git commit --only -m "feat(agent): send the thinking level on every assistant model request" -- src/agent/assistant-loop.ts src/components/modules/api/agent-run.ts src/components/modules/api/agent.ts src/components/modules/assistant/index.ts test/unit/agent/assistant-loop.test.ts test/unit/components/modules/api/agent-ask.integration.test.ts
git fetch -q && git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main
```

---

### Task 3: Shared adapter helpers

**Files:**
- Create: `src/agent-models/shared.ts`
- Test: `test/unit/agent-models/shared.test.ts`

**Interfaces:**
- Consumes: `AgentModelRequest`, `AgentModelMessage`, `AgentModelContentBlock`, `AgentThinkingLevel` (types).
- Produces (all exported from `shared.ts`):
  - `type Body = Record<string, unknown>`
  - `interface AdapterOptions { model: string; send(body: Body, context: SendContext): Promise<unknown>; maxTokens?: number; levels?: Partial<Record<AgentThinkingLevel, Body>> }`
  - `interface SendContext { signal: AbortSignal; model: string; thinking?: AgentThinkingLevel }`
  - `DEFAULT_MAX_TOKENS = 16_000`
  - `isRecord(value: unknown): value is Record<string, unknown>`
  - `isText(block): block is { type: 'text'; text: string }`
  - `isToolUse(block): block is { type: 'tool_use'; id: string; name: string; input: unknown }`
  - `isToolResult(block): block is { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }`
  - `blocksOf(content: AgentModelMessage['content']): AgentModelContentBlock[]`. A string becomes one text block.
  - `providerBlock(format: string, raw: unknown): AgentModelContentBlock`
  - `rawTurn(content: AgentModelMessage['content'], format: string): unknown`. Returns the raw value, or `undefined` when there is no block of that format.
  - `merge(base: Body, extra: Body): Body`. Deep-merges plain objects. Arrays and scalars are replaced.
  - `withLevel(body: Body, request: AgentModelRequest, defaults: Record<AgentThinkingLevel, Body>, options: AdapterOptions): Body`
  - `parseArguments(value: unknown): unknown`
  - `toolNames(messages: AgentModelMessage[]): Map<string, string>`. Maps each `tool_use` id to its tool name.
  - `sendContext(request: AgentModelRequest, options: AdapterOptions): SendContext`
  - `errorOf(reply: unknown, provider: string): Error | null`. Reads `{ error: { message } }` or `{ error: string }`.

- [ ] **Step 1: Write the failing test** `test/unit/agent-models/shared.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  errorOf, merge, parseArguments, providerBlock, rawTurn, toolNames, withLevel, type AdapterOptions,
} from '../../../src/agent-models/shared';
import type { AgentModelRequest } from '../../../types/api';

const options: AdapterOptions = { model: 'm', send: async () => ({}) };
const request = (thinking?: AgentModelRequest['thinking']): AgentModelRequest => ({
  system: 's', messages: [], tools: [], signal: new AbortController().signal, ...(thinking === undefined ? {} : { thinking }),
});
const defaults = {
  off: { effort: 'none' }, low: { effort: 'low' }, medium: { effort: 'medium' },
  high: { effort: 'high' }, xhigh: { effort: 'xhigh' }, max: { effort: 'max' },
};

describe('adapter helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deep-merges objects and replaces arrays and scalars', () => {
    expect(merge({ a: { b: 1, c: [1] }, d: 1 }, { a: { c: [2] }, d: 2 })).toEqual({ a: { b: 1, c: [2] }, d: 2 });
  });

  it('adds the default fragment for the level, a host override replaces it, and no level adds nothing', () => {
    expect(withLevel({ x: 1 }, request('low'), defaults, options)).toEqual({ x: 1, effort: 'low' });
    expect(withLevel({ x: 1 }, request('off'), defaults, { ...options, levels: { off: { mode: 'between' } } }))
      .toEqual({ x: 1, mode: 'between' });
    expect(withLevel({ x: 1 }, request(), defaults, options)).toEqual({ x: 1 });
  });

  it('finds the raw turn of its own format only', () => {
    const content = [{ type: 'text', text: 'hi' }, providerBlock('a', ['raw-a'])];

    expect(rawTurn(content, 'a')).toEqual(['raw-a']);
    expect(rawTurn(content, 'b')).toBeUndefined();
    expect(rawTurn('plain', 'a')).toBeUndefined();
  });

  it('parses JSON arguments and keeps broken ones for the tool to reject', () => {
    expect(parseArguments('{"a":1}')).toEqual({ a: 1 });
    expect(parseArguments('{"a":')).toEqual({ invalidJson: '{"a":' });
    expect(parseArguments({ a: 1 })).toEqual({ a: 1 });
    expect(parseArguments(undefined)).toEqual({});
  });

  it('maps tool_use ids to names across the history', () => {
    expect(toolNames([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'blok_read', input: {} }] },
    ])).toEqual(new Map([['c1', 'blok_read']]));
  });

  it('reads provider error bodies', () => {
    expect(errorOf({ error: { message: 'bad key' } }, 'OpenAI')?.message).toBe('OpenAI: bad key');
    expect(errorOf({ error: 'down' }, 'Gemini')?.message).toBe('Gemini: down');
    expect(errorOf({ output: [] }, 'OpenAI')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --project=unit test/unit/agent-models/shared.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `src/agent-models/shared.ts`

```ts
import type {
  AgentModelContentBlock,
  AgentModelMessage,
  AgentModelRequest,
  AgentThinkingLevel,
} from '../../types/api';

export type Body = Record<string, unknown>;

export interface SendContext {
  signal: AbortSignal;
  model: string;
  thinking?: AgentThinkingLevel;
}

export interface AdapterOptions {
  model: string;
  send(body: Body, context: SendContext): Promise<unknown>;
  maxTokens?: number;
  levels?: Partial<Record<AgentThinkingLevel, Body>>;
}

export const DEFAULT_MAX_TOKENS = 16_000;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isText = (block: AgentModelContentBlock): block is { type: 'text'; text: string } =>
  block.type === 'text' && typeof block.text === 'string';

export const isToolUse = (block: AgentModelContentBlock): block is { type: 'tool_use'; id: string; name: string; input: unknown } =>
  block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string';

export const isToolResult = (
  block: AgentModelContentBlock
): block is { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean } =>
  block.type === 'tool_result' && typeof block.tool_use_id === 'string' && typeof block.content === 'string';

export const blocksOf = (content: AgentModelMessage['content']): AgentModelContentBlock[] =>
  typeof content === 'string' ? [{ type: 'text', text: content }] : content;

/** Native assistant turn, kept so reasoning data goes back to the provider unchanged. */
export const providerBlock = (format: string, raw: unknown): AgentModelContentBlock => ({ type: 'provider', format, raw });

export const rawTurn = (content: AgentModelMessage['content'], format: string): unknown => {
  if (typeof content === 'string') {
    return undefined;
  }

  const block = content.find((entry) => entry.type === 'provider' && entry.format === format);

  return block === undefined ? undefined : block.raw;
};

export const merge = (base: Body, extra: Body): Body => Object.entries(extra).reduce<Body>((out, [key, value]) => {
  const current = out[key];

  return { ...out, [key]: isRecord(current) && isRecord(value) ? merge(current, value) : value };
}, { ...base });

export const withLevel = (
  body: Body,
  request: AgentModelRequest,
  defaults: Record<AgentThinkingLevel, Body>,
  options: AdapterOptions
): Body => (request.thinking === undefined
  ? body
  : merge(body, options.levels?.[request.thinking] ?? defaults[request.thinking]));

/** Chat Completions and Responses send arguments as a string that may not be valid JSON. */
export const parseArguments = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value ?? {};
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    // The tool rejects this with a schema error, so the model can retry.
    return { invalidJson: value };
  }
};

export const toolNames = (messages: AgentModelMessage[]): Map<string, string> => new Map(
  messages.flatMap((message) => blocksOf(message.content).filter(isToolUse).map((use): [string, string] => [use.id, use.name]))
);

export const sendContext = (request: AgentModelRequest, options: AdapterOptions): SendContext => ({
  signal: request.signal,
  model: options.model,
  ...(request.thinking === undefined ? {} : { thinking: request.thinking }),
});

export const errorOf = (reply: unknown, provider: string): Error | null => {
  if (!isRecord(reply) || reply.error === undefined || reply.error === null) {
    return null;
  }

  const { error } = reply;
  const message = isRecord(error) && typeof error.message === 'string' ? error.message : String(error);

  return new Error(`${provider}: ${message}`);
};
```

If `tsc` rejects `entry.format` or `block.raw` on the union, narrow with `isRecord(entry) && entry.type === 'provider' && entry.format === format` and read `raw` from that narrowed record. Never use `as any` or `!`.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run --project=unit test/unit/agent-models/shared.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, commit, push**

```bash
npx eslint src/agent-models/shared.ts test/unit/agent-models/shared.test.ts
git add src/agent-models/shared.ts test/unit/agent-models/shared.test.ts
git commit --only -m "feat(agent-models): shared adapter helpers" -- src/agent-models/shared.ts test/unit/agent-models/shared.test.ts
git fetch -q && git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main
```

---

### Task 4: `anthropicModel`

**Files:**
- Create: `src/agent-models/anthropic.ts`
- Test: `test/unit/agent-models/anthropic.test.ts`

**Interfaces:**
- Consumes: Task 3 helpers.
- Produces: `anthropicModel(options: AdapterOptions): AgentModel`

- [ ] **Step 1: Write the failing test** `test/unit/agent-models/anthropic.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { anthropicModel } from '../../../src/agent-models/anthropic';
import { runAssistantLoop } from '../../../src/agent/assistant-loop';
import type { AgentModelMessage } from '../../../types/api';

const fakeSend = (...replies: unknown[]): { send: (body: Record<string, unknown>) => Promise<unknown>; bodies: Record<string, unknown>[] } => {
  const bodies: Record<string, unknown>[] = [];

  return {
    bodies,
    send: async (body) => {
      bodies.push(structuredClone(body));

      return replies.shift();
    },
  };
};

const run = (model: ReturnType<typeof anthropicModel>, messages: AgentModelMessage[], thinking?: 'off' | 'high') => runAssistantLoop({
  model, system: 'sys', tools: [{ name: 'blok_read', description: 'd', input_schema: { type: 'object' } }],
  messages, call: async () => ({ content: '{"ok":true}', isError: false }),
  signal: new AbortController().signal, maxSteps: 5, ...(thinking === undefined ? {} : { thinking }),
});

describe('anthropicModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends thinking blocks back unchanged on the next call of the tool loop', async () => {
    const { send, bodies } = fakeSend(
      { stop_reason: 'tool_use', content: [
        { type: 'thinking', thinking: '', signature: 'sig-1' },
        { type: 'tool_use', id: 'u1', name: 'blok_read', input: {} },
      ] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] }
    );

    const result = await run(anthropicModel({ model: 'claude-opus-5-5', send }), [{ role: 'user', content: 'Go' }]);

    expect(result).toEqual({ status: 'done', reply: 'Done.' });
    expect((bodies[1].messages as AgentModelMessage[])[1]).toEqual({ role: 'assistant', content: [
      { type: 'thinking', thinking: '', signature: 'sig-1' },
      { type: 'tool_use', id: 'u1', name: 'blok_read', input: {} },
    ] });
    expect(bodies[0]).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 16000, system: 'sys' });
  });

  it('maps levels to effort, with off as low, and a host override wins', async () => {
    const end = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
    const plain = fakeSend(end, end);

    await run(anthropicModel({ model: 'm', send: plain.send }), [{ role: 'user', content: 'a' }], 'off');
    await run(anthropicModel({ model: 'm', send: plain.send }), [{ role: 'user', content: 'a' }], 'high');
    expect(plain.bodies.map((body) => body.output_config)).toEqual([{ effort: 'low' }, { effort: 'high' }]);

    const custom = fakeSend(end);

    await run(anthropicModel({ model: 'm', send: custom.send, levels: { off: { thinking: { type: 'between_tools' } } } }), [{ role: 'user', content: 'a' }], 'off');
    expect(custom.bodies[0]).toMatchObject({ thinking: { type: 'between_tools' } });
    expect(custom.bodies[0].output_config).toBeUndefined();
  });

  it('drops another adapter\'s provider blocks', async () => {
    const { send, bodies } = fakeSend({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] });

    await run(anthropicModel({ model: 'm', send }), [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: [{ type: 'text', text: 'b' }, { type: 'provider', format: 'gemini', raw: [] }] },
      { role: 'user', content: 'c' },
    ]);
    expect((bodies[0].messages as AgentModelMessage[])[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'b' }] });
  });

  it('turns an error body into a failed run', async () => {
    const { send } = fakeSend({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });

    expect(await run(anthropicModel({ model: 'm', send }), [{ role: 'user', content: 'a' }]))
      .toEqual({ status: 'failed', reply: '', error: 'Anthropic: Overloaded' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --project=unit test/unit/agent-models/anthropic.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `src/agent-models/anthropic.ts`

```ts
import type { AgentModel, AgentModelMessage, AgentModelResponse, AgentThinkingLevel } from '../../types/api';

import {
  DEFAULT_MAX_TOKENS, errorOf, isRecord, sendContext, withLevel, type AdapterOptions, type Body,
} from './shared';

// Claude Opus 5.5 rejects disabled thinking, so "off" is the lowest effort.
const LEVELS: Record<AgentThinkingLevel, Body> = {
  off: { output_config: { effort: 'low' } },
  low: { output_config: { effort: 'low' } },
  medium: { output_config: { effort: 'medium' } },
  high: { output_config: { effort: 'high' } },
  xhigh: { output_config: { effort: 'xhigh' } },
  max: { output_config: { effort: 'max' } },
};

const withoutProviderBlocks = (message: AgentModelMessage): AgentModelMessage => (typeof message.content === 'string'
  ? message
  : { ...message, content: message.content.filter((block) => block.type !== 'provider') });

const readReply = (reply: unknown): AgentModelResponse => {
  const error = errorOf(reply, 'Anthropic');

  if (error !== null) {
    throw error;
  }
  if (!isRecord(reply) || !Array.isArray(reply.content)) {
    throw new Error('Anthropic: the reply has no content.');
  }

  return { content: reply.content, stop_reason: typeof reply.stop_reason === 'string' ? reply.stop_reason : null };
};

/**
 * The Messages API. The request is already in its shape, so this mostly adds model and effort.
 * @param options - model id, the host's send, and optional level overrides
 */
export function anthropicModel(options: AdapterOptions): AgentModel {
  return async (request) => {
    const body = withLevel({
      model: options.model,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: request.system,
      messages: request.messages.map(withoutProviderBlocks),
      tools: request.tools,
    }, request, LEVELS, options);

    return readReply(await options.send(body, sendContext(request, options)));
  };
}
```

`reply.content` is `unknown[]`. If `tsc` refuses it as `AgentModelContentBlock[]`, filter it through `isRecord` with `typeof entry.type === 'string'` before returning.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run --project=unit test/unit/agent-models/anthropic.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Lint, commit, push**

```bash
npx eslint src/agent-models/anthropic.ts test/unit/agent-models/anthropic.test.ts
git add src/agent-models/anthropic.ts test/unit/agent-models/anthropic.test.ts
git commit --only -m "feat(agent-models): anthropicModel adapter" -- src/agent-models/anthropic.ts test/unit/agent-models/anthropic.test.ts
git fetch -q && git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main
```

---

### Task 5: `openaiModel` (Responses API)

**Files:**
- Create: `src/agent-models/openai.ts`
- Test: `test/unit/agent-models/openai.test.ts`

**Interfaces:**
- Consumes: Task 3 helpers.
- Produces: `openaiModel(options: AdapterOptions): AgentModel`. The provider block format is `'openai-responses'`.

- [ ] **Step 1: Write the failing test** `test/unit/agent-models/openai.test.ts`

Copy the `fakeSend` and `run` helpers from Task 4's test, with `openaiModel` in place of `anthropicModel`. Then:

```ts
describe('openaiModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'enc' };
  const commentary = { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Reading.', annotations: [] }] };
  const call = { type: 'function_call', call_id: 'call_1', name: 'blok_read', arguments: '{}' };

  it('builds a stateless Responses body', async () => {
    const { send, bodies } = fakeSend({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hi', annotations: [] }] }] });

    expect(await run(openaiModel({ model: 'gpt-5.5', send }), [{ role: 'user', content: 'Go' }])).toEqual({ status: 'done', reply: 'Hi' });
    expect(bodies[0]).toEqual({
      model: 'gpt-5.5', instructions: 'sys', store: false, max_output_tokens: 16000,
      input: [{ role: 'user', content: 'Go' }],
      tools: [{ type: 'function', name: 'blok_read', description: 'd', parameters: { type: 'object' }, strict: false }],
    });
  });

  it('replays reasoning, phase and calls unchanged, then the call output', async () => {
    const { send, bodies } = fakeSend(
      { status: 'completed', output: [reasoning, commentary, call] },
      { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.', annotations: [] }] }] }
    );

    await run(openaiModel({ model: 'm', send }), [{ role: 'user', content: 'Go' }]);
    expect(bodies[1].input).toEqual([
      { role: 'user', content: 'Go' },
      reasoning, commentary, call,
      { type: 'function_call_output', call_id: 'call_1', output: '{"ok":true}' },
    ]);
  });

  it('maps stop states: truncation, refusal, content filter', async () => {
    const truncated = fakeSend({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] });
    const refused = fakeSend({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'No.' }] }] });
    const filtered = fakeSend({ status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] });

    expect((await run(openaiModel({ model: 'm', send: truncated.send }), [{ role: 'user', content: 'a' }])).status).toBe('truncated');
    expect((await run(openaiModel({ model: 'm', send: refused.send }), [{ role: 'user', content: 'a' }])).status).toBe('refused');
    expect((await run(openaiModel({ model: 'm', send: filtered.send }), [{ role: 'user', content: 'a' }])).status).toBe('refused');
  });

  it('hands broken arguments to the tool instead of throwing', async () => {
    const { send } = fakeSend(
      { status: 'completed', output: [{ ...call, arguments: '{"a":' }] },
      { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }] }
    );
    const seen: unknown[] = [];

    await runAssistantLoop({
      model: openaiModel({ model: 'm', send }), system: 's', tools: [], messages: [{ role: 'user', content: 'a' }],
      call: async (_name, input) => {
        seen.push(input);

        return { content: '{"ok":false}', isError: true };
      },
      signal: new AbortController().signal, maxSteps: 5,
    });
    expect(seen).toEqual([{ invalidJson: '{"a":' }]);
  });

  it('maps levels to reasoning.effort, off as none', async () => {
    const end = { status: 'completed', output: [] };
    const { send, bodies } = fakeSend(end, end);

    await run(openaiModel({ model: 'm', send }), [{ role: 'user', content: 'a' }], 'off');
    await run(openaiModel({ model: 'm', send }), [{ role: 'user', content: 'a' }], 'high');
    expect(bodies.map((body) => body.reasoning)).toEqual([{ effort: 'none' }, { effort: 'high' }]);
  });

  it('rebuilds a turn that has no Responses block, e.g. after switching adapters', async () => {
    const { send, bodies } = fakeSend({ status: 'completed', output: [] });

    await run(openaiModel({ model: 'm', send }), [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: [
        { type: 'text', text: 'b' },
        { type: 'tool_use', id: 'u1', name: 'blok_read', input: { x: 1 } },
        { type: 'provider', format: 'gemini', raw: [] },
      ] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'r' }] },
    ]);
    expect(bodies[0].input).toEqual([
      { role: 'user', content: 'a' },
      { type: 'message', role: 'assistant', content: 'b' },
      { type: 'function_call', call_id: 'u1', name: 'blok_read', arguments: '{"x":1}' },
      { type: 'function_call_output', call_id: 'u1', output: 'r' },
    ]);
  });

  it('turns an error body into a failed run', async () => {
    const { send } = fakeSend({ error: { message: 'Invalid model' } });

    expect(await run(openaiModel({ model: 'm', send }), [{ role: 'user', content: 'a' }]))
      .toEqual({ status: 'failed', reply: '', error: 'OpenAI: Invalid model' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --project=unit test/unit/agent-models/openai.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `src/agent-models/openai.ts`

```ts
import type {
  AgentModel, AgentModelContentBlock, AgentModelMessage, AgentModelResponse, AgentThinkingLevel,
} from '../../types/api';

import {
  DEFAULT_MAX_TOKENS, blocksOf, errorOf, isRecord, isText, isToolResult, isToolUse, parseArguments,
  providerBlock, rawTurn, sendContext, withLevel, type AdapterOptions, type Body,
} from './shared';

const FORMAT = 'openai-responses';

const LEVELS: Record<AgentThinkingLevel, Body> = {
  off: { reasoning: { effort: 'none' } },
  low: { reasoning: { effort: 'low' } },
  medium: { reasoning: { effort: 'medium' } },
  high: { reasoning: { effort: 'high' } },
  xhigh: { reasoning: { effort: 'xhigh' } },
  max: { reasoning: { effort: 'max' } },
};

const userItems = (message: AgentModelMessage): unknown[] => (typeof message.content === 'string'
  ? [{ role: 'user', content: message.content }]
  : message.content.flatMap((block): unknown[] => {
    if (isToolResult(block)) {
      return [{ type: 'function_call_output', call_id: block.tool_use_id, output: block.content }];
    }

    return isText(block) ? [{ role: 'user', content: block.text }] : [];
  }));

// Reasoning items, `phase` and calls must go back exactly as received.
const assistantItems = (message: AgentModelMessage): unknown[] => {
  const raw = rawTurn(message.content, FORMAT);

  if (Array.isArray(raw)) {
    return raw;
  }

  return blocksOf(message.content).flatMap((block): unknown[] => {
    if (isText(block)) {
      return [{ type: 'message', role: 'assistant', content: block.text }];
    }

    return isToolUse(block)
      ? [{ type: 'function_call', call_id: block.id, name: block.name, arguments: JSON.stringify(block.input) }]
      : [];
  });
};

const readReply = (reply: unknown): AgentModelResponse => {
  const error = errorOf(reply, 'OpenAI');

  if (error !== null) {
    throw error;
  }
  if (!isRecord(reply) || !Array.isArray(reply.output)) {
    throw new Error('OpenAI: the reply has no output.');
  }

  const content: AgentModelContentBlock[] = [];
  const state = { refused: false };

  reply.output.filter(isRecord).forEach((item) => {
    if (item.type === 'function_call') {
      content.push({ type: 'tool_use', id: String(item.call_id), name: String(item.name), input: parseArguments(item.arguments) });

      return;
    }
    if (item.type !== 'message' || !Array.isArray(item.content)) {
      return;
    }
    item.content.filter(isRecord).forEach((part) => {
      if (part.type === 'output_text' && typeof part.text === 'string') {
        content.push({ type: 'text', text: part.text });
      }
      if (part.type === 'refusal') {
        state.refused = true;
      }
    });
  });
  content.push(providerBlock(FORMAT, reply.output));

  const reason = isRecord(reply.incomplete_details) ? reply.incomplete_details.reason : undefined;
  const stop = ((): string => {
    if (reason === 'max_output_tokens') {
      return 'max_tokens';
    }
    if (state.refused || reason === 'content_filter') {
      return 'refusal';
    }

    return content.some(isToolUse) ? 'tool_use' : 'end_turn';
  })();

  return { content, stop_reason: stop };
};

/**
 * The OpenAI Responses API, stateless (`store: false`).
 * @param options - model id, the host's send, and optional level overrides
 */
export function openaiModel(options: AdapterOptions): AgentModel {
  return async (request) => {
    const body = withLevel({
      model: options.model,
      instructions: request.system,
      store: false,
      max_output_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      input: request.messages.flatMap((message) => (message.role === 'user' ? userItems(message) : assistantItems(message))),
      // strict: our blok_execute schema is not closed, and leaving strict out makes OpenAI try strict mode.
      tools: request.tools.map((tool) => ({
        type: 'function', name: tool.name, description: tool.description, parameters: tool.input_schema, strict: false,
      })),
    }, request, LEVELS, options);

    return readReply(await options.send(body, sendContext(request, options)));
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run --project=unit test/unit/agent-models/openai.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Lint, commit, push**

```bash
npx eslint src/agent-models/openai.ts test/unit/agent-models/openai.test.ts
git add src/agent-models/openai.ts test/unit/agent-models/openai.test.ts
git commit --only -m "feat(agent-models): openaiModel adapter for the Responses API" -- src/agent-models/openai.ts test/unit/agent-models/openai.test.ts
git fetch -q && git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main
```

---

### Task 6: `openaiCompatibleModel` (Chat Completions)

**Files:**
- Create: `src/agent-models/openai-compatible.ts`
- Test: `test/unit/agent-models/openai-compatible.test.ts`

**Interfaces:**
- Consumes: Task 3 helpers.
- Produces: `openaiCompatibleModel(options: AdapterOptions): AgentModel`. The provider block format is `'openai-chat'`.

- [ ] **Step 1: Write the failing test** `test/unit/agent-models/openai-compatible.test.ts`

Copy the `fakeSend` and `run` helpers from Task 4's test, with `openaiCompatibleModel`. Then:

```ts
describe('openaiCompatibleModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const choice = (message: Record<string, unknown>, finish: string) => ({ choices: [{ index: 0, message, finish_reason: finish }] });
  const toolTurn = {
    role: 'assistant', content: null, reasoning_content: 'thought about it',
    tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'blok_read', arguments: '{}' } }],
  };

  it('replays DeepSeek reasoning_content on the next call, then the tool message', async () => {
    const { send, bodies } = fakeSend(choice(toolTurn, 'tool_calls'), choice({ role: 'assistant', content: 'Done.' }, 'stop'));

    expect(await run(openaiCompatibleModel({ model: 'deepseek-v4-pro', send }), [{ role: 'user', content: 'Go' }]))
      .toEqual({ status: 'done', reply: 'Done.' });
    expect(bodies[1].messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'Go' },
      toolTurn,
      { role: 'tool', tool_call_id: 'call_1', name: 'blok_read', content: '{"ok":true}' },
    ]);
    expect(bodies[0]).toMatchObject({
      model: 'deepseek-v4-pro', max_tokens: 16000,
      tools: [{ type: 'function', function: { name: 'blok_read', description: 'd', parameters: { type: 'object' } } }],
    });
    expect('tool_choice' in bodies[0]).toBe(false);
  });

  it('reads Mistral chunk-array content, keeping only text chunks', async () => {
    const { send } = fakeSend(choice({ role: 'assistant', content: [
      { type: 'thinking', thinking: [{ type: 'text', text: 'hmm' }] },
      { type: 'text', text: 'Answer.' },
    ] }, 'stop'));

    expect(await run(openaiCompatibleModel({ model: 'm', send }), [{ role: 'user', content: 'a' }]))
      .toEqual({ status: 'done', reply: 'Answer.' });
  });

  it('maps stop states: length, content filter, refusal', async () => {
    const length = fakeSend(choice({ role: 'assistant', content: 'cut' }, 'length'));
    const filter = fakeSend(choice({ role: 'assistant', content: '' }, 'content_filter'));
    const refusal = fakeSend(choice({ role: 'assistant', content: null, refusal: 'No.' }, 'stop'));

    expect((await run(openaiCompatibleModel({ model: 'm', send: length.send }), [{ role: 'user', content: 'a' }])).status).toBe('truncated');
    expect((await run(openaiCompatibleModel({ model: 'm', send: filter.send }), [{ role: 'user', content: 'a' }])).status).toBe('refused');
    expect((await run(openaiCompatibleModel({ model: 'm', send: refusal.send }), [{ role: 'user', content: 'a' }])).status).toBe('refused');
  });

  it('hands broken arguments to the tool instead of throwing', async () => {
    const broken = { ...toolTurn, tool_calls: [{ id: 'c', type: 'function', function: { name: 'blok_read', arguments: 'nope' } }] };
    const { send } = fakeSend(choice(broken, 'tool_calls'), choice({ role: 'assistant', content: 'ok' }, 'stop'));
    const seen: unknown[] = [];

    await runAssistantLoop({
      model: openaiCompatibleModel({ model: 'm', send }), system: 's', tools: [], messages: [{ role: 'user', content: 'a' }],
      call: async (_name, input) => {
        seen.push(input);

        return { content: '{"ok":false}', isError: true };
      },
      signal: new AbortController().signal, maxSteps: 5,
    });
    expect(seen).toEqual([{ invalidJson: 'nope' }]);
  });

  it('maps levels to reasoning_effort, off as none', async () => {
    const end = choice({ role: 'assistant', content: 'ok' }, 'stop');
    const { send, bodies } = fakeSend(end, end);

    await run(openaiCompatibleModel({ model: 'm', send }), [{ role: 'user', content: 'a' }], 'off');
    await run(openaiCompatibleModel({ model: 'm', send }), [{ role: 'user', content: 'a' }], 'high');
    expect(bodies.map((body) => body.reasoning_effort)).toEqual(['none', 'high']);
  });

  it('rebuilds a turn that has no Chat Completions block', async () => {
    const { send, bodies } = fakeSend(choice({ role: 'assistant', content: 'ok' }, 'stop'));

    await run(openaiCompatibleModel({ model: 'm', send }), [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: [{ type: 'text', text: 'b' }, { type: 'tool_use', id: 'u1', name: 'blok_read', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'r' }] },
    ]);
    expect((bodies[0].messages as unknown[]).slice(2)).toEqual([
      { role: 'assistant', content: 'b', tool_calls: [{ id: 'u1', type: 'function', function: { name: 'blok_read', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'u1', name: 'blok_read', content: 'r' },
    ]);
  });

  it('turns an error body into a failed run', async () => {
    const { send } = fakeSend({ error: { message: 'Rate limited' } });

    expect(await run(openaiCompatibleModel({ model: 'm', send }), [{ role: 'user', content: 'a' }]))
      .toEqual({ status: 'failed', reply: '', error: 'OpenAI-compatible: Rate limited' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --project=unit test/unit/agent-models/openai-compatible.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `src/agent-models/openai-compatible.ts`

```ts
import type {
  AgentModel, AgentModelContentBlock, AgentModelMessage, AgentModelResponse, AgentThinkingLevel,
} from '../../types/api';

import {
  DEFAULT_MAX_TOKENS, blocksOf, errorOf, isRecord, isText, isToolResult, isToolUse, parseArguments,
  providerBlock, rawTurn, sendContext, toolNames, withLevel, type AdapterOptions, type Body,
} from './shared';

const FORMAT = 'openai-chat';

const LEVELS: Record<AgentThinkingLevel, Body> = {
  off: { reasoning_effort: 'none' },
  low: { reasoning_effort: 'low' },
  medium: { reasoning_effort: 'medium' },
  high: { reasoning_effort: 'high' },
  xhigh: { reasoning_effort: 'xhigh' },
  max: { reasoning_effort: 'max' },
};

const userMessages = (message: AgentModelMessage, names: Map<string, string>): unknown[] => (typeof message.content === 'string'
  ? [{ role: 'user', content: message.content }]
  : message.content.flatMap((block): unknown[] => {
    if (isToolResult(block)) {
      // Mistral and Groq show `name` on tool messages.
      return [{ role: 'tool', tool_call_id: block.tool_use_id, name: names.get(block.tool_use_id) ?? '', content: block.content }];
    }

    return isText(block) ? [{ role: 'user', content: block.text }] : [];
  }));

// DeepSeek returns HTTP 400 when reasoning_content is missing while tools are present.
const assistantMessage = (message: AgentModelMessage): unknown => {
  const raw = rawTurn(message.content, FORMAT);

  if (isRecord(raw)) {
    return raw;
  }

  const blocks = blocksOf(message.content);
  const text = blocks.filter(isText).map((block) => block.text).join('\n');
  const calls = blocks.filter(isToolUse).map((use) => ({
    id: use.id, type: 'function', function: { name: use.name, arguments: JSON.stringify(use.input) },
  }));

  return { role: 'assistant', content: text === '' ? null : text, ...(calls.length === 0 ? {} : { tool_calls: calls }) };
};

const textOf = (content: unknown): string => {
  if (typeof content === 'string') {
    return content;
  }

  return Array.isArray(content)
    ? content.filter(isRecord).flatMap((chunk) => (chunk.type === 'text' && typeof chunk.text === 'string' ? [chunk.text] : [])).join('')
    : '';
};

const readReply = (reply: unknown): AgentModelResponse => {
  const error = errorOf(reply, 'OpenAI-compatible');

  if (error !== null) {
    throw error;
  }

  const first: unknown = isRecord(reply) && Array.isArray(reply.choices) ? reply.choices[0] : undefined;

  if (!isRecord(first) || !isRecord(first.message)) {
    throw new Error('OpenAI-compatible: the reply has no choices.');
  }

  const { message } = first;
  const text = textOf(message.content);
  const uses: AgentModelContentBlock[] = (Array.isArray(message.tool_calls) ? message.tool_calls : [])
    .filter(isRecord)
    .map((call) => {
      const fn = isRecord(call.function) ? call.function : {};

      return { type: 'tool_use', id: String(call.id), name: String(fn.name), input: parseArguments(fn.arguments) };
    });
  const content: AgentModelContentBlock[] = [
    ...(text === '' ? [] : [{ type: 'text', text }]),
    ...uses,
    providerBlock(FORMAT, message),
  ];
  const finish = first.finish_reason;
  const stop = ((): string => {
    if (finish === 'length') {
      return 'max_tokens';
    }
    if (finish === 'content_filter' || (typeof message.refusal === 'string' && message.refusal !== '')) {
      return 'refusal';
    }

    return uses.length > 0 ? 'tool_use' : 'end_turn';
  })();

  return { content, stop_reason: stop };
};

/**
 * Chat Completions, the format DeepSeek, Mistral, Groq, Ollama and OpenRouter accept.
 * Never sends tool_choice: Ollama does not support it, and the loop only needs auto.
 * @param options - model id, the host's send, and optional level overrides
 */
export function openaiCompatibleModel(options: AdapterOptions): AgentModel {
  return async (request) => {
    const names = toolNames(request.messages);
    const body = withLevel({
      model: options.model,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: [
        { role: 'system', content: request.system },
        ...request.messages.flatMap((message) => (message.role === 'user' ? userMessages(message, names) : [assistantMessage(message)])),
      ],
      tools: request.tools.map((tool) => ({
        type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
      })),
    }, request, LEVELS, options);

    return readReply(await options.send(body, sendContext(request, options)));
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run --project=unit test/unit/agent-models/openai-compatible.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Lint, commit, push**

```bash
npx eslint src/agent-models/openai-compatible.ts test/unit/agent-models/openai-compatible.test.ts
git add src/agent-models/openai-compatible.ts test/unit/agent-models/openai-compatible.test.ts
git commit --only -m "feat(agent-models): openaiCompatibleModel adapter for Chat Completions" -- src/agent-models/openai-compatible.ts test/unit/agent-models/openai-compatible.test.ts
git fetch -q && git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main
```

---

### Task 7: `geminiModel` (generateContent)

**Files:**
- Create: `src/agent-models/gemini.ts`
- Test: `test/unit/agent-models/gemini.test.ts`

**Interfaces:**
- Consumes: Task 3 helpers.
- Produces: `geminiModel(options: AdapterOptions): AgentModel`. The provider block format is `'gemini'`. The body has no `model`, because Gemini puts the model in the URL. The host reads `context.model` in `send`.

- [ ] **Step 1: Write the failing test** `test/unit/agent-models/gemini.test.ts`

Copy the `fakeSend` and `run` helpers from Task 4's test, with `geminiModel`. Then:

```ts
describe('geminiModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const candidate = (parts: unknown[], finishReason = 'STOP') => ({ candidates: [{ content: { role: 'model', parts }, finishReason }] });
  const signedCall = { functionCall: { id: 'c1', name: 'blok_read', args: {} }, thoughtSignature: 'sig' };

  it('replays model parts with their thought signature, then one user content of responses', async () => {
    const { send, bodies } = fakeSend(candidate([{ text: 'plan', thought: true }, signedCall]), candidate([{ text: 'Done.' }]));

    expect(await run(geminiModel({ model: 'gemini-3.8-flash', send }), [{ role: 'user', content: 'Go' }]))
      .toEqual({ status: 'done', reply: 'Done.' });
    expect(bodies[1].contents).toEqual([
      { role: 'user', parts: [{ text: 'Go' }] },
      { role: 'model', parts: [{ text: 'plan', thought: true }, signedCall] },
      { role: 'user', parts: [{ functionResponse: { id: 'c1', name: 'blok_read', response: { result: '{"ok":true}' } } }] },
    ]);
    expect(bodies[0]).toEqual({
      systemInstruction: { parts: [{ text: 'sys' }] },
      contents: [{ role: 'user', parts: [{ text: 'Go' }] }],
      tools: [{ functionDeclarations: [{ name: 'blok_read', description: 'd', parametersJsonSchema: { type: 'object' } }] }],
      generationConfig: { maxOutputTokens: 16000 },
    });
  });

  it('invents a stable id when the call has none, and the response carries it', async () => {
    const { send, bodies } = fakeSend(candidate([{ functionCall: { name: 'blok_read', args: {} } }]), candidate([{ text: 'ok' }]));

    await run(geminiModel({ model: 'm', send }), [{ role: 'user', content: 'Go' }]);

    const responses = (bodies[1].contents as Array<{ parts: Array<{ functionResponse?: { id: string; name: string } }> }>)[2].parts;

    expect(responses[0].functionResponse).toEqual({ id: 'call-1-0', name: 'blok_read', response: { result: '{"ok":true}' } });
  });

  it('sends a failed tool result under error', async () => {
    const { send, bodies } = fakeSend(candidate([signedCall]), candidate([{ text: 'ok' }]));

    await runAssistantLoop({
      model: geminiModel({ model: 'm', send }), system: 's', tools: [], messages: [{ role: 'user', content: 'a' }],
      call: async () => ({ content: '{"ok":false}', isError: true }), signal: new AbortController().signal, maxSteps: 5,
    });
    expect((bodies[1].contents as Array<{ parts: unknown[] }>)[2].parts[0])
      .toEqual({ functionResponse: { id: 'c1', name: 'blok_read', response: { error: '{"ok":false}' } } });
  });

  it('maps stop states: MAX_TOKENS, SAFETY, a blocked prompt', async () => {
    const max = fakeSend(candidate([{ text: 'cut' }], 'MAX_TOKENS'));
    const safety = fakeSend(candidate([], 'SAFETY'));
    const blocked = fakeSend({ promptFeedback: { blockReason: 'SAFETY' } });

    expect((await run(geminiModel({ model: 'm', send: max.send }), [{ role: 'user', content: 'a' }])).status).toBe('truncated');
    expect((await run(geminiModel({ model: 'm', send: safety.send }), [{ role: 'user', content: 'a' }])).status).toBe('refused');
    expect((await run(geminiModel({ model: 'm', send: blocked.send }), [{ role: 'user', content: 'a' }])).status).toBe('refused');
  });

  it('maps levels to thinkingLevel inside generationConfig, keeping maxOutputTokens', async () => {
    const end = candidate([{ text: 'ok' }]);
    const { send, bodies } = fakeSend(end, end);

    await run(geminiModel({ model: 'm', send }), [{ role: 'user', content: 'a' }], 'off');
    await run(geminiModel({ model: 'm', send }), [{ role: 'user', content: 'a' }], 'high');
    expect(bodies.map((body) => body.generationConfig)).toEqual([
      { maxOutputTokens: 16000, thinkingConfig: { thinkingLevel: 'MINIMAL' } },
      { maxOutputTokens: 16000, thinkingConfig: { thinkingLevel: 'HIGH' } },
    ]);
  });

  it('passes the model id to send, since Gemini puts it in the URL', async () => {
    const seen: unknown[] = [];

    await run(geminiModel({ model: 'gemini-3.8-flash', send: async (_body, context) => {
      seen.push(context.model);

      return candidate([{ text: 'ok' }]);
    } }), [{ role: 'user', content: 'a' }]);
    expect(seen).toEqual(['gemini-3.8-flash']);
  });

  it('turns an error body into a failed run', async () => {
    const { send } = fakeSend({ error: { code: 400, message: 'API key not valid' } });

    expect(await run(geminiModel({ model: 'm', send }), [{ role: 'user', content: 'a' }]))
      .toEqual({ status: 'failed', reply: '', error: 'Gemini: API key not valid' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run --project=unit test/unit/agent-models/gemini.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `src/agent-models/gemini.ts`

```ts
import type {
  AgentModel, AgentModelContentBlock, AgentModelMessage, AgentModelResponse, AgentThinkingLevel,
} from '../../types/api';

import {
  DEFAULT_MAX_TOKENS, blocksOf, errorOf, isRecord, isText, isToolResult, isToolUse,
  providerBlock, rawTurn, sendContext, toolNames, withLevel, type AdapterOptions, type Body,
} from './shared';

const FORMAT = 'gemini';

// Gemini 3+ cannot turn thinking off, and sending thinkingBudget with thinkingLevel is a 400.
const level = (value: string): Body => ({ generationConfig: { thinkingConfig: { thinkingLevel: value } } });
const LEVELS: Record<AgentThinkingLevel, Body> = {
  off: level('MINIMAL'), low: level('LOW'), medium: level('MEDIUM'), high: level('HIGH'), xhigh: level('HIGH'), max: level('HIGH'),
};

const REFUSALS = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII']);

const userContent = (message: AgentModelMessage, names: Map<string, string>): unknown => ({
  role: 'user',
  parts: blocksOf(message.content).flatMap((block): unknown[] => {
    if (isToolResult(block)) {
      const name = names.get(block.tool_use_id) ?? '';

      return [{ functionResponse: {
        id: block.tool_use_id, name, response: block.is_error === true ? { error: block.content } : { result: block.content },
      } }];
    }

    return isText(block) ? [{ text: block.text }] : [];
  }),
});

// Parts carry thoughtSignature, which Gemini 3 needs back unchanged.
const modelContent = (message: AgentModelMessage): unknown => {
  const raw = rawTurn(message.content, FORMAT);

  if (Array.isArray(raw)) {
    return { role: 'model', parts: raw };
  }

  return {
    role: 'model',
    parts: blocksOf(message.content).flatMap((block): unknown[] => {
      if (isText(block)) {
        return [{ text: block.text }];
      }

      return isToolUse(block) ? [{ functionCall: { id: block.id, name: block.name, args: block.input } }] : [];
    }),
  };
};

const readReply = (reply: unknown, step: number): AgentModelResponse => {
  const error = errorOf(reply, 'Gemini');

  if (error !== null) {
    throw error;
  }
  if (isRecord(reply) && isRecord(reply.promptFeedback) && reply.promptFeedback.blockReason !== undefined) {
    return { content: [], stop_reason: 'refusal' };
  }

  const first: unknown = isRecord(reply) && Array.isArray(reply.candidates) ? reply.candidates[0] : undefined;

  if (!isRecord(first)) {
    throw new Error('Gemini: the reply has no candidates.');
  }

  const parts = isRecord(first.content) && Array.isArray(first.content.parts) ? first.content.parts.filter(isRecord) : [];
  // A call without an id gets one, and the stored parts get it too, so the response matches.
  const stored = parts.map((part, index) => (isRecord(part.functionCall) && typeof part.functionCall.id !== 'string'
    ? { ...part, functionCall: { ...part.functionCall, id: `call-${step}-${index}` } }
    : part));
  const content: AgentModelContentBlock[] = stored.flatMap((part): AgentModelContentBlock[] => {
    if (isRecord(part.functionCall)) {
      return [{ type: 'tool_use', id: String(part.functionCall.id), name: String(part.functionCall.name), input: part.functionCall.args ?? {} }];
    }

    return part.thought !== true && typeof part.text === 'string' ? [{ type: 'text', text: part.text }] : [];
  });
  const finish = first.finishReason;

  if (finish === 'MALFORMED_FUNCTION_CALL') {
    content.push({ type: 'text', text: 'The model wrote a tool call that was not valid.' });
  }
  content.push(providerBlock(FORMAT, stored));

  const stop = ((): string => {
    if (finish === 'MAX_TOKENS') {
      return 'max_tokens';
    }
    if (typeof finish === 'string' && REFUSALS.has(finish)) {
      return 'refusal';
    }

    return content.some(isToolUse) ? 'tool_use' : 'end_turn';
  })();

  return { content, stop_reason: stop };
};

/**
 * Gemini generateContent (v1beta). The model id goes in the URL, so `send` gets it as `context.model`.
 * @param options - model id, the host's send, and optional level overrides
 */
export function geminiModel(options: AdapterOptions): AgentModel {
  return async (request) => {
    const names = toolNames(request.messages);
    const step = request.messages.filter((message) => message.role === 'assistant').length + 1;
    const body = withLevel({
      systemInstruction: { parts: [{ text: request.system }] },
      contents: request.messages.map((message) => (message.role === 'user' ? userContent(message, names) : modelContent(message))),
      tools: [{ functionDeclarations: request.tools.map((tool) => ({
        name: tool.name, description: tool.description, parametersJsonSchema: tool.input_schema,
      })) }],
      generationConfig: { maxOutputTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS },
    }, request, LEVELS, options);

    return readReply(await options.send(body, sendContext(request, options)), step);
  };
}
```

`step` is the number of the assistant turn. It makes invented ids unique across the conversation (`call-1-0`, `call-2-0`, …).

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run --project=unit test/unit/agent-models/gemini.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Lint, commit, push**

```bash
npx eslint src/agent-models/gemini.ts test/unit/agent-models/gemini.test.ts
git add src/agent-models/gemini.ts test/unit/agent-models/gemini.test.ts
git commit --only -m "feat(agent-models): geminiModel adapter for generateContent" -- src/agent-models/gemini.ts test/unit/agent-models/gemini.test.ts
git fetch -q && git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main
```

---

### Task 8: Publish `@jackuait/blok/agent-models`

**Files:**
- Create: `src/agent-models/index.ts`
- Create: `types/agent-models.d.ts`
- Modify: `vite.config.mjs:36-46` (one entry line)
- Modify: `package.json` `exports` (one key)
- Test: `test/unit/build/bundle-outputs.test.ts` (one `it`), `test/unit/agent-models/public-types.test.ts`

**Interfaces:**
- Consumes: Tasks 4–7.
- Produces: the subpath, exporting `anthropicModel`, `openaiModel`, `openaiCompatibleModel`, `geminiModel`, plus types `AgentModelAdapterOptions` and `AgentModelSendContext`.

- [ ] **Step 1: Write the failing drift test** `test/unit/agent-models/public-types.test.ts`. It pins the runtime exports to the hand-authored declaration.

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as models from '../../../src/agent-models';

describe('agent-models public surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('declares every runtime export in types/agent-models.d.ts, and nothing else', () => {
    const declared = [...readFileSync(resolve(__dirname, '../../../types/agent-models.d.ts'), 'utf8')
      .matchAll(/export declare function (\w+)/g)].map((match) => match[1]).sort();

    expect(Object.keys(models).sort()).toEqual(['anthropicModel', 'geminiModel', 'openaiCompatibleModel', 'openaiModel']);
    expect(declared).toEqual(Object.keys(models).sort());
  });
});
```

Add this to `describe` in `test/unit/build/bundle-outputs.test.ts`, after the `./preprocess` case:

```ts
  it('"./agent-models" export is wired to built files that really carry the entry point', () => {
    const agentModelsExport = packageJson.exports['./agent-models'] as Record<string, string>
    expect(agentModelsExport['import']).toBe('./dist/agent-models.mjs')
    expect(agentModelsExport['require']).toBe('./dist/agent-models.cjs')
    expect(agentModelsExport['types']).toBe('./types/agent-models.d.ts')

    for (const file of ['dist/agent-models.mjs', 'dist/agent-models.cjs', 'types/agent-models.d.ts']) {
      const built = readFileSync(resolve(repoRoot, file), 'utf-8')
      expect(built).toContain('openaiCompatibleModel')
      expect(built).toContain('geminiModel')
    }
  })
```

- [ ] **Step 2: Run them and watch them fail**

Run each separately:
- `npx vitest run --project=unit test/unit/agent-models/public-types.test.ts` (Expected: FAIL, module not found)
- `npx vitest run --project=unit test/unit/build/bundle-outputs.test.ts` (Expected: FAIL, `exports['./agent-models']` is undefined)

- [ ] **Step 3: Implement the entry** `src/agent-models/index.ts`

```ts
export { anthropicModel } from './anthropic';
export { geminiModel } from './gemini';
export { openaiModel } from './openai';
export { openaiCompatibleModel } from './openai-compatible';
```

- [ ] **Step 4: Hand-author** `types/agent-models.d.ts`. It must be self-contained, with no `../src` import.

```ts
import type { AgentModel, AgentThinkingLevel } from './api/agent';

/** What an adapter hands to your `send`. */
export interface AgentModelSendContext {
  /** Aborted when the user stops the run. Pass it to fetch. */
  signal: AbortSignal;
  /** The `model` you gave the adapter. Gemini needs it in the URL. */
  model: string;
  /** The level of this prompt, when one applies. */
  thinking?: AgentThinkingLevel;
}

export interface AgentModelAdapterOptions {
  /** Provider model id, e.g. 'gpt-5.5' or 'deepseek-v4-pro'. */
  model: string;
  /**
   * Post `body` to your backend, which adds the API key and forwards it to the provider.
   * Return the provider's JSON reply. Change the body here for provider extras (caching, store, …).
   */
  send(body: Record<string, unknown>, context: AgentModelSendContext): Promise<unknown>;
  /** Output token cap. Default 16000. */
  maxTokens?: number;
  /** Replace a level's default body fragment. It is deep-merged into the request body. */
  levels?: Partial<Record<AgentThinkingLevel, Record<string, unknown>>>;
}

/** Anthropic Messages API. `off` sends the lowest effort, since some Claude models cannot turn thinking off. */
export declare function anthropicModel(options: AgentModelAdapterOptions): AgentModel;

/** OpenAI Responses API, stateless (`store: false`). Levels set `reasoning.effort`. */
export declare function openaiModel(options: AgentModelAdapterOptions): AgentModel;

/** Chat Completions: DeepSeek, Mistral, Groq, Ollama, OpenRouter and others. Levels set `reasoning_effort`. */
export declare function openaiCompatibleModel(options: AgentModelAdapterOptions): AgentModel;

/** Gemini generateContent (v1beta). Levels set `generationConfig.thinkingConfig.thinkingLevel`. */
export declare function geminiModel(options: AgentModelAdapterOptions): AgentModel;
```

Check that `AgentModel` and `AgentThinkingLevel` resolve from `./api/agent`. Run `grep -n "export type AgentModel\b\|export type AgentThinkingLevel" types/api/agent.d.ts`. If the published-types law wants imports through `./api`, use `./api` instead.

- [ ] **Step 5: Wire the build** (approved edits, these lines only).

In `vite.config.mjs`, add this after the `preprocess` entry:

```js
          'agent-models': path.resolve(__dirname, 'src', 'agent-models', 'index.ts'),
```

In `package.json` `exports`, add this after `"./preprocess"`:

```json
    "./agent-models": {
      "types": "./types/agent-models.d.ts",
      "import": "./dist/agent-models.mjs",
      "require": "./dist/agent-models.cjs"
    },
```

- [ ] **Step 6: Build, then run the tests and watch them pass**

Run: `yarn build` (timeout 600000). Expected: `dist/agent-models.mjs` and `dist/agent-models.cjs` exist.
Then run each separately:
- `npx vitest run --project=unit test/unit/agent-models/public-types.test.ts`
- `npx vitest run --project=unit test/unit/build/bundle-outputs.test.ts`
- `npx vitest run --project=unit test/unit/architecture/published-types-no-src-refs.test.ts`

Expected: PASS. Also confirm the main bundle doesn't carry the adapters: `grep -c openaiCompatibleModel dist/blok.mjs` prints `0`.

- [ ] **Step 7: Lint, typecheck, commit, push**

```bash
npx eslint src/agent-models/index.ts test/unit/agent-models/public-types.test.ts test/unit/build/bundle-outputs.test.ts
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
git add src/agent-models/index.ts types/agent-models.d.ts vite.config.mjs package.json test/unit/agent-models/public-types.test.ts test/unit/build/bundle-outputs.test.ts
git commit --only -m "feat(agent-models): publish @jackuait/blok/agent-models" -- src/agent-models/index.ts types/agent-models.d.ts vite.config.mjs package.json test/unit/agent-models/public-types.test.ts test/unit/build/bundle-outputs.test.ts
git fetch -q && git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main
```

---

### Task 9: Toggle prototype (USER GATE)

**Files:**
- Create: a scratch prototype page, published as a private Artifact. It is not committed.

This task stops for the user. Tasks 10–11 wait for the pick.

- [ ] **Step 1: Record the real bar.** Run the playground (`yarn serve --no-server`) with a scripted `agent.assistant`. Screenshot the Ask AI bar in light and dark with `playwright-cli`. Note its row height, the send button and the font.
- [ ] **Step 2: Build one page with 3 clickable variants** of the thinking control, drawn in the real bar's look:
  - A: a text button "Thinking: Medium ▾" before Send. It opens a popover list with a checkmark on the pick.
  - B: an icon-only button (reuse an existing icon from `src/components/icons/index.ts`, no new glyph) with the same popover. The current level shows in the hover hint.
  - C: a compact segmented control inline in the row, for up to 3 levels, falling back to A when there are more.

  Each variant opens and picks for real. The selected state is gray with a checkmark, never blue.
- [ ] **Step 3: Publish the page and ask the user to pick.** Do not build Task 11's UI before the answer. Record the pick in this plan under Task 11, Step 0.

---

### Task 10: i18n keys for the toggle

**Files:**
- Modify: `src/components/i18n/locales/en.json` and every other locale file
- Regenerate: `types/message-keys.d.ts` (`node scripts/generate-message-keys-dts.mjs`)

**Interfaces:**
- Produces these keys: `assistant.thinking`, `assistant.thinking.off`, `assistant.thinking.low`, `assistant.thinking.medium`, `assistant.thinking.high`, `assistant.thinking.xhigh`, `assistant.thinking.max`.

**Concurrency warning:** at the time of writing, another session has uncommitted edits in every locale file (`git status` shows `MM` on all of `src/components/i18n/locales/*.json`). Never `git add` a whole locale file. Stage only your hunks: `git diff <file>` and `git apply --cached` with a patch that holds only the seven new keys. Check `git diff --cached` before committing. If staging only your hunks is not possible, ask the user, using `ListAgents` and `SendMessage` to coordinate with the other session.

- [ ] **Step 1: Invoke the `blok-translations` skill** and follow it for the seven keys.

The English values:

```json
  "assistant.thinking": "Thinking",
  "assistant.thinking.off": "Off",
  "assistant.thinking.low": "Low",
  "assistant.thinking.medium": "Medium",
  "assistant.thinking.high": "High",
  "assistant.thinking.xhigh": "Extra high",
  "assistant.thinking.max": "Max"
```

Place them after `"assistant.discard"` in `en.json`, and at the same spot in every locale.

- [ ] **Step 2: Regenerate** `node scripts/generate-message-keys-dts.mjs`, then run the translation validation the skill names. Run the locale-coverage test it points at, one file per vitest run.
- [ ] **Step 3: Commit only your hunks and push** (see the warning above).

```bash
git commit -m "feat(i18n): thinking level labels for the Ask AI bar"
git fetch -q && git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main
```

---

### Task 11: Thinking toggle in the Ask AI bar

**Step 0 (fill in from Task 9):** chosen variant: ________. If it is B or C, the button markup in Step 3 changes to match the prototype. The test IDs, the callbacks and the data flow below stay the same.

**Files:**
- Modify: `src/components/modules/assistant/assistant-bar.ts` (thinking button + menu)
- Modify: `src/components/modules/assistant/index.ts` (owns the current pick; passes it to `startRun`)
- Test: `test/unit/components/modules/assistant/assistant.test.ts`, `test/playwright/tests/agent/assistant-bar.spec.ts`, `test/unit/styles/selected-state-neutral.test.ts` (only if it lists menus by name)

**Interfaces:**
- Consumes: `AgentAPI.thinkingChoice()` and `startRun(prompt, context, thinking)` (Task 2), and the i18n keys (Task 10).
- Produces: `AssistantBar.setThinking(view: { levels: AgentThinkingLevel[]; current: AgentThinkingLevel } | null): void` and the callback `onThinking(level: AgentThinkingLevel): void`.

- [ ] **Step 1: Write the failing e2e test.** In `test/playwright/tests/agent/assistant-bar.spec.ts`, extend `setup` with `options.thinking?: { levels: string[]; default?: string }`. Pass it to `agent.assistant.thinking`. Record `request.thinking` into `window.assistantLevels` inside the scripted `model`. Then add:

```ts
test.describe('thinking toggle', () => {
  test('is absent with one level, and shown with two', async ({ page }) => {
    await gotoTestPage(page);
    await setup(page, [], { thinking: { levels: ['high'] } });
    await page.keyboard.press(`${MOD}+KeyJ`);
    await expect(page.getByTestId('assistant-thinking')).toHaveCount(0);

    await setup(page, [], { thinking: { levels: ['low', 'high'] } });
    await page.keyboard.press(`${MOD}+KeyJ`);
    await expect(page.getByTestId('assistant-thinking')).toBeVisible();
  });

  test('the picked level reaches the next prompt, and the menu marks it without blue', async ({ page }) => {
    await gotoTestPage(page);
    await setup(page, [reply('One'), reply('Two')], { thinking: { levels: ['low', 'high'], default: 'low' } });
    await page.keyboard.press(`${MOD}+KeyJ`);

    const bar = page.getByTestId('assistant-bar');

    await bar.getByRole('textbox').fill('First');
    await bar.getByRole('textbox').press('Enter');
    await expect(bar.getByText('One')).toBeVisible();

    await page.getByTestId('assistant-thinking').click();

    const high = page.getByRole('menuitemradio', { name: 'High' });

    await high.click();
    await bar.getByRole('textbox').fill('Second');
    await bar.getByRole('textbox').press('Enter');
    await expect(bar.getByText('Two')).toBeVisible();

    expect(await page.evaluate(() => window.assistantLevels)).toEqual(['low', 'high']);

    await page.getByTestId('assistant-thinking').click();
    await expect(page.getByRole('menuitemradio', { name: 'High' })).toHaveAttribute('aria-checked', 'true');
    const color = await page.getByRole('menuitemradio', { name: 'High' }).evaluate((element) => getComputedStyle(element).color);
    const plain = await page.getByRole('menuitemradio', { name: 'Low' }).evaluate((element) => getComputedStyle(element).color);

    expect(color).toBe(plain);
  });

  test('a run already answering keeps its level when the user picks another', async ({ page }) => {
    await gotoTestPage(page);
    await setup(page, [reply('One')], { thinking: { levels: ['low', 'high'], default: 'low' }, hold: true });
    await page.keyboard.press(`${MOD}+KeyJ`);

    const bar = page.getByTestId('assistant-bar');

    await bar.getByRole('textbox').fill('First');
    await bar.getByRole('textbox').press('Enter');
    await page.getByTestId('assistant-thinking').click();
    await page.getByRole('menuitemradio', { name: 'High' }).click();
    await page.evaluate(() => window.assistantRelease?.());
    await expect(bar.getByText('One')).toBeVisible();

    expect(await page.evaluate(() => window.assistantLevels)).toEqual(['low']);
  });
});
```

Add `assistantLevels?: unknown[]` to the `Window` declaration in the spec. If the item role differs from `menuitemradio`, check what `toggle: 'thinking'` items render as in the language picker, and use that role. Do not change the assertion's intent.

- [ ] **Step 2: Run it and watch it fail**

Run: `yarn e2e test/playwright/tests/agent/assistant-bar.spec.ts -g "thinking toggle"`
Expected: FAIL, `assistant-thinking` not found.

- [ ] **Step 3: Implement the bar.** In `assistant-bar.ts`:
  - Add `onThinking(level: AgentThinkingLevel): void` to `AssistantBarCallbacks`.
  - Add `thinking: 'data-blok-assistant-thinking'` to `ATTR`.
  - Build the button in the constructor, before `this.send`:

```ts
    this.thinking = build('button', {
      type: 'button',
      [ATTR.thinking]: '',
      'data-blok-testid': 'assistant-thinking',
      'aria-haspopup': 'menu',
    });
    this.thinking.hidden = true;
    this.thinking.addEventListener('click', () => this.openThinkingMenu());
    row.append(icon, this.field, this.thinking, this.send, this.stop);
```

Then add these members:

```ts
  private readonly thinking: HTMLButtonElement;
  private thinkingView: { levels: AgentThinkingLevel[]; current: AgentThinkingLevel } | null = null;
  private thinkingMenu: PopoverDesktop | null = null;

  /**
   * Show the level picker, or hide it with null or a single level.
   * @param view - the allowed levels and the current pick
   */
  public setThinking(view: { levels: AgentThinkingLevel[]; current: AgentThinkingLevel } | null): void {
    this.thinkingView = view !== null && view.levels.length >= 2 ? view : null;
    this.thinking.hidden = this.thinkingView === null;
    if (this.thinkingView !== null) {
      const label = this.t(`assistant.thinking.${this.thinkingView.current}`);

      this.thinking.textContent = `${this.t('assistant.thinking')}: ${label}`;
      this.thinking.setAttribute('aria-label', `${this.t('assistant.thinking')}: ${label}`);
    }
  }

  private openThinkingMenu(): void {
    const view = this.thinkingView;

    if (view === null || this.thinkingMenu !== null) {
      return;
    }

    const menu = new PopoverDesktop({
      trigger: this.thinking,
      width: 'auto',
      autoFocusFirstItem: false,
      messages: { actions: this.t('assistant.thinking') },
      items: view.levels.map((level) => ({
        title: this.t(`assistant.thinking.${level}`),
        name: level,
        trailingIcon: level === view.current ? IconCheck : undefined,
        // One toggle group makes the rows a radio group, so assistive tech hears which is chosen.
        toggle: 'thinking',
        isActive: level === view.current,
        closeOnActivate: true,
        onActivate: (): void => this.callbacks.onThinking(level),
      })),
    });

    this.thinking.setAttribute('aria-expanded', 'true');
    menu.on(PopoverEvent.Closed, () => {
      this.thinking.removeAttribute('aria-expanded');
      menu.destroy();
      this.thinkingMenu = null;
    });
    this.thinkingMenu = menu;
    menu.show();
  }
```

Imports: `IconCheck` from `../../icons`; `PopoverDesktop` from `../../utils/popover`; `PopoverEvent` from `@/types/utils/popover/popover-event`; `AgentThinkingLevel` from `../../../../types/api`. Read `src/tools/tabs/index.ts:872-900` and copy its popover lifecycle (show, close, destroy) exactly. Also close `thinkingMenu` in `close()`.

The menu must open above the top-layer bar. Popovers already render in the top layer (memory: nested menus top layer). Verify this visually in the e2e screenshot. If the menu renders under the bar, follow the pattern the bar's own `promoteToTopLayer` uses.

Hide the button while working: in the code that toggles `this.send.hidden = working`, also set `this.thinking.hidden = working || this.thinkingView === null`.

- [ ] **Step 4: Implement the module.** In `assistant/index.ts`:

```ts
  /** The bar's pick. Undefined when the host offers no choice. */
  private level: AgentThinkingLevel | undefined;
```

In `ensureBar()`, add this callback:

```ts
      onThinking: (level) => {
        this.level = level;
        this.syncThinking();
      },
```

After the bar is created in `open()`, call `this.syncThinking()`. Add:

```ts
  private syncThinking(): void {
    const choice = ((): ThinkingChoice | null => {
      try {
        return this.Blok.AgentAPI.thinkingChoice();
      } catch {
        // A bad config is reported by ask() when the user sends.
        return null;
      }
    })();

    this.level ??= choice?.initial;
    this.bar?.setThinking(choice === null || this.level === undefined ? null : { levels: choice.levels, current: this.level });
  }
```

Import `ThinkingChoice` from `../../../agent/thinking` and `AgentThinkingLevel` from `../../../../types/api`.

In `startRun`, replace the getter from Task 2:

```ts
      this.run = this.Blok.AgentAPI.startRun(prompt, this.context, () => this.level);
```

- [ ] **Step 5: Run the e2e and watch it pass**

Run: `yarn e2e test/playwright/tests/agent/assistant-bar.spec.ts`
Expected: PASS (the new tests and every existing bar test).

- [ ] **Step 6: Unit-check the module.** Run `npx vitest run --project=unit test/unit/components/modules/assistant/assistant.test.ts`. Expected: PASS. If its `AssistantBar` mock lists callbacks, add `onThinking` there.
- [ ] **Step 7: Selected-state law.** Run `npx vitest run --project=unit test/unit/styles/selected-state-neutral.test.ts`. Expected: PASS. The menu uses the shared popover tokens, so no new CSS is needed. If you added CSS for the button, it uses `--blok-text-primary` / `--blok-item-hover-bg` only.
- [ ] **Step 8: Hint law.** If the chosen variant has a hover hint, use `onHover` from `src/components/utils/tooltip.ts`. Run `npx vitest run --project=unit test/unit/architecture/hint-delay-law.test.ts`.
- [ ] **Step 9: Screenshots.** Take light and dark screenshots of the bar and the open menu with `playwright-cli`. Compare them to the prototype pick, and fix any differences.
- [ ] **Step 10: Lint, commit, push**

```bash
npx eslint src/components/modules/assistant/assistant-bar.ts src/components/modules/assistant/index.ts test/playwright/tests/agent/assistant-bar.spec.ts
git add src/components/modules/assistant/assistant-bar.ts src/components/modules/assistant/index.ts test/playwright/tests/agent/assistant-bar.spec.ts
git commit --only -m "feat(agent): thinking level picker in the Ask AI bar" -- src/components/modules/assistant/assistant-bar.ts src/components/modules/assistant/index.ts test/playwright/tests/agent/assistant-bar.spec.ts
git fetch -q && git merge-base --is-ancestor origin/main HEAD && git push origin HEAD:main
```

---

### Task 12: Reference docs

**Files:**
- Modify: `docs/src/components/api/api-data.ts:732-737` (the `agent` option) and the `editor.agent.ask` entry
- Modify: `docs/src/i18n/en.json` (same keys) and `docs/src/i18n/ru.json`
- Regenerate: `docs/src/seo/lastmod-ledger.json`

- [ ] **Step 1: Read** `docs/CLAUDE.md` "Reference-prose law" and `docs/src/i18n/reference-prose.test.ts`.
- [ ] **Step 2: Extend the `agent` option description** in BOTH `api-data.ts` and `en.json`. They must stay identical. Add these sub-items under `assistant`, after `maxSteps`:

```
  - `thinking`: levels the user may pick in the Ask AI bar, as `{ levels, default }`. The levels are `off`, `low`, `medium`, `high`, `xhigh` and `max`. The picker shows with two or more levels. The pick reaches your `model` as `request.thinking`.
```

Then add one paragraph after the list:

```
Adapters for other providers ship in `@jackuait/blok/agent-models`: `anthropicModel`, `openaiModel`, `openaiCompatibleModel` (DeepSeek, Mistral, Groq, Ollama, OpenRouter) and `geminiModel`. Each takes `{ model, send }`. Your `send` posts the body to your backend, which adds the key.
```

- [ ] **Step 3: Extend the `editor.agent.ask` entry** (find it with `grep -n '"editor.agent.ask' docs/src/components/api/api-data.ts`). Add: "`options.thinking` sets the level for this run. It overrides the Ask AI bar's pick."
- [ ] **Step 4: Translate both into `ru.json`** with the same block shape (same paragraphs, same list items).
- [ ] **Step 5: Run the docs tests that guard this**, one per invocation, from `docs/`:
  - `npx vitest run src/i18n/reference-prose.test.ts`
  - `npx vitest run src/components/api/api-data.ru-coverage.test.ts`

  Expected: PASS.
- [ ] **Step 6: Run** `node docs/scripts/update-lastmod-ledger.mjs`. Then run `npx vitest run src/seo/lastmod-ledger.test.ts` from `docs/`. Expected: PASS.
- [ ] **Step 7: Commit only these docs files and push.**

---

### Task 13: Final gates and hand-off

- [ ] **Step 1: Typecheck** `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` (timeout 600000). Expected: exit 0.
- [ ] **Step 2: Find the tests that reference the changed symbols** and run them, one file per run:

```bash
grep -rlE "startRun|AgentRunDeps|runAssistantLoop|AgentAssistantConfig|AgentModelRequest|AgentAskOptions|assistant-bar|agent-models" test | sort -u
```

- [ ] **Step 3: Lint every changed `src/` and `test/` file** in one scoped `npx eslint` call. Get the list from `git diff --name-only origin/main@{1}..HEAD` over this plan's commits.
- [ ] **Step 4: CI.** After the last push, watch the run for `HEAD`. Use `gh run list` filtered by `headSha` in jq (memory: the `--branch` filter is stale). Fix any red you own, using the CLAUDE.md failure protocol.
- [ ] **Step 5: Live smoke (needs keys, optional).** If the user provides keys, write a throwaway script. It must not be committed and must not log keys. It calls each adapter with a real `send`: one prompt that does `blok_read`, then answers. Record the results for these unverified spec points:
  - OpenAI chat accepting `name` on tool messages.
  - Gemini `parametersJsonSchema` accepting our schemas.
  - Chat Completions `max_tokens` on OpenAI reasoning models.
- [ ] **Step 6: Tell the user what is owed:**
  - Release notes: the new subpath, `thinking`, and `request.thinking`. Not BREAKING.
  - The unverified points still open.
- [ ] **Step 7: Worktrees.** If any worktree was used, apply the global Worktrees rule.
