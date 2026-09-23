/**
 * Undo/redo audit, wave 4, table (W4B).
 *
 * Expected everywhere: one undo reverts one gesture exactly, and redo brings
 * the exact post-gesture state back — in save() AND on screen.
 */
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { activateColorTab } from '../helpers/color-picker';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
// Yjs capture window is 500ms; wait past it so gestures stay separate undo steps.
const CAPTURE_GAP = 700;
const SETTINGS_BUTTON = '[data-blok-interface=blok] [data-blok-testid="settings-toggler"]';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type SavedBlock = OutputData['blocks'][number];
type CellSeed = string | SavedBlock[];

const createBlok = async (page: Page, data: OutputData): Promise<void> => {
  await page.evaluate(async ({ holder, initialData }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: initialData });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialData: data });
};

const save = async (page: Page): Promise<SavedBlock[]> => page.evaluate(async () => {
  if (!window.blokInstance) {
    throw new Error('no blok');
  }

  // lastEdited* is authorship metadata, not document state.
  return (await window.blokInstance.save()).blocks.map(({ lastEditedAt: _a, lastEditedBy: _b, ...rest }) => rest);
});

const gap = async (page: Page, ms = CAPTURE_GAP): Promise<void> => {
  await page.evaluate(async (t) => {
    await new Promise<void>(resolve => {
      window.setTimeout(resolve, t);
    });
  }, ms);
};

/** Undo with the caret parked in a plain paragraph outside the table. */
const undo = async (page: Page): Promise<void> => {
  await page.locator('[data-blok-id="p-before"] [contenteditable="true"]').click();
  await page.keyboard.press(UNDO);
  await gap(page, 500);
};

const redo = async (page: Page): Promise<void> => {
  await page.keyboard.press(REDO);
  await gap(page, 500);
};

/** What the grid shows: per row, each rendered cell's text plus its span when merged. */
const grid = async (page: Page): Promise<string[][]> => page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-blok-table-row]')).map(row =>
    Array.from(row.querySelectorAll(':scope > [data-blok-table-cell]')).map(c => {
      const text = Array.from(c.querySelectorAll('[contenteditable="true"]')).map(e => (e.textContent ?? '').trim()).join('|');
      const span = `${c.getAttribute('colspan') ?? '1'}x${c.getAttribute('rowspan') ?? '1'}`;

      return span === '1x1' ? text : `${text}@${span}`;
    })));

const cell = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  page.locator(`[data-blok-table-cell-row="${row}"][data-blok-table-cell-col="${col}"]`);

const box = async (locator: ReturnType<Page['locator']>, what: string): Promise<{ x: number; y: number; width: number; height: number }> => {
  const b = await locator.boundingBox();

  if (b === null) {
    throw new Error(`${what} has no box`);
  }

  return b;
};

const selectCells = async (page: Page, r0: number, c0: number, r1: number, c1: number): Promise<void> => {
  const a = await box(cell(page, r0, c0), 'start cell');
  const b = await box(cell(page, r1, c1), 'end cell');

  await page.mouse.move(a.x + a.width * 0.3, a.y + a.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.6, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('[data-blok-table-cell-selected]')).not.toHaveCount(0);
};

const openPill = async (page: Page): Promise<void> => {
  const pill = page.locator('[data-blok-table-selection-pill]');

  await expect(pill).toBeAttached();
  const b = await box(pill, 'pill');

  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await expect(pill).toBeVisible();
  await pill.click();
};

const openRowGrip = async (page: Page, row: number): Promise<void> => {
  await cell(page, row, 0).click();
  const grip = page.locator(`[data-blok-table-grip-row="${row}"]`);

  await expect(grip).toBeVisible();
  await grip.click();
};

const openColGrip = async (page: Page, col: number): Promise<void> => {
  await cell(page, 0, col).click();
  const grip = page.locator(`[data-blok-table-grip-col="${col}"]`);

  await expect(grip).toBeVisible();
  await grip.click();
};

const menuItem = (page: Page, name: string): ReturnType<Page['locator']> =>
  page.getByRole('menuitem', { name, exact: true });

const dragBy = async (page: Page, locator: ReturnType<Page['locator']>, dx: number, dy: number): Promise<void> => {
  const b = await box(locator, 'drag handle');
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
};

