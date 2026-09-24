import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const SETTINGS_BUTTON = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const TUNES_POPOVER = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const NESTED_POPOVER = '[data-blok-nested="true"] [data-blok-testid="popover-container"]';
// Yjs captureTimeout is 500ms; wait past it so gestures are separate undo steps.
const CAPTURE_WINDOW = 700;

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const createBlok = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ holder, blocks: initial }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);
    const blok = new window.Blok({ holder, data: { blocks: initial } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blocks });
};

const wait = async (page: Page, ms: number): Promise<void> => {
  await page.evaluate(async (t) => new Promise<void>((r) => window.setTimeout(r, t)), ms);
};

const blocksOf = async (page: Page): Promise<Array<{ type: string; data: Record<string, unknown> }>> => {
  return page.evaluate(async () => {
    const out = await window.blokInstance?.save();

    return (out?.blocks ?? []).map((b) => ({ type: b.type, data: b.data }));
  });
};

const treeOf = async (page: Page): Promise<Array<{ id?: string; type: string; text: unknown; parent?: string; content?: string[] }>> => {
  return page.evaluate(async () => {
    const out = await window.blokInstance?.save();

    return (out?.blocks ?? []).map((b) => ({
      id: b.id,
      type: b.type,
      text: (b.data as { text?: unknown }).text,
      level: (b.data as { level?: unknown }).level,
      toggle: (b.data as { isToggleable?: unknown }).isToggleable,
      parent: b.parent,
      content: b.content,
    }));
  });
};

const openTunes = async (page: Page, hasText: string): Promise<void> => {
  const block = page.getByTestId('block-wrapper').filter({ hasText }).last();

  await block.click();
  await block.hover();
  await page.locator(SETTINGS_BUTTON).click();
  await expect(page.locator(TUNES_POPOVER)).toBeVisible();
};

const tuneItem = (page: Page, name: string): ReturnType<Page['locator']> =>
  page.locator(`${TUNES_POPOVER} [data-blok-testid="popover-item"][data-blok-item-name="${name}"]`);

/** Close menus and wait past the capture window. */
const settle = async (page: Page): Promise<void> => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await wait(page, CAPTURE_WINDOW);
};

