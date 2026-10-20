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
   * Each call gets a fresh copy, so edits never reach the run's history.
   */
  send?(body: Record<string, unknown>, context: AgentModelSendContext): Promise<unknown>;
  /**
   * Post `body` to your backend and return the streaming response (SSE) unchanged.
   * The adapter already set the provider's stream flag. With it, Ask AI shows edits live.
   * When set, every request streams. Pass `send`, `stream` or both; the adapter throws a TypeError with neither.
   */
  stream?(body: Record<string, unknown>, context: AgentModelSendContext): Promise<Response | ReadableStream<Uint8Array>>;
  /** Output token cap. Default 16000. */
  maxTokens?: number;
  /** Replace a level's default body fragment. It is deep-merged into the request body. */
  levels?: Partial<Record<AgentThinkingLevel, Record<string, unknown>>>;
}

/**
 * Anthropic Messages API. `off` sends the lowest effort, since some Claude models cannot turn thinking off.
 * Caches by default: a mark on the system block and top-level `cache_control`. A platform that rejects
 * top-level `cache_control` (the legacy Bedrock integration) deletes it from the body in `send`.
 */
export declare function anthropicModel(options: AgentModelAdapterOptions): AgentModel;

/** OpenAI Responses API, stateless (`store: false`). Levels set `reasoning.effort`; `off` sends `low`, since some models reject `none`. */
export declare function openaiModel(options: AgentModelAdapterOptions): AgentModel;

/** Chat Completions: DeepSeek, Mistral, Groq, Ollama, OpenRouter and others. Levels set `reasoning_effort`. */
export declare function openaiCompatibleModel(options: AgentModelAdapterOptions): AgentModel;

/** Gemini generateContent (v1beta). Levels set `generationConfig.thinkingConfig.thinkingLevel`. */
export declare function geminiModel(options: AgentModelAdapterOptions): AgentModel;
