/* eslint-disable playwright/expect-expect -- some tests assert inside shared helpers */
/**
 * Copy -> paste paths the per-area specs do not reach: other copy entry
 * points, tunes, cross-editor pastes and keyboard selection.
 */
import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { docFor, runRoundTrip, SOURCES } from './containers-fixtures';
import { selectByTitle } from './containers-helpers';
import { openFixtureToggles } from '../helpers/toggle-open';
import { createEditor as createMediaEditor } from './atomic-media-helpers';
import { cellOf, fireClipboard, rectangleSelectBlock, firePaste, plainTable, selectCellRange } from './table-helpers';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

type Clip = Record<string, string>;
type Saved = { id?: string; type: string; data: Record<string, unknown>; parent?: string | null; content?: string[]; tunes?: unknown };

test.describe.configure({ mode: 'default' });

const boot = async (page: Page, blocks: OutputBlockData[], extra: Record<string, unknown> = {}, script?: string): Promise<void> => {
  await page.evaluate(async ({ seed, cfg, code }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const c = document.createElement('div');

    c.id = 'blok';
    document.body.appendChild(c);
    // eslint-disable-next-line no-new-func -- tune class source injected as a string
    const built = code === undefined ? {} : (new Function(code) as () => Record<string, unknown>)();
    const blok = new window.Blok({ holder: 'blok', data: { blocks: seed }, ...cfg, ...built });

    window.blokInstance = blok;
    await blok.isReady;
  }, { seed: blocks, cfg: extra, code: script });
};

const save = async (page: Page): Promise<Saved[]> => page.evaluate(async () =>
  ((await window.blokInstance?.save())?.blocks ?? []) as unknown as Saved[]);

const settle = async (page: Page): Promise<Saved[]> => {
  let last = '';
  let blocks: Saved[] = [];

  for (let i = 0; i < 25; i++) {
    // eslint-disable-next-line playwright/no-wait-for-timeout -- paste pipeline has no handle
    await page.waitForTimeout(150);
    blocks = await save(page);
    const sig = JSON.stringify(blocks);

    if (sig === last) {
      break;
    }
    last = sig;
  }

  return blocks;
};

const fire = async (page: Page, type: 'copy' | 'cut'): Promise<Clip> => page.evaluate(async (eventType) => {
  const store: Record<string, string> = {};
  const dt = new DataTransfer();
  const original = dt.setData.bind(dt);

  dt.setData = (f: string, d: string): void => {
    store[f] = d;
    original(f, d);
  };
  (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent(eventType, { bubbles: true, cancelable: true, clipboardData: dt }));
  await new Promise(r => setTimeout(r, 100));

  return store;
}, type);

const paste = async (page: Page, data: Clip): Promise<void> => {
  await page.evaluate((payload) => {
    const dt = new DataTransfer();

    Object.entries(payload).forEach(([k, v]) => dt.setData(k, v));
    (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
  }, data);
};

const ed = (page: Page, id: string): ReturnType<Page['locator']> =>
  page.locator(`[data-blok-id="${id}"]`).locator('[contenteditable="true"]').first();

const selectedIds = async (page: Page): Promise<string[]> => page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-blok-selected="true"]')).map(el => el.getAttribute('data-blok-id') ?? '?'));

/** Puts the caret at a character offset inside a block's first editable. */
const caretAt = async (page: Page, id: string, offset: number | 'end'): Promise<void> => {
  await ed(page, id).click();
  await ed(page, id).evaluate((el, off) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];

    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      nodes.push(n as Text);
    }
    const range = document.createRange();
    const total = nodes.reduce((s, n) => s + n.length, 0);
    let rest = off === 'end' ? total : off;
    const node = nodes.find((n) => {
      if (rest <= n.length) {
        return true;
      }
      rest -= n.length;

      return false;
    });

    if (node === undefined) {
      range.selectNodeContents(el);
      range.collapse(off !== 0);
    } else {
      range.setStart(node, rest);
      range.collapse(true);
    }
    const sel = window.getSelection();

    sel?.removeAllRanges();
    sel?.addRange(range);
  }, offset);
};

