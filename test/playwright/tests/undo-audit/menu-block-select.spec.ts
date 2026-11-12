/**
 * Block menu actions leave their result block-selected, with no caret, like
 * Notion (U084-U090, U105, U123, U161). The next Backspace, Delete or typed
 * key then acts on that selection, and that is one undo step of its own.
 */
import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
// Past the capture window, so gestures stay separate steps.
const CAPTURE_GAP = 800;
const HANDLE = '[data-blok-interface=blok] [data-blok-testid="settings-toggler"]';
const TUNES_POPOVER = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const NESTED_POPOVER = '[data-blok-nested="true"] [data-blok-testid="popover-container"]';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type SavedBlock = OutputData['blocks'][number];

/** `classCode` maps a tool name to its class source, run in the page. */
const createBlok = async (page: Page, blocks: SavedBlock[], classCode: Record<string, string> = {}): Promise<void> => {
  await page.evaluate(async ({ holder, initial, sources }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const tools = Object.fromEntries(Object.entries(sources).map(([name, code]) => {
      // eslint-disable-next-line no-new-func -- the tool class arrives as source text
      const makeToolClass = new Function(`return (${code});`) as () => unknown;
      const toolClass = makeToolClass();

      return [name, { class: toolClass }];
    }));
    const blok = new window.Blok({ holder, data: { blocks: initial }, tools });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initial: blocks, sources: classCode });
};

/** Each top-level block as `type:text`, in saved order. */
const saved = async (page: Page): Promise<string[]> => page.evaluate(async () => {
  if (!window.blokInstance) {
    throw new Error('no blok');
  }

  return (await window.blokInstance.save()).blocks.filter((block) => block.parent === undefined).map((block) => {
    const data = block.data as { withHeadings?: boolean };
    const text = document.querySelector(`[data-blok-id="${block.id ?? ''}"] [contenteditable="true"]`)?.textContent ?? '';

    return block.type === 'table' ? `table:${String(data.withHeadings)}` : `${block.type}:${text}`;
  });
});

const gap = async (page: Page, ms = CAPTURE_GAP): Promise<void> => {
  await page.evaluate(async (t) => {
    await new Promise<void>(resolve => {
      window.setTimeout(resolve, t);
    });
  }, ms);
};

const selectedIds = async (page: Page): Promise<string[]> => page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-blok-testid="block-wrapper"][data-blok-selected="true"]'))
    .map(el => el.getAttribute('data-blok-id') ?? ''));

/** True when a text caret or range sits inside the editor. */
const hasCaret = async (page: Page): Promise<boolean> => page.evaluate((holder) => {
  const root = document.getElementById(holder);
  const selection = window.getSelection();
  const active = document.activeElement;
  const rangeInside = selection !== null && selection.rangeCount > 0 && root !== null && root.contains(selection.anchorNode);
  const editableFocused = active instanceof HTMLElement && active.isContentEditable;

  return rangeInside || editableFocused;
}, HOLDER_ID);

const editable = (page: Page, id: string): Locator => page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

/**
 * Open the block menu for block `id`: hover points of its content box until
 * the menu opens for that block.
 */
const openTunes = async (page: Page, id: string): Promise<void> => {
  const box = await page.locator(`[data-blok-id="${id}"] [data-blok-element-content]`).first().boundingBox();

  if (box === null) {
    throw new Error(`no box for ${id}`);
  }
  const points = [[0.5, 0.5], [0.1, 0.1], [0.5, 0.05], [0.9, 0.5]];

  for (const [fx, fy] of points) {
    await page.mouse.move(box.x + box.width * fx, box.y + Math.min(box.height * fy, box.height - 2));
    const handle = page.locator(HANDLE);

    if (!(await handle.isVisible())) {
      continue;
    }
    await handle.click();
    await expect(page.locator(TUNES_POPOVER)).toBeVisible();
    if (await page.locator(`[data-blok-id="${id}"][data-blok-selected="true"]`).count() > 0) {
      return;
    }
    await page.keyboard.press('Escape');
    await gap(page, 200);
  }
  throw new Error(`could not open the block menu for ${id}`);
};

const tune = (page: Page, name: string): Locator =>
  page.locator(`${TUNES_POPOVER} [data-blok-testid="popover-item"][data-blok-item-name="${name}"]`);

