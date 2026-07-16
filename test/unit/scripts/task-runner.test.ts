import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runTaskGraph, runWithTimeoutRetry } from '../../../scripts/task-runner.mjs';

interface TestTask {
  name: string;
  deps?: string[];
}

/** Creates a manually-resolvable promise so tests control task completion order. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

const tick = (): Promise<void> => new Promise((res) => { setTimeout(res, 0); });

describe('runTaskGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs a dependent task only after its dependency completes', async () => {
    const order: string[] = [];
    const runTask = vi.fn(async (task: TestTask) => {
      order.push(task.name);
    });

    const result = await runTaskGraph(
      [
        { name: 'main', deps: ['fonts'] },
        { name: 'fonts' },
      ],
      runTask,
    );

    expect(order).toEqual(['fonts', 'main']);
    expect(result.ok).toBe(true);
  });

  it('starts independent tasks concurrently', async () => {
    const started: string[] = [];
    const gates = new Map([
      ['a', deferred<void>()],
      ['b', deferred<void>()],
    ]);
    const runTask = vi.fn((task: TestTask) => {
      started.push(task.name);

      const gate = gates.get(task.name);

      if (!gate) {
        throw new Error(`unexpected task ${task.name}`);
      }

      return gate.promise;
    });

    const resultPromise = runTaskGraph([{ name: 'a' }, { name: 'b' }], runTask);

    await tick();
    // Both must have started before either finished
    expect(started).toEqual(['a', 'b']);

    gates.get('a')?.resolve();
    gates.get('b')?.resolve();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
  });

  it('skips transitive dependents of a failed task but still runs unrelated tasks', async () => {
    const ran: string[] = [];
    const runTask = vi.fn(async (task: TestTask) => {
      ran.push(task.name);

      if (task.name === 'main') {
        throw new Error('boom');
      }
    });

    const result = await runTaskGraph(
      [
        { name: 'fonts' },
        { name: 'main', deps: ['fonts'] },
        { name: 'iife', deps: ['main'] },
        { name: 'locales', deps: ['main'] },
        { name: 'react' },
      ],
      runTask,
    );

    expect(ran).toContain('react');
    expect(ran).not.toContain('iife');
    expect(ran).not.toContain('locales');
    expect(result.ok).toBe(false);
    expect(result.failed).toEqual(['main']);
    expect(result.skipped.sort()).toEqual(['iife', 'locales']);
  });

  it('lets already-running tasks finish when another task fails', async () => {
    const slowGate = deferred<void>();
    let slowFinished = false;
    const runTask = vi.fn((task: TestTask) => {
      if (task.name === 'slow') {
        return slowGate.promise.then(() => {
          slowFinished = true;
        });
      }

      return Promise.reject(new Error('boom'));
    });

    const resultPromise = runTaskGraph([{ name: 'slow' }, { name: 'failing' }], runTask);

    await tick();
    slowGate.resolve();
    const result = await resultPromise;

    expect(slowFinished).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.failed).toEqual(['failing']);
  });

  it('rejects on unknown or cyclic dependencies', async () => {
    const runTask = vi.fn(async () => { /* noop */ });

    await expect(runTaskGraph([{ name: 'a', deps: ['ghost'] }], runTask)).rejects.toThrow(/ghost/);
    await expect(
      runTaskGraph([{ name: 'a', deps: ['b'] }, { name: 'b', deps: ['a'] }], runTask),
    ).rejects.toThrow(/cycle/i);
  });
});

describe('runWithTimeoutRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the result when the attempt finishes within the timeout', async () => {
    const attempt = vi.fn(() => Promise.resolve('done'));

    const promise = runWithTimeoutRetry(attempt, { timeoutMs: 1000, retries: 1, onKill: vi.fn() });

    await expect(promise).resolves.toBe('done');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('kills a hung attempt after timeoutMs and retries; succeeds on the retry', async () => {
    const onKill = vi.fn();
    let calls = 0;
    const attempt = vi.fn(() => {
      calls += 1;

      if (calls === 1) {
        return new Promise<string>(() => { /* hangs forever */ });
      }

      return Promise.resolve('recovered');
    });

    const promise = runWithTimeoutRetry(attempt, { timeoutMs: 1000, retries: 1, onKill });

    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBe('recovered');
    expect(onKill).toHaveBeenCalledTimes(1);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('fails once retries are exhausted', async () => {
    const onKill = vi.fn();
    const attempt = vi.fn(() => new Promise<string>(() => { /* hangs forever */ }));

    const promise = runWithTimeoutRetry(attempt, { timeoutMs: 1000, retries: 1, onKill });
    const assertion = expect(promise).rejects.toThrow(/timed out/i);

    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(onKill).toHaveBeenCalledTimes(2);
  });

  it('does not retry a real (non-timeout) failure', async () => {
    const attempt = vi.fn(() => Promise.reject(new Error('exit code 1')));

    await expect(
      runWithTimeoutRetry(attempt, { timeoutMs: 1000, retries: 2, onKill: vi.fn() }),
    ).rejects.toThrow('exit code 1');
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
