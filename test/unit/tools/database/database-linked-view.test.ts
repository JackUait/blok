import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseData, DatabaseLinkedSourceSnapshot, PropertyDefinition } from '../../../../src/tools/database/types';
import { buildDatabase, makeDoc, rowSeed } from './structure-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

type MenuItem = { title?: string; onActivate?: (...args: unknown[]) => void; children?: { items?: MenuItem[] } };

const popovers = vi.hoisted(() => ({ items: [] as unknown[][] }));

vi.mock('../../../../src/components/utils/popover', () => {
  class MockPopoverDesktop {
    constructor(params: { items?: unknown[] } = {}) {
      popovers.items.push(params.items ?? []);
    }

    show(): void {}

    hide(): void {}

    destroy(): void {}

    on(): void {}

    off(): void {}

    getElement(): HTMLElement {
      return document.createElement('div');
    }
  }

  return { PopoverDesktop: MockPopoverDesktop, PopoverMobile: MockPopoverDesktop, PopoverItemType: { Default: 'default', Separator: 'separator', Html: 'html' } };
});

const sourceSchema: PropertyDefinition[] = [
  { id: 'title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'status', name: 'Status', type: 'text', position: 'a1' },
];

const sourceData = (): DatabaseData => ({
  title: 'Tasks',
  schema: structuredClone(sourceSchema),
  views: [{ id: 'sv', name: 'All', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['status'] }],
  activeViewId: 'sv',
});

const stub: PropertyDefinition[] = [{ id: 'stub-title', name: 'Name', type: 'title', position: 'a0' }];

const linkedData = (databaseId = 'db'): DatabaseData => ({
  source: { databaseId },
  schema: structuredClone(stub),
  views: [{ id: 'lv', name: 'Mine', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['status'] }],
  activeViewId: 'lv',
});

const docWithSource = (): ReturnType<typeof makeDoc> => makeDoc([
  { id: 'db', name: 'database', parentId: null, data: {} },
  rowSeed('r1', 'db', { properties: { title: 'One', status: 'open' }, position: 'a0' }),
  rowSeed('r2', 'db', { properties: { title: 'Two' }, position: 'a1' }),
  { id: 'linked', name: 'database', parentId: null, data: {} },
]);

const rowIds = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('[data-blok-database-table-row]')].map((row) => row.getAttribute('data-row-id') ?? '');

type Internals = { commitTableCell: (r: string, p: string, v: unknown) => void; updateActiveView: (c: Record<string, unknown>) => void };

