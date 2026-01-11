# Smart Grouping Undo/Redo Design

## Problem

The current undo implementation uses a 300ms time-based batching window. When users press undo, too much content is deleted because multiple words typed within 300ms are grouped together.

## Goal

More granular undo groups based on typing pauses at word/punctuation boundaries, giving users finer control over what gets undone.

## Core Rules

### 1. Word/Punctuation Boundaries + Pause = Checkpoint

When the user types a boundary character (space, period, comma, etc.) AND then pauses for ~100ms, create a new undo group.

Examples:
- Typing "Hello world" fast → 1 undo group
- Typing "Hello " [pause 100ms] "world" → 2 undo groups
- Typing "Hello, world" fast → 1 undo group
- Typing "Hello," [pause 100ms] "world" → 2 undo groups

### 2. Boundary Characters

These characters mark potential checkpoint positions:
- Whitespace: space, tab, newline
- Sentence-ending: `.` `?` `!`
- Clause-level: `,` `;` `:`

### 3. Structural Actions = Immediate Boundary

These always create a checkpoint (preserving current behavior):
- Creating a new block (Enter)
- Markdown shortcuts (`# `, `- `, `1. `, etc.)
- Block conversions
- Moving between blocks
- Block deletion

## Implementation Approach

### Current Flow

```
keystroke → Yjs change → 300ms timer → batch into undo group
```

### New Flow

```
keystroke → check if boundary character → if yes, mark "pending boundary"
         → on next keystroke OR after 100ms timeout:
            - if 100ms passed since boundary: call stopCapturing()
            - if keystroke came quickly: clear pending boundary, continue batching
```

### Key Changes to YjsManager

1. Reduce `captureTimeout` to a very small value (e.g., 10ms) or handle grouping entirely manually
2. Add state tracking:
   - `pendingBoundary: boolean` - was last character a boundary?
   - `boundaryTimestamp: number` - when was the boundary typed?
3. On each keystroke in `blockEvents.ts`:
   - Check if 100ms+ elapsed since a pending boundary → `stopCapturing()`
   - Check if current character is a boundary → set pending state
4. Add a 100ms debounced timer that fires `stopCapturing()` if no new keystrokes arrive after a boundary

## Code Changes

### Files to Modify

1. **src/components/modules/yjsManager.ts**
   - Reduce `CAPTURE_TIMEOUT_MS` from 300 to ~10ms (let our logic control grouping)
   - Add `pendingBoundary` and `boundaryTimestamp` state
   - Add `checkBoundaryTimeout()` method called on keystrokes
   - Add debounced timer to call `stopCapturing()` after 100ms idle at boundary

2. **src/components/modules/blockEvents.ts**
   - Hook into `beforeinput` or existing input handling
   - After each character: call `YjsManager.checkBoundaryTimeout()`
   - After typing a boundary character: call `YjsManager.markBoundary()`

### No Changes Needed

- Existing `stopCapturing()` calls for structural actions (already correct)
- Move handling, caret tracking, or other undo/redo infrastructure

## Testing Strategy

### New E2E Tests

1. **Word boundary + pause creates checkpoint**
   - Type "Hello ", wait 150ms, type "world"
   - Undo → "Hello " remains, "world" removed

2. **Fast typing batches together**
   - Type "Hello world" rapidly (no pauses)
   - Undo → entire "Hello world" removed

3. **Punctuation + pause creates checkpoint**
   - Type "Hello,", wait 150ms, type " world"
   - Undo → "Hello," remains

4. **Multiple words batch when typed fast**
   - Type "The quick brown" rapidly
   - Undo → all three words removed together

5. **Structural actions still create boundaries**
   - Existing tests should continue passing

### Unit Tests

1. `markBoundary()` sets pending state correctly
2. `checkBoundaryTimeout()` calls `stopCapturing()` when 100ms elapsed
3. Boundary detection for all character types (space, period, comma, etc.)
