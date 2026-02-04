# Table: Compact New Columns & Reduced Vertical Padding

## Summary

Two changes to the table tool:

1. **New columns are half-width**: When adding a column, the new column's width is half the average of existing columns (instead of the full average).
2. **Reduced vertical padding on all cells**: All cells use `py-1 px-2` instead of `p-2` (half vertical padding, same horizontal).

## Changes

### File: `src/tools/table/table-core.ts`

#### 1. Cell padding (line 13)

Change `CELL_CLASSES`:

```diff
 const CELL_CLASSES = [
-  'p-2',
+  'py-1',
+  'px-2',
   'min-h-[2em]',
   'outline-none',
   'leading-normal',
 ];
```

#### 2. New column width — px mode (line 198-199)

In `addColumnPx()`, halve the new column width:

```diff
     const newColWidth = oldColCount > 0
-      ? Math.round((totalWidth / oldColCount) * 100) / 100
+      ? Math.round((totalWidth / oldColCount / 2) * 100) / 100
       : 0;
```

#### 3. New column width — percent mode (line 235)

In `addColumnPercent()`, halve the new column width and adjust the scale factor so existing columns only give up half as much space:

```diff
-    const newColCount = oldColCount + 1;
-    const scaleFactor = (newColCount - 1) / newColCount;
+    const halfColFraction = 0.5 / oldColCount;
+    const scaleFactor = 1 - halfColFraction;
```

And the new column width:

```diff
-      const newColWidth = Math.round((100 / newColCount) * 100) / 100;
+      const newColWidth = Math.round((100 / oldColCount / 2) * 100) / 100;
```

This gives the new column half the average percentage width. Existing columns shrink proportionally to make room, but only give up half as much space as before.

## Testing

### Unit tests (TDD — write first, watch fail, then implement)

1. **Cell padding**: Verify cells have `py-1` and `px-2` classes (not `p-2`)
2. **addColumnPx half-width**: Create a 3-col table with known px widths, add column, verify new column is half the average
3. **addColumnPercent half-width**: Create a 3-col table in % mode, add column, verify new column is half the average percentage

### E2E tests

Existing add-column E2E tests should still pass (they test that a column is added, not the exact width).
