# Table Cell Any Block Type — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Open table cells to accept any block type (except tables). The always-blocks architecture is already type-agnostic — this plan removes restrictions and verifies the three entry points work.

**Tech Stack:** TypeScript, Vitest (unit), Playwright (E2E), DOM APIs

**Design doc:** `docs/plans/2026-02-06-table-cell-any-block-type-design.md`

---

## Task 1: Verify slash menu opens in table cells

The `/` key handler in `BlockEvents.slashPressed()` (line 301) already fires inside cells — it bypasses the toolbar visibility check. But `activateToolbox()` calls `Toolbar.moveAndOpen()` which early-returns for cell blocks (toolbar line 333), so the toolbox popover may not position correctly.

**Files:**
- Test: `test/playwright/tests/tools/table-any-block-type.spec.ts` (new)

**Step 1: Write the E2E test**

```typescript
test('typing / in empty cell paragraph should open the toolbox', async ({ page }) => {
  // Create a table, click into first cell
  // Type / in the empty paragraph
  // Assert: toolbox popover is visible
  // Assert: toolbox contains at least header tool
});
```

**Step 2: Run test**

```bash
yarn e2e test/playwright/tests/tools/table-any-block-type.spec.ts -g "typing / in empty cell"
```

**Step 3: If it fails, fix the toolbar/toolbox interaction**

The likely fix: in `BlockEvents.activateToolbox()` or `Toolbar.moveAndOpen()`, allow the toolbox to open for cell blocks without showing the toolbar buttons. Options:

a) In `Toolbar.moveAndOpen()`, skip the early-return for cell blocks but still hide `+` and `☰`. The toolbar positions itself but only the toolbox popover becomes visible.

b) In `BlockEvents.activateToolbox()`, skip `Toolbar.moveAndOpen()` for cell blocks and call `Toolbar.toolbox.open()` directly with a position hint.

Choose the simpler option that preserves the existing toolbar behavior for non-cell blocks.

**Step 4: Verify test passes**

**Step 5: Commit**

```bash
git commit -m "feat(table): enable slash menu inside table cells"
```

---

## Task 2: Filter table tool from toolbox when inside a cell

Prevent nested tables by excluding the table tool from the toolbox when the caret is inside a table cell.

**Files:**
- Modify: `src/components/ui/toolbox.ts`
- Test: `test/playwright/tests/tools/table-any-block-type.spec.ts`

**Step 1: Write the E2E test**

```typescript
test('table tool should not appear in toolbox when inside a table cell', async ({ page }) => {
  // Create a table, click into first cell
  // Type / to open toolbox
  // Assert: "Table" does not appear in the toolbox items
});
```

**Step 2: Run test to verify it fails**

```bash
yarn e2e test/playwright/tests/tools/table-any-block-type.spec.ts -g "table tool should not appear"
```

Expected: FAIL — table tool currently shows for all blocks.

**Step 3: Add contextual filtering to toolbox**

In `src/components/ui/toolbox.ts`, the `toolboxItemsToBeDisplayed` getter (line 373) builds the popover items. When the toolbox opens, check if the current block is inside a table cell. If so, filter out the table tool.

The check: `currentBlock.holder.closest('[data-blok-table-cell-blocks]')` — same DOM check the toolbar already uses (no cross-module dependency).

The filter point: in `insertNewBlock()` (line 499) or in the items list construction. Prefer filtering items in `toolboxItemsToBeDisplayed` since it's called on each open — but currently cached. Either:

a) Invalidate the cache when the toolbox opens in a new context, or
b) Apply the filter at `open()` time by hiding/showing the table item in the popover.

