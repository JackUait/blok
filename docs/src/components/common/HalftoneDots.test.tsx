import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HalftoneDots } from "./HalftoneDots";

describe("HalftoneDots", () => {
  it("renders a decorative, non-interactive canvas", () => {
    const { container } = render(<HalftoneDots />);
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    // Purely decorative — must be hidden from assistive tech and never swallow
    // pointer events from the controls underneath it.
    expect(canvas).toHaveAttribute("aria-hidden", "true");
    expect(canvas).toHaveClass("pointer-events-none");
  });

  it("forwards a className so the dot colour can be themed", () => {
    const { container } = render(<HalftoneDots className="text-foreground/[0.08]" />);
    expect(container.querySelector("canvas")).toHaveClass("text-foreground/[0.08]");
  });

  it("renders without a 2D context (jsdom) instead of throwing", () => {
    // getContext returns null here; the effect must bail rather than crash.
    expect(() => render(<HalftoneDots />)).not.toThrow();
  });

  it("accepts a custom shape mix without throwing", () => {
    expect(() =>
      render(<HalftoneDots shapes={["ring", "plus", "diamond"]} />),
    ).not.toThrow();
  });
});
