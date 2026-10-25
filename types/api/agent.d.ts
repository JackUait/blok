import type { AgentActor, AgentSession } from '../agent';

/** The three core tools, shared by the in-app and MCP surfaces. */
export type AgentToolName = 'blok_read' | 'blok_describe' | 'blok_execute';

export interface AgentToolsOptions {
  /** 'openai' means the OpenAI Responses API function tool. */
  format: 'anthropic' | 'openai';
  /**
   * Default 'mixed': full arguments for the common commands, the envelope for the rest.
   * 'envelope' names commands only. 'full' includes every command's argument schema and may throw AgentToolsTooLargeError.
   */
  schema?: 'mixed' | 'envelope' | 'full';
  /** Emit strict only when provider requirements are provable; otherwise throw AgentToolsStrictError. Default false. */
  strict?: boolean;
}

export interface AgentAnthropicTool {
  name: AgentToolName;
  description: string;
  input_schema: Record<string, unknown>;
  strict?: boolean;
}

/** A tool the host adds to the assistant, such as web search. */
export interface AgentHostTool {
  /** Must not start with `blok_`. */
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  /** Runs one call. The text goes back to the model. A throw goes back as an error, and the run goes on. */
  run(input: unknown): Promise<string>;
}

/** A tool as the model sees it: a Blok tool, or a host tool without `run`. */
export type AgentModelTool = AgentAnthropicTool | Omit<AgentHostTool, 'run'>;

export interface AgentOpenAITool {
  type: 'function';
  name: AgentToolName;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

export type AgentIdentity = Omit<AgentActor, 'kind'>;

export interface AgentTurnOptions {
  agent: AgentIdentity;
  /** Follow the agent's block until the user scrolls, types or clicks. Default false. */
  follow?: boolean;
  /**
   * Who a block the agent writes is credited to. `detail.agent` is set either way.
   * - 'agent' (default): co-authored. `createdBy`/`lastEditedBy` name the person
   *   (`agent.onBehalfOf`, else the editor's `user.id`) and `createdWith`/`lastEditedWith`
   *   name the agent. With no person known, the agent's id goes in `...By` and no `...With` is written.
   * - 'user': only the person is named, with no `...With`.
   */
  attributeTo?: 'agent' | 'user';
}

export interface AgentToolResult {
  /** JSON text for the provider's tool-result block. */
  content: string;
  /** True when the model should correct itself. Pass as Anthropic's `is_error`. */
  isError: boolean;
}

/** A visible, stoppable, undoable AgentSession. `close()` is `end()`. */
export interface AgentTurn extends AgentSession {
  readonly signal: AbortSignal;
  /** Accepts an object or a JSON string. */
  call(name: string, input: unknown): Promise<AgentToolResult>;
  end(): void;
  stop(): void;
}

export type AgentState =
  | { status: 'idle' }
  | { status: 'working'; turn: { id: string; agent: AgentIdentity } };

export interface Agent {
  /** Tool definitions load lazily. */
  tools(options: AgentToolsOptions & { format: 'anthropic' }): Promise<AgentAnthropicTool[]>;
  tools(options: AgentToolsOptions & { format: 'openai' }): Promise<AgentOpenAITool[]>;
  /** System-prompt guidance loads lazily. */
  guidance(): Promise<string>;
  /** Throws AgentTurnOpenError when a turn is already open. */
  begin(options: AgentTurnOptions): AgentTurn;
  /** Same object until state changes, for useSyncExternalStore. */
  readonly state: AgentState;
  /** Called on every state change. */
  subscribe(listener: () => void): () => void;
  /**
   * Ask the configured assistant (`agent.assistant`) to write or edit.
   * Throws when no assistant is configured or a turn is already open.
   */
  ask(prompt: string, options?: AgentAskOptions): AgentRun;
  /**
   * Open the "Ask AI" prompt bar, as Mod+J does. Does nothing without `agent.assistant` or in read-only mode.
   * @param options.prompt - send this prompt at once, as if typed into the bar
   */
  openAssistant(options?: { prompt?: string }): void;
}

/**
 * One content block of a model message, in Anthropic Messages form.
 * Blocks the assistant does not know (thinking, server tools) are sent back unchanged.
 */
export type AgentModelContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: string; [key: string]: unknown };

export interface AgentModelMessage {
  role: 'user' | 'assistant';
  content: string | AgentModelContentBlock[];
}