const dispatchPaste = async (page: Page, html: string, plain: string): Promise<void> => {
  await page.evaluate(({ htmlData, plainData }) => {
    const target = document.activeElement;

    if (!(target instanceof HTMLElement)) {
      throw new Error('no active element');
    }
    const ev = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
      clipboardData: {
        getData: (type: string): string => ({ 'text/html': htmlData, 'text/plain': plainData } as Record<string, string>)[type] ?? '',
        types: ['text/html', 'text/plain'],
      },
    });

    target.dispatchEvent(ev);
  }, { htmlData: html, plainData: plain });
};

/**
 * A table as the current version saves it: cell blocks plus row and column ids.
 * A cell seed is either its text, or a list of child blocks (first one's id is used as-is).
 */
const tableDoc = (rows: CellSeed[][], extra: Record<string, unknown> = {}): OutputData => {
  const kids: SavedBlock[] = [];
  const content = rows.map((row, r) => row.map((seed, c) => {
    if (typeof seed === 'string') {
      const id = `c${r}${c}`;

      kids.push({ id, type: 'paragraph', data: { text: seed }, parent: 'tbl' });

      return { blocks: [id], id: `k${c}`, rowId: `r${r}` };
    }
    kids.push(...seed);

    return { blocks: seed.filter(b => b.parent === 'tbl').map(b => b.id ?? ''), id: `k${c}`, rowId: `r${r}` };
  }));

  return {
    blocks: [
      { id: 'p-before', type: 'paragraph', data: { text: 'before' } },
      {
        id: 'tbl',
        type: 'table',
        data: { withHeadings: false, withHeadingColumn: false, content, ...extra },
        content: kids.filter(k => k.parent === 'tbl').map(k => k.id ?? ''),
      },
      ...kids,
      { id: 'p-after', type: 'paragraph', data: { text: 'after' } },
    ],
  };
};

const DOC_3x3 = (): OutputData => tableDoc([
  ['A1', 'B1', 'C1'],
  ['A2', 'B2', 'C2'],
  ['A3', 'B3', 'C3'],
]);

const DOC_2x2_PX = (): OutputData => tableDoc([
  ['A1', 'B1'],
  ['A2', 'B2'],
], { colWidths: [160, 160] });

/**
 * save() with the table's cell blocks sorted by id. Their flat position is not
 * document state: the table's `content` grid is what orders them.
 */
const doc = async (page: Page): Promise<SavedBlock[]> => {
  const blocks = await save(page);

  return [
    ...blocks.filter(b => b.parent !== 'tbl').map(b => (b.id === 'tbl' ? { ...b, content: [...(b.content ?? [])].sort() } : b)),
    ...blocks.filter(b => b.parent === 'tbl').sort((a, b) => (a.id ?? '').localeCompare(b.id ?? '')),
  ];
};

/** Run a gesture and check undo restores `before` and redo restores `after`, on screen and in save(). */
const roundTrip = async (page: Page, gesture: () => Promise<void>): Promise<void> => {
  const before = await doc(page);
  const gridBefore = await grid(page);

  await gap(page);
  await gesture();
  await gap(page);
  const after = await doc(page);
  const gridAfter = await grid(page);

  expect(after, 'gesture changed the document').not.toEqual(before);

  await undo(page);
  expect(await grid(page), 'grid after undo').toEqual(gridBefore);
  expect(await doc(page), 'save() after undo').toEqual(before);

  await redo(page);
  expect(await grid(page), 'grid after redo').toEqual(gridAfter);
  expect(await doc(page), 'save() after redo').toEqual(after);
};

test.describe.configure({ retries: 0 });

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('W4B merge / split', () => {
  test('W4B-1: undo of a 2x2 merge brings back four cells with their text, redo merges again', async ({ page }) => {
    await createBlok(page, DOC_3x3());
    await roundTrip(page, async () => {
      await selectCells(page, 0, 0, 1, 1);
      await openPill(page);
      await page.getByText('Merge cells', { exact: true }).click();
      await expect(cell(page, 0, 0)).toHaveAttribute('colspan', '2');
    });
  });

  test('W4B-2: undo of splitting a merged cell merges it again, redo splits it', async ({ page }) => {
    const doc = tableDoc([['A1', 'B1'], ['A2', 'B2']]);
    const t = doc.blocks[1].data as { content: Array<Array<Record<string, unknown>>> };

    t.content[0][0] = { ...t.content[0][0], colspan: 2 };
    t.content[0][1] = { ...t.content[0][1], blocks: [], mergedInto: [0, 0] };
    doc.blocks = doc.blocks.filter(b => b.id !== 'c01');
    doc.blocks[1].content = (doc.blocks[1].content ?? []).filter(id => id !== 'c01');
    await createBlok(page, doc);
    await expect(cell(page, 0, 0)).toHaveAttribute('colspan', '2');

    await roundTrip(page, async () => {
      const a = await box(cell(page, 0, 0), 'origin');
      const b = await box(cell(page, 1, 0), 'below');

      await page.mouse.move(a.x + a.width * 0.25, a.y + a.height * 0.75);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
      await expect(page.locator('[data-blok-table-cell-selected]')).not.toHaveCount(0);
      await page.mouse.move(a.x + a.width * 0.25, a.y + a.height * 0.75, { steps: 8 });
      await page.mouse.up();
      await openPill(page);
      await page.getByText('Split cell', { exact: true }).click();
      await expect(cell(page, 0, 1)).toHaveCount(1);
    });
  });
});

