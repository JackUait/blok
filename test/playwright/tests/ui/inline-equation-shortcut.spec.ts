import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { MODIFIER_KEY, selectionChangeDebounceTimeout } from '../../../../src/components/constants';
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

const placeCollapsedCaretInFirstEditable = async (page: Page, offset: number): Promise<void> => {
  await page.evaluate(({ holder, caretOffset }) => {
    const wrapper = document.getElementById(holder);
    const editable = wrapper?.querySelector('[contenteditable="true"]');

    if (!editable) {
      throw new Error('Editable not found');
    }

    (editable as HTMLElement).focus();

    const textNode = editable.firstChild ?? editable;
    const range = document.createRange();

    range.setStart(textNode, caretOffset);
    range.collapse(true);

    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
  }, { holder: HOLDER_ID, caretOffset: offset });
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

  test('CMD+SHIFT+E opens ONLY the equation menu, not the whole inline toolbar', async ({ page }) => {
    // Notion parity: triggering a popover-entry inline tool (equation) by its
    // keyboard shortcut should close the inline toolbar's format-button row and
    // present just the dedicated equation menu — not the full B/i/link/equation
    // bar with the input flying out beside it.
    await createBlokWithEquation(page, [
      { type: 'paragraph', data: { text: 'x^2' } },
    ]);

    await selectAllInFirstEditable(page);

    await page.keyboard.press(`${MODIFIER_KEY}+Shift+KeyE`);

    const input = page.getByTestId('inline-equation-input');

    await expect(input).toBeFocused();

    // The format-button row must NOT be rendered — only the equation menu shows.
    await expect(page.locator('[data-blok-item-name="bold"]')).toHaveCount(0);
  });

  test('CMD+SHIFT+E opens the equation input even with a COLLAPSED caret (no selection)', async ({ page }) => {
    // Notion parity: pressing the shortcut with just a caret (nothing selected)
    // opens the equation input so the user can type a fresh formula at the caret.
    // Regression: the inline toolbar refused to show without a range selection,
    // so the shortcut silently did nothing for popover-entry tools.
    await createBlokWithEquation(page, [
      { type: 'paragraph', data: { text: 'before after' } },
    ]);

    await placeCollapsedCaretInFirstEditable(page, 'before'.length);

    await page.keyboard.press(`${MODIFIER_KEY}+Shift+KeyE`);

    const input = page.getByTestId('inline-equation-input');

    await expect(input).toBeFocused();

    await input.fill('a^2');
    await input.press('Enter');

    const savedText = await page.evaluate(async () => {
      const data = await window.blokInstance?.save();
      const block = data?.blocks?.[0] as { data?: { text?: string } } | undefined;

      return block?.data?.text ?? '';
    });

    expect(savedText).toContain('data-latex="a^2"');
  });

  test('equation menu opened at a COLLAPSED caret stays open past the selectionchange debounce', async ({ page }) => {
    // Regression: focusing the menu input collapses the document selection, which
    // fires the debounced selectionchange handler. With a real range the tool's
    // fake-background protects the toolbar; a collapsed caret has no fake
    // background, so the handler used to tear the menu down ~180ms after it
    // opened (it only "worked" if you typed fast enough to beat the debounce).
    await createBlokWithEquation(page, [
      { type: 'paragraph', data: { text: 'before after' } },
    ]);

    await placeCollapsedCaretInFirstEditable(page, 'before'.length);

    await page.keyboard.press(`${MODIFIER_KEY}+Shift+KeyE`);

    const input = page.getByTestId('inline-equation-input');

    await expect(input).toBeFocused();

    // Focusing the input collapsed the document selection, which (re)starts the
    // debounced selectionchange handler that used to tear the menu down. Fire
    // that event explicitly and wait until its debounced handler has actually
    // run: a timer queued right after it shares the same delay, so FIFO timer
    // ordering guarantees this resolves only once the debounce window elapsed.
    await page.evaluate((debounceMs) => {
      document.dispatchEvent(new Event('selectionchange'));

      return new Promise<void>((resolve) => {
        setTimeout(resolve, debounceMs);
      });
    }, selectionChangeDebounceTimeout);

    // The menu must still be open and usable after the debounce settled.
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
  });
});
