import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { geminiModel } from '../../../src/agent-models/gemini';
import { runAssistantLoop } from '../../../src/agent/assistant-loop';
import type { AgentModelMessage, AgentModelStreamEvent } from '../../../types/api';

import { fakeStream, request, sseStream } from './stream-helpers';

const FIXTURE = readFileSync(resolve(__dirname, 'fixtures/gemini-stream.sse'), 'utf8');

const sse = (...chunks: unknown[]): string => chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\r\n\r\n`).join('');

const heading = { commands: [{ name: 'block.insert', args: { type: 'header' } }] };

const fakeSend = (...replies: unknown[]): { send: (body: Record<string, unknown>) => Promise<unknown>; bodies: Record<string, unknown>[] } => {
  const bodies: Record<string, unknown>[] = [];

  return {
    bodies,
    send: async (body) => {
      bodies.push(structuredClone(body));

      return replies.shift();
    },
  };
};

const run = (model: ReturnType<typeof geminiModel>, messages: AgentModelMessage[], thinking?: 'off' | 'high') => runAssistantLoop({
  model, system: 'sys', tools: [{ name: 'blok_read', description: 'd', input_schema: { type: 'object' } }],
  messages, call: async () => ({ content: '{"ok":true}', isError: false }),
  signal: new AbortController().signal, maxSteps: 5, ...(thinking === undefined ? {} : { thinking }),
});

describe('geminiModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const candidate = (parts: unknown[], finishReason = 'STOP') => ({ candidates: [{ content: { role: 'model', parts }, finishReason }] });
  const signedCall = { functionCall: { id: 'c1', name: 'blok_read', args: {} }, thoughtSignature: 'sig' };

  it('replays model parts with their thought signature, then one user content of responses', async () => {
    const { send, bodies } = fakeSend(candidate([{ text: 'plan', thought: true }, signedCall]), candidate([{ text: 'Done.' }]));

    expect(await run(geminiModel({ model: 'gemini-3.8-flash', send }), [{ role: 'user', content: 'Go' }]))
      .toEqual({ status: 'done', reply: 'Done.' });
    expect(bodies[1].contents).toEqual([
      { role: 'user', parts: [{ text: 'Go' }] },
      { role: 'model', parts: [{ text: 'plan', thought: true }, signedCall] },
      { role: 'user', parts: [{ functionResponse: { id: 'c1', name: 'blok_read', response: { result: '{"ok":true}' } } }] },
    ]);
    expect(bodies[0]).toEqual({
      systemInstruction: { parts: [{ text: 'sys' }] },
      contents: [{ role: 'user', parts: [{ text: 'Go' }] }],
      tools: [{ functionDeclarations: [{ name: 'blok_read', description: 'd', parametersJsonSchema: { type: 'object' } }] }],
      generationConfig: { maxOutputTokens: 16000 },
    });
  });

  it('invents a stable id when the call has none, and the response carries it', async () => {
    const { send, bodies } = fakeSend(candidate([{ functionCall: { name: 'blok_read', args: {} } }]), candidate([{ text: 'ok' }]));

    await run(geminiModel({ model: 'm', send }), [{ role: 'user', content: 'Go' }]);

    const responses = (bodies[1].contents as Array<{ parts: Array<{ functionResponse?: { id: string; name: string } }> }>)[2].parts;

    expect(responses[0].functionResponse).toEqual({ id: 'call-1-0', name: 'blok_read', response: { result: '{"ok":true}' } });
  });

  it('treats an empty id as missing', async () => {
    const { send, bodies } = fakeSend(candidate([{ functionCall: { id: '', name: 'blok_read', args: {} } }]), candidate([{ text: 'ok' }]));

    await run(geminiModel({ model: 'm', send }), [{ role: 'user', content: 'Go' }]);
    expect((bodies[1].contents as unknown[]).slice(1)).toEqual([
      { role: 'model', parts: [{ functionCall: { id: 'call-1-0', name: 'blok_read', args: {} } }] },
      { role: 'user', parts: [{ functionResponse: { id: 'call-1-0', name: 'blok_read', response: { result: '{"ok":true}' } } }] },
    ]);
  });

  it('sends a failed tool result under error', async () => {
    const { send, bodies } = fakeSend(candidate([signedCall]), candidate([{ text: 'ok' }]));

    await runAssistantLoop({
      model: geminiModel({ model: 'm', send }), system: 's', tools: [], messages: [{ role: 'user', content: 'a' }],
      call: async () => ({ content: '{"ok":false}', isError: true }), signal: new AbortController().signal, maxSteps: 5,
    });
    expect((bodies[1].contents as Array<{ parts: unknown[] }>)[2].parts[0])
      .toEqual({ functionResponse: { id: 'c1', name: 'blok_read', response: { error: '{"ok":false}' } } });
  });

  it('maps stop states: MAX_TOKENS, SAFETY, a blocked prompt', async () => {
    const max = fakeSend(candidate([{ text: 'cut' }], 'MAX_TOKENS'));
    const safety = fakeSend(candidate([], 'SAFETY'));
    const blocked = fakeSend({ promptFeedback: { blockReason: 'SAFETY' } });

    expect((await run(geminiModel({ model: 'm', send: max.send }), [{ role: 'user', content: 'a' }])).status).toBe('truncated');
    expect((await run(geminiModel({ model: 'm', send: safety.send }), [{ role: 'user', content: 'a' }])).status).toBe('refused');
    expect((await run(geminiModel({ model: 'm', send: blocked.send }), [{ role: 'user', content: 'a' }])).status).toBe('refused');
  });

  it('maps levels to thinkingLevel inside generationConfig, keeping maxOutputTokens', async () => {
    const end = candidate([{ text: 'ok' }]);
    const { send, bodies } = fakeSend(end, end);

    await run(geminiModel({ model: 'm', send }), [{ role: 'user', content: 'a' }], 'off');
    await run(geminiModel({ model: 'm', send }), [{ role: 'user', content: 'a' }], 'high');
    expect(bodies.map((body) => body.generationConfig)).toEqual([
      { maxOutputTokens: 16000, thinkingConfig: { thinkingLevel: 'MINIMAL' } },
      { maxOutputTokens: 16000, thinkingConfig: { thinkingLevel: 'HIGH' } },
    ]);
  });

  it('passes the model id to send, since Gemini puts it in the URL', async () => {
    const seen: unknown[] = [];

    await run(geminiModel({ model: 'gemini-3.8-flash', send: async (_body, context) => {
      seen.push(context.model);

      return candidate([{ text: 'ok' }]);
    } }), [{ role: 'user', content: 'a' }]);
    expect(seen).toEqual(['gemini-3.8-flash']);
  });

  it('a send that edits the replayed parts leaves the stored turn alone', async () => {
    const replies: unknown[] = [candidate([signedCall]), candidate([signedCall]), candidate([{ text: 'ok' }])];
    const bodies: Record<string, unknown>[] = [];
    const send = async (body: Record<string, unknown>): Promise<unknown> => {
      bodies.push(structuredClone(body));
      const turn: unknown = Array.isArray(body.contents) ? body.contents[1] : undefined;

      if (typeof turn === 'object' && turn !== null && 'parts' in turn && Array.isArray(turn.parts)) {
        Reflect.set(turn.parts, 0, { text: 'edited' });
      }

      return replies.shift();
    };

    await run(geminiModel({ model: 'm', send }), [{ role: 'user', content: 'Go' }]);
    expect((bodies[2].contents as unknown[])[1]).toEqual({ role: 'model', parts: [signedCall] });
  });

  it('turns an error body into a failed run', async () => {
    const { send } = fakeSend({ error: { code: 400, message: 'API key not valid' } });

    expect(await run(geminiModel({ model: 'm', send }), [{ role: 'user', content: 'a' }]))
      .toEqual({ status: 'failed', reply: '', error: 'Gemini: API key not valid' });
  });
  // Nothing ran for a malformed call, so asking again is safe; a "done" with no edit is not.
  it('asks again when the model writes a malformed tool call', async () => {
    const malformed = { candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'MALFORMED_FUNCTION_CALL' }] };
    const { send, bodies } = fakeSend(malformed, candidate([signedCall]), candidate([{ text: 'Done.' }]));

    const result = await run(geminiModel({ model: 'm', send }), [{ role: 'user', content: 'a' }]);

    expect(result).toEqual({ status: 'done', reply: 'Done.' });
    expect(bodies).toHaveLength(3);
    expect(bodies[1]).toEqual(bodies[0]);
  });

  it('fails the run with Gemini\'s message when every try is malformed', async () => {
    const malformed = {
      candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'MALFORMED_FUNCTION_CALL', finishMessage: 'Malformed function call: bad quote' }],
    };
    const { send, bodies } = fakeSend(malformed, malformed, malformed);

    expect(await run(geminiModel({ model: 'm', send }), [{ role: 'user', content: 'a' }])).toEqual({
      status: 'failed', reply: '', error: 'Gemini wrote a tool call that was not valid, 3 times: Malformed function call: bad quote',
    });
    expect(bodies).toHaveLength(3);
  });

  it('fails the run on a stop reason it does not handle', async () => {
    const missing = fakeSend({ candidates: [{ finishReason: 'MISSING_THOUGHT_SIGNATURE' }] });
    const tooMany = fakeSend({ candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'TOO_MANY_TOOL_CALLS' }] });

    expect(await run(geminiModel({ model: 'm', send: missing.send }), [{ role: 'user', content: 'a' }]))
      .toEqual({ status: 'failed', reply: '', error: 'Gemini stopped: MISSING_THOUGHT_SIGNATURE' });
    expect(await run(geminiModel({ model: 'm', send: tooMany.send }), [{ role: 'user', content: 'a' }]))
      .toEqual({ status: 'failed', reply: '', error: 'Gemini stopped: TOO_MANY_TOOL_CALLS' });
  });

  it('drops another adapter\'s provider blocks and rebuilds the turn', async () => {
    const { send, bodies } = fakeSend(candidate([{ text: 'ok' }]));

    await run(geminiModel({ model: 'm', send }), [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: [
        { type: 'text', text: 'b' },
        { type: 'tool_use', id: 'u1', name: 'blok_read', input: { x: 1 } },
        { type: 'provider', format: 'anthropic', raw: [{ type: 'thinking', signature: 'foreign' }] },
      ] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u1', content: '{"ok":true}' }] },
    ]);
    expect((bodies[0].contents as unknown[]).slice(1)).toEqual([
      { role: 'model', parts: [{ text: 'b' }, { functionCall: { id: 'u1', name: 'blok_read', args: { x: 1 } } }] },
      { role: 'user', parts: [{ functionResponse: { id: 'u1', name: 'blok_read', response: { result: '{"ok":true}' } } }] },
    ]);
  });
  describe('streaming', () => {
    it('emits each whole functionCall as tool_start, one tool_input and tool_end', async () => {
      const events: AgentModelStreamEvent[] = [];

      await geminiModel({ model: 'm', stream: fakeStream(FIXTURE).stream })(request((event) => events.push(event)));

      expect(events).toEqual([
        { type: 'tool_start', index: 0, id: 'call-1-2', name: 'blok_execute' },
        { type: 'tool_input', index: 0, json: JSON.stringify(heading) },
        { type: 'tool_end', index: 0 },
        { type: 'tool_start', index: 1, id: 'fc_2', name: 'blok_read' },
        { type: 'tool_input', index: 1, json: '{}' },
        { type: 'tool_end', index: 1 },
      ]);
    });

    it('the streamed response equals the non-streamed one for the same content', async () => {
      const twin = {
        candidates: [{
          content: { role: 'model', parts: [
            { text: 'Plan it.', thought: true },
            { text: 'Adding a heading.', thoughtSignature: 'sigT' },
            { functionCall: { name: 'blok_execute', args: heading }, thoughtSignature: 'sig1' },
            { functionCall: { id: 'fc_2', name: 'blok_read', args: {} } },
          ] },
          finishReason: 'STOP',
          index: 0,
        }],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 40, totalTokenCount: 52 },
      };
      const streamed = await geminiModel({ model: 'm', stream: fakeStream(FIXTURE).stream })(request(() => undefined));
      const sent = await geminiModel({ model: 'm', send: fakeSend(twin).send })(request());

      expect(streamed).toEqual(sent);
      expect(streamed.stop_reason).toBe('tool_use');
      expect(streamed.content.slice(0, 3)).toEqual([
        { type: 'text', text: 'Adding a heading.' },
        { type: 'tool_use', id: 'call-1-2', name: 'blok_execute', input: heading },
        { type: 'tool_use', id: 'fc_2', name: 'blok_read', input: {} },
      ]);
    });

    it('sends the same body as send, and passes the model id to stream', async () => {
      const streaming = fakeStream(FIXTURE);
      const plain = fakeSend(candidate([{ text: 'ok' }]));
      const models: string[] = [];

      await geminiModel({ model: 'gemini-3.8-flash', stream: async (body, context) => {
        models.push(context.model);

        return streaming.stream(body, context);
      } })(request());
      await geminiModel({ model: 'gemini-3.8-flash', send: plain.send })(request());

      expect(streaming.bodies[0]).toEqual(plain.bodies[0]);
      expect(models).toEqual(['gemini-3.8-flash']);
    });

    it('retries a malformed streamed call without emitting its events', async () => {
      const malformed = sse(
        { candidates: [{ content: { role: 'model', parts: [{ text: 'Trying' }] } }] },
        { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'blok_execute', args: { bad: true } } }] }, finishReason: 'MALFORMED_FUNCTION_CALL' }] }
      );
      const { stream, bodies } = fakeStream(malformed, FIXTURE);
      const events: AgentModelStreamEvent[] = [];

      const response = await geminiModel({ model: 'm', stream })(request((event) => events.push(event)));

      expect(events.filter((event) => event.type === 'tool_start')).toEqual([
        { type: 'tool_start', index: 0, id: 'call-1-2', name: 'blok_execute' },
        { type: 'tool_start', index: 1, id: 'fc_2', name: 'blok_read' },
      ]);
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toEqual(bodies[0]);
      expect(response.stop_reason).toBe('tool_use');
    });

    it('emits nothing for an attempt whose call came before a later MALFORMED_FUNCTION_CALL, and the loop applies only the retry', async () => {
      const malformed = sse(
        { candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: 'bad', name: 'blok_read', args: { attempt: 1 } } }] } }] },
        { candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'MALFORMED_FUNCTION_CALL' }] }
      );
      const good = sse({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: 'good', name: 'blok_read', args: { attempt: 2 } } }] }, finishReason: 'STOP' }] });
      const done = sse({ candidates: [{ content: { role: 'model', parts: [{ text: 'Done.' }] }, finishReason: 'STOP' }] });
      const { stream, bodies } = fakeStream(malformed, good, done);
      const events: AgentModelStreamEvent[] = [];
      const applied: unknown[] = [];

      const result = await runAssistantLoop({
        model: geminiModel({ model: 'm', stream }), system: 'sys', tools: [{ name: 'blok_read', description: 'd', input_schema: { type: 'object' } }],
        messages: [{ role: 'user', content: 'Go' }],
        call: async (_name, input) => {
          applied.push(input);

          return { content: '{"ok":true}', isError: false };
        },
        signal: new AbortController().signal, maxSteps: 5, onStream: (event) => events.push(event),
      });

      expect(applied).toEqual([{ attempt: 2 }]);
      expect(events).toEqual([
        { type: 'tool_start', index: 0, id: 'good', name: 'blok_read' },
        { type: 'tool_input', index: 0, json: '{"attempt":2}' },
        { type: 'tool_end', index: 0 },
      ]);
      expect(result).toEqual({ status: 'done', reply: 'Done.' });
      expect(bodies).toHaveLength(3);
    });

    it('emits nothing for a call followed by TOO_MANY_TOOL_CALLS, and the run fails as before', async () => {
      const text = sse(
        { candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: 'c1', name: 'blok_read', args: {} } }] } }] },
        { candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'TOO_MANY_TOOL_CALLS' }] }
      );
      const events: AgentModelStreamEvent[] = [];

      await expect(geminiModel({ model: 'm', stream: fakeStream(text).stream })(request((event) => events.push(event))))
        .rejects.toThrow('Gemini stopped: TOO_MANY_TOOL_CALLS');
      expect(events).toEqual([]);
    });

    it('emits nothing when the prompt is blocked, even with a call and STOP', async () => {
      const text = sse(
        { candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: 'c1', name: 'blok_read', args: {} } }] }, finishReason: 'STOP' }] },
        { promptFeedback: { blockReason: 'SAFETY' } }
      );
      const events: AgentModelStreamEvent[] = [];

      const response = await geminiModel({ model: 'm', stream: fakeStream(text).stream })(request((event) => events.push(event)));

      expect(events).toEqual([]);
      expect(response.stop_reason).toBe('refusal');
    });

    it('emits a STOP stream\'s calls only after the last chunk is read', async () => {
      const chunks = FIXTURE.split(/(?<=\n\n)/).filter((chunk) => chunk.trim() !== '');
      const served = { count: 0 };
      const seen: number[] = [];
      const stream = async (): Promise<ReadableStream<Uint8Array>> => new ReadableStream({
        pull: (controller) => {
          const chunk = chunks[served.count];

          if (chunk === undefined) {
            controller.close();

            return;
          }
          served.count += 1;
          controller.enqueue(new TextEncoder().encode(chunk));
        },
      }, { highWaterMark: 0 });

      await geminiModel({ model: 'm', stream })(request(() => seen.push(served.count)));

      expect(chunks).toHaveLength(6);
      expect(seen).toHaveLength(6);
      expect(seen.every((count) => count === chunks.length)).toBe(true);
    });

    it('runs a whole streamed turn through the loop', async () => {
      const done = sse({ candidates: [{ content: { role: 'model', parts: [{ text: 'Done.' }] }, finishReason: 'STOP' }] });
      const { stream } = fakeStream(FIXTURE, done);

      expect(await run(geminiModel({ model: 'm', stream }), [{ role: 'user', content: 'Go' }])).toEqual({ status: 'done', reply: 'Done.' });
    });

    it('maps a blocked prompt in the stream to a refusal', async () => {
      const blocked = sse({ promptFeedback: { blockReason: 'SAFETY' } });

      expect(await geminiModel({ model: 'm', stream: fakeStream(blocked).stream })(request())).toEqual({ content: [], stop_reason: 'refusal' });
    });

    it('throws on an error chunk', async () => {
      const text = sse({ candidates: [{ content: { parts: [{ text: 'a' }] } }] }, { error: { code: 503, message: 'Overloaded' } });

      await expect(geminiModel({ model: 'm', stream: fakeStream(text).stream })(request())).rejects.toThrow('Gemini: Overloaded');
    });

    it('throws the provider\'s message for an HTTP error response', async () => {
      const stream = async (): Promise<Response> => new Response('{"error":{"code":400,"message":"API key not valid"}}', { status: 400 });

      await expect(geminiModel({ model: 'm', stream })(request())).rejects.toThrow('Gemini: API key not valid');
    });

    it('throws when the stream ends before a finishReason', async () => {
      const cut = FIXTURE.slice(0, FIXTURE.lastIndexOf('data: '));

      await expect(geminiModel({ model: 'm', stream: fakeStream(cut).stream })(request())).rejects.toThrow('Gemini: the stream ended early.');
    });

    it('throws instead of returning half a reply when the run stops mid-stream', async () => {
      const controller = new AbortController();
      const stream = async (): Promise<ReadableStream<Uint8Array>> => new ReadableStream({
        start: (source) => {
          source.enqueue(new TextEncoder().encode(FIXTURE.slice(0, FIXTURE.lastIndexOf('data: '))));
          // Calls emit only after the finish, so the stop comes from outside, with the stream still open.
          setTimeout(() => controller.abort(), 0);
        },
      });
      const events: AgentModelStreamEvent[] = [];

      await expect(geminiModel({ model: 'm', stream })(request((event) => events.push(event), controller.signal)))
        .rejects.toThrow('Gemini: the run stopped mid-stream.');
      expect(events).toEqual([]);
    });

    it('reads a stream split into one-byte chunks', async () => {
      const stream = async (): Promise<ReadableStream<Uint8Array>> => sseStream(FIXTURE, 1);
      const response = await geminiModel({ model: 'm', stream })(request());

      expect(response.stop_reason).toBe('tool_use');
    });
  });

  describe('webSearch', () => {
    const declarations = { functionDeclarations: [{ name: 'blok_read', description: 'd', parametersJsonSchema: { type: 'object' } }] };

    it('offers Google Search as its own tool entry, and only when asked', async () => {
      const on = fakeSend(candidate([{ text: 'ok' }]));
      const off = fakeSend(candidate([{ text: 'ok' }]));

      await run(geminiModel({ model: 'm', send: on.send, webSearch: true }), [{ role: 'user', content: 'Go' }]);
      await run(geminiModel({ model: 'm', send: off.send }), [{ role: 'user', content: 'Go' }]);

      expect(on.bodies[0].tools).toEqual([declarations, { googleSearch: {} }]);
      expect(off.bodies[0].tools).toEqual([declarations]);
    });

    it('merges an options object into the search tool entry', async () => {
      const { send, bodies } = fakeSend(candidate([{ text: 'ok' }]));
      const range = { timeRangeFilter: { startTime: '2026-01-01T00:00:00Z' } };

      await run(geminiModel({ model: 'm', send, webSearch: { googleSearch: range } }), [{ role: 'user', content: 'Go' }]);

      expect((bodies[0].tools as unknown[])[1]).toEqual({ googleSearch: range });
    });

    it('sends server-side search parts back unchanged', async () => {
      const toolCall = { toolCall: { id: 's1', toolType: 'GOOGLE_SEARCH_WEB', args: { queries: ['nobel 2026'] } }, thoughtSignature: 'sig-s' };
      const toolResponse = { toolResponse: { id: 's1', toolType: 'GOOGLE_SEARCH_WEB', response: { search_suggestions: '' } } };
      const { send, bodies } = fakeSend(candidate([toolCall, toolResponse, signedCall]), candidate([{ text: 'Halzen won.' }]));

      expect(await run(geminiModel({ model: 'm', send, webSearch: true }), [{ role: 'user', content: 'Go' }]))
        .toEqual({ status: 'done', reply: 'Halzen won.' });
      expect((bodies[1].contents as unknown[])[1]).toEqual({ role: 'model', parts: [toolCall, toolResponse, signedCall] });
    });
  });
});
