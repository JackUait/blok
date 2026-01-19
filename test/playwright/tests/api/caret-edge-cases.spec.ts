import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

const HOLDER_ID = 'blok-';

type BlokSetupOptions = {
  data?: Record<string, unknown>;
  config?: Record<string, unknown>;
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

const createBlok = async (page: Page, options: BlokSetupOptions = {}): Promise<void> => {
  const { data, config } = options;

  await resetBlok(page);

  await page.evaluate(
    async ({ holder, rawData, rawConfig }) => {
      const blokConfig = {
        holder: holder,
        ...rawConfig,
        ...(rawData ? { data: rawData } : {}),
      };

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      rawData: data ?? null,
      rawConfig: config ?? {},
    }
  );
};

const clearSelection = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();

    const activeElement = document.activeElement as HTMLElement | null;

    activeElement?.blur?.();
  });
};

test.describe('caret edge cases - NBSP and boundary detection', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('handles NBSP character at start of block', async ({ page }) => {
    const blockData = {
      blocks: [
        {
          id: 'nbsp-start',
          type: 'paragraph',
          data: { text: '\u00A0text after nbsp' },
        },
      ],
    };

    await createBlok(page, { data: blockData });
    await clearSelection(page);

    const result = await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      const block = window.blokInstance.blocks.getById('nbsp-start');
      if (!block) {
        throw new Error('Block not found');
      }

      // Set caret to start
      window.blokInstance.caret.setToBlock(block, 'start');

      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0) {
        throw new Error('Selection was not set');
      }

      return {
        focusOffset: selection.focusOffset,
        focusTextContent: selection.focusNode?.textContent ?? '',
      };
    });

    // Should handle NBSP correctly
    expect(result.focusTextContent).toContain('\u00A0text after nbsp');
    expect(result.focusOffset).toBe(0);
  });

  test('handles NBSP character at end of block', async ({ page }) => {
    const blockData = {
      blocks: [
        {
          id: 'nbsp-end',
          type: 'paragraph',
          data: { text: 'text before nbsp\u00A0' },
        },
      ],
    };

    await createBlok(page, { data: blockData });
    await clearSelection(page);

    const result = await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      const block = window.blokInstance.blocks.getById('nbsp-end');
      if (!block) {
        throw new Error('Block not found');
      }

      // Set caret to end
      window.blokInstance.caret.setToBlock(block, 'end');

      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0) {
        throw new Error('Selection was not set');
      }

      return {
        focusOffset: selection.focusOffset,
        focusTextContent: selection.focusNode?.textContent ?? '',
      };
    });

    expect(result.focusTextContent).toBe('text before nbsp\u00A0');
    expect(result.focusOffset).toBe(result.focusTextContent.length);
  });

  test('handles multiple NBSP characters', async ({ page }) => {
    const blockData = {
      blocks: [
        {
          id: 'nbsp-multiple',
          type: 'paragraph',
          data: { text: '\u00A0\u00A0\u00A0text\u00A0\u00A0' },
        },
      ],
    };

    await createBlok(page, { data: blockData });
    await clearSelection(page);

    const result = await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      const block = window.blokInstance.blocks.getById('nbsp-multiple');
      if (!block) {
        throw new Error('Block not found');
      }

      window.blokInstance.caret.setToBlock(block, 'default', 4);

      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0) {
        throw new Error('Selection was not set');
      }

      return {
        focusOffset: selection.focusOffset,
      };
    });

    expect(result.focusOffset).toBe(4);
  });

  test('handles empty blocks with NBSP', async ({ page }) => {
    const blockData = {
      blocks: [
        {
          id: 'nbsp-empty',
          type: 'paragraph',
          data: { text: '\u00A0' },
        },
      ],
    };

    await createBlok(page, { data: blockData });
    await clearSelection(page);

    const result = await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      const block = window.blokInstance.blocks.getById('nbsp-empty');
      if (!block) {
        throw new Error('Block not found');
      }

      window.blokInstance.caret.setToBlock(block, 'end');

      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0) {
        throw new Error('Selection was not set');
      }

      return {
        focusOffset: selection.focusOffset,
        hasSelection: true,
      };
    });

    expect(result.hasSelection).toBe(true);
  });
});

