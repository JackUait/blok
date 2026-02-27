import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`;
const INLINE_TOOLBAR_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid=inline-toolbar]`;
const MARKER_BUTTON_SELECTOR = `${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="marker"]`;

/**
 * Reset the blok holder and destroy any existing instance
 * @param page - The Playwright page object
 */
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

/**
 * Create blok with provided blocks
 * @param page - The Playwright page object
 * @param blocks - The blocks data to initialize the blok with
 */
const createBlokWithBlocks = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
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

/**
 * Select text content within a locator by string match
 * @param locator - The Playwright locator for the element containing the text
 * @param text - The text string to select within the element
 */
const selectText = async (locator: Locator, text: string): Promise<void> => {
  await locator.evaluate((element, targetText) => {
    const root = element as HTMLElement;
    const doc = root.ownerDocument;

    if (!doc) {
      throw new Error('Unable to access ownerDocument for selection');
    }

    const fullText = root.textContent ?? '';

    if (!fullText.includes(targetText)) {
      throw new Error(`Text "${targetText}" was not found in element`);
    }

    const selection = doc.getSelection();

    if (!selection) {
      throw new Error('Selection is not available');
    }

    const startIndex = fullText.indexOf(targetText);
    const endIndex = startIndex + targetText.length;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    let accumulatedLength = 0;
    let startNode: Node | null = null;
    let startOffset = 0;
    let endNode: Node | null = null;
    let endOffset = 0;

    while (walker.nextNode()) {
      const currentNode = walker.currentNode;
      const nodeText = currentNode.textContent ?? '';
      const nodeStart = accumulatedLength;
      const nodeEnd = nodeStart + nodeText.length;

      if (!startNode && startIndex >= nodeStart && startIndex < nodeEnd) {
        startNode = currentNode;
        startOffset = startIndex - nodeStart;
      }

      if (!endNode && endIndex <= nodeEnd) {
        endNode = currentNode;
        endOffset = endIndex - nodeStart;
        break;
      }

      accumulatedLength = nodeEnd;
    }

    if (!startNode || !endNode) {
      throw new Error('Failed to locate text nodes for selection');
    }

    const range = doc.createRange();

    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);

    selection.removeAllRanges();
    selection.addRange(range);

    if (root instanceof HTMLElement) {
      root.focus();
    }

    doc.dispatchEvent(new Event('selectionchange'));
  }, text);
};

/**
 * Open the marker color picker popover by clicking the marker button
 * @param page - The Playwright page object
 */
const openMarkerPicker = async (page: Page): Promise<void> => {
  const markerButton = page.locator(MARKER_BUTTON_SELECTOR);

  await expect(markerButton).toBeVisible();
  await markerButton.click();

  const picker = page.locator('[data-blok-testid="marker-picker"]');

  await expect(picker).toBeVisible();
};

/**
 * Get the correct modifier key based on the browser's user agent.
 * WebKit always uses a macOS-style user agent, so it expects Meta regardless of host OS.
 * @param page - The Playwright page object
 */
const getModifierKey = async (page: Page): Promise<'Meta' | 'Control'> => {
  const isMac = await page.evaluate(() => {
    return navigator.userAgent.toLowerCase().includes('mac');
  });

  return isMac ? 'Meta' : 'Control';
};

