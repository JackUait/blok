/**
 * Functional programming utilities (debounce, throttle, delay)
 */

/**
 * Delays method execution
 * @param method - method to execute
 * @param timeout - timeout in ms
 */
export const delay = (method: (...args: unknown[]) => unknown, timeout: number) => {
  return function (this: unknown, ...args: unknown[]): void {
    setTimeout(() => method.apply(this, args), timeout);
  };
};

/**
 * Debouncing method
 * Call method after passed time
 *
 * Note that this method returns Function and declared variable need to be called
 * @param func - function that we're throttling
 * @param wait - time in milliseconds
 * @param immediate - call now
 * @returns debounced function
 */
export const debounce = (
  func: (...args: unknown[]) => void,
  wait?: number,
  immediate?: boolean
): ((...args: unknown[]) => void) => {
  const state = {
    timeoutId: null as ReturnType<typeof setTimeout> | null,
  };

  return function (this: unknown, ...args: unknown[]): void {
    const later = (): void => {
      state.timeoutId = null;
      if (immediate !== true) {
        func.apply(this, args);
      }
    };

    const callNow = immediate === true && state.timeoutId === null;

    if (state.timeoutId !== null) {
      clearTimeout(state.timeoutId);
    }
    state.timeoutId = setTimeout(later, wait);
    if (callNow) {
      func.apply(this, args);
    }
  };
};

/**
 * Returns a function, that, when invoked, will only be triggered at most once during a given window of time.
 * @param func - function to throttle
 * @param wait - function will be called only once for that period
 * @param options - Normally, the throttled function will run as much as it can
 *                  without ever going more than once per `wait` duration;
 *                  but if you'd like to disable the execution on the leading edge, pass
 *                  `{leading: false}`. To disable execution on the trailing edge, ditto.
 */
export const throttle = (
  func: (...args: unknown[]) => unknown,
  wait: number,
  options?: {leading?: boolean; trailing?: boolean}
): ((...args: unknown[]) => unknown) => {
  const leading = options?.leading !== false;
  const trailing = options?.trailing !== false;

  const state = {
    lastCallTime: undefined as number | undefined,
    lastInvokeTime: 0,
    timerId: undefined as ReturnType<typeof setTimeout> | undefined,
    lastArgs: undefined as unknown[] | undefined,
    lastThis: undefined as unknown,
  };

  const invokeFunc = (time: number): unknown => {
    state.lastInvokeTime = time;
    const args = state.lastArgs;
    const thisArg = state.lastThis;

    state.lastArgs = undefined;
    state.lastThis = undefined;

    return func.apply(thisArg, args ?? []);
  };

  const remainingWait = (time: number): number => {
    const timeSinceLastCall = time - (state.lastCallTime ?? 0);
    const timeSinceLastInvoke = time - state.lastInvokeTime;
    const timeWaiting = wait - timeSinceLastCall;

    return trailing ? Math.min(timeWaiting, wait - timeSinceLastInvoke) : timeWaiting;
  };

  const shouldInvoke = (time: number): boolean => {
    const timeSinceLastCall = time - (state.lastCallTime ?? 0);
    const timeSinceLastInvoke = time - state.lastInvokeTime;

    return (
      state.lastCallTime === undefined ||
      timeSinceLastCall >= wait ||
      timeSinceLastCall < 0 ||
      timeSinceLastInvoke >= wait
    );
  };

  const timerExpired = (): void => {
    const time = Date.now();

    if (!shouldInvoke(time)) {
      state.timerId = setTimeout(timerExpired, remainingWait(time));

      return;
    }

    state.timerId = undefined;
    const shouldInvokeTrailing = trailing && state.lastArgs !== undefined;

    if (shouldInvokeTrailing) {
      invokeFunc(time);
    }
    state.lastArgs = undefined;
    state.lastThis = undefined;
  };

  const throttled = function (this: unknown, ...args: unknown[]): unknown {
    const time = Date.now();
    const isInvoking = shouldInvoke(time);

    state.lastArgs = args;
    state.lastThis = this;
    state.lastCallTime = time;

    const canStartTimer = isInvoking && state.timerId === undefined;

    if (!canStartTimer) {
      return undefined;
    }

    state.lastInvokeTime = time;
    state.timerId = setTimeout(timerExpired, wait);

    return leading ? invokeFunc(time) : undefined;
  };

  return throttled;
};
