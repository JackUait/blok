/**
 * Summaries and the regression rule for agent evals (05 §3.3.5, §3.3.8).
 * Error trials never count toward pass@1.
 */

const mean = (values) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);
const sum = (trials, pick) => trials.reduce((s, t) => s + pick(t), 0);
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];
};

export function summarize(records, meta) {
  const byTask = new Map();

  for (const r of records) {
    const list = byTask.get(r.taskId) ?? [];

    list.push(r);
    byTask.set(r.taskId, list);
  }

  return {
    ...meta,
    tasks: [...byTask.entries()].map(([id, trials]) => {
      const scored = trials.filter((t) => t.outcome !== 'error');

      return {
        id,
        surface: trials[0].surface,
        trials,
        passAt1: mean(scored.map((t) => (t.outcome === 'pass' ? 1 : 0))),
        passAll: scored.length > 0 && scored.length === trials.length && scored.every((t) => t.outcome === 'pass'),
        inputTokens: sum(trials, (t) => t.inputTokens),
        outputTokens: sum(trials, (t) => t.outputTokens),
        cacheReadTokens: sum(trials, (t) => t.cacheReadTokens),
        cacheWriteTokens: sum(trials, (t) => t.cacheWriteTokens),
        toolCalls: sum(trials, (t) => t.toolCalls.length),
        wallMs: sum(trials, (t) => t.wallMs),
        medianTurns: median(trials.map((t) => t.turns)),
      };
    }),
  };
}

export function compareToBaseline(results, baseline, trials) {
  const lines = [];
  let failed = false;

  if (baseline.model !== results.model) {
    lines.push(`baseline measured on a different model (${baseline.model}); not compared`);
  }

  for (const task of results.tasks) {
    const before = baseline.tasks?.[task.id]?.passAt1;
    const failing = Object.entries(task.trials.flatMap((t) => Object.entries(t.graders)).reduce((acc, [name, v]) => (v.pass ? acc : { ...acc, [name]: true }), {})).map(([n]) => n);

    const speed = `median turns ${task.medianTurns}, ${Math.round(task.wallMs / task.trials.length)} ms per trial, cache read ${task.cacheReadTokens} of ${task.inputTokens + task.cacheReadTokens + task.cacheWriteTokens} input tokens`;

    lines.push(`${task.id}: baseline ${before ?? '-'}, now ${task.passAt1.toFixed(2)}, ${speed}${failing.length ? `, failing: ${failing.join(', ')}` : ''}`);

    if (task.id === 'markdown-regression' && task.trials.some((t) => t.outcome === 'fail')) {
      failed = true;
    }

    // More than one trial's worth: 1.0 → 0.67 with 3 trials is noise, 1.0 → 0.33 is a regression.
    if (baseline.model === results.model && before !== undefined && before - task.passAt1 > 1 / trials + 1e-9) {
      failed = true;
    }
  }

  return { failed, lines };
}

export function pickSchema(envelopeResults, fullResults, trials) {
  const e = mean(envelopeResults.tasks.map((t) => t.passAt1));
  const f = mean(fullResults.tasks.map((t) => t.passAt1));

  return f - e > 1 / trials ? 'full' : 'envelope';
}

export function tooManyInfraErrors(records) {
  let run = 0;

  for (const r of records) {
    run = r.outcome === 'error' ? run + 1 : 0;

    if (run >= 3) {
      return true;
    }
  }

  return false;
}

/** A crash before a trial writes its record must not read as "nothing regressed". */
export function missingRecords(expected, records) {
  return expected
    .map((e) => ({ ...e, got: records.filter((r) => r.taskId === e.taskId && r.surface === e.surface).length }))
    .filter((e) => e.got < e.trials)
    .map((e) => `${e.taskId} on ${e.surface}: ${e.got} of ${e.trials} trials recorded`);
}

export function updatedBaseline(results) {
  return {
    model: results.model,
    effort: results.effort,
    schema: results.schema,
    measuredAt: results.commit,
    tasks: Object.fromEntries(results.tasks.map((t) => [t.id, { passAt1: t.passAt1 }])),
  };
}
