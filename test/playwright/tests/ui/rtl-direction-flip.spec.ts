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
type Box = { left: number; right: number; top: number };

const ARABIC = [
  { id: 'p1', type: 'paragraph', data: { text: 'نص الفقرة الأولى' } },
  { id: 'p2', type: 'paragraph', data: { text: 'نص الفقرة الثانية' } },
];

const createBlok = async (
  page: Page,
  direction: Direction,
  blocks: OutputBlockData[] = ARABIC,
  holderCss = 'width:720px;margin:0 auto'
): Promise<void> => {
  await page.evaluate(async ({ dir, data, css }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();

    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = css;
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, i18n: { direction: dir }, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, { dir: direction, data: blocks, css: holderCss });
};

const flip = async (page: Page, direction: Direction): Promise<void> => {
  await page.evaluate(async (dir) => {
    await window.blokInstance?.i18n.update({ direction: dir });
  }, direction);
};

const box = async (target: Locator): Promise<Box> => {
  await target.evaluate(async (element) => {
    const root = element.closest('[data-blok-popover]') ?? element;

    await Promise.all(root.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
  });

  return target.evaluate((element) => {
    const rect = element.getBoundingClientRect();

    return { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top) };
  });
};

const openPopovers = (page: Page): Locator => page.locator('[data-blok-popover][data-blok-popover-opened="true"]');

const menuContainer = (page: Page): Locator =>
  page.locator('[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]').first();

const openBlockSettings = async (page: Page): Promise<void> => {
  await page.locator('[data-blok-tool="paragraph"]').first().hover();
  await page.getByTestId('settings-toggler').click();
  await expect(menuContainer(page)).toBeVisible();
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoTestPage(page);
});

test.describe('runtime direction flip with editor chrome open', () => {
  test('closes the block menu and its submenu; reopening lands where a fresh RTL menu does', async ({ page }) => {
    await createBlok(page, 'rtl');
    await openBlockSettings(page);
    const freshRtl = await box(menuContainer(page));

    await createBlok(page, 'ltr');
    await openBlockSettings(page);
    await page.getByRole('menuitem', { name: 'Convert to', exact: true }).click();
    await expect(openPopovers(page)).toHaveCount(2);

    await flip(page, 'rtl');

    await expect(openPopovers(page)).toHaveCount(0);

    await openBlockSettings(page);
    expect(await box(menuContainer(page))).toEqual(freshRtl);
  });

  test('an update that keeps the direction leaves the block menu open', async ({ page }) => {
    await createBlok(page, 'ltr');
    await openBlockSettings(page);
    const before = await box(menuContainer(page));

    await flip(page, 'ltr');

    await expect(openPopovers(page)).toHaveCount(1);
    expect(await box(menuContainer(page))).toEqual(before);
  });

  test('closes the inline toolbar', async ({ page }) => {
    await createBlok(page, 'ltr');
    await page.locator('[data-blok-tool="paragraph"]').first().evaluate((element) => {
      const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();

      if (text === null) {
        throw new Error('Missing text node');
      }
      const range = document.createRange();

      range.setStart(text, 0);
      range.setEnd(text, 6);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    const toolbar = page.getByTestId('inline-toolbar').filter({ visible: true }).first();

    await expect(toolbar).toBeVisible();

    await flip(page, 'rtl');

    await expect(page.getByTestId('inline-toolbar').filter({ visible: true })).toHaveCount(0);
  });

  test('an open tool menu stays open and moves to where a fresh RTL one opens', async ({ page }) => {
    const code: OutputBlockData[] = [{ type: 'code', data: { code: 'int main() {}', language: 'cpp' } }];
    const picker = openPopovers(page).locator('[data-blok-popover-container]').first();

    await createBlok(page, 'rtl', code);
    await page.getByTestId('code-language-btn').click();
    await expect(picker).toBeVisible();
    const freshRtl = await box(picker);

    await createBlok(page, 'ltr', code);
    await page.getByTestId('code-language-btn').click();
    await expect(picker).toBeVisible();

    await flip(page, 'rtl');

    await expect(openPopovers(page)).toHaveAttribute('dir', 'rtl');
    await expect.poll(() => box(picker)).toEqual(freshRtl);
  });

  test('re-places the open block toolbar on the new side, inside the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 600 });
    await page.addStyleTag({ content: '#blok [data-blok-interface] { --blok-editor-gutter-start: 0px; }' });
    await createBlok(page, 'rtl', ARABIC, 'width:100%;margin:0');
    await page.locator('[data-blok-tool="paragraph"]').first().hover();
    const plus = page.getByTestId('plus-button');

    await expect(plus).toBeVisible();
    const freshRtl = await box(plus);

    await createBlok(page, 'ltr', ARABIC, 'width:100%;margin:0');
    await page.mouse.move(0, 0);
    await page.locator('[data-blok-tool="paragraph"]').first().hover();
    await expect(plus).toBeVisible();

    await flip(page, 'rtl');

    const flipped = await box(plus);

    expect(flipped.right).toBeLessThanOrEqual(700);
    expect(flipped).toEqual(freshRtl);
  });
});
