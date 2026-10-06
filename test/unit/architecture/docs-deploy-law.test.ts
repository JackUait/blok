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
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { PRERENDER_PATHS } from '../../../docs/src/prerender-paths';

type Step = {
  id?: string;
  'working-directory'?: string;
  'continue-on-error'?: boolean;
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  with?: Record<string, string | number | boolean>;
  env?: Record<string, string>;
};

type Job = {
  name?: string;
  needs?: string | string[];
  if?: string;
  outputs?: Record<string, string>;
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

/** Where assemble-site.mjs puts the versioned site, and what the Pages job uploads. */
const ARTIFACT_ROOT = 'site';

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
    'Asserts the package family matching the release tag is published, so the docs never ' +
    'advertise a version nobody can install. A CI workflow run carries no tag, so it checks the ' +
    'npm family only (`--packages-only`): release-server.yml publishes NuGet, the release assets ' +
    'and the image after waiting for that same CI run, so the server half cannot be satisfied ' +
    'yet. The release and dispatch paths carry a tag and check everything. The build job accepts ' +
    '`skipped` so content still ships.',
  snapshot:
    'Builds the root and archive snapshots of a stable release and attaches them to that ' +
    'release, which is where the build job downloads them from. It runs for the release event ' +
    'and for the release_tag dispatch that release-server.yml sends. A CI run has no release to ' +
    'attach to; it rebuilds only /next/ and reuses the published snapshots. The build job ' +
    'accepts `skipped` so content still ships.',
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
      const checkout = getJob(id).steps?.find((step) => step.name === 'Checkout code');

      expect(checkout?.with?.ref, `${id} must check out the workflow_run head SHA`).toBe(
        WORKFLOW_RUN_CHECKOUT_REF,
      );
    }
  });

  it('gates only the exempted jobs on a release event', () => {
    const releaseGated = Object.entries(workflow.jobs)
      // release-server.yml dispatches releases, so a gate may key on the tag alone.
      .filter(([, job]) => /github\.event_name == 'release'|github\.event\.release\.|inputs\.release_tag/.test(job.if ?? ''))
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

  // Page dates come from docs/src/seo/lastmod-ledger.json, a committed file. The
  // build job builds main, which has the ledger, and reads git only through
  // `rev-parse HEAD` and `ls-files`, which a depth-1 clone answers.
  it('does not fetch history the build job never reads', () => {
    const checkout = build.steps?.find((step) => step.name === 'Checkout code');

    expect(checkout?.with?.['fetch-depth'], 'the build job fetches full history it does not use').toBeUndefined();
  });

  // The snapshot job builds a release TAG with that tag's own scripts. Every tag
  // older than the ledger dates pages by `git log -1`, and a release_tag
  // dispatch can rebuild any of them; a shallow clone collapses their lastmod.
  it('checks out full history for tags that still date pages from git', () => {
    const checkout = getJob('snapshot').steps?.find((step) => step.name === 'Checkout code');

    expect(checkout?.with?.['fetch-depth']).toBe(0);
  });

  // The backfill builds the root snapshot the live site serves until the next
  // stable release, so its tag checkout needs the same history.
  it('backfills root snapshots from a full-history tag checkout', () => {
    const backfill = parse(
      readFileSync(resolve(REPO_ROOT, '.github/workflows/docs-backfill.yml'), 'utf8'),
    ) as Workflow;
    const tagCheckout = backfill.jobs.snapshot?.steps?.find(
      (step) => step.uses?.startsWith('actions/checkout') && step.with?.path === 'tag',
    );

    expect(tagCheckout, 'docs-backfill no longer checks out the tag into tag/').toBeDefined();
    expect(tagCheckout?.with?.['fetch-depth']).toBe(0);
    expect(tagCheckout?.with?.['persist-credentials']).toBe(false);
  });

  // Everything else here checks bytes on the runner. Neither of the two worst
  // SEO defects this repo shipped — a sitemap whose 148 lastmod values were all
  // identical, and three days of deploys that published nothing — was visible
  // to any of it. Only a request to the host catches those.
  it('verifies the live site after publishing it', () => {
    const smoke = getJob('seo-smoke');

    expect(smoke.needs, 'the smoke test must run after the deploy, not beside it').toContain('deploy');
    expect(
      smoke.steps?.some((step) => step.run?.includes('verify-live-docs.mjs')),
      'seo-smoke no longer runs the live verification script',
    ).toBe(true);
  });

  it('gives the smoke test a marker unique to the build it just published', () => {
    // A 200 on `/` is true throughout an outage; only an asset from this exact
    // build distinguishes "the site is up" from "this deploy is live".
    expect(build.outputs?.marker).toBeDefined();
    expect(
      getJob('seo-smoke').steps?.some((step) => step.env?.DEPLOY_MARKER !== undefined),
      'the smoke test is not told which build to wait for',
    ).toBe(true);
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

/** Where the deploy writes what it built, and what verify-live-docs.mjs compares the host against. */
const BUILD_INFO_FILE = `${ARTIFACT_ROOT}/build-info.json`;
const LIVE_REPORT = 'live-docs-report.json';
const AUDIT_REPORT = 'docs-build-audit.json';

const stepIndex = (steps: Step[], match: (step: Step) => boolean): number => steps.findIndex(match);

describe('docs deploy law — the live site is proven to be the build just deployed', () => {
  const buildInfoStep = buildSteps.find((step) => step.run?.includes(`node scripts/docs-build-info.mjs ${ARTIFACT_ROOT}`));
  const smoke = getJob('seo-smoke');
  const verifyStep = smoke.steps?.find((step) => step.run?.includes('verify-live-docs.mjs'));

  it('records build-info.json into the artifact before verifying and uploading it', () => {
    expect(buildInfoStep, `the build job does not write ${BUILD_INFO_FILE}`).toBeDefined();
    expect(buildInfoStep?.id, 'the build-info step needs an id so its outputs can be read').toBeTruthy();

    const assemble = stepIndex(buildSteps, (step) => step.run?.includes('assemble-site.mjs') ?? false);
    const info = stepIndex(buildSteps, (step) => step === buildInfoStep);
    const guard = stepIndex(buildSteps, (step) => step === guardStep);
    const upload = stepIndex(buildSteps, (step) => step.uses?.startsWith('actions/upload-pages-artifact') ?? false);

    // The manifest hash covers every page, so nothing may write into the site after it.
    expect(info, 'build info must be taken after the site is fully assembled').toBeGreaterThan(assemble);
    expect(info, 'build info must exist before the artifact guard runs').toBeLessThan(guard);
    expect(guard).toBeLessThan(upload);
    expect(guardStep?.run, 'the artifact guard must check build-info.json shipped').toContain(`test -s ${BUILD_INFO_FILE}`);
  });

  it('hands the built SHA, manifest hash and proof path to the live check', () => {
    const id = buildInfoStep?.id ?? 'missing';

    expect(build.outputs?.build_sha).toBe(`\${{ steps.${id}.outputs.sha }}`);
    expect(build.outputs?.manifest_hash).toBe(`\${{ steps.${id}.outputs.manifest }}`);
    expect(build.outputs?.build_info_path).toBe(`\${{ steps.${id}.outputs.proof }}`);
    expect(verifyStep?.env).toMatchObject({
      EXPECTED_BUILD_SHA: '${{ needs.build.outputs.build_sha }}',
      EXPECTED_MANIFEST_HASH: '${{ needs.build.outputs.manifest_hash }}',
      EXPECTED_BUILD_INFO_PATH: '${{ needs.build.outputs.build_info_path }}',
    });
  });

  it('enforces the expected build in the verifier the workflow runs', () => {
    // The env names above are only a contract if the script reads them.
    const verifier = readFileSync(resolve(REPO_ROOT, 'scripts/verify-live-docs.mjs'), 'utf8');

    expect(verifier).toContain('process.env.EXPECTED_BUILD_SHA');
    expect(verifier).toContain('process.env.EXPECTED_MANIFEST_HASH');
    expect(verifier).toContain('process.env.EXPECTED_BUILD_INFO_PATH');
    expect(verifier).toContain('awaitBuildInfo(');
  });

  it('makes the build-info check mandatory in CI, so empty outputs cannot skip it', () => {
    expect(verifyStep?.run).toContain('--require-build-info');
  });

  it('ships the proof file the live check polls, named uniquely for this run', () => {
    // The CDN ignores query strings and caches 200s and 404s, so only a name
    // no earlier deploy used is guaranteed fresh. A manifest-named file is
    // reused by any deploy with the same bytes.
    expect(guardStep?.env?.PROOF).toBe(`\${{ steps.${buildInfoStep?.id ?? 'missing'}.outputs.proof }}`);
    expect(guardStep?.run).toContain('test -s "site$PROOF"');
    expect(guardStep?.run).not.toContain('.manifestHash');
  });

  it('crawls the whole sitemap and keeps the report even when the check fails', () => {
    expect(verifyStep?.run).toContain('--crawl');
    expect(verifyStep?.run).toContain(`--report ${LIVE_REPORT}`);

    const upload = smoke.steps?.find((step) => step.uses?.startsWith('actions/upload-artifact@'));

    expect(upload?.with?.path).toBe(LIVE_REPORT);
    expect(upload?.if, 'a failed crawl is exactly when the report matters').toBe('${{ !cancelled() }}');
  });
});

describe('docs deploy law — the indexed snapshot is audited before it is attached', () => {
  const snapshotSteps = getJob('snapshot').steps ?? [];
  const buildStep = snapshotSteps.find((step) => step.name === 'Build snapshots');
  const run = buildStep?.run ?? '';

  it('audits the root build, after it is built and before the archive build wipes it', () => {
    const audit = run.indexOf(`node docs/scripts/audit-build-output.mjs --report ${AUDIT_REPORT}`);
    const root = run.indexOf('--base / --out docs-root.tgz');
    const archive = run.indexOf('--base "/v/$minor/"');

    expect(audit, 'the snapshot job does not audit the root build').toBeGreaterThan(-1);
    expect(audit).toBeGreaterThan(root);
    expect(audit, 'build-snapshot.mjs deletes docs/dist before each build').toBeLessThan(archive);
  });

  it('uploads the audit report even when the audit fails', () => {
    const upload = snapshotSteps.find((step) => step.uses?.startsWith('actions/upload-artifact@'));

    expect(upload?.with?.path).toBe(AUDIT_REPORT);
    expect(upload?.if).toBe('${{ !cancelled() }}');
    expect(stepIndex(snapshotSteps, (step) => step === upload)).toBeGreaterThan(
      stepIndex(snapshotSteps, (step) => step === buildStep),
    );
  });

  it('runs scripts that exist', () => {
    for (const file of ['docs/scripts/audit-build-output.mjs', 'scripts/docs-build-info.mjs', 'scripts/verify-live-docs.mjs']) {
      expect(existsSync(resolve(REPO_ROOT, file)), `${file} is missing`).toBe(true);
    }
  });
});

describe('docs deploy law — every deploying build is audited', () => {
  const NEXT_REPORT = 'docs-build-audit-next.json';

  it('audits the /next/ snapshot by the snapshot rules before the artifact is uploaded', () => {
    const audit = stepIndex(buildSteps, (step) => step.run?.includes('node docs/scripts/audit-build-output.mjs') ?? false);
    const auditStep = buildSteps[audit];

    expect(auditStep?.run).toContain(`node docs/scripts/audit-build-output.mjs --dir ${ARTIFACT_ROOT} --base /next/ --report ${NEXT_REPORT}`);
    expect(auditStep, 'a failing audit must fail the build, which gates deploy').not.toHaveProperty('continue-on-error');
    expect(audit).toBeGreaterThan(stepIndex(buildSteps, (step) => step.run?.includes('assemble-site.mjs') ?? false));
    expect(audit).toBeLessThan(stepIndex(buildSteps, (step) => step.uses?.startsWith('actions/upload-pages-artifact') ?? false));

    const upload = buildSteps.find((step) => step.uses?.startsWith('actions/upload-artifact@') && step.with?.path === NEXT_REPORT);

    expect(upload?.if, 'a failed audit is exactly when the report matters').toBe('${{ !cancelled() }}');
    expect(stepIndex(buildSteps, (step) => step === upload)).toBeGreaterThan(audit);
  });

  it('audits a backfilled root snapshot before attaching it', () => {
    const backfill = parse(
      readFileSync(resolve(REPO_ROOT, '.github/workflows/docs-backfill.yml'), 'utf8'),
    ) as Workflow;
    const steps = backfill.jobs.snapshot?.steps ?? [];
    const buildStep = steps.find((step) => step.id === 'snapshots');
    const run = buildStep?.run ?? '';
    const root = run.indexOf('--base / --out docs-root.tgz');
    const audit = run.indexOf(`node docs/scripts/audit-build-output.mjs --report ${AUDIT_REPORT}`);

    expect(audit, 'the backfill does not audit the root build').toBeGreaterThan(-1);
    // build-snapshot.mjs deletes docs/dist before each build, so the audit must follow the root one.
    expect(audit).toBeGreaterThan(root);
    expect(run.slice(root, audit)).not.toContain('build-snapshot.mjs');
    expect(buildStep?.['working-directory']).toBe('tag');

    const upload = steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'));

    expect(upload?.with?.path).toBe(`tag/${AUDIT_REPORT}`);
    // One artifact per matrix job; a shared name collides.
    expect(upload?.with?.name).toContain('${{ matrix.tag }}');
    expect(upload?.if).toBe('${{ !cancelled() }}');
    expect(stepIndex(steps, (step) => step === upload)).toBeGreaterThan(stepIndex(steps, (step) => step === buildStep));
    expect(stepIndex(steps, (step) => step.name === 'Attach snapshots to the release')).toBeGreaterThan(
      stepIndex(steps, (step) => step === buildStep),
    );
  });
});

describe('docs deploy law — non-vacuity floor', () => {
  // Guards against a workflow rename, a YAML parse that returns an empty
  // document, or a build job stripped down to nothing.
  it('parses a workflow with every deploy job present', () => {
    expect(Object.keys(workflow.jobs).sort()).toEqual([
      'build',
      'deploy',
      'docs-tests',
      'seo-smoke',
      'snapshot',
      'verify-release',
    ]);
  });

  it('reads a build job with its full step list', () => {
    expect(buildSteps.length).toBeGreaterThanOrEqual(6);
    expect(buildSteps.filter((step) => step.run !== undefined).length).toBeGreaterThanOrEqual(3);
  });

  it('resolves a prerender manifest with real routes', () => {
    expect(PRERENDER_PATHS.length).toBeGreaterThanOrEqual(60);
  });
});
