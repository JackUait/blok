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

const fallbackEditorVersion = 'dev';

/**
 * Returns Editor.js version injected by bundler or a globally provided fallback.
 */
export const getEditorVersion = (): string => {
  if (typeof VERSION !== 'undefined') {
    return VERSION;
  }

  const globalVersion = (typeof globalThis === 'object' && globalThis !== null)
    ? (globalThis as { VERSION?: unknown }).VERSION
    : undefined;

  if (typeof globalVersion === 'string' && globalVersion.trim() !== '') {
    return globalVersion;
  }

  return fallbackEditorVersion;
};

/**
 * @typedef {object} ChainData
 * @property {object} data - data that will be passed to the success or fallback
 * @property {Function} function - function's that must be called asynchronously
 * @interface ChainData
 */
export interface ChainData {
  data?: object;
  function: (...args: unknown[]) => unknown;
}

/**
 * Editor.js utils
 */

/**
 * Returns basic key codes as constants
 *
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
    return Function('return this')() as UniversalScope;
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
 * Returns globally available document object if it exists.
 */
const getGlobalDocument = (): Document | undefined => {
  if (globalScope?.document) {
    return globalScope.document;
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
 *
 * @param {boolean} labeled — if true, Editor.js label is shown
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

  const editorLabelText = `Editor.js ${getEditorVersion()}`;
  const editorLabelStyle = `line-height: 1em;
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
      argsToPass.unshift(editorLabelStyle, style);

      return `%c${editorLabelText}%c ${msg}`;
    }

    return `( ${editorLabelText} )${msg}`;
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
  } catch (ignored) {}
};

/**
 * Current log level
 */
_log.logLevel = LogLevels.VERBOSE;

/**
 * Set current log level
 *
 * @param {LogLevels} logLevel - log level to set
 */
export const setLogLevel = (logLevel: LogLevels): void => {
  _log.logLevel = logLevel;
};

/**
 * _log method proxy without Editor.js label
 *
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
 * _log method proxy with Editor.js label
 *
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
 * Return string representation of the object type
 *
 * @param {*} object - object to get type
 * @returns {string}
 */
export const typeOf = (object: unknown): string => {
  const match = Object.prototype.toString.call(object).match(/\s([a-zA-Z]+)/);

  return match ? match[1].toLowerCase() : 'unknown';
};

/**
 * Check if passed variable is a function
 *
 * @param {*} fn - function to check
 * @returns {boolean}
 */
export const isFunction = (fn: unknown): fn is (...args: unknown[]) => unknown => {
  return typeOf(fn) === 'function' || typeOf(fn) === 'asyncfunction';
};

/**
 * Checks if passed argument is an object
 *
 * @param {*} v - object to check
 * @returns {boolean}
 */
export const isObject = (v: unknown): v is object => {
  return typeOf(v) === 'object';
};

/**
 * Checks if passed argument is a string
 *
 * @param {*} v - variable to check
 * @returns {boolean}
 */
export const isString = (v: unknown): v is string => {
  return typeOf(v) === 'string';
};

/**
 * Checks if passed argument is boolean
 *
 * @param {*} v - variable to check
 * @returns {boolean}
 */
export const isBoolean = (v: unknown): v is boolean => {
  return typeOf(v) === 'boolean';
};

/**
 * Checks if passed argument is number
 *
 * @param {*} v - variable to check
 * @returns {boolean}
 */
export const isNumber = (v: unknown): v is number => {
  return typeOf(v) === 'number';
};

/**
 * Checks if passed argument is undefined
 *
 * @param {*} v - variable to check
 * @returns {boolean}
 */
export const isUndefined = function (v: unknown): v is undefined {
  return typeOf(v) === 'undefined';
};

/**
 * Check if passed function is a class
 *
 * @param {Function} fn - function to check
 * @returns {boolean}
 */
export const isClass = (fn: unknown): boolean => {
  return isFunction(fn) && /^\s*class\s+/.test(fn.toString());
};

/**
 * Checks if object is empty
 *
 * @param {object} object - object to check
 * @returns {boolean}
 */
export const isEmpty = (object: object | null | undefined): boolean => {
  if (!object) {
    return true;
  }

  return Object.keys(object).length === 0 && object.constructor === Object;
};

/**
 * Check if passed object is a Promise
 *
 * @param  {*}  object - object to check
 * @returns {boolean}
 */
export const isPromise = (object: unknown): object is Promise<unknown> => {
  return Promise.resolve(object) === object;
};

/**
 * Returns true if passed key code is printable (a-Z, 0-9, etc) character.
 *
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
 * Fires a promise sequence asynchronously
 *
 * @param {ChainData[]} chains - list or ChainData's
 * @param {Function} success - success callback
 * @param {Function} fallback - callback that fires in case of errors
 * @returns {Promise}
 * @deprecated use PromiseQueue.ts instead
 */
export const sequence = async (
  chains: ChainData[],
  success: (data: object) => void = (): void => {},
  fallback: (data: object) => void = (): void => {}
): Promise<void> => {
  /**
   * Decorator
   *
   * @param {ChainData} chainData - Chain data
   * @param {Function} successCallback - success callback
   * @param {Function} fallbackCallback - fail callback
   * @returns {Promise}
   */
  const waitNextBlock = async (
    chainData: ChainData,
    successCallback: (data: object) => void,
    fallbackCallback: (data: object) => void
  ): Promise<void> => {
    try {
      await chainData.function(chainData.data);
      await successCallback(!isUndefined(chainData.data) ? chainData.data : {});
    } catch (e) {
      fallbackCallback(!isUndefined(chainData.data) ? chainData.data : {});
    }
  };

  /**
   * pluck each element from queue
   * First, send resolved Promise as previous value
   * Each plugins "prepare" method returns a Promise, that's why
   * reduce current element will not be able to continue while can't get
   * a resolved Promise
   */
  return chains.reduce(async (previousValue, currentValue) => {
    await previousValue;

    return waitNextBlock(currentValue, success, fallback);
  }, Promise.resolve());
};

/**
 * Make array from array-like collection
 *
 * @param {ArrayLike} collection - collection to convert to array
 * @returns {Array}
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const array = (collection: ArrayLike<any>): any[] => {
  return Array.prototype.slice.call(collection);
};

/**
 * Delays method execution
 *
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
 *
 * @param {File} file - file
 * @returns {string}
 */
export const getFileExtension = (file: File): string => {
  return file.name.split('.').pop() ?? '';
};

/**
 * Check if string is MIME type
 *
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
 *
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
 *
 * @param func - function to throttle
 * @param wait - function will be called only once for that period
 * @param options - Normally, the throttled function will run as much as it can
 *                  without ever going more than once per `wait` duration;
 *                  but if you'd like to disable the execution on the leading edge, pass
 *                  `{leading: false}`. To disable execution on the trailing edge, ditto.
 */
export const throttle = (func: (...args: unknown[]) => unknown, wait: number, options?: {leading?: boolean; trailing?: boolean}): (...args: unknown[]) => unknown => {
  const state: {
    args: unknown[] | null;
    result: unknown;
    timeoutId: ReturnType<typeof setTimeout> | null;
    previous: number;
    boundFunc: ((...boundArgs: unknown[]) => unknown) | null;
  } = {
    args: null,
    result: undefined,
    timeoutId: null,
    previous: 0,
    boundFunc: null,
  };

  const opts = options || {};

  const later = function (): void {
    state.previous = opts.leading === false ? 0 : Date.now();
    state.timeoutId = null;
    if (state.args !== null && state.boundFunc !== null) {
      state.result = state.boundFunc(...state.args);
    }

    state.boundFunc = null;
    state.args = null;
  };

  return function (this: unknown, ...restArgs: unknown[]): unknown {
    const now = Date.now();

    if (!state.previous && opts.leading === false) {
      state.previous = now;
    }

    const remaining = wait - (now - state.previous);

    state.boundFunc = func.bind(this);
    state.args = restArgs;

    if (remaining <= 0 || remaining > wait) {
      if (state.timeoutId !== null) {
        clearTimeout(state.timeoutId);
        state.timeoutId = null;
      }
      state.previous = now;
      if (state.args !== null && state.boundFunc !== null) {
        state.result = state.boundFunc(...state.args);
      }

      if (state.timeoutId === null) {
        state.boundFunc = null;
        state.args = null;
      }
    } else if (state.timeoutId === null && opts.trailing !== false) {
      state.timeoutId = setTimeout(later, remaining);
    }

    return state.result;
  };
};

/**
 * Legacy fallback method for copying text to clipboard
 *
 * @param text - text to copy
 */
const fallbackCopyTextToClipboard = (text: string): void => {
  const win = getGlobalWindow();
  const doc = getGlobalDocument();

  if (!win || !doc || !doc.body) {
    return;
  }

  const el = doc.createElement('div');

  el.className = 'codex-editor-clipboard';
  el.innerHTML = text;

  doc.body.appendChild(el);

  const selection = win.getSelection();
  const range = doc.createRange();

  range.selectNode(el);

  win.getSelection()?.removeAllRanges();
  selection?.addRange(range);

  if (typeof doc.execCommand === 'function') {
    doc.execCommand('copy');
  }

  doc.body.removeChild(el);
};

/**
 * Copies passed text to the clipboard
 *
 * @param text - text to copy
 */
export const copyTextToClipboard = (text: string): void => {
  const win = getGlobalWindow();
  const navigatorRef = getGlobalNavigator();

  // Use modern Clipboard API if available
  if (win?.isSecureContext && navigatorRef?.clipboard) {
    navigatorRef.clipboard.writeText(text).catch(() => {
      // Fallback to legacy method if Clipboard API fails
      fallbackCopyTextToClipboard(text);
    });

    return;
  }

  // Fallback to legacy method for older browsers
  fallbackCopyTextToClipboard(text);
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
  const userAgent = navigatorRef?.appVersion?.toLowerCase() ?? '';
  const userOS = userAgent ? Object.keys(OS).find((os: string) => userAgent.indexOf(os) !== -1) : undefined;

  if (userOS !== undefined) {
    OS[userOS] = true;

    return OS;
  }

  return OS;
};

/**
 * Capitalizes first letter of the string
 *
 * @param {string} text - text to capitalize
 * @returns {string}
 */
export const capitalize = (text: string): string => {
  return text[0].toUpperCase() + text.slice(1);
};

/**
 * Merge to objects recursively
 *
 * @param {object} target - merge target
 * @param {object[]} sources - merge sources
 * @returns {object}
 */
export const deepMerge = <T extends object> (target: T, ...sources: Partial<T>[]): T => {
  if (sources.length === 0) {
    return target;
  }

  const [source, ...rest] = sources;

  if (!isObject(target) || !isObject(source)) {
    return deepMerge(target, ...rest);
  }

  const targetRecord = target as Record<string, unknown>;

  Object.entries(source).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      targetRecord[key] = value as unknown;

      return;
    }

    if (typeof value !== 'object') {
      targetRecord[key] = value;

      return;
    }

    if (Array.isArray(value)) {
      targetRecord[key] = value;

      return;
    }

    if (!isObject(targetRecord[key])) {
      targetRecord[key] = {};
    }

    deepMerge(targetRecord[key] as object, value as object);
  });

  return deepMerge(target, ...rest);
};

/**
 * Return true if current device supports touch events
 *
 * Note! This is a simple solution, it can give false-positive results.
 * To detect touch devices more carefully, use 'touchstart' event listener
 *
 * @see http://www.stucox.com/blog/you-cant-detect-a-touchscreen/
 * @returns {boolean}
 */
export const isTouchSupported: boolean = (() => {
  const doc = getGlobalDocument();

  return Boolean(doc?.documentElement && 'ontouchstart' in doc.documentElement);
})();

/**
 * Make shortcut command more human-readable
 *
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
 *
 * @param {string} url - url to prettify
 */
export const getValidUrl = (url: string): string => {
  try {
    const urlObject = new URL(url);

    return urlObject.href;
  } catch (e) {
    // do nothing but handle below
  }

  if (url.substring(0, 2) === '//') {
    const win = getGlobalWindow();

    if (win) {
      return win.location.protocol + url;
    }

    return url;
  }

  const win = getGlobalWindow();

  if (win) {
    return win.location.origin + url;
  }

  return url;
};

/**
 * Create a block id
 *
 * @returns {string}
 */
export const generateBlockId = (): string => {
  const idLen = 10;

  return nanoid(idLen);
};

/**
 * Opens new Tab with passed URL
 *
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
 *
 * @param {string} prefix - identifier prefix
 * @returns {string}
 */
export const generateId = (prefix = ''): string => {
  return `${prefix}${(Math.floor(Math.random() * ID_RANDOM_MULTIPLIER)).toString(HEXADECIMAL_RADIX)}`;
};

/**
 * Common method for printing a warning about the usage of deprecated property or method.
 *
 * @param condition - condition for deprecation.
 * @param oldProperty - deprecated property.
 * @param newProperty - the property that should be used instead.
 */
export const deprecationAssert = (condition: boolean, oldProperty: string, newProperty: string): void => {
  const message = `«${oldProperty}» is deprecated and will be removed in the next major release. Please use the «${newProperty}» instead.`;

  if (condition) {
    logLabeled(message, 'warn');
  }
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
    target: object,
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
  holder: object,
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

const clearCacheValue = (holder: object, cacheKey: string | symbol): void => {
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

/**
 * Decorator which provides ability to cache method or accessor result.
 * Supports both legacy and TC39 stage 3 decorator semantics.
 *
 * @param args - decorator arguments (legacy: target, propertyKey, descriptor. Stage 3: value, context)
 */
const cacheableImpl = (...args: unknown[]): unknown => {
  if (args.length === 2 && isStage3DecoratorContext(args[1])) {
    const [value, context] = args as [
      ((...methodArgs: unknown[]) => unknown) | CacheableAccessor<unknown>,
      Stage3DecoratorContext
    ];
    const cacheKey = Symbol(
      typeof context.name === 'symbol'
        ? `cache:${context.name.description ?? 'symbol'}`
        : `cache:${context.name}`
    );

    if (context.kind === 'method' && typeof value === 'function') {
      const originalMethod = value as (...methodArgs: unknown[]) => unknown;

      return function (this: object, ...methodArgs: unknown[]): unknown {
        return ensureCacheValue(this, cacheKey, () => originalMethod.apply(this, methodArgs));
      } as typeof originalMethod;
    }

    if (context.kind === 'getter' && typeof value === 'function') {
      const originalGetter = value as () => unknown;

      return function (this: object): unknown {
        return ensureCacheValue(this, cacheKey, () => originalGetter.call(this));
      } as typeof originalGetter;
    }

    if (context.kind === 'accessor' && typeof value === 'object' && value !== null) {
      const accessor = value as CacheableAccessor<unknown>;
      const fallbackGetter = accessor.get ?? context.access?.get;
      const fallbackSetter = accessor.set ?? context.access?.set;

      return {
        get(this: object): unknown {
          if (!fallbackGetter) {
            return undefined;
          }

          return ensureCacheValue(this, cacheKey, () => fallbackGetter.call(this));
        },
        set(this: object, newValue: unknown): void {
          clearCacheValue(this, cacheKey);
          fallbackSetter?.call(this, newValue);
        },
        init(initialValue: unknown): unknown {
          return accessor.init ? accessor.init(initialValue) : initialValue;
        },
      } satisfies CacheableAccessor<unknown>;
    }

    return value;
  }

  const [target, propertyKey, descriptor] = args as [Record<PropertyKey, unknown>, string | symbol, TypedPropertyDescriptor<unknown> | undefined];
  const baseDescriptor =
    descriptor ??
    Object.getOwnPropertyDescriptor(target, propertyKey) ??
    (typeof target === 'function'
      ? Object.getOwnPropertyDescriptor((target as unknown as { prototype?: object }).prototype ?? {}, propertyKey)
      : undefined) ??
    {
      configurable: true,
      enumerable: false,
      writable: true,
      value: Reflect.get(target, propertyKey),
    };

  const descriptorRef = { ...baseDescriptor } as TypedPropertyDescriptor<unknown>;
  const cacheKey: string | symbol = typeof propertyKey === 'symbol' ? propertyKey : `#${propertyKey}Cache`;

  if (descriptorRef.value !== undefined && typeof descriptorRef.value === 'function') {
    const originalMethod = descriptorRef.value as (...methodArgs: unknown[]) => unknown;

    descriptorRef.value = function (this: object, ...methodArgs: unknown[]): unknown {
      return ensureCacheValue(this, cacheKey, () => originalMethod.apply(this, methodArgs));
    } as typeof originalMethod;
  } else if (descriptorRef.get !== undefined) {
    const originalGetter = descriptorRef.get as () => unknown;

    descriptorRef.get = function (this: object): unknown {
      return ensureCacheValue(this, cacheKey, () => originalGetter.call(this));
    } as typeof originalGetter;

    if (descriptorRef.set) {
      const originalSetter = descriptorRef.set;

      descriptorRef.set = function (this: object, newValue: unknown): void {
        clearCacheValue(this, cacheKey);
        originalSetter.call(this, newValue);
      } as typeof originalSetter;
    }
  }

  if (descriptor) {
    Object.keys(descriptor).forEach(propertyName => {
      if (!(propertyName in descriptorRef)) {
        Reflect.deleteProperty(descriptor, propertyName as keyof PropertyDescriptor);
      }
    });

    Object.assign(descriptor, descriptorRef);

    return descriptor;
  }

  return descriptorRef;
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
  if ((navigatorRef.maxTouchPoints ?? 0) > 1) {
    // Use platform only if userAgentData is not available
    // Use bracket notation to access deprecated property to avoid TypeScript warning
    const platformValue = platform !== undefined && platform !== ''
      ? platform
      : (navigatorRef as Navigator & { platform?: string })['platform'];

    if (platformValue === 'MacIntel') {
      return true;
    }
  }

  return false;
})();

/**
 * Compares two values with unknown type
 *
 * @param var1 - value to compare
 * @param var2 - value to compare with
 * @returns {boolean} true if they are equal
 */
export const equals = (var1: unknown, var2: unknown): boolean => {
  const isVar1NonPrimitive = Array.isArray(var1) || isObject(var1);
  const isVar2NonPrimitive = Array.isArray(var2) || isObject(var2);

  if (isVar1NonPrimitive || isVar2NonPrimitive) {
    return JSON.stringify(var1) === JSON.stringify(var2);
  }

  return var1 === var2;
};
