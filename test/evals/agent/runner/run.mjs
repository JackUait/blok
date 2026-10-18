#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { compareToBaseline, missingRecords, pickSchema, summarize, tooManyInfraErrors, updatedBaseline } from './report.mjs';

const ROOT = resolve(import.meta.dirname, '../../../..');
const BASELINE = join(ROOT, 'test/evals/agent/baseline.json');
const { values } = parseArgs({
  options: {
    tasks: { type: 'string', default: 'all' },
    trials: { type: 'string', default: '3' },
    schema: { type: 'string', default: 'shipped' },
    model: { type: 'string', default: 'claude-opus-5-5' },
    effort: { type: 'string', default: 'high' },
    'max-total-tokens': { type: 'string', default: '3000000' },
    'update-baseline': { type: 'boolean', default: false },
    out: { type: 'string', default: '.eval-results' },
    summary: { type: 'string' },
  },
});
const out = resolve(ROOT, values.out);

mkdirSync(out, { recursive: true });

const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const readRecords = (file) => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const spent = (records) => records.reduce((s, r) => s + r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens, 0);

const runMode = (schema, budgetLeft) => {
  const file = join(out, `trials-${schema}.jsonl`);
  const env = {
    ...process.env,
    BLOK_EVAL_TASKS: values.tasks, BLOK_EVAL_TRIALS: values.trials, BLOK_EVAL_SCHEMA: schema,
    BLOK_EVAL_MODEL: values.model, BLOK_EVAL_EFFORT: values.effort, BLOK_EVAL_OUT: file,
    BLOK_EVAL_MAX_TOTAL_TOKENS: String(budgetLeft),
  };

  // No selected test is fine; any other non-zero exit is a crash, not a measurement.
  const node = spawnSync('yarn', ['vitest', 'run', '--config', 'test/evals/agent/vitest.evals.config.ts', '--passWithNoTests'], { cwd: ROOT, env, stdio: 'inherit' });
  const afterNode = budgetLeft - spent(readRecords(file));
  const browser = spawnSync('yarn', ['playwright', 'test', '--config', 'test/evals/agent/playwright.evals.config.ts', '--pass-with-no-tests'], {
    cwd: ROOT, env: { ...env, BLOK_EVAL_MAX_TOTAL_TOKENS: String(Math.max(0, afterNode)) }, stdio: 'inherit',
  });
  const records = readRecords(file);
  const crashed = [['vitest', node.status], ['playwright', browser.status]].filter(([, status]) => status !== 0).map(([name, status]) => `${name} exited ${status}`);
  const missing = missingRecords(readRecords(`${file}.expected.jsonl`), records);

  return { records, crashed, missing, results: summarize(records, { model: values.model, effort: values.effort, commit, schema }) };
};

const total = Number(values['max-total-tokens']);
const modes = values.schema === 'both' ? ['envelope', 'full'] : [values.schema];
const runs = {};
let left = total;

for (const mode of modes) {
  runs[mode] = runMode(mode, left);
  left -= spent(runs[mode].records);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const trials = Number(values.trials);
const lines = [`# Agent evals — ${values.model}, effort ${values.effort}, ${commit}`, `Tokens spent: ${total - left} of ${total}`];
let failed = false;

for (const mode of modes) {
  const { records, results, crashed, missing } = runs[mode];

  writeFileSync(join(out, `results-${mode}.json`), `${JSON.stringify(results, null, 2)}\n`);

  if (crashed.length > 0 || missing.length > 0) {
    lines.push('The run did not complete:', ...crashed, ...missing);
    failed = true;
  }

  const compared = compareToBaseline(results, baseline, trials);

  lines.push(`## ${mode}`, ...compared.lines);
  failed ||= compared.failed;

  if (tooManyInfraErrors(records)) {
    lines.push('Three infrastructure errors in a row. The run is not a measurement.');
    failed = true;
  }
}

if (modes.length === 2) {
  lines.push(`Schema default by the 05 §3.3.5 rule: ${pickSchema(runs.envelope.results, runs.full.results, trials)}`);
}

if (values['update-baseline']) {
  const chosen = modes.length === 2 ? pickSchema(runs.envelope.results, runs.full.results, trials) : modes[0];

  writeFileSync(BASELINE, `${JSON.stringify(updatedBaseline(runs[chosen].results), null, 2)}\n`);
  lines.push('baseline.json rewritten; a person reviews and commits it.');
}

const text = `${lines.join('\n')}\n`;

process.stdout.write(text);

if (values.summary !== undefined) {
  appendFileSync(values.summary, text);
}

process.exit(failed ? 1 : 0);
