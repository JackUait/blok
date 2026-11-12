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

    await expect(page.getByTestId('inline-annotation-subtitle-toggle')).toHaveCount(0);
    await expect(page.getByTestId('inline-annotation-subtitle')).toHaveValue('From the team interview');

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
    // Tab selects the default, so typing replaces it.
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('inline-annotation-subtitle')).toBeFocused();
    await page.keyboard.type('Anna, manager');
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('inline-annotation-text')).toBeHidden();
    await expect(page.locator(HINT_SELECTOR)).toHaveAttribute('data-blok-annotation-subtitle', 'Anna, manager');
  });

  test('the text field is as tall as its text', async ({ page }) => {
    await createBlok(page, [ PLAIN ]);
    await selectText(page, page.locator(PARAGRAPH_SELECTOR).first(), 'kitchen layout');
    await page.locator(HINT_BUTTON_SELECTOR).click();

    const text = page.getByTestId('inline-annotation-text');
    // The card scales while it opens, so read the layout height, not the painted box.
    const height = (): Promise<number> => text.evaluate(el => el.clientHeight);
    const lineHeight = await text.evaluate(el => parseFloat(getComputedStyle(el).lineHeight));

    await expect(text).toBeFocused();
    expect(await height()).toBeCloseTo(lineHeight, 0);

    await page.keyboard.type('One');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Two');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Three');
    expect(await height()).toBeCloseTo(lineHeight * 3, 0);

    await text.fill('One');
    expect(await height()).toBeCloseTo(lineHeight, 0);
  });

  test('the card starts narrow and widens with its text, up to 340px', async ({ page }) => {
    await createBlok(page, [ PLAIN ], { withTool: true });
    await selectText(page, page.locator(PARAGRAPH_SELECTOR).first(), 'kitchen layout');
    await page.locator(HINT_BUTTON_SELECTOR).click();

    const text = page.getByTestId('inline-annotation-text');
    const card = page.getByTestId('inline-annotation');
    // The card scales while it opens, so read the layout width, not the painted box.
    const width = (): Promise<number> => card.evaluate(el => el.clientWidth);

    await expect(text).toBeFocused();
    expect(await width()).toBe(240);

    await text.fill('The step that limits the whole chain, from the first order to the last delivery.');
    expect(await width()).toBe(340);
    // The popover box hugs the card: nothing but its own padding and border around it.
    expect(await card.evaluate((el) => {
      const box = el.closest<HTMLElement>('[data-blok-popover-container]');

      if (box === null) {
        throw new Error('the popover box is missing');
      }

      const style = getComputedStyle(box);
      const chrome = [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth]
        .reduce((sum, value) => sum + parseFloat(value), 0);

      return box.offsetWidth - chrome;
    })).toBe(340);

    await text.fill('Short');
    expect(await width()).toBe(240);
  });

  test('a hint shows a hand cursor while the editor is editable', async ({ page }) => {
    await createBlok(page, [ WITH_HINT ]);

    await expect(page.locator(HINT_SELECTOR)).toHaveCSS('cursor', 'pointer');
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

  test('the card hangs under the phrase on a stem, and the phrase stays lit while it is open', async ({ page }) => {
    await createBlok(page, [ WITH_HINT ], { readOnly: true });

    const hint = page.locator(HINT_SELECTOR);
    const card = page.getByTestId('annotation-card');
    const stem = page.getByTestId('annotation-card-stem');

    await hint.click();
    await expect(card).toHaveAttribute('data-state', 'open');
    await expect(card).toHaveAttribute('data-side', 'bottom');
    await expect(page.getByTestId('annotation-card-text')).toBeVisible();

    // The spring overshoots, so read the boxes once it has settled.
    await expect.poll(async () => (await stem.boundingBox())?.height).toBe(11);

    const phrase = await hint.boundingBox();
    const stemBox = await stem.boundingBox();
    const cardBox = await card.boundingBox();

    if (phrase === null || stemBox === null || cardBox === null) {
      throw new Error('a box is missing');
    }

    expect(Math.abs(stemBox.y - (phrase.y + phrase.height))).toBeLessThanOrEqual(1);
    expect(Math.abs(stemBox.y + stemBox.height - cardBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(stemBox.x + stemBox.width / 2 - (phrase.x + phrase.width / 2))).toBeLessThanOrEqual(1);

    expect(await page.evaluate(() => CSS.highlights.has('blok-annotation-open'))).toBe(true);

    // Body-mounted, so without its own rule it would take the host page's font.
    expect(await card.evaluate(el => getComputedStyle(el).fontFamily))
      .toBe(await hint.evaluate(el => getComputedStyle(el).fontFamily));

    // The lit underline is solid and sits where the dotted one does. A deeper one is clipped away.
    const underline = await hint.evaluate((el) => {
      const lit = getComputedStyle(el, '::highlight(blok-annotation-open)');

      return { style: lit.textDecorationStyle, offset: lit.textUnderlineOffset, rest: getComputedStyle(el).textUnderlineOffset };
    });

    expect(underline).toEqual({ style: 'solid', offset: '2px', rest: '2px' });

    await page.keyboard.press('Escape');
    await expect(card).not.toHaveAttribute('data-state', 'open');
    expect(await page.evaluate(() => CSS.highlights.has('blok-annotation-open'))).toBe(false);
  });

  test('the editor hangs from the phrase on a stem, centred on it, and the phrase is lit', async ({ page }) => {
    await createBlok(page, [ WITH_HINT ]);

    const hint = page.locator(HINT_SELECTOR);

    await hint.click();
    await expect(page.getByTestId('inline-annotation-text')).toBeFocused();

    const tether = page.locator('[data-blok-inline-tether]');

    await expect(tether).toHaveAttribute('data-blok-inline-tether', 'below');

    const read = (): Promise<Record<string, number>> => page.evaluate((selector) => {
      const phrase = document.querySelector(selector)?.getBoundingClientRect();
      const root = document.querySelector<HTMLElement>('[data-blok-inline-tether]');
      const card = root?.querySelector<HTMLElement>('[data-blok-popover-container]')?.getBoundingClientRect();

      if (phrase === undefined || root === null || card === undefined) {
        throw new Error('a part is missing');
      }

      const rootBox = root.getBoundingClientRect();
      const stem = getComputedStyle(root, '::before');

      return {
        cardOffCentre: Math.abs(card.left + card.width / 2 - (phrase.left + phrase.width / 2)),
        cardGap: card.top - phrase.bottom,
        stemOffCentre: Math.abs(rootBox.left + parseFloat(stem.left) - (phrase.left + phrase.width / 2)),
        stemOffPhrase: Math.abs(rootBox.top + parseFloat(stem.top) - phrase.bottom),
        stemHeight: parseFloat(stem.height),
      };
    }, HINT_SELECTOR);

    // The card springs in with a scale, so wait for it to settle.
    await expect.poll(async () => Math.abs((await read()).cardGap - 11)).toBeLessThanOrEqual(1);

    const settled = await read();

    expect(settled.cardOffCentre).toBeLessThanOrEqual(1);
    expect(settled.stemOffCentre).toBeLessThanOrEqual(1);
    expect(settled.stemOffPhrase).toBeLessThanOrEqual(1);
    expect(Math.abs(settled.stemHeight - 11)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => CSS.highlights.has('blok-annotation-open'))).toBe(true);

    // Typing widens the card; it stays centred on the phrase.
    await page.getByTestId('inline-annotation-text').fill('The step that limits the whole chain, from the first order to the last.');
    await expect.poll(async () => (await read()).cardOffCentre).toBeLessThanOrEqual(1);

    await page.keyboard.press('Escape');
    await expect(tether).toHaveCount(0);
    expect(await page.evaluate(() => CSS.highlights.has('blok-annotation-open'))).toBe(false);
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
