import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { anthropicModel } from '../../../src/agent-models/anthropic';
import type { AdapterOptions } from '../../../src/agent-models/shared';
import { runAssistantLoop } from '../../../src/agent/assistant-loop';
import type { AgentModelMessage, AgentModelStreamEvent } from '../../../types/api';

import { fakeStream, request, sseStream } from './stream-helpers';

const FIXTURE = readFileSync(resolve(__dirname, 'fixtures/anthropic-stream.sse'), 'utf8');

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

const run = (model: ReturnType<typeof anthropicModel>, messages: AgentModelMessage[], thinking?: 'off' | 'high') => runAssistantLoop({
  model, system: 'sys', tools: [{ name: 'blok_read', description: 'd', input_schema: { type: 'object' } }],
  messages, call: async () => ({ content: '{"ok":true}', isError: false }),
  signal: new AbortController().signal, maxSteps: 5, ...(thinking === undefined ? {} : { thinking }),
});

describe('anthropicModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends thinking blocks back unchanged on the next call of the tool loop', async () => {
    const { send, bodies } = fakeSend(
      { stop_reason: 'tool_use', content: [
        { type: 'thinking', thinking: '', signature: 'sig-1' },
        { type: 'tool_use', id: 'u1', name: 'blok_read', input: {} },
      ] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] }
    );

    const result = await run(anthropicModel({ model: 'claude-opus-5-5', send }), [{ role: 'user', content: 'Go' }]);

    expect(result).toEqual({ status: 'done', reply: 'Done.' });
    expect((bodies[1].messages as AgentModelMessage[])[1]).toEqual({ role: 'assistant', content: [
      { type: 'thinking', thinking: '', signature: 'sig-1' },
      { type: 'tool_use', id: 'u1', name: 'blok_read', input: {} },
    ] });
    expect(bodies[0]).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 16000 });
  });

  it('caches tools and system across prompts, and the growing conversation within one', async () => {
    const { send, bodies } = fakeSend(
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'u1', name: 'blok_read', input: {} }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] }
    );

    await run(anthropicModel({ model: 'm', send }), [{ role: 'user', content: 'Go' }]);

    bodies.forEach((body) => {
      expect(body.system).toEqual([{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }]);
      expect(body.cache_control).toEqual({ type: 'ephemeral' });
    });
  });

  it('sends an empty system as a string, since an empty text block is rejected', async () => {
    const { send, bodies } = fakeSend({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] });

    await runAssistantLoop({
      model: anthropicModel({ model: 'm', send }), system: '', tools: [], messages: [{ role: 'user', content: 'a' }],
      call: async () => ({ content: '', isError: false }), signal: new AbortController().signal, maxSteps: 1,
    });
    expect(bodies[0].system).toBe('');
  });

  it('maps levels to effort, with off as low, and a host override wins', async () => {
    const end = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
    const plain = fakeSend(end, end);

    await run(anthropicModel({ model: 'm', send: plain.send }), [{ role: 'user', content: 'a' }], 'off');
    await run(anthropicModel({ model: 'm', send: plain.send }), [{ role: 'user', content: 'a' }], 'high');
    expect(plain.bodies.map((body) => body.output_config)).toEqual([{ effort: 'low' }, { effort: 'high' }]);

    const custom = fakeSend(end);

    await run(anthropicModel({ model: 'm', send: custom.send, levels: { off: { thinking: { type: 'between_tools' } } } }), [{ role: 'user', content: 'a' }], 'off');
    expect(custom.bodies[0]).toMatchObject({ thinking: { type: 'between_tools' } });
    expect(custom.bodies[0].output_config).toBeUndefined();
  });

  it('drops another adapter\'s provider blocks', async () => {
    const { send, bodies } = fakeSend({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] });

    await run(anthropicModel({ model: 'm', send }), [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: [{ type: 'text', text: 'b' }, { type: 'provider', format: 'gemini', raw: [] }] },
      { role: 'user', content: 'c' },
    ]);
    expect((bodies[0].messages as AgentModelMessage[])[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'b' }] });
  });

  it('a send that edits the body leaves the run\'s tools and history alone', async () => {
    const toolTurn = { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'u1', name: 'blok_read', input: {} }] };
    const replies: unknown[] = [toolTurn, { ...toolTurn, content: [{ type: 'tool_use', id: 'u2', name: 'blok_read', input: {} }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }];
    const bodies: Record<string, unknown>[] = [];
    const send = async (body: Record<string, unknown>): Promise<unknown> => {
      bodies.push(structuredClone(body));
      const { tools, messages } = body;

      if (Array.isArray(tools)) {
        tools.push({ name: 'extra' });
      }
      const turn: unknown = Array.isArray(messages) ? messages.at(-2) : undefined;
      const block: unknown = typeof turn === 'object' && turn !== null && 'content' in turn && Array.isArray(turn.content)
        ? turn.content.at(-1)
        : undefined;

      if (typeof block === 'object' && block !== null) {
        Reflect.set(block, 'cache_control', { type: 'ephemeral' });
      }

      return replies.shift();
    };

    await run(anthropicModel({ model: 'm', send }), [{ role: 'user', content: 'Go' }]);

    expect((bodies[2].messages as AgentModelMessage[])[1]).toEqual({ role: 'assistant', content: [
      { type: 'tool_use', id: 'u1', name: 'blok_read', input: {} },
    ] });
    expect(bodies.map((body) => (body.tools as unknown[]).length)).toEqual([1, 1, 1]);
  });

  it('gives a tool_use without an id one, so the call runs and its result matches', async () => {
    const { send, bodies } = fakeSend(
      { content: [{ type: 'tool_use', name: 'blok_read', input: {} }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' }
    );

    expect(await run(anthropicModel({ model: 'm', send }), [{ role: 'user', content: 'Go' }])).toEqual({ status: 'done', reply: 'Done.' });
    expect((bodies[1].messages as unknown[]).slice(1)).toEqual([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call-1-0', name: 'blok_read', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1-0', content: '{"ok":true}', is_error: false }] },
    ]);
  });

  it('answers a tool_use without a name as an unknown tool instead of dropping it', async () => {
    const { send, bodies } = fakeSend(
      { content: [{ type: 'tool_use', id: 't1', input: {} }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' }
    );
    const call = vi.fn(async () => ({ content: '{"ok":false}', isError: true }));

    await runAssistantLoop({
      model: anthropicModel({ model: 'm', send }), system: 'sys', tools: [], messages: [{ role: 'user', content: 'Go' }],
      call, signal: new AbortController().signal, maxSteps: 5,
    });

    expect(call).toHaveBeenCalledWith('', {});
    expect(bodies).toHaveLength(2);
  });

  it('turns an error body into a failed run', async () => {
    const { send } = fakeSend({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });

    expect(await run(anthropicModel({ model: 'm', send }), [{ role: 'user', content: 'a' }]))
      .toEqual({ status: 'failed', reply: '', error: 'Anthropic: Overloaded' });
  });

  describe('streaming', () => {
    it('streams tool input as tool_start/tool_input/tool_end with the accumulated json', async () => {
      const events: AgentModelStreamEvent[] = [];

      await anthropicModel({ model: 'm', stream: fakeStream(FIXTURE).stream })(request((event) => events.push(event)));

      expect(events).toEqual([
        { type: 'tool_start', index: 0, id: 'toolu_1', name: 'blok_execute' },
        { type: 'tool_input', index: 0, json: '{"commands":[{"na' },
        { type: 'tool_input', index: 0, json: '{"commands":[{"name":"block.insert","args":{"type":"head' },
        { type: 'tool_input', index: 0, json: JSON.stringify(heading) },
        { type: 'tool_end', index: 0 },
      ]);
    });

    it('the streamed response equals the non-streamed one for the same content', async () => {
      const twin = {
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_sequence: null,
        content: [{ type: 'text', text: 'Adding a heading.' }, { type: 'tool_use', id: 'toolu_1', name: 'blok_execute', input: heading }],
        stop_reason: 'tool_use', usage: { input_tokens: 12, output_tokens: 40 },
      };
      const streamed = await anthropicModel({ model: 'm', stream: fakeStream(FIXTURE).stream })(request(() => undefined));
      const sent = await anthropicModel({ model: 'm', send: fakeSend(twin).send })(request());

      expect(streamed).toEqual(sent);
      expect(streamed.stop_reason).toBe('tool_use');
    });

    it('still streams and assembles when the request has no onStream', async () => {
      const response = await anthropicModel({ model: 'm', stream: fakeStream(FIXTURE).stream })(request());

      expect(response.content).toEqual([
        { type: 'text', text: 'Adding a heading.' },
        { type: 'tool_use', id: 'toolu_1', name: 'blok_execute', input: heading },
      ]);
    });

    it('sends stream: true, and only when streaming', async () => {
      const streaming = fakeStream(FIXTURE);
      const plain = fakeSend({ stop_reason: 'end_turn', content: [] });

      await anthropicModel({ model: 'm', stream: streaming.stream, send: plain.send })(request());
      await anthropicModel({ model: 'm', send: plain.send })(request());

      expect(streaming.bodies[0]).toMatchObject({ stream: true, model: 'm', max_tokens: 16000 });
      expect(plain.bodies).toHaveLength(1);
      expect(plain.bodies[0].stream).toBeUndefined();
    });

    it('keeps a streamed thinking block\'s signature and passes redacted_thinking through whole', async () => {
      const text = sse(
        { type: 'message_start', message: { content: [], stop_reason: null } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me ' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'think.' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-abc' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'redacted_thinking', data: 'opaque' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 't1', name: 'blok_read', input: {} } },
        { type: 'content_block_stop', index: 2 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
        { type: 'message_stop' }
      );

      const response = await anthropicModel({ model: 'm', stream: fakeStream(text).stream })(request());

      expect(response).toEqual({ stop_reason: 'tool_use', content: [
        { type: 'thinking', thinking: 'Let me think.', signature: 'sig-abc' },
        { type: 'redacted_thinking', data: 'opaque' },
        { type: 'tool_use', id: 't1', name: 'blok_read', input: {} },
      ] });
    });

    it('gives a streamed tool_use without an id the same id in its events and in the response', async () => {
      const text = sse(
        { type: 'message_start', message: { content: [], stop_reason: null } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Hi' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', input: {} } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
        { type: 'message_stop' }
      );
      const events: AgentModelStreamEvent[] = [];

      const response = await anthropicModel({ model: 'm', stream: fakeStream(text).stream })(request((event) => events.push(event)));

      expect(events).toEqual([{ type: 'tool_start', index: 0, id: 'call-1-1', name: '' }, { type: 'tool_end', index: 0 }]);
      expect(response.content[1]).toEqual({ type: 'tool_use', id: 'call-1-1', name: '', input: {} });
    });

    it('throws on an SSE error event', async () => {
      const text = sse(
        { type: 'message_start', message: { content: [], stop_reason: null } },
        { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }
      );

      await expect(anthropicModel({ model: 'm', stream: fakeStream(text).stream })(request()))
        .rejects.toThrow('Anthropic: Overloaded');
    });

    it('throws the provider\'s message for an HTTP error response', async () => {
      const stream = async (): Promise<Response> => new Response('{"type":"error","error":{"message":"Bad key"}}', { status: 401 });

      await expect(anthropicModel({ model: 'm', stream })(request())).rejects.toThrow('Anthropic: Bad key');
    });

    it('throws the HTTP status for an error response whose body is not JSON', async () => {
      const stream = async (): Promise<Response> => new Response('<html>Bad gateway</html>', { status: 502 });

      await expect(anthropicModel({ model: 'm', stream })(request())).rejects.toThrow('Anthropic: HTTP 502.');
    });

    it('throws when the connection drops before message_stop', async () => {
      const cut = FIXTURE.slice(0, FIXTURE.indexOf('event: message_stop'));
      const stream = async (): Promise<ReadableStream<Uint8Array>> => sseStream(FIXTURE.slice(0, FIXTURE.lastIndexOf('event: content_block_delta')));

      await expect(anthropicModel({ model: 'm', stream })(request())).rejects.toThrow('Anthropic: the stream ended early.');
      await expect(anthropicModel({ model: 'm', stream: fakeStream(cut).stream })(request())).rejects.toThrow('Anthropic: the stream ended early.');
    });

    it('throws instead of returning half a message when the run stops mid-stream', async () => {
      const controller = new AbortController();
      const stream = async (): Promise<ReadableStream<Uint8Array>> => new ReadableStream({
        start: (source) => source.enqueue(new TextEncoder().encode(FIXTURE.slice(0, FIXTURE.lastIndexOf('event: content_block_stop')))),
      });

      await expect(anthropicModel({ model: 'm', stream })(request(() => controller.abort(), controller.signal)))
        .rejects.toThrow('Anthropic: the run stopped mid-stream.');
    });

    it('needs send or stream', () => {
      const options: AdapterOptions = { model: 'm' };

      expect(() => anthropicModel(options)).toThrow(new TypeError('Anthropic: pass send or stream.'));
    });
  });
});
