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

  test('marker button is active when selection is entirely inside a mark element', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<mark style="color: rgb(212, 76, 71);">marked text</mark> and normal',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'marked text');

    const markerButton = page.locator(MARKER_BUTTON_SELECTOR);

    await expect(markerButton).toBeVisible();

    const isActive = await markerButton.getAttribute('data-blok-popover-item-active');

    expect(isActive).toBe('true');
  });

  test('marker button is not active when selection contains no mark ancestor', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'plain text here',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'plain text');

    const markerButton = page.locator(MARKER_BUTTON_SELECTOR);

    await expect(markerButton).toBeVisible();

    const isActive = await markerButton.getAttribute('data-blok-popover-item-active');

    expect(isActive).not.toBe('true');
  });

  test('color picker grid renders exactly 10 swatch buttons', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Swatch count test',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'Swatch count');

    await openMarkerPicker(page);

    const grid = page.locator('[data-blok-testid="marker-grid"]');

    await expect(grid).toBeVisible();

    const swatchCount = await grid.locator('button').count();

    expect(swatchCount).toBe(10);
  });

  test('color picker contains two tabs labeled Text and Background', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Tab structure test',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'Tab structure');

    await openMarkerPicker(page);

    const colorTab = page.locator('[data-blok-testid="marker-tab-color"]');
    const bgTab = page.locator('[data-blok-testid="marker-tab-background-color"]');

    await expect(colorTab).toBeVisible();
    await expect(bgTab).toBeVisible();
  });

  test('Default button on Background tab removes only background-color and keeps text color', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<mark style="color: rgb(212, 76, 71); background-color: rgb(251, 243, 219);">dual color</mark>',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'dual color');

    await openMarkerPicker(page);

    // Switch to background tab
    const bgTab = page.locator('[data-blok-testid="marker-tab-background-color"]');

    await bgTab.click();

    // Click Default button
    const defaultBtn = page.locator('[data-blok-testid="marker-default-btn"]');

    await defaultBtn.click();

    // Close picker
    await page.mouse.click(10, 10);

    const html = await paragraph.innerHTML();

    // Mark should still exist with text color
    expect(html).toContain('<mark');
    expect(html).toMatch(/color:/);
    // Background should be removed or transparent
    expect(html).not.toMatch(/background-color:\s*rgb\(251/);
  });

  test('Default button on Text tab removes only text color and keeps background color', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<mark style="color: rgb(212, 76, 71); background-color: rgb(251, 243, 219);">dual color</mark>',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'dual color');

    await openMarkerPicker(page);

    // Text tab is active by default, click Default
    const defaultBtn = page.locator('[data-blok-testid="marker-default-btn"]');

    await defaultBtn.click();

    // Close picker
    await page.mouse.click(10, 10);

    const html = await paragraph.innerHTML();

    // Mark should still exist with background color
    expect(html).toContain('<mark');
    expect(html).toMatch(/background-color:/);
  });

  test('text color is preserved in blok.save() output', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Save text color test',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'text');

    await openMarkerPicker(page);

    // Click orange swatch (text tab is default)
    const orangeSwatch = page.locator('[data-blok-testid="marker-swatch-orange"]');

    await orangeSwatch.click();

    // Close picker
    await page.mouse.click(10, 10);

    // Save and check output
    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    const paragraphBlock = savedData?.blocks[0];

    expect(paragraphBlock?.data.text).toContain('<mark');
    expect(paragraphBlock?.data.text).toMatch(/color:/);
  });

  test('background color is preserved in blok.save() output', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Save background color test',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'background');

    await openMarkerPicker(page);

    // Switch to background tab
    const bgTab = page.locator('[data-blok-testid="marker-tab-background-color"]');

    await bgTab.click();

    // Click purple swatch
    const purpleSwatch = page.locator('[data-blok-testid="marker-swatch-purple"]');

    await purpleSwatch.click();

    // Close picker
    await page.mouse.click(10, 10);

    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    const paragraphBlock = savedData?.blocks[0];

    expect(paragraphBlock?.data.text).toContain('<mark');
    expect(paragraphBlock?.data.text).toMatch(/background-color:/);
  });

  test('both text and background colors are preserved in blok.save() output', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Save dual color test',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'dual');

    await openMarkerPicker(page);

    // Apply text color (red)
    const redSwatch = page.locator('[data-blok-testid="marker-swatch-red"]');

    await redSwatch.click();

    // Switch to background and apply yellow
    const bgTab = page.locator('[data-blok-testid="marker-tab-background-color"]');

    await bgTab.click();

    const yellowSwatch = page.locator('[data-blok-testid="marker-swatch-yellow"]');

    await yellowSwatch.click();

    // Close picker
    await page.mouse.click(10, 10);

    const savedData = await page.evaluate(async () => {
      return window.blokInstance?.save();
    });

    const paragraphBlock = savedData?.blocks[0];

    expect(paragraphBlock?.data.text).toContain('<mark');
    expect(paragraphBlock?.data.text).toMatch(/color:/);
    expect(paragraphBlock?.data.text).toMatch(/background-color:/);
  });

  test('text can be both bold and color-marked simultaneously', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Bold and colored text',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    // First apply bold
    await selectText(paragraph, 'Bold');

    const boldButton = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="bold"]`);

    await expect(boldButton).toBeVisible();
    await boldButton.click();

    // Dismiss toolbar
    await page.mouse.click(10, 10);

    // Re-select and apply color
    await selectText(paragraph, 'Bold');

    await openMarkerPicker(page);

    const tealSwatch = page.locator('[data-blok-testid="marker-swatch-teal"]');

    await tealSwatch.click();

    // Close picker
    await page.mouse.click(10, 10);

    const html = await paragraph.innerHTML();

    // Both bold and mark should exist
    expect(html).toContain('<strong');
    expect(html).toContain('<mark');
    expect(html).toContain('Bold');
  });

  test('removing bold from bold-plus-colored text leaves the color mark intact', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<mark style="color: rgb(212, 76, 71);"><strong>bold colored</strong></mark>',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'bold colored');

    const boldButton = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="bold"]`);

    await expect(boldButton).toBeVisible();

    // Toggle bold off
    await boldButton.click();

    // Close toolbar
    await page.mouse.click(10, 10);

    const html = await paragraph.innerHTML();

    // Bold should be removed but mark should remain
    expect(html).not.toContain('<strong');
    expect(html).toContain('<mark');
    expect(html).toMatch(/color:/);
    expect(html).toContain('bold colored');
  });
});

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}
