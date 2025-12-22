# Plus Button Slash Paragraph Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Change the "+" button to insert a paragraph with "/" instead of directly opening the toolbox popover.

**Architecture:** Modify `plusButtonClicked()` in toolbar module to insert/reuse a paragraph block, add "/" character, position caret after it, then open the toolbox.

**Tech Stack:** TypeScript, Playwright for E2E tests

---

### Task 1: Write E2E tests for new plus button behavior

**Files:**
- Create: `test/playwright/tests/ui/plus-button-slash.spec.ts`

**Step 1: Create test file with test cases**

```typescript
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable]`;
const PLUS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`;
const TOOLBOX_POPOVER_SELECTOR = '[data-blok-testid="toolbox-popover"] [data-blok-testid="popover-container"]';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlokWithBlocks = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokBlocks }) => {
      const blok = new window.Blok({
        holder,
        data: { blocks: blokBlocks },
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blocks }
  );
};

test.describe('plus button inserts slash paragraph', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('clicking plus button on block with content creates new paragraph with "/" below', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: 'Hello world' } },
    ]);

    const firstBlock = page.locator(BLOCK_SELECTOR).first();

    await firstBlock.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await expect(plusButton).toBeVisible();
    await plusButton.click();

    // Should have 2 blocks now
    await expect(page.locator(BLOCK_SELECTOR)).toHaveCount(2);

    // Second block should be a paragraph with "/"
    const secondParagraph = page.locator(PARAGRAPH_SELECTOR).nth(1);

    await expect(secondParagraph).toHaveText('/');

    // Toolbox should be open
    await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();
  });

  test('clicking plus button on empty paragraph reuses it and inserts "/"', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: '' } },
    ]);

    const block = page.locator(BLOCK_SELECTOR);

    await block.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await expect(plusButton).toBeVisible();
    await plusButton.click();

    // Should still have 1 block (reused the empty paragraph)
    await expect(page.locator(BLOCK_SELECTOR)).toHaveCount(1);

    // Block should now contain "/"
    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await expect(paragraph).toHaveText('/');

    // Toolbox should be open
    await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();
  });

  test('clicking plus button on empty header creates new paragraph with "/" below', async ({ page }) => {
    await createBlokWithBlocks(page, [
      { type: 'header', data: { text: '', level: 2 } },
    ]);

    const block = page.locator(BLOCK_SELECTOR);

    await block.hover();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await expect(plusButton).toBeVisible();
    await plusButton.click();

    // Should have 2 blocks now (header + new paragraph)
    await expect(page.locator(BLOCK_SELECTOR)).toHaveCount(2);

    // Second block should be a paragraph with "/"
    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await expect(paragraph).toHaveText('/');

    // Toolbox should be open
    await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `yarn e2e test/playwright/tests/ui/plus-button-slash.spec.ts`

Expected: Tests FAIL (current behavior opens toolbox directly without inserting "/")

**Step 3: Commit the failing tests**

```bash
git add test/playwright/tests/ui/plus-button-slash.spec.ts
git commit -m "test: add failing E2E tests for plus button slash paragraph"
```

---

### Task 2: Implement the new plusButtonClicked behavior

**Files:**
- Modify: `src/components/modules/toolbar/index.ts:864-896`

**Step 1: Update the plusButtonClicked method**

Find the `plusButtonClicked` method (around line 864) and replace its implementation:

```typescript
/**
 * Handler for Plus Button
 * Inserts a paragraph with "/" and opens the toolbox
 */
