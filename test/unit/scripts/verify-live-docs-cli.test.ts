// @vitest-environment node
/**
 * Drives scripts/verify-live-docs.mjs end to end: a real child process against
 * a small GitHub-Pages-like server over a fixture site. `--map` sends requests
 * for the production origins to local servers, so every check runs unchanged
 * against https://blokeditor.com URLs.

 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const REPO_ROOT = join(__dirname, '../../..');
const VERIFIER = join(REPO_ROOT, 'scripts/verify-live-docs.mjs');
const BUILD_INFO = join(REPO_ROOT, 'scripts/docs-build-info.mjs');
const SITE = 'https://blokeditor.com';

/** Long enough for a slow CI box, far short of the ten-minute keep-alive hang. */
const RUN_LIMIT_MS = 20_000;

const page = (path: string, head = ''): string =>
  `<!DOCTYPE html><html><head><link href="${SITE}${path}" rel="canonical">${head}</head>`
  + `<body><h1>Blok ${path}</h1></body></html>`;

const writeSite = (root: string, overrides: Record<string, string> = {}): void => {
  const files: Record<string, string> = {
    'index.html': page('/'),
    'docs/quick-start/index.html': page('/docs/quick-start/'),
    'next/index.html': page('/', '<meta name="robots" content="noindex, follow">'),
    '404.html': '<h1>Not found</h1>',
    'assets/client-abc123.js': 'export {};',
    'sitemap.xml': `<urlset><url><loc>${SITE}/</loc><lastmod>2026-10-01</lastmod></url>`
      + `<url><loc>${SITE}/docs/quick-start/</loc><lastmod>2026-09-20</lastmod></url></urlset>`,
    'robots.txt': `User-agent: *\nSitemap: ${SITE}/sitemap.xml\n`,
    'versions.json': JSON.stringify({ latest: '1.15', versions: [{ id: 'next', label: 'Next', path: '/next/' }, { id: '1.15', label: '1.15', path: '/' }] }),
    ...overrides,
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
};

/** Runs the real build-info step over the fixture, as the deploy workflow does. */
const recordBuildInfo = (root: string, scratch: string): Record<string, string> => {
  const output = join(scratch, 'github-output');
  rmSync(output, { force: true });
  const sources = join(scratch, 'site-sources.json');
  writeFileSync(sources, JSON.stringify({ rootTag: 'v1.16.0', rootCommit: 'c'.repeat(40), archiveTags: [] }));
  execFileSync(process.execPath, [BUILD_INFO, root, '--sources', sources], {
    env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_RUN_ID: '4242', GITHUB_RUN_ATTEMPT: '1' },
    stdio: 'pipe',
  });
  return Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map((line): [string, string] => {
    const [key = '', value = ''] = line.split('=');
    return [key, value];
  }));
};

const TYPES: Record<string, string> = { '.html': 'text/html', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain', '.js': 'text/javascript' };

/** GitHub Pages behind the custom domain: `/dir` 301s to the canonical `/dir/`, misses serve 404.html. */
const pagesServer = (root: string): Server => createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://local').pathname);
  const send = (file: string, status = 200): void => {
    response.writeHead(status, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(readFileSync(file));
  };
  const file = join(root, pathname);
  let isDir = false;
  try {
    isDir = statSync(file).isDirectory();
  } catch {
    send(join(root, '404.html'), 404);
    return;
  }
  if (!isDir) {
    send(file);
  } else if (!pathname.endsWith('/')) {
    response.writeHead(301, { location: `${SITE}${pathname}/` });
    response.end();
  } else {
    try {
      send(join(file, 'index.html'));
    } catch {
      send(join(root, '404.html'), 404);
    }
  }
});

/** The http:// and www. hosts: both 301 onto the canonical origin. */
const redirectServer = (): Server => createServer((request, response) => {
  response.writeHead(301, { location: `${SITE}${new URL(request.url ?? '/', 'http://local').pathname}` });
  response.end();
});

