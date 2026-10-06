import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { openFixtureToggles } from '../helpers/toggle-open';

const HOLDER_ID = 'blok';
const ACTIONS = '[data-blok-toolbar-actions]';
const ARABIC = 'هذا نص عربي طويل بما يكفي ليملأ السطر';
const IMAGE_URL = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#999"/></svg>'
)}`;

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type Box = { left: number; right: number };

const createBlok = async (page: Page, direction: 'ltr' | 'rtl', data: OutputData): Promise<void> => {
  await page.evaluate(async ({ holder, direction: dir, data: blocks }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    // Centred, so both gutters have room for the controls.
    container.style.width = '720px';
    container.style.margin = '0 auto';
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: blocks, i18n: { direction: dir } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, direction, data });
  await openFixtureToggles(page, data);
};

const box = async (page: Page, selector: string): Promise<Box> => {
  const rect = await page.locator(selector).first().boundingBox();

  if (rect === null) {
    throw new Error(`No layout box for ${selector}`);
  }

  return { left: rect.x, right: rect.x + rect.width };
};

const blockContent = (id: string): string =>
  `${BLOK_INTERFACE_SELECTOR} [data-blok-id="${id}"] [data-blok-element-content]`;

/** Hovers a block and waits until the toolbar has moved onto it. */
const hoverBlock = async (page: Page, id: string, target: string): Promise<void> => {
  await page.locator(target).first().hover();
  await expect(page.locator(ACTIONS)).toBeVisible();
  await expect(page.locator(`[data-blok-id="${id}"] [data-blok-toolbar]`)).toHaveCount(1);
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoTestPage(page);
});

test.describe('content offset follows the side the controls sit on', () => {
  test('LTR editor: an Arabic list item at depth 2 indents on the right, so the left controls stay put', async ({ page }) => {
    await createBlok(page, 'ltr', {
      blocks: [
        { id: 'l0', type: 'list', data: { text: ARABIC, style: 'unordered', depth: 0 } },
        { id: 'l1', type: 'list', data: { text: ARABIC, style: 'unordered', depth: 1 } },
        { id: 'l2', type: 'list', data: { text: ARABIC, style: 'unordered', depth: 2 } },
      ],
    });
    await expect(page.locator(`[data-blok-id="l2"] [dir="rtl"]`).first()).toBeAttached();

    await hoverBlock(page, 'l2', `[data-blok-id="l2"] [role="listitem"]`);

    const content = await box(page, blockContent('l2'));
    const actions = await box(page, ACTIONS);

    expect(actions.right).toBeLessThanOrEqual(content.left + 1);
    expect(await page.locator(ACTIONS).evaluate((el) => (el as HTMLElement).style.transform)).toBe('');
  });

  test('RTL editor: an Arabic list item at depth 2 still pulls the right controls in toward its indent', async ({ page }) => {
    await createBlok(page, 'rtl', {
      blocks: [
        { id: 'l0', type: 'list', data: { text: ARABIC, style: 'unordered', depth: 0 } },
        { id: 'l1', type: 'list', data: { text: ARABIC, style: 'unordered', depth: 1 } },
        { id: 'l2', type: 'list', data: { text: ARABIC, style: 'unordered', depth: 2 } },
      ],
    });

    await hoverBlock(page, 'l2', `[data-blok-id="l2"] [role="listitem"]`);

    const item = await box(page, `[data-blok-id="l2"] [role="listitem"]`);
    const actions = await box(page, ACTIONS);

    // Controls hug the item's right edge, not the block's.
    expect(Math.abs(actions.left - item.right)).toBeLessThanOrEqual(8);
  });

  test('LTR editor: a right-aligned image with an Arabic caption gets left controls next to the figure, not over it', async ({ page }) => {
    await createBlok(page, 'ltr', {
      blocks: [
        { id: 'im', type: 'image', data: { url: IMAGE_URL, caption: ARABIC, width: 50, alignment: 'right' } },
      ],
    });

    const figure = `[data-blok-id="im"] [data-role="image-figure"]`;

    await hoverBlock(page, 'im', figure);

    const figureBox = await box(page, figure);
    const actions = await box(page, ACTIONS);

    expect(actions.right).toBeLessThanOrEqual(figureBox.left + 1);
    expect(figureBox.left - actions.right).toBeLessThanOrEqual(8);
  });

  test('RTL editor: a right-aligned image keeps the right controls beside it, not over it', async ({ page }) => {
    await createBlok(page, 'rtl', {
      blocks: [
        { id: 'im', type: 'image', data: { url: IMAGE_URL, caption: ARABIC, width: 50, alignment: 'right' } },
      ],
    });

    const figure = `[data-blok-id="im"] [data-role="image-figure"]`;

    await hoverBlock(page, 'im', figure);

    const figureBox = await box(page, figure);
    const actions = await box(page, ACTIONS);

    expect(actions.left).toBeGreaterThanOrEqual(figureBox.right - 1);
  });

  test('RTL editor: a left-aligned image pulls the right controls in to its edge', async ({ page }) => {
    await createBlok(page, 'rtl', {
      blocks: [
        { id: 'im', type: 'image', data: { url: IMAGE_URL, caption: ARABIC, width: 50, alignment: 'left' } },
      ],
    });

    const figure = `[data-blok-id="im"] [data-role="image-figure"]`;

    await hoverBlock(page, 'im', figure);

    const figureBox = await box(page, figure);
    const actions = await box(page, ACTIONS);

    expect(actions.left).toBeGreaterThanOrEqual(figureBox.right - 1);
    expect(actions.left - figureBox.right).toBeLessThanOrEqual(8);
  });
});

test.describe('a nested child\'s toolbar follows the editor, not its parent block', () => {
  const nested = (summary: string, child: string): OutputData => ({
    blocks: [
      { id: 'tgl', type: 'toggle', data: { text: summary, isOpen: true }, content: ['child'] },
      { id: 'child', type: 'paragraph', data: { text: child }, parent: 'tgl' },
    ],
  });

  test('LTR editor + Arabic toggle with an English child: controls dock left', async ({ page }) => {
    await createBlok(page, 'ltr', nested(ARABIC, 'An English child paragraph'));

    // The setup only means something if the child holder sits under the parent's RTL content.
    await expect(page.locator(`[data-blok-id="tgl"] [data-blok-element-content]`).first()).toHaveAttribute('dir', 'rtl');
    await expect(page.locator(`[data-blok-id="tgl"] [data-blok-element-content] [data-blok-id="child"]`)).toHaveCount(1);

    await hoverBlock(page, 'child', `[data-blok-id="child"] [data-blok-tool="paragraph"]`);

    const content = await box(page, blockContent('child'));
    const actions = await box(page, ACTIONS);

    expect(actions.right).toBeLessThanOrEqual(content.left + 1);
  });

  test('RTL editor + English toggle with an Arabic child: controls dock right', async ({ page }) => {
    await createBlok(page, 'rtl', nested('An English toggle summary', ARABIC));

    await expect(page.locator(`[data-blok-id="tgl"] [data-blok-element-content]`).first()).toHaveAttribute('dir', 'ltr');
    await expect(page.locator(`[data-blok-id="tgl"] [data-blok-element-content] [data-blok-id="child"]`)).toHaveCount(1);

    await hoverBlock(page, 'child', `[data-blok-id="child"] [data-blok-tool="paragraph"]`);

    const content = await box(page, blockContent('child'));
    const actions = await box(page, ACTIONS);

    expect(actions.left).toBeGreaterThanOrEqual(content.right - 1);
  });
});

test('RTL editor booted detached: the toolbar still docks right once attached', async ({ page }) => {
  await page.evaluate(async ({ holder, text }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.style.width = '720px';
    container.style.margin = '0 auto';

    const blok = new window.Blok({
      holder: container,
      data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text } }] },
      i18n: { direction: 'rtl' },
    });

    window.blokInstance = blok;
    await blok.isReady;
    // The toolbar is drawn on idle; let that happen while still detached.
    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (container.querySelector('[data-blok-toolbar]')) {
          resolve();
        } else {
          window.requestIdleCallback(check);
        }
      };

      check();
    });
    document.body.appendChild(container);
  }, { holder: HOLDER_ID, text: ARABIC });

  await hoverBlock(page, 'p1', `[data-blok-id="p1"] [data-blok-tool="paragraph"]`);

  const content = await box(page, blockContent('p1'));
  const actions = await box(page, ACTIONS);

  expect(actions.left).toBeGreaterThanOrEqual(content.right - 1);
});
