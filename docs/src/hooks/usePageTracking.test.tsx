import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useNavigate, type NavigateFunction } from "react-router";
import { StrictMode, useEffect } from "react";
import { usePageTracking, getPageSection } from "./usePageTracking";
import { FrameworkProvider, useFramework, type Framework } from "@/contexts/FrameworkContext";

const gtag = vi.fn();

const Tracked = () => {
  usePageTracking();
  return null;
};

/** Navigates once on mount so we can assert the second page view. */
const NavigateOnMount = ({ to }: { to: string }) => {
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to);
  }, [navigate, to]);
  return null;
};

/** Hands the test the router's navigate and the framework setter. */
const Controls = ({
  onReady,
}: {
  onReady: (navigate: NavigateFunction, setFramework: (framework: Framework) => void) => void;
}) => {
  const navigate = useNavigate();
  const { setFramework } = useFramework();
  useEffect(() => {
    onReady(navigate, setFramework);
  }, [navigate, setFramework, onReady]);
  return null;
};

type PageViewParams = Record<string, unknown>;

const pageViewCalls = () =>
  gtag.mock.calls.filter(([command, name]) => command === "event" && name === "page_view");

const pageViews = (): PageViewParams[] => pageViewCalls().map((call) => call[2] as PageViewParams);

/** Mounts the hook the way root.tsx does: inside the router and FrameworkProvider. */
const renderTracked = (entry: string, basename?: string) => {
  const handles: {
    navigate?: NavigateFunction;
    setFramework?: (framework: Framework) => void;
  } = {};

  render(
    <MemoryRouter initialEntries={[entry]} basename={basename}>
      <FrameworkProvider>
        <Tracked />
        <Controls
          onReady={(navigate, setFramework) => {
            handles.navigate = navigate;
            handles.setFramework = setFramework;
          }}
        />
      </FrameworkProvider>
    </MemoryRouter>,
  );

  const navigate = (to: string) =>
    act(() => {
      void handles.navigate?.(to);
    });
  const setFramework = (framework: Framework) =>
    act(() => {
      handles.setFramework?.(framework);
    });

  return { navigate, setFramework };
};

