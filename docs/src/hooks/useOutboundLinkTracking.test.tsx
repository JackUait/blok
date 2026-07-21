import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useOutboundLinkTracking } from "./useOutboundLinkTracking";

const gtag = vi.fn();

const outboundCalls = () =>
  gtag.mock.calls.filter(([command, name]) => command === "event" && name === "outbound_click");

const Harness = ({ children }: { children: React.ReactNode }) => {
  useOutboundLinkTracking();
  return <>{children}</>;
};

describe("useOutboundLinkTracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as unknown as { gtag?: unknown }).gtag = gtag;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { gtag?: unknown }).gtag;
  });

  it("tracks a click on a link to another origin", async () => {
    render(
      <Harness>
        <a href="https://github.com/JackUait/blok">GitHub</a>
      </Harness>,
    );

    await userEvent.click(screen.getByRole("link", { name: "GitHub" }));

    expect(outboundCalls()).toHaveLength(1);
    expect(outboundCalls()[0][2]).toMatchObject({
      link_url: "https://github.com/JackUait/blok",
      link_domain: "github.com",
    });
  });

  it("uses the link text as the label", async () => {
    render(
      <Harness>
        <a href="https://www.npmjs.com/package/@bloklabs/core">npm package</a>
      </Harness>,
    );

    await userEvent.click(screen.getByRole("link", { name: "npm package" }));

    expect(outboundCalls()[0][2]).toMatchObject({ label: "npm package" });
  });

  it("falls back to the aria-label when the link has no text", async () => {
    render(
      <Harness>
        <a href="https://t.me/jackuait" aria-label="Telegram">
          <svg />
        </a>
      </Harness>,
    );

    await userEvent.click(screen.getByRole("link", { name: "Telegram" }));

    expect(outboundCalls()[0][2]).toMatchObject({ label: "Telegram" });
  });

  it("tracks a click that starts on a child of the link", async () => {
    render(
      <Harness>
        <a href="https://example.com/docs">
          <span>Nested label</span>
        </a>
      </Harness>,
    );

    await userEvent.click(screen.getByText("Nested label"));

    expect(outboundCalls()).toHaveLength(1);
  });

  it("ignores in-app links", async () => {
    render(
      <Harness>
        <a href="/docs/paragraph">Docs</a>
      </Harness>,
    );

    await userEvent.click(screen.getByRole("link", { name: "Docs" }));

    expect(outboundCalls()).toHaveLength(0);
  });

  it("ignores same-origin absolute links", async () => {
    render(
      <Harness>
        <a href={`${window.location.origin}/demo`}>Demo</a>
      </Harness>,
    );

    await userEvent.click(screen.getByRole("link", { name: "Demo" }));

    expect(outboundCalls()).toHaveLength(0);
  });

  it("ignores in-page anchors", async () => {
    render(
      <Harness>
        <a href="#installation">Installation</a>
      </Harness>,
    );

    await userEvent.click(screen.getByRole("link", { name: "Installation" }));

    expect(outboundCalls()).toHaveLength(0);
  });

  it("ignores mailto links", async () => {
    render(
      <Harness>
        <a href="mailto:hi@example.com">Email</a>
      </Harness>,
    );

    await userEvent.click(screen.getByRole("link", { name: "Email" }));

    expect(outboundCalls()).toHaveLength(0);
  });

  it("ignores clicks that are not on a link", async () => {
    render(
      <Harness>
        <button type="button">Not a link</button>
      </Harness>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Not a link" }));

    expect(outboundCalls()).toHaveLength(0);
  });

  it("stops tracking after unmount", async () => {
    // The link lives outside the React tree so RTL's unmount cleanup does not
    // take it with the harness — the point is that the *listener* is gone.
    const link = document.createElement("a");
    link.href = "https://example.com/gone";
    link.textContent = "Gone";
    document.body.appendChild(link);

    const { unmount } = render(<Harness>{null}</Harness>);
    unmount();

    await userEvent.click(link);

    expect(outboundCalls()).toHaveLength(0);
    link.remove();
  });
});
