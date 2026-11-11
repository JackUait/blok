import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { blocksAsHtml } from '../helpers/saved-as-html';

/**
 * Copy (or cut) a multi-block selection inside Blok and paste it back into Blok.
 */

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

type Block = OutputData['blocks'][number];
type Mimes = Record<string, string>;

const HOLDER_ID = 'blok';
const X_BLOK = 'application/x-blok';

const boot = async (page: Page, blocks: Block[]): Promise<void> => {
  await page.evaluate(async ({ holder, seed }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: { blocks: seed } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, seed: blocks });
};

const rawSave = async (page: Page): Promise<Block[]> => page.evaluate(async () => {
  if (!window.blokInstance) {
    throw new Error('no editor');
  }

  return (await window.blokInstance.save()).blocks;
});

const save = async (page: Page): Promise<Block[]> => blocksAsHtml(await rawSave(page));

// save() leaves out empty paragraphs, so count the live blocks to see one.
const liveBlockCount = async (page: Page): Promise<number> => page.evaluate(() => window.blokInstance?.blocks.getBlocksCount() ?? 0);

/** Waits until two saves in a row agree. */
const settle = async (page: Page): Promise<void> => {
  let previous = '';

  for (let i = 0; i < 25; i++) {
    // eslint-disable-next-line playwright/no-wait-for-timeout -- the paste pipeline has no awaitable handle from the page
    await page.waitForTimeout(150);
    const current = JSON.stringify(await rawSave(page));

    if (current === previous) {
      return;
    }
    previous = current;
  }
};

const stable = (value: unknown): string => JSON.stringify(value, (_key, v: unknown) => {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)));
  }

  return v;
});

/** Id-free tree view: one line per block, indented by tree depth. */
const outline = (blocks: Block[]): string[] => {
  const byId = new Map(blocks.map(b => [b.id, b]));
  const lines: string[] = [];
  const seen = new Set<string | undefined>();
  const visit = (block: Block, depth: number): void => {
    seen.add(block.id);
    lines.push(`${'  '.repeat(depth)}${block.type} ${stable(block.data)}`);
    for (const childId of block.content ?? []) {
      const child = byId.get(childId);

      if (child === undefined) {
        lines.push(`${'  '.repeat(depth + 1)}MISSING ${childId}`);
      } else {
        visit(child, depth + 1);
      }
    }
  };

  blocks.filter(b => b.parent === undefined || b.parent === null).forEach(b => visit(b, 0));
  blocks.filter(b => !seen.has(b.id)).forEach(b => lines.push(`ORPHAN ${b.type} parent=${String(b.parent)} ${stable(b.data)}`));

  return lines;
};

/** Structural problems: dangling refs, one-sided links, duplicate ids. */
const integrity = (blocks: Block[]): string[] => {
  const byId = new Map(blocks.map(b => [b.id, b]));
  const problems: string[] = [];
  const ids = blocks.map(b => b.id);

  ids.filter((id, i) => ids.indexOf(id) !== i).forEach(id => problems.push(`duplicate id ${String(id)}`));
  blocks.forEach((b) => {
    if (b.parent !== undefined && b.parent !== null) {
      const parent = byId.get(b.parent);

      if (parent === undefined) {
        problems.push(`${String(b.id)} parent ${b.parent} missing`);
      } else if (!(parent.content ?? []).includes(b.id ?? '')) {
        problems.push(`${String(b.id)} not in content of ${b.parent}`);
      }
    }
    (b.content ?? []).forEach((childId) => {
      const child = byId.get(childId);

      if (child === undefined) {
        problems.push(`${String(b.id)} content ${childId} missing`);
      } else if (child.parent !== b.id) {
        problems.push(`${childId} listed by ${String(b.id)} but parent=${String(child.parent)}`);
      }
    });
  });

  return problems;
};

/** Fires copy/cut where the browser would: the focused element. */
const fireClipboard = async (page: Page, type: 'copy' | 'cut'): Promise<Mimes> => {
  const mimes = await page.evaluate((eventType) => {
    const store: Record<string, string> = {};
    const dt = new DataTransfer();
    const original = dt.setData.bind(dt);

    dt.setData = (format: string, data: string): void => {
      store[format] = data;
      original(format, data);
    };
    const target = document.activeElement ?? document.body;

    target.dispatchEvent(new ClipboardEvent(eventType, { bubbles: true, cancelable: true, clipboardData: dt }));

    return store;
  }, type);

  await settle(page);

  return mimes;
};

const firePaste = async (page: Page, mimes: Mimes): Promise<void> => {
  await page.evaluate((data) => {
    const dt = new DataTransfer();

    Object.entries(data).forEach(([format, value]) => dt.setData(format, value));
    const target = document.activeElement ?? document.body;

    target.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
  }, mimes);
  await settle(page);
};

const degrade = (mimes: Mimes, keep: string[]): Mimes =>
  Object.fromEntries(Object.entries(mimes).filter(([k]) => keep.includes(k)));

const holder = (page: Page, id: string): ReturnType<Page['locator']> => page.locator(`[data-blok-id="${id}"]`);

const input = (page: Page, id: string): ReturnType<Page['locator']> =>
  holder(page, id).locator('[contenteditable="true"]').first();

