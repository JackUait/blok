import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseConfig, DatabaseData, DatabaseSetup, DatabaseSetupRequest } from '../../../../src/tools/database/types';
import type { BlockOrigin } from '../../../../types';
import { DatabaseTool } from '../../../../src/tools/database';
import { loadStarterBuilder } from '../../../../src/tools/database/database-starters';
import type { ToolboxConfigEntry } from '../../../../types';
import { buildDatabase, makeDoc } from './structure-harness';
import { IconMap, IconTable } from '../../../../src/components/icons';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

const popovers = vi.hoisted(() => ({ items: [] as unknown[][], destroyed: 0 }));

vi.mock('../../../../src/components/utils/popover', () => {
  class MockPopoverDesktop {
    constructor(params: { items?: unknown[] } = {}) {
      popovers.items.push(params.items ?? []);
    }

    show(): void {}

    hide(): void {}

    destroy(): void {
      popovers.destroyed += 1;
    }

    on(): void {}

    off(): void {}

    getElement(): HTMLElement {
      return document.createElement('div');
    }
  }

  return { PopoverDesktop: MockPopoverDesktop, PopoverMobile: MockPopoverDesktop, PopoverItemType: { Default: 'default', Separator: 'separator', Html: 'html' } };
});

type HtmlItem = { element?: HTMLElement };

const panel = (): HTMLElement | undefined => (popovers.items as HtmlItem[][])
  .flat()
  .map((item) => item.element)
  .filter((element): element is HTMLElement => element instanceof HTMLElement && element.getAttribute('data-blok-testid') === 'database-new-database-panel')
  .at(-1);

const box = (): HTMLTextAreaElement => {
  const found = panel()?.querySelector('textarea');

  if (!(found instanceof HTMLTextAreaElement)) throw new Error('no prompt box');

  return found;
};
const submit = (): HTMLButtonElement => {
  const found = panel()?.querySelector('[data-blok-testid="database-new-database-ai-submit"]');

  if (!(found instanceof HTMLButtonElement)) throw new Error('no submit');

  return found;
};
const type = (text: string): void => {
  box().value = text;
  box().dispatchEvent(new Event('input', { bubbles: true }));
};
const rowLabels = (): string[] =>
  [...(panel()?.querySelectorAll('[data-blok-database-panel-row]') ?? [])].map((row) => row.querySelector('[data-blok-database-panel-label]')?.textContent ?? '');

const saved = (tool: DatabaseTool): DatabaseData => tool.save(document.createElement('div'));

const fresh = { initialView: 'table' } as unknown as DatabaseData;
// A seed with one property beside the title (Place): the table seed has only Name (research/28 §3).
const mapSeed = { initialView: 'map' } as unknown as DatabaseData;

const insert = async (setupDatabase?: (request: DatabaseSetupRequest) => Promise<DatabaseSetup | null | undefined>, origin: BlockOrigin = 'user', data: DatabaseData = fresh): Promise<ReturnType<typeof buildDatabase> & { doc: ReturnType<typeof makeDoc> }> => {
  const doc = makeDoc([
    { id: 'other', name: 'database', parentId: null, data: { title: 'Tasks' } },
    { id: 'db', name: 'database', parentId: null, data: {} },
  ]);
  const config: DatabaseConfig = setupDatabase === undefined ? {} : { ai: { setupDatabase } };

  const built = buildDatabase(doc, 'db', data, config, origin);

  // The panel opens a frame after the insert.
  await new Promise((resolve) => requestAnimationFrame(resolve));

  return { doc, ...built };
};