test.describe('inline tool marker', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('shows marker tool in inline toolbar when text is selected', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Some text to select',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'Some text');

    const markerButton = page.locator(MARKER_BUTTON_SELECTOR);

    await expect(markerButton).toBeVisible();
  });

  test('applies text color to selected text', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Color this text',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'Color');

    // Open the marker picker
    await openMarkerPicker(page);

    // Verify text color tab is visible (it should be active by default)
    const colorTab = page.locator('[data-blok-testid="marker-tab-color"]');

    await expect(colorTab).toBeVisible();

    // Click a color swatch (e.g., red)
    const redSwatch = page.locator('[data-blok-testid="marker-swatch-red"]');

    await redSwatch.click();

    // Verify <mark> element was created with color style
    await page.waitForFunction(
      ({ selector }) => {
        const el = document.querySelector(selector);

        if (!el) {
          return false;
        }

        const mark = el.querySelector('mark');

        return Boolean(mark && mark.style.color);
      },
      { selector: PARAGRAPH_SELECTOR }
    );

    // Close the picker by clicking outside, which removes fake background spans
    await page.mouse.click(10, 10);

    const html = await paragraph.innerHTML();

    expect(html).toMatch(/<mark style="color:[^"]+">Color<\/mark>/);
  });

  test('applies background color to selected text', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Highlight this text',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'Highlight');

    // Open the marker picker
    await openMarkerPicker(page);

    // Switch to background color tab
    const bgTab = page.locator('[data-blok-testid="marker-tab-background-color"]');

    await bgTab.click();

    // Click a color swatch (e.g., yellow)
    const yellowSwatch = page.locator('[data-blok-testid="marker-swatch-yellow"]');

    await yellowSwatch.click();

    // Verify <mark> element was created with background-color style
    await page.waitForFunction(
      ({ selector }) => {
        const el = document.querySelector(selector);

        if (!el) {
          return false;
        }

        const mark = el.querySelector('mark');

        return Boolean(mark && mark.style.backgroundColor);
      },
      { selector: PARAGRAPH_SELECTOR }
    );

    // Close the picker by clicking outside, which removes fake background spans
    await page.mouse.click(10, 10);

    const html = await paragraph.innerHTML();

    expect(html).toMatch(/<mark style="background-color:[^"]+">Highlight<\/mark>/);
  });

  test('removes color with Default button', async ({ page }) => {
    // Start with text that already has a mark with color
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<mark style="color: rgb(212, 76, 71);">Colored text</mark> and normal',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    // Select the colored text
    await selectText(paragraph, 'Colored text');

    // Open the marker picker
    await openMarkerPicker(page);

    // Click the Default button to remove color
    const defaultBtn = page.locator('[data-blok-testid="marker-default-btn"]');

    await defaultBtn.click();

    // Verify the mark element was removed (since it had only color, no background)
    await page.waitForFunction(
      ({ selector }) => {
        const el = document.querySelector(selector);

        if (!el) {
          return false;
        }

        return !el.querySelector('mark');
      },
      { selector: PARAGRAPH_SELECTOR }
    );

    const html = await paragraph.innerHTML();

    expect(html).not.toContain('<mark');
    expect(html).toContain('Colored text');
  });

  test('keeps color picker open after selecting a swatch color', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Keep picker open',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'Keep picker');

    await openMarkerPicker(page);

    // Click a color swatch
    const redSwatch = page.locator('[data-blok-testid="marker-swatch-red"]');

    await redSwatch.click();

    // Verify the color picker is still visible after clicking
    const picker = page.locator('[data-blok-testid="marker-picker"]');

    await expect(picker).toBeVisible();
  });

  test('allows applying both text and background color without reopening picker', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Dual color text',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'Dual color');

    await openMarkerPicker(page);

    // Step 1: Apply text color (red)
    const redSwatch = page.locator('[data-blok-testid="marker-swatch-red"]');

    await redSwatch.click();

    // Picker should still be open
    const picker = page.locator('[data-blok-testid="marker-picker"]');

    await expect(picker).toBeVisible();

    // Step 2: Switch to background tab
    const bgTab = page.locator('[data-blok-testid="marker-tab-background-color"]');

    await bgTab.click();

    // Step 3: Apply background color (yellow)
    const yellowSwatch = page.locator('[data-blok-testid="marker-swatch-yellow"]');

    await yellowSwatch.click();

    // Picker should still be open
    await expect(picker).toBeVisible();

    // Verify the mark has both text AND background color
    await page.waitForFunction(
      ({ selector }) => {
        const el = document.querySelector(selector);

        if (!el) {
          return false;
        }

        const mark = el.querySelector('mark');

        return Boolean(mark && mark.style.color && mark.style.backgroundColor && mark.style.backgroundColor !== 'transparent');
      },
      { selector: PARAGRAPH_SELECTOR }
    );

    // Close the picker to clean up fake background spans before checking HTML
    await page.mouse.click(10, 10);

    const html = await paragraph.innerHTML();

    // Should have both color and background-color on the same mark
    expect(html).toMatch(/<mark[^>]*style="[^"]*color:[^"]*background-color:[^"]*"[^>]*>/);
  });

  test('closes color picker when clicking outside the inline toolbar', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Click outside to close',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'Click outside');

    await openMarkerPicker(page);

    // Apply a color — picker should stay open
    const redSwatch = page.locator('[data-blok-testid="marker-swatch-red"]');

    await redSwatch.click();

    const picker = page.locator('[data-blok-testid="marker-picker"]');

    await expect(picker).toBeVisible();

    // Click outside the inline toolbar (on the page body, away from everything)
    await page.mouse.click(10, 10);

    // Picker should be closed now
    await expect(picker).not.toBeVisible();
  });

  test('opens color picker with CMD+SHIFT+H keyboard shortcut', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Shortcut color text',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'Shortcut');

    const markerButton = page.locator(MARKER_BUTTON_SELECTOR);

    // Wait for toolbar to appear first (ensures shortcuts are registered)
    await expect(markerButton).toBeVisible();

    // Re-select text since toolbar appearance might affect selection
    await selectText(paragraph, 'Shortcut');

    const modifierKey = await getModifierKey(page);

    // Press CMD+SHIFT+H to open marker color picker
    await page.keyboard.press(`${modifierKey}+Shift+h`);

    // Verify the color picker popover is visible
    const picker = page.locator('[data-blok-testid="marker-picker"]');

    await expect(picker).toBeVisible();
  });

  test('keeps color picker open after clicking Default button', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<mark style="color: rgb(212, 76, 71);">Default test</mark> rest',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'Default test');

    await openMarkerPicker(page);

    const defaultBtn = page.locator('[data-blok-testid="marker-default-btn"]');

    await defaultBtn.click();

    // Picker should still be visible even though mark was fully unwrapped
    const picker = page.locator('[data-blok-testid="marker-picker"]');

    await expect(picker).toBeVisible();
  });
});

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}
