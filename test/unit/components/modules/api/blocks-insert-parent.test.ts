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

/** Live entries plus tombstones: what every read of the array walks. */
const itemsIn = (order: Y.Array<string>): number => {
  let count = 0;

  for (let item = order._start; item !== null; item = item.right) {
    count++;
  }

  return count;
};

const rootOrderOf = (editor: TestEditor): Y.Array<string> => {
  const doc = editor.moduleGraph?.YjsManager.getBlockById('t')?.doc;

  if (doc === null || doc === undefined) {
    throw new Error('the editor has no document');
  }

  return doc.getArray<string>('root');
};

describe('blocks.insert with a parentId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
    vi.restoreAllMocks();
  });

  it('writes a table child straight under the table, never into the root order', async () => {
    const editor = await boot();
    const root = rootOrderOf(editor);
    const rootItems = itemsIn(root);

    const block = editor.blocks.insert('paragraph', { text: '' }, {}, 2, false, false, undefined, undefined, undefined, 't');

    expect(itemsIn(root)).toBe(rootItems);
    expect(block.parentId).toBe('t');
    expect(editor.moduleGraph?.YjsManager.getBlockById(block.id)?.get('parentId')).toBe('t');
  });

  it('keeps the block inside its parent\'s run when the index points outside it', async () => {
    const editor = await boot();
    const tableIndex = editor.blocks.getBlockIndex('t') ?? -1;
    const after = editor.blocks.getBlockIndex('z') ?? -1;

    const early = editor.blocks.insert('paragraph', { text: '' }, {}, 0, false, false, undefined, undefined, undefined, 't');
    const unplaced = editor.blocks.insert('paragraph', { text: '' }, {}, undefined, false, false, undefined, undefined, undefined, 't');

    expect(editor.blocks.getBlockIndex(early.id)).toBe(tableIndex + 1);
    expect(editor.blocks.getBlockIndex(unplaced.id)).toBe(after + 1);
    expect(editor.blocks.getBlockIndex('z')).toBe(after + 2);
  });

  it('writes a table child without walking the rest of the document', async () => {
    const docReadsForOneCell = async (paragraphs: number): Promise<number> => {
      const editor = await boot(Array.from({ length: paragraphs }, (_, i) => ({ id: `p${i}`, type: 'paragraph', data: { text: `p${i}` } })));
      const end = (editor.blocks.getBlockIndex('a') ?? -1) + 1;
      const reads = vi.spyOn(Y.Map.prototype, 'get');

      editor.blocks.insert('paragraph', { text: '' }, {}, end, false, false, undefined, undefined, undefined, 't');
      const count = reads.mock.calls.length;

      reads.mockRestore();

      return count;
    };

    const short = await docReadsForOneCell(2);
    const long = await docReadsForOneCell(300);

    expect(long).toBeLessThan(short + 50);
  });

  it('places a table child at the end without walking the table\'s other children', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `c${i}`);
    const editor = await bootWith([
      { id: 't', type: 'table', data: { withHeadings: false, content: [ids.map(id => ({ blocks: [id] }))] }, content: ids },
      ...ids.map(id => ({ id, type: 'paragraph', data: { text: id }, parent: 't' })),
      { id: 'z', type: 'paragraph', data: { text: 'after' } },
    ]);
    const middle = editor.moduleGraph?.BlockManager.getBlockById('c30');

    if (middle === undefined) {
      throw new Error('no middle cell');
    }
    const reads = { count: 0 };
    const value = { parentId: middle.parentId };

    Object.defineProperty(middle, 'parentId', {
      configurable: true,
      get: () => {
        // The dev-only invariant checks read every block; production drops them.
        if (!(new Error().stack ?? '').includes('InDev')) {
          reads.count++;
        }

        return value.parentId;
      },
      set: (next: string | null) => {
        value.parentId = next;
      },
    });

    editor.blocks.insert('paragraph', { text: '' }, {}, editor.blocks.getBlockIndex('z'), false, false, undefined, undefined, undefined, 't');

    // One read: the scan for children of the new block. A walk over the table's run reads it again.
    expect(reads.count).toBeLessThanOrEqual(1);
  });

  it('writes table children into the table in the order the editor holds them', async () => {
    const editor = await boot();
    const afterA = (editor.blocks.getBlockIndex('a') ?? -1) + 1;
    const last = editor.blocks.insert('paragraph', { text: '' }, {}, afterA, false, false, undefined, undefined, undefined, 't');
    const first = editor.blocks.insert('paragraph', { text: '' }, {}, afterA - 1, false, false, undefined, undefined, undefined, 't');
    const middle = editor.blocks.insert('paragraph', { text: '' }, {}, afterA + 1, false, false, undefined, undefined, undefined, 't');
    const contentIds = editor.moduleGraph?.YjsManager.getBlockById('t')?.get('contentIds') as Y.Array<string>;
    const flat = [first, middle, last, { id: 'a' }]
      .map(block => block.id)
      .sort((x, y) => (editor.blocks.getBlockIndex(x) ?? 0) - (editor.blocks.getBlockIndex(y) ?? 0));

    expect(contentIds.toArray()).toStrictEqual(flat);
  });

  it('keeps the document order equal to the editor order when a cell holds nested blocks', async () => {
    const editor = await bootWith([
      { id: 't', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['a'] }, { blocks: ['l'] }]] }, content: ['a', 'l'] },
      { id: 'a', type: 'paragraph', data: { text: 'one' }, parent: 't' },
      { id: 'l', type: 'toggle', data: { text: 'two' }, parent: 't', content: ['g'] },
      { id: 'g', type: 'paragraph', data: { text: 'inside' }, parent: 'l' },
      { id: 'z', type: 'paragraph', data: { text: 'after' } },
    ]);
    const yjs = editor.moduleGraph?.YjsManager;
    const editorOrder = (): string[] => Array.from({ length: editor.blocks.getBlocksCount() }, (_, i) => editor.blocks.getBlockByIndex(i)?.id ?? '');

    expect(editorOrder()).toStrictEqual(['t', 'a', 'l', 'g', 'z']);

    const afterNested = editor.blocks.insert('paragraph', { text: '' }, {}, 4, false, false, undefined, undefined, undefined, 't');
    const first = editor.blocks.insert('paragraph', { text: '' }, {}, 1, false, false, undefined, undefined, undefined, 't');
    const between = editor.blocks.insert('paragraph', { text: '' }, {}, 3, false, false, undefined, undefined, undefined, 't');

    expect(editorOrder()).toStrictEqual(['t', first.id, 'a', between.id, 'l', 'g', afterNested.id, 'z']);
    expect(yjs?.orderedIds()).toStrictEqual(editorOrder());
    expect((yjs?.getBlockById('t')?.get('contentIds') as Y.Array<string>).toArray()).toStrictEqual([first.id, 'a', between.id, 'l', afterNested.id]);
  });

  it('refuses a parentId together with replace, before writing anything', async () => {
    const editor = await boot();
    const count = editor.blocks.getBlocksCount();

    expect(() => editor.blocks.insert('paragraph', {}, {}, 1, false, true, undefined, undefined, undefined, 't')).toThrow('replace cannot be combined with parentId');
    expect(editor.blocks.getBlocksCount()).toBe(count);
  });
});
