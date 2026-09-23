import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { Table } from '../../../../../src/tools/table';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import type { OutputBlockData, OutputData } from '../../../../../types';

/**
 * A new table seeds its cell blocks in rendered(), BEFORE the table itself
 * reaches the doc. Those children find no parent in the doc, so no order slot
 * is written for them. The table's own add must then carry its children, or
 * the doc falls back to id-sorted order and a redo rebuilds the cells shuffled.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: {
    insert: (type?: string, data?: unknown, config?: unknown, index?: number) => { id: string };
  };
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;
let capturedYjs: YjsManager | undefined;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};

describe('inserting a container that seeds children in rendered()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);

    const originalFromJSON = YjsManager.prototype.fromJSON;

    vi.spyOn(YjsManager.prototype, 'fromJSON').mockImplementation(function (
      this: YjsManager,
      blocks: Parameters<YjsManager['fromJSON']>[0]
    ) {
      capturedYjs = this;

      return originalFromJSON.call(this, blocks);
    });
  });

  afterEach(async () => {
    editor?.destroy();
    await flush();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    capturedYjs = undefined;
    vi.restoreAllMocks();
  });

  it('writes the children to the doc in the order the editor holds them', async () => {
    const instance = new Blok({
      holder,
      tools: { paragraph: Paragraph, table: Table },
      data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'x' } }] },
    }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;
    await flush();

    const { id: tableId } = instance.blocks.insert('table', {}, undefined, 1);

    await flush();

    const saved = await instance.save();
    const savedTable = saved.blocks.find((block) => block.id === tableId);
    const docTable = capturedYjs?.toJSON().find((block: OutputBlockData) => block.id === tableId);

    expect(savedTable?.content?.length).toBeGreaterThan(1);
    expect(docTable?.content).toEqual(savedTable?.content);
  });
});
