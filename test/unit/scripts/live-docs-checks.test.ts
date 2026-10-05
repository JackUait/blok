// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  awaitBuildInfo,
  compareBuildInfo,
  crawlUrls,
  deployLag,
} from '../../../scripts/live-docs-checks.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SITE = 'https://blokeditor.com';

type Reply = { status: number; body?: string; location?: string } | Error;

/** A fetch stand-in that answers each URL from a queue of replies; the last reply repeats. */
const fakeFetch = (routes: Record<string, Reply[]>) => {
  const calls: string[] = [];
  const impl = async (url: string): Promise<Response> => {
    calls.push(url);
    const key = url.split('?')[0];
    const queue = routes[key];
    if (queue === undefined) return new Response('not found', { status: 404 });
    const reply = queue.length > 1 ? queue.shift() : queue[0];
    if (reply === undefined) throw new Error(`no reply for ${key}`);
    if (reply instanceof Error) throw reply;
    return new Response(reply.body ?? '', {
      status: reply.status,
      headers: reply.location ? { location: reply.location } : {},
    });
  };
  return { impl, calls };
};

const page = (url: string, extra = ''): string =>
  `<html><head><link rel="canonical" href="${url}"/>${extra}</head><body><h1>Hi</h1></body></html>`;

const noSleep = async (): Promise<void> => {};

/** A host that accepts the connection and never answers; only the caller's abort ends it. */
const stalledFetch = async (_url: string, init?: RequestInit): Promise<Response> =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });

describe('live build info', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a live build that matches the artifact', () => {
    expect(compareBuildInfo({ sha: SHA_A, manifestHash: 'h1' }, { sha: SHA_A, manifestHash: 'h1' })).toEqual([]);
  });

  it('names every field that differs from the artifact', () => {
    expect(compareBuildInfo({ sha: SHA_B, manifestHash: 'h2' }, { sha: SHA_A, manifestHash: 'h1' })).toEqual([
      `sha: live ${SHA_B}, expected ${SHA_A}`,
      'manifestHash: live h2, expected h1',
    ]);
  });

  it('checks only the fields it was given', () => {
    expect(compareBuildInfo({ sha: SHA_A, manifestHash: 'other' }, { sha: SHA_A })).toEqual([]);
  });

  it('waits out Pages propagation, then returns the matching build', async () => {
    const { impl, calls } = fakeFetch({
      [`${SITE}/build-info.json`]: [
        { status: 404 },
        { status: 200, body: JSON.stringify({ sha: SHA_B, manifestHash: 'old' }) },
        { status: 200, body: JSON.stringify({ sha: SHA_A, manifestHash: 'new' }) },
      ],
    });

    const info = await awaitBuildInfo({
      site: SITE,
      expected: { sha: SHA_A, manifestHash: 'new' },
      fetchImpl: impl,
      attempts: 5,
      sleep: noSleep,
      log: () => {},
    });

    expect(info).toEqual({ sha: SHA_A, manifestHash: 'new' });
    expect(calls).toHaveLength(3);
    // Each attempt must bypass the CDN cache, or a stale copy is read every time.
    expect(new Set(calls).size).toBe(3);
  });

  it('fails with the last mismatch when the live build never matches', async () => {
    const { impl } = fakeFetch({
      [`${SITE}/build-info.json`]: [{ status: 200, body: JSON.stringify({ sha: SHA_B, manifestHash: 'old' }) }],
    });

    await expect(awaitBuildInfo({
      site: SITE,
      expected: { sha: SHA_A, manifestHash: 'new' },
      fetchImpl: impl,
      attempts: 3,
      sleep: noSleep,
      log: () => {},
    })).rejects.toThrow(`sha: live ${SHA_B}, expected ${SHA_A}`);
  });

  it('fails when build-info.json never appears', async () => {
    const { impl } = fakeFetch({});

    await expect(awaitBuildInfo({
      site: SITE,
      expected: { sha: SHA_A },
      fetchImpl: impl,
      attempts: 2,
      sleep: noSleep,
      log: () => {},
    })).rejects.toThrow(/build-info\.json.*404/);
  });

  it('gives up on a stalled request instead of hanging the job', async () => {
    await expect(awaitBuildInfo({
      site: SITE,
      expected: { sha: SHA_A },
      fetchImpl: stalledFetch,
      attempts: 2,
      timeoutMs: 10,
      sleep: noSleep,
      log: () => {},
    })).rejects.toThrow(/build-info\.json request failed/);
  });

  it('treats an unparseable build-info.json as a mismatch, not a crash', async () => {
    const { impl } = fakeFetch({ [`${SITE}/build-info.json`]: [{ status: 200, body: '<html>' }] });

    await expect(awaitBuildInfo({
      site: SITE,
      expected: { sha: SHA_A },
      fetchImpl: impl,
      attempts: 1,
      sleep: noSleep,
      log: () => {},
    })).rejects.toThrow(/not JSON/);
  });
});

describe('deploy lag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('counts the commits main has that the live build lacks', () => {
    const git = vi.fn((args: string[]) => {
      if (args[0] === 'rev-parse') return `${SHA_B}\n`;
      if (args[0] === 'rev-list') return '96\n';
      throw new Error(`unexpected git ${args.join(' ')}`);
    });

    expect(deployLag(SHA_A, git)).toEqual({ liveSha: SHA_A, mainSha: SHA_B, behind: 96 });
    expect(git).toHaveBeenCalledWith(['rev-list', '--count', `${SHA_A}..origin/main`]);
  });

  it('reports why the lag is unknown instead of throwing', () => {
    const git = vi.fn((args: string[]) => {
      if (args[0] === 'rev-parse') return `${SHA_B}\n`;
      throw new Error('fatal: bad revision');
    });

    expect(deployLag(SHA_A, git)).toEqual({
      liveSha: SHA_A,
      mainSha: SHA_B,
      behind: null,
      error: expect.stringContaining('bad revision'),
    });
  });
});

