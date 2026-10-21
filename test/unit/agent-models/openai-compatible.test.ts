import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openaiCompatibleModel } from '../../../src/agent-models/openai-compatible';
import type { AdapterOptions } from '../../../src/agent-models/shared';
import { runAssistantLoop } from '../../../src/agent/assistant-loop';
import type { AgentModelMessage, AgentModelStreamEvent } from '../../../types/api';

import { fakeStream, request } from './stream-helpers';

const FIXTURE = readFileSync(resolve(__dirname, 'fixtures/chat-stream.sse'), 'utf8');

/** One chunk per delta; a string entry is sent as raw data, e.g. '[DONE]'. */
const chunks = (...entries: Array<Record<string, unknown> | string>): string => entries
  .map((entry) => `data: ${typeof entry === 'string' ? entry : JSON.stringify({ object: 'chat.completion.chunk', ...entry })}\n\n`).join('');

const delta = (value: Record<string, unknown>, finish: string | null = null): Record<string, unknown> => ({
  choices: [{ index: 0, delta: value, finish_reason: finish }],
});

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

const run = (model: ReturnType<typeof openaiCompatibleModel>, messages: AgentModelMessage[], thinking?: 'off' | 'high') => runAssistantLoop({
  model, system: 'sys', tools: [{ name: 'blok_read', description: 'd', input_schema: { type: 'object' } }],
  messages, call: async () => ({ content: '{"ok":true}', isError: false }),
  signal: new AbortController().signal, maxSteps: 5, ...(thinking === undefined ? {} : { thinking }),
});