/** Puts the caret at the end of a block's first input. */
const caretAtEnd = async (page: Page, id: string): Promise<void> => {
  await input(page, id).click();
  await page.keyboard.press('End');
};

const selectedIds = async (page: Page): Promise<string[]> => page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-blok-selected="true"]'))
    .map(el => el.getAttribute('data-blok-id') ?? '?'));

const selectAll = async (page: Page, fromId: string): Promise<void> => {
  await input(page, fromId).click();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('ControlOrMeta+a');
  }
};

const payloadIds = (mimes: Mimes): string[] => {
  const raw = mimes[X_BLOK];

  return raw === undefined ? [] : (JSON.parse(raw) as Array<{ id: string }>).map(e => e.id);
};

/** Fresh editor holding one empty paragraph, caret in it. */
const freshTarget = async (page: Page): Promise<void> => {
  await boot(page, [{ id: 'target', type: 'paragraph', data: { text: '' } }]);
  await input(page, 'target').click();
};

const P = (id: string, text: string, extra: Partial<Block> = {}): Block => ({ id, type: 'paragraph', data: { text }, ...extra });
const LI = (id: string, text: string, style: string, depth: number, extra: Partial<Block> = {}, data: Record<string, unknown> = {}): Block =>
  ({ id, type: 'list', data: { text, style, depth, ...data }, ...extra });

/** Mixed fixture covering every content kind of the area. */
const MIX: Block[] = [
  P('p1', 'Alpha <b>bold</b> <i>it</i> <a href="https://example.com">link</a>'),
  { id: 'h1', type: 'header', data: { text: 'Head one', level: 1 } },
  { id: 'h2', type: 'header', data: { text: 'Head two', level: 2 } },
  { id: 'h3', type: 'header', data: { text: 'Head three', level: 3 } },
  { id: 'h4', type: 'header', data: { text: 'Head four', level: 4 } },
  { id: 'h5', type: 'header', data: { text: 'Head five', level: 5 } },
  { id: 'h6', type: 'header', data: { text: 'Head six', level: 6 } },
  { id: 'th', type: 'header', data: { text: 'Toggle head', level: 2, isToggleable: true }, content: ['thc'] },
  P('thc', 'Under toggle head', { parent: 'th' }),
  { id: 'tg', type: 'toggle', data: { text: 'Toggle item' }, content: ['tgc'] },
  P('tgc', 'Inside toggle', { parent: 'tg' }),
  LI('u1', 'Bullet one', 'unordered', 0, { content: ['u2'] }),
  LI('u2', 'Bullet two', 'unordered', 1, { parent: 'u1', content: ['u3'] }),
  LI('u3', 'Bullet three', 'unordered', 2, { parent: 'u2', content: ['u4'] }),
  LI('u4', 'Bullet four', 'unordered', 3, { parent: 'u3' }),
  LI('o1', 'Number one', 'ordered', 0, {}, { start: 5 }),
  LI('o2', 'Number two', 'ordered', 0, { content: ['o3'] }),
  LI('o3', 'Number nested', 'ordered', 1, { parent: 'o2' }),
  LI('c1', 'Check done', 'checklist', 0, { content: ['c3'] }, { checked: true }),
  LI('c3', 'Check nested done', 'checklist', 1, { parent: 'c1' }, { checked: true }),
  LI('c2', 'Check open', 'checklist', 0, {}, { checked: false }),
  { id: 'q1', type: 'quote', data: { text: 'Quoted words', size: 'default' } },
  { id: 'd1', type: 'divider', data: {} },
  P('pz', 'Omega'),
];

