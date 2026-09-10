import { describe, it, expect } from 'vitest';
import { cacheable } from '../../../../src/components/utils/decorators';

/**
 * Property-descriptor shape without PropertyDescriptor's `any`-typed fields.
 */
type Descriptor = {
  configurable?: boolean;
  enumerable?: boolean;
  writable?: boolean;
  value?: unknown;
  get?: () => unknown;
  set?: (value: unknown) => void;
};

type AccessorTriple = {
  get: (this: Record<string, unknown>) => unknown;
  set: (this: Record<string, unknown>, value: unknown) => void;
  init: (value: unknown) => unknown;
};

/**
 * The published overloads describe only the two legal decorator shapes, and
 * most of what the dispatcher branches on (a callable key, a null key, a
 * context-shaped key) is an argument list they reject.
 */
const raw = cacheable as unknown as (...args: unknown[]) => unknown;

const isCallable = (value: unknown): value is (...args: unknown[]) => unknown => typeof value === 'function';

const callOn = (value: unknown, host: Record<string, unknown>, ...args: unknown[]): unknown => {
  if (!isCallable(value)) {
    throw new Error(`expected a callable, got ${typeof value}`);
  }

  return value.apply(host, args);
};

const asDescriptor = (value: unknown): Descriptor => {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`expected a property descriptor, got ${typeof value}`);
  }

  return value;
};

const asAccessorTriple = (value: unknown): AccessorTriple => {
  const isTriple = typeof value === 'object' && value !== null
    && 'get' in value && 'set' in value && 'init' in value;

  if (!isTriple) {
    throw new Error('expected an accessor triple');
  }

  return value as AccessorTriple;
};

const symbolNames = (host: Record<string, unknown>): (string | undefined)[] =>
  Object.getOwnPropertySymbols(host).map(entry => entry.description);

