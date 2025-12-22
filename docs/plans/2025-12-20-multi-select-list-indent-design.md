# Multi-Select List Item Indent/Outdent

## Overview

When the user selects multiple list items and presses Tab or Shift+Tab, all selected items should indent or outdent together as a single operation.

## Requirements

- **List items only**: Only works when all selected blocks are list items
- **All-or-nothing validation**: If any selected item can't move, the entire operation is skipped
- **Single undo step**: All changes revert together with one Cmd+Z
- **Preserve selection**: All items remain selected after the operation

## Behavior Matrix

| Scenario | Tab | Shift+Tab |
|----------|-----|-----------|
| All selected are list items, all can move | Indent all by 1 | Outdent all by 1 |
| All selected are list items, some can't move | Do nothing | Do nothing |
| Mixed selection (any non-list block) | Do nothing | Do nothing |
| No blocks selected | Existing behavior (navigate) | Existing behavior (navigate) |

## Event Handling Flow

The Tab key flows through `BlockEvents.keydown()`. We intercept when blocks are selected:

1. Check if Tab/Shift+Tab pressed
2. Check if `BlockSelection.anyBlockSelected` is true
3. If so, call `handleSelectedBlocksIndent(event)`
4. If handler returns true (handled), return early
5. Otherwise, fall through to existing `tabPressed()` logic

This keeps single-item Tab behavior (handled by ListItem's own keydown) intact.

## Validation Logic

### All List Items Check

Iterate `BlockSelection.selectedBlocks` — if any block's `name !== 'list'`, return false.

### Can Indent Check (Tab)

For each selected block in document order:
- Get previous block (by index - 1)
- Previous block must be a list item
- Current depth must be <= previous block's depth

### Can Outdent Check (Shift+Tab)

For each selected block:
- Current depth must be > 0

### All-or-Nothing

If any block fails validation, abort the entire operation.

## Execution

1. Wrap operation for single undo step
2. For each selected block (in document order):
   - Get current depth from block data
   - Calculate new depth: `depth + 1` (indent) or `depth - 1` (outdent)
   - Call `api.blocks.update(blockId, { ...currentData, depth: newDepth })`
3. Verify selection is preserved on all affected blocks

## Implementation

### File Changes

| File | Changes |
|------|---------|
| `src/components/modules/blockEvents.ts` | Add multi-select indent handling |

### Methods to Add in BlockEvents

```typescript
/**
 * Handles Tab/Shift+Tab for multi-selected list items.
 * Returns true if handled, false to fall through to default behavior.
 */
private handleSelectedBlocksIndent(event: KeyboardEvent): boolean

/**
 * Check if all selected blocks are list items.
 */
private areAllSelectedBlocksListItems(): boolean

/**
 * Check if all selected list items can be indented.
 */
private canIndentSelectedListItems(): boolean

/**
 * Check if all selected list items can be outdented.
 */
private canOutdentSelectedListItems(): boolean

/**
 * Indent all selected list items by one level.
 */
private indentSelectedListItems(): void

/**
 * Outdent all selected list items by one level.
 */
private outdentSelectedListItems(): void
```

## Out of Scope

- Converting non-list blocks to list items on Tab
- Partial indent (some items move, others don't)
- Multi-step undo (each item as separate undo)
