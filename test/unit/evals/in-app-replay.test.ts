// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { composeGuidance } from '../../../src/agent/guidance';
import { renderAgentTools } from '../../../src/agent/render-tools';
import { nodeContract } from '../agent/harness';
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

  it.each(['envelope', 'full', 'shipped'] as const)('passes every grader with the reference as tool calls (%s)', async (schema) => {
    const record = await runTrial({
      task, surface: 'in-app', open: openInApp, trial: 0, client: replayClient(task, 'session'),
      model: 'replay', effort: 'high', schema, dispatch: new TokenBudget(1),
    });

    expect(record.errorDetail).toBeUndefined();
    expect(record.outcome).toBe('pass');
  });
});

describe('in-app surface, shipped setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the mixed schema and the guidance the assistant sends (agent.ts ask)', async () => {
    const task = ALL_TASKS.find((t) => t.surfaces.includes('in-app'));

    if (task === undefined) {
      throw new Error('no in-app task');
    }

    const surface = await openInApp(task, 'shipped');
    const contract = nodeContract('node');

    try {
      expect(surface.system).toBe(composeGuidance(contract));
      expect(surface.tools.map((t) => t.description)).toEqual(
        renderAgentTools(contract, { format: 'anthropic', schema: 'mixed' }).map((t) => t.description)
      );
    } finally {
      await surface.close();
    }
  });

  it('hands a failed call back to the model as a tool error, like agent-turn.ts call()', async () => {
    const task = ALL_TASKS.find((t) => t.surfaces.includes('in-app'));

    if (task === undefined) {
      throw new Error('no in-app task');
    }

    const surface = await openInApp(task, 'shipped');

    try {
      const described = await surface.execute('blok_describe', { tool: 'heading' });
      const executed = await surface.execute('blok_execute', { commands: [{ name: 'block.delete', args: { id: 'missing' } }] });

      expect(described.isError).toBe(true);
      expect(JSON.parse(described.content)).toMatchObject({ ok: false, error: { message: expect.stringContaining('heading') } });
      expect(executed.isError).toBe(true);
    } finally {
      await surface.close();
    }
  });

  it('sends the model the trimmed answer, like agent-turn.ts call()', async () => {
    const task = ALL_TASKS.find((t) => t.surfaces.includes('in-app'));

    if (task === undefined) {
      throw new Error('no in-app task');
    }

    const surface = await openInApp(task, 'shipped');

    try {
      const executed = await surface.execute('blok_execute', { commands: [{ name: 'doc.read', args: {} }] });
      const answer: unknown = JSON.parse(executed.content);

      expect(executed.isError).toBe(false);
      expect(answer).toMatchObject({ ok: true });
      expect(answer).not.toHaveProperty('warnings');
      expect(answer).not.toHaveProperty('changed');
    } finally {
      await surface.close();
    }
  });
});
