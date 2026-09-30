import type { Page } from '@playwright/test';
import type { Blok } from '../../../../types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable]`;

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const createBlok = async (page: Page): Promise<void> => {
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

    const blok = new window.Blok({
      holder,
      data: { blocks: [ { type: 'paragraph', data: { text: '' } } ] },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

const openToolbox = async (page: Page): Promise<void> => {
  const paragraph = page.locator(PARAGRAPH_SELECTOR);

  await paragraph.click();
  await paragraph.type('/');
  await expect(page.getByTestId('toolbox-popover').getByTestId('popover-container')).toBeVisible();
};

const option = (page: Page, name: string) => page.getByTestId('toolbox-popover').locator(`[data-blok-item-name="${name}"]`);

test.describe('Toolbox hover preview', () => {
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await createBlok(page);
  });

  test('does not show a card when the menu opens under a resting pointer', async ({ page }) => {
    await openToolbox(page);
    // Absence needs a window longer than the card's open delay (PREVIEW_OPEN_DELAY = 320ms).
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 600)));

    await expect(page.getByTestId('toolbox-preview')).toBeHidden();
  });

  test('shows the drawing and caption beside the hovered row', async ({ page }) => {
    await openToolbox(page);
    await option(page, 'header-1').hover();

    const card = page.getByTestId('toolbox-preview');

    await expect(card).toBeVisible();
    await expect(card).toContainText('Big section heading');

    const menu = await page.getByTestId('toolbox-popover').getByTestId('popover-container').boundingBox();
    const box = await card.boundingBox();

    expect(box && menu ? box.x >= menu.x + menu.width : false).toBe(true);
  });

  test('follows the pointer to the next row', async ({ page }) => {
    await openToolbox(page);
    await option(page, 'header-1').hover();
    await expect(page.getByTestId('toolbox-preview')).toContainText('Big section heading');
    await option(page, 'header-2').hover();

    await expect(page.getByTestId('toolbox-preview')).toContainText('Medium section heading');
  });

  test('follows keyboard focus', async ({ page }) => {
    await openToolbox(page);
    await page.keyboard.press('ArrowDown');

    await expect(page.getByTestId('toolbox-preview')).toBeVisible();
  });

  test('stays open while arrow keys scroll the menu list', async ({ page }) => {
    await openToolbox(page);

    const list = page.getByTestId('toolbox-popover').locator('[data-blok-popover-items]');
    const before = await list.evaluate((el) => el.scrollTop);

    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('ArrowDown');
    }

    expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
    await expect(page.getByTestId('toolbox-preview')).toBeVisible();
  });

  test('closes with the menu', async ({ page }) => {
    await openToolbox(page);
    await option(page, 'header-1').hover();
    await expect(page.getByTestId('toolbox-preview')).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.getByTestId('toolbox-preview')).toBeHidden();
  });

  test('every drawing fits inside the 232x156 paper', async ({ page }) => {
    const renderProbes = (): Promise<number> => page.evaluate(() => {
      type Entry = { name?: string; preview?: { render: () => HTMLElement } };
      const tools = (window as unknown as { defaultBlockTools: Record<string, { class: { toolbox?: Entry | Entry[] } }> }).defaultBlockTools;

      document.querySelectorAll('[data-preview-fit-probe]').forEach((el) => el.remove());

      const entries = Object.entries(tools).flatMap(([toolName, { class: tool }]) => {
        const toolbox = tool.toolbox ?? [];

        return (Array.isArray(toolbox) ? toolbox : [ toolbox ]).map((entry) => ({ toolName, entry }));
      });

      return entries.filter(({ toolName, entry }) => {
        if (entry.preview === undefined) {
          return false;
        }

        const root = document.createElement('div');
        const card = document.createElement('div');
        const paper = document.createElement('div');

        root.setAttribute('data-blok-interface', 'block-preview');
        root.setAttribute('data-preview-fit-probe', `${toolName}/${entry.name ?? ''}`);
        root.style.position = 'static';
        card.setAttribute('data-blok-preview-card', '');
        paper.setAttribute('data-blok-preview-paper', '');
        paper.appendChild(entry.preview.render());
        card.appendChild(paper);
        root.appendChild(card);
        document.body.appendChild(root);

        return true;
      }).length;
    });

    const findSpills = (): Promise<string[]> => page.evaluate(() => {
      const problems: string[] = [];

      // A box only counts where no clipping ancestor inside the drawing hides it.
      const visibleRect = (rect: DOMRect, from: Element, paper: Element): DOMRect | null => {
        let { left, top, right, bottom } = rect;

        for (let el: Element | null = from; el !== null && el !== paper; el = el.parentElement) {
          const style = getComputedStyle(el);

          if (el !== from && (style.overflowX !== 'visible' || style.overflowY !== 'visible')) {
            const clip = el.getBoundingClientRect();

            left = Math.max(left, clip.left);
            top = Math.max(top, clip.top);
            right = Math.min(right, clip.right);
            bottom = Math.min(bottom, clip.bottom);
          }
        }

        return right - left > 0.5 && bottom - top > 0.5 ? new DOMRect(left, top, right - left, bottom - top) : null;
      };

      const isShown = (el: Element): boolean => {
        for (let node: Element | null = el; node !== null; node = node.parentElement) {
          const style = getComputedStyle(node);

          if (style.visibility === 'hidden' || Number(style.opacity) === 0 || style.display === 'none') {
            return false;
          }
        }

        return true;
      };

      document.querySelectorAll('[data-preview-fit-probe]').forEach((root) => {
        const label = root.getAttribute('data-preview-fit-probe');
        const paper = root.querySelector('[data-blok-preview-paper]');

        if (paper === null) {
          return;
        }

        const bounds = paper.getBoundingClientRect();

        if (Math.round(bounds.width) !== 232 || Math.round(bounds.height) !== 156) {
          problems.push(`${label}: paper is ${bounds.width}x${bounds.height}`);
        }

        const check = (rect: DOMRect, from: Element, what: string): void => {
          const shown = visibleRect(rect, from, paper);

          if (shown === null) {
            return;
          }

          const spill = Math.max(bounds.left - shown.left, shown.right - bounds.right, bounds.top - shown.top, shown.bottom - bounds.bottom);

          if (spill > 1) {
            problems.push(`${label}: ${what} spills ${Math.round(spill)}px`);
          }
        };

        paper.querySelectorAll('*').forEach((el) => {
          if (isShown(el)) {
            check(el.getBoundingClientRect(), el, `<${el.tagName.toLowerCase()}>`);
          }
        });

        const walker = document.createTreeWalker(paper, NodeFilter.SHOW_TEXT);

        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const parent = node.parentElement;

          if (parent === null || node.textContent?.trim() === '' || !isShown(parent)) {
            continue;
          }

          const range = document.createRange();

          range.selectNodeContents(node);
          Array.from(range.getClientRects()).forEach((rect) => {
            check(rect, parent, `"${node.textContent?.trim().slice(0, 20)}"`);
          });
        }
      });

      return [ ...new Set(problems) ];
    });

    // The finished frame, as reduced motion shows it.
    await page.emulateMedia({ reducedMotion: 'reduce' });

    try {
      expect(await renderProbes()).toBeGreaterThanOrEqual(35);
      expect(await findSpills()).toEqual([]);
    } finally {
      await page.emulateMedia({ reducedMotion: null });
    }

    // Moving frames: seek every looping animation across one ~3s cycle.
    await renderProbes();

    for (const at of [ 400, 1100, 1800, 2500, 3200 ]) {
      await page.evaluate((ms) => {
        document.getAnimations().forEach((animation) => {
          animation.pause();
          Object.assign(animation, { currentTime: ms });
        });
      }, at);

      expect(await findSpills(), `at ${at}ms`).toEqual([]);
    }

    await page.evaluate(() => document.querySelectorAll('[data-preview-fit-probe]').forEach((el) => el.remove()));
  });
});
