// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import Anthropic from '@anthropic-ai/sdk';

import { AI_MODEL, aiSettings, anthropicCreateMessage, handleAiRequest, messageParams } from '../../../scripts/dev-ai.mjs';

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

describe('handleAiRequest /web', () => {
  const web = (body: unknown, runWebTool = vi.fn(async () => 'results')): ReturnType<typeof handleAiRequest> =>
    call({ url: '/web', body: JSON.stringify(body), runWebTool });

  it('runs the named web tool with its input and answers its text', async () => {
    const runWebTool = vi.fn(async () => 'Red panda: a small mammal');
    const response = await web({ tool: 'web_search', input: { query: 'red panda' } }, runWebTool);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body ?? '')).toEqual({ text: 'Red panda: a small mammal' });
    expect(runWebTool).toHaveBeenCalledWith('web_search', { query: 'red panda' }, expect.any(AbortSignal));
  });

  it('answers a failed tool with its error, so the model reads why', async () => {
    const response = await web({ tool: 'web_fetch', input: { url: 'https://x.example' } }, vi.fn(async () => {
      throw new Error('fetch failed');
    }));

    expect(response.status).toBe(502);
    expect(JSON.parse(response.body ?? '')).toEqual({ error: 'fetch failed' });
  });

  it('rejects a body without a tool name', async () => {
    const runWebTool = vi.fn();
    const response = await web({ input: {} }, runWebTool);

    expect(response.status).toBe(400);
    expect(runWebTool).not.toHaveBeenCalled();
  });

  it('refuses a page from another origin', async () => {
    const runWebTool = vi.fn();
    const response = await call({ url: '/web', origin: 'https://evil.example', body: '{"tool":"web_search","input":{}}', runWebTool });

    expect(response.status).toBe(403);
    expect(runWebTool).not.toHaveBeenCalled();
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

type StreamEvent = { type: string } & Record<string, unknown>;

/** A fetch that answers every call with these events as server-sent events. */
const sseFetch = (events: StreamEvent[]): typeof fetch => async () => new Response(
  events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
  { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
);

const messageStart: StreamEvent = {
  type: 'message_start',
  message: {
    id: 'msg_1', type: 'message', role: 'assistant', model: 'deepseek-flash', content: [],
    stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 },
  },
};

const toolBlock = (index: number, id: string, pieces: string[]): StreamEvent[] => [
  { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name: 'blok_execute', input: {} } },
  ...pieces.map((partial_json): StreamEvent => ({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json } })),
  { type: 'content_block_stop', index },
];

const textBlock = (index: number, pieces: string[]): StreamEvent[] => [
  { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
  ...pieces.map((text): StreamEvent => ({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } })),
  { type: 'content_block_stop', index },
];

const messageEnd = (stopReason: string): StreamEvent[] => [
  { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 42 } },
  { type: 'message_stop' },
];

const PARAMS = { model: 'deepseek-flash', max_tokens: 100, messages: [{ role: 'user' as const, content: 'hi' }] };

describe('anthropicCreateMessage', () => {
  // The exact arguments DeepSeek sent: the first command never gets its name or closing brace.
  const BROKEN = '{"commands": [{"args": {"id": "F6eqMc4a9R", "range": {"find": "посты и статьи"}, "with": "посты и статьи в блоге"}, '
    + '{"name": "text.replace", "args": {"id": "F6eqMc4a9R", "range": {"find": "посты и статьи в блоге в блоге"}, "with": "посты и статьи в блоге"}}]}';

  it('hands broken tool arguments back as invalidJson, so the run reports them and the model can retry', async () => {
    const events = [
      messageStart,
      ...toolBlock(0, 'toolu_1', [BROKEN.slice(0, 60), BROKEN.slice(60)]),
      ...textBlock(1, ['after']),
      ...messageEnd('tool_use'),
    ];
    const create = await anthropicCreateMessage({ apiKey: 'k', baseURL: 'http://model.test', fetch: sseFetch(events) });

    const message = await create(PARAMS, new AbortController().signal, () => {});

    expect(message.content).toEqual([
      { type: 'tool_use', id: 'toolu_1', name: 'blok_execute', input: { invalidJson: BROKEN } },
      { type: 'text', text: 'after' },
    ]);
    expect(message.stop_reason).toBe('tool_use');
  });

  // The SDK's own parser repairs these: it drops the bad value or the cut-off end, and the edit would run.
  it.each([
    ['a stray quote', '{"commands": [{"name": "text.insert", "args": {"id": "a", "text": "a"b"}}]}'],
    ['a misspelled literal', '{"commands": [{"name": "block.delete", "args": {"id": "a", "force": tru}}]}'],
    ['trailing text', '{"commands": []} and more'],
    ['a cut-off end', '{"commands": [{"name": "block.delete", "args": {"id": "a"}}'],
    ['a value that is not an object', '[]'],
    ['null', 'null'],
    ['a string', '"commands"'],
  ])('hands back %s as invalidJson, not a repaired guess', async (_case, text) => {
    const events = [messageStart, ...toolBlock(0, 'toolu_1', [text]), ...messageEnd('tool_use')];
    const create = await anthropicCreateMessage({ apiKey: 'k', baseURL: 'http://model.test', fetch: sseFetch(events) });

    const message = await create(PARAMS, new AbortController().signal, () => {});

    expect(message.content).toEqual([{ type: 'tool_use', id: 'toolu_1', name: 'blok_execute', input: { invalidJson: text } }]);
  });

  it('keeps the arguments of a tool block the stream never stops', async () => {
    const text = '{"commands": [{"name": "block.delete", "args": {"id": "a"}}]}';
    const events = [
      messageStart,
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'blok_execute', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: text } },
      ...messageEnd('tool_use'),
    ];
    const create = await anthropicCreateMessage({ apiKey: 'k', baseURL: 'http://model.test', fetch: sseFetch(events) });

    const message = await create(PARAMS, new AbortController().signal, () => {});

    expect(message.content).toEqual([{ type: 'tool_use', id: 'toolu_1', name: 'blok_execute', input: JSON.parse(text) }]);
  });

  it('builds the same message as the SDK when the stream is valid', async () => {
    const events = [
      messageStart,
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Reading ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'the table.' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
      { type: 'content_block_stop', index: 0 },
      ...textBlock(1, ['Trans', 'lating.']),
      ...toolBlock(2, 'toolu_1', ['{"commands": [{"name": "text.replace", ', '"args": {"id": "a"}}]}']),
      ...toolBlock(3, 'toolu_2', []),
      ...messageEnd('tool_use'),
    ];
    const fetch = sseFetch(events);
    const expected = await new Anthropic({ apiKey: 'k', baseURL: 'http://model.test', fetch }).beta.messages.stream(PARAMS).finalMessage();
    const deltas: Array<[number, string]> = [];
    const create = await anthropicCreateMessage({ apiKey: 'k', baseURL: 'http://model.test', fetch });

    const message = await create(PARAMS, new AbortController().signal, (index, text) => deltas.push([index, text]));

    expect(message).toEqual(expected);
    expect(deltas).toEqual([[0, 'Reading '], [0, 'the table.'], [1, 'Trans'], [1, 'lating.']]);
  });
});

