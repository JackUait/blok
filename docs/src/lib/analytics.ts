/**
 * Google Analytics (GA4) wrapper for the docs site.
 *
 * The gtag.js loader lives in `index.html` so it runs before the React bundle.
 * It is configured with `send_page_view: false` — this is a single-page app, so
 * the router sends page views itself (see `usePageTracking`); leaving GA's
 * automatic page view on would record only the entry URL and miss every
 * in-app navigation.
 *
 * Every helper here is a no-op when gtag is missing (unit tests, dev builds
 * where the loader is skipped, or a blocked script), so call sites never need
 * to guard.
 */

export const GA_MEASUREMENT_ID = "G-P4F8SK0C03";

type GtagFn = (...args: unknown[]) => void;

/** GA4 parameter values: strings, numbers and booleans only. */
export type AnalyticsParams = Record<
  string,
  string | number | boolean | undefined
>;

const getGtag = (): GtagFn | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const candidate = (window as Window & { gtag?: unknown }).gtag;

  return typeof candidate === "function" ? (candidate as GtagFn) : null;
};

export const isAnalyticsEnabled = (): boolean => getGtag() !== null;

/** Strip undefined values — GA records them as empty dimensions otherwise. */
const compact = (params: AnalyticsParams): AnalyticsParams =>
  Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined),
  );

export const trackEvent = (name: string, params: AnalyticsParams = {}): void => {
  getGtag()?.("event", name, compact(params));
};

export const trackPageView = (
  path: string,
  title?: string,
  params: AnalyticsParams = {},
): void => {
  const gtag = getGtag();
  if (!gtag) {
    return;
  }

  gtag("event", "page_view", {
    page_path: path,
    page_location: `${window.location.origin}${path}`,
    page_title: title ?? document.title,
    ...compact(params),
  });
};

/**
 * Outbound clicks leave the site, so GA cannot infer them from page views.
 * `link_domain` is what makes the report readable (github vs npm vs docs of a
 * framework) — it is omitted when the url is not parseable rather than guessed.
 */
export const trackOutboundLink = (url: string, label: string): void => {
  let domain: string | undefined;

  try {
    domain = new URL(url).hostname;
  } catch {
    domain = undefined;
  }

  trackEvent(ANALYTICS_EVENTS.outboundClick, {
    link_url: url,
    link_domain: domain,
    label,
  });
};

/**
 * Canonical event names. GA4 requires snake_case, ≤40 characters, and treats
 * every distinct string as a separate event — so they are centralised here
 * rather than typed as literals at each call site.
 */
export const ANALYTICS_EVENTS = {
  outboundClick: "outbound_click",

  // Navigation / discovery
  searchOpen: "search_open",
  searchQuery: "search_query",
  searchResultSelect: "search_result_select",
  searchNoResults: "search_no_results",
  navLinkClick: "nav_link_click",

  // Content interaction
  copyCode: "copy_code",
  selectFramework: "select_framework",
  selectPackageManager: "select_package_manager",
  selectLanguage: "select_language",
  toggleTheme: "toggle_theme",

  // Demo playground
  demoEditorReady: "demo_editor_ready",
  demoAction: "demo_action",

  // Long-form pages
  changelogVersionOpen: "changelog_version_open",
  migrationStepView: "migration_step_view",
} as const;

export type AnalyticsEventName =
  (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];
