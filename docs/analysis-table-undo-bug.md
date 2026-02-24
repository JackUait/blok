# Table Undo Bug — Root Cause Analysis

When a user types in a newly created table and presses Ctrl+Z, the table data disappears and the table becomes non-interactive.

---

## Architecture Context

### How Tables Work

The table tool (`src/tools/table/index.ts`) is a **container of nested Blok blocks**. Each cell holds one or more paragraph/header blocks inside a `[data-blok-table-cell-blocks]` container. The table itself doesn't use `contentEditable` — typing goes into the paragraph tool instances inside cells.

**Key components:**

| Component | File | Role |
|-----------|------|------|
| `Table` | `src/tools/table/index.ts` | Main tool class, lifecycle, `render()`, `save()`, `setData()` |
| `TableModel` | `src/tools/table/table-model.ts` | Pure data model — 2D grid of `{blocks: string[]}` cell references |
| `TableCellBlocks` | `src/tools/table/table-cell-blocks.ts` | Manages nested blocks inside cells, block-changed handler |

### How Undo Works

The history system is **Yjs-based** (no standalone history module). Key components:

| Component | File | Role |
|-----------|------|------|
| `UndoHistory` | `src/components/modules/yjs/undo-history.ts` | Core undo/redo, caret tracking, smart grouping |
| `DocumentStore` | `src/components/modules/yjs/document-store.ts` | Owns `Y.Doc`, block CRUD, `updateBlockData()` |
| `BlockObserver` | `src/components/modules/yjs/block-observer.ts` | Observes Yjs events, emits domain events |
| `BlockYjsSync` | `src/components/modules/blockManager/yjs-sync.ts` | DOM ↔ Yjs sync during undo/redo |

Yjs `UndoManager` captures incremental diffs with a `captureTimeout` of **500ms** — changes within that window are grouped into one undo entry. `stopCapturing()` forces an explicit boundary.

---

## Confirmed Bugs

### Bug 1: `===` Reference Equality on Arrays

**Location:** `src/components/modules/yjs/document-store.ts` line 163

```typescript
const currentValue = ydata.get(key);
if (currentValue === value) {
  return; // Skip if unchanged
}
```

`TableModel.snapshot()` (`src/tools/table/table-model.ts` line 73) always creates **new array references**:

```typescript
content: this.contentGrid.map(row =>
  row.map(c => ({ blocks: [...c.blocks] }))
),
```

The `===` check works for primitives (strings, booleans) but **always fails for the table's `content` key** because `snapshot()` produces fresh arrays every time. Every `syncBlockDataToYjs(tableBlock)` writes identical content to Yjs as a "change," creating spurious undo entries.

### Bug 2: MutationObserver Attributes Child Mutations to Table Block

**Location:** `src/components/modules/modificationsObserver.ts` line 143

The centralized `MutationObserver` observes the whole editor with `subtree: true`. The containment check:

```typescript
if (element.contains(target)) { return true; }
```

Since paragraph holders are DOM children of the table's element, **every keystroke in a table cell** triggers `blockDidMutated` for the table block, which calls `syncBlockDataToYjs(tableBlock)`. Combined with Bug 1, this writes the (identical) content array to Yjs on every keystroke, and due to `captureTimeout`, it gets **grouped into the same Yjs undo entry as the user's typing**.

### Bug 3: `setData()` Doesn't Repopulate Empty Cells

**Location:** `src/tools/table/index.ts` lines 347–426

When undo reverts the table's content from `[[{blocks:['p1']},...]]` back to `[]`, `Table.setData()` rebuilds the grid but `initializeCells([])` iterates over an empty array — mounting **zero blocks**. Unlike `rendered()`, `setData()` never calls `populateNewCells()`. The table becomes a bare grid with no `contentEditable` elements — **non-interactive**.

### Bug 4: Initial Cell Population Not Transaction-Wrapped

**Location:** `src/tools/table/index.ts` line 293

`rendered()` uses `runStructuralOp` (event deferral only), **not** `runTransactedStructuralOp` (which wraps in a Yjs transaction and suppresses `stopCapturing`). Each of the 9 paragraph insertions calls `stopCapturing()` via the `currentBlockIndexValue` setter in `operations.ts`. The MutationObserver then writes the table's content transition (`[] → populated`) as a separate Yjs change that becomes groupable with subsequent typing.

---

## Disproven Claims

These were initially hypothesized but verified to be **false**:

| Claimed Bug | Verdict | Evidence |
|---|---|---|
| 500ms capture timeout groups table creation + first typing | **FALSE** | `stopCapturing()` is called on each `insert()` via `currentBlockIndexValue` setter in `operations.ts`, creating explicit boundaries between every paragraph insertion |
| Parent sync fires on every child text mutation | **FALSE** | `scheduleParentSync` is only triggered by `setBlockParent()` (hierarchy changes: child added/removed). Typing in a child block only calls `syncBlockDataToYjs(childBlock)`, not the parent. The parent sync during typing comes from the MutationObserver containment check (Bug 2), not the hierarchy system |
| `yjsSyncCount` microtask timing hole allows post-undo sync-back | **FALSE** | MutationObserver callbacks are microtasks queued at DOM mutation time (during `Table.setData()` synchronous execution). The `.finally()` decrement runs **after** MO callbacks because it requires multiple chained promise resolutions. `yjsSyncCount` is always >0 when MO fires |
| Re-entrant `setData` via `setDataGeneration` bail-out causes partial rebuild | **FALSE** | Yjs fires one event per block per transaction. `Table.setData()` is synchronous. Re-entrancy cannot occur. The generation guards are defensive code for an impossible scenario |
| Destructive `setData` rebuild makes table non-interactive via bail-out | **FALSE** | While `setData()` does always do a full rebuild (no unchanged-data fast path), the non-interactivity comes from Bug 3 (empty content), not from re-entrant bail-out |

