// @vitest-environment node
/**
 * Settings in the mutation gate that are load-bearing and look like noise.
 * Flipping one produces a gate that still runs green while measuring nothing,
 * or one that cannot start at all, so they are pinned here rather than left to
 * review.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

type Step = { name?: string; with?: Record<string, unknown>; run?: string };

type Workflow = {
  on?: {
    workflow_dispatch?: { inputs?: Record<string, unknown> };
    schedule?: Array<{ cron: string }>;
  };
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
  jobs: Record<string, { if?: string; steps?: Step[]; 'timeout-minutes'?: number }>;
};

const workflow = parse(
  readFileSync(resolve(__dirname, '../../../.github/workflows/mutation.yml'), 'utf8'),
) as Workflow;

const steps = workflow.jobs.mutation.steps ?? [];
const sweepSteps = workflow.jobs.sweep?.steps ?? [];

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

  // The push job must finish in under 7 minutes. mutation-scope.mjs stops
  // Stryker at its deadline, so the timeout is only a backstop.
  it('keeps the push job short', () => {
    const run = steps.find((step) => step.name === 'Run mutation testing');

    expect(run?.run).toBe('yarn mutate');
    // Setup time varies; the script stops Stryker by the job's own clock.
    expect(steps[0]?.run).toContain('MUTATION_STOP_AT=');
    expect(steps[0]?.run).toContain('$GITHUB_ENV');
    expect(workflow.jobs.mutation['timeout-minutes']).toBeLessThanOrEqual(10);
    expect(workflow.jobs.mutation.if).toContain("github.event_name == 'push'");
  });

  // Files too heavy for a push run wait for the sweep. Without a schedule
  // nothing ever measures them.
  it('sweeps the heavy files on a schedule with room to finish', () => {
    const run = sweepSteps.find((step) => step.name === 'Run mutation testing');

    expect(workflow.on?.schedule?.length).toBeGreaterThan(0);
    expect(workflow.jobs.sweep.if).toContain("github.event_name == 'schedule'");
    expect(run?.run).toContain('node scripts/mutation-scope.mjs run --sweep');
    expect(workflow.jobs.sweep['timeout-minutes']).toBeGreaterThanOrEqual(330);
  });

  // Both jobs read and write the same ledger, so each needs the full restore
  // and upload contract.
  it('gives the sweep the same ledger handling as the push job', () => {
    const names = (list: Step[]): Array<string | undefined> => list.map((step) => step.name);

    expect(names(sweepSteps)).toEqual(names(steps).filter((name) => name !== 'Record job start'));
    for (const name of ['Checkout code', 'Restore mutation state', 'Upload mutation state']) {
      expect(sweepSteps.find((step) => step.name === name))
        .toEqual(steps.find((step) => step.name === name));
    }
  });

  // A gate that cannot go red is the gate that measured nothing for a day and
  // reported success twice. The baseline is published, so the only things that
  // redden this job now are a broken ratchet and a lost ledger, which is what it
  // is for.
  it('lets a broken ratchet fail the job', () => {
    const run = steps.find((step) => step.name === 'Run mutation testing');

    expect(run).toBeDefined();
    expect(run as unknown as Record<string, unknown>).not.toHaveProperty('continue-on-error');
  });

  // `.mutation-state` starts with a dot, so upload-artifact's default treats the
  // whole ledger as hidden and uploads nothing, warning where nobody looks. Every
  // run then falls back to the release asset, the diff base never advances past
  // the commit the baseline was built on, and the gate re-measures the same range
  // for ever.
  it('uploads a ledger directory whose name starts with a dot', () => {
    const upload = steps.find((step) => step.name === 'Upload mutation state');

    expect(upload?.with?.['include-hidden-files']).toBe(true);
  });

  // A broken ratchet still leaves a valid ledger. Dropping it would make the
  // next run start from nothing and refuse to measure anything.
  it('uploads the ledger even when the run fails', () => {
    const upload = steps.find((step) => step.name === 'Upload mutation state');

    expect(upload).toBeDefined();
    expect((upload as unknown as Record<string, unknown>).if).toBe('always()');
  });
});

describe('mutation vitest config', () => {
  // The config Stryker drives stands in for vitest.config.ts, and every value it
  // invents rather than derives is a test that passes under the normal gate and
  // fails under Stryker. A faked CLI version killed the first seed batch: the
  // CLI suite asserts the real one, and Stryker runs that suite the moment a CLI
  // source enters the scope.
  it('derives the CLI version instead of inventing one', async () => {
    const [config, cliPackage] = await Promise.all([
      import('../../../vitest.mutation.config'),
      import('../../../packages/cli/package.json'),
    ]);

    expect(config.default.define?.__CLI_VERSION__).toBe(
      JSON.stringify(cliPackage.default.version),
    );
  });
});
