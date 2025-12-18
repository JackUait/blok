import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { PromiseQueue } from '../../../src/components/utils/promise-queue';

describe('PromiseQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('executes queued operations sequentially', async () => {
    const queue = new PromiseQueue();
    const order: string[] = [];
    const createTask = (label: string, delay: number) => () => new Promise<void>((resolve) => {
      setTimeout(() => {
        order.push(label);
        resolve();
      }, delay);
    });

    const firstPromise = queue.add(createTask('first', 20));
    const secondPromise = queue.add(createTask('second', 0));

    await vi.runAllTimersAsync();
    await firstPromise;
    await secondPromise;
    await expect(queue.completed).resolves.toBeUndefined();

    expect(order).toEqual(['first', 'second']);
  });

  it('resolves the promise returned by add after operation finishes', async () => {
    const queue = new PromiseQueue();
    const operation = vi.fn(() => Promise.resolve());

    const promise = queue.add(operation);

    await promise;

    expect(operation).toHaveBeenCalledTimes(1);
    await expect(queue.completed).resolves.toBeUndefined();
  });

  it('propagates errors from queued operations and stops chain', async () => {
    const queue = new PromiseQueue();
    const error = new Error('fail');
    const succeedingTask = vi.fn();

    await expect(queue.add(() => {
      throw error;
    })).rejects.toThrow(error);

    await expect(queue.completed).rejects.toThrow(error);

    await expect(queue.add(succeedingTask)).rejects.toThrow(error);
    expect(succeedingTask).not.toHaveBeenCalled();
  });
});
