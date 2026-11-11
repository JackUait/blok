import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
    codeChanges?: number;
  }
}

test.beforeAll(ensureBlokBundleBuilt);

const createBlok = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await page.evaluate(async ({ holder, blokBlocks }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    localStorage.removeItem('blok:code:recent-languages');

    const container = document.createElement('div');

    container.id = holder;
    container.style.width = '640px';
    document.body.appendChild(container);
    window.codeChanges = 0;

    const blok = new window.Blok({
      holder,
      data: { blocks: blokBlocks },
      onChange: () => {
        window.codeChanges = (window.codeChanges ?? 0) + 1;
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blokBlocks: blocks });
};

const CODE = 'def greet(name):\n    return name';

const savedCode = async (page: Page): Promise<Record<string, unknown> | undefined> =>
  page.evaluate(async () => (await window.blokInstance?.save())?.blocks[0].data);

const openPicker = async (page: Page, index = 0): Promise<void> => {
  await page.getByTestId('code-content').nth(index).hover();
  await page.getByTestId('code-language-btn').nth(index).click();
  await expect(page.getByRole('menuitemradio', { name: /JavaScript/ })).toBeVisible();
};

test.describe('code language picker', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('hovering a language leaves the code as it is; only a pick recolors it', async ({ page }) => {
    await createBlok(page, [{ type: 'code', data: { code: CODE, language: 'plain text' } }]);
    await openPicker(page);

    await page.getByRole('menuitemradio', { name: /Python/ }).hover();
    await page.keyboard.press('ArrowDown');

    expect(await page.getByTestId('code-language-preview').count()).toBe(0);
    // Prism's own markup; there is no role or test id to read a token by.
    expect(await page.getByTestId('code-card').evaluate((el) => el.querySelectorAll('[class~="token"]').length)).toBe(0);
    expect(await savedCode(page)).toMatchObject({ language: 'plain text', code: CODE });
  });

  test('keeps the language picked with the keyboard', async ({ page }) => {
    await createBlok(page, [{ type: 'code', data: { code: CODE, language: 'plain text' } }]);
    await openPicker(page);

    await page.keyboard.type('py');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('code-language-name')).toHaveText('Python');
    expect(await savedCode(page)).toMatchObject({ language: 'python' });
  });

  test('finds a language by its short name or extension', async ({ page }) => {
    await createBlok(page, [{ type: 'code', data: { code: 'x', language: 'plain text' } }]);
    await openPicker(page);

    await page.keyboard.type('golang');
    await expect(page.getByRole('menuitemradio', { name: /^Go/ })).toBeVisible();
    await expect(page.getByRole('menuitemradio', { name: /Python/ })).toBeHidden();
  });

  test('groups languages by family, Docs & diagrams first, with no Suggested section', async ({ page }) => {
    await createBlok(page, [{ type: 'code', data: { code: 'x', language: 'plain text', filename: 'main.rs' } }]);
    await openPicker(page);

    const labels = page.getByTestId('code-language-section').locator('[data-label]');

    await expect(labels).toHaveText(['Docs & diagrams', 'Web', 'Systems & apps', 'Scripting', 'Data & config']);
    await expect(page.getByRole('menuitemradio').first()).toContainText('Markdown');
  });

  test('scrolls flat: no row squashes at the edges, and the family label stays pinned on top', async ({ page }) => {
    await createBlok(page, [{ type: 'code', data: { code: 'x', language: 'plain text' } }]);
    await openPicker(page);

    const list = page.locator('[data-blok-testid="code-language-section"]').first().locator('xpath=ancestor::*[contains(@class,"overflow-y-auto")][1]');

    await list.evaluate((el) => el.scrollTo({ top: 150 }));

    const readState = (): Promise<{ scrolled: number; transformed: number; pinned: number }> => list.evaluate((el) => {
      const top = el.getBoundingClientRect().top;
      const transformed = Array.from(el.children).filter((child) => child instanceof HTMLElement && child.style.transform !== '').length;
      const pinned = Array.from(el.querySelectorAll('[data-blok-testid="code-language-section"]'))
        .map((label) => label.getBoundingClientRect().top - top)
        .filter((offset) => Math.abs(offset) < 1).length;

      return { scrolled: el.scrollTop, transformed, pinned };
    });

    await expect.poll(async () => (await readState()).scrolled).toBe(150);

    const state = await readState();

    expect(state.transformed).toBe(0);
    expect(state.pinned).toBeGreaterThanOrEqual(1);
  });
});
