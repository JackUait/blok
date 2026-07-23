import { describe, it, expect } from "vitest";
import { API_SECTIONS } from "./api-data";
import en from "../../i18n/en.json";
import ru from "../../i18n/ru.json";

/**
 * Documentation coverage for the runtime i18n API.
 *
 * `config.i18n` used to be read once during boot, so a host with a language
 * switcher had no documented way to relabel a mounted editor — the docs only
 * described the read side (`t`/`has`/`getLocale`). `i18n.update()` closes that
 * gap, and it needs to be discoverable next to the read methods, in both
 * locale overlays (the overlay wins at render time, so a missing entry hides
 * the API even though api-data declares it).
 */
const i18nSection = API_SECTIONS.find((s) => s.id === "i18n-api");

const method = (name: string) =>
  i18nSection!.methods!.find((m) => m.name.startsWith(name));

describe("i18n API section documents the runtime mutator", () => {
  it("declares i18n.update with the live config keys", () => {
    const update = method("i18n.update");

    expect(update).toBeDefined();
    expect(update!.returnType).toBe("Promise<void>");
    expect(update!.description).toContain("locale");
    expect(update!.description).toContain("messages");
    // The reason the API exists: no editor recreation, so caret/history survive.
    expect(update!.description.toLowerCase()).toContain("recreat");
  });

  it("declares i18n.getDirection", () => {
    const direction = method("i18n.getDirection");

    expect(direction).toBeDefined();
    expect(direction!.returnType).toBe("'ltr' | 'rtl'");
  });

  it("states the scope boundary so hosts are not surprised by stale block text", () => {
    const update = method("i18n.update");

    expect(update!.description).toMatch(/block/i);
  });

  it.each([
    ["en", en],
    ["ru", ru],
  ])("%s overlay carries notes for the new methods", (_locale, bundle) => {
    const notes = (
      bundle as unknown as {
        api: { i18nApi: { methods: { i18n: Record<string, { note: string }> } } };
      }
    ).api.i18nApi.methods.i18n;

    expect(notes.update?.note ?? "").not.toBe("");
    expect(notes.getDirection?.note ?? "").not.toBe("");
  });

  it("the adapter props table lists i18n as reactive", () => {
    const adapter = API_SECTIONS.find((s) => s.id === "blok-editor");
    const row = adapter!.table!.find((r) => r.option === "i18n");

    expect(row).toBeDefined();
    expect(row!.description).toContain("i18n.update");
    expect(row!.description.toLowerCase()).toContain("reactive");
  });

  it("the configuration table row points at the runtime setter", () => {
    const config = API_SECTIONS.find((s) => s.id === "config");
    const row = config!.table!.find((r) => r.option === "i18n");

    expect(row!.description).toContain("i18n.update");

    const enRow = (
      en.api.configuration.table as Record<string, { description: string }>
    )["i18n"];
    const ruRow = (
      ru.api.configuration.table as Record<string, { description: string }>
    )["i18n"];

    expect(enRow.description).toContain("i18n.update");
    expect(ruRow.description).toContain("i18n.update");
  });
});
