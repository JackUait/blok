/**
 * Tests for block movement keyboard shortcuts
 * Validates that:
 * 1. Cmd/Ctrl+Shift+ArrowUp moves the current block up
 * 2. Cmd/Ctrl+Shift+ArrowDown moves the current block down
 * 3. Focus is preserved after moving, allowing consecutive moves
 * 4. Boundary conditions are handled (first block can't move up, last can't move down)
 * 5. Undo/redo works correctly after block movement
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type Blok from '@/types';
import type { OutputData } from '@/types';
import { MODIFIER_KEY } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'blok';

/**
 * Wait time to allow history debounce to complete
 */
const HISTORY_DEBOUNCE_WAIT = 300;

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

const createBlok = async (
  page: Page,
  options: { data?: OutputData; config?: Record<string, unknown> } = {}
): Promise<void> => {
  const { data = null, config = {} } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, initialData, config: providedConfig }) => {
      const blokConfig: Record<string, unknown> = {
        holder,
        autofocus: true,
        ...providedConfig,
      };

      if (initialData) {
        blokConfig.data = initialData;
      }

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      initialData: data,
      config,
    }
  );
};

const saveBlok = async (page: Page): Promise<OutputData> => {
  return await page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    return await window.blokInstance.save();
  });
};

/**
 * Helper to check if the editor has focus
 */
const isEditorFocused = async (page: Page): Promise<boolean> => {
  return await page.evaluate(() => {
    const activeElement = document.activeElement;

    if (!activeElement) {
      return false;
    }

    const editorWrapper = document.querySelector('[data-blok-testid="blok"]');

    return editorWrapper?.contains(activeElement) ?? false;
  });
};

/**
 * Wait for a specified delay
 */
const waitForDelay = async (page: Page, delayMs: number): Promise<void> => {
  await page.evaluate(
    async (timeout) => {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, timeout);
      });
    },
    delayMs
  );
};

