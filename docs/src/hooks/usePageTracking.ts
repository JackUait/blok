import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { trackPageView } from "@/lib/analytics";
import { useFramework } from "@/contexts/FrameworkContext";
import { localizedPath, servedPath, splitLocalePath } from "@/seo/locales";

const KNOWN_SECTIONS = ["demo", "docs", "migration", "changelog"] as const;

/**
 * Not part of the page: FrameworkProvider rewrites it on every toggle and
 * re-applies it after link navigation, so keeping it would count each of those
 * as a page view. It goes out as the `framework` dimension instead.
 */
const FRAMEWORK_PARAM = "framework";

/**
 * Coarse grouping for GA reports. `page_path` alone splits `/docs/*` across
 * dozens of rows; the section lets a report answer "how much traffic do the
 * docs get" without maintaining a path regex inside GA.
 */
export const getPageSection = (pathname: string): string => {
  const segment = splitLocalePath(pathname).path.split("/").filter(Boolean)[0];

  if (!segment) {
    return "home";
  }

  return KNOWN_SECTIONS.find((section) => section === segment) ?? segment;
};

const pageQuery = (search: string): string => {
  const params = new URLSearchParams(search);
  params.delete(FRAMEWORK_PARAM);
  const query = params.toString();
  return query ? `?${query}` : "";
};

/**
 * Sends a GA4 page view on every route change.
 *
 * gtag is configured with `send_page_view: false` in root.tsx, so this hook
 * is the only source of page views — client-side navigation never reloads the
 * document, and without it GA would only ever see the entry URL.
 *
 * The page is the localized path plus its query minus `framework`. Other
 * params stay: `?view=` switches the home panel, and utm/gclid in
 * page_location carry source attribution. The hash is ignored: in-page anchors
 * are the same page (`docs_section_jump` records them).
 */
export const usePageTracking = (): void => {
  const { pathname, search } = useLocation();
  const { framework } = useFramework();
  const frameworkRef = useRef(framework);
  frameworkRef.current = framework;
  const lastTracked = useRef<string | null>(null);

  const { locale, path: contentPath } = splitLocalePath(pathname);
  const pagePath = `${servedPath(localizedPath(contentPath, locale))}${pageQuery(search)}`;

  useEffect(() => {
    // StrictMode double-invokes effects in development; without this guard
    // every page view would be counted twice locally.
    if (lastTracked.current === pagePath) {
      return;
    }
    lastTracked.current = pagePath;

    trackPageView(pagePath, undefined, {
      page_location: `${window.location.origin}${pagePath}`,
      page_section: getPageSection(contentPath),
      content_path: servedPath(contentPath),
      locale,
      framework: frameworkRef.current,
    });
  }, [pagePath, contentPath, locale]);
};
