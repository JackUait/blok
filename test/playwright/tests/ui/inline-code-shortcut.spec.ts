import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { MODIFIER_KEY } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

const HOLDER_ID = 'blok';

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

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokBlocks }) => {
      const blok = new window.Blok({
        holder,
        data: { blocks: blokBlocks },
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokBlocks: blocks }
  );
};

const selectAllInFirstEditable = async (page: Page): Promise<void> => {
  await page.evaluate((holder) => {
    const wrapper = document.getElementById(holder);
    const editable = wrapper?.querySelector('[contenteditable="true"]');

    if (!editable) {
      throw new Error('Editable not found');
    }

    (editable as HTMLElement).focus();

    const range = document.createRange();

    range.selectNodeContents(editable);

    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
  }, HOLDER_ID);
};

test.describe('Inline code shortcut', () => {
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('CMD+E wraps selection in <code>', async ({ page }) => {
    await createBlok(page, [
      { type: 'paragraph', data: { text: 'Hello world' } },
    ]);

    await selectAllInFirstEditable(page);

    await page.keyboard.press(`${MODIFIER_KEY}+KeyE`);

    const savedText = await page.evaluate(async () => {
      const data = await window.blokInstance?.save();
      const block = data?.blocks?.[0] as { data?: { text?: string } } | undefined;

      return block?.data?.text ?? '';
    });

    expect(savedText).toContain('<code>');
    expect(savedText).toContain('Hello world');
    expect(savedText).toContain('</code>');
  });
});
