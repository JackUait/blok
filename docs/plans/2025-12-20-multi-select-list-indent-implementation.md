# Multi-Select List Item Indent/Outdent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When multiple list items are selected, Tab/Shift+Tab indents/outdents all of them together as a single operation.

**Architecture:** Intercept Tab key in `BlockEvents.keydown()` when blocks are selected. Validate all selected blocks are list items and can be indented/outdented. Update all blocks atomically.

**Tech Stack:** TypeScript, Playwright for E2E tests

---

## Task 1: Add E2E Tests for Multi-Select List Indent

**Files:**
- Modify: `test/playwright/tests/tools/list.spec.ts`

**Step 1: Add test describe block and helper**

Add a new test describe block for multi-select indent/outdent tests at the end of the file (before the final closing `});`):

```typescript
  test.describe('multi-select indent/outdent', () => {
    /**
     * Helper to select multiple blocks by their indices using Shift+ArrowDown.
     * Clicks on the first block, then uses Shift+Down to extend selection.
     */
    const selectBlocksRange = async (page: Page, startIndex: number, endIndex: number): Promise<void> => {
      const startBlock = page.locator(LIST_BLOCK_SELECTOR).nth(startIndex).locator('[contenteditable="true"]');
      await startBlock.click();

      // Use Cmd+A twice to select the block, then Shift+Down to extend
      await page.keyboard.press('Meta+a');
      await page.keyboard.press('Meta+a');

      const stepsDown = endIndex - startIndex;
      for (let i = 0; i < stepsDown; i++) {
        await page.keyboard.press('Shift+ArrowDown');
      }
    };

    test('tab indents all selected list items when all are at valid depth', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First item' },
          { text: 'Second item' },
          { text: 'Third item' },
        ]),
      });

      // Select second and third items
      await selectBlocksRange(page, 1, 2);

      // Verify blocks are selected
      await expect(page.locator(LIST_BLOCK_SELECTOR).nth(1)).toHaveAttribute('data-blok-selected', 'true');
      await expect(page.locator(LIST_BLOCK_SELECTOR).nth(2)).toHaveAttribute('data-blok-selected', 'true');

      // Press Tab to indent
      await page.keyboard.press('Tab');

      // Verify both items are now at depth 1
      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[1].data.depth).toBe(1);
      expect(savedData?.blocks[2].data.depth).toBe(1);
    });

    test('shift+tab outdents all selected list items', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First item' },
          { text: 'Second item', depth: 1 },
          { text: 'Third item', depth: 1 },
        ]),
      });

      // Select second and third items (both at depth 1)
      await selectBlocksRange(page, 1, 2);

      // Press Shift+Tab to outdent
      await page.keyboard.press('Shift+Tab');

      // Verify both items are now at depth 0
      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[1].data.depth ?? 0).toBe(0);
      expect(savedData?.blocks[2].data.depth ?? 0).toBe(0);
    });

    test('tab does nothing when any selected item cannot be indented', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First item' },
          { text: 'Second item' },
          { text: 'Third item' },
        ]),
      });

      // Select first and second items (first cannot be indented - no previous list item)
      await selectBlocksRange(page, 0, 1);

      // Press Tab - should do nothing because first item can't indent
      await page.keyboard.press('Tab');

      // Verify neither item was indented
      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].data.depth ?? 0).toBe(0);
      expect(savedData?.blocks[1].data.depth ?? 0).toBe(0);
    });

    test('shift+tab does nothing when any selected item is at depth 0', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First item' },
          { text: 'Second item', depth: 1 },
          { text: 'Third item' },  // depth 0
        ]),
      });

      // Select second and third items (third is at depth 0)
      await selectBlocksRange(page, 1, 2);

      // Press Shift+Tab - should do nothing because third item can't outdent
      await page.keyboard.press('Shift+Tab');

      // Verify neither item changed
      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[1].data.depth).toBe(1);
      expect(savedData?.blocks[2].data.depth ?? 0).toBe(0);
    });

    test('tab does nothing when selection includes non-list blocks', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            { id: 'list-1', type: 'list', data: { text: 'List item', style: 'unordered' } },
            { id: 'para-1', type: 'paragraph', data: { text: 'Paragraph' } },
          ],
        },
      });

      // Select both blocks (mixed types)
      const listItem = page.locator(LIST_BLOCK_SELECTOR).first().locator('[contenteditable="true"]');
      await listItem.click();
      await page.keyboard.press('Meta+a');
      await page.keyboard.press('Meta+a');
      await page.keyboard.press('Shift+ArrowDown');

      // Press Tab - should do nothing because selection includes paragraph
      await page.keyboard.press('Tab');

      // Verify list item was not indented
      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].data.depth ?? 0).toBe(0);
    });

    test('selection is preserved after indent', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createListItems([
          { text: 'First item' },
          { text: 'Second item' },
          { text: 'Third item' },
        ]),
      });

      // Select second and third items
      await selectBlocksRange(page, 1, 2);

      // Press Tab to indent
      await page.keyboard.press('Tab');

      // Verify blocks are still selected
      await expect(page.locator(LIST_BLOCK_SELECTOR).nth(1)).toHaveAttribute('data-blok-selected', 'true');
      await expect(page.locator(LIST_BLOCK_SELECTOR).nth(2)).toHaveAttribute('data-blok-selected', 'true');
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `yarn e2e test/playwright/tests/tools/list.spec.ts -g "multi-select indent"`

Expected: Tests should fail because the feature is not implemented yet.

**Step 3: Commit the failing tests**

```bash
git add test/playwright/tests/tools/list.spec.ts
git commit -m "test: add E2E tests for multi-select list indent/outdent"
```

---

## Task 2: Add Helper Methods to BlockEvents

**Files:**
- Modify: `src/components/modules/blockEvents.ts`

**Step 1: Add the areAllSelectedBlocksListItems helper method**

Add this private method to the `BlockEvents` class (before the `keydown` method):

```typescript
  /**
   * Tool name for list items
   */
  private static readonly LIST_TOOL_NAME = 'list';

  /**
   * Check if all selected blocks are list items.
   * @returns true if all selected blocks are list items, false otherwise
   */
  private areAllSelectedBlocksListItems(): boolean {
    const { BlockSelection } = this.Blok;
    const selectedBlocks = BlockSelection.selectedBlocks;

    if (selectedBlocks.length === 0) {
      return false;
    }

    return selectedBlocks.every((block) => block.name === BlockEvents.LIST_TOOL_NAME);
  }
