/**
 * One shared queue per page: several editors converting at once would fight
 * over the same CPU and hardware encoder.
 */
const state: { pending: number; tail: Promise<unknown> } = { pending: 0, tail: Promise.resolve() };

/**
 * The browser shows its own "Leave site?" text; a page cannot set the wording.
 * Unreliable on mobile, where the block still works with the original file.
 * @param event - the unload attempt
 */
const holdLeave = (event: BeforeUnloadEvent): void => {
  event.preventDefault();
};

/**
 * Settles when `signal` aborts; never settles without one.
 * @param signal - the job's cancel signal
 */
const abortedBy = (signal?: AbortSignal): Promise<void> => new Promise((resolve) => {
  if (signal?.aborted === true) {
    resolve();
  }
  signal?.addEventListener('abort', () => resolve(), { once: true });
});

/**
 * Run `job` after every job queued before it. While any job is queued or
 * running, leaving the page asks the user first.
 * @param job - the work to run
 * @param signal - aborting frees the job's turn at once, even if the job hangs
 * @returns what `job` returns, or its failure
 */
export const enqueueMediaJob = <T>(job: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (state.pending === 0) {
    window.addEventListener('beforeunload', holdLeave);
  }
  state.pending += 1;

  const previous = state.tail;
  const run = previous.then(() => (signal?.aborted === true ? Promise.reject(new Error('aborted')) : job()));

  // Raced only once its turn comes: an abort while waiting must not let the
  // next job overtake the one still running.
  state.tail = previous.then(() => Promise.race([run, abortedBy(signal)]))
    .catch(() => undefined)
    .finally(() => {
      state.pending -= 1;
      if (state.pending === 0) {
        window.removeEventListener('beforeunload', holdLeave);
      }
    });

  return run;
};

export const hasPendingMediaJobs = (): boolean => state.pending > 0;
