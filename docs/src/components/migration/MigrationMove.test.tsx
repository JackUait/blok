import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../../contexts/I18nContext";
import { MigrationMove } from "./MigrationMove";
import { CODEMOD_APPLY_COMMAND } from "./migration-data";
import en from "../../i18n/en.json";

const renderMove = () =>
  render(
    <MemoryRouter>
      <I18nProvider>
        <MigrationMove />
      </I18nProvider>
    </MemoryRouter>
  );

describe("MigrationMove", () => {
  it("renders the codemod apply command", () => {
    renderMove();
    expect(screen.getByText(CODEMOD_APPLY_COMMAND)).toBeInTheDocument();
  });

  it("renders all three steps", () => {
    renderMove();
    for (const step of [en.migration.moveStep1, en.migration.moveStep2, en.migration.moveStep3]) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
  });

  it("links to the reference page", () => {
    renderMove();
    expect(screen.getByRole("link", { name: new RegExp(en.migration.moveReferenceLink) })).toHaveAttribute("href", "/migration/reference");
  });
});
