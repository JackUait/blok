import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Regression suite for the "paste ejection" bug family across the
 * PATTERN-HANDLER path (URL auto-conversion via pattern-handler.ts) and the
 * PLAIN TEXT / HTML path (html-handler.ts -> base.ts insertPasteData).
 *
 * These paths are different from `application/x-blok` (covered in
 * container-paste-replace.spec.ts). This file guards the case where the
 * receiving block is the default empty child of a callout container, and the
 * new block comes in via either a URL pattern match or a plain text/html paste.
 *
 * In either case, the resulting block must stay INSIDE the callout — not get
 * ejected to root.
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

const createBlok = async (page: Page, data?: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder, initialData }) => {
      const config: Record<string, unknown> = {
        holder,
        ...(initialData ? { data: initialData } : {}),
      };

      const blok = new window.Blok(config);

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data ?? null }
  );
};

const saveBlok = async (page: Page): Promise<{ blocks: SavedBlock[] }> => {
  const saved = await page.evaluate(async () => window.blokInstance?.save());

  expect(saved, 'blok.save() returned undefined').toBeDefined();

  return saved as { blocks: SavedBlock[] };
};

/**
 * Dispatch a synthetic paste event carrying typed clipboard data.
 * Matches the pattern used by container-paste-replace.spec.ts.
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
 * Poll the saved-blocks array until a block whose data contains the expected
 * text sentinel appears. Scans every string field in `data` so it catches
 * paragraph.text, link.text, embed.source, etc.
 */
const waitForSavedBlockContaining = async (page: Page, sentinel: string): Promise<void> => {
  await expect.poll(
    async () => {
      const saved = await page.evaluate(async () => window.blokInstance?.save());
      const blocks = (saved as { blocks: SavedBlock[] } | undefined)?.blocks ?? [];

      return blocks.some((b) => {
        if (!b.data) {
          return false;
        }

        return Object.values(b.data).some(
          (v) => typeof v === 'string' && v.includes(sentinel)
        );
      });
    },
    {
      message: `waiting for a saved block to contain "${sentinel}"`,
      timeout: 5000,
    }
  ).toBe(true);
};

test.beforeEach(async ({ page }) => {
  await page.goto(TEST_PAGE_URL);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('paste-into-callout-child pattern/html handlers', () => {
  test('plain text paste into callout child stays inside callout', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cal1', type: 'callout', data: { emoji: '💡', color: 'default' }, content: ['body1'] },
        { id: 'body1', type: 'paragraph', data: { text: '' }, parent: 'cal1' },
      ],
    });

    const emptyChild = page.locator('[data-blok-id="body1"] [contenteditable="true"]');

    await expect(emptyChild).toBeVisible();
    await emptyChild.click();

    // Plain text + HTML payload — NO application/x-blok — so the paste goes
    // through html-handler.ts -> base.ts insertPasteData, not the internal
    // blok clipboard path.
    await paste(emptyChild, {
      'text/plain': 'Pasted plain line',
      'text/html': '<p>Pasted plain line</p>',
    });

    await waitForSavedBlockContaining(page, 'Pasted plain line');

    const saved = await saveBlok(page);

    const callout = saved.blocks.find(b => b.type === 'callout');
    const pasted = saved.blocks.find(
      b => b.data && typeof b.data.text === 'string' && b.data.text.includes('Pasted plain line')
    );

    expect(callout, 'callout block should still exist after paste').toBeDefined();
    expect(pasted, 'pasted block should be present in the saved blocks').toBeDefined();
    expect(pasted?.parent, 'pasted block must be a child of the callout, not ejected to root').toBe(callout?.id);
    expect(callout?.content ?? [], 'callout content[] must reference the pasted block id').toContain(pasted?.id);

    // Top-level (root) should contain exactly the callout and nothing else.
    const rootBlocks = saved.blocks.filter(b => b.parent === undefined || b.parent === null);

    expect(rootBlocks.map(b => b.type), 'root should only contain the callout').toStrictEqual(['callout']);

    // Reload cycle.
    await createBlok(page, saved as OutputData);
    const reloaded = await saveBlok(page);

    const reloadedCallout = reloaded.blocks.find(b => b.type === 'callout');
    const reloadedPasted = reloaded.blocks.find(
      b => b.data && typeof b.data.text === 'string' && b.data.text.includes('Pasted plain line')
    );

    expect(reloadedPasted?.parent, 'reloaded pasted block must still be inside the callout').toBe(reloadedCallout?.id);
    expect(reloadedCallout?.content ?? []).toContain(reloadedPasted?.id);

    const reloadedRoot = reloaded.blocks.filter(b => b.parent === undefined || b.parent === null);

    expect(reloadedRoot.map(b => b.type)).toStrictEqual(['callout']);
  });

  test('URL pattern paste into callout child stays inside callout', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'cal1', type: 'callout', data: { emoji: '💡', color: 'default' }, content: ['body1'] },
        { id: 'body1', type: 'paragraph', data: { text: '' }, parent: 'cal1' },
      ],
    });

    const emptyChild = page.locator('[data-blok-id="body1"] [contenteditable="true"]');

    await expect(emptyChild).toBeVisible();
    await emptyChild.click();

    // URL-only plain text payload — exercises the pattern-handler path. If no
    // URL pattern is registered in the fixture, Blok falls through to plain
    // text handling; either way the resulting block must stay inside the
    // callout.
    await paste(emptyChild, {
      'text/plain': 'https://example.com',
    });

    await waitForSavedBlockContaining(page, 'example.com');

    const saved = await saveBlok(page);

    const callout = saved.blocks.find(b => b.type === 'callout');

    expect(callout, 'callout block should still exist after paste').toBeDefined();

    // Find the block that holds the URL in ANY string field of its data —
    // works whether it becomes a link, embed, or paragraph.
    const pasted = saved.blocks.find((b) => {
      if (!b.data) {
        return false;
      }

      return Object.values(b.data).some(
        (v) => typeof v === 'string' && v.includes('example.com')
      );
    });

    expect(pasted, 'pasted block containing the URL should be present').toBeDefined();
    expect(pasted?.parent, 'pasted block must be a child of the callout, not ejected to root').toBe(callout?.id);
    expect(callout?.content ?? [], 'callout content[] must reference the pasted block id').toContain(pasted?.id);

    // Top-level (root) should contain exactly the callout — nothing ejected.
    const rootBlocks = saved.blocks.filter(b => b.parent === undefined || b.parent === null);

    expect(rootBlocks.map(b => b.type), 'root should only contain the callout').toStrictEqual(['callout']);

    // Reload cycle.
    await createBlok(page, saved as OutputData);
    const reloaded = await saveBlok(page);

    const reloadedCallout = reloaded.blocks.find(b => b.type === 'callout');
    const reloadedPasted = reloaded.blocks.find((b) => {
      if (!b.data) {
        return false;
      }

      return Object.values(b.data).some(
        (v) => typeof v === 'string' && v.includes('example.com')
      );
    });

    expect(reloadedPasted?.parent, 'reloaded pasted block must still be inside the callout').toBe(reloadedCallout?.id);
    expect(reloadedCallout?.content ?? []).toContain(reloadedPasted?.id);

    const reloadedRoot = reloaded.blocks.filter(b => b.parent === undefined || b.parent === null);

    expect(reloadedRoot.map(b => b.type)).toStrictEqual(['callout']);
  });
});
