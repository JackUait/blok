import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { enqueueMediaJob, hasPendingMediaJobs } from '../../../../src/components/media-variants/media-queue';

const deferred = (): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } => {
  const handles: { resolve: () => void; reject: (e: Error) => void } = { resolve: () => undefined, reject: () => undefined };
  const promise = new Promise<void>((resolve, reject) => {
    handles.resolve = resolve;
    handles.reject = reject;
  });

  return { promise, ...handles };
};

/** Whether leaving the page right now would ask the user first. */
const leaveIsGuarded = (): boolean => {
  const event = new Event('beforeunload', { cancelable: true });

  window.dispatchEvent(event);

  return event.defaultPrevented;
};

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('media queue', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(async () => {
    vi.restoreAllMocks();
    await settle();
  });

  it('runs jobs one at a time, in order', async () => {
    const order: string[] = [];
    const first = deferred();

    const a = enqueueMediaJob(async () => {
      order.push('a start');
      await first.promise;
      order.push('a end');
    });
    const b = enqueueMediaJob(async () => {
      order.push('b');
    });

    await settle();
    expect(order).toEqual(['a start']);

    first.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(['a start', 'a end', 'b']);
  });

  it('keeps going after a job fails, and passes the failure to its caller', async () => {
    const failed = enqueueMediaJob(async () => {
      throw new Error('boom');
    });
    const next = enqueueMediaJob(async () => 'ok');

    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });

  it('asks before the page is left only while a job is queued or running', async () => {
    const first = deferred();
    const second = deferred();

    expect(leaveIsGuarded()).toBe(false);

    const a = enqueueMediaJob(() => first.promise);
    const b = enqueueMediaJob(() => second.promise);

    expect(hasPendingMediaJobs()).toBe(true);
    expect(leaveIsGuarded()).toBe(true);

    first.resolve();
    await a;
    expect(leaveIsGuarded()).toBe(true);

    second.resolve();
    await b;
    await settle();
    expect(hasPendingMediaJobs()).toBe(false);
    expect(leaveIsGuarded()).toBe(false);
  });
});
