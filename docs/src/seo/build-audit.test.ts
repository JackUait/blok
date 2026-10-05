// Tests for the build-output SEO audit (docs/scripts/build-audit.mjs). It lives
// in docs/scripts/ as a postbuild step; vitest only collects src/**, hence here.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditBuild } from '../../scripts/build-audit.mjs';

const SITE = 'https://blokeditor.com';

type PageSpec = { route: string; canonical: string; noindex?: boolean };

const url = (route: string): string => `${SITE}${route === '/' ? '/' : `${route}/`}`;
const ruRoute = (route: string): string => (route === '/' ? '/ru' : `/ru${route}`);
const enRoute = (route: string): string => route.replace(/^\/ru(?=\/|$)/, '') || '/';
const mirror = (route: string): string => (route === '/' ? '/index.md' : `${route}.md`);
const fileFor = (route: string): string => (route === '/' ? 'index.html' : `${route.slice(1)}/index.html`);

const hreflang = (route: string): string => {
  const en = enRoute(route);
  return [
    `<link rel="alternate" hreflang="en" href="${url(en)}"/>`,
    `<link rel="alternate" hreflang="ru" href="${url(ruRoute(en))}"/>`,
    `<link rel="alternate" hreflang="x-default" href="${url(en)}"/>`,
  ].join('');
};

const PROSE = 'Blok stores rich text as typed JSON blocks rather than HTML. '.repeat(6);

/** A page that passes every check. Options knock out one property at a time. */
const html = (route: string, options: {
  canonicals?: string[];
  head?: string;
  h1s?: number;
  prose?: string;
  links?: string[];
  alternates?: string;
  mirrorHref?: string | null;
  jsonLd?: string;
} = {}): string => {
  const canonicals = options.canonicals ?? [url(route)];
  const mirrorHref = options.mirrorHref === undefined ? `${SITE}${mirror(route)}` : options.mirrorHref;
  return [
    '<!DOCTYPE html><html><head>',
    ...canonicals.map((href) => `<link rel="canonical" href="${href}"/>`),
    options.alternates ?? hreflang(route),
    mirrorHref ? `<link rel="alternate" type="text/markdown" href="${mirrorHref}"/>` : '',
    `<script type="application/ld+json">${options.jsonLd ?? '{"@type":"WebPage"}'}</script>`,
    '<link rel="stylesheet" href="/assets/index.css"/>',
    options.head ?? '',
    '</head><body><nav><a href="/">Home</a></nav><main>',
    '<h1>Title</h1>'.repeat(options.h1s ?? 1),
    `<p>${options.prose ?? PROSE}</p>`,
    ...(options.links ?? []).map((href) => `<a href="${href}">link</a>`),
    '</main></body></html>',
  ].join('');
};

const ROUTES = ['/', '/docs/table', '/ru', '/ru/docs/table'];

