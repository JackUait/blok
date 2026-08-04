import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = '[data-blok-testid="block-wrapper"][data-blok-component="paragraph"]';
const EDITOR_SELECTOR = '[data-blok-testid="blok-editor"]';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

/**
 * Host-page layout under test: the editor hugs its content (`minHeight: 0`),
 * a host "comments" element sits below it with a 120px gap of bare body
 * background in between. `captureClicksBelowEditor` must make that gap
 * clickable while leaving the host element alone.
 */
const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();
    document.querySelector('[data-blok-testid="host-content"]')?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const hostContent = document.createElement('div');

    hostContent.setAttribute('data-blok-testid', 'host-content');
    hostContent.textContent = 'Comments section rendered by the host app';
    hostContent.style.marginTop = '120px';
    hostContent.style.height = '160px';
    document.body.appendChild(hostContent);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, options: { readOnly?: boolean } = {}): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, readOnly }) => {
      const blok = new window.Blok({
        holder,
        minHeight: 0,
        captureClicksBelowEditor: true,
        readOnly,
        data: {
          blocks: [
            { id: 'p1', type: 'paragraph', data: { text: 'Article text' } },
          ],
        },
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, readOnly: options.readOnly ?? false }
  );
};

/**
 * Click the bare body background in the gap between the editor's bottom edge
 * and the host content element.
 */
const clickGapBelowEditor = async (page: Page): Promise<void> => {
  const editorBox = await page.locator(EDITOR_SELECTOR).boundingBox();

  if (editorBox === null) {
    throw new Error('Editor wrapper has no bounding box');
  }

  await page.mouse.click(editorBox.x + editorBox.width / 2, editorBox.y + editorBox.height + 40);
};

test.describe('captureClicksBelowEditor', () => {
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('clicking the gap below the editor appends a focused block', async ({ page }) => {
    await createBlok(page);
    await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(1);

    await clickGapBelowEditor(page);

    await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(2);

    const caretInLastParagraph = await page.evaluate(({ selector }) => {
      const paragraphs = document.querySelectorAll(selector);
      const last = paragraphs[paragraphs.length - 1];

      return last !== undefined && document.activeElement !== null && last.contains(document.activeElement);
    }, { selector: PARAGRAPH_SELECTOR });

    expect(caretInLastParagraph).toBe(true);
  });

  test('clicking host content below the editor does not append', async ({ page }) => {
    await createBlok(page);

    await page.getByTestId('host-content').click();

    await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(1);
  });

  test('repeated gap clicks do not stack empty blocks', async ({ page }) => {
    await createBlok(page);

    await clickGapBelowEditor(page);
    await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(2);

    await clickGapBelowEditor(page);

    await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(2);
  });

  test('does nothing in read-only mode', async ({ page }) => {
    await createBlok(page, { readOnly: true });

    await clickGapBelowEditor(page);

    await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(1);
  });
});
