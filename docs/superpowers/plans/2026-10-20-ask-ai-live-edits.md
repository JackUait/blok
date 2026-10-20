# Ask AI Live Edits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ask AI edits stream into the page word by word (shimmer slots + violet word tail), driven by the bar that opens in the page at the caret, with built-in streaming in all four model adapters.

**Architecture:**
- Adapters can take an optional host `stream` transport. They parse the provider's SSE into normalized `onStream` events and build the final response themselves.
- The loop applies each tool call as soon as its stream ends.
- A preview controller in the assistant module draws slots and streaming text in an overlay layer. It opens space through inert holder attributes and never touches the document until the real batch commits.
- The bar stays a top-layer portal, but anchors over a gap under the caret's block.

**Tech Stack:** TypeScript, Vitest + jsdom, Playwright, plain CSS (`src/styles/assistant.css`), no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-20-ask-ai-live-edits-design.md` (read it first; "(my call)" items are binding).

## Global Constraints

- No change here is BREAKING. Every surface involved landed after v1.16.1. No `BREAKING` label.
- No new runtime dependency. The SSE reader and partial-JSON reader are hand-written.
- Never insert nodes between block holders or into the block container. Writes go only on holders (attributes or CSS variables) or into an overlay layer appended to `UI.nodes.wrapper`.
- Never write the model's prose into the bar while it streams (user rule, 2026-10-19). Only edits stream. The bar keeps one status line per step from `step-status.ts`.
- Motion is shimmer slots and the violet word tail only. No local agent caret, no aura, no `.blok-block--target` pulse in Ask AI runs. The Yjs `agentCursor` stays.
- Send and Keep are ink, never blue. Colors are CSS tokens with dark-mode values. Every animation has a `prefers-reduced-motion: reduce` path that shows the end state.
- No inline `<svg>` in `src`. Use the sparkle, undo and check icons from `src/components/icons/index.ts` (grep first, and add an icon only if none fits).
- Reuse the existing i18n keys: `assistant.placeholder`, `assistant.followUp`, `assistant.send`, `assistant.stop`, `assistant.keep`, `assistant.discard`, `assistant.status.*`. A new key needs all locales (see the `blok-translations` skill).
- After adding a data attribute to `src/components/constants/data-attributes.ts`, run `node scripts/generate-data-attributes-dts.mjs`.
- Run tests scoped per file: `yarn test <file>`. Run one e2e spec: `yarn e2e <spec>`. Lint only changed files: `yarn eslint <files>`.
- Commit and push after each green task (user rule). Stage only your own paths. Check `git diff --cached --name-only` before each commit.

## Review Focus

1. **Stop mid-stream.** Applied batches stay, the in-flight preview disappears, and no gap is left on any holder. → Task 2 + Task 7 tests.
2. **The anchor block is deleted, or moved by a collaborator, while the bar is open.** The bar moves to the nearest surviving block, and the gap goes with it. → Task 10 test.
3. **A streamed call whose JSON never parses** (a broken or truncated `invalidJson`). It does not run early. It falls back to the final-response path, and its preview is cleared. → Task 2 + Task 7 tests.
4. **A host passes only `send`, or a provider streams no tool deltas.** The fallback reveal plays, and nothing breaks. → Task 9 test.
5. **Undo right after a streamed turn.** One Cmd+Z removes the whole turn, and saved data never held partial text. → Task 12 e2e.

---

### Task 1: Partial JSON reader

**Files:**
- Create: `src/agent/partial-json.ts`
- Test: `test/unit/agent/partial-json.test.ts`

**Interfaces:**
- Produces:
  - `parsePartialJson(text: string): unknown`. Best-effort value of an unfinished JSON text. Open strings, arrays and objects are closed. A trailing key with no value, a dangling `:` or `,` and a cut-off literal are dropped. Returns `undefined` when nothing usable has arrived yet.
  - `readPartialCommands(json: string): PartialCommand[]`, where `type PartialCommand = { name?: string; args: Record<string, unknown>; ref?: string; done: boolean }`.
    - It reads `blok_execute` input `{commands:[...]}`.
    - `done` is true for every command except the last while the text is still open, and true for all of them once the text parses with `JSON.parse`.

- [ ] **Step 1: Write the failing tests**

```ts
expect(parsePartialJson('{"a":"hel')).toEqual({ a: 'hel' });
expect(parsePartialJson('{"a":[1,2')).toEqual({ a: [1, 2] });
expect(parsePartialJson('{"a":1,"b"')).toEqual({ a: 1 });
expect(parsePartialJson('{"a":tr')).toEqual({});
expect(parsePartialJson('{"a":"x\\"y')).toEqual({ a: 'x"y' });
expect(parsePartialJson('{"a":"\\u00')).toEqual({ a: '' });   // cut escape dropped
expect(parsePartialJson('')).toBeUndefined();
const json = '{"commands":[{"name":"block.insert","args":{"type":"paragraph","data":{"text":"Hi"}}},{"name":"text.replace","args":{"id":"b1","with":"New te';
expect(readPartialCommands(json)).toEqual([
  { name: 'block.insert', args: { type: 'paragraph', data: { text: 'Hi' } }, done: true },
  { name: 'text.replace', args: { id: 'b1', with: 'New te' }, done: false },
]);
```

- [ ] **Step 2: Run them and see them fail.** Run `yarn test test/unit/agent/partial-json.test.ts`. Expected: FAIL, because the module is not found.
- [ ] **Step 3: Implement.** Write a single-pass scanner that tracks a stack of open containers and whether it is inside a string. Then append the closers and `JSON.parse` the repaired text. On failure, strip the last incomplete member and retry. The cost is O(n) per call. A call per delta is fine at these sizes.
- [ ] **Step 4: Run the tests and see them pass.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(agent): partial JSON reader for streamed tool input`.

