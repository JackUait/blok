import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { trackPageView } from "@/lib/analytics";

const KNOWN_SECTIONS = ["demo", "docs", "migration", "changelog"] as const;

/**
 * Coarse grouping for GA reports. `page_path` alone splits `/docs/*` across
 * dozens of rows; the section lets a report answer "how much traffic do the
 * docs get" without maintaining a path regex inside GA.
 */
export const getPageSection = (pathname: string): string => {
  const segment = pathname.split("/").filter(Boolean)[0];

  if (!segment) {
    return "home";
  }

  return KNOWN_SECTIONS.find((section) => section === segment) ?? segment;
};

/**
 * Sends a GA4 page view on every route change.
 *
 * gtag is configured with `send_page_view: false` in index.html, so this hook
 * is the only source of page views — client-side navigation never reloads the
 * document, and without it GA would only ever see the entry URL.
 *
 * Hash changes are deliberately excluded: in-page anchors (the "On this page"
 * rail, heading links) are the same page, and counting them would inflate every
 * long docs page.
 */
export const usePageTracking = (): void => {
  const { pathname, search } = useLocation();
  const lastTracked = useRef<string | null>(null);

  useEffect(() => {
    const path = `${pathname}${search}`;

    // StrictMode double-invokes effects in development; without this guard
    // every page view would be counted twice locally.
    if (lastTracked.current === path) {
      return;
    }
    lastTracked.current = path;

    trackPageView(path, undefined, { page_section: getPageSection(pathname) });
  }, [pathname, search]);
};
