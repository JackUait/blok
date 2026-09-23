import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
const CAPTURE_GAP_MS = 700;

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
    document.body.appendChild(container);
    const blok = new window.Blok({ holder, data: { blocks: list } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, list: blocks });
};

const gap = (page: Page): Promise<void> => page.evaluate((ms) => new Promise<void>((r) => {
  window.setTimeout(r, ms);
}), CAPTURE_GAP_MS);

const settle = (page: Page): Promise<void> => page.evaluate(() => new Promise<void>((r) => {
  window.setTimeout(r, 300);
}));

interface State {
  dom: string[];
  saved: string[];
}

/**
 * One line per block, in document order, for the screen and for save().
 * Screen: component, depth, list marker, checkbox, and the block's OWN editables (not a child's).
 * Saved: type, data, and the parent as an index into the saved list (ids stay out).
 */
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

/** Plain "type:text" per block from the screen and from save(), for the markdown checks. */
const plain = (page: Page): Promise<{ dom: string[]; saved: string[] }> => page.evaluate(async (holder) => {
  const root = document.getElementById(holder);
  const wrappers = root === null ? [] : Array.from(root.querySelectorAll('[data-blok-testid="block-wrapper"]'));
  const dom = wrappers.map((w) => {
    const ed = Array.from(w.querySelectorAll('[contenteditable]:not([contenteditable="false"])')).find((e) => e.closest('[data-blok-testid="block-wrapper"]') === w);

    return `${w.getAttribute('data-blok-component') ?? '?'}:${(ed?.textContent ?? '').replace(/\u00a0/g, ' ')}`;
  });
  const out = await window.blokInstance?.save();
  const saved = (out?.blocks ?? []).map((b) => {
    const d = b.data as { text?: string; code?: string };
    const t = document.createElement('div');

    t.innerHTML = d.text ?? d.code ?? '';

    return `${b.type}:${(t.textContent ?? '').replace(/\u00a0/g, ' ')}`;
  });

  return { dom, saved };
}, HOLDER_ID);

/** Which block holds the caret, and the text offset inside that block's editable. */
const caret = (page: Page): Promise<string> => page.evaluate(() => {
  const sel = window.getSelection();

  if (sel === null || sel.rangeCount === 0) {
    return 'none';
  }
  const node = sel.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement;
  const wrapper = el?.closest('[data-blok-testid="block-wrapper"]');
  const editable = el?.closest('[contenteditable]:not([contenteditable="false"])');

  if (!wrapper || !editable || document.getElementById('blok')?.contains(editable) !== true) {
    return 'outside';
  }
  const r = document.createRange();

  r.setStart(editable, 0);
  r.setEnd(sel.anchorNode as Node, sel.anchorOffset);

  return `${wrapper.getAttribute('data-blok-id') ?? '?'}@${r.toString().length}`;
});

/** Put the caret in block `id` at text offset `at` ('end' = end of its first own editable). */
const caretAt = async (page: Page, id: string, at: number | 'end'): Promise<void> => {
  const target = page.locator(`[data-blok-id="${id}"] [contenteditable]:not([contenteditable="false"])`).first();

  await target.click();
  await target.evaluate((el: HTMLElement, offset: number | 'end') => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let left = offset === 'end' ? Number.MAX_SAFE_INTEGER : offset;
    let last: Text | null = null;

    for (let n = walker.nextNode() as Text | null; n !== null; n = walker.nextNode() as Text | null) {
      last = n;
      if (left <= n.length) {
        range.setStart(n, left);
        break;
      }
      left -= n.length;
    }
    if (range.startContainer === document) {
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
  }, at);
};

const P = (id: string, text: string, parent?: string): Blocks[number] => ({ id, type: 'paragraph', data: { text }, ...(parent === undefined ? {} : { parent }) });
const L = (id: string, text: string, depth = 0, style = 'unordered', extra: Record<string, unknown> = {}): Blocks[number] =>
  ({ id, type: 'list', data: { text, style, checked: false, ...(depth > 0 ? { depth } : {}), ...extra } });

/**
 * Drive `gesture`, one undo, one redo. Returns the four states; the caller asserts
 * undone === before and redone === after. The caret must stay inside the editor both times.
 */
