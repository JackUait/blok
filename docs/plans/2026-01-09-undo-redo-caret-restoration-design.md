# Undo/Redo Caret Restoration

## Problem

When users perform undo/redo actions, the caret position is not tracked or restored. After an undo or redo, users lose context about where their focus should be, leading to confusion and poor UX.

## Solution

Track caret position before and after every undoable action. On undo, restore the "before" position. On redo, restore the "after" position.

## Design

### Data Structures

```typescript
/**
 * Represents caret position at a point in time
 */
interface CaretSnapshot {
  blockId: string;
  inputIndex: number;  // 0 for most tools, >0 for multi-input tools like List
  offset: number;      // Character offset within the input
}

/**
 * Caret state before and after an undoable action
 */
interface CaretHistoryEntry {
  before: CaretSnapshot | null;  // null if no block was focused
  after: CaretSnapshot | null;   // null if action removed the focused block
}
```

### Architecture

Maintain a separate caret stack parallel to the existing undo mechanisms:

- `caretUndoStack: CaretHistoryEntry[]`
- `caretRedoStack: CaretHistoryEntry[]`

This approach mirrors the existing `moveUndoStack`/`moveRedoStack` pattern and works alongside both:
- Yjs UndoManager (text edits, block add/remove)
- Custom move stacks (block reordering)

### Capture Flow

#### Pending State Pattern

Since Yjs UndoManager's `stack-item-added` event fires after the change, we track a "pending" caret state:

```typescript
private pendingCaretBefore: CaretSnapshot | null = null;
private hasPendingCaret = false;

public markCaretBeforeChange(): void {
  if (!this.hasPendingCaret) {
    this.pendingCaretBefore = this.captureCaretSnapshot();
    this.hasPendingCaret = true;
  }
}
```

#### Yjs Event Hook

```typescript
this.undoManager.on('stack-item-added', (event) => {
  if (event.type === 'undo') {
    this.caretUndoStack.push({
      before: this.pendingCaretBefore,
      after: this.captureCaretSnapshot(),
    });
    this.caretRedoStack = [];
  }
  this.hasPendingCaret = false;
  this.pendingCaretBefore = null;
});
```

#### Capture Points

Call `markCaretBeforeChange()` before:
- `updateBlockData()` - text changes
- `addBlock()` - block insertion
- `removeBlock()` - block deletion
- `moveBlock()` - block reordering (for move stack integration)

### Restore Flow

#### On Undo

```typescript
public undo(): void {
  const caretEntry = this.caretUndoStack.pop();

  // ... existing move/Yjs undo logic ...

  if (caretEntry) {
    this.caretRedoStack.push(caretEntry);
    this.restoreCaretSnapshot(caretEntry.before);
  }
}
```

#### On Redo

```typescript
public redo(): void {
  const caretEntry = this.caretRedoStack.pop();

  // ... existing move/Yjs redo logic ...

  if (caretEntry) {
    this.caretUndoStack.push(caretEntry);
    this.restoreCaretSnapshot(caretEntry.after);
  }
}
```

#### Restore Implementation

```typescript
private restoreCaretSnapshot(snapshot: CaretSnapshot | null): void {
  if (snapshot === null) {
    window.getSelection()?.removeAllRanges();
    return;
  }

  const { BlockManager, Caret } = this.Blok;
  const block = BlockManager.getBlockById(snapshot.blockId);

  if (block === undefined) {
    const firstBlock = BlockManager.firstBlock;
    if (firstBlock) {
      Caret.setToBlock(firstBlock, Caret.positions.START);
    }
    return;
  }

  const input = block.inputs[snapshot.inputIndex];

  if (input) {
    Caret.setToInput(input, Caret.positions.DEFAULT, snapshot.offset);
  } else {
    Caret.setToBlock(block, Caret.positions.START);
  }
}
```

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Block was deleted | Focus first block at start |
| Input index invalid | Focus block at start |
| Offset beyond content | Clamped by existing `getNodeByOffset` |
| No block was focused | Clear selection |

## Files to Modify

### `src/components/modules/yjsManager.ts`
- Add `CaretSnapshot` and `CaretHistoryEntry` interfaces
- Add stack properties: `caretUndoStack`, `caretRedoStack`
- Add pending state: `pendingCaretBefore`, `hasPendingCaret`
- Add methods: `captureCaretSnapshot()`, `markCaretBeforeChange()`, `restoreCaretSnapshot()`
- Hook into `undoManager.on('stack-item-added', ...)`
- Modify `undo()` and `redo()` to restore caret

### `src/components/block/index.ts`
- Expose `currentInputIndex` getter if not already available

### `src/components/modules/caret.ts`
- Add `getCurrentOffset(): number` utility method

## Testing

Add E2E tests for:
- Text undo restores caret to pre-edit position
- Text redo restores caret to post-edit position
- Block add undo restores caret to previous position
- Block remove undo focuses restored block
- Block move undo restores caret to original block position
- Multiple undo/redo cycles maintain correct caret positions