const listen = async (server: Server): Promise<string> => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

const close = async (server: Server): Promise<void> => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
};

/** An origin that refuses connections: a port that was free a moment ago. */
const deadOrigin = async (): Promise<string> => {
  const server = createServer();
  const origin = await listen(server);
  await close(server);
  return origin;
};

type Report = {
  failures: string[];
  error?: string;
  buildInfo?: { sha: string };
  crawl?: { failures: { url: string; kind: string; detail: string }[] };
};

type Run = { code: number | null; stdout: string; stderr: string; ms: number };

describe('verify-live-docs CLI, end to end', () => {
  let scratch: string;
  let root: string;
  let report: string;
  let servers: Server[];
  let pagesOrigin: string;
  let redirectOrigin: string;

  const verify = (args: string[], env: Record<string, string> = {}): Promise<Run> => new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [VERIFIER, ...args, '--report', report, '--poll-delay', '10'], {
      env: {
        ...process.env,
        EXPECTED_BUILD_SHA: '',
        EXPECTED_MANIFEST_HASH: '',
        EXPECTED_BUILD_INFO_PATH: '',
        EXPECTED_ROOT_TAG: '',
        DEPLOY_MARKER: '',
        ...env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => child.kill('SIGKILL'), RUN_LIMIT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, ms: Date.now() - started });
    });
  });

  const mapped = (www = redirectOrigin): string[] => [
    SITE,
    '--map', `${SITE}=${pagesOrigin}`,
    '--map', `http://blokeditor.com=${redirectOrigin}`,
    '--map', `https://www.blokeditor.com=${www}`,
  ];

  const expectedEnv = (outputs: Record<string, string>): Record<string, string> => ({
    EXPECTED_BUILD_SHA: outputs.sha ?? '',
    EXPECTED_MANIFEST_HASH: outputs.manifest ?? '',
    EXPECTED_BUILD_INFO_PATH: outputs.proof ?? '',
    EXPECTED_ROOT_TAG: outputs.root_tag ?? '',
  });

  const readReport = (): Report => JSON.parse(readFileSync(report, 'utf8')) as Report;

  beforeEach(async () => {
    vi.clearAllMocks();
    scratch = mkdtempSync(join(tmpdir(), 'verify-live-docs-'));
    root = join(scratch, 'site');
    report = join(scratch, 'report.json');
    servers = [pagesServer(root), redirectServer()];
    [pagesOrigin = '', redirectOrigin = ''] = await Promise.all(servers.map(listen));
  });

  afterEach(async () => {
    await Promise.all(servers.map(close));
    rmSync(scratch, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('passes and exits 0 when the live site is the build just recorded', async () => {
    writeSite(root);
    const outputs = recordBuildInfo(root, scratch);

    const run = await verify([...mapped(), '--crawl', '--require-build-info'], expectedEnv(outputs));

    expect(run.stdout).not.toContain('FAIL');
    expect(run.stdout).toContain(`Live docs verification passed against ${SITE}.`);
    expect(run.code).toBe(0);
    expect(run.ms).toBeLessThan(RUN_LIMIT_MS);
    expect(readReport()).toMatchObject({ failures: [], buildInfo: { sha: outputs.sha } });
  }, 30_000);

  it('fails with exit 1 when the live build names another commit, and still runs every other check', async () => {
    writeSite(root);
    const outputs = recordBuildInfo(root, scratch);

    const run = await verify([...mapped(), '--require-build-info'], { ...expectedEnv(outputs), EXPECTED_BUILD_SHA: 'f'.repeat(40) });

    expect(run.stdout).toMatch(/FAIL {2}live build info matches the artifact just built — .*sha: live [a-f0-9]{40}, expected f{40}/);
    expect(run.stdout).toContain('ok    robots.txt names the sitemap');
    expect(run.code).toBe(1);
    expect(run.ms).toBeLessThan(RUN_LIMIT_MS);
    expect(readReport().failures).toEqual([expect.stringContaining('live build info matches the artifact just built')]);
  }, 30_000);

  it('fails when the live root snapshot is not the release this build put there', async () => {
    writeSite(root);
    const outputs = recordBuildInfo(root, scratch);

    const run = await verify([...mapped(), '--require-build-info'], { ...expectedEnv(outputs), EXPECTED_ROOT_TAG: 'v1.17.0' });

    expect(run.stdout).toMatch(/FAIL {2}live build info matches the artifact just built — .*rootTag: live v1\.16\.0, expected v1\.17\.0/);
    expect(run.code).toBe(1);
  }, 30_000);

  it('requires the root tag in CI too', async () => {
    writeSite(root);
    const outputs = recordBuildInfo(root, scratch);

    const run = await verify([...mapped(), '--require-build-info'], { ...expectedEnv(outputs), EXPECTED_ROOT_TAG: '' });

    expect(readReport().error).toMatch(/--require-build-info: .*EXPECTED_ROOT_TAG/);
    expect(run.code).toBe(1);
  }, 30_000);

  it('fails with exit 1 and still writes the report when CI passes no build info', async () => {
    writeSite(root);

    const run = await verify([...mapped(), '--require-build-info'], { EXPECTED_BUILD_SHA: 'a'.repeat(40) });

    expect(readReport().error).toMatch(/--require-build-info: .*EXPECTED_MANIFEST_HASH.*EXPECTED_BUILD_INFO_PATH/);
    expect(run.code).toBe(1);
    expect(run.ms).toBeLessThan(RUN_LIMIT_MS);
  }, 30_000);

  it('reports a sitemap page that is noindex as a deterministic crawl failure', async () => {
    writeSite(root, { 'docs/quick-start/index.html': page('/docs/quick-start/', '<meta content="noindex" name="robots">') });
    const outputs = recordBuildInfo(root, scratch);

    const run = await verify([...mapped(), '--crawl', '--require-build-info'], expectedEnv(outputs));

    expect(readReport().crawl?.failures).toEqual([
      { url: `${SITE}/docs/quick-start/`, kind: 'deterministic', detail: 'page is noindex', attempts: 1 },
    ]);
    expect(run.stdout).toContain(`FAIL  sitemap URL is a sound canonical page (deterministic): ${SITE}/docs/quick-start/`);
    expect(run.code).toBe(1);
  }, 30_000);

  it('records a request that throws as a failed check and runs the checks after it', async () => {
    writeSite(root);

    const run = await verify(mapped(await deadOrigin()));

    expect(run.stdout).toMatch(/FAIL {2}www redirects to the canonical host — request failed: /);
    expect(run.stdout).toContain('ok    robots.txt names the sitemap');
    expect(readReport().failures).toEqual([expect.stringMatching(/^www redirects to the canonical host: request failed: /)]);
    expect(run.code).toBe(1);
    expect(run.ms).toBeLessThan(RUN_LIMIT_MS);
  }, 30_000);

  it('runs against a plain local origin without inventing http:// or www. hosts for it', async () => {
    // Local URLs only, so the sampled sitemap pages never reach the real host.
    writeSite(root, {
      'sitemap.xml': `<urlset><url><loc>${pagesOrigin}/</loc><lastmod>2026-10-01</lastmod></url></urlset>`,
    });

    const run = await verify([pagesOrigin]);

    expect(run.stdout + run.stderr).not.toMatch(/ENOTFOUND|http:\/\/http:/);
    expect(run.stdout).toContain('skip  http redirects to the canonical host — the site is not https');
    expect(run.stdout).toContain('skip  www redirects to the canonical host — the site is not https');
    expect(run.stdout).toContain('robots.txt answers 200');
    expect(run.ms).toBeLessThan(RUN_LIMIT_MS);
  }, 30_000);
});
