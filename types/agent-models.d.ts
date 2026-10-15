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
