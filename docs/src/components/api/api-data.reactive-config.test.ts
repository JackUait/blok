import { describe, it, expect } from "vitest";
import { API_SECTIONS } from "./api-data";
import en from "../../i18n/en.json";
import ru from "../../i18n/ru.json";

/**
 * Documentation coverage for the reactive config contract:
 * the BlokMountOptions / BlokState split plus the runtime setters
 * `readOnly.set(state, options?)`, `toolbar.setHidden(hidden)`,
 * `tools.setInlineToolbar(config)` and `tools.isInstalled(name)`.
 *
 * Route-metadata coverage is untouched: no new section is added — the
 * contract extends the existing config / readonly-api / toolbar-api /
 * tools-api sections. (No imports from docs/src/seo here by design.)
 */
const findSection = (id: string) => API_SECTIONS.find((s) => s.id === id);

describe("configuration section: mount options vs live state", () => {
  const config = findSection("config");

  it("describes the BlokMountOptions / BlokState split and names every live field", () => {
    const description = config!.description ?? "";
    expect(description).toContain("BlokMountOptions");
    expect(description).toContain("BlokState");
    // Every live field and the compatibility equation must be stated.
    expect(description).toContain("readOnly");
    expect(description).toContain("hideToolbar");
    expect(description).toContain("inlineToolbar");
    expect(description).toContain("BlokConfig = BlokMountOptions & BlokState");
    // The point of the contract: no editor recreation.
    expect(description.toLowerCase()).toContain("recreat");
    // Adapters follow the same contract.
    expect(description).toContain("React");
    expect(description).toContain("Vue");
    expect(description).toContain("Angular");
  });

  it("the section description is mirrored into the EN i18n overlay (which wins at render time)", () => {
    expect(en.api.configuration.description).toBe(config!.description);
    expect(ru.api.configuration.description).toContain("BlokState");
  });

  it("documents the hideToolbar option with its runtime setter", () => {
    const row = config!.table!.find((r) => r.option === "hideToolbar");
    expect(row).toBeDefined();
    expect(row!.type).toBe("boolean");
    expect(row!.default).toBe("false");
    expect(row!.description).toContain("toolbar.setHidden");
    expect(row!.description.toLowerCase()).toContain("gutter");
    // The EN overlay must carry the same claim or it would mask this row's text.
    const enRow = (en.api.configuration.table as Record<string, { description: string }>)["hideToolbar"];
    const ruRow = (ru.api.configuration.table as Record<string, { description: string }>)["hideToolbar"];
    expect(enRow.description).toBe(row!.description);
    expect(ruRow.description).toContain("toolbar.setHidden");
  });

  it("readOnly option documents the object form and the live setter", () => {
    const row = config!.table!.find((r) => r.option === "readOnly");
    expect(row!.type).toBe("boolean | { hideControls: boolean }");
    expect(row!.description).toContain("readOnly.set");
    expect(row!.description).toContain("hideControls");
    const enRow = (en.api.configuration.table as Record<string, { description: string }>)["readOnly"];
    const ruRow = (ru.api.configuration.table as Record<string, { description: string }>)["readOnly"];
    expect(enRow.description).toBe(row!.description);
    expect(ruRow.description).toContain("readOnly.set");
  });

  it("inlineToolbar option names its live setter", () => {
    const row = config!.table!.find((r) => r.option === "inlineToolbar");
    expect(row!.description).toContain("tools.setInlineToolbar");
    const enRow = (en.api.configuration.table as Record<string, { description: string }>)["inlineToolbar"];
    const ruRow = (ru.api.configuration.table as Record<string, { description: string }>)["inlineToolbar"];
    expect(enRow.description).toBe(row!.description);
    expect(ruRow.description).toContain("tools.setInlineToolbar");
  });
});