---

## The Kill Chain

Here is the exact sequence of events that produces the bug:

### Step 1: Table Created

User inserts a table via the toolbox.

- `api.blocks.insert('table')` → Yjs entry **A** (table block added with `data: {}` including `content: []`)
- `stopCapturing()` called → entry A finalized

### Step 2: `rendered()` Populates Cells

After ~16ms (`requestAnimationFrame`), `rendered()` fires:

- `populateNewCells()` → `ensureCellHasBlock()` × 9 → 9 `api.blocks.insert('paragraph')` calls
- Each insertion creates its own Yjs entry (B through J) because `stopCapturing()` fires on each
- After all insertions, the MutationObserver fires for the table block
- `syncBlockDataToYjs(table)` writes `content: [] → [[{blocks:['p1']},{blocks:['p2']},...]]` — a **real content change**
- This starts a new capture group (entry K)

### Step 3: User Types

User types "Hello" in the first cell paragraph:

- Paragraph `p1` mutation detected → `syncBlockDataToYjs(p1)` → text `'' → 'Hello'`
- **Simultaneously**, the MutationObserver attributes the DOM mutation to the table block (Bug 2)
- `syncBlockDataToYjs(table)` writes identical content with new array references → bypasses `===` guard (Bug 1)
- Both the text change and the spurious content "change" fall within `captureTimeout` → **grouped into the same Yjs undo entry as K**

### Step 4: Ctrl+Z

Yjs undoes entry K, which contains:

- Revert paragraph text: `'Hello' → ''`
- Revert table content: `[[{blocks:['p1']},...]] → []`

`handleYjsUpdate` fires for both blocks:

- **Paragraph:** `block.setData({text: ''})` → innerHTML updated (harmless)
- **Table:** `block.setData({content: []})` → `Table.setData()` runs

### Step 5: Table Destroyed

`Table.setData({content: []})`:

1. `cellBlocks.destroy()` → old event listener removed
2. `teardownSubsystems()` → resize, add-controls, row/col controls, cell selection all destroyed
3. `render()` → creates new 3×3 grid (fallback dimensions since content is empty)
4. `replaceChild(newElement, oldElement)` → new empty grid in DOM
5. `initializeCells([])` → iterates over `[]` → **mounts zero blocks** (Bug 3)
6. `initSubsystems()` → subsystems re-created on the empty grid

**Result:** The table is a bare 3×3 grid of empty `<div>` elements with no `contentEditable` children. The 9 paragraph blocks remain in BlockManager with detached DOM holders. The table is **non-interactive**.

### Step 6: Recovery Impossible

After `yjsSyncCount` reaches 0, the MutationObserver fires for the DOM rebuild. `syncBlockDataToYjs(table)` writes the new empty content to Yjs with origin `'local'`, which **clears the Yjs redo stack**. Ctrl+Shift+Z cannot restore the table.

---

## Fix Strategies

### Fix A: Deep Equality in `updateBlockData` (Highest Impact)

**File:** `src/components/modules/yjs/document-store.ts`

Replace the `===` check with deep equality for non-primitive values. This eliminates spurious table content writes to Yjs entirely, so typing in a cell never creates a table content undo entry. Breaks the chain at Step 3.

### Fix B: Wrap Cell Population in Yjs Transaction

**File:** `src/tools/table/index.ts` (`rendered()` method)

Use `runTransactedStructuralOp` instead of `runStructuralOp` for the initial cell population. This groups the `content: [] → populated` transition atomically with the table creation, preventing it from being undone separately.

### Fix C: `setData()` Should Populate Empty Cells (Defense in Depth)

**File:** `src/tools/table/index.ts` (`setData()` method)

When `isSyncingFromYjs` is true and reverted content is empty but the grid has cells, call `populateNewCells()` (or equivalent) to ensure every cell has at least one block. This makes the table recoverable even if content somehow reverts to `[]`.

### Fix D: Prevent Post-Undo Sync-Back

**File:** `src/components/modules/blockManager/yjs-sync.ts` (`handleYjsUpdate`)

Use `withAtomicOperation({ extendThroughRAF: true })` (like `handleYjsAdd` already does) so `yjsSyncCount` stays elevated through any deferred DOM callbacks, preventing the post-undo 'local' write that clears the redo stack.

### Priority

**Fix A alone** would prevent the bug from triggering in most cases. **Fixes B + C** provide defense in depth. **Fix D** protects the redo stack.
