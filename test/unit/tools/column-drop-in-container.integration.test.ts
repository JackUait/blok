import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import type { Block } from '../../../src/components/block';
import { Paragraph } from '../../../src/tools/paragraph';
import { Header } from '../../../src/tools/header';
import { ColumnList } from '../../../src/tools/column-list';
import { Column } from '../../../src/tools/column';
import { ToggleItem } from '../../../src/tools/toggle';
import { CalloutTool } from '../../../src/tools/callout';
import { ListItem } from '../../../src/tools/list';
import { wrapBlocksInColumns } from '../../../src/tools/column-drop';
import { isMoveTargetValid } from '../../../src/components/modules/drag/utils/moveDestination';
import type { API, OutputBlockData, OutputData } from '../../../types';

interface DropTargetLike {
  block: Block;
  edge: string;
  parentId: string | null;
}

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  module: {
    blockManager: { blocks: Block[]; getBlockById: (id: string) => Block | undefined };
    yjsManager: { stopCapturing: () => void };
    dragManager: {
      lazyInit: () => void;
      targetDetector: {
        setSourceBlocks: (blocks: Block[]) => void;
        setDragOriginX: (x: number | null) => void;
        determineDropTarget: (el: Element, x: number, y: number, source: Block) => DropTargetLike | null;
      };
      getHierarchyDescendants: (block: Block) => Block[];
      handleColumnDrop: (source: Block, sources: Block[], target: Block, edge: 'left' | 'right', parentId: string | null) => void;
    };
  };
}

const P = (id: string, parent?: string): OutputBlockData => ({
  id, type: 'paragraph', data: { text: id }, ...(parent !== undefined ? { parent } : {}),
});
const T = (id: string, content: string[], parent?: string): OutputBlockData => ({
  id, type: 'toggle', data: { text: id, isOpen: true }, content, ...(parent !== undefined ? { parent } : {}),
});
const CALLOUT = (id: string, content: string[]): OutputBlockData => ({
  id, type: 'callout', data: { emoji: '', textColor: null, backgroundColor: null }, content,
});

const frames = async (count: number): Promise<void> => {
  for (let i = 0; i < count; i++) {
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  }
};

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: {
      paragraph: Paragraph,
      header: Header,
      column_list: ColumnList,
      column: Column,
      toggle: ToggleItem,
      callout: CalloutTool,
      list: ListItem,
    },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await new Promise(resolve => setTimeout(resolve, 0));
  await frames(3);
  instance.module.yjsManager.stopCapturing();

  return instance;
};

/**
 * Drives the real detector and drop handler, the same path a pointer drop
 * takes: the detector must offer a side drop, and the drop must honour it.
 */
const sideDrop = async (
  instance: TestEditor,
  targetId: string,
  sourceIds: string[],
  side: 'left' | 'right'
): Promise<void> => {
  const { blockManager, dragManager } = instance.module;

  dragManager.lazyInit();

  const target = blockManager.getBlockById(targetId);
  const sources = sourceIds
    .map(id => blockManager.getBlockById(id))
    .filter((block): block is Block => block !== undefined);
  const withDescendants = sources.length === 1
    ? [sources[0], ...dragManager.getHierarchyDescendants(sources[0])]
    : sources;

  if (target === undefined || sources.length === 0) {
    throw new Error('missing target or source');
  }

  dragManager.targetDetector.setSourceBlocks(withDescendants);
  dragManager.targetDetector.setDragOriginX(null);

  const content = target.holder.querySelector('[data-blok-element-content]') ?? target.holder;
  // Mocked rects put every content box at x 100..700, so these sit in the side zones.
  const x = side === 'left' ? 105 : 695;
  const dropTarget = dragManager.targetDetector.determineDropTarget(content, x, 50, sources[0]);

  expect(dropTarget?.edge).toBe(side);
  expect(dropTarget?.block.id).toBe(targetId);

  if (dropTarget === null || (dropTarget.edge !== 'left' && dropTarget.edge !== 'right')) {
    return;
  }

  expect(isMoveTargetValid(blockManager.blocks, withDescendants, dropTarget.block)).toBe(true);

  dragManager.handleColumnDrop(sources[0], withDescendants, dropTarget.block, dropTarget.edge, dropTarget.parentId);
  await frames(3);
};

const byId = (data: OutputData, id: string): OutputBlockData | undefined =>
  data.blocks.find(block => block.id === id);

/**
 * The saved shape of a two-column row created inside `containerId`: the row
 * sits where the target was, and each column holds the expected blocks.
 */
