import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { BlokConfig, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

/**
 * Notion-parity e2e coverage for:
 *  - m-17 / m-18: default Cmd+C writes Markdown markers (`- `, `1. `, `- [x]`,
 *    `- [ ]`) to the text/plain clipboard flavor instead of stripped text.
 *  - M-7: Shift+Click selects the inclusive contiguous block range.
 */

const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-element]`;
const SELECTED_SELECTOR = `${BLOCK_SELECTOR}[data-blok-selected="true"]`;

const getBlockByIndex = (page: Page, index: number): Locator =>
  page.locator(BLOCK_SELECTOR).nth(index);

const getEditableByIndex = (page: Page, index: number): Locator =>
  getBlockByIndex(page, index).locator('[contenteditable="true"]').first();

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
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, data: OutputData): Promise<void> => {
  await resetBlok(page);

  await page.evaluate(async ({ holder, blokData }) => {
    const config = {
      holder,
      data: blokData,
    } as unknown as BlokConfig;

    const blok = new window.Blok(config);

    await blok.isReady;
    window.blokInstance = blok;
  }, { holder: HOLDER_ID, blokData: data });

  await page.waitForSelector(BLOCK_SELECTOR);
};

/**
 * Dispatch a synthetic `copy` event on the given element and capture the data
 * the editor writes to the clipboard. Mirrors the helper used in
 * copy-paste.spec.ts (the editor's copy handler reads from the DataTransfer).
 */
const copyFromElement = async (locator: Locator): Promise<Record<string, string>> => {
  return await locator.evaluate((element) => {
    return new Promise<Record<string, string>>((resolve) => {
      const clipboardStore: Record<string, string> = {};

      if (typeof ClipboardEvent !== 'function' || typeof DataTransfer !== 'function') {
        resolve(clipboardStore);

        return;
      }

      const dataTransfer = new DataTransfer();
      const originalSetData = dataTransfer.setData.bind(dataTransfer);

      dataTransfer.setData = (format: string, data: string): void => {
        clipboardStore[format] = data;
        originalSetData(format, data);
      };

      const event = new ClipboardEvent('copy', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      });

      if (event.clipboardData !== dataTransfer) {
        Object.defineProperty(event, 'clipboardData', {
          value: dataTransfer,
          writable: false,
          configurable: true,
        });
      }

      element.dispatchEvent(event);

      setTimeout(() => {
        Array.from(dataTransfer.types).forEach((format) => {
          if (!(format in clipboardStore)) {
            clipboardStore[format] = dataTransfer.getData(format);
          }
        });

        resolve(clipboardStore);
      }, 0);
    });
  });
};

const listData = (
  items: Array<{ text: string; checked?: boolean }>,
  style: 'unordered' | 'ordered' | 'checklist'
): OutputData => ({
  blocks: items.map((item, index) => ({
    id: `list-${index}`,
    type: 'list',
    data: {
      text: item.text,
      style,
      checked: item.checked ?? false,
    },
  })),
} as unknown as OutputData);

const paragraphData = (texts: string[]): OutputData => ({
  blocks: texts.map((text, index) => ({
    id: `p-${index}`,
    type: 'paragraph',
    data: { text },
  })),
} as unknown as OutputData);

/**
 * Select the inclusive range [0, blockCount-1] via a click + a Shift+Click (the
 * M-7 path) — deterministic and tool-agnostic, so it sets up a copy reliably.
 */
const selectAllBlocks = async (page: Page, blockCount: number): Promise<void> => {
  await getEditableByIndex(page, 0).click();
  await getEditableByIndex(page, blockCount - 1).click({ modifiers: ['Shift'] });

  await expect(page.locator(SELECTED_SELECTOR)).toHaveCount(blockCount);
};

test.describe('Notion parity: list selection & copy', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('m17: default Cmd+C of a bulleted list writes "- " markers to text/plain', async ({ page }) => {
    await createBlok(page, listData([{ text: 'Buy milk' }, { text: 'Buy eggs' }], 'unordered'));

    await selectAllBlocks(page, 2);

    const clipboard = await copyFromElement(getEditableByIndex(page, 0));

    expect(clipboard['text/plain']).toContain('- Buy milk\n- Buy eggs');
  });

  test('m17: default Cmd+C of a numbered list writes "1. " markers to text/plain', async ({ page }) => {
    await createBlok(page, listData([{ text: 'First' }, { text: 'Second' }], 'ordered'));

    await selectAllBlocks(page, 2);

    const clipboard = await copyFromElement(getEditableByIndex(page, 0));

    expect(clipboard['text/plain']).toContain('1. First\n1. Second');
  });

  test('m18: default Cmd+C of a to-do list writes "- [x]"/"- [ ]" markers to text/plain', async ({ page }) => {
    await createBlok(page, listData([
      { text: 'Done task', checked: true },
      { text: 'Open task', checked: false },
    ], 'checklist'));

    await selectAllBlocks(page, 2);

    const clipboard = await copyFromElement(getEditableByIndex(page, 0));

    expect(clipboard['text/plain']).toContain('- [x] Done task\n- [ ] Open task');
  });

  test('M7: Shift+Click selects the inclusive contiguous block range', async ({ page }) => {
    await createBlok(page, paragraphData(['Alpha', 'Bravo', 'Charlie', 'Delta']));

    // Place the caret in the first block, then Shift+Click the third block.
    await getEditableByIndex(page, 0).click();
    await getEditableByIndex(page, 2).click({ modifiers: ['Shift'] });

    // Blocks 0..2 inclusive are selected; block 3 is not.
    await expect(page.locator(SELECTED_SELECTOR)).toHaveCount(3);
    await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 2)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 3)).not.toHaveAttribute('data-blok-selected', 'true');
  });

  test('M7: Shift+Click extends the range upward when clicking above the caret block', async ({ page }) => {
    await createBlok(page, paragraphData(['Alpha', 'Bravo', 'Charlie', 'Delta']));

    await getEditableByIndex(page, 3).click();
    await getEditableByIndex(page, 1).click({ modifiers: ['Shift'] });

    await expect(page.locator(SELECTED_SELECTOR)).toHaveCount(3);
    await expect(getBlockByIndex(page, 0)).not.toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 3)).toHaveAttribute('data-blok-selected', 'true');
  });
});
