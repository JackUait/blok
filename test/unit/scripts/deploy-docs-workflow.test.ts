import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Workflow {
  concurrency?: Record<string, unknown>;
  on: Record<string, unknown>;
  jobs: Record<string, {
    environment?: Record<string, string>;
    if?: string;
    needs?: string | string[];
    outputs?: Record<string, string>;
    permissions?: Record<string, string>;
    'timeout-minutes'?: number;
    steps?: Array<{
      env?: Record<string, unknown>;
      id?: string;
      name?: string;
      run?: string;
      uses?: string;
      with?: Record<string, unknown>;
    }>;
  }>;
}

const source = readFileSync(join(__dirname, '../../../.github/workflows/deploy-docs.yml'), 'utf-8');
const workflow = parse(source) as Workflow;

const stepNamed = (job: string, name: string) =>
  workflow.jobs[job].steps?.find((step) => step.name === name);

// release-server.yml publishes with GITHUB_TOKEN, which triggers no `release`
// run, then dispatches this workflow with release_tag. Both paths carry the tag.
const RELEASE_TAG = 'github.event.release.tag_name || inputs.release_tag';

type Context = { event: { release?: { tag_name: string } }; inputs: { release_tag?: string } };

/** Resolves an `a || b || 'literal'` chain the way GitHub does: first non-empty operand. */
const firstTruthy = (chain: string, context: Context): string => {
  for (const operand of chain.split(' || ')) {
    const values: Record<string, string | undefined> = {
      'github.event.release.tag_name': context.event.release?.tag_name,
      'inputs.release_tag': context.inputs.release_tag,
    };
    const value = /^'(.*)'$/.exec(operand)?.[1] ?? values[operand];

    if (value) return value;
  }

  return '';
};

