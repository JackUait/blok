# Table Column Resize Design (v2)

## Goal

Each resize handle controls the width of the column to its left. The table width is always the sum of all column widths — there is no separate "table width" concept.

## What Changed From v1

v1 had two modes: "pair resize" (redistribute between adjacent columns) and "right-edge resize" (scale table width, keep column ratios). v2 replaces both with a single unified model.

| Aspect | v1 | v2 |
|--------|----|----|
| Column pair handle | Redistributes between left/right columns | Changes left column only |
| Right-edge handle | Scales table width, keeps ratios | Changes last column (same as others) |
| Table width | Stored separately as percentage | Derived: sum of column widths |
| Column width unit | Percentage of table | Pixels |
| Minimum column width | 10% | 50px |

## Behavior

Every handle sits at the right edge of a column. There are N handles for N columns.

- **Drag left** → left column shrinks → table shrinks
- **Drag right** → left column grows → table grows
- All other columns stay unchanged
- Minimum column width: 50px
- Maximum table width: container width (no overflow)

## Data Model

```typescript
export interface TableData extends BlockToolData {
  withHeadings: boolean;
  stretched?: boolean;
  content: string[][];
  /** Column widths in pixels (e.g., [200, 300, 250]). Omit for equal widths. */
  colWidths?: number[];
}
```

- `tableWidth` field is **removed** — table width is the sum of `colWidths`
- `colWidths` stored in **pixels**, not percentages
- When `colWidths` is omitted, columns get equal widths based on container width divided by column count

## Resize Logic

```
onPointerDown:
  - record dragStartX = e.clientX
  - record startColWidth = colWidths[handleIndex]

onPointerMove:
  - deltaPx = e.clientX - dragStartX
  - newWidth = startColWidth + deltaPx
  - clamp newWidth to [50px, containerWidth - sumOfOtherColumns]
  - colWidths[handleIndex] = newWidth
  - apply widths to cells
  - update grid element width (sum of colWidths)
  - reposition handles

onPointerUp:
  - finalize, call onChange with new colWidths
```

## DOM Changes

Grid element width is set to the sum of column widths in pixels:

```
<div data-blok-table-grid style="width: 750px">  <!-- sum of columns -->
  <div data-blok-table-row>
    <div data-blok-table-cell style="width: 200px">...</div>
    <div data-blok-table-cell style="width: 300px">...</div>
    <div data-blok-table-cell style="width: 250px">...</div>
  </div>
</div>
```

Handle positions are absolute pixel offsets (cumulative column widths).

## Integration Changes

### TableResize class

- Remove `tableWidth` parameter and `isRightEdgeDrag` logic
- Remove `clampPair` function
- Single drag mode: each handle changes one column width
- Constructor: `new TableResize(gridEl, colWidths, onChange)`
- `onChange` signature: `(widths: number[]) => void`

### Table class (index.ts)

- Remove `tableWidth` from data flow
- `setupResize`: pass pixel widths, no table width
- `save()`: store `colWidths` in pixels, no `tableWidth`
- Initial widths: compute from container width on first render

### Types (types.ts)

- Remove `tableWidth` field from `TableData`
- Update `colWidths` doc comment to say pixels

## Files

| File | Change |
|------|--------|
| `src/tools/table/table-resize.ts` | Rewrite — single-column resize, pixel widths |
| `src/tools/table/types.ts` | Remove `tableWidth`, update `colWidths` docs |
| `src/tools/table/index.ts` | Remove `tableWidth` handling, pixel-based widths |
| `test/unit/tools/table/table-resize.test.ts` | Rewrite for new behavior |
| `test/playwright/tests/tools/table.spec.ts` | Update E2E for new behavior |
