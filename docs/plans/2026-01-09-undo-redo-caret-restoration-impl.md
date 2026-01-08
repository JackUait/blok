# Undo/Redo Caret Restoration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Track and restore caret position during undo/redo operations so users maintain context.

**Architecture:** Parallel caret stack alongside existing Yjs UndoManager and move stacks. Capture caret before/after every undoable action; restore on undo (before) and redo (after).

**Tech Stack:** TypeScript, Yjs UndoManager events, DOM Selection API

**Design Doc:** [2026-01-09-undo-redo-caret-restoration-design.md](./2026-01-09-undo-redo-caret-restoration-design.md)

---

## Task 1: Add `currentInputIndex` Getter to Block

**Files:**
- Modify: `src/components/block/index.ts:243` (near `inputIndex` property)
- Test: `test/unit/components/block/block.test.ts`

**Step 1: Write the failing test**

Add to the existing block test file:

```typescript
describe('currentInputIndex', () => {
  it('returns the current input index', () => {
    // Create a block with multiple inputs (e.g., a list)
    const block = createBlockWithInputs(3);

    // Default should be 0
    expect(block.currentInputIndex).toBe(0);

    // Set current input to second element
    block.currentInput = block.inputs[1];
    expect(block.currentInputIndex).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/block/block.test.ts -t "currentInputIndex"`
Expected: FAIL - Property 'currentInputIndex' does not exist

**Step 3: Write minimal implementation**

In `src/components/block/index.ts`, after line 243 (`private inputIndex = 0;`), add:

```typescript
/**
 * Returns the current input index (for caret restoration)
 */
public get currentInputIndex(): number {
  return this.inputIndex;
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/block/block.test.ts -t "currentInputIndex"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/block/index.ts test/unit/components/block/block.test.ts
git commit -m "feat(block): expose currentInputIndex getter for caret restoration"
```

---

## Task 2: Add `getCaretOffset` Utility Function

**Files:**
- Modify: `src/components/utils/caret.ts`
- Test: `test/unit/components/utils/caret.test.ts`

**Step 1: Write the failing test**

Create or add to caret utility tests:

```typescript
describe('getCaretOffset', () => {
  it('returns 0 when no selection exists', () => {
    window.getSelection()?.removeAllRanges();
    expect(getCaretOffset()).toBe(0);
  });

  it('returns character offset within contenteditable', () => {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    div.innerHTML = 'Hello World';
    document.body.appendChild(div);

    // Set caret after "Hello"
    const range = document.createRange();
    const textNode = div.firstChild!;
    range.setStart(textNode, 5);
    range.collapse(true);

    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(getCaretOffset(div)).toBe(5);

    document.body.removeChild(div);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/utils/caret.test.ts -t "getCaretOffset"`
Expected: FAIL - getCaretOffset is not exported

**Step 3: Write minimal implementation**

In `src/components/utils/caret.ts`, add:

```typescript
/**
 * Get the current caret offset within a contenteditable element.
 * Returns the number of text characters from the start of the element to the caret.
 * @param input - Optional input element. If not provided, uses the current selection's container.
 * @returns Offset in text characters, or 0 if no selection
 */
export const getCaretOffset = (input?: HTMLElement): number => {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return 0;
  }

  const range = selection.getRangeAt(0);

  // If no input provided, try to find the contenteditable ancestor
  const container = input ?? range.startContainer.parentElement?.closest('[contenteditable="true"]');

  if (!container) {
    return 0;
  }

  // Create a range from start of input to current caret position
  const preCaretRange = document.createRange();
  preCaretRange.selectNodeContents(container);
  preCaretRange.setEnd(range.startContainer, range.startOffset);

  // Get the text length up to the caret
  return preCaretRange.toString().length;
};
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/utils/caret.test.ts -t "getCaretOffset"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/utils/caret.ts test/unit/components/utils/caret.test.ts
git commit -m "feat(caret): add getCaretOffset utility for caret position tracking"
```

---

## Task 3: Add Caret Stack Types and Properties to YjsManager

**Files:**
- Modify: `src/components/modules/yjsManager.ts:8-32` (interfaces section)
- Modify: `src/components/modules/yjsManager.ts:68-79` (properties section)

**Step 1: Add the type definitions**

In `src/components/modules/yjsManager.ts`, after the `BlockChangeCallback` type (line 14), add:

