import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const REDACTOR_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="redactor"]`;

declare global {
  interface Window {
    blokInstance?: Blok;
    __mobileLayoutToggledEvents?: Array<{ isEnabled: boolean; timestamp: number }>;
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

const createBlok = async (page: Page, options: { data?: OutputData; readOnly?: boolean } = {}): Promise<void> => {
  const { data, readOnly } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokData, readOnlyMode }) => {
      const blokConfig: Record<string, unknown> = {
        holder: holder,
      };

      if (blokData !== null) {
        blokConfig.data = blokData;
      }

      if (typeof readOnlyMode === 'boolean') {
        blokConfig.readOnly = readOnlyMode;
      }

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      blokData: data ?? null,
      readOnlyMode: typeof readOnly === 'boolean' ? readOnly : null,
    }
  );
};

test.describe('mobile viewport detection and layout toggle', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);

    // Set up event listener to track BlokMobileLayoutToggled events
    await page.evaluate(() => {
      window.__mobileLayoutToggledEvents = [];
    });
  });

  test('detects mobile viewport on initialization', async ({ page }) => {
    // Set mobile viewport size
    await page.setViewportSize({ width: 400, height: 800 });

    await createBlok(page);

    const isMobile = await page.evaluate(() => {
      const blok = window.blokInstance;
      return blok ? (blok as { isMobile?: boolean }).isMobile : false;
    });

    expect(isMobile).toBe(true);
  });

  test('detects desktop viewport on initialization', async ({ page }) => {
    // Set desktop viewport size
    await page.setViewportSize({ width: 1200, height: 800 });

    await createBlok(page);

    const isMobile = await page.evaluate(() => {
      const blok = window.blokInstance;
      return blok ? (blok as { isMobile?: boolean }).isMobile : false;
    });

    expect(isMobile).toBe(false);
  });

  test('updates mobile state when window is resized from desktop to mobile', async ({ page }) => {
    // Start with desktop viewport
    await page.setViewportSize({ width: 1200, height: 800 });

    await createBlok(page);

    let isMobile = await page.evaluate(() => {
      const blok = window.blokInstance;
      return blok ? (blok as { isMobile?: boolean }).isMobile : false;
    });

    expect(isMobile).toBe(false);

    // Resize to mobile viewport (below 650px breakpoint)
    await page.setViewportSize({ width: 500, height: 800 });

    // Trigger resize event
    await page.evaluate(() => {
      window.dispatchEvent(new Event('resize'));
    });

    // Wait a bit for the debounced handler
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(250);

    isMobile = await page.evaluate(() => {
      const blok = window.blokInstance;
      return blok ? (blok as { isMobile?: boolean }).isMobile : false;
    });

    expect(isMobile).toBe(true);
  });

  test('updates mobile state when window is resized from mobile to desktop', async ({ page }) => {
    // Start with mobile viewport
    await page.setViewportSize({ width: 500, height: 800 });

    await createBlok(page);

    let isMobile = await page.evaluate(() => {
      const blok = window.blokInstance;
      return blok ? (blok as { isMobile?: boolean }).isMobile : false;
    });

    expect(isMobile).toBe(true);

    // Resize to desktop viewport (above 650px breakpoint)
    await page.setViewportSize({ width: 1200, height: 800 });

    // Trigger resize event
    await page.evaluate(() => {
      window.dispatchEvent(new Event('resize'));
    });

    // Wait a bit for the debounced handler
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(250);

    isMobile = await page.evaluate(() => {
      const blok = window.blokInstance;
      return blok ? (blok as { isMobile?: boolean }).isMobile : false;
    });

    expect(isMobile).toBe(false);
  });
});

test.describe('read-only toggle coordination with controllers', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('keyboard shortcuts work in read-write mode', async ({ page }) => {
    const initialData: OutputData = {
      blocks: [
        {
          type: 'paragraph',
          data: {
            text: 'First block',
          },
        },
      ],
    };

    await createBlok(page, { data: initialData, readOnly: false });

    const paragraph = page.locator(PARAGRAPH_SELECTOR);
    await paragraph.click();

    // Type some text
    await page.keyboard.type(' - more text');

    const savedData = await page.evaluate(async () => {
      const blok = window.blokInstance;
      return blok ? await blok.save() : { blocks: [] };
    });

    expect((savedData.blocks[0]?.data as { text?: string } | undefined)?.text).toBe('First block - more text');
  });

  test('keyboard shortcuts are disabled in read-only mode', async ({ page }) => {
    const initialData: OutputData = {
      blocks: [
        {
          type: 'paragraph',
          data: {
            text: 'First block',
          },
        },
        {
          type: 'paragraph',
          data: {
            text: 'Second block',
          },
        },
      ],
    };

    await createBlok(page, { data: initialData, readOnly: true });

    const firstParagraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'First block' });
    await firstParagraph.click();

    // Try to type - in read-only mode, this should not work
    await page.keyboard.type(' - should not appear');

    const textContent = await firstParagraph.evaluate((el) => {
      // In read-only mode, contenteditable is "false", so query for the element with any contenteditable attribute
      const contentEditable = el.querySelector('[contenteditable]');
      return contentEditable?.textContent ?? '';
    });

    expect(textContent).toBe('First block');
  });

  test('block hover detection works in read-write mode', async ({ page }) => {
    const initialData: OutputData = {
      blocks: [
        {
          id: 'block-1',
          type: 'paragraph',
          data: {
            text: 'First block',
          },
        },
        {
          id: 'block-2',
          type: 'paragraph',
          data: {
            text: 'Second block',
          },
        },
      ],
    };

    await createBlok(page, { data: initialData, readOnly: false });

    // Get initial positions
    const positions = await page.evaluate(() => {
      const contentElement = document.querySelector('[data-blok-testid="block-content"]');
      if (!contentElement) {
        throw new Error('Content element not found');
      }
      const rect = contentElement.getBoundingClientRect();
      return {
        contentLeft: rect.left,
      };
    });

    // Hover in the extended zone (left of content)
    await page.mouse.move(positions.contentLeft - 50, 100);

    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(100);

    // Verify toolbar appears (indicating hover detection works)
    const toolbarVisible = await page.evaluate(() => {
      const toolbar = document.querySelector('[data-blok-testid="toolbar"]');
      return toolbar !== null;
    });

    expect(toolbarVisible).toBe(true);
  });

  test('block hover detection is disabled in read-only mode', async ({ page }) => {
    const initialData: OutputData = {
      blocks: [
        {
          id: 'block-1',
          type: 'paragraph',
          data: {
            text: 'First block',
          },
        },
      ],
    };

    await createBlok(page, { data: initialData, readOnly: true });

    // Get initial positions
    const positions = await page.evaluate(() => {
      const contentElement = document.querySelector('[data-blok-testid="block-content"]');
      if (!contentElement) {
        throw new Error('Content element not found');
      }
      const rect = contentElement.getBoundingClientRect();
      return {
        contentLeft: rect.left,
      };
    });

    // Hover in the extended zone
    await page.mouse.move(positions.contentLeft - 50, 100);

    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(100);

    // In read-only mode, hover should not trigger toolbar movement
    // The toolbar may exist but shouldn't move to hovered blocks
    const hasToolbarMoved = await page.evaluate(() => {
      // Check if BlockHoverController is active by looking for hover-related attributes
      const blockWrapper = document.querySelector('[data-blok-testid="block-wrapper"]');
      return blockWrapper?.getAttribute('data-blok-hovered') === 'true';
    });

    expect(hasToolbarMoved).toBe(false);
  });

  test('toggleReadOnly enables controllers when switching from read-only to read-write', async ({ page }) => {
    const initialData: OutputData = {
      blocks: [
        {
          type: 'paragraph',
          data: {
            text: 'Test block',
          },
        },
      ],
    };

    // Start in read-only mode
    await createBlok(page, { data: initialData, readOnly: true });

    // Verify typing doesn't work in read-only mode
    const paragraph = page.locator(PARAGRAPH_SELECTOR);
    await paragraph.click();

    await page.keyboard.type(' - should not appear');

    let textContent = await paragraph.evaluate((el) => {
      // In read-only mode, contenteditable="false", so query for element with any contenteditable attribute
      const contentEditable = el.querySelector('[contenteditable]');
      return contentEditable?.textContent ?? '';
    });

    expect(textContent).toBe('Test block');

    // Toggle to read-write mode
    await page.evaluate(() => {
      const blok = window.blokInstance;
      if (blok) {
        // Access the internal UI module to call toggleReadOnly
        const module = (blok as { module?: { ui?: { toggleReadOnly: (readOnly: boolean) => void } } }).module;
        if (module?.ui) {
          module.ui.toggleReadOnly(false);
        }
      }
    });

    // Wait for controllers to re-enable
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(100);

    // Now typing should work
    await paragraph.click();
    await page.keyboard.type(' - now it works');

    textContent = await paragraph.evaluate((el) => {
      // In read-write mode, contenteditable="true"
      const contentEditable = el.querySelector('[contenteditable]');
      return contentEditable?.textContent ?? '';
    });

    expect(textContent).toBe('Test block - now it works');
  });

  test('toggleReadOnly disables controllers when switching from read-write to read-only', async ({ page }) => {
    const initialData: OutputData = {
      blocks: [
        {
          type: 'paragraph',
          data: {
            text: 'Test block',
          },
        },
      ],
    };

    // Start in read-write mode
    await createBlok(page, { data: initialData, readOnly: false });

    // Verify typing works
    const paragraph = page.locator(PARAGRAPH_SELECTOR);
    await paragraph.click();

    await page.keyboard.type(' - initial edit');

    let textContent = await paragraph.evaluate((el) => {
      const contentEditable = el.querySelector('[contenteditable]');
      return contentEditable?.textContent ?? '';
    });

    expect(textContent).toBe('Test block - initial edit');

    // Toggle to read-only mode
    await page.evaluate(() => {
      const blok = window.blokInstance;
      if (blok) {
        const module = (blok as { module?: { ui?: { toggleReadOnly: (readOnly: boolean) => void } } }).module;
        if (module?.ui) {
          module.ui.toggleReadOnly(true);
        }
      }
    });

    // Wait for controllers to disable
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(100);

    // Now typing should not work
    await paragraph.click();
    await page.keyboard.type(' - should not appear');

    textContent = await paragraph.evaluate((el) => {
      // In read-only mode, contenteditable="false"
      const contentEditable = el.querySelector('[contenteditable]');
      return contentEditable?.textContent ?? '';
    });

    expect(textContent).toBe('Test block - initial edit');
  });

  test('bottom zone clicks work in read-write mode but not read-only', async ({ page }) => {
    const initialData: OutputData = {
      blocks: [
        {
          type: 'paragraph',
          data: {
            text: 'Only block',
          },
        },
      ],
    };

    await createBlok(page, { data: initialData, readOnly: false });

    const blocksCountBefore = await page.evaluate(() => {
      const blok = window.blokInstance;
      return blok ? blok.blocks.getBlocksCount() : 0;
    });

    expect(blocksCountBefore).toBe(1);

    // Click in the bottom zone - get bounds directly from the element
    const redactor = page.locator(REDACTOR_SELECTOR);
    await expect(redactor).toBeVisible();

    const { x, y, width, height } = await redactor.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });

    // Click near the bottom of the redactor
    await page.mouse.click(
      x + width / 2,
      y + height - 10
    );

    // In read-write mode, a new block should be created
    const blocksCountAfter = await page.evaluate(() => {
      const blok = window.blokInstance;
      return blok ? blok.blocks.getBlocksCount() : 0;
    });

    expect(blocksCountAfter).toBe(2);

    // Now switch to read-only mode
    await page.evaluate(() => {
      const blok = window.blokInstance;
      if (blok) {
        const module = (blok as { module?: { ui?: { toggleReadOnly: (readOnly: boolean) => void } } }).module;
        if (module?.ui) {
          module.ui.toggleReadOnly(true);
        }
      }
    });

    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(100);

    // Click in the bottom zone again - get bounds directly from the element
    const redactor2 = page.locator(REDACTOR_SELECTOR);

    const { x: x2, y: y2, width: width2, height: height2 } = await redactor2.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });

    await page.mouse.click(
      x2 + width2 / 2,
      y2 + height2 - 10
    );

    // In read-only mode, no new block should be created
    const blocksCountReadOnly = await page.evaluate(() => {
      const blok = window.blokInstance;
      return blok ? blok.blocks.getBlocksCount() : 0;
    });

    expect(blocksCountReadOnly).toBe(2);
  });
});
