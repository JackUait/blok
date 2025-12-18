import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Blok } from '@/types';
import type { BlokConfig } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const PLACEHOLDER_TEXT = 'Write something or press / to select a tool';
const SELECT_ALL_SHORTCUT = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';

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

type CreateBlokOptions = Pick<BlokConfig, 'placeholder' | 'autofocus'>;

const createBlok = async (page: Page, options: CreateBlokOptions = {}): Promise<void> => {
  const { placeholder = null, autofocus = null } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokOptions }) => {
      const config: Record<string, unknown> = {
        holder: holder,
      };

      if (blokOptions.placeholder !== null) {
        config.placeholder = blokOptions.placeholder;
      }

      if (blokOptions.autofocus !== null) {
        config.autofocus = blokOptions.autofocus;
      }

      const blok = new window.Blok(config);

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      blokOptions: {
        placeholder,
        autofocus,
      },
    }
  );
};

const escapeAttributeValue = (value: string): string => {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
};

const getParagraphWithPlaceholder = (page: Page, placeholder: string): Locator => {
  const escapedPlaceholder = escapeAttributeValue(placeholder);

  // The placeholder attribute is set on the contenteditable element inside the block wrapper
  const selectors = [
    `${PARAGRAPH_SELECTOR} [data-blok-placeholder='${escapedPlaceholder}']`,
    `${PARAGRAPH_SELECTOR} [data-blok-placeholder-active='${escapedPlaceholder}']`,
  ].join(', ');

  return page.locator(selectors);
};

const getPseudoElementContent = async (
  locator: Locator,
  pseudoElement: '::before' | '::after'
): Promise<string> => {
  return await locator.evaluate((element, pseudo) => {
    const view = element.ownerDocument.defaultView;

    if (!view) {
      throw new Error('Element is not attached to a window');
    }

    const content = view.getComputedStyle(element, pseudo).getPropertyValue('content');
    const cleanedContent = content.replace(/['"]/g, '');

    // Firefox returns the raw attr(...) string instead of resolving it
    // In that case, fall back to reading the attribute value directly
    const attrMatch = cleanedContent.match(/^attr\(([^)]+)\)$/);

    if (attrMatch) {
      const attrName = attrMatch[1];
      const attrValue = element.getAttribute(attrName);

      // If the attribute exists and we have a ::before pseudo-element,
      // the placeholder is visible
      return attrValue ?? 'none';
    }

    return cleanedContent;
  }, pseudoElement);
};

const expectPlaceholderContent = async (locator: Locator, expected: string): Promise<void> => {
  await expect.poll(async () => {
    return await getPseudoElementContent(locator, '::before');
  }).toBe(expected);
};

test.describe('placeholders', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('shows placeholder when provided in config and focused', async ({ page }) => {
    await createBlok(page, { placeholder: PLACEHOLDER_TEXT });

    const paragraph = getParagraphWithPlaceholder(page, PLACEHOLDER_TEXT);

    await expect(paragraph).toBeVisible();
    // Placeholder is only visible when focused
    await paragraph.click();
    await expectPlaceholderContent(paragraph, PLACEHOLDER_TEXT);
  });

  test('shows placeholder when blok is autofocusable', async ({ page }) => {
    await createBlok(page, {
      placeholder: PLACEHOLDER_TEXT,
      autofocus: true,
    });

    const paragraph = getParagraphWithPlaceholder(page, PLACEHOLDER_TEXT);

    await expect(paragraph).toBeVisible();
    await expectPlaceholderContent(paragraph, PLACEHOLDER_TEXT);
  });

  test('keeps placeholder visible when block receives focus', async ({ page }) => {
    await createBlok(page, { placeholder: PLACEHOLDER_TEXT });

    const paragraph = getParagraphWithPlaceholder(page, PLACEHOLDER_TEXT);

    await expect(paragraph).toBeVisible();
    await paragraph.click();
    await expectPlaceholderContent(paragraph, PLACEHOLDER_TEXT);
  });

  test('restores placeholder after clearing typed content', async ({ page }) => {
    await createBlok(page, { placeholder: PLACEHOLDER_TEXT });

    const paragraph = getParagraphWithPlaceholder(page, PLACEHOLDER_TEXT);

    await expect(paragraph).toBeVisible();
    await paragraph.click();
    await paragraph.type('aaa');
    await page.keyboard.press(SELECT_ALL_SHORTCUT);
    await page.keyboard.press('Backspace');

    await expectPlaceholderContent(paragraph, PLACEHOLDER_TEXT);
  });

  test('hides placeholder after typing characters', async ({ page }) => {
    await createBlok(page, { placeholder: PLACEHOLDER_TEXT });

    const paragraph = getParagraphWithPlaceholder(page, PLACEHOLDER_TEXT);

    await expect(paragraph).toBeVisible();
    // Focus first to show placeholder
    await paragraph.click();
    await expectPlaceholderContent(paragraph, PLACEHOLDER_TEXT);

    await paragraph.type('a');

    await expectPlaceholderContent(paragraph, 'none');
  });

  test('hides placeholder after typing whitespace', async ({ page }) => {
    await createBlok(page, { placeholder: PLACEHOLDER_TEXT });

    const paragraph = getParagraphWithPlaceholder(page, PLACEHOLDER_TEXT);

    await expect(paragraph).toBeVisible();
    // Focus first to show placeholder
    await paragraph.click();
    await expectPlaceholderContent(paragraph, PLACEHOLDER_TEXT);

    await paragraph.type('   ');

    await expectPlaceholderContent(paragraph, 'none');
  });

  test('hides placeholder when paragraph is blurred (unfocused)', async ({ page }) => {
    await createBlok(page, { placeholder: PLACEHOLDER_TEXT, autofocus: true });

    const paragraph = getParagraphWithPlaceholder(page, PLACEHOLDER_TEXT);

    await expect(paragraph).toBeVisible();
    // Placeholder should be visible when focused
    await expectPlaceholderContent(paragraph, PLACEHOLDER_TEXT);

    // Blur the paragraph by clicking outside of it
    await page.mouse.click(10, 10);

    // Placeholder should be hidden when blurred
    await expectPlaceholderContent(paragraph, 'none');
  });

  test('shows placeholder only when empty paragraph receives focus', async ({ page }) => {
    await createBlok(page, { placeholder: PLACEHOLDER_TEXT });

    const paragraph = getParagraphWithPlaceholder(page, PLACEHOLDER_TEXT);

    await expect(paragraph).toBeVisible();

    // Placeholder should be hidden initially (not focused)
    await expectPlaceholderContent(paragraph, 'none');

    // Click to focus
    await paragraph.click();

    // Placeholder should now be visible
    await expectPlaceholderContent(paragraph, PLACEHOLDER_TEXT);

    // Blur by clicking outside
    await page.mouse.click(10, 10);

    // Placeholder should be hidden again
    await expectPlaceholderContent(paragraph, 'none');
  });
});


