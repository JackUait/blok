/* eslint-disable playwright/expect-expect -- assertions live in assertPopoverNearCaret helper */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

const HOLDER_ID = 'blok';
const POPOVER_SELECTOR = '[data-blok-testid="toolbox-popover"]';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

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
    container.style.border = '1px dotted #388AE5';
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (
  page: Page,
  data?: OutputData,
  options: { withTable?: boolean } = {}
): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, initialData, withTable }) => {
      const config: Record<string, unknown> = { holder };

      if (initialData) {
        config.data = initialData;
      }

      if (withTable) {
        config.tools = {
          table: { class: (window.Blok as unknown as { Table: unknown }).Table },
        };
      }

      const blok = new window.Blok(config);

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data ?? null, withTable: Boolean(options.withTable) }
  );
};

interface PositionMeasurement {
  pop: { top: number; left: number; w: number; h: number };
  caret: { top: number; left: number; h: number };
}

/**
 * Empty the currently-focused editable element via Select All + Delete.
 * @param page - playwright page
 */
const emptyCurrentEditable = async (page: Page): Promise<void> => {
  const isMac = process.platform === 'darwin';
  const selectAll = isMac ? 'Meta+A' : 'Control+A';

  await page.keyboard.press(selectAll);
  await page.keyboard.press('Delete');
};

/**
 * Measure popover rect and caret rect once the slash menu is open.
 * @param page - playwright page
 */
const measurePositions = async (page: Page): Promise<PositionMeasurement> => {
  return await page.evaluate(() => {
    const popHolder = document.querySelector('[data-blok-testid="toolbox-popover"]');

    if (popHolder === null) {
      throw new Error('Toolbox popover not found');
    }

    const pop = (popHolder.firstElementChild ?? popHolder) as HTMLElement;
    const popRect = pop.getBoundingClientRect();
    const sel = window.getSelection();

    if (sel === null || sel.rangeCount === 0) {
      throw new Error('No selection');
    }

    const range = sel.getRangeAt(0).cloneRange();
    let caretRect = range.getBoundingClientRect();

    /*
     * Collapsed selection in an empty element often yields a 0x0 rect.
     * Fall back to the bounding rect of the closest element container.
     */
    if (caretRect.width === 0 && caretRect.height === 0) {
      const node = range.startContainer;
      const el = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as HTMLElement | null;

      if (el !== null) {
        caretRect = el.getBoundingClientRect();
      }
    }

    return {
      pop: {
        top: popRect.top,
        left: popRect.left,
        w: popRect.width,
        h: popRect.height,
      },
      caret: {
        top: caretRect.top,
        left: caretRect.left,
        h: caretRect.height,
      },
    };
  });
};

const assertPopoverNearCaret = (measurement: PositionMeasurement, scenario: string): void => {
  const caretBottom = measurement.caret.top + measurement.caret.h;
  const verticalDelta = measurement.pop.top - caretBottom;
  const horizontalDelta = measurement.pop.left - measurement.caret.left;

  /*
   * Useful failure diagnostics: print the numbers before asserting.
   */
  console.log(
    `[${scenario}] caret top=${measurement.caret.top.toFixed(1)} `
    + `left=${measurement.caret.left.toFixed(1)} h=${measurement.caret.h.toFixed(1)} | `
    + `popover top=${measurement.pop.top.toFixed(1)} left=${measurement.pop.left.toFixed(1)} `
    + `w=${measurement.pop.w.toFixed(1)} h=${measurement.pop.h.toFixed(1)} | `
    + `dy=${verticalDelta.toFixed(1)} dx=${horizontalDelta.toFixed(1)}`
  );

  expect(
    verticalDelta,
    `[${scenario}] popover.top should be within [caretBottom, caretBottom+50]. `
    + `Actual dy=${verticalDelta.toFixed(1)}`
  ).toBeGreaterThanOrEqual(0);
  expect(
    verticalDelta,
    `[${scenario}] popover.top should be within [caretBottom, caretBottom+50]. `
    + `Actual dy=${verticalDelta.toFixed(1)}`
  ).toBeLessThanOrEqual(50);

  expect(
    Math.abs(horizontalDelta),
    `[${scenario}] popover.left should be within +/-60 of caret.left. `
    + `Actual dx=${horizontalDelta.toFixed(1)}`
  ).toBeLessThanOrEqual(60);
};

