import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { englishDictionary } from '../../../../src/components/i18n/lightweight-i18n';
import { buildStarter } from '../../../../src/tools/database/database-starter-build';
import { DATABASE_STARTERS, suggestedStarters } from '../../../../src/tools/database/database-starters';
import type { StarterBuild } from '../../../../src/tools/database/database-starters';
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

const build = (id: 'tasks' | 'projects' | 'skills', choices: { features?: string[]; views?: string[] } = {}): StarterBuild =>
  buildStarter(id, {
    t,
    newId,
    titleId: 'old-title',
    ...(choices.features === undefined ? {} : { features: new Set(choices.features) }),
    ...(choices.views === undefined ? {} : { views: new Set(choices.views) }),
  });

// Priority and Effort level each get their own "Medium": the word agrees with a different noun in es and others.
describe('the two "Medium" options', () => {
  it('Priority and Effort level read different keys', () => {
    const keys = (id: 'tasks' | 'projects', name: string): string[] => {
      const made = buildStarter(id, { t: (key) => key, newId, titleId: 'old-title' });

      return (made.schema.find((p) => p.name === name)?.config?.options ?? []).map((o) => o.label);
    };

    expect(keys('tasks', 'tools.database.starterPriority')).toEqual([
      'tools.database.starterOptionHigh', 'tools.database.starterOptionMediumPriority', 'tools.database.starterOptionLow',
    ]);
    expect(keys('tasks', 'tools.database.starterEffortLevel')).toEqual([
      'tools.database.starterOptionSmall', 'tools.database.starterOptionMediumEffort', 'tools.database.starterOptionLarge',
    ]);
    expect(keys('projects', 'tools.database.starterPriority')[1]).toBe('tools.database.starterOptionMediumPriority');
  });
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
const optionLabel = (made: StarterBuild, name: string, id: unknown): string | undefined =>
  prop(made, name).config?.options.find((o) => o.id === id)?.label;

describe('database starters (research/27 §1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    counter.next = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('only Skills has no Customize step', () => {
    expect(DATABASE_STARTERS.filter((s) => s.features.length === 0).map((s) => t(s.nameKey))).toEqual(['Skills']);
  });

  it('Customize chips and view cards start as measured', () => {
    const [tasks, projects] = DATABASE_STARTERS;
    const on = (list: Array<{ labelKey: string; on: boolean }>, state: boolean): string[] => list.filter((c) => c.on === state).map((c) => t(c.labelKey));

    expect(on(tasks.features, true)).toEqual(['Priority', 'Task type', 'Effort level', 'Description']);
    expect(on(tasks.features, false)).toEqual(['Updated at', 'Past due', 'Attach file']);
    expect(on(tasks.views, true)).toEqual(['All Tasks', 'By Status', 'My Tasks']);
    expect(on(tasks.views, false)).toEqual(['Checklist']);
    expect(on(projects.features, true)).toEqual(['Priority', 'Team', 'Start and end dates', 'Assignee', 'Attach file']);
    expect(on(projects.features, false)).toEqual(['Progress', 'Budget']);
    expect(on(projects.views, true)).toEqual(['By Status', 'All Projects', 'Gantt']);
    expect(on(projects.views, false)).toEqual(['My Projects']);
  });

  describe('Tasks Tracker with the default choices', () => {
    it('has the measured title, properties, types and option colours; the title keeps its id', () => {
      const made = build('tasks');

      expect(made.title).toBe('Tasks Tracker');
      expect(made.schema.map((p) => [p.name, p.type])).toEqual([
        ['Task name', 'title'], ['Status', 'status'], ['Assignee', 'person'], ['Due date', 'date'],
        ['Priority', 'select'], ['Task type', 'multiSelect'], ['Description', 'text'], ['Effort level', 'select'],
      ]);
      expect(made.schema[0].id).toBe('old-title');
      // research/27:48: Not started is the DEFAULT and has no checked colour.
      expect(options(made, 'Status')).toEqual([['Not started', undefined], ['In progress', 'blue'], ['Done', 'green']]);
      expect(prop(made, 'Status').status?.defaultOptionId).toBe(prop(made, 'Status').config?.options[0].id);
      expect(prop(made, 'Status').config?.options.map((o) => o.groupId)).toEqual(['todo', 'inProgress', 'complete']);
      expect(prop(made, 'Status').status?.groups.map((g) => g.kind)).toEqual(['todo', 'inProgress', 'complete']);
      expect(options(made, 'Priority')).toEqual([['High', 'red'], ['Medium', 'yellow'], ['Low', 'green']]);
      expect(options(made, 'Task type')).toEqual([['🐞 Bug', 'orange'], ['💬 Feature request', 'green'], ['💅 Polish', 'pink']]);
      expect(options(made, 'Effort level')).toEqual([['Small', 'green'], ['Medium', 'yellow'], ['Large', 'red']]);
      expect(prop(made, 'Due date').date).toEqual({ dateFormat: 'month_day_year', timeFormat: '12_hour' });
      expect(new Set(made.schema.map((p) => p.position)).size).toBe(made.schema.length);
    });

    it('has the three measured views: All Tasks table, By Status board, My Tasks filtered to Me', () => {
      const made = build('tasks');

      expect(made.views.map((v) => [v.name, v.type])).toEqual([['All Tasks', 'table'], ['By Status', 'board'], ['My Tasks', 'table']]);
      expect(made.activeViewId).toBe(made.views[0].id);
      expect(shownNames(made, 'All Tasks')).toEqual(['Status', 'Assignee', 'Due date', 'Priority', 'Task type', 'Description', 'Effort level']);
      expect(viewNamed(made, 'All Tasks')).toMatchObject({ showPageIcon: false, wrapCells: false, showVerticalLines: true, loadLimit: 50, openPagesIn: 'side' });
      expect(viewNamed(made, 'By Status').groupBy).toBe(prop(made, 'Status').id);
      expect(shownNames(made, 'By Status')).toEqual(['Assignee', 'Priority', 'Task type']);
      expect(viewNamed(made, 'By Status')).toMatchObject({ showPageIcon: true, wrapCells: true, loadLimit: 25, cardPreview: 'none', cardSize: 'medium', groupSettings: { colorColumns: true } });
      expect(shownNames(made, 'My Tasks')).toEqual(['Assignee', 'Due date', 'Status']);
      expect(viewNamed(made, 'My Tasks').filters).toEqual([expect.objectContaining({ propertyId: prop(made, 'Assignee').id, operator: 'contains', value: ['me'] })]);
      expect(viewNamed(made, 'My Tasks')).toMatchObject({ showPageIcon: true, wrapCells: false, loadLimit: 50 });
    });

    it('has the three measured sample rows', () => {
      const made = build('tasks');

      expect(made.rows.map((r) => r.data.title)).toEqual(['Improve website copy', 'Update help center & FAQ', 'Publish release notes']);
      expect(made.rows.map((_, i) => optionLabel(made, 'Status', valueOf(made, i, 'Status')))).toEqual(['Done', 'In progress', 'Not started']);
      expect(made.rows.map((_, i) => valueOf(made, i, 'Due date'))).toEqual(['2025-02-03', '2025-02-20', '2025-02-28']);
      expect(made.rows.map((_, i) => optionLabel(made, 'Priority', valueOf(made, i, 'Priority')))).toEqual(['High', 'Medium', 'Low']);
      expect(made.rows.map((_, i) => (valueOf(made, i, 'Task type') as string[]).map((id) => optionLabel(made, 'Task type', id)))).toEqual([['💅 Polish'], ['💬 Feature request'], ['💬 Feature request']]);
      expect(made.rows.map((_, i) => valueOf(made, i, 'Description'))).toEqual([
        'Change header text to better reflect our latest product offerings.',
        'Update support documents to reflect new product releases.',
        'Include product updates in next release note.',
      ]);
      expect(made.rows.map((_, i) => optionLabel(made, 'Effort level', valueOf(made, i, 'Effort level')))).toEqual(['Medium', 'Small', 'Small']);
      expect(made.rows.map((_, i) => valueOf(made, i, 'Assignee'))).toEqual([[], [], []]);
      expect(made.rows.map((r) => r.data.icon)).toEqual([undefined, '📕', '🗒️']);
      expect(made.rows.map((r) => r.data.properties[made.schema[0].id])).toEqual(made.rows.map((r) => r.data.title));
      expect(new Set(made.rows.map((r) => r.data.position)).size).toBe(3);
    });

    it('the measured row page body: headings, text, three to-dos; the embed placeholders are left out', () => {
      const made = build('tasks');

      expect(made.rows[0].body).toEqual([
        { tool: 'header', data: { text: [{ text: 'Task description' }], level: 2 } },
        { tool: 'paragraph', data: { text: [{ text: 'Provide an overview of the task and related details.' }] } },
        { tool: 'paragraph', data: { text: [] } },
        { tool: 'header', data: { text: [{ text: 'Sub-tasks' }], level: 2 } },
        { tool: 'list', data: { text: [], style: 'checklist', checked: false } },
        { tool: 'list', data: { text: [], style: 'checklist', checked: false } },
        { tool: 'list', data: { text: [], style: 'checklist', checked: false } },
        { tool: 'header', data: { text: [{ text: 'Supporting files' }], level: 2 } },
      ]);
      // Only the first row's body was read.
      expect(made.rows.slice(1).map((r) => r.body)).toEqual([[], []]);
    });

    it('the row page pins Assignee, Status and Due date and puts the rest in the Properties panel', () => {
      const made = build('tasks');
      const title = made.schema[0];

      expect(title.pageLayoutGroupIn).toBe('panel');
      expect(title.pageLayoutPlacements).toEqual(['Assignee', 'Status', 'Due date'].map((name) => ({ id: prop(made, name).id, place: 'heading' })));
    });
  });

  describe('Tasks Tracker choices (Blok choice: a chip or card only adds or leaves out its property or view)', () => {
    it('an off chip leaves its property out of the schema, the views and the rows', () => {
      const made = build('tasks', { features: ['Task type', 'Description'].map((name) => DATABASE_STARTERS[0].features.find((f) => t(f.labelKey) === name)?.id ?? name) });

      expect(made.schema.map((p) => p.name)).toEqual(['Task name', 'Status', 'Assignee', 'Due date', 'Task type', 'Description']);
      expect(shownNames(made, 'By Status')).toEqual(['Assignee', 'Task type']);
      expect(made.rows.every((r) => Object.keys(r.data.properties).every((id) => made.schema.some((p) => p.id === id)))).toBe(true);
    });

    it('turning on Updated at, Past due and Attach file adds them', () => {
      const all = DATABASE_STARTERS[0].features.map((f) => f.id);
      const made = build('tasks', { features: all });

      expect(made.schema.slice(-3).map((p) => [p.name, p.type])).toEqual([['Updated at', 'lastEditedTime'], ['Past due', 'checkbox'], ['Attach file', 'files']]);
      expect(shownNames(made, 'All Tasks')).toContain('Attach file');
    });

    it('an off view card leaves the view out; Checklist on adds a list view; with every card off the database still has a view', () => {
      const views = DATABASE_STARTERS[0].views;
      const pick = (...names: string[]): string[] => views.filter((v) => names.includes(t(v.labelKey))).map((v) => v.id);

      expect(build('tasks', { views: pick('By Status', 'Checklist') }).views.map((v) => [v.name, v.type])).toEqual([['By Status', 'board'], ['Checklist', 'list']]);
      expect(build('tasks', { views: [] }).views.map((v) => v.name)).toEqual(['All Tasks']);
    });
  });

  describe('Projects with the default choices', () => {
    it('has the measured properties and Team options', () => {
      const made = build('projects');

      expect(made.title).toBe('Projects');
      expect(made.schema.map((p) => [p.name, p.type])).toEqual([
        ['Project name', 'title'], ['Assignee', 'person'], ['Priority', 'select'], ['Attach file', 'files'],
        ['End date', 'date'], ['Start date', 'date'], ['Status', 'status'], ['Team', 'multiSelect'],
      ]);
      expect(options(made, 'Team')).toEqual([['Account Management', 'default'], ['Business Development', 'blue'], ['Product Design', 'green'], ['Human Resources', 'purple']]);
      expect(options(made, 'Priority')).toEqual([['High', 'red'], ['Medium', 'yellow'], ['Low', 'green']]);
      // research/27:89: the same three as Tasks Tracker.
      expect(options(made, 'Status')).toEqual([['Not started', undefined], ['In progress', 'blue'], ['Done', 'green']]);
      expect(prop(made, 'Status').status?.defaultOptionId).toBe(prop(made, 'Status').config?.options[0].id);
      expect(prop(made, 'Start date').date).toEqual({ dateFormat: 'month_day_year', timeFormat: '12_hour' });
    });

    it('has By Status board, All Projects table and a Gantt timeline grouped by Status at Month zoom with the table shown', () => {
      const made = build('projects');
      const gantt = viewNamed(made, 'Gantt');

      expect(made.views.map((v) => [v.name, v.type])).toEqual([['By Status', 'board'], ['All Projects', 'table'], ['Gantt', 'timeline']]);
      expect(shownNames(made, 'By Status')).toEqual(['Assignee', 'Priority']);
      expect(viewNamed(made, 'By Status').groupBy).toBe(prop(made, 'Status').id);
      expect(shownNames(made, 'All Projects')).toHaveLength(7);
      expect(viewNamed(made, 'All Projects')).toMatchObject({ showPageIcon: false, wrapCells: false, showVerticalLines: true, loadLimit: 50 });
      expect(gantt.groupBy).toBe(prop(made, 'Status').id);
      expect(gantt).toMatchObject({ timelineBy: prop(made, 'Start date').id, timelineEndBy: prop(made, 'End date').id, timelineZoom: 'month', showTimelineTable: true, loadLimit: 25 });
      expect(shownNames(made, 'Gantt')).toEqual(['Assignee']);
    });

    it('has the three measured rows, with the first row body', () => {
      const made = build('projects');

      expect(made.rows.map((r) => r.data.title)).toEqual(['Quarterly sales planning', 'Revamp new hire onboarding', 'Public launch of iOS app']);
      expect(made.rows.map((_, i) => optionLabel(made, 'Status', valueOf(made, i, 'Status')))).toEqual(['Not started', 'Done', 'In progress']);
      expect(made.rows.map((_, i) => [valueOf(made, i, 'Start date'), valueOf(made, i, 'End date')])).toEqual([
        ['2025-03-24', '2025-03-28'], ['2025-01-20', '2025-02-04'], ['2025-04-09', '2025-04-30'],
      ]);
      expect(made.rows.map((_, i) => optionLabel(made, 'Priority', valueOf(made, i, 'Priority')))).toEqual(['Medium', 'Low', 'High']);
      expect(made.rows.map((_, i) => (valueOf(made, i, 'Team') as string[]).map((id) => optionLabel(made, 'Team', id)))).toEqual([['Account Management'], ['Human Resources'], ['Product Design']]);
      expect(made.rows.map((r) => r.data.icon)).toEqual(['📖', undefined, '📱']);
      expect(made.rows[0].body).toEqual([
        { tool: 'header', data: { text: [{ text: 'About project' }], level: 3 } },
        { tool: 'paragraph', data: { text: [{ text: 'Provide an overview of the project’s goals and context' }] } },
        { tool: 'paragraph', data: { text: [] } },
        { tool: 'header', data: { text: [{ text: 'Action items' }], level: 3 } },
        { tool: 'list', data: { text: [], style: 'checklist', checked: false } },
        { tool: 'header', data: { text: [{ text: 'Documents' }], level: 3 } },
      ]);
      expect(made.schema[0].pageLayoutPlacements).toEqual(['Status', 'Assignee', 'Priority', 'End date'].map((name) => ({ id: prop(made, name).id, place: 'heading' })));
      expect(made.schema[0].pageLayoutGroupIn).toBe('panel');
    });

    it('without the dates the Gantt view is left out; without Assignee My Projects is', () => {
      const ids = (names: string[]): string[] => DATABASE_STARTERS[1].features.filter((f) => names.includes(t(f.labelKey))).map((f) => f.id);
      const allViews = DATABASE_STARTERS[1].views.map((v) => v.id);

      expect(build('projects', { features: ids(['Priority', 'Assignee']), views: allViews }).views.map((v) => v.name)).toEqual(['By Status', 'All Projects', 'My Projects']);
      expect(build('projects', { features: ids(['Start and end dates']), views: allViews }).views.map((v) => v.name)).toEqual(['By Status', 'All Projects', 'Gantt']);
    });
  });

  it('Skills: five properties, one table with Count on the title, no rows', () => {
    const made = build('skills');
    const [view] = made.views;

    expect(made.title).toBe('Skills');
    expect(made.schema.map((p) => [p.name, p.type])).toEqual([['Skill name', 'title'], ['Description', 'text'], ['Files', 'files'], ['Tags', 'multiSelect'], ['Created by', 'createdBy']]);
    expect(prop(made, 'Tags').config?.options).toEqual([]);
    expect(made.views).toHaveLength(1);
    expect(view).toMatchObject({ type: 'table', wrapCells: true, showVerticalLines: true, showPageIcon: true, loadLimit: 50 });
    expect(view.calculations).toEqual([{ id: 'old-title', fn: 'count' }]);
    expect(view.visibleProperties).toHaveLength(4);
    expect(made.rows).toEqual([]);
  });

  it('Suggested shows the first three templates not used yet (research/27 §1a, inferred rule)', () => {
    const ids = (used: Array<'tasks' | 'projects' | 'skills'>): string[] => suggestedStarters(new Set(used)).map((s) => s.id);

    expect(ids(['projects'])).toEqual(['tasks', 'skills', 'documentHub']);
  });

  it('each template gives the database its measured icon (research/27 §1b-d)', () => {
    expect(build('tasks').icon).toEqual({ glyph: 'check', color: 'green' });
    expect(build('projects').icon).toEqual({ glyph: 'timeline', color: 'blue' });
    expect(build('skills').icon).toEqual({ glyph: 'wand', color: 'gray' });
  });

  it('Tasks Tracker and Projects bring a default template, "New task" and "New project"; Skills none (research/27:44, :81, :118)', () => {
    const tasks = build('tasks');
    const projects = build('projects');

    expect(tasks.templates.map((tpl) => [tpl.data.title, tpl.data.template])).toEqual([['New task', true]]);
    expect(tasks.templates[0].data.properties).toEqual({ 'old-title': 'New task' });
    expect(tasks.schema[0].defaultTemplateId).toBe(tasks.templates[0].id);
    expect(tasks.templates[0].body).toEqual(tasks.rows[0].body);
    expect(projects.templates.map((tpl) => tpl.data.title)).toEqual(['New project']);
    expect(projects.schema[0].defaultTemplateId).toBe(projects.templates[0].id);
    expect(build('skills').templates).toEqual([]);
    expect(build('skills').schema[0].defaultTemplateId).toBeUndefined();
  });

  it('only Tasks Tracker and Skills offer "Undo … database"; Projects showed "Turn into" (research/27:43, :81, :115)', () => {
    expect(DATABASE_STARTERS.map((s) => (s.undoKey === undefined ? null : t(s.undoKey)))).toEqual(['Undo Task database', null, 'Undo skills database', ...Array<null>(18).fill(null)]);
  });
});
