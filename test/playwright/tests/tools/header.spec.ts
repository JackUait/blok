import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import {
  BLOK_INTERFACE_SELECTOR,
  MODIFIER_KEY,
  selectionChangeDebounceTimeout,
} from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const HEADER_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="header"]`;
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const POPOVER_CONTAINER_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const SEARCH_INPUT_SELECTOR = `${POPOVER_CONTAINER_SELECTOR} [data-blok-testid="popover-search-input"]`;
const POPOVER_ITEM_SELECTOR = '[data-blok-testid="popover-item"]';
const NESTED_POPOVER_SELECTOR = '[data-blok-testid="popover"][data-blok-nested="true"]';
const DEFAULT_WAIT_TIMEOUT = 5_000;
const BLOCK_TUNES_WAIT_BUFFER = 500;

type SerializableToolConfig = {
  className?: string;
  config?: Record<string, unknown>;
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
          Record<string, { class: unknown } & Record<string, unknown>>
        >((accumulator, { name, className, config }) => {
          let toolClass: unknown = null;

          if (className) {
            // Handle dot notation (e.g., 'Blok.Header')
            toolClass = className.split('.').reduce(
              (obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key],
              window
            ) ?? null;
          }

          if (!toolClass) {
            throw new Error(`Tool "${name}" is not available globally`);
          }

          return {
            ...accumulator,
            [name]: {
              class: toolClass,
              ...config,
            },
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

const openBlockTunesViaShortcut = async (page: Page): Promise<void> => {
  await focusHeaderBlock(page);
  await page.keyboard.press(`${MODIFIER_KEY}+/`);
  await waitForBlockTunesPopover(
    page,
    selectionChangeDebounceTimeout + BLOCK_TUNES_WAIT_BUFFER
  );
};

const createHeaderData = (text: string, level: number): OutputData => ({
  blocks: [
    {
      type: 'header',
      data: { text, level },
    },
  ],
});

const defaultTools: Record<string, SerializableToolConfig> = {
  header: {
    className: 'Blok.Header',
  },
};

test.describe('header Tool', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('rendering', () => {
    test('renders header block with correct level', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createHeaderData('Test Header', 2),
      });

      const header = page.getByRole('heading', { level: 2, name: 'Test Header' });

      await expect(header).toBeVisible();
    });

    test('renders H1 header correctly', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createHeaderData('H1 Header', 1),
      });

      const header = page.getByRole('heading', { level: 1, name: 'H1 Header' });

      await expect(header).toBeVisible();
    });

    test('renders H6 header correctly', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createHeaderData('H6 Header', 6),
      });

      const header = page.getByRole('heading', { level: 6, name: 'H6 Header' });

      await expect(header).toBeVisible();
    });

    test('defaults to H2 when no level specified', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'header',
              data: { text: 'Default Header' },
            },
          ],
        },
      });

      const header = page.getByRole('heading', { level: 2, name: 'Default Header' });

      await expect(header).toBeVisible();
    });
  });

  test.describe('level changing', () => {
    test('changes header level from H2 to H1 via tune menu', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createHeaderData('Test Header', 2),
      });
      await openBlockTunesViaToolbar(page);

      const h1Option = page.getByTestId('popover-item').filter({ hasText: 'Heading 1' });

      await h1Option.click();

      const header = page.getByRole('heading', { level: 1, name: 'Test Header' });

      await expect(header).toBeVisible();
    });

    test('changes header level from H2 to H3 via tune menu', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createHeaderData('Test Header', 2),
      });
      await openBlockTunesViaToolbar(page);

      const h3Option = page.getByTestId('popover-item').filter({ hasText: 'Heading 3' });

      await h3Option.click();

      const header = page.getByRole('heading', { level: 3, name: 'Test Header' });

      await expect(header).toBeVisible();
    });

    test('changes header level to H4', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createHeaderData('Test Header', 2),
      });
      await openBlockTunesViaToolbar(page);

      const h4Option = page.getByTestId('popover-item').filter({ hasText: 'Heading 4' });

      await h4Option.click();

      const header = page.getByRole('heading', { level: 4, name: 'Test Header' });

      await expect(header).toBeVisible();
    });

    test('changes header level to H5', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createHeaderData('Test Header', 2),
      });
      await openBlockTunesViaToolbar(page);

      const h5Option = page.getByTestId('popover-item').filter({ hasText: 'Heading 5' });

      await h5Option.click();

      const header = page.getByRole('heading', { level: 5, name: 'Test Header' });

      await expect(header).toBeVisible();
    });

    test('changes header level to H6', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createHeaderData('Test Header', 2),
      });
      await openBlockTunesViaToolbar(page);

      const h6Option = page.getByTestId('popover-item').filter({ hasText: 'Heading 6' });

      await h6Option.click();

      const header = page.getByRole('heading', { level: 6, name: 'Test Header' });

      await expect(header).toBeVisible();
    });

    test('preserves text content when changing level', async ({ page }) => {
      const originalText = 'Important Header Content';

      await createBlok(page, {
        tools: defaultTools,
        data: createHeaderData(originalText, 2),
      });
      await openBlockTunesViaToolbar(page);

      const h1Option = page.getByTestId('popover-item').filter({ hasText: 'Heading 1' });

      await h1Option.click();

      const header = page.getByRole('heading', { level: 1, name: originalText });

      await expect(header).toBeVisible();
    });
  });

  test.describe('keyboard shortcuts', () => {
    test('opens tune menu with keyboard shortcut', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createHeaderData('Test Header', 2),
      });
      await openBlockTunesViaShortcut(page);

      const popover = page.locator(POPOVER_CONTAINER_SELECTOR);

      await expect(popover).toBeVisible();
    });

    test('closes tune menu with Escape key', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createHeaderData('Test Header', 2),
      });
      await openBlockTunesViaToolbar(page);

      const popover = page.locator(POPOVER_CONTAINER_SELECTOR);

      await expect(popover).toBeVisible();

      await page.keyboard.press('Escape');

      await expect(popover).toBeHidden();
    });
  });

  test.describe('filter functionality', () => {
    test('filters heading options when typing in search', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createHeaderData('Test Header', 2),
      });
      await openBlockTunesViaToolbar(page);

      const searchInput = page.locator(SEARCH_INPUT_SELECTOR);

      await searchInput.fill('1');

      const h1Option = page.getByTestId('popover-item').filter({ hasText: 'Heading 1' });

      await expect(h1Option).toBeVisible();

      // Other heading options should be hidden
      const h2Option = page.getByTestId('popover-item').filter({ hasText: 'Heading 2' });

      await expect(h2Option).toHaveAttribute('data-blok-hidden', 'true');
    });

    test('shows all options when filter is cleared', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createHeaderData('Test Header', 2),
      });
      await openBlockTunesViaToolbar(page);

      const searchInput = page.locator(SEARCH_INPUT_SELECTOR);

      await searchInput.fill('1');
      await searchInput.clear();

      const h1Option = page.getByTestId('popover-item').filter({ hasText: 'Heading 1' });
      const h2Option = page.getByTestId('popover-item').filter({ hasText: 'Heading 2' });

      await expect(h1Option).not.toHaveAttribute('data-blok-hidden', 'true');
      await expect(h2Option).not.toHaveAttribute('data-blok-hidden', 'true');
    });
  });

  test.describe('convert to functionality', () => {
    test('shows convert to option in tune menu', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createHeaderData('Test Header', 2),
      });
      await openBlockTunesViaToolbar(page);

      const convertToOption = page.getByTestId('popover-item').filter({ hasText: 'Convert to' });

      await expect(convertToOption).toBeVisible();
    });

    test('converts header to paragraph', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createHeaderData('Test Header', 2),
      });
      await openBlockTunesViaToolbar(page);

      const convertToOption = page.getByTestId('popover-item').filter({ hasText: 'Convert to' });

      await convertToOption.click();

      const textOption = page.locator(`${NESTED_POPOVER_SELECTOR} ${POPOVER_ITEM_SELECTOR}`).filter({ hasText: 'Text' });

      await textOption.click();

      const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`);

      await expect(paragraph).toBeVisible();
      await expect(paragraph).toHaveText('Test Header');
    });
  });

  test.describe('delete functionality', () => {
    test('shows delete option in tune menu', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createHeaderData('Test Header', 2),
      });
      await openBlockTunesViaToolbar(page);

      const deleteOption = page.getByTestId('popover-item').filter({ hasText: 'Delete' });

      await expect(deleteOption).toBeVisible();
    });

    test('deletes header block when delete is clicked', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createHeaderData('Test Header', 2),
      });
      await openBlockTunesViaToolbar(page);

      const deleteOption = page.getByTestId('popover-item').filter({ hasText: 'Delete' });

      await deleteOption.click();

      // After deletion, the header block should be removed
      const headerBlock = page.locator(HEADER_BLOCK_SELECTOR);

      await expect(headerBlock).toHaveCount(0);
    });
  });

  test.describe('editing', () => {
    test('allows editing header text', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createHeaderData('Original Text', 2),
      });

      const header = page.getByRole('heading', { level: 2, name: 'Original Text' });

      await header.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' - Updated');

      await expect(header).toHaveText('Original Text - Updated');
    });

    test('header is contenteditable', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createHeaderData('Test Header', 2),
      });

      const header = page.getByRole('heading', { level: 2, name: 'Test Header' });

      await expect(header).toHaveAttribute('contenteditable', 'true');
    });
  });

  test.describe('data saving', () => {
    test('saves header data correctly', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createHeaderData('Test Header', 3),
      });

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks).toHaveLength(1);
      expect(savedData?.blocks[0].type).toBe('header');
      expect(savedData?.blocks[0].data.text).toBe('Test Header');
      expect(savedData?.blocks[0].data.level).toBe(3);
    });

    test('saves updated level after change', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createHeaderData('Test Header', 2),
      });
      await openBlockTunesViaToolbar(page);

      const h4Option = page.getByTestId('popover-item').filter({ hasText: 'Heading 4' });

      await h4Option.click();

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].data.level).toBe(4);
    });
  });

  test.describe('tune menu display', () => {
    test('displays all heading level options', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createHeaderData('Test Header', 2),
      });
      await openBlockTunesViaToolbar(page);

      for (let level = 1; level <= 6; level++) {
        const option = page.getByTestId('popover-item').filter({ hasText: `Heading ${level}` });

        await expect(option).toBeVisible();
      }
    });

    test('highlights current heading level', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createHeaderData('Test Header', 3),
      });
      await openBlockTunesViaToolbar(page);

      const h3Option = page.getByTestId('popover-item').filter({ hasText: 'Heading 3' });

      await expect(h3Option).toHaveAttribute('data-blok-popover-item-active', 'true');
    });
  });
});
