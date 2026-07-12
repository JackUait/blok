import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "../../contexts/I18nContext";
import { MigrationHero } from "./MigrationHero";
import en from "../../i18n/en.json";

const renderHero = () =>
  render(
    <I18nProvider>
      <MigrationHero />
    </I18nProvider>
  );

describe("MigrationHero", () => {
  it("renders an h1 naming Editor.js in the outgrown headline", () => {
    renderHero();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent(en.migration.persuadeHeroPre);
    expect(h1).toHaveTextContent(en.migration.persuadeHeroBrand);
  });

  it("renders both CTAs linking to the walls and move anchors", () => {
    renderHero();
    // Typo inserts NBSPs after short words; match on whitespace-insensitive regex
    // rather than the raw i18n string (see TDD-NBSP gotcha in Hero.test.tsx).
    const wallsPattern = new RegExp(en.migration.persuadeHeroCtaWalls.replace(/\s+/g, "\\s+"));
    const migratePattern = new RegExp(en.migration.persuadeHeroCtaMigrate.replace(/\s+/g, "\\s+"));
    expect(screen.getByRole("link", { name: wallsPattern })).toHaveAttribute("href", "#walls");
    expect(screen.getByRole("link", { name: migratePattern })).toHaveAttribute("href", "#move");
  });

  it("renders the static hero visual", () => {
    renderHero();
    expect(screen.getByTestId("migration-hero-visual")).toBeInTheDocument();
  });

  it("does not render an eyebrow label above the h1", () => {
    renderHero();
    // No kicker text precedes the headline (repo copy rule).
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.previousElementSibling).toBeNull();
  });
});
