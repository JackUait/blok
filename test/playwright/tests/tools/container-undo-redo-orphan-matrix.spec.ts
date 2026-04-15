/* eslint-disable playwright/no-nth-methods */
/**
 * Universal regression matrix: rapid undo/redo on any block that owns child
 * blocks via parentId must NEVER introduce new top-level blocks.
 *
 * This is the generalized form of the table-undo-redo-orphans regression.
 * Locking the invariant across every container tool ensures the same class
 * of CRDT divergence bug can never re-emerge for table, toggle, callout, or
 * database — or for any future container tool — without a failing test.
 *
 * Each fixture in MATRIX seeds the document with
 *   [paragraph, <container>, paragraph]
 * where `<container>` owns at least one inner editable block. The test types
 * a character into that editable, then paces undo/redo beyond the Yjs
 * capture window (500ms) so each press is a distinct operation. After the
 * storm, the set of top-level block ids must be identical to the initial set
 * and the two outer paragraphs must keep their original ids.
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

const HOLDER_ID = 'blok';
const UNDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
const PRESS_GAP_MS = 600;
const CYCLES = 12;

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type BlockSummary = {
  id: string;
  type: string;
  text: string | undefined;
  parentId: string | null | undefined;
};

type ContainerFixture = {
  /** Human-readable label — shows up in test name. */
  name: string;
  /** Tool class names to register on the Blok constructor. */
  toolsNeeded: ReadonlyArray<'table' | 'toggle' | 'callout' | 'database' | 'database-row'>;
  /** Document to seed the editor with. */
  data: OutputData;
  /** Locator for the editable element the test types into. */
  editable: (page: Page) => ReturnType<Page['locator']>;
};

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (
  page: Page,
  data: OutputData,
  toolsNeeded: ContainerFixture['toolsNeeded']
): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(async ({ holder, initialData, neededTools }) => {
    const w = window as unknown as Record<string, unknown> & {
      Blok: { Table?: unknown };
    };
    const classByName: Record<string, unknown> = {
      table: w.Blok?.Table,
      toggle: w.BlokToggle,
      callout: w.BlokCallout,
      database: w.BlokDatabase,
      'database-row': w.BlokDatabaseRow,
    };

    const tools: Record<string, { class: unknown }> = {};

    for (const name of neededTools) {
      const cls = classByName[name];

      if (cls !== undefined) {
        tools[name] = { class: cls };
      }
    }

    const blok = new window.Blok({
      holder,
      data: initialData,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
    } as ConstructorParameters<typeof window.Blok>[0]);

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialData: data, neededTools: [...toolsNeeded] });
};

const saveBlok = async (page: Page): Promise<OutputData> => {
  return await page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    return await window.blokInstance.save();
  });
};

const waitForDelay = async (page: Page, delayMs: number): Promise<void> => {
  await page.evaluate(
    async (timeout) => {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, timeout);
      });
    },
    delayMs
  );
};

const summarizeBlocks = async (page: Page): Promise<BlockSummary[]> => {
  const saved = await saveBlok(page);

  return page.evaluate((ids) => {
    const instance = window.blokInstance;

    if (!instance) {
      throw new Error('Blok instance not found');
    }

    type BlocksApi = {
      getById?: (id: string) => { id: string; name: string; parentId: string | null } | null;
    };
    const blocksApi = (instance as unknown as { blocks: BlocksApi }).blocks;

    return ids.map(({ id, type, text }) => {
      const live = blocksApi.getById?.(id);

      return {
        id,
        type,
        text,
        parentId: live?.parentId ?? null,
      };
    });
  }, saved.blocks.map(b => ({
    id: b.id ?? '',
    type: b.type ?? '',
    text: typeof (b.data as { text?: unknown })?.text === 'string'
      ? (b.data as { text: string }).text
      : undefined,
  })));
};

const isTopLevel = (b: BlockSummary): boolean =>
  b.parentId === null || b.parentId === undefined || b.parentId === '';