/** Id-free outline: one line per block, indented by depth. */
const outline = (blocks: Saved[]): string[] => {
  const byId = new Map(blocks.map(b => [b.id, b]));
  const lines: string[] = [];
  const seen = new Set<string | undefined>();
  const strip = (d: Record<string, unknown>): string => JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'content' || !Array.isArray(d.content) || typeof (d.content as unknown[])[0] !== 'object').sort(([a], [b]) => a.localeCompare(b))));
  const visit = (b: Saved, depth: number): void => {
    seen.add(b.id);
    lines.push(`${'  '.repeat(depth)}${b.type} ${strip(b.data)}${b.tunes !== undefined && JSON.stringify(b.tunes) !== '{}' ? ` tunes=${JSON.stringify(b.tunes)}` : ''}`);
    (b.content ?? []).forEach((cid) => {
      const c = byId.get(cid);

      if (c === undefined) {
        lines.push(`${'  '.repeat(depth + 1)}MISSING ${cid}`);
      } else {
        visit(c, depth + 1);
      }
    });
  };

  blocks.filter(b => b.parent === undefined || b.parent === null).forEach(b => visit(b, 0));
  blocks.filter(b => !seen.has(b.id)).forEach(b => lines.push(`ORPHAN ${b.type} parent=${String(b.parent)}`));

  return lines;
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('containers untested targets', () => {
  for (const target of ['tgt-top', 'tgt-in-cal', 'tgt-in-tog', 'tgt-in-tab'] as const) {
    test(`containers-toggle-with-table-other-targets -> ${target}`, async ({ page }) => {
      await runRoundTrip(page, {
        name: `critic toggleWithTable -> ${target}`,
        doc: docFor(SOURCES.toggleWithTable.blocks),
        select: (p) => selectByTitle(p, 'tog'),
        expectRoots: ['tog'],
        target,
        flavor: 'full',
      });
    });
  }

  for (const target of ['tgt-top', 'tgt-in-tog'] as const) {
    test(`containers-callout-attrs-load -> ${target}`, async ({ page }) => {
      await runRoundTrip(page, {
        name: `critic callout attrs -> ${target}`,
        doc: docFor([
          { id: 'cal', type: 'callout', data: { emoji: '🚀', backgroundColor: 'blue', textColor: 'red' }, content: ['cc1'] },
          { id: 'cc1', type: 'paragraph', data: { text: 'Callout <b>body</b>' }, parent: 'cal' },
        ]),
        select: async (p) => {
          await ed(p, 'pre').click();
          await ed(p, 'post').click({ modifiers: ['Shift'] });
        },
        expectRoots: ['pre', 'cal', 'post'],
        target,
        flavor: 'full',
      });
    });
  }

  const TOG: OutputBlockData[] = [
    { id: 'tog', type: 'toggle', data: { text: 'Copied toggle', isOpen: true }, content: ['tc1'] },
    { id: 'tc1', type: 'paragraph', data: { text: 'Copied child' }, parent: 'tog' },
  ];
  const nonEmpty: Array<[string, string, number | 'end']> = [
    ['end of non-empty paragraph', 'ne', 'end'],
    ['middle of non-empty paragraph', 'ne', 5],
    ['start of non-empty paragraph', 'ne', 0],
    ['end of a toggle title', 'ttl', 'end'],
    ['middle of a toggle title', 'ttl', 3],
  ];

  for (const [name, targetId, offset] of nonEmpty) {
    test(`containers-nonempty-or-title-targets: ${name}`, async ({ page }) => {
      await boot(page, [
        ...TOG,
        { id: 'ne', type: 'paragraph', data: { text: 'Hello World' } },
        { id: 'ttl', type: 'toggle', data: { text: 'Target toggle', isOpen: true }, content: ['ttc'] },
        { id: 'ttc', type: 'paragraph', data: { text: 'Target child' }, parent: 'ttl' },
        { id: 'tail', type: 'paragraph', data: { text: 'Tail' } },
      ]);
      await selectByTitle(page, 'tog');
      const clip = await fire(page, 'copy');

      await page.keyboard.press('Escape');
      await caretAt(page, targetId, offset);
      await paste(page, clip);
      const after = await settle(page);
      const lines = outline(after);

      const copies = lines.filter(l => l.trim().startsWith('toggle ') && l.includes('Copied toggle'));

      expect.soft(lines.filter(l => l.includes('ORPHAN') || l.includes('MISSING'))).toEqual([]);
      expect.soft(copies.length, 'pasted toggle present once besides the source').toBe(2);
      expect.soft(lines.join('\n'), 'target text kept').toContain(targetId === 'ne' ? 'Hello' : 'Target');
      expect.soft(lines.filter(l => l.includes('Copied child')).length, 'child copied').toBe(2);
    });
  }
});

test.describe('tunes, title, stubs', () => {
  const TUNE = `
    class NoteTune {
      static get isTune() { return true; }
      constructor({ data }) { this.data = data ?? { note: '' }; }
      render() { const d = document.createElement('div'); d.textContent = 'Note'; return d; }
      save() { return this.data; }
    }
    return { tools: { noteTune: { class: NoteTune } }, tunes: ['noteTune'] };
  `;

  test('mb-tunes: block-selected paragraph with tune data, copy, paste', async ({ page }) => {
    await boot(page, [
      { id: 'a', type: 'paragraph', data: { text: 'Tuned' }, tunes: { noteTune: { note: 'keep me' } } },
      { id: 'b', type: 'header', data: { text: 'Tuned head', level: 2 }, tunes: { noteTune: { note: 'head note' } } },
      { id: 'tgt', type: 'paragraph', data: { text: '' } },
    ], {}, TUNE);

    await ed(page, 'a').click();
    await ed(page, 'b').click({ modifiers: ['Shift'] });
    const clip = await fire(page, 'copy');

    await page.keyboard.press('Escape');
    await ed(page, 'tgt').click();
    await paste(page, clip);
    const after = await settle(page);

    const pasted = after.filter(b => !['a', 'b'].includes(b.id ?? ''));

    expect.soft(pasted.map(b => [b.type, b.tunes])).toEqual([
      ['paragraph', { noteTune: { note: 'keep me' } }],
      ['header', { noteTune: { note: 'head note' } }],
    ]);
  });

  test('cross-context-title-cmd-a: click page title, Cmd+A x3, copy', async ({ page }) => {
    await boot(page, [
      { id: 'p1', type: 'paragraph', data: { text: 'Body one' } },
      { id: 'p2', type: 'paragraph', data: { text: 'Body two' } },
    ], { pageTitle: true, data: { title: 'Doc Title', blocks: [
      { id: 'p1', type: 'paragraph', data: { text: 'Body one' } },
      { id: 'p2', type: 'paragraph', data: { text: 'Body two' } },
    ] } });
    await page.getByText('Doc Title', { exact: true }).click();
    const stages: unknown[] = [];

    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ControlOrMeta+A');
      stages.push({ selected: await selectedIds(page), text: await page.evaluate(() => window.getSelection()?.toString() ?? '') });
    }
    const synthetic = await fire(page, 'copy');

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const native = await page.evaluate(async () => {
      const ok = document.execCommand('copy');
      const out: Record<string, string> = {};

      for (const item of await navigator.clipboard.read()) {
        for (const type of item.types) {
          out[type] = await (await item.getType(type)).text();
        }
      }

      return { ok, out };
    });

    const clip = Object.keys(synthetic).length > 0 ? synthetic : native.out;
    await boot(page, [{ id: 'tgt', type: 'paragraph', data: { text: '' } }]);
    await ed(page, 'tgt').click();
    await paste(page, clip);
    const after = await settle(page);

    expect.soft(Object.keys(clip).length, 'copy wrote something').toBeGreaterThan(0);
    expect.soft(after.map(b => b.type), 'title text lands as one paragraph, no junk').toEqual(['paragraph']);
    expect.soft(JSON.stringify(after[0]?.data)).toContain('Doc Title');
  });

  test('cross-context-missing-tool-roundtrip-back: doc with toggle/callout opened in a minimal editor, copied, pasted into a default editor', async ({ page }) => {
    const blocks: OutputBlockData[] = [
      { id: 't', type: 'toggle', data: { text: 'Toggle title', isOpen: true }, content: ['tc'] },
      { id: 'tc', type: 'paragraph', data: { text: 'Toggle child' }, parent: 't' },
      { id: 'co', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: 'blue' }, content: ['cc'] },
      { id: 'cc', type: 'paragraph', data: { text: 'Callout child' }, parent: 'co' },
      { id: 'tail', type: 'paragraph', data: { text: 'TAIL' } },
    ];

    await boot(page, blocks);
    const original = outline(await save(page));

    await page.evaluate(async (seed) => {
      const w = window as unknown as Record<string, unknown> & { blokInstance?: Blok };

      await w.blokInstance?.destroy?.();
      document.getElementById('blok')?.remove();
      const c = document.createElement('div');

      c.id = 'blok';
      document.body.appendChild(c);
      const Ctor = w.BlokOriginal as new (cfg: unknown) => Blok;
      const blok = new Ctor({
        holder: 'blok',
        data: { blocks: seed },
        tools: { paragraph: { class: w.BlokParagraph, inlineToolbar: true }, header: { class: w.BlokHeader }, list: { class: w.BlokList } },
      });

      w.blokInstance = blok;
      await blok.isReady;
    }, blocks);

    await ed(page, 'tail').click();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ControlOrMeta+A');
    }
    const clip = await fire(page, 'copy');

    await boot(page, [{ id: 'tgt', type: 'paragraph', data: { text: '' } }]);
    await ed(page, 'tgt').click();
    await paste(page, clip);
    const after = await settle(page);

    expect.soft(outline(after)).toEqual(original);
  });

  test('database-paste-into-toggle: copy a database, paste into a toggle child', async ({ page }) => {
    test.setTimeout(60_000);
    const db: OutputBlockData[] = [
      {
        id: 'db', type: 'database',
        data: {
          title: 'Tasks',
          schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }, { id: 'p-notes', name: 'Notes', type: 'text', position: 'a1' }],
          views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
          activeViewId: 'v1',
        },
        content: ['r1', 'r2'],
      },
      { id: 'r1', type: 'database-row', parent: 'db', data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-notes': 'one' } } },
      { id: 'r2', type: 'database-row', parent: 'db', data: { position: 'a1', properties: { 'p-title': 'Bravo' } } },
    ] as OutputBlockData[];

    await boot(page, [
      { id: 'above', type: 'paragraph', data: { text: 'Above' } },
      ...db,
      { id: 'tog', type: 'toggle', data: { text: 'Holder', isOpen: true }, content: ['tc'] },
      { id: 'tc', type: 'paragraph', data: { text: '' }, parent: 'tog' },
    ]);
    await openFixtureToggles(page, { blocks: [{ id: 'tog', type: 'toggle', data: { isOpen: true } }] });

    await ed(page, 'above').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowDown');
    const clip = await fire(page, 'copy');

    await page.keyboard.press('Escape');
    const visible = await ed(page, 'tc').isVisible();

    if (visible) {
      await ed(page, 'tc').click({ timeout: 5000 });
    } else {
      await ed(page, 'tc').evaluate((el) => {
        (el as HTMLElement).focus();
        const r = document.createRange();

        r.selectNodeContents(el);
        r.collapse(true);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(r);
      });
    }
    await paste(page, clip);
    const after = await settle(page);
    const lines = outline(after);

    const tog = lines.findIndex(l => l.startsWith('toggle '));

    expect.soft(lines.filter(l => l.includes('ORPHAN') || l.includes('MISSING'))).toEqual([]);
    expect.soft(lines.slice(tog + 1).filter(l => l.startsWith('  database ')).length, 'database inside toggle').toBe(1);
    expect.soft(lines.slice(tog + 1).filter(l => l.startsWith('    database-row ')).length, 'rows under pasted db').toBe(2);
  });
});

