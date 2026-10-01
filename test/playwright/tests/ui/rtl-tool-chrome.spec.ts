/**
 * Tool chrome in a right-to-left editor: each control must sit on the inline
 * side it sits on in LTR, mirrored. The content is Arabic, so blocks are RTL.
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

interface Rect { left: number; right: number; top: number; bottom: number; width: number }

const DIRECTIONS: Direction[] = ['ltr', 'rtl'];
const TOLERANCE = 2;

const IMAGE_URL = new URL('/test/playwright/fixtures/image/shot.png', TEST_PAGE_URL).href;
const VIDEO_URL = new URL('/public/samples/big-buck-bunny.mp4', TEST_PAGE_URL).href;
const AUDIO_URL = new URL('/test/playwright/fixtures/audio/sample.mp3', TEST_PAGE_URL).href;

const text = (direction: Direction, ltr: string, rtl: string): string => direction === 'rtl' ? rtl : ltr;

const createBlok = async (page: Page, direction: Direction, blocks: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async ({ dir, data }) => {
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:760px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, i18n: { direction: dir }, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, { dir: direction, data: blocks });
};

const rect = async (target: Locator): Promise<Rect> => target.evaluate((element) => {
  const r = element.getBoundingClientRect();

  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
});

const settle = async (target: Locator): Promise<void> => {
  await target.evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
  });
};

/** Distance from the container's inline-start edge to the element's inline-start edge. */
const fromStart = (direction: Direction, inner: Rect, outer: Rect): number =>
  direction === 'rtl' ? outer.right - inner.right : inner.left - outer.left;

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