describe('build output audit', () => {
  let out: string;
  let pages: PageSpec[];

  const write = (path: string, content: string): void => {
    const file = join(out, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  };

  const sitemap = (routes: string[]): void =>
    write('sitemap.xml', `<urlset>${routes.map((route) => `<url><loc>${url(route)}</loc></url>`).join('')}</urlset>`);

  const audit = () => auditBuild({ outDir: out, siteUrl: SITE, pages });
  const failing = (result: ReturnType<typeof auditBuild>) =>
    result.failures.map(({ route, check }) => `${route} ${check}`);

  beforeEach(() => {
    vi.clearAllMocks();
    out = mkdtempSync(join(tmpdir(), 'build-audit-'));
    pages = ROUTES.map((route) => ({ route, canonical: url(route) }));
    for (const route of ROUTES) {
      write(fileFor(route), html(route));
      write(mirror(route).slice(1), `---\ntitle: x\n---\n\n# Title\n\n${PROSE}\n`);
    }
    write('assets/index.css', 'body{}');
    sitemap(ROUTES);
  });

  afterEach(() => {
    rmSync(out, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('passes a build where every canonical page is sound', () => {
    const result = audit();

    expect(result.failures).toEqual([]);
    expect(result.summary).toEqual({ pages: 4, indexable: 4, failures: 0 });
  });

  it('flags a manifest page the build did not emit', () => {
    rmSync(join(out, 'docs/table/index.html'));

    expect(failing(audit())).toContain('/docs/table missing-file');
  });

  it('flags a manifest canonical that is not the page\'s own URL', () => {
    pages[1] = { route: '/docs/table', canonical: `${SITE}/docs/table` };

    expect(failing(audit())).toContain('/docs/table manifest-canonical');
  });

  it('requires exactly one canonical, pointing at the page itself', () => {
    write(fileFor('/docs/table'), html('/docs/table', { canonicals: [url('/docs/table'), url('/')] }));
    write(fileFor('/ru'), html('/ru', { canonicals: [url('/')] }));
    write(fileFor('/'), html('/', { canonicals: [] }));

    expect(failing(audit())).toEqual(expect.arrayContaining([
      '/docs/table canonical',
      '/ru canonical',
      '/ canonical',
    ]));
  });

  it('flags an indexable page that carries noindex', () => {
    write(fileFor('/docs/table'), html('/docs/table', { head: '<meta name="robots" content="noindex"/>' }));

    expect(failing(audit())).toContain('/docs/table noindex');
  });

  it('requires exactly one h1', () => {
    write(fileFor('/docs/table'), html('/docs/table', { h1s: 0 }));
    write(fileFor('/ru'), html('/ru', { h1s: 2 }));

    expect(failing(audit())).toEqual(expect.arrayContaining(['/docs/table h1', '/ru h1']));
  });

  it('flags a page with no prose, the signature of a prerender shell', () => {
    write(fileFor('/docs/table'), html('/docs/table', { prose: '' }));

    expect(failing(audit())).toContain('/docs/table prose');
  });

  it('flags internal links to files the build did not emit', () => {
    write(fileFor('/'), html('/', { links: ['/docs/gone/', '/assets/missing.js', '/docs/table/#api'] }));

    const result = audit();
    const links = result.failures.filter(({ check }) => check === 'internal-link');

    expect(links.map(({ detail }) => detail)).toEqual([
      'https://blokeditor.com/docs/gone/ is not in the build',
      'https://blokeditor.com/assets/missing.js is not in the build',
    ]);
  });

  it('flags a slashless internal link, which costs a redirect', () => {
    write(fileFor('/'), html('/', { links: ['/docs/table'] }));

    expect(audit().failures).toContainEqual({
      route: '/',
      check: 'internal-link',
      detail: 'https://blokeditor.com/docs/table redirects to /docs/table/',
    });
  });

  it('ignores external, mailto and fragment-only links', () => {
    write(fileFor('/'), html('/', { links: ['https://github.com/x', 'mailto:a@b.c', '#top', '//cdn.example.com/x.js'] }));

    expect(audit().failures).toEqual([]);
  });

  it('requires the sitemap to list exactly the indexable canonicals', () => {
    pages.push({ route: '/tools', canonical: `${SITE}/docs/`, noindex: true });
    write('tools/index.html', html('/tools', { head: '<meta name="robots" content="noindex"/>' }));
    sitemap(['/', '/docs/table', '/ru', '/tools']);

    expect(audit().failures.filter(({ check }) => check.startsWith('sitemap'))).toEqual([
      { route: '/ru/docs/table', check: 'sitemap-missing', detail: `${url('/ru/docs/table')} is not in sitemap.xml` },
      { route: '/tools', check: 'sitemap-extra', detail: `${url('/tools')} is in sitemap.xml but the page is noindex` },
    ]);
  });

  it('flags a sitemap URL no manifest route owns', () => {
    write('sitemap.xml', `<urlset>${[...ROUTES.map(url), `${SITE}/old/`].map((loc) => `<url><loc>${loc}</loc></url>`).join('')}</urlset>`);

    expect(audit().failures).toContainEqual({
      route: null,
      check: 'sitemap-extra',
      detail: `${SITE}/old/ is in sitemap.xml but no manifest route owns it`,
    });
  });

  it('requires en, ru and x-default hreflang', () => {
    write(fileFor('/docs/table'), html('/docs/table', {
      alternates: `<link rel="alternate" hreflang="en" href="${url('/docs/table')}"/>`,
    }));

    expect(audit().failures).toContainEqual({
      route: '/docs/table',
      check: 'hreflang',
      detail: 'missing hreflang ru, x-default',
    });
  });

  it('requires every hreflang target to exist and to list the same set back', () => {
    write(fileFor('/ru/docs/table'), html('/ru/docs/table', {
      alternates: [
        `<link rel="alternate" hreflang="en" href="${url('/docs/table')}"/>`,
        `<link rel="alternate" hreflang="ru" href="${url('/ru/docs/table')}"/>`,
        `<link rel="alternate" hreflang="x-default" href="${url('/')}"/>`,
      ].join(''),
    }));
    write(fileFor('/'), html('/', {
      alternates: hreflang('/').replace(url('/ru'), `${SITE}/ru/missing/`),
    }));

    const details = audit().failures.filter(({ check }) => check === 'hreflang').map(({ route, detail }) => `${route}: ${detail}`);

    expect(details).toEqual(expect.arrayContaining([
      `/: hreflang ru -> ${SITE}/ru/missing/ is not a built page`,
      `/docs/table: hreflang is not reciprocal with ${url('/ru/docs/table')}`,
    ]));
  });

  it('flags JSON-LD that does not parse', () => {
    write(fileFor('/docs/table'), html('/docs/table', { jsonLd: '{"@type": WebPage}' }));

    expect(failing(audit())).toContain('/docs/table json-ld');
  });

  it('requires an advertised markdown mirror to exist with a body', () => {
    write('docs/table.md', '---\ntitle: x\n---\n\n');
    rmSync(join(out, 'ru.md'));

    const details = audit().failures.filter(({ check }) => check === 'markdown-mirror').map(({ route, detail }) => `${route}: ${detail}`);

    expect(details).toEqual([
      `/docs/table: ${SITE}/docs/table.md has no body`,
      `/ru: ${SITE}/ru.md is not in the build`,
    ]);
  });

  it('requires an indexable page to advertise its markdown mirror', () => {
    write(fileFor('/docs/table'), html('/docs/table', { mirrorHref: null }));

    expect(failing(audit())).toContain('/docs/table markdown-mirror');
  });

  it('reports per-page results as JSON-serialisable data', () => {
    const result = audit();

    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(result.pages.map(({ route, ok }) => [route, ok])).toEqual(ROUTES.map((route) => [route, true]));
  });
});
