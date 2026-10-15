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
    expect(bodies[0]).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 16000, system: 'sys' });
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

  it('turns an error body into a failed run', async () => {
    const { send } = fakeSend({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });

    expect(await run(anthropicModel({ model: 'm', send }), [{ role: 'user', content: 'a' }]))
      .toEqual({ status: 'failed', reply: '', error: 'Anthropic: Overloaded' });
  });
});
