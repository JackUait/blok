/**
 * Architectural enforcement: navigation must be `<a href>`, not an onClick handler.
 *
 * The incident: the entire crawlable link graph for 57 documentation pages hung
 * on one `hidden lg:block` sidebar whose non-active groups were collapsed by
 * default, because the mobile section nav, the search palette, and the homepage
 * category strip all navigated through `navigate()` inside `onClick`. A
 * `<button onClick={() => navigate(path)}>` is invisible to a crawler: there is
 * no URL in the markup, so the destination is not discovered, not queued, and
 * not passed any link equity — and on the mobile viewport, where the only
 * sidebar is display:none, the site had no internal links at all.
 *
 * The root-cause fix was to put the address on the element: every one of those
 * surfaces now renders a real `<Link to=…>` (an `<a href>` in the DOM), and the
 * click handler that remains does side effects only — analytics, closing the
 * dialog, swapping the inline panel — while a modified click still opens the
 * real route in a new tab. Keyboard-only paths (Enter inside the search
 * palette) still call `navigate()`, which is correct: a keydown has no anchor
 * to follow, and it is not what a crawler reads.
 *
 * The law: in `docs/src/components/**` and `docs/src/pages/**`, a JSX `onClick`
 * on an element that is not a `Link` / `NavLink` / `<a>` may not reach
 * `navigate()`, directly or through a handler declared in the same file. Every
 * exception must be listed below WITH a reason.
 *
 * Placement: at the repo root, not in docs/. `docs/vitest.config.ts` collects
 * only `docs/src/**` and that suite runs in the deploy workflow; root
 * `test/unit/**` runs in the gating CI job, so a link graph regression fails the
 * check that blocks the merge. The scan is plain `node:fs`, so it can read the
 * docs tree from here.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SCAN_ROOTS = ['docs/src/components', 'docs/src/pages', 'docs/src/routes'];

/** Elements that carry the destination in their own markup. */
const ANCHOR_TAGS = new Set(['a', 'Link', 'NavLink']);

/**
 * Handlers allowed to navigate imperatively, keyed by `<relative path>:<tag>`.
 * Every entry MUST carry a written reason — an empty one fails the test below —
 * so a silenced hit always leaves behind the argument for silencing it.
 *
 * Empty today: every navigating click in the docs tree sits on a real anchor.
 * The legitimate shape, if one appears, is a side effect ON a Link (closing a
 * dialog, reporting analytics), which is already exempt by tag.
 */
const EXEMPT_ONCLICK_NAVIGATION: Record<string, string> = {};

const collectSourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const abs = join(dir, entry);

    return statSync(abs).isDirectory()
      ? collectSourceFiles(abs)
      : [abs].filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));
  });

/**
 * The source from `start` (a `{`, `(` or `[`) through its matching close.
 * Returns an empty string if the brackets never balance.
 */
const balancedSlice = (source: string, start: number): string => {
  const pairs: Record<string, string> = { '{': '}', '(': ')', '[': ']' };
  const stack: string[] = [];

  for (let i = start; i < source.length; i += 1) {
    const char = source[i];

    if (pairs[char]) {
      stack.push(pairs[char]);
      continue;
    }

    if (char !== stack[stack.length - 1]) continue;

    stack.pop();

    if (stack.length === 0) return source.slice(start, i + 1);
  }

  return '';
};

/**
 * Names declared in this file whose body calls `navigate()` — the indirection
 * the original defect hid behind (`onClick={() => handleResultClick(result)}`).
 */
