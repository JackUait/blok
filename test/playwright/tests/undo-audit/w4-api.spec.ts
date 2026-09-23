import type { Page } from '@playwright/test';
import type { Blok, BlockMutationEvent, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
const CAPTURE_GAP_MS = 700;

declare global {
  interface Window {
    blokInstance?: Blok;
    __changes?: string[][];
    __saves?: OutputData[];
    __errors?: string[];
    defaultBlockTools: Record<string, { class: unknown }>;
  }
}

type Block = OutputData['blocks'][number];

const P = (id: string, text: string): Block => ({ id, type: 'paragraph', data: { text } });

// Records onChange event types and onSave payloads on window.
const mount = async (page: Page, blocks: Block[]): Promise<void> => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ list }) => {
    document.getElementById('blok')?.remove();
    const d = document.createElement('div');

    d.id = 'blok';
    document.body.appendChild(d);
    window.__changes = [];
    window.__saves = [];
    const blok = new window.Blok({
      holder: 'blok',
      data: { blocks: list },
      onChange: (_api: unknown, event: BlockMutationEvent | BlockMutationEvent[]) => {
        const events = Array.isArray(event) ? event : [event];

        window.__changes?.push(events.map((e) => e.type));
      },
      onSave: (data: OutputData) => {
        window.__saves?.push(data);
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { list: blocks });
};

const saved = (page: Page): Promise<Block[]> =>
  page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('no editor');
    }

    return (await window.blokInstance.save()).blocks;
  });

const texts = async (page: Page): Promise<string[]> =>
  (await saved(page)).map((b) => {
    const text: unknown = (b.data as { text?: unknown }).text;

    return typeof text === 'string' ? text : `<${b.type}>`;
  });

const screenTexts = (page: Page): Promise<string[]> =>
  page.evaluate(() => Array.from(document.querySelectorAll('#blok [data-blok-id]'))
    .map((el) => (el.querySelector('[contenteditable]')?.textContent ?? '')));

const can = (page: Page): Promise<{ undo: boolean; redo: boolean }> => page.evaluate(() => ({
  undo: window.blokInstance?.history.canUndo() ?? false,
  redo: window.blokInstance?.history.canRedo() ?? false,
}));

const gap = (page: Page): Promise<void> => page.evaluate((ms) => new Promise<void>((r) => {
  window.setTimeout(r, ms);
}), CAPTURE_GAP_MS);

const typeAtEnd = async (page: Page, text: string, value: string): Promise<void> => {
  await page.getByText(text, { exact: true }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(value);
};

// Five separate typing steps: "a0" -> "a012345". No spaces, so word-boundary grouping cannot split a step.
const fiveSteps = async (page: Page): Promise<void> => {
  await page.getByText('a0', { exact: true }).click();
  await page.keyboard.press('End');
  for (const n of [1, 2, 3, 4, 5]) {
    await page.keyboard.type(String(n));
    await gap(page);
  }
};

// Cmd+Z auto-repeat: `count` keydowns, `everyMs` apart, timed inside the page so a slow test runner
// cannot stretch the interval. The first is a fresh press, the rest carry repeat: true like OS repeats.
const holdUndo = async (page: Page, count: number, everyMs: number): Promise<void> => {
  await page.evaluate(async ({ n, ms }) => {
    const target = document.activeElement ?? document.body;

    for (let i = 0; i < n; i++) {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, repeat: i > 0, bubbles: true, cancelable: true }));
      await new Promise((r) => {
        window.setTimeout(r, ms);
      });
    }
  }, { n: count, ms: everyMs });
  await gap(page);
};