describe('cacheable — stage 3 decorator shape', () => {
  it('caches a stage 3 method per host under a symbol named after the member', () => {
    let calls = 0;
    const original = function (...args: unknown[]): string {
      calls += 1;

      return `run:${args.length}`;
    };

    const wrapped = raw(original, { kind: 'method', name: 'compute' });
    const host: Record<string, unknown> = {};

    expect(callOn(wrapped, host, 'a')).toBe('run:1');
    expect(callOn(wrapped, host, 'b', 'c')).toBe('run:1');
    expect(calls).toBe(1);
    expect(Object.getOwnPropertyNames(host)).toStrictEqual([]);
    expect(symbolNames(host)).toStrictEqual(['cache:compute']);
    expect(Object.getOwnPropertyDescriptor(host, Object.getOwnPropertySymbols(host)[0])).toStrictEqual({
      value: 'run:1',
      writable: true,
      enumerable: false,
      configurable: true,
    });
  });

  it('names the cache symbol after a symbol member description', () => {
    const member = Symbol('member');
    const wrapped = raw(() => 'value', { kind: 'method', name: member });
    const host: Record<string, unknown> = {};

    expect(callOn(wrapped, host)).toBe('value');
    expect(symbolNames(host)).toStrictEqual(['cache:member']);
  });

  it('falls back to a generic cache symbol name for a description-less member', () => {
    const wrapped = raw(() => 'value', { kind: 'method', name: Symbol() });
    const host: Record<string, unknown> = {};

    expect(callOn(wrapped, host)).toBe('value');
    expect(symbolNames(host)).toStrictEqual(['cache:symbol']);
  });

  it('caches a stage 3 getter and ignores the arguments it is called with', () => {
    let calls = 0;
    const original = function (...args: unknown[]): string {
      calls += 1;

      return `args:${args.length}`;
    };

    const wrapped = raw(original, { kind: 'getter', name: 'value' });
    const host: Record<string, unknown> = {};

    expect(callOn(wrapped, host, 'ignored')).toBe('args:0');
    expect(callOn(wrapped, host)).toBe('args:0');
    expect(calls).toBe(1);
    expect(symbolNames(host)).toStrictEqual(['cache:value']);
  });

  it('caches a stage 3 accessor getter and drops the cache when the setter runs', () => {
    let getCalls = 0;
    const writes: unknown[] = [];
    const accessor = {
      get(this: Record<string, unknown>): unknown {
        getCalls += 1;

        return this.stored;
      },
      set(this: Record<string, unknown>, next: unknown): void {
        writes.push(next);
        this.stored = next;
      },
      init(initial: unknown): unknown {
        return `init:${String(initial)}`;
      },
    };

    const triple = asAccessorTriple(raw(accessor, { kind: 'accessor', name: 'field' }));
    const host: Record<string, unknown> = { stored: 1 };

    expect(triple.get.call(host)).toBe(1);
    expect(triple.get.call(host)).toBe(1);
    expect(getCalls).toBe(1);

    triple.set.call(host, 9);

    expect(writes).toStrictEqual([9]);
    expect(triple.get.call(host)).toBe(9);
    expect(getCalls).toBe(2);
    expect(triple.init(3)).toBe('init:3');
    expect(symbolNames(host)).toStrictEqual(['cache:field']);
  });

  it('reads and writes nothing for a stage 3 accessor with no getter or setter', () => {
    const triple = asAccessorTriple(raw({}, { kind: 'accessor', name: 'bare' }));
    const host: Record<string, unknown> = {};

    expect(triple.get.call(host)).toBeUndefined();

    triple.set.call(host, 5);

    expect(Object.getOwnPropertySymbols(host)).toStrictEqual([]);
    expect(triple.init(7)).toBe(7);
  });

  it('returns the value untouched for a stage 3 kind it does not wrap', () => {
    const plain = { marker: 'setter-kind' };

    expect(raw(plain, { kind: 'setter', name: 'member' })).toBe(plain);
  });

  it('returns the value untouched for a method whose value is not callable', () => {
    const plain = { marker: 'method-kind' };

    expect(raw(plain, { kind: 'method', name: 'member' })).toBe(plain);
  });

  it('returns the value untouched for a getter whose value is not callable', () => {
    const plain = { marker: 'getter-kind' };

    expect(raw(plain, { kind: 'getter', name: 'member' })).toBe(plain);
  });

  it('returns the value untouched for an accessor whose value is callable', () => {
    const original = (): string => 'accessor-kind';

    expect(raw(original, { kind: 'accessor', name: 'member' })).toBe(original);
  });

  it('returns null untouched for an accessor', () => {
    expect(raw(null, { kind: 'accessor', name: 'member' })).toBeNull();
  });
});

describe('cacheable — legacy dispatch', () => {
  it('treats a two-argument call with a string key as a legacy decorator', () => {
    const target = Object.create({ inherited: 7 }) as Record<string, unknown>;

    expect(raw(target, 'inherited')).toStrictEqual({
      configurable: true,
      enumerable: false,
      writable: true,
      value: 7,
    });
  });

  it('treats a callable second argument as a legacy property key', () => {
    const key: (() => void) & { kind: string } = Object.assign(function ctx(): void {}, { kind: 'method' });

    expect(raw({}, key)).toStrictEqual({
      configurable: true,
      enumerable: false,
      writable: true,
      value: undefined,
    });
  });

  it('treats an object second argument without a kind as a legacy property key', () => {
    expect(raw({}, { name: 'member' })).toStrictEqual({
      configurable: true,
      enumerable: false,
      writable: true,
      value: undefined,
    });
  });

  it('treats a null second argument as a legacy property key', () => {
    expect(raw({}, null)).toStrictEqual({
      configurable: true,
      enumerable: false,
      writable: true,
      value: undefined,
    });
  });

  it('routes a three-argument call to the legacy builder even when the key looks like a context', () => {
    const descriptor: Descriptor = {
      configurable: true,
      enumerable: false,
      writable: true,
      value: 7,
    };

    expect(raw({}, { kind: 'method', name: 'member' }, descriptor)).toBe(descriptor);
    expect(descriptor.value).toBe(7);
  });
});

