import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import {
  BLOK_INTERFACE_SELECTOR,
} from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const HEADER_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="header"]`;
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const POPOVER_CONTAINER_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const POPOVER_ITEM_SELECTOR = '[data-blok-testid="popover-item"]';
const DEFAULT_WAIT_TIMEOUT = 5_000;

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

const createHeaderData = (text: string, level: number, isToggleable?: boolean): OutputData => ({
  blocks: [
    {
      type: 'header',
      data: {
        text,
        level,
        ...(isToggleable ? { isToggleable: true } : {}),
      },
    },
  ],
});

const waitForBlockTunesPopover = async (
  page: Page,
  timeout = DEFAULT_WAIT_TIMEOUT
): Promise<void> => {
  const popover = page.locator(POPOVER_CONTAINER_SELECTOR);

  await expect(popover).toHaveCount(1);
  await popover.waitFor({ state: 'visible', timeout });
};

const focusHeaderBlock = async (page: Page): Promise<void> => {
  const block = page.locator(HEADER_BLOCK_SELECTOR);

  await expect(block).toHaveCount(1);
  await expect(block).toBeVisible();
  await block.click();
};

const openBlockTunesViaToolbar = async (page: Page): Promise<void> => {
  await focusHeaderBlock(page);

  const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

  await expect(settingsButton).toBeVisible();
  await settingsButton.click();
  await waitForBlockTunesPopover(page);
};

test.describe('Toggle Headings', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('rendering', () => {
    test('renders toggle heading from saved data', async ({ page }) => {
      await createBlok(page, createHeaderData('Toggle H2', 2, true));

      const header = page.getByRole('heading', { level: 2, name: 'Toggle H2' });

      await expect(header).toBeVisible();

      // Should have toggle attributes
      await expect(header).toHaveAttribute('data-blok-toggle-open');

      // Should have arrow
      const arrow = header.locator('[data-blok-toggle-arrow]');

      await expect(arrow).toBeVisible();
    });

    test('renders regular header without toggle features', async ({ page }) => {
      await createBlok(page, createHeaderData('Regular H2', 2));

      const header = page.getByRole('heading', { level: 2, name: 'Regular H2' });

      await expect(header).toBeVisible();

      // Should NOT have toggle attributes
      const arrow = header.locator('[data-blok-toggle-arrow]');

      await expect(arrow).toHaveCount(0);
    });

    test('toggle heading starts collapsed by default', async ({ page }) => {
      await createBlok(page, createHeaderData('Collapsed H2', 2, true));

      const header = page.getByRole('heading', { level: 2, name: 'Collapsed H2' });

      await expect(header).toHaveAttribute('data-blok-toggle-open', 'false');
    });
  });

  test.describe('expand/collapse', () => {
    test('expands when arrow is clicked', async ({ page }) => {
      await createBlok(page, createHeaderData('Expandable H2', 2, true));

      const header = page.getByRole('heading', { level: 2, name: 'Expandable H2' });
      const arrow = header.locator('[data-blok-toggle-arrow]');

      await expect(header).toHaveAttribute('data-blok-toggle-open', 'false');

      await arrow.click();

      await expect(header).toHaveAttribute('data-blok-toggle-open', 'true');
    });

    test('collapses when arrow is clicked again', async ({ page }) => {
      await createBlok(page, createHeaderData('Collapsible H2', 2, true));

      const header = page.getByRole('heading', { level: 2, name: 'Collapsible H2' });
      const arrow = header.locator('[data-blok-toggle-arrow]');

      // Expand
      await arrow.click();
      await expect(header).toHaveAttribute('data-blok-toggle-open', 'true');

      // Collapse
      await arrow.click();
      await expect(header).toHaveAttribute('data-blok-toggle-open', 'false');
    });
  });

  test.describe('settings menu', () => {
    test('enables toggle heading via settings menu', async ({ page }) => {
      await createBlok(page, createHeaderData('Make Toggleable', 2));

      await openBlockTunesViaToolbar(page);

      // Find the "Toggle heading" option
      const toggleOption = page.locator(POPOVER_ITEM_SELECTOR).filter({ hasText: 'Toggle heading' });

      await expect(toggleOption).toBeVisible();
      await toggleOption.click();

      // Header should now have toggle features
      const header = page.getByRole('heading', { level: 2, name: 'Make Toggleable' });
      const arrow = header.locator('[data-blok-toggle-arrow]');

      await expect(arrow).toBeVisible();
      await expect(header).toHaveAttribute('data-blok-toggle-open');
    });

    test('disables toggle heading via settings menu', async ({ page }) => {
      await createBlok(page, createHeaderData('Remove Toggle', 2, true));

      // Verify toggle exists
      const header = page.getByRole('heading', { level: 2, name: 'Remove Toggle' });

      await expect(header.locator('[data-blok-toggle-arrow]')).toBeVisible();

      await openBlockTunesViaToolbar(page);

      // Click toggle heading to disable it
      const toggleOption = page.locator(POPOVER_ITEM_SELECTOR).filter({ hasText: 'Toggle heading' });

      await toggleOption.click();

      // Arrow should be gone
      await expect(header.locator('[data-blok-toggle-arrow]')).toHaveCount(0);
    });
  });

  test.describe('save', () => {
    test('saves isToggleable flag correctly', async ({ page }) => {
      await createBlok(page, createHeaderData('Saved Toggle H2', 2, true));

      const savedData = await page.evaluate(async () => {
        return window.blokInstance?.save();
      });

      expect(savedData).toBeDefined();
      expect(savedData?.blocks).toHaveLength(1);
      expect(savedData?.blocks[0].type).toBe('header');
      const blockData = savedData?.blocks[0].data as { text: string; level: number; isToggleable: boolean };

      expect(blockData.text).toBe('Saved Toggle H2');
      expect(blockData.level).toBe(2);
      expect(blockData.isToggleable).toBe(true);
    });

    test('does not save isToggleable for regular headers', async ({ page }) => {
      await createBlok(page, createHeaderData('Regular Header', 2));

      const savedData = await page.evaluate(async () => {
        return window.blokInstance?.save();
      });

      expect(savedData).toBeDefined();
      expect((savedData?.blocks[0].data as { isToggleable?: boolean }).isToggleable).toBeUndefined();
    });

    test('round-trip preserves toggle heading state', async ({ page }) => {
      const originalData = createHeaderData('Round Trip H3', 3, true);

      await createBlok(page, originalData);

      const savedData = await page.evaluate(async () => {
        return window.blokInstance?.save();
      });

      // Reload with saved data
      await createBlok(page, savedData as OutputData);

      // Verify toggle heading preserved
      const header = page.getByRole('heading', { level: 3, name: 'Round Trip H3' });

      await expect(header).toBeVisible();
      await expect(header).toHaveAttribute('data-blok-toggle-open');
      await expect(header.locator('[data-blok-toggle-arrow]')).toBeVisible();
    });
  });
});
