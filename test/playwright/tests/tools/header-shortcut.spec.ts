import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

/**
 * Type for a block with unknown data that can be narrowed
 */
type BlockWithUnknownData = {
  id?: string;
  type: string;
  data: unknown;
  tunes?: Record<string, unknown>;
  parent?: string;
  content?: string[];
};

/**
 * Type guard to check if block data has a 'level' property (for header blocks)
 */
const hasLevelProperty = (data: unknown): data is { level: number } & Record<string, unknown> => {
  return typeof data === 'object' && data !== null && 'level' in data && typeof (data as { level: unknown }).level === 'number';
};

/**
 * Type guard to check if block data has a 'text' property
 */
const hasTextProperty = (data: unknown): data is { text: string } & Record<string, unknown> => {
  return typeof data === 'object' && data !== null && 'text' in data && typeof (data as { text: unknown }).text === 'string';
};

/**
 * Get block data with narrowed type for header blocks
 * Returns the data if it has the expected properties, throws otherwise
 */
const getHeaderBlockData = (block: BlockWithUnknownData): { level: number; text: string } => {
  if (!hasLevelProperty(block.data) || !hasTextProperty(block.data)) {
    throw new Error(`Block data does not have expected header properties: ${JSON.stringify(block.data)}`);
  }
  return { level: block.data.level, text: block.data.text };
};

/**
 * Get just the level from block data with proper type narrowing
 */
const getBlockLevel = (block: BlockWithUnknownData): number => {
  if (!hasLevelProperty(block.data)) {
    throw new Error(`Block data does not have a level property: ${JSON.stringify(block.data)}`);
  }
  return block.data.level;
};

/**
 * Get just the text from block data with proper type narrowing
 */
const getBlockText = (block: BlockWithUnknownData): string => {
  if (!hasTextProperty(block.data)) {
    throw new Error(`Block data does not have a text property: ${JSON.stringify(block.data)}`);
  }
  return block.data.text;
};

/**
 * Assert that saved data exists and has at least one block
 * Returns the saved data for further use
 */
const assertSavedDataExists = (savedData: OutputData | null | undefined): OutputData => {
  if (!savedData || !savedData.blocks || savedData.blocks.length === 0) {
    throw new Error('Expected saved data to exist with at least one block');
  }
  return savedData;
};

const HOLDER_ID = 'blok';
const HEADER_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="header"]`;
const PARAGRAPH_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="paragraph"]`;

type SerializableToolConfig = {
  className?: string;
  config?: Record<string, unknown>;
};