```typescript
/**
 * Represents caret position at a point in time
 */
export interface CaretSnapshot {
  blockId: string;
  inputIndex: number;
  offset: number;
}

/**
 * Caret state before and after an undoable action
 */
interface CaretHistoryEntry {
  before: CaretSnapshot | null;
  after: CaretSnapshot | null;
}
```

**Step 2: Add the stack properties**

After `pendingMoveGroup` (line 79), add:

```typescript
/**
 * Caret position history stack for undo.
 * Tracks caret position before/after each undoable action.
 */
private caretUndoStack: CaretHistoryEntry[] = [];

/**
 * Caret position history stack for redo.
 */
private caretRedoStack: CaretHistoryEntry[] = [];

/**
 * Pending caret snapshot captured before a change starts.
 * Used because Yjs 'stack-item-added' fires after the change.
 */
private pendingCaretBefore: CaretSnapshot | null = null;

/**
 * Flag indicating we have a pending caret snapshot.
 */
private hasPendingCaret = false;
```

**Step 3: Run type check**

Run: `yarn lint:types`
Expected: PASS (no errors)

**Step 4: Commit**

```bash
git add src/components/modules/yjsManager.ts
git commit -m "feat(yjsManager): add caret stack types and properties"
```

---

## Task 4: Implement `captureCaretSnapshot` Method

**Files:**
- Modify: `src/components/modules/yjsManager.ts`
- Test: `test/unit/components/modules/yjsManager.test.ts`

**Step 1: Write the failing test**

```typescript
describe('captureCaretSnapshot', () => {
  it('returns null when no block is focused', () => {
    const yjsManager = createYjsManager();
    // Mock BlockManager.currentBlock to return undefined
    vi.spyOn(yjsManager['Blok'].BlockManager, 'currentBlock', 'get').mockReturnValue(undefined);

    expect(yjsManager.captureCaretSnapshot()).toBeNull();
  });

  it('captures block id, input index, and offset', () => {
    const yjsManager = createYjsManager();
    const mockBlock = {
      id: 'block-123',
      currentInputIndex: 1,
      currentInput: document.createElement('div'),
    };
    vi.spyOn(yjsManager['Blok'].BlockManager, 'currentBlock', 'get').mockReturnValue(mockBlock);
    // Mock getCaretOffset to return 5
    vi.mock('../../utils/caret', () => ({ getCaretOffset: () => 5 }));

    const snapshot = yjsManager.captureCaretSnapshot();

    expect(snapshot).toEqual({
      blockId: 'block-123',
      inputIndex: 1,
      offset: 5,
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "captureCaretSnapshot"`
Expected: FAIL - captureCaretSnapshot is not a function

**Step 3: Write minimal implementation**

In `src/components/modules/yjsManager.ts`, add import at top:

```typescript
import { getCaretOffset } from '../utils/caret';
```

Add method (after `clearMoveHistory`):

```typescript
/**
 * Capture the current caret position as a snapshot.
 * @returns CaretSnapshot or null if no block is focused
 */
public captureCaretSnapshot(): CaretSnapshot | null {
  const { BlockManager } = this.Blok;
  const currentBlock = BlockManager.currentBlock;

  if (currentBlock === undefined) {
    return null;
  }

  const currentInput = currentBlock.currentInput;

  return {
    blockId: currentBlock.id,
    inputIndex: currentBlock.currentInputIndex,
    offset: currentInput ? getCaretOffset(currentInput) : 0,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "captureCaretSnapshot"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/modules/yjsManager.ts test/unit/components/modules/yjsManager.test.ts
git commit -m "feat(yjsManager): implement captureCaretSnapshot method"
```

---

## Task 5: Implement `markCaretBeforeChange` Method

**Files:**
- Modify: `src/components/modules/yjsManager.ts`
- Test: `test/unit/components/modules/yjsManager.test.ts`

**Step 1: Write the failing test**

