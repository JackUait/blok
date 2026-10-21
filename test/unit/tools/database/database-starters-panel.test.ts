import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseConfig, DatabaseData, DatabaseRowData } from '../../../../src/tools/database/types';
import type { DatabaseTool } from '../../../../src/tools/database';
import { buildDatabase, makeDoc } from './structure-harness';
import type { Doc } from './structure-harness';

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

const byTestId = (root: ParentNode | undefined, id: string): HTMLElement => {
  const found = root?.querySelector(`[data-blok-testid="${id}"]`);

  if (!(found instanceof HTMLElement)) throw new Error(`no ${id}`);

  return found;
};
const modal = (): HTMLElement | null => document.querySelector('[data-blok-testid="database-starter-modal"]');
const rowLabels = (): string[] =>
  [...(panel()?.querySelectorAll('[data-blok-database-panel-row]') ?? [])].map((row) => row.querySelector('[data-blok-database-panel-label]')?.textContent ?? '');

const saved = (tool: DatabaseTool): DatabaseData => tool.save(document.createElement('div'));
const installed = new Set(['header', 'paragraph', 'list']);

const insert = async (others: Array<Partial<DatabaseData>> = [], config: DatabaseConfig = {}): Promise<{ doc: Doc; tool: DatabaseTool }> => {
  const doc = makeDoc([
    ...others.map((data, index) => ({ id: `other-${index}`, name: 'database', parentId: null, data })),
    { id: 'db', name: 'database', parentId: null, data: {} },
  ]);

  Object.assign(doc.api.tools, { isInstalled: (name: string) => installed.has(name) });
  const { tool } = buildDatabase(doc, 'db', { initialView: 'table' } as unknown as DatabaseData, config, 'user');

  await new Promise((resolve) => requestAnimationFrame(resolve));

  return { doc, tool };
};
// Done resolves the Customize promise; the database is built a microtask later.
const applyTasks = async (): Promise<void> => {
  byTestId(panel(), 'database-new-database-starter-tasks').click();
  byTestId(modal() ?? undefined, 'database-starter-next').click();
  byTestId(modal() ?? undefined, 'database-starter-done').click();
  await settle();
};
const settingsRow = (id: string): HTMLElement | null => document.querySelector(`[data-blok-testid="${id}"]`)
  ?? (popovers.items as HtmlItem[][]).flat().map((item) => item.element?.querySelector<HTMLElement>(`[data-blok-testid="${id}"]`) ?? null).find((el) => el !== null) ?? null;
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const rows = (doc: Doc, parent = 'db'): string[] => doc.childrenOf(parent)
  .filter((id) => doc.blocks.get(id)?.name === 'database-row' && (doc.blocks.get(id)?.data as DatabaseRowData).template !== true);
const templateRows = (doc: Doc): string[] => doc.childrenOf('db').filter((id) => (doc.blocks.get(id)?.data as DatabaseRowData | undefined)?.template === true);

