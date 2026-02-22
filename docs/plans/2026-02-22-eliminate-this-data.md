# Eliminate `this.data` from Table Tool — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the stale `this.data` field from the Table class so the `TableModel` is the single source of truth for all metadata and content.

**Architecture:** Add public getters to `TableModel` for all metadata fields it already stores privately. Replace every `this.data.fieldName` read in `index.ts` with `this.model.fieldName`. Replace every dual-write (`this.data.x = v; this.model.setX(v)`) with just the model setter. Use a temporary `initialContent` field for initialization-time content that gets nulled after `rendered()`.

**Tech Stack:** TypeScript, Vitest (unit tests)

---

### Task 1: Add public getters to TableModel

**Files:**
- Modify: `src/tools/table/table-model.ts:35-43` (insert getters after existing dimension getters)
- Test: `test/unit/tools/table/table-model.test.ts`

**Context:** `TableModel` has private backing fields (`withHeadingsValue`, `withHeadingColumnValue`, `stretchedValue`, `colWidthsValue`, `initialColWidthValue`) and public setters for each. It exposes `rows` and `cols` getters but no getters for the metadata fields. We need getters so `index.ts` can read from the model instead of `this.data`.

**Step 1: Write failing tests for all 5 getters**

Add a new describe block after the existing "constructor" tests in `test/unit/tools/table/table-model.test.ts`:

```typescript
describe('metadata getters', () => {
  it('exposes withHeadings', () => {
    const model = new TableModel(makeData({ withHeadings: true }));

    expect(model.withHeadings).toBe(true);
  });

  it('exposes withHeadingColumn', () => {
    const model = new TableModel(makeData({ withHeadingColumn: true }));

    expect(model.withHeadingColumn).toBe(true);
  });

  it('exposes stretched', () => {
    const model = new TableModel(makeData({ stretched: true }));

    expect(model.stretched).toBe(true);
  });

  it('exposes colWidths as a copy', () => {
    const model = new TableModel(makeData({ colWidths: [100, 200] }));

    const widths = model.colWidths;

    expect(widths).toEqual([100, 200]);

    // Mutating the returned array must not affect the model
    widths?.push(999);
    expect(model.colWidths).toEqual([100, 200]);
  });

  it('returns undefined for colWidths when not set', () => {
    const model = new TableModel(makeData());

    expect(model.colWidths).toBeUndefined();
  });

  it('exposes initialColWidth', () => {
    const model = new TableModel(makeData({ initialColWidth: 150 }));

    expect(model.initialColWidth).toBe(150);
  });

  it('returns undefined for initialColWidth when not set', () => {
    const model = new TableModel();

    expect(model.initialColWidth).toBeUndefined();
  });

  it('reflects setter updates', () => {
    const model = new TableModel();

    model.setWithHeadings(true);
    model.setWithHeadingColumn(true);
    model.setStretched(true);
    model.setColWidths([300, 400]);
    model.setInitialColWidth(350);

    expect(model.withHeadings).toBe(true);
    expect(model.withHeadingColumn).toBe(true);
    expect(model.stretched).toBe(true);
    expect(model.colWidths).toEqual([300, 400]);
    expect(model.initialColWidth).toBe(350);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `yarn test test/unit/tools/table/table-model.test.ts`

Expected: FAIL — `model.withHeadings` is not a property (TypeScript error or undefined).

**Step 3: Add the 5 getters to TableModel**

In `src/tools/table/table-model.ts`, insert after line 43 (after the `cols` getter), before the `// ─── Snapshot` comment:

```typescript
  // ─── Metadata getters ────────────────────────────────────────────

  get withHeadings(): boolean {
    return this.withHeadingsValue;
  }

  get withHeadingColumn(): boolean {
    return this.withHeadingColumnValue;
  }

  get stretched(): boolean {
    return this.stretchedValue;
  }

  get colWidths(): number[] | undefined {
    return this.colWidthsValue ? [...this.colWidthsValue] : undefined;
  }

  get initialColWidth(): number | undefined {
    return this.initialColWidthValue;
  }
```

**Step 4: Run tests to verify they pass**