---

### Task 2: Stream contract and early commit in the loop

**Files:**
- Modify: `types/api/agent.d.ts` (next to `AgentModelRequest`, line ~103)
- Modify: `src/agent/assistant-loop.ts`
- Test: `test/unit/agent/assistant-loop.test.ts`

**Interfaces:**
- Produces (public type, in `types/api/agent.d.ts`):

```ts
export type AgentModelStreamEvent =
  | { type: 'tool_start'; index: number; id: string; name: string }
  | { type: 'tool_input'; index: number; json: string } // all input text so far for this call
  | { type: 'tool_end'; index: number };
// on AgentModelRequest:
/** Set when the caller can show edits live. A model that streams calls it; one that does not ignores it. */
onStream?(event: AgentModelStreamEvent): void;
```

- Produces (`AssistantLoopOptions`, new optional fields):
  - `onStream?(event: AgentModelStreamEvent): void`. Every event, forwarded after the loop's own handling.
  - `onToolDone?(id: string, name: string, result: AgentToolResult): void`. Fires after each call finishes, early or not.

- Behavior:
  - At `tool_end`, the loop runs `JSON.parse` on the accumulated `json`.
  - If the parse succeeds and the run is not aborted, it calls `report(name, input)` and then `options.call(name, input)` at once. Calls are chained one after another in stream order, and each promise is stored by tool id.
  - `answerAll` reuses the stored promise when `use.id` matches, so a call never runs twice.
  - A parse failure means no early run. The call goes through today's path.
  - `max_tokens`: calls that already ran early get their real results, and the rest get the existing "cut off" answer.
  - `refusal`: returns `refused`. Early-applied batches stay.

- [ ] **Step 1: Write the failing tests** in `assistant-loop.test.ts`. Use a fake model that emits `onStream` events, then waits on a gate before it resolves.
  - `runs a streamed call at its tool_end, before the model response resolves`. Assert that `call` was invoked while the gate is still closed.
  - `does not run a streamed call twice when the response arrives`. Assert `call` was called exactly once for that id.
  - `runs a call whose streamed JSON does not parse only from the final response`.
  - `answers early-run calls with their real result on max_tokens, and the rest as cut off`.
  - `does not start an early call after stop`. Abort before `tool_end`, then assert that `call` was never invoked and the status is `stopped`.
  - `forwards every stream event to onStream and reports onToolDone with the result`.
