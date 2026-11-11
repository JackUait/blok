import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`;
const HINT_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid=inline-toolbar] [data-blok-item-name="annotation"]`;
const HINT_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-annotation]`;

const PLAIN = 'The manager blamed the new kitchen layout for the queue.';
const WITH_HINT = 'We found <span data-blok-annotation="The step that limits the whole chain." data-blok-annotation-subtitle="Glossary">the bottleneck</span> near the oven.';

interface CreateOptions {
  readOnly?: boolean;
  withTool?: boolean;
}

const createBlok = async (page: Page, texts: string[], options: CreateOptions = {}): Promise<void> => {
  await page.evaluate(async ({ holder, texts: paragraphs, readOnly, withTool }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    container.style.margin = '160px 40px';
    document.body.appendChild(container);

    const blok = new window.Blok({
      holder,
      readOnly,
      tools: withTool && window.BlokAnnotation !== undefined
        ? { annotation: { class: window.BlokAnnotation, config: { defaultSubtitle: 'From the team interview' } } }
        : {},
      data: { blocks: paragraphs.map((text, index) => ({ id: `p${index}`, type: 'paragraph', data: { text } })) },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, texts, readOnly: options.readOnly ?? false, withTool: options.withTool ?? true });
};

/**
 * Drag-select the first occurrence of `text` inside a paragraph, as a writer would.
 */
const selectText = async (page: Page, paragraph: Locator, text: string): Promise<void> => {
  const box = await paragraph.evaluate((element, needle) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const start = node.data.indexOf(needle);

      if (start !== -1) {
        const range = document.createRange();

        range.setStart(node, start);
        range.setEnd(node, start + needle.length);

        const rect = range.getBoundingClientRect();

        return { left: rect.left + 1, right: rect.right - 1, y: rect.top + rect.height / 2 };
      }
    }

    throw new Error(`"${needle}" is not inside one text node`);
  }, text);

  await page.mouse.move(box.left, box.y);
  await page.mouse.down();
  await page.mouse.move((box.left + box.right) / 2, box.y, { steps: 4 });
  await page.mouse.move(box.right, box.y, { steps: 4 });
  await page.mouse.up();
};

const savedText = async (page: Page, index: number): Promise<unknown> =>
  page.evaluate(async (blockIndex) => {
    const data = await window.blokInstance?.save() as OutputData;

    return data.blocks[blockIndex].data.text;
  }, index);

test.describe('annotation (Hint) inline tool', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('a writer attaches a hint with the default subtitle and it is saved as a mark', async ({ page }) => {
    await createBlok(page, [ PLAIN ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    await selectText(page, paragraph, 'kitchen layout');
    await page.locator(HINT_BUTTON_SELECTOR).click();

    const text = page.getByTestId('inline-annotation-text');

    await expect(text).toBeFocused();
    await page.keyboard.type('We moved the oven.');
    // A plain Enter is a line break in the hint, not a save.
    await page.keyboard.press('Enter');
    await page.keyboard.type('Six extra steps per order.');
    await expect(text).toHaveValue('We moved the oven.\nSix extra steps per order.');

    await page.getByTestId('inline-annotation-subtitle-toggle').click();

    const subtitle = page.getByTestId('inline-annotation-subtitle');

    await expect(subtitle).toBeFocused();
    await expect(subtitle).toHaveValue('From the team interview');
    await expect(page.getByTestId('inline-annotation-subtitle-toggle')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('inline-annotation-done').click();

    await expect(text).toBeHidden();
    await expect(page.locator(HINT_SELECTOR)).toHaveText('kitchen layout');
    expect(await savedText(page, 0)).toEqual([
      { text: 'The manager blamed the new ' },
      {
        text: 'kitchen layout',
        marks: { annotation: { text: 'We moved the oven.\nSix extra steps per order.', subtitle: 'From the team interview' } },
      },
      { text: ' for the queue.' },
    ]);
  });

  test('typing over the selected default subtitle replaces it, and Enter there saves', async ({ page }) => {
    await createBlok(page, [ PLAIN ]);
    await selectText(page, page.locator(PARAGRAPH_SELECTOR).first(), 'kitchen layout');
    await page.locator(HINT_BUTTON_SELECTOR).click();
    await page.keyboard.type('A quote');
    await page.getByTestId('inline-annotation-subtitle-toggle').click();
    await page.keyboard.type('Anna, manager');
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('inline-annotation-text')).toBeHidden();
    await expect(page.locator(HINT_SELECTOR)).toHaveAttribute('data-blok-annotation-subtitle', 'Anna, manager');
  });

  test('a reader sees the card only after hovering for the hint delay', async ({ page }) => {
    await createBlok(page, [ WITH_HINT ]);

    const card = page.getByTestId('annotation-card');
    const box = await page.locator(HINT_SELECTOR).boundingBox();

    if (box === null) {
      throw new Error('the hint has no box');
    }

    await page.mouse.move(box.x + 6, box.y + box.height / 2);
    await page.mouse.move(box.x + 14, box.y + box.height / 2);
    // eslint-disable-next-line playwright/no-wait-for-timeout -- asserts the card is NOT open before the delay ends
    await page.waitForTimeout(250);
    // A one-shot read: a retrying assertion would wait for the card and then see it open.
    expect(await page.locator('[data-blok-testid="annotation-card"][data-state="open"]').count()).toBe(0);

    await expect(card).toHaveAttribute('data-state', 'open');
    await expect(page.getByTestId('annotation-card-text')).toHaveText('The step that limits the whole chain.');
    await expect(page.getByTestId('annotation-card-subtitle')).toHaveText('Glossary');
  });

  test('in read-only mode a click pins the card and the keyboard toggles it', async ({ page }) => {
    await createBlok(page, [ WITH_HINT ], { readOnly: true });

    const hint = page.locator(HINT_SELECTOR);
    const card = page.getByTestId('annotation-card');

    await hint.click();
    await expect(card).toHaveAttribute('data-state', 'open');

    await page.mouse.move(600, 500);
    await expect(card).toHaveAttribute('data-state', 'open');

    await page.keyboard.press('Escape');
    await expect(card).not.toHaveAttribute('data-state', 'open');

    await hint.focus();
    await page.keyboard.press('Enter');
    await expect(card).toHaveAttribute('data-state', 'open');

    await page.mouse.click(600, 500);
    await expect(card).not.toHaveAttribute('data-state', 'open');
  });

  test('clicking a hint edits it, Escape saves, and one undo brings the old text back', async ({ page }) => {
    await createBlok(page, [ WITH_HINT ]);

    const hint = page.locator(HINT_SELECTOR);
    const text = page.getByTestId('inline-annotation-text');

    await hint.click();
    await expect(text).toHaveValue('The step that limits the whole chain.');
    await expect(page.getByTestId('inline-annotation-subtitle')).toHaveValue('Glossary');
    await expect(page.getByTestId('inline-annotation-remove')).toBeVisible();

    await text.fill('Changed');
    await page.keyboard.press('Escape');

    await expect(text).toBeHidden();
    await expect(hint).toHaveAttribute('data-blok-annotation', 'Changed');

    await page.keyboard.press('ControlOrMeta+z');
    await expect(hint).toHaveAttribute('data-blok-annotation', 'The step that limits the whole chain.');
  });

  test('the remove button takes the hint off the phrase', async ({ page }) => {
    await createBlok(page, [ WITH_HINT ]);
    await page.locator(HINT_SELECTOR).click();
    await page.getByTestId('inline-annotation-remove').click();

    await expect(page.locator(HINT_SELECTOR)).toHaveCount(0);
    expect(await savedText(page, 0)).toEqual([ { text: 'We found the bottleneck near the oven.' } ]);
  });

  test('a hint copied inside one paragraph survives a paste into another', async ({ page, context }) => {
    await context.grantPermissions([ 'clipboard-read', 'clipboard-write' ]);
    await createBlok(page, [ PLAIN, WITH_HINT ]);

    const paragraphs = page.locator(PARAGRAPH_SELECTOR);

    await paragraphs.nth(1).evaluate((element) => {
      const range = document.createRange();

      range.selectNodeContents(element);
      element.focus();
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    });
    await page.keyboard.press('ControlOrMeta+c');

    await paragraphs.nth(0).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('End');
    await page.keyboard.press('ControlOrMeta+v');

    await expect(paragraphs.nth(0).locator('[data-blok-annotation]')).toHaveText('the bottleneck');
    expect(JSON.stringify(await savedText(page, 0)))
      .toContain('"annotation":{"text":"The step that limits the whole chain.","subtitle":"Glossary"}');
  });

  test('without the tool a hint still reads, and a click pins its card instead of editing', async ({ page }) => {
    await createBlok(page, [ WITH_HINT ], { withTool: false });
    await page.locator(HINT_SELECTOR).click();

    await expect(page.getByTestId('annotation-card')).toHaveAttribute('data-state', 'open');
    await expect(page.getByTestId('inline-annotation-text')).toHaveCount(0);
  });
});

declare global {
  interface Window {
    BlokAnnotation?: new (...args: unknown[]) => unknown;
  }
}
