# Assistant model adapters and thinking levels — design

Date: 2026-10-15
Status: draft, waiting for review

## Goal

1. A host developer can run the in-editor assistant (Ask AI, `editor.agent.ask`)
   on any LLM — Claude, GPT, Gemini, DeepSeek, Mistral, Groq, Ollama, OpenRouter —
   without writing message translation by hand.
2. When the host allows two or more thinking levels, the end user can pick one
   in the assistant bar.

## Decisions already made (by the user, 2026-10-15)

- Blok ships the adapters itself, hand-written, with no runtime dependencies.
  No AI SDK, LangChain or vendor SDK inside Blok.
- The host still makes the HTTP call through its own backend. The API key never
  reaches the page.
- Thinking levels are a fixed set that Blok names and translates. The host picks
  which ones to allow.
- End users get only the thinking toggle. There is no model picker in the bar.

## Not a breaking change

The whole `editor.agent` surface landed after v1.16.1 (`4ab80b1c` and later), so
reshaping it needs no `BREAKING` label. `AgentModel` keeps its current shape, so a
hand-written `model` function keeps working.

## Public surface

### Config

```ts
interface AgentAssistantConfig {
  model: AgentModel;
  name?: string;
  maxSteps?: number;
  /** Levels the user may pick. The toggle shows only with two or more. */
  thinking?: {
    levels: AgentThinkingLevel[];
    /** Must be one of `levels`. Default: the first level. */
    default?: AgentThinkingLevel;
  };
}

type AgentThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

interface AgentModelRequest {
  system: string;
  messages: AgentModelMessage[];
  tools: AgentAnthropicTool[];
  signal: AbortSignal;
  /** The user's pick. Absent when the host set no `thinking`. */
  thinking?: AgentThinkingLevel;
}
```

`xhigh` is in the set because Anthropic, OpenAI, OpenRouter and Groq all name it.

Config errors throw `TypeError` when the editor starts: an empty `levels`, an
unknown level, a duplicate, or a `default` not in `levels`.

### Adapters — new subpath `@jackuait/blok/agent-models`

```ts
anthropicModel(options: AdapterOptions): AgentModel;        // Messages API
openaiModel(options: AdapterOptions): AgentModel;           // Responses API
openaiCompatibleModel(options: AdapterOptions): AgentModel; // Chat Completions
geminiModel(options: AdapterOptions): AgentModel;           // generateContent

interface AdapterOptions {
  /** Provider model id, e.g. 'gpt-5.5', 'deepseek-v4-pro'. */
  model: string;
  /** Posts `body` to the host's backend, which adds the key and forwards it. Returns the provider's JSON. */
  send(body: Record<string, unknown>, context: { signal: AbortSignal; thinking?: AgentThinkingLevel }): Promise<unknown>;
  /** Default 16000. */
  maxTokens?: number;
  /** Replace the default body fragment for a level. Deep-merged into the request body. */
  levels?: Partial<Record<AgentThinkingLevel, Record<string, unknown>>>;
}
```

- `openaiCompatibleModel` covers DeepSeek, Mistral, Groq, Ollama and OpenRouter.
  One wire format reaches all of them.
- `send` gets the finished body and returns raw JSON. The host can still change
  the body there: add `cache_control`, `store`, a provider-specific flag.
- Types are hand-authored in `types/agent-models.d.ts` (published-types law).
- **Needs your OK:** a new `exports` entry in `package.json` and a new entry in
  `vite.config.mjs`. CLAUDE.md protects both files.

## Internals

### Where adapters plug in

Each adapter is a pure function pair around `send`:

```
AgentModelRequest ──toBody──▶ native body ──send──▶ native JSON ──fromReply──▶ AgentModelResponse
```

The loop (`src/agent/assistant-loop.ts`) does not change. It already does these things:

- Pushes the reply's `content` into history untouched.
- Reads only `text` and `tool_use` blocks.
- Matches results by `tool_use_id`.
- Acts on the stop reasons `refusal`, `max_tokens` and `pause_turn`.

### Keeping provider reasoning (the hard part)

Thinking models return data that must be sent back unchanged on the next call
of a tool loop. Dropping it costs quality, and on two providers it is an error.

| Provider | What must come back | If dropped |
|---|---|---|
| Anthropic | `thinking` blocks, unchanged | rejected or ignored, depending on model |
| OpenAI Responses | every `output` item in order: `reasoning` (with `encrypted_content`), `message` with `phase`, `function_call` | quality and tokens (docs) |
| DeepSeek | `reasoning_content` on every assistant turn when `tools` is present | **HTTP 400** |
| OpenRouter | `reasoning_details`, unmodified | quality (docs) |
| Mistral | thinking chunks in `content` (an array) | quality (docs) |
| Gemini | model `parts` with `thoughtSignature` | `MISSING_THOUGHT_SIGNATURE` |