type CreateBlokOptions = {
  data?: OutputData;
  tools?: Record<string, SerializableToolConfig>;
  useOriginalBlok?: boolean; // Use BlokOriginal without default tools
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
  const { data = null, tools = {}, useOriginalBlok = false } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  const serializedTools = Object.entries(tools).map(([name, tool]) => ({
    name,
    className: tool.className ?? null,
    config: tool.config ?? {},
  }));

  await page.evaluate(
    async ({ holder, data: initialData, serializedTools: toolsConfig, useOriginal }) => {
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

      // Use BlokOriginal (without default tools) when useOriginal is true
      const BlokClass = useOriginal ? (window as unknown as Window & { BlokOriginal: typeof window.Blok }).BlokOriginal : window.Blok;
      const blok = new BlokClass(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      data,
      serializedTools,
      useOriginal: useOriginalBlok,
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
      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();

      // Type the shortcut followed by some content
      await page.keyboard.type('# Heading');

      // Wait for conversion to happen
      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);
      await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toHaveCount(0);

      // Verify level is 1 via save
      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(savedData?.blocks).toHaveLength(1);
      expect(savedData?.blocks[0].type).toBe('header');
      const data = assertSavedDataExists(savedData);
      const blockData = getHeaderBlockData(data.blocks[0]);
      expect(blockData.level).toBe(1);
      expect(blockData.text).toBe('Heading');
    });

    test('converts "## " to H2', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [{ id: 'test-para', type: 'paragraph', data: { text: '' } }],
        },
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();

      await page.keyboard.type('## Heading');

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(getBlockLevel(assertSavedDataExists(savedData).blocks[0])).toBe(2);
    });

    test('converts "### " to H3', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [{ id: 'test-para', type: 'paragraph', data: { text: '' } }],
        },
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();

      await page.keyboard.type('### Heading');

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(getBlockLevel(assertSavedDataExists(savedData).blocks[0])).toBe(3);
    });

    test('converts "#### " to H4', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [{ id: 'test-para', type: 'paragraph', data: { text: '' } }],
        },
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();

      await page.keyboard.type('#### Heading');

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(getBlockLevel(assertSavedDataExists(savedData).blocks[0])).toBe(4);
    });

    test('converts "##### " to H5', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [{ id: 'test-para', type: 'paragraph', data: { text: '' } }],
        },
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();

      await page.keyboard.type('##### Heading');

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(getBlockLevel(assertSavedDataExists(savedData).blocks[0])).toBe(5);
    });

    test('converts "###### " to H6', async ({ page }) => {
      await createBlok(page, {
        tools: defaultTools,
        data: {
          blocks: [{ id: 'test-para', type: 'paragraph', data: { text: '' } }],
        },
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();

      await page.keyboard.type('###### Heading');

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(getBlockLevel(assertSavedDataExists(savedData).blocks[0])).toBe(6);
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

      const data = assertSavedDataExists(savedData);
      expect(getBlockText(data.blocks[0])).toBe('Hello World');
      expect(getBlockLevel(data.blocks[0])).toBe(2);
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

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
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
      // Create blok without header tool using BlokOriginal (no default tools)
      await createBlok(page, {
        useOriginalBlok: true,
        tools: {
          paragraph: { className: 'BlokParagraph' },
        },
        data: {
          blocks: [{ id: 'test-para', type: 'paragraph', data: { text: '' } }],
        },
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
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
          paragraph: { className: 'Blok.Paragraph' },
        },
        data: {
          blocks: [{ id: 'test-para', type: 'paragraph', data: { text: '' } }],
        },
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();

      // Type H3 shortcut (allowed) with text
      await page.keyboard.type('### Heading');

      // Should be converted
      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(getBlockLevel(assertSavedDataExists(savedData).blocks[0])).toBe(3);
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
          paragraph: { className: 'Blok.Paragraph' },
        },
        data: {
          blocks: [{ id: 'test-para', type: 'paragraph', data: { text: '' } }],
        },
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
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
        data: {
          blocks: [{ id: 'test-para', type: 'paragraph', data: { text: '' } }],
        },
      });

      // Test H6 (if this works, all levels work since regex limits to 1-6)
      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();

      await page.keyboard.type('###### Heading');

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(getBlockLevel(assertSavedDataExists(savedData).blocks[0])).toBe(6);
    });
  });

  test.describe('custom shortcuts', () => {
    test('uses custom shortcut when configured', async ({ page }) => {
      await createBlok(page, {
        tools: {
          header: {
            className: 'BlokHeader',
            config: {
              shortcuts: { 1: '!' },
            },
          },
          paragraph: {
            className: 'BlokParagraph',
          },
        },
        data: {
          blocks: [{ id: 'test-para', type: 'paragraph', data: { text: '' } }],
        },
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();

      await page.keyboard.type('! Custom Heading');

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      const data = assertSavedDataExists(savedData);
      const headerData = getHeaderBlockData(data.blocks[0]);
      expect(headerData.level).toBe(1);
      expect(headerData.text).toBe('Custom Heading');
    });

    test('default markdown shortcuts do not work when custom shortcuts are configured', async ({ page }) => {
      await createBlok(page, {
        tools: {
          header: {
            className: 'BlokHeader',
            config: {
              shortcuts: { 1: '!' }, // Only ! is configured, # should not work
            },
          },
          paragraph: {
            className: 'BlokParagraph',
          },
        },
        data: {
          blocks: [{ id: 'test-para', type: 'paragraph', data: { text: '' } }],
        },
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();

      await page.keyboard.type('# Should Not Convert');

      // Should remain a paragraph since # is not in custom shortcuts
      await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toHaveCount(1);
      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(0);
    });

    test('disables all shortcuts when empty object is configured', async ({ page }) => {
      await createBlok(page, {
        tools: {
          header: {
            className: 'BlokHeader',
            config: {
              shortcuts: {}, // Empty = no shortcuts
            },
          },
          paragraph: {
            className: 'BlokParagraph',
          },
        },
        data: {
          blocks: [{ id: 'test-para', type: 'paragraph', data: { text: '' } }],
        },
      });

      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      await paragraph.click();

      await page.keyboard.type('# Should Not Convert');

      // Should remain a paragraph
      await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toHaveCount(1);
      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(0);
    });

    test('uses H3 shortcut from multi-level config', async ({ page }) => {
      await createBlok(page, {
        tools: {
          header: {
            className: 'BlokHeader',
            config: {
              shortcuts: { 1: '!', 2: '!!', 3: '!!!' },
            },
          },
          paragraph: {
            className: 'BlokParagraph',
          },
        },
        data: {
          blocks: [{ id: 'test-para', type: 'paragraph', data: { text: '' } }],
        },
      });

      await page.locator(PARAGRAPH_BLOCK_SELECTOR).click();
      await page.keyboard.type('!!! H3');

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      expect(getBlockLevel(assertSavedDataExists(savedData).blocks[0])).toBe(3);
    });

    test('omitted levels have no shortcut', async ({ page }) => {
      await createBlok(page, {
        tools: {
          header: {
            className: 'BlokHeader',
            config: {
              shortcuts: { 2: '##' }, // Only H2 has a shortcut
            },
          },
          paragraph: {
            className: 'BlokParagraph',
          },
        },
        data: {
          blocks: [
            { id: 'para-1', type: 'paragraph', data: { text: '' } },
            { id: 'para-2', type: 'paragraph', data: { text: '' } },
          ],
        },
      });

      // Get both paragraphs - we know there are exactly 2 from the test setup
      const paragraphs = page.locator(PARAGRAPH_BLOCK_SELECTOR);

      // Try default markdown H1 shortcut (not configured since shortcuts is defined)
      // eslint-disable-next-line playwright/no-nth-methods
      await paragraphs.nth(0).click();
      await page.keyboard.type('# Should Stay Paragraph');

      // Should remain paragraph (default # shortcut doesn't work with custom shortcuts)
      await expect(page.locator(PARAGRAPH_BLOCK_SELECTOR)).toHaveCount(2);
      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(0);

      // Try H2 shortcut (configured as ##)
      // eslint-disable-next-line playwright/no-nth-methods
      await paragraphs.nth(1).click();
      await page.keyboard.type('## H2');

      await expect(page.locator(HEADER_BLOCK_SELECTOR)).toHaveCount(1);

      const savedData = await page.evaluate(async () => {
        return await window.blokInstance?.save();
      });

      // First block should be paragraph with "# Should Stay Paragraph"
      expect(savedData?.blocks[0].type).toBe('paragraph');
      // Second block should be H2
      const data = assertSavedDataExists(savedData);
      expect(getBlockLevel(data.blocks[1])).toBe(2);
    });
  });
});
