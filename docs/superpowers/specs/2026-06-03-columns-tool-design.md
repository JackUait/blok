# Columns (Layout) Tool — Design Spec

**Date:** 2026-06-03
**Status:** Draft (awaiting review)

---

## Overview

A Columns layout tool lets users place blocks side by side, splitting a page into
vertical columns (Notion-style). It follows Blok's **"everything is a block"** law: a
column container is a block, and each column is a block.

The full feature reaches Notion parity (presets, drag-beside, width resize, arrow-key
navigation). Because that spans several independent subsystems, the work is **decomposed
into four sub-projects**, each with its own implementation plan and shippable increment.
This spec details **Sub-project 1 (Core column blocks + presets)** in full and outlines
2–4 as phased follow-ups.

---

## Block Model

Two new block types, using Blok's existing flat-with-references hierarchy
(`parentId` / `contentIds`):

```
column_list   — parent container block
  data:        {}                       // no own data
  contentIds:  [columnA, columnB, ...]  // each entry is a `column` block

column        — child of a column_list
  data:        { widthRatio?: number }  // 0–1, omit = equal width; ratios sum ≈ 1
  parentId:    <column_list id>
  contentIds:  [userBlock1, userBlock2, ...]  // arbitrary block types
```

This matches the Notion public API model (`column_list` / `column` / `width_ratio`) and
serializes automatically through the existing Saver/Renderer via the `parent` and
`content` fields on `OutputBlockData`. No custom save/load.

### JSON output example

```json
{
  "blocks": [
    { "id": "cl1", "type": "column_list", "data": {}, "content": ["c1", "c2"] },
    { "id": "c1", "type": "column", "data": {}, "parent": "cl1", "content": ["p1"] },
    { "id": "p1", "type": "paragraph", "data": { "text": "Left" }, "parent": "c1" },
    { "id": "c2", "type": "column", "data": {}, "parent": "cl1", "content": ["p2"] },
    { "id": "p2", "type": "paragraph", "data": { "text": "Right" }, "parent": "c2" }
  ]
}
```

---

## Design Decisions (locked)

| Decision | Choice |
|----------|--------|
| Creation + scope | Full Notion parity (presets + drag-beside + resize + arrow-nav), phased |
| Block model | Two block types: `column_list` + `column` |
| Nesting columns-in-columns | **Blocked** — a `column` may not directly contain a `column_list` |
| Max columns | No hard cap. Presets offer 2–5; drag-beside may exceed |
| Narrow viewport | Stack vertically (CSS-only, no data change) |
| Teardown at 1 column | Auto-unwrap — promote remaining column's blocks to the column_list's position, delete both wrappers |

---

## Sub-project Decomposition

1. **Core column blocks + presets** *(foundation — this spec; ships alone)*
2. **Width resize** — drag-handle between columns → `widthRatio`, min-width floor. Depends on 1.
3. **Drag-beside** — X-axis drop detection in DragManager (`edge: 'left' | 'right'`), wrap target + dragged block into a column_list, or add a column to an existing one. Depends on 1.
4. **Arrow-key navigation** — Left/Right arrow at a column's content boundary moves caret to the sibling column. Extends Caret. Depends on 1.

Each gets its own spec + plan when its turn comes. The remainder of this document specifies **Sub-project 1**.

---

## Sub-project 1 — Core Column Blocks + Presets

### Files

**New:**
```
src/tools/column-list/index.ts        — ColumnList tool
src/tools/column-list/types.ts        — ColumnListData
src/tools/column/index.ts             — Column tool
src/tools/column/types.ts             — ColumnData
src/tools/columns-shared.ts           — preset spawn, auto-unwrap, nesting guard
test/unit/tools/column-list.test.ts
test/unit/tools/column.test.ts
test/unit/tools/columns-shared.test.ts
test/playwright/tests/tools/columns.spec.ts
```

**Edit:**
```
src/tools/index.ts                                    — export ColumnList, Column; add to defaultBlockTools
types/tools-entry.d.ts                                — public type exports
src/components/modules/blockManager/operations.ts     — extend newToolCanHostChildren (see below)
src/components/icons/index.ts                          — add IconColumns (or reuse IconSplitView)
index.html                                             — import, state checkbox, iconGroups entry
src/components/i18n/locales/en/messages.json           — new keys; sync all locales via yarn i18n:check
```

### `newToolCanHostChildren`

In `operations.ts`, both new tools host children unconditionally (like `toggle`/`callout`):

