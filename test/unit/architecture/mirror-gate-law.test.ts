// @vitest-environment node
/**
 * The release-tag gate in the mirror workflow, executed for real.
 *
 * A tag reaches the mirror through exactly one job, and nothing re-triggers it.
 * So a gate that gives up on the first non-success CI conclusion strands the
 * tag for good: CI flakes, the gate exits, the re-run goes green minutes later
 * and no longer has a job to unblock. That is how v1.14.0 never reached the
 * mirror. The gate must outlive a failed attempt.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Workflow {
  jobs: Record<string, { steps?: Array<{ name?: string; run?: string }> }>;
}

const workflow = parse(
  readFileSync(resolve(__dirname, '../../../.github/workflows/mirror.yml'), 'utf8'),
) as Workflow;

const gate = workflow.jobs.mirror.steps?.find(
  (step) => step.name === 'Require successful CI for a release tag',
)?.run;

let dir = '';

/** Runs the gate with `gh` answering from `states`, one line per poll. */
function runGate(states: string[]): { code: number; output: string } {
  writeFileSync(join(dir, 'states'), `${states.join('\n')}\n`);
  writeFileSync(join(dir, 'cursor'), '0');

  try {
    const output = execFileSync('bash', ['-e', join(dir, 'gate.sh')], {
      env: {
        PATH: `${dir}:${process.env.PATH ?? ''}`,
        GITHUB_SHA: 'deadbeef',
        STATE_DIR: dir,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return { code: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };

    return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

describe('mirror release-tag gate', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mirror-gate-'));

    writeFileSync(join(dir, 'gate.sh'), gate ?? '');

    // The last line answers every poll past the end of the list, so a scenario
    // only has to spell out the states that change.
    writeFileSync(
      join(dir, 'gh'),
      [
        '#!/usr/bin/env bash',
        'cursor="$(cat "$STATE_DIR/cursor")"',
        'total="$(wc -l < "$STATE_DIR/states")"',
        'line=$(( cursor + 1 ))',
        'if [ "$line" -gt "$total" ]; then line="$total"; fi',
        'echo $(( cursor + 1 )) > "$STATE_DIR/cursor"',
        'sed -n "${line}p" "$STATE_DIR/states"',
      ].join('\n'),
    );
    chmodSync(join(dir, 'gh'), 0o755);

    // Real sleeps would make a 360-poll scenario take an hour.
    writeFileSync(join(dir, 'sleep'), '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(join(dir, 'sleep'), 0o755);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('has a gate step to execute', () => {
    expect(gate).toBeTruthy();
  });

  it('passes as soon as CI is green', () => {
    expect(runGate(['completed:success']).code).toBe(0);
  });

  it('waits through a failed attempt for the re-run that goes green', () => {
    const result = runGate(['in_progress:', 'completed:failure', 'completed:failure', 'completed:success']);

    expect(result.code).toBe(0);
  });

  it('waits through a cancelled attempt for the re-run that goes green', () => {
    expect(runGate(['completed:cancelled', 'completed:success']).code).toBe(0);
  });

  it('gives up when CI never goes green', () => {
    const result = runGate(['completed:failure']);

    expect(result.code).not.toBe(0);
    expect(result.output).toContain('::error::');
  }, 60_000);

  it('gives up when CI never finishes', () => {
    const result = runGate(['in_progress:']);

    expect(result.code).not.toBe(0);
  }, 60_000);
});
