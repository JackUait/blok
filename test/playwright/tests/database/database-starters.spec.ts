/**
 * The "New database" panel's Suggested templates (research/27 §1): Tasks
 * Tracker and Projects through the Customize modal, Skills at once. The panel
 * opens on every user insert, so no AI lever is given.
 */

import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

interface Property { id: string; name: string; type: string; config?: { options: Array<{ id: string; label: string; color?: string }> } }
interface View { name: string; type: string; groupBy?: string; filters: Array<{ propertyId: string; operator: string; value: unknown }>; timelineZoom?: string; showTimelineTable?: boolean; calculations?: Array<{ id: string; fn: string }> }
interface Database { title?: string; schema: Array<Property & { defaultTemplateId?: string }>; views: View[]; icon?: { glyph: string; color: string }; starter?: string }

const mount = async (page: Page, before: Array<Record<string, unknown>> = []): Promise<void> => {
  await page.evaluate(async (others) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1100px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: [...others, { id: 'p0', type: 'paragraph', data: { text: '' } }] },
      tools: {
        database: {
          class: (window as unknown as Record<string, unknown>).BlokDatabase,
        },
        'database-row': { class: (window as unknown as Record<string, unknown>).BlokDatabaseRow },
      },
    });
    await window.blokInstance.isReady;
  }, before);
};

const insertDatabase = async (page: Page): Promise<void> => {
  await page.locator('[data-blok-id="p0"] [contenteditable]').focus();
  await page.keyboard.type('/database');
  const item = page.getByTestId('toolbox-popover').locator('[data-blok-item-name="database"]:visible');

  await expect(item).toContainText('Database');
  await item.click();
  await expect(page.getByTestId('database-new-database-panel')).toBeVisible();
};

const saved = async (page: Page): Promise<OutputBlockData[]> => page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);

const read = async (page: Page): Promise<{ db: Database; rows: OutputBlockData[]; templates: OutputBlockData[]; children: (id: string | undefined) => OutputBlockData[] }> => {
  const blocks = await saved(page);
  const block = blocks.filter((b) => b.type === 'database').at(-1);
  const templates = blocks.filter((b) => b.type === 'database-row' && b.parent === block?.id && (b.data as { template?: boolean }).template === true);
  const rows = blocks.filter((b) => b.type === 'database-row' && b.parent === block?.id && (b.data as { template?: boolean }).template !== true);

  return { db: block?.data as unknown as Database, rows, templates, children: (id: string | undefined) => blocks.filter((b) => b.parent !== undefined && b.parent === id) };
};

const nameOf = (db: Database, id: string | undefined): string | undefined => db.schema.find((p) => p.id === id)?.name;

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('the panel lists the three Suggested templates, then More templates', async ({ page }) => {
  await mount(page);
  await insertDatabase(page);
  const panel = page.getByTestId('database-new-database-panel');

  await expect(panel.getByText('Suggested', { exact: true })).toBeVisible();
  await expect(panel.locator('[data-blok-database-panel-row]')).toHaveText(['New empty data source', 'Import CSV', 'Tasks Tracker', 'Projects', 'Skills', 'More templates', 'Link to existing data source']);
});

test('Tasks Tracker: Customize, then the measured schema, views and rows; one undo takes it all back', async ({ page }) => {
  await mount(page);
  await insertDatabase(page);
  await page.getByTestId('database-new-database-panel').getByRole('button', { name: 'Tasks Tracker' }).click();

  const dialog = page.getByRole('dialog', { name: 'Customize Tasks Tracker' });

  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Select features to turn on or off')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Priority' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: 'Updated at' })).toHaveAttribute('aria-pressed', 'false');
  await dialog.getByRole('button', { name: 'Get started' }).click();
  await expect(dialog.getByText('Select how you prefer to see your Tasks Tracker')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Checklist' })).toHaveAttribute('aria-pressed', 'false');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole('columnheader', { name: 'Task name' })).toBeVisible();
  await expect(page.getByText('Improve website copy')).toBeVisible();
  const { db, rows, children } = await read(page);

  expect(db.title).toBe('Tasks Tracker');
  expect(db.schema.map((p) => [p.name, p.type])).toEqual([
    ['Task name', 'title'], ['Status', 'status'], ['Assignee', 'person'], ['Due date', 'date'],
    ['Priority', 'select'], ['Task type', 'multiSelect'], ['Description', 'text'], ['Effort level', 'select'],
  ]);
  expect(db.schema.find((p) => p.name === 'Priority')?.config?.options.map((o) => [o.label, o.color])).toEqual([['High', 'red'], ['Medium', 'yellow'], ['Low', 'green']]);
  expect(db.views.map((v) => [v.name, v.type])).toEqual([['All Tasks', 'table'], ['By Status', 'board'], ['My Tasks', 'table']]);
  expect(nameOf(db, db.views[1].groupBy)).toBe('Status');
  expect(db.views[2].filters.map((f) => [nameOf(db, f.propertyId), f.operator, f.value])).toEqual([['Assignee', 'contains', ['me']]]);
  expect(rows.map((r) => (r.data as { title?: string }).title)).toEqual(['Improve website copy', 'Update help center & FAQ', 'Publish release notes']);
  expect(children(rows[0].id).map((b) => b.type)).toEqual(['header', 'paragraph', 'paragraph', 'header', 'list', 'list', 'list', 'header']);

  await page.evaluate(() => window.blokInstance?.history.undo());
  await expect.poll(async () => {
    const back = await read(page);

    return [back.db.title ?? '', back.db.schema.map((p) => p.name), back.rows.length];
  }).toEqual(['', ['Name'], 0]);
});

