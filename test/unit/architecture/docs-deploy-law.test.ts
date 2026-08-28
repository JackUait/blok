/**
 * Architectural enforcement: the docs deploy must fail if prerendering silently
 * regresses to a shell, and ordinary main deployments must use the commit that
 * CI verified.
 *
 * The law: the build job asserts, before uploading, that a known prerendered
 * page carries real markup and that robots.txt and sitemap.xml are in the
 * artifact. Main deployments start from a successful CI workflow run and every
 * checkout uses that run's exact head SHA. Release and manual deployments remain
 * available, with release verification skipped only when it does not apply.
 *
 * Unit tests cannot see `docs/dist` during a unit run, so the artifact assertion
 * lives in the workflow and this law asserts that the workflow still carries it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { PRERENDER_PATHS } from '../../../docs/src/prerender-paths';

type Step = {
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  with?: Record<string, string | number | boolean>;
};

type Job = {
  name?: string;
  needs?: string | string[];
  if?: string;
  steps?: Step[];
};

type Workflow = {
  on?: {
    workflow_run?: {
      workflows?: string[];
      types?: string[];
      branches?: string[];
    };
    release?: { types?: string[] };
    workflow_dispatch?: null | Record<string, unknown>;
  };
  jobs: Record<string, Job>;
};

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const workflow = parse(
  readFileSync(resolve(REPO_ROOT, '.github/workflows/deploy-docs.yml'), 'utf8'),
) as Workflow;

/** Where the framework build puts the site, and what the Pages job uploads. */
const ARTIFACT_ROOT = 'docs/dist/client';

/** The page the deploy probes for prose. Cross-checked against the real manifest below. */
const PRERENDER_PROBE_ROUTE = '/docs/quick-start';
const PRERENDER_PROBE_FILE = `${ARTIFACT_ROOT}${PRERENDER_PROBE_ROUTE}/index.html`;

/** Files that make the site crawlable at all, so their absence must fail the deploy. */
const REQUIRED_ARTIFACT_FILES = [`${ARTIFACT_ROOT}/robots.txt`, `${ARTIFACT_ROOT}/sitemap.xml`];

const WORKFLOW_RUN_CHECKOUT_REF =
  "${{ github.event_name == 'workflow_run' && github.event.workflow_run.head_sha"
  + " || github.event_name == 'release' && github.event.release.tag_name"
  + ' || inputs.release_tag || github.ref }}';

/**
 * Jobs allowed to run only for a `release` event, each with the written reason
 * it cannot also gate an ordinary docs deploy. An empty reason fails the test
 * below, so nothing is ever release-gated silently.
 */
const RELEASE_GATED_JOBS: Record<string, string> = {
  'verify-release':
    'Asserts the npm package family matching the release tag is published, so the docs never ' +
    'advertise a version nobody can install. There is no tag on a CI workflow run, so the check ' +
    'is meaningless there — it is skipped, and the build job accepts `skipped` so content still ships.',
};

const getJob = (id: string): Job => {
  const job = workflow.jobs[id];

  if (job === undefined) throw new Error(`Missing deploy-docs job: ${id}`);

  return job;
};

const build = getJob('build');
const buildSteps = build.steps ?? [];
const guardStep = buildSteps.find((step) => step.run?.includes(PRERENDER_PROBE_FILE));