describe('Suggested templates in the "New database" panel (research/27 §1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    popovers.items.length = 0;
    popovers.destroyed = 0;
    installed.clear();
    ['header', 'paragraph', 'list'].forEach((name) => installed.add(name));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('lists Suggested with Tasks Tracker, Projects and Skills, then More templates, between Import and Link', async () => {
    await insert();

    expect(rowLabels()).toEqual([
      'tools.database.linkedNewEmpty',
      'tools.database.csvImport',
      'tools.database.starterTasks', 'tools.database.starterProjects', 'tools.database.starterSkills',
      'tools.database.starterMoreTemplates',
      'tools.database.linkedLinkExisting',
    ]);
    // research/26 §2: the row is in secondary ink.
    expect(byTestId(panel(), 'database-new-database-more-templates').hasAttribute('data-muted')).toBe(true);
    expect(panel()?.querySelector('[data-blok-database-panel-section]')?.textContent).toBe('tools.database.linkedSuggested');
  });

  it('Skills builds at once, in one step: five properties, Count on the title, no rows; the panel closes', async () => {
    const { doc, tool } = await insert();
    const before = doc.transact.mock.calls.length;
    const titleId = saved(tool).schema.find((p) => p.type === 'title')?.id;

    byTestId(panel(), 'database-new-database-starter-skills').click();
    const data = saved(tool);

    expect(modal()).toBeNull();
    expect(data.title).toBe('tools.database.starterSkills');
    expect(data.schema.map((p) => p.type)).toEqual(['title', 'text', 'files', 'multiSelect', 'createdBy']);
    expect(data.schema[0].id).toBe(titleId);
    expect(data.views).toHaveLength(1);
    expect(data.views[0].calculations).toEqual([{ id: titleId, fn: 'count' }]);
    expect(data.activeViewId).toBe(data.views[0].id);
    expect(rows(doc)).toEqual([]);
    expect(doc.transact.mock.calls.length - before).toBe(1);
    expect(popovers.destroyed).toBe(1);
  });

  it('Tasks Tracker opens Customize; Get started then Done builds the measured database with rows and bodies in one step', async () => {
    const { doc, tool } = await insert();
    const before = doc.transact.mock.calls.length;

    byTestId(panel(), 'database-new-database-starter-tasks').click();
    const dialog = modal();

    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(byTestId(dialog ?? undefined, 'database-starter-heading').textContent).toBe('tools.database.starterCustomize {"name":"tools.database.starterTasks"}');
    expect(byTestId(dialog ?? undefined, 'database-starter-feature-priority').getAttribute('aria-pressed')).toBe('true');
    expect(byTestId(dialog ?? undefined, 'database-starter-feature-updatedAt').getAttribute('aria-pressed')).toBe('false');
    expect(doc.transact.mock.calls.length).toBe(before);

    byTestId(dialog ?? undefined, 'database-starter-next').click();
    expect(byTestId(dialog ?? undefined, 'database-starter-view-checklist').getAttribute('aria-pressed')).toBe('false');
    byTestId(dialog ?? undefined, 'database-starter-done').click();
    await settle();

    const data = saved(tool);

    expect(modal()).toBeNull();
    expect(data.schema.map((p) => p.type)).toEqual(['title', 'status', 'person', 'date', 'select', 'multiSelect', 'text', 'select']);
    expect(data.views.map((v) => v.type)).toEqual(['table', 'board', 'table']);
    expect(rows(doc)).toHaveLength(3);
    const first = rows(doc)[0];

    expect((doc.blocks.get(first)?.data as DatabaseRowData).title).toBe('tools.database.starterTaskRow1');
    expect(doc.childrenOf(first).map((id) => doc.blocks.get(id)?.name)).toEqual(['header', 'paragraph', 'paragraph', 'header', 'list', 'list', 'list', 'header']);
    expect(doc.transact.mock.calls.length - before).toBe(1);
  });

  it('a chip turned off leaves its property out; Back returns to the chips', async () => {
    const { tool } = await insert();

    byTestId(panel(), 'database-new-database-starter-tasks').click();
    const dialog = modal() ?? undefined;
    const chip = byTestId(dialog, 'database-starter-feature-effort');

    chip.click();
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    byTestId(dialog, 'database-starter-next').click();
    byTestId(dialog, 'database-starter-back').click();
    expect(byTestId(dialog, 'database-starter-feature-effort').getAttribute('aria-pressed')).toBe('false');
    byTestId(dialog, 'database-starter-next').click();
    byTestId(dialog, 'database-starter-view-mine').click();
    byTestId(dialog, 'database-starter-done').click();
    await settle();

    const data = saved(tool);

    expect(data.schema.map((p) => p.name)).not.toContain('tools.database.starterEffortLevel');
    expect(data.views.map((v) => v.name)).toEqual(['tools.database.starterViewAllTasks', 'tools.database.starterViewByStatus']);
  });

  it('the preview counts hidden properties and follows the first view; the last view card cannot be turned off (research/30 B8)', async () => {
    await insert();

    byTestId(panel(), 'database-new-database-starter-tasks').click();
    const dialog = modal() ?? undefined;
    const footer = (): string | null => dialog?.querySelector('[data-blok-database-starter-preview-hidden]')?.textContent ?? null;

    expect(footer()).toBe('tools.database.starterHiddenProperties {"count":"0"}');
    byTestId(dialog, 'database-starter-next').click();
    byTestId(dialog, 'database-starter-view-all').click();
    // By Status shows Assignee, Priority and Task type and groups by Status: three are hidden.
    expect(footer()).toBe('tools.database.starterHiddenProperties {"count":"3"}');
    byTestId(dialog, 'database-starter-view-byStatus').click();
    const last = byTestId(dialog, 'database-starter-view-mine');

    last.click();
    expect(last.getAttribute('aria-pressed')).toBe('true');
    expect([...(dialog?.querySelectorAll('[data-blok-database-starter-card][aria-pressed="true"]') ?? [])]).toHaveLength(1);
  });

  it('turning a view card on shows that view in the preview; turning it off falls back to the first (research/30 B8)', async () => {
    await insert();

    byTestId(panel(), 'database-new-database-more-templates').click();
    byTestId(document.body, 'database-template-gallery-template-brainstorm').click();
    const dialog = modal() ?? undefined;
    const footer = (): string | null => dialog?.querySelector('[data-blok-database-starter-preview-hidden]')?.textContent ?? null;
    const active = (): string | null => dialog?.querySelector('[data-blok-database-starter-preview-tabs] [aria-current="true"]')?.textContent ?? null;

    byTestId(dialog, 'database-starter-next').click();
    expect(footer()).toBe('tools.database.starterHiddenProperties {"count":"0"}');
    byTestId(dialog, 'database-starter-view-top').click();
    // Top Ideas shows Idea and Created by: five hidden, as measured.
    expect(footer()).toBe('tools.database.starterHiddenProperties {"count":"5"}');
    expect(active()).toBe('tools.database.starterViewTopIdeas');
    byTestId(dialog, 'database-starter-view-top').click();
    expect(footer()).toBe('tools.database.starterHiddenProperties {"count":"0"}');
    expect(active()).toBe('tools.database.starterViewAllIdeas');
  });

  it('closing Customize builds nothing and keeps the empty database', async () => {
    const { doc, tool } = await insert();
    const schema = saved(tool).schema;

    byTestId(panel(), 'database-new-database-starter-projects').click();
    byTestId(modal() ?? undefined, 'database-starter-close').click();
    await settle();

    expect(modal()).toBeNull();
    expect(saved(tool).schema).toEqual(schema);
    expect(rows(doc)).toEqual([]);
  });

  it('a body block whose tool is not installed is left out', async () => {
    installed.delete('header');
    const { doc } = await insert();

    byTestId(panel(), 'database-new-database-starter-tasks').click();
    byTestId(modal() ?? undefined, 'database-starter-next').click();
    byTestId(modal() ?? undefined, 'database-starter-done').click();
    await settle();

    expect(doc.childrenOf(rows(doc)[0]).map((id) => doc.blocks.get(id)?.name)).toEqual(['paragraph', 'paragraph', 'list', 'list', 'list']);
  });

  it('Suggested drops a template once a database of the document was made from it (research/27 §1a, inferred)', async () => {
    await insert([{ starter: 'tasks' }]);

    expect(rowLabels()).toEqual([
      'tools.database.linkedNewEmpty',
      'tools.database.csvImport',
      'tools.database.starterProjects', 'tools.database.starterSkills', 'tools.database.starterDocumentHub',
      'tools.database.starterMoreTemplates',
      'tools.database.linkedLinkExisting',
    ]);
  });

  it('with every template used, Suggested and its label are gone; More templates stays', async () => {
    await insert(['tasks', 'projects', 'skills', 'documentHub', 'brainstorm', 'meetingNotes', 'goals'].map((starter) => ({ starter } as Partial<DatabaseData>)));

    expect(rowLabels()).not.toContain('tools.database.starterSkills');
    expect(rowLabels()).toContain('tools.database.starterMoreTemplates');
    expect(panel()?.querySelector('[data-blok-database-panel-section]')).toBeNull();
  });

  it('More templates closes the panel and opens the gallery: unused templates first, the document\'s databases as sources', async () => {
    await insert([{ starter: 'tasks', title: 'Mine' }]);

    byTestId(panel(), 'database-new-database-more-templates').click();
    const gallery = byTestId(document.body, 'database-template-gallery');
    const ids = [...gallery.querySelectorAll('[data-blok-testid^="database-template-gallery-template-"]')]
      .map((card) => card.getAttribute('data-blok-testid')?.replace('database-template-gallery-template-', ''));

    expect(popovers.destroyed).toBe(1);
    expect(ids).toEqual(['projects', 'skills', 'documentHub', 'brainstorm', 'meetingNotes', 'goals', 'tasks']);
    expect(byTestId(gallery, 'database-template-gallery-template-documentHub').getAttribute('data-tint')).toBe('red');
    expect(byTestId(gallery, 'database-template-gallery-source-other-0').textContent).toContain('Mine');
  });

  it('a gallery template opens Customize; Done builds it with its icon and starter in one step', async () => {
    const { doc, tool } = await insert();
    const before = doc.transact.mock.calls.length;

    byTestId(panel(), 'database-new-database-more-templates').click();
    byTestId(document.body, 'database-template-gallery-template-documentHub').click();
    expect(document.querySelector('[data-blok-testid="database-template-gallery"]')).toBeNull();
    byTestId(modal() ?? undefined, 'database-starter-next').click();
    byTestId(modal() ?? undefined, 'database-starter-done').click();
    await settle();
    const data = saved(tool);

    expect(data.title).toBe('tools.database.starterDocumentHub');
    expect(data.schema.map((p) => p.type)).toEqual(['title', 'multiSelect', 'createdBy', 'createdTime', 'lastEditedBy', 'lastEditedTime']);
    expect(data.icon).toEqual({ glyph: 'doc', color: 'red' });
    expect(data.starter).toBe('documentHub');
    expect(rows(doc)).toHaveLength(3);
    expect(templateRows(doc)).toEqual([]);
    expect(doc.transact.mock.calls.length - before).toBe(1);
  });

  it('Empty database in the gallery keeps the empty database', async () => {
    const { doc, tool } = await insert();
    const schema = saved(tool).schema;

    byTestId(panel(), 'database-new-database-more-templates').click();
    byTestId(document.body, 'database-template-gallery-empty').click();
    await settle();

    expect(document.querySelector('[data-blok-testid="database-template-gallery"]')).toBeNull();
    expect(saved(tool).schema).toEqual(schema);
    expect(rows(doc)).toEqual([]);
  });

  it('Tasks Tracker gives the database its icon, saved and drawn before the title (research/27:42)', async () => {
    const { tool } = await insert();

    await applyTasks();
    const data = saved(tool);

    expect(data.icon).toEqual({ glyph: 'check', color: 'green' });
    expect(data.starter).toBe('tasks');
    const icon = document.querySelector('[data-blok-database-title-row] [data-blok-database-icon]');

    expect(icon?.getAttribute('data-blok-database-icon')).toBe('green');
    expect(icon?.querySelector('svg')).not.toBeNull();
    expect(icon?.nextElementSibling?.hasAttribute('data-blok-database-title')).toBe(true);
  });

  it('a saved icon is drawn on load; an unknown icon or starter is not drawn but saved back as loaded', () => {
    const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }]);
    const base = { schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }], views: [{ id: 'v', name: 'T', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }], activeViewId: 'v' } as unknown as DatabaseData;
    const { tool } = buildDatabase(doc, 'db', { ...base, icon: { glyph: 'wand', color: 'gray' } });

    expect(document.querySelector('[data-blok-database-icon]')?.getAttribute('data-blok-database-icon')).toBe('gray');
    expect(saved(tool).icon).toEqual({ glyph: 'wand', color: 'gray' });
    document.body.innerHTML = '';
    const { tool: other } = buildDatabase(makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }]), 'db', { ...base, icon: { glyph: 'nope', color: 'pink' } } as unknown as DatabaseData);

    expect(document.querySelector('[data-blok-database-icon]')).toBeNull();
    expect(saved(other).icon).toEqual({ glyph: 'nope', color: 'pink' });
    document.body.innerHTML = '';
    const { tool: future } = buildDatabase(makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }]), 'db', { ...base, starter: 'roadmap' } as unknown as DatabaseData);

    expect(saved(future).starter).toBe('roadmap');
  });

  it('Tasks Tracker adds the "New task" template as the default, with the row body, in the same step; the backend gets it as a template', async () => {
    const createRow = vi.fn(async (params: { id: string }) => ({ ...params }));
    const adapter = {
      loadDatabase: vi.fn(() => new Promise<never>(() => undefined)),
      createRow,
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
    const { doc, tool } = await insert([], { adapter } as unknown as DatabaseConfig);
    const before = doc.transact.mock.calls.length;

    await applyTasks();
    const [template] = templateRows(doc);
    const data = saved(tool);

    expect(template).toBeDefined();
    expect(doc.row(template).title).toBe('tools.database.starterNewTask');
    expect(data.schema[0].defaultTemplateId).toBe(template);
    expect(doc.childrenOf(template).map((id) => doc.blocks.get(id)?.name)).toEqual(['header', 'paragraph', 'paragraph', 'header', 'list', 'list', 'list', 'header']);
    expect(doc.transact.mock.calls.length - before).toBe(1);
    expect(createRow).toHaveBeenCalledWith(expect.objectContaining({ id: template, template: true }));
    expect(createRow.mock.calls.filter(([params]) => (params as { template?: boolean }).template === true)).toHaveLength(1);
  });

  it('View settings has "Undo skills database"; it empties the database back to a plain table in one step (Blok choice)', async () => {
    const { doc, tool } = await insert();
    const titleId = saved(tool).schema.find((p) => p.type === 'title')?.id;

    byTestId(panel(), 'database-new-database-starter-skills').click();
    byTestId(document.body, 'database-toolbar-settings').click();
    const row = settingsRow('database-settings-undo-starter');

    expect(row?.textContent).toContain('tools.database.starterUndoSkills');
    expect(row?.nextElementSibling?.getAttribute('data-blok-testid')).toBe('database-settings-more');
    const before = doc.transact.mock.calls.length;

    row?.click();
    const data = saved(tool);

    expect(data.starter).toBeUndefined();
    expect(data.icon).toBeUndefined();
    expect(data.title).toBe('');
    expect(data.schema.map((p) => p.type)).toEqual(['title']);
    expect(data.schema[0].id).toBe(titleId);
    expect(data.views.map((v) => v.type)).toEqual(['table']);
    expect(document.querySelector('[data-blok-database-icon]')).toBeNull();
    expect(doc.transact.mock.calls.length - before).toBe(1);
  });

  it('Undo Task database removes the template\'s rows and its template too; the backend drops its properties and views', async () => {
    const deleteProperty = vi.fn(async () => undefined);
    const deleteView = vi.fn(async () => undefined);
    const adapter = {
      loadDatabase: vi.fn(() => new Promise<never>(() => undefined)),
      createRow: vi.fn(async (params: { id: string }) => ({ ...params })),
      updateRow: vi.fn(async () => undefined),
      moveRow: vi.fn(async () => undefined),
      deleteRow: vi.fn(async () => undefined),
      createProperty: vi.fn(async (params: { id: string }) => ({ ...params })),
      updateProperty: vi.fn(async () => undefined),
      deleteProperty,
      createView: vi.fn(async (params: { id: string }) => ({ ...params })),
      updateView: vi.fn(async () => undefined),
      deleteView,
    };
    const { doc, tool } = await insert([], { adapter } as unknown as DatabaseConfig);

    await applyTasks();
    byTestId(document.body, 'database-toolbar-settings').click();
    const row = settingsRow('database-settings-undo-starter');

    expect(row?.textContent).toContain('tools.database.starterUndoTasks');
    deleteProperty.mockClear();
    deleteView.mockClear();
    row?.click();

    expect(rows(doc)).toEqual([]);
    expect(templateRows(doc)).toEqual([]);
    expect(saved(tool).schema[0].defaultTemplateId).toBeUndefined();
    // Seven properties after the title, and the three views, go; the title property stays.
    expect(deleteProperty).toHaveBeenCalledTimes(7);
    expect(deleteView).toHaveBeenCalledTimes(3);
  });

  it('Projects has no Undo row (Notion showed "Turn into" there); a plain database has none either', async () => {
    await insert();

    byTestId(document.body, 'database-toolbar-settings').click();
    expect(settingsRow('database-settings-more') ?? settingsRow('database-settings-lock')).not.toBeNull();
    expect(settingsRow('database-settings-undo-starter')).toBeNull();
  });
});
