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
  it('runs after the CI workflow completes on main', () => {
    expect(workflow.on.workflow_run).toEqual({
      workflows: ['CI'],
      types: ['completed'],
      branches: ['main'],
    });
    expect(workflow.on).not.toHaveProperty('push');
  });

  it('deploys on published releases and manual runs too', () => {
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

  it('accepts only trusted latest same-repository push CI deployments', () => {
    const trustedRun = "github.event.workflow_run.conclusion == 'success'"
      + " && github.event.workflow_run.event == 'push'"
      + ' && github.event.workflow_run.head_repository.full_name == github.repository'
      + ' && github.event.workflow_run.head_sha == github.sha';

    expect(workflow.jobs['docs-tests'].if).toBe(
      `github.event_name != 'workflow_run' || (${trustedRun})`,
    );
    expect(workflow.jobs['verify-release'].if).toBe(
      `(github.event_name == 'workflow_run' && ${trustedRun})`
      + " || github.event_name == 'release' || inputs.release_tag != ''",
    );
    expect(workflow.jobs.build.needs).toEqual(['docs-tests', 'verify-release']);
    // A skipped `needs` job skips its dependents unless the dependent accepts it.
    expect(workflow.jobs.build.if).toBe(
      '${{ !cancelled()'
      + " && needs.docs-tests.result == 'success'"
      + " && (needs.verify-release.result == 'success' || needs.verify-release.result == 'skipped')"
      + " && (github.event_name != 'workflow_run'"
      + ` || (${trustedRun})) }}`,
    );
  });

  it('verifies the selected release tag before building docs', () => {
    const checkout = workflow.jobs['verify-release'].steps?.find(
      (step) => step.name === 'Checkout code',
    );
    const verification = workflow.jobs['verify-release'].steps?.find(
      (step) => step.name === 'Verify published package family',
    );
    const selectedRef =
      "${{ github.event_name == 'workflow_run' && github.event.workflow_run.head_sha"
      + " || github.event_name == 'release' && github.event.release.tag_name"
      + ' || inputs.release_tag || github.ref }}';

    expect(checkout?.with?.ref).toBe(selectedRef);
    expect(verification).toMatchObject({
      run: 'tag="${RELEASE_TAG:-v$(node -p "require(\'./package.json\').version")}"\n'
        + 'node scripts/verify-docs-release.mjs "$tag"\n',
      env: {
        RELEASE_TAG:
          "${{ github.event_name == 'release' && github.event.release.tag_name || inputs.release_tag }}",
      },
    });
  });

  it('tests and builds the exact CI head SHA while preserving release and manual refs', () => {
    const docsTestCheckout = workflow.jobs['docs-tests'].steps?.find(
      (step) => step.name === 'Checkout code',
    );
    const buildCheckout = workflow.jobs.build.steps?.find(
      (step) => step.name === 'Checkout code',
    );
    const selectedRef =
      "${{ github.event_name == 'workflow_run' && github.event.workflow_run.head_sha"
      + " || github.event_name == 'release' && github.event.release.tag_name"
      + ' || inputs.release_tag || github.ref }}';

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