```typescript
const newToolCanHostChildren = newTool === 'toggle' ||
  newTool === 'callout' ||
  newTool === 'column_list' ||
  newTool === 'column' ||
  (newTool === 'header' && (data as { isToggleable?: boolean }).isToggleable === true);
```

### ColumnList tool

- `render()` → flex-row container, attrs `[data-blok-columns]` and
  `[data-blok-testid="column-list"]`. Responsive: `flex-wrap` + per-child `min-width`
  so columns stack vertically below a breakpoint (CSS-only).
- `rendered()` → `mountChildBlocks(container, api.blocks.getChildren(id))` — mounts the
  `column` holders horizontally (toggle/callout pattern).
- `save()` → `{}`.
- No toolbox entry (never inserted directly by the user; created via preset helper).
- `static get isReadOnlySupported()` → `true`.

### Column tool

- `render()` → flex-item, attr `[data-blok-column]`, applies `flex: <widthRatio ?? 1>`,
  inner child container marked `[data-blok-nested-blocks]`.
- `rendered()` → mount own children. **Auto-seed:** if it has 0 children, call
  `api.blocks.insertInsideParent(columnId, index)` to add an empty paragraph (callout
  pattern) so the column is never empty/uneditable.
- `save()` → `{ widthRatio }` when set, else `{}`.
- No toolbox entry (spawned only by presets / drag-beside).
- `static get isReadOnlySupported()` → `true`.

### Preset spawn (`columns-shared.ts`)

Toolbox entries live on the **ColumnList** tool: `titleKey` plus `searchTerms`
`['columns', 'cols', '2c', '3c', '4c', '5c', 'layout']`, with preset variants for 2–5
columns. Selecting a preset runs the helper:

1. Insert a `column_list` block at the caret position.
2. For N (2–5): `insertInsideParent(columnListId, idx)` → a `column` block; into each,
   `insertInsideParent(columnId, idx)` → an empty paragraph.
3. Wrap the whole sequence in the existing `withAtomicOperation` so it is a single
   undo entry.
4. Move the caret to the first paragraph of the first column.

### Guards & teardown

- **Nesting guard:** `isColumnDescendant(blockId)` walks `parentId` upward; insert /
  `setBlockParent` that would place a `column_list` inside a `column` is rejected.
- **Auto-unwrap:** when a `column_list`'s `contentIds` drops to a single `column`
  (via child removal or, later, drag-out), promote that column's child blocks to the
  column_list's flat position and remove both the `column` and the `column_list`.
  Implemented via the `removed()` lifecycle hook + BlockManager reparenting, atomic.

### i18n keys (English; synced to all locales)

```
toolNames.columns          — "Columns"
tools.columns.col2         — "2 columns"
tools.columns.col3         — "3 columns"
tools.columns.col4         — "4 columns"
tools.columns.col5         — "5 columns"
a11y.columnList            — accessible label for the container
a11y.column                — accessible label for a single column
```

---

## Testing (TDD — IRON RULE: write test, watch it fail, then implement)

### Unit — `column-list.test.ts`
- `render()` returns a flex-row container with `[data-blok-columns]` + testid.
- `rendered()` mounts N child column holders into the container.
- `save()` returns `{}`.
- `isReadOnlySupported` is `true`; read-only render does not add editable affordances.

### Unit — `column.test.ts`
- `render()` applies `flex` from `widthRatio` (default `1`).
- Auto-seeds an empty paragraph when the column has no children.
- `save()` returns `{ widthRatio }` when set, `{}` otherwise.

### Unit — `columns-shared.test.ts`
- Preset spawn builds the correct tree: 1 `column_list`, N `column` children, each with
  one paragraph; relationships correct on both `parentId` and `contentIds`.
- Nesting guard rejects placing a `column_list` inside a `column`.
- Auto-unwrap promotes the surviving column's blocks and removes both wrappers when the
  column count reaches 1.

### E2E — `columns.spec.ts`
- `/columns` (2-col preset) → two columns visible side by side (assert via
  `data-blok-testid` and bounding boxes).
- Type into each column; `save()` output matches the column_list + column + paragraph
  tree (parent/content fields).
- Delete one column → auto-unwrap leaves the surviving blocks at root.
- Narrow viewport → columns stack vertically (bounding-box assertion).

Presets here spawn 2–5 columns; counts above 5 are reachable only via drag-beside
(Sub-project 3).

---

## Out of Scope (this sub-project)

- Width resizing (Sub-project 2)
- Drag-a-block-beside-another to form/extend columns (Sub-project 3)
- Left/Right arrow caret navigation across columns (Sub-project 4)
- Paste/markdown import of multi-column layouts
- Conversion of an existing block into a column via the conversion menu
