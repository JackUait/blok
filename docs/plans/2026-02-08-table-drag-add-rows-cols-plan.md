# Table Drag-to-Add Multiple Rows/Columns Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to drag the add row/column `+` buttons to live-insert multiple rows or columns proportional to drag distance. Row-height based for rows, column-width based for columns.

**Architecture:** Changes are in two files: `table-add-controls.ts` (drag logic + pointer events) and `index.ts` (new lightweight callbacks for intermediate drag steps). E2E tests validate the feature.

**Tech Stack:** TypeScript, Pointer Events API (setPointerCapture), Playwright E2E tests

---

### Task 1: Write E2E test — drag add-row button adds multiple rows

**Files:**
- Modify: `test/playwright/tests/tools/table.spec.ts`

**Step 1: Write the failing test**

Add a new describe block `'drag to add rows/columns'` inside the existing `'table tool'` describe, after the `'add row/column controls'` describe block (~line 755):

```typescript
test.describe('drag to add rows/columns', () => {
  test('dragging add-row button down adds multiple rows', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['A', 'B'], ['C', 'D']],
            },
          },
        ],
      },
    });

    const table = page.locator(TABLE_SELECTOR);

    // Hover to reveal the add-row button
    await table.hover();

    const addRowBtn = page.locator('[data-blok-table-add-row]');

    await expect(addRowBtn).toBeVisible();

    // Measure the height of a row for the drag distance
    // eslint-disable-next-line playwright/no-nth-methods -- first() needed to get first row
    const firstRow = page.locator('[data-blok-table-row]').first();
    const rowBox = await firstRow.boundingBox();

    if (!rowBox) {
      throw new Error('Row not visible');
    }

    const btnBox = await addRowBtn.boundingBox();

    if (!btnBox) {
      throw new Error('Add row button not visible');
    }

    const startX = btnBox.x + btnBox.width / 2;
    const startY = btnBox.y + btnBox.height / 2;

    // Drag down by ~2.5 row heights to add 2 rows
    const dragDistance = rowBox.height * 2.5;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY + dragDistance, { steps: 10 });
    await page.mouse.up();

    // Should now have 4 rows (2 original + 2 added)
    const rows = page.locator('[data-blok-table-row]');

    await expect(rows).toHaveCount(4);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn e2e test/playwright/tests/tools/table.spec.ts -g "dragging add-row button down adds multiple rows"`
Expected: FAIL — only 3 rows (click behavior adds 1, not drag-proportional)

**Step 3: Commit**

```bash
git add test/playwright/tests/tools/table.spec.ts
git commit -m "test(table): add E2E test for drag-to-add multiple rows"
```

---

### Task 2: Write E2E test — drag add-col button adds multiple columns

**Files:**
- Modify: `test/playwright/tests/tools/table.spec.ts`

**Step 1: Write the failing test**

Add inside the `'drag to add rows/columns'` describe block:

```typescript
test('dragging add-col button right adds multiple columns', async ({ page }) => {
  await createBlok(page, {
    tools: defaultTools,
    data: {
      blocks: [
        {
          type: 'table',
          data: {
            withHeadings: false,
            content: [['A', 'B'], ['C', 'D']],
          },
        },
      ],
    },
  });

  const table = page.locator(TABLE_SELECTOR);

  await table.hover();

  const addColBtn = page.locator('[data-blok-table-add-col]');

  await expect(addColBtn).toBeVisible();

  // Measure column width
  // eslint-disable-next-line playwright/no-nth-methods -- first() needed to get first cell
  const firstCell = page.locator(CELL_SELECTOR).first();
  const cellBox = await firstCell.boundingBox();

  if (!cellBox) {
    throw new Error('Cell not visible');
  }

  const btnBox = await addColBtn.boundingBox();

  if (!btnBox) {
    throw new Error('Add col button not visible');
  }

  const startX = btnBox.x + btnBox.width / 2;
  const startY = btnBox.y + btnBox.height / 2;

  // Drag right by ~2.5 column widths to add 2 columns
  const dragDistance = cellBox.width * 2.5;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dragDistance, startY, { steps: 10 });
  await page.mouse.up();

  // First row should now have 4 cells (2 original + 2 added)
  // eslint-disable-next-line playwright/no-nth-methods -- first() needed to get first row
  const firstRow = page.locator('[data-blok-table-row]').first();
  const cells = firstRow.locator(CELL_SELECTOR);

  await expect(cells).toHaveCount(4);
});
```

