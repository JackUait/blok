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

const setup = async (page: Page, script: ScriptedResponse[], options: { hold?: boolean } = {}): Promise<void> => {
  await page.evaluate(async ({ holder, responses, hold }) => {
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

    const blok = new window.Blok({
      holder,
      data: { blocks: [
        { id: 'p1', type: 'paragraph', data: { text: 'The quick brown fox' } },
        { id: 'p2', type: 'paragraph', data: { text: 'Second' } },
      ] },
      agent: {
        assistant: {
          name: 'Claude',
          model: async (request: AgentModelRequest) => {
            window.assistantPrompts?.push(request.messages[0]?.content);
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
  }, { holder: HOLDER_ID, responses: script, hold: options.hold === true });
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

    await expect(bar.getByRole('status')).toHaveText('Claude is writing…');
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
    expect(String((await page.evaluate(() => window.assistantPrompts))?.[0])).toContain('p2');
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
