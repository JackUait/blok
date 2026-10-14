import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import type { Block } from '../../../../src/components/block';
import type { BlockSelection } from '../../../../src/components/modules/blockSelection';
import type { Paste } from '../../../../src/components/modules/paste';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { TabsTool } from '../../../../src/tools/tabs';
import { TabTool } from '../../../../src/tools/tab';
import { Table } from '../../../../src/tools/table';
import { ToggleItem } from '../../../../src/tools/toggle';
import type { API, OutputBlockData, OutputData } from '../../../../types';

/**
 * A linked database names its source by block id. When the source is copied
 * in the same Duplicate or paste, the copied view must show the copy.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  caret: API['caret'];
  blocks: API['blocks'];
  module: {
    blockManager: { blocks: Block[] };
    blockSelection: BlockSelection;
    paste: Paste;
    dragManager: { duplicateBlocksInPlace: (block: Block) => Promise<Block[]> };
  };
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

const TITLE = { id: 't', name: 'Name', type: 'title', position: 'a0' };
const VIEW = { id: 'v', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] };
const LINKED_VIEW = { id: 'lvv', name: 'View', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] };

const linked = (id: string, parent: string, databaseId: string): OutputBlockData => ({
  id,
  type: 'database',
  parent,
  data: { title: '', schema: [TITLE], views: [LINKED_VIEW], activeViewId: 'lvv', source: { databaseId } },
});

/** `db` has Tabbed row pages: Content, "Self" (a view of db) and "Other" (a view of ext). */
const tabbedDoc = (): OutputBlockData[] => [
  { id: 'before', type: 'paragraph', data: { text: 'Before' } },
  {
    id: 'db',
    type: 'database',
    data: { schema: [{ ...TITLE, pageLayoutStructure: 'tabbed', pageLayoutTabsId: 'lt' }], views: [VIEW], activeViewId: 'v' },
    content: ['r1', 'lt'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One' }, position: 'a0' } },
  { id: 'lt', type: 'tabs', parent: 'db', data: {}, content: ['tc', 'tself', 'tother'] },
  { id: 'tc', type: 'tab', parent: 'lt', data: { title: '' } },
  { id: 'tself', type: 'tab', parent: 'lt', data: { title: 'Self' }, content: ['lself'] },
  linked('lself', 'tself', 'db'),
  { id: 'tother', type: 'tab', parent: 'lt', data: { title: 'Other' }, content: ['lother'] },
  linked('lother', 'tother', 'ext'),
  { id: 'ext', type: 'database', data: { schema: [TITLE], views: [{ ...VIEW, id: 'ev' }], activeViewId: 'ev' }, content: ['e1'] },
  { id: 'e1', type: 'database-row', parent: 'ext', data: { properties: { t: 'Ext' }, position: 'a0' } },
];

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const make = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: {
      paragraph: Paragraph,
      toggle: ToggleItem,
      database: DatabaseTool,
      'database-row': DatabaseRowTool,
      tabs: TabsTool,
      tab: TabTool,
      table: Table,
    },
    data: { blocks },
  } as never) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await quiet();

  return instance;
};

const blockOf = (instance: TestEditor, id: string): Block => {
  const block = instance.module.blockManager.blocks.find((candidate) => candidate.id === id);

  if (block === undefined) {
    throw new Error(`no block ${id}`);
  }

  return block;
};

/** The source each linked view under `databaseId`'s tabs names, by tab title. */
const tabSources = (blocks: OutputBlockData[], databaseId: string): Record<string, unknown> => {
  const tabsIds = blocks.filter((block) => block.type === 'tabs' && block.parent === databaseId).map((block) => block.id);
  const tabs = blocks.filter((block) => block.type === 'tab' && tabsIds.includes(block.parent));

  return Object.fromEntries(tabs.flatMap((tab) => blocks
    .filter((block) => block.type === 'database' && block.parent === tab.id)
    .map((view) => [String(tab.data.title), (view.data as { source?: { databaseId?: unknown } }).source?.databaseId])));
};

/** The root database that is neither `db` nor `ext`: the copy. */
const copyId = (blocks: OutputBlockData[]): string | undefined => blocks
  .find((block) => block.type === 'database' && block.parent === undefined && block.id !== 'db' && block.id !== 'ext')?.id;

const copyDatabase = async (instance: TestEditor, cut: boolean): Promise<Map<string, string>> => {
  const written = new Map<string, string>();
  const { blockSelection } = instance.module;

  blockSelection.selectBlock(blockOf(instance, 'db'));
  await blockSelection.copySelectedBlocks({
    preventDefault: () => undefined,
    clipboardData: { setData: (type: string, value: string): void => void written.set(type, value) },
  } as unknown as ClipboardEvent, { cut });
  blockSelection.clearSelection();

  return written;
};

