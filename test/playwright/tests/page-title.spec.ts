import type { Locator, Page } from '@playwright/test';

import type { Blok, BlokConfig } from '@/types';
import { ensureBlokBundleBuilt } from './helpers/ensure-build';
import { expect, gotoTestPage, test } from './helpers/shared-page';

const HOLDER_ID = 'blok';
const TITLE_HOST_ID = 'title-host';

type CreateBlokOptions = Partial<Pick<BlokConfig, 'readOnly' | 'style' | 'pageTitle' | 'data' | 'i18n'>> & {
  titleHost?: boolean;
  /** An 80px strip between the host holder and the editor, like a host's meta row. */
  strip?: boolean;
};

const DEFAULT_DATA = { title: 'Plans', blocks: [ { type: 'paragraph', data: { text: 'Body' } } ] };

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

const createBlok = async (page: Page, options: CreateBlokOptions = {}): Promise<void> => {
  const { titleHost = false, strip = false, data = DEFAULT_DATA, ...blokOptions } = options;

  await page.evaluate(async ({ holder, hostId, withHost, withStrip, blokData, rawOptions }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    document.getElementById(hostId)?.remove();
    document.getElementById(`${holder}-strip`)?.remove();

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
    if (withStrip) {
      const meta = document.createElement('div');

      meta.id = `${holder}-strip`;
      meta.textContent = 'Created · Updated';
      meta.style.height = '80px';
      document.body.insertBefore(meta, container);
    }

    const blok = new window.Blok({
      holder,
      pageTitle: true,
      ...rawOptions,
      data: blokData,
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, hostId: TITLE_HOST_ID, withHost: titleHost, withStrip: strip, blokData: data, rawOptions: blokOptions });
};

/** Start edge of the first character's glyph box: a Range over it, not the element box. */
const firstCharEdge = async (page: Page, selector: string, edge: 'left' | 'right' = 'left'): Promise<number> => {
  return page.locator(selector).first().evaluate((element, side) => {
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

    return range.getBoundingClientRect()[side];
  }, edge);
};

const TITLE_SELECTOR = '[data-blok-testid="page-header-title"]';
const PARAGRAPH_SELECTOR = '[data-blok-testid="block-wrapper"][data-blok-component="paragraph"]';

/** How far the title text starts from the first block text, in px. */
const titleOffsetFromFirstBlock = async (page: Page, edge: 'left' | 'right' = 'left'): Promise<number> => {
  const title = await firstCharEdge(page, TITLE_SELECTOR, edge);
  const body = await firstCharEdge(page, PARAGRAPH_SELECTOR, edge);

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

  test('stays aligned in RTL: the first character\'s right edge matches', async ({ page }) => {
    await createBlok(page, {
      i18n: { direction: 'rtl' },
      // Each block takes its direction from its own text, so RTL needs RTL text.
      data: { title: 'خطط', blocks: [ { type: 'paragraph', data: { text: 'نص' } } ] },
    });

    await expect(page.getByTestId('page-header')).toHaveAttribute('dir', 'rtl');
    expect(await titleOffsetFromFirstBlock(page, 'right')).toBeLessThanOrEqual(1);
  });
});

const title = (page: Page): Locator => page.getByRole('textbox', { name: 'Page title' });
const firstBlockText = (page: Page): Locator => page.locator(PARAGRAPH_SELECTOR).first().locator('[contenteditable="true"]');
/** The space Enter carried over may render as a no-break space. */
const bodyText = async (page: Page): Promise<string> => ((await firstBlockText(page).textContent()) ?? '').replace(/\u00a0/g, ' ');
const iconButton = (page: Page): Locator => page.getByTestId('page-header-icon');
const emojiPicker = (page: Page): Locator => page.locator('[data-emoji-picker-body]');

test.describe('page title behaviour', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('title in an outside holder, keyboard moves across the gap', async ({ page }) => {
    await createBlok(page, { titleHost: true, strip: true, pageTitle: { holder: `#${TITLE_HOST_ID}` } });

    await title(page).click();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowDown');
    await expect(firstBlockText(page)).toBeFocused();

    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowUp');
    await expect(title(page)).toBeFocused();
  });

  test('Enter splits; Backspace joins back; both undo', async ({ page }) => {
    await createBlok(page, { data: { title: 'Hello world', blocks: [] } });
    await title(page).click();
    await page.keyboard.press('End');
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('ArrowLeft');
    }
    await page.keyboard.press('Enter');

    await expect(title(page)).toHaveText('Hello');
    await expect(firstBlockText(page)).toBeFocused();
    expect(await bodyText(page)).toBe(' world');

    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');
    await expect(title(page)).toHaveText('Hello world');
    await expect(title(page)).toBeFocused();

    await page.keyboard.press('ControlOrMeta+z');
    await expect(title(page)).toHaveText('Hello');
    expect(await bodyText(page)).toBe(' world');

    // eslint-disable-next-line playwright/no-wait-for-timeout -- Blok drops a second undo within 50ms
    await page.waitForTimeout(60);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(title(page)).toHaveText('Hello world');
  });

  test('narrow container steps the title font size down', async ({ page }) => {
    await createBlok(page);
    const header = page.getByTestId('page-header');
    // The tiers query the header's content box, which excludes the editor gutter.
    const measure = (): Promise<{ column: number; size: string }> => header.evaluate((el) => {
      const style = getComputedStyle(el);
      const titleElement = el.querySelector('[data-blok-testid="page-header-title"]');

      return {
        column: el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        size: titleElement === null ? '' : getComputedStyle(titleElement).fontSize,
      };
    });
    const setHolderWidth = (width: number): Promise<void> => page.evaluate(({ holder, px }) => {
      const element = document.getElementById(holder);

      if (element !== null) {
        element.style.width = `${px}px`;
      }
    }, { holder: HOLDER_ID, px: width });

    const wide = await measure();

    expect(wide.column).toBeGreaterThan(480);
    expect(wide.size).toBe('40px');

    await setHolderWidth(480);
    await expect.poll(async () => (await measure()).size).toBe('32px');
    const mid = await measure();

    expect(mid.column).toBeLessThanOrEqual(480);
    expect(mid.column).toBeGreaterThan(360);

    await setHolderWidth(400);
    await expect.poll(async () => (await measure()).size).toBe('28px');
    expect((await measure()).column).toBeLessThanOrEqual(360);
  });

  test('a long title wraps past two lines with no clamp', async ({ page }) => {
    await createBlok(page, { data: { title: 'Маркетинговая поддержка на 14 февраля '.repeat(6), blocks: [] } });
    const lines = await title(page).evaluate((el) => {
      const style = getComputedStyle(el);
      const content = el.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);

      return Math.round(content / parseFloat(style.lineHeight));
    });

    expect(lines).toBeGreaterThan(2);
  });

  test('Add icon sets an emoji and opens the picker; icon change undoes', async ({ page }) => {
    await createBlok(page, { data: { blocks: [] } });
    await page.getByTestId('page-header').hover();
    await page.getByTestId('page-header-add-icon').click();

    await expect(iconButton(page)).toBeVisible();
    await expect(iconButton(page)).not.toBeEmpty();
    await expect(iconButton(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(emojiPicker(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(emojiPicker(page)).toBeHidden();
    await expect(iconButton(page)).toHaveAttribute('aria-expanded', 'false');

    await title(page).click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByTestId('page-header-add-icon')).toBeAttached();
    await expect(iconButton(page)).toHaveCount(0);
  });

  test('an empty title shows its placeholder in the placeholder gray, not the text ink', async ({ page }) => {
    await createBlok(page, { data: { blocks: [] } });
    await expect(title(page)).toBeEmpty();

    const colors = await title(page).evaluate((el) => {
      const probe = document.createElement('span');

      probe.style.color = 'var(--blok-gray-text)';
      el.parentElement?.appendChild(probe);
      const gray = getComputedStyle(probe).color;

      probe.remove();

      return { placeholder: getComputedStyle(el, '::before').color, ink: getComputedStyle(el).color, gray };
    });

    expect(colors.placeholder).not.toBe(colors.ink);
    expect(colors.placeholder).toBe(colors.gray);
  });

  test('read-only: no editing, no Add icon', async ({ page }) => {
    await createBlok(page, { readOnly: true });

    await expect(title(page)).toHaveText('Plans');
    await expect(title(page)).toHaveAttribute('contenteditable', 'false');
    await expect(page.getByTestId('page-header-add-icon')).toHaveCount(0);
  });

  test('click on the icon shows no focus ring', async ({ page }) => {
    await createBlok(page, { data: { icon: { type: 'emoji', value: '🌿' }, blocks: [] } });
    await iconButton(page).click();
    await expect(emojiPicker(page)).toBeVisible();
    // Settle the opening animation so the click lands on a still grid.
    await page.locator('[data-blok-emoji-picker]')
      .evaluate((picker) => picker.getAnimations().forEach((animation) => animation.finish()));
    // Pick by pointer: Escape is a key press and turns keyboard modality on,
    // and a backdrop click leaves focus on the body.
    await page.locator('[data-emoji-native="👉"]').click();
    await expect(emojiPicker(page)).toBeHidden();
    await expect(iconButton(page)).toHaveText('👉');

    await expect(iconButton(page)).toBeFocused();
    expect(await iconButton(page).evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
  });
});
