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
  on?: { workflow_dispatch?: { inputs?: Record<string, unknown> } };
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

  // The artifact expires after ninety days and a quiet period on main is enough
  // to lose it. The release asset is the floor the chain always falls back to,
  // and without it a lost artifact costs another hand-built baseline.
  it('falls back to the release asset when the artifact is gone', () => {
    const restore = steps.find((step) => step.name === 'Restore mutation state');

    expect(restore?.run).toContain('gh run download');
    expect(restore?.run).toContain('gh release download');
  });

  // Both reports run about a kilobyte per mutant, as much as the ledger itself.
  // Nothing reads either one after the run that wrote it: the next run restores
  // the incremental file, the state and the ages, and nothing else.
  it('keeps the reports out of the uploaded ledger', () => {
    const upload = steps.find((step) => step.name === 'Upload mutation state');

    expect(String(upload?.with?.path)).toContain('!.mutation-state/report.html');
    expect(String(upload?.with?.path)).toContain('!.mutation-state/report.json');
  });

  // A full sweep is hours of work and cannot finish inside any job timeout we
  // would accept. Offering the button only invites a run that dies at the cap.
  it('offers no full sweep it could not finish', () => {
    expect(workflow.on?.workflow_dispatch?.inputs ?? {}).not.toHaveProperty('full');
  });

  // One budgeted batch is about ten minutes of mutants on top of install and
  // the dry run. Cutting it finer would park work every single run.
  it('leaves room for a budgeted batch to finish', () => {
    expect(workflow.jobs.mutation['timeout-minutes']).toBeGreaterThanOrEqual(60);
  });

  // A broken ratchet still leaves a valid ledger. Dropping it would make the
  // next run start from nothing and refuse to measure anything.
  it('uploads the ledger even when the run fails', () => {
    const upload = steps.find((step) => step.name === 'Upload mutation state');

    expect(upload).toBeDefined();
    expect((upload as unknown as Record<string, unknown>).if).toBe('always()');
  });
});
