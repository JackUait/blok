/**
 * Class Util
 */

import { nanoid } from 'nanoid';

/**
 * Possible log levels
 */
export enum LogLevels {
  VERBOSE = 'VERBOSE',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

/**
 * Allow to use global VERSION, that will be overwritten by Webpack
 */
declare const VERSION: string;

const fallbackBlokVersion = 'dev';

/**
 * Returns Blok version injected by bundler or a globally provided fallback.
 */
export const getBlokVersion = (): string => {
  if (typeof VERSION !== 'undefined') {
    return VERSION;
  }

  const globalVersion = (typeof globalThis === 'object' && globalThis !== null)
    ? (globalThis as { VERSION?: unknown }).VERSION
    : undefined;

  if (typeof globalVersion === 'string' && globalVersion.trim() !== '') {
    return globalVersion;
  }

  return fallbackBlokVersion;
};


/**
 * Blok utils
 */

/**
 * Returns basic key codes as constants
 * @returns {{}}
 */
export const keyCodes = {
  BACKSPACE: 8,
  TAB: 9,
  ENTER: 13,
  SHIFT: 16,
  CTRL: 17,
  ALT: 18,
  ESC: 27,
  SPACE: 32,
  LEFT: 37,
  UP: 38,
  DOWN: 40,
  RIGHT: 39,
  DELETE: 46,
  // Number keys range (0-9)
  NUMBER_KEY_MIN: 47,
  NUMBER_KEY_MAX: 58,
  // Letter keys range (A-Z)
  LETTER_KEY_MIN: 64,
  LETTER_KEY_MAX: 91,
  META: 91,
  // Numpad keys range
  NUMPAD_KEY_MIN: 95,
  NUMPAD_KEY_MAX: 112,
  // Punctuation keys range (;=,-./`)
  PUNCTUATION_KEY_MIN: 185,
  PUNCTUATION_KEY_MAX: 193,
  // Bracket keys range ([\]')
  BRACKET_KEY_MIN: 218,
  BRACKET_KEY_MAX: 223,
  // Processing key input for certain languages (Chinese, Japanese, etc.)
  PROCESSING_KEY: 229,
  SLASH: 191,
};

/**
 * Return mouse buttons codes
 */
export const mouseButtons = {
  LEFT: 0,
  WHEEL: 1,
  RIGHT: 2,
  BACKWARD: 3,
  FORWARD: 4,
};

/**
 * Constants for ID generation
 */
const ID_RANDOM_MULTIPLIER = 100_000_000; // 1e8
const HEXADECIMAL_RADIX = 16;

type UniversalScope = {
  window?: Window;
  document?: Document;
  navigator?: Navigator;
};

const globalScope: UniversalScope | undefined = (() => {
  try {
    // Use indirect eval to get the global object in any environment
    // eslint-disable-next-line no-new-func
    const globalFactory = new Function('return this') as () => unknown;

    return globalFactory() as UniversalScope;
  } catch {
    return undefined;
  }
})();

if (globalScope && typeof globalScope.window === 'undefined') {
  (globalScope as Record<string, unknown>).window = globalScope;
}

/**
 * Returns globally available window object if it exists.
 */
const getGlobalWindow = (): Window | undefined => {
  if (globalScope?.window) {
    return globalScope.window;
  }

  return undefined;
};

/**
 * Returns globally available navigator object if it exists.
 */
const getGlobalNavigator = (): Navigator | undefined => {
  if (globalScope?.navigator) {
    return globalScope.navigator;
  }

  const win = getGlobalWindow();

  return win?.navigator;
};

/**
 * Type representing callable console methods
 */
type ConsoleMethod = {
  [K in keyof Console]: Console[K] extends (...args: unknown[]) => unknown ? K : never;
}[keyof Console];

/**
 * Custom logger
 * @param {boolean} labeled — if true, Blok label is shown
 * @param {string} msg  - message
 * @param {string} type - logging type 'log'|'warn'|'error'|'info'
 * @param {*} [args]      - argument to log with a message
 * @param {string} style  - additional styling to message
 */
const _log = (
  labeled: boolean,
  msg: string,
  type: ConsoleMethod = 'log',
  args?: unknown,
  style = 'color: inherit'
): void => {
  const consoleRef: Console | undefined = typeof console === 'undefined' ? undefined : console;

  if (!consoleRef || typeof consoleRef[type] !== 'function') {
    return;
  }

  const isSimpleType = ['info', 'log', 'warn', 'error'].includes(type);
  const argsToPass: unknown[] = [];

  switch (_log.logLevel) {
    case LogLevels.VERBOSE:
      // VERBOSE logs everything, no early return
      break;

    case LogLevels.ERROR:
      if (type !== 'error') {
        return;
      }
      break;

    case LogLevels.WARN:
      if (!['error', 'warn'].includes(type)) {
        return;
      }
      break;

    case LogLevels.INFO:
      if (!isSimpleType || labeled) {
        return;
      }
      break;
  }

  if (args) {
    argsToPass.push(args);
  }

  const blokLabelText = `Blok ${getBlokVersion()}`;
  const blokLabelStyle = `line-height: 1em;
            color: #006FEA;
            display: inline-block;
            font-size: 11px;
            line-height: 1em;
            background-color: #fff;
            padding: 4px 9px;
            border-radius: 30px;
            border: 1px solid rgba(56, 138, 229, 0.16);
            margin: 4px 5px 4px 0;`;

  const formattedMessage = (() => {
    if (!labeled) {
      return msg;
    }

    if (isSimpleType) {
      argsToPass.unshift(blokLabelStyle, style);

      return `%c${blokLabelText}%c ${msg}`;
    }

    return `( ${blokLabelText} )${msg}`;
  })();

  const callArguments = (() => {
    if (!isSimpleType) {
      return [ formattedMessage ];
    }

    if (args !== undefined) {
      return [`${formattedMessage} %o`, ...argsToPass];
    }

    return [formattedMessage, ...argsToPass];
  })();

  try {
    consoleRef[type](...callArguments);
  } catch (_ignored) {}
};

/**
 * Current log level
 */
_log.logLevel = LogLevels.VERBOSE;

/**
 * Set current log level
 * @param {LogLevels} logLevel - log level to set
 */
export const setLogLevel = (logLevel: LogLevels): void => {
  _log.logLevel = logLevel;
};

/**
 * _log method proxy without Blok label
 * @param msg - message to log
 * @param type - console method name
 * @param args - optional payload to pass to console
 * @param style - optional css style for the first argument
 */
export const log = (
  msg: string,
  type: ConsoleMethod = 'log',
  args?: unknown,
  style?: string
): void => {
  _log(false, msg, type, args, style);
};

/**
 * _log method proxy with Blok label
 * @param msg - message to log
 * @param type - console method name
 * @param args - optional payload to pass to console
 * @param style - optional css style for the first argument
 */
export const logLabeled = (
  msg: string,
  type: ConsoleMethod = 'log',
  args?: unknown,
  style?: string
): void => {
  _log(true, msg, type, args, style);
};

/**
 * Check if passed variable is a function
 * @param {*} fn - function to check
 * @returns {boolean}
 */
export const isFunction = (fn: unknown): fn is (...args: unknown[]) => unknown => {
  return typeof fn === 'function';
};

/**
 * Checks if passed argument is a plain object (created by {} or Object constructor)
 * @param {*} v - object to check
 * @returns {boolean}
 */
export const isObject = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(v) as Record<string, unknown> | null;

