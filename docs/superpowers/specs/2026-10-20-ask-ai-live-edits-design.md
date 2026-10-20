# Ask AI: live edits and an in-page bar

Date: 2026-10-20. Status: waiting for user approval. Calls marked "(my call)" were made by Claude, not by the user; check them.

## Why

The user says Ask AI "does not feel like smart AI, rather like a stupid chat, and it looks ugly."
What they want is the Cursor feeling: **the edits appear live in the document**, and you watch them happen.
They picked the look from clickable mockups (in `.superpowers/brainstorm/89831-1792454953/content/`, untracked):

- `live-edits-ac.html`: the motion. Of everything in it, the user kept only **shimmer slots** and the **violet word tail**.
  The named caret and the aura glow were dropped.
- `inline-bar.html`: the final mockup the user approved ("It does feel right, build it").
  It shows the bar placement copied from Notion's "Edit with AI".

## What the user decided

1. **Live edits come first.** Restyling the bar is part of this work, but the edits are what matters most.
2. **Real streaming, not an animated reveal.** Blok reads each edit while the model is still writing it, and the words appear as they arrive.
   - The user chose this over a cheaper option, "apply each finished step, then fade the words in".
   - So **never call a reveal effect "live"**. A reveal is allowed only as the fallback described below.
3. **The motion is two things only:**
   - **Shimmer slots:** soft violet-gray bars with a moving shine, at the spot where blocks are about to appear.
   - **Violet word tail:** each new word fades in from a slight blur. The last ~2 words carry a violet gradient that fades to ink.
   - **Removed:** the local agent caret with its name flag, the aura or glow box, and the 1.5s `.blok-block--target` arrival pulse on agent edits.
4. **The bar goes in the page, at the caret, the way Notion does it.**
   - Cmd/Ctrl+J opens the bar at the caret's block, as wide as the content column. It is not docked at the bottom.
   - While working, its field shows one status line with a light shine sweeping across the text: "Reading the page…", "Writing a section…".
   - New content appears just below the bar, or in place for a rewrite.
   - When it's done, the bar becomes a one-line summary with **Undo** and **✓ (Keep)** icon buttons.
5. The user agreed that the send button is **dark ink, not blue**. This follows the house rule on selected states.
6. **All four model adapters get built-in streaming in this work** (Anthropic, OpenAI, OpenAI-compatible, Gemini).
   - A host that gives an adapter a streaming transport gets live edits with no other code.
   - The playground and dev route must not be the only path that streams.

## Goals

- When a model streams, the user sees text land word by word in the right block while the model is still writing it.
- Shimmer slots open at the real target as soon as Blok knows it. That holds for inserts, and for rewrites once the target id has streamed.
- The bar sits in the page at the caret and reads as part of the document, not as a chat window.
- Undo, Discard, save, onChange and collaboration still see **one committed step per `blok_execute` batch**, exactly as today.

## Non-goals

- Streaming the model's own prose or notes into the bar. The user removed `onText` on 2026-10-19: no verbose model notes, one status line per step. That rule still holds. Only edits stream.
- Per-change review (Cursor-style green and red diff with keep or undo per hunk). It was shown as option B and not picked.
- A chat history panel.

## Anti-goals (it fails even if it "works")

- It looks or behaves like a chat window.
- Words pop in a whole batch at a time when the model is streaming.
- A half-written edit leaks into saved data, undo history, onChange or Yjs. Collaborators must never see a partial word as a real edit.
- Blue selected or confirm states. Hints that appear without a hover delay.

## Constraints from the code (verified this session)

- **How it works now:** `runAssistantLoop` (`src/agent/assistant-loop.ts`) awaits `model(request)` and gets one complete `AgentModelResponse`. Only then does it run the tool calls in order. Each `blok_execute` is applied by `editor-applier.ts` as one transaction, rolled back if it fails, and merged into the turn's undo step (`mergeSteps: 'turn'`, `api/agent.ts:281`).
- **The adapters never fetch.** The four in `src/agent-models/` (anthropic, openai, openai-compatible, gemini) build a provider body and call the host's `options.send(body, {signal, model, thinking})`. They wait for one JSON reply (`shared.ts:18`, `:110`). There is no SSE helper in the repo.
- **Dev route and playground:** `scripts/dev-ai.mjs` streams NDJSON (`delta` / `message` / `error`). It holds `input_json_delta` back until `content_block_stop`, and it never forwards `content_block_start`. `src/playground/ai-model.ts` skips the deltas.
- **`blok_execute` input:** `{commands:[{name, args, ref?}]}`.
  - `block.insert` carries `type`, `data`, `position` (`'start'|'end'|{before}|{after}`) and `parentId`.
  - `text.replace` carries `id`, `field?`, `range` and `with`.
  - `markdown.insert` carries `markdown` and `position`.
  - The schemas are in `src/shared/agent/commands.ts`.
