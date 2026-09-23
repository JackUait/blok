/**
 * Undo/redo audit, wave 5 (W5X): wave-4 hypotheses turned into browser tests.
 *
 * Expected everywhere: one undo reverts one gesture exactly, and redo brings
 * the exact post-gesture state back — in save() AND on screen.
 */
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { dragBetweenCharacters } from '../helpers/text-drag';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const UNDO = `${MOD}+z`;
const REDO = `${MOD}+Shift+z`;
// Yjs capture window is 500ms; wait past it so gestures stay separate undo steps.
const CAPTURE_GAP = 700;
const HANDLE = '[data-blok-interface=blok] [data-blok-testid="settings-toggler"]';
const TUNES_POPOVER = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const AUDIO_FIXTURE = join(process.cwd(), 'test/playwright/fixtures/audio/sample.mp3');

declare global {
  interface Window {
    blokInstance?: Blok;
    defaultBlockTools: Record<string, { class: unknown }>;
    __errors?: string[];
    __releaseDecode?: () => void;
  }
}

type Block = OutputData['blocks'][number];
type CellSeed = string;

const P = (id: string, text: string, parent?: string): Block => ({
  id, type: 'paragraph', data: { text }, ...(parent !== undefined ? { parent } : {}),
});

const mount = async (page: Page, blocks: Block[]): Promise<void> => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ list }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    // The shared page keeps localStorage between tests; the audio player reads its loop/volume from it.
    window.localStorage.clear();
    window.__errors = [];
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.setAttribute('data-blok-testid', 'blok');
    document.body.appendChild(holder);
    const blok = new window.Blok({ holder: 'blok', tools: window.defaultBlockTools, data: { blocks: list } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { list: blocks });
};

const gap = (page: Page, ms = CAPTURE_GAP): Promise<void> => page.evaluate((t) => new Promise<void>((r) => {
  window.setTimeout(r, t);
}), ms);

const canUndo = (page: Page): Promise<boolean> => page.evaluate(() => window.blokInstance?.history.canUndo() ?? false);
const canRedo = (page: Page): Promise<boolean> => page.evaluate(() => window.blokInstance?.history.canRedo() ?? false);

const pressUndo = async (page: Page): Promise<void> => {
  await page.keyboard.press(UNDO);
  await gap(page, 500);
};

const pressRedo = async (page: Page): Promise<void> => {
  await page.keyboard.press(REDO);
  await gap(page, 500);
};

/** Saved blocks without authorship metadata. */
const save = (page: Page): Promise<Block[]> => page.evaluate(async () => {
  if (!window.blokInstance) {
    throw new Error('no blok');
  }

  return (await window.blokInstance.save()).blocks.map(({ lastEditedAt: _a, lastEditedBy: _b, ...rest }) => rest);
});

/** Saved blocks as `id:type:text^parent`. */
const lines = async (page: Page): Promise<string[]> => (await save(page)).map((b) => {
  const text = (b.data as { text?: string }).text ?? '';

  return `${b.id ?? '?'}:${b.type}:${text}${b.parent !== undefined ? `^${b.parent}` : ''}`;
});

const texts = async (page: Page): Promise<string[]> => (await save(page)).map((b) => {
  const text: unknown = (b.data as { text?: unknown }).text;

  return typeof text === 'string' ? text : `<${b.type}>`;
});

/** What is on screen: `id:innerHTML` of each block's first editable, in DOM order. */
const dom = (page: Page): Promise<string[]> => page.evaluate(() =>
  Array.from(document.querySelectorAll('#blok [data-blok-id]')).map((holder) => {
    const editable = holder.querySelector('[contenteditable="true"]');

    return `${holder.getAttribute('data-blok-id') ?? '?'}:${editable?.innerHTML ?? ''}`;
  }));

const screenTexts = (page: Page): Promise<string[]> => page.evaluate(() =>
  Array.from(document.querySelectorAll('#blok [data-blok-id]'))
    .map((el) => (el.querySelector('[contenteditable]')?.textContent ?? '')));

const editable = (page: Page, id: string): Locator => page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

test.describe.configure({ retries: 0 });

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

/* ------------------------------------------------------------------------------------------------
 * 1-2. Table: column mirrors of W4B chain A (grip on a removed last row) and chain B (add drag).
 * ---------------------------------------------------------------------------------------------- */