test.describe('W4B colours / headers', () => {
  const pickCellColor = async (page: Page, mode: 'textColor' | 'backgroundColor', name: string): Promise<void> => {
    await openPill(page);
    const item = page.getByText('Color', { exact: true });

    await expect(item).toBeVisible();
    await item.hover();
    await expect(page.locator('[data-blok-testid="cell-color-picker"]')).toBeVisible();
    await activateColorTab(page, 'cell-color', mode);
    await page.locator(`[data-blok-testid="cell-color-swatch-${mode}-${name}"]`).click({ force: true });
    await page.mouse.click(5, 5);
  };

  test('W4B-3: undo/redo of a cell background colour on two cells', async ({ page }) => {
    await createBlok(page, DOC_3x3());
    await roundTrip(page, async () => {
      await selectCells(page, 0, 0, 0, 1);
      await pickCellColor(page, 'backgroundColor', 'orange');
      expect(await cell(page, 0, 1).evaluate(el => (el as HTMLElement).style.backgroundColor)).not.toBe('');
    });
  });

  test('W4B-4: undo/redo of a cell text colour on two cells', async ({ page }) => {
    await createBlok(page, DOC_3x3());
    await roundTrip(page, async () => {
      await selectCells(page, 0, 0, 0, 1);
      await pickCellColor(page, 'textColor', 'blue');
    });
    await undo(page);
    expect(await cell(page, 0, 0).evaluate(el => (el as HTMLElement).style.color), 'text colour on screen after undo').toBe('');
  });

  test('W4B-5: undo/redo of turning the header row on', async ({ page }) => {
    await createBlok(page, DOC_3x3());
    await roundTrip(page, async () => {
      await openRowGrip(page, 0);
      await page.getByRole('switch', { name: 'Header row' }).click();
      await page.keyboard.press('Escape');
    });
    await undo(page);
    await expect(page.getByRole('columnheader'), 'header cells after undo').toHaveCount(0);
    await redo(page);
    await expect(page.getByRole('columnheader'), 'header cells after redo').toHaveCount(3);
  });

  test('W4B-6: undo/redo of turning the header column on', async ({ page }) => {
    await createBlok(page, DOC_3x3());
    await roundTrip(page, async () => {
      await openColGrip(page, 0);
      await page.getByRole('switch', { name: 'Header column' }).click();
      await page.keyboard.press('Escape');
    });
    await undo(page);
    await expect(page.getByRole('rowheader'), 'row headers after undo').toHaveCount(0);
    await redo(page);
    await expect(page.getByRole('rowheader'), 'row headers after redo').toHaveCount(3);
  });

  test('W4B-7: undo/redo of a row colour from the grip menu', async ({ page }) => {
    await createBlok(page, DOC_3x3());
    await roundTrip(page, async () => {
      await openRowGrip(page, 1);
      await page.getByText('Color', { exact: true }).hover();
      await activateColorTab(page, 'cell-color', 'backgroundColor');
      await page.locator('[data-blok-testid="cell-color-swatch-backgroundColor-green"]').click({ force: true });
      await page.mouse.click(5, 5);
      expect(await cell(page, 1, 2).evaluate(el => (el as HTMLElement).style.backgroundColor)).not.toBe('');
    });
  });
});

