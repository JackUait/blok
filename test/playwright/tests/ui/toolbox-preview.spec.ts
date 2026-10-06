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

const rowCenter = async (page: Page, name: string): Promise<{ x: number; y: number }> => {
  const box = await option(page, name).boundingBox();

  if (box === null) {
    throw new Error(`row ${name} has no box`);
  }

  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

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

  test('does not show a card while the user types a search query', async ({ page }) => {
    await openToolbox(page);
    await page.locator(PARAGRAPH_SELECTOR).type('page');
    await expect(option(page, 'page')).toBeVisible();
    // Absence needs a window longer than the card's open delay (PREVIEW_OPEN_DELAY = 320ms).
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 600)));

    await expect(page.getByTestId('toolbox-preview')).toBeHidden();
  });

  test('a search query closes the card the pointer opened', async ({ page }) => {
    await openToolbox(page);
    await option(page, 'header-1').hover();
    await expect(page.getByTestId('toolbox-preview')).toBeVisible();
    await page.locator(PARAGRAPH_SELECTOR).type('p');

    await expect(page.getByTestId('toolbox-preview')).toBeHidden();
  });

  test('does not follow keyboard focus', async ({ page }) => {
    await openToolbox(page);
    await page.keyboard.press('ArrowDown');
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 600)));

    await expect(page.getByTestId('toolbox-preview')).toBeHidden();
  });

  test('the live card keeps its 232x156 paper on every row', async ({ page }) => {
    // Every row waits out the open delay again, and there are ~40 rows.
    test.setTimeout(60_000);
    await openToolbox(page);

    const rows = page.getByTestId('toolbox-popover').getByRole('option');
    const card = page.getByTestId('toolbox-preview');
    const seen = new Map<string, string>();

    for (let i = 0; i < await rows.count(); i++) {
      const name = await rows.nth(i).getAttribute('data-blok-item-name');

      // Color rows have no preview.
      if (!await rows.nth(i).isVisible() || name === null || /color|background/i.test(name)) {
        continue;
      }

      await rows.nth(i).hover();

      await expect(card, name).toHaveAttribute('data-state', 'open');

      const measured = await page.evaluate(() => {
        const paper = document.querySelector<HTMLElement>('[data-blok-testid="toolbox-preview"] [data-blok-preview-paper]');

        if (paper === null) {
          return null;
        }

        // Layout size: the card's open animation scales it for a moment.
        return [ paper.firstElementChild?.getAttribute('data-blok-preview') ?? '?', `${paper.offsetWidth}x${paper.offsetHeight}` ];
      });

      if (measured !== null) {
        seen.set(measured[0], measured[1]);
      }
    }

    expect(seen.size).toBeGreaterThan(20);
    expect([ ...seen ].filter(([, size]) => size !== '232x156')).toEqual([]);
  });

  test('shows the card for the first search match when the pointer moves onto it', async ({ page }) => {
    await page.mouse.move(1, 1);
    await openToolbox(page);
    await page.locator(PARAGRAPH_SELECTOR).type('head');
    await expect(option(page, 'header-1')).toBeVisible();

    const center = await rowCenter(page, 'header-1');

    await page.mouse.move(center.x, center.y, { steps: 6 });

    await expect(page.getByTestId('toolbox-preview')).toBeVisible();
    await expect(page.getByTestId('toolbox-preview')).toContainText('Big section heading');
  });

  test('opens while the pointer keeps moving down the rows', async ({ page }) => {
    await page.mouse.move(1, 1);
    await openToolbox(page);

    for (const name of [ 'paragraph', 'header-1', 'header-2', 'header-3', 'header-4' ]) {
      const center = await rowCenter(page, name);

      await page.mouse.move(center.x, center.y);
      // Each rest is well under the open delay (PREVIEW_OPEN_DELAY = 320ms).
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)));
    }

    // A short timeout: the default retry outlasts a delay that restarts on the last row.
    await expect(page.getByTestId('toolbox-preview')).toBeVisible({ timeout: 50 });
  });

  test('comes back on the next pointer move after a scroll closed it', async ({ page }) => {
    // A scroll box away from the menu: scrolling it closes the card but leaves the rows where they are.
    await page.evaluate(() => {
      const box = document.createElement('div');

      box.setAttribute('data-blok-testid', 'scroll-box');
      box.style.cssText = 'position:fixed;left:0;bottom:0;width:40px;height:40px;overflow:auto';
      box.innerHTML = '<div style="height:400px"></div>';
      document.body.appendChild(box);
    });
    await openToolbox(page);

    const center = await rowCenter(page, 'header-1');

    await page.mouse.move(center.x, center.y, { steps: 3 });
    await expect(page.getByTestId('toolbox-preview')).toBeVisible();
    await page.getByTestId('scroll-box').evaluate((box) => box.scrollBy(0, 1));
    await expect(page.getByTestId('toolbox-preview')).toBeHidden();
    await page.mouse.move(center.x + 4, center.y + 1, { steps: 2 });

    // toContainText alone also passes on the hidden card.
    await expect(page.getByTestId('toolbox-preview')).toBeVisible();
    await expect(page.getByTestId('toolbox-preview')).toContainText('Big section heading');
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

  test('drawings keep room on every side of the paper and sit centered', async ({ page }) => {
    const MIN_ROOM = 12;
    const MAX_TILT = 8;

    await page.emulateMedia({ reducedMotion: 'reduce' });

    const cramped = await page.evaluate(({ minRoom, maxTilt }) => {
      type Entry = { name?: string; preview?: { render: () => HTMLElement } };
      const tools = (window as unknown as { defaultBlockTools: Record<string, { class: { toolbox?: Entry | Entry[] } }> }).defaultBlockTools;
      const names = new Set([
        'audio', 'bookmark', 'callout', 'code', 'columns-2', 'columns-3', 'columns-4', 'columns-5', 'database',
        'board', 'divider', 'embed', 'file', 'header-1', 'header-2', 'header-3', 'header-4', 'header-5', 'header-6',
        'toggle-header-1', 'toggle-header-2', 'toggle-header-3', 'toggle-header-4', 'toggle-header-5', 'toggle-header-6',
        'quote', 'spacer',
      ]);
      const problems: string[] = [];

      Object.values(tools).flatMap(({ class: tool }) => {
        const toolbox = tool.toolbox ?? [];

        return Array.isArray(toolbox) ? toolbox : [ toolbox ];
      }).forEach((entry) => {
        if (entry.preview === undefined) {
          return;
        }

        const root = document.createElement('div');
        const card = document.createElement('div');
        const paper = document.createElement('div');
        const drawing = entry.preview.render();
        const name = drawing.getAttribute('data-blok-preview') ?? '';

        if (!names.has(name)) {
          return;
        }

        root.setAttribute('data-blok-interface', 'block-preview');
        root.style.position = 'static';
        card.setAttribute('data-blok-preview-card', '');
        paper.setAttribute('data-blok-preview-paper', '');
        paper.appendChild(drawing);
        card.appendChild(paper);
        root.appendChild(card);
        document.body.appendChild(root);

        const bounds = paper.getBoundingClientRect();
        const rects: DOMRect[] = [];
        const walker = document.createTreeWalker(paper, NodeFilter.SHOW_TEXT);

        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          if (node.textContent?.trim() !== '') {
            const range = document.createRange();

            range.selectNodeContents(node);
            rects.push(...Array.from(range.getClientRects()));
          }
        }

        // Painted boxes count too: a panel or card edge crowds the paper like text does.
        paper.querySelectorAll('*').forEach((el) => {
          const style = getComputedStyle(el);

          if (style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.boxShadow !== 'none' || style.borderTopWidth !== '0px') {
            rects.push(el.getBoundingClientRect());
          }
        });

        const shown = rects.filter((rect) => rect.width > 0.5 && rect.height > 0.5);
        const left = Math.min(...shown.map((rect) => rect.left - bounds.left));
        const top = Math.min(...shown.map((rect) => rect.top - bounds.top));
        const right = Math.min(...shown.map((rect) => bounds.right - rect.right));
        const bottom = Math.min(...shown.map((rect) => bounds.bottom - rect.bottom));
        const room = Math.min(left, top, right, bottom);

        if (room < minRoom - 0.5) {
          problems.push(`${name}: ${Math.round(room)}px of room`);
        }

        if (Math.abs(top - bottom) > maxTilt) {
          problems.push(`${name}: ${Math.round(top)}px above, ${Math.round(bottom)}px below`);
        }

        // Headings start where their body starts, as they do in the editor.
        const heading = paper.querySelector('[data-part="title"]');
        const body = paper.querySelector('[data-part="line"], [data-part="item"]');

        if (heading !== null && body !== null && Math.abs(heading.getBoundingClientRect().left - body.getBoundingClientRect().left) > 1) {
          problems.push(`${name}: heading is not start-aligned`);
        }

        root.remove();
      });

      return problems;
    }, { minRoom: MIN_ROOM, maxTilt: MAX_TILT });

    await page.emulateMedia({ reducedMotion: null });

    expect(cramped).toEqual([]);
  });
});
