# Columns: keyboard nav/resize, dblclick-equalize, turn-into-columns

Date: 2026-06-05
Branch: `feat/columns-tool`
Status: approved design

Closes three Notion-parity gaps found in the 2026-06-05 columns research:

- **Fix 2 (SP4):** keyboard cross-column caret traversal + keyboard-driven
  resize + i18n'd ARIA on resizers.
- **Fix 3:** double-click a divider to equalize column widths.
- **Fix 4:** a "Turn into columns" command in the block-settings (☰) menu.

---

## Fix 3 — Double-click divider equalizes widths

**Behavior:** double-clicking a column resizer resets every column in that
`column_list` to equal width, matching Notion's double-click-to-equalize.

**Implementation:**

- In `createColumnResizer` (`src/tools/columns-shared.ts:129`), add a `dblclick`
  listener.
- The handler resolves the owning `column_list` id from the resizer
  (`resizer.closest([COLUMNS_ATTR])` → the container holder → its block id) and
  calls the existing `resetColumnsToEvenWidth(api, columnListId)`.
- `createColumnResizer` / `buildColumnResizers` must receive `api` so the handler
  can reach `resetColumnsToEvenWidth`. Thread `api` through `buildColumnResizers`
  to its two call sites (`column-list/index.ts` render/seed, `column-drop.ts`
  rebuild) — both already hold `api`.

**Tests:**

- Unit (`test/unit/tools/columns-shared.test.ts`): a resizer dispatched a
  `dblclick` calls `resetColumnsToEvenWidth` / resets sibling holder flex-grow to
  `1`.
- E2E (`resize-then-edit-in-column.spec.ts` or a new
  `dblclick-equalize-in-column.spec.ts`): resize a column unevenly, double-click
  the divider, assert widths return to roughly equal.

---

## Fix 2 — SP4: keyboard navigation, keyboard resize, ARIA

### Part A — cross-column caret traversal

The axis splits the behavior. **Vertical** arrows keep their shipped behavior
(exit the whole layout at a column's vertical edge). **Horizontal** arrows now
traverse sideways between sibling columns instead of exiting.

New rules:

- `ArrowRight` at the **end of the last block** of a column → caret to the
  **start of the first block of the next (right) sibling column**. If the column
  is the rightmost, exit the layout (current behavior, unchanged).
- `ArrowLeft` at the **start of the first block** of a column → caret to the
  **end of the last block of the previous (left) sibling column**. If leftmost,
  exit the layout (current behavior, unchanged).

Unchanged:

- `ArrowDown`/`ArrowUp` between stacked blocks within a column stay in the column.
- `ArrowDown` from a column's last block exits the `column_list` downward.
- `ArrowUp` from a column's first block exits upward.

**Implementation:**

- Hook `navigateNext` (`src/components/modules/caret.ts:534-553`) and
  `navigatePrevious` (`:633-652`), before `resolveContainerToExit` runs. When the
  caret is about to exit a column horizontally, detect a sibling column in the
  travel direction within the same `column_list`; if one exists, set the caret to
  the appropriate edge block of that sibling column instead of exiting.
- A sibling column is the column block immediately before/after the current
  column among the `column_list`'s children. The destination block is the
  sibling column's first child (ArrowRight → `start`) or last child (ArrowLeft →
  `end`).

**Tests (rewrite the two shipped no-teleport assertions):**

- `caret-nav-in-column.spec.ts` test 4: `ArrowLeft` at offset 0 of the first
  block of a non-leftmost column now lands in the previous column's last block
  (was: asserts no teleport).
- test 5: `ArrowRight` at end of the last block of a non-rightmost column now
  lands in the next column's first block (was: asserts no teleport).
- Add edge cases: ArrowRight in the **rightmost** column still exits; ArrowLeft
  in the **leftmost** column still exits. Vertical tests 1–3 stay unchanged and
  must remain green.

### Part B — keyboard resize + i18n ARIA

WAI-ARIA window-splitter pattern. The separator is not a block holder, so its
key handling is independent of caret navigation — no conflict with Part A.

**Implementation (`src/tools/columns-shared.ts`, `createColumnResizer`):**