/** How hard the model thinks. Each adapter maps it to its provider's setting. */
export type AgentThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Progress of one tool call while the model streams. `index` counts tool calls from 0 within one model response.
 * A call runs at its `tool_end`, so the final response must carry the same calls in the same order,
 * with the same ids and final input. A call is matched by id, then by index and name, so it never runs twice.
 */
export type AgentModelStreamEvent =
  | { type: 'tool_start'; index: number; id: string; name: string }
  | { type: 'tool_input'; index: number; json: string } // all input text so far for this call
  | { type: 'tool_end'; index: number };

/** What the assistant sends to the host's model function. */
export interface AgentModelRequest {
  system: string;
  messages: AgentModelMessage[];
  tools: AgentModelTool[];
  /** Aborted when the user stops the run. Pass it to the HTTP request. */
  signal: AbortSignal;
  /** The level for this prompt. Absent when the host set no `thinking` and the caller passed none. */
  thinking?: AgentThinkingLevel;
  /** Set when the caller can show edits live. A model that streams calls it; one that does not ignores it. */
  onStream?(event: AgentModelStreamEvent): void;
}

/** The model's reply. An Anthropic `Message` fits this shape as is. */
export interface AgentModelResponse {
  content: AgentModelContentBlock[];
  stop_reason: string | null;
}

/** Calls the LLM once. The host owns the key, the endpoint and the model choice. */
export type AgentModel = (request: AgentModelRequest) => Promise<AgentModelResponse>;

export interface AgentAssistantConfig {
  /** Calls the LLM. See `AgentModel`. */
  model: AgentModel;
  /** Shown on the agent caret and in announcements. Default "AI". */
  name?: string;
  /** Model calls allowed per prompt. Default 100. */
  maxSteps?: number;
  /** Extra tools the model may call, after the Blok tools. The host runs them. */
  tools?: AgentHostTool[];
  /**
   * Buttons under the Ask AI field. Each one sends its prompt.
   * This list replaces the built-in one. An empty list shows no buttons.
   */
  actions?: AgentAssistantAction[];
  /** Levels the user may pick in the Ask AI bar. The picker shows only with two or more. */
  thinking?: {
    levels: AgentThinkingLevel[];
    /** Must be one of `levels`. Default: the first level. */
    default?: AgentThinkingLevel;
  };
}

/** A button under the Ask AI field. */
export interface AgentAssistantAction {
  /** The button's text. */
  label: string;
  /** What the button sends to the model. */
  prompt: string;
  /** An SVG string drawn before the label. Without it, the button shows only its label. */
  icon?: string;
  /**
   * When the button shows:
   * - `selection`: the user selected text.
   * - `caret`: no text is selected.
   * Without it, the button always shows.
   */
  context?: 'selection' | 'caret';
}

export interface AgentAskOptions {
  /** Tell the model where the caret is and what text is selected. Default true. */
  context?: boolean;
  /** Thinking level for this run. Without it, the run uses `thinking.default`. Prompts sent from the Ask AI bar use the level picked there. */
  thinking?: AgentThinkingLevel;
}

export interface AgentRunResult {
  /**
   * - `done`: the model answered.
   * - `stopped`: `stop()` was called.
   * - `refused`: the model declined.
   * - `truncated`: the model's output was cut off.
   * - `step-limit`: `maxSteps` model calls ran out.
   * - `failed`: the model call threw; see `error`.
   */
  status: 'done' | 'stopped' | 'refused' | 'truncated' | 'step-limit' | 'failed';
  /** The model's last text. */
  reply: string;
  error?: string;
  /** Ids of blocks this run created, updated, moved or removed so far. */
  changed: string[];
}

/** One conversation with the assistant. It holds the editor's agent turn until `end()` or `discard()`. */
export interface AgentRun {
  /** The newest answer. Replaced by each `followUp()`. */
  readonly result: Promise<AgentRunResult>;
  /** Ask again in the same conversation. Throws while an answer is still running. */
  followUp(prompt: string): Promise<AgentRunResult>;
  /** Stop the running answer. Edits already applied stay. The run stays open. */
  stop(): void;
  /**
   * Undo the run's edits that are still the newest undo steps, write back the
   * sub-pages it saved, then end. A sub-page changed after the run's last save
   * is kept. True only when every edit of the run was reverted.
   */
  discard(): Promise<boolean>;
  /** Keep the edits and close the run. */
  end(): void;
}
