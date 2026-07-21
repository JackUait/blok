import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appSource = readFileSync(resolve(srcDir, "App.tsx"), "utf-8");

/**
 * LAW: the two site-wide analytics hooks must stay mounted in App.
 *
 * Both are fire-and-forget — nothing in the UI breaks if they stop being
 * called, so a refactor can silently delete them and every page view and
 * outbound click disappears from GA with no failing test and no visible
 * symptom. These assertions are the only thing that would notice.
 */
describe("analytics wiring", () => {
  it("mounts usePageTracking in App", () => {
    expect(appSource).toMatch(/^\s*usePageTracking\(\);/m);
    expect(appSource).toContain('from "./hooks/usePageTracking"');
  });

  it("mounts useOutboundLinkTracking in App", () => {
    expect(appSource).toMatch(/^\s*useOutboundLinkTracking\(\);/m);
    expect(appSource).toContain('from "./hooks/useOutboundLinkTracking"');
  });
});