```typescript
describe('markCaretBeforeChange', () => {
  it('captures caret snapshot on first call', () => {
    const yjsManager = createYjsManager();
    const mockSnapshot = { blockId: 'b1', inputIndex: 0, offset: 3 };
    vi.spyOn(yjsManager, 'captureCaretSnapshot').mockReturnValue(mockSnapshot);

    yjsManager.markCaretBeforeChange();

    expect(yjsManager['pendingCaretBefore']).toEqual(mockSnapshot);
    expect(yjsManager['hasPendingCaret']).toBe(true);
  });

  it('does not overwrite on subsequent calls', () => {
    const yjsManager = createYjsManager();
    const firstSnapshot = { blockId: 'b1', inputIndex: 0, offset: 3 };
    const secondSnapshot = { blockId: 'b2', inputIndex: 1, offset: 10 };

    vi.spyOn(yjsManager, 'captureCaretSnapshot')
      .mockReturnValueOnce(firstSnapshot)
      .mockReturnValueOnce(secondSnapshot);

    yjsManager.markCaretBeforeChange();
    yjsManager.markCaretBeforeChange();

    // Should still have first snapshot
    expect(yjsManager['pendingCaretBefore']).toEqual(firstSnapshot);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "markCaretBeforeChange"`
Expected: FAIL - markCaretBeforeChange is not a function

**Step 3: Write minimal implementation**

In `src/components/modules/yjsManager.ts`, add method:

```typescript
/**
 * Mark the caret position before a change starts.
 * Call this before any operation that might be undoable.
 * Only captures on first call; subsequent calls are ignored until reset.
 */
public markCaretBeforeChange(): void {
  if (this.hasPendingCaret) {
    return;
  }

  this.pendingCaretBefore = this.captureCaretSnapshot();
  this.hasPendingCaret = true;
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "markCaretBeforeChange"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/modules/yjsManager.ts test/unit/components/modules/yjsManager.test.ts
git commit -m "feat(yjsManager): implement markCaretBeforeChange method"
```

---

## Task 6: Implement `restoreCaretSnapshot` Method

**Files:**
- Modify: `src/components/modules/yjsManager.ts`
- Test: `test/unit/components/modules/yjsManager.test.ts`

**Step 1: Write the failing test**

```typescript
describe('restoreCaretSnapshot', () => {
  it('clears selection when snapshot is null', () => {
    const yjsManager = createYjsManager();
    const removeAllRangesSpy = vi.fn();
    vi.spyOn(window, 'getSelection').mockReturnValue({
      removeAllRanges: removeAllRangesSpy,
    } as unknown as Selection);

    yjsManager['restoreCaretSnapshot'](null);

    expect(removeAllRangesSpy).toHaveBeenCalled();
  });

  it('falls back to first block when block not found', () => {
    const yjsManager = createYjsManager();
    const firstBlock = { id: 'first', focusable: true };
    vi.spyOn(yjsManager['Blok'].BlockManager, 'getBlockById').mockReturnValue(undefined);
    vi.spyOn(yjsManager['Blok'].BlockManager, 'firstBlock', 'get').mockReturnValue(firstBlock);
    const setToBlockSpy = vi.spyOn(yjsManager['Blok'].Caret, 'setToBlock');

    yjsManager['restoreCaretSnapshot']({ blockId: 'deleted', inputIndex: 0, offset: 0 });

    expect(setToBlockSpy).toHaveBeenCalledWith(firstBlock, 'start');
  });

  it('restores caret to specific input and offset', () => {
    const yjsManager = createYjsManager();
    const input = document.createElement('div');
    const block = { id: 'b1', inputs: [input], focusable: true };
    vi.spyOn(yjsManager['Blok'].BlockManager, 'getBlockById').mockReturnValue(block);
    const setToInputSpy = vi.spyOn(yjsManager['Blok'].Caret, 'setToInput');

    yjsManager['restoreCaretSnapshot']({ blockId: 'b1', inputIndex: 0, offset: 5 });

    expect(setToInputSpy).toHaveBeenCalledWith(input, 'default', 5);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "restoreCaretSnapshot"`
Expected: FAIL - restoreCaretSnapshot is not a function

**Step 3: Write minimal implementation**

In `src/components/modules/yjsManager.ts`, add method:

```typescript
/**
 * Restore caret position from a snapshot.
 * Handles edge cases: null snapshot, deleted block, invalid input index.
 * @param snapshot - CaretSnapshot to restore, or null to clear selection
 */
private restoreCaretSnapshot(snapshot: CaretSnapshot | null): void {
  if (snapshot === null) {
    window.getSelection()?.removeAllRanges();
    return;
  }

  const { BlockManager, Caret } = this.Blok;
  const block = BlockManager.getBlockById(snapshot.blockId);

  if (block === undefined) {
    // Block no longer exists - focus first block
    const firstBlock = BlockManager.firstBlock;
    if (firstBlock) {
      Caret.setToBlock(firstBlock, Caret.positions.START);
    }
    return;
  }

  // Get the specific input within the block
  const input = block.inputs[snapshot.inputIndex];

  if (input) {
    Caret.setToInput(input, Caret.positions.DEFAULT, snapshot.offset);
  } else {
    // Input doesn't exist anymore, fall back to block start
    Caret.setToBlock(block, Caret.positions.START);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "restoreCaretSnapshot"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/modules/yjsManager.ts test/unit/components/modules/yjsManager.test.ts
git commit -m "feat(yjsManager): implement restoreCaretSnapshot method"
```

