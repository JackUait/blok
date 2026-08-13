/**
 * Named ARIA contracts for individual product surfaces.
 *
 * Companion to tools-axe.spec.ts: that spec scans tool subtrees for whatever
 * axe reports, this one asserts specific contracts on controls axe cannot
 * judge at all — a roleless `<div>` acting as a switch, or a heading row that
 * is a heading only in CSS, produces zero axe violations while being unusable.
 *
 * Every assertion here states the CORRECT behaviour. A `test.fixme` marks a
 * contract the shipped code does not meet yet; the body is the specification
 * of the fix, not a description of today's DOM. Un-fixme as each is fixed.
 *
 * A scoped axe scan whose `include` matches nothing passes vacuously, so every
 * scan is preceded by a presence assertion on the same subtree.
 */
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { formatViolations, runA11yScan } from '../helpers/a11y';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';

const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
const FILE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="file"]`;
const REDACTOR_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-redactor]`;
const TAB_BAR_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-database-tab-bar]`;
const BLOCK_TUNES_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const SETTINGS_TOGGLER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;

const ORIGIN = 'http://localhost:4444';
const SAMPLE_IMAGE_URL = `${ORIGIN}/test/playwright/fixtures/image/shot.png`;
const SAMPLE_VIDEO_URL = `${ORIGIN}/public/samples/big-buck-bunny.mp4`;
const SAMPLE_FILE_URL = `${ORIGIN}/public/samples/release-notes.txt`;

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

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (
  page: Page,
  options: { data?: OutputData; config?: Record<string, unknown> } = {}
): Promise<void> => {
  const { data = null, config = {} } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, initialData, config: providedConfig }) => {
      const blokConfig: Record<string, unknown> = {
        holder,
        autofocus: true,
        ...providedConfig,
      };

      if (initialData) {
        blokConfig.data = initialData;
      }

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      initialData: data,
      config,
    }
  );
};

/**
 * Run axe over a subtree and return only the findings of one rule, plus axe's
 * own rendering of them. Keeps a failure message pointed at the single contract
 * under test instead of every unrelated violation the subtree happens to carry.
 */
const violationsOfRule = async (
  page: Page,
  ruleId: string,
  include: string
): Promise<{ ids: string[]; detail: string }> => {
  const violations = await runA11yScan(page, { include });
  const matching = violations.filter((violation) => violation.id === ruleId);

  return {
    ids: matching.map((violation) => violation.id),
    detail: `${ruleId} in ${include}:\n${formatViolations(matching)}`,
  };
};

const tableData = (withHeadings: boolean): OutputData => ({
  blocks: [
    {
      type: 'table',
      data: {
        withHeadings,
        content: [['Name', 'Value'], ['foo', 'bar']],
      },
    },
  ],
});

const getCell = (page: Page, row: number, col: number): ReturnType<Page['locator']> =>
  page.locator(`[data-blok-table-cell-row="${row}"][data-blok-table-cell-col="${col}"]`);

/** Click a cell in `row` so its grip renders, then open the grip's menu. */
const openRowGripMenu = async (page: Page, row: number): Promise<void> => {
  await getCell(page, row, 0).click();

  const grip = page.locator(`[data-blok-table-grip-row="${row}"]`);

  await expect(grip).toBeVisible();
  await grip.click();
};

/**
 * Park the pointer within the table's proximity band for the add-row /
 * add-column affordance (40px of the matching edge).
 */
const hoverTableEdge = async (page: Page, edge: 'bottom' | 'right'): Promise<void> => {
  const box = await page.locator(TABLE_SELECTOR).boundingBox();

  expect(box, 'table should have a bounding box').toBeTruthy();

  const rect = box ?? { x: 0, y: 0, width: 0, height: 0 };

  await page.mouse.move(
    edge === 'right' ? rect.x + rect.width - 10 : rect.x + rect.width / 2,
    edge === 'right' ? rect.y + rect.height / 2 : rect.y + rect.height - 10
  );
};

/** Open the block ☰ menu for the first block, then hover its "Color" entry. */
const openBlockColorPicker = async (page: Page): Promise<void> => {
  const block = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`).first();

  await block.click();
  await block.hover();

  const settingsButton = page.locator(SETTINGS_TOGGLER_SELECTOR);

  await expect(settingsButton).toBeVisible();
  await settingsButton.click();

  const colorEntry = page.locator(`${BLOCK_TUNES_SELECTOR} [data-blok-item-name="block-color"]`);

  await expect(colorEntry).toBeVisible();
  await colorEntry.dispatchEvent('mouseover');
};

