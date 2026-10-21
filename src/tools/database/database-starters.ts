import { newView, positionBetween, createDefaultStatusOptions, createDefaultStatusSettings } from '../../shared/database/schema-ops';
import { DATABASE_DEFAULT_TEXT } from '../../shared/database/default-text';
import { ME_FILTER_VALUE } from './database-query';
import type { DatabaseIcon, DatabaseRowData, DatabaseStarterId, DatabaseViewConfig, PropertyDefinition, PropertyType, PropertyValue, ViewType } from './types';
import type { ViewCreateConfig } from '../../shared/database/schema-ops';

/**
 * The database templates of Notion's "New database" panel and its "More
 * templates" gallery (research/27 §1, research/30 §10). Every name, option,
 * view and sample row is as measured with the Customize defaults kept. A chip
 * or view card only adds or leaves out its property or view (research/30 B8).
 * Only the nine templates whose schema was measured are listed (research/31 §7).
 */
export type StarterId = DatabaseStarterId;

/** A Customize chip or view card. */
export interface StarterChoice {
  id: string;
  labelKey: string;
  on: boolean;
  /** A property type or a view layout, for its icon. */
  kind: PropertyType | ViewType;
}

export interface StarterMeta {
  id: StarterId;
  nameKey: string;
  /** The gallery card's one-line description (research/27 §1e). */
  descriptionKey: string;
  /**
   * The gallery card's preview (research/30 §10a): column names, and option
   * pills drawn in column `pillColumn` (a board's group headers without columns).
   */
  thumbnail: { columns: string[]; pills: Array<[string, string]>; pillColumn?: number };
  /** The panel tile tint (research/26 §2). */
  tint: DatabaseIcon['color'];
  glyph: DatabaseIcon['glyph'];
  /** The View settings row "Undo … database". Projects showed "Turn into" there instead (research/27:81). */
  undoKey?: string;
  /** Empty: the template has no Customize step. */
  features: StarterChoice[];
  views: StarterChoice[];
}

type Translate = (key: string, vars?: Record<string, string>) => string;

export interface StarterBodyBlock {
  tool: 'header' | 'paragraph' | 'list';
  data: Record<string, unknown>;
}

export interface StarterRow {
  id: string;
  data: DatabaseRowData;
  body: StarterBodyBlock[];
}

export interface StarterBuild {
  title: string;
  schema: PropertyDefinition[];
  views: DatabaseViewConfig[];
  activeViewId: string;
  rows: StarterRow[];
  /** Page templates; the first is the default. */
  templates: StarterRow[];
  icon: DatabaseIcon;
}

export interface StarterBuildOptions {
  t: Translate;
  newId: () => string;
  /** The database's own title property id: rows and the backend already name it. */
  titleId: string;
  /** Picked chips. Absent: the measured defaults. */
  features?: ReadonlySet<string>;
  /** Picked view cards. Absent: the measured defaults. */
  views?: ReadonlySet<string>;
}

const choice = (id: string, labelKey: string, on: boolean, kind: StarterChoice['kind']): StarterChoice => ({ id, labelKey, on, kind });

const STATUS_PILLS: Array<[string, string]> = [
  ['tools.database.defaultStatusNotStarted', 'gray'], ['tools.database.defaultStatusInProgress', 'blue'], ['tools.database.defaultStatusDone', 'green'],
];

