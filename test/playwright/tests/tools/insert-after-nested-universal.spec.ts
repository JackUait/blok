import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

const HOLDER_ID = 'blok';

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
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (
  page: Page,
  data?: OutputData,
  extraToolNames: string[] = []
): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder, initialData, extras }) => {
      const extraTools: Record<string, unknown> = {};

      for (const name of extras) {
        const cls = (window.Blok as unknown as Record<string, unknown>)[
          name.charAt(0).toUpperCase() + name.slice(1)
        ];

        if (cls === undefined) {
          throw new Error(`tool class ${name} not exposed on window.Blok`);
        }
        extraTools[name] = { class: cls, inlineToolbar: true };
      }
      const blok = new window.Blok({
        holder,
        ...(initialData ? { data: initialData } : {}),
        ...(Object.keys(extraTools).length > 0 ? { tools: extraTools } : {}),
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data ?? null, extras: extraToolNames }
  );
};

test.beforeEach(async ({ page }) => {
  await page.goto(TEST_PAGE_URL);
});

/**
 * Universal regression suite for the "Enter-after-callout" bug class.
 *
 * The original bug: pressing Enter at offset 0 of a top-level block that follows
 * a nesting block (Callout, Toggle, Header-toggleable, etc.) would insert the
 * new block INSIDE the predecessor's nested container — DOM/data desync.
 *
 * Root cause: `Blocks.insert()` used `insertAdjacentElement('afterend',
 * previousBlock)`. When the flat-array predecessor is the auto-child of a
 * nesting block, "afterend previous" lands inside the nested container.
 *
 * Universal fix: `Blocks.insert()` now prefers `beforebegin nextBlock` over
 * `afterend previousBlock`. Anchoring on the FOLLOWING block makes the DOM
 * placement match the caller's intended sibling context, regardless of which
 * insertion path (Enter, paste, slash menu, plus button, markdown shortcut,
 * conversion, split, public API, drag, yjs-sync) called insert and regardless
 * of which nesting block type holds the predecessor.
 *
 * These tests assert the universal property by exercising every insertion path
 * × every nesting block type combination. If any future change reintroduces the
 * "trust-the-predecessor" anti-pattern, ALL of these tests fail loudly.
 */

type NestingScenario = {
  label: string;
  build: (text: string) => OutputData;
  // CSS selector that matches the auto-created nested child of the nesting block.
  nestedChildSelector: string;
  // Tool class names to register beyond the default set (e.g. 'table').
  extraTools?: string[];
};

const NESTING_SCENARIOS: NestingScenario[] = [
  {
    label: 'callout',
    nestedChildSelector: '[data-blok-component="callout"] [data-blok-toggle-children] [data-blok-component="paragraph"]',
    build: (text) => ({
      blocks: [
        { id: 'parent-1', type: 'callout', data: { emoji: '💡', color: 'default' } },
        { id: 'follower-1', type: 'paragraph', data: { text } },
      ],
    }),
  },
  {
    label: 'toggle',
    nestedChildSelector: '[data-blok-component="toggle"] [data-blok-toggle-children] [data-blok-component="paragraph"]',
    build: (text) => ({
      blocks: [
        { id: 'parent-1', type: 'toggle', data: { text: 'A toggle', isOpen: true }, contentIds: ['toggle-child-1'] },
        { id: 'toggle-child-1', type: 'paragraph', data: { text: 'inside toggle' }, parent: 'parent-1' },
        { id: 'follower-1', type: 'paragraph', data: { text } },
      ],
    }),
  },
  {
    label: 'header-toggleable',
    nestedChildSelector: '[data-blok-component="header"] [data-blok-toggle-children] [data-blok-component="paragraph"]',
    build: (text) => ({
      blocks: [
        {
          id: 'parent-1',
          type: 'header',
          data: { text: 'A toggleable heading', level: 2, isToggleable: true, isOpen: true },
          contentIds: ['header-child-1'],
        },
        { id: 'header-child-1', type: 'paragraph', data: { text: 'inside header' }, parent: 'parent-1' },
        { id: 'follower-1', type: 'paragraph', data: { text } },
      ],
    }),
  },
  {
    label: 'table',
    extraTools: ['table'],
    nestedChildSelector: '[data-blok-tool="table"] [data-blok-nested-blocks] [data-blok-component="paragraph"]',
    build: (text) => {
      const cellWith = (t: string): { blocks: Array<{ type: string; data: { text: string } }> } => ({
        blocks: [{ type: 'paragraph', data: { text: t } }],
      });

      return {
        blocks: [
          {
            id: 'parent-1',
            type: 'table',
            data: {
              withHeadings: false,
              content: [
                [cellWith('a'), cellWith('b')],
                [cellWith('c'), cellWith('d')],
              ],
            },
          },
          { id: 'follower-1', type: 'paragraph', data: { text } },
        ],
      };
    },
  },
];

