import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import {
  BLOK_INTERFACE_SELECTOR,
  INLINE_TOOLBAR_INTERFACE_SELECTOR
} from '../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const INLINE_TOOLBAR_SELECTOR = INLINE_TOOLBAR_INTERFACE_SELECTOR;
const LINK_TOOL_BUTTON_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-item-name="link"]`;
const LINK_INPUT_SELECTOR = '[data-blok-testid="inline-tool-input"]';
const FAKE_BACKGROUND_SELECTOR = '[data-blok-fake-background="true"]';

/**
 * Helper function to create a Blok instance in the test page
 */
const createBlokInstance = async (
  page: Page,
  data?: OutputData
): Promise<void> => {
  await page.evaluate(
    ({ holderId, data }) => {
      const blok = new window.Blok({
        holder: holderId,
        data: data || {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'This is the first line of text that spans multiple words. Here is the second sentence with more content.',
              },
            },
          ],
        },
        inlineToolbar: true,
      });

      // Store instance globally for access in tests
      (window as unknown as { blokInstance: Blok }).blokInstance = blok;
    },
    { holderId: HOLDER_ID, data }
  );
};

/**
 * Helper function to select text within a contenteditable element
 */
const selectText = async (
  page: Page,
  selector: string,
  startOffset: number,
  endOffset: number
): Promise<void> => {
  await page.evaluate(
    ({ selector, startOffset, endOffset }) => {
      const element = document.querySelector(selector);
      const contentEditable = element?.querySelector('[contenteditable="true"]');

      if (!contentEditable) {
        throw new Error('ContentEditable element not found');
      }

      const textNode = contentEditable.firstChild;

      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
        throw new Error('Text node not found');
      }

      const range = document.createRange();
      range.setStart(textNode, startOffset);
      range.setEnd(textNode, endOffset);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      // Trigger selectionchange event
      document.dispatchEvent(new Event('selectionchange'));
    },
    { selector, startOffset, endOffset }
  );
};

test.describe('selection with link input', () => {
  test.beforeAll(async () => {
    await ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.evaluate((holderId) => {
      // Create or clear the holder element
      let holder = document.getElementById(holderId);
      if (!holder) {
        holder = document.createElement('div');
        holder.id = holderId;
        document.body.appendChild(holder);
      } else {
        holder.innerHTML = '';
      }
    }, HOLDER_ID);
  });
  test('should display fake background (gray selection) when link input is opened', async ({ page }) => {
    // Create editor instance
    await createBlokInstance(page);

    // Wait for editor to be ready
    const paragraph = page.locator(PARAGRAPH_SELECTOR);
    await expect(paragraph).toBeVisible();

    // Select text within the paragraph
    await selectText(
      page,
      PARAGRAPH_SELECTOR,
      12, // Start at "first line"
      54  // End at "multiple words"
    );

    // Wait for inline toolbar to appear
    const inlineToolbar = page.locator(INLINE_TOOLBAR_SELECTOR);
    await expect(inlineToolbar).toBeVisible();

    // Click the link tool button to open the link input
    const linkButton = page.locator(LINK_TOOL_BUTTON_SELECTOR);
    await linkButton.click();

    // Wait for link input to appear
    const linkInput = page.locator(LINK_INPUT_SELECTOR);
    await expect(linkInput).toBeVisible();

    // CRITICAL: Verify that fake background elements exist
    // This is the bug we're testing for - the gray selection should remain visible
    const fakeBackgrounds = page.locator(FAKE_BACKGROUND_SELECTOR);
    await expect(fakeBackgrounds).not.toHaveCount(0);

    // Verify the fake background elements contain the selected text
    // Note: The text may be split across multiple fake background elements
    const allText = await page.evaluate(() => {
      const fakeBackgrounds = document.querySelectorAll('[data-blok-fake-background="true"]');
      return Array.from(fakeBackgrounds).map(el => el.textContent).join('');
    });
    // The selected text is from character 12 to 54: "first line of text that spans multiple wor"
    expect(allText).toContain('first line of text that spans multiple wor');
  });

  test('should maintain fake background when focusing the link input', async ({ page }) => {
    // Create editor instance
    await createBlokInstance(page);

    // Wait for editor to be ready
    const paragraph = page.locator(PARAGRAPH_SELECTOR);
    await expect(paragraph).toBeVisible();

    // Select text
    await selectText(page, PARAGRAPH_SELECTOR, 12, 54);

    // Wait for inline toolbar
    const inlineToolbar = page.locator(INLINE_TOOLBAR_SELECTOR);
    await expect(inlineToolbar).toBeVisible();

    // Click link button
    const linkButton = page.locator(LINK_TOOL_BUTTON_SELECTOR);
    await linkButton.click();

    // Wait for input to appear
    const linkInput = page.locator(LINK_INPUT_SELECTOR);
    await expect(linkInput).toBeVisible();

    // Verify fake backgrounds exist before focusing
    const fakeBackgrounds = page.locator(FAKE_BACKGROUND_SELECTOR);
    const countBefore = await fakeBackgrounds.count();
    expect(countBefore).toBeGreaterThan(0);

    // Focus the link input
    await linkInput.focus();

    // Verify fake backgrounds still exist after focusing
    await expect(fakeBackgrounds).toHaveCount(countBefore);
  });

  test('should remove fake background when link input is closed', async ({ page }) => {
    // Create editor instance
    await createBlokInstance(page);

    // Wait for editor to be ready
    const paragraph = page.locator(PARAGRAPH_SELECTOR);
    await expect(paragraph).toBeVisible();

    // Select text
    await selectText(page, PARAGRAPH_SELECTOR, 12, 54);

    // Wait for inline toolbar
    const inlineToolbar = page.locator(INLINE_TOOLBAR_SELECTOR);
    await expect(inlineToolbar).toBeVisible();

    // Click link button
    const linkButton = page.locator(LINK_TOOL_BUTTON_SELECTOR);
    await linkButton.click();

    // Wait for input and verify fake backgrounds exist
    const linkInput = page.locator(LINK_INPUT_SELECTOR);
    await expect(linkInput).toBeVisible();
    const fakeBackgrounds = page.locator(FAKE_BACKGROUND_SELECTOR);
    await expect(fakeBackgrounds).not.toHaveCount(0);

    // Close the link input by clicking elsewhere or pressing Escape
    await page.keyboard.press('Escape');

    // Wait for input to close
    await expect(linkInput).toBeHidden();

    // Verify fake backgrounds are removed
    await expect(fakeBackgrounds).toHaveCount(0);
  });

  test('should apply correct styling to fake background elements', async ({ page }) => {
    // Create editor instance
    await createBlokInstance(page);

    // Wait for editor to be ready
    const paragraph = page.locator(PARAGRAPH_SELECTOR);
    await expect(paragraph).toBeVisible();

    // Select text
    await selectText(page, PARAGRAPH_SELECTOR, 12, 54);

    // Wait for inline toolbar
    const inlineToolbar = page.locator(INLINE_TOOLBAR_SELECTOR);
    await expect(inlineToolbar).toBeVisible();

    // Click link button
    const linkButton = page.locator(LINK_TOOL_BUTTON_SELECTOR);
    await linkButton.click();

    // Wait for input
    const linkInput = page.locator(LINK_INPUT_SELECTOR);
    await expect(linkInput).toBeVisible();

    // Verify fake background styling
    const fakeBackgrounds = page.locator(FAKE_BACKGROUND_SELECTOR);
    await expect(fakeBackgrounds).not.toHaveCount(0);

    // Verify all fake background elements have correct inline styles
    const styles = await page.evaluate(() => {
      const elements = document.querySelectorAll('[data-blok-fake-background="true"]');
      if (elements.length === 0) return null;
      const firstEl = elements[0] as HTMLElement;
      return {
        boxDecorationBreak: firstEl.style.boxDecorationBreak,
        whiteSpace: firstEl.style.whiteSpace,
        boxShadow: firstEl.style.boxShadow,
      };
    });

    // Verify expected styles are applied
    expect(styles).not.toBeNull();
    expect(styles?.boxDecorationBreak).toBe('clone');
    expect(styles?.whiteSpace).toBe('pre-wrap');
    expect(styles?.boxShadow).toContain('rgba(0, 0, 0, 0.08)');
  });
});
