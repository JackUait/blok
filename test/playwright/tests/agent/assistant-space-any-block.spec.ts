import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import type { AgentModelRequest } from '@/types/api';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
    /** First user message of each model request. */
    assistantPrompts?: unknown[];
  }
}

const setup = async (page: Page, blocks: Array<Record<string, unknown>>): Promise<void> => {
  await page.evaluate(async ({ holder, data }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    document.body.append(container);
    window.assistantPrompts = [];

    const blok = new window.Blok({
      holder,
      data: { blocks: data },
      agent: {
        assistant: {
          model: async (request: AgentModelRequest) => {
            window.assistantPrompts?.push(request.messages[0]?.content);

            return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] };
          },
        },
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, data: blocks });
};

const bar = (page: Page) => page.getByRole('dialog', { name: 'Ask AI' });

/** Send a prompt from the open bar; the scripted model gets the caret block in its context. */
const expectAskedIn = async (page: Page, blockId: string): Promise<void> => {
  await bar(page).getByRole('textbox').fill('Help here');
  await page.keyboard.press('Enter');
  await expect(bar(page).getByText('Done.')).toBeVisible();
  expect(String((await page.evaluate(() => window.assistantPrompts))?.[0])).toContain(`caret is in block ${blockId}`);
};

test.describe('space opens Ask AI in any empty block', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  const cases: Array<[string, Record<string, unknown>]> = [
    ['an empty heading', { id: 'b', type: 'header', data: { text: '', level: 2 } }],
    ['an empty list item', { id: 'b', type: 'list', data: { text: '', style: 'unordered' } }],
    ['an empty to-do item', { id: 'b', type: 'list', data: { text: '', style: 'checklist', checked: false } }],
    ['an empty quote', { id: 'b', type: 'quote', data: { text: '' } }],
    ['an empty toggle', { id: 'b', type: 'toggle', data: { text: '' } }],
    ['an empty code block', { id: 'b', type: 'code', data: { code: '', language: 'plain text' } }],
  ];

  for (const [name, block] of cases) {
    test(`in ${name}`, async ({ page }) => {
      await setup(page, [{ id: 'p1', type: 'paragraph', data: { text: 'Above' } }, block]);
      await page.locator(`#${HOLDER_ID} [data-blok-id="b"] [contenteditable="true"], #${HOLDER_ID} [data-blok-id="b"] [contenteditable="plaintext-only"]`).first().click();
      await page.keyboard.press('Space');

      await expect(bar(page)).toBeVisible();
      await expectAskedIn(page, 'b');
    });
  }

  test('in an empty table cell', async ({ page }) => {
    await setup(page, [{ id: 't', type: 'table', data: { withHeadings: false, content: [['Full', '']] } }]);

    const cell = page.locator(`#${HOLDER_ID} [data-blok-id="t"] [data-blok-tool="paragraph"]`).nth(1);
    const cellBlockId = await cell.evaluate((element) => element.closest('[data-blok-id]')?.getAttribute('data-blok-id') ?? '');

    await cell.click();
    await page.keyboard.press('Space');

    await expect(bar(page)).toBeVisible();
    await expectAskedIn(page, cellBlockId);
  });

  test('on an empty line of a code block with code', async ({ page }) => {
    await setup(page, [{ id: 'b', type: 'code', data: { code: 'first', language: 'plain text' } }]);

    const code = page.getByTestId('code-content');

    await code.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');

    await expect(bar(page)).toBeVisible();
    await expect(code).toHaveText('first\n');
  });

  test('a space on a code line with text is typed', async ({ page }) => {
    await setup(page, [{ id: 'b', type: 'code', data: { code: 'first', language: 'plain text' } }]);

    const code = page.getByTestId('code-content');

    await code.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Space');

    await expect(code).toHaveText('first ');
    await expect(bar(page)).toBeHidden();
  });

  test('a space in a heading with text is typed', async ({ page }) => {
    await setup(page, [{ id: 'b', type: 'header', data: { text: 'Title', level: 2 } }]);

    const heading = page.getByRole('heading', { name: 'Title' });

    await heading.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Space');
    await page.keyboard.type('x');

    await expect(heading).toHaveText('Title x');
    await expect(bar(page)).toBeHidden();
  });
});
