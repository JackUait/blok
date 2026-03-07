import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TOGGLE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="toggle"]`;
const TOGGLE_CHILDREN_SELECTOR = '[data-blok-toggle-children]';
const PARAGRAPH_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`;

// Google Docs wraps clipboard content in <b id="docs-internal-guid-...">
const GDOCS_HTML = [
  '<b id="docs-internal-guid-test" style="font-weight:normal;">',
  '<details open="">',
  '<summary><span style="font-weight:700">Toggle Title</span></summary>',
  '<p><span>Child paragraph 1</span></p>',
  '<p><span>Child paragraph 2</span></p>',
  '</details>',
  '</b>',
].join('');

// A single <details> without the Google Docs wrapper
const PLAIN_DETAILS_HTML = [
  '<details open="">',
  '<summary><b>Plain Toggle</b></summary>',
  '<p>Only child</p>',
  '</details>',
].join('');

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
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

const createBlok = async (page: Page, data?: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, initialData }) => {
      const config: Record<string, unknown> = { holder };

      if (initialData) {
        config.data = initialData;
      }

      const blok = new window.Blok(config);

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data ?? null }
  );
};

/**
 * Simulate a paste event carrying HTML on the currently focused element.
 */
const simulatePaste = async (page: Page, html: string): Promise<void> => {
  await page.evaluate((pasteHtml) => {
    const dt = new DataTransfer();

    dt.setData('text/html', pasteHtml);
    dt.setData('text/plain', '');

    const active = document.activeElement ?? document.body;

    active.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    }));
  }, html);

  // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow the async paste pipeline to complete
  await page.waitForTimeout(300);
};

