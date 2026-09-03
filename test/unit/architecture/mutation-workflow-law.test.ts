// @vitest-environment node
/**
 * Two settings in the mutation workflow are load-bearing and look like noise.
 * Flipping either one produces a workflow that still runs green while measuring
 * nothing, so they are pinned here rather than left to review.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

type Step = { name?: string; with?: Record<string, unknown>; run?: string };

type Workflow = {
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
  jobs: Record<string, { steps?: Step[]; 'timeout-minutes'?: number }>;
};

const workflow = parse(
  readFileSync(resolve(__dirname, '../../../.github/workflows/mutation.yml'), 'utf8'),
) as Workflow;

const steps = workflow.jobs.mutation.steps ?? [];

describe('mutation workflow', () => {
  // Cancelling a superseded run drops its commits for good: the ledger records
  // the last MEASURED commit, and two live runs would race over that file.
  it('queues concurrent runs instead of cancelling them', () => {
    expect(workflow.concurrency?.['cancel-in-progress']).toBe(false);
  });

  // The diff starts at the last measured commit, which can be many pushes back.
  // A shallow clone cannot reach it, and the run degrades into asking for a
  // sixteen-hour full sweep.
  it('checks out the full history', () => {
    const checkout = steps.find((step) => step.name === 'Checkout code');

    expect(checkout?.with?.['fetch-depth']).toBe(0);
  });

  // A broken ratchet still leaves a valid ledger. Dropping it would make the
  // next run start from nothing and refuse to measure anything.
  it('uploads the ledger even when the run fails', () => {
    const upload = steps.find((step) => step.name === 'Upload mutation state');

    expect(upload).toBeDefined();
    expect((upload as unknown as Record<string, unknown>).if).toBe('always()');
  });
});
