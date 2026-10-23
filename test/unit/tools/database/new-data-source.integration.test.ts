import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import type { API, OutputBlockData, OutputData } from '../../../../types';
import type { DatabaseData, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

interface TestEditor {
  isReady: Promise<unknown>;
  save(): Promise<OutputData>;
  destroy(): void;
  blocks: API['blocks'];
  history: API['history'];
}

let editor: Blok | undefined;
let holder: HTMLDivElement | undefined;

const quiet = async (): Promise<void> => {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  for (let frame = 0; frame < 3; frame++) {
    await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
  }
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
};

const table = (id: string, position: string, extra: Partial<DatabaseViewConfig> = {}): DatabaseViewConfig => ({
  id, name: 'Table', type: 'table', position, filters: [], sorts: [], visibleProperties: [], ...extra,
});

const parentSchema: PropertyDefinition[] = [
  { id: 't', name: 'Name', type: 'title', position: 'a0' },
  { id: 'notes', name: 'Notes', type: 'text', position: 'a1' },
];

const sourceSchema: PropertyDefinition[] = [
  { id: 'bt', name: 'Name', type: 'title', position: 'a0' },
  { id: 'size', name: 'Size', type: 'number', position: 'a1' },
];

const doc = (active: string, parentExtra: Partial<DatabaseData> = {}): OutputBlockData[] => [
  {
    id: 'db', type: 'database', content: ['r1', 'src-b'],
    data: {
      title: 'Projects',
      schema: parentSchema,
      views: [table('v1', 'a0'), table('vb', 'a1', { dataSourceId: 'src-b' })],
      activeViewId: active,
      ...parentExtra,
    },
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Parent row', notes: 'n' }, position: 'a0' } },
  {
    id: 'src-b', type: 'database', parent: 'db', content: ['b1'],
    data: { title: 'Src B', schema: sourceSchema, views: [table('bv', 'a0')], activeViewId: 'bv' },
  },
  { id: 'b1', type: 'database-row', parent: 'src-b', data: { properties: { bt: 'Source row', size: 3 }, position: 'a0' } },
];

const make = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  if (holder === undefined) throw new Error('missing editor holder');
  let ready: TestEditor | undefined;

  editor = new Blok({
    holder, dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      database: { class: DatabaseTool },
      'database-row': DatabaseRowTool,
    },
    data: { blocks },
    onReady: (api) => { ready = api; },
  });
  await editor.isReady;
  await quiet();
  if (ready === undefined) throw new Error('editor did not expose its ready API');

  return ready;
};

const parentRoot = (): HTMLElement => {
  const found = holder?.querySelector<HTMLElement>('[data-blok-element][data-blok-id="db"]');

  if (found === null || found === undefined) throw new Error('missing parent database');

  return found;
};

/** The parent's visible view area: not the hidden pool where B itself lives. */
const shownArea = (): HTMLElement => {
  return own('[data-blok-database-board-container]');
};

/** An element of the parent's own chrome, never one inside the hidden source block. */
const own = (selector: string): HTMLElement => {
  const root = parentRoot();
  const found = [...root.querySelectorAll<HTMLElement>(selector)].find((el) => el.closest('[data-blok-element]') === root);

  if (found === undefined) throw new Error('missing ' + selector);

  return found;
};

const headers = (root: ParentNode): string[] =>
  [...root.querySelectorAll<HTMLElement>('[role="columnheader"][data-property-id]')].map((h) => h.getAttribute('data-property-id') ?? '');

