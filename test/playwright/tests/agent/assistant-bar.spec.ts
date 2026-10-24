import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import type { AgentModelRequest } from '@/types/api';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

interface ScriptedResponse {
  content: Array<Record<string, unknown>>;
  stop_reason: string;
}

declare global {
  interface Window {
    blokInstance?: Blok;
    /** What the scripted model answers, in order. */
    assistantScript?: ScriptedResponse[];
    /** First user message of each model request. */
    assistantPrompts?: unknown[];
    /** Set by setup({ hold: true }): lets the held model call answer. */
    assistantRelease?: () => void;
    /** The thinking level of each model request. */
    assistantLevels?: unknown[];
  }
}

const insertCall = (text: string): ScriptedResponse => ({
  stop_reason: 'tool_use',
  content: [{
    type: 'tool_use',
    id: `use-${text}`,
    name: 'blok_execute',
    input: { commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text }, position: 'end' } }] },
  }],
});

const reply = (text: string): ScriptedResponse => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });

interface SetupOptions {
  hold?: boolean;
  /** The document; two paragraphs, p1 and p2, by default. */
  blocks?: Array<Record<string, unknown>>;
  thinking?: { levels: string[]; default?: string };
  /** Stream events the first model call sends before it holds or answers. */
  stream?: Array<Record<string, unknown>>;
}

