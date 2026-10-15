import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { TabsTool } from '../../../../src/tools/tabs';
import { TabTool } from '../../../../src/tools/tab';
import { findRanges } from '../../../../src/components/modules/find/text-index';
import type { OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  history: { undo: () => void; redo: () => void; canUndo: () => boolean };
}

const quiet = async (): Promise<void> => {
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
};

const LINKED_VIEW = { id: 'lvv', name: 'Roadmap', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] };
const linkedData = { title: '', schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0' }], views: [LINKED_VIEW], activeViewId: 'lvv', source: { databaseId: 'db' } };

const doc = (titleOverrides: Record<string, unknown> = {}): OutputBlockData[] => [
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [{ id: 't', name: 'Name', type: 'title', position: 'a0', ...titleOverrides }],
      views: [{ id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One' }, position: 'a0' } },
];

/** Tabbed with Content and "Roadmap" applied, plus `extra` blocks under the layout tabs block `lt`. */
const tabbedDoc = (extra: OutputBlockData[] = []): OutputBlockData[] => {
  const blocks = doc({ pageLayoutStructure: 'tabbed', pageLayoutTabsId: 'lt' });

  (blocks[0] as { content: string[] }).content.push('lt');
  blocks.push(
    { id: 'lt', type: 'tabs', parent: 'db', data: {}, content: ['tc', 'tv', ...extra.filter((block) => block.parent === 'lt').map((block) => String(block.id))] },
    { id: 'tc', type: 'tab', parent: 'lt', data: { title: '' } },
    { id: 'tv', type: 'tab', parent: 'lt', data: { title: 'Roadmap' }, content: ['lv'] },
    { id: 'lv', type: 'database', parent: 'tv', data: linkedData },
    ...extra,
  );

  return blocks;
};

/** A view tab another session drafted at `at`. */
const draftTab = (at: number): OutputBlockData[] => [
  { id: 'dt', type: 'tab', parent: 'lt', data: { title: 'Their draft', draft: { at, by: [] } }, content: ['dv'] },
  { id: 'dv', type: 'database', parent: 'dt', data: { ...linkedData, views: [{ ...LINKED_VIEW, id: 'dvv', name: 'Their draft' }], activeViewId: 'dvv' } },
];

const OLD = 0;

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (blocks: OutputBlockData[]): Promise<void> => {
  editor = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      database: { class: DatabaseTool },
      'database-row': DatabaseRowTool,
      tabs: TabsTool,
      tab: TabTool,
    },
    data: { blocks },
  } as never) as unknown as TestEditor;
  await editor.isReady;
  await quiet();
};

const q = <T extends Element = HTMLElement>(selector: string): T | null => holder?.querySelector<T>(selector) ?? null;
const BUILDER = '[data-blok-interface="database-layout-builder"]';
const b = (selector: string): HTMLElement | null => document.querySelector<HTMLElement>(`${BUILDER} ${selector}`);

const click = async (el: Element | null): Promise<void> => {
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await quiet();
};