test.describe('gaps from src copy listeners', () => {
  test('critic-code-copy-button: code block Copy button, then real Cmd+V into a paragraph and into another code block', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const code = 'const a = 1;\n\tif (a < 2) {\n  return "<b>";\n}';

    await boot(page, [
      { id: 'c1', type: 'code', data: { code, language: 'javascript' } },
      { id: 'tgt', type: 'paragraph', data: { text: '' } },
      { id: 'c2', type: 'code', data: { code: 'x', language: 'plain' } },
      { id: 'tail', type: 'paragraph', data: { text: 'Tail' } },
    ]);
    await page.locator('[data-blok-id="c1"]').hover();
    await page.locator('[data-blok-id="c1"]').getByTestId('code-copy-btn').click();
    // eslint-disable-next-line playwright/no-wait-for-timeout -- clipboard write is async
    await page.waitForTimeout(300);
    const clipText = await page.evaluate(async () => navigator.clipboard.readText());

    expect.soft(clipText).toBe(code);

    await ed(page, 'tgt').click();
    await page.keyboard.press('ControlOrMeta+V');
    const afterP = await settle(page);

    await page.locator('[data-blok-id="c2"] [data-blok-testid="code-content"]').click();
    await page.keyboard.press('End');
    await page.keyboard.press('ControlOrMeta+V');
    const afterC = await settle(page);
    const c2 = afterC.find(b => b.id === 'c2');

    expect.soft(c2?.data.code, 'pasted into code verbatim').toBe(`x${code}`);
    expect.soft(afterP.filter(b => b.id !== 'c1' && b.id !== 'c2' && b.id !== 'tail').map(b => b.type), 'paragraph target becomes code or holds the lines').not.toEqual([]);
  });

  test('critic-cross-block-text-across-callout: drag text from a top paragraph through a callout child to a paragraph after, copy, paste', async ({ page }) => {
    await boot(page, [
      { id: 'a', type: 'paragraph', data: { text: 'Alpha start' } },
      { id: 'co', type: 'callout', data: { emoji: '💡' }, content: ['cc'] },
      { id: 'cc', type: 'paragraph', data: { text: 'Inside <b>callout</b>' }, parent: 'co' },
      { id: 'z', type: 'paragraph', data: { text: 'Zeta end' } },
      { id: 'tgt', type: 'paragraph', data: { text: '' } },
    ]);
    const a = await ed(page, 'a').boundingBox();
    const z = await ed(page, 'z').boundingBox();

    if (a === null || z === null) {
      throw new Error('no boxes');
    }
    await page.mouse.move(a.x + 3, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(z.x + 30, z.y + z.height / 2, { steps: 15 });
    await page.mouse.up();
    const clip = await fire(page, 'copy');

    await ed(page, 'tgt').click();
    await paste(page, clip);
    const after = await settle(page);
    const lines = outline(after);

    expect.soft(lines.filter(l => l.includes('Alpha start')).length, 'start text pasted').toBe(2);
    expect.soft(lines.filter(l => l.includes('"callout"')).length, 'callout text pasted').toBe(2);
    expect.soft(lines.filter(l => l.includes('Zet')).length, 'end fragment pasted').toBe(2);
  });

  test('critic-paste-blocks-over-cross-block-text-selection: block copy, then paste over a text selection spanning 3 paragraphs', async ({ page }) => {
    await boot(page, [
      { id: 'h', type: 'header', data: { text: 'Copied head', level: 2 } },
      { id: 'p', type: 'paragraph', data: { text: 'Copied para' } },
      { id: 'x', type: 'paragraph', data: { text: 'Xray one' } },
      { id: 'y', type: 'paragraph', data: { text: 'Yankee two' } },
      { id: 'w', type: 'paragraph', data: { text: 'Whiskey three' } },
    ]);
    await ed(page, 'h').click();
    await ed(page, 'p').click({ modifiers: ['Shift'] });
    const clip = await fire(page, 'copy');

    await page.keyboard.press('Escape');
    const x = await ed(page, 'x').boundingBox();
    const w = await ed(page, 'w').boundingBox();

    if (x === null || w === null) {
      throw new Error('no boxes');
    }
    await page.mouse.move(x.x + 40, x.y + x.height / 2);
    await page.mouse.down();
    await page.mouse.move(w.x + 40, w.y + w.height / 2, { steps: 15 });
    await page.mouse.up();
    await paste(page, clip);
    const after = await settle(page);

    const text = outline(after).join('\n');

    expect.soft(text, 'Yankee (fully selected) removed').not.toContain('Yankee');
    expect.soft(outline(after).filter(l => l.includes('Copied head')).length, 'header pasted').toBe(2);
  });

  test('critic-link-copy-href: link hover card copy, paste the URL', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await boot(page, [
      { id: 'l', type: 'paragraph', data: { text: 'See <a href="https://example.com/docs">docs</a> here' } },
      { id: 'tgt', type: 'paragraph', data: { text: '' } },
      { id: 'mid', type: 'paragraph', data: { text: 'Hello World' } },
    ]);
    await page.locator('[data-blok-id="l"] a').hover();
    // eslint-disable-next-line playwright/no-wait-for-timeout -- hover card waits its hint delay
    await page.waitForTimeout(1200);
    const copyBtn = page.getByRole('button', { name: /copy/i });

    await copyBtn.first().click();
    // eslint-disable-next-line playwright/no-wait-for-timeout -- clipboard write is async
    await page.waitForTimeout(300);
    const text = await page.evaluate(async () => navigator.clipboard.readText());

    await ed(page, 'tgt').click();
    await page.keyboard.press('ControlOrMeta+V');
    await settle(page);
    // A URL paste opens the paste menu, which can cover the next block. Escape keeps the plain link.
    const pasteMenu = page.locator('[data-blok-popover-opened="true"]');

    await expect(pasteMenu).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(pasteMenu).toHaveCount(0);
    await caretAt(page, 'mid', 6);
    await page.keyboard.press('ControlOrMeta+V');
    const after = await settle(page);

    expect.soft(text).toBe('https://example.com/docs');
    expect.soft(after.map(b => b.type), 'URL paste stays text, no extra blocks').toEqual(['paragraph', 'paragraph', 'paragraph']);
  });

  test('critic-text-drag-drop: drag selected marked text into another paragraph (native DnD)', async ({ page }) => {
    test.fixme(true, 'critic-text-drag-drop: Blok leaves text drops to the browser, and Chrome drops <b> as a styled <span> that saves without bold; awaits a product decision');
    await boot(page, [
      { id: 's', type: 'paragraph', data: { text: 'Some <b>bold</b> words' } },
      { id: 't', type: 'paragraph', data: { text: 'Target line' } },
    ]);
    await ed(page, 's').evaluate((el) => {
      const b = el.querySelector('b, strong');

      if (b === null) {
        throw new Error('no b');
      }
      const r = document.createRange();

      r.selectNodeContents(b);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(r);
    });
    const bBox = await ed(page, 's').getByText('bold', { exact: true }).boundingBox();
    const tBox = await ed(page, 't').boundingBox();

    if (bBox === null || tBox === null) {
      throw new Error('no boxes');
    }
    await page.mouse.move(bBox.x + bBox.width / 2, bBox.y + bBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(tBox.x + tBox.width - 4, tBox.y + tBox.height / 2, { steps: 10 });
    await page.mouse.up();
    const after = await settle(page);
    const html = await page.evaluate(() => Array.from(document.querySelectorAll('[data-blok-id] [contenteditable="true"]')).map(e => e.innerHTML));

    expect.soft(after.map(b => b.type)).toEqual(['paragraph', 'paragraph']);
    expect.soft(html.join('|')).not.toMatch(/style=|<span/);
  });
});