test.describe('caret edge cases - Nested elements', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('handles deeply nested formatting', async ({ page }) => {
    const blockData = {
      blocks: [
        {
          id: 'nested',
          type: 'paragraph',
          data: { text: 'start<b>bold<i>italic</i>more</b>end' },
        },
      ],
    };

    await createBlok(page, { data: blockData });
    await clearSelection(page);

    const result = await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      const block = window.blokInstance.blocks.getById('nested');
      if (!block) {
        throw new Error('Block not found');
      }

      const blok = window.blokInstance;
      // Try to set caret at different positions
      const positions = [0, 5, 10, 15];

      return positions.map(pos => {
        blok.caret.setToBlock(block, 'default', pos);

        const selection = window.getSelection();

        if (!selection || selection.rangeCount === 0) {
          return { position: pos, success: false };
        }

        return {
          position: pos,
          success: true,
          offset: selection.focusOffset,
          nodeName: selection.focusNode?.parentNode?.nodeName ?? '',
        };
      });
    });

    // All positions should be set successfully
    result.forEach(r => {
      expect(r.success).toBe(true);
    });
  });

  test('handles caret at boundaries of nested elements', async ({ page }) => {
    const blockData = {
      blocks: [
        {
          id: 'boundaries',
          type: 'paragraph',
          data: { text: 'text<b>bold</b>more' },
        },
      ],
    };

    await createBlok(page, { data: blockData });
    await clearSelection(page);

    const result = await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      const block = window.blokInstance.blocks.getById('boundaries');
      if (!block) {
        throw new Error('Block not found');
      }

      const blok = window.blokInstance;
      // Test boundaries
      const tests = [
        { pos: 0, name: 'start' },
        { pos: 4, name: 'before bold' },
        { pos: 8, name: 'after bold' },
        { pos: 12, name: 'end' },
      ];

      return tests.map(test => {
        blok.caret.setToBlock(block, 'default', test.pos);

        const selection = window.getSelection();

        if (!selection || selection.rangeCount === 0) {
          return { name: test.name, success: false };
        }

        return {
          name: test.name,
          success: true,
          offset: selection.focusOffset,
          textContent: selection.focusNode?.textContent ?? '',
        };
      });
    });

    result.forEach(r => {
      expect(r.success).toBe(true);
    });
  });
});

test.describe('caret edge cases - Multi-line content', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('handles soft breaks in text', async ({ page }) => {
    const blockData = {
      blocks: [
        {
          id: 'multiline',
          type: 'paragraph',
          data: { text: 'line one<br>line two<br>line three' },
        },
      ],
    };

    await createBlok(page, { data: blockData });
    await clearSelection(page);

    const result = await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      const block = window.blokInstance.blocks.getById('multiline');
      if (!block) {
        throw new Error('Block not found');
      }

      window.blokInstance.caret.setToBlock(block, 'start');

      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0) {
        throw new Error('Selection was not set');
      }

      return {
        hasSelection: true,
        offset: selection.focusOffset,
      };
    });

    expect(result.hasSelection).toBe(true);
  });

  test('handles caret movement across lines', async ({ page }) => {
    const blockData = {
      blocks: [
        {
          id: 'lines-1',
          type: 'paragraph',
          data: { text: 'first line' },
        },
        {
          id: 'lines-2',
          type: 'paragraph',
          data: { text: 'second line' },
        },
      ],
    };

    await createBlok(page, { data: blockData });

    const result = await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      // Move to first block
      const firstBlock = window.blokInstance.blocks.getById('lines-1');
      if (!firstBlock) {
        throw new Error('First block not found');
      }

      window.blokInstance.caret.setToBlock(firstBlock, 'end');

      // Now move to next block
      const movedToNext = window.blokInstance.caret.setToNextBlock('start');

      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0) {
        return { movedToNext, hasSelection: false };
      }

      const currentBlockIndex = window.blokInstance.blocks.getCurrentBlockIndex();

      return {
        movedToNext,
        hasSelection: true,
        currentBlockIndex,
        textContent: selection.focusNode?.textContent ?? '',
      };
    });

    expect(result.movedToNext).toBe(true);
    expect(result.hasSelection).toBe(true);
    expect(result.currentBlockIndex).toBe(1);
  });
});

