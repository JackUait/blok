import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blok } from '../../../../../src/blok';
import { BlockManager } from '../../../../../src/components/modules/blockManager/blockManager';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { API, OutputData } from '../../../../../types';
import { htmlOf } from '../../../helpers/saved-as-html';

class TestEditor extends Blok {
  declare public readonly blocks: API['blocks'];
  declare public save: () => Promise<OutputData>;
}

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;
let releases: Array<() => void> = [];

const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};

// API gestures end in a later task, not just a microtask.
const settle = async (): Promise<void> => {
  await flush();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await flush();
};

const deferred = (): { promise: Promise<void>; release: () => void } => {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  releases.push(release);

  return { promise, release };
};

const boot = async (): Promise<{
  instance: TestEditor;
  blockManager: BlockManager;
  yjs: YjsManager;
}> => {
  const preparation = vi.spyOn(BlockManager.prototype, 'prepare');
  const wiring = vi.spyOn(YjsManager.prototype, 'state', 'set');
  const instance = new TestEditor({
    holder,
    tools: { paragraph: Paragraph },
    data: {
      blocks: [
        { id: 'a', type: 'paragraph', data: { text: 'A' } },
        { id: 'b', type: 'paragraph', data: { text: 'B' } },
      ],
    },
  });

  editor = instance;
  await instance.isReady;
  await settle();

  const blockManager = preparation.mock.contexts[0];
  const yjs = wiring.mock.contexts[0];

  if (blockManager instanceof BlockManager && yjs instanceof YjsManager) {
    await vi.waitFor(() => {
      expect(blockManager.isSyncingFromYjs).toBe(false);
    });
    return { instance, blockManager, yjs };
  }

  throw new Error('The editor did not wire its real modules');
};

const group = async (
  blockManager: BlockManager,
  yjs: YjsManager,
  operation: () => void
): Promise<void> => {
  yjs.beginApiCall();
  blockManager.beginToolTransaction();

  try {
    operation();
  } finally {
    blockManager.endToolTransaction();
  }
  await settle();
};

const saved = async (instance: TestEditor) =>
  (await instance.save()).blocks.map((block) => ({
    id: block.id,
    parentId: block.parent ?? null,
    text: htmlOf(block.data.text),
  }));

const initial = [
  { id: 'a', parentId: null, text: 'A' },
  { id: 'b', parentId: null, text: 'B' },
];
const inserted = [
  ...initial,
  { id: 'c', parentId: null, text: 'C' },
];
const tag = { actorId: 'agent-1', sessionId: 'session-1' };

