import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.beforeAll(ensureBlokBundleBuilt);

const LONG_LINE = '// a deliberately long comment that keeps going well past the width of a narrow editor so it wraps';

const createBlok = async (page: Page, blocks: OutputData['blocks'], width = 360): Promise<void> => {
  await page.evaluate(async ({ holder, blokBlocks, holderWidth }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.style.width = `${holderWidth}px`;
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: { blocks: blokBlocks } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blokBlocks: blocks, holderWidth: width });
};

/** Top of each logical line's first glyph, read from the rendered text. */
const lineTops = async (page: Page): Promise<number[]> => page.evaluate(() => {
  const code = document.querySelector<HTMLElement>('[data-blok-testid="code-content"]');

  if (!code) {
    throw new Error('no code element');
  }

  const text = code.textContent ?? '';
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];

  while (walker.nextNode()) {
    nodes.push(walker.currentNode as Text);
  }

  const locate = (offset: number): [Text, number] => {
    let consumed = 0;

    for (const node of nodes) {
      if (consumed + node.length > offset) {
        return [node, offset - consumed];
      }
      consumed += node.length;
    }

    throw new Error('offset past end');
  };

  const starts = text.split('\n').reduce<number[]>((acc, line, index, lines) => [...acc, index === 0 ? 0 : acc[index - 1] + lines[index - 1].length + 1], []);

  return starts.map((start) => {
    const [node, offset] = locate(start);
    const range = document.createRange();

    range.setStart(node, offset);
    range.setEnd(node, offset + 1);

    return range.getBoundingClientRect().top;
  });
});

const gutterTops = async (page: Page): Promise<number[]> => page
  .getByTestId('code-gutter')
  .locator('[data-line-index]')
  .evaluateAll((lines) => lines.map((line) => line.getBoundingClientRect().top));

test.describe('code block chrome', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('keeps every line number level with its line when a line wraps', async ({ page }) => {
    await createBlok(page, [{ type: 'code', data: { code: `const a = 1;\n${LONG_LINE}\nconst b = 2;\nconst c = 3;`, language: 'javascript' } }]);

    const text = await lineTops(page);
    const gutter = await gutterTops(page);

    // The wrap must really happen, or this test proves nothing.
    expect(text[2] - text[1]).toBeGreaterThan((text[1] - text[0]) * 1.5);
    expect(gutter).toHaveLength(text.length);
    gutter.forEach((top, index) => {
      expect(Math.abs(top - text[index]), `line ${index + 1}`).toBeLessThanOrEqual(4);
    });
  });

  test('re-aligns the gutter when the editor width changes', async ({ page }) => {
    await createBlok(page, [{ type: 'code', data: { code: `${LONG_LINE}\nconst b = 2;`, language: 'javascript' } }], 1000);

    await page.evaluate((holder) => {
      const container = document.getElementById(holder);

      if (container) {
        container.style.width = '360px';
      }
    }, HOLDER_ID);

    await expect.poll(async () => {
      const [text, gutter] = [await lineTops(page), await gutterTops(page)];

      return Math.abs(gutter[1] - text[1]);
    }).toBeLessThanOrEqual(4);
  });

  test('draws the active-line band over the whole wrapped line holding the caret', async ({ page }) => {
    await createBlok(page, [{ type: 'code', data: { code: `const a = 1;\n${LONG_LINE}\nconst b = 2;`, language: 'javascript' } }]);

    const band = page.getByTestId('code-active-line');

    await expect(band).toBeHidden();

    await page.getByTestId('code-content').click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('ArrowDown');

    await expect(band).toBeVisible();

    const text = await lineTops(page);
    const box = await band.boundingBox();

    expect(box).not.toBeNull();
    expect(Math.abs((box?.y ?? 0) - text[1])).toBeLessThanOrEqual(4);
    expect(Math.abs((box?.y ?? 0) + (box?.height ?? 0) - text[2])).toBeLessThanOrEqual(4);
    await expect(page.getByTestId('code-gutter').locator('[data-active="true"]')).toHaveText('2');

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('code-gutter').locator('[data-active="true"]')).toHaveText('3');

    await page.getByTestId('code-content').evaluate((element) => element.blur());
    await expect(band).toBeHidden();
  });

  test('leaves no empty strip under the code of a block without a preview', async ({ page }) => {
    await createBlok(page, [{ type: 'code', data: { code: 'const a = 1;', language: 'javascript' } }], 600);

    const gap = await page.getByTestId('code-content').evaluate((code) => {
      const wrapper = code.closest('[data-blok-tool="code"]');

      return (wrapper?.getBoundingClientRect().bottom ?? 0) - code.getBoundingClientRect().bottom;
    });

    // Only the 1px border sits below the code area.
    expect(gap).toBeLessThanOrEqual(2);
  });

  test('saves a filename typed into the header and returns the caret to the code', async ({ page }) => {
    await createBlok(page, [{ type: 'code', data: { code: 'x', language: 'javascript' } }], 600);

    await page.getByTestId('code-content').hover();
    await page.getByRole('button', { name: 'File name' }).click();
    await page.keyboard.type('src/app.js');
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('code-content')).toBeFocused();
    await expect(page.getByTestId('code-filename')).toHaveText('src/app.js');

    const saved = await page.evaluate(async () => window.blokInstance?.save());

    expect(saved?.blocks[0].data).toMatchObject({ filename: 'src/app.js', code: 'x' });
  });
});