- [ ] **Step 2: Run them and see them fail.** Run `yarn test test/unit/agent/assistant-loop.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Pass `onStream` into `ask()`'s request. Keep a per-step `Map<number, {id,name,json}>` and a `Map<string, Promise<AgentToolResult>>`.
- [ ] **Step 4: Run them and see them pass.** Then run `yarn test test/unit/agent/` to check the loop's other tests.
- [ ] **Step 5: Commit** `feat(agent): loop applies a streamed tool call as soon as it ends`.

---

### Task 3: SSE reader + Anthropic streaming

**Files:**
- Create: `src/agent-models/sse.ts`
- Modify: `src/agent-models/shared.ts`, `src/agent-models/anthropic.ts`, `types/agent-models.d.ts`
- Test: `test/unit/agent-models/sse.test.ts`, `test/unit/agent-models/anthropic.test.ts`
- Fixture: `test/unit/agent-models/fixtures/anthropic-stream.sse` (a hand-written recording: text block, then a `tool_use` with `input_json_delta` chunks split mid-token, then `message_delta` with `stop_reason: "tool_use"`)

**Interfaces:**
- Produces:
  - `readSse(source: Response | ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<{ event?: string; data: string }>`. Handles CRLF line breaks, multi-line `data:` fields, chunks split mid-line, and `:` comment lines. It stops when `data === '[DONE]'`.
  - `AdapterOptions` changes:
    - `send` becomes optional.
    - Add `stream?(body: Body, context: SendContext): Promise<Response | ReadableStream<Uint8Array>>`.
    - The adapter factory throws `TypeError('<provider>: pass send or stream.')` when both are missing.
  - When `stream` is present, every request streams.
  - `types/agent-models.d.ts` mirrors these changes. Document `stream` like this: "Post `body` to your backend and return the streaming response (SSE) unchanged. The adapter already set the provider's stream flag. With it, Ask AI shows edits live."
  - In `shared.ts`, add `postStream(body, request, options)`, which clones the body like `post` does.
- Anthropic:
  - The body gets `stream: true`.
  - Map the events:
    - `content_block_start` with a `tool_use` block → `tool_start` (id from `callId`)
    - `input_json_delta` → `tool_input` with the accumulated json
    - `content_block_stop` on that block → `tool_end`
  - Build the final `AgentModelResponse` from the stream: text blocks, tool_use blocks with `parseArguments(json)`, and `stop_reason` from `message_delta`.
  - Pass thinking blocks through with their signature, so the next request is valid.
  - An `error` event throws `Anthropic: <message>`.

- [ ] **Step 1: Write the failing tests.**
  - sse:
    - `parses events split across chunks`
    - `joins multi-line data`
    - `stops at [DONE]`
    - `stops reading when the signal aborts`
  - anthropic:
    - `streams tool input as tool_start/tool_input/tool_end with the accumulated json`
    - `the streamed response equals the non-streamed one for the same content`: build both from the fixture and a JSON twin, then `toEqual`.
    - `sends stream: true`
    - `throws on an SSE error event`
    - `needs send or stream`
- [ ] **Step 2: Run them and see them fail.** Run `yarn test test/unit/agent-models/sse.test.ts test/unit/agent-models/anthropic.test.ts` (one at a time if multi-path skips files, as noted in memory).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.** Also run `test/unit/architecture/published-types-no-src-refs.test.ts`.
- [ ] **Step 5: Commit** `feat(agent-models): streaming transport and Anthropic stream parsing`.

---

### Task 4: OpenAI Responses streaming

**Files:** Modify `src/agent-models/openai.ts`. Test: `test/unit/agent-models/openai.test.ts` + fixture `openai-stream.sse`.

**Interfaces:**
- Consumes: `readSse` and `postStream` from Task 3.
- Behavior:
  - The body gets `stream: true`.
  - Map the events:
    - `response.output_item.added` with `type: function_call` → `tool_start` (`id` = `call_id` via `callId`)
    - `response.function_call_arguments.delta` → `tool_input` (accumulated)
    - `response.output_item.done` for that item → `tool_end`
  - The final response comes from `response.completed`'s `response` object, read through the existing `readReply`. That way, stop mapping and `incomplete_details` stay identical.

- [ ] **Step 1: Write the failing tests.** Same three behaviours as Task 3: event mapping, streamed equals non-streamed, and `stream: true` is sent. Also: `response.failed` throws.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** `feat(agent-models): OpenAI Responses streaming`.

---

### Task 5: Chat Completions streaming

**Files:** Modify `src/agent-models/openai-compatible.ts`. Test: `test/unit/agent-models/openai-compatible.test.ts` + fixture `chat-stream.sse`.

**Interfaces:**
- Behavior:
  - The body gets `stream: true` and `stream_options: { include_usage: true }`.
  - `choices[0].delta.tool_calls[i]`:
    - The first chunk for an `index` carries `id` and `function.name` → `tool_start`.
    - `function.arguments` pieces → `tool_input`.
  - A call ends (`tool_end`) when a chunk starts a higher `index`, or when `finish_reason` arrives.
  - `delta.content` accumulates into the text.
  - Build a Chat Completions-shaped `{choices:[{message,finish_reason}]}` object and pass it to the existing `readReply`.
  - DeepSeek's `delta.reasoning_content` is kept the same way the non-stream path keeps `reasoning_content`.

- [ ] **Step 1: Write the failing tests.**
  - event mapping
  - streamed equals non-streamed
  - `two parallel tool calls end in order`
  - `reasoning_content survives into the provider block`
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** `feat(agent-models): Chat Completions streaming`.

---

### Task 6: Gemini streaming

**Files:** Modify `src/agent-models/gemini.ts`, `types/agent-models.d.ts` (Gemini doc line). Test: `test/unit/agent-models/gemini.test.ts` + fixture `gemini-stream.sse`.

**Interfaces:**
- Behavior:
  - The body is unchanged. Gemini selects streaming by URL. Document this: "With `stream`, call `:streamGenerateContent?alt=sse`."
  - Gemini sends each `functionCall` part whole, so each one emits `tool_start`, one `tool_input` with `JSON.stringify(args)`, and `tool_end` at once.
  - Merge chunks' `candidates[0].content.parts` (concatenate text parts, keep `thoughtSignature`), then pass the result to the existing reader.
  - The `MALFORMED_FUNCTION_CALL` retry still works. A retried attempt emits no events for the failed attempt's calls, because they were never emitted: emit only after the chunk's `finishReason` is not `MALFORMED_FUNCTION_CALL`.

- [ ] **Step 1: Write the failing tests.**
  - event mapping
  - streamed equals non-streamed
  - `retries a malformed streamed call without emitting its events`
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** `feat(agent-models): Gemini streaming`.

---

### Task 7: Live preview controller (inserts) + gap registry + overlay law

**Files:**
- Create: `src/components/modules/assistant/gap.ts`, `src/components/modules/assistant/live-preview.ts`
- Modify: `src/components/constants/data-attributes.ts` (add `aiGap: 'data-blok-ai-gap'`, `aiRewriting: 'data-blok-ai-rewriting'`), then run `node scripts/generate-data-attributes-dts.mjs`.
- Modify: `src/styles/assistant.css`, `src/styles/colors.css`
  - New tokens: `--blok-ai-tail` (violet, e.g. `#7c5cff`; dark `#a08bff`), `--blok-ai-slot-base`, `--blok-ai-slot-shine`.
  - Holder rule: `[data-blok-ai-gap] { margin-block-end: var(--blok-ai-gap) }`.
- Test: `test/unit/components/modules/assistant/live-preview.test.ts`, `test/unit/architecture/ai-preview-overlay-law.test.ts`

**Interfaces:**
- Produces (`gap.ts`):
  - `reserveGap(holder: HTMLElement, key: string, px: number): number`. Returns the key's offset inside the gap. Keys stack in insertion order. Sets `data-blok-ai-gap` and `--blok-ai-gap` (the sum of all keys).
  - `releaseGap(holder: HTMLElement, key: string): void`. Removes the attribute and the variable when no keys are left.
- Produces (`live-preview.ts`):

```ts
export interface LivePreviewDeps {
  layer: HTMLElement;                       // overlay host: UI.nodes.wrapper
  holderOf(id: string): HTMLElement | null;
  edgeHolder(edge: 'start' | 'end', parentId?: string): HTMLElement | null;
  anchorHolder(): HTMLElement | null;        // the bar's block
}
export interface LivePreview {
  update(callId: string, json: string): void; // from tool_input
  settle(callId: string): void;               // batch applied: clear on next frame
  cancel(callId: string): void;               // failed / stopped / cut off
  clear(): void;
}
export function createLivePreview(deps: LivePreviewDeps): LivePreview;
```

- Behavior:
  - `readPartialCommands` (Task 1) decides what to draw.
  - For `block.insert` / `markdown.insert`:
    - Resolve the anchor holder from `position`:
      - `{after:id}` → that holder
      - `{before:id}` → the previous sibling holder of id. If there is none, use the gap above it via `margin-block-start` (same registry).
      - `'start'|'end'` → `edgeHolder`
      - `$ref` → the previous preview item in this call
      - none → `anchorHolder()`
    - When the anchor is the bar's block, reserve with key `call:<id>` after the bar's key, so slots sit below the bar.
    - Draw one slot per expected block: a heading slot for `type: 'header'`, a short slot per list item, and two slots for a paragraph.
    - Then replace the slots with the streaming text, using the real block classes for type size (reuse `paragraph` / `header` CSS class names from those tools).
    - New words get `.blok-ai-word`. The last two get `.blok-ai-tail`.
  - Pacing: words go into a queue and land at least 35ms apart, so a burst of deltas still reads as typing. `settle` drains the queue at once.
  - `settle`: wait one `requestAnimationFrame` so the real blocks have rendered, then remove the overlay nodes and release the gaps.
  - `cancel`: remove at once.
  - `prefers-reduced-motion`: no slot shimmer, and text shows without the blur-in.
- Architecture law test: it scans `live-preview.ts` and `gap.ts` source. It fails if there is any `insertBefore`/`append`/`appendChild`/`after`/`before`/`replaceWith` call whose receiver is not the overlay layer or an overlay node. The allow-list is written in the test, with reasons.

- [ ] **Step 1: Write the failing tests** (jsdom; stub `requestAnimationFrame`).
  - `opens slots after the target holder and grows the gap`. Assert that the holder has `data-blok-ai-gap` and a positive `--blok-ai-gap`, and that the slots live in `deps.layer`.
  - `streams words into the overlay with the tail on the last two`
  - `places an insert at the bar's block below the bar`. Reserve key `bar` first, then assert the slot offset ≥ the bar's px.
  - `settle removes the overlay and the gap on the next frame`
  - `cancel removes everything at once`
  - `never adds a node to the block container`. Assert that the container's `childElementCount` is unchanged through update, settle and cancel.
  - `reduced motion skips the shimmer class`
  - Law test: `preview code only mounts into the overlay layer`
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.** Also run `test/unit/architecture/published-types-no-src-refs.test.ts`.
- [ ] **Step 5: Commit** `feat(assistant): live preview draws streamed inserts in an overlay`.

---

### Task 8: Live preview for rewrites

**Files:** Modify `live-preview.ts`, `assistant.css`. Test: `live-preview.test.ts`.

**Interfaces:**
- Behavior. The rewrite kinds are:
  - `text.replace` with `range` missing or `'all'`
  - `text.replace` with `{start,end}` or `{find,occurrence?}`
  - `block.update` whose `data` has a string field
- Once `args.id` resolves:
  - Set `data-blok-ai-rewriting` on the holder. CSS hides its `[data-blok-element-content]` with `visibility: hidden`.
  - Draw an overlay at the content rect with the block's computed font. It shows the text before the range, then the streaming `with` text with the tail, then the text after the range.
  - The field text comes from the block's current input `textContent` (`holderOf(id)`'s `[contenteditable]` matching `field`, default the first).
  - `{find}`: locate the nth occurrence. If it is not found, show no preview, because commit will decide.
