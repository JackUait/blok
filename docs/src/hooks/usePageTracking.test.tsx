import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { usePageTracking, getPageSection } from "./usePageTracking";

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

const pageViewCalls = () =>
  gtag.mock.calls.filter(([command, name]) => command === "event" && name === "page_view");

describe("usePageTracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as unknown as { gtag?: unknown }).gtag = gtag;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { gtag?: unknown }).gtag;
  });

  it("sends a page view for the entry route", () => {
    render(
      <MemoryRouter initialEntries={["/docs/paragraph"]}>
        <Tracked />
      </MemoryRouter>,
    );

    expect(pageViewCalls()).toHaveLength(1);
    expect(pageViewCalls()[0][2]).toMatchObject({
      page_path: "/docs/paragraph",
    });
  });

  it("sends a further page view when the route changes", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Tracked />
        <Routes>
          <Route path="/" element={<NavigateOnMount to="/demo" />} />
          <Route path="/demo" element={null} />
        </Routes>
      </MemoryRouter>,
    );

    const paths = pageViewCalls().map((call) => (call[2] as { page_path: string }).page_path);
    expect(paths).toEqual(["/", "/demo"]);
  });

  it("includes the query string in the tracked path", () => {
    render(
      <MemoryRouter initialEntries={["/docs/blocks?framework=vue"]}>
        <Tracked />
      </MemoryRouter>,
    );

    expect(pageViewCalls()[0][2]).toMatchObject({
      page_path: "/docs/blocks?framework=vue",
    });
  });

  it("does not resend a page view when only the hash changes", () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={["/docs/blocks"]}>
        <Tracked />
      </MemoryRouter>,
    );
    rerender(
      <MemoryRouter initialEntries={["/docs/blocks"]}>
        <Tracked />
      </MemoryRouter>,
    );

    expect(pageViewCalls()).toHaveLength(1);
  });

  it("does not throw when analytics is unavailable", () => {
    delete (window as unknown as { gtag?: unknown }).gtag;

    expect(() =>
      render(
        <MemoryRouter initialEntries={["/"]}>
          <Tracked />
        </MemoryRouter>,
      ),
    ).not.toThrow();
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
  ])("maps %s to the %s section", (pathname, section) => {
    expect(getPageSection(pathname)).toBe(section);
  });

  it("falls back to the first path segment for unknown routes", () => {
    expect(getPageSection("/something-new/deep")).toBe("something-new");
  });
});