test.describe('table RTL', () => {
  const texts = async (page: Page, id: string): Promise<string[][]> => {
    const out: string[][] = [];

    for (let r = 0; r < 2; r++) {
      const row: string[] = [];

      for (let c = 0; c < 3; c++) {
        row.push((await cellOf(page, id, r, c).innerText()).trim());
      }
      out.push(row);
    }

    return out;
  };

  test('table-untested-rtl: copy a 2x2 range from an RTL table and paste into another RTL table and outside', async ({ page }) => {
    test.setTimeout(90_000);
    await boot(page, [
      plainTable('ta', 2, 3, 'a'),
      plainTable('tb', 2, 3, 'b'),
      { id: 'out', type: 'paragraph', data: { text: '' } },
    ], { i18n: { direction: 'rtl' } });
    await selectCellRange(page, 'ta', 0, 0, 1, 1);
    const clip = await fireClipboard(page, 'copy');

    // The range selection shows the inline toolbar over the next table.
    await page.keyboard.press('Escape');
    await cellOf(page, 'tb', 0, 0).locator('[contenteditable="true"]').first().click({ timeout: 5000 });
    await firePaste(page, clip);
    const tb = await texts(page, 'tb');

    expect.soft(tb).toEqual([['a00', 'a01', 'b02'], ['a10', 'a11', 'b12']]);

    await ed(page, 'out').click();
    await firePaste(page, clip);
    const after = await settle(page);
    const newTable = after.filter(b => b.type === 'table' && !['ta', 'tb'].includes(b.id ?? ''));

    expect.soft(newTable.length, 'one new table outside').toBe(1);
    if (newTable[0] !== undefined) {

    }
  });
});

