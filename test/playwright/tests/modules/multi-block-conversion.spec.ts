import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const BLOCK_WRAPPER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const HEADER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="header"]`;
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const POPOVER_CONTAINER_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const NESTED_POPOVER_SELECTOR = '[data-blok-nested="true"] [data-blok-testid="popover-container"]';
const CONVERT_TO_OPTION_SELECTOR = '[data-blok-testid="popover-item"][data-blok-item-name="convert-to"]';
const DELETE_OPTION_SELECTOR = '[data-blok-testid="popover-item"][data-blok-item-name="delete"]';
const SELECT_ALL_SHORTCUT = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type ToolDefinition = {
  name: string;
  className?: string;
  classSource?: string;
  config?: Record<string, unknown>;
};

const getBlockByIndex = (page: Page, index: number): Locator => {
  return page.locator(`:nth-match(${BLOCK_WRAPPER_SELECTOR}, ${index + 1})`);
};

const getParagraphByIndex = (page: Page, index: number): Locator => {
  return page.locator(`:nth-match(${PARAGRAPH_SELECTOR}, ${index + 1})`);
};

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

const createBlokWithBlocks = async (
  page: Page,
  blocks: OutputData['blocks'],
  tools: ToolDefinition[] = []
): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({
    holder,
    blocks: blokBlocks,
    serializedTools: toolConfigs,
  }: {
    holder: string;
    blocks: OutputData['blocks'];
    serializedTools: ToolDefinition[];
  }) => {
    const revivedTools = toolConfigs.reduce<Record<string, unknown>>((accumulator, toolConfig) => {
      if (toolConfig.className) {
        const toolClass = toolConfig.className.split('.').reduce(
          (obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key],
          window
        ) ?? null;

        if (!toolClass) {
          throw new Error(`Tool class "${toolConfig.className}" not found`);
        }

        return {
          ...accumulator,
          [toolConfig.name]: toolConfig.config
            ? { ...toolConfig.config, class: toolClass }
            : toolClass,
        };
      }

      if (toolConfig.classSource) {
        const revivedClass = new Function(`return (${toolConfig.classSource});`)();

        return {
          ...accumulator,
          [toolConfig.name]: toolConfig.config
            ? { ...toolConfig.config, class: revivedClass }
            : revivedClass,
        };
      }

      if (toolConfig.config) {
        return {
          ...accumulator,
          [toolConfig.name]: toolConfig.config,
        };
      }

      return accumulator;
    }, {});

    const blok = new window.Blok({
      holder: holder,
      data: { blocks: blokBlocks },
      ...(toolConfigs.length > 0 ? { tools: revivedTools } : {}),
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, {
    holder: HOLDER_ID,
    blocks,
    serializedTools: tools,
  });
};

const selectAllBlocksViaKeyboard = async (page: Page): Promise<void> => {
  const firstParagraph = getParagraphByIndex(page, 0);

  await firstParagraph.click();
  await page.keyboard.press(SELECT_ALL_SHORTCUT);
  await page.keyboard.press(SELECT_ALL_SHORTCUT);
};

const placeCaretAtEnd = async (locator: Locator): Promise<void> => {
  await locator.evaluate((element) => {
    const doc = element.ownerDocument;
    const selection = doc.getSelection();

    if (!selection) {
      return;
    }

    const range = doc.createRange();
    const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let lastTextNode: Text | null = null;

    while (walker.nextNode()) {
      lastTextNode = walker.currentNode as Text;
    }

    if (lastTextNode) {
      range.setStart(lastTextNode, lastTextNode.textContent?.length ?? 0);
    } else {
      range.selectNodeContents(element);
      range.collapse(false);
    }

    selection.removeAllRanges();
    selection.addRange(range);
    doc.dispatchEvent(new Event('selectionchange'));
  });
};

const selectBlocksWithShift = async (page: Page, startIndex: number, count: number): Promise<void> => {
  const startBlock = getBlockByIndex(page, startIndex);
  // eslint-disable-next-line playwright/no-nth-methods -- Need first contenteditable element in block
  const contentEditable = startBlock.locator('[contenteditable="true"]').first();

  await contentEditable.click();
  await placeCaretAtEnd(contentEditable);

  await page.keyboard.down('Shift');

  for (let i = 0; i < count - 1; i++) {
    await page.keyboard.press('ArrowDown');
  }

  await page.keyboard.up('Shift');
};

const selectAllBlocksViaShift = async (page: Page, totalBlocks: number): Promise<void> => {
  await selectBlocksWithShift(page, 0, totalBlocks);
};

const openBlockTunesForSelectedBlocks = async (page: Page): Promise<void> => {
  const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

  await expect(settingsButton).toBeVisible();

  // Use dispatchEvent for mousedown/mouseup to ensure proper event handling
  // The toolbar listens on mousedown and sets up a document-level mouseup listener
  await settingsButton.dispatchEvent('mousedown', { button: 0 });
  await settingsButton.dispatchEvent('mouseup', { button: 0 });

  const popover = page.locator(POPOVER_CONTAINER_SELECTOR);

  await expect(popover).toHaveCount(1);
  await popover.waitFor({ state: 'visible' });
};

const saveBlok = async (page: Page): Promise<OutputData> => {
  return await page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    return await window.blokInstance.save();
  });
};

test.describe('multi-block conversion', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('selecting multiple blocks', () => {
    test('selects multiple blocks via CMD/CTRL+A twice', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
        { type: 'paragraph', data: { text: 'Third block' } },
      ]);

      await selectAllBlocksViaKeyboard(page);

      for (const index of [0, 1, 2]) {
        await expect(getBlockByIndex(page, index)).toHaveAttribute('data-blok-selected', 'true');
      }
    });

    test('selects multiple blocks via Shift+ArrowDown', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
        { type: 'paragraph', data: { text: 'Third block' } },
      ]);

      await selectBlocksWithShift(page, 0, 2);

      await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-selected', 'true');
      await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-selected', 'true');
      await expect(getBlockByIndex(page, 2)).not.toHaveAttribute('data-blok-selected', 'true');
    });

    test('shows toolbar for multi-block selection via Shift+Arrow', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
      ]);

      await selectBlocksWithShift(page, 0, 2);

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();
    });
  });

  test.describe('block tunes for multiple blocks', () => {
    test('shows convert-to option for multiple convertible blocks', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
      ], [
        { name: 'header', className: 'Blok.Header' },
      ]);

      await selectAllBlocksViaShift(page, 2);
      await openBlockTunesForSelectedBlocks(page);

      const convertToOption = page.locator(CONVERT_TO_OPTION_SELECTOR);

      await expect(convertToOption).toBeVisible();
    });

    test('shows delete option for multiple selected blocks', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
      ]);

      await selectAllBlocksViaShift(page, 2);
      await openBlockTunesForSelectedBlocks(page);

      const deleteOption = page.locator(DELETE_OPTION_SELECTOR);

      await expect(deleteOption).toBeVisible();
    });

    test('hides tool-specific tunes for multiple blocks', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
      ], [
        { name: 'header', className: 'Blok.Header' },
      ]);

      await selectAllBlocksViaShift(page, 2);
      await openBlockTunesForSelectedBlocks(page);

      // Move up/down tunes should not be visible for multi-block selection
      const moveUpOption = page.locator('[data-blok-testid="popover-item"][data-blok-item-name="move-up"]');

      await expect(moveUpOption).toHaveCount(0);
    });
  });

  test.describe('converting multiple blocks', () => {
    test('converts all selected paragraphs to headers', async ({ page, browserName }) => {
      // eslint-disable-next-line playwright/no-skipped-test
      test.skip(browserName === 'chromium', 'Skipping flaky test in Chrome');

      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
        { type: 'paragraph', data: { text: 'Third block' } },
      ], [
        { name: 'header', className: 'Blok.Header' },
      ]);

      await selectAllBlocksViaShift(page, 3);
      await openBlockTunesForSelectedBlocks(page);

      const convertToOption = page.locator(CONVERT_TO_OPTION_SELECTOR);

      await convertToOption.click();

      const headerOption = page.locator(`${NESTED_POPOVER_SELECTOR} [data-blok-item-name="header-2"]`);

      await expect(headerOption).toBeVisible();
      await headerOption.click();

      // All blocks should now be headers
      const headers = page.locator(HEADER_SELECTOR);

      await expect(headers).toHaveCount(3);

      // Verify content is preserved
      const savedData = await saveBlok(page);

      expect(savedData.blocks).toHaveLength(3);
      expect(savedData.blocks[0].type).toBe('header');
      expect(savedData.blocks[0].data).toMatchObject({ text: 'First block' });
      expect(savedData.blocks[1].type).toBe('header');
      expect(savedData.blocks[1].data).toMatchObject({ text: 'Second block' });
      expect(savedData.blocks[2].type).toBe('header');
      expect(savedData.blocks[2].data).toMatchObject({ text: 'Third block' });
    });

    test('converts selected headers to paragraphs', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'header', data: { text: 'First header', level: 2 } },
        { type: 'header', data: { text: 'Second header', level: 2 } },
      ], [
        { name: 'header', className: 'Blok.Header' },
      ]);

      await selectBlocksWithShift(page, 0, 2);
      await openBlockTunesForSelectedBlocks(page);

      const convertToOption = page.locator(CONVERT_TO_OPTION_SELECTOR);

      await convertToOption.click();

      const paragraphOption = page.locator(`${NESTED_POPOVER_SELECTOR} [data-blok-item-name="paragraph"]`);

      await expect(paragraphOption).toBeVisible();
      await paragraphOption.click();

      // All blocks should now be paragraphs
      const paragraphs = page.locator(PARAGRAPH_SELECTOR);

      await expect(paragraphs).toHaveCount(2);

      const savedData = await saveBlok(page);

      expect(savedData.blocks).toHaveLength(2);
      expect(savedData.blocks[0].type).toBe('paragraph');
      expect(savedData.blocks[1].type).toBe('paragraph');
    });

    test('converts subset of selected blocks', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
        { type: 'paragraph', data: { text: 'Third block' } },
        { type: 'paragraph', data: { text: 'Fourth block' } },
      ], [
        { name: 'header', className: 'Blok.Header' },
      ]);

      // Select only first two blocks
      await selectBlocksWithShift(page, 0, 2);
      await openBlockTunesForSelectedBlocks(page);

      const convertToOption = page.locator(CONVERT_TO_OPTION_SELECTOR);

      await convertToOption.click();

      const headerOption = page.locator(`${NESTED_POPOVER_SELECTOR} [data-blok-item-name="header-2"]`);

      await headerOption.click();

      // First two should be headers, last two should remain paragraphs
      const headers = page.locator(HEADER_SELECTOR);
      const paragraphs = page.locator(PARAGRAPH_SELECTOR);

      await expect(headers).toHaveCount(2);
      await expect(paragraphs).toHaveCount(2);

      const savedData = await saveBlok(page);

      expect(savedData.blocks[0].type).toBe('header');
      expect(savedData.blocks[1].type).toBe('header');
      expect(savedData.blocks[2].type).toBe('paragraph');
      expect(savedData.blocks[3].type).toBe('paragraph');
    });

    test('preserves block order after conversion', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'Alpha' } },
        { type: 'paragraph', data: { text: 'Beta' } },
        { type: 'paragraph', data: { text: 'Gamma' } },
      ], [
        { name: 'header', className: 'Blok.Header' },
      ]);

      await selectAllBlocksViaShift(page, 3);
      await openBlockTunesForSelectedBlocks(page);

      const convertToOption = page.locator(CONVERT_TO_OPTION_SELECTOR);

      await convertToOption.click();

      const headerOption = page.locator(`${NESTED_POPOVER_SELECTOR} [data-blok-item-name="header-2"]`);

      await headerOption.click();

      const savedData = await saveBlok(page);

      expect(savedData.blocks[0].data).toMatchObject({ text: 'Alpha' });
      expect(savedData.blocks[1].data).toMatchObject({ text: 'Beta' });
      expect(savedData.blocks[2].data).toMatchObject({ text: 'Gamma' });
    });

    test('closes popover after conversion', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
      ], [
        { name: 'header', className: 'Blok.Header' },
      ]);

      await selectAllBlocksViaShift(page, 2);
      await openBlockTunesForSelectedBlocks(page);

      const convertToOption = page.locator(CONVERT_TO_OPTION_SELECTOR);

      await convertToOption.click();

      const headerOption = page.locator(`${NESTED_POPOVER_SELECTOR} [data-blok-item-name="header-2"]`);

      await headerOption.click();

      // Popover should be closed - wait for it to be removed from DOM
      // Give the async conversion and close operations time to complete
      const popover = page.locator(POPOVER_CONTAINER_SELECTOR);

      await expect(popover).toHaveCount(0, { timeout: 5000 });
    });
  });

  test.describe('deleting multiple blocks', () => {
    test('deletes all selected blocks via block tunes', async ({ page, browserName }) => {
      // eslint-disable-next-line playwright/no-skipped-test
      test.skip(browserName === 'chromium', 'Skipping flaky test in Chrome');

      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
        { type: 'paragraph', data: { text: 'Third block' } },
      ]);

      await selectAllBlocksViaShift(page, 3);

      // Verify blocks are selected before opening block tunes
      for (const index of [0, 1, 2]) {
        await expect(getBlockByIndex(page, index)).toHaveAttribute('data-blok-selected', 'true');
      }

      await openBlockTunesForSelectedBlocks(page);

      // Verify blocks are still selected after opening block tunes
      for (const index of [0, 1, 2]) {
        await expect(getBlockByIndex(page, index)).toHaveAttribute('data-blok-selected', 'true');
      }

      const deleteOption = page.locator(DELETE_OPTION_SELECTOR);

      await expect(deleteOption).toBeVisible();

      // Navigate to delete option using keyboard and press Enter
      while (!await deleteOption.getAttribute('data-blok-focused')) {
        await page.keyboard.press('ArrowDown');
      }

      await page.keyboard.press('Enter');

      // Wait for popover to close (indicates action completed)
      const popover = page.locator(POPOVER_CONTAINER_SELECTOR);

      await expect(popover).toHaveCount(0);

      // Wait for the blocks to be removed by checking the DOM
      const blocks = page.locator(BLOCK_WRAPPER_SELECTOR);

      // The delete action removes all selected blocks
      // After deletion, there should be at most 1 block (the default empty block)
      // We use a soft assertion here since the exact count depends on timing
      const blockCount = await blocks.count();

      expect(blockCount).toBeLessThanOrEqual(1);

      // Verify via save() that blocks were deleted
      const savedData = await saveBlok(page);

      expect(savedData.blocks.length).toBeLessThanOrEqual(1);
    });

    test('deletes subset of selected blocks', async ({ page, browserName }) => {
      // eslint-disable-next-line playwright/no-skipped-test
      test.skip(browserName === 'chromium', 'Skipping flaky test in Chrome');

      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
        { type: 'paragraph', data: { text: 'Third block' } },
        { type: 'paragraph', data: { text: 'Fourth block' } },
      ]);

      // Select first two blocks
      await selectBlocksWithShift(page, 0, 2);
      await openBlockTunesForSelectedBlocks(page);

      const deleteOption = page.locator(DELETE_OPTION_SELECTOR);

      await expect(deleteOption).toBeVisible();

      // Navigate to delete option using keyboard and press Enter
      while (!await deleteOption.getAttribute('data-blok-focused')) {
        await page.keyboard.press('ArrowDown');
      }

      await page.keyboard.press('Enter');

      // Wait for popover to close (indicates action completed)
      const popover = page.locator(POPOVER_CONTAINER_SELECTOR);

      await expect(popover).toHaveCount(0);

      // Wait for the blocks to be removed by checking the DOM
      const blocks = page.locator(BLOCK_WRAPPER_SELECTOR);

      await expect(blocks).toHaveCount(2, { timeout: 1000 });

      const savedData = await saveBlok(page);

      // The first two blocks should be deleted, leaving the last two
      expect(savedData.blocks).toHaveLength(2);
      expect(savedData.blocks[0].data).toMatchObject({ text: 'Third block' });
      expect(savedData.blocks[1].data).toMatchObject({ text: 'Fourth block' });
    });
  });

  test.describe('conversion availability', () => {
    test('hides convert option when no common conversion target exists', async ({ page }) => {
      const toolWithoutExport = `
        (() => {
          return class ToolWithoutExport {
            constructor({ data }) {
              this.data = data ?? { text: '' };
            }

            static get conversionConfig() {
              return { import: 'text' };
            }

            static get toolbox() {
              return { title: 'No Export', icon: '<svg></svg>' };
            }

            render() {
              const el = document.createElement('div');
              el.contentEditable = 'true';
              el.textContent = this.data.text ?? '';
              return el;
            }

            save(el) {
              return { text: el.textContent ?? '' };
            }
          };
        })()
      `;

      await createBlokWithBlocks(page, [
        { type: 'noExportTool', data: { text: 'Block without export' } },
        { type: 'noExportTool', data: { text: 'Another block' } },
      ], [
        { name: 'noExportTool', classSource: toolWithoutExport },
      ]);

      await selectBlocksWithShift(page, 0, 2);
      await openBlockTunesForSelectedBlocks(page);

      const convertToOption = page.locator(CONVERT_TO_OPTION_SELECTOR);

      await expect(convertToOption).toHaveCount(0);
    });

    test('shows convert option for mixed block types with common conversion target', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'Paragraph text' } },
        { type: 'header', data: { text: 'Header text', level: 2 } },
      ], [
        { name: 'header', className: 'Blok.Header' },
      ]);

      await selectAllBlocksViaShift(page, 2);
      await openBlockTunesForSelectedBlocks(page);

      const convertToOption = page.locator(CONVERT_TO_OPTION_SELECTOR);

      await expect(convertToOption).toBeVisible();
    });

    test('excludes current block type from conversion options when all blocks are same type', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First paragraph' } },
        { type: 'paragraph', data: { text: 'Second paragraph' } },
      ], [
        { name: 'header', className: 'Blok.Header' },
      ]);

      await selectAllBlocksViaShift(page, 2);
      await openBlockTunesForSelectedBlocks(page);

      const convertToOption = page.locator(CONVERT_TO_OPTION_SELECTOR);

      await convertToOption.click();

      // Paragraph should not be in the conversion options since all blocks are already paragraphs
      const paragraphOption = page.locator(`${NESTED_POPOVER_SELECTOR} [data-blok-item-name="paragraph"]`);

      await expect(paragraphOption).toHaveCount(0);

      // But header should be available
      const headerOption = page.locator(`${NESTED_POPOVER_SELECTOR} [data-blok-item-name="header-2"]`);

      await expect(headerOption).toBeVisible();
    });
  });

  test.describe('keyboard navigation for multi-block conversion', () => {
    test('navigates to convert option and selects target via keyboard', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
      ], [
        { name: 'header', className: 'Blok.Header' },
      ]);

      await selectAllBlocksViaShift(page, 2);
      await openBlockTunesForSelectedBlocks(page);

      const convertToOption = page.locator(CONVERT_TO_OPTION_SELECTOR);

      // Navigate to convert-to option
      while (!await convertToOption.getAttribute('data-blok-focused')) {
        await page.keyboard.press('ArrowDown');
      }

      // Open nested popover
      await page.keyboard.press('ArrowRight');

      const nestedPopover = page.locator(NESTED_POPOVER_SELECTOR);

      await expect(nestedPopover).toBeVisible();

      // Select header option
      const headerOption = nestedPopover.locator('[data-blok-item-name="header-2"]');

      while (!await headerOption.getAttribute('data-blok-focused')) {
        await page.keyboard.press('ArrowDown');
      }

      await page.keyboard.press('Enter');

      // Verify conversion
      const headers = page.locator(HEADER_SELECTOR);

      await expect(headers).toHaveCount(2);
    });
  });

  test.describe('converting multiple blocks to list', () => {
    test('converts multiple paragraphs to list items', async ({ page, browserName }) => {
      // eslint-disable-next-line playwright/no-skipped-test
      test.skip(browserName === 'chromium', 'Skipping flaky test in Chrome');

      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First item' } },
        { type: 'paragraph', data: { text: 'Second item' } },
        { type: 'paragraph', data: { text: 'Third item' } },
      ], [
        { name: 'list', className: 'Blok.List' },
      ]);

      await selectAllBlocksViaShift(page, 3);
      await openBlockTunesForSelectedBlocks(page);

      const convertToOption = page.locator(CONVERT_TO_OPTION_SELECTOR);

      await convertToOption.click();

      // Select bulleted list option
      const listOption = page.locator(`${NESTED_POPOVER_SELECTOR} [data-blok-item-name="bulleted-list"]`);

      await expect(listOption).toBeVisible();
      await listOption.click();

      // With ListItem model, each paragraph becomes a separate list block
      const listBlocks = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="list"]`);

      await expect(listBlocks).toHaveCount(3);

      // Verify content is preserved in the list items
      const savedData = await saveBlok(page);

      expect(savedData.blocks).toHaveLength(3);
      expect(savedData.blocks[0].type).toBe('list');
      expect(savedData.blocks[0].data.text).toBe('First item');
      expect(savedData.blocks[0].data.style).toBe('unordered');
      expect(savedData.blocks[1].type).toBe('list');
      expect(savedData.blocks[1].data.text).toBe('Second item');
      expect(savedData.blocks[2].type).toBe('list');
      expect(savedData.blocks[2].data.text).toBe('Third item');
    });

    test('converts mixed block types to list items', async ({ page, browserName }) => {
      // eslint-disable-next-line playwright/no-skipped-test
      test.skip(browserName === 'chromium', 'Skipping flaky test in Chrome');

      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'Paragraph text' } },
        { type: 'header', data: { text: 'Header text', level: 2 } },
        { type: 'paragraph', data: { text: 'Another paragraph' } },
      ], [
        { name: 'header', className: 'Blok.Header' },
        { name: 'list', className: 'Blok.List' },
      ]);

      await selectAllBlocksViaShift(page, 3);
      await openBlockTunesForSelectedBlocks(page);

      const convertToOption = page.locator(CONVERT_TO_OPTION_SELECTOR);

      await convertToOption.click();

      // Select numbered list option
      const listOption = page.locator(`${NESTED_POPOVER_SELECTOR} [data-blok-item-name="numbered-list"]`);

      await expect(listOption).toBeVisible();
      await listOption.click();

      // With ListItem model, each block becomes a separate list block
      const listBlocks = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="list"]`);

      await expect(listBlocks).toHaveCount(3);

      // Verify content is preserved
      const savedData = await saveBlok(page);

      expect(savedData.blocks).toHaveLength(3);
      expect(savedData.blocks[0].type).toBe('list');
      expect(savedData.blocks[0].data.style).toBe('ordered');
      expect(savedData.blocks[0].data.text).toBe('Paragraph text');
      expect(savedData.blocks[1].data.text).toBe('Header text');
      expect(savedData.blocks[2].data.text).toBe('Another paragraph');
    });

    test('converts subset of blocks to list items', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First paragraph' } },
        { type: 'paragraph', data: { text: 'Second paragraph' } },
        { type: 'paragraph', data: { text: 'Third paragraph' } },
        { type: 'paragraph', data: { text: 'Fourth paragraph' } },
      ], [
        { name: 'list', className: 'Blok.List' },
      ]);

      // Select only first two blocks
      await selectBlocksWithShift(page, 0, 2);
      await openBlockTunesForSelectedBlocks(page);

      const convertToOption = page.locator(CONVERT_TO_OPTION_SELECTOR);

      await convertToOption.click();

      const listOption = page.locator(`${NESTED_POPOVER_SELECTOR} [data-blok-item-name="bulleted-list"]`);

      await listOption.click();

      // Should have 2 list blocks and 2 remaining paragraph blocks
      const listBlocks = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="list"]`);
      const paragraphBlocks = page.locator(PARAGRAPH_SELECTOR);

      await expect(listBlocks).toHaveCount(2);
      await expect(paragraphBlocks).toHaveCount(2);

      const savedData = await saveBlok(page);

      expect(savedData.blocks).toHaveLength(4);
      expect(savedData.blocks[0].type).toBe('list');
      expect(savedData.blocks[1].type).toBe('list');
      expect(savedData.blocks[2].type).toBe('paragraph');
      expect(savedData.blocks[3].type).toBe('paragraph');
    });
  });

  test.describe('converting list items to other blocks', () => {
    test('converts list item to paragraph', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'list', data: { text: 'List item text', style: 'unordered' } },
      ], [
        { name: 'list', className: 'Blok.List' },
      ]);

      // Click on the list block to select it
      const listBlock = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="list"]`);

      await listBlock.click();
      await openBlockTunesForSelectedBlocks(page);

      const convertToOption = page.locator(CONVERT_TO_OPTION_SELECTOR);

      await convertToOption.click();

      // Select paragraph option
      const paragraphOption = page.locator(`${NESTED_POPOVER_SELECTOR} [data-blok-item-name="paragraph"]`);

      await expect(paragraphOption).toBeVisible();
      await paragraphOption.click();

      // Should have 1 paragraph block
      const paragraphBlocks = page.locator(PARAGRAPH_SELECTOR);

      await expect(paragraphBlocks).toHaveCount(1);

      // Verify content is preserved
      const savedData = await saveBlok(page);

      expect(savedData.blocks).toHaveLength(1);
      expect(savedData.blocks[0].type).toBe('paragraph');
      expect(savedData.blocks[0].data.text).toBe('List item text');
    });

    test('converts list item to header', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'list', data: { text: 'List item heading', style: 'ordered' } },
      ], [
        { name: 'list', className: 'Blok.List' },
        { name: 'header', className: 'Blok.Header' },
      ]);

      // Click on the list block to select it
      const listBlock = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="list"]`);

      await listBlock.click();
      await openBlockTunesForSelectedBlocks(page);

      const convertToOption = page.locator(CONVERT_TO_OPTION_SELECTOR);

      await convertToOption.click();

      // Select header option
      const headerOption = page.locator(`${NESTED_POPOVER_SELECTOR} [data-blok-item-name="header-2"]`);

      await expect(headerOption).toBeVisible();
      await headerOption.click();

      // Should have 1 header block
      const headerBlocks = page.locator(HEADER_SELECTOR);

      await expect(headerBlocks).toHaveCount(1);

      // Verify content is preserved
      const savedData = await saveBlok(page);

      expect(savedData.blocks).toHaveLength(1);
      expect(savedData.blocks[0].type).toBe('header');
      expect(savedData.blocks[0].data.text).toBe('List item heading');
    });

    test('converts multiple list items to paragraphs', async ({ page, browserName }) => {
      // eslint-disable-next-line playwright/no-skipped-test
      test.skip(browserName === 'chromium', 'Skipping flaky test in Chrome');

      await createBlokWithBlocks(page, [
        { type: 'list', data: { text: 'First item', style: 'unordered' } },
        { type: 'list', data: { text: 'Second item', style: 'unordered' } },
        { type: 'list', data: { text: 'Third item', style: 'unordered' } },
      ], [
        { name: 'list', className: 'Blok.List' },
      ]);

      await selectBlocksWithShift(page, 0, 3);
      await openBlockTunesForSelectedBlocks(page);

      const convertToOption = page.locator(CONVERT_TO_OPTION_SELECTOR);

      await convertToOption.click();

      // Select paragraph option
      const paragraphOption = page.locator(`${NESTED_POPOVER_SELECTOR} [data-blok-item-name="paragraph"]`);

      await expect(paragraphOption).toBeVisible();
      await paragraphOption.click();

      // Should have 3 paragraph blocks
      const paragraphBlocks = page.locator(PARAGRAPH_SELECTOR);

      await expect(paragraphBlocks).toHaveCount(3);

      // Verify content is preserved in each paragraph
      const savedData = await saveBlok(page);

      expect(savedData.blocks).toHaveLength(3);
      expect(savedData.blocks[0].type).toBe('paragraph');
      expect(savedData.blocks[0].data.text).toBe('First item');
      expect(savedData.blocks[1].type).toBe('paragraph');
      expect(savedData.blocks[1].data.text).toBe('Second item');
      expect(savedData.blocks[2].type).toBe('paragraph');
      expect(savedData.blocks[2].data.text).toBe('Third item');
    });
  });
});