const openSlashMenuAndMeasure = async (
  page: Page,
  scenario: string,
  options: { skipEmpty?: boolean } = {}
): Promise<PositionMeasurement> => {
  if (options.skipEmpty !== true) {
    await emptyCurrentEditable(page);
  }
  await page.keyboard.type('/');

  const popover = page.locator(POPOVER_SELECTOR);

  await popover.waitFor({ state: 'attached' });
  await expect(popover, `[${scenario}] slash menu should open`).toHaveAttribute(
    'data-blok-popover-opened',
    'true'
  );

  const measurement = await measurePositions(page);

  assertPopoverNearCaret(measurement, scenario);

  return measurement;
};

test.describe('Toolbox popover position regression', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('top-level empty paragraph: popover is near caret', async ({ page }) => {
    await createBlok(page, {
      blocks: [{ id: 'p-1', type: 'paragraph', data: { text: '' } }],
    });

    const editable = page.locator('[data-blok-id="p-1"] [contenteditable="true"]');

    await editable.click();

    await openSlashMenuAndMeasure(page, 'top-level paragraph');
  });

  test('empty table cell: popover is near caret', async ({ page }) => {
    await createBlok(
      page,
      {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: false,
              content: [['', '']],
            },
          },
        ],
      },
      { withTable: true }
    );

    const firstCell = page.locator('[data-blok-table-cell]:nth-child(1)');

    await expect(firstCell).toBeVisible();
    await firstCell.click();

    await openSlashMenuAndMeasure(page, 'empty table cell', { skipEmpty: true });
  });

  test('3-column table, right-most cell: popover is near caret, not table left edge', async ({ page }) => {
    await createBlok(
      page,
      {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: true,
              content: [
                ['Feature', 'Status', 'Notes'],
                ['Grid rendering', 'Complete', 'Supports any size'],
              ],
            },
          },
        ],
      },
      { withTable: true }
    );

    const rightMostCell = page.locator('[data-blok-table-cell]').filter({ hasText: 'Supports any size' });

    await expect(rightMostCell).toBeVisible();
    await rightMostCell.click();

    await openSlashMenuAndMeasure(page, 'wide table right cell');
  });

  test('empty child inside toggle: popover is near caret', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          id: 'toggle-1',
          type: 'toggle',
          data: { text: 'My toggle', isOpen: true },
          content: ['child-1'],
        } as unknown as Record<string, unknown>,
        {
          id: 'child-1',
          type: 'paragraph',
          data: { text: '' },
          parent: 'toggle-1',
        } as unknown as Record<string, unknown>,
      ] as unknown as OutputData['blocks'],
    });

    const childEditable = page.locator('[data-blok-id="child-1"] [contenteditable="true"]');

    await expect(childEditable).toBeVisible();
    await childEditable.click();

    await openSlashMenuAndMeasure(page, 'toggle nested child');
  });

  test('empty child inside callout: popover is near caret', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'callout-1', type: 'callout', data: { emoji: '💡', color: 'default' } },
      ],
    });

    const childEditable = page
      .locator('[data-blok-id="callout-1"] [data-blok-toggle-children] [data-blok-component="paragraph"] [contenteditable="true"]');

    await expect(childEditable).toBeVisible();
    await childEditable.click();

    await openSlashMenuAndMeasure(page, 'callout nested child');
  });

  test('empty quote block: popover is near caret', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'q-1', type: 'quote', data: { text: '', size: 'default' } },
      ],
    });

    const quoteEditable = page.locator('[data-blok-id="q-1"] [contenteditable="true"]');

    await expect(quoteEditable).toBeVisible();
    await quoteEditable.click();

    await openSlashMenuAndMeasure(page, 'quote block');
  });

  test('4-column table, right-most cell: popover near caret even in wider table', async ({ page }) => {
    await createBlok(
      page,
      {
        blocks: [
          {
            type: 'table',
            data: {
              withHeadings: true,
              content: [
                ['A long header', 'Another header', 'Third column', 'Last column'],
                ['Row value one', 'Row value two', 'Row value three', 'Row value four'],
              ],
            },
          },
        ],
      },
      { withTable: true }
    );

    const rightCell = page.locator('[data-blok-table-cell]').filter({ hasText: 'Row value four' });

    await expect(rightCell).toBeVisible();
    await rightCell.click();

    await openSlashMenuAndMeasure(page, '4-col table right cell');
  });

  test('plus button open on empty paragraph: popover aligned with block content, not holder edge', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'plus-p', type: 'paragraph', data: { text: '' } },
      ],
    });

    const editable = page.locator('[data-blok-id="plus-p"] [contenteditable="true"]');

    await editable.click();

    const plusButton = page.locator('[data-blok-testid="plus-button"]');

    await expect(plusButton).toBeVisible();
    await plusButton.click();

    const popover = page.locator(POPOVER_SELECTOR);

    await popover.waitFor({ state: 'attached' });
    await expect(popover).toHaveAttribute('data-blok-popover-opened', 'true');

    /*
     * For plus-button open, anchor is the block rect, not caret. Verify the
     * popover sits below the block and horizontally aligned with the block's
     * visible CONTENT element (not the outer holder). The block holder often
     * spans the full editor width while the content is centered/narrower
     * (default max-width: var(--max-width-content)). Anchoring the popover
     * to holder.left made it render at the viewport's left edge, far from
     * the plus button and visible content.
     */
    const measurement = await page.evaluate(() => {
      const popHolder = document.querySelector('[data-blok-testid="toolbox-popover"]');

      if (popHolder === null) {
        throw new Error('Toolbox popover not found');
      }

      const pop = (popHolder.firstElementChild ?? popHolder) as HTMLElement;
      const block = document.querySelector('[data-blok-id="plus-p"]');

      if (block === null) {
        throw new Error('Block not found');
      }

      const content = block.querySelector('[data-blok-element-content]');

      if (content === null) {
        throw new Error('Block content element not found');
      }

      const plusBtn = document.querySelector('[data-blok-testid="plus-button"]');

      if (plusBtn === null) {
        throw new Error('Plus button not found');
      }

      return {
        pop: pop.getBoundingClientRect(),
        block: block.getBoundingClientRect(),
        content: content.getBoundingClientRect(),
        plus: plusBtn.getBoundingClientRect(),
      };
    });

    console.log(
      `[plus-button] holder=${measurement.block.left.toFixed(1)}..${measurement.block.right.toFixed(1)} `
      + `content=${measurement.content.left.toFixed(1)}..${measurement.content.right.toFixed(1)} `
      + `plus=${measurement.plus.left.toFixed(1)} pop=${measurement.pop.left.toFixed(1)}`
    );
    expect(measurement.pop.top).toBeGreaterThanOrEqual(measurement.block.bottom - 4);
    expect(measurement.pop.top).toBeLessThanOrEqual(measurement.block.bottom + 50);
    // Plus-button popover must align with the block's CONTENT column, not the
    // outer holder. When these diverge (holder wider than content), anchoring
    // at holder.left drifts the popover hundreds of pixels off the visible area.
    expect(
      Math.abs(measurement.pop.left - measurement.content.left),
      `popover.left=${measurement.pop.left.toFixed(1)} should align with `
      + `content.left=${measurement.content.left.toFixed(1)}; `
      + `holder.left=${measurement.block.left.toFixed(1)}, plus.left=${measurement.plus.left.toFixed(1)}`
    ).toBeLessThanOrEqual(20);
    // Additional safety: popover must not drift far-left of the plus button.
    expect(
      measurement.plus.left - measurement.pop.left,
      `popover.left should not be more than 60px left of plus button`
    ).toBeLessThanOrEqual(60);
  });

  test('plus button open in wide holder: popover aligned with content, not holder edge', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'wide-p', type: 'paragraph', data: { text: '' } },
      ],
    });

    /*
     * Force the holder to be wider than content (as in the real playground
     * where the editor fills the viewport but the block content is capped at
     * 720px). Without this divergence the bug hides because holder.left ===
     * content.left. This layout matches the user-reported scenario.
     */
    await page.evaluate(() => {
      const holder = document.getElementById('blok');

      if (holder !== null) {
        holder.style.width = '1400px';
        holder.style.maxWidth = 'none';
      }

      /*
       * Default Blok rendering sets `mx-auto` + max-width on the content
       * element, centering it inside the wrapper. The minimal test fixture
       * anchors content to the left, so the bug cannot manifest. Inject an
       * explicit stylesheet that forces centering to match real layouts.
       */
      const style = document.createElement('style');

      style.textContent = `
        [data-blok-element-content] {
          margin-left: auto !important;
          margin-right: auto !important;
          max-width: 720px !important;
        }
      `;
      document.head.appendChild(style);
    });

    const editable = page.locator('[data-blok-id="wide-p"] [contenteditable="true"]');

    await editable.click();

    const plusButton = page.locator('[data-blok-testid="plus-button"]');

    await expect(plusButton).toBeVisible();
    await plusButton.click();

    const popover = page.locator(POPOVER_SELECTOR);

    await popover.waitFor({ state: 'attached' });
    await expect(popover).toHaveAttribute('data-blok-popover-opened', 'true');

    const measurement = await page.evaluate(() => {
      const popHolder = document.querySelector('[data-blok-testid="toolbox-popover"]');

      if (popHolder === null) {
        throw new Error('Toolbox popover not found');
      }

      const pop = (popHolder.firstElementChild ?? popHolder) as HTMLElement;
      const block = document.querySelector('[data-blok-id="wide-p"]');

      if (block === null) {
        throw new Error('Block not found');
      }

      const content = block.querySelector('[data-blok-element-content]');

      if (content === null) {
        throw new Error('Block content element not found');
      }

      const plusBtn = document.querySelector('[data-blok-testid="plus-button"]');

      if (plusBtn === null) {
        throw new Error('Plus button not found');
      }

      return {
        pop: pop.getBoundingClientRect(),
        block: block.getBoundingClientRect(),
        content: content.getBoundingClientRect(),
        plus: plusBtn.getBoundingClientRect(),
      };
    });

    console.log(
      `[wide-holder] holder=${measurement.block.left.toFixed(1)}..${measurement.block.right.toFixed(1)} `
      + `content=${measurement.content.left.toFixed(1)}..${measurement.content.right.toFixed(1)} `
      + `plus=${measurement.plus.left.toFixed(1)} pop=${measurement.pop.left.toFixed(1)}`
    );

    // Fixture must actually diverge holder vs content to exercise the bug.
    expect(
      measurement.content.left - measurement.block.left,
      'wide-holder setup failed: holder and content share the same left edge'
    ).toBeGreaterThan(50);

    expect(measurement.pop.top).toBeGreaterThanOrEqual(measurement.block.bottom - 4);
    expect(measurement.pop.top).toBeLessThanOrEqual(measurement.block.bottom + 50);
    // CRITICAL: popover must NOT snap to the holder's left edge. It must align
    // with the visible content column.
    expect(
      Math.abs(measurement.pop.left - measurement.content.left),
      `popover.left=${measurement.pop.left.toFixed(1)} should align with `
      + `content.left=${measurement.content.left.toFixed(1)}; `
      + `holder.left=${measurement.block.left.toFixed(1)}, plus.left=${measurement.plus.left.toFixed(1)}`
    ).toBeLessThanOrEqual(20);
    expect(
      measurement.plus.left - measurement.pop.left,
      `popover.left should not be more than 60px left of plus button`
    ).toBeLessThanOrEqual(60);
  });

  test('new empty paragraph after a long wrapped paragraph: popover is near caret', async ({ page }) => {
    const longText = (
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '
      + 'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '
      + 'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi '
      + 'ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit '
      + 'in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur '
      + 'sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt.'
    ).repeat(2);

    await createBlok(page, {
      blocks: [
        { id: 'long-1', type: 'paragraph', data: { text: longText } },
        { id: 'empty-1', type: 'paragraph', data: { text: '' } },
      ],
    });

    const emptyEditable = page.locator('[data-blok-id="empty-1"] [contenteditable="true"]');

    await expect(emptyEditable).toBeVisible();
    await emptyEditable.click();

    await openSlashMenuAndMeasure(page, 'empty paragraph after long wrapped text');
  });
});
