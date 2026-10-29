import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Bookmark } from '../../../../src/tools/link/bookmark';
import { DatabaseTool } from '../../../../src/tools/database';
import type { DatabaseAdapter, DatabaseAI, DatabaseAutofillRequest, DatabaseAutomationContext, DatabaseAutomationTrigger, DatabaseConfig, DatabaseData, DatabaseRow, DatabaseRowData, DatabaseSavedAutomations, DatabaseTemplates, PropertyDefinition, PropertyValue } from '../../../../src/tools/database/types';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { ColumnList } from '../../../../src/tools/column-list';
import { Column } from '../../../../src/tools/column';
import { TabsTool } from '../../../../src/tools/tabs';
import { TabTool } from '../../../../src/tools/tab';
import type { API, BlokConfig, BlockToolConstructorOptions, OutputBlockData, OutputData } from '../../../../types';
import { decode, encode } from '../../../../src/components/modules/collaboration/sync-wire';
import type { SyncWireFrame } from '../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../src/components/modules/yjs/serializer';
import type { BlockReplayCapture } from '../../../../types/events/editor-events';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  readOnly: API['readOnly'];
  events: API['events'];
  handlers: API['handlers'];
  history: { undo: () => void; redo: () => void };
}

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const quiet = async (): Promise<void> => {
  await settle();
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
  await settle();
};

const view = { id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] };

/** Tasks → Projects. Notes and Stage match by name and type; Amount has no match; Done is a checkbox in Tasks but text in Projects. */
const doc = (): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      title: 'Tasks',
      schema: [
        { id: 't', name: 'Name', type: 'title', position: 'a0' },
        { id: 'notes', name: 'Notes', type: 'text', position: 'a1' },
        { id: 'amount', name: 'Amount', type: 'number', position: 'a2' },
        { id: 'stage', name: 'Stage', type: 'select', position: 'a3', config: { options: [{ id: 'o-build', label: 'Build', position: 'a0' }] } },
        { id: 'done', name: 'Done', type: 'checkbox', position: 'a4' },
      ],
      views: [view],
      activeViewId: 'v',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { title: 'Alpha', properties: { t: 'Alpha', notes: 'short', amount: 12, stage: 'o-build', done: true }, position: 'a0' } },
  { id: 'r2', type: 'database-row', parent: 'db', data: { properties: { t: 'Bravo' }, position: 'a1' } },
  {
    id: 'db2',
    type: 'database',
    data: {
      title: 'Projects',
      schema: [
        { id: 'name', name: 'Project', type: 'title', position: 'a0' },
        { id: 'n2', name: 'notes', type: 'text', position: 'a1' },
        { id: 's2', name: 'Stage', type: 'select', position: 'a2', config: { options: [{ id: 'o-b2', label: 'build', position: 'a0' }] } },
        { id: 'done', name: 'Done', type: 'text', position: 'a3' },
      ],
      views: [view],
      activeViewId: 'v',
    },
    content: ['q1'],
  },
  { id: 'q1', type: 'database-row', parent: 'db2', data: { properties: { name: 'Existing' }, position: 'a5' } },
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

/** JSON.parse makes "__proto__" an own key; an object literal would set the prototype instead. */
const poisoned = (text: string): unknown => JSON.parse(text);

/** Tasks with a files property and one row a peer poisoned: unknown option, unsafe file url, extra keys. */
const poisonedDoc = (): OutputBlockData[] => {
  const blocks = doc();
  const database = blocks[0];
  const data = database.data as DatabaseData;

  blocks[0] = {
    ...database,
    data: { ...data, schema: [...data.schema, { id: 'files', name: 'Files', type: 'files', position: 'a5' }] },
  };
  blocks[1] = {
    ...blocks[1],
    data: {
      title: 'Alpha',
      position: 'a0',
      properties: poisoned(
        '{"t":"Alpha","notes":"short","stage":"o-evil","ghost":"peer","__proto__":"polluted",' +
        '"files":[{"id":"f-bad","name":"bad","url":"javascript:alert(1)"},' +
        '{"id":"f-ok","name":"ok","url":"https://example.com/ok"}]}',
      ),
    },
  };

  return blocks;
};

const make = async (
  blocks: OutputBlockData[],
  configs: Record<string, DatabaseConfig> = {},
  options: Pick<BlokConfig, 'server' | 'collaboration' | 'sanitizer' | 'readOnly' | 'uploader'> = {},
  customTools: NonNullable<BlokConfig['tools']> = {}
): Promise<TestEditor> => {
  class ConfiguredDatabase extends DatabaseTool {
    dashboardCapabilitySetReadOnly({ readOnly }: { readOnly: boolean }): void {
      this.setReadOnly(readOnly);
    }

    constructor(options: ConstructorParameters<typeof DatabaseTool>[0]) {
      super({ ...options, config: configs[options.block.id] ?? options.config });
    }
  }

  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      database: ConfiguredDatabase,
      'database-row': DatabaseRowTool,
      column_list: ColumnList,
      column: Column,
      tabs: TabsTool,
      tab: TabTool,
      ...(options.server === undefined ? {} : { bookmark: Bookmark }),
      ...customTools,
    },
    data: { blocks },
    ...options,
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();

  return editor;
};

const saved = async (id: string): Promise<{ parent?: string; data: { properties: Record<string, unknown>; title?: string; position: string } } | undefined> =>
  (await editor?.save())?.blocks.find((block) => block.id === id) as never;

/** The database whose hidden row pool holds the row's holder. */
const poolOf = (rowId: string): string | null | undefined =>
  holder?.querySelector(`[data-blok-element][data-blok-id="${rowId}"]`)?.closest('[data-blok-database-row-pool]')?.closest('[data-blok-element]')?.getAttribute('data-blok-id');

const shownRows = (databaseId: string): string[] =>
  [...(holder?.querySelectorAll<HTMLElement>(`[data-blok-id="${databaseId}"] [data-blok-database-table-row]`) ?? [])].map((el) => el.getAttribute('data-row-id') ?? '');

const dashboardOwnerDoc = (definitionOwner: 'db' | 'db2' = 'db2'): OutputBlockData[] => {
  const blocks = doc();
  const local = blocks[0].data as DatabaseData;
  const foreign = blocks[3].data as DatabaseData;
  const foreignTable: DatabaseData['views'][number] = {
    ...view, type: 'table', visibleProperties: ['name', 'n2', 'done'],
  };
  const widgetView: DatabaseData['views'][number] = definitionOwner === 'db'
    ? { ...foreignTable, id: 'source-v', dataSourceId: 'db2', position: 'a2' }
    : foreignTable;
  const localList: DatabaseData['views'][number] = {
    ...view, id: 'local-list', name: 'Local list', type: 'list', position: 'a1',
    visibleProperties: ['notes'],
  };
  const foreignWidget = {
    id: 'foreign', viewId: widgetView.id, width: 4,
    ...(definitionOwner === 'db2' ? { databaseId: 'db2' } : {}),
  };
  const dashboard: DatabaseData['views'][number] = {
    ...view, id: 'dash', name: 'Dashboard', type: 'dashboard', position: 'a3',
    dashboard: { rows: [{ id: 'widgets', widgets: [
      { id: 'local', viewId: 'local-list', width: 4 },
      foreignWidget,
      { ...foreignWidget, id: 'twin' },
    ] }] },
  };

  blocks[0] = {
    ...blocks[0],
    data: {
      ...local, activeViewId: 'dash',
      views: [...local.views, localList, ...(definitionOwner === 'db' ? [widgetView] : []), dashboard],
    },
  };
  blocks[3] = { ...blocks[3], content: ['q1', 'q2'], data: { ...foreign, views: [foreignTable] } };
  blocks[4] = {
    ...blocks[4],
    data: { properties: { name: 'Existing', n2: 'Source note', done: 'Source done' }, position: 'a5' },
  };
  blocks.push({
    id: 'q2', type: 'database-row', parent: 'db2',
    data: { properties: { name: 'Second', n2: 'Second note', done: 'Second done' }, position: 'a6' },
  });

  return blocks;
};

const dashboardWidget = (id: string): HTMLElement => {
  const widget = holder?.querySelector<HTMLElement>(
    `[data-blok-id="db"] [data-blok-database-dashboard-widget="${CSS.escape(id)}"]`
  );

  if (widget === null || widget === undefined) throw new Error(`missing dashboard widget ${id}`);
  return widget;
};

const commitDatabaseText = async (value: string): Promise<void> => {
  await quiet();
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    '[data-blok-database-cell-editor] [data-blok-database-cell-input]'
  );

  if (input === null) throw new Error('missing native cell input');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await quiet();
};


const dashboardNativeHeaderDoc = (sourceLayout: 'table' | 'list'): OutputBlockData[] => {
  const blocks = dashboardOwnerDoc('db');
  const source = blocks[3].data as DatabaseData;

  blocks[3] = {
    ...blocks[3],
    data: { ...source, views: source.views.map((entry) => ({ ...entry, type: sourceLayout })) },
  };

  return blocks;
};

const dashboardNativeHeaderAction = async (label: string): Promise<void> => {
  const header = dashboardWidget('foreign').querySelector<HTMLElement>(
    '[data-blok-database-table-column-header][data-property-id="n2"]'
  );

  if (header === null) throw new Error('missing widget Notes header');
  header.click();
  await quiet();
  const input = document.querySelector<HTMLInputElement>('[data-blok-database-property-menu-name-input]');
  const menu = input?.closest('[data-blok-popover]');
  const item = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]') ?? [])]
    .find((entry) => entry.querySelector('[data-blok-testid="popover-item-title"]')?.textContent === label);

  if (item === undefined) throw new Error(`missing widget header action ${label}`);
  item.click();
  await quiet();
};

const dashboardNativeSubitemDoc = (): OutputBlockData[] => {
  const blocks = dashboardOwnerDoc('db');
  const owner = blocks[0].data as DatabaseData;
  const source = blocks[3].data as DatabaseData;
  const pair: PropertyDefinition[] = [
    { id: 'parent-item', name: 'Parent item', type: 'relation', position: 'a4',
      relation: { targetDatabaseId: 'db2', limit: 1, twoWay: true, syncedPropertyId: 'sub-items', role: 'parentItem' } },
    { id: 'sub-items', name: 'Sub-items', type: 'relation', position: 'a5',
      relation: { targetDatabaseId: 'db2', twoWay: true, syncedPropertyId: 'parent-item', role: 'subItems' } },
  ];

  blocks[0] = {
    ...blocks[0],
    data: { ...owner, views: owner.views.map((entry) => entry.id === 'source-v'
      ? { ...entry, subItemsDisplay: 'nested', filters: [{ propertyId: 'n2', operator: 'equals', value: 'Widget seed' }] }
      : entry) },
  };
  blocks[3] = {
    ...blocks[3],
    data: { ...source, schema: [...source.schema, ...pair],
      views: source.views.map((entry) => ({
        ...entry, subItemsDisplay: 'nested', filters: [{ propertyId: 'done', operator: 'equals', value: 'Source seed' }],
      })) },
  };
  blocks[4] = {
    ...blocks[4],
    data: { properties: { name: 'Existing', n2: 'Widget seed', done: 'Source seed', 'sub-items': [{ id: 'q2' }] }, position: 'a5' },
  };
  const childIndex = blocks.findIndex((block) => block.id === 'q2');

  if (childIndex === -1) throw new Error('missing child fixture');
  blocks[childIndex] = {
    ...blocks[childIndex],
    data: { properties: { name: 'Second', n2: 'Widget seed', done: 'Source seed', 'parent-item': [{ id: 'q1' }] }, position: 'a6' },
  };

  return blocks;
};

const dashboardNativeWidgetRows = (widgetId: string): string[] =>
  [...dashboardWidget(widgetId).querySelectorAll('[data-blok-database-table-row]')]
    .map((row) => row.getAttribute('data-row-id') ?? '');

type DashboardPopupKind = 'rename' | 'create';

const dashboardPopupDoc = (withTwinDashboard = false): OutputBlockData[] => {
  const blocks = dashboardOwnerDoc('db2');
  const dashboardBlock = blocks.find((block) => block.id === 'db');
  const sourceBlock = blocks.find((block) => block.id === 'db2');

  if (dashboardBlock === undefined || sourceBlock === undefined) {
    throw new Error('missing dashboard popup fixture');
  }
  const dashboardData = dashboardBlock.data as DatabaseData;
  const sourceData = sourceBlock.data as DatabaseData;
  const ownedView: DatabaseData['views'][number] = {
    ...view,
    id: 'owned-v',
    type: 'table',
    position: 'a1',
    visibleProperties: ['name', 'n2', 'done'],
    dataSourceId: 'db2',
  };
  const ownerData: DatabaseData = {
    ...structuredClone(sourceData),
    title: 'View owner',
    activeViewId: 'owner-active',
    views: [
      { ...view, id: 'owner-active', type: 'table', position: 'a0' },
      ownedView,
    ],
  };

  dashboardBlock.data = {
    ...dashboardData,
    views: dashboardData.views.map((savedView) => savedView.id !== 'dash'
      ? savedView
      : {
        ...savedView,
        dashboard: {
          rows: (savedView.dashboard?.rows ?? []).map((row) => ({
            ...row,
            widgets: row.widgets.map((widget) => widget.id === 'foreign' || widget.id === 'twin'
              ? { ...widget, databaseId: 'view-owner', viewId: 'owned-v' }
              : widget),
          })),
        },
      }),
  };
  blocks.push({ id: 'view-owner', type: 'database', data: ownerData });
  blocks.push({
    id: 'other-source',
    type: 'database',
    data: { ...structuredClone(sourceData), title: 'Other source' },
  });

  if (withTwinDashboard) {
    const otherWidget = {
      id: 'other-widget', databaseId: 'other-owner', viewId: 'owned-v', width: 12,
    };
    const otherDashboard: DatabaseData['views'][number] = {
      ...view,
      id: 'other-dash',
      type: 'dashboard',
      dashboard: { rows: [{ id: 'other-widgets', widgets: [otherWidget] }] },
    };

    blocks.push({
      id: 'other-owner',
      type: 'database',
      data: { ...structuredClone(ownerData), title: 'Other owner' },
    });
    blocks.push({
      id: 'other-dashboard',
      type: 'database',
      data: {
        ...structuredClone(dashboardData),
        title: 'Other dashboard',
        activeViewId: 'other-dash',
        views: [otherDashboard],
      },
    });
  }

  return blocks;
};

const dashboardPopupData = async (ed: TestEditor, databaseId: string): Promise<DatabaseData> => {
  const block = (await ed.save()).blocks.find((entry) => entry.id === databaseId);

  if (block === undefined || block.type !== 'database') {
    throw new Error('missing saved popup database');
  }

  return structuredClone(block.data as DatabaseData);
};

const dashboardPopupWidget = (ed: TestEditor, databaseId: string, widgetId: string): HTMLElement => {
  const database = ed.blocks.getById(databaseId);
  const widget = database?.holder.querySelector<HTMLElement>(
    `[data-blok-database-dashboard-widget="${CSS.escape(widgetId)}"]`
  );

  if (widget === null || widget === undefined) throw new Error('missing popup widget');

  return widget;
};

const dashboardPopupControl = async (widget: HTMLElement, kind: DashboardPopupKind): Promise<{
  input: HTMLInputElement;
  action: HTMLElement;
  commit: () => void;
}> => {
  const trigger = widget.querySelector<HTMLElement>(kind === 'rename'
    ? '[data-blok-database-table-column-header][data-property-id="n2"]'
    : '[data-blok-database-table-add-property]');

  if (trigger === null) throw new Error('missing native popup trigger');
  trigger.click();
  await quiet();
  const input = document.querySelector<HTMLInputElement>(kind === 'rename'
    ? '[data-blok-database-property-menu-name-input]'
    : '[data-blok-database-property-name-input]');

  if (input === null) throw new Error('missing native popup input');
  input.focus();
  const action = kind === 'rename' ? input : document.querySelector<HTMLElement>(
    '[data-blok-database-property-type-option="text"]'
  );

  if (action === null) throw new Error('missing native popup action');

  return {
    input,
    action,
    commit: () => {
      if (kind === 'rename') {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      } else {
        action.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    },
  };
};

const dashboardPopupRevoke = (ed: TestEditor, databaseId: string): void => {
  const database = ed.blocks.getById(databaseId);

  if (database === null || database === undefined) throw new Error('missing popup permission owner');
  database.call('dashboardCapabilitySetReadOnly', { readOnly: true });
};

const dashboardPopupIconDoc = (withTwinDashboard = false): OutputBlockData[] => {
  const blocks = dashboardPopupDoc(withTwinDashboard);
  const source = blocks.find((block) => block.id === 'db2');

  if (source === undefined) throw new Error('missing popup icon source');
  const data = source.data as DatabaseData;

  source.data = {
    ...data,
    schema: data.schema.map((property) => property.id === 'n2'
      ? { ...property, icon: 'x' }
      : property),
  };

  return blocks;
};

const dashboardPopupIconControl = async (widget: HTMLElement): Promise<{
  picker: HTMLElement;
  action: HTMLButtonElement;
  parentInput: HTMLInputElement;
  commit: () => void;
}> => {
  const parent = await dashboardPopupControl(widget, 'rename');
  const trigger = document.querySelector<HTMLButtonElement>(
    '[data-blok-database-property-menu-icon]'
  );

  if (trigger === null) throw new Error('missing native property icon trigger');
  trigger.click();
  await vi.waitFor(() => {
    const picker = document.querySelector<HTMLElement>('[data-blok-emoji-picker]');

    if (picker === null || picker.hidden || !picker.contains(document.activeElement) || parent.input.isConnected) {
      throw new Error('property icon picker is not ready');
    }
  });
  const picker = document.querySelector<HTMLElement>('[data-blok-emoji-picker]');
  const action = picker?.querySelector<HTMLButtonElement>('[data-emoji-picker-remove]');

  if (picker === null || action === null || action === undefined) {
    throw new Error('missing native property icon action');
  }

  return {
    picker,
    action,
    parentInput: parent.input,
    commit: () => action.dispatchEvent(new MouseEvent('click', { bubbles: true })),
  };
};

const backendFor = (blocks: OutputBlockData[], databaseId: string): { rows: Map<string, DatabaseRow>; adapter: DatabaseAdapter } => {
  const database = blocks.find((block) => block.id === databaseId);

  if (database === undefined) throw new Error('missing database fixture');
  const data = database.data as DatabaseData;
  const rows = new Map<string, DatabaseRow>(blocks.filter((block) => block.parent === databaseId).map((block) => {
    const row = block.data as Omit<DatabaseRow, 'id'>;

    return [block.id ?? '', { id: block.id ?? '', ...structuredClone(row) }];
  }));
  const readRow = (id: string): DatabaseRow => {
    const row = rows.get(id);

    if (row === undefined) throw new Error('missing backend row');
    return row;
  };
  const adapter: DatabaseAdapter = {
    loadDatabase: async () => structuredClone({ schema: data.schema, views: data.views }),
    createRow: async (params) => {
      const row = structuredClone(params);

      rows.set(row.id, row);
      return row;
    },
    updateRow: async ({ rowId, properties }) => {
      const row = { ...readRow(rowId), properties: { ...readRow(rowId).properties, ...structuredClone(properties) } };

      rows.set(rowId, row);
      return row;
    },
    moveRow: async ({ rowId, position }) => {
      const row = { ...readRow(rowId), position };

      rows.set(rowId, row);
      return row;
    },
    deleteRow: async ({ rowId }) => { rows.delete(rowId); },
    createProperty: async (params) => structuredClone(params),
    updateProperty: async ({ propertyId, changes }) => {
      const property = data.schema.find((candidate) => candidate.id === propertyId);

      if (property === undefined) throw new Error('missing backend property');
      return { ...property, ...changes };
    },
    deleteProperty: async () => undefined,
    createView: async (params) => ({ sorts: [], filters: [], visibleProperties: [], ...params }),
    updateView: async ({ viewId, changes }) => {
      const current = data.views.find((candidate) => candidate.id === viewId);

      if (current === undefined) throw new Error('missing backend view');
      return { ...current, ...changes };
    },
    deleteView: async () => undefined,
  };

  return { rows, adapter };
};

const dashboardCapabilityDoc = (): OutputBlockData[] => {
  const blocks = dashboardOwnerDoc();
  const dashboard = blocks[0].data as DatabaseData;
  const source = blocks[3].data as DatabaseData;

  blocks[0] = {
    ...blocks[0],
    data: {
      ...dashboard,
      views: dashboard.views.map((entry) => entry.id !== 'dash' || entry.dashboard === undefined
        ? entry
        : {
          ...entry,
          dashboard: {
            ...entry.dashboard,
            rows: entry.dashboard.rows.map((row) => ({
              ...row,
              widgets: row.widgets.map((widget) => widget.id === 'local'
                ? widget
                : { ...widget, databaseId: 'dashboard-capability-definition', viewId: 'capability-source-v' }),
            })),
          },
        }),
    },
  };
  blocks.push({
    id: 'dashboard-capability-definition',
    type: 'database',
    data: {
      source: { databaseId: 'db2' },
      schema: structuredClone(source.schema),
      views: source.views.map((entry) => ({ ...entry, id: 'capability-source-v' })),
      activeViewId: 'capability-source-v',
    },
  });

  return blocks;
};

const dashboardCapabilityDrawer = (): {
  drawer: HTMLElement;
  title: HTMLTextAreaElement;
  property: HTMLElement;
} => {
  const drawer = holder?.querySelector<HTMLElement>(
    '[data-blok-id="db2"] [data-blok-database-drawer]'
  );
  const title = drawer?.querySelector<HTMLTextAreaElement>('[data-blok-database-drawer-title]');
  const property = drawer?.querySelector<HTMLElement>(
    '[data-blok-database-drawer-prop-value][data-property-id="n2"]'
  );

  if (drawer === null || drawer === undefined || title === null || title === undefined
    || property === null || property === undefined) throw new Error('missing source-owned capability drawer');
  return { drawer, title, property };
};

const dashboardCapabilityOpenDrawer = async (): Promise<ReturnType<typeof dashboardCapabilityDrawer>> => {
  const open = dashboardWidget('foreign').querySelector<HTMLButtonElement>(
    '[data-row-id="q1"] [data-blok-database-table-open]'
  );

  if (open === null) throw new Error('missing native widget row-open button');
  open.click();
  await quiet();

  return dashboardCapabilityDrawer();
};

const dashboardCapabilityRevoke = async (
  current: TestEditor,
  loss: 'dashboard-readonly' | 'definition-readonly' | 'remove-dashboard' | 'remove-widget'
): Promise<void> => {
  if (loss === 'dashboard-readonly' || loss === 'definition-readonly') {
    const id = loss === 'dashboard-readonly' ? 'db' : 'dashboard-capability-definition';
    const owner = current.blocks.getById(id);

    if (owner === null) throw new Error('missing capability owner');
    owner.call('dashboardCapabilitySetReadOnly', { readOnly: true });
  } else if (loss === 'remove-dashboard') {
    const index = current.blocks.getBlockIndex('db');

    if (index === undefined) throw new Error('missing dashboard block');
    await current.blocks.delete(index, false);
  } else {
    const output = await current.save();
    const dashboard = output.blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;

    if (dashboard === undefined) throw new Error('missing dashboard definition');
    await current.blocks.update('db', {
      ...dashboard,
      views: dashboard.views.map((entry) => entry.id !== 'dash' || entry.dashboard === undefined
        ? entry
        : {
          ...entry,
          dashboard: {
            ...entry.dashboard,
            rows: entry.dashboard.rows.map((row) => ({
              ...row,
              widgets: row.widgets.filter((widget) => widget.id !== 'foreign'),
            })),
          },
        }),
    });
  }
  await quiet();
};

const dashboardCapabilityEditSource = async (value: string): Promise<void> => {
  const cell = holder?.querySelector<HTMLElement>(
    '[data-blok-id="db2"] [data-row-id="q1"] [role="gridcell"][data-property-id="n2"]'
  );

  if (cell === null || cell === undefined) throw new Error('missing surviving standalone source cell');
  cell.click();
  await commitDatabaseText(value);
};

const dashboardCapabilityBodyDoc = (): OutputBlockData[] => {
  const blocks = dashboardCapabilityDoc().map((block) => block.id === 'q1' || block.id === 'q2'
    ? {
      ...block,
      content: ['dashboard-capability-body-' + block.id],
      data: { ...block.data, bodyBlocks: true },
    }
    : block);

  blocks.push(
    { id: 'dashboard-capability-body-q1', type: 'paragraph', parent: 'q1', data: { text: [{ text: 'Source native body' }] } },
    { id: 'dashboard-capability-body-q2', type: 'paragraph', parent: 'q2', data: { text: [{ text: 'Second native body' }] } }
  );

  return blocks;
};

const dashboardCapabilityBodyElement = (current: TestEditor, rowId: 'q1' | 'q2' = 'q1'): HTMLElement => {
  const row = current.blocks.getById(rowId);
  const body = current.blocks.getById('dashboard-capability-body-' + rowId);
  const host = dashboardCapabilityDrawer().drawer.querySelector<HTMLElement>('[data-blok-database-drawer-editor]');
  const paragraph = body?.holder.querySelector<HTMLElement>('[data-blok-tool="paragraph"]');

  if (row === null || body === null || host === null || paragraph === null || paragraph === undefined
    || row.holder.parentElement !== host || !row.holder.contains(body.holder)) {
    throw new Error('native drawer did not attach the source row body');
  }

  return paragraph;
};

const dashboardCapabilityBodyInput = (element: HTMLElement, text: string): boolean => {
  const drawer = element.closest('[data-blok-database-drawer]');

  if (!element.isConnected || element.contentEditable !== 'true' || drawer === null
    || !drawer.hasAttribute('data-open') || element.closest('[inert], [hidden], [aria-hidden="true"]') !== null) {
    return false;
  }
  element.replaceChildren(document.createTextNode(text));
  element.dispatchEvent(new InputEvent('input', {
    bubbles: true, inputType: 'insertText', data: text,
  }));

  return true;
};

const dashboardCapabilityBodySourceOpen = async (rowId: 'q1' | 'q2'): Promise<void> => {
  const source = editor?.blocks.getById('db2');

  if (source === null || source === undefined) throw new Error('missing standalone source body database');
  source.call('openRow', { rowId });
  await quiet();
};

const dashboardCapabilityLinkedDrawerDoc = (): OutputBlockData[] => {
  const blocks = dashboardCapabilityDoc();
  const definitionIndex = blocks.findIndex((block) => block.id === 'dashboard-capability-definition');
  const sourceBlock = blocks.find((block) => block.id === 'db2');
  const definitionBlock = blocks[definitionIndex];

  if (definitionBlock === undefined || sourceBlock === undefined) throw new Error('missing linked drawer fixture');
  const definition = definitionBlock.data as DatabaseData;
  const source = sourceBlock.data as DatabaseData;

  blocks[definitionIndex] = {
    ...definitionBlock,
    data: {
      ...definition,
      views: definition.views.map((entry) => entry.id === 'capability-source-v'
        ? { ...entry, dataSourceId: 'dashboard-capability-intermediate' }
        : entry),
    },
  };
  blocks.push({
    id: 'dashboard-capability-intermediate',
    type: 'database',
    data: {
      source: { databaseId: 'db2' },
      schema: structuredClone(source.schema),
      views: source.views.map((entry) => ({ ...entry, id: 'capability-intermediate-v' })),
      activeViewId: 'capability-intermediate-v',
    },
  });

  return blocks;
};

const dashboardPasteDropElement = (root: ParentNode, selector: string): HTMLElement => {
  const element = root.querySelector<HTMLElement>(selector);

  if (element === null) throw new Error('missing dashboard paste/drop element: ' + selector);
  return element;
};

const dashboardPasteDropSourceRoot = (): HTMLElement => {
  if (holder === undefined) throw new Error('missing editor holder');
  return dashboardPasteDropElement(holder, '[data-blok-element][data-blok-id="db2"]');
};

const dashboardPasteDropSelect = async (
  root: () => HTMLElement,
  rowId: string,
  propertyId: string
): Promise<HTMLElement> => {
  const selector = '[data-row-id="' + CSS.escape(rowId) + '"] [role="gridcell"][data-property-id="' + CSS.escape(propertyId) + '"]';

  dashboardPasteDropElement(root(), selector).click();
  await quiet();
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    '[data-blok-database-cell-editor] [data-blok-database-cell-input]'
  );

  if (input === null) throw new Error('native cell selection opened no text editor');
  input.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, cancelable: true,
  }));
  await quiet();

  return dashboardPasteDropElement(root(), '[data-blok-database-table-grid]');
};

const dashboardPasteDropPaste = (grid: HTMLElement, text: string): boolean => {
  const event = new Event('paste', { bubbles: true, cancelable: true });

  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (format: string): string => format === 'text/plain' ? text : '' },
  });
  grid.dispatchEvent(event);
  return event.defaultPrevented;
};

const dashboardPasteDropFillDown = (grid: HTMLElement): boolean => {
  const event = new KeyboardEvent('keydown', {
    key: 'd', code: 'KeyD', ctrlKey: true, bubbles: true, cancelable: true,
  });

  grid.dispatchEvent(event);
  return event.defaultPrevented;
};

const dashboardPasteDropDrain = async (): Promise<void> => {
  await quiet();
  await new Promise<void>((resolve) => { setTimeout(resolve, 650); });
  await quiet();
};

const dashboardPasteDropDrag = (
  grid: HTMLElement,
  rowId: string,
  targetId: string,
  side: 'before' | 'after'
): void => {
  const rows = [...grid.querySelectorAll<HTMLElement>('[data-blok-database-table-row]')];
  const rect = (top: number): DOMRect => ({
    top, bottom: top + 37, left: 0, right: 600, width: 600, height: 37,
    x: 0, y: top, toJSON: () => ({}),
  });

  rows.forEach((row, index) => {
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rect(index * 37));
  });
  const source = rows.find((row) => row.getAttribute('data-row-id') === rowId);
  const target = rows.find((row) => row.getAttribute('data-row-id') === targetId);

  if (source === undefined || target === undefined) throw new Error('missing native drag row');
  const handle = dashboardPasteDropElement(source, '[data-blok-database-table-row-handle]');
  const y = side === 'before' ? target.getBoundingClientRect().top + 4 : target.getBoundingClientRect().bottom + 4;

  handle.dispatchEvent(new PointerEvent('pointerdown', {
    button: 0, buttons: 1, pointerId: 1, clientX: 5,
    clientY: source.getBoundingClientRect().top + 10, bubbles: true, cancelable: true,
  }));
  document.dispatchEvent(new PointerEvent('pointermove', {
    buttons: 1, pointerId: 1, clientX: 5, clientY: y, bubbles: true, cancelable: true,
  }));
  document.dispatchEvent(new PointerEvent('pointerup', {
    button: 0, pointerId: 1, clientX: 5, clientY: y, bubbles: true, cancelable: true,
  }));
};