describe('New data source: a view bound to a second source in the same block', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    holder = undefined;
    PopoverRegistry.resetForTests();
    vi.restoreAllMocks();
  });

  it('shows the source block\'s columns and rows, not the parent\'s', async () => {
    await make(doc('vb'));
    const area = shownArea();

    expect(headers(area)).toContain('size');
    expect(headers(area)).not.toContain('notes');
    expect(area.textContent).toContain('Source row');
    expect(area.textContent).not.toContain('Parent row');
  });

  it('keeps the parent\'s own view on the parent\'s data', async () => {
    await make(doc('v1'));
    const area = shownArea();

    expect(headers(area)).toContain('notes');
    expect(area.textContent).toContain('Parent row');
    expect(area.textContent).not.toContain('Source row');
  });

  it('the toolbar Filter lists the source\'s properties', async () => {
    await make(doc('vb'));
    own('[data-blok-testid="database-toolbar-filter"]').click();
    await quiet();
    const popover = [...document.querySelectorAll<HTMLElement>('[data-blok-popover]')].at(-1);

    expect(popover?.textContent).toContain('Size');
    expect(popover?.textContent).not.toContain('Notes');
  });

  it('the toolbar New adds a row to the source, not the parent', async () => {
    const api = await make(doc('vb'));

    own('[data-blok-testid="database-toolbar-new"]').click();
    await quiet();

    expect(api.blocks.getChildren('src-b').filter((b) => b.name === 'database-row')).toHaveLength(2);
    expect(api.blocks.getChildren('db').filter((b) => b.name === 'database-row')).toHaveLength(1);
  });

  it('the grid add-row adds a row to the source and shows it', async () => {
    const api = await make(doc('vb'));

    const add = shownArea().querySelector<HTMLElement>('[data-blok-database-table-add-row]');

    expect(add).not.toBeNull();
    add?.click();
    await quiet();

    expect(api.blocks.getChildren('src-b').filter((b) => b.name === 'database-row')).toHaveLength(2);
    expect(api.blocks.getChildren('db').filter((b) => b.name === 'database-row')).toHaveLength(1);
    expect(shownArea().querySelectorAll('[data-row-id]').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the source block hidden inside the parent', async () => {
    await make(doc('vb'));
    const sourceHolder = parentRoot().querySelector<HTMLElement>('[data-blok-id="src-b"]');
    expect(sourceHolder).not.toBeNull();
    expect(sourceHolder?.closest('[hidden]')).not.toBeNull();
  });

  const schemaOf = async (api: TestEditor, id: string): Promise<PropertyDefinition[]> => {
    const saved = await api.save();
    const data = saved.blocks.find((b) => b.id === id)?.data as DatabaseData | undefined;

    return data?.schema ?? [];
  };

  const addTextProperty = async (): Promise<void> => {
    shownArea().querySelector<HTMLElement>('[data-blok-database-table-add-property]')?.click();
    await quiet();
    document.querySelector<HTMLElement>('[data-blok-database-property-type-option="text"]')?.click();
    await quiet();
  };

  it('"Add property" on the source\'s view adds it to the source, not the parent', async () => {
    const api = await make(doc('vb'));

    await addTextProperty();

    expect(await schemaOf(api, 'src-b')).toHaveLength(3);
    expect(await schemaOf(api, 'db')).toEqual(parentSchema);
    expect(headers(shownArea())).toHaveLength(3);
  });

  it('a locked parent refuses a new property on its second source', async () => {
    const locked = parentSchema.map((p) => (p.type === 'title' ? { ...p, databaseLocked: true } : p));
    const api = await make(doc('vb', { schema: locked }));

    await addTextProperty();

    expect(await schemaOf(api, 'src-b')).toHaveLength(2);
  });

  /** The title line the person sees: the one title element of the parent that is not hidden. */
  const shownTitle = (): HTMLElement | undefined => {
    const root = parentRoot();

    return [...root.querySelectorAll<HTMLElement>('[data-blok-database-title]')]
      .find((el) => el.closest('[data-blok-element]') === root && !el.hidden);
  };

  const dataOf = async (api: TestEditor, id: string): Promise<DatabaseData | undefined> =>
    (await api.save()).blocks.find((b) => b.id === id)?.data as DatabaseData | undefined;

  it('the title line shows the selected view\'s source title', async () => {
    await make(doc('vb'));

    expect(shownTitle()?.textContent).toBe('Src B');
  });

  it('the title line shows the parent\'s own title on its own view', async () => {
    await make(doc('v1'));

    expect(shownTitle()?.textContent).toBe('Projects');
  });

  it('typing in the source title renames the source, not the parent', async () => {
    const api = await make(doc('vb'));
    const title = shownTitle();

    if (title === undefined) throw new Error('no title line');
    title.textContent = 'Inventory';
    title.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await quiet();

    expect((await dataOf(api, 'src-b'))?.title).toBe('Inventory');
    expect((await dataOf(api, 'db'))?.title).toBe('Projects');
  });

  it('"Hide data source titles" hides the source title too', async () => {
    await make(doc('vb', { hideDataSourceTitles: true }));

    expect(shownTitle()).toBeUndefined();
  });

  const plainDoc = (): OutputBlockData[] => [
    {
      id: 'db', type: 'database', content: ['r1'],
      data: { title: 'Projects', schema: parentSchema, views: [table('v1', 'a0'), table('v2', 'a1')], activeViewId: 'v1' },
    },
    { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Parent row', notes: 'n' }, position: 'a0' } },
  ];

  const sources = (api: TestEditor): string[] => api.blocks.getChildren('db').filter((b) => b.name === 'database').map((b) => b.id);

  const stopCapturing = (): void => {
    (editor as unknown as { module: { yjsManager: { stopCapturing: () => void } } }).module.yjsManager.stopCapturing();
  };

  const newDataSourceFromAddView = async (): Promise<void> => {
    own('[data-blok-database-add-view]').click();
    await quiet();
    const item = document.querySelector<HTMLElement>('[data-blok-database-view-new-source]');

    if (item === null) throw new Error('no "New data source" in the add-view menu');
    item.click();
    await quiet();
  };

  it('"New data source" ends the add-view menu', async () => {
    await make(plainDoc());
    own('[data-blok-database-add-view]').click();
    await quiet();
    const options = [...document.querySelectorAll<HTMLElement>('[data-blok-database-view-option], [data-blok-database-view-new-source]')];

    expect(options.at(-1)?.hasAttribute('data-blok-database-view-new-source')).toBe(true);
    expect(options.at(-1)?.textContent).toContain('New data source');
  });

  it('"New data source" adds a source with only a title and a selected Table view on it', async () => {
    const api = await make(plainDoc());

    await newDataSourceFromAddView();
    const [sourceId] = sources(api);
    const parent = await dataOf(api, 'db');
    const created = sourceId === undefined ? undefined : await dataOf(api, sourceId);
    const view = parent?.views.find((v) => v.dataSourceId === sourceId);

    expect(sourceId).toBeDefined();
    expect(created?.schema.map((p) => p.type)).toEqual(['title']);
    // Notion names a new source's title property "Name" (research/23 §10).
    expect(created?.schema.map((p) => p.name)).toEqual(['Name']);
    expect(view?.type).toBe('table');
    expect(parent?.activeViewId).toBe(view?.id);
    expect(parent?.schema).toEqual(parentSchema);
    expect(headers(shownArea())).toHaveLength(1);
    expect(parentRoot().querySelector(`[data-blok-id="${sourceId}"] :is([data-blok-database-tab-bar], [data-blok-database-title])`)).toBeNull();
  });

  it('one undo removes the new source and its view; redo brings both back', async () => {
    const api = await make(plainDoc());

    stopCapturing();
    await newDataSourceFromAddView();
    stopCapturing();
    expect(sources(api)).toHaveLength(1);

    api.history.undo();
    await quiet();
    expect(sources(api)).toHaveLength(0);
    expect((await dataOf(api, 'db'))?.views).toHaveLength(2);
    expect(headers(shownArea())).toContain('notes');
    expect(shownArea().textContent).toContain('Parent row');

    api.history.redo();
    await quiet();
    expect(sources(api)).toHaveLength(1);
    expect((await dataOf(api, 'db'))?.views).toHaveLength(3);
    const root = parentRoot();

    expect([...root.querySelectorAll('[role="tab"]')].filter((tab) => tab.closest('[data-blok-element]') === root)).toHaveLength(3);
    expect(root.querySelector(`[data-blok-id="${sources(api)[0]}"] :is([data-blok-database-tab-bar], [data-blok-database-title])`)).toBeNull();
  });

  it('undo after "New data source" is one step: it does not leave the view without its source', async () => {
    const api = await make(plainDoc());

    stopCapturing();
    await newDataSourceFromAddView();
    api.history.undo();
    await quiet();

    expect(sources(api)).toHaveLength(0);
    expect((await dataOf(api, 'db'))?.views.some((v) => v.dataSourceId !== undefined)).toBe(false);
  });

  it('a locked database does not offer "New data source"', async () => {
    const locked = parentSchema.map((p) => (p.type === 'title' ? { ...p, databaseLocked: true } : p));

    await make([{ ...plainDoc()[0], data: { ...plainDoc()[0].data, schema: locked } }, plainDoc()[1]]);

    expect(document.querySelector('[data-blok-database-view-new-source]')).toBeNull();
    expect(() => own('[data-blok-database-add-view]')).toThrow();
  });

  it('after "New data source" the parent\'s own tab bar selects the new Table tab', async () => {
    await make(plainDoc());
    await newDataSourceFromAddView();
    const root = parentRoot();
    const tabs = [...root.querySelectorAll<HTMLElement>('[role="tab"]')].filter((tab) => tab.closest('[data-blok-element]') === root);

    expect(tabs).toHaveLength(3);
    expect(tabs.find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent).toContain('Table');
  });

  it('the source block draws no chrome of its own inside the parent', async () => {
    await make(doc('vb'));
    const sourceHolder = parentRoot().querySelector<HTMLElement>('[data-blok-id="src-b"]');

    expect(sourceHolder?.querySelector('[data-blok-database-tab-bar], [data-blok-database-view-toolbar], [data-blok-database-title]')).toBeNull();
  });

  /** A database nested in a row page body: its holder sits in the parent's row pool, before the parent's own bar. */
  const nestedDoc = (): OutputBlockData[] => [
    {
      id: 'db', type: 'database', content: ['r1'],
      data: { title: 'Projects', schema: parentSchema, views: [table('v1', 'a0'), table('v2', 'a1', { name: 'Second' })], activeViewId: 'v1' },
    },
    { id: 'r1', type: 'database-row', parent: 'db', content: ['inner'], data: { properties: { t: 'Parent row', notes: 'n' }, position: 'a0' } },
    {
      id: 'inner', type: 'database', parent: 'r1',
      data: { title: 'Inner', schema: sourceSchema, views: [table('iv1', 'a0', { name: 'Inner one' }), table('iv2', 'a1', { name: 'Inner two' })], activeViewId: 'iv1' },
    },
  ];

  it('switching the parent\'s view rebuilds the parent\'s own tab bar, not a nested database\'s', async () => {
    await make(nestedDoc());
    const innerRoot = parentRoot().querySelector<HTMLElement>('[data-blok-element][data-blok-id="inner"]');

    expect(innerRoot?.querySelector('[data-blok-database-tab-bar]')?.textContent).toContain('Inner two');

    own('[role="tab"][data-view-id="v2"]').click();
    await quiet();

    expect(innerRoot?.querySelector('[data-blok-database-tab-bar]')?.textContent).toContain('Inner two');
    expect(innerRoot?.querySelector('[data-view-id="v2"]')).toBeNull();
    expect(own('[data-blok-database-view-bar] [data-blok-database-tab-bar]').querySelector('[aria-selected="true"]')?.getAttribute('data-view-id')).toBe('v2');
  });

  const byTestId = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-testid="${id}"]`);

  const openSettings = async (): Promise<void> => {
    own('[data-blok-testid="database-toolbar-settings"]').click();
    await quiet();
  };

  const openSourcePicker = async (): Promise<void> => {
    await openSettings();
    byTestId('database-settings-source')?.click();
    await quiet();
  };

  it('View settings "Source" names the view\'s source and opens the measured picker', async () => {
    await make(doc('v1'));
    await openSettings();
    const row = byTestId('database-settings-source');

    expect(row?.textContent).toContain('Source');
    expect(row?.textContent).toContain('Projects');
    row?.click();
    await quiet();
    const panel = byTestId('database-settings-source')?.closest('[data-blok-database-panel]') ?? document.querySelector('[data-blok-database-panel]');

    expect(panel?.textContent).toContain('Source');
    expect(byTestId('database-source-search')?.getAttribute('placeholder')).toBe('Link to a data source…');
    expect(panel?.textContent).toContain('Suggested');
    expect(byTestId('database-source-option-src-b')?.textContent).toContain('Src B');
    expect(byTestId('database-source-option-db')).toBeNull();
  });

  it('picking a source in "Source" shows that source\'s rows in the view and saves it', async () => {
    const api = await make(doc('v1'));

    await openSourcePicker();
    byTestId('database-source-option-src-b')?.click();
    await quiet();

    expect(shownArea().textContent).toContain('Source row');
    expect(shownArea().textContent).not.toContain('Parent row');
    expect(headers(shownArea())).toContain('size');
    expect((await dataOf(api, 'db'))?.views.find((v) => v.id === 'v1')?.dataSourceId).toBe('src-b');
    expect(shownTitle()?.textContent).toBe('Src B');
  });

  it('picking the database\'s own data puts the view back on it', async () => {
    const api = await make(doc('vb'));

    await openSourcePicker();
    byTestId('database-source-option-db')?.click();
    await quiet();

    expect(shownArea().textContent).toContain('Parent row');
    expect(shownArea().textContent).not.toContain('Source row');
    expect(JSON.stringify((await dataOf(api, 'db'))?.views.find((v) => v.id === 'vb'))).not.toContain('dataSourceId');
  });

  // research/26 §5b, 27 §5: every filter goes, only a sort on the title stays, and nothing comes back on the way back.
  it('picking another source drops every filter and every sort but the title one; switching back restores nothing', async () => {
    const sorted = {
      sorts: [
        { id: 's0', propertyId: 'notes', direction: 'asc' as const },
        { id: 's1', propertyId: 't', direction: 'desc' as const },
      ],
      filters: [
        { id: 'f1', propertyId: 'notes', operator: 'is_not_empty', value: null },
        { id: 'f2', propertyId: 't', operator: 'contains', value: 'a' },
      ],
      filterTree: { id: 'tree', conjunction: 'and' as const, filterRules: [{ id: 'r1', propertyId: 't', operator: 'contains', value: 'b' }] },
    };
    const api = await make(doc('v1', { views: [table('v1', 'a0', sorted), table('vb', 'a1', { dataSourceId: 'src-b' })] }));

    await openSourcePicker();
    byTestId('database-source-option-src-b')?.click();
    await quiet();
    const moved = (await dataOf(api, 'db'))?.views.find((v) => v.id === 'v1');

    expect(moved?.filters).toEqual([]);
    expect(moved?.filterTree?.filterRules ?? []).toEqual([]);
    // The title sort now names the new source's title.
    expect(moved?.sorts).toEqual([{ id: 's1', propertyId: 'bt', direction: 'desc' }]);
    expect(shownArea().textContent).toContain('Source row');

    await openSourcePicker();
    byTestId('database-source-option-db')?.click();
    await quiet();
    const back = (await dataOf(api, 'db'))?.views.find((v) => v.id === 'v1');

    expect(back?.filters).toEqual([]);
    expect(back?.sorts).toEqual([{ id: 's1', propertyId: 't', direction: 'desc' }]);
  });

  // research/27 §5: a sort on a property with the same name and type in both sources goes too.
  it('picking another source drops a sort on a property both sources have', async () => {
    const sorted = { sorts: [{ id: 's1', propertyId: 'size', direction: 'desc' as const }] };
    const shared: PropertyDefinition = { id: 'size', name: 'Size', type: 'number', position: 'a2' };
    const api = await make(doc('v1', {
      schema: [...parentSchema, shared],
      views: [table('v1', 'a0', sorted), table('vb', 'a1', { dataSourceId: 'src-b' })],
    }));

    await openSourcePicker();
    byTestId('database-source-option-src-b')?.click();
    await quiet();

    expect((await dataOf(api, 'db'))?.views.find((v) => v.id === 'v1')?.sorts).toEqual([]);
  });

  it('the search narrows the sources by name', async () => {
    await make(doc('v1'));
    await openSourcePicker();
    const search = byTestId('database-source-search');

    if (!(search instanceof HTMLInputElement)) throw new Error('no source search');
    search.value = 'zzz';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await quiet();

    expect(byTestId('database-source-option-src-b')).toBeNull();
  });

  // research/09 §1 and research/10: one source shows "Source (Measure DB, disabled)".
  it('a database with no second source shows "Source" greyed with its own name', async () => {
    await make(plainDoc());
    await openSettings();
    const row = byTestId('database-settings-source');

    expect(row).not.toBeNull();
    expect((row as HTMLButtonElement | null)?.disabled).toBe(true);
    expect(row?.textContent).toContain('Projects');
  });

  it('a gallery view moves onto a second source: a second source draws every layout', async () => {
    const api = await make(doc('vgallery', { views: [table('v1', 'a0'), { ...table('vgallery', 'a1'), type: 'gallery', name: 'Gallery' }, table('vb', 'a2', { dataSourceId: 'src-b' })] }));

    await openSettings();

    expect((byTestId('database-settings-source') as HTMLButtonElement | null)?.disabled).toBe(false);
    byTestId('database-settings-source')?.click();
    await quiet();
    byTestId('database-source-option-src-b')?.click();
    await quiet();

    expect((await dataOf(api, 'db'))?.views.find((v) => v.id === 'vgallery')?.dataSourceId).toBe('src-b');
    expect(shownArea().textContent).toContain('Source row');
    expect(shownArea().textContent).not.toContain('Parent row');
  });

  const confirmAction = (name: 'confirm' | 'cancel'): HTMLButtonElement | null =>
    document.querySelector<HTMLButtonElement>(`[data-blok-database-confirm-action="${name}"]`);
  const choiceCards = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-blok-database-confirm-choice]')];

  // Delete lives in the tab menu only (feel/findings-toolbar V12).
  const deleteFromTabMenu = async (): Promise<void> => {
    own('[data-blok-database-tab][data-view-id="vb"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await quiet();
    const item = [...document.querySelectorAll<HTMLElement>('[data-blok-popover-item], [role="menuitem"]')].find((el) => el.textContent?.trim() === 'Delete');

    if (item === undefined) throw new Error('no Delete in the tab menu');
    item.click();
    await quiet();
  };

  // research/26 §5a.
  it('deleting the only view on a source asks first, with "Delete view only" picked', async () => {
    const api = await make(doc('vb'));

    await deleteFromTabMenu();

    expect(document.querySelector('[data-blok-database-confirm-title]')?.textContent).toBe('Delete the last view for this data source?');
    expect(choiceCards().map((card) => card.querySelector('[data-blok-database-confirm-choice-label]')?.textContent)).toEqual(['Delete view only', 'Delete view and data source']);
    expect(choiceCards().map((card) => card.querySelector('[data-blok-database-confirm-choice-description]')?.textContent)).toEqual([
      'The data source and all of its pages will be kept in this database',
      'The data source and all of its pages will be deleted',
    ]);
    expect(choiceCards().map((card) => card.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect(confirmAction('confirm')?.textContent).toBe('Delete view');
    expect(confirmAction('confirm')?.hasAttribute('data-filled')).toBe(true);
    expect(confirmAction('cancel')?.textContent).toBe('Cancel');
    // research/26 §5a: a 17px title; Cancel keeps its border.
    expect(document.querySelector('[data-blok-database-confirm-dialog]')?.hasAttribute('data-large-title')).toBe(true);
    expect(confirmAction('cancel')?.hasAttribute('data-quiet')).toBe(false);
    // Nothing is deleted before the answer.
    expect((await dataOf(api, 'db'))?.views.some((v) => v.id === 'vb')).toBe(true);    confirmAction('cancel')?.click();
  });

  // research/30 B3.
  it('the last-view question opens with focus on its × "Close", which deletes nothing', async () => {
    const api = await make(doc('vb'));

    await deleteFromTabMenu();
    const close = document.querySelector<HTMLButtonElement>('[data-blok-database-confirm-close]');

    expect(close?.getAttribute('aria-label')).toBe('Close');
    expect(close).toHaveFocus();
    close?.click();
    await quiet();

    expect(document.querySelector('[data-blok-database-confirm-dialog]')).toBeNull();
    expect((await dataOf(api, 'db'))?.views.some((v) => v.id === 'vb')).toBe(true);
  });

  it('Cancel on the last-view question deletes nothing', async () => {
    const api = await make(doc('vb'));

    await deleteFromTabMenu();
    confirmAction('cancel')?.click();
    await quiet();

    expect((await dataOf(api, 'db'))?.views.some((v) => v.id === 'vb')).toBe(true);
    expect((await api.save()).blocks.some((b) => b.id === 'src-b')).toBe(true);
  });

  it('"Delete view and data source" removes the view, the source and its rows, and keeps the database\'s own rows', async () => {
    const api = await make(doc('vb'));

    stopCapturing();
    await deleteFromTabMenu();
    choiceCards()[1]?.click();
    confirmAction('confirm')?.click();
    await quiet();
    const saved = await api.save();

    expect((saved.blocks.find((b) => b.id === 'db')?.data as DatabaseData | undefined)?.views.map((v) => v.id)).toEqual(['v1']);
    expect(saved.blocks.some((b) => b.id === 'src-b')).toBe(false);
    expect(saved.blocks.some((b) => b.id === 'b1')).toBe(false);
    expect(saved.blocks.filter((b) => b.type === 'database-row').map((b) => b.id)).toEqual(['r1']);
    expect(api.blocks.getChildren('db').map((b) => b.id)).toEqual(['r1']);
    expect(shownArea().textContent).toContain('Parent row');
  });

  it('one undo after "Delete view and data source" brings back the view, the source and its rows', async () => {
    const api = await make(doc('vb'));

    stopCapturing();
    await deleteFromTabMenu();
    choiceCards()[1]?.click();
    confirmAction('confirm')?.click();
    await quiet();
    stopCapturing();
    api.history.undo();
    await quiet();
    const saved = await api.save();

    expect((saved.blocks.find((b) => b.id === 'db')?.data as DatabaseData | undefined)?.views.map((v) => v.id)).toEqual(['v1', 'vb']);
    expect(saved.blocks.find((b) => b.id === 'src-b')?.parent).toBe('db');
    expect(saved.blocks.find((b) => b.id === 'b1')?.parent).toBe('src-b');
  });

  it('the tab menu\'s Delete asks the same question on the last view of a source', async () => {
    await make(doc('vb'));
    const tab = own('[data-blok-database-tab][data-view-id="vb"]');

    tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await quiet();
    const item = [...document.querySelectorAll<HTMLElement>('[data-blok-popover-item], [role="menuitem"]')].find((el) => el.textContent?.trim() === 'Delete view');

    if (item === undefined) throw new Error('no Delete view in the tab menu');
    item.click();
    await quiet();

    expect(document.querySelector('[data-blok-database-confirm-title]')?.textContent).toBe('Delete the last view for this data source?');
    confirmAction('cancel')?.click();
  });

  it('deleting a source view while another view still shows the source asks only "Delete this view?"', async () => {
    const api = await make(doc('vb', { views: [table('v1', 'a0'), table('vb', 'a1', { dataSourceId: 'src-b' }), table('vb2', 'a2', { dataSourceId: 'src-b' })] }));

    await deleteFromTabMenu();

    expect(document.querySelector('[data-blok-database-confirm-title]')?.textContent).toBe('Delete this view?');
    expect(document.querySelector('[data-blok-database-confirm-choices]')).toBeNull();
    confirmAction('confirm')?.click();
    await quiet();
    expect((await dataOf(api, 'db'))?.views.map((v) => v.id)).toEqual(['v1', 'vb2']);
  });

  it('deleting the only view on a source keeps the source and its rows, still reachable from "Source"', async () => {
    const api = await make(doc('vb'));

    await deleteFromTabMenu();
    confirmAction('confirm')?.click();
    await quiet();
    const saved = await api.save();

    expect((saved.blocks.find((b) => b.id === 'db')?.data as DatabaseData | undefined)?.views.some((v) => v.id === 'vb')).toBe(false);
    expect(saved.blocks.some((b) => b.id === 'src-b')).toBe(true);
    expect(saved.blocks.some((b) => b.id === 'b1')).toBe(true);

    await openSourcePicker();
    byTestId('database-source-option-src-b')?.click();
    await quiet();

    expect(shownArea().textContent).toContain('Source row');
  });

  it('opening a source row shows its page in the parent, not inside the hidden source', async () => {
    await make(doc('vb'));
    const open = shownArea().querySelector<HTMLElement>('[data-row-id="b1"] [data-blok-database-table-open]');

    expect(open).not.toBeNull();
    open?.click();
    await quiet();
    const drawer = document.querySelector<HTMLElement>('[data-blok-database-drawer]');

    expect(drawer).not.toBeNull();
    expect(drawer?.closest('[hidden], .hidden')).toBeNull();
    expect(drawer?.closest('[data-blok-element]')).toBe(parentRoot());
  });
});