- `settle` / `cancel` also remove `data-blok-ai-rewriting`.

- [ ] **Step 1: Write the failing tests.**
  - `whole-field replace hides the block and streams the new text`
  - `range replace keeps the text outside the range visible`
  - `find replace previews at the second occurrence`
  - `block.update with data.text previews like a whole replace`
  - `cancel shows the original block again`
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** `feat(assistant): live preview streams rewrites in place`.

---

### Task 9: Wire the stream into the assistant + fallback reveal

**Files:**
- Modify:
  - `src/components/modules/api/agent-run.ts` (`AgentRunDeps`)
  - `src/components/modules/api/agent.ts` (`startRun`, `ask`, `begin`, `editorContext`)
  - `src/components/modules/api/agent-presence.ts`
  - `src/components/modules/assistant/index.ts`
- Test:
  - `test/unit/components/modules/assistant/assistant.test.ts`
  - `test/unit/components/modules/api/agent-presence.test.ts` (find the existing file with `grep -rl createAgentPresence test/unit`)

**Interfaces:**
- `startRun(prompt, place, thinking, hooks: AssistantRunHooks)`. This replaces the positional `onActivity`. Update its only caller, `assistant/index.ts`.

```ts
export interface AssistantRunHooks {
  onActivity?(activity: string, input?: unknown): void;
  onStream?(event: AgentModelStreamEvent): void;
  onToolDone?(id: string, name: string, result: AgentToolResult): void;
  onExecuted?(changed: ChangedSet): void;
}
```