describe('full sitemap crawl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes pages that answer 200 and canonicalise to themselves', async () => {
    const a = `${SITE}/`;
    const b = `${SITE}/docs/table/`;
    const { impl } = fakeFetch({ [a]: [{ status: 200, body: page(a) }], [b]: [{ status: 200, body: page(b) }] });

    const report = await crawlUrls([a, b], { fetchImpl: impl, sleep: noSleep });

    expect(report.failures).toEqual([]);
    expect(report.summary).toEqual({ total: 2, ok: 2, failed: 0, transient: 0 });
  });

  it('fails a redirecting or missing sitemap URL without retrying it', async () => {
    const a = `${SITE}/docs/a/`;
    const b = `${SITE}/docs/b/`;
    const { impl, calls } = fakeFetch({
      [a]: [{ status: 301, location: `${SITE}/docs/z/` }],
      [b]: [{ status: 404 }],
    });

    const report = await crawlUrls([a, b], { fetchImpl: impl, sleep: noSleep, retries: 3 });

    expect(report.failures.map(({ url, kind }) => [url, kind])).toEqual([[a, 'deterministic'], [b, 'deterministic']]);
    expect(report.failures[0].detail).toContain('301');
    expect(calls).toHaveLength(2);
  });

  it('fails a page whose canonical points elsewhere or that is noindex', async () => {
    const a = `${SITE}/docs/a/`;
    const b = `${SITE}/docs/b/`;
    const { impl } = fakeFetch({
      [a]: [{ status: 200, body: page(`${SITE}/docs/other/`) }],
      [b]: [{ status: 200, body: page(b, '<meta name="robots" content="noindex"/>') }],
    });

    const report = await crawlUrls([a, b], { fetchImpl: impl, sleep: noSleep });

    expect(report.failures.map(({ url, detail }) => [url, detail])).toEqual([
      [a, `canonical is ${SITE}/docs/other/`],
      [b, 'page is noindex'],
    ]);
  });

  it('retries network errors and 5xx, and passes once the host recovers', async () => {
    const a = `${SITE}/docs/a/`;
    const b = `${SITE}/docs/b/`;
    const { impl, calls } = fakeFetch({
      [a]: [new TypeError('fetch failed'), { status: 200, body: page(a) }],
      [b]: [{ status: 503 }, { status: 429 }, { status: 200, body: page(b) }],
    });

    const report = await crawlUrls([a, b], { fetchImpl: impl, sleep: noSleep, retries: 3 });

    expect(report.failures).toEqual([]);
    expect(calls.filter((url) => url === a)).toHaveLength(2);
    expect(calls.filter((url) => url === b)).toHaveLength(3);
  });

  it('reports a host that stays down as transient, apart from real defects', async () => {
    const a = `${SITE}/docs/a/`;
    const { impl, calls } = fakeFetch({ [a]: [new TypeError('fetch failed')] });

    const report = await crawlUrls([a], { fetchImpl: impl, sleep: noSleep, retries: 2 });

    expect(report.failures).toEqual([{ url: a, kind: 'transient', detail: 'fetch failed', attempts: 3 }]);
    expect(report.summary).toEqual({ total: 1, ok: 0, failed: 0, transient: 1 });
    expect(calls).toHaveLength(3);
  });

  it('times out a stalled page and reports it as transient after retries', async () => {
    const a = `${SITE}/docs/a/`;
    const fetchImpl = vi.fn(stalledFetch);

    const report = await crawlUrls([a], { fetchImpl, sleep: noSleep, retries: 1, timeoutMs: 10 });

    expect(report.failures).toEqual([{ url: a, kind: 'transient', detail: expect.stringMatching(/timeout|abort/i), attempts: 2 }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('stops at the crawl deadline and reports the unchecked URLs as transient', async () => {
    const urls = [`${SITE}/a/`, `${SITE}/b/`, `${SITE}/c/`];
    let clock = 0;
    const impl = async (url: string): Promise<Response> => {
      clock += 60_000;
      return new Response(page(url), { status: 200 });
    };

    const report = await crawlUrls(urls, {
      fetchImpl: impl,
      sleep: noSleep,
      concurrency: 1,
      deadlineMs: 90_000,
      now: () => clock,
    });

    expect(report.summary).toEqual({ total: 3, ok: 2, failed: 0, transient: 1 });
    expect(report.failures).toEqual([
      { url: `${SITE}/c/`, kind: 'transient', detail: 'not checked: crawl deadline reached', attempts: 0 },
    ]);
  });

  it('never runs more requests at once than the concurrency cap', async () => {
    const urls = Array.from({ length: 12 }, (_, index) => `${SITE}/docs/p${index}/`);
    let inFlight = 0;
    let peak = 0;
    const impl = async (url: string): Promise<Response> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return new Response(page(url), { status: 200 });
    };

    const report = await crawlUrls(urls, { fetchImpl: impl, sleep: noSleep, concurrency: 3 });

    expect(report.summary.ok).toBe(12);
    expect(peak).toBe(3);
  });

  it('spaces out the requests each worker sends', async () => {
    const urls = [`${SITE}/a/`, `${SITE}/b/`, `${SITE}/c/`];
    const sleep = vi.fn(noSleep);
    const impl = async (url: string): Promise<Response> => new Response(page(url), { status: 200 });

    await crawlUrls(urls, { fetchImpl: impl, sleep, concurrency: 1, spacingMs: 250 });

    expect(sleep.mock.calls.filter(([ms]) => ms === 250)).toHaveLength(2);
  });
});
