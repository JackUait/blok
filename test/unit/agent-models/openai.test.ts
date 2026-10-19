import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openaiModel } from '../../../src/agent-models/openai';
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
});