/**
 * Four guards in buildLegacyCacheableDescriptor behave identically when forced
 * to `true`, so nothing below targets them:
 * - line 86 `descriptorRef.value !== undefined` — its right half
 *   `typeof descriptorRef.value === 'function'` is already false for undefined.
 * - line 88 `descriptorRef.set !== undefined` — line 106 tests `set` again
 *   before wrapping, so a truthier shouldWrapSetter changes nothing.
 * - line 98 `descriptorRef.get !== undefined` — line 87 sets shouldWrapGetter
 *   only when `get` is defined.
 * - line 106 `descriptorRef.set !== undefined` — line 88 sets shouldWrapSetter
 *   only when `set` is defined.
 */
describe('cacheable — legacy descriptor building', () => {
  it('prefers the descriptor argument over the one already on the target', () => {
    const fromTarget = (): string => 'target';
    const fromArgument = (): string => 'argument';
    const target: Record<string, unknown> = { member: fromTarget };
    const descriptor: Descriptor = {
      configurable: true,
      enumerable: false,
      writable: true,
      value: fromArgument,
    };

    expect(raw(target, 'member', descriptor)).toBe(descriptor);
    expect(descriptor.enumerable).toBe(false);
    expect(callOn(descriptor.value, {})).toBe('argument');
  });

  it('reads the descriptor off the prototype when the target is callable', () => {
    let calls = 0;

    class Owner {
      public member(...args: unknown[]): string {
        calls += 1;

        return `p:${args.length}`;
      }
    }

    const built = asDescriptor(raw(Owner, 'member'));
    const host: Record<string, unknown> = {};

    expect(Object.keys(built)).toStrictEqual(['value', 'writable', 'enumerable', 'configurable']);
    expect(callOn(built.value, host, 'a')).toBe('p:1');
    expect(callOn(built.value, host, 'a', 'b')).toBe('p:1');
    expect(calls).toBe(1);
  });

  it('ignores a prototype property on a target that is not callable', () => {
    const carrier: Record<string, unknown> = { prototype: { member: (): string => 'proto' } };

    expect(raw(carrier, 'member')).toStrictEqual({
      configurable: true,
      enumerable: false,
      writable: true,
      value: undefined,
    });
  });

  it('caches a legacy method under a key derived from the property name', () => {
    let calls = 0;
    const original = function (...args: unknown[]): string {
      calls += 1;

      return `n:${args.length}`;
    };
    const descriptor: Descriptor = {
      configurable: true,
      enumerable: false,
      writable: true,
      value: original,
    };

    raw({}, 'member', descriptor);

    const host: Record<string, unknown> = {};

    expect(callOn(descriptor.value, host, 'x')).toBe('n:1');
    expect(callOn(descriptor.value, host)).toBe('n:1');
    expect(calls).toBe(1);
    expect(Object.getOwnPropertyNames(host)).toStrictEqual(['#memberCache']);
  });

  it('uses a symbol property key as the cache key itself', () => {
    const key = Symbol('member');
    const descriptor: Descriptor = {
      configurable: true,
      enumerable: false,
      writable: true,
      value: (): string => 'ran',
    };

    raw({}, key, descriptor);

    const host: Record<string, unknown> = {};

    expect(callOn(descriptor.value, host)).toBe('ran');
    expect(Object.getOwnPropertyNames(host)).toStrictEqual([]);
    expect(Object.getOwnPropertySymbols(host)).toStrictEqual([key]);
  });

  it('leaves a non-callable descriptor value alone', () => {
    const descriptor: Descriptor = {
      configurable: true,
      enumerable: false,
      writable: true,
      value: 42,
    };

    expect(raw({}, 'member', descriptor)).toBe(descriptor);
    expect(descriptor.value).toBe(42);
  });

  it('leaves a setter alone when the descriptor has no getter', () => {
    const originalSetter = (): void => {};
    const descriptor: Descriptor = {
      configurable: true,
      enumerable: false,
      set: originalSetter,
    };

    expect(raw({}, 'member', descriptor)).toBe(descriptor);
    expect(descriptor.set).toBe(originalSetter);
    expect(Object.keys(descriptor)).toStrictEqual(['configurable', 'enumerable', 'set']);
  });

  it('wraps only the value when a descriptor carries both a value and accessors', () => {
    const original = (): string => 'from-value';
    const originalGetter = (): string => 'from-getter';
    const originalSetter = (): void => {};
    const descriptor: Descriptor = {
      configurable: true,
      enumerable: false,
      value: original,
      get: originalGetter,
      set: originalSetter,
    };

    expect(raw({}, 'member', descriptor)).toBe(descriptor);
    expect(descriptor.get).toBe(originalGetter);
    expect(descriptor.set).toBe(originalSetter);
    expect(descriptor.value).not.toBe(original);
    expect(callOn(descriptor.value, {})).toBe('from-value');
  });

  it('looks the cache key up before deleting it', () => {
    const descriptor: Descriptor = {
      configurable: true,
      enumerable: false,
      get: (): string => 'from-getter',
      set: (): void => {},
    };

    raw({}, 'member', descriptor);

    const traps: string[] = [];
    const host = new Proxy<Record<string, unknown>>({}, {
      has(target, key): boolean {
        traps.push(`has:${String(key)}`);

        return Reflect.has(target, key);
      },
      deleteProperty(target, key): boolean {
        traps.push(`delete:${String(key)}`);

        return Reflect.deleteProperty(target, key);
      },
    });
    const wrappedSetter = descriptor.set;

    if (wrappedSetter === undefined) {
      throw new Error('expected the setter to survive wrapping');
    }

    wrappedSetter.call(host, 1);

    expect(traps).toStrictEqual(['has:#memberCache']);
  });

  it('drops descriptor keys the rebuilt descriptor does not carry', () => {
    const original = (): string => 'ran';
    const descriptor: Descriptor = {
      configurable: true,
      enumerable: false,
      writable: true,
    };
    let armed = true;
    // Fires while the builder spreads `descriptor`, after the spread has taken
    // its key list — the only way the argument can end up holding a key the
    // rebuilt copy lacks.
    const valueGetter = function (): unknown {
      if (armed) {
        armed = false;
        Object.defineProperty(descriptor, 'extra', {
          value: 'stray',
          configurable: true,
          enumerable: true,
          writable: true,
        });
      }

      return original;
    };
    const valueSetter = function (): void {};

    Object.defineProperty(descriptor, 'value', {
      configurable: true,
      enumerable: true,
      get: valueGetter,
      set: valueSetter,
    });

    expect(raw({}, 'member', descriptor)).toBe(descriptor);
    expect(Object.keys(descriptor)).toStrictEqual(['configurable', 'enumerable', 'writable', 'value']);
    expect(Object.getOwnPropertyDescriptor(descriptor, 'value')?.get).toBe(valueGetter);
  });
});

/**
 * Witnesses for the four guard equivalences named above. Each one pins the
 * branch the dropped conjunct feeds: remove the re-check on line 106 or 98 and
 * the corresponding assertion below starts failing.
 */
describe('cacheable — legacy guard boundaries', () => {
  it('leaves a lone getter wrapped and adds no set member', () => {
    const originalGetter = (): string => 'g';
    const descriptor: Descriptor = {
      configurable: true,
      enumerable: false,
      get: originalGetter,
    };

    expect(raw({}, 'member', descriptor)).toBe(descriptor);
    expect(Object.keys(descriptor)).toStrictEqual(['configurable', 'enumerable', 'get']);
    expect(descriptor.get).not.toBe(originalGetter);
    expect(callOn(descriptor.get, {})).toBe('g');
  });

  it('builds a bare descriptor for a key a callable target does not carry', () => {
    class Owner {}

    const built = asDescriptor(raw(Owner, 'absent'));

    expect(built).toStrictEqual({
      configurable: true,
      enumerable: false,
      writable: true,
      value: undefined,
    });
    expect(Object.keys(built)).toStrictEqual(['configurable', 'enumerable', 'writable', 'value']);
  });
});
