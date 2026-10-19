import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { anthropicModel } from '../../../src/agent-models/anthropic';
import { runAssistantLoop } from '../../../src/agent/assistant-loop';
import type { AgentModelMessage } from '../../../types/api';

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
});
