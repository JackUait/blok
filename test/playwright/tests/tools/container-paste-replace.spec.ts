import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Regression suite for the "paste ejection" bug family across EVERY container
 * type (callout, toggle, toggleable-header, table-cell).
 *
 * Shape of the bug this suite guards against:
 *
 *   1. Seed a container whose default child is an empty paragraph.
 *   2. Focus that empty default paragraph.
 *   3. Paste a DIFFERENT tool (e.g. a header block) via the internal
 *      `application/x-blok` clipboard format.
 *   4. Because the receiving block is empty + default, `BlockManager.paste()`
 *      historically called `insert({..., replace: true})`. If the replacement
 *      path didn't preserve `parentId` / `content[]` linkage, the pasted block
 *      got silently re-homed to the editor root — ejected from the container.
 *
 * These tests save the article after the paste and assert that the pasted
 * block still lives INSIDE the container in the flat saved-blocks array (i.e.
 * its `parent` references the container and the container's `content[]`
 * contains its id). They then reload with the saved data and re-assert, so
 * any drift that only surfaces through the Renderer / insertMany round-trip
 * is caught as well.
 */

const HOLDER_ID = 'blok';

interface SavedBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
  parent?: string;
  content?: string[];
}

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

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

const createBlok = async (page: Page, data?: OutputData, extraTools: string[] = []): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder, initialData, tools }) => {
      const config: Record<string, unknown> = {
        holder,
        ...(initialData ? { data: initialData } : {}),
      };

      if (tools.length > 0) {
        // Merge extra tool classes (by static name on BlokWithDefaults) with
        // the fixture's default tools so table-bearing data actually renders.
        const extra: Record<string, { class: unknown }> = {};
        const blokCtor = window.Blok as unknown as Record<string, unknown>;

        tools.forEach((toolName) => {
          const toolClass = blokCtor[toolName];

          extra[toolName.toLowerCase()] = { class: toolClass };
        });
        config.tools = extra;
      }

      const blok = new window.Blok(config);

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data ?? null, tools: extraTools }
  );
};

const saveBlok = async (page: Page): Promise<{ blocks: SavedBlock[] }> => {
  const saved = await page.evaluate(async () => window.blokInstance?.save());

  expect(saved, 'blok.save() returned undefined').toBeDefined();

  return saved as { blocks: SavedBlock[] };
};

/**
 * Dispatch a synthetic paste event on `locator` carrying typed clipboard data.
 * Matches the pattern used by `test/playwright/tests/modules/undo-redo.spec.ts`
 * for `application/x-blok` payloads (the internal Blok clipboard format).
 */
const paste = async (locator: Locator, data: Record<string, string>): Promise<void> => {
  await locator.evaluate((element: HTMLElement, pasteData: Record<string, string>) => {
    const pasteEvent = Object.assign(new Event('paste', {
      bubbles: true,
      cancelable: true,
    }), {
      clipboardData: {
        getData: (type: string): string => pasteData[type] ?? '',
        types: Object.keys(pasteData),
      },
    });

    element.dispatchEvent(pasteEvent);
  }, data);
};

/**
 * Build an `application/x-blok` clipboard payload containing a single header
 * block. Mirrors the shape used in `undo-redo.spec.ts`.
 */
const buildHeaderClipboardPayload = (text: string, level = 2): string => JSON.stringify([
  {
    tool: 'header',
    data: { text, level },
  },
]);

/**
 * Poll the saved-blocks array until a block with the expected text appears.
 * Avoids arbitrary waitForTimeout — reflects the real async paste pipeline.
 */
const waitForSavedBlockText = async (page: Page, expectedText: string): Promise<void> => {
  await expect.poll(
    async () => {
      const saved = await page.evaluate(async () => window.blokInstance?.save());
      const blocks = (saved as { blocks: SavedBlock[] } | undefined)?.blocks ?? [];

      return blocks.some(b => typeof b.data?.text === 'string' && b.data.text.includes(expectedText));
    },
    {
      message: `waiting for a saved block to contain text "${expectedText}"`,
      timeout: 5000,
    }
  ).toBe(true);
};

