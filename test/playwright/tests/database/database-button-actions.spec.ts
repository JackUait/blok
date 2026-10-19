/**
 * The button property's Notion actions (research/17 §3): the action list in
 * Notion's order, Show confirmation gating the actions after it, and Add
 * page to / Edit pages in another database. One click is one undo step.
 */

import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
    notified?: unknown[];
    /** What the scripted assistant answers, in order. */
    agentScript?: unknown[];
    /** The first user message of each model request. */
    agentPrompts?: unknown[];
    /** Set while the held model call waits. */
    agentRelease?: () => void;
  }
}

const TITLE = { id: 'p-title', name: 'Name', type: 'title', position: 'a0' };

const view = (id: string): Record<string, unknown> =>
  ({ id, name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] });

const row = (id: string, parent: string, i: number, properties: Record<string, unknown>): OutputBlockData =>
  ({ id, type: 'database-row', parent, data: { position: `a${i}`, properties } });

const blocks = (): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      title: 'Tasks',
      schema: [
        TITLE,
        { id: 'p-flag', name: 'Flag', type: 'checkbox', position: 'a1' },
        { id: 'p-done', name: 'Done', type: 'checkbox', position: 'a2' },
        {
          id: 'p-act', name: 'Act', type: 'button', position: 'a3',
          button: {
            label: 'Finish',
            buttonActions: [
              { id: 'c', type: 'showConfirmation', message: 'Close this task?', confirmLabel: 'Close it', cancelLabel: 'Keep it' },
              { id: 'x', type: 'editProperty', propertyId: 'p-done', value: true },
              { id: 'a', type: 'addPage', databaseId: 'db-2', name: 'Follow-up' },
              { id: 'e', type: 'editPages', target: { type: 'addedPage', stepId: 'a' }, edits: [{ id: 'e1', propertyId: 'q-open', value: true }] },
            ],
          },
        },
      ],
      views: [view('v1')],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  row('r1', 'db-1', 0, { 'p-title': 'Alpha', 'p-flag': false, 'p-done': false }),
  {
    id: 'db-2',
    type: 'database',
    data: {
      title: 'Follow-ups',
      schema: [{ id: 'q-title', name: 'Name', type: 'title', position: 'a0' }, { id: 'q-open', name: 'Open', type: 'checkbox', position: 'a1' }],
      views: [view('v2')],
      activeViewId: 'v2',
    },
    content: [],
  },
];

const bulkBlocks = (): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      title: 'Tasks',
      schema: [
        TITLE,
        {
          id: 'p-bulk', name: 'Bulk', type: 'button', position: 'a1',
          button: {
            label: 'Mark seen',
            buttonActions: [{ id: 'b', type: 'editPages', target: { type: 'database', databaseId: 'db-2' }, edits: [{ id: 'e1', propertyId: 'q-seen', value: true }] }],
          },
        },
      ],
      views: [view('v1')],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  row('r1', 'db-1', 0, { 'p-title': 'Alpha' }),
  {
    id: 'db-2',
    type: 'database',
    data: {
      title: 'Follow-ups',
      schema: [
        { id: 'q-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'q-open', name: 'Open', type: 'checkbox', position: 'a1' },
        { id: 'q-seen', name: 'Seen', type: 'checkbox', position: 'a2' },
      ],
      views: [view('v2')],
      activeViewId: 'v2',
    },
    content: ['f1', 'f2'],
  },
  row('f1', 'db-2', 0, { 'q-title': 'Open one', 'q-open': true, 'q-seen': false }),
  row('f2', 'db-2', 1, { 'q-title': 'Closed one', 'q-open': false, 'q-seen': false }),
];

interface AgentStub {
  script: unknown[];
  /** The model call waits for window.agentRelease. */
  hold?: boolean;
}

const mount = async (page: Page, input: OutputBlockData[] = blocks(), agent?: AgentStub): Promise<void> => {
  await page.evaluate(async ({ input, agent }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1100px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.notified = [];
    window.agentScript = agent?.script ?? [];
    window.agentPrompts = [];
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: input },
      tools: {
        database: {
          class: (window as unknown as Record<string, unknown>).BlokDatabase,
          config: { buttons: { onNotify: (call: unknown) => window.notified?.push(call) } },
        },
      },
      ...(agent === undefined ? {} : {
        agent: {
          assistant: {
            model: async (request: { messages: Array<{ content: unknown }>; signal: AbortSignal }) => {
              window.agentPrompts?.push(request.messages[0]?.content);
              if (agent.hold) {
                await new Promise<void>((resolve) => {
                  window.agentRelease = resolve;
                  request.signal.addEventListener('abort', () => resolve());
                });
              }
              const next = window.agentScript?.shift();

              if (next === undefined) throw new Error('unscripted model call');

              return next;
            },
          },
        },
      }),
    });
    await window.blokInstance.isReady;
  }, { input, agent });
};