const tableDoc = (rows: CellSeed[][], extra: Record<string, unknown> = {}): Block[] => {
  const kids: Block[] = [];
  const content = rows.map((row, r) => row.map((seed, c) => {
    const id = `c${r}${c}`;

    kids.push({ id, type: 'paragraph', data: { text: seed }, parent: 'tbl' });

    return { blocks: [id], id: `k${c}`, rowId: `r${r}` };
  }));

  return [
    P('p-before', 'before'),
    {
      id: 'tbl',
      type: 'table',
      data: { withHeadings: false, withHeadingColumn: false, content, ...extra },
      content: kids.map(k => k.id ?? ''),
    },
    ...kids,
    P('p-after', 'after'),
  ];
};

// colWidths is seeded so an add-column gesture does not ADD a new data key (family 2 confound).
const DOC_3x3 = (): Block[] => tableDoc([
  ['A1', 'B1', 'C1'],
  ['A2', 'B2', 'C2'],
  ['A3', 'B3', 'C3'],
], { colWidths: [160, 160, 160] });

/** save() with the table's cell blocks sorted by id: the table's `content` grid orders them. */
const tdoc = async (page: Page): Promise<Block[]> => {
  const blocks = await save(page);

  return [
    ...blocks.filter(b => b.parent !== 'tbl').map(b => (b.id === 'tbl' ? { ...b, content: [...(b.content ?? [])].sort() } : b)),
    ...blocks.filter(b => b.parent === 'tbl').sort((a, b) => (a.id ?? '').localeCompare(b.id ?? '')),
  ];
};

const grid = async (page: Page): Promise<string[][]> => page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-blok-table-row]')).map(row =>
    Array.from(row.querySelectorAll(':scope > [data-blok-table-cell]')).map(c =>
      Array.from(c.querySelectorAll('[contenteditable="true"]')).map(e => (e.textContent ?? '').trim()).join('|'))));

const cell = (page: Page, row: number, col: number): Locator =>
  page.locator(`[data-blok-table-cell-row="${row}"][data-blok-table-cell-col="${col}"]`);

const box = async (locator: Locator, what: string): Promise<{ x: number; y: number; width: number; height: number }> => {
  const b = await locator.boundingBox();

  if (b === null) {
    throw new Error(`${what} has no box`);
  }

  return b;
};

const openColGrip = async (page: Page, col: number): Promise<void> => {
  await cell(page, 0, col).click();
  const grip = page.locator(`[data-blok-table-grip-col="${col}"]`);

  await expect(grip).toBeVisible();
  await grip.click();
};

const menuItem = (page: Page, name: string): Locator => page.getByRole('menuitem', { name, exact: true });

const captureErrors = (page: Page): string[] => {
  const errors: string[] = [];

  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning') {
      errors.push(`${m.type()}: ${m.text()}`);
    }
  });

  return errors;
};

// With pixel column widths the scroll wrapper sits over the add-column button for Playwright's hit test,
// so press it by coordinates (the same point a user clicks).
const clickAddCol = async (page: Page): Promise<void> => {
  await cell(page, 1, 2).hover();
  const btn = page.locator('[data-blok-table-add-col]');

  await expect(btn).toBeVisible();
  const b = await box(btn, 'add-col button');

  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
};

/**
 * Gesture on the table, then Cmd+Z with the caret in cell (row, col), then redo.
 * canRedo after the undo is asserted first: that is where chain A shows.
 */
const undoWithCaretIn = async (page: Page, row: number, col: number, gesture: () => Promise<void>, cols: number): Promise<void> => {
  const before = await tdoc(page);

  await gap(page);
  await gesture();
  await expect.poll(async () => (await grid(page))[0].length).toBe(cols);
  await gap(page);
  const after = await tdoc(page);
  const gridAfter = await grid(page);

  await cell(page, row, col).locator('[contenteditable="true"]').click();
  await page.keyboard.press(UNDO);
  await gap(page, 500);
  await expect.poll(async () => (await grid(page))[0].length).toBe(3);

  expect(await canRedo(page), 'canRedo after undo').toBe(true);
  expect(await tdoc(page), 'save() after undo').toEqual(before);
  await pressRedo(page);
  expect(await grid(page), 'grid after redo').toEqual(gridAfter);
  expect(await tdoc(page), 'save() after redo').toEqual(after);
};