interface Trip {
  before: State;
  after: State;
  undone: State;
  redone: State;
}

const roundTrip = async (page: Page, gesture: () => Promise<void>, checkCaret = true): Promise<Trip> => {
  await gap(page);
  const before = await state(page);

  await gesture();
  await gap(page);
  const after = await state(page);

  expect(after, 'the gesture changed something').not.toEqual(before);

  await page.keyboard.press(UNDO);
  await settle(page);
  const undone = await state(page);
  const afterUndo = await caret(page);

  if (checkCaret) {
    expect(afterUndo, 'caret stays in the editor after undo').not.toMatch(/^(none|outside)$/);
  }

  await page.keyboard.press(REDO);
  await settle(page);
  const redone = await state(page);
  const afterRedo = await caret(page);

  if (checkCaret) {
    expect(afterRedo, 'caret stays in the editor after redo').not.toMatch(/^(none|outside)$/);
  }

  return { before, after, undone, redone };
};

test.describe('undo audit wave 4: structural keyboard edits and markdown shortcuts', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    test.setTimeout(45_000);
    await gotoTestPage(page);
  });

  const shortcuts: Array<{ id: string; typed: string; converted: string[] }> = [
    { id: 'W4K-1', typed: '# ', converted: ['header:'] },
    { id: 'W4K-2', typed: '## ', converted: ['header:'] },
    { id: 'W4K-3', typed: '### ', converted: ['header:'] },
    { id: 'W4K-4', typed: '- ', converted: ['list:'] },
    { id: 'W4K-5', typed: '* ', converted: ['list:'] },
    { id: 'W4K-6', typed: '1. ', converted: ['list:'] },
    { id: 'W4K-7', typed: '[] ', converted: ['list:'] },
    { id: 'W4K-8', typed: '[x] ', converted: ['list:'] },
    { id: 'W4K-9', typed: '```', converted: ['code:'] },
    { id: 'W4K-10', typed: '---', converted: ['divider:', 'paragraph:'] },
    { id: 'W4K-11', typed: '" ', converted: ['quote:'] },
    { id: 'W4K-13', typed: '**b**', converted: ['paragraph:b'] },
    { id: 'W4K-14', typed: '[a](x.io)', converted: ['paragraph:a'] },
  ];

  for (const s of shortcuts) {
    test(`${s.id}: one undo of the "${s.typed}" shortcut leaves the literal text and redo replays it`, async ({ page }) => {
      await create(page, [P('p', '')]);
      await caretAt(page, 'p', 0);
      await page.keyboard.type(s.typed);
      await gap(page);
      const converted = await state(page);

      expect((await plain(page)).dom).toEqual(s.converted);

      await page.keyboard.press(UNDO);
      await settle(page);
      expect(await plain(page), 'first undo leaves the literal marker').toEqual({ dom: [`paragraph:${s.typed}`], saved: [`paragraph:${s.typed}`] });

      await page.keyboard.press(REDO);
      await settle(page);
      expect(await state(page), 'redo replays the conversion exactly').toEqual(converted);
    });
  }

  test('W4K-15: one undo of "# " typed before existing text leaves "# Hello" as a paragraph', async ({ page }) => {
    await create(page, [P('p', 'Hello')]);
    await caretAt(page, 'p', 0);
    await gap(page);
    await page.keyboard.type('# ');
    await gap(page);
    expect((await plain(page)).dom).toEqual(['header:Hello']);

    await page.keyboard.press(UNDO);
    await settle(page);
    expect(await plain(page)).toEqual({ dom: ['paragraph:# Hello'], saved: ['paragraph:# Hello'] });
  });

  // Undo of an emoji conversion puts the caret after the literal shortcode.
  test('W4K-16: one undo of an emoji picked with ":smile:" leaves the literal shortcode', async ({ page }) => {
    await create(page, [P('p', '')]);
    await caretAt(page, 'p', 0);
    await page.keyboard.type(':smile');
    // The shortcode commits only once the emoji data has loaded and the menu has matched it.
    await expect(page.locator('[data-blok-id="p"] [contenteditable="true"]')).toHaveAttribute('aria-activedescendant', /.+/);
    await page.keyboard.type(':');
    await gap(page);
    const converted = await plain(page);

    expect(converted.dom[0]).not.toContain(':smile');

    await page.keyboard.press(UNDO);
    await settle(page);
    expect(await caret(page), 'caret sits after the literal shortcode').toBe('p@7');
    expect(await plain(page), 'first undo leaves the literal shortcode').toEqual({ dom: ['paragraph::smile:'], saved: ['paragraph::smile:'] });

    await page.keyboard.press(REDO);
    await settle(page);
    expect(await plain(page)).toEqual(converted);
  });

  // The new block's first save-back adds a key its data lacked (isOpen). It joins the
  // shortcut's step, because only a gesture start closes a step.
  test('W4K-12: one undo of the ">## " toggle-heading shortcut leaves the literal text', async ({ page }) => {
    await create(page, [P('x', 'X'), P('p', '')]);
    await caretAt(page, 'p', 0);
    await page.keyboard.type('>## ');
    await gap(page);
    expect((await plain(page)).dom).toEqual(['paragraph:X', 'header:']);

    await page.keyboard.press(UNDO);
    await settle(page);
    expect(await plain(page)).toEqual({ dom: ['paragraph:X', 'paragraph:>## '], saved: ['paragraph:X', 'paragraph:>## '] });
  });

  // Undo of an inline auto-format (bold, link) puts the caret after the literal text, not mid-marker.
  for (const c of [
    { id: 'W4K-17', prefix: '', typed: '**b**' },
    { id: 'W4K-18', prefix: 'Hi', typed: ' **b**' },
    { id: 'W4K-19', prefix: '', typed: '[a](x.io)' },
  ]) {
    test(`${c.id}: undo of the "${c.typed}" auto-format puts the caret after the literal text`, async ({ page }) => {
      await create(page, [P('p', c.prefix)]);
      await caretAt(page, 'p', 'end');
      await gap(page);
      await page.keyboard.type(c.typed);
      await gap(page);

      await page.keyboard.press(UNDO);
      await settle(page);
      expect(await caret(page)).toBe(`p@${c.prefix.length + c.typed.length}`);
      expect((await plain(page)).dom).toEqual([`paragraph:${c.prefix}${c.typed}`]);
    });
  }

  test('W4K-19b: undo of the "# " shortcut puts the caret after the literal marker', async ({ page }) => {
    await create(page, [P('p', 'Hello')]);
    await caretAt(page, 'p', 0);
    await gap(page);
    await page.keyboard.type('# ');
    await gap(page);

    await page.keyboard.press(UNDO);
    await settle(page);
    expect(await caret(page)).toBe('p@2');
    expect((await plain(page)).dom).toEqual(['paragraph:# Hello']);
  });

  // Text typed after "/" while the slash menu is open reaches Yjs like any other typing (see CAR-7).
  test('W4K-17b: one undo of the link shortcut on an "https://" url leaves the whole literal text', async ({ page }) => {
    await create(page, [P('p', '')]);
    await caretAt(page, 'p', 0);
    await page.keyboard.type('[a](https://x.io)');
    await gap(page);

    await page.keyboard.press(UNDO);
    await settle(page);
    expect(await plain(page)).toEqual({ dom: ['paragraph:[a](https://x.io)'], saved: ['paragraph:[a](https://x.io)'] });
  });

  test('W4K-17c: typing an "https://" url after a pause is one undo step of its own', async ({ page }) => {
    await create(page, [P('p', 'See')]);
    await caretAt(page, 'p', 'end');
    await gap(page);
    await page.keyboard.type(' https://x.io');
    await gap(page);
    await page.keyboard.press('Escape');
    await gap(page);
    await caretAt(page, 'p', 'end');
    await page.keyboard.type(' ok');
    await gap(page);

    await page.keyboard.press(UNDO);
    await settle(page);
    expect(await plain(page), 'first undo removes only " ok"').toEqual({ dom: ['paragraph:See https://x.io'], saved: ['paragraph:See https://x.io'] });
  });

  // ---------- lists ----------

  test('W4K-20: Tab on a list item with a nested child indents both in one undo step', async ({ page }) => {
    await create(page, [L('a', 'A'), L('b', 'B'), L('c', 'C', 1)]);
    await caretAt(page, 'b', 'end');
    const trip = await roundTrip(page, () => page.keyboard.press('Tab'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-21: Shift+Tab on a nested list item with its own child outdents both in one undo step', async ({ page }) => {
    await create(page, [L('a', 'A'), L('b', 'B', 1), L('c', 'C', 2)]);
    await caretAt(page, 'b', 'end');
    const trip = await roundTrip(page, () => page.keyboard.press('Shift+Tab'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  // Redo of a multi-selected Tab is a plain parentId replay (not a move entry); it must still redraw the
  // nested glyph (◦). See W5R-3.
  test('W4K-22: Tab on two selected list items indents both in one undo step', async ({ page }) => {
    await create(page, [L('a', 'A'), L('b', 'B'), L('c', 'C')]);
    await caretAt(page, 'b', 'end');
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.up('Shift');
    await expect(page.locator(`#${HOLDER_ID} [data-blok-selected="true"]`)).toHaveCount(2);
    const trip = await roundTrip(page, () => page.keyboard.press('Tab'), false);

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-23: Enter on an empty top-level list item turns it into a paragraph in one undo step', async ({ page }) => {
    await create(page, [L('a', 'A'), L('b', '')]);
    await caretAt(page, 'b', 0);
    const trip = await roundTrip(page, () => page.keyboard.press('Enter'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-24: Enter on an empty nested list item outdents it in one undo step', async ({ page }) => {
    await create(page, [L('a', 'A'), L('b', '', 1)]);
    await caretAt(page, 'b', 0);
    const trip = await roundTrip(page, () => page.keyboard.press('Enter'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-25: Backspace at the start of a list item is one undo step', async ({ page }) => {
    await create(page, [L('a', 'A'), L('b', 'B')]);
    await caretAt(page, 'b', 0);
    const trip = await roundTrip(page, () => page.keyboard.press('Backspace'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-26: Backspace at the start of a nested list item is one undo step', async ({ page }) => {
    await create(page, [L('a', 'A'), L('b', 'B', 1)]);
    await caretAt(page, 'b', 0);
    const trip = await roundTrip(page, () => page.keyboard.press('Backspace'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-27: Backspace in an empty list item is one undo step', async ({ page }) => {
    await create(page, [L('a', 'A'), L('b', '')]);
    await caretAt(page, 'b', 0);
    const trip = await roundTrip(page, () => page.keyboard.press('Backspace'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-28: Backspace at the start of a middle numbered item renumbers, and undo renumbers back', async ({ page }) => {
    await create(page, [L('a', 'A', 0, 'ordered'), L('b', 'B', 0, 'ordered'), L('c', 'C', 0, 'ordered')]);
    await caretAt(page, 'b', 0);
    const trip = await roundTrip(page, () => page.keyboard.press('Backspace'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-29: Enter at the end of a checked to-do is one undo step', async ({ page }) => {
    await create(page, [L('a', 'Done', 0, 'checklist', { checked: true })]);
    await caretAt(page, 'a', 'end');
    const trip = await roundTrip(page, () => page.keyboard.press('Enter'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-30: Delete at the end of a list item joins the next paragraph in one undo step', async ({ page }) => {
    await create(page, [L('a', 'Item'), P('p', 'Para')]);
    await caretAt(page, 'a', 'end');
    const trip = await roundTrip(page, () => page.keyboard.press('Delete'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-31: Enter in the middle of a numbered item splits it and renumbers in one undo step', async ({ page }) => {
    await create(page, [L('a', 'Alpha', 0, 'ordered'), L('b', 'Beta', 0, 'ordered')]);
    await caretAt(page, 'a', 2);
    const trip = await roundTrip(page, () => page.keyboard.press('Enter'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  // ---------- headings, quote, merges ----------

  test('W4K-40: Backspace at the start of a heading is one undo step', async ({ page }) => {
    await create(page, [P('p', 'Above'), { id: 'h', type: 'header', data: { text: 'Title', level: 2 } }]);
    await caretAt(page, 'h', 0);
    const trip = await roundTrip(page, () => page.keyboard.press('Backspace'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-41: Backspace at the start of a quote is one undo step', async ({ page }) => {
    await create(page, [P('p', 'Above'), { id: 'q', type: 'quote', data: { text: 'Quoted' } }]);
    await caretAt(page, 'q', 0);
    const trip = await roundTrip(page, () => page.keyboard.press('Backspace'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-42: Delete at the end of a paragraph joins the next heading in one undo step', async ({ page }) => {
    await create(page, [P('p', 'Para'), { id: 'h', type: 'header', data: { text: 'Title', level: 2 } }]);
    await caretAt(page, 'p', 'end');
    const trip = await roundTrip(page, () => page.keyboard.press('Delete'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  for (const [n, at] of [[43, 0], [44, 2], [45, 'end']] as const) {
    test(`W4K-${n}: Enter at ${String(at)} of a heading is one undo step`, async ({ page }) => {
      await create(page, [{ id: 'h', type: 'header', data: { text: 'Title', level: 2 } }]);
      await caretAt(page, 'h', at);
      const trip = await roundTrip(page, () => page.keyboard.press('Enter'));

      expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
      expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
    });
  }

  // Same as W4K-12 for a quote saved without size.
  test('W4K-46: Enter in the middle of a quote is one undo step', async ({ page }) => {
    await create(page, [{ id: 'q', type: 'quote', data: { text: 'Quoted' } }]);
    await caretAt(page, 'q', 3);
    const trip = await roundTrip(page, () => page.keyboard.press('Enter'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-46b: Enter in the middle of a quote saved with its size is one undo step', async ({ page }) => {
    await create(page, [{ id: 'q', type: 'quote', data: { text: 'Quoted', size: 'default' } }]);
    await caretAt(page, 'q', 3);
    const trip = await roundTrip(page, () => page.keyboard.press('Enter'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-47: Enter at the end of a quote is one undo step', async ({ page }) => {
    await create(page, [{ id: 'q', type: 'quote', data: { text: 'Quoted' } }]);
    await caretAt(page, 'q', 'end');
    const trip = await roundTrip(page, () => page.keyboard.press('Enter'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-48: Shift+Enter in a paragraph is one undo step', async ({ page }) => {
    await create(page, [P('p', 'Hello')]);
    await caretAt(page, 'p', 2);
    const trip = await roundTrip(page, () => page.keyboard.press('Shift+Enter'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-49: Backspace in an empty paragraph after a heading is one undo step', async ({ page }) => {
    await create(page, [{ id: 'h', type: 'header', data: { text: 'Title', level: 2 } }, P('p', '')]);
    await caretAt(page, 'p', 0);
    const trip = await roundTrip(page, () => page.keyboard.press('Backspace'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  // ---------- containers ----------

  const toggle = (kids: string[]): Blocks[number] => ({ id: 't', type: 'toggle', data: { text: 'Toggle', isOpen: true }, content: kids });
  const callout = (kids: string[]): Blocks[number] => ({ id: 'box', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: kids });

  test('W4K-60: Enter at the end of an open toggle title is one undo step', async ({ page }) => {
    await create(page, [toggle(['k1']), P('k1', 'kid', 't')]);
    await caretAt(page, 't', 'end');
    const trip = await roundTrip(page, () => page.keyboard.press('Enter'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-61: Enter at the end of an empty-bodied toggle title is one undo step', async ({ page }) => {
    await create(page, [{ id: 't', type: 'toggle', data: { text: 'Toggle', isOpen: true } }, P('after', 'After')]);
    await caretAt(page, 't', 'end');
    const trip = await roundTrip(page, () => page.keyboard.press('Enter'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  // Root cause: the gesture creates a block whose data lacks a key its tool's save() always emits
  // (here: no isOpen). The block's first save-back writes that key after the gesture's closing
  // stopCapturing, so it lands as its own invisible undo step and the first Cmd+Z does nothing.
  // Key source: toggle/block-operations.ts:47; split data: toggle-keyboard.ts splitBlock(..., { text: afterContent }),
  // closing stopCapturing: api/blocks.ts:733 (microtask). Observed: first undo changes only the new toggle, the split stays.
  test('W4K-62: Enter in the middle of a toggle title is one undo step', async ({ page }) => {
    test.fail(true, 'W4K-62: first undo of a toggle title split is a no-op');
    await create(page, [toggle(['k1']), P('k1', 'kid', 't')]);
    await caretAt(page, 't', 3);
    const trip = await roundTrip(page, () => page.keyboard.press('Enter'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-63: Backspace at the start of the first toggle child is one undo step', async ({ page }) => {
    await create(page, [toggle(['k1', 'k2']), P('k1', 'one', 't'), P('k2', 'two', 't')]);
    await caretAt(page, 'k1', 0);
    const trip = await roundTrip(page, () => page.keyboard.press('Backspace'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-64: Backspace at the start of a second toggle child is one undo step', async ({ page }) => {
    await create(page, [toggle(['k1', 'k2']), P('k1', 'one', 't'), P('k2', 'two', 't')]);
    await caretAt(page, 'k2', 0);
    const trip = await roundTrip(page, () => page.keyboard.press('Backspace'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-66: Enter at the end of a callout child is one undo step', async ({ page }) => {
    await create(page, [callout(['k1']), P('k1', 'one', 'box')]);
    await caretAt(page, 'k1', 'end');
    const trip = await roundTrip(page, () => page.keyboard.press('Enter'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-67: Enter on an empty last callout child is one undo step', async ({ page }) => {
    await create(page, [callout(['k1', 'k2']), P('k1', 'one', 'box'), P('k2', '', 'box')]);
    await caretAt(page, 'k2', 0);
    const trip = await roundTrip(page, () => page.keyboard.press('Enter'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-68: Enter on an empty last toggle child is one undo step', async ({ page }) => {
    await create(page, [toggle(['k1', 'k2']), P('k1', 'one', 't'), P('k2', '', 't')]);
    await caretAt(page, 'k2', 0);
    const trip = await roundTrip(page, () => page.keyboard.press('Enter'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-69: Enter at the end of a toggle heading is one undo step', async ({ page }) => {
    await create(page, [{ id: 'h', type: 'header', data: { text: 'Title', level: 2, isToggleable: true, isOpen: true } }, P('after', 'After')]);
    await caretAt(page, 'h', 'end');
    const trip = await roundTrip(page, () => page.keyboard.press('Enter'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  // Same as W4K-12 for a toggle heading split.
  test('W4K-70: Enter in the middle of a toggle heading is one undo step', async ({ page }) => {
    await create(page, [{ id: 'h', type: 'header', data: { text: 'Title', level: 2, isToggleable: true, isOpen: true } }, P('after', 'After')]);
    await caretAt(page, 'h', 2);
    const trip = await roundTrip(page, () => page.keyboard.press('Enter'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  // Same as W4K-12: the NEW toggle lacks isOpen.
  test('W4K-62b: Enter in the middle of a toggle title after typing in it is one undo step', async ({ page }) => {
    await create(page, [{ id: 't', type: 'toggle', data: { text: 'Toggle', isOpen: true } }]);
    await caretAt(page, 't', 'end');
    await page.keyboard.type('X');
    await gap(page);
    await caretAt(page, 't', 3);
    const trip = await roundTrip(page, () => page.keyboard.press('Enter'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  // ---------- code ----------

  test('W4K-80: Enter in a code block inserts a newline in one undo step', async ({ page }) => {
    await create(page, [{ id: 'c', type: 'code', data: { code: 'let a = 1;' } }]);
    await caretAt(page, 'c', 'end');
    const trip = await roundTrip(page, () => page.keyboard.press('Enter'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-81: Tab in a code block is one undo step', async ({ page }) => {
    await create(page, [{ id: 'c', type: 'code', data: { code: 'let a = 1;' } }]);
    await caretAt(page, 'c', 0);
    const trip = await roundTrip(page, () => page.keyboard.press('Tab'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });

  test('W4K-82: Shift+Enter in a code block is one undo step', async ({ page }) => {
    await create(page, [{ id: 'c', type: 'code', data: { code: 'let a = 1;' } }, P('after', 'After')]);
    await caretAt(page, 'c', 'end');
    const trip = await roundTrip(page, () => page.keyboard.press('Shift+Enter'));

    expect(trip.undone, 'one undo restores the state before the gesture').toEqual(trip.before);
    expect(trip.redone, 'redo restores the state after the gesture').toEqual(trip.after);
  });
});