  return proto === null || proto === Object.prototype;
};

/**
 * Checks if passed argument is a string
 * @param {*} v - variable to check
 * @returns {boolean}
 */
export const isString = (v: unknown): v is string => {
  return typeof v === 'string';
};

/**
 * Checks if passed argument is boolean
 * @param {*} v - variable to check
 * @returns {boolean}
 */
export const isBoolean = (v: unknown): v is boolean => {
  return typeof v === 'boolean';
};

/**
 * Checks if passed argument is number (including NaN, which has typeof 'number')
 * @param {*} v - variable to check
 * @returns {boolean}
 */
export const isNumber = (v: unknown): v is number => {
  return typeof v === 'number';
};

/**
 * Checks if passed argument is undefined
 * @param {*} v - variable to check
 * @returns {boolean}
 */
export const isUndefined = function (v: unknown): v is undefined {
  return v === undefined;
};

/**
 * Checks if value is empty (null, undefined, empty string, empty array, empty object, empty Map/Set)
 * @param {*} value - value to check
 * @returns {boolean}
 */
export const isEmpty = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string' || Array.isArray(value)) {
    return value.length === 0;
  }
  if (value instanceof Map || value instanceof Set) {
    return value.size === 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length === 0;
  }

  return false;
};

/**
 * Returns true if passed key code is printable (a-Z, 0-9, etc) character.
 * @param {number} keyCode - key code
 * @returns {boolean}
 */