test.describe('W5X table columns', () => {
  // Defect: redo is dead after undoing "Insert column right" on the last column while the caret
  // sits in the new column. Same chain A as W4B-21/22, through the COLUMN grip:
  // Table.setData saves the visible grip indices (src/tools/table/index.ts:1106) and restores them on the
  // shrunk grid (index.ts:1190 → table-row-col-controls.ts:280-289 restoreVisibleGrips) → showColGrip
  // (table-row-col-controls.ts:636-643) passes colGrips[3] === undefined to applyVisibleClasses (:672),
  // which throws — logged as "Tool table setData failed: Cannot read properties of undefined (reading
  // 'hasAttribute')" — then yjs-sync rebuilds the table and the rebuild's writes clear redo.
  test('W5X-1: redo after undoing Insert column right on the last column, caret in the new column', async ({ page }) => {
    test.fail(true, 'W5X-1 showColGrip on a removed last column throws in Table.setData');
    const errors = captureErrors(page);

    await mount(page, DOC_3x3());
    await undoWithCaretIn(page, 1, 3, async () => {
      await openColGrip(page, 2);
      await menuItem(page, 'Insert column right').click();
    }, 4);
    expect(errors.filter(e => e.includes('setData failed'))).toEqual([]);
  });

  // Redo survives here. In the one run that captured console output, the Saver logged 3 "invisible
  // ghost" table children after this undo: CON-5's family (phantom cells), not checked here.
  test('W5X-1c: control — same undo with the caret in column 1 keeps redo', async ({ page }) => {
    await mount(page, DOC_3x3());
    await undoWithCaretIn(page, 1, 0, async () => {
      await openColGrip(page, 2);
      await menuItem(page, 'Insert column right').click();
    }, 4);
    expect(await canUndo(page)).toBe(true);
  });

  test('W5X-2: redo after undoing the add-column button, caret in the new column', async ({ page }) => {
    test.fail(true, 'W5X-2 showColGrip on a removed last column throws in Table.setData');
    const errors = captureErrors(page);

    await mount(page, DOC_3x3());
    await undoWithCaretIn(page, 1, 3, async () => {
      await clickAddCol(page);
    }, 4);
    expect(errors.filter(e => e.includes('setData failed'))).toEqual([]);
  });

  test('W5X-3: redo after undoing Duplicate on the last column, caret in the copy', async ({ page }) => {
    test.fail(true, 'W5X-3 showColGrip on a removed last column throws in Table.setData');
    const errors = captureErrors(page);

    await mount(page, DOC_3x3());
    await undoWithCaretIn(page, 1, 3, async () => {
      await openColGrip(page, 2);
      await menuItem(page, 'Duplicate').click();
    }, 4);
    expect(errors.filter(e => e.includes('setData failed'))).toEqual([]);
  });

  // Undo with the caret OUTSIDE the table (the W4B roundTrip path) for the add-column button.
  test('W5X-2c: control — add-column button undo/redo with the caret outside the table', async ({ page }) => {
    await mount(page, DOC_3x3());
    const before = await tdoc(page);

    await gap(page);
    await clickAddCol(page);
    await expect.poll(async () => (await grid(page))[0].length).toBe(4);
    await gap(page);
    const after = await tdoc(page);

    // Grips hide after a delay; undo only once none is visible (a visible last-column grip is W5X-2).
    await editable(page, 'p-before').hover();
    await expect(page.locator('[data-blok-table-grip-visible]')).toHaveCount(0);
    await editable(page, 'p-before').click();
    await pressUndo(page);
    expect(await tdoc(page)).toEqual(before);
    expect(await canRedo(page)).toBe(true);
    await pressRedo(page);
    expect(await tdoc(page)).toEqual(after);
  });

  const dragAddCol = async (page: Page, steps: number): Promise<void> => {
    await cell(page, 1, 2).hover();
    const btn = page.locator('[data-blok-table-add-col]');

    await expect(btn).toBeVisible();
    const b = await box(btn, 'add-col button');
    const colW = (await box(cell(page, 0, 2), 'col')).width;

    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + colW * 2.5, b.y + b.height / 2, { steps });
    await page.mouse.up();
  };

  // Chain B mirror of W4B-23: onDragAddCol (table-subsystems.ts:302) wraps each column in
  // runTransactedStructuralOp → transactForTool, whose nested endToolTransaction stopCapturing()
  // (blockManager.ts:998/1002) closes the drag's open group after every column.
  test('W5X-4: one undo of a drag on the add-column button removes every added column', async ({ page }) => {
    test.fail(true, 'W5X-4 nested transactForTool stopCapturing splits the drag group');
    await mount(page, DOC_3x3());
    const before = await tdoc(page);

    await gap(page);
    await dragAddCol(page, 12);
    await expect.poll(async () => (await grid(page))[0].length).toBeGreaterThanOrEqual(5);
    await gap(page);

    await editable(page, 'p-before').click();
    await pressUndo(page);
    expect((await grid(page))[0].length, 'columns after one undo').toBe(3);
    expect(await tdoc(page)).toEqual(before);
  });

  test('W5X-4c: control — a flick that adds both columns in one pointermove is one undo step', async ({ page }) => {
    await mount(page, DOC_3x3());
    const before = await tdoc(page);

    await gap(page);
    await dragAddCol(page, 1);
    await expect.poll(async () => (await grid(page))[0].length).toBeGreaterThanOrEqual(5);
    await gap(page);

    await editable(page, 'p-before').click();
    await pressUndo(page);
    expect((await grid(page))[0].length, 'columns after one undo').toBe(3);
    expect(await tdoc(page)).toEqual(before);
  });
});

