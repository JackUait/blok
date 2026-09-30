import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { selectAllInEditable } from '../helpers/selection';
import { gotoTestPage } from '../helpers/shared-page';

test.beforeAll(ensureBlokBundleBuilt);

const TEXT = 'Make these words yours.';

const mount = async (page: Page, width: number, height = 844, marginTop = 120): Promise<void> => {
  await page.setViewportSize({ width, height });
  await gotoTestPage(page);
  await page.evaluate(async ({ text, top }) => {
    const holder = document.createElement('div');

    holder.style.cssText = `max-width:650px;margin:${top}px auto 0;padding:0 8px`;
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: [ { type: 'paragraph', data: { text } } ] } });
    await window.blokInstance.isReady;
  }, { text: TEXT, top: marginTop });
};

const selectParagraph = async (page: Page): Promise<Locator> => {
  const paragraph = page.getByTestId('block-wrapper').filter({ hasText: TEXT })
    .locator('[contenteditable="true"]');

  await selectAllInEditable(paragraph);

  return paragraph;
};

const toolbar = (page: Page): Locator => page.locator('[data-blok-interface="inline-toolbar"]');
const card = (page: Page): Locator => toolbar(page).getByTestId('popover-container').first();

test('the card animates in', async ({ page }) => {
  await mount(page, 1280);
  await selectParagraph(page);
  await expect(card(page)).toHaveCSS('animation-name', 'blok-inline-toolbar-in');
});

test('the card does not animate under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(page, 1280);
  await selectParagraph(page);
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toHaveCSS('animation-name', 'none');
});

/**
 * The toolbar opens after the selectionchange debounce, then plays its entrance.
 * Measure only once it is open and settled, or boxes read 0.98 of their size.
 */
const settle = async (page: Page): Promise<void> => {
  await expect(toolbar(page).locator('[data-blok-popover-opened="true"]')).toHaveCount(1);
  await toolbar(page).evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => undefined)));
  });
};

const rectOf = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const box = await locator.boundingBox();

  if (box === null) {
    throw new Error('Element has no box');
  }

  return box;
};

test('cells sit in Notion order, five per row', async ({ page }) => {
  await mount(page, 1280);
  await selectParagraph(page);
  await settle(page);
  const cells = toolbar(page).locator('[data-blok-popover-item]:not([data-blok-item-name="convert-to"])');
  const names = await cells.evaluateAll(elements => elements.map(element => element.getAttribute('data-blok-item-name')));

  // The shared test page does not register every built-in, so check the order
  // of the ones it does.
  const canonical = [ 'marker', 'bold', 'italic', 'underline', 'clearFormat', 'link', 'strikethrough', 'inlineCode', 'equation', 'supSub' ];

  expect(names.length).toBeGreaterThan(5);
  expect(names).toEqual(canonical.filter(name => names.includes(name)));
  const tops = await cells.evaluateAll(elements => elements.map(element => Math.round(element.getBoundingClientRect().y)));

  expect(new Set(tops.slice(0, 5)).size).toBe(1);
  expect(new Set(tops.slice(5)).size).toBe(1);
  expect(tops[5]).toBeGreaterThan(tops[0]);
});

test('desktop cells are 32x28 with 4px gaps inside an 8px-padded, 14px-round card', async ({ page }) => {
  await mount(page, 1280);
  await selectParagraph(page);
  await settle(page);
  const bold = await rectOf(toolbar(page).locator('[data-blok-item-name="bold"]'));
  const italic = await rectOf(toolbar(page).locator('[data-blok-item-name="italic"]'));

  expect(bold.width).toBeCloseTo(32, 0);
  expect(bold.height).toBeCloseTo(28, 0);
  expect(italic.x - (bold.x + bold.width)).toBeCloseTo(4, 0);
  await expect(card(page)).toHaveCSS('border-top-left-radius', '10px');
  await expect(card(page)).toHaveCSS('padding-top', '8px');
  await expect(card(page)).toHaveCSS('padding-left', '8px');
  await expect(card(page)).toHaveCSS('padding-bottom', '8px');
  await expect(card(page)).toHaveCSS('box-shadow', /rgba\(42, 28, 0, 0\.07\)/);
});

test('touch cells are at least 40px on a phone', async ({ page }) => {
  await mount(page, 390);
  await selectParagraph(page);
  await settle(page);
  const bold = await rectOf(toolbar(page).locator('[data-blok-item-name="bold"]'));

  expect(bold.height).toBeGreaterThanOrEqual(40);
  expect(bold.width).toBeGreaterThanOrEqual(40);
});

