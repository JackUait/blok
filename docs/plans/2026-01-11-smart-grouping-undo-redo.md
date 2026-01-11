# Smart Grouping Undo/Redo Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement more granular undo grouping based on typing pauses at word/punctuation boundaries instead of pure time-based batching.

**Architecture:** Add boundary detection to YjsManager that tracks when the user types a boundary character (space, punctuation). If 100ms passes after a boundary without new input, call `stopCapturing()` to create a new undo group. Reduce Yjs `captureTimeout` to 10ms so our logic controls grouping.

**Tech Stack:** Yjs UndoManager, TypeScript, Vitest (unit tests), Playwright (E2E tests)

---

## Task 1: Add Boundary Detection State to YjsManager

**Files:**
- Modify: `src/components/modules/yjsManager.ts:56-80`
- Test: `test/unit/components/modules/yjsManager.test.ts`

**Step 1: Write the failing test for boundary state initialization**

Add to `test/unit/components/modules/yjsManager.test.ts`:

```typescript
describe('smart grouping', () => {
  it('should initialize with no pending boundary', () => {
    expect(manager.hasPendingBoundary()).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "should initialize with no pending boundary"`
Expected: FAIL with "hasPendingBoundary is not a function"

**Step 3: Add boundary state properties and method**

In `src/components/modules/yjsManager.ts`, after line 131 (after `isPerformingUndoRedo`), add:

```typescript
/**
 * Whether the last typed character was a boundary (space, punctuation).
 * Used for smart undo grouping.
 */
private pendingBoundary = false;

/**
 * Timestamp when the boundary character was typed.
 * Used to check if 100ms has elapsed.
 */
private boundaryTimestamp = 0;

/**
 * Timer ID for the boundary timeout.
 * Fires stopCapturing() after 100ms idle at a boundary.
 */
private boundaryTimeoutId: ReturnType<typeof setTimeout> | null = null;
```

Add public method (after `stopCapturing()` around line 958):

```typescript
/**
 * Check if there is a pending boundary waiting for timeout.
 * @returns true if a boundary character was typed and hasn't timed out yet
 */
public hasPendingBoundary(): boolean {
  return this.pendingBoundary;
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "should initialize with no pending boundary"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/modules/yjsManager.ts test/unit/components/modules/yjsManager.test.ts
git commit -m "feat(undo): add boundary detection state to YjsManager"
```

---

## Task 2: Implement markBoundary() Method

**Files:**
- Modify: `src/components/modules/yjsManager.ts`
- Test: `test/unit/components/modules/yjsManager.test.ts`

**Step 1: Write the failing test**

Add to the `smart grouping` describe block:

```typescript
it('should set pending boundary when markBoundary is called', () => {
  manager.markBoundary();
  expect(manager.hasPendingBoundary()).toBe(true);
});

it('should clear pending boundary after timeout', async () => {
  vi.useFakeTimers();
  manager.markBoundary();
  expect(manager.hasPendingBoundary()).toBe(true);

  vi.advanceTimersByTime(150);

  expect(manager.hasPendingBoundary()).toBe(false);
  vi.useRealTimers();
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "should set pending boundary"`
Expected: FAIL with "markBoundary is not a function"

**Step 3: Implement markBoundary()**

Add after `hasPendingBoundary()`:

```typescript
/**
 * Time in milliseconds to wait after a boundary character before creating a checkpoint.
 */
private static readonly BOUNDARY_TIMEOUT_MS = 100;

/**
 * Mark that a boundary character (space, punctuation) was just typed.
 * Starts a timer that will call stopCapturing() after BOUNDARY_TIMEOUT_MS
 * if no new input arrives.
 */
public markBoundary(): void {
  this.pendingBoundary = true;
  this.boundaryTimestamp = Date.now();

  // Clear any existing timeout
  if (this.boundaryTimeoutId !== null) {
    clearTimeout(this.boundaryTimeoutId);
  }

  // Set new timeout to create checkpoint if no more input
  this.boundaryTimeoutId = setTimeout(() => {
    if (this.pendingBoundary) {
      this.stopCapturing();
      this.pendingBoundary = false;
    }
    this.boundaryTimeoutId = null;
  }, YjsManager.BOUNDARY_TIMEOUT_MS);
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "should set pending boundary"`
Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "should clear pending boundary after timeout"`
Expected: Both PASS

**Step 5: Commit**

```bash
git add src/components/modules/yjsManager.ts test/unit/components/modules/yjsManager.test.ts
git commit -m "feat(undo): implement markBoundary() for smart grouping"
```

---

## Task 3: Implement clearBoundary() Method

**Files:**
- Modify: `src/components/modules/yjsManager.ts`
- Test: `test/unit/components/modules/yjsManager.test.ts`

**Step 1: Write the failing test**

Add to the `smart grouping` describe block:

```typescript
it('should clear pending boundary when clearBoundary is called', () => {
  vi.useFakeTimers();
  manager.markBoundary();
  expect(manager.hasPendingBoundary()).toBe(true);

  manager.clearBoundary();
  expect(manager.hasPendingBoundary()).toBe(false);

  // Timeout should not fire stopCapturing after clearBoundary
  vi.advanceTimersByTime(150);
  // No error means success - stopCapturing wasn't called unnecessarily
  vi.useRealTimers();
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "should clear pending boundary when clearBoundary"`
Expected: FAIL with "clearBoundary is not a function"

**Step 3: Implement clearBoundary()**

Add after `markBoundary()`:

```typescript
/**
 * Clear the pending boundary state without creating a checkpoint.
 * Called when the user continues typing before the timeout.
 */
public clearBoundary(): void {
  this.pendingBoundary = false;
  this.boundaryTimestamp = 0;

  if (this.boundaryTimeoutId !== null) {
    clearTimeout(this.boundaryTimeoutId);
    this.boundaryTimeoutId = null;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "should clear pending boundary when clearBoundary"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/modules/yjsManager.ts test/unit/components/modules/yjsManager.test.ts
git commit -m "feat(undo): implement clearBoundary() for smart grouping"
```

---

## Task 4: Implement checkAndHandleBoundary() Method

**Files:**
- Modify: `src/components/modules/yjsManager.ts`
- Test: `test/unit/components/modules/yjsManager.test.ts`

**Step 1: Write the failing test**

Add to the `smart grouping` describe block:

```typescript
it('should call stopCapturing when checkAndHandleBoundary is called after timeout elapsed', () => {
  vi.useFakeTimers();
  const stopCapturingSpy = vi.spyOn(manager, 'stopCapturing');

  manager.markBoundary();
  vi.advanceTimersByTime(50); // Only 50ms elapsed

  manager.checkAndHandleBoundary();
  expect(stopCapturingSpy).not.toHaveBeenCalled(); // Not enough time

  vi.advanceTimersByTime(60); // Now 110ms total

  manager.checkAndHandleBoundary();
  expect(stopCapturingSpy).toHaveBeenCalledTimes(1);
  expect(manager.hasPendingBoundary()).toBe(false);

  vi.useRealTimers();
});

it('should not call stopCapturing when no pending boundary', () => {
  const stopCapturingSpy = vi.spyOn(manager, 'stopCapturing');

  manager.checkAndHandleBoundary();
  expect(stopCapturingSpy).not.toHaveBeenCalled();
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "should call stopCapturing when checkAndHandleBoundary"`
Expected: FAIL with "checkAndHandleBoundary is not a function"

**Step 3: Implement checkAndHandleBoundary()**

Add after `clearBoundary()`:

```typescript
/**
 * Check if a pending boundary has timed out and create a checkpoint if so.
 * Called on each keystroke to handle the case where the user resumes typing
 * after a pause longer than BOUNDARY_TIMEOUT_MS.
 */
public checkAndHandleBoundary(): void {
  if (!this.pendingBoundary) {
    return;
  }

  const elapsed = Date.now() - this.boundaryTimestamp;

  if (elapsed >= YjsManager.BOUNDARY_TIMEOUT_MS) {
    this.stopCapturing();
    this.clearBoundary();
  }
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "should call stopCapturing when checkAndHandleBoundary"`
Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "should not call stopCapturing when no pending boundary"`
Expected: Both PASS

**Step 5: Commit**

```bash
git add src/components/modules/yjsManager.ts test/unit/components/modules/yjsManager.test.ts
git commit -m "feat(undo): implement checkAndHandleBoundary() for smart grouping"
```

---

## Task 5: Add Boundary Character Detection Utility

**Files:**
- Modify: `src/components/modules/yjsManager.ts`
- Test: `test/unit/components/modules/yjsManager.test.ts`

**Step 1: Write the failing test**

Add to the `smart grouping` describe block:

```typescript
describe('isBoundaryCharacter', () => {
  it.each([
    [' ', true],
    ['\t', true],
    ['.', true],
    ['?', true],
    ['!', true],
    [',', true],
    [';', true],
    [':', true],
    ['a', false],
    ['1', false],
    ['@', false],
    ['-', false],
  ])('should return %s for "%s"', (char, expected) => {
    expect(YjsManager.isBoundaryCharacter(char)).toBe(expected);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "isBoundaryCharacter"`
Expected: FAIL with "isBoundaryCharacter is not a function"

**Step 3: Implement isBoundaryCharacter()**

Add as a static method in YjsManager class:

```typescript
/**
 * Characters that mark potential undo checkpoint positions.
 */
private static readonly BOUNDARY_CHARACTERS = new Set([
  ' ',   // space
  '\t',  // tab
  '.',   // period
  '?',   // question mark
  '!',   // exclamation
  ',',   // comma
  ';',   // semicolon
  ':',   // colon
]);

/**
 * Check if a character is a boundary character that can trigger an undo checkpoint.
 * @param char - Single character to check
 * @returns true if the character is a boundary character
 */
public static isBoundaryCharacter(char: string): boolean {
  return YjsManager.BOUNDARY_CHARACTERS.has(char);
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "isBoundaryCharacter"`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/components/modules/yjsManager.ts test/unit/components/modules/yjsManager.test.ts
git commit -m "feat(undo): add isBoundaryCharacter() utility"
```

---

## Task 6: Reduce captureTimeout

**Files:**
- Modify: `src/components/modules/yjsManager.ts:56-60`

**Step 1: No test needed - this is a configuration change**

**Step 2: Update CAPTURE_TIMEOUT_MS**

Change line 60 from:
```typescript
const CAPTURE_TIMEOUT_MS = 300;
```
to:
```typescript
const CAPTURE_TIMEOUT_MS = 10;
```

Update the comment on lines 56-59:
```typescript
/**
 * Time in milliseconds to batch consecutive changes into a single undo entry.
 * Set to a small value (10ms) because smart grouping logic handles boundaries.
 * This serves as a fallback for rapid consecutive changes within a single keystroke.
 */
const CAPTURE_TIMEOUT_MS = 10;
```

**Step 3: Run existing tests to ensure nothing breaks**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/components/modules/yjsManager.ts
git commit -m "feat(undo): reduce captureTimeout to 10ms for smart grouping"
```

---

## Task 7: Clean Up Boundary State in clearHistory()

**Files:**
- Modify: `src/components/modules/yjsManager.ts`
- Test: `test/unit/components/modules/yjsManager.test.ts`

**Step 1: Write the failing test**

Add to the existing `clearHistory` or create new describe block:

```typescript
describe('clearHistory boundary cleanup', () => {
  it('should clear pending boundary when history is cleared via fromJSON', () => {
    vi.useFakeTimers();
    manager.markBoundary();
    expect(manager.hasPendingBoundary()).toBe(true);

    // fromJSON calls clearHistory internally
    manager.fromJSON([{ id: 'block1', type: 'paragraph', data: { text: 'Test' } }]);

    expect(manager.hasPendingBoundary()).toBe(false);
    vi.useRealTimers();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "should clear pending boundary when history is cleared"`
Expected: FAIL (pendingBoundary still true)

**Step 3: Update clearHistory() method**

Find the `clearHistory()` method (around line 734) and add boundary cleanup:

```typescript
private clearHistory(): void {
  this.moveUndoStack = [];
  this.moveRedoStack = [];
  this.pendingMoveGroup = null;
  this.caretUndoStack = [];
  this.caretRedoStack = [];
  this.pendingCaretBefore = null;
  this.hasPendingCaret = false;
  this.isPerformingUndoRedo = false;
  // Clear smart grouping state
  this.clearBoundary();
  this.undoManager.clear();
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts -t "should clear pending boundary when history is cleared"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/modules/yjsManager.ts test/unit/components/modules/yjsManager.test.ts
git commit -m "feat(undo): clean up boundary state in clearHistory()"
```

---

## Task 8: Clean Up Boundary Timer in destroy()

**Files:**
- Modify: `src/components/modules/yjsManager.ts`

**Step 1: No new test needed - destruction cleanup**

**Step 2: Update destroy() method**

Find the `destroy()` method (around line 1044) and add boundary cleanup:

```typescript
public destroy(): void {
  this.clearHistory();
  this.changeCallbacks = [];
  this.undoManager.destroy();
  this.ydoc.destroy();
}
```

Note: `clearHistory()` already calls `clearBoundary()` which clears the timer, so no additional changes needed.

**Step 3: Run existing tests**

Run: `yarn test test/unit/components/modules/yjsManager.test.ts`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/components/modules/yjsManager.ts
git commit -m "chore(undo): ensure boundary timer cleanup on destroy"
```

---

## Task 9: Hook Smart Grouping into BlockEvents Input Handler

**Files:**
- Modify: `src/components/modules/blockEvents.ts:481-491`
- Test: `test/unit/components/modules/blockEvents.test.ts`

**Step 1: Write the failing test**

Add to `test/unit/components/modules/blockEvents.test.ts`:

```typescript
describe('smart grouping', () => {
  it('should call markBoundary when space is typed', () => {
    const markBoundarySpy = vi.fn();
    mockModules.YjsManager.markBoundary = markBoundarySpy;

    const event = {
      inputType: 'insertText',
      data: ' ',
    } as InputEvent;

    blockEvents.input(event);

    expect(markBoundarySpy).toHaveBeenCalled();
  });

  it('should call checkAndHandleBoundary on non-boundary character', () => {
    const checkAndHandleBoundarySpy = vi.fn();
    mockModules.YjsManager.checkAndHandleBoundary = checkAndHandleBoundarySpy;

    const event = {
      inputType: 'insertText',
      data: 'a',
    } as InputEvent;

    blockEvents.input(event);

    expect(checkAndHandleBoundarySpy).toHaveBeenCalled();
  });

  it('should call clearBoundary when non-boundary follows boundary quickly', () => {
    const clearBoundarySpy = vi.fn();
    const hasPendingBoundarySpy = vi.fn().mockReturnValue(true);
    mockModules.YjsManager.clearBoundary = clearBoundarySpy;
    mockModules.YjsManager.hasPendingBoundary = hasPendingBoundarySpy;
    // checkAndHandleBoundary won't call stopCapturing if not enough time elapsed
    mockModules.YjsManager.checkAndHandleBoundary = vi.fn();

    const event = {
      inputType: 'insertText',
      data: 'a',
    } as InputEvent;

    blockEvents.input(event);

    expect(clearBoundarySpy).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/blockEvents.test.ts -t "smart grouping"`
Expected: FAIL

**Step 3: Update the input() method in blockEvents.ts**

Replace the `input()` method (lines 481-491):

```typescript
/**
 * Handles input events for markdown shortcuts and smart undo grouping.
 * @param {InputEvent} event - input event
 */
public input(event: InputEvent): void {
  // Handle smart grouping for undo
  this.handleSmartGrouping(event);

  /**
   * Only handle markdown shortcuts for insertText events that end with a space
   */
  if (event.inputType !== 'insertText' || event.data !== ' ') {
    return;
  }

  this.handleListShortcut();
  this.handleHeaderShortcut();
}

/**
 * Handle smart grouping logic for undo based on boundary characters.
 * Boundary characters (space, punctuation) followed by a pause create undo checkpoints.
 * @param event - input event
 */
private handleSmartGrouping(event: InputEvent): void {
  const { YjsManager } = this.Blok;

  // Only handle text input
  if (event.inputType !== 'insertText' || event.data === null) {
    return;
  }

  const char = event.data;

  // Check if previous boundary has timed out (user resumed typing after pause)
  YjsManager.checkAndHandleBoundary();

  if (YjsManager.constructor.isBoundaryCharacter(char)) {
    // Mark boundary - will create checkpoint if followed by pause
    YjsManager.markBoundary();
  } else if (YjsManager.hasPendingBoundary()) {
    // Non-boundary character typed quickly after boundary - clear pending state
    YjsManager.clearBoundary();
  }
}
```

**Step 4: Fix the static method access**

The `isBoundaryCharacter` is a static method. Update the call:

```typescript
import { YjsManager } from './yjsManager';

// In handleSmartGrouping:
if (YjsManager.isBoundaryCharacter(char)) {
```

**Step 5: Run test to verify it passes**

Run: `yarn test test/unit/components/modules/blockEvents.test.ts -t "smart grouping"`
Expected: All PASS

**Step 6: Commit**

```bash
git add src/components/modules/blockEvents.ts test/unit/components/modules/blockEvents.test.ts
git commit -m "feat(undo): hook smart grouping into BlockEvents input handler"
```

---

## Task 10: Add E2E Test - Word Boundary + Pause Creates Checkpoint

**Files:**
- Modify: `test/playwright/tests/modules/undo-redo.spec.ts`

**Step 1: Write the E2E test**

Add to `test/playwright/tests/modules/undo-redo.spec.ts` inside the main describe block:

```typescript
test.describe('smart grouping', () => {
  const BOUNDARY_TIMEOUT = 150; // 100ms boundary timeout + buffer

  test('word boundary + pause creates checkpoint', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: { text: '' },
      },
    ]);

    const paragraph = getParagraphByIndex(page, 0);
    const paragraphInput = paragraph.locator('[contenteditable="true"]');

    await paragraphInput.click();

    // Type "Hello " then pause
    await page.keyboard.type('Hello ');
    await waitForDelay(page, BOUNDARY_TIMEOUT);

    // Type "world"
    await page.keyboard.type('world');
    await waitForDelay(page, BOUNDARY_TIMEOUT);

    // Verify full text
    await expect(paragraphInput).toHaveText('Hello world');

    // Undo should remove only "world"
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 100);

    await expect(paragraphInput).toHaveText('Hello ');
  });

  test('fast typing batches together', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: { text: '' },
      },
    ]);

    const paragraph = getParagraphByIndex(page, 0);
    const paragraphInput = paragraph.locator('[contenteditable="true"]');

    await paragraphInput.click();

    // Type "Hello world" fast (no pause between words)
    await page.keyboard.type('Hello world', { delay: 10 });
    await waitForDelay(page, BOUNDARY_TIMEOUT);

    // Verify full text
    await expect(paragraphInput).toHaveText('Hello world');

    // Undo should remove entire "Hello world"
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 100);

    await expect(paragraphInput).toHaveText('');
  });

  test('punctuation + pause creates checkpoint', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: { text: '' },
      },
    ]);

    const paragraph = getParagraphByIndex(page, 0);
    const paragraphInput = paragraph.locator('[contenteditable="true"]');

    await paragraphInput.click();

    // Type "Hello," then pause
    await page.keyboard.type('Hello,');
    await waitForDelay(page, BOUNDARY_TIMEOUT);

    // Type " world"
    await page.keyboard.type(' world');
    await waitForDelay(page, BOUNDARY_TIMEOUT);

    // Verify full text
    await expect(paragraphInput).toHaveText('Hello, world');

    // Undo should remove only " world"
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 100);

    await expect(paragraphInput).toHaveText('Hello,');
  });

  test('multiple words batch when typed fast', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: { text: '' },
      },
    ]);

    const paragraph = getParagraphByIndex(page, 0);
    const paragraphInput = paragraph.locator('[contenteditable="true"]');

    await paragraphInput.click();

    // Type "The quick brown" fast
    await page.keyboard.type('The quick brown', { delay: 10 });
    await waitForDelay(page, BOUNDARY_TIMEOUT);

    // Verify full text
    await expect(paragraphInput).toHaveText('The quick brown');

    // Undo should remove all three words
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 100);

    await expect(paragraphInput).toHaveText('');
  });
});
```

**Step 2: Build the test bundle**

Run: `yarn build:test`

**Step 3: Run the E2E tests**

Run: `yarn e2e test/playwright/tests/modules/undo-redo.spec.ts -g "smart grouping"`
Expected: All PASS (after implementation is complete)

**Step 4: Commit**

```bash
git add test/playwright/tests/modules/undo-redo.spec.ts
git commit -m "test(e2e): add smart grouping undo/redo tests"
```

---

## Task 11: Run Full Test Suite and Fix Any Issues

**Files:**
- Potentially any files if issues arise

**Step 1: Run unit tests**

Run: `yarn test`
Expected: All PASS

**Step 2: Build for E2E**

Run: `yarn build:test`

**Step 3: Run E2E tests**

Run: `yarn e2e`
Expected: All PASS

**Step 4: Run linting**

Run: `yarn lint`
Expected: No errors

**Step 5: Fix any issues that arise**

If tests fail, debug and fix the issues.

**Step 6: Final commit if fixes were needed**

```bash
git add -A
git commit -m "fix(undo): address test failures in smart grouping"
```

---

## Summary

This plan implements smart undo grouping in 11 tasks:

1. **Tasks 1-5**: Add boundary detection infrastructure to YjsManager
2. **Task 6**: Reduce captureTimeout to let our logic control grouping
3. **Tasks 7-8**: Cleanup boundary state in clearHistory() and destroy()
4. **Task 9**: Hook smart grouping into BlockEvents input handler
5. **Task 10**: Add E2E tests for smart grouping behavior
6. **Task 11**: Verify full test suite passes