const setup = async (page: Page, script: ScriptedResponse[], options: SetupOptions = {}): Promise<void> => {
  await page.evaluate(async ({ holder, responses, hold, thinking, blocks, stream }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    document.body.append(container);
    window.assistantScript = responses;
    window.assistantPrompts = [];
    window.assistantLevels = [];

    const blok = new window.Blok({
      holder,
      data: { blocks: blocks ?? [
        { id: 'p1', type: 'paragraph', data: { text: 'The quick brown fox' } },
        { id: 'p2', type: 'paragraph', data: { text: 'Second' } },
      ] },
      agent: {
        assistant: {
          name: 'Claude',
          ...(thinking === undefined ? {} : { thinking }),
          model: async (request: AgentModelRequest) => {
            window.assistantPrompts?.push(request.messages[0]?.content);
            window.assistantLevels?.push(request.thinking);
            if (stream !== undefined && window.assistantPrompts?.length === 1) {
              stream.forEach((event) => request.onStream?.(event as unknown as Parameters<NonNullable<AgentModelRequest['onStream']>>[0]));
            }
            if (hold) {
              // Answers only when the test says so, or when Stop aborts it.
              await new Promise<void>((resolve) => {
                window.assistantRelease = resolve;
                request.signal.addEventListener('abort', () => resolve());
              });
            }
            const next = window.assistantScript?.shift();

            if (next === undefined) {
              throw new Error('unscripted model call');
            }

            return next;
          },
        },
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, responses: script, hold: options.hold === true, thinking: options.thinking, blocks: options.blocks, stream: options.stream });
};

const savedTexts = (page: Page): Promise<string[]> => page.evaluate(async () => {
  const saved = await window.blokInstance?.save();

  return (saved?.blocks ?? []).map((block) => {
    const text: unknown = block.data.text;

    return Array.isArray(text)
      ? text.map((segment: unknown) => (typeof segment === 'object' && segment !== null && 'text' in segment ? String(segment.text) : '')).join('')
      : String(text);
  });
});

test.describe('in-editor assistant', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('Mod+J opens the bar, the model writes into the document, and Keep keeps it', async ({ page }) => {
    await setup(page, [insertCall('Written by Claude'), reply('Added a paragraph at the end.')], { hold: true });

    await page.getByText('Second').click();
    await page.keyboard.press(`${MOD}+j`);

    const bar = page.getByRole('dialog', { name: 'Ask AI' });
    const field = bar.getByRole('textbox');

    await expect(field).toBeFocused();
    await field.fill('Add a closing sentence');
    await page.keyboard.press('Enter');

    await expect(bar.getByRole('status')).toHaveText('Thinking…');
    await expect.poll(() => page.evaluate(() => window.assistantPrompts?.length)).toBe(1);
    await page.evaluate(() => window.assistantRelease?.());
    await expect(page.locator(`#${HOLDER_ID}`).getByText('Written by Claude')).toBeVisible();
    // The second model call has started and holds a fresh release.
    await expect.poll(() => page.evaluate(() => window.assistantPrompts?.length)).toBe(2);
    await page.evaluate(() => window.assistantRelease?.());
    await expect(bar.getByText('Added a paragraph at the end.')).toBeVisible();
    await expect(page.locator(`#${HOLDER_ID}`).getByText('Written by Claude')).toBeVisible();

    await bar.getByRole('button', { name: 'Keep' }).click();

    await expect(bar).toHaveCount(0);
    expect(await savedTexts(page)).toEqual(['The quick brown fox', 'Second', 'Written by Claude']);
    // The model was told where the caret was.
    expect(String((await page.evaluate(() => window.assistantPrompts))?.[0])).toContain('caret is in block p2');
  });

  test('opens in the page under the caret block, moving the next block down, and gives the space back on close', async ({ page }) => {
    await setup(page, []);

    const first = page.locator('[data-blok-id="p1"]');
    const column = page.locator('[data-blok-id="p1"] [data-blok-element-content]');
    const second = page.locator('[data-blok-id="p2"]');
    const secondTop = (await second.boundingBox())?.y ?? 0;

    await page.getByText('The quick brown fox').click();
    await page.keyboard.press(`${MOD}+j`);

    const bar = page.getByRole('dialog', { name: 'Ask AI' });

    await expect(bar.getByRole('textbox')).toBeFocused();
    // The entrance scales the bar a little; measure where it lands.
    await bar.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));

    const box = await bar.boundingBox();
    const above = await first.boundingBox();
    const text = await column.boundingBox();
    const below = await second.boundingBox();

    if (box === null || above === null || text === null || below === null) {
      throw new Error('no layout');
    }
    // Between the two blocks, in the page, with no overlap.
    expect(box.y).toBeGreaterThanOrEqual(above.y + above.height);
    expect(below.y).toBeGreaterThanOrEqual(box.y + box.height);
    expect(below.y).toBeGreaterThan(secondTop);
    // 12px past the content column on each side.
    expect(Math.round(box.x)).toBe(Math.round(text.x - 12));
    expect(Math.round(box.width)).toBe(Math.round(text.width + 24));

    await page.keyboard.press('Escape');

    await expect(bar).toHaveCount(0);
    await expect.poll(async () => (await second.boundingBox())?.y).toBe(secondTop);
  });

  test('follows its block when a block above it grows', async ({ page }) => {
    await setup(page, []);
    await page.getByText('Second').click();
    await page.keyboard.press(`${MOD}+j`);

    const bar = page.getByRole('dialog', { name: 'Ask AI' });

    await expect(bar.getByRole('textbox')).toBeFocused();
    await bar.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));

    const before = (await bar.boundingBox())?.y ?? 0;

    // Not a gap and not a childList change: only the page's ResizeObserver sees it.
    await page.locator('[data-blok-id="p1"]').evaluate((holder) => holder.style.setProperty('padding-bottom', '80px'));

    // Within a pixel: the holder's own box rounds.
    await expect.poll(async () => Math.abs(((await bar.boundingBox())?.y ?? 0) - before - 80) <= 1).toBe(true);
  });

  test('stays inside a phone-width window and still spans the column start', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await setup(page, []);
    await page.getByText('Second').click();
    await page.keyboard.press(`${MOD}+j`);

    const bar = page.getByRole('dialog', { name: 'Ask AI' });

    await expect(bar.getByRole('textbox')).toBeFocused();
    await bar.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));

    const box = await bar.boundingBox();
    const text = await page.locator('[data-blok-id="p2"] [data-blok-element-content]').boundingBox();

    if (box === null || text === null) {
      throw new Error('no layout');
    }
    expect(box.x).toBeGreaterThanOrEqual(16);
    expect(box.x + box.width).toBeLessThanOrEqual(375 - 16);
    // This page's column runs to the window's right edge, so the window wins there.
    expect(box.x).toBeLessThanOrEqual(text.x);
  });

  test('Ask AI in the inline toolbar sends the selected text with the request', async ({ page }) => {
    await setup(page, [reply('Done.')]);

    const words = page.locator('[data-blok-id="p1"] [contenteditable]');

    await words.click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await page.getByRole('menuitem', { name: 'Ask AI' }).click();

    const bar = page.getByRole('dialog', { name: 'Ask AI' });

    await expect(bar.getByRole('textbox')).toBeFocused();
    await bar.getByRole('textbox').fill('Make this shorter');
    await page.keyboard.press('Enter');
    await expect(bar.getByText('Done.')).toBeVisible();

    expect(String((await page.evaluate(() => window.assistantPrompts))?.[0])).toContain('"The quick brown fox"');
  });

  test('a skill from the inline toolbar\'s Ask AI row runs on the selection at once', async ({ page }) => {
    await setup(page, [reply('Done.')]);

    const words = page.locator('[data-blok-id="p1"] [contenteditable]');

    await words.click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');

    const skills = page.getByRole('menuitem', { name: 'Suggestions' });

    await expect(skills).toHaveAttribute('aria-expanded', 'false');
    await skills.click();
    await expect(skills).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('menuitem', { name: 'Fix spelling and grammar' }).click();

    const bar = page.getByRole('dialog', { name: 'Ask AI' });

    await expect(bar.getByText('Done.')).toBeVisible();

    const prompt = String((await page.evaluate(() => window.assistantPrompts))?.[0]);

    expect(prompt).toContain('Fix spelling, grammar and punctuation in the selected text');
    expect(prompt).toContain('"The quick brown fox"');
  });

  test('Ask AI in the inline toolbar, on a selection across two blocks, opens under the block where it ends', async ({ page }) => {
    await setup(page, []);

    const from = await page.locator('[data-blok-id="p1"] [contenteditable]').boundingBox();
    const to = await page.getByText('Second').boundingBox();

    if (from === null || to === null) {
      throw new Error('no layout');
    }
    await page.mouse.move(from.x + 40, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 20, to.y + to.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.getByRole('menuitem', { name: 'Ask AI' }).click();

    const bar = page.getByRole('dialog', { name: 'Ask AI' });

    await expect(bar.getByRole('textbox')).toBeFocused();
    await bar.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));

    const box = await bar.boundingBox();
    const second = await page.locator('[data-blok-id="p2"]').boundingBox();

    if (box === null || second === null) {
      throw new Error('no layout');
    }
    expect(box.y).toBeGreaterThanOrEqual(second.y + second.height);
  });

  test('opens below a whole column layout, not over the next column', async ({ page }) => {
    await setup(page, [], {
      blocks: [
        { id: 'p1', type: 'paragraph', data: { text: 'Before' } },
        { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
        { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['l1', 'l2', 'l3'] },
        { id: 'l1', type: 'paragraph', data: { text: 'Left one' }, parent: 'c1' },
        { id: 'l2', type: 'paragraph', data: { text: 'Left two' }, parent: 'c1' },
        { id: 'l3', type: 'paragraph', data: { text: 'Left three' }, parent: 'c1' },
        { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['r1'] },
        { id: 'r1', type: 'paragraph', data: { text: 'Right one' }, parent: 'c2' },
        { id: 'p3', type: 'paragraph', data: { text: 'After' } },
      ],
    });
    await page.getByText('Right one').click();
    await page.keyboard.press(`${MOD}+j`);

    const bar = page.getByRole('dialog', { name: 'Ask AI' });

    await expect(bar.getByRole('textbox')).toBeFocused();
    await bar.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));

    const box = await bar.boundingBox();
    const left = await page.getByText('Left three').boundingBox();
    const after = await page.getByText('After').boundingBox();

    if (box === null || left === null || after === null) {
      throw new Error('no layout');
    }
    // Below the tallest column's last line, and the next block moves down past the bar.
    expect(box.y).toBeGreaterThanOrEqual(left.y + left.height);
    expect(after.y).toBeGreaterThanOrEqual(box.y + box.height);
  });

  test('a bar that opens below the window scrolls into view', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 200 });
    await setup(page, []);
    await page.getByText('Second').click();
    await page.keyboard.press(`${MOD}+j`);

    const bar = page.getByRole('dialog', { name: 'Ask AI' });

    await expect(bar.getByRole('textbox')).toBeFocused();
    await expect.poll(async () => {
      const box = await bar.boundingBox();

      return box !== null && box.y >= 0 && box.y + box.height <= 200;
    }).toBe(true);
  });

  test('a model that does not stream drops the slots once its edit lands, and reveals the written block', async ({ page }) => {
    await setup(page, [insertCall('Revealed line'), reply('Done.')], { hold: true });

    await page.getByText('Second').click();
    await page.keyboard.press(`${MOD}+j`);

    const bar = page.getByRole('dialog', { name: 'Ask AI' });

    await bar.getByRole('textbox').fill('Add a line');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.assistantPrompts?.length)).toBe(1);
    // No edit yet: it may only answer, so no placeholder lines.
    await expect(bar.locator('[data-blok-ai-slot]').first()).toBeHidden();

    await page.evaluate(() => window.assistantRelease?.());

    const written = page.locator(`#${HOLDER_ID} [data-blok-element]`).filter({ hasText: 'Revealed line' });

    // The words replay over the committed block. The reveal lasts under a second, so poll fast.
    await expect.poll(
      () => written.evaluate((holder) => holder.getAnimations({ subtree: true })
        .some((animation) => animation instanceof CSSAnimation && animation.animationName === 'blok-ai-reveal')),
      { intervals: [20] }
    ).toBe(true);

    await expect.poll(() => page.evaluate(() => window.assistantPrompts?.length)).toBe(2);
    // The content is in, so the slots do not stay in its place while the model works on.
    await expect(bar.locator('[data-blok-ai-slot]').first()).toBeHidden();
    await page.evaluate(() => window.assistantRelease?.());
    await expect(bar.getByText('Done.')).toBeVisible();
    await expect(bar.locator('[data-blok-ai-slot]').first()).toBeHidden();
  });

  test('slots for an edit still on its way sit below the content the last edit wrote', async ({ page }) => {
    const commands = [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'Landed first' }, position: { after: 'p1' } } }];

    await setup(page, [reply('Done.')], {
      hold: true,
      stream: [
        { type: 'tool_start', index: 0, id: 'c1', name: 'blok_execute' },
        { type: 'tool_input', index: 0, json: JSON.stringify({ commands }) },
        { type: 'tool_start', index: 1, id: 'c2', name: 'blok_execute' },
        { type: 'tool_end', index: 0 },
      ],
    });

    await page.getByText('The quick brown fox').click();
    await page.keyboard.press(`${MOD}+j`);

    const bar = page.getByRole('dialog', { name: 'Ask AI' });

    await bar.getByRole('textbox').fill('Add two things');
    await page.keyboard.press('Enter');

    const written = page.locator(`#${HOLDER_ID} [data-blok-element]`).filter({ hasText: 'Landed first' });
    const slot = bar.locator('[data-blok-ai-slot]').first();

    await expect(written).toBeVisible();
    await expect(slot).toBeVisible();

    const box = await bar.boundingBox();
    const block = await written.boundingBox();
    const slotBox = await slot.boundingBox();
    const next = await page.getByText('Second').boundingBox();

    if (box === null || block === null || slotBox === null || next === null) {
      throw new Error('no layout');
    }
    // Bar, then the written block, then the slots, then the rest of the page.
    expect(block.y).toBeGreaterThanOrEqual(box.y + box.height);
    expect(slotBox.y).toBeGreaterThanOrEqual(block.y + block.height);
    expect(next.y).toBeGreaterThanOrEqual(slotBox.y + slotBox.height);

    await page.evaluate(() => window.assistantRelease?.());
    await expect(bar.getByText('Done.')).toBeVisible();
    await expect(slot).toBeHidden();
  });

  test('with the bar open in an empty paragraph, slots for the next edit sit below what the last edit wrote', async ({ page }) => {
    const commands = [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'Landed first' }, position: { after: 'empty' } } }];

    await setup(page, [reply('Done.')], {
      hold: true,
      blocks: [
        { id: 'p1', type: 'paragraph', data: { text: 'The quick brown fox' } },
        { id: 'empty', type: 'paragraph', data: { text: '' } },
        { id: 'p2', type: 'paragraph', data: { text: 'Second' } },
      ],
      stream: [
        { type: 'tool_start', index: 0, id: 'c1', name: 'blok_execute' },
        { type: 'tool_input', index: 0, json: JSON.stringify({ commands }) },
        { type: 'tool_start', index: 1, id: 'c2', name: 'blok_execute' },
        { type: 'tool_end', index: 0 },
      ],
    });

    await page.locator(`#${HOLDER_ID} [data-blok-id="empty"] [contenteditable="true"]`).click();
    await page.keyboard.press('Space');

    const bar = page.getByRole('dialog', { name: 'Ask AI' });

    await bar.getByRole('textbox').fill('Add two things');
    await page.keyboard.press('Enter');

    const written = page.locator(`#${HOLDER_ID} [data-blok-element]`).filter({ hasText: 'Landed first' });
    const slot = bar.locator('[data-blok-ai-slot]').first();
    const gapped = (): Promise<string[]> => page.evaluate((holder) => [...document.querySelectorAll(`#${holder} [data-blok-ai-gap]`)]
      .map((element) => element.textContent || element.getAttribute('data-blok-id') || ''), HOLDER_ID);

    await expect(written).toBeVisible();
    await expect(slot).toBeVisible();
    // The bar heads what it wrote, and the slots sit under it: one holder holds both gaps.
    await expect.poll(gapped).toEqual(['Landed first']);

    const box = await bar.boundingBox();
    const block = await written.boundingBox();
    const slotBox = await slot.boundingBox();
    const next = await page.getByText('Second').boundingBox();

    if (box === null || block === null || slotBox === null || next === null) {
      throw new Error('no layout');
    }
    expect(block.y).toBeGreaterThanOrEqual(box.y + box.height);
    expect(slotBox.y).toBeGreaterThanOrEqual(block.y + block.height);
    expect(next.y).toBeGreaterThanOrEqual(slotBox.y + slotBox.height);

    await page.evaluate(() => window.assistantRelease?.());
    await expect(bar.getByText('Done.')).toBeVisible();
    await expect(slot).toBeHidden();
    // The run used up the empty paragraph, so the bar's own gap is all that is left, over what it wrote.
    await expect.poll(gapped).toEqual(['Landed first']);
    await expect(written).toHaveAttribute('data-blok-ai-gap', 'start');
  });

  test('after an answer, a follow-up field under it takes a question with a visible caret', async ({ page }) => {
    await setup(page, [
      insertCall('Draft one'),
      reply('Wrote a draft.\n\nIt sits at the end of the page.'),
      reply('It has three words.'),
    ]);

    await page.getByText('Second').click();
    await page.keyboard.press(`${MOD}+j`);

    const bar = page.getByRole('dialog', { name: 'Ask AI' });
    const field = bar.getByRole('textbox');
    const summary = bar.getByText('Wrote a draft.');

    await field.fill('Write a draft');
    await page.keyboard.press('Enter');
    await expect(summary).toBeVisible();

    await expect(field).toBeVisible();
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute('placeholder', 'Ask a question or request a change…');
    expect(await field.evaluate((element) => getComputedStyle(element).caretColor)).not.toBe('rgba(0, 0, 0, 0)');

    const summaryBox = await summary.boundingBox();
    const fieldBox = await field.boundingBox();

    expect(fieldBox?.y ?? 0).toBeGreaterThan((summaryBox?.y ?? 0) + (summaryBox?.height ?? 0));

    await field.pressSequentially('How long is it?');
    await expect(summary).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Keep' })).toBeVisible();
    await page.keyboard.press('Enter');

    await expect(bar.getByText('It has three words.')).toBeVisible();
    await expect(field).toBeVisible();
    expect(await savedTexts(page)).toEqual(['The quick brown fox', 'Second', 'Draft one']);
  });

  test('a long answer keeps the rose and the buttons level with its first line', async ({ page }) => {
    const note = 'Готово: собрал статью «История пиццы: от неаполитанской лепёшки до доставки дроном» с четырьмя фотографиями из Wikimedia, встроенным видео с YouTube, инлайн-ссылками в тексте и блоком «Что почитать и посмотреть» в конце.';

    await setup(page, [insertCall('Draft one'), reply(note)]);

    await page.getByText('Second').click();
    await page.keyboard.press(`${MOD}+j`);

    const bar = page.getByRole('dialog', { name: 'Ask AI' });

    await bar.getByRole('textbox').fill('Write an article');
    await page.keyboard.press('Enter');

    const summary = bar.locator('[data-blok-assistant-summary]');

    await expect(summary).toHaveText(note);

    const geometry = await bar.evaluate((element) => {
      const text = element.querySelector('[data-blok-assistant-summary]');
      const rose = element.querySelector('[data-blok-assistant-head] [data-blok-assistant-icon]');
      const keep = element.querySelector('[data-blok-assistant-keep]');
      const line = text === null ? 0 : parseFloat(getComputedStyle(text).lineHeight);
      const box = (node: Element | null): DOMRect | undefined => node?.getBoundingClientRect();

      return { line, text: box(text), rose: box(rose), keep: box(keep) };
    });
    const middle = (rect: DOMRect | undefined): number => (rect?.top ?? 0) + (rect?.height ?? 0) / 2;
    const firstLine = (geometry.text?.top ?? 0) + geometry.line / 2;

    expect(geometry.text?.height ?? 0).toBeGreaterThan(geometry.line * 2);
    expect(Math.abs(middle(geometry.rose) - firstLine)).toBeLessThanOrEqual(2);
    expect(Math.abs(middle(geometry.keep) - firstLine)).toBeLessThanOrEqual(2);

    // The bloom ends with the whole answer shown, sharp.
    const settled = await summary.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));

      const style = getComputedStyle(element);

      return { filter: style.filter, mask: style.maskPosition };
    });

    expect(settled.filter).toMatch(/^(none|blur\(0px\))$/);
    expect(settled.mask).toMatch(/^0(%|px) 0(%|px)$/);
  });

  test('Discard removes what the assistant wrote', async ({ page }) => {
    await setup(page, [insertCall('Draft one'), insertCall('Draft two'), reply('Wrote two drafts.')]);

    await page.getByText('Second').click();
    await page.keyboard.press(`${MOD}+j`);

    const bar = page.getByRole('dialog', { name: 'Ask AI' });

    await bar.getByRole('textbox').fill('Write two drafts');
    await page.keyboard.press('Enter');
    await expect(bar.getByText('Wrote two drafts.')).toBeVisible();
    await expect(page.locator(`#${HOLDER_ID}`).getByText('Draft two')).toBeVisible();

    await bar.getByRole('button', { name: 'Discard' }).click();

    await expect(bar).toHaveCount(0);
    await expect(page.locator(`#${HOLDER_ID}`).getByText('Draft one')).toHaveCount(0);
    expect(await savedTexts(page)).toEqual(['The quick brown fox', 'Second']);
  });

  test('Discard never undoes text the user typed after the assistant wrote', async ({ page }) => {
    await setup(page, [insertCall('From Claude'), reply('Done.')]);

    await page.getByText('Second').click();
    await page.keyboard.press(`${MOD}+j`);

    const bar = page.getByRole('dialog', { name: 'Ask AI' });

    await bar.getByRole('textbox').fill('Add a line');
    await page.keyboard.press('Enter');
    await expect(bar.getByText('Done.')).toBeVisible();

    await page.getByText('Second').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' typed by me');
    await bar.getByRole('button', { name: 'Discard' }).click();

    // Nothing was undone, so the bar says why instead of closing as if it worked.
    await expect(bar.getByRole('alert')).toContainText('Nothing was undone');
    const texts = await savedTexts(page);

    expect(texts).toContain('Second typed by me');
    expect(texts).toContain('From Claude');
  });

  test('Escape stops a running answer, then closes the bar', async ({ page }) => {
    await setup(page, [reply('late')], { hold: true });

    await page.getByText('Second').click();
    await page.keyboard.press(`${MOD}+j`);

    const bar = page.getByRole('dialog', { name: 'Ask AI' });

    await bar.getByRole('textbox').fill('Write something');
    await page.keyboard.press('Enter');
    await expect(bar.getByRole('button', { name: 'Stop' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.assistantPrompts?.length)).toBe(1);

    await page.keyboard.press('Escape');
    await expect(bar.getByRole('button', { name: 'Stop' })).toHaveCount(0);
    await expect(bar.getByRole('alert')).toHaveText('Stopped. What was already written stays.');

    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
  });

  test('Mod+Z in the prompt field undoes the typing there, not the document', async ({ page }) => {
    await setup(page, [insertCall('From Claude'), reply('Done.')]);

    await page.getByText('Second').click();
    await page.keyboard.press(`${MOD}+j`);

    const bar = page.getByRole('dialog', { name: 'Ask AI' });
    const field = bar.getByRole('textbox');

    await field.fill('Add a line');
    await page.keyboard.press('Enter');
    await expect(bar.getByText('Done.')).toBeVisible();

    await field.pressSequentially('next');
    await page.keyboard.press(`${MOD}+z`);

    expect(await savedTexts(page)).toEqual(['The quick brown fox', 'Second', 'From Claude']);
  });
});