Run: `yarn test test/unit/tools/table/table-model.test.ts`

Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/tools/table/table-model.ts test/unit/tools/table/table-model.test.ts
git commit -m "feat(table): add metadata getters to TableModel"
```

---

### Task 2: Narrow ActionContext.data type

**Files:**
- Modify: `src/tools/table/table-row-col-action-handler.ts:12-24` (change `ActionContext.data` type)
- Modify: `src/tools/table/table-operations.ts:163-182` (change `computeInsertColumnWidths` parameter)

**Context:** `ActionContext.data` is typed as `TableData`, but only 4 fields are ever read: `colWidths`, `withHeadings`, `withHeadingColumn`, `initialColWidth`. The `computeInsertColumnWidths` function in `table-operations.ts` also takes `data: TableData` but only reads `colWidths` and `initialColWidth`. We narrow both so `index.ts` can pass model-derived primitives instead of a full `TableData` object.

**Step 1: Run existing tests to confirm green baseline**

Run: `yarn test test/unit/tools/table/table.test.ts test/unit/tools/table/table-operations.test.ts`

Expected: ALL PASS

**Step 2: Define the narrow type and apply it**

In `src/tools/table/table-row-col-action-handler.ts`, replace the `ActionContext` interface (lines 19-24):

```typescript
/**
 * Minimal metadata the action handler needs.
 * Decoupled from TableData so callers can pass model-derived primitives.
 */
export interface ActionData {
  colWidths: number[] | undefined;
  withHeadings: boolean;
  withHeadingColumn: boolean;
  initialColWidth: number | undefined;
}