/* ------------------------------------------------------------------------------------------------
 * 3. W4A-1 through user gestures: delete, then a move, then undo twice.
 * ---------------------------------------------------------------------------------------------- */

const openTunes = async (page: Page, id: string): Promise<void> => {
  const b = await page.locator(`[data-blok-id="${id}"] [data-blok-element-content]`).first().boundingBox();

  if (b === null) {
    throw new Error(`no box for ${id}`);
  }
  const points = [[0.5, 0.5], [0.1, 0.1], [0.5, 0.05], [0.9, 0.5]];

  for (const [fx, fy] of points) {
    await page.mouse.move(b.x + b.width * fx, b.y + Math.min(b.height * fy, b.height - 2));
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

/** Pointer-drag block `id` by its handle onto the top of block `targetId` and drop. */
const dragBlock = async (page: Page, id: string, targetId: string): Promise<void> => {
  const src0 = await page.locator(`[data-blok-id="${id}"] [data-blok-element-content]`).first().boundingBox();

  if (src0 === null) {
    throw new Error('no box');
  }
  await page.mouse.move(src0.x + src0.width / 2, src0.y + src0.height / 2);
  const handle = page.locator(HANDLE);

  await expect(handle).toBeVisible();
  const src = await handle.boundingBox();
  const tgt = await page.locator(`[data-blok-id="${targetId}"] [data-blok-element-content]`).first().boundingBox();

  if (src === null || tgt === null) {
    throw new Error('no boxes');
  }
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(tgt.x + tgt.width / 2, tgt.y + 3, { steps: 18 });
  await page.waitForFunction(
    () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true',
    { timeout: 2000 }
  );
  await page.mouse.up();
};

const MOVE_UP = `${MOD}+Shift+ArrowUp`;
const MOVE_DOWN = `${MOD}+Shift+ArrowDown`;
const ABC = (): Block[] => [P('a', 'alpha'), P('b', ''), P('c', 'gamma')];
const ABC_TEXTS = ['alpha', '', 'gamma'];

const deleteByBackspace = async (page: Page): Promise<void> => {
  await editable(page, 'b').click();
  await page.keyboard.press('Backspace');
};

const deleteByMenu = async (page: Page): Promise<void> => {
  await openTunes(page, 'b');
  await tune(page, 'delete').click();
};

const deleteBySelection = async (page: Page): Promise<void> => {
  await editable(page, 'b').click();
  // b is empty, so the first Cmd+A already selects the block; a second one would select all.
  await page.keyboard.press(`${MOD}+a`);
  await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(1);
  await expect(page.locator('[data-blok-id="b"][data-blok-selected="true"]')).toHaveCount(1);
  await page.keyboard.press('Backspace');
};

const moveCUpByKeyboard = async (page: Page): Promise<void> => {
  await editable(page, 'c').click();
  await page.keyboard.press(MOVE_UP);
};

/** Delete b, move a neighbour, undo both: b must come back between alpha and gamma. Returns texts after one redo. */
const deleteMoveUndo = async (
  page: Page,
  del: (p: Page) => Promise<void>,
  move: (p: Page) => Promise<void>,
  movedTexts: string[]
): Promise<string[]> => {
  await mount(page, ABC());
  await gap(page);
  await del(page);
  await gap(page);
  expect(await texts(page), 'after delete').toEqual(['alpha', 'gamma']);
  await move(page);
  await gap(page);
  expect(await texts(page), 'after move').toEqual(movedTexts);
  await editable(page, 'a').click();
  await pressUndo(page);
  expect(await texts(page), 'after undo of the move').toEqual(['alpha', 'gamma']);
  await pressUndo(page);

  expect(await texts(page), 'save() after undo of the delete').toEqual(ABC_TEXTS);
  expect(await screenTexts(page), 'screen after undo of the delete').toEqual(ABC_TEXTS);
  await pressRedo(page);

  return texts(page);
};

test.describe('W5X delete then move (W4A-1 via user gestures)', () => {
  // Same guarded behaviour as W4A-1, reached by user gestures only.
  test('W5X-5: Backspace on an empty block, Cmd+Shift+Up on the next one, two undos put the block back', async ({ page }) => {
    expect(await deleteMoveUndo(page, deleteByBackspace, moveCUpByKeyboard, ['gamma', 'alpha']), 'after redo of the delete').toEqual(['alpha', 'gamma']);
  });

  test('W5X-6: block-menu Delete, drag the next block above, two undos put the block back', async ({ page }) => {
    expect(await deleteMoveUndo(page, deleteByMenu, p => dragBlock(p, 'c', 'a'), ['gamma', 'alpha']), 'after redo of the delete').toEqual(['alpha', 'gamma']);
  });

  test('W5X-7: block-selection Delete, Cmd+Shift+Up on the next one, two undos put the block back', async ({ page }) => {
    expect(await deleteMoveUndo(page, deleteBySelection, moveCUpByKeyboard, ['gamma', 'alpha']), 'after redo of the delete').toEqual(['alpha', 'gamma']);
  });

  // Cmd+Shift+Down on alpha lifts gamma above it, so gamma (b's NEXT neighbour) is what moves here too.
  test('W5X-8: Backspace on an empty block, Cmd+Shift+Down on the previous one, two undos put the block back', async ({ page }) => {
    expect(await deleteMoveUndo(page, deleteByBackspace, async (p) => {
      await editable(p, 'a').click();
      await p.keyboard.press(MOVE_DOWN);
    }, ['gamma', 'alpha']), 'after redo of the delete').toEqual(['alpha', 'gamma']);
  });

  // A block that is NOT a neighbour of the deleted one moves.
  test('W5X-9: delete b in a,b,c,d then move d above c, two undos put b back', async ({ page }) => {
    await mount(page, [P('a', 'alpha'), P('b', ''), P('c', 'gamma'), P('d', 'delta')]);
    await gap(page);
    await deleteByBackspace(page);
    await gap(page);
    await editable(page, 'd').click();
    await page.keyboard.press(MOVE_UP);
    await gap(page);
    expect(await texts(page), 'after move').toEqual(['alpha', 'delta', 'gamma']);
    await editable(page, 'a').click();
    await pressUndo(page);
    await pressUndo(page);

    expect(await texts(page), 'save() after two undos').toEqual(['alpha', '', 'gamma', 'delta']);
    expect(await screenTexts(page), 'screen after two undos').toEqual(['alpha', '', 'gamma', 'delta']);
  });

  // Insert then move the new block then undo all: undo of an insert is a delete by id.
  test('W5X-10: Enter to insert a block, Cmd+Shift+Up on it, undo all removes it and redo all brings it back', async ({ page }) => {
    await mount(page, [P('a', 'alpha'), P('c', 'gamma')]);
    await gap(page);
    await editable(page, 'c').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('new');
    await gap(page);
    await page.keyboard.press(MOVE_UP);
    await gap(page);
    const after = await texts(page);

    expect(after).toEqual(['alpha', 'new', 'gamma']);
    for (let i = 0; i < 5 && await canUndo(page); i++) {
      await pressUndo(page);
    }
    expect(await texts(page)).toEqual(['alpha', 'gamma']);
    expect(await screenTexts(page)).toEqual(['alpha', 'gamma']);
    for (let i = 0; i < 5 && await canRedo(page); i++) {
      await pressRedo(page);
    }
    expect(await texts(page)).toEqual(after);
    expect(await screenTexts(page)).toEqual(after);
  });

  // Insert then a NEIGHBOUR moves, undo both.
  test('W5X-11: Enter to insert a block after alpha, Cmd+Shift+Up on gamma, two undos leave alpha, gamma', async ({ page }) => {
    await mount(page, [P('a', 'alpha'), P('c', 'gamma')]);
    await gap(page);
    await editable(page, 'a').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await gap(page);
    await moveCUpByKeyboard(page);
    await gap(page);
    expect(await texts(page), 'after move').toEqual(['alpha', 'gamma', '']);
    await editable(page, 'a').click();
    await pressUndo(page);
    expect(await texts(page), 'after undo of the move').toEqual(['alpha', '', 'gamma']);
    await pressUndo(page);
    expect(await texts(page)).toEqual(['alpha', 'gamma']);
    expect(await screenTexts(page)).toEqual(['alpha', 'gamma']);
    await pressRedo(page);
    await pressRedo(page);
    expect(await texts(page), 'after redo all').toEqual(['alpha', 'gamma', '']);
    expect(await screenTexts(page)).toEqual(['alpha', 'gamma', '']);
  });
});

/* ------------------------------------------------------------------------------------------------
 * 4. Audio enrichment late writes.
 * ---------------------------------------------------------------------------------------------- */

/** Hold AudioContext.decodeAudioData until window.__releaseDecode() is called. */
const gateDecode = (page: Page): Promise<void> => page.evaluate(() => {
  const proto = window.AudioContext.prototype;
  const original = proto.decodeAudioData;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => {
    release = r;
  });

  window.__releaseDecode = release;
  proto.decodeAudioData = async function (this: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
    await gate;

    return original.call(this, data);
  };
});

const AUDIO_DOC = (): Block[] => [P('p0', 'Anchor'), { id: 'au', type: 'audio', data: {} }];

const upload = async (page: Page): Promise<void> => {
  await page.locator('[data-blok-id="au"]').getByTestId('file-input').setInputFiles(AUDIO_FIXTURE);
  await expect(page.locator('[data-blok-id="au"] [data-role="audio-controls"]')).toBeVisible();
};

const audioData = async (page: Page): Promise<Record<string, unknown> | undefined> =>
  (await save(page)).find(b => b.id === 'au')?.data;

const peaksLanded = (page: Page): Promise<void> => expect.poll(async () => Array.isArray((await audioData(page))?.peaks)).toBe(true);

test.describe('W5X audio enrichment', () => {
  // Defect: one upload needs two undos when the waveform decodes after the capture window (long file).
  // Root cause: enrich() writes peaks/duration from a promise and calls dispatchChange
  // (audio/index.ts:362-370) as a plain local edit, so it is its own undo step. Family "late async
  // writes", new instance. Observed: first undo only drops peaks/duration; url stays.
  test('W5X-12: one undo of an upload whose waveform decoded late returns the empty audio block', async ({ page }) => {
    test.fail(true, 'W5X-12 late peaks write is its own undo step (audio/index.ts:369)');
    await mount(page, AUDIO_DOC());
    await gateDecode(page);
    await gap(page);
    await upload(page);
    await gap(page);
    expect((await audioData(page))?.url, 'url after upload').toMatch(/^blob:/);
    await page.evaluate(() => window.__releaseDecode?.());
    await peaksLanded(page);
    await gap(page);

    await editable(page, 'p0').click();
    await pressUndo(page);
    expect(await audioData(page), 'audio after one undo').toBeUndefined();
    await expect(page.locator('[data-blok-id="au"]').getByTestId('file-input')).toBeAttached();
  });

  test('W5X-12c: control — an upload whose waveform decodes at once is one undo step', async ({ page }) => {
    await mount(page, AUDIO_DOC());
    await gap(page);
    await upload(page);
    await peaksLanded(page);
    await gap(page);

    await editable(page, 'p0').click();
    await pressUndo(page);
    expect(await audioData(page), 'audio after one undo').toBeUndefined();
    expect(await canUndo(page)).toBe(false);
  });

  // Defect: the late peaks write (audio/index.ts:369 dispatchChange) is a new local edit, so it clears
  // the redo of an unrelated undo. Family "late async writes clear redo", new instance.
  test('W5X-13: a waveform that decodes after an unrelated undo keeps redo', async ({ page }) => {
    test.fail(true, 'W5X-13 late peaks write clears redo (audio/index.ts:369)');
    await mount(page, AUDIO_DOC());
    await gateDecode(page);
    await gap(page);
    await upload(page);
    await gap(page);
    await editable(page, 'p0').click();
    await page.keyboard.press('End');
    await page.keyboard.type('X');
    await gap(page);
    await pressUndo(page);
    expect((await save(page))[0].data.text).toBe('Anchor');
    expect(await canRedo(page), 'canRedo right after undo').toBe(true);
    await page.evaluate(() => window.__releaseDecode?.());
    await peaksLanded(page);
    await gap(page);

    expect(await canRedo(page), 'canRedo after the waveform landed').toBe(true);
    await pressRedo(page);
    expect((await save(page))[0].data.text).toBe('AnchorX');
  });

  // Undo of the upload while the decode is still pending: late peaks must not bring the audio back.
  test('W5X-14: undo of an upload before its waveform decoded stays undone and keeps redo', async ({ page }) => {
    await mount(page, AUDIO_DOC());
    await gateDecode(page);
    await gap(page);
    await upload(page);
    await gap(page);
    await editable(page, 'p0').click();
    await pressUndo(page);
    expect(await audioData(page), 'audio after undo').toBeUndefined();
    await page.evaluate(() => window.__releaseDecode?.());
    await gap(page, 1500);

    expect(await audioData(page), 'audio after the late decode').toBeUndefined();
    expect(await canRedo(page), 'canRedo after the late decode').toBe(true);
    await pressRedo(page);
    expect((await audioData(page))?.url, 'url after redo').toMatch(/^blob:/);
  });

  test('W5X-15: redo of an upload brings back a playable player with its waveform', async ({ page }) => {
    await mount(page, AUDIO_DOC());
    await gap(page);
    await upload(page);
    await peaksLanded(page);
    await gap(page);
    const after = await audioData(page);

    await editable(page, 'p0').click();
    await pressUndo(page);
    expect(await audioData(page)).toBeUndefined();
    await pressRedo(page);
    await gap(page, 1000);

    expect(await audioData(page), 'data after redo').toEqual(after);
    expect(await canUndo(page), 'canUndo after redo').toBe(true);
    expect(await canRedo(page), 'no phantom step after redo').toBe(false);
    await expect(page.locator('[data-blok-id="au"] [data-role="audio-controls"]')).toBeVisible();
    await expect.poll(() => page.locator('[data-blok-id="au"] [data-role="audio-media"]')
      .evaluate((el: HTMLAudioElement) => ({ ready: el.readyState > 0, error: el.error?.code ?? null })))
      .toEqual({ ready: true, error: null });
  });
});

/* ------------------------------------------------------------------------------------------------
 * 5. Cross-block text selection that crosses INTO a column.
 * ---------------------------------------------------------------------------------------------- */

const COLS_DOC = (): Block[] => [
  P('a', 'Alpha one'),
  { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
  { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1'] },
  P('p1', 'Left one', 'c1'),
  { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
  P('p2', 'Right two', 'c2'),
  P('z', 'Zulu end'),
];

/** Gesture over a selection, then check one undo / exact redo. */
const selectionRoundTrip = async (
  page: Page,
  select: () => Promise<void>,
  act: () => Promise<void>
): Promise<{ after: string[]; redone: string[] }> => {
  await mount(page, COLS_DOC());
  const before = await lines(page);
  const domBefore = await dom(page);

  await gap(page);
  await select();
  await act();
  await gap(page);
  const after = await lines(page);
  const domAfter = await dom(page);

  expect(after, 'gesture changed the document').not.toEqual(before);

  await pressUndo(page);
  const undone = await lines(page);

  expect(undone, 'save() after one undo').toEqual(before);
  expect(await dom(page), 'screen after one undo').toEqual(domBefore);

  await pressRedo(page);
  expect(await dom(page), 'screen after redo').toEqual(domAfter);

  return { after, redone: await lines(page) };
};

const dragAtoP1 = (page: Page): Promise<void> =>
  dragBetweenCharacters(page, { editable: editable(page, 'a'), offset: 3 }, { editable: editable(page, 'p1'), offset: 4 });

/** Block ids as the Yjs document has them, `id^parent`. */
const yjsIds = (page: Page): Promise<string[]> => page.evaluate(() =>
  (window.blokInstance as unknown as {
    module: { yjsManager: { toJSON: () => Array<{ id: string; parentId?: string; parent?: string }> } };
  }).module.yjsManager.toJSON().map(b => `${b.id}^${b.parentId ?? b.parent ?? ''}`));

const saveIds = async (page: Page): Promise<string[]> => (await save(page)).map(b => `${b.id ?? '?'}^${b.parent ?? ''}`);

const undoAll = async (page: Page): Promise<void> => {
  for (let i = 0; i < 6 && await canUndo(page); i++) {
    await pressUndo(page);
  }
};

const COLS_BEFORE = [
  'a:paragraph:Alpha one',
  'cl1:column_list:',
  'c1:column:^cl1',
  'p1:paragraph:Left one^c1',
  'c2:column:^cl1',
  'p2:paragraph:Right two^c2',
  'z:paragraph:Zulu end',
];

/*
 * A mouse drag from a root paragraph into a column does not make a text selection: it becomes a
 * BLOCK selection of [a, p1, p2] (wave-4 note). Deleting it removes the last child of a column, so
 * removeBlock also removes the emptied column. That cascade must reach Yjs even though the caller
 * wrote the selected ids itself (block-removal.ts), or undo restores p1/p2 under columns the editor
 * no longer has and they land at the root.
 */
test.describe('W5X block selection that empties a column', () => {
  test('W5X-16: one undo of Backspace over a drag selection from a root paragraph into a column restores the columns', async ({ page }) => {
    await mount(page, COLS_DOC());
    // A column holder's first editable is its child's, so read the screen as loaded.
    const domBefore = await dom(page);

    await gap(page);
    await dragAtoP1(page);
    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(3);
    await page.keyboard.press('Backspace');
    await gap(page);
    const after = await lines(page);

    await pressUndo(page);
    expect(await lines(page), 'save() after one undo').toEqual(COLS_BEFORE);
    expect(await dom(page), 'screen after one undo').toEqual(domBefore);
    await pressRedo(page);
    expect(await lines(page), 'save() after redo').toEqual(after);
  });

  test('W5X-16b: after Backspace over a block selection that empties both columns, save() and the document agree', async ({ page }) => {
    await mount(page, COLS_DOC());
    await gap(page);
    await dragAtoP1(page);
    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(3);
    await page.keyboard.press('Backspace');
    await gap(page);

    expect(await saveIds(page), 'save() vs Yjs after the delete').toEqual(await yjsIds(page));
  });

  // Typing over the same selection: undoing it all brings the columns back in document order.
  test('W5X-17: undoing all of typing over a drag selection into a column restores the columns', async ({ page }) => {
    await mount(page, COLS_DOC());
    await gap(page);
    await dragAtoP1(page);
    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(3);
    await page.keyboard.type('Q');
    await gap(page);
    await undoAll(page);

    expect(await lines(page), 'save() after undoing everything').toEqual(COLS_BEFORE);
  });

  test('W5X-19: one undo of Backspace over a drag selection from a column out to a root paragraph restores the columns', async ({ page }) => {
    await mount(page, COLS_DOC());
    await gap(page);
    await dragBetweenCharacters(page, { editable: editable(page, 'p2'), offset: 3 }, { editable: editable(page, 'z'), offset: 2 });
    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(3);
    await page.keyboard.press('Backspace');
    await gap(page);
    await pressUndo(page);

    expect(await lines(page), 'save() after one undo').toEqual(COLS_BEFORE);
  });

  // The smallest trigger: select the only block of one column and press Backspace.
  test('W5X-25: one undo of deleting the only block of a column by block selection restores that column', async ({ page }) => {
    await mount(page, [
      ...COLS_DOC().slice(0, 6),
      { id: 'c3', type: 'column', data: {}, parent: 'cl1', content: ['p3'] },
      P('p3', 'Third', 'c3'),
      P('z', 'Zulu end'),
    ].map(b => (b.id === 'cl1' ? { ...b, content: ['c1', 'c2', 'c3'] } : b)));
    const before = await lines(page);

    await gap(page);
    await editable(page, 'p1').click();
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.press(`${MOD}+a`);
    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(1);
    await expect(page.locator('[data-blok-id="p1"][data-blok-selected="true"]')).toHaveCount(1);
    await page.keyboard.press('Backspace');
    await gap(page);
    const after = await lines(page);

    expect(after, 'the gesture removed p1').not.toContain('p1:paragraph:Left one^c1');
    await pressUndo(page);
    expect(await lines(page), 'save() after one undo').toEqual(before);
  });

  // Control: the column keeps a child, so no column is removed, and one undo is exact.
  test('W5X-25c: control — deleting one of two blocks of a column by block selection undoes exactly', async ({ page }) => {
    await mount(page, [
      ...COLS_DOC().slice(0, 4),
      P('p1b', 'Left two', 'c1'),
      ...COLS_DOC().slice(4),
    ].map(b => (b.id === 'c1' ? { ...b, content: ['p1', 'p1b'] } : b)));
    const before = await lines(page);

    await gap(page);
    await editable(page, 'p1').click();
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.press(`${MOD}+a`);
    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(1);
    await page.keyboard.press('Backspace');
    await gap(page);
    const after = await lines(page);

    expect(await saveIds(page)).toEqual(await yjsIds(page));
    await pressUndo(page);
    expect(await lines(page)).toEqual(before);
    await pressRedo(page);
    expect(await lines(page)).toEqual(after);
  });

  // Control: Shift+Down from a root paragraph does not extend a selection into the column (the caret
  // just moves); Backspace then deletes one letter in p1, and that undoes exactly.
  test('W5X-20c: control — Shift+Down into a column then Backspace undoes and redoes exactly', async ({ page }) => {
    const { after, redone } = await selectionRoundTrip(page, async () => {
      await editable(page, 'a').click();
      await page.keyboard.press('Home');
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('ArrowRight');
      }
      await page.keyboard.press('Shift+ArrowDown');
    }, () => page.keyboard.press('Backspace'));

    expect(redone, 'save() after redo').toEqual(after);
  });
});
