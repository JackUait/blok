import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseConfig, DatabaseData, DatabaseRowData } from '../../../../src/tools/database/types';
import type { DatabaseTool } from '../../../../src/tools/database';
import { buildDatabase, makeDoc } from './structure-harness';
import type { Doc } from './structure-harness';
import * as icons from '../../../../src/components/icons';

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

  describe('the preview draws the view it shows (research/30 B8, research/31 §8)', () => {
    const openGallery = async (id: string): Promise<HTMLElement | undefined> => {
      await insert();
      byTestId(panel(), 'database-new-database-more-templates').click();
      byTestId(document.body, `database-template-gallery-template-${id}`).click();

      return modal() ?? undefined;
    };
    const previewRows = (dialog: HTMLElement | undefined): string[] =>
      [...(dialog?.querySelectorAll('[data-blok-database-starter-preview-table] > [data-blok-database-starter-preview-row=""] > span:first-child') ?? [])].map((el) => el.textContent ?? '');

    it('a grouped view draws group headings in the view\'s order, each over its rows: By Team', async () => {
      const dialog = await openGallery('goals');

      byTestId(dialog, 'database-starter-next').click();
      byTestId(dialog, 'database-starter-view-byTeam').click();
      const table = dialog?.querySelector('[data-blok-database-starter-preview-table]');
      const groups = [...(table?.querySelectorAll('[data-blok-database-starter-preview-group]') ?? [])].map((el) => el.textContent ?? '');

      expect(groups).toEqual([
        'tools.database.starterTeamAccountManagement', 'tools.database.starterTeamBusinessDevelopment',
        'tools.database.starterTeamHumanResources', 'tools.database.starterTeamProductDesign',
        'tools.database.noValueGroup {"property":"tools.database.starterTeam"}',
      ]);
      // Launch 3 new products is Account Management's; the other two are Business Development's.
      const order = [...(table?.children ?? [])].map((el) => (el.hasAttribute('data-blok-database-starter-preview-group') ? `#${el.textContent ?? ''}` : el.querySelector('span')?.textContent ?? ''));

      expect(order.slice(1, 6)).toEqual([
        '#tools.database.starterTeamAccountManagement', 'tools.database.starterGoalRow2',
        '#tools.database.starterTeamBusinessDevelopment', 'tools.database.starterGoalRow1', 'tools.database.starterGoalRow3',
      ]);
    });

    it('a grouped board keeps the flat preview: its grouped look was not measured', async () => {
      const dialog = await openGallery('brainstorm');

      byTestId(dialog, 'database-starter-next').click();
      byTestId(dialog, 'database-starter-view-all').click();
      expect(dialog?.querySelector('[data-blok-database-starter-preview-tabs] [aria-current="true"]')?.textContent).toBe('tools.database.starterViewByCategoryIdeas');
      expect(dialog?.querySelectorAll('[data-blok-database-starter-preview-group]')).toHaveLength(0);
      expect(previewRows(dialog)).toHaveLength(3);
    });

    it('Top Ideas shows its rows in reverse order, Improve SEO first', async () => {
      const dialog = await openGallery('brainstorm');

      byTestId(dialog, 'database-starter-next').click();
      expect(previewRows(dialog)).toEqual(['tools.database.starterIdeaRow1', 'tools.database.starterIdeaRow2', 'tools.database.starterIdeaRow3']);
      byTestId(dialog, 'database-starter-view-top').click();
      expect(previewRows(dialog)).toEqual(['tools.database.starterIdeaRow3', 'tools.database.starterIdeaRow2', 'tools.database.starterIdeaRow1']);
    });

    it('Days until due shows last in the preview, though the database puts it after Due date', async () => {
      const dialog = await openGallery('goals');

      byTestId(dialog, 'database-starter-feature-daysUntilDue').click();
      const header = [...(dialog?.querySelectorAll('[data-blok-database-starter-preview-row="header"] > span') ?? [])].map((el) => el.textContent ?? '');

      expect(header.at(-1)).toBe('tools.database.starterDaysUntilDue');
      expect(header.indexOf('tools.database.starterDueDate')).toBeLessThan(header.length - 2);
    });
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
    await insert([
      'tasks', 'projects', 'skills', 'documentHub', 'brainstorm', 'meetingNotes', 'goals', 'campaign', 'contentCalendar',
      'events', 'socialMedia', 'issues', 'featureRequests', 'engineeringDocs', 'fundraising', 'pipeline', 'accounts', 'creative', 'inventory', 'roadmap', 'assets',
    ].map((starter) => ({ starter } as Partial<DatabaseData>)));

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
    expect(ids).toEqual([
      'projects', 'skills', 'documentHub', 'brainstorm', 'meetingNotes', 'goals', 'campaign', 'contentCalendar',
      'events', 'socialMedia', 'issues', 'featureRequests', 'engineeringDocs', 'fundraising', 'pipeline', 'accounts', 'creative', 'inventory', 'roadmap', 'assets', 'tasks',
    ]);
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

  it('a saved purple icon (Campaign Management, research/31 shot 51) is drawn on load and saved back', () => {
    const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }]);
    const base = { schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }], views: [{ id: 'v', name: 'T', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }], activeViewId: 'v' } as unknown as DatabaseData;
    const { tool } = buildDatabase(doc, 'db', { ...base, icon: { glyph: 'flag', color: 'purple' }, starter: 'campaign' });

    expect(document.querySelector('[data-blok-database-icon]')?.getAttribute('data-blok-database-icon')).toBe('purple');
    expect(saved(tool).icon).toEqual({ glyph: 'flag', color: 'purple' });
    expect(saved(tool).starter).toBe('campaign');
  });

  it.each([
    ['ticket', 'IconTicket'], ['feed', 'IconMessage'], ['currency', 'IconCurrency'], ['card', 'IconCreditCard'],
    ['paintBrush', 'IconPaintBrush'], ['package', 'IconPackage'], ['fanDeck', 'IconFanDeck'],
  ] as const)('a saved %s glyph draws %s (research/33 §3.13)', (glyph, name) => {
    const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }]);
    const base = { schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }], views: [{ id: 'v', name: 'T', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }], activeViewId: 'v' } as unknown as DatabaseData;

    const expected = document.createElement('span');

    expected.innerHTML = icons[name];
    buildDatabase(doc, 'db', { ...base, icon: { glyph, color: 'blue' } });

    expect(document.querySelector('[data-blok-database-icon]')?.innerHTML).toBe(expected.innerHTML);
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

  it('the By Status board\'s add buttons name the default template; without one they read "New page" (research/27 shot 04)', async () => {
    const { tool } = await insert();

    await applyTasks();
    const board = saved(tool).views.find((v) => v.type === 'board');
    const tab = document.querySelector<HTMLElement>(`[data-blok-database-tab][data-view-id="${board?.id}"]`);

    tab?.click();
    const labels = (): string[] => [...document.querySelectorAll('[data-blok-database-add-card] span:last-child')].map((el) => el.textContent ?? '');

    expect(labels().length).toBeGreaterThan(0);
    expect(new Set(labels())).toEqual(new Set(['tools.database.starterNewTask']));

    tool.setDefaultTemplate(null);
    expect(new Set(labels())).toEqual(new Set(['tools.database.newPage']));
  });

  const dialog = (): HTMLElement | null => document.querySelector('[data-blok-database-confirm-dialog]');
  const dialogButton = (name: 'confirm' | 'cancel'): HTMLElement => {
    const found = dialog()?.querySelector(`[data-blok-database-confirm-action="${name}"]`);

    if (!(found instanceof HTMLElement)) throw new Error(`no ${name}`);

    return found;
  };

  it('"Undo Task database" asks first (research/33 §3.10): title, body, Remove in red, Cancel; nothing changes yet', async () => {
    const { doc, tool } = await insert();

    await applyTasks();
    const before = JSON.stringify(saved(tool));
    const steps = doc.transact.mock.calls.length;

    byTestId(document.body, 'database-toolbar-settings').click();
    settingsRow('database-settings-undo-starter')?.click();

    expect(dialog()?.querySelector('[data-blok-database-confirm-title]')?.textContent).toBe('tools.database.starterUndoTasksTitle');
    expect(dialog()?.querySelector('[data-blok-database-confirm-description]')?.textContent).toBe('tools.database.starterUndoTasksDescription');
    expect(dialogButton('confirm').textContent).toBe('tools.database.starterUndoRemove');
    expect(dialogButton('confirm').hasAttribute('data-destructive')).toBe(true);
    expect(dialogButton('cancel').textContent).toBe('tools.database.optionDeleteCancel');
    // research/35 §1.7: Notion focuses Remove on open, so Enter confirms.
    expect(dialogButton('confirm')).toHaveFocus();
    // research/36 §8.1: no ×, no icon, no svg at all.
    expect(dialog()?.querySelector('[data-blok-database-confirm-close]')).toBeNull();
    expect(dialog()?.querySelector('[data-blok-database-confirm-art]')).toBeNull();
    expect(dialog()?.querySelectorAll('svg')).toHaveLength(0);
    expect(JSON.stringify(saved(tool))).toBe(before);
    expect(doc.transact.mock.calls.length).toBe(steps);
  });

  it('Cancel keeps the Tasks database as it was, with no history step', async () => {
    const { doc, tool } = await insert();

    await applyTasks();
    const before = JSON.stringify(saved(tool));
    const steps = doc.transact.mock.calls.length;

    byTestId(document.body, 'database-toolbar-settings').click();
    settingsRow('database-settings-undo-starter')?.click();
    dialogButton('cancel').click();
    await settle();

    expect(dialog()).toBeNull();
    expect(JSON.stringify(saved(tool))).toBe(before);
    expect(doc.transact.mock.calls.length).toBe(steps);
  });

  it('Remove drops only the Tasks designation, in one step: title, icon, schema, views, rows and templates stay; the backend is not touched', async () => {
    const deleteProperty = vi.fn(async () => undefined);
    const deleteView = vi.fn(async () => undefined);
    const deleteRow = vi.fn(async () => undefined);
    const adapter = {
      loadDatabase: vi.fn(() => new Promise<never>(() => undefined)),
      createRow: vi.fn(async (params: { id: string }) => ({ ...params })),
      updateRow: vi.fn(async () => undefined),
      moveRow: vi.fn(async () => undefined),
      deleteRow,
      createProperty: vi.fn(async (params: { id: string }) => ({ ...params })),
      updateProperty: vi.fn(async () => undefined),
      deleteProperty,
      createView: vi.fn(async (params: { id: string }) => ({ ...params })),
      updateView: vi.fn(async () => undefined),
      deleteView,
    };
    const { doc, tool } = await insert([], { adapter } as unknown as DatabaseConfig);

    await applyTasks();
    const { starter, ...kept } = saved(tool);
    const rowIds = rows(doc);
    const templateIds = templateRows(doc);
    const steps = doc.transact.mock.calls.length;

    expect(starter).toBe('tasks');
    await settle();
    [deleteProperty, deleteView, deleteRow].forEach((fn) => fn.mockClear());
    byTestId(document.body, 'database-toolbar-settings').click();
    settingsRow('database-settings-undo-starter')?.click();
    dialogButton('confirm').click();
    await settle();

    const after = saved(tool);

    expect(after.starter).toBeUndefined();
    expect(after).toEqual(kept);
    expect(rows(doc)).toEqual(rowIds);
    expect(templateRows(doc)).toEqual(templateIds);
    expect(document.querySelector('[data-blok-database-icon]')).not.toBeNull();
    expect(doc.transact.mock.calls.length - steps).toBe(1);
    expect(deleteProperty).not.toHaveBeenCalled();
    expect(deleteView).not.toHaveBeenCalled();
    expect(deleteRow).not.toHaveBeenCalled();
  });

  it('after Remove the row reads "Turn into"', async () => {
    await insert();

    await applyTasks();
    byTestId(document.body, 'database-toolbar-settings').click();
    settingsRow('database-settings-undo-starter')?.click();
    dialogButton('confirm').click();
    await settle();
    popovers.items.length = 0;
    byTestId(document.body, 'database-toolbar-settings').click();

    expect(settingsRow('database-settings-undo-starter')).toBeNull();
    expect(settingsRow('database-settings-turn-into')?.textContent).toContain('tools.database.starterTurnInto');
  });

  it('"Undo skills database" sits before More settings; its dialog has the Skills title and no body (unmeasured)', async () => {
    const { tool } = await insert();

    byTestId(panel(), 'database-new-database-starter-skills').click();
    byTestId(document.body, 'database-toolbar-settings').click();
    const row = settingsRow('database-settings-undo-starter');

    expect(row?.textContent).toContain('tools.database.starterUndoSkills');
    expect(row?.nextElementSibling?.getAttribute('data-blok-testid')).toBe('database-settings-more');
    row?.click();
    expect(dialog()?.querySelector('[data-blok-database-confirm-title]')?.textContent).toBe('tools.database.starterUndoSkillsTitle');
    expect(dialog()?.querySelector('[data-blok-database-confirm-description]')).toBeNull();
    dialogButton('confirm').click();
    await settle();
    expect(saved(tool).starter).toBeUndefined();
    expect(saved(tool).title).toBe('tools.database.starterSkills');
  });

  it('a plain database shows "Turn into" where Tasks shows Undo; it opens Tasks and Skills entries, disabled (their effect is unmeasured)', async () => {
    const { doc, tool } = await insert();
    const before = JSON.stringify(saved(tool));
    const steps = doc.transact.mock.calls.length;

    byTestId(document.body, 'database-toolbar-settings').click();
    const row = settingsRow('database-settings-turn-into');

    expect(settingsRow('database-settings-undo-starter')).toBeNull();
    expect(row?.textContent).toContain('tools.database.starterTurnInto');
    expect(row?.nextElementSibling?.getAttribute('data-blok-testid')).toBe('database-settings-more');
    row?.click();
    const tasks = settingsRow('database-settings-turn-into-tasks');
    const skills = settingsRow('database-settings-turn-into-skills');

    expect(tasks?.textContent).toContain('tools.database.starterTurnIntoTasks');
    expect(skills?.textContent).toContain('tools.database.starterTurnIntoSkills');
    expect((tasks as HTMLButtonElement | null)?.disabled).toBe(true);
    expect((skills as HTMLButtonElement | null)?.disabled).toBe(true);
    tasks?.click();
    expect(JSON.stringify(saved(tool))).toBe(before);
    expect(doc.transact.mock.calls.length).toBe(steps);
  });
});

