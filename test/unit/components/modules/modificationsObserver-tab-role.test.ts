import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ModificationsObserver } from '../../../../src/components/modules/modificationsObserver';
import type { TabRole } from '../../../../src/components/modules/tabSync';
import { modificationsObserverBatchTimeout } from '../../../../src/components/constants';
import { BlockChanged } from '../../../../src/components/events';
import { EventsDispatcher } from '../../../../src/components/utils/events';

import type { BlokEventMap } from '../../../../src/components/events';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { BlokConfig, OutputData } from '../../../../types';
import type { BlockMutationEvent } from '../../../../types/events/block';

type Origin = 'local' | 'tab' | 'remote';

const DOC: OutputData = {
  time: 1,
  version: '1.0.0',
  blocks: [ { id: 'b1', type: 'paragraph', data: { text: 'typed' } } ],
};

describe('ModificationsObserver — tab role', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * Builds an enabled observer. `role: undefined` leaves TabSync out of the
   * module map, like an editor that has no tab sync.
   */
  const setup = ({ role }: { role?: TabRole }): {
    observer: ModificationsObserver;
    onChange: ReturnType<typeof vi.fn>;
    onSave: ReturnType<typeof vi.fn>;
    emitBlockChanged: (detail: { origin: Origin }) => void;
    save: ReturnType<typeof vi.fn>;
    tabSync: { role: TabRole };
    readOnly: { isEnabled: boolean };
    turnReadOnly: () => void;
  } => {
    const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
    const onChange = vi.fn();
    const onSave = vi.fn();
    const config = { onChange, onSave } as unknown as BlokConfig;
    const observer = new ModificationsObserver({ config, eventsDispatcher });
    const save = vi.fn().mockResolvedValue(DOC);
    const tabSync = { role: role ?? 'solo' };
    const readOnly = { isEnabled: false };

    observer.state = {
      UI: { nodes: { redactor: document.createElement('div') } },
      API: { methods: {} },
      Saver: { save },
      ReadOnly: readOnly,
      ...(role === undefined ? {} : { TabSync: tabSync }),
    } as unknown as BlokModules;

    observer.enable();

    const emitBlockChanged = ({ origin }: { origin: Origin }): void => {
      eventsDispatcher.emit(BlockChanged, {
        event: new CustomEvent('block-changed', {
          detail: { target: { id: 'b1' }, origin },
        }) as BlockMutationEvent,
      });
    };

    // What ReadOnly + TabSync do when a leader turns read-only: flip first, then demote.
    const turnReadOnly = (): void => {
      readOnly.isEnabled = true;
      tabSync.role = 'follower';
      observer.onRoleChanged('follower', { keepPendingSave: true });
    };

    return { observer, onChange, onSave, emitBlockChanged, save, tabSync, readOnly, turnReadOnly };
  };

  const flushWindow = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout);
  };

  it('a follower delivers onChange but never onSave and never arms the close prompt', async () => {
    const { observer, onChange, onSave, emitBlockChanged } = setup({ role: 'follower' });

    emitBlockChanged({ origin: 'tab' });
    expect(observer.hasUnsavedChanges).toBe(false);
    await flushWindow();

    expect(onSave).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalled();
    expect(observer.hasUnsavedChanges).toBe(false);
  });

  it('a follower does not save its own local edit either', async () => {
    const { observer, onSave, emitBlockChanged } = setup({ role: 'follower' });

    emitBlockChanged({ origin: 'local' });
    await flushWindow();

    expect(onSave).not.toHaveBeenCalled();
    expect(observer.hasUnsavedChanges).toBe(false);
  });

  it('the leader saves a tab-origin change', async () => {
    const { onSave, emitBlockChanged } = setup({ role: 'leader' });

    emitBlockChanged({ origin: 'tab' });
    await flushWindow();

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('an editor without tab sync saves as before', async () => {
    const { onSave, emitBlockChanged } = setup({});

    emitBlockChanged({ origin: 'local' });
    await flushWindow();

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('a joining tab holds its save until the role resolves', async () => {
    const { observer, onSave, emitBlockChanged } = setup({ role: 'joining' });

    emitBlockChanged({ origin: 'local' });
    await flushWindow();

    expect(onSave).not.toHaveBeenCalled();
    expect(observer.hasUnsavedChanges).toBe(true);

    observer.onRoleChanged('solo');
    await vi.advanceTimersByTimeAsync(0);

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('a joining tab that becomes leader flushes its held save', async () => {
    const { observer, onSave, emitBlockChanged } = setup({ role: 'joining' });

    emitBlockChanged({ origin: 'local' });
    await flushWindow();
    observer.onRoleChanged('leader');
    await vi.advanceTimersByTimeAsync(0);

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('a joining tab that becomes follower drops its held save and the close prompt', async () => {
    const { observer, onSave, emitBlockChanged } = setup({ role: 'joining' });

    emitBlockChanged({ origin: 'local' });
    await flushWindow();
    observer.onRoleChanged('follower');
    await flushWindow();

    expect(onSave).not.toHaveBeenCalled();
    expect(observer.hasUnsavedChanges).toBe(false);
  });

  it('becoming follower mid-window still delivers the queued onChange', async () => {
    const { observer, onChange, onSave, emitBlockChanged } = setup({ role: 'joining' });

    emitBlockChanged({ origin: 'local' });
    await vi.advanceTimersByTimeAsync(0);
    emitBlockChanged({ origin: 'tab' });
    observer.onRoleChanged('follower');
    await flushWindow();

    expect(onSave).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(observer.hasUnsavedChanges).toBe(false);
  });

  it.each([
    { outcome: 'came back empty', settle: (resolve: (v: OutputData | undefined) => void) => resolve(undefined) },
    { outcome: 'failed', settle: (_: unknown, reject: (e: Error) => void) => reject(new Error('serialize failed')) },
  ])('a save that $outcome after the tab became follower does not re-arm', async ({ settle }) => {
    const { observer, onSave, emitBlockChanged, save, tabSync } = setup({ role: 'solo' });
    const pending: { resolve: (v: OutputData | undefined) => void; reject: (e: Error) => void } = {
      resolve: () => undefined,
      reject: () => undefined,
    };

    save.mockReturnValueOnce(new Promise<OutputData | undefined>((resolve, reject) => {
      pending.resolve = resolve;
      pending.reject = reject;
    }));
    emitBlockChanged({ origin: 'local' });
    await flushWindow();
    expect(save).toHaveBeenCalledTimes(1);

    tabSync.role = 'follower';
    observer.onRoleChanged('follower');
    settle(pending.resolve, pending.reject);
    await vi.advanceTimersByTimeAsync(0);

    expect(observer.hasUnsavedChanges).toBe(false);
    await flushWindow();
    expect(save).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('destroying a joining tab still serializes its held edit', async () => {
    const { observer, emitBlockChanged, save } = setup({ role: 'joining' });

    emitBlockChanged({ origin: 'local' });
    await vi.advanceTimersByTimeAsync(Math.round(modificationsObserverBatchTimeout / 4));
    observer.destroy();

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('destroying a follower serializes nothing', async () => {
    const { observer, emitBlockChanged, save } = setup({ role: 'follower' });

    emitBlockChanged({ origin: 'local' });
    await vi.advanceTimersByTimeAsync(Math.round(modificationsObserverBatchTimeout / 4));
    observer.destroy();

    expect(save).not.toHaveBeenCalled();
  });
  it('flushNow saves at once for a leader, with no edit and no batch window', async () => {
    const { observer, onSave } = setup({ role: 'leader' });

    observer.flushNow();
    await vi.advanceTimersByTimeAsync(0);

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('flushNow in a follower or a joining tab saves nothing and arms no close prompt', async () => {
    for (const role of ['follower', 'joining'] as const) {
      const { observer, onSave, save } = setup({ role });

      observer.flushNow();
      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout);

      expect(save, role).not.toHaveBeenCalled();
      expect(onSave, role).not.toHaveBeenCalled();
      expect(observer.hasUnsavedChanges, role).toBe(false);
    }
  });

  it('markDirty in a leader arms the close prompt and saves once, when the window closes', async () => {
    const { observer, onSave, onChange } = setup({ role: 'leader' });

    observer.markDirty();
    observer.markDirty();

    expect(observer.hasUnsavedChanges).toBe(true);
    await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout - 1);
    expect(onSave).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(observer.hasUnsavedChanges).toBe(false);
  });

  it('markDirty in a follower or a joining tab saves nothing and arms no close prompt', async () => {
    for (const role of ['follower', 'joining'] as const) {
      const { observer, save } = setup({ role });

      observer.markDirty();
      await vi.advanceTimersByTimeAsync(modificationsObserverBatchTimeout);

      expect(save, role).not.toHaveBeenCalled();
      expect(observer.hasUnsavedChanges, role).toBe(false);
    }
  });

  it('a leader destroyed inside the window opened by markDirty still serializes', async () => {
    const { observer, save } = setup({ role: 'leader' });

    observer.markDirty();
    await vi.advanceTimersByTimeAsync(Math.round(modificationsObserverBatchTimeout / 4));
    observer.destroy();

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('a leader that turns read-only inside the window keeps its edit unsaved and saves it as leader again', async () => {
    const { observer, onSave, emitBlockChanged, tabSync, readOnly, turnReadOnly } = setup({ role: 'leader' });

    emitBlockChanged({ origin: 'local' });
    turnReadOnly();
    await flushWindow();

    expect(observer.hasUnsavedChanges).toBe(true);
    expect(onSave).not.toHaveBeenCalled();

    readOnly.isEnabled = false;
    tabSync.role = 'leader';
    observer.onRoleChanged('leader');
    await vi.advanceTimersByTimeAsync(0);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(observer.hasUnsavedChanges).toBe(false);
  });

  it('a leader that turns read-only while its save is in flight keeps that edit unsaved', async () => {
    const { observer, onSave, emitBlockChanged, save, tabSync, readOnly, turnReadOnly } = setup({ role: 'leader' });
    const pending: { resolve: (v: OutputData) => void } = { resolve: () => undefined };

    save.mockReturnValueOnce(new Promise<OutputData>((resolve) => {
      pending.resolve = resolve;
    }));
    emitBlockChanged({ origin: 'local' });
    await flushWindow();
    expect(save).toHaveBeenCalledTimes(1);

    turnReadOnly();
    pending.resolve(DOC);
    await vi.advanceTimersByTimeAsync(0);

    expect(onSave).not.toHaveBeenCalled();
    expect(observer.hasUnsavedChanges).toBe(true);

    readOnly.isEnabled = false;
    tabSync.role = 'leader';
    observer.onRoleChanged('leader');
    await vi.advanceTimersByTimeAsync(0);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(observer.hasUnsavedChanges).toBe(false);
  });

  it('a later plain demotion still drops the edit a read-only demotion kept', async () => {
    const { observer, emitBlockChanged, tabSync, turnReadOnly } = setup({ role: 'leader' });

    emitBlockChanged({ origin: 'local' });
    turnReadOnly();
    tabSync.role = 'joining';
    observer.onRoleChanged('joining');
    tabSync.role = 'follower';
    observer.onRoleChanged('follower');

    expect(observer.hasUnsavedChanges).toBe(false);
  });

  it('a change from another tab after markDirty still leads its window with onChange', async () => {
    const { observer, onChange, onSave, emitBlockChanged } = setup({ role: 'leader' });

    observer.markDirty();
    emitBlockChanged({ origin: 'tab' });
    await vi.advanceTimersByTimeAsync(0);

    expect(onChange).toHaveBeenCalledTimes(1);

    await flushWindow();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('only the first change in a markDirty window leads it; one save per window', async () => {
    const { observer, onChange, onSave, emitBlockChanged } = setup({ role: 'leader' });

    observer.markDirty();
    emitBlockChanged({ origin: 'tab' });
    await vi.advanceTimersByTimeAsync(0);
    observer.markDirty();
    emitBlockChanged({ origin: 'local' });
    await vi.advanceTimersByTimeAsync(0);

    expect(onChange).toHaveBeenCalledTimes(1);

    await flushWindow();

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
