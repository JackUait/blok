type AnyClass = abstract new (...args: never[]) => unknown;

/** Own method names on one prototype, constructor and accessors left out. */
const methodNames = (proto: Record<string, unknown>): string[] => Object.getOwnPropertyNames(proto)
  .filter((name) => name !== 'constructor' && typeof Object.getOwnPropertyDescriptor(proto, name)?.value === 'function');

/**
 * Gives a hand-written fake class a no-op for every method of the real class
 * (and its bases) that the fake does not define itself.
 *
 * A fake that lists methods by hand breaks the day the code calls a new one:
 * the call throws inside a handler and vitest reports an unhandled error.
 * Pass the real class from `importOriginal`, so the fake follows it.
 */
export const stubMissingMethods = (fake: AnyClass, real: AnyClass): void => {
  const target = fake.prototype as Record<string, unknown>;

  for (let proto = real.prototype as Record<string, unknown> | null; proto !== null && proto !== Object.prototype; proto = Object.getPrototypeOf(proto) as Record<string, unknown> | null) {
    for (const name of methodNames(proto).filter((n) => !(n in target))) {
      Object.defineProperty(target, name, { value: (): undefined => undefined, writable: true, configurable: true });
    }
  }
};
