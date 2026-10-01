/**
 * Math and code read left-to-right in any direction, and widget text (database
 * title, embed caption, bookmark lines, board columns) sits on the side its
 * own direction says.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    BlokOriginal: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

type Direction = 'ltr' | 'rtl';

const KATEX_DIST = resolve(process.cwd(), 'node_modules/katex/dist');
const ARABIC = 'مرحبا بالعالم';
const TOLERANCE = 2;

interface Options {
  readOnly?: boolean;
  /** Registers the equation inline tool on top of the page defaults. */
  equation?: boolean;
}

const createBlok = async (page: Page, direction: Direction, blocks: OutputBlockData[], options: Options = {}): Promise<void> => {
  await page.evaluate(async ({ dir, data, readOnly, equation }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();

    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:760px;margin:40px auto 0';
    document.body.appendChild(holder);

    const toolsUrl = '/dist/tools.mjs';
    const extra = equation
      ? { equation: { class: ((await import(toolsUrl)) as { Equation: unknown }).Equation } }
      : {};

    window.blokInstance = new window.Blok({ holder, readOnly, i18n: { direction: dir }, data: { blocks: data }, tools: extra });
    await window.blokInstance.isReady;
  }, { dir: direction, data: blocks, readOnly: options.readOnly ?? false, equation: options.equation ?? false });
};

/**
 * x of each glyph KaTeX drew, keyed by glyph.
 * @param scope - element holding one rendered equation
 * @param inner - optional descendant to search in instead
 */
const glyphLefts = async (scope: Locator, inner = ''): Promise<Record<string, number>> => {
  const read = (): Promise<Array<[string, number]>> => scope.evaluate((element, within) => {
    const root = within === '' ? element : element.querySelector(within);

    return Array.from(root?.querySelectorAll('.katex-html .mord, .katex-html .mrel, .katex-html .mbin') ?? [])
      .map((glyph): [string, number] => [glyph.textContent ?? '', glyph.getBoundingClientRect().left]);
  }, inner);

  await expect.poll(async () => (await read()).length).toBeGreaterThan(0);

  return Object.fromEntries(await read());
};

/** Left/right of the laid-out text inside an element. */
const textBox = async (target: Locator): Promise<{ text: { left: number; right: number }; box: { left: number; right: number } }> =>
  target.evaluate((element) => {
    const range = document.createRange();

    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    const box = element.getBoundingClientRect();

    return { text: { left: text.left, right: text.right }, box: { left: box.left, right: box.right } };
  });

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  // KaTeX's stylesheet comes from a CDN; serve the installed copy instead.
  await page.route(/cdn\.jsdelivr\.net\/npm\/katex@[^/]+\/dist\/(.+)$/, async (route) => {
    const file = /\/dist\/(.+)$/.exec(new URL(route.request().url()).pathname)?.[1] ?? '';

    await route.fulfill({ body: readFileSync(resolve(KATEX_DIST, file)), contentType: file.endsWith('.css') ? 'text/css' : 'font/woff2' });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('math is always left-to-right', () => {
  for (const readOnly of [false, true]) {
    test(`an inline equation in an Arabic paragraph keeps its order (readOnly: ${readOnly})`, async ({ page }) => {
      await createBlok(page, 'rtl', [
        { id: 'mid', type: 'paragraph', data: { text: `${ARABIC} <span data-latex="a-b=c">a-b=c</span> ${ARABIC}` } },
        { id: 'first', type: 'paragraph', data: { text: `<span data-latex="a-b=c">a-b=c</span> ${ARABIC}` } },
      ], { readOnly, equation: true });

      for (const id of ['mid', 'first']) {
        const glyphs = await glyphLefts(page.locator(`[data-blok-id="${id}"]`));

        expect(glyphs.a, id).toBeLessThan(glyphs['='] ?? 0);
        expect(glyphs['='], id).toBeLessThan(glyphs.c ?? 0);
      }

      // A leading equation is not the paragraph's text direction.
      await expect(page.locator('[data-blok-id="first"] [data-blok-element-content]')).toHaveAttribute('dir', 'rtl');
    });

    test(`the code block's LaTeX preview keeps its order (readOnly: ${readOnly})`, async ({ page }) => {
      await createBlok(page, 'rtl', [{ id: 'code', type: 'code', data: { code: 'x = \\frac12', language: 'latex' } }], { readOnly });

      const glyphs = await glyphLefts(page.locator('[data-blok-testid="code-preview"]'));

      expect(glyphs.x).toBeLessThan(glyphs['='] ?? 0);
    });
  }

  test('the view output keeps math and code left-to-right in an RTL document', async ({ page }) => {
    const html = await page.evaluate(async () => {
      const viewUrl = '/dist/view.mjs';
      const view = await import(viewUrl) as {
        blocksToHtml: (data: unknown, options: unknown) => string;
        createLatexRenderer: () => Promise<(latex: string, options?: { displayMode?: boolean }) => string>;
      };
      const renderLatex = await view.createLatexRenderer();

      return view.blocksToHtml({ blocks: [
        { type: 'paragraph', data: { text: 'مرحبا <span data-latex="a-b=c">a-b=c</span> بالعالم' } },
        { type: 'code', data: { code: '\\frac{a}{b} = c - d', language: 'latex' } },
      ] }, {
        root: true,
        direction: 'rtl',
        inlineRenderers: {
          span: ({ attrs }: { attrs: Record<string, string> }) => attrs['data-latex'] === undefined
            ? undefined
            : renderLatex(attrs['data-latex'], { displayMode: false }),
        },
      });
    });

    await page.evaluate((markup) => {
      const host = document.createElement('div');

      host.setAttribute('data-blok-testid', 'view-host');
      host.style.cssText = 'width:600px;margin:40px auto 0';
      host.innerHTML = markup;
      document.body.appendChild(host);
    }, html);

    const host = page.getByTestId('view-host');
    const glyphs = await glyphLefts(host, 'p');

    expect(glyphs.a).toBeLessThan(glyphs.c ?? 0);

    const { text, box, firstChar } = await host.evaluate((element) => {
      const pre = element.querySelector('pre') ?? element;
      const whole = document.createRange();
      const first = document.createRange();
      const node = pre.querySelector('code')?.firstChild ?? pre;

      whole.selectNodeContents(pre);
      first.setStart(node, 0);
      first.setEnd(node, 1);

      return {
        text: { left: whole.getBoundingClientRect().left },
        box: { left: pre.getBoundingClientRect().left },
        firstChar: first.getBoundingClientRect().left,
      };
    });

    // The leading backslash is drawn first, from the left edge.
    expect(Math.abs(text.left - box.left)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(firstChar - text.left)).toBeLessThanOrEqual(TOLERANCE);
  });
});

const DATABASE = (title: string | undefined): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      ...(title === undefined ? {} : { title }),
      schema: [
        { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
        {
          id: 'prop-status',
          name: 'Status',
          type: 'select',
          position: 'a1',
          config: { options: [{ id: 'opt-a', label: 'A', color: 'gray', position: 'a0' }, { id: 'opt-b', label: 'B', color: 'gray', position: 'a1' }] },
        },
      ],
      views: [{ id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: ['prop-title'] }],
      activeViewId: 'view-1',
    },
    content: ['row-1'],
  },
  { id: 'row-1', type: 'database-row', data: { position: 'a0', properties: { 'prop-title': 'x', 'prop-status': 'opt-a' } } },
];

