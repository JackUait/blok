// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

const root = resolve(__dirname, '../../..');
const path = join(root, '.github/workflows/agent-evals.yml');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const workflow: unknown = parse(readFileSync(path, 'utf8'));
const on = isRecord(workflow) && isRecord(workflow.on) ? workflow.on : {};
const jobs = isRecord(workflow) && isRecord(workflow.jobs) ? Object.values(workflow.jobs).filter(isRecord) : [];
const steps = jobs.flatMap((job) => (Array.isArray(job.steps) ? job.steps.filter(isRecord) : []));

describe('agent evals workflow (D3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Real model calls cost money and vary; a person starts every run.
  it('runs on manual dispatch only', () => {
    expect(Object.keys(on)).toEqual(['workflow_dispatch']);
  });

  it('has a job timeout', () => {
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((job) => typeof job['timeout-minutes'] === 'number')).toBe(true);
  });

  it('caps total tokens per dispatch', () => {
    expect(readFileSync(path, 'utf8')).toContain('--max-total-tokens');
  });

  it('reads the model API key from the repository secret, in the eval step only', () => {
    const readers = steps.filter((step) => isRecord(step.env) && step.env.ANTHROPIC_API_KEY !== undefined);

    expect(readers.map((step) => step.name)).toEqual(['Run evals']);
    expect(readers[0]?.env).toMatchObject({ ANTHROPIC_API_KEY: '${{ secrets.ANTHROPIC_API_KEY }}' });
  });

  it('keeps results for 90 days', () => {
    const upload = steps.find((step) => step.name === 'Upload eval results');

    expect(isRecord(upload?.with) ? upload.with['retention-days'] : undefined).toBe(90);
  });

  it('no other workflow reads the model API key', () => {
    const others = readdirSync(join(root, '.github/workflows'))
      .filter((f) => /\.ya?ml$/.test(f) && f !== 'agent-evals.yml')
      .filter((f) => readFileSync(join(root, '.github/workflows', f), 'utf8').includes('ANTHROPIC_API_KEY'));

    expect(others).toEqual([]);
  });
});
