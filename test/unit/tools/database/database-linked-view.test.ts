import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseData, PropertyDefinition } from '../../../../src/tools/database/types';
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

  it('locks the source database, never only itself', () => {
    const doc = docWithSource();
    const source = buildDatabase(doc, 'db', sourceData());
    const { tool } = buildDatabase(doc, 'linked', linkedData());

    (tool as unknown as { setDatabaseLocked: (l: boolean) => void }).setDatabaseLocked(true);

    expect(source.tool.save(document.createElement('div')).schema.find((p) => p.type === 'title')?.databaseLocked).toBe(true);
    expect(tool.save(document.createElement('div')).schema).toEqual(stub);
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
    const pick = el.querySelector<HTMLButtonElement>('[data-blok-database-source-picker] [data-database-id="db"]');

    expect(pick).not.toBeNull();
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