for (const direction of DIRECTIONS) {
  test.describe(`${direction}`, () => {
    test('the lightbox prev/next pill sits at the inline start', async ({ page }) => {
      const alt = text(direction, 'Picture', 'صورة');

      await createBlok(page, direction, [
        { type: 'image', data: { url: IMAGE_URL, alt, caption: alt } },
        { type: 'image', data: { url: IMAGE_URL, alt: `${alt} 2`, caption: alt } },
      ]);

      await page.getByAltText(alt, { exact: true }).click();

      const dialog = page.getByRole('dialog');
      const nav = dialog.locator('[data-role="lightbox-nav"]');

      await expect(nav).toBeVisible();
      await expect(dialog).toHaveAttribute('dir', direction);
      await settle(dialog);

      const navBox = await rect(nav);
      const viewport = await rect(dialog);

      expect(Math.abs(fromStart(direction, navBox, viewport) - 24)).toBeLessThanOrEqual(TOLERANCE);
    });

    test('the image alt pill sits at the inline start of the figure', async ({ page }) => {
      const caption = text(direction, 'A caption', 'تعليق الصورة');

      await createBlok(page, direction, [
        { type: 'image', data: { url: IMAGE_URL, caption } },
      ]);

      const image = page.locator('[data-blok-tool="image"]');

      await expect(image).toHaveAttribute('data-state', 'rendered');
      await image.hover();

      const pill = image.locator('[data-action="alt-edit"]');

      await expect(pill).toBeVisible();

      const offset = await pill.evaluate((element, dir) => {
        const own = element.getBoundingClientRect();
        const figure = element.parentElement?.getBoundingClientRect();

        if (figure === undefined) {
          return Number.NaN;
        }

        return dir === 'rtl' ? figure.right - own.right : own.left - figure.left;
      }, direction);

      expect(offset).toBeLessThanOrEqual(16);
    });

    test('a nested drop line indents from the inline start', async ({ page }) => {
      await createBlok(page, direction, [
        { type: 'paragraph', data: { text: text(direction, 'First', 'الأول') } },
      ]);

      const holder = page.locator('[data-blok-element]').first();

      const sides = await holder.evaluate((element) => {
        element.setAttribute('data-drop-indicator', 'bottom');
        element.style.setProperty('--drop-indicator-depth', '2');

        const line = getComputedStyle(element, '::before');

        return { left: parseFloat(line.left), right: parseFloat(line.right) };
      });

      // Depth 2 indents by two 12px steps on the inline-start side only.
      const start = direction === 'rtl' ? sides.right : sides.left;
      const end = direction === 'rtl' ? sides.left : sides.right;

      expect(start).toBe(24);
      expect(end).toBe(0);
    });

    test('the database side peek opens from the inline end', async ({ page }) => {
      const title = text(direction, 'Fix bug', 'إصلاح الخطأ');

      await createBlok(page, direction, [
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
      ]);

      await page.locator('[data-blok-database-card]').first().click();

      const drawer = page.locator('[data-blok-database-drawer]');

      await expect(drawer).toBeVisible();
      await expect.poll(async () => (await rect(drawer)).width).toBeGreaterThan(300);
      await settle(drawer);

      const drawerBox = await rect(drawer);
      const viewportWidth = page.viewportSize()?.width ?? 0;
      const endGap = direction === 'rtl' ? drawerBox.left : viewportWidth - drawerBox.right;

      expect(Math.abs(endGap)).toBeLessThanOrEqual(TOLERANCE);

      const geometry = await drawer.evaluate((element) => {
        const style = getComputedStyle(element);
        const icons = Array.from(element.querySelectorAll('[data-blok-database-drawer-close] svg'));

        return {
          borderLeft: style.borderLeftWidth,
          borderRight: style.borderRightWidth,
          iconTransforms: icons.map(icon => getComputedStyle(icon).transform),
        };
      });

      // The hairline faces the page, on the drawer's inline-start side.
      expect(direction === 'rtl' ? geometry.borderRight : geometry.borderLeft).toBe('1px');
      expect(direction === 'rtl' ? geometry.borderLeft : geometry.borderRight).toBe('0px');
      // The » close chevrons point toward the inline end.
      geometry.iconTransforms.forEach((transform) => {
        expect(transform).toBe(direction === 'rtl' ? 'matrix(-1, 0, 0, 1, 0, 0)' : 'none');
      });

      await expect.poll(() => drawer.evaluate(element =>
        element.querySelector('[data-blok-database-drawer-editor] [data-blok-interface]')?.getAttribute('dir') ?? null
      )).toBe(direction);
    });

    test('the video settings menu opens over the player with its speed ruler inside', async ({ page }) => {
      const caption = text(direction, 'My clip', 'مقطع فيديو');

      await createBlok(page, direction, [
        { type: 'video', data: { url: VIDEO_URL, caption, alignment: 'center' } },
      ]);

      const video = page.locator('[data-blok-tool="video"]');
      const gear = video.locator('[data-action="gear"]');

      await video.hover();
      await gear.click({ force: true });

      const menu = video.locator('[data-role="playback-menu"]');

      await expect(menu).toBeVisible();
      await settle(menu);

      const menuBox = await rect(menu);
      const gearBox = await rect(gear);

      // The card grows from the gear toward the inline start, like in LTR.
      const anchored = direction === 'rtl' ? menuBox.left - gearBox.left : gearBox.right - menuBox.right;

      expect(Math.abs(anchored)).toBeLessThanOrEqual(TOLERANCE);

      // The tape is pinned LTR in both directions; its needle marks the card's centre.
      const ruler = menu.locator('[data-role="speed-ruler"]');

      await expect(ruler).toHaveAttribute('dir', 'ltr');

      const rulerBox = await rect(ruler);
      const needle = await rect(ruler.locator('[data-role="speed-needle"]'));

      expect(rulerBox.left).toBeGreaterThanOrEqual(menuBox.left - 1);
      expect(rulerBox.right).toBeLessThanOrEqual(menuBox.right + 1);
      expect(Math.abs((needle.left + needle.right) / 2 - (menuBox.left + menuBox.right) / 2)).toBeLessThanOrEqual(TOLERANCE);
    });

    test('the audio speed menu grows from the gear toward the inline end', async ({ page }) => {
      const title = text(direction, 'Song', 'أغنية');

      await createBlok(page, direction, [
        { type: 'audio', data: { url: AUDIO_URL, title, caption: title } },
      ]);

      const audio = page.locator('[data-blok-tool="audio"]');
      const gear = audio.locator('[data-role="audio-speed"]');

      await audio.hover();
      await gear.click({ force: true });

      const menu = audio.getByRole('menu');

      await expect(menu).toBeVisible();

      const menuBox = await rect(menu);
      const gearBox = await rect(gear);
      const startGap = direction === 'rtl' ? gearBox.right - menuBox.right : menuBox.left - gearBox.left;

      expect(Math.abs(startGap)).toBeLessThanOrEqual(TOLERANCE);
    });
    test('the embed hover toolbar sits in the inline-end corner', async ({ page }) => {
      await createBlok(page, direction, [{
        type: 'embed',
        data: { service: 'codepen', source: 'https://codepen.io/team/pen/abc123', embed: 'https://codepen.io/abc123?default-tab=result' },
      }]);
      const figure = page.locator('[data-blok-tool="embed"] [data-role="embed-figure"]');
      const toolbar = page.locator('[data-blok-tool="embed"] [data-role="embed-overlay"]');

      await figure.hover();
      const [figureBox, toolbarBox] = await Promise.all([rect(figure), rect(toolbar)]);
      const fromEnd = direction === 'rtl' ? toolbarBox.left - figureBox.left : figureBox.right - toolbarBox.right;

      expect(Math.abs(fromEnd - 10)).toBeLessThanOrEqual(TOLERANCE);
    });

    test('the embed shortcut hint slides in from the inline start', async ({ page }) => {
      await createBlok(page, direction, [{ type: 'embed', data: {} }]);
      const kbd = page.locator('[data-role="embed-url-submit"]').getByText('↵');
      const shift = (): Promise<number> => kbd.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).e);

      await expect(kbd).toBeAttached();

      expect(await shift()).toBe(direction === 'rtl' ? 4 : -4);
    });

    test('the audio cover picker grows from the corner on the cover side', async ({ page }) => {
      await createBlok(page, direction, [{ type: 'audio', data: { url: AUDIO_URL, title: text(direction, 'Song', 'أغنية') } }]);
      const audio = page.locator('[data-blok-tool="audio"]');

      await audio.locator('[data-role="audio-cover"]').hover();
      await audio.locator('[data-role="audio-cover-change"]').click();
      const picker = page.locator('[data-role="audio-cover-picker"]');

      await expect(picker).toBeVisible();
      const { originX, width } = await picker.evaluate((element) => ({
        originX: parseFloat(getComputedStyle(element).transformOrigin),
        width: (element as HTMLElement).offsetWidth,
      }));

      expect(Math.abs(originX - (direction === 'rtl' ? width : 0))).toBeLessThanOrEqual(TOLERANCE);
    });

    test('the knocked-off callout emoji tips toward the inline end', async ({ page }) => {
      await createBlok(page, direction, [{ type: 'callout', data: { emoji: '💡', color: 'default' } }]);
      const tilt = await page.locator('[data-blok-tool="callout"]').evaluate((element) => {
        const probe = document.createElement('span');

        probe.style.display = 'inline-block';
        probe.style.animation = 'blok-callout-emoji-knock-out 1s linear both paused';
        element.appendChild(probe);
        probe.getAnimations()[0].currentTime = 999;
        const { b } = new DOMMatrixReadOnly(getComputedStyle(probe).transform);

        probe.remove();

        return Math.sign(b);
      });

      // Clockwise (positive) in LTR, counter-clockwise in RTL.
      expect(tilt).toBe(direction === 'rtl' ? -1 : 1);
    });

    test('the code language picker section label keeps its start padding', async ({ page }) => {
      await page.evaluate(() => {
        localStorage.setItem('blok:code:recent-languages', JSON.stringify(['python', 'rust']));
      });
      await createBlok(page, direction, [
        { type: 'code', data: { code: 'print(1)', language: 'python' } },
      ]);

      await page.getByTestId('code-language-btn').click();

      const label = page.getByTestId('code-language-section');

      await expect(label).toBeVisible();

      const startPadding = await label.evaluate((element) => {
        const style = getComputedStyle(element);

        return style.direction === 'rtl' ? style.paddingRight : style.paddingLeft;
      });

      expect(startPadding).toBe('8px');
    });
    test('a markdown preview lays its table cells and footnotes out from the inline start', async ({ page }) => {
      const body = direction === 'rtl'
        ? '| العمود أ | العمود ب |\n|---|---|\n| واحد | اثنان |\n\nنص[^1].\n\n[^1]: حاشية.\n'
        : '| Column A | Column B |\n|---|---|\n| one | two |\n\nText[^1].\n\n[^1]: A note.\n';

      await page.route('**/rtl-sample.md', route => route.fulfill({ status: 200, contentType: 'text/markdown; charset=utf-8', body }));
      await createBlok(page, direction, [
        { type: 'file', data: { url: new URL('/rtl-sample.md', TEST_PAGE_URL).href, fileName: 'rtl-sample.md', mimeType: 'text/markdown', size: 100 } },
      ]);

      const file = page.locator('[data-blok-tool="file"]');

      await file.hover();
      await file.locator('[data-action="preview"]').click({ force: true });

      const cell = page.getByRole('cell').first();

      await expect(cell).toBeVisible();

      const layout = await cell.evaluate((td) => {
        const range = document.createRange();

        range.selectNodeContents(td);

        const text = range.getBoundingClientRect();
        const box = td.getBoundingClientRect();
        const back = td.ownerDocument.querySelector('.blok-md-fnback');
        const backStyle = back === null ? null : getComputedStyle(back);
        const backStart = backStyle?.direction === 'rtl' ? backStyle.marginRight : backStyle?.marginLeft;

        return {
          dir: getComputedStyle(td).direction,
          fromLeft: text.left - box.left,
          fromRight: box.right - text.right,
          backStart,
        };
      });

      expect(layout.dir).toBe(direction);
      // Cell text starts at the inline-start padding (12px), not across the cell.
      expect(direction === 'rtl' ? layout.fromRight : layout.fromLeft).toBeLessThanOrEqual(16);
      expect(layout.backStart).toBe('4px');
    });
  });
}
