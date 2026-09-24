/**
 * Undo/redo audit, wave 5: how far the three wave-4 root-cause families spread (W5F).
 *
 * A. The block's document data lacks a key its tool's save() always emits. The first
 *    save-back after a structural gesture writes that key as its own tracked step, so the
 *    first Cmd+Z is a no-op.
 * B. The document is seeded from the host's data, then something rewrites the block
 *    (DOM or tool data) before the first edit. The first undo in that block reverts the rewrite.
 * C. A no-op structural key leaves a caret snapshot pending. The next change reached by
 *    mouse or API takes it as its "before" caret.
 */
import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const CAPTURE_GAP_MS = 700;
const HANDLE = '[data-blok-interface=blok] [data-blok-testid="settings-toggler"]';
const TUNES_POPOVER = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const NESTED_POPOVER = '[data-blok-nested="true"] [data-blok-testid="popover-container"]';
const TOOLBAR = '[data-blok-testid=inline-toolbar]';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type Blocks = OutputData['blocks'];

const create = async (page: Page, blocks: Blocks): Promise<void> => {
  await page.evaluate(async ({ holder, list }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);
    const blok = new window.Blok({ holder, data: { blocks: list } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, list: blocks });
};

const gap = (page: Page, ms = CAPTURE_GAP_MS): Promise<void> => page.evaluate((t) => new Promise<void>((r) => {
  window.setTimeout(r, t);
}), ms);

const settle = (page: Page): Promise<void> => gap(page, 400);

const undo = async (page: Page): Promise<void> => {
  await page.keyboard.press(UNDO);
  await settle(page);
};

/** Number of entries on the Yjs undo stack. */
const stack = (page: Page): Promise<number> => page.evaluate(() => {
  const b = window.blokInstance as unknown as { module: { yjsManager: { undoHistory: { undoManager: { undoStack: unknown[] } } } } };

  return b.module.yjsManager.undoHistory.undoManager.undoStack.length;
});

/** Log every change to block `id`'s Y.Map: which keys, and whether the undo manager tracks it. Read back with `keyLog`. */
const watchKeys = (page: Page, id: string): Promise<void> => page.evaluate((blockId) => {
  const w = window as unknown as { blokInstance: { module: { yjsManager: {
    getBlockById: (i: string) => { observeDeep: (cb: (events: Array<{ path: unknown[]; changes: { keys: Map<string, { action: string }> } }>, tr: { origin: unknown }) => void) => void };
    undoHistory: { undoManager: { trackedOrigins: Set<unknown> } };
  } } }; __keys: string[] };
  const ym = w.blokInstance.module.yjsManager;

  w.__keys = [];
  ym.getBlockById(blockId).observeDeep((events, tr) => {
    const tracked = ym.undoHistory.undoManager.trackedOrigins.has(tr.origin);
    const keys = events.flatMap((e) => Array.from(e.changes.keys.entries()).map(([k, v]) => `${e.path.join('.')}.${k}:${v.action}`));

    w.__keys.push(`${tracked ? 'tracked' : 'untracked'}[${keys.join(',')}]`);
  });
}, id);

const keyLog = (page: Page): Promise<string> => page.evaluate(() => (window as unknown as { __keys: string[] }).__keys.join(' '));

interface State {
  dom: string[];
  saved: string[];
}

/** One line per block for the screen and for save() (ids and edit metadata left out). */
const state = (page: Page): Promise<State> => page.evaluate(async (holder) => {
  const root = document.getElementById(holder);
  const wrappers = root === null ? [] : Array.from(root.querySelectorAll('[data-blok-testid="block-wrapper"]'));
  const own = (w: Element, sel: string): Element[] =>
    Array.from(w.querySelectorAll(sel)).filter((e) => e.closest('[data-blok-testid="block-wrapper"]') === w);
  const dom = wrappers.map((w) => {
    const marker = own(w, '[data-list-marker]')[0]?.textContent ?? '';
    const box = own(w, 'input[type="checkbox"]')[0] as HTMLInputElement | undefined;
    const tick = box?.checked === true ? '[x]' : '[ ]';
    const text = own(w, '[contenteditable]:not([contenteditable="false"])').map((e) => e.innerHTML.replace(/&nbsp;/g, ' ')).join('¦');

    return `${w.getAttribute('data-blok-component') ?? '?'}|d${w.getAttribute('data-blok-depth') ?? '0'}|${marker}${box === undefined ? '' : tick}|${text}`;
  });
  const out = await window.blokInstance?.save();
  const blocks = out?.blocks ?? [];
  const ids = blocks.map((b) => b.id);
  const saved = blocks.map((b) => `${b.type}|${JSON.stringify(b.data).replace(/&nbsp;/g, ' ')}|p${b.parent === undefined ? '-' : ids.indexOf(b.parent)}`);

  return { dom, saved };
}, HOLDER_ID);

/** "id@offset" of the caret, 'none' without a selection, 'outside' when it is not in a block editable. */
const caret = (page: Page): Promise<string> => page.evaluate(() => {
  const sel = window.getSelection();

  if (sel === null || sel.rangeCount === 0) {
    return 'none';
  }
  const node = sel.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement;
  const wrapper = el?.closest('[data-blok-id]');
  const editable = el?.closest('[contenteditable]:not([contenteditable="false"])');

  if (!wrapper || !editable || document.getElementById('blok')?.contains(editable) !== true) {
    return 'outside';
  }
  const r = document.createRange();

  r.setStart(editable, 0);
  r.setEnd(sel.anchorNode as Node, sel.anchorOffset);

  return `${wrapper.getAttribute('data-blok-id') ?? '?'}@${r.toString().length}`;
});

const editable = (page: Page, id: string): Locator => page.locator(`[data-blok-id="${id}"] [contenteditable]:not([contenteditable="false"])`).first();

/** Put the caret in block `id` at text offset `at` ('end' = end of its first editable). */
const caretAt = async (page: Page, id: string, at: number | 'end'): Promise<void> => {
  const target = editable(page, id);

  await target.click();
  await target.evaluate((el: HTMLElement, offset: number | 'end') => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let left = offset === 'end' ? Number.MAX_SAFE_INTEGER : offset;
    let last: Text | null = null;
    let placed = false;

    for (let n = walker.nextNode() as Text | null; n !== null; n = walker.nextNode() as Text | null) {
      last = n;
      if (left <= n.length) {
        range.setStart(n, left);
        placed = true;
        break;
      }
      left -= n.length;
    }
    if (!placed) {
      if (last === null) {
        range.setStart(el, 0);
      } else {
        range.setStart(last, last.length);
      }
    }
    range.collapse(true);
    const sel = window.getSelection();

    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, at);
};

/** Select the first occurrence of `needle` (one text node). */
const select = async (page: Page, needle: string): Promise<void> => {
  await page.evaluate((n) => {
    const root = document.getElementById('blok');

    if (!root) {
      throw new Error('no holder');
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const index = node.data.indexOf(n);

      if (index !== -1) {
        const range = document.createRange();

        range.setStart(node, index);
        range.setEnd(node, index + n.length);
        const host = node.parentElement?.closest('[contenteditable="true"]');

        (host instanceof HTMLElement ? host : undefined)?.focus();
        const selection = window.getSelection();

        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event('selectionchange'));

        return;
      }
    }
    throw new Error(`text not found: ${n}`);
  }, needle);
};