- `AgentRunDeps` gets `onStream` and `onToolDone`. They are passed through to `runAssistantLoop`.
- `begin(options, internal?: { drawLocal: boolean })`. Ask AI passes `{ drawLocal: false }` and `follow: true`. Then `onExecuted` calls `presence().show(result, { draw: false })`, which publishes `agentCursor` and runs the follow scroll, but draws no caret, marker or pulse. Its `hooks.onExecuted(result.changed)` fires too.
- `editorContext` with the caret (no selection) appends: ` Write new content right after this block unless the request names another place.`
- Assistant module:
  - It maps `tool_start` id by index, then `tool_input` → `preview.update(id, json)`.
  - `onToolDone`: `result.isError` → `preview.cancel(id)`, else → `preview.settle(id)`.
  - Stop, close and a failed run → `preview.clear()`.
- Fallback: `onExecuted(changed)` for a call that never streamed plays the reveal on `changed.created` and `changed.updated` holders. Every word of their text fades in with the tail, through a class on the holder's content. This only re-plays the visuals.

- [ ] **Step 1: Write the failing tests.**
  - presence: `show with draw:false publishes the cursor and follows, but draws nothing`
  - assistant:
    - `stream events drive the preview: update on tool_input, settle on success`
    - `an error result cancels its preview`
    - `stop clears the preview and leaves no gap on any holder`
    - `a call that never streamed plays the reveal on the changed blocks`
    - `Ask AI runs draw no local caret or arrival pulse`
  - agent api: `the caret context asks the model to write after the caret block`
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.** Then grep for the changed symbols (`startRun`, `presence().show`, `AgentRunDeps`) under `test/` and run every file that references them.
- [ ] **Step 5: Commit** `feat(assistant): stream events drive the live preview; Ask AI drops the local caret`.

