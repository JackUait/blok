import { newView, positionBetween, createDefaultStatusOptions, createDefaultStatusSettings } from '../../shared/database/schema-ops';
import { DATABASE_DEFAULT_TEXT } from '../../shared/database/default-text';
import { ME_FILTER_VALUE } from './database-query';
import type { DatabaseRowData, DatabaseViewConfig, PropertyDefinition, PropertyType, PropertyValue, ViewType } from './types';
import type { ViewCreateConfig } from '../../shared/database/schema-ops';

/**
 * The "Suggested" database templates of Notion's "New database" panel
 * (research/27 §1). Every name, option, view and sample row is as measured
 * with the Customize defaults kept. What a chip or a view card turned on or
 * off changes was not measured: here it only adds or leaves out its property
 * or view (Blok choice).
 */
export type StarterId = 'tasks' | 'projects' | 'skills';

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
  /** The panel tile tint (research/26 §2). */
  tint: 'green' | 'blue' | 'gray';
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

export const DATABASE_STARTERS: readonly StarterMeta[] = [
  {
    id: 'tasks',
    nameKey: 'tools.database.starterTasks',
    tint: 'green',
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
    tint: 'blue',
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
  { id: 'skills', nameKey: 'tools.database.starterSkills', tint: 'gray', features: [], views: [] },
];

const picked = (list: StarterChoice[], chosen: ReadonlySet<string> | undefined): Set<string> =>
  new Set(list.filter((c) => (chosen === undefined ? c.on : chosen.has(c.id))).map((c) => c.id));

const MDY = { dateFormat: 'month_day_year', timeFormat: '12_hour' } as const;

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
  const status = (): PropertyDefinition => add(t('tools.database.defaultStatusProperty'), 'status', {
    // Stored in English like a status Blok adds itself; the view localizes these names.
    config: { options: createDefaultStatusOptions({ notStarted: DATABASE_DEFAULT_TEXT.statusNotStarted, inProgress: DATABASE_DEFAULT_TEXT.statusInProgress, done: DATABASE_DEFAULT_TEXT.statusDone }, newId) },
    status: createDefaultStatusSettings(),
  });
  const priority = (): PropertyDefinition => add(t('tools.database.starterPriority'), 'select',
    optionsOf([[t('tools.database.starterOptionHigh'), 'red'], [t('tools.database.starterOptionMedium'), 'yellow'], [t('tools.database.starterOptionLow'), 'green']]));
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
      optionsOf([[t('tools.database.starterOptionSmall'), 'green'], [t('tools.database.starterOptionMedium'), 'yellow'], [t('tools.database.starterOptionLarge'), 'red']])) : undefined;

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

    row(t('tools.database.starterTaskRow1'), values(2, '2025-02-03', 0, 2, 'tools.database.starterTaskRow1Description', 1), undefined, [
      heading(t('tools.database.starterTaskDescriptionHeading'), 2),
      text(t('tools.database.starterTaskDescriptionText')),
      text(''),
      heading(t('tools.database.starterSubTasks'), 2),
      todo(), todo(), todo(),
      // Then a PDF, a Google Drive and a Figma embed placeholder: left out, Blok keeps no empty embed.
      heading(t('tools.database.starterSupportingFiles'), 2),
    ]);
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
    const team = features.has('team') ? add(t('tools.database.starterTeam'), 'multiSelect', optionsOf([
      [t('tools.database.starterTeamAccountManagement'), 'default'], [t('tools.database.starterTeamBusinessDevelopment'), 'blue'],
      [t('tools.database.starterTeamProductDesign'), 'green'], [t('tools.database.starterTeamHumanResources'), 'purple'],
    ])) : undefined;

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

    row(t('tools.database.starterProjectRow1'), values(0, '2025-03-24', '2025-03-28', 1, 0), '📖', [
      heading(t('tools.database.starterAboutProject'), 3),
      text(t('tools.database.starterAboutProjectText')),
      text(''),
      heading(t('tools.database.starterActionItems'), 3),
      todo(),
      // Then a Google Drive, a PDF and a Figma embed placeholder: left out, as in Tasks Tracker.
      heading(t('tools.database.starterDocuments'), 3),
    ]);
    row(t('tools.database.starterProjectRow2'), values(2, '2025-01-20', '2025-02-04', 2, 3));
    row(t('tools.database.starterProjectRow3'), values(1, '2025-04-09', '2025-04-30', 0, 2), '📱');
    pin(state, assignee, prio, end);
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

  return { title: t(meta.nameKey), schema, views: viewList, activeViewId: viewList[0].id, rows };
};
