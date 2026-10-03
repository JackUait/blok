import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../src/components/core';
import { modificationsObserverBatchTimeout } from '../../../src/components/constants';
import { releasePersistenceQueue } from '../../../src/components/utils/persistence';
import { Paragraph, Toggle } from '../../../src/tools';
import { browserTabPlatform } from '../../../src/components/modules/tabSync/platform';
import type * as PlatformModule from '../../../src/components/modules/tabSync/platform';
import { CLAIM_SETTLE_MS } from '../../../src/components/modules/tabSync';
import type { BlokConfig, OutputBlockData, OutputData } from '../../../types';
import type { BlockMutationEvent } from '../../../types/events/block';

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
  releasePersistenceQueue(core.config.persistence);
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

  it('with an explicit documentId, a render of data without an id keeps the tab in sync', async () => {
    const { leader, follower } = await twoEditors('render-no-id');

    await follower.moduleInstances.API.methods.blocks.render({ blocks: [paragraph('x'), paragraph('y')] });
    await wait(50);
    await follower.moduleInstances.API.methods.blocks.update('y', { text: 'y edited' });
    await wait(50);

    expect(follower.moduleInstances.TabSync.role).toBe('follower');
    expect(leader.moduleInstances.BlockManager.getBlockById('y')?.holder.textContent).toBe('y edited');
  });

  it('a tab promoted with an empty document nobody changed saves nothing', async () => {
    const leader = createCore({ documentId: 'empty-boot', data: { blocks: [] } });

    await leader.isReady;
    await wait(50);
    const onSave = vi.fn();
    const follower = createCore({ documentId: 'empty-boot', data: { blocks: [] }, onSave });

    await follower.isReady;
    await wait(100);
    expect(follower.moduleInstances.TabSync.role).toBe('follower');

    cores.splice(cores.indexOf(leader), 1);
    destroyCore(leader);
    await oneWindow();

    expect(follower.moduleInstances.TabSync.role).toBe('leader');
    expect(onSave).not.toHaveBeenCalled();
  });

  /** Two writes into block `id`: the first lands at once, the second waits in the buffer. */
  const typeTwice = async (core: Core, id: string, first: string, second: string): Promise<void> => {
    const editable = core.moduleInstances.BlockManager.getBlockById(id)?.pluginsContent;

    expect(editable).toBeInstanceOf(HTMLElement);
    for (const text of [first, second]) {
      if (editable instanceof HTMLElement) {
        editable.textContent = text;
        editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
      }
      // Long enough for block.save() to reach the write buffer, well short of its 400 ms flush.
      await wait(60);
    }
  };

  const textOf = (core: Core, id: string): string | null | undefined =>
    core.moduleInstances.BlockManager.getBlockById(id)?.holder.textContent;

  it('a leader that turns read-only hands its buffered typing to the tab that takes over', async () => {
    const onSave = vi.fn();
    const leader = createCore({ documentId: 'ro-leader', data: document3() });

    await leader.isReady;
    await wait(50);
    const follower = createCore({ documentId: 'ro-leader', data: document3(), onSave });

    await follower.isReady;
    await wait(100);
    expect(follower.moduleInstances.TabSync.role).toBe('follower');

    await typeTwice(leader, 'a', 'a one', 'a one two');
    expect(textOf(follower, 'a')).toBe('a one');

    await leader.moduleInstances.ReadOnly.set(true);
    await oneWindow();

    expect(leader.moduleInstances.TabSync.role).toBe('follower');
    expect(follower.moduleInstances.TabSync.role).toBe('leader');
    expect(textOf(follower, 'a')).toBe('a one two');
    const saved = (onSave.mock.lastCall?.[0] as OutputData | undefined)?.blocks.find((block) => block.id === 'a');

    expect(saved?.data.text).toBe('a one two');
  });

  it('a follower that turns read-only still posts its buffered typing', async () => {
    const { leader, follower } = await twoEditors('ro-follower');

    await typeTwice(follower, 'a', 'a one', 'a one two');
    expect(textOf(leader, 'a')).toBe('a one');

    await follower.moduleInstances.ReadOnly.set(true);
    await wait(50);

    expect(textOf(leader, 'a')).toBe('a one two');
  });

  it('a lone leader that turns read-only saves its typing once it is editable again', async () => {
    const onSave = vi.fn();
    const leader = createCore({ documentId: 'ro-lone', data: document3(), onSave });

    await leader.isReady;
    await wait(50);
    await typeTwice(leader, 'a', 'a one', 'a one two');
    onSave.mockClear();

    await leader.moduleInstances.ReadOnly.set(true);
    await oneWindow();
    expect(onSave).not.toHaveBeenCalled();

    await leader.moduleInstances.ReadOnly.set(false);
    await oneWindow();

    expect(leader.moduleInstances.TabSync.role).toBe('leader');
    const saved = (onSave.mock.lastCall?.[0] as OutputData | undefined)?.blocks.find((block) => block.id === 'a');

    expect(saved?.data.text).toBe('a one two');
  });

  /** Whether a guard holds the tab back from closing. */
  const closePromptArmed = (): boolean => {
    const event = new Event('beforeunload', { cancelable: true });

    window.dispatchEvent(event);

    return event.defaultPrevented;
  };

  it('a lone leader that turns read-only inside the batch window keeps its edit unsaved and saves it once editable', async () => {
    const save = vi.fn(async () => undefined);
    const leader = createCore({
      documentId: 'ro-window',
      persistence: { load: async () => document3(), save },
    });

    await leader.isReady;
    await wait(50);
    expect(leader.moduleInstances.TabSync.role).toBe('leader');
    await oneWindow();
    save.mockClear();

    const editable = leader.moduleInstances.BlockManager.getBlockById('a')?.pluginsContent;

    expect(editable).toBeInstanceOf(HTMLElement);
    if (!(editable instanceof HTMLElement)) {
      return;
    }
    editable.textContent = 'a typed';
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await wait(20);
    await leader.moduleInstances.ReadOnly.set(true);

    expect(leader.moduleInstances.ModificationsObserver.hasUnsavedChanges).toBe(true);
    await oneWindow();
    expect(leader.moduleInstances.ModificationsObserver.hasUnsavedChanges).toBe(true);
    expect(closePromptArmed()).toBe(true);
    expect(save).not.toHaveBeenCalled();

    await leader.moduleInstances.ReadOnly.set(false);
    await oneWindow();

    expect(leader.moduleInstances.TabSync.role).toBe('leader');
    expect(save).toHaveBeenCalledTimes(1);
    const saved = (save.mock.lastCall as unknown as [ { blocks: OutputBlockData[] } ] | undefined)?.[0];

    expect(saved?.blocks.find((block) => block.id === 'a')?.data.text).toBe('a typed');
  });

  it('a leader that turns read-only inside the batch window has its edit saved by the tab that takes over', async () => {
    const onSave = vi.fn();
    const leader = createCore({ documentId: 'ro-window-pair', data: document3(), onSave });

    await leader.isReady;
    await wait(50);
    const follower = createCore({ documentId: 'ro-window-pair', data: document3(), onSave });

    await follower.isReady;
    await wait(100);
    onSave.mockClear();

    await leader.moduleInstances.API.methods.blocks.update('a', { text: 'a edited' });
    await leader.moduleInstances.ReadOnly.set(true);
    await oneWindow();

    expect(follower.moduleInstances.TabSync.role).toBe('leader');
    const saved = (onSave.mock.lastCall?.[0] as OutputData | undefined)?.blocks.find((block) => block.id === 'a');

    expect(saved?.data.text).toBe('a edited');
  });

  it('the leader gets onChange for a follower text edit within a frame, not a batch window', async () => {
    const onChange = vi.fn();
    const leader = createCore({ documentId: 'tab-onchange', data: document3(), onChange });

    await leader.isReady;
    await wait(50);
    const follower = createCore({ documentId: 'tab-onchange', data: document3() });

    await follower.isReady;
    await wait(100);
    await oneWindow();
    onChange.mockClear();

    const arrived = { at: -1 };
    const unsubscribe = leader.moduleInstances.YjsManager.onAnyDocUpdate(() => {
      if (arrived.at < 0) {
        arrived.at = performance.now();
      }
    });
    const delivered = new Promise<number>((resolve) => {
      onChange.mockImplementation(() => resolve(performance.now()));
    });

    await follower.moduleInstances.API.methods.blocks.update('b', { text: 'b from follower' });
    const deliveredAt = await delivered;

    unsubscribe();
    expect(arrived.at).toBeGreaterThan(0);
    expect(deliveredAt - arrived.at).toBeLessThan(150);
    const event = onChange.mock.lastCall?.[1] as BlockMutationEvent | BlockMutationEvent[];

    expect((Array.isArray(event) ? event : [ event ]).some((e) => e.detail.origin === 'tab')).toBe(true);
  });

  it('a burst of follower edits gets at most one leader save per batch window', async () => {
    const { leader, follower, onSave } = await twoEditors('tab-burst');
    const savedAt: number[] = [];
    const { Saver } = leader.moduleInstances;
    const serialize = Saver.save.bind(Saver);

    // Timestamps the serialization start: its end drifts with load.
    vi.spyOn(Saver, 'save').mockImplementation((...args) => {
      savedAt.push(performance.now());

      return serialize(...args);
    });

    for (const text of ['one', 'two', 'three', 'four', 'five', 'six']) {
      await follower.moduleInstances.API.methods.blocks.update('b', { text });
      await wait(60);
    }
    await oneWindow();

    expect(savedAt.length).toBeGreaterThan(0);
    savedAt.slice(1).forEach((at, i) => {
      expect(at - savedAt[i]).toBeGreaterThanOrEqual(modificationsObserverBatchTimeout / 2);
    });
    const saved = (onSave.mock.lastCall?.[0] as OutputData).blocks.find((block) => block.id === 'b');

    expect(saved?.data.text).toBe('six');
  });
});