- **Release status:** every Ask AI and agent-model surface (`types/api/agent.d.ts`, `src/agent-models/`, `src/components/modules/assistant/`) was added after the last release, v1.16.1. That release's `types/api/agent.d.ts` has no `AgentModelRequest`. **So no change here is BREAKING.**
- **Blok's laws:**
  - Never put foreign DOM between block holders. `setBlockParent`, `mountChildBlocks` and `caret.ts` treat holders as siblings, and wrappers or stray nodes corrupt reparenting and caret moves.
  - Writing attributes, classes or styles onto a block's **holder** is inert. This is the child-holder decoration law in CLAUDE.md.
  - No inline `<svg>` in `src`.
  - Colors must be tokens.
  - Honor reduced motion.
  - No blue selected states.
  - Hints show on hover only, after a delay.
  - "No focus ring on click."

## Design

### 1. Streaming path (model → loop)

- **Request hook.** Add an optional `onStream(event)` to `AgentModelRequest`. It is a typed, structured edit-progress channel, not text:
  - `{type:'tool_start', index, id, name}`
  - `{type:'tool_input', index, partialJson}`
  - `{type:'tool_end', index}`
  - The promise still resolves with the full `AgentModelResponse`. That full response stays the only source of truth for what gets applied.
- **Adapters.** Each adapter gets an optional host transport for streaming, next to `send`. Working name: `stream(body, ctx)`, returning an `AsyncIterable` of the provider's raw stream events.
  - The adapter turns those provider events into `onStream` events and puts the final response together itself. Anthropic streams `input_json_delta`, OpenAI Responses streams `function_call_arguments.delta`, Chat Completions streams `tool_calls[].function.arguments`, and Gemini streams `streamGenerateContent`.
  - If the host gives only `send`, nothing changes, and the fallback (section 4) is used.
  - Exact names are the builder's call; keep them consistent across the four adapters.
- **Dev route and playground.** `dev-ai.mjs` forwards tool-call start and input deltas as new NDJSON line types. `ai-model.ts` passes them into `onStream`.
- **Loop.** `runAssistantLoop` passes a handler that sends each `blok_execute` stream to a **live-preview controller**. A partial-JSON reader pulls out the commands, arguments and growing strings that are complete so far.
- **Commit timing (my call).** A streamed `blok_execute` is applied as soon as its own `tool_end` arrives and its input parses. Blok does not wait for the full model response.
  - Each batch is still one transaction and one merged undo step.
  - Tool results are collected in call order and sent back with the next request, as today.
  - **Stop:** batches already applied stay. The rest of the stream is dropped and its preview is cleared. Today, batches applied before Stop stay too.
  - **`max_tokens`:** the cut-off call never reaches `tool_end`, so its preview is cleared and it is answered "not run", as today.
  - **Refusal:** batches already applied stay applied, and the turn is not added to the conversation, as today. The bar shows the refusal.
  - Without a stream, timing is unchanged.
- **Where the agent writes (my call).**
  - The system context tells the model where the bar is and asks it to write there, unless the request clearly targets another place.
  - When a live edit happens out of view, the page follows it using the existing follow-scroll. The bar stays at its anchor.

### 2. Live preview (never touches the document)

The preview is a **visual layer**. It does not edit the document.

- **Insert** (`block.insert` or `markdown.insert`): once `position` resolves, the controller opens a gap at that spot.
  - The gap is a margin or CSS variable written on the neighbouring holder, which is inert.
  - Shimmer slots and the streaming text are drawn in an overlay that sits outside the block tree and is placed in that gap.
  - Slot count and type follow what has streamed so far: a heading slot, list-item slots, and so on.
- **Rewrite:** these must all stream (my call):
  - `text.replace` on a whole field
  - `text.replace` on a range
  - `block.update` that changes a text field
  - Once the target `id` arrives, the target block's content is hidden through a holder attribute and CSS. The overlay draws the block's text with the streaming span in place, using the word tail.
  - For a range, the text outside the range stays visible.
