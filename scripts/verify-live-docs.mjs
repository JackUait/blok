#!/usr/bin/env node
// Post-deploy smoke test: asserts what the HOST serves, not what the build
// produced. Every check below is something a local test cannot see — status
// codes, redirects, and whether the deploy actually reached the edge.
//
// It exists because the two worst SEO defects this repo has shipped were both
// invisible to the unit suite: a sitemap whose 148 `lastmod` values were all
// identical (shallow CI clone), and three days of deploys that published
// nothing at all.
const SITE = (process.argv[2] ?? 'https://blokeditor.com').replace(/\/$/, '');

const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchNoRedirect = (url) => fetch(url, { redirect: 'manual' });

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
 * built, which only exists once this deploy is live. Pages sits behind a CDN
 * with a ~10 minute TTL, hence the per-attempt cache-buster.
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

const main = async () => {
  const marker = process.env.DEPLOY_MARKER;
  if (marker) await awaitDeployment(marker);

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

  // A canonical that redirects is a canonical Google ignores. Sampled, not
  // exhaustive: 148 sequential requests would dominate the job's runtime.
  const sample = locs.filter((_, index) => index % 25 === 0).slice(0, 6);
  for (const loc of sample) {
    const response = await fetchNoRedirect(loc);
    check(`sitemap URL answers 200 directly: ${loc}`, response.status === 200, `got ${response.status}`);
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

await main();