describe('undo step tags and group closure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    releases = [];
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    for (const release of releases) {
      release();
    }
    await flush();
    editor?.destroy();
    await flush();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    releases = [];
    vi.restoreAllMocks();
  });

  it('keeps a defined edit token and its tag through undo, redo and undo', async () => {
    const { instance, blockManager, yjs } = await boot();

    await group(blockManager, yjs, () => {
      instance.blocks.insert('paragraph', { text: 'C' }, undefined, 2, false, false, 'c');
    });
    const token = yjs.topUndoToken();

    expect(token).toBeDefined();
    if (token === undefined) {
      throw new Error('The edit has no undo token');
    }
    yjs.tagTopUndoStep(tag);
    expect(yjs.undoStepTag(token)).toEqual(tag);
    expect(await saved(instance)).toEqual(inserted);

    yjs.undo();
    await settle();

    expect(yjs.topRedoToken()).toBe(token);
    expect(yjs.undoStepTag(yjs.topRedoToken())).toEqual(tag);
    expect(await saved(instance)).toEqual(initial);
    expect(yjs.topUndoToken()).toBeUndefined();
    expect(yjs.canUndo()).toBe(false);

    yjs.redo();
    await settle();

    expect(yjs.topUndoToken()).toBe(token);
    expect(yjs.undoStepTag(yjs.topUndoToken())).toEqual(tag);
    expect(await saved(instance)).toEqual(inserted);
    expect(yjs.topRedoToken()).toBeUndefined();

    yjs.undo();
    await settle();

    expect(yjs.topRedoToken()).toBe(token);
    expect(yjs.undoStepTag(yjs.topRedoToken())).toEqual(tag);
    expect(await saved(instance)).toEqual(initial);
    expect(yjs.canUndo()).toBe(false);
  });

  it('gives a move-only step its own defined token and preserves it on replay', async () => {
    const { instance, blockManager, yjs } = await boot();

    await group(blockManager, yjs, () => {
      instance.blocks.insert('paragraph', { text: 'C' }, undefined, 2, false, false, 'c');
    });
    const previous = yjs.topUndoToken();

    expect(previous).toBeDefined();
    if (previous === undefined) {
      throw new Error('The preceding edit has no undo token');
    }
    await group(blockManager, yjs, () => {
      instance.blocks.moveTo('b', { position: 'start' });
    });
    const token = yjs.topUndoToken();

    expect(token).toBeDefined();
    if (token === undefined) {
      throw new Error('The move has no undo token');
    }
    expect(token).not.toBe(previous);
    yjs.tagTopUndoStep(tag);
    expect(yjs.undoStepTag(token)).toEqual(tag);
    expect(yjs.undoStepTag(previous)).toBeUndefined();
    const moved = [
      { id: 'b', parentId: null, text: 'B' },
      { id: 'a', parentId: null, text: 'A' },
      { id: 'c', parentId: null, text: 'C' },
    ];

    expect(await saved(instance)).toEqual(moved);

    yjs.undo();
    await settle();

    expect(yjs.topRedoToken()).toBe(token);
    expect(yjs.undoStepTag(yjs.topRedoToken())).toEqual(tag);
    expect(await saved(instance)).toEqual(inserted);
    expect(yjs.topUndoToken()).toBe(previous);

    yjs.redo();
    await settle();

    expect(yjs.topUndoToken()).toBe(token);
    expect(yjs.undoStepTag(yjs.topUndoToken())).toEqual(tag);
    expect(await saved(instance)).toEqual(moved);

    yjs.undo();
    await settle();

    expect(yjs.topRedoToken()).toBe(token);
    expect(yjs.undoStepTag(yjs.topRedoToken())).toEqual(tag);
    expect(await saved(instance)).toEqual(inserted);
    expect(yjs.topUndoToken()).toBe(previous);

    yjs.undo();
    await settle();

    expect(await saved(instance)).toEqual(initial);
    expect(yjs.canUndo()).toBe(false);
    expect(yjs.topUndoToken()).toBeUndefined();
  });

  it('does not create a step or retain a tag when history is empty', async () => {
    const { instance, blockManager, yjs } = await boot();

    yjs.tagTopUndoStep(tag);

    expect(yjs.topUndoToken()).toBeUndefined();
    expect(yjs.topRedoToken()).toBeUndefined();
    expect(yjs.undoStepTag(undefined)).toBeUndefined();
    expect(yjs.canUndo()).toBe(false);
    expect(yjs.canRedo()).toBe(false);
    expect(await saved(instance)).toEqual(initial);

    await group(blockManager, yjs, () => {
      instance.blocks.insert('paragraph', { text: 'C' }, undefined, 2, false, false, 'c');
    });
    const token = yjs.topUndoToken();

    expect(token).toBeDefined();
    if (token === undefined) {
      throw new Error('The later edit has no undo token');
    }
    expect(yjs.undoStepTag(token)).toBeUndefined();
  });

  it('increments for a gesture but not for undo or redo', async () => {
    const { instance, blockManager, yjs } = await boot();

    await group(blockManager, yjs, () => {
      instance.blocks.insert('paragraph', { text: 'C' }, undefined, 2, false, false, 'c');
    });
    const before = yjs.gestureCount();

    yjs.beginGesture('discrete');

    expect(yjs.gestureCount()).toBe(before + 1);
    yjs.undo();
    await settle();

    expect(yjs.gestureCount()).toBe(before + 1);
    expect(await saved(instance)).toEqual(initial);
    yjs.redo();
    await settle();

    expect(yjs.gestureCount()).toBe(before + 1);
    expect(await saved(instance)).toEqual(inserted);
    yjs.undo();
    await settle();

    expect(yjs.gestureCount()).toBe(before + 1);
    expect(await saved(instance)).toEqual(initial);
  });

  it('queues the inner callback until the outer group really closes', async () => {
    const { blockManager } = await boot();
    const states: boolean[] = [];
    const inner = vi.fn(() => {
      states.push(blockManager.suppressStopCapturing);
    });
    const outer = vi.fn(() => {
      states.push(blockManager.suppressStopCapturing);
    });

    blockManager.beginToolTransaction();
    blockManager.beginToolTransaction();
    blockManager.endToolTransaction(inner);
    await settle();

    expect(inner).not.toHaveBeenCalled();
    expect(blockManager.suppressStopCapturing).toBe(true);

    blockManager.endToolTransaction(outer);
    await settle();

    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).toHaveBeenCalledTimes(1);
    expect(states).toEqual([false, false]);
    expect(blockManager.suppressStopCapturing).toBe(false);
    await settle();
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('runs queued callbacks once after the last real save and parent sync settle', async () => {
    const { blockManager, yjs } = await boot();
    const parent = blockManager.getBlockById('a');
    const child = blockManager.getBlockById('b');

    if (parent === undefined || child === undefined) {
      throw new Error('The parent-sync fixture is missing a block');
    }
    child.pluginsContent.setAttribute('contenteditable', 'true');
    const input = child.firstInput;

    if (input === undefined) {
      throw new Error('The paragraph is missing its editable input');
    }

    const parentGate = deferred();
    const childGate = deferred();
    const saveParent = parent.save.bind(parent);
    const saveChild = child.save.bind(child);
    const parentSave = vi.spyOn(parent, 'save').mockImplementation(async () => {
      await parentGate.promise;

      return saveParent();
    });
    const childSave = vi.spyOn(child, 'save').mockImplementation(async () => {
      await childGate.promise;

      return saveChild();
    });
    const observed: Array<{ parentId: string | null; text: unknown }> = [];
    const observe = (): void => {
      const block = yjs.toJSON().find((candidate) => candidate.id === 'b');

      observed.push({
        parentId: block?.parent ?? null,
        text: block === undefined ? undefined : htmlOf(block.data.text, { allowHtml: true }),
      });
    };
    const inner = vi.fn(observe);
    const outer = vi.fn(observe);

    yjs.beginApiCall();
    blockManager.beginToolTransaction();
    blockManager.beginToolTransaction();
    input.textContent = 'updated B';
    child.dispatchChange();
    blockManager.setBlockParent(child, 'a');
    blockManager.endToolTransaction(inner);
    blockManager.endToolTransaction(outer);
    await settle();

    expect(inner).not.toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
    expect(parentSave).toHaveBeenCalled();
    expect(childSave).toHaveBeenCalled();

    parentGate.release();
    await settle();

    expect(inner).not.toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
    expect(blockManager.suppressStopCapturing).toBe(true);

    childGate.release();
    await settle();

    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).toHaveBeenCalledTimes(1);
    expect(observed).toEqual([
      { parentId: 'a', text: 'updated B' },
      { parentId: 'a', text: 'updated B' },
    ]);
    expect(blockManager.suppressStopCapturing).toBe(false);
    await settle();
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).toHaveBeenCalledTimes(1);
  });
});