interface ActionContext {
  grid: TableGrid;
  data: ActionData;
  cellBlocks: TableCellBlocks | null;
  blocksToDelete?: string[];
}
```

Remove the `import type { TableData } from './types';` line (line 12) since `TableData` is no longer used in this file.

In `src/tools/table/table-operations.ts`, change `computeInsertColumnWidths` signature (line 163-167). Replace the `data: TableData` parameter with two explicit parameters:

```typescript
export const computeInsertColumnWidths = (
  gridEl: HTMLElement,
  index: number,
  colWidths: number[] | undefined,
  initialColWidth: number | undefined,
  grid: TableGrid,
): number[] => {
  const widths = colWidths ?? readPixelWidths(gridEl);

  const halfWidth = initialColWidth !== undefined
    ? Math.round((initialColWidth / 2) * 100) / 100
    : computeHalfAvgWidth(widths);

  grid.addColumn(gridEl, index, widths, halfWidth);

  const newWidths = [...widths];

  newWidths.splice(index, 0, halfWidth);

  return newWidths;
};
```

Update the call site in `table-row-col-action-handler.ts` (line 56 in `handleInsertCol`):

```typescript
const colWidths = computeInsertColumnWidths(gridEl, index, ctx.data.colWidths, ctx.data.initialColWidth, ctx.grid);
```

**Step 3: Update the test for computeInsertColumnWidths**

In `test/unit/tools/table/table-operations.test.ts`, the existing test at line ~459 passes a `data` object. Update both test calls to use the new signature:

Before:
```typescript
const result = computeInsertColumnWidths(gridEl, 1, data, grid);
```

After:
```typescript
const result = computeInsertColumnWidths(gridEl, 1, data.colWidths, data.initialColWidth, grid);
```

Apply this to both test cases in the `computeInsertColumnWidths` describe block.

**Step 4: Run tests to verify everything passes**

Run: `yarn test test/unit/tools/table/table.test.ts test/unit/tools/table/table-operations.test.ts`

Expected: ALL PASS. The `index.ts` call site at line 593 still compiles because it passes `this.data` which satisfies `ActionData` (it has all required fields as a superset).

**Step 5: Commit**

```bash
git add src/tools/table/table-row-col-action-handler.ts src/tools/table/table-operations.ts test/unit/tools/table/table-operations.test.ts
git commit -m "refactor(table): narrow ActionContext.data to ActionData interface"
```

---

### Task 3: Replace `this.data` metadata reads with model getters

**Files:**
- Modify: `src/tools/table/index.ts` (many lines — all `this.data.withHeadings`, `this.data.withHeadingColumn`, `this.data.colWidths`, `this.data.initialColWidth`, `this.data.stretched` reads)

**Context:** After Task 1, the model has getters for all metadata fields. This task replaces every **read** of `this.data.{metadata_field}` with `this.model.{metadata_field}`. We do NOT touch `this.data.content` reads yet (Task 5) and we do NOT remove `this.data` writes yet (Task 4). This is a purely mechanical change.

**Step 1: Run full table test suite for green baseline**

Run: `yarn test test/unit/tools/table/`

Expected: ALL PASS

**Step 2: Replace all metadata reads**

In `src/tools/table/index.ts`, make these replacements. The line numbers below refer to the current file state.

**`this.data.colWidths` reads** (change to `this.model.colWidths`):
- Line 138: `this.data.colWidths && SCROLL_OVERFLOW_CLASSES` → `this.model.colWidths && SCROLL_OVERFLOW_CLASSES`
- Line 150: `this.data.colWidths` → `this.model.colWidths`
- Line 156: `this.data.colWidths` → `this.model.colWidths`
- Line 157: `this.data.colWidths` → `this.model.colWidths`
- Line 415: `this.data.colWidths ?? readPixelWidths(gridEl)` → `this.model.colWidths ?? readPixelWidths(gridEl)`
- Line 432: `this.data.colWidths ?? readPixelWidths(gridEl)` → `this.model.colWidths ?? readPixelWidths(gridEl)`
- Line 472: `this.data.colWidths ?? readPixelWidths(gridEl)` → `this.model.colWidths ?? readPixelWidths(gridEl)`
- Line 506: `this.data.colWidths` → `this.model.colWidths`
- Line 507: `this.data.colWidths` → `this.model.colWidths`
- Line 664: `this.data.colWidths === undefined` → `this.model.colWidths === undefined`
- Line 665: `this.data.colWidths ?? readPixelWidths(gridEl)` → `this.model.colWidths ?? readPixelWidths(gridEl)`
- Line 958: `this.data.colWidths ?? readPixelWidths(gridEl)` → `this.model.colWidths ?? readPixelWidths(gridEl)`

**`this.data.withHeadings` reads** (change to `this.model.withHeadings`):
- Line 163: `this.data.withHeadings` → `this.model.withHeadings`
- Line 164: `this.data.withHeadings` → `this.model.withHeadings`
- Line 425: `this.data.withHeadings` → `this.model.withHeadings`
- Line 458: `this.data.withHeadings` → `this.model.withHeadings`
- Line 539: `this.data.withHeadings` → `this.model.withHeadings`
- Line 606: `this.data.withHeadings` → `this.model.withHeadings`
- Line 952: `this.data.withHeadings` → `this.model.withHeadings`

**`this.data.withHeadingColumn` reads** (change to `this.model.withHeadingColumn`):
- Line 167: `this.data.withHeadingColumn` → `this.model.withHeadingColumn`
- Line 168: `this.data.withHeadingColumn` → `this.model.withHeadingColumn`
- Line 312: `this.data.withHeadingColumn` → `this.model.withHeadingColumn`
- Line 426: `this.data.withHeadingColumn` → `this.model.withHeadingColumn`
- Line 442: `this.data.withHeadingColumn` → `this.model.withHeadingColumn`
- Line 459: `this.data.withHeadingColumn` → `this.model.withHeadingColumn`
- Line 483: `this.data.withHeadingColumn` → `this.model.withHeadingColumn`
- Line 540: `this.data.withHeadingColumn` → `this.model.withHeadingColumn`
- Line 607: `this.data.withHeadingColumn` → `this.model.withHeadingColumn`
- Line 953: `this.data.withHeadingColumn` → `this.model.withHeadingColumn`
- Line 968: `this.data.withHeadingColumn` → `this.model.withHeadingColumn`

**`this.data.initialColWidth` reads** (change to `this.model.initialColWidth`):
- Line 204: `this.data.initialColWidth === undefined` → `this.model.initialColWidth === undefined`
- Line 417: `this.data.initialColWidth !== undefined` → `this.model.initialColWidth !== undefined`
- Line 418: `this.data.initialColWidth` → `this.model.initialColWidth`
- Line 433: `this.data.initialColWidth !== undefined` → `this.model.initialColWidth !== undefined`
- Line 434: `this.data.initialColWidth` → `this.model.initialColWidth`
- Line 473: `this.data.initialColWidth !== undefined` → `this.model.initialColWidth !== undefined`
- Line 474: `this.data.initialColWidth` → `this.model.initialColWidth`
- Line 959: `this.data.initialColWidth !== undefined` → `this.model.initialColWidth !== undefined`
- Line 960: `this.data.initialColWidth` → `this.model.initialColWidth`

**`this.data.stretched` reads** (change to `this.model.stretched`):
- Line 313: `this.data.stretched` → `this.model.stretched`

**Step 3: Update handleRowColAction call site**

At line 593, where `executeRowColAction` is called, change the `data` field from `this.data` to a model-derived object:

Before:
```typescript
{ grid: this.grid, data: this.data, cellBlocks: this.cellBlocks, blocksToDelete },
```

After:
```typescript
{
  grid: this.grid,
  data: {
    colWidths: this.model.colWidths,
    withHeadings: this.model.withHeadings,
    withHeadingColumn: this.model.withHeadingColumn,
    initialColWidth: this.model.initialColWidth,
  },
  cellBlocks: this.cellBlocks,
  blocksToDelete,
},
```

**Step 4: Run tests to verify everything passes**

Run: `yarn test test/unit/tools/table/`

Expected: ALL PASS. No behavior change — model was already being kept in sync with `this.data`.

**Step 5: Commit**

```bash
git add src/tools/table/index.ts
git commit -m "refactor(table): replace this.data metadata reads with model getters"
```

---

### Task 4: Eliminate dual-mutation write patterns

**Files:**
- Modify: `src/tools/table/index.ts` (13 write sites)

**Context:** Every mutation currently does two writes: `this.data.x = v` then `this.model.setX(v)`. Since all reads now go through the model (Task 3), the `this.data` writes are dead stores. Remove them, keeping only the model setter calls.

**Step 1: Run full table test suite for green baseline**

Run: `yarn test test/unit/tools/table/`

Expected: ALL PASS

**Step 2: Remove dead `this.data` writes for metadata fields**

In `src/tools/table/index.ts`, at each site below, delete the `this.data.x = ...` line and keep only the `this.model.setX(...)` call:

**deleteColumnWithCleanup** (line 389-390):
Before:
```typescript
    this.data.colWidths = syncColWidthsAfterDeleteColumn(this.data.colWidths, colIndex);
    this.model.setColWidths(this.data.colWidths);
