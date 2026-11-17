/**
 * Built-in database comments (research/12 §3, research/19 §2d) with only
 * `database` registered: it brings `database-comment` along.
 */

import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData, OutputData } from '@/types';
import { blocksToHtml, blocksToMarkdown } from '../../../../src/view';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

const blocks = (): OutputBlockData[] => [
  { id: 'p1', type: 'paragraph', data: { text: 'Intro' } },
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Launch' } } },
];

const mount = async (page: Page, input: OutputBlockData[] = blocks()): Promise<void> => {
  await page.evaluate(async (input) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');
    const globals = window as unknown as Record<string, unknown>;

    holder.id = 'blok';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: input },
      // No database-comment entry: the database brings it.
      tools: { paragraph: globals.BlokParagraph, database: globals.BlokDatabase },
    });
    await window.blokInstance.isReady;
  }, input);
};

const save = async (page: Page): Promise<OutputData> => page.evaluate(async () => {
  const saved = await window.blokInstance?.save();

  if (saved === undefined) throw new Error('no editor');

  return saved;
});

const savedComments = async (page: Page): Promise<OutputBlockData[]> =>
  (await save(page)).blocks.filter((block) => block.type === 'database-comment');

const titleCell = (page: Page): Locator => page.getByRole('gridcell').filter({ hasText: 'Launch' });
const composer = (scope: Locator | Page): Locator => scope.getByRole('textbox', { name: 'Add a comment…' });
const badge = (page: Page): Locator => page.getByRole('button', { name: 'Open comments' });

const comment = async (page: Page, text: string): Promise<void> => {
  // A right-click opens the row menu (research/23 §157); its Comment opens the row's comments.
  await titleCell(page).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Comment/ }).click();
  await expect(composer(page)).toBeFocused();
  await composer(page).fill(text);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listitem').filter({ hasText: text })).toBeVisible();
};

const moreActions = async (page: Page, text: string): Promise<void> => {
  const item = page.getByRole('listitem').filter({ hasText: text });

  await item.hover();
  await item.getByRole('button', { name: 'More actions' }).click();
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await mount(page);
});

test('the row menu\'s Comment adds a comment on the row and the row shows a badge with its count', async ({ page }) => {
  await comment(page, 'Looks good');

  await expect(badge(page)).toHaveText('1');
  expect((await savedComments(page)).map((block) => [block.parent, block.data.text, block.data.propertyId]))
    .toEqual([['r1', 'Looks good', undefined]]);
});

test('a second message replies to the thread, and the badge counts both', async ({ page }) => {
  await comment(page, 'First');
  await composer(page).fill('Second');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('listitem').filter({ hasText: 'Second' })).toBeVisible();
  await expect(badge(page)).toHaveText('2');
  const saved = await savedComments(page);

  expect(saved.map((block) => block.data.text)).toEqual(['First', 'Second']);
  expect(saved[1]?.parent).toBe(saved[0]?.id);
});

test('Edit changes the text and shows "(edited)"', async ({ page }) => {
  await comment(page, 'Typo');
  await moreActions(page, 'Typo');
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const field = page.getByRole('listitem').getByRole('textbox');

  await expect(field).toHaveValue('Typo');
  await field.fill('Fixed');
  await page.keyboard.press('Enter');

  const item = page.getByRole('listitem').filter({ hasText: 'Fixed' });

  await expect(item).toContainText('(edited)');
  expect((await savedComments(page))[0]?.data).toMatchObject({ text: 'Fixed', editedAt: expect.any(Number) });
});

test('Delete asks first, and Cancel keeps the comment', async ({ page }) => {
  await comment(page, 'Oops');
  await moreActions(page, 'Oops');
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByText('Delete this comment?')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await savedComments(page)).toHaveLength(1);

  await moreActions(page, 'Oops');
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(page.getByRole('listitem').filter({ hasText: 'Oops' })).toHaveCount(0);
  expect(await savedComments(page)).toHaveLength(0);
  await expect(badge(page)).toHaveCount(0);
});

test('Resolve hides the thread and drops the badge', async ({ page }) => {
  await comment(page, 'Done?');
  await expect(badge(page)).toHaveText('1');
  const item = page.getByRole('listitem').filter({ hasText: 'Done?' });

  await item.hover();
  await item.getByRole('button', { name: 'Resolve' }).click();

  await expect(item).toHaveCount(0);
  await expect(badge(page)).toHaveCount(0);
  expect((await savedComments(page))[0]?.data.resolved).toBe(true);
});

test('the row page has a Comments section with a composer that writes a row comment', async ({ page }) => {
  await titleCell(page).hover();
  await titleCell(page).getByRole('button', { name: 'Open' }).click();
  const section = page.getByRole('region', { name: 'Comments' });

  await expect(section).toBeVisible();
  await composer(section).fill('From the page');
  await composer(section).press('Enter');

  await expect(section.getByText('From the page')).toBeVisible();
  const saved = await savedComments(page);

  expect(saved).toHaveLength(1);
  expect(saved[0]?.parent).toBe('r1');
  expect(saved[0]?.data).not.toHaveProperty('propertyId');
});

