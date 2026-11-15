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

const schema: PropertyDefinition[] = [{ id: 't', name: 'Name', type: 'title', position: 'a0' }];

/**
 * "db" has two views on its own data, one on its second source "src-b" and
 * one on the page's other database "other". "spare" is linked by nothing.
 */
const doc = (title = 'Projects'): OutputBlockData[] => [
  {
    id: 'db', type: 'database', content: ['r1', 'src-b'],
    data: {
      title,
      schema,
      views: [table('v1', 'a0'), table('v2', 'a1'), table('vb', 'a2', { dataSourceId: 'src-b' }), table('vo', 'a3', { dataSourceId: 'other' })],
      activeViewId: 'v1',
    },
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Parent row' }, position: 'a0' } },
  {
    id: 'src-b', type: 'database', parent: 'db',
    data: { title: 'Src B', schema: [{ id: 'bt', name: 'Name', type: 'title', position: 'a0' }], views: [table('bv', 'a0')], activeViewId: 'bv' },
  },
  { id: 'other', type: 'database', data: { title: 'Stock', schema: [{ id: 'ot', name: 'Name', type: 'title', position: 'a0' }], views: [table('ov', 'a0')], activeViewId: 'ov' } },
  { id: 'spare', type: 'database', data: { title: 'Spare', schema: [{ id: 'st', name: 'Name', type: 'title', position: 'a0' }], views: [table('sv', 'a0')], activeViewId: 'sv' } },
];

const make = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  if (holder === undefined) throw new Error('missing editor holder');
  let ready: TestEditor | undefined;

  editor = new Blok({
    holder, dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, database: { class: DatabaseTool }, 'database-row': DatabaseRowTool },
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

const byTestId = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-testid="${id}"]`);

const settings = (): HTMLElement | null => byTestId('database-view-settings');

const dataOf = async (api: TestEditor, id: string): Promise<DatabaseData | undefined> =>
  (await api.save()).blocks.find((b) => b.id === id)?.data as DatabaseData | undefined;

const stopCapturing = (): void => {
  (editor as unknown as { module: { yjsManager: { stopCapturing: () => void } } }).module.yjsManager.stopCapturing();
};

const openManage = async (): Promise<void> => {
  own('[data-blok-testid="database-toolbar-settings"]').click();
  await quiet();
  byTestId('database-settings-manage-sources')?.click();
  await quiet();
};

const pageText = (): string[] => [...(settings()?.querySelectorAll<HTMLElement>('[data-blok-database-panel-label], [data-blok-database-panel-value], [data-blok-database-panel-section], [data-blok-database-panel-header] > span') ?? [])]
  .map((el) => el.textContent ?? '');

describe('View settings "Manage data sources" (notion-motion.md Round 38 §4)', () => {
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

  // r10-vs-root-r10.raw: the row sits after the line under More settings, right above Lock database.
  it('the root lists "Manage data sources" right above Lock database, after a line', async () => {
    await make(doc());
    own('[data-blok-testid="database-toolbar-settings"]').click();
    await quiet();
    const row = byTestId('database-settings-manage-sources');

    expect(row?.textContent).toContain('Manage data sources');
    expect(row?.querySelector('[data-blok-database-panel-chevron]')).not.toBeNull();
    expect(row?.nextElementSibling?.getAttribute('data-blok-testid')).toBe('database-settings-lock');
    expect(row?.previousElementSibling?.hasAttribute('data-blok-database-panel-separator')).toBe(true);
  });

  it('lists the own sources with their view counts, Add data source, then Linked sources and Link existing data source', async () => {
    await make(doc());
    await openManage();

    expect(pageText()).toEqual([
      'Manage data sources',
      'Source',
      'Projects', '2 views',
      'Src B', '1 view',
      'Add data source',
      'Linked',
      'Stock', '1 view',
      'Link existing data source',
    ]);
    // The help link is the host's; Blok has none.
    expect(settings()?.textContent).not.toContain('Learn about');
  });

  it('an untitled own source reads "New database", as the Source row names it', async () => {
    await make(doc(''));
    await openManage();

    expect(byTestId('database-manage-source-db')?.textContent).toContain('New database');
  });

  it('a source\'s ⋯ offers Copy data source ID, which copies the source\'s id', async () => {
    const writeText = vi.fn(async () => undefined);

    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await make(doc());
    await openManage();
    const more = byTestId('database-manage-source-more-src-b');

    expect(more?.getAttribute('aria-label')).toBe('Data source actions');
    more?.click();
    await quiet();
    const menu = byTestId('database-manage-source-menu');

    expect([...(menu?.querySelectorAll('[data-blok-database-panel-row]') ?? [])].map((row) => row.textContent?.trim())).toEqual(['Copy data source ID']);
    byTestId('database-manage-source-copy-id')?.click();
    await quiet();

    expect(writeText).toHaveBeenCalledWith('src-b');
    expect(byTestId('database-manage-source-menu')).toBeNull();
  });

  it('arrow keys reach a source\'s ⋯', async () => {
    await make(doc());
    await openManage();
    const more = byTestId('database-manage-source-more-db');

    byTestId('database-manage-source-db')?.focus();
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    expect(more).toHaveFocus();
  });

  it('Escape goes back to the root, onto the Manage data sources row', async () => {
    await make(doc());
    await openManage();
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await quiet();

    expect(byTestId('database-settings-manage-sources')).toHaveFocus();
  });

  it('"Add data source" closes View settings and runs New data source; one undo removes it', async () => {
    const api = await make(doc());

    stopCapturing();
    await openManage();
    byTestId('database-manage-sources-add')?.click();
    await quiet();
    stopCapturing();

    expect(settings()).toBeNull();
    expect(byTestId('database-new-source-panel')).not.toBeNull();
    expect(api.blocks.getChildren('db').filter((b) => b.name === 'database')).toHaveLength(2);

    api.history.undo();
    await quiet();

    expect(api.blocks.getChildren('db').filter((b) => b.name === 'database')).toHaveLength(1);
    expect((await dataOf(api, 'db'))?.views).toHaveLength(4);
  });

  it('"Link existing data source" lists the page\'s databases; a pick adds a view of it in one undo step', async () => {
    const api = await make(doc());

    stopCapturing();
    await openManage();
    byTestId('database-manage-sources-link')?.click();
    await quiet();
    const spare = byTestId('database-manage-link-option-spare');

    expect(spare?.textContent).toContain('Spare');
    spare?.click();
    await quiet();
    stopCapturing();

    expect(settings()).toBeNull();
    const views = (await dataOf(api, 'db'))?.views ?? [];
    const linked = views.find((view) => view.dataSourceId === 'spare');

    expect(views).toHaveLength(5);
    expect(linked?.type).toBe('table');
    expect((await dataOf(api, 'db'))?.activeViewId).toBe(linked?.id);
    expect(api.blocks.getById('spare')).not.toBeNull();

    api.history.undo();
    await quiet();

    expect((await dataOf(api, 'db'))?.views.map((view) => view.id)).toEqual(['v1', 'v2', 'vb', 'vo']);
  });
});
