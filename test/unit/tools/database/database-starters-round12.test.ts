import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { englishDictionary } from '../../../../src/components/i18n/lightweight-i18n';
import { createStarterBuilder } from '../../../../src/tools/database/database-starter-build';
import { DATABASE_STARTERS, galleryStarters, hiddenPropertyCount } from '../../../../src/tools/database/database-starters';
import type { StarterBuild, StarterId } from '../../../../src/tools/database/database-starters';
import type { PropertyDefinition, SelectOption } from '../../../../src/tools/database/types';
import { ComputedProperties } from '../../../../src/tools/database/computed-properties';
import { readPropertyValue } from '../../../../src/tools/database/property-values';
import { ME_FILTER_VALUE } from '../../../../src/tools/database/database-query';

const buildStarter = createStarterBuilder(DATABASE_STARTERS);

/** research/33 §3: the twelve "More templates" after Content Calendar, and Campaign / Content Calendar with every chip on. */

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
const allOf = (id: StarterId, kind: 'features' | 'views'): Set<string> => new Set(meta(id)[kind].map((c) => c.id));
const build = (id: StarterId, everything = false): StarterBuild =>
  buildStarter(id, { t, newId, titleId: 'old-title', ...(everything ? { features: allOf(id, 'features'), views: allOf(id, 'views') } : {}) });
const prop = (made: StarterBuild, name: string): PropertyDefinition => {
  const found = made.schema.find((p) => p.name === name);

  if (found === undefined) throw new Error(`no property ${name}`);

  return found;
};
const options = (made: StarterBuild, name: string): Array<[string, string | undefined]> =>
  (prop(made, name).config?.options ?? []).map((o) => [o.label, o.color]);
const statusOf = (made: StarterBuild, name = 'Status'): Array<[string, string | undefined, string | undefined]> =>
  (prop(made, name).config?.options ?? []).map((o) => [o.label, o.color, o.groupId]);
const defaultLabel = (made: StarterBuild): string | undefined => {
  const status = prop(made, 'Status');

  return status.config?.options.find((o) => o.id === status.status?.defaultOptionId)?.label;
};
const nameOf = (made: StarterBuild, id: string | undefined): string | undefined => made.schema.find((p) => p.id === id)?.name;
const viewNamed = (made: StarterBuild, name: string): StarterBuild['views'][number] => {
  const found = made.views.find((v) => v.name === name);

  if (found === undefined) throw new Error(`no view ${name}`);

  return found;
};
const shown = (made: StarterBuild, name: string): string[] => viewNamed(made, name).visibleProperties.map((id) => nameOf(made, id) ?? id);
const views = (made: StarterBuild): Array<[string, string, string | undefined]> => made.views.map((v) => [v.name, v.type, nameOf(made, v.groupBy)]);
const sortsOf = (made: StarterBuild, name: string): Array<[string | undefined, string]> => viewNamed(made, name).sorts.map((s) => [nameOf(made, s.propertyId), s.direction]);
const labelOf = (made: StarterBuild, property: PropertyDefinition, id: unknown): unknown =>
  property.config?.options.find((o) => o.id === id)?.label ?? id;
const filtersOf = (made: StarterBuild, name: string): Array<[string | undefined, string, unknown]> =>
  (viewNamed(made, name).filters ?? []).map((f) => {
    const property = prop(made, nameOf(made, f.propertyId) ?? '');

    return [property.name, f.operator, Array.isArray(f.value) ? f.value.map((v) => labelOf(made, property, v)) : f.value];
  });
/** The groups a manual view draws, in order: its own group order, then the no-value group at its stored place. */
const groupsOf = (made: StarterBuild, name: string): string[] => {
  const view = viewNamed(made, name);
  const property = prop(made, nameOf(made, view.groupBy) ?? '');
  const keyOf = (option: SelectOption): string => view.groupOrder?.[option.id] ?? option.position;
  const sorted = [...(property.config?.options ?? [])].sort((x, y) => (keyOf(x) < keyOf(y) ? -1 : 1));
  const stored = view.noValueGroupPosition;
  const index = stored === undefined ? -1 : sorted.findIndex((o) => keyOf(o) > stored);
  const labels = sorted.map((o) => o.label);
  const none = `No ${property.name}`;

  return index === -1 ? [...labels, none] : [...labels.slice(0, index), none, ...labels.slice(index)];
};
const chips = (id: StarterId, kind: 'features' | 'views', state: boolean): string[] =>
  meta(id)[kind].filter((c) => c.on === state).map((c) => t(c.labelKey));
type Block = StarterBuild['templates'][number]['body'][number];
const bodyText = (body: Block[]): string[] => body.map((block) => {
  const text = (block.data.text as Array<{ text: string }> | undefined)?.map((s) => s.text).join('') ?? '';

  if (block.tool === 'header') return `H${String(block.data.level)} ${text}`;
  if (block.tool === 'list') return `${String(block.data.style)}${text === '' ? '' : ` ${text}`}`;

  return text === '' ? '(empty)' : text;
});
const placements = (made: StarterBuild): Array<[string | undefined, string]> =>
  (made.schema[0].pageLayoutPlacements ?? []).map((p) => [nameOf(made, p.id), p.place]);
const tableLook = { showPageIcon: false, wrapCells: false, showVerticalLines: true, loadLimit: 50, openPagesIn: 'side' } as const;