export const DATABASE_STARTERS: readonly StarterMeta[] = [
  {
    id: 'tasks',
    nameKey: 'tools.database.starterTasks',
    descriptionKey: 'tools.database.starterTasksDescription',
    thumbnail: { columns: ['tools.database.starterTaskName', 'tools.database.defaultStatusProperty', 'tools.database.starterAssignee'], pills: STATUS_PILLS, pillColumn: 1 },
    tint: 'green',
    glyph: 'check',
    undoKey: 'tools.database.starterUndoTasks',
    features: [
      choice('priority', 'tools.database.starterPriority', true, 'select'),
      choice('taskType', 'tools.database.starterTaskType', true, 'multiSelect'),
      choice('effort', 'tools.database.starterEffortLevel', true, 'select'),
      choice('description', 'tools.database.formQuestionDescription', true, 'text'),
      choice('updatedAt', 'tools.database.starterUpdatedAt', false, 'lastEditedTime'),
      choice('pastDue', 'tools.database.starterPastDue', false, 'checkbox'),
      choice('attachFile', 'tools.database.starterAttachFile', false, 'files'),
    ],
    views: [
      choice('all', 'tools.database.starterViewAllTasks', true, 'table'),
      choice('byStatus', 'tools.database.starterViewByStatus', true, 'board'),
      choice('mine', 'tools.database.starterViewMyTasks', true, 'table'),
      choice('checklist', 'tools.database.starterViewChecklist', false, 'list'),
    ],
  },
  {
    id: 'projects',
    nameKey: 'tools.database.starterProjects',
    descriptionKey: 'tools.database.starterProjectsDescription',
    thumbnail: { columns: [], pills: STATUS_PILLS },
    tint: 'blue',
    glyph: 'timeline',
    features: [
      choice('priority', 'tools.database.starterPriority', true, 'select'),
      choice('team', 'tools.database.starterTeam', true, 'multiSelect'),
      choice('dates', 'tools.database.starterStartAndEndDates', true, 'date'),
      choice('assignee', 'tools.database.starterAssignee', true, 'person'),
      choice('attachFile', 'tools.database.starterAttachFile', true, 'files'),
      choice('progress', 'tools.database.starterProgress', false, 'number'),
      choice('budget', 'tools.database.starterBudget', false, 'number'),
    ],
    views: [
      choice('byStatus', 'tools.database.starterViewByStatus', true, 'board'),
      choice('all', 'tools.database.starterViewAllProjects', true, 'table'),
      choice('gantt', 'tools.database.starterViewGantt', true, 'timeline'),
      choice('mine', 'tools.database.starterViewMyProjects', false, 'table'),
    ],
  },
  {
    id: 'skills',
    nameKey: 'tools.database.starterSkills',
    descriptionKey: 'tools.database.starterSkillsDescription',
    thumbnail: { columns: ['tools.database.starterSkillName', 'tools.database.formQuestionDescription', 'tools.database.starterFiles'], pills: [] },
    tint: 'gray',
    glyph: 'wand',
    undoKey: 'tools.database.starterUndoSkills',
    features: [],
    views: [],
  },
  // research/30 §10c-f. Tints and glyphs follow the gallery shot's icons (a red page, an orange bulb, a yellow calendar, a blue flag); their values were not read.
  {
    id: 'documentHub',
    nameKey: 'tools.database.starterDocumentHub',
    descriptionKey: 'tools.database.starterDocumentHubDescription',
    thumbnail: { columns: ['tools.database.starterDocName', 'tools.database.propertyTypeCreatedBy', 'tools.database.propertyTypeCreatedTime'], pills: [] },
    tint: 'red',
    glyph: 'doc',
    features: [
      choice('createdTime', 'tools.database.propertyTypeCreatedTime', true, 'createdTime'),
      choice('category', 'tools.database.starterCategory', true, 'multiSelect'),
      choice('lastEditedBy', 'tools.database.propertyTypeLastEditedBy', true, 'lastEditedBy'),
      choice('lastUpdated', 'tools.database.starterLastUpdatedTime', true, 'lastEditedTime'),
      // A person: the chip shows Notion's people glyph (research/30 shot 20).
      choice('reviewers', 'tools.database.starterReviewers', false, 'person'),
    ],
    views: [
      choice('all', 'tools.database.starterViewAllDocs', true, 'table'),
      choice('mine', 'tools.database.starterViewMyDocs', true, 'table'),
      choice('byCategory', 'tools.database.starterViewByCategory', false, 'table'),
    ],
  },
  {
    id: 'brainstorm',
    nameKey: 'tools.database.starterBrainstorm',
    descriptionKey: 'tools.database.starterBrainstormDescription',
    thumbnail: {
      columns: ['tools.database.starterIdea', 'tools.database.propertyTypeCreatedBy', 'tools.database.starterPriority'],
      pills: [['tools.database.starterOptionMediumPriority', 'yellow'], ['tools.database.starterOptionLow', 'green'], ['tools.database.starterOptionHigh', 'red']],
      pillColumn: 2,
    },
    tint: 'orange',
    glyph: 'idea',
    features: [
      choice('createdBy', 'tools.database.propertyTypeCreatedBy', true, 'createdBy'),
      choice('priority', 'tools.database.starterPriority', true, 'select'),
      choice('upvote', 'tools.database.starterUpvote', true, 'button'),
      choice('status', 'tools.database.defaultStatusProperty', false, 'status'),
    ],
    views: [
      choice('all', 'tools.database.starterViewAllIdeas', true, 'table'),
      choice('byCategory', 'tools.database.starterViewByCategoryIdeas', true, 'board'),
      choice('top', 'tools.database.starterViewTopIdeas', false, 'table'),
    ],
  },
  {
    id: 'meetingNotes',
    nameKey: 'tools.database.starterMeetingNotes',
    descriptionKey: 'tools.database.starterMeetingNotesDescription',
    thumbnail: {
      columns: ['tools.database.starterMeetingName', 'tools.database.propertyTypeDate', 'tools.database.starterCategory'],
      pills: [['tools.database.starterOptionPresentation', 'yellow'], ['tools.database.starterOptionPlanning', 'blue'], ['tools.database.starterOptionStandup', 'red']],
      pillColumn: 2,
    },
    tint: 'yellow',
    glyph: 'calendar',
    features: [
      choice('date', 'tools.database.propertyTypeDate', true, 'date'),
      choice('category', 'tools.database.starterCategory', true, 'multiSelect'),
      choice('attendees', 'tools.database.starterAttendees', true, 'person'),
      choice('lastEditedBy', 'tools.database.propertyTypeLastEditedBy', false, 'lastEditedBy'),
      choice('lastUpdated', 'tools.database.starterLastUpdatedTime', false, 'lastEditedTime'),
    ],
    views: [
      choice('all', 'tools.database.starterViewAllMeetings', true, 'table'),
      choice('mine', 'tools.database.starterViewMyNotes', true, 'table'),
      choice('byCategory', 'tools.database.starterViewByCategory', false, 'table'),
    ],
  },
  {
    id: 'goals',
    nameKey: 'tools.database.starterGoals',
    descriptionKey: 'tools.database.starterGoalsDescription',
    thumbnail: { columns: ['tools.database.starterGoalName', 'tools.database.starterOwner', 'tools.database.defaultStatusProperty'], pills: STATUS_PILLS, pillColumn: 2 },
    tint: 'blue',
    glyph: 'flag',
    // research/31 §8.
    features: [
      choice('dueDate', 'tools.database.starterDueDate', true, 'date'),
      choice('priority', 'tools.database.starterPriority', true, 'select'),
      choice('team', 'tools.database.starterTeam', true, 'multiSelect'),
      choice('quarter', 'tools.database.starterQuarter', false, 'multiSelect'),
      choice('progress', 'tools.database.starterProgress', false, 'formula'),
      choice('daysUntilDue', 'tools.database.starterDaysUntilDue', false, 'date'),
    ],
    views: [
      choice('all', 'tools.database.starterViewAllGoals', true, 'table'),
      choice('byStatus', 'tools.database.starterViewByStatus', true, 'board'),
      choice('mine', 'tools.database.starterViewMyGoals', true, 'table'),
      choice('byTeam', 'tools.database.starterViewByTeam', false, 'table'),
    ],
  },
  // research/31 §7. Off chips and view cards were never created, so their types are unknown: not offered.
  {
    id: 'campaign',
    nameKey: 'tools.database.starterCampaign',
    descriptionKey: 'tools.database.starterCampaignDescription',
    thumbnail: {
      columns: [],
      pills: [['tools.database.starterOptionBlocked', 'red'], ['tools.database.defaultStatusNotStarted', 'gray'], ['tools.database.starterOptionPlanning', 'yellow']],
    },
    // A purple flag (research/31 shot 51).
    tint: 'purple',
    glyph: 'flag',
    features: [
      choice('campaignType', 'tools.database.starterCampaignType', true, 'multiSelect'),
      choice('markets', 'tools.database.starterMarkets', true, 'multiSelect'),
      choice('channels', 'tools.database.starterChannels', true, 'multiSelect'),
      choice('audiences', 'tools.database.starterAudiencesTargeted', true, 'multiSelect'),
      choice('files', 'tools.database.propertyTypeFiles', true, 'files'),
    ],
    views: [
      choice('byStatus', 'tools.database.starterViewByStatus', true, 'board'),
      choice('all', 'tools.database.starterViewAllCampaigns', true, 'table'),
      choice('calendar', 'tools.database.viewTypeCalendar', true, 'calendar'),
    ],
  },
  {
    id: 'contentCalendar',
    nameKey: 'tools.database.starterContentCalendar',
    descriptionKey: 'tools.database.starterContentCalendarDescription',
    // The thumbnail is the calendar's weekday row.
    thumbnail: { columns: ['tools.database.starterWeekdaySun', 'tools.database.starterWeekdayMon', 'tools.database.starterWeekdayTue'], pills: [] },
    // Not measured (no shot shows it): Blok's calendar glyph on gray.
    tint: 'gray',
    glyph: 'calendar',
    features: [
      choice('publishDate', 'tools.database.starterPublishDate', true, 'date'),
      choice('platform', 'tools.database.starterPlatform', true, 'multiSelect'),
      choice('contentType', 'tools.database.starterContentType', true, 'select'),
      choice('owner', 'tools.database.starterOwner', true, 'person'),
      choice('postUrl', 'tools.database.starterPostUrl', true, 'url'),
    ],
    views: [
      choice('calendar', 'tools.database.viewTypeCalendar', true, 'calendar'),
      choice('all', 'tools.database.starterViewAllContent', true, 'table'),
      choice('byStatus', 'tools.database.starterViewByStatus', true, 'board'),
    ],
  },
];

