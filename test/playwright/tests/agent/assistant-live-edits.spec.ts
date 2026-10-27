import type { Locator, Page } from '@playwright/test';
import type { Blok } from '@/types';
import type { AgentModelRequest, AgentModelResponse, AgentModelStreamEvent } from '@/types/api';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';

/** Whether a code block's preview area shows a rendered formula or diagram. */
const drawn = (area: Locator): Promise<boolean> =>
  area.evaluate((element) => element.querySelector('.katex, svg') !== null && element.getBoundingClientRect().height > 0);
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

/** One model call the test drives: stream events into it, then answer it. */
interface LiveCall {
  emit(event: AgentModelStreamEvent): void;
  finish(response: AgentModelResponse): void;
}

declare global {
  interface Window {
    blokInstance?: Blok;
    /** Every model call so far, in order. */
    liveCalls?: LiveCall[];
    /** onChange deliveries so far. */
    liveChanges?: number;
  }
}

/** @param more - blocks after p1 and p2 */
const setup = async (page: Page, more: Array<Record<string, unknown>> = []): Promise<void> => {
  await page.evaluate(async ({ holder, extra }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    document.body.append(container);
    window.liveCalls = [];
    window.liveChanges = 0;

    const blok = new window.Blok({
      holder,
      data: { blocks: [
        { id: 'p1', type: 'paragraph', data: { text: 'The quick brown fox' } },
        { id: 'p2', type: 'paragraph', data: { text: 'Second' } },
        ...extra,
      ] },
      onChange: () => {
        window.liveChanges = (window.liveChanges ?? 0) + 1;
      },
      agent: {
        assistant: {
          name: 'Claude',
          model: (request: AgentModelRequest) => new Promise<AgentModelResponse>((resolve, reject) => {
            // Stop must settle the call, or the run never reports it stopped.
            request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            window.liveCalls?.push({ emit: (event) => request.onStream?.(event), finish: resolve });
          }),
        },
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, extra: more });
};

/** `blok_execute` input for one paragraph insert; `position` comes first so it is placed while words stream. */
const insertInput = (text: string, position: unknown = 'end'): Record<string, unknown> => ({
  commands: [{ name: 'block.insert', args: { type: 'paragraph', position, data: { text } } }],
});

/** The input JSON cut right after the first `chars` characters of `text`. */
const prefix = (input: Record<string, unknown>, text: string, chars: number): string => {
  const json = JSON.stringify(input);

  return json.slice(0, json.indexOf(text) + chars);
};

const waitForCall = async (page: Page, count: number): Promise<void> => {
  await expect.poll(() => page.evaluate(() => window.liveCalls?.length)).toBe(count);
};

const emit = (page: Page, call: number, event: AgentModelStreamEvent): Promise<void> =>
  page.evaluate(({ at, streamed }) => window.liveCalls?.[at]?.emit(streamed), { at: call, streamed: event });

const finish = (page: Page, call: number, response: AgentModelResponse): Promise<void> =>
  page.evaluate(({ at, answer }) => window.liveCalls?.[at]?.finish(answer), { at: call, answer: response });

const toolUse = (id: string, input: Record<string, unknown>): AgentModelResponse => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id, name: 'blok_execute', input }],
});

const endTurn = (text: string): AgentModelResponse => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });

/** Streams a whole call: start, the input in two halves, end. */
const streamCall = async (page: Page, call: number, id: string, input: Record<string, unknown>, text: string): Promise<void> => {
  await emit(page, call, { type: 'tool_start', index: 0, id, name: 'blok_execute' });
  await emit(page, call, { type: 'tool_input', index: 0, json: prefix(input, text, Math.floor(text.length / 2)) });
  await emit(page, call, { type: 'tool_input', index: 0, json: JSON.stringify(input) });
  await emit(page, call, { type: 'tool_end', index: 0 });
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

const ORIGINAL = ['The quick brown fox', 'Second'];

/** Opens the bar under `block` and sends a prompt. */
const ask = async (page: Page, block: string, prompt = 'Write more'): Promise<void> => {
  await page.getByText(block).click();
  await page.keyboard.press(`${MOD}+j`);

  const bar = page.getByRole('dialog', { name: 'Ask AI' });

  await bar.getByRole('textbox').fill(prompt);
  await page.keyboard.press('Enter');
  await waitForCall(page, 1);
};

const waitInPage = (page: Page, ms: number): Promise<void> => page.evaluate((timeout) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, timeout);
}), ms);