describe('row ⋮⋮ menu with a real editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    vi.restoreAllMocks();
  });

  // A toolbar moved into another block makes its refresh writes count as that
  // block's changes, and two related views then redraw each other forever.
  it('keeps the toolbar of a view bound to a second source in its own block', async () => {
    const blocks = dashboardCapabilityLinkedDrawerDoc().map((block) => block.id === 'db'
      ? { ...block, data: { ...(block.data as DatabaseData), activeViewId: 'v' } }
      : block);

    // Read-only: the redraw loop does not start here, so a regression fails the check instead of hanging.
    await make(blocks, {}, { readOnly: true });
    const toolbar = holder?.querySelector<HTMLElement>(
      '[data-blok-element][data-blok-id="dashboard-capability-definition"] [data-blok-database-view-toolbar]'
    );
    const owner = toolbar?.closest('[data-blok-element]')?.getAttribute('data-blok-id');

    expect(owner).toBe('dashboard-capability-definition');
  });

  describe('dashboard notification redraw boundaries', () => {
    it('does not remount same-database widgets for its own database notification', async () => {
      const current = await make(dashboardOwnerDoc(), {}, { readOnly: true });
      const widget = dashboardWidget('local');
      const dashboard = current.blocks.getById('db');

      if (dashboard === null) throw new Error('missing dashboard block');
      current.events.emit('block changed', {
        event: new CustomEvent('block-changed', {
          detail: { target: dashboard, index: current.blocks.getBlockIndex(dashboard.id), origin: 'local' },
        }),
      });
      await quiet();

      expect(dashboardWidget('local')).toBe(widget);
    });

    it('redraws foreign widgets for their source database notification', async () => {
      const current = await make(dashboardOwnerDoc(), {}, { readOnly: true });
      const widget = dashboardWidget('foreign');
      const source = current.blocks.getById('db2');

      if (source === null) throw new Error('missing source database');
      current.events.emit('block changed', {
        event: new CustomEvent('block-changed', {
          detail: { target: source, index: current.blocks.getBlockIndex(source.id), origin: 'local' },
        }),
      });
      await quiet();

      expect(dashboardWidget('foreign')).not.toBe(widget);
      expect(dashboardWidget('foreign').textContent).toContain('Source note');
    });

    it('reprojects same-database widgets for their own row notification', async () => {
      const current = await make(dashboardOwnerDoc(), {}, { readOnly: true });
      const row = current.blocks.getById('r1');

      if (row === null) throw new Error('missing local row');
      row.call('updateProperties', { notes: 'Updated local row note' });
      current.events.emit('block changed', {
        event: new CustomEvent('block-changed', {
          detail: { target: row, index: current.blocks.getBlockIndex(row.id), origin: 'local' },
        }),
      });
      await quiet();

      expect(dashboardWidget('local').textContent).toContain('Updated local row note');
    });
  });

  it.each([
    {
      label: 'default',
      options: {},
      controlHref: 'https://example.test/sanitizer-control',
    },
    {
      label: 'configured global',
      options: { sanitizer: { a: { href: false } } },
      controlHref: null,
    },
  ])('preserves literal saved automation definitions through real editor save and render with $label sanitizer rules', async ({ options, controlHref }) => {
    const automations = {
      version: 1,
      definitions: [{
        id: 'automation-<b>id</b>',
        name: 'Literal action',
        status: 'paused',
        scope: { type: 'view', viewId: 'v' },
        triggerMode: 'any',
        triggers: [{ id: 'trigger-<b>id</b>', type: 'propertyEdited', propertyId: 'notes' }],
        actions: [{
          id: 'action-<b>id</b>',
          type: 'editProperty',
          target: 'triggerRow',
          propertyId: 'notes',
          value: '<b>literal</b>',
        }],
      }],
    };
    const blocks = doc().map((block) => block.id === 'db'
      ? { ...block, data: { ...block.data, automations } }
      : block);
    const current = await make([
      ...blocks,
      {
        id: 'sanitizer-control',
        type: 'paragraph',
        data: { text: '<a href="https://example.test/sanitizer-control">Global rule control</a>' },
      },
    ], {}, options);
    const first = await current.save();
    const firstDatabase = first.blocks.find((block) => block.id === 'db');

    expect(firstDatabase?.data).toHaveProperty(['automations', 'definitions', 0, 'actions', 0, 'value'], '<b>literal</b>');
    expect(firstDatabase?.id).toBe('db');
    expect(firstDatabase?.data).toHaveProperty(['automations', 'version'], 1);
    expect(firstDatabase?.data).toHaveProperty(['automations', 'definitions', 0, 'id'], 'automation-<b>id</b>');
    expect(firstDatabase?.data).toHaveProperty(['automations', 'definitions', 0, 'triggers', 0, 'id'], 'trigger-<b>id</b>');
    expect(firstDatabase?.data).toHaveProperty(['automations', 'definitions', 0, 'actions', 0, 'id'], 'action-<b>id</b>');
    expect(firstDatabase?.data.automations).toEqual(automations);
    const firstControl = current.blocks.getById('sanitizer-control')?.holder;

    expect(firstControl?.textContent).toContain('Global rule control');
    expect(firstControl?.querySelector('a')?.getAttribute('href') ?? null).toBe(controlHref);

    await current.blocks.render(first);
    await quiet();
    const second = await current.save();
    const secondDatabase = second.blocks.find((block) => block.id === 'db');

    expect(secondDatabase?.data).toHaveProperty(['automations', 'definitions', 0, 'actions', 0, 'value'], '<b>literal</b>');
    expect(secondDatabase?.id).toBe('db');
    expect(secondDatabase?.data).toHaveProperty(['automations', 'version'], 1);
    expect(secondDatabase?.data).toHaveProperty(['automations', 'definitions', 0, 'id'], 'automation-<b>id</b>');
    expect(secondDatabase?.data).toHaveProperty(['automations', 'definitions', 0, 'triggers', 0, 'id'], 'trigger-<b>id</b>');
    expect(secondDatabase?.data).toHaveProperty(['automations', 'definitions', 0, 'actions', 0, 'id'], 'action-<b>id</b>');
    expect(secondDatabase?.data.automations).toEqual(automations);
    const secondControl = current.blocks.getById('sanitizer-control')?.holder;

    expect(secondControl?.textContent).toContain('Global rule control');
    expect(secondControl?.querySelector('a')?.getAttribute('href') ?? null).toBe(controlHref);
  });

  describe('dashboard legacy-body conversion authority', () => {
    const legacy: OutputData = { blocks: [
      { id: 'legacy-first', type: 'paragraph', data: { text: 'Legacy widget body' } },
      { id: 'legacy-second', type: 'paragraph', data: { text: 'Second legacy paragraph' } },
    ] };
    const fixture = (): OutputBlockData[] => dashboardCapabilityDoc().map((block) => {
      if (block.id === 'db2' || block.id === 'dashboard-capability-definition') {
        const data = block.data as DatabaseData;

        return { ...block, data: {
          ...data,
          schema: [...data.schema, { id: 'legacy-details', name: 'Card details', type: 'richText', position: 'a4' }],
        } };
      }
      if (block.id === 'q1') {
        const data = block.data as { properties: Record<string, PropertyValue> };

        return { ...block, data: {
          ...block.data,
          properties: { ...data.properties, 'legacy-details': structuredClone(legacy) },
        } };
      }

      return block;
    });

    it.each(['dashboard-readonly', 'definition-readonly'] as const)(
      'denied widget legacy-body open does not convert native children or mark the row after %s',
      async (loss) => {
        const current = await make(fixture());
        const initial = (await current.save()).blocks.find((block) => block.id === 'q1');

        if (initial === undefined || initial.data.bodyBlocks === true || current.blocks.getChildren('q1').length !== 0) {
          throw new Error('legacy-body fixture was already converted before the denied open');
        }
        await dashboardCapabilityRevoke(current, loss);
        const open = dashboardWidget('foreign').querySelector<HTMLButtonElement>(
          '[data-row-id="q1"] [data-blok-database-table-open]'
        );

        if (open === null) throw new Error('missing native widget row-open button');
        open.click();
        await quiet();
        const output = await current.save();
        const row = output.blocks.find((block) => block.id === 'q1');

        expect(output.blocks.filter((block) => block.parent === 'q1')).toEqual([]);
        expect(current.blocks.getChildren('q1')).toEqual([]);
        expect(row?.data.bodyBlocks).toBeUndefined();
        expect(row?.content ?? []).toEqual(initial.content ?? []);
        expect(row?.data.properties).toEqual(initial.data.properties);
        expect(row?.data).toHaveProperty(
          ['properties', 'legacy-details'],
          (initial.data.properties as Record<string, PropertyValue>)['legacy-details']
        );
        await vi.waitFor(() => {
          const source = current.blocks.getById('db2');

          if (source === null || source === undefined) throw new Error('missing source block db2');
          const drawer = source.holder.querySelector<HTMLElement>('[data-blok-database-drawer]');

          if (drawer === null) throw new Error('source db2 drawer is absent');
          const body = drawer.querySelector<HTMLElement>('[data-blok-database-drawer-editor]');

          if (body === null) throw new Error('source drawer body holder is absent');
          expect(body.textContent).toContain('Legacy widget body');
        }, { timeout: 3000 });
        expect(current.blocks.getChildren('q1')).toEqual([]);
        const close = current.blocks.getById('db2')?.holder.querySelector<HTMLButtonElement>(
          '[data-blok-database-drawer-close]'
        );

        if (close === null || close === undefined) throw new Error('missing denied drawer close button');
        close.click();
        await quiet();

        expect((await current.save()).blocks).toEqual(output.blocks);
      }
    );

    it.each(['widget', 'standalone'] as const)(
      'authorized legacy-body open converts native children and keeps the blob through %s',
      async (opening) => {
        const current = await make(fixture());
        const initial = (await current.save()).blocks.find((block) => block.id === 'q1');

        if (initial === undefined || initial.data.bodyBlocks === true || current.blocks.getChildren('q1').length !== 0) {
          throw new Error('legacy-body positive fixture was already converted');
        }
        if (opening === 'widget') await dashboardCapabilityOpenDrawer();
        else await dashboardCapabilityBodySourceOpen('q1');
        const output = await current.save();
        const row = output.blocks.find((block) => block.id === 'q1');
        const body = output.blocks.filter((block) => block.parent === 'q1');
        const host = dashboardCapabilityDrawer().drawer.querySelector<HTMLElement>('[data-blok-database-drawer-editor]');

        expect(body.map((block) => block.id)).toEqual(['q1-body-0', 'q1-body-1']);
        expect(row?.data.bodyBlocks).toBe(true);
        expect(row?.content).toEqual(['q1-body-0', 'q1-body-1']);
        expect(row?.data).toHaveProperty(
          ['properties', 'legacy-details'],
          (initial.data.properties as Record<string, PropertyValue>)['legacy-details']
        );
        expect(current.blocks.getChildren('q1').map((block) => block.id)).toEqual(['q1-body-0', 'q1-body-1']);
        expect(host?.textContent).toContain('Legacy widget body');
        expect(host?.textContent).toContain('Second legacy paragraph');
      }
    );
  });

  it.each(['dashboard-readonly', 'definition-readonly'] as const)(
    'dashboard capability readonly %s does not expose writable native row-body blocks',
    async (loss) => {
      const blocks = dashboardCapabilityBodyDoc();
      const source = backendFor(blocks, 'db2');
      const local = backendFor(blocks, 'db');
      const sourceUpdate = vi.spyOn(source.adapter, 'updateRow');
      const localUpdate = vi.spyOn(local.adapter, 'updateRow');
      const current = await make(blocks, { db: { adapter: local.adapter }, db2: { adapter: source.adapter } });

      await dashboardCapabilityRevoke(current, loss);
      await dashboardCapabilityOpenDrawer();
      const body = dashboardCapabilityBodyElement(current);
      const typed = dashboardCapabilityBodyInput(body, 'Denied readonly native body');

      await quiet();
      await new Promise<void>((resolve) => { setTimeout(resolve, 650); });
      const output = await current.save();

      expect(output.blocks.find((block) => block.id === 'dashboard-capability-body-q1')?.data.text)
        .toEqual([{ text: 'Source native body' }]);
      expect(typed).toBe(false);
      expect(output.blocks.find((block) => block.id === 'dashboard-capability-body-q1')?.parent).toBe('q1');
      expect((await saved('q1'))?.data.properties).toEqual({
        name: 'Existing', n2: 'Source note', done: 'Source done',
      });
      expect(sourceUpdate).not.toHaveBeenCalled();
      expect(localUpdate).not.toHaveBeenCalled();
      expect(source.rows.get('q1')?.properties.n2).toBe('Source note');
      expect(current.blocks.getById('db2')).not.toBeNull();
      expect(current.blocks.getChildren('dashboard-capability-definition')).toEqual([]);

      await dashboardCapabilityBodySourceOpen('q1');
      const sourceBody = dashboardCapabilityBodyElement(current);

      if (!dashboardCapabilityBodyInput(sourceBody, 'Standalone native body after readonly peek')) {
        throw new Error('standalone source body lost its writable input');
      }
      await quiet();
      const sourceOutput = await current.save();

      expect(sourceOutput.blocks.find((block) => block.id === 'dashboard-capability-body-q1')?.data.text)
        .toEqual([{ text: 'Standalone native body after readonly peek' }]);
      expect(sourceOutput.blocks.find((block) => block.id === 'dashboard-capability-body-q1')?.parent).toBe('q1');
      expect(sourceOutput.blocks.find((block) => block.id === 'dashboard-capability-body-q2')?.data.text)
        .toEqual([{ text: 'Second native body' }]);
      expect(sourceUpdate).not.toHaveBeenCalled();
      expect(localUpdate).not.toHaveBeenCalled();
    }
  );

  it.each(['dashboard-readonly', 'definition-readonly'] as const)(
    'dashboard capability native row-body input loses reach after %s',
    async (loss) => {
      const blocks = dashboardCapabilityBodyDoc();
      const source = backendFor(blocks, 'db2');
      const local = backendFor(blocks, 'db');
      const sourceUpdate = vi.spyOn(source.adapter, 'updateRow');
      const localUpdate = vi.spyOn(local.adapter, 'updateRow');
      const current = await make(blocks, { db: { adapter: local.adapter }, db2: { adapter: source.adapter } });

      await dashboardCapabilityOpenDrawer();
      const retainedBody = dashboardCapabilityBodyElement(current);

      if (retainedBody.contentEditable !== 'true') throw new Error('allowed native body was not editable');
      await dashboardCapabilityRevoke(current, loss);
      const typed = dashboardCapabilityBodyInput(retainedBody, 'Denied revoked native body');

      retainedBody.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      await quiet();
      await new Promise<void>((resolve) => { setTimeout(resolve, 650); });
      const output = await current.save();

      expect(output.blocks.find((block) => block.id === 'dashboard-capability-body-q1')?.data.text)
        .toEqual([{ text: 'Source native body' }]);
      expect(typed).toBe(false);
      expect(output.blocks.find((block) => block.id === 'dashboard-capability-body-q1')?.parent).toBe('q1');
      expect((await saved('q1'))?.data.properties).toEqual({
        name: 'Existing', n2: 'Source note', done: 'Source done',
      });
      expect(sourceUpdate).not.toHaveBeenCalled();
      expect(localUpdate).not.toHaveBeenCalled();
      expect(current.blocks.getById('db2')).not.toBeNull();
      expect(current.blocks.getChildren('q1').map((block) => block.id))
        .toEqual(['dashboard-capability-body-q1']);

      await dashboardCapabilityBodySourceOpen('q1');

      if (!dashboardCapabilityBodyInput(dashboardCapabilityBodyElement(current), 'Surviving standalone native body')) {
        throw new Error('source body stayed blocked after an independent open');
      }
      await quiet();
      const sourceOutput = await current.save();

      expect(sourceOutput.blocks.find((block) => block.id === 'dashboard-capability-body-q1')?.data.text)
        .toEqual([{ text: 'Surviving standalone native body' }]);
      expect(sourceOutput.blocks.find((block) => block.id === 'dashboard-capability-body-q2')?.data.text)
        .toEqual([{ text: 'Second native body' }]);
      expect(sourceUpdate).not.toHaveBeenCalled();
      expect(localUpdate).not.toHaveBeenCalled();
    }
  );

  describe('drawer cover and icon permission changes', () => {
    let matchMediaDescriptor: PropertyDescriptor | undefined;
    let elementFromPointDescriptor: PropertyDescriptor | undefined;

    beforeEach(() => {
      vi.clearAllMocks();
      matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
      elementFromPointDescriptor = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: (query: string): MediaQueryList => ({
          matches: false,
          media: query,
          onchange: null,
          addListener: () => undefined,
          removeListener: () => undefined,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
        }),
      });
      if (typeof document.elementFromPoint !== 'function') {
        Object.defineProperty(document, 'elementFromPoint', {
          configurable: true,
          value: () => null,
        });
      }
    });

    afterEach(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', bubbles: true, cancelable: true,
      }));
      document.querySelectorAll(
        '[data-blok-emoji-picker], [data-blok-emoji-picker-backdrop], [data-role="audio-cover-picker"]'
      ).forEach((element) => element.remove());
      if (matchMediaDescriptor === undefined) {
        Reflect.deleteProperty(window, 'matchMedia');
      } else {
        Object.defineProperty(window, 'matchMedia', matchMediaDescriptor);
      }
      if (elementFromPointDescriptor === undefined) {
        Reflect.deleteProperty(document, 'elementFromPoint');
      } else {
        Object.defineProperty(document, 'elementFromPoint', elementFromPointDescriptor);
      }
      vi.restoreAllMocks();
    });

    it.each(['writable', 'dashboard-readonly', 'definition-readonly'] as const)(
      'a pending widget cover upload respects the opener permission: %s',
      async (loss) => {
        const originalCover = 'https://example.com/original-cover.png';
        const uploadedCover = 'https://example.com/uploaded-cover.png';
        const blocks = dashboardCapabilityDoc().map((block) => block.id === 'q1'
          ? { ...block, data: { ...block.data, cover: originalCover } }
          : block);
        const file = new File(['pending cover'], 'cover.png', { type: 'image/png' });
        let finish: ((asset: { url: string }) => void) | undefined;
        let request: { file: File; kind: string; tool?: string } | undefined;
        const uploader: NonNullable<BlokConfig['uploader']> = {
          uploadByFile: (chosen, context) => {
            request = { file: chosen, kind: context.kind, tool: context.tool };

            return new Promise<{ url: string }>((resolve) => { finish = resolve; });
          },
        };
        const current = await make(blocks, {}, { uploader });
        const opened = await dashboardCapabilityOpenDrawer();
        const trigger = opened.drawer.querySelector<HTMLButtonElement>(
          '[data-blok-database-drawer-change-cover]'
        );

        if (trigger === null) throw new Error('missing native cover trigger');
        trigger.click();
        const picker = document.querySelector<HTMLElement>('[data-role="audio-cover-picker"]');
        const input = picker?.querySelector<HTMLInputElement>('[data-blok-testid="file-input"]');

        if (picker === null || input === null || input === undefined) {
          throw new Error('missing native cover file input');
        }
        Object.defineProperty(input, 'files', { configurable: true, value: [file] });
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await vi.waitFor(() => {
          if (finish === undefined || request?.file !== file) throw new Error('cover upload did not start');
        });
        const before = (await current.save()).blocks;
        const beforeRow = before.find((block) => block.id === 'q1');
        const beforeOther = before.find((block) => block.id === 'q2');

        if (beforeRow === undefined || beforeOther === undefined) throw new Error('missing source rows');
        if (loss !== 'writable') await dashboardCapabilityRevoke(current, loss);
        const pickerUsableAfterLoss = picker.isConnected && !picker.hidden;
        const resolveUpload = finish;

        if (resolveUpload === undefined) throw new Error('missing host upload completion');
        resolveUpload({ url: uploadedCover });
        await quiet();
        const after = (await current.save()).blocks;
        const row = after.find((block) => block.id === 'q1');

        expect(row?.data.cover).toBe(loss === 'writable' ? uploadedCover : originalCover);
        expect(row?.data.properties).toEqual(beforeRow.data.properties);
        expect(row?.parent).toBe('db2');
        expect(after.find((block) => block.id === 'q2')).toEqual(beforeOther);
        expect(request).toEqual({ file, kind: 'image', tool: 'database' });
        if (loss !== 'writable') {
          expect(pickerUsableAfterLoss).toBe(false);
          expect(opened.drawer.isConnected).toBe(false);
          await dashboardCapabilityEditSource('Source remains writable after cover denial');
          expect((await saved('q1'))?.data.properties.n2).toBe('Source remains writable after cover denial');
        }
      }
    );

    it.each(['writable', 'dashboard-readonly', 'definition-readonly'] as const)(
      'a retained widget row-icon action respects the opener permission: %s',
      async (loss) => {
        const originalIcon = '🚀';
        const blocks = dashboardCapabilityDoc().map((block) => block.id === 'q1'
          ? { ...block, data: { ...block.data, icon: originalIcon } }
          : block);
        const current = await make(blocks);
        const opened = await dashboardCapabilityOpenDrawer();
        const trigger = opened.drawer.querySelector<HTMLButtonElement>(
          '[data-blok-database-drawer-icon]'
        );

        if (trigger === null) throw new Error('missing native row-icon trigger');
        trigger.click();
        await vi.waitFor(() => {
          const picker = document.querySelector<HTMLElement>('[data-blok-emoji-picker]');

          if (picker === null || picker.hidden || !picker.contains(document.activeElement)) {
            throw new Error('native row-icon picker is not ready');
          }
        });
        const picker = document.querySelector<HTMLElement>('[data-blok-emoji-picker]');
        const action = picker?.querySelector<HTMLButtonElement>('[data-emoji-picker-remove]');

        if (picker === null || action === null || action === undefined) {
          throw new Error('missing native row-icon remove action');
        }
        const before = (await current.save()).blocks;
        const beforeRow = before.find((block) => block.id === 'q1');
        const beforeOther = before.find((block) => block.id === 'q2');

        if (beforeRow === undefined || beforeOther === undefined) throw new Error('missing source rows');
        if (loss !== 'writable') await dashboardCapabilityRevoke(current, loss);
        const pickerUsableAfterLoss = picker.isConnected && !picker.hidden;

        action.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await quiet();
        const after = (await current.save()).blocks;
        const row = after.find((block) => block.id === 'q1');

        expect(row?.data.icon).toBe(loss === 'writable' ? undefined : originalIcon);
        expect(row?.data.properties).toEqual(beforeRow.data.properties);
        expect(row?.parent).toBe('db2');
        expect(after.find((block) => block.id === 'q2')).toEqual(beforeOther);
        if (loss !== 'writable') {
          expect(pickerUsableAfterLoss).toBe(false);
          expect(opened.drawer.isConnected).toBe(false);
          await dashboardCapabilityEditSource('Source remains writable after icon denial');
          expect((await saved('q1'))?.data.properties.n2).toBe('Source remains writable after icon denial');
        }
      }
    );
  });

  it.each(['dashboard-readonly', 'definition-readonly'] as const)(
    'keeps an open denied-born native body readonly after %s is restored and another row opens',
    async (loss) => {
      const current = await make(dashboardCapabilityBodyDoc());

      await dashboardCapabilityRevoke(current, loss);
      const denied = await dashboardCapabilityOpenDrawer();
      const deniedBody = dashboardCapabilityBodyElement(current);

      if (!denied.title.readOnly || deniedBody.closest('[inert]') === null) {
        throw new Error('denied-born native body fixture was writable');
      }
      const ownerId = loss === 'dashboard-readonly' ? 'db' : 'dashboard-capability-definition';
      const owner = current.blocks.getById(ownerId);

      if (owner === null) throw new Error('missing permission owner to restore');
      owner.call('dashboardCapabilitySetReadOnly', { readOnly: false });
      await quiet();
      const open = dashboardWidget('foreign').querySelector<HTMLButtonElement>(
        '[data-row-id="q2"] [data-blok-database-table-open]'
      );

      if (open === null) throw new Error('missing second native widget row-open button');
      open.click();
      await quiet();
      const body = dashboardCapabilityBodyElement(current, 'q2');

      expect(body.closest('[inert]') !== null || body.contentEditable !== 'true').toBe(true);
      const typed = dashboardCapabilityBodyInput(body, 'Denied session after permission regrant');

      await quiet();
      const output = await current.save();

      expect(typed).toBe(false);
      expect(output.blocks.find((block) => block.id === 'dashboard-capability-body-q2')?.data.text)
        .toEqual([{ text: 'Second native body' }]);
      expect(output.blocks.find((block) => block.id === 'dashboard-capability-body-q1')?.data.text)
        .toEqual([{ text: 'Source native body' }]);
      expect(dashboardCapabilityDrawer().drawer).toBe(denied.drawer);
      expect(dashboardCapabilityDrawer().title.readOnly).toBe(true);
      expect(output.blocks.find((block) => block.id === 'dashboard-capability-body-q2')?.parent).toBe('q2');
      expect((await saved('q2'))?.data.properties).toEqual({
        name: 'Second', n2: 'Second note', done: 'Second done',
      });
    }
  );

  it('dashboard capability same-widget redraw preserves authorized native row-body input and save', async () => {
    const blocks = dashboardCapabilityBodyDoc();
    const source = backendFor(blocks, 'db2');
    const local = backendFor(blocks, 'db');
    const sourceUpdate = vi.spyOn(source.adapter, 'updateRow');
    const localUpdate = vi.spyOn(local.adapter, 'updateRow');
    const current = await make(blocks, { db: { adapter: local.adapter }, db2: { adapter: source.adapter } });

    await dashboardCapabilityOpenDrawer();
    const retainedBody = dashboardCapabilityBodyElement(current);
    const previousWidget = dashboardWidget('foreign');
    const output = await current.save();
    const dashboard = output.blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;

    if (dashboard === undefined) throw new Error('missing body redraw dashboard');
    await current.blocks.update('db', {
      ...dashboard,
      views: dashboard.views.map((entry) => entry.id === 'dash'
        ? { ...entry, name: 'Redrawn native body dashboard' }
        : entry),
    });
    await quiet();

    if (!dashboardCapabilityBodyInput(retainedBody, 'Allowed native body after widget redraw')) {
      throw new Error('authorized same-widget redraw revoked the native body');
    }
    await quiet();
    const changed = await current.save();

    expect(changed.blocks.find((block) => block.id === 'dashboard-capability-body-q1')?.data.text)
      .toEqual([{ text: 'Allowed native body after widget redraw' }]);
    expect(dashboardWidget('foreign')).not.toBe(previousWidget);
    expect(previousWidget.isConnected).toBe(false);
    expect(dashboardCapabilityBodyElement(current)).toBe(retainedBody);
    expect(changed.blocks.find((block) => block.id === 'dashboard-capability-body-q1')?.parent).toBe('q1');
    expect(changed.blocks.find((block) => block.id === 'db')?.data.activeViewId).toBe('dash');
    expect((await saved('q1'))?.data.properties.n2).toBe('Source note');
    expect(sourceUpdate).not.toHaveBeenCalled();
    expect(localUpdate).not.toHaveBeenCalled();
    expect(current.blocks.getById('db2')).not.toBeNull();
  });

  it.each(['close', 'standalone-source-row'] as const)(
    'dashboard capability authorized native row-body draft survives %s',
    async (exit) => {
      const current = await make(dashboardCapabilityBodyDoc());

      await dashboardCapabilityOpenDrawer();
      const opened = dashboardCapabilityDrawer();
      const body = dashboardCapabilityBodyElement(current);

      if (!dashboardCapabilityBodyInput(body, 'Authorized native body before leaving')) {
        throw new Error('allowed native body did not accept input');
      }
      if (exit === 'close') {
        const close = opened.drawer.querySelector<HTMLButtonElement>('[data-blok-database-drawer-close]');

        if (close === null) throw new Error('missing native body drawer close button');
        close.click();
        opened.drawer.dispatchEvent(new Event('transitionend'));
      } else {
        await dashboardCapabilityBodySourceOpen('q2');
      }
      await quiet();
      const output = await current.save();

      expect(output.blocks.find((block) => block.id === 'dashboard-capability-body-q1')?.data.text)
        .toEqual([{ text: 'Authorized native body before leaving' }]);
      expect(output.blocks.find((block) => block.id === 'dashboard-capability-body-q1')?.parent).toBe('q1');
      expect(output.blocks.find((block) => block.id === 'dashboard-capability-body-q2')?.data.text)
        .toEqual([{ text: 'Second native body' }]);
      expect(current.blocks.getChildren('q1').map((block) => block.id))
        .toEqual(['dashboard-capability-body-q1']);
      expect((await saved('q1'))?.data.properties.n2).toBe('Source note');
      if (exit === 'close') {
        expect(poolOf('q1')).toBe('db2');
      } else {
        expect(dashboardCapabilityBodyElement(current, 'q2').textContent).toBe('Second native body');
        expect(poolOf('q1')).toBe('db2');
      }
    }
  );

  it.each(['dashboard-readonly', 'definition-readonly'] as const)(
    'dashboard capability linked intermediary drawer refuses initial %s title and property writes',
    async (loss) => {
      const blocks = dashboardCapabilityLinkedDrawerDoc();
      const source = backendFor(blocks, 'db2');
      const local = backendFor(blocks, 'db');
      const sourceUpdate = vi.spyOn(source.adapter, 'updateRow');
      const localUpdate = vi.spyOn(local.adapter, 'updateRow');
      const current = await make(blocks, { db: { adapter: local.adapter }, db2: { adapter: source.adapter } });

      await dashboardCapabilityRevoke(current, loss);
      const opened = await dashboardCapabilityOpenDrawer();

      opened.title.value = 'Denied linked intermediary title';
      opened.title.dispatchEvent(new Event('input', { bubbles: true }));
      opened.property.click();
      await quiet();
      const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        '[data-blok-database-cell-editor] [data-blok-database-cell-input="text"]'
      );

      if (input !== null) {
        input.value = 'Denied linked intermediary property';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      }
      await quiet();
      await new Promise<void>((resolve) => { setTimeout(resolve, 650); });
      const blocked = await saved('q1');

      expect({
        title: blocked?.data.title ?? blocked?.data.properties.name,
        properties: blocked?.data.properties,
      }).toEqual({
        title: 'Existing',
        properties: { name: 'Existing', n2: 'Source note', done: 'Source done' },
      });
      expect(sourceUpdate).not.toHaveBeenCalled();
      expect(localUpdate).not.toHaveBeenCalled();
      expect(source.rows.get('q1')?.properties).toEqual({
        name: 'Existing', n2: 'Source note', done: 'Source done',
      });
      expect(opened.title.readOnly).toBe(true);
      expect(opened.property.getAttribute('role')).not.toBe('button');
      expect(input).toBeNull();
      expect(blocked?.parent).toBe('db2');
      expect(current.blocks.getChildren('dashboard-capability-intermediate')).toEqual([]);
      expect(current.blocks.getChildren('dashboard-capability-definition')).toEqual([]);
      expect(current.blocks.getById('db2')).not.toBeNull();
      expect(dashboardWidget('foreign').querySelector('[data-blok-database-dashboard-widget-error]')).toBeNull();
      const output = await current.save();
      const definition = output.blocks.find((block) => block.id === 'dashboard-capability-definition')?.data as DatabaseData | undefined;
      const intermediate = output.blocks.find((block) => block.id === 'dashboard-capability-intermediate')?.data as DatabaseData | undefined;

      expect(definition?.source?.databaseId).toBe('db2');
      expect(definition?.views.find((entry) => entry.id === 'capability-source-v')?.dataSourceId)
        .toBe('dashboard-capability-intermediate');
      expect(intermediate?.source?.databaseId).toBe('db2');
      expect(intermediate?.activeViewId).toBe('capability-intermediate-v');

      await dashboardCapabilityEditSource('Standalone source after denied linked drawer');
      expect((await saved('q1'))?.data.properties.n2).toBe('Standalone source after denied linked drawer');
      await new Promise<void>((resolve) => { setTimeout(resolve, 650); });
      expect(source.rows.get('q1')?.properties.n2).toBe('Standalone source after denied linked drawer');
      expect(sourceUpdate).toHaveBeenCalledWith({
        rowId: 'q1', properties: { n2: 'Standalone source after denied linked drawer' },
      });
      expect(localUpdate).not.toHaveBeenCalled();
      expect((await saved('r1'))?.data.properties.notes).toBe('short');
    }
  );

  it.each(['dashboard-readonly', 'definition-readonly'] as const)(
    'dashboard capability linked intermediary retained drawer refuses late %s title and property writes',
    async (loss) => {
      const blocks = dashboardCapabilityLinkedDrawerDoc();
      const source = backendFor(blocks, 'db2');
      const local = backendFor(blocks, 'db');
      const sourceUpdate = vi.spyOn(source.adapter, 'updateRow');
      const localUpdate = vi.spyOn(local.adapter, 'updateRow');
      const current = await make(blocks, { db: { adapter: local.adapter }, db2: { adapter: source.adapter } });
      const opened = await dashboardCapabilityOpenDrawer();

      opened.property.click();
      await quiet();
      const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        '[data-blok-database-cell-editor] [data-blok-database-cell-input="text"]'
      );

      if (input === null) throw new Error('linked intermediary drawer did not open an allowed property editor');
      input.value = 'Pending linked intermediary draft';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await dashboardCapabilityRevoke(current, loss);
      opened.title.value = 'Late linked intermediary title';
      opened.title.dispatchEvent(new Event('input', { bubbles: true }));
      input.value = 'Late linked intermediary property';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await quiet();
      await new Promise<void>((resolve) => { setTimeout(resolve, 650); });
      const blocked = await saved('q1');

      expect({
        title: blocked?.data.title ?? blocked?.data.properties.name,
        properties: blocked?.data.properties,
      }).toEqual({
        title: 'Existing',
        properties: { name: 'Existing', n2: 'Source note', done: 'Source done' },
      });
      expect(sourceUpdate).not.toHaveBeenCalled();
      expect(localUpdate).not.toHaveBeenCalled();
      expect(source.rows.get('q1')?.properties).toEqual({
        name: 'Existing', n2: 'Source note', done: 'Source done',
      });
      expect(blocked?.parent).toBe('db2');
      expect(current.blocks.getChildren('dashboard-capability-intermediate')).toEqual([]);
      expect(current.blocks.getChildren('dashboard-capability-definition')).toEqual([]);
      expect(current.blocks.getChildren('db2').map((row) => row.id)).toEqual(['q1', 'q2']);
      expect(current.blocks.getById('db2')).not.toBeNull();
      const output = await current.save();
      const definition = output.blocks.find((block) => block.id === 'dashboard-capability-definition')?.data as DatabaseData | undefined;
      const intermediate = output.blocks.find((block) => block.id === 'dashboard-capability-intermediate')?.data as DatabaseData | undefined;

      expect(definition?.source?.databaseId).toBe('db2');
      expect(definition?.views.find((entry) => entry.id === 'capability-source-v')?.dataSourceId)
        .toBe('dashboard-capability-intermediate');
      expect(intermediate?.source?.databaseId).toBe('db2');

      await dashboardCapabilityEditSource('Surviving source after linked drawer revocation');
      expect((await saved('q1'))?.data.properties.n2).toBe('Surviving source after linked drawer revocation');
      await new Promise<void>((resolve) => { setTimeout(resolve, 650); });
      expect(source.rows.get('q1')?.properties.n2).toBe('Surviving source after linked drawer revocation');
      expect(sourceUpdate).toHaveBeenCalledWith({
        rowId: 'q1', properties: { n2: 'Surviving source after linked drawer revocation' },
      });
      expect(localUpdate).not.toHaveBeenCalled();
      expect((await saved('r1'))?.data.properties.notes).toBe('short');
    }
  );

  it('dashboard capability writable linked intermediary drawer writes only the underlying source title and property', async () => {
    const blocks = dashboardCapabilityLinkedDrawerDoc();
    const source = backendFor(blocks, 'db2');
    const local = backendFor(blocks, 'db');
    const sourceUpdate = vi.spyOn(source.adapter, 'updateRow');
    const localUpdate = vi.spyOn(local.adapter, 'updateRow');
    const current = await make(blocks, { db: { adapter: local.adapter }, db2: { adapter: source.adapter } });
    const opened = await dashboardCapabilityOpenDrawer();

    opened.title.value = 'Allowed linked intermediary title';
    opened.title.dispatchEvent(new Event('input', { bubbles: true }));
    await quiet();
    dashboardCapabilityDrawer().property.click();
    await commitDatabaseText('Allowed linked intermediary property');
    const changed = await saved('q1');

    expect({
      title: changed?.data.title,
      name: changed?.data.properties.name,
      note: changed?.data.properties.n2,
      parent: changed?.parent,
    }).toEqual({
      title: 'Allowed linked intermediary title',
      name: 'Allowed linked intermediary title',
      note: 'Allowed linked intermediary property',
      parent: 'db2',
    });
    await new Promise<void>((resolve) => { setTimeout(resolve, 650); });
    expect(source.rows.get('q1')?.properties).toEqual({
      name: 'Allowed linked intermediary title', n2: 'Allowed linked intermediary property', done: 'Source done',
    });
    expect(sourceUpdate.mock.calls.length).toBeGreaterThan(0);
    expect(sourceUpdate.mock.calls.every(([params]) => params.rowId === 'q1')).toBe(true);
    expect(localUpdate).not.toHaveBeenCalled();
    expect(local.rows.get('r1')?.properties.notes).toBe('short');
    expect((await saved('q2'))?.data.properties.n2).toBe('Second note');
    expect(current.blocks.getChildren('dashboard-capability-intermediate')).toEqual([]);
    expect(current.blocks.getChildren('dashboard-capability-definition')).toEqual([]);
    expect(dashboardCapabilityDrawer().title.readOnly).toBe(false);
    expect(dashboardCapabilityDrawer().property.getAttribute('role')).toBe('button');
    expect(dashboardWidget('foreign').querySelector('[data-blok-database-dashboard-widget-error]')).toBeNull();
    const output = await current.save();
    const definition = output.blocks.find((block) => block.id === 'dashboard-capability-definition')?.data as DatabaseData | undefined;
    const intermediate = output.blocks.find((block) => block.id === 'dashboard-capability-intermediate')?.data as DatabaseData | undefined;

    expect(definition?.source?.databaseId).toBe('db2');
    expect(definition?.views.find((entry) => entry.id === 'capability-source-v')?.dataSourceId)
      .toBe('dashboard-capability-intermediate');
    expect(intermediate?.source?.databaseId).toBe('db2');
    expect(intermediate?.activeViewId).toBe('capability-intermediate-v');
    expect(output.blocks.find((block) => block.id === 'db2')?.data.activeViewId).toBe('v');
    expect(current.blocks.getById('db2')).not.toBeNull();
  });

  it.each(['dashboard-readonly', 'definition-readonly'] as const)(
    'dashboard capability drawer refuses title and property edits opened through %s',
    async (loss) => {
      const blocks = dashboardCapabilityDoc();
      const source = backendFor(blocks, 'db2');
      const local = backendFor(blocks, 'db');
      const sourceUpdate = vi.spyOn(source.adapter, 'updateRow');
      const localUpdate = vi.spyOn(local.adapter, 'updateRow');
      const current = await make(blocks, { db: { adapter: local.adapter }, db2: { adapter: source.adapter } });

      await dashboardCapabilityRevoke(current, loss);
      const opened = await dashboardCapabilityOpenDrawer();

      opened.title.value = 'Denied readonly title';
      opened.title.dispatchEvent(new Event('input', { bubbles: true }));
      opened.property.click();
      await quiet();
      const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        '[data-blok-database-cell-editor] [data-blok-database-cell-input="text"]'
      );

      if (input !== null) {
        input.value = 'Denied readonly property';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      }
      await quiet();
      await new Promise((resolve) => { setTimeout(resolve, 650); });
      const blocked = await saved('q1');

      expect({
        title: blocked?.data.title ?? blocked?.data.properties.name,
        properties: blocked?.data.properties,
      }).toEqual({
        title: 'Existing',
        properties: { name: 'Existing', n2: 'Source note', done: 'Source done' },
      });
      expect(sourceUpdate).not.toHaveBeenCalled();
      expect(localUpdate).not.toHaveBeenCalled();
      expect(source.rows.get('q1')?.properties).toEqual({
        name: 'Existing', n2: 'Source note', done: 'Source done',
      });
      expect(opened.title.readOnly).toBe(true);
      expect(opened.property.getAttribute('role')).not.toBe('button');
      expect(input).toBeNull();
      expect(blocked?.parent).toBe('db2');
      expect(current.blocks.getChildren('dashboard-capability-definition')).toEqual([]);
      expect((await saved('r1'))?.data.properties.notes).toBe('short');
      expect(current.blocks.getById('db2')).not.toBeNull();

      await dashboardCapabilityEditSource('Standalone source after readonly peek');
      expect((await saved('q1'))?.data.properties.n2).toBe('Standalone source after readonly peek');
      await new Promise((resolve) => { setTimeout(resolve, 650); });
      expect(source.rows.get('q1')?.properties.n2).toBe('Standalone source after readonly peek');
      expect(sourceUpdate).toHaveBeenCalledWith({
        rowId: 'q1', properties: { n2: 'Standalone source after readonly peek' },
      });
      expect(localUpdate).not.toHaveBeenCalled();
    }
  );

  it.each(['dashboard-readonly', 'definition-readonly'] as const)(
    'reopens a closed denied-born drawer writable after %s is restored',
    async (loss) => {
      const current = await make(dashboardCapabilityDoc());

      await dashboardCapabilityRevoke(current, loss);
      const denied = await dashboardCapabilityOpenDrawer();
      const close = denied.drawer.querySelector<HTMLButtonElement>('[data-blok-database-drawer-close]');

      if (close === null) throw new Error('missing denied drawer close button');
      if (!denied.title.readOnly) throw new Error('denied-born drawer fixture was writable');
      close.click();
      denied.drawer.dispatchEvent(new Event('transitionend'));
      await quiet();
      const ownerId = loss === 'dashboard-readonly' ? 'db' : 'dashboard-capability-definition';
      const owner = current.blocks.getById(ownerId);

      if (owner === null) throw new Error('missing permission owner to restore');
      owner.call('dashboardCapabilitySetReadOnly', { readOnly: false });
      await quiet();
      const reopened = await dashboardCapabilityOpenDrawer();

      expect(reopened.title.readOnly).toBe(false);
      expect(reopened.property.getAttribute('role')).toBe('button');
      expect(reopened.drawer).not.toBe(denied.drawer);
      reopened.title.value = 'Title after explicit readonly close and regrant';
      reopened.title.dispatchEvent(new Event('input', { bubbles: true }));
      await quiet();
      dashboardCapabilityDrawer().property.click();
      await commitDatabaseText('Property after explicit readonly close and regrant');

      expect((await saved('q1'))?.data.properties).toEqual({
        name: 'Title after explicit readonly close and regrant',
        n2: 'Property after explicit readonly close and regrant',
        done: 'Source done',
      });
      expect((await saved('q1'))?.parent).toBe('db2');
      expect((await saved('q2'))?.data.properties.n2).toBe('Second note');
      expect((await saved('r1'))?.data.properties.notes).toBe('short');
      expect(current.blocks.getChildren('dashboard-capability-definition')).toEqual([]);
    }
  );

  it('dashboard capability writable native drawer edits the source title and property', async () => {
    const blocks = dashboardCapabilityDoc();
    const source = backendFor(blocks, 'db2');
    const local = backendFor(blocks, 'db');
    const sourceUpdate = vi.spyOn(source.adapter, 'updateRow');
    const localUpdate = vi.spyOn(local.adapter, 'updateRow');
    const current = await make(blocks, { db: { adapter: local.adapter }, db2: { adapter: source.adapter } });
    const opened = await dashboardCapabilityOpenDrawer();

    opened.title.value = 'Allowed widget title';
    opened.title.dispatchEvent(new Event('input', { bubbles: true }));
    await quiet();
    dashboardCapabilityDrawer().property.click();
    await commitDatabaseText('Allowed widget property');
    const changed = await saved('q1');

    expect({
      title: changed?.data.title,
      name: changed?.data.properties.name,
      note: changed?.data.properties.n2,
      parent: changed?.parent,
    }).toEqual({
      title: 'Allowed widget title',
      name: 'Allowed widget title',
      note: 'Allowed widget property',
      parent: 'db2',
    });
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    expect(source.rows.get('q1')?.properties).toEqual({
      name: 'Allowed widget title', n2: 'Allowed widget property', done: 'Source done',
    });
    expect(sourceUpdate.mock.calls.length).toBeGreaterThan(0);
    expect(sourceUpdate.mock.calls.every(([params]) => params.rowId === 'q1')).toBe(true);
    expect(localUpdate).not.toHaveBeenCalled();
    expect((await saved('r1'))?.data.properties.notes).toBe('short');
    expect(local.rows.get('r1')?.properties.notes).toBe('short');
    expect(current.blocks.getChildren('dashboard-capability-definition')).toEqual([]);
    expect(dashboardCapabilityDrawer().title.readOnly).toBe(false);
    expect(dashboardCapabilityDrawer().property.getAttribute('role')).toBe('button');
    const output = await current.save();

    expect(output.blocks.find((block) => block.id === 'db')?.data.activeViewId).toBe('dash');
    expect(output.blocks.find((block) => block.id === 'dashboard-capability-definition')?.data.activeViewId)
      .toBe('capability-source-v');
    expect(output.blocks.find((block) => block.id === 'db2')?.data.activeViewId).toBe('v');
    expect(current.blocks.getById('db2')).not.toBeNull();
  });

  it.each(['dashboard-readonly', 'definition-readonly', 'remove-dashboard', 'remove-widget'] as const)(
    'dashboard capability retained drawer nodes cannot write after %s',
    async (loss) => {
      const blocks = dashboardCapabilityDoc();
      const source = backendFor(blocks, 'db2');
      const local = backendFor(blocks, 'db');
      const sourceUpdate = vi.spyOn(source.adapter, 'updateRow');
      const localUpdate = vi.spyOn(local.adapter, 'updateRow');
      const current = await make(blocks, { db: { adapter: local.adapter }, db2: { adapter: source.adapter } });
      const opened = await dashboardCapabilityOpenDrawer();

      opened.property.click();
      await quiet();
      const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        '[data-blok-database-cell-editor] [data-blok-database-cell-input="text"]'
      );

      if (input === null) throw new Error('allowed source drawer did not open a property editor');
      input.value = 'Uncommitted widget drawer draft';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await dashboardCapabilityRevoke(current, loss);
      opened.title.value = 'Late revoked drawer title';
      opened.title.dispatchEvent(new Event('input', { bubbles: true }));
      input.value = 'Late revoked drawer property';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await quiet();
      await new Promise((resolve) => { setTimeout(resolve, 650); });
      const blocked = await saved('q1');

      expect({
        title: blocked?.data.title ?? blocked?.data.properties.name,
        properties: blocked?.data.properties,
      }).toEqual({
        title: 'Existing',
        properties: { name: 'Existing', n2: 'Source note', done: 'Source done' },
      });
      expect(sourceUpdate).not.toHaveBeenCalled();
      expect(localUpdate).not.toHaveBeenCalled();
      expect(source.rows.get('q1')?.properties).toEqual({
        name: 'Existing', n2: 'Source note', done: 'Source done',
      });
      // Deleting the dashboard database deletes its own rows from its backend.
      if (loss === 'remove-dashboard') expect(local.rows.has('r1')).toBe(false);
      else expect(local.rows.get('r1')?.properties.notes).toBe('short');
      expect(blocked?.parent).toBe('db2');
      expect(current.blocks.getById('db2')).not.toBeNull();
      expect(current.blocks.getChildren('db2').map((row) => row.id)).toEqual(['q1', 'q2']);
      if (loss === 'remove-dashboard') {
        expect(current.blocks.getById('db')).toBeNull();
      } else if (loss === 'remove-widget') {
        expect(holder?.querySelector(
          '[data-blok-id="db"] [data-blok-database-dashboard-widget="foreign"]'
        )).toBeNull();
        expect(dashboardWidget('twin')).toBeDefined();
      }

      await dashboardCapabilityEditSource('Surviving source after drawer loss');
      expect((await saved('q1'))?.data.properties.n2).toBe('Surviving source after drawer loss');
      await new Promise((resolve) => { setTimeout(resolve, 650); });
      expect(source.rows.get('q1')?.properties.n2).toBe('Surviving source after drawer loss');
      expect(sourceUpdate).toHaveBeenCalledWith({
        rowId: 'q1', properties: { n2: 'Surviving source after drawer loss' },
      });
      expect(localUpdate).not.toHaveBeenCalled();
    }
  );

  it.each(['dashboard-readonly', 'definition-readonly', 'remove-dashboard', 'remove-widget'] as const)(
    'dashboard capability loss %s leaves a standalone source drawer editable',
    async (loss) => {
      const blocks = dashboardCapabilityDoc();
      const source = backendFor(blocks, 'db2');
      const local = backendFor(blocks, 'db');
      const sourceUpdate = vi.spyOn(source.adapter, 'updateRow');
      const localUpdate = vi.spyOn(local.adapter, 'updateRow');
      const current = await make(blocks, { db: { adapter: local.adapter }, db2: { adapter: source.adapter } });
      const open = holder?.querySelector<HTMLButtonElement>(
        '[data-blok-id="db2"] [data-row-id="q2"] [data-blok-database-table-open]'
      );

      if (open === null || open === undefined) throw new Error('missing standalone source row-open button');
      open.click();
      await quiet();
      const opened = dashboardCapabilityDrawer();

      opened.property.click();
      await quiet();
      const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        '[data-blok-database-cell-editor] [data-blok-database-cell-input="text"]'
      );

      if (input === null) throw new Error('standalone source drawer did not open a property editor');
      input.value = 'Standalone source draft before loss';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await dashboardCapabilityRevoke(current, loss);
      opened.title.value = 'Standalone source title after loss';
      opened.title.dispatchEvent(new Event('input', { bubbles: true }));
      input.value = 'Standalone source property after loss';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await quiet();
      const changed = await saved('q2');

      expect({
        title: changed?.data.title,
        name: changed?.data.properties.name,
        note: changed?.data.properties.n2,
        parent: changed?.parent,
      }).toEqual({
        title: 'Standalone source title after loss',
        name: 'Standalone source title after loss',
        note: 'Standalone source property after loss',
        parent: 'db2',
      });
      await new Promise((resolve) => { setTimeout(resolve, 650); });
      expect(source.rows.get('q2')?.properties).toEqual({
        name: 'Standalone source title after loss',
        n2: 'Standalone source property after loss',
        done: 'Second done',
      });
      expect(sourceUpdate.mock.calls.length).toBeGreaterThan(0);
      expect(sourceUpdate.mock.calls.every(([params]) => params.rowId === 'q2')).toBe(true);
      expect(localUpdate).not.toHaveBeenCalled();
      expect((await saved('q1'))?.data.properties).toEqual({
        name: 'Existing', n2: 'Source note', done: 'Source done',
      });
      expect(source.rows.get('q1')?.properties.n2).toBe('Source note');
      // Deleting the dashboard database deletes its own rows from its backend.
      if (loss === 'remove-dashboard') expect(local.rows.has('r1')).toBe(false);
      else expect(local.rows.get('r1')?.properties.notes).toBe('short');
      expect(opened.drawer.isConnected).toBe(true);
      expect(opened.title.readOnly).toBe(false);
      expect(current.blocks.getById('db2')).not.toBeNull();
      expect(current.blocks.getChildren('db2').map((row) => row.id)).toEqual(['q1', 'q2']);
    }
  );

  describe('native widget icon popup authority', () => {
    let matchMediaDescriptor: PropertyDescriptor | undefined;

    beforeEach(() => {
      vi.clearAllMocks();
      matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: (query: string): MediaQueryList => ({
          matches: false,
          media: query,
          onchange: null,
          addListener: () => undefined,
          removeListener: () => undefined,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
        }),
      });
    });

    afterEach(() => {
      if (matchMediaDescriptor === undefined) {
        Reflect.deleteProperty(window, 'matchMedia');
      } else {
        Object.defineProperty(window, 'matchMedia', matchMediaDescriptor);
      }
      vi.restoreAllMocks();
    });

    it('allows a writable owned widget icon popup after the parent menu closes', async () => {
      const ed = await make(dashboardPopupIconDoc());
      const beforeSource = await dashboardPopupData(ed, 'db2');
      const beforeDashboard = await dashboardPopupData(ed, 'db');
      const beforeOwner = await dashboardPopupData(ed, 'view-owner');
      const control = await dashboardPopupIconControl(dashboardWidget('foreign'));

      control.commit();
      await quiet();

      const source = await dashboardPopupData(ed, 'db2');

      expect(source.schema.find((property) => property.id === 'n2')?.icon).toBeUndefined();
      expect(source.schema.map((property) => property.id === 'n2' ? { ...property, icon: undefined } : property)).toEqual(
        beforeSource.schema.map((property) => property.id === 'n2' ? { ...property, icon: undefined } : property)
      );
      expect((await dashboardPopupData(ed, 'view-owner')).schema).toEqual(beforeOwner.schema);
      expect((await dashboardPopupData(ed, 'db')).schema).toEqual(beforeDashboard.schema);
    });

    it.each(['view-owner', 'db'] as const)(
      'rejects the retained widget icon popup after only %s becomes read-only',
      async (revoked) => {
        const ed = await make(dashboardPopupIconDoc());
        const beforeSource = await dashboardPopupData(ed, 'db2');
        const control = await dashboardPopupIconControl(dashboardWidget('foreign'));

        dashboardPopupRevoke(ed, revoked);
        await quiet();
        control.commit();
        await quiet();

        expect((await dashboardPopupData(ed, 'db2')).schema).toEqual(beforeSource.schema);
        expect(control.picker.isConnected).toBe(false);
        expect(control.action.isConnected).toBe(false);
      }
    );

    it('keeps the current twin icon popup and rejects the previous opener', async () => {
      const ed = await make(dashboardPopupIconDoc(true));
      const beforeSource = await dashboardPopupData(ed, 'db2');
      const oldControl = await dashboardPopupIconControl(dashboardWidget('foreign'));
      const currentControl = await dashboardPopupIconControl(
        dashboardPopupWidget(ed, 'other-dashboard', 'other-widget')
      );

      dashboardPopupRevoke(ed, 'view-owner');
      await quiet();
      oldControl.commit();
      await quiet();

      expect((await dashboardPopupData(ed, 'db2')).schema).toEqual(beforeSource.schema);
      expect(currentControl.picker.isConnected).toBe(true);
      expect(currentControl.picker.hidden).toBe(false);
      expect(currentControl.action.isConnected).toBe(true);
      currentControl.commit();
      await quiet();
      const source = await dashboardPopupData(ed, 'db2');

      expect(source.schema.find((property) => property.id === 'n2')?.icon).toBeUndefined();
      expect(source.schema.map((property) => property.id === 'n2' ? { ...property, icon: undefined } : property)).toEqual(
        beforeSource.schema.map((property) => property.id === 'n2' ? { ...property, icon: undefined } : property)
      );
    });

    it.each(['retarget', 'remove'] as const)(
      'rejects the retained widget icon popup after its saved view is %s',
      async (transition) => {
        const ed = await make(dashboardPopupIconDoc());
        const beforeSource = await dashboardPopupData(ed, 'db2');
        const beforeOtherSource = await dashboardPopupData(ed, 'other-source');
        const ownerData = await dashboardPopupData(ed, 'view-owner');
        const control = await dashboardPopupIconControl(dashboardWidget('foreign'));
        const owner = ed.blocks.getById('view-owner');

        if (owner === null || owner === undefined) throw new Error('missing popup icon owner');
        ownerData.views = transition === 'remove'
          ? ownerData.views.filter((savedView) => savedView.id !== 'owned-v')
          : ownerData.views.map((savedView) => savedView.id === 'owned-v'
            ? { ...savedView, dataSourceId: 'other-source' }
            : savedView);
        owner.call('setData', ownerData);
        owner.dispatchChange();
        await quiet();
        control.commit();
        await quiet();

        expect((await dashboardPopupData(ed, 'db2')).schema).toEqual(beforeSource.schema);
        expect((await dashboardPopupData(ed, 'other-source')).schema).toEqual(beforeOtherSource.schema);
        expect(control.picker.isConnected).toBe(false);
        expect(control.action.isConnected).toBe(false);
      }
    );

    it.each(['change', 'Enter'] as const)(
      'rejects retained parent name %s after its icon child takes focus',
      async (eventType) => {
        const ed = await make(dashboardPopupIconDoc());
        const beforeSource = await dashboardPopupData(ed, 'db2');
        const control = await dashboardPopupIconControl(dashboardWidget('foreign'));

        control.parentInput.value = 'Late closed parent';
        if (eventType === 'change') {
          control.parentInput.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          control.parentInput.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', bubbles: true, cancelable: true,
          }));
        }
        await quiet();

        expect((await dashboardPopupData(ed, 'db2')).schema).toEqual(beforeSource.schema);
        expect(control.parentInput.isConnected).toBe(false);
        expect(control.picker.isConnected).toBe(true);
        expect(control.picker.hidden).toBe(false);
        control.commit();
        await quiet();
        const source = await dashboardPopupData(ed, 'db2');

        expect(source.schema.find((property) => property.id === 'n2')?.icon).toBeUndefined();
        expect(source.schema.map((property) => property.id === 'n2' ? { ...property, icon: undefined } : property)).toEqual(
          beforeSource.schema.map((property) => property.id === 'n2' ? { ...property, icon: undefined } : property)
        );
      }
    );
  });

  it.each(['rename', 'create'] as const)(
    'allows an owned dashboard %s popup to write only its writable source',
    async (kind) => {
      const ed = await make(dashboardPopupDoc());
      const beforeDashboard = await dashboardPopupData(ed, 'db');
      const beforeOwner = await dashboardPopupData(ed, 'view-owner');
      const control = await dashboardPopupControl(dashboardWidget('foreign'), kind);
      const name = 'Allowed widget popup';

      control.input.value = name;
      control.commit();
      await quiet();
      const source = await dashboardPopupData(ed, 'db2');

      if (kind === 'rename') {
        expect(source.schema.find((property) => property.id === 'n2')?.name).toBe(name);
      } else {
        expect(source.schema.filter((property) => property.name === name && property.type === 'text')).toHaveLength(1);
      }
      expect((await dashboardPopupData(ed, 'view-owner')).schema).toEqual(beforeOwner.schema);
      expect((await dashboardPopupData(ed, 'db')).schema).toEqual(beforeDashboard.schema);
    }
  );

  it.each([
    { kind: 'rename' as const, revoked: 'view-owner' },
    { kind: 'create' as const, revoked: 'view-owner' },
    { kind: 'rename' as const, revoked: 'db' },
    { kind: 'create' as const, revoked: 'db' },
  ])(
    'revokes the widget $kind popup after only $revoked becomes read-only',
    async ({ kind, revoked }) => {
      const ed = await make(dashboardPopupDoc());
      const beforeSource = await dashboardPopupData(ed, 'db2');
      const control = await dashboardPopupControl(dashboardWidget('foreign'), kind);

      control.input.value = 'Late widget popup';
      dashboardPopupRevoke(ed, revoked);
      await quiet();
      control.commit();
      await quiet();

      expect((await dashboardPopupData(ed, 'db2')).schema).toEqual(beforeSource.schema);
      expect(control.input.isConnected).toBe(false);
      expect(control.action.isConnected).toBe(false);

      const sourceBlock = ed.blocks.getById('db2');

      if (sourceBlock === null || sourceBlock === undefined) throw new Error('missing surviving popup source');
      const allowed = await dashboardPopupControl(sourceBlock.holder, 'create');

      allowed.input.value = 'Surviving source remains writable';
      allowed.commit();
      await quiet();
      expect((await dashboardPopupData(ed, 'db2')).schema.some(
        (property) => property.name === 'Surviving source remains writable' && property.type === 'text'
      )).toBe(true);
    }
  );

  it.each(['rename', 'create'] as const)(
    'keeps a surviving twin dashboard %s popup when the previous opener is revoked',
    async (kind) => {
      const ed = await make(dashboardPopupDoc(true));
      const oldControl = await dashboardPopupControl(dashboardWidget('foreign'), kind);

      oldControl.input.value = 'Late old popup';
      const otherWidget = dashboardPopupWidget(ed, 'other-dashboard', 'other-widget');
      const currentControl = await dashboardPopupControl(otherWidget, kind);
      const name = 'Surviving twin popup';

      currentControl.input.value = name;
      dashboardPopupRevoke(ed, 'view-owner');
      await quiet();

      expect(currentControl.input.isConnected).toBe(true);
      expect(currentControl.action.isConnected).toBe(true);
      currentControl.commit();
      await quiet();
      const source = await dashboardPopupData(ed, 'db2');

      if (kind === 'rename') {
        expect(source.schema.find((property) => property.id === 'n2')?.name).toBe(name);
      } else {
        expect(source.schema.filter((property) => property.name === name && property.type === 'text')).toHaveLength(1);
      }
      oldControl.commit();
      await quiet();
      expect((await dashboardPopupData(ed, 'db2')).schema).toEqual(source.schema);
    }
  );

  it.each([
    { kind: 'rename' as const, transition: 'retarget' },
    { kind: 'create' as const, transition: 'retarget' },
    { kind: 'rename' as const, transition: 'remove' },
    { kind: 'create' as const, transition: 'remove' },
  ])(
    'rejects the old widget $kind popup after its saved view is $transition',
    async ({ kind, transition }) => {
      const ed = await make(dashboardPopupDoc());
      const beforeSource = await dashboardPopupData(ed, 'db2');
      const beforeOtherSource = await dashboardPopupData(ed, 'other-source');
      const ownerData = await dashboardPopupData(ed, 'view-owner');
      const control = await dashboardPopupControl(dashboardWidget('foreign'), kind);
      const owner = ed.blocks.getById('view-owner');

      if (owner === null || owner === undefined) throw new Error('missing popup view owner');
      control.input.value = 'Late retired popup';
      ownerData.views = transition === 'remove'
        ? ownerData.views.filter((savedView) => savedView.id !== 'owned-v')
        : ownerData.views.map((savedView) => savedView.id === 'owned-v'
          ? { ...savedView, dataSourceId: 'other-source' }
          : savedView);
      owner.call('setData', ownerData);
      owner.dispatchChange();
      await quiet();
      control.commit();
      await quiet();

      expect((await dashboardPopupData(ed, 'db2')).schema).toEqual(beforeSource.schema);
      expect((await dashboardPopupData(ed, 'other-source')).schema).toEqual(beforeOtherSource.schema);
      expect(control.input.isConnected).toBe(false);
      expect(control.action.isConnected).toBe(false);
    }
  );

  it('moves the row, maps its values to the target schema and puts it last', async () => {
    await make(doc());

    editor?.blocks.getById('db')?.call('moveRowTo', { rowId: 'r1', databaseId: 'db2' });
    await quiet();

    const row = await saved('r1');

    expect(row?.parent).toBe('db2');
    // Title to title; same name (any case) and same type; a select by option label. Unverified against Notion.
    expect(row?.data.properties).toEqual({ name: 'Alpha', n2: 'short', s2: 'o-b2' });
    expect(row?.data.title).toBe('Alpha');
    expect((row?.data.position ?? '') > 'a5').toBe(true);
    expect(shownRows('db')).toEqual(['r2']);
    expect(shownRows('db2')).toEqual(['q1', 'r1']);
  });

  it('takes the row\'s page body along, kept hidden in the target\'s row pool', async () => {
    const withBody = doc().map((block) => (block.id === 'r1' ? { ...block, content: ['b1'] } : block));

    await make([...withBody, { id: 'b1', type: 'paragraph', parent: 'r1', data: { text: 'body' } }]);
    editor?.blocks.getById('db')?.call('moveRowTo', { rowId: 'r1', databaseId: 'db2' });
    await quiet();

    const all = (await editor?.save())?.blocks ?? [];
    const rowHolder = holder?.querySelector('[data-blok-element][data-blok-id="r1"]');

    expect(all.find((block) => block.id === 'b1')?.parent).toBe('r1');
    expect(all.find((block) => block.id === 'r1')?.parent).toBe('db2');
    expect(poolOf('r1')).toBe('db2');
    expect(rowHolder?.classList.contains('hidden')).toBe(true);
  });

  it.each([
    ['a column', (db2: OutputBlockData[]): OutputBlockData[] => [
      { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
      { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['db2'] },
      { ...db2[0], parent: 'c1' },
      ...db2.slice(1),
      { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['pc'] },
      { id: 'pc', type: 'paragraph', data: { text: 'side' }, parent: 'c2' },
    ]],
    ['tabs', (db2: OutputBlockData[]): OutputBlockData[] => [
      { id: 'tb', type: 'tabs', data: {}, content: ['t1'] },
      { id: 't1', type: 'tab', data: { title: 'One' }, parent: 'tb', content: ['db2'] },
      { ...db2[0], parent: 't1' },
      ...db2.slice(1),
    ]],
  ])('into a database inside %s: the row moves whole, or nothing changes', async (_where, wrap) => {
    const all = doc();
    const source = all.slice(0, 3);
    const target = all.slice(3);

    await make([...source, ...wrap(target)]);
    editor?.blocks.getById('db')?.call('moveRowTo', { rowId: 'r1', databaseId: 'db2' });
    await quiet();

    const row = await saved('r1');

    expect(row?.parent === 'db2'
      ? row.data.properties
      : row?.data.properties).toEqual(row?.parent === 'db2'
      ? { name: 'Alpha', n2: 'short', s2: 'o-b2' }
      : { t: 'Alpha', notes: 'short', amount: 12, stage: 'o-build', done: true });
    expect(row?.parent).toBe('db2');
  });

  it('is one undo step, and redo moves it again', async () => {
    await make(doc());

    editor?.blocks.getById('db')?.call('moveRowTo', { rowId: 'r1', databaseId: 'db2' });
    await quiet();
    editor?.history.undo();
    await quiet();

    const back = await saved('r1');

    expect(back?.parent).toBe('db');
    expect(back?.data.properties).toEqual({ t: 'Alpha', notes: 'short', amount: 12, stage: 'o-build', done: true });
    expect(back?.data.position).toBe('a0');
    expect(shownRows('db')).toEqual(['r1', 'r2']);
    expect(shownRows('db2')).toEqual(['q1']);
    expect(poolOf('r1')).toBe('db');

    editor?.history.redo();
    await quiet();

    expect((await saved('r1'))?.parent).toBe('db2');
    expect(shownRows('db2')).toEqual(['q1', 'r1']);
    expect(poolOf('r1')).toBe('db2');
  });

  it('checks destination editContent before moving or remapping a row', async () => {
    await make(doc(), {
      db2: { permissions: { can: (action) => action !== 'editContent' } },
    });
    const before = await saved('r1');

    editor?.blocks.getById('db')?.call('moveRowTo', { rowId: 'r1', databaseId: 'db2' });
    await quiet();

    expect(await saved('r1')).toEqual(before);
    expect(shownRows('db')).toEqual(['r1', 'r2']);
    expect(shownRows('db2')).toEqual(['q1']);
    expect(poolOf('r1')).toBe('db');
  });

  it.each(['source-first', 'linked-first'] as const)('keeps allowed linked-view cell editing when boot order is %s', async (order) => {
    const linked: OutputBlockData = {
      id: 'linked',
      type: 'database',
      data: {
        source: { databaseId: 'db' },
        schema: [{ id: 'stub', name: 'Name', type: 'title', position: 'a0' }],
        views: [{ ...view, id: 'linked-v', visibleProperties: ['notes'] }],
        activeViewId: 'linked-v',
      },
    };

    await make(order === 'source-first' ? [...doc(), linked] : [linked, ...doc()]);
    const cell = holder?.querySelector<HTMLElement>('[data-blok-id="linked"] [data-row-id="r1"] [role="gridcell"][data-property-id="notes"]');

    if (cell === null || cell === undefined) throw new Error('missing allowed linked text cell');
    cell.click();
    await quiet();
    const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-blok-database-cell-input="text"]');

    expect(input).not.toBeNull();
    if (input === null) throw new Error('allowed linked text cell did not open an editor');
    input.value = 'allowed edit';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await quiet();

    expect((await saved('r1'))?.data.properties.notes).toBe('allowed edit');
    expect(holder?.querySelector<HTMLElement>('[data-blok-id="linked"] [data-row-id="r1"] [role="gridcell"][data-property-id="notes"]')?.textContent).toContain('allowed edit');
    expect(editor?.blocks.getChildren('linked')).toEqual([]);
    expect(poolOf('r1')).toBe('db');
  });

  it.each(['source-first', 'linked-first'] as const)('keeps allowed linked row dispatch when boot order is %s', async (order) => {
    const linked: OutputBlockData = {
      id: 'linked',
      type: 'database',
      data: {
        source: { databaseId: 'db' },
        schema: [{ id: 'stub', name: 'Name', type: 'title', position: 'a0' }],
        views: [view],
        activeViewId: 'v',
      },
    };
    let acknowledged = false;

    await make(order === 'source-first' ? [...doc(), linked] : [linked, ...doc()]);
    editor?.blocks.getById('linked')?.call('writeRelatedRow', {
      rowId: 'r1',
      changes: { notes: 'allowed dispatch' },
      done: () => { acknowledged = true; },
    });
    await quiet();

    expect((await saved('r1'))?.data.properties.notes).toBe('allowed dispatch');
    expect(acknowledged).toBe(true);
    expect(editor?.blocks.getChildren('linked')).toEqual([]);
  });

  it.each(['source-first', 'linked-first'] as const)('can add the first row through an allowed empty linked source with boot order %s', async (order) => {
    const linked: OutputBlockData = {
      id: 'linked',
      type: 'database',
      data: {
        source: { databaseId: 'db' },
        schema: [{ id: 'stub', name: 'Name', type: 'title', position: 'a0' }],
        views: [{ ...view, id: 'linked-v', visibleProperties: ['notes'] }],
        activeViewId: 'linked-v',
      },
    };
    const source = doc().filter((block) => block.parent !== 'db')
      .map((block) => block.id === 'db' ? { ...block, content: [] } : block);

    await make(order === 'source-first' ? [...source, linked] : [linked, ...source]);
    const add = holder?.querySelector<HTMLButtonElement>('[data-blok-id="linked"] [data-blok-database-table-add-row]');

    expect(add).not.toBeNull();
    expect(add).not.toBeUndefined();
    if (add === null || add === undefined) throw new Error('allowed empty linked source has no add-row button');
    add.click();
    await quiet();

    expect(editor?.blocks.getChildren('db').filter((block) => block.name === 'database-row')).toHaveLength(1);
    expect(editor?.blocks.getChildren('linked')).toEqual([]);
  });

  it('resolves cyclic linked-source permission without a caught exception', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await make([
      {
        id: 'linked-a',
        type: 'database',
        data: {
          source: { databaseId: 'linked-b' },
          schema: [{ id: 'a-title', name: 'Name', type: 'title', position: 'a0' }],
          views: [view],
          activeViewId: 'v',
        },
      },
      {
        id: 'linked-b',
        type: 'database',
        data: {
          source: { databaseId: 'linked-a' },
          schema: [{ id: 'b-title', name: 'Name', type: 'title', position: 'a0' }],
          views: [view],
          activeViewId: 'v',
        },
      },
    ]);
    const allowed: boolean[] = [];

    editor?.blocks.getById('linked-a')?.call('readRowWritePermission', {
      receive: (value: boolean): void => { allowed.push(value); },
    });

    expect(errors.mock.calls.flatMap(([message]) =>
      typeof message === 'string' && message.includes("Error during 'readRowWritePermission' call:") ? [message] : [])).toEqual([]);
    expect(allowed).toEqual([false]);
    expect(holder?.querySelectorAll('[data-blok-tool="database"]')).toHaveLength(2);
  });

  it('keeps both cyclic linked-source tools rendered after boot', async () => {
    await make([
      {
        id: 'linked-a',
        type: 'database',
        data: {
          source: { databaseId: 'linked-b' },
          schema: [{ id: 'a-title', name: 'Name', type: 'title', position: 'a0' }],
          views: [view],
          activeViewId: 'v',
        },
      },
      {
        id: 'linked-b',
        type: 'database',
        data: {
          source: { databaseId: 'linked-a' },
          schema: [{ id: 'b-title', name: 'Name', type: 'title', position: 'a0' }],
          views: [view],
          activeViewId: 'v',
        },
      },
    ]);

    expect(holder?.querySelectorAll('[data-blok-tool="database"]')).toHaveLength(2);
    expect((await editor?.save())?.blocks.map((block) => ({ id: block.id, type: block.type, source: block.data.source }))).toEqual([
      { id: 'linked-a', type: 'database', source: { databaseId: 'linked-b' } },
      { id: 'linked-b', type: 'database', source: { databaseId: 'linked-a' } },
    ]);
  });

  it('does not let an editable linked database write a source that denies editContent', async () => {
    await make([
      ...doc(),
      {
        id: 'linked',
        type: 'database',
        data: { source: { databaseId: 'db' }, schema: [{ id: 'stub', name: 'Name', type: 'title', position: 'a0' }], views: [view], activeViewId: 'v' },
      },
    ], { db: { permissions: { can: (action) => action !== 'editContent' } } });

    editor?.blocks.getById('linked')?.call('writeRelatedRow', { rowId: 'r1', changes: { notes: 'forbidden' } });
    await quiet();

    expect((await saved('r1'))?.data.properties.notes).toBe('short');
  });

  it('leaves the forward relation unchanged when its inverse owner denies editContent', async () => {
    const blocks = doc();
    const relation: PropertyDefinition = { id: 'related', name: 'Related', type: 'relation', position: 'a5', relation: { targetDatabaseId: 'db2', twoWay: true, syncedPropertyId: 'back' } };
    const inverse: PropertyDefinition = { id: 'back', name: 'Back', type: 'relation', position: 'a4', relation: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'related' } };

    blocks[0] = { ...blocks[0], data: { ...blocks[0].data, schema: [...(blocks[0].data as DatabaseData).schema, relation], views: [{ ...view, visibleProperties: ['related'] }] } };
    blocks[1] = { ...blocks[1], data: { ...blocks[1].data, properties: { t: 'Alpha', related: [] } } };
    blocks[3] = { ...blocks[3], data: { ...blocks[3].data, schema: [...(blocks[3].data as DatabaseData).schema, inverse] } };
    blocks[4] = { ...blocks[4], data: { properties: { name: 'Existing', back: [] }, position: 'a5' } };
    await make(blocks, { db2: { permissions: { can: (action) => action !== 'editContent' } } });
    const cell = holder?.querySelector<HTMLElement>('[data-blok-id="db"] [data-row-id="r1"] [role="gridcell"][data-property-id="related"]');

    if (cell === null || cell === undefined) throw new Error('missing relation cell');
    cell.click();
    await quiet();
    const option = document.querySelector<HTMLElement>('[data-blok-database-relation-option="q1"]');

    if (option === null) throw new Error('missing related row option');
    option.click();
    await quiet();

    expect((await saved('r1'))?.data.properties.related).toEqual([]);
    expect((await saved('q1'))?.data.properties.back).toEqual([]);
  });

  it('does not let linked-view cell editing bypass source editContent', async () => {
    await make([
      ...doc(),
      {
        id: 'linked',
        type: 'database',
        data: {
          source: { databaseId: 'db' },
          schema: [{ id: 'stub', name: 'Name', type: 'title', position: 'a0' }],
          views: [{ ...view, id: 'linked-v', visibleProperties: ['notes'] }],
          activeViewId: 'linked-v',
        },
      },
    ], { db: { permissions: { can: (action) => action !== 'editContent' } } });
    const cell = holder?.querySelector<HTMLElement>('[data-blok-id="linked"] [data-row-id="r1"] [role="gridcell"][data-property-id="notes"]');

    if (cell === null || cell === undefined) throw new Error('missing linked text cell');
    cell.click();
    await quiet();
    const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-blok-database-cell-input="text"]');

    if (input !== null) {
      input.value = 'forbidden';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await quiet();
    }

    expect((await saved('r1'))?.data.properties.notes).toBe('short');
    expect(cell.textContent).toContain('short');
  });

  it('does not fall back to a direct inverse write after the target denies editContent', async () => {
    const blocks = doc();
    const relation: PropertyDefinition = { id: 'related', name: 'Related', type: 'relation', position: 'a5', relation: { targetDatabaseId: 'db2', twoWay: true, syncedPropertyId: 'back' } };
    const inverse: PropertyDefinition = { id: 'back', name: 'Back', type: 'relation', position: 'a4', relation: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'related' } };

    blocks[0] = { ...blocks[0], data: { ...blocks[0].data, schema: [...(blocks[0].data as DatabaseData).schema, relation], views: [{ ...view, visibleProperties: ['related'] }] } };
    blocks[3] = { ...blocks[3], data: { ...blocks[3].data, schema: [...(blocks[3].data as DatabaseData).schema, inverse] } };
    blocks[4] = { ...blocks[4], data: { properties: { name: 'Existing', back: [] }, position: 'a5' } };
    await make(blocks, { db2: { permissions: { can: (action) => action !== 'editContent' } } });

    const cell = holder?.querySelector<HTMLElement>('[data-blok-id="db"] [data-row-id="r1"] [role="gridcell"][data-property-id="related"]');

    if (cell === null || cell === undefined) throw new Error('missing relation cell');
    cell.click();
    await quiet();
    const option = document.querySelector<HTMLElement>('[data-blok-database-relation-option="q1"]');

    if (option === null) throw new Error('missing related row option');
    option.click();
    await quiet();

    expect((await saved('q1'))?.data.properties.back).toEqual([]);
  });

  it('moves the complete sub-item family and rekeys its self-relations to the destination', async () => {
    const blocks = doc();
    const pair = (databaseId: string, parent: string, children: string): PropertyDefinition[] => [
      { id: parent, name: 'Parent item', type: 'relation', position: 'a1', relation: { targetDatabaseId: databaseId, twoWay: true, syncedPropertyId: children, limit: 1, role: 'parentItem' } },
      { id: children, name: 'Sub-items', type: 'relation', position: 'a2', relation: { targetDatabaseId: databaseId, twoWay: true, syncedPropertyId: parent, role: 'subItems' } },
    ];

    blocks[0] = { ...blocks[0], data: { ...blocks[0].data, schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }, ...pair('db', 'parent', 'children')] } };
    blocks[1] = { ...blocks[1], data: { properties: { t: 'Alpha', parent: [], children: [{ id: 'r2' }] }, position: 'a0' } };
    blocks[2] = { ...blocks[2], data: { properties: { t: 'Bravo', parent: [{ id: 'r1' }], children: [] }, position: 'a1' } };
    blocks[3] = { ...blocks[3], data: { ...blocks[3].data, schema: [{ id: 'name', name: 'Project', type: 'title', position: 'a0' }, ...pair('db2', 'parent2', 'children2')] } };
    await make(blocks);

    editor?.blocks.getById('db')?.call('moveRowTo', { rowId: 'r1', databaseId: 'db2' });
    await quiet();

    expect((await saved('r2'))?.parent).toBe('db2');
    expect((await saved('r2'))?.data.properties.parent2).toEqual([{ id: 'r1' }]);
    expect((await saved('r1'))?.data.properties.children2).toEqual([{ id: 'r2' }]);
    expect(shownRows('db')).toEqual([]);
    editor?.history.undo();
    await quiet();

    expect((await saved('r1'))?.parent).toBe('db');
    expect((await saved('r2'))?.parent).toBe('db');
    expect((await saved('r1'))?.data.properties.children).toEqual([{ id: 'r2' }]);
  });

  it('transfers a moved row from the old two-way inverse to the destination inverse', async () => {
    const blocks = doc();
    const relation: PropertyDefinition = { id: 'related', name: 'Related', type: 'relation', position: 'a5', relation: { targetDatabaseId: 'db3', twoWay: true, syncedPropertyId: 'backSource' } };
    const mapped: PropertyDefinition = { id: 'related2', name: 'Related', type: 'relation', position: 'a4', relation: { targetDatabaseId: 'db3', twoWay: true, syncedPropertyId: 'backTarget' } };

    blocks[0] = { ...blocks[0], data: { ...blocks[0].data, schema: [...(blocks[0].data as DatabaseData).schema, relation] } };
    blocks[1] = { ...blocks[1], data: { ...blocks[1].data, properties: { t: 'Alpha', related: [{ id: 'z' }] } } };
    blocks[3] = { ...blocks[3], data: { ...blocks[3].data, schema: [...(blocks[3].data as DatabaseData).schema, mapped] } };
    blocks.push(
      {
        id: 'db3',
        type: 'database',
        content: ['z'],
        data: {
          schema: [
            { id: 'title', name: 'Name', type: 'title', position: 'a0' },
            { id: 'backSource', name: 'Tasks', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'db', twoWay: true, syncedPropertyId: 'related' } },
            { id: 'backTarget', name: 'Projects', type: 'relation', position: 'a2', relation: { targetDatabaseId: 'db2', twoWay: true, syncedPropertyId: 'related2' } },
          ],
          views: [view],
          activeViewId: 'v',
        },
      },
      { id: 'z', type: 'database-row', parent: 'db3', data: { properties: { title: 'Linked', backSource: [{ id: 'r1' }], backTarget: [] }, position: 'a0' } },
    );
    await make(blocks);
    editor?.blocks.getById('db')?.call('moveRowTo', { rowId: 'r1', databaseId: 'db2' });
    await quiet();

    expect((await saved('z'))?.data.properties.backTarget).toEqual([{ id: 'r1' }]);
    expect((await saved('z'))?.data.properties.backSource).toEqual([]);
    expect((await saved('r1'))?.data.properties.related2).toEqual([{ id: 'z' }]);
    editor?.history.undo();
    await quiet();

    expect((await saved('z'))?.data.properties.backSource).toEqual([{ id: 'r1' }]);
    expect((await saved('z'))?.data.properties.backTarget).toEqual([]);
  });

  it('persists Move to undo while the forward adapter delete is still in flight', async () => {
    const blocks = doc();
    const source = backendFor(blocks, 'db');
    const target = backendFor(blocks, 'db2');
    let releaseDelete: (() => void) | undefined;
    let markDeleteStarted: (() => void) | undefined;
    const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve; });
    const deleteStarted = new Promise<void>((resolve) => { markDeleteStarted = resolve; });
    const deleteRow = source.adapter.deleteRow;

    source.adapter.deleteRow = async (params) => {
      markDeleteStarted?.();
      await deleteGate;
      await deleteRow(params);
    };
    await make(blocks, { db: { adapter: source.adapter }, db2: { adapter: target.adapter } });
    editor?.blocks.getById('db')?.call('moveRowTo', { rowId: 'r1', databaseId: 'db2' });
    await deleteStarted;
    await quiet();
    editor?.history.undo();
    await quiet();

    if (releaseDelete === undefined) throw new Error('delete gate was not initialized');
    releaseDelete();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect(source.rows.get('r1')?.properties).toEqual({ t: 'Alpha', notes: 'short', amount: 12, stage: 'o-build', done: true });
    expect(target.rows.has('r1')).toBe(false);
    expect((await saved('r1'))?.parent).toBe('db');
  });

  it('does not persist peer row edits, additions or removals to the database adapter', async () => {
    const blocks = doc();
    const backend = backendFor(blocks, 'db');
    const create = vi.spyOn(backend.adapter, 'createRow');
    const update = vi.spyOn(backend.adapter, 'updateRow');
    const remove = vi.spyOn(backend.adapter, 'deleteRow');
    const peer = new DocumentStore(new YBlockSerializer());
    const sockets: PeerSocket[] = [];
    const originalSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');

    class PeerSocket {
      binaryType = 'blob';
      readyState = 0;
      protocol = '';
      onopen: ((event: unknown) => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onclose: ((event: { code: number; reason: string }) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      readonly sent: Uint8Array[] = [];

      constructor() {
        sockets.push(this);
      }

      send(data: ArrayBufferLike | ArrayBufferView): void {
        const bytes = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);

        this.sent.push(new Uint8Array(bytes));
      }

      close(): void {
        this.readyState = 3;
      }

      open(): void {
        this.protocol = 'blok-sync.v1';
        this.readyState = 1;
        this.onopen?.({});
      }

      deliver(frame: SyncWireFrame): void {
        this.onmessage?.({ data: encode(frame) });
      }
    }

    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: PeerSocket });
    try {
      peer.fromJSON(blocks);
      await make([], { db: { adapter: backend.adapter } }, {
        server: 'https://sync.test/api/',
        collaboration: { doc: 'database-replay-peer-control' },
      });
      const socket = sockets.at(-1);

      if (socket === undefined) throw new Error('collaboration opened no socket');
      socket.open();
      socket.deliver({
        type: 'control',
        tag: { format: 2, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' },
      });
      socket.deliver({ type: 'syncStep2', update: peer.encodeStateAsUpdate() });
      await vi.waitFor(() => {
        expect(editor?.blocks.getChildren('db').map((block) => block.id)).toEqual(['r1', 'r2']);
      });
      await vi.waitFor(() => {
        expect(editor?.readOnly.isEnabled).toBe(false);
      });
      await quiet();

      peer.updateBlockData('r1', 'properties', {
        t: 'Alpha', notes: 'peer edit', amount: 12, stage: 'o-build', done: true,
      });
      socket.deliver({ type: 'update', update: peer.encodeStateAsUpdate() });
      await vi.waitFor(async () => {
        expect((await saved('r1'))?.data.properties.notes).toBe('peer edit');
      });

      peer.addBlockAt({
        id: 'remote-row',
        type: 'database-row',
        data: { properties: { t: 'Peer row' }, position: 'a2' },
      }, { parentId: 'db', afterId: 'r2' });
      socket.deliver({ type: 'update', update: peer.encodeStateAsUpdate() });
      await vi.waitFor(() => {
        expect(editor?.blocks.getById('remote-row')?.parentId).toBe('db');
      });

      peer.removeBlock('r2');
      socket.deliver({ type: 'update', update: peer.encodeStateAsUpdate() });
      await vi.waitFor(() => {
        expect(editor?.blocks.getById('r2')).toBeNull();
      });
      await quiet();
      await new Promise((resolve) => { setTimeout(resolve, 650); });

      expect({ creates: create.mock.calls.length, updates: update.mock.calls.length, deletes: remove.mock.calls.length })
        .toEqual({ creates: 0, updates: 0, deletes: 0 });
      expect((await saved('r1'))?.data.properties.notes).toBe('peer edit');
      expect((await saved('remote-row'))?.parent).toBe('db');
      expect(await saved('r2')).toBeUndefined();
      expect(backend.rows.get('r1')?.properties.notes).toBe('short');
      expect(backend.rows.has('remote-row')).toBe(false);
      expect(backend.rows.has('r2')).toBe(true);
    } finally {
      editor?.destroy();
      editor = undefined;
      peer.destroy();
      if (originalSocket === undefined) {
        Reflect.deleteProperty(globalThis, 'WebSocket');
      } else {
        Object.defineProperty(globalThis, 'WebSocket', originalSocket);
      }
    }
  });

  it('persists an automation-created row once while a board title input stays focused', async () => {
    const blocks = doc();

    blocks[0] = { ...blocks[0], data: { ...blocks[0].data, views: [{ ...view, type: 'board', groupBy: 'stage' }] } };
    const backend = backendFor(blocks, 'db');
    const create = vi.spyOn(backend.adapter, 'createRow');
    const contexts: DatabaseAutomationContext[] = [];

    await make(blocks, { db: {
      adapter: backend.adapter,
      automations: { onTrigger: (_trigger, context) => { contexts.push(context); } },
    } });
    editor?.blocks.getById('db')?.call('writeRelatedRow', { rowId: 'r1', changes: { notes: 'local edit' } });
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    const context = contexts.at(-1);

    if (context === undefined) throw new Error('local edit produced no automation context');
    const edit = holder?.querySelector<HTMLButtonElement>('[data-blok-id="db"] [data-row-id="r1"] [data-blok-database-edit-card]');

    if (edit === null || edit === undefined) throw new Error('missing board title edit button');
    edit.click();
    await quiet();
    const input = holder?.querySelector<HTMLInputElement>('[data-blok-id="db"] [data-row-id="r1"] [data-blok-database-card-title-input]');

    if (input === null || input === undefined) throw new Error('board title edit did not open an input');
    const hadFocus = document.activeElement === input;
    const accepted = context.run({ type: 'addPage', properties: { t: 'Automation row', stage: 'o-build' } });

    await quiet();
    const added = (await editor?.save())?.blocks.filter((block) =>
      block.parent === 'db' && !['r1', 'r2'].includes(block.id ?? ''));

    expect(create).toHaveBeenCalledTimes(1);
    expect(hadFocus).toBe(true);
    expect(accepted).toBe(true);
    expect(added).toHaveLength(1);
    expect(added?.[0]?.data.properties).toEqual(expect.objectContaining({ t: 'Automation row', stage: 'o-build' }));
    expect(backend.rows.get(added?.[0]?.id ?? '')?.properties.t).toBe('Automation row');
  });

  describe('Transaction replay channel with a real editor', () => {
    let peer: DocumentStore;
    let sockets: CaptureSocket[];
    let originalSocket: PropertyDescriptor | undefined;

    class CaptureSocket {
      binaryType = 'blob';
      readyState = 0;
      protocol = '';
      onopen: ((event: unknown) => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onclose: ((event: { code: number; reason: string }) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;

      constructor() {
        sockets.push(this);
      }

      send(_data: ArrayBufferLike | ArrayBufferView): void {}

      close(): void {
        this.readyState = 3;
      }

      open(): void {
        this.protocol = 'blok-sync.v1';
        this.readyState = 1;
        this.onopen?.({});
      }

      deliver(frame: SyncWireFrame): void {
        this.onmessage?.({ data: encode(frame) });
      }
    }

    const start = async (
      blocks: OutputBlockData[],
      customTools: NonNullable<BlokConfig['tools']> = {}
    ): Promise<{ current: TestEditor; socket: CaptureSocket }> => {
      peer.fromJSON(blocks);
      const current = await make([], {}, {
        server: 'https://sync.test/api/',
        collaboration: { doc: 'transaction-replay-capture-channel' },
      }, customTools);
      const socket = sockets.at(-1);

      if (socket === undefined) throw new Error('collaboration opened no socket');
      socket.open();
      socket.deliver({
        type: 'control',
        tag: { format: 2, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' },
      });
      socket.deliver({ type: 'syncStep2', update: peer.encodeStateAsUpdate() });
      await vi.waitFor(() => {
        for (const block of blocks) {
          if (block.id !== undefined) expect(current.blocks.getById(block.id)).not.toBeNull();
        }
        expect(current.readOnly.isEnabled).toBe(false);
      }, { timeout: 3000 });
      await quiet();

      return { current, socket };
    };
    const orderedChanges = (record: unknown): unknown => {
      if (typeof record !== 'object' || record === null || !('changes' in record)) return record;
      const changes: unknown = record.changes;

      if (!Array.isArray(changes)) return record;
      return {
        ...record,
        changes: [...changes].sort((left: unknown, right: unknown) => {
          const pathOf = (change: unknown): string => typeof change === 'object' && change !== null &&
            'path' in change ? JSON.stringify(change.path) : '';

          return pathOf(left).localeCompare(pathOf(right));
        }),
      };
    };
    const isRecordFor = (payload: unknown, id: string): payload is {
      blockId: string; type: unknown; origin: unknown;
    } => typeof payload === 'object' && payload !== null &&
      'blockId' in payload && payload.blockId === id && 'type' in payload && 'origin' in payload;
    const rowIdentity = (template?: boolean) => ({
      type: 'database-row',
      parent: { present: true, value: 'db' },
      template: template === undefined ? { present: false } : { present: true, value: template },
    });

    beforeEach(() => {
      vi.clearAllMocks();
      peer = new DocumentStore(new YBlockSerializer());
      sockets = [];
      originalSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
      Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: CaptureSocket });
    });

    afterEach(() => {
      editor?.destroy();
      editor = undefined;
      peer.destroy();
      if (originalSocket === undefined) {
        Reflect.deleteProperty(globalThis, 'WebSocket');
      } else {
        Object.defineProperty(globalThis, 'WebSocket', originalSocket);
      }
      vi.restoreAllMocks();
    });

    it.each(['history-first', 'peer-first'] as const)(
      'delivers both same-row transaction records outside host notification dedup (%s)',
      async (arrival) => {
        const { current, socket } = await start(doc());
        const captures: unknown[] = [];
        const publicChanges: unknown[] = [];
        const hostChanges: unknown[] = [];
        const onReplay = (payload?: unknown): void => {
          if (isRecordFor(payload, 'r1')) captures.push(payload);
        };
        const recordChange = (event: unknown, received: unknown[]): void => {
          if (!(event instanceof CustomEvent) || event.type !== 'block-changed') return;
          const detail: unknown = event.detail;

          if (typeof detail !== 'object' || detail === null || !('target' in detail)) return;
          const target = detail.target;

          if (typeof target === 'object' && target !== null && 'id' in target && target.id === 'r1') {
            received.push(detail);
          }
        };
        const onPublicChange = (payload?: unknown): void => {
          if (typeof payload === 'object' && payload !== null && 'event' in payload) {
            recordChange(payload.event, publicChanges);
          }
        };
        const onChange: NonNullable<BlokConfig['onChange']> = (_api, changes) => {
          for (const change of Array.isArray(changes) ? changes : [changes]) recordChange(change, hostChanges);
        };

        current.events.on('block replayed', onReplay);
        current.events.on('block changed', onPublicChange);
        current.handlers.set({ onChange });
        try {
          current.blocks.getById('db')?.call('writeRelatedRow', { rowId: 'r1', changes: { notes: 'local edit' } });
          await quiet();
          await new Promise((resolve) => { setTimeout(resolve, 650); });
          captures.length = 0;
          publicChanges.length = 0;
          hostChanges.length = 0;
          peer.updateBlockData('r1', 'properties', { t: 'Alpha', notes: 'short', amount: 99, stage: 'o-build', done: true });
          const applyPeer = (): void => {
            socket.deliver({ type: 'update', update: peer.encodeStateAsUpdate() });
          };

          if (arrival === 'history-first') {
            current.history.undo();
            applyPeer();
          } else {
            applyPeer();
            current.history.undo();
          }

          expect(captures).toEqual(arrival === 'history-first' ? [
            {
              blockId: 'r1', type: 'update', origin: 'undo', scope: 'keys', native: rowIdentity(),
              changes: [{ path: ['properties', 'notes'], beforePresent: true, afterPresent: true, after: 'short' }],
            },
            {
              blockId: 'r1', type: 'update', origin: 'remote', scope: 'keys', native: rowIdentity(),
              changes: [{ path: ['properties', 'amount'], beforePresent: true, afterPresent: true, after: 99 }],
            },
          ] : [
            {
              blockId: 'r1', type: 'update', origin: 'remote', scope: 'keys', native: rowIdentity(),
              changes: [{ path: ['properties', 'amount'], beforePresent: true, afterPresent: true, after: 99 }],
            },
            {
              blockId: 'r1', type: 'update', origin: 'undo', scope: 'keys', native: rowIdentity(),
              changes: [{ path: ['properties', 'notes'], beforePresent: true, afterPresent: true, after: 'short' }],
            },
          ]);
          await quiet();
          await new Promise((resolve) => { setTimeout(resolve, 650); });
          expect(publicChanges).toHaveLength(1);
          expect(hostChanges).toHaveLength(1);
          expect((await saved('r1'))?.data.properties).toMatchObject({ notes: 'short', amount: 99 });
        } finally {
          current.events.off('block replayed', onReplay);
          current.events.off('block changed', onPublicChange);
          current.handlers.set({ onChange: undefined });
        }
      },
    );

    it.each([
      { label: 'throwing listener', shouldThrow: true },
      { label: 'nonthrowing listener', shouldThrow: false },
    ])('public replay listener failure keeps remote paragraph text visible ($label)', async ({ shouldThrow }) => {
      const blockId = 'listener-throw-text';
      const { current, socket } = await start([
        { id: blockId, type: 'paragraph', data: { text: 'Before remote text' } },
      ]);
      const selector = '[data-blok-id="' + blockId + '"] [data-blok-tool="paragraph"]';
      const initial = holder?.querySelector<HTMLElement>(selector);

      if (initial === null || initial === undefined || initial.textContent !== 'Before remote text') {
        throw new Error('native paragraph fixture did not render its initial text');
      }

      const failure = new Error('expected public replay listener failure');
      const first: unknown[] = [];
      const later: unknown[] = [];
      const onFirst = (payload?: unknown): void => {
        if (!isRecordFor(payload, blockId) || payload.origin !== 'remote') return;
        first.push(payload);
        if (shouldThrow) throw failure;
      };
      const onLater = (payload?: unknown): void => {
        if (isRecordFor(payload, blockId) && payload.origin === 'remote') later.push(payload);
      };

      current.events.on('block replayed', onFirst);
      current.events.on('block replayed', onLater);
      try {
        peer.updateBlockData(blockId, 'text', 'After remote text');
        socket.deliver({ type: 'update', update: peer.encodeStateAsUpdate() });

        await vi.waitFor(() => {
          expect(holder?.querySelector<HTMLElement>(selector)?.textContent).toBe('After remote text');
        }, { timeout: 3000 });
        expect(first).toHaveLength(1);
        expect(later).toHaveLength(1);
        expect(later[0]).toBe(first[0]);
        expect(later[0]).toMatchObject({ blockId, type: 'update', origin: 'remote' });
      } finally {
        current.events.off('block replayed', onFirst);
        current.events.off('block replayed', onLater);
      }
    });

    it('public replay listener failure leaves ordinary custom event reducers and synchronous throws unchanged', async () => {
      const current = await make(doc());
      const eventName = 'capture-listener-throw-control';
      const replacement = { value: 'replacement' };
      const failure = new Error('expected ordinary custom event failure');
      const received: unknown[] = [];
      const later: unknown[] = [];
      const onFirst = (): { value: string } => replacement;
      const onThrow = (payload?: unknown): void => {
        received.push(payload);
        throw failure;
      };
      const onLater = (payload?: unknown): void => { later.push(payload); };

      current.events.on(eventName, onFirst);
      current.events.on(eventName, onThrow);
      current.events.on(eventName, onLater);
      try {
        let thrown: unknown;

        try {
          current.events.emit(eventName, { value: 'original' });
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBe(failure);
        expect(received).toEqual([replacement]);
        expect(received[0]).toBe(replacement);
        expect(later).toEqual([]);

        current.events.off(eventName, onThrow);
        current.events.emit(eventName, { value: 'original again' });

        expect(later).toEqual([replacement]);
        expect(later[0]).toBe(replacement);
      } finally {
        current.events.off(eventName, onFirst);
        current.events.off(eventName, onThrow);
        current.events.off(eventName, onLater);
      }
    });

    it.each([true, false])(
      'delivers the retained capture to an async listener and the next listener before setData resolves (%s)',
      async (accepted) => {
        let releaseSetter: (() => void) | undefined;
        let releaseListener: (() => void) | undefined;
        const setterGate = new Promise<void>((resolve) => { releaseSetter = resolve; });
        const listenerGate = new Promise<void>((resolve) => { releaseListener = resolve; });
        let setterStarted = false;
        const first: unknown[] = [];
        const second: unknown[] = [];
        const afterAwait: unknown[] = [];

        class AwaitedCapture {
          public static isReadOnlySupported = true;
          private readonly element: HTMLDivElement;

          constructor({ data, readOnly }: BlockToolConstructorOptions<{ value: string }>) {
            this.element = document.createElement('div');
            this.element.setAttribute('contenteditable', readOnly ? 'false' : 'true');
            this.element.textContent = data.value;
          }

          render(): HTMLDivElement {
            return this.element;
          }

          save(element: HTMLElement): { value: string } {
            return { value: element.textContent ?? '' };
          }

          setReadOnly(state: boolean): void {
            this.element.setAttribute('contenteditable', state ? 'false' : 'true');
          }

          async setData(data: { value: string }): Promise<boolean> {
            this.element.textContent = data.value;
            if (data.value === 'Peer pending') {
              setterStarted = true;
              await setterGate;
            }

            return accepted;
          }
        }

        const { current, socket } = await start([
          { id: 'probe', type: 'awaited-capture', data: { value: 'Before peer' } },
        ], { 'awaited-capture': AwaitedCapture });
        const originalElement = holder?.querySelector('[data-blok-id="probe"] [contenteditable]');

        if (!(originalElement instanceof HTMLElement)) throw new Error('expected original tool root');
        const onFirst = async (payload?: unknown): Promise<void> => {
          if (!isRecordFor(payload, 'probe')) return;
          first.push(payload);
          Reflect.set(payload, 'scope', 'subscriber corruption');
          const changes: unknown = 'changes' in payload ? payload.changes : undefined;

          const change: unknown = Array.isArray(changes) ? changes[0] : undefined;
          let path: unknown;

          if (typeof change === 'object' && change !== null) {
            Reflect.set(change, 'after', 'subscriber corruption');
            path = 'path' in change ? change.path : undefined;
          }
          if (Array.isArray(path)) {
            try { path.push('subscriber corruption'); } catch {}
          }
          await listenerGate;
          afterAwait.push(payload);
        };
        const onSecond = (payload?: unknown): void => {
          if (isRecordFor(payload, 'probe')) second.push(payload);
        };
        const expected = (text: string) => ({
          blockId: 'probe', type: 'update', origin: 'remote', scope: 'keys',
          native: { type: 'awaited-capture', parent: { present: false }, template: { present: false } },
          changes: [{ path: ['value'], beforePresent: true, afterPresent: true, after: text }],
        });

        current.events.on('block replayed', onFirst);
        current.events.on('block replayed', onSecond);
        try {
          peer.updateBlockData('probe', 'value', 'Peer pending');
          socket.deliver({ type: 'update', update: peer.encodeStateAsUpdate() });

          expect(second).toEqual([expected('Peer pending')]);
          expect(second[0]).toBe(first[0]);
          expect(afterAwait).toEqual([]);
          await vi.waitFor(() => { expect(setterStarted).toBe(true); }, { timeout: 3000 });
          expect(current.blocks.isSyncingFromYjs).toBe(true);
          releaseListener?.();
          await vi.waitFor(() => {
            expect(afterAwait).toEqual([expected('Peer pending')]);
          });
          expect(afterAwait[0]).toBe(first[0]);
          releaseSetter?.();
          await vi.waitFor(() => { expect(current.blocks.isSyncingFromYjs).toBe(false); }, { timeout: 3000 });
          await quiet();
          expect(second).toEqual([expected('Peer pending')]);
          expect(afterAwait[0]).toBe(second[0]);
          const finalElement = holder?.querySelector('[data-blok-id="probe"] [contenteditable]');

          expect(finalElement).toBeInstanceOf(HTMLElement);
          expect(finalElement === originalElement).toBe(accepted);
          expect(current.blocks.getById('probe')?.name).toBe('awaited-capture');
        } finally {
          releaseListener?.();
          releaseSetter?.();
          await quiet();
          current.events.off('block replayed', onFirst);
          current.events.off('block replayed', onSecond);
        }
      },
    );

    it('publishes undo and redo but excludes local writes, document loads and order-only moves', async () => {
      const current = await make(doc());
      const captures: unknown[] = [];
      const onReplay = (payload?: unknown): void => { captures.push(payload); };

      current.events.on('block replayed', onReplay);
      try {
        const reloaded = doc().map((block) => block.id === 'db'
          ? { ...block, data: { ...block.data, title: 'Reloaded tasks' } }
          : block);

        await current.blocks.render({ blocks: reloaded });
        await quiet();
        expect(captures).toEqual([]);
        current.blocks.getById('db')?.call('writeRelatedRow', {
          rowId: 'r1', changes: { notes: 'Local publication check' },
        });
        await quiet();
        expect(captures).toEqual([]);
        expect((await saved('r1'))?.data.properties.notes).toBe('Local publication check');
        current.history.undo();
        expect(captures).toEqual([{
          blockId: 'r1', type: 'update', origin: 'undo', scope: 'keys', native: rowIdentity(),
          changes: [{ path: ['properties', 'notes'], beforePresent: true, afterPresent: true, after: 'short' }],
        }]);
        await quiet();
        captures.length = 0;
        current.history.redo();
        expect(captures).toEqual([{
          blockId: 'r1', type: 'update', origin: 'redo', scope: 'keys', native: rowIdentity(),
          changes: [{
            path: ['properties', 'notes'], beforePresent: true, afterPresent: true, after: 'Local publication check',
          }],
        }]);
        await quiet();
        captures.length = 0;
        current.blocks.move(1, 2);
        await quiet();
        expect(captures).toEqual([]);
        expect(current.blocks.getChildren('db').map((block) => block.id)).toEqual(['r2', 'r1']);
      } finally {
        current.events.off('block replayed', onReplay);
      }
    });

    it('preserves replacement-payload forwarding for ordinary custom events', async () => {
      const current = await make(doc());
      const replacement = { value: 'replacement' };
      const received: unknown[] = [];
      const onFirst = (_payload?: unknown): { value: string } => replacement;
      const onSecond = (payload?: unknown): void => { received.push(payload); };

      current.events.on('capture-legacy-pipeline-control', onFirst);
      current.events.on('capture-legacy-pipeline-control', onSecond);
      try {
        current.events.emit('capture-legacy-pipeline-control', { value: 'original' });

        expect(received).toEqual([replacement]);
        expect(received[0]).toBe(replacement);
      } finally {
        current.events.off('capture-legacy-pipeline-control', onFirst);
        current.events.off('capture-legacy-pipeline-control', onSecond);
      }
    });

    it('forwards per-ID native template birth and removal records through real batch lifecycle', async () => {
      const { current, socket } = await start(doc());
      const captures: unknown[] = [];
      const births = [
        { id: 'template-channel', template: true, position: 'a3', title: 'Template channel' },
        { id: 'ordinary-channel', template: false, position: 'a4', title: 'Ordinary channel' },
      ];
      const onReplay = (payload?: unknown): void => {
        if (births.some((birth) => isRecordFor(payload, birth.id))) captures.push(payload);
      };

      current.events.on('block replayed', onReplay);
      try {
        peer.transact(() => {
          for (const birth of births) {
            peer.addBlock({
              id: birth.id, type: 'database-row', parent: 'db',
              data: { properties: { t: birth.title }, position: birth.position, template: birth.template },
            });
          }
        }, 'local');
        socket.deliver({ type: 'update', update: peer.encodeStateAsUpdate() });

        expect(captures.map(orderedChanges)).toEqual(expect.arrayContaining(births.map((birth) => ({
          blockId: birth.id, type: 'add', origin: 'remote', scope: 'keys', native: rowIdentity(birth.template),
          changes: [
            { path: ['position'], beforePresent: false, afterPresent: true, after: birth.position },
            { path: ['properties'], beforePresent: false, afterPresent: true, after: { t: birth.title } },
            { path: ['template'], beforePresent: false, afterPresent: true, after: birth.template },
          ],
        }))));
        expect(captures).toHaveLength(2);
        await quiet();
        for (const birth of births) expect(current.blocks.getById(birth.id)?.name).toBe('database-row');
        captures.length = 0;
        peer.transact(() => {
          for (const birth of births) peer.removeBlock(birth.id);
        }, 'local');
        socket.deliver({ type: 'update', update: peer.encodeStateAsUpdate() });
        expect(captures.map(orderedChanges)).toEqual(expect.arrayContaining(births.map((birth) => ({
          blockId: birth.id, type: 'remove', origin: 'remote', scope: 'keys', native: rowIdentity(birth.template), changes: [],
        }))));
        expect(captures).toHaveLength(2);
        await quiet();
        for (const birth of births) expect(current.blocks.getById(birth.id)).toBeNull();
      } finally {
        current.events.off('block replayed', onReplay);
      }
    });
  });

  it('keeps direct history rematerialization tagged as history while peer setData awaits', async () => {
    const peer = new DocumentStore(new YBlockSerializer());
    const sockets: PeerSocket[] = [];
    const originalSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
    const publicDetails: Array<{ target: unknown }> = [];
    const hostDetails: Array<{ target: unknown }> = [];
    let releasePeer: (() => void) | undefined;
    let peerStarted = false;
    const peerGate = new Promise<void>((resolve) => { releasePeer = resolve; });

    class SlowReplay {
      public static isReadOnlySupported = true;
      public static conversionConfig = { export: 'text', import: 'text' };
      private readonly element: HTMLDivElement;

      constructor({ data, readOnly }: BlockToolConstructorOptions<{ text: string }>) {
        this.element = document.createElement('div');
        this.element.setAttribute('contenteditable', readOnly ? 'false' : 'true');
        this.element.textContent = data.text;
      }

      render(): HTMLDivElement {
        return this.element;
      }

      save(element: HTMLElement): { text: string } {
        return { text: element.textContent ?? '' };
      }

      setReadOnly(state: boolean): void {
        this.element.setAttribute('contenteditable', state ? 'false' : 'true');
      }

      async setData(data: { text: string }): Promise<boolean> {
        this.element.textContent = data.text;
        if (data.text === 'Peer pending') {
          peerStarted = true;
          await peerGate;
        }

        return true;
      }
    }

    class OriginalReplay extends SlowReplay {}

    const record = (event: unknown, received: Array<{ target: unknown }>): void => {
      if (!(event instanceof CustomEvent) || event.type !== 'block-changed') return;
      const detail: unknown = event.detail;

      if (typeof detail !== 'object' || detail === null || !('target' in detail)) return;
      const target = detail.target;

      if (typeof target !== 'object' || target === null || !('id' in target) || target.id !== 'probe') return;
      received.push(detail);
    };
    const onBlockChange = (payload?: unknown): void => {
      if (typeof payload === 'object' && payload !== null && 'event' in payload) {
        record(payload.event, publicDetails);
      }
    };
    const onChange: NonNullable<BlokConfig['onChange']> = (_api, events) => {
      for (const event of Array.isArray(events) ? events : [events]) {
        record(event, hostDetails);
      }
    };

    class PeerSocket {
      binaryType = 'blob';
      readyState = 0;
      protocol = '';
      onopen: ((event: unknown) => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onclose: ((event: { code: number; reason: string }) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;

      constructor() {
        sockets.push(this);
      }

      send(data: ArrayBufferLike | ArrayBufferView): void {
        const bytes = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);
        const frame = decode(bytes);

        if (frame.type === 'update' || frame.type === 'syncStep2') {
          peer.applyRemoteUpdate(frame.update);
        }
      }

      close(): void {
        this.readyState = 3;
      }

      open(): void {
        this.protocol = 'blok-sync.v1';
        this.readyState = 1;
        this.onopen?.({});
      }

      deliver(frame: SyncWireFrame): void {
        this.onmessage?.({ data: encode(frame) });
      }
    }

    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: PeerSocket });
    try {
      peer.fromJSON([{ id: 'probe', type: 'original-replay', data: { text: 'Before conversion' } }]);
      const current = await make([], {}, {
        server: 'https://sync.test/api/',
        collaboration: { doc: 'direct-history-rematerialize-overlap' },
      }, { 'original-replay': OriginalReplay, 'slow-replay': SlowReplay });
      const socket = sockets.at(-1);

      if (socket === undefined) throw new Error('collaboration opened no socket');
      socket.open();
      socket.deliver({
        type: 'control',
        tag: { format: 2, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' },
      });
      socket.deliver({ type: 'syncStep2', update: peer.encodeStateAsUpdate() });
      await vi.waitFor(() => {
        expect(current.blocks.getById('probe')?.name).toBe('original-replay');
        expect(current.readOnly.isEnabled).toBe(false);
      }, { timeout: 3000 });
      await quiet();
      current.events.on('block changed', onBlockChange);
      current.handlers.set({ onChange });
      await current.blocks.convert('probe', 'slow-replay', { text: 'Local converted' });
      await vi.waitFor(() => {
        expect(peer.getBlockById('probe')?.get('type')).toBe('slow-replay');
        expect(current.blocks.isSyncingFromYjs).toBe(false);
      }, { timeout: 3000 });
      await quiet();
      await new Promise((resolve) => { setTimeout(resolve, 650); });
      publicDetails.length = 0;
      hostDetails.length = 0;
      peer.updateBlockData('probe', 'text', 'Peer pending');
      socket.deliver({ type: 'update', update: peer.encodeStateAsUpdate() });
      await vi.waitFor(() => {
        expect(peerStarted).toBe(true);
        expect(current.blocks.isSyncingFromYjs).toBe(true);
      }, { timeout: 3000 });
      current.history.undo();

      const originalDetail = publicDetails[0];

      expect(originalDetail !== undefined && 'replaySource' in originalDetail ? originalDetail.replaySource : undefined).toBe('history');
      expect(current.blocks.getById('probe')?.name).toBe('original-replay');
      releasePeer?.();
      await vi.waitFor(() => {
        expect(current.blocks.isSyncingFromYjs).toBe(false);
      }, { timeout: 3000 });
      await quiet();
      await new Promise((resolve) => { setTimeout(resolve, 650); });
      expect(originalDetail !== undefined && 'replaySource' in originalDetail ? originalDetail.replaySource : undefined).toBe('history');
      expect(publicDetails).toHaveLength(1);
      expect(hostDetails).toHaveLength(1);
      expect(publicDetails.map((detail) => 'replaySource' in detail ? detail.replaySource : undefined)).toEqual(['history']);
      expect(hostDetails.map((detail) => 'replaySource' in detail ? detail.replaySource : undefined)).toEqual(['history']);
    } finally {
      releasePeer?.();
      await quiet();
      editor?.events.off('block changed', onBlockChange);
      editor?.handlers.set({ onChange: undefined });
      editor?.destroy();
      editor = undefined;
      peer.destroy();
      if (originalSocket === undefined) {
        Reflect.deleteProperty(globalThis, 'WebSocket');
      } else {
        Object.defineProperty(globalThis, 'WebSocket', originalSocket);
      }
    }
  });

  it('persists a local row-property undo while an unrelated peer tool update is awaiting completion', async () => {
    const blocks: OutputBlockData[] = [
      ...doc(),
      { id: 'unrelated', type: 'slow-text', data: { text: 'Before peer edit' } },
    ];
    const backend = backendFor(blocks, 'db');
    const peer = new DocumentStore(new YBlockSerializer());
    const sockets: PeerSocket[] = [];
    const originalSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
    let releasePeer: (() => void) | undefined;
    let markPeerStarted: (() => void) | undefined;
    const peerGate = new Promise<void>((resolve) => { releasePeer = resolve; });
    const peerStarted = new Promise<void>((resolve) => { markPeerStarted = resolve; });

    class SlowText {
      public static isReadOnlySupported = true;
      private readonly element: HTMLDivElement;

      constructor({ data, readOnly }: BlockToolConstructorOptions<{ text: string }>) {
        this.element = document.createElement('div');
        this.element.setAttribute('contenteditable', readOnly ? 'false' : 'true');
        this.element.textContent = data.text;
      }

      render(): HTMLDivElement {
        return this.element;
      }

      save(element: HTMLElement): { text: string } {
        return { text: element.textContent ?? '' };
      }

      setReadOnly(state: boolean): void {
        this.element.setAttribute('contenteditable', state ? 'false' : 'true');
      }

      async setData(data: { text: string }): Promise<boolean> {
        this.element.textContent = data.text;
        if (data.text === 'Peer update awaiting completion') {
          markPeerStarted?.();
          await peerGate;
        }

        return true;
      }
    }

    class PeerSocket {
      binaryType = 'blob';
      readyState = 0;
      protocol = '';
      onopen: ((event: unknown) => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onclose: ((event: { code: number; reason: string }) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      readonly sent: Uint8Array[] = [];

      constructor() {
        sockets.push(this);
      }

      send(data: ArrayBufferLike | ArrayBufferView): void {
        const bytes = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);

        this.sent.push(new Uint8Array(bytes));
      }

      close(): void {
        this.readyState = 3;
      }

      open(): void {
        this.protocol = 'blok-sync.v1';
        this.readyState = 1;
        this.onopen?.({});
      }

      deliver(frame: SyncWireFrame): void {
        this.onmessage?.({ data: encode(frame) });
      }
    }

    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: PeerSocket });
    try {
      peer.fromJSON(blocks);
      await make([], { db: { adapter: backend.adapter } }, {
        server: 'https://sync.test/api/',
        collaboration: { doc: 'database-history-during-peer-update' },
      }, { 'slow-text': SlowText });
      const socket = sockets.at(-1);

      if (socket === undefined) throw new Error('collaboration opened no socket');
      socket.open();
      socket.deliver({
        type: 'control',
        tag: { format: 2, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' },
      });
      socket.deliver({ type: 'syncStep2', update: peer.encodeStateAsUpdate() });
      await vi.waitFor(() => {
        expect(editor?.blocks.getChildren('db').map((block) => block.id)).toEqual(['r1', 'r2']);
        expect(editor?.blocks.getById('unrelated')?.name).toBe('slow-text');
        expect(editor?.readOnly.isEnabled).toBe(false);
      });
      await quiet();
      editor?.blocks.getById('db')?.call('writeRelatedRow', { rowId: 'r1', changes: { notes: 'local edit' } });
      await quiet();
      await new Promise((resolve) => { setTimeout(resolve, 650); });
      const forwardValue = backend.rows.get('r1')?.properties.notes;

      peer.updateBlockData('unrelated', 'text', 'Peer update awaiting completion');
      socket.deliver({ type: 'update', update: peer.encodeStateAsUpdate() });
      await peerStarted;
      const peerWindowWasOpen = editor?.blocks.isSyncingFromYjs;

      editor?.history.undo();
      await quiet();
      await new Promise((resolve) => { setTimeout(resolve, 650); });
      const localValue = (await saved('r1'))?.data.properties.notes;

      expect(backend.rows.get('r1')?.properties.notes).toBe('short');
      expect(forwardValue).toBe('local edit');
      expect(peerWindowWasOpen).toBe(true);
      expect(localValue).toBe('short');
      expect(editor?.blocks.getById('unrelated')?.holder.textContent).toContain('Peer update awaiting completion');
    } finally {
      releasePeer?.();
      await quiet();
      editor?.destroy();
      editor = undefined;
      peer.destroy();
      if (originalSocket === undefined) {
        Reflect.deleteProperty(globalThis, 'WebSocket');
      } else {
        Object.defineProperty(globalThis, 'WebSocket', originalSocket);
      }
    }
  });

  it.each(['history-first', 'peer-first'] as const)('does not persist a peer row edit coalesced with local undo (%s)', async (order) => {
    const blocks = doc();
    const backend = backendFor(blocks, 'db');
    const update = vi.spyOn(backend.adapter, 'updateRow');
    const peer = new DocumentStore(new YBlockSerializer());
    const sockets: PeerSocket[] = [];
    const originalSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');

    class PeerSocket {
      binaryType = 'blob';
      readyState = 0;
      protocol = '';
      onopen: ((event: unknown) => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onclose: ((event: { code: number; reason: string }) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      readonly sent: Uint8Array[] = [];

      constructor() {
        sockets.push(this);
      }

      send(data: ArrayBufferLike | ArrayBufferView): void {
        const bytes = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);

        this.sent.push(new Uint8Array(bytes));
      }

      close(): void {
        this.readyState = 3;
      }

      open(): void {
        this.protocol = 'blok-sync.v1';
        this.readyState = 1;
        this.onopen?.({});
      }

      deliver(frame: SyncWireFrame): void {
        this.onmessage?.({ data: encode(frame) });
      }
    }

    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: PeerSocket });
    try {
      peer.fromJSON(blocks);
      await make([], { db: { adapter: backend.adapter } }, {
        server: 'https://sync.test/api/',
        collaboration: { doc: `database-mixed-replay-${order}` },
      });
      const socket = sockets.at(-1);

      if (socket === undefined) throw new Error('collaboration opened no socket');
      socket.open();
      socket.deliver({
        type: 'control',
        tag: { format: 2, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' },
      });
      socket.deliver({ type: 'syncStep2', update: peer.encodeStateAsUpdate() });
      await vi.waitFor(() => {
        expect(editor?.blocks.getChildren('db').map((block) => block.id)).toEqual(['r1', 'r2']);
        expect(editor?.readOnly.isEnabled).toBe(false);
      });
      await quiet();
      editor?.blocks.getById('db')?.call('writeRelatedRow', { rowId: 'r1', changes: { notes: 'local edit' } });
      await quiet();
      await new Promise((resolve) => { setTimeout(resolve, 650); });
      const forwardValue = backend.rows.get('r1')?.properties.notes;

      update.mockClear();
      peer.updateBlockData('r2', 'properties', { t: 'Bravo', notes: 'peer edit' });
      const applyPeer = (): void => {
        socket.deliver({ type: 'update', update: peer.encodeStateAsUpdate() });
      };

      // Both row rewrites must reach the same projection microtask.
      if (order === 'history-first') {
        editor?.history.undo();
        applyPeer();
      } else {
        applyPeer();
        editor?.history.undo();
      }
      await quiet();
      await new Promise((resolve) => { setTimeout(resolve, 650); });

      expect(update.mock.calls.filter(([params]) => params.rowId === 'r2')).toEqual([]);
      expect(backend.rows.get('r1')?.properties.notes).toBe('short');
      expect(backend.rows.get('r2')?.properties).toEqual({ t: 'Bravo' });
      expect(forwardValue).toBe('local edit');
      expect((await saved('r1'))?.data.properties.notes).toBe('short');
      expect((await saved('r2'))?.data.properties.notes).toBe('peer edit');
    } finally {
      await quiet();
      editor?.destroy();
      editor = undefined;
      peer.destroy();
      if (originalSocket === undefined) {
        Reflect.deleteProperty(globalThis, 'WebSocket');
      } else {
        Object.defineProperty(globalThis, 'WebSocket', originalSocket);
      }
    }
  });

  it.each(['history-first', 'peer-first'] as const)('does not persist a peer field coalesced with same-row local undo (%s)', async (order) => {
    const blocks = doc();
    const backend = backendFor(blocks, 'db');
    const update = vi.spyOn(backend.adapter, 'updateRow');
    const peer = new DocumentStore(new YBlockSerializer());
    const sockets: PeerSocket[] = [];
    const originalSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');

    class PeerSocket {
      binaryType = 'blob';
      readyState = 0;
      protocol = '';
      onopen: ((event: unknown) => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onclose: ((event: { code: number; reason: string }) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      readonly sent: Uint8Array[] = [];

      constructor() {
        sockets.push(this);
      }

      send(data: ArrayBufferLike | ArrayBufferView): void {
        const bytes = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);

        this.sent.push(new Uint8Array(bytes));
      }

      close(): void {
        this.readyState = 3;
      }

      open(): void {
        this.protocol = 'blok-sync.v1';
        this.readyState = 1;
        this.onopen?.({});
      }

      deliver(frame: SyncWireFrame): void {
        this.onmessage?.({ data: encode(frame) });
      }
    }

    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: PeerSocket });
    try {
      peer.fromJSON(blocks);
      await make([], { db: { adapter: backend.adapter } }, {
        server: 'https://sync.test/api/',
        collaboration: { doc: `database-same-row-mixed-replay-${order}` },
      });
      const socket = sockets.at(-1);

      if (socket === undefined) throw new Error('collaboration opened no socket');
      socket.open();
      socket.deliver({
        type: 'control',
        tag: { format: 2, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' },
      });
      socket.deliver({ type: 'syncStep2', update: peer.encodeStateAsUpdate() });
      await vi.waitFor(() => {
        expect(editor?.blocks.getChildren('db').map((block) => block.id)).toEqual(['r1', 'r2']);
        expect(editor?.readOnly.isEnabled).toBe(false);
      });
      await quiet();
      editor?.blocks.getById('db')?.call('writeRelatedRow', { rowId: 'r1', changes: { notes: 'local edit' } });
      await quiet();
      await new Promise((resolve) => { setTimeout(resolve, 650); });
      const forwardValue = backend.rows.get('r1')?.properties.notes;

      update.mockClear();
      peer.updateBlockData('r1', 'properties', { t: 'Alpha', notes: 'short', amount: 99, stage: 'o-build', done: true });
      const applyPeer = (): void => {
        socket.deliver({ type: 'update', update: peer.encodeStateAsUpdate() });
      };

      // Both row rewrites must reach the same projection microtask.
      if (order === 'history-first') {
        editor?.history.undo();
        applyPeer();
      } else {
        applyPeer();
        editor?.history.undo();
      }
      await quiet();
      await new Promise((resolve) => { setTimeout(resolve, 650); });

      expect(update.mock.calls.filter(([params]) => Object.prototype.hasOwnProperty.call(params.properties, 'amount'))).toEqual([]);
      expect(backend.rows.get('r1')?.properties.notes).toBe('short');
      expect(backend.rows.get('r1')?.properties.amount).toBe(12);
      expect(forwardValue).toBe('local edit');
      expect((await saved('r1'))?.data.properties.notes).toBe('short');
      expect((await saved('r1'))?.data.properties.amount).toBe(99);
    } finally {
      await quiet();
      editor?.destroy();
      editor = undefined;
      peer.destroy();
      if (originalSocket === undefined) {
        Reflect.deleteProperty(globalThis, 'WebSocket');
      } else {
        Object.defineProperty(globalThis, 'WebSocket', originalSocket);
      }
    }
  });

  it.each(['history-first', 'peer-first'] as const)('delivers the captured history marker without duplicate host changes during same-row peer replay (%s)', async (order) => {
    const blocks = doc();
    const backend = backendFor(blocks, 'db');
    const publicEvents: Array<{ replaySource: unknown; origin: unknown }> = [];
    const hostEvents: Array<{ replaySource: unknown; origin: unknown }> = [];
    const record = (event: unknown, received: Array<{ replaySource: unknown; origin: unknown }>): void => {
      if (!(event instanceof CustomEvent) || event.type !== 'block-changed') return;
      const detail: unknown = event.detail;

      if (typeof detail !== 'object' || detail === null || !('target' in detail)) return;
      const target = detail.target;

      if (typeof target !== 'object' || target === null || !('id' in target) || target.id !== 'r1') return;
      received.push({
        replaySource: 'replaySource' in detail ? detail.replaySource : undefined,
        origin: 'origin' in detail ? detail.origin : undefined,
      });
    };
    const onBlockChange = (payload?: unknown): void => {
      if (typeof payload === 'object' && payload !== null && 'event' in payload) {
        record(payload.event, publicEvents);
      }
    };
    const onChange: NonNullable<BlokConfig['onChange']> = (_api, events) => {
      for (const event of Array.isArray(events) ? events : [events]) {
        record(event, hostEvents);
      }
    };
    const peer = new DocumentStore(new YBlockSerializer());
    const sockets: PeerSocket[] = [];
    const originalSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');

    class PeerSocket {
      binaryType = 'blob';
      readyState = 0;
      protocol = '';
      onopen: ((event: unknown) => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onclose: ((event: { code: number; reason: string }) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      readonly sent: Uint8Array[] = [];

      constructor() {
        sockets.push(this);
      }

      send(data: ArrayBufferLike | ArrayBufferView): void {
        const bytes = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);

        this.sent.push(new Uint8Array(bytes));
      }

      close(): void {
        this.readyState = 3;
      }

      open(): void {
        this.protocol = 'blok-sync.v1';
        this.readyState = 1;
        this.onopen?.({});
      }

      deliver(frame: SyncWireFrame): void {
        this.onmessage?.({ data: encode(frame) });
      }
    }

    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: PeerSocket });
    try {
      peer.fromJSON(blocks);
      await make([], { db: { adapter: backend.adapter } }, {
        server: 'https://sync.test/api/',
        collaboration: { doc: `database-same-row-marker-delivery-${order}` },
      });
      const socket = sockets.at(-1);

      if (socket === undefined) throw new Error('collaboration opened no socket');
      socket.open();
      socket.deliver({
        type: 'control',
        tag: { format: 2, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' },
      });
      socket.deliver({ type: 'syncStep2', update: peer.encodeStateAsUpdate() });
      await vi.waitFor(() => {
        expect(editor?.blocks.getChildren('db').map((block) => block.id)).toEqual(['r1', 'r2']);
        expect(editor?.readOnly.isEnabled).toBe(false);
      });
      await quiet();
      editor?.events.on('block changed', onBlockChange);
      editor?.handlers.set({ onChange });
      editor?.blocks.getById('db')?.call('writeRelatedRow', { rowId: 'r1', changes: { notes: 'local edit' } });
      await quiet();
      await new Promise((resolve) => { setTimeout(resolve, 650); });
      publicEvents.length = 0;
      hostEvents.length = 0;
      peer.updateBlockData('r1', 'properties', { t: 'Alpha', notes: 'short', amount: 99, stage: 'o-build', done: true });
      const applyPeer = (): void => {
        socket.deliver({ type: 'update', update: peer.encodeStateAsUpdate() });
      };

      // Both row rewrites must reach the same projection microtask.
      if (order === 'history-first') {
        editor?.history.undo();
        applyPeer();
      } else {
        applyPeer();
        editor?.history.undo();
      }
      await quiet();
      await new Promise((resolve) => { setTimeout(resolve, 650); });

      expect(publicEvents.map((event) => event.replaySource)).toContain('history');
      expect(publicEvents).toHaveLength(1);
      expect(hostEvents).toHaveLength(1);
      expect(hostEvents.map((event) => event.replaySource)).toEqual(['history']);
      expect((await saved('r1'))?.data.properties.notes).toBe('short');
      expect((await saved('r1'))?.data.properties.amount).toBe(99);
    } finally {
      await quiet();
      editor?.events.off('block changed', onBlockChange);
      editor?.handlers.set({ onChange: undefined });
      editor?.destroy();
      editor = undefined;
      peer.destroy();
      if (originalSocket === undefined) {
        Reflect.deleteProperty(globalThis, 'WebSocket');
      } else {
        Object.defineProperty(globalThis, 'WebSocket', originalSocket);
      }
    }
  });

  it('sends a duplicated row to the backend with only writable schema values', async () => {
    const blocks = poisonedDoc();
    const backend = backendFor(blocks, 'db');
    const createRow = vi.spyOn(backend.adapter, 'createRow');

    await make(blocks, { db: { adapter: backend.adapter } });
    const before = (await saved('r1'))?.data.properties;

    if (before?.stage !== 'o-evil' || !Object.hasOwn(before, 'ghost')) throw new Error('poison did not survive boot');
    holder?.querySelector<HTMLElement>('[data-row-id="r1"] [data-blok-database-table-row-checkbox]')?.click();
    holder?.querySelector<HTMLElement>('[role="grid"]')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'd', metaKey: true, bubbles: true, cancelable: true }),
    );
    await quiet();

    const sent = createRow.mock.calls.map(([params]) => params);

    expect(sent.some((params) => Object.hasOwn(params.properties, '__proto__') || Object.hasOwn(params.properties, 'ghost'))).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0].properties.stage).toBeNull();
    expect(sent[0].properties.files).toEqual([{ id: 'f-ok', name: 'ok', url: 'https://example.com/ok' }]);
  });

  it('sends a duplicated template to the backend with only writable schema values', async () => {
    const blocks = poisonedDoc();

    blocks[0] = { ...blocks[0], content: ['r1', 'r2', 'tpl'] };
    blocks.push({
      id: 'tpl', type: 'database-row', parent: 'db',
      data: { ...blocks[1].data, title: 'Tpl', position: 'a2', template: true },
    });
    const backend = backendFor(blocks, 'db');
    const createRow = vi.spyOn(backend.adapter, 'createRow');

    await make(blocks, { db: { adapter: backend.adapter } });
    if ((await saved('tpl'))?.data.properties.stage !== 'o-evil') throw new Error('poison did not survive boot');
    editor?.blocks.getById('db')?.call('duplicateTemplate', 'tpl' as never);
    await quiet();

    const sent = createRow.mock.calls.map(([params]) => params);

    expect(sent.some((params) => Object.hasOwn(params.properties, '__proto__') || Object.hasOwn(params.properties, 'ghost'))).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0].properties.stage).toBeNull();
    expect(sent[0].properties.files).toEqual([{ id: 'f-ok', name: 'ok', url: 'https://example.com/ok' }]);
  });

  it('does not send an undo that restores an unknown option id to the backend', async () => {
    const blocks = poisonedDoc();
    const backend = backendFor(blocks, 'db');
    const updateRow = vi.spyOn(backend.adapter, 'updateRow');

    await make(blocks, { db: { adapter: backend.adapter } });
    if ((await saved('r1'))?.data.properties.stage !== 'o-evil') throw new Error('poison did not survive boot');
    editor?.blocks.getById('db')?.call('writeRelatedRow', { rowId: 'r1', changes: { stage: 'o-build' } });
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    updateRow.mockClear();

    editor?.history.undo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect(updateRow.mock.calls.some(([params]) => params.properties.stage === 'o-evil')).toBe(false);
    expect(backend.rows.get('r1')?.properties.stage).toBe('o-build');
    expect((await saved('r1'))?.data.properties.stage).toBe('o-evil');
  });

  it('undoes a CSV merge and the option it created in one undo step, and redo brings both back', async () => {
    const stageOptions = async (): Promise<string[]> =>
      (((await editor?.save())?.blocks.find((block) => block.id === 'db')?.data as DatabaseData)
        .schema.find((property) => property.id === 'stage')?.config?.options ?? []).map((option) => option.label);
    const rows = (): string[] => editor?.blocks.getChildren('db').map((block) => block.id) ?? [];

    await make(doc());
    editor?.blocks.getById('db')?.call('mergeCsv', 'Name,Stage\nShip it,Ship' as never);
    await quiet();
    if (!(await stageOptions()).includes('Ship') || rows().length !== 3) throw new Error('mergeCsv made no new option or row');

    editor?.history.undo();
    await quiet();

    expect(await stageOptions()).toEqual(['Build']);
    expect(rows()).toEqual(['r1', 'r2']);

    editor?.history.redo();
    await quiet();
    const output = await editor?.save();
    const shipId = (output?.blocks.find((block) => block.id === 'db')?.data as DatabaseData)
      .schema.find((property) => property.id === 'stage')?.config?.options.find((option) => option.label === 'Ship')?.id;
    const merged = output?.blocks.find((block) => block.parent === 'db' && !['r1', 'r2'].includes(block.id ?? ''));

    expect(await stageOptions()).toEqual(['Build', 'Ship']);
    expect(rows()).toHaveLength(3);
    expect(shipId).toBeDefined();
    expect((merged?.data as DatabaseRowData | undefined)?.properties.stage).toBe(shipId);
  });

  // research/30 §9f: an unmatched column becomes a new property; one undo takes it out with the rows.
  it('undoes a CSV merge\'s new property with its rows in one undo step', async () => {
    const names = async (): Promise<string[]> =>
      ((await editor?.save())?.blocks.find((block) => block.id === 'db')?.data as DatabaseData).schema.map((property) => property.name);
    const rows = (): string[] => editor?.blocks.getChildren('db').map((block) => block.id) ?? [];

    await make(doc());
    const before = await names();

    editor?.blocks.getById('db')?.call('mergeCsv', 'Name,Extra\nShip it,x' as never);
    await quiet();
    if (!(await names()).includes('Extra') || rows().length !== 3) throw new Error('mergeCsv made no new property or row');

    editor?.history.undo();
    await quiet();

    expect(await names()).toEqual(before);
    expect(rows()).toEqual(['r1', 'r2']);
  });

  it('sends a redone CSV merge row with the option the same step created', async () => {
    const blocks = doc();
    const backend = backendFor(blocks, 'db');
    const createRow = vi.spyOn(backend.adapter, 'createRow');
    const stageOptions = async (): Promise<string[]> =>
      (((await editor?.save())?.blocks.find((block) => block.id === 'db')?.data as DatabaseData)
        .schema.find((property) => property.id === 'stage')?.config?.options ?? []).map((option) => option.label);

    await make(blocks, { db: { adapter: backend.adapter } });
    editor?.blocks.getById('db')?.call('mergeCsv', 'Name,Stage\nShip it,Ship' as never);
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    const shipId = ((await editor?.save())?.blocks.find((block) => block.id === 'db')?.data as DatabaseData)
      .schema.find((property) => property.id === 'stage')?.config?.options.find((option) => option.label === 'Ship')?.id;
    const rowId = editor?.blocks.getChildren('db').map((block) => block.id).find((id) => !['r1', 'r2'].includes(id));

    if (shipId === undefined || rowId === undefined) throw new Error('mergeCsv made no new option or row');
    editor?.history.undo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    // Undo takes the option out with the row, so redo must bring the option back before the row is filtered.
    if (editor?.blocks.getChildren('db').some((block) => block.id === rowId) || (await stageOptions()).includes('Ship')) {
      throw new Error('undo of mergeCsv no longer removes the row and its new option');
    }
    createRow.mockClear();
    editor?.history.redo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect(createRow.mock.calls.find(([params]) => params.id === rowId)?.[0].properties.stage).toBe(shipId);
    expect(backend.rows.get(rowId)?.properties.stage).toBe(shipId);
  });

  it('persists local undo after another local row refreshes the database model', async () => {
    const blocks = doc();
    const backend = backendFor(blocks, 'db');

    await make(blocks, { db: { adapter: backend.adapter } });
    editor?.blocks.getById('db')?.call('writeRelatedRow', { rowId: 'r1', changes: { notes: 'local edit' } });
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    const forwardValue = backend.rows.get('r1')?.properties.notes;

    // The second write refreshes all rows before undo's awaited announcement.
    editor?.history.undo();
    editor?.blocks.getById('db')?.call('writeRelatedRow', { rowId: 'r2', changes: { notes: 'other local edit' } });
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect(backend.rows.get('r1')?.properties.notes).toBe('short');
    expect(backend.rows.get('r2')?.properties.notes).toBe('other local edit');
    expect(forwardValue).toBe('local edit');
    expect((await saved('r1'))?.data.properties.notes).toBe('short');
    expect((await saved('r2'))?.data.properties.notes).toBe('other local edit');
  });

  it('persists undo and redo of adding a template without losing its template discriminator', async () => {
    const blocks = doc();
    const backend = backendFor(blocks, 'db');

    await make(blocks, { db: { adapter: backend.adapter } });
    const originalIds = new Set(editor?.blocks.getChildren('db').map((block) => block.id));

    editor?.blocks.getById('db')?.call('addTemplate');
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    const template = editor?.blocks.getChildren('db').find((block) => !originalIds.has(block.id));

    if (template === undefined) throw new Error('addTemplate created no row block');
    const templateId = template.id;
    const created = backend.rows.get(templateId);
    const forwardTemplate = created !== undefined && 'template' in created ? created.template : undefined;

    editor?.history.undo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect(backend.rows.has(templateId)).toBe(false);
    expect((await editor?.save())?.blocks.find((block) => block.id === templateId)).toBeUndefined();
    expect(forwardTemplate).toBe(true);

    editor?.history.redo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    const restored = backend.rows.get(templateId);

    expect(restored !== undefined && 'template' in restored ? restored.template : undefined).toBe(true);
    expect(restored?.properties).toEqual({ t: '' });
    expect((await editor?.save())?.blocks.find((block) => block.id === templateId)?.data.template).toBe(true);
  });

  it('persists undo and redo of deleting a template without restoring it as an ordinary row', async () => {
    const blocks = doc();

    blocks[0] = { ...blocks[0], content: ['r1', 'r2', 'tpl'] };
    blocks.push({
      id: 'tpl',
      type: 'database-row',
      parent: 'db',
      data: { title: 'Reusable', properties: { t: 'Reusable', notes: 'template notes' }, position: 'a2', template: true },
    });
    const backend = backendFor(blocks, 'db');

    await make(blocks, { db: { adapter: backend.adapter } });
    editor?.blocks.getById('db')?.call('deleteTemplate', 'tpl' as never);
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    const remainedAfterDelete = backend.rows.has('tpl');

    editor?.history.undo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    const restored = backend.rows.get('tpl');

    expect(restored !== undefined && 'template' in restored ? restored.template : undefined).toBe(true);
    expect(restored?.properties).toEqual({ t: 'Reusable', notes: 'template notes' });
    expect(restored?.position).toBe('a2');
    expect(remainedAfterDelete).toBe(false);
    expect((await editor?.save())?.blocks.find((block) => block.id === 'tpl')?.data.template).toBe(true);

    editor?.history.redo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect(backend.rows.has('tpl')).toBe(false);
    expect((await editor?.save())?.blocks.find((block) => block.id === 'tpl')).toBeUndefined();
  });

  it('does not relabel a delivered peer announcement when the host undoes reentrantly', async () => {
    const blocks = doc();
    const backend = backendFor(blocks, 'db');
    const publicEvents: Array<{ replaySource: unknown; origin: unknown }> = [];
    const hostEvents: Array<{ replaySource: unknown; origin: unknown }> = [];
    const publishedDetails: Array<{ target: unknown }> = [];
    let undoAfterPeer = false;
    let windowWasOpen: boolean | undefined;
    const record = (event: unknown, received: Array<{ replaySource: unknown; origin: unknown }>): void => {
      if (!(event instanceof CustomEvent) || event.type !== 'block-changed') return;
      const detail: unknown = event.detail;

      if (typeof detail !== 'object' || detail === null || !('target' in detail)) return;
      const target = detail.target;

      if (typeof target !== 'object' || target === null || !('id' in target) || target.id !== 'r1') return;
      if (received === publicEvents) publishedDetails.push(detail);
      received.push({
        replaySource: 'replaySource' in detail ? detail.replaySource : undefined,
        origin: 'origin' in detail ? detail.origin : undefined,
      });
    };
    const onBlockChange = (payload?: unknown): void => {
      if (typeof payload === 'object' && payload !== null && 'event' in payload) {
        record(payload.event, publicEvents);
      }
    };
    const onChange: NonNullable<BlokConfig['onChange']> = (_api, events) => {
      for (const event of Array.isArray(events) ? events : [events]) {
        record(event, hostEvents);
      }
      if (undoAfterPeer && hostEvents.some((event) => event.replaySource === 'remote')) {
        undoAfterPeer = false;
        windowWasOpen = editor?.blocks.isSyncingFromYjs;
        editor?.history.undo();
      }
    };
    const peer = new DocumentStore(new YBlockSerializer());
    const sockets: PeerSocket[] = [];
    const originalSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');

    class PeerSocket {
      binaryType = 'blob';
      readyState = 0;
      protocol = '';
      onopen: ((event: unknown) => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onclose: ((event: { code: number; reason: string }) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      readonly sent: Uint8Array[] = [];

      constructor() {
        sockets.push(this);
      }

      send(data: ArrayBufferLike | ArrayBufferView): void {
        const bytes = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);

        this.sent.push(new Uint8Array(bytes));
      }

      close(): void {
        this.readyState = 3;
      }

      open(): void {
        this.protocol = 'blok-sync.v1';
        this.readyState = 1;
        this.onopen?.({});
      }

      deliver(frame: SyncWireFrame): void {
        this.onmessage?.({ data: encode(frame) });
      }
    }

    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: PeerSocket });
    try {
      peer.fromJSON(blocks);
      await make([], { db: { adapter: backend.adapter } }, {
        server: 'https://sync.test/api/',
        collaboration: { doc: 'database-late-history-announcement' },
      });
      const socket = sockets.at(-1);

      if (socket === undefined) throw new Error('collaboration opened no socket');
      socket.open();
      socket.deliver({
        type: 'control',
        tag: { format: 2, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' },
      });
      socket.deliver({ type: 'syncStep2', update: peer.encodeStateAsUpdate() });
      await vi.waitFor(() => {
        expect(editor?.blocks.getChildren('db').map((block) => block.id)).toEqual(['r1', 'r2']);
        expect(editor?.readOnly.isEnabled).toBe(false);
      });
      await quiet();
      editor?.events.on('block changed', onBlockChange);
      editor?.handlers.set({ onChange });
      editor?.blocks.getById('db')?.call('writeRelatedRow', { rowId: 'r1', changes: { notes: 'local edit' } });
      await quiet();
      await new Promise((resolve) => { setTimeout(resolve, 650); });
      publicEvents.length = 0;
      hostEvents.length = 0;
      publishedDetails.length = 0;
      undoAfterPeer = true;
      peer.updateBlockData('r1', 'properties', { t: 'Alpha', notes: 'short', amount: 99, stage: 'o-build', done: true });
      const applyPeer = (): void => {
        socket.deliver({ type: 'update', update: peer.encodeStateAsUpdate() });
      };

      applyPeer();
      await quiet();
      await new Promise((resolve) => { setTimeout(resolve, 650); });

      const originalDetail = publishedDetails[0];

      expect(originalDetail !== undefined && 'replaySource' in originalDetail ? originalDetail.replaySource : undefined).toBe('remote');
      expect(publicEvents.map((event) => event.replaySource)).toEqual(['remote']);
      expect(publicEvents).toHaveLength(1);
      expect(hostEvents).toHaveLength(1);
      expect(hostEvents.map((event) => event.replaySource)).toEqual(['remote']);
      expect(windowWasOpen).toBe(true);
      expect(undoAfterPeer).toBe(false);
      expect((await saved('r1'))?.data.properties.notes).toBe('short');
      expect((await saved('r1'))?.data.properties.amount).toBe(99);
    } finally {
      await quiet();
      editor?.events.off('block changed', onBlockChange);
      editor?.handlers.set({ onChange: undefined });
      editor?.destroy();
      editor = undefined;
      peer.destroy();
      if (originalSocket === undefined) {
        Reflect.deleteProperty(globalThis, 'WebSocket');
      } else {
        Object.defineProperty(globalThis, 'WebSocket', originalSocket);
      }
    }
  });

  it('persists one ordinary local text-cell edit exactly once', async () => {
    const blocks = doc();

    blocks[0] = { ...blocks[0], data: { ...blocks[0].data, views: [{ ...view, visibleProperties: ['notes'] }] } };
    const backend = backendFor(blocks, 'db');
    const update = vi.spyOn(backend.adapter, 'updateRow');

    await make(blocks, { db: { adapter: backend.adapter } });
    const cell = holder?.querySelector<HTMLElement>('[data-blok-id="db"] [data-row-id="r1"] [role="gridcell"][data-property-id="notes"]');

    if (cell === null || cell === undefined) throw new Error('missing notes cell');
    cell.click();
    await quiet();
    const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-blok-database-cell-input="text"]');

    if (input === null) throw new Error('missing text-cell input');
    input.value = 'local edit';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect(update).toHaveBeenCalledTimes(1);
    expect(backend.rows.get('r1')?.properties.notes).toBe('local edit');
    expect((await saved('r1'))?.data.properties.notes).toBe('local edit');
  });

  it('persists a native source replay once while linked viewers and unrelated owner edits stay separate', async () => {
    const blocks = dashboardOwnerDoc('db');
    const dashboardBlock = blocks[0];
    const sourceBlock = blocks[3];

    if (dashboardBlock === undefined || sourceBlock === undefined) throw new Error('missing replay source fixture');
    const dashboardData = dashboardBlock.data as DatabaseData;
    const sourceData = sourceBlock.data as DatabaseData;
    const summary: PropertyDefinition = {
      id: 'summary', name: 'Summary', type: 'text', position: 'a5',
      autofill: { mode: 'keyInfo', onEdit: true },
    };
    const sourceSchema = [...sourceData.schema, summary];

    blocks[0] = {
      ...dashboardBlock, data: { ...dashboardData, schema: [...dashboardData.schema, summary] },
    };
    blocks[3] = {
      ...sourceBlock, data: { ...sourceData, schema: sourceSchema },
    };
    blocks.push(
      {
        id: 'replay-owner', type: 'database', content: ['replay-owner-row'],
        data: {
          title: 'Replay owner',
          schema: [
            { id: 't', name: 'Name', type: 'title', position: 'a0' },
            { id: 'notes', name: 'Notes', type: 'text', position: 'a1' },
            summary,
          ],
          views: [view], activeViewId: 'v',
        },
      },
      {
        id: 'replay-owner-row', type: 'database-row', parent: 'replay-owner',
        data: { properties: { t: 'Owner', notes: 'Owner note' }, position: 'a0' },
      },
      {
        id: 'replay-dashboard-linked', type: 'database',
        data: {
          source: { databaseId: 'db2' }, schema: structuredClone(sourceSchema),
          views: [{ ...view, visibleProperties: ['name', 'n2'] }], activeViewId: 'v',
        },
      },
      {
        id: 'replay-owner-linked', type: 'database',
        data: {
          source: { databaseId: 'db2' }, schema: structuredClone(sourceSchema),
          views: [{ ...view, visibleProperties: ['name', 'n2'] }], activeViewId: 'v',
        },
      },
    );
    const dashboard = backendFor(blocks, 'db');
    const owner = backendFor(blocks, 'replay-owner');
    const source = backendFor(blocks, 'db2');
    const dashboardUpdate = vi.spyOn(dashboard.adapter, 'updateRow');
    const ownerUpdate = vi.spyOn(owner.adapter, 'updateRow');
    const sourceUpdate = vi.spyOn(source.adapter, 'updateRow');
    const contexts = new Map<string, DatabaseAutomationContext>();
    const triggers: Array<{ databaseId: string; trigger: DatabaseAutomationTrigger }> = [];
    const requests: DatabaseAutofillRequest[] = [];
    const automations: NonNullable<DatabaseConfig['automations']> = {
      onTrigger: (trigger, context) => {
        contexts.set(context.databaseId, context);
        triggers.push({ databaseId: context.databaseId, trigger: structuredClone(trigger) });
      },
    };
    const ai: DatabaseAI = {
      autofill: (request) => {
        requests.push(structuredClone(request));
        return Promise.resolve(null);
      },
    };
    const current = await make(blocks, {
      db: { adapter: dashboard.adapter, automations, ai },
      'replay-owner': { adapter: owner.adapter, automations, ai },
      db2: { adapter: source.adapter, automations, ai },
      'replay-dashboard-linked': { adapter: dashboard.adapter, automations, ai },
      'replay-owner-linked': { adapter: owner.adapter, automations, ai },
    });
    const dashboardTool = current.blocks.getById('db');
    const ownerTool = current.blocks.getById('replay-owner');
    const sourceTool = current.blocks.getById('db2');

    if (dashboardTool === null || ownerTool === null || sourceTool === null) throw new Error('missing replay database tool');
    dashboardTool.call('writeRelatedRow', { rowId: 'r1', changes: { notes: 'D baseline' } });
    ownerTool.call('writeRelatedRow', { rowId: 'replay-owner-row', changes: { notes: 'O baseline' } });
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    sourceTool.call('writeRelatedRow', { rowId: 'q1', changes: { n2: 'Source changed' } });
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    const warmupTriggers = structuredClone(triggers);
    const warmupRequests = structuredClone(requests);
    const dashboardContext = contexts.get('db');
    const ownerContext = contexts.get('replay-owner');

    if (dashboardContext === undefined || ownerContext === undefined) throw new Error('authoring hooks did not expose owner contexts');
    dashboardUpdate.mockClear();
    ownerUpdate.mockClear();
    sourceUpdate.mockClear();
    triggers.length = 0;
    requests.length = 0;
    const duringReplay: unknown[] = [];
    const onReplay = (capture: BlockReplayCapture): void => {
      if (capture.blockId !== 'q1' || capture.origin !== 'undo') return;
      duringReplay.push({
        S: sourceUpdate.mock.calls.map(([params]) => structuredClone(params)),
        D: dashboardUpdate.mock.calls.map(([params]) => structuredClone(params)),
        O: ownerUpdate.mock.calls.map(([params]) => structuredClone(params)),
        capture: structuredClone(capture),
      });
    };

    current.events.on('block replayed', onReplay);
    try {
      const dashboardAccepted = dashboardContext.run({
        type: 'editProperty', rowId: 'r1', propertyId: 'notes', value: 'D pending',
      });
      const ownerAccepted = ownerContext.run({
        type: 'editProperty', rowId: 'replay-owner-row', propertyId: 'notes', value: 'O pending',
      });
      current.history.undo();
      await quiet();
      await new Promise((resolve) => { setTimeout(resolve, 650); });

      expect(duringReplay).toEqual([{
        S: [{ rowId: 'q1', properties: { n2: 'Source note' } }],
        D: [],
        O: [],
        capture: {
          blockId: 'q1', type: 'update', origin: 'undo', scope: 'keys',
          native: {
            type: 'database-row', parent: { present: true, value: 'db2' },
            template: { present: false },
          },
          changes: [{
            path: ['properties', 'n2'],
            beforePresent: true, afterPresent: true, after: 'Source note',
          }],
        },
      }]);
      expect({
        S: sourceUpdate.mock.calls,
        D: dashboardUpdate.mock.calls,
        O: ownerUpdate.mock.calls,
      }).toEqual({
        S: [[{ rowId: 'q1', properties: { n2: 'Source note' } }]],
        D: [[{ rowId: 'r1', properties: { notes: 'D pending' } }]],
        O: [[{ rowId: 'replay-owner-row', properties: { notes: 'O pending' } }]],
      });
      expect({
        S: source.rows.get('q1')?.properties.n2,
        D: dashboard.rows.get('r1')?.properties.notes,
        O: owner.rows.get('replay-owner-row')?.properties.notes,
      }).toEqual({ S: 'Source note', D: 'D pending', O: 'O pending' });
      expect(triggers).toEqual([]);
      expect(requests).toEqual([]);
      expect({ dashboardAccepted, ownerAccepted }).toEqual({
        dashboardAccepted: true, ownerAccepted: true,
      });
      expect(warmupTriggers).toHaveLength(3);
      expect(warmupTriggers).toEqual(expect.arrayContaining([
        { databaseId: 'db', trigger: { type: 'propertyEdited', rowId: 'r1', propertyId: 'notes', value: 'D baseline' } },
        { databaseId: 'replay-owner', trigger: { type: 'propertyEdited', rowId: 'replay-owner-row', propertyId: 'notes', value: 'O baseline' } },
        { databaseId: 'db2', trigger: { type: 'propertyEdited', rowId: 'q1', propertyId: 'n2', value: 'Source changed' } },
      ]));
      expect(warmupRequests).toHaveLength(3);
      expect(warmupRequests.map(({ databaseId, rowId, propertyId }) => ({
        databaseId, rowId, propertyId,
      }))).toEqual(expect.arrayContaining([
        { databaseId: 'db', rowId: 'r1', propertyId: 'summary' },
        { databaseId: 'replay-owner', rowId: 'replay-owner-row', propertyId: 'summary' },
        { databaseId: 'db2', rowId: 'q1', propertyId: 'summary' },
      ]));
      expect(shownRows('replay-dashboard-linked')).toEqual(['q1', 'q2']);
      expect(shownRows('replay-owner-linked')).toEqual(['q1', 'q2']);
      expect(current.blocks.getChildren('replay-dashboard-linked')).toEqual([]);
      expect(current.blocks.getChildren('replay-owner-linked')).toEqual([]);
      expect((await saved('q1'))?.parent).toBe('db2');
      expect((await saved('q1'))?.data.properties.n2).toBe('Source note');
    } finally {
      current.events.off('block replayed', onReplay);
    }
  });

  it.each([
    {
      caseName: 'relation seeded empty',
      propertyType: 'relation' as const,
      seed: [] as PropertyValue,
      next: [{ id: 'r1' }] as PropertyValue,
    },
    {
      caseName: 'relation seeded nonempty',
      propertyType: 'relation' as const,
      seed: [{ id: 'r1' }] as PropertyValue,
      next: [{ id: 'r2' }, { id: 'r1' }] as PropertyValue,
    },
    {
      caseName: 'files seeded empty',
      propertyType: 'files' as const,
      seed: [] as PropertyValue,
      next: [{ id: 'file-a', name: 'First.txt', url: 'https://example.invalid/first.txt' }] as PropertyValue,
    },
    {
      caseName: 'files seeded nonempty',
      propertyType: 'files' as const,
      seed: [{ id: 'file-a', name: 'Before.txt', url: 'https://example.invalid/first.txt' }] as PropertyValue,
      next: [
        { id: 'file-a', name: 'After.txt', url: 'https://example.invalid/first.txt' },
        { id: 'file-b', name: 'Second.txt', url: 'https://example.invalid/second.txt' },
      ] as PropertyValue,
    },
  ])('persists native S structured replay ($caseName)', async ({ propertyType, seed, next }) => {
    const blocks = doc();
    const sourceBlock = blocks.find((block) => block.id === 'db2');
    const sourceRow = blocks.find((block) => block.id === 'q1');

    if (sourceBlock === undefined || sourceRow === undefined) {
      throw new Error('missing native source fixture');
    }
    const sourceData = sourceBlock.data as DatabaseData;
    const property: PropertyDefinition = {
      id: 'structured',
      name: 'Structured',
      type: propertyType,
      position: 'a4',
      ...(propertyType === 'relation' ? { relation: { targetDatabaseId: 'db' } } : {}),
    };

    sourceBlock.data = { ...sourceData, schema: [...sourceData.schema, property] };
    sourceRow.data = {
      ...sourceRow.data,
      properties: {
        name: 'Existing',
        n2: 'Untouched source note',
        structured: structuredClone(seed),
      },
    };
    const source = backendFor(blocks, 'db2');
    const sourceUpdate = vi.spyOn(source.adapter, 'updateRow');
    const triggers: DatabaseAutomationTrigger[] = [];
    const current = await make(blocks, {
      db2: {
        adapter: source.adapter,
        automations: { onTrigger: (trigger) => { triggers.push(structuredClone(trigger)); } },
      },
    });
    const sourceTool = current.blocks.getById('db2');
    const replayCaptures: BlockReplayCapture[] = [];
    const onReplay = (capture: BlockReplayCapture): void => {
      if (capture.blockId === 'q1') replayCaptures.push(capture);
    };

    if (sourceTool === null) throw new Error('missing native source database');
    current.events.on('block replayed', onReplay);
    try {
      sourceTool.call('writeRelatedRow', {
        rowId: 'q1',
        changes: { structured: structuredClone(next) },
      });
      await quiet();
      await new Promise((resolve) => { setTimeout(resolve, 650); });
      const forwardValue = source.rows.get('q1')?.properties.structured;
      const forwardTriggers = structuredClone(triggers);

      sourceUpdate.mockClear();
      triggers.length = 0;
      current.history.undo();
      await quiet();
      await new Promise((resolve) => { setTimeout(resolve, 650); });

      expect(source.rows.get('q1')?.properties.structured).toEqual(seed);
      expect(forwardValue).toEqual(next);
      expect(sourceUpdate.mock.calls).toEqual([[{
        rowId: 'q1', properties: { structured: seed },
      }]]);
      expect(replayCaptures.filter((capture) => capture.origin === 'undo')).toEqual([{
        blockId: 'q1',
        type: 'update',
        origin: 'undo',
        scope: 'keys',
        native: {
          type: 'database-row',
          parent: { present: true, value: 'db2' },
          template: { present: false },
        },
        changes: [{
          path: ['properties', 'structured'],
          beforePresent: true,
          afterPresent: true,
          after: seed,
        }],
      }]);
      expect((await saved('q1'))?.data.properties).toEqual({
        name: 'Existing', n2: 'Untouched source note', structured: seed,
      });
      expect(source.rows.get('q1')?.properties.n2).toBe('Untouched source note');
      expect(triggers).toEqual([]);
      expect(forwardTriggers).toEqual([{
        type: 'propertyEdited',
        rowId: 'q1',
        propertyId: 'structured',
        value: next,
      }]);
      sourceUpdate.mockClear();
      current.history.redo();
      await quiet();
      await new Promise((resolve) => { setTimeout(resolve, 650); });

      expect(source.rows.get('q1')?.properties.structured).toEqual(next);
      expect(sourceUpdate.mock.calls).toEqual([[{
        rowId: 'q1', properties: { structured: next },
      }]]);
      expect(replayCaptures.filter((capture) => capture.origin === 'redo')).toEqual([{
        blockId: 'q1',
        type: 'update',
        origin: 'redo',
        scope: 'keys',
        native: {
          type: 'database-row',
          parent: { present: true, value: 'db2' },
          template: { present: false },
        },
        changes: [{
          path: ['properties', 'structured'],
          beforePresent: true,
          afterPresent: true,
          after: next,
        }],
      }]);
      expect((await saved('q1'))?.data.properties).toEqual({
        name: 'Existing', n2: 'Untouched source note', structured: next,
      });
      expect(triggers).toEqual([]);
    } finally {
      current.events.off('block replayed', onReplay);
    }
  });

  it('persists property undo and redo without firing automation triggers', async () => {
    const blocks = doc();
    const backend = backendFor(blocks, 'db');
    const triggers: DatabaseAutomationTrigger[] = [];

    await make(blocks, { db: {
      adapter: backend.adapter,
      automations: { onTrigger: (trigger) => { triggers.push(trigger); } },
    } });
    editor?.blocks.getById('db')?.call('writeRelatedRow', { rowId: 'r1', changes: { notes: 'local edit' }, done: () => undefined });
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    const userTriggers = [...triggers];

    triggers.length = 0;

    editor?.history.undo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect(triggers).toEqual([]);
    expect(userTriggers).toEqual([{ type: 'propertyEdited', rowId: 'r1', propertyId: 'notes', value: 'local edit' }]);
    expect(backend.rows.get('r1')?.properties.notes).toBe('short');
    expect((await saved('r1'))?.data.properties.notes).toBe('short');

    editor?.history.redo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect(triggers).toEqual([]);
    expect(backend.rows.get('r1')?.properties.notes).toBe('local edit');
    expect((await saved('r1'))?.data.properties.notes).toBe('local edit');
  });

  it('persists Move to row recreation without firing pageAdded on undo or redo', async () => {
    const blocks = doc();
    const source = backendFor(blocks, 'db');
    const target = backendFor(blocks, 'db2');
    const triggers: DatabaseAutomationTrigger[] = [];
    const automations = { onTrigger: (trigger: DatabaseAutomationTrigger): void => { triggers.push(trigger); } };

    await make(blocks, {
      db: { adapter: source.adapter, automations },
      db2: { adapter: target.adapter, automations },
    });
    editor?.blocks.getById('db')?.call('moveRowTo', { rowId: 'r1', databaseId: 'db2' });
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    const userTriggers = [...triggers];

    triggers.length = 0;

    editor?.history.undo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect(triggers).toEqual([]);
    expect(userTriggers).toEqual([{ type: 'pageAdded', rowId: 'r1', properties: { name: 'Alpha', n2: 'short', s2: 'o-b2' } }]);
    expect(source.rows.has('r1')).toBe(true);
    expect(target.rows.has('r1')).toBe(false);
    expect((await saved('r1'))?.parent).toBe('db');

    editor?.history.redo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect(triggers).toEqual([]);
    expect(source.rows.has('r1')).toBe(false);
    expect(target.rows.has('r1')).toBe(true);
    expect((await saved('r1'))?.parent).toBe('db2');
  });

  it('clears a backend number when undo removes its previously absent row key', async () => {
    const blocks = doc();

    blocks[0] = { ...blocks[0], data: { ...blocks[0].data, views: [{ ...view, visibleProperties: ['amount'] }] } };
    const backend = backendFor(blocks, 'db');

    await make(blocks, { db: { adapter: backend.adapter } });
    const cell = holder?.querySelector<HTMLElement>('[data-blok-id="db"] [data-row-id="r2"] [role="gridcell"][data-property-id="amount"]');

    if (cell === null || cell === undefined) throw new Error('missing empty number cell');
    cell.click();
    await quiet();
    const input = document.querySelector<HTMLInputElement>('[data-blok-database-cell-input="number"]');

    if (input === null) throw new Error('number cell did not open an editor');
    input.value = '42';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    const forwardValue = backend.rows.get('r2')?.properties.amount;

    editor?.history.undo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    const restored = backend.rows.get('r2');

    expect(restored === undefined ? 'missing row' : restored.properties.amount ?? null).toBeNull();
    expect(forwardValue).toBe(42);
    expect(restored?.properties.t).toBe('Bravo');
    expect((await saved('r2'))?.data.properties).toEqual({ t: 'Bravo' });
    editor?.history.redo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect(backend.rows.get('r2')?.properties.amount).toBe(42);
    expect((await saved('r2'))?.data.properties).toEqual({ t: 'Bravo', amount: 42 });
  });

  it('does not send the undone value from a queued backend update', async () => {
    const blocks = doc();
    const backend = backendFor(blocks, 'db');

    await make(blocks, { db: { adapter: backend.adapter } });
    editor?.blocks.getById('db')?.call('writeRelatedRow', { rowId: 'r1', changes: { notes: 'changed' } });
    await quiet();
    editor?.history.undo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect(backend.rows.get('r1')?.properties.notes).toBe('short');
    expect((await saved('r1'))?.data.properties.notes).toBe('short');
  });

  it('persists position-only undo and redo after an unsorted table row drag', async () => {
    const blocks = doc();
    const backend = backendFor(blocks, 'db');

    await make(blocks, { db: { adapter: backend.adapter } });
    const rows = Array.from(holder?.querySelectorAll<HTMLElement>('[data-blok-id="db"] [data-blok-database-table-row]') ?? []);

    rows.forEach((row, index) => {
      vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, index * 38, 800, 38));
    });
    const dragged = rows.find((row) => row.getAttribute('data-row-id') === 'r2');
    const handle = dragged?.querySelector<HTMLElement>('[data-blok-database-table-row-handle]');

    if (handle === null || handle === undefined) throw new Error('missing row drag handle');
    handle.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 10, clientY: 57, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 5, bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await quiet();
    const movedPosition = (await saved('r2'))?.data.position;
    const forwardPosition = backend.rows.get('r2')?.position;
    const forwardOrder = shownRows('db');

    editor?.history.undo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect(backend.rows.get('r2')?.position).toBe('a1');
    expect(typeof movedPosition === 'string' && movedPosition < 'a0').toBe(true);
    expect(forwardPosition).toBe(movedPosition);
    expect(forwardOrder).toEqual(['r2', 'r1']);
    expect((await saved('r2'))?.data.position).toBe('a1');
    expect(shownRows('db')).toEqual(['r1', 'r2']);
    expect(backend.rows.get('r2')?.properties).toEqual({ t: 'Bravo' });
    editor?.history.redo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect(backend.rows.get('r2')?.position).toBe(movedPosition);
    expect((await saved('r2'))?.data.position).toBe(movedPosition);
    expect(shownRows('db')).toEqual(['r2', 'r1']);
    expect(backend.rows.get('r2')?.properties).toEqual({ t: 'Bravo' });
  });

  it('persists Move to undo and redo to both database adapters', async () => {
    const blocks = doc();
    const source = backendFor(blocks, 'db');
    const target = backendFor(blocks, 'db2');
    const current = await make(blocks, {
      db: { adapter: source.adapter },
      db2: { adapter: target.adapter },
    });
    const sourceTool = current.blocks.getById('db');
    const replayCaptures: BlockReplayCapture[] = [];
    const onReplay = (capture: BlockReplayCapture): void => {
      if (capture.blockId === 'r1') replayCaptures.push(capture);
    };

    if (sourceTool === null) throw new Error('missing source database');
    current.events.on('block replayed', onReplay);
    try {
      sourceTool.call('moveRowTo', { rowId: 'r1', databaseId: 'db2' });
      await quiet();
      current.history.undo();
      await quiet();
      await new Promise((resolve) => { setTimeout(resolve, 650); });
      const nativeRow = await saved('r1');
      const undoCaptures = replayCaptures.filter((capture) => capture.origin === 'undo');

      console.info('MOVE_TO_UNDO_PROVENANCE', JSON.stringify({
        nativeRow,
        sourceRow: source.rows.get('r1'),
        targetRow: target.rows.get('r1'),
        undoCaptures,
      }));
      expect(source.rows.get('r1')?.properties).toEqual({
        t: 'Alpha', notes: 'short', amount: 12, stage: 'o-build', done: true,
      });
      expect(target.rows.has('r1')).toBe(false);
      expect(nativeRow?.parent).toBe('db');
      expect(nativeRow?.data.properties).toEqual({
        t: 'Alpha', notes: 'short', amount: 12, stage: 'o-build', done: true,
      });
      expect(undoCaptures).toEqual(expect.arrayContaining([expect.objectContaining({
        blockId: 'r1',
        type: 'update',
        origin: 'undo',
        scope: 'unknown',
        native: {
          type: 'database-row',
          parent: { present: true, value: 'db' },
          template: { present: false },
        },
        changes: [],
      })]));
      current.history.redo();
      await quiet();
      await new Promise((resolve) => { setTimeout(resolve, 650); });

      expect(source.rows.has('r1')).toBe(false);
      expect(target.rows.get('r1')?.properties).toEqual({
        name: 'Alpha', n2: 'short', s2: 'o-b2',
      });
    } finally {
      current.events.off('block replayed', onReplay);
    }
  });

  it('does not create a row twice when Move to undo could not sync a place property', async () => {
    const blocks = doc().map((block) => {
      if (block.id === 'db') {
        const data = block.data as DatabaseData;

        return { ...block, data: { ...data, schema: [...data.schema, { id: 'where', name: 'Where', type: 'place', position: 'a9' }] } };
      }
      if (block.id !== 'r1') return block;
      const data = block.data as DatabaseRowData;

      return { ...block, data: { ...data, properties: { ...data.properties, where: { address: 'Main St' } } } };
    });
    const source = backendFor(blocks, 'db');
    const target = backendFor(blocks, 'db2');
    const current = await make(blocks, { db: { adapter: source.adapter }, db2: { adapter: target.adapter } });
    const sourceTool = current.blocks.getById('db');

    if (sourceTool === null) throw new Error('missing source database');
    sourceTool.call('moveRowTo', { rowId: 'r1', databaseId: 'db2' });
    await quiet();
    const targetCreate = vi.spyOn(target.adapter, 'createRow');

    current.history.undo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    current.history.redo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect(targetCreate).not.toHaveBeenCalled();
    expect(target.rows.has('r1')).toBe(true);
    expect(source.rows.has('r1')).toBe(false);
  });

  it('keeps the moved row in a backend when the source is read-only during Move to undo', async () => {
    const blocks = doc();
    const source = backendFor(blocks, 'db');
    const target = backendFor(blocks, 'db2');
    const current = await make(blocks, { db: { adapter: source.adapter }, db2: { adapter: target.adapter } });
    const sourceTool = current.blocks.getById('db');

    if (sourceTool === null) throw new Error('missing source database');
    sourceTool.call('moveRowTo', { rowId: 'r1', databaseId: 'db2' });
    await quiet();
    sourceTool.call('dashboardCapabilitySetReadOnly', { readOnly: true });
    current.history.undo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect(target.rows.has('r1')).toBe(true);
    sourceTool.call('dashboardCapabilitySetReadOnly', { readOnly: false });
    const targetCreate = vi.spyOn(target.adapter, 'createRow');

    current.history.redo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect(targetCreate).not.toHaveBeenCalled();
    expect(target.rows.has('r1')).toBe(true);
  });

  it('sends nothing to the backends when a host move between databases is undone and redone', async () => {
    const blocks = doc();
    const source = backendFor(blocks, 'db');
    const target = backendFor(blocks, 'db2');
    const current = await make(blocks, { db: { adapter: source.adapter }, db2: { adapter: target.adapter } });
    const calls = [
      vi.spyOn(source.adapter, 'createRow'), vi.spyOn(source.adapter, 'deleteRow'),
      vi.spyOn(target.adapter, 'createRow'), vi.spyOn(target.adapter, 'deleteRow'),
    ];

    current.blocks.moveTo('r1', { parentId: 'db2', position: 'end' });
    await quiet();
    current.history.undo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    current.history.redo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect(calls.map((call) => call.mock.calls.length)).toEqual([0, 0, 0, 0]);
    expect(source.rows.has('r1')).toBe(true);
    expect(target.rows.has('r1')).toBe(false);
  });

  it('persists Move to undo and redo of a row that holds people', async () => {
    const owner = (id: string): PropertyDefinition => ({ id, name: 'Owner', type: 'person', position: 'a9' });
    const blocks = doc().map((block) => {
      if (block.id === 'db' || block.id === 'db2') {
        const data = block.data as DatabaseData;

        return { ...block, data: { ...data, schema: [...data.schema, owner(block.id === 'db' ? 'owner' : 'o2')] } };
      }
      if (block.id !== 'r1') return block;
      const data = block.data as DatabaseRowData;

      return { ...block, data: { ...data, properties: { ...data.properties, owner: [{ id: 'p1' }] } } };
    });
    const source = backendFor(blocks, 'db');
    const target = backendFor(blocks, 'db2');
    const current = await make(blocks, { db: { adapter: source.adapter }, db2: { adapter: target.adapter } });
    const sourceTool = current.blocks.getById('db');

    if (sourceTool === null) throw new Error('missing source database');
    sourceTool.call('moveRowTo', { rowId: 'r1', databaseId: 'db2' });
    await quiet();
    current.history.undo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect(source.rows.get('r1')?.properties.owner).toEqual([{ id: 'p1' }]);
    expect(target.rows.has('r1')).toBe(false);
    current.history.redo();
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect(target.rows.get('r1')?.properties.o2).toEqual([{ id: 'p1' }]);
    expect(source.rows.has('r1')).toBe(false);
  });

  it('persists a recurring-template row without firing pageAdded', async () => {
    const blocks = doc();

    blocks[0] = { ...blocks[0], content: ['r1', 'r2', 'tpl'] };
    blocks.push({
      id: 'tpl',
      type: 'database-row',
      parent: 'db',
      data: {
        properties: { t: 'Recurring' },
        position: 'a2',
        template: true,
        repeat: { frequency: 'daily', start: new Date(Date.now() - 86_400_000).toISOString() },
      },
    });
    const backend = backendFor(blocks, 'db');
    const triggers: DatabaseAutomationTrigger[] = [];
    let due: Parameters<NonNullable<DatabaseTemplates['onRepeatDue']>>[0] | undefined;

    await make(blocks, {
      db: {
        adapter: backend.adapter,
        automations: { onTrigger: (trigger) => { triggers.push(trigger); } },
        templates: { onRepeatDue: (input) => { due = input; } },
      },
    });
    if (due === undefined) throw new Error('repeat run was not offered');
    const id = due.createRow();

    if (id === null) throw new Error('repeat row was not created');
    await quiet();

    expect(triggers.filter((trigger) => trigger.type === 'pageAdded')).toEqual([]);
    expect((await saved(id))?.data.properties.t).toBe('Recurring');
    expect(backend.rows.get(id)?.properties.t).toBe('Recurring');
  });

  it('persists a locked database edit without firing propertyEdited', async () => {
    const blocks = doc();
    const data = blocks[0].data as DatabaseData;

    blocks[0] = { ...blocks[0], data: { ...data, schema: data.schema.map((property) => property.type === 'title' ? { ...property, databaseLocked: true } : property) } };
    const backend = backendFor(blocks, 'db');
    const triggers: DatabaseAutomationTrigger[] = [];

    await make(blocks, {
      db: {
        adapter: backend.adapter,
        automations: { onTrigger: (trigger) => { triggers.push(trigger); } },
      },
    });
    editor?.blocks.getById('db')?.call('writeRelatedRow', { rowId: 'r1', changes: { notes: 'changed while locked' } });
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect(triggers.filter((trigger) => trigger.type === 'propertyEdited')).toEqual([]);
    expect((await saved('r1'))?.data.properties.notes).toBe('changed while locked');
    expect(backend.rows.get('r1')?.properties.notes).toBe('changed while locked');
  });

  it('fills and persists a recurring-template row without firing any automation trigger', async () => {
    const blocks = doc();
    const data = blocks[0].data as DatabaseData;
    const summary: PropertyDefinition = {
      id: 'summary',
      name: 'Summary',
      type: 'text',
      position: 'a5',
      autofill: { mode: 'summary', onCreate: true },
    };
    const initial: Record<string, PropertyValue> = {
      t: 'Recurring',
      notes: 'Template notes',
      summary: 'Initial summary',
    };

    blocks[0] = { ...blocks[0], content: ['r1', 'r2', 'tpl'], data: { ...data, schema: [...data.schema, summary] } };
    blocks.push({
      id: 'tpl',
      type: 'database-row',
      parent: 'db',
      data: {
        properties: initial,
        position: 'a2',
        template: true,
        repeat: { frequency: 'daily', start: new Date(Date.now() - 86_400_000).toISOString() },
      },
    });
    const backend = backendFor(blocks, 'db');
    const triggers: DatabaseAutomationTrigger[] = [];
    const requests: DatabaseAutofillRequest[] = [];
    let answer: ((value: PropertyValue) => void) | undefined;
    let due: Parameters<NonNullable<DatabaseTemplates['onRepeatDue']>>[0] | undefined;
    const ai: DatabaseAI = {
      autofill: (request) => {
        requests.push(structuredClone(request));

        return new Promise<PropertyValue>((resolve) => { answer = resolve; });
      },
    };

    await make(blocks, {
      db: {
        adapter: backend.adapter,
        automations: { onTrigger: (trigger) => { triggers.push(structuredClone(trigger)); } },
        templates: { onRepeatDue: (input) => { due = input; } },
        ai,
      },
    });
    if (due === undefined) throw new Error('repeat run was not offered');
    const id = due.createRow();

    if (id === null) throw new Error('repeat row was not created');
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect(triggers).toEqual([]);
    expect((await saved(id))?.data.properties).toEqual(initial);
    expect((await saved(id))?.parent).toBe('db');
    expect(backend.rows.get(id)?.properties).toEqual(initial);
    const expectedRequest: DatabaseAutofillRequest = {
      databaseId: 'db',
      rowId: id,
      propertyId: 'summary',
      settings: { mode: 'summary', onCreate: true },
      values: initial,
    };

    expect(requests).toEqual([expectedRequest]);
    if (answer === undefined) throw new Error('recurring row did not request autofill');
    answer('Recurring AI summary');
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    const filled = { ...initial, summary: 'Recurring AI summary' };

    expect(triggers).toEqual([]);
    expect((await saved(id))?.data.properties).toEqual(filled);
    expect(backend.rows.get(id)?.properties).toEqual(filled);
    expect((await saved('tpl'))?.data.properties).toEqual(initial);
    expect(backend.rows.get('tpl')?.properties).toEqual(initial);
    expect(requests).toEqual([expectedRequest]);
  });

  it('fills and persists a locked database edit without firing any automation trigger', async () => {
    const blocks = doc();
    const data = blocks[0].data as DatabaseData;
    const summary: PropertyDefinition = {
      id: 'summary',
      name: 'Summary',
      type: 'text',
      position: 'a5',
      autofill: { mode: 'keyInfo', onEdit: true },
    };
    const initial: Record<string, PropertyValue> = {
      ...(blocks[1].data as Omit<DatabaseRow, 'id'>).properties,
      summary: 'Initial summary',
    };

    blocks[0] = {
      ...blocks[0],
      data: {
        ...data,
        schema: [...data.schema.map((property) => property.type === 'title' ? { ...property, databaseLocked: true } : property), summary],
      },
    };
    blocks[1] = { ...blocks[1], data: { ...blocks[1].data, properties: initial } };
    const backend = backendFor(blocks, 'db');
    const triggers: DatabaseAutomationTrigger[] = [];
    const requests: DatabaseAutofillRequest[] = [];
    let answer: ((value: PropertyValue) => void) | undefined;
    const ai: DatabaseAI = {
      autofill: (request) => {
        requests.push(structuredClone(request));

        return new Promise<PropertyValue>((resolve) => { answer = resolve; });
      },
    };
    const current = await make(blocks, {
      db: {
        adapter: backend.adapter,
        automations: { onTrigger: (trigger) => { triggers.push(structuredClone(trigger)); } },
        ai,
      },
    });
    const database = current.blocks.getById('db');

    if (database === null) throw new Error('missing database block');
    database.call('writeRelatedRow', { rowId: 'r1', changes: { notes: 'changed while locked' } });
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    const edited = { ...initial, notes: 'changed while locked' };

    expect(triggers).toEqual([]);
    expect((await saved('r1'))?.data.properties).toEqual(edited);
    expect(backend.rows.get('r1')?.properties).toEqual(edited);
    const expectedRequest: DatabaseAutofillRequest = {
      databaseId: 'db',
      rowId: 'r1',
      propertyId: 'summary',
      settings: { mode: 'keyInfo', onEdit: true },
      values: edited,
    };

    expect(requests).toEqual([expectedRequest]);
    if (answer === undefined) throw new Error('locked edit did not request autofill');
    answer('Locked AI summary');
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    const filled = { ...edited, summary: 'Locked AI summary' };

    expect(triggers).toEqual([]);
    expect((await saved('r1'))?.data.properties).toEqual(filled);
    expect(backend.rows.get('r1')?.properties).toEqual(filled);
    expect(requests).toEqual([expectedRequest]);
  });

  it('prefills an overflowing dashboard table paste from the widget filter, not the source active view', async () => {
    const blocks = dashboardOwnerDoc('db');
    const ownerData = blocks[0].data as DatabaseData;
    const sourceData = blocks[3].data as DatabaseData;

    blocks[0] = {
      ...blocks[0],
      data: {
        ...ownerData,
        views: ownerData.views.map((entry) => entry.id === 'source-v' ? {
          ...entry,
          visibleProperties: ['name', 'n2'],
          filters: [{ id: 'widget-filter', propertyId: 'done', operator: 'equals', value: 'Widget-filter' }],
        } : entry),
      },
    };
    blocks[3] = {
      ...blocks[3],
      data: {
        ...sourceData,
        views: sourceData.views.map((entry) => ({
          ...entry,
          filters: [{ id: 'source-filter', propertyId: 'done', operator: 'equals', value: 'Source-filter' }],
        })),
      },
    };
    const prepared = blocks.map((block) => ['q1', 'q2'].includes(block.id ?? '') ? {
      ...block,
      data: {
        ...block.data,
        properties: { ...(block.data as Omit<DatabaseRow, 'id'>).properties, done: 'Widget-filter' },
      },
    } : block);
    const source = backendFor(prepared, 'db2');
    const local = backendFor(prepared, 'db');
    const localCreate = vi.spyOn(local.adapter, 'createRow');
    const current = await make(prepared, { db: { adapter: local.adapter }, db2: { adapter: source.adapter } });
    const grid = await dashboardPasteDropSelect(() => dashboardWidget('foreign'), 'q2', 'name');

    const pasteConsumed = dashboardPasteDropPaste(grid, 'Pasted existing\tPasted note\nNew from overflow\tNew note');
    await dashboardPasteDropDrain();
    const output = await current.save();
    const created = output.blocks.find((block) =>
      block.type === 'database-row' && block.parent === 'db2' && !['q1', 'q2'].includes(block.id ?? '')
    );

    expect(created?.data.properties).toEqual({
      name: 'New from overflow', n2: 'New note', done: 'Widget-filter',
    });
    expect(pasteConsumed).toBe(true);
    if (created?.id === undefined) throw new Error('overflow paste created no source row');
    expect(created.parent).toBe('db2');
    expect(source.rows.get(created.id)?.properties).toEqual(created.data.properties);
    expect((await saved('q2'))?.data.properties).toEqual({
      name: 'Pasted existing', n2: 'Pasted note', done: 'Widget-filter',
    });
    expect(source.rows.get('q2')?.properties).toEqual({
      name: 'Pasted existing', n2: 'Pasted note', done: 'Widget-filter',
    });
    expect((await saved('q1'))?.data.properties).toEqual({
      name: 'Existing', n2: 'Source note', done: 'Widget-filter',
    });
    expect(localCreate).not.toHaveBeenCalled();
    expect(local.rows.has(created.id)).toBe(false);
    expect(local.rows.get('r1')?.properties.notes).toBe('short');
    expect(current.blocks.getChildren('db').filter((child) => child.name === 'database-row').map((child) => child.id))
      .toEqual(['r1', 'r2']);
    expect(dashboardWidget('twin').querySelector(
      '[data-row-id="' + CSS.escape(created.id) + '"] [role="gridcell"][data-property-id="name"]'
    )?.textContent).toContain('New from overflow');
    expect(dashboardWidget('local').querySelector(
      '[data-row-id="r1"] [data-blok-database-list-row-property][data-property-id="notes"]'
    )?.textContent).toBe('short');
    expect(output.blocks.find((block) => block.id === 'db')?.data.activeViewId).toBe('dash');
    expect(output.blocks.find((block) => block.id === 'db2')?.data.activeViewId).toBe('v');
  });

  it('a grouped dashboard table drop writes the widget group property, not the source active group property', async () => {
    const blocks = dashboardOwnerDoc('db');
    const ownerData = blocks[0].data as DatabaseData;
    const sourceData = blocks[3].data as DatabaseData;

    blocks[0] = {
      ...blocks[0],
      data: {
        ...ownerData,
        views: ownerData.views.map((entry) => entry.id === 'source-v'
          ? { ...entry, groupBy: 'done', groupSettings: { textBy: 'exact' } } : entry),
      },
    };
    blocks[3] = {
      ...blocks[3],
      data: {
        ...sourceData,
        views: sourceData.views.map((entry) => ({
          ...entry, groupBy: 'n2', groupSettings: { textBy: 'exact' },
        })),
      },
    };
    const source = backendFor(blocks, 'db2');
    const local = backendFor(blocks, 'db');
    const localUpdate = vi.spyOn(local.adapter, 'updateRow');
    const current = await make(blocks, { db: { adapter: local.adapter }, db2: { adapter: source.adapter } });
    const grid = dashboardPasteDropElement(dashboardWidget('foreign'), '[data-blok-database-table-grid]');

    dashboardPasteDropDrag(grid, 'q1', 'q2', 'after');
    await dashboardPasteDropDrain();

    expect((await saved('q1'))?.data.properties.done).toBe('Second done');
    expect((await saved('q1'))?.data.properties.n2).toBe('Source note');
    expect((await saved('q1'))?.parent).toBe('db2');
    expect((await saved('q2'))?.data.properties).toEqual({
      name: 'Second', n2: 'Second note', done: 'Second done',
    });
    expect(source.rows.get('q1')?.properties).toEqual({
      name: 'Existing', n2: 'Source note', done: 'Second done',
    });
    const moved = await saved('q1');
    const after = await saved('q2');

    expect((moved?.data.position ?? '') > (after?.data.position ?? '')).toBe(true);
    expect(source.rows.get('q1')?.position).toBe((await saved('q1'))?.data.position);
    expect(localUpdate).not.toHaveBeenCalled();
    expect(local.rows.get('r1')?.properties.notes).toBe('short');
    expect(dashboardWidget('twin').querySelector(
      '[data-blok-database-table-row][data-row-id="q1"]'
    )?.getAttribute('data-group-key')).toBe('Second done');
    expect(dashboardWidget('local').querySelector(
      '[data-row-id="r1"] [data-blok-database-list-row-property][data-property-id="notes"]'
    )?.textContent).toBe('short');
    const output = await current.save();
    const definition = output.blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;
    const sourceDefinition = output.blocks.find((block) => block.id === 'db2')?.data as DatabaseData | undefined;

    expect(definition?.views.find((entry) => entry.id === 'source-v')?.groupBy).toBe('done');
    expect(sourceDefinition?.views.find((entry) => entry.id === 'v')?.groupBy).toBe('n2');
    expect(definition?.activeViewId).toBe('dash');
    expect(sourceDefinition?.activeViewId).toBe('v');
  });

  it('confirming a sorted dashboard table drop clears only the widget definition owner sort', async () => {
    const blocks = dashboardOwnerDoc('db');
    const ownerData = blocks[0].data as DatabaseData;
    const sourceData = blocks[3].data as DatabaseData;
    const widgetSort: DatabaseData['views'][number]['sorts'] = [
      { id: 'widget-name-sort', propertyId: 'name', direction: 'desc' },
    ];
    const sourceSort: DatabaseData['views'][number]['sorts'] = [
      { id: 'source-note-sort', propertyId: 'n2', direction: 'asc' },
    ];
    const dashboardSort: DatabaseData['views'][number]['sorts'] = [
      { id: 'dashboard-amount-sort', propertyId: 'amount', direction: 'asc' },
    ];

    blocks[0] = {
      ...blocks[0],
      data: {
        ...ownerData,
        views: ownerData.views.map((entry) => {
          if (entry.id === 'source-v') return { ...entry, sorts: widgetSort };
          if (entry.id === 'dash') return { ...entry, sorts: dashboardSort };
          return entry;
        }),
      },
    };
    blocks[3] = {
      ...blocks[3],
      data: { ...sourceData, views: sourceData.views.map((entry) => ({ ...entry, sorts: sourceSort })) },
    };
    const source = backendFor(blocks, 'db2');
    const local = backendFor(blocks, 'db');
    const sourceViewUpdate = vi.spyOn(source.adapter, 'updateView');
    const localViewUpdate = vi.spyOn(local.adapter, 'updateView');
    const current = await make(blocks, { db: { adapter: local.adapter }, db2: { adapter: source.adapter } });
    const grid = dashboardPasteDropElement(dashboardWidget('foreign'), '[data-blok-database-table-grid]');

    dashboardPasteDropDrag(grid, 'q1', 'q2', 'before');
    await quiet();
    const confirm = document.querySelector<HTMLButtonElement>('[data-blok-database-confirm-action="confirm"]');

    if (confirm === null) throw new Error('sorted native drop opened no remove-sorting confirmation');
    confirm.click();
    await dashboardPasteDropDrain();
    const output = await current.save();
    const definition = output.blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;
    const sourceDefinition = output.blocks.find((block) => block.id === 'db2')?.data as DatabaseData | undefined;

    expect(definition?.views.find((entry) => entry.id === 'source-v')?.sorts).toEqual([]);
    expect(sourceDefinition?.views.find((entry) => entry.id === 'v')?.sorts).toEqual(sourceSort);
    expect(definition?.views.find((entry) => entry.id === 'dash')?.sorts).toEqual(dashboardSort);
    expect(localViewUpdate.mock.calls.map(([params]) => ({ viewId: params.viewId, changes: params.changes })))
      .toEqual([{ viewId: 'source-v', changes: { sorts: [] } }]);
    expect(sourceViewUpdate).not.toHaveBeenCalled();
    expect((await saved('q1'))?.data.properties).toEqual({
      name: 'Existing', n2: 'Source note', done: 'Source done',
    });
    expect((await saved('q2'))?.data.properties).toEqual({
      name: 'Second', n2: 'Second note', done: 'Second done',
    });
    const widgetOrder = (widgetId: string): string[] =>
      [...dashboardWidget(widgetId).querySelectorAll<HTMLElement>('[data-blok-database-table-row]')]
        .map((row) => row.getAttribute('data-row-id') ?? '');

    expect(widgetOrder('foreign')).toEqual(['q1', 'q2']);
    expect(widgetOrder('twin')).toEqual(['q1', 'q2']);
    expect(source.rows.get('q1')?.position).toBe((await saved('q1'))?.data.position);
    expect(source.rows.get('q2')?.position).toBe((await saved('q2'))?.data.position);
    expect(local.rows.get('r1')?.properties.notes).toBe('short');
    expect(dashboardWidget('local').querySelector(
      '[data-row-id="r1"] [data-blok-database-list-row-property][data-property-id="notes"]'
    )?.textContent).toBe('short');
    expect(definition?.activeViewId).toBe('dash');
    expect(sourceDefinition?.activeViewId).toBe('v');
  });

  it('revoking a dashboard owner denies paste from the old native grid while its source still accepts paste', async () => {
    const blocks = dashboardOwnerDoc('db');
    const source = backendFor(blocks, 'db2');
    const local = backendFor(blocks, 'db');
    const sourceUpdate = vi.spyOn(source.adapter, 'updateRow');
    const sourceCreate = vi.spyOn(source.adapter, 'createRow');
    const current = await make(blocks, {
      db: { adapter: local.adapter },
      db2: { adapter: source.adapter },
    });
    const grid = await dashboardPasteDropSelect(() => dashboardWidget('foreign'), 'q2', 'name');

    const selectedBeforeRevocation = grid.querySelectorAll('[role="gridcell"][aria-selected="true"]').length;
    const owner = current.blocks.getById('db');

    if (owner === null) throw new Error('missing dashboard owner');
    owner.call('dashboardCapabilitySetReadOnly', { readOnly: true });
    const denied: boolean[] = [];

    owner.call('readRowWritePermission', { receive: (value: boolean): void => { denied.push(value); } });
    dashboardPasteDropPaste(grid, 'Denied existing\tDenied note\nDenied overflow\tDenied new note');
    await dashboardPasteDropDrain();

    expect((await saved('q2'))?.data.properties).toEqual({
      name: 'Second', n2: 'Second note', done: 'Second done',
    });
    expect(denied).toEqual([false]);
    expect(selectedBeforeRevocation).toBe(1);
    expect(current.blocks.getChildren('db2').filter((child) => child.name === 'database-row').map((child) => child.id))
      .toEqual(['q1', 'q2']);
    expect(sourceUpdate).not.toHaveBeenCalled();
    expect(sourceCreate).not.toHaveBeenCalled();
    expect(source.rows.get('q2')?.properties).toEqual({
      name: 'Second', n2: 'Second note', done: 'Second done',
    });
    expect(source.rows.size).toBe(2);
    expect(local.rows.get('r1')?.properties.notes).toBe('short');
    expect(dashboardWidget('local').querySelector(
      '[data-row-id="r1"] [data-blok-database-list-row-property][data-property-id="notes"]'
    )?.textContent).toBe('short');

    const surviving = await dashboardPasteDropSelect(dashboardPasteDropSourceRoot, 'q2', 'name');

    dashboardPasteDropPaste(surviving, 'Source positive\tSource positive note\nSource new page\tSource new note');
    await dashboardPasteDropDrain();
    const output = await current.save();
    const created = output.blocks.find((block) =>
      block.parent === 'db2' && block.type === 'database-row' && !['q1', 'q2'].includes(block.id ?? '')
    );

    expect((await saved('q2'))?.data.properties.name).toBe('Source positive');
    expect((await saved('q2'))?.data.properties.n2).toBe('Source positive note');
    expect(source.rows.get('q2')?.properties.name).toBe('Source positive');
    expect(sourceUpdate.mock.calls.some(([params]) => params.rowId === 'q2' && params.properties.name === 'Source positive'))
      .toBe(true);
    expect(created?.data.properties).toEqual({ name: 'Source new page', n2: 'Source new note' });
    if (created?.id === undefined) throw new Error('source positive paste created no row');
    expect(source.rows.get(created.id)?.properties).toEqual(created.data.properties);
    expect(sourceCreate).toHaveBeenCalledTimes(1);
    expect(local.rows.has(created.id)).toBe(false);
    expect((await saved('q1'))?.data.properties.n2).toBe('Source note');
    expect((await saved('r1'))?.data.properties.notes).toBe('short');
    expect(output.blocks.find((block) => block.id === 'db')?.data.activeViewId).toBe('dash');
    expect(output.blocks.find((block) => block.id === 'db2')?.data.activeViewId).toBe('v');
  });

  it('revoking a dashboard owner denies fill from the old native grid while its source still accepts fill', async () => {
    const blocks = dashboardOwnerDoc('db');
    const source = backendFor(blocks, 'db2');
    const local = backendFor(blocks, 'db');
    const sourceUpdate = vi.spyOn(source.adapter, 'updateRow');
    const current = await make(blocks, {
      db: { adapter: local.adapter },
      db2: { adapter: source.adapter },
    });
    const grid = await dashboardPasteDropSelect(() => dashboardWidget('foreign'), 'q1', 'n2');

    grid.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true,
    }));
    const selectedBeforeRevocation = grid.querySelectorAll(
      '[role="gridcell"][data-property-id="n2"][aria-selected="true"]'
    ).length;

    const owner = current.blocks.getById('db');

    if (owner === null) throw new Error('missing dashboard owner');
    owner.call('dashboardCapabilitySetReadOnly', { readOnly: true });
    const denied: boolean[] = [];

    owner.call('readRowWritePermission', { receive: (value: boolean): void => { denied.push(value); } });
    dashboardPasteDropFillDown(grid);
    await dashboardPasteDropDrain();

    expect((await saved('q2'))?.data.properties.n2).toBe('Second note');
    expect(denied).toEqual([false]);
    expect(selectedBeforeRevocation).toBe(2);
    expect(sourceUpdate).not.toHaveBeenCalled();
    expect(source.rows.get('q2')?.properties.n2).toBe('Second note');
    expect((await saved('q1'))?.data.properties.n2).toBe('Source note');
    expect(local.rows.get('r1')?.properties.notes).toBe('short');
    expect(dashboardWidget('local').querySelector(
      '[data-row-id="r1"] [data-blok-database-list-row-property][data-property-id="notes"]'
    )?.textContent).toBe('short');

    const surviving = await dashboardPasteDropSelect(dashboardPasteDropSourceRoot, 'q1', 'n2');

    surviving.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true,
    }));
    dashboardPasteDropFillDown(surviving);
    await dashboardPasteDropDrain();

    expect((await saved('q2'))?.data.properties.n2).toBe('Source note');
    expect(source.rows.get('q2')?.properties.n2).toBe('Source note');
    expect(sourceUpdate.mock.calls.map(([params]) => ({ rowId: params.rowId, properties: params.properties })))
      .toEqual([{ rowId: 'q2', properties: { n2: 'Source note' } }]);
    expect((await saved('q2'))?.data.properties.done).toBe('Second done');
    expect((await saved('q2'))?.parent).toBe('db2');
    expect(current.blocks.getChildren('db2').filter((child) => child.name === 'database-row').map((child) => child.id))
      .toEqual(['q1', 'q2']);
    expect((await saved('r1'))?.data.properties.notes).toBe('short');
    const output = await current.save();

    expect(output.blocks.find((block) => block.id === 'db')?.data.activeViewId).toBe('dash');
    expect(output.blocks.find((block) => block.id === 'db2')?.data.activeViewId).toBe('v');
  });

  it.each(['db2', 'db'] as const)('commits a foreign dashboard table edit with its definition on %s', async (definitionOwner) => {
    const blocks = dashboardOwnerDoc(definitionOwner);
    const source = backendFor(blocks, 'db2');
    const local = backendFor(blocks, 'db');

    await make(blocks, { db: { adapter: local.adapter }, db2: { adapter: source.adapter } });
    const cell = dashboardWidget('foreign').querySelector<HTMLElement>(
      '[data-row-id="q1"] [role="gridcell"][data-property-id="n2"]'
    );

    if (cell === null) throw new Error('missing foreign text cell');
    cell.click();
    await commitDatabaseText('Edited in the foreign widget');

    expect((await saved('q1'))?.data.properties.n2).toBe('Edited in the foreign widget');
    expect((await saved('q1'))?.parent).toBe('db2');
    expect((await saved('r1'))?.data.properties).toEqual({
      t: 'Alpha', notes: 'short', amount: 12, stage: 'o-build', done: true,
    });
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    expect(source.rows.get('q1')?.properties.n2).toBe('Edited in the foreign widget');
    expect(local.rows.has('q1')).toBe(false);
    expect(local.rows.get('r1')?.properties.notes).toBe('short');
    expect(dashboardWidget('twin').querySelector(
      '[data-row-id="q1"] [role="gridcell"][data-property-id="n2"]'
    )?.textContent).toContain('Edited in the foreign widget');
    expect((await editor?.save())?.blocks.find((block) => block.id === 'db')?.data.activeViewId).toBe('dash');
    expect((await editor?.save())?.blocks.find((block) => block.id === 'db2')?.data.activeViewId).toBe('v');
  });

  it('commits a foreign dashboard list property to the source row', async () => {
    const blocks = dashboardOwnerDoc();
    const foreign = blocks[3].data as DatabaseData;

    blocks[3] = { ...blocks[3], data: { ...foreign, views: foreign.views.map((entry) => ({ ...entry, type: 'list' })) } };
    await make(blocks);
    const slot = dashboardWidget('foreign').querySelector<HTMLElement>(
      '[data-row-id="q1"] [data-blok-database-list-row-property][data-property-id="n2"]'
    );

    if (slot === null) throw new Error('missing foreign list property');
    slot.click();
    await commitDatabaseText('Edited in the foreign list');

    expect((await saved('q1'))?.data.properties.n2).toBe('Edited in the foreign list');
    expect((await saved('q1'))?.parent).toBe('db2');
    expect((await saved('r1'))?.data.properties.notes).toBe('short');
    expect(dashboardWidget('foreign').querySelector(
      '[data-row-id="q1"] [data-blok-database-list-row-property][data-property-id="n2"]'
    )?.textContent).toContain('Edited in the foreign list');
    expect([...(dashboardWidget('local').querySelectorAll<HTMLElement>('[data-blok-database-list-row]'))]
      .map((row) => row.getAttribute('data-row-id'))).toEqual(['r1', 'r2']);
  });

  it('Shift+Enter in a foreign dashboard list creates and titles a source row in that widget', async () => {
    const blocks = dashboardOwnerDoc();
    const foreign = blocks[3].data as DatabaseData;

    blocks[3] = { ...blocks[3], data: { ...foreign, views: foreign.views.map((entry) => ({ ...entry, type: 'list' })) } };
    const current = await make(blocks);
    const row = dashboardWidget('foreign').querySelector<HTMLElement>('[data-blok-database-list-row][data-row-id="q1"]');

    if (row === null) throw new Error('missing foreign list row');
    row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', shiftKey: true, bubbles: true, cancelable: true,
    }));
    await quiet();
    const created = current.blocks.getChildren('db2')
      .find((child) => child.name === 'database-row' && !['q1', 'q2'].includes(child.id));

    expect(created?.parentId).toBe('db2');
    if (created === undefined) throw new Error('missing source row');
    const input = dashboardWidget('foreign').querySelector<HTMLInputElement>(
      `[data-row-id="${CSS.escape(created.id)}"] [data-blok-database-list-title-input]`
    );

    if (input === null) throw new Error('missing inline title in the originating widget');
    input.value = 'New source page';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await quiet();

    expect((await saved(created.id))?.data.properties.name).toBe('New source page');
    expect((await saved(created.id))?.data.title).toBe('New source page');
    expect((await saved(created.id))?.parent).toBe('db2');
    expect(current.blocks.getChildren('db').filter((child) => child.name === 'database-row').map((child) => child.id))
      .toEqual(['r1', 'r2']);
    expect(dashboardWidget('foreign').querySelector(
      `[data-row-id="${CSS.escape(created.id)}"] [data-blok-database-list-row-title]`
    )?.textContent).toBe('New source page');
  });

  it('edits different rows through duplicate native table widgets independently', async () => {
    await make(dashboardOwnerDoc());
    const first = dashboardWidget('foreign').querySelector<HTMLElement>(
      '[data-row-id="q1"] [role="gridcell"][data-property-id="n2"]'
    );

    if (first === null) throw new Error('missing first widget cell');
    first.click();
    await commitDatabaseText('First widget edit');
    const second = dashboardWidget('twin').querySelector<HTMLElement>(
      '[data-row-id="q2"] [role="gridcell"][data-property-id="done"]'
    );

    if (second === null) throw new Error('missing second widget cell');
    second.click();
    await commitDatabaseText('Second widget edit');

    expect([
      (await saved('q1'))?.data.properties.n2,
      (await saved('q2'))?.data.properties.done,
    ]).toEqual(['First widget edit', 'Second widget edit']);
    expect((await saved('q1'))?.data.properties.done).toBe('Source done');
    expect((await saved('q2'))?.data.properties.n2).toBe('Second note');
    expect(dashboardWidget('foreign').querySelector(
      '[data-row-id="q2"] [role="gridcell"][data-property-id="done"]'
    )?.textContent).toContain('Second widget edit');
    expect(dashboardWidget('twin').querySelector(
      '[data-row-id="q1"] [role="gridcell"][data-property-id="n2"]'
    )?.textContent).toContain('First widget edit');
    expect((await saved('r1'))?.data.properties.notes).toBe('short');
  });

  it('keeps duplicate table widget selection separate through a source definition redraw', async () => {
    const current = await make(dashboardOwnerDoc());
    const first = dashboardWidget('foreign').querySelector<HTMLElement>(
      '[data-row-id="q1"] [data-blok-database-table-row-checkbox]'
    );
    const second = dashboardWidget('twin').querySelector<HTMLElement>(
      '[data-row-id="q2"] [data-blok-database-table-row-checkbox]'
    );

    if (first === null || second === null) throw new Error('missing widget row checkbox');
    first.click();
    second.click();
    const selected = (widgetId: string): string[] =>
      [...dashboardWidget(widgetId).querySelectorAll<HTMLElement>('[data-blok-database-table-row][aria-selected="true"]')]
        .map((row) => row.getAttribute('data-row-id') ?? '');

    expect(selected('twin')).toEqual(['q2']);
    expect(selected('foreign')).toEqual(['q1']);
    expect(holder?.querySelectorAll('[data-blok-id="db2"] [data-blok-database-table-row][aria-selected="true"]')).toHaveLength(0);
    const output = await current.save();
    const foreign = output.blocks.find((block) => block.id === 'db2')?.data as DatabaseData | undefined;

    if (foreign === undefined) throw new Error('missing source database');
    await current.blocks.update('db2', {
      ...foreign,
      schema: foreign.schema.map((property) => property.id === 'n2' ? { ...property, name: 'Source notes' } : property),
    });
    await quiet();

    expect(selected('twin')).toEqual(['q2']);
    expect(selected('foreign')).toEqual(['q1']);
    expect(holder?.querySelectorAll('[data-blok-id="db2"] [data-blok-database-table-row][aria-selected="true"]')).toHaveLength(0);
  });

  it('refreshes foreign widget rows after public source row updates without corrupting the local list', async () => {
    const current = await make(dashboardOwnerDoc());
    const original = await saved('q1');

    if (original === undefined) throw new Error('missing source row');
    await current.blocks.update('q1', {
      properties: { ...original.data.properties, n2: 'Refreshed source note' },
    });
    await quiet();

    await vi.waitFor(() => expect(dashboardWidget('foreign').querySelector(
      '[data-row-id="q1"] [role="gridcell"][data-property-id="n2"]'
    )?.textContent).toContain('Refreshed source note'));
    expect(dashboardWidget('twin').querySelector(
      '[data-row-id="q1"] [role="gridcell"][data-property-id="n2"]'
    )?.textContent).toContain('Refreshed source note');
    expect([...(dashboardWidget('local').querySelectorAll<HTMLElement>('[data-blok-database-list-row]'))]
      .map((row) => row.getAttribute('data-row-id'))).toEqual(['r1', 'r2']);
    expect(dashboardWidget('local').querySelector(
      '[data-row-id="r1"] [data-blok-database-list-row-property][data-property-id="notes"]'
    )?.textContent).toBe('short');
    expect(holder?.querySelectorAll('[data-blok-id="db"] [data-blok-database-dashboard-widget]')).toHaveLength(3);
    const output = await current.save();

    expect(output.blocks.find((block) => block.id === 'db')?.data.activeViewId).toBe('dash');
    expect(output.blocks.find((block) => block.id === 'db2')?.data.activeViewId).toBe('v');
    expect(output.blocks.find((block) => block.id === 'q1')?.parent).toBe('db2');
    expect((await saved('r1'))?.data.properties.notes).toBe('short');
  });

  it('refreshes foreign widget schema and visibility through public source definition updates', async () => {
    const current = await make(dashboardOwnerDoc());
    const output = await current.save();
    const foreign = output.blocks.find((block) => block.id === 'db2')?.data as DatabaseData | undefined;

    if (foreign === undefined) throw new Error('missing source database');
    await current.blocks.update('db2', {
      ...foreign,
      schema: foreign.schema.map((property) => property.id === 'done' ? { ...property, name: 'Source done' } : property),
      views: foreign.views.map((entry) => ({ ...entry, visibleProperties: ['name', 'done'] })),
    });
    await quiet();

    await vi.waitFor(() => expect(dashboardWidget('foreign').querySelector(
      '[data-blok-database-table-column-header][data-property-id="done"]'
    )?.textContent).toContain('Source done'));
    expect(dashboardWidget('foreign').querySelector(
      '[data-blok-database-table-column-header][data-property-id="n2"]'
    )).toBeNull();
    expect(dashboardWidget('twin').querySelector(
      '[data-blok-database-table-column-header][data-property-id="done"]'
    )?.textContent).toContain('Source done');
    expect(dashboardWidget('local').querySelector(
      '[data-row-id="r1"] [data-blok-database-list-row-property][data-property-id="notes"]'
    )?.textContent).toBe('short');
    expect([...(dashboardWidget('local').querySelectorAll<HTMLElement>('[data-blok-database-list-row]'))]
      .map((row) => row.getAttribute('data-row-id'))).toEqual(['r1', 'r2']);
    expect(holder?.querySelectorAll('[data-blok-id="db"] [data-blok-database-dashboard-widget]')).toHaveLength(3);
    const next = await current.save();

    expect(next.blocks.find((block) => block.id === 'db')?.data.activeViewId).toBe('dash');
    expect(next.blocks.find((block) => block.id === 'db2')?.data.activeViewId).toBe('v');
    expect((await saved('q1'))?.data.properties.n2).toBe('Source note');
  });

  it.each([
    ['table', 'list'],
    ['list', 'table'],
  ] as const)('keeps a same-ID owner widget editable after %s becomes %s', async (beforeLayout, afterLayout) => {
    const blocks = dashboardPopupDoc();
    const ownerBlock = blocks.find((block) => block.id === 'view-owner');

    if (ownerBlock === undefined) throw new Error('missing layout owner fixture');
    const initialOwner = ownerBlock.data as DatabaseData;

    ownerBlock.data = {
      ...initialOwner,
      views: initialOwner.views.map((entry) => entry.id === 'owned-v' ? { ...entry, type: beforeLayout } : entry),
    };
    const current = await make(blocks);
    const sourceBefore = await dashboardPopupData(current, 'db2');
    const dashboardBefore = await dashboardPopupData(current, 'db');
    const oldWidget = dashboardWidget('foreign');
    const ownerBefore = await dashboardPopupData(current, 'view-owner');

    await current.blocks.update('view-owner', {
      ...ownerBefore,
      views: ownerBefore.views.map((entry) => entry.id === 'owned-v' ? { ...entry, type: afterLayout } : entry),
    });
    await quiet();
    const selector = afterLayout === 'table'
      ? '[data-row-id="q1"] [role="gridcell"][data-property-id="n2"]'
      : '[data-row-id="q1"] [data-blok-database-list-row-property][data-property-id="n2"]';

    await vi.waitFor(() => {
      if (dashboardWidget('foreign').querySelector(selector) === null) {
        throw new Error('replacement widget did not render its source property');
      }
    });
    const ownerAfterUpdate = await dashboardPopupData(current, 'view-owner');
    const slot = dashboardWidget('foreign').querySelector<HTMLElement>(selector);

    if (slot === null) throw new Error('missing replacement source property');
    slot.click();
    await quiet();
    const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      '[data-blok-database-cell-editor] [data-blok-database-cell-input="text"]'
    );
    const edited = 'Edited after owner layout replacement';

    if (input !== null) {
      input.value = edited;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    }
    await quiet();

    expect((await saved('q1'))?.data.properties.n2).toBe(edited);
    expect(input).not.toBeNull();
    expect(dashboardWidget('foreign')).not.toBe(oldWidget);
    expect((await saved('q1'))?.parent).toBe('db2');
    expect((await saved('q2'))?.data.properties.n2).toBe('Second note');
    expect((await saved('r1'))?.data.properties.notes).toBe('short');
    expect(await dashboardPopupData(current, 'view-owner')).toEqual(ownerAfterUpdate);
    expect(ownerAfterUpdate.views.find((entry) => entry.id === 'owned-v'))
      .toEqual({ ...ownerBefore.views.find((entry) => entry.id === 'owned-v'), type: afterLayout });
    expect(await dashboardPopupData(current, 'db2')).toEqual(sourceBefore);
    expect(await dashboardPopupData(current, 'db')).toEqual(dashboardBefore);
    expect(dashboardWidget('twin').querySelector(selector)?.textContent).toContain(edited);
  });

  it('refreshes Dashboard widget pills and rows after public owner view updates', async () => {
    const current = await make(dashboardPopupDoc());
    const ownerBefore = await dashboardPopupData(current, 'view-owner');
    const sourceBefore = await dashboardPopupData(current, 'db2');
    const firstFilters: DatabaseData['views'][number]['filters'] = [{
      id: 'public-owned-note-filter', propertyId: 'n2', operator: 'contains', value: 'Source note',
    }];

    await current.blocks.update('view-owner', {
      ...ownerBefore,
      views: ownerBefore.views.map((entry) => entry.id === 'owned-v' ? { ...entry, filters: firstFilters } : entry),
    });
    await quiet();

    await vi.waitFor(() => expect(dashboardWidget('foreign').querySelector(
      '[data-blok-database-filter-pill][data-filter-id="public-owned-note-filter"]'
    )?.textContent).toContain('Source note'));
    expect(dashboardNativeWidgetRows('foreign')).toEqual(['q1']);
    expect(dashboardNativeWidgetRows('twin')).toEqual(['q1']);
    expect(dashboardWidget('twin').querySelector(
      '[data-blok-database-filter-pill][data-filter-id="public-owned-note-filter"]'
    )?.textContent).toContain('Source note');
    expect(await dashboardPopupData(current, 'db2')).toEqual(sourceBefore);

    const secondFilters: DatabaseData['views'][number]['filters'] = [{
      id: 'public-owned-note-filter', propertyId: 'n2', operator: 'contains', value: 'Second note',
    }];
    const ownerAfterFirst = await dashboardPopupData(current, 'view-owner');

    await current.blocks.update('view-owner', {
      ...ownerAfterFirst,
      views: ownerAfterFirst.views.map((entry) => entry.id === 'owned-v' ? { ...entry, filters: secondFilters } : entry),
    });
    await quiet();

    await vi.waitFor(() => expect(dashboardWidget('foreign').querySelector(
      '[data-blok-database-filter-pill][data-filter-id="public-owned-note-filter"]'
    )?.textContent).toContain('Second note'));
    expect(dashboardNativeWidgetRows('foreign')).toEqual(['q2']);
    expect(dashboardNativeWidgetRows('twin')).toEqual(['q2']);
    expect(dashboardWidget('twin').querySelector(
      '[data-blok-database-filter-pill][data-filter-id="public-owned-note-filter"]'
    )?.textContent).toContain('Second note');
    expect(await dashboardPopupData(current, 'db2')).toEqual(sourceBefore);
    expect((await dashboardPopupData(current, 'view-owner')).views.find((entry) => entry.id === 'owned-v')?.filters)
      .toEqual(secondFilters);
    expect((await dashboardPopupData(current, 'view-owner')).activeViewId).toBe('owner-active');
    expect((await dashboardPopupData(current, 'db')).activeViewId).toBe('dash');
    expect([...dashboardWidget('local').querySelectorAll('[data-blok-database-list-row]')]
      .map((row) => row.getAttribute('data-row-id'))).toEqual(['r1', 'r2']);
    expect((await saved('q1'))?.data.properties.n2).toBe('Source note');
    expect((await saved('q2'))?.data.properties.n2).toBe('Second note');
  });

  it('auto-fits a redirected native table column on its definition owner, not its row source', async () => {
    const blocks = dashboardOwnerDoc('db');
    const local = blocks[0].data as DatabaseData;
    const foreign = blocks[3].data as DatabaseData;

    blocks[0] = {
      ...blocks[0],
      data: { ...local, views: local.views.map((entry) => entry.id === 'source-v'
        ? { ...entry, properties: [{ id: 'n2', width: 480 }] } : entry) },
    };
    blocks[3] = {
      ...blocks[3],
      data: { ...foreign, views: foreign.views.map((entry) => ({ ...entry, properties: [{ id: 'n2', width: 240 }] })) },
    };
    const current = await make(blocks);
    const header = dashboardWidget('foreign').querySelector<HTMLElement>(
      '[data-blok-database-table-column-header][data-property-id="n2"]'
    );
    const handle = header?.querySelector<HTMLElement>('[data-blok-database-table-resize]');

    if (header === null || handle === null || handle === undefined) throw new Error('missing native resize handle');
    handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    const fitted = Number.parseFloat(header.style.width);

    await quiet();
    const output = await current.save();
    const definition = output.blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;
    const source = output.blocks.find((block) => block.id === 'db2')?.data as DatabaseData | undefined;

    expect(definition?.views.find((entry) => entry.id === 'source-v')?.properties?.find((property) => property.id === 'n2')?.width)
      .toBe(fitted);
    expect(source?.views.find((entry) => entry.id === 'v')?.properties?.find((property) => property.id === 'n2')?.width)
      .toBe(240);
    expect(Number.isFinite(fitted)).toBe(true);
    expect(fitted).not.toBe(480);
    expect(definition?.views.find((entry) => entry.id === 'dash')?.properties).toBeUndefined();
    expect(definition?.activeViewId).toBe('dash');
    expect(source?.activeViewId).toBe('v');
    expect((await saved('q1'))?.data.properties.n2).toBe('Source note');
    expect(dashboardWidget('local').querySelector(
      '[data-row-id="r1"] [data-blok-database-list-row-property][data-property-id="notes"]'
    )?.textContent).toBe('short');
  });

  it('deleting a dashboard with a foreign native editor open makes no late source writes', async () => {
    const blocks = dashboardOwnerDoc();
    const source = backendFor(blocks, 'db2');
    const writes: Array<Parameters<DatabaseAdapter['updateRow']>[0]> = [];
    const adapter: DatabaseAdapter = {
      ...source.adapter,
      updateRow: async (params) => {
        writes.push(structuredClone(params));
        return source.adapter.updateRow(params);
      },
    };
    const current = await make(blocks, { db2: { adapter } });
    const cell = dashboardWidget('foreign').querySelector<HTMLElement>(
      '[data-row-id="q1"] [role="gridcell"][data-property-id="n2"]'
    );

    if (cell === null) throw new Error('missing foreign cell');
    cell.click();
    await quiet();
    const input = document.querySelector<HTMLTextAreaElement>(
      '[data-blok-database-cell-editor] [data-blok-database-cell-input="text"]'
    );

    if (input === null) throw new Error('missing active child input');
    input.value = 'Uncommitted widget draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const index = current.blocks.getBlockIndex('db');

    if (index === undefined) throw new Error('missing dashboard block');
    await current.blocks.delete(index, false);
    input.value = 'Late detached widget draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await quiet();
    await new Promise((resolve) => { setTimeout(resolve, 650); });

    expect((await saved('q1'))?.data.properties.n2).toBe('Source note');
    expect(writes).toEqual([]);
    expect(source.rows.get('q1')?.properties.n2).toBe('Source note');
    expect((await saved('q1'))?.parent).toBe('db2');
    expect(document.querySelector('[data-blok-database-cell-editor]')).toBeNull();
    expect(current.blocks.getById('db')).toBeNull();
    expect(holder?.querySelector('[data-blok-id="db2"] [data-blok-database-table]')).not.toBeNull();

    const surviving = holder?.querySelector<HTMLElement>(
      '[data-blok-id="db2"] [data-row-id="q1"] [role="gridcell"][data-property-id="n2"]'
    );

    if (surviving === null || surviving === undefined) throw new Error('missing surviving source cell');
    surviving.click();
    await commitDatabaseText('Surviving source edit');

    expect((await saved('q1'))?.data.properties.n2).toBe('Surviving source edit');
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    expect(source.rows.get('q1')?.properties.n2).toBe('Surviving source edit');
    expect(writes).toEqual([{ rowId: 'q1', properties: { n2: 'Surviving source edit' } }]);
  });


  it.each(['table', 'list'] as const)('widget Hide saves on its definition owner while the source active view is %s', async (sourceLayout) => {
    const blocks = dashboardNativeHeaderDoc(sourceLayout);
    const current = await make(blocks);
    const sourceBefore = (await current.save()).blocks.find((block) => block.id === 'db2')?.data;
    await dashboardNativeHeaderAction('Hide');
    const output = await editor?.save();
    const owner = output?.blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;
    const source = output?.blocks.find((block) => block.id === 'db2')?.data;

    expect(owner?.views.find((entry) => entry.id === 'source-v')?.properties)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: 'n2', visible: false })]));
    expect(source).toEqual(sourceBefore);
    expect(dashboardWidget('foreign').querySelector('[data-blok-database-table-column-header][data-property-id="n2"]')).toBeNull();
    expect(owner?.views.find((entry) => entry.id === 'local-list')?.visibleProperties).toEqual(['notes']);
    expect(owner?.activeViewId).toBe('dash');
  });

  it.each(['table', 'list'] as const)('widget Wrap saves on its definition owner while the source active view is %s', async (sourceLayout) => {
    const blocks = dashboardNativeHeaderDoc(sourceLayout);
    const current = await make(blocks);
    const sourceBefore = (await current.save()).blocks.find((block) => block.id === 'db2')?.data;
    const ownerBefore = (await current.save()).blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;

    // A new table column does not wrap, so the action is Wrap.
    await dashboardNativeHeaderAction('Wrap content');
    const output = await editor?.save();
    const owner = output?.blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;

    expect(owner?.views.find((entry) => entry.id === 'source-v')?.properties)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: 'n2', wrap: true })]));
    expect(output?.blocks.find((block) => block.id === 'db2')?.data).toEqual(sourceBefore);
    expect(owner?.views.find((entry) => entry.id === 'local-list')?.properties)
      .toEqual(ownerBefore?.views.find((entry) => entry.id === 'local-list')?.properties);
    expect(owner?.activeViewId).toBe('dash');
  });

  it.each(['table', 'list'] as const)('widget Freeze saves on its definition owner while the source active view is %s', async (sourceLayout) => {
    const blocks = dashboardNativeHeaderDoc(sourceLayout);
    const current = await make(blocks);
    const sourceBefore = (await current.save()).blocks.find((block) => block.id === 'db2')?.data;
    await dashboardNativeHeaderAction('Freeze up to column');
    const output = await editor?.save();
    const owner = output?.blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;

    expect(owner?.views.find((entry) => entry.id === 'source-v')?.frozenColumnCount).toBe(2);
    expect(output?.blocks.find((block) => block.id === 'db2')?.data).toEqual(sourceBefore);
    expect(owner?.views.find((entry) => entry.id === 'local-list')?.frozenColumnCount).toBeUndefined();
    expect(owner?.activeViewId).toBe('dash');
  });

  describe('dashboard personal-save authority', () => {
    const prepare = async (): Promise<{
      current: TestEditor;
      patches: Map<string, Partial<DatabaseData['views'][number]>>;
      key: string;
      personal: Partial<DatabaseData['views'][number]>;
      save: HTMLButtonElement;
    }> => {
      const patches = new Map<string, Partial<DatabaseData['views'][number]>>();
      const blocks = dashboardPopupDoc();
      const sourceIndex = blocks.findIndex((block) => block.id === 'db2');
      const source = blocks[sourceIndex];

      if (source === undefined) throw new Error('personal-save fixture has no source database');
      blocks[sourceIndex] = { ...source, content: [...(source.content ?? []), 'personal-save-excluded'] };
      blocks.push({
        id: 'personal-save-excluded', type: 'database-row', parent: 'db2',
        data: { properties: { name: 'Excluded', n2: 'Unrelated memo', done: 'Excluded done' }, position: 'a7' },
      });
      const current = await make(blocks, {
        db: { viewState: {
          get: async (key) => {
            const patch = patches.get(key);

            return patch === undefined ? null : structuredClone(patch);
          },
          set: async (key, patch) => { patches.set(key, structuredClone(patch)); },
        } },
      });

      await dashboardNativeHeaderAction('Filter');
      const input = document.querySelector<HTMLInputElement>('[data-blok-testid="database-filter-value"]');

      if (input === null) throw new Error('personal-save fixture did not open the widget filter');
      input.value = 'note';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await quiet();
      await dashboardNativeHeaderAction('Sort');
      const ascending = document.querySelector<HTMLElement>('[data-blok-testid="database-header-sort-asc"]');

      if (ascending === null) throw new Error('personal-save fixture did not open the widget sort');
      ascending.click();
      await quiet();
      const entry = Array.from(patches.entries()).find((candidate) =>
        candidate[1].filters?.some((filter) => filter.propertyId === 'n2'
          && filter.operator === 'contains' && filter.value === 'note') === true
        && candidate[1].sorts?.some((sort) => sort.propertyId === 'n2' && sort.direction === 'asc') === true);
      const save = dashboardWidget('foreign').querySelector<HTMLButtonElement>('[data-blok-database-filter-save]');

      if (entry === undefined || save === null || !save.isConnected || save.closest('[hidden], [inert]') !== null) {
        throw new Error('personal-save fixture did not reach both personal edits and the live Save button');
      }

      if (JSON.stringify(dashboardNativeWidgetRows('foreign')) !== JSON.stringify(['q2', 'q1'])) {
        throw new Error('personal-save fixture did not reach filtered and sorted widget rows');
      }

      return { current, patches, key: entry[0], personal: structuredClone(entry[1]), save };
    };

    it.each(['db', 'view-owner'] as const)(
      'revoked widget Save for everyone retains personal filters and sorts after %s denies writes',
      async (ownerId) => {
        const { current, patches, key, personal, save } = await prepare();
        const ownerBefore = await dashboardPopupData(current, 'view-owner');
        const sourceBefore = await dashboardPopupData(current, 'db2');

        dashboardPopupRevoke(current, ownerId);
        await quiet();
        save.click();
        await quiet();

        const owner = current.blocks.getById(ownerId);

        if (owner === null || owner === undefined) throw new Error('missing authority owner to restore');
        owner.call('dashboardCapabilitySetReadOnly', { readOnly: false });
        await quiet();

        await vi.waitFor(() => expect(dashboardNativeWidgetRows('foreign')).toEqual(['q2', 'q1']));
        expect(patches.get(key)).toEqual(personal);
        expect(await dashboardPopupData(current, 'view-owner')).toEqual(ownerBefore);
        expect(await dashboardPopupData(current, 'db2')).toEqual(sourceBefore);
        expect((await dashboardPopupData(current, 'db')).activeViewId).toBe('dash');
      }
    );

    it('authorized widget Save for everyone saves both personal edits only to its view owner', async () => {
      const { current, patches, key, personal, save } = await prepare();
      const ownerBefore = await dashboardPopupData(current, 'view-owner');
      const sourceBefore = await dashboardPopupData(current, 'db2');

      save.click();
      await quiet();
      const ownerAfter = await dashboardPopupData(current, 'view-owner');
      const shared = ownerAfter.views.find((entry) => entry.id === 'owned-v');

      expect({ filters: shared?.filters, sorts: shared?.sorts }).toEqual(personal);
      expect(patches.get(key)).toEqual({});
      expect(ownerAfter.views.find((entry) => entry.id === 'owner-active'))
        .toEqual(ownerBefore.views.find((entry) => entry.id === 'owner-active'));
      expect(ownerAfter.activeViewId).toBe('owner-active');
      expect(await dashboardPopupData(current, 'db2')).toEqual(sourceBefore);
      expect((await dashboardPopupData(current, 'db')).activeViewId).toBe('dash');
    });
  });

  it.each(['table', 'list'] as const)('widget Filter is personal to its mount then saves to its owner while the source active view is %s', async (sourceLayout) => {
    const blocks = dashboardNativeHeaderDoc(sourceLayout);
    const current = await make(blocks);
    const sourceBefore = (await current.save()).blocks.find((block) => block.id === 'db2')?.data;
    await dashboardNativeHeaderAction('Filter');
    const input = document.querySelector<HTMLInputElement>('[data-blok-testid="database-filter-value"]');

    if (input === null) throw new Error('missing widget filter input');
    input.value = 'Source note';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await quiet();

    expect(dashboardNativeWidgetRows('foreign')).toEqual(['q1']);
    expect(dashboardNativeWidgetRows('twin')).toEqual(['q1', 'q2']);
    const beforeSave = await editor?.save();
    const ownerBeforeSave = beforeSave?.blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;

    expect(ownerBeforeSave?.views.find((entry) => entry.id === 'source-v')?.filters).toEqual([]);
    expect(beforeSave?.blocks.find((block) => block.id === 'db2')?.data).toEqual(sourceBefore);
    expect(holder?.querySelector('[data-blok-id="db2"] [data-blok-database-filter-pill][data-filter-id]')).toBeNull();
    const save = dashboardWidget('foreign').querySelector<HTMLButtonElement>('[data-blok-database-filter-save]');

    if (save === null) throw new Error('missing widget Save for everyone');
    save.click();
    await quiet();
    const output = await editor?.save();
    const owner = output?.blocks.find((block) => block.id === 'db')?.data as DatabaseData | undefined;

    expect(owner?.views.find((entry) => entry.id === 'source-v')?.filters)
      .toEqual([expect.objectContaining({ propertyId: 'n2', operator: 'contains', value: 'Source note' })]);
    expect(output?.blocks.find((block) => block.id === 'db2')?.data).toEqual(sourceBefore);
    expect(owner?.activeViewId).toBe('dash');
  });

  it.each(['dashboard-before-source', 'source-before-dashboard'] as const)(
    'projects the standalone source at boot with %s',
    async (order) => {
      const blocks = dashboardNativeSubitemDoc();
      const ordered = order === 'source-before-dashboard'
        ? [
          ...blocks.filter((block) => block.id === 'db2' || block.parent === 'db2'),
          ...blocks.filter((block) => block.id !== 'db2' && block.parent !== 'db2'),
        ]
        : blocks;
      const current = await make(ordered);

      expect(shownRows('db2')).toEqual(['q1']);
      expect(dashboardNativeWidgetRows('foreign')).toEqual(['q1']);
      expect(dashboardNativeWidgetRows('twin')).toEqual(['q1']);

      const owner = await dashboardPopupData(current, 'db');
      const source = await dashboardPopupData(current, 'db2');

      expect(owner.views.find((entry) => entry.id === 'source-v')?.filters)
        .toEqual([{ propertyId: 'n2', operator: 'equals', value: 'Widget seed' }]);
      expect(source.views.find((entry) => entry.id === 'v')?.filters)
        .toEqual([{ propertyId: 'done', operator: 'equals', value: 'Source seed' }]);
    }
  );

  it('a repeated own rendered hook preserves an uncommitted standalone source cell edit', async () => {
    const blocks = dashboardNativeSubitemDoc();
    const current = await make([
      ...blocks.filter((block) => block.id === 'db2' || block.parent === 'db2'),
      ...blocks.filter((block) => block.id !== 'db2' && block.parent !== 'db2'),
    ]);
    const cell = holder?.querySelector<HTMLElement>(
      '[data-blok-id="db2"] [data-row-id="q1"] [role="gridcell"][data-property-id="n2"]'
    );

    if (cell === null || cell === undefined) throw new Error('missing standalone source cell');
    cell.click();
    await quiet();
    const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      '[data-blok-database-cell-editor] [data-blok-database-cell-input="text"]'
    );

    if (input === null) throw new Error('missing standalone source editor');
    input.value = 'Uncommitted standalone draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const source = current.blocks.getById('db2');

    if (source === null || source === undefined) throw new Error('missing source database');
    source.call('rendered');
    await quiet();

    expect(input.isConnected).toBe(true);
    expect(document.querySelector('[data-blok-database-cell-input="text"]')).toBe(input);
    expect(input.value).toBe('Uncommitted standalone draft');
    expect((await saved('q1'))?.data.properties.n2).toBe('Widget seed');

    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true,
    }));
    await quiet();

    expect((await saved('q1'))?.data.properties.n2).toBe('Uncommitted standalone draft');
    expect((await saved('q1'))?.data.properties.done).toBe('Source seed');
    expect(shownRows('db2')).toEqual(['q1']);
  });

  it('a widget subitem toggle expands only its own native mount', async () => {
    await make(dashboardNativeSubitemDoc());
    expect(shownRows('db2'), 'standalone source projection before widget toggle').toEqual(['q1']);
    const toggle = dashboardWidget('foreign').querySelector<HTMLElement>(
      '[data-row-id="q1"] [data-blok-database-subitem-toggle]'
    );

    if (toggle === null) throw new Error('missing widget subitem toggle');
    toggle.click();
    await quiet();

    expect(dashboardNativeWidgetRows('foreign')).toEqual(['q1', 'q2']);
    expect(dashboardNativeWidgetRows('twin')).toEqual(['q1']);
    expect(shownRows('db2')).toEqual(['q1']);
    expect(dashboardWidget('foreign').querySelector('[data-row-id="q2"]')?.getAttribute('data-subitem-depth')).toBe('1');
    const sourceToggle = holder?.querySelector<HTMLElement>(
      '[data-blok-id="db2"] [data-row-id="q1"] [data-blok-database-subitem-toggle]'
    );

    if (sourceToggle === null || sourceToggle === undefined) throw new Error('missing source subitem toggle');
    sourceToggle.click();
    await quiet();

    expect(shownRows('db2')).toEqual(['q1', 'q2']);
    expect(dashboardNativeWidgetRows('foreign')).toEqual(['q1', 'q2']);
    expect(dashboardNativeWidgetRows('twin')).toEqual(['q1']);
  });

  it('widget New sub-item uses its own filter and the actual source self-relation pair', async () => {
    const blocks = dashboardNativeSubitemDoc();
    const backend = backendFor(blocks, 'db2');
    const current = await make(blocks, { db2: { adapter: backend.adapter } });
    const toggle = dashboardWidget('foreign').querySelector<HTMLElement>(
      '[data-row-id="q1"] [data-blok-database-subitem-toggle]'
    );

    if (toggle === null) throw new Error('missing widget subitem toggle');
    toggle.click();
    await quiet();
    const add = dashboardWidget('foreign').querySelector<HTMLButtonElement>(
      '[data-blok-database-add-subitem][data-parent-id="q1"] button'
    );

    if (add === null) throw new Error('missing widget New sub-item');
    add.click();
    await quiet();
    const made = current.blocks.getChildren('db2').find((block) => block.name === 'database-row' && !['q1', 'q2'].includes(block.id));
    const row = made === undefined ? undefined : await saved(made.id);

    expect(row?.data.properties.n2).toBe('Widget seed');
    expect(row?.parent).toBe('db2');
    expect(row?.data.properties.done).not.toBe('Source seed');
    expect(row?.data.properties['parent-item']).toEqual([{ id: 'q1' }]);
    expect((await saved('q1'))?.data.properties['sub-items'])
      .toEqual([{ id: 'q2' }, { id: made?.id }]);
    expect(dashboardNativeWidgetRows('foreign')).toEqual(['q1', 'q2', made?.id]);
    expect(dashboardNativeWidgetRows('twin')).toEqual(['q1']);
    await new Promise((resolve) => setTimeout(resolve, 650));
    await quiet();

    expect(made === undefined ? undefined : backend.rows.get(made.id)?.properties.n2).toBe('Widget seed');
    expect(backend.rows.get('q1')?.properties['sub-items']).toEqual([{ id: 'q2' }, { id: made?.id }]);
  });

  it('revoking only the dashboard denies a retained New sub-item callback while the source remains editable', async () => {
    const blocks = dashboardNativeSubitemDoc();
    const current = await make(blocks);
    const toggle = dashboardWidget('foreign').querySelector<HTMLElement>(
      '[data-row-id="q1"] [data-blok-database-subitem-toggle]'
    );

    if (toggle === null) throw new Error('missing widget subitem toggle');
    toggle.click();
    await quiet();
    const add = dashboardWidget('foreign').querySelector<HTMLButtonElement>(
      '[data-blok-database-add-subitem][data-parent-id="q1"] button'
    );

    if (add === null) throw new Error('missing widget New sub-item');
    const dashboard = current.blocks.getById('db');

    if (dashboard === null || dashboard === undefined) throw new Error('missing dashboard block');
    dashboard.call('dashboardCapabilitySetReadOnly', { readOnly: true });
    await quiet();
    add.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await quiet();

    expect(current.blocks.getChildren('db2').filter((block) => block.name === 'database-row').map((block) => block.id)).toEqual(['q1', 'q2']);
    expect((await saved('q1'))?.data.properties['sub-items']).toEqual([{ id: 'q2' }]);
    expect(add.isConnected).toBe(false);
    const sourceToggle = holder?.querySelector<HTMLElement>(
      '[data-blok-id="db2"] [data-row-id="q1"] [data-blok-database-subitem-toggle]'
    );

    if (sourceToggle === null || sourceToggle === undefined) throw new Error('missing source subitem toggle');
    if (sourceToggle.getAttribute('aria-expanded') !== 'true') sourceToggle.click();
    await quiet();
    const sourceAdd = holder?.querySelector<HTMLButtonElement>(
      '[data-blok-id="db2"] [data-blok-database-add-subitem][data-parent-id="q1"] button'
    );

    if (sourceAdd === null || sourceAdd === undefined) throw new Error('missing source New sub-item');
    sourceAdd.click();
    await quiet();
    const made = current.blocks.getChildren('db2').find((block) => block.name === 'database-row' && !['q1', 'q2'].includes(block.id));

    expect(made === undefined ? undefined : (await saved(made.id))?.data.properties.done).toBe('Source seed');
    expect(made === undefined ? undefined : (await saved(made.id))?.data.properties['parent-item']).toEqual([{ id: 'q1' }]);
  });

  it('renders a foreign native view with its own schema and query despite a colliding view id', async () => {
    const blocks = doc();
    const local = blocks[0].data as DatabaseData;
    const foreign = blocks[3].data as DatabaseData;
    const foreignWidget = { id: 'foreign', databaseId: 'db2', viewId: 'v', width: 6 };
    const dashboard: DatabaseData['views'][number] = {
      id: 'dash', name: 'Dashboard', type: 'dashboard', position: 'a1',
      sorts: [], filters: [], visibleProperties: [],
      dashboard: { rows: [{ id: 'row', widgets: [
        { id: 'local', viewId: 'v', width: 6 }, foreignWidget,
      ] }] },
    };
    const foreignView: DatabaseData['views'][number] = {
      ...view, type: 'table', visibleProperties: ['name', 'n2'],
      filters: [{ propertyId: 'n2', operator: 'equals', value: 'shown' }],
      sorts: [{ propertyId: 'name', direction: 'asc' }],
    };

    blocks[0] = { ...blocks[0], data: { ...local, views: [local.views[0], dashboard], activeViewId: 'dash' } };
    blocks[3] = { ...blocks[3], content: ['q1', 'q2', 'q3'], data: { ...foreign, views: [foreignView] } };
    blocks.push(
      { id: 'q2', type: 'database-row', parent: 'db2', data: { properties: { name: 'Zoo', n2: 'shown' }, position: 'a6' } },
      { id: 'q3', type: 'database-row', parent: 'db2', data: { properties: { name: 'Aardvark', n2: 'shown' }, position: 'a7' } },
    );
    const current = await make(blocks);
    const foreignIds = [...(holder?.querySelectorAll<HTMLElement>(
      '[data-blok-id="db"] [data-blok-database-dashboard-widget="foreign"] [data-blok-database-table-row]'
    ) ?? [])].map((row) => row.getAttribute('data-row-id') ?? '');

    expect(foreignIds).toEqual(['q3', 'q2']);
    expect(holder?.querySelector(
      '[data-blok-id="db"] [data-blok-database-dashboard-widget="foreign"] [data-blok-database-table-column-header][data-property-id="name"]'
    )?.textContent).toContain('Project');
    expect([...(holder?.querySelectorAll<HTMLElement>(
      '[data-blok-id="db"] [data-blok-database-dashboard-widget="local"] [data-blok-database-table-row]'
    ) ?? [])].map((row) => row.getAttribute('data-row-id') ?? '')).toEqual(['r1', 'r2']);
    const output = await current.save();

    expect(output.blocks.find((block) => block.id === 'db')?.data.activeViewId).toBe('dash');
    expect(output.blocks.find((block) => block.id === 'db2')?.data.activeViewId).toBe('v');
    expect(output.blocks.filter((block) => block.type === 'database-row')).toHaveLength(5);
    expect(output.blocks.find((block) => block.id === 'db')?.data.views).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'dash', dashboard: dashboard.dashboard })])
    );
  });

  it('renders a widget view dataSourceId from the native source blocks rather than the dashboard rows', async () => {
    const blocks = doc();
    const local = blocks[0].data as DatabaseData;
    const sourceView: DatabaseData['views'][number] = {
      id: 'foreign-view', name: 'Projects here', type: 'table', position: 'a1',
      sorts: [], filters: [], visibleProperties: ['name', 'n2'], dataSourceId: 'db2',
    };
    const dashboard: DatabaseData['views'][number] = {
      id: 'dash', name: 'Dashboard', type: 'dashboard', position: 'a2',
      sorts: [], filters: [], visibleProperties: [],
      dashboard: { rows: [{ id: 'row', widgets: [{ id: 'source', viewId: 'foreign-view', width: 12 }] }] },
    };

    blocks[0] = { ...blocks[0], data: { ...local, views: [local.views[0], sourceView, dashboard], activeViewId: 'dash' } };
    const current = await make(blocks);
    const ids = [...(holder?.querySelectorAll<HTMLElement>(
      '[data-blok-id="db"] [data-blok-database-dashboard-widget="source"] [data-blok-database-table-row]'
    ) ?? [])].map((row) => row.getAttribute('data-row-id') ?? '');

    expect(ids).toEqual(['q1']);
    expect(holder?.querySelector(
      '[data-blok-id="db"] [data-blok-database-dashboard-widget="source"] [data-blok-database-table-column-header][data-property-id="name"]'
    )?.textContent).toContain('Project');
    const output = await current.save();

    expect(output.blocks.find((block) => block.id === 'db')?.data.activeViewId).toBe('dash');
    expect(output.blocks.find((block) => block.id === 'db2')?.data.activeViewId).toBe('v');
    expect(output.blocks.find((block) => block.id === 'q1')?.parent).toBe('db2');
    expect(output.blocks.filter((block) => block.type === 'database-row')).toHaveLength(3);
    expect(output.blocks.find((block) => block.id === 'db')?.data.views).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'foreign-view', dataSourceId: 'db2' })])
    );
  });

  it('keeps ordinary template-created pages eligible for pageAdded', async () => {
    const blocks = doc();

    blocks[0] = { ...blocks[0], content: ['r1', 'r2', 'tpl'] };
    blocks.push({
      id: 'tpl',
      type: 'database-row',
      parent: 'db',
      data: { properties: { t: 'Ordinary' }, position: 'a2', template: true },
    });
    const triggers: DatabaseAutomationTrigger[] = [];

    await make(blocks, { db: { automations: { onTrigger: (trigger) => { triggers.push(trigger); } } } });
    editor?.blocks.getById('db')?.call('newFromTemplate', 'tpl' as never);
    await quiet();
    const made = (await editor?.save())?.blocks.find((block) => block.parent === 'db' && !['r1', 'r2', 'tpl'].includes(block.id ?? ''));

    expect(triggers.filter((trigger) => trigger.type === 'pageAdded').map((trigger) => trigger.rowId)).toEqual([made?.id]);
    expect(made?.data.properties).toEqual(expect.objectContaining({ t: 'Ordinary' }));
  });

  it('keeps a user button-created page eligible for pageAdded', async () => {
    const blocks = doc();
    const data = blocks[0].data as DatabaseData;
    const action: PropertyDefinition = {
      id: 'createPage',
      name: 'Create page',
      type: 'button',
      position: 'a5',
      button: { label: 'Create page', buttonActions: [{ id: 'create', type: 'callback', name: 'create-page' }] },
    };

    blocks[0] = { ...blocks[0], data: { ...data, schema: [...data.schema, action], views: [{ ...view, visibleProperties: ['createPage'] }] } };
    const triggers: DatabaseAutomationTrigger[] = [];

    await make(blocks, {
      db: {
        automations: { onTrigger: (trigger) => { triggers.push(trigger); } },
        buttons: { onAction: () => { editor?.blocks.getById('db')?.call('newRow'); } },
      },
    });
    const button = holder?.querySelector<HTMLButtonElement>('[data-blok-id="db"] [data-row-id="r1"] [data-blok-database-button][data-property-id="createPage"]');

    if (button === null || button === undefined) throw new Error('missing create-page button');
    button.click();
    await quiet();
    const made = (await editor?.save())?.blocks.find((block) => block.parent === 'db' && !['r1', 'r2'].includes(block.id ?? ''));

    expect(triggers.filter((trigger) => trigger.type === 'pageAdded').map((trigger) => trigger.rowId)).toEqual([made?.id]);
    expect(made?.type).toBe('database-row');
  });

  it('applies a saved pageAdded action to a native row child and delivers it once', async () => {
    const automations: DatabaseSavedAutomations = {
      version: 1,
      definitions: [
        {
          id: 'on-add', name: 'Mark new row', status: 'active',
          scope: { type: 'database' }, triggerMode: 'any',
          triggers: [{ id: 'added', type: 'pageAdded' }],
          actions: [{ id: 'mark', type: 'editProperty', target: 'triggerRow', propertyId: 'notes', value: 'ran' }],
        },
        {
          id: 'must-not-chain', name: 'Do not chain', status: 'active',
          scope: { type: 'database' }, triggerMode: 'any',
          triggers: [{ id: 'notes-edited', type: 'propertyEdited', propertyId: 'notes' }],
          actions: [{ id: 'chain', type: 'editProperty', target: 'triggerRow', propertyId: 'amount', value: 42 }],
        },
      ],
    };
    const blocks = doc().map((block) => block.id === 'db'
      ? { ...block, data: { ...block.data, automations } }
      : block);
    const backend = backendFor(blocks, 'db');
    const create = vi.spyOn(backend.adapter, 'createRow');
    const update = vi.spyOn(backend.adapter, 'updateRow');
    const current = await make(blocks, { db: { adapter: backend.adapter } });
    const database = current.blocks.getById('db');

    if (database === null) throw new Error('missing database block');
    database.call('newRow');
    await quiet();
    await vi.waitFor(async () => {
      const made = (await current.save()).blocks.find((block) =>
        block.parent === 'db' && !['r1', 'r2'].includes(block.id ?? ''));

      expect(made?.data.properties).toEqual(expect.objectContaining({ notes: 'ran' }));
    }, { timeout: 2500 });
    const made = (await current.save()).blocks.find((block) =>
      block.parent === 'db' && !['r1', 'r2'].includes(block.id ?? ''));

    if (made?.id === undefined) throw new Error('missing created row block');
    const rowId = made.id;

    await vi.waitFor(() => {
      expect(backend.rows.get(rowId)?.properties.notes).toBe('ran');
    }, { timeout: 2500 });
    // Let a wrongly chained action reach the adapter.
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    const output = await current.save();
    const savedRow = output.blocks.find((block) => block.id === rowId);

    expect(savedRow?.data.properties).toEqual(expect.objectContaining({ notes: 'ran' }));
    expect(savedRow?.data.properties).not.toHaveProperty('amount');
    const child = current.blocks.getById(rowId);

    if (child === null) throw new Error('created row is not a native block');
    expect(await child.save()).toEqual(expect.objectContaining({
      id: rowId,
      tool: 'database-row',
      data: expect.objectContaining({ properties: expect.objectContaining({ notes: 'ran' }) }),
    }));
    expect(child.parentId).toBe('db');
    expect(database.contentIds).toContain(rowId);
    expect(database.getChildren().map((block) => block.id)).toContain(rowId);
    expect(savedRow?.type).toBe('database-row');
    expect(savedRow?.parent).toBe('db');
    expect(output.blocks.find((block) => block.id === 'db')?.content).toContain(rowId);
    expect(output.blocks.filter((block) => block.type === 'database-row' && block.parent === 'db')).toHaveLength(3);
    expect(output.blocks.find((block) => block.id === 'db')?.data.automations).toEqual(automations);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].id).toBe(rowId);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ rowId, properties: { notes: 'ran' } });
    expect(backend.rows.get(rowId)?.properties).not.toHaveProperty('amount');
  });

  it('applies a saved propertyEdited action from a real cell commit without chaining it', async () => {
    const automations: DatabaseSavedAutomations = {
      version: 1,
      definitions: [
        {
          id: 'on-notes', name: 'Set amount', status: 'active',
          scope: { type: 'database' }, triggerMode: 'any',
          triggers: [{ id: 'notes-edited', type: 'propertyEdited', propertyId: 'notes' }],
          actions: [{ id: 'set-amount', type: 'editProperty', target: 'triggerRow', propertyId: 'amount', value: 42 }],
        },
        {
          id: 'must-not-chain', name: 'Do not chain', status: 'active',
          scope: { type: 'database' }, triggerMode: 'any',
          triggers: [{ id: 'amount-edited', type: 'propertyEdited', propertyId: 'amount' }],
          actions: [{ id: 'chain', type: 'editProperty', target: 'triggerRow', propertyId: 'done', value: false }],
        },
      ],
    };
    const blocks = doc().map((block) => block.id === 'db'
      ? { ...block, data: { ...block.data, automations, views: [{ ...view, visibleProperties: ['notes', 'amount', 'done'] }] } }
      : block);
    const backend = backendFor(blocks, 'db');
    const update = vi.spyOn(backend.adapter, 'updateRow');
    const current = await make(blocks, { db: { adapter: backend.adapter } });
    const cell = holder?.querySelector<HTMLElement>(
      '[data-blok-id="db"] [data-row-id="r1"] [role="gridcell"][data-property-id="notes"]'
    );

    if (cell === null || cell === undefined) throw new Error('missing notes cell');
    cell.click();
    await quiet();
    const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      '[data-blok-database-cell-input="text"]'
    );

    if (input === null) throw new Error('missing notes editor');
    input.value = 'local edit';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await quiet();
    await vi.waitFor(async () => {
      const row = (await current.save()).blocks.find((block) => block.id === 'r1');

      expect(row?.data.properties).toEqual(expect.objectContaining({ amount: 42 }));
    }, { timeout: 2500 });
    await vi.waitFor(() => {
      expect(backend.rows.get('r1')?.properties.amount).toBe(42);
    }, { timeout: 2500 });
    // Let a wrongly chained action reach the adapter.
    await new Promise((resolve) => { setTimeout(resolve, 650); });
    const output = await current.save();
    const savedRow = output.blocks.find((block) => block.id === 'r1');

    expect(savedRow?.data.properties).toEqual(expect.objectContaining({
      notes: 'local edit', amount: 42, done: true,
    }));
    const child = current.blocks.getById('r1');
    const database = current.blocks.getById('db');

    if (child === null || database === null) throw new Error('missing native database row');
    expect(await child.save()).toEqual(expect.objectContaining({
      id: 'r1',
      tool: 'database-row',
      data: expect.objectContaining({
        properties: expect.objectContaining({ notes: 'local edit', amount: 42, done: true }),
      }),
    }));
    expect(child.parentId).toBe('db');
    expect(database.contentIds).toContain('r1');
    expect(savedRow?.parent).toBe('db');
    expect(output.blocks.find((block) => block.id === 'db')?.content).toContain('r1');
    expect(output.blocks.find((block) => block.id === 'db')?.data.automations).toEqual(automations);
    expect(output.blocks.find((block) => block.id === 'r2')?.data.properties).toEqual({ t: 'Bravo' });
    expect(backend.rows.get('r1')?.properties).toEqual(expect.objectContaining({
      notes: 'local edit', amount: 42, done: true,
    }));
    const actionDeliveries = update.mock.calls.filter(([params]) =>
      Object.prototype.hasOwnProperty.call(params.properties, 'amount'));

    expect(actionDeliveries).toHaveLength(1);
    expect(actionDeliveries[0]?.[0]).toEqual({
      rowId: 'r1', properties: expect.objectContaining({ amount: 42 }),
    });
    expect(update.mock.calls.some(([params]) => params.properties.done === false)).toBe(false);
  });

  describe('saved native automation builder through public menus', () => {
    const node = (id: string): HTMLElement | null =>
      document.querySelector<HTMLElement>(`[data-blok-testid="${CSS.escape(id)}"]`);

    const button = (id: string): HTMLButtonElement => {
      const element = node(id);

      if (!(element instanceof HTMLButtonElement)) throw new Error(`missing button ${id}`);
      return element;
    };

    const input = (id: string): HTMLInputElement => {
      const element = node(id);

      if (!(element instanceof HTMLInputElement)) throw new Error(`missing input ${id}`);
      return element;
    };

    const edit = (id: string, value: string): void => {
      const field = input(id);

      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const choose = (label: string): void => {
      const option = [...document.querySelectorAll<HTMLButtonElement>('[data-blok-database-panel-row]')]
        .find((row) => (row.querySelector('[data-blok-database-panel-label]')?.textContent ?? row.textContent)?.trim() === label);

      if (option === undefined) throw new Error(`missing menu choice ${label}`);
      option.click();
    };

    const pick = (id: string, label: string): void => {
      button(id).click();
      choose(label);
    };

    const openSettings = async (): Promise<void> => {
      const settings = holder?.querySelector<HTMLButtonElement>(
        '[data-blok-id="db"] [data-blok-testid="database-toolbar-settings"]'
      );

      if (settings === null || settings === undefined) throw new Error('missing settings button');
      settings.click();
      await quiet();
      if (node('database-view-settings') === null) throw new Error('missing settings panel');
    };

    const openAutomations = async (): Promise<void> => {
      await openSettings();
      button('database-settings-automations').click();
      await quiet();
      if (node('database-automations') === null) throw new Error('missing automations panel');
    };

    const draft = async (): Promise<{ name: HTMLInputElement; create: HTMLButtonElement }> => {
      await openAutomations();
      button('database-automation-new').click();
      await quiet();
      edit('database-automation-name', 'Mark new pages');
      pick('database-automation-scope', 'Entire database');
      pick('database-automation-mode', 'When any of these occur');
      button('database-automation-add-trigger').click();
      choose('Page added');
      button('database-automation-add-action').click();
      choose('Edit property');
      pick('database-automation-action-target', 'Trigger page');
      pick('database-automation-action-property', 'Notes');
      edit('database-automation-action-value', 'ran');

      return { name: input('database-automation-name'), create: button('database-automation-create') };
    };

    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value);

    const databaseData = async (current: TestEditor): Promise<Record<string, unknown>> => {
      const block = current.blocks.getById('db');

      if (block === null) throw new Error('missing native database block');
      const saved = await block.save();

      if (!isRecord(saved) || saved.id !== 'db' || saved.tool !== 'database' || !isRecord(saved.data)) {
        throw new Error('missing fresh saved database data');
      }
      return saved.data;
    };

    const lockData = (data: Record<string, unknown>): Record<string, unknown> => {
      if (!Array.isArray(data.schema)) throw new Error('missing saved schema');
      const schema: unknown[] = data.schema;

      return {
        ...data,
        schema: schema.map((property) => {
          if (!isRecord(property)) throw new Error('invalid saved property');
          return property.type === 'title' ? { ...property, databaseLocked: true } : property;
        }),
      };
    };

    const openDefinition = async (id: string): Promise<HTMLButtonElement> => {
      await openAutomations();
      button(`database-automation-open-${id}`).click();
      await quiet();
      return button('database-automation-active');
    };

    const reload = async (output: OutputData): Promise<TestEditor> => {
      editor?.destroy();
      editor = undefined;
      holder?.replaceChildren();
      return make(structuredClone(output.blocks));
    };

    it('A1a persists native automation CRUD through destroy/reload', async () => {
      const blocks = doc();
      const row = blocks.find((block) => block.id === 'r1');

      if (row === undefined) throw new Error('missing fixture row');
      row.content = ['body'];
      blocks.push({ id: 'body', type: 'paragraph', parent: 'r1', data: { text: 'Keep this body' } });
      let current = await make(blocks);
      const postBoot = await current.save();
      const initialIds = postBoot.blocks.map((block) => block.id);
      const initialContent = structuredClone(postBoot.blocks.filter((block) =>
        block.type === 'database-row' || block.id === 'body'));

      await openSettings();
      if (node('database-settings-automations') !== null) {
        const controls = await draft();

        controls.create.click();
        await quiet();
      }
      // The missing entry must fail on saved data, not a selector assertion.
      await vi.waitFor(async () => {
        expect((await current.save()).blocks.find((block) => block.id === 'db')?.data.automations).toEqual({
          version: 1,
          definitions: [{
            id: expect.stringMatching(/\S/),
            name: 'Mark new pages',
            status: expect.stringMatching(/^(active|paused)$/),
            scope: { type: 'database' },
            triggerMode: 'any',
            triggers: [{ id: expect.stringMatching(/\S/), type: 'pageAdded' }],
            actions: [{
              id: expect.stringMatching(/\S/), type: 'editProperty', target: 'triggerRow',
              propertyId: 'notes', value: 'ran',
            }],
          }],
        });
      });
      const afterCreate = await current.save();
      const slot = afterCreate.blocks.find((block) => block.id === 'db')?.data.automations;

      if (!isRecord(slot) || slot.version !== 1 || !Array.isArray(slot.definitions)) {
        throw new Error('missing saved automation definitions');
      }
      const definitions: unknown[] = slot.definitions;
      const created = definitions[0];

      if (definitions.length !== 1 || !isRecord(created) || typeof created.id !== 'string'
        || (created.status !== 'active' && created.status !== 'paused') || !Array.isArray(created.actions)) {
        throw new Error('invalid saved automation identity');
      }
      const actions: unknown[] = created.actions;
      const action = actions[0];

      if (actions.length !== 1 || !isRecord(action)) throw new Error('invalid saved automation action');
      const createdSlot = structuredClone(slot);
      const editedDefinition = {
        ...structuredClone(created), name: 'Mark incoming pages',
        actions: [{ ...structuredClone(action), value: 'updated' }],
      };

      current = await reload(afterCreate);
      expect((await current.save()).blocks.find((block) => block.id === 'db')?.data.automations).toEqual(createdSlot);
      const afterCreateReload = await current.save();
      const active = await openDefinition(created.id);

      expect(active.getAttribute('role')).toBe('switch');
      expect(active.getAttribute('aria-checked')).toBe(String(created.status === 'active'));
      edit('database-automation-name', 'Mark incoming pages');
      edit('database-automation-action-value', 'updated');
      button('database-automation-save').click();
      await quiet();
      const afterEdit = await current.save();

      expect(afterEdit.blocks.find((block) => block.id === 'db')?.data.automations).toEqual({
        version: 1, definitions: [editedDefinition],
      });
      current = await reload(afterEdit);
      expect((await current.save()).blocks.find((block) => block.id === 'db')?.data.automations).toEqual({
        version: 1, definitions: [editedDefinition],
      });
      const afterEditReload = await current.save();
      const beforePauseSwitch = await openDefinition(created.id);

      expect(input('database-automation-name').value).toBe('Mark incoming pages');
      expect(input('database-automation-action-value').value).toBe('updated');
      if (created.status === 'paused') {
        beforePauseSwitch.click();
        await quiet();
      }
      const activeDefinition = { ...editedDefinition, status: 'active' };
      const beforePause = await current.save();

      expect(beforePause.blocks.find((block) => block.id === 'db')?.data.automations).toEqual({
        version: 1, definitions: [activeDefinition],
      });
      const pause = await openDefinition(created.id);

      expect(pause.getAttribute('aria-checked')).toBe('true');
      pause.click();
      await quiet();
      const afterPause = await current.save();
      const pausedDefinition = { ...editedDefinition, status: 'paused' };

      expect(afterPause.blocks.find((block) => block.id === 'db')?.data.automations).toEqual({
        version: 1, definitions: [pausedDefinition],
      });
      current = await reload(afterPause);
      expect((await current.save()).blocks.find((block) => block.id === 'db')?.data.automations).toEqual({
        version: 1, definitions: [pausedDefinition],
      });
      const afterPauseReload = await current.save();
      const resume = await openDefinition(created.id);

      expect(resume.getAttribute('aria-checked')).toBe('false');
      resume.click();
      await quiet();
      const afterResume = await current.save();

      expect(afterResume.blocks.find((block) => block.id === 'db')?.data.automations).toEqual({
        version: 1, definitions: [activeDefinition],
      });
      current = await reload(afterResume);
      expect((await current.save()).blocks.find((block) => block.id === 'db')?.data.automations).toEqual({
        version: 1, definitions: [activeDefinition],
      });
      const afterResumeReload = await current.save();
      const resumed = await openDefinition(created.id);

      expect(resumed.getAttribute('aria-checked')).toBe('true');
      button('database-automation-delete').click();
      await quiet();
      document.querySelector<HTMLButtonElement>('[data-blok-database-confirm-action="confirm"]')?.click();
      await quiet();
      const afterDelete = await current.save();
      const deletedSlot = afterDelete.blocks.find((block) => block.id === 'db')?.data.automations;

      expect([undefined, { version: 1, definitions: [] }]).toContainEqual(deletedSlot);
      current = await reload(afterDelete);
      const afterDeleteReload = await current.save();

      expect(afterDeleteReload.blocks.find((block) => block.id === 'db')?.data.automations).toEqual(deletedSlot);
      await openAutomations();
      expect(node(`database-automation-open-${created.id}`)).toBeNull();
      for (const output of [
        afterCreate, afterCreateReload, afterEdit, afterEditReload, beforePause,
        afterPause, afterPauseReload, afterResume, afterResumeReload, afterDelete, afterDeleteReload,
      ]) {
        expect(output.blocks.map((block) => block.id)).toEqual(initialIds);
        expect(output.blocks.filter((block) => block.type === 'database-row' || block.id === 'body')).toEqual(initialContent);
        expect(output.blocks.find((block) => block.id === 'db')?.content).toEqual(['r1', 'r2']);
        expect(output.blocks.find((block) => block.id === 'r1')?.content).toEqual(['body']);
        expect(output.blocks.find((block) => block.id === 'body')?.parent).toBe('r1');
      }
    });

    it.each(['missing-trigger', 'missing-action', 'missing-property', 'missing-view'] as const)(
      'A1a refuses native activation with %s',
      async (reason) => {
        const invalid: DatabaseSavedAutomations = {
          version: 1,
          definitions: [{
            id: 'invalid', name: 'Invalid definition', status: 'paused',
            scope: reason === 'missing-view' ? { type: 'view', viewId: 'deleted-view' } : { type: 'database' },
            triggerMode: 'any',
            triggers: reason === 'missing-trigger' ? [] : [{ id: 'added', type: 'pageAdded' }],
            actions: reason === 'missing-action' ? [] : [{
              id: 'mark', type: 'editProperty', target: 'triggerRow',
              propertyId: reason === 'missing-property' ? 'deleted-property' : 'notes', value: 'ran',
            }],
          }],
        };
        const blocks = doc().map((block) => block.id === 'db'
          ? { ...block, data: { ...block.data, automations: invalid } }
          : block);
        const current = await make(blocks);
        const before = await current.save();

        await openSettings();
        const entry = node('database-settings-automations');

        if (entry !== null) {
          entry.click();
          await quiet();
          node('database-automation-open-invalid')?.click();
          await quiet();
          node('database-automation-active')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          await quiet();
        }
        const output = await current.save();

        expect(output.blocks.find((block) => block.id === 'db')?.data.automations).toEqual(invalid);
        const active = node('database-automation-active');
        const error = node('database-automation-error');

        expect(active).toBeInstanceOf(HTMLButtonElement);
        expect(active?.getAttribute('aria-checked')).toBe('false');
        expect(error?.textContent?.trim()).toEqual(expect.stringMatching(/\S/));
        expect(output.blocks.map((block) => block.id)).toEqual(before.blocks.map((block) => block.id));
        expect(output.blocks.filter((block) => block.type === 'database-row'))
          .toEqual(before.blocks.filter((block) => block.type === 'database-row'));
      }
    );

    it('A1a keeps a literal when its current action property is selected again', async () => {
      const automations: DatabaseSavedAutomations = {
        version: 1,
        definitions: [{
          id: 'same-property', name: 'Keep the literal', status: 'active',
          scope: { type: 'database' }, triggerMode: 'any',
          triggers: [{ id: 'added', type: 'pageAdded' }],
          actions: [{
            id: 'mark', type: 'editProperty', target: 'triggerRow',
            propertyId: 'notes', value: 'ran',
          }],
        }],
      };
      const blocks = doc().map((block) => block.id === 'db'
        ? { ...block, data: { ...block.data, automations } }
        : block);
      const current = await make(blocks);

      await openDefinition('same-property');
      pick('database-automation-action-property', 'Notes');
      button('database-automation-save').click();
      await quiet();

      expect((await databaseData(current)).automations).toEqual(automations);
      await openDefinition('same-property');
      expect(input('database-automation-action-value').value).toBe('ran');
    });

    it('A1a keeps a structured richText literal structured when editing its displayed JSON', async () => {
      const literal: OutputData = {
        blocks: [{ id: 'literal-paragraph', type: 'paragraph', data: { text: 'Before' } }],
      };
      const editedLiteral: OutputData = {
        blocks: [{ id: 'literal-paragraph', type: 'paragraph', data: { text: 'After' } }],
      };
      const automations: DatabaseSavedAutomations = {
        version: 1,
        definitions: [{
          id: 'rich-literal', name: 'Keep structured content', status: 'active',
          scope: { type: 'database' }, triggerMode: 'any',
          triggers: [{ id: 'added', type: 'pageAdded' }],
          actions: [{
            id: 'mark', type: 'editProperty', target: 'triggerRow',
            propertyId: 'notes', value: literal,
          }],
        }],
      };
      const blocks = doc().map((block) => {
        if (block.id !== 'db') return block;
        const data = block.data as DatabaseData;
        const schema: PropertyDefinition[] = data.schema.map((property) =>
          property.id === 'notes' ? { ...property, type: 'richText' } : property);

        return { ...block, data: { ...data, schema, automations } };
      });
      const current = await make(blocks);

      await openDefinition('rich-literal');
      edit('database-automation-action-value', JSON.stringify(editedLiteral));
      button('database-automation-save').click();
      await quiet();
      const expected: DatabaseSavedAutomations = {
        ...automations,
        definitions: automations.definitions.map((definition) => ({
          ...definition,
          actions: definition.actions.map((action) => ({ ...action, value: editedLiteral })),
        })),
      };

      expect((await databaseData(current)).automations).toEqual(expected);
      await openDefinition('rich-literal');
      expect(input('database-automation-action-value').value).toBe(JSON.stringify(editedLiteral));
    });

    it.each([
      { name: 'plain text', text: 'Plain', saved: 'Plain' },
      { name: 'nothing', text: '', saved: '' },
    ])('A1a replaces a structured richText literal with $name', async ({ text, saved: savedValue }) => {
      const literal: OutputData = {
        blocks: [{ id: 'literal-paragraph', type: 'paragraph', data: { text: 'Before' } }],
      };
      const automations: DatabaseSavedAutomations = {
        version: 1,
        definitions: [{
          id: 'rich-replace', name: 'Replace structured content', status: 'active',
          scope: { type: 'database' }, triggerMode: 'any',
          triggers: [{ id: 'added', type: 'pageAdded' }],
          actions: [{
            id: 'mark', type: 'editProperty', target: 'triggerRow',
            propertyId: 'notes', value: literal,
          }],
        }],
      };
      const blocks = doc().map((block) => {
        if (block.id !== 'db') return block;
        const data = block.data as DatabaseData;
        const schema: PropertyDefinition[] = data.schema.map((property) =>
          property.id === 'notes' ? { ...property, type: 'richText' } : property);

        return { ...block, data: { ...data, schema, automations } };
      });
      const current = await make(blocks);

      await openDefinition('rich-replace');
      edit('database-automation-action-value', text);
      button('database-automation-save').click();
      await quiet();

      expect((await databaseData(current)).automations).toMatchObject({
        definitions: [{ actions: [{ value: savedValue }] }],
      });
    });

    it('A1a refuses a person literal that repeats an id', async () => {
      const automations: DatabaseSavedAutomations = {
        version: 1,
        definitions: [{
          id: 'people', name: 'Assign people', status: 'active',
          scope: { type: 'database' }, triggerMode: 'any',
          triggers: [{ id: 'added', type: 'pageAdded' }],
          actions: [{
            id: 'mark', type: 'editProperty', target: 'triggerRow',
            propertyId: 'notes', value: [{ id: 'p1' }],
          }],
        }],
      };
      const blocks = doc().map((block) => {
        if (block.id !== 'db') return block;
        const data = block.data as DatabaseData;
        const schema: PropertyDefinition[] = data.schema.map((property) =>
          property.id === 'notes' ? { ...property, type: 'person' } : property);

        return { ...block, data: { ...data, schema, automations } };
      });
      const current = await make(blocks);

      await openDefinition('people');
      edit('database-automation-action-value', '[{"id":"p1"},{"id":"p1"}]');
      button('database-automation-save').click();
      await quiet();

      expect((await databaseData(current)).automations).toEqual(automations);
      expect(document.querySelector('[data-blok-testid="database-automation-error"]')).not.toBeNull();
    });

    it.each(['readOnly', 'editStructure', 'locked', 'remoteSource'] as const)(
      'does not expose a writable automation creation path when %s denies it',
      async (restriction) => {
        const config: DatabaseConfig = restriction === 'editStructure'
          ? { permissions: { can: (action) => action !== 'editStructure' } }
          : {};
        const current = await make(doc(), { db: config });
        const original = await databaseData(current);

        if (restriction === 'readOnly') await current.readOnly.set(true);
        if (restriction === 'locked') await current.blocks.update('db', lockData(original));
        if (restriction === 'remoteSource') {
          await current.blocks.update('db', {
            ...original, source: { databaseId: 'remote-db', documentId: 'remote-document' },
          });
        }
        const before = (await databaseData(current)).automations;
        const toolbar = holder?.querySelector<HTMLElement>(
          '[data-blok-id="db"] [data-blok-database-view-toolbar]'
        );

        if (toolbar !== null && toolbar !== undefined && !toolbar.hidden) {
          await openSettings();
          const entry = node('database-settings-automations');

          if (entry instanceof HTMLButtonElement) entry.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          const createNew = node('database-automation-new');

          if (createNew instanceof HTMLButtonElement) createNew.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
        expect((await databaseData(current)).automations).toEqual(before);
        expect(node('database-automation-builder')).toBeNull();
        const createNew = node('database-automation-new');

        expect(createNew === null || (createNew instanceof HTMLButtonElement && createNew.disabled)).toBe(true);
      }
    );

    it.each(['readOnly', 'editStructure', 'locked', 'remoteSource'] as const)(
      'rejects captured draft controls after public %s revocation and restoration',
      async (restriction) => {
        let allowStructure = true;
        const config: DatabaseConfig = {
          permissions: { can: (action) => action !== 'editStructure' || allowStructure },
        };
        const current = await make(doc(), { db: config });
        const controls = await draft();
        const original = await databaseData(current);
        const before = original.automations;

        if (restriction === 'readOnly') await current.readOnly.set(true);
        if (restriction === 'editStructure') {
          allowStructure = false;
          await current.readOnly.set(true);
          await current.readOnly.set(false);
        }
        if (restriction === 'locked') await current.blocks.update('db', lockData(original));
        if (restriction === 'remoteSource') {
          await current.blocks.update('db', {
            ...original, source: { databaseId: 'remote-db', documentId: 'remote-document' },
          });
        }
        // Dispatch reaches the old callback even if its button was disabled.
        controls.create.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect((await databaseData(current)).automations).toEqual(before);
        if (restriction === 'readOnly') await current.readOnly.set(false);
        if (restriction === 'editStructure') {
          allowStructure = true;
          await current.readOnly.set(true);
          await current.readOnly.set(false);
        }
        if (restriction === 'locked') await current.blocks.update('db', original);
        if (restriction === 'remoteSource') {
          await current.blocks.update('db', { ...original, source: undefined });
        }
        const restored = await databaseData(current);
        const database = current.blocks.getById('db');

        if (database === null) throw new Error('missing restored database block');
        const contentPermission: boolean[] = [];

        database.call('readRowWritePermission', {
          receive: (allowed: boolean): void => { contentPermission.push(allowed); },
        });
        expect(current.readOnly.isEnabled).toBe(false);
        expect(contentPermission).toEqual([true]);
        expect(restored).not.toHaveProperty('source');
        expect(restored.schema).toEqual(original.schema);
        controls.name.value = 'Stale draft';
        controls.name.dispatchEvent(new Event('input', { bubbles: true }));
        controls.create.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect((await databaseData(current)).automations).toEqual(before);
        expect(node('database-automation-builder')).toBeNull();
        const fresh = await draft();

        edit('database-automation-name', 'Fresh after restoration');
        expect(fresh.create.disabled).toBe(false);
        fresh.create.click();
        await vi.waitFor(async () => {
          const saved = (await current.save()).blocks.find((block) => block.id === 'db');

          expect(saved?.data.automations).toEqual(expect.objectContaining({
            version: 1,
            definitions: expect.arrayContaining([expect.objectContaining({
              name: 'Fresh after restoration',
              triggers: [{ id: expect.stringMatching(/\S/), type: 'pageAdded' }],
              actions: [{
                id: expect.stringMatching(/\S/), type: 'editProperty', target: 'triggerRow',
                propertyId: 'notes', value: 'ran',
              }],
            })]),
          }));
        });
      }
    );

    it('does not resurrect a publicly deleted automation through its captured Active switch', async () => {
      const seeded = {
        version: 1,
        definitions: [{
          id: 'existing', name: 'Existing automation', status: 'active',
          scope: { type: 'database' }, triggerMode: 'any',
          triggers: [{ id: 'added', type: 'pageAdded' }],
          actions: [{ id: 'mark', type: 'editProperty', target: 'triggerRow', propertyId: 'notes', value: 'keep' }],
        }],
      };
      const blocks = doc().map((block) => block.id === 'db'
        ? { ...block, data: { ...block.data, automations: seeded } }
        : block);
      const current = await make(blocks);
      const active = await openDefinition('existing');
      const original = await databaseData(current);

      await current.blocks.update('db', { ...original, automations: { version: 1, definitions: [] } });
      active.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect((await databaseData(current)).automations).toEqual({ version: 1, definitions: [] });
      expect(node('database-automation-builder')).toBeNull();
    });

    const existingAutomation = (status: 'active' | 'paused'): DatabaseSavedAutomations => ({
      version: 1,
      definitions: [{
        id: 'existing', name: 'Existing automation', status,
        scope: { type: 'database' }, triggerMode: 'any',
        triggers: [{ id: 'added', type: 'pageAdded' }],
        actions: [{ id: 'mark', type: 'editProperty', target: 'triggerRow', propertyId: 'notes', value: 'keep' }],
      }],
    });

    const withAutomations = (automations: unknown): OutputBlockData[] => doc().map((block) => block.id === 'db'
      ? { ...block, data: { ...block.data, automations } }
      : block);

    const rowBlocks = (output: OutputData): OutputBlockData[] =>
      output.blocks.filter((block) => block.type === 'database-row');

    it.each(['cancel', 'Escape'] as const)(
      'keeps the saved automation and rows when %s leaves unsaved field and submenu edits',
      async (leave) => {
        const automations = existingAutomation('active');
        const current = await make(withAutomations(automations));
        const before = await current.save();

        await openDefinition('existing');
        edit('database-automation-name', 'Unsaved name');
        pick('database-automation-mode', 'When all of these occur');
        await quiet();
        if (node('database-automation-builder') === null) throw new Error('submenu choice did not return to the builder');
        edit('database-automation-action-value', 'unsaved value');
        if (leave === 'cancel') button('database-automation-cancel').click();
        else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await quiet();
        const after = await current.save();

        expect(after.blocks.find((block) => block.id === 'db')?.data.automations).toEqual(automations);
        expect(rowBlocks(after)).toEqual(rowBlocks(before));
        button('database-automation-open-existing').click();
        await quiet();
        expect(input('database-automation-name').value).toBe('Existing automation');
        expect(input('database-automation-action-value').value).toBe('keep');
      }
    );

    it('keeps sibling definitions and unknown envelope and definition fields when saving one definition', async () => {
      const [first] = existingAutomation('active').definitions;
      const sibling = {
        ...first, id: 'sibling', name: 'Sibling automation', status: 'paused', hostDefinitionTag: 'keep-sibling',
      };
      const automations = {
        version: 1, hostEnvelope: { revision: 7 },
        definitions: [{ ...first, hostDefinitionTag: 'keep-first' }, sibling],
      };
      const current = await make(withAutomations(automations));

      if (JSON.stringify((await databaseData(current)).automations) !== JSON.stringify(automations)) {
        throw new Error('unknown automation fields did not survive boot');
      }
      await openDefinition('existing');
      edit('database-automation-name', 'Renamed automation');
      button('database-automation-save').click();
      await quiet();

      expect((await databaseData(current)).automations).toEqual({
        ...automations,
        definitions: [{ ...first, hostDefinitionTag: 'keep-first', name: 'Renamed automation' }, sibling],
      });
    });

    it('keeps a paused propertyEdited automation paused with a readable error after its trigger property is deleted', async () => {
      const paused = existingAutomation('paused');
      const automations: DatabaseSavedAutomations = {
        ...paused,
        definitions: paused.definitions.map((definition) => ({
          ...definition, triggers: [{ id: 'edited', type: 'propertyEdited', propertyId: 'amount' }],
        })),
      };
      const current = await make(withAutomations(automations));
      const data = await databaseData(current);

      if (!Array.isArray(data.schema)) throw new Error('missing saved schema');
      const schema: unknown[] = data.schema;

      await current.blocks.update('db', {
        ...data, schema: schema.filter((property) => !isRecord(property) || property.id !== 'amount'),
      });
      await quiet();
      const updated = await databaseData(current);

      if (!Array.isArray(updated.schema) || updated.schema.some((property: unknown) => isRecord(property) && property.id === 'amount')
        || JSON.stringify(updated.automations) !== JSON.stringify(automations)) {
        throw new Error('the trigger property was not deleted, or the automation changed with it');
      }
      const resume = await openDefinition('existing');

      resume.click();
      await quiet();

      expect((await databaseData(current)).automations).toEqual(automations);
      expect(node('database-automation-active')?.getAttribute('aria-checked')).toBe('false');
      expect(node('database-automation-error')?.textContent?.trim()).toBe('Choose an existing editable property.');
    });

    it('refuses to resume an automation whose action property became computed, using the current schema', async () => {
      const automations = existingAutomation('paused');
      const current = await make(withAutomations(automations));
      const data = await databaseData(current);

      if (!Array.isArray(data.schema)) throw new Error('missing saved schema');
      const schema: unknown[] = data.schema;

      await current.blocks.update('db', {
        ...data,
        schema: schema.map((property) => isRecord(property) && property.id === 'notes'
          ? { ...property, type: 'createdTime' }
          : property),
      });
      await quiet();
      const updated = await databaseData(current);

      if (!Array.isArray(updated.schema) || !updated.schema.some((property: unknown) =>
        isRecord(property) && property.id === 'notes' && property.type === 'createdTime')) {
        throw new Error('the action property did not become computed');
      }
      const resume = await openDefinition('existing');

      resume.click();
      await quiet();

      expect((await databaseData(current)).automations).toEqual(automations);
      expect(node('database-automation-active')?.getAttribute('aria-checked')).toBe('false');
      expect(node('database-automation-error')?.textContent?.trim()).toBe('Choose an existing editable property.');
    });

    it.each(['draft', 'choice'] as const)(
      'keeps automations received from a peer while a %s page is open',
      async (page) => {
        const blocks = withAutomations(existingAutomation('active'));
        const received: DatabaseSavedAutomations = {
          version: 1,
          definitions: [{
            id: 'peer', name: 'Peer automation', status: 'paused',
            scope: { type: 'database' }, triggerMode: 'all',
            triggers: [{ id: 'peer-added', type: 'pageAdded' }],
            actions: [{ id: 'peer-mark', type: 'editProperty', target: 'triggerRow', propertyId: 'notes', value: 'peer' }],
          }],
        };
        const peer = new DocumentStore(new YBlockSerializer());
        const sockets: PeerSocket[] = [];
        const originalSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');

        class PeerSocket {
          binaryType = 'blob';
          readyState = 0;
          protocol = '';
          onopen: ((event: unknown) => void) | null = null;
          onmessage: ((event: { data: unknown }) => void) | null = null;
          onclose: ((event: { code: number; reason: string }) => void) | null = null;
          onerror: ((event: unknown) => void) | null = null;

          constructor() {
            sockets.push(this);
          }

          send(): void {}

          close(): void {
            this.readyState = 3;
          }

          open(): void {
            this.protocol = 'blok-sync.v1';
            this.readyState = 1;
            this.onopen?.({});
          }

          deliver(frame: SyncWireFrame): void {
            this.onmessage?.({ data: encode(frame) });
          }
        }

        Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: PeerSocket });
        try {
          peer.fromJSON(blocks);
          const current = await make([], {}, {
            server: 'https://sync.test/api/',
            collaboration: { doc: 'automation-builder-peer-replacement-' + page },
          });
          const socket = sockets.at(-1);

          if (socket === undefined) throw new Error('collaboration opened no socket');
          socket.open();
          socket.deliver({
            type: 'control',
            tag: { format: 2, epoch: 0, lineage: '0123456789abcdef0123456789abcdef' },
          });
          socket.deliver({ type: 'syncStep2', update: peer.encodeStateAsUpdate() });
          await vi.waitFor(() => {
            expect(current.blocks.getChildren('db').map((block) => block.id)).toEqual(['r1', 'r2']);
          });
          await vi.waitFor(() => {
            expect(current.readOnly.isEnabled).toBe(false);
          });
          await quiet();
          const controls = await draft();
          const before = rowBlocks(await current.save());

          button('database-automation-scope').click();
          const choice = page === 'choice' ? button('database-automation-choice-database') : undefined;

          if (page === 'draft') button('database-panel-back').click();
          peer.updateBlockData('db', 'automations', received);
          socket.deliver({ type: 'update', update: peer.encodeStateAsUpdate() });
          await vi.waitFor(async () => {
            expect((await databaseData(current)).automations).toEqual(received);
          });
          choice?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          controls.create.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          await quiet();

          expect((await databaseData(current)).automations).toEqual(received);
          expect(node('database-automation-builder')).toBeNull();
          expect(rowBlocks(await current.save())).toEqual(before);
        } finally {
          editor?.destroy();
          editor = undefined;
          peer.destroy();
          if (originalSocket === undefined) {
            Reflect.deleteProperty(globalThis, 'WebSocket');
          } else {
            Object.defineProperty(globalThis, 'WebSocket', originalSocket);
          }
        }
      }
    );

    it('fires no configured onTrigger and changes no row content across definition create, edit, pause, resume and delete', async () => {
      const triggers: DatabaseAutomationTrigger[] = [];
      const current = await make(doc(), { db: { automations: { onTrigger: (trigger) => { triggers.push(trigger); } } } });
      const before = await current.save();
      const controls = await draft();

      controls.create.click();
      await quiet();
      const slot = (await databaseData(current)).automations;
      const created: unknown = isRecord(slot) && Array.isArray(slot.definitions) ? slot.definitions[0] : undefined;

      if (!isRecord(created) || typeof created.id !== 'string') throw new Error('the definition was not created');
      const id = created.id;

      await openDefinition(id);
      edit('database-automation-name', 'Edited automation');
      button('database-automation-save').click();
      await quiet();
      const pause = await openDefinition(id);

      if (pause.getAttribute('aria-checked') !== 'true') throw new Error('expected an active definition');
      pause.click();
      await quiet();
      const resume = await openDefinition(id);

      resume.click();
      await quiet();
      await openDefinition(id);
      button('database-automation-delete').click();
      await quiet();
      document.querySelector<HTMLButtonElement>('[data-blok-database-confirm-action="confirm"]')?.click();
      await quiet();
      await new Promise((resolve) => { setTimeout(resolve, 650); });
      const after = await current.save();
      const remaining = (await databaseData(current)).automations;

      expect(triggers).toEqual([]);
      expect(rowBlocks(after)).toEqual(rowBlocks(before));
      expect(after.blocks.map((block) => block.id)).toEqual(before.blocks.map((block) => block.id));
      expect([undefined, { version: 1, definitions: [] }]).toContainEqual(remaining);
    });
  });

  it('Open in › Center peek opens the row centred, and switches an open side peek', async () => {
    await make(doc());
    const openIn = async (rowId: string, label: string): Promise<void> => {
      holder?.querySelector<HTMLElement>(`[data-blok-id="db"] [data-row-id="${rowId}"] [data-blok-database-table-row-handle]`)?.click();
      [...document.querySelectorAll<HTMLElement>('[data-blok-popover-opened] [data-blok-popover-item]')]
        .find((item) => item.textContent?.trim() === 'Open in')?.click();
      await quiet();
      [...document.querySelectorAll<HTMLElement>('[data-blok-popover-item]')]
        .find((item) => item.textContent?.trim() === label)?.click();
      await quiet();
    };
    const mode = (): string | null | undefined => holder?.querySelector('[data-blok-database-drawer]')?.getAttribute('data-peek-mode');

    await openIn('r1', 'Center peek');
    expect(mode()).toBe('center');

    await openIn('r1', 'Side peek');
    expect(mode()).toBe('side');
  });

  it('offers every other database in the row menu, not its own', async () => {
    await make(doc());

    holder?.querySelector<HTMLElement>('[data-blok-id="db"] [data-row-id="r2"] [data-blok-database-table-row-handle]')?.click();
    const moveTo = [...document.querySelectorAll<HTMLElement>('[data-blok-popover-opened] [data-blok-popover-item]')]
      .find((item) => (item.textContent?.includes('Move to')) && !item.textContent.includes('Trash'));

    moveTo?.click();
    await quiet();
    const titles = [...document.querySelectorAll<HTMLElement>('[data-blok-nested] [data-blok-popover-item], [data-blok-popover-nested] [data-blok-popover-item]')]
      .map((item) => item.textContent?.trim());

    expect(moveTo).toBeDefined();
    expect(titles).toContain('Projects');
    expect(titles).not.toContain('Tasks');
  });
});