const typeOf = (line: unknown): unknown => (typeof line === 'object' && line !== null && 'type' in line ? line.type : null);

describe('dev route tool streaming', () => {
  const lines = async (events: StreamEvent[]): Promise<unknown[]> => {
    const createMessage = await anthropicCreateMessage({ apiKey: 'k', baseURL: 'http://model.test', fetch: sseFetch(events) });

    return linesOf(await call({ createMessage }));
  };

  it('dev route forwards tool input deltas', async () => {
    const first = ['{"commands": [', '{"name": "block.delete", ', '"args": {"id": "a"}}]}'];
    const events = [
      messageStart,
      ...textBlock(0, ['Plan']),
      ...textBlock(1, ['ning.']),
      ...toolBlock(2, 'toolu_1', first),
      ...toolBlock(3, 'toolu_2', []),
      ...messageEnd('tool_use'),
    ];

    const sent = await lines(events);

    expect(sent.filter((line) => typeOf(line) !== 'delta')).toEqual([
      { type: 'tool_start', index: 0, id: 'toolu_1', name: 'blok_execute' },
      { type: 'tool_input', index: 0, json: first[0] },
      { type: 'tool_input', index: 0, json: first[0] + first[1] },
      { type: 'tool_input', index: 0, json: first.join('') },
      { type: 'tool_end', index: 0 },
      { type: 'tool_start', index: 1, id: 'toolu_2', name: 'blok_execute' },
      { type: 'tool_end', index: 1 },
      {
        type: 'message',
        content: [
          { type: 'text', text: 'Plan' },
          { type: 'text', text: 'ning.' },
          { type: 'tool_use', id: 'toolu_1', name: 'blok_execute', input: JSON.parse(first.join('')) },
          { type: 'tool_use', id: 'toolu_2', name: 'blok_execute', input: {} },
        ],
        stop_reason: 'tool_use',
        usage: expect.objectContaining({ output_tokens: 42 }),
      },
    ]);
  });

  // The loop runs a call at tool_end with the last input it saw; it must match the final block.
  it('ends a call whose input is not an object with the same invalidJson the message carries', async () => {
    const sent = await lines([messageStart, ...toolBlock(0, 'toolu_1', ['[', ']']), ...messageEnd('tool_use')]);

    expect(sent.slice(0, 5)).toEqual([
      { type: 'tool_start', index: 0, id: 'toolu_1', name: 'blok_execute' },
      { type: 'tool_input', index: 0, json: '[' },
      { type: 'tool_input', index: 0, json: '[]' },
      { type: 'tool_input', index: 0, json: JSON.stringify({ invalidJson: '[]' }) },
      { type: 'tool_end', index: 0 },
    ]);
    expect(sent[5]).toMatchObject({ type: 'message', content: [{ type: 'tool_use', id: 'toolu_1', input: { invalidJson: '[]' } }] });
  });

  it('gives a tool block the stream never stops no tool_end, so the final message runs it', async () => {
    const sent = await lines([
      messageStart,
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'blok_execute', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"commands": []}' } },
      ...messageEnd('tool_use'),
    ]);

    expect(sent.map(typeOf)).toEqual(['tool_start', 'tool_input', 'message']);
  });

  it('counts calls per answer, so a second answer starts at index 0 again', async () => {
    const fetch = sseFetch([messageStart, ...toolBlock(1, 'toolu_1', ['{}']), ...messageEnd('tool_use')]);
    const create = await anthropicCreateMessage({ apiKey: 'k', baseURL: 'http://model.test', fetch });
    const seen: unknown[] = [];

    await create(PARAMS, new AbortController().signal, () => {}, (event) => seen.push(event));
    await create(PARAMS, new AbortController().signal, () => {}, (event) => seen.push(event));

    expect(seen.filter((event) => typeOf(event) === 'tool_start')).toEqual([
      { type: 'tool_start', index: 0, id: 'toolu_1', name: 'blok_execute' },
      { type: 'tool_start', index: 0, id: 'toolu_1', name: 'blok_execute' },
    ]);
  });
});