test.describe('image clipboard', () => {
  test('critic-chart-png-paste: a PNG on the clipboard (what database "Copy chart" writes) pasted into an empty paragraph', async ({ page }) => {
    await createMediaEditor(page, [
      { id: 'tgt', type: 'paragraph', data: { text: '' } },
      { id: 'tail', type: 'paragraph', data: { text: 'Tail' } },
    ] as OutputBlockData[]);
    await ed(page, 'tgt').click();
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');

      canvas.width = 8;
      canvas.height = 8;
      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));

      if (blob === null) {
        throw new Error('no blob');
      }
      const dt = new DataTransfer();

      dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
      (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    });
    const after = await settle(page);

    expect.soft(after.map(b => b.type)).toEqual(['image', 'paragraph']);
  });
});

test.describe('other selection gestures', () => {
  for (const source of ['callout', 'tabs'] as const) {
    test(`containers-other-selection-gestures: drag-handle click on ${source}, Escape the menu, copy, paste top`, async ({ page }) => {
      test.fixme(true, 'containers-other-selection-gestures: Escape on the block menu clears the selection; awaits a product decision');
      await runRoundTrip(page, {
        name: `critic handle ${source}`,
        doc: docFor(SOURCES[source].blocks),
        select: async (p) => {
          const root = SOURCES[source].root;

          await p.locator(`[data-blok-id="${root}"]`).first().hover({ position: { x: 40, y: 10 } });
          await p.getByTestId('settings-toggler').first().click();
           
          await p.waitForTimeout(300);
          await p.keyboard.press('Escape');
        },
        expectRoots: [SOURCES[source].root],
        target: 'tgt-top',
        flavor: 'full',
      });
    });

    test(`containers-other-selection-gestures: rectangle select ${source}, copy, paste top`, async ({ page }) => {
      test.fixme(true, 'containers-other-selection-gestures: a gutter rubber band over the container copies nothing; cause not traced');
      await runRoundTrip(page, {
        name: `critic rectangle ${source}`,
        doc: docFor(SOURCES[source].blocks),
        select: async (p) => {
          await rectangleSelectBlock(p, SOURCES[source].root);
        },
        expectRoots: [SOURCES[source].root],
        target: 'tgt-top',
        flavor: 'full',
      });
    });
  }
});

/** Captures what each copy/paste event saw: fired, trusted, types set or read. */
const installClipboardSpy = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const w = window as unknown as { __clipEv: unknown[] };

    w.__clipEv = [];
    const rec = (e: ClipboardEvent): void => {
      const dt = e.clipboardData;
      const entry: Record<string, unknown> = { type: e.type, trusted: e.isTrusted, target: (e.target as Element | null)?.tagName ?? null, set: [] as string[], seen: dt === null ? null : Array.from(dt.types) };

      if (dt !== null && e.type !== 'paste') {
        const original = dt.setData.bind(dt);

        dt.setData = (f: string, d: string): void => {
          (entry.set as string[]).push(`${f}(${d.length})`);
          original(f, d);
        };
      }
      w.__clipEv.push(entry);
    };

    document.addEventListener('copy', rec, true);
    document.addEventListener('cut', rec, true);
    document.addEventListener('paste', rec, true);
  });
};

const clipEvents = async (page: Page): Promise<unknown[]> => page.evaluate(() => {
  const w = window as unknown as { __clipEv: unknown[] };
  const out = w.__clipEv;

  w.__clipEv = [];

  return out;
});

