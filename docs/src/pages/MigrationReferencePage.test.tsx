import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MigrationReferencePage } from "./MigrationReferencePage";
import { I18nProvider } from "../contexts/I18nContext";
import en from "../i18n/en.json";

const renderRef = () =>
  render(
    <MemoryRouter>
      <I18nProvider>
        <MigrationReferencePage />
      </I18nProvider>
    </MemoryRouter>
  );

describe("MigrationReferencePage", () => {
  it("renders the reference page title", () => {
    renderRef();
    expect(screen.getByRole("heading", { level: 1, name: en.migration.referencePageTitle })).toBeInTheDocument();
  });

  it("renders the codemod section", () => {
    renderRef();
    expect(screen.getByTestId("codemod-section")).toBeInTheDocument();
  });

  it("renders the 'what changes' step heading", () => {
    renderRef();
    expect(screen.getByRole("heading", { name: en.migration.sectionChangesTitle })).toBeInTheDocument();
  });
});
