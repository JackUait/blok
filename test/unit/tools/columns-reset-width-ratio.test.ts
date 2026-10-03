import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../src/blok';
import { Paragraph } from '../../../src/tools/paragraph';
import { ColumnList } from '../../../src/tools/column-list';
import { Column } from '../../../src/tools/column';
import { addColumnToList } from '../../../src/tools/column-drop';
import type { API, OutputBlockData, OutputData } from '../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  module: {
    yjsManager: {
      stopCapturing: () => void;
      getBlockDataObject: (id: string) => Record<string, unknown> | undefined;
    };
  };
}

const frames = async (count: number): Promise<void> => {
  for (let i = 0; i < count; i++) {
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  }
};

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;

const ROW = (leftData: Record<string, unknown>): OutputBlockData[] => [
  { id: 'row', type: 'column_list', data: {}, content: ['left', 'right'] },
  { id: 'left', type: 'column', data: leftData, parent: 'row', content: ['a'] },
  { id: 'right', type: 'column', data: {}, parent: 'row', content: ['b'] },
  { id: 'a', type: 'paragraph', data: { text: 'a' }, parent: 'left' },
  { id: 'b', type: 'paragraph', data: { text: 'b' }, parent: 'right' },
  { id: 'src', type: 'paragraph', data: { text: 'src' } },
];

const boot = async (blocks: OutputBlockData[]): Promise<TestEditor> => {
  const instance = new Blok({
    holder,
    tools: { paragraph: Paragraph, column_list: ColumnList, column: Column },
    data: { blocks },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;
  await new Promise(resolve => setTimeout(resolve, 0));
  await frames(3);
  instance.module.yjsManager.stopCapturing();

  return instance;
};

const savedData = async (instance: TestEditor, id: string): Promise<Record<string, unknown> | undefined> =>
  (await instance.save()).blocks.find(block => block.id === id)?.data;

describe('adding a column re-splits the row evenly in the shared document', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    holder = document.createElement('div');
    document.body.appendChild(holder);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      { left: 100, right: 400, top: 0, bottom: 100, width: 300, height: 100, x: 100, y: 0, toJSON: () => ({}) }
    );
  });

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
    holder?.remove();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('removes a loaded widthRatio from the shared document', async () => {
    const instance = await boot(ROW({ widthRatio: 0.7 }));
    const yjs = instance.module.yjsManager;

    expect(yjs.getBlockDataObject('left')).toHaveProperty('widthRatio', 0.7);

    expect(addColumnToList(instance as unknown as API, 'right', ['src'], 'right')).not.toBeNull();

    await vi.waitFor(() => expect(yjs.getBlockDataObject('left')).not.toHaveProperty('widthRatio'));
    expect(await savedData(instance, 'left')).not.toHaveProperty('widthRatio');
  });

  it('removes a widthRatio a resize in this session wrote', async () => {
    const instance = await boot(ROW({}));
    const yjs = instance.module.yjsManager;
    const resizer = holder?.querySelector('[data-blok-testid="column-resizer"]');

    if (!(resizer instanceof HTMLElement)) {
      throw new Error('no column resizer');
    }
    resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await vi.waitFor(() => expect(yjs.getBlockDataObject('left')).toHaveProperty('widthRatio'));

    expect(addColumnToList(instance as unknown as API, 'right', ['src'], 'right')).not.toBeNull();

    await vi.waitFor(() => expect(yjs.getBlockDataObject('left')).not.toHaveProperty('widthRatio'));
    await vi.waitFor(() => expect(yjs.getBlockDataObject('right')).not.toHaveProperty('widthRatio'));
    expect(await savedData(instance, 'left')).not.toHaveProperty('widthRatio');
  });
});