describe('docs deploy law — the artifact is verified before it ships', () => {
  it('probes a page that is actually in the prerender manifest', () => {
    // If the route is renamed, the grep would pass against a file that no longer
    // exists — this keeps the probe honest.
    expect(
      PRERENDER_PATHS,
      `the deploy probes ${PRERENDER_PROBE_ROUTE}, which is no longer prerendered`,
    ).toContain(PRERENDER_PROBE_ROUTE);
  });

  it('fails the deploy when a known prerendered page is missing or has no prose', () => {
    expect(
      guardStep,
      `.github/workflows/deploy-docs.yml has no build step asserting ${PRERENDER_PROBE_FILE} ` +
        'was emitted with real markup. Without it, a prerender regression deploys an empty shell ' +
        'and every non-JS crawler sees nothing.',
    ).toBeDefined();

    const run = guardStep?.run ?? '';

    expect(run, 'the probe must assert the file exists').toMatch(/\btest -[fs]\b/);
    expect(run, 'the probe must assert rendered prose, not just a file').toMatch(/\bgrep\b/);
    expect(run, 'an empty shell has no <h1>: that is the cheapest prerender signal').toContain('<h1');
  });

  it('ships robots.txt and sitemap.xml inside the artifact', () => {
    const run = guardStep?.run ?? '';
    const missing = REQUIRED_ARTIFACT_FILES.filter((file) => !run.includes(file));

    expect(
      missing,
      `the deploy does not verify these are in the uploaded artifact: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('verifies before uploading, and uploads the directory it verified', () => {
    const guardIndex = buildSteps.findIndex((step) => step === guardStep);
    const uploadIndex = buildSteps.findIndex((step) => step.uses?.startsWith('actions/upload-pages-artifact'));

    expect(uploadIndex, 'the build job no longer uploads a Pages artifact').toBeGreaterThan(-1);
    expect(guardIndex, 'the artifact guard step is gone').toBeGreaterThan(-1);
    expect(guardIndex, 'a broken build must fail before it is published, not after').toBeLessThan(uploadIndex);
    expect(buildSteps[uploadIndex].with?.path).toBe(`${ARTIFACT_ROOT}/`);
  });
});

describe('docs deploy law — reachable without a release', () => {
  it('triggers from CI on main and on demand, not only on a release', () => {
    expect(workflow.on?.workflow_run).toEqual({
      workflows: ['CI'],
      types: ['completed'],
      branches: ['main'],
    });
    expect(workflow.on).toHaveProperty('workflow_dispatch');
  });

  it('requires a successful CI run before testing or building docs', () => {
    expect(getJob('docs-tests').if).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(build.if).toContain("github.event.workflow_run.conclusion == 'success'");
  });

  it('checks out the exact commit that CI verified', () => {
    for (const id of ['docs-tests', 'build']) {
      const checkout = getJob(id).steps?.find((step) => step.uses === 'actions/checkout@v4');

      expect(checkout?.with?.ref, `${id} must check out the workflow_run head SHA`).toBe(
        WORKFLOW_RUN_CHECKOUT_REF,
      );
    }
  });

  it('gates only the exempted jobs on a release event', () => {
    const releaseGated = Object.entries(workflow.jobs)
      .filter(([, job]) => job.if?.includes("github.event_name == 'release'"))
      .map(([id]) => id)
      .sort();

    expect(
      releaseGated,
      'a job gated on `release` blocks every CI deploy unless it is listed in ' +
        'RELEASE_GATED_JOBS with the reason it is release-only',
    ).toEqual(Object.keys(RELEASE_GATED_JOBS).sort());
  });

  it('carries a non-empty reason for every release-gated job', () => {
    const unjustified = Object.entries(RELEASE_GATED_JOBS)
      .filter(([, reason]) => reason.trim().length === 0)
      .map(([id]) => id);

    expect(unjustified, 'every release gate must state why it cannot run after CI').toEqual([]);
  });

  it('lets the build proceed when the release-only job is skipped', () => {
    // GitHub skips a job whose `needs` were skipped, so without this the docs
    // deploy would be dead on every push that is not a release.
    for (const id of Object.keys(RELEASE_GATED_JOBS)) {
      expect(
        build.if,
        `build must accept a skipped ${id}, or a successful CI run can never deploy`,
      ).toContain(`needs.${id}.result == 'skipped'`);
    }
  });

  it('deploys only what the build verified', () => {
    expect(getJob('deploy').needs).toBe('build');
  });

  it('publishes when the build succeeded despite an upstream skip', () => {
    // A skipped release check propagates through the dependency chain unless
    // the terminal deploy job accepts a successful build explicitly.
    expect(
      getJob('deploy').if,
      'deploy must override the transitive skip, or a green docs build publishes nothing',
    ).toContain("needs.build.result == 'success'");
  });
});

describe('docs deploy law — non-vacuity floor', () => {
  // Guards against a workflow rename, a YAML parse that returns an empty
  // document, or a build job stripped down to nothing.
  it('parses a workflow with every deploy job present', () => {
    expect(Object.keys(workflow.jobs).sort()).toEqual(['build', 'deploy', 'docs-tests', 'verify-release']);
  });

  it('reads a build job with its full step list', () => {
    expect(buildSteps.length).toBeGreaterThanOrEqual(6);
    expect(buildSteps.filter((step) => step.run !== undefined).length).toBeGreaterThanOrEqual(3);
  });

  it('resolves a prerender manifest with real routes', () => {
    expect(PRERENDER_PATHS.length).toBeGreaterThanOrEqual(60);
  });
});
