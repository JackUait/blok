// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { Blok } from '../../../../../src/blok';
import type { Core } from '../../../../../src/components/core';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import { Paragraph, Table, Toggle } from '../../../../../src/tools';
import type { API, OutputData } from '../../../../../types';

class BootedEditor extends Blok {
  public moduleGraph: BlokModules | undefined;

  public override exportAPI(core: Core): void {
    this.moduleGraph = core.moduleInstances;
    super.exportAPI(core);
  }
}

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  save: () => Promise<OutputData>;
  blocks: API['blocks'];
  moduleGraph: BlokModules | undefined;
}

const editors: TestEditor[] = [];

const bootWith = async (blocks: OutputData['blocks']): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new BootedEditor({
    holder,
    data: { blocks },
    tools: { paragraph: { class: Paragraph }, table: { class: Table }, toggle: { class: Toggle } },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

const boot = (leading: OutputData['blocks'] = []): Promise<TestEditor> => bootWith([
  ...leading,
  { id: 't', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['a'] }]] }, content: ['a'] },
  { id: 'a', type: 'paragraph', data: { text: 'one' }, parent: 't' },
  { id: 'z', type: 'paragraph', data: { text: 'after' } },
]);

const contentIdsOf = (editor: TestEditor, id: string): Y.Array<string> => {
  const order: unknown = editor.moduleGraph?.YjsManager.getBlockById(id)?.get('contentIds');

  if (!(order instanceof Y.Array)) {
    throw new Error(`block ${id} has no contentIds array`);
  }

  return order as Y.Array<string>;
};

const cells = (count: number, prefix: string): OutputData['blocks'] =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}`, type: 'paragraph', data: { text: '' }, parent: 't' }));

describe('blocks.insertMany under a table', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
    vi.restoreAllMocks();
  });

  it('writes the new children after the table\'s existing children, in batch order', async () => {
    const editor = await boot();
    const end = (editor.blocks.getBlockIndex('a') ?? -1) + 1;

    editor.blocks.insertMany(cells(3, 'n'), end);

    expect(contentIdsOf(editor, 't').toArray()).toEqual(['a', 'n0', 'n1', 'n2']);
    expect(['t', 'a', 'n0', 'n1', 'n2', 'z'].map(id => editor.blocks.getBlockIndex(id))).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('reads the table\'s order once per batch, not once per new child', async () => {
    const readsFor = async (count: number): Promise<number> => {
      const editor = await boot();
      const end = (editor.blocks.getBlockIndex('a') ?? -1) + 1;
      const order = contentIdsOf(editor, 't');
      const original = Y.Array.prototype.toArray;
      const reads = { count: 0 };

      vi.spyOn(Y.Array.prototype, 'toArray').mockImplementation(function (this: Y.Array<unknown>) {
        if (this === order) {
          reads.count++;
        }

        const items: unknown[] = original.call(this);

        return items;
      });

      editor.blocks.insertMany(cells(count, 'n'), end);
      vi.restoreAllMocks();

      return reads.count;
    };

    const few = await readsFor(2);
    const many = await readsFor(40);

    expect(many).toBe(few);
  });
  it('puts a batch inserted right after the table first, inside the table', async () => {
    const editor = await boot();
    const table = editor.moduleGraph?.BlockManager.getBlockById('t');

    editor.blocks.insertMany(cells(2, 'n'), 1);

    expect(contentIdsOf(editor, 't').toArray()).toEqual(['n0', 'n1', 'a']);
    expect(table?.contentIds).toEqual(['n0', 'n1', 'a']);
    expect(['n0', 'n1'].map(id => table?.holder.contains(editor.moduleGraph?.BlockManager.getBlockById(id)?.holder ?? null))).toEqual([true, true]);
  });

  it('writes the table\'s child list once per batch, not once per new child', async () => {
    const writesFor = async (count: number): Promise<number> => {
      const editor = await boot();
      const end = (editor.blocks.getBlockIndex('a') ?? -1) + 1;
      const table = editor.moduleGraph?.BlockManager.getBlockById('t');

      if (table === undefined) {
        throw new Error('no table');
      }

      const state = { ids: table.contentIds, writes: 0 };

      Object.defineProperty(table, 'contentIds', {
        configurable: true,
        get: () => state.ids,
        set: (ids: string[]) => {
          state.writes++;
          state.ids = ids;
        },
      });

      editor.blocks.insertMany(cells(count, 'n'), end);

      return state.writes;
    };

    expect(await writesFor(30)).toBe(await writesFor(2));
  });
});
