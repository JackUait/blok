import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ANALYTICS_EVENTS } from "./analytics";

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appSource = readFileSync(resolve(srcDir, "App.tsx"), "utf-8");

/** Every non-test source file under src/, recursively. */
const collectSourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      return collectSourceFiles(path);
    }
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes(".test.")) {
      return [];
    }
    return [path];
  });

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

  /**
   * LAW: no declared-but-unfired event names.
   *
   * A name sitting in ANALYTICS_EVENTS reads as "this is tracked" to anyone
   * auditing coverage, and to anyone building a GA report against it. If
   * nothing fires it, the report is silently empty forever. Either wire it up
   * or delete it.
   */
  it("fires every event declared in ANALYTICS_EVENTS", () => {
    // analytics.ts is included: it fires some events itself (trackOutboundLink),
    // and the declaration block writes `key:`, never `ANALYTICS_EVENTS.key`, so
    // a name cannot satisfy this check just by being declared.
    const sources = collectSourceFiles(srcDir)
      .map((path) => readFileSync(path, "utf-8"))
      .join("\n");

    const unfired = Object.keys(ANALYTICS_EVENTS).filter(
      (key) => !sources.includes(`ANALYTICS_EVENTS.${key}`),
    );

    expect(unfired).toEqual([]);
  });
});