test.describe('W4B structure', () => {
  test('W4B-8: undo/redo of dragging row 1 below row 2', async ({ page }) => {
    await createBlok(page, DOC_3x3());
    await roundTrip(page, async () => {
      await cell(page, 0, 0).click();
      const grip = page.locator('[data-blok-table-grip-row="0"]');

      await expect(grip).toBeVisible();
      const target = await box(cell(page, 1, 0), 'row 2');
      const g = await box(grip, 'grip');

      await dragBy(page, grip, 0, target.y + target.height + 4 - (g.y + g.height / 2));
      await expect.poll(async () => (await grid(page))[0][0]).toBe('A2');
    });
  });

  test('W4B-9: undo/redo of Insert row above', async ({ page }) => {
    await createBlok(page, DOC_3x3());
    await roundTrip(page, async () => {
      await openRowGrip(page, 1);
      await menuItem(page, 'Insert row above').click();
      await expect.poll(async () => (await grid(page)).length).toBe(4);
    });
  });

  test('W4B-10: undo/redo of Insert column left', async ({ page }) => {
    await createBlok(page, DOC_3x3());
    await roundTrip(page, async () => {
      await openColGrip(page, 1);
      await menuItem(page, 'Insert column left').click();
      await expect.poll(async () => (await grid(page))[0].length).toBe(4);
    });
  });

  test('W4B-11: undo/redo of Duplicate row', async ({ page }) => {
    await createBlok(page, DOC_3x3());
    await roundTrip(page, async () => {
      await openRowGrip(page, 1);
      await menuItem(page, 'Duplicate').click();
      await expect.poll(async () => (await grid(page)).length).toBe(4);
    });
  });

  test('W4B-12: undo/redo of Duplicate column', async ({ page }) => {
    await createBlok(page, DOC_3x3());
    await roundTrip(page, async () => {
      await openColGrip(page, 1);
      await menuItem(page, 'Duplicate').click();
      await expect.poll(async () => (await grid(page))[0].length).toBe(4);
    });
  });

  test('W4B-13: one undo of Delete on a 2x2 cell selection brings all four texts back', async ({ page }) => {
    await createBlok(page, DOC_3x3());
    await roundTrip(page, async () => {
      await selectCells(page, 0, 0, 1, 1);
      await page.keyboard.press('Delete');
      await expect.poll(async () => (await grid(page))[0][0]).toBe('');
    });
  });

  test('W4B-14: one undo of grip Clear contents on a row brings the row text back', async ({ page }) => {
    await createBlok(page, DOC_3x3());
    await roundTrip(page, async () => {
      await openRowGrip(page, 1);
      await menuItem(page, 'Clear contents').click();
      await expect.poll(async () => (await grid(page))[1]).toEqual(['', '', '']);
    });
  });

  test('W4B-15: one undo of pasting a 2x2 table over cells brings the old texts back', async ({ page }) => {
    await createBlok(page, DOC_3x3());
    await roundTrip(page, async () => {
      await cell(page, 0, 0).locator('[contenteditable="true"]').click();
      await dispatchPaste(page, '<table><tr><td>X1</td><td>Y1</td></tr><tr><td>X2</td><td>Y2</td></tr></table>', 'X1\tY1\nX2\tY2');
      await expect.poll(async () => (await grid(page))[1][1]).toBe('Y2');
    });
  });

  test('W4B-16: undo then redo of a corner drag that adds a column and a row', async ({ page }) => {
    // Defect: redo does nothing. Same symptom as W4B-21; the throw below was traced (CDP) for W4B-21 only.
    // Root cause: Table.setData (src/tools/table/index.ts:1106,1190) saves the visible grip index
    // (the new last row/col, still hovered) and restores it on the SHRUNK grid; showRowGrip/showColGrip
    // (table-row-col-controls.ts:654-661, 636-643) pass rowGrips[index] === undefined to
    // applyVisibleClasses (:672) which throws. Block setData reports failure, yjs-sync rematerializes
    // the table (yjs-sync.ts:1117), its rendered() runs removeGhostChildren (index.ts:747, 879-898),
    // and those api.blocks.delete calls sit in a captured transact — a new local step that clears redo.
    test.fail();
    await createBlok(page, DOC_2x2_PX());
    await roundTrip(page, async () => {
      await cell(page, 1, 1).hover();
      const corner = page.locator('[data-blok-table-corner-drag]');

      await dragBy(page, corner, 170, 50);
      await expect.poll(async () => (await grid(page))[0].length).toBeGreaterThan(2);
      await expect.poll(async () => (await grid(page)).length).toBeGreaterThan(2);
    });
  });

  test('W4B-17: typing in a cell then a header-row toggle: two undos revert both, in order', async ({ page }) => {
    await createBlok(page, DOC_3x3());
    const before = await save(page);

    await gap(page);
    await cell(page, 1, 1).locator('[contenteditable="true"]').click();
    await page.keyboard.press('End');
    await page.keyboard.type('xyz');
    await gap(page);
    const typed = await save(page);

    await openRowGrip(page, 0);
    await page.getByRole('switch', { name: 'Header row' }).click();
    await page.keyboard.press('Escape');
    await gap(page);

    await undo(page);
    expect(await save(page), 'after first undo: typed text, no header').toEqual(typed);
    await undo(page);
    expect(await save(page), 'after second undo: original').toEqual(before);
    expect((await grid(page))[1][1]).toBe('B2');
  });

  test('W4B-18: undo of deleting the whole table brings back the table with its cell block ids', async ({ page }) => {
    await createBlok(page, DOC_3x3());
    const before = await save(page);
    const gridBefore = await grid(page);

    await gap(page);
    await cell(page, 0, 0).click();
    await page.locator(SETTINGS_BUTTON).click();
    const del = page.locator('[data-blok-testid="block-tunes-popover"] [data-blok-item-name="delete"]');

    await del.click();
    if (await del.isVisible()) {
      await del.click();
    }
    await expect.poll(async () => (await save(page)).some(b => b.type === 'table')).toBe(false);
    await gap(page);
    const after = await save(page);

    await undo(page);
    expect(await save(page), 'save() after undo').toEqual(before);
    expect(await grid(page), 'grid after undo').toEqual(gridBefore);

    await redo(page);
    expect(await save(page), 'save() after redo').toEqual(after);
  });

  test('W4B-19: undo/redo of a row drag keeps a nested list inside a cell', async ({ page }) => {
    const list: SavedBlock[] = [
      { id: 'li1', type: 'list', data: { text: 'one', style: 'unordered' }, parent: 'tbl' },
      { id: 'li2', type: 'list', data: { text: 'two', style: 'unordered', depth: 1 }, parent: 'tbl' },
    ];

    await createBlok(page, tableDoc([['A1', list], ['A2', 'B2'], ['A3', 'B3']]));
    await roundTrip(page, async () => {
      await cell(page, 0, 0).click();
      const grip = page.locator('[data-blok-table-grip-row="0"]');

      await expect(grip).toBeVisible();
      const target = await box(cell(page, 1, 0), 'row 2');
      const g = await box(grip, 'grip');

      await dragBy(page, grip, 0, target.y + target.height + 4 - (g.y + g.height / 2));
      await expect.poll(async () => (await grid(page))[0][0]).toBe('A2');
    });
  });

  test('W4B-20: undo/redo of the table Full width setting', async ({ page }) => {
    await createBlok(page, DOC_3x3());
    await roundTrip(page, async () => {
      await cell(page, 0, 0).click();
      await page.locator(SETTINGS_BUTTON).click();
      await page.locator('[data-blok-item-name="table-full-width"]').click();
      await page.keyboard.press('Escape');
      expect((await save(page)).find(b => b.id === 'tbl')?.data.stretched).toBe(true);
    });
  });

  test('W4B-21: undo/redo of the add-row button below the table', async ({ page }) => {
    // Defect: redo does nothing — canRedo() is already false right after the undo.
    // Root cause: Table.setData (src/tools/table/index.ts:1106,1190) saves the visible grip index
    // (the new last row/col, still hovered) and restores it on the SHRUNK grid; showRowGrip/showColGrip
    // (table-row-col-controls.ts:654-661, 636-643) pass rowGrips[index] === undefined to
    // applyVisibleClasses (:672) which throws. Block setData reports failure, yjs-sync rematerializes
    // the table (yjs-sync.ts:1117), its rendered() runs removeGhostChildren (index.ts:747, 879-898),
    // and those api.blocks.delete calls sit in a captured transact — a new local step that clears redo.
    test.fail();
    await createBlok(page, DOC_3x3());
    await roundTrip(page, async () => {
      await cell(page, 2, 0).hover();
      await page.locator('[data-blok-table-add-row]').click();
      await expect.poll(async () => (await grid(page)).length).toBe(4);
    });
  });

  test('W4B-16b: one undo of a corner drag that adds a column and a row returns the table to 2x2', async ({ page }) => {
    await createBlok(page, DOC_2x2_PX());
    const before = await doc(page);

    await gap(page);
    await cell(page, 1, 1).hover();
    await dragBy(page, page.locator('[data-blok-table-corner-drag]'), 170, 50);
    await expect.poll(async () => (await grid(page)).length).toBeGreaterThan(2);
    await gap(page);

    await undo(page);
    expect(await doc(page)).toEqual(before);
    expect(await grid(page)).toEqual([['A1', 'B1'], ['A2', 'B2']]);
  });

  // Same root cause as W4B-16/21, reached the ordinary way: add a row under the last one from its
  // grip, then press Cmd+Z with the caret in the new row. Its grip is the visible one.
  test('W4B-22: redo after undoing Insert row below on the last row, with the caret in the new row', async ({ page }) => {
    test.fail();
    await createBlok(page, DOC_3x3());
    await gap(page);
    await openRowGrip(page, 2);
    await menuItem(page, 'Insert row below').click();
    await expect.poll(async () => (await grid(page)).length).toBe(4);
    await gap(page);
    const after = await doc(page);

    await cell(page, 3, 1).locator('[contenteditable="true"]').click();
    await page.keyboard.press(UNDO);
    await gap(page, 500);
    await expect.poll(async () => (await grid(page)).length).toBe(3);

    expect(await page.evaluate(() => window.blokInstance?.history.canRedo()), 'canRedo after undo').toBe(true);
    await redo(page);
    expect(await doc(page), 'save() after redo').toEqual(after);
  });

  test('W4B-22b: control — same undo with the caret in row 1 keeps redo', async ({ page }) => {
    await createBlok(page, DOC_3x3());
    await gap(page);
    await openRowGrip(page, 2);
    await menuItem(page, 'Insert row below').click();
    await expect.poll(async () => (await grid(page)).length).toBe(4);
    await gap(page);
    const after = await doc(page);

    await cell(page, 0, 1).locator('[contenteditable="true"]').click();
    await page.keyboard.press(UNDO);
    await gap(page, 500);
    await expect.poll(async () => (await grid(page)).length).toBe(3);

    expect(await page.evaluate(() => window.blokInstance?.history.canRedo()), 'canRedo after undo').toBe(true);
    await redo(page);
    expect(await doc(page), 'save() after redo').toEqual(after);
  });

  const dragAddRow = async (page: Page, steps: number): Promise<void> => {
    await cell(page, 2, 0).hover();
    const btn = page.locator('[data-blok-table-add-row]');

    await expect(btn).toBeVisible();
    const b = await box(btn, 'add-row button');
    const rowH = (await box(cell(page, 2, 0), 'row')).height;

    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + rowH * 2.5, { steps });
    await page.mouse.up();
  };

  // Defect: a drag on the add-row button that adds two rows needs two undos (one per row).
  // Root cause: onDragStart opens a group with beginTransaction (table-subsystems.ts:267-271), but each
  // row is added through runTransactedStructuralOp (table-subsystems.ts:278, index.ts:198-209) →
  // api.blocks.transact → BlockManager.transactForTool (blockManager.ts:943). Its nested
  // endToolTransaction always calls YjsManager.stopCapturing() in a microtask (blockManager.ts:998/1002),
  // even while the outer drag group is still open, so every row closes its own undo step.
  // The corner drag's add callbacks use plain runStructuralOp and stay one step (W4B-16b).
  test('W4B-23: one undo of a drag on the add-row button removes both added rows', async ({ page }) => {
    test.fail();
    await createBlok(page, DOC_3x3());
    const before = await doc(page);

    await gap(page);
    await dragAddRow(page, 12);
    await expect.poll(async () => (await grid(page)).length).toBeGreaterThan(3);
    await gap(page);

    await undo(page);
    expect((await grid(page)).length, 'rows after one undo').toBe(3);
    expect(await doc(page)).toEqual(before);
  });

  // Both rows are added inside one pointermove, before the first microtask stopCapturing runs.
  test('W4B-23b: control — a flick that adds both rows in one pointermove is one undo step', async ({ page }) => {
    await createBlok(page, DOC_3x3());
    const before = await doc(page);

    await gap(page);
    await dragAddRow(page, 1);
    await expect.poll(async () => (await grid(page)).length).toBeGreaterThan(3);
    await gap(page);

    await undo(page);
    expect((await grid(page)).length, 'rows after one undo').toBe(3);
    expect(await doc(page)).toEqual(before);
  });

});
