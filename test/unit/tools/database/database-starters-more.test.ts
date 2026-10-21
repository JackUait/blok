import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { englishDictionary } from '../../../../src/components/i18n/lightweight-i18n';
import { DATABASE_STARTERS, buildStarter, galleryStarters, hiddenPropertyCount, suggestedStarters } from '../../../../src/tools/database/database-starters';
import type { StarterBuild, StarterId } from '../../../../src/tools/database/database-starters';
import type { PropertyDefinition } from '../../../../src/tools/database/types';

const dictionary: Record<string, string> = englishDictionary;
const t = (key: string, vars: Record<string, string> = {}): string => {
  const text = dictionary[key];

  if (text === undefined) throw new Error(`missing key ${key}`);

  return text.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? '');
};

const counter = { next: 0 };
const newId = (): string => {
  counter.next += 1;

  return `id${counter.next}`;
};
const meta = (id: StarterId): (typeof DATABASE_STARTERS)[number] => {
  const found = DATABASE_STARTERS.find((s) => s.id === id);

  if (found === undefined) throw new Error(`no starter ${id}`);

  return found;
};
const idsOf = (id: StarterId, kind: 'features' | 'views', names: string[]): string[] =>
  meta(id)[kind].filter((c) => names.includes(t(c.labelKey))).map((c) => c.id);
const build = (id: StarterId, choices: { features?: string[]; views?: string[] } = {}): StarterBuild =>
  buildStarter(id, {
    t,
    newId,
    titleId: 'old-title',
    ...(choices.features === undefined ? {} : { features: new Set(idsOf(id, 'features', choices.features)) }),
    ...(choices.views === undefined ? {} : { views: new Set(idsOf(id, 'views', choices.views)) }),
  });
const prop = (made: StarterBuild, name: string): PropertyDefinition => {
  const found = made.schema.find((p) => p.name === name);

  if (found === undefined) throw new Error(`no property ${name}`);

  return found;
};
const options = (made: StarterBuild, name: string): Array<[string, string | undefined]> =>
  (prop(made, name).config?.options ?? []).map((o) => [o.label, o.color]);
const viewNamed = (made: StarterBuild, name: string): StarterBuild['views'][number] => {
  const found = made.views.find((v) => v.name === name);

  if (found === undefined) throw new Error(`no view ${name}`);

  return found;
};
const shownNames = (made: StarterBuild, name: string): string[] =>
  viewNamed(made, name).visibleProperties.map((id) => made.schema.find((p) => p.id === id)?.name ?? id);
const valueOf = (made: StarterBuild, row: number, name: string): unknown => made.rows[row].data.properties[prop(made, name).id];
const labelsOf = (made: StarterBuild, name: string, row: number): string[] => {
  const value = valueOf(made, row, name);
  const ids = Array.isArray(value) ? value : [value];

  return ids.map((id) => prop(made, name).config?.options.find((o) => o.id === id)?.label ?? String(id));
};
const on = (id: StarterId, kind: 'features' | 'views', state: boolean): string[] =>
  meta(id)[kind].filter((c) => c.on === state).map((c) => t(c.labelKey));
const meName = (made: StarterBuild, view: string): Array<[string, string, unknown]> =>
  (viewNamed(made, view).filters ?? []).map((f) => [made.schema.find((p) => p.id === f.propertyId)?.name ?? '', f.operator, f.value]);