const nested = (page: Page, name: string): Locator =>
  page.locator(NESTED_POPOVER).getByRole('menuitem', { name, exact: true });

const convert = async (page: Page, id: string, to: string): Promise<void> => {
  await openTunes(page, id);
  await tune(page, 'convert-to').click();
  await nested(page, to).click();
  await expect(page.locator(TUNES_POPOVER)).toBeHidden();
};

const P = (id: string, text: string): SavedBlock => ({ id, type: 'paragraph', data: { text } });

const BASE = [P('p-before', 'before'), P('p1', 'Alpha'), P('p2', 'Beta'), P('p-after', 'after')];

const tableBlocks = (): SavedBlock[] => {
  const cols = ['colA', 'colB'];
  const kids: SavedBlock[] = [];
  const content = ['row1', 'row2'].map((rowId, r) => cols.map((colId, c) => {
    const id = `c${r}${c}`;

    kids.push({ id, type: 'paragraph', data: { text: `${'AB'[c]}${r + 1}` }, parent: 'tbl' });

    return { blocks: [id], id: colId, rowId };
  }));

  return [
    P('p-before', 'before'),
    { id: 'tbl', type: 'table', data: { withHeadings: false, withHeadingColumn: false, content }, content: kids.map(k => k.id ?? '') },
    ...kids,
    P('p-after', 'after'),
  ];
};

