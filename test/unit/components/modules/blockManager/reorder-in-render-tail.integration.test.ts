/**
 * A local reorder made while the first render's atomic window still waits for
 * its animation frame. That tail keeps `isSyncingFromYjs` true, but nothing is
 * replaying the doc, so the parent's contentIds must still follow the move.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../../src/blok';
import type { Block } from '../../../../../src/components/block';
import { validateTreeOrder } from '../../../../../src/components/utils/hierarchy-invariant';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { ToggleItem } from '../../../../../src/tools/toggle';
import type { API, OutputBlockData } from '../../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  destroy: () => void;
  blocks: API['blocks'];
  module: {
    blockManager: {
      blocks: Block[];
      currentBlockIndex: number;
      isSyncingFromYjs: boolean;
      moveCurrentBlockDown: () => void;
    };
  };
}

const P = (id: string, parent: string): OutputBlockData => ({ id, type: 'paragraph', data: { text: id }, parent });

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;
let heldFrames: FrameRequestCallback[] = [];

/** Boots with every animation frame held, so the render's RAF tail stays open. */
const bootWithFramesHeld = async (): Promise<TestEditor> => {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    heldFrames.push(callback);

    return heldFrames.length;
  });

  const instance = new Blok({
    holder,
    dataModel: 'hierarchical',
    tools: { paragraph: Paragraph, toggle: ToggleItem },
    data: {
      blocks: [
        { id: 't', type: 'toggle', data: { text: 't', isOpen: true }, content: ['c1', 'c2', 'c3'] },
        P('c1', 't'),
        P('c2', 't'),
        P('c3', 't'),
        { id: 'z', type: 'paragraph', data: { text: 'z' } },
      ],
    },
  }) as unknown as TestEditor;

  editor = instance;
  await instance.isReady;

  return instance;
};

describe('a same-parent reorder inside the first render\'s frame tail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    heldFrames = [];
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    heldFrames.forEach(callback => callback(performance.now()));
    editor?.destroy();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    vi.unstubAllEnvs();
  });

  it('keyboard move down of the first child keeps contentIds in the new order', async () => {
    const instance = await bootWithFramesHeld();

    expect(instance.module.blockManager.isSyncingFromYjs).toBe(true);

    instance.module.blockManager.currentBlockIndex = 1;
    instance.module.blockManager.moveCurrentBlockDown();

    expect(instance.blocks.getById('t')?.contentIds).toEqual(['c2', 'c1', 'c3']);
    expect(validateTreeOrder(instance.module.blockManager.blocks).map(drift => drift.message)).toEqual([]);
  }, 30_000);

  it('blocks.moveTo the start of the same parent keeps contentIds in the new order', async () => {
    const instance = await bootWithFramesHeld();

    instance.blocks.moveTo('c3', { parentId: 't', position: 'start' });

    expect(instance.blocks.getById('t')?.contentIds).toEqual(['c3', 'c1', 'c2']);
    expect(validateTreeOrder(instance.module.blockManager.blocks).map(drift => drift.message)).toEqual([]);
  }, 30_000);
});
