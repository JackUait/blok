import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { MODIFIER_KEY, selectionChangeDebounceTimeout } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

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

/**
 * How many equation spans currently hold KaTeX's rendered MathML.
 * @param page - page under test
 */
const countRenderedFormulas = async (page: Page): Promise<number> => {
  return page.evaluate(() => document.querySelectorAll('span[data-latex] math').length);
};

/**
 * The single equation chip: its stored source, the source KaTeX is showing,
 * and whether it is painted as being edited. Read in-page because the chip is
 * KaTeX output with no role or test id.
 * @param page - page under test
 */
const readChip = async (page: Page): Promise<{ latex: string | null; shown: string | null; highlighted: boolean } | null> => {
  return page.evaluate(() => {
    const chip = document.querySelector('span[data-latex]');

    if (chip === null) {
      return null;
    }

    return {
      latex: chip.getAttribute('data-latex'),
      shown: chip.querySelector('annotation')?.textContent ?? null,
      highlighted: getComputedStyle(chip).backgroundColor !== 'rgba(0, 0, 0, 0)',
    };
  });
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
    await gotoTestPage(page);
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

  /**
   * REGRESSION: the equation's whole persistence contract is "save the source,
   * regenerate the rendering on load" — and nothing regenerated it. The tool's
   * `hydrate()` had no call site, so a reloaded document showed inert text, and
   * this suite never caught it because every test asserted what `save()`
   * produced, never what a LOAD renders.
   */
  test('a saved formula is re-rendered as math when the document loads', async ({ page }) => {
    await createBlokWithEquation(page, [
      { type: 'paragraph', data: { text: 'mass: <span data-latex="E=mc^2">E=mc^2</span>' } },
    ]);

    // KaTeX emits a MathML layer — its presence means the source was rendered,
    // not printed. Queried in-page: the rendered markup is third-party, so
    // there is no test id or role to locate it by.
    await expect.poll(() => countRenderedFormulas(page)).toBeGreaterThan(0);
  });

  test('re-saving a loaded formula stores the source, not the rendered markup', async ({ page }) => {
    await createBlokWithEquation(page, [
      { type: 'paragraph', data: { text: '<span data-latex="E=mc^2">E=mc^2</span>' } },
    ]);

    await expect.poll(() => countRenderedFormulas(page)).toBeGreaterThan(0);

    const savedText = await page.evaluate(async () => {
      const data = await window.blokInstance?.save();
      const block = data?.blocks?.[0] as { data?: { text?: string } } | undefined;

      return block?.data?.text ?? '';
    });

    // The rendering is derived: it must not accumulate in the document.
    expect(savedText).toBe('<span data-latex="E=mc^2">E=mc^2</span>');
  });
  test('editing a selection shows the formula live in a highlighted chip and Done stores it', async ({ page }) => {
    await createBlokWithEquation(page, [
      { type: 'paragraph', data: { text: 'x^2' } },
    ]);

    await selectAllInFirstEditable(page);
    await page.keyboard.press(`${MODIFIER_KEY}+Shift+KeyE`);

    const input = page.getByTestId('inline-equation-input');

    await expect(input).toBeFocused();
    await expect.poll(() => readChip(page)).toMatchObject({ latex: 'x^2', highlighted: true });

    await input.fill('y^3');
    await expect.poll(() => readChip(page)).toMatchObject({ latex: 'x^2', shown: 'y^3' });

    await page.getByTestId('inline-equation-done').click();

    await expect(input).toBeHidden();
    await expect.poll(() => readChip(page)).toEqual({ latex: 'y^3', shown: 'y^3', highlighted: false });

    const savedText = await page.evaluate(async () => {
      const data = await window.blokInstance?.save();
      const block = data?.blocks?.[0] as { data?: { text?: string } } | undefined;

      return block?.data?.text ?? '';
    });

    expect(savedText).toBe('<span data-latex="y^3">y^3</span>');
  });

  test('closing without Done puts the chip back to its stored formula', async ({ page }) => {
    await createBlokWithEquation(page, [
      { type: 'paragraph', data: { text: 'x^2' } },
    ]);

    await selectAllInFirstEditable(page);
    await page.keyboard.press(`${MODIFIER_KEY}+Shift+KeyE`);

    const input = page.getByTestId('inline-equation-input');

    await input.fill('z^9');
    await expect.poll(() => readChip(page)).toMatchObject({ shown: 'z^9' });

    await page.keyboard.press('Escape');

    await expect(input).toBeHidden();
    await expect.poll(() => readChip(page)).toEqual({ latex: 'x^2', shown: 'x^2', highlighted: false });
  });
  test('clicking the toolbar equation button replaces the toolbar with the equation menu', async ({ page }) => {
    await createBlokWithEquation(page, [
      { type: 'paragraph', data: { text: 'x^2' } },
    ]);

    await selectAllInFirstEditable(page);

    const equationButton = page.locator('[data-blok-item-name="equation"]');

    await expect(equationButton).toBeVisible();
    await equationButton.click();

    const input = page.getByTestId('inline-equation-input');

    await expect(input).toBeFocused();
    await expect(page.locator('[data-blok-item-name="bold"]')).toHaveCount(0);

    await page.getByTestId('inline-equation-done').click();

    await expect(input).toBeHidden();
    await expect.poll(() => readChip(page)).toEqual({ latex: 'x^2', shown: 'x^2', highlighted: false });
  });
  test('clicking an equation opens the equation menu for it, not the inline toolbar', async ({ page }) => {
    await createBlokWithEquation(page, [
      { type: 'paragraph', data: { text: 'mass: <span data-latex="E=mc^2">E=mc^2</span> end' } },
    ]);

    await expect.poll(() => countRenderedFormulas(page)).toBeGreaterThan(0);

    const chipBox = await page.evaluate(() => {
      const rect = document.querySelector('span[data-latex]')?.getBoundingClientRect();

      return rect === undefined ? null : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });

    if (chipBox === null) {
      throw new Error('no equation chip');
    }

    await page.mouse.click(chipBox.x, chipBox.y);

    const input = page.getByTestId('inline-equation-input');

    await expect(input).toBeFocused();
    await expect(input).toHaveValue('E=mc^2');
    await expect(page.locator('[data-blok-item-name="bold"]')).toHaveCount(0);
    await expect.poll(() => readChip(page)).toMatchObject({ latex: 'E=mc^2', highlighted: true });

    await input.fill('E=mc^3');
    await input.press('Enter');

    await expect(input).toBeHidden();

    const savedText = await page.evaluate(async () => {
      const data = await window.blokInstance?.save();
      const block = data?.blocks?.[0] as { data?: { text?: string } } | undefined;

      return block?.data?.text ?? '';
    });

    expect(savedText).toBe('mass: <span data-latex="E=mc^3">E=mc^3</span> end');
  });
  test.describe('motion', () => {
    /**
     * The direct menu's entrance: which animation its surface runs and where
     * that animation grows from. Read in-page: animation state has no locator.
     * @param page - page under test
     */
    const readMenuMotion = async (page: Page): Promise<{ animation: string; from: string | null; originX: string } | null> => {
      return page.evaluate(() => {
        const menu = document.querySelector('[data-blok-inline-direct-menu]');
        const surface = menu?.querySelector('[data-blok-popover-container]');

        if (!menu || !surface) {
          return null;
        }

        return {
          animation: getComputedStyle(surface).animationName,
          from: menu.getAttribute('data-blok-inline-direct-menu'),
          originX: getComputedStyle(surface).transformOrigin.split(' ')[0],
        };
      });
    };

    const countGhosts = async (page: Page): Promise<number> => {
      return page.evaluate(() => document.querySelectorAll('[data-blok-inline-toolbar-ghost]').length);
    };

    test('the equation menu eases in when opened by its shortcut', async ({ page }) => {
      await createBlokWithEquation(page, [
        { type: 'paragraph', data: { text: 'x^2' } },
      ]);

      await selectAllInFirstEditable(page);
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+KeyE`);

      await expect(page.getByTestId('inline-equation-input')).toBeFocused();
      await expect.poll(() => readMenuMotion(page)).toMatchObject({ animation: 'blok-direct-menu-in', from: 'shortcut' });
      expect(await countGhosts(page)).toBe(0);
    });

    test('switching from the toolbar fades the toolbar out and grows the menu from the button', async ({ page }) => {
      await createBlokWithEquation(page, [
        { type: 'paragraph', data: { text: 'x^2 and some more text' } },
      ]);

      await selectAllInFirstEditable(page);

      const equationButton = page.locator('[data-blok-item-name="equation"]');

      await expect(equationButton).toBeVisible();

      // The ghost lives ~160ms, so record it the moment it is inserted.
      await page.evaluate(() => {
        const observer = new MutationObserver(() => {
          const el = document.querySelector('[data-blok-inline-toolbar-ghost]');

          if (el === null) {
            return;
          }

          observer.disconnect();
          document.body.dataset.ghost = JSON.stringify({
            hidden: el.getAttribute('aria-hidden'),
            inert: el.hasAttribute('inert'),
            pointerEvents: getComputedStyle(el).pointerEvents,
            animation: getComputedStyle(el).animationName,
            // Stacks with the toolbar, or the next block paints over the fading copy.
            zIndex: getComputedStyle(el).zIndex === getComputedStyle(document.querySelector('[data-blok-testid="inline-toolbar"]') ?? el).zIndex && getComputedStyle(el).zIndex !== 'auto',
            leakedHooks: el.querySelectorAll('[data-blok-item-name], [data-blok-testid], [id], [role]').length,
          });
        });

        observer.observe(document.body, { childList: true, subtree: true });
      });
      await equationButton.click();

      await expect(page.getByTestId('inline-equation-input')).toBeFocused();

      const ghost = await page.evaluate(() => JSON.parse(document.body.dataset.ghost ?? 'null') as unknown);

      expect(ghost).toEqual({ hidden: 'true', inert: true, pointerEvents: 'none', animation: 'blok-inline-toolbar-ghost-out', zIndex: true, leakedHooks: 0 });

      const motion = await readMenuMotion(page);

      expect(motion).toMatchObject({ animation: 'blok-direct-menu-in', from: 'toolbar' });
      // Grows from the clicked button, not from the menu's left edge.
      expect(Number.parseFloat(motion?.originX ?? '0')).toBeGreaterThan(0);

      await expect.poll(() => countGhosts(page)).toBe(0);
    });

    test('reduced motion opens the menu without animating and without a ghost', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await createBlokWithEquation(page, [
        { type: 'paragraph', data: { text: 'x^2' } },
      ]);

      await selectAllInFirstEditable(page);
      await page.locator('[data-blok-item-name="equation"]').click();

      await expect(page.getByTestId('inline-equation-input')).toBeFocused();
      await expect.poll(() => readMenuMotion(page)).toMatchObject({ animation: 'none' });
      expect(await countGhosts(page)).toBe(0);
    });
  });
});
