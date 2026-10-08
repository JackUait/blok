# 03 — In-app agent surface

Date: 2026-10-08. Revised twice the same day to match `06-reconciliation.md` (round 1, then round 2: 06 sections 5, 8, 9, 10, 11). Builds on `00-brief.md`. Consumes spec 01 (commands, document view, execution) and spec 02 (manifest). Shared shapes come from 06 section 3 ("Canonical shared contract"), copied verbatim where this spec shows them. This spec invents no command and no data shape.

Status words used below:

- **Verified**: read in this session, cited `path:line`.
- **Inferred**: follows from code I read, but no test was run. Needs a pinning test before it is relied on.
- **Unverified**: not checked.

All user decisions D1–D6 are decided (06 section 5). Where this spec depends on one, it names the outcome inline, for example "(D4: approved)".

---

## 1. Purpose and success criteria

An assistant built into a host app operates the document the user has open, live, in the browser. This spec covers the editor-side surface that makes that easy and safe:

- `editor.agent`: one namespace on the editor instance (D4: approved, with a release note).
- Ready-made LLM tool definitions and guidance, rendered from 06's `AgentContract` by the shared renderer `renderAgentTools`.
- Live visibility of agent work: an agent caret, a pulse on changed blocks.
- The agent caret shown to collab peers through a new awareness field, `agentCursor` (D6: kept in v1).
- Drawing of remote agents: MCP agents in a room, and other people's in-app agents.
- Undo: one agent batch is one undo step. Batches in one turn merge only when it is safe (section 3.5).
- Stop/cancel, attribution in events and saved data, read-only handling.
- Parity across React, Vue and Angular.

Success criteria:

1. A host wires an in-app assistant with about 20 lines: get tool definitions, pass them to its LLM client, forward each tool call to `turn.call()`, return the result.
2. The generated tool definitions are accepted by the Anthropic Messages API and by the OpenAI Responses API without edits (section 2.9 cites both rule sets). The Chat Completions shape is out of scope until verified.
3. The user sees where the agent is working. The agent never moves the user's caret, selection, focus or scroll.
4. One Cmd+Z undoes one uninterrupted run of agent work. A user edit never joins an agent step, and an agent edit never joins a user step.
5. Every block change made by the agent is attributed in `onChange` events and in `lastEditedBy`. A block the user edits during the turn keeps the user's id.
6. Nothing ships breaking. The renderer code is lazy-loaded.
7. React, Vue and Angular users reach the whole surface with no adapter-specific API.

---

## 2. What exists today

### 2.1 How namespaces reach the editor instance

- `API.methods` builds the namespace object from per-module `*API` modules (`src/components/modules/api/index.ts:39-91`). Tools receive the same object as `api`.
- `exportAPI()` sets the instance prototype to that object: `Object.setPrototypeOf(this, apiMethods)` (`src/blok.ts:666`). So every `API` member is reachable as `editor.<name>`.
- Published type: `interface API` (`types/index.d.ts:232-271`) and `interface Blok extends Omit<API, 'i18n'> {}` (`types/index.d.ts:744`).
- The class ⊇ API parity law checks every `API` member is on `Blok` with the same type, and that parity is by declaration merging (`test/unit/architecture/blok-class-api-parity-law.test.ts:79-119`).
- Namespaces exist only after `isReady`. `PendingBlok` lists the members present before that (`types/index.d.ts:567-583`).
- Precedent for adding a namespace: `media` (952ba10f), `viewState` (ccfc0eb1), `marks` (81c04b22). None of those commits is labelled BREAKING (checked with `git log -S`).

### 2.2 Framework adapters

All three adapters hand the host the core `Blok` instance, typed with the core `Blok` type:

- React: `BlokEditor` forwards a `Ref<Blok | null>` (`packages/react/types/index.d.ts:163-165`); `useBlok` returns `editor: Blok | null` (`packages/react/types/index.d.ts:74`).
- Vue: `BlokEditorExposed.instance: Blok | null` (`packages/vue/types/index.d.ts:124`); `useBlok` returns `Ref<Blok | null>` (`packages/vue/types/index.d.ts:78-81`).
- Angular: `readonly instance = computed<Blok | null>(...)` (`packages/angular/src/blok-editor.component.ts:458`); `ready` emits `Blok` (`packages/angular/src/blok-editor.component.ts:140`).

So a new `API` member appears on every adapter with no adapter code. Existing parity guards: `useblocks-scope-parity-law.test.ts`, `test/unit/react/blocks-api-parity.test.ts`, `test/unit/types/react-types-typecheck.ts`.

### 2.3 Undo grouping

- `blocks.transact(fn)` groups sync work into one step (`types/api/blocks.d.ts:422-429`; impl `src/components/modules/api/blocks.ts:1072-1075`).
- `blocks.beginTransaction()/endTransaction()` keeps a group open across async gaps (`types/api/blocks.d.ts:449-463`). It calls `BlockManager.beginToolTransaction()` (`src/components/modules/blockManager/blockManager.ts:1170-1182`), which calls `YjsManager.holdCapture()`.
- `holdCapture()` sets the Yjs `captureTimeout` to `Infinity` (`src/components/modules/yjs/undo-history.ts:2419-2422`).
- A user gesture closes the open step: `startGesture` → `closeStepForGesture` → `splitStep` (`src/components/modules/yjs/undo-history.ts:2210-2230`, `2247-2254`).
- An API call under a hold joins the open step: `beginApiCall` → `captureHolds > 0` → `openGestureTask()` with no split (`src/components/modules/yjs/undo-history.ts:2143-2156`).
- **Inferred**: if an agent turn held capture across LLM awaits, a user keystroke would split the step, and the agent's NEXT write would then join the user's typing step. Not tested. This is why capture is never held across a model call (section 3.5, 06 C11).
- A merge lever exists: `continueEntryThatCreated` merges the next write into the newest stack item by setting `undoManager.lastChange = Date.now()` (`src/components/modules/yjs/undo-history.ts:1917-1930`). Verified by reading. Whether it can merge an agent batch into the turn's previous step, after `beginApiCall` has started a discrete gesture, is **unverified** (06 C11).
- The UndoManager tracks only the `'local'` origin: `trackedOrigins: new Set(['local'])` (`src/components/modules/yjs/undo-history.ts:393`).
- Any origin that is not a known local tag maps to `'remote'` (`src/components/modules/yjs/block-observer.ts:193-195`). The null-origin law explains why an untracked origin is wrong (`test/unit/architecture/null-origin-transaction-law.test.ts:1-30`).
- `history.track` exists for host values (`types/api/history.d.ts:37-55`). It is not needed here.

### 2.4 Events and attribution