const paste = async (instance: TestEditor, written: Map<string, string>): Promise<void> => {
  instance.caret.setToBlock('before', 'end');
  await instance.module.paste.processDataTransfer({
    getData: (type: string) => written.get(type) ?? '',
    types: [...written.keys()],
    files: [] as unknown as FileList,
  } as unknown as DataTransfer);
  await quiet();
};

beforeEach(() => {
  vi.clearAllMocks();
  holder = document.createElement('div');
  document.body.appendChild(holder);
});

afterEach(() => {
  vi.restoreAllMocks();
  editor?.destroy();
  editor = undefined;
  holder?.remove();
  holder = undefined;
});

describe('copying a database whose row page tabs link databases', () => {
  it('Duplicate: the copy\'s tab views the copy, an outside link stays, the original is untouched', async () => {
    const instance = await make(tabbedDoc());

    await instance.module.dragManager.duplicateBlocksInPlace(blockOf(instance, 'db'));
    await quiet();

    const blocks = (await instance.save()).blocks;
    const copy = copyId(blocks);

    expect(copy).toBeDefined();
    expect(tabSources(blocks, copy ?? '')).toEqual({ Self: copy, Other: 'ext' });
    expect(tabSources(blocks, 'db')).toEqual({ Self: 'db', Other: 'ext' });
  });

  it('Duplicate: a linked view placed before its source follows the copied source', async () => {
    const instance = await make([
      { id: 'tg', type: 'toggle', data: { text: 'Group' }, content: ['lv', 'x'] },
      linked('lv', 'tg', 'x'),
      { id: 'x', type: 'database', parent: 'tg', data: { schema: [TITLE], views: [{ ...VIEW, id: 'xv' }], activeViewId: 'xv' }, content: ['x1'] },
      { id: 'x1', type: 'database-row', parent: 'x', data: { properties: { t: 'X' }, position: 'a0' } },
    ]);

    await instance.module.dragManager.duplicateBlocksInPlace(blockOf(instance, 'tg'));
    await quiet();

    const blocks = (await instance.save()).blocks;
    const toggleCopy = blocks.find((block) => block.type === 'toggle' && block.id !== 'tg');
    const childrenOfCopy = blocks.filter((block) => block.parent === toggleCopy?.id);
    const sourceCopy = childrenOfCopy.find((block) => block.type === 'database' && (block.data as { source?: unknown }).source === undefined);
    const viewCopy = childrenOfCopy.find((block) => block.type === 'database' && (block.data as { source?: unknown }).source !== undefined);

    expect(sourceCopy).toBeDefined();
    expect((viewCopy?.data as { source?: { databaseId?: unknown } }).source?.databaseId).toBe(sourceCopy?.id);
    expect((blocks.find((block) => block.id === 'lv')?.data as { source?: { databaseId?: unknown } }).source?.databaseId).toBe('x');
    // Inserted before its source existed, the copied view still shows the source's row.
    expect(holder?.querySelector(`[data-blok-id="${viewCopy?.id ?? ''}"]`)?.textContent).toContain('X');
  });

  it('copy and paste in the same document: the pasted tab views the pasted database', async () => {
    const instance = await make(tabbedDoc());

    await paste(instance, await copyDatabase(instance, false));

    const blocks = (await instance.save()).blocks;
    const copy = copyId(blocks);

    expect(copy).toBeDefined();
    expect(tabSources(blocks, copy ?? '')).toEqual({ Self: copy, Other: 'ext' });
    expect(tabSources(blocks, 'db')).toEqual({ Self: 'db', Other: 'ext' });
  });

  it('paste into an empty paragraph: the pasted database replaces it and its tab views it', async () => {
    const instance = await make([...tabbedDoc(), { id: 'empty', type: 'paragraph', data: { text: '' } }]);
    const written = await copyDatabase(instance, false);

    instance.caret.setToBlock('empty', 'end');
    await instance.module.paste.processDataTransfer({
      getData: (type: string) => written.get(type) ?? '',
      types: [...written.keys()],
      files: [] as unknown as FileList,
    } as unknown as DataTransfer);
    await quiet();

    const blocks = (await instance.save()).blocks;
    const copy = copyId(blocks);

    expect(blocks.some((block) => block.id === 'empty')).toBe(false);
    expect(copy).toBeDefined();
    expect(tabSources(blocks, copy ?? '')).toEqual({ Self: copy, Other: 'ext' });
  });

  it('cut and paste: the pasted tab views the pasted database, not the removed one', async () => {
    const instance = await make(tabbedDoc());
    const written = await copyDatabase(instance, true);

    await instance.blocks.delete(instance.blocks.getBlockIndex('db'));
    await quiet();
    await paste(instance, written);

    const blocks = (await instance.save()).blocks;
    const copy = copyId(blocks);

    expect(blocks.some((block) => block.id === 'db')).toBe(false);
    expect(copy).toBeDefined();
    expect(tabSources(blocks, copy ?? '')).toEqual({ Self: copy, Other: 'ext' });
  });
});