describe('templates gallery and Customize, as measured (findings-creation N07, N08, N09)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    popovers.items.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const openFromGallery = async (): Promise<HTMLElement> => {
    await insert();
    byTestId(panel(), 'database-new-database-more-templates').click();
    byTestId(document.body, 'database-template-gallery-template-tasks').click();

    return modal() ?? document.body;
  };

  it('heads the gallery\'s templates with the Templates glyph (N08)', async () => {
    await insert();
    byTestId(panel(), 'database-new-database-more-templates').click();
    const label = [...document.querySelectorAll('[data-blok-database-tpl-gallery-section]')]
      .find((node) => node.textContent?.trim() === 'tools.database.templateMenuLabel');
    const expected = document.createElement('span');

    expected.innerHTML = icons.IconTemplates;
    expect(label?.querySelector('[data-blok-database-tpl-gallery-glyph]')?.innerHTML).toBe(expected.innerHTML);
  });

  it('opened from the gallery, Customize shows a back arrow and "Continue" (N09)', async () => {
    const dialog = await openFromGallery();

    expect(byTestId(dialog, 'database-starter-back-gallery').getAttribute('aria-label')).toBe('tools.database.peekBack');
    expect(byTestId(dialog, 'database-starter-next').textContent).toBe('tools.database.buttonConfirmContinue');
  });

  it('the back arrow returns to the gallery (N09)', async () => {
    const dialog = await openFromGallery();

    byTestId(dialog, 'database-starter-back-gallery').click();

    expect(modal()).toBeNull();
    expect(document.querySelector('[data-blok-testid="database-template-gallery"]')).not.toBeNull();
  });

  it('opened from the panel, Customize keeps × and "Get started"', async () => {
    await insert();
    byTestId(panel(), 'database-new-database-starter-tasks').click();
    const dialog = modal() ?? undefined;

    expect(byTestId(dialog, 'database-starter-close')).not.toBeNull();
    expect(byTestId(dialog, 'database-starter-next').textContent).toBe('tools.database.starterGetStarted');
  });

  it('the Customize preview fills Status from the template\'s rows, and its tabs and headers carry glyphs (N07)', async () => {
    await insert();
    byTestId(panel(), 'database-new-database-starter-tasks').click();
    const preview = modal()?.querySelector('[data-blok-database-starter-preview]');
    const pills = [...(preview?.querySelectorAll('[data-blok-database-starter-preview-row=""] [data-blok-database-option-pill], [data-blok-database-starter-preview-row=""] [data-blok-database-pill]') ?? [])];

    expect(pills.length).toBeGreaterThan(0);
    expect(preview?.querySelector('[data-blok-database-starter-preview-tabs] span svg')).not.toBeNull();
    expect(preview?.querySelector('[data-blok-database-starter-preview-row="header"] svg')).not.toBeNull();
  });
});