- Block mutation events carry `origin?: 'local' | 'tab' | 'remote'` (`types/events/block/Base.ts:7`, `:13-23`). This union shipped in v1.16.1 (no change to the file since the tag).
- The event detail object is built when the event is emitted (`src/components/modules/blockManager/blockManager.ts:2118-2130`). So a field stamped there survives later batched delivery. Verified by reading.
- Edit metadata: each data-changing write stamps `block.lastEditedBy = this.config.user?.id ?? null` (`src/components/modules/blockManager/blockManager.ts:2689-2693`). That stamp runs inside a write callback, which can run after an await (06 C3). Saved as `lastEditedBy` (`types/data-formats/output-data.d.ts:102-106`). Configured by `user.id` (`types/configs/blok-config.d.ts:1300-1325`).
- Today an agent edit would be stamped with the human's id.

### 2.5 Showing remote work

- Remote carets are drawn by `createCaretLayer` (`src/components/modules/collaboration/presence-carets.ts:151`). Input is `CaretPeer { clientId, name, color, caret }` (`presence-carets.ts:7-15`). It keeps its own ledger keyed by `clientId` and removes only its own elements (`presence-carets.ts:157`, `:169-181`). So a second, independent caret layer does not clobber the collab one.
- The full `createPresenceRenderer` also draws a gutter avatar strip per block (`presence-avatars.ts:231-251`). Two renderers would stack two strips in one gutter. So the in-app agent uses the caret layer only.
- `CaretPosition { blockId, inputIndex, anchor, head }` (`src/components/modules/collaboration/caret-position.ts:22-29`). `anchor` and `head` are counted by `offsetWithin`, which returns `range.toString().length` over the input's DOM text (`caret-position.ts:54-61`). So they are UTF-16 code units of DOM text. How an inline embed's DOM counts there is **unverified** (section 3.7).
- Peer states are read through gates: a name is trimmed and capped (`presence-renderer.ts:78`, `:127`), a colour is kept only if `isPresenceColor` accepts it (`presence-renderer.ts:129`). Participant rows are built the same way in `buildParticipants` (`src/components/modules/collaboration/participants.ts:80-115`).
- `CollaborationParticipant` is a public, host-rendered type (`types/events/editor-events.ts:56`). It has no agent field today.
- The presence renderer never draws this editor's own client (`presence-renderer.ts:59`, `:261-274`). So a field this client publishes is drawn only in peers' browsers.
- New awareness information goes in a new field, never folded into an old one, because old clients read fields by name (`presence.ts:314-322`). A client publishes a field with `YjsManager.setAwarenessField` (`src/components/modules/yjs/index.ts:1341`).
- Palette: `presenceColorFor(clientId)` (`presence.ts:172-173`).
- The collaboration module is a static import of core (`src/components/modules/index.ts:48`), and it imports the renderer (`src/components/modules/collaboration/index.ts:18`). So the caret layer code is already in the core bundle.
- Arrival pulse: `highlightBlockArrival(el)` toggles `blok-block--target` on a holder (`src/components/utils/highlight-block-arrival.ts:19-50`). Writing a class on a holder is allowed by the child-holder decoration law (CLAUDE.md).
- `blocks.scrollToBlock(id, { select })` selects by default (`src/components/modules/api/blocks.ts:1162-1199`, `types/api/blocks.d.ts:486-487`).
- Screen reader announcements: `announce(message, config)` (`src/components/utils/announcer.ts:273`).

### 2.6 Read-only, notifier

- `history.undo/redo` return early while read-only (`src/components/modules/api/history.ts:53`, `:63`). `saver.save` throws while read-only (`src/components/modules/api/saver.ts:28`). `api/blocks.ts` has no such check (06 C18, B3). So 01's executor guards writes itself (section 3.3).
- `notifier.show(options)` (`types/api/notifier.d.ts`). Not used by this design: agent errors go back to the model, not to a toast.

### 2.7 Caret on local writes

- Only a remote rewrite captures and restores the user's caret: `origin === 'remote' ? captureCaretAcrossRewrite(...) : null` (`src/components/modules/blockManager/yjs-sync.ts:1316-1318`). Verified. 01's `EditorApplier` wraps a write to the user's caret block with the same capture (06 answer 03-Q5).

### 2.8 Lazy loading and packaging

- ES and CJS builds code-split dynamic imports into `dist/chunks/` (`vite.config.mjs:55`, `:61`). `dist/chunks/` holds split mermaid chunks today.
- **Unverified**: whether the UMD/IIFE builds split. They likely inline. Not checked.
- No new package subpath is needed. 04 bundles the renderer from source, as `@bloklabs/cli` already ships (06 C13).

### 2.9 LLM tool definition rules (primary sources)

- Anthropic: a tool is `{ name, description, input_schema }`. `name` must match `^[a-zA-Z0-9_-]{1,128}$` (platform.claude.com, "Define tools"). Dots are not allowed, so a command name like `table.insertRows` cannot be a tool name.
- Anthropic strict tool use: `strict: true` on the tool; every object needs `additionalProperties: false`; recursive schemas are not supported (claude-api skill, `shared/tool-use-concepts.md`, "JSON Schema Limitations").
- OpenAI structured outputs: "the root level object of a schema must be an object, and not use `anyOf`"; up to 5000 object properties and 10 levels of nesting; up to 1000 enum values (developers.openai.com, "Structured outputs").
- OpenAI function tool (Responses API): `{ type: 'function', name, parameters, strict }` (developers.openai.com, "Function calling"). The Chat Completions nested shape `{ type: 'function', function: {...} }` is **unverified** in this session.
- OpenAI function name character rules: the page I read does not state them. **Unverified**. The renderer uses the Anthropic regex, which is the stricter one I could confirm.
- Which schema keywords each provider rejects is **unverified**. The law test checks the rendered output (06 answer 02-Q9).

---

## 3. Design

### 3.1 Architecture

```
host app chat UI ──► host's LLM client ──► model
        ▲                    │ tool call {name, input}
        │                    ▼
        │            editor.agent.begin() → AgentTurn.call(name, input)
        │                    │  (AgentTurn is an AgentSession)
        │      ┌─────────────┼────────────────────────┐
        │      ▼             ▼                        ▼
        │  session.read   session.execute       session.describe
        │  (blok_read)    (blok_execute)        (blok_describe)
        │                    │
        │                    ▼ AgentResult.changed, lastRange
        │            AgentPresence: caret layer + arrival pulse
        └──── AgentToolResult {content, isError} back to the model
```

Three parts, all in core:

