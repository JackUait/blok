import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ModificationsObserver } from '../../../../src/components/modules/modificationsObserver';
import { modificationsObserverBatchTimeout } from '../../../../src/components/constants';
import { BlockChanged } from '../../../../src/components/events';
import { EventsDispatcher } from '../../../../src/components/utils/events';

import type { BlokEventMap } from '../../../../src/components/events';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { BlokConfig, OutputData } from '../../../../types';
import type { BlockMutationEvent } from '../../../../types/events/block';

type TabRole = 'solo' | 'joining' | 'leader' | 'follower';
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
  } => {
    const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
    const onChange = vi.fn();
    const onSave = vi.fn();
    const config = { onChange, onSave } as unknown as BlokConfig;
    const observer = new ModificationsObserver({ config, eventsDispatcher });

    observer.state = {
      UI: { nodes: { redactor: document.createElement('div') } },
      API: { methods: {} },
      Saver: { save: vi.fn().mockResolvedValue(DOC) },
      ReadOnly: { isEnabled: false },
      ...(role === undefined ? {} : { TabSync: { role } }),
    } as unknown as BlokModules;

    observer.enable();

    const emitBlockChanged = ({ origin }: { origin: Origin }): void => {
      eventsDispatcher.emit(BlockChanged, {
        event: new CustomEvent('block-changed', {
          detail: { target: { id: 'b1' }, origin },
        }) as BlockMutationEvent,
      });
    };

    return { observer, onChange, onSave, emitBlockChanged };
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
});
