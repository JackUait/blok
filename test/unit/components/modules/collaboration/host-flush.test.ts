import { afterEach, describe, expect, it, vi } from 'vitest';
import { Collaboration } from '../../../../../src/components/modules/collaboration';

function fixture() {
  const state = { pending: 0, quarantined: 0, settled: undefined as (() => void) | undefined };
  const unhook = vi.fn();
  const flush = vi.fn();
  const stats = vi.fn(async () => ({ pendingOperations: state.pending, pendingBytes: state.pending, quarantinedOperations: state.quarantined, appendInFlight: false }));
  const module = Object.assign(Object.create(Collaboration.prototype), {
    settings: { doc: 'test' }, protocol: 'v2', store: { stats },
    Blok: { YjsManager: {
      flushPendingBlockWrites: flush,
      onPendingBlockWritesSettled: (callback: () => void) => { state.settled = callback; return unhook; },
    } },
  }) as Collaboration;
  return { module, state, stats, flush, unhook };
}
afterEach(() => vi.useRealTimers());
describe('host navigation flush', () => {
  it('waits for asynchronous block writes and their durable receipt before returning', async () => {
    vi.useFakeTimers();
    const { module, state, flush, stats } = fixture();
    const completed = vi.fn();
    const waiting = module.flush(1000).then(completed);
    await Promise.resolve();
    expect(stats).not.toHaveBeenCalled();
    state.pending = 1;
    state.settled?.();
    await vi.advanceTimersByTimeAsync(100);
    expect(flush).toHaveBeenCalledOnce();
    expect(completed).not.toHaveBeenCalled();
    state.pending = 0;
    await vi.advanceTimersByTimeAsync(25);
    await waiting;
    expect(completed).toHaveBeenCalledOnce();
  });
  it('rejects a stuck tool save without leaking its listener', async () => {
    vi.useFakeTimers();
    const { module, unhook } = fixture();
    const rejected = expect(module.flush(100)).rejects.toThrow('still saving');
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(unhook).toHaveBeenCalledOnce();
  });
  it('refuses navigation when the last write was quarantined', async () => {
    const { module, state } = fixture();
    state.quarantined = 1;
    const rejected = expect(module.flush()).rejects.toThrow('could not be saved');
    await Promise.resolve();
    state.settled?.();
    await rejected;
  });
});
