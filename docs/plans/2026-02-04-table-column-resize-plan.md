# Table Column Resize v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Each resize handle controls the column to its left. Table width = sum of column widths in pixels. 50px minimum per column. No separate tableWidth concept.

**Architecture:** Rewrite `TableResize` to single-column pixel-based drag. Remove `tableWidth` from data model. Initialize resize in `rendered()` lifecycle (element is in DOM, so we can read pixel widths). `table-core` keeps percentage-based initial layout; pixel conversion happens at resize init.

**Tech Stack:** TypeScript, Vitest, Playwright

---

### Task 1: Update TableData types

**Files:**
- Modify: `src/tools/table/types.ts`

**Step 1: Remove tableWidth, update colWidths doc**

Replace the entire `TableData` interface with:

```typescript
export interface TableData extends BlockToolData {
  /** Whether the first row is a heading row */
  withHeadings: boolean;
  /** Whether the table is full-width */
  stretched?: boolean;
  /** 2D array of cell HTML content (legacy format) */
  content: string[][];
  /** Column widths in pixels (e.g., [200, 300, 250]). Omit for equal widths. */
  colWidths?: number[];
}
```

**Step 2: Commit**

```bash
git add src/tools/table/types.ts
git commit -m "refactor(table): remove tableWidth from TableData, colWidths now in pixels"
```

---

### Task 2: Rewrite TableResize unit tests

**Files:**
- Modify: `test/unit/tools/table/table-resize.test.ts`

**Step 1: Rewrite test file**

Replace the entire file. Key differences from v1:
- `createGrid` helper creates cells with `px` widths and mocks `getBoundingClientRect` to return the sum
- Constructor: `new TableResize(grid, [500, 500], onChange)` — pixel widths, no `tableWidth`
- `onChange` signature: `(widths: number[]) => void` — no `tableWidth`
- Tests for: single-column drag (only dragged column changes), grid width = sum of columns, 50px minimum, container width max constraint, handles positioned in pixels

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TableResize } from '../../../../src/tools/table/table-resize';

const MIN_COL_WIDTH = 50;

/**
 * Creates a grid element with cells at given pixel widths.
 * Mocks getBoundingClientRect on the grid to return the sum.
 */
const createGrid = (colWidthsPx: number[]): HTMLDivElement => {
  const totalWidth = colWidthsPx.reduce((sum, w) => sum + w, 0);
  const container = document.createElement('div');

  Object.defineProperty(container, 'getBoundingClientRect', {
    value: () => ({ width: 1000, left: 0, right: 1000, top: 0, bottom: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) }),
  });

  const grid = document.createElement('div');

  const row = document.createElement('div');

  row.setAttribute('data-blok-table-row', '');

  colWidthsPx.forEach((w) => {
    const cell = document.createElement('div');

    cell.setAttribute('data-blok-table-cell', '');
    cell.style.width = `${w}px`;

    row.appendChild(cell);
  });

  grid.appendChild(row);
  container.appendChild(grid);
  document.body.appendChild(container);

  Object.defineProperty(grid, 'getBoundingClientRect', {
    value: () => ({ width: totalWidth, left: 0, right: totalWidth, top: 0, bottom: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) }),
  });

  return grid;
};

const createMultiRowGrid = (rows: number, colWidthsPx: number[]): HTMLDivElement => {
  const totalWidth = colWidthsPx.reduce((sum, w) => sum + w, 0);
  const container = document.createElement('div');

  Object.defineProperty(container, 'getBoundingClientRect', {
    value: () => ({ width: 1000, left: 0, right: 1000, top: 0, bottom: 300, height: 300, x: 0, y: 0, toJSON: () => ({}) }),
  });

  const grid = document.createElement('div');

  Array.from({ length: rows }).forEach(() => {
    const row = document.createElement('div');

    row.setAttribute('data-blok-table-row', '');

    colWidthsPx.forEach((w) => {
      const cell = document.createElement('div');

      cell.setAttribute('data-blok-table-cell', '');
      cell.style.width = `${w}px`;

      row.appendChild(cell);
    });

    grid.appendChild(row);
  });

  container.appendChild(grid);
  document.body.appendChild(container);

  Object.defineProperty(grid, 'getBoundingClientRect', {
    value: () => ({ width: totalWidth, left: 0, right: totalWidth, top: 0, bottom: 300, height: 300, x: 0, y: 0, toJSON: () => ({}) }),
  });

  return grid;
};

