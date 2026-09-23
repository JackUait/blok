# Stable table row and column ids — design

Date: 2026-09-23. Status: implemented (2f1306a3 and the follow-up that aligns ragged rows by column id).

## Goal

Give every table row and column a stable id so collaboration can address
them by id instead of by index. Target: the pinned failure
"deletes the column the peer asked for, and keeps the other two"
(`test/unit/tools/concurrent-container-structure-loss.test.ts`).

## User decisions (2026-09-23)

1. No format gate. Old clients may still join a room. Protection is
   best-effort: an old client's save strips the ids and the table falls back
   to index addressing until the room is reset.
2. No BREAKING label.
3. Unmerge keeps all content in the top-left cell (unchanged).
4. Row ids are required.
5. The merge model is NOT changed. The two "merge + concurrent delete"
   pins stay as known limitations.

## Saved data (additive)

`content` keeps its shape. Each cell gains two optional fields:

- `id` — the column id. Every cell of one column carries the same value.
- `rowId` — the row id. Every cell of one row carries the same value.

Why on the cell and not as top-level `rowIds`/`colIds` arrays (measured
2026-09-23): a string array is ONE last-writer-wins Yjs value, so two peers
inserting columns lose one id, and an old client's save deletes the key.

Why the column id is named `id`: a row whose cells all carry a unique `id`
is an identity array, which the Yjs layer already stores keyed by that id
(`isIdentityArray`), and the C# converter already mirrors it. That is what
makes a column move plus a concurrent delete converge correctly.

## Where ids are kept

- `table-ids.ts` — `ensureTableIds(grid)`: fills missing ids, repairs
  duplicates (first occurrence wins), keeps every cell of a column/row on one
  value. `alignRowsToColumns(grid)`: lays each row out in the column order of
  the widest row, by id, so a row that missed a concurrent column insert gets
  its gap under that column instead of at its end. Both run in
  `TableModel.normalizeContent` only. A table saved without ids therefore
  mints once in the constructor and again when `rendered()` rebuilds from the
  raw data; the second set is the one saved. Harmless, and not worth a second
  call site.
- `TableModel` — `addRow` mints a row id, `addColumn` mints a column id;
  delete/move carry ids with the cells; `snapshot` and `normalizeCell` keep
  both fields.
- `initializeCells` — must carry `id`/`rowId` through the rebuild.

## Yjs layer

- Cells: no change — identity-array rule applies once cells carry `id`.
- Rows: the keyed grid uses a row's shared `rowId` as its row key when it has
  one (at birth in `plainToGridMap`, and when a save adds a new row).
  `deepAssignYGrid` pairs a saved row with the existing row of the same key
  first, then falls back to content pairing for rows without a matching key.
  Existing random keys are never rewritten (no promotion).
- C# lockstep: `PlainToGridMap` and `DeepAssign.Grid` in `YDocConverter.cs`.

## Surface

- `types/tools/table.d.ts` `CellContent`: `id?`, `rowId?`.
- `src/view/document-schema.ts`: cell schema lists both (it is
  `additionalProperties: false`).
- Docs: `docs/src/components/tools/tools-data.ts` saved-data shape.