const saved = async (page: Page): Promise<OutputBlockData[]> => page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);

const propertiesOf = async (page: Page, id: string): Promise<Record<string, unknown>> =>
  ((await saved(page)).find((block) => block.id === id)?.data as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};

const rowsOf = async (page: Page, parent: string): Promise<OutputBlockData[]> =>
  (await saved(page)).filter((block) => block.type === 'database-row' && (block as { parent?: string }).parent === parent);

const undo = async (page: Page): Promise<void> => {
  await page.evaluate(() => window.blokInstance?.history.undo());
};

const finish = (page: Page): ReturnType<Page['getByRole']> =>
  page.locator('[data-blok-database-table-row][data-row-id="r1"]').getByRole('button', { name: 'Finish' });

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('button property: Notion actions', () => {
  test.beforeEach(async ({ page }) => {
    await mount(page);
  });

  test('lists the actions in Notion\'s order', async ({ page }) => {
    await page.locator('[role="columnheader"][data-property-id="p-act"]').click();
    await page.getByRole('menuitem', { name: 'Edit automation' }).click();
    await page.getByRole('menuitem', { name: 'Add action' }).click();

    const labels = ['Edit property', 'Add page to…', 'Edit pages in…', 'Send notification to…', 'Show confirmation', 'Open page, form, or URL', 'Define variables'];
    const items = page.locator('[data-blok-popover-opened="true"]').last().getByRole('menuitem');

    await expect(items.first()).toBeVisible();
    const texts = (await items.allInnerTexts()).map((text) => text.trim());

    expect(texts.slice(0, labels.length)).toEqual(labels);
  });

  test('runs nothing until Continue, then every write as one undo step', async ({ page }) => {
    await page.locator('[data-blok-database-table-row][data-row-id="r1"] [role="gridcell"][data-property-id="p-flag"]').click();
    await expect.poll(async () => (await propertiesOf(page, 'r1'))['p-flag']).toBe(true);

    await finish(page).click();
    const dialog = page.getByRole('alertdialog', { name: 'Close this task?' });

    await expect(dialog).toBeVisible();
    expect((await propertiesOf(page, 'r1'))['p-done']).toBe(false);
    await dialog.getByRole('button', { name: 'Close it' }).click();

    await expect.poll(async () => (await propertiesOf(page, 'r1'))['p-done']).toBe(true);
    const added = await rowsOf(page, 'db-2');

    expect(added).toHaveLength(1);
    expect((added[0].data as { properties: Record<string, unknown> }).properties).toMatchObject({ 'q-title': 'Follow-up', 'q-open': true });

    await undo(page);
    await expect.poll(async () => (await propertiesOf(page, 'r1'))['p-done']).toBe(false);
    expect(await rowsOf(page, 'db-2')).toEqual([]);
    expect((await propertiesOf(page, 'r1'))['p-flag']).toBe(true);

    await undo(page);
    await expect.poll(async () => (await propertiesOf(page, 'r1'))['p-flag']).toBe(false);
  });

  test('Escape on the confirmation runs nothing', async ({ page }) => {
    await finish(page).click();
    await expect(page.getByRole('alertdialog', { name: 'Close this task?' })).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect((await propertiesOf(page, 'r1'))['p-done']).toBe(false);
    expect(await rowsOf(page, 'db-2')).toEqual([]);
  });
});

test.describe('button property: Edit pages in a data source', () => {
  test('a filter set in the view filter editor is saved and limits the pages the button edits', async ({ page }) => {
    await mount(page, bulkBlocks());
    await page.locator('[role="columnheader"][data-property-id="p-bulk"]').click();
    await page.getByRole('menuitem', { name: 'Edit automation' }).click();
    await page.getByRole('menuitem', { name: 'Edit pages in…' }).click();
    await page.getByRole('menuitem', { name: 'All pages' }).click();

    const panel = page.getByTestId('database-button-filter');

    // An empty filter list is the property picker (feel/findings-toolbar V15).
    await panel.getByTestId('database-pick-property-q-open').click();

    await expect.poll(async () => {
      const schema = ((await saved(page)).find((block) => block.id === 'db-1')?.data as { schema: Array<{ id: string; button?: { buttonActions: Array<{ target?: { filters?: unknown[] } }> } }> }).schema;

      return schema.find((property) => property.id === 'p-bulk')?.button?.buttonActions[0].target?.filters;
    }).toEqual([expect.objectContaining({ propertyId: 'q-open', operator: 'equals', value: true })]);

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('[data-blok-database-table-row][data-row-id="r1"]').getByRole('button', { name: 'Mark seen' }).click();

    await expect.poll(async () => (await propertiesOf(page, 'f1'))['q-seen']).toBe(true);
    expect((await propertiesOf(page, 'f2'))['q-seen']).toBe(false);
  });
});

