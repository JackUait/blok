import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

/**
 * Pasted HTML must keep its lines apart: <br> in an inline paste, <div>
 * lines, loose text in an <aside>, <br> in a <pre>, and inline marks in
 * table cells.
 */

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';

const createBlok = async (page: Page, blocks: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async ({ holder, initialBlocks }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: { blocks: initialBlocks } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialBlocks: blocks });
};

const focusEnd = async (page: Page, id: string): Promise<void> => {
  await page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first().click();
  await page.keyboard.press('ControlOrMeta+End');
};

const paste = async (page: Page, data: { html?: string; text: string }): Promise<void> => {
  await page.evaluate(({ html, text }) => {
    const transfer = new DataTransfer();

    if (html !== undefined) {
      transfer.setData('text/html', html);
    }
    transfer.setData('text/plain', text);
    (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    }));
  }, data);
};

const save = async (page: Page): Promise<OutputData['blocks']> =>
  await page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);

/** `type:text` of every saved block, skipping empty paragraphs. */
const savedTexts = async (page: Page): Promise<string[]> =>
  (await save(page))
    .filter((block) => !(block.type === 'paragraph' && block.data.text === ''))
    .map((block) => `${block.type}:${String(block.type === 'code' ? block.data.code : block.data.text)}`);

test.describe('paste keeps line structure', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  for (const [type, extra] of [['paragraph', {}], ['header', { level: 2 }], ['quote', {}]] as const) {
    test(`an inline paste into a ${type} keeps its <br>`, async ({ page }) => {
      await createBlok(page, [{ id: 't', type, data: { text: 'X', ...extra } }]);
      await focusEnd(page, 't');
      await paste(page, { html: 'Line one<br>Line <strong>bold</strong> two', text: 'Line one\nLine bold two' });

      await expect.poll(async () => (await save(page)).find((block) => block.id === 't')?.data.text)
        .toBe('XLine one<br>Line <strong>bold</strong> two');
    });
  }

  test('a Google Docs inline paste keeps its <br>', async ({ page }) => {
    await createBlok(page, [{ id: 't', type: 'paragraph', data: { text: 'X' } }]);
    await focusEnd(page, 't');
    await paste(page, {
      html: '<b style="font-weight:normal" id="docs-internal-guid-x"><span style="font-weight:700">bold</span><br><span>next</span></b>',
      text: 'bold\nnext',
    });

    await expect.poll(async () => (await save(page)).find((block) => block.id === 't')?.data.text)
      .toBe('X<strong>bold</strong><br>next');
  });

  test('<div> lines paste as separate paragraphs', async ({ page }) => {
    await createBlok(page, [{ id: 't', type: 'paragraph', data: { text: '' } }]);
    await focusEnd(page, 't');
    await paste(page, { html: '<div>a <b>x</b></div><div><div>b</div></div>', text: 'a x\nb' });

    await expect.poll(() => savedTexts(page)).toEqual(['paragraph:a <strong>x</strong>', 'paragraph:b']);
  });

  test('<div> lines inside a <blockquote> stay one quote with <br>', async ({ page }) => {
    await createBlok(page, [{ id: 't', type: 'paragraph', data: { text: '' } }]);
    await focusEnd(page, 't');
    await paste(page, { html: '<blockquote><div>a</div><div>b</div></blockquote>', text: 'a\nb' });

    await expect.poll(() => savedTexts(page)).toEqual(['quote:a<br>b']);
  });

  test('an <aside> keeps its loose text as paragraphs with marks', async ({ page }) => {
    await createBlok(page, [{ id: 't', type: 'paragraph', data: { text: '' } }]);
    await focusEnd(page, 't');
    await paste(page, { html: '<aside>loose <b>B</b><br>text <em>I</em></aside>', text: 'loose B\ntext I' });

    await expect.poll(async () => {
      const blocks = await save(page);
      const callout = blocks.find((block) => block.type === 'callout');

      return blocks.filter((block) => callout !== undefined && block.parent === callout.id)
        .map((block) => `${block.type}:${String(block.data.text)}`);
    }).toEqual(['paragraph:loose <strong>B</strong>', 'paragraph:text <em>I</em>']);
  });

  for (const html of ['<pre>line1<br>line2</pre>', '<pre><div>line1</div><div>line2</div></pre>']) {
    test(`a code block keeps the lines of ${html}`, async ({ page }) => {
      await createBlok(page, [{ id: 't', type: 'paragraph', data: { text: '' } }]);
      await focusEnd(page, 't');
      await paste(page, { html, text: 'line1\nline2' });

      await expect.poll(() => savedTexts(page)).toEqual(['code:line1\nline2']);
    });
  }

  test('a table cell copy keeps every inline mark', async ({ page }) => {
    const text = '<u>u</u> <s>s</s> <code>c</code> <strong>b</strong>';
    const payload = JSON.stringify({ rows: 1, cols: 1, cells: [[{ blocks: [{ tool: 'paragraph', data: { text } }] }]] })
      .replace(/&/g, '&amp;').replace(/'/g, '&#39;');

    await createBlok(page, [{ id: 't', type: 'paragraph', data: { text: '' } }]);
    await focusEnd(page, 't');
    await paste(page, { html: `<table data-blok-table-cells='${payload}'><tr><td>${text}</td></tr></table>`, text: 'u s c b' });

    await expect.poll(async () => {
      const blocks = await save(page);
      const table = blocks.find((block) => block.type === 'table');

      return blocks.filter((block) => table !== undefined && block.parent === table.id).map((block) => block.data.text);
    }).toEqual([text]);
  });

  test('measure: markdown soft break in a pasted paragraph', async ({ page }) => {
    await createBlok(page, [
      { id: 'one', type: 'paragraph', data: { text: 'Line one' } },
      { id: 't', type: 'paragraph', data: { text: '' } },
    ]);
    await focusEnd(page, 't');
    await paste(page, { text: 'Line one\nLine **bold** two' });
    await expect.poll(async () => JSON.stringify(await save(page))).toContain('two');

    const measured = await page.evaluate(async () => {
      const blocks = (await window.blokInstance?.save())?.blocks ?? [];
      const editables = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-element] [contenteditable="true"]'));

      return {
        saved: blocks.map((block) => block.data.text),
        rendered: editables.map((el) => ({ innerText: el.innerText, height: el.getBoundingClientRect().height })),
      };
    });

    console.log('MARKDOWN-SOFT-BREAK', JSON.stringify(measured));
  });
});
