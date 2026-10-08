import type { Page } from '@playwright/test';

import type { Blok, BlokConfig } from '@/types';
import { ensureBlokBundleBuilt } from './helpers/ensure-build';
import { expect, gotoTestPage, test } from './helpers/shared-page';

const HOLDER_ID = 'blok';
const TITLE_HOST_ID = 'title-host';

type CreateBlokOptions = Partial<Pick<BlokConfig, 'readOnly' | 'style' | 'pageTitle'>> & {
  titleHost?: boolean;
};

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

const createBlok = async (page: Page, options: CreateBlokOptions = {}): Promise<void> => {
  const { titleHost = false, ...blokOptions } = options;

  await page.evaluate(async ({ holder, hostId, withHost, rawOptions }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    document.getElementById(hostId)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    container.style.border = '1px dotted #388AE5';
    document.body.appendChild(container);

    // Same box as the editor holder: a body child with the same border width.
    if (withHost) {
      const host = document.createElement('div');

      host.id = hostId;
      host.style.border = '1px solid transparent';
      document.body.insertBefore(host, container);
    }

    const blok = new window.Blok({
      holder,
      pageTitle: true,
      ...rawOptions,
      data: { blocks: [ { type: 'paragraph', data: { text: 'Body' } } ] },
    });

    window.blokInstance = blok;
    await blok.isReady;
    blok.title.set('Plans');
  }, { holder: HOLDER_ID, hostId: TITLE_HOST_ID, withHost: titleHost, rawOptions: blokOptions });
};

/** Left edge of the first character's glyph box: a Range over it, not the element box. */
const firstCharLeft = async (page: Page, selector: string): Promise<number> => {
  return page.locator(selector).first().evaluate((element) => {
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();

    while (node !== null && (node.textContent ?? '').trim() === '') {
      node = walker.nextNode();
    }
    if (node === null) {
      throw new Error('no text');
    }
    const range = element.ownerDocument.createRange();

    range.setStart(node, 0);
    range.setEnd(node, 1);

    return range.getBoundingClientRect().left;
  });
};

/** How far the title text starts from the first block text, in px. */
const titleOffsetFromFirstBlock = async (page: Page): Promise<number> => {
  const title = await firstCharLeft(page, '[data-blok-testid="page-header-title"]');
  const body = await firstCharLeft(page, '[data-blok-testid="block-wrapper"][data-blok-component="paragraph"]');

  return Math.abs(title - body);
};

test.describe('page title alignment', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('title text starts where the first block text starts (default config)', async ({ page }) => {
    await createBlok(page);

    expect(await titleOffsetFromFirstBlock(page)).toBeLessThanOrEqual(1);
  });

  test('stays aligned in full width', async ({ page }) => {
    await createBlok(page);
    await page.evaluate(() => window.blokInstance?.width.set('full'));

    expect(await titleOffsetFromFirstBlock(page)).toBeLessThanOrEqual(1);
  });

  test('stays aligned with centered content', async ({ page }) => {
    await createBlok(page, { style: { contentAlign: 'center' } });

    expect(await titleOffsetFromFirstBlock(page)).toBeLessThanOrEqual(1);
  });

  test('stays aligned when the title lives in a host holder above the editor', async ({ page }) => {
    await createBlok(page, { titleHost: true, pageTitle: { holder: `#${TITLE_HOST_ID}` } });

    await expect(page.locator(`#${TITLE_HOST_ID} [data-blok-testid="page-header-title"]`)).toHaveCount(1);
    expect(await titleOffsetFromFirstBlock(page)).toBeLessThanOrEqual(1);
  });

  test('stays aligned in a host holder after toolbar.setHidden(true)', async ({ page }) => {
    await createBlok(page, { titleHost: true, pageTitle: { holder: `#${TITLE_HOST_ID}` } });
    await page.evaluate(() => window.blokInstance?.toolbar.setHidden(true));

    expect(await titleOffsetFromFirstBlock(page)).toBeLessThanOrEqual(1);
  });

  test('stays aligned in read-only with hidden controls', async ({ page }) => {
    await createBlok(page, { readOnly: { hideControls: true } });

    expect(await titleOffsetFromFirstBlock(page)).toBeLessThanOrEqual(1);
  });
});
