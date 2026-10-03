import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../src/components/core';
import { modificationsObserverBatchTimeout } from '../../../src/components/constants';
import { Paragraph, Toggle } from '../../../src/tools';
import type * as PlatformModule from '../../../src/components/modules/tabSync/platform';
import type { BlokConfig, OutputBlockData, OutputData } from '../../../types';

// jsdom has no navigator.locks, so the browser platform would never open a session.
vi.mock('../../../src/components/modules/tabSync/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof PlatformModule>();
  const { createFakePlatform } = await import('./modules/tabSync/fakes');

  return { ...actual, browserTabPlatform: createFakePlatform() };
});

const cores: Core[] = [];

const paragraph = (id: string): OutputBlockData => ({ id, type: 'paragraph', data: { text: id } });

const document3 = (): OutputData => ({ blocks: [paragraph('a'), paragraph('b'), paragraph('c')] });

const createCore = (extra: Partial<BlokConfig>): Core => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  const core = new Core({ holder, logLevel: 'ERROR', tools: { paragraph: Paragraph, toggle: Toggle }, ...extra } as BlokConfig);

  cores.push(core);

  return core;
};

/** Same teardown as Blok.destroy() minus markDestroyed: every module, in map order. */
const destroyCore = (core: Core): void => {
  Object.values(core.moduleInstances).forEach((module) => {
    if (typeof (module as { destroy?: unknown }).destroy === 'function') {
      (module as { destroy: () => void }).destroy();
    }
  });
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const ids = (core: Core): string[] => core.moduleInstances.BlockManager.blocks.map((block) => block.id);

/** A leader with onSave and a follower, both on `documentId`, both settled. */
const twoEditors = async (documentId: string, data: OutputData = document3()): Promise<{ leader: Core; follower: Core; onSave: ReturnType<typeof vi.fn> }> => {
  const onSave = vi.fn();
  const leader = createCore({ documentId, data, onSave });

  await leader.isReady;
  await wait(50);
  const follower = createCore({ documentId, data });

  await follower.isReady;
  await wait(100);
  expect(leader.moduleInstances.TabSync.role).toBe('leader');
  expect(follower.moduleInstances.TabSync.role).toBe('follower');
  onSave.mockClear();

  return { leader, follower, onSave };
};

/** One batch window, plus room for the message hop and the serialization. */
const oneWindow = (): Promise<void> => wait(modificationsObserverBatchTimeout + 150);

describe('Core — the leader saves structural changes made in a follower', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cores.splice(0).forEach(destroyCore);
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a block moved in a follower is saved by the leader within one batch window', async () => {
    const { leader, follower, onSave } = await twoEditors('save-move');

    follower.moduleInstances.API.methods.blocks.moveTo('c', { parentId: null, position: 'start' });
    await oneWindow();

    expect(ids(leader)).toEqual(['c', 'a', 'b']);
    expect(onSave).toHaveBeenCalled();
    expect((onSave.mock.lastCall?.[0] as OutputData).blocks.map((block) => block.id)).toEqual(['c', 'a', 'b']);
  });

  it('a block deleted in a follower is saved by the leader within one batch window', async () => {
    const { leader, follower, onSave } = await twoEditors('save-delete');

    await follower.moduleInstances.API.methods.blocks.delete(1);
    await oneWindow();

    expect(ids(leader)).toEqual(['a', 'c']);
    expect(onSave).toHaveBeenCalled();
    expect((onSave.mock.lastCall?.[0] as OutputData).blocks.map((block) => block.id)).toEqual(['a', 'c']);
  });

  it('a block indented in a follower is saved by the leader within one batch window', async () => {
    const { leader, follower, onSave } = await twoEditors('save-indent');
    const { BlockManager } = follower.moduleInstances;
    const b = BlockManager.getBlockById('b');

    expect(b).toBeDefined();
    if (b === undefined) {
      return;
    }
    BlockManager.setBlockParent(b, 'a');
    await oneWindow();

    expect(leader.moduleInstances.BlockManager.getBlockById('b')?.parentId).toBe('a');
    expect(onSave).toHaveBeenCalled();
    const saved = (onSave.mock.lastCall?.[0] as OutputData).blocks.find((block) => block.id === 'b');

    expect(saved?.parent).toBe('a');
  });

  it('a block moved into a container in a follower is saved by the leader within one batch window', async () => {
    const data: OutputData = {
      blocks: [{ id: 't', type: 'toggle', data: { text: 'T' } }, paragraph('a'), paragraph('b')],
    };
    const { leader, follower, onSave } = await twoEditors('save-into', data);

    follower.moduleInstances.API.methods.blocks.moveTo('b', { parentId: 't', position: 'end' });
    await oneWindow();

    expect(leader.moduleInstances.BlockManager.getBlockById('b')?.parentId).toBe('t');
    expect(onSave).toHaveBeenCalled();
    const saved = (onSave.mock.lastCall?.[0] as OutputData).blocks.find((block) => block.id === 'b');

    expect(saved?.parent).toBe('t');
  });

  it('a follower move arms the leader close prompt and its destroy flush', async () => {
    const { leader, follower } = await twoEditors('save-destroy');
    const save = vi.spyOn(leader.moduleInstances.Saver, 'save');

    follower.moduleInstances.API.methods.blocks.moveTo('c', { parentId: null, position: 'start' });
    // The message hop only; the batch window is still open.
    await wait(20);

    expect(ids(leader)).toEqual(['c', 'a', 'b']);
    expect(leader.moduleInstances.ModificationsObserver.hasUnsavedChanges).toBe(true);
    expect(save).not.toHaveBeenCalled();

    cores.splice(cores.indexOf(leader), 1);
    destroyCore(leader);

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('a follower unmounted with typing still in its write buffer hands it to the leader', async () => {
    const { leader, follower } = await twoEditors('unmount-typing');
    const block = follower.moduleInstances.BlockManager.getBlockById('a');
    const editable = block?.pluginsContent;

    expect(editable).toBeInstanceOf(HTMLElement);
    if (!(editable instanceof HTMLElement)) {
      return;
    }
    const type = async (text: string): Promise<void> => {
      editable.textContent = text;
      editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
      // Long enough for block.save() to reach the write buffer, well short of its 400 ms flush.
      await wait(60);
    };

    // The first write lands at once; the next one waits in the buffer.
    await type('a typed');
    await type('a typed more');
    expect(leader.moduleInstances.BlockManager.getBlockById('a')?.holder.textContent).toBe('a typed');

    cores.splice(cores.indexOf(follower), 1);
    destroyCore(follower);
    await wait(50);

    expect(leader.moduleInstances.BlockManager.getBlockById('a')?.holder.textContent).toBe('a typed more');
  });
});
