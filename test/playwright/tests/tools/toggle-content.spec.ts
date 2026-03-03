import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TOGGLE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="toggle"]`;
const PARAGRAPH_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`;

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

const createBlok = async (page: Page, data?: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, initialData }) => {
      const config: Record<string, unknown> = { holder };

      if (initialData) {
        config.data = initialData;
      }

      const blok = new window.Blok(config);

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data ?? null }
  );
};

test.describe('Toggle Content - Adding blocks inside toggles', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('toggle list item', () => {
    test('Enter at end of open toggle creates child paragraph inside toggle', async ({ page }) => {
      await createBlok(page, {
        blocks: [{ type: 'toggle', data: { text: 'My toggle' } }],
      });

      // Expand the toggle
      const arrow = page.locator('[data-blok-toggle-arrow]');

      await arrow.click();
      await expect(page.locator('[data-blok-toggle-open="true"]')).toBeVisible();

      // Click the toggle content and move to end
      const content = page.locator('[data-blok-toggle-content]');

      await content.click();
      await page.keyboard.press('End');

      // Press Enter to create child block
      await page.keyboard.press('Enter');

      // A paragraph should now exist as a child of the toggle
      const savedData = await page.evaluate(async () => {
        return window.blokInstance?.save();
      });

      expect(savedData).toBeDefined();

      // Should have 2 blocks: the toggle and a child paragraph
      expect(savedData?.blocks.length).toBeGreaterThanOrEqual(2);

      const toggleBlock = savedData?.blocks.find(b => b.type === 'toggle');
      const paragraphBlock = savedData?.blocks.find(b => b.type === 'paragraph');

      expect(toggleBlock).toBeDefined();
      expect(paragraphBlock).toBeDefined();

      // The paragraph should be a child of the toggle (has content relationship)
      expect(toggleBlock?.content).toBeDefined();
      expect(toggleBlock?.content?.length).toBeGreaterThan(0);
      expect(toggleBlock?.content).toContain(paragraphBlock?.id);
    });

    test('Enter at end of closed toggle creates sibling toggle', async ({ page }) => {
      await createBlok(page, {
        blocks: [{ type: 'toggle', data: { text: 'Closed toggle' } }],
      });

      // Toggle is closed by default - verify
      await expect(page.locator('[data-blok-toggle-open="false"]')).toBeVisible();

      // Click the toggle content and move to end
      const content = page.locator('[data-blok-toggle-content]');

      await content.click();
      await page.keyboard.press('End');

      // Press Enter
      await page.keyboard.press('Enter');

      // Should create a sibling toggle, not a child
      const toggleBlocks = page.locator(TOGGLE_BLOCK_SELECTOR);

      await expect(toggleBlocks).toHaveCount(2);
    });
  });

  test.describe('toggle heading', () => {
    test('Enter at end of open toggle heading creates child paragraph', async ({ page }) => {
      await createBlok(page, {
        blocks: [{ type: 'header', data: { text: 'Toggle heading', level: 2, isToggleable: true } }],
      });

      const header = page.getByRole('heading', { level: 2, name: 'Toggle heading' });

      await expect(header).toHaveAttribute('data-blok-toggle-open', 'false');

      // Expand the toggle heading programmatically.
      // Direct DOM changes on the heading trigger an infinite MutationObserver
      // feedback loop (a pre-existing bug), so we must disable the observer first.
      // We keep it disabled for the rest of the test to prevent the loop from
      // being triggered by Enter key handling as well.
      await page.evaluate(() => {
        const blok = window.blokInstance as unknown as Record<string, unknown> | undefined;

        if (!blok) {
          return;
        }

        // Module aliases are on blok.module (non-enumerable property set in exportAPI)
        const modules = blok['module'] as Record<string, unknown> | undefined;
        const modObserver = modules?.['modificationsObserver'] as { disable: () => void } | undefined;

        modObserver?.disable();

        // Call expand on the first block
        const blockApi = (blok as unknown as Blok).blocks.getBlockByIndex(0);

        blockApi?.call('expand');
      });

      await expect(header).toHaveAttribute('data-blok-toggle-open', 'true');

      // Click the heading text and move to end
      await header.click();
      await page.keyboard.press('End');

      // Press Enter to create a child block
      await page.keyboard.press('Enter');

      // A paragraph should now exist as a child of the toggle heading
      const savedData = await page.evaluate(async () => {
        return window.blokInstance?.save();
      });

      expect(savedData).toBeDefined();

      // Should have 2 blocks: the header and a child paragraph
      expect(savedData?.blocks.length).toBeGreaterThanOrEqual(2);

      const headerBlock = savedData?.blocks.find(b => b.type === 'header');
      const paragraphBlock = savedData?.blocks.find(b => b.type === 'paragraph');

      expect(headerBlock).toBeDefined();
      expect(paragraphBlock).toBeDefined();

      // The paragraph should be a child of the toggle heading
      expect(headerBlock?.content).toBeDefined();
      expect(headerBlock?.content?.length).toBeGreaterThan(0);
      expect(headerBlock?.content).toContain(paragraphBlock?.id);
    });
  });

  test.describe('child blocks inside toggle', () => {
    test('Enter on child paragraph inside toggle creates another child paragraph', async ({ page }) => {
      // Create a toggle with an existing child paragraph via the API
      await createBlok(page);

      // Use the API to create a toggle with a child
      await page.evaluate(async () => {
        const blok = window.blokInstance;

        if (!blok) {
          return;
        }

        await blok.destroy?.();

        const container = document.getElementById('blok');

        if (!container) {
          return;
        }

        const newBlok = new window.Blok({
          holder: container,
          data: {
            blocks: [
              { id: 'toggle-1', type: 'toggle', data: { text: 'Parent toggle' }, content: ['child-1'] },
              { id: 'child-1', type: 'paragraph', data: { text: 'Child text' }, parent: 'toggle-1' },
            ],
          },
        });

        window.blokInstance = newBlok;
        await newBlok.isReady;
      });

      // Expand the toggle so the child is visible
      const arrow = page.locator('[data-blok-toggle-arrow]');

      await arrow.click();
      await expect(page.locator('[data-blok-toggle-open="true"]')).toBeVisible();

      // Click the child paragraph and move to end
      const childParagraph = page.locator(`${PARAGRAPH_BLOCK_SELECTOR} [contenteditable]`).filter({ hasText: 'Child text' });

      await childParagraph.click();
      await page.keyboard.press('End');

      // Press Enter to create a new block
      await page.keyboard.press('Enter');

      // Save and verify the new block is also a child of the toggle
      const savedData = await page.evaluate(async () => {
        return window.blokInstance?.save();
      });

      expect(savedData).toBeDefined();

      // Should have 3 blocks: toggle + 2 child paragraphs
      expect(savedData?.blocks).toHaveLength(3);

      const toggleBlock = savedData?.blocks.find(b => b.type === 'toggle');

      // The toggle should now have 2 children
      expect(toggleBlock?.content).toHaveLength(2);
    });
  });
});