How we keep it:

- `fromReply` returns the usual `text` and `tool_use` blocks.
- It also returns one opaque block, `{ type: 'provider', format, raw }`, holding the
  native assistant turn exactly as received.
- `toBody` rebuilds each assistant turn from its `provider` block when one exists
  for the same `format`. Otherwise it builds the turn from `text` and `tool_use`.
- The `provider` block is a legal `AgentModelContentBlock` today: its last union
  member is `{ type: string; [key: string]: unknown }`.

Messages live only inside the run (`agent-run.ts:28`), so nobody else sees the
opaque block. History is append-only, and Anthropic's preserved-thinking check
requires exactly that.

`format` is the adapter's name. If a host swaps adapters mid-conversation, the
old blocks are skipped and the turns are rebuilt from text and tool calls.

### Per adapter

**anthropicModel.** This is nearly identity: request fields map one to one.
- Thinking blocks pass through as content.
- Body: `model`, `max_tokens`, `system`, `messages`, `tools`, `output_config.effort`.
- `stop_reason` passes through.

**openaiModel (Responses).**
- `instructions` = system. `store: false` makes the call stateless, with no
  dependence on the provider keeping state.
- Tools: `{ type: 'function', name, description, parameters, strict: false }`.
  - `strict` is set explicitly, because leaving it out makes OpenAI try strict mode.
  - Our `blok_execute` schema is not closed, so strict mode would fail.
- `function_call.arguments` is a string. It is parsed with `JSON.parse`.
- Tool results become `{ type: 'function_call_output', call_id, output }`.
- Stop mapping:
  - `incomplete_details.reason` `max_output_tokens` → `max_tokens`.
  - `content_filter`, or a `refusal` content part → `refusal`.
  - Any `function_call` → `tool_use`.
  - Otherwise → `end_turn`.

**openaiCompatibleModel (Chat Completions).**
- Tool calls go out as `tool_calls[{ id, type: 'function', function: { name, arguments } }]`.
- Results go out as `{ role: 'tool', tool_call_id, name, content }`.
  - `name` is sent because Mistral and Groq show it in their docs.
  - Whether OpenAI accepts the extra field is **unverified**. The smoke test checks it.
- Assistant turns are replayed from `raw`, so `reasoning_content`,
  `reasoning_details` and chunk arrays survive.
- `content` may be a string or a chunk array. Text is the `text` chunks only.
- `finish_reason` mapping: `length` → `max_tokens`; `content_filter`, or a non-null
  `message.refusal` → `refusal`; `tool_calls` → `tool_use`; otherwise `end_turn`.
- `tool_choice` is never sent. Ollama does not support it, and we need only `auto`.

**geminiModel (generateContent v1beta).**
- `systemInstruction.parts[0].text` = system.
- Roles are `user` and `model`.
- Tools go out as `tools: [{ functionDeclarations: [{ name, description, parametersJsonSchema }] }]`.
- Calls and results are matched by `functionCall.id` and `functionResponse.id`.
- All results for one turn go out in one `user` content, in call order, as
  `response: { result }` (or `{ error }` when `is_error`).
- Thought parts (`thought: true`) are not text.
- Stop mapping:
  - `MAX_TOKENS` → `max_tokens`.
  - `promptFeedback.blockReason`, or `SAFETY`, `RECITATION`, `BLOCKLIST`,
    `PROHIBITED_CONTENT` or `SPII` → `refusal`.
  - Any `functionCall` part → `tool_use`.
  - `MALFORMED_FUNCTION_CALL` → `end_turn` with an explanatory text block.
  - Otherwise → `end_turn`.

### Bad tool arguments

Chat Completions and Responses send `arguments` as a string that may not be valid
JSON. When `JSON.parse` fails, the adapter passes `{ invalidJson: <raw string> }`
as the input. The tool answers with a schema error, and the model retries.
Nothing throws.

### Default level → body fragment

These are best-effort defaults. Allowed values differ per model, so the host lists
only the levels its model supports, and overrides a level with `levels` where the
default is wrong.

| Level | anthropic | openai / compatible | gemini |
|---|---|---|---|
| off | `output_config.effort: 'low'` ¹ | `reasoning_effort` / `reasoning.effort: 'none'` | `thinkingConfig.thinkingLevel: 'MINIMAL'` ² |
| low | `effort: 'low'` | `'low'` | `'LOW'` |
| medium | `'medium'` | `'medium'` | `'MEDIUM'` |
| high | `'high'` | `'high'` | `'HIGH'` |
| xhigh | `'xhigh'` | `'xhigh'` | `'HIGH'` |
| max | `'max'` | `'max'` | `'HIGH'` |

1. Claude Opus 5.5 cannot turn thinking off. `{type:'disabled'}` is a 400 there,
   so `low` is the closest. A host on Sonnet 5.5 can override `off` with
   `{ thinking: { type: 'between_tools' } }`.
