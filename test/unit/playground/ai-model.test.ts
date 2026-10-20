// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { playgroundModel, playgroundWebTools } from '../../../src/playground/ai-model';

/** A streamed reply cut at awkward places, like real network chunks. */
const streamed = (...chunks: string[]): Response => new Response(new ReadableStream({
  start(controller) {
    const encoder = new TextEncoder();

    chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
    controller.close();
  },
}), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });

const ask = (): ReturnType<ReturnType<typeof playgroundModel>> =>
  playgroundModel('http://127.0.0.1:4800/ai')({
    system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: [], signal: new AbortController().signal,
  });

describe('playgroundModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips the deltas and returns the final message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamed(
      '{"type":"delta","index":0,"text":"Reading "}\n{"type":"del',
      'ta","index":0,"text":"the page."}\n{"type":"delta","index":2,"text":"Done."}\n',
      '{"type":"message","content":[{"type":"text","text":"Done."}],"stop_reason":"end_turn"}\n'
    ));
    const response = await ask();

    expect(response).toEqual({ content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' });
  });

  it('playground model calls onStream for tool lines and ignores text deltas', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamed(
      '{"type":"delta","index":0,"text":"Plan"}\n{"type":"tool_start","index":0,"id":"toolu_1","name":"blok_execute"}\n{"type":"tool_in',
      'put","index":0,"json":"{\\"commands\\""}\n{"type":"tool_input","index":0,"json":"{\\"commands\\":[]}"}\n',
      '{"type":"delta","index":1,"text":"ning."}\n{"type":"tool_end","index":0}\n',
      '{"type":"message","content":[{"type":"tool_use","id":"toolu_1","name":"blok_execute","input":{"commands":[]}}],"stop_reason":"tool_use"}\n'
    ));
    const onStream = vi.fn();

    const response = await playgroundModel('http://127.0.0.1:4800/ai')({
      system: 'sys', messages: [], tools: [], signal: new AbortController().signal, onStream,
    });

    expect(onStream.mock.calls.map(([event]: unknown[]) => event)).toEqual([
      { type: 'tool_start', index: 0, id: 'toolu_1', name: 'blok_execute' },
      { type: 'tool_input', index: 0, json: '{"commands"' },
      { type: 'tool_input', index: 0, json: '{"commands":[]}' },
      { type: 'tool_end', index: 0 },
    ]);
    expect(response).toEqual({ content: [{ type: 'tool_use', id: 'toolu_1', name: 'blok_execute', input: { commands: [] } }], stop_reason: 'tool_use' });
  });

  it('throws the error line, so the bar shows why', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamed('{"type":"error","error":"401 invalid x-api-key"}\n'));

    await expect(ask()).rejects.toThrow('401 invalid x-api-key');
  });

  it('throws when the stream ends without a message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamed('{"type":"delta","index":0,"text":"half"}\n'));

    await expect(ask()).rejects.toThrow('The AI endpoint stopped before the answer was complete.');
  });

  it('throws the endpoint\'s error for a refused request', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"Send { system, messages, tools }."}', { status: 400 }));

    await expect(ask()).rejects.toThrow('Send { system, messages, tools }.');
  });

  it('posts the request and passes the abort signal', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamed('{"type":"message","content":[],"stop_reason":"end_turn"}\n'));
    const controller = new AbortController();

    await playgroundModel('http://127.0.0.1:4800/ai')({ system: 's', messages: [], tools: [], signal: controller.signal });

    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ system: 's', messages: [], tools: [] }), signal: controller.signal });
  });
});

describe('playgroundWebTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers image search and fetch; web search is the provider\'s, added by the dev route', () => {
    expect(playgroundWebTools('http://127.0.0.1:4800/ai').map((tool) => tool.name)).toEqual(['image_search', 'web_fetch']);
  });

  it('runs a tool on the dev route\'s /web endpoint and returns its text', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ text: 'Red panda' }), { status: 200 }));
    const [search] = playgroundWebTools('http://127.0.0.1:4800/ai');

    expect(await search.run({ query: 'red panda' })).toBe('Red panda');
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:4800/web');
    const body = fetch.mock.calls[0][1]?.body;

    expect(typeof body === 'string' ? JSON.parse(body) : body).toEqual({ tool: 'image_search', input: { query: 'red panda' } });
  });

  it('throws the endpoint\'s error, so the model reads why', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'HTTP 404' }), { status: 502 }));
    const [, fetchTool] = playgroundWebTools('http://127.0.0.1:4800/ai');

    await expect(fetchTool.run({ url: 'https://x.example/a.jpg' })).rejects.toThrow('HTTP 404');
  });
});
