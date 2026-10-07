// Tests for the assembled-site audit (docs/scripts/site-audit.mjs). It lives in
// docs/scripts/ as a deploy step; vitest only collects src/**, hence here.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditSite } from '../../scripts/site-audit.mjs';

const SITE = 'https://blokeditor.com';

const page = (head: string, body = ''): string =>
  `<!DOCTYPE html><html><head>${head}</head><body><main id="main-content">${body}</main></body></html>`;

describe('assembled site audit', () => {
  let site: string;

  const write = (path: string, content: string): void => {
    const file = join(site, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  const audit = () => auditSite({ siteDir: site, siteUrl: SITE });
  const failing = async () => (await audit()).failures.map(({ page: from, check, target }) => `${from} ${check} ${target}`);

  beforeEach(() => {
    vi.clearAllMocks();
    site = mkdtempSync(join(tmpdir(), 'site-audit-'));
    write('index.html', page(`<link rel="canonical" href="${SITE}/"/>`, '<h2 id="intro">Intro</h2>'));
    write('index.md', '# Home');
    write('docs/table/index.html', page(`<link rel="canonical" href="${SITE}/docs/table/"/>`));
    write('favicon.ico', 'x');
  });

  afterEach(() => {
    rmSync(site, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('passes a site whose every advertised URL resolves', async () => {
    write(
      'next/docs/table/index.html',
      page(
        `<link rel="canonical" href="${SITE}/docs/table/"/><link rel="icon" href="/favicon.ico"/>` +
          `<link rel="alternate" type="text/markdown" href="${SITE}/index.md"/>`,
        '<a href="#main-content">Skip</a><a href="/#intro">Intro</a><a href="../../">Next home</a>' +
          '<a href="https://github.com/x">GitHub</a><a href="mailto:a@b.c">Mail</a><a href="#">Top</a>',
      ),
    );
    write('next/index.html', page(''));

    expect((await audit()).failures).toEqual([]);
  });

  // Root-named URLs in a snapshot are followed literally: /next/docs/page/ must not
  // stand in for a root /docs/page/ that does not exist.
  it('follows a snapshot canonical to the root, not to the snapshot copy', async () => {
    write('next/docs/page/index.html', page(`<link rel="canonical" href="${SITE}/docs/page/"/>`));

    expect(await failing()).toEqual([`/next/docs/page/ canonical ${SITE}/docs/page/`]);
  });

  it('checks hreflang, og:url and markdown alternates literally', async () => {
    write(
      'v/1.14/docs/table/index.html',
      page(
        `<link rel="alternate" hreflang="ru" href="${SITE}/ru/docs/table/"/>` +
          `<meta property="og:url" content="${SITE}/docs/gone/"/>` +
          `<link rel="alternate" type="text/markdown" href="${SITE}/docs/table.md"/>`,
        `<div>A Markdown version of this page is available at ${SITE}/v/1.14/docs/table.md.</div>`,
      ),
    );

    expect(await failing()).toEqual([
      `/v/1.14/docs/table/ hreflang ${SITE}/ru/docs/table/`,
      `/v/1.14/docs/table/ markdown ${SITE}/docs/table.md`,
      `/v/1.14/docs/table/ og-url ${SITE}/docs/gone/`,
      `/v/1.14/docs/table/ markdown ${SITE}/v/1.14/docs/table.md`,
    ]);
  });

  // In a real page a <script> follows the pointer, and textContent runs them together.
  it('reads the body pointer address up to .md', async () => {
    write('docs/index.html', `${page('')}`.replace('</body>', `<div>A Markdown version of this page is available at ${SITE}/index.md.</div><script>window.__ctx={}</script></body>`));

    expect((await audit()).failures).toEqual([]);
  });

  it('flags a missing link target, a slashless directory link and a missing asset', async () => {
    write(
      'docs/index.html',
      page('<script src="/assets/gone.js"></script>', '<a href="/docs/gone/">a</a><a href="/docs/table">b</a>'),
    );

    expect((await audit()).failures).toEqual([
      { page: '/docs/', check: 'asset', target: `${SITE}/assets/gone.js`, detail: 'not in the site' },
      { page: '/docs/', check: 'link', target: `${SITE}/docs/gone/`, detail: 'not in the site' },
      { page: '/docs/', check: 'link', target: `${SITE}/docs/table`, detail: 'redirects to /docs/table/' },
    ]);
  });

  it('flags a fragment whose id is missing on the same page or the target page', async () => {
    write('docs/index.html', page('', '<a href="#nope">a</a><a href="/#quick-start">b</a><a href="/docs/table/#main-content">c</a>'));

    expect((await audit()).failures).toEqual([
      { page: '/docs/', check: 'fragment', target: `${SITE}/docs/#nope`, detail: 'no id="nope" in /docs/' },
      { page: '/docs/', check: 'fragment', target: `${SITE}/#quick-start`, detail: 'no id="quick-start" in /' },
    ]);
  });

  it('reports a broken target once per page', async () => {
    write('docs/index.html', page('', '<a href="/docs/gone/">a</a><a href="/docs/gone/">b</a>'));

    expect(await failing()).toEqual([`/docs/ link ${SITE}/docs/gone/`]);
  });
});

// Root and /v/<minor>/ are release tarballs this commit cannot change; only the
// builds named by `enforce` can fail the deploy. The rest is still reported.
describe('assembled site audit — enforcement scope', () => {
  let site: string;

  beforeEach(() => {
    vi.clearAllMocks();
    site = mkdtempSync(join(tmpdir(), 'site-audit-scope-'));
    for (const dir of ['', 'next/', 'v/1.14/']) {
      const file = join(site, dir, 'index.html');
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, page('', '<a href="#gone">x</a>'));
    }
  });

  afterEach(() => {
    rmSync(site, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('fails only pages under an enforced prefix and reports the rest as warnings', async () => {
    const result = await auditSite({ siteDir: site, siteUrl: SITE, enforce: ['/next/'] });

    expect(result.failures.map(({ page: from }) => from)).toEqual(['/next/']);
    expect(result.warnings.map(({ page: from }) => from)).toEqual(['/', '/v/1.14/']);
    expect(result.summary).toEqual({ pages: 3, failures: 1, warnings: 2 });
  });

  // A later root can drop a route an archive still canonicalises to; that must
  // stop the deploy, not scroll past as a warning.
  it('fails a cross-version canonical, hreflang or og:url anywhere in the site', async () => {
    const file = join(site, 'v/1.14/docs/gone/index.html');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      page(
        `<link rel="canonical" href="${SITE}/docs/gone/"/><link rel="alternate" hreflang="ru" href="${SITE}/ru/docs/gone/"/>` +
          `<meta property="og:url" content="${SITE}/docs/gone/"/>`,
      ),
    );

    const result = await auditSite({ siteDir: site, siteUrl: SITE, enforce: ['/next/'] });

    expect(result.failures.filter(({ page: from }) => from === '/v/1.14/docs/gone/').map(({ check }) => check)).toEqual([
      'canonical',
      'hreflang',
      'og-url',
    ]);
  });
});
