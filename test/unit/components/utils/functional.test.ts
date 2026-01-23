import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { debounce, throttle, delay } from '../../../../src/components/utils/functional';

describe('functional', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('delay', () => {
    it('should delay execution of a function', () => {
      let executed = false;
      const fn = () => {
        executed = true;
        return 'result';
      };
      const delayedFn = delay(fn, 100);

      delayedFn();
      expect(executed).toBe(false);

      vi.advanceTimersByTime(100);
      expect(executed).toBe(true);
    });

    it('should pass arguments to delayed function', () => {
      let receivedArgs: unknown[] | null = null;
      const fn = (...args: unknown[]) => {
        receivedArgs = args;
        return 'result';
      };
      const delayedFn = delay(fn, 50);

      delayedFn('arg1', 'arg2');
      expect(receivedArgs).toBeNull();

      vi.advanceTimersByTime(50);

      expect(receivedArgs).toEqual(['arg1', 'arg2']);
    });

    it('should preserve context', () => {
      let receivedResult: number | null = null;
      const obj = {
        value: 42,
        method: function (this: { value: number }) {
          receivedResult = this.value;
          return this.value;
        },
      };
      const delayedMethod = delay(obj.method, 100);

      delayedMethod.call(obj);
      expect(receivedResult).toBeNull();

      vi.advanceTimersByTime(100);

      expect(receivedResult).toBe(42);
    });
  });

  describe('debounce', () => {
    it('should delay function execution until after wait time', () => {
      let executed = false;
      const fn = () => {
        executed = true;
      };
      const debouncedFn = debounce(fn, 100);

      debouncedFn();
      expect(executed).toBe(false);

      vi.advanceTimersByTime(100);
      expect(executed).toBe(true);
    });

    it('should reset timer on subsequent calls', () => {
      let callCount = 0;
      const fn = () => {
        callCount++;
      };
      const debouncedFn = debounce(fn, 100);

      debouncedFn();
      vi.advanceTimersByTime(50);
      debouncedFn();
      vi.advanceTimersByTime(50);
      expect(callCount).toBe(0);

      vi.advanceTimersByTime(50);
      expect(callCount).toBe(1);
    });

    it('should call with latest arguments', () => {
      let receivedArgs: unknown[] | null = null;
      let callCount = 0;
      const fn = (arg: unknown) => {
        receivedArgs = [arg];
        callCount++;
      };
      const debouncedFn = debounce(fn, 100);

      debouncedFn('first');
      vi.advanceTimersByTime(50);
      debouncedFn('second');
      vi.advanceTimersByTime(100);

      expect(callCount).toBe(1);
      expect(receivedArgs).toEqual(['second']);
    });

    it('should call immediately when immediate is true', () => {
      let callCount = 0;
      const fn = () => {
        callCount++;
      };
      const debouncedFn = debounce(fn, 100, true);

      debouncedFn();
      expect(callCount).toBe(1);

      debouncedFn();
      vi.advanceTimersByTime(100);
      expect(callCount).toBe(1); // No additional call
    });

    it('should preserve context', () => {
      let receivedResult: number | null = null;
      const obj = {
        value: 42,
        method: function (this: { value: number }) {
          receivedResult = this.value;
          return this.value;
        },
      };
      const debouncedFn = debounce(obj.method, 100);

      debouncedFn.call(obj);
      expect(receivedResult).toBeNull();

      vi.advanceTimersByTime(100);

      expect(receivedResult).toBe(42);
    });
  });

  describe('throttle', () => {
    it('should call function immediately on first invocation', () => {
      let callCount = 0;
      const fn = () => {
        callCount++;
        return 'result';
      };
      const throttledFn = throttle(fn, 100);

      const result = throttledFn();
      expect(callCount).toBe(1);
      expect(result).toBe('result');
    });

    it('should not call function again within wait period', () => {
      let callCount = 0;
      const fn = () => {
        callCount++;
        return 'result';
      };
      const throttledFn = throttle(fn, 100);

      throttledFn();
      throttledFn();
      throttledFn();

      expect(callCount).toBe(1);
    });

    it('should call function again after wait period', () => {
      let callCount = 0;
      const fn = () => {
        callCount++;
        return 'result';
      };
      const throttledFn = throttle(fn, 100);

      throttledFn();
      expect(callCount).toBe(1);

      vi.advanceTimersByTime(100);
      throttledFn();

      expect(callCount).toBe(2);
    });

    it('should pass latest arguments on trailing edge', () => {
      const receivedArgs: unknown[] = [];
      const fn = (arg: unknown) => {
        receivedArgs.push(arg);
        return `result-${arg}`;
      };
      const throttledFn = throttle(fn, 100);

      throttledFn('first');
      vi.advanceTimersByTime(50);
      throttledFn('second');
      vi.advanceTimersByTime(100);

      expect(receivedArgs).toEqual(['first', 'second']);
    });

    it('should respect leading: false option', () => {
      let callCount = 0;
      const fn = () => {
        callCount++;
        return 'result';
      };
      const throttledFn = throttle(fn, 100, { leading: false });

      const result = throttledFn();
      expect(callCount).toBe(0);
      expect(result).toBeUndefined();

      vi.advanceTimersByTime(100);
      expect(callCount).toBe(1);
    });

    it('should respect trailing: false option', () => {
      let callCount = 0;
      const fn = () => {
        callCount++;
        return 'result';
      };
      const throttledFn = throttle(fn, 100, { trailing: false });

      const result = throttledFn();
      expect(callCount).toBe(1);
      expect(result).toBe('result');

      vi.advanceTimersByTime(50);
      throttledFn();

      vi.advanceTimersByTime(100);
      expect(callCount).toBe(1); // No trailing call
    });

    it('should preserve context', () => {
      const obj = {
        value: 42,
        method: function (this: { value: number }) {
          return this.value;
        },
      };
      const throttledFn = throttle(obj.method, 100);

      const result = throttledFn.call(obj);

      expect(result).toBe(42);
    });

    it('should handle rapid calls correctly', () => {
      const receivedArgs: unknown[] = [];
      const fn = (arg: unknown) => {
        receivedArgs.push(arg);
        return `result-${arg}`;
      };
      const throttledFn = throttle(fn, 100);

      // Simulate rapid calls
      for (let i = 0; i < 10; i++) {
        throttledFn(i);
      }

      // Only first call should execute immediately
      expect(receivedArgs).toHaveLength(1);
      expect(receivedArgs[0]).toBe(0);

      // After wait time, trailing call should execute
      vi.advanceTimersByTime(100);
      expect(receivedArgs).toHaveLength(2);
      expect(receivedArgs[1]).toBe(9);
    });
  });
});
