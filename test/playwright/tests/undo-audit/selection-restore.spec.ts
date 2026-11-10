import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { blocksAsHtml } from '../helpers/saved-as-html';

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const TOOLBAR = '[data-blok-testid=inline-toolbar]';
// Past the typing window, so the next gesture starts its own step.
const STEP_GAP_MS = 1000;

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const P = (id: string, text: string): OutputData['blocks'][number] => ({ id, type: 'paragraph', data: { text } });

const ABC = [P('b1', 'Alpha'), P('b2', 'Beta'), P('b3', 'Gamma')];

const createBlok = async (page: Page, blocks: OutputData['blocks'], title?: string): Promise<void> => {
  await page.evaluate(async ({ holder, blocks: blokBlocks, title: pageTitle }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, pageTitle: pageTitle !== undefined, data: { blocks: blokBlocks } });

    window.blokInstance = blok;
    await blok.isReady;
    if (pageTitle !== undefined) {
      await blok.title.set(pageTitle, { record: false });
    }
    blok.history.clear();
  }, { holder: HOLDER_ID, blocks, title });
};

/** "<block id or title>:<offset>", "<id>:<start>-<end>" for a range, or "none (<active tag>)". */
const caret = async (page: Page): Promise<string> => page.evaluate(() => {
  const selection = window.getSelection();
  const node = selection?.anchorNode ?? null;
  const editable = (node instanceof Element ? node : node?.parentElement)?.closest('[contenteditable="true"]');

  if (selection === null || node === null || !(editable instanceof HTMLElement)) {
    return `none (${document.activeElement?.tagName ?? ''})`;
  }
  const offsetOf = (at: Node, offset: number): number => {
    const before = document.createRange();

    before.setStart(editable, 0);
    before.setEnd(at, offset);

    return before.toString().length;
  };
  const owner = editable.hasAttribute('data-blok-page-title') ? 'title' : editable.closest('[data-blok-id]')?.getAttribute('data-blok-id');
  const anchor = offsetOf(node, selection.anchorOffset);

  if (selection.isCollapsed || selection.focusNode === null) {
    return `${owner ?? '?'}:${anchor}`;
  }
  const focus = offsetOf(selection.focusNode, selection.focusOffset);

  return `${owner ?? '?'}:${Math.min(anchor, focus)}-${Math.max(anchor, focus)}`;
});

const selectedBlocks = async (page: Page): Promise<string[]> => page.evaluate(() =>
  [...document.querySelectorAll('[data-blok-selected="true"]')].map((holder) => holder.getAttribute('data-blok-id') ?? '?'));

const savedTexts = async (page: Page): Promise<string[]> => {
  const saved = await page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);

  return blocksAsHtml(saved).map((block) => {
    const text: unknown = block.data.text;

    return `${block.id ?? '?'}=${typeof text === 'string' ? text : ''}`;
  });
};

const wait = async (page: Page, ms: number): Promise<void> => {
  await page.evaluate(async (timeout) => {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeout);
    });
  }, ms);
};

const press = async (page: Page, key: string): Promise<void> => {
  await page.keyboard.press(key);
  await wait(page, 200);
};

const editable = (page: Page, id: string): ReturnType<Page['locator']> =>
  page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

const clickEnd = async (page: Page, target: ReturnType<Page['locator']>): Promise<void> => {
  await target.click();
  await page.keyboard.press('End');
  await wait(page, 250);
};

