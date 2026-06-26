import { describe, it, expect } from "vitest";
import { EMBED_SERVICES } from "./embed-services";

describe("EMBED_SERVICES", () => {
  it("lists every supported embed service", () => {
    expect(EMBED_SERVICES.length).toBe(111);
  });

  it("gives every service a brand colour", () => {
    for (const s of EMBED_SERVICES) {
      expect(s.hex, s.title).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("renders well-known services with real glyphs, not monograms", () => {
    const byTitle = new Map(EMBED_SERVICES.map((s) => [s.title, s]));
    for (const title of ["YouTube", "Figma", "Spotify", "CodePen", "LinkedIn"]) {
      expect(byTitle.get(title)?.path, title).toBeTruthy();
    }
  });

  it("carries the viewBox size for non-24 brand glyphs", () => {
    const codepen = EMBED_SERVICES.find((s) => s.title === "CodePen");
    expect(codepen?.vb).toBe(32);
  });

  it("keeps a brand colour for monogram fallbacks", () => {
    for (const s of EMBED_SERVICES) {
      if (s.path === null) expect(s.hex, s.title).toBeTruthy();
    }
  });
});