test('an active format shows in primary ink on a gray fill, never blue', async ({ page }) => {
  await mount(page, 1280);
  const paragraph = await selectParagraph(page);
  const bold = toolbar(page).locator('[data-blok-item-name="bold"]');

  await bold.click();
  await expect.poll(() => paragraph.innerHTML()).toMatch(/^<(b|strong)>/);
  await expect(bold).toHaveAttribute('data-blok-popover-item-active', /.*/);
  const ink = await toolbar(page).locator('[data-blok-item-name="italic"]').evaluate(element => getComputedStyle(element).color);
  const fill = await bold.evaluate(element => getComputedStyle(element).backgroundColor);
  const [r = 0, g = 0, b = 0] = (fill.match(/[\d.]+/g) ?? []).map(Number);

  await expect(bold).toHaveCSS('color', ink);
  expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(10);
});

test('the A cell shows the text color already applied to the selection', async ({ page }) => {
  await mount(page, 1280);
  await selectParagraph(page);
  const marker = toolbar(page).locator('[data-blok-item-name="marker"]');

  await marker.click();
  await page.getByTestId('marker-swatch-color-red').click();
  // #d44c47 is the light 'red' preset's text color (color-presets.ts).
  await expect(marker).toHaveCSS('color', 'rgb(212, 76, 71)');
});

const selectionBottom = (page: Page): Promise<number> => page.evaluate(() => {
  const selection = window.getSelection();

  if (selection === null || selection.rangeCount === 0) {
    throw new Error('No selection');
  }

  return selection.getRangeAt(0).getBoundingClientRect().bottom;
});

test('it opens below the selection and grows from the top-left', async ({ page }) => {
  await mount(page, 1280);
  await selectParagraph(page);
  await settle(page);
  const box = await rectOf(card(page));

  expect(box.y).toBeGreaterThanOrEqual(await selectionBottom(page) - 1);
  expect(await toolbar(page).evaluate(element => element.style.getPropertyValue('--_blok-inline-toolbar-origin'))).toBe('left top');
});

test('near the viewport bottom it flips above and grows from the bottom-left', async ({ page }) => {
  await mount(page, 1280, 400, 340);
  const paragraph = await selectParagraph(page);

  await settle(page);
  const text = await rectOf(paragraph);
  const box = await rectOf(card(page));

  expect(box.y + box.height).toBeLessThanOrEqual(text.y + 1);
  expect(await toolbar(page).evaluate(element => element.style.getPropertyValue('--_blok-inline-toolbar-origin'))).toBe('left bottom');
});

const openTurnInto = async (page: Page): Promise<Locator> => {
  await selectParagraph(page);
  await settle(page);
  await toolbar(page).locator('[data-blok-item-name="convert-to"]').click();
  const menu = page.getByTestId('popover-container').filter({ has: page.getByRole('combobox') });

  await expect(menu).toBeVisible();
  await menu.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => undefined)));
  });

  return menu;
};

test('Turn into opens beside the card on desktop', async ({ page }) => {
  await mount(page, 1280);
  const menu = await openTurnInto(page);
  const cardBox = await rectOf(card(page));
  const menuBox = await rectOf(menu);

  // Beside, not below: it starts at the card's right edge (nested menus overlap
  // their parent by up to --nested-popover-overlap, 4px) and above its bottom.
  expect(menuBox.x).toBeGreaterThanOrEqual(cardBox.x + cardBox.width - 4);
  expect(menuBox.y).toBeLessThan(cardBox.y + cardBox.height);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(1280);
});

test('Turn into stays on screen on a phone', async ({ page }) => {
  await mount(page, 390);
  const menuBox = await rectOf(await openTurnInto(page));

  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(390);
});

test('the color panel opens under the A cell', async ({ page }) => {
  await mount(page, 1280);
  await selectParagraph(page);
  await settle(page);
  const marker = toolbar(page).locator('[data-blok-item-name="marker"]');
  const aCell = await rectOf(marker);

  await marker.click();
  const panel = await rectOf(page.getByTestId('marker-picker'));

  expect(panel.y).toBeGreaterThanOrEqual(aCell.y + aCell.height - 1);
});