export const isPrintableKey = (keyCode: number): boolean => {
  return (keyCode > keyCodes.NUMBER_KEY_MIN && keyCode < keyCodes.NUMBER_KEY_MAX) || // number keys
    keyCode === keyCodes.SPACE || keyCode === keyCodes.ENTER || // Space bar & return key(s)
    keyCode === keyCodes.PROCESSING_KEY || // processing key input for certain languages — Chinese, Japanese, etc.
    (keyCode > keyCodes.LETTER_KEY_MIN && keyCode < keyCodes.LETTER_KEY_MAX) || // letter keys
    (keyCode > keyCodes.NUMPAD_KEY_MIN && keyCode < keyCodes.NUMPAD_KEY_MAX) || // Numpad keys
    (keyCode > keyCodes.PUNCTUATION_KEY_MIN && keyCode < keyCodes.PUNCTUATION_KEY_MAX) || // ;=,-./` (in order)
    (keyCode > keyCodes.BRACKET_KEY_MIN && keyCode < keyCodes.BRACKET_KEY_MAX); // [\]' (in order)
};

/**
 * Make array from array-like collection
 * @param {ArrayLike} collection - collection to convert to array
 * @returns {Array}
 */
export const array = <T extends unknown>(collection: ArrayLike<T>): T[] => {
  return Array.from(collection);
};

/**
 * Delays method execution
 * @param {Function} method - method to execute
 * @param {number} timeout - timeout in ms
 */
export const delay = (method: (...args: unknown[]) => unknown, timeout: number) => {
  return function (this: unknown, ...args: unknown[]): void {
    setTimeout(() => method.apply(this, args), timeout);
  };
};

/**
 * Get file extension
 * @param {File} file - file
 * @returns {string}
 */
export const getFileExtension = (file: File): string => {
  return file.name.split('.').pop() ?? '';
};

/**
 * Check if string is MIME type
 * @param {string} type - string to check
 * @returns {boolean}
 */
export const isValidMimeType = (type: string): boolean => {
  return /^[-\w]+\/([-+\w]+|\*)$/.test(type);
};

/**
 * Debouncing method
 * Call method after passed time
 *
 * Note that this method returns Function and declared variable need to be called
 * @param {Function} func - function that we're throttling
 * @param {number} wait - time in milliseconds
 * @param {boolean} immediate - call now
 * @returns {Function}
 */
