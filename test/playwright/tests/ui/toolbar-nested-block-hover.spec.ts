import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const SETTINGS_TOGGLER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const CELL_SELECTOR = '[data-blok-table-cell]';

declare global {
  interface Window {
    blokInstance?: Blok;
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
    container.style.width = '700px';
    container.style.margin = '40px auto';

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlokWithData = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokBlocks }) => {
      const tableClass = (window.Blok as unknown as Record<string, unknown>).Table;
      const blok = new window.Blok({
        holder,
        tools: {
          table: { class: tableClass },
        },
        data: { blocks: blokBlocks },
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokBlocks: blocks }
  );
};

/**
 * The block whose holder currently hosts the toolbar — the toolbar wrapper is
 * mounted inside the hovered block's holder, so this is the anchor identity.
 */
const toolbarAnchorId = async (page: Page): Promise<string | null> => {
  return page.evaluate(() => {
    const toolbar = document.querySelector('[data-blok-testid="toolbar"]');

    return toolbar?.closest('[data-blok-id]')?.getAttribute('data-blok-id') ?? null;
  });
};

const sectionWithTableBlocks = (): OutputData['blocks'] => [
  {
    id: 'sec',
    type: 'header',
    data: { text: 'How to add custom text', level: 2, isToggleable: true, isOpen: true },
    content: ['tbl', 'para'],
  },
  {
    id: 'tbl',
    type: 'table',
    data: { withHeadings: false, content: [['', '', '']] },
    parent: 'sec',
  },
  {
    id: 'para',
    type: 'paragraph',
    data: { text: 'To set up custom text, fill in the key.' },
    parent: 'sec',
  },
];

test.describe('ui.toolbar-nested-block-hover', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('table menu inside a toggle heading section stays catchable along the whole approach path', async ({ page }) => {
    await createBlokWithData(page, sectionWithTableBlocks());

    const firstCell = page.locator(CELL_SELECTOR).first();

    await firstCell.hover();
    await expect.poll(() => toolbarAnchorId(page)).toBe('tbl');

    const toggler = page.locator(SETTINGS_TOGGLER_SELECTOR);

    await expect(toggler).toBeVisible();

    const cellBox = await firstCell.boundingBox();
    const togglerBox = await toggler.boundingBox();

    if (!cellBox || !togglerBox) {
      throw new Error('Could not measure cell or settings toggler');
    }

    /**
     * Walk the pointer from inside the first cell to the settings toggler in
     * small steps, crossing the td padding and the section's gutter strip —
     * the exact path on which the toolbar used to jump to the heading.
     */
    const startX = cellBox.x + cellBox.width / 2;
    const y = cellBox.y + cellBox.height / 2;
    const endX = togglerBox.x + togglerBox.width / 2;
    const steps = 12;

    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(startX + ((endX - startX) * i) / steps, y);
      await expect.poll(() => toolbarAnchorId(page)).toBe('tbl');
    }

    await toggler.click();

    await expect(page.getByRole('menuitem', { name: /delete/i })).toBeVisible();
    await expect.poll(() => toolbarAnchorId(page)).toBe('tbl');
  });

  test('a toggle section child paragraph owns its block menu', async ({ page }) => {
    await createBlokWithData(page, sectionWithTableBlocks());

    await page.locator('[data-blok-id="para"]').getByText('To set up custom text').hover();

    await expect.poll(() => toolbarAnchorId(page)).toBe('para');
  });

  test('the heading line still owns the section menu', async ({ page }) => {
    await createBlokWithData(page, sectionWithTableBlocks());

    await page.getByRole('heading', { level: 2, name: 'How to add custom text' }).hover();

    await expect.poll(() => toolbarAnchorId(page)).toBe('sec');
  });

  test('hovering the section gutter strip at a child line anchors that child', async ({ page }) => {
    await createBlokWithData(page, sectionWithTableBlocks());

    const paragraph = page.locator('[data-blok-id="para"]');
    const paraBox = await paragraph.boundingBox();

    if (!paraBox) {
      throw new Error('Could not measure paragraph');
    }

    /**
     * The strip between the section's left edge and the child's own left edge
     * belongs to the toggle container — hovering it at the child's line must
     * anchor the child, like Notion's margin hover.
     */
    await page.mouse.move(paraBox.x - 10, paraBox.y + paraBox.height / 2);

    await expect.poll(() => toolbarAnchorId(page)).toBe('para');
  });

  test('a toggle list child owns its block menu', async ({ page }) => {
    await createBlokWithData(page, [
      { id: 'tgl', type: 'toggle', data: { text: 'Toggle summary', isOpen: true }, content: ['child'] },
      { id: 'child', type: 'paragraph', data: { text: 'Toggle child paragraph' }, parent: 'tgl' },
    ]);

    await page.getByText('Toggle child paragraph').hover();

    await expect.poll(() => toolbarAnchorId(page)).toBe('child');
  });

  test('callout first child still resolves to the callout, later children own their menus', async ({ page }) => {
    await createBlokWithData(page, [
      { id: 'call', type: 'callout', data: { emoji: '💡' }, content: ['c1', 'c2'] },
      { id: 'c1', type: 'paragraph', data: { text: 'Callout first line' }, parent: 'call' },
      { id: 'c2', type: 'paragraph', data: { text: 'Callout second line' }, parent: 'call' },
    ]);

    await page.getByText('Callout first line').hover();
    await expect.poll(() => toolbarAnchorId(page)).toBe('call');

    await page.getByText('Callout second line').hover();
    await expect.poll(() => toolbarAnchorId(page)).toBe('c2');
  });

  test('page-margin hover beside a nested table anchors the table, not the section', async ({ page }) => {
    await createBlokWithData(page, sectionWithTableBlocks());

    const table = page.locator('[data-blok-id="tbl"]');
    const tableBox = await table.boundingBox();
    const editor = page.locator(`#${HOLDER_ID}`);
    const editorBox = await editor.boundingBox();

    if (!tableBox || !editorBox) {
      throw new Error('Could not measure table or editor');
    }

    await page.mouse.move(editorBox.x - 40, tableBox.y + tableBox.height / 2);

    await expect.poll(() => toolbarAnchorId(page)).toBe('tbl');
  });

  test('collapsed section children never claim the margin hover', async ({ page }) => {
    await createBlokWithData(page, [
      {
        id: 'sec',
        type: 'header',
        data: { text: 'Collapsed section', level: 2, isToggleable: true, isOpen: false },
        content: ['hidden'],
      },
      { id: 'hidden', type: 'paragraph', data: { text: 'Hidden child' }, parent: 'sec' },
      { id: 'after', type: 'paragraph', data: { text: 'Block after section' } },
    ]);

    const heading = page.getByRole('heading', { level: 2, name: 'Collapsed section' });
    const headingBox = await heading.boundingBox();
    const editorBox = await page.locator(`#${HOLDER_ID}`).boundingBox();

    if (!headingBox || !editorBox) {
      throw new Error('Could not measure heading or editor');
    }

    await page.mouse.move(editorBox.x - 40, headingBox.y + headingBox.height / 2);

    await expect.poll(() => toolbarAnchorId(page)).toBe('sec');
  });
});
