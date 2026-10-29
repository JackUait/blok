/**
 * URL, Email and Phone cells in a table, against Notion (research/16 §4):
 * a click on the text follows the link, a click on the rest of the cell edits,
 * and a hover shows a "Comment" / "Copy to Clipboard" pill.
 * Navigation is always blocked: a window click listener records the click, then
 * cancels it, so no tab, mail app or dialer opens.
 */

import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
    BlokDatabase: unknown;
    BlokDatabaseRow: unknown;
    linkLog?: { follows: Array<{ href: string; target: string; prevented: boolean }>; comments: unknown[]; copied: string[] };
  }
}

const SCHEMA = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-link', name: 'Link', type: 'url', position: 'a1' },
  { id: 'p-mail', name: 'Mail', type: 'email', position: 'a2' },
  { id: 'p-tel', name: 'Tel', type: 'phone', position: 'a3' },
  { id: 'p-points', name: 'Points', type: 'number', position: 'a4' },
  { id: 'p-stage', name: 'Stage', type: 'select', position: 'a5', config: { options: [{ id: 'o-idea', label: 'Idea', position: 'a0' }] } },
];

const ROWS = [
  { id: 'r1', properties: { 'p-title': 'Alpha', 'p-link': 'https://example.com', 'p-mail': 'test@example.com', 'p-tel': '+1 555 0100', 'p-points': 3, 'p-stage': 'o-idea' } },
  { id: 'r2', properties: { 'p-title': 'Beta', 'p-points': 5 } },
];

// Wide link columns: at the default 200px a wider OS font (Linux CI) runs the value up to the hover pill,
// and clickBlank finds no blank part to click.
const TABLE_VIEW = {
  id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [],
  properties: SCHEMA.map((p) => ({ id: p.id, visible: true, ...(['p-link', 'p-mail', 'p-tel'].includes(p.id) ? { width: 300 } : {}) })),
};

const blocks = (view: Record<string, unknown> = TABLE_VIEW): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [view],
      activeViewId: view.id,
    },
    content: ROWS.map((row) => row.id),
  },
  ...ROWS.map((row, i) => ({ id: row.id, type: 'database-row', parent: 'db-1', data: { position: `a${i}`, properties: row.properties } })),
];

const mount = async (page: Page, options: { comments: boolean; readOnly?: boolean; denyComments?: boolean; view?: Record<string, unknown> }): Promise<void> => {
  await page.evaluate(async ({ input, comments, readOnly, denyComments }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');
    const log = { follows: [] as Array<{ href: string; target: string; prevented: boolean }>, comments: [] as unknown[], copied: [] as string[] };

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    // The page is shared between tests: install the recorder once, or an older one cancels first.
    if (window.linkLog === undefined) {
      // Bubble on window runs after every Blok handler and before the browser follows the link.
      window.addEventListener('click', (event) => {
        const link = event.target instanceof Element ? event.target.closest('a') : null;

        if (link !== null) {
          window.linkLog?.follows.push({ href: link.href, target: link.target, prevented: event.defaultPrevented });
          event.preventDefault();
        }
      });
    }
    window.linkLog = log;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (text: string) => { log.copied.push(text);

        return Promise.resolve(); } },
    });
    window.blokInstance = new window.Blok({
      holder,
      readOnly,
      data: { blocks: input },
      tools: {
        database: {
          class: window.BlokDatabase,
          config: {
            ...(comments ? { comments: { open: (target: unknown) => log.comments.push(target) } } : {}),
            ...(denyComments ? { permissions: { can: (action: string) => action !== 'comment' } } : {}),
          },
        },
        'database-row': { class: window.BlokDatabaseRow },
      },
    });
    await window.blokInstance.isReady;
  }, { input: blocks(options.view), comments: options.comments, readOnly: options.readOnly ?? false, denyComments: options.denyComments ?? false });
  if (options.view === undefined) await expect(page.getByRole('grid')).toBeVisible();
};

const savedProperties = (page: Page, rowId: string): Promise<Record<string, unknown>> => page.evaluate(async (id) => {
  const output = await window.blokInstance?.save();

  return (output?.blocks.find((block) => block.id === id)?.data as { properties: Record<string, unknown> }).properties;
}, rowId);

