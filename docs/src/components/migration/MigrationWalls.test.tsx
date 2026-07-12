import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "../../contexts/I18nContext";
import { MigrationWalls } from "./MigrationWalls";
import en from "../../i18n/en.json";

const renderWalls = () =>
  render(
    <I18nProvider>
      <MigrationWalls />
    </I18nProvider>
  );

describe("MigrationWalls", () => {
  it("renders the section heading", () => {
    renderWalls();
    // Typo() inserts a non-breaking space after short words ("of", "is", "in"),
    // so the accessible name isn't byte-identical to en.json — match with \s
    // (matches NBSP), same pattern as Hero.test.tsx / DocsCtaCard.test.tsx.
    expect(screen.getByRole("heading", { name: /Every\s+one\s+of\s+these\s+is\s+gone\s+in\s+Blok/ })).toBeInTheDocument();
  });

  it("renders the block-engine clearance (the thesis row)", () => {
    renderWalls();
    expect(screen.getByText(en.migration.wallEngineNewTitle)).toBeInTheDocument();
    expect(screen.getByText(en.migration.wallEngineOldTitle)).toBeInTheDocument();
  });

  it("renders all four walls", () => {
    renderWalls();
    for (const t of [en.migration.wallFlatNewTitle, en.migration.wallPluginsNewTitle, en.migration.wallEngineNewTitle, en.migration.wallFrameworkNewTitle]) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
  });

  it("does NOT render a kicker/eyebrow label above the heading", () => {
    renderWalls();
    // The mock's "The walls you keep hitting" eyebrow is intentionally absent.
    expect(screen.queryByText(/walls you keep hitting/i)).not.toBeInTheDocument();
  });
});
