const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Both sides have converged when two reads in a row are equal. */
export const waitForStable = async <T>(read: () => Promise<T>, o: { intervalMs: number; timeoutMs: number }): Promise<T> => {
  const deadline = Date.now() + o.timeoutMs;
  let previous = JSON.stringify(await read());

  while (Date.now() < deadline) {
    await sleep(o.intervalMs);

    const value = await read();
    const text = JSON.stringify(value);

    if (text === previous) {
      return value;
    }

    previous = text;
  }

  throw new Error('live room did not settle before the deadline');
};

export const blocksWithMarker = (samples: string[][]): string[] => [...new Set(samples.flat())].sort();

/** Polls until `check` holds. A timeout returns false: the graders then fail honestly. */
export const waitUntil = async (check: () => Promise<boolean>, o: { intervalMs: number; timeoutMs: number }): Promise<boolean> => {
  const deadline = Date.now() + o.timeoutMs;

  while (!(await check())) {
    if (Date.now() >= deadline) {
      return false;
    }

    await sleep(o.intervalMs);
  }

  return true;
};

/** Stops what was started, newest first. Every stop runs even if one throws; the first error is rethrown. */
export const createCleanup = (): { add(stop: () => Promise<void>): void; run(): Promise<void> } => {
  const stops: Array<() => Promise<void>> = [];

  return {
    add: (stop) => {
      stops.push(stop);
    },
    run: async () => {
      const errors: unknown[] = [];

      for (const stop of stops.splice(0).reverse()) {
        await stop().catch((error: unknown) => {
          errors.push(error);
        });
      }

      if (errors.length > 0) {
        throw errors[0];
      }
    },
  };
};