test.describe('block movement shortcuts', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('move block up (Cmd/Ctrl+Shift+ArrowUp)', () => {
    test('moves the current block up by one position', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'First' } },
            { type: 'paragraph', data: { text: 'Second' } },
            { type: 'paragraph', data: { text: 'Third' } },
          ],
        },
      });

      // Click on the second block to focus it
      const secondBlock = page.getByText('Second');

      await secondBlock.click();

      // Press Cmd/Ctrl+Shift+ArrowUp to move the block up
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+ArrowUp`);

      // Verify the block order has changed
      const { blocks } = await saveBlok(page);

      expect(blocks).toHaveLength(3);
      expect((blocks[0]?.data as { text: string }).text).toBe('Second');
      expect((blocks[1]?.data as { text: string }).text).toBe('First');
      expect((blocks[2]?.data as { text: string }).text).toBe('WRONG VALUE');
    });

    test('does nothing when the first block is selected', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'First' } },
            { type: 'paragraph', data: { text: 'Second' } },
          ],
        },
      });

      // Click on the first block
      const firstBlock = page.getByText('First');

      await firstBlock.click();

      // Try to move up (should do nothing)
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+ArrowUp`);

      // Verify order is unchanged
      const { blocks } = await saveBlok(page);

      expect((blocks[0]?.data as { text: string }).text).toBe('First');
      expect((blocks[1]?.data as { text: string }).text).toBe('Second');
    });

    test('preserves focus after moving, allowing consecutive moves', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'First' } },
            { type: 'paragraph', data: { text: 'Second' } },
            { type: 'paragraph', data: { text: 'Third' } },
          ],
        },
      });

      // Click on the third block
      const thirdBlock = page.getByText('Third');

      await thirdBlock.click();

      // Move up twice in a row
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+ArrowUp`);
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+ArrowUp`);

      // Verify the block moved from position 2 to position 0
      const { blocks } = await saveBlok(page);

      expect((blocks[0]?.data as { text: string }).text).toBe('Third');
      expect((blocks[1]?.data as { text: string }).text).toBe('First');
      expect((blocks[2]?.data as { text: string }).text).toBe('Second');

      // Verify focus is still in the editor
      const focused = await isEditorFocused(page);

      expect(focused).toBe(true);
    });
  });

  test.describe('move block down (Cmd/Ctrl+Shift+ArrowDown)', () => {
    test('moves the current block down by one position', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'First' } },
            { type: 'paragraph', data: { text: 'Second' } },
            { type: 'paragraph', data: { text: 'Third' } },
          ],
        },
      });

      // Click on the second block
      const secondBlock = page.getByText('Second');

      await secondBlock.click();

      // Press Cmd/Ctrl+Shift+ArrowDown to move the block down
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+ArrowDown`);

      // Verify the block order has changed
      const { blocks } = await saveBlok(page);

      expect(blocks).toHaveLength(3);
      expect((blocks[0]?.data as { text: string }).text).toBe('First');
      expect((blocks[1]?.data as { text: string }).text).toBe('Third');
      expect((blocks[2]?.data as { text: string }).text).toBe('Second');
    });

    test('does nothing when the last block is selected', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'First' } },
            { type: 'paragraph', data: { text: 'Second' } },
          ],
        },
      });

      // Click on the last block
      const lastBlock = page.getByText('Second');

      await lastBlock.click();

      // Try to move down (should do nothing)
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+ArrowDown`);

      // Verify order is unchanged
      const { blocks } = await saveBlok(page);

      expect((blocks[0]?.data as { text: string }).text).toBe('First');
      expect((blocks[1]?.data as { text: string }).text).toBe('Second');
    });

    test('preserves focus after moving, allowing consecutive moves', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'First' } },
            { type: 'paragraph', data: { text: 'Second' } },
            { type: 'paragraph', data: { text: 'Third' } },
          ],
        },
      });

      // Click on the first block
      const firstBlock = page.getByText('First');

      await firstBlock.click();

      // Move down twice in a row
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+ArrowDown`);
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+ArrowDown`);

      // Verify the block moved from position 0 to position 2
      const { blocks } = await saveBlok(page);

      expect((blocks[0]?.data as { text: string }).text).toBe('Second');
      expect((blocks[1]?.data as { text: string }).text).toBe('Third');
      expect((blocks[2]?.data as { text: string }).text).toBe('First');

      // Verify focus is still in the editor
      const focused = await isEditorFocused(page);

      expect(focused).toBe(true);
    });
  });

  test.describe('undo/redo integration', () => {
    test('block movement can be undone', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'First' } },
            { type: 'paragraph', data: { text: 'Second' } },
          ],
        },
      });

      // Click on the second block
      const secondBlock = page.getByText('Second');

      await secondBlock.click();

      // Move the block up
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+ArrowUp`);

      // Wait for history to record
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify block was moved
      let { blocks } = await saveBlok(page);

      expect((blocks[0]?.data as { text: string }).text).toBe('Second');
      expect((blocks[1]?.data as { text: string }).text).toBe('First');

      // Undo the move
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify blocks are back to original order
      ({ blocks } = await saveBlok(page));
      expect((blocks[0]?.data as { text: string }).text).toBe('First');
      expect((blocks[1]?.data as { text: string }).text).toBe('Second');
    });

    test('block movement can be redone after undo', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'First' } },
            { type: 'paragraph', data: { text: 'Second' } },
          ],
        },
      });

      // Click on the second block
      const secondBlock = page.getByText('Second');

      await secondBlock.click();

      // Move the block up
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+ArrowUp`);

      // Wait for history to record
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Undo
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Redo
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+z`);
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify block is moved again
      const { blocks } = await saveBlok(page);

      expect((blocks[0]?.data as { text: string }).text).toBe('Second');
      expect((blocks[1]?.data as { text: string }).text).toBe('First');
    });
  });

  test.describe('edge cases', () => {
    test('works with a single block (no movement possible)', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'Only block' } },
          ],
        },
      });

      const block = page.getByText('Only block');

      await block.click();

      // Try both directions - neither should cause errors
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+ArrowUp`);
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+ArrowDown`);

      // Verify the block is still there and unchanged
      const { blocks } = await saveBlok(page);

      expect(blocks).toHaveLength(1);
      expect((blocks[0]?.data as { text: string }).text).toBe('Only block');
    });

    test('shortcut does not trigger when focus is outside the editor', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'First' } },
            { type: 'paragraph', data: { text: 'Second' } },
          ],
        },
      });

      // Create an input outside the editor and focus it
      await page.evaluate(() => {
        const input = document.createElement('input');

        input.id = 'external-input';
        input.type = 'text';
        input.setAttribute('data-blok-testid', 'external-input');
        document.body.appendChild(input);
      });

      await page.getByTestId('external-input').focus();

      // Try to move block (should not work since focus is outside editor)
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+ArrowUp`);

      // Verify blocks are unchanged
      const { blocks } = await saveBlok(page);

      expect((blocks[0]?.data as { text: string }).text).toBe('First');
      expect((blocks[1]?.data as { text: string }).text).toBe('Second');
    });
  });
});
