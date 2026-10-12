import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TokenBudget } from '../../evals/agent/runner/model-loop';
import { assertMeasured, logFromExecuteCalls, runTrial } from '../../evals/agent/runner/run-task';
import type { OpenSurface } from '../../evals/agent/runner/run-task';
import type { EvalTask, Grader } from '../../evals/agent/types';

const reply = (text: string): Anthropic.Message => ({
  id: 'm', type: 'message', role: 'assistant', model: 'test', container: null, diagnostics: null,
  content: [{ type: 'text', text, citations: null }], stop_reason: 'end_turn', stop_sequence: null, stop_details: null,
  usage: {
    cache_creation: null, cache_creation_input_tokens: null, cache_read_input_tokens: null, inference_geo: null,
    input_tokens: 1, output_tokens: 1, output_tokens_details: null, server_tool_use: null, service_tier: null,
  },
});

const task = (graders: Grader[]): EvalTask => ({
  id: 't', prompt: 'p', surfaces: ['in-app'], seed: { blocks: [] }, graders, reference: [], knownBad: [], budget: { maxTurns: 2, maxOutputTokens: 100 },
});

const open: OpenSurface = async () => ({
  tools: [],
  execute: async () => ({ content: '', isError: false }),
  finish: async () => ({ final: { blocks: [] }, log: [], results: [] }),
  close: async () => undefined,
});

const run = (graders: Grader[]) => runTrial({
  task: task(graders), surface: 'in-app', open, trial: 0, client: { create: vi.fn(async () => reply('done')) },
  model: 'm', effort: 'high', schema: 'envelope', dispatch: new TokenBudget(1000),
});

describe('runTrial', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes when every grader passes', async () => {
    expect((await run([{ name: 'g', check: () => ({ pass: true, detail: '' }) }])).outcome).toBe('pass');
  });

  it('turns a throwing grader into an error with its stack, not a fail', async () => {
    const record = await run([{ name: 'g', check: () => { throw new Error('boom'); } }]);

    expect(record.outcome).toBe('error');
    expect(record.errorDetail).toContain('boom');
  });

  it('turns a surface that fails to open into an error', async () => {
    const record = await runTrial({
      task: task([]), surface: 'in-app', open: async () => { throw new Error('server did not start'); }, trial: 0,
      client: { create: vi.fn() }, model: 'm', effort: 'high', schema: 'envelope', dispatch: new TokenBudget(1000),
    });

    expect(record.outcome).toBe('error');
    expect(record.errorDetail).toContain('server did not start');
  });
});

describe('logFromExecuteCalls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('numbers batches by call and marks the failing command', () => {
    const log = logFromExecuteCalls([
      { input: { commands: [{ name: 'block.insert', args: {} }] }, result: { ok: true } },
      { input: { commands: [{ name: 'a', args: {} }, { name: 'b', args: {} }] }, result: { ok: false, error: { code: 'INVALID_ARGS', commandIndex: 1 } } },
    ], 'agent');

    expect(log.map((e) => [e.batch, e.index, e.name, e.error?.code])).toEqual([
      [0, 0, 'block.insert', undefined],
      [1, 0, 'a', undefined],
      [1, 1, 'b', 'INVALID_ARGS'],
    ]);
  });
});

describe('assertMeasured', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const record = (outcome: 'pass' | 'fail' | 'error', errorDetail?: string) => ({
    taskId: 't', surface: 'mcp-live' as const, trial: 0, outcome, graders: {}, turns: 0, inputTokens: 0, outputTokens: 0, errorDetail,
  });

  it('fails the run on an error trial, naming its detail, so it cannot pass silently', () => {
    expect(() => assertMeasured(record('error', 'TypeError: boom'))).toThrow(/t on mcp-live #0 .*TypeError: boom/);
  });

  it('lets pass and fail trials through: the report judges those', () => {
    expect(() => assertMeasured(record('pass'))).not.toThrow();
    expect(() => assertMeasured(record('fail'))).not.toThrow();
  });
});