- Make the resizer focusable: `tabindex=0`. It already has `role="separator"`
  and `aria-orientation="vertical"`.
- ARIA: `aria-label` from i18n (`tools.columns.resizeAriaLabel`),
  `aria-valuemin="0"`, `aria-valuemax="100"`, and `aria-valuenow` = the left
  column's width percentage. Keep `aria-valuenow` updated after every resize
  (pointer drag and keyboard).
- Keydown on the focused resizer:
  - `ArrowLeft` / `ArrowRight`: resize by a fixed px step (default ~16px) using
    the existing `resizeColumnGrow` (compute current widths, apply `±step`
    delta).
  - `Home` / `End`: collapse to min / expand to max for the pair (clamped by
    `COLUMN_MIN_WIDTH`).
  - `preventDefault` so the page does not scroll.
- Factor the grow-application currently inside `startColumnResize.onMove` so both
  the pointer and keyboard paths share one "apply resize + update aria-valuenow"
  routine.

**Tests:**

- Unit (`columns-shared.test.ts`): focused resizer + `ArrowRight` keydown
  redistributes flex-grow toward the left column; `ArrowLeft` the other way;
  `Home`/`End` hit the clamp bounds; `aria-valuenow` updates.
- E2E (`resize-then-edit-in-column.spec.ts` or new
  `keyboard-resize-in-column.spec.ts`): tab/focus a resizer, press Arrow keys,
  assert column widths change and `aria-valuenow` reflects them.

---

## Fix 4 — "Turn into columns" command

**Surface:** block-settings (☰) menu only. Notion has no turn-into-columns
command at all (drag-only); ☰ is the minimal Notion-aligned home. The toolbox
(slash) is insert-only and adding command infrastructure there is out of scope.

**Trigger:** visible only when 2+ blocks are selected.

**Behavior:** N selected top-level blocks → a new `column_list` with N columns,
one selected block per column, in selection order. Single undo entry.

**Implementation:**

- New primitive `wrapBlocksInColumns(api, blockIds)` in `src/tools/column-drop.ts`,
  generalizing `wrapInNewColumnList`:
  - Abort (return null, no mutation) if fewer than 2 ids, any id is stale, or any
    id is not top-level (`parentId !== null`).
  - In a `transact`: insert a `column_list` (`noSeed`) at the first block's index,
    insert N `column` blocks (`noSeed`) parented to the list, move each selected
    block into its own column in order, build resizers, play the entry animation.
  - Return the new `column_list` id.
- Register the menu item via the existing tunes/settings path. Reuse the
  multi-select `onActivate` pattern from multi-delete
  (`src/components/modules/toolbar/blockSettings.ts:479`): read
  `BlockSelection.selectedBlocks`, gate on `length >= 2`, call
  `wrapBlocksInColumns`, then place the caret in the first column and close the
  toolbar.
- Item: `title` from i18n (`tools.columns.turnInto`), a columns icon, a `name`
  for test selectors.

**Tests:**

- Unit (new `column-drop.test.ts` or extend existing): `wrapBlocksInColumns`
  with 3 ids creates a 3-column list, one block each, in order; aborts on <2 ids,
  stale id, or non-top-level id.
- E2E (new `turn-into-columns.spec.ts`): select 2–3 root blocks, open ☰, click
  "Turn into columns", assert a column_list with one block per column; item is
  absent with a single selection.

---

## i18n

New message keys, added to **every** locale via the `blok-translations` skill:

- `tools.columns.resizeAriaLabel` — ARIA label for the resize separator.
- `tools.columns.turnInto` — "Turn into columns" menu item title.

`src/components/i18n/locales/en/messages.json` already holds
`tools.columns.col2…col5` (around line 113).

---

## Out of scope

- Minimum column width floor (`COLUMN_MIN_WIDTH`) — separate fix, not requested
  here.
- Slash-menu command support for non-insert actions.
- Single-block "turn into columns".

## Risk notes

- Fix 2A intentionally changes shipped, tested horizontal-arrow behavior; the two
  rewritten specs are the contract for the new behavior.
- Threading `api` into `buildColumnResizers` touches two call sites; both already
  hold `api`, so the change is mechanical.
