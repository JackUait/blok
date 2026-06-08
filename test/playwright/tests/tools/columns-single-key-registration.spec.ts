import { expect, test } from '@playwright/test';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await page.goto(TEST_PAGE_URL);
});

test.describe('Columns single-key registration', () => {
  test('registering only `columns` renders and saves a two-type column model', async ({ page }) => {
    // 1. Boot an editor registering ONLY paragraph + the single `columns` group key
    //    (never `column` / `column_list` directly). Inline tools fold into `tools`.
    const ready = await page.evaluate(async () => {
      const win = window as unknown as {
        BlokOriginal: new (cfg: unknown) => {
          isReady: Promise<void>;
          render: (d: unknown) => Promise<void>;
          save: () => Promise<unknown>;
        };
        BlokParagraph: unknown;
        BlokColumns: new (...args: unknown[]) => unknown;
        defaultInlineTools: Record<string, unknown>;
      };

      const holder = document.createElement('div');
      holder.id = 'single-key-editor';
      document.body.appendChild(holder);

      const editor = new win.BlokOriginal({
        holder: 'single-key-editor',
        tools: {
          paragraph: { class: win.BlokParagraph, inlineToolbar: true, config: { preserveBlank: true } },
          // SINGLE KEY — no `column` / `column_list` entries:
          columns: { class: win.BlokColumns },
          // Inline tools fold into the tools map (no separate inlineTools config key).
          ...win.defaultInlineTools,
        },
      });

      await editor.isReady;

      // 2. Render a document with a column_list (2 columns, each with a paragraph).
      //    Field names match the public OutputData format: `content` and `parent`.
      await editor.render({
        blocks: [
          { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
          { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1'] },
          { id: 'p1', type: 'paragraph', data: { text: 'left' }, parent: 'c1' },
          { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
          { id: 'p2', type: 'paragraph', data: { text: 'right' }, parent: 'c2' },
        ],
      });

      (window as unknown as { __editor: unknown }).__editor = editor;
      return true;
    });

    expect(ready).toBe(true);

    // 3. Assert the REAL column tools rendered (not stubs).
    //    Stub blocks never carry data-blok-columns / data-blok-column.
    await expect(page.locator('[data-blok-columns]')).toHaveCount(1);
    await expect(page.locator('[data-blok-column]')).toHaveCount(2);
    await expect(page.getByText('left')).toBeVisible();
    await expect(page.getByText('right')).toBeVisible();

    // 4. Save and assert the model is still TWO block types — never `columns`.
    const saved = await page.evaluate(async () => {
      const editor = (window as unknown as { __editor: { save: () => Promise<unknown> } }).__editor;
      return editor.save();
    }) as OutputData;

    const types = saved.blocks.map(b => b.type);
    expect(types.filter(t => t === 'column_list')).toHaveLength(1);
    expect(types.filter(t => t === 'column')).toHaveLength(2);
    // `columns` is a registration handle, never a saved block type:
    expect(types).not.toContain('columns');
  });
});