test.describe('more copy paths', () => {
  test('containers-toggle-with-table-other-targets: pasted table cell refs point at the pasted cell blocks', async ({ page }) => {
    test.setTimeout(120_000);
    const results: Record<string, unknown> = {};

    for (const target of ['tgt-top', 'tgt-in-cal', 'tgt-in-tog', 'tgt-in-tab'] as const) {
      await boot(page, docFor(SOURCES.toggleWithTable.blocks), { dataModel: 'hierarchical' });
      await openFixtureToggles(page, { blocks: docFor(SOURCES.toggleWithTable.blocks) });
      const before = await save(page);
      const beforeIds = new Set(before.map(b => b.id));

      await selectByTitle(page, 'tog');
      const clip = await fire(page, 'copy');

      await page.keyboard.press('Escape');
      await ed(page, target).click();
      await paste(page, clip);
      const after = await settle(page);
      const byId = new Map(after.map(b => [b.id, b]));
      const tables = after.filter(b => b.type === 'table' && !beforeIds.has(b.id));
      const problems: string[] = [];
      const refsOf = (v: unknown): string[] => {
        if (typeof v === 'string') {
          return [v];
        }
        if (Array.isArray(v)) {
          return v.flatMap(refsOf);
        }
        if (v !== null && typeof v === 'object') {
          return refsOf((v as { blocks?: unknown }).blocks ?? []);
        }

        return [];
      };

      if (tables.length !== 1) {
        problems.push(`new tables: ${tables.length}`);
      }
      for (const t of tables) {
        const refs = refsOf(t.data.content);

        // eslint-disable-next-line max-depth -- nested walk over the saved tree
        for (const r of refs) {
          const b = byId.get(r);

          // eslint-disable-next-line max-depth -- nested walk over the saved tree
          if (b === undefined) {
            problems.push(`ref ${r} missing`);
          } else if (b.parent !== t.id) {
            problems.push(`ref ${r} parent=${String(b.parent)} not ${String(t.id)}`);
          } else if (beforeIds.has(r)) {
            problems.push(`ref ${r} points at a SOURCE block`);
          }
        }
        const kids = after.filter(b => b.parent === t.id).map(b => b.id ?? '');

        kids.filter(k => !refs.includes(k)).forEach(k => problems.push(`child ${k} not referenced by any cell`));
        results[target] = { content: t.data.content, source: before.find(b => b.id === 'ttable')?.data.content, kids, problems, cellTexts: kids.map(k => byId.get(k)?.data.text) };
      }
      expect.soft(problems, target).toEqual([]);
    }
  });

  test('containers-callout-attrs-load: backgroundColor and textColor survive the initial load', async ({ page }) => {
    test.fixme(true, 'containers-callout-attrs-load: no callout comes back from the Cmd+A copy; cause not traced');
    await boot(page, [
      { id: 'cal', type: 'callout', data: { emoji: '🚀', backgroundColor: 'blue', textColor: 'red' }, content: ['cc1'] },
      { id: 'cc1', type: 'paragraph', data: { text: 'Callout body' }, parent: 'cal' },
      { id: 'tgt', type: 'paragraph', data: { text: '' } },
    ]);
    const loaded = await save(page);

    await ed(page, 'cc1').click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('ControlOrMeta+A');
    const clip = await fire(page, 'copy');

    await page.keyboard.press('Escape');
    await ed(page, 'tgt').click();
    await paste(page, clip);
    const after = await settle(page);
    const pasted = after.filter(b => b.type === 'callout' && b.id !== 'cal');

    expect.soft(loaded.find(b => b.id === 'cal')?.data).toMatchObject({ backgroundColor: 'blue', textColor: 'red', emoji: '🚀' });
    expect.soft(pasted.map(b => b.data)).toEqual([loaded.find(b => b.id === 'cal')?.data]);
  });

  test('containers-legacy-dialect-host: toggle copy under dataModel auto in a doc with a legacy table', async ({ page }) => {
    await boot(page, [
      { id: 'lt', type: 'table', data: { withHeadings: false, content: [['L1', 'L2']] } },
      { id: 'tog', type: 'toggle', data: { text: 'Legacy host toggle', isOpen: true }, content: ['tc'] },
      { id: 'tc', type: 'paragraph', data: { text: 'Legacy host child' }, parent: 'tog' },
      { id: 'tgt', type: 'paragraph', data: { text: '' } },
    ]);

    await selectByTitle(page, 'tog');
    const clip = await fire(page, 'copy');

    await page.keyboard.press('Escape');
    await ed(page, 'tgt').click();
    await paste(page, clip);
    const after = await settle(page);
    const json = JSON.stringify(after);

    expect.soft(json.split('Legacy host toggle').length - 1, 'toggle title twice').toBe(2);
    expect.soft(json.split('Legacy host child').length - 1, 'child twice').toBe(2);
    expect.soft(outline(after).filter(l => l.includes('ORPHAN') || l.includes('MISSING'))).toEqual([]);
  });

  for (const mode of ['escape-arrow', 'shift-click', 'cmd-a-x3'] as const) {
    test(`atomic-native-block-copy-real-keys: image block selected by ${mode}, real Cmd+C, real Cmd+V`, async ({ page }) => {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await createMediaEditor(page, [
        { id: 'anchor', type: 'paragraph', data: { text: 'Anchor' } },
        { id: 'src', type: 'image', data: { url: 'http://127.0.0.1:4444/test/playwright/fixtures/image/shot.png', caption: 'Cap', naturalWidth: 800, naturalHeight: 600 } },
        { id: 'tgt', type: 'paragraph', data: { text: '' } },
      ] as OutputBlockData[]);
      await installClipboardSpy(page);
      if (mode === 'escape-arrow') {
        await ed(page, 'anchor').click();
        await page.keyboard.press('Escape');
        await page.keyboard.press('ArrowDown');
      } else if (mode === 'shift-click') {
        await ed(page, 'anchor').click();
        await page.locator('[data-blok-id="src"]').click({ modifiers: ['Shift'], position: { x: 30, y: 30 } });
      } else {
        await ed(page, 'anchor').click();
        for (let i = 0; i < 3; i++) {
          await page.keyboard.press('ControlOrMeta+A');
        }
      }

      await page.keyboard.press('ControlOrMeta+C');
      // eslint-disable-next-line playwright/no-wait-for-timeout -- copy handler is async
      await page.waitForTimeout(300);
      const copyEv = await clipEvents(page);

      await page.keyboard.press('Escape');
      await ed(page, 'tgt').click();
      await page.keyboard.press('ControlOrMeta+V');
      const after = await settle(page);

      expect.soft(copyEv.length, 'copy event fired').toBeGreaterThan(0);
      expect.soft(after.filter(b => b.type === 'image').length, 'image pasted').toBeGreaterThanOrEqual(2);
    });
  }
});

