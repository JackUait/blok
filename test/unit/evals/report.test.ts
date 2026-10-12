import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { compareToBaseline, missingRecords, pickSchema, summarize, tooManyInfraErrors } from '../../evals/agent/runner/report.mjs';

const rec = (taskId: string, outcome: 'pass' | 'fail' | 'error', inputTokens = 100) =>
  ({ taskId, surface: 'in-app', trial: 0, outcome, graders: {}, turns: 1, inputTokens, outputTokens: 10 });
const meta = { model: 'claude-opus-5-5', effort: 'high', commit: 'abc', schema: 'envelope' };

describe('eval report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pass@1 ignores error trials', () => {
    const results = summarize([rec('a', 'pass'), rec('a', 'fail'), rec('a', 'error')], meta);

    expect(results.tasks[0]).toMatchObject({ id: 'a', passAt1: 0.5, passAll: false });
  });

  it('fails when a task drops more than one trial below its baseline', () => {
    const baseline = { model: 'claude-opus-5-5', schema: 'envelope', tasks: { a: { passAt1: 1 } } };
    const now = summarize([rec('a', 'pass'), rec('a', 'fail'), rec('a', 'fail')], meta);

    expect(compareToBaseline(now, baseline, 3).failed).toBe(true);
    expect(compareToBaseline(summarize([rec('a', 'pass'), rec('a', 'pass'), rec('a', 'fail')], meta), baseline, 3).failed).toBe(false);
  });

  it('any markdown-regression failure fails the run', () => {
    const baseline = { model: 'claude-opus-5-5', schema: 'envelope', tasks: {} };
    const now = summarize([rec('markdown-regression', 'pass'), rec('markdown-regression', 'fail')], meta);

    expect(compareToBaseline(now, baseline, 3).failed).toBe(true);
  });

  it('a different model resets the comparison instead of failing', () => {
    const baseline = { model: 'other-model', schema: 'envelope', tasks: { a: { passAt1: 1 } } };
    const result = compareToBaseline(summarize([rec('a', 'fail')], meta), baseline, 3);

    expect(result.failed).toBe(false);
    expect(result.lines.join('\n')).toContain('baseline measured on a different model');
  });

  it('pickSchema: higher mean pass@1 wins; a tie within one trial goes to envelope', () => {
    const env = summarize([rec('a', 'pass'), rec('b', 'fail')], meta);
    const full = summarize([rec('a', 'pass'), rec('b', 'pass')], { ...meta, schema: 'full' });

    expect(pickSchema(env, full, 1)).toBe('envelope'); // 0.5 vs 1.0 differ by 0.5 < 1/1
    expect(pickSchema(env, full, 3)).toBe('full');     // 0.5 vs 1.0 differ by more than 1/3
  });

  it('reports selected trials that wrote no record', () => {
    const expected = [{ taskId: 'a', surface: 'in-app', trials: 2 }, { taskId: 'b', surface: 'mcp-stored', trials: 1 }];

    expect(missingRecords(expected, [rec('a', 'pass')])).toEqual([
      'a on in-app: 1 of 2 trials recorded',
      'b on mcp-stored: 0 of 1 trials recorded',
    ]);
  });

  it('three infra errors in a row is loud', () => {
    expect(tooManyInfraErrors([rec('a', 'error'), rec('b', 'error'), rec('c', 'error')])).toBe(true);
    expect(tooManyInfraErrors([rec('a', 'error'), rec('b', 'pass'), rec('c', 'error')])).toBe(false);
  });
});
