import type { AgentModel, AgentThinkingLevel } from '../../types/api';

import { anthropicModel, type AnthropicProfile } from './anthropic';
import { geminiModel } from './gemini';
import { openaiModel, type ResponsesProfile } from './openai';
import { openaiCompatibleModel, type ChatProfile } from './openai-compatible';
import type { AdapterOptions, Body } from './shared';

interface Route {
  /** The provider's adapter, with its profile applied. */
  model: (options: AdapterOptions) => AgentModel;
  name: string;
  /** The provider runs its own web search, so webSearch may be passed on. */
  search?: true;
}

const anthropic = (profile: AnthropicProfile, search?: true): Route => ({ model: (options) => anthropicModel(options, profile), name: profile.name, search });
const responses = (profile: ResponsesProfile): Route => ({ model: (options) => openaiModel(options, profile), name: profile.name, search: true });
const chat = (profile: ChatProfile): Route => ({ model: (options) => openaiCompatibleModel(options, profile), name: profile.name });

/** One fragment per level, off → max. undefined sends no effort at all. */
const efforts = (wrap: (effort: string) => Body, values: Array<string | undefined>): Partial<Record<AgentThinkingLevel, Body>> => {
  const levels: AgentThinkingLevel[] = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];

  return Object.fromEntries(levels.map((level, index) => {
    const value = values[index];

    return [level, value === undefined ? {} : wrap(value)];
  }));
};

const outputEffort = (effort: string): Body => ({ output_config: { effort } });
const reasoningEffort = (effort: string): Body => ({ reasoning_effort: effort });

// Providers that list low, medium and high only, as gpt-oss does on Groq and Cerebras.
const LOW_TO_HIGH = efforts(reasoningEffort, [undefined, 'low', 'medium', 'high', 'high', 'high']);
const NONE_TO_XHIGH = efforts(reasoningEffort, ['none', 'low', 'medium', 'high', 'xhigh', 'xhigh']);
// Anthropic-compatible APIs that take low, high and max only.
const LOW_HIGH_MAX = efforts(outputEffort, ['low', 'low', 'high', 'high', 'high', 'max']);

/** Each provider, routed to the best API it serves. Keep in sync with AgentModelProvider in types/agent-models.d.ts. */
const PROVIDERS = {
  anthropic: anthropic({ name: 'Anthropic' }, true),
  openai: responses({ name: 'OpenAI' }),
  gemini: { model: (options: AdapterOptions) => geminiModel(options), name: 'Gemini', search: true },
  azure: responses({ name: 'Azure OpenAI', encryptedReasoning: true }),
  // Reasoning cannot be turned off, and xhigh is the top.
  xai: responses({ name: 'xAI', encryptedReasoning: true, levels: efforts((effort) => ({ reasoning: { effort } }), ['low', 'low', 'medium', 'high', 'xhigh', 'xhigh']) }),
  deepseek: anthropic({ name: 'DeepSeek', levels: LOW_HIGH_MAX }, true),
  // Effort values differ per model, so the host's levels pick them. Web search needs the client identifier in system.
  qwen: anthropic({ name: 'Qwen', levels: efforts(outputEffort, []), searchSystem: 'x-anthropic-billing-header: cc_entrypoint=cli;' }, true),
  kimi: anthropic({ name: 'Kimi', levels: LOW_HIGH_MAX }),
  // Thinking stays off unless adaptive is sent, and M3.1-Flash rejects disabled, so off just leaves it out.
  minimax: anthropic({ name: 'MiniMax', levels: { ...efforts((effort) => ({ thinking: { type: 'adaptive' }, ...outputEffort(effort) }), [undefined, 'low', 'medium', 'high', 'xhigh', 'max']), off: outputEffort('low') } }),
  // Reads the effort only with thinking on, and streams tool arguments only when asked.
  // GLM-5.3 takes low, high and max only, and errors on thinking disabled, so off sends nothing.
  zai: chat({ name: 'Z.ai', levels: efforts((effort) => ({ thinking: { type: 'enabled' }, reasoning_effort: effort }), [undefined, 'low', 'high', 'high', 'max', 'max']), streamBody: { tool_stream: true } }),
  mistral: chat({ name: 'Mistral', levels: NONE_TO_XHIGH, toolName: true }),
  groq: chat({ name: 'Groq', tokens: 'max_completion_tokens', levels: LOW_TO_HIGH }),
  // Older versions reject anything above high.
  ollama: chat({ name: 'Ollama', levels: efforts(reasoningEffort, ['none', 'low', 'medium', 'high', 'high', 'high']) }),
  // Models with mandatory reasoning reject none.
  openrouter: chat({ name: 'OpenRouter', levels: efforts(reasoningEffort, [undefined, 'low', 'medium', 'high', 'xhigh', 'max']) }),
  // Its message schema rejects any other field.
  fireworks: chat({ name: 'Fireworks', replayFields: ['role', 'content', 'reasoning_content', 'tool_calls'] }),
  cerebras: chat({ name: 'Cerebras', levels: LOW_TO_HIGH }),
  sambanova: chat({ name: 'SambaNova', levels: LOW_TO_HIGH }),
  together: chat({ name: 'Together AI', levels: LOW_TO_HIGH }),
  cohere: chat({ name: 'Cohere', levels: efforts(reasoningEffort, ['none', 'high', 'high', 'high', 'high', 'high']) }),
  huggingface: chat({ name: 'Hugging Face', levels: NONE_TO_XHIGH }),
  vercel: chat({ name: 'Vercel AI Gateway' }),
  litellm: chat({ name: 'LiteLLM' }),
  lmstudio: chat({ name: 'LM Studio' }),
  vllm: chat({ name: 'vLLM', tokens: 'max_completion_tokens' }),
  vertex: chat({ name: 'Vertex AI', levels: LOW_TO_HIGH }),
  bedrock: chat({ name: 'Amazon Bedrock', tokens: 'max_completion_tokens', levels: LOW_TO_HIGH }),
  yandex: chat({ name: 'Yandex', levels: LOW_TO_HIGH }),
  'openai-compatible': chat({ name: 'OpenAI-compatible' }),
} satisfies Record<string, Route>;

export type AgentModelProvider = keyof typeof PROVIDERS;

export type AgentModelOptions = AdapterOptions & { provider: AgentModelProvider };

const isProvider = (name: string): name is AgentModelProvider => Object.hasOwn(PROVIDERS, name);

/**
 * Picks the adapter for the host's provider, so the host never has to know which API that provider speaks.
 * @param options - provider, model id, the host's send or stream, and the adapter options
 */
export function agentModel({ provider, ...options }: AgentModelOptions): AgentModel {
  if (!isProvider(provider)) {
    throw new TypeError(`agentModel: unknown provider "${String(provider)}". Use one of: ${Object.keys(PROVIDERS).join(', ')}.`);
  }

  const route: Route = PROVIDERS[provider];

  // Types leave webSearch out for these; this catches plain JS callers.
  if (route.search === undefined && options.webSearch !== undefined && options.webSearch !== false) {
    throw new TypeError(`${route.name}: webSearch is not supported. Add your provider's search in send, or give the assistant a search tool.`);
  }

  return route.model(options);
}