describe('DatabaseTool — linked database', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    popovers.items.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('shows the source database\'s rows and schema', () => {
    const doc = docWithSource();

    buildDatabase(doc, 'db', sourceData());
    const { el } = buildDatabase(doc, 'linked', linkedData());

    expect(rowIds(el)).toEqual(['r1', 'r2']);
    expect(el.querySelector('[data-blok-database-table-row][data-row-id="r1"] [data-property-id="status"]')?.textContent).toBe('open');
  });

  it('writes a cell edit to the source\'s row block', () => {
    const doc = docWithSource();

    buildDatabase(doc, 'db', sourceData());
    const { tool } = buildDatabase(doc, 'linked', linkedData());

    (tool as unknown as Internals).commitTableCell('r2', 'status', 'done');

    expect(doc.row('r2').properties.status).toBe('done');
  });

  it('merges CSV rows under the source and never under itself', () => {
    const doc = docWithSource();

    buildDatabase(doc, 'db', sourceData());
    const { tool } = buildDatabase(doc, 'linked', linkedData());

    tool.mergeCsv('Name\nThree\n');

    expect(doc.childrenOf('db')).toHaveLength(3);
    expect(doc.childrenOf('linked')).toEqual([]);
  });

  it('adds a merged CSV\'s unmatched column to the source and shows it in its own view', () => {
    const doc = docWithSource();
    const source = buildDatabase(doc, 'db', sourceData());
    const { tool, el } = buildDatabase(doc, 'linked', linkedData());

    tool.mergeCsv('Name,Extra\nThree,x\n');

    const extra = source.tool.save(document.createElement('div')).schema.find((p) => p.name === 'Extra');
    const row = doc.childrenOf('db').map((id) => doc.row(id)).find((data) => data.properties.title === 'Three');

    expect(extra?.type).toBe('text');
    expect(row?.properties[extra?.id ?? '']).toBe('x');
    expect(el.querySelector(`[data-blok-database-table-row] [data-property-id="${extra?.id ?? ''}"]`)).not.toBeNull();
  });

  it('adds a new row under the source and never under itself', () => {
    const doc = docWithSource();

    buildDatabase(doc, 'db', sourceData());
    const { tool } = buildDatabase(doc, 'linked', linkedData());

    const id = tool.newRow();

    expect(doc.childrenOf('db')).toContain(id);
    expect(doc.childrenOf('linked')).toEqual([]);
  });

  it('opens a row in its own view\'s "Open pages in" mode, not the source\'s', () => {
    const doc = docWithSource();
    const linked = linkedData();

    linked.views[0].openPagesIn = 'center';
    buildDatabase(doc, 'db', sourceData());
    const { el } = buildDatabase(doc, 'linked', linked);

    el.querySelector<HTMLElement>('[data-blok-database-table-row][data-row-id="r1"] [data-blok-database-table-open]')?.click();

    expect(document.querySelector('[data-blok-database-drawer]')?.getAttribute('data-peek-mode')).toBe('center');
  });

  it('a row menu "Open in" pick in a linked view switches the source\'s open peek', () => {
    const doc = docWithSource();
    const source = buildDatabase(doc, 'db', sourceData());
    const { el } = buildDatabase(doc, 'linked', linkedData());

    source.tool.openRow({ rowId: 'r1' });
    expect(document.querySelector('[data-blok-database-drawer]')?.getAttribute('data-peek-mode')).toBe('side');

    el.querySelector<HTMLElement>('[data-row-id="r2"] [data-blok-database-table-row-handle]')?.click();
    const menu = (popovers.items.at(-1) ?? []) as MenuItem[];
    const openIn = menu.find((item) => item.title === 'tools.database.tableOpenIn')?.children?.items ?? [];

    openIn.find((item) => item.title === 'tools.database.openPagesCenter')?.onActivate?.();

    expect(document.querySelector('[data-blok-database-drawer]')?.getAttribute('data-peek-mode')).toBe('center');
  });

  it('a linked view\'s own mode does not switch a peek the source already has open', () => {
    const doc = docWithSource();
    const linked = linkedData();

    linked.views[0].openPagesIn = 'center';
    const source = buildDatabase(doc, 'db', sourceData());
    const { el } = buildDatabase(doc, 'linked', linked);

    source.tool.openRow({ rowId: 'r1' });
    el.querySelector<HTMLElement>('[data-blok-database-table-row][data-row-id="r2"] [data-blok-database-table-open]')?.click();

    expect(document.querySelector('[data-blok-database-drawer]')?.getAttribute('data-peek-mode')).toBe('side');
  });

  it('keeps its views to itself', () => {
    const doc = docWithSource();
    const source = buildDatabase(doc, 'db', sourceData());
    const { tool } = buildDatabase(doc, 'linked', linkedData());

    (tool as unknown as Internals).updateActiveView({ sorts: [{ id: 's1', propertyId: 'status', direction: 'asc' }] });

    expect(tool.save(document.createElement('div')).views[0].sorts).toHaveLength(1);
    expect(source.tool.save(document.createElement('div')).views[0].sorts).toHaveLength(0);
  });

  it('renames a property on the source', () => {
    const doc = docWithSource();
    const source = buildDatabase(doc, 'db', sourceData());
    const { tool } = buildDatabase(doc, 'linked', linkedData());

    tool.renameProperty('status', 'State');

    expect(source.tool.save(document.createElement('div')).schema.find((p) => p.id === 'status')?.name).toBe('State');
  });

  it('saves its reference and the stand-in schema, not a copy of the source', () => {
    const doc = docWithSource();

    buildDatabase(doc, 'db', sourceData());
    const { tool } = buildDatabase(doc, 'linked', linkedData());
    const saved = tool.save(document.createElement('div'));

    expect(saved.source).toEqual({ databaseId: 'db' });
    expect(saved.schema).toEqual(stub);
    expect(tool.validate(saved)).toBe(true);
  });

  it('keeps showing the source schema after undo replaces its data', () => {
    const doc = docWithSource();

    buildDatabase(doc, 'db', sourceData());
    const { tool, el } = buildDatabase(doc, 'linked', linkedData());

    expect(tool.setData({ ...linkedData(), views: [{ ...linkedData().views[0], name: 'Renamed' }] })).toBe(true);
    (tool as unknown as { rerenderView: () => void }).rerenderView();

    expect(el.querySelector('[data-blok-database-table-row][data-row-id="r1"] [data-property-id="status"]')?.textContent).toBe('open');
  });

  it('shows a "source deleted" state when the source is gone', () => {
    const doc = makeDoc([{ id: 'linked', name: 'database', parentId: null, data: {} }]);
    const { el } = buildDatabase(doc, 'linked', linkedData('gone'));

    expect(el.querySelector('[data-blok-database-source-missing]')).not.toBeNull();
    expect(el.querySelector('[data-blok-database-table]')).toBeNull();
  });

  it('switches to the "source deleted" state when a peer deletes the source', async () => {
    const doc = docWithSource();
    const source = buildDatabase(doc, 'db', sourceData());
    const { el } = buildDatabase(doc, 'linked', linkedData());

    doc.deleted.push('db');
    source.tool.destroy();
    await Promise.resolve();
    await Promise.resolve();

    expect(el.querySelector('[data-blok-database-source-missing]')).not.toBeNull();
  });

  it('a new linked view picks a database of the document and copies its first table view', () => {
    const doc = docWithSource();

    buildDatabase(doc, 'db', sourceData());
    const { tool, el } = buildDatabase(doc, 'linked', { initialView: 'table', linkPicker: true } as unknown as DatabaseData);
    const pick = (popovers.items as Array<Array<{ element?: HTMLElement }>>).flat()
      .map((item) => item.element?.querySelector<HTMLElement>('[data-blok-testid="database-linked-source-db"]'))
      .find((row) => row !== null && row !== undefined);

    expect(pick).toBeDefined();
    pick?.click();

    const saved = tool.save(document.createElement('div'));

    expect(saved.source).toEqual({ databaseId: 'db' });
    expect(saved.views).toHaveLength(1);
    expect(saved.views[0]).toMatchObject({ type: 'table', visibleProperties: ['status'] });
    expect(saved.views[0].id).not.toBe('sv');
    expect(rowIds(el)).toEqual(['r1', 'r2']);
  });

  it('shows a source in another document through the host lever, read-only', async () => {
    const doc = makeDoc([{ id: 'linked', name: 'database', parentId: null, data: {} }]);
    const resolve = vi.fn(async () => ({ schema: sourceSchema, rows: [{ id: 'far', position: 'a0', properties: { title: 'Far away', status: 'x' } }] }));
    const { el } = buildDatabase(doc, 'linked', { ...linkedData('remote-db'), source: { databaseId: 'remote-db', documentId: 'doc-2' } }, { linkedSources: { resolve } });

    await vi.waitFor(() => expect(rowIds(el)).toEqual(['far']));
    expect(resolve).toHaveBeenCalledWith({ documentId: 'doc-2', databaseId: 'remote-db' });
    expect(el.querySelector('[data-blok-database-table-grid]')?.getAttribute('aria-readonly')).toBe('true');
  });
});

