import { describe, it, expect } from "vitest";
import { API_SECTIONS } from "./api-data";
import { SIDEBAR_GROUPS, MODULE_LABELS_EN, MODULE_ORDER } from "./api-nav";
import en from "../../i18n/en.json";
import ru from "../../i18n/ru.json";

/**
 * Documentation coverage for the Marks API (`api.marks` /
 * `editor.marks`): range-aware inline-mark operations with
 * has/find/read/apply/remove/toggle, the MarkSpec identity rules, and the
 * `markSanitizerConfig(spec)` core export.
 */
describe("marks section", () => {
  const section = API_SECTIONS.find((s) => s.id === "marks-api");

  it("exists with a title, description and lastUpdated", () => {
    expect(section).toBeDefined();
    expect(section!.title).toBe("Marks API");
    expect(section!.description).toBeDefined();
    expect(section!.lastUpdated).toBeDefined();
  });

  it("leads with the range-aware contrast to selection.findParentTag", () => {
    const description = section!.description ?? "";
    expect(description).toContain("findParentTag");
    expect(description).toContain("anchor node");
    expect(description).toContain("WHOLE range");
    // The behaviors that make range-awareness worth having must be stated.
    expect(description).toContain("split");
    expect(description).toContain("boundaries");
    expect(description).toContain("in place");
    expect(description).toContain("restore");
    expect(description).toContain("trailing whitespace");
  });

  it("states the identity rules: statics count, function values do not, families compose", () => {
    const description = section!.description ?? "";
    expect(description).toContain("MarkSpec");
    expect(description).toContain("identity");
    expect(description).toContain("EXCLUDED");
    expect(description).toContain("colour picker");
    expect(description).toContain("family");
    expect(description).toContain("compose");
    // The concrete composition example: two colour specs on one <mark>.
    expect(description).toContain("<mark>");
  });

  it("documents the markSanitizerConfig core export and its derivation", () => {
    const description = section!.description ?? "";
    expect(description).toContain("markSanitizerConfig");
    // Function-form values are handled by property NAME so dynamic values survive save.
    expect(description).toContain("property name");
    expect(description).toContain("createReactInlineTool");
  });

  it("documents every marks method", () => {
    const names = section!.methods!.map((m) => m.name);
    expect(names).toEqual([
      "marks.has(spec, range?)",
      "marks.find(spec, from?)",
      "marks.read(spec, range?)",
      "marks.apply(spec, state?, range?)",
      "marks.remove(spec, range?)",
      "marks.toggle(spec, state?, range?)",
    ]);
  });

  it("has a non-empty example on every method", () => {
    section!.methods!.forEach((method) => {
      expect(method.example).toBeDefined();
      expect(method.example!.trim().length).toBeGreaterThan(0);
    });
  });

  it("every range parameter documents the live-selection default", () => {
    section!.methods!.forEach((method) => {
      const range = method.params?.find((p) => p.name === "range");
      if (range) {
        expect(range.type).toBe("Range");
        expect(range.required).toBe(false);
        expect(range.default).toBe("current selection");
      }
    });
  });

  it("marks.has answers whole-selection coverage, not the anchor node", () => {
    const method = section!.methods!.find((m) => m.name.startsWith("marks.has"));
    expect(method!.returnType).toBe("boolean");
    expect(method!.description).toContain("every text node");
    expect(method!.description).toContain("collapsed caret");
    expect(method!.description).toContain("partially");
    const names = method!.params!.map((p) => p.name);
    expect(names).toEqual(["spec", "range"]);
  });

  it("marks.find matches the full spec, defaulting to the selection start", () => {
    const method = section!.methods!.find((m) => m.name.startsWith("marks.find"));
    expect(method!.returnType).toBe("HTMLElement | null");
    expect(method!.description).toContain("ancestor");
    const from = method!.params!.find((p) => p.name === "from");
    expect(from!.type).toBe("Node");
    expect(from!.required).toBe(false);
  });

  it("marks.read returns a MarkSnapshot and omits transparent values", () => {
    const method = section!.methods!.find((m) => m.name.startsWith("marks.read"));
    expect(method!.returnType).toBe("MarkSnapshot | null");
    expect(method!.description).toContain("null");
    expect(method!.description).toContain("transparent");
  });

  it("marks.apply documents in-place updates, boundary splitting and trailing whitespace", () => {
    const method = section!.methods!.find((m) => m.name.startsWith("marks.apply"));
    expect(method!.returnType).toBe("HTMLElement[]");
    expect(method!.description).toContain("in place");
    expect(method!.description).toContain("Splits");
    expect(method!.description).toContain("trailing whitespace");
    const names = method!.params!.map((p) => p.name);
    expect(names).toEqual(["spec", "state", "range"]);
    // The in-place-update selling point must be visible in the example.
    expect(method!.example).toContain("in place");
  });

  it("marks.remove documents splitting so outside text keeps formatting", () => {
    const method = section!.methods!.find((m) => m.name.startsWith("marks.remove"));
    expect(method!.returnType).toBe("HTMLElement[]");
    expect(method!.description).toContain("unwrap");
    expect(method!.description).toContain("outside the range");
  });

  it("marks.toggle returns the resulting state", () => {
    const method = section!.methods!.find((m) => m.name.startsWith("marks.toggle"));
    expect(method!.returnType).toBe("boolean");
    expect(method!.description).toContain("true when the mark is now applied");
  });

  it("has a section-level example: composition on one element plus the sanitize derivation", () => {
    const example = section!.example ?? "";
    expect(example).toContain("marks.apply");
    expect(example).toContain("background-color");
    expect(example).toContain("markSanitizerConfig");
  });
});

describe("marks registration", () => {
  it("is routable: present in exactly one sidebar group and in MODULE_ORDER", () => {
    const owners = SIDEBAR_GROUPS.filter((g) => g.moduleIds.includes("marks-api"));
    expect(owners.length).toBe(1);
    expect(owners[0]!.key).toBe("editing");
    expect(MODULE_ORDER).toContain("marks-api");
  });

  it("has an English sidebar label", () => {
    expect(MODULE_LABELS_EN["marks-api"]).toBe("Marks");
  });

  // Route metadata coverage for "marks-api" is enforced by the seo module's own
  // coverage tests (docs/src/seo), which fail for any MODULE_ORDER entry
  // lacking EN+RU metadata — no duplicate assertion here.

  it("has i18n entries in both locales", () => {
    expect(en.api.marksApi.title).toBe("Marks API");
    expect(en.api.links.marks).toBe("Marks");
    expect(ru.api.marksApi.title.length).toBeGreaterThan(0);
    expect(ru.api.links.marks.length).toBeGreaterThan(0);
  });

  it("the section description is mirrored into the EN i18n overlay (which wins at render time)", () => {
    const section = API_SECTIONS.find((s) => s.id === "marks-api");
    expect(en.api.marksApi.description).toBe(section!.description);
    expect(ru.api.marksApi.description).toContain("MarkSpec");
  });

  it("every method carries a note in both locales", () => {
    for (const key of ["has", "find", "read", "apply", "remove", "toggle"] as const) {
      expect(en.api.marksApi.methods.marks[key].note.length).toBeGreaterThan(0);
      expect(ru.api.marksApi.methods.marks[key].note.length).toBeGreaterThan(0);
    }
  });
});