**Step 2: Run test to verify it fails**

Run: `yarn e2e test/playwright/tests/tools/table.spec.ts -g "dragging add-col button right adds multiple columns"`
Expected: FAIL

**Step 3: Commit**

```bash
git add test/playwright/tests/tools/table.spec.ts
git commit -m "test(table): add E2E test for drag-to-add multiple columns"
```

---

### Task 3: Write E2E test — drag back cancels added rows

**Files:**
- Modify: `test/playwright/tests/tools/table.spec.ts`

**Step 1: Write the failing test**

Add inside the `'drag to add rows/columns'` describe block:

```typescript
test('dragging add-row button back up cancels added rows', async ({ page }) => {
  await createBlok(page, {
    tools: defaultTools,
    data: {
      blocks: [
        {
          type: 'table',
          data: {
            withHeadings: false,
            content: [['A', 'B'], ['C', 'D']],
          },
        },
      ],
    },
  });

  const table = page.locator(TABLE_SELECTOR);

  await table.hover();

  const addRowBtn = page.locator('[data-blok-table-add-row]');

  await expect(addRowBtn).toBeVisible();

  // eslint-disable-next-line playwright/no-nth-methods -- first() needed to get first row
  const firstRow = page.locator('[data-blok-table-row]').first();
  const rowBox = await firstRow.boundingBox();

  if (!rowBox) {
    throw new Error('Row not visible');
  }

  const btnBox = await addRowBtn.boundingBox();

  if (!btnBox) {
    throw new Error('Add row button not visible');
  }

  const startX = btnBox.x + btnBox.width / 2;
  const startY = btnBox.y + btnBox.height / 2;

  // Drag down to add rows, then drag back past start to cancel
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + rowBox.height * 2, { steps: 5 });
  await page.mouse.move(startX, startY - 10, { steps: 5 });
  await page.mouse.up();

  // Should still have only 2 original rows
  const rows = page.locator('[data-blok-table-row]');

  await expect(rows).toHaveCount(2);
});
```

**Step 2: Run test to verify it fails**

Run: `yarn e2e test/playwright/tests/tools/table.spec.ts -g "dragging add-row button back up cancels"`
Expected: FAIL

**Step 3: Commit**

```bash
git add test/playwright/tests/tools/table.spec.ts
git commit -m "test(table): add E2E test for drag-to-add cancel behavior"
```

---

### Task 4: Implement drag-to-add in TableAddControls

**Files:**
- Modify: `src/tools/table/table-add-controls.ts`

**Step 1: Expand the options interface**

Change `TableAddControlsOptions` to include new drag callbacks:

```typescript
interface TableAddControlsOptions {
  wrapper: HTMLElement;
  grid: HTMLElement;
  onAddRow: () => void;
  onAddColumn: () => void;
  onDragAddRow: () => void;
  onDragRemoveRow: () => void;
  onDragAddCol: () => void;
  onDragRemoveCol: () => void;
  onDragEnd: () => void;
}
```

**Step 2: Add drag state and new fields**

Add a constant and interface at file level:

```typescript
const DRAG_THRESHOLD = 5;

interface DragState {
  axis: 'row' | 'col';
  startPos: number;
  unitSize: number;
  addedCount: number;
  pointerId: number;
}
```

Add new private fields to the class:

```typescript
private dragState: DragState | null = null;
private onDragAddRow: () => void;
private onDragRemoveRow: () => void;
private onDragAddCol: () => void;
private onDragRemoveCol: () => void;
private onDragEnd: () => void;
private boundPointerMove: (e: PointerEvent) => void;
private boundPointerUp: (e: PointerEvent) => void;
```

**Step 3: Replace click listeners with pointer event listeners**

In the constructor, instead of:
```typescript
this.addRowBtn.addEventListener('click', this.boundAddRowClick);
this.addColBtn.addEventListener('click', this.boundAddColClick);
```

Store the new callbacks and bind pointer handlers:
```typescript
this.onDragAddRow = options.onDragAddRow;
this.onDragRemoveRow = options.onDragRemoveRow;
this.onDragAddCol = options.onDragAddCol;
this.onDragRemoveCol = options.onDragRemoveCol;
this.onDragEnd = options.onDragEnd;

this.boundPointerMove = this.handlePointerMove.bind(this);
this.boundPointerUp = this.handlePointerUp.bind(this);

this.addRowBtn.addEventListener('pointerdown', (e) => this.handlePointerDown('row', e));
this.addColBtn.addEventListener('pointerdown', (e) => this.handlePointerDown('col', e));
```

