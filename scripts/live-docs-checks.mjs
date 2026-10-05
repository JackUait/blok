// Helpers for verify-live-docs.mjs, kept apart so tests can drive them with a
// fake fetch instead of the real host.
import { contentAddressedPath } from './docs-build-info.mjs';

const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A stalled connection never throws on its own, so every request is bounded.
const REQUEST_TIMEOUT_MS = 20_000;

/** Fields of the live build-info.json that differ from what was just built. */
export const compareBuildInfo = (live, expected) =>
  Object.entries(expected)
    .filter(([, value]) => value)
    .filter(([key, value]) => live?.[key] !== value)
    .map(([key, value]) => `${key}: live ${live?.[key]}, expected ${value}`);

/**
 * Polls this build's content-addressed build info until it is served and
 * names the expected commit. Not /build-info.json: the CDN ignores query
 * strings, so that path can serve the previous deploy for up to its TTL.
 */
export const awaitBuildInfo = async ({
  site,
  expected,
  fetchImpl = fetch,
  attempts = 20,
  delayMs = 15_000,
  timeoutMs = REQUEST_TIMEOUT_MS,
  sleep = waitFor,
  log = (line) => process.stdout.write(`${line}\n`),
}) => {
  if (!expected.manifestHash) throw new Error('awaitBuildInfo needs the expected manifest hash to name the file it polls');
  const path = contentAddressedPath(expected.manifestHash);
  const name = path.slice(1);
  let problem = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response = null;
    try {
      response = await fetchImpl(`${site}${path}`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      problem = `${name} request failed: ${error?.message ?? error}`;
    }
    if (response?.status === 200) {
      const body = await response.text();
      let live = null;
      try {
        live = JSON.parse(body);
      } catch {
        problem = `${name} is not JSON`;
      }
      if (live) {
        const mismatches = compareBuildInfo(live, expected);
        if (mismatches.length === 0) return live;
        problem = mismatches.join('; ');
      }
    } else if (response) {
      problem = `${name} answered ${response.status}`;
    }
    log(`waiting for ${name} (attempt ${attempt}): ${problem}`);
    if (attempt < attempts) await sleep(delayMs);
  }
  throw new Error(`The live site is not the build just deployed: ${problem}`);
};

/** Runs the checks and always writes the report, recording the error if one is thrown. */
export const runWithReport = async ({ report, write, body }) => {
  try {
    await body();
  } catch (error) {
    report.error = String(error?.message ?? error);
    throw error;
  } finally {
    write(report);
  }
};

/** How far the live commit is behind origin/main. `git` runs git and returns stdout. */
export const deployLag = (liveSha, git) => {
  const lag = { liveSha, mainSha: null, behind: null };
  try {
    lag.mainSha = git(['rev-parse', 'origin/main']).trim();
    lag.behind = Number(git(['rev-list', '--count', `${liveSha}..origin/main`]).trim());
  } catch (error) {
    return { ...lag, behind: null, error: String(error?.message ?? error) };
  }
  return lag;
};

/** @typedef {{ url: string, kind: 'ok' | 'deterministic' | 'transient', detail?: string, attempts: number }} CrawlResult */

const isTransientStatus = (status) => status === 429 || status >= 500;

/** Deterministic problems with one served sitemap page, or null. */
const pageProblem = (url, response, body) => {
  if (response.status !== 200) {
    const location = response.headers.get('location');
    return `answered ${response.status}${location ? ` -> ${location}` : ''}`;
  }
  if (/<meta[^>]+name="robots"[^>]+content="[^"]*noindex/i.test(body)) return 'page is noindex';
  const canonical = /<link[^>]+rel="canonical"[^>]+href="([^"]*)"/i.exec(body)?.[1] ?? null;
  if (canonical !== url) return `canonical is ${canonical ?? 'missing'}`;
  return null;
};

/**
 * Fetches every URL with a concurrency cap and per-worker spacing. Network
 * errors, 429 and 5xx are retried with backoff and, if they never clear, are
 * reported as `transient`. Any other wrong answer is `deterministic` at once.
 */
export const crawlUrls = async (urls, {
  fetchImpl = fetch,
  concurrency = 4,
  spacingMs = 100,
  retries = 3,
  retryDelayMs = 2_000,
  timeoutMs = REQUEST_TIMEOUT_MS,
  deadlineMs = Infinity,
  now = Date.now,
  sleep = waitFor,
} = {}) => {
  const startedAt = now();
  /** @type {CrawlResult[]} */
  const results = [];
  const queue = [...urls];

  /** @returns {Promise<CrawlResult>} */
  const visit = async (url) => {
    let detail = '';
    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      try {
        const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
        if (!isTransientStatus(response.status)) {
          const problem = pageProblem(url, response, await response.text());
          return problem
            ? { url, kind: 'deterministic', detail: problem, attempts: attempt }
            : { url, kind: 'ok', attempts: attempt };
        }
        detail = `answered ${response.status}`;
      } catch (error) {
        detail = String(error?.message ?? error);
      }
      if (attempt <= retries) await sleep(retryDelayMs * attempt);
    }
    return { url, kind: 'transient', detail, attempts: retries + 1 };
  };

  const worker = async () => {
    let first = true;
    while (queue.length > 0) {
      const url = queue.shift();
      // Past the deadline the rest are reported, not fetched, so the job
      // finishes inside its timeout and the report still gets written.
      if (now() - startedAt >= deadlineMs) {
        results.push({ url, kind: 'transient', detail: 'not checked: crawl deadline reached', attempts: 0 });
        continue;
      }
      if (!first) await sleep(spacingMs);
      first = false;
      results.push(await visit(url));
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));

  const order = new Map(urls.map((url, index) => [url, index]));
  results.sort((a, b) => order.get(a.url) - order.get(b.url));
  const failures = results.filter((result) => result.kind !== 'ok');
  return {
    summary: {
      total: results.length,
      ok: results.length - failures.length,
      failed: failures.filter((result) => result.kind === 'deterministic').length,
      transient: failures.filter((result) => result.kind === 'transient').length,
    },
    failures,
    results,
  };
};
