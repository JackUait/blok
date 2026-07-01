import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;

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

const saveBlok = async (page: Page): Promise<OutputData> => {
  return await page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    return await window.blokInstance.save();
  });
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

/** Pick a view from the paste menu that a URL paste always opens. */
const pickMenu = async (page: Page, action: 'embed' | 'bookmark' | 'plain'): Promise<void> => {
  const item = page.locator(`[data-blok-item-name="paste-menu-${action}"]`);

  await expect(item).toBeVisible();
  await item.click();
};

const stubUnfurl = async (page: Page): Promise<void> => {
  await page.route('**/__unfurl*', async (route) => {
    await route.fulfill({
      json: {
        success: 1,
        link: 'https://example.com/article',
        meta: {
          title: 'Stubbed Title',
          description: 'Stubbed Description',
          image: { url: 'https://example.com/og.png' },
          favicon: 'https://example.com/favicon.ico',
          domain: 'example.com',
        },
      },
    });
  });
};

test.describe('Link paste', () => {
  test.beforeAll(async () => {
    await ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await stubUnfurl(page);
  });

  test('a URL paste always opens the menu — no block is auto-claimed', async ({ page }) => {
    await createBlok(page);
    const editable = firstEditable(page);

    await editable.click();
    await pasteText(editable, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    // The menu is shown; nothing is embedded or bookmarked until the user picks.
    await expect(page.locator('[data-blok-item-name="paste-menu-embed"]')).toBeVisible();
    await expect(page.locator('[data-blok-testid="embed-frame"]')).toHaveCount(0);
    await expect(page.locator('[data-blok-testid="bookmark-card"]')).toHaveCount(0);
  });

  test('shows the pasted link immediately and anchors the menu at its end', async ({ page }) => {
    await createBlok(page);
    const editable = firstEditable(page);

    await editable.click();
    await pasteText(editable, 'https://example.com/article');

    // The link itself is visible right away — before any pick.
    const link = page.getByRole('link', { name: 'https://example.com/article', exact: true });

    await expect(link).toBeVisible();

    // The menu is open alongside the link, offering the view choices.
    const bookmarkItem = page.locator('[data-blok-item-name="paste-menu-bookmark"]');

    await expect(bookmarkItem).toBeVisible();

    // The menu sits at the end of the link (after it, not above it).
    const linkBox = await link.boundingBox();
    const menuBox = await bookmarkItem.boundingBox();

    if (!linkBox || !menuBox) {
      throw new Error('missing layout boxes');
    }
    expect(menuBox.y).toBeGreaterThanOrEqual(linkBox.y - 1);
    expect(menuBox.x).toBeGreaterThanOrEqual(linkBox.x);
  });

  test('pasting a generic URL opens the menu, and Bookmark inserts a card', async ({ page }) => {
    await createBlok(page);
    const editable = firstEditable(page);

    await editable.click();
    await pasteText(editable, 'https://example.com/article');

    // The menu replaces auto-claim: no card until the user picks.
    await expect(page.locator('[data-blok-testid="bookmark-card"]')).toHaveCount(0);

    await pickMenu(page, 'bookmark');

    const card = page.locator('[data-blok-testid="bookmark-card"]');

    await expect(card).toBeVisible();
    await expect(card).toContainText('Stubbed Title');
  });

  test('pasting a YouTube URL offers Embed, which inserts an iframe', async ({ page }) => {
    await createBlok(page);
    const editable = firstEditable(page);

    await editable.click();
    await pasteText(editable, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    const embedItem = page.locator('[data-blok-item-name="paste-menu-embed"]');

    await expect(embedItem).toBeVisible();
    // The menu phrases the action per link type instead of a generic "Embed" label.
    await expect(embedItem).toContainText('Embed YouTube video');
    await embedItem.click();

    const iframe = page.locator('[data-blok-testid="embed-frame"]');

    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute(
      'src',
      'https://www.youtube.com/embed/dQw4w9WgXcQ'
    );
  });

  test('a chosen embed stretches to full width with side resize handles', async ({ page }) => {
    await createBlok(page);
    const editable = firstEditable(page);

    await editable.click();
    await pasteText(editable, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await pickMenu(page, 'embed');

    const figure = page.locator('[data-role="embed-figure"]');

    await expect(figure).toBeVisible();

    // Both edge handles are wired; they reveal on hover (Notion-style).
    await expect(figure.locator('[data-role="resize-handle"]')).toHaveCount(2);
    await figure.hover();
    await expect(figure.locator('[data-role="resize-handle"][data-edge="left"]')).toBeVisible();
    await expect(figure.locator('[data-role="resize-handle"][data-edge="right"]')).toBeVisible();

    const figureBox = await figure.boundingBox();
    const toolBox = await page.locator('[data-blok-tool="embed"]').boundingBox();

    if (!figureBox || !toolBox) {
      throw new Error('missing layout boxes');
    }
    // Embed stretches to fill (near) the full available content width by default.
    expect(figureBox.width).toBeGreaterThan(toolBox.width * 0.95);
  });

  test('the embed hover toolbar toggles a caption and links to the original', async ({ page }) => {
    await createBlok(page);
    const editable = firstEditable(page);

    await editable.click();
    await pasteText(editable, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await pickMenu(page, 'embed');

    const figure = page.locator('[data-role="embed-figure"]');

    await expect(figure).toBeVisible();
    await figure.hover();

    const overlay = figure.locator('[data-role="embed-overlay"]');

    await expect(overlay).toBeVisible();

    // "Open original" points at the source URL in a new tab.
    const open = overlay.locator('[data-action="open-original"]');

    await expect(open).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await expect(open).toHaveAttribute('target', '_blank');

    // Caption toggle reveals an editable caption field.
    await expect(figure.locator('[data-role="embed-caption"]')).toHaveCount(0);
    await overlay.locator('[data-action="caption-toggle"]').click();
    await expect(figure.locator('[data-role="embed-caption"]')).toBeVisible();

    const saved = await saveBlok(page);
    const embed = saved.blocks.find((block) => block.type === 'embed');

    expect((embed?.data as { captionVisible?: boolean }).captionVisible).toBe(true);
  });

  test('a chosen bookmark persists across save and reload', async ({ page }) => {
    await createBlok(page);
    const editable = firstEditable(page);

    await editable.click();
    await pasteText(editable, 'https://example.com/article');
    await pickMenu(page, 'bookmark');
    await expect(page.locator('[data-blok-testid="bookmark-card"]')).toBeVisible();

    const saved = await saveBlok(page);
    const bookmarkBlock = saved.blocks.find((block) => block.type === 'bookmark');

    expect(bookmarkBlock).toBeDefined();
    expect((bookmarkBlock?.data as { url?: string }).url).toBe('https://example.com/article');

    await createBlok(page, saved);

    await expect(page.locator('[data-blok-testid="bookmark-card"]')).toBeVisible();
  });

  test('choosing Plain link keeps the URL as a link, not a card', async ({ page }) => {
    await createBlok(page);
    const editable = firstEditable(page);

    await editable.click();
    await pasteText(editable, 'https://example.com/article');

    await pickMenu(page, 'plain');

    await expect(page.locator('[data-blok-testid="bookmark-card"]')).toHaveCount(0);

    const link = page.getByRole('link', { name: 'https://example.com/article', exact: true });

    await expect(link).toHaveCount(1);
  });

  test('pasting a URL into a block with existing text keeps the text (inline link, no menu)', async ({ page }) => {
    // Regression: a URL pasted into a non-empty block used to replace the whole
    // block, erasing everything but the link. It must now insert inline and keep
    // the surrounding text, without opening the bookmark/embed menu.
    await createBlok(page, {
      blocks: [{ type: 'paragraph', data: { text: 'Check this out ' } }],
    } as OutputData);

    const editable = firstEditable(page);

    await editable.click();
    // Put the caret at the very end of the existing text.
    await page.keyboard.press('End');
    await pasteText(editable, 'https://example.com/article');

    // The existing text is still there, now followed by the link.
    await expect(editable).toContainText('Check this out');
    const link = page.getByRole('link', { name: 'https://example.com/article', exact: true });

    await expect(link).toHaveCount(1);

    // No menu, no bookmark/embed, no extra block — just the enriched paragraph.
    await expect(page.locator('[data-blok-item-name="paste-menu-bookmark"]')).toHaveCount(0);
    await expect(page.locator('[data-blok-testid="bookmark-card"]')).toHaveCount(0);
    await expect(page.locator(BLOCK_SELECTOR)).toHaveCount(1);

    const saved = await saveBlok(page);

    expect(saved.blocks).toHaveLength(1);
    expect(saved.blocks[0].type).toBe('paragraph');
    expect((saved.blocks[0].data as { text: string }).text).toContain('Check this out');
    expect((saved.blocks[0].data as { text: string }).text).toContain('https://example.com/article');
  });

  test('Escape dismisses the menu and keeps the URL as a link', async ({ page }) => {
    await createBlok(page);
    const editable = firstEditable(page);

    await editable.click();
    await pasteText(editable, 'https://example.com/article');

    await expect(page.locator('[data-blok-item-name="paste-menu-bookmark"]')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.locator('[data-blok-item-name="paste-menu-bookmark"]')).toBeHidden();
    await expect(page.locator('[data-blok-testid="bookmark-card"]')).toHaveCount(0);

    const link = page.getByRole('link', { name: 'https://example.com/article', exact: true });

    await expect(link).toHaveCount(1);
  });
});
