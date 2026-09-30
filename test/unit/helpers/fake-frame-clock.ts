import type { SpringClock } from '../../../src/components/utils/spring';

export interface FakeFrameClock {
  clock: SpringClock;
  advance(ms: number, frameMs?: number): void;
}

export const fakeFrameClock = (): FakeFrameClock => {
  const state = { now: 0, id: 0 };
  const queue = new Map<number, () => void>();

  return {
    clock: {
      now: () => state.now,
      request: (cb) => {
        state.id += 1;
        queue.set(state.id, cb);

        return state.id;
      },
      cancel: (id) => {
        queue.delete(id);
      },
    },
    advance(ms, frameMs = 16) {
      for (let t = 0; t < ms; t += frameMs) {
        state.now += frameMs;
        const due = [...queue.values()];

        queue.clear();
        due.forEach((cb) => cb());
      }
    },
  };
};
