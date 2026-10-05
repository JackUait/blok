#!/usr/bin/env node
// Post-deploy smoke test: asserts what the HOST serves, not what the build
// produced. Every check below is something a local test cannot see — status
// codes, redirects, and whether the deploy actually reached the edge.
//
// It exists because the two worst SEO defects this repo has shipped were both
// invisible to the unit suite: a sitemap whose 148 `lastmod` values were all
// identical (shallow CI clone), and three days of deploys that published
// nothing at all.
//
// Usage: verify-live-docs.mjs [site] [--crawl] [--report <file.json>] [--concurrency <n>] [--require-build-info]
//        verify-live-docs.mjs [site] --status   (which commit is live, how far behind main)
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { awaitBuildInfo, crawlUrls, deployLag, runWithReport } from './live-docs-checks.mjs';
import { firstArchivePath, versionedSitemapUrls } from './live-docs-versions.mjs';

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    crawl: { type: 'boolean', default: false },
    report: { type: 'string' },
    concurrency: { type: 'string', default: '4' },
    status: { type: 'boolean', default: false },
    'require-build-info': { type: 'boolean', default: false },
  },
});

const SITE = (positionals[0] ?? 'https://blokeditor.com').replace(/\/$/, '');

const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Bounded so a stalled connection fails the check instead of hanging the job.
const fetchNoRedirect = (url) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });

const failures = [];
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}: ${detail}`);
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : ` — ${detail}`}\n`);
};

/**
 * Waits for the new build, not merely for the site to answer.
 *
 * A 200 on `/` proves nothing: the stale deploy answered 200 throughout the
 * three-day outage. The marker is a content-hashed asset from the artifact just
 * built, which only exists once this deploy is live. Its path was never
 * requested before, so the CDN has no stale copy; the query string does not
 * bust the cache (the edge drops it from the key).
 */
const awaitDeployment = async (marker, attempts = 20, delayMs = 15_000) => {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetchNoRedirect(`${SITE}${marker}?cb=${Date.now()}-${attempt}`);
    if (response.status === 200) return;
    process.stdout.write(`waiting for ${marker} (attempt ${attempt}, got ${response.status})\n`);
    await waitFor(delayMs);
  }
  throw new Error(`${marker} never became available; the deploy did not reach the edge`);
};

const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const readLiveBuildInfo = async () => {
  const response = await fetchNoRedirect(`${SITE}/build-info.json?cb=${Date.now()}`);
  if (response.status !== 200) return { info: null, problem: `build-info.json answered ${response.status}` };
  try {
    return { info: JSON.parse(await response.text()), problem: null };
  } catch {
    return { info: null, problem: 'build-info.json is not JSON' };
  }
};

const printLag = (info) => {
  const lag = deployLag(info.sha, git);
  process.stdout.write(
    `live: ${info.sha} (version ${info.version}, root snapshot ${info.root}, built ${info.builtAt}, run ${info.runId})\n`
    + (lag.behind === null
      ? `lag:  unknown — ${lag.error}\n`
      : `lag:  ${lag.behind} commit(s) behind origin/main ${lag.mainSha} (git fetch first for current numbers)\n`),
  );
  return lag;
};

/** --status: tell a maintainer what is live without running the checks. */
const status = async () => {
  const { info, problem } = await readLiveBuildInfo();
  if (info) {
    printLag(info);
    process.stdout.write('note: /build-info.json can lag a new deploy by up to the CDN TTL (max-age=600).\n');
    return;
  }
  const home = await fetchNoRedirect(`${SITE}/`);
  process.stdout.write(
    `live: unknown — ${problem}; the deploy predates build-info.json. `
    + `${SITE}/ last-modified: ${home.headers.get('last-modified')}\n`,
  );
};

