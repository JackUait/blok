interface ListenerSpy {
  mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> };
}

const isCapture = (options: unknown): boolean => {
  if (typeof options === 'boolean') return options;

  return typeof options === 'object' && options !== null && 'capture' in options && options.capture === true;
};

/**
 * The event types of listeners that were added but never removed.
 * A removal only counts with the same listener and the same capture flag,
 * as in the DOM.
 * @param added - spy on `addEventListener`
 * @param removed - spy on `removeEventListener`
 */
export const leakedListeners = (added: ListenerSpy, removed: ListenerSpy): unknown[] => {
  return added.mock.calls
    .filter(([type, listener, options]) => !removed.mock.calls.some(([t, l, o]) => {
      return t === type && l === listener && isCapture(o) === isCapture(options);
    }))
    .map(([type]) => type);
};