const MIX_ROOTS = MIX.filter(b => b.parent === undefined).map(b => b.id ?? '');

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('multi-block round trips', () => {
  test.describe.configure({ retries: 0, timeout: 120000 });

  test('mb-selectall-copy: Cmd+A selects every block and the payload carries all of them', async ({ page }) => {
    await boot(page, MIX);
    const original = outline(await save(page));

    await selectAll(page, 'p1');

    const mimes = await fireClipboard(page, 'copy');

    expect.soft(payloadIds(mimes)).toEqual(MIX.map(b => b.id));
    expect.soft(Object.keys(mimes).sort()).toEqual([X_BLOK, 'text/html', 'text/plain'].sort());

    // full flavor -> fresh editor
    await freshTarget(page);
    await firePaste(page, mimes);
    const fresh = await save(page);

    expect.soft(integrity(fresh)).toEqual([]);
    expect.soft(outline(fresh)).toEqual(original);
  });

  test('mb-selectall-same-doc-end: paste the whole doc into a new empty paragraph at the end of the same doc', async ({ page }) => {
    await boot(page, MIX);
    const original = outline(await save(page));

    await selectAll(page, 'p1');
    const mimes = await fireClipboard(page, 'copy');

    await page.keyboard.press('Escape');
    await caretAtEnd(page, 'pz');
    await page.keyboard.press('Enter');
    await settle(page);
    await firePaste(page, mimes);
    const after = await save(page);

    expect.soft(integrity(after)).toEqual([]);
    expect.soft(outline(after)).toEqual([...original, ...original]);

    // One undo removes the paste and also the paragraph Enter made.
    await page.keyboard.press('ControlOrMeta+z');
    await settle(page);
    const undone = await save(page);

    expect.soft(integrity(undone)).toEqual([]);
    expect.soft(outline(undone)).toEqual(original);
    expect.soft(await liveBlockCount(page), 'no block is left from the paste').toBe(original.length);
  });

  test('mb-selectall-cut-paste: cut everything then paste restores the doc', async ({ page }) => {
    await boot(page, MIX);
    const original = outline(await save(page));

    await selectAll(page, 'p1');
    const mimes = await fireClipboard(page, 'cut');
    const afterCut = await save(page);

    expect.soft(outline(afterCut)).toEqual([]);
    expect.soft(await liveBlockCount(page), 'one empty paragraph is left').toBe(1);
    await firePaste(page, mimes);
    const after = await save(page);

    expect.soft(integrity(after)).toEqual([]);
    expect.soft(outline(after)).toEqual(original);
  });

  for (const [flavor, keep] of [['html-only', ['text/html', 'text/plain']], ['plain-only', ['text/plain']]] as const) {
    test(`mb-selectall-${flavor}: degraded clipboard into a fresh editor`, async ({ page }) => {
      test.fixme(flavor === 'plain-only', 'mb-selectall-plain-only: Markdown has no toggle, and a pasted Markdown link gains target and rel');
      await boot(page, MIX);
      const original = outline(await save(page));

      await selectAll(page, 'p1');
      const mimes = degrade(await fireClipboard(page, 'copy'), [...keep]);

      await freshTarget(page);
      await firePaste(page, mimes);
      const after = await save(page);

      expect.soft(integrity(after)).toEqual([]);
      expect.soft(outline(after).length).toBe(original.length);
      expect.soft(outline(after)).toEqual(original);
    });
  }

  test('mb-shift-arrow-select: Shift+ArrowDown selection copies exactly the selected blocks', async ({ page }) => {
    await boot(page, MIX);
    await caretAtEnd(page, 'h1');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    const mimes = await fireClipboard(page, 'copy');

    expect.soft(payloadIds(mimes)).toEqual(await selectedIds(page));
  });

  test('mb-shift-click-select: Shift+click range copies the range', async ({ page }) => {
    await boot(page, MIX);
    await input(page, 'h2').click();
    await input(page, 'h5').click({ modifiers: ['Shift'] });
    const mimes = await fireClipboard(page, 'copy');

    expect.soft(payloadIds(mimes)).toEqual(['h2', 'h3', 'h4', 'h5']);
  });

  test('mb-rectangle-select: rubber band selection copies the lassoed blocks', async ({ page }) => {
    await boot(page, MIX);
    const from = await holder(page, 'h2').boundingBox();
    const to = await holder(page, 'h4').boundingBox();

    if (from === null || to === null) {
      throw new Error('no boxes');
    }
    await page.mouse.move(10, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(10, to.y + to.height / 2, { steps: 12 });
    await expect(holder(page, 'h4')).toHaveAttribute('data-blok-selected', 'true');
    await page.mouse.up();
    const mimes = await fireClipboard(page, 'copy');

    expect.soft(payloadIds(mimes)).toEqual(['h2', 'h3', 'h4']);

    // paste right after the band selection, into a new empty paragraph
    await caretAtEnd(page, 'pz');
    await page.keyboard.press('Enter');
    await settle(page);
    await firePaste(page, mimes);
    const after = await save(page);
    const tail = outline(after).slice(-3);

    expect.soft(tail).toEqual([
      'header {"level":2,"text":"Head two"}',
      'header {"level":3,"text":"Head three"}',
      'header {"level":4,"text":"Head four"}',
    ]);
  });

  test('mb-parent-child-dedupe: selecting a parent list item and its child does not duplicate the child', async ({ page }) => {
    await boot(page, MIX);
    await caretAtEnd(page, 'u1');
    await page.keyboard.press('Shift+ArrowDown');
    const mimes = await fireClipboard(page, 'copy');
    const ids = payloadIds(mimes);

    expect.soft(new Set(ids).size).toBe(ids.length);
    expect.soft(ids).toEqual(['u1', 'u2', 'u3', 'u4', 'o1']);
  });

  /** Each content group: select its root blocks, copy, paste into an empty paragraph at the end of the same doc. */
  const groups: Array<[string, string[], string[]]> = [
    ['headers', ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'], ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']],
    ['toggle-heading', ['th', 'tg'], ['th', 'thc', 'tg', 'tgc']],
    ['nested-bullets', ['u1'], ['u1', 'u2', 'u3', 'u4']],
    ['ordered-start', ['o1', 'o2'], ['o1', 'o2', 'o3']],
    ['checklist', ['c1', 'c2'], ['c1', 'c3', 'c2']],
    ['quote-divider', ['q1', 'd1', 'pz'], ['q1', 'd1', 'pz']],
  ];

  const FLAVORS = [['full', [X_BLOK, 'text/html', 'text/plain']], ['html-only', ['text/html', 'text/plain']], ['plain-only', ['text/plain']]] as const;
  const KNOWN_RED: Record<string, string> = {
    'toggle-heading plain-only': 'mb-group-toggle-heading-degraded: Markdown has no toggle, so the toggles paste back as paragraphs',
    'callout-child plain-only': 'mb-target-callout-child-plain: Markdown has no toggle, so the toggles paste back as paragraphs',
  };

  for (const [name, roots, expectedIds] of groups) {
    for (const [flavor, keep] of FLAVORS) {
      test(`mb-group-${name} [${flavor}]: block-select, copy, paste into empty paragraph at doc end`, async ({ page }) => {
        test.fixme(`${name} ${flavor}` in KNOWN_RED, KNOWN_RED[`${name} ${flavor}`]);
        await boot(page, MIX);
        const before = await save(page);
        const expected = outline(before.filter(b => expectedIds.includes(b.id ?? '')).map(b => (expectedIds.includes(b.parent ?? '') ? b : { ...b, parent: undefined })));

        await input(page, roots[0]).click();
        if (roots.length > 1) {
          const last = roots[roots.length - 1];

          await (await input(page, last).count() > 0 ? input(page, last) : holder(page, last)).click({ modifiers: ['Shift'] });
        } else {
          await page.keyboard.press('ControlOrMeta+a');
          await page.keyboard.press('ControlOrMeta+a');
        }
        const mimes = await fireClipboard(page, 'copy');

        expect.soft(payloadIds(mimes)).toEqual(expectedIds);

        await boot(page, [...before.map(b => b), { id: 'end', type: 'paragraph', data: { text: '' } }] as Block[]);
        await input(page, 'end').click();
        await firePaste(page, degrade(mimes, [...keep]));
        const after = await save(page);
        const pasted = outline(after).slice(outline(before).length);

        expect.soft(integrity(after), `${flavor} integrity`).toEqual([]);
        expect.soft(outline(after).slice(0, outline(before).length), `${flavor} original untouched`).toEqual(outline(before));
        expect.soft(pasted, `${flavor} pasted tree`).toEqual(expected);
      });
    }
  }

  test('mb-ordered-markers: pasted ordered items keep their start and render their numbers', async ({ page }) => {
    await boot(page, [
      LI('o1', 'One', 'ordered', 0, {}, { start: 5 }),
      LI('o2', 'Two', 'ordered', 0),
      P('sep', 'Separator'),
      P('end', ''),
    ]);
    await input(page, 'o1').click();
    await input(page, 'o2').click({ modifiers: ['Shift'] });
    const mimes = await fireClipboard(page, 'copy');

    await input(page, 'end').click();
    await firePaste(page, mimes);
    const after = await save(page);

    expect.soft(outline(after).slice(3)).toEqual([
      'list {"start":5,"style":"ordered","text":"One"}',
      'list {"style":"ordered","text":"Two"}',
    ]);
  });

  test('mb-target-mid-text: x-blok paste at a caret inside text', async ({ page }) => {
    await boot(page, [P('a', 'First'), P('b', 'Second'), P('t', 'HelloWorld')]);
    await input(page, 'a').click();
    await input(page, 'b').click({ modifiers: ['Shift'] });
    const mimes = await fireClipboard(page, 'copy');

    for (const [flavor, keep] of [['full', [X_BLOK, 'text/html', 'text/plain']], ['html-only', ['text/html', 'text/plain']], ['plain-only', ['text/plain']]] as const) {
      await boot(page, [P('a', 'First'), P('b', 'Second'), P('t', 'HelloWorld')]);
      await input(page, 't').click();
      await page.keyboard.press('End');
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('ArrowLeft');
      }
      await firePaste(page, degrade(mimes, [...keep]));
      const after = outline(await save(page));

      // Same shape as the plain-text path: first line joins the head, last carries the tail.
      expect.soft(after, flavor).toEqual([
        'paragraph {"text":"First"}',
        'paragraph {"text":"Second"}',
        'paragraph {"text":"HelloFirst"}',
        'paragraph {"text":"SecondWorld"}',
      ]);
    }
  });

  test('mb-target-text-selection: x-blok paste over a selected word replaces it', async ({ page }) => {
    await boot(page, [P('a', 'First'), P('b', 'Second'), P('t', 'Hello World')]);
    await input(page, 'a').click();
    await input(page, 'b').click({ modifiers: ['Shift'] });
    const mimes = await fireClipboard(page, 'copy');

    await input(page, 't').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await firePaste(page, mimes);
    const after = outline(await save(page));

    expect.soft(after.join('\n')).not.toContain('World');
  });

  test('mb-target-block-selection: paste over a block selection replaces the selected blocks', async ({ page }) => {
    await boot(page, [P('a', 'First'), P('b', 'Second'), P('x', 'Xray'), P('y', 'Yankee'), P('z', 'Zulu')]);
    await input(page, 'a').click();
    await input(page, 'b').click({ modifiers: ['Shift'] });
    const mimes = await fireClipboard(page, 'copy');

    await page.keyboard.press('Escape');
    await input(page, 'x').click();
    await input(page, 'y').click({ modifiers: ['Shift'] });
    await firePaste(page, mimes);
    const after = outline(await save(page));

    expect.soft(after).toEqual([
      'paragraph {"text":"First"}',
      'paragraph {"text":"Second"}',
      'paragraph {"text":"First"}',
      'paragraph {"text":"Second"}',
      'paragraph {"text":"Zulu"}',
    ]);
  });

  const CALLOUT: Block[] = [
    P('before', 'Before'),
    { id: 'cal', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: ['cin'] },
    P('cin', '', { parent: 'cal' }),
    P('after', 'After'),
  ];

  for (const [flavor, keep] of FLAVORS) {
    test(`mb-target-callout-child [${flavor}]: paste nested content into an empty callout child`, async ({ page }) => {
      test.fixme(`callout-child ${flavor}` in KNOWN_RED, KNOWN_RED[`callout-child ${flavor}`]);
      await boot(page, MIX);
      await caretAtEnd(page, 'h2');
      await page.keyboard.press('Shift+ArrowDown');
      await input(page, 'u1').click({ modifiers: ['Shift'] });
      const mimes = await fireClipboard(page, 'copy');

      const source = await save(page);
      const expectedIds = payloadIds(mimes);
      const expected = outline(source.filter(b => expectedIds.includes(b.id ?? '')).map(b => (expectedIds.includes(b.parent ?? '') ? b : { ...b, parent: undefined })))
        .map(line => `  ${line}`);

      await boot(page, CALLOUT);
      await input(page, 'cin').click();
      await firePaste(page, degrade(mimes, [...keep]));
      const after = await save(page);
      const lines = outline(after);

      expect.soft(integrity(after), flavor).toEqual([]);
      expect.soft(lines[0], flavor).toBe('paragraph {"text":"Before"}');
      expect.soft(lines.at(-1), flavor).toBe('paragraph {"text":"After"}');
      expect.soft(lines.slice(2, -1), `${flavor} inside callout`).toEqual(expected);
    });
  }

  test('mb-target-toggle-child: paste into the child of an open toggle', async ({ page }) => {
    await boot(page, [P('a', 'First'), LI('l1', 'Item', 'unordered', 0, { content: ['l2'] }), LI('l2', 'Sub', 'unordered', 1, { parent: 'l1' }),
      { id: 'tg', type: 'toggle', data: { text: 'Toggle' }, content: ['tc'] }, P('tc', '', { parent: 'tg' })]);
    await input(page, 'a').click();
    await input(page, 'l1').click({ modifiers: ['Shift'] });
    const mimes = await fireClipboard(page, 'copy');

    await page.keyboard.press('Escape');
    // open the toggle so its child is reachable
    const arrow = holder(page, 'tg').getByRole('button').first();

    if (await arrow.count() > 0 && !(await input(page, 'tc').isVisible())) {
      await arrow.click();
    }
    await input(page, 'tc').click();
    await firePaste(page, mimes);
    const after = await save(page);

    expect.soft(integrity(after)).toEqual([]);
    expect.soft(outline(after).slice(3)).toEqual([
      'toggle {"text":"Toggle"}',
      '  paragraph {"text":"First"}',
      '  list {"style":"unordered","text":"Item"}',
      '    list {"depth":1,"style":"unordered","text":"Sub"}',
    ]);
  });

  test('mb-partial-subtree: copy nested list children without their parent and paste at root and into a callout', async ({ page }) => {
    await boot(page, MIX);
    await input(page, 'u2').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+a');
    expect(payloadIds(await fireClipboard(page, 'copy'))).toEqual(['u2', 'u3', 'u4']);
    const mimes = await fireClipboard(page, 'copy');

    await freshTarget(page);
    await firePaste(page, mimes);
    const root = await save(page);

    expect.soft(integrity(root)).toEqual([]);
    expect.soft(outline(root)).toEqual([
      'list {"style":"unordered","text":"Bullet two"}',
      '  list {"depth":1,"style":"unordered","text":"Bullet three"}',
      '    list {"depth":2,"style":"unordered","text":"Bullet four"}',
    ]);

    await boot(page, CALLOUT);
    await input(page, 'cin').click();
    await firePaste(page, mimes);
    const inCallout = await save(page);

    expect.soft(integrity(inCallout)).toEqual([]);
    expect.soft(outline(inCallout)).toEqual([
      'paragraph {"text":"Before"}',
      'callout {"backgroundColor":null,"emoji":"💡","textColor":null}',
      '  list {"style":"unordered","text":"Bullet two"}',
      '    list {"depth":1,"style":"unordered","text":"Bullet three"}',
      '      list {"depth":2,"style":"unordered","text":"Bullet four"}',
      'paragraph {"text":"After"}',
    ]);
  });

  test('mb-partial-subtree-same-doc: paste nested children right after the source while the originals still exist', async ({ page }) => {
    await boot(page, [...MIX.slice(11, 15), P('end', '')]);
    await input(page, 'u2').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+a');
    const mimes = await fireClipboard(page, 'copy');

    expect(payloadIds(mimes)).toEqual(['u2', 'u3', 'u4']);

    await input(page, 'end').click();
    await firePaste(page, mimes);
    const after = await save(page);

    expect.soft(integrity(after)).toEqual([]);
    expect.soft(outline(after).slice(4)).toEqual([
      'list {"style":"unordered","text":"Bullet two"}',
      '  list {"depth":1,"style":"unordered","text":"Bullet three"}',
      '    list {"depth":2,"style":"unordered","text":"Bullet four"}',
    ]);
  });

  test('mb-cut-in-callout: cut every callout child, then paste back', async ({ page }) => {
    const seed: Block[] = [
      P('before', 'Before'),
      { id: 'cal', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: ['k1', 'k2'] },
      P('k1', 'Kid one', { parent: 'cal' }),
      { id: 'k2', type: 'header', data: { text: 'Kid two', level: 3 }, parent: 'cal' },
      P('after', 'After'),
    ];

    await boot(page, seed);
    const original = outline(await save(page));

    await input(page, 'k1').click();
    await input(page, 'k2').click({ modifiers: ['Shift'] });
    const mimes = await fireClipboard(page, 'cut');
    const afterCut = await save(page);

    expect.soft(outline(afterCut)).toEqual([
      'paragraph {"text":"Before"}',
      'callout {"backgroundColor":null,"emoji":"💡","textColor":null}',
      '  paragraph {"text":""}',
      'paragraph {"text":"After"}',
    ]);
    await firePaste(page, mimes);
    const after = await save(page);

    expect.soft(integrity(after)).toEqual([]);
    expect.soft(outline(after)).toEqual(original);
  });

  test('mb-cut-middle-paste-elsewhere: cut blocks out of the middle and paste them at the end', async ({ page }) => {
    await boot(page, [P('a', 'A'), LI('l1', 'L1', 'ordered', 0, { content: ['l2'] }), LI('l2', 'L2', 'ordered', 1, { parent: 'l1' }), P('b', 'B'), P('c', 'C')]);
    await input(page, 'l1').click();
    await input(page, 'b').click({ modifiers: ['Shift'] });
    const mimes = await fireClipboard(page, 'cut');
    const afterCut = outline(await save(page));

    expect.soft(afterCut).toEqual(['paragraph {"text":"A"}', 'paragraph {"text":"C"}']);
    await caretAtEnd(page, 'c');
    await page.keyboard.press('Enter');
    await settle(page);
    await firePaste(page, mimes);
    const after = await save(page);

    expect.soft(integrity(after)).toEqual([]);
    expect.soft(outline(after)).toEqual([
      'paragraph {"text":"A"}',
      'paragraph {"text":"C"}',
      'list {"style":"ordered","text":"L1"}',
      '  list {"depth":1,"style":"ordered","text":"L2"}',
      'paragraph {"text":"B"}',
    ]);
  });

  test('mb-stale-preserved: text typed just before the copy is in the payload', async ({ page }) => {
    await boot(page, [P('a', 'Start'), P('b', 'Next')]);
    await caretAtEnd(page, 'a');
    await page.keyboard.type(' typed');
    await page.keyboard.press('Shift+ArrowDown');
    const mimes = await fireClipboard(page, 'copy');

    expect.soft(mimes[X_BLOK] ?? '').toContain('Start typed');
  });

  test('mb-url-pattern: a selection whose text is one URL still pastes as its blocks', async ({ page }) => {
    await boot(page, [P('u', 'https://example.com/page'), P('e', ''), P('end', '')]);
    await input(page, 'u').click();
    await input(page, 'e').click({ modifiers: ['Shift'] });
    const mimes = await fireClipboard(page, 'copy');

    await input(page, 'end').click();
    await firePaste(page, mimes);
    const after = await save(page);

    expect.soft(outline(after).slice(2)).toEqual(['paragraph {"text":"https://example.com/page"}', 'paragraph {"text":""}']);
  });

  test('mb-cross-block-text: partial text across blocks copies and pastes the selected characters', async ({ page }) => {
    await boot(page, [P('a', 'Alpha start'), { id: 'h', type: 'header', data: { text: 'Middle head', level: 2 } }, LI('l', 'List line', 'unordered', 0), P('z', 'Zeta end'), P('end', '')]);
    // select from "start" in a to "Zeta" in z with a range across hosts
    const a = await input(page, 'a').boundingBox();
    const z = await input(page, 'z').boundingBox();

    if (a === null || z === null) {
      throw new Error('no boxes');
    }
    await page.mouse.move(a.x + a.width - 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(z.x + 20, z.y + z.height / 2, { steps: 15 });
    await page.mouse.up();

    const mimes = await fireClipboard(page, 'copy');

    expect.soft(Object.keys(mimes)).toContain('text/html');

    await input(page, 'end').click();
    await firePaste(page, mimes);
    const after = await save(page);

    expect.soft(integrity(after)).toEqual([]);
    // The paste replaces the empty 'end' block, so pasted blocks start after the first four.
    const pasted = outline(after).slice(4);

    expect.soft(pasted.some(l => l.startsWith('header {"level":2,"text":"Middle head"}'))).toBe(true);
    expect.soft(pasted.some(l => l.startsWith('list ') && l.includes('List line'))).toBe(true);
  });

  test('mb-cross-block-text-cut: cut of a cross-block text selection, then paste back at the same place', async ({ page }) => {
    await boot(page, [P('a', 'Alpha start'), P('m', 'Middle'), P('z', 'Zeta end')]);
    const original = outline(await save(page));
    const a = await input(page, 'a').boundingBox();
    const z = await input(page, 'z').boundingBox();

    if (a === null || z === null) {
      throw new Error('no boxes');
    }
    await page.mouse.move(a.x + 3, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(z.x + 20, z.y + z.height / 2, { steps: 15 });
    await page.mouse.up();

    const mimes = await fireClipboard(page, 'cut');

    await firePaste(page, mimes);
    const after = await save(page);

    expect.soft(integrity(after)).toEqual([]);
    expect.soft(outline(after)).toEqual(original);
  });

  test('mb-selectall-nested-start: Cmd+A from inside a nested list item escalates to the whole doc', async ({ page }) => {
    await boot(page, MIX);
    await input(page, 'u3').click();
    const stages: string[][] = [];

    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ControlOrMeta+a');
      stages.push(await selectedIds(page));
    }
    const mimes = await fireClipboard(page, 'copy');

    expect.soft(payloadIds(mimes)).toEqual(MIX.map(b => b.id));
    expect.soft(MIX_ROOTS.length).toBeGreaterThan(0);
  });
  test('mb2-paste-over-rectangle-selection: Cmd+V over a rubber-band selection', async ({ page }) => {
    await boot(page, [P('a', 'First'), P('b', 'Second'), P('x', 'Xray'), P('y', 'Yankee'), P('z', 'Zulu')]);
    await input(page, 'a').click();
    await input(page, 'b').click({ modifiers: ['Shift'] });
    const mimes = await fireClipboard(page, 'copy');

    await page.keyboard.press('Escape');
    const from = await holder(page, 'x').boundingBox();
    const to = await holder(page, 'y').boundingBox();

    if (from === null || to === null) {
      throw new Error('no boxes');
    }
    await page.mouse.move(10, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(10, to.y + to.height / 2, { steps: 12 });
    await expect(holder(page, 'y')).toHaveAttribute('data-blok-selected', 'true');
    await page.mouse.up();
    await firePaste(page, mimes);
    const after = outline(await save(page));

    expect.soft(after).toEqual([
      'paragraph {"text":"First"}',
      'paragraph {"text":"Second"}',
      'paragraph {"text":"First"}',
      'paragraph {"text":"Second"}',
      'paragraph {"text":"Zulu"}',
    ]);
  });

  test('mb2-paste-over-select-all: paste over a Cmd+A selection of the whole doc replaces it', async ({ page }) => {
    await boot(page, [P('a', 'First'), P('b', 'Second')]);
    await input(page, 'a').click();
    await input(page, 'b').click({ modifiers: ['Shift'] });
    const mimes = await fireClipboard(page, 'copy');

    await page.keyboard.press('Escape');
    await selectAll(page, 'a');
    await firePaste(page, mimes);
    const after = outline(await save(page));

    expect.soft(after).toEqual(['paragraph {"text":"First"}', 'paragraph {"text":"Second"}']);
  });

  test('mb2-callout-list-depth: a root list item pasted into a callout keeps depth 0', async ({ page }) => {
    await boot(page, [
      { id: 'cal', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: ['cl'] },
      LI('cl', 'Native item', 'unordered', 0, { parent: 'cal' }),
    ]);

    await boot(page, [P('a', 'Para'), LI('o1', 'Root ordered', 'ordered', 0), LI('u1', 'Root bullet', 'unordered', 0), ...CALLOUT]);
    await input(page, 'a').click();
    await input(page, 'u1').click({ modifiers: ['Shift'] });
    const mimes = await fireClipboard(page, 'copy');

    await input(page, 'cin').click();
    await firePaste(page, mimes);
    const after = await save(page);

    expect.soft(outline(after).filter(l => l.includes('"list') || l.includes('list {'))).toEqual([
      '  list {"style":"ordered","text":"Root ordered"}',
      '  list {"style":"unordered","text":"Root bullet"}',
      'list {"style":"ordered","text":"Root ordered"}',
      'list {"style":"unordered","text":"Root bullet"}',
    ].sort((x, y) => Number(x.startsWith('  ')) - Number(y.startsWith('  '))));
  });

  test('mb2-end-of-nonempty: x-blok paste with the caret at the end of a non-empty paragraph', async ({ page }) => {
    const seed = [P('a', 'First'), P('b', 'Second'), P('t', 'Omega')];

    await boot(page, seed);
    await input(page, 'a').click();
    await input(page, 'b').click({ modifiers: ['Shift'] });
    const mimes = await fireClipboard(page, 'copy');

    for (const [flavor, keep] of [['full', [X_BLOK, 'text/html', 'text/plain']], ['html-only', ['text/html', 'text/plain']], ['plain-only', ['text/plain']]] as const) {
      await boot(page, seed);
      await caretAtEnd(page, 't');
      await firePaste(page, degrade(mimes, [...keep]));
      const after = outline(await save(page));

      expect.soft(after, flavor).toEqual([
        'paragraph {"text":"First"}',
        'paragraph {"text":"Second"}',
        'paragraph {"text":"OmegaFirst"}',
        'paragraph {"text":"Second"}',
      ]);
    }
  });

  test('mb2-start-of-nonempty: x-blok paste with the caret at the start of a non-empty paragraph', async ({ page }) => {
    const seed = [P('a', 'First'), P('b', 'Second'), P('t', 'Omega')];

    await boot(page, seed);
    await input(page, 'a').click();
    await input(page, 'b').click({ modifiers: ['Shift'] });
    const mimes = await fireClipboard(page, 'copy');

    for (const [flavor, keep] of [['full', [X_BLOK, 'text/html', 'text/plain']], ['html-only', ['text/html', 'text/plain']], ['plain-only', ['text/plain']]] as const) {
      await boot(page, seed);
      await input(page, 't').click();
      await page.keyboard.press('Home');
      await firePaste(page, degrade(mimes, [...keep]));
      const after = outline(await save(page));

      expect.soft(after, flavor).toEqual([
        'paragraph {"text":"First"}',
        'paragraph {"text":"Second"}',
        'paragraph {"text":"First"}',
        'paragraph {"text":"SecondOmega"}',
      ]);
    }
  });

  test('mb2-ordered-continuation: ordered items with start pasted right after another ordered list', async ({ page }) => {
    await boot(page, [
      LI('x1', 'Ex', 'ordered', 0),
      LI('x2', 'Why', 'ordered', 0),
      P('end', ''),
      P('sep', 'Sep'),
      LI('s1', 'One', 'ordered', 0, {}, { start: 3 }),
      LI('s2', 'Two', 'ordered', 0),
    ]);
    await input(page, 's1').click();
    await input(page, 's2').click({ modifiers: ['Shift'] });
    const mimes = await fireClipboard(page, 'copy');

    await input(page, 'end').click();
    await firePaste(page, mimes);
    const after = outline(await save(page));

    expect.soft(after.slice(0, 4)).toEqual([
      'list {"style":"ordered","text":"Ex"}',
      'list {"style":"ordered","text":"Why"}',
      'list {"start":3,"style":"ordered","text":"One"}',
      'list {"style":"ordered","text":"Two"}',
    ]);
  });

  test('mb2-cross-block-checklist: checked state survives a cross-block text copy', async ({ page }) => {
    await boot(page, [P('a', 'Lead in text'), LI('c1', 'Done item', 'checklist', 0, {}, { checked: true }), LI('c2', 'Open item', 'checklist', 0, {}, { checked: false }), P('z', 'Tail end text'), P('end', '')]);
    const a = await input(page, 'a').boundingBox();
    const z = await input(page, 'z').boundingBox();

    if (a === null || z === null) {
      throw new Error('no boxes');
    }
    await page.mouse.move(a.x + 30, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(z.x + 30, z.y + z.height / 2, { steps: 15 });
    await page.mouse.up();
    const mimes = await fireClipboard(page, 'copy');

    await input(page, 'end').click();
    await firePaste(page, mimes);
    const after = outline(await save(page));

    expect.soft(after.slice(4)).toContain('list {"checked":true,"style":"checklist","text":"Done item"}');
  });

  test('mb2-cut-undo: Cmd+Z after a block cut restores the blocks in place', async ({ page }) => {
    const seed = [P('a', 'A'), LI('l1', 'L1', 'ordered', 0, { content: ['l2'] }), LI('l2', 'L2', 'ordered', 1, { parent: 'l1' }), P('b', 'B'), P('c', 'C')];

    await boot(page, seed);
    const original = outline(await save(page));

    await input(page, 'l1').click();
    await input(page, 'b').click({ modifiers: ['Shift'] });
    await fireClipboard(page, 'cut');
    await page.keyboard.press('ControlOrMeta+z');
    await settle(page);
    const after = await save(page);

    expect.soft(integrity(after)).toEqual([]);
    expect.soft(outline(after)).toEqual(original);
  });

  test('mb2-html-list-layout: nested bullets via the html flavor render at the same indents', async ({ page }) => {
    const seed = MIX.slice(11, 15);

    await boot(page, seed);
    const leftOf = async (): Promise<number[]> => page.evaluate(() => Array.from(document.querySelectorAll('[role="listitem"] [contenteditable="true"], [contenteditable="true"][role="listitem"]'))
      .map(el => Math.round(el.getBoundingClientRect().left)));
    const originalLefts = await leftOf();

    await input(page, 'u1').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+a');
    const mimes = await fireClipboard(page, 'copy');

    for (const [flavor, keep] of [['full', [X_BLOK, 'text/html', 'text/plain']], ['html-only', ['text/html', 'text/plain']], ['plain-only', ['text/plain']]] as const) {
      await freshTarget(page);
      await firePaste(page, degrade(mimes, [...keep]));
      const lefts = await leftOf();

      expect.soft(lefts, flavor).toEqual(originalLefts);
    }
  });

  test('mb2-cut-in-callout-keyboard-paste-target: after cutting every callout child, where does the caret go', async ({ page }) => {
    const seed: Block[] = [
      P('before', 'Before'),
      { id: 'cal', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, content: ['k1', 'k2'] },
      P('k1', 'Kid one', { parent: 'cal' }),
      P('k2', 'Kid two', { parent: 'cal' }),
      P('after', 'After'),
    ];

    await boot(page, seed);
    await input(page, 'k1').click();
    await input(page, 'k2').click({ modifiers: ['Shift'] });
    await fireClipboard(page, 'cut');
    const calloutChildren = await holder(page, 'cal').locator('[data-blok-id]').count();

    expect.soft(calloutChildren).toBe(1);
  });
});