---

## Task 7: Hook into Yjs UndoManager Events

**Files:**
- Modify: `src/components/modules/yjsManager.ts:84-87` (constructor)

**Step 1: Add the event listener in constructor**

In `src/components/modules/yjsManager.ts`, modify the constructor to add event listener after `setupObservers()`:

```typescript
constructor(params: ConstructorParameters<typeof Module>[0]) {
  super(params);
  this.setupObservers();
  this.setupCaretTracking();
}
```

Add new method:

```typescript
/**
 * Set up caret tracking via Yjs UndoManager events.
 * Captures caret position after each undoable change.
 */
private setupCaretTracking(): void {
  this.undoManager.on('stack-item-added', (event: { type: 'undo' | 'redo' }) => {
    if (event.type === 'undo') {
      // New undo entry was created - record caret positions
      this.caretUndoStack.push({
        before: this.pendingCaretBefore,
        after: this.captureCaretSnapshot(),
      });
      // Clear redo stack on new action (standard undo/redo behavior)
      this.caretRedoStack = [];
    }
    // Reset pending state
    this.hasPendingCaret = false;
    this.pendingCaretBefore = null;
  });
}
```

**Step 2: Run type check and existing tests**

Run: `yarn lint:types && yarn test test/unit/components/modules/yjsManager.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/modules/yjsManager.ts
git commit -m "feat(yjsManager): hook caret tracking into Yjs UndoManager events"
```

---

## Task 8: Modify `undo()` to Restore Caret

**Files:**
- Modify: `src/components/modules/yjsManager.ts:593-612` (undo method)
- Test: `test/unit/components/modules/yjsManager.test.ts`

**Step 1: Write the failing test**

```typescript
describe('undo with caret restoration', () => {
  it('restores caret to before position on undo', () => {
    const yjsManager = createYjsManager();
    const beforeSnapshot = { blockId: 'b1', inputIndex: 0, offset: 3 };
    const afterSnapshot = { blockId: 'b1', inputIndex: 0, offset: 10 };

    // Push a caret entry
    yjsManager['caretUndoStack'].push({ before: beforeSnapshot, after: afterSnapshot });

    const restoreSpy = vi.spyOn(yjsManager as any, 'restoreCaretSnapshot');

    yjsManager.undo();

    expect(restoreSpy).toHaveBeenCalledWith(beforeSnapshot);
    expect(yjsManager['caretRedoStack']).toContainEqual({ before: beforeSnapshot, after: afterSnapshot });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "undo with caret restoration"`
Expected: FAIL - restoreCaretSnapshot not called

**Step 3: Modify the undo method**

Replace the `undo()` method:

```typescript
/**
 * Undo the last operation.
 * Checks move stack first since moves are handled separately from Yjs UndoManager.
 * Restores caret position after the undo operation.
 */
public undo(): void {
  // Pop caret entry (may be undefined if stacks are out of sync)
  const caretEntry = this.caretUndoStack.pop();

  // Check if the last operation was a move (or group of moves)
  const lastMoveGroup = this.moveUndoStack.pop();

  if (lastMoveGroup !== undefined && lastMoveGroup.length > 0) {
    // Push to redo stack for potential redo
    this.moveRedoStack.push(lastMoveGroup);

    // Reverse all moves in the group, in reverse order
    [...lastMoveGroup].reverse().forEach((move) => {
      this.moveBlock(move.blockId, move.fromIndex, 'move-undo');
    });

    // Restore caret after move undo
    if (caretEntry) {
      this.caretRedoStack.push(caretEntry);
      this.restoreCaretSnapshot(caretEntry.before);
    }

    return;
  }

  // No move to undo, delegate to Yjs UndoManager
  this.undoManager.undo();

  // Restore caret after Yjs undo
  if (caretEntry) {
    this.caretRedoStack.push(caretEntry);
    this.restoreCaretSnapshot(caretEntry.before);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "undo with caret restoration"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/modules/yjsManager.ts test/unit/components/modules/yjsManager.test.ts
git commit -m "feat(yjsManager): restore caret position on undo"
```

