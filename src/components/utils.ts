/**
 * Class Util
 */

import { nanoid } from 'nanoid';
import Dom from './dom';

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
  if (!('console' in window) || !window.console[type]) {
    return;
  }

  const isSimpleType = ['info', 'log', 'warn', 'error'].includes(type);
  const argsToPass = [];

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

  const editorLabelText = `Editor.js ${VERSION}`;
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

  if (labeled) {
    if (isSimpleType) {
      argsToPass.unshift(editorLabelStyle, style);
      msg = `%c${editorLabelText}%c ${msg}`;
    } else {
      msg = `( ${editorLabelText} )${msg}`;
    }
  }

  try {
    if (!isSimpleType) {
      console[type](msg);
    } else if (args) {
      console[type](`${msg} %o`, ...argsToPass);
    } else {
      console[type](msg, ...argsToPass);
    }
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
 */
export const log = _log.bind(window, false);

/**
 * _log method proxy with Editor.js label
 */
export const logLabeled = _log.bind(window, true);

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
    window.setTimeout(() => method.apply(this, args), timeout);
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
  let timeout: number | null = null;

  return function (this: unknown, ...args: unknown[]): void {
    const later = (): void => {
      timeout = null;
      if (immediate !== true) {
        func.apply(this, args);
      }
    };

    const callNow = immediate === true && timeout === null;

    if (timeout !== null) {
      window.clearTimeout(timeout);
    }
    timeout = window.setTimeout(later, wait);
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
  let args: unknown[] | null;
  let result: unknown;
  let timeout: number | null = null;
  let previous = 0;
  let boundFunc: ((...args: unknown[]) => unknown) | null = null;

  const opts = options || {};

  const later = function (): void {
    previous = opts.leading === false ? 0 : Date.now();
    timeout = null;
    if (args !== null && boundFunc !== null) {
      result = boundFunc(...args);
    }

    boundFunc = null;
    args = null;
  };

  return function (this: unknown, ...restArgs: unknown[]): unknown {
    const now = Date.now();

    if (!previous && opts.leading === false) {
      previous = now;
    }

    const remaining = wait - (now - previous);

    boundFunc = func.bind(this);
    args = restArgs;

    if (remaining <= 0 || remaining > wait) {
      if (timeout !== null) {
        window.clearTimeout(timeout);
        timeout = null;
      }
      previous = now;
      if (args !== null && boundFunc !== null) {
        result = boundFunc(...args);
      }

      if (timeout === null) {
        boundFunc = null;
        args = null;
      }
    } else if (timeout === null && opts.trailing !== false) {
      timeout = window.setTimeout(later, remaining);
    }

    return result;
  };
};

/**
 * Legacy fallback method for copying text to clipboard
 *
 * @param text - text to copy
 */
const fallbackCopyTextToClipboard = (text: string): void => {
  const el = Dom.make('div', 'codex-editor-clipboard', {
    innerHTML: text,
  });

  document.body.appendChild(el);

  const selection = window.getSelection();
  const range = document.createRange();

  range.selectNode(el);

  window.getSelection()?.removeAllRanges();
  selection?.addRange(range);

  document.execCommand('copy');
  document.body.removeChild(el);
};

/**
 * Copies passed text to the clipboard
 *
 * @param text - text to copy
 */
export const copyTextToClipboard = (text: string): void => {
  // Use modern Clipboard API if available
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => {
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

  const userOS = Object.keys(OS).find((os: string) => window.navigator.appVersion.toLowerCase().indexOf(os) !== -1);

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
  if (!sources.length) {
    return target;
  }
  const source = sources.shift();

  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      const value = source[key];

      if (value === null || value === undefined) {
        Object.assign(target, { [key]: value });
        continue;
      }

      // Check if it's an array (arrays should not be merged)
      if (Array.isArray(value)) {
        Object.assign(target, { [key]: value });
        continue;
      }

      // Check if value is a primitive type (primitives should not be merged)
      const valueType = typeof value;
      const isPrimitive = valueType !== 'object';

      if (isPrimitive) {
        Object.assign(target, { [key]: value });
        continue;
      }

      // At this point, value must be an object (already checked null/undefined/array/primitives)
      // Try to merge it as an object
      if (target[key] === undefined || target[key] === null) {
        Object.assign(target, { [key]: {} });
      }

      deepMerge(target[key] as object, value as object);
    }
  }

  return deepMerge(target, ...sources);
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
export const isTouchSupported: boolean = 'ontouchstart' in document.documentElement;

/**
 * Make shortcut command more human-readable
 *
 * @param {string} shortcut — string like 'CMD+B'
 */
export const beautifyShortcut = (shortcut: string): string => {
  const OS = getUserOS();

  shortcut = shortcut
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
    shortcut = shortcut.replace(/ctrl|cmd/gi, '⌘').replace(/alt/gi, '⌥');
  } else {
    shortcut = shortcut.replace(/cmd/gi, 'Ctrl').replace(/windows/gi, 'WIN');
  }

  return shortcut;
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
    return window.location.protocol + url;
  } else {
    return window.location.origin + url;
  }
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
  window.open(url, '_blank');
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

