# Eliminate `this.data` from Table Tool

## Problem

The table tool maintains three representations of state: DOM, `this.data` (a plain `TableData` object), and `this.model` (a `TableModel` instance). After every mutation, `this.data` fields must be manually synced to the model via paired write-then-sync patterns:

```typescript
this.data.colWidths = newWidths;        // write to data
this.model.setColWidths(newWidths);     // sync to model
```

There are 13 write sites in `index.ts`, each followed by a model setter call. If any sync is missed, `this.data` drifts from the model. This already happened with column resize (fixed in `2a8328d5`).

Additionally, `this.data.content` is never synced after structural operations (add/delete row/col). It becomes progressively stale during a session. No data loss occurs because `save()` returns `this.model.snapshot()`, but any code that reads `this.data.content` for grid dimensions would get wrong answers.

## Solution

Eliminate `this.data` entirely. All reads go through `TableModel` getters, all writes go through `TableModel` setters. Content data needed during initialization lives in a temporary field that's nulled after `rendered()`.

## Design

### 1. Add public getters to TableModel

The model already has private backing fields and public setters. Add matching getters:

```typescript
get withHeadings(): boolean { return this.withHeadingsValue; }
get withHeadingColumn(): boolean { return this.withHeadingColumnValue; }
get stretched(): boolean { return this.stretchedValue; }
get colWidths(): number[] | undefined { return this.colWidthsValue ? [...this.colWidthsValue] : undefined; }
get initialColWidth(): number | undefined { return this.initialColWidthValue; }
```

`colWidths` returns a copy to prevent external mutation of the model's internal array.

### 2. Replace `this.data` reads with model getters

All ~68 `this.data.fieldName` reads in `index.ts` become `this.model.fieldName`:

- `this.data.withHeadings` → `this.model.withHeadings`
- `this.data.colWidths` → `this.model.colWidths`
- `this.data.withHeadingColumn` → `this.model.withHeadingColumn`
- `this.data.stretched` → `this.model.stretched`
- `this.data.initialColWidth` → `this.model.initialColWidth`

### 3. Eliminate dual-mutation patterns

Every paired write becomes a single model setter call:

```typescript
// Before (13 sites)
this.data.colWidths = newWidths;
this.model.setColWidths(newWidths);

// After
this.model.setColWidths(newWidths);
```

### 4. Content lifecycle via `initialContent`

Content data is only needed during initialization. After `rendered()` completes, the model owns content exclusively.

- Add `private initialContent: LegacyCellContent[][] | null` field
- Constructor normalizes data and stores content:
  ```typescript
  const normalized = normalizeTableData(data, config);
  this.initialContent = normalized.content;
  this.model = new TableModel(normalized);
  ```
- `render()` reads `this.initialContent` for grid dimensions and fill
- `rendered()` uses `this.initialContent` for cell initialization, then:
  ```typescript
  this.initialContent = null; // model owns content now
  ```
- `setData()` and `onPaste()` set `this.initialContent` with new content before re-render

### 5. Narrow ActionContext.data type

`executeRowColAction()` currently receives `data: TableData`. It only reads four fields: `colWidths`, `withHeadings`, `withHeadingColumn`, `initialColWidth`.

Narrow the type and build the object from model getters at the call site:

```typescript
interface ActionData {
  colWidths: number[] | undefined;
  withHeadings: boolean;
  withHeadingColumn: boolean;
  initialColWidth: number | undefined;
}
```

### 6. Delete `this.data`

After all reads and writes are migrated, remove the `this.data` field entirely.

## What does NOT change

- `save()` — already returns `this.model.snapshot()`
- External function signatures — they still take primitives
- `TableModel` internals — only adding getters
- DOM manipulation code
- Test behavior — model was already the source of truth

## Risk

Low. Mechanical refactor — every `this.data` read maps to a model getter, every write maps to a model setter that's already being called.

## Testing

Existing tests pass unchanged. No new tests needed since no behavior changes. Run full unit suite and E2E table tests to confirm.