**Step 4: Implement drag handlers**

```typescript
private handlePointerDown(axis: 'row' | 'col', e: PointerEvent): void {
  e.preventDefault();

  const target = axis === 'row' ? this.addRowBtn : this.addColBtn;

  target.setPointerCapture(e.pointerId);

  const unitSize = this.measureUnitSize(axis);

  this.dragState = {
    axis,
    startPos: axis === 'row' ? e.clientY : e.clientX,
    unitSize,
    addedCount: 0,
    pointerId: e.pointerId,
  };

  target.addEventListener('pointermove', this.boundPointerMove);
  target.addEventListener('pointerup', this.boundPointerUp);
}

private handlePointerMove(e: PointerEvent): void {
  if (!this.dragState) {
    return;
  }

  const { axis, startPos, unitSize } = this.dragState;
  const currentPos = axis === 'row' ? e.clientY : e.clientX;
  const delta = currentPos - startPos;
  const targetCount = Math.max(0, Math.floor(delta / unitSize));

  while (this.dragState.addedCount < targetCount) {
    if (axis === 'row') {
      this.onDragAddRow();
    } else {
      this.onDragAddCol();
    }

    this.dragState.addedCount++;
  }

  while (this.dragState.addedCount > targetCount) {
    if (axis === 'row') {
      this.onDragRemoveRow();
    } else {
      this.onDragRemoveCol();
    }

    this.dragState.addedCount--;
  }

  // Set cursor feedback if dragging past threshold
  if (Math.abs(delta) > DRAG_THRESHOLD) {
    document.body.style.cursor = axis === 'row' ? 'row-resize' : 'col-resize';
  }
}

private handlePointerUp(e: PointerEvent): void {
  if (!this.dragState) {
    return;
  }

  const { axis, startPos, addedCount, pointerId } = this.dragState;
  const currentPos = axis === 'row' ? e.clientY : e.clientX;
  const totalMovement = Math.abs(currentPos - startPos);

  const target = axis === 'row' ? this.addRowBtn : this.addColBtn;

  target.releasePointerCapture(pointerId);
  target.removeEventListener('pointermove', this.boundPointerMove);
  target.removeEventListener('pointerup', this.boundPointerUp);

  document.body.style.cursor = '';
  this.dragState = null;

  if (totalMovement < DRAG_THRESHOLD) {
    // Treat as click: add exactly one
    if (axis === 'row') {
      this.boundAddRowClick();
    } else {
      this.boundAddColClick();
    }

    return;
  }

  if (addedCount > 0) {
    this.onDragEnd();
  }
}

private measureUnitSize(axis: 'row' | 'col'): number {
  if (axis === 'row') {
    const rows = this.grid.querySelectorAll('[data-blok-table-row]');
    const lastRow = rows[rows.length - 1] as HTMLElement | undefined;

    return lastRow?.offsetHeight ?? 30;
  }

  const firstRow = this.grid.querySelector('[data-blok-table-row]');

  if (!firstRow) {
    return 100;
  }

  const cells = firstRow.querySelectorAll('[data-blok-table-cell]');
  const lastCell = cells[cells.length - 1] as HTMLElement | undefined;

  return lastCell?.offsetWidth ?? 100;
}
```

**Step 5: Update destroy()**

Remove click listener cleanup and add pointer listener cleanup:

```typescript
public destroy(): void {
  this.wrapper.removeEventListener('mousemove', this.boundMouseMove);
  this.wrapper.removeEventListener('mouseleave', this.boundMouseLeave);

  // Clean up any in-progress drag
  if (this.dragState) {
    const target = this.dragState.axis === 'row' ? this.addRowBtn : this.addColBtn;

    target.removeEventListener('pointermove', this.boundPointerMove);
    target.removeEventListener('pointerup', this.boundPointerUp);
    document.body.style.cursor = '';
    this.dragState = null;
  }

  this.clearRowTimeout();
  this.clearColTimeout();
  this.addRowBtn.remove();
  this.addColBtn.remove();
}
```

**Step 6: Lock button visibility during drag**

Override the hide logic so buttons stay visible during drag. In `scheduleHideRow()` and `scheduleHideCol()`, add an early return if drag is active:

```typescript
private scheduleHideRow(): void {
  if (!this.rowVisible || this.rowHideTimeout !== null || this.dragState?.axis === 'row') {
    return;
  }
  // ... rest unchanged
}

private scheduleHideCol(): void {
  if (!this.colVisible || this.colHideTimeout !== null || this.dragState?.axis === 'col') {
    return;
  }
  // ... rest unchanged
}
```