describe("readonly-api: in-place toggling", () => {
  const section = findSection("readonly-api");

  it("section description states the consumer story: one instance, flipped in place", () => {
    const description = section!.description ?? "";
    expect(description).toContain("readOnly.set(!isEditing)");
    expect(description).toContain("caret");
    expect(description).toContain("undo");
    expect(description).toContain("scroll");
    // The description is overlaid from i18n at render time — keep them in sync.
    expect(en.api.readOnlyApi.description).toBe(description);
    expect(ru.api.readOnlyApi.description).toContain("readOnly.set(!isEditing)");
  });

  it("readOnly.set documents the options form and preservation guarantees", () => {
    const method = section!.methods!.find((m) => m.name === "readOnly.set(state, options?)");
    expect(method).toBeDefined();
    expect(method!.description).toContain("hideControls");
    expect(method!.description).toContain("caret");
    expect(method!.description).toContain("undo");
    expect(method!.description).toContain("scroll");
    const paramNames = method!.params!.map((p) => p.name);
    expect(paramNames).toEqual(["state", "options.hideControls"]);
    const hideControls = method!.params!.find((p) => p.name === "options.hideControls");
    expect(hideControls!.type).toBe("boolean");
    expect(hideControls!.required).toBe(false);
    expect(method!.example).toContain("{ hideControls: true }");
    expect(method!.example).toContain("readOnly.set(!isEditing)");
  });

  it("documents the togglesInPlace observability constant", () => {
    const prop = section!.properties!.find((p) => p.name === "togglesInPlace");
    expect(prop).toBeDefined();
    expect(prop!.type).toBe("true");
    expect(prop!.description.toLowerCase()).toContain("in place");
    expect(prop!.description.toLowerCase()).toContain("recreat");
  });

  it("has a section-level example: the edit/view toggle without destroy/recreate", () => {
    const example = section!.example ?? "";
    expect(example).toContain("readOnly.set(!isEditing)");
    expect(example.toLowerCase()).toContain("adapter");
  });
});

describe("toolbar-api: setHidden", () => {
  const section = findSection("toolbar-api");

  it("documents toolbar.setHidden as the runtime half of hideToolbar", () => {
    const method = section!.methods!.find((m) => m.name === "toolbar.setHidden(hidden)");
    expect(method).toBeDefined();
    expect(method!.returnType).toBe("void");
    expect(method!.description).toContain("hideToolbar");
    expect(method!.description.toLowerCase()).toContain("gutter");
    expect(method!.example).toContain("toolbar.setHidden(true)");
    const paramNames = method!.params!.map((p) => p.name);
    expect(paramNames).toEqual(["hidden"]);
  });
});

describe("tools-api: setInlineToolbar and isInstalled", () => {
  const section = findSection("tools-api");

  it("documents tools.setInlineToolbar incl. next-selection timing and sanitize recomposition", () => {
    const method = section!.methods!.find((m) => m.name === "tools.setInlineToolbar(config)");
    expect(method).toBeDefined();
    expect(method!.returnType).toBe("void");
    expect(method!.description).toContain("next selection");
    expect(method!.description.toLowerCase()).toContain("sanitiz");
    const config = method!.params!.find((p) => p.name === "config");
    expect(config!.type).toBe("boolean | string[]");
    expect(method!.example).toContain("setInlineToolbar(['bold', 'italic'])");
    expect(method!.example).toContain("setInlineToolbar(false)");
  });

  it("documents tools.isInstalled", () => {
    const method = section!.methods!.find((m) => m.name === "tools.isInstalled(name)");
    expect(method).toBeDefined();
    expect(method!.returnType).toBe("boolean");
    // Covers all tool kinds, not just block tools.
    expect(method!.description).toContain("inline");
    expect(method!.description).toContain("tune");
    expect(method!.example).toContain("isInstalled(");
  });
});

describe("reactive-config i18n notes (EN + RU)", () => {
  it("toolbar.setHidden has notes in both locales", () => {
    expect(en.api.toolbarApi.methods.toolbar.setHidden.note.length).toBeGreaterThan(0);
    expect(ru.api.toolbarApi.methods.toolbar.setHidden.note.length).toBeGreaterThan(0);
  });

  it("tools.setInlineToolbar and tools.isInstalled have notes in both locales", () => {
    expect(en.api.toolsApi.methods.tools.setInlineToolbar.note.length).toBeGreaterThan(0);
    expect(ru.api.toolsApi.methods.tools.setInlineToolbar.note.length).toBeGreaterThan(0);
    expect(en.api.toolsApi.methods.tools.isInstalled.note.length).toBeGreaterThan(0);
    expect(ru.api.toolsApi.methods.tools.isInstalled.note.length).toBeGreaterThan(0);
  });

  it("readOnly.set note mentions in-place semantics in both locales", () => {
    expect(en.api.readOnlyApi.methods.readOnly.set.note).toContain("in place");
    expect(ru.api.readOnlyApi.methods.readOnly.set.note.length).toBeGreaterThan(0);
  });

  it("RU carries translated descriptions for the new methods and the togglesInPlace property", () => {
    expect(ru.api.toolbarApi.methods.toolbar.setHidden.description.length).toBeGreaterThan(0);
    expect(ru.api.toolsApi.methods.tools.setInlineToolbar.description.length).toBeGreaterThan(0);
    expect(ru.api.toolsApi.methods.tools.isInstalled.description.length).toBeGreaterThan(0);
    expect(ru.api.readOnlyApi.properties.togglesInPlace.description.length).toBeGreaterThan(0);
  });
});
