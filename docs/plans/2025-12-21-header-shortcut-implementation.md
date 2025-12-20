# Header Shortcut Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to type `#`, `##`, `###`, etc. followed by a space to create headers of different levels, matching the list shortcut pattern.

**Architecture:** Add a header shortcut handler in `blockEvents.ts` that mirrors the existing list shortcut implementation. The handler matches a regex pattern, validates the level against the Header tool's config, then uses `BlockManager.replace()` to convert the paragraph.

**Tech Stack:** TypeScript, Playwright for E2E tests

---

## Task 1: Add Header Pattern Regex

**Files:**
- Modify: `src/components/modules/blockEvents.ts:464` (after UNORDERED_LIST_PATTERN)

**Step 1: Add the regex pattern**

Add after line 464 (after `UNORDERED_LIST_PATTERN`):

```typescript
/**
 * Regex pattern for detecting header shortcuts.
 * Matches patterns like "# ", "## ", "### " etc. at the start of text (1-6 hashes)
 * Captures remaining content after the shortcut in group 2
 */
private static readonly HEADER_PATTERN = /^(#{1,6})\s([\s\S]*)$/;
```

**Step 2: Verify no syntax errors**

Run: `yarn lint:types`
Expected: No errors related to blockEvents.ts

**Step 3: Commit**

```bash
git add src/components/modules/blockEvents.ts
git commit -m "feat(shortcuts): add header pattern regex"
```

---

## Task 2: Add Header Tool Name Constant

**Files:**
- Modify: `src/components/modules/blockEvents.ts:47` (after LIST_TOOL_NAME)

**Step 1: Add the constant**

Add after line 47 (after `LIST_TOOL_NAME`):

```typescript
/**
 * Tool name for headers
 */
private static readonly HEADER_TOOL_NAME = 'header';
```

**Step 2: Verify no syntax errors**

Run: `yarn lint:types`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/modules/blockEvents.ts
git commit -m "feat(shortcuts): add header tool name constant"
```

---

## Task 3: Implement handleHeaderShortcut Method

**Files:**
- Modify: `src/components/modules/blockEvents.ts` (after `handleListShortcut` method, around line 632)

**Step 1: Add the handler method**

Add after the `handleListShortcut` method (after line 632):

```typescript
/**
 * Check if current block content matches a header shortcut pattern
 * and convert to appropriate header level.
 * Supports conversion even when there's existing text after the shortcut.
 * Preserves HTML content and maintains caret position.
 */
private handleHeaderShortcut(): void {
  const { BlockManager, Tools } = this.Blok;
  const currentBlock = BlockManager.currentBlock;

  if (!currentBlock) {
    return;
  }

  /**
   * Only convert default blocks (paragraphs)
   */
  if (!currentBlock.tool.isDefault) {
    return;
  }

  /**
   * Check if header tool is available
   */
  const headerTool = Tools.blockTools.get(BlockEvents.HEADER_TOOL_NAME);

  if (!headerTool) {
    return;
  }

  const currentInput = currentBlock.currentInput;

  if (!currentInput) {
    return;
  }

  /**
   * Use textContent to match the shortcut pattern
   */
  const textContent = currentInput.textContent || '';

  /**
   * Check for header pattern (e.g., "# ", "## ", "### ")
   */
  const headerMatch = BlockEvents.HEADER_PATTERN.exec(textContent);

  if (!headerMatch) {
    return;
  }

  /**
   * Extract header level from the number of # characters
   */
  const level = headerMatch[1].length;

  /**
   * Check if the level is enabled in the Header tool's config
   * If levels config is not specified, all levels (1-6) are allowed
   */
  const headerSettings = headerTool.settings as { levels?: number[] };
  const allowedLevels = headerSettings.levels;

  if (allowedLevels && !allowedLevels.includes(level)) {
    return;
  }

  /**
   * Get the depth from the block holder if it was previously nested
   * This preserves nesting when converting
   */
  const depthAttr = currentBlock.holder.getAttribute('data-blok-depth');
  const depth = depthAttr ? parseInt(depthAttr, 10) : 0;

  /**
   * Extract remaining content and calculate shortcut length
   * Shortcut length: number of # characters + " " = level + 1
   */
  const shortcutLength = level + 1;
  const remainingHtml = this.extractRemainingHtml(currentInput, shortcutLength);
  const caretOffset = this.getCaretOffset(currentInput) - shortcutLength;

  /**
   * Build header data
   */
  const headerData: { text: string; level: number; depth?: number } = {
    text: remainingHtml,
    level,
  };

  // Preserve depth if the block was previously nested
  if (depth > 0) {
    headerData.depth = depth;
  }

  const newBlock = BlockManager.replace(currentBlock, BlockEvents.HEADER_TOOL_NAME, headerData);

  this.setCaretAfterConversion(newBlock, caretOffset);
}
```

**Step 2: Verify no syntax errors**

Run: `yarn lint:types`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/modules/blockEvents.ts
git commit -m "feat(shortcuts): implement handleHeaderShortcut method"
```

