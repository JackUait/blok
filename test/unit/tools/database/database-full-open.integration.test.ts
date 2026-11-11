/**
 * ⤢ "Open as full page" on an inline database (notion-motion.md Round 15 B):
 * the database takes over the editor, the URL names it, Back returns, and
 * nothing in the document changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { API, OutputBlockData, OutputData } from '../../../../types';
import type { DatabaseConfig, DatabaseViewConfig, PropertyDefinition } from '../../../../src/tools/database/types';

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

const schema: PropertyDefinition[] = [
  { id: 't', name: 'Name', type: 'title', position: 'a0' },
  { id: 'notes', name: 'Notes', type: 'text', position: 'a1' },
];

const database = (id: string, data: Record<string, unknown> = {}, content: string[] = []): OutputBlockData => ({
  id, type: 'database', content, data: { title: 'Projects', schema, views: [table('v1', 'a0'), table('v2', 'a1')], activeViewId: 'v1', ...data },
});

const doc = (data: Record<string, unknown> = {}): OutputBlockData[] => [
  { id: 'p1', type: 'paragraph', data: { text: 'Before' } },
  database('db', data, ['r1']),
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'Row', notes: 'n' }, position: 'a0' } },
];

interface Made {
  api: API;
  onChange: ReturnType<typeof vi.fn>;
}

const make = async (blocks: OutputBlockData[], config: Pick<DatabaseConfig, 'openFullPage'> = {}): Promise<Made> => {
  if (holder === undefined) throw new Error('missing editor holder');
  let ready: API | undefined;
  const onChange = vi.fn();
  let armed = false;

  editor = new Blok({
    holder, dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      database: { class: DatabaseTool, config: { ...config } },
      'database-row': DatabaseRowTool,
    },
    data: { blocks },
    onReady: (api) => { ready = api; },
    onChange: () => {
      if (armed) onChange();
    },
  });
  await editor.isReady;
  await quiet();
  if (ready === undefined) throw new Error('editor did not expose its ready API');
  // Changes from the first render are not the button's.
  armed = true;

  return { api: ready, onChange };
};

const holderOf = (id: string): HTMLElement => {
  const found = holder?.querySelector<HTMLElement>(`[data-blok-element][data-blok-id="${id}"]`);

  if (found === null || found === undefined) throw new Error(`missing block ${id}`);

  return found;
};

/** The ⤢ of block `id`'s own toolbar, not one of a database nested inside it. */
const expandOf = (id: string): HTMLElement | undefined => {
  const root = holderOf(id);

  return [...root.querySelectorAll<HTMLElement>('[data-blok-testid="database-toolbar-full-page"]')]
    .find((el) => el.closest('[data-blok-element]') === root);
};

const shown = (el: HTMLElement | undefined): boolean => el !== undefined && !el.hidden;

const editorRoot = (): HTMLElement => {
  const found = holder?.querySelector<HTMLElement>('[data-blok-editor]');

  if (found === null || found === undefined) throw new Error('missing editor');

  return found;
};

const menuItems = (): string[] => [...document.querySelectorAll('[data-blok-popover-opened] [data-blok-item-name]')]
  .map((item) => item.getAttribute('data-blok-item-name') ?? '');

const back = async (): Promise<void> => {
  history.back();
  await new Promise<void>((resolve) => { window.addEventListener('popstate', () => resolve(), { once: true }); });
  await quiet();
};

