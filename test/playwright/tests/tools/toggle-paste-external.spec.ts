import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TOGGLE_CHILDREN_SELECTOR = '[data-blok-toggle-children]';
const TOGGLE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="toggle"]`;

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
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

/**
 * Create a Blok instance with a toggle block containing one child paragraph.
 *
 * Block tree:
 *   toggle-1 (toggle, content: ['child-1'])
 *     child-1 (paragraph, parent: 'toggle-1', text: 'Child paragraph')
 */
const createToggleWithChild = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(async ({ holder }) => {
    const blok = new window.Blok({
      holder,
      data: {
        blocks: [
          { id: 'toggle-1', type: 'toggle', data: { text: 'Parent toggle' }, content: ['child-1'] },
          { id: 'child-1', type: 'paragraph', data: { text: 'Child paragraph' }, parent: 'toggle-1' },
        ],
      } as OutputData,
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

/**
 * Simulate a paste event carrying plain text on the currently focused element.
 */
const simulatePlainTextPaste = async (page: Page, text: string): Promise<void> => {
  await page.evaluate((pasteText) => {
    const dt = new DataTransfer();

    dt.setData('text/plain', pasteText);
    dt.setData('text/html', '');

    const active = document.activeElement ?? document.body;

    active.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    }));
  }, text);

  // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow the async paste pipeline to complete
  await page.waitForTimeout(300);
};

/**
 * Simulate a paste event carrying HTML on the currently focused element.
 */
const simulateHtmlPaste = async (page: Page, html: string): Promise<void> => {
  await page.evaluate((pasteHtml) => {
    const dt = new DataTransfer();

    dt.setData('text/html', pasteHtml);
    dt.setData('text/plain', '');

    const active = document.activeElement ?? document.body;

    active.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    }));
  }, html);

  // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow the async paste pipeline to complete
  await page.waitForTimeout(300);
};

test.describe('Toggle: paste external content into child block', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('should keep multi-line text pasted into toggle child inside the toggle', async ({ page }) => {
    await createToggleWithChild(page);

    // Focus the child paragraph inside the toggle
    const toggle = page.locator(TOGGLE_BLOCK_SELECTOR);

    await expect(toggle).toBeVisible();

    const childrenContainer = toggle.locator(TOGGLE_CHILDREN_SELECTOR);

    await expect(childrenContainer).toBeAttached();

    const childInput = childrenContainer.locator('[contenteditable]').first();

    await childInput.click();

    // Paste 3 lines of plain text from an "external source"
    await simulatePlainTextPaste(page, 'Pasted line one\nPasted line two\nPasted line three');

    // All pasted blocks must be inside [data-blok-toggle-children], not at root level
    const pastedBlock1 = childrenContainer.locator('[contenteditable]').filter({ hasText: 'Pasted line one' });
    const pastedBlock2 = childrenContainer.locator('[contenteditable]').filter({ hasText: 'Pasted line two' });
    const pastedBlock3 = childrenContainer.locator('[contenteditable]').filter({ hasText: 'Pasted line three' });

    await expect(pastedBlock1).toBeVisible();
    await expect(pastedBlock2).toBeVisible();
    await expect(pastedBlock3).toBeVisible();

    // Verify via saved data: no stray paragraph blocks at root level (no parent field)
    const saved = await page.evaluate(async () => window.blokInstance?.save());

    expect(saved).toBeDefined();

    const orphanParagraphs = saved?.blocks.filter(b => b.type === 'paragraph' && !b.parent);

    expect(orphanParagraphs).toHaveLength(0);

    // Total block count: 1 toggle + 1 original child + 3 pasted = 5 blocks
    expect(saved?.blocks).toHaveLength(5);
  });

  test('should keep HTML text pasted into toggle child inside the toggle', async ({ page }) => {
    await createToggleWithChild(page);

    // Focus the child paragraph inside the toggle
    const toggle = page.locator(TOGGLE_BLOCK_SELECTOR);

    await expect(toggle).toBeVisible();

    const childrenContainer = toggle.locator(TOGGLE_CHILDREN_SELECTOR);

    await expect(childrenContainer).toBeAttached();

    const childInput = childrenContainer.locator('[contenteditable]').first();

    await childInput.click();

    // Paste 2 paragraphs of HTML from external source (no Blok-specific markup)
    await simulateHtmlPaste(page, '<p>First pasted paragraph</p><p>Second pasted paragraph</p>');

    // Both pasted blocks must be inside the toggle's children container
    const pastedBlock1 = childrenContainer.locator('[contenteditable]').filter({ hasText: 'First pasted paragraph' });
    const pastedBlock2 = childrenContainer.locator('[contenteditable]').filter({ hasText: 'Second pasted paragraph' });

    await expect(pastedBlock1).toBeVisible();
    await expect(pastedBlock2).toBeVisible();

    // No stray blocks at root level after the toggle
    const saved = await page.evaluate(async () => window.blokInstance?.save());

    expect(saved).toBeDefined();

    const orphanParagraphs = saved?.blocks.filter(b => b.type === 'paragraph' && !b.parent);

    expect(orphanParagraphs).toHaveLength(0);
  });
});

/**
 * Create a Blok instance with an EMPTY toggle block (no children).
 * The toggle is open so its children container is visible.
 *
 * Block tree:
 *   toggle-1 (toggle, content: []) — open, no children
 */
const createEmptyToggle = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(async ({ holder }) => {
    const blok = new window.Blok({
      holder,
      data: {
        blocks: [
          { id: 'toggle-1', type: 'toggle', data: { text: 'Toggle title', open: true }, content: [] },
        ],
      } as OutputData,
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

test.describe('Toggle: paste external content into toggle TITLE', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('should keep multi-line plain text pasted into toggle title inside the toggle', async ({ page }) => {
    await createEmptyToggle(page);

    const toggle = page.locator(TOGGLE_BLOCK_SELECTOR);

    await expect(toggle).toBeVisible();

    // Focus the toggle's OWN title contenteditable (Scenario A — cursor in the toggle title itself)
    const toggleTitle = toggle.locator('[data-blok-toggle-content]');

    await toggleTitle.click();

    // Paste 3 lines of plain text from an external source
    await simulatePlainTextPaste(page, 'Pasted line one\nPasted line two\nPasted line three');

    // All 3 pasted blocks must be inside [data-blok-toggle-children], not at root level
    const childrenContainer = toggle.locator(TOGGLE_CHILDREN_SELECTOR);

    await expect(childrenContainer).toBeAttached();

    const pastedBlock1 = childrenContainer.locator('[contenteditable]').filter({ hasText: 'Pasted line one' });
    const pastedBlock2 = childrenContainer.locator('[contenteditable]').filter({ hasText: 'Pasted line two' });
    const pastedBlock3 = childrenContainer.locator('[contenteditable]').filter({ hasText: 'Pasted line three' });

    await expect(pastedBlock1).toBeVisible();
    await expect(pastedBlock2).toBeVisible();
    await expect(pastedBlock3).toBeVisible();

    // Verify via saved data: no orphan (root-level) paragraph blocks
    const saved = await page.evaluate(async () => window.blokInstance?.save());

    expect(saved).toBeDefined();

    const orphanParagraphs = saved?.blocks.filter(b => b.type === 'paragraph' && !b.parent);

    expect(orphanParagraphs).toHaveLength(0);

    // Total: 1 toggle + 3 pasted children = 4 blocks; all children parented to the toggle
    expect(saved?.blocks).toHaveLength(4);

    const toggleBlock = saved?.blocks.find(b => b.type === 'toggle');
    const childParagraphs = saved?.blocks.filter(b => b.type === 'paragraph');

    expect(toggleBlock).toBeDefined();

    for (const child of childParagraphs ?? []) {
      expect(child.parent).toBe(toggleBlock?.id);
    }
  });

  test('should keep HTML content (paragraph + list items) pasted into toggle title inside the toggle', async ({ page }) => {
    await createEmptyToggle(page);

    const toggle = page.locator(TOGGLE_BLOCK_SELECTOR);

    await expect(toggle).toBeVisible();

    // Focus the toggle's OWN title contenteditable (Scenario A)
    const toggleTitle = toggle.locator('[data-blok-toggle-content]');

    await toggleTitle.click();

    // Paste HTML: one paragraph + two list items
    await simulateHtmlPaste(
      page,
      '<p>First paragraph</p><ul><li>Item one</li><li>Item two</li></ul>'
    );

    // All pasted blocks must land inside the toggle children container
    const childrenContainer = toggle.locator(TOGGLE_CHILDREN_SELECTOR);

    await expect(childrenContainer).toBeAttached();

    // At least the first paragraph must be visible inside the toggle
    const firstBlock = childrenContainer.locator('[contenteditable]').filter({ hasText: 'First paragraph' });

    await expect(firstBlock).toBeVisible();

    // No orphan blocks at root level
    const saved = await page.evaluate(async () => window.blokInstance?.save());

    expect(saved).toBeDefined();

    const orphanParagraphs = saved?.blocks.filter(b => b.type === 'paragraph' && !b.parent);

    expect(orphanParagraphs).toHaveLength(0);

    // Every non-toggle block must have parent = toggle's id
    const toggleBlock = saved?.blocks.find(b => b.type === 'toggle');

    expect(toggleBlock).toBeDefined();

    const childBlocks = saved?.blocks.filter(b => b.id !== toggleBlock?.id);

    for (const child of childBlocks ?? []) {
      expect(child.parent).toBe(toggleBlock?.id);
    }
  });
});