- **Commit:** when the tool call ends and `editor-applier` applies the batch as it does today, the real blocks render. In the same frame the overlay goes away and the holder attributes and gap are cleared, so nothing jumps.
  - If the batch fails or is rolled back, the overlay goes away and the original content shows again.
- The preview uses Blok's real typography for the block type (heading or paragraph font sizes), so the hand-off from preview to real block is seamless.
- Since nothing in the document changes before commit, undo, save, onChange and Yjs stay the same. Remote collaborators see the committed batch, as today.

### 3. The in-page bar

- **Placement.**
  - The bar stays in its current portal (body or top layer).
  - On open it **anchors to the caret's block**: it opens a gap under that block's holder with an inert holder write, and places itself over the gap at content-column width.
  - It follows the anchor on scroll, resize and layout changes. If the anchor block disappears, it falls back to the nearest surviving block.
  - Bottom docking is removed.
- **States** (same views as today, new look):
  - **prompt:** sparkle icon (existing icon, no inline svg), field, send button (ink).
  - **working:** sparkle wobbles. The field shows the step status line with a shine sweep. Stop replaces send.
  - **answered:** one-line summary, then Undo and ✓ (Keep).
  - **error:** inline alert.
- **The model's final reply.** The summary line is the first line of the reply.
  - A longer reply opens below the summary as a compact panel attached to the bar, using today's markdown rendering with images as alt text.
  - Builder's call: whether that panel is collapsed by default.
- **Kept as is:**
  - thinking-level picker (shown only with 2+ levels)
  - follow-up prompts in the same turn
  - Escape: stops while working, otherwise closes
  - Enter, Shift+Enter and IME handling
  - `role=dialog`, `role=status`, `role=alert`
  - `data-blok-keyboard-owner`
  - focus and selection restore on close
  - read-only: no open, and switching to read-only closes the bar
  - RTL through `syncPortalDirection`
  - Discard's "Nothing was undone…" message
  - the 1.5s write-status hold
- **Inline toolbar "Ask AI":** the bar anchors under the block holding the selection's end. The selection context is captured as it is today.
- **Tokens:** add tokens for the violet tail end color, the shimmer base and highlight, and the bar surface and shadow. Each needs a dark-mode value.

### 4. Fallback when the host can't stream

The batch commits as today. Then the newly written text plays the word-tail reveal over the committed blocks. This only re-plays the visuals; the data is already there.
Shimmer slots show under the bar while the model works, because without a stream Blok does not know where a rewrite will land.
The docs must describe this as the non-streaming fallback.

### 5. What is removed

- The local agent caret and name flag, and the `.blok-block--target` pulse, for Ask AI runs (`agent-presence.ts` `show`).
- **My call:** the Yjs `agentCursor` that remote peers see stays as it is. Only the local drawing goes.
- The bottom-docked bar layout and the "breathing" sparkle.

## Left to the builder

- Exact names: `onStream`, the adapter `stream` option, the NDJSON line types, tokens, and CSS classes.
- Which partial-JSON reader to use (a small hand-written one is fine, with no new runtime dependency), and how to resolve `$ref` ids inside a batch.
- Preview handling for commands other than insert and replace (`block.delete`, `block.move`, `text.format`, `block.convert`).
  - Suggestion: delete fades the block out on commit.
  - Others: no preview, just commit.
- Placement inside tables, toggles and columns, and narrow widths. The bar must stay inside the content column and never overlap the toolbar.
- Speed limits: if deltas arrive faster than the eye can follow, buffer them so words land at a readable pace. When the commit arrives, catch up at once.

## Testing (TDD per CLAUDE.md)

- **Unit:**
  - the partial-JSON reader
  - each adapter's stream parsing, using recorded provider event fixtures
  - the loop sending `onStream` to the controller
  - preview controller states: slot open, text grow, commit clears, rollback restores
  - the bar's states and anchoring
- **Architecture:** a test that no preview code inserts nodes into the block container. Overlay only.
- **E2E (`test/playwright/tests/agent/`):**
  - A scripted streaming model makes the words appear before the batch commits.
  - Saved data has no partial text mid-stream.
  - Undo removes the whole turn.
  - The bar opens at the caret block.
  - The answered state shows Undo and ✓.
  - Reduced motion shows text without animation.
- **Playground:** the dev route streams tool input, verified in a real browser with the `verify` skill.