test.describe('undo audit: capture', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    test.setTimeout(30_000);
    await gotoTestPage(page);
  });

  const pressUndo = async (page: Page, clickText: string): Promise<void> => {
    await page.getByText(clickText, { exact: true }).click();
    await page.keyboard.press(UNDO_SHORTCUT);
    await wait(page, 300);
  };

  const pickBlockColor = async (page: Page, hasText: string, swatchTestId: string): Promise<void> => {
    await openTunes(page, hasText);
    await tuneItem(page, 'block-color').dispatchEvent('mouseover');
    await page.getByTestId(swatchTestId).click();
    await settle(page);
  };

  // Undo must restore the exact prior state. Same result through blokInstance.history.undo().
  test('CAP-1: undo of a paragraph text color leaves the color on', async ({ page }) => {
    await createBlok(page, [{ type: 'paragraph', data: { text: 'Before' } }, { type: 'paragraph', data: { text: 'Colorful' } }]);
    await wait(page, CAPTURE_WINDOW);
    await pickBlockColor(page, 'Colorful', 'block-color-swatch-textColor-red');
    await pressUndo(page, 'Before');

    expect((await blocksOf(page))[1].data.textColor).toBeUndefined();
  });

  // Undo must restore the exact prior state.
  test('CAP-2: undo of a paragraph color reset brings the color back', async ({ page }) => {
    await createBlok(page, [{ type: 'paragraph', data: { text: 'Before' } }, { type: 'paragraph', data: { text: 'Colorful', textColor: 'red' } }]);
    await wait(page, CAPTURE_WINDOW);
    await openTunes(page, 'Colorful');
    await tuneItem(page, 'block-color').dispatchEvent('mouseover');
    await page.getByTestId('block-color-reset-textColor').click();
    await settle(page);
    await pressUndo(page, 'Before');

    expect((await blocksOf(page))[1].data.textColor).toBe('red');
  });

  // Undo must restore the exact prior state.
  test('CAP-3: undo of a quote size change keeps the new size', async ({ page }) => {
    await createBlok(page, [{ type: 'paragraph', data: { text: 'Before' } }, { type: 'quote', data: { text: 'Quoted', size: 'default' } }]);
    await wait(page, CAPTURE_WINDOW);
    await openTunes(page, 'Quoted');
    await tuneItem(page, 'quote-size').click();
    await page.locator(`${NESTED_POPOVER} [data-blok-testid="popover-item"]`).nth(1).click();
    await settle(page);
    await pressUndo(page, 'Before');

    expect((await blocksOf(page))[1].data.size).toBe('default');
  });

  // Undo must restore the exact prior state, DOM included.
  test('CAP-4: undo of a heading level change leaves the old tag on screen', async ({ page }) => {
    await createBlok(page, [{ type: 'paragraph', data: { text: 'Before' } }, { type: 'header', data: { text: 'Heading', level: 2 } }]);
    await wait(page, CAPTURE_WINDOW);
    await openTunes(page, 'Heading');
    await page.locator('[data-blok-testid="popover-item"][data-blok-item-name="header-level-3"]').first().click();
    await settle(page);
    await pressUndo(page, 'Before');

    const tag = await page.getByText('Heading', { exact: true }).evaluate((el) => el.closest('h1,h2,h3,h4,h5,h6')?.tagName);

    expect(tag).toBe('H2');
    expect((await blocksOf(page))[1].data.level).toBe(2);
  });

  // Undo must restore the exact prior state, DOM included.
  test('CAP-5: undo of a heading text color leaves the color on screen', async ({ page }) => {
    await createBlok(page, [{ type: 'paragraph', data: { text: 'Before' } }, { type: 'header', data: { text: 'Heading', level: 2 } }]);
    await wait(page, CAPTURE_WINDOW);
    const heading = page.getByRole('heading', { name: 'Heading' });
    const colorBefore = await heading.evaluate((el) => getComputedStyle(el).color);

    await pickBlockColor(page, 'Heading', 'block-color-swatch-textColor-red');
    await pressUndo(page, 'Before');

    expect(await heading.evaluate((el) => getComputedStyle(el).color)).toBe(colorBefore);
    expect((await blocksOf(page))[1].data.textColor).toBeUndefined();
  });

  // Undo must restore the exact prior state, and save() must keep working.
  test('CAP-6: undo of a callout color keeps the callout child and save() working', async ({ page }) => {
    await createBlok(page, [
      { id: 'p0', type: 'paragraph', data: { text: 'Before' } },
      { id: 'co', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: ['k1'] },
      { id: 'k1', type: 'paragraph', data: { text: 'Inside' }, parent: 'co' },
    ]);
    await wait(page, CAPTURE_WINDOW);
    await page.locator('[data-blok-id="co"]').hover({ position: { x: 5, y: 5 } });
    await page.locator(SETTINGS_BUTTON).click();
    await tuneItem(page, 'callout-color').dispatchEvent('mouseover');
    await page.getByTestId('callout-color-swatch-color-red').click();
    await settle(page);
    await pressUndo(page, 'Before');

    const saved = await page.evaluate(async () => {
      try {
        const out = await window.blokInstance?.save();

        return JSON.stringify(out?.blocks.map((b) => [b.id, b.parent ?? null, (b.data as { textColor?: unknown }).textColor ?? null]));
      } catch (e) {
        return String(e);
      }
    });

    expect(saved).toBe('[["p0",null,null],["co",null,null],["k1","co",null]]');
    await expect(page.getByText('Inside')).toBeVisible();
  });

  const toggleHeadingDoc: OutputData['blocks'] = [
    { id: 'p0', type: 'paragraph', data: { text: 'Before' } },
    { id: 'h1', type: 'header', data: { text: 'Toggle parent', level: 2, isToggleable: true, isOpen: true }, content: ['c1'] },
    { id: 'c1', type: 'paragraph', data: { text: 'Child para' }, parent: 'h1' },
  ];

  const turnToggleHeadingIntoHeading = async (page: Page): Promise<void> => {
    await openTunes(page, 'Toggle parent');
    await tuneItem(page, 'convert-to').dispatchEvent('mouseover');
    await page.locator('[data-blok-testid="block-tunes-popover"] [data-blok-nested="true"] [data-blok-popover-tabs] [role="tab"][data-blok-popover-tab="heading"]').click();
    await page.locator('[data-blok-testid="block-tunes-popover"] [data-blok-nested="true"] [data-blok-item-name="header-2"]').click();
    await settle(page);
  };

  // One undo must revert one gesture, children included.
  test('CAP-7: one undo of "toggle heading -> heading" puts the children back', async ({ page }) => {
    await createBlok(page, toggleHeadingDoc);
    await wait(page, CAPTURE_WINDOW);
    const before = await treeOf(page);

    await turnToggleHeadingIntoHeading(page);
    await pressUndo(page, 'Before');

    expect(await treeOf(page)).toEqual(before);
  });

  // Undo must restore the DOM tree, not only saved data.
  test('CAP-8: after undoing "toggle heading -> heading" the child is not back inside the heading on screen', async ({ page }) => {
    await createBlok(page, toggleHeadingDoc);
    await wait(page, CAPTURE_WINDOW);
    const domParent = async (): Promise<string | null> => page.locator('[data-blok-id="c1"]').evaluate((el) => el.parentElement?.closest('[data-blok-id]')?.getAttribute('data-blok-id') ?? null);

    expect(await domParent()).toBe('h1');
    await turnToggleHeadingIntoHeading(page);
    await pressUndo(page, 'Before');
    await page.keyboard.press(UNDO_SHORTCUT);
    await wait(page, 300);

    expect(await domParent()).toBe('h1');
    expect((await treeOf(page)).find((b) => b.id === 'c1')?.parent).toBe('h1');
  });
});
