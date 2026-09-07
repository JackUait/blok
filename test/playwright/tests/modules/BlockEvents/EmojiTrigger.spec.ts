import type { Locator, Page } from '@playwright/test';
import type { Blok } from '../../../../../types';
import type { OutputData } from '../../../../../types';
import { ensureBlokBundleBuilt } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable]`;
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
const CELL_SELECTOR = '[data-blok-table-cell]';
const NAVIGATION_FOCUSED_SELECTOR = '[data-blok-navigation-focused="true"]';
const SCROLL_LOCKED_SELECTOR = '[data-blok-scroll-locked]';
const FIRE = '\u{1F525}';

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

const createBlok = async (page: Page, data: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder, blokData }) => {
    const blok = new window.Blok({
      holder,
      data: blokData,
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blokData: data });
};

const createParagraphBlok = async (page: Page, texts: string[]): Promise<void> => {
  await createBlok(page, {
    blocks: texts.map((text) => ({ type: 'paragraph', data: { text } })),
  });
};

const saveBlok = async (page: Page): Promise<OutputData> => {
  return page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance is not ready');
    }

    return window.blokInstance.save();
  });
};

const getTextContent = async (locator: Locator): Promise<string> => {
  return locator.evaluate((element) => element.textContent ?? '');
};

const getParagraphByIndex = (page: Page, index: number): Locator => {
  return page.locator(`:nth-match(${PARAGRAPH_SELECTOR}, ${index + 1})`);
};

const getCell = (page: Page, row: number, col: number): Locator => {
  return page
    .locator(`${TABLE_SELECTOR} >> [data-blok-table-row] >> nth=${row}`)
    .locator(`${CELL_SELECTOR} >> nth=${col}`);
};

const getCellEditable = (page: Page, row: number, col: number): Locator => {
  return getCell(page, row, col).locator('[data-blok-table-cell-blocks] [contenteditable="true"] >> nth=0');
};

/** Settles one requestAnimationFrame round-trip so a hypothetical async scroll has a chance to happen before the following assertion reads a stable value. */
const settleAnimationFrame = async (page: Page): Promise<void> => {
  await page.evaluate(async () => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
};

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.describe('inline ":" emoji trigger', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('typing ":fi" opens the menu and Enter commits the highlighted emoji into the SAVED block data', async ({ page }) => {
    await createParagraphBlok(page, [ '' ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);
    const menu = page.getByTestId('emoji-menu');

    await paragraph.click();
    await page.keyboard.type(':fi');

    await expect(menu).toBeVisible();
    // Every keystroke re-highlights the top-ranked result — wait for the
    // combobox host to point at it before reading which one that is.
    await expect(paragraph).toHaveAttribute('aria-activedescendant', /.+/);

    const highlightedNative = await paragraph.evaluate((el) => {
      const activeId = el.getAttribute('aria-activedescendant');
      const activeEl = activeId !== null ? document.getElementById(activeId) : null;

      return activeEl?.getAttribute('data-emoji-native') ?? null;
    });

    expect(highlightedNative).not.toBeNull();

    await page.keyboard.press('Enter');

    await expect(menu).toBeHidden();

    // The saved data is the real contract — not just what the DOM shows.
    const { blocks } = await saveBlok(page);
    const text = (blocks[0].data as { text: string }).text;

    expect(text).toBe(highlightedNative);
    expect(text).not.toContain(':');
  });

  test('"10:30" never opens the menu and the text is left intact', async ({ page }) => {
    await createParagraphBlok(page, [ '' ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);
    const menu = page.getByTestId('emoji-menu');

    await paragraph.click();
    await page.keyboard.type('10:30');

    // The colon in "10:30" is preceded by a digit, not whitespace/start of
    // block, so no trigger span ever resolves and the picker is never even
    // constructed.
    await expect(menu).toBeHidden();
    await expect(menu).toHaveCount(0);

    const text = await getTextContent(paragraph);

    expect(text).toBe('10:30');

    const { blocks } = await saveBlok(page);

    expect((blocks[0].data as { text: string }).text).toBe('10:30');
  });

  test('inside a table cell, ":fi" opens the menu and a click lands the emoji in the cell', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          type: 'table',
          data: {
            withHeadings: false,
            content: [ [ '', '' ], [ '', '' ] ],
          },
        },
      ],
    });

    const cellEditable = getCellEditable(page, 0, 0);
    const menu = page.getByTestId('emoji-menu');

    await cellEditable.click();
    await page.keyboard.type(':fi');

    await expect(menu).toBeVisible();

    await menu.locator(`[data-emoji-native="${FIRE}"]`).click();

    await expect(menu).toBeHidden();
    await expect(cellEditable).toHaveText(FIRE);

    const { blocks } = await saveBlok(page);
    const tableBlock = blocks.find((block) => block.type === 'table');
    const content = (tableBlock?.data as { content: { blocks: string[] }[][] }).content;
    const cellBlockId = content[0][0].blocks[0];
    const cellParagraph = blocks.find((block) => block.id === cellBlockId);

    expect((cellParagraph?.data as { text: string }).text).toBe(FIRE);
  });

  test('Escape closes the menu, keeps the literal text, and does NOT enter block navigation mode', async ({ page }) => {
    await createParagraphBlok(page, [ '' ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);
    const menu = page.getByTestId('emoji-menu');

    await paragraph.click();
    await page.keyboard.type(':fi');

    await expect(menu).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(menu).toBeHidden();

    const text = await getTextContent(paragraph);

    expect(text).toBe(':fi');

    // This is the assertion the test exists for: the emoji menu must have
    // claimed this Escape BEFORE KeyboardController's own Escape handler,
    // or the block would fall into navigation mode instead.
    await expect(page.locator(NAVIGATION_FOCUSED_SELECTOR)).toHaveCount(0);
    // Entering navigation mode blurs document.activeElement (see
    // BlockSelection.setNavigationFocus) — the caret staying in the
    // contentEditable is the other half of "did not enter navigation mode".
    await expect(paragraph).toBeFocused();
  });

  test('":fire:" commits the exact shortcode immediately, leaving no colons', async ({ page }) => {
    await createParagraphBlok(page, [ '' ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);
    const menu = page.getByTestId('emoji-menu');

    await paragraph.click();
    await page.keyboard.type(':fire');

    await expect(menu).toBeVisible();

    // The closing ":" is a keystroke on an already-open exact-match span —
    // it commits immediately, swallowing itself.
    await page.keyboard.type(':');

    await expect(menu).toBeHidden();

    const text = await getTextContent(paragraph);

    expect(text).toBe(FIRE);

    const { blocks } = await saveBlok(page);

    expect((blocks[0].data as { text: string }).text).toBe(FIRE);
  });

  test('":fir:" (not an exact shortcode) leaves the literal text alone', async ({ page }) => {
    await createParagraphBlok(page, [ '' ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);
    const menu = page.getByTestId('emoji-menu');

    await paragraph.click();
    await page.keyboard.type(':fir');

    await expect(menu).toBeVisible();

    await page.keyboard.type(':');

    // No exact id/keyword match for "fir" — the closing colon just closes
    // the menu instead of committing anything.
    await expect(menu).toBeHidden();

    const text = await getTextContent(paragraph);

    expect(text).toBe(':fir:');

    const { blocks } = await saveBlok(page);

    expect((blocks[0].data as { text: string }).text).toBe(':fir:');
  });

  test('the page does not scroll while the menu is open, but the picker grid does', async ({ page }) => {
    // An empty first block avoids any dependency on Home-key caret placement
    // (engine-specific) — the 39 filler paragraphs after it are enough to
    // make the page taller than the viewport.
    await createParagraphBlok(page, [ '', ...Array.from({ length: 39 }, (_, i) => `Filler paragraph ${i}`) ]);

    const firstParagraph = getParagraphByIndex(page, 0);
    const menu = page.getByTestId('emoji-menu');

    await firstParagraph.click();
    await page.keyboard.type(':a');

    await expect(menu).toBeVisible();
    await expect(page.locator(SCROLL_LOCKED_SELECTOR)).toBeAttached();

    const scrollBefore = await page.evaluate(() => window.scrollY);

    // Move away from both the editor and the fixed-position picker before
    // wheeling, so the event targets the page itself.
    await page.mouse.move(0, 0);
    await page.mouse.wheel(0, 400);
    await settleAnimationFrame(page);

    const scrollAfter = await page.evaluate(() => window.scrollY);

    expect(scrollAfter).toBe(scrollBefore);

    // The picker's own grid must still scroll.
    const grid = menu.locator('[data-emoji-picker-body]');

    await grid.hover();

    const gridScrollBefore = await grid.evaluate((el) => el.scrollTop);

    await page.mouse.wheel(0, 400);
    await settleAnimationFrame(page);

    const gridScrollAfter = await grid.evaluate((el) => el.scrollTop);

    expect(gridScrollAfter).toBeGreaterThan(gridScrollBefore);

    await page.keyboard.press('Escape');

    await expect(menu).toBeHidden();
    await expect(page.locator(SCROLL_LOCKED_SELECTOR)).not.toBeAttached();
  });
});
