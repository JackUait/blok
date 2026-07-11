import { describe, it, expect } from "vitest";
import { MIGRATION_WALLS, MIGRATION_OBJECTIONS, MIGRATION_MOVE_STEPS } from "./migration-data";
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
