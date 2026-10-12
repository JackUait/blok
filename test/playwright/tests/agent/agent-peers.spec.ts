import { expect, test, type Page } from '@playwright/test';

import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import {
  gotoCollabPage,
  holdCollabDocFrames,
  mountCollabEditor,
  releaseCollabDocFrames,
  waitForHeldDocFramesToSettle,
} from '../helpers/collab';

const newDoc = (): string => `agent-peers-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const open = async (page: Page, doc: string, name: string, seedsEmptyRoom: boolean): Promise<void> => {
  await gotoCollabPage(page);
  await mountCollabEditor(page, { doc, name, seedsEmptyRoom });
};

const runAgentBatch = (page: Page, editorName: string): Promise<void> => page.evaluate(async (name) => {
  const editor = window.__collabEditors?.[name];

  if (editor === undefined) {
    throw new Error(`no editor ${name}`);
  }

  const turn = editor.agent.begin({ agent: { id: 'assistant', name: 'Assistant' } });

  (window as unknown as { __turn?: typeof turn }).__turn = turn;
  await turn.call('blok_execute', { commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'from agent' }, position: 'end' } }] });
}, editorName);

const endAgentTurn = (page: Page): Promise<void> => page.evaluate(() => {
  (window as unknown as { __turn?: { end(): void } }).__turn?.end();
});

test.describe('agent visible to collaboration peers', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test('spec 29: a peer sees the in-app agent, and it leaves on end()', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);
    await open(pageB, doc, 'beta', false);
    await runAgentBatch(pageA, 'alpha');

    const marker = pageB.getByTestId('beta').locator('[data-blok-agent-marker-label]');

    await expect(marker).toHaveCount(1);
    await expect(marker).toHaveAttribute('data-blok-agent-marker-label', /Assistant/);

    await endAgentTurn(pageA);
    await expect(pageB.getByTestId('beta').locator('[data-blok-agent-marker]')).toHaveCount(0);
  });

  test('the marker appears when the agent\'s new block syncs after its cursor', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);
    await open(pageB, doc, 'beta', false);
    await holdCollabDocFrames(pageB);
    await runAgentBatch(pageA, 'alpha');
    await waitForHeldDocFramesToSettle(pageB);

    // The cursor arrived, but its block has not: nothing can be drawn yet.
    await expect(pageB.getByTestId('beta').locator('[data-blok-agent-marker]')).toHaveCount(0);

    await releaseCollabDocFrames(pageB);
    await expect(pageB.getByTestId('beta').locator('[data-blok-agent-marker-label]')).toHaveCount(1);
    await endAgentTurn(pageA);
  });

  test('a peer that joins mid-turn still sees the agent (QueryAwareness nudge)', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);
    await runAgentBatch(pageA, 'alpha');
    await open(pageB, doc, 'beta', false);

    await expect(pageB.getByTestId('beta').locator('[data-blok-agent-marker-label]')).toHaveCount(1, { timeout: 5000 });
    await endAgentTurn(pageA);
  });
});