/**
 * research/27 §1a: after each use the next template moves up. Inferred, not
 * verified there: the first three not used yet. With seven templates it
 * gives every list research/27 §1a saw.
 */
export const suggestedStarters = (used: ReadonlySet<StarterId>): StarterMeta[] =>
  DATABASE_STARTERS.filter((starter) => !used.has(starter.id)).slice(0, 3);

/** The gallery's "Templates": unused ones first, then used ones (research/27 §1e, inferred rule). */
export const galleryStarters = (used: ReadonlySet<StarterId>): StarterMeta[] => [
  ...DATABASE_STARTERS.filter((starter) => !used.has(starter.id)),
  ...DATABASE_STARTERS.filter((starter) => used.has(starter.id)),
];

/**
 * The Customize preview's "N hidden properties" (research/30 B8): the shown
 * view's (default: the first) properties that are not shown, leaving out the title and a board's
 * group. Inferred from four counts (0, 4, 4, 5), all of which it gives.
 */
export const hiddenPropertyCount = (made: StarterBuild, first = made.views[0]): number => {
  if (first === undefined) return 0;

  return made.schema.filter((p, index) => index > 0 && !first.visibleProperties.includes(p.id) && p.id !== first.groupBy).length;
};

const picked = (list: StarterChoice[], chosen: ReadonlySet<string> | undefined): Set<string> =>
  new Set(list.filter((c) => (chosen === undefined ? c.on : chosen.has(c.id))).map((c) => c.id));

const MDY = { dateFormat: 'month_day_year', timeFormat: '12_hour' } as const;
const FULL = { dateFormat: 'full', timeFormat: '12_hour' } as const;

