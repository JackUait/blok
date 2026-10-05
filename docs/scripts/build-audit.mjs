// Build-output SEO audit: checks every page the route manifest intends to
// publish against what the build actually wrote. Pure over (outDir, pages) so
// tests can feed it a fixture tree; audit-build-output.mjs feeds it the real
// manifest and build.
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const REQUIRED_HREFLANG = ['en', 'ru', 'x-default'];

const ownUrl = (siteUrl, route) => `${siteUrl}${route.endsWith('/') ? route : `${route}/`}`;

const isFile = (file) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

const prose = (document) => {
  const root = (document.querySelector('main') ?? document.body)?.cloneNode(true);
  if (!root) return '';
  root.querySelectorAll('script, style, template, noscript').forEach((node) => node.remove());
  return (root.textContent ?? '').replace(/\s+/g, ' ').trim();
};

const markdownBody = (content) => content.replace(/^---\n[\s\S]*?\n---\n/, '').trim();

/**
 * @param {object} options
 * @param {string} options.outDir   built site root (the directory Pages serves)
 * @param {string} options.siteUrl  production origin, no trailing slash
 * @param {{ route: string, canonical: string, noindex?: boolean, mirror?: boolean }[]} options.pages
 * @param {number} [options.minProseChars]
 */
export const auditBuild = ({ outDir, siteUrl, pages, minProseChars = 200 }) => {
  const origin = new URL(siteUrl).origin;
  const failures = [];
  const urlToRoute = new Map(pages.map((page) => [ownUrl(siteUrl, page.route), page]));
  const pageFile = (pathname) => path.join(outDir, decodeURIComponent(pathname), 'index.html');
  const isBuiltPage = (url) => {
    const parsed = new URL(url);
    return parsed.origin === origin && parsed.pathname.endsWith('/') && isFile(pageFile(parsed.pathname));
  };

  const hreflangCache = new Map();
  const hreflangSet = (file) => {
    if (!hreflangCache.has(file)) {
      const dom = new JSDOM(fs.readFileSync(file, 'utf8'));
      hreflangCache.set(file, readHreflang(dom.window.document));
    }
    return hreflangCache.get(file);
  };
  const readHreflang = (document) =>
    [...document.querySelectorAll('link[rel~="alternate"][hreflang]')]
      .map((link) => `${link.getAttribute('hreflang')} ${link.getAttribute('href')}`)
      .sort();

  const results = pages.map((page) => {
    const problems = [];
    const fail = (check, detail) => {
      problems.push(check);
      failures.push({ route: page.route, check, detail });
    };
    const url = ownUrl(siteUrl, page.route);
    const file = path.join(outDir, page.route === '/' ? 'index.html' : `${page.route.slice(1)}/index.html`);
    const result = { route: page.route, url, file: path.relative(outDir, file), indexable: !page.noindex };

    if (page.noindex) return { ...result, ok: true, problems };

    if (page.canonical !== url) fail('manifest-canonical', `route metadata canonical is ${page.canonical}, not ${url}`);
    if (!isFile(file)) {
      fail('missing-file', `${result.file} was not emitted`);
      return { ...result, ok: false, problems };
    }

    const html = fs.readFileSync(file, 'utf8');
    const { document } = new JSDOM(html).window;

    const canonicals = [...document.querySelectorAll('link[rel~="canonical"]')].map((link) => link.getAttribute('href'));
    if (canonicals.length !== 1 || canonicals[0] !== url) {
      fail('canonical', `expected one canonical ${url}, found [${canonicals.join(', ')}]`);
    }

    const robots = [...document.querySelectorAll('meta[name="robots" i], meta[name="googlebot" i]')]
      .map((meta) => meta.getAttribute('content') ?? '');
    if (robots.some((content) => /noindex/i.test(content))) fail('noindex', `robots meta: ${robots.join(' | ')}`);

    const h1Count = document.querySelectorAll('h1').length;
    if (h1Count !== 1) fail('h1', `expected one <h1>, found ${h1Count}`);

    const text = prose(document);
    if (text.length < minProseChars) fail('prose', `${text.length} chars of prose, need ${minProseChars}`);

    const seen = new Set();
    const refs = [
      ...[...document.querySelectorAll('a[href], link[href]')].map((node) => node.getAttribute('href')),
      ...[...document.querySelectorAll('img[src], script[src]')].map((node) => node.getAttribute('src')),
    ];
    for (const raw of refs) {
      if (!raw || raw.startsWith('#')) continue;
      let target;
      try {
        target = new URL(raw, url);
      } catch {
        fail('internal-link', `${raw} is not a valid URL`);
        continue;
      }
      if (target.origin !== origin) continue;
      const pathname = target.pathname;
      const shown = `${origin}${pathname}`;
      if (seen.has(shown)) continue;
      seen.add(shown);
      if (pathname.endsWith('/')) {
        if (!isFile(pageFile(pathname))) fail('internal-link', `${shown} is not in the build`);
      } else if (!isFile(path.join(outDir, decodeURIComponent(pathname)))) {
        fail('internal-link', isFile(pageFile(pathname))
          ? `${shown} redirects to ${pathname}/`
          : `${shown} is not in the build`);
      }
    }

    const alternates = readHreflang(document);
    hreflangCache.set(file, alternates);
    const byLang = new Map(alternates.map((entry) => entry.split(' ')));
    const missingLangs = REQUIRED_HREFLANG.filter((lang) => !byLang.has(lang));
    if (missingLangs.length > 0) fail('hreflang', `missing hreflang ${missingLangs.join(', ')}`);
    if (alternates.length > 0 && ![...byLang.values()].includes(url)) {
      fail('hreflang', `${url} is not in its own hreflang set`);
    }
    for (const [lang, href] of byLang) {
      if (href === url) continue;
      if (!isBuiltPage(href)) {
        fail('hreflang', `hreflang ${lang} -> ${href} is not a built page`);
        continue;
      }
      const other = hreflangSet(pageFile(new URL(href).pathname));
      if (other.join('\n') !== alternates.join('\n')) fail('hreflang', `hreflang is not reciprocal with ${href}`);
    }

    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        JSON.parse(script.textContent ?? '');
      } catch (error) {
        fail('json-ld', `JSON-LD does not parse: ${error.message}`);
      }
    }

    const wantsMirror = page.mirror ?? true;
    const mirrorHref = document.querySelector('link[rel~="alternate"][type="text/markdown"]')?.getAttribute('href');
    if (mirrorHref) {
      const mirrorFile = path.join(outDir, decodeURIComponent(new URL(mirrorHref, url).pathname));
      if (!isFile(mirrorFile)) fail('markdown-mirror', `${mirrorHref} is not in the build`);
      else if (markdownBody(fs.readFileSync(mirrorFile, 'utf8')).length === 0) fail('markdown-mirror', `${mirrorHref} has no body`);
    } else if (wantsMirror) {
      fail('markdown-mirror', 'no markdown mirror advertised');
    }

    return { ...result, ok: problems.length === 0, problems };
  });

  const sitemapFile = path.join(outDir, 'sitemap.xml');
  if (!isFile(sitemapFile)) {
    failures.push({ route: null, check: 'sitemap-file', detail: 'sitemap.xml was not emitted' });
  } else {
    const locs = [...fs.readFileSync(sitemapFile, 'utf8').matchAll(/<loc>(.*?)<\/loc>/g)].map(([, loc]) => loc);
    const listed = new Set(locs);
    for (const page of pages) {
      const url = ownUrl(siteUrl, page.route);
      if (!page.noindex && !listed.has(url)) {
        failures.push({ route: page.route, check: 'sitemap-missing', detail: `${url} is not in sitemap.xml` });
      }
    }
    const counted = new Set();
    for (const loc of locs) {
      if (counted.has(loc)) {
        failures.push({ route: urlToRoute.get(loc)?.route ?? null, check: 'sitemap-duplicate', detail: `${loc} is listed twice` });
        continue;
      }
      counted.add(loc);
      const owner = urlToRoute.get(loc);
      if (!owner) {
        failures.push({ route: null, check: 'sitemap-extra', detail: `${loc} is in sitemap.xml but no manifest route owns it` });
      } else if (owner.noindex) {
        failures.push({ route: owner.route, check: 'sitemap-extra', detail: `${loc} is in sitemap.xml but the page is noindex` });
      }
    }
  }

  return {
    summary: {
      pages: pages.length,
      indexable: pages.filter((page) => !page.noindex).length,
      failures: failures.length,
    },
    failures,
    pages: results,
  };
};
