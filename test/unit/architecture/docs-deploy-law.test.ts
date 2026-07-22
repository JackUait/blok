/**
 * Architectural enforcement: the docs deploy must fail if prerendering silently
 * regresses to a shell, and it must be reachable without a release.
 *
 * Two incidents motivate this. First: the docs site shipped for months as a
 * client-rendered SPA whose deployed HTML was an empty `<div id="root">` — a
 * deep link answered 200 with no prose in the body, so every crawler that does
 * not execute JavaScript (which is all of them except Googlebot and Applebot)
 * saw nothing. The fix was React Router's `prerender`, which writes a real HTML
 * file per URL. But a prerender regression is INVISIBLE from CI: the build still
 * succeeds, the files still exist, they are just empty again — so the guard has
 * to be an assertion on the built artifact, in the job that builds it.
 * Second: `verify-release` checks that the npm package family for a release tag
 * is published. That question is meaningless for a docs-only change, and a
 * skipped `needs` job skips its dependents by default, so the docs deploy has to
 * accept `skipped` explicitly or content changes can never ship on their own.
 *
 * The law: the build job asserts, BEFORE uploading, that a known prerendered
 * page carries real markup and that robots.txt and sitemap.xml are in the
 * artifact; and no job outside RELEASE_GATED_JOBS may be gated on a release
 * event. Unit tests cannot see `docs/dist` (it does not exist during a unit
 * run), so the assertion lives in the workflow and this law asserts the workflow
 * still carries it — the same YAML-parsing pattern as `ci-critical-path-law.test.ts`.
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
    push?: { branches?: string[]; paths?: string[] };
    release?: { types?: string[] };
    workflow_dispatch?: null;
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

/**
 * Jobs allowed to run only for a `release` event, each with the written reason
 * it cannot also gate an ordinary docs deploy. An empty reason fails the test
 * below, so nothing is ever release-gated silently.
 */
const RELEASE_GATED_JOBS: Record<string, string> = {
  'verify-release':
    'Asserts the npm package family matching the release tag is published, so the docs never ' +
    'advertise a version nobody can install. There is no tag on a docs-only push, so the check ' +
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
  it('triggers on a docs push and on demand, not only on a release', () => {
    expect(workflow.on?.push?.paths, 'a docs-only change must be able to deploy itself').toContain('docs/**');
    expect(workflow.on).toHaveProperty('workflow_dispatch');
  });

  it('gates only the exempted jobs on a release event', () => {
    const releaseGated = Object.entries(workflow.jobs)
      .filter(([, job]) => job.if?.includes("github.event_name == 'release'"))
      .map(([id]) => id)
      .sort();

    expect(
      releaseGated,
      'a job gated on `release` blocks every docs-only deploy unless it is listed in ' +
        'RELEASE_GATED_JOBS with the reason it is release-only',
    ).toEqual(Object.keys(RELEASE_GATED_JOBS).sort());
  });

  it('carries a non-empty reason for every release-gated job', () => {
    const unjustified = Object.entries(RELEASE_GATED_JOBS)
      .filter(([, reason]) => reason.trim().length === 0)
      .map(([id]) => id);

    expect(unjustified, 'every release gate must state why it cannot run on a docs push').toEqual([]);
  });

  it('lets the build proceed when the release-only job is skipped', () => {
    // GitHub skips a job whose `needs` were skipped, so without this the docs
    // deploy would be dead on every push that is not a release.
    for (const id of Object.keys(RELEASE_GATED_JOBS)) {
      expect(
        build.if,
        `build must accept a skipped ${id}, or a docs-only change can never deploy`,
      ).toContain(`needs.${id}.result == 'skipped'`);
    }
  });

  it('deploys only what the build verified', () => {
    expect(getJob('deploy').needs).toBe('build');
  });

  it('publishes when the build succeeded despite an upstream skip', () => {
    // GitHub propagates a skip TRANSITIVELY: `verify-release` is skipped on a
    // docs push, so `deploy` is skipped too — even though `build` overrode the
    // propagation for itself and ran to green. Observed on run 29891179538
    // (commit f4d5fd05): docs-tests success, build success, deploy SKIPPED, and
    // the last real publish stayed at tag v1.3.0. Every docs deploy since the
    // build was ungated has built, verified its artifact, and published nothing.
    // Overriding the condition one level deep is not enough; the terminal job
    // needs it too.
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