test.beforeEach(async ({ page }) => {
  await page.goto(TEST_PAGE_URL);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('paste-into-container-child replace=true regression', () => {
  test('pasting a header into a callout child (empty+default) keeps it inside the callout after save and reload', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cal1', type: 'callout', data: { emoji: '💡', color: 'default' }, content: ['body1'] },
        { id: 'body1', type: 'paragraph', data: { text: '' }, parent: 'cal1' },
      ],
    });

    const emptyChild = page.locator('[data-blok-id="body1"] [contenteditable="true"]');

    await expect(emptyChild).toBeVisible();
    await emptyChild.click();

    await paste(emptyChild, {
      'application/x-blok': buildHeaderClipboardPayload('Pasted Header'),
      'text/plain': 'Pasted Header',
    });

    await waitForSavedBlockText(page, 'Pasted Header');

    const saved = await saveBlok(page);

    // The pasted header must still live inside the callout — never at root.
    const callout = saved.blocks.find(b => b.type === 'callout');
    const pastedHeader = saved.blocks.find(b => b.type === 'header' && b.data?.text === 'Pasted Header');

    expect(callout, 'callout block should still exist after paste').toBeDefined();
    expect(pastedHeader, 'pasted header should be present in the saved blocks').toBeDefined();
    expect(pastedHeader?.parent, 'pasted header must be a child of the callout, not ejected to root').toBe(callout?.id);
    expect(callout?.content ?? [], 'callout content[] must reference the pasted header id').toContain(pastedHeader?.id);

    // Top-level (root) should contain exactly the callout and nothing else.
    const rootBlocks = saved.blocks.filter(b => b.parent === undefined || b.parent === null);

    expect(rootBlocks.map(b => b.type), 'root should only contain the callout').toStrictEqual(['callout']);

    // Reload with the saved data — any drift that hides behind insertMany /
    // Renderer round-trip surfaces here.
    await createBlok(page, saved as OutputData);
    const reloaded = await saveBlok(page);

    const reloadedCallout = reloaded.blocks.find(b => b.type === 'callout');
    const reloadedHeader = reloaded.blocks.find(b => b.type === 'header' && b.data?.text === 'Pasted Header');

    expect(reloadedHeader?.parent, 'reloaded header must still be inside the callout').toBe(reloadedCallout?.id);
    expect(reloadedCallout?.content ?? []).toContain(reloadedHeader?.id);

    const reloadedRoot = reloaded.blocks.filter(b => b.parent === undefined || b.parent === null);

    expect(reloadedRoot.map(b => b.type)).toStrictEqual(['callout']);
  });

  test('pasting a header into a toggle child (empty+default) keeps it inside the toggle after save and reload', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'tog1', type: 'toggle', data: { text: 'Toggle title', isOpen: true }, content: ['body1'] },
        { id: 'body1', type: 'paragraph', data: { text: '' }, parent: 'tog1' },
      ],
    });

    const emptyChild = page.locator('[data-blok-id="body1"] [contenteditable="true"]');

    await expect(emptyChild).toBeVisible();
    await emptyChild.click();

    await paste(emptyChild, {
      'application/x-blok': buildHeaderClipboardPayload('Toggle Header'),
      'text/plain': 'Toggle Header',
    });

    await waitForSavedBlockText(page, 'Toggle Header');

    const saved = await saveBlok(page);

    const toggle = saved.blocks.find(b => b.type === 'toggle');
    const pastedHeader = saved.blocks.find(b => b.type === 'header' && b.data?.text === 'Toggle Header');

    expect(toggle, 'toggle block should still exist after paste').toBeDefined();
    expect(pastedHeader, 'pasted header should be present in the saved blocks').toBeDefined();
    expect(pastedHeader?.parent, 'pasted header must be a child of the toggle, not ejected to root').toBe(toggle?.id);
    expect(toggle?.content ?? [], 'toggle content[] must reference the pasted header id').toContain(pastedHeader?.id);

    const rootBlocks = saved.blocks.filter(b => b.parent === undefined || b.parent === null);

    expect(rootBlocks.map(b => b.type), 'root should only contain the toggle').toStrictEqual(['toggle']);

    // Reload cycle.
    await createBlok(page, saved as OutputData);
    const reloaded = await saveBlok(page);

    const reloadedToggle = reloaded.blocks.find(b => b.type === 'toggle');
    const reloadedHeader = reloaded.blocks.find(b => b.type === 'header' && b.data?.text === 'Toggle Header');

    expect(reloadedHeader?.parent, 'reloaded header must still be inside the toggle').toBe(reloadedToggle?.id);
    expect(reloadedToggle?.content ?? []).toContain(reloadedHeader?.id);

    const reloadedRoot = reloaded.blocks.filter(b => b.parent === undefined || b.parent === null);

    expect(reloadedRoot.map(b => b.type)).toStrictEqual(['toggle']);
  });

  test('pasting a header into a toggleable-header child (empty+default) keeps it inside the parent header after save and reload', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          id: 'hdr1',
          type: 'header',
          data: { text: 'Section', level: 2, isToggleable: true, isOpen: true },
          content: ['body1'],
        },
        { id: 'body1', type: 'paragraph', data: { text: '' }, parent: 'hdr1' },
      ],
    });

    const emptyChild = page.locator('[data-blok-id="body1"] [contenteditable="true"]');

    await expect(emptyChild).toBeVisible();
    await emptyChild.click();

    await paste(emptyChild, {
      'application/x-blok': buildHeaderClipboardPayload('Nested Header'),
      'text/plain': 'Nested Header',
    });

    await waitForSavedBlockText(page, 'Nested Header');

    const saved = await saveBlok(page);

    const parentHeader = saved.blocks.find(b => b.type === 'header' && b.data?.text === 'Section');
    const pastedHeader = saved.blocks.find(b => b.type === 'header' && b.data?.text === 'Nested Header');

    expect(parentHeader, 'parent toggleable header should still exist after paste').toBeDefined();
    expect(pastedHeader, 'pasted header should be present in the saved blocks').toBeDefined();
    expect(pastedHeader?.parent, 'pasted header must be a child of the toggleable header, not ejected to root').toBe(parentHeader?.id);
    expect(parentHeader?.content ?? [], 'parent header content[] must reference the pasted header id').toContain(pastedHeader?.id);

    // Only the parent toggleable header should sit at the root. The pasted
    // header must not appear as a root sibling.
    const rootBlocks = saved.blocks.filter(b => b.parent === undefined || b.parent === null);

    expect(rootBlocks, 'only the parent toggleable header should be at root').toHaveLength(1);
    expect(rootBlocks[0]?.id).toBe(parentHeader?.id);

    // Reload cycle.
    await createBlok(page, saved as OutputData);
    const reloaded = await saveBlok(page);

    const reloadedParent = reloaded.blocks.find(b => b.type === 'header' && b.data?.text === 'Section');
    const reloadedPasted = reloaded.blocks.find(b => b.type === 'header' && b.data?.text === 'Nested Header');

    expect(reloadedPasted?.parent, 'reloaded pasted header must still be inside the parent header').toBe(reloadedParent?.id);
    expect(reloadedParent?.content ?? []).toContain(reloadedPasted?.id);

    const reloadedRoot = reloaded.blocks.filter(b => b.parent === undefined || b.parent === null);

    expect(reloadedRoot, 'only the parent toggleable header should be at root after reload').toHaveLength(1);
    expect(reloadedRoot[0]?.id).toBe(reloadedParent?.id);
  });

  test('pasting a paragraph into an empty table cell keeps it inside the table cell after save and reload', async ({ page }) => {
    // Table cells host default paragraph blocks. Pasting into an empty cell
    // paragraph historically triggered the same replace=true path — if the
    // pasted block lost its parent link, it would surface as a root sibling of
    // the table.
    await createBlok(page, {
      blocks: [
        {
          type: 'table',
          data: {
            withHeadings: false,
            withHeadingColumn: false,
            content: [
              ['', 'B1'],
              ['A2', 'B2'],
            ],
          },
        },
      ],
    }, ['Table']);

    const cells = page.locator('[data-blok-table-cell]');

    await expect(cells).toHaveCount(4);

    // eslint-disable-next-line playwright/no-nth-methods -- first() is the clearest way to target cell (0,0)
    const firstCell = cells.first();

    await firstCell.click();

    const firstCellEditable = firstCell.locator('[contenteditable="true"]');

    await expect(firstCellEditable).toBeFocused({ timeout: 2000 });

    // Paste via application/x-blok with a paragraph carrying a unique sentinel
    // — table cells restrict which tools are allowed, so use the canonical
    // paragraph shape to keep this test decoupled from tool allow-lists.
    const payload = JSON.stringify([
      { tool: 'paragraph', data: { text: 'CellPasted' } },
    ]);

    await paste(firstCellEditable, {
      'application/x-blok': payload,
      'text/plain': 'CellPasted',
    });

    await waitForSavedBlockText(page, 'CellPasted');

    const saved = await saveBlok(page);

    const tableBlocks = saved.blocks.filter(b => b.type === 'table');

    expect(tableBlocks, 'exactly one table block should exist after paste').toHaveLength(1);

    const tableBlock = tableBlocks[0];
    const pastedParagraph = saved.blocks.find(
      b => b.type === 'paragraph' && b.data?.text === 'CellPasted'
    );

    expect(pastedParagraph, 'pasted paragraph should be present in the saved blocks').toBeDefined();
    expect(pastedParagraph?.parent, 'pasted paragraph must live inside the table, not at root').toBe(tableBlock.id);
    expect(tableBlock.content ?? [], 'table content[] must reference the pasted paragraph id').toContain(pastedParagraph?.id);

    // Top-level (root) should contain exactly the table — nothing ejected.
    const rootBlocks = saved.blocks.filter(b => b.parent === undefined || b.parent === null);

    expect(rootBlocks.map(b => b.type), 'root should only contain the table').toStrictEqual(['table']);

    // Reload cycle — any drift hidden behind the table's collapseToLegacy /
    // insertMany round-trip is caught here.
    await createBlok(page, saved as OutputData, ['Table']);
    const reloaded = await saveBlok(page);

    const reloadedTable = reloaded.blocks.find(b => b.type === 'table');
    const reloadedPasted = reloaded.blocks.find(
      b => b.type === 'paragraph' && b.data?.text === 'CellPasted'
    );

    expect(reloadedTable, 'table should still exist after reload').toBeDefined();
    expect(reloadedPasted, 'pasted paragraph should still exist after reload').toBeDefined();
    expect(reloadedPasted?.parent, 'reloaded pasted paragraph must still be inside the table').toBe(reloadedTable?.id);
    expect(reloadedTable?.content ?? []).toContain(reloadedPasted?.id);

    const reloadedRoot = reloaded.blocks.filter(b => b.parent === undefined || b.parent === null);

    expect(reloadedRoot.map(b => b.type), 'root should only contain the table after reload').toStrictEqual(['table']);
  });
});
