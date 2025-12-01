import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type Blok from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import {
  BLOK_INTERFACE_SELECTOR,
  MODIFIER_KEY,
  selectionChangeDebounceTimeout,
} from '../../../../src/components/constants';

/**
 * Get the appropriate modifier key based on the browser's user agent.
 * WebKit always uses a macOS-style user agent, so it expects Meta regardless of host OS.
 * @param page - The Playwright page object
 */
const getModifierKey = async (page: Page): Promise<'Meta' | 'Control'> => {
  const isMac = await page.evaluate(() => {
    return navigator.userAgent.toLowerCase().includes('mac');
  });

  return isMac ? 'Meta' : 'Control';
};

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'blok';
const PARAGRAPH_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`;
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const POPOVER_CONTAINER_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const POPOVER_ITEM_SELECTOR = '[data-blok-testid="popover-item"]';
const NESTED_POPOVER_SELECTOR = '[data-blok-testid="popover"][data-blok-nested="true"]';
const INLINE_TOOLBAR_SELECTOR = '[data-blok-interface="inline-toolbar"]';
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

const focusParagraphBlock = async (page: Page): Promise<void> => {
  const block = page.locator(PARAGRAPH_BLOCK_SELECTOR);

  await expect(block).toHaveCount(1);
  await expect(block).toBeVisible();
  await block.click();
};

const openBlockTunesViaToolbar = async (page: Page): Promise<void> => {
  await focusParagraphBlock(page);

  const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

  await expect(settingsButton).toBeVisible();
  await settingsButton.click();
  await waitForBlockTunesPopover(page);
};

const openBlockTunesViaShortcut = async (page: Page): Promise<void> => {
  await focusParagraphBlock(page);
  await page.keyboard.press(`${MODIFIER_KEY}+/`);
  await waitForBlockTunesPopover(
    page,
    selectionChangeDebounceTimeout + BLOCK_TUNES_WAIT_BUFFER
  );
};

const createParagraphData = (text: string): OutputData => ({
  blocks: [
    {
      type: 'paragraph',
      data: { text },
    },
  ],
});

const defaultTools: Record<string, SerializableToolConfig> = {
  header: {
    className: 'Blok.Header',
  },
};


test.describe('paragraph tool', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('rendering', () => {
    test('renders paragraph block with text content', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createParagraphData('Test paragraph content'),
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await expect(paragraph).toBeVisible();
      await expect(paragraph).toHaveText('Test paragraph content');
    });

    test('renders empty paragraph block', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createParagraphData(''),
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await expect(paragraph).toBeVisible();
    });

    test('renders paragraph with HTML content', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'Text with <b>bold</b> and <i>italic</i>' },
            },
          ],
        },
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await expect(paragraph).toBeVisible();
      await expect(paragraph).toContainText('bold');
      await expect(paragraph).toContainText('italic');
    });
  });

  test.describe('editing', () => {
    test('allows editing paragraph text', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createParagraphData('Original text'),
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await paragraph.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' - Updated');

      await expect(paragraph).toHaveText('Original text - Updated');
    });

    test('paragraph is contenteditable', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createParagraphData('Test paragraph'),
      });

      const paragraphContent = page.locator(PARAGRAPH_BLOCK_SELECTOR).locator('[contenteditable="true"]');

      await expect(paragraphContent).toHaveAttribute('contenteditable', 'true');
    });

    test('can clear paragraph content', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createParagraphData('Text to clear'),
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await paragraph.click();
      await page.keyboard.press(`${MODIFIER_KEY}+a`);
      await page.keyboard.press('Backspace');

      await expect(paragraph).toHaveText('');
    });

    test('can type in empty paragraph', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createParagraphData(''),
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await paragraph.click();
      await page.keyboard.type('New content');

      await expect(paragraph).toHaveText('New content');
    });
  });


  test.describe('keyboard shortcuts', () => {
    test('opens tune menu with keyboard shortcut', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createParagraphData('Test paragraph'),
      });
      await openBlockTunesViaShortcut(page);

      const popover = page.locator(POPOVER_CONTAINER_SELECTOR);

      await expect(popover).toBeVisible();
    });

    test('closes tune menu with Escape key', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createParagraphData('Test paragraph'),
      });
      await openBlockTunesViaToolbar(page);

      const popover = page.locator(POPOVER_CONTAINER_SELECTOR);

      await expect(popover).toBeVisible();

      await page.keyboard.press('Escape');

      await expect(popover).toBeHidden();
    });
  });

  test.describe('block tunes', () => {
    test('shows convert to option in tune menu', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createParagraphData('Test paragraph'),
      });
      await openBlockTunesViaToolbar(page);

      const convertToOption = page.getByTestId('popover-item').filter({ hasText: 'Convert to' });

      await expect(convertToOption).toBeVisible();
    });

    test('shows delete option in tune menu', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createParagraphData('Test paragraph'),
      });
      await openBlockTunesViaToolbar(page);

      const deleteOption = page.getByTestId('popover-item').filter({ hasText: 'Delete' });

      await expect(deleteOption).toBeVisible();
    });

    test('converts paragraph to header', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createParagraphData('Test paragraph'),
      });
      await openBlockTunesViaToolbar(page);

      const convertToOption = page.getByTestId('popover-item').filter({ hasText: 'Convert to' });

      await convertToOption.click();

      const headerOption = page.locator(`${NESTED_POPOVER_SELECTOR} ${POPOVER_ITEM_SELECTOR}`).filter({ hasText: 'Heading' });

      await headerOption.click();

      const header = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="header"]`);

      await expect(header).toBeVisible();
      await expect(header).toHaveText('Test paragraph');
    });

    test('deletes paragraph block', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createParagraphData('Test paragraph'),
      });
      await openBlockTunesViaToolbar(page);

      const deleteOption = page.getByTestId('popover-item').filter({ hasText: 'Delete' });

      // First click shows confirmation
      await deleteOption.click();

      const confirmDelete = page.getByTestId('popover-item').filter({ hasText: 'Click to delete' });

      await expect(confirmDelete).toBeVisible();

      // Second click confirms deletion
      await confirmDelete.click();

      // After deletion, the original text should be gone (a new empty block may be created)
      await expect(page.getByText('Test paragraph')).toHaveCount(0);
    });
  });


  test.describe('inline toolbar', () => {
    test('shows inline toolbar when text is selected', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createParagraphData('Select this text'),
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await paragraph.click();
      await page.keyboard.press(`${MODIFIER_KEY}+a`);

      const inlineToolbar = page.locator(INLINE_TOOLBAR_SELECTOR);

      await expect(inlineToolbar).toBeVisible();
    });

    test('can apply bold formatting', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createParagraphData('Make this bold'),
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await paragraph.click();
      await page.keyboard.press(`${MODIFIER_KEY}+a`);
      await page.keyboard.press(`${MODIFIER_KEY}+b`);

      await expect(paragraph).toContainText('Make this bold');
    });

    test('can apply italic formatting', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createParagraphData('Make this italic'),
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await paragraph.click();
      await page.keyboard.press(`${MODIFIER_KEY}+a`);
      await page.keyboard.press(`${MODIFIER_KEY}+i`);

      await expect(paragraph).toContainText('Make this italic');
    });
  });

  test.describe('data saving', () => {
    test('saves paragraph data correctly', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createParagraphData('Test paragraph content'),
      });

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks).toHaveLength(1);
      expect(savedData?.blocks[0].type).toBe('paragraph');
      expect(savedData?.blocks[0].data.text).toBe('Test paragraph content');
    });

    test('saves edited content', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createParagraphData('Original'),
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await paragraph.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' Updated');

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].data.text).toBe('Original Updated');
    });

    test('saves formatted content with HTML', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createParagraphData('Format me'),
      });

      const paragraphContent = page.locator(PARAGRAPH_BLOCK_SELECTOR).locator('[contenteditable="true"]');

      await paragraphContent.click();

      // Use browser-based modifier key detection for WebKit compatibility on Linux CI
      const modifierKey = await getModifierKey(page);

      await page.keyboard.press(`${modifierKey}+a`);
      await page.keyboard.press(`${modifierKey}+b`);

      // Wait for the bold formatting to be applied
      await page.waitForFunction(
        ({ selector }) => {
          const el = document.querySelector(selector);

          return el && /<b>|<strong>/.test(el.innerHTML);
        },
        { selector: `${PARAGRAPH_BLOCK_SELECTOR} [contenteditable="true"]` },
        { timeout: 5000 }
      );

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      // Bold formatting should be saved as <b> tag
      expect(savedData?.blocks[0].data.text).toMatch(/<b>|<strong>/);
    });
  });


  test.describe('toolbox', () => {
    test('can add new paragraph via Enter key', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createParagraphData('First paragraph'),
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await paragraph.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');

      // Should have two paragraph blocks now (Enter creates a new block)
      const paragraphs = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await expect(paragraphs).toHaveCount(2);
    });
  });

  test.describe('placeholder', () => {
    test('shows placeholder in empty paragraph', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createParagraphData(''),
      });

      const paragraphContent = page.locator(PARAGRAPH_BLOCK_SELECTOR).locator('[contenteditable="true"]');

      // Default placeholder is shown on empty paragraphs
      await expect(paragraphContent).toHaveAttribute('data-placeholder-active');
    });
  });

  test.describe('multiple paragraphs', () => {
    test('renders multiple paragraph blocks', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'First paragraph' } },
            { type: 'paragraph', data: { text: 'Second paragraph' } },
            { type: 'paragraph', data: { text: 'Third paragraph' } },
          ],
        },
      });

      const paragraphs = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await expect(paragraphs).toHaveCount(3);
      await expect(page.getByText('First paragraph')).toBeVisible();
      await expect(page.getByText('Second paragraph')).toBeVisible();
      await expect(page.getByText('Third paragraph')).toBeVisible();
    });

    test('can navigate between paragraphs with arrow keys', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'First' } },
            { type: 'paragraph', data: { text: 'Second' } },
          ],
        },
      });

      const firstParagraph = page.getByText('First');
      const secondParagraph = page.getByText('Second');

      await firstParagraph.click();
      await page.keyboard.press('ArrowDown');

      // Focus should move to second paragraph
      await expect(secondParagraph).toBeFocused();
    });

    test('creates new paragraph on Enter at end of block', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: createParagraphData('First paragraph'),
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await paragraph.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');

      const paragraphs = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      await expect(paragraphs).toHaveCount(2);
    });
  });
});
