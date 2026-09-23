import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const CAPTURE_GAP_MS = 700;
const TOOLBAR = '[data-blok-testid=inline-toolbar]';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type Blocks = OutputData['blocks'];

const P = (id: string, text: string): Blocks[number] => ({ id, type: 'paragraph', data: { text } });

const mount = async (page: Page, blocks: Blocks, proxyLinks = false): Promise<void> => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ list, proxy }) => {
    document.getElementById('blok')?.remove();
    const d = document.createElement('div');

    d.id = 'blok';
    d.setAttribute('data-blok-testid', 'blok');
    document.body.appendChild(d);
    // The test page leaves these two out of its default inline tools.
    // A non-literal specifier: the built bundle has no TS types to resolve.
    const toolsUrl = '/dist/tools.mjs?_v=1';
    const extra = await import(toolsUrl) as Record<string, unknown>;
    const blok = new window.Blok({
      holder: 'blok',
      data: { blocks: list },
      tools: { clearFormat: { class: extra.ClearFormat }, supSub: { class: extra.SupSub } },
      ...(proxy ? { link: { transformHref: (href: string) => `https://proxy.test/?u=${encodeURIComponent(href)}` } } : {}),
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { list: blocks, proxy: proxyLinks });
};

const gap = (page: Page, ms = CAPTURE_GAP_MS): Promise<void> => page.evaluate((t) => new Promise<void>((r) => {
  window.setTimeout(r, t);
}), ms);

const saved = (page: Page): Promise<Blocks> => page.evaluate(async () => {
  if (!window.blokInstance) {
    throw new Error('no editor');
  }

  return (await window.blokInstance.save()).blocks;
});

const clean = (html: string): string => html.replace(/\u200B/g, '').replace(/&nbsp;/g, ' ');

/** Saved `text` of one block (or of the table cell holding `needle`). */
const savedText = async (page: Page, id: string): Promise<string> => {
  const block = (await saved(page)).find((b) => b.id === id);

  const text: unknown = block?.data.text;

  return clean(typeof text === 'string' ? text : '');
};

/** innerHTML of the first editable inside the block's holder. */
const shownHtml = async (page: Page, id: string): Promise<string> => clean(await page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first()
  .innerHTML());

/**
 * Select from the first occurrence of `from` to the end of `to` (default: `from` itself).
 * Both needles must each sit inside one text node.
 */
const select = async (page: Page, from: string, to?: string): Promise<void> => {
  await page.evaluate(({ a, b }) => {
    const root = document.getElementById('blok');

    if (!root) {
      throw new Error('no holder');
    }
    const find = (needle: string): { node: Text; index: number } => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const index = node.data.indexOf(needle);

        if (index !== -1) {
          return { node, index };
        }
      }
      throw new Error(`text not found: ${needle}`);
    };
    const start = find(a);
    const end = find(b);
    const range = document.createRange();

    range.setStart(start.node, start.index);
    range.setEnd(end.node, end.index + b.length);
    const editable = start.node.parentElement?.closest('[contenteditable="true"]');

    if (editable instanceof HTMLElement) {
      editable.focus();
    }
    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, { a: from, b: to ?? from });
};

const selectedText = (page: Page): Promise<string> => page.evaluate(() => window.getSelection()?.toString() ?? '');

const toolbarItem = (page: Page, name: string): ReturnType<Page['locator']> => page.locator(`${TOOLBAR} [data-blok-item-name="${name}"]`);

const undo = async (page: Page): Promise<void> => {
  await page.keyboard.press(UNDO);
  await gap(page, 150);
};

