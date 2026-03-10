import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

const HOLDER_ID = 'blok';
const HEADER_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="header"]`;
// Inside toggle children, blocks are nested so the editor root selector is an ancestor, not
// a descendant — use the component attribute directly when selecting inside a container.
const PARAGRAPH_COMPONENT_SELECTOR = '[data-blok-component="paragraph"]';
const TOGGLE_CHILDREN_SELECTOR = '[data-blok-toggle-children]';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

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

const createBlokWithData = async (
  page: Page,
  blocks: OutputData['blocks'],
): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokBlocks }) => {
      const blok = new window.Blok({ holder, data: { blocks: blokBlocks } });
      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokBlocks: blocks }
  );
};

const saveData = async (page: Page): Promise<OutputData> => {
  const data = await page.evaluate(() => window.blokInstance?.save());

  if (!data) {
    throw new Error('blokInstance is not available');
  }

  return data;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Toggle Heading - keyboard interactions', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  // =========================================================================
  // Enter key
  // =========================================================================

  test.describe('Enter key', () => {
    test('Enter at end of content with toggle open creates child paragraph inside toggle', async ({ page }) => {
      await createBlokWithData(page, [
        { id: 'h1', type: 'header', data: { text: 'My Heading', level: 2, isToggleable: true, isOpen: true } },
      ]);

      const heading = page.getByRole('heading', { level: 2 });
      await heading.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');

      // The new paragraph should be inside the toggle's children container
      const childParagraph = page.locator(`${TOGGLE_CHILDREN_SELECTOR} ${PARAGRAPH_COMPONENT_SELECTOR}`);
      await expect(childParagraph).toBeVisible();

      // The header block should still exist
      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      // Saved data should contain 2 blocks: the header and the child paragraph
      const saved = await saveData(page);
      expect(saved.blocks).toHaveLength(2);
      expect(saved.blocks[0].type).toBe('header');
      expect(saved.blocks[1].type).toBe('paragraph');
    });

    test('Enter at end of content with toggle closed creates sibling toggle heading', async ({ page }) => {
      await createBlokWithData(page, [
        { id: 'h1', type: 'header', data: { text: 'My Heading', level: 2, isToggleable: true, isOpen: false } },
      ]);

      const heading = page.getByRole('heading', { level: 2 });
      await heading.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');

      // When closed, Enter should create a new sibling toggle heading (not a child)
      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(2);

      // No paragraph should have been added as a child
      const childParagraph = page.locator(`${TOGGLE_CHILDREN_SELECTOR} ${PARAGRAPH_COMPONENT_SELECTOR}`);
      await expect(childParagraph).toHaveCount(0);

      // Saved data: 2 header blocks
      const saved = await saveData(page);
      expect(saved.blocks).toHaveLength(2);
      expect(saved.blocks[0].type).toBe('header');
      expect(saved.blocks[1].type).toBe('header');

      // The new block should also be a toggle heading at the same level
      const newBlockData = saved.blocks[1].data as { level?: number; isToggleable?: boolean };
      expect(newBlockData.level).toBe(2);
      expect(newBlockData.isToggleable).toBe(true);
    });

    test('Enter mid-content splits toggle heading into two toggle headings at same level', async ({ page }) => {
      await createBlokWithData(page, [
        { id: 'h1', type: 'header', data: { text: 'Hello World', level: 2, isToggleable: true, isOpen: true } },
      ]);

      const heading = page.getByRole('heading', { level: 2 });
      await heading.click();

      // Position caret after "Hello" (before the space and "World")
      await page.keyboard.press('Home');
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('ArrowRight');
      }
      await page.keyboard.press('Enter');

      // Two header blocks should now exist
      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(2);

      const saved = await saveData(page);
      expect(saved.blocks).toHaveLength(2);

      const first = saved.blocks[0].data as { text: string; level: number; isToggleable: boolean };
      const second = saved.blocks[1].data as { text: string; level: number; isToggleable: boolean };

      expect(first.text).toBe('Hello');
      expect(first.level).toBe(2);
      expect(first.isToggleable).toBe(true);
      expect(second.text).toBe(' World');
      expect(second.level).toBe(2);
      expect(second.isToggleable).toBe(true);
    });
  });

  // =========================================================================
  // Backspace key
  // =========================================================================

  test.describe('Backspace key', () => {
    test('Backspace on empty toggle heading with caret at start converts to regular heading', async ({ page }) => {
      await createBlokWithData(page, [
        { id: 'h1', type: 'header', data: { text: '', level: 2, isToggleable: true, isOpen: true } },
      ]);

      const heading = page.getByRole('heading', { level: 2 });
      await heading.click();
      await page.keyboard.press('Home');
      await page.keyboard.press('Backspace');

      // Should still be a heading (level 2)
      await expect(page.getByRole('heading', { level: 2 })).toBeVisible();

      // Toggle arrow should be gone
      await expect(page.locator('[data-blok-toggle-arrow]')).toHaveCount(0);

      // Saved data should show heading without isToggleable
      const saved = await saveData(page);
      expect(saved.blocks).toHaveLength(1);
      expect(saved.blocks[0].type).toBe('header');

      const data = saved.blocks[0].data as { level: number; isToggleable?: boolean };
      expect(data.level).toBe(2);
      expect(data.isToggleable).toBeFalsy();
    });

    test('Backspace on non-empty toggle heading does not convert it', async ({ page }) => {
      await createBlokWithData(page, [
        { id: 'h1', type: 'header', data: { text: 'Still here', level: 2, isToggleable: true, isOpen: true } },
      ]);

      const heading = page.getByRole('heading', { level: 2 });
      await heading.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Backspace');

      // Toggle arrow should still be there
      await expect(page.locator('[data-blok-toggle-arrow]')).toBeVisible();

      // Still 1 header block
      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);
    });

    test('Backspace with caret mid-text in non-empty toggle heading just deletes a character', async ({ page }) => {
      await createBlokWithData(page, [
        { id: 'h1', type: 'header', data: { text: 'AB', level: 2, isToggleable: true, isOpen: true } },
      ]);

      const heading = page.getByRole('heading', { level: 2 });
      await heading.click();
      await page.keyboard.press('End');
      // Caret is after "AB" — pressing Backspace deletes "B", leaves "A"
      await page.keyboard.press('Backspace');

      // Toggle arrow should still be there (not converted)
      await expect(page.locator('[data-blok-toggle-arrow]')).toBeVisible();

      const saved = await saveData(page);
      expect(saved.blocks).toHaveLength(1);
      expect(saved.blocks[0].type).toBe('header');

      const data = saved.blocks[0].data as { text: string; isToggleable?: boolean };
      expect(data.isToggleable).toBe(true);
      expect(data.text).toBe('A');
    });
  });
});