```

**Step 2: Add the getBlockDepth helper method**

Add this private method:

```typescript
  /**
   * Indentation padding per depth level in pixels (matches ListItem.INDENT_PER_LEVEL)
   */
  private static readonly INDENT_PER_LEVEL = 24;

  /**
   * Get the depth of a list block by reading from its DOM.
   * @param block - the block to get depth from
   * @returns depth value (0 if not found or not a list)
   */
  private getListBlockDepth(block: Block): number {
    const blockHolder = block.holder;
    const listItemEl = blockHolder?.querySelector('[role="listitem"]');
    const styleAttr = listItemEl?.getAttribute('style');

    const marginMatch = styleAttr?.match(/margin-left:\s*(\d+)px/);

    return marginMatch ? Math.round(parseInt(marginMatch[1], 10) / BlockEvents.INDENT_PER_LEVEL) : 0;
  }
```

**Step 3: Add the canIndentSelectedListItems helper method**

Add this private method:

```typescript
  /**
   * Check if all selected list items can be indented.
   * Each item must have a previous list item, and its depth must be <= previous item's depth.
   * @returns true if all selected items can be indented
   */
  private canIndentSelectedListItems(): boolean {
    const { BlockSelection, BlockManager } = this.Blok;
    const selectedBlocks = BlockSelection.selectedBlocks;

    for (const block of selectedBlocks) {
      const blockIndex = BlockManager.getBlockIndex(block);

      if (blockIndex === undefined || blockIndex === 0) {
        return false; // First block or unknown index cannot be indented
      }

      const previousBlock = BlockManager.getBlockByIndex(blockIndex - 1);

      if (!previousBlock || previousBlock.name !== BlockEvents.LIST_TOOL_NAME) {
        return false; // Previous block must be a list item
      }

      const currentDepth = this.getListBlockDepth(block);
      const previousDepth = this.getListBlockDepth(previousBlock);

      // Can only indent to at most one level deeper than previous item
      if (currentDepth > previousDepth) {
        return false;
      }
    }

    return true;
  }