---

### Task 10: The in-page bar

**Files:**
- Modify: `src/components/modules/assistant/assistant-bar.ts`, `index.ts`, `src/styles/assistant.css`
- Test: `test/unit/components/modules/assistant/assistant.test.ts` and an `assistant-bar` unit test, if one exists (find it with grep)

**Interfaces:**
- `AssistantBar.place(anchor: HTMLElement, column: { left: number; width: number })` replaces `place(wrapper)`.
  - The bar is `position: fixed` in the top layer.
  - Its top is the anchor holder's bottom plus its gap offset (`reserveGap(anchor, 'bar', barHeight)`).
  - Its width is the content column plus 24px, and it is centered on the column.
  - Re-place on `scroll` (capture, passive), on `resize`, on a `ResizeObserver` on the anchor holder and the bar, and on block mutations.
  - If the anchor holder disconnects, re-anchor to the nearest surviving holder: the next one, else the previous one. If there are none, use the last block.
- Anchor choice in `open()`:
  - `context.blockIds[0]`'s holder, else the current block, else the last block.
  - For a selection opened from the inline toolbar, use the block holding the selection's end.
- Look, matching `inline-bar.html`:
  - A white surface with a 1px border and radius `--blok-radius-*` (see the radius memory: use a role token).
  - Shadow `0 1px 2px` plus `0 6px 20px` at low alpha.
  - Sparkle icon on the left. While working, it wobbles (rotate ±12°, 1.1s), with no breathing.
  - The working status text gets a shine sweep: a background-clip text gradient moving left to right over 1.6s.
  - Send is a 26px round button in ink. It is a gray fill while the field is empty.
  - Answered:
    - The reply's first line is the summary.
    - The undo icon button (`assistant.discard` label) and the check icon button (`assistant.keep` label) are both neutral ink.
    - A longer reply renders below the summary in an attached panel, using the existing markdown path. The panel starts collapsed and has a "more" toggle (my call; reuse an existing "Show more"-style key if there is one, else add one with all locales).
  - Remove the bottom-dock CSS.
