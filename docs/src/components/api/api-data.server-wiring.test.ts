import { describe, it, expect } from "vitest";
import { API_SECTIONS } from "./api-data";

const configTable = (): { option: string; type: string; default: string; description: string }[] =>
  API_SECTIONS.find((section) => section.id === "config")?.table ?? [];

const row = (option: string): { description: string; type: string } | undefined =>
  configTable().find((entry) => entry.option === option);

const section = (id: string): { description?: string; methods?: { name: string; example?: string }[] } =>
  API_SECTIONS.find((entry) => entry.id === id) ?? {};

describe("server wiring config keys", () => {
  it("documents all four", () => {
    const names = configTable().map((entry) => entry.option);

    expect(names).toContain("server");
    expect(names).toContain("ticket");
    expect(names).toContain("persistence");
    expect(names).toContain("collaboration");
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

  // Both refusals happen at construction, so a reader who learns them from a
  // thrown error learned them too late.
  it("states what collaboration requires and what it refuses to sit beside", () => {
    const description = row("collaboration")?.description ?? "";

    expect(row("collaboration")?.type).toContain("doc: string");
    expect(row("collaboration")?.type).toContain("name: string");
    expect(description).toMatch(/requires.*`?server`?/i);
    expect(description).toMatch(/mutually exclusive|cannot be combined/i);
    expect(description).toMatch(/persistence/);
    expect(description).toMatch(/single path segment/i);
  });

  // `collaboration.user` and `user: { id }` are two different people-shaped
  // options; the whole point of the row is that a reader picks the right one.
  it("separates the display identity from the attribution option", () => {
    const description = row("collaboration")?.description ?? "";

    expect(description).toMatch(/display/i);
    expect(description).toMatch(/independent/i);
    expect(description).toMatch(/attribution|credit/i);
  });

  // `offline` is the one collaboration key a host turns on deliberately, and
  // presence draws a caret plus a face in the gutter — no block outline.
  it("names the offline copy and describes presence as it ships", () => {
    const description = row("collaboration")?.description ?? "";

    expect(row("collaboration")?.type).toContain("offline?: boolean");
    expect(description).toMatch(/offline/);
    expect(description).toMatch(/hex/i);
    expect(description).not.toMatch(/outline/i);
  });

  // `offline` on its own is refused at construction now: the copy belongs to
  // the browser, so without a partition a shared profile hands it to whoever
  // opens the page next.
  it("names the identity partition offline requires", () => {
    const description = row("collaboration")?.description ?? "";

    expect(description).toMatch(/offlineScope/);
    expect(row("collaboration")?.type).toContain("offlineScope?: string");
  });

  it("names the event a host renders its indicator from", () => {
    expect(row("collaboration")?.description).toContain("collaboration:status");
  });

  // Angular declares a curated input list and everything else flows through
  // [config]; collaboration is in the second group, and a reader hunting for a
  // [collaboration] input finds nothing unless the escape hatch names it.
  it("routes collaboration through the frameworks the way each one takes it", () => {
    expect(row("collaboration")?.description).toMatch(/React and Vue/);
    expect(row("collaboration")?.description).toMatch(/\[config\]/);
    expect(section("blok-editor").description).toMatch(/collaboration/);
  });
});

describe("collaboration status event", () => {
  // The events section teaches events by example rather than by table, so the
  // new one has to appear in the same `on()` example as its neighbours.
  it("subscribes to collaboration:status beside the other lifecycle events", () => {
    const example = section("events-api").methods?.find((method) =>
      method.name.startsWith("on("),
    )?.example ?? "";

    expect(example).toContain("collaboration:status");
    expect(example).toMatch(/status/);
    expect(example).toMatch(/peers/);
  });
});
