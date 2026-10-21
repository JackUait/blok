import type { AgentModel } from '../../types/api';

import { anthropicModel } from './anthropic';
import { geminiModel } from './gemini';
import { openaiModel } from './openai';
import { openaiCompatibleModel } from './openai-compatible';
import type { AdapterOptions } from './shared';

/** Chat Completions providers, as their errors name them. */
const chat = (name: string) => (options: AdapterOptions): AgentModel => openaiCompatibleModel(options, name);

/** Each provider mapped to the API its endpoint serves. Keep in sync with AgentModelProvider in types/agent-models.d.ts. */
const PROVIDERS = {
  anthropic: anthropicModel,
  openai: openaiModel,
  gemini: geminiModel,
  deepseek: chat('DeepSeek'),
  mistral: chat('Mistral'),
  groq: chat('Groq'),
  ollama: chat('Ollama'),
  openrouter: chat('OpenRouter'),
  'openai-compatible': chat('OpenAI-compatible'),
} satisfies Record<string, (options: AdapterOptions) => AgentModel>;

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

  return PROVIDERS[provider](options);
}
