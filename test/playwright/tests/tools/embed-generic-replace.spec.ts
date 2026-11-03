import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;

const EMBED_CONFIG = { linkPaste: { allowGenericEmbed: true } };

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

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

const createBlok = async (
  page: Page,
  data?: OutputData,
  extraConfig?: Record<string, unknown>
): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, initialData, extras }) => {
      const config: Record<string, unknown> = { holder, ...(extras ?? {}) };

      if (initialData) {
        config.data = initialData;
      }

      const blok = new window.Blok(config);

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data, extras: extraConfig ?? null }
  );
};

const pasteText = async (locator: Locator, text: string): Promise<void> => {
  await locator.evaluate((element: HTMLElement, value: string) => {
    const pasteEvent = Object.assign(
      new Event('paste', { bubbles: true, cancelable: true }),
      {
        clipboardData: {
          getData: (type: string): string => (type === 'text/plain' ? value : ''),
          types: ['text/plain'],
        },
      }
    );

    element.dispatchEvent(pasteEvent);
  }, text);
};

const firstEditable = (page: Page): Locator =>
  page.locator(`${BLOCK_SELECTOR}:nth-of-type(1) [contenteditable]`).first();

test.describe('Generic embed + replace source', () => {
  test.beforeAll(async () => {
    await ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('pasting an unmatched URL offers "Create embed", which frames it in a sandboxed iframe', async ({ page }) => {
    await createBlok(page, undefined, EMBED_CONFIG);
    const editable = firstEditable(page);

    await editable.click();
    await pasteText(editable, 'https://example.com/page');

    // No provider matches, but the opt-in flag adds a generic "Create embed" option.
    const embedItem = page.locator('[data-blok-item-name="paste-menu-embed"]');

    await expect(embedItem).toBeVisible();
    await expect(embedItem).toContainText('Create embed');

    const siteRequests: string[] = [];

    page.on('request', (request) => {
      if (new URL(request.url()).hostname === 'example.com') {
        siteRequests.push(request.url());
      }
    });

    await embedItem.click();

    // Click-to-load: nothing reaches the site until the reader asks for it.
    const load = page.getByRole('button', { name: 'Load content from example.com' });

    await expect(load).toBeVisible();
    await expect(page.locator('[data-blok-testid="embed-frame"]')).toHaveCount(0);
    expect(siteRequests).toEqual([]);

    await load.click();

    const iframe = page.locator('[data-blok-testid="embed-frame"]');

    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute('src', /example\.com\/page/);
    // The real host, drawn by Blok outside the frame.
    await expect(page.getByText('example.com', { exact: true })).toBeVisible();

    await expect(iframe).toHaveAttribute('sandbox', /.+/);
  });

  test('the embed more-menu Replace reverts to a URL input and re-resolves a new source', async ({ page }) => {
    await createBlok(page, undefined, EMBED_CONFIG);
    const editable = firstEditable(page);

    await editable.click();
    await pasteText(editable, 'https://example.com/page');

    const embedItem = page.locator('[data-blok-item-name="paste-menu-embed"]');

    await expect(embedItem).toBeVisible();
    await embedItem.click();
    await page.getByRole('button', { name: 'Load content from example.com' }).click();

    const iframe = page.locator('[data-blok-testid="embed-frame"]');

    await expect(iframe).toBeVisible();

    // Reveal the hover overlay, open the more-menu (the shared block-tunes
    // popover), choose Replace.
    const figure = page.locator('[data-role="embed-figure"]');

    await figure.hover();

    const overlay = figure.locator('[data-role="embed-overlay"]');

    await expect(overlay).toBeVisible();
    await overlay.locator('[data-action="more"]').click();

    const tunes = page
      .getByTestId('block-tunes-popover')
      .and(page.locator('[data-blok-popover-opened="true"]'));

    await expect(tunes).toHaveCount(1);
    await tunes.locator('[data-blok-item-name="embed-replace"]').click();

    // The block reverts to the empty URL-input state and the iframe is gone.
    const input = page.locator('[data-role="embed-url-input"]');

    await expect(input).toBeVisible();
    await expect(page.locator('[data-blok-testid="embed-frame"]')).toHaveCount(0);

    // Submitting a new URL re-resolves the embed.
    await input.fill('https://vimeo.com/123');
    await page.locator('[data-role="embed-url-submit"]').click();

    const newIframe = page.locator('[data-blok-testid="embed-frame"]');

    await expect(newIframe).toBeVisible();
    await expect(newIframe).toHaveAttribute('src', /vimeo/);
  });

  test('the embed more button opens the shared block-tunes popover with embed-specific items', async ({ page }) => {
    await createBlok(page, undefined, EMBED_CONFIG);
    const editable = firstEditable(page);

    await editable.click();
    await pasteText(editable, 'https://example.com/page');

    const embedItem = page.locator('[data-blok-item-name="paste-menu-embed"]');

    await expect(embedItem).toBeVisible();
    await embedItem.click();
    await page.getByRole('button', { name: 'Load content from example.com' }).click();

    await expect(page.locator('[data-blok-testid="embed-frame"]')).toBeVisible();

    const figure = page.locator('[data-role="embed-figure"]');

    await figure.hover();

    const overlay = figure.locator('[data-role="embed-overlay"]');

    await overlay.locator('[data-action="more"]').click();

    // Shared infrastructure: the very same block-tunes popover the image block opens.
    const tunes = page
      .getByTestId('block-tunes-popover')
      .and(page.locator('[data-blok-popover-opened="true"]'));

    await expect(tunes).toHaveCount(1);

    // Embed contributes its own items via renderSettings() — different content
    // from the image block, identical styling.
    await expect(tunes.locator('[data-blok-item-name="embed-replace"]')).toBeVisible();
    await expect(tunes.locator('[data-blok-item-name="embed-copy-url"]')).toBeVisible();

    // Standard block tunes ride along for free.
    await expect(tunes.locator('[data-blok-item-name="delete"]')).toBeVisible();
  });
  test('the embed more-menu Delete removes the embed when the caret sits in another block', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'p1', type: 'paragraph', data: { text: 'Latte' } },
        { id: 'p2', type: 'paragraph', data: { text: '' } },
      ],
    }, EMBED_CONFIG);

    const target = page.locator(`${BLOCK_SELECTOR}:nth-of-type(2) [contenteditable]`).first();

    await target.click();
    await pasteText(target, 'https://example.com/page');
    await page.locator('[data-blok-item-name="paste-menu-embed"]').click();
    await page.getByRole('button', { name: 'Load content from example.com' }).click();
    await expect(page.locator('[data-blok-testid="embed-frame"]')).toBeVisible();

    await page.getByText('Latte').click();

    const figure = page.locator('[data-role="embed-figure"]');

    await figure.hover();
    await figure.locator('[data-role="embed-overlay"] [data-action="more"]').click();

    const tunes = page
      .getByTestId('block-tunes-popover')
      .and(page.locator('[data-blok-popover-opened="true"]'));

    await expect(tunes.locator('[data-blok-item-name="embed-replace"]')).toBeVisible();

    await tunes.locator('[data-blok-item-name="delete"]').click();

    await expect(page.locator('[data-role="embed-figure"]')).toHaveCount(0);
    await expect(page.getByText('Latte')).toBeVisible();
  });

  test('the load button works from the keyboard', async ({ page }) => {
    await createBlok(page, {
      blocks: [{ type: 'embed', data: { service: '', source: 'https://example.com/page', embed: 'https://example.com/page' } }],
    }, EMBED_CONFIG);

    const load = page.getByRole('button', { name: 'Load content from example.com' });

    await load.focus();
    await page.keyboard.press('Enter');

    await expect(page.locator('[data-blok-testid="embed-frame"]')).toBeVisible();
  });

  test.describe('with a host frame check', () => {
    const createBlokWithCheck = async (page: Page, verdict: string): Promise<void> => {
      await resetBlok(page);
      await page.waitForFunction(() => typeof window.Blok === 'function');
      await page.evaluate(async ({ holder, answer }) => {
        const blok = new window.Blok({
          holder,
          linkPaste: { allowGenericEmbed: true, checkEmbed: async () => ({ verdict: answer }) },
        });

        window.blokInstance = blok;
        await blok.isReady;
      }, { holder: HOLDER_ID, answer: verdict });
    };

    test('a blocked page becomes a bookmark with a notice instead of an embed', async ({ page }) => {
      await createBlokWithCheck(page, 'blocked');
      const editable = firstEditable(page);

      await editable.click();
      await pasteText(editable, 'https://example.com/page');
      await page.locator('[data-blok-item-name="paste-menu-embed"]').click();

      await expect(page.getByText('This site can’t be embedded safely. Added as a bookmark.')).toBeVisible();
      await expect(page.locator('[data-blok-tool="bookmark"]')).toHaveCount(1);
      await expect(page.locator('[data-blok-tool="embed"]')).toHaveCount(0);
    });

    test('an allowed page is embedded as usual', async ({ page }) => {
      await createBlokWithCheck(page, 'allowed');
      const editable = firstEditable(page);

      await editable.click();
      await pasteText(editable, 'https://example.com/page');
      await page.locator('[data-blok-item-name="paste-menu-embed"]').click();

      await expect(page.getByRole('button', { name: 'Load content from example.com' })).toBeVisible();
      await expect(page.locator('[data-blok-tool="bookmark"]')).toHaveCount(0);
    });
  });
});