test.describe('block menu actions leave a block selection (D3)', () => {
  // Several capture gaps per test; the default 15s is tight on a loaded CI runner.
  test.describe.configure({ timeout: 30_000 });
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('Turn into leaves the converted block selected, with no caret', async ({ page }) => {
    await createBlok(page, BASE);
    await editable(page, 'p1').click();
    await gap(page);
    await convert(page, 'p1', 'Heading 1');

    await expect.poll(() => saved(page)).toEqual(['paragraph:before', 'header:Alpha', 'paragraph:Beta', 'paragraph:after']);
    await expect.poll(() => selectedIds(page)).toHaveLength(1);
    expect(await hasCaret(page)).toBe(false);
    const [selected] = await selectedIds(page);

    await expect(page.locator(`[data-blok-id="${selected}"]`)).toHaveAttribute('data-blok-component', 'header');
  });

  for (const key of ['Backspace', 'Delete', 'x'] as const) {
    test(`${key} after Turn into acts on the selection as one undo step`, async ({ page }) => {
      await createBlok(page, BASE);
      await editable(page, 'p1').click();
      await gap(page);
      await convert(page, 'p1', 'Heading 1');
      await expect.poll(() => selectedIds(page)).toHaveLength(1);
      await gap(page);

      await page.keyboard.press(key);
      const afterKey = key === 'x'
        ? ['paragraph:before', 'paragraph:x', 'paragraph:Beta', 'paragraph:after']
        : ['paragraph:before', 'paragraph:Beta', 'paragraph:after'];

      await expect.poll(() => saved(page)).toEqual(afterKey);
      await gap(page);

      await page.keyboard.press(UNDO);
      await expect.poll(() => saved(page)).toEqual(['paragraph:before', 'header:Alpha', 'paragraph:Beta', 'paragraph:after']);
      await gap(page, 500);

      await page.keyboard.press(UNDO);
      await expect.poll(() => saved(page)).toEqual(['paragraph:before', 'paragraph:Alpha', 'paragraph:Beta', 'paragraph:after']);
    });
  }

  test('ArrowDown moves the selection left by Turn into to the next block', async ({ page }) => {
    await createBlok(page, BASE);
    await editable(page, 'p1').click();
    await gap(page);
    await convert(page, 'p1', 'Heading 1');
    await expect.poll(() => selectedIds(page)).toHaveLength(1);

    await page.keyboard.press('ArrowDown');

    await expect.poll(() => selectedIds(page)).toEqual(['p2']);
    expect(await saved(page)).toEqual(['paragraph:before', 'header:Alpha', 'paragraph:Beta', 'paragraph:after']);
  });

  test('Turn into on two selected blocks leaves both selected', async ({ page }) => {
    await createBlok(page, BASE);
    await editable(page, 'p1').click();
    await page.keyboard.press('Shift+ArrowDown');
    await expect.poll(() => selectedIds(page)).toEqual(['p1', 'p2']);
    await gap(page);

    await openTunes(page, 'p1');
    await tune(page, 'convert-to').click();
    await nested(page, 'Heading 2').click();

    await expect.poll(() => saved(page)).toEqual(['paragraph:before', 'header:Alpha', 'header:Beta', 'paragraph:after']);
    await expect.poll(() => selectedIds(page)).toHaveLength(2);
    expect(await hasCaret(page)).toBe(false);
    await gap(page);

    await page.keyboard.press('Backspace');
    await expect.poll(() => saved(page)).toEqual(['paragraph:before', 'paragraph:after']);
    await gap(page);

    await page.keyboard.press(UNDO);
    await expect.poll(() => saved(page)).toEqual(['paragraph:before', 'header:Alpha', 'header:Beta', 'paragraph:after']);
  });

  test('Duplicate leaves the copy selected, and Backspace on it is one undo step', async ({ page }) => {
    await createBlok(page, BASE);
    await editable(page, 'p1').click();
    await gap(page);
    await openTunes(page, 'p1');
    await tune(page, 'duplicate').click();

    await expect.poll(() => saved(page)).toEqual(['paragraph:before', 'paragraph:Alpha', 'paragraph:Alpha', 'paragraph:Beta', 'paragraph:after']);
    await expect.poll(() => selectedIds(page)).toHaveLength(1);
    const [copy] = await selectedIds(page);

    expect(copy).not.toBe('p1');
    expect(await hasCaret(page)).toBe(false);
    await gap(page);

    await page.keyboard.press('Backspace');
    await expect.poll(() => page.locator(`[data-blok-id="${copy}"]`).count()).toBe(0);
    expect(await saved(page)).toEqual(['paragraph:before', 'paragraph:Alpha', 'paragraph:Beta', 'paragraph:after']);
    await gap(page);

    await page.keyboard.press(UNDO);
    await expect.poll(() => page.locator(`[data-blok-id="${copy}"]`).count()).toBe(1);
    await gap(page, 500);

    await page.keyboard.press(UNDO);
    await expect.poll(() => page.locator(`[data-blok-id="${copy}"]`).count()).toBe(0);
    expect(await page.locator('[data-blok-id="p1"]').count()).toBe(1);
  });

  test('a table menu action leaves the table selected', async ({ page }) => {
    await createBlok(page, tableBlocks());
    await editable(page, 'p-before').click();
    await gap(page);

    await openTunes(page, 'tbl');
    await tune(page, 'table-heading-row').click();

    await expect.poll(async () => (await saved(page)).includes('table:true')).toBe(true);
    await expect.poll(() => selectedIds(page)).toEqual(['tbl']);
    expect(await hasCaret(page)).toBe(false);
  });

  test('U161: Header row and Header column switch in place, the menu stays open, and Escape, undo and redo keep the table selected', async ({ page }) => {
    const headers = async (): Promise<string> => page.evaluate(async () => {
      if (!window.blokInstance) {
        throw new Error('no blok');
      }
      const table = (await window.blokInstance.save()).blocks.find((block) => block.id === 'tbl');
      const data = (table?.data ?? {}) as { withHeadings?: boolean; withHeadingColumn?: boolean };

      return `row:${String(data.withHeadings)} col:${String(data.withHeadingColumn)}`;
    });
    // Menu rows take a virtual cursor; DOM focus stays on the menu.
    const focusedItem = async (): Promise<string | null> => page.evaluate(() =>
      document.querySelector('[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-item"][data-blok-focused="true"]')
        ?.getAttribute('data-blok-item-name') ?? null);
    const expectTableSelected = async (): Promise<void> => {
      await expect.poll(() => selectedIds(page)).toEqual(['tbl']);
      expect(await hasCaret(page)).toBe(false);
    };

    await createBlok(page, tableBlocks());
    await editable(page, 'p-before').click();
    await gap(page);

    await openTunes(page, 'tbl');
    await tune(page, 'table-heading-row').click();
    await expect.poll(headers).toBe('row:true col:false');
    await expect(page.locator(TUNES_POPOVER)).toBeVisible();
    await expect(tune(page, 'table-heading-row')).toHaveAttribute('data-blok-popover-item-active', 'true');
    expect(await focusedItem()).toBe('table-heading-row');
    await expectTableSelected();
    await gap(page);

    await tune(page, 'table-heading-column').click();
    await expect.poll(headers).toBe('row:true col:true');
    await expect(page.locator(TUNES_POPOVER)).toBeVisible();
    await expect(tune(page, 'table-heading-column')).toHaveAttribute('data-blok-popover-item-active', 'true');
    expect(await focusedItem()).toBe('table-heading-column');
    await gap(page);

    await page.keyboard.press('Escape');
    await expect(page.locator(TUNES_POPOVER)).toBeHidden();
    await expectTableSelected();

    await page.keyboard.press(UNDO);
    await expect.poll(headers).toBe('row:true col:false');
    await expectTableSelected();
    await gap(page, 300);

    await page.keyboard.press(UNDO);
    await expect.poll(headers).toBe('row:false col:false');
    await expectTableSelected();
    await gap(page, 300);

    await page.keyboard.press(REDO);
    await expect.poll(headers).toBe('row:true col:false');
    await expectTableSelected();
  });

  for (const name of ['table-fit-to-page-width', 'table-full-width'] as const) {
    test(`${name} leaves the table selected`, async ({ page }) => {
      await createBlok(page, tableBlocks());
      await editable(page, 'p-before').click();
      await gap(page);

      await openTunes(page, 'tbl');
      await tune(page, name).click();

      await expect.poll(() => selectedIds(page)).toEqual(['tbl']);
      expect(await hasCaret(page)).toBe(false);
    });
  }

  test('keys typed in full screen never reach a kept table selection', async ({ page }) => {
    await createBlok(page, tableBlocks());
    await editable(page, 'p-before').click();
    await gap(page);

    await openTunes(page, 'tbl');
    await tune(page, 'table-open-fullscreen').click();
    await expect(page.getByRole('dialog', { name: 'Table' })).toBeVisible();
    await gap(page, 300);

    await page.keyboard.press('x');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Delete');
    await gap(page, 300);

    expect(await page.locator('[data-blok-id="tbl"]').count()).toBe(1);
    expect(await saved(page)).toContain('table:false');
  });

  test('keys typed in the emoji picker opened by Edit icon never reach a kept selection', async ({ page }) => {
    await createBlok(page, [
      P('p-before', 'before'),
      { id: 'co', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: ['k1'] },
      { id: 'k1', type: 'paragraph', data: { text: 'Note' }, parent: 'co' },
      P('p-after', 'after'),
    ]);
    await editable(page, 'p-before').click();
    await gap(page);

    await openTunes(page, 'co');
    await tune(page, 'callout-edit-icon').click();
    await gap(page, 300);

    await page.keyboard.press('x');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Delete');
    await gap(page, 300);

    expect(await page.locator('[data-blok-id="co"]').count()).toBe(1);
    expect(await page.locator('[data-blok-id="k1"]').textContent()).toContain('Note');
  });

  test('keys typed in a field a tune focuses after a timer never reach a kept selection', async ({ page }) => {
    const lateFocus = `class LateFocus {
      constructor({ data }) { this.data = data; }
      render() {
        this.root = document.createElement('div');
        this.root.innerHTML = '<div contenteditable="true">' + this.data.text + '</div><input aria-label="Late field">';

        return this.root;
      }
      save(root) { return { text: root.querySelector('[contenteditable]').innerHTML }; }
      renderSettings() {
        return [{
          name: 'late-focus',
          title: 'Late focus',
          icon: '<svg></svg>',
          closeOnActivate: true,
          onActivate: () => { setTimeout(() => this.root.querySelector('input').focus(), 50); },
        }];
      }
    }`;

    await createBlok(page, [P('p-before', 'before'), { id: 'late', type: 'late', data: { text: 'Late block' } }, P('p-after', 'after')], { late: lateFocus });
    await editable(page, 'p-before').click();
    await gap(page);

    await openTunes(page, 'late');
    await tune(page, 'late-focus').click();
    await expect(page.getByRole('textbox', { name: 'Late field' })).toBeFocused();

    await page.keyboard.type('ab');
    await page.keyboard.press('Backspace');

    expect(await saved(page)).toEqual(['paragraph:before', 'late:Late block', 'paragraph:after']);
    await expect(page.getByRole('textbox', { name: 'Late field' })).toHaveValue('a');
  });

  test('keys typed in a field a duplicated block focuses after a timer never reach the selected copy', async ({ page }) => {
    const lateRender = `class LateRender {
      constructor({ data }) { this.data = data; }
      render() {
        this.root = document.createElement('div');
        this.root.innerHTML = '<div contenteditable="true">' + this.data.text + '</div><input aria-label="Late field">';

        return this.root;
      }
      rendered() { setTimeout(() => this.root.querySelector('input').focus(), 200); }
      save(root) { return { text: root.querySelector('[contenteditable]').innerHTML }; }
    }`;

    await createBlok(page, [P('p-before', 'before'), { id: 'late', type: 'late', data: { text: 'Late block' } }, P('p-after', 'after')], { late: lateRender });
    await gap(page, 300);
    await editable(page, 'p-before').click();
    await gap(page);

    await openTunes(page, 'late');
    await tune(page, 'duplicate').click();
    await expect(page.getByRole('textbox', { name: 'Late field' }).nth(1)).toBeFocused();

    await page.keyboard.type('ab');

    expect(await saved(page)).toEqual(['paragraph:before', 'late:Late block', 'late:Late block', 'paragraph:after']);
  });

  test('a markdown shortcut conversion keeps the caret (U073)', async ({ page }) => {
    await createBlok(page, [P('p1', '')]);
    await editable(page, 'p1').click();
    await page.keyboard.type('# ');

    await expect.poll(async () => (await saved(page))[0]).toBe('header:');
    expect(await selectedIds(page)).toEqual([]);
    expect(await hasCaret(page)).toBe(true);
  });
});