test.describe('Toggle paste from Google Docs', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('pasting <details>/<summary> from Google Docs', () => {
    test('creates a toggle block with the summary text', async ({ page }) => {
      await createBlok(page);

      // Focus the initial paragraph so the paste event is received by the editor
      const paragraph = page.locator(PARAGRAPH_BLOCK_SELECTOR);
      const paragraphInput = paragraph.locator('[contenteditable]');

      await paragraphInput.click();

      await simulatePaste(page, GDOCS_HTML);

      const toggle = page.locator(TOGGLE_BLOCK_SELECTOR);

      await expect(toggle).toBeVisible();

      const content = toggle.locator('[data-blok-toggle-content]');

      await expect(content).toContainText('Toggle Title');
    });

    test('child paragraphs are nested inside the toggle children container', async ({ page }) => {
      await createBlok(page);

      const paragraphInput = page.locator(PARAGRAPH_BLOCK_SELECTOR).locator('[contenteditable]');

      await paragraphInput.click();

      await simulatePaste(page, GDOCS_HTML);

      // Both child paragraphs must live inside [data-blok-toggle-children], not at root level
      const childrenContainer = page.locator(TOGGLE_CHILDREN_SELECTOR);

      await expect(childrenContainer).toBeAttached();

      const child1 = childrenContainer.locator('[contenteditable]').filter({ hasText: 'Child paragraph 1' });
      const child2 = childrenContainer.locator('[contenteditable]').filter({ hasText: 'Child paragraph 2' });

      await expect(child1).toBeVisible();
      await expect(child2).toBeVisible();
    });

    test('child paragraphs are NOT present at the root level of the editor', async ({ page }) => {
      await createBlok(page);

      const paragraphInput = page.locator(PARAGRAPH_BLOCK_SELECTOR).locator('[contenteditable]');

      await paragraphInput.click();

      await simulatePaste(page, GDOCS_HTML);

      // Verify via saved data: every paragraph block must have a parent (i.e. none are root-level)
      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();

      const orphanParagraphs = saved?.blocks.filter(b => b.type === 'paragraph' && !b.parent);

      expect(orphanParagraphs).toHaveLength(0);
    });

    test('save() produces toggle block with content ids pointing to children', async ({ page }) => {
      await createBlok(page);

      const paragraphInput = page.locator(PARAGRAPH_BLOCK_SELECTOR).locator('[contenteditable]');

      await paragraphInput.click();

      await simulatePaste(page, GDOCS_HTML);

      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();

      const toggleBlock = saved?.blocks.find(b => b.type === 'toggle');
      const childParagraphs = saved?.blocks.filter(b => b.type === 'paragraph');

      expect(toggleBlock).toBeDefined();

      // Toggle must have a content array with at least the two child ids
      expect(toggleBlock?.content).toBeDefined();
      expect(toggleBlock?.content?.length).toBeGreaterThanOrEqual(2);

      // Every child paragraph must be referenced by the toggle's content array
      for (const child of childParagraphs ?? []) {
        expect(toggleBlock?.content).toContain(child.id);
      }
    });

    test('save() sets parent field on each child block pointing to toggle id', async ({ page }) => {
      await createBlok(page);

      const paragraphInput = page.locator(PARAGRAPH_BLOCK_SELECTOR).locator('[contenteditable]');

      await paragraphInput.click();

      await simulatePaste(page, GDOCS_HTML);

      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();

      const toggleBlock = saved?.blocks.find(b => b.type === 'toggle');
      const childParagraphs = saved?.blocks.filter(b => b.type === 'paragraph');

      expect(toggleBlock).toBeDefined();
      expect(childParagraphs?.length).toBeGreaterThanOrEqual(2);

      for (const child of childParagraphs ?? []) {
        expect(child.parent).toBe(toggleBlock?.id);
      }
    });

    test('total block count is toggle + children only (no extra stray blocks)', async ({ page }) => {
      await createBlok(page);

      const paragraphInput = page.locator(PARAGRAPH_BLOCK_SELECTOR).locator('[contenteditable]');

      await paragraphInput.click();

      await simulatePaste(page, GDOCS_HTML);

      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();

      // Expect: 1 toggle + 2 children = 3 blocks total
      expect(saved?.blocks).toHaveLength(3);
    });

    test('pastes <details> followed by regular paragraph correctly', async ({ page }) => {
      await createBlok(page);

      const paragraphInput = page.locator(PARAGRAPH_BLOCK_SELECTOR).locator('[contenteditable]');

      await paragraphInput.click();

      const html =
        '<b id="docs-internal-guid-y">' +
        '<details><summary><span>Toggle</span></summary><p><span>Child content</span></p></details>' +
        '<p><span>Regular paragraph after toggle</span></p>' +
        '</b>';

      await simulatePaste(page, html);

      // Toggle block must be present
      const toggle = page.locator(TOGGLE_BLOCK_SELECTOR);

      await expect(toggle).toBeVisible();

      // Child content must be inside the toggle children container
      const childrenContainer = page.locator(TOGGLE_CHILDREN_SELECTOR);

      await expect(childrenContainer).toBeAttached();

      const child = childrenContainer.locator('[contenteditable]').filter({ hasText: 'Child content' });

      await expect(child).toBeVisible();

      // "Regular paragraph after toggle" must be a root-level block (no parent field)
      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();

      const rootParagraph = saved?.blocks.find(
        b => b.type === 'paragraph' &&
          typeof b.data === 'object' && b.data !== null &&
          typeof (b.data as Record<string, unknown>).text === 'string' &&
          ((b.data as Record<string, unknown>).text as string).includes('Regular paragraph after toggle') &&
          !b.parent
      );

      expect(rootParagraph).toBeDefined();
    });
  });

  test.describe('pasting plain <details> (no Google Docs wrapper)', () => {
    test('creates a toggle block with the summary text', async ({ page }) => {
      await createBlok(page);

      const paragraphInput = page.locator(PARAGRAPH_BLOCK_SELECTOR).locator('[contenteditable]');

      await paragraphInput.click();

      await simulatePaste(page, PLAIN_DETAILS_HTML);

      const toggle = page.locator(TOGGLE_BLOCK_SELECTOR);

      await expect(toggle).toBeVisible();

      const content = toggle.locator('[data-blok-toggle-content]');

      await expect(content).toContainText('Plain Toggle');
    });

    test('single child paragraph is nested inside the toggle', async ({ page }) => {
      await createBlok(page);

      const paragraphInput = page.locator(PARAGRAPH_BLOCK_SELECTOR).locator('[contenteditable]');

      await paragraphInput.click();

      await simulatePaste(page, PLAIN_DETAILS_HTML);

      const childrenContainer = page.locator(TOGGLE_CHILDREN_SELECTOR);

      await expect(childrenContainer).toBeAttached();

      const child = childrenContainer.locator('[contenteditable]').filter({ hasText: 'Only child' });

      await expect(child).toBeVisible();
    });

    test('save() produces 2 blocks: toggle + 1 child paragraph', async ({ page }) => {
      await createBlok(page);

      const paragraphInput = page.locator(PARAGRAPH_BLOCK_SELECTOR).locator('[contenteditable]');

      await paragraphInput.click();

      await simulatePaste(page, PLAIN_DETAILS_HTML);

      const saved = await page.evaluate(async () => window.blokInstance?.save());

      expect(saved).toBeDefined();
      expect(saved?.blocks).toHaveLength(2);

      const toggleBlock = saved?.blocks.find(b => b.type === 'toggle');
      const childBlock = saved?.blocks.find(b => b.type === 'paragraph');

      expect(toggleBlock).toBeDefined();
      expect(childBlock).toBeDefined();
      expect(toggleBlock?.content).toContain(childBlock?.id);
      expect(childBlock?.parent).toBe(toggleBlock?.id);
    });
  });
});