1. **`AgentAPI` module** (`src/components/modules/api/agent.ts`, per 06 §3.8). Registered in `API.methods` like the other namespaces. Owns turns, state and presence. Each turn wraps one `AgentSession` from 01's `createEditorAgentSession(editor, actor)`. Tools also receive `api.agent` this way. That is intended: a host's "AI block" tool can open a turn. It is harmless otherwise, because a turn does nothing until someone calls it, and only one turn can be open per editor.
2. **Renderer** `renderAgentTools` (`src/agent/render-tools.ts`, 06 §3.7). Pure and DOM-free. Turns an `AgentContract` into tool JSON. Loaded by dynamic `import()`. 04 bundles the same file from source with `format: 'mcp'`.
3. **Agent presence** (`src/components/modules/api/agent-presence.ts`). A private caret layer built with `createCaretLayer`, plus `highlightBlockArrival` on changed holders. It also marks remote agent participants (section 3.10).

No run loop. Blok does not call an LLM. The host owns its client, keys, model choice and chat UI. A run loop would pull a provider SDK into Blok's scope and duplicate the SDKs' own tool runners. A docs example shows the loop (section 4.4).

### 3.2 The fixed tool set

Blok exposes three core tools, identical on the in-app and MCP surfaces (06 C2). Each one renders an `AgentSession` method. None of them is a new command.