// `inlineToolbar` picks WHICH tools appear, never where: the card renders them in
// INLINE_TOOL_ORDER (src/components/constants/inline-tool-order.ts).
test('a configured formatting set renders in canonical order', async ({ page }) => {
  await gotoTestPage(page);
  await page.evaluate(async () => {
    const holder = document.createElement('div');

    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      inlineToolbar: [ 'underline', 'bold', 'italic' ],
      data: { blocks: [ { type: 'paragraph', data: { text: 'Keep my tools in order.' } } ] },
    });
    await window.blokInstance.isReady;
  });
  const paragraph = page.getByTestId('block-wrapper').filter({ hasText: 'Keep my tools in order.' })
    .locator('[contenteditable="true"]');

  await selectAllInEditable(paragraph);
  const tools = toolbar(page).getByRole('menuitemcheckbox');

  await expect(tools).toHaveCount(3);
  await expect(tools.nth(0)).toHaveAccessibleName('Bold');
  await expect(tools.nth(1)).toHaveAccessibleName('Italic');
  await expect(tools.nth(2)).toHaveAccessibleName('Underline');
  await page.keyboard.press('Tab');
  await expect(tools.nth(0)).toHaveAttribute('data-blok-focused', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(tools.nth(1)).toHaveAttribute('data-blok-focused', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(tools.nth(0)).toHaveAttribute('data-blok-focused', 'true');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(tools.nth(2)).toHaveAttribute('data-blok-focused', 'true');
  await page.keyboard.press('Enter');
  await expect.poll(() => paragraph.innerHTML()).toBe('<u>Keep my tools in order.</u>');
});

for (const top of [ 480, 490, 495, 500, 505, 510, 520, 540, 560 ]) {
  test(`the card stays inside a narrow viewport with the selection at ${top}px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 620 });
    await gotoTestPage(page);
    await page.evaluate(async (offset) => {
      const holder = document.createElement('div');

      holder.style.cssText = `position:absolute;left:8px;top:${offset}px;width:180px`;
      document.body.append(holder);
      window.blokInstance = new window.Blok({
        holder,
        minHeight: 0,
        data: { blocks: [ { type: 'paragraph', data: { text: 'Keep me visible.' } } ] },
      });
      await window.blokInstance.isReady;
    }, top);
    const paragraph = page.getByTestId('block-wrapper').filter({ hasText: 'Keep me visible.' })
      .locator('[contenteditable="true"]');

    await selectAllInEditable(paragraph);
    const bold = toolbar(page).getByRole('menuitemcheckbox', { name: 'Bold', exact: true });

    await expect(bold).toBeVisible();
    await settle(page);
    const box = await rectOf(card(page));

    expect(box.x).toBeGreaterThanOrEqual(8);
    expect(box.y).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width).toBeLessThanOrEqual(382);
    expect(box.y + box.height).toBeLessThanOrEqual(612);
    await bold.click();
    await expect.poll(() => paragraph.innerHTML()).toMatch(/^<(b|strong)>Keep me visible\.<\/\1>$/);
  });
}

test('extra custom tools start new rows of five without widening the card', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await gotoTestPage(page);
  await page.evaluate(async ({ text }) => {
    const holder = document.createElement('div');
    const tools: Record<string, { class: unknown }> = {};

    for (const name of [ 'extraOne', 'extraTwo', 'extraThree', 'extraFour' ]) {
      tools[name] = {
        class: class {
          public static isInline = true;

          public render(): { icon: string; name: string; title: string; onActivate: () => void } {
            return { icon: '<svg width="16" height="16"></svg>', name, title: name, onActivate: () => undefined };
          }
        },
      };
    }

    holder.style.cssText = 'max-width:650px;margin:120px auto 0;padding:0 8px';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, tools, data: { blocks: [ { type: 'paragraph', data: { text } } ] } });
    await window.blokInstance.isReady;
  }, { text: TEXT });
  await selectParagraph(page);
  await settle(page);
  const cells = toolbar(page).locator('[data-blok-popover-item]:not([data-blok-item-name="convert-to"])');
  const names = await cells.evaluateAll(elements => elements.map(element => element.getAttribute('data-blok-item-name')));

  expect(names.slice(-4)).toEqual([ 'extraOne', 'extraTwo', 'extraThree', 'extraFour' ]);
  expect(names.length).toBeGreaterThan(10);
  const tops = [ ...new Set(await cells.evaluateAll(elements => elements.map(element => Math.round(element.getBoundingClientRect().y)))) ];

  expect(tops).toHaveLength(Math.ceil(names.length / 5));
  expect((await rectOf(card(page))).width).toBeCloseTo(192, 0);
});
