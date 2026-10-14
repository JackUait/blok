# In-editor AI assistant

Date: 2026-10-14. Goal (user): let users write and edit with an LLM, through Blok's MCP tools, right inside the editor.

## Decision reversed

Spec 03 (`../2026-10-08-agent-control/03-in-app-surface.md` §3.1) said "No run loop. Blok does not call an LLM." The user now asks for in-editor writing. So Blok runs the loop. It still never holds a key or imports a provider SDK. The host passes one `model` function.

## Shape

- `BlokConfig.agent.assistant = { model, name?, maxSteps? }`. `model(request)` gets `{ system, messages, tools, signal }` in Anthropic Messages form and returns `{ content, stop_reason }`. A host forwards it to its backend, which calls the LLM.
- The tools are the same three `@bloklabs/mcp` serves (`blok_read`, `blok_describe`, `blok_execute`), rendered by the same `renderAgentTools`. It is the MCP tool contract, not the MCP transport.
- `src/agent/assistant-loop.ts`: pure loop. Echoes each assistant message back whole (thinking blocks stay). Handles `tool_use`, `end_turn`, `max_tokens`, `refusal`, `pause_turn`, a step cap and abort.
- `editor.agent.ask(prompt, { selection? })` returns an `AgentRun`: `done`, `stop()`, `followUp(prompt)`, `discard()`, `end()`. The turn stays open until `end()` or `discard()`, so Discard can run the session's own `history.undo` (refused with `UNDO_NOT_OWN` if the user edited after it).
- UI: an "Ask AI" prompt bar below the focused block. Opens with Mod+J, from the inline toolbar ("Ask AI" on a selection), or `editor.agent.openAssistant()`. States: prompt → working (Stop) → done (reply, Keep / Discard, follow-up input).
- The selection is passed as context in the first user message (`DocumentView.selection` is never filled by the editor).
- Playground: `yarn serve` adds an `/ai` endpoint that calls the Anthropic API with `ANTHROPIC_API_KEY`. Without a key the bar shows the error.

## Follow-up (not built)

A server-side route where the backend runs the loop with `@bloklabs/mcp` joined to the live room as its own participant.