describe("usePageTracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (window as unknown as { gtag?: unknown }).gtag = gtag;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    localStorage.clear();
    delete (window as unknown as { gtag?: unknown }).gtag;
  });

  it("sends a page view for the entry route", () => {
    renderTracked("/docs/paragraph");

    expect(pageViews()).toHaveLength(1);
    expect(pageViews()[0]).toMatchObject({ page_path: "/docs/paragraph/" });
  });

  it("splits a localized path into locale, section and content path", () => {
    renderTracked("/ru/docs/quick-start/");

    expect(pageViews()).toHaveLength(1);
    expect(pageViews()[0]).toMatchObject({
      locale: "ru",
      page_section: "docs",
      content_path: "/docs/quick-start/",
      page_path: "/ru/docs/quick-start/",
    });
  });

  it("reports the default locale and the canonical trailing slash", () => {
    renderTracked("/docs/quick-start");

    expect(pageViews()[0]).toMatchObject({
      locale: "en",
      page_section: "docs",
      content_path: "/docs/quick-start/",
    });
  });

  it("maps the localized root to the home section", () => {
    renderTracked("/ru");

    expect(pageViews()[0]).toMatchObject({
      locale: "ru",
      page_section: "home",
      content_path: "/",
      page_path: "/ru/",
    });
  });

  it("sends the framework as a dimension, not as part of the page", () => {
    renderTracked("/docs/quick-start/?framework=vue");

    expect(pageViews()[0]).toMatchObject({
      framework: "vue",
      page_path: "/docs/quick-start/",
      page_location: `${window.location.origin}/docs/quick-start/`,
    });
  });

  it("keeps campaign parameters in page_location for source attribution", () => {
    renderTracked("/docs/quick-start/?utm_source=newsletter&framework=react&gclid=abc");

    expect(pageViews()[0]).toMatchObject({
      page_location: `${window.location.origin}/docs/quick-start/?utm_source=newsletter&gclid=abc`,
      framework: "react",
    });
  });

  it("does not send a page view when the framework changes", () => {
    const { setFramework } = renderTracked("/docs/quick-start/");

    setFramework("angular");

    expect(pageViews()).toHaveLength(1);
  });

  it("sends exactly one page view on a route change even when the framework param is re-applied", () => {
    localStorage.setItem("blok-docs-framework", "vue");
    const { navigate } = renderTracked("/docs/quick-start/");
    gtag.mockClear();

    navigate("/docs/configuration");

    expect(pageViews()).toHaveLength(1);
    expect(pageViews()[0]).toMatchObject({
      content_path: "/docs/configuration/",
      framework: "vue",
    });
  });

  it("does not send a page view when only the hash changes", () => {
    const { navigate } = renderTracked("/docs/blocks");

    navigate("/docs/blocks#insert");

    expect(pageViews()).toHaveLength(1);
  });

  it("sends a page view when the locale changes on the same page", () => {
    const { navigate } = renderTracked("/docs/blocks/");

    navigate("/ru/docs/blocks/");

    expect(pageViews()).toHaveLength(2);
    expect(pageViews()[1]).toMatchObject({ locale: "ru", content_path: "/docs/blocks/" });
  });

  it("still counts a home view switch as a page view", () => {
    const { navigate } = renderTracked("/");

    navigate("/?view=tools");

    expect(pageViews().map((view) => view.page_path)).toEqual(["/", "/?view=tools"]);
  });

  it("sends a further page view when the route changes", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <FrameworkProvider>
          <Tracked />
          <Routes>
            <Route path="/" element={<NavigateOnMount to="/demo" />} />
            <Route path="/demo" element={null} />
          </Routes>
        </FrameworkProvider>
      </MemoryRouter>,
    );

    expect(pageViews().map((view) => view.page_path)).toEqual(["/", "/demo/"]);
  });

  it("does not double count under StrictMode", () => {
    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/docs/blocks"]}>
          <FrameworkProvider>
            <Tracked />
          </FrameworkProvider>
        </MemoryRouter>
      </StrictMode>,
    );

    expect(pageViews()).toHaveLength(1);
  });

  describe("per docs build", () => {
    /** Mirrors build-snapshot.mjs: DOCS_BASE is both the vite base and the router basename. */
    const build = (base: string, version: string) => {
      vi.stubEnv("BASE_URL", base);
      vi.stubEnv("VITE_DOCS_VERSION", version);
    };

    it("reports the stable root as is, tagged with its minor", () => {
      build("/", "1.16");
      renderTracked("/docs/quick-start/");

      expect(pageViews()[0]).toMatchObject({
        page_location: `${window.location.origin}/docs/quick-start/`,
        page_path: "/docs/quick-start/",
        content_path: "/docs/quick-start/",
        docs_channel: "stable",
        docs_version: "1.16",
        locale: "en",
      });
    });

    it("keeps the /next/ prefix in the reported URL", () => {
      build("/next/", "next");
      renderTracked("/next/docs/quick-start/", "/next");

      expect(pageViews()[0]).toMatchObject({
        page_location: `${window.location.origin}/next/docs/quick-start/`,
        page_path: "/next/docs/quick-start/",
        content_path: "/docs/quick-start/",
        docs_channel: "next",
        docs_version: "next",
        locale: "en",
      });
    });

    it("reports the /next/ home with its trailing slash", () => {
      build("/next/", "next");
      renderTracked("/next/", "/next");

      expect(pageViews()[0]).toMatchObject({
        page_location: `${window.location.origin}/next/`,
        page_section: "home",
        content_path: "/",
      });
    });

    it("keeps the prefix on a Russian page under /next/", () => {
      build("/next/", "next");
      renderTracked("/next/ru/docs/blocks", "/next");

      expect(pageViews()[0]).toMatchObject({
        page_location: `${window.location.origin}/next/ru/docs/blocks/`,
        page_path: "/next/ru/docs/blocks/",
        content_path: "/docs/blocks/",
        page_section: "docs",
        locale: "ru",
        docs_channel: "next",
      });
    });

    it("keeps the archive prefix and strips only the framework param", () => {
      build("/v/1.14/", "1.14");
      renderTracked("/v/1.14/docs/quick-start/?utm_source=x&framework=vue", "/v/1.14");

      expect(pageViews()[0]).toMatchObject({
        page_location: `${window.location.origin}/v/1.14/docs/quick-start/?utm_source=x`,
        page_path: "/v/1.14/docs/quick-start/?utm_source=x",
        content_path: "/docs/quick-start/",
        framework: "vue",
        docs_channel: "archive",
        docs_version: "1.14",
        locale: "en",
      });
    });

    it("tracks an archive navigation under the same prefix", () => {
      build("/v/1.14/", "1.14");
      const { navigate } = renderTracked("/v/1.14/", "/v/1.14");

      navigate("/ru/docs/table");

      expect(pageViews().map((view) => view.page_location)).toEqual([
        `${window.location.origin}/v/1.14/`,
        `${window.location.origin}/v/1.14/ru/docs/table/`,
      ]);
    });
  });

  it("does not throw when analytics is unavailable", () => {
    delete (window as unknown as { gtag?: unknown }).gtag;

    expect(() => renderTracked("/")).not.toThrow();
  });
});

describe("getPageSection", () => {
  it.each([
    ["/", "home"],
    ["/demo", "demo"],
    ["/docs/paragraph", "docs"],
    ["/migration", "migration"],
    ["/migration/reference", "migration"],
    ["/changelog", "changelog"],
    ["/ru", "home"],
    ["/ru/docs/quick-start/", "docs"],
    ["/ru/migration/reference", "migration"],
  ])("maps %s to the %s section", (pathname, section) => {
    expect(getPageSection(pathname)).toBe(section);
  });

  it("falls back to the first content segment for unknown routes", () => {
    expect(getPageSection("/something-new/deep")).toBe("something-new");
    expect(getPageSection("/ru/something-new/deep")).toBe("something-new");
  });
});
