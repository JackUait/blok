import { describe, it, expect } from "vitest";
import { API_SECTIONS } from "./api-data";
import en from "../../i18n/en.json";
import ru from "../../i18n/ru.json";

/**
 * Coverage for "content copied out of another app arrives as blocks".
 *
 * Two claims live in this copy and must not blur into one: the CAPABILITY
 * claim names every app a user can copy from, while the PIPELINE claim names
 * only the apps Blok runs a dedicated pre-pass for. There is no Claude branch
 * in `ai-chat-preprocessor.ts`, so listing Claude as pre-processed would be
 * false in the one place developers read for mechanics.
 */
const configSection = API_SECTIONS.find((s) => s.id === "config");

const pasteRow = () =>
  configSection!.table!.find((row) => row.option === "onBeforePaste")!;

describe("paste-source documentation", () => {
  it("names every app whose content Blok turns into blocks", () => {
    const { description } = pasteRow();

    for (const source of ["ChatGPT", "Claude", "Gemini", "Notion", "Google Docs"]) {
      expect(description, `"${source}" is missing from the paste copy`).toContain(source);
    }
  });

  it("says what survives the copy instead of only naming the apps", () => {
    const { description } = pasteRow();

    expect(description).toContain("LaTeX");
    expect(description).toContain("language");
    expect(description.toLowerCase()).toContain("table");
  });

  it("scopes the dedicated pre-pass to the two apps that have one", () => {
    const { description } = pasteRow();
    const prePass = description.slice(description.indexOf("pre-pass"));

    expect(prePass).toContain("ChatGPT");
    expect(prePass).toContain("Gemini");
    // Claude may only appear as the exception to the pre-pass, never as a subject of it.
    expect(prePass).toMatch(/Claude has no pre-pass of its own/);
  });

  it("states that the hook runs before Blok's own preprocessing", () => {
    expect(pasteRow().description).toContain("after your hook");
  });

  it("mirrors the row into the EN overlay, which wins at render time", () => {
    const enRow = (en.api.configuration.table as Record<string, { description: string }>)
      .onBeforePaste;

    expect(enRow.description).toBe(pasteRow().description);
  });

  it("carries the same source list in the RU overlay", () => {
    const ruRow = (ru.api.configuration.table as Record<string, { description: string }>)
      .onBeforePaste;

    for (const source of ["ChatGPT", "Claude", "Gemini", "Notion", "Google Docs"]) {
      expect(ruRow.description, `"${source}" is missing from the RU paste copy`).toContain(source);
    }
  });
});