const placeCaretAtStart = async (page: Page, blokId: string): Promise<void> => {
  await page.evaluate((id) => {
    const editable = document.querySelector<HTMLElement>(`[data-blok-id="${id}"] [contenteditable="true"]`);

    if (editable === null) {
      throw new Error(`editable not found for ${id}`);
    }
    editable.focus();
    const range = document.createRange();

    range.setStart(editable.firstChild ?? editable, 0);
    range.collapse(true);
    const sel = window.getSelection();

    sel?.removeAllRanges();
    sel?.addRange(range);
  }, blokId);
};

const captureBlockIds = async (page: Page): Promise<Set<string>> => {
  const ids = await page.evaluate(() => {
    return Array.from(document.querySelectorAll<HTMLElement>('[data-blok-id]'))
      .map((el) => el.dataset.blokId ?? '');
  });

  return new Set(ids);
};

/**
 * Check whether any block created AFTER the snapshot landed inside a
 * nested-blocks container. The snapshot lets us ignore pre-existing
 * auto-children of the nesting block (callout creates its own paragraph
 * child during render).
 */
const newBlockEscapedNestedContainer = async (page: Page, before: Set<string>): Promise<boolean> => {
  const beforeArray = Array.from(before);

  return page.evaluate((beforeIds) => {
    const known = new Set(beforeIds);
    const allBlocks = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-id]'));

    for (const el of allBlocks) {
      const id = el.dataset.blokId ?? '';

      if (known.has(id)) {
        continue;
      }
      // New block created after snapshot. If it is inside any nested-blocks
      // container it leaked from the user's intended top-level position.
      if (el.closest('[data-blok-nested-blocks]') !== null) {
        return true;
      }
    }

    return false;
  }, beforeArray);
};

for (const scenario of NESTING_SCENARIOS) {
  test.describe(`new block after ${scenario.label}'s auto-child must not leak into nested container`, () => {
    test(`Enter at offset 0 of follower paragraph (${scenario.label})`, async ({ page }) => {
      await createBlok(page, scenario.build('outside'), scenario.extraTools);
      await expect(page.locator(scenario.nestedChildSelector)).toBeVisible();

      const before = await captureBlockIds(page);

      await placeCaretAtStart(page, 'follower-1');
      await page.keyboard.press('Enter');

      expect(await newBlockEscapedNestedContainer(page, before)).toBe(false);
    });

    test(`paste plain text at offset 0 of follower paragraph (${scenario.label})`, async ({ page }) => {
      await createBlok(page, scenario.build('outside'), scenario.extraTools);
      await expect(page.locator(scenario.nestedChildSelector)).toBeVisible();

      const before = await captureBlockIds(page);

      await placeCaretAtStart(page, 'follower-1');

      // Simulate a paste event that creates a new block above follower-1 via the
      // Blok paste pipeline. We use a multi-line plain text payload so the paste
      // handler creates a separate paragraph block.
      await page.evaluate(() => {
        const editable = document.querySelector<HTMLElement>('[data-blok-id="follower-1"] [contenteditable="true"]');

        if (editable === null) {
          throw new Error('follower editable not found');
        }
        const data = new DataTransfer();

        data.setData('text/plain', 'pasted line one\npasted line two');
        editable.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }));
      });

      // Wait for the paste pipeline to produce at least one new block
      await page.waitForFunction(
        (n) => document.querySelectorAll('[data-blok-id]').length > n,
        before.size
      );

      expect(await newBlockEscapedNestedContainer(page, before)).toBe(false);
    });

    test(`programmatic api insert top-level block above follower (${scenario.label})`, async ({ page }) => {
      await createBlok(page, scenario.build('outside'), scenario.extraTools);
      await expect(page.locator(scenario.nestedChildSelector)).toBeVisible();

      const before = await captureBlockIds(page);

      // Resolve the flat index of follower-1 and insert a new top-level block at
      // that index via the public API. This mirrors what plus button, slash menu,
      // markdown shortcuts, and any third-party plugin would do.
      await page.evaluate(() => {
        const blok = window.blokInstance;

        if (blok === undefined) {
          throw new Error('blok not ready');
        }
        const api = (blok as unknown as {
          blocks: {
            getBlockIndex: (id: string) => number;
            insert: (
              type?: string,
              data?: Record<string, unknown>,
              config?: Record<string, unknown>,
              index?: number
            ) => void;
          };
        }).blocks;
        const followerIndex = api.getBlockIndex('follower-1');

        api.insert('paragraph', { text: 'inserted via api' }, {}, followerIndex);
      });

      await page.waitForFunction(
        (n) => document.querySelectorAll('[data-blok-id]').length > n,
        before.size
      );

      expect(await newBlockEscapedNestedContainer(page, before)).toBe(false);
    });
  });
}
