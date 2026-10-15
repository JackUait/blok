import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openaiCompatibleModel } from '../../../src/agent-models/openai-compatible';
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
      { role: 'tool', tool_call_id: 'call_1', name: 'blok_read', content: '{"ok":true}' },
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
      { role: 'tool', tool_call_id: 'u1', name: 'blok_read', content: 'r' },
    ]);
  });

  it('turns an error body into a failed run', async () => {
    const { send } = fakeSend({ error: { message: 'Rate limited' } });

    expect(await run(openaiCompatibleModel({ model: 'm', send }), [{ role: 'user', content: 'a' }]))
      .toEqual({ status: 'failed', reply: '', error: 'OpenAI-compatible: Rate limited' });
  });
});
