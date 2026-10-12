import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TokenBudget, classifyTrial, runModelLoop } from '../../evals/agent/runner/model-loop';
import type { MessagesClient } from '../../evals/agent/runner/model-loop';

const usage = (input = 100, output = 50): Anthropic.Usage => ({
  cache_creation: null,
  cache_creation_input_tokens: null,
  cache_read_input_tokens: null,
  inference_geo: null,
  input_tokens: input,
  output_tokens: output,
  output_tokens_details: null,
  server_tool_use: null,
  service_tier: null,
});

const message = (
  content: Anthropic.ContentBlock[],
  stop: Anthropic.StopReason,
  stopDetails: Anthropic.RefusalStopDetails | null = null
): Anthropic.Message => ({
  id: 'm',
  type: 'message',
  role: 'assistant',
  model: 'test',
  container: null,
  diagnostics: null,
  content,
  stop_reason: stop,
  stop_sequence: null,
  stop_details: stopDetails,
  usage: usage(),
});

const toolUse = (id: string): Anthropic.ToolUseBlock => ({
  type: 'tool_use', id, name: 'blok_execute', input: { commands: [] }, caller: { type: 'direct' },
});

const textBlock = (text: string): Anthropic.TextBlock => ({ type: 'text', text, citations: null });

const options = (client: MessagesClient, dispatch = new TokenBudget(1_000_000)) => ({
  client,
  model: 'claude-opus-5-5',
  effort: 'high' as const,
  system: 'sys',
  prompt: 'do it',
  tools: [],
  execute: vi.fn(async () => ({ content: '{"ok":true}', isError: false })),
  budget: { maxTurns: 3, maxOutputTokens: 10_000 },
  dispatch,
});

describe('runModelLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops at the turn cap when every reply is a tool call (no runaway loop)', async () => {
    const create = vi.fn(async () => message([toolUse('t')], 'tool_use'));
    const result = await runModelLoop(options({ create }));

    expect(result.stop).toBe('turn-cap');
    expect(create).toHaveBeenCalledTimes(3);
    expect(classifyTrial(result, [{ pass: true }], false)).toBe('fail');
  });

  it('stops the whole dispatch at its token cap and calls it an error', async () => {
    const dispatch = new TokenBudget(120);
    const create = vi.fn(async () => message([toolUse('t')], 'tool_use'));
    const result = await runModelLoop(options({ create }, dispatch));

    expect(result.stop).toBe('dispatch-token-cap');
    expect(create).toHaveBeenCalledTimes(1);
    expect(classifyTrial(result, [{ pass: true }], false)).toBe('error');
  });

  it('finishes on a text reply and returns it as the answer', async () => {
    const create = vi.fn<MessagesClient['create']>()
      .mockResolvedValueOnce(message([toolUse('a'), toolUse('b')], 'tool_use'))
      .mockResolvedValueOnce(message([textBlock('done: h1')], 'end_turn'));
    const opts = options({ create });
    const result = await runModelLoop(opts);

    expect(result).toMatchObject({ stop: 'done', answer: 'done: h1', turns: 2, toolCalls: ['blok_execute', 'blok_execute'] });
    expect(opts.execute).toHaveBeenCalledTimes(2);

    // Both tool results go back in ONE user message.
    const last = create.mock.calls[1]?.[0].messages.at(-1);

    expect(last?.role).toBe('user');
    expect(Array.isArray(last?.content) ? last.content.length : 0).toBe(2);
  });

  it('never forces a tool and always sets effort', async () => {
    const create = vi.fn<MessagesClient['create']>(async () => message([textBlock('ok')], 'end_turn'));

    await runModelLoop(options({ create }));

    const params = create.mock.calls[0]?.[0];

    expect(params?.tool_choice).toBeUndefined();
    expect(params?.output_config?.effort).toBe('high');
  });

  it('records a refusal as an error', async () => {
    const create = vi.fn(async () => message([], 'refusal', { type: 'refusal', category: 'cyber', explanation: 'x' }));
    const result = await runModelLoop(options({ create }));

    expect(result.stop).toBe('refusal');
    expect(result.detail).toContain('cyber');
    expect(classifyTrial(result, [{ pass: true }], false)).toBe('error');
  });

  it('a grader that throws is an error, a failing grader is a fail', () => {
    const done = { stop: 'done' as const, answer: '', turns: 1, inputTokens: 0, outputTokens: 0, toolCalls: [] };

    expect(classifyTrial(done, [{ pass: true }], true)).toBe('error');
    expect(classifyTrial(done, [{ pass: false }], false)).toBe('fail');
    expect(classifyTrial(done, [{ pass: true }], false)).toBe('pass');
  });
});
