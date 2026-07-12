import { describe, it, expect } from "vitest";
import {
  MIGRATION_WALLS,
  MIGRATION_OBJECTIONS,
  MIGRATION_MOVE_STEPS,
  COMPATIBILITY_GROUPS,
} from "./migration-data";
import en from "../../i18n/en.json";
import ru from "../../i18n/ru.json";

/** Resolve a dotted "migration.foo" key against a locale JSON object. */
const resolve = (locale: Record<string, unknown>, key: string): unknown =>
  key.split(".").reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], locale);

describe("migration-data", () => {
  it("has four walls, engine row present", () => {
    expect(MIGRATION_WALLS).toHaveLength(4);
    expect(MIGRATION_WALLS.map((w) => w.id)).toContain("engine");
  });

  it("the 'not bundled' group only lists tools Blok genuinely ships no equivalent for", () => {
    const notBundled = COMPATIBILITY_GROUPS.find((g) => g.id === "not-bundled");
    expect(notBundled).toBeDefined();
    // Blok bundles + registers these by default (src/tools/index.ts), so claiming
    // "Blok ships no equivalent" for them misleads migrators into redundant work.
    const bundledByDefault = ["marker", "inlineCode", "audio"];
    for (const tool of bundledByDefault) {
      expect(
        notBundled?.tools,
        `${tool} is bundled by default and must not be in the not-bundled group`,
      ).not.toContain(tool);
    }
    // Only personality + button have no Blok equivalent.
    expect(notBundled?.tools).toEqual(["personality", "button"]);
  });

  it("every compatibility group's tools are listed in exactly one group", () => {
    const seen = new Set<string>();
    for (const group of COMPATIBILITY_GROUPS) {
      for (const tool of group.tools) {
        expect(seen.has(tool), `${tool} appears in more than one group`).toBe(false);
        seen.add(tool);
      }
    }
  });

  it("every compatibility group title/hint key exists in both en and ru", () => {
    const keys = COMPATIBILITY_GROUPS.flatMap((g) => [g.titleKey, g.hintKey]);
    for (const key of keys) {
      expect(resolve(en, key), `en missing ${key}`).toBeTypeOf("string");
      expect(resolve(ru, key), `ru missing ${key}`).toBeTypeOf("string");
    }
  });

  it("every wall/objection/move key exists in both en and ru", () => {
    const keys = [
      ...MIGRATION_WALLS.flatMap((w) => [w.oldTitleKey, w.oldDescKey, w.newTitleKey, w.newDescKey]),
      ...MIGRATION_OBJECTIONS,
      ...MIGRATION_MOVE_STEPS,
    ];
    for (const key of keys) {
      expect(resolve(en, key), `en missing ${key}`).toBeTypeOf("string");
      expect(resolve(ru, key), `ru missing ${key}`).toBeTypeOf("string");
    }
  });
});