const expectRowInContainer = (
  data: OutputData,
  containerId: string,
  columns: string[][]
): void => {
  const container = byId(data, containerId);
  const list = data.blocks.find(block => block.type === 'column_list');

  expect(list?.parent).toBe(containerId);
  expect(container?.content).toContain(list?.id);

  const columnContents = (list?.content ?? []).map(columnId => byId(data, columnId)?.content ?? []);

  expect(columnContents).toEqual(columns);
};

describe('side-drop creates columns inside a container', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    holder = document.createElement('div');
    document.body.appendChild(holder);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      { left: 100, right: 700, top: 0, bottom: 100, width: 600, height: 100, x: 100, y: 0, toJSON: () => ({}) }
    );
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('a root block dropped beside a toggle child makes a row inside the toggle', async () => {
    const instance = await boot([T('tg', ['a', 'b']), P('a', 'tg'), P('b', 'tg'), P('src')]);

    await sideDrop(instance, 'a', ['src'], 'left');

    const saved = await instance.save();

    expectRowInContainer(saved, 'tg', [['src'], ['a']]);
    expect(byId(saved, 'tg')?.content?.[1]).toBe('b');
  });

  it('a toggle child dropped beside its sibling makes a row inside the toggle', async () => {
    const instance = await boot([T('tg', ['a', 'b']), P('a', 'tg'), P('b', 'tg')]);

    await sideDrop(instance, 'b', ['a'], 'right');

    expectRowInContainer(await instance.save(), 'tg', [['b'], ['a']]);
  });

  it('works for a toggle heading child', async () => {
    const instance = await boot([
      { id: 'h', type: 'header', data: { text: 'h', level: 2, isToggleable: true, isOpen: true }, content: ['a'] },
      P('a', 'h'),
      P('src'),
    ]);

    await sideDrop(instance, 'a', ['src'], 'right');

    expectRowInContainer(await instance.save(), 'h', [['a'], ['src']]);
  });

  it('works for a callout child', async () => {
    const instance = await boot([CALLOUT('co', ['a', 'b']), P('a', 'co'), P('b', 'co')]);

    await sideDrop(instance, 'b', ['a'], 'right');

    expectRowInContainer(await instance.save(), 'co', [['b'], ['a']]);
  });

  it('works for a block nested under a list item', async () => {
    const instance = await boot([
      { id: 'l1', type: 'list', data: { text: 'l1', style: 'unordered' }, content: ['a'] },
      P('a', 'l1'),
      P('src'),
    ]);

    await sideDrop(instance, 'a', ['src'], 'left');

    expectRowInContainer(await instance.save(), 'l1', [['src'], ['a']]);
  });

  it('works for a grandchild in a toggle inside a toggle', async () => {
    const instance = await boot([T('t1', ['t2']), T('t2', ['a'], 't1'), P('a', 't2'), P('src')]);

    await sideDrop(instance, 'a', ['src'], 'left');

    expectRowInContainer(await instance.save(), 't2', [['src'], ['a']]);
  });

  it('a multi-block drag beside a toggle child moves every source into the new column', async () => {
    const instance = await boot([T('tg', ['a', 'b']), P('a', 'tg'), P('b', 'tg'), P('p')]);

    await sideDrop(instance, 'b', ['a', 'p'], 'left');

    expectRowInContainer(await instance.save(), 'tg', [['a', 'p'], ['b']]);
  });

  it('mounts the row inside the toggle children slot', async () => {
    const instance = await boot([T('tg', ['a']), P('a', 'tg'), P('src')]);

    await sideDrop(instance, 'a', ['src'], 'left');

    const list = instance.module.blockManager.blocks.find(block => block.name === 'column_list');
    const toggle = instance.module.blockManager.getBlockById('tg');

    expect(list?.parentId).toBe('tg');
    expect(list?.holder.parentElement?.hasAttribute('data-blok-toggle-children')).toBe(true);
    expect(toggle?.holder.contains(list?.holder ?? null)).toBe(true);
  });
});

describe('turn into columns inside a container', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('two selected toggle children become a row inside the toggle', async () => {
    const instance = await boot([T('tg', ['a', 'b', 'c']), P('a', 'tg'), P('b', 'tg'), P('c', 'tg')]);

    const listId = wrapBlocksInColumns(instance as unknown as API, ['a', 'b']);

    expect(listId).not.toBeNull();

    const saved = await instance.save();

    expectRowInContainer(saved, 'tg', [['a'], ['b']]);
    expect(byId(saved, 'tg')?.content).toEqual([listId, 'c']);
  });

  it('refuses a selection whose blocks live in different containers instead of dropping part of it', async () => {
    const instance = await boot([P('a'), T('tg', ['x']), P('x', 'tg'), P('b')]);
    const before = await instance.save();

    expect(wrapBlocksInColumns(instance as unknown as API, ['a', 'x', 'b'])).toBeNull();
    expect((await instance.save()).blocks).toEqual(before.blocks);
  });
});
