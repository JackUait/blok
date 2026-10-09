import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { Paragraph } from '../../../../src/tools/paragraph';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import type { API, OutputBlockData, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: API['blocks'];
  history: { undo: () => void; redo: () => void };
  module: { yjsManager: { toJSON: () => OutputBlockData[] } };
}

const settle = (): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, 0);
});

const quiet = async (): Promise<void> => {
  await settle();
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined));
    });
  }
  await settle();
};

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

describe('database inserted with the toolbox table seed', () => {
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

  it('starts with a table view and keeps the seed key out of the shared document', async () => {
    editor = new Blok({
      holder,
      dataModel: 'hierarchical',
      tools: { paragraph: Paragraph, database: DatabaseTool, 'database-row': DatabaseRowTool },
      data: { id: 'doc', blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'hi' } }] },
    }) as unknown as TestEditor;
    await editor.isReady;
    await quiet();

    const inserted = editor.blocks.insert('database', { initialView: 'table' });

    await quiet();

    const saved = (await editor.save()).blocks.find((block) => block.id === inserted.id);
    const shared = editor.module.yjsManager.toJSON().find((block) => block.id === inserted.id);

    expect(saved?.data).not.toHaveProperty('initialView');
    expect((saved?.data as { views: Array<{ type: string }> }).views.map((view) => view.type)).toEqual(['table']);
    expect(shared?.data).not.toHaveProperty('initialView');
    expect(shared?.data).toEqual(saved?.data);

    editor.history.undo();
    await quiet();

    expect(editor.module.yjsManager.toJSON().map((block) => block.id)).toEqual(['p1']);

    editor.history.redo();
    await quiet();

    const redone = editor.module.yjsManager.toJSON().find((block) => block.id === inserted.id);

    expect(redone?.data).toEqual(saved?.data);
  });
});