/** Builds one template's schema, views, rows and row bodies. */
export const buildStarter = (id: StarterId, options: StarterBuildOptions): StarterBuild => {
  const { t, newId } = options;
  const meta = DATABASE_STARTERS.find((s) => s.id === id) ?? DATABASE_STARTERS[0];
  const features = picked(meta.features, options.features);
  const views = picked(meta.views, options.views);
  const schema: PropertyDefinition[] = [];
  const add = (name: string, type: PropertyType, extra: Partial<PropertyDefinition> = {}): PropertyDefinition => {
    const property: PropertyDefinition = { id: schema.length === 0 ? options.titleId : newId(), name, type, position: positionBetween(schema.at(-1)?.position ?? null, null), ...extra };

    schema.push(property);

    return property;
  };
  const optionsOf = (list: Array<[string, string]>): { config: { options: NonNullable<PropertyDefinition['config']>['options'] } } => ({
    config: { options: list.reduce<NonNullable<PropertyDefinition['config']>['options']>((all, [label, color]) =>
      [...all, { id: newId(), label, color, position: positionBetween(all.at(-1)?.position ?? null, null) }], []) },
  });
  // research/27:48, research/30 §10f: Not started is the DEFAULT and has no colour. `measured` false: a status Blok adds itself.
  const status = (measured = true): PropertyDefinition => {
    // Stored in English like a status Blok adds itself; the view localizes these names.
    const [notStarted, ...rest] = createDefaultStatusOptions({ notStarted: DATABASE_DEFAULT_TEXT.statusNotStarted, inProgress: DATABASE_DEFAULT_TEXT.statusInProgress, done: DATABASE_DEFAULT_TEXT.statusDone }, newId);
    const { color: _gray, ...colourless } = notStarted;

    return add(t('tools.database.defaultStatusProperty'), 'status', measured
      ? { config: { options: [colourless, ...rest] }, status: { ...createDefaultStatusSettings(), defaultOptionId: notStarted.id } }
      : { config: { options: [notStarted, ...rest] }, status: createDefaultStatusSettings() });
  };
  // Options as [label, colour, group]; no colour for the DEFAULT option, at `defaultAt` (research/31 §7a-b).
  const customStatus = (list: Array<[string, string | undefined, string]>, defaultAt: number): PropertyDefinition => {
    const made = list.reduce<NonNullable<PropertyDefinition['config']>['options']>((all, [label, color, groupId]) =>
      [...all, { id: newId(), label, ...(color === undefined ? {} : { color }), groupId, position: positionBetween(all.at(-1)?.position ?? null, null) }], []);

    return add(t('tools.database.defaultStatusProperty'), 'status', {
      config: { options: made },
      status: { ...createDefaultStatusSettings(), ...(made[defaultAt] === undefined ? {} : { defaultOptionId: made[defaultAt].id }) },
    });
  };
  const priority = (): PropertyDefinition => add(t('tools.database.starterPriority'), 'select',
    optionsOf([[t('tools.database.starterOptionHigh'), 'red'], [t('tools.database.starterOptionMediumPriority'), 'yellow'], [t('tools.database.starterOptionLow'), 'green']]));
  const teamProperty = (): PropertyDefinition => add(t('tools.database.starterTeam'), 'multiSelect', optionsOf([
    [t('tools.database.starterTeamAccountManagement'), 'default'], [t('tools.database.starterTeamBusinessDevelopment'), 'blue'],
    [t('tools.database.starterTeamProductDesign'), 'green'], [t('tools.database.starterTeamHumanResources'), 'purple'],
  ]));
  const option = (property: PropertyDefinition | undefined, index: number): string | undefined => property?.config?.options[index]?.id;
  const viewList: DatabaseViewConfig[] = [];
  const view = (name: string, type: ViewType, shown: Array<PropertyDefinition | undefined>, extra: ViewCreateConfig = {}): void => {
    const visible = shown.filter((p): p is PropertyDefinition => p !== undefined).map((p) => p.id);

    viewList.push(newView({
      id: newId(),
      name,
      type,
      position: positionBetween(viewList.at(-1)?.position ?? null, null),
      visibleProperties: visible,
      // The order here is the column order.
      properties: [
        { id: options.titleId, visible: true },
        ...visible.map((shownId) => ({ id: shownId, visible: true })),
        ...schema.filter((p) => p.id !== options.titleId && !visible.includes(p.id)).map((p) => ({ id: p.id, visible: false })),
      ],
      ...extra,
    }, schema));
  };
  const rows: StarterRow[] = [];
  const row = (title: string, values: Record<string, PropertyValue | undefined>, icon?: string, body: StarterBodyBlock[] = []): void => {
    const properties: Record<string, PropertyValue> = { [options.titleId]: title };

    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined && schema.some((p) => p.id === key)) properties[key] = value;
    }
    // A person or files list exists from birth, as a row Blok makes itself (withEmptyLists).
    for (const p of schema) if ((p.type === 'person' || p.type === 'files') && properties[p.id] === undefined) properties[p.id] = [];
    rows.push({
      id: newId(),
      data: { properties, title, position: positionBetween(rows.at(-1)?.data.position ?? null, null), ...(icon === undefined ? {} : { icon }) },
      body,
    });
  };
  const templates: StarterRow[] = [];
  // research/27:44, :81: the default template. Its body is not measured: it repeats the first row's.
  const template = (title: string, body: StarterBodyBlock[]): void => {
    const made: StarterRow = { id: newId(), data: { properties: { [options.titleId]: title }, title, position: 'a0', template: true }, body };

    templates.push(made);
    schema[0].defaultTemplateId = made.id;
  };
  const heading = (text: string, level: number): StarterBodyBlock => ({ tool: 'header', data: { text: [{ text }], level } });
  const text = (value: string): StarterBodyBlock => ({ tool: 'paragraph', data: { text: value === '' ? [] : [{ text: value }] } });
  const todo = (): StarterBodyBlock => ({ tool: 'list', data: { text: [], style: 'checklist', checked: false } });
  const tableLook = { showPageIcon: false, wrapCells: false, showVerticalLines: true, loadLimit: 50, openPagesIn: 'side' } as const;
  const boardLook = { showPageIcon: true, wrapCells: true, loadLimit: 25, cardPreview: 'none', cardSize: 'medium', groupSettings: { colorColumns: true } } as const;
  const mine = (assignee: PropertyDefinition | undefined): ViewCreateConfig =>
    (assignee === undefined ? {} : { filters: [{ id: newId(), propertyId: assignee.id, operator: 'contains', value: [ME_FILTER_VALUE] }] });
  const pin = (...pinned: Array<PropertyDefinition | undefined>): void => {
    schema[0].pageLayoutGroupIn = 'panel';
    schema[0].pageLayoutPlacements = pinned.filter((p): p is PropertyDefinition => p !== undefined).map((p) => ({ id: p.id, place: 'heading' }));
  };

  if (id === 'tasks') {
    add(t('tools.database.starterTaskName'), 'title');
    const state = status();
    const assignee = add(t('tools.database.starterAssignee'), 'person');
    const due = add(t('tools.database.starterDueDate'), 'date', { date: { ...MDY } });
    const prio = features.has('priority') ? priority() : undefined;
    const kind = features.has('taskType') ? add(t('tools.database.starterTaskType'), 'multiSelect', optionsOf([
      [`🐞 ${t('tools.database.starterOptionBug')}`, 'orange'], [`💬 ${t('tools.database.starterOptionFeatureRequest')}`, 'green'], [`💅 ${t('tools.database.starterOptionPolish')}`, 'pink'],
    ])) : undefined;
    const description = features.has('description') ? add(t('tools.database.formQuestionDescription'), 'text') : undefined;
    const effort = features.has('effort') ? add(t('tools.database.starterEffortLevel'), 'select',
      optionsOf([[t('tools.database.starterOptionSmall'), 'green'], [t('tools.database.starterOptionMediumEffort'), 'yellow'], [t('tools.database.starterOptionLarge'), 'red']])) : undefined;

    if (features.has('updatedAt')) add(t('tools.database.starterUpdatedAt'), 'lastEditedTime');
    if (features.has('pastDue')) add(t('tools.database.starterPastDue'), 'checkbox');
    if (features.has('attachFile')) add(t('tools.database.starterAttachFile'), 'files');
    const all = schema.slice(1);

    if (views.has('all')) view(t('tools.database.starterViewAllTasks'), 'table', all, tableLook);
    if (views.has('byStatus')) view(t('tools.database.starterViewByStatus'), 'board', [assignee, prio, kind], { ...boardLook, groupBy: state.id });
    if (views.has('mine')) view(t('tools.database.starterViewMyTasks'), 'table', [assignee, due, state], { showPageIcon: true, wrapCells: false, loadLimit: 50, ...mine(assignee) });
    if (views.has('checklist')) view(t('tools.database.starterViewChecklist'), 'list', [state]);
    if (viewList.length === 0) view(t('tools.database.starterViewAllTasks'), 'table', all, tableLook);

    const values = (s: number, date: string, p: number, k: number, d: string, e: number): Record<string, PropertyValue | undefined> => ({
      [state.id]: option(state, s) ?? null,
      [due.id]: date,
      ...(prio === undefined ? {} : { [prio.id]: option(prio, p) }),
      ...(kind === undefined ? {} : { [kind.id]: [option(kind, k) ?? ''] }),
      ...(description === undefined ? {} : { [description.id]: t(d) }),
      ...(effort === undefined ? {} : { [effort.id]: option(effort, e) }),
    });

    const body = [
      heading(t('tools.database.starterTaskDescriptionHeading'), 2),
      text(t('tools.database.starterTaskDescriptionText')),
      text(''),
      heading(t('tools.database.starterSubTasks'), 2),
      todo(), todo(), todo(),
      // Then a PDF, a Google Drive and a Figma embed placeholder: left out, Blok keeps no empty embed.
      heading(t('tools.database.starterSupportingFiles'), 2),
    ];

    row(t('tools.database.starterTaskRow1'), values(2, '2025-02-03', 0, 2, 'tools.database.starterTaskRow1Description', 1), undefined, body);
    template(t('tools.database.starterNewTask'), body);
    row(t('tools.database.starterTaskRow2'), values(1, '2025-02-20', 1, 1, 'tools.database.starterTaskRow2Description', 0), '📕');
    row(t('tools.database.starterTaskRow3'), values(0, '2025-02-28', 2, 1, 'tools.database.starterTaskRow3Description', 0), '🗒️');
    pin(assignee, state, due);
  } else if (id === 'projects') {
    add(t('tools.database.starterProjectName'), 'title');
    const assignee = features.has('assignee') ? add(t('tools.database.starterAssignee'), 'person') : undefined;
    const prio = features.has('priority') ? priority() : undefined;

    if (features.has('attachFile')) add(t('tools.database.starterAttachFile'), 'files');
    const end = features.has('dates') ? add(t('tools.database.dateEnd'), 'date', { date: { ...MDY } }) : undefined;
    const start = features.has('dates') ? add(t('tools.database.dateStart'), 'date', { date: { ...MDY } }) : undefined;
    const state = status();
    const team = features.has('team') ? teamProperty() : undefined;

    if (features.has('progress')) add(t('tools.database.starterProgress'), 'number');
    if (features.has('budget')) add(t('tools.database.starterBudget'), 'number');
    const all = schema.slice(1);

    if (views.has('byStatus')) view(t('tools.database.starterViewByStatus'), 'board', [assignee, prio], { ...boardLook, groupBy: state.id });
    if (views.has('all')) view(t('tools.database.starterViewAllProjects'), 'table', all, tableLook);
    // "Table properties: 1 shown" reads as the title, which the timeline table always shows.
    if (views.has('gantt') && start !== undefined && end !== undefined) {
      view(t('tools.database.starterViewGantt'), 'timeline', [assignee], {
        groupBy: state.id, timelineBy: start.id, timelineEndBy: end.id, timelineZoom: 'month', showTimelineTable: true, loadLimit: 25,
      });
    }
    if (views.has('mine') && assignee !== undefined) view(t('tools.database.starterViewMyProjects'), 'table', all, { ...tableLook, ...mine(assignee) });
    if (viewList.length === 0) view(t('tools.database.starterViewByStatus'), 'board', [assignee, prio], { ...boardLook, groupBy: state.id });

    const values = (s: number, from: string, to: string, p: number, tm: number): Record<string, PropertyValue | undefined> => ({
      [state.id]: option(state, s) ?? null,
      ...(start === undefined || end === undefined ? {} : { [start.id]: from, [end.id]: to }),
      ...(prio === undefined ? {} : { [prio.id]: option(prio, p) }),
      ...(team === undefined ? {} : { [team.id]: [option(team, tm) ?? ''] }),
    });

    const body = [
      heading(t('tools.database.starterAboutProject'), 3),
      text(t('tools.database.starterAboutProjectText')),
      text(''),
      heading(t('tools.database.starterActionItems'), 3),
      todo(),
      // Then a Google Drive, a PDF and a Figma embed placeholder: left out, as in Tasks Tracker.
      heading(t('tools.database.starterDocuments'), 3),
    ];

    row(t('tools.database.starterProjectRow1'), values(0, '2025-03-24', '2025-03-28', 1, 0), '📖', body);
    template(t('tools.database.starterNewProject'), body);
    row(t('tools.database.starterProjectRow2'), values(2, '2025-01-20', '2025-02-04', 2, 3));
    row(t('tools.database.starterProjectRow3'), values(1, '2025-04-09', '2025-04-30', 0, 2), '📱');
    pin(state, assignee, prio, end);
  } else if (id === 'documentHub') {
    add(t('tools.database.starterDocName'), 'title');
    const category = features.has('category') ? add(t('tools.database.starterCategory'), 'multiSelect', optionsOf([
      [t('tools.database.starterOptionProposal'), 'yellow'], [t('tools.database.starterOptionCustomerResearch'), 'blue'],
      [t('tools.database.starterOptionStrategyDoc'), 'orange'], [t('tools.database.starterOptionPlanning'), 'red'],
    ])) : undefined;

    // research/30 B8: Reviewers turned on sits right after Category.
    if (features.has('reviewers')) add(t('tools.database.starterReviewers'), 'person');
    const author = add(t('tools.database.propertyTypeCreatedBy'), 'createdBy');

    if (features.has('createdTime')) add(t('tools.database.propertyTypeCreatedTime'), 'createdTime', { date: { ...FULL } });
    if (features.has('lastEditedBy')) add(t('tools.database.propertyTypeLastEditedBy'), 'lastEditedBy');
    if (features.has('lastUpdated')) add(t('tools.database.starterLastUpdatedTime'), 'lastEditedTime', { date: { ...FULL } });
    const all = schema.slice(1);

    if (views.has('all')) view(t('tools.database.starterViewAllDocs'), 'table', all, tableLook);
    if (views.has('mine')) view(t('tools.database.starterViewMyDocs'), 'table', [category], { loadLimit: 50, ...mine(author) });
    // research/30 B8: the grouped preview's first group is Customer research. The rest were not read.
    const research = option(category, 1);

    if (views.has('byCategory') && category !== undefined) {
      view(t('tools.database.starterViewByCategory'), 'table', all, {
        ...tableLook, groupBy: category.id, ...(research === undefined ? {} : { groupOrder: { [research]: positionBetween(null, 'a0') } }),
      });
    }
    if (viewList.length === 0) view(t('tools.database.starterViewAllDocs'), 'table', all, tableLook);

    const values = (c: number): Record<string, PropertyValue | undefined> => (category === undefined ? {} : { [category.id]: [option(category, c) ?? ''] });

    row(t('tools.database.starterDocRow1'), values(2));
    row(t('tools.database.starterDocRow2'), values(0));
    row(t('tools.database.starterDocRow3'), values(1));
  } else if (id === 'brainstorm') {
    add(t('tools.database.starterIdea'), 'title');
    // research/30 B8: Status turned on is the first column after the title. Its options were not
    // read (Notion's sample value is "New idea"), so it gets a new status's own and no row values.
    if (features.has('status')) status(false);
    const author = features.has('createdBy') ? add(t('tools.database.propertyTypeCreatedBy'), 'createdBy') : undefined;
    const prio = features.has('priority') ? priority() : undefined;
    const category = add(t('tools.database.starterCategory'), 'multiSelect', optionsOf([
      [t('tools.database.starterOptionTopOfFunnel'), 'yellow'], [t('tools.database.starterOptionActivation'), 'orange'], [t('tools.database.starterOptionConversion'), 'blue'],
    ]));

    // One chip, three properties. The button's actions and the formula's expression were not read.
    if (features.has('upvote')) {
      add(t('tools.database.starterUpvote'), 'button');
      add(t('tools.database.starterTotalVotes'), 'formula');
      add(t('tools.database.starterUpvotedBy'), 'person');
    }
    const all = schema.slice(1);

    if (views.has('all')) view(t('tools.database.starterViewAllIdeas'), 'table', all, tableLook);
    if (views.has('byCategory')) {
      view(t('tools.database.starterViewByCategoryIdeas'), 'board', [], {
        ...boardLook, groupBy: category.id, groupSettings: { sort: 'manual', hideEmptyGroups: false, colorColumns: true },
      });
    }
    // Shows Idea and Created by (research/30 B8). Its layout and sort were not read: a table, unsorted.
    if (views.has('top')) view(t('tools.database.starterViewTopIdeas'), 'table', [author], tableLook);
    if (viewList.length === 0) view(t('tools.database.starterViewAllIdeas'), 'table', all, tableLook);

    const values = (p: number, c: number): Record<string, PropertyValue | undefined> => ({
      ...(prio === undefined ? {} : { [prio.id]: option(prio, p) }),
      [category.id]: [option(category, c) ?? ''],
    });

    row(t('tools.database.starterIdeaRow1'), values(0, 1));
    row(t('tools.database.starterIdeaRow2'), values(1, 2));
    row(t('tools.database.starterIdeaRow3'), values(2, 0));
  } else if (id === 'meetingNotes') {
    add(t('tools.database.starterMeetingName'), 'title');
    const date = features.has('date') ? add(t('tools.database.propertyTypeDate'), 'date', { date: { dateFormat: 'relative', timeFormat: 'hidden' } }) : undefined;
    const category = features.has('category') ? add(t('tools.database.starterCategory'), 'multiSelect', optionsOf([
      [t('tools.database.starterOptionPlanning'), 'blue'], [t('tools.database.starterOptionStandup'), 'red'], [t('tools.database.starterOptionPresentation'), 'yellow'],
      [t('tools.database.starterOptionRetro'), 'green'], [t('tools.database.starterOptionCustomerCall'), 'blue'],
    ])) : undefined;
    const attendees = features.has('attendees') ? add(t('tools.database.starterAttendees'), 'person') : undefined;
    const author = add(t('tools.database.propertyTypeCreatedBy'), 'createdBy');

    if (features.has('lastEditedBy')) add(t('tools.database.propertyTypeLastEditedBy'), 'lastEditedBy');
    if (features.has('lastUpdated')) add(t('tools.database.starterLastUpdatedTime'), 'lastEditedTime', { date: { ...FULL } });
    const all = schema.slice(1);

    if (views.has('all')) view(t('tools.database.starterViewAllMeetings'), 'table', all, tableLook);
    // Four columns and a Created by filter were read; which columns, and the filter's operator and value, were not.
    if (views.has('mine')) view(t('tools.database.starterViewMyNotes'), 'table', [date, category, attendees], { ...tableLook, showPageIcon: true, ...mine(author) });
    if (views.has('byCategory') && category !== undefined) view(t('tools.database.starterViewByCategory'), 'table', all, { ...tableLook, groupBy: category.id });
    if (viewList.length === 0) view(t('tools.database.starterViewAllMeetings'), 'table', all, tableLook);

    const values = (c: number): Record<string, PropertyValue | undefined> => ({
      ...(date === undefined ? {} : { [date.id]: '2025-02-13' }),
      ...(category === undefined ? {} : { [category.id]: [option(category, c) ?? ''] }),
    });

    row(t('tools.database.starterMeetingRow1'), values(3));
    row(t('tools.database.starterMeetingRow2'), values(1));
    row(t('tools.database.starterMeetingRow3'), values(2));
  } else if (id === 'goals') {
    add(t('tools.database.starterGoalName'), 'title');
    const owner = add(t('tools.database.starterOwner'), 'person');
    const state = status();
    const due = features.has('dueDate') ? add(t('tools.database.starterDueDate'), 'date', { date: { ...MDY } }) : undefined;

    // A number of days or the text "Overdue", as measured. Without Due date it has nothing to read (unmeasured).
    if (due !== undefined && features.has('daysUntilDue')) {
      const days = `dateBetween({{property:${due.id}}}, now(), "days")`;

      add(t('tools.database.starterDaysUntilDue'), 'formula', {
        formula: { expression: `if(${days} > 0, ${days}, ${JSON.stringify(t('tools.database.starterOverdue'))})` },
      });
    }
    const prio = features.has('priority') ? priority() : undefined;
    const quarter = features.has('quarter') ? add(t('tools.database.starterQuarter'), 'multiSelect', optionsOf([
      [t('tools.database.starterOptionQuarter', { number: '1' }), 'yellow'], [t('tools.database.starterOptionQuarter', { number: '2' }), 'pink'],
      [t('tools.database.starterOptionQuarter', { number: '3' }), 'green'], [t('tools.database.starterOptionQuarter', { number: '4' }), 'gray'],
    ])) : undefined;
    const team = features.has('team') ? teamProperty() : undefined;
    // One chip, three properties. Progress is not capped: 25/20 reads 125% with a full bar.
    const start = features.has('progress') ? add(t('tools.database.starterStartValue'), 'number') : undefined;
    const end = features.has('progress') ? add(t('tools.database.starterEndValue'), 'number') : undefined;

    if (start !== undefined && end !== undefined) {
      add(t('tools.database.starterProgress'), 'formula', {
        formula: { expression: `{{property:${start.id}}}/{{property:${end.id}}}` },
        number: { format: 'percent', showAs: 'bar', color: 'green' },
      });
    }
    const all = schema.slice(1);

    if (views.has('all')) view(t('tools.database.starterViewAllGoals'), 'table', all, tableLook);
    if (views.has('byStatus')) {
      view(t('tools.database.starterViewByStatus'), 'board', [prio, state], {
        ...boardLook, groupBy: state.id, groupSettings: { sort: 'ascending', hideEmptyGroups: false, colorColumns: false },
      });
    }
    // The filter's operator was not read: Contains Me, as My Tasks.
    if (views.has('mine')) view(t('tools.database.starterViewMyGoals'), 'table', [owner, prio, quarter, state, team], { ...tableLook, showPageIcon: true, ...mine(owner) });
    if (views.has('byTeam') && team !== undefined) {
      const [, development, design, people] = team.config?.options ?? [];

      // research/31 §8: Human Resources before Product Design here; the options keep Product Design first.
      view(t('tools.database.starterViewByTeam'), 'table', [state, owner, team, prio, quarter], {
        ...tableLook, showPageIcon: true, loadLimit: 25, groupBy: team.id, groupSettings: { sort: 'manual', hideEmptyGroups: false },
        ...(development === undefined || design === undefined || people === undefined ? {} : { groupOrder: { [people.id]: positionBetween(development.position, design.position) } }),
      });
    }
    if (viewList.length === 0) view(t('tools.database.starterViewAllGoals'), 'table', all, tableLook);

    const values = (s: number, date: string, p: number, tm: number, q: number[], from: number, to: number): Record<string, PropertyValue | undefined> => ({
      [state.id]: option(state, s) ?? null,
      ...(due === undefined ? {} : { [due.id]: date }),
      ...(prio === undefined ? {} : { [prio.id]: option(prio, p) }),
      ...(quarter === undefined ? {} : { [quarter.id]: q.map((i) => option(quarter, i) ?? '') }),
      ...(team === undefined ? {} : { [team.id]: [option(team, tm) ?? ''] }),
      ...(start === undefined || end === undefined ? {} : { [start.id]: from, [end.id]: to }),
    });

    row(t('tools.database.starterGoalRow1'), values(1, '2025-02-26', 0, 1, [1], 15, 20));
    row(t('tools.database.starterGoalRow2'), values(0, '2025-04-16', 1, 0, [2, 3], 0, 3));
    row(t('tools.database.starterGoalRow3'), values(2, '2025-02-03', 1, 1, [0], 25, 20));
  } else if (id === 'campaign') {
    add(t('tools.database.starterCampaignName'), 'title');
    const channels = features.has('channels') ? add(t('tools.database.starterChannels'), 'multiSelect', optionsOf([
      [t('tools.database.starterOptionBlog'), 'green'], [t('tools.database.starterOptionEmail'), 'yellow'], [t('tools.database.starterOptionInstagram'), 'purple'],
      [t('tools.database.starterOptionX'), 'gray'], [t('tools.database.starterOptionTiktok'), 'purple'], [t('tools.database.starterOptionLinkedinCampaign'), 'blue'],
      [t('tools.database.starterOptionGoogle'), 'brown'],
    ])) : undefined;
    const markets = features.has('markets') ? add(t('tools.database.starterMarkets'), 'multiSelect', optionsOf([
      [t('tools.database.starterOptionAmer'), 'orange'], [t('tools.database.starterOptionEmea'), 'gray'], [t('tools.database.starterOptionApac'), 'purple'],
      [t('tools.database.starterOptionUk'), 'yellow'], [t('tools.database.starterOptionFr'), 'brown'], [t('tools.database.starterOptionLatam'), 'green'],
    ])) : undefined;
    const kind = features.has('campaignType') ? add(t('tools.database.starterCampaignType'), 'multiSelect', optionsOf([
      [t('tools.database.starterOptionProductLaunch'), 'gray'], [t('tools.database.starterOptionBrandAwareness'), 'brown'], [t('tools.database.starterOptionLeadGeneration'), 'blue'],
      [t('tools.database.starterOptionSalesPromotion'), 'green'], [t('tools.database.starterOptionContentMarketing'), 'yellow'], [t('tools.database.starterOptionEmailMarketing'), 'default'],
    ])) : undefined;
    const audiences = features.has('audiences') ? add(t('tools.database.starterAudiencesTargeted'), 'multiSelect', optionsOf([
      [t('tools.database.starterOptionDemographic', { number: '1' }), 'yellow'], [t('tools.database.starterOptionDemographic', { number: '2' }), 'blue'],
      [t('tools.database.starterOptionDemographic', { number: '3' }), 'red'],
    ])) : undefined;
    const completion = add(t('tools.database.starterCompletionDate'), 'date', { date: { ...FULL } });
    const files = features.has('files') ? add(t('tools.database.propertyTypeFiles'), 'files') : undefined;
    // Complete's colour menu did not open; its pill rgba(0, 96, 38, 0.157) is the one every checked Green option reads.
    const state = customStatus([
      [t('tools.database.starterOptionBlocked'), 'red', 'todo'], [t('tools.database.defaultStatusNotStarted'), undefined, 'todo'],
      [t('tools.database.starterOptionPlanning'), 'yellow', 'inProgress'], [t('tools.database.starterOptionOnHoldCampaign'), 'orange', 'inProgress'],
      [t('tools.database.starterOptionInProduction'), 'purple', 'inProgress'],
      [t('tools.database.starterOptionInFlight'), 'blue', 'complete'], [t('tools.database.starterOptionComplete'), 'green', 'complete'],
    ], 1);

    // research/31 §7c: Hide empty groups read on, yet Notion drew the empty columns. Blok applies the switch.
    if (views.has('byStatus')) {
      view(t('tools.database.starterViewByStatus'), 'board', [channels, markets, kind], {
        ...boardLook, wrapCells: false, cardPreview: files === undefined ? 'none' : `property:${files.id}`, openPagesIn: 'side', groupBy: state.id,
        groupSettings: { sort: 'manual', hideEmptyGroups: true, colorColumns: true },
      });
    }
    if (views.has('all')) view(t('tools.database.starterViewAllCampaigns'), 'table', [state, audiences, kind, channels, markets, files, completion], tableLook);
    if (views.has('calendar')) {
      view(t('tools.database.viewTypeCalendar'), 'calendar', [], {
        calendarBy: completion.id, calendarRange: 'month', showWeekends: true, showPageIcon: true, wrapCells: false, openPagesIn: 'center',
      });
    }
    if (viewList.length === 0) view(t('tools.database.starterViewAllCampaigns'), 'table', [state, audiences, kind, channels, markets, files, completion], tableLook);

    const values = (s: number, a: number, k: number, c: number, m: number, date: string): Record<string, PropertyValue | undefined> => ({
      [state.id]: option(state, s) ?? null,
      [completion.id]: date,
      ...(audiences === undefined ? {} : { [audiences.id]: [option(audiences, a) ?? ''] }),
      ...(kind === undefined ? {} : { [kind.id]: [option(kind, k) ?? ''] }),
      ...(channels === undefined ? {} : { [channels.id]: [option(channels, c) ?? ''] }),
      ...(markets === undefined ? {} : { [markets.id]: [option(markets, m) ?? ''] }),
    });

    row(t('tools.database.starterCampaignRow1'), values(0, 2, 0, 3, 1, '2025-03-28'));
    row(t('tools.database.starterCampaignRow2'), values(1, 1, 3, 5, 0, '2025-03-18'));
    row(t('tools.database.starterCampaignRow3'), values(2, 0, 1, 2, 2, '2025-03-13'));
  } else if (id === 'contentCalendar') {
    // The "Status (1)" research/31 §7b saw is left out: probably made by its script.
    add(t('tools.database.starterContentName'), 'title');
    const kind = features.has('contentType') ? add(t('tools.database.starterContentType'), 'select', optionsOf([
      [t('tools.database.starterOptionLiveStream'), 'default'], [t('tools.database.starterOptionLongFormVideo'), 'purple'],
      [t('tools.database.starterOptionShortFormVideo'), 'gray'], [t('tools.database.starterOptionSocialPost'), 'red'],
      [t('tools.database.starterOptionPodcastVideo'), 'pink'], [t('tools.database.starterOptionPodcastAudio'), 'orange'],
      [t('tools.database.starterOptionBlogArticle'), 'blue'],
    ])) : undefined;
    const film = add(t('tools.database.starterFilmDate'), 'date', { date: { ...FULL } });
    const owner = features.has('owner') ? add(t('tools.database.starterOwner'), 'person') : undefined;
    const platform = features.has('platform') ? add(t('tools.database.starterPlatform'), 'multiSelect', optionsOf([
      [t('tools.database.starterOptionLinkedin'), 'default'], [t('tools.database.starterOptionTiktok'), 'yellow'], [t('tools.database.starterOptionX'), 'blue'],
      [t('tools.database.starterOptionYoutube'), 'gray'], [t('tools.database.starterOptionInstagram'), 'purple'], [t('tools.database.starterOptionSpotify'), 'pink'],
      [t('tools.database.starterOptionEmail'), 'red'], [t('tools.database.starterOptionBlogWebsite'), 'orange'],
    ])) : undefined;
    const url = features.has('postUrl') ? add(t('tools.database.starterPostUrl'), 'url') : undefined;
    const publish = features.has('publishDate') ? add(t('tools.database.starterPublishDate'), 'date', { date: { ...FULL } }) : undefined;
    // Published and On hold: their colour menus did not open. Their pills are the Green and the Brown one
    // (rgba(0, 96, 38, 0.157) and rgba(127, 51, 0, 0.157), as every checked Green and Brown option reads).
    const state = customStatus([
      [t('tools.database.starterOptionIdea'), undefined, 'todo'],
      [t('tools.database.starterOptionDrafting'), 'yellow', 'inProgress'], [t('tools.database.starterOptionFilming'), 'red', 'inProgress'],
      [t('tools.database.starterOptionEditing'), 'orange', 'inProgress'], [t('tools.database.starterOptionReadyForReview'), 'purple', 'inProgress'],
      [t('tools.database.starterOptionInReview'), 'pink', 'inProgress'], [t('tools.database.starterOptionApprovedForPublishing'), 'blue', 'inProgress'],
      [t('tools.database.starterOptionScheduled'), 'orange', 'inProgress'],
      [t('tools.database.starterOptionPublished'), 'green', 'complete'], [t('tools.database.starterOptionOnHold'), 'brown', 'complete'],
    ], 0);
    const newestFirst = (): ViewCreateConfig => (publish === undefined ? {} : { sorts: [{ id: newId(), propertyId: publish.id, direction: 'desc' }] });

    if (views.has('calendar')) {
      view(t('tools.database.viewTypeCalendar'), 'calendar', [], {
        calendarBy: film.id, calendarRange: 'month', showWeekends: true, showPageIcon: true, wrapCells: false, openPagesIn: 'center', ...newestFirst(),
      });
    }
    if (views.has('all')) view(t('tools.database.starterViewAllContent'), 'table', [owner, state, film, publish, kind, platform, url], { ...tableLook, wrapCells: true, ...newestFirst() });
    // research/31 §7c: as Campaign Management's board, Blok applies Hide empty groups.
    if (views.has('byStatus')) {
      view(t('tools.database.starterViewByStatus'), 'board', [owner, kind, platform], {
        ...boardLook, openPagesIn: 'side', groupBy: state.id, groupSettings: { sort: 'ascending', hideEmptyGroups: true, colorColumns: true }, ...newestFirst(),
      });
    }
    if (viewList.length === 0) view(t('tools.database.starterViewAllContent'), 'table', [owner, state, film, publish, kind, platform, url], { ...tableLook, wrapCells: true, ...newestFirst() });

    const values = (s: number, filmed: string, published: string, k: number, p: number[]): Record<string, PropertyValue | undefined> => ({
      [state.id]: option(state, s) ?? null,
      [film.id]: filmed,
      ...(publish === undefined ? {} : { [publish.id]: published }),
      ...(kind === undefined ? {} : { [kind.id]: option(kind, k) }),
      ...(platform === undefined ? {} : { [platform.id]: p.map((i) => option(platform, i) ?? '') }),
      // As the cell showed it. Blok links a scheme-less address to http://x.com/NotionHQ.
      ...(url === undefined ? {} : { [url.id]: 'x.com/NotionHQ' }),
    });

    row(t('tools.database.starterContentRow1'), values(0, '2025-03-11', '2025-03-28', 2, [3]));
    row(t('tools.database.starterContentRow2'), values(6, '2025-02-19', '2025-03-27', 3, [4]));
    row(t('tools.database.starterContentRow3'), values(8, '2025-02-10', '2025-02-13', 6, [0, 7]));
  } else {
    const title = add(t('tools.database.starterSkillName'), 'title');

    add(t('tools.database.formQuestionDescription'), 'text');
    add(t('tools.database.starterFiles'), 'files');
    add(t('tools.database.starterTags'), 'multiSelect', { config: { options: [] } });
    add(t('tools.database.propertyTypeCreatedBy'), 'createdBy');
    view(DATABASE_DEFAULT_TEXT.viewTypeTable, 'table', schema.slice(1), {
      showPageIcon: true, wrapCells: true, showVerticalLines: true, loadLimit: 50, calculations: [{ id: title.id, fn: 'count' }],
    });
  }

  return { title: t(meta.nameKey), schema, views: viewList, activeViewId: viewList[0].id, rows, templates, icon: { glyph: meta.glyph, color: meta.tint } };
};
