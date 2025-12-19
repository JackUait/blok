/**
 * Accessibility tests for drag and drop functionality
 * Validates that:
 * 1. Drag handle has correct ARIA attributes
 * 2. ARIA live region exists for announcements
 * 3. Screen reader announcements are made during drag operations
 * 4. Keyboard movement announces position changes
 * 5. Boundary conditions are announced
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { MODIFIER_KEY } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;

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

const createBlok = async (
  page: Page,
  options: { data?: OutputData; config?: Record<string, unknown> } = {}
): Promise<void> => {
  const { data = null, config = {} } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, initialData, config: providedConfig }) => {
      const blokConfig: Record<string, unknown> = {
        holder,
        autofocus: true,
        ...providedConfig,
      };

      if (initialData) {
        blokConfig.data = initialData;
      }

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      initialData: data,
      config,
    }
  );
};

test.describe('drag and drop accessibility', () => {
  test.beforeAll(async () => {
    await ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test.describe('drag handle ARIA attributes', () => {
    test('should have correct ARIA attributes on the settings toggler', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'First block' } },
          ],
        },
      });

      // Hover over the block to show the toolbar
      const block = page.locator('[data-blok-element]').filter({ hasText: 'First block' });

      await block.hover();

      // Get the settings toggler (drag handle)
      const settingsToggler = page.locator(SETTINGS_BUTTON_SELECTOR);

      // Verify ARIA attributes
      // Note: tabindex="-1" keeps the element accessible to screen readers
      // while removing it from the natural tab order. Users can move blocks
      // using keyboard shortcuts (Cmd/Ctrl+Shift+Arrow) instead.
      await expect(settingsToggler).toHaveAttribute('role', 'button');
      await expect(settingsToggler).toHaveAttribute('tabindex', '-1');
      await expect(settingsToggler).toHaveAttribute('aria-label');
      await expect(settingsToggler).toHaveAttribute('aria-roledescription', 'drag handle');

      // Verify aria-label contains meaningful text
      await expect(settingsToggler).toHaveAttribute('aria-label', /drag/i);
    });
  });

  test.describe('live region for ARIA announcements', () => {
    test('should create live region on first announcement', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'First block' } },
            { type: 'paragraph', data: { text: 'Second block' } },
          ],
        },
      });

      // Click on the second block
      await page.getByText('Second block').click();

      // Move the block up using keyboard shortcut
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+ArrowUp`);

      // Check that the live region exists
      const liveRegion = page.locator('[data-blok-announcer]');

      await expect(liveRegion).toBeAttached();
      await expect(liveRegion).toHaveAttribute('role', 'status');
      await expect(liveRegion).toHaveAttribute('aria-live');
      await expect(liveRegion).toHaveAttribute('aria-atomic', 'true');
    });

    test('should be visually hidden but accessible', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'First block' } },
            { type: 'paragraph', data: { text: 'Second block' } },
          ],
        },
      });

      // Trigger an announcement
      await page.getByText('Second block').click();
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+ArrowUp`);

      // Check that the live region is visually hidden
      const liveRegion = page.locator('[data-blok-announcer]');
      const boundingBox = await liveRegion.boundingBox();

      // The element should be clipped/hidden but still in the DOM
      expect(boundingBox?.width).toBeLessThanOrEqual(1);
      expect(boundingBox?.height).toBeLessThanOrEqual(1);
    });
  });

  test.describe('keyboard movement announcements', () => {
    test('should announce position when block moves up', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'First block' } },
            { type: 'paragraph', data: { text: 'Second block' } },
            { type: 'paragraph', data: { text: 'Third block' } },
          ],
        },
      });

      // Click on the second block
      await page.getByText('Second block').click();

      // Move up
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+ArrowUp`);

      // Check announcement contains position info
      const liveRegion = page.locator('[data-blok-announcer]');

      // Wait for announcement to appear
      await expect(liveRegion).toContainText(/moved up|position/i, { timeout: 2000 });
    });

    test('should announce position when block moves down', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'First block' } },
            { type: 'paragraph', data: { text: 'Second block' } },
            { type: 'paragraph', data: { text: 'Third block' } },
          ],
        },
      });

      // Click on the second block
      await page.getByText('Second block').click();

      // Move down
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+ArrowDown`);

      // Check announcement
      const liveRegion = page.locator('[data-blok-announcer]');

      await expect(liveRegion).toContainText(/moved down|position/i, { timeout: 2000 });
    });

    test('should announce boundary when block cannot move up', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'First block' } },
            { type: 'paragraph', data: { text: 'Second block' } },
          ],
        },
      });

      // Click on the first block
      await page.getByText('First block').click();

      // Try to move up (should fail and announce boundary)
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+ArrowUp`);

      // Check announcement
      const liveRegion = page.locator('[data-blok-announcer]');

      await expect(liveRegion).toContainText(/top|cannot/i, { timeout: 2000 });
    });

    test('should announce boundary when block cannot move down', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'First block' } },
            { type: 'paragraph', data: { text: 'Last block' } },
          ],
        },
      });

      // Click on the last block
      await page.getByText('Last block').click();

      // Try to move down (should fail and announce boundary)
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+ArrowDown`);

      // Check announcement
      const liveRegion = page.locator('[data-blok-announcer]');

      await expect(liveRegion).toContainText(/bottom|cannot/i, { timeout: 2000 });
    });
  });

  test.describe('drag operation announcements', () => {
    /**
     * Helper function to get bounding box and throw if it doesn't exist.
     */
    const getBoundingBox = async (
      locator: ReturnType<Page['locator']>
    ): Promise<{ x: number; y: number; width: number; height: number }> => {
      const box = await locator.boundingBox();

      if (!box) {
        throw new Error('Could not get bounding box for element');
      }

      return box;
    };

    test('should announce when drag is cancelled with Escape', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'First block' } },
            { type: 'paragraph', data: { text: 'Second block' } },
          ],
        },
      });

      // Hover over the first block to show toolbar
      const firstBlock = page.locator('[data-blok-element]').filter({ hasText: 'First block' });

      await firstBlock.hover();

      // Get the settings toggler (drag handle)
      const settingsToggler = page.locator(SETTINGS_BUTTON_SELECTOR);
      const sourceBox = await getBoundingBox(settingsToggler);

      // Start drag
      await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
      await page.mouse.down();

      // Move enough to trigger drag threshold
      await page.mouse.move(sourceBox.x + 50, sourceBox.y + 50, { steps: 10 });

      // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow time for drag to start
      await page.waitForTimeout(100);

      // Cancel with Escape
      await page.keyboard.press('Escape');

      // Check announcement
      const liveRegion = page.locator('[data-blok-announcer]');

      await expect(liveRegion).toContainText(/cancel/i, { timeout: 2000 });
    });

    test('should announce successful drop', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'First block' } },
            { type: 'paragraph', data: { text: 'Second block' } },
            { type: 'paragraph', data: { text: 'Third block' } },
          ],
        },
      });

      // Hover over the first block to show toolbar
      const firstBlock = page.locator('[data-blok-element]').filter({ hasText: 'First block' });

      await firstBlock.hover();

      // Get the settings toggler and target block
      const settingsToggler = page.locator(SETTINGS_BUTTON_SELECTOR);
      const thirdBlock = page.locator('[data-blok-element]').filter({ hasText: 'Third block' });

      const sourceBox = await getBoundingBox(settingsToggler);
      const targetBox = await getBoundingBox(thirdBlock);

      // Perform drag and drop
      await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
      await page.mouse.down();

      // Move to target with steps
      await page.mouse.move(
        targetBox.x + targetBox.width / 2,
        targetBox.y + targetBox.height - 5,
        { steps: 15 }
      );

      // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow time for drop target detection
      await page.waitForTimeout(100);

      // Release
      await page.mouse.up();

      // Check announcement for successful drop
      const liveRegion = page.locator('[data-blok-announcer]');

      await expect(liveRegion).toContainText(/moved|position/i, { timeout: 2000 });
    });
  });
});
