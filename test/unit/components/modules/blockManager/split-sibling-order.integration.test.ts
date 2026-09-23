import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { ToggleItem } from '../../../../../src/tools/toggle';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import type { OutputData } from '../../../../../types';

/**
 * The doc always places a split's new sibling after the split block's
 * children. The editor must too, or save() differs from the doc until a
 * redo or reload rebuilds the editor from it.
 */

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: {
    splitBlock: (id: string, data: Record<string, unknown>, type: string, newData: Record<string, unknown>, index: number) => { id: string };
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

describe('splitting a block that has a child', () => {
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

  it('saves the new sibling after the child, in the order the doc holds', async () => {
    const instance = new Blok({
      holder,
      tools: { paragraph: Paragraph, toggle: ToggleItem },
      data: {
        blocks: [
          { id: 't', type: 'toggle', data: { text: 'Toggle', isOpen: true }, content: ['k1'] },
          { id: 'k1', type: 'paragraph', data: { text: 'kid' }, parent: 't' },
        ],
      },
    }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;
    await flush();

    const { id: newId } = instance.blocks.splitBlock('t', { text: 'Tog' }, 'toggle', { text: 'gle' }, 1);

    await flush();

    const saved = (await instance.save()).blocks.map((block) => block.id);
    const doc = capturedYjs?.toJSON().map((block) => block.id);

    expect(saved).toEqual(['t', 'k1', newId]);
    expect(doc).toEqual(saved);
  });
});
