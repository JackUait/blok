import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { runAssistantLoop } from '../../../src/agent/assistant-loop';
import type {
  AgentModel,
  AgentModelMessage,
  AgentModelResponse,
  AgentModelStreamEvent,
  AgentToolResult,
} from '../../../types/api';

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

/** A model that streams `events`, then waits until `open()` before it resolves with `response`. */
const streaming = (events: AgentModelStreamEvent[], response: AgentModelResponse, before?: () => void): AgentModel & { open(): void } => {
  const gate: { open: () => void } = { open: () => undefined };
  const closed = new Promise<void>((resolve) => {
    gate.open = resolve;
  });
  const model = async (request: Parameters<AgentModel>[0]): Promise<AgentModelResponse> => {
    events.forEach((event) => {
      if (event.type === 'tool_end') {
        before?.();
      }
      request.onStream?.(event);
    });
    await closed;

    return response;
  };

  return Object.assign(model, { open: () => gate.open() });
};

const streamOf = (index: number, id: string, name: string, input: unknown): AgentModelStreamEvent[] => {
  const json = JSON.stringify(input);

  return [
    { type: 'tool_start', index, id, name },
    { type: 'tool_input', index, json: json.slice(0, 5) },
    { type: 'tool_input', index, json },
    { type: 'tool_end', index },
  ];
};

/** Model 1 streams; later requests come from `then`. */
const thenScripted = (first: AgentModel, ...rest: AgentModelResponse[]): AgentModel => {
  const used = { first: false };

  return async (request) => {
    if (!used.first) {
      used.first = true;

      return first(request);
    }
    const next = rest.shift();

    if (next === undefined) {
      throw new Error('model called more times than scripted');
    }

    return next;
  };
};

