import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import type { AgentModelRequest } from '@/types/api';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const LINES = 30;

declare global {
  interface Window {
    blokInstance?: Blok;
    /** Lets the scripted model give its final answer. */
    releaseAnswer?: () => void;
  }
}

const PAGE = [
  { id: 'above', type: 'paragraph', data: { text: 'Above' } },
  { id: 'empty', type: 'paragraph', data: { text: '' } },
  ...Array.from({ length: 40 }, (_, index) => ({ id: `below${index}`, type: 'paragraph', data: { text: `Below ${index}` } })),
];

/** A model that writes `lines` paragraphs after the caret's block, then waits for releaseAnswer. */
const setup = async (page: Page, blocks: Array<Record<string, unknown>> = PAGE, lines = LINES): Promise<void> => {
  await page.evaluate(async ({ holder, lines, blocks }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    document.body.append(container);

    const gate = new Promise<void>((resolve) => {
      window.releaseAnswer = resolve;
    });
    const write = (caret: string): unknown => ({
      stop_reason: 'tool_use',
      content: [{
        type: 'tool_use',
        id: 'c1',
        name: 'blok_execute',
        input: {
          commands: Array.from({ length: lines }, (_, index) => ({
            name: 'block.insert',
            args: { type: 'paragraph', data: { text: `Line ${lines - index}` }, position: { after: caret } },
          })),
        },
      }],
    });
    const turns = ['write', 'answer'];

    const blok = new window.Blok({
      holder,
      data: { blocks },
      agent: {
        assistant: {
          model: async (request: AgentModelRequest) => {
            if (turns.shift() === 'write') {
              const first = request.messages[0]?.content;
              const caret = /caret is in block ([\w-]+)/.exec(typeof first === 'string' ? first : '')?.[1] ?? '';

              return write(caret) as never;
            }
            await gate;

            return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] };
          },
        },
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, lines, blocks });
};

const bar = (page: Page) => page.getByRole('dialog', { name: 'Ask AI' });
const line = (page: Page, n: number) => page.locator(`#${HOLDER_ID} [data-blok-element]`).filter({ hasText: new RegExp(`^Line ${n}$`) });
const top = async (page: Page): Promise<number> => (await bar(page).boundingBox())?.y ?? NaN;

// SPACE_AFTER in assistant-bar.ts: room between the bar and the block under it.
const SPACE_AFTER = 10;

/** The bar's top once it holds still for 10 frames: its gap and rows animate. */
const settled = (page: Page): Promise<number> => bar(page).evaluate((element) => new Promise<number>((resolve) => {
  const tick = (last: number, still: number): void => {
    const now = element.getBoundingClientRect().top;

    if (now === last && still >= 10) {
      resolve(now);

      return;
    }
    requestAnimationFrame(() => tick(now, now === last ? still + 1 : 0));
  };

  tick(NaN, 0);
}));

/** Px between the bar's bottom and the first written line's top. */
const gapUnderBar = async (page: Page): Promise<number> => {
  const box = await bar(page).boundingBox();
  const first = await line(page, 1).boundingBox();

  return Math.round((first?.y ?? NaN) - ((box?.y ?? NaN) + (box?.height ?? NaN)));
};

const runToLastWrite = async (page: Page): Promise<void> => {
  await setup(page);
  await page.locator(`#${HOLDER_ID} [data-blok-id="empty"] [contenteditable="true"]`).click();
  await page.keyboard.press('Space');
  await bar(page).getByRole('textbox').fill('Write lines');
  await page.keyboard.press('Enter');
  await expect(line(page, LINES)).toBeVisible();
};

test.describe('Ask AI bar over the part it wrote', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 700 });
    await gotoTestPage(page);
  });

  test('sits over the first written line, and does not move when the run ends', async ({ page }) => {
    await runToLastWrite(page);

    const before = await settled(page);

    await expect.poll(() => gapUnderBar(page)).toBe(SPACE_AFTER);

    await page.evaluate(() => window.releaseAnswer?.());
    await expect(bar(page).getByText('Done.')).toBeVisible();
    await expect(page.locator(`#${HOLDER_ID} [data-blok-id="empty"]`)).toHaveCount(0);

    expect(await settled(page)).toBeCloseTo(before, 0);
    // The bar grew to show the reply; the written part still starts right under it.
    await expect.poll(() => gapUnderBar(page)).toBe(SPACE_AFTER);
  });

  test('in an empty paragraph in a column, it gives up its line as the content lands, so nothing moves at the end', async ({ page }) => {
    await setup(page, [
      { id: 'above', type: 'paragraph', data: { text: 'Above' } },
      { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
      { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['a', 'empty'] },
      { id: 'a', type: 'paragraph', data: { text: 'Col A' }, parent: 'c1' },
      { id: 'empty', type: 'paragraph', data: { text: '' }, parent: 'c1' },
      { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['b'] },
      { id: 'b', type: 'paragraph', data: { text: 'Col B' }, parent: 'c2' },
      { id: 'after', type: 'paragraph', data: { text: 'After' } },
    ], 2);
    await page.locator(`#${HOLDER_ID} [data-blok-id="empty"] [contenteditable="true"]`).click();
    await page.keyboard.press('Space');
    await bar(page).getByRole('textbox').fill('Write lines');
    await page.keyboard.press('Enter');
    await expect(line(page, 2)).toBeVisible();

    const before = await settled(page);
    const lineBefore = (await line(page, 1).boundingBox())?.y ?? NaN;

    await page.evaluate(() => window.releaseAnswer?.());
    await expect(bar(page).getByText('Done.')).toBeVisible();

    expect(await settled(page)).toBeCloseTo(before, 0);
    expect((await line(page, 1).boundingBox())?.y ?? NaN).toBeCloseTo(lineBefore, 0);
  });

  test('sticks to the window\'s top through the part, and leaves with its last line', async ({ page }) => {
    await runToLastWrite(page);
    await page.evaluate(() => window.releaseAnswer?.());
    await expect(bar(page).getByText('Done.')).toBeVisible();

    // The first line well above the window, the last one below it.
    await line(page, 15).evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await expect.poll(() => top(page)).toBe(16);

    // Past the end: the bar rides just under the last line, off the window's top.
    await line(page, LINES).evaluate((element) => window.scrollBy(0, element.getBoundingClientRect().bottom + 200));

    const last = await line(page, LINES).boundingBox();

    expect((last?.y ?? 0) + (last?.height ?? 0)).toBeCloseTo(-200, 0);
    await expect.poll(async () => Math.round((await top(page)) - ((last?.y ?? 0) + (last?.height ?? 0)))).toBe(6);
  });
});
