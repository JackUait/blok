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

  it("gives every service a real icon — vector glyph or favicon, never a monogram", () => {
    for (const s of EMBED_SERVICES) {
      expect(Boolean(s.path) || Boolean(s.img), s.title).toBe(true);
    }
  });

  it("inlines favicons as base64 data URIs for services without a vector glyph", () => {
    const favicons = EMBED_SERVICES.filter((s) => !s.path);
    expect(favicons.length).toBe(35);
    for (const s of favicons) {
      expect(s.img, s.title).toMatch(/^data:image\/(png|jpeg);base64,/);
    }
  });
});
