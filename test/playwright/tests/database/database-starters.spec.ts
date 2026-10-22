/**
 * The "New database" panel's Suggested templates (research/27 §1): Tasks
 * Tracker and Projects through the Customize modal, Skills at once. The panel
 * opens on every user insert, so no AI lever is given.
 */

import type { Page } from '@playwright/test';

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
});

test.describe('"More templates" (research/27 §1e, research/30 §10)', () => {
  test('the gallery lists six templates, expands to nine, and Brainstorm Session builds its measured database', async ({ page }) => {
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
    await expect(cards).toHaveCount(9);
    await expect(gallery.getByTestId('database-template-gallery-template-goals')).toContainText('Set team goals, achieve together.');

    await gallery.getByTestId('database-template-gallery-template-brainstorm').click();
    const dialog = page.getByRole('dialog', { name: 'Customize Brainstorm Session' });

    await expect(dialog.getByText('0 hidden properties')).toBeVisible();
    await dialog.getByRole('button', { name: 'Upvote' }).click();
    // One chip, three columns (research/30 B8).
    await expect(dialog.locator('[data-blok-database-starter-preview-row="header"]')).toHaveText('IdeaCreated byPriorityCategory');
    await dialog.getByRole('button', { name: 'Upvote' }).click();
    await dialog.getByRole('button', { name: 'Get started' }).click();
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
    await dialog.getByRole('button', { name: 'Get started' }).click();
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
    await dialog.getByRole('button', { name: 'Get started' }).click();
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
    await dialog.getByRole('button', { name: 'Get started' }).click();
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
    await dialog.getByRole('button', { name: 'Get started' }).click();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();

    await expect(page.locator('[data-blok-database-cell="formula"]')).toHaveText(['Overdue', 'Overdue', 'Overdue']);
  });

  test('the last view card stays on (research/30 B8)', async ({ page }) => {
    await mount(page);
    await insertDatabase(page);
    await page.getByTestId('database-new-database-panel').getByRole('button', { name: 'More templates' }).click();
    await page.getByRole('dialog', { name: 'More templates' }).getByTestId('database-template-gallery-template-documentHub').click();
    const dialog = page.getByRole('dialog', { name: 'Customize Document Hub' });

    await dialog.getByRole('button', { name: 'Get started' }).click();
    await dialog.getByRole('button', { name: 'All Docs' }).click();
    await expect(dialog.getByText('4 hidden properties')).toBeVisible();
    await dialog.getByRole('button', { name: 'My Docs' }).click();
    await expect(dialog.getByRole('button', { name: 'My Docs' })).toHaveAttribute('aria-pressed', 'true');
  });
});