/** Double-click a word, the way a user selects it. */
const dblclickWord = async (page: Page, id: string, word: string): Promise<void> => {
  const box = await editable(page, id).evaluate((root, needle) => {
    const node = root.firstChild;
    const index = node?.textContent?.indexOf(needle) ?? -1;

    if (node === null || index === -1) {
      throw new Error(`word not found: ${needle}`);
    }
    const range = document.createRange();

    range.setStart(node, index);
    range.setEnd(node, index + needle.length);
    const rect = range.getBoundingClientRect();

    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, word);

  await page.mouse.dblclick(box.x, box.y);
  await wait(page, 300);
};

const toolbarItem = (page: Page, name: string): ReturnType<Page['locator']> => page.locator(`${TOOLBAR} [data-blok-item-name="${name}"]`);

test.describe('undo audit: the selection undo and redo restore', () => {
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('U040: redo lands where the caret was at the undo press', async ({ page }) => {
    await createBlok(page, ABC);
    await clickEnd(page, editable(page, 'b1'));
    await page.keyboard.type(' one');
    await wait(page, STEP_GAP_MS);
    await clickEnd(page, editable(page, 'b3'));

    await press(page, UNDO);
    expect(await caret(page)).toBe('b1:5');

    await press(page, REDO);
    expect(await caret(page)).toBe('b3:5');
    expect(await savedTexts(page)).toEqual(['b1=Alpha one', 'b2=Beta', 'b3=Gamma']);
  });

  test('U151: a body edit undone from the title redoes with the caret back in the title', async ({ page }) => {
    await createBlok(page, [P('b1', 'Body')], 'Lab');
    await clickEnd(page, editable(page, 'b1'));
    await page.keyboard.type(' B');
    await wait(page, STEP_GAP_MS);
    await clickEnd(page, page.locator('[data-blok-page-title]'));

    await press(page, UNDO);
    expect(await caret(page)).toBe('b1:4');

    await press(page, REDO);
    expect(await caret(page)).toBe('title:3');
    expect(await savedTexts(page)).toEqual(['b1=Body B']);
  });

  test('U180: redo gives back the block selection that was live at the undo press', async ({ page }) => {
    await createBlok(page, [P('b1', 'Alpha')]);
    await clickEnd(page, editable(page, 'b1'));
    await page.keyboard.type(' x');
    await press(page, 'Escape');
    expect(await selectedBlocks(page)).toEqual(['b1']);

    await press(page, UNDO);
    expect(await savedTexts(page)).toEqual(['b1=Alpha']);
    expect(await caret(page)).toBe('b1:5');
    expect(await selectedBlocks(page)).toEqual([]);

    await press(page, REDO);
    expect(await savedTexts(page)).toEqual(['b1=Alpha x']);
    expect(await selectedBlocks(page)).toEqual(['b1']);
    expect(await caret(page)).toMatch(/^none/);
  });

  test('U047: undo of a block-selected delete gives the block back selected, and Backspace then is one undo step', async ({ page }) => {
    await createBlok(page, ABC);
    await clickEnd(page, editable(page, 'b2'));
    await press(page, 'Escape');
    expect(await selectedBlocks(page)).toEqual(['b2']);
    await press(page, 'Backspace');
    expect(await savedTexts(page)).toEqual(['b1=Alpha', 'b3=Gamma']);
    await wait(page, STEP_GAP_MS);

    await press(page, UNDO);
    expect(await selectedBlocks(page)).toEqual(['b2']);
    expect(await caret(page)).toMatch(/^none/);
    expect(await savedTexts(page)).toEqual(['b1=Alpha', 'b2=Beta', 'b3=Gamma']);

    await press(page, 'Backspace');
    expect(await savedTexts(page)).toEqual(['b1=Alpha', 'b3=Gamma']);

    await press(page, UNDO);
    expect(await savedTexts(page)).toEqual(['b1=Alpha', 'b2=Beta', 'b3=Gamma']);
    expect(await selectedBlocks(page)).toEqual(['b2']);
  });

  test('a key typed over an undo-restored block selection replaces it once, and one undo brings the block back', async ({ page }) => {
    await createBlok(page, ABC);
    await clickEnd(page, editable(page, 'b2'));
    await press(page, 'Escape');
    await press(page, 'Backspace');
    await wait(page, STEP_GAP_MS);
    await press(page, UNDO);
    expect(await selectedBlocks(page)).toEqual(['b2']);

    await press(page, 'x');
    const typed = await savedTexts(page);

    expect(typed.filter((row) => row.includes('x'))).toHaveLength(1);
    expect(typed).not.toContain('b2=Beta');
    expect(typed.join('|').match(/x/g)).toHaveLength(1);
    await wait(page, STEP_GAP_MS);

    await press(page, UNDO);
    expect(await savedTexts(page)).toEqual(['b1=Alpha', 'b2=Beta', 'b3=Gamma']);
  });

  test('U079: undo and redo past a code-block shortcut keep a caret in the block', async ({ page }) => {
    await createBlok(page, [P('b1', 'Alpha'), P('b2', '')]);
    await editable(page, 'b2').click();
    await wait(page, 250);
    await page.keyboard.type('```');
    await wait(page, STEP_GAP_MS);
    await page.keyboard.type('Item');
    await wait(page, STEP_GAP_MS);

    await press(page, UNDO);
    await press(page, UNDO);
    expect(await caret(page)).toBe('b2:3');

    await press(page, UNDO);
    expect(await savedTexts(page)).toEqual(['b1=Alpha', 'b2=']);
    expect(await caret(page)).toBe('b2:0');

    await press(page, REDO);
    expect(await savedTexts(page)).toEqual(['b1=Alpha', 'b2=```']);
    expect(await caret(page)).toBe('b2:3');
  });

  test('U143: undo and redo of a to-do tick keep focus on the checkbox', async ({ page }) => {
    await createBlok(page, [{ id: 'b1', type: 'list', data: { text: 'Buy milk', style: 'checklist', checked: false } }]);
    await clickEnd(page, editable(page, 'b1'));
    const checkbox = page.locator('[data-blok-id="b1"] input[type="checkbox"]');

    await checkbox.click();
    await wait(page, STEP_GAP_MS);
    await expect(checkbox).toBeChecked();

    await press(page, UNDO);
    await expect(checkbox).not.toBeChecked();
    await expect(checkbox).toBeFocused();

    await press(page, REDO);
    await expect(checkbox).toBeChecked();
    await expect(checkbox).toBeFocused();
  });

  test('undo of typing in a to-do after a tick puts the caret back in the text, not on the checkbox', async ({ page }) => {
    await createBlok(page, [{ id: 'b1', type: 'list', data: { text: 'Buy', style: 'checklist', checked: false } }]);
    await clickEnd(page, editable(page, 'b1'));
    await page.keyboard.type(' milk');
    await wait(page, STEP_GAP_MS);
    const checkbox = page.locator('[data-blok-id="b1"] input[type="checkbox"]');

    await checkbox.click();
    await wait(page, STEP_GAP_MS);

    await press(page, UNDO);
    await press(page, UNDO);
    expect(await savedTexts(page)).toEqual(['b1=Buy']);
    await expect(checkbox).not.toBeFocused();
    expect(await caret(page)).toBe('b1:3');
  });

  // A restored block selection leaves focus where Escape's does (the body); FR4 is about carets.
  test('U140: a callout colour pick closes the menu, and the callout stays selected through undo and redo', async ({ page }) => {
    await createBlok(page, [
      { id: 'co', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: ['k1'] },
      { id: 'k1', type: 'paragraph', data: { text: 'Note' }, parent: 'co' },
    ]);
    await clickEnd(page, editable(page, 'k1'));
    await page.locator('[data-blok-id="co"]').hover({ position: { x: 5, y: 5 } });
    await page.getByTestId('settings-toggler').click();
    await page.locator('[data-blok-testid="popover-item"][data-blok-item-name="callout-color"]').dispatchEvent('mouseover');
    await page.getByTestId('callout-color-swatch-background-color-blue').click();
    await wait(page, 300);

    const background = async (): Promise<unknown> => page.evaluate(async () =>
      (await window.blokInstance?.save())?.blocks.find((block) => block.id === 'co')?.data.backgroundColor ?? null);

    expect(await background()).toBe('blue');
    await expect(page.getByTestId('block-tunes-popover')).toHaveCount(0);
    expect(await selectedBlocks(page)).toEqual(['co']);
    expect(await caret(page)).toMatch(/^none/);
    await wait(page, STEP_GAP_MS);

    await press(page, UNDO);
    expect(await background()).toBeNull();
    expect(await selectedBlocks(page)).toEqual(['co']);
    expect(await caret(page)).toMatch(/^none/);

    await press(page, REDO);
    expect(await background()).toBe('blue');
    expect(await selectedBlocks(page)).toEqual(['co']);
    expect(await caret(page)).toMatch(/^none/);
  });

  test('U050: undo of Backspace over a cross-block range brings the range back, with the toolbar', async ({ page }) => {
    await createBlok(page, [P('b1', 'Alpha one'), P('b2', 'Beta two')]);
    await clickEnd(page, editable(page, 'b1'));
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowLeft');
    }
    await page.keyboard.press('Shift+ArrowDown');
    await wait(page, 200);
    const range = await page.evaluate(() => window.getSelection()?.toString() ?? '');

    await page.keyboard.press('Backspace');
    await wait(page, STEP_GAP_MS);

    await press(page, UNDO);
    expect(await savedTexts(page)).toEqual(['b1=Alpha one', 'b2=Beta two']);
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe(range);
    await expect(page.locator(TOOLBAR)).toBeVisible();
  });

  test('Delete over an undo-restored block selection is one undo step', async ({ page }) => {
    await createBlok(page, ABC);
    await clickEnd(page, editable(page, 'b2'));
    await press(page, 'Escape');
    await press(page, 'Backspace');
    await wait(page, STEP_GAP_MS);
    await press(page, UNDO);
    expect(await selectedBlocks(page)).toEqual(['b2']);

    await press(page, 'Delete');
    expect(await savedTexts(page)).toEqual(['b1=Alpha', 'b3=Gamma']);
    await wait(page, STEP_GAP_MS);

    await press(page, UNDO);
    expect(await savedTexts(page)).toEqual(['b1=Alpha', 'b2=Beta', 'b3=Gamma']);
  });

  test('U038: a range brought back by undo shows the inline toolbar', async ({ page }) => {
    await createBlok(page, [P('b1', 'Hello brave world')]);
    await clickEnd(page, editable(page, 'b1'));
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('ArrowLeft');
    }
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Shift+ArrowLeft');
    }
    await page.keyboard.press('Backspace');
    await wait(page, STEP_GAP_MS);

    await press(page, UNDO);
    expect(await caret(page)).toBe('b1:6-11');
    await expect(page.locator(TOOLBAR)).toBeVisible();
  });

  test('U064: the inline toolbar stays open through undo and redo, and Italic follows the mark without going blue', async ({ page }) => {
    await createBlok(page, [P('b1', 'Hello brave world')]);
    await dblclickWord(page, 'b1', 'brave');
    expect(await caret(page)).toBe('b1:6-11');
    await expect(page.locator(TOOLBAR)).toBeVisible();
    await page.keyboard.press(`${MOD}+i`);
    await wait(page, STEP_GAP_MS);
    await expect(toolbarItem(page, 'italic')).toHaveAttribute('data-blok-popover-item-active', 'true');

    await press(page, UNDO);
    await expect(page.locator(TOOLBAR)).toBeVisible();
    await expect(toolbarItem(page, 'italic')).not.toHaveAttribute('data-blok-popover-item-active', 'true');
    expect(await caret(page)).toBe('b1:6-11');

    await press(page, REDO);
    await expect(page.locator(TOOLBAR)).toBeVisible();
    await expect(toolbarItem(page, 'italic')).toHaveAttribute('data-blok-popover-item-active', 'true');

    const ink = await toolbarItem(page, 'italic').evaluate((item) => {
      const style = getComputedStyle(item);

      return [style.color, style.backgroundColor];
    });
    const isBlue = (color: string): boolean => {
      const [r, g, b] = (color.match(/\d+(\.\d+)?/g) ?? []).map(Number);

      return b > 150 && b > r + 40 && b > g + 20;
    };

    expect(ink.filter(isBlue)).toEqual([]);
  });

  test('U176: an open colour menu stays open through undo', async ({ page }) => {
    await createBlok(page, [P('b1', 'Hello brave world')]);
    await dblclickWord(page, 'b1', 'brave');
    await toolbarItem(page, 'marker').click();
    await page.getByTestId('marker-swatch-background-color-yellow').click();
    await wait(page, STEP_GAP_MS);

    await press(page, UNDO);
    expect(await savedTexts(page)).toEqual(['b1=Hello brave world']);
    await expect(page.getByTestId('marker-swatch-background-color-yellow')).toBeVisible();
    await expect(page.locator(TOOLBAR)).toBeVisible();
  });
});
