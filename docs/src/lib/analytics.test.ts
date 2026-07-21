import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GA_MEASUREMENT_ID,
  isAnalyticsEnabled,
  trackEvent,
  trackPageView,
  trackOutboundLink,
  ANALYTICS_EVENTS,
} from "./analytics";

const getGtagMock = () =>
  (window as unknown as { gtag?: ReturnType<typeof vi.fn> }).gtag;

const setGtag = (fn: unknown) => {
  (window as unknown as { gtag?: unknown }).gtag = fn;
};

describe("analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setGtag(vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { gtag?: unknown }).gtag;
  });

  describe("isAnalyticsEnabled", () => {
    it("is true when gtag has been installed", () => {
      expect(isAnalyticsEnabled()).toBe(true);
    });

    it("is false when gtag is absent", () => {
      delete (window as unknown as { gtag?: unknown }).gtag;
      expect(isAnalyticsEnabled()).toBe(false);
    });

    it("is false when gtag is not callable", () => {
      setGtag("not-a-function");
      expect(isAnalyticsEnabled()).toBe(false);
    });
  });

  describe("trackEvent", () => {
    it("forwards the event name and params to gtag", () => {
      trackEvent("copy_code", { language: "tsx", surface: "docs" });

      expect(getGtagMock()).toHaveBeenCalledWith("event", "copy_code", {
        language: "tsx",
        surface: "docs",
      });
    });

    it("sends an empty params object when none are supplied", () => {
      trackEvent("search_open");

      expect(getGtagMock()).toHaveBeenCalledWith("event", "search_open", {});
    });

    it("drops undefined params so GA does not record empty dimensions", () => {
      trackEvent("copy_code", { language: undefined, surface: "docs" });

      expect(getGtagMock()).toHaveBeenCalledWith("event", "copy_code", {
        surface: "docs",
      });
    });

    it("does not throw when analytics is unavailable", () => {
      delete (window as unknown as { gtag?: unknown }).gtag;

      expect(() => trackEvent("copy_code")).not.toThrow();
    });
  });

  describe("trackPageView", () => {
    it("sends a page_view with path, location and title", () => {
      trackPageView("/docs/paragraph", "Paragraph — Blok");

      expect(getGtagMock()).toHaveBeenCalledWith("event", "page_view", {
        page_path: "/docs/paragraph",
        page_location: `${window.location.origin}/docs/paragraph`,
        page_title: "Paragraph — Blok",
      });
    });

    it("falls back to the document title when none is given", () => {
      document.title = "Fallback Title";

      trackPageView("/demo");

      expect(getGtagMock()).toHaveBeenCalledWith(
        "event",
        "page_view",
        expect.objectContaining({ page_title: "Fallback Title" }),
      );
    });

    it("does not throw when analytics is unavailable", () => {
      delete (window as unknown as { gtag?: unknown }).gtag;

      expect(() => trackPageView("/demo")).not.toThrow();
    });
  });

  describe("trackOutboundLink", () => {
    it("records the destination url and a human label", () => {
      trackOutboundLink("https://github.com/JackUait/blok", "github_nav");

      expect(getGtagMock()).toHaveBeenCalledWith("event", "outbound_click", {
        link_url: "https://github.com/JackUait/blok",
        link_domain: "github.com",
        label: "github_nav",
      });
    });

    it("omits the domain for a url it cannot parse", () => {
      trackOutboundLink("not a url", "broken");

      expect(getGtagMock()).toHaveBeenCalledWith("event", "outbound_click", {
        link_url: "not a url",
        label: "broken",
      });
    });
  });

  describe("ANALYTICS_EVENTS", () => {
    it("keeps every event name within GA's 40-character limit", () => {
      for (const name of Object.values(ANALYTICS_EVENTS)) {
        expect(name.length).toBeLessThanOrEqual(40);
        expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    });
  });

  // LAW: the gtag loader lives in index.html because it must run before the
  // React bundle. If the snippet, the measurement id, or the manual page_view
  // wiring is dropped, every event above silently no-ops in production.
  describe("gtag loader snippet", () => {
    // The loader must run before the app bundle, so it lives in whichever file
    // owns the document <head>. That file depends on how the app is built:
    // a Vite SPA uses index.html, React Router framework mode uses root.tsx.
    // Resolve it by content rather than by name so a migration between the two
    // can't silently drop the tag and leave this suite passing against a stale
    // path.
    const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const LOADER_URL = "https://www.googletagmanager.com/gtag/js";

    const hosts = ["index.html", "src/root.tsx"]
      .map((relative) => resolve(docsRoot, relative))
      .filter((path) => existsSync(path))
      .map((path) => ({ path, source: readFileSync(path, "utf-8") }))
      .filter(({ source }) => source.includes(LOADER_URL));

    it("has exactly one file loading gtag.js", () => {
      // Two would load the tag twice and double-count every event — the likely
      // failure mode midway through an entry-point migration.
      expect(hosts.map(({ path }) => path)).toHaveLength(1);
    });

    it("loads the gtag.js library for the configured measurement id", () => {
      const [{ source }] = hosts;

      // The id may be inlined (index.html) or interpolated from a local
      // constant (root.tsx), so assert the id is declared and that the loader
      // URL and config call are both present, rather than pinning one spelling.
      expect(source).toContain(GA_MEASUREMENT_ID);
      expect(source).toContain(`${LOADER_URL}?id=`);
      expect(source).toContain("gtag('config'");
    });

    it("disables automatic page_view so the SPA router owns them", () => {
      const [{ source }] = hosts;

      expect(source).toContain("send_page_view: false");
    });

    it("opts localhost out so dev traffic never reaches the property", () => {
      const [{ source }] = hosts;

      expect(source).toContain(`ga-disable-${GA_MEASUREMENT_ID}`);
      expect(source).toContain("localhost");
    });
  });
});
