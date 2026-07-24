import { describe, it, expect } from "vitest";
import { API_SECTIONS } from "./api-data";
import { SIDEBAR_GROUPS, MODULE_LABELS_EN, MODULE_ORDER } from "./api-nav";
import en from "../../i18n/en.json";
import ru from "../../i18n/ru.json";

/**
 * Documentation coverage for the `@bloklabs/core/view` renderer
 * (blocksToHtml / blocksToPlainText / defineBlokSchema / blocksToViewNodes)
 * and its React bindings (BlokView / useBlokView).
 */
describe("view renderer section", () => {
  const section = API_SECTIONS.find((s) => s.id === "view-api");

  it("exists with a title, description and lastUpdated", () => {
    expect(section).toBeDefined();
    expect(section!.title).toBe("View renderer");
    expect(section!.description).toBeDefined();
    expect(section!.lastUpdated).toBeDefined();
  });

  it("leads with the problem it solves: display without an editor instance", () => {
    const description = section!.description ?? "";
    expect(description).toContain("without");
    expect(description).toContain("editor");
    // The DOM-free environment claims that make the feature useful must be stated.
    expect(description).toContain("Node");
    expect(description).toContain("Server Components");
  });

  it("states the sanitization guarantee", () => {
    const description = section!.description ?? "";
    expect(description.toLowerCase()).toContain("sanitiz");
    expect(description).toContain("same");
  });

  it("documents every view function and React binding", () => {
    const names = section!.methods!.map((m) => m.name);
    expect(names).toEqual([
      "blocksToHtml(data, options?)",
      "blocksToPlainText(data, options?)",
      "htmlTextContent(html)",
      "outlineFromOutputData(data)",
      "defineBlokSchema(config)",
      "blocksToViewNodes(data, options?)",
      "BlokView",
      "useBlokView(data, options?)",
    ]);
  });

  it("has a non-empty example on every method", () => {
    section!.methods!.forEach((method) => {
      expect(method.example).toBeDefined();
      expect(method.example!.trim().length).toBeGreaterThan(0);
    });
  });

  it("documents blocksToHtml options incl. the onUnknownBlock default", () => {
    const method = section!.methods!.find((m) => m.name.startsWith("blocksToHtml"));
    const params = method!.params!;
    const names = params.map((p) => p.name);
    expect(names).toContain("data");
    expect(names).toContain("options.schema");
    expect(names).toContain("options.renderers");
    expect(names).toContain("options.onUnknownBlock");
    const unknown = params.find((p) => p.name === "options.onUnknownBlock");
    expect(unknown!.default).toBe("'skip'");
    expect(unknown!.type).toContain("'comment'");
  });

  it("documents the renderer context services", () => {
    const method = section!.methods!.find((m) => m.name.startsWith("blocksToHtml"));
    const renderers = method!.params!.find((p) => p.name === "options.renderers");
    for (const service of ["sanitizeInline", "renderBlocks", "plainText", "renderChildren"]) {
      expect(renderers!.description).toContain(service);
    }
  });

  it("documents the plain-text separators and the preview idiom", () => {
    const method = section!.methods!.find((m) => m.name.startsWith("blocksToPlainText"));
    expect(method!.description).toContain("\\n\\n");
    expect(method!.description).toContain("\\t");
    expect(method!.example).toContain(".slice(0, 160)");
  });

  it("documents the defineBlokSchema round-trip contract", () => {
    const method = section!.methods!.find((m) => m.name.startsWith("defineBlokSchema"));
    expect(method!.returnType).toContain("editorConfig");
    expect(method!.returnType).toContain("viewSchema");
    expect(method!.description).toContain("module-scope");
    expect(method!.example).toContain("editorConfig");
    expect(method!.example).toContain("viewSchema");
  });

  it("flags blocksToViewNodes and the React bindings as experimental", () => {
    const nodes = section!.methods!.find((m) => m.name.startsWith("blocksToViewNodes"));
    expect(nodes!.description.toLowerCase()).toContain("experimental");
    expect(nodes!.description).toContain("{ tag, attrs, children }");
  });

  it("motivates BlokView as the readOnly-editor replacement, without innerHTML", () => {
    const view = section!.methods!.find((m) => m.name === "BlokView");
    expect(view!.description).toContain("readOnly");
    expect(view!.description).toContain("dangerouslySetInnerHTML");
    const propNames = view!.params!.map((p) => p.name);
    expect(propNames).toEqual(["data", "schema", "renderers", "onUnknownBlock", "className"]);
  });

  it("documents useBlokView as wrapper-free for label/cell slots", () => {
    const hook = section!.methods!.find((m) => m.name.startsWith("useBlokView"));
    expect(hook!.description.toLowerCase()).toContain("wrapper");
    expect(hook!.example).toContain("useBlokView(");
  });

  it("has a section-level example wiring editor and view through one schema", () => {
    const example = section!.example ?? "";
    expect(example).toContain("defineBlokSchema");
    expect(example).toContain("@bloklabs/core/view");
    expect(example).toContain("blocksToHtml");
  });
});

describe("view renderer registration", () => {
  it("is routable: present in exactly one sidebar group and in MODULE_ORDER", () => {
    const owners = SIDEBAR_GROUPS.filter((g) => g.moduleIds.includes("view-api"));
    expect(owners.length).toBe(1);
    expect(MODULE_ORDER).toContain("view-api");
  });

  it("has an English sidebar label", () => {
    expect(MODULE_LABELS_EN["view-api"]).toBe("View renderer");
  });

  // Route metadata coverage for "view-api" is enforced by the seo module's own
  // coverage tests (docs/src/seo), which fail for any MODULE_ORDER entry
  // lacking EN+RU metadata — no duplicate assertion here.

  it("has i18n entries in both locales", () => {
    expect(en.api.viewApi.title).toBe("View renderer");
    expect(en.api.links.viewApi).toBe("View renderer");
    expect(ru.api.viewApi.title.length).toBeGreaterThan(0);
    expect(ru.api.links.viewApi.length).toBeGreaterThan(0);
  });
});
