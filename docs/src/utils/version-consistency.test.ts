import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import rootPkg from "../../../package.json";

/**
 * Guards against version drift: the docs site hardcoded stale `0.23.5` blok
 * version strings in three places (CDN snippet, save() output examples) that
 * silently diverged from the real published package. Any blok version literal
 * a user can see MUST equal the root package.json version — otherwise it's a
 * stale artifact. Prefer interpolating BLOK_VERSION over writing a literal.
 */

const SRC_DIR = resolve(__dirname, "..");

/** Recursively collect .ts/.tsx source files, skipping tests and assets. */
const collectSourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "assets") continue;
      out.push(...collectSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
};

describe("blok version consistency", () => {
  const files = collectSourceFiles(SRC_DIR);

  it("BLOK_VERSION constant equals the root package.json version", async () => {
    const { BLOK_VERSION } = await import("./constants");
    expect(BLOK_VERSION).toBe(rootPkg.version);
  });

  it("the save() OutputData example interpolates the current version (not a literal)", async () => {
    const { API_SECTIONS } = await import("../components/api/api-data");
    const outputData = API_SECTIONS.find((s) => s.id === "output-data");
    const example = outputData?.example ?? "";
    expect(example).toContain(`"version": "${rootPkg.version}"`);
    expect(example).not.toContain("${BLOK_VERSION}");
  });

  it("no user-visible blok version literal diverges from package.json", () => {
    // `@blok/core@X.Y.Z` in CDN snippets and `version: 'X.Y.Z'` / "version": "X.Y.Z"
    // in save() output examples are the drift-prone spots. Any match must be current.
    const patterns = [
      /@blok\/core@(\d+\.\d+\.\d+[\w.-]*)/g,
      /["']?version["']?\s*:\s*["'](\d+\.\d+\.\d+[\w.-]*)["']/g,
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
          if (match[1] !== rootPkg.version) {
            offenders.push(`${file}: found "${match[0]}" (expected ${rootPkg.version})`);
          }
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