describe('runAssistantLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('joins a web-search answer split at its citations back into one sentence', async () => {
    const citation = { type: 'web_search_result_location', url: 'https://example.org/a', title: 'A', encrypted_index: 'i', cited_text: 'won' };
    const model = scripted(reply([
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'nobel' } },
      { type: 'web_search_tool_result', tool_use_id: 's1', content: [] },
      { type: 'text', text: 'Based on the search results, ' },
      { type: 'text', text: 'Halzen won', citations: [citation] },
      { type: 'text', text: '.' },
    ], 'end_turn'));

    const result = await runAssistantLoop({
      model, system: 'sys', tools: [], messages: [{ role: 'user', content: 'Who won?' }], call: vi.fn(), signal: new AbortController().signal, maxSteps: 5,
    });

    expect(result).toEqual({ status: 'done', reply: 'Based on the search results, Halzen won.' });
  });

  it('keeps two plain text blocks in a row on separate lines', async () => {
    const model = scripted(reply([{ type: 'text', text: 'Reading.' }, { type: 'text', text: 'Done.' }], 'end_turn'));

    const result = await runAssistantLoop({
      model, system: 'sys', tools: [], messages: [{ role: 'user', content: 'Go' }], call: vi.fn(), signal: new AbortController().signal, maxSteps: 5,
    });

    expect(result).toEqual({ status: 'done', reply: 'Reading.\nDone.' });
  });

  it('keeps text written before and after a tool call on separate lines', async () => {
    const model = scripted(reply([
      { type: 'text', text: 'Searching.' },
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'nobel' } },
      { type: 'web_search_tool_result', tool_use_id: 's1', content: [] },
      { type: 'text', text: 'Halzen won.' },
    ], 'end_turn'));

    const result = await runAssistantLoop({
      model, system: 'sys', tools: [], messages: [{ role: 'user', content: 'Who won?' }], call: vi.fn(), signal: new AbortController().signal, maxSteps: 5,
    });

    expect(result).toEqual({ status: 'done', reply: 'Searching.\nHalzen won.' });
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

  it.each([
    ['blok_execute', { ok: false, error: { code: 'CANCELLED', message: 'The output was cut off. This call was not run.', retryable: false } }],
    ['blok_read', { error: { code: 'CANCELLED', message: 'The output was cut off. This call was not run.', retryable: false } }],
  ])('answers a cut-off %s call in the envelope that tool answers errors in', async (name, answer) => {
    const messages: AgentModelMessage[] = [{ role: 'user', content: 'x' }];

    await runAssistantLoop({
      model: scripted(reply([{ type: 'tool_use', id: 't', name, input: {} }], 'max_tokens')),
      system: '',
      tools: [],
      messages,
      call: vi.fn(async () => ok()),
      signal: new AbortController().signal,
      maxSteps: 5,
    });

    const last = messages.at(-1);
    const block = Array.isArray(last?.content) ? last.content[0] : undefined;

    expect(block?.type).toBe('tool_result');
    expect(JSON.parse(String(block !== undefined && 'content' in block ? block.content : undefined))).toEqual(answer);
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

  it('runs the tool calls of a pause_turn response before it re-sends, so none is left unanswered', async () => {
    const model = scripted(
      reply([{ type: 'tool_use', id: 't1', name: 'blok_read', input: {} }], 'pause_turn'),
      reply([{ type: 'text', text: 'Done' }], 'end_turn')
    );
    const call = vi.fn(async () => ok());

    const result = await runAssistantLoop({
      model, system: '', tools: [], messages: [{ role: 'user', content: 'x' }], call, signal: new AbortController().signal, maxSteps: 5,
    });

    expect(model.requests[1].messages.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"ok":true}', is_error: false }],
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'done', reply: 'Done' });
  });

  it('fails the run when a tool call throws, and answers that call and the ones after it so Ask again stays valid', async () => {
    const model = scripted(reply([
      { type: 'tool_use', id: 't1', name: 'blok_read', input: {} },
      { type: 'tool_use', id: 't2', name: 'blok_execute', input: {} },
    ], 'tool_use'));
    const messages: AgentModelMessage[] = [{ role: 'user', content: 'x' }];
    const call = vi.fn(async () => {
      throw new Error('the editor was destroyed');
    });

    const result = await runAssistantLoop({
      model, system: '', tools: [], messages, call, signal: new AbortController().signal, maxSteps: 5,
    });

    expect(messages.at(-1)).toEqual({
      role: 'user',
      content: [
        expect.objectContaining({ type: 'tool_result', tool_use_id: 't1', is_error: true }),
        expect.objectContaining({ type: 'tool_result', tool_use_id: 't2', is_error: true }),
      ],
    });
    expect(result).toEqual({ status: 'failed', reply: '', error: 'the editor was destroyed' });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('keeps running when the activity callback throws: a status line must not stop an edit', async () => {
    const model = scripted(
      reply([{ type: 'tool_use', id: 't1', name: 'blok_read', input: {} }], 'tool_use'),
      reply([{ type: 'text', text: 'Done' }], 'end_turn')
    );
    const call = vi.fn(async () => ok());

    const result = await runAssistantLoop({
      model,
      system: '',
      tools: [],
      messages: [{ role: 'user', content: 'x' }],
      call,
      signal: new AbortController().signal,
      maxSteps: 5,
      onActivity: () => {
        throw new TypeError('status text');
      },
    });

    expect(result).toEqual({ status: 'done', reply: 'Done' });
    expect(call).toHaveBeenCalledTimes(1);
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
        { type: 'tool_use', id: 't2', name: 'blok_execute', input: { commands: [] } },
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
      onActivity: (activity, input) => steps.push(input === undefined ? activity : `${activity} ${JSON.stringify(input)}`),
    });

    expect(steps).toEqual([
      'thinking', 'blok_read {}', 'call blok_read', 'blok_execute {"commands":[]}', 'call blok_execute', 'thinking',
    ]);
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
  describe('streamed tool calls', () => {
    const insert = { commands: [{ name: 'block.insert', args: { type: 'paragraph' } }] };

    it('runs a streamed call at its tool_end, before the model response resolves', async () => {
      const call = vi.fn(async (_name: string, _input: unknown) => ok());
      const model = streaming(
        streamOf(0, 't1', 'blok_execute', insert),
        reply([{ type: 'tool_use', id: 't1', name: 'blok_execute', input: insert }], 'end_turn')
      );
      const run = runAssistantLoop({
        model, system: '', tools: [], messages: [{ role: 'user', content: 'x' }], call, signal: new AbortController().signal, maxSteps: 1,
      });

      await vi.waitFor(() => expect(call).toHaveBeenCalledWith('blok_execute', insert));

      model.open();
      await run;
    });

    it('runs an arg-less streamed call with {} and keeps running later calls early', async () => {
      const call = vi.fn(async (_name: string, _input: unknown) => ok());
      // An arg-less call streams no input_json_delta, so its input is ''.
      const model = streaming(
        [{ type: 'tool_start', index: 0, id: 't0', name: 'blok_read' }, { type: 'tool_end', index: 0 }, ...streamOf(1, 't1', 'blok_execute', insert)],
        reply([
          { type: 'tool_use', id: 't0', name: 'blok_read', input: {} },
          { type: 'tool_use', id: 't1', name: 'blok_execute', input: insert },
        ], 'end_turn')
      );
      const run = runAssistantLoop({
        model, system: '', tools: [], messages: [{ role: 'user', content: 'x' }], call, signal: new AbortController().signal, maxSteps: 1,
      });

      await vi.waitFor(() => expect(call).toHaveBeenCalledWith('blok_execute', insert));
      expect(call.mock.calls).toEqual([['blok_read', {}], ['blok_execute', insert]]);

      model.open();
      await run;
      expect(call).toHaveBeenCalledTimes(2);
    });

    it('does not run a streamed call twice when the response arrives', async () => {
      const call = vi.fn(async (_name: string, _input: unknown) => ok('{"applied":1}'));
      const model = streaming(
        streamOf(0, 't1', 'blok_execute', insert),
        reply([{ type: 'tool_use', id: 't1', name: 'blok_execute', input: insert }], 'tool_use')
      );
      const messages: AgentModelMessage[] = [{ role: 'user', content: 'x' }];
      const run = runAssistantLoop({
        model: thenScripted(model, reply([{ type: 'text', text: 'Done' }], 'end_turn')),
        system: '', tools: [], messages, call, signal: new AbortController().signal, maxSteps: 5,
      });

      await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
      model.open();

      expect(await run).toEqual({ status: 'done', reply: 'Done' });
      expect(call).toHaveBeenCalledTimes(1);
      expect(messages[2]).toEqual({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"applied":1}', is_error: false }],
      });
    });

    it('does not run an early call twice when the final reply gives it a different id', async () => {
      const call = vi.fn(async (_name: string, _input: unknown) => ok('{"applied":1}'));
      const model = streaming(
        [...streamOf(0, 'stream-1', 'blok_read', {}), ...streamOf(1, 'stream-2', 'blok_execute', insert)],
        reply([
          { type: 'text', text: 'Working' },
          { type: 'tool_use', id: 'final-1', name: 'blok_read', input: {} },
          { type: 'tool_use', id: 'final-2', name: 'blok_execute', input: insert },
        ], 'tool_use')
      );
      const messages: AgentModelMessage[] = [{ role: 'user', content: 'x' }];
      const run = runAssistantLoop({
        model: thenScripted(model, reply([{ type: 'text', text: 'Done' }], 'end_turn')),
        system: '', tools: [], messages, call, signal: new AbortController().signal, maxSteps: 5,
      });

      await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
      model.open();
      await run;

      expect(call).toHaveBeenCalledTimes(2);
      expect(messages[2]).toEqual({
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'final-1', content: '{"applied":1}', is_error: false },
          { type: 'tool_result', tool_use_id: 'final-2', content: '{"applied":1}', is_error: false },
        ],
      });
    });

    it('runs a final call whose stream index holds a call of another name', async () => {
      const call = vi.fn(async (_name: string, _input: unknown) => ok());
      const model = streaming(
        streamOf(0, 'stream-1', 'blok_read', {}),
        reply([{ type: 'tool_use', id: 'final-1', name: 'blok_execute', input: insert }], 'tool_use')
      );
      const run = runAssistantLoop({
        model: thenScripted(model, reply([{ type: 'text', text: 'Done' }], 'end_turn')),
        system: '', tools: [], messages: [{ role: 'user', content: 'x' }], call, signal: new AbortController().signal, maxSteps: 5,
      });

      await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
      model.open();
      await run;

      expect(call.mock.calls).toEqual([['blok_read', {}], ['blok_execute', insert]]);
    });

    it('answers an early call by stream index on max_tokens when the final id differs', async () => {
      const call = vi.fn(async (_name: string, _input: unknown) => ok('{"applied":1}'));
      const model = streaming(
        streamOf(0, 'stream-1', 'blok_execute', insert),
        reply([{ type: 'tool_use', id: 'final-1', name: 'blok_execute', input: insert }], 'max_tokens')
      );
      const messages: AgentModelMessage[] = [{ role: 'user', content: 'x' }];
      const run = runAssistantLoop({
        model, system: '', tools: [], messages, call, signal: new AbortController().signal, maxSteps: 5,
      });

      await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
      model.open();
      await run;

      expect(messages.at(-1)).toEqual({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'final-1', content: '{"applied":1}', is_error: false }],
      });
    });

    it('runs a call whose streamed JSON does not parse only from the final response', async () => {
      const call = vi.fn(async (_name: string, _input: unknown) => ok());
      const model = streaming(
        [
          { type: 'tool_start', index: 0, id: 't1', name: 'blok_execute' },
          { type: 'tool_input', index: 0, json: '{"commands":[' },
          { type: 'tool_end', index: 0 },
          ...streamOf(1, 't2', 'blok_execute', insert),
        ],
        reply([
          { type: 'tool_use', id: 't1', name: 'blok_execute', input: { commands: [] } },
          { type: 'tool_use', id: 't2', name: 'blok_execute', input: insert },
        ], 'end_turn')
      );
      const run = runAssistantLoop({
        model, system: '', tools: [], messages: [{ role: 'user', content: 'x' }], call, signal: new AbortController().signal, maxSteps: 1,
      });

      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      // A later call waits too, so calls still run in stream order.
      expect(call).not.toHaveBeenCalled();

      model.open();
      await run;

      expect(call.mock.calls).toEqual([['blok_execute', { commands: [] }], ['blok_execute', insert]]);
    });

    it('answers early-run calls with their real result on max_tokens, and the rest as cut off', async () => {
      const call = vi.fn(async (_name: string, _input: unknown) => ok('{"applied":1}'));
      const model = streaming(
        [...streamOf(0, 't1', 'blok_execute', insert), { type: 'tool_start', index: 1, id: 't2', name: 'blok_execute' }],
        reply([
          { type: 'tool_use', id: 't1', name: 'blok_execute', input: insert },
          { type: 'tool_use', id: 't2', name: 'blok_execute', input: { commands: [{ name: 'blo' }] } },
        ], 'max_tokens')
      );
      const messages: AgentModelMessage[] = [{ role: 'user', content: 'x' }];
      const run = runAssistantLoop({
        model, system: '', tools: [], messages, call, signal: new AbortController().signal, maxSteps: 5,
      });

      await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
      model.open();

      expect((await run).status).toBe('truncated');
      expect(messages.at(-1)).toEqual({
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: '{"applied":1}', is_error: false },
          expect.objectContaining({ type: 'tool_result', tool_use_id: 't2', is_error: true }),
        ],
      });
      expect(call).toHaveBeenCalledTimes(1);
    });

    it('does not start an early call after stop', async () => {
      const controller = new AbortController();
      const call = vi.fn(async (_name: string, _input: unknown) => ok());
      const model = streaming(
        streamOf(0, 't1', 'blok_execute', insert),
        reply([{ type: 'tool_use', id: 't1', name: 'blok_execute', input: insert }], 'tool_use'),
        () => controller.abort()
      );
      const run = runAssistantLoop({
        model, system: '', tools: [], messages: [{ role: 'user', content: 'x' }], call, signal: controller.signal, maxSteps: 5,
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      model.open();

      expect((await run).status).toBe('stopped');
      expect(call).not.toHaveBeenCalled();
    });

    it('does not run an early call again when the user stops before the response arrives', async () => {
      const controller = new AbortController();
      const call = vi.fn(async (_name: string, _input: unknown) => ok('{"applied":1}'));
      const model = streaming(
        streamOf(0, 't1', 'blok_execute', insert),
        reply([{ type: 'tool_use', id: 't1', name: 'blok_execute', input: insert }], 'tool_use')
      );
      const messages: AgentModelMessage[] = [{ role: 'user', content: 'x' }];
      const run = runAssistantLoop({
        model, system: '', tools: [], messages, call, signal: controller.signal, maxSteps: 5,
      });

      await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
      controller.abort();
      model.open();

      expect((await run).status).toBe('stopped');
      expect(call).toHaveBeenCalledTimes(1);
    });

    it('waits for an early call still running before it returns refused', async () => {
      const release: { done: () => void } = { done: () => undefined };
      const applying = new Promise<void>((resolve) => {
        release.done = resolve;
      });
      const call = vi.fn(async (_name: string, _input: unknown) => {
        await applying;

        return ok();
      });
      const model = streaming(
        streamOf(0, 't1', 'blok_execute', insert),
        reply([{ type: 'tool_use', id: 't1', name: 'blok_execute', input: insert }], 'refusal')
      );
      const settled = { value: false };
      const run = runAssistantLoop({
        model, system: '', tools: [], messages: [{ role: 'user', content: 'x' }], call, signal: new AbortController().signal, maxSteps: 5,
      }).finally(() => {
        settled.value = true;
      });

      await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
      model.open();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(settled.value).toBe(false);

      release.done();

      expect((await run).status).toBe('refused');
    });

    it('fails the run when an early call throws, and does not start the streamed calls after it', async () => {
      const call = vi.fn(async (_name: string, _input: unknown): Promise<AgentToolResult> => {
        throw new Error('the editor was destroyed');
      });
      const model = streaming(
        [...streamOf(0, 't1', 'blok_execute', insert), ...streamOf(1, 't2', 'blok_execute', insert)],
        reply([
          { type: 'tool_use', id: 't1', name: 'blok_execute', input: insert },
          { type: 'tool_use', id: 't2', name: 'blok_execute', input: insert },
        ], 'tool_use')
      );
      const messages: AgentModelMessage[] = [{ role: 'user', content: 'x' }];
      const run = runAssistantLoop({
        model, system: '', tools: [], messages, call, signal: new AbortController().signal, maxSteps: 5,
      });

      await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
      model.open();

      expect(await run).toEqual({ status: 'failed', reply: '', error: 'the editor was destroyed' });
      expect(call).toHaveBeenCalledTimes(1);
      expect(messages.at(-1)).toEqual({
        role: 'user',
        content: [
          expect.objectContaining({ tool_use_id: 't1', is_error: true }),
          expect.objectContaining({ tool_use_id: 't2', is_error: true }),
        ],
      });
    });

    it('ignores stream events that arrive after the response', async () => {
      const late: { send: (event: AgentModelStreamEvent) => void } = { send: () => undefined };
      const call = vi.fn(async (_name: string, _input: unknown) => ok());
      const onStream = vi.fn();

      await runAssistantLoop({
        model: async (request) => {
          late.send = (event) => request.onStream?.(event);

          return reply([{ type: 'tool_use', id: 't1', name: 'blok_execute', input: insert }], 'end_turn');
        },
        system: '', tools: [], messages: [{ role: 'user', content: 'x' }], call, signal: new AbortController().signal, maxSteps: 1, onStream,
      });
      streamOf(0, 't1', 'blok_execute', insert).forEach((event) => late.send(event));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(call).toHaveBeenCalledTimes(1);
      expect(onStream).not.toHaveBeenCalled();
    });

    it('forwards every stream event to onStream and reports onToolDone with the result', async () => {
      const events = [
        ...streamOf(0, 't1', 'blok_execute', insert),
        { type: 'tool_start', index: 1, id: 't2', name: 'blok_read' } as const,
        { type: 'tool_input', index: 1, json: '{"' } as const,
        { type: 'tool_end', index: 1 } as const,
      ];
      const model = streaming(events, reply([
        { type: 'tool_use', id: 't1', name: 'blok_execute', input: insert },
        { type: 'tool_use', id: 't2', name: 'blok_read', input: {} },
      ], 'end_turn'));
      const seen: AgentModelStreamEvent[] = [];
      const done: Array<[string, string, AgentToolResult]> = [];
      const activity: string[] = [];
      const run = runAssistantLoop({
        model,
        system: '',
        tools: [],
        messages: [{ role: 'user', content: 'x' }],
        call: async (name) => ok(`{"tool":"${name}"}`),
        signal: new AbortController().signal,
        maxSteps: 1,
        onStream: (event) => {
          seen.push(event);
          throw new Error('a listener must not stop an edit');
        },
        onToolDone: (id, name, result) => {
          done.push([id, name, result]);
        },
        onActivity: (name) => activity.push(name),
      });

      model.open();
      await run;

      expect(seen).toEqual(events);
      expect(done).toEqual([
        ['t1', 'blok_execute', ok('{"tool":"blok_execute"}')],
        ['t2', 'blok_read', ok('{"tool":"blok_read"}')],
      ]);
      // Each call is reported once, early or not.
      expect(activity).toEqual(['thinking', 'blok_execute', 'blok_read']);
    });
  });
});