---

## Task 9: Modify `redo()` to Restore Caret

**Files:**
- Modify: `src/components/modules/yjsManager.ts:618-636` (redo method)
- Test: `test/unit/components/modules/yjsManager.test.ts`

**Step 1: Write the failing test**

```typescript
describe('redo with caret restoration', () => {
  it('restores caret to after position on redo', () => {
    const yjsManager = createYjsManager();
    const beforeSnapshot = { blockId: 'b1', inputIndex: 0, offset: 3 };
    const afterSnapshot = { blockId: 'b1', inputIndex: 0, offset: 10 };

    // Push a caret entry to redo stack
    yjsManager['caretRedoStack'].push({ before: beforeSnapshot, after: afterSnapshot });

    const restoreSpy = vi.spyOn(yjsManager as any, 'restoreCaretSnapshot');

    yjsManager.redo();

    expect(restoreSpy).toHaveBeenCalledWith(afterSnapshot);
    expect(yjsManager['caretUndoStack']).toContainEqual({ before: beforeSnapshot, after: afterSnapshot });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "redo with caret restoration"`
Expected: FAIL - restoreCaretSnapshot not called with afterSnapshot

**Step 3: Modify the redo method**

Replace the `redo()` method:

```typescript
/**
 * Redo the last undone operation.
 * Checks move stack first since moves are handled separately from Yjs UndoManager.
 * Restores caret position after the redo operation.
 */
public redo(): void {
  // Pop caret entry (may be undefined if stacks are out of sync)
  const caretEntry = this.caretRedoStack.pop();

  // Check if the last undone operation was a move (or group of moves)
  const lastMoveGroup = this.moveRedoStack.pop();

  if (lastMoveGroup !== undefined && lastMoveGroup.length > 0) {
    // Push back to undo stack
    this.moveUndoStack.push(lastMoveGroup);

    // Redo all moves in the group, in original order
    for (const move of lastMoveGroup) {
      this.moveBlock(move.blockId, move.toIndex, 'move-redo');
    }

    // Restore caret after move redo
    if (caretEntry) {
      this.caretUndoStack.push(caretEntry);
      this.restoreCaretSnapshot(caretEntry.after);
    }

    return;
  }

  // No move to redo, delegate to Yjs UndoManager
  this.undoManager.redo();

  // Restore caret after Yjs redo
  if (caretEntry) {
    this.caretUndoStack.push(caretEntry);
    this.restoreCaretSnapshot(caretEntry.after);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "redo with caret restoration"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/modules/yjsManager.ts test/unit/components/modules/yjsManager.test.ts
git commit -m "feat(yjsManager): restore caret position on redo"
```

---

## Task 10: Call `markCaretBeforeChange` in `updateBlockData`

**Files:**
- Modify: `src/components/modules/yjsManager.ts:510-522` (updateBlockData method)

**Step 1: Add the call**

Modify `updateBlockData` to call `markCaretBeforeChange` at the start:

```typescript
/**
 * Update a property in block data
 * @param id - Block id
 * @param key - Data property key
 * @param value - New value
 */
public updateBlockData(id: string, key: string, value: unknown): void {
  this.markCaretBeforeChange();

  const yblock = this.getBlockById(id);

  if (yblock === undefined) {
    return;
  }

  this.ydoc.transact(() => {
    const ydata = yblock.get('data') as Y.Map<unknown>;
    ydata.set(key, value);
  }, 'local');
}
```

**Step 2: Run existing tests**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/modules/yjsManager.ts
git commit -m "feat(yjsManager): track caret before block data updates"
```

---

## Task 11: Call `markCaretBeforeChange` in `addBlock`

**Files:**
- Modify: `src/components/modules/yjsManager.ts:315-325` (addBlock method)

**Step 1: Add the call**

Modify `addBlock`:

```typescript
/**
 * Add a new block
 * @param blockData - Block data to add
 * @param index - Optional index to insert at
 * @returns The created Y.Map
 */
public addBlock(blockData: OutputBlockData, index?: number): Y.Map<unknown> {
  this.markCaretBeforeChange();

  const yblock = this.outputDataToYBlock(blockData);

  this.ydoc.transact(() => {
    const insertIndex = index ?? this.yblocks.length;
    this.yblocks.insert(insertIndex, [yblock]);
  }, 'local');

  return yblock;
}
```

**Step 2: Run existing tests**

Run: `yarn test`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/modules/yjsManager.ts
git commit -m "feat(yjsManager): track caret before block add"
```