// Pointer-drag block `id` by its handle to the top of block `targetId`, and stop before the drop.
const startDrag = async (page: Page, id: string, targetId: string): Promise<void> => {
  const box = await page.locator(`[data-blok-id="${id}"] [data-blok-element-content]`).first().boundingBox();

  if (box === null) {
    throw new Error('no box');
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const handle = page.locator('[data-blok-interface=blok] [data-blok-testid="settings-toggler"]');

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
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('undo audit W4A: public API, events, history engine', () => {
  // ---------- blocks API round trips ----------

  test('W4A-c1: undo/redo of blocks.insert removes and restores the block, and canUndo/canRedo follow', async ({ page }) => {
    await mount(page, [P('a', 'alpha')]);
    expect(await can(page)).toEqual({ undo: false, redo: false });
    await page.evaluate(() => window.blokInstance?.blocks.insert('paragraph', { text: 'beta' }, {}, 1, false, false, 'new1'));
    await gap(page);
    expect(await can(page)).toEqual({ undo: true, redo: false });
    await page.evaluate(() => window.blokInstance?.history.undo());
    await gap(page);
    expect(await texts(page)).toEqual(['alpha']);
    expect(await can(page)).toEqual({ undo: false, redo: true });
    await page.evaluate(() => window.blokInstance?.history.redo());
    await gap(page);
    expect(await texts(page)).toEqual(['alpha', 'beta']);
    expect(await screenTexts(page)).toEqual(['alpha', 'beta']);
    expect(await can(page)).toEqual({ undo: true, redo: false });
  });

  test('W4A-c2: one undo removes every block of one insertMany, redo restores them in order', async ({ page }) => {
    await mount(page, [P('a', 'alpha')]);
    await page.evaluate(() => window.blokInstance?.blocks.insertMany([
      { type: 'paragraph', data: { text: 'one' } },
      { type: 'paragraph', data: { text: 'two' } },
      { type: 'paragraph', data: { text: 'three' } },
    ], 1));
    await gap(page);
    await page.evaluate(() => window.blokInstance?.history.undo());
    await gap(page);
    expect(await texts(page)).toEqual(['alpha']);
    await page.evaluate(() => window.blokInstance?.history.redo());
    await gap(page);
    expect(await texts(page)).toEqual(['alpha', 'one', 'two', 'three']);
    expect(await screenTexts(page)).toEqual(['alpha', 'one', 'two', 'three']);
  });

  // Defect: undo of a block delete puts the block back at the wrong index when a move ran (and was undone) after the delete.
  // Root cause: a move rewrites the order array as remove + re-insert of the id (document-store.ts:810-818 applyPlacement,
  // document-store.ts:755 moveBlock), so the id's neighbours become new Yjs items. The delete's undo is a plain Yjs
  // resurrection (undo-history.ts:1047 undoManager.undo) anchored to the ORIGINAL neighbour items, and Yjs integrates it
  // after the re-inserted id. Reproduced with bare Yjs: [a,b,c] -> delete b -> move c -> move c back -> undo = [a,c,b].
  test('W4A-1: undo of a delete made before a keyboard move puts the block back where it was', async ({ page, browserName }) => {
    test.fail(browserName === 'chromium', 'W4A-1: resurrected id lands after the re-inserted neighbour');
    await mount(page, [P('a', 'alpha'), P('b', 'beta'), P('c', 'gamma')]);
    await page.evaluate(() => window.blokInstance?.blocks.delete(1, false));
    await gap(page);
    await page.getByText('gamma', { exact: true }).click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+ArrowUp' : 'Control+Shift+ArrowUp');
    await gap(page);
    await page.keyboard.press(UNDO);
    await gap(page);
    await page.keyboard.press(UNDO);
    await gap(page);

    expect(await texts(page)).toEqual(['alpha', 'beta', 'gamma']);
    expect(await screenTexts(page)).toEqual(['alpha', 'beta', 'gamma']);
  });

  // Same defect and root cause as W4A-1, through blocks.move() and history.undo().
  test('W4A-1b: undo of blocks.delete made before blocks.move puts the block back where it was', async ({ page, browserName }) => {
    test.fail(browserName === 'chromium', 'W4A-1b: resurrected id lands after the re-inserted neighbour');
    await mount(page, [P('a', 'alpha'), P('b', 'beta'), P('c', 'gamma')]);
    await page.evaluate(() => window.blokInstance?.blocks.delete(1, false));
    await gap(page);
    await page.evaluate(() => window.blokInstance?.blocks.move(0, 1));
    await gap(page);
    await page.evaluate(() => window.blokInstance?.history.undo());
    await gap(page);
    await page.evaluate(() => window.blokInstance?.history.undo());
    await gap(page);

    expect(await texts(page)).toEqual(['alpha', 'beta', 'gamma']);
    expect(await screenTexts(page)).toEqual(['alpha', 'beta', 'gamma']);
  });

  test('W4A-c3: undo/redo of blocks.delete, blocks.move and blocks.update each take one step', async ({ page }) => {
    await mount(page, [P('a', 'alpha'), P('b', 'beta'), P('c', 'gamma')]);
    await page.evaluate(() => window.blokInstance?.blocks.move(0, 2));
    await gap(page);
    await page.evaluate(() => window.blokInstance?.blocks.update('a', { text: 'ALPHA' }));
    await gap(page);
    await page.evaluate(() => window.blokInstance?.blocks.delete(2, false));
    await gap(page);
    expect(await texts(page)).toEqual(['gamma', 'ALPHA']);

    await page.evaluate(() => window.blokInstance?.history.undo());
    await gap(page);
    expect(await texts(page)).toEqual(['gamma', 'ALPHA', 'beta']);
    await page.evaluate(() => window.blokInstance?.history.undo());
    await gap(page);
    expect(await texts(page)).toEqual(['gamma', 'alpha', 'beta']);
    expect(await screenTexts(page)).toEqual(['gamma', 'alpha', 'beta']);
    await page.evaluate(() => window.blokInstance?.history.undo());
    await gap(page);
    expect(await texts(page)).toEqual(['alpha', 'beta', 'gamma']);
    expect(await screenTexts(page)).toEqual(['alpha', 'beta', 'gamma']);
    expect(await can(page)).toEqual({ undo: false, redo: true });

    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.blokInstance?.history.redo());
      await gap(page);
    }
    expect(await texts(page)).toEqual(['gamma', 'ALPHA']);
    expect(await screenTexts(page)).toEqual(['gamma', 'ALPHA']);
  });

  test('W4A-c4: undo of blocks.convert brings the paragraph back, redo makes it a heading again', async ({ page }) => {
    await mount(page, [P('a', 'alpha')]);
    await page.evaluate(() => window.blokInstance?.blocks.convert('a', 'header', { level: 2 }));
    await gap(page);
    await page.evaluate(() => window.blokInstance?.history.undo());
    await gap(page);
    expect((await saved(page)).map((b) => b.type)).toEqual(['paragraph']);
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
    await page.evaluate(() => window.blokInstance?.history.redo());
    await gap(page);
    expect((await saved(page)).map((b) => b.type)).toEqual(['header']);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('alpha');
  });

  test('W4A-c5: undo of deleting the only block brings it back without a stray empty block', async ({ page }) => {
    await mount(page, [P('a', 'alpha')]);
    await page.evaluate(() => window.blokInstance?.blocks.delete(0, false));
    await gap(page);
    // An empty paragraph is left out of save().
    expect(await texts(page)).toEqual([]);
    expect(await screenTexts(page)).toEqual(['']);
    await page.evaluate(() => window.blokInstance?.history.undo());
    await gap(page);
    expect(await texts(page)).toEqual(['alpha']);
    expect(await screenTexts(page)).toEqual(['alpha']);
    await page.evaluate(() => window.blokInstance?.history.redo());
    await gap(page);
    expect(await texts(page)).toEqual([]);
    expect(await screenTexts(page)).toEqual(['']);
  });

  test('W4A-c6: blocks.clear() can be undone', async ({ page }) => {
    await mount(page, [P('a', 'alpha'), P('b', 'beta')]);
    await page.evaluate(() => window.blokInstance?.blocks.clear());
    await gap(page);
    await page.evaluate(() => window.blokInstance?.history.undo());
    await gap(page);
    expect(await texts(page)).toEqual(['alpha', 'beta']);
  });

  // ---------- history.clear ----------

  test('W4A-c7: history.clear() empties both stacks, including typing still in the write buffer', async ({ page }) => {
    await mount(page, [P('a', 'alpha')]);
    await typeAtEnd(page, 'alpha', 'X');
    await gap(page);
    await page.keyboard.type('Y');
    await gap(page);
    await page.keyboard.press(UNDO);
    await gap(page);
    expect(await can(page)).toEqual({ undo: true, redo: true });
    await page.keyboard.type('Z');
    await page.evaluate(() => window.blokInstance?.history.clear());
    await gap(page);
    expect(await can(page)).toEqual({ undo: false, redo: false });
    await page.keyboard.press(UNDO);
    await gap(page);
    expect(await texts(page)).toEqual(['alphaXZ']);
  });

  // ---------- save() / onChange / onSave after undo ----------

  test('W4A-c14: save() called right after history.undo() returns the undone document', async ({ page }) => {
    await mount(page, [P('a', 'alpha'), P('b', 'beta')]);
    await typeAtEnd(page, 'alpha', 'X');
    await gap(page);
    await page.evaluate(() => window.blokInstance?.blocks.delete(1, false));
    await gap(page);
    const immediate = await page.evaluate(async () => {
      window.blokInstance?.history.undo();
      const first = (await window.blokInstance?.save())?.blocks.map((b) => String(b.data.text));

      window.blokInstance?.history.undo();
      const second = (await window.blokInstance?.save())?.blocks.map((b) => String(b.data.text));

      return { first, second };
    });

    expect(immediate).toEqual({ first: ['alphaX', 'beta'], second: ['alpha', 'beta'] });
  });

  test('W4A-c15: undo and redo each notify onChange and onSave with the new document', async ({ page }) => {
    await mount(page, [P('a', 'alpha')]);
    await typeAtEnd(page, 'alpha', 'X');
    await gap(page);
    await page.evaluate(() => {
      window.__changes = [];
      window.__saves = [];
    });
    await page.keyboard.press(UNDO);
    await gap(page);
    const afterUndo = await page.evaluate(() => ({
      changes: window.__changes ?? [],
      lastSave: window.__saves?.at(-1)?.blocks.map((b) => String(b.data.text)),
    }));

    expect(afterUndo.changes.length).toBeGreaterThan(0);
    expect(afterUndo.lastSave).toEqual(['alpha']);

    await page.evaluate(() => {
      window.__changes = [];
      window.__saves = [];
    });
    await page.keyboard.press(REDO);
    await gap(page);
    const afterRedo = await page.evaluate(() => ({
      changes: window.__changes ?? [],
      lastSave: window.__saves?.at(-1)?.blocks.map((b) => String(b.data.text)),
    }));

    expect(afterRedo.changes.length).toBeGreaterThan(0);
    expect(afterRedo.lastSave).toEqual(['alphaX']);
  });

  test('W4A-c16: undo of a block delete reports the block as added to onChange', async ({ page }) => {
    await mount(page, [P('a', 'alpha'), P('b', 'beta')]);
    await page.evaluate(() => window.blokInstance?.blocks.delete(1, false));
    await gap(page);
    await page.evaluate(() => {
      window.__changes = [];
    });
    await page.evaluate(() => window.blokInstance?.history.undo());
    await gap(page);
    const types = (await page.evaluate(() => window.__changes ?? [])).flat();

    expect(types.includes('block-added')).toBe(true);
    await page.evaluate(() => {
      window.__changes = [];
    });
    await page.evaluate(() => window.blokInstance?.history.redo());
    await gap(page);
    const redoTypes = (await page.evaluate(() => window.__changes ?? [])).flat();

    expect(redoTypes.includes('block-removed')).toBe(true);
  });

  // ---------- keyboard ----------

  test('W4A-c8: Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y and Cmd+Shift+Z all route to history', async ({ page }) => {
    await mount(page, [P('a', 'alpha')]);
    await typeAtEnd(page, 'alpha', 'X');
    await gap(page);
    await page.keyboard.press('Control+z');
    await gap(page);
    expect(await texts(page)).toEqual(['alpha']);
    await page.keyboard.press('Control+y');
    await gap(page);
    expect(await texts(page)).toEqual(['alphaX']);
    await page.keyboard.press('Control+z');
    await gap(page);
    await page.keyboard.press('Control+Shift+z');
    await gap(page);
    expect(await texts(page)).toEqual(['alphaX']);
    await page.keyboard.press(UNDO);
    await gap(page);
    await page.keyboard.press(REDO);
    await gap(page);
    expect(await texts(page)).toEqual(['alphaX']);
  });

  test('W4A-c9: Ctrl+Shift+Y is not treated as redo', async ({ page }) => {
    await mount(page, [P('a', 'alpha')]);
    await typeAtEnd(page, 'alpha', 'X');
    await gap(page);
    await page.keyboard.press(UNDO);
    await gap(page);
    await page.keyboard.press('Control+Shift+y');
    await gap(page);
    expect(await texts(page)).toEqual(['alpha']);
  });

  // Key repeats are real presses: the 50 ms dedupe must not swallow them, however fast the OS repeats.
  test('W4A-2: holding Cmd+Z undoes one step per key repeat', async ({ page }) => {
    await mount(page, [P('a', 'a0')]);
    await fiveSteps(page);
    await holdUndo(page, 5, 30);

    expect(await texts(page)).toEqual(['a0']);
  });

  test('W4A-c20: holding Cmd+Z with a slower key repeat undoes one step per repeat', async ({ page }) => {
    await mount(page, [P('a', 'a0')]);
    await fiveSteps(page);
    await holdUndo(page, 5, 80);
    expect(await texts(page)).toEqual(['a0']);
  });

  test('W4A-c21: Cmd+Z during a drag is ignored, and the drop is one undo step', async ({ page }) => {
    await mount(page, [P('a', 'alpha'), P('b', 'beta'), P('c', 'gamma')]);
    await typeAtEnd(page, 'alpha', 'X');
    await gap(page);
    await startDrag(page, 'c', 'a');
    await page.keyboard.press(UNDO);
    expect(await texts(page)).toEqual(['alphaX', 'beta', 'gamma']);
    await page.mouse.up();
    await gap(page);
    expect(await texts(page)).toEqual(['gamma', 'alphaX', 'beta']);
    await page.keyboard.press(UNDO);
    await gap(page);
    expect(await texts(page)).toEqual(['alphaX', 'beta', 'gamma']);
    expect(await screenTexts(page)).toEqual(['alphaX', 'beta', 'gamma']);
    await page.keyboard.press(REDO);
    await gap(page);
    expect(await screenTexts(page)).toEqual(['gamma', 'alphaX', 'beta']);
  });

  test('W4A-c22: history.undo() during a drag that removes the dragged block leaves a consistent document', async ({ page }) => {
    const errors: string[] = [];

    page.on('pageerror', (e) => errors.push(e.message));
    await mount(page, [P('a', 'alpha'), P('b', 'beta'), P('c', 'gamma')]);
    await page.evaluate(() => window.blokInstance?.blocks.insert('paragraph', { text: 'delta' }, {}, 3, false, false, 'd'));
    await gap(page);
    await startDrag(page, 'd', 'a');
    await page.evaluate(() => window.blokInstance?.history.undo());
    await page.mouse.up();
    await gap(page);
    expect(await texts(page)).toEqual(['alpha', 'beta', 'gamma']);
    expect(await screenTexts(page)).toEqual(['alpha', 'beta', 'gamma']);
    await page.keyboard.press(REDO);
    await gap(page);
    expect(await screenTexts(page)).toEqual(['alpha', 'beta', 'gamma', 'delta']);
    expect(errors).toEqual([]);
  });

  test('W4A-c11: fast alternating undo/redo presses leave data and screen in agreement', async ({ page }) => {
    await mount(page, [P('a', 'a0')]);
    await fiveSteps(page);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press(UNDO);
      await page.keyboard.press(REDO);
      await page.keyboard.press(UNDO);
    }
    await gap(page);
    const data = await texts(page);

    expect(await screenTexts(page)).toEqual(data);
    expect(await can(page)).toEqual({ undo: data[0] !== 'a0', redo: true });
  });

  test('W4A-c12: Cmd+Z right after typing, before the write buffer flushes, undoes that typing', async ({ page }) => {
    await mount(page, [P('a', 'alpha')]);
    await typeAtEnd(page, 'alpha', '1');
    await gap(page);
    await page.keyboard.type('2');
    await page.keyboard.press(UNDO);
    await gap(page);
    expect(await texts(page)).toEqual(['alpha1']);
    expect(await screenTexts(page)).toEqual(['alpha1']);
    await page.keyboard.press(REDO);
    await gap(page);
    expect(await texts(page)).toEqual(['alpha12']);
  });

  test('W4A-c13: typing right after undo is its own undo step', async ({ page }) => {
    await mount(page, [P('a', 'alpha')]);
    await typeAtEnd(page, 'alpha', '1');
    await gap(page);
    await page.keyboard.type('2');
    await gap(page);
    await page.keyboard.press(UNDO);
    await page.keyboard.type('!');
    await gap(page);
    expect(await texts(page)).toEqual(['alpha1!']);
    await page.keyboard.press(UNDO);
    await gap(page);
    expect(await texts(page)).toEqual(['alpha1']);
    expect(await can(page)).toEqual({ undo: true, redo: true });
  });

  // ---------- runtime updates must not touch history ----------

  test('W4A-c17: read-only on and off keeps both undo and redo', async ({ page }) => {
    await mount(page, [P('a', 'alpha')]);
    await typeAtEnd(page, 'alpha', '1');
    await gap(page);
    await page.keyboard.type('2');
    await gap(page);
    await page.keyboard.press(UNDO);
    await gap(page);
    await page.evaluate(async () => {
      await window.blokInstance?.readOnly.toggle(true);
      await window.blokInstance?.readOnly.toggle(false);
    });
    await gap(page);
    expect(await can(page)).toEqual({ undo: true, redo: true });
    await page.evaluate(() => window.blokInstance?.history.redo());
    await gap(page);
    expect(await texts(page)).toEqual(['alpha12']);
    await page.evaluate(() => {
      window.blokInstance?.history.undo();
      window.blokInstance?.history.undo();
    });
    await gap(page);
    expect(await texts(page)).toEqual(['alpha']);
  });

  test('W4A-c18: i18n.update, theme.set and tokens.set add no undo step and keep redo', async ({ page }) => {
    await mount(page, [
      P('a', 'alpha'),
      { id: 'h', type: 'header', data: { text: 'Head', level: 2 } },
      { id: 'l', type: 'list', data: { text: 'item', style: 'unordered' } },
      { id: 't', type: 'table', data: { withHeadings: false, content: [['c1', 'c2'], ['c3', 'c4']] } },
    ]);
    await typeAtEnd(page, 'alpha', '1');
    await gap(page);
    await page.keyboard.type('2');
    await gap(page);
    await page.keyboard.press(UNDO);
    await gap(page);
    const before = await saved(page);

    await page.evaluate(() => {
      window.__changes = [];
    });
    await page.evaluate(async () => {
      await window.blokInstance?.i18n.update({ locale: 'ru' });
      window.blokInstance?.theme.set('dark');
      window.blokInstance?.tokens.set({ '--blok-color-text': '#123456' });
      await window.blokInstance?.i18n.update({ locale: 'en', direction: 'rtl' });
    });
    await gap(page);
    expect(await can(page)).toEqual({ undo: true, redo: true });
    expect(await page.evaluate(() => window.__changes ?? [])).toEqual([]);
    // The list is left out: with a table on the page its saved shape changes on repaint, which is not history.
    const withoutList = (blocks: Block[]): Block[] => blocks.filter((b) => b.id !== 'l');

    expect(withoutList(await saved(page))).toEqual(withoutList(before));
    await page.keyboard.press(REDO);
    await gap(page);
    expect((await texts(page))[0]).toBe('alpha12');
    await page.evaluate(() => {
      window.blokInstance?.history.undo();
      window.blokInstance?.history.undo();
    });
    await gap(page);
    expect((await texts(page))[0]).toBe('alpha');
    expect(await can(page)).toEqual({ undo: false, redo: true });
  });

  // ---------- lifecycle ----------

  test('W4A-c19: a new editor on the holder of a destroyed one starts with empty history', async ({ page }) => {
    await mount(page, [P('a', 'alpha')]);
    await page.evaluate(() => {
      window.__errors = [];
      window.addEventListener('error', (e) => window.__errors?.push(String(e.message)));
      window.addEventListener('unhandledrejection', (e) => window.__errors?.push(String(e.reason)));
    });
    await typeAtEnd(page, 'alpha', 'X');
    await gap(page);
    await page.evaluate(async () => {
      window.blokInstance?.destroy();
      const blok = new window.Blok({ holder: 'blok', data: { blocks: [{ id: 'n', type: 'paragraph', data: { text: 'fresh' } }] } });

      window.blokInstance = blok;
      await blok.isReady;
    });
    expect(await can(page)).toEqual({ undo: false, redo: false });
    await typeAtEnd(page, 'fresh', 'Y');
    await gap(page);
    await page.keyboard.press(UNDO);
    await gap(page);
    expect(await texts(page)).toEqual(['fresh']);
    expect(await screenTexts(page)).toEqual(['fresh']);
    expect(await can(page)).toEqual({ undo: false, redo: true });
    expect(await page.evaluate(() => window.__errors ?? [])).toEqual([]);
  });
});