/** Drag block `id` by its handle to just above block `targetId`. */
const dragAbove = async (page: Page, id: string, targetId: string): Promise<void> => {
  const box = await page.locator(`[data-blok-id="${id}"] [data-blok-element-content]`).first().boundingBox();

  if (box === null) {
    throw new Error(`no box for ${id}`);
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const handle = await page.locator(HANDLE).boundingBox();
  const target = await page.locator(`[data-blok-id="${targetId}"] [data-blok-element-content]`).first().boundingBox();

  if (handle === null || target === null) {
    throw new Error('missing boxes for drag');
  }
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(target.x + target.width / 2, handle.y + (target.y + 2 - handle.y) * i / 8);
  }
  await page.mouse.up();
};

const ids = async (page: Page): Promise<string[]> => page.evaluate(async () =>
  ((await window.blokInstance?.save())?.blocks ?? []).map((block) => block.id ?? ''));

test.describe('undo and redo after a block menu action (FR1, FR2 with D3)', () => {
  test.describe.configure({ timeout: 30_000 });
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('U104: undo of Delete from the block menu gives the block back selected; redo selects nothing', async ({ page }) => {
    await createBlok(page, BASE);
    await editable(page, 'p2').click();
    await page.keyboard.press('End');
    await gap(page);
    await openTunes(page, 'p2');
    await tune(page, 'delete').click();
    await expect.poll(() => ids(page)).toEqual(['p-before', 'p1', 'p-after']);
    await gap(page);

    await page.keyboard.press(UNDO);
    await expect.poll(() => ids(page)).toEqual(['p-before', 'p1', 'p2', 'p-after']);
    await expect.poll(() => selectedIds(page)).toEqual(['p2']);
    expect(await hasCaret(page)).toBe(false);
    await gap(page, 300);

    await page.keyboard.press(REDO);
    await expect.poll(() => ids(page)).toEqual(['p-before', 'p1', 'p-after']);
    expect(await selectedIds(page)).toEqual([]);
    await gap(page, 300);

    await page.keyboard.press(UNDO);
    await expect.poll(() => selectedIds(page)).toEqual(['p2']);
    expect(await hasCaret(page)).toBe(false);
  });

  // The restored selection is in navigation mode, as after Escape, so the key types at the block's end.
  test('U104: a key typed over the restored selection is one step that undo fully restores', async ({ page }) => {
    await createBlok(page, BASE);
    await editable(page, 'p2').click();
    await gap(page);
    await openTunes(page, 'p2');
    await tune(page, 'delete').click();
    await expect.poll(() => ids(page)).toEqual(['p-before', 'p1', 'p-after']);
    await gap(page);
    await page.keyboard.press(UNDO);
    await expect.poll(() => selectedIds(page)).toEqual(['p2']);
    await gap(page);

    await page.keyboard.press('x');
    await expect.poll(async () => (await saved(page)).join('|').match(/x/g)?.length ?? 0).toBe(1);
    await gap(page);

    await page.keyboard.press(UNDO);
    await expect.poll(() => saved(page)).toEqual(['paragraph:before', 'paragraph:Alpha', 'paragraph:Beta', 'paragraph:after']);
    expect(await ids(page)).toEqual(['p-before', 'p1', 'p2', 'p-after']);
  });

  test('U084: undo and redo of Turn into keep the block selected, with no caret', async ({ page }) => {
    await createBlok(page, BASE);
    await editable(page, 'p1').click();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await gap(page);
    await convert(page, 'p1', 'Heading 1');
    await expect.poll(() => selectedIds(page)).toEqual(['p1']);
    await gap(page);

    await page.keyboard.press(UNDO);
    await expect.poll(() => saved(page)).toEqual(['paragraph:before', 'paragraph:Alpha', 'paragraph:Beta', 'paragraph:after']);
    await expect.poll(() => selectedIds(page)).toEqual(['p1']);
    expect(await hasCaret(page)).toBe(false);
    await gap(page, 300);

    await page.keyboard.press(REDO);
    await expect.poll(() => saved(page)).toEqual(['paragraph:before', 'header:Alpha', 'paragraph:Beta', 'paragraph:after']);
    await expect.poll(() => selectedIds(page)).toEqual(['p1']);
    expect(await hasCaret(page)).toBe(false);
  });

  test('U105: undo of Duplicate selects the original, redo selects the copy', async ({ page }) => {
    await createBlok(page, BASE);
    await editable(page, 'p1').click();
    await gap(page);
    await openTunes(page, 'p1');
    await tune(page, 'duplicate').click();
    await expect.poll(() => selectedIds(page)).toHaveLength(1);
    const [copy] = await selectedIds(page);

    expect(copy).not.toBe('p1');
    await gap(page);

    await page.keyboard.press(UNDO);
    await expect.poll(() => ids(page)).toEqual(['p-before', 'p1', 'p2', 'p-after']);
    await expect.poll(() => selectedIds(page)).toEqual(['p1']);
    expect(await hasCaret(page)).toBe(false);
    await gap(page, 300);

    await page.keyboard.press(REDO);
    await expect.poll(() => ids(page)).toEqual(['p-before', 'p1', copy, 'p2', 'p-after']);
    await expect.poll(() => selectedIds(page)).toEqual([copy]);
    expect(await hasCaret(page)).toBe(false);
  });

  test('U111: a dragged block stays selected through undo and redo, with no caret', async ({ page }) => {
    await createBlok(page, BASE);
    await editable(page, 'p-before').click();
    await gap(page);
    await dragAbove(page, 'p2', 'p-before');
    await expect.poll(() => ids(page)).toEqual(['p2', 'p-before', 'p1', 'p-after']);
    await expect.poll(() => selectedIds(page)).toEqual(['p2']);
    await gap(page);

    await page.keyboard.press(UNDO);
    await expect.poll(() => ids(page)).toEqual(['p-before', 'p1', 'p2', 'p-after']);
    await expect.poll(() => selectedIds(page)).toEqual(['p2']);
    expect(await hasCaret(page)).toBe(false);
    await gap(page, 300);

    await page.keyboard.press(REDO);
    await expect.poll(() => ids(page)).toEqual(['p2', 'p-before', 'p1', 'p-after']);
    await expect.poll(() => selectedIds(page)).toEqual(['p2']);
    expect(await hasCaret(page)).toBe(false);
  });

  test('keys typed fast over a menu-made selection land in order, and undo restores the block', async ({ page }) => {
    await createBlok(page, BASE);
    await editable(page, 'p1').click();
    await gap(page);
    await convert(page, 'p1', 'Heading 1');
    await expect.poll(() => selectedIds(page)).toEqual(['p1']);
    await gap(page);

    await page.keyboard.type('xyz');
    await expect.poll(() => saved(page)).toEqual(['paragraph:before', 'paragraph:xyz', 'paragraph:Beta', 'paragraph:after']);
    await gap(page);

    // "x" replaces the selection; "yz" is typing after it, a step of its own.
    await page.keyboard.press(UNDO);
    await expect.poll(() => saved(page)).toEqual(['paragraph:before', 'paragraph:x', 'paragraph:Beta', 'paragraph:after']);
    await gap(page, 300);

    await page.keyboard.press(UNDO);
    await expect.poll(() => saved(page)).toEqual(['paragraph:before', 'header:Alpha', 'paragraph:Beta', 'paragraph:after']);
  });
});
