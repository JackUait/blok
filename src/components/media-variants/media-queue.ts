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
 * Run `job` after every job queued before it. While any job is queued or
 * running, leaving the page asks the user first.
 * @param job - the work to run
 * @returns what `job` returns, or its failure
 */
export const enqueueMediaJob = <T>(job: () => Promise<T>): Promise<T> => {
  if (state.pending === 0) {
    window.addEventListener('beforeunload', holdLeave);
  }
  state.pending += 1;

  const run = state.tail.then(job);

  state.tail = run
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
