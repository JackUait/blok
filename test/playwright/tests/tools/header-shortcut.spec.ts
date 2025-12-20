import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const HEADER_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="header"]`;
const PARAGRAPH_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`;

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

const defaultTools: Record<string, SerializableToolConfig> = {
  header: {
    className: 'Blok.Header',
  },
  paragraph: {
    className: 'Blok.Paragraph',
  },
};

test.describe('header shortcuts', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('basic conversions', () => {
    test('converts "# " to H1', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              id: 'test-para',
              type: 'paragraph',
              data: {
                text: '',
              },
            },
          ],
        },
      });

      // Click on the paragraph
      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR).first();
      await paragraph.click();

      // Type the shortcut
      await page.keyboard.type('# ');

      // Wait for conversion to happen
      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);
      await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toHaveCount(0);

      // Verify level is 1 via save
      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks).toHaveLength(1);
      expect(savedData?.blocks[0].type).toBe('header');
      expect(savedData?.blocks[0].data.level).toBe(1);
    });

    test('converts "## " to H2', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR).first();
      await paragraph.click();

      await page.keyboard.type('## ');

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].data.level).toBe(2);
    });

    test('converts "### " to H3', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR).first();
      await paragraph.click();

      await page.keyboard.type('### ');

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].data.level).toBe(3);
    });

    test('converts "#### " to H4', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR).first();
      await paragraph.click();

      await page.keyboard.type('#### ');

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].data.level).toBe(4);
    });

    test('converts "##### " to H5', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR).first();
      await paragraph.click();

      await page.keyboard.type('##### ');

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].data.level).toBe(5);
    });

    test('converts "###### " to H6', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR).first();
      await paragraph.click();

      await page.keyboard.type('###### ');

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].data.level).toBe(6);
    });
  });

  test.describe('content preservation', () => {
    test('preserves text after shortcut when converting', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              id: 'test-para',
              type: 'paragraph',
              data: {
                text: 'Hello World',
              },
            },
          ],
        },
      });

      // Click at the start of the paragraph and set cursor position programmatically
      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();
      await page.evaluate(() => {
        const para = document.querySelector('[data-blok-tool="paragraph"]');
        if (para) {
          const range = document.createRange();
          const selection = window.getSelection();
          range.setStart(para, 0);
          range.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      });

      // Type the shortcut at the start
      await page.keyboard.type('## ');

      // Should be converted to header
      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      // Verify text is preserved
      const header = page.locator(HEADER_BLOCK_SELECTOR);
      await expect(header).toHaveText('Hello World');

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].data.text).toBe('Hello World');
      expect(savedData?.blocks[0].data.level).toBe(2);
    });

    test('preserves HTML formatting when converting', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              id: 'test-para',
              type: 'paragraph',
              data: {
                text: '<b>Bold</b> text',
              },
            },
          ],
        },
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();
      await page.evaluate(() => {
        const para = document.querySelector('[data-blok-tool="paragraph"]');
        if (para) {
          const range = document.createRange();
          const selection = window.getSelection();
          range.setStart(para, 0);
          range.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      });

      await page.keyboard.type('### ');

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      // Verify HTML is preserved (editor may normalize <b> to <strong>)
      const header = page.locator(HEADER_BLOCK_SELECTOR);
      const html = await header.innerHTML();
      expect(html).toMatch(/<(b|strong)>Bold<\/(b|strong)>/);
    });
  });

  test.describe('edge cases', () => {
    test('does not convert when 7 or more # characters', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR).first();
      await paragraph.click();

      // Type 7 hashes - should NOT convert
      await page.keyboard.type('####### ');

      // Should remain a paragraph
      await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toHaveCount(1);
      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(0);

      // The text "####### " should remain in the paragraph
      await expect(paragraph).toHaveText('####### ');
    });

    test('does not convert when # is typed mid-paragraph', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [
            {
              id: 'test-para',
              type: 'paragraph',
              data: {
                text: 'Some text',
              },
            },
          ],
        },
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();

      // Type "## " in the middle (after existing text)
      await page.keyboard.type(' ## ');

      // Should remain a paragraph
      await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toHaveCount(1);
      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(0);
    });

    test('does not convert when Header tool is not registered', async ({ page }) => {
      // Create blok without header tool
      await createBlok(page, {
        tools: {},
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR).first();
      await paragraph.click();

      await page.keyboard.type('## ');

      // Should remain a paragraph since header tool is not available
      await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toHaveCount(1);
      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(0);

      // The text "## " should remain in the paragraph
      await expect(paragraph).toHaveText('## ');
    });
  });

  test.describe('config respect', () => {
    test('converts only when level is in allowed levels config', async ({ page }) => {
      await createBlok(page, {
        tools: {
          header: {
            className: 'Blok.Header',
            config: {
              levels: [2, 3, 4], // Only allow H2, H3, H4
            },
          },
        },
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR).first();
      await paragraph.click();

      // Type H3 shortcut (allowed)
      await page.keyboard.type('### ');

      // Should be converted
      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].data.level).toBe(3);
    });

    test('does not convert when level is not in allowed levels config', async ({ page }) => {
      await createBlok(page, {
        tools: {
          header: {
            className: 'Blok.Header',
            config: {
              levels: [2, 3, 4], // Only allow H2, H3, H4
            },
          },
        },
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR).first();
      await paragraph.click();

      // Type H1 shortcut (not allowed)
      await page.keyboard.type('# ');

      // Should remain a paragraph
      await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toHaveCount(1);
      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(0);

      // The text "# " should remain in the paragraph
      await expect(paragraph).toHaveText('# ');
    });

    test('allows all levels when levels config is not specified', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools, // No levels config
      });

      // Test that all levels work (spot check H1 and H6)
      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR).first();
      await paragraph.click();

      await page.keyboard.type('# ');

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      let savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].data.level).toBe(1);

      // Delete the header and try H6
      await page.evaluate(async () => {
        await window.blokInstance?.blocks.delete(0);
      });

      // Wait for paragraph to appear
      await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toHaveCount(1);

      const newParagraph = page.locator(PARAGRAPH_BLOCK_SELECTOR).first();
      await newParagraph.click();

      await page.keyboard.type('###### ');

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks[0].data.level).toBe(6);
    });
  });
});