---

## Task 12: Call `markCaretBeforeChange` in `removeBlock`

**Files:**
- Modify: `src/components/modules/yjsManager.ts:331-341` (removeBlock method)

**Step 1: Add the call**

Modify `removeBlock`:

```typescript
/**
 * Remove a block by id
 * @param id - Block id to remove
 */
public removeBlock(id: string): void {
  this.markCaretBeforeChange();

  const index = this.findBlockIndex(id);

  if (index === -1) {
    return;
  }

  this.ydoc.transact(() => {
    this.yblocks.delete(index, 1);
  }, 'local');
}
```

**Step 2: Run existing tests**

Run: `yarn test`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/modules/yjsManager.ts
git commit -m "feat(yjsManager): track caret before block remove"
```

---

## Task 13: Track Caret for Move Operations

**Files:**
- Modify: `src/components/modules/yjsManager.ts:349-396` (moveBlock method)
- Modify: `src/components/modules/yjsManager.ts:574-577` (recordMoveForUndo method)

**Step 1: Modify recordMoveForUndo to also record caret**

```typescript
/**
 * Record a move entry for undo and clear the redo stack.
 * Also records caret position for restoration.
 */
private recordMoveForUndo(entry: MoveHistoryEntry): void {
  this.moveUndoStack.push(entry);
  this.moveRedoStack = [];

  // Record caret position for this move
  this.caretUndoStack.push({
    before: this.pendingCaretBefore,
    after: this.captureCaretSnapshot(),
  });
  this.caretRedoStack = [];

  // Reset pending caret state
  this.hasPendingCaret = false;
  this.pendingCaretBefore = null;
}
```

**Step 2: Call markCaretBeforeChange in moveBlock**

Modify `moveBlock` to capture caret at the start:

```typescript
public moveBlock(id: string, toIndex: number, origin: 'local' | 'move-undo' | 'move-redo' = 'local'): void {
  // Capture caret before move for user-initiated moves
  if (origin === 'local') {
    this.markCaretBeforeChange();
  }

  const fromIndex = this.findBlockIndex(id);
  // ... rest of method unchanged
```

**Step 3: Run existing tests**

Run: `yarn test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/modules/yjsManager.ts
git commit -m "feat(yjsManager): track caret for move operations"
```

---

## Task 14: Clear Caret Stacks in `clearMoveHistory` and `destroy`

**Files:**
- Modify: `src/components/modules/yjsManager.ts:583-587` (clearMoveHistory)
- Modify: `src/components/modules/yjsManager.ts:725-730` (destroy)

**Step 1: Update clearMoveHistory**

```typescript
/**
 * Clear all move and caret history stacks and pending state.
 * Used when loading new data or destroying the manager.
 */
private clearMoveHistory(): void {
  this.moveUndoStack = [];
  this.moveRedoStack = [];
  this.pendingMoveGroup = null;
  this.caretUndoStack = [];
  this.caretRedoStack = [];
  this.pendingCaretBefore = null;
  this.hasPendingCaret = false;
}
```

**Step 2: Run tests**

Run: `yarn test`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/modules/yjsManager.ts
git commit -m "feat(yjsManager): clear caret stacks on history reset"
```

---

## Task 15: E2E Test - Text Undo Restores Caret

**Files:**
- Modify: `test/playwright/tests/modules/undo-redo.spec.ts`

**Step 1: Write the E2E test**

Add to the existing undo-redo.spec.ts:

```typescript
test('undo restores caret to position before text was typed', async ({ page }) => {
  await createBlokWithBlocks(page, [
    {
      type: 'paragraph',
      data: { text: 'Hello' },
    },
  ]);

  const paragraph = getParagraphByIndex(page, 0);
  const paragraphInput = paragraph.locator('[contenteditable="true"]');

  // Click at end and type more text
  await paragraphInput.click();
  await page.keyboard.press('End');
  await paragraphInput.type(' World');

  // Wait for Yjs capture
  await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

  // Get caret position before undo (should be at end: offset 11)
  const offsetBeforeUndo = await page.evaluate(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return -1;
    const range = selection.getRangeAt(0);
    const container = range.startContainer.parentElement?.closest('[contenteditable="true"]');
    if (!container) return -1;
    const preCaretRange = document.createRange();
    preCaretRange.selectNodeContents(container);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    return preCaretRange.toString().length;
  });
  expect(offsetBeforeUndo).toBe(11); // "Hello World".length

  // Undo
  await page.keyboard.press(UNDO_SHORTCUT);
  await waitForDelay(page, 200);

  // Verify caret is restored to position before typing (offset 5, after "Hello")
  const offsetAfterUndo = await page.evaluate(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return -1;
    const range = selection.getRangeAt(0);
    const container = range.startContainer.parentElement?.closest('[contenteditable="true"]');
    if (!container) return -1;
    const preCaretRange = document.createRange();
    preCaretRange.selectNodeContents(container);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    return preCaretRange.toString().length;
  });
  expect(offsetAfterUndo).toBe(5); // "Hello".length
});
```

**Step 2: Build and run test**

Run: `yarn build:test && yarn e2e test/playwright/tests/modules/undo-redo.spec.ts -g "undo restores caret"`
Expected: PASS

**Step 3: Commit**

```bash
git add test/playwright/tests/modules/undo-redo.spec.ts
git commit -m "test(e2e): verify undo restores caret position"
```

---

## Task 16: E2E Test - Text Redo Restores Caret

**Files:**
- Modify: `test/playwright/tests/modules/undo-redo.spec.ts`

**Step 1: Write the E2E test**

```typescript
test('redo restores caret to position after text was typed', async ({ page }) => {
  await createBlokWithBlocks(page, [
    {
      type: 'paragraph',
      data: { text: 'Hello' },
    },
  ]);

  const paragraph = getParagraphByIndex(page, 0);
  const paragraphInput = paragraph.locator('[contenteditable="true"]');

  // Click at end and type more text
  await paragraphInput.click();
  await page.keyboard.press('End');
  await paragraphInput.type(' World');

  // Wait for Yjs capture
  await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

  // Undo
  await page.keyboard.press(UNDO_SHORTCUT);
  await waitForDelay(page, 200);

  // Verify at position 5
  const offsetAfterUndo = await page.evaluate(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return -1;
    const range = selection.getRangeAt(0);
    const container = range.startContainer.parentElement?.closest('[contenteditable="true"]');
    if (!container) return -1;
    const preCaretRange = document.createRange();
    preCaretRange.selectNodeContents(container);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    return preCaretRange.toString().length;
  });
  expect(offsetAfterUndo).toBe(5);

  // Redo
  await page.keyboard.press(REDO_SHORTCUT);
  await waitForDelay(page, 200);

  // Verify caret is restored to position after typing (offset 11)
  const offsetAfterRedo = await page.evaluate(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return -1;
    const range = selection.getRangeAt(0);
    const container = range.startContainer.parentElement?.closest('[contenteditable="true"]');
    if (!container) return -1;
    const preCaretRange = document.createRange();
    preCaretRange.selectNodeContents(container);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    return preCaretRange.toString().length;
  });
  expect(offsetAfterRedo).toBe(11);
});
```

**Step 2: Build and run test**

Run: `yarn build:test && yarn e2e test/playwright/tests/modules/undo-redo.spec.ts -g "redo restores caret"`
Expected: PASS

**Step 3: Commit**

```bash
git add test/playwright/tests/modules/undo-redo.spec.ts
git commit -m "test(e2e): verify redo restores caret position"
```

---

## Task 17: E2E Test - Block Add Undo Restores Caret

**Files:**
- Modify: `test/playwright/tests/modules/undo-redo.spec.ts`

**Step 1: Write the E2E test**

```typescript
test('undo block add restores caret to previous position', async ({ page }) => {
  await createBlokWithBlocks(page, [
    {
      type: 'paragraph',
      data: { text: 'First paragraph' },
    },
  ]);

  const paragraph = getParagraphByIndex(page, 0);
  const paragraphInput = paragraph.locator('[contenteditable="true"]');

  // Place caret in middle of text (offset 5, after "First")
  await paragraphInput.click();
  await page.keyboard.press('Home');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('ArrowRight');
  }

  // Add new block via Enter at end
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

  // Verify we have 2 blocks
  const blockCount = await page.locator(BLOCK_WRAPPER_SELECTOR).count();
  expect(blockCount).toBe(2);

  // Undo the block addition
  await page.keyboard.press(UNDO_SHORTCUT);
  await waitForDelay(page, 200);

  // Verify we're back to 1 block
  const blockCountAfterUndo = await page.locator(BLOCK_WRAPPER_SELECTOR).count();
  expect(blockCountAfterUndo).toBe(1);

  // Verify caret is in the first paragraph (the block that was focused before add)
  const focusedBlockId = await page.evaluate(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const block = selection.anchorNode?.parentElement?.closest('[data-blok-testid="block-wrapper"]');
    return block?.getAttribute('data-blok-id');
  });

  // Should be focused on first paragraph
  const firstParagraphId = await paragraph.getAttribute('data-blok-id');
  expect(focusedBlockId).toBe(firstParagraphId);
});
```

**Step 2: Build and run test**

Run: `yarn build:test && yarn e2e test/playwright/tests/modules/undo-redo.spec.ts -g "undo block add"`
Expected: PASS

**Step 3: Commit**

```bash
git add test/playwright/tests/modules/undo-redo.spec.ts
git commit -m "test(e2e): verify undo block add restores caret"
```

---

## Task 18: E2E Test - Block Move Undo Restores Caret

**Files:**
- Modify: `test/playwright/tests/modules/undo-redo.spec.ts`

**Step 1: Write the E2E test**

```typescript
test('undo block move restores caret position', async ({ page }) => {
  await createBlokWithBlocks(page, [
    { type: 'paragraph', data: { text: 'Block A' } },
    { type: 'paragraph', data: { text: 'Block B' } },
    { type: 'paragraph', data: { text: 'Block C' } },
  ]);

  // Focus Block B and place caret at offset 3
  const blockB = getParagraphByIndex(page, 1);
  const blockBInput = blockB.locator('[contenteditable="true"]');
  await blockBInput.click();
  await page.keyboard.press('Home');
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowRight');
  }

  // Move Block B to position 0 (before Block A) via drag
  // This depends on your drag implementation - adjust as needed
  const blockBId = await blockB.getAttribute('data-blok-id');
  await page.evaluate(async (id) => {
    await window.blokInstance?.blocks.move(id!, 0);
  }, blockBId);
  await waitForDelay(page, 200);

  // Verify Block B is now first
  const firstBlockText = await getParagraphByIndex(page, 0).locator('[contenteditable="true"]').textContent();
  expect(firstBlockText).toBe('Block B');

  // Undo the move
  await page.keyboard.press(UNDO_SHORTCUT);
  await waitForDelay(page, 200);

  // Verify Block A is first again
  const firstBlockTextAfterUndo = await getParagraphByIndex(page, 0).locator('[contenteditable="true"]').textContent();
  expect(firstBlockTextAfterUndo).toBe('Block A');

  // Verify caret is still in Block B at correct position
  const focusedBlockId = await page.evaluate(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const block = selection.anchorNode?.parentElement?.closest('[data-blok-testid="block-wrapper"]');
    return block?.getAttribute('data-blok-id');
  });
  expect(focusedBlockId).toBe(blockBId);
});
```

**Step 2: Build and run test**

Run: `yarn build:test && yarn e2e test/playwright/tests/modules/undo-redo.spec.ts -g "undo block move"`
Expected: PASS

**Step 3: Commit**

```bash
git add test/playwright/tests/modules/undo-redo.spec.ts
git commit -m "test(e2e): verify undo block move restores caret"
```

---

## Task 19: Run Full Test Suite and Fix Any Issues

**Step 1: Run all unit tests**

Run: `yarn test`
Expected: All tests pass

**Step 2: Run all E2E tests**

Run: `yarn build:test && yarn e2e`
Expected: All tests pass

**Step 3: Run linting**

Run: `yarn lint`
Expected: No errors

**Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address test failures from caret restoration implementation"
```

---

## Summary

This implementation adds caret position tracking and restoration to undo/redo operations through:

1. **New utility**: `getCaretOffset()` for capturing character offset
2. **Block enhancement**: `currentInputIndex` getter for multi-input tools
3. **YjsManager additions**:
   - `CaretSnapshot` and `CaretHistoryEntry` types
   - `caretUndoStack` and `caretRedoStack` parallel stacks
   - `captureCaretSnapshot()` and `restoreCaretSnapshot()` methods
   - `markCaretBeforeChange()` called before undoable operations
   - Modified `undo()` and `redo()` to restore caret position
4. **E2E tests** verifying text, block add, and block move scenarios

Total: 19 tasks, approximately 1-2 hours of implementation time.
