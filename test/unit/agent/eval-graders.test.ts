// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ALL_TASKS } from '../../evals/agent/tasks';
import type { EvalTask, ExecuteResult, GraderInput } from '../../evals/agent/types';
import type { AgentResult } from '../../../types/agent';
import { TEST_ACTOR, openJsonSession } from './harness';
import type { CorpusBatch } from './parity/corpus';

const referenceInput = async (task: EvalTask): Promise<GraderInput> => {
  const shared = {
    seed: task.seed,
    actorId: TEST_ACTOR.id,
    toolCalls: task.referenceToolCalls,
    answer: task.referenceAnswer,
    observed: task.referenceObserved,
  };

  if (task.referenceFinal !== undefined) {
    return { ...shared, final: task.referenceFinal, log: task.referenceLog ?? [], results: task.referenceResults };
  }

  const session = openJsonSession(task.seed);
  // Corpus names are plain strings; the session checks them.
  const runner: { execute(batch: CorpusBatch): Promise<AgentResult> } = session;
  const results: ExecuteResult[] = [];

  try {
    for (const batch of task.reference) {
      results.push(await runner.execute(batch));
    }

    return { ...shared, final: session.output(), log: session.log(), results: task.referenceResults ?? results };
  } finally {
    await session.close();
  }
};

/** A grader that throws is a grader bug, never a fail (05 §3.4). */
const verdicts = (task: EvalTask, input: GraderInput): Array<{ name: string; pass: boolean; detail: string }> =>
  task.graders.map((g) => ({ name: g.name, ...g.check(input) }));

describe.each(ALL_TASKS)('eval task $id', (task) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // A blocked reference is held red-by-design until its defect is fixed.
  (task.referenceBlockedBy === undefined ? it : it.fails)('its reference passes every grader', async () => {
    expect(verdicts(task, await referenceInput(task)).filter((v) => !v.pass)).toEqual([]);
  });

  it('has at least one known-bad', () => {
    expect(task.knownBad.length).toBeGreaterThan(0);
  });

  it.each(task.knownBad.map((bad, index) => ({ ...bad, index })))('known-bad $index ($why) fails a grader', (bad) => {
    const input: GraderInput = {
      seed: task.seed,
      final: bad.final,
      actorId: TEST_ACTOR.id,
      log: bad.log ?? [],
      results: bad.results,
      toolCalls: bad.toolCalls,
      answer: bad.answer,
      observed: bad.observed ?? task.referenceObserved,
    };

    expect(verdicts(task, input).some((v) => !v.pass)).toBe(true);
  });
});
