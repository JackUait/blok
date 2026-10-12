import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

declare global {
  interface Window {
    blokInstance?: Blok;
    agentTurn?: ReturnType<Blok['agent']['begin']>;
  }
}

const setup = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    document.body.append(container);

    const blok = new window.Blok({
      holder,
      user: { id: 'human' },
      data: { blocks: [
        { id: 'p1', type: 'paragraph', data: { text: 'First' } },
        { id: 'p2', type: 'paragraph', data: { text: 'Second' } },
      ] },
    });

    window.blokInstance = blok;
    await blok.isReady;
    window.agentTurn = blok.agent.begin({ agent: { id: 'assistant', name: 'Assistant' } });
  }, { holder: HOLDER_ID });
};

/** One scripted tool call, as a model would send it. */
const callTool = (page: Page, name: string, input: unknown): Promise<{ content: string; isError: boolean }> =>
  page.evaluate(async ({ toolName, toolInput }) => {
    const turn = window.agentTurn;

    if (turn === undefined) {
      throw new Error('no open turn');
    }

    return turn.call(toolName, toolInput);
  }, { toolName: name, toolInput: input });

const insert = (type: string, data: Record<string, unknown>) =>
  ({ commands: [{ name: 'block.insert', args: { type, data, position: 'end' } }] });

const createdId = (content: string): string =>
  (JSON.parse(content) as { changed: { created: string[] } }).changed.created[0];

const savedTexts = (page: Page): Promise<string[]> => page.evaluate(async () => {
  const saved = await window.blokInstance?.save();

  return (saved?.blocks ?? []).map((block) => {
    const text: unknown = block.data.text;

    if (Array.isArray(text)) {
      return text.map((segment: unknown) => (typeof segment === 'object' && segment !== null && 'text' in segment ? String(segment.text) : '')).join('');
    }

    return typeof text === 'string' ? text : '';
  });
});

const errorCode = (content: string): unknown => {
  const parsed: unknown = JSON.parse(content);

  return typeof parsed === 'object' && parsed !== null && 'error' in parsed
    && typeof parsed.error === 'object' && parsed.error !== null && 'code' in parsed.error
    ? parsed.error.code
    : undefined;
};

/**
 * Cmd/Ctrl+Z as a person presses it. The keyboard controller drops a second
 * identical undo within 50ms as a duplicate, so presses are spaced past that.
 */
const lastUndo = new WeakMap<Page, number>();

const pressUndo = async (page: Page): Promise<void> => {
  await expect.poll(() => Date.now() - (lastUndo.get(page) ?? 0)).toBeGreaterThan(60);
  await page.keyboard.press(UNDO);
  lastUndo.set(page, Date.now());
};

const endTurn = (page: Page): Promise<void> => page.evaluate(() => window.agentTurn?.end());

test.describe('in-app agent turn', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await setup(page);
  });

  test('spec 13: the user sees the agent work, and one Cmd+Z undoes the turn', async ({ page }) => {
    const heading = await callTool(page, 'blok_execute', insert('header', { text: 'Plan', level: 2 }));
    const list = await callTool(page, 'blok_execute', insert('list', { text: 'Step one', style: 'unordered' }));

    expect(heading).toMatchObject({ isError: false });
    expect(list).toMatchObject({ isError: false });

    const listHolder = page.locator(`[data-blok-id="${createdId(list.content)}"]`);

    await expect(listHolder.locator('[data-blok-agent-marker-label="Assistant"]')).toHaveCount(1);
    await expect(listHolder).toHaveClass(/blok-block--target/);

    await endTurn(page);
    await expect(page.locator('[data-blok-agent-marker]')).toHaveCount(0);

    await page.locator('[data-blok-id="p1"] [contenteditable="true"]').click();
    await pressUndo(page);

    await expect.poll(() => savedTexts(page)).toEqual(['First', 'Second']);
  });

  test('spec 14, R-U3 (spec 8), R-U6 (spec 18): user typing mid-turn is its own step', async ({ page }) => {
    const first = await callTool(page, 'blok_execute', insert('paragraph', { text: 'Agent A' }));
    const agentA = createdId(first.content);
    const p2 = page.locator('[data-blok-id="p2"] [contenteditable="true"]');

    await p2.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' typed');

    await callTool(page, 'blok_execute', insert('paragraph', { text: 'Agent B' }));
    await endTurn(page);

    await p2.click();
    await pressUndo(page);
    await expect.poll(() => savedTexts(page)).toEqual(['First', 'Second typed', 'Agent A']);

    const focusedBlock = await page.evaluate(() => document.activeElement?.closest('[data-blok-id]')?.getAttribute('data-blok-id') ?? null);

    expect(focusedBlock).not.toBe(agentA);

    await pressUndo(page);
    await expect.poll(() => savedTexts(page)).toEqual(['First', 'Second', 'Agent A']);

    await pressUndo(page);
    await expect.poll(() => savedTexts(page)).toEqual(['First', 'Second']);
  });

  test('spec 15: stop mid-turn lands no later command', async ({ page }) => {
    const first = await callTool(page, 'blok_execute', insert('paragraph', { text: 'Landed' }));
    const landedHolder = page.locator(`[data-blok-id="${createdId(first.content)}"]`);

    // The turn is visibly working before the stop.
    await expect(landedHolder.locator('[data-blok-agent-marker-label="Assistant"]')).toHaveCount(1);

    const [queued, after] = await page.evaluate(async () => {
      const turn = window.agentTurn;

      if (turn === undefined) {
        throw new Error('no open turn');
      }

      const pending = turn.call('blok_execute', { commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'Never' }, position: 'end' } }] });

      turn.stop();

      return Promise.all([pending, turn.call('blok_read', {})]);
    });

    expect(errorCode(queued.content)).toBe('CANCELLED');
    expect(errorCode(after.content)).toBe('CANCELLED');
    expect(await savedTexts(page)).toEqual(['First', 'Second', 'Landed']);
    await expect(page.locator('[data-blok-agent-marker], [data-blok-presence-caret]')).toHaveCount(0);
  });
});
