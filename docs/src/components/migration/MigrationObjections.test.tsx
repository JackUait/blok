import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "../../contexts/I18nContext";
import { MigrationObjections } from "./MigrationObjections";
import en from "../../i18n/en.json";

const renderObjections = () =>
  render(
    <I18nProvider>
      <MigrationObjections />
    </I18nProvider>
  );

describe("MigrationObjections", () => {
  it("renders the reassurance heading", () => {
    renderObjections();
    const headingNamePattern = new RegExp(en.migration.objectionHeading.replace(/\s+/g, "\\s+"));
    expect(screen.getByRole("heading", { name: headingNamePattern })).toBeInTheDocument();
  });

  it("renders all four reassurance lines", () => {
    renderObjections();
    for (const line of [en.migration.objectionContentLoads, en.migration.objectionToolsPort, en.migration.objectionInlineWrap, en.migration.objectionWarnings]) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }
  });

  it("shows the EditorJS alias code snippet", () => {
    renderObjections();
    expect(screen.getByText(/@bloklabs\/core/)).toBeInTheDocument();
  });
});