**Step 7: Commit**

```bash
git add src/tools/table/table-add-controls.ts
git commit -m "feat(table): implement drag-to-add logic in TableAddControls"
```

---

### Task 5: Wire up new callbacks in Table.initAddControls()

**Files:**
- Modify: `src/tools/table/index.ts`

**Step 1: Add the new callbacks to initAddControls()**

In `initAddControls()`, expand the `TableAddControls` constructor call to include the new drag callbacks:

```typescript
private initAddControls(gridEl: HTMLElement): void {
  this.addControls?.destroy();

  if (!this.element) {
    return;
  }

  this.addControls = new TableAddControls({
    wrapper: this.element,
    grid: gridEl,
    onAddRow: () => {
      // Existing full-cycle callback (for click)
      this.grid.addRow(gridEl);
      this.populateNewCells(gridEl);
      this.updateHeadingStyles();
      this.updateHeadingColumnStyles();
      this.initResize(gridEl);
      this.addControls?.syncRowButtonWidth();
      this.rowColControls?.refresh();
    },
    onAddColumn: () => {
      // Existing full-cycle callback (for click)
      const colWidths = this.data.colWidths ?? this.readPixelWidths(gridEl);
      const halfAvgWidth = Math.round(
        (colWidths.reduce((sum, w) => sum + w, 0) / colWidths.length / 2) * 100
      ) / 100;

      this.grid.addColumn(gridEl, undefined, colWidths);
      this.data.colWidths = [...colWidths, halfAvgWidth];
      this.populateNewCells(gridEl);
      this.updateHeadingColumnStyles();
      this.initResize(gridEl);
      this.addControls?.syncRowButtonWidth();
      this.rowColControls?.refresh();
    },
    onDragAddRow: () => {
      this.grid.addRow(gridEl);
      this.populateNewCells(gridEl);
      this.updateHeadingStyles();
      this.updateHeadingColumnStyles();
    },
    onDragRemoveRow: () => {
      const rowCount = this.grid.getRowCount(gridEl);

      if (rowCount > 1) {
        this.deleteRowWithBlockCleanup(gridEl, rowCount - 1);
      }
    },
    onDragAddCol: () => {
      const colWidths = this.data.colWidths ?? this.readPixelWidths(gridEl);
      const halfAvgWidth = Math.round(
        (colWidths.reduce((sum, w) => sum + w, 0) / colWidths.length / 2) * 100
      ) / 100;

      this.grid.addColumn(gridEl, undefined, colWidths);
      this.data.colWidths = [...colWidths, halfAvgWidth];
      this.populateNewCells(gridEl);
      this.updateHeadingColumnStyles();
    },
    onDragRemoveCol: () => {
      const colCount = this.grid.getColumnCount(gridEl);

      if (colCount > 1) {
        this.deleteColumnWithBlockCleanup(gridEl, colCount - 1);
      }
    },
    onDragEnd: () => {
      this.initResize(gridEl);
      this.addControls?.syncRowButtonWidth();
      this.rowColControls?.refresh();
    },
  });
}
```

**Step 2: Run the E2E tests**

Run: `yarn e2e test/playwright/tests/tools/table.spec.ts -g "drag to add"`
Expected: All 3 new tests PASS

**Step 3: Run existing add row/column tests for regressions**

Run: `yarn e2e test/playwright/tests/tools/table.spec.ts -g "add row|add-row|add-column|add-col"`
Expected: All PASS (click behavior preserved)

**Step 4: Commit**

```bash
git add src/tools/table/index.ts
git commit -m "feat(table): wire up drag-to-add callbacks in Table"
```

---

### Task 6: Run full test suite

**Step 1: Run lint**

Run: `yarn lint`
Expected: PASS

**Step 2: Run unit tests**

Run: `yarn test`
Expected: All PASS

**Step 3: Run full E2E table suite**

Run: `yarn e2e test/playwright/tests/tools/table.spec.ts`
Expected: All PASS

**Step 4: Fix any failures and commit**

---

### Task 7: Run /refactor

Use the `refactor:refactor` skill to review all changes made in this session.

---

### Task 8: Final verification against master

Use the `verification:final-verification` skill to verify nothing is broken compared to master.

---

### Task 9: Push

```bash
git pull --rebase
bd sync
git push
git status  # Must show "up to date with origin"
```
