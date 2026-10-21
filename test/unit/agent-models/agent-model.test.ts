import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentModel, type AgentModelOptions } from '../../../src/agent-models/agent-model';
import { anthropicModel } from '../../../src/agent-models/anthropic';
import { geminiModel } from '../../../src/agent-models/gemini';
import { openaiModel } from '../../../src/agent-models/openai';
import { openaiCompatibleModel } from '../../../src/agent-models/openai-compatible';
import type { AdapterOptions } from '../../../src/agent-models/shared';
import type { AgentModel } from '../../../types/api';

import { request } from './stream-helpers';

const STOP = new Error('stop');

/** The body the model hands to send. send rejects, so no reply needs parsing. */
const bodyOf = async (model: (options: AdapterOptions) => AgentModel, options: Partial<AdapterOptions> = {}): Promise<Record<string, unknown>> => {
  const bodies: Record<string, unknown>[] = [];

  await expect(model({
    ...options,
    model: 'm',
    send: async (body) => {
      bodies.push(body);
      throw STOP;
    },
  })(request())).rejects.toBe(STOP);

  return bodies[0] ?? {};
};

const viaProvider = (provider: AgentModelOptions['provider']) => (options: AdapterOptions): AgentModel =>
  agentModel({ ...options, provider });

describe('agentModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['anthropic', anthropicModel],
    ['openai', openaiModel],
    ['gemini', geminiModel],
    ['deepseek', openaiCompatibleModel],
    ['mistral', openaiCompatibleModel],
    ['groq', openaiCompatibleModel],
    ['ollama', openaiCompatibleModel],
    ['openrouter', openaiCompatibleModel],
    ['openai-compatible', openaiCompatibleModel],
  ] as const)('provider %s speaks the API that provider serves', async (provider, adapter) => {
    expect(await bodyOf(viaProvider(provider))).toEqual(await bodyOf(adapter));
  });

  it.each(['anthropic', 'openai', 'gemini'] as const)('passes webSearch on to %s', async (provider) => {
    const body = await bodyOf(viaProvider(provider), { webSearch: true });

    expect(JSON.stringify(body.tools)).toMatch(/web_search|googleSearch/);
  });

  it('rejects webSearch for a provider with no search tool', () => {
    expect(() => agentModel({ provider: 'deepseek', model: 'm', send: async () => ({}), webSearch: true } as unknown as AgentModelOptions))
      .toThrow(TypeError);
  });

  it('names the known providers when given an unknown one', () => {
    expect(() => agentModel({ provider: 'antrophic', model: 'm', send: async () => ({}) } as unknown as AgentModelOptions))
      .toThrow(/unknown provider "antrophic".*anthropic/);
  });

  describe('names the provider in its errors', () => {
    const NAMES = [
      ['deepseek', 'DeepSeek'],
      ['mistral', 'Mistral'],
      ['groq', 'Groq'],
      ['ollama', 'Ollama'],
      ['openrouter', 'OpenRouter'],
      ['openai-compatible', 'OpenAI-compatible'],
      ['anthropic', 'Anthropic'],
      ['openai', 'OpenAI'],
      ['gemini', 'Gemini'],
    ] as const;

    it.each(NAMES)('%s: a missing transport', (provider, name) => {
      expect(() => agentModel({ provider, model: 'm' })).toThrow(new TypeError(`${name}: pass send or stream.`));
    });

    it.each(NAMES)('%s: an error reply', async (provider, name) => {
      const model = agentModel({ provider, model: 'm', send: async () => ({ error: { message: 'Bad key' } }) });

      await expect(model(request())).rejects.toThrow(`${name}: Bad key`);
    });

    it.each(NAMES)('%s: an HTTP error on a stream', async (provider, name) => {
      const model = agentModel({ provider, model: 'm', stream: async () => new Response('Bad Gateway', { status: 502 }) });

      await expect(model(request())).rejects.toThrow(`${name}: HTTP 502.`);
    });

    it('deepseek: webSearch', () => {
      expect(() => agentModel({ provider: 'deepseek', model: 'm', send: async () => ({}), webSearch: true } as unknown as AgentModelOptions))
        .toThrow(/^DeepSeek: webSearch is not supported/);
    });
  });
});
