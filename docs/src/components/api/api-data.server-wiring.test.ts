import { describe, it, expect } from "vitest";
import { API_SECTIONS } from "./api-data";

const configTable = (): { option: string; type: string; default: string; description: string }[] =>
  API_SECTIONS.find((section) => section.id === "config")?.table ?? [];

const row = (option: string): { description: string; type: string } | undefined =>
  configTable().find((entry) => entry.option === option);

describe("server wiring config keys", () => {
  it("documents all three", () => {
    const names = configTable().map((entry) => entry.option);

    expect(names).toContain("server");
    expect(names).toContain("ticket");
    expect(names).toContain("persistence");
  });

  // The likeliest wrong assumption a reader brings, given the name.
  it("says server does not configure document storage", () => {
    expect(row("server")?.description).toMatch(/does not.*document/i);
  });

  it("states the precedence rule, because server never overrides anything", () => {
    expect(row("server")?.description).toMatch(/explicitly|yourself|your own/i);
  });

  it("says a ticket is only needed when the service runs on its own", () => {
    expect(row("ticket")?.description).toMatch(/standalone|separate|its own/i);
  });

  it("points persistence at the reader's own endpoint, never at the service", () => {
    expect(row("persistence")?.description).toMatch(/your own|no documents/i);
  });

  // The signature is a hand-written string, so nothing but a test notices when
  // the real contract moves under it.
  it("shows the version save is told it is overwriting", () => {
    expect(row("persistence")?.type).toContain("SaveContext");
    expect(row("persistence")?.type).toContain("SaveResult");
  });

  it("says the reader's endpoint decides a conflict, not Blok", () => {
    expect(row("persistence")?.description).toMatch(/version/i);
  });
});
