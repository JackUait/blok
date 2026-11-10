import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Block } from '../../../../../src/components/block';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Header } from '../../../../../src/tools/header';
import { CalloutTool } from '../../../../../src/tools/callout';
import { ColumnList } from '../../../../../src/tools/column-list';
import { Column } from '../../../../../src/tools/column';
import { ToggleItem } from '../../../../../src/tools/toggle';
import { Table } from '../../../../../src/tools/table';
import { reflectContentEditable } from '../../../tools/table/data-loss/roundtrip-harness';
import type { OutputBlockData, OutputData } from '../../../../../types';

/**
 * Deleting every child of a callout leaves a callout with no place for the
 * caret, so the delete puts an empty paragraph back inside it. A container
 * with its own text (a toggle, a parent paragraph) or a layout piece keeps
 * its empty state instead.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  history: { undo: () => void };
  module: {
    yjsManager: { stopCapturing: () => void };
    blockManager: {
      blocks: Block[];
      deleteSelectedBlocksAndInsertReplacement: (force?: boolean) => Block | undefined;
      getBlockById: (id: string) => Block | undefined;
    };
  };
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const P = (id: string, text: string, parent?: string): OutputBlockData =>
  ({ id, type: 'paragraph', data: { text }, ...(parent === undefined ? {} : { parent }) });

const calloutDoc = (): OutputBlockData[] => [
  P('pre', 'Before'),
  { id: 'co', type: 'callout', data: { emoji: '', textColor: null, backgroundColor: null }, content: ['cp', 'ch'] },
  P('cp', 'Para', 'co'),
  { id: 'ch', type: 'header', data: { text: 'Head', level: 3 }, parent: 'co' },
  P('post', 'After'),
];

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, header: Header, callout: CalloutTool, column_list: ColumnList, column: Column, toggle: ToggleItem, table: Table },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;

  return instance;
};

const deleteSelected = (instance: TestEditor, ids: string[]): Block | undefined => {
  const { blockManager } = instance.module;

  for (const id of ids) {
    const found = blockManager.getBlockById(id);

    if (found === undefined) {
      throw new Error(`no block ${id}`);
    }
    found.selected = true;
  }

  return blockManager.deleteSelectedBlocksAndInsertReplacement();
};

const childrenOf = (instance: TestEditor, id: string): Block[] =>
  instance.module.blockManager.blocks.filter((live) => live.parentId === id);

// Core finds a container's own text by the contenteditable attribute.
reflectContentEditable();

beforeEach(() => {
  vi.clearAllMocks();
  holder = document.createElement('div');
  document.body.appendChild(holder);
});

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  holder?.remove();
  vi.restoreAllMocks();
});

describe('deleting every child of a callout', () => {
  it('puts one empty paragraph back inside the callout and returns it', async () => {
    const instance = await boot(calloutDoc());
    const inserted = deleteSelected(instance, ['cp', 'ch']);

    expect(inserted?.parentId).toBe('co');
    expect(inserted?.name).toBe('paragraph');
    expect(childrenOf(instance, 'co').map((child) => child.id)).toEqual([inserted?.id]);
    expect(block(instance, 'co').holder.querySelector('[data-blok-nested-blocks]')?.contains(inserted?.holder ?? null)).toBe(true);
    expect(instance.module.blockManager.blocks.map((live) => live.id)).toEqual(['pre', 'co', inserted?.id, 'post']);
  });

  it('comes back whole on one undo, without the empty paragraph', async () => {
    const instance = await boot(calloutDoc());

    instance.module.yjsManager.stopCapturing();
    deleteSelected(instance, ['cp', 'ch']);
    instance.module.yjsManager.stopCapturing();
    instance.history.undo();

    await vi.waitFor(async () => {
      expect((await instance.save()).blocks.map((saved) => [saved.id, saved.parent ?? null])).toEqual([
        ['pre', null],
        ['co', null],
        ['cp', 'co'],
        ['ch', 'co'],
        ['post', null],
      ]);
    });
  });

  it('puts the paragraph back inside a callout that sits in a table cell', async () => {
    const instance = await boot([
      { id: 't', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['co'] }]] }, content: ['co'] },
      { id: 'co', type: 'callout', parent: 't', data: { emoji: '', textColor: null, backgroundColor: null }, content: ['cp', 'cq'] },
      P('cp', 'Para', 'co'),
      P('cq', 'More', 'co'),
    ]);
    const inserted = deleteSelected(instance, ['cp', 'cq']);

    expect(inserted?.parentId).toBe('co');
    expect(childrenOf(instance, 'co').map((child) => child.id)).toEqual([inserted?.id]);
    expect(block(instance, 'co').holder.contains(inserted?.holder ?? null)).toBe(true);
  });

  it('adds nothing when the callout keeps another child', async () => {
    const instance = await boot(calloutDoc());

    expect(deleteSelected(instance, ['cp'])).toBeUndefined();
    expect(childrenOf(instance, 'co').map((child) => child.id)).toEqual(['ch']);
  });
});

describe('deleting every child of a container that keeps its empty state', () => {
  it('leaves a toggle with no children', async () => {
    const instance = await boot([
      { id: 'tg', type: 'toggle', data: { text: 'Title', isOpen: true }, content: ['t1', 't2'] },
      P('t1', 'one', 'tg'),
      P('t2', 'two', 'tg'),
      P('post', 'After'),
    ]);

    expect(deleteSelected(instance, ['t1', 't2'])).toBeUndefined();
    expect(childrenOf(instance, 'tg')).toEqual([]);
  });

  it('leaves a paragraph with no nested children', async () => {
    const instance = await boot([
      { id: 'par', type: 'paragraph', data: { text: 'Parent' }, content: ['n1', 'n2'] },
      P('n1', 'one', 'par'),
      P('n2', 'two', 'par'),
      P('post', 'After'),
    ]);

    expect(deleteSelected(instance, ['n1', 'n2'])).toBeUndefined();
    expect(childrenOf(instance, 'par')).toEqual([]);
  });

  it('lets an emptied column remove itself', async () => {
    const instance = await boot([
      { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
      { id: 'c1', type: 'column', data: {}, parent: 'cl', content: ['c1p'] },
      P('c1p', 'left', 'c1'),
      { id: 'c2', type: 'column', data: {}, parent: 'cl', content: ['c2p'] },
      P('c2p', 'right', 'c2'),
    ]);

    expect(deleteSelected(instance, ['c1p'])).toBeUndefined();
    await vi.waitFor(() => {
      expect(instance.module.blockManager.getBlockById('c1')).toBeUndefined();
    });
  });
});

function block(instance: TestEditor, id: string): Block {
  const found = instance.module.blockManager.getBlockById(id);

  if (found === undefined) {
    throw new Error(`no block ${id}`);
  }

  return found;
}
