import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentModel, type AgentModelOptions, type AgentModelProvider } from '../../../src/agent-models/agent-model';
import type { AdapterOptions } from '../../../src/agent-models/shared';
import type { AgentModelRequest, AgentThinkingLevel } from '../../../types/api';

import { request } from './stream-helpers';

const STOP = new Error('stop');

const LEVELS: AgentThinkingLevel[] = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];

/** A run after one tool call, so tool messages and replayed turns show in the body. */
const afterCall = (thinking?: AgentThinkingLevel): AgentModelRequest => ({
  ...request(),
  messages: [
    { role: 'user', content: 'Go' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'blok_read', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{}' }] },
  ],
  tools: [{ name: 'blok_read', description: 'd', input_schema: { type: 'object' } }],
  ...(thinking === undefined ? {} : { thinking }),
});

/** The body agentModel hands to send or stream. The transport rejects, so no reply needs parsing. */
const bodyOf = async (
  provider: AgentModelProvider,
  extra: Partial<AdapterOptions> = {},
  ask: AgentModelRequest = afterCall()
): Promise<Record<string, unknown>> => {
  const bodies: Record<string, unknown>[] = [];
  const keep = async (body: Record<string, unknown>): Promise<never> => {
    bodies.push(body);
    throw STOP;
  };
  const transport = extra.stream === undefined ? { send: keep } : { stream: keep };

  await expect(agentModel({ model: 'm', ...extra, ...transport, provider })(ask)).rejects.toBe(STOP);

  return bodies[0] ?? {};
};

const field = (value: unknown, key: string | number): unknown =>
  (typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined);

/** Which API a body is for, read from the fields only that API sends. */
const apiOf = (body: Record<string, unknown>): string => {
  if ('contents' in body) {
    return 'gemini';
  }
  if ('input' in body) {
    return 'responses';
  }

  return field(field(body.messages, 0), 'role') === 'system' ? 'chat' : 'anthropic';
};

/** The effort value a body asks for, whichever API it is for; undefined when it sends none. */
const effortOf = (body: Record<string, unknown>): unknown =>
  body.reasoning_effort ?? field(body.output_config, 'effort') ?? field(body.reasoning, 'effort');

const toolMessage = (body: Record<string, unknown>): unknown =>
  (Array.isArray(body.messages) ? body.messages.find((message) => field(message, 'role') === 'tool') : undefined);

/** provider, API, error name, provider-side web search */
const PROVIDERS: Array<[AgentModelProvider, string, string, boolean]> = [
  ['anthropic', 'anthropic', 'Anthropic', true],
  ['openai', 'responses', 'OpenAI', true],
  ['gemini', 'gemini', 'Gemini', true],
  ['azure', 'responses', 'Azure OpenAI', true],
  ['xai', 'responses', 'xAI', true],
  ['deepseek', 'anthropic', 'DeepSeek', true],
  ['qwen', 'anthropic', 'Qwen', true],
  ['kimi', 'anthropic', 'Kimi', false],
  ['minimax', 'anthropic', 'MiniMax', false],
  ['zai', 'chat', 'Z.ai', false],
  ['mistral', 'chat', 'Mistral', false],
  ['groq', 'chat', 'Groq', false],
  ['ollama', 'chat', 'Ollama', false],
  ['openrouter', 'chat', 'OpenRouter', false],
  ['fireworks', 'chat', 'Fireworks', false],
  ['cerebras', 'chat', 'Cerebras', false],
  ['sambanova', 'chat', 'SambaNova', false],
  ['together', 'chat', 'Together AI', false],
  ['cohere', 'chat', 'Cohere', false],
  ['huggingface', 'chat', 'Hugging Face', false],
  ['vercel', 'chat', 'Vercel AI Gateway', false],
  ['litellm', 'chat', 'LiteLLM', false],
  ['lmstudio', 'chat', 'LM Studio', false],
  ['vllm', 'chat', 'vLLM', false],
  ['vertex', 'chat', 'Vertex AI', false],
  ['bedrock', 'chat', 'Amazon Bedrock', false],
  ['yandex', 'chat', 'Yandex', false],
  ['openai-compatible', 'chat', 'OpenAI-compatible', false],
];

/**
 * The effort each level sends, off → max, where a provider differs from its API's default.
 * undefined: the field is left out, for providers that list no value for it.
 */
const EFFORTS: Partial<Record<AgentModelProvider, unknown[]>> = {
  // DeepSeek and Kimi document low, high and max only.
  deepseek: ['low', 'low', 'high', 'high', 'high', 'max'],
  kimi: ['low', 'low', 'high', 'high', 'high', 'max'],
  // xAI documents low to xhigh, and reasoning cannot be turned off.
  xai: ['low', 'low', 'medium', 'high', 'xhigh', 'xhigh'],
  // Mistral and Hugging Face list none to xhigh.
  mistral: ['none', 'low', 'medium', 'high', 'xhigh', 'xhigh'],
  huggingface: ['none', 'low', 'medium', 'high', 'xhigh', 'xhigh'],
  // These list low, medium and high only.
  sambanova: [undefined, 'low', 'medium', 'high', 'high', 'high'],
  together: [undefined, 'low', 'medium', 'high', 'high', 'high'],
  vertex: [undefined, 'low', 'medium', 'high', 'high', 'high'],
  bedrock: [undefined, 'low', 'medium', 'high', 'high', 'high'],
  yandex: [undefined, 'low', 'medium', 'high', 'high', 'high'],
  // Cohere takes none and high only.
  cohere: ['none', 'high', 'high', 'high', 'high', 'high'],
};

const DEFAULT_EFFORTS: Record<string, unknown[]> = {
  anthropic: ['low', 'low', 'medium', 'high', 'xhigh', 'max'],
  responses: ['low', 'low', 'medium', 'high', 'xhigh', 'max'],
  chat: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
};

describe('agentModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(PROVIDERS)('%s speaks the %s API', async (provider, api) => {
    expect(apiOf(await bodyOf(provider))).toBe(api);
  });

  it.each(PROVIDERS.filter(([, api]) => api !== 'gemini'))('%s sends its own effort for each level', async (provider, api) => {
    const sent = await Promise.all(LEVELS.map(async (level) => effortOf(await bodyOf(provider, {}, afterCall(level)))));

    expect(sent).toEqual(EFFORTS[provider] ?? DEFAULT_EFFORTS[api]);
  });

  it('leaves the effort out when the host sets no level', async () => {
    expect(effortOf(await bodyOf('sambanova'))).toBeUndefined();
  });

  it('lets the host levels win over a provider default', async () => {
    const body = await bodyOf('together', { levels: { max: { reasoning_effort: 'max' } } }, afterCall('max'));

    expect(body.reasoning_effort).toBe('max');
  });

  it.each(PROVIDERS.filter(([, , , search]) => search))('passes webSearch on to %s', async (provider) => {
    const body = await bodyOf(provider, { webSearch: true });

    expect(JSON.stringify(body.tools)).toMatch(/web_search|googleSearch/);
  });

  it.each(PROVIDERS.filter(([, , , search]) => !search))('%s refuses webSearch, naming itself', (provider, _api, name) => {
    expect(() => agentModel({ provider, model: 'm', send: async () => ({}), webSearch: true }))
      .toThrow(new TypeError(`${name}: webSearch is not supported. Add your provider's search in send, or give the assistant a search tool.`));
  });

  it.each(['groq', 'vllm', 'bedrock'] as const)('%s caps output with max_completion_tokens only', async (provider) => {
    const body = await bodyOf(provider);

    expect(body.max_completion_tokens).toBe(16_000);
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('sends the tool name on tool messages to Mistral only', async () => {
    expect(toolMessage(await bodyOf('mistral'))).toEqual({ role: 'tool', tool_call_id: 'c1', name: 'blok_read', content: '{}' });
    expect(toolMessage(await bodyOf('groq'))).toEqual({ role: 'tool', tool_call_id: 'c1', content: '{}' });
  });

  it('asks Z.ai to stream tool arguments, and only when streaming', async () => {
    expect((await bodyOf('zai', { stream: async () => new Response() })).tool_stream).toBe(true);
    expect(await bodyOf('zai')).not.toHaveProperty('tool_stream');
  });

  it('replays only the message fields Fireworks accepts', async () => {
    const raw = { role: 'assistant', content: 'Hi', refusal: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'blok_read', arguments: '{}' } }] };
    const ask: AgentModelRequest = {
      ...afterCall(),
      messages: [
        { role: 'user', content: 'Go' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'blok_read', input: {} }, { type: 'provider', format: 'openai-chat', raw }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{}' }] },
      ],
    };
    const body = await bodyOf('fireworks', {}, ask);

    expect(field(body.messages, 2)).toEqual({ role: 'assistant', content: 'Hi', tool_calls: raw.tool_calls });
  });

  it('names the known providers when given an unknown one', () => {
    expect(() => agentModel({ provider: 'antrophic', model: 'm', send: async () => ({}) } as unknown as AgentModelOptions))
      .toThrow(/unknown provider "antrophic".*anthropic/);
  });

  describe('names the provider in its errors', () => {
    it.each(PROVIDERS)('%s: a missing transport', (provider, _api, name) => {
      expect(() => agentModel({ provider, model: 'm' })).toThrow(new TypeError(`${name}: pass send or stream.`));
    });

    it.each(PROVIDERS)('%s: an error reply', async (provider, _api, name) => {
      const model = agentModel({ provider, model: 'm', send: async () => ({ error: { message: 'Bad key' } }) });

      await expect(model(request())).rejects.toThrow(`${name}: Bad key`);
    });

    it.each(PROVIDERS)('%s: an HTTP error on a stream', async (provider, _api, name) => {
      const model = agentModel({ provider, model: 'm', stream: async () => new Response('Bad Gateway', { status: 502 }) });

      await expect(model(request())).rejects.toThrow(`${name}: HTTP 502.`);
    });
  });
});