test.describe('new copy paths', () => {
  const PAGE_URL = 'https://workspace.test/pages/roadmap';
  const bootWithPages = async (page: Page, blocks: OutputBlockData[]): Promise<void> => {
    await page.evaluate(async (seed) => {
      const w = window as unknown as { blokInstance?: Blok; Blok: new (c: unknown) => Blok; defaultBlockTools: Record<string, { class: unknown }> };

      await w.blokInstance?.destroy?.();
      document.getElementById('blok')?.remove();
      const c = document.createElement('div');

      c.id = 'blok';
      document.body.appendChild(c);
      const blok = new w.Blok({
        holder: 'blok',
        data: { blocks: seed },
        tools: {
          page: {
            class: w.defaultBlockTools.page.class,
            config: {
              href: (pageId: string) => `https://workspace.test/pages/${pageId}`,
              pageIdFromHref: (href: string) => /^https:\/\/workspace\.test\/pages\/([^/?#]+)$/.exec(href)?.[1] ?? null,
              resolve: (pageId: string) => (pageId === 'roadmap' ? { title: 'Roadmap', icon: { type: 'emoji', value: '🗺️' } } : { title: `T ${pageId}` }),
              open: () => undefined,
            },
          },
        },
      });

      w.blokInstance = blok;
      await blok.isReady;
    }, blocks);
  };

  for (const flavor of ['full', 'html-only', 'plain-only'] as const) {
    test(`critic-page-mention-copy: paragraph holding a page mention, block copy, paste ${flavor}`, async ({ page }) => {
      test.fixme(flavor !== 'full', 'critic-page-mention-degraded: through plain text a mention comes back as a link, and through html the space after it is lost');
      await bootWithPages(page, [
        { id: 'src', type: 'paragraph', data: { text: 'See ' } },
        { id: 'tgt', type: 'paragraph', data: { text: '' } },
        { id: 'tail', type: 'paragraph', data: { text: 'Tail' } },
      ]);
      await ed(page, 'src').click();
      await page.keyboard.press('End');
      await ed(page, 'src').evaluate((el, url) => {
        const dt = new DataTransfer();

        dt.setData('text/plain', url);
        el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
      }, PAGE_URL);
      await page.locator('[data-blok-item-name="paste-menu-mention"]').click({ timeout: 5000 });
      await expect(page.locator('[data-blok-id="src"] [data-blok-page-id="roadmap"]')).toBeVisible();
      const before = await settle(page);
      const srcData = before.find(b => b.id === 'src')?.data;

      await selectByTitle(page, 'src');
      const clip = await fire(page, 'copy');

      await page.keyboard.press('Escape');
      await ed(page, 'tgt').click();
      const degraded: Record<string, Clip> = {
        full: clip,
        'html-only': { 'text/html': clip['text/html'] ?? '', 'text/plain': clip['text/plain'] ?? '' },
        'plain-only': { 'text/plain': clip['text/plain'] ?? '' },
      };
      const data = degraded[flavor];

      await paste(page, data);
      const after = await settle(page);
      const pasted = after.filter(b => !['src', 'tail'].includes(b.id ?? ''));

      expect.soft(pasted.map(b => b.type)).toEqual(['paragraph']);
      expect.soft(pasted[0]?.data, 'same data as the source').toEqual(srcData);
    });
  }

  test('containers-page-block: copy a live page block, paste into a toggle child, a callout child and mid-paragraph', async ({ page }) => {
    test.setTimeout(120_000);
    const seed: OutputBlockData[] = [
      { id: 'pg', type: 'page', data: { pageId: 'p2' } },
      { id: 'tog', type: 'toggle', data: { text: 'Holder', isOpen: true }, content: ['tc'] },
      { id: 'tc', type: 'paragraph', data: { text: '' }, parent: 'tog' },
      { id: 'co', type: 'callout', data: { emoji: '💡' }, content: ['cc'] },
      { id: 'cc', type: 'paragraph', data: { text: '' }, parent: 'co' },
      { id: 'mid', type: 'paragraph', data: { text: 'Hello World' } },
    ] as OutputBlockData[];

    for (const target of ['tc', 'cc', 'mid'] as const) {
      await createMediaEditor(page, [{ id: 'anchor', type: 'paragraph', data: { text: 'Anchor' } }, ...seed], { pageLink: true });
      await openFixtureToggles(page, { blocks: [{ id: 'tog', type: 'toggle', data: { isOpen: true } }] });
      await ed(page, 'anchor').click();
      await page.keyboard.press('Escape');
      await page.keyboard.press('ArrowDown');
      const clip = await fire(page, 'copy');

      await page.keyboard.press('Escape');
      if (target === 'mid') {
        await caretAt(page, 'mid', 5);
      } else {
        await ed(page, target).click();
      }
      await paste(page, clip);
      const after = await settle(page);
      const lines = outline(after);

      expect.soft(lines.filter(l => l.includes('ORPHAN') || l.includes('MISSING')), target).toEqual([]);
      expect.soft(lines.filter(l => l.trim().startsWith('page ')).length, `${target}: two page blocks or a page + reference`).toBe(2);
      expect.soft(lines.join('\n'), `${target}: target text kept`).toContain(target === 'mid' ? 'Hello' : 'Holder');
    }
  });

  for (const [tool, item, block] of [
    ['video', 'video-copy-url', { id: 'm', type: 'video', data: { url: 'http://127.0.0.1:4444/test/playwright/fixtures/video/clip.webm', caption: 'Vid' } }],
    ['file', 'file-copy-url', { id: 'm', type: 'file', data: { url: 'https://example.com/report.pdf', name: 'report.pdf', size: 1234 } }],
    ['image', 'image-copy-url', { id: 'm', type: 'image', data: { url: 'http://127.0.0.1:4444/test/playwright/fixtures/image/shot.png', caption: 'Cap' } }],
  ] as const) {
    test(`critic-media-copy-url: ${tool} menu Copy URL, paste into an empty paragraph`, async ({ page }) => {
      test.fixme(tool !== 'file', 'critic-media-copy-url: a pasted image or video URL becomes a link, not a media block; awaits a product decision');
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.route(/example\.com/, route => route.fulfill({ status: 200, contentType: 'application/pdf', body: 'x' }));
      await createMediaEditor(page, [
        block,
        { id: 'tgt', type: 'paragraph', data: { text: '' } },
        { id: 'tail', type: 'paragraph', data: { text: 'Tail' } },
      ] as OutputBlockData[]);
      await page.evaluate(() => navigator.clipboard.writeText('EMPTY'));
      await page.locator('[data-blok-id="m"]').hover({ position: { x: 40, y: 10 } });
      await page.getByTestId('settings-toggler').first().click();
      const itemLoc = page.locator(`[data-blok-item-name="${item}"]`);

      await itemLoc.first().click({ timeout: 5000 });
      // eslint-disable-next-line playwright/no-wait-for-timeout -- clipboard write is async
      await page.waitForTimeout(300);
      const text = await page.evaluate(async () => navigator.clipboard.readText());

      await page.keyboard.press('Escape');
      await ed(page, 'tgt').click();
      await paste(page, { 'text/plain': text });
      const after = await settle(page);

      const { url } = block.data;

      expect.soft(text, 'copied the block URL').toBe(url);
      // The file tool has no URL paste pattern, so a linked paragraph is the closest result.
      const cameBack = tool === 'file'
        ? after.some(b => b.type === 'paragraph' && JSON.stringify(b.data).includes(url))
        : after.filter(b => b.type === tool).length === 2;

      expect.soft(cameBack, tool === 'file' ? 'the pasted URL is kept as a link' : `a ${tool} block comes back`).toBe(true);
    });
  }

  test('database-other-untested: cell hover Copy button (text, number, date, url), paste into the same column of another row', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const schema = [
      { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
      { id: 'p-notes', name: 'Notes', type: 'text', position: 'a1' },
      { id: 'p-amount', name: 'Amount', type: 'number', position: 'a2' },
      { id: 'p-due', name: 'Due', type: 'date', position: 'a3' },
      { id: 'p-url', name: 'Link', type: 'url', position: 'a4' },
    ];
    const r1 = { 'p-title': 'Alpha', 'p-notes': 'two words "q"', 'p-amount': 1200.5, 'p-due': '2026-01-05', 'p-url': 'https://example.com/a?b=1' };

    await boot(page, [
      {
        id: 'db', type: 'database',
        data: { schema, views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }], activeViewId: 'v1' },
        content: ['r1', 'r2'],
      },
      { id: 'r1', type: 'database-row', parent: 'db', data: { position: 'a0', properties: r1 } },
      { id: 'r2', type: 'database-row', parent: 'db', data: { position: 'a1', properties: { 'p-title': 'Bravo' } } },
      { id: 'tail', type: 'paragraph', data: { text: 'Tail' } },
    ] as OutputBlockData[]);
    const cellLoc = (row: string, prop: string): ReturnType<Page['locator']> =>
      page.locator(`[data-blok-id="db"] [data-blok-database-table-row][data-row-id="${row}"] [role="gridcell"][data-property-id="${prop}"]`);
    const results: Record<string, unknown> = {};

    for (const prop of ['p-notes', 'p-amount', 'p-due', 'p-url']) {
      await page.evaluate(() => navigator.clipboard.writeText('EMPTY'));
      await cellLoc('r1', prop).hover();
      const btn = cellLoc('r1', prop).locator('[data-blok-database-table-cell-action="copy"]');
      const count = await btn.count();

      if (count > 0) {
        await btn.click({ force: true, timeout: 5000 });
      }
      // eslint-disable-next-line playwright/no-wait-for-timeout -- clipboard write is async
      await page.waitForTimeout(300);
      const text = await page.evaluate(async () => navigator.clipboard.readText());

      await cellLoc('r2', prop).click();
      if (await page.locator('[data-blok-database-cell-editor]').count() > 0) {
        await page.keyboard.press('Escape');
      }
      await page.locator('[data-blok-id="db"] [role="grid"]').first().evaluate((el, t) => {
        const dt = new DataTransfer();

        dt.setData('text/plain', t);
        el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
      }, text);
      const after = await settle(page);
      const got = (after.find(b => b.id === 'r2')?.data.properties as Record<string, unknown> | undefined)?.[prop];

      results[prop] = { button: count, clipboard: text, r2: got };
      expect.soft(got, prop).toEqual(r1[prop as keyof typeof r1]);
    }
  });

  test('critic-image-align-then-copy: change image alignment through the menu, copy at once, paste', async ({ page }) => {
    await createMediaEditor(page, [
      { id: 'anchor', type: 'paragraph', data: { text: 'Anchor' } },
      { id: 'src', type: 'image', data: { url: 'http://127.0.0.1:4444/test/playwright/fixtures/image/shot.png', caption: 'Cap', naturalWidth: 800, naturalHeight: 600 } },
      { id: 'tgt', type: 'paragraph', data: { text: '' } },
    ] as OutputBlockData[]);
    await page.locator('[data-blok-id="src"]').hover({ position: { x: 40, y: 10 } });
    await page.getByTestId('settings-toggler').first().click();
    await page.locator('[data-blok-item-name="image-alignment"]').first().click({ timeout: 5000 });
    await page.locator('[data-blok-item-name="image-alignment-right"]').first().click({ timeout: 5000 });
    await ed(page, 'anchor').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowDown');
    const clip = await fire(page, 'copy');

    await page.keyboard.press('Escape');
    await ed(page, 'tgt').click();
    await paste(page, clip);
    const after = await settle(page);
    const imgs = after.filter(b => b.type === 'image');

    expect.soft(imgs.map(b => b.data.alignment)).toEqual(['right', 'right']);
  });
});