```
After:
```typescript
    this.model.setColWidths(syncColWidthsAfterDeleteColumn(this.model.colWidths, colIndex));
```

**onAddColumn callback** (lines 439-440):
Before:
```typescript
        this.data.colWidths = [...colWidths, halfWidth];
        this.model.setColWidths(this.data.colWidths);
```
After:
```typescript
        this.model.setColWidths([...colWidths, halfWidth]);
```

Also update line 481 (the `applyPixelWidths` call below uses `this.data.colWidths` which was just replaced in Task 3 with `this.model.colWidths`). The `applyPixelWidths` call on line 481 now reads `this.model.colWidths`. But wait — we just called `setColWidths(...)` which returns a copy. We need the widths for `applyPixelWidths`. Use a local variable:

```typescript
        const newWidths = [...colWidths, halfWidth];

        this.grid.addColumn(gridEl, undefined, colWidths, halfWidth);
        this.model.addColumn(undefined, halfWidth);
        this.model.setColWidths(newWidths);
        populateNewCells(gridEl, this.cellBlocks);
        updateHeadingColumnStyles(this.element, this.model.withHeadingColumn);
        this.initResize(gridEl);
        this.addControls?.syncRowButtonWidth();
        this.rowColControls?.refresh();
```

**onDragAddCol callback** (lines 479-481):
Before:
```typescript
        this.data.colWidths = [...colWidths, halfWidth];
        this.model.setColWidths(this.data.colWidths);
        applyPixelWidths(gridEl, this.data.colWidths);
```
After:
```typescript
        const newWidths = [...colWidths, halfWidth];

        this.model.setColWidths(newWidths);
        applyPixelWidths(gridEl, newWidths);
```

**onDragRemoveCol callback** (lines 503-504, 506-507):
Before:
```typescript
        this.data.colWidths = syncColWidthsAfterDeleteColumn(this.data.colWidths, colCount - 1);
        this.model.setColWidths(this.data.colWidths);

        if (this.data.colWidths) {
          applyPixelWidths(gridEl, this.data.colWidths);
        }
```
After:
```typescript
        const updatedWidths = syncColWidthsAfterDeleteColumn(this.model.colWidths, colCount - 1);

        this.model.setColWidths(updatedWidths);

        if (updatedWidths) {
          applyPixelWidths(gridEl, updatedWidths);
        }