// Subtree: typing folds the actions row, and the bar's height (so every gap under it) eases for ~400ms.
// Endless animations (shine, rose) never finish; a cancelled one rejects.
const settledBar = async (page: Page): Promise<void> => {
  await page.getByRole('dialog', { name: 'Ask AI' }).evaluate((element) => Promise.all(element.getAnimations({ subtree: true })
    .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => undefined))));
};

test.describe('Ask AI live edits', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await setup(page);
  });

  // The shared page resets media only between files, so reduced motion would reach the next test.
  test.afterEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: null });
    await page.evaluate(() => document.getElementById('host-utility')?.remove());
  });

  test('words appear in the page before the batch commits', async ({ page }) => {
    const text = 'Live words land here';
    const input = insertInput(text);

    await ask(page, 'Second');
    await emit(page, 0, { type: 'tool_start', index: 0, id: 'call-1', name: 'blok_execute' });
    await emit(page, 0, { type: 'tool_input', index: 0, json: prefix(input, text, 'Live words land '.length) });

    const preview = page.getByTestId('ai-preview');

    await expect(preview).toContainText('Live words land');
    expect(await savedTexts(page)).toEqual(ORIGINAL);
    await expect(page.locator(`#${HOLDER_ID} [data-blok-element]`).getByText('Live words')).toHaveCount(0);

    await emit(page, 0, { type: 'tool_input', index: 0, json: JSON.stringify(input) });
    await emit(page, 0, { type: 'tool_end', index: 0 });

    // Applied at tool_end, while the model response is still held.
    await expect.poll(() => savedTexts(page)).toEqual([...ORIGINAL, text]);
    await expect(preview).toHaveCount(0);
  });

  test('saved data never holds partial text mid-stream', async ({ page }) => {
    const text = 'One two three four five six';
    const input = insertInput(text);
    await ask(page, 'Second');
    await emit(page, 0, { type: 'tool_start', index: 0, id: 'call-1', name: 'blok_execute' });

    for (const chars of [4, 8, 14, 19, 24]) {
      await emit(page, 0, { type: 'tool_input', index: 0, json: prefix(input, text, chars) });
      expect(await savedTexts(page)).toEqual(ORIGINAL);
    }
    await expect(page.getByTestId('ai-preview')).toContainText('One two three four');
    expect(await savedTexts(page)).toEqual(ORIGINAL);

    await emit(page, 0, { type: 'tool_input', index: 0, json: JSON.stringify(input) });
    await emit(page, 0, { type: 'tool_end', index: 0 });
    await expect.poll(() => savedTexts(page)).toEqual([...ORIGINAL, text]);
  });

  test('one undo removes the whole streamed turn', async ({ page }) => {
    const first = insertInput('First streamed line');
    const second = insertInput('Second streamed line');

    await ask(page, 'Second');
    await streamCall(page, 0, 'call-1', first, 'First streamed line');
    await finish(page, 0, toolUse('call-1', first));
    await waitForCall(page, 2);
    await streamCall(page, 1, 'call-2', second, 'Second streamed line');
    await finish(page, 1, toolUse('call-2', second));
    await waitForCall(page, 3);
    await finish(page, 2, endTurn('Added two lines.'));

    const bar = page.getByRole('dialog', { name: 'Ask AI' });

    await expect(bar.getByText('Added two lines.')).toBeVisible();
    expect(await savedTexts(page)).toEqual([...ORIGINAL, 'First streamed line', 'Second streamed line']);

    await bar.getByRole('button', { name: 'Keep' }).click();
    await expect(bar).toHaveCount(0);
    // Keep hands focus back to the block the bar opened from.
    await expect(page.locator('[data-blok-id="p2"] [contenteditable="true"]')).toBeFocused();

    await page.keyboard.press(`${MOD}+z`);

    await expect.poll(() => savedTexts(page)).toEqual(ORIGINAL);
  });

  test('the bar opens under the caret block', async ({ page }) => {
    await page.getByText('The quick brown fox').click();
    await page.keyboard.press(`${MOD}+j`);

    const bar = page.getByRole('dialog', { name: 'Ask AI' });

    await expect(bar.getByRole('textbox')).toBeFocused();
    await settledBar(page);

    const box = await bar.boundingBox();
    const caretBlock = await page.locator('[data-blok-id="p1"] [contenteditable]').boundingBox();
    const next = await page.locator('[data-blok-id="p2"] [contenteditable]').boundingBox();

    if (box === null || caretBlock === null || next === null) {
      throw new Error('no layout');
    }
    expect(box.y).toBeGreaterThanOrEqual(caretBlock.y + caretBlock.height);
    expect(next.y).toBeGreaterThanOrEqual(box.y + box.height);
  });

  // The undo icon button is named by assistant.discard ("Discard").
  test('answered bar shows Undo and Keep; Keep closes it', async ({ page }) => {
    const input = insertInput('Kept line');

    await ask(page, 'Second');
    await streamCall(page, 0, 'call-1', input, 'Kept line');
    await finish(page, 0, toolUse('call-1', input));
    await waitForCall(page, 2);
    await finish(page, 1, endTurn('Added a line.'));

    const bar = page.getByRole('dialog', { name: 'Ask AI' });

    await expect(bar.getByText('Added a line.')).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Discard' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Keep' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Stop' })).toHaveCount(0);

    await bar.getByRole('button', { name: 'Keep' }).click();

    await expect(bar).toHaveCount(0);
    expect(await savedTexts(page)).toEqual([...ORIGINAL, 'Kept line']);
  });

  test('stop mid-stream keeps applied batches and leaves no gap', async ({ page }) => {
    const applied = insertInput('Applied line');
    const cut = insertInput('Never finished words');
    const bar = page.getByRole('dialog', { name: 'Ask AI' });
    const anchor = page.locator('[data-blok-id="p1"]');
    /** The anchor's space beyond the bar's own height: the bar's margins around it. */
    const spareGap = async (): Promise<number> =>
      parseFloat(await anchor.evaluate((holder) => getComputedStyle(holder).marginBlockEnd)) - ((await bar.boundingBox())?.height ?? 0);

    await page.getByText('The quick brown fox').click();
    await page.keyboard.press(`${MOD}+j`);
    await expect(bar.getByRole('textbox')).toBeFocused();
    await settledBar(page);

    const barOnly = await spareGap();

    await bar.getByRole('textbox').fill('Write more');
    await page.keyboard.press('Enter');
    await waitForCall(page, 1);

    await emit(page, 0, { type: 'tool_start', index: 0, id: 'call-1', name: 'blok_execute' });
    await emit(page, 0, { type: 'tool_input', index: 0, json: JSON.stringify(applied) });
    await emit(page, 0, { type: 'tool_end', index: 0 });
    await expect.poll(() => savedTexts(page)).toEqual([...ORIGINAL, 'Applied line']);

    await emit(page, 0, { type: 'tool_start', index: 1, id: 'call-2', name: 'blok_execute' });
    await emit(page, 0, { type: 'tool_input', index: 1, json: prefix(cut, 'Never finished words', 'Never finished '.length) });
    await expect(page.getByTestId('ai-preview')).toContainText('Never finished');

    await bar.getByRole('button', { name: 'Stop' }).click();
    await expect(bar.getByRole('alert')).toHaveText('Stopped. What was already written stays.');
    // A late event after Stop draws nothing, not even on the next frame.
    await emit(page, 0, { type: 'tool_input', index: 1, json: JSON.stringify(cut) });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    await expect(page.getByTestId('ai-preview')).toHaveCount(0);
    await expect(page.locator('[data-blok-ai-rewriting]')).toHaveCount(0);
    expect(await savedTexts(page)).toEqual([...ORIGINAL, 'Applied line']);
    await settledBar(page);

    const gapped = await page.evaluate(() => [...document.querySelectorAll('[data-blok-ai-gap]')].map((holder) => holder.getAttribute('data-blok-id')));

    // Only the bar's own space is left, the same as before the run.
    expect(gapped).toEqual(['p1']);
    expect(Math.abs(await spareGap() - barOnly)).toBeLessThanOrEqual(1);
  });

  test('reduced motion shows the final text with no animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const text = 'Calm words with no motion';
    const input = insertInput(text);

    await ask(page, 'Second');
    await emit(page, 0, { type: 'tool_start', index: 0, id: 'call-1', name: 'blok_execute' });

    // No pacing: every word that has arrived shows in the same tick.
    const sameTick = await page.evaluate((json) => {
      window.liveCalls?.[0]?.emit({ type: 'tool_input', index: 0, json });

      return document.querySelector('[data-blok-testid="ai-preview"]')?.textContent?.replace(/\s+/g, ' ').trim();
    }, prefix(input, text, 'Calm words with '.length));

    expect(sameTick).toBe('Calm words with');

    const preview = page.getByTestId('ai-preview');

    await expect(preview).toContainText('Calm words with');
    expect(await preview.evaluate((box) => box.getAnimations({ subtree: true }).length)).toBe(0);

    await emit(page, 0, { type: 'tool_input', index: 0, json: JSON.stringify(input) });
    await emit(page, 0, { type: 'tool_end', index: 0 });
    await expect.poll(() => savedTexts(page)).toEqual([...ORIGINAL, text]);

    const written = page.locator(`#${HOLDER_ID} [data-blok-element]`).filter({ hasText: text });

    await expect(written).toBeVisible();
    expect(await written.evaluate((holder) => holder.getAnimations({ subtree: true }).length)).toBe(0);
  });

  test('a call sent whole in one tick plays the fallback reveal', async ({ page }) => {
    const text = 'Whole call at once';
    const input = insertInput(text);

    await ask(page, 'Second');
    // Gemini sends a call's events together at the end of its stream.
    await page.evaluate((json) => {
      const call = window.liveCalls?.[0];

      call?.emit({ type: 'tool_start', index: 0, id: 'call-1', name: 'blok_execute' });
      call?.emit({ type: 'tool_input', index: 0, json });
      call?.emit({ type: 'tool_end', index: 0 });
    }, JSON.stringify(input));

    const written = page.locator(`#${HOLDER_ID} [data-blok-element]`).filter({ hasText: text });

    // The reveal lasts under a second, so poll fast.
    await expect.poll(
      () => written.evaluate((holder) => holder.getAnimations({ subtree: true })
        .some((animation) => animation instanceof CSSAnimation && animation.animationName === 'blok-ai-reveal')),
      { intervals: [20] }
    ).toBe(true);
    expect(await savedTexts(page)).toEqual([...ORIGINAL, text]);
  });

  // hostReset: a host page with its own unscoped `.m-0`, like the playground, which zeroes the real heading's margin.
  for (const [level, hostReset] of [[1, false], [2, false], [3, false], [1, true], [2, true], [3, true]] as const) {
    test(`a level ${level} heading preview sits where the heading lands${hostReset ? ' on a host with its own .m-0' : ''}, so nothing jumps at hand-off`, async ({ page }) => {
      if (hostReset) {
        await page.evaluate(() => {
          const style = document.createElement('style');

          style.id = 'host-utility';
          style.textContent = '.m-0 { margin: 0; }';
          document.head.append(style);
        });
      }
      const text = 'Heading words land';
      const input = { commands: [{ name: 'block.insert', args: { type: 'header', position: { before: 'p2' }, data: { text, level } } }] };
      /** The top of the text itself, not its box: the preview and the block pad it differently. */
      const textTop = (element: Locator): Promise<number> => element.evaluate((node) => {
        const range = document.createRange();

        range.selectNodeContents(node);

        return range.getBoundingClientRect().top;
      });
      const next = page.locator('[data-blok-id="p2"]');

      await ask(page, 'Second');
      await emit(page, 0, { type: 'tool_start', index: 0, id: 'call-1', name: 'blok_execute' });
      const json = JSON.stringify(input);

      const levelEnd = `"level":${level}}`;

      // Cut after `data` closes: the text is final, but the call is still open.
      await emit(page, 0, { type: 'tool_input', index: 0, json: json.slice(0, json.indexOf(levelEnd) + levelEnd.length) });

      const preview = page.getByTestId('ai-preview');

      await expect(preview).toHaveText(text);

      const previewTop = await textTop(preview.getByText(text));
      const nextBefore = (await next.boundingBox())?.y ?? 0;

      await emit(page, 0, { type: 'tool_input', index: 0, json: JSON.stringify(input) });
      await emit(page, 0, { type: 'tool_end', index: 0 });
      await expect(preview).toHaveCount(0);

      const heading = page.locator(`#${HOLDER_ID} [data-blok-element]`).filter({ hasText: text }).getByText(text);

      expect(Math.abs(await textTop(heading) - previewTop)).toBeLessThanOrEqual(2);
      expect(Math.abs(((await next.boundingBox())?.y ?? 0) - nextBefore)).toBeLessThanOrEqual(2);
    });
  }

  test('streamed words that land below the window do not scroll the page, and the bar stays in the window', async ({ page }) => {
    const tail = Array.from({ length: 40 }, (_unused, index) => ({ id: `t${index}`, type: 'paragraph', data: { text: `Filler line ${index}` } }));
    const text = 'Far below the window these words keep arriving one by one';
    const input = insertInput(text, { after: 't39' });

    await setup(page, tail);
    await ask(page, 'The quick brown fox');

    const before = await page.evaluate(() => window.scrollY);

    await emit(page, 0, { type: 'tool_start', index: 0, id: 'call-1', name: 'blok_execute' });
    for (let chars = 4; chars < text.length; chars += 6) {
      await emit(page, 0, { type: 'tool_input', index: 0, json: prefix(input, text, chars) });
    }
    await expect(page.getByTestId('ai-preview')).toContainText('arriving one');
    await emit(page, 0, { type: 'tool_input', index: 0, json: JSON.stringify(input) });
    await emit(page, 0, { type: 'tool_end', index: 0 });
    await expect.poll(async () => (await savedTexts(page)).at(-1)).toBe(text);

    expect(await page.evaluate(() => window.scrollY)).toBe(before);

    const bar = await page.getByRole('dialog', { name: 'Ask AI' }).boundingBox();
    const viewport = page.viewportSize();

    expect(bar !== null && viewport !== null && bar.y >= 0 && bar.y + bar.height <= viewport.height).toBe(true);
  });

  test('a block.update written in rich-text segments streams its plain text over the block', async ({ page }) => {
    const input = {
      commands: [{ name: 'block.update', args: { id: 'p1', data: { text: [{ text: 'Calm ' }, { text: 'bold <b> words', marks: { bold: true } }, { text: ' keep arriving here' }] } } }],
    };
    const p1 = page.locator('[data-blok-id="p1"]');

    await ask(page, 'The quick brown fox');
    await emit(page, 0, { type: 'tool_start', index: 0, id: 'call-1', name: 'blok_execute' });
    await emit(page, 0, { type: 'tool_input', index: 0, json: prefix(input, ' keep arriving here', ' keep '.length) });

    await expect(p1).toHaveAttribute('data-blok-ai-rewriting', '');
    await expect(page.getByTestId('ai-preview')).toContainText('Calm bold <b> words keep');
    expect(await savedTexts(page)).toEqual(ORIGINAL);

    await emit(page, 0, { type: 'tool_input', index: 0, json: JSON.stringify(input) });
    await emit(page, 0, { type: 'tool_end', index: 0 });
    await expect.poll(async () => (await savedTexts(page))[0]).toBe('Calm bold <b> words keep arriving here');
    await finish(page, 0, toolUse('call-1', input));
  });

  test('onChange stays silent while the preview holds a gap and a rewrite mark', async ({ page }) => {
    const input = {
      commands: [
        { name: 'text.replace', args: { id: 'p1', range: { find: 'quick' }, with: 'slow and steady' } },
        { name: 'block.insert', args: { type: 'paragraph', position: { after: 'p1' }, data: { text: 'Quiet words land here' } } },
      ],
    };
    const changes = (): Promise<number> => page.evaluate(() => window.liveChanges ?? 0);
    const p1 = page.locator('[data-blok-id="p1"]');

    await ask(page, 'The quick brown fox');
    await settledBar(page);
    // Opening the bar is not an edit either, but let any earlier delivery land first.
    await waitInPage(page, 500);

    const before = await changes();
    const gap = (): Promise<number> => p1.evaluate((holder) => parseFloat(holder.style.getPropertyValue('--blok-ai-gap')) || 0);

    // Read before tool_start: from it until the preview draws, the shimmer slots add to the gap.
    const barGap = await gap();

    await emit(page, 0, { type: 'tool_start', index: 0, id: 'call-1', name: 'blok_execute' });

    await emit(page, 0, { type: 'tool_input', index: 0, json: prefix(input, 'Quiet words land here', 'Quiet words '.length) });
    await expect(page.getByTestId('ai-preview').filter({ hasText: 'Quiet words' })).toBeVisible();
    await expect(p1).toHaveAttribute('data-blok-ai-rewriting', '');
    // The bar's own gap, plus the preview's share.
    await expect.poll(gap).toBeGreaterThan(barGap);
    // Silence has no event to wait for: wait out onChange's 400ms batch window.
    await waitInPage(page, 600);

    expect(await changes()).toBe(before);

    await emit(page, 0, { type: 'tool_input', index: 0, json: JSON.stringify(input) });
    await emit(page, 0, { type: 'tool_end', index: 0 });
    // The same listener does hear the committed batch.
    await expect.poll(changes).toBeGreaterThan(before);
    await finish(page, 0, toolUse('call-1', input));
  });

  test('an insert streams below the bar, not above it', async ({ page }) => {
    const text = 'Below the bar words';
    const input = insertInput(text, { after: 'p1' });

    await ask(page, 'The quick brown fox');
    await settledBar(page);
    await emit(page, 0, { type: 'tool_start', index: 0, id: 'call-1', name: 'blok_execute' });
    await emit(page, 0, { type: 'tool_input', index: 0, json: prefix(input, text, 'Below the bar '.length) });

    const bar = page.getByRole('dialog', { name: 'Ask AI' });
    const preview = page.getByTestId('ai-preview');

    await expect(preview).toContainText('Below the bar');

    const barBox = await bar.boundingBox();
    const previewBox = await preview.boundingBox();
    const next = await page.locator('[data-blok-id="p2"] [contenteditable]').boundingBox();

    if (barBox === null || previewBox === null || next === null) {
      throw new Error('no layout');
    }
    expect(previewBox.y).toBeGreaterThanOrEqual(barBox.y + barBox.height);
    expect(next.y).toBeGreaterThanOrEqual(previewBox.y + previewBox.height);

    await emit(page, 0, { type: 'tool_input', index: 0, json: JSON.stringify(input) });
    await emit(page, 0, { type: 'tool_end', index: 0 });
    await expect.poll(() => savedTexts(page)).toEqual(['The quick brown fox', text, 'Second']);

    // The real block lands where the preview was: under the bar, not between the bar and its block.
    const written = page.locator(`#${HOLDER_ID} [data-blok-element]`).filter({ hasText: text });

    await expect.poll(async () => {
      const box = await written.boundingBox();
      const now = await bar.boundingBox();

      return box !== null && now !== null && box.y >= now.y + now.height;
    }).toBe(true);
  });

  test('a Markdown table streams as the real table, with no pipes, and hands off without a jump', async ({ page }) => {
    const markdown = '| Planet | Moons |\n| --- | --- |\n| Mars | 2 |\n| Jupiter | 95 |';
    const input = { commands: [{ name: 'markdown.insert', args: { position: 'end', markdown } }] };
    const json = JSON.stringify(input);

    await ask(page, 'Second');
    await emit(page, 0, { type: 'tool_start', index: 0, id: 'call-1', name: 'blok_execute' });
    await emit(page, 0, { type: 'tool_input', index: 0, json: json.slice(0, json.indexOf('| Mars |') + '| Mars |'.length) });

    const preview = page.getByTestId('ai-preview');
    const previewTable = preview.getByRole('table', { includeHidden: true });

    await expect(previewTable).toBeVisible();
    await expect(previewTable.locator('[data-blok-table-cell]')).toHaveCount(4);
    await expect(previewTable.locator('[data-blok-table-cell]').first()).toHaveText('Planet');
    expect(await preview.textContent()).not.toMatch(/[|]|---/);

    await emit(page, 0, { type: 'tool_input', index: 0, json });
    await expect(previewTable.locator('[data-blok-table-cell]')).toHaveText(['Planet', 'Moons', 'Mars', '2', 'Jupiter', '95']);

    const look = (table: Locator): Promise<Record<string, string | number>> => table.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const heading = getComputedStyle(element.querySelector('[data-blok-table-cell]') ?? element);
      const body = getComputedStyle(element.querySelectorAll('[data-blok-table-cell]')[2] ?? element);

      return {
        left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height),
        headingWeight: heading.fontWeight, headingBg: heading.backgroundColor, bodySize: body.fontSize, radius: getComputedStyle(element).borderTopLeftRadius,
      };
    });
    const before = await look(previewTable);

    await emit(page, 0, { type: 'tool_end', index: 0 });
    await expect(preview).toHaveCount(0);

    const real = page.locator(`#${HOLDER_ID} [data-blok-tool="table"] table`);

    await expect(real.locator('[data-blok-table-cell]')).toHaveText(['Planet', 'Moons', 'Mars', '2', 'Jupiter', '95']);
    expect(await look(real)).toEqual(before);
  });

  test('a GitHub alert streams as the real callout, with its body blocks, and hands off without a jump', async ({ page }) => {
    const markdown = '> [!NOTE]\n> Mars has **two** moons.\n> - Phobos\n> - Deimos';
    const input = { commands: [{ name: 'markdown.insert', args: { position: 'end', markdown } }] };
    const json = JSON.stringify(input);

    await ask(page, 'Second');
    await emit(page, 0, { type: 'tool_start', index: 0, id: 'call-1', name: 'blok_execute' });
    await emit(page, 0, { type: 'tool_input', index: 0, json: json.slice(0, json.indexOf('moons.') + 'moons.'.length) });

    const preview = page.getByTestId('ai-preview');
    const previewCallout = preview.locator('[data-blok-tool="callout"]');

    await expect(previewCallout).toBeVisible();
    await expect(previewCallout.getByTestId('callout-emoji-face')).toHaveText('ℹ️');
    expect(await preview.textContent()).not.toMatch(/\[!|>/);

    await emit(page, 0, { type: 'tool_input', index: 0, json });
    await expect(previewCallout).toContainText('Deimos');

    const look = (callout: Locator): Promise<Record<string, string | number>> => callout.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const offset = (node: Element | null): string => {
        const box = node?.getBoundingClientRect();

        return box === undefined ? 'none' : `${Math.round(box.left - rect.left)},${Math.round(box.top - rect.top)},${Math.round(box.height)}`;
      };
      const texts = [...element.querySelectorAll('[data-blok-nested-blocks] *')].filter((node) => node.childElementCount === 0 && node.textContent?.trim() === 'Deimos');

      return {
        left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height),
        background: style.backgroundColor, radius: style.borderTopLeftRadius, border: style.borderTopWidth,
        emoji: offset(element.querySelector('[data-blok-testid="callout-emoji-face"]')),
        lastItem: offset(texts[0]?.closest('[data-list-style]') ?? null),
      };
    });
    const before = await look(previewCallout);

    expect(before.emoji).not.toBe('none');
    expect(before.lastItem).not.toBe('none');

    await emit(page, 0, { type: 'tool_end', index: 0 });
    await expect(preview).toHaveCount(0);

    const real = page.locator(`#${HOLDER_ID} [data-blok-tool="callout"]`);

    await expect(real).toContainText('Deimos');
    expect(await look(real)).toEqual(before);
  });

  test('a Markdown image streams as the real image block, alt text as its caption, and hands off without a jump', async ({ page }) => {
    const url = new URL('/test/playwright/fixtures/image/shot.png', page.url()).href;
    const markdown = `![Red planet](${url})`;
    const json = JSON.stringify({ commands: [{ name: 'markdown.insert', args: { position: 'end', markdown } }] });

    await ask(page, 'Second');
    await emit(page, 0, { type: 'tool_start', index: 0, id: 'call-1', name: 'blok_execute' });
    await emit(page, 0, { type: 'tool_input', index: 0, json: json.slice(0, json.indexOf('/fixtures')) });

    const preview = page.getByTestId('ai-preview');
    const previewImage = preview.locator('[data-blok-tool="image"]');

    await expect(previewImage).toBeVisible();
    await expect(previewImage).toContainText('Red planet');
    expect(await preview.textContent()).not.toMatch(/!\[|http/);

    await emit(page, 0, { type: 'tool_input', index: 0, json });

    const look = (image: Locator): Promise<Record<string, string | number>> => image.evaluate(async (element) => {
      const img = element.querySelector('img');

      await img?.decode();

      const box = (node: Element | null): string => {
        const rect = node?.getBoundingClientRect();

        return rect === undefined ? 'none' : [rect.left, rect.top - element.getBoundingClientRect().top, rect.width, rect.height].map(Math.round).join(',');
      };
      const caption = element.querySelector('.blok-image-caption');

      return {
        root: box(element), img: box(img), caption: box(caption),
        captionSize: caption === null ? 'none' : getComputedStyle(caption).fontSize, radius: img === null ? 'none' : getComputedStyle(img).borderTopLeftRadius,
      };
    });
    const before = await look(previewImage);

    expect(before.img).not.toBe('none');
    expect(before.caption).not.toBe('none');

    await emit(page, 0, { type: 'tool_end', index: 0 });
    await expect(preview).toHaveCount(0);

    const real = page.locator(`#${HOLDER_ID} [data-blok-tool="image"]`);

    await expect(real).toContainText('Red planet');
    expect(await look(real)).toEqual(before);
  });

  test('a code fence and a $$ formula stream as the real code and LaTeX blocks, and hand off without a jump', async ({ page }) => {
    const markdown = '```python\nx = 1\nprint(x)\n```\n\n$$\nE = mc^2\n$$';
    const json = JSON.stringify({ commands: [{ name: 'markdown.insert', args: { position: 'end', markdown } }] });

    await ask(page, 'Second');
    await emit(page, 0, { type: 'tool_start', index: 0, id: 'call-1', name: 'blok_execute' });
    await emit(page, 0, { type: 'tool_input', index: 0, json });

    const preview = page.getByTestId('ai-preview');
    const previewBlocks = preview.locator('[data-blok-tool="code"]');

    await expect(previewBlocks).toHaveCount(2);
    await expect.poll(() => drawn(previewBlocks.nth(1).getByTestId('code-preview'))).toBe(true);
    await expect(previewBlocks.nth(0).getByTestId('code-content')).toHaveText('x = 1\nprint(x)');
    expect(await preview.textContent()).not.toMatch(/```|\$\$/);

    const look = (block: Locator): Promise<Record<string, string>> => block.evaluate((element) => {
      const top = element.getBoundingClientRect().top;
      const box = (node: Element | null): string => {
        const rect = node?.getBoundingClientRect();

        return rect === undefined ? 'none' : [rect.left, rect.top - top, rect.width, rect.height].map(Math.round).join(',');
      };

      return {
        block: box(element),
        header: box(element.querySelector('[data-blok-testid="code-language-btn"]')),
        content: box(element.querySelector('[data-blok-testid="code-preview"]:not([hidden])') ?? element.querySelector('[data-blok-testid="code-content"]')),
      };
    });
    // KaTeX's fonts change the formula's height when they arrive.
    await page.evaluate(() => document.fonts.ready);
    const before = [await look(previewBlocks.nth(0)), await look(previewBlocks.nth(1))];

    await emit(page, 0, { type: 'tool_end', index: 0 });
    await expect(preview).toHaveCount(0);

    const real = page.locator(`#${HOLDER_ID} [data-blok-tool="code"]`);

    await expect.poll(() => drawn(real.nth(1).getByTestId('code-preview'))).toBe(true);
    await page.evaluate(() => document.fonts.ready);
    expect([await look(real.nth(0)), await look(real.nth(1))]).toEqual(before);
  });

  test('a fence with no language shows the code block\'s "Plain text" label while it streams', async ({ page }) => {
    const json = JSON.stringify({ commands: [{ name: 'markdown.insert', args: { position: 'end', markdown: '```\nnotes\n```' } }] });

    await ask(page, 'Second');
    await emit(page, 0, { type: 'tool_start', index: 0, id: 'call-1', name: 'blok_execute' });
    await emit(page, 0, { type: 'tool_input', index: 0, json });

    await expect(page.getByTestId('ai-preview').getByTestId('code-language-name')).toHaveText('Plain text');
  });

  test('a mermaid fence streams as the drawn diagram, and hands off without a jump', async ({ page }) => {
    const markdown = '```mermaid\ngraph TD\n  A --> B\n```';
    const json = JSON.stringify({ commands: [{ name: 'markdown.insert', args: { position: 'end', markdown } }] });

    await ask(page, 'Second');
    await emit(page, 0, { type: 'tool_start', index: 0, id: 'call-1', name: 'blok_execute' });
    await emit(page, 0, { type: 'tool_input', index: 0, json });

    const preview = page.getByTestId('ai-preview');
    await expect.poll(() => drawn(preview.getByTestId('code-preview'))).toBe(true);

    const size = (block: Locator): Promise<string> => block.evaluate((element) => {
      const rect = element.getBoundingClientRect();

      return [rect.left, rect.width, rect.height].map(Math.round).join(',');
    });
    const before = await size(preview.locator('[data-blok-tool="code"]'));

    await emit(page, 0, { type: 'tool_end', index: 0 });
    await expect(preview).toHaveCount(0);

    const real = page.locator(`#${HOLDER_ID} [data-blok-tool="code"]`);

    await expect.poll(() => drawn(real.getByTestId('code-preview'))).toBe(true);
    expect(await size(real)).toBe(before);
  });
});
