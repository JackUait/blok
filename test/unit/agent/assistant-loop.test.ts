import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { runAssistantLoop } from '../../../src/agent/assistant-loop';
import type { AgentModel, AgentModelMessage, AgentModelResponse, AgentToolResult } from '../../../types/api';

const reply = (content: AgentModelResponse['content'], stop: AgentModelResponse['stop_reason']): AgentModelResponse => ({
  content,
  stop_reason: stop,
});

const scripted = (...responses: AgentModelResponse[]): AgentModel & { requests: Parameters<AgentModel>[0][] } => {
  const requests: Parameters<AgentModel>[0][] = [];
  const model = Object.assign(
    async (request: Parameters<AgentModel>[0]): Promise<AgentModelResponse> => {
      // The loop mutates its history after the call; keep what was sent.
      requests.push({ ...request, messages: structuredClone(request.messages) });
      const next = responses.shift();

      if (next === undefined) {
        throw new Error('model called more times than scripted');
      }

      return next;
    },
    { requests }
  );

  return model;
};

const ok = (content = '{"ok":true}'): AgentToolResult => ({ content, isError: false });

describe('runAssistantLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs each tool call, sends every result back in one user message, and returns the final text', async () => {
    const model = scripted(
      reply([
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'tool_use', id: 't1', name: 'blok_read', input: {} },
        { type: 'tool_use', id: 't2', name: 'blok_describe', input: { command: 'block.insert' } },
      ], 'tool_use'),
      reply([{ type: 'text', text: 'Added a heading.' }], 'end_turn')
    );
    const call = vi.fn(async (name: string, _input: unknown) => ok(`{"tool":"${name}"}`));
    const messages: AgentModelMessage[] = [{ role: 'user', content: 'Add a heading' }];

    const result = await runAssistantLoop({
      model, system: 'sys', tools: [], messages, call, signal: new AbortController().signal, maxSteps: 5,
    });

    expect(result).toEqual({ status: 'done', reply: 'Added a heading.' });
    expect(call.mock.calls.map(([name, input]) => [name, input])).toEqual([
      ['blok_read', {}],
      ['blok_describe', { command: 'block.insert' }],
    ]);
    // The assistant turn goes back whole, thinking block included (append-only history).
    expect(model.requests[1].messages).toEqual([
      { role: 'user', content: 'Add a heading' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          { type: 'tool_use', id: 't1', name: 'blok_read', input: {} },
          { type: 'tool_use', id: 't2', name: 'blok_describe', input: { command: 'block.insert' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: '{"tool":"blok_read"}', is_error: false },
          { type: 'tool_result', tool_use_id: 't2', content: '{"tool":"blok_describe"}', is_error: false },
        ],
      },
    ]);
    expect(messages).toHaveLength(4);
    expect(model.requests[0].system).toBe('sys');
  });

  it('passes a tool error back to the model as is_error', async () => {
    const model = scripted(
      reply([{ type: 'tool_use', id: 't1', name: 'blok_execute', input: { commands: [] } }], 'tool_use'),
      reply([{ type: 'text', text: 'Fixed.' }], 'end_turn')
    );

    await runAssistantLoop({
      model,
      system: '',
      tools: [],
      messages: [{ role: 'user', content: 'x' }],
      call: async () => ({ content: '{"ok":false}', isError: true }),
      signal: new AbortController().signal,
      maxSteps: 5,
    });

    expect(model.requests[1].messages[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"ok":false}', is_error: true }],
    });
  });

  it('stops at the step cap and answers each pending tool call so a follow-up stays valid', async () => {
    const use = reply([{ type: 'tool_use', id: 'loop', name: 'blok_read', input: {} }], 'tool_use');
    const model = scripted(use, use);
    const messages: AgentModelMessage[] = [{ role: 'user', content: 'x' }];

    const result = await runAssistantLoop({
      model, system: '', tools: [], messages, call: async () => ok(), signal: new AbortController().signal, maxSteps: 2,
    });

    expect(result.status).toBe('step-limit');
    expect(model.requests).toHaveLength(2);
    expect(messages.at(-1)?.role).toBe('user');
  });

  it('reports a refusal and does not run tools from that response', async () => {
    const call = vi.fn(async () => ok());
    const result = await runAssistantLoop({
      model: scripted(reply([{ type: 'tool_use', id: 't', name: 'blok_read', input: {} }], 'refusal')),
      system: '',
      tools: [],
      messages: [{ role: 'user', content: 'x' }],
      call,
      signal: new AbortController().signal,
      maxSteps: 5,
    });

    expect(result.status).toBe('refused');
    expect(call).not.toHaveBeenCalled();
  });

  it('does not run a tool call cut off by max_tokens, and answers it as an error', async () => {
    const call = vi.fn(async () => ok());
    const messages: AgentModelMessage[] = [{ role: 'user', content: 'x' }];
    const result = await runAssistantLoop({
      model: scripted(reply([{ type: 'tool_use', id: 't', name: 'blok_execute', input: { commands: [{ name: 'blo' }] } }], 'max_tokens')),
      system: '',
      tools: [],
      messages,
      call,
      signal: new AbortController().signal,
      maxSteps: 5,
    });

    expect(result.status).toBe('truncated');
    expect(call).not.toHaveBeenCalled();
    expect(messages.at(-1)).toEqual({
      role: 'user',
      content: [expect.objectContaining({ type: 'tool_result', tool_use_id: 't', is_error: true })],
    });
  });

  it('re-sends after pause_turn without adding a user message', async () => {
    const model = scripted(
      reply([{ type: 'text', text: 'Working' }], 'pause_turn'),
      reply([{ type: 'text', text: 'Done' }], 'end_turn')
    );

    const result = await runAssistantLoop({
      model, system: '', tools: [], messages: [{ role: 'user', content: 'x' }], call: async () => ok(), signal: new AbortController().signal, maxSteps: 5,
    });

    expect(result).toEqual({ status: 'done', reply: 'Done' });
    expect(model.requests[1].messages.at(-1)?.role).toBe('assistant');
  });

  it('returns stopped when aborted between tool calls, and answers the calls it skipped', async () => {
    const controller = new AbortController();
    const model = scripted(reply([
      { type: 'tool_use', id: 'a', name: 'blok_read', input: {} },
      { type: 'tool_use', id: 'b', name: 'blok_read', input: {} },
    ], 'tool_use'));
    const call = vi.fn(async () => {
      controller.abort();

      return ok();
    });
    const messages: AgentModelMessage[] = [{ role: 'user', content: 'x' }];

    const result = await runAssistantLoop({
      model, system: '', tools: [], messages, call, signal: controller.signal, maxSteps: 5,
    });

    expect(result.status).toBe('stopped');
    expect(call).toHaveBeenCalledTimes(1);
    expect(messages.at(-1)).toEqual({
      role: 'user',
      content: [
        expect.objectContaining({ tool_use_id: 'a', is_error: false }),
        expect.objectContaining({ tool_use_id: 'b', is_error: true }),
      ],
    });
  });

  it('returns stopped, not failed, when the model call rejects after an abort', async () => {
    const controller = new AbortController();
    const model: AgentModel = async () => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    };

    const result = await runAssistantLoop({
      model, system: '', tools: [], messages: [{ role: 'user', content: 'x' }], call: async () => ok(), signal: controller.signal, maxSteps: 5,
    });

    expect(result.status).toBe('stopped');
  });

  it('returns failed with the message when the model call rejects', async () => {
    const result = await runAssistantLoop({
      model: async () => {
        throw new Error('401 invalid x-api-key');
      },
      system: '',
      tools: [],
      messages: [{ role: 'user', content: 'x' }],
      call: async () => ok(),
      signal: new AbortController().signal,
      maxSteps: 5,
    });

    expect(result).toEqual({ status: 'failed', reply: '', error: '401 invalid x-api-key' });
  });

  it('returns failed when the model returns something that is not a message', async () => {
    const result = await runAssistantLoop({
      model: async () => ({ nope: true }) as unknown as AgentModelResponse,
      system: '',
      tools: [],
      messages: [{ role: 'user', content: 'x' }],
      call: async () => ok(),
      signal: new AbortController().signal,
      maxSteps: 5,
    });

    expect(result.status).toBe('failed');
  });

  it('puts the thinking level on every model request of the run, and leaves it off when none is given', async () => {
    const withLevel = scripted(
      reply([{ type: 'tool_use', id: 't1', name: 'blok_read', input: {} }], 'tool_use'),
      reply([{ type: 'text', text: 'Done.' }], 'end_turn')
    );

    await runAssistantLoop({
      model: withLevel, system: 's', tools: [], messages: [{ role: 'user', content: 'Go' }],
      call: async () => ok(), signal: new AbortController().signal, maxSteps: 5, thinking: 'high',
    });

    expect(withLevel.requests.map((request) => request.thinking)).toEqual(['high', 'high']);

    const without = scripted(reply([{ type: 'text', text: 'Hi' }], 'end_turn'));

    await runAssistantLoop({
      model: without, system: 's', tools: [], messages: [{ role: 'user', content: 'Go' }],
      call: async () => ok(), signal: new AbortController().signal, maxSteps: 5,
    });

    expect('thinking' in without.requests[0]).toBe(false);
  });

  it('reports thinking before each model request and the tool name before each call', async () => {
    const steps: string[] = [];
    const model = scripted(
      reply([
        { type: 'tool_use', id: 't1', name: 'blok_read', input: {} },
        { type: 'tool_use', id: 't2', name: 'blok_execute', input: {} },
      ], 'tool_use'),
      reply([{ type: 'text', text: 'Done.' }], 'end_turn')
    );

    await runAssistantLoop({
      model,
      system: '',
      tools: [],
      messages: [{ role: 'user', content: 'x' }],
      call: async (name) => {
        steps.push(`call ${name}`);

        return ok();
      },
      signal: new AbortController().signal,
      maxSteps: 5,
      onActivity: (activity) => steps.push(activity),
    });

    expect(steps).toEqual(['thinking', 'blok_read', 'call blok_read', 'blok_execute', 'call blok_execute', 'thinking']);
  });

  it('reports nothing once the user stopped the run', async () => {
    const controller = new AbortController();
    const steps: string[] = [];

    await runAssistantLoop({
      model: async () => {
        controller.abort();

        return reply([{ type: 'tool_use', id: 't1', name: 'blok_read', input: {} }], 'tool_use');
      },
      system: '',
      tools: [],
      messages: [{ role: 'user', content: 'x' }],
      call: async () => ok(),
      signal: controller.signal,
      maxSteps: 5,
      onActivity: (activity) => steps.push(activity),
    });

    expect(steps).toEqual(['thinking']);
  });
});