describe('Core — the tab the user works in saves', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cores.splice(0).forEach(destroyCore);
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a follower the user turns to takes over: the old leader saves its edit once, the new one saves on takeover and from then on', async () => {
    const { createFakeActivity } = await import('./modules/tabSync/fakes');
    const followerActivity = createFakeActivity();
    const leaderSave = vi.fn();
    const followerSave = vi.fn();
    const activity = vi.spyOn(browserTabPlatform, 'activity');
    const leader = createCore({ documentId: 'work-tab', data: document3(), onSave: leaderSave });

    activity.mockImplementationOnce(() => createFakeActivity());
    await leader.isReady;
    await wait(50);
    activity.mockImplementationOnce(() => followerActivity);
    const follower = createCore({ documentId: 'work-tab', data: document3(), onSave: followerSave });

    await follower.isReady;
    await wait(100);
    expect(follower.moduleInstances.TabSync.role).toBe('follower');
    leaderSave.mockClear();

    await leader.moduleInstances.API.methods.blocks.update('a', { text: 'a by leader' });
    followerActivity.set(true);
    await wait(CLAIM_SETTLE_MS + 150);

    expect(follower.moduleInstances.TabSync.role).toBe('leader');
    expect(leader.moduleInstances.TabSync.role).toBe('follower');
    expect(leaderSave).toHaveBeenCalledTimes(1);
    expect((leaderSave.mock.lastCall?.[0] as OutputData).blocks[0].data.text).toBe('a by leader');

    await oneWindow();
    // One save on takeover: bindings that ride onSave in this tab are current at once.
    expect(followerSave).toHaveBeenCalledTimes(1);
    expect((followerSave.mock.lastCall?.[0] as OutputData).blocks[0].data.text).toBe('a by leader');

    await follower.moduleInstances.API.methods.blocks.update('b', { text: 'b by follower' });
    await oneWindow();

    expect(followerSave).toHaveBeenCalledTimes(2);
    expect((followerSave.mock.lastCall?.[0] as OutputData).blocks[1].data.text).toBe('b by follower');
    expect(leaderSave).toHaveBeenCalledTimes(1);
  });
});