const agentBlocks = (): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      title: 'Tasks',
      schema: [
        TITLE,
        { id: 'p-done', name: 'Done', type: 'checkbox', position: 'a1' },
        {
          id: 'p-ask', name: 'Ask', type: 'button', position: 'a2',
          button: {
            label: 'Summarize',
            buttonActions: [
              { id: 'x', type: 'editProperty', propertyId: 'p-done', value: true },
              { id: 'm', type: 'sendAgentMessage', message: 'Write a one-line summary' },
            ],
          },
        },
      ],
      views: [view('v1')],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  row('r1', 'db-1', 0, { 'p-title': 'Alpha', 'p-done': false }),
];

const insertCall = {
  stop_reason: 'tool_use',
  content: [{
    type: 'tool_use',
    id: 'use-1',
    name: 'blok_execute',
    input: { commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'Agent summary' }, position: 'end' } }] },
  }],
};

const endTurn = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] };

const summarize = (page: Page): ReturnType<Page['getByRole']> =>
  page.locator('[data-blok-database-table-row][data-row-id="r1"]').getByRole('button', { name: 'Summarize' });

const hasAgentParagraph = async (page: Page): Promise<boolean> =>
  (await saved(page)).some((block) => block.type === 'paragraph' && JSON.stringify(block.data).includes('Agent summary'));

const agentStatus = (page: Page): Promise<string | undefined> => page.evaluate(() => window.blokInstance?.agent.state.status);

test.describe('button property: Send message to agent', () => {
  test('is offered only when the editor has an assistant', async ({ page }) => {
    const open = async (): Promise<string[]> => {
      await page.locator('[role="columnheader"][data-property-id="p-ask"]').click();
      await page.getByRole('menuitem', { name: 'Edit automation' }).click();
      await page.getByRole('menuitem', { name: 'Add action' }).click();
      const items = page.locator('[data-blok-popover-opened="true"]').last().getByRole('menuitem');

      await expect(items.first()).toBeVisible();

      return (await items.allInnerTexts()).map((text) => text.trim());
    };
    const withoutMessage = (): OutputBlockData[] => {
      const input = agentBlocks();
      const schema = (input[0].data as { schema: Array<{ button?: { label?: string; buttonActions: unknown[] } }> }).schema;

      schema[2].button = { label: 'Summarize', buttonActions: [] };

      return input;
    };

    await mount(page, withoutMessage(), { script: [] });
    const labels = await open();

    expect(labels.slice(labels.indexOf('Open page, form, or URL'), labels.indexOf('Define variables') + 1))
      .toEqual(['Open page, form, or URL', 'Send message to agent', 'Define variables']);

    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await mount(page, withoutMessage());
    expect(await open()).not.toContain('Send message to agent');
  });

  test('sends the message after the click\'s writes, and the agent\'s edit is its own undo step', async ({ page }) => {
    await mount(page, agentBlocks(), { script: [insertCall, endTurn] });

    await summarize(page).click();

    await expect.poll(() => hasAgentParagraph(page)).toBe(true);
    expect((await propertiesOf(page, 'r1'))['p-done']).toBe(true);
    const prompts = await page.evaluate(() => window.agentPrompts);

    // One run: the tool call and the closing answer both start from the button's message.
    expect(prompts).toHaveLength(2);
    expect(new Set(prompts).size).toBe(1);
    expect(String(prompts?.[0])).toContain('Write a one-line summary');
    expect(String(prompts?.[0])).toContain('r1');
    await expect.poll(() => agentStatus(page)).toBe('idle');

    await undo(page);
    await expect.poll(() => hasAgentParagraph(page)).toBe(false);
    expect((await propertiesOf(page, 'r1'))['p-done']).toBe(true);

    await undo(page);
    await expect.poll(async () => (await propertiesOf(page, 'r1'))['p-done']).toBe(false);
  });

  test('a second press while the agent works shows a notice and sends nothing', async ({ page }) => {
    await mount(page, agentBlocks(), { script: [endTurn], hold: true });

    await summarize(page).click();
    await expect.poll(() => agentStatus(page)).toBe('working');
    await summarize(page).click();

    await expect(page.getByTestId('notification-message-text')).toHaveText('AI is busy. Try again when it finishes.');
    await page.evaluate(() => window.agentRelease?.());
    await expect.poll(() => agentStatus(page)).toBe('idle');
    expect(await page.evaluate(() => window.agentPrompts?.length)).toBe(1);
  });
});
