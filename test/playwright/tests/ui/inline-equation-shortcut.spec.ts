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

/**
 * Build a Blok instance that explicitly registers the Equation inline tool.
 *
 * The shared fixture's `defaultInlineTools` does not include equation, so the
 * tool class is pulled from the built tools bundle and registered via the raw
 * Blok constructor (BlokOriginal — the one without auto-injected defaults).
 */
const createBlokWithEquation = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
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

  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokBlocks }) => {
      // Runtime-only bundle: use a non-literal specifier so it is not
      // resolved at compile time (it only exists after a test build).
      const toolsUrl = '/dist/tools.mjs';
      const tools = await import(toolsUrl) as {
        Paragraph: unknown;
        Bold: unknown;
        Equation: unknown;
      };
      const BlokOriginal = (window as unknown as { BlokOriginal: typeof window.Blok }).BlokOriginal;

      const blok = new BlokOriginal({
        holder,
        data: { blocks: blokBlocks },
        tools: {
          paragraph: { class: tools.Paragraph },
          bold: { class: tools.Bold },
          equation: { class: tools.Equation },
        },
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

test.describe('Inline equation shortcut', () => {
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('CMD+SHIFT+E turns the selection into a data-latex equation', async ({ page }) => {
    await createBlokWithEquation(page, [
      { type: 'paragraph', data: { text: 'x^2' } },
    ]);

    await selectAllInFirstEditable(page);

    // Opens the equation popover, pre-filled with the selected formula source.
    await page.keyboard.press(`${MODIFIER_KEY}+Shift+KeyE`);

    const input = page.getByTestId('inline-equation-input');

    await expect(input).toBeFocused();

    // Confirm the formula.
    await input.press('Enter');

    const savedText = await page.evaluate(async () => {
      const data = await window.blokInstance?.save();
      const block = data?.blocks?.[0] as { data?: { text?: string } } | undefined;

      return block?.data?.text ?? '';
    });

    expect(savedText).toContain('data-latex="x^2"');
  });
});