2. Gemini 3+ cannot turn reasoning off, and `MINIMAL` exists only on some models.
   Sending both `thinkingLevel` and `thinkingBudget` is a 400, so the defaults use
   only `thinkingLevel`.

When `request.thinking` is absent, adapters add no thinking field, so the provider
default applies.

Per-model facts behind this table, with sources, are in "Research" below.

## UI — the thinking toggle

- It shows only when `thinking.levels.length >= 2`. With fewer, the bar is unchanged.
- Placement: in the bar's row, before the send button.
- A button shows the current level. It opens a small menu of the allowed levels,
  using the existing Popover.
- The selected level gets a checkmark on a neutral surface, never blue
  (CLAUDE.md "No blue selected states").
- A hint shows on hover only, after the delay (hint-delay law).
- The pick lasts for the editor's lifetime and starts with `default`.
  - It applies from the next prompt or follow-up.
  - A run in progress keeps the level it started with.
- New i18n keys: `assistant.thinking`, plus `assistant.thinking.off`, `.low`,
  `.medium`, `.high`, `.xhigh` and `.max`. They go in every locale (blok-translations).
- The look is shown first on a live clickable prototype page, and built only
  after you pick (show-don't-tell rule).

Data flow:
- `AgentRunDeps` gains `thinking(): AgentThinkingLevel | undefined`.
- `answer()` reads it once per prompt and passes it to `runAssistantLoop`, which
  puts it on each `AgentModelRequest` of that prompt.
- `editor.agent.ask(prompt, { thinking })` lets code override the bar for one run.

## Testing

TDD: each test is written first and seen failing.

- **Adapters (unit).** Each adapter is fed recorded native replies:
  - text only
  - one tool call
  - parallel tool calls
  - a refusal or content filter
  - truncation
  - invalid-JSON arguments
  - a reply carrying reasoning data
- **Round trip (unit).** Run the real `runAssistantLoop` with a fake `send`.
  - Assert that the second request carries the first reply's reasoning data unchanged.
  - Cover each of: DeepSeek `reasoning_content`, OpenAI `reasoning` + `phase`,
    Gemini `thoughtSignature`, Anthropic `thinking`.
- **Level mapping (unit).** Each level produces the table's fragment, and a
  `levels` override replaces it.
- **Config validation (unit).** The `TypeError` cases above.
- **Toggle (e2e, scripted model).**
  - Hidden with one level, shown with two.
  - The picked level arrives in `request.thinking` on the next prompt, and not
    mid-run.
  - The selected row has no blue (selected-state test).
- **Published types.** `published-types-no-src-refs.test.ts` stays green, and the
  agent public-types law covers the new file.
- **Live smoke (optional, skipped in CI).** One real call plus one tool round trip
  per adapter, run only when that provider's key is in the env. It settles the
  unverified points below.

## Open questions and unverified points

- Gemini's guides now describe a newer Interactions API (`/v1beta/interactions`).
  `generateContent` is still in the API reference.
  - Several `generateContent` details are **unverified**: which role carries
    `functionResponse`, and the `finishReason` that goes with a function call.
  - Which JSON Schema keywords `parametersJsonSchema` accepts is also
    **unverified**. Our `blok_read` and `blok_execute` schemas must pass. The
    smoke test checks this.
- Whether OpenAI Chat Completions accepts `name` on a tool message: **unverified**.
- Groq and Ollama reasoning echo rules: **unverified**. The raw-replay design
  covers them either way.
- A server-side bridge (AI SDK as an optional peer) is out of scope. We build it
  only if hosts ask.

## Research (primary sources, fetched 2026-10-15)

- OpenAI Responses:
  - openai-node `src/resources/responses/responses.ts` and `shared.ts`
  - developers.openai.com guides: function-calling, reasoning
  - Facts used: `reasoning.effort` values none…max, `strict` default behaviour,
    `phase`, `encrypted_content` by default when `store: false`
- OpenAI Chat Completions: openai-node `chat/completions/completions.ts`
- DeepSeek: api-docs.deepseek.com create-chat-completion and thinking_mode guide
  (the `reasoning_content` 400 rule)
- OpenRouter: openrouter.ai docs, reasoning-tokens and parameters
- Mistral: docs.mistral.ai function_calling and reasoning
- Groq: console.groq.com docs, tool-use, reasoning and api-reference
- Ollama: docs.ollama.com openai-compatibility
- Gemini: ai.google.dev api/generate-content, gemini-api/docs/thinking, gemini-3,
  openai, function-calling, api-errors; js-genai `types.ts`
- Anthropic: claude-api reference bundled with Claude Code (effort values,
  Opus 5.5 / Sonnet 5.5 thinking-off rules, preserved thinking)
