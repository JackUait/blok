import { describe, it, expect } from "vitest";
import { API_SECTIONS } from "./api-data";
import { MODULE_ORDER } from "./api-nav";
import en from "../../i18n/en.json";
import ru from "../../i18n/ru.json";

/**
 * Documentation coverage for tab sync: the guide page, the `documentId` and
 * `tabSync` options, `OutputData.id`, the `onChange` origin and `api.viewState`.
 *
 * The guide body lives only in the bundles (`api.tabSync.<part>.body`), so
 * ru-coverage cannot see it. This file pins it.
 */
const findSection = (id: string) => API_SECTIONS.find((s) => s.id === id);

type Bundle = Record<string, unknown>;

const at = (bundle: Bundle, key: string): string | undefined => {
  const found = key.split(".").reduce<unknown>(
    (node, part) => (node !== null && typeof node === "object" ? (node as Bundle)[part] : undefined),
    bundle,
  );

  return typeof found === "string" ? found : undefined;
};

const CYRILLIC = /[Ѐ-ӿ]/;

const GUIDE_PARTS = ["whatItDoes", "documentId", "whatSyncs", "saving", "toggles", "limits"] as const;

describe("tab sync guide", () => {
  it("is a guide page in the sidebar", () => {
    const section = findSection("tab-sync");

    expect(section?.customType).toBe("tab-sync");
    expect(MODULE_ORDER).toContain("tab-sync");
  });

  it.each(GUIDE_PARTS)("carries the %s part in both locales", (part) => {
    for (const field of ["title", "body"]) {
      const key = `api.tabSync.${part}.${field}`;

      expect(at(en as Bundle, key), `en ${key}`).toBeDefined();
      expect(at(ru as Bundle, key) ?? "", `ru ${key}`).toMatch(CYRILLIC);
    }
  });

  const body = (part: (typeof GUIDE_PARTS)[number]): string => at(en as Bundle, `api.tabSync.${part}.body`) ?? "";

  it("says where documentId comes from, with the secure-context caveat", () => {
    const text = body("documentId");

    expect(text).toContain("persistence");
    expect(text).toContain("crypto.randomUUID()");
    expect(text.toLowerCase()).toContain("secure");
    // Raw `data` never joins on its own.
    expect(text).toContain("`data`");
    expect(text).toContain("joins after its first `persistence` save");
    expect(text).toContain("`isReady` rejects");
  });

  it("lists what syncs and what never does", () => {
    const text = body("whatSyncs");

    for (const fact of ["locale", "theme", "width", "toggle", "selection", "scroll", "read-only", "playback"]) {
      expect(text.toLowerCase()).toContain(fact);
    }
    // Stored preferences belong to the browser, not to tab sync.
    expect(text).toContain("whatever `tabSync` says");
  });

  it("says only the main tab saves and names the adapter bindings", () => {
    const text = body("saving");

    expect(text).toContain("onSave");
    expect(text).toContain("v-model:data");
    expect(text).toContain("[formControl]");
    expect(text).toContain("editor.save()");
  });

  it("says toggles start collapsed and isOpen is gone", () => {
    const text = body("toggles");

    expect(text).toContain("isOpen");
    expect(text).toContain("viewState");
    expect(text).toContain("With tab sync on");
    expect(text).toContain("lost on reload");
  });

  it("states the limits", () => {
    const text = body("limits");

    expect(text).toContain("400 ms");
    expect(text).toContain("localhost");
    expect(text.toLowerCase()).toContain("iframe");
    expect(text).toContain("recreateKey");
    expect(text).toContain("In React, change its `key`");
    expect(text).toContain("saves on its own");
    expect(text).toContain("returns a version");
  });
});

describe("configuration rows for tab sync", () => {
  const table = findSection("config")?.table ?? [];
  const enTable = en.api.configuration.table as Record<string, { description: string }>;
  const ruTable = ru.api.configuration.table as Record<string, { description: string }>;

  it.each(["documentId", "tabSync"])("documents %s in api-data, en.json and ru.json", (option) => {
    const row = table.find((r) => r.option === option);

    expect(row).toBeDefined();
    expect(enTable[option]?.description).toBe(row?.description);
    expect(ruTable[option]?.description ?? "").toMatch(CYRILLIC);
  });

  it("says tabSync is on by default and off with collaboration", () => {
    const row = table.find((r) => r.option === "tabSync");

    expect(row?.default).toBe("true");
    expect(row?.description).toContain("{ settings: false }");
    expect(row?.description).toContain("collaboration");
  });

  it("documents the onChange origin", () => {
    const row = table.find((r) => r.option === "onChange");

    expect(row?.description).toContain("origin");
    expect(row?.description).toContain("'tab'");
    expect(row?.description).toContain("'remote'");
    expect(enTable.onChange?.description).toBe(row?.description);
  });

  it("says onSave runs only in the main tab", () => {
    const row = table.find((r) => r.option === "onSave");

    expect(row?.description).toContain("main tab");
    expect(enTable.onSave?.description).toBe(row?.description);
  });
});

describe("OutputData id", () => {
  it("documents the document id", () => {
    const section = findSection("output-data");
    const row = section?.table?.find((r) => r.option === "id");

    expect(row).toBeDefined();
    expect(section?.example).toContain("id?: string");
    expect(ru.api.outputData.table).toHaveProperty("id");
  });
});

describe("viewState API", () => {
  it("documents every method", () => {
    const section = findSection("view-state-api");
    const names = section?.methods?.map((m) => m.name.replace(/\(.*\)$/, "")) ?? [];

    expect(names).toEqual(["viewState.get", "viewState.set", "viewState.onChange", "viewState.isCreatedHere"]);
    // A tool keeps its block from the constructor; there is no `this.blockId`.
    expect(section?.methods?.[3]?.example).toContain("this.block.id");
    expect(MODULE_ORDER).toContain("view-state-api");
  });
});