Option (a) is cleaner. In `open()`, check if context changed (cell vs non-cell) and invalidate `_toolboxItemsToBeDisplayed`.

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git commit -m "feat(table): filter table tool from toolbox inside table cells"
```

---

## Task 3: Verify slash menu block insertion is claimed by cells

When a user picks a tool from the slash menu inside a cell, the new block must land in the cell (not escape to the document level).

**Files:**
- Test: `test/playwright/tests/tools/table-any-block-type.spec.ts`

**Step 1: Write the E2E test**

```typescript
test('selecting header from slash menu should create header block inside cell', async ({ page }) => {
  // Create a table, click into first cell
  // Type / then select "Heading"
  // Type "Hello"
  // Assert: cell contains an h1/h2 element with "Hello"
  // Assert: block is visually inside the cell (not below the table)
});
```

**Step 2: Run test**

```bash
yarn e2e test/playwright/tests/tools/table-any-block-type.spec.ts -g "selecting header from slash menu"
```

**Step 3: If it fails, debug the block claiming flow**

The expected flow:
1. Toolbox calls `insertNewBlock()` with `shouldReplaceBlock=true` (cell paragraph is empty after `/` removed)
2. `api.blocks.insert()` removes old paragraph, inserts header at same index
3. `block-removed` fires → `recordRemovedBlockCell()` maps the index to the cell
4. `block-added` fires → `handleBlockMutation()` finds `removedCell` at that index → calls `claimBlockForCell()`

If this doesn't work, the issue is likely in step 1 (the slash text `/` isn't fully removed so `shouldReplaceBlock` is false) or step 4 (the index mapping is off).

**Step 4: Verify test passes**

**Step 5: Commit**

```bash
git commit -m "test(table): verify slash menu block insertion works inside cells"
```

---

## Task 4: Verify block conversion (markdown shortcuts) works in cells

Markdown shortcuts like `# ` (header), `- ` (list), `` ``` `` (code) convert the current paragraph to a different block type. This is a replace operation that must work inside cells without triggering spurious empty-cell paragraphs.

**Files:**
- Test: `test/playwright/tests/tools/table-any-block-type.spec.ts`

**Step 1: Write the E2E tests**

```typescript
test('typing "# " in cell should convert paragraph to header', async ({ page }) => {
  // Create a table, click into first cell
  // Type "# " (hash + space)
  // Type "Title"
  // Assert: cell contains a heading with "Title"
  // Assert: no spurious empty paragraph appeared in the cell
});

test('typing "- " in cell should convert paragraph to list', async ({ page }) => {
  // Create a table, click into first cell
  // Type "- " (dash + space)
  // Type "Item"
  // Assert: cell contains a list item with "Item"
});
```

**Step 2: Run tests**

```bash
yarn e2e test/playwright/tests/tools/table-any-block-type.spec.ts -g "typing"
```

**Step 3: If header conversion fails**

The conversion flow for markdown shortcuts goes through `api.blocks.convert()`:
1. `block-removed` fires for the paragraph → `recordRemovedBlockCell()` maps index to cell
2. `block-added` fires for the header → `handleBlockMutation()` finds `removedCell` → claims header for cell
3. `queueMicrotask` check runs → cell has a block → no spurious paragraph

If the timing is wrong (microtask fires before `block-added`), we may need to adjust the deferred check. The current `queueMicrotask` should be sufficient since `block-added` fires synchronously during `convert()`, before the microtask drains.

**Step 4: Verify tests pass**

**Step 5: Commit**

```bash
git commit -m "test(table): verify markdown shortcuts work inside table cells"
```

---

## Task 5: Verify paste works in cells

Three paste paths need to work: file paste (images), HTML paste (headers, lists from external editors), and pattern paste (URLs).

**Files:**
- Test: `test/playwright/tests/tools/table-any-block-type.spec.ts`

**Step 1: Write E2E tests**

```typescript
test('pasting HTML with a heading into a cell should create header block', async ({ page }) => {
  // Create a table, click into first cell
  // Paste HTML: <h2>Pasted Title</h2>
  // Assert: cell contains a heading with "Pasted Title"
});

test('pasting HTML with a list into a cell should create list block', async ({ page }) => {
  // Create a table, click into first cell
  // Paste HTML: <ul><li>Item 1</li><li>Item 2</li></ul>
  // Assert: cell contains a list with "Item 1" and "Item 2"
});
```

Note: File paste (images) can't be fully tested without a registered image tool. The test for file paste depends on consumer-provided tools. Skip for now — the infrastructure works the same way as HTML paste (both go through `BlockManager.paste()` → `block-added`).

**Step 2: Run tests**

```bash
yarn e2e test/playwright/tests/tools/table-any-block-type.spec.ts -g "pasting"
```

