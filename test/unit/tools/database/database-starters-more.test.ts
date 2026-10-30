import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { englishDictionary } from '../../../../src/components/i18n/lightweight-i18n';
import { buildStarter } from '../../../../src/tools/database/database-starter-build';
import { DATABASE_STARTERS, galleryStarters, hiddenPropertyCount, suggestedStarters } from '../../../../src/tools/database/database-starters';
import type { StarterBuild, StarterId } from '../../../../src/tools/database/database-starters';
import type { PropertyDefinition } from '../../../../src/tools/database/types';
import { ComputedProperties } from '../../../../src/tools/database/computed-properties';
import { readPropertyValue } from '../../../../src/tools/database/property-values';
import { renderCellValue } from '../../../../src/tools/database/cells/display';

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

  it('lists the first nine templates in Notion\'s order, each with its measured description (the rest: research/33)', () => {
    expect(DATABASE_STARTERS.slice(0, 9).map((s) => [t(s.nameKey), t(s.descriptionKey)])).toEqual([
      ['Tasks Tracker', 'Stay organized with tasks, your way.'],
      ['Projects', 'Manage projects start to finish.'],
      ['Skills', 'Save reusable instructions for agents.'],
      ['Document Hub', 'Collaborate on docs in one hub.'],
      ['Brainstorm Session', 'Spark new ideas together.'],
      ['Meeting Notes', 'Turn meetings into action.'],
      ['Goals Tracker', 'Set team goals, achieve together.'],
      ['Campaign Management', 'Plan and deliver winning campaigns.'],
      ['Content Calendar', 'Streamline content creation.'],
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

    // research/31 §7: the same order, Campaign Management and Content Calendar after Goals Tracker.
    expect(names([]).slice(0, 9)).toEqual(['Tasks Tracker', 'Projects', 'Skills', 'Document Hub', 'Brainstorm Session', 'Meeting Notes', 'Goals Tracker', 'Campaign Management', 'Content Calendar']);
    expect(names(['tasks', 'projects', 'skills']).slice(0, 6)).toEqual(['Document Hub', 'Brainstorm Session', 'Meeting Notes', 'Goals Tracker', 'Campaign Management', 'Content Calendar']);
    expect(names(['tasks', 'projects', 'skills']).slice(-3)).toEqual(['Tasks Tracker', 'Projects', 'Skills']);
  });

  it('each card carries the measured thumbnail text (research/30 §10a)', () => {
    expect(DATABASE_STARTERS.slice(0, 9).map((s) => [...s.thumbnail.columns, ...s.thumbnail.pills.map(([key]) => key)].map((key) => t(key)))).toEqual([
      ['Task name', 'Status', 'Assignee', 'Not started', 'In progress', 'Done'],
      ['Not started', 'In progress', 'Done'],
      ['Skill name', 'Description', 'Files'],
      ['Doc name', 'Created by', 'Created time'],
      ['Idea', 'Created by', 'Priority', 'Medium', 'Low', 'High'],
      ['Meeting name', 'Date', 'Category', 'Presentation', 'Planning', 'Standup'],
      ['Goal name', 'Owner', 'Status', 'Not started', 'In progress', 'Done'],
      ['Blocked', 'Not started', 'Planning'],
      ['Sun', 'Mon', 'Tue'],
    ]);
    expect(meta('campaign').thumbnail.pills.map(([, color]) => color)).toEqual(['red', 'gray', 'yellow']);
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
    expect(on('goals', 'features', true)).toEqual(['Due date', 'Priority', 'Team']);
    expect(on('goals', 'features', false)).toEqual(['Quarter', 'Progress', 'Days until due']);
    // research/33 §3.6-3.7 read the off chips and view cards.
    expect(on('campaign', 'features', true)).toEqual(['Campaign type', 'Markets', 'Channels', 'Audiences targeted', 'Files & media']);
    expect(on('campaign', 'features', false)).toEqual(['Owner', 'Budget']);
    expect(on('campaign', 'views', true)).toEqual(['By Status', 'All Campaigns', 'Calendar']);
    expect(on('campaign', 'views', false)).toEqual(['By Market']);
    expect(on('contentCalendar', 'features', true)).toEqual(['Publish date', 'Platform', 'Content type', 'Owner', 'Post URL']);
    expect(on('contentCalendar', 'features', false)).toEqual(['Accounts']);
    expect(on('contentCalendar', 'views', true)).toEqual(['Calendar', 'All Content', 'By Status']);
    expect(on('contentCalendar', 'views', false)).toEqual(['By Platform']);
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

    it('By Category\'s first group is Customer research (research/30 B8); the rest keep the option order (unmeasured)', () => {
      const made = build('documentHub', { views: ['All Docs', 'My Docs', 'By Category'] });
      const order = viewNamed(made, 'By Category').groupOrder ?? {};
      const category = prop(made, 'Category').config?.options ?? [];
      const keyOf = (id: string): string => order[id] ?? category.find((o) => o.id === id)?.position ?? '';

      expect([...category].sort((x, y) => (keyOf(x.id) < keyOf(y.id) ? -1 : 1)).map((o) => o.label))
        .toEqual(['Customer research', 'Proposal', 'Strategy doc', 'Planning']);
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
      // Its options were not read: a status Blok adds itself, colourless as Notion's own default (findings-board B29), no default.
      expect(options(made, 'Status')[0]).toEqual(['Not started', undefined]);
      expect(prop(made, 'Status').status?.defaultOptionId).toBeUndefined();
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

    it('Top Ideas keeps its rows in reverse, Improve SEO first; the other views keep the shared order (research/30 B8)', () => {
      const made = build('brainstorm', { views: ['All Ideas', 'By category', 'Top Ideas'] });
      const order = viewNamed(made, 'Top Ideas').rowOrder ?? {};
      const sorted = [...made.rows].sort((x, y) => ((order[x.id] ?? '') < (order[y.id] ?? '') ? -1 : 1)).map((r) => r.data.title);

      expect(sorted).toEqual(['Improve SEO', 'Simplify onboarding experience', 'Launch back to school campaign']);
      expect(viewNamed(made, 'All Ideas').rowOrder).toBeUndefined();
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
      // research/30 §10f: Not started is the DEFAULT, with no checked colour.
      expect(options(made, 'Status')).toEqual([['Not started', undefined], ['In progress', 'blue'], ['Done', 'green']]);
      expect(prop(made, 'Status').status?.defaultOptionId).toBe(prop(made, 'Status').config?.options[0].id);
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

    it('By Team on adds a table grouped by Team, manual, empty groups shown, page icons on, 25 rows (research/31 §8)', () => {
      const made = build('goals', { features: ['Due date', 'Priority', 'Team', 'Quarter'], views: ['All Goals', 'By Status', 'My Goals', 'By Team'] });
      const byTeam = viewNamed(made, 'By Team');

      expect(byTeam.groupBy).toBe(prop(made, 'Team').id);
      expect(byTeam.type).toBe('table');
      expect(shownNames(made, 'By Team')).toEqual(['Status', 'Owner', 'Team', 'Priority', 'Quarter']);
      expect(byTeam).toMatchObject({ showPageIcon: true, wrapCells: false, showVerticalLines: true, openPagesIn: 'side', loadLimit: 25, groupSettings: { sort: 'manual', hideEmptyGroups: false } });
    });

    it('By Team lists its groups Account Management, Business Development, Human Resources, Product Design; the option order is kept (research/31 §8)', () => {
      const made = build('goals', { views: ['All Goals', 'By Team'] });
      const order = viewNamed(made, 'By Team').groupOrder ?? {};
      const team = prop(made, 'Team').config?.options ?? [];
      const keyOf = (id: string): string => order[id] ?? team.find((o) => o.id === id)?.position ?? '';

      expect([...team].sort((x, y) => (keyOf(x.id) < keyOf(y.id) ? -1 : 1)).map((o) => o.label))
        .toEqual(['Account Management', 'Business Development', 'Human Resources', 'Product Design']);
      expect(team.map((o) => o.label)).toEqual(['Account Management', 'Business Development', 'Product Design', 'Human Resources']);
    });

    const allGoals = { features: ['Due date', 'Priority', 'Team', 'Quarter', 'Progress'] };

    it('Quarter on adds a multi-select between Priority and Team: Q1 yellow, Q2 pink, Q3 green, Q4 gray (research/31 §8)', () => {
      const made = build('goals', allGoals);

      expect(made.schema.map((p) => [p.name, p.type])).toEqual([
        ['Goal name', 'title'], ['Owner', 'person'], ['Status', 'status'], ['Due date', 'date'], ['Priority', 'select'], ['Quarter', 'multiSelect'],
        ['Team', 'multiSelect'], ['Start value', 'number'], ['End value', 'number'], ['Progress', 'formula'],
      ]);
      expect(options(made, 'Quarter')).toEqual([['Q1', 'yellow'], ['Q2', 'pink'], ['Q3', 'green'], ['Q4', 'gray']]);
      expect(made.rows.map((_, i) => labelsOf(made, 'Quarter', i))).toEqual([['Q2'], ['Q3', 'Q4'], ['Q1']]);
      expect(shownNames(made, 'All Goals')).toHaveLength(9);
      expect(shownNames(made, 'My Goals')).toEqual(['Owner', 'Priority', 'Quarter', 'Status', 'Team']);
    });

    it('Progress on adds Start value, End value and a Start value/End value formula shown as a green percent bar (research/31 §8)', () => {
      const made = build('goals', allGoals);
      const start = prop(made, 'Start value');
      const end = prop(made, 'End value');

      expect(prop(made, 'Progress').formula).toEqual({ expression: `{{property:${start.id}}}/{{property:${end.id}}}` });
      expect(prop(made, 'Progress').number).toEqual({ format: 'percent', showAs: 'bar', color: 'green' });
      expect(start.number).toBeUndefined();
      expect(made.rows.map((_, i) => [valueOf(made, i, 'Start value'), valueOf(made, i, 'End value')])).toEqual([[15, 20], [0, 3], [25, 20]]);
    });

    it('Progress reads 75%, 0% and an uncapped 125% with a full bar (research/31 §8)', () => {
      const made = build('goals', allGoals);
      const progress = prop(made, 'Progress');
      const engine = new ComputedProperties('db');
      const rows = engine.apply(made.schema, made.rows.map((r) => ({ id: r.id, position: r.data.position, properties: r.data.properties })), { databaseId: 'db', now: new Date('2026-10-21T12:00:00Z') });
      const cells = rows.map((row) => renderCellValue(progress, readPropertyValue(row, progress), {
        i18n: { t }, readOnly: true, locale: 'en-US', valueProperty: (p) => engine.valueProperty(p),
      }));

      expect(cells.map((cell) => cell.querySelector('[data-blok-database-number-text]')?.textContent)).toEqual(['75%', '0%', '125%']);
      expect(cells.map((cell) => cell.querySelector<HTMLElement>('[data-blok-database-number-bar]')?.style.getPropertyValue('--blok-database-number-fill'))).toEqual(['75%', '0%', '100%']);
      expect(cells[0].querySelector('[data-blok-database-number-bar]')?.getAttribute('data-color')).toBe('green');
    });

    it('Days until due on adds the measured formula right after Due date (research/31 §8)', () => {
      const made = build('goals', { features: [...allGoals.features, 'Days until due'] });
      const due = prop(made, 'Due date');

      expect(made.schema.map((p) => p.name)).toEqual([
        'Goal name', 'Owner', 'Status', 'Due date', 'Days until due', 'Priority', 'Quarter', 'Team', 'Start value', 'End value', 'Progress',
      ]);
      expect(prop(made, 'Days until due')).toMatchObject({
        type: 'formula',
        formula: { expression: `if(dateBetween({{property:${due.id}}}, now(), "days") > 0, dateBetween({{property:${due.id}}}, now(), "days"), "Overdue")` },
      });
      expect(prop(made, 'Days until due').number).toBeUndefined();
      expect(shownNames(made, 'All Goals')).toContain('Days until due');
      expect(shownNames(made, 'My Goals')).not.toContain('Days until due');
    });

    it('Days until due reads "Overdue" on the 2025 sample rows and a plain day count before the date', () => {
      const made = build('goals', { features: [...allGoals.features, 'Days until due'] });
      const days = prop(made, 'Days until due');
      const due = prop(made, 'Due date');
      const engine = new ComputedProperties('db');
      const input = made.rows.map((r) => ({ id: r.id, position: r.data.position, properties: r.data.properties }));
      const later = [...input, { id: 'later', position: 'z', properties: { [due.id]: '2026-10-31' } }];
      const rows = engine.apply(made.schema, later, { databaseId: 'db', now: new Date('2026-10-21T00:00:00Z'), timeZone: 'UTC' });

      expect(rows.map((row) => readPropertyValue(row, days))).toEqual(['Overdue', 'Overdue', 'Overdue', '10']);
      expect(engine.valueProperty(days).type).toBe('text');
    });

    it('Days until due needs Due date: without it the chip adds nothing (unmeasured)', () => {
      const made = build('goals', { features: ['Priority', 'Team', 'Days until due'] });

      expect(made.schema.map((p) => p.name)).not.toContain('Days until due');
    });

    it('Quarter and Progress off leave the measured default schema', () => {
      expect(build('goals').schema.map((p) => p.name)).toEqual(['Goal name', 'Owner', 'Status', 'Due date', 'Priority', 'Team']);
    });
  });

  describe('Campaign Management (research/31 §7a)', () => {
    it('has the measured properties, types and option colours', () => {
      const made = build('campaign');

      expect(made.title).toBe('Campaign Management');
      expect(made.schema.map((p) => [p.name, p.type])).toEqual([
        ['Campaign name', 'title'], ['Channels', 'multiSelect'], ['Markets', 'multiSelect'], ['Campaign type', 'multiSelect'],
        ['Audiences targeted', 'multiSelect'], ['Completion date', 'date'], ['Files & media', 'files'], ['Status', 'status'],
      ]);
      expect(options(made, 'Channels')).toEqual([
        ['Blog', 'green'], ['Email', 'yellow'], ['Instagram', 'purple'], ['X', 'gray'], ['Tiktok', 'purple'], ['Linkedin', 'blue'], ['Google', 'brown'],
      ]);
      expect(options(made, 'Markets')).toEqual([['AMER', 'orange'], ['EMEA', 'gray'], ['APAC', 'purple'], ['UK', 'yellow'], ['FR', 'brown'], ['LATAM', 'green']]);
      expect(options(made, 'Campaign type')).toEqual([
        ['Product launch', 'gray'], ['Brand awareness', 'brown'], ['Lead generation', 'blue'], ['Sales promotion', 'green'], ['Content marketing', 'yellow'], ['Email marketing', 'default'],
      ]);
      expect(options(made, 'Audiences targeted')).toEqual([['Demographic 1', 'yellow'], ['Demographic 2', 'blue'], ['Demographic 3', 'red']]);
      expect(prop(made, 'Completion date').date).toEqual({ dateFormat: 'full', timeFormat: '12_hour' });
    });

    it('Status has the measured groups; Complete is the green pill', () => {
      const made = build('campaign');
      const status = prop(made, 'Status');
      const grouped = (status.config?.options ?? []).map((o) => [o.label, o.color, o.groupId]);

      expect(status.status?.groups.map((g) => [g.id, g.name])).toEqual([['todo', 'To-do'], ['inProgress', 'In progress'], ['complete', 'Complete']]);
      expect(grouped).toEqual([
        ['Blocked', 'red', 'todo'], ['Not started', undefined, 'todo'],
        ['Planning', 'yellow', 'inProgress'], ['On Hold', 'orange', 'inProgress'], ['In Production', 'purple', 'inProgress'],
        ['In Flight', 'blue', 'complete'], ['Complete', 'green', 'complete'],
      ]);
      // research/31 §7a: the DEFAULT is Not started, the second To-do option.
      expect(status.status?.defaultOptionId).toBe(status.config?.options[1].id);
    });

    it('has a By Status board, All Campaigns and a Calendar by Completion date, as measured', () => {
      const made = build('campaign');
      const board = viewNamed(made, 'By Status');
      const calendar = viewNamed(made, 'Calendar');

      expect(made.views.map((v) => [v.name, v.type])).toEqual([['By Status', 'board'], ['All Campaigns', 'table'], ['Calendar', 'calendar']]);
      expect(board.groupBy).toBe(prop(made, 'Status').id);
      expect(shownNames(made, 'By Status')).toEqual(['Channels', 'Markets', 'Campaign type']);
      expect(board).toMatchObject({
        showPageIcon: true, wrapCells: false, loadLimit: 25, openPagesIn: 'side', cardSize: 'medium', cardPreview: `property:${prop(made, 'Files & media').id}`,
        groupSettings: { sort: 'manual', hideEmptyGroups: false, colorColumns: true }, sorts: [], filters: [],
      });
      expect(shownNames(made, 'All Campaigns')).toEqual(['Status', 'Audiences targeted', 'Campaign type', 'Channels', 'Markets', 'Files & media', 'Completion date']);
      expect(viewNamed(made, 'All Campaigns')).toMatchObject({ showPageIcon: false, wrapCells: false, showVerticalLines: true, loadLimit: 50, openPagesIn: 'side' });
      expect(shownNames(made, 'Calendar')).toEqual([]);
      expect(calendar).toMatchObject({ calendarBy: prop(made, 'Completion date').id, calendarRange: 'month', showWeekends: true, showPageIcon: true, wrapCells: false, openPagesIn: 'center' });
      expect(hiddenPropertyCount(made)).toBe(3);
    });

    it('has the three measured rows; Files & media empty', () => {
      const made = build('campaign');

      expect(made.rows.map((r) => r.data.title)).toEqual(['New mobile app', 'Engineering content', 'Win the market']);
      expect(made.rows.map((_, i) => labelsOf(made, 'Status', i))).toEqual([['Blocked'], ['Not started'], ['Planning']]);
      expect(made.rows.map((_, i) => labelsOf(made, 'Audiences targeted', i))).toEqual([['Demographic 3'], ['Demographic 2'], ['Demographic 1']]);
      expect(made.rows.map((_, i) => labelsOf(made, 'Campaign type', i))).toEqual([['Product launch'], ['Sales promotion'], ['Brand awareness']]);
      expect(made.rows.map((_, i) => labelsOf(made, 'Channels', i))).toEqual([['X'], ['Linkedin'], ['Instagram']]);
      expect(made.rows.map((_, i) => labelsOf(made, 'Markets', i))).toEqual([['EMEA'], ['AMER'], ['APAC']]);
      expect(made.rows.map((_, i) => valueOf(made, i, 'Completion date'))).toEqual(['2025-03-28', '2025-03-18', '2025-03-13']);
      expect(made.rows.map((_, i) => valueOf(made, i, 'Files & media'))).toEqual([[], [], []]);
    });

    it('is a purple flag (shot 51)', () => {
      expect(build('campaign').icon).toEqual({ glyph: 'flag', color: 'purple' });
    });

    it('a chip off removes its column; Files & media off leaves the board without a card preview', () => {
      const made = build('campaign', { features: ['Campaign type', 'Markets', 'Channels', 'Audiences targeted'] });

      expect(made.schema.map((p) => p.name)).not.toContain('Files & media');
      expect(viewNamed(made, 'By Status').cardPreview).toBe('none');
    });
  });

  describe('Content Calendar (research/31 §7b)', () => {
    it('has the measured properties, types and option colours; no "Status (1)"; research/33 §3.7\'s order', () => {
      const made = build('contentCalendar');

      expect(made.title).toBe('Content Calendar');
      expect(made.schema.map((p) => [p.name, p.type])).toEqual([
        ['Content name', 'title'], ['Owner', 'person'], ['Content type', 'select'], ['Platform', 'multiSelect'],
        ['Film date', 'date'], ['Post URL', 'url'], ['Publish date', 'date'], ['Status', 'status'],
      ]);
      expect(options(made, 'Content type')).toEqual([
        ['Live stream', 'default'], ['Long form video', 'purple'], ['Story / short form video', 'gray'], ['Social post', 'red'],
        ['Podcast (video)', 'pink'], ['Podcast (audio)', 'orange'], ['Blog article', 'blue'],
      ]);
      expect(options(made, 'Platform')).toEqual([
        ['LinkedIn', 'default'], ['Tiktok', 'yellow'], ['X', 'blue'], ['YouTube', 'gray'], ['Instagram', 'purple'], ['Spotify', 'pink'], ['Email', 'red'], ['Blog / website', 'orange'],
      ]);
      expect(prop(made, 'Film date').date).toEqual({ dateFormat: 'full', timeFormat: '12_hour' });
      expect(prop(made, 'Publish date').date).toEqual({ dateFormat: 'full', timeFormat: '12_hour' });
    });

    it('Status has the measured groups; Published is the green pill and On hold the brown one', () => {
      const status = prop(build('contentCalendar'), 'Status');

      expect((status.config?.options ?? []).map((o) => [o.label, o.color, o.groupId])).toEqual([
        ['Idea', undefined, 'todo'],
        ['Drafting', 'yellow', 'inProgress'], ['Filming', 'red', 'inProgress'], ['Editing', 'orange', 'inProgress'], ['Ready for review', 'purple', 'inProgress'],
        ['In review', 'pink', 'inProgress'], ['Approved for publishing', 'blue', 'inProgress'], ['Scheduled', 'orange', 'inProgress'],
        ['Published', 'green', 'complete'], ['On hold', 'brown', 'complete'],
      ]);
      expect(status.status?.defaultOptionId).toBe(status.config?.options[0].id);
    });

    it('has a Calendar by Film date, All Content and a By Status board, each sorted by Publish date new to old', () => {
      const made = build('contentCalendar');
      const publish = prop(made, 'Publish date').id;
      const board = viewNamed(made, 'By Status');

      expect(made.views.map((v) => [v.name, v.type])).toEqual([['Calendar', 'calendar'], ['All Content', 'table'], ['By Status', 'board']]);
      expect(made.views.map((v) => v.sorts.map((sort) => [sort.propertyId, sort.direction]))).toEqual([[[publish, 'desc']], [[publish, 'desc']], [[publish, 'desc']]]);
      expect(shownNames(made, 'Calendar')).toEqual([]);
      expect(viewNamed(made, 'Calendar')).toMatchObject({ calendarBy: prop(made, 'Film date').id, calendarRange: 'month', showWeekends: true, showPageIcon: true, wrapCells: false, openPagesIn: 'center' });
      expect(shownNames(made, 'All Content')).toEqual(['Owner', 'Status', 'Film date', 'Publish date', 'Content type', 'Platform', 'Post URL']);
      expect(viewNamed(made, 'All Content')).toMatchObject({ showPageIcon: false, wrapCells: true, showVerticalLines: true, loadLimit: 50, openPagesIn: 'side' });
      expect(board.groupBy).toBe(prop(made, 'Status').id);
      expect(shownNames(made, 'By Status')).toEqual(['Owner', 'Content type', 'Platform']);
      expect(board).toMatchObject({
        showPageIcon: true, wrapCells: true, loadLimit: 25, openPagesIn: 'side', cardSize: 'medium', cardPreview: 'none',
        groupSettings: { sort: 'ascending', hideEmptyGroups: false, colorColumns: true },
      });
      expect(hiddenPropertyCount(made)).toBe(7);
    });

    it('has the three measured rows; Owner empty', () => {
      const made = build('contentCalendar');

      expect(made.rows.map((r) => r.data.title)).toEqual(['Product launch', 'Opinion piece', 'Blog post']);
      expect(made.rows.map((_, i) => labelsOf(made, 'Status', i))).toEqual([['Idea'], ['Approved for publishing'], ['Published']]);
      expect(made.rows.map((_, i) => [valueOf(made, i, 'Film date'), valueOf(made, i, 'Publish date')])).toEqual([
        ['2025-03-11', '2025-03-28'], ['2025-02-19', '2025-03-27'], ['2025-02-10', '2025-02-13'],
      ]);
      expect(made.rows.map((_, i) => labelsOf(made, 'Content type', i))).toEqual([['Story / short form video'], ['Social post'], ['Blog article']]);
      expect(made.rows.map((_, i) => labelsOf(made, 'Platform', i))).toEqual([['YouTube'], ['Instagram'], ['LinkedIn', 'Blog / website']]);
      expect(made.rows.map((_, i) => valueOf(made, i, 'Post URL'))).toEqual(['x.com/NotionHQ', 'x.com/NotionHQ', 'x.com/NotionHQ']);
      expect(made.rows.map((_, i) => valueOf(made, i, 'Owner'))).toEqual([[], [], []]);
    });

    it('Publish date off drops the sort; the calendar still places rows by Film date', () => {
      const made = build('contentCalendar', { features: ['Platform', 'Content type', 'Owner', 'Post URL'] });

      expect(made.schema.map((p) => p.name)).not.toContain('Publish date');
      expect(made.views.every((v) => v.sorts.length === 0)).toBe(true);
      expect(viewNamed(made, 'Calendar').calendarBy).toBe(prop(made, 'Film date').id);
    });
  });

  it('these templates bring no page template and no Undo row (unmeasured)', () => {
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
