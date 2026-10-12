import { appendFileSync } from 'node:fs';

import Anthropic from '@anthropic-ai/sdk';
import { describe, it } from 'vitest';

import { ALL_TASKS } from '../tasks';
import type { EvalTask, Surface } from '../types';
import { EFFORTS, SCHEMAS, env, oneOf } from './env';
import { TokenBudget } from './model-loop';
import type { MessagesClient } from './model-loop';
import { openMcpLive } from './live-room';
import { replayClient } from './replay-client';
import { assertMeasured, runTrial } from './run-task';
import type { OpenSurface } from './run-task';
import { openInApp } from './surfaces/in-app';
import { openMcpStored } from './surfaces/mcp';

const selected = env('BLOK_EVAL_TASKS') === 'all' ? ALL_TASKS : ALL_TASKS.filter((t) => env('BLOK_EVAL_TASKS').split(',').includes(t.id));
const SURFACES: Partial<Record<Surface, OpenSurface>> = { 'in-app': openInApp, 'mcp-stored': openMcpStored(), 'mcp-live': openMcpLive };
const runnable = (task: EvalTask): Array<{ surface: Surface; open: OpenSurface }> =>
  task.surfaces.flatMap((surface) => {
    const open = SURFACES[surface];

    return open === undefined ? [] : [{ surface, open }];
  });
const trials = Number(env('BLOK_EVAL_TRIALS'));
const dispatch = new TokenBudget(Number(env('BLOK_EVAL_MAX_TOTAL_TOKENS')));
const replay = process.env.BLOK_EVAL_REPLAY === '1';
// Constructed only for real runs: the SDK needs a key.
const client = replay ? null : new Anthropic();
const clientFor = (task: EvalTask, surface: Surface): MessagesClient =>
  client === null ? replayClient(task, surface.startsWith('mcp') ? 'mcp' : 'session') : client.messages;

const runs = selected.flatMap((task) => runnable(task).map((entry) => ({ task, ...entry })));

// run.mjs compares this list with the records, so a crash cannot pass as "no regression".
for (const { task, surface } of runs) {
  appendFileSync(`${env('BLOK_EVAL_OUT')}.expected.jsonl`, `${JSON.stringify({ taskId: task.id, surface, trials })}\n`);
}

describe('agent evals (node surfaces)', () => {
  for (const { task, surface, open } of runs) {
    for (let trial = 0; trial < trials; trial++) {
      it(`${task.id} on ${surface} #${trial}`, async () => {
        const record = await runTrial({
          task, surface, open, trial,
          client: clientFor(task, surface),
          model: env('BLOK_EVAL_MODEL'),
          effort: oneOf('BLOK_EVAL_EFFORT', EFFORTS),
          schema: oneOf('BLOK_EVAL_SCHEMA', SCHEMAS),
          dispatch,
        });

        appendFileSync(env('BLOK_EVAL_OUT'), `${JSON.stringify(record)}\n`);
        // Written first, so run.mjs still reports it; the report judges pass and fail.
        assertMeasured(record);
      });
    }
  }
});
