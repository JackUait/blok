/**
 * Tool-owned floating surfaces after a runtime LTR → RTL flip. A surface
 * anchored to block content follows its anchor to where a fresh RTL open
 * puts it; a hover surface whose anchor moved out from under the pointer closes.
 */

import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

type Direction = 'ltr' | 'rtl';

interface Box { left: number; right: number; top: number }

const IMAGE_URL = new URL('/test/playwright/fixtures/image/shot.png', TEST_PAGE_URL).href;
const AUDIO_URL = new URL('/test/playwright/fixtures/audio/sample.mp3', TEST_PAGE_URL).href;

const createBlok = async (page: Page, direction: Direction, blocks: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async ({ dir, data }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();

    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:760px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, i18n: { direction: dir }, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, { dir: direction, data: blocks });
};

const flip = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    await window.blokInstance?.i18n.update({ direction: 'rtl' });
  });
};

const box = async (target: Locator): Promise<Box> => {
  await target.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
  });

  return target.evaluate((element) => {
    const rect = element.getBoundingClientRect();

    return { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top) };
  });
};

/**
 * Opens the surface in a fresh RTL editor, then in an LTR one that flips to
 * RTL, and returns both boxes.
 */
const freshAndFlipped = async (
  page: Page,
  blocks: OutputBlockData[],
  openSurface: () => Promise<Locator>
): Promise<{ fresh: Box; flipped: Box; ltr: Box }> => {
  await createBlok(page, 'rtl', blocks);
  const fresh = await box(await openSurface());

  await page.keyboard.press('Escape');
  await page.mouse.move(0, 0);
  await createBlok(page, 'ltr', blocks);
  const surface = await openSurface();
  const ltr = await box(surface);

  await flip(page);
  await expect(surface).toHaveAttribute('dir', 'rtl');

  return { fresh, flipped: await box(surface), ltr };
};

const database = (title: string): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
        {
          id: 'prop-status',
          name: 'Status',
          type: 'select',
          position: 'a1',
          config: { options: [{ id: 'opt-a', label: 'A', color: 'gray', position: 'a0' }] },
        },
      ],
      views: [
        { id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: ['prop-title'] },
      ],
      activeViewId: 'view-1',
    },
    content: ['row-1'],
  },
  { id: 'row-1', type: 'database-row', data: { position: 'a0', properties: { 'prop-title': title, 'prop-status': 'opt-a' } } },
];

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('tool surfaces after a runtime flip to RTL', () => {
  test('the audio cover picker moves to where a fresh RTL picker opens', async ({ page }) => {
    const blocks: OutputBlockData[] = [{ type: 'audio', data: { url: AUDIO_URL, title: 'نشيد' } }];
    const { fresh, flipped, ltr } = await freshAndFlipped(page, blocks, async () => {
      const audio = page.locator('[data-blok-tool="audio"]');

      await audio.locator('[data-role="audio-cover"]').hover();
      await audio.locator('[data-role="audio-cover-change"]').click();
      const picker = page.locator('[data-role="audio-cover-picker"]');

      await expect(picker).toBeVisible();

      return picker;
    });

    expect(fresh).not.toEqual(ltr);
    expect(flipped).toEqual(fresh);
  });

  test('the callout emoji picker moves to where a fresh RTL picker opens', async ({ page }) => {
    const blocks: OutputBlockData[] = [{ type: 'callout', data: { emoji: '💡', color: 'default' } }];
    const { fresh, flipped, ltr } = await freshAndFlipped(page, blocks, async () => {
      await page.getByTestId('callout-emoji-btn').click();
      const picker = page.getByRole('dialog', { name: 'Edit icon' });

      await expect(picker).toBeVisible();

      return picker;
    });

    expect(fresh).not.toEqual(ltr);
    expect(flipped).toEqual(fresh);
  });

  test('the image alt text popover moves to where a fresh RTL popover opens', async ({ page }) => {
    const blocks: OutputBlockData[] = [{ type: 'image', data: { url: IMAGE_URL, naturalWidth: 800, naturalHeight: 600 } }];
    const { fresh, flipped, ltr } = await freshAndFlipped(page, blocks, async () => {
      await page.locator('[data-blok-tool="image"] img').hover();
      await page.locator('[data-blok-tool="image"] [data-action="alt-edit"]').click();
      const popover = page.locator('[data-role="image-alt-popover"]');

      await expect(popover).toBeVisible();

      return popover;
    });

    expect(fresh).not.toEqual(ltr);
    expect(flipped).toEqual(fresh);
  });

  test('the database property type menu moves to where a fresh RTL menu opens', async ({ page }) => {
    const { fresh, flipped, ltr } = await freshAndFlipped(page, database('إصلاح الخطأ'), async () => {
      await page.locator('[data-blok-database-card]').first().click();
      await page.locator('[data-blok-database-drawer-add-prop]').click();
      const menu = page.locator('[data-blok-database-property-type-popover]');

      await expect(menu).toBeVisible();

      return menu;
    });

    expect(fresh).not.toEqual(ltr);
    expect(flipped).toEqual(fresh);
  });

  test('the database page body editor follows the flip', async ({ page }) => {
    await createBlok(page, 'ltr', database('إصلاح الخطأ'));
    await page.locator('[data-blok-database-card]').first().click();
    const inner = page.locator('[data-blok-database-drawer-editor] [data-blok-editor]');

    await expect(inner).toHaveAttribute('dir', 'ltr');

    await flip(page);

    await expect(inner).toHaveAttribute('dir', 'rtl');
  });

  test('an open tooltip closes, since its anchor moved', async ({ page }) => {
    // Empty, so the toggle takes the editor direction and its arrow mirrors.
    await createBlok(page, 'ltr', [{ type: 'toggle', data: { text: '' } }]);
    const button = page.locator('[data-blok-toggle-arrow]');
    const tooltip = page.getByTestId('tooltip');

    await button.hover();
    await expect(tooltip).toHaveAttribute('data-blok-shown', 'true');
    const before = await box(button);

    await flip(page);

    expect(await box(button)).not.toEqual(before);
    await expect(tooltip).toHaveAttribute('data-blok-shown', 'false');
  });

  test('an open link hover card closes, since its link moved', async ({ page }) => {
    await createBlok(page, 'ltr', [{ type: 'paragraph', data: { text: '\u200Fنص <a href="https://example.com">رابط</a>' } }]);
    const link = page.locator('[data-blok-tool="paragraph"] a');
    const card = page.getByTestId('link-hover-card');

    await link.hover();
    await expect(card).toHaveAttribute('data-state', 'open');
    const before = await box(link);

    await flip(page);

    expect(await box(link)).not.toEqual(before);
    await expect(card).not.toHaveAttribute('data-state', 'open');
    await expect(card).not.toBeAttached();
  });
});