describe('TableResize', () => {
  let grid: HTMLDivElement;

  afterEach(() => {
    grid?.parentElement?.remove();
  });

  describe('handle creation', () => {
    it('creates N handles for N columns', () => {
      grid = createGrid([333, 333, 334]);
      new TableResize(grid, [333, 333, 334], vi.fn());

      const handles = grid.querySelectorAll('[data-blok-table-resize]');

      expect(handles).toHaveLength(3);
    });

    it('does not create handles for single-column grid', () => {
      grid = createGrid([1000]);
      new TableResize(grid, [1000], vi.fn());

      const handles = grid.querySelectorAll('[data-blok-table-resize]');

      expect(handles).toHaveLength(0);
    });

    it('positions handles as direct children of the grid', () => {
      grid = createGrid([500, 500]);
      new TableResize(grid, [500, 500], vi.fn());

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      expect(handle.parentElement).toBe(grid);
    });

    it('handles span full table height', () => {
      grid = createMultiRowGrid(3, [500, 500]);
      new TableResize(grid, [500, 500], vi.fn());

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      expect(handle.style.top).toBe('0px');
      expect(handle.style.bottom).toBe('0px');
      expect(handle.style.position).toBe('absolute');
    });

    it('sets grid to position relative for handle positioning', () => {
      grid = createGrid([500, 500]);
      new TableResize(grid, [500, 500], vi.fn());

      expect(grid.style.position).toBe('relative');
    });

    it('positions first handle at cumulative pixel offset of first column', () => {
      grid = createGrid([300, 700]);
      new TableResize(grid, [300, 700], vi.fn());

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      // Handle should be at 300px (first column width) minus half handle width
      expect(handle.style.left).toContain('300');
    });

    it('sets grid width to sum of column widths in pixels', () => {
      grid = createGrid([300, 400]);
      new TableResize(grid, [300, 400], vi.fn());

      expect(grid.style.width).toBe('700px');
    });
  });

  describe('single-column drag', () => {
    it('dragging handle changes only the column to its left', () => {
      grid = createGrid([500, 500]);
      const onChange = vi.fn();

      new TableResize(grid, [500, 500], onChange);

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 500, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 600 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      expect(onChange).toHaveBeenCalledTimes(1);

      const newWidths = onChange.mock.calls[0][0] as number[];

      // First column grew by 100px
      expect(newWidths[0]).toBe(600);
      // Second column unchanged
      expect(newWidths[1]).toBe(500);
    });

    it('dragging left shrinks the column and table', () => {
      grid = createGrid([500, 500]);
      const onChange = vi.fn();

      new TableResize(grid, [500, 500], onChange);

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 500, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 400 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      const newWidths = onChange.mock.calls[0][0] as number[];

      // First column shrank by 100px
      expect(newWidths[0]).toBe(400);
      // Second column unchanged
      expect(newWidths[1]).toBe(500);
    });

    it('updates grid width to sum of columns during drag', () => {
      grid = createGrid([500, 500]);

      new TableResize(grid, [500, 500], vi.fn());

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 500, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 600 }));

      // Grid width should now be 600 + 500 = 1100px
      expect(grid.style.width).toBe('1100px');

      document.dispatchEvent(new PointerEvent('pointerup', {}));
    });

    it('updates cell widths in all rows during drag', () => {
      grid = createMultiRowGrid(3, [500, 500]);

      new TableResize(grid, [500, 500], vi.fn());

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 500, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 600 }));

      const rows = grid.querySelectorAll('[data-blok-table-row]');

      rows.forEach(row => {
        const firstCell = row.querySelector('[data-blok-table-cell]') as HTMLElement;

        expect(firstCell.style.width).toBe('600px');
      });

      document.dispatchEvent(new PointerEvent('pointerup', {}));
    });
  });

  describe('clamping', () => {
    it('clamps column to 50px minimum', () => {
      grid = createGrid([100, 500]);
      const onChange = vi.fn();

      new TableResize(grid, [100, 500], onChange);

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      // Try to drag left by 200px, would make column -100px
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: -100 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      const newWidths = onChange.mock.calls[0][0] as number[];

      expect(newWidths[0]).toBe(MIN_COL_WIDTH);
      expect(newWidths[1]).toBe(500);
    });

    it('clamps column so table does not exceed container width', () => {
      grid = createGrid([400, 400]);
      const onChange = vi.fn();

      // Container is 1000px, columns total 800px
      new TableResize(grid, [400, 400], onChange);

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      // Try to grow first column by 800px, would make table 1600px > 1000px container
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 400, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 1200 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      const newWidths = onChange.mock.calls[0][0] as number[];

      // First column maxed at containerWidth - other columns = 1000 - 400 = 600
      expect(newWidths[0]).toBe(600);
      expect(newWidths[1]).toBe(400);
    });
  });

  describe('three-column table', () => {
    it('dragging middle handle only changes middle column', () => {
      grid = createGrid([300, 400, 300]);
      const onChange = vi.fn();

      new TableResize(grid, [300, 400, 300], onChange);

      // Get second handle (index 1, controls column 1)
      const handles = grid.querySelectorAll('[data-blok-table-resize]');
      const middleHandle = handles[1] as HTMLElement;

      middleHandle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 700, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 750 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      const newWidths = onChange.mock.calls[0][0] as number[];

      expect(newWidths[0]).toBe(300);  // unchanged
      expect(newWidths[1]).toBe(450);  // grew by 50
      expect(newWidths[2]).toBe(300);  // unchanged
    });

    it('dragging last handle controls last column', () => {
      grid = createGrid([300, 300, 400]);
      const onChange = vi.fn();

      new TableResize(grid, [300, 300, 400], onChange);

      const handles = grid.querySelectorAll('[data-blok-table-resize]');
      const lastHandle = handles[2] as HTMLElement;

      lastHandle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 1000, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 900 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      const newWidths = onChange.mock.calls[0][0] as number[];

      expect(newWidths[0]).toBe(300);  // unchanged
      expect(newWidths[1]).toBe(300);  // unchanged
      expect(newWidths[2]).toBe(300);  // shrank by 100
    });
  });

  describe('destroy', () => {
    it('removes event listeners on destroy', () => {
      grid = createGrid([500, 500]);
      const onChange = vi.fn();
      const resize = new TableResize(grid, [500, 500], onChange);

      resize.destroy();

      const handle = grid.querySelector('[data-blok-table-resize]') as HTMLElement;

      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 500, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 600 }));
      document.dispatchEvent(new PointerEvent('pointerup', {}));

      expect(onChange).not.toHaveBeenCalled();
    });

    it('removes handle elements from the grid on destroy', () => {
      grid = createGrid([500, 500]);
      const resize = new TableResize(grid, [500, 500], vi.fn());

      expect(grid.querySelectorAll('[data-blok-table-resize]')).toHaveLength(2);

      resize.destroy();

      expect(grid.querySelectorAll('[data-blok-table-resize]')).toHaveLength(0);
    });
  });
});
```

**Step 2: Run tests, verify they fail**

Run: `yarn test test/unit/tools/table/table-resize.test.ts`
Expected: FAIL — constructor signature mismatch, missing new behavior

---

### Task 3: Rewrite TableResize implementation

**Files:**
- Modify: `src/tools/table/table-resize.ts`

**Step 1: Rewrite the file**

Replace the entire file with:

```typescript
const RESIZE_ATTR = 'data-blok-table-resize';
const CELL_ATTR = 'data-blok-table-cell';
const ROW_ATTR = 'data-blok-table-row';
const MIN_COL_WIDTH = 50;
const HANDLE_HIT_WIDTH = 16;