describe('openaiCompatibleModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const choice = (message: Record<string, unknown>, finish: string) => ({ choices: [{ index: 0, message, finish_reason: finish }] });
  const toolTurn = {
    role: 'assistant', content: null, reasoning_content: 'thought about it',
    tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'blok_read', arguments: '{}' } }],
  };

  it('replays DeepSeek reasoning_content on the next call, then the tool message', async () => {
    const { send, bodies } = fakeSend(choice(toolTurn, 'tool_calls'), choice({ role: 'assistant', content: 'Done.' }, 'stop'));

    expect(await run(openaiCompatibleModel({ model: 'deepseek-v4-pro', send }), [{ role: 'user', content: 'Go' }]))
      .toEqual({ status: 'done', reply: 'Done.' });
    expect(bodies[1].messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'Go' },
      toolTurn,
      { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
    ]);
    expect(bodies[0]).toMatchObject({
      model: 'deepseek-v4-pro', max_tokens: 16000,
      tools: [{ type: 'function', function: { name: 'blok_read', description: 'd', parameters: { type: 'object' } } }],
    });
    expect('tool_choice' in bodies[0]).toBe(false);
  });

  it('reads Mistral chunk-array content, keeping only text chunks', async () => {
    const { send } = fakeSend(choice({ role: 'assistant', content: [
      { type: 'thinking', thinking: [{ type: 'text', text: 'hmm' }] },
      { type: 'text', text: 'Answer.' },
    ] }, 'stop'));

    expect(await run(openaiCompatibleModel({ model: 'm', send }), [{ role: 'user', content: 'a' }]))
      .toEqual({ status: 'done', reply: 'Answer.' });
  });

  it('maps stop states: length, content filter, refusal', async () => {
    const length = fakeSend(choice({ role: 'assistant', content: 'cut' }, 'length'));
    const filter = fakeSend(choice({ role: 'assistant', content: '' }, 'content_filter'));
    const refusal = fakeSend(choice({ role: 'assistant', content: null, refusal: 'No.' }, 'stop'));

    expect((await run(openaiCompatibleModel({ model: 'm', send: length.send }), [{ role: 'user', content: 'a' }])).status).toBe('truncated');
    expect((await run(openaiCompatibleModel({ model: 'm', send: filter.send }), [{ role: 'user', content: 'a' }])).status).toBe('refused');
    expect((await run(openaiCompatibleModel({ model: 'm', send: refusal.send }), [{ role: 'user', content: 'a' }])).status).toBe('refused');
  });

  it('hands broken arguments to the tool instead of throwing', async () => {
    const broken = { ...toolTurn, tool_calls: [{ id: 'c', type: 'function', function: { name: 'blok_read', arguments: 'nope' } }] };
    const { send } = fakeSend(choice(broken, 'tool_calls'), choice({ role: 'assistant', content: 'ok' }, 'stop'));
    const seen: unknown[] = [];

    await runAssistantLoop({
      model: openaiCompatibleModel({ model: 'm', send }), system: 's', tools: [], messages: [{ role: 'user', content: 'a' }],
      call: async (_name, input) => {
        seen.push(input);

        return { content: '{"ok":false}', isError: true };
      },
      signal: new AbortController().signal, maxSteps: 5,
    });
    expect(seen).toEqual([{ invalidJson: 'nope' }]);
  });

  it('maps levels to reasoning_effort, off as none', async () => {
    const end = choice({ role: 'assistant', content: 'ok' }, 'stop');
    const { send, bodies } = fakeSend(end, end);

    await run(openaiCompatibleModel({ model: 'm', send }), [{ role: 'user', content: 'a' }], 'off');
    await run(openaiCompatibleModel({ model: 'm', send }), [{ role: 'user', content: 'a' }], 'high');
    expect(bodies.map((body) => body.reasoning_effort)).toEqual(['none', 'high']);
  });

  it('rebuilds a turn that has no Chat Completions block', async () => {
    const { send, bodies } = fakeSend(choice({ role: 'assistant', content: 'ok' }, 'stop'));

    await run(openaiCompatibleModel({ model: 'm', send }), [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: [{ type: 'text', text: 'b' }, { type: 'tool_use', id: 'u1', name: 'blok_read', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'r' }] },
    ]);
    expect((bodies[0].messages as unknown[]).slice(2)).toEqual([
      { role: 'assistant', content: 'b', tool_calls: [{ id: 'u1', type: 'function', function: { name: 'blok_read', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'u1', content: 'r' },
    ]);
  });

  it('a send that edits the replayed turn leaves the stored turn alone', async () => {
    const replies: unknown[] = [choice(structuredClone(toolTurn), 'tool_calls'), choice(structuredClone(toolTurn), 'tool_calls'), choice({ role: 'assistant', content: 'Done.' }, 'stop')];
    const bodies: Record<string, unknown>[] = [];
    const send = async (body: Record<string, unknown>): Promise<unknown> => {
      bodies.push(structuredClone(body));
      const turn: unknown = Array.isArray(body.messages) ? body.messages[2] : undefined;

      if (typeof turn === 'object' && turn !== null) {
        Reflect.set(turn, 'reasoning_content', 'edited');
      }

      return replies.shift();
    };

    await run(openaiCompatibleModel({ model: 'm', send }), [{ role: 'user', content: 'Go' }]);
    expect((bodies[2].messages as unknown[])[2]).toEqual(toolTurn);
  });

  it('gives parallel calls without ids distinct ids, and the replay and tool messages carry them', async () => {
    const noIds = {
      role: 'assistant', content: null,
      tool_calls: [
        { type: 'function', function: { name: 'blok_read', arguments: '{}' } },
        { id: '', type: 'function', function: { name: 'blok_read', arguments: '{}' } },
      ],
    };
    const { send, bodies } = fakeSend(choice(noIds, 'tool_calls'), choice({ role: 'assistant', content: 'Done.' }, 'stop'));

    await run(openaiCompatibleModel({ model: 'm', send }), [{ role: 'user', content: 'Go' }]);
    expect((bodies[1].messages as unknown[]).slice(2)).toEqual([
      { ...noIds, tool_calls: [
        { id: 'call-1-0', type: 'function', function: { name: 'blok_read', arguments: '{}' } },
        { id: 'call-1-1', type: 'function', function: { name: 'blok_read', arguments: '{}' } },
      ] },
      { role: 'tool', tool_call_id: 'call-1-0', content: '{"ok":true}' },
      { role: 'tool', tool_call_id: 'call-1-1', content: '{"ok":true}' },
    ]);
  });

  it('turns an error body into a failed run', async () => {
    const { send } = fakeSend({ error: { message: 'Rate limited' } });

    expect(await run(openaiCompatibleModel({ model: 'm', send }), [{ role: 'user', content: 'a' }]))
      .toEqual({ status: 'failed', reply: '', error: 'OpenAI-compatible: Rate limited' });
  });

  describe('provider profile', () => {
    const end = choice({ role: 'assistant', content: 'ok' }, 'stop');

    it('sends the tool name on tool messages only when the profile asks', async () => {
      const { send, bodies } = fakeSend(choice(toolTurn, 'tool_calls'), end);

      await run(openaiCompatibleModel({ model: 'm', send }, { name: 'Mistral', toolName: true }), [{ role: 'user', content: 'Go' }]);
      expect((bodies[1].messages as unknown[]).at(-1)).toEqual({ role: 'tool', tool_call_id: 'call_1', name: 'blok_read', content: '{"ok":true}' });
    });

    it('puts the output cap in the field the profile names, never both', async () => {
      const plain = fakeSend(end);
      const completion = fakeSend(end);

      await run(openaiCompatibleModel({ model: 'm', send: plain.send, maxTokens: 900 }), [{ role: 'user', content: 'a' }]);
      await run(openaiCompatibleModel({ model: 'm', send: completion.send, maxTokens: 900 }, { name: 'Groq', tokens: 'max_completion_tokens' }), [{ role: 'user', content: 'a' }]);
      expect(plain.bodies[0].max_tokens).toBe(900);
      expect('max_completion_tokens' in plain.bodies[0]).toBe(false);
      expect(completion.bodies[0].max_completion_tokens).toBe(900);
      expect('max_tokens' in completion.bodies[0]).toBe(false);
    });

    it('a level mapped to {} sends no reasoning_effort', async () => {
      const { send, bodies } = fakeSend(end);

      await run(openaiCompatibleModel({ model: 'm', send }, { name: 'P', levels: { off: {} } }), [{ role: 'user', content: 'a' }], 'off');
      expect('reasoning_effort' in bodies[0]).toBe(false);
    });

    it('replays only the profile\'s fields of a stored assistant turn, and leaves the stored turn whole', async () => {
      const extra = { ...toolTurn, refusal: null, annotations: [] };
      const { send, bodies } = fakeSend(choice(extra, 'tool_calls'), end);
      const fields = ['role', 'content', 'reasoning_content', 'tool_calls'];

      const model = openaiCompatibleModel({ model: 'm', send }, { name: 'Fireworks', replayFields: fields });
      const response = await model({ system: 's', tools: [], signal: new AbortController().signal, messages: [{ role: 'user', content: 'Go' }] });

      await model({ system: 's', tools: [], signal: new AbortController().signal, messages: [
        { role: 'user', content: 'Go' },
        { role: 'assistant', content: response.content },
      ] });
      expect((bodies[1].messages as unknown[])[2]).toEqual(toolTurn);
      expect(response.content.at(-1)).toEqual({ type: 'provider', format: 'openai-chat', raw: extra });
    });

    it('replays only the profile\'s fields of a rebuilt assistant turn', async () => {
      const { send, bodies } = fakeSend(end);

      await run(openaiCompatibleModel({ model: 'm', send }, { name: 'P', replayFields: ['role', 'tool_calls'] }), [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: [{ type: 'text', text: 'b' }, { type: 'tool_use', id: 'u1', name: 'blok_read', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'r' }] },
      ]);
      expect((bodies[0].messages as unknown[])[2]).toEqual({
        role: 'assistant', tool_calls: [{ id: 'u1', type: 'function', function: { name: 'blok_read', arguments: '{}' } }],
      });
    });

    it('merges streamBody only into streaming requests', async () => {
      const streaming = fakeStream(chunks(delta({ content: 'Hi' }, 'stop')));
      const plain = fakeSend(end);
      const profile = { name: 'Z.ai', streamBody: { tool_stream: true } };

      await openaiCompatibleModel({ model: 'm', stream: streaming.stream }, profile)(request());
      await openaiCompatibleModel({ model: 'm', send: plain.send }, profile)(request());
      expect(streaming.bodies[0]).toMatchObject({ stream: true, tool_stream: true });
      expect('tool_stream' in plain.bodies[0]).toBe(false);
    });
  });

  describe('streaming', () => {
    // What DeepSeek returns without stream for the fixture's content.
    const twinMessage = {
      role: 'assistant', content: 'Adding a heading.', reasoning_content: 'The user wants a heading.',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'blok_execute', arguments: JSON.stringify(heading) } }],
    };

    const callChunk = (extra: Record<string, unknown> = {}): Record<string, unknown> => delta({
      tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'blok_read', arguments: '{}' }, ...extra }],
    }, 'tool_calls');
    const finished = chunks(delta({ content: 'Done.' }, 'stop'));
    const replayed = async (text: string): Promise<{ raw: unknown; sent: unknown }> => {
      const { stream, bodies } = fakeStream(text, finished);
      const raws: unknown[] = [];
      const model = openaiCompatibleModel({ model: 'm', stream });

      await run(async (input) => {
        const response = await model(input);

        raws.push(response.content.at(-1));

        return response;
      }, [{ role: 'user', content: 'Go' }]);

      return { raw: raws[0], sent: (bodies[1].messages as unknown[])[2] };
    };

    it('keeps OpenRouter reasoning_details, merging pieces of one item by index, and sends them back', async () => {
      const text = chunks(
        delta({ role: 'assistant', content: null, reasoning: 'Think', reasoning_details: [
          { type: 'reasoning.text', text: 'Think', id: 'r1', format: 'anthropic-claude-v1', index: 0 },
        ] }),
        delta({ reasoning: 'ing.', reasoning_details: [{ type: 'reasoning.text', text: 'ing.', format: 'anthropic-claude-v1', index: 0 }] }),
        delta({ reasoning_details: [
          { type: 'reasoning.text', text: '', signature: 'sig', index: 0 },
          { type: 'reasoning.encrypted', data: 'abc', index: 1 },
        ] }),
        callChunk()
      );
      const message = {
        role: 'assistant', content: null, reasoning: 'Thinking.',
        reasoning_details: [
          { type: 'reasoning.text', text: 'Thinking.', id: 'r1', format: 'anthropic-claude-v1', index: 0, signature: 'sig' },
          { type: 'reasoning.encrypted', data: 'abc', index: 1 },
        ],
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'blok_read', arguments: '{}' } }],
      };

      expect(await replayed(text)).toEqual({ raw: { type: 'provider', format: 'openai-chat', raw: message }, sent: message });
    });

    it('keeps LiteLLM thinking_blocks, joining unindexed pieces until the signature, and sends them back', async () => {
      const text = chunks(
        delta({ role: 'assistant', content: '', reasoning_content: 'Hm', thinking_blocks: [{ type: 'thinking', thinking: 'Hm' }], function_call: null, audio: null }),
        delta({ reasoning_content: 'm.', thinking_blocks: [{ type: 'thinking', thinking: 'm.' }] }),
        delta({ thinking_blocks: [{ type: 'thinking', thinking: '', signature: 'sig' }] }),
        delta({ thinking_blocks: [{ type: 'redacted_thinking', data: 'xyz' }] }),
        callChunk()
      );
      const message = {
        role: 'assistant', content: '', reasoning_content: 'Hmm.',
        thinking_blocks: [{ type: 'thinking', thinking: 'Hmm.', signature: 'sig' }, { type: 'redacted_thinking', data: 'xyz' }],
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'blok_read', arguments: '{}' } }],
      };

      expect(await replayed(text)).toEqual({ raw: { type: 'provider', format: 'openai-chat', raw: message }, sent: message });
    });

    it('keeps a Vertex thought_signature on its streamed tool call, and sends it back', async () => {
      const text = chunks(delta({ role: 'assistant', content: null }), callChunk({ extra_content: { google: { thought_signature: 'sig' } } }));
      const message = {
        role: 'assistant', content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'blok_read', arguments: '{}' }, extra_content: { google: { thought_signature: 'sig' } } }],
      };

      expect(await replayed(text)).toEqual({ raw: { type: 'provider', format: 'openai-chat', raw: message }, sent: message });
    });

    it('keeps streamed Mistral text and thinking chunks, and replays the chunk-array content', async () => {
      const text = chunks(
        delta({ role: 'assistant', content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'Let me ' }] }] }),
        delta({ content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'see.' }] }, { type: 'text', text: 'Reading ' }] }),
        delta({ content: 'it.' }),
        callChunk()
      );
      const message = {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'Let me see.' }] }, { type: 'text', text: 'Reading it.' }],
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'blok_read', arguments: '{}' } }],
      };
      const response = await openaiCompatibleModel({ model: 'm', stream: fakeStream(text).stream })(request());

      expect(response.content[0]).toEqual({ type: 'text', text: 'Reading it.' });
      expect(await replayed(text)).toEqual({ raw: { type: 'provider', format: 'openai-chat', raw: message }, sent: message });
    });

    it('streams tool input as tool_start/tool_input/tool_end with the accumulated json', async () => {
      const events: AgentModelStreamEvent[] = [];

      await openaiCompatibleModel({ model: 'm', stream: fakeStream(FIXTURE).stream })(request((event) => events.push(event)));

      expect(events).toEqual([
        { type: 'tool_start', index: 0, id: 'call_1', name: 'blok_execute' },
        { type: 'tool_input', index: 0, json: '{"commands":[{"na' },
        { type: 'tool_input', index: 0, json: '{"commands":[{"name":"block.insert","args":{"type":"head' },
        { type: 'tool_input', index: 0, json: JSON.stringify(heading) },
        { type: 'tool_end', index: 0 },
      ]);
    });

    it('the streamed response equals the non-streamed one for the same content', async () => {
      const streamed = await openaiCompatibleModel({ model: 'm', stream: fakeStream(FIXTURE).stream })(request(() => undefined));
      const sent = await openaiCompatibleModel({ model: 'm', send: fakeSend(choice(twinMessage, 'tool_calls')).send })(request());

      expect(streamed).toEqual(sent);
      expect(streamed.stop_reason).toBe('tool_use');
      expect(streamed.content.slice(0, 2)).toEqual([
        { type: 'text', text: 'Adding a heading.' },
        { type: 'tool_use', id: 'call_1', name: 'blok_execute', input: heading },
      ]);
    });

    it('reasoning_content survives into the provider block', async () => {
      const response = await openaiCompatibleModel({ model: 'deepseek-v4-pro', stream: fakeStream(FIXTURE).stream })(request());

      expect(response.content[2]).toEqual({ type: 'provider', format: 'openai-chat', raw: twinMessage });
    });

    it('keeps a streamed `reasoning` field under its own name', async () => {
      const text = chunks(
        delta({ role: 'assistant', content: null, reasoning: 'Thinking ' }),
        delta({ reasoning: 'it over.' }),
        delta({ content: 'Done.' }, 'stop'),
        '[DONE]'
      );
      const response = await openaiCompatibleModel({ model: 'm', stream: fakeStream(text).stream })(request());

      expect(response.content.at(-1)).toEqual({
        type: 'provider', format: 'openai-chat', raw: { role: 'assistant', content: 'Done.', reasoning: 'Thinking it over.' },
      });
    });

    it('sends stream: true without stream_options, and only when streaming', async () => {
      const streaming = fakeStream(FIXTURE);
      const plain = fakeSend(choice({ role: 'assistant', content: 'Hi' }, 'stop'));

      await openaiCompatibleModel({ model: 'm', stream: streaming.stream, send: plain.send })(request());
      await openaiCompatibleModel({ model: 'm', send: plain.send })(request());

      expect(streaming.bodies[0].stream_options).toBeUndefined();
      expect(streaming.bodies[0]).toMatchObject({ stream: true, model: 'm', max_tokens: 16000 });
      expect(plain.bodies).toHaveLength(1);
      expect(plain.bodies[0].stream).toBeUndefined();
      expect(plain.bodies[0].stream_options).toBeUndefined();
    });

    it('two parallel tool calls end in order', async () => {
      const text = chunks(
        delta({ role: 'assistant', content: null }),
        delta({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'blok_read', arguments: '' } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: '{"a":1}' } }] }),
        delta({ tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'blok_execute', arguments: '{"b"' } }] }),
        delta({ tool_calls: [{ index: 1, function: { arguments: ':2}' } }] }, 'tool_calls'),
        '[DONE]'
      );
      const events: AgentModelStreamEvent[] = [];

      const response = await openaiCompatibleModel({ model: 'm', stream: fakeStream(text).stream })(request((event) => events.push(event)));

      expect(events).toEqual([
        { type: 'tool_start', index: 0, id: 'call_a', name: 'blok_read' },
        { type: 'tool_input', index: 0, json: '{"a":1}' },
        { type: 'tool_end', index: 0 },
        { type: 'tool_start', index: 1, id: 'call_b', name: 'blok_execute' },
        { type: 'tool_input', index: 1, json: '{"b"' },
        { type: 'tool_input', index: 1, json: '{"b":2}' },
        { type: 'tool_end', index: 1 },
      ]);
      expect(response.content).toEqual([
        { type: 'tool_use', id: 'call_a', name: 'blok_read', input: { a: 1 } },
        { type: 'tool_use', id: 'call_b', name: 'blok_execute', input: { b: 2 } },
        { type: 'provider', format: 'openai-chat', raw: {
          role: 'assistant', content: null, tool_calls: [
            { id: 'call_a', type: 'function', function: { name: 'blok_read', arguments: '{"a":1}' } },
            { id: 'call_b', type: 'function', function: { name: 'blok_execute', arguments: '{"b":2}' } },
          ],
        } },
      ]);
    });

    it('reports no input for a call that already ended, but keeps it for the reply', async () => {
      const text = chunks(
        delta({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'blok_read', arguments: '{"a"' } }] }),
        delta({ tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'blok_read', arguments: '{}' } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: ':1}' } }] }, 'tool_calls'),
        '[DONE]'
      );
      const events: AgentModelStreamEvent[] = [];

      const response = await openaiCompatibleModel({ model: 'm', stream: fakeStream(text).stream })(request((event) => events.push(event)));

      expect(events).toEqual([
        { type: 'tool_start', index: 0, id: 'call_a', name: 'blok_read' },
        { type: 'tool_input', index: 0, json: '{"a"' },
        { type: 'tool_end', index: 0 },
        { type: 'tool_start', index: 1, id: 'call_b', name: 'blok_read' },
        { type: 'tool_input', index: 1, json: '{}' },
        { type: 'tool_end', index: 1 },
      ]);
      expect(response.content[0]).toEqual({ type: 'tool_use', id: 'call_a', name: 'blok_read', input: { a: 1 } });
    });

    it('reads several calls carried in one chunk', async () => {
      const text = chunks(
        delta({ tool_calls: [
          { index: 0, id: 'call_a', type: 'function', function: { name: 'blok_read', arguments: '{}' } },
          { index: 1, id: 'call_b', type: 'function', function: { name: 'blok_read', arguments: '{}' } },
        ] }, 'tool_calls'),
        '[DONE]'
      );
      const events: AgentModelStreamEvent[] = [];

      await openaiCompatibleModel({ model: 'm', stream: fakeStream(text).stream })(request((event) => events.push(event)));

      expect(events).toEqual([
        { type: 'tool_start', index: 0, id: 'call_a', name: 'blok_read' },
        { type: 'tool_input', index: 0, json: '{}' },
        { type: 'tool_end', index: 0 },
        { type: 'tool_start', index: 1, id: 'call_b', name: 'blok_read' },
        { type: 'tool_input', index: 1, json: '{}' },
        { type: 'tool_end', index: 1 },
      ]);
    });

    it('gives a streamed call without an id the same id in its events and in the response', async () => {
      const text = chunks(
        delta({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'blok_read', arguments: '{}' } }] }),
        delta({ tool_calls: [{ index: 1, type: 'function', function: { name: 'blok_read', arguments: '{}' } }] }, 'tool_calls')
      );
      const events: AgentModelStreamEvent[] = [];

      const response = await openaiCompatibleModel({ model: 'm', stream: fakeStream(text).stream })(request((event) => events.push(event)));

      expect(events.filter((event) => event.type === 'tool_start')).toEqual([
        { type: 'tool_start', index: 0, id: 'call_a', name: 'blok_read' },
        { type: 'tool_start', index: 1, id: 'call-1-1', name: 'blok_read' },
      ]);
      expect(response.content[1]).toEqual({ type: 'tool_use', id: 'call-1-1', name: 'blok_read', input: {} });
    });

    it('maps a refusal and a truncation as send does', async () => {
      const refused = chunks(delta({ refusal: 'No.' }), delta({}, 'stop'), '[DONE]');
      const truncated = chunks(delta({ content: 'Half' }), delta({}, 'length'), '[DONE]');

      expect((await openaiCompatibleModel({ model: 'm', stream: fakeStream(refused).stream })(request())).stop_reason).toBe('refusal');
      expect((await openaiCompatibleModel({ model: 'm', stream: fakeStream(truncated).stream })(request())).stop_reason).toBe('max_tokens');
    });

    it('throws on an error chunk', async () => {
      const text = chunks(delta({ content: 'Hi' }), { error: { message: 'Overloaded' } });

      await expect(openaiCompatibleModel({ model: 'm', stream: fakeStream(text).stream })(request()))
        .rejects.toThrow('OpenAI-compatible: Overloaded');
    });

    it('throws the provider\'s message for an HTTP error response', async () => {
      const stream = async (): Promise<Response> => new Response('{"error":{"message":"Bad key"}}', { status: 401 });

      await expect(openaiCompatibleModel({ model: 'm', stream })(request())).rejects.toThrow('OpenAI-compatible: Bad key');
    });

    it('throws when the stream ends before a finish_reason', async () => {
      const cut = FIXTURE.slice(0, FIXTURE.lastIndexOf('data: ', FIXTURE.indexOf('"finish_reason":"tool_calls"')));
      const done = chunks(delta({ content: 'Hi' }), '[DONE]');

      await expect(openaiCompatibleModel({ model: 'm', stream: fakeStream(cut).stream })(request()))
        .rejects.toThrow('OpenAI-compatible: the stream ended early.');
      await expect(openaiCompatibleModel({ model: 'm', stream: fakeStream(done).stream })(request()))
        .rejects.toThrow('OpenAI-compatible: the stream ended early.');
    });

    it('accepts a stream that ends after the finish_reason without [DONE]', async () => {
      const text = chunks(delta({ content: 'Hi' }), delta({}, 'stop'));

      expect(await openaiCompatibleModel({ model: 'm', stream: fakeStream(text).stream })(request())).toEqual({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Hi' }, { type: 'provider', format: 'openai-chat', raw: { role: 'assistant', content: 'Hi' } }],
      });
    });

    it('throws instead of returning half a message when the run stops mid-stream', async () => {
      const controller = new AbortController();
      const stream = async (): Promise<ReadableStream<Uint8Array>> => new ReadableStream({
        start: (source) => source.enqueue(new TextEncoder().encode(FIXTURE.slice(0, FIXTURE.indexOf('"finish_reason":"tool_calls"')))),
      });

      await expect(openaiCompatibleModel({ model: 'm', stream })(request(() => controller.abort(), controller.signal)))
        .rejects.toThrow('OpenAI-compatible: the run stopped mid-stream.');
    });
  });

  it('refuses webSearch at setup, since Chat Completions has no common search tool', () => {
    const options: AdapterOptions = { model: 'm', send: async () => ({}), webSearch: true };

    expect(() => openaiCompatibleModel(options)).toThrow(new TypeError(
      'OpenAI-compatible: webSearch is not supported. Add your provider\'s search in send, or give the assistant a search tool.'
    ));
    expect(() => openaiCompatibleModel({ ...options, webSearch: false })).not.toThrow();
  });
});
