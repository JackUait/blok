import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';

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

const storedGenericEmbed = (url: string): OutputData => ({
  blocks: [
    {
      id: 'stored-generic',
      type: 'embed',
      data: { service: '', source: url, embed: url, kind: 'iframe', width: 580, height: 320 },
    },
  ],
});

test.describe('Embed link-card fallback and origin allowlist', () => {
  test.beforeAll(async () => {
    await ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('a stored generic embed without host opt-in renders a safe link card, not an iframe', async ({ page }) => {
    await createBlok(page, storedGenericEmbed('https://dashboard.example.com/widget/42'));

    const card = page.locator('[data-blok-testid="embed-link-card"]');

    await expect(card).toBeVisible();
    await expect(card).toContainText('dashboard.example.com');

    const anchor = card.locator('[data-role="embed-link-card-anchor"]');

    await expect(anchor).toHaveAttribute('href', 'https://dashboard.example.com/widget/42');
    await expect(anchor).toHaveAttribute('target', '_blank');
    await expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');

    await expect(page.locator('[data-blok-testid="embed-frame"]')).toHaveCount(0);
  });

  test('an allowlisted origin is framed for real — no card', async ({ page }) => {
    await createBlok(page, storedGenericEmbed('https://dashboard.example.com/widget/42'), {
      linkPaste: { allowedEmbedOrigins: ['dashboard.example.com'] },
    });

    const iframe = page.locator('[data-blok-testid="embed-frame"]');

    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute('src', 'https://dashboard.example.com/widget/42');
    await expect(page.locator('[data-blok-testid="embed-link-card"]')).toHaveCount(0);
  });

  test('the replace action swaps the card for the URL input without losing data until resolve', async ({ page }) => {
    await createBlok(page, storedGenericEmbed('https://dashboard.example.com/widget/42'));

    const card = page.locator('[data-blok-testid="embed-link-card"]');

    await card.hover();
    await card.locator('[data-role="embed-link-card-replace"]').click();

    await expect(page.locator('[data-role="embed-url-form"]')).toBeVisible();

    // Data untouched until a new URL actually resolves.
    const saved = await page.evaluate(async () => await window.blokInstance?.save());

    expect(saved?.blocks[0]?.data).toMatchObject({
      source: 'https://dashboard.example.com/widget/42',
      embed: 'https://dashboard.example.com/widget/42',
    });
  });
});