/**
 * Handles column resize drag interaction on the table grid.
 * Each handle controls the column to its left.
 * Table width = sum of all column widths.
 */
export class TableResize {
  private gridEl: HTMLElement;
  private colWidths: number[];
  private onChange: (widths: number[]) => void;
  private isDragging = false;
  private dragStartX = 0;
  private dragColIndex = -1;
  private startColWidth = 0;
  private handles: HTMLElement[] = [];

  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;

  constructor(gridEl: HTMLElement, colWidths: number[], onChange: (widths: number[]) => void) {
    this.gridEl = gridEl;
    this.colWidths = [...colWidths];
    this.onChange = onChange;

    this.boundPointerDown = this.onPointerDown.bind(this);
    this.boundPointerMove = this.onPointerMove.bind(this);
    this.boundPointerUp = this.onPointerUp.bind(this);

    this.gridEl.style.position = 'relative';
    this.applyWidths();
    this.createHandles();

    this.gridEl.addEventListener('pointerdown', this.boundPointerDown);
  }

  public destroy(): void {
    this.gridEl.removeEventListener('pointerdown', this.boundPointerDown);
    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);

    this.handles.forEach(handle => handle.remove());
    this.handles = [];
  }

  private createHandles(): void {
    const colCount = this.colWidths.length;

    if (colCount < 2) {
      return;
    }

    Array.from({ length: colCount }).forEach((_, i) => {
      const handle = this.createHandle(i);

      this.handles.push(handle);
      this.gridEl.appendChild(handle);
    });
  }

  private createHandle(colIndex: number): HTMLElement {
    const handle = document.createElement('div');
    const leftPx = this.getHandleLeftPx(colIndex);

    handle.setAttribute(RESIZE_ATTR, '');
    handle.setAttribute('data-col', String(colIndex));
    handle.style.position = 'absolute';
    handle.style.top = '0px';
    handle.style.bottom = '0px';
    handle.style.width = `${HANDLE_HIT_WIDTH}px`;
    handle.style.left = `${leftPx - HANDLE_HIT_WIDTH / 2}px`;
    handle.style.cursor = 'col-resize';
    handle.style.zIndex = '2';
    handle.setAttribute('contenteditable', 'false');

    handle.addEventListener('mouseenter', () => {
      if (!this.isDragging) {
        handle.style.background = 'linear-gradient(to right, transparent 7px, #3b82f6 7px, #3b82f6 9px, transparent 9px)';
      }
    });

    handle.addEventListener('mouseleave', () => {
      if (!this.isDragging) {
        handle.style.background = '';
      }
    });

    return handle;
  }

  private getHandleLeftPx(colIndex: number): number {
    return this.colWidths.slice(0, colIndex + 1).reduce((sum, w) => sum + w, 0);
  }

  private updateHandlePositions(): void {
    this.handles.forEach((el, i) => {
      const leftPx = this.getHandleLeftPx(i);

      el.style.left = `${leftPx - HANDLE_HIT_WIDTH / 2}px`;
    });
  }

  private onPointerDown(e: PointerEvent): void {
    const target = e.target as HTMLElement;

    if (!target.hasAttribute(RESIZE_ATTR)) {
      return;
    }

    e.preventDefault();

    const colStr = target.getAttribute('data-col');

    if (colStr === null) {
      return;
    }

    this.dragColIndex = Number(colStr);
    this.isDragging = true;
    this.dragStartX = e.clientX;
    this.startColWidth = this.colWidths[this.dragColIndex];

    this.gridEl.style.userSelect = 'none';

    target.style.background = 'linear-gradient(to right, transparent 7px, #3b82f6 7px, #3b82f6 9px, transparent 9px)';

    if (target.setPointerCapture) {
      target.setPointerCapture(e.pointerId);
    }

    document.addEventListener('pointermove', this.boundPointerMove);
    document.addEventListener('pointerup', this.boundPointerUp);
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.isDragging) {
      return;
    }

    const deltaPx = e.clientX - this.dragStartX;
    let newWidth = this.startColWidth + deltaPx;

    // Clamp to minimum
    newWidth = Math.max(MIN_COL_WIDTH, newWidth);

    // Clamp so table does not exceed container width
    const containerWidth = this.gridEl.parentElement?.getBoundingClientRect().width ?? Infinity;
    const otherColumnsWidth = this.colWidths.reduce(
      (sum, w, i) => (i === this.dragColIndex ? sum : sum + w),
      0
    );
    const maxWidth = containerWidth - otherColumnsWidth;

    newWidth = Math.min(maxWidth, newWidth);

    this.colWidths[this.dragColIndex] = newWidth;
    this.applyWidths();
    this.updateHandlePositions();
  }

  private onPointerUp(): void {
    if (!this.isDragging) {
      return;
    }

    this.isDragging = false;
    this.gridEl.style.userSelect = '';

    const activeHandle = this.handles[this.dragColIndex];

    if (activeHandle) {
      activeHandle.style.background = '';
    }

    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);

    this.onChange([...this.colWidths]);
  }

  private applyWidths(): void {
    const totalWidth = this.colWidths.reduce((sum, w) => sum + w, 0);

    this.gridEl.style.width = `${totalWidth}px`;

    const rows = this.gridEl.querySelectorAll(`[${ROW_ATTR}]`);

    rows.forEach(row => {
      const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

      cells.forEach((node, i) => {
        if (i < this.colWidths.length) {
          const cellEl = node as HTMLElement;

          cellEl.style.width = `${this.colWidths[i]}px`;
        }
      });
    });
  }
}
```

**Step 2: Run tests, verify they pass**

Run: `yarn test test/unit/tools/table/table-resize.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/tools/table/table-resize.ts test/unit/tools/table/table-resize.test.ts
git commit -m "feat(table): rewrite TableResize to single-column pixel-based drag"
```

---

### Task 4: Update Table class integration

**Files:**
- Modify: `src/tools/table/index.ts`

**Step 1: Update the Table class**

Key changes:

1. **Remove all `tableWidth` references** — from `normalizeData`, `render`, `save`, `setupResize`

2. **Move resize init to `rendered()` lifecycle** — element is in DOM, can read pixel widths:

```typescript
public rendered(): void {
  if (this.readOnly || !this.element) {
    return;
  }

  const gridEl = this.element.firstElementChild as HTMLElement;

  if (!gridEl) {
    return;
  }

  this.initResize(gridEl);
}
```

3. **Add `initResize` private method:**

```typescript
private initResize(gridEl: HTMLElement): void {
  this.resize?.destroy();

  const widths = this.data.colWidths ?? this.readPixelWidths(gridEl);

  this.resize = new TableResize(gridEl, widths, (newWidths: number[]) => {
    this.data.colWidths = newWidths;
  });
}
```

4. **Add `readPixelWidths` helper:**

```typescript
private readPixelWidths(gridEl: HTMLElement): number[] {
  const firstRow = gridEl.querySelector('[data-blok-table-row]');

  if (!firstRow) {
    return [];
  }

  const cells = firstRow.querySelectorAll('[data-blok-table-cell]');

  return Array.from(cells).map(cell =>
    (cell as HTMLElement).getBoundingClientRect().width
  );
}
```

5. **Update `render()`** — remove `setupResize` call, remove `tableWidth` style, keep percentage-based initial layout for when no saved widths exist. When saved `colWidths` (pixels) exist, apply them:

```typescript
public render(): HTMLDivElement {
  // ... existing grid creation without colWidths for initial layout ...
  const gridEl = this.grid.createGrid(rows, cols);

  if (this.data.content.length > 0) {
    this.grid.fillGrid(gridEl, this.data.content);
  }

  // Apply saved pixel widths if available
  if (this.data.colWidths) {
    this.applyPixelWidths(gridEl, this.data.colWidths);
  }

  // ... rest of render (wrapper, headings, keyboard) ...
  // Do NOT call setupResize here — it moves to rendered()
}
```

6. **Add `applyPixelWidths` helper:**

```typescript
private applyPixelWidths(gridEl: HTMLElement, widths: number[]): void {
  const totalWidth = widths.reduce((sum, w) => sum + w, 0);

  gridEl.style.width = `${totalWidth}px`;

  const rowEls = gridEl.querySelectorAll('[data-blok-table-row]');

  rowEls.forEach(row => {
    const cells = row.querySelectorAll('[data-blok-table-cell]');

    cells.forEach((cell, i) => {
      if (i < widths.length) {
        (cell as HTMLElement).style.width = `${widths[i]}px`;
      }
    });
  });
}
```

7. **Update `save()`** — remove `tableWidth`, use `this.data.colWidths`:

```typescript
public save(blockContent: HTMLElement): TableData {
  const gridEl = blockContent.firstElementChild as HTMLElement;
  const colWidths = this.data.colWidths;
  const isEqual = colWidths !== undefined
    && colWidths.length > 0
    && colWidths.every(w => Math.abs(w - colWidths[0]) < 1);

  return {
    withHeadings: this.data.withHeadings,
    stretched: this.data.stretched,
    content: this.grid.getData(gridEl),
    ...(colWidths && !isEqual ? { colWidths } : {}),
  };
}
```

8. **Update `normalizeData`** — remove `tableWidth`:

```typescript
return {
  withHeadings: tableData.withHeadings ?? this.config.withHeadings ?? false,
  stretched: tableData.stretched ?? this.config.stretched ?? false,
  content: tableData.content ?? [],
  colWidths: validWidths,
};
```

9. **Update `onPaste`** — call `initResize` after DOM replacement:

```typescript
public onPaste(event: HTMLPasteEvent): void {
  // ... existing logic ...

  if (this.element?.parentNode) {
    const newElement = this.render();

    this.element.parentNode.replaceChild(newElement, this.element);
    this.element = newElement;

    if (!this.readOnly) {
      const gridEl = this.element.firstElementChild as HTMLElement;

      if (gridEl) {
        this.initResize(gridEl);
      }
    }
  }
}
```

10. **Update `setupResize` call in `render()`** — remove `setupResize` entirely, remove the import of `equalWidths` if no longer used in this file.

11. **Update `onChange` callback** — no longer passes `tableWidth`:

```typescript
// Old:
this.resize = new TableResize(gridEl, widths, tableWidth, (newWidths, newTableWidth) => {
  this.data.colWidths = newWidths;
  this.data.tableWidth = newTableWidth;
});