test('Projects: Gantt is a timeline grouped by Status at Month zoom with the table shown', async ({ page }) => {
  await mount(page);
  await insertDatabase(page);
  await page.getByTestId('database-new-database-panel').getByRole('button', { name: 'Projects' }).click();
  const dialog = page.getByRole('dialog', { name: 'Customize Projects' });

  await dialog.getByRole('button', { name: 'Get started' }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  await expect.poll(async () => (await read(page)).rows.length).toBe(3);
  const { db, rows } = await read(page);
  const gantt = db.views.find((v) => v.name === 'Gantt');

  expect(db.title).toBe('Projects');
  expect(db.schema.map((p) => [p.name, p.type])).toEqual([
    ['Project name', 'title'], ['Assignee', 'person'], ['Priority', 'select'], ['Attach file', 'files'],
    ['End date', 'date'], ['Start date', 'date'], ['Status', 'status'], ['Team', 'multiSelect'],
  ]);
  expect(db.views.map((v) => [v.name, v.type])).toEqual([['By Status', 'board'], ['All Projects', 'table'], ['Gantt', 'timeline']]);
  expect([nameOf(db, gantt?.groupBy), gantt?.timelineZoom, gantt?.showTimelineTable]).toEqual(['Status', 'month', true]);
  expect(rows.map((r) => (r.data as { title?: string }).title)).toEqual(['Quarterly sales planning', 'Revamp new hire onboarding', 'Public launch of iOS app']);
});

test('Skills builds at once: five properties, Count on the title, no rows', async ({ page }) => {
  await mount(page);
  await insertDatabase(page);
  await page.getByTestId('database-new-database-panel').getByRole('button', { name: 'Skills' }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Skill name' })).toBeVisible();
  const { db, rows } = await read(page);

  expect(db.title).toBe('Skills');
  expect(db.schema.map((p) => [p.name, p.type])).toEqual([['Skill name', 'title'], ['Description', 'text'], ['Files', 'files'], ['Tags', 'multiSelect'], ['Created by', 'createdBy']]);
  expect(db.views).toHaveLength(1);
  expect(db.views[0].calculations).toEqual([{ id: db.schema[0].id, fn: 'count' }]);
  expect(rows).toHaveLength(0);
});

const openSettings = async (page: Page): Promise<void> => {
  await page.getByTestId('database-toolbar-settings').click();
};

test('Suggested leaves out a template a database of the page was made from (research/27 §1a, inferred rule)', async ({ page }) => {
  await mount(page, [{
    id: 'used',
    type: 'database',
    data: {
      title: 'Tasks Tracker',
      schema: [{ id: 't', name: 'Task name', type: 'title', position: 'a0' }],
      views: [{ id: 'v', name: 'All Tasks', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v',
      starter: 'tasks',
    },
  }]);
  await insertDatabase(page);

  await expect(page.getByTestId('database-new-database-panel').locator('[data-blok-database-panel-row]'))
    .toHaveText(['New empty data source', 'Import CSV', 'Projects', 'Skills', 'Document Hub', 'More templates', 'Link to existing data source']);
});

test('Tasks Tracker: the database gets its icon, "New task" is the Default template, and "Undo Task database" asks, then drops only the designation', async ({ page }) => {
  await mount(page);
  await insertDatabase(page);
  await page.getByTestId('database-new-database-panel').getByRole('button', { name: 'Tasks Tracker' }).click();
  const dialog = page.getByRole('dialog', { name: 'Customize Tasks Tracker' });

  await dialog.getByRole('button', { name: 'Get started' }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  const icon = page.locator('[data-blok-database-title-row] [data-blok-database-icon="green"]');

  await expect(icon).toBeVisible();
  await expect(icon).toHaveCSS('width', '21px');
  const { db, templates, children } = await read(page);

  expect([db.icon, db.starter]).toEqual([{ glyph: 'check', color: 'green' }, 'tasks']);
  expect(templates.map((tpl) => (tpl.data as { title?: string }).title)).toEqual(['New task']);
  expect(db.schema[0].defaultTemplateId).toBe(templates[0].id);
  expect(children(templates[0].id).map((b) => b.type)).toEqual(['header', 'paragraph', 'paragraph', 'header', 'list', 'list', 'list', 'header']);

  await page.getByTestId('database-toolbar-new-menu').click();
  const entry = page.locator('[data-blok-item-name^="template-"]:visible', { hasText: 'New task' });

  await expect(entry).toContainText('Default');
  await page.keyboard.press('Escape');

  await openSettings(page);
  const before = await read(page);

  await page.getByTestId('database-settings-undo-starter').click();
  const confirm = page.getByRole('alertdialog', { name: 'Undo Task Database?' });

  await expect(confirm).toContainText('Tasks from this database will no longer work with My tasks or Sprints.');
  await confirm.getByRole('button', { name: 'Remove' }).click();
  await expect(confirm).toBeHidden();
  await expect.poll(async () => (await read(page)).db.starter ?? null).toBeNull();
  const after = await read(page);

  // research/33 §3.10: only the designation goes.
  expect([after.db.title, after.db.icon, after.db.schema, after.db.views, after.rows.length, after.templates.length])
    .toEqual([before.db.title, before.db.icon, before.db.schema, before.db.views, before.rows.length, before.templates.length]);
  await expect(icon).toBeVisible();
  await openSettings(page);
  await expect(page.getByTestId('database-settings-undo-starter')).toHaveCount(0);
  await expect(page.getByTestId('database-settings-turn-into')).toHaveText('Turn into');
  await page.keyboard.press('Escape');

  // One undo brings the designation back.
  await page.evaluate(() => window.blokInstance?.history.undo());
  await expect.poll(async () => (await read(page)).db.starter ?? null).toBe('tasks');
  await openSettings(page);
  await expect(page.getByTestId('database-settings-undo-starter')).toHaveText('Undo Task database');
});

// research/33 §3.10: title 16px/500 in rgb(44, 44, 43), body 12px/400, Remove outline red.
// Notion's body grey and red ink fail AA on white, so light keeps Blok's AA inks. Dark was not read.
// research/35 §1.7 read dark: backdrop 0.8, Remove's hairline rgba(255, 104, 92, 0.24) and its red hover, focus on Remove.
for (const [scheme, ink, body, red, hairline, backdrop, hover] of [
  ['light', 'rgb(44, 44, 43)', 'rgb(114, 111, 106)', 'rgb(182, 79, 70)', 'rgba(206, 24, 0, 0.165)', 'rgba(15, 15, 15, 0.6)', 'rgba(223, 16, 0, 0.063)'],
  ['dark', 'rgb(240, 239, 237)', 'rgb(173, 169, 163)', 'rgb(229, 100, 88)', 'rgba(255, 104, 92, 0.24)', 'rgba(15, 15, 15, 0.8)', 'rgba(255, 105, 96, 0.114)'],
] as const) {
  test(`the "Undo Task Database?" confirm draws Notion's look in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await mount(page);
    await insertDatabase(page);
    await page.getByTestId('database-new-database-panel').getByRole('button', { name: 'Tasks Tracker' }).click();
    const dialog = page.getByRole('dialog', { name: 'Customize Tasks Tracker' });

    await dialog.getByRole('button', { name: 'Get started' }).click();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await openSettings(page);
    await page.getByTestId('database-settings-undo-starter').click();
    const confirm = page.getByRole('alertdialog', { name: 'Undo Task Database?' });
    const read = (locator: Locator, props: string[]): Promise<string[]> =>
      locator.evaluate((el, names) => names.map((name) => getComputedStyle(el).getPropertyValue(name)), props);

    expect(await read(confirm.locator('[data-blok-database-confirm-title]'), ['font-weight', 'font-size', 'color'])).toEqual(['500', '16px', ink]);
    expect(await read(confirm.locator('[data-blok-database-confirm-description]'), ['font-size', 'font-weight', 'color'])).toEqual(['12px', '400', body]);
    const remove = confirm.getByRole('button', { name: 'Remove' });

    await expect(remove).toBeFocused();
    expect(await confirm.evaluate((el) => getComputedStyle(el.parentElement ?? el).backgroundColor)).toBe(backdrop);
    expect(await read(remove, ['background-color', 'color', 'border-top-color'])).toEqual(['rgba(0, 0, 0, 0)', red, hairline]);
    await remove.hover();
    await expect.poll(() => read(remove, ['background-color'])).toEqual([hover]);
    await confirm.getByRole('button', { name: 'Cancel' }).click();
  });
}

test('Skills reads "Undo skills database"', async ({ page }) => {
  await mount(page);
  await insertDatabase(page);
  await page.getByTestId('database-new-database-panel').getByRole('button', { name: 'Skills' }).click();
  await expect(page.locator('[data-blok-database-icon="gray"]')).toBeVisible();
  await openSettings(page);
  await expect(page.getByTestId('database-settings-undo-starter')).toHaveText('Undo skills database');
});

test('Projects shows "Turn into" with the Tasks and Skills entries (their effect is unmeasured, so disabled)', async ({ page }) => {
  await mount(page);
  await insertDatabase(page);
  await page.getByTestId('database-new-database-panel').getByRole('button', { name: 'Projects' }).click();
  const dialog = page.getByRole('dialog', { name: 'Customize Projects' });

  await dialog.getByRole('button', { name: 'Get started' }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('[data-blok-database-icon="blue"]')).toBeVisible();
  await openSettings(page);
  await expect(page.getByTestId('database-settings-undo-starter')).toHaveCount(0);
  await page.getByTestId('database-settings-turn-into').click();
  await expect(page.getByTestId('database-settings-turn-into-tasks')).toHaveText('Turn into Tasks database');
  await expect(page.getByTestId('database-settings-turn-into-skills')).toHaveText('Turn into Skills database');
  await expect(page.getByTestId('database-settings-turn-into-tasks')).toBeDisabled();
  await expect(page.getByTestId('database-settings-turn-into-skills')).toBeDisabled();
  // Every entry is disabled, so focus must still land in the panel, and going back returns it to the row.
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('database-settings-turn-into')).toBeFocused();
});

test.describe('"More templates" (research/27 §1e, research/30 §10)', () => {
  test('the gallery lists six templates, expands to all 21, and Brainstorm Session builds its measured database', async ({ page }) => {
    const errors: string[] = [];

    page.on('pageerror', (error) => errors.push(error.message));
    await mount(page);
    await insertDatabase(page);
    await page.getByTestId('database-new-database-panel').getByRole('button', { name: 'More templates' }).click();
    const gallery = page.getByRole('dialog', { name: 'More templates' });

    await expect(gallery.getByRole('textbox', { name: 'Search' })).toBeFocused();
    await expect(gallery.getByTestId('database-template-gallery-empty')).toContainText('Empty database');
    const cards = gallery.locator('[data-blok-testid^="database-template-gallery-template-"]:visible');

    await expect(cards).toHaveCount(6);
    await gallery.getByRole('button', { name: 'More templates' }).click();
    // research/31 §7: the full list, in Notion's order.
    await expect(cards).toHaveCount(21);
    expect(await cards.evaluateAll((list) => list.map((card) => card.getAttribute('data-blok-testid')?.replace('database-template-gallery-template-', '')))).toEqual([
      'tasks', 'projects', 'skills', 'documentHub', 'brainstorm', 'meetingNotes', 'goals', 'campaign', 'contentCalendar',
      'events', 'socialMedia', 'issues', 'featureRequests', 'engineeringDocs', 'fundraising', 'pipeline', 'accounts', 'creative', 'inventory', 'roadmap', 'assets',
    ]);
    await expect(gallery.getByTestId('database-template-gallery-template-goals')).toContainText('Set team goals, achieve together.');
    await expect(gallery.getByTestId('database-template-gallery-template-assets')).toContainText('Create shared design assets.');

    await gallery.getByTestId('database-template-gallery-template-brainstorm').click();
    const dialog = page.getByRole('dialog', { name: 'Customize Brainstorm Session' });

    await expect(dialog.getByText('0 hidden properties')).toBeVisible();
    await dialog.getByRole('button', { name: 'Upvote' }).click();
    // One chip, three columns (research/30 B8).
    await expect(dialog.locator('[data-blok-database-starter-preview-row="header"]')).toHaveText('IdeaCreated byPriorityCategory');
    await dialog.getByRole('button', { name: 'Upvote' }).click();
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();

    await expect.poll(async () => {
      const { db, rows } = await read(page);

      return [db.title, db.schema.map((p) => [p.name, p.type]), db.views.map((v) => [v.name, v.type, nameOf(db, v.groupBy)]), rows.map((r) => (r.data as { title?: string }).title), db.icon, db.starter];
    }).toEqual([
      'Brainstorm Session',
      [['Idea', 'title'], ['Created by', 'createdBy'], ['Priority', 'select'], ['Category', 'multiSelect'], ['Upvote', 'button'], ['Total votes', 'formula'], ['Upvoted by', 'person']],
      [['All Ideas', 'table', undefined], ['By category', 'board', 'Category']],
      ['Launch back to school campaign', 'Simplify onboarding experience', 'Improve SEO'],
      { glyph: 'idea', color: 'orange' },
      'brainstorm',
    ]);
    // Upvote has no actions and Total votes no expression: the table still draws every row.
    await expect(page.getByText('Improve SEO')).toBeVisible();
    expect(errors).toEqual([]);
  });

  const openTemplate = async (page: Page, id: string, name: string): Promise<ReturnType<Page['getByRole']>> => {
    await mount(page);
    await insertDatabase(page);
    await page.getByTestId('database-new-database-panel').getByRole('button', { name: 'More templates' }).click();
    const gallery = page.getByRole('dialog', { name: 'More templates' });

    await gallery.getByRole('button', { name: 'More templates' }).click();
    await gallery.getByTestId(`database-template-gallery-template-${id}`).click();

    return page.getByRole('dialog', { name: `Customize ${name}` });
  };

  test('Campaign Management builds its measured board, table and calendar, with a purple flag (research/31 §7a)', async ({ page }) => {
    const errors: string[] = [];

    page.on('pageerror', (error) => errors.push(error.message));
    const dialog = await openTemplate(page, 'campaign', 'Campaign Management');

    await expect(dialog.getByText('3 hidden properties')).toBeVisible();
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();

    await expect.poll(async () => {
      const { db, rows } = await read(page);

      return [db.title, db.schema.map((p) => [p.name, p.type]), db.views.map((v) => [v.name, v.type, nameOf(db, v.groupBy)]), rows.map((r) => (r.data as { title?: string }).title), db.icon, db.starter];
    }).toEqual([
      'Campaign Management',
      [['Campaign name', 'title'], ['Channels', 'multiSelect'], ['Markets', 'multiSelect'], ['Campaign type', 'multiSelect'], ['Audiences targeted', 'multiSelect'], ['Completion date', 'date'], ['Files & media', 'files'], ['Status', 'status']],
      [['By Status', 'board', 'Status'], ['All Campaigns', 'table', undefined], ['Calendar', 'calendar', undefined]],
      ['New mobile app', 'Engineering content', 'Win the market'],
      { glyph: 'flag', color: 'purple' },
      'campaign',
    ]);
    const icon = page.locator('[data-blok-database-icon="purple"]');

    await expect(icon).toBeVisible();
    // The tile takes Blok's purple block colour, not the gray fallback.
    expect(await icon.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(await page.evaluate(() => {
      const probe = document.createElement('span');

      probe.setAttribute('data-blok-database-icon', 'gray');
      document.body.appendChild(probe);
      const gray = getComputedStyle(probe).backgroundColor;

      probe.remove();

      return gray;
    }));
    await expect(page.getByText('New mobile app')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('Content Calendar opens on its calendar by Film date (research/31 §7b)', async ({ page }) => {
    const dialog = await openTemplate(page, 'contentCalendar', 'Content Calendar');

    await expect(dialog.getByText('7 hidden properties')).toBeVisible();
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();

    await expect.poll(async () => {
      const { db, rows } = await read(page);

      return [db.views.map((v) => [v.name, v.type]), rows.map((r) => (r.data as { title?: string }).title)];
    }).toEqual([[['Calendar', 'calendar'], ['All Content', 'table'], ['By Status', 'board']], ['Product launch', 'Opinion piece', 'Blog post']]);
    await expect(page.locator('[data-blok-database-calendar-weekdays]')).toBeVisible();
  });

  test('Goals Tracker with Quarter and Progress on: Progress reads 75%, 0% and an uncapped 125% (research/31 §8)', async ({ page }) => {
    const dialog = await openTemplate(page, 'goals', 'Goals Tracker');

    await expect(dialog.getByRole('button', { name: 'Quarter' })).toHaveAttribute('aria-pressed', 'false');
    await expect(dialog.getByRole('button', { name: 'Days until due' })).toHaveAttribute('aria-pressed', 'false');
    await dialog.getByRole('button', { name: 'Quarter' }).click();
    await dialog.getByRole('button', { name: 'Progress' }).click();
    await expect(dialog.locator('[data-blok-database-starter-preview-row="header"]')).toHaveText('Goal nameOwnerStatusDue datePriorityQuarterTeamStart valueEnd valueProgress');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();

    const progress = page.locator('[data-blok-database-cell="formula"] [data-blok-database-number-text]');

    await expect(progress).toHaveText(['75%', '0%', '125%']);
    await expect(page.locator('[data-blok-database-cell="formula"] [data-blok-database-number-bar]').nth(2)).toHaveAttribute('style', /--blok-database-number-fill: 100%/);
  });

  test('Goals Tracker with Days until due on: the 2025 sample rows read Overdue (research/31 §8)', async ({ page }) => {
    const dialog = await openTemplate(page, 'goals', 'Goals Tracker');

    await dialog.getByRole('button', { name: 'Days until due' }).click();
    await expect(dialog.getByRole('button', { name: 'Days until due' })).toHaveAttribute('aria-pressed', 'true');
    // The preview puts it last, as measured; the created database keeps it after Due date.
    await expect(dialog.locator('[data-blok-database-starter-preview-row="header"]')).toHaveText('Goal nameOwnerStatusDue datePriorityTeamDays until due');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();

    await expect(page.locator('[data-blok-database-cell="formula"]')).toHaveText(['Overdue', 'Overdue', 'Overdue']);
  });

  // research/33 §3: each template with its defaults kept: the Customize footer, the views, the default page template and the rows.
  const ROUND12: Array<{ id: string; name: string; hidden: number; views: Array<[string, string]>; template: string; rows: number; icon: { glyph: string; color: string } }> = [
    { id: 'events', name: 'Event Management', hidden: 0, views: [['All Events', 'table'], ['By Status', 'board'], ['Calendar', 'calendar']], template: 'New event', rows: 3, icon: { glyph: 'ticket', color: 'purple' } },
    { id: 'socialMedia', name: 'Social Media Planner', hidden: 6, views: [['Calendar', 'calendar'], ['All Posts', 'table'], ['By Status', 'board']], template: 'New post', rows: 3, icon: { glyph: 'feed', color: 'purple' } },
    { id: 'issues', name: 'Issue Tracking', hidden: 2, views: [['Kanban', 'board'], ['All Issues', 'table'], ['My Issues', 'list']], template: 'New issue', rows: 0, icon: { glyph: 'check', color: 'red' } },
    { id: 'featureRequests', name: 'Feature Requests', hidden: 5, views: [['By Status', 'board'], ['All Requests', 'table'], ['Assigned to Me', 'table']], template: 'New request', rows: 0, icon: { glyph: 'comment', color: 'red' } },
    { id: 'engineeringDocs', name: 'Engineering Docs', hidden: 0, views: [['All Docs', 'table'], ['Published Docs', 'list'], ['Docs by Category', 'table']], template: 'New document', rows: 0, icon: { glyph: 'doc', color: 'red' } },
    { id: 'fundraising', name: 'Fundraising Tracker', hidden: 5, views: [['By Status', 'board'], ['All Investors', 'table'], ['Won', 'table']], template: 'New investor', rows: 0, icon: { glyph: 'currency', color: 'gray' } },
    { id: 'pipeline', name: 'Pipeline Tracking', hidden: 5, views: [['By Deal Stage', 'board'], ['All Deals', 'table'], ['Active Deals', 'table']], template: 'New deal', rows: 0, icon: { glyph: 'person', color: 'blue' } },
    { id: 'accounts', name: 'Account Management', hidden: 3, views: [['By Status', 'board'], ['All Accounts', 'table'], ['By Region', 'table']], template: 'New account', rows: 0, icon: { glyph: 'card', color: 'blue' } },
    { id: 'creative', name: 'Creative Projects', hidden: 2, views: [['By Status', 'board'], ['All Projects', 'table'], ['My Projects', 'table']], template: 'New project', rows: 0, icon: { glyph: 'paintBrush', color: 'blue' } },
    { id: 'inventory', name: 'Inventory Management', hidden: 0, views: [['All Inventory', 'table'], ['Recently Ordered', 'list']], template: 'New item', rows: 0, icon: { glyph: 'package', color: 'gray' } },
    { id: 'roadmap', name: 'Product Roadmap', hidden: 4, views: [['By Status', 'board'], ['All Projects', 'table'], ['My Projects', 'table'], ['By Team', 'list']], template: 'New project', rows: 0, icon: { glyph: 'map', color: 'pink' } },
    { id: 'assets', name: 'Asset Library', hidden: 4, views: [['Gallery', 'gallery'], ['All Assets', 'table'], ['By Status', 'board']], template: 'New asset', rows: 0, icon: { glyph: 'fanDeck', color: 'green' } },
  ];

  for (const spec of ROUND12) {
    test(`${spec.name} applies its measured schema and views (research/33 §3)`, async ({ page }) => {
      const errors: string[] = [];

      page.on('pageerror', (error) => errors.push(error.message));
      const dialog = await openTemplate(page, spec.id, spec.name);

      await expect(dialog.getByText(`${spec.hidden} hidden properties`)).toBeVisible();
      await dialog.getByRole('button', { name: 'Continue' }).click();
      await dialog.getByRole('button', { name: 'Done' }).click();
      await expect(dialog).toBeHidden();

      await expect.poll(async () => {
        const { db, rows, templates } = await read(page);

        return [db.title, db.starter, db.icon, db.views.map((v) => [v.name, v.type]), templates.map((tpl) => (tpl.data as { title?: string }).title).at(0), rows.length];
      }).toEqual([spec.name, spec.id, spec.icon, spec.views, spec.template, spec.rows]);
      await expect(page.locator(`[data-blok-database-icon="${spec.icon.color}"]`).first()).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  // research/33 §3.13: the first path of each glyph Blok drew for Notion's ticket, feed, currency, card,
  // paint brush, package and fan deck. The database glyph used to stand in for all seven.
  const TEMPLATE_GLYPHS: Array<[string, string]> = [
    ['events', 'M5 5h10a2 2 0 0 1 2 2v1.5a1.5 1.5 0 0 0 0 3V13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.5a1.5 1.5 0 0 0 0-3V7a2 2 0 0 1 2-2Z'],
    ['socialMedia', 'M5 4h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z'],
    ['fundraising', 'M12.25 8.1c-.3-.7-1.2-1.1-2.25-1.1-1.25 0-2.25.6-2.25 1.5 0 2 4.5 1 4.5 3 0 .9-1 1.5-2.25 1.5-1.05 0-1.95-.4-2.25-1.1M10 6v1M10 13v1'],
    ['accounts', 'M3 8.5h14M6 12h2.5'],
    ['creative', 'M8.75 8V4.25a1.25 1.25 0 0 1 2.5 0V8'],
    ['inventory', 'M10 2.75 16.5 6.25v7.5L10 17.25 3.5 13.75v-7.5L10 2.75Z'],
    ['assets', 'M3.5 14.75V4.5A1.5 1.5 0 0 1 5 3h1.5A1.5 1.5 0 0 1 8 4.5v10.25a2.25 2.25 0 0 1-4.5 0Z'],
  ];

  test('each "More templates" tile draws its Notion glyph, not the database glyph (research/33 §3.13)', async ({ page }) => {
    await mount(page);
    await insertDatabase(page);
    await page.getByTestId('database-new-database-panel').getByRole('button', { name: 'More templates' }).click();
    const gallery = page.getByRole('dialog', { name: 'More templates' });

    await gallery.getByRole('button', { name: 'More templates' }).click();
    for (const [id, d] of TEMPLATE_GLYPHS) {
      await expect(gallery.getByTestId(`database-template-gallery-template-${id}`).locator('[data-blok-database-tpl-gallery-glyph] svg path').first()).toHaveAttribute('d', d);
    }
  });

  for (const [id, d] of TEMPLATE_GLYPHS) {
    test(`the ${id} database draws its template glyph before the title (research/33 §3.8)`, async ({ page }) => {
      const dialog = await openTemplate(page, id, ROUND12.find((spec) => spec.id === id)?.name ?? '');

      await dialog.getByRole('button', { name: 'Continue' }).click();
      await dialog.getByRole('button', { name: 'Done' }).click();
      await expect(dialog).toBeHidden();
      await expect(page.locator('[data-blok-database-title-row] [data-blok-database-icon] svg path').first()).toHaveAttribute('d', d);
    });
  }

  test('Issue Tracking opens on its Kanban: every status column is drawn and each reads "New issue"', async ({ page }) => {
    const dialog = await openTemplate(page, 'issues', 'Issue Tracking');

    await dialog.getByRole('button', { name: 'Continue' }).click();
    await dialog.getByRole('button', { name: 'Done' }).click();
    // Seven statuses, all empty: Hide empty groups is saved off (research/33 §3.3). No row lacks a status, so no "No Status" (6bae8a6f).
    await expect(page.locator('[data-blok-database-add-card]')).toHaveText(Array<string>(7).fill('New issue'));
  });

  test('Event Management draws its three measured rows', async ({ page }) => {
    const dialog = await openTemplate(page, 'events', 'Event Management');

    await dialog.getByRole('button', { name: 'Continue' }).click();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('Make with Notion')).toBeVisible();
    await expect(page.getByText('Fireside chat with Ivan Zhao')).toBeVisible();
    await expect(page.getByText('VIP dinner')).toBeVisible();
  });

  test('the last view card stays on (research/30 B8)', async ({ page }) => {
    await mount(page);
    await insertDatabase(page);
    await page.getByTestId('database-new-database-panel').getByRole('button', { name: 'More templates' }).click();
    await page.getByRole('dialog', { name: 'More templates' }).getByTestId('database-template-gallery-template-documentHub').click();
    const dialog = page.getByRole('dialog', { name: 'Customize Document Hub' });

    await dialog.getByRole('button', { name: 'Continue' }).click();
    await dialog.getByRole('button', { name: 'All Docs' }).click();
    await expect(dialog.getByText('4 hidden properties')).toBeVisible();
    await dialog.getByRole('button', { name: 'My Docs' }).click();
    await expect(dialog.getByRole('button', { name: 'My Docs' })).toHaveAttribute('aria-pressed', 'true');
  });
});

// research/36 §8.1 (dump notion-measure36/raw/dlg-undotask-light.json): box 324x193; from its top, the title
// text at 23 (19 tall), the two-line text 50 to 86, Remove at 100, Cancel at 141, each 32 tall, 20px padding below.
test('the "Undo Task Database?" confirm is Notion\'s 324x193 box, its parts where Notion put them', async ({ page }) => {
  await mount(page);
  await insertDatabase(page);
  await page.getByTestId('database-new-database-panel').getByRole('button', { name: 'Tasks Tracker' }).click();
  const dialog = page.getByRole('dialog', { name: 'Customize Tasks Tracker' });

  await dialog.getByRole('button', { name: 'Get started' }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await openSettings(page);
  await page.getByTestId('database-settings-undo-starter').click();
  const confirm = page.getByRole('alertdialog', { name: 'Undo Task Database?' });

  await expect(confirm.getByRole('button', { name: 'Remove' })).toBeFocused();
  const layout = await confirm.evaluate(async (box) => {
    // The open animation scales the box.
    await Promise.all(box.getAnimations().map((animation) => animation.finished));
    const top = box.getBoundingClientRect().top;
    const rect = (selector: string): number[] => {
      const r = box.querySelector(selector)?.getBoundingClientRect();

      return r === undefined ? [] : [Math.round(r.top - top), Math.round(r.height)];
    };
    const description = box.querySelector('[data-blok-database-confirm-description]');
    const lines = description === null ? 0 : Math.round(description.getBoundingClientRect().height / parseFloat(getComputedStyle(description).lineHeight));

    return {
      box: [Math.round(box.getBoundingClientRect().width), Math.round(box.getBoundingClientRect().height)],
      description: rect('[data-blok-database-confirm-description]'),
      lines,
      remove: rect('[data-blok-database-confirm-action="confirm"]'),
      cancel: rect('[data-blok-database-confirm-action="cancel"]'),
    };
  });

  expect(layout).toEqual({ box: [324, 193], description: [50, 36], lines: 2, remove: [100, 32], cancel: [141, 32] });
  await confirm.getByRole('button', { name: 'Cancel' }).click();
});

