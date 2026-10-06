import type { Page } from '@playwright/test';
import type { OutputData } from '@/types';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { ensureBlokBundleBuilt, createBlok, saveBlok } from './columns-blocks/_helpers';

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const TOC = '[data-blok-toc]';

const filler = (prefix: string, count: number): OutputData['blocks'] =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}`, type: 'paragraph', data: { text: `${prefix} line ${i}` } }));

const longDocument: OutputData = {
  blocks: [
    { id: 'toc', type: 'table_of_contents', data: {} },
    { id: 'h-intro', type: 'header', data: { text: 'Introduction', level: 1 } },
    ...filler('intro', 30),
    { id: 'h-setup', type: 'header', data: { text: 'Setup', level: 2 } },
    ...filler('setup', 30),
    { id: 'h-deep', type: 'header', data: { text: 'Deep <b>dive</b>', level: 3 } },
    ...filler('deep', 30),
  ],
};

const entries = (page: Page) => page.locator(TOC).getByRole('link');

const blockCount = async (page: Page): Promise<number> =>
  page.evaluate(() => window.blokInstance?.blocks.getBlocksCount() ?? -1);

test.describe('Table of contents block', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('inserting from the slash menu lists the headings already on the page', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'p0', type: 'paragraph', data: { text: '' } },
        { id: 'h1', type: 'header', data: { text: 'Goals', level: 2 } },
        { id: 'h2', type: 'header', data: { text: 'Risks', level: 3 } },
      ],
    });

    await page.locator('[data-blok-interface=blok] [contenteditable]').first().focus();
    await page.keyboard.type('/toc');

    const popover = page.getByTestId('toolbox-popover');

    await expect(popover).toHaveAttribute('data-blok-popover-opened', 'true');
    await popover.locator('[data-blok-item-name="table_of_contents"]').click();

    await expect(page.getByRole('navigation', { name: 'Table of contents' })).toBeVisible();
    await expect(entries(page)).toHaveText(['Goals', 'Risks']);

    const saved = await saveBlok(page);

    expect(saved.blocks.find((block) => block.type === 'table_of_contents')?.data).toEqual({});
  });

  test('shows the empty hint on a page without headings', async ({ page }) => {
    await createBlok(page, { blocks: [ { id: 'toc', type: 'table_of_contents', data: {} } ] });

    await expect(page.locator(TOC).getByText('Add headings to create a table of contents.')).toBeVisible();
    await expect(entries(page)).toHaveCount(0);
  });

  test('follows headings as they are typed, renamed and deleted', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'toc', type: 'table_of_contents', data: {} },
        { id: 'h1', type: 'header', data: { text: 'Plan', level: 2 } },
      ],
    });

    await expect(entries(page)).toHaveText(['Plan']);

    const heading = page.getByRole('heading', { name: 'Plan' });

    await heading.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' B');
    await expect(entries(page)).toHaveText(['Plan B']);

    await page.evaluate(() => window.blokInstance?.blocks.insert('header', { text: 'Later', level: 3 }));
    await expect(entries(page)).toHaveText(['Plan B', 'Later']);

    await page.evaluate(() => window.blokInstance?.blocks.delete(1));
    await expect(entries(page)).toHaveText(['Later']);
  });

  test('lists headings inside columns and callouts but not inside toggles', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'toc', type: 'table_of_contents', data: {} },
        { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['left'] },
        { id: 'left', type: 'header', data: { text: 'Left', level: 2 }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['right'] },
        { id: 'right', type: 'header', data: { text: 'Right', level: 2 }, parent: 'c2' },
        { id: 'tg', type: 'toggle', data: { text: 'More', isOpen: true }, content: ['hidden'] },
        { id: 'hidden', type: 'header', data: { text: 'Folded', level: 2 }, parent: 'tg' },
      ],
    });

    await expect(page.getByRole('heading', { name: 'Folded' })).toBeVisible();
    await expect(entries(page)).toHaveText(['Left', 'Right']);
  });

  test('@smoke clicking an entry brings its heading to the top without editing the page', async ({ page }) => {
    await createBlok(page, longDocument);

    const before = await blockCount(page);

    await entries(page).filter({ hasText: 'Deep dive' }).click();

    const deep = page.getByRole('heading', { name: 'Deep dive' });

    await expect.poll(async () => deep.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBeLessThan(120);
    expect(await blockCount(page)).toBe(before);
    expect(new URL(page.url()).hash).toBe('');
  });

  test('Enter on a focused entry jumps and never inserts a block', async ({ page }) => {
    await createBlok(page, longDocument);

    const before = await blockCount(page);

    await entries(page).filter({ hasText: 'Setup' }).focus();
    await page.keyboard.press('Enter');

    const setup = page.getByRole('heading', { name: 'Setup' });

    await expect.poll(async () => setup.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBeLessThan(120);
    expect(await blockCount(page)).toBe(before);
  });

  test('Backspace after a jump keeps the heading', async ({ page }) => {
    await createBlok(page, longDocument);

    await entries(page).filter({ hasText: 'Setup' }).click();
    await page.keyboard.press('Backspace');

    await expect(page.getByRole('heading', { name: 'Setup' })).toHaveCount(1);
  });

  test('jumping selects no heading, so Backspace after leaving the outline deletes none', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'toc', type: 'table_of_contents', data: {} },
        { id: 'after', type: 'paragraph', data: { text: 'Read me' } },
        ...longDocument.blocks.slice(1),
      ],
    });

    const before = await blockCount(page);

    await entries(page).first().focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.keyboard.press('End');
    await page.keyboard.press('Tab');
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');

    expect(await blockCount(page)).toBe(before);
    await expect(page.getByRole('heading', { name: 'Introduction' })).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Setup' })).toHaveCount(1);
  });

  test('a keyboard user reaches the entries from the block above', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'p0', type: 'paragraph', data: { text: 'Start here' } },
        { id: 'toc', type: 'table_of_contents', data: {} },
        { id: 'h1', type: 'header', data: { text: 'Goals', level: 2 } },
      ],
    });

    await page.getByText('Start here').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(entries(page).first()).toBeFocused();
  });

  test('arrow keys walk the entries', async ({ page }) => {
    await createBlok(page, longDocument);

    await entries(page).first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(entries(page).nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(entries(page).last()).toBeFocused();
  });

  test('hovering an entry opens no link card, while an ordinary link still gets one', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'toc', type: 'table_of_contents', data: {} },
        { id: 'h', type: 'header', data: { text: 'Intro', level: 2 } },
        { id: 'p', type: 'paragraph', data: { text: 'See <a href="https://example.com">example</a>.' } },
      ],
    });

    const watch = page.evaluate(() => new Promise<boolean>((resolve) => {
      const seen = (): boolean => document.querySelector('[data-blok-testid="link-hover-card"]') !== null;
      const observer = new MutationObserver(() => {
        if (seen()) {
          observer.disconnect();
          resolve(true);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        resolve(seen());
      }, 1200);
    }));

    await entries(page).first().hover();
    expect(await watch).toBe(false);

    await page.getByText('example').hover();
    await expect(page.getByTestId('link-hover-card')).toBeVisible();
  });

  test('marks the section being read as the current location while scrolling', async ({ page }) => {
    await createBlok(page, longDocument);

    await expect(page.locator('[data-blok-toc-link][aria-current]')).toHaveCount(0);

    await page.getByRole('heading', { name: 'Setup' }).evaluate((el) => {
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 40, behavior: 'instant' });
    });

    await expect(page.locator('[data-blok-toc-link][aria-current="location"]')).toHaveText('Setup');
  });

  test('works read-only', async ({ page }) => {
    await createBlok(page, longDocument);
    await page.evaluate(async () => {
      await window.blokInstance?.readOnly.toggle(true);
    });

    await expect(entries(page)).toHaveText(['Introduction', 'Setup', 'Deep dive']);
    await entries(page).filter({ hasText: 'Setup' }).click();

    const setup = page.getByRole('heading', { name: 'Setup' });

    await expect.poll(async () => setup.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBeLessThan(120);
  });
});
