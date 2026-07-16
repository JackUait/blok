/**
 * Dependency-ordered concurrent task runner for the build/release scripts.
 *
 * Two exports:
 * - runTaskGraph(tasks, runTask): runs every task as soon as its deps are done,
 *   independent tasks concurrently. A failed task marks its transitive
 *   dependents as skipped; unrelated tasks still run to completion so one
 *   failure yields a full report (e.g. lint AND test results) instead of
 *   aborting at the first error.
 * - runWithTimeoutRetry(attempt, opts): wall-clock guard for steps that are
 *   known to hang silently under load (vite builds) — kills and retries
 *   instead of stalling a release for hours.
 */

/**
 * @template {{name: string, deps?: string[]}} T
 * @param {T[]} tasks
 * @param {(task: T) => Promise<unknown>} runTask
 * @returns {Promise<{ok: boolean, failed: string[], skipped: string[]}>}
 */
export async function runTaskGraph(tasks, runTask) {
  const byName = new Map(tasks.map((t) => [t.name, t]));

  for (const task of tasks) {
    for (const dep of task.deps ?? []) {
      if (!byName.has(dep)) {
        throw new Error(`Task "${task.name}" depends on unknown task "${dep}"`);
      }
    }
  }

  const done = new Set();
  const failed = [];
  const skipped = [];
  const running = new Map();

  const isSkipped = (name) => skipped.includes(name);
  const isFailed = (name) => failed.includes(name);

  while (done.size + failed.length + skipped.length < tasks.length) {
    for (const task of tasks) {
      const settled = done.has(task.name) || isFailed(task.name) || isSkipped(task.name);

      if (settled || running.has(task.name)) {
        continue;
      }

      const deps = task.deps ?? [];

      if (deps.some((d) => isFailed(d) || isSkipped(d))) {
        skipped.push(task.name);
        continue;
      }

      if (deps.every((d) => done.has(d))) {
        running.set(
          task.name,
          Promise.resolve()
            .then(() => runTask(task))
            .then(
              () => ({ name: task.name, ok: true }),
              (error) => ({ name: task.name, ok: false, error }),
            ),
        );
      }
    }

    if (running.size === 0) {
      // Nothing settled this pass and nothing is runnable: unresolvable graph.
      const pending = tasks
        .filter((t) => !done.has(t.name) && !isFailed(t.name) && !isSkipped(t.name))
        .map((t) => t.name);

      if (pending.length > 0) {
        throw new Error(`Task graph has a dependency cycle involving: ${pending.join(', ')}`);
      }
      break;
    }

    const result = await Promise.race(running.values());

    running.delete(result.name);

    if (result.ok) {
      done.add(result.name);
    } else {
      failed.push(result.name);
    }
  }

  // Wait out any tasks still running after a failure settled the loop's count.
  await Promise.all(running.values());

  return { ok: failed.length === 0, failed, skipped };
}

class TaskTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Task timed out after ${timeoutMs}ms`);
    this.name = 'TaskTimeoutError';
  }
}

/**
 * Runs `attempt` with a wall-clock timeout. On timeout, calls `onKill()`
 * (which should terminate the underlying process) and retries up to
 * `retries` times. Non-timeout failures are NOT retried — a real build or
 * test error must surface immediately.
 *
 * @template T
 * @param {() => Promise<T>} attempt
 * @param {{timeoutMs: number, retries: number, onKill: () => void}} opts
 * @returns {Promise<T>}
 */
export async function runWithTimeoutRetry(attempt, { timeoutMs, retries, onKill }) {
  for (let i = 0; ; i++) {
    let timer;

    try {
      return await Promise.race([
        attempt(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new TaskTimeoutError(timeoutMs));
          }, timeoutMs);
        }),
      ]);
    } catch (error) {
      if (!(error instanceof TaskTimeoutError)) {
        throw error;
      }

      onKill();

      if (i >= retries) {
        throw error;
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