for (const direction of ['ltr', 'rtl'] as const) {
  test.describe(`${direction} widgets`, () => {
    test('an empty database title lays its placeholder out in the editor direction', async ({ page }) => {
      await createBlok(page, direction, DATABASE(undefined));

      const title = page.locator('[data-blok-database-title]');

      await expect(title).toBeAttached();
      expect(await title.evaluate((element) => getComputedStyle(element).direction)).toBe(direction);
    });

    test('typing the other script into an empty database title flips only the title', async ({ page }) => {
      await createBlok(page, direction, DATABASE(undefined));

      const title = page.locator('[data-blok-database-title]');
      const other = direction === 'rtl' ? 'Tasks' : 'مهام';

      // An empty title has no width to click.
      await title.focus();
      await page.keyboard.type(other.slice(0, 1));

      await expect(title).toHaveAttribute('dir', direction === 'rtl' ? 'ltr' : 'rtl');
      await expect(page.locator('[data-blok-id="db"] [data-blok-element-content]').first()).not.toHaveAttribute('dir', /.+/);
    });

    test('the board first column starts where it does in the other direction', async ({ page }) => {
      await createBlok(page, direction, DATABASE('Tasks'));

      const board = page.locator('[data-blok-database-board]');
      const column = page.locator('[data-blok-database-column]').first();

      await expect(column).toBeVisible();

      const geometry = await board.evaluate((element, dir) => {
        const first = element.querySelector('[data-blok-database-column]');
        const boardBox = element.getBoundingClientRect();
        const columnBox = first?.getBoundingClientRect();
        const style = getComputedStyle(element);
        const startPadding = parseFloat(dir === 'rtl' ? style.paddingRight : style.paddingLeft);
        const startBorder = parseFloat(dir === 'rtl' ? style.borderRightWidth : style.borderLeftWidth);

        return {
          scrollLeft: element.scrollLeft,
          fromStart: dir === 'rtl' ? boardBox.right - (columnBox?.right ?? NaN) : (columnBox?.left ?? NaN) - boardBox.left,
          startInset: startPadding + startBorder,
        };
      }, direction);

      expect(geometry.scrollLeft).toBe(0);
      expect(Math.abs(geometry.fromStart - geometry.startInset)).toBeLessThanOrEqual(TOLERANCE);
    });

    test('an embed caption starts at the inline start', async ({ page }) => {
      const caption = direction === 'rtl' ? ARABIC : 'A caption';

      await createBlok(page, direction, [{
        type: 'embed',
        data: { service: 'codepen', source: 'https://codepen.io/team/pen/abc123', embed: 'https://codepen.io/abc123?default-tab=result', caption },
      }]);

      const { text, box } = await textBox(page.locator('[data-role="embed-caption"]'));
      const fromStart = direction === 'rtl' ? box.right - text.right : text.left - box.left;

      expect(Math.abs(fromStart)).toBeLessThanOrEqual(TOLERANCE);
    });

    test('a bookmark line in the other script sits on its own start side', async ({ page }) => {
      const other = direction === 'rtl' ? 'An English title' : ARABIC;

      await createBlok(page, direction, [{
        id: 'bm',
        type: 'bookmark',
        data: { url: 'https://example.com', title: other, description: other, domain: 'example.com' },
      }]);

      for (const role of ['bookmark-title', 'bookmark-description']) {
        const { text, box } = await textBox(page.locator(`[data-role="${role}"]`));
        const fromOwnStart = direction === 'rtl' ? text.left - box.left : box.right - text.right;

        expect(Math.abs(fromOwnStart), role).toBeLessThanOrEqual(TOLERANCE);
      }
    });
  });
}