```

**Step 4: Add the canOutdentSelectedListItems helper method**

Add this private method:

```typescript
  /**
   * Check if all selected list items can be outdented.
   * Each item must have depth > 0.
   * @returns true if all selected items can be outdented
   */
  private canOutdentSelectedListItems(): boolean {
    const { BlockSelection } = this.Blok;
    const selectedBlocks = BlockSelection.selectedBlocks;

    for (const block of selectedBlocks) {
      const currentDepth = this.getListBlockDepth(block);

      if (currentDepth === 0) {
        return false; // Can't outdent if already at root level
      }
    }

    return true;
  }
```

**Step 5: Run TypeScript type check**

Run: `yarn lint:types`

Expected: No type errors

**Step 6: Commit helper methods**

```bash
git add src/components/modules/blockEvents.ts
git commit -m "feat: add helper methods for multi-select list indent validation"
```

---

## Task 3: Implement the Indent/Outdent Logic

**Files:**
- Modify: `src/components/modules/blockEvents.ts`

**Step 1: Add the indentSelectedListItems method**

Add this private method:

```typescript
  /**
   * Indent all selected list items by one level.
   * Updates each block's depth and triggers re-render.
   */
  private async indentSelectedListItems(): Promise<void> {
    const { BlockSelection, BlockManager } = this.Blok;
    const selectedBlocks = BlockSelection.selectedBlocks;

    // Sort blocks by index to process in document order
    const sortedBlocks = [...selectedBlocks].sort((a, b) => {
      const indexA = BlockManager.getBlockIndex(a) ?? 0;
      const indexB = BlockManager.getBlockIndex(b) ?? 0;

      return indexA - indexB;
    });

    for (const block of sortedBlocks) {
      const currentDepth = this.getListBlockDepth(block);
      const newDepth = currentDepth + 1;

      // Get current block data and update depth
      const savedData = await block.save();

      await this.Blok.BlockManager.update(block, block.name, {
        ...savedData,
        depth: newDepth,
      });

      // Re-select the block after update
      block.selected = true;
    }

    BlockSelection.clearCache();
  }
```

**Step 2: Add the outdentSelectedListItems method**

Add this private method:

```typescript
  /**
   * Outdent all selected list items by one level.
   * Updates each block's depth and triggers re-render.
   */
  private async outdentSelectedListItems(): Promise<void> {
    const { BlockSelection, BlockManager } = this.Blok;
    const selectedBlocks = BlockSelection.selectedBlocks;

    // Sort blocks by index to process in document order
    const sortedBlocks = [...selectedBlocks].sort((a, b) => {
      const indexA = BlockManager.getBlockIndex(a) ?? 0;
      const indexB = BlockManager.getBlockIndex(b) ?? 0;

      return indexA - indexB;
    });

    for (const block of sortedBlocks) {
      const currentDepth = this.getListBlockDepth(block);
      const newDepth = Math.max(0, currentDepth - 1);

      // Get current block data and update depth
      const savedData = await block.save();

      await this.Blok.BlockManager.update(block, block.name, {
        ...savedData,
        depth: newDepth,
      });

      // Re-select the block after update
      block.selected = true;
    }

    BlockSelection.clearCache();
  }