const navigatingNames = (source: string): Set<string> => {
  const names = new Set<string>();
  const declaration = /\b(?:const|let|function)\s+([A-Za-z_$][\w$]*)\s*(?:=|\()/g;
  let match: RegExpExecArray | null;

  while ((match = declaration.exec(source)) !== null) {
    const bodyStart = source.indexOf(source[match.index + match[0].length - 1] === '(' ? '(' : '=', match.index);
    const body = balancedSlice(source, source.indexOf('{', bodyStart)) || source.slice(bodyStart, bodyStart + 600);

    if (/\bnavigate\s*\(/.test(body)) names.add(match[1]);
  }

  return names;
};

/** The JSX tag an attribute at `index` belongs to: the nearest opening tag before it. */
const enclosingTag = (source: string, index: number): string => {
  const before = source.slice(0, index);
  const tags = [...before.matchAll(/<([A-Za-z][\w.]*)/g)];

  return tags.length > 0 ? tags[tags.length - 1][1] : 'unknown';
};

export interface OnClickNavigation {
  tag: string;
  handler: string;
}

/** Every JSX `onClick` that navigates imperatively from a non-anchor element. */
const findOnClickNavigation = (source: string): OnClickNavigation[] => {
  const navigators = navigatingNames(source);
  const hits: OnClickNavigation[] = [];
  const attribute = /\bonClick=\{/g;
  let match: RegExpExecArray | null;

  while ((match = attribute.exec(source)) !== null) {
    const handler = balancedSlice(source, match.index + match[0].length - 1);
    const tag = enclosingTag(source, match.index);

    if (ANCHOR_TAGS.has(tag)) continue;

    const navigates =
      /\bnavigate\s*\(/.test(handler) ||
      [...navigators].some((name) => new RegExp(`\\b${name}\\s*\\(`).test(handler));

    if (navigates) hits.push({ tag, handler: handler.replace(/\s+/g, ' ').slice(0, 120) });
  }

  return hits;
};

const files = SCAN_ROOTS.flatMap((root) => collectSourceFiles(resolve(REPO_ROOT, root)));
const sources = files.map((file) => [relative(REPO_ROOT, file), readFileSync(file, 'utf8')] as const);

describe('docs crawlable navigation law', () => {
  it('never navigates from an onClick on a non-anchor element', () => {
    const offenders = sources.flatMap(([path, source]) =>
      findOnClickNavigation(source)
        .filter((hit) => !(`${path}:${hit.tag}` in EXEMPT_ONCLICK_NAVIGATION))
        .map((hit) => `${path}: <${hit.tag} onClick=${hit.handler}>`),
    );

    expect(
      offenders,
      'these destinations exist only in a click handler, so no crawler can reach them. ' +
        'Render a <Link to=…> and keep the handler for side effects, or add an entry to ' +
        `EXEMPT_ONCLICK_NAVIGATION with the reason:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('carries a non-empty reason for every exemption', () => {
    const unjustified = Object.entries(EXEMPT_ONCLICK_NAVIGATION)
      .filter(([, reason]) => reason.trim().length === 0)
      .map(([key]) => key);

    expect(unjustified, 'every exemption must state why that click cannot be an anchor').toEqual([]);
  });

  it('lists no exemption for a file that no longer exists', () => {
    const known = new Set(sources.map(([path]) => path));
    const stale = Object.keys(EXEMPT_ONCLICK_NAVIGATION).filter(
      (key) => !known.has(key.slice(0, key.lastIndexOf(':'))),
    );

    expect(stale, `stale exemptions: ${stale.join(', ')}`).toEqual([]);
  });
});

/**
 * Second half of the same law: a crawlable link is only useful if it lands in
 * the tree the reader is already in.
 *
 * The incident: `/ru/**` shipped as a second absolute route table (no router
 * `basename`), while every link in the app stayed written as its English
 * address — `to="/docs/table"`, `NAV_LINKS`, `buildHref={(id) => `/docs/${id}`}`.
 * The built `dist/client/ru/docs/table/index.html` carried 68 internal hrefs of
 * which exactly ONE (the language switcher's self-link) stayed in the Russian
 * tree. A reader was dumped back into English by any sidebar, nav, breadcrumb,
 * pagination or footer click, and the 63 prerendered Russian URLs had no
 * internal inbound links at all — reachable only via hreflang and the sitemap.
 *
 * The root-cause fix is one wrapper: `docs/src/components/common/Link.tsx` maps
 * a site-absolute address into the current locale tree, and everything under
 * components/, pages/ and routes/ imports `Link` from there instead of from
 * react-router-dom. This law keeps it that way.
 */
const ROUTER_LINK_IMPORT = /^import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*['"]react-router-dom['"]/gm;

/** The local names imported from react-router-dom by one source file. */
const routerImportBindings = (source: string): string[] =>
  [...source.matchAll(ROUTER_LINK_IMPORT)].flatMap((match) =>
    match[1]
      .split(',')
      .map((binding) => binding.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
      .filter(Boolean),
  );

/** True when a file reaches past the wrapper for react-router's own anchor. */
const importsRouterLink = (source: string): boolean =>
  routerImportBindings(source).some((name) => name === 'Link' || name === 'NavLink');

/**
 * Files allowed to import react-router's `Link` directly. Every entry MUST
 * carry a written reason; an empty one fails the test below.
 */
const EXEMPT_ROUTER_LINK_IMPORTS: Record<string, string> = {
  'docs/src/components/common/Link.tsx':
    'The wrapper itself — it is the thing that maps the address into the current locale tree.',
  'docs/src/components/common/LanguageSelector.tsx':
    'The language switch crosses trees on purpose and already builds a fully-qualified address ' +
    '(useLocalePath); mapping it again would emit /ru/ru/docs/table.',
  'docs/src/components/layout/Footer.tsx':
    'Same: the footer language switch is a deliberate cross-locale link (imported as ' +
    'CrossLocaleLink). Its column links use the wrapper.',
};

/** Any import of the locale-aware wrapper, whatever the relative depth. */
const importsLocaleLink = (source: string): boolean =>
  /^import\s*\{[^}]*\bLink\b[^}]*\}\s*from\s*['"][^'"]*\/Link['"]/m.test(source);

describe('docs locale-aware navigation law', () => {
  it('routes every internal link through the locale-aware wrapper', () => {
    const offenders = sources
      .filter(([path, source]) => importsRouterLink(source) && !(path in EXEMPT_ROUTER_LINK_IMPORTS))
      .map(([path]) => path);

    expect(
      offenders,
      "react-router's Link renders the English address verbatim, so on /ru/** it navigates out " +
        'of the Russian tree. Import { Link } from the components/common/Link wrapper, or add an ' +
        `entry to EXEMPT_ROUTER_LINK_IMPORTS with the reason:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('carries a non-empty reason for every exemption', () => {
    const unjustified = Object.entries(EXEMPT_ROUTER_LINK_IMPORTS)
      .filter(([, reason]) => reason.trim().length === 0)
      .map(([key]) => key);

    expect(unjustified, 'every exemption must state why that link may skip the wrapper').toEqual([]);
  });

  it('lists no exemption for a file that no longer exists', () => {
    const known = new Set(sources.map(([path]) => path));
    const stale = Object.keys(EXEMPT_ROUTER_LINK_IMPORTS).filter((path) => !known.has(path));

    expect(stale, `stale exemptions: ${stale.join(', ')}`).toEqual([]);
  });

  it('detects the exact shape of the original defect, and clears the fixed one', () => {
    expect(importsRouterLink("import { Link } from 'react-router-dom';")).toBe(true);
    expect(importsRouterLink('import { Link, useLocation } from "react-router-dom";')).toBe(true);
    expect(importsRouterLink("import { Link as RouterLink } from 'react-router-dom';")).toBe(true);
    // The fixed shape: router hooks stay, the anchor comes from the wrapper.
    expect(importsRouterLink("import { useNavigate } from 'react-router-dom';")).toBe(false);
    // `LinkProps` is not `Link` — a substring match here would exempt nothing.
    expect(importsRouterLink("import { type LinkProps } from 'react-router-dom';")).toBe(false);
  });

  // Without this the law passes trivially the day the wrapper is deleted.
  it('sees the wrapper actually in use across the tree', () => {
    const wrapped = sources.filter(([, source]) => importsLocaleLink(source)).length;

    expect(wrapped, 'no component imports the locale-aware Link — the wrapper is gone').toBeGreaterThanOrEqual(15);
  });
});

describe('docs crawlable navigation law — non-vacuity floor', () => {
  // A broken glob, a renamed directory or a scanner that silently stops
  // matching would otherwise turn the law above into an assertion about nothing.
  it('scans the whole docs component and page tree', () => {
    expect(files.length).toBeGreaterThanOrEqual(60);
  });

  it('sees the real link graph and the real click handlers', () => {
    const withLinks = sources.filter(([, source]) => source.includes('<Link')).length;
    const onClicks = sources.reduce(
      (total, [, source]) => total + (source.match(/\bonClick=\{/g) ?? []).length,
      0,
    );

    expect(withLinks, 'no <Link> found — the scan is not reading the real components').toBeGreaterThanOrEqual(10);
    expect(onClicks, 'no onClick found — the attribute scan is not matching').toBeGreaterThanOrEqual(20);
  });

  it('still detects the exact shape of the original defect', () => {
    // The pre-fix search palette, verbatim in shape: a button whose handler
    // navigates through a named callback. If the detector ever stops flagging
    // this, the law is decorative.
    const historical = [
      'const handleResultClick = useCallback((result, index) => {',
      '  trackEvent(ANALYTICS_EVENTS.searchResultSelect, { result_index: index });',
      '  navigate(result.path);',
      '}, [navigate]);',
      'export const Search = () => (',
      '  <button type="button" onClick={() => handleResultClick(result, index)}>',
      '    {result.title}',
      '  </button>',
      ');',
    ].join('\n');

    expect(findOnClickNavigation(historical)).toEqual([
      { tag: 'button', handler: '{() => handleResultClick(result, index)}' },
    ]);
  });

  it('does not flag the fixed shape: a Link whose handler only does side effects', () => {
    const fixed = [
      'const trackResultSelect = useCallback((result, index) => {',
      '  trackEvent(ANALYTICS_EVENTS.searchResultSelect, { result_index: index });',
      '  handleClose();',
      '}, [handleClose]);',
      'export const Search = () => (',
      '  <Link to={resultHref(result)} onClick={() => trackResultSelect(result, index)}>',
      '    {result.title}',
      '  </Link>',
      ');',
    ].join('\n');

    expect(findOnClickNavigation(fixed)).toEqual([]);
  });
});