**Step 3: If HTML paste fails, check sanitizer**

The `HtmlHandler` builds a sanitizer config from the TARGET TOOL's `sanitize` getter (not the table's). So if pasting `<h2>`, the header tool's sanitizer applies. This should work without changes.

However, if the paste module uses the CURRENT block's sanitizer to pre-process the clipboard HTML before routing to tools, the table's restrictive sanitizer (`sanitizerConfig` in `index.ts:89-99`) could strip the `<h2>` tags. Check if this is the case and fix by:
- Broadening the table's sanitizer to pass through structural tags
- Or ensuring the paste module uses the target tool's sanitizer, not the current block's

**Step 4: Verify tests pass**

**Step 5: Commit**

```bash
git commit -m "test(table): verify paste creates correct block types inside cells"
```

---

## Task 6: CSS constraints for non-paragraph content in cells

Non-paragraph blocks (images, code blocks, embeds) may have natural dimensions exceeding the cell width. Add CSS to constrain content.

**Files:**
- Modify: `src/tools/table/table-core.ts` (cell styles)
- Test: `test/playwright/tests/tools/table-any-block-type.spec.ts`

**Step 1: Write E2E test**

```typescript
test('block content should not overflow cell width', async ({ page }) => {
  // Create a table, insert a block with wide content (e.g., code block with long line)
  // Assert: cell does not have horizontal scrollbar visible outside the cell
  // Assert: content is constrained within the cell bounds
});
```

**Step 2: Add CSS constraints**

In `src/tools/table/table-core.ts`, the cell already has `overflow: hidden` and `overflowWrap: break-word` (line 470-471). Additional constraints on the blocks container:

```typescript
// In createCell() — on the blocks container
blocksContainer.style.maxWidth = '100%';
blocksContainer.style.overflow = 'hidden';
```

And for specific block types that render images or iframes, the CSS should include:

```css
[data-blok-table-cell-blocks] img {
  max-width: 100%;
  height: auto;
}

[data-blok-table-cell-blocks] pre {
  overflow-x: auto;
}
```

These can be added via a stylesheet or inline on the blocks container.

**Step 3: Run test to verify**

**Step 4: Commit**

```bash
git commit -m "feat(table): CSS constraints for non-paragraph content in cells"
```

---

## Task 7: Strip paragraph placeholder in non-paragraph blocks

Currently `stripPlaceholders()` in `table-cell-blocks.ts` (line 283) removes `data-blok-placeholder-active` and `data-placeholder` attributes from cell content. This is paragraph-specific. Non-paragraph blocks may have different placeholder mechanisms.

**Files:**
- Modify: `src/tools/table/table-cell-blocks.ts`
- Test: `test/unit/tools/table/table-cell-blocks.test.ts`

**Step 1: Write unit test**

```typescript
describe('stripPlaceholders', () => {
  it('should not fail on non-paragraph blocks without placeholder attributes', () => {
    // Create a cell with a header block (no placeholder attributes)
    // Call stripPlaceholders
    // Assert: no error, block content unchanged
  });
});
```

**Step 2: Verify stripPlaceholders is safe for non-paragraph blocks**

The current implementation uses `querySelectorAll` to find and remove placeholder attributes. If non-paragraph blocks don't have these attributes, the method is a no-op — which is correct.

If verification shows it's already safe, this task is just the test confirming it. Mark as done.

**Step 3: Commit**

```bash
git commit -m "test(table): verify placeholder stripping is safe for non-paragraph blocks"
```

---

## Execution Order & Dependencies

```
Task 1 (slash menu opens) ──────────┐
                                     ├── Task 2 (filter table tool) ──┐
                                     ├── Task 3 (slash menu claiming) │
                                     │                                │
Task 4 (markdown shortcuts) ─────────┤                                │
Task 5 (paste) ───────────────────────┤                                │
Task 6 (CSS constraints) ─────────────┤                                │
Task 7 (placeholder safety) ──────────┘                                │
                                                                       └── Done
```

Tasks 1, 4, 5, 6, 7 can start in parallel (they're independent investigations). Task 2 depends on Task 1 (toolbox must open before we can filter it). Task 3 depends on Task 1.
