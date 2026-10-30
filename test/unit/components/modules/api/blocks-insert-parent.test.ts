// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';

import { Blok } from '../../../../../src/blok';
import type { Core } from '../../../../../src/components/core';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import { Paragraph, Table } from '../../../../../src/tools';
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

const boot = async (): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const editor = new BootedEditor({
    holder,
    data: {
      blocks: [
        { id: 't', type: 'table', data: { withHeadings: false, content: [[{ blocks: ['a'] }]] }, content: ['a'] },
        { id: 'a', type: 'paragraph', data: { text: 'one' }, parent: 't' },
        { id: 'z', type: 'paragraph', data: { text: 'after' } },
      ],
    },
    tools: { paragraph: { class: Paragraph }, table: { class: Table } },
  }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

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

  it('refuses a parentId together with replace, before writing anything', async () => {
    const editor = await boot();
    const count = editor.blocks.getBlocksCount();

    expect(() => editor.blocks.insert('paragraph', {}, {}, 1, false, true, undefined, undefined, undefined, 't')).toThrow('replace cannot be combined with parentId');
    expect(editor.blocks.getBlocksCount()).toBe(count);
  });
});