/**
 * `db` names its own blocks in three more places: its Tabbed layout's tabs
 * block, a view's data source and a dashboard widget's database. `decoy` is a
 * second tabs block, first in order, as a peer's duplicate leaves it before
 * the merge: only `pageLayoutTabsId` tells the row page to show `lt`.
 */
const refsDoc = (): OutputBlockData[] => [
  { id: 'before', type: 'paragraph', data: { text: 'Before' } },
  {
    id: 'db',
    type: 'database',
    data: {
      schema: [{ ...TITLE, pageLayoutStructure: 'tabbed', pageLayoutTabsId: 'lt' }],
      views: [
        VIEW,
        { ...VIEW, id: 'vself', name: 'Self', position: 'a1', dataSourceId: 'db' },
        { ...VIEW, id: 'vext', name: 'Ext', position: 'a2', dataSourceId: 'ext' },
        {
          ...VIEW,
          id: 'dash',
          name: 'Dash',
          type: 'dashboard',
          position: 'a3',
          dashboard: { rows: [{ id: 'row', widgets: [
            { id: 'wself', viewId: 'v', databaseId: 'db', width: 4 },
            { id: 'wext', viewId: 'ev', databaseId: 'ext', width: 4 },
            { id: 'wown', viewId: 'v', width: 4 },
          ] }] },
        },
      ],
      activeViewId: 'v',
    },
    content: ['r1', 'decoy', 'lt'],
  },
  { id: 'r1', type: 'database-row', parent: 'db', data: { properties: { t: 'One' }, position: 'a0' } },
  { id: 'decoy', type: 'tabs', parent: 'db', data: {}, content: ['dc', 'dd'] },
  { id: 'dc', type: 'tab', parent: 'decoy', data: { title: '' } },
  { id: 'dd', type: 'tab', parent: 'decoy', data: { title: 'Decoy' }, content: ['ldecoy'] },
  linked('ldecoy', 'dd', 'ext'),
  { id: 'lt', type: 'tabs', parent: 'db', data: {}, content: ['tc', 'tself'] },
  { id: 'tc', type: 'tab', parent: 'lt', data: { title: '' } },
  { id: 'tself', type: 'tab', parent: 'lt', data: { title: 'Self' }, content: ['lself'] },
  linked('lself', 'tself', 'db'),
  { id: 'ext', type: 'database', data: { schema: [TITLE], views: [{ ...VIEW, id: 'ev' }], activeViewId: 'ev' }, content: ['e1'] },
  { id: 'e1', type: 'database-row', parent: 'ext', data: { properties: { t: 'Ext' }, position: 'a0' } },
];

interface DatabaseRefs {
  tabsId: unknown;
  /** The id of the copied `lt`: the tabs child whose tabs hold "Self". */
  ownTabs: string | undefined;
  dataSources: Record<string, unknown>;
  widgets: Record<string, unknown>;
}

const refsOf = (blocks: OutputBlockData[], databaseId: string): DatabaseRefs => {
  const data = blocks.find((block) => block.id === databaseId)?.data as {
    schema: Array<Record<string, unknown>>;
    views: Array<{ id: string; name: string; type: string; dataSourceId?: unknown; dashboard?: { rows: Array<{ widgets: Array<{ id: string; databaseId?: unknown }> }> } }>;
  };
  const selfTab = blocks.find((block) => block.type === 'tab' && block.data.title === 'Self'
    && blocks.find((tabs) => tabs.id === block.parent)?.parent === databaseId);

  return {
    tabsId: data.schema.find((property) => property.type === 'title')?.pageLayoutTabsId,
    ownTabs: selfTab?.parent,
    dataSources: Object.fromEntries(data.views.filter((view) => view.type !== 'dashboard').map((view) => [view.name, view.dataSourceId])),
    widgets: Object.fromEntries(data.views.flatMap((view) => view.dashboard?.rows ?? [])
      .flatMap((row) => row.widgets).map((widget) => [widget.id, widget.databaseId])),
  };
};

/** Tab names on the row page of `rowId` in database `databaseId`. */
const rowPageTabs = async (databaseId: string, rowId: string): Promise<string[]> => {
  holder?.querySelector(`[data-blok-id="${databaseId}"] [data-row-id="${rowId}"] [data-blok-database-table-open]`)
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await quiet();

  return [...(holder?.querySelectorAll('[data-blok-database-drawer] [data-blok-database-drawer-tabs] [role="tab"]') ?? [])]
    .map((tab) => tab.textContent?.trim() ?? '');
};

