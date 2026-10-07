#!/usr/bin/env node
// Audits the ASSEMBLED site (root + /next/ + /v/<minor>/) by following every
// URL a page advertises literally, as a crawler would: canonical, hreflang,
// og:url, markdown alternates, links, assets and #fragment targets. The
// per-build audit (build-audit.mjs) sees one build and cannot tell whether a
// root URL named by a snapshot exists.
//
// Usage: node docs/scripts/site-audit.mjs --dir <assembled site> [--enforce /next/]... [--report <file.json>]
// --enforce limits failing to pages under those prefixes (canonical, hreflang and
// og:url fail everywhere); the rest print as WARN counts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { JSDOM } from 'jsdom';

const SITE_URL = 'https://blokeditor.com';
// The body sentence src/seo/MarkdownPointer.tsx renders.
const MARKDOWN_POINTER = /A Markdown version of this page is available at (\S+?\.md)/;
// Root URLs a frozen snapshot names: they break when a LATER root drops a route,
// so they fail everywhere. Frozen tarballs keep their own old link defects.
const ALWAYS_ENFORCED = new Set(['canonical', 'hreflang', 'og-url']);

const isFile = (file) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

const servedPath = (siteDir, file) => {
  const rel = path.relative(siteDir, file).split(path.sep).join('/');
  if (rel === 'index.html') return '/';
  return rel.endsWith('/index.html') ? `/${rel.slice(0, -'index.html'.length)}` : `/${rel}`;
};

/**
 * @param {object} options
 * @param {string} options.siteDir  the assembled site, as Pages serves it
 * @param {string} options.siteUrl  production origin, no trailing slash
 * @param {string[]} [options.enforce]  page prefixes whose problems are failures; the
 *   rest are warnings, except ALWAYS_ENFORCED checks. Omitted, every problem is a failure.
 */
export const auditSite = async ({ siteDir, siteUrl, enforce }) => {
  const origin = new URL(siteUrl).origin;
  const htmlFiles = walk(siteDir).filter((file) => file.endsWith('.html')).sort();
  const failures = [];
  const idCache = new Map();

  const readIds = (document) => new Set([...document.querySelectorAll('[id]')].map((node) => node.id));
  const idsOf = (file) => {
    if (!idCache.has(file)) {
      const { window } = new JSDOM(fs.readFileSync(file, 'utf8'));
      idCache.set(file, readIds(window.document));
      window.close();
    }
    return idCache.get(file);
  };

  /** The file Pages answers a same-origin pathname with, or why it answers none. */
  const resolve = (pathname) => {
    const local = path.join(siteDir, decodeURIComponent(pathname));
    if (pathname.endsWith('/')) {
      const index = path.join(local, 'index.html');
      return isFile(index) ? { file: index } : { problem: 'not in the site' };
    }
    if (isFile(local)) return { file: local };
    return isFile(path.join(local, 'index.html'))
      ? { problem: `redirects to ${pathname}/` }
      : { problem: 'not in the site' };
  };

  for (const file of htmlFiles) {
    // window.close() frees a JSDOM window only once the event loop turns; a
    // synchronous loop over ~1,700 pages runs out of heap.
    await new Promise((resolveTurn) => setImmediate(resolveTurn));
    const from = servedPath(siteDir, file);
    const pageUrl = `${origin}${from}`;
    const { window } = new JSDOM(fs.readFileSync(file, 'utf8'));
    const { document } = window;
    if (!idCache.has(file)) idCache.set(file, readIds(document));

    const advertised = [
      ...[...document.querySelectorAll('link[rel~="canonical"]')].map((n) => ['canonical', n.getAttribute('href')]),
      ...[...document.querySelectorAll('link[rel~="alternate"][hreflang]')].map((n) => ['hreflang', n.getAttribute('href')]),
      ...[...document.querySelectorAll('link[rel~="alternate"][type="text/markdown"]')].map((n) => ['markdown', n.getAttribute('href')]),
      ...[...document.querySelectorAll('meta[property="og:url"]')].map((n) => ['og-url', n.getAttribute('content')]),
      ...[...document.querySelectorAll('link[href]:not([rel~="canonical"]):not([rel~="alternate"])')].map((n) => ['asset', n.getAttribute('href')]),
      ...[...document.querySelectorAll('script[src], img[src]')].map((n) => ['asset', n.getAttribute('src')]),
      ...[...document.querySelectorAll('a[href]')].map((n) => ['link', n.getAttribute('href')]),
    ];
    const pointer = MARKDOWN_POINTER.exec(document.body?.textContent ?? '');
    if (pointer) advertised.push(['markdown', pointer[1]]);
    window.close();

    const reported = new Set();
    const fail = (check, target, detail) => {
      const key = `${check} ${target}`;
      if (reported.has(key)) return;
      reported.add(key);
      failures.push({ page: from, check, target, detail });
    };

    for (const [check, raw] of advertised) {
      if (!raw) continue;
      let target;
      try {
        target = new URL(raw, pageUrl);
      } catch {
        fail(check, raw, 'not a valid URL');
        continue;
      }
      if (target.origin !== origin) continue;
      const shown = `${origin}${target.pathname}${target.hash}`;
      const { file: targetFile, problem } = resolve(target.pathname);
      if (problem) {
        fail(check, shown, problem);
        continue;
      }
      const fragment = target.hash.slice(1);
      // `#` alone and text fragments (`#:~:text=`) name no element.
      if (!fragment || fragment.startsWith(':~:') || !targetFile.endsWith('.html')) continue;
      const id = decodeURIComponent(fragment);
      if (!idsOf(targetFile).has(id)) {
        fail('fragment', shown, `no id="${id}" in ${servedPath(siteDir, targetFile)}`);
      }
    }
  }

  const enforced = ({ page, check }) =>
    !enforce || ALWAYS_ENFORCED.has(check) || enforce.some((prefix) => page.startsWith(prefix));
  const warnings = failures.filter((problem) => !enforced(problem));
  const errors = failures.filter(enforced);
  return {
    summary: { pages: htmlFiles.length, failures: errors.length, warnings: warnings.length },
    failures: errors,
    warnings,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { dir: { type: 'string' }, report: { type: 'string' }, enforce: { type: 'string', multiple: true } },
  });
  if (!values.dir) {
    console.error('Usage: site-audit.mjs --dir <assembled site> [--report <file.json>]');
    process.exit(1);
  }
  const siteDir = path.resolve(values.dir);
  const result = await auditSite({ siteDir, siteUrl: SITE_URL, enforce: values.enforce });
  if (values.report) {
    fs.mkdirSync(path.dirname(path.resolve(values.report)), { recursive: true });
    fs.writeFileSync(values.report, `${JSON.stringify({ generatedAt: new Date().toISOString(), siteDir, ...result }, null, 2)}\n`);
  }
  // Tens of thousands in old archives; the report has each one.
  const warnCounts = new Map();
  for (const { page, check } of result.warnings) {
    const key = `${page.match(/^\/v\/[^/]+\//)?.[0] ?? '/'} ${check}`;
    warnCounts.set(key, (warnCounts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of warnCounts) process.stdout.write(`WARN  ${key}: ${count}\n`);
  for (const { page, check, target, detail } of result.failures) {
    process.stdout.write(`FAIL  ${page} ${check} ${target}: ${detail}\n`);
  }
  const { pages, failures, warnings } = result.summary;
  process.stdout.write(`Site audit: ${pages} HTML files, ${failures} failures, ${warnings} warnings\n`);
  if (result.summary.failures > 0) process.exit(1);
}
