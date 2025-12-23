# Hybrid Action-Change Grouping Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce overly granular undo entries by only checkpointing on action type change after 3+ characters of the new action type.

**Architecture:** Add a pending action counter to SmartGrouping that tracks characters since last action type change. Only create checkpoint when threshold (3) is reached. Reset counter on any checkpoint.

**Tech Stack:** TypeScript, Playwright for E2E tests

---

## Task 1: Add Threshold Constant and State to SmartGrouping

**Files:**
- Modify: [smart-grouping.ts:1-20](src/components/modules/history/smart-grouping.ts#L1-L20)

**Step 1: Write the failing unit test**

Create file `test/unit/components/modules/history/smart-grouping.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { SmartGrouping } from '../../../../../src/components/modules/history/smart-grouping';

describe('SmartGrouping', () => {
  let smartGrouping: SmartGrouping;

  beforeEach(() => {
    smartGrouping = new SmartGrouping();
  });

  describe('action change threshold', () => {
    it('should not create checkpoint on first action type change', () => {
      // Set up initial context with 'insert' action
      smartGrouping.updateContext('insert', 'block-1');

      // First backspace - should NOT checkpoint (count = 1)
      const shouldCheckpoint = smartGrouping.shouldCreateCheckpoint(
        { actionType: 'delete-back' },
        'block-1'
      );

      expect(shouldCheckpoint).toBe(false);
    });

    it('should not create checkpoint on second action of new type', () => {
      smartGrouping.updateContext('insert', 'block-1');

      // First backspace
      smartGrouping.shouldCreateCheckpoint({ actionType: 'delete-back' }, 'block-1');
      smartGrouping.updateContext('delete-back', 'block-1');

      // Second backspace - should NOT checkpoint (count = 2)
      const shouldCheckpoint = smartGrouping.shouldCreateCheckpoint(
        { actionType: 'delete-back' },
        'block-1'
      );

      expect(shouldCheckpoint).toBe(false);
    });

    it('should create checkpoint on third action of new type', () => {
      smartGrouping.updateContext('insert', 'block-1');

      // Simulate two backspaces without checkpointing
      smartGrouping.shouldCreateCheckpoint({ actionType: 'delete-back' }, 'block-1');
      smartGrouping.updateContext('delete-back', 'block-1');
      smartGrouping.shouldCreateCheckpoint({ actionType: 'delete-back' }, 'block-1');
      smartGrouping.updateContext('delete-back', 'block-1');

      // Third backspace - should checkpoint (count = 3)
      const shouldCheckpoint = smartGrouping.shouldCreateCheckpoint(
        { actionType: 'delete-back' },
        'block-1'
      );

      expect(shouldCheckpoint).toBe(true);
    });

    it('should reset pending count when switching back before threshold', () => {
      smartGrouping.updateContext('insert', 'block-1');

      // One backspace
      smartGrouping.shouldCreateCheckpoint({ actionType: 'delete-back' }, 'block-1');
      smartGrouping.updateContext('delete-back', 'block-1');

      // Switch back to insert - should reset pending count
      smartGrouping.shouldCreateCheckpoint({ actionType: 'insert' }, 'block-1');
      smartGrouping.updateContext('insert', 'block-1');

      // Another backspace - count should start from 1 again
      const shouldCheckpoint = smartGrouping.shouldCreateCheckpoint(
        { actionType: 'delete-back' },
        'block-1'
      );

      expect(shouldCheckpoint).toBe(false);
    });

    it('should reset pending count after checkpoint is created', () => {
      smartGrouping.updateContext('insert', 'block-1');

      // Three backspaces to trigger checkpoint
      smartGrouping.shouldCreateCheckpoint({ actionType: 'delete-back' }, 'block-1');
      smartGrouping.updateContext('delete-back', 'block-1');
      smartGrouping.shouldCreateCheckpoint({ actionType: 'delete-back' }, 'block-1');
      smartGrouping.updateContext('delete-back', 'block-1');
      smartGrouping.shouldCreateCheckpoint({ actionType: 'delete-back' }, 'block-1');
      // Reset after checkpoint
      smartGrouping.resetPendingActionCount();
      smartGrouping.updateContext('delete-back', 'block-1');

      // Now switch to insert - should start counting from 1
      const shouldCheckpoint = smartGrouping.shouldCreateCheckpoint(
        { actionType: 'insert' },
        'block-1'
      );

      expect(shouldCheckpoint).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test test/unit/components/modules/history/smart-grouping.test.ts`

Expected: FAIL with errors about missing `resetPendingActionCount` method and incorrect behavior

**Step 3: Add constant and state to SmartGrouping**

In [smart-grouping.ts](src/components/modules/history/smart-grouping.ts), add after line 16:

```typescript
/**
 * Threshold for action type changes before creating a checkpoint.
 * Quick corrections (< threshold) stay grouped with previous actions.
 */
const ACTION_CHANGE_THRESHOLD = 3;
```

Add new private property after `currentContext` (around line 30):

```typescript
/**
 * Count of actions since last action type change.
 * Used to implement threshold-based checkpointing.
 */
private pendingActionCount = 0;
```

**Step 4: Add resetPendingActionCount method**

Add after `clearContext()` method:

```typescript
/**
 * Resets the pending action count.
 * Call this after a checkpoint is created.
 */
public resetPendingActionCount(): void {
  this.pendingActionCount = 0;
}
```

**Step 5: Run tests to verify they still fail (method exists but logic not implemented)**

Run: `yarn test test/unit/components/modules/history/smart-grouping.test.ts`

Expected: FAIL - method exists but shouldCreateCheckpoint returns wrong values

**Step 6: Commit scaffolding**

```bash
git add src/components/modules/history/smart-grouping.ts test/unit/components/modules/history/smart-grouping.test.ts
git commit -m "test: add failing tests for action change threshold"
```

---

## Task 2: Implement Threshold Logic in shouldCreateCheckpoint

**Files:**
- Modify: [smart-grouping.ts:38-60](src/components/modules/history/smart-grouping.ts#L38-L60)

**Step 1: Modify shouldCreateCheckpoint to implement threshold logic**

Replace the `shouldCreateCheckpoint` method:

```typescript
/**
 * Determines if a checkpoint should be created before recording this mutation
 * @param metadata - mutation metadata with action type info
 * @param blockId - ID of the block being mutated
 * @returns true if a checkpoint should be created
 */
public shouldCreateCheckpoint(
  metadata: MutationMetadata,
  blockId: string
): boolean {
  const actionType = metadata.actionType ?? 'insert';

  // No current context means this is the first action - don't checkpoint
  if (!this.currentContext) {
    return false;
  }

  // Block changed - create checkpoint immediately
  if (this.currentContext.blockId !== blockId) {
    this.pendingActionCount = 0;

    return true;
  }

  // Same action type - reset pending count, no checkpoint needed
  if (this.currentContext.type === actionType) {
    this.pendingActionCount = 0;

    return false;
  }

  // Action type changed - increment pending count
  this.pendingActionCount++;

  // Only checkpoint if we've reached the threshold
  if (this.pendingActionCount >= ACTION_CHANGE_THRESHOLD) {
    // Don't reset here - let the caller reset after creating checkpoint
    return true;
  }

  return false;
}
```

**Step 2: Run tests to verify they pass**

Run: `yarn test test/unit/components/modules/history/smart-grouping.test.ts`

Expected: PASS

**Step 3: Run all unit tests to check for regressions**

Run: `yarn test`

Expected: PASS

**Step 4: Commit implementation**

```bash
git add src/components/modules/history/smart-grouping.ts
git commit -m "feat: implement action change threshold in SmartGrouping"
```

---

## Task 3: Integrate Threshold Reset into History Module

**Files:**
- Modify: [history.ts:700-722](src/components/modules/history.ts#L700-L722)

**Step 1: Modify handleBlockMutation to reset pending count after checkpoint**

In `handleBlockMutation`, after the checkpoint is created (around line 711), add reset call:

```typescript
if (shouldCheckpoint || isImmediate) {
  // Create checkpoint immediately (flush pending debounce)
  this.clearDebounce();
  void this.recordState().then(() => {
    // Reset pending action count after checkpoint
    this.smartGrouping.resetPendingActionCount();
    // Update context after recording
    this.smartGrouping.updateContext(this.currentActionType, blockId);
    // Start new debounce for continued editing
    this.startDebounce();
  });
} else {
  // Update context and debounce normally
  this.smartGrouping.updateContext(this.currentActionType, blockId);
  this.clearDebounce();
  this.startDebounce();
}
```

**Step 2: Reset pending count when debounce expires**

In the `startDebounce` method, reset pending count when debounce timer fires:

```typescript
private startDebounce(): void {
  this.debounceTimeout = setTimeout(() => {
    // Reset pending action count - debounce expiry acts as a checkpoint
    this.smartGrouping.resetPendingActionCount();
    void this.recordState();
  }, this.debounceTime);
}
```

**Step 3: Run unit tests**

Run: `yarn test`

Expected: PASS

**Step 4: Commit integration**

```bash
git add src/components/modules/history.ts
git commit -m "feat: integrate threshold reset into History module"
```

---

## Task 4: Add E2E Test for Quick Corrections Staying Grouped

**Files:**
- Modify: [undo-redo.spec.ts](test/playwright/tests/modules/undo-redo.spec.ts)

**Step 1: Add test for quick corrections**

Add new test describe block after the "Edge Cases - Paste Operations" section:

```typescript
test.describe('edge Cases - Action Change Threshold', () => {
  test('quick correction (type, delete <3, type) stays grouped', async ({ page }) => {
    await createBlok(page, {
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: { text: '' },
          },
        ],
      },
    });

    const paragraph = page.locator(`${PARAGRAPH_SELECTOR}:first-of-type`);
    const input = paragraph.locator('[contenteditable="true"]');

    // Type "hello"
    await input.click();
    await page.keyboard.type('hello');

    // Quick correction: delete 2 chars (below threshold)
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');

    // Continue typing
    await page.keyboard.type('p me');

    // Wait for debounce
    await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

    // Verify final text
    await expect(input).toHaveText('help me');

    // Single undo should restore empty state (all grouped together)
    await page.keyboard.press(`${MODIFIER_KEY}+z`);
    await waitForDelay(page, STATE_CHANGE_WAIT);

    await expect(input).toHaveText('');
  });
});
```

**Step 2: Build and run test**

Run: `yarn build:test && yarn e2e test/playwright/tests/modules/undo-redo.spec.ts -g "quick correction"`

Expected: PASS

**Step 3: Commit test**

```bash
git add test/playwright/tests/modules/undo-redo.spec.ts
git commit -m "test: add E2E test for quick corrections staying grouped"
```

---

## Task 5: Add E2E Test for Intentional Deletion Creating Separate Entry

**Files:**
- Modify: [undo-redo.spec.ts](test/playwright/tests/modules/undo-redo.spec.ts)

**Step 1: Add test for intentional deletion**

Add to the "edge Cases - Action Change Threshold" describe block:

```typescript
test('intentional deletion (type, delete 3+) creates separate entries', async ({ page }) => {
  await createBlok(page, {
    data: {
      blocks: [
        {
          type: 'paragraph',
          data: { text: '' },
        },
      ],
    },
  });

  const paragraph = page.locator(`${PARAGRAPH_SELECTOR}:first-of-type`);
  const input = paragraph.locator('[contenteditable="true"]');

  // Type "hello world"
  await input.click();
  await page.keyboard.type('hello world');
  await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

  // Delete 4 characters (above threshold) - " wor" -> "hello ld"
  // Actually deletes "dlro" backwards -> "hello w"
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

  // Verify current text
  await expect(input).toHaveText('hello w');

  // First undo should restore "hello world" (undo the deletion)
  await page.keyboard.press(`${MODIFIER_KEY}+z`);
  await waitForDelay(page, STATE_CHANGE_WAIT);

  await expect(input).toHaveText('hello world');

  // Second undo should restore empty state (undo the typing)
  await page.keyboard.press(`${MODIFIER_KEY}+z`);
  await waitForDelay(page, STATE_CHANGE_WAIT);

  await expect(input).toHaveText('');
});
```

**Step 2: Build and run test**

Run: `yarn build:test && yarn e2e test/playwright/tests/modules/undo-redo.spec.ts -g "intentional deletion"`

Expected: PASS

**Step 3: Commit test**

```bash
git add test/playwright/tests/modules/undo-redo.spec.ts
git commit -m "test: add E2E test for intentional deletion creating separate entries"
```

---

## Task 6: Add E2E Test for Threshold Reset After Checkpoint

**Files:**
- Modify: [undo-redo.spec.ts](test/playwright/tests/modules/undo-redo.spec.ts)

**Step 1: Add test for threshold reset**

Add to the "edge Cases - Action Change Threshold" describe block:

```typescript
test('threshold resets after checkpoint is created', async ({ page }) => {
  await createBlok(page, {
    data: {
      blocks: [
        {
          type: 'paragraph',
          data: { text: '' },
        },
      ],
    },
  });

  const paragraph = page.locator(`${PARAGRAPH_SELECTOR}:first-of-type`);
  const input = paragraph.locator('[contenteditable="true"]');

  // Type "abcdef"
  await input.click();
  await page.keyboard.type('abcdef');
  await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

  // Delete 3 chars (hits threshold) -> "abc"
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

  // Type "123"
  await page.keyboard.type('123');
  await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

  // Delete 3 chars again (hits threshold, counter was reset) -> "abc"
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

  // Current: "abc"
  await expect(input).toHaveText('abc');

  // Undo 1: restore "abc123"
  await page.keyboard.press(`${MODIFIER_KEY}+z`);
  await waitForDelay(page, STATE_CHANGE_WAIT);
  await expect(input).toHaveText('abc123');

  // Undo 2: restore "abc"
  await page.keyboard.press(`${MODIFIER_KEY}+z`);
  await waitForDelay(page, STATE_CHANGE_WAIT);
  await expect(input).toHaveText('abc');

  // Undo 3: restore "abcdef"
  await page.keyboard.press(`${MODIFIER_KEY}+z`);
  await waitForDelay(page, STATE_CHANGE_WAIT);
  await expect(input).toHaveText('abcdef');

  // Undo 4: restore empty
  await page.keyboard.press(`${MODIFIER_KEY}+z`);
  await waitForDelay(page, STATE_CHANGE_WAIT);
  await expect(input).toHaveText('');
});
```

**Step 2: Build and run test**

Run: `yarn build:test && yarn e2e test/playwright/tests/modules/undo-redo.spec.ts -g "threshold resets"`

Expected: PASS

**Step 3: Commit test**

```bash
git add test/playwright/tests/modules/undo-redo.spec.ts
git commit -m "test: add E2E test for threshold reset after checkpoint"
```

---

## Task 7: Add E2E Test for Immediate Actions Ignoring Threshold

**Files:**
- Modify: [undo-redo.spec.ts](test/playwright/tests/modules/undo-redo.spec.ts)

**Step 1: Add test for immediate actions**

Add to the "edge Cases - Action Change Threshold" describe block:

```typescript
test('immediate actions (paste, format) ignore threshold and checkpoint immediately', async ({ page }) => {
  await createBlok(page, {
    data: {
      blocks: [
        {
          type: 'paragraph',
          data: { text: '' },
        },
      ],
    },
  });

  const paragraph = page.locator(`${PARAGRAPH_SELECTOR}:first-of-type`);
  const input = paragraph.locator('[contenteditable="true"]');

  // Type "hello"
  await input.click();
  await page.keyboard.type('hello');

  // Delete 1 char (below threshold)
  await page.keyboard.press('Backspace');

  // Apply bold (immediate action - should checkpoint before)
  await page.keyboard.press(`${MODIFIER_KEY}+a`);
  await page.keyboard.press(`${MODIFIER_KEY}+b`);
  await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

  // Verify bold applied
  // eslint-disable-next-line internal-playwright/no-css-selectors
  const boldText = input.locator('b, strong');
  await expect(boldText).toHaveText('hell');

  // Undo 1: remove bold
  await page.keyboard.press(`${MODIFIER_KEY}+z`);
  await waitForDelay(page, STATE_CHANGE_WAIT);

  // eslint-disable-next-line internal-playwright/no-css-selectors
  const boldAfterUndo = input.locator('b, strong');
  await expect(boldAfterUndo).toHaveCount(0);
  await expect(input).toHaveText('hell');

  // Undo 2: restore typing + deletion (grouped since below threshold)
  await page.keyboard.press(`${MODIFIER_KEY}+z`);
  await waitForDelay(page, STATE_CHANGE_WAIT);
  await expect(input).toHaveText('');
});
```

**Step 2: Build and run test**

Run: `yarn build:test && yarn e2e test/playwright/tests/modules/undo-redo.spec.ts -g "immediate actions"`

Expected: PASS

**Step 3: Commit test**

```bash
git add test/playwright/tests/modules/undo-redo.spec.ts
git commit -m "test: add E2E test for immediate actions ignoring threshold"
```

---

## Task 8: Run Full Test Suite and Verify

**Step 1: Run linting**

Run: `yarn lint`

Expected: PASS (no errors)

**Step 2: Run all unit tests**

Run: `yarn test`

Expected: PASS

**Step 3: Build for E2E**

Run: `yarn build:test`

Expected: Build succeeds

**Step 4: Run all E2E undo/redo tests**

Run: `yarn e2e test/playwright/tests/modules/undo-redo.spec.ts`

Expected: All tests PASS

**Step 5: Run full E2E suite (smoke test)**

Run: `yarn e2e --grep @smoke`

Expected: All smoke tests PASS

**Step 6: Final commit with all tests passing**

```bash
git add -A
git commit -m "feat: hybrid action-change grouping for undo/redo

Reduces overly granular undo entries by implementing a threshold-based
checkpoint strategy. When action type changes (insert ↔ delete), the
system now waits until 3+ characters of the new action type before
creating a checkpoint. Quick corrections stay grouped with previous
actions.

- Add ACTION_CHANGE_THRESHOLD constant (3)
- Track pendingActionCount in SmartGrouping
- Reset counter on checkpoint creation and debounce expiry
- Immediate actions (format, paste, cut) still checkpoint immediately
- Block changes still checkpoint immediately"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add threshold constant and state | smart-grouping.ts, smart-grouping.test.ts |
| 2 | Implement threshold logic | smart-grouping.ts |
| 3 | Integrate reset into History | history.ts |
| 4 | E2E: quick corrections grouped | undo-redo.spec.ts |
| 5 | E2E: intentional deletion separate | undo-redo.spec.ts |
| 6 | E2E: threshold resets | undo-redo.spec.ts |
| 7 | E2E: immediate actions ignore threshold | undo-redo.spec.ts |
| 8 | Full test suite verification | - |
