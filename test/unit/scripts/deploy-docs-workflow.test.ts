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

  it('deploys on published releases, manual runs, and main pushes', () => {
    expect(workflow.on.release).toEqual({ types: ['published'] });
    expect(workflow.on.workflow_dispatch).toEqual({
      inputs: {
        release_tag: {
          description: 'Release tag to verify and deploy',
          required: false,
          type: 'string',
        },
      },
    });
  });

  it('skips release verification for docs-only deployments', () => {
    expect(workflow.jobs['verify-release'].if).toBe(
      "github.event_name == 'release' || inputs.release_tag != ''",
    );
    expect(workflow.jobs.build.needs).toEqual(['docs-tests', 'verify-release']);
    // A skipped `needs` job skips its dependents unless the dependent's own `if`
    // accepts that result, so the build must treat a skipped verify-release as OK.
    expect(workflow.jobs.build.if).toBe(
      '${{ !cancelled()'
      + " && needs.docs-tests.result == 'success'"
      + " && (needs.verify-release.result == 'success' || needs.verify-release.result == 'skipped')"
      + " && (github.event_name != 'push' || github.ref == 'refs/heads/main') }}",
    );
  });

  it('verifies the selected release tag before building docs', () => {
    const checkout = workflow.jobs['verify-release'].steps?.find(
      (step) => step.uses === 'actions/checkout@v4',
    );
    const verification = workflow.jobs['verify-release'].steps?.find(
      (step) => step.name === 'Verify published package family',
    );
    const selectedRef =
      "${{ github.event_name == 'release' && github.event.release.tag_name || inputs.release_tag || github.ref }}";

    expect(checkout?.with?.ref).toBe(selectedRef);
    expect(verification).toMatchObject({
      run: 'node scripts/verify-docs-release.mjs "$RELEASE_TAG"',
      env: {
        RELEASE_TAG:
          "${{ github.event_name == 'release' && github.event.release.tag_name || inputs.release_tag }}",
      },
    });
  });

  it('tests and builds the selected tag without changing ordinary manual refs', () => {
    const docsTestCheckout = workflow.jobs['docs-tests'].steps?.find(
      (step) => step.uses === 'actions/checkout@v4',
    );
    const buildCheckout = workflow.jobs.build.steps?.find(
      (step) => step.uses === 'actions/checkout@v4',
    );
    const selectedRef =
      "${{ github.event_name == 'release' && github.event.release.tag_name || inputs.release_tag || github.ref }}";

    expect(docsTestCheckout?.with?.ref).toBe(selectedRef);
    expect(buildCheckout?.with?.ref).toBe(selectedRef);
  });

  it('publishes the docs build without the library dist', () => {
    const runSteps = workflow.jobs.build.steps?.filter((step) => typeof step.run === 'string') ?? [];

    // The demo's `/dist/react.mjs` and `/dist/tools.mjs` imports are bundled into
    // the docs output at build time; nothing fetches /dist from the origin, so
    // copying the library dist only inflates the Pages artifact.
    expect(runSteps.some((step) => step.run?.includes('docs/dist/dist'))).toBe(false);
    // The changelog page fetches /CHANGELOG.md at runtime — that copy stays.
    expect(runSteps.map((step) => step.run)).toContain('cp CHANGELOG.md docs/dist/CHANGELOG.md');
  });

  it('deploys only the release-gated build artifact', () => {
    expect(workflow.jobs.deploy.needs).toBe('build');
  });
});