test.describe('thinking toggle', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  const openBar = async (page: Page): Promise<void> => {
    await page.getByText('Second').click();
    await page.keyboard.press(`${MOD}+KeyJ`);
    await expect(page.getByTestId('assistant-bar')).toBeVisible();
  };

  test('is absent with one level, and shown with two', async ({ page }) => {
    await gotoTestPage(page);
    await setup(page, [], { thinking: { levels: ['high'] } });
    await openBar(page);
    await expect(page.getByTestId('assistant-thinking')).toBeHidden();

    await setup(page, [], { thinking: { levels: ['low', 'high'] } });
    await openBar(page);
    await expect(page.getByTestId('assistant-thinking')).toBeVisible();
  });

  test('the picked level reaches the next prompt, and the menu marks it without blue', async ({ page }) => {
    await gotoTestPage(page);
    await setup(page, [reply('One'), reply('Two')], { thinking: { levels: ['low', 'high'], default: 'low' } });
    await openBar(page);

    const bar = page.getByTestId('assistant-bar');
    const trigger = page.getByTestId('assistant-thinking');

    await bar.getByRole('textbox').fill('First');
    await bar.getByRole('textbox').press('Enter');
    await expect(bar.getByText('One')).toBeVisible();

    await expect(trigger).toHaveAccessibleName('Thinking: Low');
    await trigger.click();

    const high = page.getByRole('menuitemradio', { name: 'High' });

    await high.click();
    await expect(trigger).toHaveAccessibleName('Thinking: High');
    await bar.getByRole('textbox').fill('Second');
    await bar.getByRole('textbox').press('Enter');
    await expect(bar.getByText('Two')).toBeVisible();

    expect(await page.evaluate(() => window.assistantLevels)).toEqual(['low', 'high']);

    await trigger.click();
    await expect(page.getByRole('menuitemradio', { name: 'High' })).toHaveAttribute('aria-checked', 'true');
    const look = (name: string): Promise<string[]> => page.getByRole('menuitemradio', { name })
      .evaluate((element) => [getComputedStyle(element).color, getComputedStyle(element).backgroundColor]);

    expect(await look('High')).toEqual(await look('Low'));
  });

  // The picker hides while the model writes, so a level can only change between prompts.
  test('a run already answering keeps its level, and the picker hides until it ends', async ({ page }) => {
    await gotoTestPage(page);
    await setup(page, [reply('One')], { thinking: { levels: ['low', 'high'], default: 'low' }, hold: true });
    await openBar(page);

    const bar = page.getByTestId('assistant-bar');
    const trigger = page.getByTestId('assistant-thinking');

    await bar.getByRole('textbox').fill('First');
    await bar.getByRole('textbox').press('Enter');
    await expect.poll(() => page.evaluate(() => window.assistantPrompts?.length)).toBe(1);
    await expect(trigger).toBeHidden();
    await page.evaluate(() => window.assistantRelease?.());
    await expect(bar.getByText('One')).toBeVisible();
    await expect(trigger).toBeVisible();

    expect(await page.evaluate(() => window.assistantLevels)).toEqual(['low']);
  });
});