const openRow = (rowId: string): Promise<void> => click(q(`[data-row-id="${rowId}"] [data-blok-database-table-open]`));
const drawer = (): HTMLElement | null => q('[data-blok-database-drawer]');
const builderRoot = (): HTMLElement | null => document.querySelector<HTMLElement>(BUILDER);
const testId = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-blok-testid="${id}"]`);
const names = (root: Element | null): string[] =>
  [...(root?.querySelectorAll<HTMLElement>('[data-blok-database-drawer-tabs] [role="tab"]') ?? [])].map((tab) => tab.textContent?.trim() ?? '');
const savedBlocks = async (): Promise<OutputBlockData[]> => (await editor?.save())?.blocks ?? [];
const drafts = async (): Promise<string[]> => (await savedBlocks()).filter((block) => 'draft' in block.data).map((block) => `${block.type}:${typeof block.data.title === 'string' ? block.data.title : ''}`);
const savedTitle = async (): Promise<Record<string, unknown> | undefined> => {
  const data = (await savedBlocks()).find((block) => block.id === 'db')?.data as { schema: Array<Record<string, unknown>> } | undefined;

  return data?.schema.find((property) => property.type === 'title');
};

const toTabbed = async (): Promise<void> => {
  await click(document.querySelectorAll(`${BUILDER} [data-blok-database-layout-structure-card]`)[1] ?? null);
};

const addViewTab = async (name: string): Promise<void> => {
  const bar = builderRoot()?.querySelector('[data-blok-database-drawer-tabs]') ?? null;

  bar?.dispatchEvent(new MouseEvent('pointerenter'));
  await click(bar?.querySelector('[data-blok-database-layout-add-tab]') ?? null);
  await click(testId('database-layout-link-data-source'));
  await click(testId('database-layout-source-db'));
  const field = testId('database-layout-view-name') as HTMLInputElement | null;

  if (field !== null) {
    field.value = name;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await click(testId('database-layout-add-view'));
};

describe('row page layout: draft view tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    document.querySelectorAll('[data-blok-popover]').forEach((el) => el.remove());
    vi.restoreAllMocks();
  });

  it('marks the tabs block and tabs made in Customize layout as drafts, and Apply clears every mark', async () => {
    await make(doc());
    await openRow('r1');
    await click(q('[data-blok-database-drawer-customize]'));
    await toTabbed();
    await addViewTab('Roadmap');

    expect((await drafts()).sort()).toEqual(['tab:', 'tab:Roadmap', 'tabs:']);
    const mark = (await savedBlocks()).find((block) => block.data.title === 'Roadmap')?.data.draft as { at?: unknown; by?: unknown };

    expect(typeof mark.at).toBe('number');
    expect(mark.by).toEqual([]);
    await click(b('[data-blok-database-layout-apply]'));

    expect(await drafts()).toEqual([]);
    expect(names(drawer())).toEqual(['Content', 'Roadmap']);
  });

  it('marks a tab added to an applied layout as a draft, and Apply clears it', async () => {
    await make(tabbedDoc());
    await openRow('r1');
    await click(q('[data-blok-database-drawer-customize]'));
    await addViewTab('Second');

    expect(await drafts()).toEqual(['tab:Second']);
    await click(b('[data-blok-database-layout-apply]'));

    expect(await drafts()).toEqual([]);
    expect(names(drawer())).toEqual(['Content', 'Roadmap', 'Second']);
  });

  it('undoing an Apply that made the first tab leaves the tabs block as a draft again, and redo clears it', async () => {
    await make(doc());
    await openRow('r1');
    await click(q('[data-blok-database-drawer-customize]'));
    await toTabbed();
    await addViewTab('Roadmap');
    await click(b('[data-blok-database-layout-apply]'));
    const tabsId = (await savedBlocks()).find((block) => block.type === 'tabs')?.id;

    editor?.history.undo();
    await quiet();

    expect(await drafts()).toEqual(['tabs:']);
    expect(editor?.history.canUndo()).toBe(false);
    editor?.history.redo();
    await quiet();

    expect(await drafts()).toEqual([]);
    expect((await savedBlocks()).filter((block) => block.type === 'tabs').map((block) => block.id)).toEqual([tabsId]);
    expect(await savedTitle()).toMatchObject({ pageLayoutStructure: 'tabbed', pageLayoutTabsId: tabsId });
    expect(names(drawer())).toEqual(['Content', 'Roadmap']);
  });

  it('a tabs block an undone Apply left behind is reused by the next Add view, not doubled', async () => {
    await make(doc());
    await openRow('r1');
    await click(q('[data-blok-database-drawer-customize]'));
    await toTabbed();
    await addViewTab('Roadmap');
    await click(b('[data-blok-database-layout-apply]'));
    editor?.history.undo();
    await quiet();
    await click(q('[data-blok-database-drawer-customize]'));
    await toTabbed();
    await addViewTab('Again');
    await click(b('[data-blok-database-layout-apply]'));

    expect((await savedBlocks()).filter((block) => block.type === 'tabs')).toHaveLength(1);
    expect(await drafts()).toEqual([]);
    expect(names(drawer())).toEqual(['Content', 'Again']);
  });

  describe('a tabs block an undone first Apply left, after a reload', () => {
    /** Saved output after Add view, Apply, Undo; the editor is gone. */
    const leftover = async (): Promise<OutputBlockData[]> => {
      await make(doc());
      await openRow('r1');
      await click(q('[data-blok-database-drawer-customize]'));
      await toTabbed();
      await addViewTab('Roadmap');
      await click(b('[data-blok-database-layout-apply]'));
      editor?.history.undo();
      await quiet();
      const blocks = await savedBlocks();

      editor?.destroy();
      editor = undefined;

      return blocks;
    };

    // Known limit: without collaboration a reload cannot tell its own leftover from a live peer's, so it waits for the bound.
    it('within the bound stays hidden, and the next Add view makes a tabs block of its own', async () => {
      const blocks = await leftover();
      const stray = blocks.find((block) => block.type === 'tabs')?.id;

      await make(blocks);
      await openRow('r1');
      await click(q('[data-blok-database-drawer-customize]'));
      await toTabbed();

      expect(names(builderRoot())).toEqual(['Content']);
      await addViewTab('Again');
      await click(b('[data-blok-database-layout-apply]'));

      expect(names(drawer())).toEqual(['Content', 'Again']);
      expect(await drafts()).toEqual(['tabs:']);
      expect((await savedBlocks()).find((block) => block.type === 'tabs' && 'draft' in block.data)?.id).toBe(stray);
    });

    it('past the bound is deleted on load', async () => {
      const blocks = (await leftover()).map((block) => (block.type === 'tabs' ? { ...block, data: { draft: { at: OLD, by: [] } } } : block));

      await make(blocks);

      expect((await savedBlocks()).filter((block) => block.type === 'tabs')).toEqual([]);
      expect(editor?.history.canUndo()).toBe(false);
    });
  });

  it('hides a draft tab another session made, on the row page and in the builder', async () => {
    await make(tabbedDoc(draftTab(Date.now())));
    await openRow('r1');

    expect(names(drawer())).toEqual(['Content', 'Roadmap']);
    await click(q('[data-blok-database-drawer-customize]'));

    expect(names(builderRoot())).toEqual(['Content', 'Roadmap']);
    // A recent draft may still be open somewhere: it stays.
    expect(await drafts()).toEqual(['tab:Their draft']);
  });

  it('deletes another session\'s draft past the bound when the database renders, with no undo step', async () => {
    await make(tabbedDoc(draftTab(OLD)));

    expect(await drafts()).toEqual([]);
    expect((await savedBlocks()).some((block) => block.id === 'dv')).toBe(false);
    expect((await savedBlocks()).find((block) => block.id === 'lt')?.content).toEqual(['tc', 'tv']);
    expect(editor?.history.canUndo()).toBe(false);
  });

  it('deletes an abandoned draft tabs block with its tabs, and keeps the applied layout', async () => {
    const blocks = tabbedDoc();

    (blocks[0] as { content: string[] }).content.push('dt-block');
    blocks.push(
      { id: 'dt-block', type: 'tabs', parent: 'db', data: { draft: { at: OLD, by: [] } }, content: ['dt'] },
      { ...draftTab(OLD)[0], parent: 'dt-block' },
      draftTab(OLD)[1],
    );
    await make(blocks);

    expect((await savedBlocks()).filter((block) => block.type === 'tabs').map((block) => block.id)).toEqual(['lt']);
    expect(editor?.history.canUndo()).toBe(false);
  });

  it('adds no find match inside another session\'s draft tab while a row page shows the layout', async () => {
    const other: OutputBlockData[] = [
      {
        id: 'db2',
        type: 'database',
        data: {
          schema: [{ id: 'n', name: 'Name', type: 'title', position: 'a0' }],
          views: [{ id: 'v2', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
          activeViewId: 'v2',
        },
        content: ['z1'],
      },
      { id: 'z1', type: 'database-row', parent: 'db2', data: { properties: { n: 'Zebra' }, position: 'a0' } },
    ];
    const [tab, view] = draftTab(Date.now());

    await make([...tabbedDoc([tab, { ...view, data: { ...view.data, schema: [{ id: 'n', name: 'Name', type: 'title', position: 'a0' }], source: { databaseId: 'db2' } } }]), ...other]);
    await openRow('r1');
    await click([...(drawer()?.querySelectorAll('[data-blok-database-drawer-tabs] [role="tab"]') ?? [])].find((each) => each.textContent?.trim() === 'Roadmap') ?? null);
    const lt = q('[data-blok-id="lt"]');

    expect(q('[data-blok-database-drawer-tab-panel]')?.contains(lt)).toBe(true);
    expect(findRanges(document.body, 'Zebra').filter((range) => lt?.contains(range.startContainer))).toEqual([]);
  });

  // A copy keeps the mark: stripping it would publish someone's draft in the copy.
  it('Duplicate of a database holding another session\'s draft keeps the copied draft hidden', async () => {
    await make(tabbedDoc(draftTab(Date.now())));
    const internals = editor as unknown as { module: { blockManager: { blocks: Array<{ id: string }> }; dragManager: { duplicateBlocksInPlace: (block: unknown) => Promise<unknown> } } };

    await internals.module.dragManager.duplicateBlocksInPlace(internals.module.blockManager.blocks.find((block) => block.id === 'db'));
    await quiet();
    const blocks = await savedBlocks();
    const copy = blocks.find((block) => block.type === 'database' && block.parent === undefined && block.id !== 'db')?.id;
    const copiedDraft = blocks.find((block) => block.type === 'tab' && block.id !== 'dt' && block.data.title === 'Their draft');

    expect(copiedDraft?.data.draft).toMatchObject({ by: [] });
    await click(q(`[data-blok-id="${String(copy)}"] [data-row-id] [data-blok-database-table-open]`));

    expect(names(drawer())).toEqual(['Content', 'Roadmap']);
  });

  it('never deletes a marked tabs block that holds an applied tab', async () => {
    const blocks = tabbedDoc();
    const layout = blocks.find((block) => block.id === 'lt');

    if (layout !== undefined) layout.data = { draft: { at: OLD, by: [] } };
    await make(blocks);

    expect((await savedBlocks()).filter((block) => block.parent === 'lt').map((block) => block.id)).toEqual(['tc', 'tv']);
    await openRow('r1');

    expect(names(drawer())).toEqual(['Content', 'Roadmap']);
  });
});
