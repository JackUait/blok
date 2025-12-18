import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Blok } from '../../../../../types';
import type { OutputData } from '../../../../../types';
import { ensureBlokBundleBuilt } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../../fixtures/test.html')
).href;
const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable]`;

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

const createParagraphBlok = async (page: Page, paragraphs: string[]): Promise<void> => {
  const blocks: OutputData['blocks'] = paragraphs.map((text) => ({
    type: 'paragraph',
    data: { text },
  }));

  await resetBlok(page);
  await page.evaluate(async ({ holder, blocks: blokBlocks }) => {
    const blok = new window.Blok({
      holder: holder,
      data: { blocks: blokBlocks },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID,
    blocks });
};

const selectText = async (locator: Locator, text: string): Promise<void> => {
  await locator.evaluate((element, targetText) => {
    const textNode = element.firstChild;

    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      throw new Error('Element does not contain a text node');
    }

    const content = textNode.textContent ?? '';
    const start = content.indexOf(targetText);

    if (start === -1) {
      throw new Error(`Text "${targetText}" was not found`);
    }

    const range = element.ownerDocument.createRange();

    range.setStart(textNode, start);
    range.setEnd(textNode, start + targetText.length);

    const selection = element.ownerDocument.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
  }, text);
};

const saveBlok = async (page: Page): Promise<OutputData> => {
  return page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance is not initialized');
    }

    return window.blokInstance.save();
  });
};

const getLastItem = <T>(items: T[]): T => {
  const lastItem = items.at(-1);

  if (!lastItem) {
    throw new Error('Expected to receive at least one item');
  }

  return lastItem;
};

test.describe('enter keydown', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('@smoke should split block and remove selected fragment when part of text is selected', async ({ page }) => {
    await createParagraphBlok(page, [ 'The block with some text' ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await paragraph.click();
    await selectText(paragraph, 'with so');
    await page.keyboard.press('Enter');

    const { blocks } = await saveBlok(page);

    expect(blocks).toHaveLength(2);
    expect((blocks[0].data as { text: string }).text).toBe('The block ');
    expect((blocks[1].data as { text: string }).text).toBe('me text');
  });

  test('should place caret into new block when Enter pressed at block end', async ({ page }) => {
    await createParagraphBlok(page, [ 'The block with some text' ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await paragraph.click();
    await paragraph.press('End');
    await paragraph.press('Enter');

    const blockCount = page.locator(BLOCK_SELECTOR);

    await expect(blockCount).toHaveCount(2);

    const blockHandles = await page.locator(BLOCK_SELECTOR).elementHandles();
    const lastBlockHandle = getLastItem(blockHandles);

    const caretInsideLastBlock = await lastBlockHandle.evaluate((element) => {
      const selection = element.ownerDocument?.getSelection();

      if (!selection || selection.rangeCount === 0) {
        return false;
      }

      const range = selection.getRangeAt(0);

      return element.contains(range.startContainer);
    });

    expect(caretInsideLastBlock).toBeTruthy();
  });

  test('should not create new block if Enter was handled by the Tool (preventDefault called)', async ({ page }) => {
    const PREVENT_DEFAULT_TOOL_SOURCE = `class PreventDefaultTool {
      static get enableLineBreaks() {
        return false;
      }

      static get toolbox() {
        return {
            icon: 'P',
            title: 'Prevent Default Tool'
        };
      }

      render() {
        const div = document.createElement('div');
        div.contentEditable = 'true';
        div.innerHTML = 'Prevent Default Tool';

        div.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
          }
        });

        return div;
      }

      save(block) {
        return {
          text: block.innerHTML
        };
      }
    }`;

    await resetBlok(page);

    await page.evaluate(async ({ holder, toolSource }) => {
      const PreventDefaultTool = new Function(`return (${toolSource});`)();

      const blok = new window.Blok({
        holder: holder,
        tools: {
          preventDefaultTool: {
            class: PreventDefaultTool,
          },
        },
        data: {
          blocks: [
            {
              type: 'preventDefaultTool',
              data: {
                text: 'Prevent Default Tool',
              },
            },
          ],
        },
      });

      window.blokInstance = blok;
      await blok.isReady;
    }, { holder: HOLDER_ID,
      toolSource: PREVENT_DEFAULT_TOOL_SOURCE });

    const block = page.locator('[contenteditable=true]');

    await block.click();

    // Wait for focus
    await expect(block).toBeFocused();

    await page.keyboard.press('Enter');

    // Wait for potential reaction
    await expect(page.locator(BLOCK_SELECTOR)).toHaveCount(1);

    const { blocks } = await saveBlok(page);

    expect(blocks).toHaveLength(1);
  });
});

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