private plusButtonClicked(): void {
  const { BlockManager, Caret, Toolbar } = this.Blok;

  /**
   * We need to update Current Block because user can click on the Plus Button (thanks to appearing by hover) without any clicks on blok
   * In this case currentBlock will point last block
   */
  if (this.hoveredBlock) {
    BlockManager.currentBlock = this.hoveredBlock;
  }

  /**
   * Close Block Settings if opened, similar to how settings toggler closes toolbox
   */
  if (this.Blok.BlockSettings.opened) {
    this.Blok.BlockSettings.close();
  }

  /**
   * Clear block selection when plus button is clicked
   * This allows users to add new blocks even when multiple blocks are selected
   */
  if (this.Blok.BlockSelection.anyBlockSelected) {
    this.Blok.BlockSelection.clearSelection();
  }

  /**
   * Remove native text selection that may have been created during cross-block selection
   * This needs to happen regardless of anyBlockSelected state, as cross-block selection
   * via Shift+Arrow creates native text selection that spans multiple blocks
   */
  SelectionUtils.get()?.removeAllRanges();

  /**
   * Determine the target block for inserting "/"
   * If hovered block is an empty paragraph, reuse it; otherwise create a new one below
   */
  const hoveredBlock = this.hoveredBlock;
  const isEmptyParagraph = hoveredBlock !== undefined &&
    hoveredBlock.isEmpty &&
    hoveredBlock.name === 'paragraph';

  let targetBlock: Block;

  if (isEmptyParagraph) {
    targetBlock = hoveredBlock;
  } else {
    const insertIndex = hoveredBlock !== undefined
      ? BlockManager.getBlockIndex(hoveredBlock) + 1
      : BlockManager.currentBlockIndex + 1;

    targetBlock = BlockManager.insertDefaultBlockAtIndex(insertIndex, true);
  }

  /**
   * Focus the target block and insert "/"
   */
  Caret.setToBlock(targetBlock, Caret.positions.START);
  Caret.insertContentAtCaretPosition('/');

  /**
   * Move toolbar to the new block and open the toolbox
   */
  Toolbar.moveAndOpen();
  this.toolboxInstance?.open();
}
```

**Step 2: Add Block import if not present**

At the top of the file, ensure Block is imported. Find the existing imports from `../block` and verify `Block` is included:

```typescript
import { Block } from '../block';
```

**Step 3: Run type check**

Run: `yarn lint:types`

Expected: PASS (no type errors)

**Step 4: Run the E2E tests**

Run: `yarn build:test && yarn e2e test/playwright/tests/ui/plus-button-slash.spec.ts`

Expected: All 3 tests PASS

**Step 5: Run full E2E suite to check for regressions**

Run: `yarn e2e`

Expected: All tests PASS

**Step 6: Commit the implementation**

```bash
git add src/components/modules/toolbar/index.ts
git commit -m "feat(toolbar): plus button inserts paragraph with slash

Change the '+' button behavior to insert a paragraph with '/' pre-filled
instead of directly opening the toolbox popover. If the hovered block is
an empty paragraph, reuse it instead of creating a new one."
```

---

### Task 3: Update existing tests that may be affected

**Files:**
- Potentially modify: `test/playwright/tests/ui/plus-block-tunes-interaction.spec.ts`

**Step 1: Run the related test file**

Run: `yarn e2e test/playwright/tests/ui/plus-block-tunes-interaction.spec.ts`

If tests pass, skip to Task 4. If tests fail, continue.

**Step 2: Update tests to account for new behavior**

The test "opens toolbox after opening block tunes via toolbar" clicks the plus button and expects the toolbox to open. With the new behavior, it should still work but the empty paragraph will now contain "/".

If test fails, update the assertion to expect the paragraph to contain "/" after clicking plus button.

**Step 3: Run the test again**

Run: `yarn e2e test/playwright/tests/ui/plus-block-tunes-interaction.spec.ts`

Expected: PASS

**Step 4: Commit any test updates**

```bash
git add test/playwright/tests/ui/plus-block-tunes-interaction.spec.ts
git commit -m "test: update plus button tests for new slash behavior"
```

---

### Task 4: Final verification

**Step 1: Run linting**

Run: `yarn lint`

Expected: PASS

**Step 2: Run full E2E test suite**

Run: `yarn e2e`

Expected: All tests PASS

**Step 3: Manual verification**

Run: `yarn serve`

Test manually:
1. Click "+" on a block with content → new paragraph with "/" appears below, toolbox opens
2. Click "+" on empty paragraph → "/" inserted into it, toolbox opens
3. Click "+" on empty header → new paragraph with "/" appears below, toolbox opens
4. Type in search, select a tool → works as expected