```

**handleRowColAction** (lines 596-604):
Before:
```typescript
    this.data.colWidths = result.colWidths;
    this.data.withHeadings = result.withHeadings;
    this.data.withHeadingColumn = result.withHeadingColumn;
    this.pendingHighlight = result.pendingHighlight;

    // Sync model metadata
    this.model.setColWidths(this.data.colWidths);
    this.model.setWithHeadings(this.data.withHeadings);
    this.model.setWithHeadingColumn(this.data.withHeadingColumn);
```
After:
```typescript
    this.model.setColWidths(result.colWidths);
    this.model.setWithHeadings(result.withHeadings);
    this.model.setWithHeadingColumn(result.withHeadingColumn);
    this.pendingHighlight = result.pendingHighlight;
```

**initResize onChange callback** (lines 675-676):
Before:
```typescript
        this.data.colWidths = newWidths;
        this.model.setColWidths(newWidths);
```
After:
```typescript
        this.model.setColWidths(newWidths);
```

**expandGridForPaste** (lines 965-966):
Before:
```typescript
      this.data.colWidths = [...colWidths, halfWidth];
      this.model.setColWidths(this.data.colWidths);
```
After:
```typescript
      const newWidths = [...colWidths, halfWidth];

      this.model.setColWidths(newWidths);
```

**rendered() initialColWidth** (lines 207-209):
Before:
```typescript
      this.data.initialColWidth = widths.length > 0
        ? computeInitialColWidth(widths)
        : undefined;
```
After:
```typescript
      this.model.setInitialColWidth(widths.length > 0
        ? computeInitialColWidth(widths)
        : undefined);
```

**Step 3: Run tests to verify everything passes**

Run: `yarn test test/unit/tools/table/`

Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/tools/table/index.ts
git commit -m "refactor(table): eliminate dual-mutation write patterns"
```

---

### Task 5: Implement initialContent lifecycle

**Files:**
- Modify: `src/tools/table/index.ts`

**Context:** `this.data.content` is used in: (a) `render()` to determine grid dimensions and fill content, (b) `rendered()` to initialize cell blocks and to mount readonly blocks, (c) `setData()` and `onPaste()` for re-render cycles. After `rendered()` completes, the model owns content exclusively. We replace `this.data.content` with a temporary `this.initialContent` field.

**Step 1: Run full table test suite for green baseline**

Run: `yarn test test/unit/tools/table/`

Expected: ALL PASS

**Step 2: Add `initialContent` field, update constructor**

In `src/tools/table/index.ts`:

Add the field after line 84 (`private isNewTable = false;`):

```typescript
  private initialContent: import('./types').LegacyCellContent[][] | null = null;
```

In the constructor (line 90), change:
```typescript
    this.data = normalizeTableData(data, config ?? {});
    this.grid = new TableGrid({ readOnly });
    this.model = new TableModel(this.data);
```
To:
```typescript
    const normalized = normalizeTableData(data, config ?? {});

    this.initialContent = normalized.content;
    this.grid = new TableGrid({ readOnly });
    this.model = new TableModel(normalized);
```

Remove the `private data: TableData;` field declaration (line 73).

**Step 3: Replace all `this.data.content` reads**

**render()** (lines 145-154, 138):

Line 138 — the `this.data.colWidths` was already replaced in Task 3. The remaining `SCROLL_OVERFLOW_CLASSES` reference is fine.

Line 145: `this.data.content.length === 0` → `(this.initialContent?.length ?? 0) === 0`

Line 147: `this.data.content.length || this.config.rows || DEFAULT_ROWS` → `this.initialContent?.length || this.config.rows || DEFAULT_ROWS`

Line 148: `this.data.content[0]?.length || this.config.cols || DEFAULT_COLS` → `this.initialContent?.[0]?.length || this.config.cols || DEFAULT_COLS`

Line 152: `this.data.content.length > 0` → `(this.initialContent?.length ?? 0) > 0`

Line 153: `this.grid.fillGrid(gridEl, this.data.content)` → `this.grid.fillGrid(gridEl, this.initialContent ?? [])`

**rendered()** — readonly path (line 191):

`mountCellBlocksReadOnly(gridEl, this.data.content, this.api, this.blockId ?? '')` → `mountCellBlocksReadOnly(gridEl, this.initialContent ?? [], this.api, this.blockId ?? '')`

