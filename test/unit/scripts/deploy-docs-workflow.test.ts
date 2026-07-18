import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Workflow {
  on: Record<string, unknown>;
  jobs: Record<string, {
    if?: string;
    needs?: string | string[];
    steps?: Array<{
      env?: Record<string, unknown>;
      name?: string;
      run?: string;
      uses?: string;
      with?: Record<string, unknown>;
    }>;
  }>;
}

const workflow = parse(
  readFileSync(join(__dirname, '../../../.github/workflows/deploy-docs.yml'), 'utf-8'),
) as Workflow;

describe('docs deployment workflow', () => {
  it('runs push checks only for documentation inputs', () => {
    expect(workflow.on.push).toEqual({
      branches: ['**'],
      paths: ['docs/**', 'CHANGELOG.md'],
    });
  });

  it('uses published package releases as its only deployment event', () => {
    expect(workflow.on.release).toEqual({ types: ['published'] });
    expect(workflow.on).not.toHaveProperty('workflow_dispatch');
  });

  it('restricts the Pages build to published release events', () => {
    expect(workflow.jobs['verify-release'].if).toBe("github.event_name == 'release'");
    expect(workflow.jobs.build.if).toBe("github.event_name == 'release'");
    expect(workflow.jobs.build.needs).toEqual(['docs-tests', 'verify-release']);
  });

  it('verifies the package family before building the docs release', () => {
    const verification = workflow.jobs['verify-release'].steps?.find(
      (step) => step.name === 'Verify published package family',
    );

    expect(verification).toMatchObject({
      run: 'node scripts/verify-docs-release.mjs "$RELEASE_TAG"',
      env: {
        RELEASE_TAG: '${{ github.event.release.tag_name }}',
      },
    });
  });

  it('builds the source selected by the published release tag', () => {
    const checkout = workflow.jobs.build.steps?.find(
      (step) => step.uses === 'actions/checkout@v4',
    );

    expect(checkout?.with?.ref).toBe('${{ github.event.release.tag_name }}');
  });

  it('deploys only the release-gated build artifact', () => {
    expect(workflow.jobs.deploy.needs).toBe('build');
  });
});
