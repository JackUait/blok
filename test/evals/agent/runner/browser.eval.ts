import { appendFileSync } from 'node:fs';

import Anthropic from '@anthropic-ai/sdk';
import { test } from '@playwright/test';

import type { Blok } from '../../../../types';
import type { AgentTurn } from '../../../../types/api/agent';
import { isSeed } from '../../../unit/agent/parity/corpus';
import { gotoTestPage } from '../../../playwright/tests/helpers/shared-page';
import { ALL_TASKS } from '../tasks';
import type { ExecuteResult, LogEntry } from '../types';
import { EFFORTS, SCHEMAS, env, oneOf } from './env';
import { TokenBudget } from './model-loop';
import { RATING_TOOL_SOURCE } from './rating-tool';
import { replayClient } from './replay-client';
import { asAnthropicTool, assertMeasured, runTrial } from './run-task';
import type { OpenSurface } from './run-task';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
    evalTurn?: AgentTurn;
    EvalRatingTool?: unknown;
  }
}

const tasks = (env('BLOK_EVAL_TASKS') === 'all' ? ALL_TASKS : ALL_TASKS.filter((t) => env('BLOK_EVAL_TASKS').split(',').includes(t.id)))
  .filter((t) => t.surfaces.includes('in-app-browser'));
const trials = Number(env('BLOK_EVAL_TRIALS'));
const dispatch = new TokenBudget(Number(env('BLOK_EVAL_MAX_TOTAL_TOKENS')));
// Constructed only for real runs: the SDK needs a key.
const client = process.env.BLOK_EVAL_REPLAY === '1' ? null : new Anthropic();

const executeResultOf = (content: string): ExecuteResult | null => {
  const value: unknown = JSON.parse(content);

  return value !== null && typeof value === 'object' && 'ok' in value && typeof value.ok === 'boolean' ? { ok: value.ok } : null;
};

for (const task of tasks) {
  appendFileSync(`${env('BLOK_EVAL_OUT')}.expected.jsonl`, `${JSON.stringify({ taskId: task.id, surface: 'in-app-browser', trials })}\n`);
}

for (const task of tasks) {
  for (let trial = 0; trial < trials; trial++) {
    test(`${task.id} on in-app-browser #${trial}`, async ({ page }) => {
      const open: OpenSurface = async (t, schema) => {
        await gotoTestPage(page);
        await page.waitForFunction(() => typeof window.Blok === 'function');

        if (t.tools === 'rating-fixture') {
          await page.addScriptTag({ content: RATING_TOOL_SOURCE });
        }

        const rendered = await page.evaluate(async ({ seed, mode }) => {
          document.getElementById('blok')?.remove();
          const holder = document.createElement('div');

          holder.id = 'blok';
          document.body.appendChild(holder);

          // The fixture page merges extra tools with the defaults (test/playwright/fixtures/test.html).
          const extra: Record<string, unknown> = window.EvalRatingTool === undefined ? {} : { rating: { class: window.EvalRatingTool } };
          const blok = new window.Blok({ holder: 'blok', data: seed, tools: extra });

          window.blokInstance = blok;
          await blok.isReady;
          // Never attributeTo: 'user' (05 §3.3.6), so `attributed` can pass.
          window.evalTurn = blok.agent.begin({ agent: { id: 'agent-eval', name: 'Eval agent' } });

          return { tools: await blok.agent.tools({ format: 'anthropic', schema: mode }), system: await blok.agent.guidance() };
        }, { seed: t.seed, mode: schema === 'shipped' ? 'mixed' as const : schema });

        const results: ExecuteResult[] = [];

        return {
          system: rendered.system,
          tools: rendered.tools.map((tool) => asAnthropicTool({ name: tool.name, description: tool.description, schema: tool.input_schema })),
          execute: async (name, input) => {
            const out = await page.evaluate(async ({ n, i }) => {
              if (window.evalTurn === undefined) {
                throw new Error('no open agent turn');
              }

              return window.evalTurn.call(n, i);
            }, { n: name, i: input });
            const result = name === 'blok_execute' ? executeResultOf(out.content) : null;

            if (result !== null) {
              results.push(result);
            }

            return out;
          },
          finish: async () => {
            const end = await page.evaluate(async () => {
              const turn = window.evalTurn;
              const log = turn === undefined ? [] : [...turn.log()];

              turn?.end();

              return { log, final: await window.blokInstance?.save() };
            });

            if (!isSeed(end.final)) {
              throw new Error('the editor saved no document');
            }

            const log: LogEntry[] = end.log;

            return { final: end.final, log, results, actorId: 'agent-eval' };
          },
          close: async () => undefined,
        };
      };

      const record = await runTrial({
        task, surface: 'in-app-browser', open, trial,
        client: client === null ? replayClient(task, 'session') : client.messages,
        model: env('BLOK_EVAL_MODEL'), effort: oneOf('BLOK_EVAL_EFFORT', EFFORTS), schema: oneOf('BLOK_EVAL_SCHEMA', SCHEMAS), dispatch,
      });

      appendFileSync(env('BLOK_EVAL_OUT'), `${JSON.stringify(record)}\n`);
      // Written first, so run.mjs still reports it; the report judges pass and fail.
      assertMeasured(record);
    });
  }
}
