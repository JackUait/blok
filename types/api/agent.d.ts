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
  /** Who `lastEditedBy` names. `detail.agent` is set either way. Default 'agent'. */
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
  /** Open the "Ask AI" prompt bar, as Mod+J does. Does nothing without `agent.assistant` or in read-only mode. */
  openAssistant(): void;
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

/** What the assistant sends to the host's model function. */
export interface AgentModelRequest {
  system: string;
  messages: AgentModelMessage[];
  tools: AgentAnthropicTool[];
  /** Aborted when the user stops the run. Pass it to the HTTP request. */
  signal: AbortSignal;
  /** The level for this prompt. Absent when the host set no `thinking` and the caller passed none. */
  thinking?: AgentThinkingLevel;
  /**
   * Optional. If you stream, call it with the full text so far of the block the model
   * is writing: its answer, or a short note between tool calls. Each call replaces
   * the last. The prompt bar shows it while the model works.
   */
  onText?(text: string): void;
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
  /** Model calls allowed per prompt. Default 30. */
  maxSteps?: number;
  /** Levels the user may pick in the Ask AI bar. The picker shows only with two or more. */
  thinking?: {
    levels: AgentThinkingLevel[];
    /** Must be one of `levels`. Default: the first level. */
    default?: AgentThinkingLevel;
  };
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
  /** Undo the run's edits that are still the newest undo steps, then end. True when something was undone. */
  discard(): Promise<boolean>;
  /** Keep the edits and close the run. */
  end(): void;
}