const peek = (page: Page): Locator => page.locator('[data-blok-database-drawer]');
const peekValue = (page: Page, propertyId: string): Locator =>
  peek(page).locator(`[data-blok-database-drawer-prop-value][data-property-id="${propertyId}"]`);

const cell = (page: Page, rowId: string, propertyId: string): Locator =>
  page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"] [role="gridcell"][data-property-id="${propertyId}"]`);

const follows = (page: Page): Promise<unknown> => page.evaluate(() => window.linkLog?.follows);

/** A point in the cell right of the text and left of the pill. */
const clickBlank = async (page: Page, target: Locator): Promise<void> => {
  await target.hover();
  const point = await target.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const textEnd = el.querySelector('a')?.getBoundingClientRect().right ?? box.left;
    const pill = el.querySelector('[data-blok-database-table-cell-actions]')?.getBoundingClientRect();
    const blankEnd = pill === undefined || pill.width === 0 ? box.right : pill.left;

    return { x: (textEnd + blankEnd) / 2, y: box.top + box.height / 2 };
  });

  await page.mouse.click(point.x, point.y);
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  // A backstop: nothing here may reach the internet.
  await page.route('https://example.com/**', (route) => route.abort());
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('editable table', () => {
  test.beforeEach(async ({ page }) => {
    await mount(page, { comments: true });
  });

  test('values are links to a new tab; a url shows without its scheme', async ({ page }) => {
    await expect(cell(page, 'r1', 'p-link').getByRole('link')).toHaveText('example.com');
    await expect(cell(page, 'r1', 'p-link').getByRole('link')).toHaveAttribute('href', 'https://example.com');
    await expect(cell(page, 'r1', 'p-mail').getByRole('link')).toHaveAttribute('href', 'mailto:test@example.com');
    await expect(cell(page, 'r1', 'p-tel').getByRole('link')).toHaveAttribute('href', 'tel:+15550100');
    for (const propertyId of ['p-link', 'p-mail', 'p-tel']) {
      await expect(cell(page, 'r1', propertyId).getByRole('link')).toHaveAttribute('target', '_blank');
      await expect(cell(page, 'r1', propertyId).getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  test('a click on the text follows the link and opens no editor', async ({ page }) => {
    const hrefs = ['https://example.com/', 'mailto:test@example.com', 'tel:+15550100'];

    for (const [index, propertyId] of ['p-link', 'p-mail', 'p-tel'].entries()) {
      await cell(page, 'r1', propertyId).getByRole('link').click();

      expect(await follows(page)).toEqual(hrefs.slice(0, index + 1).map((href) => ({ href, target: '_blank', prevented: false })));
      await expect(page.getByRole('textbox')).toHaveCount(0);
    }
  });

  test('a click on the blank part opens the one-line editor with the full value, caret at the end', async ({ page }) => {
    const cases = [
      { propertyId: 'p-link', name: 'Link', type: 'url', value: 'https://example.com' },
      { propertyId: 'p-mail', name: 'Mail', type: 'email', value: 'test@example.com' },
      { propertyId: 'p-tel', name: 'Tel', type: 'tel', value: '+1 555 0100' },
    ];

    for (const { propertyId, name, type, value } of cases) {
      await clickBlank(page, cell(page, 'r1', propertyId));
      const field = page.getByRole('textbox', { name });

      await expect(field).toHaveValue(value);
      await expect(field).toHaveAttribute('type', type);
      await expect(field).toBeFocused();
      await page.keyboard.type('Z');
      await expect(field).toHaveValue(`${value}Z`);
      await page.keyboard.press('Escape');
      await expect(field).toHaveCount(0);
    }
    expect(await follows(page)).toEqual([]);
  });

  test('an empty url cell opens the same editor, empty', async ({ page }) => {
    await cell(page, 'r2', 'p-link').click();

    await expect(page.getByRole('textbox', { name: 'Link' })).toHaveValue('');
    await expect(page.getByRole('textbox', { name: 'Link' })).toHaveAttribute('type', 'url');
  });

  test('Enter on a selected url cell still edits it', async ({ page }) => {
    await clickBlank(page, cell(page, 'r1', 'p-link'));
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await page.keyboard.press('Enter');

    await expect(page.getByRole('textbox', { name: 'Link' })).toHaveValue('https://example.com');
  });

  test('hovering a filled cell shows a 52x24 pill with Comment and Copy to Clipboard; an empty cell shows none', async ({ page }) => {
    const filled = cell(page, 'r1', 'p-link');
    const copy = filled.getByRole('button', { name: 'Copy to clipboard' });

    await expect(copy).toBeHidden();
    await filled.hover();
    await expect(filled.getByRole('button', { name: 'Comment' })).toBeVisible();
    await expect(copy).toBeVisible();

    const pill = filled.locator('[data-blok-database-table-cell-actions]');
    const box = await pill.boundingBox();
    const cellBox = await filled.boundingBox();

    expect([box?.width, box?.height]).toEqual([52, 24]);
    // notion-spec-2 §19.6: 4px inside the cell's 1px column line (x 843-895 in a 700-900 cell).
    expect(Math.round((cellBox?.x ?? 0) + (cellBox?.width ?? 0) - 1 - ((box?.x ?? 0) + (box?.width ?? 0)))).toBe(4);
    expect(await pill.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('6px');
    expect([(await copy.boundingBox())?.width, (await copy.boundingBox())?.height]).toEqual([24, 20]);

    for (const propertyId of ['p-mail', 'p-tel']) {
      await cell(page, 'r1', propertyId).hover();
      await expect(cell(page, 'r1', propertyId).getByRole('button', { name: 'Copy to clipboard' })).toBeVisible();
    }
    await cell(page, 'r2', 'p-link').hover();
    await expect(cell(page, 'r2', 'p-link').getByRole('button')).toHaveCount(0);
    // notion-spec-2 §19.20: a filled Number shows the box too, at the cell's start edge, 4px in.
    const points = cell(page, 'r1', 'p-points');

    await points.hover();
    await expect(points.getByRole('button', { name: 'Copy to clipboard' })).toBeVisible();
    expect(Math.round(((await points.locator('[data-blok-database-table-cell-actions]').boundingBox())?.x ?? 0) - ((await points.boundingBox())?.x ?? 0))).toBe(4);
  });

  test('the pill hints show only after a hover delay', async ({ page }) => {
    await cell(page, 'r1', 'p-link').hover();
    await cell(page, 'r1', 'p-link').getByRole('button', { name: 'Copy to clipboard' }).hover();

    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(page.getByRole('tooltip')).toHaveText('Copy to clipboard', { timeout: 2000 });
  });

  test('Copy to Clipboard copies the full value and toasts', async ({ page }) => {
    await cell(page, 'r1', 'p-link').hover();
    await cell(page, 'r1', 'p-link').getByRole('button', { name: 'Copy to clipboard' }).click();

    await expect(page.getByTestId('notification-message-text')).toHaveText('Copied property to clipboard');
    expect(await page.evaluate(() => window.linkLog?.copied)).toEqual(['https://example.com']);
    await expect(page.getByRole('textbox')).toHaveCount(0);
  });

  test('Comment opens the host comments for that cell', async ({ page }) => {
    await cell(page, 'r1', 'p-mail').hover();
    await cell(page, 'r1', 'p-mail').getByRole('button', { name: 'Comment' }).click();

    expect(await page.evaluate(() => window.linkLog?.comments)).toEqual([{ databaseId: 'db-1', rowId: 'r1', propertyId: 'p-mail' }]);
    await expect(page.getByRole('textbox')).toHaveCount(0);
  });
});

test('without host comments the pill\'s Comment opens the built-in thread for that cell', async ({ page }) => {
  await mount(page, { comments: false });
  await cell(page, 'r1', 'p-mail').hover();
  await cell(page, 'r1', 'p-mail').getByRole('button', { name: 'Comment' }).click();

  await expect(page.getByRole('textbox', { name: 'Add a comment…' })).toBeFocused();
});

test('with comments denied the pill has Copy only', async ({ page }) => {
  await mount(page, { comments: false, denyComments: true });
  await cell(page, 'r1', 'p-link').hover();

  await expect(cell(page, 'r1', 'p-link').getByRole('button', { name: 'Copy to clipboard' })).toBeVisible();
  await expect(cell(page, 'r1', 'p-link').getByRole('button', { name: 'Comment' })).toHaveCount(0);
});

test('read-only: the link follows, nothing edits, Copy still copies', async ({ page }) => {
  await mount(page, { comments: false, readOnly: true });

  await cell(page, 'r1', 'p-link').getByRole('link').click();
  expect(await follows(page)).toEqual([{ href: 'https://example.com/', target: '_blank', prevented: false }]);

  await clickBlank(page, cell(page, 'r1', 'p-link'));
  await expect(page.getByRole('textbox')).toHaveCount(0);

  await cell(page, 'r1', 'p-link').getByRole('button', { name: 'Copy to clipboard' }).click();
  await expect(page.getByTestId('notification-message-text')).toHaveText('Copied property to clipboard');
});

// research/22 §3: Escape saves what was typed into a url, email or phone editor.
test('Escape saves a value typed into an empty url, email or phone cell', async ({ page }) => {
  await mount(page, { comments: false });
  const cases = [
    { propertyId: 'p-link', name: 'Link', typed: 'example.org' },
    { propertyId: 'p-mail', name: 'Mail', typed: 'a@b.co' },
    { propertyId: 'p-tel', name: 'Tel', typed: '+1 555 0100' },
  ];

  for (const { propertyId, name, typed } of cases) {
    await cell(page, 'r2', propertyId).click();
    await page.getByRole('textbox', { name }).fill(typed);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox')).toHaveCount(0);
  }

  expect(await savedProperties(page, 'r2')).toMatchObject({ 'p-link': 'example.org', 'p-mail': 'a@b.co', 'p-tel': '+1 555 0100' });
  // Notion links a typed "example.org" over http.
  await expect(cell(page, 'r2', 'p-link').getByRole('link')).toHaveJSProperty('href', 'http://example.org/');
  await expect(cell(page, 'r2', 'p-mail').getByRole('link')).toHaveAttribute('href', 'mailto:a@b.co');
  await expect(cell(page, 'r2', 'p-tel').getByRole('link')).toHaveAttribute('href', 'tel:+15550100');
});

test('Escape saves an edited url', async ({ page }) => {
  await mount(page, { comments: false });
  await clickBlank(page, cell(page, 'r1', 'p-link'));
  await page.getByRole('textbox', { name: 'Link' }).fill('https://example.org');
  await page.keyboard.press('Escape');

  await expect(page.getByRole('textbox')).toHaveCount(0);
  expect((await savedProperties(page, 'r1'))['p-link']).toBe('https://example.org');
});

// research/23 §3c: End, one more character, Escape saves a stored email or phone too.
test('Escape saves an edited email and phone', async ({ page }) => {
  await mount(page, { comments: false });

  for (const [propertyId, name, typed] of [['p-mail', 'Mail', 'm'], ['p-tel', 'Tel', '1']] as const) {
    await clickBlank(page, cell(page, 'r1', propertyId));
    const field = page.getByRole('textbox', { name });

    await field.press('End');
    await field.pressSequentially(typed);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox')).toHaveCount(0);
  }

  expect(await savedProperties(page, 'r1')).toMatchObject({ 'p-mail': 'test@example.comm', 'p-tel': '+1 555 01001' });
});

// research/22 §3: a 1px rgba(28, 19, 1, 0.11) line drawn as a background, no text-decoration.
test('the link underline is a 1px background line', async ({ page }) => {
  await mount(page, { comments: false });

  for (const propertyId of ['p-link', 'p-mail', 'p-tel']) {
    const look = await cell(page, 'r1', propertyId).getByRole('link').evaluate((el) => {
      const style = getComputedStyle(el);

      return { image: style.backgroundImage, size: style.backgroundSize, decoration: style.textDecorationLine };
    });

    expect(look).toEqual({ image: 'linear-gradient(rgba(28, 19, 1, 0.11), rgba(28, 19, 1, 0.11))', size: '100% 1px', decoration: 'none' });
  }
});

test.describe('row page', () => {
  test.beforeEach(async ({ page }) => {
    await mount(page, { comments: true });
    const row = page.locator('[data-blok-database-table-row][data-row-id="r1"]');

    await row.hover();
    await row.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(peek(page)).toBeVisible();
  });

  test('a click on the link follows it in a new tab and opens no editor', async ({ page }) => {
    const hrefs = ['https://example.com/', 'mailto:test@example.com', 'tel:+15550100'];

    for (const [index, propertyId] of ['p-link', 'p-mail', 'p-tel'].entries()) {
      await peekValue(page, propertyId).getByRole('link').click();

      expect(await follows(page)).toEqual(hrefs.slice(0, index + 1).map((href) => ({ href, target: '_blank', prevented: false })));
      await expect(page.locator('[data-blok-database-cell-editor]')).toHaveCount(0);
    }
  });

  test('a click beside the link opens the editor with the full value', async ({ page }) => {
    const value = peekValue(page, 'p-link');

    await value.hover();
    const point = await value.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const textEnd = el.querySelector('a')?.getBoundingClientRect().right ?? box.left;
      const pill = el.querySelector('[data-blok-database-drawer-prop-actions]')?.getBoundingClientRect();

      return { x: (textEnd + (pill?.left ?? box.right)) / 2, y: box.top + box.height / 2 };
    });

    await page.mouse.click(point.x, point.y);

    await expect(page.getByRole('textbox', { name: 'Link' })).toHaveValue('https://example.com');
    expect(await follows(page)).toEqual([]);
  });

  test('hover shows Comment and Copy at the row end, no pencil and no fill', async ({ page }) => {
    const value = peekValue(page, 'p-tel');
    const copy = value.getByRole('button', { name: 'Copy to clipboard' });

    await expect(copy).toBeHidden();
    await value.hover();
    await expect(value.getByRole('button', { name: 'Comment' })).toBeVisible();
    await expect(copy).toBeVisible();
    await expect(value.getByRole('button')).toHaveCount(2);
    await expect(value).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

    const valueBox = await value.boundingBox();
    const copyBox = await copy.boundingBox();

    expect([copyBox?.width, copyBox?.height]).toEqual([24, 20]);
    expect((copyBox?.x ?? 0) + (copyBox?.width ?? 0)).toBeGreaterThan((valueBox?.x ?? 0) + (valueBox?.width ?? 0) - 16);

    await copy.click();
    await expect(page.getByTestId('notification-message-text')).toHaveText('Copied property to clipboard');
    expect(await page.evaluate(() => window.linkLog?.copied)).toEqual(['+1 555 0100']);

    await value.getByRole('button', { name: 'Comment' }).click();
    expect(await page.evaluate(() => window.linkLog?.comments)).toEqual([{ databaseId: 'db-1', rowId: 'r1', propertyId: 'p-tel' }]);
    await expect(page.locator('[data-blok-database-cell-editor]')).toHaveCount(0);
  });
});

// research/22 §3: on a card a link click follows the link; the card does not open.
for (const type of ['board', 'gallery'] as const) {
  test(`${type}: a click on a card's link follows it and does not open the card`, async ({ page }) => {
    await mount(page, {
      comments: false,
      view: { id: 'v1', name: type, type, position: 'a0', groupBy: 'p-stage', sorts: [], filters: [], visibleProperties: [], properties: [{ id: 'p-link', visible: true }] },
    });
    // notion-spec-2 §21.7, §22.1: a card shows the address without its scheme.
    const link = page.locator('[data-row-id="r1"]').getByRole('link', { name: 'example.com', exact: true });

    await link.click();

    expect(await follows(page)).toEqual([{ href: 'https://example.com/', target: '_blank', prevented: false }]);
    await expect(peek(page)).toHaveCount(0);
    await expect(page.locator('[data-blok-database-cell-editor]')).toHaveCount(0);
  });
}
