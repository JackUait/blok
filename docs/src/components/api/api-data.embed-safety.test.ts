import { describe, it, expect } from "vitest";
import { API_SECTIONS } from "./api-data";
import { MODULE_ORDER } from "./api-nav";
import en from "../../i18n/en.json";
import ru from "../../i18n/ru.json";

/**
 * The "Embedding any URL safely" guide. Its body lives only in the bundles
 * (`api.embedSafety.<part>.body`), so ru-coverage cannot see it. This file
 * pins it, and pins the measured claims a host acts on.
 */
type Bundle = Record<string, unknown>;

const at = (bundle: Bundle, key: string): string | undefined => {
  const found = key.split(".").reduce<unknown>(
    (node, part) => (node !== null && typeof node === "object" ? (node as Bundle)[part] : undefined),
    bundle,
  );

  return typeof found === "string" ? found : undefined;
};

const CYRILLIC = /[Ѐ-ӿ]/;

const GUIDE_PARTS = ["whatBlokDoes", "frameSrc", "ownPages", "popups", "permissions", "uploads", "frameCheck", "measured"] as const;

const body = (bundle: Bundle, part: (typeof GUIDE_PARTS)[number]): string =>
  at(bundle, `api.embedSafety.${part}.body`) ?? "";

describe("embed safety guide", () => {
  it("is a guide page in the sidebar", () => {
    expect(API_SECTIONS.find((s) => s.id === "embed-safety")?.customType).toBe("embed-safety");
    expect(MODULE_ORDER).toContain("embed-safety");
  });

  it.each(GUIDE_PARTS)("carries the %s part in both locales", (part) => {
    for (const field of ["title", "body"]) {
      const key = `api.embedSafety.${part}.${field}`;

      expect(at(en as Bundle, key), `en ${key}`).toBeDefined();
      expect(at(ru as Bundle, key) ?? "", `ru ${key}`).toMatch(CYRILLIC);
    }
  });

  it.each([en, ru])("says only COOP same-origin stopped the Firefox popup", (bundle) => {
    const text = body(bundle as Bundle, "popups");

    expect(text).toContain("`Cross-Origin-Opener-Policy: same-origin`");
    expect(text).toContain("`same-origin-allow-popups`");
    expect(text).toContain("Firefox");
    expect(text).toContain("allow-popups-to-escape-sandbox");
  });

  it.each([en, ru])("names the CSP directives a host sets", (bundle) => {
    expect(body(bundle as Bundle, "frameSrc")).toContain("`frame-src`");
    expect(body(bundle as Bundle, "ownPages")).toContain("`frame-ancestors 'self'`");
    expect(body(bundle as Bundle, "permissions")).toContain("`Permissions-Policy`");
  });

  it.each([en, ru])("points at the server's frame check", (bundle) => {
    const text = body(bundle as Bundle, "frameCheck");

    expect(text).toContain("`GET /frame-check`");
    expect(text).toContain("`linkPaste.checkEmbed`");
  });

  it.each([en, ru])("says only media players let popups escape, and COOP still matters for them", (bundle) => {
    const text = body(bundle as Bundle, "popups");

    expect(text).toContain("YouTube");
    expect(text).toContain("CodePen");
    expect(text).toContain("`allow-popups-to-escape-sandbox`");
  });

  it.each([en, ru])("says a generic embed source must be an absolute https:// URL", (bundle) => {
    const text = body(bundle as Bundle, "whatBlokDoes");

    expect(text).toContain("`https://`");
    expect(text).toContain("`https:/x`");
  });

  it.each([en, ru])("says a no-uploader SVG image is a data: URL shown only in <img>", (bundle) => {
    expect(body(bundle as Bundle, "whatBlokDoes")).toContain("`data:image/svg+xml`");
    expect(body(bundle as Bundle, "uploads")).toContain("`data:image/svg+xml`");
    expect(body(bundle as Bundle, "measured")).toContain("SVG");
  });

  it.each([en, ru])("lists the host list entry forms on the linkPaste option", (bundle) => {
    const text = at(bundle as Bundle, "api.configuration.table.linkPaste.description") ?? "";

    expect(text).toContain("`https://good.com:8443`");
    expect(text).toContain("`bücher.de`");
    expect(text).toContain("`::1`");
  });
});
