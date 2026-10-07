import type { Locator, Page } from '@playwright/test';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { ensureBlokBundleBuilt, HOLDER_ID, resetBlok, saveRaw } from './columns-blocks/_helpers';

/**
 * A copied page link pastes as a mention: an inline reference with the page's
 * icon, an arrow badge and its title, not another page block.
 */

declare global {
  interface Window {
    defaultBlockTools: Record<string, { class: unknown }>;
  }
}

const PAGE_URL = 'https://workspace.test/pages/roadmap';

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const createEditor = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder }) => {
    const blok = new window.Blok({
      holder,
      data: { blocks: [{ id: 'target', type: 'paragraph', data: { text: 'See ' } }] },
      tools: {
        page: {
          class: window.defaultBlockTools.page.class,
          config: {
            href: (pageId: string) => `https://workspace.test/pages/${pageId}`,
            pageIdFromHref: (href: string) => /^https:\/\/workspace\.test\/pages\/([^/?#]+)$/.exec(href)?.[1] ?? null,
            resolve: (pageId: string) => pageId === 'roadmap' ? { title: 'Roadmap', icon: { type: 'emoji', value: '🗺️' } } : null,
            open: () => undefined,
          },
        },
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

const pasteText = async (locator: Locator, text: string): Promise<void> => {
  await locator.evaluate((element: HTMLElement, value: string) => {
    element.dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
      clipboardData: {
        getData: (type: string): string => (type === 'text/plain' ? value : ''),
        types: ['text/plain'],
      },
    }));
  }, text);
};

const pasteIntoParagraph = async (page: Page): Promise<Locator> => {
  const editable = page.locator('[data-blok-element-content] [contenteditable="true"]').first();

  await editable.click();
  await page.keyboard.press('End');
  await pasteText(editable, PAGE_URL);

  return editable;
};

test.describe('Page mention', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await createEditor(page);
  });

  test('a pasted page link offers a mention that saves as a page reference', async ({ page }) => {
    await pasteIntoParagraph(page);
    await expect(page.locator('[data-blok-item-name="paste-menu-bookmark"]')).toHaveCount(0);
    await page.locator('[data-blok-item-name="paste-menu-mention"]').click();

    const mention = page.locator('[data-blok-page-id="roadmap"]');

    await expect(mention.getByTestId('page-reference-title')).toHaveText('Roadmap');
    await expect(mention.getByTestId('page-reference-arrow')).toBeVisible();

    const saved = await saveRaw(page);

    const text: unknown = saved.blocks[0]?.data.text;

    expect(text).toEqual([{ text: 'See' }, { embed: { page: { id: 'roadmap' } } }, { text: ' ' }]);
  });

  test('the icon sits on the title line and the hover fill hugs the mention', async ({ page }) => {
    const editable = await pasteIntoParagraph(page);

    await page.locator('[data-blok-item-name="paste-menu-mention"]').click();

    const mention = page.locator('[data-blok-page-id="roadmap"]');
    const title = mention.getByTestId('page-reference-title');

    await expect(title).toHaveText('Roadmap');

    const icon = await mention.getByTestId('page-reference-icon').boundingBox();
    const label = await title.boundingBox();

    expect(icon).not.toBeNull();
    expect(label).not.toBeNull();
    if (icon === null || label === null) {
      return;
    }
    // Centers within 3px: a baseline-aligned icon dropped about 10px.
    expect(Math.abs((icon.y + icon.height / 2) - (label.y + label.height / 2))).toBeLessThan(3);

    // A painted cutout would show as a square on a callout or block color.
    await expect(mention.getByTestId('page-reference-arrow')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(mention).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await mention.hover();
    await expect(mention).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

    const fill = await mention.boundingBox();
    const line = await editable.boundingBox();

    expect(fill).not.toBeNull();
    expect(line).not.toBeNull();
    if (fill === null || line === null) {
      return;
    }
    expect(fill.width).toBeLessThan(line.width / 2);
    expect(fill.x).toBeLessThanOrEqual(icon.x);
    expect(fill.x + fill.width).toBeGreaterThanOrEqual(label.x + label.width);
  });

  test('the title is not painted as a blue link', async ({ page }) => {
    await pasteIntoParagraph(page);
    await page.locator('[data-blok-item-name="paste-menu-mention"]').click();

    const mention = page.locator('[data-blok-page-id="roadmap"]');
    const ink = await page.evaluate(() => {
      const probe = document.createElement('span');

      probe.style.color = 'var(--blok-text-primary)';
      document.querySelector('[data-blok-editor]')?.append(probe);
      const value = getComputedStyle(probe).color;

      probe.remove();

      return value;
    });

    await expect(mention).toHaveCSS('color', ink);
  });

  test('typing after the mention keeps its icon and title', async ({ page }) => {
    await pasteIntoParagraph(page);
    await page.locator('[data-blok-item-name="paste-menu-mention"]').click();

    const mention = page.locator('[data-blok-page-id="roadmap"]');

    await expect(mention.getByTestId('page-reference-title')).toHaveText('Roadmap');
    await page.keyboard.type(' next');

    await expect(mention.getByTestId('page-reference-icon')).toBeVisible();
    await expect(mention.getByTestId('page-reference-title')).toHaveText('Roadmap');

    const saved: unknown = (await saveRaw(page)).blocks[0]?.data.text;

    expect(saved).toEqual([{ text: 'See' }, { embed: { page: { id: 'roadmap' } } }, { text: '\u00a0next' }]);
  });

  test('a link that is not a page offers no mention', async ({ page }) => {
    const editable = page.locator('[data-blok-element-content] [contenteditable="true"]').first();

    await editable.click();
    await pasteText(editable, 'https://elsewhere.test/article');

    await expect(page.locator('[data-blok-item-name="paste-menu-mention"]')).toHaveCount(0);
  });
});

