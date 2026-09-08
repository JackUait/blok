/**
 * Mutant-killing tests for `src/components/utils/functional.ts`.
 *
 * Several throttle paths are only reachable when the wall clock and the timer
 * queue disagree, so those tests fake `setTimeout` alone and drive `Date.now`
 * by hand. Both directions happen for real: a background tab fires a timer long
 * after its delay, and an NTP step can move the clock back under a pending one.
 *
 * PROVEN EQUIVALENT (no test can distinguish these mutants):
 *
 * - `args ?? []` -> `args ?? ["Stryker was here"]` (invokeFunc). The right
 *   operand never evaluates. `state.lastArgs` is written from the rest
 *   parameter on every `throttled` call before either call site runs, the
 *   leading site reads it in the same turn, and the trailing site is guarded by
 *   `state.lastArgs !== undefined` with no write in between. Stryker reports it
 *   NoCoverage, which is the same fact measured from the other side.
 *
 * - the `state` object literal -> `{}`. Only `lastInvokeTime: 0` differs from
 *   the implicit `undefined`; every other field is initialised to `undefined`
 *   anyway. Its first read is inside `shouldInvoke` during the first
 *   `throttled` call, where `state.lastCallTime === undefined` is true and `||`
 *   short-circuits past it - the NaN is computed but never used. That first
 *   call always takes the `canStartTimer` branch, which writes `lastInvokeTime`
 *   before any other reader can run: `timerExpired` and `remainingWait` need a
 *   timer, and only `throttled` arms one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { debounce, throttle } from '../../../../src/components/utils/functional';

/**
 * Far from the epoch on purpose: with a small `Date.now`, `time - x` and
 * `time + x` are close enough that an arithmetic mutant lands on the same
 * remaining wait and survives.
 */
const BASE = 1_000_000;

const recorder = (): { calls: unknown[]; fn: (arg: unknown) => void } => {
  const calls: unknown[] = [];

  return {
    calls,
    fn: (arg: unknown): void => {
      calls.push(arg);
    },
  };
};

describe('functional mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('debounce', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('does not clear a timer it never armed', () => {
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
      const debounced = debounce(() => {}, 100);

      debounced();
      expect(clearSpy).not.toHaveBeenCalled();

      debounced();
      expect(clearSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('throttle on a clock that agrees with the timer', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('invokes on the leading edge when the clock reads zero', () => {
      vi.setSystemTime(0);

      const { calls, fn } = recorder();
      const throttled = throttle(fn, 100);

      // Every other reason to invoke is false at time 0: only the missing
      // lastCallTime says this is the first call.
      throttled('a');

      expect(calls).toEqual([ 'a' ]);
    });

    it('invokes a call landing exactly one wait after the previous call', () => {
      const { calls, fn } = recorder();
      const throttled = throttle(fn, 100);

      throttled('a');
      vi.advanceTimersByTime(50);
      throttled('b');

      vi.advanceTimersByTime(50);
      expect(calls).toEqual([ 'a', 'b' ]);

      // 100ms since the last call, but only 50ms since the trailing invoke.
      vi.advanceTimersByTime(50);
      throttled('c');

      expect(calls).toEqual([ 'a', 'b', 'c' ]);
    });

    it('arms no second timer for a call inside an open window', () => {
      const { calls, fn } = recorder();
      const throttled = throttle(fn, 100);

      throttled('a');
      expect(vi.getTimerCount()).toBe(1);

      vi.advanceTimersByTime(50);
      throttled('b');

      expect(vi.getTimerCount()).toBe(1);

      vi.advanceTimersByTime(50);
      expect(calls).toEqual([ 'a', 'b' ]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('delivers a call arriving just after a trailing invoke one full wait later', () => {
      const { calls, fn } = recorder();
      const throttled = throttle(fn, 10);

      throttled('a');
      vi.advanceTimersByTime(5);
      throttled('b');

      vi.advanceTimersByTime(5);
      expect(calls).toEqual([ 'a', 'b' ]);

      vi.advanceTimersByTime(2);
      throttled('c');

      vi.advanceTimersByTime(8);
      expect(calls).toEqual([ 'a', 'b' ]);

      vi.advanceTimersByTime(2);
      expect(calls).toEqual([ 'a', 'b', 'c' ]);
    });
  });

  describe('throttle on a clock that disagrees with the timer', () => {
    let now = BASE;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: [ 'setTimeout', 'clearTimeout' ] });
      now = BASE;
      vi.spyOn(Date, 'now').mockImplementation(() => now);
    });

    it('invokes on the leading edge when the clock stepped back past the last call', () => {
      const { calls, fn } = recorder();
      const throttled = throttle(fn, 100);

      throttled('a');
      now = BASE + 50;
      throttled('b');

      now = BASE + 100;
      vi.advanceTimersByTime(100);
      expect(calls).toEqual([ 'a', 'b' ]);

      // Behind the recorded last call, and only 60ms are missing since the
      // trailing invoke, so the negative gap is the only reason to invoke.
      now = BASE + 40;
      throttled('c');

      expect(calls).toEqual([ 'a', 'b', 'c' ]);
    });

    it('does not invoke for a call repeating the previous call instant', () => {
      const { calls, fn } = recorder();
      const throttled = throttle(fn, 100);

      throttled('a');
      now = BASE + 50;
      throttled('b');

      now = BASE + 100;
      vi.advanceTimersByTime(100);
      expect(calls).toEqual([ 'a', 'b' ]);

      now = BASE + 50;
      throttled('c');
      expect(calls).toEqual([ 'a', 'b' ]);

      now = BASE + 150;
      vi.advanceTimersByTime(100);
      expect(calls).toEqual([ 'a', 'b', 'c' ]);
    });

    it('does not open a second window while a timer is still pending', () => {
      const { calls, fn } = recorder();
      const throttled = throttle(fn, 100);

      throttled('a');

      // The timer has not run yet even though the window is long over.
      now = BASE + 200;
      throttled('b');
      expect(calls).toEqual([ 'a' ]);

      vi.advanceTimersByTime(100);
      expect(calls).toEqual([ 'a', 'b' ]);
    });

    it('retries after the time left until the last invoke ages out', () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      const { calls, fn } = recorder();
      const throttled = throttle(fn, 100);

      throttled('a');
      now = BASE + 20;
      throttled('b');

      // The timer runs after 90ms of clock: neither gap has reached the window.
      now = BASE + 90;
      vi.advanceTimersByTime(100);

      expect(calls).toEqual([ 'a' ]);
      expect(setTimeoutSpy.mock.lastCall?.[1]).toBe(10);

      now = BASE + 100;
      vi.advanceTimersByTime(10);
      expect(calls).toEqual([ 'a', 'b' ]);
    });

    it('retries after the time left until the last call ages out', () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      const { calls, fn } = recorder();
      const throttled = throttle(fn, 100);

      throttled('a');
      now = BASE + 50;
      throttled('b');

      now = BASE + 100;
      vi.advanceTimersByTime(100);
      expect(calls).toEqual([ 'a', 'b' ]);

      // Behind the trailing invoke, so the invoke gap is negative here and the
      // call gap is what the retry has to wait out.
      now = BASE + 60;
      throttled('c');

      now = BASE + 90;
      vi.advanceTimersByTime(100);

      expect(calls).toEqual([ 'a', 'b' ]);
      expect(setTimeoutSpy.mock.lastCall?.[1]).toBe(70);

      now = BASE + 160;
      vi.advanceTimersByTime(70);
      expect(calls).toEqual([ 'a', 'b', 'c' ]);
    });
  });
});