describe('"New database" panel with the AI prompt (research/26 §2, research/20 §1a)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    popovers.items.length = 0;
    popovers.destroyed = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a database the user inserts opens it when the host gives ai.setupDatabase', async () => {
    await insert(vi.fn(async () => null));

    expect(panel()?.querySelector('[data-blok-database-panel-header]')?.textContent?.trim()).toBe('tools.database.linkedPanelTitle');
    expect(box().placeholder).toBe('tools.database.aiSetupPlaceholder');
    expect(box().getAttribute('aria-label')).toBe('tools.database.aiSetupPlaceholder');
    expect(submit().getAttribute('aria-disabled')).toBe('true');
    expect(rowLabels()).toEqual([
      'tools.database.linkedNewEmpty',
      'tools.database.csvImport',
      'tools.database.starterTasks', 'tools.database.starterProjects', 'tools.database.starterSkills',
      'tools.database.starterMoreTemplates',
      'tools.database.linkedLinkExisting',
    ]);
  });

  // research/26 §1b: the "New database" panel closes with the same round × as View settings.
  it('puts the round × at the header\'s end', async () => {
    await insert(undefined);

    const close = panel()?.querySelector('[data-blok-database-panel-header] [data-blok-testid="database-panel-close"]');

    expect(close?.getAttribute('aria-label')).toBe('tools.database.close');
    expect(close?.hasAttribute('data-blok-database-panel-close')).toBe(true);
  });

  // research/20 §1a: Notion always opens it. Its top without AI was never measured, so the rows show with no box.
  it('without the lever the same panel opens with no prompt box', async () => {
    await insert(undefined);

    expect(panel()?.querySelector('[data-blok-database-panel-header]')?.textContent?.trim()).toBe('tools.database.linkedPanelTitle');
    expect(panel()?.querySelector('textarea')).toBeNull();
    expect(panel()?.querySelector('[data-blok-database-ai-prompt]')).toBeNull();
    expect(panel()?.querySelector('[data-blok-testid="database-new-database-ai-submit"]')).toBeNull();
    expect(rowLabels()).toEqual([
      'tools.database.linkedNewEmpty',
      'tools.database.csvImport',
      'tools.database.starterTasks', 'tools.database.starterProjects', 'tools.database.starterSkills',
      'tools.database.starterMoreTemplates',
      'tools.database.linkedLinkExisting',
    ]);
  });

  it.each(['load', 'replay', 'api', 'paste'] as const)('opens nothing for a %s origin', async (origin) => {
    await insert(vi.fn(async () => null), origin);

    expect(panel()).toBeUndefined();
  });

  it.each(['load', 'replay', 'api', 'paste', 'convert', 'probe'] as const)('opens nothing for a %s origin without the lever either', async (origin) => {
    await insert(undefined, origin);

    expect(panel()).toBeUndefined();
  });

  it('opens nothing for a linked view', async () => {
    await insert(undefined, 'user', { initialView: 'table', linkPicker: true } as unknown as DatabaseData);

    expect(panel()).toBeUndefined();
  });

  it('opens nothing for a database that was already set up', async () => {
    await insert(vi.fn(async () => null), 'user', { schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }], views: [] } as unknown as DatabaseData);

    expect(panel()).toBeUndefined();
  });

  it('submit turns on with text and stays off for spaces only', async () => {
    const setup = vi.fn(async () => null);

    await insert(setup);
    type('   ');
    submit().click();

    expect(submit().getAttribute('aria-disabled')).toBe('true');
    expect(setup).not.toHaveBeenCalled();
    type('Trips');

    expect(submit().hasAttribute('aria-disabled')).toBe(false);
  });

  it('Enter sends the prompt with the database; the answer builds it and the panel closes', async () => {
    const setup = vi.fn(async (_request: DatabaseSetupRequest): Promise<DatabaseSetup> => ({
      title: 'Trips',
      schema: [
        { id: 'h', name: 'Trip', type: 'title', position: 'a0' },
        { id: 'when', name: 'When', type: 'date', position: 'a1' },
      ],
    }));
    const { tool } = await insert(setup);
    const titleId = saved(tool).schema.find((p) => p.type === 'title')?.id;

    type('Plan my trips');
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    expect(setup).toHaveBeenCalledWith(expect.objectContaining({ databaseId: 'db', prompt: 'Plan my trips' }));
    expect(setup.mock.calls[0][0].schema.map((p) => p.type)).toContain('title');
    await vi.waitFor(() => expect(saved(tool).title).toBe('Trips'));
    const data = saved(tool);

    expect(data.schema.map((p) => [p.id, p.name])).toEqual([[titleId, 'Trip'], ['when', 'When']]);
    expect(data.views[0].visibleProperties).toEqual(['when']);
    expect(data.activeViewId).toBe(data.views[0].id);
    expect(popovers.destroyed).toBe(1);
  });

  it('the adapter hears a diff: dropped properties deleted, kept ones updated, new ones created, views swapped', async () => {
    const adapter = {
      // Never answers, so the backend load cannot replace the schema mid-test.
      loadDatabase: vi.fn(() => new Promise<never>(() => undefined)),
      createRow: vi.fn(), updateRow: vi.fn(), moveRow: vi.fn(), deleteRow: vi.fn(),
      createProperty: vi.fn(async (p: { id: string }) => p), updateProperty: vi.fn(async () => ({})), deleteProperty: vi.fn(async (_p: { propertyId: string }) => undefined),
      createView: vi.fn(async (v: { id: string }) => v), updateView: vi.fn(), deleteView: vi.fn(async (_v: { viewId: string }) => undefined),
    };
    const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }]);
    const order: string[] = [];

    adapter.createView.mockImplementation(async (v: { id: string }) => {
      order.push('createView');

      return v;
    });
    adapter.deleteView.mockImplementation(async () => {
      order.push('deleteView');
    });
    const setup = vi.fn(async (request: DatabaseSetupRequest): Promise<DatabaseSetup> => {
      const status = request.schema.find((p) => p.type !== 'title');

      if (status === undefined) throw new Error('the seeded database has a second property');

      return {
        schema: [
          { ...status, name: 'Stage' },
          { id: 'when', name: 'When', type: 'date', position: 'a2' },
        ],
      };
    });
    const { tool } = buildDatabase(doc, 'db', mapSeed, { adapter: adapter as unknown as DatabaseConfig['adapter'], ai: { autofill: vi.fn(async () => undefined), setupDatabase: setup } }, 'user');

    await new Promise((resolve) => requestAnimationFrame(resolve));
    const before = saved(tool);
    const statusId = before.schema.find((p) => p.type !== 'title')?.id;
    const oldViews = before.views.map((v) => v.id);

    type('Trips');
    submit().click();
    await vi.waitFor(() => expect(saved(tool).schema.map((p) => p.name)).toContain('When'));
    await vi.waitFor(() => expect(adapter.deleteView).toHaveBeenCalledTimes(oldViews.length));

    expect(adapter.createProperty.mock.calls.map(([p]) => p.id)).toEqual(['when']);
    expect(adapter.updateProperty).toHaveBeenCalledWith(expect.objectContaining({ propertyId: statusId, changes: expect.objectContaining({ name: 'Stage' }) }));
    expect(adapter.deleteProperty).not.toHaveBeenCalled();
    expect(adapter.deleteView.mock.calls.map(([v]) => v.viewId)).toEqual(oldViews);
    expect(order.indexOf('createView')).toBeLessThan(order.indexOf('deleteView'));
  });

  it('a property the answer leaves out is deleted on the adapter', async () => {
    const adapter = {
      loadDatabase: vi.fn(() => new Promise<never>(() => undefined)),
      createRow: vi.fn(), updateRow: vi.fn(), moveRow: vi.fn(), deleteRow: vi.fn(),
      createProperty: vi.fn(async (p: { id: string }) => p), updateProperty: vi.fn(async () => ({})), deleteProperty: vi.fn(async (_p: { propertyId: string }) => undefined),
      createView: vi.fn(async (v: { id: string }) => v), updateView: vi.fn(), deleteView: vi.fn(async (_v: { viewId: string }) => undefined),
    };
    const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }]);
    const setup = vi.fn(async (): Promise<DatabaseSetup> => ({ schema: [{ id: 'when', name: 'When', type: 'date', position: 'a1' }] }));
    const { tool } = buildDatabase(doc, 'db', mapSeed, { adapter: adapter as unknown as DatabaseConfig['adapter'], ai: { autofill: vi.fn(async () => undefined), setupDatabase: setup } }, 'user');

    await new Promise((resolve) => requestAnimationFrame(resolve));
    const dropped = saved(tool).schema.filter((p) => p.type !== 'title').map((p) => p.id);

    type('Trips');
    submit().click();
    await vi.waitFor(() => expect(adapter.deleteProperty).toHaveBeenCalled());

    expect(dropped.length).toBeGreaterThan(0);
    expect(adapter.deleteProperty.mock.calls.map(([p]) => p.propertyId)).toEqual(dropped);
  });

  it('Shift+Enter does not send', async () => {
    const setup = vi.fn(async () => null);

    await insert(setup);
    type('Trips');
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));

    expect(setup).not.toHaveBeenCalled();
  });

  it('while the host works the box is busy; a null answer changes nothing and lets the user try again', async () => {
    const answer: { resolve?: (value: null) => void } = {};
    const setup = vi.fn(() => new Promise<null>((resolve) => {
      answer.resolve = resolve;
    }));
    const { tool } = await insert(setup);
    const before = JSON.stringify(saved(tool));

    type('Trips');
    submit().click();

    expect(box().disabled).toBe(true);
    expect(submit().getAttribute('aria-disabled')).toBe('true');
    submit().click();
    expect(setup).toHaveBeenCalledTimes(1);
    answer.resolve?.(null);

    await vi.waitFor(() => expect(box().disabled).toBe(false));
    expect(popovers.destroyed).toBe(0);
    expect(JSON.stringify(saved(tool))).toBe(before);
    expect(box().value).toBe('Trips');
  });

  it('a rejection shows its message and keeps the panel', async () => {
    const setup = vi.fn(async () => {
      throw new Error('quota');
    });
    const { doc } = await insert(setup);

    type('Trips');
    submit().click();

    await vi.waitFor(() => expect(doc.api.notifier.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'assistant.failed {"error":"quota"}' })));
    expect(box().disabled).toBe(false);
  });

  it('Back from "Link to existing data source" comes back to the prompt with its text', async () => {
    await insert(vi.fn(async () => null));
    type('Trips');
    panel()?.querySelector<HTMLElement>('[data-blok-testid="database-new-source-link"]')?.click();

    expect(panel()?.querySelector('textarea')).toBeNull();
    panel()?.querySelector<HTMLElement>('[data-blok-database-panel-back]')?.click();

    expect(box().value).toBe('Trips');
  });

  // research/26 §2: from a new database the link page has "Existing data sources" only.
  it('"Link to existing data source" lists other databases with no "Suggested" section', async () => {
    await insert(vi.fn(async () => null));
    panel()?.querySelector<HTMLElement>('[data-blok-testid="database-new-source-link"]')?.click();

    expect(panel()?.textContent).not.toContain('tools.database.linkedSuggested');
    expect(panel()?.querySelector('[data-blok-testid^="database-new-source-suggested-"]')).toBeNull();
    expect(panel()?.textContent).toContain('tools.database.layoutExistingDataSources');
    expect(panel()?.querySelector('[data-blok-testid="database-new-source-existing-other"]')).not.toBeNull();
  });

  it('has Import CSV and no named row', async () => {
    await insert(vi.fn(async () => null));
    type('Trips');

    expect(panel()?.querySelector('[data-blok-testid="database-new-source-csv"]')).not.toBeNull();
    expect(panel()?.querySelector('[data-blok-testid="database-new-source-named"]')).toBeNull();
    expect(rowLabels()).toEqual([
      'tools.database.linkedNewEmpty',
      'tools.database.csvImport',
      'tools.database.starterTasks', 'tools.database.starterProjects', 'tools.database.starterSkills',
      'tools.database.starterMoreTemplates',
      'tools.database.linkedLinkExisting',
    ]);
  });

  it('"Link to existing data source" turns the block into a view of that database', async () => {
    const { tool } = await insert(vi.fn(async () => null));

    panel()?.querySelector<HTMLElement>('[data-blok-testid="database-new-source-link"]')?.click();
    panel()?.querySelector<HTMLElement>('[data-blok-testid="database-new-source-existing-other"]')?.click();

    expect(saved(tool).source).toEqual({ databaseId: 'other' });
  });

  // research/27 §2: the data goes into the database the panel came from; its title stays as it was.
  it('Import CSV opens the import dialog and fills this database with the file\'s columns and rows in one step; no second database', async () => {
    const { doc, tool } = await insert(undefined);
    const titleId = saved(tool).schema.find((p) => p.type === 'title')?.id;

    panel()?.querySelector<HTMLElement>('[data-blok-testid="database-new-source-csv"]')?.click();
    expect(document.querySelector('[data-blok-testid="database-csv-import-dialog"]')).not.toBeNull();
    document.querySelector<HTMLElement>('[data-blok-testid="database-csv-choose-file"]')?.click();
    const input = document.querySelector<HTMLInputElement>('[data-blok-database-csv-input]');

    if (input === null) throw new Error('no file input');
    Object.defineProperty(input, 'files', { value: [new File(['Name,Size\nAlpha,3\nBeta,5'], 'stock.csv', { type: 'text/csv' })] });
    doc.transact.mockClear();
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(document.querySelector('[data-blok-testid="database-csv-map"]')?.getAttribute('aria-disabled')).not.toBe('true'));
    document.querySelector<HTMLElement>('[data-blok-testid="database-csv-map"]')?.click();
    document.querySelector<HTMLElement>('[data-blok-testid="database-csv-import"]')?.click();
    await vi.waitFor(() => expect(saved(tool).schema.map((p) => p.name)).toEqual(['Name', 'Size']));
    expect(saved(tool).schema.map((p) => p.type)).toEqual(['title', 'number']);

    const data = saved(tool);
    const rows = doc.childrenOf('db').filter((id) => doc.blocks.get(id)?.name === 'database-row');

    expect(data.schema[0].id).toBe(titleId);
    expect(data.title ?? '').toBe('');
    expect(rows.map((id) => doc.row(id).properties[data.schema[0].id])).toEqual(['Alpha', 'Beta']);
    expect([...doc.blocks.values()].filter((b) => b.name === 'database').map((b) => b.block.id).sort()).toEqual(['db', 'other']);
    expect(doc.transact).toHaveBeenCalledTimes(1);
  });
});

