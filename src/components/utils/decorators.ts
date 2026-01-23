/**
 * Decorator utilities for Blok editor
 */

type CacheableAccessor<Value> = {
  get?: () => Value;
  set?: (value: Value) => void;
  init?: (value: Value) => Value;
};

type Stage3DecoratorContext = {
  kind: 'method' | 'getter' | 'setter' | 'accessor';
  name: string | symbol;
  static?: boolean;
  private?: boolean;
  access?: {
    get?: () => unknown;
    set?: (value: unknown) => void;
  };
};

type CacheableDecorator = {
  <Member>(
    target: Record<string, unknown>,
    propertyKey: string | symbol,
    descriptor?: TypedPropertyDescriptor<Member>
  ): TypedPropertyDescriptor<Member> | void;
  <Value = unknown, Arguments extends unknown[] = unknown[]>(
    value: ((...args: Arguments) => Value) | CacheableAccessor<Value>,
    context: Stage3DecoratorContext
  ):
    | ((...args: Arguments) => Value)
    | CacheableAccessor<Value>;
};

const ensureCacheValue = <Value>(
  holder: Record<string, unknown>,
  cacheKey: string | symbol,
  compute: () => Value
): Value => {
  if (!Reflect.has(holder, cacheKey)) {
    Object.defineProperty(holder, cacheKey, {
      configurable: true,
      writable: true,
      value: compute(),
    });
  }

  return Reflect.get(holder, cacheKey) as Value;
};

const clearCacheValue = (holder: Record<string, unknown>, cacheKey: string | symbol): void => {
  if (Reflect.has(holder, cacheKey)) {
    Reflect.deleteProperty(holder, cacheKey);
  }
};

const isStage3DecoratorContext = (context: unknown): context is Stage3DecoratorContext => {
  if (typeof context !== 'object' || context === null) {
    return false;
  }

  return 'kind' in context && 'name' in context;
};

const buildLegacyCacheableDescriptor = (
  target: Record<string, unknown>,
  propertyKey: string | symbol,
  descriptor?: TypedPropertyDescriptor<unknown>
): TypedPropertyDescriptor<unknown> => {
  const baseDescriptor: TypedPropertyDescriptor<unknown> =
    descriptor ??
    Object.getOwnPropertyDescriptor(target, propertyKey) ??
    (typeof target === 'function'
      ? Object.getOwnPropertyDescriptor((target as unknown as { prototype?: Record<string, unknown> }).prototype ?? {}, propertyKey)
      : undefined) ??
    {
      configurable: true,
      enumerable: false,
      writable: true,
      value: Reflect.get(target, propertyKey) as unknown,
    };

  const descriptorRef = { ...baseDescriptor } as TypedPropertyDescriptor<unknown>;
  const cacheKey: string | symbol = typeof propertyKey === 'symbol' ? propertyKey : `#${propertyKey}Cache`;
  const hasMethodValue = descriptorRef.value !== undefined && typeof descriptorRef.value === 'function';
  const shouldWrapGetter = !hasMethodValue && descriptorRef.get !== undefined;
  const shouldWrapSetter = shouldWrapGetter && descriptorRef.set !== undefined;

  if (hasMethodValue) {
    const originalMethod = descriptorRef.value as (...methodArgs: unknown[]) => unknown;

    descriptorRef.value = function (this: unknown, ...methodArgs: unknown[]): unknown {
      return ensureCacheValue(this as Record<string, unknown>, cacheKey, () => originalMethod.apply(this, methodArgs));
    } as typeof originalMethod;
  }

  if (shouldWrapGetter && descriptorRef.get !== undefined) {
    const originalGetter = descriptorRef.get as () => unknown;

    descriptorRef.get = function (this: unknown): unknown {
      return ensureCacheValue(this as Record<string, unknown>, cacheKey, () => originalGetter.call(this));
    } as typeof originalGetter;
  }

  if (shouldWrapSetter && descriptorRef.set !== undefined) {
    const originalSetter = descriptorRef.set;

    descriptorRef.set = function (this: unknown, newValue: unknown): void {
      clearCacheValue(this as Record<string, unknown>, cacheKey);
      (originalSetter as (this: unknown, value: unknown) => void).call(this, newValue);
    } as typeof originalSetter;
  }

  if (!descriptor) {
    return descriptorRef;
  }

  Object.keys(descriptor).forEach(propertyName => {
    if (!(propertyName in descriptorRef)) {
      Reflect.deleteProperty(descriptor, propertyName as keyof PropertyDescriptor);
    }
  });

  Object.assign(descriptor, descriptorRef);

  return descriptor;
};

const applyStage3CacheableDecorator = (
  value: ((...methodArgs: unknown[]) => unknown) | CacheableAccessor<unknown>,
  context: Stage3DecoratorContext
): unknown => {
  const cacheKey = Symbol(
    typeof context.name === 'symbol'
      ? `cache:${context.name.description ?? 'symbol'}`
      : `cache:${context.name}`
  );

  if (context.kind === 'method' && typeof value === 'function') {
    const originalMethod = value as (...methodArgs: unknown[]) => unknown;

    return function (this: Record<string, unknown>, ...methodArgs: unknown[]): unknown {
      return ensureCacheValue(this, cacheKey, () => originalMethod.apply(this, methodArgs));
    } as typeof originalMethod;
  }

  if (context.kind === 'getter' && typeof value === 'function') {
    const originalGetter = value as () => unknown;

    return function (this: Record<string, unknown>): unknown {
      return ensureCacheValue(this, cacheKey, () => originalGetter.call(this));
    } as typeof originalGetter;
  }

  if (context.kind === 'accessor' && typeof value === 'object' && value !== null) {
    const accessor = value;
    const fallbackGetter = accessor.get ?? context.access?.get;
    const fallbackSetter = accessor.set ?? context.access?.set;

    return {
      get(this: Record<string, unknown>): unknown {
        return fallbackGetter
          ? ensureCacheValue(this, cacheKey, () => fallbackGetter.call(this))
          : undefined;
      },
      set(this: Record<string, unknown>, newValue: unknown): void {
        clearCacheValue(this, cacheKey);
        fallbackSetter?.call(this, newValue);
      },
      init(initialValue: unknown): unknown {
        return accessor.init ? accessor.init(initialValue) : initialValue;
      },
    } satisfies CacheableAccessor<unknown>;
  }

  return value;
};

/**
 * Decorator which provides ability to cache method or accessor result.
 * Supports both legacy and TC39 stage 3 decorator semantics.
 * @param args - decorator arguments (legacy: target, propertyKey, descriptor. Stage 3: value, context)
 */
const cacheableImpl = (...args: unknown[]): unknown => {
  if (args.length === 2 && isStage3DecoratorContext(args[1])) {
    const [value, context] = args as [
      ((...methodArgs: unknown[]) => unknown) | CacheableAccessor<unknown>,
      Stage3DecoratorContext
    ];

    return applyStage3CacheableDecorator(value, context);
  }

  const [target, propertyKey, descriptor] = args as [
    Record<string, unknown>,
    string | symbol,
    TypedPropertyDescriptor<unknown> | undefined
  ];

  return buildLegacyCacheableDescriptor(target, propertyKey, descriptor);
};

export const cacheable = cacheableImpl as CacheableDecorator;
