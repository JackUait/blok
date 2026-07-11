import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MigrationPage, MigrationContent } from "./MigrationPage";
import { I18nProvider } from "../contexts/I18nContext";
import en from "../i18n/en.json";

const m = en.migration;

const renderPage = () =>
  render(
    <MemoryRouter>
      <I18nProvider>
        <MigrationPage />
      </I18nProvider>
    </MemoryRouter>
  );

describe("MigrationPage", () => {
  it("renders the Nav and main landmark", () => {
    renderPage();
    expect(screen.getByTestId("nav")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("leads with the outgrown-Editor.js hero", () => {
    renderPage();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent(m.persuadeHeroPre);
    expect(h1).toHaveTextContent(m.persuadeHeroBrand);
  });

  it("renders the walls, objection and move sections", () => {
    renderPage();
    const asRegex = (text: string) =>
      new RegExp(text.split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"));
    expect(screen.getByRole("heading", { name: asRegex(m.wallsHeading) })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: asRegex(m.objectionHeading) })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: asRegex(m.moveHeading) })).toBeInTheDocument();
  });

  it("has no kicker/eyebrow label above the h1", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1 }).previousElementSibling).toBeNull();
  });

  it("MigrationContent renders inline without a Nav (homepage embed)", () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <MigrationContent inline />
        </I18nProvider>
      </MemoryRouter>
    );
    expect(screen.queryByTestId("nav")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(m.persuadeHeroBrand);
  });
});