**rendered()** — edit path (lines 197-198):

Before:
```typescript
    this.data.content = this.cellBlocks?.initializeCells(this.data.content) ?? this.data.content;
    this.model.replaceAll(this.data);
```
After:
```typescript
    const initializedContent = this.cellBlocks?.initializeCells(this.initialContent ?? []) ?? this.initialContent ?? [];

    this.model.replaceAll({
      withHeadings: this.model.withHeadings,
      withHeadingColumn: this.model.withHeadingColumn,
      stretched: this.model.stretched,
      content: initializedContent,
      colWidths: this.model.colWidths,
      initialColWidth: this.model.initialColWidth,
    });
    this.initialContent = null;
```

**rendered()** — initialColWidth (line 204-205):

The `this.data.colWidths` read was already replaced in Task 3. The `this.data.initialColWidth` read was replaced in Task 3 too. After Task 4, the write uses the model setter. No changes needed here.

**setData()** (lines 238-244, 278-279):

Before:
```typescript
    this.data = normalizeTableData(
      {
        ...this.data,
        ...newData,
      } as TableData,
      this.config
    );
```
After:
```typescript
    const currentSnapshot = this.model.snapshot();
    const normalized = normalizeTableData(
      {
        ...currentSnapshot,
        ...newData,
      } as TableData,
      this.config
    );

    this.initialContent = normalized.content;
    this.model.replaceAll(normalized);
```

And lines 278-279:
Before:
```typescript
      this.data.content = this.cellBlocks?.initializeCells(this.data.content) ?? this.data.content;
      this.model.replaceAll(this.data);
```
After:
```typescript
      const setDataContent = this.cellBlocks?.initializeCells(this.initialContent ?? []) ?? this.initialContent ?? [];

      this.model.replaceAll({
        ...this.model.snapshot(),
        content: setDataContent,
      });
      this.initialContent = null;
```

**onPaste()** (lines 310-315, 333-334):

Before (lines 310-315):
```typescript
    this.data = {
      withHeadings,
      withHeadingColumn: this.data.withHeadingColumn,
      stretched: this.data.stretched,
      content: tableContent,
    };
```
After:
```typescript
    this.model.setWithHeadings(withHeadings);
    this.initialContent = tableContent;
```

Before (lines 333-334):
```typescript
      this.data.content = this.cellBlocks?.initializeCells(this.data.content) ?? this.data.content;
      this.model.replaceAll(this.data);
```
After:
```typescript
      const pasteContent = this.cellBlocks?.initializeCells(this.initialContent ?? []) ?? this.initialContent ?? [];

      this.model.replaceAll({
        ...this.model.snapshot(),
        content: pasteContent,
      });
      this.initialContent = null;
```

**Step 4: Remove stale `this.data` field and its import**

Delete the field declaration: `private data: TableData;` (line 73).

Remove `normalizeTableData` from the import if no longer used (it's still used in `setData()`).

Remove the `import type { ... TableData ... }` for `TableData` from the types import (line 51) if nothing else needs it. **Check first:** `TableData` is used in `save()` return type, `validate()` parameter, `setData()` parameter, and `onPaste()`. The first two are interface requirements. Keep the import.

**Step 5: Run tests to verify everything passes**

Run: `yarn test test/unit/tools/table/`

Expected: ALL PASS

**Step 6: Run lint to catch any TypeScript issues**

Run: `yarn lint`

Expected: PASS (no type errors from missing `this.data` references)

**Step 7: Commit**

```bash
git add src/tools/table/index.ts
git commit -m "refactor(table): replace this.data.content with initialContent lifecycle"
```

---

### Task 6: Full verification

**Files:**
- None (verification only)

**Step 1: Run all table unit tests**

Run: `yarn test test/unit/tools/table/`

Expected: ALL PASS

**Step 2: Run full unit test suite**

Run: `yarn test`

Expected: ALL PASS (no regressions outside table)

**Step 3: Run lint + type check**

Run: `yarn lint`

Expected: PASS

**Step 4: Run E2E table tests**

Run: `yarn e2e test/e2e/table/`

Expected: ALL PASS

**Step 5: Grep for any remaining `this.data` references**

Run: `grep -n 'this\.data' src/tools/table/index.ts`

Expected: Zero results. If any remain, investigate and remove them.

**Step 6: Final commit if any cleanup was needed, then push**

```bash
git push
```