/**
 * Decorator which provides ability to cache method or accessor result
 *
 * @param target - target instance or constructor function
 * @param propertyKey - method or accessor name
 * @param descriptor - property descriptor
 */
export const cacheable = <Target, Value, Arguments extends unknown[] = unknown[]> (
  target: Target,
  propertyKey: string,
  descriptor: PropertyDescriptor
): PropertyDescriptor => {
  const cacheKey = `#${propertyKey}Cache` as const;

  /**
   * Override get or value descriptor property to cache return value
   *
   * @param args - method args
   */
  if (descriptor.value !== undefined) {
    const originalMethod = descriptor.value as (...args: Arguments) => Value;

    descriptor.value = function (this: Record<string, unknown>, ...args: Arguments): Value {
      /**
       * If there is no cache, create it
       */
      if (this[cacheKey] === undefined) {
        this[cacheKey] = originalMethod.apply(this, args);
      }

      return this[cacheKey] as Value;
    };
  } else if (descriptor.get !== undefined) {
    const originalMethod = descriptor.get as () => Value;

    descriptor.get = function (this: Record<string, unknown>): Value {
      /**
       * If there is no cache, create it
       */
      if (this[cacheKey] === undefined) {
        this[cacheKey] = originalMethod.apply(this);
      }

      return this[cacheKey] as Value;
    };

    /**
     * If get accessor has been overridden, we need to override set accessor to clear cache
     *
     * @param value - value to set
     */
    if (descriptor.set) {
      const originalSet = descriptor.set as (value: unknown) => void;
      const targetRecord = target as Record<string, unknown>;

      descriptor.set = function (this: Record<string, unknown>, value: unknown): void {
        delete targetRecord[cacheKey];

        originalSet.call(this, value);
      };
    }
  }

  return descriptor;
};

/**
 * All screens below this width will be treated as mobile;
 */
export const mobileScreenBreakpoint = 650;

/**
 * True if screen has mobile size
 */
export const isMobileScreen = function (): boolean {
  return window.matchMedia(`(max-width: ${mobileScreenBreakpoint}px)`).matches;
};

/**
 * True if current device runs iOS
 */
export const isIosDevice =
  typeof window !== 'undefined' &&
  typeof window.navigator !== 'undefined' &&
  (() => {
    const navigator = window.navigator;
    const userAgent = navigator.userAgent || '';

    // Use modern User-Agent Client Hints API if available
    const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
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
    if (navigator.maxTouchPoints > 1) {
      // Use platform only if userAgentData is not available
      // Use bracket notation to access deprecated property to avoid TypeScript warning
      const platformValue = platform !== undefined && platform !== '' ? platform : (navigator as Navigator & { platform?: string })['platform'];

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