- Kept unchanged: thinking picker, Stop, follow-up, Escape, roles, `data-blok-keyboard-owner`, focus restore, read-only, RTL sync, and the 1.5s hold.

- [ ] **Step 1: Write the failing tests.**
  - `opens anchored under the caret block and reserves a gap there`
  - `opens under the selection's block from the inline toolbar`
  - `re-anchors when its block is removed`
  - `answered state shows the first reply line with Undo and Keep`
  - `a long reply opens in a collapsed panel`
  - `close releases the gap`
  - `send and keep are not blue`: computed color is not in the blue family, following the pattern in `test/unit/styles/selected-state-neutral.test.ts`
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.** Then run the existing bar and inline-tool tests: `test/unit/components/inline-tools/inline-tool-ask-ai.test.ts`.
- [ ] **Step 5: Commit** `feat(assistant): prompt bar opens in the page at the caret`.

---

### Task 11: Playground streams for real

**Files:** Modify `scripts/dev-ai.mjs` and `src/playground/ai-model.ts`. Test: `test/unit/scripts/dev-ai.test.ts`, `test/unit/playground/ai-model.test.ts`.

**Interfaces:**
- dev-ai forwards new NDJSON lines:
  - `{type:'tool_start',index,id,name}` on `content_block_start` with `tool_use`
  - `{type:'tool_input',index,json}` per `input_json_delta` (accumulated)
  - `{type:'tool_end',index}` on that block's stop
- `ai-model.ts` calls `request.onStream` for these lines. It still returns the final `message`. Text deltas are still skipped (user rule).

- [ ] **Step 1: Write the failing tests.**
  - `dev route forwards tool input deltas`
  - `playground model calls onStream for tool lines and ignores text deltas`
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** `feat(playground): dev AI route streams tool input to the editor`.

---

### Task 12: End-to-end, docs, real-browser check

**Files:**
- Test: `test/playwright/tests/agent/assistant-bar.spec.ts` (extend), new `test/playwright/tests/agent/assistant-live-edits.spec.ts`
- Docs:
  - `docs/src/components/api/api-data.ts` and `docs/src/i18n/en.json` + `ru.json`: the `stream` option, the Gemini URL note, and live edits with the fallback. Follow `docs/CLAUDE.md` and the reference-prose law. Run `node docs/scripts/update-lastmod-ledger.mjs`.

**Interfaces:**
- E2E model: a scripted `AgentModel` injected into the page. It calls `request.onStream` with timed events, then resolves.

- [ ] **Step 1: Write the failing e2e tests.**
  - `words appear in the page before the batch commits`: assert the overlay text is visible while `editor.save()` still returns the old text.
  - `saved data never holds partial text mid-stream`
  - `one undo removes the whole streamed turn`
  - `the bar opens under the caret block` (bounding boxes)
  - `answered bar shows Undo and Keep; Keep closes it`
  - `stop mid-stream keeps applied batches and leaves no gap`
  - `reduced motion shows the final text with no animation` (`page.emulateMedia({ reducedMotion: 'reduce' })`)
  - `an insert streams below the bar, not above it`
- [ ] **Step 2: Run them and see them fail.** Run `yarn e2e test/playwright/tests/agent/assistant-live-edits.spec.ts`.
- [ ] **Step 3: Fix whatever the e2e exposes.** Check each fix with its own unit test first.
- [ ] **Step 4: Run all agent e2e specs.** Run `yarn e2e test/playwright/tests/agent/`. Expected: PASS.
- [ ] **Step 5: Check in a real browser.** Use the `verify` skill against the playground with the dev AI route (needs `~/.config/blok/ai.env`). Record the steps as a frame strip and read the frames. If no key is present, say so and skip this step.
- [ ] **Step 6: Run the final gates.**
  - `yarn lint` on the changed files
  - related unit and e2e files only (user rule: no full suite)
  - `tsc` with an 8 GB heap, as noted in memory
- [ ] **Step 7: Commit and push** `docs(agent): live edits and adapter streaming`. Then `git pull --rebase && git push`.