// New:
this.resize = new TableResize(gridEl, widths, (newWidths) => {
  this.data.colWidths = newWidths;
});
```

**Step 2: Run unit tests**

Run: `yarn test`
Expected: PASS

**Step 3: Commit**

```bash
git add src/tools/table/index.ts
git commit -m "feat(table): integrate pixel-based resize, init in rendered() lifecycle"
```

---

### Task 5: Update E2E tests

**Files:**
- Modify: `test/playwright/tests/tools/table.spec.ts`

**Step 1: Update E2E tests for new behavior**

Key changes to the `column resize` describe block:

1. **'dragging resize handle changes column widths'** — verify only the dragged column changed, and the other column stays the same:

```typescript
test('dragging resize handle changes only the dragged column width', async ({ page }) => {
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

  // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first handle
  const handle = page.locator('[data-blok-table-resize]').first();

  await expect(handle).toBeAttached();

  const handleBox = await handle.boundingBox();

  if (!handleBox) {
    throw new Error('Handle not visible');
  }

  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;

  // Get initial second column width
  const initialSecondWidth = await page.evaluate(() => {
    const cells = document.querySelectorAll('[data-blok-table-cell]');

    return (cells[1] as HTMLElement).getBoundingClientRect().width;
  });

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 100, startY, { steps: 5 });
  await page.mouse.up();

  // Second column should be unchanged
  const finalSecondWidth = await page.evaluate(() => {
    const cells = document.querySelectorAll('[data-blok-table-cell]');

    return (cells[1] as HTMLElement).getBoundingClientRect().width;
  });

  expect(Math.abs(finalSecondWidth - initialSecondWidth)).toBeLessThan(2);
});
```

2. **'column widths persist after save'** — use pixel widths:

```typescript
test('column widths persist after save', async ({ page }) => {
  await createBlok(page, {
    tools: defaultTools,
    data: {
      blocks: [
        {
          type: 'table',
          data: {
            withHeadings: false,
            content: [['A', 'B'], ['C', 'D']],
            colWidths: [400, 200],
          },
        },
      ],
    },
  });

  const firstCellWidth = await page.evaluate(() => {
    const cell = document.querySelector('[data-blok-table-cell]') as HTMLElement;

    return cell?.style.width;
  });

  expect(firstCellWidth).toBe('400px');

  const savedData = await page.evaluate(async () => {
    return window.blokInstance?.save();
  });

  const tableBlock = savedData?.blocks.find((b: { type: string }) => b.type === 'table');

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  expect(tableBlock?.data.colWidths).toStrictEqual([400, 200]);
});
```

3. **Add: 'table width changes when column is resized':**

```typescript
test('table width changes when column is resized', async ({ page }) => {
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

  const initialTableWidth = await page.evaluate(() => {
    const table = document.querySelector('[data-blok-tool="table"]');
    const grid = table?.firstElementChild as HTMLElement;

    return grid?.getBoundingClientRect().width;
  });

  // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to get first handle
  const handle = page.locator('[data-blok-table-resize]').first();
  const handleBox = await handle.boundingBox();

  if (!handleBox) {
    throw new Error('Handle not visible');
  }

  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;

  // Drag left to shrink
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 100, startY, { steps: 5 });
  await page.mouse.up();

  const finalTableWidth = await page.evaluate(() => {
    const table = document.querySelector('[data-blok-tool="table"]');
    const grid = table?.firstElementChild as HTMLElement;

    return grid?.getBoundingClientRect().width;
  });

  // Table should be ~100px narrower
  expect(finalTableWidth).toBeLessThan(initialTableWidth - 50);
});
```

**Step 2: Run E2E tests**

Run: `yarn e2e test/playwright/tests/tools/table.spec.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add test/playwright/tests/tools/table.spec.ts
git commit -m "test(table): update E2E tests for pixel-based single-column resize"
```

---

### Task 6: Final verification

**Step 1: Run all unit tests**

Run: `yarn test`
Expected: PASS

**Step 2: Run all E2E tests**

Run: `yarn e2e`
Expected: PASS

**Step 3: Run lint and type check**

Run: `yarn lint`
Expected: PASS

**Step 4: Verify in browser**

Run: `yarn serve`

1. Create a table
2. Drag a column handle left — that column shrinks, table shrinks, other columns unchanged
3. Drag a column handle right — that column grows, table grows, other columns unchanged
4. Drag the last handle — last column resizes, same as any other
5. Try to shrink below 50px — column stops at 50px
6. Try to grow past container width — column stops at container edge
7. Save and reload — widths persist
