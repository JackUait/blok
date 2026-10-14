// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { AI_MODEL, handleAiRequest, messageParams } from '../../../scripts/dev-ai.mjs';

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

describe('handleAiRequest', () => {
  it('answers with the model message and an allowed-origin header', async () => {
    const response = await call();

    expect(response.status).toBe(200);
    expect(response.headers['Access-Control-Allow-Origin']).toBe(ORIGINS[0]);
    expect(JSON.parse(response.body ?? '')).toEqual({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' });
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

  it('turns a model failure into a 502 with the message', async () => {
    const response = await call({ createMessage: async () => {
      throw new Error('401 invalid x-api-key');
    } });

    expect(response.status).toBe(502);
    expect(JSON.parse(response.body ?? '')).toEqual({ error: '401 invalid x-api-key' });
  });

  it('says how to add a key when the SDK finds no credentials', async () => {
    const response = await call({ createMessage: async () => {
      throw new Error('Could not resolve authentication method. Expected one of apiKey, authToken, credentials, config, or profile to be set.');
    } });

    expect(response.status).toBe(502);
    expect(JSON.parse(response.body ?? '')).toEqual({
      error: 'No Anthropic key. Set ANTHROPIC_API_KEY (or run `ant auth login`) and restart yarn serve.',
    });
  });

  it('passes the abort signal to the model call', async () => {
    const controller = new AbortController();
    const createMessage = vi.fn(async (_params: Record<string, unknown>, _signal: AbortSignal) => ({ content: [], stop_reason: 'end_turn' }));

    await call({ signal: controller.signal, createMessage });

    expect(createMessage.mock.calls[0][1]).toBe(controller.signal);
  });
});

describe('messageParams', () => {
  it('asks the current Opus with streaming-size output and the refusal fallback', () => {
    const params = messageParams({ system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: [] });

    expect(AI_MODEL).toBe('claude-opus-5-5');
    expect(params).toMatchObject({
      model: AI_MODEL,
      max_tokens: 64_000,
      system: 'sys',
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  });
});