export const debounce = (func: (...args: unknown[]) => void, wait?: number, immediate?: boolean): (...args: unknown[]) => void => {
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

/**
 * Returns object with os name as key and boolean as value. Shows current user OS
 */
export const getUserOS = (): {[key: string]: boolean} => {
  const OS: {[key: string]: boolean} = {
    win: false,
    mac: false,
    x11: false,
    linux: false,
  };

  const navigatorRef = getGlobalNavigator();
  const userAgent = navigatorRef?.userAgent?.toLowerCase() ?? '';
  const userOS = userAgent ? Object.keys(OS).find((os: string) => userAgent.indexOf(os) !== -1) : undefined;

  if (userOS !== undefined) {
    OS[userOS] = true;

    return OS;
  }

  return OS;
};

/**
 * Capitalizes first letter of the string
 * @param {string} text - text to capitalize
 * @returns {string}
 */
export const capitalize = (text: string): string => {
  if (!text) {
    return text;
  }

  return text.slice(0, 1).toUpperCase() + text.slice(1);
};

/**
 * Deep merge two objects recursively. Arrays are overwritten (not merged).
 * Undefined values in source are skipped (matching lodash.mergeWith behavior).
 * @param target - target object
 * @param source - source object
 * @returns new merged object
 */
const deepMergeTwo = (target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> => {
  const result = { ...target };

  Object.keys(source).forEach((key) => {
    const targetValue = result[key];
    const sourceValue = source[key];

    if (sourceValue === undefined) {
      return;
    }

    const shouldRecurseMerge = isObject(sourceValue) && isObject(targetValue) && !Array.isArray(sourceValue);

    if (shouldRecurseMerge) {
      result[key] = deepMergeTwo(
        targetValue,
        sourceValue
      );

      return;
    }

    result[key] = sourceValue;
  });

  return result;
};

/**
 * Deep merge objects. Arrays are overwritten (not merged).
 * Mutates and returns the target object for compatibility with lodash.mergeWith.
 * @param target - target object to merge into
 * @param sources - source objects to merge from
 * @returns merged object (same reference as target)
 */
export const deepMerge = <T extends Record<string, unknown>> (target: T, ...sources: Partial<T>[]): T => {
  if (!isObject(target) || sources.length === 0) {
    return target;
  }

  const merged = sources.reduce((acc, source) => {
    if (!isObject(source)) {
      return acc;
    }

    return deepMergeTwo(acc, source as Record<string, unknown>);
  }, target as Record<string, unknown>);

  Object.assign(target, merged);

  return target;
};

/**
 * Make shortcut command more human-readable
 * @param {string} shortcut — string like 'CMD+B'
 */
export const beautifyShortcut = (shortcut: string): string => {
  const OS = getUserOS();
  const normalizedShortcut = shortcut
    .replace(/shift/gi, '⇧')
    .replace(/backspace/gi, '⌫')
    .replace(/enter/gi, '⏎')
    .replace(/up/gi, '↑')
    .replace(/left/gi, '→')
    .replace(/down/gi, '↓')
    .replace(/right/gi, '←')
    .replace(/escape/gi, '⎋')
    .replace(/insert/gi, 'Ins')
    .replace(/delete/gi, '␡')
    .replace(/\+/gi, ' + ');

  if (OS.mac) {
    return normalizedShortcut.replace(/ctrl|cmd/gi, '⌘').replace(/alt/gi, '⌥');
  }

  return normalizedShortcut.replace(/cmd/gi, 'Ctrl').replace(/windows/gi, 'WIN');
};

/**
 * Returns valid URL. If it is going outside and valid, it returns itself
 * If url has `one slash`, then it concatenates with window location origin
 * or when url has `two lack` it appends only protocol
 * @param {string} url - url to prettify
 */
export const getValidUrl = (url: string): string => {
  try {
    const urlObject = new URL(url);

    return urlObject.href;
  } catch (_e) {
    // do nothing but handle below
  }

  const win = getGlobalWindow();

  if (url.substring(0, 2) === '//') {
    return win ? `${win.location.protocol}${url}` : url;
  }

  return win ? `${win.location.origin}${url}` : url;
};

/**
 * Create a block id
 * @returns {string}
 */
export const generateBlockId = (): string => {
  const idLen = 10;

  return nanoid(idLen);
};

/**
 * Opens new Tab with passed URL
 * @param {string} url - URL address to redirect
 */
export const openTab = (url: string): void => {
  const win = getGlobalWindow();

  if (!win) {
    return;
  }

  win.open(url, '_blank');
};

/**
 * Returns random generated identifier
 * @param {string} prefix - identifier prefix
 * @returns {string}
 */
export const generateId = (prefix = ''): string => {
  return `${prefix}${(Math.floor(Math.random() * ID_RANDOM_MULTIPLIER)).toString(HEXADECIMAL_RADIX)}`;
};


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
  target: Record<PropertyKey, unknown>,
  propertyKey: string | symbol,
  descriptor?: TypedPropertyDescriptor<unknown>
): TypedPropertyDescriptor<unknown> => {
  const baseDescriptor =
    descriptor ??
    Object.getOwnPropertyDescriptor(target, propertyKey) ??
    (typeof target === 'function'
      ? Object.getOwnPropertyDescriptor((target as unknown as { prototype?: Record<string, unknown> }).prototype ?? {}, propertyKey)
      : undefined) ??
    {
      configurable: true,
      enumerable: false,
      writable: true,
      value: Reflect.get(target, propertyKey),
    };

  const descriptorRef = { ...baseDescriptor } as TypedPropertyDescriptor<unknown>;
  const cacheKey: string | symbol = typeof propertyKey === 'symbol' ? propertyKey : `#${propertyKey}Cache`;
  const hasMethodValue = descriptorRef.value !== undefined && typeof descriptorRef.value === 'function';
  const shouldWrapGetter = !hasMethodValue && descriptorRef.get !== undefined;
  const shouldWrapSetter = shouldWrapGetter && descriptorRef.set !== undefined;

  if (hasMethodValue) {
    const originalMethod = descriptorRef.value as (...methodArgs: unknown[]) => unknown;

    descriptorRef.value = function (this: Record<string, unknown>, ...methodArgs: unknown[]): unknown {
      return ensureCacheValue(this, cacheKey, () => originalMethod.apply(this, methodArgs));
    } as typeof originalMethod;
  }

  if (shouldWrapGetter && descriptorRef.get !== undefined) {
    const originalGetter = descriptorRef.get as () => unknown;

    descriptorRef.get = function (this: Record<string, unknown>): unknown {
      return ensureCacheValue(this, cacheKey, () => originalGetter.call(this));
    } as typeof originalGetter;
  }

  if (shouldWrapSetter && descriptorRef.set !== undefined) {
    const originalSetter = descriptorRef.set;

    descriptorRef.set = function (this: Record<string, unknown>, newValue: unknown): void {
      clearCacheValue(this, cacheKey);
      originalSetter.call(this, newValue);
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
    Record<PropertyKey, unknown>,
    string | symbol,
    TypedPropertyDescriptor<unknown> | undefined
  ];

  return buildLegacyCacheableDescriptor(target, propertyKey, descriptor);
};

export const cacheable = cacheableImpl as CacheableDecorator;

/**
 * All screens below this width will be treated as mobile;
 */
export const mobileScreenBreakpoint = 650;

/**
 * True if screen has mobile size
 */
export const isMobileScreen = (): boolean => {
  const win = getGlobalWindow();

  if (!win || typeof win.matchMedia !== 'function') {
    return false;
  }

  return win.matchMedia(`(max-width: ${mobileScreenBreakpoint}px)`).matches;
};

/**
 * True if current device runs iOS
 */
export const isIosDevice = (() => {
  const navigatorRef = getGlobalNavigator();

  if (!navigatorRef) {
    return false;
  }

  const userAgent = navigatorRef.userAgent || '';

  // Use modern User-Agent Client Hints API if available
  const userAgentData = (navigatorRef as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = userAgentData?.platform;

  // Check userAgent string first (most reliable method)
  if (/iP(ad|hone|od)/.test(userAgent)) {
    return true;
  }

  // Check platform from User-Agent Client Hints API if available
  if (platform !== undefined && platform !== '' && /iP(ad|hone|od)/.test(platform)) {
    return true;
  }

  // Check for iPad on iOS 13+ (reports as MacIntel with touch support)
  // Only access deprecated platform property when necessary
  const hasTouchSupport = (navigatorRef.maxTouchPoints ?? 0) > 1;
  const getLegacyPlatform = (): string | undefined =>
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- Fallback for older browsers that don't support User-Agent Client Hints
    (navigatorRef as Navigator & { platform?: string })['platform'];
  const platformHint = platform !== undefined && platform !== '' ? platform : undefined;
  const platformValue = hasTouchSupport ? platformHint ?? getLegacyPlatform() : undefined;

  if (platformValue === 'MacIntel') {
    return true;
  }

  return false;
})();

/**
 * Compares two arrays deeply for equality
 * @param arr1 - first array
 * @param arr2 - second array
 * @returns {boolean} true if arrays are equal
 */
const arraysEqual = (arr1: unknown[], arr2: unknown[]): boolean => {
  if (arr1.length !== arr2.length) {
    return false;
  }

  return arr1.every((item, index) => equals(item, arr2[index]));
};

/**
 * Compares two values deeply for equality
 * @param var1 - value to compare
 * @param var2 - value to compare with
 * @returns {boolean} true if they are equal
 */
export const equals = (var1: unknown, var2: unknown): boolean => {
  if (var1 === var2) {
    return true;
  }

  if (var1 === null || var2 === null || typeof var1 !== 'object' || typeof var2 !== 'object') {
    return false;
  }

  if (Array.isArray(var1) !== Array.isArray(var2)) {
    return false;
  }

  if (Array.isArray(var1) && Array.isArray(var2)) {
    return arraysEqual(var1, var2);
  }

  const keys1 = Object.keys(var1);
  const keys2 = Object.keys(var2);

  if (keys1.length !== keys2.length) {
    return false;
  }

  return keys1.every((key) =>
    Object.prototype.hasOwnProperty.call(var2, key) &&
    equals((var1 as Record<string, unknown>)[key], (var2 as Record<string, unknown>)[key])
  );
};

/**
 * Strips fake background wrapper elements from HTML content.
 * These elements are used by the inline toolbar for visual selection highlighting
 * and should not be persisted in saved data.
 * @param html - HTML content that may contain fake background elements
 * @returns HTML content with fake background wrappers removed but their content preserved
 */
export const stripFakeBackgroundElements = (html: string): string => {
  if (!html || !html.includes('data-blok-fake-background')) {
    return html;
  }

  const tempDiv = document.createElement('div');

  tempDiv.innerHTML = html;

  const fakeBackgrounds = tempDiv.querySelectorAll('[data-blok-fake-background="true"]');

  fakeBackgrounds.forEach((element) => {
    const parent = element.parentNode;

    if (!parent) {
      return;
    }

    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element);
    }

    parent.removeChild(element);
  });

  return tempDiv.innerHTML;
};
