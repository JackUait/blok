# Rich-text edit fixtures

Shared by the C# server and the TypeScript client. Each case says how a
formatted text (a `Y.XmlText`) holding `current` must be turned into `next`.
Both writers must issue exactly the case's `ops`, so a host's `/edit` and a
browser's save describe the same change the same way and merge alike.

- C#: `RichTextEditFixtureTests` (packages/server/dotnet/Blok.Server.Tests/Collab).
  It checks that `RichTextEdit.Plan` emits `ops`, and that an update op leaves
  `expected.delta` and `expected.segments`.
- TS: `rich-text-edit-fixtures.test.ts` (next to this directory). It replays
  `ops` in real yjs, pins `expected`, and checks that the client planner
  (`planRichTextEdit`, rich-text-write.ts) emits `ops`.
  `rich-text-write-path.test.ts` (test/unit/components/modules/yjs) checks
  that `DocumentStore.updateBlockData` makes exactly these calls.

## Case format

```json
{
  "name": "bold-a-word",
  "description": "What the case pins.",
  "current": [{ "text": "hello world" }],
  "next": [{ "text": "hello " }, { "text": "world", "marks": { "bold": true } }],
  "ops": [{ "op": "format", "index": 6, "length": 5, "attributes": { "bold": true } }],
  "expected": {
    "writes": true,
    "segments": [{ "text": "hello " }, { "text": "world", "marks": { "bold": true } }],
    "delta": [{ "insert": "hello " }, { "insert": "world", "attributes": { "bold": true } }]
  }
}
```

- `current`: canonical segments. The text is built from them with one
  `insert` / `insertEmbed` per segment, in order, each with its normalised
  marks (`segmentsToDeltaOps`).
- `next`: segments in any spelling.
- `ops`: the writes, in order, in ONE transaction. Kinds:
  - `{ "op": "insert", "index", "text", "attributes" }`
  - `{ "op": "insertEmbed", "index", "embed", "attributes" }`
  - `{ "op": "delete", "index", "length" }`
  - `{ "op": "format", "index", "length", "attributes" }`. A `null` value removes that mark.
- `expected.writes`: whether the transaction emits an update.
- `expected.segments`: `deltaToSegments(toDelta())` after the ops.
- `expected.delta`: `toDelta()` after the ops, exactly as yjs returns it.

## The rules the ops follow

1. **No-op.** If `canonicalizeSegments(next)` equals the canonical segments of
   the live delta (as JSON strings), write nothing. Respellings are not edits:
   key order, link keys segments do not carry, `bold: false`, a run split in
   two.
2. **Projection.** Each side becomes a string: every text character is itself,
   and every embed is U+FFFC. The live side is read from the RAW `toDelta()`,
   not from canonical segments. An item the canonical form drops (a nested
   type, a non-object embed) still takes one index in yjs.
3. **Diff.** `diffText` (text-diff.ts; C# `TextDiff.Diff`) over the two
   projections, with markup OFF (`{ markup: false }`; C# `markup: false`).
   The projection holds no markup, so `<b>` and `&amp;` in it are typed
   characters and diff one at a time. Character clusters still stay whole.
4. **Pairing.** Units kept by the diff are paired in order. A pair whose units
   are not the same content becomes unpaired: text against an embed, two
   embeds whose objects differ (key order ignored), or a live item no segment
   can name.
5. **Regions.** Each maximal run of unpaired units on either side is one
   region. Two diff edits that touch become one region.
6. **Content ops, back to front.** For each region, from the last to the
   first:
   - insert the new units at the region's start, in order, one `insert` per
     piece of one `next` segment, and one `insertEmbed` per embed;
   - then `delete` the old units, at the region's start plus what was just
     inserted.

   Indices count from the old text, which back-to-front keeps valid. Insert
   before delete: the other order anchors the new text to the right of the
   deleted run, so a peer's keystroke inside it surfaces in front of the
   replacement.
7. **Attributes on every insert.** Always the segment's marks after
   `normalizeMarkValue` (keys sorted at every depth), and `{}` when unmarked.
   An insert without attributes inherits the marks in force, so typing after
   a link would be linked.
8. **Format ops, front to back, after all content ops.** For every kept unit,
   in final positions, compare the canonical marks before and after. A change
   object has only the keys whose canonical value changed (key order ignored),
   sorted ordinally. The value is the normalised new value, or `null` when the
   mark is gone. Adjacent units with the same change object share one
   `format`.

## Notes for the TS side

- yjs's `insert` writes `null` into the attributes object it is handed, for
  every mark in force that the object does not name. Pass a fresh object per
  call. Never reuse one from these fixtures.
- Keep the fixture as the source of truth for the ops. To refresh
  `expected` after adding a case, run
  `UPDATE_RICH_TEXT_FIXTURES=1 yarn test test/unit/server-conformance/rich-text-edit-fixtures.test.ts`.
  `ops` are written by hand, or taken from the C# planner and reviewed. The TS
  test then proves in real yjs that they produce `next`.
- Known window, accepted and not pinned here: the C# engine does not run
  yjs's format-cleanup transaction (contract §7). Until a yjs client that saw
  both sides of a concurrent formatting change sends its cleanup, the server
  can read a mark yjs peers no longer show. A REST edit made in that window
  is planned from the server's reading, so it can bring a removed mark back,
  as a yjs peer that has not run the cleanup can.
