import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const EMPTY_TAB_TEXT = 'Empty tab. Click or drop blocks inside.';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

type Blocks = OutputData['blocks'];

const createBlok = async (page: Page, blocks?: Blocks, config: Record<string, unknown> = {}): Promise<void> => {
  await page.evaluate(async ({ holder, initialBlocks, extra }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);

    const blok = new window.Blok({
      holder,
      ...(initialBlocks ? { data: { blocks: initialBlocks } } : {}),
      ...extra,
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialBlocks: blocks ?? null, extra: config });
};

const saveBlok = (page: Page): Promise<OutputData> =>
  page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    return await window.blokInstance.save();
  });

/** Three tabs, each holding one paragraph. */
const threeTabs: Blocks = [
  { id: 'tabs1', type: 'tabs', data: {}, content: ['t1', 't2', 't3'] },
  { id: 't1', type: 'tab', data: { title: 'Alpha' }, parent: 'tabs1', content: ['p1'] },
  { id: 'p1', type: 'paragraph', data: { text: 'Alpha body' }, parent: 't1' },
  { id: 't2', type: 'tab', data: { title: 'Beta' }, parent: 'tabs1', content: ['p2'] },
  { id: 'p2', type: 'paragraph', data: { text: 'Beta body' }, parent: 't2' },
  { id: 't3', type: 'tab', data: { title: 'Gamma' }, parent: 'tabs1', content: ['p3'] },
  { id: 'p3', type: 'paragraph', data: { text: 'Gamma body' }, parent: 't3' },
];

const tab = (page: Page, name: string): ReturnType<Page['getByRole']> =>
  page.getByRole('tab', { name, exact: true });

/** The tabpanel named by a tab (aria-labelledby points at the pill). */
const panel = (page: Page, name: string): ReturnType<Page['getByRole']> =>
  page.getByRole('tabpanel', { name, exact: true, includeHidden: true });