const databaseData = (): OutputData => ({
  blocks: [
    {
      id: 'db-1',
      type: 'database',
      data: {
        title: 'Tasks',
        schema: [
          { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
          {
            id: 'prop-status',
            name: 'Status',
            type: 'select',
            position: 'a1',
            config: { options: [{ id: 'opt-todo', label: 'Todo', color: 'gray', position: 'a0' }] },
          },
        ],
        views: [
          { id: 'view-1', name: 'Board', type: 'board', position: 'a0', groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: ['prop-title'] },
          { id: 'view-2', name: 'Table', type: 'table', position: 'a1', sorts: [], filters: [], visibleProperties: ['prop-title'] },
        ],
        activeViewId: 'view-1',
      },
      content: [],
    },
  ],
});

/**
 * Dispatch a synthetic `copy` on `locator` and return the flavours the editor
 * writes. The editor's copy handler builds its HTML flavour from the block
 * tree, so this is the only way to reach the export markup from a test.
 */
const copyFrom = async (locator: ReturnType<Page['locator']>): Promise<Record<string, string>> =>
  locator.evaluate((element) =>
    new Promise<Record<string, string>>((resolve) => {
      const store: Record<string, string> = {};
      const dataTransfer = new DataTransfer();
      const originalSetData = dataTransfer.setData.bind(dataTransfer);

      dataTransfer.setData = (format: string, data: string): void => {
        store[format] = data;
        originalSetData(format, data);
      };

      const event = new ClipboardEvent('copy', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      });

      if (event.clipboardData !== dataTransfer) {
        Object.defineProperty(event, 'clipboardData', {
          value: dataTransfer,
          writable: false,
          configurable: true,
        });
      }

      element.dispatchEvent(event);

      setTimeout(() => resolve(store), 0);
    })
  );