test.describe('caret edge cases - Special characters', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('handles unicode punctuation', async ({ page }) => {
    const blockData = {
      blocks: [
        {
          id: 'unicode',
          type: 'paragraph',
          data: { text: 'Hello\u2014world' }, // em dash
        },
      ],
    };

    await createBlok(page, { data: blockData });
    await clearSelection(page);

    const result = await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      const block = window.blokInstance.blocks.getById('unicode');
      if (!block) {
        throw new Error('Block not found');
      }

      window.blokInstance.caret.setToBlock(block, 'end');

      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0) {
        throw new Error('Selection was not set');
      }

      return {
        offset: selection.focusOffset,
        textContent: selection.focusNode?.textContent ?? '',
      };
    });

    expect(result.textContent).toBe('Hello\u2014world');
  });

  test('handles emoji in text', async ({ page }) => {
    const blockData = {
      blocks: [
        {
          id: 'emoji',
          type: 'paragraph',
          data: { text: 'Hello \u{1F600} world' }, // grin emoji
        },
      ],
    };

    await createBlok(page, { data: blockData });
    await clearSelection(page);

    const result = await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      const block = window.blokInstance.blocks.getById('emoji');
      if (!block) {
        throw new Error('Block not found');
      }

      window.blokInstance.caret.setToBlock(block, 'end');

      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0) {
        throw new Error('Selection was not set');
      }

      return {
        hasSelection: true,
        textContent: selection.focusNode?.textContent ?? '',
      };
    });

    expect(result.hasSelection).toBe(true);
    expect(result.textContent).toContain('Hello');
  });

  test('handles zero-width characters', async ({ page }) => {
    const blockData = {
      blocks: [
        {
          id: 'zero-width',
          type: 'paragraph',
          data: { text: 'start\u200Bend' }, // zero-width space
        },
      ],
    };

    await createBlok(page, { data: blockData });
    await clearSelection(page);

    const result = await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      const block = window.blokInstance.blocks.getById('zero-width');
      if (!block) {
        throw new Error('Block not found');
      }

      window.blokInstance.caret.setToBlock(block, 'end');

      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0) {
        throw new Error('Selection was not set');
      }

      return {
        hasSelection: true,
        textContent: selection.focusNode?.textContent ?? '',
      };
    });

    expect(result.hasSelection).toBe(true);
  });
});

test.describe('caret edge cases - Empty and whitespace-only content', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('handles completely empty block', async ({ page }) => {
    const blockData = {
      blocks: [
        {
          id: 'empty',
          type: 'paragraph',
          data: { text: '' },
        },
      ],
    };

    await createBlok(page, { data: blockData });
    await clearSelection(page);

    const result = await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      const block = window.blokInstance.blocks.getById('empty');
      if (!block) {
        throw new Error('Block not found');
      }

      window.blokInstance.caret.setToBlock(block, 'start');

      const selection = window.getSelection();

      return {
        hasSelection: selection !== null && selection.rangeCount > 0,
      };
    });

    expect(result.hasSelection).toBe(true);
  });

  test('handles whitespace-only block', async ({ page }) => {
    const blockData = {
      blocks: [
        {
          id: 'whitespace',
          type: 'paragraph',
          data: { text: '   ' },
        },
      ],
    };

    await createBlok(page, { data: blockData });
    await clearSelection(page);

    const result = await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      const block = window.blokInstance.blocks.getById('whitespace');
      if (!block) {
        throw new Error('Block not found');
      }

      window.blokInstance.caret.setToBlock(block, 'end');

      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0) {
        throw new Error('Selection was not set');
      }

      return {
        hasSelection: true,
        offset: selection.focusOffset,
      };
    });

    expect(result.hasSelection).toBe(true);
  });

  test('handles mixed whitespace characters', async ({ page }) => {
    const blockData = {
      blocks: [
        {
          id: 'mixed-ws',
          type: 'paragraph',
          data: { text: ' \t \n ' },
        },
      ],
    };

    await createBlok(page, { data: blockData });
    await clearSelection(page);

    const result = await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      const block = window.blokInstance.blocks.getById('mixed-ws');
      if (!block) {
        throw new Error('Block not found');
      }

      window.blokInstance.caret.setToBlock(block, 'start');

      const selection = window.getSelection();

      return {
        hasSelection: selection !== null && selection.rangeCount > 0,
      };
    });

    expect(result.hasSelection).toBe(true);
  });
});