| Tool name | Renders | Input | Output |
|---|---|---|---|
| `blok_read` | `AgentSession.read` (01's `doc.read`) | `ViewArgs` | `DocumentView` |
| `blok_describe` | `AgentSession.describe` | `{ tool?: string; command?: string }` | `ContractSlice` (index with no args) |
| `blok_execute` | `AgentSession.execute` | `{ commands: AgentCommand[]; expectRevision?: string }` | `AgentResult` |

MCP adds `blok_list_documents`, `blok_open`, `blok_close` and a `handle` property. Those are 04's. The in-app surface does not render them.

Why three tools and not one per command:

- Command names like `table.insertRows` break the Anthropic name regex (section 2.9). A per-command set would need a renaming scheme nobody defines.
- The contract grows with host custom tools. Three fixed tools keep the prompt prefix stable, which keeps prompt caching working.
- Anthropic's docs advise "Consolidate related operations into fewer tools" (platform.claude.com, "Define tools").

`blok_execute` wraps the command list in an object property. That satisfies OpenAI's "root must be an object, not `anyOf`" rule.

Schema detail has two levels, chosen by the host. Both surfaces use the same mode (06 C2):

- `'envelope'` (default until 05's eval decides): `name` is an enum of `contract.commands[].name` and `args` is an open object. The model calls `blok_describe` for a command's argument schema. 01 validates the real args. Small and stable.
- `'full'`: items are a `oneOf` with one branch per command (06 §3.7). Larger. Allowed only when the result stays inside the OpenAI limits (5000 properties, 10 levels, 1000 enum values); otherwise the renderer throws `AgentToolsTooLargeError` naming the limit.

`strict`:

- `blok_execute` is **never** strict, in any mode. `block.insert.children` is recursive, and Anthropic strict mode rejects recursion (06 answer 03-Q6).
- `blok_read` and `blok_describe` get `strict: true` only when the host asks and every object in their schema is closed (`additionalProperties: false`). Otherwise the renderer throws `AgentToolsStrictError` naming the tool and the reason.

05 compares `'envelope'` against `'full'` on the same tasks. The result sets the shipped default (06 answer 03-Q12).

MCP `outputSchema` (renderer, `format: 'mcp'`): for `blok_read` and `blok_describe` it is `oneOf: [<success>, { error: AgentError }]`, because these can fail before a session exists. For `blok_execute` it is `AgentResult` (plus 04's `delivery`). The renderer emits the error branch; 04 does not wrap it (06 R2-04-3, R2-04-Q18).

### 3.3 Turns

A turn is one run of agent work the user can see, stop and undo. The host opens it when the model starts acting and ends it when the model's reply is done.

```ts
const turn = editor.agent.begin({ agent: { id: 'assistant', name: 'Assistant' } });
const result = await turn.call(toolUse.name, toolUse.input);
turn.end();
```

`AgentTurn` is an `AgentSession` (06 §3.5) plus `signal`, `call`, `end` and `stop`. So a host may call `turn.read()`, `turn.describe()`, `turn.execute()` and `turn.log()` directly, without going through tool JSON. The actor is bound when the turn opens. It is not passed per call.

`turn.call(name, input)`:

1. If the turn is stopped or ended: return `{ isError: true }` with a `CANCELLED` error. Nothing is applied.
2. Unknown `name`: return an `UNKNOWN_COMMAND` error listing the three valid names.
3. `blok_read`: `session.read(input)`. Never refused in read-only mode.
4. `blok_execute`: `session.execute(input, { signal: turn.signal })`. Every execute on a turn passes the turn's signal, including a direct `turn.execute(batch)` (06 R2-01-5).
   - Read-only is refused by 01's executor with `READ_ONLY`, before planning (06 C18). 03 does not guard it again.
   - On success, hand `result.changed` and `result.lastRange` to agent presence. Nothing else is needed: 01's dropped `AgentChange` has no replacement, and this spec needs none (06 R2-01-4).
5. `blok_describe`: `session.describe(input)`.
6. Return `{ content: JSON.stringify(result), isError }`. `isError` is `!result.ok` for `blok_execute`. On `ok: false`, `revision` may be absent (06 §3.2, R2-04-3). The host maps this to its provider's tool-result block (`tool_result` with `is_error` for Anthropic).

`turn.call` never throws for a model mistake. Model mistakes come back as `isError: true` so the model can correct itself. It throws only for host bugs, for example calling it after `editor.destroy()`.

Ending a turn: `end()` is the normal end. `stop()` aborts and ends. On a turn, the session's `close()` is `end()` (06 R2-03-3).

Concurrency: one open turn per editor. `begin()` while a turn is open throws `AgentTurnOpenError`. Calls inside a turn run in order. If the model sends parallel tool calls, the host may `await` them together; the turn queues them. Parallel calls that write would otherwise race on the same document.

Overrides: `BlokConfig.agent.overrides` (section 4.1) hides tools and actions from the contract the turn renders. It also refuses a hidden action at execute time, so a model that guesses its name still fails (06 answer 02-Q10). The refusal code is `UNKNOWN_COMMAND`, because a hidden action is absent from the contract (06 R2-03-7).

### 3.4 Stop and cancel

- `turn.stop()` aborts `turn.signal`, refuses later calls with `CANCELLED`, and ends the turn.
- 01 checks the signal at three points: before start, after `prepare`, and right before apply. Never during apply (06 R2-01-5).
  - Aborted before apply: nothing is written. The result is `CANCELLED`.
  - If `prepare` already did host work, the `CANCELLED` error carries `details.orphaned`, the same data as `ORPHANED_SIDE_EFFECT`.
  - Aborted during apply: the batch lands whole. Stop never leaves a half-applied batch.
- An action with host effects (`effects: 'host'`) must be alone in its batch, so nothing can fail after its host call (06 R2-02-3).
- Work already applied stays. The user undoes it with Cmd+Z (section 3.5).
- Core binds no key to stop. Escape in Blok closes one layer at a time, and a global Escape-to-stop would fight that. The host's chat UI owns the Stop button.
- `editor.destroy()` stops the open turn.
- `readOnly.set(true)` during a turn does not end it. Later `blok_execute` calls get `READ_ONLY`.

### 3.5 Undo

01 owns undo grouping. 06 C11 settles the rule:

- **One step per `execute`.** Capture is never held across a model call.
- **Turn merge.** A batch joins the turn's previous agent step only if that step is still the top of the undo stack and no user gesture started since. Otherwise it opens a new step.
- **The merge lever is unverified.** `continueEntryThatCreated` (`undo-history.ts:1917-1930`) is a precedent, but `beginApiCall` may split the step before a merge can land (`undo-history.ts:2143-2158`). Tests must pin R-U1 and R-U3 before this is called done.
- `history.undo` from an agent undoes only its own top step, else `UNDO_NOT_OWN` (01).

The guarantees this surface relies on:

- **R-U1**: Agent batches in one turn, with no user gesture between them, form one undo step. This holds across `await`s between tool calls. Depends on the unverified lever.
- **R-U2**: A user gesture during a turn closes the agent step. The user's own edit is its own step.
- **R-U3**: Agent batches after that gesture start a NEW agent step. They never join the user's step. Guaranteed by "merge only if the agent step is still on top".
- **R-U4**: Agent writes stay on the tracked `'local'` origin. No new origin (06 C3). A new Yjs origin like `'agent'` would be untracked (`undo-history.ts:393`) and mapped to `'remote'` (`block-observer.ts:193-195`).
- **R-U5**: `turn.end()` and `turn.stop()` close the agent step, so the user's next edit starts fresh.
- **R-U6**: Undoing an agent step must not put the user's caret inside agent content they never visited. Unverified how the caret-before snapshot behaves for writes made with no user caret move. Pin it with a test.

### 3.6 User and agent editing at once

The editor stays editable during a turn. Locking it would make a slow model freeze the user's work.

Rules:

1. **Focus-neutral**: no command moves the user's caret, selection, focus or scroll. `caret.set` is dropped from v1. Internal `scrollToBlock` calls use `{ select: false }` (06 C14, answer 03-Q3).
2. **Stale reads fail loudly**: a batch may carry `expectRevision`, and commands may carry `expectText`. On a mismatch 01 returns `STALE`. `STALE.details.current` holds the fresh outline entries (and field text) of the blocks the check named. Positions are ids, not child indexes. The model re-reads and retries (06 answer 03-Q2).
3. **The user's block**: when the agent writes into the block that holds the user's caret, `EditorApplier` wraps the write with `captureCaretAcrossRewrite`, the same capture remote rewrites use (`yjs-sync.ts:1316-1318`, 06 answer 03-Q5).
4. Agent presence follows the agent, not the user. If the user edits the block the agent caret sits in, the caret layer re-measures (`CaretLayer.reposition`, `presence-carets.ts:34-38`).

### 3.7 Live visibility

**Agent caret.** A private caret layer (`createCaretLayer`) draws one peer:

```ts
{ clientId: AGENT_CLIENT_ID, name: agent.name, color: agent.color ?? presenceColorFor(hash(agent.id)), caret }
```

- `AGENT_CLIENT_ID` is a negative constant. Awareness client ids are positive Yjs ids (unverified for every provider, so the layer is separate anyway and never sees awareness states).
- Name and colour go through the same gate the presence renderer applies to peers, because `CaretPeer` expects already-sanitized input (`presence-carets.ts:9-12`): trim, cap at 32 characters (`MAX_NAME_LENGTH`, `presence-renderer.ts:78`, `:127`), and keep the colour only if `isPresenceColor` accepts it, else fall back to the palette (`presence-renderer.ts:129`). Without this, a host's colour string would go straight into styling.
- `caret` comes from `AgentResult.lastRange: TextRangeRef { blockId, field, start, end }` (06 §3.2). Ranges name a data `field`, never a DOM input (06 C12). Mapping (06 §10.2, which replaces R2-03-1's "input 0" rule):
  - `inputFields` supplies a candidate raw index for a stable own top-level plain/rich-text field. Explicit `[]` disables inference. With no map, one rich field supplies candidate input 0.
  - The shared placement seam for local and peer callers must validate the live slot, connection and owned-field binding. Ancestry or input count alone does not establish a custom field binding.
  - Missing, detached, native `<input>`/`<textarea>`, nondata, foreign or ambiguous controls draw a **block-level marker** on the named block's holder. The child-holder decoration law allows holder decoration.
  - Retain the data-level target and revalidate when input topology changes. Clear an invalid caret and draw the block marker without a new execute/awareness message. Measure caption mount/unmount notification coverage; numeric repositioning or ResizeObserver alone is not proof. Keep human carets unchanged. These remain unmet Task14/16/24 consumer obligations (06 §10.2).
  - With no `lastRange` (insert, move), use the block-level marker on the last id of `changed.created`, else `changed.moved`, else `changed.updated`.
  - A batch that only sets page fields (`doc.setTitle`, `doc.setIcon`, 06 §10.1) touches no block. It draws no caret and no pulse.
- Units: the contract counts UTF-16 code units, one per embed (06 C12). `CaretPosition.anchor/head` count UTF-16 code units of the input's DOM text (`caret-position.ts:54-61`). They agree for plain text. They may differ when an embed's DOM holds text. That is **unverified**. 03 converts at the boundary, from contract units to DOM offsets, and clamps to the input's length. A test puts an embed before the range (section 6, test 19; 06 R2-03-6).
- The name label shows on arrival, using the layer's existing greet timer (`greetForMs`, `presence-carets.ts:24-25`).
- Hidden when `readOnly.hideControls` is on, like peers' carets (`presence-renderer.ts:32-36`).
- Removed on `turn.end()` / `turn.stop()`.
- **Shown to peers** (D6: kept in v1; 06 §10.2). During a turn, this client publishes the awareness field `agentCursor` beside its normal `caret`, with `YjsManager.setAwarenessField` (`yjs/index.ts:1341`). Shape (06 §10.2, verbatim):

```ts
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

  - Set after each successful `execute`, from `lastRange` (or the block-level rule above). It carries data fields and contract units, never `inputIndex`, so each browser maps it locally.
  - Set to `null` on `turn.end()` / `turn.stop()`.
  - One turn per editor, so one agent per client.
  - This client never draws its own `agentCursor` (`presence-renderer.ts:59`). Locally the private caret layer draws the agent.

**Changed blocks.** After each successful `execute`, every holder in `changed.created`, `changed.updated` and `changed.moved` gets `highlightBlockArrival(holder)`. The util removes the class on `animationend` or after a fallback timeout (`highlight-block-arrival.ts:44-49`). Whether the pulse CSS honours reduced motion is **unverified**; I did not read the stylesheet.

**Follow.** Off by default. With `begin({ follow: true })`, the editor scrolls to the agent's block with `scrollToBlock(id, { select: false })`. It stops following for the rest of the turn as soon as the user scrolls, types or clicks.

**Streaming.** Edits land per `execute` call, as the model emits each tool call. There is no character-by-character typing effect. A host that wants finer steps can ask the model for smaller batches.

**Screen readers.** `turn.end()` announces one polite message, for example "Assistant changed 4 blocks" (new i18n key, translated per the `blok-translations` skill). No per-command announcements; they would flood.

### 3.8 Attribution

06 C3 settles it.

- **One actor type.** `AgentIdentity` = `AgentActor` without `kind` (06 §3.5). The turn builds `AgentActor { ...identity, kind: 'agent' }` and passes it to `createEditorAgentSession`.
- **Per touched block.** The applier holds the set of block ids its batch touched until its undo group closes. A write to one of those ids stamps `lastEditedBy = actor.id`. Any other block keeps the human's id. This matters because the `lastEditedBy` stamp can run after an await (`blockManager.ts:2689-2693`), so a global "current actor" flag would mislabel the user's typing.
- **Events.** `BlockMutationEventDetail.agent?: { id: string; name: string; turnId: string }` is set for events built for those ids. The detail is built at emit time (`blockManager.ts:2118-2130`), so the field survives batched delivery. `origin` stays `'local'`.
- **Opt out.** `begin({ attributeTo: 'user' })` keeps `lastEditedBy` as the human's id. `detail.agent` is still set.
- **In a room.** The in-app agent rides the human's socket. So the room journal and frame 107 name the human, while saved `lastEditedBy` names the agent. This split is accepted (06 C3). Peers see agent edits as edits from this user's client. MCP agents are different: they join as their own actor (04).

### 3.9 State for UI

```ts
editor.agent.state   // { status: 'idle' } | { status: 'working', turn: { id, agent } }
editor.agent.subscribe(listener) // returns unsubscribe
```

Same shape as `Blok.subscribeReady` + `Blok.readyState` (`types/index.d.ts:653`, `:661`). It plugs into React `useSyncExternalStore`, a Vue `shallowRef`, or an Angular `signal` in one line. So there is no per-adapter hook. A hook would triple the hand-authored `.d.ts` surface for one line of glue.

### 3.10 Remote agents

Two awareness fields come from peers. Both are untrusted, so both are read through gates like `readName` and `isPresenceColor` (`participants.ts:105-107`, `presence-renderer.ts:127-129`).

**`agent`: the participant is an MCP agent.** Shape (06 R2-03-4): `agent: { via: 'mcp'; onBehalfOf: string; onBehalfOfName?: string }`. 04 publishes it.

- Only a string `via`, a string `onBehalfOf` and an optional string `onBehalfOfName` survive the gate. `onBehalfOfName` is trimmed and capped like a name. Anything else drops the field, and the peer is drawn as a plain participant.
- The peer's caret label and gutter avatar get an agent marker. The label reads "<agent name> for <name>".
- `<name>` is `onBehalfOfName` when present. Else it is the name on the participant row whose `userId` equals `onBehalfOf`. Else the label shows the agent name alone.
- `CollaborationParticipant` (`types/events/editor-events.ts:56`) gains `agent?: { via: string; onBehalfOf: string; onBehalfOfName: string | null }`, set only when the gate passes. A host's own participant list can then show the same marker (D4: approved; 06 R2-03-5).

**`agentCursor`: where an agent works.** Published by an MCP agent (04) and by other people's in-app agents (section 3.7).

- Gate: `actorId`, `name` and `blockId` must be non-empty strings. `name` is trimmed and capped. `color` survives only if `isPresenceColor` accepts it, else the palette colour. `field` must be a string. `start` and `end` must be non-negative integers, like `readCaret`'s `isOffset` (`caret-position.ts:108-109`, `:120`). A bad `field`/`start`/`end` falls back to block level. A bad `actorId`, `name` or `blockId` drops the cursor.
- Drawing follows section 3.7's mapping: a caret via `inputFields` when it maps and offsets are present, else a block-level marker. Carets go through a caret layer keyed by the peer's client id.
- An `agentCursor` from a client that also carries `agent` is that MCP agent's own cursor. An `agentCursor` from a human's client is that human's in-app agent. Its label reads "<agent name> for <human's name>".

Other facts:

- The C# live path has no socket, so no awareness. Its edits show, but no marker or cursor does (06 §7.4).
- The human's undo stays free of remote agents' edits. They arrive as remote updates, and remote origins are untracked (`undo-history.ts:393`).

### 3.11 Error handling

All errors use 06's `AgentError` shape and `AgentErrorCode` union (06 §3.2).

| Case | Behaviour |
|---|---|
| Model sends bad args | 01 returns `INVALID_ARGS`; `isError: true` to the model |
| Unknown tool name in `call` | `UNKNOWN_COMMAND`, listing the three names |
| Stale positions | `STALE` with `details.current` |
| Block gone | `BLOCK_NOT_FOUND` |
| Read-only | `READ_ONLY` from 01's executor on `blok_execute`; reads work |
| Turn stopped | `CANCELLED`; nothing applied |
| `begin()` while open | throws `AgentTurnOpenError` (host bug) |
| `call()` after destroy | throws (host bug) |
| Schema too large for `'full'` | `tools()` throws `AgentToolsTooLargeError` |
| `strict` asked but not possible | `tools()` throws `AgentToolsStrictError` |
| Lazy chunk fails to load | `tools()` / `guidance()` reject; turns still work |

---

## 4. Public surface

All new surface here is additive. D4 approved it, with a release note (section 4.5).

### 4.1 Types

New file `types/api/agent.d.ts`, exported from `types/api/index.d.ts`. Shared shapes (`AgentActor`, `AgentSession`, `AgentResult`, `AgentError`, `DocumentView`, `ViewArgs`, `ContractSlice`, `AgentContract`) live in `types/agent.d.ts` (06 §3.8). Both files are hand-authored with no `src/` imports (published-types law).

```ts
export interface Agent {
  /** LLM tool definitions for blok_read, blok_describe, blok_execute. Loads lazily. */
  tools(options: AgentToolsOptions & { format: 'anthropic' }): Promise<AgentAnthropicTool[]>;
  tools(options: AgentToolsOptions & { format: 'openai' }): Promise<AgentOpenAITool[]>;
  /** Guidance text for the system prompt, from AgentContract.guidance plus in-app rules. Loads lazily. */
  guidance(): Promise<string>;
  /** Open a turn. Throws when one is open. */
  begin(options: AgentTurnOptions): AgentTurn;
  readonly state: AgentState;
  subscribe(listener: () => void): () => void;
}

export interface AgentToolsOptions {
  /** 'openai' = OpenAI Responses API function tool. */
  format: 'anthropic' | 'openai';
  /** Default 'envelope'. */
  schema?: 'envelope' | 'full';
  /** Emit strict: true where possible. Never for blok_execute. Default false. */
  strict?: boolean;
}

/** The anthropic and openai branches of 06 §3.7's RenderedTool. RenderedTool itself stays internal (06 R2-03-8). */
export type AgentToolName = 'blok_read' | 'blok_describe' | 'blok_execute';
export interface AgentAnthropicTool { name: AgentToolName; description: string; input_schema: object; strict?: boolean }
export interface AgentOpenAITool { type: 'function'; name: AgentToolName; description: string; parameters: object; strict?: boolean }

/** 06 §3.5: AgentActor without kind. */
export type AgentIdentity = Omit<AgentActor, 'kind'>;

export interface AgentTurnOptions {
  agent: AgentIdentity;
  /** Scroll to the agent's block until the user scrolls. Default false. */
  follow?: boolean;
  /** Who lastEditedBy names. Default 'agent'. */
  attributeTo?: 'agent' | 'user';
}

/** 06 §3.5: an AgentSession plus signal, call, end, stop. */
export interface AgentTurn extends AgentSession {
  readonly signal: AbortSignal;
  call(name: string, input: unknown): Promise<AgentToolResult>;
  end(): void;
  stop(): void;
}

export interface AgentToolResult {
  /** JSON text, ready for the provider's tool-result block. */
  content: string;
  isError: boolean;
}

export type AgentState =
  | { status: 'idle' }
  | { status: 'working'; turn: { id: string; agent: AgentIdentity } };
```

`AgentActor` (06 §3.5, verbatim): `interface AgentActor { id: string; name: string; kind: 'agent'; onBehalfOf?: string; color?: string }`. `AgentTurn.id` and `AgentTurn.actor` come from `AgentSession`.

`format: 'mcp'` exists only on the internal `RenderOptions` (06 §3.7). The public `AgentToolsOptions` does not offer it. `RenderedTool` stays internal. `tools()` narrows its return type by `format`, so a host passes the result straight to its SDK with no cast (06 R2-03-8). A law test checks the two public interfaces match the renderer's branches.

`API` gains `agent: Agent`. `Blok` gets it through the existing merge (`types/index.d.ts:744`). `PendingBlok` does not list it, so it is unreachable before `isReady`, like `blocks`.

`BlockMutationEventDetail` gains `agent?: { id: string; name: string; turnId: string }` (06 §3.5).

`BlokConfig` gains `agent?: { overrides?: ManifestOverrides }` (06 answer 02-Q10). `ManifestOverrides` is 06 §3.6: `Record<string, { hidden?: boolean; hiddenActions?: string[]; guidance?: string }>`. No `agent` key exists in `types/configs/blok-config.d.ts` today (grep). Changing overrides changes `AgentContract.revision`.

`CollaborationParticipant` gains `agent?: { via: string; onBehalfOf: string; onBehalfOfName: string | null }` (section 3.10).

The awareness field `agentCursor` is a wire field, not a published TS type (like 04's `agent` field).

The `openai` format emits the Responses API flat shape I could verify. The Chat Completions nested shape is unverified (its API reference returned 403 to me); adding it is a one-line wrapper once someone confirms it.

### 4.2 Breaking?

Nothing in this spec is breaking under the repo rules. Every item is additive. D4 approved all of them:

- `agent` on `API`. It follows `media`, `viewState` and `marks`, none labelled BREAKING (section 2.1).
- One edge to tell the user about: a consumer who hand-implements the full `API` interface (a test mock typed `API`) will get a TS error for the missing `agent`. The same was true for `media`, `viewState` and `marks`. The release note says so (section 4.5).
- `BlockMutationEventDetail.agent` is optional.
- New config key `BlokConfig.agent.overrides`. Optional, so existing configs still type-check.
- `CollaborationParticipant.agent` is optional. D4 lists it (06 R2-03-5).
- New awareness field `agentCursor`. Old clients ignore unknown fields (`presence.ts:314-322`).
- `BlockMutationOrigin` is NOT widened. Adding `'agent'` to that shipped union would break consumers' exhaustive switches.
- `lastEditedBy` keeps its shape. Its value can now be an agent id, but only inside turns, a feature that does not exist yet.
- No data attribute and no CSS variable change.

### 4.3 Bundle cost

- Always loaded: `AgentAPI` (turn bookkeeping, state, queue) and agent presence. The caret layer and the pulse are already in core (section 2.5). Estimated at a few KB minified. **Unverified** until measured after build.
- Lazy: the renderer and the guidance text, via `import()` inside `tools()` / `guidance()`. ES/CJS split them (section 2.8). UMD/IIFE likely inline them; unverified.
- No new package subpath (06 C13).

### 4.4 Host wiring (docs example, not shipped code)

```ts
const tools = await editor.agent.tools({ format: 'anthropic' });
const system = await editor.agent.guidance();
const turn = editor.agent.begin({ agent: { id: 'assistant', name: 'Assistant' } });
stopButton.onclick = () => turn.stop();
try {
  // host's own loop with its own SDK; for each tool_use block:
  //   const r = await turn.call(block.name, block.input);
  //   push { type: 'tool_result', tool_use_id: block.id, content: r.content, is_error: r.isError }
} finally {
  turn.end();
}
```

### 4.5 Release note (D4)

03 owns the `editor.agent` docs, so it owns this list (06 §11, 03 item 11). The release note lists every new public item from D4 (06 §5):

- `editor.agent` (`Agent`, `AgentTurn`, the option, state and tool types in section 4.1).
- `BlockMutationEventDetail.agent`.
- Config key `BlokConfig.agent.overrides`.
- `CollaborationParticipant.agent`.
- Tool statics `describe` and `actionHandlers` (02).
- Exports `buildToolManifest`, `validateAgainst` (02).
- Published types `InsertSpec`, `RichTextHelpers`, `BlokCustomToolsFile` (01, 02, 04).
- `doc.setTitle` / `doc.setIcon` commands and the optional saved `page` field on `OutputData` (06 §10.1).
- Awareness fields `agent` (04) and `agentCursor` (06 §10.2).
- NuGet `Blok.Server`: new interface `IBlokAgentExecutor` (06 §7.3).
- The edge: a hand-written implementation of the full `API` interface needs an `agent` member.

The same release also carries 01's separate `BREAKING` commit for `blocks.convert` overrides (D5). That note is 01's, not 03's.

---

## 5. Interfaces

### 5.1 Provided

- `Agent`, `AgentTurn`, `AgentToolsOptions`, `AgentAnthropicTool`, `AgentOpenAITool`, `AgentToolName`, `AgentIdentity`, `AgentTurnOptions`, `AgentToolResult`, `AgentState` (section 4.1).
- `BlockMutationEventDetail.agent` (section 3.8).
- `BlokConfig.agent.overrides` (section 4.1).
- `CollaborationParticipant.agent` and the drawing of remote agent participants (section 3.10).
- The awareness field `agentCursor`, published during a turn and drawn for peers (sections 3.7, 3.10).
- The three core tool names `blok_read`, `blok_describe`, `blok_execute`, and their mapping to `AgentSession` methods (section 3.2).
- The pure renderer, internal, in `src/agent/render-tools.ts` (06 §3.7, verbatim):

```ts
type AgentToolName = 'blok_read' | 'blok_describe' | 'blok_execute';

interface RenderOptions {
  format: 'anthropic' | 'openai' | 'mcp';
  schema?: 'envelope' | 'full';     // default 'envelope' until 05 decides
  strict?: boolean;                 // never for blok_execute (recursive children)
  /** MCP only: adds `handle` with `x-mcp-header: "Blok-Handle"` to every core tool. */
  handle?: boolean;
}
// 06 R3-1: no `runtime` option. The renderer lists only `available: true` commands;
// buildAgentContract decides availability for the runner.

function renderAgentTools(contract: AgentContract, options: RenderOptions): RenderedTool[];
```

`editor.agent.tools()` calls it with `{ format, schema, strict }` on a contract built with `where.runtime: 'editor'`. 04 calls it with `{ format: 'mcp', handle: true }` on a contract built for Node. `blok_execute` input is `{ commands: AgentCommand[]; expectRevision?: string }`. Tool names match `^[a-zA-Z0-9_-]{1,128}$`.

### 5.2 Consumed

From **01** (06 §3.2, §3.3, §3.5):

- `createEditorAgentSession(editor: InternalEditorHandle, actor: AgentActor): AgentSession`.
- `AgentSession.read(args?: ViewArgs): Promise<DocumentView>`, `describe(query?: { tool?: string; command?: string }): AgentContract | ContractSlice`, `execute(batch: AgentBatch, options?: { signal?: AbortSignal }): Promise<AgentResult>`, `log(): readonly CommandLogEntry[]`, `close(): void`.
- The three `CANCELLED` check points and `details.orphaned` (06 R2-01-5).
- `AgentBatch { commands: AgentCommand[]; expectRevision?: string }` and `AgentCommand { name: CommandName; args: Record<string, unknown>; ref?: string }`.
- `AgentResult` with `changed: ChangedSet { created; updated; moved; removed }` and `lastRange?: TextRangeRef { blockId; field; start; end }`. Used to place the agent caret and pulse. `revision` is optional on `ok: false`. No `AgentChange` is needed (06 R2-01-4).
- Atomic batches: all commands land or none do.
- `AgentError` and the `AgentErrorCode` union. This spec uses `INVALID_ARGS`, `UNKNOWN_COMMAND`, `BLOCK_NOT_FOUND`, `STALE`, `READ_ONLY`, `CANCELLED`, `UNDO_NOT_OWN`.
- The read-only guard in the executor (06 C18).
- Per-touched-block attribution and `detail.agent` (06 C3).
- Caret capture on writes to the user's caret block (06 answer 03-Q5).
- Undo: one step per `execute`, plus the turn-merge rule (06 C11).

From **02** (06 §3.6):

- `AgentContract { formatVersion; revision; commands: CommandEntry[]; manifest; guidance: AgentGuidance }`, built by `buildAgentContract` from `buildToolManifest(snapshot, overrides)`.
- `AgentGuidance { general; commands; tools }`. `guidance()` joins `general` with in-app rules.
- `ManifestOverrides` for `BlokConfig.agent.overrides`.

From **02**, also:

- `inputFields?: string[]` on `BlockToolDescription`, for mapping a data field to a DOM input (06 §10.2).

From **04**:

- The awareness field `agent: { via: 'mcp'; onBehalfOf: string; onBehalfOfName?: string }` (06 R2-03-4).
- The awareness field `agentCursor` published by an MCP agent (06 §10.2).

---

## 6. Testing strategy

TDD throughout: each test is written and seen failing before the code.

Test numbers 1-16 keep their first-draft numbers, because other specs cite them (05 cites item 12). New tests are 17 onward.

Unit (vitest, jsdom):

1. `AgentAPI`: `begin` twice throws; `call` after `stop` returns `CANCELLED` and applies nothing; calls inside a turn run in order; `state` and `subscribe` fire on begin/end/stop; `destroy` stops the turn; `turn.read/describe/execute/log` reach the session.
2. Read-only: `blok_execute` returns `READ_ONLY`, `blok_read` works.
3. Renderer: every name matches `^[a-zA-Z0-9_-]{1,128}$`; every root schema has `type: 'object'` and no root `anyOf`/`oneOf`; `blok_execute` never carries `strict`, in either mode, even when `strict: true` is asked; `strict` on `blok_read`/`blok_describe` only with closed objects, else `AgentToolsStrictError`; `'full'` over the OpenAI limits throws. Run against a fixture contract with a host custom tool. `format: 'mcp'` with `handle: true` adds `handle` to all three tools.
4. Attribution: a block changed by the agent carries `detail.agent` and `lastEditedBy === agent.id`; with `attributeTo: 'user'` it carries the user id; outside a turn neither changes.
5. Presence: after `execute`, the caret layer draws exactly one agent caret in the touched block; `end` removes it; `hideControls` hides it; the collab caret layer is untouched.
6. Focus neutrality: after `execute`, `document.activeElement`, the selection range and `window.scrollY` are unchanged (without `follow`).

Undo pinning (with 01's implementation; fails first against today's code):

7. R-U1: two `execute` calls with an `await` between them → one Cmd+Z reverts both.
8. R-U3: `execute`, user types, `execute` → three steps; undoing once reverts only the last agent batch; the user's text is never reverted together with agent text.
9. R-U4: after `execute`, `history.canUndo()` is true.

Law tests:

10. Existing `blok-class-api-parity-law.test.ts` covers `editor.agent` for free.
11. New `agent-tool-definition-law.test.ts`: renders tools from the live contract of `full` tools and checks the provider rules from test 3. A new tool with a bad schema fails here.
12. New `adapter-blok-instance-law.test.ts`: React, Vue and Angular published types expose the core `Blok` type for the live instance, so `agent` stays reachable with no adapter code (06 answer 05-Q5).

E2E (Playwright, a scripted fake model, no network):

13. A turn inserts a heading and a list: agent caret visible with its name; changed blocks pulse; one Cmd+Z removes both.
14. User types in another block mid-turn: their text survives undo of the agent step and vice versa.
15. Stop mid-turn: no later command lands.
16. Same flow mounted through `@bloklabs/react`, `@bloklabs/vue` and `@bloklabs/angular` fixtures via the instance ref.

Added after 06 (unit, vitest, jsdom, unless noted):

17. Attribution, user types elsewhere (06 C3): during a batch's open undo group, the user types in another block. That block keeps the human's id and its event has no `detail.agent`.
18. R-U6: undoing an agent step leaves the user's caret outside agent content.
19. Caret mapping: explicit-empty maps disable inference; supported own plain/rich-text fields retain raw indices; missing, detached, foreign, nondata, native and ambiguous controls use the named block's marker. Local and peer callers share the live binding guard and fall back after caption removal without a new target message. A range after an inline embed converts to the right DOM offset (06 R2-03-6).
20. Overrides: an action hidden by `BlokConfig.agent.overrides` is missing from `tools()` output and is refused at execute time.
21. Remote agent participant: a valid `agent` field draws the marker and "for <name>" (from `onBehalfOfName`, else the row by id, else nothing); a malformed `agent` field draws a plain participant; `CollaborationParticipant.agent` is set only for the gated case.
22. Law: existing `published-types-no-src-refs.test.ts` covers `types/agent.d.ts` and `types/api/agent.d.ts`.
23. Cancel points: `stop()` before start, after `prepare`, and right before apply each return `CANCELLED` with nothing written; after `prepare` did host work, the error carries `details.orphaned`; `stop()` during apply lets the batch land whole.
24. `close()` on a turn behaves exactly as `end()`.
25. Publishing `agentCursor`: after `execute`, this client's awareness carries `agentCursor` with the batch's `blockId`/`field`/`start`/`end`; `end()` and `stop()` set it to `null`; the local presence renderer does not draw it.
26. Drawing peers' `agentCursor`: a valid cursor draws a caret or a block-level marker; a malformed one is dropped or falls back per the gate in section 3.10.
27. Renderer, MCP format: `blok_read` and `blok_describe` `outputSchema` is `oneOf` with an `{ error: AgentError }` branch; `blok_execute` has none.
28. Public tool types: `AgentAnthropicTool` and `AgentOpenAITool` match the renderer's `anthropic` and `openai` branches.
29. E2E: two pages in one room, on the existing collab harness (`test/playwright/tests/helpers/collab.ts`, used by `test/playwright/tests/modules/collaboration.spec.ts`; commit a5c4e93a). An in-app turn on page A shows the agent's marker or caret on page B, and it goes away on `end()`. Limits of the harness:
    - It relays awareness frames (`collab.ts:56`, `:259`), but it does not send the join-time `QueryAwareness` nudge or the identities frame 107. Its own header says presence and participants must not be tested on it without extending it first (`collab.ts:37-45`). So this test first extends the relay with the `QueryAwareness` nudge.
    - With no frame 107, rows have no verified `userId`. So the "for <name>" lookup by `onBehalfOf` (test 21) stays a unit test here. `agentCursor` from the human's client does not need frame 107.
    - At most two clients per room (`collab.ts:32`). That is enough for this test.

---

## 7. Open questions for other specs

All questions from the first draft are answered by 06. None is open.

1. **To 01** (attribution beside `'local'`). **Resolved** (06 answer 03-Q1, C3): per-touched-block attribution beside `'local'`. Section 3.8.
2. **To 01** (revision and `stale`). **Resolved** (06 answer 03-Q2): `expectRevision` and `expectText`; `STALE.details.current` holds fresh outline entries. Section 3.6.
3. **To 01** (focus neutrality). **Resolved** (06 answer 03-Q3, C14): every command is focus-neutral; `caret.set` dropped; internal `scrollToBlock` uses `{ select: false }`.
4. **To 01** (who refuses read-only writes). **Resolved** (06 answer 03-Q4, C18): 01's executor.
5. **To 01** (caret on local rewrites). **Resolved** (06 answer 03-Q5): `EditorApplier` wraps writes to the user's caret block with `captureCaretAcrossRewrite`.
6. **To 01** (recursive args). **Resolved** (06 answer 03-Q6): yes, `block.insert.children` is recursive; `strict` is never emitted for `blok_execute`.
7. **To 01** (R-U1..R-U6). **Resolved by design** (06 answer 03-Q7, C11): one step per `execute`, merge only when the agent step is still on top. The lever is unverified; tests 7, 8, 9 and 18 pin it.
8. **To 02** (stable names as enum). **Resolved** (06 answer 03-Q8): yes.
9. **To 02** (guidance shape). **Resolved** (06 answer 03-Q9): sections, `AgentGuidance`.
10. **To 04** (same tools on MCP). **Resolved** (06 answer 03-Q10, C2, C13): same three core tools; no `./agent` subpath, 04 bundles the renderer from source.
11. **To 04** (publish the in-app agent caret). **Resolved, then changed by D6** (06 §5 D6, §10.2): peers see it through the new awareness field `agentCursor`. Section 3.7.
12. **To 05** (envelope vs full eval). **Resolved** (06 answer 03-Q12): yes; the result sets the default.
13. **To 05** (what counts as reachable). **Resolved** (06 answer 03-Q13): listed in the contract plus covered by a parity case.

---

## 8. Out of scope

- A run loop, an LLM client, or any provider SDK inside Blok.
- Chat UI, Stop button UI, model or key management. The host owns them.
- Accept/discard review of agent changes (a pending layer). Undo covers rollback for now.
- A character-by-character typing effect.
- Per-adapter hooks (`useAgent` …). `state` + `subscribe` cover them.
- `caret.set` (06 C14).
- File uploads; media is set by URL only (D6: cut).
- Undo of agent work from Node or C# in a live room (D6: cut). Browser undo is unaffected.
- View-state control (D6: cut, user can revisit).
- Custom tool action handlers outside the browser (D6: cut, user can revisit).
- A public page-change event API. Not in v1: the agent does not need it, and it is not in D4's approved list (06 R3-8).
- The MCP lifecycle tools and the MCP server (04).
- The commands, the document view and the manifest themselves (01, 02).

---

## 9. Issues with 06

None open (closed in 06 round 3).