const mainPush: Context = { event: {}, inputs: {} };
const dispatched = (tag: string): Context => ({ event: {}, inputs: { release_tag: tag } });

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
        dry_run: {
          description: 'Build and verify the site without deploying it',
          required: false,
          type: 'boolean',
          default: false,
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
    expect(workflow.jobs.build.needs).toEqual(['docs-tests', 'verify-release', 'snapshot']);
    // A skipped `needs` job skips its dependents unless the dependent accepts it.
    expect(workflow.jobs.build.if).toBe(
      '${{ !cancelled()'
      + " && needs.docs-tests.result == 'success'"
      + " && (needs.verify-release.result == 'success' || needs.verify-release.result == 'skipped')"
      + " && (needs.snapshot.result == 'success' || needs.snapshot.result == 'skipped')"
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
        // A push to main lands before release-server.yml publishes NuGet, the
        // release assets and the image, so only the npm family is verifiable there.
        + 'if [ -n "$RELEASE_TAG" ]; then\n'
        + '  node scripts/verify-docs-release.mjs "$tag"\n'
        + 'else\n'
        + '  node scripts/verify-docs-release.mjs "$tag" --packages-only\n'
        + 'fi\n',
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
    expect(stepNamed('build', 'Assemble versioned site')?.run).toContain('cp CHANGELOG.md site/CHANGELOG.md');
  });

  it('deploys only the release-gated build artifact', () => {
    expect(workflow.jobs.deploy.needs).toBe('build');
  });

  // Pages drops a deployment whose build version it already served, and
  // deploy-pages always sends GITHUB_SHA: the release dispatch after a main
  // push on the same commit published nothing (v1.15.2, v1.16.0).
  it('deploys with a build version made for the run, not with actions/deploy-pages', () => {
    const job = workflow.jobs.deploy;
    const deploy = job.steps?.find((step) => step.id === 'deployment');
    const checkout = job.steps?.find((step) => step.name === 'Checkout code');
    const upload = stepNamed('build', 'Upload Pages artifact');

    expect(source).not.toContain('actions/deploy-pages@');
    // exec: a cancelled run signals the shell, which would not pass it on, and
    // the script's handler cancels the Pages deployment.
    expect(deploy?.run).toBe('exec node scripts/deploy-pages.mjs');
    expect(deploy?.env).toEqual({
      GH_TOKEN: '${{ github.token }}',
      ARTIFACT_ID: '${{ needs.build.outputs.artifact_id }}',
    });
    expect(workflow.jobs.build.outputs?.artifact_id).toBe(`\${{ steps.${upload?.id ?? 'missing'}.outputs.artifact_id }}`);
    // Writes the build-version commit; it creates no ref.
    expect(job.permissions).toEqual({ contents: 'write', pages: 'write', 'id-token': 'write' });
    expect(job.environment).toEqual({ name: 'github-pages', url: '${{ steps.deployment.outputs.page_url }}' });
    expect(checkout?.with).toMatchObject({ 'persist-credentials': false });
  });

  // The runner rewrites GITHUB_* after reading a step's env, so this looks
  // like a fix in the log and changes nothing.
  it('never tries to override GITHUB_SHA through env', () => {
    const envs = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []).map((step) => step.env ?? {});

    expect(envs.filter((env) => 'GITHUB_SHA' in env)).toEqual([]);
  });

  it('snapshots only stable releases, from the release tag with full history', () => {
    const job = workflow.jobs.snapshot;
    const checkout = job.steps?.find((step) => step.name === 'Checkout code');
    const build = job.steps?.find((step) => step.name === 'Build snapshots');
    const upload = job.steps?.find((step) => step.name === 'Attach snapshots to the release');

    expect(job.if).toBe(
      `(${RELEASE_TAG}) != ''`
      + ' && !github.event.release.prerelease'
      + ` && !contains(${RELEASE_TAG}, '-')`,
    );
    expect(job.needs).toEqual(['docs-tests', 'verify-release']);
    expect(job.permissions).toEqual({ contents: 'write' });
    expect(job['timeout-minutes']).toBe(7);
    expect(checkout?.with).toMatchObject({
      ref: `\${{ ${RELEASE_TAG} }}`,
      // Tags older than the lastmod ledger date pages from `git log`; a shallow
      // tag checkout collapses every lastmod to the release date.
      'fetch-depth': 0,
      'persist-credentials': false,
    });
    expect(build?.env).toBeUndefined();
    expect(build?.run).toContain('yarn build\n');
    expect(build?.run).toContain('node docs/scripts/build-snapshot.mjs --version "$minor" --base / --out docs-root.tgz');
    expect(build?.run).toContain(
      'node docs/scripts/build-snapshot.mjs --version "$minor" --base "/v/$minor/" --out "docs-v$minor.tgz"',
    );
    expect(build?.run).toContain('echo "minor=$minor" >> "$GITHUB_OUTPUT"');
    expect(upload?.env).toEqual({
      GH_TOKEN: '${{ github.token }}',
      GH_REPO: '${{ github.repository }}',
      TAG: `\${{ ${RELEASE_TAG} }}`,
      MINOR: `\${{ steps.${build?.id ?? 'missing'}.outputs.minor }}`,
    });
    expect(upload?.run).toBe('gh release upload "$TAG" docs-root.tgz "docs-v$MINOR.tgz" --clobber\n');
  });

  it('snapshots a stable release that release-server dispatches', () => {
    const gate = workflow.jobs.snapshot.if ?? '';

    // Nothing in the gate may require the `release` event itself.
    expect(gate).not.toContain('github.event_name');
    expect(gate).toContain(`(${RELEASE_TAG}) != ''`);
    expect(firstTruthy(RELEASE_TAG, dispatched('v1.16.0'))).toBe('v1.16.0');
    expect(firstTruthy(RELEASE_TAG, dispatched('v1.16.0')).includes('-')).toBe(false);
  });

  it('never snapshots a dispatched beta tag', () => {
    const gate = workflow.jobs.snapshot.if ?? '';

    // release-server dispatches every v* tag; a beta has no `prerelease` flag
    // on that path, so the tag's `-` is the only thing that keeps it off root.
    expect(gate).toContain(`!contains(${RELEASE_TAG}, '-')`);
    expect(firstTruthy(RELEASE_TAG, dispatched('v1.16.0-beta.1')).includes('-')).toBe(true);
  });

  it('assembles root, next and archives into one site and publishes that', () => {
    const next = stepNamed('build', 'Build next snapshot');
    const assemble = stepNamed('build', 'Assemble versioned site');
    const upload = stepNamed('build', 'Upload Pages artifact');

    expect(stepNamed('build', 'Build docs')).toBeUndefined();
    expect(next?.run).toBe('node docs/scripts/build-snapshot.mjs --version next --base /next/ --out next.tgz\n');
    expect(assemble?.env).toEqual({
      GH_TOKEN: '${{ github.token }}',
      GH_REPO: '${{ github.repository }}',
    });
    expect(assemble?.run).toBe(
      'node docs/scripts/assemble-site.mjs --next next.tgz --out site --sources site-sources.json\n'
      + 'cp CHANGELOG.md site/CHANGELOG.md\n',
    );
    expect(upload?.with?.path).toBe('site/');
  });

  it('verifies the assembled site before publishing it', () => {
    const run = stepNamed('build', 'Verify deploy artifact')?.run ?? '';

    for (const check of [
      'test -f site/next/docs/quick-start/index.html',
      "grep -q 'noindex' site/next/docs/quick-start/index.html",
      'test -s site/versions.json',
      'if [ -n "$archive" ]; then test -f "site${archive}index.html"; grep -q \'noindex\' "site${archive}index.html"; fi',
      'test -s site/robots.txt',
      'test -s site/sitemap.xml',
    ]) {
      expect(run).toContain(check);
    }
    // `set -e` ignores a `!` command, so the negated check is a plain if/exit.
    expect(run).not.toMatch(/^\s*!/m);
    expect(run).toContain("if grep -q 'noindex' site/docs/quick-start/index.html; then");
  });

  it('takes the deploy marker from the next build, which changes on every main push', () => {
    const run = stepNamed('build', 'Record deploy marker')?.run ?? '';

    expect(run).toContain("find site/next/assets -name 'client-*.js' -print -quit");
    expect(run).toContain('echo "path=/${asset#site/}" >> "$GITHUB_OUTPUT"');
  });

  it('skips deploy and the live check on a dry run without breaking the skip guard', () => {
    expect(workflow.jobs.deploy.if).toBe(
      "${{ !cancelled() && needs.build.result == 'success' && !inputs.dry_run }}",
    );
    expect(workflow.jobs['seo-smoke'].if).toBe(
      "${{ !cancelled() && needs.deploy.result == 'success' && !inputs.dry_run }}",
    );
  });

  it('keeps release runs out of the group a main push cancels', () => {
    expect(workflow.concurrency).toEqual({
      group: `\${{ github.workflow }}-\${{ ${RELEASE_TAG} || 'deploy' }}`,
      'cancel-in-progress': true,
    });
  });

  it('gives a dispatched release its own concurrency group, apart from main pushes', () => {
    const group = workflow.concurrency?.group;
    if (typeof group !== 'string') throw new Error('deploy-docs has no concurrency group');

    const chain = /-\$\{\{ (.+) \}\}$/.exec(group)?.[1] ?? '';

    expect(firstTruthy(chain, mainPush)).toBe('deploy');
    expect(firstTruthy(chain, dispatched('v1.16.0'))).toBe('v1.16.0');
    expect(firstTruthy(chain, { event: { release: { tag_name: 'v1.16.0' } }, inputs: {} })).toBe('v1.16.0');
  });

  // Build and dependency scripts run arbitrary package code; a token in their
  // env is readable by all of it, and the release jobs hold contents: write.
  it.each(['deploy-docs.yml', 'docs-backfill.yml'])('keeps GH_TOKEN out of every build step in %s', (file) => {
    const parsed = parse(readFileSync(join(__dirname, '../../../.github/workflows', file), 'utf-8')) as Workflow;
    const buildSteps = Object.values(parsed.jobs)
      .flatMap((job) => job.steps ?? [])
      .filter((step) => /yarn build|build-snapshot\.mjs/.test(step.run ?? ''));

    expect(buildSteps.length).toBeGreaterThan(0);
    expect(buildSteps.filter((step) => step.env?.GH_TOKEN !== undefined).map((step) => step.name)).toEqual([]);
  });

  it('never interpolates expressions inside run scripts', () => {
    const runs = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []).map((step) => step.run ?? '');

    expect(runs.filter((run) => run.includes('${{'))).toEqual([]);
    expect(source).not.toMatch(/run: .*\$\{\{/);
  });
});
