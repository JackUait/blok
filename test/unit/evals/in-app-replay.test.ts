// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TokenBudget } from '../../evals/agent/runner/model-loop';
import { replayClient } from '../../evals/agent/runner/replay-client';
import { runTrial } from '../../evals/agent/runner/run-task';
import { openInApp } from '../../evals/agent/runner/surfaces/in-app';
import { ALL_TASKS } from '../../evals/agent/tasks';

describe.each(ALL_TASKS.filter((t) => t.surfaces.includes('in-app')))('in-app surface replays $id', (task) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['envelope', 'full'] as const)('passes every grader with the reference as tool calls (%s)', async (schema) => {
    const record = await runTrial({
      task, surface: 'in-app', open: openInApp, trial: 0, client: replayClient(task, 'session'),
      model: 'replay', effort: 'high', schema, dispatch: new TokenBudget(1),
    });

    expect(record.errorDetail).toBeUndefined();
    expect(record.outcome).toBe('pass');
  });
});