const expectCopyRefs = async (blocks: OutputBlockData[], cutFrom?: string): Promise<void> => {
  const copy = copyId(blocks);

  expect(copy).toBeDefined();
  const refs = refsOf(blocks, copy ?? '');

  expect(refs.ownTabs).toBeDefined();
  expect(refs.ownTabs).not.toBe('lt');
  // The Tabbed layout names the copy's own tabs block, so the merge gate
  // (`pageLayoutTabsId === layoutTabsBlock().id`) holds for the copy.
  expect.soft(refs.tabsId).toBe(refs.ownTabs);
  expect.soft(refs.dataSources).toEqual({ Table: undefined, Self: copy, Ext: 'ext' });
  expect.soft(refs.widgets).toEqual({ wself: copy, wext: 'ext', wown: undefined });

  if (cutFrom === undefined) {
    expect(refsOf(blocks, 'db')).toEqual({
      tabsId: 'lt',
      ownTabs: 'lt',
      dataSources: { Table: undefined, Self: 'db', Ext: 'ext' },
      widgets: { wself: 'db', wext: 'ext', wown: undefined },
    });
  }

  const row = blocks.find((block) => block.type === 'database-row' && block.parent === copy)?.id ?? '';

  // The row page reads the named tabs block, not the first one.
  expect.soft(await rowPageTabs(copy ?? '', row)).toEqual(['Content', 'Self']);
};

describe('copying a database that names its own blocks', () => {
  it('the original row page shows the named tabs block, not the first one', async () => {
    await make(refsDoc());

    expect(await rowPageTabs('db', 'r1')).toEqual(['Content', 'Self']);
  });

  it('Duplicate: the copy names its own tabs block, data source and widget database', async () => {
    const instance = await make(refsDoc());

    await instance.module.dragManager.duplicateBlocksInPlace(blockOf(instance, 'db'));
    await quiet();

    await expectCopyRefs((await instance.save()).blocks);
  });

  it('copy and paste: the pasted database names its own tabs block, data source and widget database', async () => {
    const instance = await make(refsDoc());

    await paste(instance, await copyDatabase(instance, false));

    await expectCopyRefs((await instance.save()).blocks);
  });

  it('cut and paste: the pasted database names its own tabs block, not the removed one', async () => {
    const instance = await make(refsDoc());
    const written = await copyDatabase(instance, true);

    await instance.blocks.delete(instance.blocks.getBlockIndex('db'));
    await quiet();
    await paste(instance, written);

    const blocks = (await instance.save()).blocks;

    expect(blocks.some((block) => block.id === 'db')).toBe(false);
    await expectCopyRefs(blocks, 'db');
  });
});

describe('pasting a table cell database that a copied database names', () => {
  // Cells insert first, without a minted id: remapIds re-points the view to the cell's new id.
  it('the pasted view source names the pasted cell database, which exists', async () => {
    const instance = await make([
      { id: 'before', type: 'paragraph', data: { text: 'Before' } },
      { id: 'tb', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['cdb'] }]] }, content: ['cdb'] },
      { id: 'cdb', type: 'database', parent: 'tb', data: { schema: [TITLE], views: [{ ...VIEW, id: 'cv' }], activeViewId: 'cv' }, content: ['c1'] },
      { id: 'c1', type: 'database-row', parent: 'cdb', data: { properties: { t: 'Cell' }, position: 'a0' } },
      { id: 'host', type: 'database', data: { schema: [TITLE], views: [{ ...VIEW, dataSourceId: 'cdb' }], activeViewId: 'v' } },
    ]);
    const written = new Map<string, string>();
    const { blockSelection } = instance.module;

    blockSelection.selectBlock(blockOf(instance, 'tb'));
    blockSelection.selectBlock(blockOf(instance, 'host'));
    await blockSelection.copySelectedBlocks({
      preventDefault: () => undefined,
      clipboardData: { setData: (type: string, value: string): void => void written.set(type, value) },
    } as unknown as ClipboardEvent, { cut: false });
    blockSelection.clearSelection();
    await paste(instance, written);

    const blocks = (await instance.save()).blocks;
    const hostCopy = blocks.find((block) => block.type === 'database' && block.parent === undefined && block.id !== 'host');
    const named = (hostCopy?.data as { views?: Array<{ dataSourceId?: unknown }> } | undefined)?.views?.[0]?.dataSourceId;
    const cellCopy = blocks.find((block) => block.type === 'database' && block.id !== 'cdb' && block.parent !== undefined
      && blocks.find((table) => table.id === block.parent)?.type === 'table');

    expect(cellCopy).toBeDefined();
    expect(named).toBe(cellCopy?.id);
  });
});