const paste = (page: Page, payload: Record<string, string>): Promise<void> => page.evaluate((data) => {
  const transfer = new DataTransfer();

  for (const [format, value] of Object.entries(data)) {
    transfer.setData(format, value);
  }
  (document.activeElement ?? document.body).dispatchEvent(
    new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })
  );
}, payload);

/** Open the block settings menu for block `id` (hover points of its content until the handle opens it for that block). */
const openTunes = async (page: Page, id: string): Promise<void> => {
  const box = await page.locator(`[data-blok-id="${id}"] [data-blok-element-content]`).first().boundingBox();

  if (box === null) {
    throw new Error(`no box for ${id}`);
  }
  for (const [fx, fy] of [[0.5, 0.5], [0.1, 0.1], [0.5, 0.05], [0.9, 0.5]]) {
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

const convert = async (page: Page, id: string, to: string, tab?: string): Promise<void> => {
  await openTunes(page, id);
  await page.locator(`${TUNES_POPOVER} [data-blok-testid="popover-item"][data-blok-item-name="convert-to"]`).click();
  if (tab !== undefined) {
    await page.locator(`${NESTED_POPOVER} [data-blok-popover-tab="${tab}"][role="tab"]`).click();
  }
  await page.locator(`${NESTED_POPOVER} [data-blok-testid="popover-item"][data-blok-item-name="${to}"]`).click();
};

const P = (id: string, text: string, parent?: string): Blocks[number] => ({ id, type: 'paragraph', data: { text }, ...(parent === undefined ? {} : { parent }) });

interface Trip {
  before: State;
  after: State;
  undone: State;
  undone2: State;
  steps: number;
}

/**
 * Gesture, then two undos. `steps` = undo-stack entries the gesture added (1 is right).
 * Callers assert `undone === before` first; `undone2` and `steps` say whether the miss was a phantom step.
 */
const trip = async (page: Page, gesture: () => Promise<void>): Promise<Trip> => {
  await gap(page);
  const before = await state(page);
  const s0 = await stack(page);

  await gesture();
  await gap(page);
  const after = await state(page);
  const steps = (await stack(page)) - s0;

  expect(after, 'the gesture changed something').not.toEqual(before);
  await undo(page);
  const undone = await state(page);

  await undo(page);
  const undone2 = await state(page);

  return { before, after, undone, undone2, steps };
};

const explain = (t: Trip): string => `gesture added ${t.steps} undo entries; second undo ${JSON.stringify(t.undone2) === JSON.stringify(t.before) ? 'DOES' : 'does not'} restore before`;

// Known-failing probes, with the defect each one pins. Looked up as the first line of the test body.
const PINS: Record<string, string> = {
  'W5F-1': 'W5F-1: first undo of a heading split is a no-op when the heading was saved without level',
  'W5F-2': 'W5F-2: first undo of a checklist split is a no-op when the item was saved without checked',
  'W5F-3': 'W5F-3: first undo of a list split is a no-op when the item was saved without style',
  'W5F-11': 'W5F-11: first undo of Tab on a checklist item saved without checked is a no-op',
  'W5F-20': 'W5F-20: first undo of a split in a quote made by "turn into" is a no-op',
  'W5F-25': 'W5F-25: first undo of a split in a quote made by blocks.insert is a no-op',
  'W5F-40': 'W5F-40: undo of the first edit in a legacy toggle does nothing',
  'W5F-47': 'W5F-47: undo of the first edit in a legacy toggle does nothing',
  'W5F-48': 'W5F-48: undo reverts the load-time colour migration in a heading',
  'W5F-60': 'W5F-60: colour swatch undo takes the stale caret of a no-op Backspace',
  'W5F-61': 'W5F-61: block-menu convert undo takes the stale caret of a no-op Backspace',
  'W5F-62': 'W5F-62: blocks.update undo takes the stale caret of a no-op Backspace',
  'W5F-64': 'W5F-64: toggle arrow undo takes the stale caret of a no-op Backspace',
  'W5F-65': 'W5F-65: paste undo takes the stale caret of a no-op Backspace',
  'W5F-66': 'W5F-66: drag undo takes the stale caret of a no-op Backspace',
  'W5F-70': 'W5F-70: a no-op Delete leaves a stale caret for the next API change',
  'W5F-71': 'W5F-71: a no-op Tab leaves a stale caret for the next API change',
  'W5F-72': 'W5F-72: a no-op Shift+Tab leaves a stale caret for the next API change',
};

const pin = (id: string): void => {
  test.fail(PINS[id] !== undefined, PINS[id] ?? '');
};

test.describe('W5F: spread of the wave-4 families', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    test.setTimeout(45_000);
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  // ================= A1: partial data (host-seeded) + a structural gesture on that block =================
  // Defect (W5F-1/2/3): the split adds 2 Yjs undo entries. The first undo only deletes a key write,
  // the second reverts the split. The key log in the failure message shows the second tracked write
  // adding the missing key (h.data.level / l.data.checked / l.data.style).
  // W5F-11: Tab's nest goes on the MOVE stack; the only Yjs entry is the tracked `checked:add`, so the
  // first undo pops that write and leaves the item nested (same shape as the `depth` bug described at
  // blockManager.ts:2161-2170, for another key).
  // Root cause: the document is seeded verbatim from host data (blockManager.ts:630 fromJSON of
  // preservedData). block-insertion.ts:453 gives the NEW block the source's document data, but that data
  // is itself partial, and the SOURCE block's deferred save-back is the phantom: it awaits save()
  // (blockManager.ts:2088), lands after the gesture's boundary, and a key the seed lacked is a real data
  // change, so it is written TRACKED (blockManager.ts:2206-2208). Boundary: heading/quote Enter goes
  // keyboardNavigation.ts:730 -> BlockManager.split (withAtomicOperation); list/toggle Enter goes
  // api.blocks.splitBlock, whose closing stopCapturing runs in a microtask (api/blocks.ts:733-736).
  // Only origin 'remote' counts as materialising (yjs-sync.ts:112), so a local block never gets the
  // untracked settling window. The removal side of the same save-back is untracked (blockManager.ts:2232).
  // Controls with the key present (W5F-1b/2b/4b/11b) pass.
  // Merges (Backspace/Delete, W5F-4..8), blocks.update (W5F-13) and inline paste (W5F-14) are one step even
  // with the key missing (why is a hypothesis, not traced: their save-back lands inside the gesture's group).

  const A1: Array<{ id: string; title: string; blocks: Blocks; at: [string, number | 'end']; key: string }> = [
    { id: 'W5F-1', title: 'Enter in the middle of a heading saved without level', blocks: [{ id: 'h', type: 'header', data: { text: 'Heading' } }, P('z', 'Zed')], at: ['h', 3], key: 'Enter' },
    { id: 'W5F-1b', title: 'control: Enter in the middle of a heading saved with level', blocks: [{ id: 'h', type: 'header', data: { text: 'Heading', level: 2 } }, P('z', 'Zed')], at: ['h', 3], key: 'Enter' },
    { id: 'W5F-2', title: 'Enter in the middle of a checklist item saved without checked', blocks: [{ id: 'l', type: 'list', data: { text: 'Task', style: 'checklist' } }, P('z', 'Zed')], at: ['l', 2], key: 'Enter' },
    { id: 'W5F-2b', title: 'control: Enter in the middle of a checklist item saved with checked', blocks: [{ id: 'l', type: 'list', data: { text: 'Task', style: 'checklist', checked: false } }, P('z', 'Zed')], at: ['l', 2], key: 'Enter' },
    { id: 'W5F-3', title: 'Enter in the middle of a list item saved without style', blocks: [{ id: 'l', type: 'list', data: { text: 'Item' } }, P('z', 'Zed')], at: ['l', 2], key: 'Enter' },
    { id: 'W5F-4', title: 'Backspace merging a paragraph into a quote saved without size', blocks: [{ id: 'q', type: 'quote', data: { text: 'Quoted' } }, P('p', 'Tail')], at: ['p', 0], key: 'Backspace' },
    { id: 'W5F-4b', title: 'control: Backspace merging a paragraph into a quote saved with size', blocks: [{ id: 'q', type: 'quote', data: { text: 'Quoted', size: 'default' } }, P('p', 'Tail')], at: ['p', 0], key: 'Backspace' },
    { id: 'W5F-5', title: 'Delete at the end of a quote saved without size', blocks: [{ id: 'q', type: 'quote', data: { text: 'Quoted' } }, P('p', 'Tail')], at: ['q', 'end'], key: 'Delete' },
    { id: 'W5F-6', title: 'Backspace merging a paragraph into a heading saved without level', blocks: [{ id: 'h', type: 'header', data: { text: 'Heading' } }, P('p', 'Tail')], at: ['p', 0], key: 'Backspace' },
    { id: 'W5F-7', title: 'Backspace merging two checklist items saved without checked', blocks: [{ id: 'l1', type: 'list', data: { text: 'One', style: 'checklist' } }, { id: 'l2', type: 'list', data: { text: 'Two', style: 'checklist' } }], at: ['l2', 0], key: 'Backspace' },
    { id: 'W5F-8', title: 'Backspace merging a paragraph into a toggle saved without isOpen', blocks: [{ id: 't', type: 'toggle', data: { text: 'Toggle' } }, P('p', 'Tail')], at: ['p', 0], key: 'Backspace' },
    { id: 'W5F-9', title: 'Enter inside a code block saved without language and lineNumbers', blocks: [{ id: 'c', type: 'code', data: { code: 'abc' } }, P('z', 'Zed')], at: ['c', 1], key: 'Enter' },
    { id: 'W5F-11b', title: 'control: Tab on a checklist item saved with checked', blocks: [{ id: 'l1', type: 'list', data: { text: 'One', style: 'checklist', checked: false } }, { id: 'l2', type: 'list', data: { text: 'Two', style: 'checklist', checked: false } }], at: ['l2', 0], key: 'Tab' },
    { id: 'W5F-11', title: 'Tab on a checklist item saved without checked', blocks: [{ id: 'l1', type: 'list', data: { text: 'One', style: 'checklist' } }, { id: 'l2', type: 'list', data: { text: 'Two', style: 'checklist' } }], at: ['l2', 0], key: 'Tab' },
  ];

  for (const c of A1) {
    test(`${c.id}: ${c.title} is one undo step`, async ({ page }) => {
      pin(c.id);
      await create(page, c.blocks);
      await gap(page);
      await caretAt(page, c.at[0], c.at[1]);
      await watchKeys(page, c.at[0]);
      const t = await trip(page, () => page.keyboard.press(c.key));

      expect(t.undone, `one undo restores the state before the gesture (${explain(t)}; changes to the block: ${await keyLog(page)})`).toEqual(t.before);
    });
  }

  test('W5F-10: undo of Enter in a child of a callout saved with only an emoji keeps the document saveable and unsplit', async ({ page }) => {
    await create(page, [{ id: 'box', type: 'callout', data: { emoji: '💡' }, content: ['k1'] }, P('k1', 'one', 'box')]);
    await gap(page);
    await caretAt(page, 'k1', 'end');
    await watchKeys(page, 'box');
    await gap(page);
    const tree = (): Promise<string> => page.evaluate(async () => {
      try {
        return JSON.stringify((await window.blokInstance?.save())?.blocks.map((b) => [b.id, b.parent ?? null]));
      } catch (e) {
        return String(e).slice(0, 120);
      }
    });
    const before = await tree();

    await page.keyboard.press('Enter');
    await gap(page);
    const after = await tree();

    expect(after).not.toBe(before);
    await undo(page);
    expect(await tree(), `one undo restores the callout with its one child (changes to the callout: ${await keyLog(page)})`).toBe(before);
  });

  for (const [id, data] of [['W5F-15', { emoji: '💡' }], ['W5F-15b', { emoji: '💡', textColor: null, backgroundColor: null }]] as const) {
    test(`${id}: a callout saved as ${JSON.stringify(data)} with one child saves right after load`, async ({ page }) => {
      await create(page, [{ id: 'box', type: 'callout', data, content: ['k1'] }, P('k1', 'one', 'box')]);
      await gap(page);
      const out = await page.evaluate(async () => {
        try {
          return JSON.stringify((await window.blokInstance?.save())?.blocks.map((b) => [b.id, b.parent ?? null]));
        } catch (e) {
          return String(e).slice(0, 200);
        }
      });

      expect(out).toBe(JSON.stringify([['box', null], ['k1', 'box']]));
    });
  }


  test('W5F-13: blocks.update() of the text of a quote saved without size is one undo step', async ({ page }) => {
    await create(page, [{ id: 'q', type: 'quote', data: { text: 'Quoted' } }, P('z', 'Zed')]);
    const t = await trip(page, () => page.evaluate(async () => {
      await window.blokInstance?.blocks.update('q', { text: 'Changed' });
    }));

    expect(t.undone, `one undo restores the state before the gesture (${explain(t)})`).toEqual(t.before);
  });

  test('W5F-14: pasting plain text into a quote saved without size is one undo step', async ({ page }) => {
    await create(page, [{ id: 'q', type: 'quote', data: { text: 'Quoted' } }, P('z', 'Zed')]);
    await caretAt(page, 'q', 3);
    const t = await trip(page, () => paste(page, { 'text/plain': 'XY' }));

    expect(t.undone, `one undo restores the state before the gesture (${explain(t)})`).toEqual(t.before);
  });

  // ================= A2: a gesture creates the block with partial data; a later split hits A1 =================
  // Defect (W5F-20, W5F-25): the user never saw host data. "Turn into quote" writes quote data from
  // conversionConfig.import = 'text' (quote/index.ts:234-239), blocks.insert writes the data it is given,
  // so the quote has no size in the document until something saves it back. The next Enter-split hits A1.
  // Typing in the block first heals it (W5F-27 passes): the typing save-back writes size inside the typing step.
  // List, heading, code and pasted <blockquote> conversions carry every key (W5F-21..24, W5F-26 pass).

  const A2: Array<{ id: string; to: string; tab?: string; split: number }> = [
    { id: 'W5F-20', to: 'quote', split: 3 },
    { id: 'W5F-21', to: 'check-list', split: 3 },
    { id: 'W5F-22', to: 'header-2', tab: 'heading', split: 3 },
    { id: 'W5F-23', to: 'bulleted-list', split: 3 },
  ];

  for (const c of A2) {
    test(`${c.id}: after "turn into ${c.to}", Enter in the middle of the new block is one undo step`, async ({ page }) => {
      pin(c.id);
      await create(page, [P('p-before', 'before'), P('x', 'Plain text'), P('p-after', 'after')]);
      await convert(page, 'x', c.to, c.tab);
      await gap(page);
      await page.keyboard.press('Escape');
      await caretAt(page, 'x', c.split);
      const t = await trip(page, () => page.keyboard.press('Enter'));

      expect(t.undone, `one undo restores the state before the split (${explain(t)})`).toEqual(t.before);
    });
  }

  test('W5F-24: after "turn into code", one undo turns it back and nothing else is on the stack', async ({ page }) => {
    await create(page, [P('p-before', 'before'), P('x', 'Plain text'), P('p-after', 'after')]);
    const t = await trip(page, () => convert(page, 'x', 'code'));

    expect(t.undone, `one undo restores the paragraph (${explain(t)})`).toEqual(t.before);
    expect(t.steps, 'the conversion is one undo entry').toBe(1);
  });

  test('W5F-25: after blocks.insert("quote", {text}), Enter in the middle of it is one undo step', async ({ page }) => {
    pin('W5F-25');
    await create(page, [P('a', 'Alpha')]);
    await page.evaluate(() => {
      window.blokInstance?.blocks.insert('quote', { text: 'Quoted' }, undefined, 1, false, false, 'q');
    });
    await gap(page);
    await caretAt(page, 'q', 3);
    const t = await trip(page, () => page.keyboard.press('Enter'));

    expect(t.undone, `one undo restores the state before the split (${explain(t)})`).toEqual(t.before);
  });

  test('W5F-26: after pasting a <blockquote>, Enter in the middle of the pasted quote is one undo step', async ({ page }) => {
    await create(page, [P('a', 'Alpha'), P('e', '')]);
    await caretAt(page, 'e', 0);
    await paste(page, { 'text/html': '<blockquote>Quoted</blockquote>', 'text/plain': 'Quoted' });
    await gap(page);
    const types = (await state(page)).saved.map((s) => s.split('|')[0]);

    expect(types, 'the paste made a quote').toContain('quote');
    const qid = await page.evaluate(() => document.querySelector('[data-blok-component="quote"]')?.getAttribute('data-blok-id') ?? '');

    await caretAt(page, qid, 3);
    const t = await trip(page, () => page.keyboard.press('Enter'));

    expect(t.undone, `one undo restores the state before the split (${explain(t)})`).toEqual(t.before);
  });

  test('W5F-27: after "+ then quote" and typing, Enter in the middle is one undo step (typing heals the data)', async ({ page }) => {
    await create(page, [P('x', 'Plain text')]);
    await editable(page, 'x').hover();
    await page.getByTestId('plus-button').click();
    await page.locator('[data-blok-testid="popover-item"][data-blok-item-name="quote"]').click();
    await gap(page);
    await page.keyboard.type('Quoted');
    await gap(page);
    const qid = await page.evaluate(() => document.querySelector('[data-blok-component="quote"]')?.getAttribute('data-blok-id') ?? '');

    await caretAt(page, qid, 3);
    const t = await trip(page, () => page.keyboard.press('Enter'));

    expect(t.undone, `one undo restores the state before the split (${explain(t)})`).toEqual(t.before);
  });

  // ================= B: load-time rewrites vs the first undo in the block =================
  // W5F-40/47 (family 3, new instance): a legacy toggle {title, isExpanded}. The first edit's save-back
  // adds text+isOpen TRACKED and prunes title+isExpanded UNTRACKED (blockManager.ts:2206-2208 vs 2232).
  // Undo removes text+isOpen, leaving {} in the document; toggle setData (toggle/index.ts:194) has nothing
  // to apply, the DOM keeps "LegacyZ", and the next save-back writes it back untracked. Net: the undo is
  // consumed, the typed letter stays, and the old title can never come back.
  // W5F-48 (known W4I-30b mechanism, other tool): renderer.ts:327 migrateMarkColors runs over every block,
  // so headings (and any tool with marks) lose the migrated colour on the first undo too.
  // W5F-49/49b (known CAP-6, new trigger blocks.update): callout has no setData, so the undo replay of a
  // callout data change leaves its child holder detached; save() then throws "stranded". Not a B defect.
  // Works: string heading level, legacy arrow markup, equation hydrate, "<br>" paragraph, legacy list items,
  // legacy-string table cells (nothing on the undo stack after load).

  /** Load, type one letter at the end of `id`, undo: save() and the screen must match what was loaded. */
  const B: Array<{ id: string; title: string; blocks: Blocks; edit: string }> = [
    { id: 'W5F-40', title: 'a legacy toggle ({title, isExpanded:false}) keeps its title and stays closed', blocks: [{ id: 't', type: 'toggle', data: { title: 'Legacy', isExpanded: false } }, P('z', 'Zed')], edit: 't' },
    { id: 'W5F-41', title: 'a legacy list item ({items:[...]}) keeps its text', blocks: [{ id: 'l', type: 'list', data: { style: 'unordered', items: ['Legacy'] } }, P('z', 'Zed')], edit: 'l' },
    { id: 'W5F-42', title: 'a legacy checklist item ({items:[{text,checked:true}]}) keeps its text and tick', blocks: [{ id: 'l', type: 'list', data: { style: 'checklist', items: [{ text: 'Legacy', checked: true }] } }, P('z', 'Zed')], edit: 'l' },
    { id: 'W5F-43', title: 'a heading saved with a string level keeps its level', blocks: [{ id: 'h', type: 'header', data: { text: 'Title', level: '3' } }, P('z', 'Zed')], edit: 'h' },
    { id: 'W5F-44', title: 'a heading saved with legacy toggle-arrow markup keeps clean text', blocks: [{ id: 'h', type: 'header', data: { text: '<span data-blok-toggle-arrow="">▶</span>Title', level: 2 } }, P('z', 'Zed')], edit: 'h' },
    { id: 'W5F-45', title: 'a paragraph with an inline equation keeps the rendered formula', blocks: [P('p', 'E <span data-latex="x^2"></span> end')], edit: 'p' },
    { id: 'W5F-46', title: 'a paragraph saved as "<br>" stays as loaded', blocks: [P('p', '<br>'), P('z', 'Zed')], edit: 'p' },
    { id: 'W5F-47', title: 'an open legacy toggle ({title, isExpanded:true}) with a child keeps its title', blocks: [{ id: 't', type: 'toggle', data: { title: 'Legacy', isExpanded: true }, content: ['k'] }, P('k', 'kid', 't')], edit: 't' },
    { id: 'W5F-48', title: 'a heading with a raw-rgb colour mark keeps the theme colour (known W4I-30b mechanism, other tool)', blocks: [{ id: 'h', type: 'header', data: { text: 'Hello <mark style="color: rgb(212, 76, 71); background-color: transparent;">world</mark>', level: 2 } }], edit: 'h' },
  ];

  for (const c of B) {
    test(`${c.id}: after an edit and its undo, ${c.title}`, async ({ page }) => {
      pin(c.id);
      await create(page, c.blocks);
      await gap(page);
      const loaded = await state(page);

      const target = c.edit === 'l'
        ? await page.evaluate(() => document.querySelector('[data-blok-component="list"]')?.getAttribute('data-blok-id') ?? 'l')
        : c.edit;

      await caretAt(page, target, 'end');
      await page.keyboard.type('Z');
      await gap(page);
      const edited = await state(page);

      expect(edited, 'the edit changed something').not.toEqual(loaded);
      await undo(page);
      const undone = await state(page);

      const doc = await page.evaluate((id) => JSON.stringify((window.blokInstance as unknown as { module: { yjsManager: { getBlockDataObject: (i: string) => unknown } } }).module.yjsManager.getBlockDataObject(id)), target);

      expect(undone.saved, `save() after undo equals save() right after load (document data after undo: ${doc})`).toEqual(loaded.saved);
      // A lone filler <br> in an empty editable comes and goes; it is not visible.
      const filler = (dom: string[]): string[] => dom.map((line) => line.replace(/\|<br>$/, '|'));

      expect(filler(undone.dom), 'screen after undo equals the screen right after load').toEqual(filler(loaded.dom));
    });
  }

  for (const [id, what, data] of [
    ['W5F-49', 'saved in the legacy shape', { variant: 'note', isEmojiVisible: true, emoji: '💡' }],
    ['W5F-49b', 'saved in the current shape', { emoji: '💡', textColor: null, backgroundColor: 'blue' }],
  ] as const) {
    test(`${id}: a callout ${what} with a child is unchanged after a blocks.update() and its undo`, async ({ page }) => {
      pin(id);
      await create(page, [{ id: 'box', type: 'callout', data, content: ['k'] }, P('k', 'kid', 'box')]);
      await gap(page);
      const loaded = await state(page);

      await page.evaluate(async () => {
        await window.blokInstance?.blocks.update('box', { emoji: '🔥' });
      });
      await gap(page);
      const updated = await page.evaluate(async () => {
        try {
          return JSON.stringify((await window.blokInstance?.save())?.blocks.map((b) => [b.id, b.parent ?? null]));
        } catch (e) {
          return String(e).slice(0, 80);
        }
      });

      expect(updated, 'the update itself leaves the document saveable').toBe(JSON.stringify([['box', null], ['k', 'box']]));
      await undo(page);
      const saved = await page.evaluate(async () => {
        try {
          return JSON.stringify((await window.blokInstance?.save())?.blocks.map((b) => [b.id, b.parent ?? null, b.data]));
        } catch (e) {
          return String(e).slice(0, 160);
        }
      });

      const loadedBox: unknown = JSON.parse(loaded.saved[0].split('|')[1]);

      expect(saved, 'save() after undo works and equals the loaded document').toBe(JSON.stringify([['box', null, loadedBox], ['k', 'box', { text: 'kid' }]]));
    });
  }

  test('W5F-50: loading a table with legacy string cells leaves nothing to undo', async ({ page }) => {
    await create(page, [P('a', 'Alpha'), { id: 'tbl', type: 'table', data: { withHeadings: false, content: [['A1', 'B1'], ['A2', 'B2']] } }, P('z', 'Zed')]);
    await gap(page);
    expect(await stack(page), 'undo stack right after load').toBe(0);
    expect(await page.evaluate(() => window.blokInstance?.history.canUndo()), 'canUndo right after load').toBe(false);
  });

  test('W5F-51: after typing in a legacy-string table cell, one undo reverts only the typing', async ({ page }) => {
    await create(page, [P('a', 'Alpha'), { id: 'tbl', type: 'table', data: { withHeadings: false, content: [['A1', 'B1'], ['A2', 'B2']] } }, P('z', 'Zed')]);
    await gap(page);
    const loaded = await state(page);
    const cell = page.locator('[data-blok-table-cell-row="0"][data-blok-table-cell-col="0"] [contenteditable="true"]').first();

    await cell.click();
    await page.keyboard.press('End');
    await page.keyboard.type('Z');
    await gap(page);
    await undo(page);
    const undone = await state(page);

    expect(undone.dom, 'screen after undo equals the screen right after load').toEqual(loaded.dom);
    await undo(page);
    expect((await state(page)).dom, 'a second undo changes nothing').toEqual(loaded.dom);
  });

  // ================= C: stale caret-before after a no-op structural key =================
  // Defect: a no-op Backspace/Delete/Tab/Shift+Tab force-captures a caret-before snapshot
  // (uiControllers/controllers/keyboard.ts:149) that nothing consumes. Every later write reached by mouse or
  // API marks the caret NON-forced (yjs/index.ts:330-517 -> undo-history.ts:1507-1509 returns early), and
  // the next stack item takes the stale snapshot as "before" (undo-history.ts:837). Clicking into another
  // block does not clear it. Undo then puts the caret back where the no-op key was pressed.
  // Every "b" control (same gesture, no prior no-op key) passes. Checkbox tick (W5F-63, caret back at b@3)
  // and table row insert from the grip (W5F-67, caret at b@9) do not show it; why is not traced.
  // No Enter probe: no spot was found where Enter is a no-op.

  const C_DOC = (): Blocks => [P('a', 'Alpha one'), P('m', 'Middle'), P('b', 'Bravo two'), P('c', 'Charlie')];

  /** Backspace at the very start of the document: nothing happens. */
  const noOpBackspace = async (page: Page): Promise<void> => {
    await caretAt(page, 'a', 0);
    const before = await state(page);
    const s0 = await stack(page);

    await page.keyboard.press('Backspace');
    await gap(page);
    expect(await state(page), 'the Backspace changed nothing').toEqual(before);
    expect(await stack(page), 'the Backspace added no undo entry').toBe(s0);
  };

  interface CCase {
    id: string;
    title: string;
    blocks: () => Blocks;
    target: string;
    gesture: (page: Page) => Promise<void>;
  }

  const C: CCase[] = [
    {
      id: 'W5F-60',
      title: 'a colour swatch',
      blocks: C_DOC,
      target: 'b',
      gesture: async (page) => {
        await select(page, 'Bravo');
        await page.locator(`${TOOLBAR} [data-blok-item-name="marker"]`).click();
        await page.getByTestId('marker-swatch-color-red').click();
        await page.keyboard.press('Escape');
      },
    },
    {
      id: 'W5F-61',
      title: 'a "turn into heading" from the block menu',
      blocks: C_DOC,
      target: 'b',
      gesture: async (page) => {
        await convert(page, 'b', 'header-2', 'heading');
      },
    },
    {
      id: 'W5F-62',
      title: 'a blocks.update() call',
      blocks: C_DOC,
      target: 'b',
      gesture: async (page) => {
        await page.evaluate(async () => {
          await window.blokInstance?.blocks.update('b', { text: 'Bravo changed' });
        });
      },
    },
    {
      id: 'W5F-63',
      title: 'a checkbox tick',
      blocks: () => [P('a', 'Alpha one'), P('m', 'Middle'), { id: 'b', type: 'list', data: { text: 'Bravo two', style: 'checklist', checked: false } }, P('c', 'Charlie')],
      target: 'b',
      gesture: async (page) => {
        await page.locator('[data-blok-id="b"]').getByRole('checkbox').click();
      },
    },
    {
      id: 'W5F-64',
      title: 'a toggle arrow click',
      blocks: () => [P('a', 'Alpha one'), P('m', 'Middle'), { id: 'b', type: 'toggle', data: { text: 'Bravo two', isOpen: true }, content: ['bk'] }, P('bk', 'kid', 'b'), P('c', 'Charlie')],
      target: 'b',
      gesture: async (page) => {
        await page.locator('[data-blok-id="b"] [data-blok-toggle-arrow]').first().click();
      },
    },
    {
      id: 'W5F-65',
      title: 'a paste',
      blocks: C_DOC,
      target: 'b',
      gesture: async (page) => {
        await paste(page, { 'text/plain': 'XY' });
      },
    },
    {
      id: 'W5F-66',
      title: 'a drag of the block by its handle',
      blocks: C_DOC,
      target: 'b',
      gesture: async (page) => {
        const box = await page.locator('[data-blok-id="b"] [data-blok-element-content]').first().boundingBox();

        if (box === null) {
          throw new Error('no box');
        }
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        const handle = page.locator(HANDLE);

        await expect(handle).toBeVisible();
        const hb = await handle.boundingBox();
        const tb = await page.locator('[data-blok-id="m"] [data-blok-element-content]').first().boundingBox();

        if (hb === null || tb === null) {
          throw new Error('no handle');
        }
        await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
        await page.mouse.down();
        await page.mouse.move(tb.x + tb.width / 2, tb.y + 3, { steps: 18 });
        await page.waitForFunction(
          () => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true',
          { timeout: 2000 }
        );
        await page.mouse.up();
      },
    },
    {
      id: 'W5F-67',
      title: 'a table row insert from the row grip',
      blocks: () => [
        P('a', 'Alpha one'),
        P('m', 'Middle'),
        {
          id: 'tbl',
          type: 'table',
          data: { withHeadings: false, withHeadingColumn: false, content: [[{ blocks: ['b'], id: 'k0', rowId: 'r0' }], [{ blocks: ['c1'], id: 'k0', rowId: 'r1' }]] },
          content: ['b', 'c1'],
        },
        P('b', 'Bravo two', 'tbl'),
        P('c1', 'Cell two', 'tbl'),
        P('c', 'Charlie'),
      ],
      target: 'b',
      gesture: async (page) => {
        const grip = page.locator('[data-blok-table-grip-row="0"]');

        await expect(grip).toBeVisible();
        await grip.click();
        await page.getByRole('menuitem', { name: 'Insert row below', exact: true }).click();
      },
    },
  ];

  for (const c of C) {
    for (const withNoOp of [true, false]) {
      const head = withNoOp ? `${c.id}: after a no-op Backspace in another block, undo of` : `${c.id}b: control, undo of`;
      const tail = withNoOp ? 'does not put the caret back in that block' : 'without a prior no-op key keeps the caret out of the untouched first block';

      test(`${head} ${c.title} ${tail}`, async ({ page }) => {
        if (withNoOp) {
          pin(c.id);
        }
        await create(page, c.blocks());
        await gap(page);
        if (withNoOp) {
          await noOpBackspace(page);
        } else {
          await caretAt(page, 'a', 0);
          await gap(page);
        }
        await caretAt(page, c.target, 3);
        await gap(page, 200);
        const before = await caret(page);
        await c.gesture(page);
        await gap(page);
        expect(await page.evaluate(() => window.blokInstance?.history.canUndo()), 'the gesture is undoable').toBe(true);
        await undo(page);
        const restored = await caret(page);

        expect(restored, `caret after undo (caret before the gesture was ${before})`).not.toMatch(/^a@/);
      });
    }
  }

  const C_KEYS: Array<{ id: string; title: string; blocks: Blocks; place: [string, number | 'end']; key: string }> = [
    { id: 'W5F-70', title: 'Delete at the end of the last block', blocks: [P('m', 'Middle'), P('b', 'Bravo two'), P('a', 'Alpha one')], place: ['a', 'end'], key: 'Delete' },
    { id: 'W5F-71', title: 'Tab in the first paragraph', blocks: [P('a', 'Alpha one'), P('m', 'Middle'), P('b', 'Bravo two')], place: ['a', 2], key: 'Tab' },
    { id: 'W5F-72', title: 'Shift+Tab in a top-level paragraph', blocks: [P('a', 'Alpha one'), P('m', 'Middle'), P('b', 'Bravo two')], place: ['a', 2], key: 'Shift+Tab' },
  ];

  for (const c of C_KEYS) {
    test(`${c.id}: after a no-op ${c.title}, undo of a blocks.update() in another block does not put the caret in that block`, async ({ page }) => {
      pin(c.id);
      await create(page, c.blocks);
      await caretAt(page, c.place[0], c.place[1]);
      const before = await state(page);
      const s0 = await stack(page);

      await page.keyboard.press(c.key);
      await gap(page);
      const noOp = JSON.stringify(await state(page)) === JSON.stringify(before) && (await stack(page)) === s0;

      test.info().annotations.push({ type: 'no-op', description: String(noOp) });
      expect(noOp, `${c.key} really is a no-op here`).toBe(true);
      await caretAt(page, 'b', 3);
      await page.evaluate(async () => {
        await window.blokInstance?.blocks.update('b', { text: 'Bravo changed' });
      });
      await gap(page);
      await undo(page);
      expect(await caret(page)).not.toMatch(/^a@/);
    });
  }
});