const redo = async (page: Page): Promise<void> => {
  await page.keyboard.press(REDO);
  await gap(page, 150);
};

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('undo audit W4: inline formatting', () => {
  test('W4I-1: Cmd+B on part of a word undoes, redoes, and undoes again', async ({ page }) => {
    await mount(page, [P('p', 'Hello world')]);
    await select(page, 'ell');
    await page.keyboard.press(`${MOD}+b`);
    await gap(page);
    expect(await savedText(page, 'p')).toBe('H<strong>ell</strong>o world');

    await undo(page);
    expect(await savedText(page, 'p')).toBe('Hello world');
    expect(await shownHtml(page, 'p')).toBe('Hello world');

    await redo(page);
    expect(await savedText(page, 'p')).toBe('H<strong>ell</strong>o world');
    expect(await shownHtml(page, 'p')).toBe('H<strong>ell</strong>o world');

    await undo(page);
    expect(await savedText(page, 'p')).toBe('Hello world');
    expect(await shownHtml(page, 'p')).toBe('Hello world');
  });

  test('W4I-2: bold on, then bold off, are two undo steps', async ({ page }) => {
    await mount(page, [P('p', 'Hello world')]);
    await select(page, 'Hello');
    await page.keyboard.press(`${MOD}+b`);
    await gap(page);
    await select(page, 'Hello');
    await page.keyboard.press(`${MOD}+b`);
    await gap(page);
    expect(await savedText(page, 'p')).toBe('Hello world');

    await undo(page);
    expect(await savedText(page, 'p')).toBe('<strong>Hello</strong> world');
    expect(await shownHtml(page, 'p')).toBe('<strong>Hello</strong> world');
    await undo(page);
    expect(await savedText(page, 'p')).toBe('Hello world');
    await redo(page);
    await redo(page);
    expect(await savedText(page, 'p')).toBe('Hello world');
    expect(await shownHtml(page, 'p')).toBe('Hello world');
  });

  for (const [name, tag] of [['italic', 'i'], ['underline', 'u'], ['strikethrough', 's'], ['inlineCode', 'code']] as const) {
    test(`W4I-3-${name}: toolbar ${name} click undoes and redoes`, async ({ page }) => {
      await mount(page, [P('p', 'Hello world')]);
      await select(page, 'world');
      await toolbarItem(page, name).click();
      await gap(page);
      const formatted = await savedText(page, 'p');

      expect(formatted).toContain(`<${tag}`);

      await undo(page);
      expect(await savedText(page, 'p')).toBe('Hello world');
      expect(await shownHtml(page, 'p')).toBe('Hello world');
      await redo(page);
      expect(await savedText(page, 'p')).toBe(formatted);
      expect(await shownHtml(page, 'p')).toBe(formatted);
    });
  }

  for (const [key, tag] of [['i', 'i'], ['u', 'u'], ['Shift+s', 's'], ['e', 'code'], ['.', 'sup'], [',', 'sub']] as const) {
    test(`W4I-4-${key}: Cmd+${key} undoes and redoes`, async ({ page }) => {
      await mount(page, [P('p', 'Hello world')]);
      await select(page, 'world');
      await page.keyboard.press(`${MOD}+${key}`);
      await gap(page);
      const formatted = await savedText(page, 'p');

      expect(formatted).toContain(`<${tag}`);
      await undo(page);
      expect(await savedText(page, 'p')).toBe('Hello world');
      expect(await shownHtml(page, 'p')).toBe('Hello world');
      await redo(page);
      expect(await savedText(page, 'p')).toBe(formatted);
      expect(await shownHtml(page, 'p')).toBe(formatted);
    });
  }

  for (const mode of ['superscript', 'subscript']) {
    test(`W4I-3-${mode}: toolbar ${mode} undoes and redoes`, async ({ page }) => {
      await mount(page, [P('p', 'Hello world')]);
      await select(page, 'world');
      await toolbarItem(page, 'sup-sub').click();
      await page.locator(`[data-blok-item-name="${mode}"]`).click();
      await gap(page);
      const formatted = await savedText(page, 'p');

      expect(formatted).toContain(mode === 'superscript' ? '<sup' : '<sub');
      await undo(page);
      expect(await savedText(page, 'p')).toBe('Hello world');
      expect(await shownHtml(page, 'p')).toBe('Hello world');
      await redo(page);
      expect(await savedText(page, 'p')).toBe(formatted);
      expect(await shownHtml(page, 'p')).toBe(formatted);
    });
  }

  test('W4I-10b: block-settings "turn into" heading undoes and redoes', async ({ page }) => {
    await mount(page, [P('p', 'Hello world'), P('q', 'Other')]);
    await page.getByText('Hello world').click();
    await page.locator('[data-blok-testid="settings-toggler"]').click();
    await page.locator('[data-blok-testid="popover-item"][data-blok-item-name="convert-to"]').hover();
    await page.locator('[data-blok-nested="true"] [data-blok-item-name="header-1"]').click();
    await gap(page);
    expect((await saved(page))[0].type).toBe('header');

    await undo(page);
    expect((await saved(page)).map((b) => b.type)).toEqual(['paragraph', 'paragraph']);
    await expect(page.getByTestId('blok').getByRole('heading')).toHaveCount(0);
    await redo(page);
    await expect(page.getByTestId('blok').getByRole('heading', { name: 'Hello world' })).toBeVisible();
  });

  test('W4I-5: text colour from the picker undoes and redoes (picker closed)', async ({ page }) => {
    await mount(page, [P('p', 'Hello world')]);
    await select(page, 'world');
    await toolbarItem(page, 'marker').click();
    await page.getByTestId('marker-swatch-color-red').click();
    await page.mouse.click(5, 5);
    await gap(page);
    const formatted = await savedText(page, 'p');

    expect(formatted).toContain('<mark');
    await undo(page);
    expect(await savedText(page, 'p')).toBe('Hello world');
    expect(await shownHtml(page, 'p')).toBe('Hello world');
    await redo(page);
    expect(await savedText(page, 'p')).toBe(formatted);
    expect(await shownHtml(page, 'p')).toBe(formatted);
  });

  test('W4I-6: undo with the colour picker still open removes the background colour', async ({ page }) => {
    await mount(page, [P('p', 'Hello world')]);
    await select(page, 'world');
    await toolbarItem(page, 'marker').click();
    await page.getByTestId('marker-picker').getByRole('tab', { name: 'Background' })
      .click();
    await page.getByTestId('marker-swatch-background-color-yellow').click();
    await gap(page);
    expect(await savedText(page, 'p')).toContain('<mark');

    await undo(page);
    expect(await savedText(page, 'p')).toBe('Hello world');
    await page.mouse.click(5, 5);
    await gap(page, 200);
    expect(await savedText(page, 'p')).toBe('Hello world');
    expect(await shownHtml(page, 'p')).toBe('Hello world');
  });

  test('W4I-7: two colours picked in one open picker are two undo steps', async ({ page }) => {
    await mount(page, [P('p', 'Hello world')]);
    await select(page, 'world');
    await toolbarItem(page, 'marker').click();
    await page.getByTestId('marker-swatch-color-red').click();
    await gap(page);
    await page.getByTestId('marker-swatch-color-blue').click();
    await gap(page);
    await page.mouse.click(5, 5);
    await gap(page);
    expect(await savedText(page, 'p')).toMatch(/blue/);

    await undo(page);
    expect(await savedText(page, 'p')).toMatch(/red/);
    await undo(page);
    expect(await savedText(page, 'p')).toBe('Hello world');
  });

  test('W4I-8: Cmd+Shift+H highlight undoes and redoes', async ({ page }) => {
    await mount(page, [P('p', 'Hello world')]);
    await select(page, 'world');
    await page.keyboard.press(`${MOD}+Shift+h`);
    await gap(page);
    const formatted = await savedText(page, 'p');

    expect(formatted).toContain('<mark');
    await undo(page);
    expect(await savedText(page, 'p')).toBe('Hello world');
    expect(await shownHtml(page, 'p')).toBe('Hello world');
    await redo(page);
    expect(await shownHtml(page, 'p')).toBe(formatted);
  });

  test('W4I-9: clear format undoes in one step and redoes', async ({ page }) => {
    const html = '<strong>Hello</strong> <i>world</i>';

    await mount(page, [P('p', html)]);
    await select(page, 'Hello', 'world');
    await toolbarItem(page, 'clearFormat').click();
    await gap(page);
    expect(await savedText(page, 'p')).toBe('Hello world');

    await undo(page);
    expect(await savedText(page, 'p')).toBe(html);
    expect(await shownHtml(page, 'p')).toBe(html);
    await redo(page);
    expect(await savedText(page, 'p')).toBe('Hello world');
    expect(await shownHtml(page, 'p')).toBe('Hello world');
  });

  test('W4I-10: inline toolbar "turn into" heading undoes and redoes', async ({ page }) => {
    await mount(page, [P('p', 'Hello world'), P('q', 'Other')]);
    await select(page, 'world');
    await page.locator(`${TOOLBAR} [data-blok-item-name="convert-to"]`).click();
    await page.locator('[data-blok-nested="true"] [data-blok-item-name="header-1"], [data-blok-nested="true"] [data-blok-item-name="header"]').first()
      .click();
    await gap(page);
    expect((await saved(page))[0].type).toBe('header');

    await undo(page);
    const afterUndo = await saved(page);

    expect(afterUndo.map((b) => b.type)).toEqual(['paragraph', 'paragraph']);
    expect(clean(String(afterUndo[0].data.text))).toBe('Hello world');
    await expect(page.getByTestId('blok').getByRole('heading')).toHaveCount(0);
    await redo(page);
    expect((await saved(page))[0].type).toBe('header');
    await expect(page.getByTestId('blok').getByRole('heading', { name: 'Hello world' })).toBeVisible();
  });

  test('W4I-11: adding a link with Cmd+K undoes and redoes', async ({ page }) => {
    await mount(page, [P('p', 'Hello world')]);
    await select(page, 'world');
    await page.keyboard.press(`${MOD}+k`);
    const input = page.locator('[data-blok-link-tool-input-opened="true"]');

    await input.fill('https://example.com');
    await input.press('Enter');
    await gap(page);
    const linked = await savedText(page, 'p');

    expect(linked).toContain('href="https://example.com"');
    await page.getByText('Hello').click();
    await undo(page);
    expect(await savedText(page, 'p')).toBe('Hello world');
    await expect(page.getByRole('link')).toHaveCount(0);
    await redo(page);
    expect(await savedText(page, 'p')).toBe(linked);
    await expect(page.getByRole('link', { name: 'world' })).toHaveAttribute('href', 'https://example.com');
  });

  test('W4I-12: removing a link from the edit menu undoes and redoes', async ({ page }) => {
    const html = 'Hello <a href="https://example.com">world</a>';

    await mount(page, [P('p', html)]);
    await select(page, 'world');
    await page.keyboard.press(`${MOD}+k`);
    await page.getByTestId('inline-tool-remove-link').click();
    await gap(page);
    expect(await savedText(page, 'p')).toBe('Hello world');

    await undo(page);
    await expect(page.getByRole('link', { name: 'world' })).toHaveAttribute('href', 'https://example.com');
    expect(await savedText(page, 'p')).toContain('href="https://example.com"');
    await redo(page);
    await expect(page.getByRole('link')).toHaveCount(0);
    expect(await savedText(page, 'p')).toBe('Hello world');
  });

  test('W4I-13: editing a link URL from the hover card undoes and redoes', async ({ page }) => {
    await mount(page, [P('p', 'Hello <a href="https://old.example.com">world</a> end')]);
    await page.getByRole('link', { name: 'world' }).hover();
    await page.getByTestId('link-hover-card').getByTestId('link-hover-card-edit')
      .click();
    const input = page.getByTestId('inline-tool-input');

    await input.fill('https://new.example.com');
    await input.press('Enter');
    await gap(page);
    expect(await savedText(page, 'p')).toContain('https://new.example.com');

    await page.getByText('end').click();
    await undo(page);
    expect(await savedText(page, 'p')).toContain('https://old.example.com');
    await expect(page.getByRole('link', { name: 'world' })).toHaveAttribute('href', 'https://old.example.com');
    await redo(page);
    await expect(page.getByRole('link', { name: 'world' })).toHaveAttribute('href', 'https://new.example.com');
  });

  // A format and the typing right after it are separate gestures, so separate steps.
  test('W4I-14: bold then typing right away are two undo steps', async ({ page }) => {
    await mount(page, [P('p', 'Hello world')]);
    await select(page, 'Hello');
    const started = Date.now();

    await page.keyboard.press(`${MOD}+b`);
    await page.keyboard.press('End');
    await page.keyboard.type('X');
    // Past the 500 ms window the two gestures split for a reason unrelated to the defect.
    test.skip(Date.now() - started > 400, 'machine too slow to land both gestures in one capture window');
    await gap(page);
    expect(await savedText(page, 'p')).toBe('<strong>Hello</strong> worldX');

    await undo(page);
    expect(await savedText(page, 'p')).toBe('<strong>Hello</strong> world');
    expect(await shownHtml(page, 'p')).toBe('<strong>Hello</strong> world');
  });

  // Mirror of W4I-14.
  test('W4I-15: typing then bold right away are two undo steps', async ({ page }) => {
    await mount(page, [P('p', 'Hello world')]);
    await page.getByText('Hello world').click();
    await page.keyboard.press('End');
    const started = Date.now();

    await page.keyboard.type('X');
    await select(page, 'Hello');
    await page.keyboard.press(`${MOD}+b`);
    test.skip(Date.now() - started > 400, 'machine too slow to land both gestures in one capture window');
    await gap(page);
    expect(await savedText(page, 'p')).toBe('<strong>Hello</strong> worldX');

    await undo(page);
    expect(await savedText(page, 'p')).toBe('Hello worldX');
    expect(await shownHtml(page, 'p')).toBe('Hello worldX');
  });

  test('W4I-16: bold across two blocks is one undo step and one redo step', async ({ page }) => {
    await mount(page, [P('a', 'Alpha one'), P('b', 'Beta two')]);
    await select(page, 'Alpha', 'Beta');
    await page.keyboard.press(`${MOD}+b`);
    await gap(page);
    const formattedA = await savedText(page, 'a');
    const formattedB = await savedText(page, 'b');

    expect(formattedA).toContain('<strong>');
    expect(formattedB).toContain('<strong>');

    await undo(page);
    expect([await savedText(page, 'a'), await savedText(page, 'b')]).toEqual(['Alpha one', 'Beta two']);
    expect([await shownHtml(page, 'a'), await shownHtml(page, 'b')]).toEqual(['Alpha one', 'Beta two']);
    await redo(page);
    expect([await savedText(page, 'a'), await savedText(page, 'b')]).toEqual([formattedA, formattedB]);
    expect([await shownHtml(page, 'a'), await shownHtml(page, 'b')]).toEqual([formattedA, formattedB]);
  });

  test('W4I-17: undo of bold leaves the formatted range selected so bold can be re-applied', async ({ page }) => {
    await mount(page, [P('p', 'Hello world')]);
    await select(page, 'world');
    await page.keyboard.press(`${MOD}+b`);
    await gap(page);
    await undo(page);

    expect(await selectedText(page)).toBe('world');
    await page.keyboard.press(`${MOD}+b`);
    await gap(page);
    expect(await savedText(page, 'p')).toBe('Hello <strong>world</strong>');
  });

  // Redo side of W4I-17.
  test('W4I-18: redo of bold leaves the formatted range selected', async ({ page }) => {
    await mount(page, [P('p', 'Hello world')]);
    await select(page, 'world');
    await page.keyboard.press(`${MOD}+b`);
    await gap(page);
    await undo(page);
    await redo(page);

    expect(await selectedText(page)).toBe('world');
  });

  test('W4I-19: removing bold inside italic undoes back to the nested marks', async ({ page }) => {
    const html = '<i><strong>bold</strong> it</i> tail';

    await mount(page, [P('p', html)]);
    await select(page, 'bold');
    await page.keyboard.press(`${MOD}+b`);
    await gap(page);
    expect(await savedText(page, 'p')).not.toContain('<strong>');

    await undo(page);
    expect(await savedText(page, 'p')).toBe(html);
    expect(await shownHtml(page, 'p')).toBe(html);
    await redo(page);
    expect(await savedText(page, 'p')).not.toContain('<strong>');
    expect(await shownHtml(page, 'p')).not.toContain('<strong>');
  });

  const containers: Array<[string, Blocks, string]> = [
    ['heading', [{ id: 'x', type: 'header', data: { text: 'Hello world', level: 2 } }], 'x'],
    ['list item', [{ id: 'x', type: 'list', data: { text: 'Hello world', style: 'unordered' } }], 'x'],
    ['toggle title', [{ id: 'x', type: 'toggle', data: { text: 'Hello world', isOpen: true }, content: ['k'] }, { id: 'k', type: 'paragraph', data: { text: 'Kid' }, parent: 'x' }], 'x'],
    ['callout child', [{ id: 'c', type: 'callout', data: { emoji: '💡' }, content: ['x'] }, { id: 'x', type: 'paragraph', data: { text: 'Hello world' }, parent: 'c' }], 'x'],
  ];

  for (const [label, blocks, id] of containers) {
    test(`W4I-20-${label}: Cmd+B in a ${label} undoes and redoes`, async ({ page }) => {
      await mount(page, [P('a', 'Anchor'), ...blocks]);
      await select(page, 'world');
      await page.keyboard.press(`${MOD}+b`);
      await gap(page);
      expect(await savedText(page, id)).toBe('Hello <strong>world</strong>');

      await undo(page);
      expect(await savedText(page, id)).toBe('Hello world');
      expect(await shownHtml(page, id)).toBe('Hello world');
      await redo(page);
      expect(await savedText(page, id)).toBe('Hello <strong>world</strong>');
      expect(await shownHtml(page, id)).toBe('Hello <strong>world</strong>');
      await undo(page);
      expect(await shownHtml(page, id)).toBe('Hello world');
    });
  }

  test('W4I-21: Cmd+B in a table cell undoes and redoes', async ({ page }) => {
    await mount(page, [P('a', 'Anchor'), { id: 't', type: 'table', data: { withHeadings: false, content: [['Hello world', 'B'], ['C', 'D']] } }]);
    const cellText = async (): Promise<string> => {
      const all = await saved(page);
      const texts = all.map((b) => {
        const text: unknown = b.data.text;

        return clean(typeof text === 'string' ? text : '');
      });

      return texts.find((t) => t.includes('world')) ?? JSON.stringify(all);
    };

    await select(page, 'world');
    await page.keyboard.press(`${MOD}+b`);
    await gap(page);
    expect(await cellText()).toBe('Hello <strong>world</strong>');

    await undo(page);
    expect(await cellText()).toBe('Hello world');
    await expect(page.locator('[data-blok-id="t"] strong')).toHaveCount(0);
    await redo(page);
    expect(await cellText()).toBe('Hello <strong>world</strong>');
    await expect(page.locator('[data-blok-id="t"] strong')).toHaveCount(1);
  });

  test('W4I-22: Cmd+I at a caret with no typing does not add an invisible undo step', async ({ page }) => {
    await mount(page, [P('p', 'Hello world')]);
    await page.getByText('Hello world').click();
    await page.keyboard.press('End');
    await page.keyboard.type('X');
    await gap(page);
    await page.keyboard.press(`${MOD}+i`);
    await gap(page);

    await undo(page);
    expect(await savedText(page, 'p')).toBe('Hello world');
    expect((await shownHtml(page, 'p')).replace(/<i><\/i>/g, '')).toBe('Hello world');
  });

  test('W4I-23: canUndo is false once the only formatting step is undone', async ({ page }) => {
    await mount(page, [P('p', 'Hello world')]);
    await select(page, 'world');
    await page.keyboard.press(`${MOD}+b`);
    await gap(page);
    await undo(page);

    expect(await page.evaluate(() => window.blokInstance?.history.canUndo())).toBe(false);
    expect(await page.evaluate(() => window.blokInstance?.history.canRedo())).toBe(true);
  });

  test('W4I-24: after undo of a toolbar bold no visible Bold button stays active', async ({ page }) => {
    await mount(page, [P('p', 'Hello world')]);
    await select(page, 'world');
    await toolbarItem(page, 'bold').click();
    await gap(page);
    await undo(page);

    // Either the toolbar closed or its Bold button reflects the plain text.
    await expect(page.locator(`${TOOLBAR} [data-blok-item-name="bold"][data-blok-popover-item-active="true"]`)).toBeHidden();
    expect(await savedText(page, 'p')).toBe('Hello world');
  });

  test('W4I-25: removing a link from the hover card edit menu undoes and redoes', async ({ page }) => {
    await mount(page, [P('p', 'Hello <a href="https://example.com">world</a> end')]);
    await page.getByTestId('blok').getByRole('link', { name: 'world' })
      .hover();
    await page.getByTestId('link-hover-card').getByTestId('link-hover-card-edit')
      .click();
    await page.getByTestId('inline-tool-remove-link').click();
    await gap(page);
    expect(await savedText(page, 'p')).toBe('Hello world end');

    await page.getByText('end').click();
    await undo(page);
    await expect(page.getByTestId('blok').getByRole('link', { name: 'world' })).toHaveAttribute('href', 'https://example.com');
    expect(await savedText(page, 'p')).toContain('href="https://example.com"');
    await redo(page);
    await expect(page.getByTestId('blok').getByRole('link')).toHaveCount(0);
    expect(await savedText(page, 'p')).toBe('Hello world end');
  });

  test('W4I-26: changing link URL and title in one submit is one undo step', async ({ page }) => {
    const html = 'Hello <a href="https://old.example.com">world</a> end';

    await mount(page, [P('p', html)]);
    await page.getByTestId('blok').getByRole('link', { name: 'world' })
      .hover();
    await page.getByTestId('link-hover-card').getByTestId('link-hover-card-edit')
      .click();
    await page.getByTestId('inline-tool-title-input').fill('globe');
    await page.getByTestId('inline-tool-input').fill('https://new.example.com');
    await page.getByTestId('inline-tool-input').press('Enter');
    await gap(page);
    const edited = await savedText(page, 'p');

    expect(edited).toContain('globe');
    expect(edited).toContain('https://new.example.com');

    await page.getByText('end').click();
    await undo(page);
    expect(await savedText(page, 'p')).toBe(html);
    expect(await shownHtml(page, 'p')).toBe(html);
    await redo(page);
    expect(await savedText(page, 'p')).toBe(edited);
  });

  test('W4I-27: bold on the whole block (Cmd+A) undoes and redoes', async ({ page }) => {
    await mount(page, [P('p', 'Hello world'), P('q', 'Other')]);
    await page.getByText('Hello world').click();
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.press(`${MOD}+b`);
    await gap(page);
    expect(await savedText(page, 'p')).toBe('<strong>Hello world</strong>');

    await undo(page);
    expect(await savedText(page, 'p')).toBe('Hello world');
    expect(await shownHtml(page, 'p')).toBe('Hello world');
    await redo(page);
    expect(await savedText(page, 'p')).toBe('<strong>Hello world</strong>');
    expect(await shownHtml(page, 'p')).toBe('<strong>Hello world</strong>');
  });

  for (const key of ['i', 'b']) {
    test(`W4I-28-${key}: Cmd+${key} at the caret then typing undoes and redoes cleanly`, async ({ page }) => {
      await mount(page, [P('p', 'Hello world')]);
      await page.getByText('Hello world').click();
      await page.keyboard.press('End');
      await gap(page);
      await page.keyboard.press(`${MOD}+${key}`);
      await page.keyboard.type('abc');
      await gap(page);
      const typed = await savedText(page, 'p');

      expect(typed).toMatch(/world<(i|b|strong)>abc<\/(i|b|strong)>$/);

      await undo(page);
      expect(await savedText(page, 'p')).toBe('Hello world');
      expect((await shownHtml(page, 'p')).replace(/<(i|b|strong)><\/(i|b|strong)>/g, '')).toBe('Hello world');
      await redo(page);
      expect(await savedText(page, 'p')).toBe(typed);
      expect(await shownHtml(page, 'p')).toBe(typed);
    });
  }

  test('W4I-29: undo of a toolbar bold puts the caret back in the formatted block', async ({ page }) => {
    await mount(page, [P('a', 'Alpha one'), P('b', 'Hello world')]);
    // A no-op Backspace at the start of the first block leaves a caret snapshot pending.
    await page.getByText('Alpha one').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');
    await gap(page);
    expect(await savedText(page, 'a')).toBe('Alpha one');
    await select(page, 'world');
    await toolbarItem(page, 'bold').click();
    await gap(page);
    await undo(page);

    expect(await page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.closest('[data-blok-id]')?.getAttribute('data-blok-id'))).toBe('b');
    expect(await savedText(page, 'b')).toBe('Hello world');
  });

  test('W4I-30: removing a colour with the Default swatch undoes and redoes', async ({ page }) => {
    // A var() colour is not migrated at load, so this isolates colour removal from W4I-30b.
    const html = 'Hello <mark style="color: var(--blok-color-red-text); background-color: transparent;">world</mark>';

    await mount(page, [P('p', html)]);
    const before = await savedText(page, 'p');

    await select(page, 'world');
    await toolbarItem(page, 'marker').click();
    await page.getByTestId('marker-swatch-color-default').click();
    await page.mouse.click(5, 5);
    await gap(page);
    expect(await savedText(page, 'p')).toBe('Hello world');

    await undo(page);
    expect(await savedText(page, 'p')).toBe(before);
    expect(await shownHtml(page, 'p')).toBe(before);
    await redo(page);
    expect(await savedText(page, 'p')).toBe('Hello world');
  });

  test('W4I-31: inline toolbar "turn into" list undoes and redoes', async ({ page }) => {
    await mount(page, [P('p', 'Hello world'), P('q', 'Other')]);
    await select(page, 'world');
    await page.locator(`${TOOLBAR} [data-blok-item-name="convert-to"]`).click();
    await page.locator('[data-blok-nested="true"] [data-blok-item-name="bulleted-list"]').click();
    await gap(page);
    expect((await saved(page))[0].type).toBe('list');

    await undo(page);
    expect((await saved(page)).map((b) => b.type)).toEqual(['paragraph', 'paragraph']);
    await expect(page.getByTestId('blok').locator('[data-blok-component="list"]')).toHaveCount(0);
    await redo(page);
    expect((await saved(page))[0].type).toBe('list');
    await expect(page.getByTestId('blok').locator('[data-blok-component="list"]')).toHaveCount(1);
  });

  test('W4I-32: redo with the colour picker still open brings the colour back', async ({ page }) => {
    await mount(page, [P('p', 'Hello world')]);
    await select(page, 'world');
    await toolbarItem(page, 'marker').click();
    await page.getByTestId('marker-swatch-color-red').click();
    await gap(page);
    const coloured = await savedText(page, 'p');

    await undo(page);
    await redo(page);
    expect(await savedText(page, 'p')).toBe(coloured);
    await page.mouse.click(5, 5);
    await gap(page, 200);
    expect(await savedText(page, 'p')).toBe(coloured);
    expect(await shownHtml(page, 'p')).toBe(coloured);
  });

  test('W4I-33: colour on bold text undoes to just the bold', async ({ page }) => {
    const html = 'Hello <strong>world</strong>';

    await mount(page, [P('p', html)]);
    await select(page, 'world');
    await toolbarItem(page, 'marker').click();
    await page.getByTestId('marker-swatch-color-red').click();
    await page.mouse.click(5, 5);
    await gap(page);
    const coloured = await savedText(page, 'p');

    expect(coloured).toContain('<mark');
    await undo(page);
    expect(await savedText(page, 'p')).toBe(html);
    expect(await shownHtml(page, 'p')).toBe(html);
    await redo(page);
    expect(await shownHtml(page, 'p')).toBe(coloured);
  });

  test('W4I-34: bold across a paragraph and a heading is one undo step', async ({ page }) => {
    await mount(page, [P('a', 'Alpha one'), { id: 'h', type: 'header', data: { text: 'Beta two', level: 2 } }]);
    await select(page, 'one', 'Beta');
    await page.keyboard.press(`${MOD}+b`);
    await gap(page);
    expect(await savedText(page, 'h')).toContain('<strong>');

    await undo(page);
    expect([await savedText(page, 'a'), await savedText(page, 'h')]).toEqual(['Alpha one', 'Beta two']);
    await redo(page);
    expect(await savedText(page, 'a')).toContain('<strong>');
    expect(await savedText(page, 'h')).toContain('<strong>');
  });

  test('W4I-24b: after Cmd+B undo the inline toolbar does not show bold as active', async ({ page }) => {
    await mount(page, [P('p', 'Hello world')]);
    await select(page, 'world');
    await page.keyboard.press(`${MOD}+b`);
    await gap(page);
    await undo(page);

    // Either the toolbar closed or its Bold button reflects the plain text.
    await expect(page.locator(`${TOOLBAR} [data-blok-item-name="bold"][data-blok-popover-item-active="true"]`)).toBeHidden();
  });

  test('W4I-29b: control, undo of a toolbar bold without a prior no-op key puts the caret in the formatted block', async ({ page }) => {
    await mount(page, [P('a', 'Alpha one'), P('b', 'Hello world')]);
    await page.getByText('Alpha one').click();
    await gap(page);
    await select(page, 'world');
    await toolbarItem(page, 'bold').click();
    await gap(page);
    await undo(page);

    expect(await savedText(page, 'b')).toBe('Hello world');
    expect(await page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.closest('[data-blok-id]')?.getAttribute('data-blok-id'))).toBe('b');
  });

  test('W4I-30b: undo of an edit next to a loaded colour keeps the theme-aware colour', async ({ page }) => {
    await mount(page, [P('p', 'Hello <mark style="color: rgb(212, 76, 71); background-color: transparent;">world</mark> end')]);
    const markStyle = (): Promise<string> => page.getByTestId('blok').evaluate((root) => root.querySelector('mark')?.getAttribute('style') ?? '');
    const loaded = await markStyle();

    await select(page, 'end');
    await page.keyboard.press(`${MOD}+b`);
    await gap(page);
    await undo(page);
    expect(await markStyle()).toBe(loaded);
  });

  test('W4I-35: undo keeps the editor link config on loaded links', async ({ page }) => {
    await mount(page, [P('p', 'Hello <a href="https://example.com/">world</a> end')], true);
    const link = page.getByTestId('blok').getByRole('link', { name: 'world' });
    const loadedHref = await link.getAttribute('href');

    expect(loadedHref).toContain('proxy.test');
    await select(page, 'end');
    await page.keyboard.press(`${MOD}+b`);
    await gap(page);
    await undo(page);

    await expect(link).toHaveAttribute('href', loadedHref ?? '');
    expect(await savedText(page, 'p')).toContain('proxy.test');
  });

  test('W4I-35b: control, redo after undo keeps the same link', async ({ page }) => {
    await mount(page, [P('p', 'Hello <a href="https://example.com/">world</a> end')]);
    await select(page, 'end');
    await page.keyboard.press(`${MOD}+b`);
    await gap(page);
    await undo(page);
    await redo(page);
    await expect(page.getByTestId('blok').getByRole('link', { name: 'world' })).toHaveAttribute('href', 'https://example.com/');
  });

  test('W4I-36: a colour applied from the recently-used row undoes and redoes', async ({ page }) => {
    await mount(page, [P('p', 'Hello world')]);
    await select(page, 'world');
    await toolbarItem(page, 'marker').click();
    await page.getByTestId('marker-swatch-color-red').click();
    await page.mouse.click(5, 5);
    await gap(page);
    await select(page, 'Hello');
    await toolbarItem(page, 'marker').click();
    await page.getByTestId('marker-swatch-recent-text-red').click();
    await page.mouse.click(5, 5);
    await gap(page);
    const both = await savedText(page, 'p');

    expect(both.match(/<mark/g)?.length).toBe(2);
    await undo(page);
    expect((await savedText(page, 'p')).match(/<mark/g)?.length).toBe(1);
    expect((await shownHtml(page, 'p')).match(/<mark/g)?.length).toBe(1);
    await redo(page);
    expect(await savedText(page, 'p')).toBe(both);
    expect(await shownHtml(page, 'p')).toBe(both);
  });

  // Keyboard path of W4I-29.
  test('W4I-29c: undo of a Cmd+B bold after a no-op Backspace puts the caret in the formatted block', async ({ page }) => {
    await mount(page, [P('a', 'Alpha one'), P('b', 'Hello world')]);
    await page.getByText('Alpha one').click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');
    await gap(page);
    await select(page, 'world');
    await page.keyboard.press(`${MOD}+b`);
    await gap(page);
    await undo(page);

    expect(await page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.closest('[data-blok-id]')?.getAttribute('data-blok-id'))).toBe('b');
    expect(await savedText(page, 'b')).toBe('Hello world');
  });
});