test.describe('selection gestures on whole containers', () => {
  for (const source of ['callout', 'tabs'] as const) {
    test(`containers-other-selection-gestures: drag-handle click on ${source}, copy while the menu is open, paste top`, async ({ page }) => {
      await runRoundTrip(page, {
        name: `critic handle-open ${source}`,
        doc: docFor(SOURCES[source].blocks),
        select: async (p) => {
          await p.locator(`[data-blok-id="${SOURCES[source].root}"]`).first().hover({ position: { x: 40, y: 10 } });
          await p.getByTestId('settings-toggler').first().click();
           
          await p.waitForTimeout(300);
        },
        expectRoots: [SOURCES[source].root],
        target: 'tgt-top',
        flavor: 'full',
      });
    });

    test(`containers-other-selection-gestures: rubber band from the left gutter over ${source}, copy, paste top`, async ({ page }) => {
      await runRoundTrip(page, {
        name: `critic band ${source}`,
        doc: docFor(SOURCES[source].blocks),
        select: async (p) => {
          const root = await p.locator(`[data-blok-id="${SOURCES[source].root}"]`).first().boundingBox();
          const pre = await p.locator('[data-blok-id="pre"]').first().boundingBox();

          if (root === null || pre === null) {
            throw new Error('no box');
          }
          await p.mouse.click(5, 5);
          await p.mouse.move(Math.max(2, root.x - 30), pre.y + pre.height + 2);
          await p.mouse.down();
          await p.mouse.move(root.x + 80, root.y + root.height - 6, { steps: 20 });
          await p.mouse.up();
        },
        expectRoots: [SOURCES[source].root],
        target: 'tgt-top',
        flavor: 'full',
      });
    });
  }
});

test.describe('keyboard selection then a real shortcut', () => {
  for (const [label, keys] of [['Escape only, Cmd+C', ['Escape']], ['Escape only, Cmd+X', ['Escape']]] as const) {
    test(`critic-navigation-mode-shortcut: paragraph selected by ${label}`, async ({ page }) => {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await boot(page, [
        { id: 'src', type: 'paragraph', data: { text: 'Source <b>para</b>' } },
        { id: 'tgt', type: 'paragraph', data: { text: '' } },
      ]);
      await installClipboardSpy(page);
      await ed(page, 'src').click();
      for (const k of keys) {
        await page.keyboard.press(k);
      }
      const sel = await selectedIds(page);
      const isCut = label.endsWith('X');

      await page.keyboard.press(isCut ? 'ControlOrMeta+X' : 'ControlOrMeta+C');
      // eslint-disable-next-line playwright/no-wait-for-timeout -- copy handler is async
      await page.waitForTimeout(300);
      const ev = await clipEvents(page);

      await ed(page, 'tgt').click();
      await page.keyboard.press('ControlOrMeta+V');
      await settle(page);

      expect.soft(sel, 'block selected before the shortcut').toEqual(['src']);
      expect.soft(JSON.stringify(ev), 'Blok wrote the clipboard').toContain('application/x-blok');
    });
  }
});
