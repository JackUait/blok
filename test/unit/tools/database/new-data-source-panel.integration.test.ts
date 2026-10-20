import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { PopoverRegistry } from '../../../../src/components/utils/popover/popover-registry';
import type { API, OutputBlockData, OutputData } from '../../../../types';
import type { DatabaseConfig, DatabaseData, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

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

const otherSchema: PropertyDefinition[] = [
  { id: 'ot', name: 'Name', type: 'title', position: 'a0' },
  { id: 'qty', name: 'Qty', type: 'number', position: 'a1' },
];

/** "db" and, below it on the page, a second database "other". */
const pageDoc = (): OutputBlockData[] => [
  {
    id: 'db', type: 'database', content: ['r1'],
    data: { title: 'Projects', schema: parentSchema, views: [table('v1', 'a0'), table('v2', 'a1')], activeViewId: 'v1' },
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Parent row', notes: 'n' }, position: 'a0' } },
  {
    id: 'other', type: 'database', content: ['o1'],
    data: { title: 'Stock', schema: otherSchema, views: [table('ov', 'a0')], activeViewId: 'ov' },
  },
  { id: 'o1', type: 'database-row', parent: 'other', data: { properties: { ot: 'Other row', qty: 7 }, position: 'a0' } },
];

/** pageDoc, with a second source "src-b" inside "db", so Source is active (research/23 §10). */
const twoSourceDoc = (): OutputBlockData[] => {
  const [db, ...rest] = pageDoc();

  return [
    { ...db, content: ['r1', 'src-b'], data: { ...db.data, views: [...(db.data as DatabaseData).views, table('vb', 'a2', { dataSourceId: 'src-b' })] } },
    ...rest,
    {
      id: 'src-b', type: 'database', parent: 'db',
      data: { title: 'Src B', schema: [{ id: 'bt', name: 'Name', type: 'title', position: 'a0' }], views: [table('bv', 'a0')], activeViewId: 'bv' },
    },
  ];
};

const make = async (blocks: OutputBlockData[], database: typeof DatabaseTool = DatabaseTool): Promise<TestEditor> => {
  if (holder === undefined) throw new Error('missing editor holder');
  let ready: TestEditor | undefined;

  editor = new Blok({
    holder, dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      database: { class: database },
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

const own = (selector: string): HTMLElement => {
  const root = parentRoot();
  const found = [...root.querySelectorAll<HTMLElement>(selector)].find((el) => el.closest('[data-blok-element]') === root);

  if (found === undefined) throw new Error('missing ' + selector);

  return found;
};

const shownArea = (): HTMLElement => own('[data-blok-database-board-container]');

const byTestId = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-testid="${id}"]`);

const panel = (): HTMLElement | null => byTestId('database-new-source-panel');

const sources = (api: TestEditor): string[] => api.blocks.getChildren('db').filter((b) => b.name === 'database').map((b) => b.id);

const dataOf = async (api: TestEditor, id: string): Promise<DatabaseData | undefined> =>
  (await api.save()).blocks.find((b) => b.id === id)?.data as DatabaseData | undefined;

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

const pickCsv = async (text: string, name: string): Promise<void> => {
  const input = document.querySelector<HTMLInputElement>('[data-blok-database-csv-input]');

  if (input === null) throw new Error('no file input');
  Object.defineProperty(input, 'files', { value: [new File([text], name, { type: 'text/csv' })] });
  input.dispatchEvent(new Event('change'));
  await quiet();
};

const rowLabels = (): string[] => [...(panel()?.querySelectorAll<HTMLElement>('[data-blok-testid]') ?? [])]
  .map((el) => el.getAttribute('data-blok-testid') ?? '');

describe('"New data source" side panel (research/23 §10, research/20 §1a)', () => {
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

  it('opens on the new tab after the source is made, with the measured rows in order', async () => {
    const api = await make(pageDoc());

    await newDataSourceFromAddView();

    expect(sources(api)).toHaveLength(1);
    expect(panel()).not.toBeNull();
    expect(panel()?.textContent).toContain('New data source');
    expect(byTestId('database-new-source-search')?.getAttribute('placeholder')).toBe('Search…');
    expect(rowLabels().filter((id) => id.startsWith('database-new-source-') && id !== 'database-new-source-panel' && id !== 'database-new-source-search'))
      .toEqual(['database-new-source-empty', 'database-new-source-csv', 'database-new-source-link']);
    // Blok has no database templates and no database-setup AI lever: no "Suggested", no prompt field.
    expect(panel()?.textContent).not.toContain('Suggested');
    expect(panel()?.querySelectorAll('input')).toHaveLength(1);
  });

  it('"New empty data source" closes the panel and keeps the empty source', async () => {
    const api = await make(pageDoc());

    await newDataSourceFromAddView();
    byTestId('database-new-source-empty')?.click();
    await quiet();

    expect(panel()).toBeNull();
    expect(sources(api)).toHaveLength(1);
    expect((await dataOf(api, 'db'))?.views.some((v) => v.dataSourceId === sources(api)[0])).toBe(true);
  });

  const typeSearch = async (value: string): Promise<void> => {
    const search = byTestId('database-new-source-search');

    if (!(search instanceof HTMLInputElement)) throw new Error('no search');
    search.value = value;
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await quiet();
  };

  const panelRows = (): string[] => rowLabels().filter((id) => id.startsWith('database-new-source-') && id !== 'database-new-source-panel' && id !== 'database-new-source-search');

  // research/26 §2: "csv" and "csvzzqx" both gave exactly these two rows.
  it('typing turns the first row into New “<query>” data source, with Import CSV below', async () => {
    await make(pageDoc());
    await newDataSourceFromAddView();
    await typeSearch('csvzzqx');

    expect(panelRows()).toEqual(['database-new-source-named', 'database-new-source-csv']);
    expect(byTestId('database-new-source-named')?.textContent?.trim()).toBe('New “csvzzqx” data source');

    await typeSearch('');

    expect(panelRows()).toEqual(['database-new-source-empty', 'database-new-source-csv', 'database-new-source-link']);
  });

  it('the typed query still finds "Link to existing data source" by name', async () => {
    await make(pageDoc());
    await newDataSourceFromAddView();
    await typeSearch('link');

    expect(panelRows()).toEqual(['database-new-source-named', 'database-new-source-csv', 'database-new-source-link']);
  });

  it('New “<query>” data source names the new source after the query and closes the panel', async () => {
    const api = await make(pageDoc());

    await newDataSourceFromAddView();
    await typeSearch('  Stock  ');
    byTestId('database-new-source-named')?.click();
    await quiet();

    expect(panel()).toBeNull();
    expect(sources(api)).toHaveLength(1);
    expect((await dataOf(api, sources(api)[0]))?.title).toBe('Stock');
    expect((await dataOf(api, 'db'))?.title).toBe('Projects');
  });

  // research/26 §2: closing with × keeps the new tab and its empty source. Blok's panel closes with Escape.
  it('closing the panel with Escape keeps the new view and its empty source', async () => {
    const api = await make(pageDoc());

    await newDataSourceFromAddView();
    byTestId('database-new-source-search')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await quiet();

    expect(panel()).toBeNull();
    expect(sources(api)).toHaveLength(1);
    expect((await dataOf(api, 'db'))?.views.some((v) => v.dataSourceId === sources(api)[0])).toBe(true);
  });

  it('"Import CSV" fills the new source with the file\'s columns and rows; the view stays on it', async () => {
    const api = await make(pageDoc());

    await newDataSourceFromAddView();
    const [sourceId] = sources(api);

    byTestId('database-new-source-csv')?.click();
    await quiet();
    await pickCsv('Name,Size\nAlpha,3\nBeta,5', 'stock.csv');

    expect(sources(api)).toEqual([sourceId]);
    const source = await dataOf(api, sourceId);

    expect(source?.schema.map((p) => p.name)).toEqual(['Name', 'Size']);
    expect(source?.title).toBe('stock');
    expect(api.blocks.getChildren(sourceId).filter((b) => b.name === 'database-row')).toHaveLength(2);
    expect(shownArea().textContent).toContain('Alpha');
    expect(shownArea().textContent).toContain('Beta');
    expect(shownArea().textContent).not.toContain('Parent row');
    // The holder's own data is untouched.
    expect((await dataOf(api, 'db'))?.schema).toEqual(parentSchema);
  });

  it('"Import CSV" sends the new columns and rows to the source\'s backend, as "New" on that source does', async () => {
    const adapter = {
      // Never answers: a load would replace the source's schema mid-test.
      loadDatabase: vi.fn(() => new Promise<never>(() => undefined)),
      createRow: vi.fn(async (params: { id: string }) => ({ ...params })),
      updateRow: vi.fn(async () => undefined),
      moveRow: vi.fn(async () => undefined),
      deleteRow: vi.fn(async () => undefined),
      createProperty: vi.fn(async (params: { id: string }) => ({ ...params })),
      updateProperty: vi.fn(async () => undefined),
      deleteProperty: vi.fn(async () => undefined),
      createView: vi.fn(async (params: { id: string }) => ({ ...params })),
      updateView: vi.fn(async () => undefined),
      deleteView: vi.fn(async () => undefined),
    };

    /** The backend belongs to the new source only. */
    class SourceBackedDatabase extends DatabaseTool {
      constructor(options: ConstructorParameters<typeof DatabaseTool>[0]) {
        const own = options.block.id === 'db' || options.block.id === 'other';

        super(own ? options : { ...options, config: { ...options.config, adapter: adapter as unknown as NonNullable<DatabaseConfig['adapter']> } });
      }
    }
    const api = await make(pageDoc(), SourceBackedDatabase);

    await newDataSourceFromAddView();
    const [sourceId] = sources(api);

    byTestId('database-new-source-csv')?.click();
    await quiet();
    await pickCsv('Name,Size\nAlpha,3\nBeta,5', 'stock.csv');
    const rowIds = api.blocks.getChildren(sourceId).filter((b) => b.name === 'database-row').map((b) => b.id);
    const size = (await dataOf(api, sourceId))?.schema.find((p) => p.name === 'Size');

    expect(adapter.createRow.mock.calls.map(([params]) => params.id)).toEqual(rowIds);
    expect(adapter.createProperty.mock.calls.map(([params]) => params.id)).toEqual([size?.id]);
    expect(adapter.deleteProperty).not.toHaveBeenCalled();
  });

  it('undo after "Import CSV" empties the source again; a second undo removes the source and its view', async () => {
    const api = await make(pageDoc());

    stopCapturing();
    await newDataSourceFromAddView();
    stopCapturing();
    const [sourceId] = sources(api);

    byTestId('database-new-source-csv')?.click();
    await quiet();
    await pickCsv('Name,Size\nAlpha,3', 'stock.csv');
    stopCapturing();

    api.history.undo();
    await quiet();
    expect(sources(api)).toEqual([sourceId]);
    expect(api.blocks.getChildren(sourceId).filter((b) => b.name === 'database-row')).toHaveLength(0);
    expect((await dataOf(api, sourceId))?.schema.map((p) => p.type)).toEqual(['title']);

    api.history.undo();
    await quiet();
    expect(sources(api)).toHaveLength(0);
    expect((await dataOf(api, 'db'))?.views.some((v) => v.dataSourceId !== undefined)).toBe(false);
  });

  it('"Link to existing data source" lists the page\'s other databases, not this one or its own source', async () => {
    const api = await make(pageDoc());

    await newDataSourceFromAddView();
    byTestId('database-new-source-link')?.click();
    await quiet();

    expect(panel()?.textContent).toContain('Link to existing data source');
    expect(panel()?.textContent).toContain('Existing data sources');
    expect(byTestId('database-new-source-existing-other')?.textContent).toContain('Stock');
    expect(byTestId('database-new-source-existing-db')).toBeNull();
    expect(byTestId(`database-new-source-existing-${sources(api)[0]}`)).toBeNull();
  });

  // research/26 §2: "Suggested" holds this database's sources, then "Existing data sources".
  it('"Link to existing data source" lists this database\'s other sources under "Suggested", above the existing ones', async () => {
    const api = await make(twoSourceDoc());

    await newDataSourceFromAddView();
    const fresh = sources(api).find((id) => id !== 'src-b') ?? '';

    byTestId('database-new-source-link')?.click();
    await quiet();
    const text = panel()?.textContent ?? '';

    expect(text.indexOf('Suggested')).toBeGreaterThan(-1);
    expect(text.indexOf('Suggested')).toBeLessThan(text.indexOf('Existing data sources'));
    expect(byTestId('database-new-source-suggested-db')?.textContent).toContain('Projects');
    expect(byTestId('database-new-source-suggested-src-b')?.textContent).toContain('Src B');
    // The new view's own source is never offered: linking to it would delete it.
    expect(byTestId(`database-new-source-suggested-${fresh}`)).toBeNull();
    expect(byTestId('database-new-source-existing-src-b')).toBeNull();
  });

  it('picking a suggested source puts the new view on it and drops the empty source', async () => {
    const api = await make(twoSourceDoc());

    await newDataSourceFromAddView();
    byTestId('database-new-source-link')?.click();
    await quiet();
    byTestId('database-new-source-suggested-src-b')?.click();
    await quiet();

    expect(panel()).toBeNull();
    expect(sources(api)).toEqual(['src-b']);
    const parent = await dataOf(api, 'db');

    expect(parent?.views.find((v) => v.id === parent.activeViewId)?.dataSourceId).toBe('src-b');
  });

  it('picking the database\'s own data as a suggested source puts the new view back on it', async () => {
    const api = await make(pageDoc());

    await newDataSourceFromAddView();
    byTestId('database-new-source-link')?.click();
    await quiet();
    byTestId('database-new-source-suggested-db')?.click();
    await quiet();

    expect(sources(api)).toHaveLength(0);
    const parent = await dataOf(api, 'db');
    const active = parent?.views.find((v) => v.id === parent.activeViewId);

    expect(active).toBeDefined();
    expect(JSON.stringify(active)).not.toContain('dataSourceId');
    expect(shownArea().textContent).toContain('Parent row');
  });

  // Notion's Back went to the AI-box variant; Blok has no AI setup lever and keeps the search.
  it('Back from "Link to existing data source" returns to the panel with its search', async () => {
    await make(pageDoc());
    await newDataSourceFromAddView();
    byTestId('database-new-source-link')?.click();
    await quiet();
    byTestId('database-panel-back')?.click();
    await quiet();

    expect(byTestId('database-new-source-search')).not.toBeNull();
    expect(byTestId('database-new-source-empty')).not.toBeNull();
  });

  it('picking an existing database puts the new view on it and drops the empty source', async () => {
    const api = await make(pageDoc());

    await newDataSourceFromAddView();
    byTestId('database-new-source-link')?.click();
    await quiet();
    byTestId('database-new-source-existing-other')?.click();
    await quiet();

    expect(panel()).toBeNull();
    expect(sources(api)).toHaveLength(0);
    const parent = await dataOf(api, 'db');

    expect(parent?.views.find((v) => v.id === parent.activeViewId)?.dataSourceId).toBe('other');
    expect(shownArea().textContent).toContain('Other row');
    expect(shownArea().textContent).not.toContain('Parent row');
    // The other database stays where it was, with its own data.
    expect((await dataOf(api, 'other'))?.schema).toEqual(otherSchema);
    expect(api.blocks.getById('other')?.parentId ?? null).toBeNull();
  });

  it('undo after linking an existing database brings the empty source back under the view, in one step', async () => {
    const api = await make(pageDoc());

    stopCapturing();
    await newDataSourceFromAddView();
    stopCapturing();
    const [sourceId] = sources(api);

    byTestId('database-new-source-link')?.click();
    await quiet();
    byTestId('database-new-source-existing-other')?.click();
    await quiet();
    stopCapturing();
    api.history.undo();
    await quiet();

    expect(sources(api)).toEqual([sourceId]);
    const parent = await dataOf(api, 'db');

    expect(parent?.views.find((v) => v.id === parent.activeViewId)?.dataSourceId).toBe(sourceId);
    expect(shownArea().textContent).not.toContain('Other row');
    expect(api.blocks.getById('other')?.id).toBe('other');
  });

  const linkOther = async (): Promise<void> => {
    await newDataSourceFromAddView();
    byTestId('database-new-source-link')?.click();
    await quiet();
    byTestId('database-new-source-existing-other')?.click();
    await quiet();
  };

  const otherRoot = (): HTMLElement => {
    const found = holder?.querySelector<HTMLElement>('[data-blok-element][data-blok-id="other"]');

    if (found === null || found === undefined) throw new Error('missing other database');

    return found;
  };

  it('the other database still draws its own rows on the page after a view here shows it', async () => {
    await make(pageDoc());
    await linkOther();
    const area = [...otherRoot().querySelectorAll<HTMLElement>('[data-blok-database-board-container]')]
      .find((el) => el.closest('[data-blok-element]') === otherRoot());

    expect(otherRoot().hidden).toBe(false);
    expect(otherRoot().closest('[hidden]')).toBeNull();
    expect(area?.textContent).toContain('Other row');
  });

  it('opening the other database\'s row from the view here keeps the row under that database', async () => {
    const api = await make(pageDoc());

    await linkOther();
    const open = shownArea().querySelector<HTMLElement>('[data-row-id="o1"] [data-blok-database-table-open]');

    expect(open).not.toBeNull();
    open?.click();
    await quiet();
    expect(document.querySelector('[data-blok-database-drawer]')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await quiet();

    expect(api.blocks.getById('o1')?.parentId).toBe('other');
    expect((await api.save()).blocks.find((b) => b.id === 'o1')?.parent).toBe('other');
  });

  it('a duplicate of this database keeps its view on the other database', async () => {
    const api = await make(pageDoc());

    await linkOther();
    const internal = editor as unknown as {
      module: {
        blockManager: { blocks: Array<{ id: string }> };
        dragManager: { duplicateBlocksInPlace: (block: unknown) => Promise<unknown[]> };
      };
    };
    const block = internal.module.blockManager.blocks.find((b) => b.id === 'db');

    if (block === undefined) throw new Error('no db block');
    await internal.module.dragManager.duplicateBlocksInPlace(block);
    await quiet();
    const saved = (await api.save()).blocks;
    const copy = saved.find((b) => b.type === 'database' && b.id !== 'db' && b.id !== 'other' && b.parent === undefined);

    expect(copy).toBeDefined();
    expect((copy?.data as DatabaseData).views.some((v) => v.dataSourceId === 'other')).toBe(true);
    expect(saved.filter((b) => b.type === 'database' && (b.data as DatabaseData).title === 'Stock')).toHaveLength(1);
  });

  it('a view on another database shows its title read-only: typing there cannot rename it', async () => {
    const api = await make(pageDoc());

    await newDataSourceFromAddView();
    byTestId('database-new-source-link')?.click();
    await quiet();
    byTestId('database-new-source-existing-other')?.click();
    await quiet();
    const title = own('[data-blok-database-source-title]');

    expect(title.textContent).toBe('Stock');
    expect(title.getAttribute('contenteditable')).toBeNull();
    title.textContent = 'Renamed';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await quiet();

    expect((await dataOf(api, 'other'))?.title).toBe('Stock');
  });

  it('undo and redo of "New data source" never open the panel', async () => {
    const api = await make(pageDoc());

    stopCapturing();
    await newDataSourceFromAddView();
    stopCapturing();
    byTestId('database-new-source-empty')?.click();
    await quiet();
    api.history.undo();
    await quiet();
    api.history.redo();
    await quiet();

    expect(sources(api)).toHaveLength(1);
    expect(panel()).toBeNull();
  });
});

describe('View settings "Source": existing data sources and the "Data source settings" label (research/23 §10)', () => {
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

  const openSettings = async (): Promise<void> => {
    own('[data-blok-testid="database-toolbar-settings"]').click();
    await quiet();
  };

  it('labels the Source group "Data source settings", right before Source', async () => {
    await make(pageDoc());
    await openSettings();
    const source = byTestId('database-settings-source');

    expect(source?.previousElementSibling?.textContent).toBe('Data source settings');
  });

  it('the Source picker lists the page\'s other databases under "Existing data sources"; picking one shows its rows', async () => {
    const api = await make(twoSourceDoc());

    await openSettings();
    byTestId('database-settings-source')?.click();
    await quiet();
    const option = byTestId('database-source-option-other');

    expect(option?.textContent).toContain('Stock');
    expect(option?.closest('[data-blok-database-panel]')?.textContent).toContain('Existing data sources');
    option?.click();
    await quiet();

    expect((await dataOf(api, 'db'))?.views.find((v) => v.id === 'v1')?.dataSourceId).toBe('other');
    expect(shownArea().textContent).toContain('Other row');
  });
});
