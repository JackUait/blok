import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputBlockData } from '@/types';

import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

type Direction = 'ltr' | 'rtl';

const DIRECTIONS: Direction[] = ['ltr', 'rtl'];

const createBlok = async (page: Page, direction: Direction, blocks: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async ({ dir, data }) => {
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:650px;margin:120px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, i18n: { direction: dir }, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, { dir: direction, data: blocks });
};

const paragraph = (text: string): OutputBlockData => ({ type: 'paragraph', data: { text } });

const settle = async (target: Locator): Promise<void> => {
  await target.evaluate(async (element) => {
    const root = element.closest('[data-blok-popover]') ?? element;

    await Promise.all(root.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
  });
};

const box = async (target: Locator): Promise<{ left: number; right: number }> => {
  await settle(target);

  return target.evaluate((element) => {
    const rect = element.getBoundingClientRect();

    return { left: rect.left, right: rect.right };
  });
};

/** The edge a surface starts from: right in RTL. */
const startOf = (direction: Direction, rect: { left: number; right: number }): number =>
  direction === 'rtl' ? rect.right : rect.left;

const openPopover = (page: Page): Locator =>
  page.locator('[data-blok-popover][data-blok-popover-opened="true"]').last();

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoTestPage(page);
});

for (const direction of DIRECTIONS) {
  test.describe(`floating surfaces in ${direction}`, () => {
    test('the slash menu lines up with the block start edge', async ({ page }) => {
      await createBlok(page, direction, [paragraph('')]);
      const block = page.locator('[data-blok-component="paragraph"]').first();

      await block.click();
      await page.keyboard.type('/');
      const menu = openPopover(page).locator('[data-blok-popover-container]').first();

      await expect(menu).toBeVisible();
      const [menuBox, content] = await Promise.all([
        box(menu),
        box(page.locator('[data-blok-element-content]').first()),
      ]);

      expect(Math.abs(startOf(direction, menuBox) - startOf(direction, content))).toBeLessThanOrEqual(1);
      await expect(openPopover(page)).toHaveAttribute('dir', direction);
      await expect(openPopover(page)).toHaveAttribute('data-align', 'start');
    });

    test('a submenu opens toward the inline end with a matching chevron', async ({ page }) => {
      await createBlok(page, direction, [paragraph('Submenu side')]);
      await page.getByText('Submenu side', { exact: true }).hover();
      await page.getByTestId('settings-toggler').click();
      const parent = openPopover(page).locator('[data-blok-popover-container]').first();
      const convert = page.getByRole('menuitem', { name: 'Convert to', exact: true });

      await expect(convert).toBeVisible();
      const chevron = convert.locator('[data-blok-popover-item-icon-chevron-right] svg');

      // The chevron points where the submenu will open.
      expect(await chevron.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a))
        .toBe(direction === 'rtl' ? -1 : 1);

      await convert.click();
      const submenu = page.getByTestId('popover-container').filter({ has: page.locator('[data-blok-convert-item]') }).last();

      await expect(submenu).toBeVisible();
      const [parentBox, submenuBox] = await Promise.all([box(parent), box(submenu)]);

      // Past the parent's inline end, overlapping its trailing edge by 4px.
      const pastParentEnd = direction === 'rtl'
        ? parentBox.left - submenuBox.right
        : submenuBox.left - parentBox.right;

      expect(pastParentEnd).toBeGreaterThanOrEqual(-5);
      expect(pastParentEnd).toBeLessThan(0);
    });

    test('the arrow toward the inline end opens a submenu and the other one closes it', async ({ page }) => {
      await createBlok(page, direction, [paragraph('Submenu keys')]);
      await page.getByText('Submenu keys', { exact: true }).hover();
      await page.getByTestId('settings-toggler').click();
      const convert = page.getByRole('menuitem', { name: 'Convert to', exact: true });

      await expect(convert).toBeVisible();

      for (let step = 0; step < 12; step++) {
        if (await convert.getAttribute('data-blok-focused') === 'true') {
          break;
        }
        await page.keyboard.press('ArrowDown');
      }
      await expect(convert).toHaveAttribute('data-blok-focused', 'true');

      const [openKey, backKey] = direction === 'rtl' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowRight', 'ArrowLeft'];
      const submenu = page.getByTestId('popover-container').filter({ has: page.locator('[data-blok-convert-item]') });

      await page.keyboard.press(backKey);
      await expect(submenu).toHaveCount(0);
      await page.keyboard.press(openKey);
      await expect(submenu.last()).toBeVisible();
      await page.keyboard.press(backKey);
      await expect(submenu).toHaveCount(0);
    });

    test('shortcut glyphs keep keyboard order', async ({ page }) => {
      await createBlok(page, direction, [paragraph('Shortcut order')]);
      await page.getByText('Shortcut order', { exact: true }).hover();
      await page.getByTestId('settings-toggler').click();
      const shortcut = openPopover(page).getByTestId('popover-item-secondary-title').first();

      await expect(shortcut).toBeVisible();
      const lefts = await shortcut.evaluate((label) =>
        Array.from(label.firstElementChild?.children ?? []).map((glyph) => glyph.getBoundingClientRect().left));

      expect(lefts.length).toBeGreaterThan(1);
      expect([...lefts].sort((a, b) => a - b)).toEqual(lefts);
    });

    test('the inline toolbar starts at the selection start edge', async ({ page }) => {
      await createBlok(page, direction, [paragraph('Hello world here')]);
      const editable = page.locator('[data-blok-component="paragraph"]').first();

      await editable.evaluate((element) => {
        const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();
        const range = document.createRange();

        if (text === null) {
          throw new Error('Missing text node');
        }
        range.setStart(text, 6);
        range.setEnd(text, 11);
        const selection = document.getSelection();

        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      });
      const toolbar = page.getByTestId('inline-toolbar').filter({ visible: true }).first();

      await expect(toolbar).toBeVisible();
      await settle(toolbar);
      const [bar, selected] = await Promise.all([
        box(toolbar),
        page.evaluate(() => {
          const rect = document.getSelection()?.getRangeAt(0).getBoundingClientRect();

          return { left: rect?.left ?? 0, right: rect?.right ?? 0 };
        }),
      ]);

      expect(Math.abs(startOf(direction, bar) - startOf(direction, selected))).toBeLessThanOrEqual(1);
    });

    test('a Latin item title keeps its order in the language picker', async ({ page }) => {
      await createBlok(page, direction, [{ type: 'code', data: { code: 'int main() {}', language: 'cpp' } }]);
      await page.getByTestId('code-language-btn').click();
      const title = openPopover(page).getByTestId('popover-item-title').filter({ hasText: /^C\+\+$/ }).first();

      await title.scrollIntoViewIfNeeded();
      const order = await title.evaluate((element) => {
        const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();

        if (text === null) {
          throw new Error('Missing title text');
        }
        const at = (index: number): number => {
          const range = document.createRange();

          range.setStart(text, index);
          range.setEnd(text, index + 1);

          return range.getBoundingClientRect().left;
        };

        return [at(0), at(1), at(2)];
      });

      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    test('the emoji picker opens from the icon start edge', async ({ page }) => {
      await createBlok(page, direction, [{ type: 'callout', data: { emoji: '💡', color: 'default' } }]);
      const trigger = page.getByTestId('callout-emoji-btn');

      await trigger.click();
      const picker = page.getByRole('dialog', { name: 'Edit icon' });

      await expect(picker).toBeVisible();
      await expect(picker).toHaveAttribute('dir', direction);
      const [pickerBox, triggerBox] = await Promise.all([box(picker), box(trigger)]);

      // 8px before the trigger's start edge, measured outward.
      const outward = direction === 'rtl' ? 1 : -1;

      expect(Math.abs((startOf(direction, pickerBox) - startOf(direction, triggerBox)) * outward - 8)).toBeLessThanOrEqual(1);
    });
  });
}

test('open menus and toasts follow a runtime direction flip', async ({ page }) => {
  await createBlok(page, 'ltr', [paragraph('')]);
  await page.locator('[data-blok-component="paragraph"]').first().click();
  await page.keyboard.type('/');
  await expect(openPopover(page)).toHaveAttribute('dir', 'ltr');
  await page.evaluate(() => window.blokInstance?.notifier.show({ message: 'Saved', time: 20_000 }));
  const toast = page.getByTestId('notification');

  await expect(toast).toBeVisible();

  await page.evaluate(async () => {
    await window.blokInstance?.i18n.update({ direction: 'rtl' });
  });

  await expect(openPopover(page)).toHaveAttribute('dir', 'rtl');
  await expect(toast).toHaveAttribute('dir', 'rtl');
});
