import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openaiModel } from '../../../src/agent-models/openai';
import { runAssistantLoop } from '../../../src/agent/assistant-loop';
import type { AgentModelMessage, AgentModelStreamEvent } from '../../../types/api';

import { fakeStream, request } from './stream-helpers';

const FIXTURE = readFileSync(resolve(__dirname, 'fixtures/openai-stream.sse'), 'utf8');

const sse = (...events: Array<Record<string, unknown>>): string => events
  .map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join('');

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

const run = (model: ReturnType<typeof openaiModel>, messages: AgentModelMessage[], thinking?: 'off' | 'high') => runAssistantLoop({
  model, system: 'sys', tools: [{ name: 'blok_read', description: 'd', input_schema: { type: 'object' } }],
  messages, call: async () => ({ content: '{"ok":true}', isError: false }),
  signal: new AbortController().signal, maxSteps: 5, ...(thinking === undefined ? {} : { thinking }),
});

describe('openaiModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'enc' };
  const commentary = { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Reading.', annotations: [] }] };
  const call = { type: 'function_call', call_id: 'call_1', name: 'blok_read', arguments: '{}' };

  it('builds a stateless Responses body', async () => {
    const { send, bodies } = fakeSend({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hi', annotations: [] }] }] });

    expect(await run(openaiModel({ model: 'gpt-5.5', send }), [{ role: 'user', content: 'Go' }])).toEqual({ status: 'done', reply: 'Hi' });
    expect(bodies[0]).toEqual({
      model: 'gpt-5.5', instructions: 'sys', store: false, max_output_tokens: 16000,
      input: [{ role: 'user', content: 'Go' }],
      tools: [{ type: 'function', name: 'blok_read', description: 'd', parameters: { type: 'object' }, strict: false }],
    });
  });

  it('replays reasoning, phase and calls unchanged, then the call output', async () => {
    const { send, bodies } = fakeSend(
      { status: 'completed', output: [reasoning, commentary, call] },
      { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.', annotations: [] }] }] }
    );

    await run(openaiModel({ model: 'm', send }), [{ role: 'user', content: 'Go' }]);
    expect(bodies[1].input).toEqual([
      { role: 'user', content: 'Go' },
      reasoning, commentary, call,
      { type: 'function_call_output', call_id: 'call_1', output: '{"ok":true}' },
    ]);
  });

  it('gives each call without a call_id its own id, and the replayed call carries it', async () => {
    const bare = { type: 'function_call', name: 'blok_read', arguments: '{}' };
    const { send, bodies } = fakeSend(
      { status: 'completed', output: [bare, bare] },
      { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.', annotations: [] }] }] }
    );

    await run(openaiModel({ model: 'm', send }), [{ role: 'user', content: 'Go' }]);
    expect(bodies[1].input).toEqual([
      { role: 'user', content: 'Go' },
      { ...bare, call_id: 'call-1-0' },
      { ...bare, call_id: 'call-1-1' },
      { type: 'function_call_output', call_id: 'call-1-0', output: '{"ok":true}' },
      { type: 'function_call_output', call_id: 'call-1-1', output: '{"ok":true}' },
    ]);
  });

  it('maps stop states: truncation, refusal, content filter', async () => {
    const truncated = fakeSend({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] });
    const refused = fakeSend({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'No.' }] }] });
    const filtered = fakeSend({ status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] });

    expect((await run(openaiModel({ model: 'm', send: truncated.send }), [{ role: 'user', content: 'a' }])).status).toBe('truncated');
    expect((await run(openaiModel({ model: 'm', send: refused.send }), [{ role: 'user', content: 'a' }])).status).toBe('refused');
    expect((await run(openaiModel({ model: 'm', send: filtered.send }), [{ role: 'user', content: 'a' }])).status).toBe('refused');
  });

  it('hands broken arguments to the tool instead of throwing', async () => {
    const { send } = fakeSend(
      { status: 'completed', output: [{ ...call, arguments: '{"a":' }] },
      { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }] }
    );
    const seen: unknown[] = [];

    await runAssistantLoop({
      model: openaiModel({ model: 'm', send }), system: 's', tools: [], messages: [{ role: 'user', content: 'a' }],
      call: async (_name, input) => {
        seen.push(input);

        return { content: '{"ok":false}', isError: true };
      },
      signal: new AbortController().signal, maxSteps: 5,
    });
    expect(seen).toEqual([{ invalidJson: '{"a":' }]);
  });

  it('maps levels to reasoning.effort, off as low, since some models reject none', async () => {
    const end = { status: 'completed', output: [] };
    const { send, bodies } = fakeSend(end, end);

    await run(openaiModel({ model: 'm', send }), [{ role: 'user', content: 'a' }], 'off');
    await run(openaiModel({ model: 'm', send }), [{ role: 'user', content: 'a' }], 'high');
    expect(bodies.map((body) => body.reasoning)).toEqual([{ effort: 'low' }, { effort: 'high' }]);
  });

  it('rebuilds a turn that has no Responses block, e.g. after switching adapters', async () => {
    const { send, bodies } = fakeSend({ status: 'completed', output: [] });

    await run(openaiModel({ model: 'm', send }), [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: [
        { type: 'text', text: 'b' },
        { type: 'tool_use', id: 'u1', name: 'blok_read', input: { x: 1 } },
        { type: 'provider', format: 'gemini', raw: [] },
      ] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'r' }] },
    ]);
    expect(bodies[0].input).toEqual([
      { role: 'user', content: 'a' },
      { type: 'message', role: 'assistant', content: 'b' },
      { type: 'function_call', call_id: 'u1', name: 'blok_read', arguments: '{"x":1}' },
      { type: 'function_call_output', call_id: 'u1', output: 'r' },
    ]);
  });

  it('a send that edits the level fragment does not change the next model\'s body', async () => {
    const end = { status: 'completed', output: [] };
    const bodies: Record<string, unknown>[] = [];
    const editing = async (body: Record<string, unknown>): Promise<unknown> => {
      if (typeof body.reasoning === 'object' && body.reasoning !== null) {
        Reflect.set(body.reasoning, 'summary', 'auto');
      }

      return end;
    };
    const plain = async (body: Record<string, unknown>): Promise<unknown> => {
      bodies.push(structuredClone(body));

      return end;
    };

    await runAssistantLoop({ model: openaiModel({ model: 'm', send: editing }), system: 's', tools: [], messages: [{ role: 'user', content: 'a' }],
      call: async () => ({ content: '', isError: false }), signal: new AbortController().signal, maxSteps: 5, thinking: 'low' });
    await runAssistantLoop({ model: openaiModel({ model: 'm', send: plain }), system: 's', tools: [], messages: [{ role: 'user', content: 'a' }],
      call: async () => ({ content: '', isError: false }), signal: new AbortController().signal, maxSteps: 5, thinking: 'low' });
    expect(bodies[0].reasoning).toEqual({ effort: 'low' });
  });

  it('fails the run when the reply stops short for a reason it does not map', async () => {
    const messages = fakeSend({ status: 'incomplete', incomplete_details: { reason: 'max_messages' }, output: [] });
    const steered = fakeSend({ status: 'incomplete', incomplete_details: { reason: 'steered' }, output: [] });

    expect(await run(openaiModel({ model: 'm', send: messages.send }), [{ role: 'user', content: 'a' }]))
      .toEqual({ status: 'failed', reply: '', error: 'OpenAI stopped: max_messages' });
    expect(await run(openaiModel({ model: 'm', send: steered.send }), [{ role: 'user', content: 'a' }]))
      .toEqual({ status: 'failed', reply: '', error: 'OpenAI stopped: steered' });
  });

  it('turns an error body into a failed run', async () => {
    const { send } = fakeSend({ error: { message: 'Invalid model' } });

    expect(await run(openaiModel({ model: 'm', send }), [{ role: 'user', content: 'a' }]))
      .toEqual({ status: 'failed', reply: '', error: 'OpenAI: Invalid model' });
  });

  describe('streaming', () => {
    const headingCall = {
      type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'blok_execute', arguments: JSON.stringify(heading), status: 'completed',
    };
    const twin = {
      id: 'resp_1', object: 'response', status: 'completed', usage: { input_tokens: 12, output_tokens: 40 },
      output: [
        { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'enc' },
        { type: 'message', id: 'msg_1', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'Adding a heading.', annotations: [] }] },
        headingCall,
      ],
    };

    it('streams tool input as tool_start/tool_input/tool_end with the accumulated json', async () => {
      const events: AgentModelStreamEvent[] = [];

      await openaiModel({ model: 'm', stream: fakeStream(FIXTURE).stream })(request((event) => events.push(event)));

      expect(events).toEqual([
        { type: 'tool_start', index: 0, id: 'call_1', name: 'blok_execute' },
        { type: 'tool_input', index: 0, json: '{"commands":[{"na' },
        { type: 'tool_input', index: 0, json: '{"commands":[{"name":"block.insert","args":{"type":"head' },
        { type: 'tool_input', index: 0, json: JSON.stringify(heading) },
        { type: 'tool_end', index: 0 },
      ]);
    });

    it('the streamed response equals the non-streamed one for the same content', async () => {
      const streamed = await openaiModel({ model: 'm', stream: fakeStream(FIXTURE).stream })(request(() => undefined));
      const sent = await openaiModel({ model: 'm', send: fakeSend(twin).send })(request());

      expect(streamed).toEqual(sent);
      expect(streamed.stop_reason).toBe('tool_use');
      expect(streamed.content[1]).toEqual({ type: 'tool_use', id: 'call_1', name: 'blok_execute', input: heading });
    });

    it('still streams and assembles when the request has no onStream', async () => {
      const response = await openaiModel({ model: 'm', stream: fakeStream(FIXTURE).stream })(request());

      expect(response.content.slice(0, 2)).toEqual([
        { type: 'text', text: 'Adding a heading.' },
        { type: 'tool_use', id: 'call_1', name: 'blok_execute', input: heading },
      ]);
    });

    it('sends stream: true, and only when streaming', async () => {
      const streaming = fakeStream(FIXTURE);
      const plain = fakeSend({ status: 'completed', output: [] });

      await openaiModel({ model: 'm', stream: streaming.stream, send: plain.send })(request());
      await openaiModel({ model: 'm', send: plain.send })(request());

      expect(streaming.bodies[0]).toMatchObject({ stream: true, store: false, model: 'm', max_output_tokens: 16000 });
      expect(plain.bodies).toHaveLength(1);
      expect(plain.bodies[0].stream).toBeUndefined();
    });

    it('gives a streamed call without a call_id the same id in its events and in the response', async () => {
      const bare = { type: 'function_call', id: 'fc_2', name: 'blok_read', arguments: '' };
      const message = { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hi', annotations: [] }] };
      const text = sse(
        { type: 'response.output_item.added', output_index: 0, item: message },
        { type: 'response.output_item.done', output_index: 0, item: message },
        { type: 'response.output_item.added', output_index: 1, item: bare },
        { type: 'response.output_item.done', output_index: 1, item: { ...bare, arguments: '{}' } },
        { type: 'response.completed', response: { status: 'completed', output: [message, { ...bare, arguments: '{}' }] } }
      );
      const events: AgentModelStreamEvent[] = [];

      const response = await openaiModel({ model: 'm', stream: fakeStream(text).stream })(request((event) => events.push(event)));

      expect(events).toEqual([
        { type: 'tool_start', index: 0, id: 'call-1-1', name: 'blok_read' },
        { type: 'tool_input', index: 0, json: '{}' },
        { type: 'tool_end', index: 0 },
      ]);
      expect(response.content[1]).toEqual({ type: 'tool_use', id: 'call-1-1', name: 'blok_read', input: {} });
    });

    describe('a call that arrives whole, with no argument deltas (xAI)', () => {
      const whole = sse(
        { type: 'response.output_item.added', output_index: 0, item: { ...headingCall, status: 'in_progress' } },
        { type: 'response.output_item.done', output_index: 0, item: headingCall },
        { type: 'response.completed', response: { status: 'completed', output: [headingCall] } }
      );

      it('runs the streamed call with its full input', async () => {
        const seen: unknown[] = [];

        await runAssistantLoop({
          model: openaiModel({ model: 'm', stream: fakeStream(whole, sse({ type: 'response.completed', response: { status: 'completed', output: [] } })).stream }),
          system: 's', tools: [], messages: [{ role: 'user', content: 'a' }],
          call: async (_name, input) => {
            seen.push(input);

            return { content: '{"ok":true}', isError: false };
          },
          signal: new AbortController().signal, maxSteps: 5,
        });

        expect(seen).toEqual([heading]);
      });

      it('reports its input once, and returns it as tool_use', async () => {
        const events: AgentModelStreamEvent[] = [];

        const response = await openaiModel({ model: 'm', stream: fakeStream(whole).stream })(request((event) => events.push(event)));

        expect(events).toEqual([
          { type: 'tool_start', index: 0, id: 'call_1', name: 'blok_execute' },
          { type: 'tool_input', index: 0, json: JSON.stringify(heading) },
          { type: 'tool_end', index: 0 },
        ]);
        expect(response.content[0]).toEqual({ type: 'tool_use', id: 'call_1', name: 'blok_execute', input: heading });
        expect(response.stop_reason).toBe('tool_use');
      });
    });

    it('maps a truncated stream, which ends with response.incomplete, as send does', async () => {
      const truncated = { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] };
      const streamed = await openaiModel({ model: 'm', stream: fakeStream(sse({ type: 'response.incomplete', response: truncated })).stream })(request());

      expect(streamed).toEqual(await openaiModel({ model: 'm', send: fakeSend(truncated).send })(request()));
      expect(streamed.stop_reason).toBe('max_tokens');
    });

    it('throws when the response fails', async () => {
      const failed = sse({ type: 'response.failed', response: { status: 'failed', error: { code: 'server_error', message: 'Server is busy' }, output: [] } });
      const bare = sse({ type: 'response.failed', response: { status: 'failed', output: [] } });

      await expect(openaiModel({ model: 'm', stream: fakeStream(failed).stream })(request())).rejects.toThrow('OpenAI: Server is busy');
      await expect(openaiModel({ model: 'm', stream: fakeStream(bare).stream })(request())).rejects.toThrow('OpenAI: the response failed.');
    });

    it('throws on an SSE error event, whose message is at the top level', async () => {
      const text = sse({ type: 'error', code: 'rate_limit_exceeded', message: 'Slow down', param: null });

      await expect(openaiModel({ model: 'm', stream: fakeStream(text).stream })(request())).rejects.toThrow('OpenAI: Slow down');
    });

    it('throws the provider\'s message for an HTTP error response', async () => {
      const stream = async (): Promise<Response> => new Response('{"error":{"message":"Incorrect API key"}}', { status: 401 });

      await expect(openaiModel({ model: 'm', stream })(request())).rejects.toThrow('OpenAI: Incorrect API key');
    });

    it('throws when the connection drops before response.completed', async () => {
      const cut = FIXTURE.slice(0, FIXTURE.indexOf('event: response.completed'));
      const mid = FIXTURE.slice(0, FIXTURE.lastIndexOf('event: response.function_call_arguments.delta'));

      await expect(openaiModel({ model: 'm', stream: fakeStream(cut).stream })(request())).rejects.toThrow('OpenAI: the stream ended early.');
      await expect(openaiModel({ model: 'm', stream: fakeStream(mid).stream })(request())).rejects.toThrow('OpenAI: the stream ended early.');
    });

    it('throws instead of returning half a response when the run stops mid-stream', async () => {
      const controller = new AbortController();
      const stream = async (): Promise<ReadableStream<Uint8Array>> => new ReadableStream({
        start: (source) => source.enqueue(new TextEncoder().encode(FIXTURE.slice(0, FIXTURE.lastIndexOf('event: response.output_item.done')))),
      });

      await expect(openaiModel({ model: 'm', stream })(request(() => controller.abort(), controller.signal)))
        .rejects.toThrow('OpenAI: the run stopped mid-stream.');
    });
  });

  describe('webSearch', () => {
    const searched = { type: 'web_search_call', id: 'ws_1', status: 'completed', action: { type: 'search', query: 'nobel 2026' } };
    const cited = {
      type: 'message', role: 'assistant',
      content: [{ type: 'output_text', text: 'Halzen won.', annotations: [{ type: 'url_citation', url: 'https://example.org/a', title: 'A', start_index: 0, end_index: 11 }] }],
    };

    it('offers the provider\'s search tool after the Blok tools, and only when asked', async () => {
      const on = fakeSend({ status: 'completed', output: [] });
      const off = fakeSend({ status: 'completed', output: [] });

      await run(openaiModel({ model: 'm', send: on.send, webSearch: true }), [{ role: 'user', content: 'Go' }]);
      await run(openaiModel({ model: 'm', send: off.send }), [{ role: 'user', content: 'Go' }]);

      expect(on.bodies[0].tools).toEqual([
        { type: 'function', name: 'blok_read', description: 'd', parameters: { type: 'object' }, strict: false },
        { type: 'web_search' },
      ]);
      expect(off.bodies[0].tools).toHaveLength(1);
    });

    it('merges an options object into the search tool entry', async () => {
      const { send, bodies } = fakeSend({ status: 'completed', output: [] });

      await run(openaiModel({ model: 'm', send, webSearch: { search_context_size: 'low' } }), [{ role: 'user', content: 'Go' }]);

      expect((bodies[0].tools as unknown[])[1]).toEqual({ type: 'web_search', search_context_size: 'low' });
    });

    it('reads the cited answer, and sends the search items back unchanged', async () => {
      const { send, bodies } = fakeSend(
        { status: 'completed', output: [searched, call] },
        { status: 'completed', output: [cited] }
      );

      const result = await run(openaiModel({ model: 'm', send, webSearch: true }), [{ role: 'user', content: 'Go' }]);

      expect(result).toEqual({ status: 'done', reply: 'Halzen won.' });
      expect((bodies[1].input as unknown[]).slice(1, 3)).toEqual([searched, call]);
    });

    it('streams a search without tool events', async () => {
      const events: AgentModelStreamEvent[] = [];
      const text = sse(
        { type: 'response.output_item.added', output_index: 0, item: { ...searched, status: 'in_progress' } },
        { type: 'response.web_search_call.completed', output_index: 0, item_id: 'ws_1' },
        { type: 'response.output_item.done', output_index: 0, item: searched },
        { type: 'response.completed', response: { status: 'completed', output: [searched, cited] } }
      );

      const response = await openaiModel({ model: 'm', stream: fakeStream(text).stream, webSearch: true })(request((event) => events.push(event)));

      expect(events).toEqual([]);
      expect(response.content[0]).toEqual({ type: 'text', text: 'Halzen won.' });
    });
  });
});
