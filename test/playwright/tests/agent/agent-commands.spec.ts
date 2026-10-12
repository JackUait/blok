import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';

import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

const mount = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async (list) => {
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.setAttribute('data-blok-testid', 'blok');
    document.body.appendChild(holder);
    const blok = new window.Blok({ holder: 'blok', data: { blocks: list } });

    window.blokInstance = blok;
    await blok.isReady;
  }, blocks);
};

test.describe('agent commands', () => {
  test('one undo removes an agent batch', async ({ page }) => {
    await mount(page, [{ id: 'p', type: 'paragraph', data: { text: 'Hello world' } }]);

    const result = await page.evaluate(async () => {
      const blok = window.blokInstance;

      if (blok === undefined) {
        throw new Error('The editor did not mount.');
      }

      const turn = blok.agent.begin({ agent: { id: 'agent-e2e', name: 'Agent' } });
      const out = await turn.execute({ commands: [
        { name: 'block.insert', args: { type: 'toggle', data: { text: 'Details' }, children: [{ type: 'paragraph', data: { text: 'inside' } }] } },
        { name: 'text.format', args: { id: 'p', range: { find: 'world' }, set: { bold: true } } },
      ] });

      turn.end();

      return out;
    });

    expect(result).toMatchObject({ ok: true });
    await expect(page.getByTestId('blok').getByText('Details')).toBeVisible();

    const isMac = await page.evaluate(() => navigator.userAgent.toLowerCase().includes('mac'));

    await page.getByTestId('blok').getByText('Hello').click();
    await page.keyboard.press(`${isMac ? 'Meta' : 'Control'}+z`);

    await expect(page.getByTestId('blok').getByText('Details')).toHaveCount(0);
    await expect.poll(() => page.evaluate(async () => (await window.blokInstance?.save())?.blocks[0]?.data.text))
      .toEqual([{ text: 'Hello world' }]);
  });
});
