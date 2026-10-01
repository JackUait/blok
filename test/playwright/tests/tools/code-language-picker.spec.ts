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

  test('recolors the code as the hovered language without saving or reporting anything', async ({ page }) => {
    await createBlok(page, [{ type: 'code', data: { code: CODE, language: 'plain text' } }]);
    await openPicker(page);
    await page.evaluate(() => {
      window.codeChanges = 0;
    });

    const layer = page.getByTestId('code-language-preview');

    await expect(layer).toBeHidden();

    await page.getByRole('menuitemradio', { name: /Python/ }).hover();

    await expect(layer).toBeVisible();
    // Prism's own markup; there is no role or test id to read a token by.
    await expect.poll(() => layer.evaluate((el) => el.querySelector('[class~="keyword"]')?.textContent)).toBe('def');
    await expect(layer).toHaveText(CODE);
    // The editable code stays plain: the preview is a layer, not an edit.
    expect(await page.getByTestId('code-content').evaluate((el) => el.querySelectorAll('[class~="token"]').length)).toBe(0);
    expect(await savedCode(page)).toMatchObject({ language: 'plain text', code: CODE });
    expect(await page.evaluate(() => window.codeChanges)).toBe(0);

    await page.keyboard.press('Escape');

    await expect(layer).toBeHidden();
    expect(await savedCode(page)).toMatchObject({ language: 'plain text' });
  });

  test('keeps the language picked with the keyboard and clears the preview', async ({ page }) => {
    await createBlok(page, [{ type: 'code', data: { code: CODE, language: 'plain text' } }]);
    await openPicker(page);

    await page.keyboard.type('py');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('code-language-name')).toHaveText('Python');
    await expect(page.getByTestId('code-language-preview')).toBeHidden();
    expect(await savedCode(page)).toMatchObject({ language: 'python' });
  });

  test('finds a language by its short name or extension', async ({ page }) => {
    await createBlok(page, [{ type: 'code', data: { code: 'x', language: 'plain text' } }]);
    await openPicker(page);

    await page.keyboard.type('golang');
    await expect(page.getByRole('menuitemradio', { name: /^Go/ })).toBeVisible();
    await expect(page.getByRole('menuitemradio', { name: /Python/ })).toBeHidden();
  });

  test('suggests the language of the filename and remembers recent picks', async ({ page }) => {
    await createBlok(page, [
      { type: 'code', data: { code: 'x', language: 'plain text', filename: 'main.rs' } },
      { type: 'code', data: { code: 'y', language: 'plain text' } },
    ]);
    await openPicker(page);

    const sections = page.getByTestId('code-language-section').filter({ visible: true });
    const options = page.getByRole('menuitemradio').filter({ visible: true });

    await expect(sections).toHaveText(['Suggested']);
    await expect(options.first()).toContainText('Rust');

    await page.getByRole('menuitemradio', { name: /Kotlin/ }).click();
    await openPicker(page, 1);

    await expect(sections).toHaveText(['Suggested']);
    await expect(options.first()).toContainText('Kotlin');
  });
});