const insertTabsViaSlash = async (page: Page): Promise<void> => {
  await createBlok(page);
  await page.locator('[data-blok-element] [contenteditable="true"]').first().click();
  await page.keyboard.type('/tabs');

  const toolbox = page.getByTestId('toolbox-popover');

  await expect(toolbox).toHaveAttribute('data-blok-popover-opened', 'true');
  await toolbox.locator('[data-blok-item-name="tabs"]:not([data-blok-hidden])').click();
  await expect(page.getByRole('tab')).toHaveCount(3);
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('Tabs tool', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('/tabs in an empty paragraph inserts three tabs with the first one open and empty', async ({ page }) => {
    await insertTabsViaSlash(page);

    await expect(page.getByRole('tab')).toHaveText(['Tab 1', 'Tab 2', 'Tab 3']);
    await expect(tab(page, 'Tab 1')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Tab 2')).toHaveAttribute('aria-selected', 'false');
    await expect(tab(page, 'Tab 3')).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByText(EMPTY_TAB_TEXT)).toHaveCount(3);
    await expect(panel(page, 'Tab 1').getByText(EMPTY_TAB_TEXT)).toBeVisible();

    const saved = await saveBlok(page);
    const tabsBlock = saved.blocks.find(block => block.type === 'tabs');
    const tabBlocks = saved.blocks.filter(block => block.type === 'tab');

    expect(tabsBlock).toBeDefined();
    expect(tabBlocks.map(block => block.data)).toEqual([{ title: 'Tab 1' }, { title: 'Tab 2' }, { title: 'Tab 3' }]);
    expect(tabBlocks.every(block => block.parent === tabsBlock?.id)).toBe(true);
  });

  test('clicking a tab shows its panel and hides the others', async ({ page }) => {
    await createBlok(page, threeTabs);

    await expect(panel(page, 'Alpha')).toBeVisible();
    await expect(panel(page, 'Beta')).toBeHidden();
    await expect(page.getByText('Beta body')).toBeHidden();

    await tab(page, 'Beta').click();

    await expect(tab(page, 'Beta')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Alpha')).toHaveAttribute('aria-selected', 'false');
    await expect(panel(page, 'Beta')).toBeVisible();
    await expect(page.getByText('Beta body')).toBeVisible();
    await expect(panel(page, 'Alpha')).toBeHidden();
    await expect(panel(page, 'Gamma')).toBeHidden();
  });

  test('arrow keys, Home and End move the selection along the strip', async ({ page }) => {
    await createBlok(page, threeTabs);
    await tab(page, 'Alpha').focus();

    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'Beta')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Beta')).toBeFocused();
    await expect(page.getByText('Beta body')).toBeVisible();

    await page.keyboard.press('ArrowLeft');
    await expect(tab(page, 'Alpha')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Alpha')).toBeFocused();

    await page.keyboard.press('End');
    await expect(tab(page, 'Gamma')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Gamma')).toBeFocused();
    await expect(page.getByText('Gamma body')).toBeVisible();

    await page.keyboard.press('Home');
    await expect(tab(page, 'Alpha')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Alpha')).toBeFocused();
    await expect(page.getByText('Gamma body')).toBeHidden();
  });

  test('the Add tab button appends a new tab and opens it', async ({ page }) => {
    await insertTabsViaSlash(page);

    await page.getByTestId('tabs').hover();
    await page.getByRole('button', { name: 'Add tab' }).click();

    await expect(page.getByRole('tab')).toHaveCount(4);
    await expect(tab(page, 'Tab 4')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Tab 1')).toHaveAttribute('aria-selected', 'false');
    await expect(panel(page, 'Tab 4')).toBeVisible();

    const saved = await saveBlok(page);

    expect(saved.blocks.filter(block => block.type === 'tab').map(block => block.data)).toEqual([
      { title: 'Tab 1' }, { title: 'Tab 2' }, { title: 'Tab 3' }, { title: 'Tab 4' },
    ]);
  });

  test('double-clicking a tab renames it and Enter saves the title', async ({ page }) => {
    await createBlok(page, threeTabs);

    await tab(page, 'Beta').dblclick();

    const input = page.getByRole('textbox', { name: 'Tab title' });

    await expect(input).toBeFocused();
    await input.fill('Renamed');
    await input.press('Enter');

    await expect(tab(page, 'Renamed')).toBeVisible();
    await expect(input).toHaveCount(0);
    await expect.poll(async () => (await saveBlok(page)).blocks.find(block => block.id === 't2')?.data)
      .toEqual({ title: 'Renamed' });
  });

  test('clicking the open tab opens its menu, and Delete removes the tab with its content', async ({ page }) => {
    await createBlok(page, threeTabs);

    await tab(page, 'Alpha').click();

    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Edit icon' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();

    await page.getByRole('menuitem', { name: 'Delete' }).click();

    await expect(page.getByRole('tab')).toHaveCount(2);
    await expect(tab(page, 'Beta')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(async () => (await saveBlok(page)).blocks.map(block => block.id))
      .toEqual(['tabs1', 't2', 'p2', 't3', 'p3']);
  });

  test('clicking the empty placeholder adds a paragraph inside that tab', async ({ page }) => {
    await insertTabsViaSlash(page);
    await tab(page, 'Tab 2').click();

    await panel(page, 'Tab 2').getByText(EMPTY_TAB_TEXT).click();
    await page.keyboard.type('Inside tab two');

    await expect(panel(page, 'Tab 2').getByText('Inside tab two')).toBeVisible();
    await expect(panel(page, 'Tab 2').getByText(EMPTY_TAB_TEXT)).toBeHidden();

    const saved = await saveBlok(page);
    const tabTwo = saved.blocks.find(block => block.type === 'tab' && (block.data as { title: string }).title === 'Tab 2');
    const paragraph = saved.blocks.find(block => block.type === 'paragraph' && (block.data as { text: string }).text === 'Inside tab two');

    expect(tabTwo).toBeDefined();
    expect(paragraph?.parent).toBe(tabTwo?.id);
  });

  test('one undo after inserting tabs removes the whole block', async ({ page }) => {
    await insertTabsViaSlash(page);

    await page.keyboard.press(UNDO);

    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByTestId('tabs')).toHaveCount(0);

    const saved = await saveBlok(page);

    expect(saved.blocks.filter(block => block.type === 'tabs' || block.type === 'tab')).toEqual([]);
  });

  test('read-only: tabs still switch, but there is no Add tab button', async ({ page }) => {
    await createBlok(page, threeTabs, { readOnly: true });

    await expect(tab(page, 'Alpha')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Add tab' })).toHaveCount(0);

    await tab(page, 'Gamma').click();

    await expect(tab(page, 'Gamma')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Gamma body')).toBeVisible();
    await expect(page.getByText('Alpha body')).toBeHidden();
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  });

  test('find-in-page opens the tab that holds a hidden match', async ({ page }) => {
    await createBlok(page, [
      { id: 'tabs1', type: 'tabs', data: {}, content: ['t1', 't2'] },
      { id: 't1', type: 'tab', data: { title: 'Alpha' }, parent: 'tabs1', content: ['p1'] },
      { id: 'p1', type: 'paragraph', data: { text: 'Alpha body' }, parent: 't1' },
      { id: 't2', type: 'tab', data: { title: 'Beta' }, parent: 'tabs1', content: ['p2'] },
      { id: 'p2', type: 'paragraph', data: { text: 'secret needle' }, parent: 't2' },
    ]);

    await expect(page.getByText('secret needle')).toBeHidden();
    await page.getByText('Alpha body', { exact: true }).click();

    await page.keyboard.press('ControlOrMeta+f');
    await expect(page.getByTestId('find-input')).toBeFocused();
    await page.getByTestId('find-input').fill('needle');
    // The search is debounced: Enter before it lands has no match to step to.
    await expect(page.getByTestId('find-counter')).toHaveText('1 of 1');
    await expect(tab(page, 'Beta')).toHaveAttribute('aria-selected', 'false');

    await page.keyboard.press('Enter');

    await expect(tab(page, 'Beta')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('secret needle')).toBeVisible();
  });
});