describe('"More templates", research/33 §3', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    counter.next = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the gallery lists all 21 templates in research/31\'s order, each with its measured card text', () => {
    expect(galleryStarters(new Set()).map((s) => [t(s.nameKey), t(s.descriptionKey)]).slice(9)).toEqual([
      ['Event Management', 'Plan and manage your events.'],
      ['Social Media Planner', 'Organize and schedule social posts.'],
      ['Issue Tracking', 'Resolve issues and feedback fast.'],
      ['Feature Requests', 'Manage feature requests end-to-end.'],
      ['Engineering Docs', 'Organize knowledge with your team.'],
      ['Fundraising Tracker', 'Track investor deals and progress.'],
      ['Pipeline Tracking', 'Track your sales pipeline.'],
      ['Account Management', 'One hub to manage clients.'],
      ['Creative Projects', 'Keep creative projects on track.'],
      ['Inventory Management', 'Manage inventory efficiently.'],
      ['Product Roadmap', 'Take products from idea to launch.'],
      ['Asset Library', 'Create shared design assets.'],
    ]);
    expect(DATABASE_STARTERS).toHaveLength(21);
  });

  it('each new card carries the measured thumbnail text (research/30 §10a)', () => {
    expect(DATABASE_STARTERS.slice(9).map((s) => [...s.thumbnail.columns, ...s.thumbnail.pills.map(([key]) => key)].map((key) => t(key)))).toEqual([
      ['Event name', 'Status', 'Event date', 'Not started', 'Planning', 'Pending review'],
      ['Sun', 'Mon', 'Tue'],
      ['Backlog', 'Open', 'In progress'],
      ['New', 'Under Review', 'Planned'],
      ['Doc name', 'Author', 'Status', 'In Review', 'Published', 'Draft'],
      ['Not started', 'Diligence', 'Pitched'],
      ['New', 'Discovery', 'Negotiation'],
      ['Active', 'Churned', 'Pending Renewal'],
      ['Not started', 'In progress', 'Needs review'],
      ['Name', 'ID', 'Category', 'Hardware', 'Accessories', 'Electronics'],
      ['Backlog', 'Planned', 'In progress'],
      [],
    ]);
    // The pills take their options' colours; a DEFAULT status option draws the gray pill (§3.1).
    expect(DATABASE_STARTERS.slice(9).map((s) => s.thumbnail.pills.map(([, color]) => color))).toEqual([
      ['gray', 'blue', 'pink'], [], ['gray', 'gray', 'blue'], ['gray', 'yellow', 'brown'], ['blue', 'green', 'gray'], ['gray', 'blue', 'yellow'],
      ['green', 'red', 'orange'], ['brown', 'yellow', 'green'], ['gray', 'blue', 'yellow'], ['orange', 'yellow', 'default'], ['brown', 'gray', 'blue'], [],
    ]);
  });

  it('the Customize chips and view cards start as measured', () => {
    expect([chips('events', 'features', true), chips('events', 'features', false)]).toEqual([['Event owner', 'Category', 'Format', 'Venue'], ['Budget', 'Capacity', 'Event URL']]);
    expect([chips('events', 'views', true), chips('events', 'views', false)]).toEqual([['All Events', 'By Status', 'Calendar'], ['By Category', 'My Events']]);
    expect([chips('socialMedia', 'features', true), chips('socialMedia', 'features', false)]).toEqual([['Platform', 'Post URL', 'Content type', 'Owner'], ['Target audiences']]);
    expect([chips('socialMedia', 'views', true), chips('socialMedia', 'views', false)]).toEqual([['Calendar', 'All Posts', 'By Status'], ['By Platform']]);
    expect([chips('issues', 'features', true), chips('issues', 'features', false)]).toEqual([['Due date'], ['Type', 'Days open']]);
    expect([chips('issues', 'views', true), chips('issues', 'views', false)]).toEqual([['Kanban', 'All Issues', 'My Issues'], ['Untriaged', 'Completed']]);
    expect([chips('featureRequests', 'features', true), chips('featureRequests', 'features', false)]).toEqual([
      ['Priority', 'Requested by', 'Requested date', 'Product area'], ['Estimated effort', 'Related files'],
    ]);
    expect([chips('featureRequests', 'views', true), chips('featureRequests', 'views', false)]).toEqual([
      ['By Status', 'All Requests', 'Assigned to Me'], ['High Priority Requests', 'New Unassigned Requests'],
    ]);
    expect([chips('engineeringDocs', 'features', true), chips('engineeringDocs', 'features', false)]).toEqual([['Author', 'Last edited time'], ['Reviewers', 'Created time']]);
    expect([chips('engineeringDocs', 'views', true), chips('engineeringDocs', 'views', false)]).toEqual([['All Docs', 'Published Docs', 'Docs by Category'], ['Recently Edited', 'My Docs']]);
    expect([chips('fundraising', 'features', true), chips('fundraising', 'features', false)]).toEqual([
      ['Capital committed', 'Description', 'Partner name', 'Partner email', 'Warm contact email', 'Portfolio', 'Last contact date'],
      ['Warm contact name', 'Average check size', 'Firm LinkedIn', 'Lost reason'],
    ]);
    expect([chips('fundraising', 'views', true), chips('fundraising', 'views', false)]).toEqual([['By Status', 'All Investors', 'Won'], ['Lost', 'In Progress']]);
    expect([chips('pipeline', 'features', true), chips('pipeline', 'features', false)]).toEqual([
      ['Account owner', 'Priority level', 'Deal value', 'Decision maker', 'Expected close date', 'Email', 'Notes'],
      ['Last contact date', 'Lead source', 'Days since last contact', 'Phone number'],
    ]);
    expect([chips('pipeline', 'views', true), chips('pipeline', 'views', false)]).toEqual([['By Deal Stage', 'All Deals', 'Active Deals'], ['Recently Contacted']]);
    expect([chips('accounts', 'features', true), chips('accounts', 'features', false)]).toEqual([
      ['Account manager', 'Product categories', 'Contact email', 'Notes'], ['Contract value', 'Last contact date', 'Phone number'],
    ]);
    expect([chips('accounts', 'views', true), chips('accounts', 'views', false)]).toEqual([['By Status', 'All Accounts', 'By Region'], ['Active Accounts']]);
    expect([chips('creative', 'features', true), chips('creative', 'features', false)]).toEqual([['Creative type', 'Priority', 'Assets'], ['Start date', 'End date']]);
    expect([chips('creative', 'views', true), chips('creative', 'views', false)]).toEqual([['By Status', 'All Projects', 'My Projects'], ['Timeline', 'By Type']]);
    expect([chips('inventory', 'features', true), chips('inventory', 'features', false)]).toEqual([
      ['ID', 'Category', 'Quantity in stock', 'Supplier', 'Location', 'Notes'], ['Reorder minimum', 'Reorder Status'],
    ]);
    expect([chips('inventory', 'views', true), chips('inventory', 'views', false)]).toEqual([['All Inventory', 'Recently Ordered'], ['Hardware Inventory']]);
    expect([chips('roadmap', 'features', true), chips('roadmap', 'features', false)]).toEqual([['Priority', 'Category', 'Effort', 'Date'], ['Project description', 'Quarter']]);
    expect([chips('roadmap', 'views', true), chips('roadmap', 'views', false)]).toEqual([['By Status', 'All Projects', 'My Projects', 'By Team'], ['By Quarter', 'Timeline']]);
    expect([chips('assets', 'features', true), chips('assets', 'features', false)]).toEqual([['Designer', 'Asset type', 'Last edited', 'Files & media'], ['Asset description', 'Asset URL']]);
    expect([chips('assets', 'views', true), chips('assets', 'views', false)]).toEqual([['Gallery', 'All Assets', 'By Status'], ['Asset Type', 'My Assets']]);
  });

  it('the Customize footer counts the measured hidden properties with the defaults kept', () => {
    const ids: StarterId[] = ['events', 'socialMedia', 'issues', 'featureRequests', 'engineeringDocs', 'fundraising', 'pipeline', 'accounts', 'creative', 'inventory', 'roadmap', 'assets'];

    expect(ids.map((id) => hiddenPropertyCount(build(id)))).toEqual([0, 6, 2, 5, 0, 5, 5, 3, 2, 0, 4, 4]);
    expect(['socialMedia', 'campaign', 'contentCalendar'].map((id) => hiddenPropertyCount(build(id as StarterId, true)))).toEqual([7, 4, 8]);
  });

  it('the icons take the measured colours and Notion\'s glyphs (research/33 §3.8, §3.13)', () => {
    const ids: StarterId[] = ['events', 'socialMedia', 'campaign', 'contentCalendar', 'issues', 'featureRequests', 'engineeringDocs', 'fundraising', 'pipeline', 'accounts', 'creative', 'inventory', 'roadmap', 'assets'];

    expect(ids.map((id) => build(id).icon)).toEqual([
      { glyph: 'ticket', color: 'purple' }, { glyph: 'feed', color: 'purple' }, { glyph: 'flag', color: 'purple' }, { glyph: 'calendar', color: 'purple' },
      { glyph: 'check', color: 'red' }, { glyph: 'comment', color: 'red' }, { glyph: 'doc', color: 'red' }, { glyph: 'currency', color: 'gray' },
      { glyph: 'person', color: 'blue' }, { glyph: 'card', color: 'blue' }, { glyph: 'paintBrush', color: 'blue' }, { glyph: 'package', color: 'gray' },
      { glyph: 'map', color: 'pink' }, { glyph: 'fanDeck', color: 'green' },
    ]);
  });

  it('every new template has its measured default page template, named for the "+ New …" button', () => {
    const ids: StarterId[] = ['events', 'socialMedia', 'campaign', 'contentCalendar', 'issues', 'featureRequests', 'engineeringDocs', 'fundraising', 'pipeline', 'accounts', 'creative', 'inventory', 'roadmap', 'assets'];

    expect(ids.map((id) => {
      const made = build(id);

      expect(made.schema[0].defaultTemplateId).toBe(made.templates[0].id);

      return made.templates.map((tpl) => tpl.data.title);
    })).toEqual([
      ['New event'], ['New post'], ['New campaign'], ['New content'], ['New issue'], ['New request'], ['New document', 'Guide Template'],
      ['New investor'], ['New deal'], ['New account'], ['New project'], ['New item'], ['New project'], ['New asset'],
    ]);
  });

  describe('Event Management (§3.4)', () => {
    it('has the measured schema, options and number formats', () => {
      const made = build('events', true);

      expect(made.title).toBe('Event Management');
      expect(made.schema.map((p) => [p.name, p.type])).toEqual([
        ['Event name', 'title'], ['Event date', 'date'], ['Status', 'status'], ['Event owner', 'person'], ['Format', 'select'], ['Category', 'select'],
        ['Venue', 'select'], ['Capacity', 'number'], ['Budget', 'number'], ['Event URL', 'url'],
      ]);
      expect(prop(made, 'Event date').date).toEqual({ dateFormat: 'full', timeFormat: '12_hour' });
      expect(statusOf(made)).toEqual([
        ['Not started', undefined, 'todo'], ['Planning', 'blue', 'inProgress'], ['Pending review', 'pink', 'inProgress'], ['Registration open', 'yellow', 'inProgress'],
        ['Done', 'green', 'complete'], ['Cancelled', 'red', 'complete'],
      ]);
      expect(defaultLabel(made)).toBe('Not started');
      expect(options(made, 'Format')).toEqual([['In person', 'purple'], ['Virtual', 'green']]);
      expect(options(made, 'Category')).toEqual([
        ['Webinar', 'green'], ['Conference', 'gray'], ['Tradeshow', 'red'], ['Workshop', 'default'], ['Internal event', 'blue'], ['Partner event', 'yellow'],
        ['Community meetup', 'orange'], ['Team building', 'pink'], ['Retreat', 'purple'],
      ]);
      expect(options(made, 'Venue')).toEqual([['Venue 1', 'yellow'], ['Venue 2', 'orange'], ['Venue 3', 'default']]);
      expect(prop(made, 'Capacity').number).toBeUndefined();
      expect(prop(made, 'Budget').number).toEqual({ format: 'dollar' });
    });

    it('has the measured views', () => {
      const made = build('events', true);

      expect(views(made)).toEqual([['All Events', 'table', undefined], ['By Status', 'board', 'Status'], ['Calendar', 'calendar', undefined], ['By Category', 'table', 'Category'], ['My Events', 'table', undefined]]);
      expect(shown(made, 'All Events')).toEqual(['Event date', 'Status', 'Event owner', 'Format', 'Category', 'Venue', 'Capacity', 'Budget', 'Event URL']);
      expect(sortsOf(made, 'All Events')).toEqual([['Event date', 'desc']]);
      expect(viewNamed(made, 'All Events')).toMatchObject(tableLook);
      expect(shown(made, 'By Status')).toEqual(['Event owner', 'Format', 'Category', 'Event date', 'Venue']);
      expect(sortsOf(made, 'By Status')).toEqual([['Event date', 'desc']]);
      // §3.3: the switch reads on, but the empty columns draw. Blok saves the drawn result.
      expect(viewNamed(made, 'By Status')).toMatchObject({
        showPageIcon: true, wrapCells: true, openPagesIn: 'side', loadLimit: 25, cardPreview: 'none', cardSize: 'medium',
        groupSettings: { sort: 'ascending', hideEmptyGroups: false, colorColumns: true },
      });
      expect(viewNamed(made, 'Calendar')).toMatchObject({ calendarBy: prop(made, 'Event date').id, calendarRange: 'month', showWeekends: true, showPageIcon: true, wrapCells: false, openPagesIn: 'center' });
      expect(shown(made, 'Calendar')).toEqual([]);
      expect(shown(made, 'By Category')).toEqual(['Category', 'Format', 'Status', 'Event URL', 'Event date', 'Event owner', 'Budget', 'Venue', 'Capacity']);
      expect(sortsOf(made, 'By Category')).toEqual([['Event date', 'desc']]);
      expect(viewNamed(made, 'By Category')).toMatchObject({ showPageIcon: true, wrapCells: true, showVerticalLines: true, loadLimit: 25, groupSettings: { sort: 'manual', hideEmptyGroups: false } });
      expect(groupsOf(made, 'By Category')).toEqual([
        'Conference', 'Retreat', 'Tradeshow', 'No Category', 'Webinar', 'Workshop', 'Community meetup', 'Internal event', 'Partner event', 'Team building',
      ]);
      expect(shown(made, 'My Events')).toEqual(shown(made, 'By Category'));
      expect(filtersOf(made, 'My Events')).toEqual([['Event owner', 'contains', [ME_FILTER_VALUE]]]);
      expect(viewNamed(made, 'My Events')).toMatchObject({ ...tableLook, showPageIcon: true });
    });

    it('has the three measured rows; Event owner empty and the unread URLs left out', () => {
      const made = build('events', true);
      const value = (row: number, name: string): unknown => made.rows[row].data.properties[prop(made, name).id];
      const label = (row: number, name: string): unknown => labelOf(made, prop(made, name), value(row, name));

      expect(made.rows.map((r) => r.data.title)).toEqual(['Make with Notion', 'Fireside chat with Ivan Zhao', 'VIP dinner']);
      expect([0, 1, 2].map((i) => [value(i, 'Event date'), label(i, 'Status'), label(i, 'Format'), label(i, 'Category'), label(i, 'Venue'), value(i, 'Capacity'), value(i, 'Budget'), value(i, 'Event URL'), value(i, 'Event owner')])).toEqual([
        ['2025-09-16', 'Registration open', 'In person', 'Community meetup', 'Venue 3', 2000, 500000, 'makewithnotion.com/', []],
        ['2025-03-13', 'Planning', 'In person', 'Internal event', 'Venue 2', 100, 10000, undefined, []],
        ['2025-02-12', 'Done', 'Virtual', 'Community meetup', 'Venue 1', 50, 5000, undefined, []],
      ]);
    });

    it('"New event" has the measured body and page layout', () => {
      const made = build('events', true);

      expect(bodyText(made.templates[0].body)).toEqual([
        'H2 About event', 'Provide a short overview of the event goals and context.', '(empty)',
        'H2 Tasks', 'Add tasks to plan and execute the event.', 'checklist', 'checklist', 'checklist', '(empty)',
        'H2 Notes', 'unordered', 'unordered', 'unordered', '(empty)',
        'H2 Supporting files',
      ]);
      expect(made.schema[0].pageLayoutGroupIn).toBe('panel');
      expect(placements(made)).toEqual([
        ['Status', 'heading'], ['Event date', 'heading'], ['Event owner', 'heading'], ['Category', 'heading'],
        ['Format', 'group'], ['Venue', 'group'], ['Budget', 'group'], ['Capacity', 'group'], ['Event URL', 'group'],
      ]);
    });

    it('the defaults leave out Budget, Capacity and Event URL, and the off views', () => {
      const made = build('events');

      expect(made.schema.map((p) => p.name)).toEqual(['Event name', 'Event date', 'Status', 'Event owner', 'Format', 'Category', 'Venue']);
      expect(made.views.map((v) => v.name)).toEqual(['All Events', 'By Status', 'Calendar']);
      expect(placements(made).map(([name]) => name)).toEqual(['Status', 'Event date', 'Event owner', 'Category', 'Format', 'Venue']);
    });
  });

  describe('Social Media Planner (§3.5)', () => {
    it('has the measured schema and options', () => {
      const made = build('socialMedia', true);

      expect(made.schema.map((p) => [p.name, p.type])).toEqual([
        ['Post name', 'title'], ['Content type', 'multiSelect'], ['Owner', 'person'], ['Platform', 'multiSelect'], ['Post URL', 'url'], ['Post date', 'date'],
        ['Status', 'status'], ['Target audiences', 'multiSelect'],
      ]);
      expect(options(made, 'Content type')).toEqual([
        ['Text', 'yellow'], ['Image / photo', 'orange'], ['Video', 'blue'], ['Link', 'purple'], ['Carousel', 'red'], ['Poll', 'brown'], ['Story', 'gray'], ['Live stream', 'pink'],
      ]);
      expect(options(made, 'Platform')).toEqual([['Linkedin', 'brown'], ['TikTok', 'default'], ['X', 'blue'], ['YouTube', 'red'], ['Instagram', 'green']]);
      expect(prop(made, 'Post date').date).toEqual({ dateFormat: 'full', timeFormat: '12_hour' });
      expect(statusOf(made)).toEqual([
        ['Post Idea', undefined, 'todo'], ['Draft', 'yellow', 'inProgress'], ['Ready for Review', 'purple', 'inProgress'], ['Scheduled', 'blue', 'inProgress'],
        ['Published', 'green', 'complete'], ['Cancelled', 'red', 'complete'],
      ]);
      expect(defaultLabel(made)).toBe('Post Idea');
      expect(options(made, 'Target audiences')).toEqual([['Segment 1', 'purple'], ['Segment 2', 'yellow'], ['Segment 3', 'gray']]);
    });

    it('has the measured views; the calendar hides weekends', () => {
      const made = build('socialMedia', true);

      expect(views(made)).toEqual([['Calendar', 'calendar', undefined], ['All Posts', 'table', undefined], ['By Status', 'board', 'Status'], ['By Platform', 'table', 'Platform']]);
      expect(viewNamed(made, 'Calendar')).toMatchObject({ calendarBy: prop(made, 'Post date').id, calendarRange: 'month', showWeekends: false, showPageIcon: true, wrapCells: false, openPagesIn: 'center' });
      expect(shown(made, 'All Posts')).toEqual(['Owner', 'Status', 'Post date', 'Platform', 'Content type', 'Target audiences', 'Post URL']);
      expect(viewNamed(made, 'All Posts')).toMatchObject({ ...tableLook, wrapCells: true });
      expect(shown(made, 'By Status')).toEqual(['Post date', 'Platform', 'Owner']);
      expect(viewNamed(made, 'By Status')).toMatchObject({ showPageIcon: true, wrapCells: true, loadLimit: 25, groupSettings: { sort: 'ascending', hideEmptyGroups: false, colorColumns: true } });
      expect(shown(made, 'By Platform')).toEqual(['Status', 'Owner', 'Post date', 'Content type']);
      expect(viewNamed(made, 'By Platform')).toMatchObject({ showPageIcon: true, wrapCells: false, showVerticalLines: true, loadLimit: 25 });
      expect(made.views.map((v) => sortsOf(made, v.name))).toEqual([[], [['Post date', 'desc']], [['Post date', 'desc']], [['Post date', 'desc']]]);
    });

    it('has the three measured rows', () => {
      const made = build('socialMedia', true);
      const labels = (row: number, name: string): unknown[] => {
        const value = made.rows[row].data.properties[prop(made, name).id];

        return (Array.isArray(value) ? value : [value]).map((id) => labelOf(made, prop(made, name), id));
      };

      expect(made.rows.map((r) => r.data.title)).toEqual(['Founder interview', 'Brand awareness', 'Product launch']);
      expect([0, 1, 2].map((i) => [labels(i, 'Status'), made.rows[i].data.properties[prop(made, 'Post date').id], labels(i, 'Content type'), labels(i, 'Platform')])).toEqual([
        [['Post Idea'], '2025-03-12', ['Video'], ['Linkedin', 'X']],
        [['Scheduled'], '2025-03-05', ['Image / photo', 'Video'], ['Linkedin', 'YouTube', 'X']],
        [['Published'], '2025-02-13', ['Carousel', 'Text'], ['Linkedin', 'Instagram', 'X']],
      ]);
    });

    it('"New post" has the measured body and page layout', () => {
      const made = build('socialMedia', true);

      expect(bodyText(made.templates[0].body)).toEqual([
        'H1 Request Overview', 'Basic information about who is requesting the social media post and their objective.',
        'H1 Content Description', 'Detailed description of what needs to be posted and any specific messaging requirements.',
        'H1 Resource Needs', 'Required assets, copy approval contacts, and other resources needed to fulfill this request.',
        'H1 Request Status', 'Current status of the request, next steps, and completion timeline.', '(empty)',
      ]);
      expect(placements(made)).toEqual([
        ['Status', 'heading'], ['Owner', 'heading'], ['Post date', 'heading'], ['Platform', 'heading'], ['Post URL', 'heading'],
        ['Content type', 'group'], ['Target audiences', 'group'],
      ]);
    });
  });

  describe('Campaign Management with every chip on (§3.6)', () => {
    it('Owner is a person after the title and Budget a US dollar number after Audiences targeted', () => {
      const made = build('campaign', true);

      expect(made.schema.map((p) => [p.name, p.type])).toEqual([
        ['Campaign name', 'title'], ['Owner', 'person'], ['Channels', 'multiSelect'], ['Markets', 'multiSelect'], ['Campaign type', 'multiSelect'],
        ['Audiences targeted', 'multiSelect'], ['Budget', 'number'], ['Completion date', 'date'], ['Files & media', 'files'], ['Status', 'status'],
      ]);
      expect(prop(made, 'Budget').number).toEqual({ format: 'dollar' });
      expect([chips('campaign', 'features', false), chips('campaign', 'views', false)]).toEqual([['Owner', 'Budget'], ['By Market']]);
    });

    it('Owner joins By Status, All Campaigns and By Market; Budget only All Campaigns', () => {
      const made = build('campaign', true);

      expect(shown(made, 'By Status')).toEqual(['Owner', 'Channels', 'Markets', 'Campaign type']);
      expect(shown(made, 'All Campaigns')).toEqual(['Status', 'Owner', 'Audiences targeted', 'Campaign type', 'Channels', 'Markets', 'Budget', 'Files & media', 'Completion date']);
      expect(views(made).at(-1)).toEqual(['By Market', 'table', 'Markets']);
      expect(shown(made, 'By Market')).toEqual(['Status', 'Owner', 'Markets', 'Campaign type', 'Channels', 'Audiences targeted']);
      expect(viewNamed(made, 'By Market')).toMatchObject({ sorts: [], showPageIcon: true, wrapCells: false, showVerticalLines: true, loadLimit: 25, openPagesIn: 'side', groupSettings: { sort: 'manual', hideEmptyGroups: false } });
      expect(groupsOf(made, 'By Market')).toEqual(['APAC', 'FR', 'LATAM', 'UK', 'AMER', 'EMEA', 'No Markets']);
    });

    it('By Status saves Hide empty groups off: Notion draws its empty columns (§3.3)', () => {
      expect(viewNamed(build('campaign'), 'By Status').groupSettings).toEqual({ sort: 'manual', hideEmptyGroups: false, colorColumns: true });
    });

    it('"New campaign" has the measured body and page layout', () => {
      const made = build('campaign', true);

      expect(bodyText(made.templates[0].body)).toEqual([
        'H2 About campaign', 'Provide a brief overview of the campaign\'s goals and context.', '(empty)',
        'H2 Tasks', 'Add tasks required to plan and execute the campaign.', 'checklist', 'checklist', 'checklist', '(empty)',
        'H2 Related files',
      ]);
      expect(placements(made)).toEqual([
        ['Status', 'heading'], ['Owner', 'heading'], ['Completion date', 'heading'], ['Campaign type', 'heading'],
        ['Markets', 'group'], ['Channels', 'group'], ['Audiences targeted', 'group'], ['Files & media', 'group'], ['Budget', 'group'],
      ]);
    });
  });

  describe('Content Calendar with every chip on (§3.7)', () => {
    it('Accounts is a multi-select after Platform; the order is research/33\'s', () => {
      const made = build('contentCalendar', true);

      expect(made.schema.map((p) => [p.name, p.type])).toEqual([
        ['Content name', 'title'], ['Owner', 'person'], ['Content type', 'select'], ['Platform', 'multiSelect'], ['Accounts', 'multiSelect'],
        ['Film date', 'date'], ['Post URL', 'url'], ['Publish date', 'date'], ['Status', 'status'],
      ]);
      expect(options(made, 'Accounts')).toEqual([['@Account1', 'gray'], ['@Account2', 'red'], ['@Account3', 'blue']]);
      expect([chips('contentCalendar', 'features', false), chips('contentCalendar', 'views', false)]).toEqual([['Accounts'], ['By Platform']]);
    });

    it('By Platform is a table grouped by Platform in its own order, sorted by Publish date', () => {
      const made = build('contentCalendar', true);

      expect(views(made).at(-1)).toEqual(['By Platform', 'table', 'Platform']);
      expect(shown(made, 'By Platform')).toEqual(['Owner', 'Status', 'Film date', 'Publish date', 'Content type', 'Platform', 'Accounts', 'Post URL']);
      expect(shown(made, 'All Content')).toEqual(shown(made, 'By Platform'));
      expect(shown(made, 'By Status')).toEqual(['Owner', 'Content type', 'Platform', 'Accounts']);
      expect(sortsOf(made, 'By Platform')).toEqual([['Publish date', 'desc']]);
      expect(viewNamed(made, 'By Platform')).toMatchObject({ showPageIcon: true, wrapCells: true, showVerticalLines: true, loadLimit: 25, groupSettings: { sort: 'manual', hideEmptyGroups: false } });
      expect(groupsOf(made, 'By Platform')).toEqual(['Instagram', 'LinkedIn', 'X', 'Blog / website', 'Email', 'Spotify', 'Tiktok', 'YouTube', 'No Platform']);
      expect(viewNamed(made, 'By Status').groupSettings).toEqual({ sort: 'ascending', hideEmptyGroups: false, colorColumns: true });
    });

    it('"New content" has the measured body and page layout', () => {
      const made = build('contentCalendar', true);

      expect(bodyText(made.templates[0].body)).toEqual([
        'H2 Content overview', 'Provide 2-3 sentences describing the content.', '(empty)',
        'H2 ToDos', 'checklist', 'checklist', 'checklist', '(empty)', 'H2 Notes', 'unordered', 'unordered',
      ]);
      expect(placements(made)).toEqual([
        ['Status', 'heading'], ['Owner', 'heading'], ['Content type', 'heading'], ['Post URL', 'heading'],
        ['Publish date', 'group'], ['Platform', 'group'], ['Accounts', 'group'], ['Film date', 'group'],
      ]);
    });
  });

  describe('Issue Tracking (§3.11)', () => {
    it('has the measured schema', () => {
      const made = build('issues', true);

      expect(made.schema.map((p) => [p.name, p.type])).toEqual([
        ['Issue', 'title'], ['Assigned to', 'person'], ['Type', 'multiSelect'], ['Priority', 'select'], ['Created time', 'createdTime'], ['Days open', 'formula'],
        ['Due date', 'date'], ['Status', 'status'],
      ]);
      expect(options(made, 'Type')).toEqual([['Security', 'yellow'], ['Technical debt', 'gray'], ['Feature request', 'brown'], ['Bug', 'pink']]);
      expect(options(made, 'Priority')).toEqual([['High', 'red'], ['Medium', 'yellow'], ['Low', 'default']]);
      expect(prop(made, 'Created time').date).toEqual({ dateFormat: 'full', timeFormat: '12_hour' });
      expect(statusOf(made)).toEqual([
        ['Backlog', 'gray', 'todo'], ['Open', undefined, 'todo'], ['In progress', 'blue', 'inProgress'], ['In review', 'brown', 'inProgress'], ['Testing', 'purple', 'inProgress'],
        ['Won’t fix', 'red', 'complete'], ['Resolved', 'green', 'complete'],
      ]);
      expect(defaultLabel(made)).toBe('Open');
    });

    it('Days open reads "1 day", "N days" while Open, and "Issue Closed" otherwise (§3.12)', () => {
      const made = build('issues', true);
      const days = prop(made, 'Days open');
      const status = prop(made, 'Status');
      const open = status.config?.options[1].id ?? '';
      const done = status.config?.options[6].id ?? '';
      const day = 24 * 60 * 60 * 1000;
      const now = new Date('2026-10-21T12:00:00Z');
      const row = (id: string, state: string, age: number): { id: string; position: string; properties: Record<string, string>; meta: { createdAt: number } } =>
        ({ id, position: id, properties: { [status.id]: state }, meta: { createdAt: now.getTime() - age * day } });
      const engine = new ComputedProperties('db');
      const rows = engine.apply(made.schema, [row('a', open, 1), row('b', open, 5), row('c', done, 5)], { databaseId: 'db', now, timeZone: 'UTC' });

      expect(rows.map((r) => readPropertyValue(r, days))).toEqual(['1 day', '5 days', 'Issue Closed']);
    });

    it('has the measured views', () => {
      const made = build('issues', true);
      const priorityGroups = { sort: 'manual', hideEmptyGroups: true };

      expect(views(made)).toEqual([
        ['Kanban', 'board', 'Status'], ['All Issues', 'table', undefined], ['My Issues', 'list', 'Priority'], ['Untriaged', 'table', 'Priority'], ['Completed', 'table', 'Priority'],
      ]);
      expect(shown(made, 'Kanban')).toEqual(['Assigned to', 'Type', 'Priority']);
      expect(viewNamed(made, 'Kanban')).toMatchObject({ showPageIcon: true, wrapCells: true, loadLimit: 25, groupSettings: { sort: 'ascending', hideEmptyGroups: false, colorColumns: true } });
      expect(shown(made, 'All Issues')).toEqual(['Assigned to', 'Status', 'Type', 'Priority', 'Created time', 'Due date', 'Days open']);
      expect(viewNamed(made, 'All Issues')).toMatchObject(tableLook);
      expect(shown(made, 'My Issues')).toEqual(['Status', 'Days open', 'Assigned to', 'Type', 'Created time']);
      expect(filtersOf(made, 'My Issues')).toEqual([['Assigned to', 'contains', [ME_FILTER_VALUE]]]);
      expect(viewNamed(made, 'My Issues')).toMatchObject({ showPageIcon: true, loadLimit: 25, groupSettings: priorityGroups });
      expect(shown(made, 'Untriaged')).toEqual(['Assigned to', 'Status', 'Type', 'Created time', 'Due date', 'Days open']);
      expect(filtersOf(made, 'Untriaged')).toEqual([['Assigned to', 'is_empty', null]]);
      expect(shown(made, 'Completed')).toEqual(shown(made, 'Untriaged'));
      expect(filtersOf(made, 'Completed')).toEqual([['Status', 'equals', ['complete']]]);
      for (const name of ['Untriaged', 'Completed']) {
        expect(viewNamed(made, name)).toMatchObject({ showPageIcon: true, wrapCells: true, showVerticalLines: true, loadLimit: 25, groupSettings: priorityGroups });
      }
      expect(made.views.map((v) => sortsOf(made, v.name))).toEqual([
        [['Created time', 'desc']], [['Created time', 'desc']], [['Created time', 'asc']], [['Created time', 'desc']], [['Created time', 'desc']],
      ]);
      expect(made.rows).toEqual([]);
    });
  });

  describe('Feature Requests (§3.11)', () => {
    it('has the measured schema', () => {
      const made = build('featureRequests', true);

      expect(made.schema.map((p) => [p.name, p.type])).toEqual([
        ['Request name', 'title'], ['Assigned to', 'person'], ['Estimated effort', 'select'], ['Priority', 'select'], ['Product area', 'multiSelect'],
        ['Related files', 'files'], ['Requested by', 'person'], ['Requested date', 'createdTime'], ['Status', 'status'],
      ]);
      expect(options(made, 'Estimated effort')).toEqual([['XL', 'red'], ['L', 'orange'], ['M', 'yellow'], ['S', 'default']]);
      expect(options(made, 'Priority')).toEqual([['High', 'red'], ['Medium', 'yellow'], ['Low', 'green']]);
      expect(options(made, 'Product area')).toEqual([['Mobile', 'pink'], ['Growth', 'green'], ['AI', 'orange'], ['Other', 'purple']]);
      expect(statusOf(made)).toEqual([
        ['New', undefined, 'todo'], ['Under Review', 'yellow', 'inProgress'], ['Planned', 'brown', 'inProgress'], ['In Development', 'blue', 'inProgress'],
        ['Launched', 'green', 'complete'], ['Declined', 'red', 'complete'],
      ]);
      expect(defaultLabel(made)).toBe('New');
    });

    it('has the measured views', () => {
      const made = build('featureRequests', true);

      expect(views(made)).toEqual([
        ['By Status', 'board', 'Status'], ['All Requests', 'table', undefined], ['Assigned to Me', 'table', undefined],
        ['High Priority Requests', 'table', undefined], ['New Unassigned Requests', 'table', undefined],
      ]);
      expect(shown(made, 'By Status')).toEqual([]);
      expect(sortsOf(made, 'By Status')).toEqual([]);
      expect(shown(made, 'All Requests')).toEqual(['Requested by', 'Status', 'Product area', 'Priority', 'Requested date', 'Estimated effort', 'Related files', 'Assigned to']);
      expect(viewNamed(made, 'All Requests')).toMatchObject(tableLook);
      expect(shown(made, 'Assigned to Me')).toEqual(['Status', 'Assigned to', 'Priority', 'Product area', 'Estimated effort']);
      expect(filtersOf(made, 'Assigned to Me')).toEqual([['Assigned to', 'contains', [ME_FILTER_VALUE]]]);
      expect(shown(made, 'High Priority Requests')).toEqual(['Status', 'Assigned to', 'Priority', 'Estimated effort', 'Product area']);
      expect(filtersOf(made, 'High Priority Requests')).toEqual([['Priority', 'equals', ['High']]]);
      expect(shown(made, 'New Unassigned Requests')).toEqual(['Assigned to', 'Status', 'Requested date', 'Priority', 'Product area']);
      expect(filtersOf(made, 'New Unassigned Requests')).toEqual([['Assigned to', 'is_empty', null]]);
      for (const name of ['All Requests', 'Assigned to Me', 'High Priority Requests', 'New Unassigned Requests']) {
        expect(sortsOf(made, name)).toEqual([['Requested date', 'desc']]);
      }
      for (const name of ['Assigned to Me', 'High Priority Requests', 'New Unassigned Requests']) {
        expect(viewNamed(made, name)).toMatchObject({ ...tableLook, showPageIcon: true });
      }
    });
  });

  describe('Engineering Docs (§3.11)', () => {
    it('has the measured schema; Author defaults to its creator', () => {
      const made = build('engineeringDocs', true);

      expect(made.schema.map((p) => [p.name, p.type])).toEqual([
        ['Doc name', 'title'], ['Author', 'person'], ['Status', 'status'], ['Category', 'multiSelect'], ['Reviewers', 'person'], ['Created time', 'createdTime'],
        ['Last edited time', 'lastEditedTime'],
      ]);
      expect(prop(made, 'Author').person).toEqual({ default: 'createdBy' });
      expect(statusOf(made)).toEqual([['Draft', undefined, 'todo'], ['In Review', 'blue', 'inProgress'], ['Published', 'green', 'complete'], ['Outdated', 'brown', 'complete']]);
      expect(options(made, 'Category')).toEqual([['Tech Spec', 'pink'], ['PRD', 'default'], ['Guide', 'yellow'], ['Best Practices', 'orange'], ['Architecture', 'blue']]);
      expect(prop(made, 'Last edited time').date).toEqual({ dateFormat: 'relative', timeFormat: '12_hour' });
    });

    it('has the measured views', () => {
      const made = build('engineeringDocs', true);
      const look = { ...tableLook, showPageIcon: true, wrapCells: true };

      expect(views(made)).toEqual([
        ['All Docs', 'table', undefined], ['Published Docs', 'list', undefined], ['Docs by Category', 'table', 'Category'], ['Recently Edited', 'table', undefined], ['My Docs', 'table', undefined],
      ]);
      expect(made.views.every((v) => sortsOf(made, v.name).join() === 'Last edited time,desc')).toBe(true);
      expect(shown(made, 'All Docs')).toEqual(['Author', 'Status', 'Category', 'Reviewers', 'Created time', 'Last edited time']);
      expect(viewNamed(made, 'All Docs')).toMatchObject({ ...tableLook, wrapCells: true });
      expect(shown(made, 'Published Docs')).toEqual(['Category', 'Author', 'Last edited time']);
      expect(filtersOf(made, 'Published Docs')).toEqual([['Status', 'equals', ['Published']]]);
      expect(viewNamed(made, 'Published Docs')).toMatchObject({ showPageIcon: true, loadLimit: 50 });
      expect(shown(made, 'Docs by Category')).toEqual(['Author', 'Status']);
      expect(viewNamed(made, 'Docs by Category')).toMatchObject({ ...look, loadLimit: 25, groupSettings: { sort: 'manual', hideEmptyGroups: false } });
      expect(groupsOf(made, 'Docs by Category')).toEqual(['PRD', 'Tech Spec', 'Architecture', 'Best Practices', 'Guide', 'No Category']);
      expect(shown(made, 'Recently Edited')).toEqual(['Category', 'Status', 'Author', 'Last edited time']);
      expect(viewNamed(made, 'Recently Edited')).toMatchObject(look);
      expect(shown(made, 'My Docs')).toEqual(['Category', 'Status', 'Last edited time']);
      expect(filtersOf(made, 'My Docs')).toEqual([['Author', 'contains', [ME_FILTER_VALUE]]]);
      expect(viewNamed(made, 'My Docs')).toMatchObject(look);
    });
  });

  describe('Fundraising Tracker (§3.11)', () => {
    it('has the measured schema', () => {
      const made = build('fundraising', true);

      expect(made.schema.map((p) => [p.name, p.type])).toEqual([
        ['Investor name', 'title'], ['Partner email', 'email'], ['Warm contact email', 'email'], ['Average check size', 'number'], ['Capital committed', 'number'],
        ['Description', 'text'], ['Firm LinkedIn', 'text'], ['Last contact date', 'date'], ['Lost reason', 'text'], ['Partner name', 'text'], ['Portfolio', 'text'],
        ['Status', 'status'], ['Warm contact name', 'text'],
      ]);
      expect([prop(made, 'Average check size').number, prop(made, 'Capital committed').number]).toEqual([{ format: 'dollar' }, { format: 'dollar' }]);
      expect(statusOf(made)).toEqual([['Not started', undefined, 'todo'], ['Diligence', 'blue', 'inProgress'], ['Pitched', 'yellow', 'inProgress'], ['Won', 'green', 'complete'], ['Lost', 'red', 'complete']]);
    });

    it('has the measured views', () => {
      const made = build('fundraising', true);
      const everything = made.schema.slice(1).map((p) => p.name);
      const investors = ['Status', 'Capital committed', 'Partner name', 'Partner email', 'Warm contact name', 'Warm contact email', 'Average check size', 'Description', 'Portfolio', 'Firm LinkedIn', 'Lost reason', 'Last contact date'];

      expect(views(made)).toEqual([['By Status', 'board', 'Status'], ['All Investors', 'table', undefined], ['Won', 'table', undefined], ['Lost', 'table', undefined], ['In Progress', 'table', undefined]]);
      expect(shown(made, 'By Status')).toEqual(['Partner email', 'Warm contact email']);
      expect(shown(made, 'All Investors')).toEqual(investors);
      expect(sortsOf(made, 'All Investors')).toEqual([['Last contact date', 'asc']]);
      expect(shown(made, 'Won')).toEqual(everything);
      expect(shown(made, 'Lost')).toEqual(everything);
      expect(shown(made, 'In Progress')).toEqual(investors);
      expect([filtersOf(made, 'Won'), filtersOf(made, 'Lost'), filtersOf(made, 'In Progress')]).toEqual([
        [['Status', 'equals', ['Won']]], [['Status', 'equals', ['Lost']]], [['Status', 'equals', ['inProgress']]],
      ]);
      expect(viewNamed(made, 'In Progress')).toMatchObject({ ...tableLook, showPageIcon: true });
    });
  });

  describe('Pipeline Tracking (§3.11)', () => {
    it('has the measured schema', () => {
      const made = build('pipeline', true);

      expect(made.schema.map((p) => [p.name, p.type])).toEqual([
        ['Name', 'title'], ['Account owner', 'person'], ['Priority level', 'select'], ['Days since last contact', 'formula'], ['Deal stage', 'select'], ['Deal value', 'number'],
        ['Decision maker', 'person'], ['Email', 'email'], ['Expected close date', 'date'], ['Last contact date', 'date'], ['Lead source', 'multiSelect'], ['Notes', 'text'], ['Phone number', 'phone'],
      ]);
      expect(options(made, 'Priority level')).toEqual([['Low', 'gray'], ['Medium', 'blue'], ['High', 'purple']]);
      expect(options(made, 'Deal stage')).toEqual([['New', 'green'], ['Discovery', 'red'], ['Negotiation', 'orange'], ['Won', 'blue'], ['Lost', 'pink']]);
      expect(prop(made, 'Deal value').number).toEqual({ format: 'dollar' });
      expect(options(made, 'Lead source')).toEqual([['Inbound', 'gray'], ['Outbound', 'orange'], ['Referral', 'blue'], ['Event', 'purple'], ['Partner', 'pink'], ['Website', 'green']]);
    });

    it('Days since last contact counts the days, as measured (§3.12)', () => {
      const made = build('pipeline', true);
      const days = prop(made, 'Days since last contact');
      const last = prop(made, 'Last contact date');
      const engine = new ComputedProperties('db');
      const rows = engine.apply(made.schema, [{ id: 'a', position: 'a', properties: { [last.id]: '2026-10-11' } }], { databaseId: 'db', now: new Date('2026-10-21T12:00:00Z'), timeZone: 'UTC' });

      expect(rows.map((r) => readPropertyValue(r, days))).toEqual([10]);
    });

    it('Days since last contact needs Last contact date: without it the chip adds nothing', () => {
      const made = buildStarter('pipeline', { t, newId, titleId: 'old-title', features: new Set(['daysSince']), views: allOf('pipeline', 'views') });

      expect(made.schema.map((p) => p.name)).not.toContain('Days since last contact');
      expect(sortsOf(made, 'Recently Contacted')).toEqual([]);
    });

    it('has the measured views', () => {
      const made = build('pipeline', true);
      const deals = ['Account owner', 'Deal stage', 'Priority level', 'Deal value', 'Email', 'Phone number', 'Notes', 'Expected close date', 'Last contact date', 'Lead source', 'Decision maker', 'Days since last contact'];

      expect(views(made)).toEqual([['By Deal Stage', 'board', 'Deal stage'], ['All Deals', 'table', undefined], ['Active Deals', 'table', undefined], ['Recently Contacted', 'table', undefined]]);
      expect(shown(made, 'By Deal Stage')).toEqual(['Account owner', 'Priority level']);
      expect(viewNamed(made, 'By Deal Stage')).toMatchObject({ groupSettings: { sort: 'manual', hideEmptyGroups: false, colorColumns: true } });
      expect(groupsOf(made, 'By Deal Stage')).toEqual(['New', 'Discovery', 'Negotiation', 'Won', 'Lost', 'No Deal stage']);
      expect(shown(made, 'All Deals')).toEqual(deals);
      expect(viewNamed(made, 'All Deals')).toMatchObject({ ...tableLook, wrapCells: true });
      expect(shown(made, 'Active Deals')).toEqual(deals);
      expect(filtersOf(made, 'Active Deals')).toEqual([['Deal stage', 'equals', ['Discovery', 'Negotiation']]]);
      expect(shown(made, 'Recently Contacted')).toEqual([
        'Days since last contact', 'Account owner', 'Deal stage', 'Priority level', 'Deal value', 'Email', 'Phone number', 'Expected close date', 'Last contact date', 'Lead source',
      ]);
      expect(sortsOf(made, 'Recently Contacted')).toEqual([['Days since last contact', 'desc']]);
    });
  });

  describe('Account Management (§3.11)', () => {
    it('has the measured schema; Status is a select', () => {
      const made = build('accounts', true);

      expect(made.schema.map((p) => [p.name, p.type])).toEqual([
        ['Account name', 'title'], ['Account manager', 'person'], ['Product categories', 'multiSelect'], ['Contact email', 'email'], ['Contract value', 'number'],
        ['Last contact date', 'date'], ['Notes', 'text'], ['Phone number', 'phone'], ['Region', 'multiSelect'], ['Status', 'select'],
      ]);
      expect(options(made, 'Product categories')).toEqual([['Base subscription', 'blue'], ['Analytics', 'pink'], ['Custom integrations', 'brown']]);
      expect(options(made, 'Region')).toEqual([['AMER', 'blue'], ['EMEA', 'pink'], ['APAC', 'green']]);
      expect(options(made, 'Status')).toEqual([['Active', 'brown'], ['At Risk', 'pink'], ['Pending Renewal', 'green'], ['On Hold', 'orange'], ['Churned', 'yellow']]);
      expect(prop(made, 'Contract value').number).toEqual({ format: 'dollar' });
    });

    it('has the measured views and group orders', () => {
      const made = build('accounts', true);

      expect(views(made)).toEqual([['By Status', 'board', 'Status'], ['All Accounts', 'table', undefined], ['By Region', 'table', 'Region'], ['Active Accounts', 'table', undefined]]);
      expect(shown(made, 'By Status')).toEqual(['Account manager', 'Product categories']);
      expect(groupsOf(made, 'By Status')).toEqual(['Active', 'Churned', 'Pending Renewal', 'At Risk', 'On Hold', 'No Status']);
      expect(shown(made, 'All Accounts')).toEqual(['Account manager', 'Status', 'Contract value', 'Contact email', 'Last contact date', 'Phone number', 'Product categories', 'Notes', 'Region']);
      expect(viewNamed(made, 'All Accounts')).toMatchObject({ ...tableLook, wrapCells: true });
      expect(shown(made, 'By Region')).toEqual(['Account manager', 'Status', 'Contract value', 'Contact email', 'Last contact date', 'Phone number', 'Notes', 'Product categories', 'Region']);
      expect(viewNamed(made, 'By Region')).toMatchObject({ ...tableLook, showPageIcon: true, loadLimit: 25, groupSettings: { sort: 'manual', hideEmptyGroups: false } });
      expect(groupsOf(made, 'By Region')).toEqual(['AMER', 'APAC', 'EMEA', 'No Region']);
      expect(shown(made, 'Active Accounts')).toEqual(['Account manager', 'Status', 'Contract value', 'Contact email', 'Last contact date', 'Phone number', 'Region', 'Notes', 'Product categories']);
      expect(filtersOf(made, 'Active Accounts')).toEqual([['Status', 'equals', ['Active']]]);
    });
  });

  describe('Creative Projects (§3.11)', () => {
    it('has the measured schema', () => {
      const made = build('creative', true);

      expect(made.schema.map((p) => [p.name, p.type])).toEqual([
        ['Project name', 'title'], ['Owner', 'person'], ['Creative type', 'multiSelect'], ['Assets', 'files'], ['End date', 'date'], ['Priority', 'select'], ['Start date', 'date'], ['Status', 'status'],
      ]);
      expect(options(made, 'Creative type')).toEqual([
        ['Video', 'red'], ['Photography', 'default'], ['Illustration', 'orange'], ['Print', 'brown'], ['Signage', 'pink'], ['Branding', 'gray'], ['Motion', 'purple'],
        ['Website', 'blue'], ['Sound / music', 'green'], ['Other', 'yellow'],
      ]);
      expect(options(made, 'Priority')).toEqual([['Low', 'blue'], ['Medium', 'yellow'], ['High', 'red']]);
      expect(statusOf(made)).toEqual([['Not started', undefined, 'todo'], ['In progress', 'blue', 'inProgress'], ['Needs review', 'yellow', 'inProgress'], ['In review', 'purple', 'inProgress'], ['Done', 'green', 'complete']]);
    });

    it('has the measured views', () => {
      const made = build('creative', true);

      expect(views(made)).toEqual([['By Status', 'board', 'Status'], ['All Projects', 'table', undefined], ['My Projects', 'table', undefined], ['Timeline', 'timeline', undefined], ['By Type', 'table', 'Creative type']]);
      expect(shown(made, 'By Status')).toEqual(['Owner', 'Creative type']);
      // Read on; the empty columns are inferred to draw as on the other Status boards (§3.3, §3.13).
      expect(viewNamed(made, 'By Status').groupSettings).toEqual({ sort: 'ascending', hideEmptyGroups: false, colorColumns: true });
      expect(shown(made, 'All Projects')).toEqual(['Priority', 'Owner', 'Status', 'Start date', 'End date', 'Creative type', 'Assets']);
      expect(sortsOf(made, 'All Projects')).toEqual([['Start date', 'desc']]);
      expect(shown(made, 'My Projects')).toEqual(['Status', 'Priority', 'Creative type', 'Assets']);
      expect(filtersOf(made, 'My Projects')).toEqual([['Owner', 'contains', [ME_FILTER_VALUE]]]);
      expect(shown(made, 'Timeline')).toEqual([]);
      expect(sortsOf(made, 'Timeline')).toEqual([['Start date', 'asc']]);
      expect(viewNamed(made, 'Timeline')).toMatchObject({ timelineBy: prop(made, 'Start date').id, showTimelineTable: false, showPageIcon: true, loadLimit: 50 });
      expect(viewNamed(made, 'Timeline').timelineEndBy).toBeUndefined();
      expect(shown(made, 'By Type')).toEqual(['Owner', 'Status', 'Start date', 'End date', 'Creative type', 'Assets']);
      expect(groupsOf(made, 'By Type')).toEqual(['Branding', 'Illustration', 'Motion', 'Other', 'Photography', 'Print', 'Signage', 'Sound / music', 'Video', 'Website', 'No Creative type']);
    });

    it('Timeline needs Start date: off, the view card adds nothing', () => {
      const made = buildStarter('creative', { t, newId, titleId: 'old-title', features: new Set(['creativeType']), views: allOf('creative', 'views') });

      expect(made.views.map((v) => v.name)).not.toContain('Timeline');
    });
  });

  describe('Inventory Management (§3.11)', () => {
    it('has the measured schema; the title stays first', () => {
      const made = build('inventory', true);

      expect(made.schema.map((p) => [p.name, p.type])).toEqual([
        ['Name', 'title'], ['ID', 'uniqueId'], ['Category', 'select'], ['Quantity in stock', 'number'], ['Reorder minimum', 'number'], ['Supplier', 'select'],
        ['Last ordered date', 'date'], ['Location', 'select'], ['Notes', 'text'], ['Reorder Status', 'formula'],
      ]);
      expect(prop(made, 'ID').uniqueId).toEqual({ prefix: 'IM' });
      expect(options(made, 'Category')).toEqual([['Hardware', 'orange'], ['Accessories', 'yellow'], ['Electronics', 'default'], ['Tools', 'red']]);
      expect(options(made, 'Supplier')).toEqual([['Supplier Z', 'brown'], ['Supplier X', 'brown'], ['Supplier Y', 'default']]);
      expect(options(made, 'Location')).toEqual([['Warehouse 3', 'purple'], ['Warehouse 1', 'pink'], ['Warehouse 2', 'blue']]);
    });

    it('Reorder Status reads Reorder, In Stock and Overstocked (§3.12)', () => {
      const made = build('inventory', true);
      const status = prop(made, 'Reorder Status');
      const stock = prop(made, 'Quantity in stock').id;
      const min = prop(made, 'Reorder minimum').id;
      const engine = new ComputedProperties('db');
      const row = (id: string, have: number, least: number): { id: string; position: string; properties: Record<string, number> } => ({ id, position: id, properties: { [stock]: have, [min]: least } });
      const rows = engine.apply(made.schema, [row('a', 5, 5), row('b', 10, 5), row('c', 11, 5)], { databaseId: 'db', now: new Date('2026-10-21T12:00:00Z') });

      expect(rows.map((r) => readPropertyValue(r, status))).toEqual(['Reorder', 'In Stock', 'Overstocked']);
    });

    it('Reorder Status needs Reorder minimum: off, the chip adds nothing', () => {
      const made = buildStarter('inventory', { t, newId, titleId: 'old-title', features: new Set(['reorderStatus']) });

      expect(made.schema.map((p) => p.name)).not.toContain('Reorder Status');
    });

    it('has the measured views', () => {
      const made = build('inventory', true);

      expect(views(made)).toEqual([['All Inventory', 'table', undefined], ['Recently Ordered', 'list', 'Last ordered date'], ['Hardware Inventory', 'table', undefined]]);
      expect(shown(made, 'All Inventory')).toEqual(['ID', 'Category', 'Quantity in stock', 'Reorder minimum', 'Supplier', 'Last ordered date', 'Location', 'Notes', 'Reorder Status']);
      expect(viewNamed(made, 'All Inventory')).toMatchObject(tableLook);
      expect(shown(made, 'Recently Ordered')).toEqual(['Category']);
      expect(sortsOf(made, 'Recently Ordered')).toEqual([['Last ordered date', 'asc']]);
      expect(viewNamed(made, 'Recently Ordered')).toMatchObject({ showPageIcon: true, loadLimit: 25, groupSettings: { sort: 'ascending', hideEmptyGroups: false } });
      expect(shown(made, 'Hardware Inventory')).toEqual(['ID', 'Category', 'Quantity in stock', 'Supplier', 'Reorder minimum', 'Last ordered date', 'Location', 'Notes', 'Reorder Status']);
      expect(filtersOf(made, 'Hardware Inventory')).toEqual([['Category', 'equals', ['Hardware']]]);
      expect(sortsOf(made, 'Hardware Inventory')).toEqual([['ID', 'asc']]);
    });
  });

  describe('Product Roadmap (§3.11)', () => {
    it('has the measured schema, the option named "red" included', () => {
      const made = build('roadmap', true);

      expect(made.schema.map((p) => [p.name, p.type])).toEqual([
        ['Project name', 'title'], ['Owner', 'person'], ['Category', 'multiSelect'], ['Date', 'date'], ['Effort', 'select'], ['Priority', 'select'],
        ['Project description', 'text'], ['Quarter', 'multiSelect'], ['Status', 'status'], ['Team', 'multiSelect'],
      ]);
      expect(options(made, 'Category')).toEqual([['New Feature', 'purple'], ['Enhancement', 'default'], ['Bug Fix', 'yellow'], ['Performance Improvement', 'orange'], ['UI/UX', 'red']]);
      expect(options(made, 'Effort')).toEqual([['red', 'red'], ['L', 'orange'], ['M', 'yellow'], ['S', 'blue'], ['XS', 'green']]);
      expect(options(made, 'Priority')).toEqual([['High', 'red'], ['Medium', 'yellow'], ['Low', 'green']]);
      expect(options(made, 'Quarter')).toEqual([['Q1', 'default'], ['Q2', 'orange'], ['Q3', 'purple'], ['Q4', 'brown']]);
      expect(statusOf(made)).toEqual([
        ['Backlog', 'brown', 'todo'], ['Planned', undefined, 'todo'], ['In progress', 'blue', 'inProgress'], ['Completed', 'green', 'complete'], ['Cancelled', 'red', 'complete'], ['On Hold', 'gray', 'complete'],
      ]);
      expect(defaultLabel(made)).toBe('Planned');
      expect(options(made, 'Team')).toEqual([['AI', 'green'], ['Platform', 'red'], ['Security', 'default'], ['Mobile', 'purple']]);
    });

    it('has the measured views', () => {
      const made = build('roadmap', true);
      const projects = ['Status', 'Owner', 'Priority', 'Category', 'Effort', 'Project description', 'Quarter', 'Team', 'Date'];

      expect(views(made)).toEqual([
        ['By Status', 'board', 'Status'], ['All Projects', 'table', undefined], ['My Projects', 'table', undefined], ['By Team', 'list', 'Team'], ['By Quarter', 'list', 'Quarter'], ['Timeline', 'timeline', undefined],
      ]);
      expect(shown(made, 'By Status')).toEqual(['Owner', 'Category']);
      expect(shown(made, 'All Projects')).toEqual(projects);
      expect(sortsOf(made, 'All Projects')).toEqual([['Date', 'desc'], ['Status', 'asc']]);
      expect(shown(made, 'My Projects')).toEqual(projects);
      expect(filtersOf(made, 'My Projects')).toEqual([['Owner', 'contains', [ME_FILTER_VALUE]]]);
      expect(shown(made, 'By Team')).toEqual(['Owner', 'Project description', 'Team']);
      expect(groupsOf(made, 'By Team')).toEqual(['AI', 'Mobile', 'No Team', 'Platform', 'Security']);
      expect(groupsOf(made, 'By Quarter')).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'No Quarter']);
      expect(sortsOf(made, 'By Team')).toEqual([['Date', 'desc']]);
      expect(viewNamed(made, 'Timeline')).toMatchObject({ timelineBy: prop(made, 'Date').id, showTimelineTable: true, showPageIcon: true });
      expect(sortsOf(made, 'Timeline')).toEqual([['Quarter', 'asc'], ['Date', 'desc']]);
    });

    it('Quarter off: no By Quarter view and the timeline sorts by Date only', () => {
      const made = buildStarter('roadmap', { t, newId, titleId: 'old-title', views: allOf('roadmap', 'views') });

      expect(made.views.map((v) => v.name)).not.toContain('By Quarter');
      expect(sortsOf(made, 'Timeline')).toEqual([['Date', 'desc']]);
    });
  });

  describe('Asset Library (§3.11)', () => {
    it('has the measured schema', () => {
      const made = build('assets', true);

      expect(made.schema.map((p) => [p.name, p.type])).toEqual([
        ['Asset name', 'title'], ['Status', 'status'], ['Asset URL', 'url'], ['Asset description', 'text'], ['Asset type', 'multiSelect'], ['Designer', 'person'],
        ['Files & media', 'files'], ['Last edited', 'lastEditedTime'],
      ]);
      expect(statusOf(made)).toEqual([
        ['Not started', undefined, 'todo'], ['Waiting for approval', 'purple', 'inProgress'], ['In progress', 'blue', 'inProgress'], ['1st draft', 'brown', 'inProgress'],
        ['2nd draft', 'yellow', 'inProgress'], ['Final version', 'green', 'complete'],
      ]);
      expect(options(made, 'Asset type')).toEqual([
        ['Icon', 'default'], ['Illustration', 'brown'], ['Photo', 'blue'], ['Logo', 'red'], ['UI Component', 'orange'], ['Color', 'green'], ['Typography', 'yellow'], ['Animation', 'gray'], ['Other', 'pink'],
      ]);
    });

    it('has the measured views', () => {
      const made = build('assets', true);

      expect(views(made)).toEqual([['Gallery', 'gallery', undefined], ['All Assets', 'table', undefined], ['By Status', 'board', 'Status'], ['Asset Type', 'table', 'Asset type'], ['My Assets', 'table', undefined]]);
      expect(shown(made, 'Gallery')).toEqual(['Status']);
      expect(viewNamed(made, 'Gallery')).toMatchObject({ showPageIcon: true, wrapCells: false, openPagesIn: 'center', loadLimit: 50, cardPreview: 'none', cardSize: 'medium' });
      expect(shown(made, 'All Assets')).toEqual(['Designer', 'Asset type', 'Files & media', 'Status', 'Asset URL', 'Asset description', 'Last edited']);
      expect(viewNamed(made, 'All Assets')).toMatchObject({ ...tableLook, wrapCells: true });
      expect(shown(made, 'By Status')).toEqual([]);
      expect(viewNamed(made, 'By Status')).toMatchObject({ fitImage: true, cardPreview: `property:${prop(made, 'Files & media').id}`, groupSettings: { sort: 'ascending', hideEmptyGroups: false, colorColumns: true } });
      expect(shown(made, 'Asset Type')).toEqual(['Designer', 'Files & media', 'Status', 'Asset URL', 'Asset description']);
      expect(viewNamed(made, 'Asset Type')).toMatchObject({ ...tableLook, loadLimit: 25 });
      expect(groupsOf(made, 'Asset Type')).toEqual(['Animation', 'Color', 'Icon', 'Illustration', 'Logo', 'Other', 'Photo', 'Typography', 'UI Component', 'No Asset type']);
      expect(shown(made, 'My Assets')).toEqual(['Asset URL', 'Asset description', 'Asset type', 'Designer', 'Files & media', 'Last edited', 'Status']);
      expect(filtersOf(made, 'My Assets')).toEqual([['Designer', 'contains', [ME_FILTER_VALUE]]]);
    });
  });
});