const checks = async (report) => {
  const marker = process.env.DEPLOY_MARKER;
  if (marker) await awaitDeployment(marker);

  // Set by the deploy workflow from the artifact it just uploaded. Without
  // them (a local run) build info is reported, not enforced. CI passes
  // --require-build-info so empty outputs fail instead of skipping the check.
  const expected = {
    sha: process.env.EXPECTED_BUILD_SHA ?? '',
    manifestHash: process.env.EXPECTED_MANIFEST_HASH ?? '',
  };
  if (options['require-build-info'] && (!expected.sha || !expected.manifestHash)) {
    throw new Error('--require-build-info: EXPECTED_BUILD_SHA and EXPECTED_MANIFEST_HASH must both be set');
  }
  if (expected.sha || expected.manifestHash) {
    try {
      // The marker poll above already waited for the deploy; this covers CDN
      // lag on one file. Sized with the crawl deadline to fit timeout-minutes: 10.
      report.buildInfo = await awaitBuildInfo({ site: SITE, expected, attempts: 6, timeoutMs: 10_000 });
      check('live build info matches the artifact just built', true, '');
    } catch (error) {
      check('live build info matches the artifact just built', false, error.message);
    }
  } else {
    const { info, problem } = await readLiveBuildInfo();
    report.buildInfo = info;
    if (!info) process.stdout.write(`note  no build info: ${problem}\n`);
  }
  if (report.buildInfo?.sha) report.lag = printLag(report.buildInfo);

  const home = await fetchNoRedirect(`${SITE}/`);
  check('home answers 200', home.status === 200, `got ${home.status}`);
  const homeHtml = await home.text();
  check('home renders prose server-side', homeHtml.includes('<h1'), 'no <h1> in the served HTML');
  check(
    'home self-canonicalises',
    homeHtml.includes(`<link rel="canonical" href="${SITE}/"`),
    'canonical missing or pointing elsewhere',
  );

  // GitHub Pages serves `<path>/` and 301s `<path>`. Every advertised URL uses
  // the slash form, so this asserts the redirect goes the way the canonical does.
  const slashless = await fetchNoRedirect(`${SITE}/docs/quick-start`);
  check(
    'slashless path redirects once onto the canonical form',
    slashless.status === 301 && slashless.headers.get('location') === `${SITE}/docs/quick-start/`,
    `got ${slashless.status} -> ${slashless.headers.get('location')}`,
  );

  const canonical = await fetchNoRedirect(`${SITE}/docs/quick-start/`);
  check('canonical target answers 200 directly', canonical.status === 200, `got ${canonical.status}`);

  // A static host that answers 200 for an unknown path is the textbook soft 404.
  const missing = await fetchNoRedirect(`${SITE}/definitely-not-a-page-${Date.now()}/`);
  check('unknown path is a real 404', missing.status === 404, `got ${missing.status}`);

  for (const [name, url] of [
    ['http', `http://${SITE.replace(/^https:\/\//, '')}/`],
    ['www', SITE.replace('https://', 'https://www.') + '/'],
  ]) {
    const response = await fetchNoRedirect(url);
    check(
      `${name} redirects to the canonical host`,
      response.status === 301 && response.headers.get('location') === `${SITE}/`,
      `got ${response.status} -> ${response.headers.get('location')}`,
    );
  }

  const sitemapResponse = await fetchNoRedirect(`${SITE}/sitemap.xml`);
  check('sitemap answers 200', sitemapResponse.status === 200, `got ${sitemapResponse.status}`);
  const sitemap = await sitemapResponse.text();
  const locs = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(([, loc]) => loc);
  check('sitemap lists URLs', locs.length > 0, 'no <loc> entries');
  check(
    'every sitemap URL is absolute and trailing-slash',
    locs.every((loc) => loc.startsWith(`${SITE}/`) && loc.endsWith('/')),
    `offenders: ${locs.filter((loc) => !loc.startsWith(`${SITE}/`) || !loc.endsWith('/')).slice(0, 3).join(', ')}`,
  );

  // The canary for a shallow CI clone. `lastmod` collapses to one value when the
  // generator has no git history to date each page from, and Google discards a
  // `lastmod` it cannot verify — silently, which is why this needs a test.
  const lastmods = new Set([...sitemap.matchAll(/<lastmod>(.*?)<\/lastmod>/g)].map(([, d]) => d));
  check(
    'sitemap dates are per-page, not the deploy date',
    lastmods.size > 1,
    `all ${locs.length} URLs share lastmod ${[...lastmods][0]} — the deploy checkout is shallow`,
  );

  const versioned = versionedSitemapUrls(sitemap);
  check(
    'sitemap lists no /next/ or /v/ URL',
    versioned.length === 0,
    `offenders: ${versioned.slice(0, 3).join(', ')}`,
  );

  const versionsResponse = await fetchNoRedirect(`${SITE}/versions.json`);
  check('versions.json answers 200', versionsResponse.status === 200, `got ${versionsResponse.status}`);
  let manifest = null;
  try {
    manifest = JSON.parse(await versionsResponse.text());
  } catch {
    // Reported by the check below.
  }
  const hasVersions = Array.isArray(manifest?.versions);
  check('versions.json parses to a versions list', hasVersions, 'not JSON with a versions array');

  const next = await fetchNoRedirect(`${SITE}/next/`);
  check('/next/ answers 200', next.status === 200, `got ${next.status}`);

  const archive = hasVersions ? firstArchivePath(manifest) : null;
  if (archive) {
    const response = await fetchNoRedirect(`${SITE}${archive}`);
    check(`newest archive answers 200: ${archive}`, response.status === 200, `got ${response.status}`);
  }

  // A canonical that redirects is a canonical Google ignores. --crawl checks
  // every sitemap URL under a concurrency cap; without it, a sequential sample.
  // Pages may come from the edge cache, up to max-age=600 old.
  if (options.crawl) {
    const crawl = await crawlUrls(locs, {
      concurrency: Number(options.concurrency),
      timeoutMs: 10_000,
      deadlineMs: 90_000,
    });
    report.crawl = crawl;
    for (const { url, kind, detail } of crawl.failures) {
      check(`sitemap URL is a sound canonical page (${kind}): ${url}`, false, detail);
    }
    const { total, ok, failed, transient } = crawl.summary;
    check(
      `crawled all ${total} sitemap URLs`,
      ok === total,
      `${failed} deterministic failure(s), ${transient} transient failure(s) after retries`,
    );
  } else {
    const sample = locs.filter((_, index) => index % 25 === 0).slice(0, 6);
    for (const loc of sample) {
      const response = await fetchNoRedirect(loc);
      check(`sitemap URL answers 200 directly: ${loc}`, response.status === 200, `got ${response.status}`);
    }
  }

  const robots = await fetchNoRedirect(`${SITE}/robots.txt`);
  check('robots.txt answers 200', robots.status === 200, `got ${robots.status}`);
  check(
    'robots.txt names the sitemap',
    (await robots.text()).includes(`Sitemap: ${SITE}/sitemap.xml`),
    'sitemap line missing',
  );

  if (failures.length > 0) {
    throw new Error(`Live docs verification failed:\n  ${failures.join('\n  ')}`);
  }
  process.stdout.write(`\nLive docs verification passed against ${SITE}.\n`);
};

const main = async () => {
  if (options.status) {
    await status();
    return;
  }
  const report = { site: SITE, startedAt: new Date().toISOString() };
  await runWithReport({
    report,
    write: (data) => {
      if (options.report) writeFileSync(options.report, `${JSON.stringify({ ...data, failures }, null, 2)}\n`);
    },
    body: () => checks(report),
  });
};

await main();

// Node's fetch leaves its keep-alive socket open, and undici holds it with a
// ref'd timer for up to ten minutes — long past the deploy job's timeout, which
// cancelled a run whose checks had all passed. Exit once stdout has drained.
process.stdout.write('\n', () => process.exit(0));
