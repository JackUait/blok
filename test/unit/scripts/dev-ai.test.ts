// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { AI_MODEL, aiSettings, handleAiRequest, messageParams } from '../../../scripts/dev-ai.mjs';

const ORIGINS = ['http://localhost:3303', 'http://127.0.0.1:3303'];
const HOSTS = ['127.0.0.1:4800', 'localhost:4800'];
const BODY = JSON.stringify({ system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: [] });

const call = (overrides: Partial<Parameters<typeof handleAiRequest>[0]> = {}): ReturnType<typeof handleAiRequest> =>
  handleAiRequest({
    origins: ORIGINS,
    hosts: HOSTS,
    host: HOSTS[0],
    origin: ORIGINS[0],
    method: 'POST',
    url: '/ai',
    body: BODY,
    signal: new AbortController().signal,
    createMessage: async () => ({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }),
    ...overrides,
  });

/** Runs the streamed answer and returns its NDJSON lines. */
const linesOf = async (response: Awaited<ReturnType<typeof handleAiRequest>>): Promise<unknown[]> => {
  const chunks: string[] = [];

  await response.pipe?.((chunk) => chunks.push(chunk));

  return chunks.join('').split('\n').filter((line) => line !== '').map((line): unknown => JSON.parse(line));
};

describe('handleAiRequest', () => {
  it('streams the model message as NDJSON with an allowed-origin header', async () => {
    const response = await call();

    expect(response.status).toBe(200);
    expect(response.headers['Access-Control-Allow-Origin']).toBe(ORIGINS[0]);
    expect(response.headers['Content-Type']).toBe('application/x-ndjson; charset=utf-8');
    expect(await linesOf(response)).toEqual([{ type: 'message', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }]);
  });

  it('sends each piece of text before the final message, so the bar can show it', async () => {
    const response = await call({
      createMessage: async (_params, _signal, onDelta) => {
        onDelta(0, 'Reading ');
        onDelta(0, 'the page.');
        onDelta(2, 'Done.');

        return { content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn', usage: { cache_read_input_tokens: 1200 } };
      },
    });

    expect(await linesOf(response)).toEqual([
      { type: 'delta', index: 0, text: 'Reading ' },
      { type: 'delta', index: 0, text: 'the page.' },
      { type: 'delta', index: 2, text: 'Done.' },
      { type: 'message', content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn', usage: { cache_read_input_tokens: 1200 } },
    ]);
  });

  it('refuses a foreign Host, so a rebound DNS name cannot spend the key', async () => {
    const createMessage = vi.fn();
    const response = await call({ host: 'evil.example:4800', createMessage });

    expect(response.status).toBe(403);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it('refuses a page from another origin', async () => {
    const createMessage = vi.fn();
    const response = await call({ origin: 'https://evil.example', createMessage });

    expect(response.status).toBe(403);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it('answers the CORS preflight', async () => {
    const response = await call({ method: 'OPTIONS', body: '' });

    expect(response.status).toBe(204);
    expect(response.headers['Access-Control-Allow-Methods']).toContain('POST');
    expect(response.headers['Access-Control-Allow-Headers']).toContain('Content-Type');
  });

  it('rejects a body that is not a model request', async () => {
    const response = await call({ body: '{"messages":"nope"}' });

    expect(response.status).toBe(400);
  });

  it('ends the stream with the error when the model call fails', async () => {
    const response = await call({ createMessage: async () => {
      throw new Error('401 invalid x-api-key');
    } });

    expect(await linesOf(response)).toEqual([{ type: 'error', error: '401 invalid x-api-key' }]);
  });

  it('says how to add a key when the SDK finds no credentials', async () => {
    const response = await call({ createMessage: async () => {
      throw new Error('Could not resolve authentication method. Expected one of apiKey, authToken, credentials, config, or profile to be set.');
    } });

    expect(await linesOf(response)).toEqual([{
      type: 'error',
      error: 'No AI key. Put ANTHROPIC_API_KEY in ~/.config/blok/ai.env (or run `ant auth login`) and restart yarn serve.',
    }]);
  });

  it('passes the abort signal to the model call', async () => {
    const controller = new AbortController();
    const createMessage = vi.fn(async (_params: Record<string, unknown>, _signal: AbortSignal) => ({ content: [], stop_reason: 'end_turn' }));

    await linesOf(await call({ signal: controller.signal, createMessage }));

    expect(createMessage.mock.calls[0][1]).toBe(controller.signal);
  });
});

describe('messageParams', () => {
  it('asks the current Opus with streaming-size output and the refusal fallback', () => {
    const params = messageParams(AI_MODEL, { system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: [] });

    expect(AI_MODEL).toBe('claude-opus-5-5');
    expect(params).toMatchObject({
      model: AI_MODEL,
      max_tokens: 64_000,
      fallbacks: 'default',
    });
    expect(params.betas).toContain('server-side-fallback-2026-07-01');
  });

  it('asks for the notes Opus writes between tool calls, which come back empty by default', () => {
    const params = messageParams(AI_MODEL, { system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: [] });

    expect(params.thinking).toEqual({ type: 'adaptive', display: 'updates' });
    expect(params.betas).toContain('thinking-display-updates-2026-08-18');
  });
});

describe('messageParams caching', () => {
  const params = messageParams(AI_MODEL, { system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: [] });

  it('marks the end of the tools and system prompt, which stay the same for a whole run', () => {
    expect(params.system).toEqual([{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }]);
  });

  it('caches the growing conversation, so each step reads the one before it', () => {
    expect(params.cache_control).toEqual({ type: 'ephemeral' });
  });
});

describe('aiSettings', () => {
  it('reads the key, endpoint and model from the private env file', () => {
    const file = 'ANTHROPIC_API_KEY=sk-file\nANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic\nBLOK_AI_MODEL=deepseek-v4-pro\n';

    expect(aiSettings({}, file)).toEqual({
      apiKey: 'sk-file',
      baseURL: 'https://api.deepseek.com/anthropic',
      model: 'deepseek-v4-pro',
    });
  });

  it('lets the shell override the file', () => {
    const file = 'ANTHROPIC_API_KEY=sk-file\nBLOK_AI_MODEL=deepseek-v4-pro\n';

    expect(aiSettings({ ANTHROPIC_API_KEY: 'sk-shell', BLOK_AI_MODEL: 'claude-sonnet-5-5' }, file)).toEqual({
      apiKey: 'sk-shell',
      baseURL: undefined,
      model: 'claude-sonnet-5-5',
    });
  });

  it('falls back to Opus with no key when there is no file', () => {
    expect(aiSettings({}, null)).toEqual({ apiKey: undefined, baseURL: undefined, model: AI_MODEL });
  });
});
