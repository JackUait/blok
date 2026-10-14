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
