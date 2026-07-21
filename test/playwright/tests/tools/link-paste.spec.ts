import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const NESTED_SCROLL_HOST_ID = 'link-paste-scroll-host';

type BoundingBox = { x: number; y: number; width: number; height: number };

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

const requireBoundingBox = async (locator: Locator, label: string): Promise<BoundingBox> => {
  const box = await locator.boundingBox();

  expect(box, `${label} has no bounding box`).not.toBeNull();

  return box as BoundingBox;
};

const moveEditorIntoNestedScrollHost = async (page: Page): Promise<void> => {
  await page.evaluate(({ holderId, hostId }) => {
    const holder = document.getElementById(holderId);

    if (holder === null || holder.parentElement === null) {
      throw new Error('Blok holder not found');
    }

    const host = document.createElement('div');

    host.id = hostId;
    Object.assign(host.style, {
      height: '420px',
      margin: '80px 40px',
      overflow: 'auto',
      transform: 'translateZ(0)',
    });
    holder.parentElement.insertBefore(host, holder);
    host.appendChild(holder);
    holder.style.paddingTop = '900px';
    holder.style.paddingBottom = '900px';
    host.scrollTop = 700;
  }, { holderId: HOLDER_ID, hostId: NESTED_SCROLL_HOST_ID });
};

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

  test('does not open the link hover card when paste inserts a link under a stationary pointer', async ({ page }) => {
    await createBlok(page);
    const editable = firstEditable(page);
    const editableBox = await requireBoundingBox(editable, 'Empty editable');

    await editable.focus();
    await page.evaluate(() => {
      const selection = window.getSelection();
      const editableElement = document.querySelector<HTMLElement>(
        '[data-blok-testid="block-wrapper"]:nth-of-type(1) [contenteditable]'
      );

      if (selection === null || editableElement === null) {
        throw new Error('Unable to place the caret in the empty editable');
      }

      const range = document.createRange();

      range.selectNodeContents(editableElement);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    });

    // Move over the place where the pasted anchor will appear, then leave the
    // pointer still. Chromium re-runs hit testing after the DOM mutation and
    // emits a synthesized mouseover even though there was no hover intent.
    await page.mouse.move(editableBox.x + 8, editableBox.y + editableBox.height / 2);
    await pasteText(editable, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    const menuItem = page.locator('[data-blok-item-name="paste-menu-embed"]');
    const link = page.getByRole('link', {
      name: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      exact: true,
    });

    await expect(menuItem).toBeVisible();
    await expect(link).toBeVisible();

    // Model Chromium's post-layout hit test explicitly so the recurrence test
    // is deterministic on every browser and machine: mouseover without any
    // preceding pointer movement is not hover intent.
    await link.dispatchEvent('mouseover', {
      clientX: editableBox.x + 8,
      clientY: editableBox.y + editableBox.height / 2,
    });
    const hoverCardOpened = await page.getByTestId('link-hover-card')
      .waitFor({ state: 'attached', timeout: 500 })
      .then(() => true)
      .catch(() => false);

    expect(hoverCardOpened).toBe(false);
    await menuItem.click();
    await expect(page.locator('[data-blok-testid="embed-frame"]')).toBeVisible();
  });

  test('keeps the menu attached to the link inside a transformed nested scroller', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await createBlok(page);
    await moveEditorIntoNestedScrollHost(page);

    const editable = firstEditable(page);

    await editable.click();
    await pasteText(editable, 'https://example.com/article');

    const link = page.getByRole('link', { name: 'https://example.com/article', exact: true });
    const menu = page.locator(
      '[data-blok-popover-opened] [data-blok-testid="popover-container"]'
    ).last();

    await expect(link).toBeVisible();
    await expect(menu).toBeVisible();
    await expect(menu).toHaveCSS('transform', 'none');

    const linkBox = await requireBoundingBox(link, 'Link before nested scroll');
    const menuBox = await requireBoundingBox(menu, 'Paste menu before nested scroll');

    expect(await page.evaluate(
      (hostId) => document.getElementById(hostId)?.scrollTop ?? 0,
      NESTED_SCROLL_HOST_ID
    )).toBeGreaterThan(500);

    await page.evaluate(
      (hostId) => document.getElementById(hostId)?.scrollBy(0, 80),
      NESTED_SCROLL_HOST_ID
    );

    await expect(menu).toBeVisible();
    await expect.poll(async () => {
      const movedLink = await requireBoundingBox(link, 'Link after nested scroll');
      const movedMenu = await requireBoundingBox(menu, 'Paste menu after nested scroll');
      const linkDelta = movedLink.y - linkBox.y;
      const menuDelta = movedMenu.y - menuBox.y;

      return Math.abs(linkDelta - menuDelta);
    }).toBeLessThanOrEqual(2);

    const movedMenu = await requireBoundingBox(menu, 'Contained paste menu');

    expect(movedMenu.x).toBeGreaterThanOrEqual(0);
    expect(movedMenu.x + movedMenu.width).toBeLessThanOrEqual(1280);
    expect(movedMenu.y).toBeGreaterThanOrEqual(0);
    expect(movedMenu.y + movedMenu.height).toBeLessThanOrEqual(720);
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
    await expect(embedItem).toContainText('Embed a video from YouTube');
    await embedItem.click();

    const iframe = page.locator('[data-blok-testid="embed-frame"]');

    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute(
      'src',
      'https://www.youtube.com/embed/dQw4w9WgXcQ'
    );
  });

  test('uses the official Japanese Google Drive name in the embed action', async ({ page }) => {
    await createBlok(page, undefined, { i18n: { locale: 'ja' } });
    const editable = firstEditable(page);

    await editable.click();
    await pasteText(editable, 'https://drive.google.com/file/d/file-id/view');

    const embedItem = page.locator('[data-blok-item-name="paste-menu-embed"]');

    await expect(embedItem).toBeVisible();
    await expect(embedItem).toContainText('Google ドライブからドキュメントを埋め込む');
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

  test('pasting a URL into a block with existing text opens the menu and keeps the text', async ({ page }) => {
    // The bookmark/embed menu must appear even when the block already has content
    // (not only on an empty line), and the existing text must survive: the link
    // is inserted inline at the caret, never by replacing the whole block.
    await createBlok(page, {
      blocks: [{ type: 'paragraph', data: { text: 'Check this out ' } }],
    });

    const editable = firstEditable(page);

    await editable.click();
    await page.keyboard.press('End');
    await pasteText(editable, 'https://example.com/article');

    // The existing text is still there, now followed by the link.
    await expect(editable).toContainText('Check this out');
    const link = page.getByRole('link', { name: 'https://example.com/article', exact: true });

    await expect(link).toHaveCount(1);

    // The menu now appears just like on an empty line.
    await expect(page.locator('[data-blok-item-name="paste-menu-bookmark"]')).toBeVisible();

    // Choosing Plain keeps everything as an enriched single paragraph.
    await pickMenu(page, 'plain');
    await expect(page.locator('[data-blok-testid="bookmark-card"]')).toHaveCount(0);
    await expect(page.locator(BLOCK_SELECTOR)).toHaveCount(1);

    const saved = await saveBlok(page);

    expect(saved.blocks).toHaveLength(1);
    expect(saved.blocks[0].type).toBe('paragraph');
    expect((saved.blocks[0].data as { text: string }).text).toContain('Check this out');
    expect((saved.blocks[0].data as { text: string }).text).toContain('https://example.com/article');
  });

  test('choosing Bookmark from a block with text keeps the text and adds the card as a new block', async ({ page }) => {
    // Non-destructive bookmark: the surrounding text stays in its paragraph and
    // the bookmark card is appended as a NEW block, with the inline link dropped.
    await createBlok(page, {
      blocks: [{ type: 'paragraph', data: { text: 'Read this ' } }],
    });

    const editable = firstEditable(page);

    await editable.click();
    await page.keyboard.press('End');
    await pasteText(editable, 'https://example.com/article');

    await pickMenu(page, 'bookmark');

    const card = page.locator('[data-blok-testid="bookmark-card"]');

    await expect(card).toBeVisible();

    const saved = await saveBlok(page);
    const paragraph = saved.blocks.find((block) => block.type === 'paragraph');
    const bookmark = saved.blocks.find((block) => block.type === 'bookmark');

    // The original text survives; the bookmark is a separate block; no duplicate
    // inline copy of the URL is left behind in the paragraph.
    expect((paragraph?.data as { text: string }).text).toContain('Read this');
    expect((paragraph?.data as { text: string }).text).not.toContain('href=');
    expect(bookmark).toBeDefined();
    expect((bookmark?.data as { url?: string }).url).toBe('https://example.com/article');
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