---

## Task 4: Call Header Handler from Input Method

**Files:**
- Modify: `src/components/modules/blockEvents.ts:479` (in the `input` method)

**Step 1: Add the handler call**

Modify the `input` method (around line 471-480) to call both handlers:

```typescript
/**
 * Input event handler for Block
 * Detects markdown-like shortcuts for auto-converting to lists or headers
 * @param {InputEvent} event - input event
 */
public input(event: InputEvent): void {
  /**
   * Only handle insertText events (typing) that end with a space
   */
  if (event.inputType !== 'insertText' || event.data !== ' ') {
    return;
  }

  this.handleListShortcut();
  this.handleHeaderShortcut();
}
```

**Step 2: Verify no syntax errors**

Run: `yarn lint:types`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/modules/blockEvents.ts
git commit -m "feat(shortcuts): wire up header shortcut in input handler"
```

---

## Task 5: Write E2E Test - Basic Header Conversions

**Files:**
- Create: `test/playwright/tests/tools/header-shortcut.spec.ts`

**Step 1: Create the test file with basic conversion tests**

```typescript
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const HEADER_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="header"]`;
const PARAGRAPH_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="paragraph"]`;

type SerializableToolConfig = {
  className?: string;
  config?: Record<string, unknown>;
  inlineToolbar?: boolean | string[];
};

type CreateBlokOptions = {
  data?: OutputData;
  tools?: Record<string, SerializableToolConfig>;
};

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

const createBlok = async (page: Page, options: CreateBlokOptions = {}): Promise<void> => {
  const { data = null, tools = {} } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  const serializedTools = Object.entries(tools).map(([name, tool]) => ({
    name,
    className: tool.className ?? null,
    config: tool.config ?? {},
    inlineToolbar: tool.inlineToolbar,
  }));

  await page.evaluate(
    async ({ holder, data: initialData, serializedTools: toolsConfig }) => {
      const blokConfig: Record<string, unknown> = {
        holder: holder,
      };

      if (initialData) {
        blokConfig.data = initialData;
      }

      if (toolsConfig.length > 0) {
        const resolvedTools = toolsConfig.reduce<
          Record<string, { class: unknown; inlineToolbar?: boolean | string[] } & Record<string, unknown>>
        >((accumulator, { name, className, config, inlineToolbar: toolInlineToolbar }) => {
          let toolClass: unknown = null;

          if (className) {
            toolClass = className.split('.').reduce(
              (obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key],
              window
            ) ?? null;
          }

          if (!toolClass) {
            throw new Error(`Tool "${name}" is not available globally`);
          }

          const toolConfig: { class: unknown; inlineToolbar?: boolean | string[] } & Record<string, unknown> = {
            class: toolClass,
            ...config,
          };

          if (toolInlineToolbar !== undefined) {
            toolConfig.inlineToolbar = toolInlineToolbar;
          }

          return {
            ...accumulator,
            [name]: toolConfig,
          };
        }, {});

        blokConfig.tools = resolvedTools;
      }

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      data,
      serializedTools,
    }
  );
};

const defaultTools: Record<string, SerializableToolConfig> = {
  header: {
    className: 'Blok.Header',
    inlineToolbar: true,
  },
};