```

**Step 3: Add the handleSelectedBlocksIndent method**

Add this private method:

```typescript
  /**
   * Handles Tab/Shift+Tab for multi-selected list items.
   * @param event - keyboard event
   * @returns true if the event was handled, false to fall through to default behavior
   */
  private handleSelectedBlocksIndent(event: KeyboardEvent): boolean {
    const { BlockSelection } = this.Blok;

    // Only handle when blocks are selected
    if (!BlockSelection.anyBlockSelected) {
      return false;
    }

    // Only handle if all selected blocks are list items
    if (!this.areAllSelectedBlocksListItems()) {
      return false;
    }

    const isOutdent = event.shiftKey;

    if (isOutdent) {
      // Check if all items can be outdented
      if (!this.canOutdentSelectedListItems()) {
        event.preventDefault();

        return true; // Handled (by doing nothing)
      }

      event.preventDefault();
      void this.outdentSelectedListItems();

      return true;
    } else {
      // Check if all items can be indented
      if (!this.canIndentSelectedListItems()) {
        event.preventDefault();

        return true; // Handled (by doing nothing)
      }

      event.preventDefault();
      void this.indentSelectedListItems();

      return true;
    }
  }
```

**Step 4: Run TypeScript type check**

Run: `yarn lint:types`

Expected: No type errors

**Step 5: Commit indent/outdent logic**

```bash
git add src/components/modules/blockEvents.ts
git commit -m "feat: implement multi-select list indent/outdent logic"
```

---

## Task 4: Wire Up the Handler in keydown

**Files:**
- Modify: `src/components/modules/blockEvents.ts`

**Step 1: Add Tab handling for selected blocks in the keydown method**

Find the switch statement in `keydown()` that handles `keyCodes.TAB`:

```typescript
      case keyCodes.TAB:
        this.tabPressed(event);
        break;
```

Replace it with:

```typescript
      case keyCodes.TAB:
        if (this.handleSelectedBlocksIndent(event)) {
          return;
        }
        this.tabPressed(event);
        break;
```

**Step 2: Run TypeScript type check**

Run: `yarn lint:types`

Expected: No type errors

**Step 3: Run lint**

Run: `yarn lint`

Expected: No lint errors

**Step 4: Commit wiring**

```bash
git add src/components/modules/blockEvents.ts
git commit -m "feat: wire up multi-select indent handler in keydown"
```

---

## Task 5: Build and Run E2E Tests

**Files:**
- None (build and test)

**Step 1: Build the test bundle**

Run: `yarn build:test`

Expected: Build succeeds

**Step 2: Run the multi-select E2E tests**

Run: `yarn e2e test/playwright/tests/tools/list.spec.ts -g "multi-select indent"`

Expected: All tests pass

**Step 3: Run all list tests to ensure no regressions**

Run: `yarn e2e test/playwright/tests/tools/list.spec.ts`

Expected: All tests pass

**Step 4: Run the Tab tests to ensure no regressions**

Run: `yarn e2e test/playwright/tests/modules/BlockEvents/Tab.spec.ts`

Expected: All tests pass

**Step 5: Commit if any test adjustments needed**

If tests needed adjustment:
```bash
git add -A
git commit -m "fix: adjust tests for multi-select indent feature"
```

---

## Task 6: Final Verification

**Step 1: Run full lint**

Run: `yarn lint`

Expected: No errors

**Step 2: Run full E2E test suite**

Run: `yarn e2e`

Expected: All tests pass

**Step 3: Manual verification (optional)**

Run: `yarn serve`

1. Create a list with 3+ items
2. Click on second item, press Cmd+A twice, then Shift+Down to select 2nd and 3rd items
3. Press Tab - both should indent
4. Press Shift+Tab - both should outdent
5. Select first and second items, press Tab - nothing should happen (first can't indent)

---

## Summary of Changes

| File | Type | Description |
|------|------|-------------|
| `test/playwright/tests/tools/list.spec.ts` | Modify | Add E2E tests for multi-select indent/outdent |
| `src/components/modules/blockEvents.ts` | Modify | Add helper methods and indent/outdent handler |
