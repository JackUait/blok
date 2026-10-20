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

const insert = async (): Promise<{ doc: Doc; tool: DatabaseTool }> => {
  const doc = makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }]);
  // No AI lever: the templates do not need one.
  const config: DatabaseConfig = {};

  Object.assign(doc.api.tools, { isInstalled: (name: string) => installed.has(name) });
  const { tool } = buildDatabase(doc, 'db', { initialView: 'table' } as unknown as DatabaseData, config, 'user');

  await new Promise((resolve) => requestAnimationFrame(resolve));

  return { doc, tool };
};
// Done resolves the Customize promise; the database is built a microtask later.
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const rows = (doc: Doc): string[] => doc.childrenOf('db').filter((id) => doc.blocks.get(id)?.name === 'database-row');

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

  it('lists Suggested with Tasks Tracker, Projects and Skills between Import and Link; no More templates row', async () => {
    await insert();

    expect(rowLabels()).toEqual([
      'tools.database.linkedNewEmpty',
      'tools.database.csvImport',
      'tools.database.starterTasks', 'tools.database.starterProjects', 'tools.database.starterSkills',
      'tools.database.linkedLinkExisting',
    ]);
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
});
