import type { AgentActor, AgentSession } from '../agent';

/** The three core tools, shared by the in-app and MCP surfaces. */
export type AgentToolName = 'blok_read' | 'blok_describe' | 'blok_execute';

export interface AgentToolsOptions {
  /** 'openai' means the OpenAI Responses API function tool. */
  format: 'anthropic' | 'openai';
  /** Default 'envelope'. 'full' includes every command's argument schema and may throw AgentToolsTooLargeError. */
  schema?: 'envelope' | 'full';
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
}