test.describe('semantic contracts', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test.describe('table', () => {
    // Defect 1: table-core.ts builds every cell as <td>; withHeadings only
    // paints data-blok-table-heading, so header semantics are CSS-only.
    test('a table with withHeadings exposes its first row as column headers', async ({ page }) => {
      await createBlok(page, { data: tableData(true) });

      const table = page.locator(TABLE_SELECTOR).getByRole('table');

      await expect(table).toBeVisible();
      await expect(table.getByRole('columnheader')).toHaveCount(2);
    });

    // Defect 1: withHeadingColumn is the same CSS-only treatment on column 0.
    test('a table with withHeadingColumn exposes its first column as row headers', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                withHeadingColumn: true,
                content: [['Name', 'Value'], ['foo', 'bar']],
              },
            },
          ],
        },
      });

      const table = page.locator(TABLE_SELECTOR).getByRole('table');

      await expect(table).toBeVisible();
      await expect(table.getByRole('rowheader')).toHaveCount(2);
    });

    // Defect 2: table-heading-toggle.ts builds a div track+thumb with no role,
    // no aria-checked, no tabindex and no keydown, inside a presentational
    // PopoverItemType.Html wrapper.
    test('the header-row toggle in the row grip menu is an operable switch', async ({ page }) => {
      await createBlok(page, { data: tableData(false) });
      await openRowGripMenu(page, 0);

      // Guard: the menu really is open, so a missing switch is a missing role
      // rather than a missing menu.
      await expect(page.getByText('Header row', { exact: true })).toBeVisible();

      const toggle = page.getByRole('switch', { name: /header row/i });

      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');

      await toggle.press('Space');

      await expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    // Defect 3: table-add-controls.ts renders contenteditable=false divs named
    // only by a hover tooltip, with no role and no keyboard path.
    test('the add-row affordance is a named, focusable button', async ({ page }) => {
      await createBlok(page, { data: tableData(false) });
      await getCell(page, 0, 0).click();
      await hoverTableEdge(page, 'bottom');

      const addRow = page.locator('[data-blok-table-add-row]');

      await expect(addRow).toBeVisible();
      await expect(addRow).toHaveAttribute('role', 'button');
      await expect(addRow).toHaveAttribute('aria-label', /.+/);
      await expect(addRow).toHaveAttribute('tabindex', '0');
    });

    // Defect 3, column axis.
    test('the add-column affordance is a named, focusable button', async ({ page }) => {
      await createBlok(page, { data: tableData(false) });
      await getCell(page, 0, 0).click();
      await hoverTableEdge(page, 'right');

      const addCol = page.locator('[data-blok-table-add-col]');

      await expect(addCol).toBeVisible();
      await expect(addCol).toHaveAttribute('role', 'button');
      await expect(addCol).toHaveAttribute('aria-label', /.+/);
      await expect(addCol).toHaveAttribute('tabindex', '0');
    });

    // Defect 4: table-row-col-controls.ts grips are pointer-only divs — no
    // role, no accessible name, no tab stop.
    test('row and column grips are named, focusable controls', async ({ page }) => {
      await createBlok(page, { data: tableData(false) });
      await getCell(page, 0, 0).click();

      const rowGrip = page.locator('[data-blok-table-grip-row="0"]');
      const colGrip = page.locator('[data-blok-table-grip-col="0"]');

      await expect(rowGrip).toBeVisible();
      await expect(rowGrip).toHaveAttribute('role', 'button');
      await expect(rowGrip).toHaveAttribute('aria-label', /.+/);
      await expect(rowGrip).toHaveAttribute('tabindex', '0');

      await expect(colGrip).toHaveAttribute('role', 'button');
      await expect(colGrip).toHaveAttribute('aria-label', /.+/);
      await expect(colGrip).toHaveAttribute('tabindex', '0');
    });

    // Defect 4: a grip locked by a merge is given aria-disabled while still
    // having no role at all, so the state hangs off a plain generic element.
    test('a merge-locked grip states its disabled state on an element with a role', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'table',
              data: {
                withHeadings: false,
                content: [
                  [
                    { blocks: [{ type: 'paragraph', data: { text: 'Merged' } }], rowspan: 2 },
                    { blocks: [{ type: 'paragraph', data: { text: 'R0C1' } }] },
                  ],
                  [
                    { blocks: [], mergedInto: [0, 0] },
                    { blocks: [{ type: 'paragraph', data: { text: 'R1C1' } }] },
                  ],
                ],
              },
            },
          ],
        },
      });

      await getCell(page, 0, 1).click();

      const lockedGrip = page.locator('[data-blok-table-grip-drag-disabled]').first();

      await expect(lockedGrip).toBeVisible();
      await expect(lockedGrip).toHaveAttribute('aria-disabled', 'true');
      await expect(lockedGrip).toHaveAttribute('role', /.+/);
    });
  });

  test.describe('colour picker', () => {
    // Defect 5: color-picker.ts names swatches only through a hover tooltip
    // (aria-describedby), so background swatches have no accessible name.
    test('every colour swatch has an accessible name', async ({ page }) => {
      await createBlok(page, { data: { blocks: [{ type: 'paragraph', data: { text: 'Colour me' } }] } });
      await openBlockColorPicker(page);

      const picker = page.getByTestId('block-color-picker');

      await expect(picker).toBeVisible();

      const { ids, detail } = await violationsOfRule(page, 'button-name', '[data-blok-testid="block-color-picker"]');

      expect(ids, detail).toStrictEqual([]);
    });

    // Defect 5: text-mode swatches all carry the literal glyph "A" as their
    // only text, so a screen reader's control list reads a column of "A".
    test('colour swatches are not all named by the same placeholder glyph', async ({ page }) => {
      await createBlok(page, { data: { blocks: [{ type: 'paragraph', data: { text: 'Colour me' } }] } });
      await openBlockColorPicker(page);

      const picker = page.getByTestId('block-color-picker');

      await expect(picker).toBeVisible();
      await expect(picker.getByRole('button', { name: 'A', exact: true })).toHaveCount(0);
    });

    // Defect 5: the applied colour is signalled by a ring class only — nothing
    // in the a11y tree says which swatch is currently in effect.
    test('the applied colour swatch exposes its pressed state', async ({ page }) => {
      await createBlok(page, {
        data: { blocks: [{ type: 'paragraph', data: { text: 'Colour me', textColor: 'red' } }] },
      });
      await openBlockColorPicker(page);

      const redSwatch = page.getByTestId('block-color-swatch-textColor-red');

      await expect(redSwatch).toBeVisible();
      await expect(redSwatch).toHaveAttribute('aria-pressed', 'true');
    });
  });

  test.describe('database view tabs', () => {
    // Defect 6: database-tab-bar.ts marks the active view with a data attribute
    // and styling; there is no tablist/tab/aria-selected anywhere.
    test('view tabs expose tablist semantics and the selected view', async ({ page }) => {
      await createBlok(page, { data: databaseData() });

      const tabBar = page.locator(TAB_BAR_SELECTOR);

      await expect(tabBar).toBeVisible();
      await expect(tabBar).toHaveAttribute('role', 'tablist');
      await expect(tabBar.getByRole('tab')).toHaveCount(2);
      await expect(tabBar.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true');
      await expect(tabBar.getByRole('tab', { name: 'Table' })).toHaveAttribute('aria-selected', 'false');
    });

    // Defect 6: the add-view button's only child is an aria-hidden icon.
    test('the add-view button has an accessible name', async ({ page }) => {
      await createBlok(page, { data: databaseData() });

      const addView = page.locator(`${TAB_BAR_SELECTOR} [data-blok-database-add-view]`);

      await expect(addView).toBeAttached();

      const { ids, detail } = await violationsOfRule(page, 'button-name', TAB_BAR_SELECTOR);

      expect(ids, detail).toStrictEqual([]);
    });
  });

  test.describe('file card and media captions', () => {
    // Defect 7: file/ui.ts puts a contenteditable role=textbox filename inside
    // the card body, which is itself a <button> (or a download <a>).
    test('the file card does not nest an editable textbox inside its button', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'file',
              data: { url: SAMPLE_FILE_URL, fileName: 'release-notes.txt', size: 2048 },
            },
          ],
        },
      });

      const card = page.locator(`${FILE_SELECTOR} [data-role="file-card"]`);

      await expect(card).toBeVisible();
      await expect(card.getByRole('textbox')).toHaveCount(0);
    });

    // Defect 8: file/image/video captions are role=textbox with no aria-label,
    // aria-labelledby or aria-multiline.
    test('media captions are named multiline textboxes', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'file', data: { url: SAMPLE_FILE_URL, fileName: 'notes.txt', caption: 'File caption', captionVisible: true } },
            { type: 'image', data: { url: SAMPLE_IMAGE_URL, alt: 'shot', caption: 'Image caption', captionVisible: true } },
            { type: 'video', data: { url: SAMPLE_VIDEO_URL, caption: 'Video caption', captionVisible: true } },
          ],
        },
      });

      const captions = page.locator(REDACTOR_SELECTOR).getByRole('textbox');

      await expect(captions.filter({ hasText: 'File caption' })).toBeVisible();
      await expect(captions.filter({ hasText: 'Image caption' })).toBeVisible();
      await expect(captions.filter({ hasText: 'Video caption' })).toBeVisible();

      const { ids, detail } = await violationsOfRule(page, 'aria-input-field-name', REDACTOR_SELECTOR);

      expect(ids, detail).toStrictEqual([]);

      await expect(captions.filter({ hasText: 'Image caption' })).toHaveAttribute('aria-multiline', 'true');
    });

    // Defect 8: link/embed/index.ts builds its caption from the same template.
    test('the embed caption is a named textbox', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              id: 'embed-1',
              type: 'embed',
              data: {
                service: '',
                source: 'https://dashboard.example.com/widget/42',
                embed: 'https://dashboard.example.com/widget/42',
                kind: 'iframe',
                width: 580,
                height: 320,
                caption: 'Embed caption',
                captionVisible: true,
              },
            },
          ],
        },
        config: { linkPaste: { allowedEmbedOrigins: ['dashboard.example.com'] } },
      });

      const caption = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-role="embed-caption"]`);

      await expect(caption).toBeVisible();

      const { ids, detail } = await violationsOfRule(page, 'aria-input-field-name', REDACTOR_SELECTOR);

      expect(ids, detail).toStrictEqual([]);
    });
  });

  test.describe('code block', () => {
    // Defect 11: code/dom-builder.ts declares aria-haspopup="listbox" but the
    // button never reports whether the picker is open.
    test('the language button reports its popup state', async ({ page }) => {
      await createBlok(page, {
        data: { blocks: [{ type: 'code', data: { code: 'hello world', language: 'plain text' } }] },
      });

      const languageButton = page.getByTestId('code-language-btn');

      await expect(languageButton).toBeVisible();
      await expect(languageButton).toHaveAttribute('aria-expanded', 'false');

      await languageButton.click();

      await expect(languageButton).toHaveAttribute('aria-expanded', 'true');
    });
  });

  test.describe('checklist export', () => {
    // Defect 12: list/dom-builder.ts buildSemanticListHtml emits a bare
    // <input type="checkbox"> next to an unassociated <span>, so a checklist
    // pasted into another app arrives with unlabelled checkboxes. The editable
    // render path (buildChecklistContent) wires aria-labelledby correctly.
    test('exported checklist HTML labels every checkbox', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { id: 'i0', type: 'list', data: { text: 'Buy milk', style: 'checklist', checked: false } },
            { id: 'i1', type: 'list', data: { text: 'Buy eggs', style: 'checklist', checked: true } },
          ],
        },
      });

      const editables = page.locator(`${REDACTOR_SELECTOR} [contenteditable="true"]`);

      await editables.first().click();
      await editables.last().click({ modifiers: ['Shift'] });

      const clipboard = await copyFrom(editables.first());
      const unlabelled = await page.evaluate((html: string) => {
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        const boxes = Array.from(parsed.querySelectorAll('input[type="checkbox"]'));

        return boxes
          .filter((box) => {
            const labelledBy = box.getAttribute('aria-labelledby');
            const named = box.getAttribute('aria-label');
            const wrapped = box.closest('label') !== null;
            const referenced = box.id !== '' && parsed.querySelector(`label[for="${box.id}"]`) !== null;

            return labelledBy === null && named === null && !wrapped && !referenced;
          })
          .map((box) => box.outerHTML);
      }, clipboard['text/html'] ?? '');

      expect(clipboard['text/html'], 'copy should produce an HTML flavour').toContain('Buy milk');
      expect(unlabelled, 'exported checkboxes with no accessible name').toStrictEqual([]);
    });
  });

  test.describe('callout', () => {
    // Defect 13: callout/dom-builder.ts sets aria-label to the raw emoji, so
    // the button announces as "light bulb" instead of naming its action.
    test('the icon button is named by its action, not by the emoji', async ({ page }) => {
      await createBlok(page, {
        data: { blocks: [{ type: 'callout', data: { emoji: '💡', color: 'default' } }] },
      });

      const emojiButton = page.getByTestId('callout-emoji-btn');

      await expect(emojiButton).toBeVisible();
      await expect(emojiButton).not.toHaveAttribute('aria-label', '💡');
      await expect(emojiButton).toHaveAttribute('aria-label', /[a-z]/i);
    });
  });

  test.describe('block navigation mode', () => {
    // Defect 16: blockSelection.ts marks the focused block with a data
    // attribute and announces its position, but DOM focus never moves and no
    // aria-activedescendant/aria-selected is written, so nothing in the a11y
    // tree answers "which block is focused".
    test.fixme('the navigation-focused block is exposed through the a11y tree', async ({ page }) => {
      /**
       * DELIBERATELY NOT FIXED. The block now carries aria-current="true", so
       * "which block is focused" IS queryable — but this asserts role +
       * aria-selected. aria-selected is aria-allowed-attr gated, and every role
       * permitting it (option/tab/row/gridcell/treeitem) requires a composite
       * container role on the redactor, which would wrap contenteditable text in
       * a listbox/grid and change how AT reads every block. aria-activedescendant
       * is no alternative either: setNavigationFocus blurs to document.body by
       * design, so no host holds focus to carry it.
       */
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'First block' } },
            { type: 'paragraph', data: { text: 'Second block' } },
          ],
        },
      });

      await page.getByText('Second block').click();
      await page.keyboard.press('Escape');

      const focused = page.locator('[data-blok-navigation-focused="true"]');

      await expect(focused).toHaveCount(1);
      await expect(focused).toHaveAttribute('role', /.+/);
      await expect(focused).toHaveAttribute('aria-selected', 'true');
    });
  });

  test.describe('unknown-tool stub', () => {
    // Defect 17: stub/index.ts renders title + subtitle as plain text, so the
    // "block cannot be displayed" notice never reaches assistive tech.
    test('the stub announces itself as a status message', async ({ page }) => {
      await createBlok(page, {
        data: { blocks: [{ type: 'unknown-tool-type', data: {} }] },
      });

      const stub = page.locator('[data-blok-stub]');

      await expect(stub).toBeVisible();
      await expect(stub).toHaveAttribute('role', /alert|status/);
    });
  });

  test.describe('contracts already met', () => {
    test('the divider block is a real separator', async ({ page }) => {
      await createBlok(page, { data: { blocks: [{ type: 'divider', data: {} }] } });

      const divider = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-tool="divider"]`);

      await expect(divider).toBeVisible();
      await expect(divider.getByRole('separator')).toHaveCount(1);
    });

    test('the column resizer carries the full window-splitter contract', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
            { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['p1'] },
            { id: 'p1', type: 'paragraph', data: { text: 'Left' }, parent: 'c1' },
            { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['p2'] },
            { id: 'p2', type: 'paragraph', data: { text: 'Right' }, parent: 'c2' },
          ],
        },
      });

      const resizer = page.getByTestId('column-resizer');

      await expect(resizer).toBeAttached();
      await expect(resizer).toHaveAttribute('role', 'separator');
      await expect(resizer).toHaveAttribute('aria-orientation', 'vertical');
      await expect(resizer).toHaveAttribute('aria-label', /.+/);
      await expect(resizer).toHaveAttribute('tabindex', '0');
      await expect(resizer).toHaveAttribute('aria-valuemin', '0');
      await expect(resizer).toHaveAttribute('aria-valuemax', '100');
      await expect(resizer).toHaveAttribute('aria-valuenow', /^\d+$/);
    });

    test('the spacer grips carry the same splitter contract', async ({ page }) => {
      await createBlok(page, { data: { blocks: [{ type: 'spacer', data: {} }] } });

      const grip = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-tool="spacer"]`).getByRole('separator').first();

      await expect(grip).toBeAttached();
      await expect(grip).toHaveAttribute('aria-orientation', 'horizontal');
      await expect(grip).toHaveAttribute('aria-label', /.+/);
      await expect(grip).toHaveAttribute('tabindex', '0');
      await expect(grip).toHaveAttribute('aria-valuenow', /^\d+$/);
    });

    test('the link hover card action buttons are all named', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'See <a href="https://example.com/docs">the docs</a>' } },
          ],
        },
      });

      const link = page.getByRole('link', { name: 'the docs' });

      await expect(link).toBeVisible();
      await link.hover();

      const card = page.getByTestId('link-hover-card');

      await expect(card).toBeVisible();
      await expect(card.getByTestId('link-hover-card-copy')).toHaveAttribute('aria-label', /.+/);
      await expect(card.getByTestId('link-hover-card-edit')).not.toHaveText('');
    });
  });
});
