// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { playgroundModel } from '../../../src/playground/ai-model';

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
