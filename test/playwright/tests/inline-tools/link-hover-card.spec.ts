import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const LINK_URL = 'https://youtube.com/';
const PARAGRAPH_LINK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] a`;

const resetBlok = async (page: Page): Promise<void> => {
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
  }, { holder: HOLDER_ID });
};

const createBlokWithBlocks = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder, blocks: blokBlocks }) => {
    const blok = new window.Blok({
      holder,
      data: { blocks: blokBlocks },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blocks });
};

const createLinkParagraph = async (page: Page): Promise<void> => {
  await createBlokWithBlocks(page, [
    {
      type: 'paragraph',
      data: {
        text: `Visit <a href="${LINK_URL}" target="_blank" rel="nofollow">YouTube</a> today`,
      },
    },
  ]);
};

test.describe('link hover card', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('shows a hover card with the URL and copy/edit actions when hovering a link', async ({ page }) => {
    await createLinkParagraph(page);

    await page.locator(PARAGRAPH_LINK_SELECTOR).hover();

    const card = page.getByTestId('link-hover-card');

    await expect(card).toBeVisible();
    await expect(card.getByTestId('link-hover-card-url')).toHaveText(LINK_URL);
    await expect(card.getByTestId('link-hover-card-copy')).toBeVisible();
    await expect(card.getByTestId('link-hover-card-edit')).toBeVisible();
  });

  test('opens the link in a new tab on a plain click', async ({ page }) => {
    await createLinkParagraph(page);

    const popupPromise = page.waitForEvent('popup');

    await page.locator(PARAGRAPH_LINK_SELECTOR).click();

    const popup = await popupPromise;

    expect(popup.url()).toContain('youtube.com');
  });

  test('does not execute or open javascript: scheme links on click', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Danger <a href="javascript:window.__xss=1">click</a> here',
        },
      },
    ]);

    const anchor = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] a`);
    // A popup would signal the unsafe href was followed; expect none within the window.
    const popupPromise = page.waitForEvent('popup', { timeout: 800 }).catch(() => null);

    // Click the link if it survived rendering; either way the script must not run.
    if (await anchor.count() > 0) {
      await anchor.click();
    }

    const popup = await popupPromise;
    const executed = await page.evaluate(() => (window as unknown as { __xss?: number }).__xss);

    expect(popup).toBeNull();
    expect(executed).toBeUndefined();
  });

  test('edit button opens the link input prefilled with the href', async ({ page }) => {
    await createLinkParagraph(page);

    await page.locator(PARAGRAPH_LINK_SELECTOR).hover();
    await page.getByTestId('link-hover-card').getByTestId('link-hover-card-edit').click();

    const linkInput = page.locator('[data-blok-link-tool-input-opened="true"]');

    await expect(linkInput).toBeVisible();
    await expect(linkInput).toHaveValue(LINK_URL);
  });
});