// research/20 §1a (`/map`), research/26 §2 (`/table view`): Notion opens the panel for every database a slash entry makes.
describe('"New database" panel for every database toolbox entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    popovers.items.length = 0;
    popovers.destroyed = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const entries = (): ToolboxConfigEntry[] => {
    const toolbox = DatabaseTool.toolbox;

    return Array.isArray(toolbox) ? toolbox : [toolbox];
  };
  const entry = (name: string): ToolboxConfigEntry => {
    const found = entries().find((item) => item.name === name);

    if (found === undefined) throw new Error(`no ${name} entry`);

    return found;
  };
  // The toolbox inserts an entry with no data as an empty block.
  const dataOf = (name: string): DatabaseData => ({ ...(entry(name).data ?? {}) }) as unknown as DatabaseData;
  const activeType = (tool: DatabaseTool): string | undefined => {
    const data = saved(tool);

    return data.views.find((view) => view.id === data.activeViewId)?.type;
  };

  it('the entries are Notion\'s Database section, in order (research/28 §1a)', () => {
    expect(entries().map((item) => item.name)).toEqual([
      'tableView', 'board', 'galleryView', 'listView', 'feedView', 'calendarView', 'timelineView', 'mapView', 'databaseForm', 'database', 'linkedDatabase',
    ]);
  });

  // research/26 §2 dump "Table view · Database", research/20 §1a "Map view · Database".
  it('Table view and Map view are named as Notion names them, with the view-type icons', () => {
    expect(entry('tableView')).toMatchObject({ titleKey: 'tableView', icon: IconTable, section: 'database', data: { initialView: 'table' } });
    expect(entry('mapView')).toMatchObject({ titleKey: 'mapView', icon: IconMap, section: 'database', data: { initialView: 'map' } });
  });

  // research/28 §3: every entry but Form and Linked view opens the panel.
  it.each([
    ['database', 'table'], ['board', 'board'], ['tableView', 'table'], ['mapView', 'map'],
    ['galleryView', 'gallery'], ['listView', 'list'], ['feedView', 'feed'], ['calendarView', 'calendar'], ['timelineView', 'timeline'],
  ] as const)('a user insert of the %s entry opens the panel, and New empty keeps its %s layout', async (name, layout) => {
    const { tool } = await insert(undefined, 'user', dataOf(name));

    expect(panel()?.querySelector('[data-blok-database-panel-header]')?.textContent?.trim()).toBe('tools.database.linkedPanelTitle');
    expect(rowLabels()[0]).toBe('tools.database.linkedNewEmpty');
    panel()?.querySelector<HTMLElement>('[data-blok-database-panel-row]')?.click();
    expect(activeType(tool)).toBe(layout);
  });

  // research/35 §2.1, research/30 B7a, research/28:123: only "/table view" on a page with no other block skips the panel.
  describe('a Table view alone on the page', () => {
    const insertWith = async (name: string, others: Array<{ id: string; name: string; parentId: string | null }>, above = false): Promise<void> => {
      const database = { id: 'db', name: 'database', parentId: null, data: {} };
      const rest = others.map((other) => ({ ...other, data: {} }));
      const doc = makeDoc(above ? [...rest, database] : [database, ...rest]);

      buildDatabase(doc, 'db', dataOf(name), {}, 'user');
      await new Promise((resolve) => requestAnimationFrame(resolve));
    };

    it('opens no panel when the document holds nothing else', async () => {
      await insertWith('tableView', []);

      expect(panel()).toBeUndefined();
    });

    it('opens no panel when the only other blocks are its own rows', async () => {
      await insertWith('tableView', [{ id: 'r1', name: 'database-row', parentId: 'db' }]);

      expect(panel()).toBeUndefined();
    });

    it.each([
      ['another database', { id: 'other', name: 'database', parentId: null }],
      ['a paragraph', { id: 'p1', name: 'paragraph', parentId: null }],
    ])('opens the panel when the document also holds %s', async (_label, other) => {
      await insertWith('tableView', [other]);

      expect(rowLabels()[0]).toBe('tools.database.linkedNewEmpty');
    });

    // research/35 §2.1 S1 (a line above) and S2 (first block, a line below): both open the panel.
    it.each([['above', true], ['below', false]] as const)('opens the panel with a paragraph %s it', async (_label, above) => {
      await insertWith('tableView', [{ id: 'p1', name: 'paragraph', parentId: null }], above);

      expect(rowLabels()[0]).toBe('tools.database.linkedNewEmpty');
    });

    // research/35 §2.1 S3: "Database - Inline" on an empty page opens the panel.
    it.each(['database', 'board', 'mapView'])('the %s entry still opens the panel alone on the page', async (name) => {
      await insertWith(name, []);

      expect(rowLabels()[0]).toBe('tools.database.linkedNewEmpty');
    });

    it('a load or a peer of the same seed opens nothing either way', async () => {
      const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }, { id: 'p1', name: 'paragraph', parentId: null, data: {} }]);

      buildDatabase(doc, 'db', dataOf('tableView'), {}, 'replay');
      await new Promise((resolve) => requestAnimationFrame(resolve));

      expect(panel()).toBeUndefined();
    });

    // research/30 B7b: Notion names the one view "Table" and shows no tab for it.
    it('names its one view "Table" and draws no tab bar for it', async () => {
      const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }]);
      const { tool, el } = buildDatabase(doc, 'db', dataOf('tableView'), {}, 'user');

      expect(saved(tool).views.map((view) => [view.type, view.name])).toEqual([['table', 'Table']]);
      expect(el.querySelector<HTMLElement>(':scope > [data-blok-database-view-bar] > [data-blok-database-tab-bar]')?.style.display).toBe('none');
    });

    // research/35 §2.5: Lock database on a one-view database still draws no tab; so does read-only.
    it.each([
      ['locked', false, true],
      ['read-only', true, false],
    ] as const)('a %s one-view database draws no tab bar either', (_label, readOnly, locked) => {
      const seedDoc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }]);
      const seed = saved(buildDatabase(seedDoc, 'db', dataOf('tableView'), {}, 'user').tool);
      const data: DatabaseData = { ...seed, schema: seed.schema.map((p) => (p.type === 'title' ? { ...p, databaseLocked: locked } : p)) };

      document.body.innerHTML = '';
      const doc = makeDoc([{ id: 'db2', name: 'database', parentId: null, data: {} }]);
      const tool = new DatabaseTool({ data, config: {}, api: doc.api, readOnly, block: { id: 'db2', name: 'database', dispatchChange: vi.fn() } as never });

      doc.tools.set('db2', tool);
      const el = tool.render();

      document.body.appendChild(el);
      tool.rendered();

      expect(el.querySelector<HTMLElement>(':scope > [data-blok-database-view-bar] > [data-blok-database-tab-bar]')?.style.display).toBe('none');
    });

    it('saves no trace of the seed marker', async () => {
      const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }]);
      const { tool } = buildDatabase(doc, 'db', dataOf('tableView'), {}, 'user');

      expect(Object.keys(saved(tool)).filter((key) => !['title', 'schema', 'views', 'activeViewId', 'automations'].includes(key))).toEqual([]);
    });
  });

  // research/28 §3: Form opens no panel; its title is real text "New form"; it opens on its Form builder.
  it('a user insert of the Form entry opens no panel, titles it "New form" and shows the Form builder', async () => {
    const { tool } = await insert(undefined, 'user', dataOf('databaseForm'));
    const data = saved(tool);

    expect(panel()).toBeUndefined();
    expect(data.title).toBe('tools.database.seedNewForm');
    expect(data.views.map((view) => [view.type, view.name])).toEqual([['form', 'Form builder'], ['table', 'Responses']]);
    expect(activeType(tool)).toBe('form');
  });

  it('a Form seed from a peer or a replay writes no title', async () => {
    const { tool } = await insert(undefined, 'replay', dataOf('databaseForm'));

    expect(saved(tool).title ?? '').toBe('');
  });

  // research/28 §3: Timeline gets "Card 1-3", Oct 15–19, 17–21 and 19–23 with today Oct 20.
  it('a user insert of the Timeline entry adds three sample cards spanning days around today', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 20, 12));
    try {
      const { doc } = await insert(undefined, 'user', dataOf('timelineView'));
      const rows = doc.childrenOf('db').map((id) => doc.row(id));

      expect(rows.map((row) => Object.values(row.properties).filter((v) => typeof v === 'string'))).toEqual([
        [`tools.database.seedCard {"number":1}`, '2026-10-15/2026-10-19'],
        [`tools.database.seedCard {"number":2}`, '2026-10-17/2026-10-21'],
        [`tools.database.seedCard {"number":3}`, '2026-10-19/2026-10-23'],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  // The cards belong to the empty timeline: a template that replaces it must not keep them.
  it('a Timeline insert that then picks a Suggested template keeps none of the sample cards', async () => {
    const { doc } = await insert(undefined, 'user', dataOf('timelineView'));
    const cards = doc.childrenOf('db');

    expect(cards).toHaveLength(3);
    panel()?.querySelector<HTMLElement>('[data-blok-testid="database-new-database-starter-skills"]')?.click();
    await loadStarterBuilder();

    expect(doc.childrenOf('db').filter((id) => cards.includes(id))).toEqual([]);
  });

  it('a Timeline seed from a peer or a replay adds no rows', async () => {
    const { doc } = await insert(undefined, 'replay', dataOf('timelineView'));

    expect(doc.childrenOf('db')).toEqual([]);
  });

  it('a user insert of the Linked view entry opens the source picker, not the panel', async () => {
    await insert(undefined, 'user', dataOf('linkedDatabase'));

    expect(panel()).toBeUndefined();
  });

  it.each(['load', 'replay', 'api', 'paste', 'convert', 'probe'] as const)('the Board entry opens nothing for a %s origin', async (origin) => {
    const { tool } = await insert(undefined, origin, dataOf('board'));

    expect(panel()).toBeUndefined();
    expect(activeType(tool)).toBe('board');
  });

  // Every client that renders the seed saves it once; the ids must match so the saves merge.
  it('two clients that render the same Board seed save the same ids', async () => {
    const ids = async (): Promise<string[]> => {
      const { tool } = await insert(undefined, 'replay', dataOf('board'));
      const data = saved(tool);

      return [...data.schema.map((p) => p.id), ...data.views.map((v) => v.id)];
    };

    expect(await ids()).toEqual(await ids());
  });

  // research/20 §1a: "/map" makes a database whose first view is "Map view" and adds a "Place" property.
  it('the Map view entry starts a "Map view" map with a Place property', async () => {
    const { tool } = await insert(undefined, 'user', dataOf('mapView'));

    panel()?.querySelector<HTMLElement>('[data-blok-database-panel-row]')?.click();
    const data = saved(tool);

    expect(data.views.map((view) => [view.type, view.name])).toEqual([['map', 'Map view']]);
    expect(data.schema.filter((p) => p.type === 'place').map((p) => p.name)).toEqual(['Place']);
  });

  it('two clients that render the same Map view seed save the same ids, the Place id too', async () => {
    const ids = async (): Promise<string[]> => {
      const { tool } = await insert(undefined, 'replay', dataOf('mapView'));
      const data = saved(tool);

      return [...data.schema.map((p) => p.id), ...data.views.map((v) => v.id)];
    };
    const first = await ids();

    expect(first).toEqual(await ids());
    expect(first).toContain('db-place');
  });
});