test.describe('header shortcut', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('basic conversions', () => {
    test('converts "# " to H1', async ({ page }) => {
      await createBlok(page, { tools: defaultTools });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();
      await page.keyboard.type('# ');

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);
      await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toHaveCount(0);

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].type).toBe('header');
      expect(savedData?.blocks[0].data.level).toBe(1);
    });

    test('converts "## " to H2', async ({ page }) => {
      await createBlok(page, { tools: defaultTools });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();
      await page.keyboard.type('## ');

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].data.level).toBe(2);
    });

    test('converts "### " to H3', async ({ page }) => {
      await createBlok(page, { tools: defaultTools });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();
      await page.keyboard.type('### ');

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].data.level).toBe(3);
    });

    test('converts "#### " to H4', async ({ page }) => {
      await createBlok(page, { tools: defaultTools });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();
      await page.keyboard.type('#### ');

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].data.level).toBe(4);
    });

    test('converts "##### " to H5', async ({ page }) => {
      await createBlok(page, { tools: defaultTools });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();
      await page.keyboard.type('##### ');

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].data.level).toBe(5);
    });

    test('converts "###### " to H6', async ({ page }) => {
      await createBlok(page, { tools: defaultTools });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();
      await page.keyboard.type('###### ');

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].data.level).toBe(6);
    });
  });
});
```

**Step 2: Build the test bundle**

Run: `yarn build:test`
Expected: Build completes successfully

**Step 3: Run the test to verify it fails (TDD - we haven't implemented yet, but we have)**

Run: `yarn e2e test/playwright/tests/tools/header-shortcut.spec.ts --project=chromium`
Expected: Tests pass (since we already implemented the feature)

**Step 4: Commit**

```bash
git add test/playwright/tests/tools/header-shortcut.spec.ts
git commit -m "test(shortcuts): add basic header shortcut conversion tests"
```

---

## Task 6: Add Content Preservation Tests

**Files:**
- Modify: `test/playwright/tests/tools/header-shortcut.spec.ts`

**Step 1: Add content preservation tests**

Add after the `basic conversions` describe block:

```typescript
test.describe('content preservation', () => {
  test('preserves text after shortcut when converting', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            id: 'test-para',
            type: 'paragraph',
            data: { text: 'Hello World' },
          },
        ],
      },
    });

    const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
    await paragraph.click();

    // Move cursor to start
    await page.evaluate(() => {
      const para = document.querySelector('[data-blok-tool="paragraph"]');
      if (para) {
        const range = document.createRange();
        const selection = window.getSelection();
        range.setStart(para, 0);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    });

    await page.keyboard.type('## ');

    await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

    const headerContent = page.locator(`${HEADER_BLOCK_SELECTOR} [contenteditable="true"]`);
    await expect(headerContent).toHaveText('Hello World');

    const savedData = await page.evaluate(async () => {
      return await window.blokInstance?.save();
    });

    expect(savedData?.blocks[0].data.text).toBe('Hello World');
    expect(savedData?.blocks[0].data.level).toBe(2);
  });

  test('preserves HTML formatting when converting', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            id: 'test-para',
            type: 'paragraph',
            data: { text: '<b>Bold</b> and <i>italic</i>' },
          },
        ],
      },
    });

    const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
    await paragraph.click();

    await page.evaluate(() => {
      const para = document.querySelector('[data-blok-tool="paragraph"]');
      if (para) {
        const range = document.createRange();
        const selection = window.getSelection();
        range.setStart(para, 0);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    });

    await page.keyboard.type('# ');

    await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

    const headerContent = page.locator(`${HEADER_BLOCK_SELECTOR} [contenteditable="true"]`);
    const html = await headerContent.innerHTML();
    expect(html).toMatch(/<(b|strong)>Bold<\/(b|strong)>/);
    expect(html).toContain('<i>italic</i>');
  });
});
```

**Step 2: Run the tests**

Run: `yarn e2e test/playwright/tests/tools/header-shortcut.spec.ts --project=chromium`
Expected: All tests pass

**Step 3: Commit**

```bash
git add test/playwright/tests/tools/header-shortcut.spec.ts
git commit -m "test(shortcuts): add header content preservation tests"
```

---

## Task 7: Add Edge Case Tests

**Files:**
- Modify: `test/playwright/tests/tools/header-shortcut.spec.ts`

**Step 1: Add edge case tests**

Add after the `content preservation` describe block:

```typescript
test.describe('edge cases', () => {
  test('does not convert when 7 or more # characters', async ({ page }) => {
    await createBlok(page, { tools: defaultTools });

    const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
    await paragraph.click();
    await page.keyboard.type('####### ');

    // Should remain a paragraph
    await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toHaveCount(1);
    await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(0);
  });

  test('does not convert when # is typed mid-paragraph', async ({ page }) => {
    await createBlok(page, {
      tools: defaultTools,
      data: {
        blocks: [
          {
            id: 'test-para',
            type: 'paragraph',
            data: { text: 'Hello' },
          },
        ],
      },
    });

    const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
    await paragraph.click();

    // Cursor should be at the end, type "# "
    await page.keyboard.type('# ');

    // Should remain a paragraph
    await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toHaveCount(1);
    await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(0);
  });

  test('does not convert when Header tool is not registered', async ({ page }) => {
    // Create Blok without Header tool
    await createBlok(page, { tools: {} });

    const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
    await paragraph.click();
    await page.keyboard.type('# ');

    // Should remain a paragraph
    await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toHaveCount(1);
    await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(0);
  });
});
```

**Step 2: Run the tests**

Run: `yarn e2e test/playwright/tests/tools/header-shortcut.spec.ts --project=chromium`
Expected: All tests pass

**Step 3: Commit**

```bash
git add test/playwright/tests/tools/header-shortcut.spec.ts
git commit -m "test(shortcuts): add header shortcut edge case tests"
```

---

## Task 8: Add Level Config Respect Tests

**Files:**
- Modify: `test/playwright/tests/tools/header-shortcut.spec.ts`

**Step 1: Add level config tests**

Add after the `edge cases` describe block:

```typescript
test.describe('config respect', () => {
  test('converts only when level is in allowed levels config', async ({ page }) => {
    await createBlok(page, {
      tools: {
        header: {
          className: 'Blok.Header',
          config: { levels: [1, 2] },
        },
      },
    });

    // Test H1 - should work
    const paragraph1 = page.locator(PARAGRAPH_BLOCK_SELECTOR);
    await paragraph1.click();
    await page.keyboard.type('# ');

    await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

    let savedData = await page.evaluate(async () => {
      return await window.blokInstance?.save();
    });
    expect(savedData?.blocks[0].data.level).toBe(1);
  });

  test('does not convert when level is not in allowed levels config', async ({ page }) => {
    await createBlok(page, {
      tools: {
        header: {
          className: 'Blok.Header',
          config: { levels: [1, 2] },
        },
      },
    });

    const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
    await paragraph.click();
    await page.keyboard.type('### ');

    // Should remain a paragraph since H3 is not allowed
    await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toHaveCount(1);
    await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(0);
  });

  test('allows all levels when levels config is not specified', async ({ page }) => {
    await createBlok(page, {
      tools: {
        header: {
          className: 'Blok.Header',
          // No levels config - all should be allowed
        },
      },
    });

    const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
    await paragraph.click();
    await page.keyboard.type('###### ');

    await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

    const savedData = await page.evaluate(async () => {
      return await window.blokInstance?.save();
    });
    expect(savedData?.blocks[0].data.level).toBe(6);
  });
});
```

**Step 2: Run the tests**

Run: `yarn e2e test/playwright/tests/tools/header-shortcut.spec.ts --project=chromium`
Expected: All tests pass

**Step 3: Commit**

```bash
git add test/playwright/tests/tools/header-shortcut.spec.ts
git commit -m "test(shortcuts): add header level config respect tests"
```

---

## Task 9: Run Full Test Suite and Lint

**Files:**
- None (verification only)

**Step 1: Run linting**

Run: `yarn lint`
Expected: No errors

**Step 2: Run unit tests**

Run: `yarn test`
Expected: All tests pass

**Step 3: Build for E2E**

Run: `yarn build:test`
Expected: Build succeeds

**Step 4: Run all E2E tests**

Run: `yarn e2e --project=chromium`
Expected: All tests pass

**Step 5: Final commit if any fixes were needed**

Only if fixes were made during verification.