type HtmlItem = { element?: HTMLElement };

/** The newest panel the popover mock was handed, by its test id. */
const panelById = (testId: string): HTMLElement | undefined => (popovers.items as HtmlItem[][])
  .flat()
  .map((item) => item.element)
  .filter((element): element is HTMLElement => element instanceof HTMLElement && element.getAttribute('data-blok-testid') === testId)
  .at(-1);

const rowLabels = (panel: HTMLElement | undefined): string[] =>
  [...(panel?.querySelectorAll('[data-blok-database-panel-row]:not([hidden])') ?? [])].map((row) => row.querySelector('[data-blok-database-panel-label]')?.textContent ?? '');

const manySources = (): ReturnType<typeof makeDoc> => makeDoc([
  { id: 'db', name: 'database', parentId: null, data: { title: 'Tasks' } },
  rowSeed('r1', 'db', { properties: { title: 'One' }, position: 'a0', title: 'One' }),
  { id: 'db2', name: 'database', parentId: null, data: { title: 'Notes' } },
  { id: 'db3', name: 'database', parentId: null, data: { title: 'People' } },
  { id: 'db4', name: 'database', parentId: 'r1', data: { title: 'Inner' } },
  { id: 'linked', name: 'database', parentId: null, data: {} },
]);

describe('DatabaseTool — linked view, research 20 §2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    popovers.items.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a new linked view opens the "New database" panel: search, new empty source, three sources with their parent page, Show more', () => {
    const doc = manySources();

    buildDatabase(doc, 'db', sourceData());
    buildDatabase(doc, 'linked', { initialView: 'table', linkPicker: true } as unknown as DatabaseData);
    const panel = panelById('database-linked-picker');

    // The header also holds the × (findings-creation N19).
    expect(panel?.querySelector('[data-blok-database-panel-header]')?.textContent?.trim()).toBe('tools.database.linkedPanelTitle');
    expect(panel?.querySelector('[data-blok-database-panel-close]')).not.toBeNull();
    expect(panel?.querySelector('input')?.placeholder).toBe('tools.database.linkedSearch');
    expect(panel?.querySelector('[data-blok-database-panel-section]')?.textContent).toBe('tools.database.layoutExistingDataSources');
    expect(rowLabels(panel)).toEqual(['tools.database.linkedNewEmpty', 'Tasks', 'Notes', 'People', 'tools.database.linkedShowMore']);
    expect(panel?.querySelector('[data-blok-testid="database-linked-source-db4"]')).toBeNull();

    panel?.querySelector<HTMLElement>('[data-blok-testid="database-linked-show-more"]')?.click();

    expect(rowLabels(panel)).toEqual(['tools.database.linkedNewEmpty', 'Tasks', 'Notes', 'People', 'Inner']);
    expect(panel?.querySelector('[data-blok-testid="database-linked-source-db4"] [data-blok-database-panel-description]')?.textContent).toBe('One');
  });

  it('typing narrows the sources and offers a new named source; picking it makes an ordinary database with that title', () => {
    const doc = manySources();

    buildDatabase(doc, 'db', sourceData());
    const { tool } = buildDatabase(doc, 'linked', { initialView: 'table', linkPicker: true } as unknown as DatabaseData);
    const panel = panelById('database-linked-picker');
    const input = panel?.querySelector('input');

    if (input === null || input === undefined) throw new Error('no search field');
    input.value = 'not';
    input.dispatchEvent(new Event('input'));

    expect(rowLabels(panel)).toEqual(['Notes', 'tools.database.linkedNewNamed {"name":"not"}']);
    panel?.querySelector<HTMLElement>('[data-blok-testid="database-linked-new-named"]')?.click();

    const saved = tool.save(document.createElement('div'));

    expect(saved.source).toBeUndefined();
    expect(saved.title).toBe('not');
  });

  it('picking a source shows its rows and the "New view" page: New table view, then the source\'s views to copy', () => {
    const doc = docWithSource();
    const data = sourceData();

    data.views.push({ id: 'sb', name: 'Board', type: 'board', position: 'a1', sorts: [], filters: [], visibleProperties: [] });
    data.views.push({ id: 'sf', name: 'Signup', type: 'form', position: 'a2', sorts: [], filters: [], visibleProperties: [] });
    buildDatabase(doc, 'db', data);
    const { tool, el } = buildDatabase(doc, 'linked', { initialView: 'table', linkPicker: true } as unknown as DatabaseData);

    panelById('database-linked-picker')?.querySelector<HTMLElement>('[data-blok-testid="database-linked-source-db"]')?.click();

    expect(rowIds(el)).toEqual(['r1', 'r2']);
    const panel = panelById('database-linked-picker');

    expect(panel?.querySelector('[data-blok-database-panel-header]')?.textContent?.trim()).toBe('tools.database.newView');
    expect(panel?.querySelector('[data-blok-database-panel-section]')?.textContent).toBe('tools.database.linkedViewsOn {"name":"Tasks"}');
    expect(rowLabels(panel)).toEqual(['tools.database.linkedNewTableView', 'All', 'Board']);

    panel?.querySelector<HTMLElement>('[data-blok-testid="database-linked-view-sb"]')?.click();
    const saved = tool.save(document.createElement('div'));

    expect(saved.views).toHaveLength(1);
    expect(saved.views[0]).toMatchObject({ type: 'board', name: 'Board' });
    expect(saved.views[0].id).not.toBe('sb');
    expect(saved.activeViewId).toBe(saved.views[0].id);
  });

  it('"New table view" gives the linked view a fresh table that shows every property', () => {
    const doc = docWithSource();

    buildDatabase(doc, 'db', sourceData());
    const { tool } = buildDatabase(doc, 'linked', { initialView: 'table', linkPicker: true } as unknown as DatabaseData);

    panelById('database-linked-picker')?.querySelector<HTMLElement>('[data-blok-testid="database-linked-source-db"]')?.click();
    panelById('database-linked-picker')?.querySelector<HTMLElement>('[data-blok-testid="database-linked-new-table-view"]')?.click();
    const saved = tool.save(document.createElement('div'));

    expect(saved.views).toHaveLength(1);
    expect(saved.views[0]).toMatchObject({ type: 'table', sorts: [], filters: [] });
    expect(saved.views[0].id).not.toBe('sv');
    expect(saved.source).toEqual({ databaseId: 'db' });
  });

  it('the title is a link to the source with an arrow, never editable', () => {
    const doc = docWithSource();
    const scrollToBlock = vi.fn();

    (doc.api.blocks as unknown as Record<string, unknown>).scrollToBlock = scrollToBlock;
    const source = buildDatabase(doc, 'db', sourceData());
    const { el } = buildDatabase(doc, 'linked', linkedData());
    const title = el.querySelector<HTMLElement>('[data-blok-database-title]');
    const link = title?.querySelector('a');

    expect(link?.textContent?.trim()).toBe('Tasks');
    expect(link?.querySelector('svg')).not.toBeNull();
    expect(title?.getAttribute('contenteditable')).toBeNull();
    expect(link?.hasAttribute('href')).toBe(false);
    expect(source.el.querySelector('[data-blok-database-title]')?.getAttribute('contenteditable')).toBe('true');

    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));

    expect(scrollToBlock).toHaveBeenCalledWith('db', { select: false });
  });

  it('reads "Lock views" and locks only itself, never the source', () => {
    const doc = docWithSource();
    const source = buildDatabase(doc, 'db', sourceData());
    const { tool, el } = buildDatabase(doc, 'linked', linkedData());

    (tool as unknown as { controls: { openSettings: (a: HTMLElement, p: string) => void } }).controls.openSettings(el, 'root');
    const lock = panelById('database-view-settings')?.querySelector<HTMLElement>('[data-blok-testid="database-settings-lock"]');

    expect(lock?.textContent).toContain('tools.database.settingsLockViews');
    lock?.click();

    expect(source.tool.save(document.createElement('div')).schema.find((p) => p.type === 'title')?.databaseLocked).toBeUndefined();
    expect(tool.save(document.createElement('div')).schema[0].databaseLocked).toBe(true);
    expect(el.querySelector('[data-blok-database-add-view]')).toBeNull();
  });

  it('"Show data source title" off hides the "↗ source" title of that view only, and saves on the view', () => {
    const doc = docWithSource();
    const data = linkedData();

    data.views.push({ id: 'lv2', name: 'Other', type: 'table', position: 'a1', sorts: [], filters: [], visibleProperties: ['status'] });
    buildDatabase(doc, 'db', sourceData());
    const { tool, el } = buildDatabase(doc, 'linked', data);
    const title = (): HTMLElement | null => el.querySelector<HTMLElement>('[data-blok-database-title]');

    expect(title()?.hidden).toBe(false);
    (tool as unknown as { controls: { openSettings: (a: HTMLElement, p: string) => void } }).controls.openSettings(el, 'root');
    panelById('database-view-settings')?.querySelector<HTMLElement>('[data-blok-testid="database-settings-layout"]')?.click();
    panelById('database-view-settings')?.querySelector<HTMLElement>('[data-blok-testid="database-settings-data-source-title"]')?.click();

    expect(title()?.hidden).toBe(true);
    expect(tool.save(document.createElement('div')).views.find((view) => view.id === 'lv')?.showDataSourceTitle).toBe(false);

    el.querySelector<HTMLElement>('[data-blok-database-tab][data-view-id="lv2"]')?.click();
    expect(title()?.hidden).toBe(false);
    el.querySelector<HTMLElement>('[data-blok-database-tab][data-view-id="lv"]')?.click();
    expect(title()?.hidden).toBe(true);
  });

  describe('"+" add view on a linked view (research 20 §2b)', () => {
    const withBoard = (): DatabaseData => {
      const data = sourceData();

      data.views.push({ id: 'sb', name: 'Board', type: 'board', position: 'a1', sorts: [], filters: [], visibleProperties: [] });
      data.views.push({ id: 'sf', name: 'Signup', type: 'form', position: 'a2', sorts: [], filters: [], visibleProperties: [] });

      return data;
    };

    it('the new tab appears at once, then "Link to existing data source" with "Link…" and the source under "Suggested"', () => {
      const doc = docWithSource();

      buildDatabase(doc, 'db', withBoard());
      const { tool, el } = buildDatabase(doc, 'linked', linkedData());

      tool.addView('map');
      const panel = panelById('database-linked-add-view');

      expect(el.querySelectorAll('[data-blok-database-tab]')).toHaveLength(2);
      expect(panel?.querySelector('[data-blok-database-panel-header]')?.textContent?.trim()).toBe('tools.database.linkedLinkExisting');
      expect(panel?.querySelector('input')?.placeholder).toBe('tools.database.linkedLinkSearch');
      expect(panel?.querySelector('[data-blok-database-panel-section]')?.textContent).toBe('tools.database.linkedSuggested');
      expect(rowLabels(panel)).toEqual(['Tasks']);
    });

    it('picking the source shows "New view": "New <layout> view", then the source\'s views and this block\'s own', () => {
      const doc = docWithSource();

      buildDatabase(doc, 'db', withBoard());
      const { tool } = buildDatabase(doc, 'linked', linkedData());

      tool.addView('map');
      panelById('database-linked-add-view')?.querySelector<HTMLElement>('[data-blok-testid="database-linked-source-db"]')?.click();
      const panel = panelById('database-linked-add-view');

      expect(panel?.querySelector('[data-blok-database-panel-header]')?.textContent?.trim()).toBe('tools.database.newView');
      expect(panel?.querySelector('[data-blok-database-panel-section]')?.textContent).toBe('tools.database.linkedViewsOn {"name":"Tasks"}');
      expect(rowLabels(panel)).toEqual(['tools.database.linkedNewMapView', 'All', 'Board', 'Mine']);
    });

    it('a listed view is copied into the new tab only; the block\'s other views stay', () => {
      const doc = docWithSource();

      buildDatabase(doc, 'db', withBoard());
      const { tool } = buildDatabase(doc, 'linked', linkedData());

      tool.addView('map');
      const added = tool.save(document.createElement('div')).views[1];

      panelById('database-linked-add-view')?.querySelector<HTMLElement>('[data-blok-testid="database-linked-source-db"]')?.click();
      panelById('database-linked-add-view')?.querySelector<HTMLElement>('[data-blok-testid="database-linked-view-sb"]')?.click();
      const saved = tool.save(document.createElement('div'));

      expect(saved.views).toHaveLength(2);
      expect(saved.views[0]).toMatchObject({ id: 'lv', name: 'Mine', type: 'table' });
      expect(saved.views[1]).toMatchObject({ id: added.id, position: added.position, name: 'Board', type: 'board' });
      expect(saved.activeViewId).toBe(added.id);
      expect(saved.source).toEqual({ databaseId: 'db' });
    });

    it('"New <layout> view" keeps the new tab as added', () => {
      const doc = docWithSource();

      buildDatabase(doc, 'db', withBoard());
      const { tool } = buildDatabase(doc, 'linked', linkedData());

      tool.addView('board');
      const added = tool.save(document.createElement('div')).views[1];

      panelById('database-linked-add-view')?.querySelector<HTMLElement>('[data-blok-testid="database-linked-source-db"]')?.click();
      panelById('database-linked-add-view')?.querySelector<HTMLElement>('[data-blok-testid="database-linked-new-view"]')?.click();

      expect(tool.save(document.createElement('div')).views[1]).toEqual(added);
    });

    it('a database that holds its own rows opens no source panel on add view', () => {
      const doc = docWithSource();
      const { tool } = buildDatabase(doc, 'db', sourceData());

      tool.addView('board');

      expect(panelById('database-linked-add-view')).toBeUndefined();
    });
  });

  it('the source keeps "Lock database"', () => {
    const doc = docWithSource();
    const { tool, el } = buildDatabase(doc, 'db', sourceData());

    (tool as unknown as { controls: { openSettings: (a: HTMLElement, p: string) => void } }).controls.openSettings(el, 'root');

    expect(panelById('database-view-settings')?.querySelector('[data-blok-testid="database-settings-lock"]')?.textContent).toContain('tools.database.settingsLockDatabase');
  });

  it('its add-view menu has no Form', () => {
    const doc = docWithSource();
    const source = buildDatabase(doc, 'db', sourceData());
    const { el } = buildDatabase(doc, 'linked', linkedData());
    const options = (): string[] => (popovers.items.at(-1) as HtmlItem[]).map((item) => item.element?.getAttribute('data-blok-database-view-option') ?? '').filter((type) => type !== '');

    el.querySelector<HTMLElement>('[data-blok-database-add-view]')?.click();
    expect(options()).not.toContain('form');
    expect(options()).toContain('table');

    source.el.querySelector<HTMLElement>('[data-blok-database-add-view]')?.click();
    expect(options()).toContain('form');
  });

  it('a deleted source leaves a read-only banner, and the view comes back with its own sorts when the source returns', async () => {
    const doc = docWithSource();
    const source = buildDatabase(doc, 'db', sourceData());
    const linked = linkedData();

    linked.views[0].sorts = [{ id: 's1', propertyId: 'title', direction: 'desc' }];
    const { tool, el } = buildDatabase(doc, 'linked', linked);

    expect(rowIds(el)).toEqual(['r2', 'r1']);
    doc.deleted.push('db', 'r1', 'r2');
    source.tool.destroy();
    await Promise.resolve();
    await Promise.resolve();

    const banner = el.querySelector('[data-blok-database-source-missing]');

    expect(banner?.textContent).toContain('tools.database.linkedSourceMissing');
    expect(banner?.querySelector('svg')).not.toBeNull();
    expect(el.querySelector('[data-blok-database-title] a')).toBeNull();
    expect(el.querySelector('[data-blok-database-title]')?.textContent?.trim()).toBe('Tasks');
    expect(el.querySelector('[data-blok-database-add-view]')).toBeNull();

    doc.deleted.length = 0;
    buildDatabase(doc, 'db', sourceData());

    expect(el.querySelector('[data-blok-database-source-missing]')).toBeNull();
    expect(rowIds(el)).toEqual(['r2', 'r1']);
    expect(tool.save(document.createElement('div')).views[0].sorts).toHaveLength(1);
  });
});

