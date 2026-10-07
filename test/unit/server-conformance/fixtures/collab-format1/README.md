# Frozen format-1 collab rooms

Inputs for the C3 migration tests (room format 1 → 2). **Never regenerate these files.**

Format 1 stores a rich field (`paragraph`, `header`, `quote`, `toggle`, `list` → `text`) as an HTML string in an unformatted `Y.Text`. Format 2 (Plan B) stores it as a formatted `Y.XmlText`. Once the client writes format 2, no current code can produce these bytes again. That is why they are frozen.

## Layout

Same layout as `../collab/`, so the C# `YDocConverterFixtures` reader works on it:

- `manifest.json` lists every case. `source` says where it came from.
- `<case>/input.json` is the block array given to `DocumentStore.fromJSON`.
- `<case>/canonical.json` is `DocumentStore.toJSON()` of that doc. Rich fields hold the format-1 HTML string.
- `<case>/update.b64` is `encodeStateAsUpdate()` of that doc, base64. This is the format-1 room.

Cases:

- 24 cases copied verbatim from `../collab/` (`source: "copied from fixtures/collab"`).
- 7 `rich-*` cases, generated once from the real client (`source: "rich format-1 case"`). They cover every mark, links with `target`/`rel`, preset and custom colours, equations, page mentions, opaque HTML, `<br>`, escaped markup characters, every rich block type, and negative cases.
- `rich-negatives` holds markup-looking strings that C3 must NOT convert: `code` and `caption` (diffable, not rich), a legacy `callout.title`, a custom tool's `text`, and a `database-row` nested document (it stays plain JSON).

## Provenance

- Client: commit `961fabb7` (branch `feat/rt-b01`), bundled from `src/` with esbuild, as `scripts/generate-collab-fixtures.mjs` does.
- yjs 13.6.33, Node v24.13.0.
- The bytes are not deterministic (random Yjs client id). Compare at the JSON level, never byte for byte.

## Guard

`../../collab-format1-fixtures.test.ts` decodes every room with plain yjs and checks the following:

- Each rich field is an unformatted `Y.Text`, not a `Y.XmlText`.
- Each one holds the HTML in `canonical.json`.
- The corpus still covers every kind of markup.
