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

/** Options of the adapters whose provider runs its own web search. */
export interface AgentModelSearchAdapterOptions extends AgentModelAdapterOptions {
  /**
   * Let the model search the web on the provider's side. The provider bills each search.
   * An object is shallow-merged into the provider's tool entry:
   * `{ type: 'web_search_20250305', name: 'web_search' }` on the Anthropic Messages providers, `{ type: 'web_search' }`
   * on the Responses providers, `{ googleSearch: {} }` on Gemini. Default off.
   */
  webSearch?: boolean | Record<string, unknown>;
}

/** Providers whose own web search `webSearch` turns on. */
export type AgentModelSearchProvider = 'anthropic' | 'openai' | 'gemini' | 'azure' | 'xai' | 'deepseek' | 'qwen';

/**
 * Each provider is sent the best API it serves. Levels map to the values the provider documents.
 * - Anthropic Messages: `anthropic`, `deepseek`, `qwen`, `kimi`, `minimax`. Levels set `output_config.effort`; `off` sends
 *   `low`, since some models cannot turn thinking off. Caches by default: a mark on the system block and top-level
 *   `cache_control`. A platform that rejects top-level `cache_control` deletes it from the body in `send`.
 * - OpenAI Responses, stateless (`store: false`): `openai`, `azure`, `xai`. Levels set `reasoning.effort`; `off` sends `low`.
 * - Gemini generateContent (v1beta): `gemini`. Levels set `generationConfig.thinkingConfig.thinkingLevel`.
 *   The body is the same for both transports. With `stream`, call `:streamGenerateContent?alt=sse`.
 * - Chat Completions, levels set `reasoning_effort`: `zai`, `mistral`, `groq`, `ollama`, `openrouter`, `fireworks`,
 *   `cerebras`, `sambanova`, `together`, `cohere`, `huggingface`, `vercel`, `litellm`, `lmstudio`, `vllm`, `vertex`,
 *   `bedrock`, `yandex`, and `openai-compatible` for any other endpoint that speaks it.
 */
export type AgentModelProvider =
  | AgentModelSearchProvider
  | 'kimi' | 'minimax' | 'zai' | 'mistral' | 'groq' | 'ollama' | 'openrouter' | 'fireworks' | 'cerebras' | 'sambanova'
  | 'together' | 'cohere' | 'huggingface' | 'vercel' | 'litellm' | 'lmstudio' | 'vllm' | 'vertex' | 'bedrock' | 'yandex'
  | 'openai-compatible';

export type AgentModelOptions =
  | (AgentModelSearchAdapterOptions & { provider: AgentModelSearchProvider })
  | (AgentModelAdapterOptions & {
    provider: Exclude<AgentModelProvider, AgentModelSearchProvider>;
    /** These APIs share no search tool. Add your provider's search to the body in `send`, or pass a search tool in `agent.assistant.tools`. */
    webSearch?: never;
  });

/**
 * The model for your provider. It picks the API that provider serves, so you name the provider, not the API.
 * Throws a TypeError for an unknown provider, for `webSearch` on a provider without one, and with neither `send` nor `stream`.
 */
export declare function agentModel(options: AgentModelOptions): AgentModel;