describe('DatabaseTool — linked view of a database in another document (config.linkedSources)', () => {
  type Ref = { documentId: string; databaseId: string };
  type Snapshot = DatabaseLinkedSourceSnapshot;

  const far = (title = 'Far away'): Snapshot => ({
    title: 'Roadmap',
    schema: structuredClone(sourceSchema),
    rows: [{ id: 'far', position: 'a0', properties: { title, status: 'x' } }],
    views: [{ id: 'rv', name: 'Remote board', type: 'board', position: 'a0', sorts: [], filters: [], visibleProperties: [], groupBy: 'status' }],
  });

  const remoteHit = { documentId: 'doc-2', databaseId: 'remote-db', title: 'Roadmap', path: 'Planning' };

  const remoteLinked = (): DatabaseData => ({ ...linkedData('remote-db'), source: { databaseId: 'remote-db', documentId: 'doc-2' } });

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    popovers.items.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('lists the host\'s sources after this document\'s, under the same "Existing data sources" label, with their path', async () => {
    const doc = docWithSource();
    const search = vi.fn(async () => [remoteHit]);

    buildDatabase(doc, 'db', sourceData());
    buildDatabase(doc, 'linked', { initialView: 'table', linkPicker: true } as unknown as DatabaseData, { linkedSources: { search, resolve: vi.fn(async () => far()) } });
    const panel = panelById('database-linked-picker');

    await vi.waitFor(() => expect(rowLabels(panel)).toEqual(['tools.database.linkedNewEmpty', 'Tasks', 'Roadmap']));
    expect(search).toHaveBeenCalledWith({ query: '' });
    expect(panel?.querySelectorAll('[data-blok-database-panel-section]')).toHaveLength(1);
    expect(panel?.querySelector('[data-blok-testid="database-linked-source-remote-db"] [data-blok-database-panel-description]')?.textContent).toBe('Planning');
  });

  it('asks the host again on each query and drops an answer to an older one', async () => {
    const doc = docWithSource();
    const answers: Array<(hits: typeof remoteHit[]) => void> = [];
    const search = vi.fn(() => new Promise<typeof remoteHit[]>((resolve) => answers.push(resolve)));

    buildDatabase(doc, 'db', sourceData());
    buildDatabase(doc, 'linked', { initialView: 'table', linkPicker: true } as unknown as DatabaseData, { linkedSources: { search, resolve: vi.fn(async () => far()) } });
    const panel = panelById('database-linked-picker');
    const input = panel?.querySelector('input');

    if (input === null || input === undefined) throw new Error('no search field');
    input.value = 'road';
    input.dispatchEvent(new Event('input'));
    expect(search).toHaveBeenLastCalledWith({ query: 'road' });

    answers[1]([remoteHit]);
    await flush();
    answers[0]([{ ...remoteHit, databaseId: 'stale', title: 'Stale' }]);
    await flush();

    expect(rowLabels(panel)).toEqual(['Roadmap', 'tools.database.linkedNewNamed {"name":"road"}']);
  });

  it('a host search that throws lists this document\'s databases only', async () => {
    const doc = docWithSource();

    buildDatabase(doc, 'db', sourceData());
    buildDatabase(doc, 'linked', { initialView: 'table', linkPicker: true } as unknown as DatabaseData, { linkedSources: { search: async () => { throw new Error('offline'); }, resolve: vi.fn(async () => far()) } });
    await flush();

    expect(rowLabels(panelById('database-linked-picker'))).toEqual(['tools.database.linkedNewEmpty', 'Tasks']);
  });

  it('picking a host source shows its rows read-only and saves only the pointer', async () => {
    const doc = docWithSource();
    const resolve = vi.fn(async () => far());

    buildDatabase(doc, 'db', sourceData());
    const { tool, el } = buildDatabase(doc, 'linked', { initialView: 'table', linkPicker: true } as unknown as DatabaseData, { linkedSources: { search: async () => [remoteHit], resolve } });

    await vi.waitFor(() => expect(panelById('database-linked-picker')?.querySelector('[data-blok-testid="database-linked-source-remote-db"]')).not.toBeNull());
    panelById('database-linked-picker')?.querySelector<HTMLElement>('[data-blok-testid="database-linked-source-remote-db"]')?.click();

    // far()'s first view is a board: the pick copies it, as a local pick copies the first view.
    await vi.waitFor(() => expect(el.querySelector('[data-blok-database-board]')?.textContent).toContain('Far away'));
    expect(el.querySelector('[data-blok-database-tab]')?.textContent).toContain('Remote board');
    expect(resolve).toHaveBeenCalledWith({ documentId: 'doc-2', databaseId: 'remote-db' });
    const page = panelById('database-linked-picker');

    expect(page?.querySelector('[data-blok-database-panel-section]')?.textContent).toBe('tools.database.linkedViewsOn {"name":"Roadmap"}');
    expect(rowLabels(page)).toEqual(['tools.database.linkedNewTableView', 'Remote board']);
    page?.querySelector<HTMLElement>('[data-blok-testid="database-linked-view-rv"]')?.click();

    const saved = tool.save(document.createElement('div'));

    expect(saved.source).toEqual({ databaseId: 'remote-db', documentId: 'doc-2' });
    expect(saved.schema.map((p) => p.type)).toEqual(['title']);
    expect(JSON.stringify(saved)).not.toContain('Far away');
    expect(saved.views).toHaveLength(1);
    expect(saved.views[0]).toMatchObject({ type: 'board', name: 'Remote board' });
    expect(saved.views[0].id).not.toBe('rv');
    expect(el.querySelector('[data-blok-database-title] [data-blok-database-linked-title]')?.textContent?.trim()).toBe('Roadmap');
  });

  it('a host source picked and left without a view copies its first table view, as a local pick does', async () => {
    const doc = docWithSource();
    const snapshot = far();

    snapshot.views?.push({ id: 'rt', name: 'Remote table', type: 'table', position: 'a1', sorts: [{ id: 's1', propertyId: 'status', direction: 'asc' }], filters: [], visibleProperties: ['status'] });
    buildDatabase(doc, 'db', sourceData());
    const { tool } = buildDatabase(doc, 'linked', { initialView: 'table', linkPicker: true } as unknown as DatabaseData, { linkedSources: { search: async () => [remoteHit], resolve: async () => structuredClone(snapshot) } });

    await vi.waitFor(() => expect(panelById('database-linked-picker')?.querySelector('[data-blok-testid="database-linked-source-remote-db"]')).not.toBeNull());
    panelById('database-linked-picker')?.querySelector<HTMLElement>('[data-blok-testid="database-linked-source-remote-db"]')?.click();
    await vi.waitFor(() => expect(panelById('database-linked-picker')?.querySelector('[data-blok-testid="database-linked-view-rt"]')).not.toBeNull());

    const saved = tool.save(document.createElement('div'));

    expect(saved.views).toHaveLength(1);
    expect(saved.views[0]).toMatchObject({ type: 'table', name: 'Remote table', visibleProperties: ['status'], sorts: [{ propertyId: 'status', direction: 'asc' }] });
    expect(saved.views[0].id).not.toBe('rt');
    expect(saved.activeViewId).toBe(saved.views[0].id);
  });

  it('a later host answer never replaces a view the person picked', async () => {
    const doc = docWithSource();
    const listeners: Array<() => void> = [];
    const snapshot = far();

    snapshot.views?.push({ id: 'rt', name: 'Remote table', type: 'table', position: 'a1', sorts: [], filters: [], visibleProperties: ['status'] });
    buildDatabase(doc, 'db', sourceData());
    const { tool } = buildDatabase(doc, 'linked', { initialView: 'table', linkPicker: true } as unknown as DatabaseData, { linkedSources: {
      search: async () => [remoteHit],
      resolve: async () => structuredClone(snapshot),
      subscribe: (_ref: Ref, onChange: () => void) => { listeners.push(onChange); },
    } });

    await vi.waitFor(() => expect(panelById('database-linked-picker')?.querySelector('[data-blok-testid="database-linked-source-remote-db"]')).not.toBeNull());
    panelById('database-linked-picker')?.querySelector<HTMLElement>('[data-blok-testid="database-linked-source-remote-db"]')?.click();
    await vi.waitFor(() => expect(panelById('database-linked-picker')?.querySelector('[data-blok-testid="database-linked-view-rv"]')).not.toBeNull());
    panelById('database-linked-picker')?.querySelector<HTMLElement>('[data-blok-testid="database-linked-view-rv"]')?.click();
    listeners[0]();
    await flush();

    expect(tool.save(document.createElement('div')).views[0]).toMatchObject({ type: 'board', name: 'Remote board' });
  });

  it('"New table view" on a host source keeps the pick and shows its rows read-only', async () => {
    const doc = docWithSource();

    buildDatabase(doc, 'db', sourceData());
    const { tool, el } = buildDatabase(doc, 'linked', { initialView: 'table', linkPicker: true } as unknown as DatabaseData, { linkedSources: { search: async () => [remoteHit], resolve: async () => far() } });

    await vi.waitFor(() => expect(panelById('database-linked-picker')?.querySelector('[data-blok-testid="database-linked-source-remote-db"]')).not.toBeNull());
    panelById('database-linked-picker')?.querySelector<HTMLElement>('[data-blok-testid="database-linked-source-remote-db"]')?.click();
    await vi.waitFor(() => expect(panelById('database-linked-picker')?.querySelector('[data-blok-testid="database-linked-new-table-view"]')).not.toBeNull());
    panelById('database-linked-picker')?.querySelector<HTMLElement>('[data-blok-testid="database-linked-new-table-view"]')?.click();

    const saved = tool.save(document.createElement('div'));

    expect(saved.views).toHaveLength(1);
    expect(saved.views[0]).toMatchObject({ type: 'table' });
    await flush();
    expect(rowIds(el)).toEqual(['far']);
    expect(el.querySelector('[data-blok-database-table-grid]')?.getAttribute('aria-readonly')).toBe('true');
    expect(el.querySelector('[data-blok-database-add-view]')).toBeNull();
  });

  it('shows the source\'s name from the host after a reload', async () => {
    const doc = makeDoc([{ id: 'linked', name: 'database', parentId: null, data: {} }]);
    const { el } = buildDatabase(doc, 'linked', remoteLinked(), { linkedSources: { resolve: async () => far() } });

    await vi.waitFor(() => expect(el.querySelector('[data-blok-database-linked-title]')?.textContent?.trim()).toBe('Roadmap'));
  });

  it('the host answering null shows the deleted-source banner', async () => {
    const doc = makeDoc([{ id: 'linked', name: 'database', parentId: null, data: {} }]);
    const { el } = buildDatabase(doc, 'linked', remoteLinked(), { linkedSources: { resolve: async () => null } });

    await vi.waitFor(() => expect(el.querySelector('[data-blok-database-source-missing]')?.textContent).toContain('tools.database.linkedSourceMissing'));
    expect(el.querySelector('[data-blok-database-table]')).toBeNull();
  });

  it('a host that throws does not show the deleted-source banner', async () => {
    const doc = makeDoc([{ id: 'linked', name: 'database', parentId: null, data: {} }]);
    const { el } = buildDatabase(doc, 'linked', remoteLinked(), { linkedSources: { resolve: async () => { throw new Error('offline'); } } });

    await flush();

    expect(el.querySelector('[data-blok-database-source-missing]')).toBeNull();
  });

  it('subscribe: each change reads the source again; null shows the banner, data brings the rows back; destroy stops it', async () => {
    const doc = makeDoc([{ id: 'linked', name: 'database', parentId: null, data: {} }]);
    const answers: Array<Snapshot | null> = [far('First'), far('Second'), null, far('Back')];
    const resolve = vi.fn(async () => answers.shift() ?? null);
    const stop = vi.fn();
    const listeners: Array<() => void> = [];
    const subscribe = vi.fn((_ref: Ref, onChange: () => void) => {
      listeners.push(onChange);

      return stop;
    });
    const titleOf = (el: HTMLElement): string => el.querySelector('[data-blok-database-table-row]')?.textContent ?? '';
    const { tool, el } = buildDatabase(doc, 'linked', remoteLinked(), { linkedSources: { resolve, subscribe } });

    await vi.waitFor(() => expect(titleOf(el)).toContain('First'));
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe.mock.calls[0][0]).toEqual({ documentId: 'doc-2', databaseId: 'remote-db' });

    listeners[0]();
    await vi.waitFor(() => expect(titleOf(el)).toContain('Second'));

    listeners[0]();
    await vi.waitFor(() => expect(el.querySelector('[data-blok-database-source-missing]')).not.toBeNull());

    listeners[0]();
    await vi.waitFor(() => expect(titleOf(el)).toContain('Back'));
    expect(el.querySelector('[data-blok-database-source-missing]')).toBeNull();

    tool.destroy();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('an older answer never overwrites a newer one', async () => {
    const doc = makeDoc([{ id: 'linked', name: 'database', parentId: null, data: {} }]);
    const pending: Array<(value: Snapshot) => void> = [];
    const resolve = vi.fn(() => new Promise<Snapshot>((done) => pending.push(done)));
    const listeners: Array<() => void> = [];
    const { el } = buildDatabase(doc, 'linked', remoteLinked(), { linkedSources: { resolve, subscribe: (_ref: Ref, onChange: () => void) => { listeners.push(onChange); } } });

    await vi.waitFor(() => expect(pending).toHaveLength(1));
    listeners[0]();
    pending[1](far('Newer'));
    await flush();
    pending[0](far('Older'));
    await flush();

    expect(el.querySelector('[data-blok-database-table-row]')?.textContent).toContain('Newer');
  });

  it('host rows stay when another block changes', async () => {
    const doc = makeDoc([{ id: 'linked', name: 'database', parentId: null, data: {} }]);
    const { tool, el } = buildDatabase(doc, 'linked', remoteLinked(), { linkedSources: { resolve: async () => far() } });

    await vi.waitFor(() => expect(rowIds(el)).toEqual(['far']));
    (tool as unknown as { rerenderView: () => void }).rerenderView();
    doc.api.events.emit('block changed', { event: { type: 'block-changed', detail: { target: { id: 'other' } } } });
    await flush();

    expect(rowIds(el)).toEqual(['far']);
  });
});