test('Mod+Z undoes the page edit before a comment and leaves the comment', async ({ page }) => {
  const intro = page.getByText('Intro', { exact: true });

  await intro.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' typed');
  await expect(page.getByText('Intro typed')).toBeVisible();
  await comment(page, 'Keep me');
  await page.keyboard.press('Escape');
  await expect(composer(page)).toHaveCount(0);

  await page.getByText('Intro typed').click();
  await page.keyboard.press(`${MOD}+z`);

  await expect(page.getByText('Intro', { exact: true })).toBeVisible();
  expect((await savedComments(page)).map((block) => block.data.text)).toEqual(['Keep me']);
  await expect(badge(page)).toHaveText('1');
});

test('one Escape closes one layer: the actions menu, then the edit, then the popover', async ({ page }) => {
  await comment(page, 'Layers');
  await moreActions(page, 'Layers');
  const menu = page.getByRole('menu');

  await expect(menu.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(composer(page)).toBeVisible();

  await moreActions(page, 'Layers');
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const field = page.getByRole('listitem').getByRole('textbox');

  await expect(field).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(field).toHaveCount(0);
  await expect(page.getByRole('listitem').filter({ hasText: 'Layers' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(composer(page)).toHaveCount(0);
});

test('the HTML and Markdown exports carry the row but no comment text', async ({ page }) => {
  await comment(page, 'Secret remark');
  const saved = await save(page);

  expect(saved.blocks.some((block) => block.type === 'database-comment')).toBe(true);
  const html = blocksToHtml(saved);
  const markdown = blocksToMarkdown(saved);

  expect(html).toContain('Launch');
  expect(markdown).toContain('Launch');
  expect(html).not.toContain('Secret remark');
  expect(markdown).not.toContain('Secret remark');
});

test('the row menu\'s Comment box is 470x44, 4px under the row, centred on the title cell', async ({ page }) => {
  // notion-motion.md Round 60 §3: a right-click on a Text cell, then Comment, opens the page box there.
  const [intro, database, row] = blocks();

  await mount(page, [
    intro,
    {
      ...database,
      data: {
        ...database.data,
        schema: [
          { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
          { id: 'p-note', name: 'Note', type: 'text', position: 'a1' },
        ],
      },
    },
    { ...row, data: { ...row.data, properties: { 'p-title': 'Launch', 'p-note': 'Soon' } } },
  ]);
  await page.getByRole('gridcell').filter({ hasText: 'Soon' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Comment/ }).click();
  await expect(composer(page)).toBeFocused();
  // Measured after the open scale ends.
  await composer(page).evaluate(async (input) => {
    await Promise.all(input.closest('[data-blok-popover-container]')?.getAnimations().map((animation) => animation.finished) ?? []);
  });

  const boxes = await composer(page).evaluate((input) => {
    const card = input.closest('[data-blok-popover-container]');
    const rowEl = document.querySelector('[data-blok-database-table-row][data-row-id="r1"]');
    const title = rowEl?.querySelector('[data-blok-database-table-cell][data-type="title"]');
    const box = (el: Element | null | undefined): { left: number; top: number; width: number; height: number; bottom: number } | null => {
      if (el === null || el === undefined) return null;
      const r = el.getBoundingClientRect();

      return { left: r.left, top: r.top, width: r.width, height: r.height, bottom: r.bottom };
    };

    return { card: box(card), row: box(rowEl), title: box(title) };
  });

  if (boxes.card === null || boxes.row === null || boxes.title === null) throw new Error('missing box');
  expect(boxes.card.top - boxes.row.bottom).toBeCloseTo(4, 0);
  expect(boxes.card.left + boxes.card.width / 2).toBeCloseTo(boxes.title.left + boxes.title.width / 2, 0);
  expect(boxes.card.width).toBeCloseTo(470, 0);
  expect(boxes.card.height).toBeCloseTo(44, 0);
});

interface Box { left: number; top: number; width: number; height: number; bottom: number }

/** The comment card after its open scale ends, the anchor's box and the card's transform-origin. */
const commentBoxAgainst = async (page: Page, anchorSelector: string): Promise<{ card: Box; anchor: Box; origin: string }> => {
  await expect(composer(page)).toBeFocused();

  return composer(page).evaluate(async (input, selector) => {
    const card = input.closest('[data-blok-popover-container]');

    await Promise.all(card?.getAnimations().map((animation) => animation.finished) ?? []);
    const anchor = document.querySelector(selector);

    if (card === null || anchor === null) throw new Error('missing box');
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();

      return { left: r.left, top: r.top, width: r.width, height: r.height, bottom: r.bottom };
    };

    return { card: box(card), anchor: box(anchor), origin: getComputedStyle(card).transformOrigin };
  }, anchorSelector);
};

const withView = (view: Record<string, unknown>, schema?: Array<Record<string, unknown>>): OutputBlockData[] => {
  const [intro, database, row] = blocks();

  return [
    intro,
    { ...database, data: { ...database.data, ...(schema !== undefined ? { schema } : {}), views: [{ id: 'v1', name: 'View', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...view }] } },
    row,
  ];
};

test('a board card\'s Comment box sits 4px under the card, centred on it, and grows from its top centre', async ({ page }) => {
  // notion-motion.md Round 61 §2: Notion 442,484.2 under a 547..807 × 440..480 card.
  const schema = [
    { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
    { id: 'p-stage', name: 'Stage', type: 'select', position: 'a1', config: { options: [{ id: 'o-todo', label: 'Not started', color: 'gray', position: 'a0' }] } },
  ];
  const [intro, database, row] = withView({ type: 'board', groupBy: 'p-stage' }, schema);

  await mount(page, [intro, database, { ...row, data: { ...row.data, properties: { 'p-title': 'Launch', 'p-stage': 'o-todo' } } }]);
  await page.locator('[data-blok-database-card][data-row-id="r1"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Comment/ }).click();

  const { card, anchor, origin } = await commentBoxAgainst(page, '[data-blok-database-card][data-row-id="r1"]');

  expect(card.top - anchor.bottom).toBeCloseTo(4, 0);
  expect(card.left + card.width / 2).toBeCloseTo(anchor.left + anchor.width / 2, 0);
  expect(origin).toBe(`${card.width / 2}px 0px`);
});

test('a list row\'s Comment box sits 4px under the row, centred on it', async ({ page }) => {
  // notion-motion.md Round 61 §2: + 4.2 under the row. Its centre x is 887 on a row centred at 885 (anchor unread).
  await mount(page, withView({ type: 'list' }));
  await page.locator('[data-blok-database-list-row][data-row-id="r1"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Comment/ }).click();

  const { card, anchor, origin } = await commentBoxAgainst(page, '[data-blok-database-list-row][data-row-id="r1"]');

  expect(card.top - anchor.bottom).toBeCloseTo(4, 0);
  expect(card.left + card.width / 2).toBeCloseTo(anchor.left + anchor.width / 2, 0);
  expect(origin).toBe(`${card.width / 2}px 0px`);
});

test('a table row\'s Comment box near the window bottom sits 4px above the row and grows from its bottom centre', async ({ page }) => {
  // notion-motion.md Round 61 §2: flipped, bottom = row top − 4; it scales from its bottom centre.
  const rowBottom = await page.locator('[data-blok-database-table-row][data-row-id="r1"]').evaluate((el) => el.getBoundingClientRect().bottom);

  await page.setViewportSize({ width: 1400, height: Math.ceil(rowBottom) + 20 });
  await titleCell(page).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Comment/ }).click();

  const { card, anchor, origin } = await commentBoxAgainst(page, '[data-blok-database-table-row][data-row-id="r1"]');

  expect(anchor.top - card.bottom).toBeCloseTo(4, 0);
  expect(origin).toBe(`${card.width / 2}px ${card.height}px`);
});

// notion-motion.md Round 62 §2: Mention puts "@" in the text and opens the menu above the box, its left 22 before the "@".
test('Mention opens the "@" menu above the comment box; Escape closes only the menu; Enter picks Today', async ({ page }) => {
  await titleCell(page).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Comment/ }).click();
  await expect(composer(page)).toBeFocused();
  await composer(page).evaluate(async (input) => {
    await Promise.all(input.closest('[data-blok-popover-container]')?.getAnimations().map((animation) => animation.finished) ?? []);
  });
  await composer(page).pressSequentially('see ');
  await page.getByRole('button', { name: 'Mention a person, page, or date' }).click();

  const menu = page.getByRole('listbox', { name: 'Mention a person, page, or date' });

  await expect(menu).toBeVisible();
  await expect(composer(page)).toHaveValue('see @');
  await expect(composer(page)).toBeFocused();
  await menu.evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((animation) => animation.finished));
  });
  const place = await menu.evaluate((el) => {
    const box = document.querySelector('[data-blok-database-comment-input]')?.closest('[data-blok-popover-container]')?.getBoundingClientRect();
    const r = el.getBoundingClientRect();

    return { width: r.width, bottom: r.bottom, left: r.left, boxTop: box?.top ?? 0 };
  });

  const at = await composer(page).evaluate((input) => {
    const style = getComputedStyle(input);
    const context = document.createElement('canvas').getContext('2d');

    if (context === null) return 0;
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

    return input.getBoundingClientRect().left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft) + context.measureText('see ').width;
  });

  expect(place.width).toBe(330);
  expect(place.bottom).toBeCloseTo(place.boxTop - 3.5, 0);
  expect(place.left).toBeCloseTo(at - 22, 0);
  await expect(menu.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(composer(page)).toBeVisible();
  await expect(composer(page)).toHaveValue('see @');

  await composer(page).pressSequentially('t');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await page.keyboard.press('Enter');

  const chip = page.getByRole('listitem').locator('[data-blok-database-comment-mention-chip="date"]');

  await expect(chip).toBeVisible();
  const [saved] = await savedComments(page);

  expect(saved.data.mentions).toEqual([expect.objectContaining({ type: 'date', start: 4 })]);
});