const MATRIX: ReadonlyArray<ContainerFixture> = [
  {
    name: 'table',
    toolsNeeded: ['table'],
    data: {
      blocks: [
        { type: 'paragraph', data: { text: 'OUTER1' } },
        {
          type: 'table',
          data: {
            withHeadings: false,
            content: [['A', 'B'], ['C', 'D']],
          },
        },
        { type: 'paragraph', data: { text: 'OUTER2' } },
      ],
    },
    editable: (page) => page.locator('[data-blok-table-cell] [contenteditable="true"]').first(),
  },
  {
    name: 'toggle',
    toolsNeeded: ['toggle'],
    data: {
      blocks: [
        { id: 'outer-1', type: 'paragraph', data: { text: 'OUTER1' } },
        {
          id: 'tog-1',
          type: 'toggle',
          data: { text: 'Toggle summary', isOpen: true },
          content: ['tog-child'],
        },
        {
          id: 'tog-child',
          type: 'paragraph',
          data: { text: 'inside toggle' },
          parent: 'tog-1',
        },
        { id: 'outer-2', type: 'paragraph', data: { text: 'OUTER2' } },
      ],
    },
    editable: (page) =>
      page
        .locator('[data-blok-id="tog-child"] [contenteditable="true"]')
        .first(),
  },
  {
    name: 'callout',
    toolsNeeded: ['callout'],
    data: {
      blocks: [
        { id: 'outer-1', type: 'paragraph', data: { text: 'OUTER1' } },
        {
          id: 'cal-1',
          type: 'callout',
          data: { emoji: '💡', textColor: null, backgroundColor: null },
          content: ['cal-child'],
        },
        {
          id: 'cal-child',
          type: 'paragraph',
          data: { text: 'inside callout' },
          parent: 'cal-1',
        },
        { id: 'outer-2', type: 'paragraph', data: { text: 'OUTER2' } },
      ],
    },
    editable: (page) =>
      page
        .locator('[data-blok-id="cal-child"] [contenteditable="true"]')
        .first(),
  },
];

test.describe('Container undo/redo orphan invariant matrix', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  for (const fixture of MATRIX) {
    // Paced undo/redo cycles exceed the default 15s test budget.
    test.describe(fixture.name, () => {
      test.setTimeout(60000);

      test(`${fixture.name}: rapid undo/redo never adds top-level blocks or mutates outer paragraphs`, async ({ page }) => {
        await createBlok(page, fixture.data, fixture.toolsNeeded);
        await waitForDelay(page, 400);

        const initial = await summarizeBlocks(page);
        const initialTopLevelIds = new Set(initial.filter(isTopLevel).map(b => b.id));
        const initialOuter1 = initial.find(b => b.text === 'OUTER1');
        const initialOuter2 = initial.find(b => b.text === 'OUTER2');

        expect(initial.filter(b => b.text === 'OUTER1')).toHaveLength(1);
        expect(initial.filter(b => b.text === 'OUTER2')).toHaveLength(1);

        const editable = fixture.editable(page);

        await editable.click();
        await page.keyboard.type('X');
        await waitForDelay(page, 700);

        for (let i = 0; i < CYCLES; i++) {
          await page.keyboard.press(UNDO_SHORTCUT);
          await waitForDelay(page, PRESS_GAP_MS);
          await page.keyboard.press(REDO_SHORTCUT);
          await waitForDelay(page, PRESS_GAP_MS);
        }
        await waitForDelay(page, 800);

        const after = await summarizeBlocks(page);

        const newTopLevel = after.filter(b => isTopLevel(b) && !initialTopLevelIds.has(b.id));

        expect(
          newTopLevel,
          `[${fixture.name}] unexpected new top-level blocks appeared after undo/redo: ${JSON.stringify(newTopLevel)}`
        ).toStrictEqual([]);

        const outer1AfterAll = after.filter(b => b.text === 'OUTER1');
        const outer2AfterAll = after.filter(b => b.text === 'OUTER2');

        expect(outer1AfterAll, `[${fixture.name}] OUTER1`).toHaveLength(1);
        expect(outer2AfterAll, `[${fixture.name}] OUTER2`).toHaveLength(1);
        expect(outer1AfterAll[0]?.id).toBe(initialOuter1?.id);
        expect(outer2AfterAll[0]?.id).toBe(initialOuter2?.id);
      });
    });
  }
});
