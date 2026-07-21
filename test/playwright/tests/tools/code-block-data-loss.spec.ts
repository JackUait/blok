import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

/**
 * Regression suite for three independent silent-data-loss defects, each of
 * which destroyed user content with no error and no way to recover it.
 *
 * 1. Code containing `<` was corrupted on render. The sanitizer's URL-scheme
 *    pass round-tripped every string through `template.innerHTML`, which is a
 *    parser, not a transform: it entity-encoded bare `<`/`&` and DELETED text
 *    shaped like a stray end tag. `if (a<b) { }` became `if (a`. This fired in
 *    read-only render with zero user action and persisted on the next save.
 *
 * 2. Empty code blocks were dropped on save. `CodeTool.validate()` returned
 *    false for whitespace-only code, and the Saver drops invalid blocks — so
 *    an intentionally empty code block vanished.
 *
 * 3. A document whose only block was `/` saved as `{ blocks: [] }`.
 *    `Block.isEmpty` passed '/' as `ignoreChars`, and the underlying helper
 *    strips EVERY occurrence before measuring length, so a slash-only block
 *    reported empty and hit the Saver's single-empty-default-block
 *    short-circuit.
 */

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, data?: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder, initialData }) => {
      const blok = new window.Blok({ holder, ...(initialData ? { data: initialData } : {}) });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data ?? null }
  );
};

const save = (page: Page): Promise<OutputData> =>
  page.evaluate(async () => {
    const saved = await window.blokInstance?.save();

    return saved as OutputData;
  });

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
});

test.describe('code block data loss', () => {
  /**
   * Each string is a plausible line of real source that the innerHTML
   * round-trip mangled. The `</div>` and `if (a<b)` cases were unrecoverable:
   * the content was deleted, not merely escaped.
   */
  const HOSTILE_SNIPPETS = [
    'for (let i = 0; i < n; i++) { sum += i; }',
    'if (a<b) { return a; }',
    '</div>',
    'a & b < c',
    '5 < 6 && 7 > 8',
  ];

  for (const code of HOSTILE_SNIPPETS) {
    test(`preserves code containing angle brackets verbatim: ${JSON.stringify(code)}`, async ({ page }) => {
      await createBlok(page, {
        blocks: [ { type: 'code',
          data: { code,
            language: 'javascript',
            lineNumbers: false } } ],
      });

      const rendered = await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>('[data-blok-testid="code-content"]');

        return el?.textContent ?? '';
      });

      expect(rendered).toBe(code);

      const saved = await save(page);

      expect(saved.blocks[0].data.code).toBe(code);
    });
  }

  test('keeps an empty code block in saved output', async ({ page }) => {
    await createBlok(page, {
      blocks: [ { type: 'code',
        data: { code: '',
          language: 'javascript',
          lineNumbers: false } } ],
    });

    const saved = await save(page);

    expect(saved.blocks).toHaveLength(1);
    expect(saved.blocks[0].type).toBe('code');
    expect(saved.blocks[0].data.code).toBe('');
  });

  test('keeps a slash-only paragraph in saved output', async ({ page }) => {
    await createBlok(page);

    await page.locator('[data-blok-interface=blok] [contenteditable]').first().click();
    await page.keyboard.type('/');
    await page.keyboard.press('Escape');

    const saved = await save(page);

    expect(saved.blocks).toHaveLength(1);
    expect(saved.blocks[0].data.text).toBe('/');
  });

  test('still saves a genuinely untouched editor as an empty document', async ({ page }) => {
    await createBlok(page);

    const saved = await save(page);

    expect(saved.blocks).toEqual([]);
  });
});