describe('"More templates" (research/27 §1e, research/30 §10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    counter.next = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists the seven templates whose schema was measured, in Notion\'s order, each with its measured description', () => {
    expect(DATABASE_STARTERS.map((s) => [t(s.nameKey), t(s.descriptionKey)])).toEqual([
      ['Tasks Tracker', 'Stay organized with tasks, your way.'],
      ['Projects', 'Manage projects start to finish.'],
      ['Skills', 'Save reusable instructions for agents.'],
      ['Document Hub', 'Collaborate on docs in one hub.'],
      ['Brainstorm Session', 'Spark new ideas together.'],
      ['Meeting Notes', 'Turn meetings into action.'],
      ['Goals Tracker', 'Set team goals, achieve together.'],
    ]);
  });

  it('Suggested moves up exactly as measured after each use (research/27 §1a)', () => {
    const names = (used: StarterId[]): string[] => suggestedStarters(new Set(used)).map((s) => t(s.nameKey));

    expect(names([])).toEqual(['Tasks Tracker', 'Projects', 'Skills']);
    expect(names(['tasks'])).toEqual(['Projects', 'Skills', 'Document Hub']);
    expect(names(['tasks', 'projects'])).toEqual(['Skills', 'Document Hub', 'Brainstorm Session']);
    expect(names(['tasks', 'projects', 'skills'])).toEqual(['Document Hub', 'Brainstorm Session', 'Meeting Notes']);
  });

  it('the gallery lists unused templates first; with the first three used it reads as research/27 §1e', () => {
    const names = (used: StarterId[]): string[] => galleryStarters(new Set(used)).map((s) => t(s.nameKey));

    expect(names([])).toEqual(['Tasks Tracker', 'Projects', 'Skills', 'Document Hub', 'Brainstorm Session', 'Meeting Notes', 'Goals Tracker']);
    expect(names(['tasks', 'projects', 'skills'])).toEqual(['Document Hub', 'Brainstorm Session', 'Meeting Notes', 'Goals Tracker', 'Tasks Tracker', 'Projects', 'Skills']);
  });

  it('each card carries the measured thumbnail text (research/30 §10a)', () => {
    expect(DATABASE_STARTERS.map((s) => [...s.thumbnail.columns, ...s.thumbnail.pills.map(([key]) => key)].map((key) => t(key)))).toEqual([
      ['Task name', 'Status', 'Assignee', 'Not started', 'In progress', 'Done'],
      ['Not started', 'In progress', 'Done'],
      ['Skill name', 'Description', 'Files'],
      ['Doc name', 'Created by', 'Created time'],
      ['Idea', 'Created by', 'Priority', 'Medium', 'Low', 'High'],
      ['Meeting name', 'Date', 'Category', 'Presentation', 'Planning', 'Standup'],
      ['Goal name', 'Owner', 'Status', 'Not started', 'In progress', 'Done'],
    ]);
    // The pill colours are the options' own (research/27 shot 07-08).
    expect(DATABASE_STARTERS.find((s) => s.id === 'meetingNotes')?.thumbnail.pills.map(([, color]) => color)).toEqual(['yellow', 'blue', 'red']);
  });

  it('Customize chips and view cards start as measured; unmeasured types are not offered', () => {
    expect(on('documentHub', 'features', true)).toEqual(['Created time', 'Category', 'Last edited by', 'Last updated time']);
    expect(on('documentHub', 'features', false)).toEqual(['Reviewers']);
    expect(on('documentHub', 'views', true)).toEqual(['All Docs', 'My Docs']);
    expect(on('documentHub', 'views', false)).toEqual(['By Category']);
    expect(on('brainstorm', 'features', true)).toEqual(['Created by', 'Priority', 'Upvote']);
    expect(on('brainstorm', 'features', false)).toEqual(['Status']);
    expect(on('brainstorm', 'views', true)).toEqual(['All Ideas', 'By category']);
    expect(on('brainstorm', 'views', false)).toEqual(['Top Ideas']);
    expect(on('meetingNotes', 'features', true)).toEqual(['Date', 'Category', 'Attendees']);
    expect(on('meetingNotes', 'features', false)).toEqual(['Last edited by', 'Last updated time']);
    expect(on('meetingNotes', 'views', true)).toEqual(['All Meetings', 'My Notes']);
    expect(on('meetingNotes', 'views', false)).toEqual(['By Category']);
    // Quarter, Progress and Days until due were measured as names only: no type, so no chip.
    expect(on('goals', 'features', true)).toEqual(['Due date', 'Priority', 'Team']);
    expect(on('goals', 'features', false)).toEqual([]);
    expect(on('goals', 'views', true)).toEqual(['All Goals', 'By Status', 'My Goals']);
    expect(on('goals', 'views', false)).toEqual(['By Team']);
  });

  describe('Document Hub (research/30 §10c)', () => {
    it('has the measured properties, types, options and date settings', () => {
      const made = build('documentHub');

      expect(made.title).toBe('Document Hub');
      expect(made.schema.map((p) => [p.name, p.type])).toEqual([
        ['Doc name', 'title'], ['Category', 'multiSelect'], ['Created by', 'createdBy'], ['Created time', 'createdTime'],
        ['Last edited by', 'lastEditedBy'], ['Last updated time', 'lastEditedTime'],
      ]);
      expect(made.schema[0].id).toBe('old-title');
      expect(options(made, 'Category')).toEqual([['Proposal', 'yellow'], ['Customer research', 'blue'], ['Strategy doc', 'orange'], ['Planning', 'red']]);
      expect(prop(made, 'Created time').date).toEqual({ dateFormat: 'full', timeFormat: '12_hour' });
      expect(prop(made, 'Last updated time').date).toEqual({ dateFormat: 'full', timeFormat: '12_hour' });
    });

    it('has All Docs (all six) and My Docs (Doc name, Category; Created by contains Me)', () => {
      const made = build('documentHub');

      expect(made.views.map((v) => [v.name, v.type])).toEqual([['All Docs', 'table'], ['My Docs', 'table']]);
      expect(shownNames(made, 'All Docs')).toEqual(['Category', 'Created by', 'Created time', 'Last edited by', 'Last updated time']);
      expect(viewNamed(made, 'All Docs')).toMatchObject({ loadLimit: 50, openPagesIn: 'side' });
      expect(shownNames(made, 'My Docs')).toEqual(['Category']);
      expect(meName(made, 'My Docs')).toEqual([['Created by', 'contains', ['me']]]);
      expect(viewNamed(made, 'My Docs')).toMatchObject({ loadLimit: 50 });
    });

    it('has the three measured rows and their categories; no page icons or bodies', () => {
      const made = build('documentHub');

      expect(made.rows.map((r) => r.data.title)).toEqual(['Company mission and strategy', 'Proposal for new year campaign', 'Customer feedback report']);
      expect(made.rows.map((_, i) => labelsOf(made, 'Category', i))).toEqual([['Strategy doc'], ['Proposal'], ['Customer research']]);
      expect(made.rows.map((r) => [r.data.icon, r.body])).toEqual([[undefined, []], [undefined, []], [undefined, []]]);
      expect(made.templates).toEqual([]);
    });

    it('Reviewers on adds a person column after Category; Category off removes the column and its values (B8)', () => {
      const withReviewers = build('documentHub', { features: ['Created time', 'Category', 'Last edited by', 'Last updated time', 'Reviewers'] });

      expect(shownNames(withReviewers, 'All Docs').slice(0, 2)).toEqual(['Category', 'Reviewers']);
      expect(prop(withReviewers, 'Reviewers').type).toBe('person');
      const noCategory = build('documentHub', { features: ['Created time', 'Last edited by', 'Last updated time'] });

      expect(noCategory.schema.map((p) => p.name)).not.toContain('Category');
      expect(noCategory.rows.every((r) => Object.keys(r.data.properties).every((id) => noCategory.schema.some((p) => p.id === id)))).toBe(true);
    });

    it('By Category on adds a third view grouped by Category (layout unmeasured: a table)', () => {
      const made = build('documentHub', { views: ['All Docs', 'My Docs', 'By Category'] });

      expect(made.views.map((v) => v.name)).toEqual(['All Docs', 'My Docs', 'By Category']);
      expect(viewNamed(made, 'By Category').groupBy).toBe(prop(made, 'Category').id);
    });
  });

  describe('Brainstorm Session (research/30 §10d)', () => {
    it('has the measured properties; the Upvote chip stands for Upvote, Total votes and Upvoted by', () => {
      const made = build('brainstorm');

      expect(made.title).toBe('Brainstorm Session');
      expect(made.schema.map((p) => [p.name, p.type])).toEqual([
        ['Idea', 'title'], ['Created by', 'createdBy'], ['Priority', 'select'], ['Category', 'multiSelect'],
        ['Upvote', 'button'], ['Total votes', 'formula'], ['Upvoted by', 'person'],
      ]);
      expect(options(made, 'Priority')).toEqual([['High', 'red'], ['Medium', 'yellow'], ['Low', 'green']]);
      expect(options(made, 'Category')).toEqual([['Top of funnel', 'yellow'], ['Activation', 'orange'], ['Conversion', 'blue']]);
      // The button's actions and the formula's expression were not read: neither is made up.
      expect(prop(made, 'Upvote').button).toBeUndefined();
      expect(prop(made, 'Total votes').formula).toBeUndefined();
      expect(build('brainstorm', { features: ['Created by', 'Priority'] }).schema.map((p) => p.name)).toEqual(['Idea', 'Created by', 'Priority', 'Category']);
    });

    it('Status on adds a status column right after the title (B8)', () => {
      const made = build('brainstorm', { features: ['Created by', 'Priority', 'Upvote', 'Status'] });

      expect(made.schema.slice(0, 2).map((p) => [p.name, p.type])).toEqual([['Idea', 'title'], ['Status', 'status']]);
      expect(shownNames(made, 'All Ideas')[0]).toBe('Status');
      // Notion's sample value "New idea" belongs to options that were not read: rows get none.
      expect(made.rows.every((r) => r.data.properties[prop(made, 'Status').id] === undefined)).toBe(true);
    });

    it('has All Ideas (all seven) and a By category board grouped by Category, Idea only', () => {
      const made = build('brainstorm');
      const board = viewNamed(made, 'By category');

      expect(made.views.map((v) => [v.name, v.type])).toEqual([['All Ideas', 'table'], ['By category', 'board']]);
      expect(shownNames(made, 'All Ideas')).toHaveLength(6);
      expect(viewNamed(made, 'All Ideas')).toMatchObject({ showPageIcon: false, wrapCells: false, showVerticalLines: true, loadLimit: 50, openPagesIn: 'side' });
      expect(board.groupBy).toBe(prop(made, 'Category').id);
      expect(board.visibleProperties).toEqual([]);
      expect(board).toMatchObject({ loadLimit: 25, cardPreview: 'none', cardSize: 'medium', showPageIcon: true, wrapCells: true, groupSettings: { sort: 'manual', hideEmptyGroups: false, colorColumns: true } });
    });

    it('Top Ideas on adds a view showing Idea and Created by', () => {
      const made = build('brainstorm', { views: ['All Ideas', 'By category', 'Top Ideas'] });

      expect(shownNames(made, 'Top Ideas')).toEqual(['Created by']);
    });

    it('has the three measured rows', () => {
      const made = build('brainstorm');

      expect(made.rows.map((r) => r.data.title)).toEqual(['Launch back to school campaign', 'Simplify onboarding experience', 'Improve SEO']);
      expect(made.rows.map((_, i) => labelsOf(made, 'Priority', i))).toEqual([['High'], ['Medium'], ['Low']]);
      expect(made.rows.map((_, i) => labelsOf(made, 'Category', i))).toEqual([['Activation'], ['Conversion'], ['Top of funnel']]);
      expect(made.rows.map((_, i) => valueOf(made, i, 'Upvoted by'))).toEqual([[], [], []]);
    });
  });

  describe('Meeting Notes (research/30 §10e)', () => {
    it('has the measured properties; Date is Relative with the time hidden; two options share Blue', () => {
      const made = build('meetingNotes');

      expect(made.title).toBe('Meeting Notes');
      expect(made.schema.map((p) => [p.name, p.type])).toEqual([
        ['Meeting name', 'title'], ['Date', 'date'], ['Category', 'multiSelect'], ['Attendees', 'person'], ['Created by', 'createdBy'],
      ]);
      expect(prop(made, 'Date').date).toEqual({ dateFormat: 'relative', timeFormat: 'hidden' });
      expect(options(made, 'Category')).toEqual([['Planning', 'blue'], ['Standup', 'red'], ['Presentation', 'yellow'], ['Retro', 'green'], ['Customer call', 'blue']]);
    });

    it('Last edited by and Last updated time on add them', () => {
      const made = build('meetingNotes', { features: ['Date', 'Category', 'Attendees', 'Last edited by', 'Last updated time'] });

      expect(made.schema.slice(-2).map((p) => [p.name, p.type])).toEqual([['Last edited by', 'lastEditedBy'], ['Last updated time', 'lastEditedTime']]);
    });

    it('has All Meetings (all five) and My Notes (four columns, Created by contains Me)', () => {
      const made = build('meetingNotes');

      expect(made.views.map((v) => [v.name, v.type])).toEqual([['All Meetings', 'table'], ['My Notes', 'table']]);
      expect(shownNames(made, 'All Meetings')).toHaveLength(4);
      expect(viewNamed(made, 'All Meetings')).toMatchObject({ showPageIcon: false, wrapCells: false, showVerticalLines: true, loadLimit: 50 });
      expect(shownNames(made, 'My Notes')).toHaveLength(3);
      expect(meName(made, 'My Notes')).toEqual([['Created by', 'contains', ['me']]]);
      expect(viewNamed(made, 'My Notes')).toMatchObject({ showPageIcon: true, loadLimit: 50 });
    });

    it('has the three measured rows, all on February 13, 2025', () => {
      const made = build('meetingNotes');

      expect(made.rows.map((r) => r.data.title)).toEqual(['Product release post-mortem', 'Weekly team sync', 'GTM strategy presentation']);
      expect(made.rows.map((_, i) => valueOf(made, i, 'Date'))).toEqual(['2025-02-13', '2025-02-13', '2025-02-13']);
      expect(made.rows.map((_, i) => labelsOf(made, 'Category', i))).toEqual([['Retro'], ['Standup'], ['Presentation']]);
      expect(made.rows.map((_, i) => valueOf(made, i, 'Attendees'))).toEqual([[], [], []]);
    });
  });

  describe('Goals Tracker (research/30 §10f)', () => {
    it('has the measured properties and options', () => {
      const made = build('goals');

      expect(made.title).toBe('Goals Tracker');
      expect(made.schema.map((p) => [p.name, p.type])).toEqual([
        ['Goal name', 'title'], ['Owner', 'person'], ['Status', 'status'], ['Due date', 'date'], ['Priority', 'select'], ['Team', 'multiSelect'],
      ]);
      expect(options(made, 'Status')).toEqual([['Not started', 'gray'], ['In progress', 'blue'], ['Done', 'green']]);
      expect(prop(made, 'Due date').date).toEqual({ dateFormat: 'month_day_year', timeFormat: '12_hour' });
      expect(options(made, 'Team')).toEqual([['Account Management', 'default'], ['Business Development', 'blue'], ['Product Design', 'green'], ['Human Resources', 'purple']]);
    });

    it('has All Goals, a By Status board (Priority, Status; ascending, no colour columns) and My Goals filtered to Owner', () => {
      const made = build('goals');
      const board = viewNamed(made, 'By Status');

      expect(made.views.map((v) => [v.name, v.type])).toEqual([['All Goals', 'table'], ['By Status', 'board'], ['My Goals', 'table']]);
      expect(shownNames(made, 'All Goals')).toHaveLength(5);
      expect(board.groupBy).toBe(prop(made, 'Status').id);
      expect(shownNames(made, 'By Status')).toEqual(['Priority', 'Status']);
      expect(board).toMatchObject({ loadLimit: 25, cardPreview: 'none', cardSize: 'medium', groupSettings: { sort: 'ascending', hideEmptyGroups: false, colorColumns: false } });
      expect(shownNames(made, 'My Goals')).toEqual(['Owner', 'Priority', 'Status', 'Team']);
      expect(meName(made, 'My Goals')).toEqual([['Owner', 'contains', ['me']]]);
      expect(viewNamed(made, 'My Goals')).toMatchObject({ showPageIcon: true });
    });

    it('has the three measured rows', () => {
      const made = build('goals');

      expect(made.rows.map((r) => r.data.title)).toEqual(['Increase sales by 20%', 'Launch 3 new products', 'Acquire 20K new users']);
      expect(made.rows.map((_, i) => labelsOf(made, 'Status', i))).toEqual([['In progress'], ['Not started'], ['Done']]);
      expect(made.rows.map((_, i) => valueOf(made, i, 'Due date'))).toEqual(['2025-02-26', '2025-04-16', '2025-02-03']);
      expect(made.rows.map((_, i) => labelsOf(made, 'Priority', i))).toEqual([['High'], ['Medium'], ['Medium']]);
      expect(made.rows.map((_, i) => labelsOf(made, 'Team', i))).toEqual([['Business Development'], ['Account Management'], ['Business Development']]);
      expect(made.rows.map((_, i) => valueOf(made, i, 'Owner'))).toEqual([[], [], []]);
    });

    it('By Team on adds a view grouped by Team', () => {
      const made = build('goals', { views: ['All Goals', 'By Status', 'My Goals', 'By Team'] });

      expect(viewNamed(made, 'By Team').groupBy).toBe(prop(made, 'Team').id);
    });
  });

  it('the four new templates bring no page template and no Undo row (unmeasured)', () => {
    for (const id of ['documentHub', 'brainstorm', 'meetingNotes', 'goals'] as const) {
      expect(build(id).templates).toEqual([]);
      expect(meta(id).undoKey).toBeUndefined();
    }
  });

  it('counts hidden properties as measured: not shown in the first view, not the title, not the board\'s group (B8)', () => {
    expect(hiddenPropertyCount(build('tasks'))).toBe(0);
    expect(hiddenPropertyCount(buildStarter('projects', { t, newId, titleId: 'old-title' }))).toBe(4);
    expect(hiddenPropertyCount(build('documentHub', { views: ['My Docs'] }))).toBe(4);
    expect(hiddenPropertyCount(build('brainstorm', { views: ['Top Ideas'] }))).toBe(5);
  });
});
