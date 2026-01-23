import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '../../../../../types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="paragraph"]`;
const LIST_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="list"]`;
const HEADER_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="header"]`;

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

const createBlokWithBlocks = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder, blocks: blokBlocks }) => {
    // Resolve tools from window
    const ParagraphTool = 'Blok.Paragraph'.split('.').reduce((obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key], window);
    const HeaderTool = 'Blok.Header'.split('.').reduce((obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key], window);
    const ListTool = 'Blok.List'.split('.').reduce((obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key], window);

    // Use BlokOriginal to avoid default tools and explicitly configure
    const BlokClass = (window as unknown as Record<string, unknown>).BlokOriginal as typeof window.Blok;

    const blok = new BlokClass({
      holder: holder,
      tools: {
        paragraph: { class: ParagraphTool, inlineToolbar: true, config: { preserveBlank: true } },
        header: { class: HeaderTool, inlineToolbar: true },
        list: { class: ListTool, inlineToolbar: true },
      },
      data: { blocks: blokBlocks },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, {
    holder: HOLDER_ID,
    blocks,
  });
};

const createParagraphBlok = async (page: Page, textBlocks: string[]): Promise<void> => {
  const blocks: OutputData['blocks'] = textBlocks.map((text) => ({
    type: 'paragraph',
    data: { text },
  }));

  await createBlokWithBlocks(page, blocks);
};

const getBlockByIndex = (page: Page, index: number) => {
  return page.locator(`:nth-match(${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"], ${index + 1})`);
};

test.describe('markdown shortcuts', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('unordered list shortcuts', () => {
    test('converts "- " to unordered list when space is typed', async ({ page }) => {
      await createParagraphBlok(page, ['']);

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await paragraph.click();
      await page.keyboard.type('- ');

      // Wait for conversion to list
      const listBlock = page.locator(LIST_BLOCK_SELECTOR);

      await expect(listBlock).toBeVisible();

      const { blocks } = await page.evaluate(async () => await window.blokInstance?.save() as OutputData);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('list');
      expect((blocks[0].data as { style: string }).style).toBe('unordered');
    });

    test('converts "* " to unordered list when space is typed', async ({ page }) => {
      await createParagraphBlok(page, ['']);

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await paragraph.click();
      await page.keyboard.type('* ');

      // Wait for conversion to list
      const listBlock = page.locator(LIST_BLOCK_SELECTOR);

      await expect(listBlock).toBeVisible();

      const { blocks } = await page.evaluate(async () => await window.blokInstance?.save() as OutputData);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('list');
      expect((blocks[0].data as { style: string }).style).toBe('unordered');
    });

    test('does not convert when not at the start of block', async ({ page }) => {
      await createParagraphBlok(page, ['text']);

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await paragraph.click();
      await page.keyboard.type('- ');

      // Should remain a paragraph
      const listBlock = page.locator(LIST_BLOCK_SELECTOR);

      await expect(listBlock).toBeHidden();
      await expect(paragraph).toBeVisible();
    });

    test('preserves inline formatting after the shortcut', async ({ page }) => {
      await createParagraphBlok(page, ['']);

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await paragraph.click();
      await paragraph.type('- <b>bold</b>');

      const { blocks } = await page.evaluate(async () => await window.blokInstance?.save() as OutputData);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('list');
      expect((blocks[0].data as { text: string }).text).toContain('bold');
    });
  });

  test.describe('ordered list shortcuts', () => {
    test('converts "1. " to ordered list when space is typed', async ({ page }) => {
      await createParagraphBlok(page, ['']);

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await paragraph.click();
      await page.keyboard.type('1. ');

      const listBlock = page.locator(LIST_BLOCK_SELECTOR);

      await expect(listBlock).toBeVisible();

      const { blocks } = await page.evaluate(async () => await window.blokInstance?.save() as OutputData);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('list');
      expect((blocks[0].data as { style: string }).style).toBe('ordered');
    });

    test('converts "1) " to ordered list when space is typed', async ({ page }) => {
      await createParagraphBlok(page, ['']);

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await paragraph.click();
      await page.keyboard.type('1) ');

      const listBlock = page.locator(LIST_BLOCK_SELECTOR);

      await expect(listBlock).toBeVisible();

      const { blocks } = await page.evaluate(async () => await window.blokInstance?.save() as OutputData);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('list');
      expect((blocks[0].data as { style: string }).style).toBe('ordered');
    });

    test('sets start number when using non-1 prefix', async ({ page }) => {
      await createParagraphBlok(page, ['']);

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await paragraph.click();
      await page.keyboard.type('5. ');

      const listBlock = page.locator(LIST_BLOCK_SELECTOR);

      await expect(listBlock).toBeVisible();

      const { blocks } = await page.evaluate(async () => await window.blokInstance?.save() as OutputData);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('list');
      expect((blocks[0].data as { style: string; start?: number }).style).toBe('ordered');
      expect((blocks[0].data as { style: string; start?: number }).start).toBe(5);
    });
  });

  test.describe('checklist shortcuts', () => {
    test('converts [] " to unchecked checklist when space is typed', async ({ page }) => {
      await createParagraphBlok(page, ['']);

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await paragraph.click();
      await page.keyboard.type('[] ');

      const listBlock = page.locator(LIST_BLOCK_SELECTOR);

      await expect(listBlock).toBeVisible();

      const { blocks } = await page.evaluate(async () => await window.blokInstance?.save() as OutputData);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('list');
      expect((blocks[0].data as { style: string }).style).toBe('checklist');
      expect((blocks[0].data as { checked: boolean }).checked).toBe(false);
    });

    test('converts [x] " to checked checklist when space is typed', async ({ page }) => {
      await createParagraphBlok(page, ['']);

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await paragraph.click();
      await page.keyboard.type('[x] ');

      const listBlock = page.locator(LIST_BLOCK_SELECTOR);

      await expect(listBlock).toBeVisible();

      const { blocks } = await page.evaluate(async () => await window.blokInstance?.save() as OutputData);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('list');
      expect((blocks[0].data as { style: string }).style).toBe('checklist');
      expect((blocks[0].data as { checked: boolean }).checked).toBe(true);
    });

    test('converts [X] " to checked checklist when space is typed', async ({ page }) => {
      await createParagraphBlok(page, ['']);

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await paragraph.click();
      await page.keyboard.type('[X] ');

      const listBlock = page.locator(LIST_BLOCK_SELECTOR);

      await expect(listBlock).toBeVisible();

      const { blocks } = await page.evaluate(async () => await window.blokInstance?.save() as OutputData);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('list');
      expect((blocks[0].data as { checked: boolean }).checked).toBe(true);
    });
  });

  test.describe('header shortcuts', () => {
    test('converts "# " to level 1 header when space is typed', async ({ page }) => {
      await createParagraphBlok(page, ['']);

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await paragraph.click();
      await page.keyboard.type('# ');

      const headerBlock = page.locator(HEADER_BLOCK_SELECTOR);

      await expect(headerBlock).toBeVisible();

      const { blocks } = await page.evaluate(async () => await window.blokInstance?.save() as OutputData);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('header');
      expect((blocks[0].data as { level: number }).level).toBe(1);
    });

    test('converts "## " to level 2 header when space is typed', async ({ page }) => {
      await createParagraphBlok(page, ['']);

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await paragraph.click();
      await page.keyboard.type('## ');

      const headerBlock = page.locator(HEADER_BLOCK_SELECTOR);

      await expect(headerBlock).toBeVisible();

      const { blocks } = await page.evaluate(async () => await window.blokInstance?.save() as OutputData);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('header');
      expect((blocks[0].data as { level: number }).level).toBe(2);
    });

    test('converts "### " to level 3 header when space is typed', async ({ page }) => {
      await createParagraphBlok(page, ['']);

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await paragraph.click();
      await page.keyboard.type('### ');

      const headerBlock = page.locator(HEADER_BLOCK_SELECTOR);

      await expect(headerBlock).toBeVisible();

      const { blocks } = await page.evaluate(async () => await window.blokInstance?.save() as OutputData);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('header');
      expect((blocks[0].data as { level: number }).level).toBe(3);
    });

    test('converts "###### " to level 6 header when space is typed', async ({ page }) => {
      await createParagraphBlok(page, ['']);

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await paragraph.click();
      await page.keyboard.type('###### ');

      const headerBlock = page.locator(HEADER_BLOCK_SELECTOR);

      await expect(headerBlock).toBeVisible();

      const { blocks } = await page.evaluate(async () => await window.blokInstance?.save() as OutputData);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('header');
      expect((blocks[0].data as { level: number }).level).toBe(6);
    });
  });

  test.describe('depth preservation', () => {
    test('preserves depth when converting to list in nested structure', async ({ page }) => {
      await resetBlok(page);

      // Create blocks with a list at depth 1
      await page.evaluate(async ({ holder }) => {
        // Get List tool from window
        const ListTool = 'Blok.List'.split('.').reduce((obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key], window);

        if (!ListTool) {
          throw new Error('List tool is not available');
        }

        const blok = new window.Blok({
          holder: holder,
          tools: {
            list: { class: ListTool, inlineToolbar: true },
          },
          data: {
            blocks: [
              {
                id: 'block1',
                type: 'list',
                data: {
                  text: 'parent item',
                  style: 'unordered',
                },
              },
              {
                id: 'block2',
                type: 'list',
                data: {
                  text: 'child item',
                  style: 'unordered',
                  depth: 1,
                },
              },
            ],
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      }, { holder: HOLDER_ID });

      // Delete the child list item content to make it empty
      const childBlock = getBlockByIndex(page, 1);

      await childBlock.click();

      const childInput = childBlock.locator('[contenteditable="true"]');

      await childInput.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.type('- ');

      // Should convert to list but preserve depth 1
      await expect(page.locator(LIST_BLOCK_SELECTOR)).toHaveCount(2);

      const { blocks } = await page.evaluate(async () => await window.blokInstance?.save() as OutputData);

      expect(blocks).toHaveLength(2);
      expect(blocks[1].type).toBe('list');
      expect((blocks[1].data as { depth?: number }).depth).toBe(1);
    });
  });

  test.describe('edge cases', () => {
    test('does not convert when tool is not the default paragraph tool', async ({ page }) => {
      await resetBlok(page);

      await page.evaluate(async ({ holder }) => {
        // Get Header tool from window
        const HeaderTool = 'Blok.Header'.split('.').reduce((obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key], window);

        if (!HeaderTool) {
          throw new Error('Header tool is not available');
        }

        const blok = new window.Blok({
          holder: holder,
          tools: {
            header: { class: HeaderTool, inlineToolbar: true },
          },
          data: {
            blocks: [
              {
                id: 'block1',
                type: 'header',
                data: {
                  text: 'Already a header',
                  level: 1,
                },
              },
            ],
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      }, { holder: HOLDER_ID });

      const headerBlock = getBlockByIndex(page, 0);
      const headerInput = headerBlock.locator('[contenteditable="true"]');

      await headerInput.click();
      await page.keyboard.type('- ');

      // Should remain a header, not convert to list
      const listBlocks = page.locator(LIST_BLOCK_SELECTOR);

      await expect(listBlocks).toHaveCount(0);

      const { blocks } = await page.evaluate(async () => await window.blokInstance?.save() as OutputData);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('header');
    });

    test('requires space to trigger conversion', async ({ page }) => {
      await createParagraphBlok(page, ['']);

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await paragraph.click();
      await page.keyboard.type('-');

      const listBlock = page.locator(LIST_BLOCK_SELECTOR);

      await expect(listBlock).toBeHidden();
      await expect(paragraph).toBeVisible();

      const { blocks } = await page.evaluate(async () => await window.blokInstance?.save() as OutputData);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('paragraph');
      expect((blocks[0].data as { text: string }).text).toBe('-');
    });

    test('converts when space is typed after the shortcut pattern', async ({ page }) => {
      await createParagraphBlok(page, ['']);

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await paragraph.click();
      await page.keyboard.type('-');

      // Should still be paragraph
      const { blocks: blocksBefore } = await page.evaluate(async () => await window.blokInstance?.save() as OutputData);

      expect(blocksBefore[0].type).toBe('paragraph');

      // Now type the space
      await page.keyboard.type(' ');

      // Should convert to list
      const listBlock = page.locator(LIST_BLOCK_SELECTOR);

      await expect(listBlock).toBeVisible();

      const { blocks: blocksAfter } = await page.evaluate(async () => await window.blokInstance?.save() as OutputData);

      expect(blocksAfter).toHaveLength(1);
      expect(blocksAfter[0].type).toBe('list');
    });
  });
});

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}