describe('Open as full page (⤢) on an inline database', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    history.replaceState(null, '', '/editor');
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    await editor?.destroy();
    editor = undefined;
    holder?.remove();
    document.querySelectorAll('[data-blok-popover]').forEach((el) => el.remove());
    history.replaceState(null, '', '/editor');
    vi.restoreAllMocks();
  });

  it('shows a link labelled "Open as full page" between Search and Settings', async () => {
    await make(doc());
    const expand = expandOf('db');

    expect(shown(expand)).toBe(true);
    expect(expand?.getAttribute('role')).toBe('link');
    expect(expand?.getAttribute('aria-label')).toBe('Open as full page');
    const order = [...(expand?.parentElement?.children ?? [])].map((el) => el.getAttribute('data-blok-testid'));

    expect(order.indexOf('database-toolbar-full-page')).toBeGreaterThan(order.indexOf('database-toolbar-search'));
    expect(order.indexOf('database-toolbar-full-page')).toBeLessThan(order.indexOf('database-toolbar-settings'));
  });

  it('is not offered on a full-page database, a linked view or a database inside a database', async () => {
    await make([
      database('page-db', { fullPage: true }),
      database('src', {}, ['inner']),
      database('inner', {}),
      { id: 'linked', type: 'database', data: { source: { databaseId: 'src' }, views: [table('lv', 'a0')], activeViewId: 'lv' } },
    ].map((block) => (block.id === 'inner' ? { ...block, parent: 'src' } : block)));

    expect(shown(expandOf('page-db'))).toBe(false);
    expect(shown(expandOf('linked'))).toBe(false);
    expect(shown(expandOf('inner'))).toBe(false);
    expect(shown(expandOf('src'))).toBe(true);
  });

  it('takes over the editor and names the database in the URL, without changing the document', async () => {
    const { api, onChange } = await make(doc());
    const before = await api.saver.save();

    expandOf('db')?.click();
    await quiet();

    expect(editorRoot().hasAttribute('data-blok-database-full-open')).toBe(true);
    expect(holderOf('db').hasAttribute('data-blok-database-full-open-target')).toBe(true);
    expect(holderOf('p1').hasAttribute('data-blok-database-full-open-path')).toBe(false);
    expect(window.location.hash).toBe('#db?full');
    // The full page has no ⤢ of its own.
    expect(shown(expandOf('db'))).toBe(false);

    const after: OutputData = await api.saver.save();

    expect(after.blocks).toEqual(before.blocks);
    expect(onChange).not.toHaveBeenCalled();
    expect(api.history.canUndo()).toBe(false);
  });

  it('Back returns to the page and brings ⤢ back, still without a change', async () => {
    const { onChange } = await make(doc());

    expandOf('db')?.click();
    await quiet();

    await back();

    expect(editorRoot().hasAttribute('data-blok-database-full-open')).toBe(false);
    expect(window.location.hash).toBe('');
    expect(shown(expandOf('db'))).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a row opened full on top of it closes first on Back, then the database', async () => {
    await make(doc({ views: [table('v1', 'a0', { openPagesIn: 'full' }), table('v2', 'a1')] }));
    expandOf('db')?.click();
    await quiet();
    holderOf('db').querySelector<HTMLElement>('[data-row-id="r1"] [data-blok-database-table-open]')?.click();
    await quiet();

    expect(window.location.hash).toBe('#r1?full');
    expect(editorRoot().hasAttribute('data-blok-database-row-page')).toBe(true);

    await back();

    expect(editorRoot().hasAttribute('data-blok-database-row-page')).toBe(false);
    expect(editorRoot().hasAttribute('data-blok-database-full-open')).toBe(true);
    expect(holderOf('db').hasAttribute('data-blok-no-controls')).toBe(true);
    expect(window.location.hash).toBe('#db?full');

    await back();

    expect(editorRoot().hasAttribute('data-blok-database-full-open')).toBe(false);
    expect(holderOf('db').hasAttribute('data-blok-no-controls')).toBe(false);
  });

  it('a reload with #<id>?full opens it again', async () => {
    history.replaceState(null, '', '/editor#db?full');
    await make(doc());

    expect(editorRoot().hasAttribute('data-blok-database-full-open')).toBe(true);
    expect(shown(expandOf('db'))).toBe(false);
  });

  it('with an openFullPage hook, Blok calls it and does not take over', async () => {
    const openFullPage = vi.fn();

    await make(doc(), { openFullPage });
    expandOf('db')?.click();
    await quiet();

    expect(openFullPage).toHaveBeenCalledTimes(1);
    expect(openFullPage).toHaveBeenCalledWith({ databaseId: 'db', viewId: 'v1' });
    expect(editorRoot().hasAttribute('data-blok-database-full-open')).toBe(false);
    expect(window.location.hash).toBe('');
  });

  it('is a row in the view tab menu after Copy link to view, and opens the full page', async () => {
    await make(doc());
    holderOf('db').querySelector<HTMLElement>('[data-blok-database-tab][data-view-id="v1"]')?.click();
    await quiet();
    const names = menuItems();

    expect(names.indexOf('database-view-full-page')).toBe(names.indexOf('database-view-copy-link') + 1);
    document.querySelector<HTMLElement>('[data-blok-popover-opened] [data-blok-item-name="database-view-full-page"]')?.click();
    await quiet();

    expect(editorRoot().hasAttribute('data-blok-database-full-open')).toBe(true);
  });

  it('is only in the shown tab\'s menu: opening another view would save the switch', async () => {
    await make(doc());
    holderOf('db').querySelector<HTMLElement>('[data-blok-database-tab][data-view-id="v2"]')
      ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await quiet();

    expect(menuItems()).toContain('database-view-copy-link');
    expect(menuItems()).not.toContain('database-view-full-page');
  });

  it('is not in a dashboard tab\'s menu (notion-motion.md Round 15 A)', async () => {
    await make(doc({
      views: [table('v1', 'a0'), { ...table('dash', 'a1'), type: 'dashboard', name: 'Dashboard', dashboard: { rows: [] } }],
      activeViewId: 'dash',
    }));
    holderOf('db').querySelector<HTMLElement>('[data-blok-database-tab][data-view-id="dash"]')?.click();
    await quiet();

    expect(menuItems()).toContain('database-view-copy-link');
    expect(menuItems()).not.toContain('database-view-full-page');
  });
});
